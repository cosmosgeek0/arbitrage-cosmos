import type { IncomingMessage } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface OperatorIdentity {
  id: string;
  email: string | null;
  source: 'loopback' | 'cloudflare-access';
}

export interface OperatorVerification {
  authorized: boolean;
  operator: OperatorIdentity | null;
  code: string;
  reason: string;
}

type OperatorRequest = IncomingMessage & { __cosmosOperator?: OperatorIdentity };

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EDGE_HEADERS = [
  'cf-access-jwt-assertion',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
] as const;

function firstHeader(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function normalizeSocketAddress(value: string | undefined): string {
  if (!value) return '';
  return value.toLowerCase().replace(/^::ffff:/, '');
}

export function isLoopbackAddress(value: string | undefined): boolean {
  const address = normalizeSocketAddress(value);
  return address === '::1' || address === '127.0.0.1' || address.startsWith('127.');
}

function localHost(value: string): boolean {
  const host = value.trim().toLowerCase();
  const match = host.match(/^(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))?$/)
    ?? host.match(/^\[::1\](?::(\d{1,5}))?$/);
  if (!match) return false;
  if (match[1] === undefined) return true;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function hasEdgeMarkers(req: IncomingMessage): boolean {
  return EDGE_HEADERS.some((name) => firstHeader(req, name).trim().length > 0);
}

function hasAccessIdentityConfiguration(): boolean {
  return [
    process.env.CF_ACCESS_TEAM_DOMAIN,
    process.env.CF_ACCESS_AUD,
    process.env.CONTROL_ROOM_OPERATOR_EMAIL,
    process.env.AWS_CONTROL_OPERATOR_EMAIL,
  ].some((value) => String(value ?? '').trim().length > 0);
}

function sameOrigin(req: IncomingMessage, remote: boolean, required: boolean): OperatorVerification | null {
  const rawOrigin = firstHeader(req, 'origin').trim();
  if (!rawOrigin) {
    return required
      ? { authorized: false, operator: null, code: 'ORIGIN_REQUIRED', reason: 'A same-origin request is required.' }
      : null;
  }
  const host = firstHeader(req, 'host').trim().toLowerCase();
  try {
    const origin = new URL(rawOrigin);
    const protocolOk = remote ? origin.protocol === 'https:' : origin.protocol === 'http:' || origin.protocol === 'https:';
    if (!protocolOk || origin.host.toLowerCase() !== host || origin.username || origin.password) {
      return { authorized: false, operator: null, code: 'ORIGIN_MISMATCH', reason: 'Cross-origin request blocked.' };
    }
    return null;
  } catch {
    return { authorized: false, operator: null, code: 'ORIGIN_INVALID', reason: 'Request origin is invalid.' };
  }
}

function configuredTeamDomain(): { issuer: string; error: string | null } {
  const raw = String(process.env.CF_ACCESS_TEAM_DOMAIN ?? '').trim();
  if (!raw) return { issuer: '', error: 'CF_ACCESS_TEAM_DOMAIN is not configured.' };
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== 'https:'
      || !parsed.hostname.toLowerCase().endsWith('.cloudflareaccess.com')
      || parsed.username
      || parsed.password
      || (parsed.pathname !== '/' && parsed.pathname !== '')
      || parsed.search
      || parsed.hash
    ) {
      return { issuer: '', error: 'CF_ACCESS_TEAM_DOMAIN is invalid.' };
    }
    return { issuer: parsed.origin, error: null };
  } catch {
    return { issuer: '', error: 'CF_ACCESS_TEAM_DOMAIN is invalid.' };
  }
}

function operatorEmail(payload: JWTPayload): string {
  return typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
}

export class OperatorAccess {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private jwksIssuer = '';

  operator(req: IncomingMessage): OperatorIdentity | null {
    return (req as OperatorRequest).__cosmosOperator ?? null;
  }

  private remember(req: IncomingMessage, operator: OperatorIdentity): OperatorVerification {
    (req as OperatorRequest).__cosmosOperator = operator;
    return { authorized: true, operator, code: 'OK', reason: '' };
  }

  // Seam for tests only: the JWKS location is always derived from the
  // already-validated team domain and must never come from any other input.
  // Overriding this lets the forged-token matrix serve a loopback JWKS
  // without weakening configuredTeamDomain().
  protected jwksUrl(issuer: string): URL {
    return new URL(`${issuer}/cdn-cgi/access/certs`);
  }

  async verify(
    req: IncomingMessage,
    options: { websocket?: boolean; requireOrigin?: boolean } = {},
  ): Promise<OperatorVerification> {
    const host = firstHeader(req, 'host').trim();
    const loopback = isLoopbackAddress(req.socket.remoteAddress);
    const local = loopback
      && localHost(host)
      && !hasEdgeMarkers(req)
      && !hasAccessIdentityConfiguration();
    const fetchSite = firstHeader(req, 'sec-fetch-site').trim().toLowerCase();
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      return { authorized: false, operator: null, code: 'CROSS_SITE_REQUEST', reason: 'Cross-site browser request blocked.' };
    }
    const unsafe = UNSAFE_METHODS.has(String(req.method ?? 'GET').toUpperCase());
    const requireSameOrigin = options.requireOrigin === true
      || (options.websocket === true && !local)
      || (unsafe && !local);
    const originFailure = sameOrigin(req, !local, requireSameOrigin);
    if (originFailure) return originFailure;

    const existing = this.operator(req);
    if (existing) return { authorized: true, operator: existing, code: 'OK', reason: '' };

    if (local) {
      return this.remember(req, { id: 'local-operator', email: null, source: 'loopback' });
    }

    const expectedEmail = String(
      process.env.CONTROL_ROOM_OPERATOR_EMAIL ?? process.env.AWS_CONTROL_OPERATOR_EMAIL ?? '',
    ).trim().toLowerCase();
    const audience = String(process.env.CF_ACCESS_AUD ?? '').trim();
    const assertion = firstHeader(req, 'cf-access-jwt-assertion').trim();
    const team = configuredTeamDomain();
    if (!host) return { authorized: false, operator: null, code: 'HOST_REQUIRED', reason: 'Host header is required.' };
    if (!expectedEmail) return { authorized: false, operator: null, code: 'OPERATOR_NOT_CONFIGURED', reason: 'Remote operator identity is not configured.' };
    if (!audience) return { authorized: false, operator: null, code: 'AUDIENCE_NOT_CONFIGURED', reason: 'Cloudflare Access audience is not configured.' };
    if (team.error) return { authorized: false, operator: null, code: 'ISSUER_NOT_CONFIGURED', reason: team.error };
    if (!assertion) return { authorized: false, operator: null, code: 'ASSERTION_REQUIRED', reason: 'Cloudflare Access assertion is missing.' };

    try {
      if (!this.jwks || this.jwksIssuer !== team.issuer) {
        this.jwks = createRemoteJWKSet(this.jwksUrl(team.issuer), {
          cooldownDuration: 30_000,
          timeoutDuration: 5_000,
        });
        this.jwksIssuer = team.issuer;
      }
      const { payload } = await jwtVerify(assertion, this.jwks, {
        algorithms: ['RS256'],
        issuer: team.issuer,
        audience,
        clockTolerance: 5,
      });
      const email = operatorEmail(payload);
      const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
      if (!subject || !email || email !== expectedEmail) {
        return { authorized: false, operator: null, code: 'OPERATOR_MISMATCH', reason: 'Verified Cloudflare Access operator does not match.' };
      }
      return this.remember(req, { id: subject.slice(0, 160), email, source: 'cloudflare-access' });
    } catch {
      return { authorized: false, operator: null, code: 'ASSERTION_INVALID', reason: 'Cloudflare Access assertion verification failed.' };
    }
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      void this.verify(req)
        .then((result) => {
          if (!result.authorized) {
            res.status(401).json({ ok: false, code: result.code, error: result.reason });
            return;
          }
          res.locals.operator = result.operator;
          next();
        })
        .catch(() => {
          res.status(503).json({ ok: false, code: 'OPERATOR_CHECK_UNAVAILABLE', error: 'Operator verification is unavailable.' });
        });
    };
  }
}

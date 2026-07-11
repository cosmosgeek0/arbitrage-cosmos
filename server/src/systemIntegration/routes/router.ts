import { createHash } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { OperatorIdentity } from '../../security/access.js';
import type { SystemControlActor } from '../controls/types.js';
import type { SystemControlMutationRequest } from '../contracts/types.js';
import { parseControlBody, parseEventQuery, TRACE_ID_PATTERN } from './validation.js';
import type { SystemIntegrationRouterOptions } from './types.js';

function operator(value: unknown): Readonly<SystemControlActor> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<OperatorIdentity>;
  if (
    typeof candidate.id !== 'string'
    || candidate.id.trim().length === 0
    || candidate.id.length > 160
    || (candidate.email !== null && (
      typeof candidate.email !== 'string'
      || candidate.email.length > 320
    ))
    || (candidate.source !== 'loopback' && candidate.source !== 'cloudflare-access')
  ) return null;
  return Object.freeze({ id: candidate.id, email: candidate.email ?? null, source: candidate.source });
}

function correlationId(idempotencyKey: string): string {
  const digest = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32);
  return `cor_control_${digest}`;
}

function readError(res: Response): void {
  res.status(503).json({ ok: false, code: 'READ_MODEL_UNAVAILABLE', error: 'System integration read model is unavailable.' });
}

function failureStatus(code: string): number {
  if (code === 'OPERATOR_REQUIRED') return 401;
  if (code === 'CONTROL_PERSISTENCE_UNAVAILABLE' || code === 'COMPOSITION_CHECK_UNAVAILABLE') return 503;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (
    code === 'INVALID_CONTROL_REQUEST'
    || code === 'IDEMPOTENCY_KEY_REQUIRED'
    || code === 'IDEMPOTENCY_KEY_INVALID'
    || code === 'INVALID_RUN_MODE'
    || code === 'INVALID_EXECUTION_MODE'
  ) return 400;
  return 409;
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => { void handler(req, res).catch(next); };
}

function rejectReadQuery(req: Request, res: Response): boolean {
  const keys = Object.keys(req.query);
  if (keys.length === 0) return false;
  const refresh = keys.includes('refresh');
  res.status(400).json({
    ok: false,
    code: refresh ? 'REFRESH_REQUIRES_POST' : 'INVALID_SYSTEM_QUERY',
    error: refresh ? 'Read routes never force network refresh.' : 'This read route accepts no query fields.',
  });
  return true;
}

/**
 * Relative router. Mount at `/api/system-integration` only after the audited
 * global `/api` OperatorAccess middleware and before the API 404 handler.
 */
export function createSystemIntegrationRouter(options: SystemIntegrationRouterOptions): express.Router {
  if (
    !options
    || typeof options.read?.supervisor !== 'function'
    || typeof options.read?.graph !== 'function'
    || typeof options.read?.events !== 'function'
    || typeof options.read?.controls !== 'function'
    || typeof options.read?.trace !== 'function'
    || typeof options.controls?.mutate !== 'function'
    || typeof options.controls?.auditRejectedRequest !== 'function'
    || typeof options.controls?.snapshot !== 'function'
    || typeof options.clock?.nowMs !== 'function'
  ) throw new TypeError('createSystemIntegrationRouter requires injected read, control, and clock ports.');

  const router = express.Router();
  router.use((_req, res, next) => {
    const verified = operator(res.locals.operator);
    if (!verified) {
      res.status(401).json({ ok: false, code: 'OPERATOR_REQUIRED', error: 'Verified operator identity is required.' });
      return;
    }
    res.locals.systemIntegrationOperator = verified;
    next();
  });

  router.get('/supervisor', asyncRoute(async (req, res) => {
    if (rejectReadQuery(req, res)) return;
    try { res.json(await options.read.supervisor()); } catch { readError(res); }
  }));

  router.get('/graph', asyncRoute(async (req, res) => {
    if (rejectReadQuery(req, res)) return;
    try { res.json(await options.read.graph()); } catch { readError(res); }
  }));

  router.get('/events', asyncRoute(async (req, res) => {
    const parsed = parseEventQuery(req.query);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, code: parsed.code, error: parsed.message });
      return;
    }
    try {
      res.json(await options.read.events({
        limit: parsed.limit,
        ...(parsed.beforeId ? { beforeId: parsed.beforeId } : {}),
        ...(parsed.afterId ? { afterId: parsed.afterId } : {}),
      }));
    } catch { readError(res); }
  }));

  router.get('/controls', asyncRoute(async (req, res) => {
    if (rejectReadQuery(req, res)) return;
    try { res.json(await options.read.controls()); } catch { readError(res); }
  }));

  router.get('/traces/:correlationId', asyncRoute(async (req, res) => {
    if (rejectReadQuery(req, res)) return;
    const traceId = req.params.correlationId;
    if (!TRACE_ID_PATTERN.test(traceId)) {
      res.status(400).json({ ok: false, code: 'INVALID_TRACE_ID', error: 'correlationId is invalid.' });
      return;
    }
    try {
      const trace = await options.read.trace(traceId);
      if (!trace) {
        res.status(404).json({ ok: false, code: 'TRACE_NOT_FOUND', error: 'Correlation trace was not found.' });
        return;
      }
      res.json(trace);
    } catch { readError(res); }
  }));

  router.post('/controls', asyncRoute(async (req, res) => {
    const actor = res.locals.systemIntegrationOperator as Readonly<SystemControlActor>;
    const idempotencyHeader = req.get('Idempotency-Key') ?? '';
    const requestedAtMs = options.clock.nowMs();
    const requestCorrelationId = correlationId(idempotencyHeader);
    const auditRouteRejection = async (code: string, message: string): Promise<void> => {
      const body = req.body !== null && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body as Record<string, unknown>
        : {};
      const command = typeof body.command === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(body.command)
        ? body.command
        : null;
      const rawExpectedRevision = body.expectedRevision;
      const expectedRevision = typeof rawExpectedRevision === 'number'
        && Number.isSafeInteger(rawExpectedRevision)
        && rawExpectedRevision >= 0
        ? rawExpectedRevision
        : null;
      await options.controls.auditRejectedRequest({
        idempotencyKey: idempotencyHeader || null,
        expectedRevision,
        command,
        requestedAtMs,
        correlationId: requestCorrelationId,
        code,
        message,
      }, actor);
    };
    if (!req.is('application/json')) {
      await auditRouteRejection('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
      res.status(415).json({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', error: 'Content-Type must be application/json.' });
      return;
    }
    const parsed = parseControlBody(req.body);
    if (!parsed.ok) {
      await auditRouteRejection(parsed.code, parsed.message);
      res.status(parsed.code === 'LIVE_EXECUTION_NOT_IMPLEMENTED' ? 409 : 400).json({
        ok: false,
        code: parsed.code,
        error: parsed.message,
        currentRevision: options.controls.snapshot().revision,
      });
      return;
    }
    const request: SystemControlMutationRequest = Object.freeze({
      idempotencyKey: idempotencyHeader,
      expectedRevision: parsed.expectedRevision,
      reason: parsed.reason,
      requestedAtMs,
      correlationId: requestCorrelationId,
      mutation: parsed.mutation,
    });
    const result = await options.controls.mutate(request, actor);
    if (!result.ok) {
      res.status(failureStatus(result.failure.code)).json({
        ok: false,
        code: result.failure.code,
        error: result.failure.message,
        currentRevision: options.controls.snapshot().revision,
      });
      return;
    }
    res.json({ ok: true, ...result.value });
  }));

  return router;
}

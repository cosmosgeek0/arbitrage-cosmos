#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { OperatorAccess, isLoopbackAddress } from '../dist/security/access.js';

function request({ address = '127.0.0.1', host = 'localhost:8080', method = 'GET', headers = {} } = {}) {
  return {
    method,
    headers: { host, ...headers },
    socket: { remoteAddress: address },
  };
}

test('loopback detection does not confuse remote addresses with localhost', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('10.0.0.8'), false);
});

test('local admission requires both a loopback peer and canonical local Host', async () => {
  const access = new OperatorAccess();
  assert.equal((await access.verify(request())).authorized, true);
  assert.equal((await access.verify(request({ address: '10.0.0.8' }))).authorized, false);
  assert.equal((await access.verify(request({ host: 'example.test' }))).authorized, false);
  assert.equal((await access.verify(request({ host: '127.0.0.1:99999' }))).authorized, false);
});

test('edge markers disable local bypass', async () => {
  const result = await new OperatorAccess().verify(request({ headers: { 'x-forwarded-for': '127.0.0.1' } }));
  assert.equal(result.authorized, false);
  assert.notEqual(result.operator?.source, 'loopback');
});

test('local unsafe calls permit originless CLI use but reject a supplied foreign Origin', async () => {
  const access = new OperatorAccess();
  assert.equal((await access.verify(request({ method: 'POST' }))).authorized, true);
  const foreign = await access.verify(request({ method: 'POST', headers: { origin: 'https://evil.example' } }));
  assert.equal(foreign.authorized, false);
  assert.equal(foreign.code, 'ORIGIN_MISMATCH');
});

test('Fetch Metadata blocks cross-site browser GETs, including localhost targets', async () => {
  const result = await new OperatorAccess().verify(request({ headers: { 'sec-fetch-site': 'cross-site' } }));
  assert.equal(result.authorized, false);
  assert.equal(result.code, 'CROSS_SITE_REQUEST');
  const sameOrigin = await new OperatorAccess().verify(request({ headers: { 'sec-fetch-site': 'same-origin' } }));
  assert.equal(sameOrigin.authorized, true);
});

test('WebSocket admission rejects foreign origins and requires Origin remotely', async () => {
  const access = new OperatorAccess();
  const foreign = await access.verify(request({ headers: { origin: 'https://evil.example' } }), { websocket: true });
  assert.equal(foreign.authorized, false);
  assert.equal(foreign.code, 'ORIGIN_MISMATCH');

  const remote = await access.verify(request({ address: '10.0.0.8', host: 'control.example' }), { websocket: true });
  assert.equal(remote.authorized, false);
  assert.equal(remote.code, 'ORIGIN_REQUIRED');
});

// ---------------------------------------------------------------------------
// The remote Cloudflare Access JWT verification branch (access.ts:145-179).
// Before these tests, exactly one assertion repo-wide touched this branch and
// it only proved the pre-flight env guard: no forged, wrong-issuer,
// wrong-audience, or wrong-email token had ever been verified in CI, and
// configuredTeamDomain() — the guard deciding where signing keys are fetched
// from — was equally untested. Each case below constructs a token differing
// from a known-good one in exactly one dimension and asserts BOTH the refusal
// and the specific code, so nothing can pass for the wrong reason.
// The JWKS is served from a loopback HTTP server (not egress) through the
// jwksUrl() seam; configuredTeamDomain() itself stays fully enforced.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { SignJWT, exportJWK, exportSPKI, generateKeyPair } from 'jose';

const TEAM_DOMAIN = 'https://cosmos-test.cloudflareaccess.com';
const AUD = 'a'.repeat(64);
const OWNER_EMAIL = 'owner@example.com';

function remoteRequest(headers = {}) {
  return request({ address: '10.0.0.8', host: 'control.example', headers });
}

async function withAccessHarness(fn) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const foreign = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const jwks = { keys: [{ ...jwk, alg: 'RS256', use: 'sig' }] };
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(jwks));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  class LoopbackJwksAccess extends OperatorAccess {
    jwksUrl() { return new URL(`http://127.0.0.1:${port}/certs`); }
  }
  const savedEnv = {};
  for (const name of ['CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'CONTROL_ROOM_OPERATOR_EMAIL', 'AWS_CONTROL_OPERATOR_EMAIL']) {
    savedEnv[name] = process.env[name];
  }
  process.env.CF_ACCESS_TEAM_DOMAIN = TEAM_DOMAIN;
  process.env.CF_ACCESS_AUD = AUD;
  process.env.CONTROL_ROOM_OPERATOR_EMAIL = OWNER_EMAIL;
  delete process.env.AWS_CONTROL_OPERATOR_EMAIL;
  try {
    await fn({
      access: () => new LoopbackJwksAccess(),
      privateKey,
      publicKey,
      foreignPrivateKey: foreign.privateKey,
    });
  } finally {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

async function signToken(privateKey, {
  alg = 'RS256',
  issuer = TEAM_DOMAIN,
  audience = AUD,
  email = OWNER_EMAIL,
  sub = 'operator-sub-1',
  expiresIn = '5m',
  notBefore = null,
} = {}) {
  // `null` means "omit this claim entirely" — an explicit `undefined` would
  // be swallowed by the destructuring defaults above.
  const jwt = new SignJWT(email === null ? {} : { email });
  jwt.setProtectedHeader({ alg });
  if (sub !== null) jwt.setSubject(sub);
  jwt.setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime(expiresIn);
  if (notBefore !== null) jwt.setNotBefore(notBefore);
  return jwt.sign(privateKey);
}

test('case 1: a correctly signed owner token authorizes with the verified identity', async () => {
  await withAccessHarness(async ({ access, privateKey }) => {
    const token = await signToken(privateKey);
    const result = await access().verify(remoteRequest({ 'cf-access-jwt-assertion': token }));
    assert.equal(result.authorized, true);
    assert.equal(result.code, 'OK');
    assert.equal(result.operator.source, 'cloudflare-access');
    assert.equal(result.operator.email, OWNER_EMAIL);
    assert.equal(result.operator.id, 'operator-sub-1');
  });
});

test('cases 2-8: cryptographic and claim forgeries are refused as ASSERTION_INVALID', async () => {
  await withAccessHarness(async ({ access, privateKey, publicKey, foreignPrivateKey }) => {
    const b64u = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const nowSec = Math.floor(Date.now() / 1000);
    const spkiPem = await exportSPKI(publicKey);
    const forgeries = {
      'signed by a foreign RS256 key not in the JWKS': await signToken(foreignPrivateKey),
      'alg none': `${b64u({ alg: 'none' })}.${b64u({
        iss: TEAM_DOMAIN, aud: AUD, email: OWNER_EMAIL, sub: 's', iat: nowSec, exp: nowSec + 300,
      })}.`,
      'HS256 signed with the public key as HMAC secret': await signToken(
        new TextEncoder().encode(spkiPem), { alg: 'HS256' },
      ),
      'wrong issuer (another Cloudflare tenant)': await signToken(privateKey, {
        issuer: 'https://other-tenant.cloudflareaccess.com',
      }),
      "wrong audience (another application's AUD)": await signToken(privateKey, { audience: 'b'.repeat(64) }),
      'expired 60s ago (clockTolerance is 5s, not unbounded)': await signToken(privateKey, {
        expiresIn: nowSec - 60,
      }),
      'not yet valid for another 60s': await signToken(privateKey, { notBefore: nowSec + 60 }),
    };
    for (const [name, token] of Object.entries(forgeries)) {
      const result = await access().verify(remoteRequest({ 'cf-access-jwt-assertion': token }));
      assert.equal(result.authorized, false, name);
      assert.equal(result.code, 'ASSERTION_INVALID', name);
      assert.equal(result.operator, null, name);
    }
  });
});

test('cases 9-11: a cryptographically valid token for the wrong identity is OPERATOR_MISMATCH', async () => {
  await withAccessHarness(async ({ access, privateKey }) => {
    // 9: any authenticated tenant user who is not the owner must be refused,
    // with a code distinct from ASSERTION_INVALID — proving the identity check
    // runs after successful cryptographic verification.
    const attacker = await signToken(privateKey, { email: 'attacker@evil.example', sub: 'attacker-sub' });
    const attacked = await access().verify(remoteRequest({ 'cf-access-jwt-assertion': attacker }));
    assert.equal(attacked.authorized, false);
    assert.equal(attacked.code, 'OPERATOR_MISMATCH');
    assert.equal(attacked.operator, null);

    // 10: a missing email claim must not compare equal to anything
    const noEmail = await signToken(privateKey, { email: null });
    const noEmailResult = await access().verify(remoteRequest({ 'cf-access-jwt-assertion': noEmail }));
    assert.equal(noEmailResult.authorized, false);
    assert.equal(noEmailResult.code, 'OPERATOR_MISMATCH');

    // 11: an identity with no subject must not be remembered
    const noSub = await signToken(privateKey, { sub: null });
    const noSubResult = await access().verify(remoteRequest({ 'cf-access-jwt-assertion': noSub }));
    assert.equal(noSubResult.authorized, false);
    assert.equal(noSubResult.code, 'OPERATOR_MISMATCH');
  });
});

test('case 12: owner email normalization (case/whitespace) is intentional and pinned', async () => {
  await withAccessHarness(async ({ access, privateKey }) => {
    const token = await signToken(privateKey, { email: '  OWNER@Example.COM ' });
    const result = await access().verify(remoteRequest({ 'cf-access-jwt-assertion': token }));
    assert.equal(result.authorized, true);
    assert.equal(result.operator.email, OWNER_EMAIL);
  });
});

test('cases 13-14: missing assertion and unset audience fail closed with distinct codes', async () => {
  await withAccessHarness(async ({ access }) => {
    // 13: all three env vars set, no assertion header — "missing" is distinct
    // from "invalid"
    const missing = await access().verify(remoteRequest());
    assert.equal(missing.authorized, false);
    assert.equal(missing.code, 'ASSERTION_REQUIRED');

    // 14: header present but CF_ACCESS_AUD unset — fail-closed ordering
    delete process.env.CF_ACCESS_AUD;
    try {
      const noAud = await access().verify(remoteRequest({ 'cf-access-jwt-assertion': 'x.y.z' }));
      assert.equal(noAud.authorized, false);
      assert.equal(noAud.code, 'AUDIENCE_NOT_CONFIGURED');
    } finally {
      process.env.CF_ACCESS_AUD = AUD;
    }
  });
});

test('case 15: configuredTeamDomain rejects every malformed key-retrieval origin', async () => {
  await withAccessHarness(async ({ access }) => {
    // The highest-value matrix in this file: it proves signing-key retrieval
    // cannot be redirected to an attacker-controlled host.
    const hostile = [
      'http://cosmos-test.cloudflareaccess.com',
      'https://evil.com',
      'https://cosmos-test.cloudflareaccess.com.evil.com',
      'https://user:pw@cosmos-test.cloudflareaccess.com',
      'https://cosmos-test.cloudflareaccess.com/path',
      'https://cosmos-test.cloudflareaccess.com/?q=1',
      'https://cosmos-test.cloudflareaccess.com/#f',
      '',
    ];
    try {
      for (const domain of hostile) {
        process.env.CF_ACCESS_TEAM_DOMAIN = domain;
        const result = await access().verify(remoteRequest({ 'cf-access-jwt-assertion': 'x.y.z' }));
        assert.equal(result.authorized, false, JSON.stringify(domain));
        assert.equal(result.code, 'ISSUER_NOT_CONFIGURED', JSON.stringify(domain));
      }
    } finally {
      process.env.CF_ACCESS_TEAM_DOMAIN = TEAM_DOMAIN;
    }
  });
});

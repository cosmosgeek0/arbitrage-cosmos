import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createSystemIntegrationRouter } from '../../../dist/systemIntegration/routes/index.js';

const HOST = '127.0.0.1';
const T0 = 1_800_000_000_000;

// Every read route in the system-integration router, with the read port that
// backs it. A read-model failure on any of them must stay opaque on the wire
// (READ_MODEL_UNAVAILABLE) while recording the true cause on stderr — the bare
// `catch {}` form of these handlers hid a total control-plane outage from the
// logs. Parameterised over all eight so a future bare catch cannot reappear
// silently on any one of them.
const READ_ROUTES = [
  { path: '/supervisor', port: 'supervisor' },
  { path: '/ops/readback', port: 'opsReadback' },
  { path: '/ops/intake-gate', port: 'opsReadback' },
  { path: '/graph', port: 'graph' },
  { path: '/events', port: 'events' },
  { path: '/controls', port: 'controls' },
  { path: '/attention/focus/BTCUSDT', port: 'focusPin' },
  { path: '/traces/cor_present', port: 'trace' },
];

function sentinel(route) {
  return new Error(`SENTINEL_READ_FAILURE ${route}`);
}

function throwingPorts() {
  return {
    read: {
      supervisor() { throw sentinel('/supervisor'); },
      graph() { throw sentinel('/graph'); },
      events() { throw sentinel('/events'); },
      controls() { throw sentinel('/controls'); },
      focusPin() { throw sentinel('/attention/focus/BTCUSDT'); },
      trace() { throw sentinel('/traces/cor_present'); },
    },
    opsReadback: {
      read() { throw sentinel('/ops'); },
    },
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind');
  return `http://${HOST}:${address.port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test('a failed read is opaque on the wire but records its cause on stderr for all eight read routes', { concurrency: false }, async () => {
  const { read, opsReadback } = throwingPorts();
  const controls = {
    mutate() { throw new Error('not under test'); },
    auditRejectedRequest() { throw new Error('not under test'); },
    snapshot() { throw new Error('not under test'); },
  };
  const validateOnly = { async executeValidateOnly() { throw new Error('not under test'); } };
  const m0SpotCanary = { async inspectSourceMount() { throw new Error('not under test'); } };
  const router = createSystemIntegrationRouter({
    read, controls, validateOnly, m0SpotCanary, clock: { nowMs: () => T0 }, opsReadback,
  });
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.locals.operator = { id: 'loopback-operator', email: null, source: 'loopback' };
    next();
  });
  app.use('/api/system-integration', router);
  const server = http.createServer(app);
  const base = await listen(server);

  const captured = [];
  const original = console.error;
  console.error = (line) => { captured.push(String(line)); };
  try {
    for (const { path } of READ_ROUTES) {
      const before = captured.length;
      const response = await fetch(`${base}/api/system-integration${path}`);

      // (a) the HTTP contract is preserved: opaque 503, no cause on the wire
      assert.equal(response.status, 503, path);
      const body = await response.json();
      assert.equal(body.ok, false, path);
      assert.equal(body.code, 'READ_MODEL_UNAVAILABLE', path);
      assert.equal(body.error, 'System integration read model is unavailable.', path);
      assert.doesNotMatch(JSON.stringify(body), /SENTINEL_READ_FAILURE/u, path);

      // (b) the cause is recorded on stderr — fails on any bare `catch {}`
      assert.equal(captured.length, before + 1, `${path} must log exactly one structured line`);
      const logged = JSON.parse(captured.at(-1));
      assert.equal(logged.event, 'system_integration_read_failed', path);
      assert.match(logged.message, /SENTINEL_READ_FAILURE/u, path);
      assert.ok(typeof logged.stack === 'string' && logged.stack.length > 0, `${path} must record a stack`);
      assert.ok(typeof logged.route === 'string' && logged.route.length > 0, path);
    }

    // (c) identical consecutive failures are rate-bounded: a second hit on the
    // same route with the same message inside the window logs nothing new
    const before = captured.length;
    const repeat = await fetch(`${base}/api/system-integration/supervisor`);
    assert.equal(repeat.status, 503);
    assert.equal((await repeat.json()).code, 'READ_MODEL_UNAVAILABLE');
    assert.equal(captured.length, before, 'identical consecutive failure must not spam the log');
  } finally {
    console.error = original;
    await close(server);
  }
});

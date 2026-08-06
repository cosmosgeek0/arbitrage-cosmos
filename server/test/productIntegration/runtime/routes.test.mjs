import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import {
  createProductIntegrationRuntime,
  createProductIntegrationRuntimeRouter,
  productIncidentAcknowledgementControlId,
} from '../../../dist/productIntegration/runtime/index.js';
import { T0, makeRead } from './testSupport.mjs';

const HOST = '127.0.0.1';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return `http://${HOST}:${address.port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test('browser supervisor reads coalesce and WebSocket publication never rebuilds the owner graph', async () => {
  const base = makeRead();
  let release;
  const admitted = new Promise((resolve) => { release = resolve; });
  let supervisorReads = 0;
  let nowMs = T0;
  const service = createProductIntegrationRuntime({
    read: Object.freeze({
      ...base,
      async supervisor() {
        supervisorReads += 1;
        await admitted;
        return base.supervisor();
      },
    }),
    clock: { nowMs: () => nowMs },
  });

  const first = service.readSupervisorShared();
  nowMs = Number.NaN;
  const second = service.readSupervisorShared();
  assert.strictEqual(second, first, 'an existing owner read is joined before another clock/cache decision');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supervisorReads, 1);
  assert.equal(service.readPublishedSupervisor(), null);
  nowMs = T0;
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.strictEqual(left, right);
  assert.strictEqual(service.readPublishedSupervisor(), left);
  assert.strictEqual(await service.readSupervisorShared(), left);
  assert.equal(supervisorReads, 1);
});

test('shared supervisor cache reuses at 999ms and refreshes once at exact 1,000ms', async () => {
  const base = makeRead();
  let nowMs = T0;
  let supervisorReads = 0;
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
  const service = createProductIntegrationRuntime({
    read: Object.freeze({
      ...base,
      async supervisor() {
        supervisorReads += 1;
        if (supervisorReads === 2) await refreshGate;
        return base.supervisor();
      },
    }),
    clock: { nowMs: () => nowMs },
  });

  const first = await service.readSupervisorShared();
  assert.equal(first.evaluatedAtMs, T0);
  nowMs += 999;
  assert.strictEqual(await service.readSupervisorShared(), first);
  assert.equal(supervisorReads, 1);

  nowMs += 1;
  const expiredLeft = service.readSupervisorShared();
  const expiredRight = service.readSupervisorShared();
  await new Promise((resolve) => setImmediate(resolve));
  const readsDuringRefresh = supervisorReads;
  const publishedDuringRefresh = service.readPublishedSupervisor();
  assert.equal(readsDuringRefresh, 2, 'exactly 1,000ms must start one fresh owner read');
  // contract updated 2026-08-06: stale-serve with background rebuild (owner-directed)
  const [left, right] = await Promise.all([expiredLeft, expiredRight]);
  assert.strictEqual(left, first, 'an expired read serves the prior cut without awaiting the rebuild');
  assert.strictEqual(right, first, 'every expired caller is served the same prior cut immediately');
  assert.strictEqual(publishedDuringRefresh, first, 'an in-flight refresh cannot replace completed evidence');
  releaseRefresh();
  for (let attempt = 0; attempt < 50 && service.readPublishedSupervisor() === first; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  // contract updated 2026-08-06: stale-serve with background rebuild (owner-directed)
  const republished = service.readPublishedSupervisor();
  assert.notStrictEqual(republished, first, 'the background refresh replaces the published cut');
  assert.equal(republished.evaluatedAtMs, T0 + 1_000);
  assert.strictEqual(await service.readSupervisorShared(), republished, 'a later poll returns the refreshed cut');
  assert.equal(supervisorReads, 2);
});

test('backward injected-clock movement starts exactly one fresh shared supervisor read', async () => {
  const base = makeRead();
  let nowMs = T0 + 5_000;
  let supervisorReads = 0;
  const service = createProductIntegrationRuntime({
    read: Object.freeze({
      ...base,
      async supervisor() {
        supervisorReads += 1;
        return base.supervisor();
      },
    }),
    clock: { nowMs: () => nowMs },
  });

  const first = await service.readSupervisorShared();
  nowMs -= 1;
  const backwardLeft = service.readSupervisorShared();
  const backwardRight = service.readSupervisorShared();
  const [left, right] = await Promise.all([backwardLeft, backwardRight]);
  // contract updated 2026-08-06: stale-serve with background rebuild (owner-directed)
  // A negative cache age is treated as expiry, so it takes the same stale-serve
  // path: the prior cut is returned at once and one background refresh follows.
  assert.strictEqual(left, first, 'a negative cache age serves the prior cut without awaiting a rebuild');
  assert.strictEqual(right, first);
  for (let attempt = 0; attempt < 50 && service.readPublishedSupervisor() === first; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(supervisorReads, 2, 'negative cache age must start one fresh owner read');
  const republished = service.readPublishedSupervisor();
  assert.notStrictEqual(republished, first, 'the background refresh replaces the published cut');
  assert.equal(republished.evaluatedAtMs, T0 + 4_999);
});

test('slow supervisor builds publish their completion evaluation time and forward jumps refresh once', async () => {
  const base = makeRead();
  let nowMs = T0;
  let supervisorReads = 0;
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const service = createProductIntegrationRuntime({
    read: Object.freeze({
      ...base,
      async supervisor() {
        supervisorReads += 1;
        if (supervisorReads === 1) await firstGate;
        return base.supervisor();
      },
    }),
    clock: { nowMs: () => nowMs },
  });

  const pending = service.readSupervisorShared();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supervisorReads, 1);
  assert.equal(service.readPublishedSupervisor(), null);
  nowMs += 5_000;
  releaseFirst();
  const completed = await pending;
  assert.equal(completed.evaluatedAtMs, T0 + 5_000);
  assert.strictEqual(service.readPublishedSupervisor(), completed);

  nowMs += 999;
  assert.strictEqual(await service.readSupervisorShared(), completed);
  assert.equal(supervisorReads, 1);
  nowMs += 1;
  // contract updated 2026-08-06: stale-serve with background rebuild (owner-directed)
  const atTtl = await service.readSupervisorShared();
  assert.strictEqual(atTtl, completed, 'an expired read returns the stored cut without awaiting the slow build');
  for (let attempt = 0; attempt < 50 && service.readPublishedSupervisor() === completed; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(supervisorReads, 2);
  const afterTtlRefresh = service.readPublishedSupervisor();
  assert.notStrictEqual(afterTtlRefresh, completed, 'the background refresh replaces the published cut');

  nowMs += 5_000;
  const forwardLeft = service.readSupervisorShared();
  const forwardRight = service.readSupervisorShared();
  const [left, right] = await Promise.all([forwardLeft, forwardRight]);
  // contract updated 2026-08-06: stale-serve with background rebuild (owner-directed)
  assert.strictEqual(left, afterTtlRefresh, 'a forward jump beyond TTL serves the stored cut immediately');
  assert.strictEqual(right, afterTtlRefresh);
  for (let attempt = 0; attempt < 50 && supervisorReads < 3; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(supervisorReads, 3, 'a forward jump beyond TTL must start one fresh owner read');
});

test('non-finite injected clocks fail closed without replacing completed supervisor evidence', async () => {
  const base = makeRead();
  let nowMs = T0;
  let supervisorReads = 0;
  const service = createProductIntegrationRuntime({
    read: Object.freeze({
      ...base,
      async supervisor() {
        supervisorReads += 1;
        return base.supervisor();
      },
    }),
    clock: { nowMs: () => nowMs },
  });

  const completed = await service.readSupervisorShared();
  for (const invalidNowMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    nowMs = invalidNowMs;
    await assert.rejects(
      Promise.resolve().then(() => service.readSupervisorShared()),
      (error) => error?.code === 'CLOCK_INVALID',
    );
    assert.equal(supervisorReads, 1, `invalid clock ${String(invalidNowMs)} must not reach an owner read`);
    assert.strictEqual(service.readPublishedSupervisor(), completed);
  }
});

test('failed shared supervisor refresh preserves publication and permits next-call retry', async () => {
  const base = makeRead();
  let nowMs = T0;
  let supervisorReads = 0;
  let failRefresh = false;
  const service = createProductIntegrationRuntime({
    read: Object.freeze({
      ...base,
      async supervisor() {
        supervisorReads += 1;
        if (failRefresh) throw new Error('hostile refresh failure');
        return base.supervisor();
      },
    }),
    clock: { nowMs: () => nowMs },
  });

  const completed = await service.readSupervisorShared();
  nowMs += 1_000;
  failRefresh = true;
  // contract updated 2026-08-06: stale-serve with background rebuild (owner-directed)
  // The first expired call is served the stored cut and starts the refresh that
  // will fail; only once that failure is recorded does the read fail closed.
  assert.strictEqual(await service.readSupervisorShared(), completed, 'the first expired call serves the stored cut');
  for (let attempt = 0; attempt < 50 && supervisorReads < 2; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(supervisorReads, 2);
  assert.strictEqual(service.readPublishedSupervisor(), completed);

  // contract updated 2026-08-06: stale-serve with background rebuild (owner-directed)
  // A recorded build failure is never masked by the previous success.
  await assert.rejects(
    service.readSupervisorShared(),
    (error) => error?.code === 'PRODUCT_READ_MODEL_UNAVAILABLE',
  );
  assert.strictEqual(service.readPublishedSupervisor(), completed);

  failRefresh = false;
  // contract updated 2026-08-06: stale-serve with background rebuild (owner-directed)
  // Each failing call schedules a fresh attempt, so service restores itself.
  let retry = null;
  for (let attempt = 0; attempt < 200 && retry === null; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    try { retry = await service.readSupervisorShared(); } catch { retry = null; }
  }
  assert.ok(retry, 'a later successful build restores service');
  assert.notStrictEqual(retry, completed);
  assert.strictEqual(service.readPublishedSupervisor(), retry);
});

test('frozen product-integration v1 routes enforce identity, exact paths, and query bounds', { concurrency: false }, async () => {
  const service = createProductIntegrationRuntime({ read: makeRead(), clock: { nowMs: () => T0 } });
  const app = express();
  app.use(express.json({ limit: '192kb', strict: true }));
  app.use((req, res, next) => {
    if (req.headers['x-test-no-operator'] !== '1') res.locals.operator = { id: 'local-operator', email: null, source: 'loopback' };
    next();
  });
  app.use('/api/product-integration', createProductIntegrationRuntimeRouter(service));
  const server = http.createServer(app);
  const base = await listen(server);
  const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(5_000) });
  try {
    const supervisor = await request('/api/product-integration/v1/supervisor');
    assert.equal(supervisor.status, 200);
    const supervisorBody = await supervisor.json();
    assert.equal(supervisorBody.schemaVersion, 'product-supervisor.v1');
    assert.equal(supervisorBody.materialEvents.mode, 'TAIL_BOOTSTRAP');
    assert.equal(supervisorBody.incidentAvailability.state, 'NOT_CONFIGURED');

    const oldPath = await request('/api/product-integration/supervisor');
    assert.equal(oldPath.status, 404);

    const unauthenticated = await request('/api/product-integration/v1/supervisor', { headers: { 'x-test-no-operator': '1' } });
    assert.equal(unauthenticated.status, 401);
    assert.equal((await unauthenticated.json()).code, 'OPERATOR_REQUIRED');

    const events = await request('/api/product-integration/v1/material-events?afterCursor=0&limit=200');
    assert.equal(events.status, 200);
    const eventBody = await events.json();
    assert.equal(eventBody.mode, 'CURSOR');
    assert.equal(eventBody.continuity, 'PROVEN');
    assert.equal(eventBody.retainedFromCursor, '1');
    assert.equal(eventBody.highWaterCursor, '2');
    assert.equal(eventBody.hasMore, false);
    assert.equal(eventBody.missingRange, null);
    for (const query of ['afterCursor=x&limit=200', 'afterCursor=0&limit=0', 'afterCursor=0&limit=501', 'afterCursor=0&limit=1.5', 'afterCursor=0&limit=2&url=https://evil.example']) {
      const response = await request(`/api/product-integration/v1/material-events?${query}`);
      assert.equal(response.status, 400, query);
    }
    const maxCursor = await request('/api/product-integration/v1/material-events?afterCursor=9223372036854775807&limit=1');
    assert.equal(maxCursor.status, 200);
    for (const afterCursor of ['9223372036854775808', '999999999999999999999999999999999999999']) {
      const response = await request(`/api/product-integration/v1/material-events?afterCursor=${afterCursor}&limit=1`);
      assert.equal(response.status, 400, afterCursor);
      assert.equal((await response.json()).code, 'INVALID_PRODUCT_QUERY');
    }

    const trace = await request('/api/product-integration/v1/traces/cor_trace_1?limit=200');
    assert.equal(trace.status, 200);
    const traceBody = await trace.json();
    assert.equal(traceBody.stages.length, 12);
    assert.equal(traceBody.truncated, false);
    assert.equal(traceBody.completeness, 'COMPLETE');
    const absent = await request('/api/product-integration/v1/traces/cor_absent');
    assert.equal(absent.status, 404);
    const hostile = await request('/api/product-integration/v1/traces/%2E%2E%2Fsecret');
    assert.equal(hostile.status, 400);

    const preview = await request('/api/product-integration/v1/commands/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ controlId: 'global.safe-mode.read-only', expectedRevision: '3' }),
    });
    assert.equal(preview.status, 409);
    assert.equal((await preview.json()).code, 'CONTROL_NOT_CONFIGURED');

    const forgedPreview = await request('/api/product-integration/v1/commands/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ controlId: 'global.safe-mode.read-only', expectedRevision: '3', operator: 'browser-forged' }),
    });
    assert.equal(forgedPreview.status, 400);
    assert.equal((await forgedPreview.json()).code, 'CONTROL_PREVIEW_INVALID');

    const incidentTargetId = 'incident.product.route-shape';
    const incidentControlId = productIncidentAcknowledgementControlId(incidentTargetId);
    const incidentPreview = await request('/api/product-integration/v1/commands/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ controlId: incidentControlId, expectedRevision: '17', targetId: incidentTargetId }),
    });
    assert.equal(incidentPreview.status, 503,
      'the exact incident preview shape fails closed when the canonical incident router is missing');
    assert.equal((await incidentPreview.json()).code, 'INCIDENT_ROUTER_UNAVAILABLE');
    const missingIncidentTarget = await request('/api/product-integration/v1/commands/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ controlId: incidentControlId, expectedRevision: '17' }),
    });
    assert.equal(missingIncidentTarget.status, 400);
    assert.equal((await missingIncidentTarget.json()).code, 'CONTROL_PREVIEW_INVALID');
    const crossIncidentTarget = await request('/api/product-integration/v1/commands/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ controlId: incidentControlId, expectedRevision: '17', targetId: 'incident.product.other' }),
    });
    assert.equal(crossIncidentTarget.status, 400);
    assert.equal((await crossIncidentTarget.json()).code, 'CONTROL_PREVIEW_INVALID');

    const noContentType = await request('/api/product-integration/v1/commands', { method: 'POST', body: '{}' });
    assert.equal(noContentType.status, 415);

    const commandId = `sysctrl_${'a'.repeat(64)}`;
    const resultQuery = `idempotencyKey=product.result.lookup.0001&controlId=global.safe-mode.read-only`;
    const unauthenticatedResult = await request(
      `/api/product-integration/v1/commands/${commandId}/result?${resultQuery}`,
      { headers: { 'x-test-no-operator': '1' } },
    );
    assert.equal(unauthenticatedResult.status, 401);
    const hostileResultQuery = await request(
      `/api/product-integration/v1/commands/${commandId}/result?${resultQuery}&url=https://evil.example`,
    );
    assert.equal(hostileResultQuery.status, 400);
    assert.equal((await hostileResultQuery.json()).code, 'INVALID_COMMAND_RESULT_QUERY');
    const malformedResult = await request(
      `/api/product-integration/v1/commands/not-a-command/result?${resultQuery}`,
    );
    assert.equal(malformedResult.status, 400);
    const unconfiguredResult = await request(
      `/api/product-integration/v1/commands/${commandId}/result?${resultQuery}`,
    );
    assert.equal(unconfiguredResult.status, 409);
    assert.equal((await unconfiguredResult.json()).code, 'COMMAND_RESULT_NOT_CONFIGURED');
  } finally {
    await close(server);
  }
});

test('command-result route preserves NOT_FOUND, PENDING, terminal, and fail-closed owner states', { concurrency: false }, async () => {
  const result = (identity, status) => Object.freeze({
    commandId: identity.commandId,
    controlId: identity.controlId,
    status,
    before: '{"revision":0}',
    after: '{"revision":1}',
    receiptId: 'ledger-event:7',
    correlationId: 'product.control.test',
    completedAtMs: T0,
    synthetic: false,
  });
  const commandOwner = Object.freeze({
    capability: Object.freeze({
      ownerId: 'systemIntegration.canonical-control-service',
      supportedBackendCommandIds: Object.freeze(['SET_SAFE_MODE', 'SET_KILL_SWITCH', 'SET_INTAKE_PAUSED', 'RESTART_COMPONENT']),
      serverDerivedActor: true,
      durableIdempotency: true,
      revisionCompareAndSet: true,
      durableReceipts: true,
      managedRestartComponentId: 'engine-supervisor',
    }),
    async preview() { throw new Error('not used'); },
    async submit() { throw new Error('not used'); },
    async readResult(identity) {
      if (identity.idempotencyKey.includes('.pending.')) {
        return Object.freeze({ state: 'PENDING', result: result(identity, 'ACCEPTED_ASYNC'), failureCode: null });
      }
      if (identity.idempotencyKey.includes('.terminal.')) {
        return Object.freeze({ state: 'TERMINAL', result: result(identity, 'APPLIED'), failureCode: null });
      }
      if (identity.idempotencyKey.includes('.uncertain.')) {
        return Object.freeze({ state: 'FAIL_CLOSED', result: result(identity, 'FAILED_ATTENTION_REQUIRED'), failureCode: 'COMMAND_RUNTIME_PUBLICATION_UNKNOWN' });
      }
      if (identity.idempotencyKey.includes('.forged.')) {
        return Object.freeze({ state: 'FAIL_CLOSED', result: null, failureCode: 'COMMAND_RESULT_IDENTITY_MISMATCH' });
      }
      return Object.freeze({ state: 'NOT_FOUND', result: null, failureCode: null });
    },
  });
  const service = createProductIntegrationRuntime({
    read: makeRead(), clock: { nowMs: () => T0 }, commandOwner,
  });
  const app = express();
  app.use((_, res, next) => {
    res.locals.operator = { id: 'local-operator', email: null, source: 'loopback' };
    next();
  });
  app.use('/api/product-integration', createProductIntegrationRuntimeRouter(service));
  const server = http.createServer(app);
  const base = await listen(server);
  const commandId = `sysctrl_${'b'.repeat(64)}`;
  const get = (key) => fetch(
    `${base}/api/product-integration/v1/commands/${commandId}/result?idempotencyKey=${key}&controlId=global.safe-mode.read-only`,
    { signal: AbortSignal.timeout(5_000) },
  );
  try {
    const pending = await get('result.pending.0001');
    assert.equal(pending.status, 202);
    assert.equal((await pending.json()).status, 'ACCEPTED_ASYNC');
    const terminal = await get('result.terminal.0001');
    assert.equal(terminal.status, 200);
    assert.equal((await terminal.json()).status, 'APPLIED');
    const absent = await get('result.absent.0001');
    assert.equal(absent.status, 404);
    assert.equal((await absent.json()).code, 'COMMAND_RESULT_NOT_FOUND');
    const uncertain = await get('result.uncertain.0001');
    assert.equal(uncertain.status, 503);
    assert.equal((await uncertain.json()).status, 'FAILED_ATTENTION_REQUIRED');
    const forged = await get('result.forged.0001');
    assert.equal(forged.status, 404);
    assert.equal((await forged.json()).code, 'COMMAND_RESULT_NOT_FOUND');
  } finally {
    await close(server);
  }
});

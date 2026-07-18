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
    assert.equal(incidentPreview.status, 409, 'the exact incident preview shape reaches owner configuration');
    assert.equal((await incidentPreview.json()).code, 'CONTROL_NOT_CONFIGURED');
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

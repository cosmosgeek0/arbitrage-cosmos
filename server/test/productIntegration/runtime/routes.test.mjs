import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createProductIntegrationRuntime, createProductIntegrationRuntimeRouter } from '../../../dist/productIntegration/runtime/index.js';
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

    const noContentType = await request('/api/product-integration/v1/commands', { method: 'POST', body: '{}' });
    assert.equal(noContentType.status, 415);
  } finally {
    await close(server);
  }
});

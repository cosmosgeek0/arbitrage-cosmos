import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import test from 'node:test';

import { createM0SpotRuntimeMount } from '../../../dist/systemIntegration/production/m0SpotRuntime.js';
import { OperatorAccess } from '../../../dist/security/access.js';
import {
  createSystemIntegrationRouter,
} from '../../../dist/systemIntegration/routes/index.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function unused(name) {
  return () => {
    throw new Error(`${name} must stay unused`);
  };
}

async function json(response) {
  return response.json();
}

test('one exact owner-YES route reaches only the closed M0 source mount', async () => {
  const runtime = createM0SpotRuntimeMount();
  const invocations = [];
  const router = createSystemIntegrationRouter({
    read: {
      supervisor: unused('supervisor'),
      graph: unused('graph'),
      events: unused('events'),
      controls: unused('controls read'),
      focusPin: unused('focus pin'),
      trace: unused('trace'),
    },
    controls: {
      mutate: unused('control mutation'),
      auditRejectedRequest: unused('control audit'),
      snapshot: unused('control snapshot'),
    },
    validateOnly: { executeValidateOnly: unused('validate-only') },
    m0SpotCanary: {
      async inspectSourceMount(input) {
        invocations.push(input);
        return runtime.inspectSourceMount(input);
      },
    },
    clock: { nowMs: unused('clock') },
    opsReadback: { read: unused('ops readback') },
  });
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '192kb', strict: true }));
  app.use('/api', new OperatorAccess().middleware());
  app.use('/api/system-integration', router);
  app.use((error, _req, res, _next) => {
    res.status(error?.type === 'entity.parse.failed' ? 400 : 500).json({
      ok: false,
      code: error?.type === 'entity.parse.failed' ? 'INVALID_JSON' : 'INTERNAL_ERROR',
    });
  });
  const server = http.createServer(app);
  const base = await listen(server);
  const route = `${base}/api/system-integration/m0/spot-canary`;
  const post = (body, headers = {}, suffix = '') => fetch(`${route}${suffix}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'm0.route.0001',
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });

  try {
    const rejected = [
      await fetch(route, { method: 'POST', signal: AbortSignal.timeout(5_000) }),
      await post({ ownerConfirmation: 'YES' }, { 'content-type': 'text/plain' }),
      await post({ ownerConfirmation: 'YES' }, { 'idempotency-key': '' }),
      await post({ ownerConfirmation: 'YES' }, { 'idempotency-key': 'short' }),
      await post({}),
      await post({ ownerConfirmation: 'yes' }),
      await post({ ownerConfirmation: true }),
      await post({ ownerConfirmation: 'YES', symbol: 'BTCUSDT' }),
      await post({ ownerConfirmation: 'YES' }, {}, '?refresh=1'),
      await post(
        { ownerConfirmation: 'YES' },
        { 'sec-fetch-site': 'cross-site' },
      ),
    ];
    assert.deepEqual(
      rejected.map((response) => response.status),
      [415, 415, 400, 400, 400, 400, 400, 400, 400, 401],
    );
    assert.equal(invocations.length, 0);

    const accepted = await post({ ownerConfirmation: 'YES' });
    assert.equal(accepted.status, 409);
    const body = await json(accepted);
    assert.equal(body.schema, 'cosmos.system-integration.m0-spot-canary-route.v1');
    assert.equal(body.code, 'M0_SOURCE_MOUNT_BLOCKED');
    assert.equal(body.state, 'SOURCE_MOUNTED_NOT_ACTIVATED');
    assert.equal(body.sourceMounted, true);
    assert.equal(body.runtimeActivated, false);
    assert.equal(body.hostProvisioned, false);
    assert.equal(body.liveExecutionPermitted, false);
    assert.equal(body.maximumOrderNotionalQuote, '10');
    assert.equal(body.ownerConfirmation, 'ACKNOWLEDGED_NOT_AUTHORITY');
    assert.equal(body.ticketAuthority, 'NONE');
    assert.equal(body.authorityConsumption, 'NOT_ATTEMPTED');
    assert.equal(body.executionKeyPermissions, 'NOT_PROVED');
    assert.equal(body.signedTransport, 'HARD_DENY_NOT_CONFIGURED');
    assert.equal(body.withdrawalPolicy, 'DISABLED');
    assert.equal(body.transferPolicy, 'DISABLED');
    assert.equal(body.flat, 'NOT_PROVED');
    assert.equal(body.reconciliation, 'NOT_PROVED');
    assert.equal(body.disarm, 'NOT_PROVED');
    assert.equal(body.coordinator.status, 'BLOCKED');
    assert.deepEqual(body.coordinator.reasonCodes, [
      'KILL_SWITCH_ENGAGED_OR_UNKNOWN',
    ]);
    assert.deepEqual(body.coordinator.calls, {
      admissions: 1,
      signedTests: 0,
      authorityConsumptions: 0,
      submits: 0,
      orderQueries: 0,
      fillQueries: 0,
      cancels: 0,
      flattens: 0,
      ledgerAppends: 0,
    });
    assert.equal(body.inertEvidenceReceipt.disposition, 'NOT_PROVED');
    assert.equal(body.inertEvidenceReceipt.mode, 'VALIDATE_ONLY');
    assert.equal(body.inertEvidenceReceipt.liveCanaryProven, false);
    assert.equal(body.inertEvidenceReceipt.moneyMovementProven, false);
    assert.equal(invocations.length, 1);
    assert.match(invocations[0].requestId, /^m0_req_[0-9a-f]{32}$/u);
    assert.equal(invocations[0].ownerConfirmation, 'YES');
    assert.equal(invocations[0].operator.id, 'local-operator');

    const repeated = await Promise.all([
      post({ ownerConfirmation: 'YES' }, { 'idempotency-key': 'm0.route.0002' }),
      post({ ownerConfirmation: 'YES' }, { 'idempotency-key': 'm0.route.0002' }),
    ]);
    assert.deepEqual(repeated.map((response) => response.status), [409, 409]);
    assert.equal(invocations.length, 3);
    assert.equal(invocations[1].requestId, invocations[2].requestId);

    const alias = await fetch(
      `${base}/api/system-integration/m0/spot-canary/send`,
      { method: 'POST', signal: AbortSignal.timeout(5_000) },
    );
    assert.equal(alias.status, 404);
  } finally {
    await close(server);
  }
});

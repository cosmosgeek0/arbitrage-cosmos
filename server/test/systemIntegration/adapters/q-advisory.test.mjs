import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  EDGE_PROTOCOL_COMMIT,
  EDGE_PROTOCOL_SCHEMA_SHA256,
} from '../../../dist/productIntegration/adapters/qProtocol.js';
import {
  ProductionQAdvisoryRuntime,
  Q_ADVISORY_EXPECTED_REMOTE_COMPONENT_ID,
  Q_ADVISORY_SAFE_FALLBACK,
  projectNotConfiguredQAdvisoryComponent,
} from '../../../dist/systemIntegration/adapters/qAdvisory.js';
import { validateSystemComponentSnapshot } from '../../../dist/systemIntegration/contracts/validation.js';

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);

class ManualClock {
  constructor(nowMs = NOW) {
    this.value = nowMs;
  }

  nowMs() {
    return this.value;
  }
}

function handshake(over = {}) {
  return {
    protocolCommit: EDGE_PROTOCOL_COMMIT,
    protocolVersion: 1,
    schemaSha256: EDGE_PROTOCOL_SCHEMA_SHA256,
    producerBuild: 'q16-accepted-build',
    championModelVersion: 'q16-model-accepted',
    ...over,
  };
}

function bridgeSnapshot(over = {}) {
  const queue = {
    capacity: 16,
    maximumEntryBytes: 262_144,
    maximumRetainedBytes: 4_194_304,
    retainedBytes: 0,
    highWatermarkRetainedBytes: 0,
    depth: 0,
    highWatermark: 0,
    enqueuedCount: 0,
    dequeuedCount: 0,
    droppedCount: 0,
    coalescedCount: 0,
    overflowCount: 0,
    oversizeDropCount: 0,
    resyncRequired: false,
    ...(over.queue ?? {}),
  };
  const transport = {
    state: 'CONNECTED',
    observedAtMs: NOW - 20,
    requestStartedAtMs: NOW - 25,
    requestCompletedAtMs: NOW - 20,
    reasonCode: 'TRANSPORT_CONNECTED',
    ...(over.transport ?? {}),
  };
  const remoteBrain = {
    componentId: Q_ADVISORY_EXPECTED_REMOTE_COMPONENT_ID,
    state: 'OK',
    generatedAtMs: NOW - 50,
    ageMs: 50,
    truthLabel: 'SYNTHETIC',
    driftState: 'STABLE',
    blockingReasonCount: 0,
    modelVersionCount: 1,
    ...(over.remoteBrain ?? {}),
  };
  return {
    adapterPolicy: 'L_ADAPTER_POLICY_V1',
    state: 'RUNNING',
    advisoryReady: true,
    researchRecordingReady: false,
    reasonCodes: [],
    queue,
    identities: {},
    transport,
    remoteBrain,
    recording: {},
    counters: {},
    ...over,
    queue,
    transport,
    remoteBrain,
  };
}

function ctx(nowMs = NOW) {
  return {
    nowMs,
    generation: 1,
    correlationId: 'q-advisory-test',
    runMode: 'INTELLIGENCE',
    privateKeysAvailable: false,
  };
}

test('default production mount is inert and explicitly NOT_CONFIGURED/ABSTAIN_UNKNOWN', async () => {
  const clock = new ManualClock();
  const runtime = new ProductionQAdvisoryRuntime(clock);

  assert.equal(runtime.readQAdvisoryStatus().runtimeState, 'STOPPED');
  assert.equal(runtime.readComponentSnapshot().readiness, 'STOPPED');
  await runtime.start();

  const status = runtime.readQAdvisoryStatus();
  assert.equal(status.runtimeState, 'NOT_CONFIGURED');
  assert.equal(status.advisoryAction, Q_ADVISORY_SAFE_FALLBACK);
  assert.equal(status.clientState, 'NOT_CONFIGURED');
  assert.equal(status.transportState, 'NOT_CONFIGURED');
  assert.equal(status.ownerObservationState, 'NOT_CONFIGURED');
  assert.deepEqual(status.blockerCodes, [
    'Q_CLIENT_NOT_CONFIGURED',
    'Q_TRANSPORT_NOT_CONFIGURED',
    'Q_OWNER_OBSERVATION_NOT_CONFIGURED',
    'Q_SAFE_FALLBACK_ABSTAIN_UNKNOWN',
  ]);

  const component = runtime.readComponentSnapshot();
  assert.deepEqual(validateSystemComponentSnapshot(component), []);
  assert.equal(component.componentId, 'q-inference');
  assert.equal(component.owner, 'Q_INFERENCE');
  assert.equal(component.truthLabel, 'UNAVAILABLE');
  assert.equal(component.authority, 'UNAVAILABLE');
  assert.equal(component.readiness, 'BLOCKED');
  assert.equal(component.capitalExposed, false);
  assert.ok(component.releaseStatuses.includes('NOT_CONFIGURED'));
  const lifecycle = runtime.health(ctx());
  assert.equal(lifecycle.running, true);
  assert.equal(lifecycle.fatal.code, 'Q_CLIENT_NOT_CONFIGURED');
  assert.equal(runtime.readComponentSnapshot().readiness, 'BLOCKED');
});

test('omitted production Q binding has one validator-clean passive blocked projection', () => {
  const component = projectNotConfiguredQAdvisoryComponent(NOW);
  assert.deepEqual(validateSystemComponentSnapshot(component), []);
  assert.equal(component.componentId, 'q-inference');
  assert.equal(component.phase, 'BLOCKED');
  assert.equal(component.domainObservedState, 'ABSTAIN_UNKNOWN');
  assert.equal(component.readiness, 'BLOCKED');
  assert.equal(component.truthLabel, 'UNAVAILABLE');
  assert.equal(component.authority, 'UNAVAILABLE');
  assert.equal(component.completeness, 'UNAVAILABLE');
  assert.equal(component.lastFailure, null);
  assert.deepEqual(component.blockerCodes, [
    'Q_CLIENT_NOT_CONFIGURED',
    'Q_TRANSPORT_NOT_CONFIGURED',
    'Q_OWNER_OBSERVATION_NOT_CONFIGURED',
    'Q_SAFE_FALLBACK_ABSTAIN_UNKNOWN',
  ]);
});

test('protocol mismatch is rejected before any L01 bridge observation', async () => {
  let bridgeReads = 0;
  const runtime = new ProductionQAdvisoryRuntime(new ManualClock(), {
    readHandshake: () => handshake({ schemaSha256: 'f'.repeat(64) }),
    readBridgeSnapshot: () => {
      bridgeReads += 1;
      return bridgeSnapshot();
    },
  });
  await runtime.start();

  const status = runtime.readQAdvisoryStatus();
  assert.equal(status.runtimeState, 'INCOMPATIBLE');
  assert.equal(status.clientState, 'INCOMPATIBLE');
  assert.ok(status.blockerCodes.includes('PROTOCOL_SCHEMA_MISMATCH'));
  assert.equal(status.advisoryAction, 'ABSTAIN_UNKNOWN');
  assert.equal(bridgeReads, 0);
  assert.notEqual(runtime.health(ctx()).fatal, null);
});

test('unavailable champion fails closed without reading or dispatching bridge work', async () => {
  let bridgeReads = 0;
  const runtime = new ProductionQAdvisoryRuntime(new ManualClock(), {
    readHandshake: () => handshake({ championModelVersion: null }),
    readBridgeSnapshot: () => {
      bridgeReads += 1;
      return bridgeSnapshot();
    },
  });
  await runtime.start();

  const status = runtime.readQAdvisoryStatus();
  assert.equal(status.runtimeState, 'UNAVAILABLE');
  assert.ok(status.blockerCodes.includes('CHAMPION_UNAVAILABLE'));
  assert.equal(status.advisoryAction, 'ABSTAIN_UNKNOWN');
  assert.equal(bridgeReads, 0);
});

test('stale compatible bridge preserves bounded queue evidence but cannot become advisory-ready', async () => {
  const runtime = new ProductionQAdvisoryRuntime(new ManualClock(), {
    readHandshake: () => handshake(),
    readBridgeSnapshot: () => bridgeSnapshot({
      state: 'STALE',
      advisoryReady: false,
      reasonCodes: ['REMOTE_HEALTH_STALE'],
      queue: { depth: 3, droppedCount: 2, coalescedCount: 1 },
    }),
  });
  await runtime.start();

  const status = runtime.readQAdvisoryStatus();
  assert.equal(status.runtimeState, 'STALE');
  assert.equal(status.clientState, 'COMPATIBLE');
  assert.equal(status.transportState, 'CONNECTED');
  assert.equal(status.transportObservedAtMs, NOW - 20);
  assert.deepEqual(status.queue, {
    depth: 3,
    capacity: 16,
    dropped: 2,
    coalesced: 1,
    observedAtMs: NOW,
  });
  assert.ok(status.blockerCodes.includes('Q_ADVISORY_STALE'));
  assert.ok(status.blockerCodes.includes('Q_ADVISORY_NOT_READY'));
  assert.ok(status.blockerCodes.includes('Q_OWNER_OBSERVATION_NOT_CONFIGURED'));
  assert.equal(status.advisoryAction, 'ABSTAIN_UNKNOWN');

  const component = runtime.readComponentSnapshot();
  assert.equal(component.phase, 'DEGRADED');
  assert.equal(component.readiness, 'DEGRADED');
  assert.equal(component.authority, 'UNAVAILABLE');
  assert.deepEqual(validateSystemComponentSnapshot(component), []);
});

test('even a compatible RUNNING bridge remains owner-NOT_CONFIGURED and has no strategy authority', async () => {
  const runtime = new ProductionQAdvisoryRuntime(new ManualClock(), {
    readHandshake: () => handshake(),
    readBridgeSnapshot: () => bridgeSnapshot(),
  });
  await runtime.start();

  const status = runtime.readQAdvisoryStatus();
  assert.equal(status.runtimeState, 'NOT_CONFIGURED');
  assert.equal(status.bridgeState, 'RUNNING');
  assert.equal(status.ownerObservationState, 'NOT_CONFIGURED');
  assert.deepEqual(status.blockerCodes, [
    'Q_OWNER_OBSERVATION_NOT_CONFIGURED',
    'Q_SAFE_FALLBACK_ABSTAIN_UNKNOWN',
  ]);
  assert.equal(status.advisoryAction, 'ABSTAIN_UNKNOWN');
  assert.equal(runtime.readComponentSnapshot().readiness, 'BLOCKED');
});

test('malformed or throwing owner evidence is sanitized to unavailable without raw error leakage', async () => {
  for (const binding of [
    {
      readHandshake: () => { throw new Error('secret raw handshake'); },
      readBridgeSnapshot: () => bridgeSnapshot(),
    },
    {
      readHandshake: () => handshake(),
      readBridgeSnapshot: () => ({ ...bridgeSnapshot(), advisoryReady: 'yes' }),
    },
  ]) {
    const runtime = new ProductionQAdvisoryRuntime(new ManualClock(), binding);
    await runtime.start();
    const status = runtime.readQAdvisoryStatus();
    assert.ok(['INCOMPATIBLE', 'UNAVAILABLE'].includes(status.runtimeState));
    assert.equal(JSON.stringify(status).includes('secret raw handshake'), false);
    assert.equal(status.advisoryAction, 'ABSTAIN_UNKNOWN');
  }
});

test('adapter source has no egress, ambient config, timer, fixture, or money-path dependency', () => {
  const source = readFileSync(new URL('../../../src/systemIntegration/adapters/qAdvisory.ts', import.meta.url), 'utf8');
  for (const forbidden of [
    /from\s+['"]node:(?:net|http|https|tls|dgram|child_process|worker_threads|fs)/,
    /process\.env/,
    /\bsetTimeout\s*\(/,
    /\bsetInterval\s*\(/,
    /Math\.random\s*\(/,
    /\/fixtures\//,
    /engine\/(?:basis|volume)/,
    /capitalFoundation/,
    /foundation\/(?:risk|execution|reconciliation)/,
    /readinessPolicy/,
    /READINESS-CLUSTER-001/,
    /binance/i,
    /ledger/i,
  ]) assert.equal(forbidden.test(source), false, `forbidden Q adapter dependency ${forbidden}`);

  const methods = Object.getOwnPropertyNames(ProductionQAdvisoryRuntime.prototype);
  assert.equal(methods.some((name) => /order|ticket|capital|risk|approve|execute|borrow|repay|transfer|withdraw|dispatch|ingest/i.test(name)), false);
});

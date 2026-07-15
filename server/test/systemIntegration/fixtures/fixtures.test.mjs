import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  BoundedInMemoryLedger,
  EgressTripwire,
  InMemoryControlPersistence,
  InMemoryValidateOnlyPersistence,
  ManualClock,
  ManualScheduler,
  SealedDryRunVenueJournal,
  assertExactlyOnce,
  assertScenario,
  scenarioTestName,
} from './index.mjs';

const T0 = 1_780_000_000_000;

function controlState(overrides = {}) {
  return {
    revision: 0,
    generation: 1,
    safeMode: 'READ_ONLY',
    killSwitchEngaged: false,
    intakePaused: false,
    updatedAtMs: T0,
    correlationId: 'cor_fixture_initial',
    ...overrides,
  };
}

test('fixture barrel import is inert until a helper is explicitly installed or called', () => {
  const moduleUrl = new URL('./index.mjs', import.meta.url).href;
  const script = `
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    const http = require('node:http');
    const https = require('node:https');
    const net = require('node:net');
    const tls = require('node:tls');
    const originals = {
      fetch: globalThis.fetch,
      WebSocket: globalThis.WebSocket,
      httpRequest: http.request,
      httpsRequest: https.request,
      netConnect: net.connect,
      tlsConnect: tls.connect,
      setTimeout: globalThis.setTimeout,
      setInterval: globalThis.setInterval,
    };
    let timerAttempts = 0;
    globalThis.fetch = () => { throw new Error('fetch at import'); };
    globalThis.WebSocket = class { constructor() { throw new Error('websocket at import'); } };
    globalThis.setTimeout = () => { timerAttempts += 1; throw new Error('timeout at import'); };
    globalThis.setInterval = () => { timerAttempts += 1; throw new Error('interval at import'); };
    await import(${JSON.stringify(moduleUrl)});
    if (timerAttempts !== 0) throw new Error('fixture import scheduled ambient work');
    if (http.request !== originals.httpRequest || https.request !== originals.httpsRequest) throw new Error('fixture import patched HTTP');
    if (net.connect !== originals.netConnect || tls.connect !== originals.tlsConnect) throw new Error('fixture import patched sockets');
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    timeout: 3_000,
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test('manual clock and scheduler advance deterministically without ambient timers', () => {
  const clock = new ManualClock(T0);
  const scheduler = new ManualScheduler(clock);
  const observed = [];
  const scheduled = scheduler.scheduleEvery(10, () => observed.push(clock.nowMs()));

  assert.equal(scheduler.advanceAndRun(9), 0);
  assert.equal(scheduler.advanceAndRun(1), 1);
  assert.equal(scheduler.advanceAndRun(20), 2);
  assert.deepEqual(observed, [T0 + 10, T0 + 30, T0 + 30]);
  assert.equal(scheduler.snapshot().executionCount, 3);
  scheduled.cancel();
  assert.equal(scheduler.snapshot().activeTaskCount, 0);
  assert.throws(() => clock.set(T0), /cannot move backwards/);
});

test('bounded memory ledger atomically couples config and audit truth', () => {
  const clock = new ManualClock(T0);
  const ledger = new BoundedInMemoryLedger(clock, { maximumEvents: 2, maximumConfigEntries: 2 });
  const event = ledger.setConfigValueAndLogEvent(
    'system.integration.checkpoint.v1',
    '{"revision":1}',
    'system.integration.trace',
    null,
    { correlationId: 'cor_fixture_ledger', disposition: 'READY' },
  );
  assert.equal(event.id, 1);
  assert.equal(event.ts, T0);
  assert.equal(ledger.getConfigValue('system.integration.checkpoint.v1'), '{"revision":1}');
  assert.equal(ledger.recentEvents(10, 'system.integration.trace').length, 1);
  assert.equal(Object.isFrozen(event.data), true);
  assert.throws(() => { event.data.disposition = 'MUTATED'; }, TypeError);

  clock.advance(1);
  ledger.logEvent('system.control.transition', null, { correlationId: 'cor_fixture_control' });
  assert.deepEqual(ledger.recentEvents(10).map((entry) => entry.id), [2, 1]);
  assert.deepEqual(ledger.recentEvents(10, undefined, undefined, undefined, undefined, undefined, undefined, 0, 1).map((entry) => entry.id), [2]);
  assert.throws(
    () => ledger.setConfigValueAndLogEvent('uncommitted', 'value', 'system.integration.trace'),
    /event capacity exceeded/,
  );
  assert.equal(ledger.getConfigValue('uncommitted'), null);
});

test('control persistence enforces revision and idempotency with one ledger row', async () => {
  const clock = new ManualClock(T0);
  const ledger = new BoundedInMemoryLedger(clock);
  const initial = controlState();
  const persistence = new InMemoryControlPersistence(ledger, initial);
  const commit = {
    request: {
      idempotencyKey: 'fixture-control-0001',
      expectedRevision: 0,
      reason: 'Exercise deterministic persistence.',
      requestedAtMs: T0 + 1,
      correlationId: 'cor_fixture_mutation',
      mutation: { command: 'SET_INTAKE_PAUSED', paused: true },
    },
    actor: { id: 'operator:fixture', email: null, source: 'loopback' },
    requestDigest: 'a'.repeat(64),
    before: initial,
    after: controlState({
      revision: 1,
      intakePaused: true,
      updatedAtMs: T0 + 1,
      correlationId: 'cor_fixture_mutation',
    }),
    applied: true,
    code: 'CONTROL_APPLIED',
  };

  const first = await persistence.commitControlMutation(commit);
  const replay = await persistence.commitControlMutation(commit);
  const conflict = await persistence.commitControlMutation({ ...commit, requestDigest: 'b'.repeat(64) });
  assert.equal(first.kind, 'COMMITTED');
  assert.equal(replay.kind, 'IDEMPOTENT_REPLAY');
  assert.equal(conflict.kind, 'IDEMPOTENCY_CONFLICT');
  assert.equal(first.receipt.ledgerEventId, 1);
  assert.equal(ledger.countEvents('system.control.transition'), 1);
  assertExactlyOnce('FIXTURE-CONTROL', 'MATERIAL_TRANSITION_EXACTLY_ONCE', ledger.eventsSnapshot(), (event) => event.id === 1);
});

test('validate-only persistence is bounded and idempotent by recordId', async () => {
  const clock = new ManualClock(T0);
  const ledger = new BoundedInMemoryLedger(clock);
  const persistence = new InMemoryValidateOnlyPersistence(ledger);
  const record = {
    schema: 'cosmos.system-integration.validate-only.v2',
    recordId: 'validate-record-1',
    rootCorrelationId: 'cor_validate_record_1',
    operatorMode: 'VALIDATE_ONLY',
    liveExecutionPermitted: false,
    disposition: 'DRY_RUN_PLAN_READY',
    canonical: { proposalId: 'basis-proposal-1' },
    capital: null,
    approval: null,
    risk: { allowed: true },
    execution: { planId: 'plan-1' },
    reconciliation: null,
    truthLabels: ['DRY_RUN', 'SYNTHETIC_ONLY'],
    executionAuthority: 'NONE',
    ownerInvocations: {
      approvalEvaluations: 1,
      approvalUseReductions: 1,
      riskEvaluations: 1,
      executionDefinitionsCreated: 1,
      coordinatorsCreated: 1,
      coordinatorPreflights: 1,
      reconciliationEvaluations: 1,
      persistenceWrites: 1,
    },
  };
  const first = await persistence.persistValidateOnly(record);
  const replay = await persistence.persistValidateOnly(record);
  assert.equal(first.persistenceId, replay.persistenceId);
  assert.equal(ledger.countEvents('system.integration.validate_only'), 1);
  await assert.rejects(
    persistence.persistValidateOnly({ ...record, disposition: 'CHANGED' }),
    /VALIDATE_ONLY_RECORD_ID_CONFLICT/,
  );
});

test('sealed dry-run venue journal exposes no live or signed action surface', async () => {
  const clock = new ManualClock(T0);
  const venue = new SealedDryRunVenueJournal(clock);
  const plan = {
    mode: 'VALIDATE_ONLY',
    planId: 'plan_fixture_1',
  };
  const verdict = { allowed: true, evaluatedAt: T0, expiresAt: T0 + 1_000 };
  venue.claimPlanIdentity(plan.planId, 'terms-fixture-1');
  venue.authorizeRisk(plan.planId, verdict);
  assert.deepEqual(await venue.preflight(plan), { ok: true });
  const request = {
    planId: plan.planId,
    correlationId: 'cor_fixture_plan',
    symbol: 'FIXTUREUSDT',
    direction: 'LONG_SPOT_SHORT_PERP',
    mode: 'VALIDATE_ONLY',
    phase: 'OPEN',
    leg: {
      legId: 'leg_fixture_spot',
      key: 'SPOT',
      phase: 'OPEN',
      role: 'SPOT_OPEN',
      venue: 'SPOT',
      side: 'BUY',
      quantity: 1,
      reduceOnly: false,
      riskEffect: 'RISK_INCREASING',
      clientOrderId: 'dry_fixture_spot',
    },
  };
  assert.deepEqual(await venue.validateLeg(request), { ok: true });
  await assert.rejects(venue.submitPaper(request), /VALIDATE_ONLY_SUBMISSION_BLOCKED/);
  assert.equal(Object.isSealed(venue), true);
  assert.equal(venue.placeOrder, undefined);
  assert.equal(venue.testOrder, undefined);
  assert.equal(venue.borrow, undefined);
  assert.equal(venue.snapshot().executionAuthority, 'NONE');
  assert.equal(venue.callsFor('submitPaper').length, 0);
});

test('explicit egress tripwire traps global and Node transport families and restores them', () => {
  const require = createRequire(import.meta.url);
  const http = require('node:http');
  const https = require('node:https');
  const net = require('node:net');
  const tls = require('node:tls');
  const originals = {
    fetch: globalThis.fetch,
    WebSocket: globalThis.WebSocket,
    httpRequest: http.request,
    httpsRequest: https.request,
    netConnect: net.connect,
    tlsConnect: tls.connect,
  };
  const tripwire = new EgressTripwire().install();
  try {
    assert.throws(() => globalThis.fetch('https://example.invalid'), /EGRESS_FORBIDDEN:global.fetch/);
    assert.throws(() => new globalThis.WebSocket('wss://example.invalid'), /EGRESS_FORBIDDEN:global.WebSocket/);
    assert.throws(() => http.request('http://example.invalid'), /EGRESS_FORBIDDEN:node:http.request/);
    assert.throws(() => new http.ClientRequest('http://example.invalid'), /EGRESS_FORBIDDEN:node:http.ClientRequest/);
    assert.throws(() => https.request('https://example.invalid'), /EGRESS_FORBIDDEN:node:https.request/);
    assert.throws(() => net.connect(1, 'example.invalid'), /EGRESS_FORBIDDEN:node:net.connect/);
    assert.throws(() => tls.connect(1, 'example.invalid'), /EGRESS_FORBIDDEN:node:tls.connect/);
    assert.equal(tripwire.snapshot().attemptCount, 7);
  } finally {
    tripwire.restore();
  }
  assert.equal(globalThis.fetch, originals.fetch);
  assert.equal(globalThis.WebSocket, originals.WebSocket);
  assert.equal(http.request, originals.httpRequest);
  assert.equal(https.request, originals.httpsRequest);
  assert.equal(net.connect, originals.netConnect);
  assert.equal(tls.connect, originals.tlsConnect);
});

test('scenario assertions emit stable scenario and invariant context', () => {
  assert.equal(scenarioTestName(7, 'bounded focus promotion'), '[SC-07] bounded focus promotion');
  assert.throws(
    () => assertScenario('SC-07', 'FOCUS_BUDGET_RESPECTED', false, 'expected one focus lease'),
    /SC-07 invariant=FOCUS_BUDGET_RESPECTED :: expected one focus lease/,
  );
});

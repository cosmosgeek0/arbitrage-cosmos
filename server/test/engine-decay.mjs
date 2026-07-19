import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../dist/ledger.js';
import { canonicalJson, stableHash128Hex } from '../dist/foundation/contracts/index.js';
import {
  STRATEGY_DECAY_AXES,
  STRATEGY_DECAY_EVALUATION_INTERVAL_MS,
  STRATEGY_DECAY_MEASUREMENT_SCHEMA,
  STRATEGY_DECAY_MEASUREMENT_SCHEMA_VERSION,
  StrategyDecayLedgerAdapter,
  StrategyDecayCoordinator,
  UnavailableStrategyDecayPerformanceMeasurementPort,
  deriveStrategyDecayMeasurementId,
  deriveStrategyDecayHistoryDigest,
  deriveStrategyDecayPolicyRevision,
  encodeStrategyDecayHistoryState,
  evaluateStrategyDecayGovernance,
  projectStrategyDecayCoordinatorPosture,
  summarizeStrategyDecayDecision,
  strategyDecayConfigKey,
  validateStrategyDecayDecision,
  validateStrategyDecayGovernancePolicy,
  validateStrategyDecayHistoryState,
  validateStrategyDecayMeasurement,
} from '../dist/engine/decay/index.js';
import { BASIS_DEFAULTS, deriveBasisConfigVersion } from '../dist/engine/basis/config.js';
import { VOLUME_DEFAULTS, deriveVolumeConfigVersion } from '../dist/engine/volume/config.js';

const NOW = 1_800_000_000_000;

function policy(overrides = {}) {
  const semantics = {
    policyId: 'engine.strategy-decay.governance.v1',
    reduceAfterConsecutiveDegradedWindows: 1,
    disableAfterConsecutiveDeadWindows: 2,
    retireAfterConsecutiveDeadWindows: 3,
    maximumRecentDecisions: 4,
    ...overrides,
  };
  return Object.freeze({
    ...semantics,
    policyRevision: deriveStrategyDecayPolicyRevision(semantics),
  });
}

function measurement(sequence, state = 'STABLE', overrides = {}) {
  const { measurementId: overriddenMeasurementId, ...contentOverrides } = overrides;
  const unknown = state === 'UNKNOWN';
  const states = state === 'UNKNOWN'
    ? ['STABLE', 'STABLE', 'UNKNOWN']
    : state === 'DEAD'
      ? ['STABLE', 'DEAD', 'STABLE']
      : state === 'DEGRADED'
        ? ['DEGRADED', 'STABLE', 'STABLE']
        : ['STABLE', 'STABLE', 'STABLE'];
  const axes = STRATEGY_DECAY_AXES.map((axis, index) => Object.freeze({
    axis,
    state: states[index],
    baselineSampleCount: states[index] === 'UNKNOWN' ? 0 : 20,
    currentSampleCount: states[index] === 'UNKNOWN' ? 0 : 20,
    baselineValue: states[index] === 'UNKNOWN' ? null : index === 1 ? '10' : '1/10',
    currentValue: states[index] === 'UNKNOWN' ? null : index === 1 ? '8' : '1/10',
    unit: index === 1 ? 'QUOTE_ASSET' : 'RATIO',
    reasonCodes: Object.freeze(states[index] === 'UNKNOWN' ? ['DIRECT_CROWDING_UNAVAILABLE'] : []),
    evidenceIds: Object.freeze(states[index] === 'UNKNOWN' ? [] : [`evidence-${axis.toLowerCase()}-${sequence}`]),
  }));
  const material = {
    schema: STRATEGY_DECAY_MEASUREMENT_SCHEMA,
    schemaVersion: STRATEGY_DECAY_MEASUREMENT_SCHEMA_VERSION,
    strategy: 'BASIS',
    configVersion: 'basis-config-v1',
    direction: 'LONG_SPOT_SHORT_PERP',
    evaluatedAtMs: NOW + sequence,
    evidenceAuthority: unknown ? 'UNKNOWN' : 'PRODUCTION',
    baselineWindow: Object.freeze({ startAtMs: NOW - 4_000, endAtMs: NOW - 3_000 }),
    currentWindow: Object.freeze({ startAtMs: NOW - 2_000, endAtMs: NOW - 1_000 }),
    axes: Object.freeze(axes),
    state,
    reasonCodes: Object.freeze(unknown ? ['DIRECT_CROWDING_UNAVAILABLE'] : []),
    ...contentOverrides,
  };
  return Object.freeze({
    ...material,
    measurementId: overriddenMeasurementId ?? deriveStrategyDecayMeasurementId(material),
  });
}

function evaluate(state, sequence, measurementState, selectedPolicy = policy()) {
  const result = evaluateStrategyDecayGovernance({
    policy: selectedPolicy,
    measurement: measurement(sequence, measurementState),
    previousState: state,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.reasonCodes.join(','));
  return result;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function trapCounterProxy(target) {
  const counter = { count: 0 };
  const handler = {};
  for (const name of [
    'apply', 'construct', 'defineProperty', 'deleteProperty', 'get', 'getOwnPropertyDescriptor',
    'getPrototypeOf', 'has', 'isExtensible', 'ownKeys', 'preventExtensions', 'set', 'setPrototypeOf',
  ]) {
    handler[name] = (...args) => {
      counter.count += 1;
      return Reflect[name](...args);
    };
  }
  return { proxy: new Proxy(target, handler), counter };
}

function decisionId(material) {
  return `decaydec_${stableHash128Hex(canonicalJson({
    revision: material.revision,
    strategy: material.strategy,
    configVersion: material.configVersion,
    direction: material.direction,
    policyId: material.policyId,
    policyRevision: material.policyRevision,
    reduceAfterConsecutiveDegradedWindows: material.reduceAfterConsecutiveDegradedWindows,
    disableAfterConsecutiveDeadWindows: material.disableAfterConsecutiveDeadWindows,
    retireAfterConsecutiveDeadWindows: material.retireAfterConsecutiveDeadWindows,
    maximumRecentDecisions: material.maximumRecentDecisions,
    measurementId: material.measurementId,
    evaluatedAtMs: material.evaluatedAtMs,
    measurementState: material.measurementState,
    kind: material.kind,
    priorPosture: material.priorPosture,
    nextPosture: material.nextPosture,
    researchState: material.researchState,
    researchCandidateId: material.researchCandidateId,
    reasonCodes: material.reasonCodes,
  }))}`;
}

test('UNKNOWN evidence holds without fabricating decay, crowding, or recovery truth', () => {
  const result = evaluate(null, 1, 'UNKNOWN');
  assert.equal(result.decision.kind, 'HOLD_UNKNOWN');
  assert.equal(result.decision.nextPosture, 'ENABLED');
  assert.equal(result.decision.researchState, 'NONE');
  assert.equal(result.decision.executionAuthority, 'NONE');
  assert.equal(result.decision.automaticResearchPromotion, false);

  const falseProduction = measurement(2, 'STABLE', { evidenceAuthority: 'SYNTHETIC_TEST' });
  assert.ok(validateStrategyDecayMeasurement(falseProduction).includes('NON_PRODUCTION_MEASUREMENT_MUST_BE_UNKNOWN'));
});

test('dead windows reduce, disable, retire, redirect only to PENDING_REVIEW, and never self-resurrect', () => {
  const first = evaluate(null, 10, 'DEAD');
  assert.equal(first.decision.kind, 'REDUCE');
  assert.equal(first.nextState.effectivePosture, 'REDUCED');
  assert.equal(first.nextState.researchState, 'PENDING_REVIEW');
  assert.match(first.nextState.researchCandidateId, /^decayresearch_/);

  const second = evaluate(first.nextState, 11, 'DEAD');
  assert.equal(second.decision.kind, 'DISABLE');
  assert.equal(second.nextState.effectivePosture, 'DISABLED');
  assert.equal(second.nextState.researchCandidateId, first.nextState.researchCandidateId);

  const third = evaluate(second.nextState, 12, 'DEAD');
  assert.equal(third.decision.kind, 'RETIRE');
  assert.equal(third.nextState.effectivePosture, 'RETIRED');

  const recoveredMeasurement = evaluate(third.nextState, 13, 'STABLE');
  assert.equal(recoveredMeasurement.decision.kind, 'HOLD_STABLE');
  assert.equal(recoveredMeasurement.nextState.effectivePosture, 'RETIRED');
  assert.equal(recoveredMeasurement.nextState.researchState, 'PENDING_REVIEW');
  assert.ok(recoveredMeasurement.decision.reasonCodes.includes('MORE_RESTRICTIVE_POSTURE_PRESERVED'));
});

test('sunk-cost fields, accessors, and Proxies are rejected without invoking hostile reads', () => {
  const extra = evaluateStrategyDecayGovernance({
    policy: policy(),
    measurement: measurement(20, 'DEGRADED'),
    previousState: null,
    sunkCostMicrounits: '999999999',
  });
  assert.deepEqual(extra, { ok: false, reasonCodes: ['GOVERNANCE_INPUT_SHAPE_INVALID'] });

  let getterReads = 0;
  const hostile = {};
  Object.defineProperties(hostile, {
    policy: { enumerable: true, value: policy() },
    measurement: { enumerable: true, get() { getterReads += 1; throw new Error('must not run'); } },
    previousState: { enumerable: true, value: null },
  });
  assert.deepEqual(evaluateStrategyDecayGovernance(hostile), {
    ok: false,
    reasonCodes: ['GOVERNANCE_INPUT_SHAPE_INVALID'],
  });
  assert.equal(getterReads, 0);
  const proxy = new Proxy({}, { ownKeys() { throw new Error('hostile proxy'); } });
  assert.deepEqual(evaluateStrategyDecayGovernance(proxy), {
    ok: false,
    reasonCodes: ['GOVERNANCE_INPUT_SHAPE_INVALID'],
  });
});

test('history admits only strictly newer non-replayed measurements and ordered summaries', () => {
  const first = evaluate(null, 100, 'STABLE');
  const older = evaluateStrategyDecayGovernance({
    policy: policy(),
    measurement: measurement(101, 'STABLE', { evaluatedAtMs: first.nextState.updatedAtMs - 1 }),
    previousState: first.nextState,
  });
  assert.deepEqual(older, { ok: false, reasonCodes: ['MEASUREMENT_TIME_NOT_STRICTLY_INCREASING'] });

  const equal = evaluateStrategyDecayGovernance({
    policy: policy(),
    measurement: measurement(101, 'STABLE', { evaluatedAtMs: first.nextState.updatedAtMs }),
    previousState: first.nextState,
  });
  assert.deepEqual(equal, { ok: false, reasonCodes: ['MEASUREMENT_TIME_NOT_STRICTLY_INCREASING'] });

  const replay = evaluateStrategyDecayGovernance({
    policy: policy(),
    measurement: measurement(100, 'STABLE'),
    previousState: first.nextState,
  });
  assert.deepEqual(replay, {
    ok: false,
    reasonCodes: ['MEASUREMENT_ID_REPLAYED', 'MEASUREMENT_TIME_NOT_STRICTLY_INCREASING'],
  });

  const changedCohortReplay = evaluateStrategyDecayGovernance({
    policy: policy(),
    measurement: measurement(103, 'UNKNOWN', {
      configVersion: 'basis-config-v2',
      evaluatedAtMs: first.nextState.updatedAtMs,
    }),
    previousState: first.nextState,
  });
  assert.deepEqual(changedCohortReplay, {
    ok: false,
    reasonCodes: ['MEASUREMENT_TIME_NOT_STRICTLY_INCREASING'],
  });

  const second = evaluate(first.nextState, 104, 'STABLE');
  const reordered = clone(second.nextState);
  reordered.recentDecisions.reverse();
  assert.ok(validateStrategyDecayHistoryState(reordered).includes('HISTORY_EVALUATED_AT_ORDER_INVALID'));

  const duplicate = clone(second.nextState);
  duplicate.recentDecisions[1].measurementId = duplicate.recentDecisions[0].measurementId;
  assert.ok(validateStrategyDecayHistoryState(duplicate).includes('HISTORY_DUPLICATE_MEASUREMENT_ID'));
});

test('all governance and Ledger seams reject active, revoked, and nested Proxies with zero traps', () => {
  const result = evaluate(null, 120, 'DEAD');
  const publicInputs = [
    [validateStrategyDecayGovernancePolicy, policy()],
    [validateStrategyDecayMeasurement, measurement(121, 'STABLE')],
    [validateStrategyDecayHistoryState, result.nextState],
    [validateStrategyDecayDecision, result.decision],
  ];
  for (const [validator, value] of publicInputs) {
    const { proxy, counter } = trapCounterProxy(value);
    assert.ok(validator(proxy).length > 0);
    assert.equal(counter.count, 0);
  }

  for (const [validator, value] of publicInputs) {
    const revoked = Proxy.revocable(value, {});
    revoked.revoke();
    assert.doesNotThrow(() => assert.ok(validator(revoked.proxy).length > 0));
  }

  const nestedTargets = [
    { key: 'policy', value: policy() },
    { key: 'measurement', value: measurement(124, 'STABLE') },
    { key: 'previousState', value: result.nextState },
  ];
  for (const nested of nestedTargets) {
    const { proxy, counter } = trapCounterProxy(nested.value);
    const input = { policy: policy(), measurement: measurement(125, 'STABLE'), previousState: null };
    input[nested.key] = proxy;
    assert.deepEqual(evaluateStrategyDecayGovernance(input), {
      ok: false,
      reasonCodes: ['GOVERNANCE_INPUT_SHAPE_INVALID'],
    });
    assert.equal(counter.count, 0);
  }

  const axesBase = measurement(126, 'STABLE');
  const axesProxy = trapCounterProxy(axesBase.axes);
  assert.ok(validateStrategyDecayMeasurement({ ...axesBase, axes: axesProxy.proxy }).length > 0);
  assert.equal(axesProxy.counter.count, 0);
  for (const [field, value] of [
    ['baselineWindow', measurement(127, 'STABLE').baselineWindow],
    ['currentWindow', measurement(127, 'STABLE').currentWindow],
  ]) {
    const nested = trapCounterProxy(value);
    const windowBase = measurement(127, 'STABLE');
    assert.ok(validateStrategyDecayMeasurement({ ...windowBase, [field]: nested.proxy }).length > 0);
    assert.equal(nested.counter.count, 0);
  }
  const axisProxy = trapCounterProxy(measurement(128, 'STABLE').axes[0]);
  const hostileAxes = [...measurement(128, 'STABLE').axes];
  hostileAxes[0] = axisProxy.proxy;
  assert.ok(validateStrategyDecayMeasurement({ ...measurement(128, 'STABLE'), axes: hostileAxes }).length > 0);
  assert.equal(axisProxy.counter.count, 0);
  const summaryProxy = trapCounterProxy(result.nextState.recentDecisions[0]);
  assert.ok(validateStrategyDecayHistoryState({
    ...result.nextState,
    recentDecisions: [summaryProxy.proxy],
  }).length > 0);
  assert.equal(summaryProxy.counter.count, 0);
  const reasonProxy = trapCounterProxy(result.decision.reasonCodes);
  assert.ok(validateStrategyDecayDecision({ ...result.decision, reasonCodes: reasonProxy.proxy }).length > 0);
  assert.equal(reasonProxy.counter.count, 0);
  const summarizedProxy = trapCounterProxy(result.decision);
  assert.throws(() => summarizeStrategyDecayDecision(summarizedProxy.proxy, 1, 1, 4, null), /invalid/);
  assert.equal(summarizedProxy.counter.count, 0);

  let writes = 0;
  const adapter = new StrategyDecayLedgerAdapter({
    getConfigValue() { return null; },
    compareAndSetConfigValueAndLogEvents() { writes += 1; return { committed: true, events: [{ id: 1 }] }; },
  });
  const envelope = trapCounterProxy({ expectedSerialized: null, decision: result.decision, nextState: result.nextState });
  const nestedDecision = trapCounterProxy(result.decision);
  const nestedState = trapCounterProxy(result.nextState);
  for (const { input, counter } of [
    { input: envelope.proxy, counter: envelope.counter },
    { input: { expectedSerialized: null, decision: nestedDecision.proxy, nextState: result.nextState }, counter: nestedDecision.counter },
    { input: { expectedSerialized: null, decision: result.decision, nextState: nestedState.proxy }, counter: nestedState.counter },
  ]) {
    assert.equal(adapter.commit(input).disposition, 'INVALID_REQUEST');
    assert.equal(counter.count, 0);
  }
  const revokedEnvelope = Proxy.revocable({
    expectedSerialized: null,
    decision: result.decision,
    nextState: result.nextState,
  }, {});
  revokedEnvelope.revoke();
  assert.doesNotThrow(() => assert.equal(adapter.commit(revokedEnvelope.proxy).disposition, 'INVALID_REQUEST'));
  assert.equal(writes, 0);
});

test('canonical numeric identity rejects negative zero before hashing or persistence', () => {
  const validPolicy = policy();
  assert.throws(() => deriveStrategyDecayPolicyRevision({
    policyId: validPolicy.policyId,
    reduceAfterConsecutiveDegradedWindows: 1,
    disableAfterConsecutiveDeadWindows: 2,
    retireAfterConsecutiveDeadWindows: 3,
    maximumRecentDecisions: -0,
  }), /invalid/);
  assert.ok(validateStrategyDecayGovernancePolicy({ ...validPolicy, maximumRecentDecisions: -0 }).length > 0);
  assert.ok(validateStrategyDecayMeasurement({ ...measurement(130, 'STABLE'), evaluatedAtMs: -0 }).length > 0);
  const result = evaluate(null, 131, 'STABLE');
  assert.ok(validateStrategyDecayHistoryState({ ...result.nextState, consecutiveDeadWindows: -0 }).length > 0);
  assert.ok(validateStrategyDecayDecision({ ...result.decision, revision: -0 }).length > 0);
  assert.deepEqual(validateStrategyDecayHistoryState(result.nextState), []);

  let writes = 0;
  const adapter = new StrategyDecayLedgerAdapter({
    getConfigValue() { return null; },
    compareAndSetConfigValueAndLogEvents() { writes += 1; return { committed: true, events: [{ id: 1 }] }; },
  });
  assert.equal(adapter.commit({
    expectedSerialized: null,
    decision: result.decision,
    nextState: result.nextState,
    commitBeforeMs: -0,
  }).disposition, 'INVALID_REQUEST');
  assert.equal(writes, 0);
});

test('history checksum rejects posture tampering with an unchanged digest on encode and load', () => {
  const result = evaluate(null, 140, 'DEGRADED');
  const tampered = { ...clone(result.nextState), effectivePosture: 'RETIRED' };
  assert.ok(validateStrategyDecayHistoryState(tampered).includes('HISTORY_LATEST_SUMMARY_STATE_MISMATCH'));
  assert.throws(() => encodeStrategyDecayHistoryState(tampered), /invalid/);

  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-engine-decay-tamper-'));
  const ledger = new Ledger(dataDir);
  try {
    ledger.setConfigValue(strategyDecayConfigKey('BASIS', tampered.direction), JSON.stringify(tampered));
    assert.equal(new StrategyDecayLedgerAdapter(ledger).load('BASIS', tampered.direction).status, 'MALFORMED');
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Ledger rejects an independently valid decision/state pair forged against a different prior', () => {
  const selectedPolicy = policy({ maximumRecentDecisions: 1 });
  const prior = evaluate(null, 150, 'DEAD', selectedPolicy);
  const forgedMaterial = {
    ...clone(prior.decision),
    revision: 2,
    measurementId: `decaymeas_${(151).toString(16).padStart(32, '0')}`,
    evaluatedAtMs: NOW + 151,
    measurementState: 'STABLE',
    kind: 'HOLD_STABLE',
    priorPosture: 'ENABLED',
    nextPosture: 'ENABLED',
    researchState: 'NONE',
    researchCandidateId: null,
    reasonCodes: ['DECAY_STATE_STABLE', 'GOVERNANCE_HOLD_STABLE'],
  };
  forgedMaterial.decisionId = decisionId(forgedMaterial);
  const forgedSummary = summarizeStrategyDecayDecision(forgedMaterial, 0, 0, 1, prior.nextState.historyDigest);
  const forgedState = {
    ...clone(prior.nextState),
    revision: 2,
    updatedAtMs: forgedMaterial.evaluatedAtMs,
    effectivePosture: 'ENABLED',
    researchState: 'NONE',
    researchCandidateId: null,
    consecutiveDegradedWindows: 0,
    consecutiveDeadWindows: 0,
    totalDecisionCount: 2,
    compactedDecisionCount: 1,
    compactedHistoryDigest: prior.nextState.historyDigest,
    recentDecisions: [forgedSummary],
    historyDigest: forgedSummary.historyDigest,
  };
  assert.deepEqual(validateStrategyDecayDecision(forgedMaterial), []);
  assert.deepEqual(validateStrategyDecayHistoryState(forgedState), []);

  let writes = 0;
  const adapter = new StrategyDecayLedgerAdapter({
    getConfigValue() { return null; },
    compareAndSetConfigValueAndLogEvents() { writes += 1; return { committed: true, events: [{ id: 1 }] }; },
  });
  const rejected = adapter.commit({
    expectedSerialized: encodeStrategyDecayHistoryState(prior.nextState),
    decision: forgedMaterial,
    nextState: forgedState,
  });
  assert.equal(rejected.disposition, 'INVALID_REQUEST');
  assert.equal(rejected.reasonCode, 'DECAY_COMMIT_TRANSITION_INVALID');
  assert.equal(writes, 0);
});

test('Ledger recomputes policy action and counters instead of trusting a self-consistent pair', () => {
  const selectedPolicy = policy({ maximumRecentDecisions: 1 });
  const prior = evaluate(null, 160, 'DEAD', selectedPolicy);
  const forgedDecision = {
    ...clone(prior.decision),
    revision: 2,
    measurementId: `decaymeas_${(161).toString(16).padStart(32, '0')}`,
    evaluatedAtMs: NOW + 161,
    measurementState: 'DEAD',
    kind: 'REDUCE',
    priorPosture: 'REDUCED',
    nextPosture: 'REDUCED',
    reasonCodes: ['DECAY_STATE_DEAD', 'GOVERNANCE_REDUCE'],
  };
  forgedDecision.decisionId = decisionId(forgedDecision);
  const forgedSummary = summarizeStrategyDecayDecision(
    forgedDecision,
    2,
    2,
    1,
    prior.nextState.historyDigest,
  );
  const forgedState = {
    ...clone(prior.nextState),
    revision: 2,
    updatedAtMs: forgedDecision.evaluatedAtMs,
    consecutiveDegradedWindows: 2,
    consecutiveDeadWindows: 2,
    totalDecisionCount: 2,
    compactedDecisionCount: 1,
    compactedHistoryDigest: prior.nextState.historyDigest,
    recentDecisions: [forgedSummary],
    historyDigest: forgedSummary.historyDigest,
  };
  assert.deepEqual(validateStrategyDecayDecision(forgedDecision), []);
  assert.deepEqual(validateStrategyDecayHistoryState(forgedState), []);

  let writes = 0;
  const adapter = new StrategyDecayLedgerAdapter({
    getConfigValue() { return null; },
    compareAndSetConfigValueAndLogEvents() { writes += 1; return { committed: true, events: [{ id: 1 }] }; },
  });
  assert.equal(adapter.commit({
    expectedSerialized: encodeStrategyDecayHistoryState(prior.nextState),
    decision: forgedDecision,
    nextState: forgedState,
  }).disposition, 'INVALID_REQUEST');
  assert.equal(writes, 0);
});

test('canonical Ledger CAS preserves every decision event while bounding the restart snapshot', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-engine-decay-'));
  const ledger = new Ledger(dataDir);
  const adapter = new StrategyDecayLedgerAdapter(ledger);
  const boundedPolicy = policy({ maximumRecentDecisions: 3 });
  try {
    let loaded = adapter.load('BASIS', 'LONG_SPOT_SHORT_PERP');
    assert.equal(loaded.status, 'EMPTY');
    let state = null;
    for (let sequence = 30; sequence < 36; sequence += 1) {
      const result = evaluate(state, sequence, sequence < 33 ? 'DEGRADED' : 'STABLE', boundedPolicy);
      const committed = adapter.commit({
        expectedSerialized: loaded.serialized,
        decision: result.decision,
        nextState: result.nextState,
      });
      assert.equal(committed.disposition, 'COMMITTED_NEW');
      loaded = adapter.load('BASIS', 'LONG_SPOT_SHORT_PERP');
      assert.equal(loaded.status, 'AVAILABLE');
      state = loaded.state;
    }
    assert.equal(state.recentDecisions.length, 3);
    assert.equal(state.compactedDecisionCount, 3);
    assert.equal(state.totalDecisionCount, 6);
    assert.equal(ledger.recentEvents(20, 'strategy.decay.decision', 'BASIS').length, 6);
    assert.equal(ledger.getConfigValue(strategyDecayConfigKey('BASIS', 'LONG_SPOT_SHORT_PERP')), loaded.serialized);

    const replay = evaluate(loaded.state, 36, 'STABLE', boundedPolicy);
    const firstCommit = adapter.commit({
      expectedSerialized: loaded.serialized,
      decision: replay.decision,
      nextState: replay.nextState,
    });
    assert.equal(firstCommit.disposition, 'COMMITTED_NEW');
    const eventCount = ledger.countEvents();
    const idempotent = adapter.commit({
      expectedSerialized: loaded.serialized,
      decision: replay.decision,
      nextState: replay.nextState,
    });
    assert.equal(idempotent.disposition, 'ALREADY_COMMITTED');
    assert.equal(ledger.countEvents(), eventCount);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('direction-scoped Ledger histories cannot overwrite another strategy lane', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-engine-decay-directions-'));
  const ledger = new Ledger(dataDir);
  const adapter = new StrategyDecayLedgerAdapter(ledger);
  try {
    const long = evaluateStrategyDecayGovernance({
      policy: policy(),
      measurement: measurement(170, 'DEAD'),
      previousState: null,
    });
    const short = evaluateStrategyDecayGovernance({
      policy: policy(),
      measurement: measurement(171, 'STABLE', { direction: 'SHORT_SPOT_LONG_PERP' }),
      previousState: null,
    });
    assert.equal(long.ok, true);
    assert.equal(short.ok, true);
    assert.deepEqual(evaluateStrategyDecayGovernance({
      policy: policy(),
      measurement: measurement(171, 'STABLE', { direction: 'SHORT_SPOT_LONG_PERP' }),
      previousState: long.nextState,
    }), { ok: false, reasonCodes: ['HISTORY_DIRECTION_MISMATCH'] });
    assert.equal(adapter.commit({ expectedSerialized: null, decision: long.decision, nextState: long.nextState }).disposition, 'COMMITTED_NEW');
    assert.equal(adapter.load('BASIS', 'SHORT_SPOT_LONG_PERP').status, 'EMPTY');
    assert.equal(adapter.commit({ expectedSerialized: null, decision: short.decision, nextState: short.nextState }).disposition, 'COMMITTED_NEW');
    assert.equal(adapter.load('BASIS', 'LONG_SPOT_SHORT_PERP').state.effectivePosture, 'REDUCED');
    assert.equal(adapter.load('BASIS', 'SHORT_SPOT_LONG_PERP').state.effectivePosture, 'ENABLED');
    assert.notEqual(
      strategyDecayConfigKey('BASIS', 'LONG_SPOT_SHORT_PERP'),
      strategyDecayConfigKey('BASIS', 'SHORT_SPOT_LONG_PERP'),
    );

    const secondLong = evaluate(long.nextState, 172, 'STABLE');
    const mixed = clone(secondLong.nextState);
    mixed.recentDecisions[0].direction = 'SHORT_SPOT_LONG_PERP';
    const firstMaterial = { ...mixed.recentDecisions[0] };
    delete firstMaterial.historyDigest;
    mixed.recentDecisions[0].historyDigest = deriveStrategyDecayHistoryDigest(null, firstMaterial);
    const secondMaterial = { ...mixed.recentDecisions[1] };
    delete secondMaterial.historyDigest;
    mixed.recentDecisions[1].historyDigest = deriveStrategyDecayHistoryDigest(
      mixed.recentDecisions[0].historyDigest,
      secondMaterial,
    );
    mixed.historyDigest = mixed.recentDecisions[1].historyDigest;
    assert.ok(validateStrategyDecayHistoryState(mixed).includes('HISTORY_SUMMARY_DIRECTION_MISMATCH'));
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
test('an independently opened stale Ledger writer appends no retirement history', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-engine-decay-race-'));
  const firstLedger = new Ledger(dataDir);
  const secondLedger = new Ledger(dataDir);
  const first = new StrategyDecayLedgerAdapter(firstLedger);
  const second = new StrategyDecayLedgerAdapter(secondLedger);
  try {
    const firstLoad = first.load('VOLUME', 'WAKE_CONTINUATION');
    const secondLoad = second.load('VOLUME', 'WAKE_CONTINUATION');
    const firstMeasurement = measurement(50, 'DEAD', { strategy: 'VOLUME', configVersion: 'volume-config-v1', direction: 'WAKE_CONTINUATION' });
    const secondMeasurement = measurement(51, 'DEAD', { strategy: 'VOLUME', configVersion: 'volume-config-v1', direction: 'WAKE_CONTINUATION' });
    const winner = evaluateStrategyDecayGovernance({ policy: policy(), measurement: firstMeasurement, previousState: null });
    const loser = evaluateStrategyDecayGovernance({ policy: policy(), measurement: secondMeasurement, previousState: null });
    assert.equal(winner.ok, true);
    assert.equal(loser.ok, true);
    assert.equal(first.commit({ expectedSerialized: firstLoad.serialized, decision: winner.decision, nextState: winner.nextState }).disposition, 'COMMITTED_NEW');
    const countAfterWinner = secondLedger.countEvents();
    const rejected = second.commit({ expectedSerialized: secondLoad.serialized, decision: loser.decision, nextState: loser.nextState });
    assert.equal(rejected.disposition, 'VERSION_CONFLICT');
    assert.equal(secondLedger.countEvents(), countAfterWinner);
    assert.equal(secondLedger.recentEvents(10, 'strategy.decay.decision', 'VOLUME').length, 1);
  } finally {
    firstLedger.close();
    secondLedger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('owner config versions are content-bound and reject raw negative zero before normalization', () => {
  const basisA = deriveBasisConfigVersion({ ...BASIS_DEFAULTS, stagedSizeFractions: [...BASIS_DEFAULTS.stagedSizeFractions] });
  const basisB = deriveBasisConfigVersion({ stagedSizeFractions: [...BASIS_DEFAULTS.stagedSizeFractions], ...BASIS_DEFAULTS });
  assert.equal(basisA, basisB);
  assert.notEqual(basisA, deriveBasisConfigVersion({
    ...BASIS_DEFAULTS,
    minNetBasisPct: BASIS_DEFAULTS.minNetBasisPct + 0.01,
    stagedSizeFractions: [...BASIS_DEFAULTS.stagedSizeFractions],
  }));
  assert.throws(() => deriveBasisConfigVersion({
    ...BASIS_DEFAULTS,
    maxFutureSkewMs: -0,
    stagedSizeFractions: [...BASIS_DEFAULTS.stagedSizeFractions],
  }), /negative zero/);
  assert.throws(() => deriveBasisConfigVersion({
    ...BASIS_DEFAULTS,
    stagedSizeFractions: [-0, ...BASIS_DEFAULTS.stagedSizeFractions.slice(1)],
  }), /negative zero/);

  const volumeA = deriveVolumeConfigVersion({ ...VOLUME_DEFAULTS });
  const volumeB = deriveVolumeConfigVersion({ focusAgePenaltyAfterMs: VOLUME_DEFAULTS.focusAgePenaltyAfterMs, ...VOLUME_DEFAULTS });
  assert.equal(volumeA, volumeB);
  assert.notEqual(volumeA, deriveVolumeConfigVersion({
    ...VOLUME_DEFAULTS,
    minQuoteVolume24hUsd: VOLUME_DEFAULTS.minQuoteVolume24hUsd + 1,
  }));
  assert.throws(() => deriveVolumeConfigVersion({ ...VOLUME_DEFAULTS, minFocusDwellMs: -0 }), /negative zero/);
});

test('mounted coordinator automatically persists UNKNOWN on owner absence without adding a scheduler', () => {
  const source = readFileSync(new URL('../src/engine/decay/coordinator.ts', import.meta.url), 'utf8');
  for (const forbidden of ['setInterval(', 'setTimeout(', 'Date.now(', 'process.env', 'Math.random(', 'fetch(', 'WebSocket']) {
    assert.equal(source.includes(forbidden), false, `coordinator must not contain ${forbidden}`);
  }

  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-engine-decay-coordinator-unknown-'));
  const ledger = new Ledger(dataDir);
  try {
    const adapter = new StrategyDecayLedgerAdapter(ledger);
    const request = {
      strategy: 'BASIS', configVersion: 'cfg_basis_owner_v1',
      direction: 'long_spot_short_perp', evaluatedAtMs: NOW,
    };
    const first = new StrategyDecayCoordinator(
      adapter,
      new UnavailableStrategyDecayPerformanceMeasurementPort(),
    ).tick(request);
    assert.equal(first.disposition, 'COMMITTED_NEW');
    assert.equal(first.measurement.state, 'UNKNOWN');
    assert.equal(first.state.effectivePosture, 'ENABLED');
    assert.equal(first.state.recentDecisions.at(-1).measurementState, 'UNKNOWN');

    const notDue = new StrategyDecayCoordinator(
      adapter,
      new UnavailableStrategyDecayPerformanceMeasurementPort(),
    ).tick({ ...request, evaluatedAtMs: NOW + STRATEGY_DECAY_EVALUATION_INTERVAL_MS - 1 });
    assert.equal(notDue.disposition, 'NOT_DUE');
    assert.equal(ledger.recentEvents(20, 'strategy.decay.decision', 'BASIS').length, 1);

    const restarted = new StrategyDecayCoordinator(
      new StrategyDecayLedgerAdapter(ledger),
      new UnavailableStrategyDecayPerformanceMeasurementPort(),
    ).tick({ ...request, evaluatedAtMs: NOW + STRATEGY_DECAY_EVALUATION_INTERVAL_MS });
    assert.equal(restarted.disposition, 'COMMITTED_NEW');
    assert.equal(restarted.state.revision, 2);
    assert.equal(restarted.state.effectivePosture, 'ENABLED');

    const otherDirection = new StrategyDecayCoordinator(
      adapter,
      new UnavailableStrategyDecayPerformanceMeasurementPort(),
    ).tick({ ...request, direction: 'short_spot_long_perp' });
    assert.equal(otherDirection.disposition, 'COMMITTED_NEW');
    assert.equal(otherDirection.state.revision, 1);
    assert.equal(adapter.load('BASIS', 'long_spot_short_perp').state.revision, 2);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('configured coordinator durably drives canonical DEAD evidence through reduce, disable, and retire', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-engine-decay-coordinator-dead-'));
  const ledger = new Ledger(dataDir);
  const request = {
    strategy: 'VOLUME', configVersion: 'cfg_volume_owner_v1', direction: 'long', evaluatedAtMs: NOW,
  };
  const evidence = {
    readPerformanceMeasurement(scope) {
      return measurement(scope.evaluatedAtMs - NOW, 'DEAD', {
        strategy: scope.strategy,
        configVersion: scope.configVersion,
        direction: scope.direction,
        evaluatedAtMs: scope.evaluatedAtMs,
      });
    },
  };
  try {
    const firstCoordinator = new StrategyDecayCoordinator(new StrategyDecayLedgerAdapter(ledger), evidence);
    const first = firstCoordinator.tick(request);
    assert.equal(first.disposition, 'COMMITTED_NEW');
    assert.equal(first.state.effectivePosture, 'REDUCED');
    assert.equal(first.state.researchState, 'PENDING_REVIEW');
    assert.deepEqual(projectStrategyDecayCoordinatorPosture(first.state), {
      strategy: 'VOLUME',
      configVersion: request.configVersion,
      direction: request.direction,
      effectivePosture: 'REDUCED',
      latestMeasurementState: 'DEAD',
      decisionId: first.state.recentDecisions.at(-1).decisionId,
      measurementId: first.state.recentDecisions.at(-1).measurementId,
      policyRevision: first.state.policyRevision,
      historyRevision: 1,
      evaluatedAtMs: NOW,
      validUntilMs: NOW + STRATEGY_DECAY_EVALUATION_INTERVAL_MS,
      historyDigest: first.state.historyDigest,
    });

    const restarted = new StrategyDecayCoordinator(new StrategyDecayLedgerAdapter(ledger), evidence);
    const second = restarted.tick({ ...request, evaluatedAtMs: NOW + STRATEGY_DECAY_EVALUATION_INTERVAL_MS });
    assert.equal(second.disposition, 'COMMITTED_NEW');
    assert.equal(second.state.effectivePosture, 'DISABLED');
    const third = restarted.tick({ ...request, evaluatedAtMs: NOW + (2 * STRATEGY_DECAY_EVALUATION_INTERVAL_MS) });
    assert.equal(third.disposition, 'COMMITTED_NEW');
    assert.equal(third.state.effectivePosture, 'RETIRED');
    assert.equal(third.state.researchCandidateId, first.state.researchCandidateId);
    assert.equal(ledger.recentEvents(20, 'strategy.decay.decision', 'VOLUME').length, 3);

    const sameTick = firstCoordinator.tick({
      ...request,
      evaluatedAtMs: NOW + (2 * STRATEGY_DECAY_EVALUATION_INTERVAL_MS),
    });
    assert.equal(sameTick.disposition, 'NOT_DUE');
    assert.equal(ledger.recentEvents(20, 'strategy.decay.decision', 'VOLUME').length, 3);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('coordinator snapshots requests and owner measurements once with zero Proxy traps', () => {
  const noIoAdapter = new StrategyDecayLedgerAdapter({
    getConfigValue() { throw new Error('invalid requests must not read persistence'); },
  });
  const noIoCoordinator = new StrategyDecayCoordinator(
    noIoAdapter,
    new UnavailableStrategyDecayPerformanceMeasurementPort(),
  );
  const request = {
    strategy: 'BASIS', configVersion: 'cfg_basis_proxy_v1',
    direction: 'long_spot_short_perp', evaluatedAtMs: NOW,
  };
  const proxiedRequest = trapCounterProxy(request);
  assert.equal(noIoCoordinator.tick(proxiedRequest.proxy).disposition, 'BLOCKED');
  assert.equal(proxiedRequest.counter.count, 0);

  const revokedRequest = Proxy.revocable(request, {});
  revokedRequest.revoke();
  assert.doesNotThrow(() => assert.equal(noIoCoordinator.tick(revokedRequest.proxy).disposition, 'BLOCKED'));

  let requestGetterReads = 0;
  const accessorRequest = { ...request };
  Object.defineProperty(accessorRequest, 'direction', {
    enumerable: true,
    get() { requestGetterReads += 1; throw new Error('must not read'); },
  });
  assert.equal(noIoCoordinator.tick(accessorRequest).disposition, 'BLOCKED');
  assert.equal(requestGetterReads, 0);
  assert.equal(noIoCoordinator.tick({ ...request, evaluatedAtMs: -0 }).disposition, 'BLOCKED');
  assert.equal(noIoCoordinator.tick({ ...request, evaluatedAtMs: 0 }).disposition, 'BLOCKED');

  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-engine-decay-coordinator-proxy-'));
  const ledger = new Ledger(dataDir);
  try {
    const validMeasurement = measurement(0, 'DEAD', {
      configVersion: request.configVersion,
      direction: request.direction,
      evaluatedAtMs: request.evaluatedAtMs,
    });
    const proxiedMeasurement = trapCounterProxy(validMeasurement);
    const result = new StrategyDecayCoordinator(new StrategyDecayLedgerAdapter(ledger), {
      readPerformanceMeasurement() { return proxiedMeasurement.proxy; },
    }).tick(request);
    assert.equal(result.disposition, 'COMMITTED_NEW');
    assert.equal(result.measurement.state, 'UNKNOWN');
    assert.deepEqual(result.measurement.reasonCodes, ['PERFORMANCE_EVIDENCE_INVALID']);
    assert.equal(proxiedMeasurement.counter.count, 0);

    const revokedMeasurement = Proxy.revocable(validMeasurement, {});
    revokedMeasurement.revoke();
    const revokedResult = new StrategyDecayCoordinator(new StrategyDecayLedgerAdapter(ledger), {
      readPerformanceMeasurement() { return revokedMeasurement.proxy; },
    }).tick({ ...request, direction: 'short_spot_long_perp' });
    assert.doesNotThrow(() => revokedResult);
    assert.equal(revokedResult.disposition, 'COMMITTED_NEW');
    assert.equal(revokedResult.measurement.state, 'UNKNOWN');
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

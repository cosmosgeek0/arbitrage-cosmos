import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../dist/ledger.js';
import {
  STRATEGY_DECAY_AXES,
  STRATEGY_DECAY_MEASUREMENT_SCHEMA,
  STRATEGY_DECAY_MEASUREMENT_SCHEMA_VERSION,
  StrategyDecayLedgerAdapter,
  deriveStrategyDecayPolicyRevision,
  evaluateStrategyDecayGovernance,
  strategyDecayConfigKey,
  validateStrategyDecayMeasurement,
} from '../dist/engine/decay/index.js';

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
  return Object.freeze({
    schema: STRATEGY_DECAY_MEASUREMENT_SCHEMA,
    schemaVersion: STRATEGY_DECAY_MEASUREMENT_SCHEMA_VERSION,
    measurementId: `decaymeas_${sequence.toString(16).padStart(32, '0')}`,
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
    ...overrides,
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

test('canonical Ledger CAS preserves every decision event while bounding the restart snapshot', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-engine-decay-'));
  const ledger = new Ledger(dataDir);
  const adapter = new StrategyDecayLedgerAdapter(ledger);
  const boundedPolicy = policy({ maximumRecentDecisions: 3 });
  try {
    let loaded = adapter.load('BASIS');
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
      loaded = adapter.load('BASIS');
      assert.equal(loaded.status, 'AVAILABLE');
      state = loaded.state;
    }
    assert.equal(state.recentDecisions.length, 3);
    assert.equal(state.compactedDecisionCount, 3);
    assert.equal(state.totalDecisionCount, 6);
    assert.equal(ledger.recentEvents(20, 'strategy.decay.decision', 'BASIS').length, 6);
    assert.equal(ledger.getConfigValue(strategyDecayConfigKey('BASIS')), loaded.serialized);

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
test('an independently opened stale Ledger writer appends no retirement history', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-engine-decay-race-'));
  const firstLedger = new Ledger(dataDir);
  const secondLedger = new Ledger(dataDir);
  const first = new StrategyDecayLedgerAdapter(firstLedger);
  const second = new StrategyDecayLedgerAdapter(secondLedger);
  try {
    const firstLoad = first.load('VOLUME');
    const secondLoad = second.load('VOLUME');
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

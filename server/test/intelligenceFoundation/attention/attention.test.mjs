import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  ATTENTION_DEFAULTS,
  attentionConfig,
  planAttention,
  planAttentionFromPorts,
} from '../../../dist/intelligenceFoundation/attention/index.js';
import { validateTruthMetadata } from '../../../dist/intelligenceFoundation/contracts/index.js';

const ALL_ZERO_DWELL = {
  UNIVERSE: 0,
  WATCH: 0,
  CANDIDATE: 0,
  FOCUS: 0,
  DEEP_FOCUS: 0,
  RELEASED: 0,
};

function truth(atMs, overrides = {}) {
  const base = {
    schemaVersion: '1',
    producerVersion: 'attention-test-fixture-1',
    configurationVersion: 'fixture-1',
    featureVersion: 'features-1',
    authority: {
      kind: 'REPLAY_SUPPLIED',
      sourceId: 'attention-synthetic-fixture',
      dataset: 'candidate-input',
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: [`fixture:${atMs}`],
      sourceSet: ['attention-synthetic-fixture'],
      transforms: ['official-shaped-synthetic-fixture-v1'],
    },
    temporal: {
      sourceEventTimeMs: atMs,
      sourceTransactionTimeMs: null,
      receivedTimeMs: atMs,
      sequence: null,
    },
    freshness: {
      basis: 'SOURCE_EVENT_TIME',
      evaluatedAtMs: atMs,
      ageMs: 0,
      maxAgeMs: 1_000_000,
      state: 'FRESH',
    },
    completeness: {
      state: 'COMPLETE',
      observedFields: ['candidate_hint', 'source_quality'],
      missingFields: [],
      reasonCodes: [],
    },
  };
  return {
    ...base,
    ...overrides,
    authority: { ...base.authority, ...(overrides.authority ?? {}) },
    provenance: { ...base.provenance, ...(overrides.provenance ?? {}) },
    temporal: { ...base.temporal, ...(overrides.temporal ?? {}) },
    freshness: { ...base.freshness, ...(overrides.freshness ?? {}) },
    completeness: { ...base.completeness, ...(overrides.completeness ?? {}) },
  };
}

function instrument(id, atMs = 0, overrides = {}) {
  return {
    instrumentId: id,
    symbol: id.toUpperCase(),
    protectedCapital: false,
    releaseRequested: false,
    releaseReasonCodes: [],
    focusEligibility: { state: 'ELIGIBLE', reasonCodes: [] },
    sourceQuality: { state: 'HEALTHY', reasonCodes: [] },
    truth: truth(atMs),
    ...overrides,
  };
}

function hint(id, instrumentId, atMs, overrides = {}) {
  return {
    id,
    strategy: 'volume_spike',
    instrumentId,
    symbol: instrumentId.toUpperCase(),
    sourceState: 'FOCUS',
    engineObservedAtMs: atMs,
    priority: 0.6,
    reasonCodes: ['SYNTHETIC_WAKEUP'],
    protected: false,
    upstreamCorrelationId: null,
    truth: truth(atMs, {
      authority: { kind: 'ENGINE_DERIVED', sourceId: `synthetic-${id}`, dataset: 'candidate-hints', endpointClass: 'INJECTED' },
      provenance: { sourceRecordIds: [id], sourceSet: [`synthetic-${id}`], transforms: ['synthetic-hint-v1'] },
    }),
    ...overrides,
  };
}

function config(overrides = {}) {
  return attentionConfig({
    configurationVersion: 'attention-test-1',
    minTierDwellMs: ALL_ZERO_DWELL,
    signalHoldMs: 100,
    promotionCooldownMs: 1_000,
    hintStaleAfterMs: 100,
    ...overrides,
  });
}

function ok(result) {
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.failure));
  return result.value;
}

function planAt(atMs, instruments, hints, previousAllocations, cfg) {
  return ok(planAttention({ atMs, instruments, hints, previousAllocations }, cfg));
}

function advance(instruments, hintFactory, cfg, steps, startAt = 0) {
  let previousAllocations;
  let result;
  for (let step = 0; step < steps; step += 1) {
    const atMs = startAt + step;
    result = planAt(atMs, instruments, hintFactory(atMs), previousAllocations, cfg);
    previousAllocations = result.allocations;
  }
  return result;
}

test('full relevant universe keeps cheap coverage, including quiet symbols', () => {
  const instruments = [instrument('quietusdt'), instrument('activeusdt'), instrument('dormantusdt')];
  const result = planAt(0, instruments, [], undefined, config());
  assert.equal(result.allocations.length, instruments.length);
  assert.deepEqual(result.allocations.map((entry) => entry.instrumentId), ['activeusdt', 'dormantusdt', 'quietusdt']);
  assert.ok(result.allocations.every((entry) => entry.tier === 'UNIVERSE'));
  assert.ok(result.allocations.every((entry) => entry.requestedEvidence.includes('TRADE') && entry.requestedEvidence.includes('BOOK_TICKER')));
  assert.equal(result.tierCounts.UNIVERSE, 3);
  assert.equal(result.requests.length, 3, 'new symbols explicitly request broad coverage');
  assert.equal(result.truth.authority.sourceId, 'intelligence-foundation-attention');
  assert.equal(validateTruthMetadata(result.truth).ok, true);
  assert.ok(result.allocations.every((entry) => validateTruthMetadata(entry.truth).ok));
});

test('generic Basis and Volume hint ports drive progressive enrichment without engine imports', () => {
  const instruments = [instrument('wakeusdt')];
  const cfg = config();
  let previousAllocations;
  const tiers = [];
  for (let atMs = 0; atMs < 4; atMs += 1) {
    const basisPort = {
      portId: 'basis-hints',
      readCandidateHints: (now) => [hint(`basis-${now}`, 'wakeusdt', now, { strategy: 'basis', sourceState: 'WATCHING', priority: 0.2 })],
    };
    const volumePort = {
      portId: 'volume-hints',
      readCandidateHints: (now) => [hint(`volume-${now}`, 'wakeusdt', now, { priority: 0.9, sourceState: 'FOCUS' })],
    };
    const result = ok(planAttentionFromPorts({ atMs, instruments, previousAllocations }, [volumePort, basisPort], cfg));
    tiers.push(result.allocations[0].tier);
    previousAllocations = result.allocations;
  }
  assert.deepEqual(tiers, ['WATCH', 'CANDIDATE', 'FOCUS', 'DEEP_FOCUS']);
  const final = previousAllocations[0];
  assert.ok(final.requestedEvidence.includes('LIQUIDATION'));
  assert.ok(final.requestedEvidence.includes('BORROW'));
  assert.ok(final.requestedFeatures.includes('market_specific_residual'));
  assert.equal(final.hintIds.length, 2);
});

test('cumulative hard caps use deterministic priority and stable tie eviction', () => {
  const instruments = ['ausdt', 'busdt', 'cusdt'].map((id) => instrument(id));
  const wide = config({
    tierCaps: { ...ATTENTION_DEFAULTS.tierCaps, WATCH: 3, CANDIDATE: 3, FOCUS: 3, DEEP_FOCUS: 3 },
  });
  const hintFactory = (atMs) => instruments.map((entry) => hint(`hint-${entry.instrumentId}-${atMs}`, entry.instrumentId, atMs));
  const focused = advance(instruments, hintFactory, wide, 3);
  assert.ok(focused.allocations.every((entry) => entry.tier === 'FOCUS'));

  const narrow = config({
    tierCaps: { ...ATTENTION_DEFAULTS.tierCaps, WATCH: 3, CANDIDATE: 3, FOCUS: 1, DEEP_FOCUS: 1 },
  });
  const left = planAt(10, instruments, hintFactory(10), focused.allocations, narrow);
  const right = planAt(10, [...instruments].reverse(), [...hintFactory(10)].reverse(), [...focused.allocations].reverse(), narrow);
  assert.deepEqual(
    left.allocations.map((entry) => [entry.instrumentId, entry.tier, entry.demotionReasons]),
    right.allocations.map((entry) => [entry.instrumentId, entry.tier, entry.demotionReasons]),
  );
  assert.equal(left.allocations.find((entry) => entry.tier === 'FOCUS').instrumentId, 'ausdt');
  assert.equal(left.allocations.filter((entry) => entry.tier === 'FOCUS').length, 1);
  assert.ok(left.allocations.filter((entry) => entry.tier === 'CANDIDATE').every((entry) => entry.demotionReasons.includes('CAPACITY_EVICTED')));
  assert.equal(left.id, right.id);
});

test('active capital is protected from eviction and impossible protected capacity fails closed', () => {
  const wide = config({
    tierCaps: { ...ATTENTION_DEFAULTS.tierCaps, WATCH: 2, CANDIDATE: 2, FOCUS: 2, DEEP_FOCUS: 2 },
  });
  const initialInstruments = [instrument('ordinaryusdt'), instrument('protectedusdt')];
  const focused = advance(initialInstruments, (atMs) => [
    hint(`ordinary-${atMs}`, 'ordinaryusdt', atMs, { priority: 0.99 }),
    hint(`protected-${atMs}`, 'protectedusdt', atMs, { priority: 0.01 }),
  ], wide, 3);
  const cfg = config({
    tierCaps: { ...ATTENTION_DEFAULTS.tierCaps, WATCH: 2, CANDIDATE: 2, FOCUS: 1, DEEP_FOCUS: 1 },
  });
  const protectedInstrument = instrument('protectedusdt', 0, { protectedCapital: true });
  const ordinary = instrument('ordinaryusdt');
  const result = planAt(10, [ordinary, protectedInstrument], [
    hint('ordinary-high', 'ordinaryusdt', 10, { priority: 0.99 }),
    hint('protected-low', 'protectedusdt', 10, { priority: 0.01 }),
  ], focused.allocations, cfg);
  assert.equal(result.allocations.find((entry) => entry.instrumentId === 'protectedusdt').tier, 'FOCUS');
  assert.equal(result.allocations.find((entry) => entry.instrumentId === 'ordinaryusdt').tier, 'CANDIDATE');

  const overflow = planAttention({
    atMs: 0,
    instruments: [
      instrument('protected-a', 0, { protectedCapital: true }),
      instrument('protected-b', 0, { protectedCapital: true }),
    ],
  }, cfg);
  assert.equal(overflow.ok, false);
  assert.equal(overflow.failure.code, 'PROTECTED_CAPITAL');
});

test('signal hysteresis and cooldown prevent focus thrashing', () => {
  const instruments = [instrument('thrashusdt')];
  const cfg = config({ signalHoldMs: 100, promotionCooldownMs: 1_000 });
  const focused = advance(instruments, (atMs) => [hint(`focus-${atMs}`, 'thrashusdt', atMs)], cfg, 3);
  assert.equal(focused.allocations[0].tier, 'FOCUS');

  const held = planAt(50, instruments, [], focused.allocations, cfg);
  assert.equal(held.allocations[0].tier, 'FOCUS');
  assert.ok(held.allocations[0].demotionReasons.includes('SIGNAL_HYSTERESIS_HOLD'));

  const released = planAt(150, instruments, [], held.allocations, cfg);
  assert.equal(released.allocations[0].tier, 'RELEASED');
  assert.deepEqual(released.allocations[0].requestedEvidence, []);

  const blocked = planAt(200, instruments, [hint('returns-too-soon', 'thrashusdt', 200)], released.allocations, cfg);
  assert.equal(blocked.allocations[0].tier, 'RELEASED');
  assert.ok(blocked.allocations[0].demotionReasons.includes('COOLDOWN_ACTIVE'));

  const expired = planAt(1_150, instruments, [hint('returns-later', 'thrashusdt', 1_150)], blocked.allocations, cfg);
  assert.equal(expired.allocations[0].tier, 'UNIVERSE');
  const reentered = planAt(1_151, instruments, [hint('returns-later-2', 'thrashusdt', 1_151)], expired.allocations, cfg);
  assert.equal(reentered.allocations[0].tier, 'WATCH');
});

test('stale and future hints are ignored rather than refreshed by planning time', () => {
  const cfg = config({ hintStaleAfterMs: 10, maxFutureHintSkewMs: 2 });
  const instruments = [instrument('staleusdt')];
  const result = planAt(100, instruments, [
    hint('stale-hint', 'staleusdt', 0),
    hint('future-hint', 'staleusdt', 103),
    hint('expired-truth', 'staleusdt', 100, {
      truth: truth(0, { freshness: { maxAgeMs: 10 } }),
    }),
    hint('future-truth', 'staleusdt', 100, {
      truth: truth(101),
    }),
    hint('expired-transaction-truth', 'staleusdt', 100, {
      truth: truth(100, { temporal: { sourceTransactionTimeMs: 0 }, freshness: { maxAgeMs: 10 } }),
    }),
    hint('future-transaction-truth', 'staleusdt', 100, {
      truth: truth(100, { temporal: { sourceTransactionTimeMs: 101 } }),
    }),
  ], undefined, cfg);
  assert.equal(result.allocations[0].tier, 'UNIVERSE');
  assert.deepEqual(Object.fromEntries(result.ignoredHints.map((entry) => [entry.hintId, entry.reasonCode])), {
    'expired-truth': 'STALE_HINT',
    'expired-transaction-truth': 'STALE_HINT',
    'future-hint': 'FUTURE_HINT',
    'future-transaction-truth': 'FUTURE_HINT',
    'future-truth': 'FUTURE_HINT',
    'stale-hint': 'STALE_HINT',
  });
  assert.equal(result.allocations[0].truth.temporal.sourceEventTimeMs, 0, 'source time is preserved');
  assert.equal(result.allocations[0].truth.temporal.receivedTimeMs, 0, 'planning time never replaces receipt time');
});

test('focus-ineligible, delisted, and missing-product rows remain visible but cannot consume focus', () => {
  const instruments = [
    instrument('eligibleusdt'),
    instrument('delistedusdt', 0, {
      focusEligibility: { state: 'INELIGIBLE', reasonCodes: ['SPOT_STATUS_INACTIVE'] },
    }),
    instrument('missingperpusdt', 0, {
      focusEligibility: { state: 'INELIGIBLE', reasonCodes: ['USD_M_PERPETUAL_REQUIRED_MISSING'] },
    }),
    instrument('unknownproductusdt', 0, {
      focusEligibility: { state: 'UNKNOWN', reasonCodes: ['FOCUSED_PRODUCT_COVERAGE_UNKNOWN'] },
    }),
  ];
  const cfg = config({
    tierCaps: { ...ATTENTION_DEFAULTS.tierCaps, WATCH: 4, CANDIDATE: 4, FOCUS: 4, DEEP_FOCUS: 4 },
  });
  const result = advance(
    instruments,
    (atMs) => instruments.map((entry) => hint(`eligibility-${entry.instrumentId}-${atMs}`, entry.instrumentId, atMs, {
      sourceState: 'PROPOSED',
      priority: 0.99,
    })),
    cfg,
    4,
  );
  const byId = Object.fromEntries(result.allocations.map((entry) => [entry.instrumentId, entry]));
  assert.equal(result.allocations.length, instruments.length, 'broad universe visibility is never filtered');
  assert.equal(byId.eligibleusdt.tier, 'DEEP_FOCUS');
  assert.equal(byId.delistedusdt.tier, 'CANDIDATE');
  assert.equal(byId.missingperpusdt.tier, 'CANDIDATE');
  assert.equal(byId.unknownproductusdt.tier, 'WATCH');
  assert.ok(byId.delistedusdt.demotionReasons.includes('SPOT_STATUS_INACTIVE'));
  assert.ok(byId.missingperpusdt.demotionReasons.includes('USD_M_PERPETUAL_REQUIRED_MISSING'));
  assert.deepEqual(byId.delistedusdt.focusEligibility, {
    state: 'INELIGIBLE',
    reasonCodes: ['SPOT_STATUS_INACTIVE'],
  });
});

test('previous allocations cannot carry future signal or candidate timestamps', () => {
  const instruments = [instrument('previoususdt')];
  const cfg = config();
  const watched = planAt(0, instruments, [hint('previous-0', 'previoususdt', 0)], undefined, cfg);
  const futureSignal = structuredClone(watched.allocations[0]);
  futureSignal.lastSignalAtMs = 2;
  const signalResult = planAttention({
    atMs: 1,
    instruments,
    hints: [hint('previous-1', 'previoususdt', 1)],
    previousAllocations: [futureSignal],
  }, cfg);
  assert.equal(signalResult.ok, false);
  assert.equal(signalResult.failure.code, 'OUT_OF_ORDER_EVENT');

  const candidate = planAt(1, instruments, [hint('candidate-1', 'previoususdt', 1)], watched.allocations, cfg);
  assert.equal(candidate.allocations[0].tier, 'CANDIDATE');
  const futureCandidate = structuredClone(candidate.allocations[0]);
  futureCandidate.candidateOpenedAtMs = 3;
  const candidateResult = planAttention({
    atMs: 2,
    instruments,
    hints: [hint('candidate-2', 'previoususdt', 2)],
    previousAllocations: [futureCandidate],
  }, cfg);
  assert.equal(candidateResult.ok, false);
  assert.equal(candidateResult.failure.code, 'OUT_OF_ORDER_EVENT');
});

test('derived allocation and plan provenance remain bounded after deterministic unions', () => {
  const sourceRecordIds = Array.from({ length: 256 }, (_, index) => `upstream-record:${String(index).padStart(3, '0')}`);
  const sourceSet = Array.from({ length: 64 }, (_, index) => `upstream-source:${String(index).padStart(2, '0')}`);
  const boundedInstrument = instrument('boundedusdt', 0, {
    truth: truth(0, { provenance: { sourceRecordIds, sourceSet } }),
  });
  const manyHints = Array.from({ length: 64 }, (_, index) => hint(`bounded-hint:${index}`, 'boundedusdt', 0, {
    sourceState: 'PROPOSED',
    priority: 0.99,
  }));
  const allocationPlan = planAt(0, [boundedInstrument], manyHints, undefined, config());
  const allocationTruth = allocationPlan.allocations[0].truth;
  assert.equal(allocationTruth.provenance.sourceRecordIds.length, 256);
  assert.equal(allocationTruth.provenance.sourceSet.length, 64);
  assert.equal(allocationTruth.completeness.state, 'PARTIAL');
  assert.ok(allocationTruth.completeness.reasonCodes.includes('ATTENTION_PROVENANCE_RECORD_IDS_TRUNCATED'));
  assert.ok(allocationTruth.completeness.reasonCodes.includes('ATTENTION_PROVENANCE_SOURCE_SET_TRUNCATED'));
  assert.equal(validateTruthMetadata(allocationTruth).ok, true);

  const largeUniverse = Array.from({ length: 300 }, (_, index) => instrument(`universe-${String(index).padStart(3, '0')}`));
  const universePlan = planAt(0, largeUniverse, [], undefined, config());
  assert.equal(universePlan.truth.provenance.sourceRecordIds.length, 256);
  assert.equal(universePlan.truth.completeness.state, 'PARTIAL');
  assert.ok(universePlan.truth.completeness.reasonCodes.includes('ATTENTION_PROVENANCE_RECORD_IDS_TRUNCATED'));
  assert.equal(validateTruthMetadata(universePlan.truth).ok, true);
});

test('degraded, stale, and failed sources cap promotion while protected capital stays focused', () => {
  const healthyInstruments = ['degraded', 'stale', 'failed', 'protected-failed'].map((id) => instrument(id));
  const cfg = config({
    tierCaps: { ...ATTENTION_DEFAULTS.tierCaps, WATCH: 4, CANDIDATE: 4, FOCUS: 4, DEEP_FOCUS: 4 },
  });
  const focused = advance(
    healthyInstruments,
    (atMs) => healthyInstruments.map((entry) => hint(`hint-${entry.instrumentId}-${atMs}`, entry.instrumentId, atMs)),
    cfg,
    3,
  );
  const changed = [
    instrument('degraded', 0, { sourceQuality: { state: 'DEGRADED', reasonCodes: ['PARTIAL_DEPTH'] } }),
    instrument('stale', 0, { sourceQuality: { state: 'STALE', reasonCodes: ['FUTURES_STALE'] } }),
    instrument('failed', 0, { sourceQuality: { state: 'FAILED', reasonCodes: ['SOURCE_FAILED'] } }),
    instrument('protected-failed', 0, { protectedCapital: true, sourceQuality: { state: 'FAILED', reasonCodes: ['SOURCE_FAILED'] } }),
  ];
  const result = planAt(
    10,
    changed,
    changed.map((entry) => hint(`fresh-${entry.instrumentId}`, entry.instrumentId, 10, { priority: 0.9 })),
    focused.allocations,
    cfg,
  );
  const tierOf = (id) => result.allocations.find((entry) => entry.instrumentId === id).tier;
  assert.equal(tierOf('degraded'), 'CANDIDATE');
  assert.equal(tierOf('stale'), 'WATCH');
  assert.equal(tierOf('failed'), 'UNIVERSE');
  assert.equal(tierOf('protected-failed'), 'FOCUS');
  assert.equal(result.allocations.find((entry) => entry.instrumentId === 'failed').truth.freshness.state, 'UNAVAILABLE');
  assert.ok(result.allocations.find((entry) => entry.instrumentId === 'protected-failed').demotionReasons.includes('PROTECTED_CAPITAL_SOURCE_FAILED'));
});

test('hint-port failure is contained, redacted, and does not suppress a healthy independent hint', () => {
  const instruments = [instrument('portusdt')];
  const failedPort = {
    portId: 'basis-hints',
    readCandidateHints() {
      throw new Error('sensitive transport detail must not escape');
    },
  };
  const healthyPort = {
    portId: 'volume-hints',
    readCandidateHints(atMs) {
      return [hint('healthy-port-hint', 'portusdt', atMs, { sourceState: 'WATCHING', priority: 0.1 })];
    },
  };
  const result = ok(planAttentionFromPorts({ atMs: 0, instruments }, [failedPort, healthyPort], config()));
  assert.equal(result.allocations[0].tier, 'WATCH');
  assert.equal(result.hintPortFailures.length, 1);
  assert.equal(result.hintPortFailures[0].code, 'UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result), /sensitive transport detail/);
  assert.equal(result.truth.completeness.state, 'PARTIAL');
});

test('explicit release requests stop enrichment, honor cooldown, and cannot discard active capital', () => {
  const baseInstrument = instrument('releaseusdt');
  const cfg = config();
  const focused = advance([baseInstrument], (atMs) => [hint(`release-hint-${atMs}`, 'releaseusdt', atMs)], cfg, 3);
  const releasedInstrument = instrument('releaseusdt', 0, { releaseRequested: true, releaseReasonCodes: ['OPERATOR_RELEASE'] });
  const released = planAt(10, [releasedInstrument], [], focused.allocations, cfg);
  assert.equal(released.allocations[0].tier, 'RELEASED');
  assert.ok(released.allocations[0].demotionReasons.includes('OPERATOR_RELEASE'));
  assert.deepEqual(released.allocations[0].requestedFeatures, []);

  const protectedInstrument = instrument('releaseusdt', 0, {
    protectedCapital: true,
    releaseRequested: true,
    releaseReasonCodes: ['OPERATOR_RELEASE'],
  });
  const protectedResult = planAt(11, [protectedInstrument], [], focused.allocations, cfg);
  assert.equal(protectedResult.allocations[0].tier, 'FOCUS');
  assert.ok(protectedResult.allocations[0].promotionReasons.includes('PROTECTED_ACTIVE_CAPITAL'));
});

test('invalid, duplicate, secret-bearing, and oversized inputs fail with stable named failures', () => {
  const cfg = config({
    tierCaps: { ...ATTENTION_DEFAULTS.tierCaps, UNIVERSE: 1, RELEASED: 1, WATCH: 1, CANDIDATE: 1, FOCUS: 1, DEEP_FOCUS: 1 },
  });
  const oversized = planAttention({ atMs: 0, instruments: [instrument('a'), instrument('b')] }, cfg);
  assert.equal(oversized.ok, false);
  assert.equal(oversized.failure.code, 'BUDGET_EXHAUSTED');

  const duplicate = planAttention({ atMs: 0, instruments: [instrument('a'), instrument('a')] }, cfg);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.failure.code, 'BUDGET_EXHAUSTED', 'universe bound fails before any partial allocation');

  const duplicateWithinCapacity = planAttention({ atMs: 0, instruments: [instrument('a'), instrument('a')] }, config());
  assert.equal(duplicateWithinCapacity.ok, false);
  assert.equal(duplicateWithinCapacity.failure.code, 'INVALID_VALUE');

  const contaminated = instrument('a');
  contaminated.extra = { credentials: { apiKey: 'must-not-survive' } };
  const secret = planAttention({ atMs: 0, instruments: [contaminated] }, config());
  assert.equal(secret.ok, false);
  assert.equal(secret.failure.code, 'SECRET_FIELD_REJECTED');
  assert.doesNotMatch(JSON.stringify(secret.failure), /must-not-survive/);

  const hintBound = config({ maxHintsPerPlan: 1, maxHintsPerInstrument: 1 });
  const tooManyHints = planAttention({
    atMs: 0,
    instruments: [instrument('a')],
    hints: [hint('hint-a', 'a', 0), hint('hint-b', 'a', 0)],
  }, hintBound);
  assert.equal(tooManyHints.ok, false);
  assert.equal(tooManyHints.failure.code, 'BUDGET_EXHAUSTED');
});

test('attention output is resource-only and contains no proposal or execution artifacts', () => {
  const result = advance(
    [instrument('resourceonly')],
    (atMs) => [hint(`resource-only-${atMs}`, 'resourceonly', atMs, { sourceState: 'PROPOSED', priority: 0.99 })],
    config(),
    4,
  );
  const forbiddenKeys = new Set(['proposal', 'proposals', 'order', 'orders', 'orderIntent', 'execution', 'tradeInstruction']);
  const visit = (value) => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(visit);
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `forbidden resource-planner key: ${key}`);
      visit(child);
    }
  };
  visit(result);
  assert.equal(result.allocations[0].tier, 'DEEP_FOCUS');
});

test('configuration rejects incoherent caps, thresholds, and released resources', () => {
  assert.throws(() => attentionConfig({
    tierCaps: { ...ATTENTION_DEFAULTS.tierCaps, FOCUS: 30, CANDIDATE: 20 },
  }), /FOCUS cap exceeds CANDIDATE/);
  assert.throws(() => attentionConfig({
    priorityThresholds: { WATCH: 1, CANDIDATE: 0, FOCUS: 2, DEEP_FOCUS: 3 },
  }), /thresholds must be ascending/);
  assert.throws(() => attentionConfig({
    profiles: {
      ...ATTENTION_DEFAULTS.profiles,
      RELEASED: { requestedEvidence: ['TRADE'], requestedFeatures: [] },
    },
  }), /RELEASED must request no resources/);
  assert.throws(() => attentionConfig({
    focusEligibilityTierCeilings: { INELIGIBLE: 'FOCUS' },
  }), /INELIGIBLE focus eligibility must remain below FOCUS/);
});

test('attention import is pure: no fetch, socket, timer, or engine runtime starts', () => {
  const moduleUrl = new URL('../../../dist/intelligenceFoundation/attention/index.js', import.meta.url).href;
  const script = `
    let timers = 0;
    globalThis.fetch = () => { throw new Error('fetch forbidden'); };
    globalThis.WebSocket = class { constructor() { throw new Error('socket forbidden'); } };
    const originalTimeout = globalThis.setTimeout;
    const originalInterval = globalThis.setInterval;
    globalThis.setTimeout = (...args) => { timers += 1; return originalTimeout(...args); };
    globalThis.setInterval = (...args) => { timers += 1; return originalInterval(...args); };
    await import(${JSON.stringify(moduleUrl)});
    globalThis.setTimeout = originalTimeout;
    globalThis.setInterval = originalInterval;
    if (timers !== 0) throw new Error('attention import scheduled a timer');
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 2_000 });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

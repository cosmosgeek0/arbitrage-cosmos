import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { canonicalJson, stableId } from '../../../dist/intelligenceFoundation/contracts/index.js';
import {
  EMPTY_OUTCOME_STATE,
  attributeOutcome,
  freezePreEvent,
  reduceOutcomeState,
  summarizeOutcomeCohorts,
  validateOutcomeLabel,
} from '../../../dist/intelligenceFoundation/outcomes/index.js';

const TRIGGER = 1_800_000_000_000;
const CONFIGURATION_VERSION = 'outcomes-cfg-1';
const FEATURE_VERSION = 'features-1';

const instrument = {
  instrumentId: stableId('instrument', { venue: 'BINANCE', family: 'SPOT', symbol: 'TESTUSDT' }),
  venue: 'BINANCE',
  productFamily: 'SPOT',
  symbol: 'TESTUSDT',
  pair: 'TESTUSDT',
  baseAsset: 'TEST',
  quoteAsset: 'USDT',
  contractType: null,
  sourceMarketType: null,
};

function truth(eventTimeMs, options = {}) {
  const receivedTimeMs = options.receivedTimeMs ?? eventTimeMs + 10;
  const evaluatedAtMs = options.evaluatedAtMs ?? receivedTimeMs;
  const maxAgeMs = options.maxAgeMs ?? 1_000;
  const ageMs = evaluatedAtMs - eventTimeMs;
  return {
    schemaVersion: '1',
    producerVersion: options.producerVersion ?? 'outcomes-fixture-1',
    configurationVersion: CONFIGURATION_VERSION,
    featureVersion: options.featureVersion ?? FEATURE_VERSION,
    authority: {
      kind: 'EXCHANGE_PRIMARY',
      sourceId: options.sourceId ?? 'binance-spot',
      dataset: options.dataset ?? 'fixture',
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: [options.recordId ?? `raw:${eventTimeMs}`],
      sourceSet: [options.sourceId ?? 'binance-spot'],
      transforms: ['fixture-normalize-v1'],
    },
    temporal: {
      sourceEventTimeMs: eventTimeMs,
      sourceTransactionTimeMs: eventTimeMs,
      receivedTimeMs,
      sequence: null,
    },
    freshness: {
      basis: 'SOURCE_EVENT_TIME',
      evaluatedAtMs,
      ageMs,
      maxAgeMs,
      state: ageMs <= maxAgeMs ? 'FRESH' : 'STALE',
    },
    completeness: {
      state: 'COMPLETE',
      observedFields: ['fixture'],
      missingFields: [],
      reasonCodes: [],
    },
  };
}

function trade(id, eventTimeMs, price) {
  return {
    id,
    kind: 'TRADE',
    instrument,
    truth: truth(eventTimeMs, { recordId: id, dataset: 'aggregate-trade' }),
    aggregateTradeId: String(eventTimeMs),
    firstTradeId: String(eventTimeMs),
    lastTradeId: String(eventTimeMs),
    price,
    baseQuantity: 1,
    quoteQuantity: price,
    normalBaseQuantityExcludingRpi: 1,
    aggressorSide: 'BUY',
  };
}

function book(id, eventTimeMs, bidPrice, askPrice, quantity) {
  return {
    id,
    kind: 'BOOK_TICKER',
    instrument,
    truth: truth(eventTimeMs, { recordId: id, dataset: 'book-ticker' }),
    updateId: String(eventTimeMs),
    bidPrice,
    bidQuantity: quantity,
    askPrice,
    askQuantity: quantity,
  };
}

function depth(id, eventTimeMs, quantity) {
  const depthTruth = truth(eventTimeMs, { recordId: id, dataset: 'depth' });
  depthTruth.temporal.sequence = {
    first: String(eventTimeMs),
    last: String(eventTimeMs),
    previous: String(eventTimeMs - 1),
  };
  return {
    id,
    kind: 'DEPTH_SNAPSHOT',
    instrument,
    truth: depthTruth,
    bids: [{ price: 99, baseQuantity: quantity }, { price: 98, baseQuantity: quantity }],
    asks: [{ price: 101, baseQuantity: quantity }, { price: 102, baseQuantity: quantity }],
    bookScope: 'STANDARD_NO_RPI',
    maximumLevelsKnown: 4,
  };
}

function funding(id, eventTimeMs) {
  return {
    id,
    kind: 'FUNDING',
    instrument: { ...instrument, productFamily: 'USD_M_PERPETUAL', sourceMarketType: 1, contractType: 'PERPETUAL' },
    truth: truth(eventTimeMs, { recordId: id, dataset: 'funding' }),
    fundingRate: 0.0001,
    fundingIntervalHours: 4,
    nextFundingTimeMs: TRIGGER + 60_000,
    adjustedRateCap: null,
    adjustedRateFloor: null,
  };
}

function freezeInput(disposition = 'ACCEPTED') {
  const referenceTrade = trade('trade:reference', TRIGGER - 100, 100);
  const referenceBook = book('book:reference', TRIGGER - 90, 99, 101, 10);
  const referenceDepth = depth('depth:reference', TRIGGER - 80, 5);
  const featureTruth = truth(TRIGGER - 75, { recordId: 'feature:flow', dataset: 'features' });
  const feature = {
    id: 'feature:flow',
    instrumentId: instrument.instrumentId,
    feature: 'relative-volume',
    featureVersion: FEATURE_VERSION,
    value: 2,
    unit: 'ratio',
    windowMs: 5_000,
    observationStartMs: TRIGGER - 5_000,
    observationEndMs: TRIGGER - 75,
    truth: featureTruth,
  };
  const thesisTruth = truth(TRIGGER - 50, { recordId: 'thesis:1', dataset: 'thesis' });
  const fact = {
    id: 'fact:flow',
    fact: 'flow changed before price',
    polarity: 'SUPPORTING',
    reasonCode: 'FLOW_FIRST',
    featureIds: [feature.id],
    evidenceIds: [referenceTrade.id],
    observationStartMs: TRIGGER - 5_000,
    observationEndMs: TRIGGER - 75,
    truth: featureTruth,
  };
  const thesis = {
    id: 'thesis:1',
    instrumentId: instrument.instrumentId,
    hypothesis: 'SPOT_LED_EXPANSION',
    stage: 'EARLY_CHANGE',
    changedFirst: 'flow',
    changedAtMs: TRIGGER - 75,
    leadMarket: 'SPOT',
    supporting: [fact],
    conflicting: [],
    neutral: [],
    unavailable: [],
    tradeability: {
      state: 'SUPPORTED',
      reasonCodes: ['DEPTH_PRESENT'],
      requiredEvidenceIds: [referenceDepth.id],
      missingEvidenceKinds: [],
    },
    analogueIds: [],
    reasonCodes: ['FLOW_FIRST'],
    truth: thesisTruth,
  };
  const forensic = {
    id: 'forensic:one-print',
    check: 'one-print spike',
    verdict: 'PASS',
    severity: 'BLOCK',
    reasonCodes: ['MULTIPLE_PRINTS'],
    evidenceIds: [referenceTrade.id],
    observationStartMs: TRIGGER - 1_000,
    observationEndMs: TRIGGER - 75,
    truth: featureTruth,
  };
  return {
    triggerTimeMs: TRIGGER,
    evidenceCutoffTimeMs: TRIGGER,
    candidateDisposition: disposition,
    thesis,
    forensics: [forensic],
    evidence: [referenceDepth, referenceTrade, referenceBook],
    features: [feature],
    configurationVersion: CONFIGURATION_VERSION,
    featureVersion: FEATURE_VERSION,
    producerVersion: 'outcomes-freeze-1',
  };
}

function completePolicy(overrides = {}) {
  return {
    horizonMs: 3_000,
    direction: 'UP',
    movedThresholdPct: 8,
    terminalMaxAgeMs: 100,
    requiredMetricFields: [
      'forwardReturnPct', 'maximumFavorableExcursionPct', 'maximumAdverseExcursionPct',
      'fadeFromPeakPct', 'timeToPeakMs', 'liquiditySurvivalRatio', 'depthSurvivalRatio',
      'theoreticalExecutionFeasible', 'laterMoved',
    ],
    referenceEvidenceId: 'trade:reference',
    priceBasis: 'TRADE',
    liquidity: { referenceEvidenceId: 'book:reference' },
    depth: { referenceEvidenceId: 'depth:reference' },
    execution: {
      depthEvidenceId: 'depth:reference',
      side: 'BUY',
      intendedBaseQuantity: 8,
      maximumSlippagePct: 0.5,
    },
    ...overrides,
  };
}

function laterEvidence() {
  return [
    trade('trade:1', TRIGGER + 1_000, 110),
    depth('depth:1', TRIGGER + 1_100, 2.5),
    trade('trade:2', TRIGGER + 2_000, 95),
    depth('depth:2', TRIGGER + 2_500, 4),
    trade('trade:3', TRIGGER + 3_000, 105),
    book('book:terminal', TRIGGER + 3_000, 104, 106, 5),
  ];
}

function frozen(disposition = 'ACCEPTED') {
  const result = freezePreEvent(freezeInput(disposition));
  assert.equal(result.ok, true, result.ok ? '' : result.failure.message);
  return result.value;
}

function rewriteVersions(value, configurationVersion, featureVersion) {
  if (value === null || typeof value !== 'object') return;
  if (Object.hasOwn(value, 'configurationVersion')) value.configurationVersion = configurationVersion;
  if (Object.hasOwn(value, 'featureVersion')) value.featureVersion = featureVersion;
  for (const child of Object.values(value)) rewriteVersions(child, configurationVersion, featureVersion);
}

test('pre-event freeze is permutation-stable, canonical, and recursively immutable', () => {
  const original = freezeInput();
  const reversed = structuredClone(original);
  reversed.evidence.reverse();
  reversed.thesis.supporting[0].featureIds.reverse();
  const first = freezePreEvent(original);
  const second = freezePreEvent(reversed);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.value.id, second.value.id);
  assert.equal(canonicalJson(first.value), canonicalJson(second.value));
  assert.equal(Object.isFrozen(first.value), true);
  assert.equal(Object.isFrozen(first.value.evidence), true);
  assert.equal(Object.isFrozen(first.value.thesis.supporting[0]), true);
  assert.throws(() => first.value.evidence.push(trade('trade:bad', TRIGGER, 1)), TypeError);
});

test('freeze blocks epistemic future evidence while preserving known future funding facts', () => {
  const input = freezeInput();
  const knownFutureFunding = funding('funding:known-future', TRIGGER - 70);
  knownFutureFunding.instrument = { ...knownFutureFunding.instrument, instrumentId: instrument.instrumentId };
  input.evidence.push(knownFutureFunding);
  const allowed = freezePreEvent(input);
  assert.equal(allowed.ok, true, allowed.ok ? '' : allowed.failure.message);
  assert.equal(allowed.value.evidence.find((item) => item.id === knownFutureFunding.id).nextFundingTimeMs, TRIGGER + 60_000);

  const future = freezeInput();
  const futureTruth = truth(TRIGGER + 1, { receivedTimeMs: TRIGGER + 1, evaluatedAtMs: TRIGGER + 1 });
  futureTruth.temporal.sequence = {
    first: String(TRIGGER + 1),
    last: String(TRIGGER + 1),
    previous: String(TRIGGER),
  };
  future.evidence[0].truth = futureTruth;
  const rejected = freezePreEvent(future);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.failure.code, 'NO_LOOK_AHEAD_VIOLATION');
});

test('outcome attribution is strictly horizon-gated', () => {
  const result = attributeOutcome({
    frozen: frozen(),
    evaluatedAtMs: TRIGGER + 2_999,
    policy: completePolicy(),
    laterEvidence: laterEvidence(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'HORIZON_NOT_REACHED');
});

test('UP attribution calculates exact return, excursions, fade, survival, and execution feasibility', () => {
  const result = attributeOutcome({
    frozen: frozen(),
    evaluatedAtMs: TRIGGER + 3_100,
    policy: completePolicy(),
    laterEvidence: laterEvidence(),
  });
  assert.equal(result.ok, true, result.ok ? '' : result.failure.message);
  const label = result.value;
  assert.equal(label.state, 'COMPLETE');
  assert.equal(label.observationTimeMs, TRIGGER + 3_000);
  assert.equal(label.laterMoved, true);
  assert.equal(label.metrics.forwardReturnPct, 5);
  assert.equal(label.metrics.maximumFavorableExcursionPct, 10);
  assert.equal(label.metrics.maximumAdverseExcursionPct, 5);
  assert.equal(label.metrics.fadeFromPeakPct, 4.545454545455);
  assert.equal(label.metrics.timeToPeakMs, 1_000);
  assert.equal(label.metrics.liquiditySurvivalRatio, 0.525);
  assert.equal(label.metrics.depthSurvivalRatio, 0.5);
  assert.equal(label.metrics.theoreticalExecutionFeasible, true);
  assert.equal(label.missingFields.length, 0);
  assert.equal(label.truth.completeness.state, 'PARTIAL');
  assert.ok(label.truth.completeness.reasonCodes.includes('UPSTREAM_FRESHNESS_STALE'));
});

test('DOWN attribution uses direction-aware excursions and earliest favorable extreme', () => {
  const result = attributeOutcome({
    frozen: frozen(),
    evaluatedAtMs: TRIGGER + 3_100,
    policy: completePolicy({
      direction: 'DOWN',
      requiredMetricFields: ['forwardReturnPct', 'maximumFavorableExcursionPct', 'maximumAdverseExcursionPct', 'fadeFromPeakPct', 'timeToPeakMs', 'laterMoved'],
      liquidity: undefined,
      depth: undefined,
      execution: undefined,
    }),
    laterEvidence: laterEvidence(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.state, 'COMPLETE');
  assert.equal(result.value.metrics.forwardReturnPct, -5);
  assert.equal(result.value.metrics.maximumFavorableExcursionPct, 5);
  assert.equal(result.value.metrics.maximumAdverseExcursionPct, 10);
  assert.equal(result.value.metrics.fadeFromPeakPct, 10.526315789474);
  assert.equal(result.value.metrics.timeToPeakMs, 2_000);
});

test('post-horizon events and not-yet-received evidence cannot change an attribution', () => {
  const base = attributeOutcome({
    frozen: frozen(), evaluatedAtMs: TRIGGER + 3_100, policy: completePolicy(), laterEvidence: laterEvidence(),
  });
  const futureEvent = trade('trade:future-event', TRIGGER + 4_000, 500);
  const notReceived = trade('trade:not-received', TRIGGER + 2_900, 500);
  notReceived.truth = truth(TRIGGER + 2_900, { receivedTimeMs: TRIGGER + 5_000, evaluatedAtMs: TRIGGER + 5_000 });
  const withFuture = attributeOutcome({
    frozen: frozen(),
    evaluatedAtMs: TRIGGER + 3_100,
    policy: completePolicy(),
    laterEvidence: [...laterEvidence(), futureEvent, notReceived],
  });
  assert.equal(base.ok, true);
  assert.equal(withFuture.ok, true);
  assert.deepEqual(withFuture.value.metrics, base.value.metrics);
  assert.equal(withFuture.value.laterMoved, base.value.laterMoved);
});

test('unavailable reference and execution evidence remain null and explicitly incomplete', () => {
  const result = attributeOutcome({
    frozen: frozen(),
    evaluatedAtMs: TRIGGER + 3_100,
    policy: completePolicy({
      referenceEvidenceId: 'trade:missing',
      execution: { ...completePolicy().execution, depthEvidenceId: 'depth:missing' },
    }),
    laterEvidence: laterEvidence(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.state, 'INCOMPLETE');
  assert.equal(result.value.laterMoved, null);
  assert.equal(result.value.metrics.forwardReturnPct, null);
  assert.equal(result.value.metrics.theoreticalExecutionFeasible, null);
  assert.ok(result.value.missingFields.includes('forwardReturnPct'));
  assert.ok(result.value.missingFields.includes('theoreticalExecutionFeasible'));
  assert.ok(result.value.truth.completeness.reasonCodes.includes('INCOMPLETE_OUTCOME'));
});

test('known insufficient depth produces false rather than unknown execution feasibility', () => {
  const result = attributeOutcome({
    frozen: frozen(),
    evaluatedAtMs: TRIGGER + 3_100,
    policy: completePolicy({ execution: { ...completePolicy().execution, intendedBaseQuantity: 100 } }),
    laterEvidence: laterEvidence(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.metrics.theoreticalExecutionFeasible, false);
  assert.equal(result.value.state, 'COMPLETE');
});

test('freeze re-ages evidence at the cutoff and stale depth cannot claim execution feasibility', () => {
  const input = freezeInput();
  input.evidence = input.evidence.map((item) => item.id === 'depth:reference'
    ? depth('depth:reference', TRIGGER - 10_000, 5)
    : item);
  const recordResult = freezePreEvent(input);
  assert.equal(recordResult.ok, true, recordResult.ok ? '' : recordResult.failure.message);
  const record = recordResult.value;
  const frozenDepth = record.evidence.find((item) => item.id === 'depth:reference');
  assert.equal(frozenDepth.truth.freshness.state, 'STALE');
  assert.equal(record.truth.completeness.state, 'PARTIAL');
  assert.ok(record.truth.completeness.reasonCodes.includes('UPSTREAM_FRESHNESS_STALE'));

  const outcome = attributeOutcome({
    frozen: record,
    evaluatedAtMs: TRIGGER + 3_100,
    policy: completePolicy(),
    laterEvidence: laterEvidence(),
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.value.metrics.theoreticalExecutionFeasible, null);
  assert.equal(outcome.value.state, 'INCOMPLETE');
  assert.ok(outcome.value.missingFields.includes('theoreticalExecutionFeasible'));
});

test('depth survival fails closed when book scope or advertised level coverage differs', () => {
  const evidence = laterEvidence();
  const mismatched = evidence.find((item) => item.id === 'depth:2');
  mismatched.maximumLevelsKnown = 8;
  const result = attributeOutcome({
    frozen: frozen(),
    evaluatedAtMs: TRIGGER + 3_100,
    policy: completePolicy(),
    laterEvidence: evidence,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.metrics.depthSurvivalRatio, null);
  assert.equal(result.value.state, 'INCOMPLETE');
  assert.ok(result.value.missingFields.includes('depthSurvivalRatio'));
});

test('material policy changes produce distinct stable policy and label identities', () => {
  const record = frozen();
  const first = attributeOutcome({ frozen: record, evaluatedAtMs: TRIGGER + 3_100, policy: completePolicy(), laterEvidence: laterEvidence() });
  const thresholdChanged = attributeOutcome({ frozen: record, evaluatedAtMs: TRIGGER + 3_100, policy: completePolicy({ movedThresholdPct: 9 }), laterEvidence: laterEvidence() });
  const executionChanged = attributeOutcome({
    frozen: record,
    evaluatedAtMs: TRIGGER + 3_100,
    policy: completePolicy({ execution: { ...completePolicy().execution, intendedBaseQuantity: 7 } }),
    laterEvidence: laterEvidence(),
  });
  assert.equal(first.ok, true);
  assert.equal(thresholdChanged.ok, true);
  assert.equal(executionChanged.ok, true);
  assert.notEqual(first.value.policy.id, thresholdChanged.value.policy.id);
  assert.notEqual(first.value.id, thresholdChanged.value.id);
  assert.notEqual(first.value.policy.id, executionChanged.value.policy.id);
  assert.notEqual(first.value.id, executionChanged.value.id);
});

test('label validation returns a recursively frozen defensive value', () => {
  const outcome = attributeOutcome({ frozen: frozen(), evaluatedAtMs: TRIGGER + 3_100, policy: completePolicy(), laterEvidence: laterEvidence() });
  assert.equal(outcome.ok, true);
  const callerOwned = structuredClone(outcome.value);
  const validated = validateOutcomeLabel(callerOwned);
  assert.equal(validated.ok, true);
  assert.equal(Object.isFrozen(validated.value), true);
  assert.equal(Object.isFrozen(validated.value.policy), true);
  callerOwned.metrics.forwardReturnPct = 999;
  assert.equal(validated.value.metrics.forwardReturnPct, 5);
  assert.throws(() => { validated.value.policy.movedThresholdPct = 0; }, TypeError);
});

test('reducer is idempotent, horizon-validates labels, and retains incomplete outcomes', () => {
  const record = frozen();
  const incomplete = attributeOutcome({
    frozen: record,
    evaluatedAtMs: TRIGGER + 3_100,
    policy: completePolicy({ referenceEvidenceId: 'trade:missing' }),
    laterEvidence: laterEvidence(),
  });
  assert.equal(incomplete.ok, true);
  const withRecord = reduceOutcomeState(EMPTY_OUTCOME_STATE, { type: 'FROZEN_RECORD_ADDED', record });
  assert.equal(withRecord.ok, true);
  const withLabel = reduceOutcomeState(withRecord.value, { type: 'OUTCOME_LABEL_ADDED', label: incomplete.value });
  assert.equal(withLabel.ok, true);
  assert.equal(withLabel.value.labels[0].state, 'INCOMPLETE');
  const replayed = reduceOutcomeState(withLabel.value, { type: 'OUTCOME_LABEL_ADDED', label: incomplete.value });
  assert.equal(replayed.ok, true);
  assert.equal(canonicalJson(replayed.value), canonicalJson(withLabel.value));
  assert.equal(Object.isFrozen(withLabel.value.labels), true);
  const callerOwned = structuredClone(withLabel.value);
  const defensive = reduceOutcomeState(callerOwned, { type: 'OUTCOME_LABEL_ADDED', label: incomplete.value });
  assert.equal(defensive.ok, true);
  assert.notEqual(defensive.value, callerOwned);
  assert.equal(Object.isFrozen(defensive.value), true);
  callerOwned.labels[0].metrics.forwardReturnPct = 999;
  assert.notEqual(defensive.value.labels[0].metrics.forwardReturnPct, 999);
});

test('accepted and rejected candidates receive separate deterministic cohort attribution', () => {
  const accepted = frozen('ACCEPTED');
  const rejected = frozen('REJECTED');
  const acceptedLabel = attributeOutcome({ frozen: accepted, evaluatedAtMs: TRIGGER + 3_100, policy: completePolicy(), laterEvidence: laterEvidence() });
  const rejectedLabel = attributeOutcome({ frozen: rejected, evaluatedAtMs: TRIGGER + 3_100, policy: completePolicy(), laterEvidence: laterEvidence() });
  assert.equal(acceptedLabel.ok, true);
  assert.equal(rejectedLabel.ok, true);
  let state = EMPTY_OUTCOME_STATE;
  for (const record of [accepted, rejected]) {
    const next = reduceOutcomeState(state, { type: 'FROZEN_RECORD_ADDED', record });
    assert.equal(next.ok, true);
    state = next.value;
  }
  for (const label of [acceptedLabel.value, rejectedLabel.value]) {
    const next = reduceOutcomeState(state, { type: 'OUTCOME_LABEL_ADDED', label });
    assert.equal(next.ok, true);
    state = next.value;
  }
  const cohorts = summarizeOutcomeCohorts(state);
  assert.equal(cohorts.ok, true);
  assert.equal(cohorts.value.length, 1);
  assert.deepEqual(cohorts.value[0].accepted, { total: 1, moved: 1, didNotMove: 0, unknown: 0 });
  assert.deepEqual(cohorts.value[0].rejected, { total: 1, moved: 1, didNotMove: 0, unknown: 0 });
  assert.equal(cohorts.value[0].metricMeans.forwardReturnPct, 5);
  assert.deepEqual(cohorts.value[0].executionFeasibility, { evaluated: 2, feasible: 2, infeasible: 0, unknown: 0, feasibleRate: 1 });
  assert.equal(Object.hasOwn(cohorts.value[0].metricMeans, 'theoreticalExecutionFeasible'), false);
  assert.equal(Object.hasOwn(cohorts.value[0], 'recommendedThreshold'), false);
});

test('cohorts separate horizon, direction, price basis, and full policy identity', () => {
  const record = frozen('ACCEPTED');
  const up = attributeOutcome({ frozen: record, evaluatedAtMs: TRIGGER + 3_100, policy: completePolicy(), laterEvidence: laterEvidence() });
  const down = attributeOutcome({ frozen: record, evaluatedAtMs: TRIGGER + 3_100, policy: completePolicy({ direction: 'DOWN' }), laterEvidence: laterEvidence() });
  const short = attributeOutcome({
    frozen: record,
    evaluatedAtMs: TRIGGER + 2_100,
    policy: completePolicy({
      horizonMs: 2_000,
      direction: 'UP',
      terminalMaxAgeMs: 100,
      requiredMetricFields: ['forwardReturnPct', 'maximumFavorableExcursionPct', 'maximumAdverseExcursionPct', 'fadeFromPeakPct', 'timeToPeakMs', 'laterMoved'],
      liquidity: undefined,
      depth: undefined,
      execution: undefined,
    }),
    laterEvidence: laterEvidence(),
  });
  assert.equal(up.ok, true);
  assert.equal(down.ok, true);
  assert.equal(short.ok, true);
  let state = EMPTY_OUTCOME_STATE;
  for (const event of [
    { type: 'FROZEN_RECORD_ADDED', record },
    { type: 'OUTCOME_LABEL_ADDED', label: up.value },
    { type: 'OUTCOME_LABEL_ADDED', label: down.value },
    { type: 'OUTCOME_LABEL_ADDED', label: short.value },
  ]) {
    const next = reduceOutcomeState(state, event);
    assert.equal(next.ok, true, next.ok ? '' : next.failure.message);
    state = next.value;
  }
  const cohorts = summarizeOutcomeCohorts(state);
  assert.equal(cohorts.ok, true);
  assert.equal(cohorts.value.length, 3);
  assert.deepEqual(cohorts.value.map((cohort) => [cohort.horizonMs, cohort.direction, cohort.priceBasis]).sort(), [
    [2_000, 'UP', 'TRADE'],
    [3_000, 'DOWN', 'TRADE'],
    [3_000, 'UP', 'TRADE'],
  ].sort());
  assert.equal(new Set(cohorts.value.map((cohort) => cohort.policyId)).size, 3);
});

test('cohorts remain separated by exact configuration and feature versions', () => {
  const first = frozen('OBSERVED');
  const secondInput = freezeInput('OBSERVED');
  rewriteVersions(secondInput, 'outcomes-cfg-2', 'features-2');
  const secondResult = freezePreEvent(secondInput);
  assert.equal(secondResult.ok, true, secondResult.ok ? '' : secondResult.failure.message);
  const second = secondResult.value;
  const firstLabel = attributeOutcome({ frozen: first, evaluatedAtMs: TRIGGER + 3_100, policy: completePolicy(), laterEvidence: laterEvidence() });
  const secondLabel = attributeOutcome({ frozen: second, evaluatedAtMs: TRIGGER + 3_100, policy: completePolicy(), laterEvidence: laterEvidence() });
  assert.equal(firstLabel.ok, true);
  assert.equal(secondLabel.ok, true);
  let state = EMPTY_OUTCOME_STATE;
  for (const event of [
    { type: 'FROZEN_RECORD_ADDED', record: first },
    { type: 'FROZEN_RECORD_ADDED', record: second },
    { type: 'OUTCOME_LABEL_ADDED', label: firstLabel.value },
    { type: 'OUTCOME_LABEL_ADDED', label: secondLabel.value },
  ]) {
    const next = reduceOutcomeState(state, event);
    assert.equal(next.ok, true);
    state = next.value;
  }
  const cohorts = summarizeOutcomeCohorts(state);
  assert.equal(cohorts.ok, true);
  assert.deepEqual(cohorts.value.map((cohort) => [cohort.configurationVersion, cohort.featureVersion]), [
    ['outcomes-cfg-1', 'features-1'],
    ['outcomes-cfg-2', 'features-2'],
  ]);
});

test('later evidence ordering is deterministic and attribution never mutates the frozen record', () => {
  const record = frozen();
  const before = canonicalJson(record);
  const forward = attributeOutcome({ frozen: record, evaluatedAtMs: TRIGGER + 3_100, policy: completePolicy(), laterEvidence: laterEvidence() });
  const reverse = attributeOutcome({ frozen: record, evaluatedAtMs: TRIGGER + 3_100, policy: completePolicy(), laterEvidence: laterEvidence().reverse() });
  assert.equal(forward.ok, true);
  assert.equal(reverse.ok, true);
  assert.equal(canonicalJson(forward.value), canonicalJson(reverse.value));
  assert.equal(canonicalJson(record), before);
});

test('secret-bearing outcome inputs fail closed without reflecting the value', () => {
  const policy = completePolicy();
  policy.xApiKey = 'must-not-appear';
  const result = attributeOutcome({ frozen: frozen(), evaluatedAtMs: TRIGGER + 3_100, policy, laterEvidence: laterEvidence() });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'SECRET_FIELD_REJECTED');
  assert.doesNotMatch(JSON.stringify(result.failure), /must-not-appear/);
});

test('outcomes import is pure: no network, socket, or timer starts', () => {
  const moduleUrl = new URL('../../../dist/intelligenceFoundation/outcomes/index.js', import.meta.url).href;
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
    if (timers !== 0) throw new Error('import scheduled a timer');
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 2_000 });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

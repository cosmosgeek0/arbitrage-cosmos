import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { validateFrozenPreEventRecord } from '../../../dist/intelligenceFoundation/contracts/index.js';
import {
  buildThesisPacket,
  classifyHypothesis,
  classifyMarketStage,
  thesisRules,
} from '../../../dist/intelligenceFoundation/thesis/index.js';

const NOW = 1_000_000;
const FEATURE_VERSION = 'features-v1';
const rules = thesisRules();

function truth(timeMs, options = {}) {
  const maxAgeMs = options.maxAgeMs ?? 60_000;
  const state = options.state ?? (NOW - timeMs <= maxAgeMs ? 'FRESH' : 'STALE');
  const completeness = options.completeness ?? 'COMPLETE';
  return {
    schemaVersion: '1',
    producerVersion: options.producerVersion ?? 'fixture-v1',
    configurationVersion: options.configurationVersion ?? 'fixture-cfg-v1',
    featureVersion: options.featureVersion === undefined ? null : options.featureVersion,
    authority: {
      kind: options.authorityKind ?? 'EXCHANGE_DERIVED',
      sourceId: options.sourceId ?? 'fixture-source',
      dataset: options.dataset ?? 'fixture',
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: [options.recordId ?? `raw:${timeMs}`],
      sourceSet: [options.sourceId ?? 'fixture-source'],
      transforms: ['fixture-normalize-v1'],
    },
    temporal: {
      sourceEventTimeMs: timeMs,
      sourceTransactionTimeMs: timeMs,
      receivedTimeMs: timeMs + 1,
      sequence: options.sequence ?? null,
    },
    freshness: {
      basis: 'SOURCE_EVENT_TIME',
      evaluatedAtMs: NOW,
      ageMs: NOW - timeMs,
      maxAgeMs,
      state,
    },
    completeness: {
      state: completeness,
      observedFields: completeness === 'MISSING' ? [] : completeness === 'PARTIAL' ? ['observedValue'] : ['value'],
      missingFields: completeness === 'COMPLETE' ? [] : ['value'],
      reasonCodes: completeness === 'COMPLETE' ? [] : ['FIXTURE_INCOMPLETE'],
    },
  };
}

const instrument = {
  instrumentId: 'instrument:btcusdt-spot',
  venue: 'BINANCE',
  productFamily: 'SPOT',
  symbol: 'BTCUSDT',
  pair: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  contractType: null,
  sourceMarketType: null,
};

function feature(name, value, windowMs, endMs, suffix = '') {
  return {
    id: `feature:${name}:${windowMs ?? 'none'}:${endMs}:${String(value)}${suffix}`,
    instrumentId: instrument.instrumentId,
    feature: name,
    featureVersion: FEATURE_VERSION,
    value,
    unit: typeof value === 'boolean' ? 'flag' : 'ratio',
    windowMs,
    observationStartMs: Math.max(0, endMs - (windowMs ?? 0)),
    observationEndMs: endMs,
    truth: truth(endMs, { featureVersion: FEATURE_VERSION, recordId: `source:${name}:${endMs}${suffix}` }),
  };
}

function replaceFeature(features, name, windowMs, replacement) {
  return features.filter((entry) => !(entry.feature === name && entry.windowMs === windowMs)).concat(replacement);
}

function fullDepth(endMs = NOW - 500) {
  return {
    id: `depth:${endMs}`,
    kind: 'DEPTH_SNAPSHOT',
    instrument,
    truth: truth(endMs, {
      sequence: { first: '10', last: '10', previous: '9' },
      recordId: `raw-depth:${endMs}`,
    }),
    bids: [{ price: 99, baseQuantity: 10 }, { price: 98, baseQuantity: 20 }],
    asks: [{ price: 101, baseQuantity: 10 }, { price: 102, baseQuantity: 20 }],
    bookScope: 'STANDARD_NO_RPI',
    maximumLevelsKnown: 5_000,
  };
}

function baseFeatures() {
  const b = rules.bindings;
  const values = [];
  const addWindows = (name, entries) => {
    values.push(
      feature(name, entries[0], rules.shortWindowMs, entries[3]),
      feature(name, entries[1], rules.confirmationWindowMs, entries[4]),
      feature(name, entries[2], rules.mediumWindowMs, entries[5]),
    );
  };
  addWindows(b.spotRelativeVolume, [2.8, 2.7, 2.5, NOW - 10_000, NOW - 9_900, NOW - 9_800]);
  addWindows(b.perpetualRelativeVolume, [2.4, 2.3, 2.2, NOW - 8_000, NOW - 7_900, NOW - 7_800]);
  addWindows(b.spotArrivalAcceleration, [1.8, 1.7, 1.6, NOW - 9_700, NOW - 9_600, NOW - 9_500]);
  addWindows(b.perpetualArrivalAcceleration, [1.6, 1.6, 1.5, NOW - 7_700, NOW - 7_600, NOW - 7_500]);
  addWindows(b.symbolReturnPct, [0.2, 0.5, 0.7, NOW - 5_000, NOW - 4_900, NOW - 4_800]);
  addWindows(b.spotReturnPct, [0.2, 0.5, 0.7, NOW - 4_700, NOW - 4_600, NOW - 4_500]);
  addWindows(b.perpetualReturnPct, [0.15, 0.45, 0.65, NOW - 4_400, NOW - 4_300, NOW - 4_200]);
  const confirmation = rules.confirmationWindowMs;
  values.push(
    feature(b.aggressorImbalance, 0.4, confirmation, NOW - 4_000),
    feature(b.priceResponsePerFlow, 0.2, confirmation, NOW - 3_900),
    feature(b.depthSupportRatio, 1.5, confirmation, NOW - 3_800),
    feature(b.depthChangeRatio, 1, confirmation, NOW - 3_700),
    feature(b.spreadChangeBps, 0, confirmation, NOW - 3_600),
    feature(b.replenishmentRatio, 1, confirmation, NOW - 3_500),
    feature(b.absorptionRatio, 1, confirmation, NOW - 3_400),
    feature(b.fundingRateChange, 0.001, confirmation, NOW - 3_300),
    feature(b.openInterestChangePct, 1, confirmation, NOW - 3_200),
    feature(b.liquidationFlowShare, 0.11, confirmation, NOW - 3_100),
    feature(b.marketParticipationRatio, 0.1, confirmation, NOW - 3_000),
    feature(b.symbolMarketResidualReturnPct, 0.5, confirmation, NOW - 2_900),
    feature(b.fadeFromPeakPct, 0, confirmation, NOW - 2_800),
    feature(b.historicalAnalogueCount, 1, null, NOW - 2_750),
    feature(b.tradeSizeRepeatRatio, 0.1, confirmation, NOW - 2_700),
    feature(b.sideAlternationRatio, 0.1, confirmation, NOW - 2_600),
    feature(b.deadBaselineFlag, false, null, NOW - 2_500),
  );
  return values;
}

function baseInput(overrides = {}) {
  return {
    candidate: {
      id: 'candidate:btc',
      instrumentId: instrument.instrumentId,
      openedAtMs: NOW - 1_000,
      updatedAtMs: NOW - 500,
      reasonCodes: ['ACTIVITY_CHANGED'],
      score: null,
      hintIds: [],
      truth: truth(NOW - 500, { authorityKind: 'ENGINE_DERIVED', sourceId: 'candidate-fixture' }),
    },
    baseline: {
      id: 'baseline:btc',
      instrumentId: instrument.instrumentId,
      state: 'READY',
      sampleCount: 100,
      capacity: 500,
      sessionBucket: '00',
      normalActivity: [],
      deadActivity: [],
      truth: truth(NOW - 1_000, { authorityKind: 'ENGINE_DERIVED', sourceId: 'baseline-fixture' }),
    },
    features: baseFeatures(),
    evidence: [fullDepth()],
    analogueIds: ['analogue:1'],
    evaluatedAtMs: NOW,
    intendedQuoteNotional: 10_000,
    requiredEvidenceKinds: ['DEPTH_SNAPSHOT'],
    ...overrides,
  };
}

function stageInput(overrides = {}) {
  return {
    baselineReady: true,
    shortMovePct: 0.01,
    confirmationMovePct: 0.01,
    mediumMovePct: 0.01,
    shortActivityMultiple: 1,
    confirmationActivityMultiple: 1,
    mediumActivityMultiple: 1,
    shortArrivalAcceleration: 1,
    confirmationArrivalAcceleration: 1,
    mediumArrivalAcceleration: 1,
    aggressorImbalance: 0,
    depthSupportRatio: 1.5,
    depthChangeRatio: 1,
    spreadChangeBps: 0,
    fadeFromPeakPct: 0,
    candidateOpenedAtMs: NOW - 1_000,
    changedAtMs: NOW - 2_000,
    ...overrides,
  };
}

test('market-stage classifier covers every frozen stage with required precedence', () => {
  const cases = [
    ['QUIET', stageInput()],
    ['EARLY_CHANGE', stageInput({ shortMovePct: 0.1, confirmationMovePct: 0.1, shortActivityMultiple: 3 })],
    ['BEFORE_VISIBLE_MOVE', stageInput({ shortMovePct: 0.1, confirmationMovePct: 0.1, shortActivityMultiple: 3, confirmationActivityMultiple: 3, aggressorImbalance: 0.3 })],
    ['VISIBLE_EXPANSION', stageInput({ shortMovePct: 0.2, confirmationMovePct: 0.5, shortActivityMultiple: 3 })],
    ['CONTINUATION', stageInput({ shortMovePct: 0.2, confirmationMovePct: 0.5, mediumMovePct: 0.7, shortActivityMultiple: 3, confirmationActivityMultiple: 3, mediumActivityMultiple: 3, aggressorImbalance: 0.3 })],
    ['EXHAUSTION', stageInput({ shortMovePct: 0.5, confirmationMovePct: 1, mediumMovePct: 1.5, shortActivityMultiple: 1, confirmationActivityMultiple: 3, shortArrivalAcceleration: 0, spreadChangeBps: 2 })],
    ['REVERSAL', stageInput({ shortMovePct: -0.2, confirmationMovePct: 0.8, mediumMovePct: 1, fadeFromPeakPct: 0.7 })],
    ['TOO_LATE', stageInput({ confirmationMovePct: 0.5, mediumMovePct: 0.5, changedAtMs: NOW - 200_000 })],
    ['UNCLASSIFIED', stageInput({ baselineReady: false, shortMovePct: null, confirmationMovePct: null, mediumMovePct: null, shortActivityMultiple: null, confirmationActivityMultiple: null, mediumActivityMultiple: null, shortArrivalAcceleration: null, confirmationArrivalAcceleration: null, mediumArrivalAcceleration: null, aggressorImbalance: null, depthSupportRatio: null, depthChangeRatio: null, spreadChangeBps: null, fadeFromPeakPct: null, changedAtMs: null })],
  ];
  for (const [expected, input] of cases) {
    assert.equal(classifyMarketStage(input, rules).stage, expected, expected);
  }
});

test('medium-window visible move cannot regress to before-visible stage', () => {
  const classified = classifyMarketStage(stageInput({
    shortMovePct: 0.1,
    confirmationMovePct: 0.1,
    mediumMovePct: 0.6,
    shortActivityMultiple: 3,
    confirmationActivityMultiple: 3,
    aggressorImbalance: 0.3,
  }), rules);
  assert.equal(classified.stage, 'VISIBLE_EXPANSION');
});

function hypothesisInput(overrides = {}) {
  return {
    stage: 'EARLY_CHANGE',
    leadMarket: 'UNKNOWN',
    deadBaseline: false,
    spotActivityHot: null,
    persistentActivity: null,
    visibleMove: false,
    aggressorImbalance: null,
    priceResponsePerFlow: null,
    depthSupportRatio: null,
    depthChangeRatio: null,
    replenishmentRatio: null,
    absorptionRatio: null,
    fundingRateChange: null,
    openInterestChangePct: null,
    liquidationFlowShare: null,
    marketParticipationRatio: null,
    symbolMarketResidualReturnPct: null,
    tradeSizeRepeatRatio: null,
    sideAlternationRatio: null,
    ...overrides,
  };
}

test('hypothesis classifier covers every named evidence-backed class', () => {
  const cases = [
    ['DEAD_VOLUME_WAKEUP', hypothesisInput({ deadBaseline: true })],
    ['ACCUMULATION_TO_EXPANSION', hypothesisInput({ stage: 'BEFORE_VISIBLE_MOVE', persistentActivity: true, aggressorImbalance: 0.4, absorptionRatio: 1.4 })],
    ['SPOT_LED_EXPANSION', hypothesisInput({ stage: 'VISIBLE_EXPANSION', leadMarket: 'SPOT', persistentActivity: true, visibleMove: true, priceResponsePerFlow: 0.2 })],
    ['PERPETUAL_LED_SQUEEZE', hypothesisInput({ stage: 'VISIBLE_EXPANSION', leadMarket: 'PERPETUAL', visibleMove: true, fundingRateChange: 0.001, openInterestChangePct: 1 })],
    ['LIQUIDATION_DRIVEN_MOVE', hypothesisInput({ stage: 'VISIBLE_EXPANSION', leadMarket: 'PERPETUAL', visibleMove: true, liquidationFlowShare: 0.3, openInterestChangePct: -1 })],
    ['MARKET_WIDE_BETA_MOVE', hypothesisInput({ stage: 'VISIBLE_EXPANSION', visibleMove: true, marketParticipationRatio: 0.8, symbolMarketResidualReturnPct: 0.05 })],
    ['THIN_BOOK_DISLOCATION', hypothesisInput({ stage: 'VISIBLE_EXPANSION', visibleMove: true, depthSupportRatio: 0.5 })],
    ['CHURN_WITHOUT_FOLLOW_THROUGH', hypothesisInput({ persistentActivity: true, aggressorImbalance: 0.01, priceResponsePerFlow: 0.01, tradeSizeRepeatRatio: 0.8, sideAlternationRatio: 0.8 })],
    ['EXHAUSTED_MOVE', hypothesisInput({ stage: 'EXHAUSTION', visibleMove: true })],
    ['UNCLASSIFIED_ANOMALY', hypothesisInput()],
  ];
  for (const [expected, input] of cases) {
    assert.equal(classifyHypothesis(input, rules).hypothesis, expected, expected);
  }
});

test('builder produces a deterministic spot-led packet with aligned references and grouped polarities', () => {
  const input = baseInput();
  const result = buildThesisPacket(input, rules);
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.failure));
  assert.equal(result.value.hypothesis, 'SPOT_LED_EXPANSION');
  assert.equal(result.value.stage, 'CONTINUATION');
  assert.equal(result.value.leadMarket, 'SPOT');
  assert.equal(result.value.changedFirst, 'SPOT_ACTIVITY');
  assert.equal(result.value.changedAtMs, NOW - 10_000);
  assert.equal(result.value.tradeability.state, 'SUPPORTED');
  assert.deepEqual(result.value.tradeability.requiredEvidenceIds, [input.evidence[0].id]);

  const featureIds = new Set(input.features.map((entry) => entry.id));
  const evidenceIds = new Set(input.evidence.map((entry) => entry.id));
  for (const [group, polarity] of [
    ['supporting', 'SUPPORTING'],
    ['conflicting', 'CONFLICTING'],
    ['neutral', 'NEUTRAL'],
    ['unavailable', 'UNAVAILABLE'],
  ]) {
    for (const fact of result.value[group]) {
      assert.equal(fact.polarity, polarity);
      assert.equal(fact.featureIds.every((id) => featureIds.has(id)), true);
      assert.equal(fact.evidenceIds.every((id) => evidenceIds.has(id)), true);
    }
  }
  assert.equal(result.value.conflicting.some((fact) => fact.reasonCode === 'DERIVATIVES_ALIGNED'), true);
  assert.equal(result.value.neutral.some((fact) => fact.reasonCode === 'HISTORICAL_ANALOGUES_ATTACHED'), true);

  const reversed = buildThesisPacket({
    ...input,
    features: [...input.features].reverse(),
    evidence: [...input.evidence].reverse(),
    analogueIds: [...input.analogueIds].reverse(),
  }, rules);
  assert.equal(reversed.ok, true);
  assert.deepEqual(reversed.value, result.value);
});

test('packet passes the hardened frozen-record polarity and dependency checks', () => {
  const input = baseInput();
  const built = buildThesisPacket(input, rules);
  assert.equal(built.ok, true);
  const recordTruth = structuredClone(built.value.truth);
  recordTruth.configurationVersion = rules.version;
  recordTruth.featureVersion = FEATURE_VERSION;
  const frozen = validateFrozenPreEventRecord({
    id: 'frozen:thesis-fixture',
    triggerTimeMs: NOW,
    evidenceCutoffTimeMs: NOW,
    candidateDisposition: 'OBSERVED',
    thesis: built.value,
    forensics: [],
    evidence: input.evidence,
    features: input.features,
    configurationVersion: rules.version,
    featureVersion: FEATURE_VERSION,
    truth: recordTruth,
  });
  assert.equal(frozen.ok, true, frozen.ok ? '' : JSON.stringify(frozen.failure));
});

test('same-time conflicting feature values become unavailable deterministically', () => {
  const input = baseInput();
  const original = input.features.find((entry) => entry.feature === rules.bindings.spotRelativeVolume && entry.windowMs === rules.confirmationWindowMs);
  assert.ok(original);
  const conflicting = {
    ...structuredClone(original),
    id: `${original.id}:conflict`,
    value: original.value + 1,
  };
  input.features.push(conflicting);
  const built = buildThesisPacket(input, rules);
  assert.equal(built.ok, true, built.ok ? '' : JSON.stringify(built.failure));
  assert.equal(built.value.reasonCodes.includes('AMBIGUOUS_SAME_TIME_FEATURE_VALUES'), true);
  const persistenceFact = [...built.value.supporting, ...built.value.conflicting, ...built.value.neutral, ...built.value.unavailable]
    .find((fact) => ['FLOW_PERSISTS_ACROSS_WINDOWS', 'FLOW_DOES_NOT_PERSIST', 'FLOW_PERSISTENCE_UNAVAILABLE'].includes(fact.reasonCode));
  assert.ok(persistenceFact);
  assert.equal(persistenceFact.featureIds.includes(original.id), false);
  assert.equal(persistenceFact.featureIds.includes(conflicting.id), false);

  const reversed = buildThesisPacket({ ...input, features: [...input.features].reverse() }, rules);
  assert.equal(reversed.ok, true);
  assert.deepEqual(reversed.value, built.value);
});

test('a newest stale observation stays unavailable and missing required evidence fails closed', () => {
  const input = baseInput({ evidence: [], requiredEvidenceKinds: ['BORROW'] });
  const name = rules.bindings.priceResponsePerFlow;
  const stale = feature(name, 0.9, rules.confirmationWindowMs, NOW - 2_000, ':stale');
  stale.truth = truth(NOW - 2_000, {
    featureVersion: FEATURE_VERSION,
    maxAgeMs: 1_000,
    state: 'STALE',
    recordId: 'source:stale-response',
  });
  input.features.push(stale);
  const built = buildThesisPacket(input, rules);
  assert.equal(built.ok, true, built.ok ? '' : JSON.stringify(built.failure));
  assert.equal(built.value.unavailable.some((fact) => fact.reasonCode === 'PRICE_RESPONSE_UNAVAILABLE'), true);
  assert.equal(built.value.conflicting.some((fact) => fact.reasonCode === 'PRICE_RESPONSE_UNAVAILABLE'), false);
  assert.equal(built.value.reasonCodes.includes('FEATURE_NOT_FRESH_AND_COMPLETE'), true);
  assert.equal(built.value.tradeability.state, 'UNKNOWN');
  assert.deepEqual(built.value.tradeability.missingEvidenceKinds, ['BORROW', 'DEPTH_SNAPSHOT']);
});

test('derived packet truth preserves stale and partial candidate truth', () => {
  const input = baseInput();
  input.candidate.truth = truth(NOW - 40_000, {
    authorityKind: 'ENGINE_DERIVED',
    sourceId: 'candidate-fixture',
    maxAgeMs: 1_000,
    state: 'STALE',
    completeness: 'PARTIAL',
  });
  const built = buildThesisPacket(input, rules);
  assert.equal(built.ok, true, built.ok ? '' : JSON.stringify(built.failure));
  assert.equal(built.value.truth.freshness.state, 'STALE');
  assert.equal(built.value.truth.completeness.state, 'PARTIAL');
  assert.equal(built.value.truth.completeness.reasonCodes.includes('FIXTURE_INCOMPLETE'), true);
});

test('facts exclude stale normalized evidence and unavailable feature dependencies', () => {
  const input = baseInput();
  const staleDepth = structuredClone(fullDepth(NOW - 40_000));
  staleDepth.id = 'depth:stale';
  staleDepth.truth = truth(NOW - 40_000, {
    maxAgeMs: 1_000,
    state: 'STALE',
    sequence: { first: '11', last: '11', previous: '10' },
    recordId: 'raw-depth:stale',
  });
  input.evidence.push(staleDepth);
  const staleResponse = feature(rules.bindings.priceResponsePerFlow, 0.9, rules.confirmationWindowMs, NOW - 2_000, ':stale-dependency');
  staleResponse.truth = truth(NOW - 2_000, {
    featureVersion: FEATURE_VERSION,
    maxAgeMs: 1_000,
    state: 'STALE',
    recordId: 'source:stale-dependency',
  });
  input.features.push(staleResponse);

  const built = buildThesisPacket(input, rules);
  assert.equal(built.ok, true, built.ok ? '' : JSON.stringify(built.failure));
  const facts = [...built.value.supporting, ...built.value.conflicting, ...built.value.neutral, ...built.value.unavailable];
  assert.equal(facts.every((fact) => !fact.evidenceIds.includes(staleDepth.id)), true);
  assert.equal(facts.every((fact) => !fact.featureIds.includes(staleResponse.id)), true);
});

test('complete mechanical evidence cannot support tradeability while core thesis is unknown', () => {
  const input = baseInput({
    features: [feature(rules.bindings.depthSupportRatio, 1.5, rules.confirmationWindowMs, NOW - 500)],
  });
  const built = buildThesisPacket(input, rules);
  assert.equal(built.ok, true, built.ok ? '' : JSON.stringify(built.failure));
  assert.equal(built.value.stage, 'UNCLASSIFIED');
  assert.equal(built.value.hypothesis, 'UNCLASSIFIED_ANOMALY');
  assert.equal(built.value.tradeability.state, 'UNKNOWN');
  assert.equal(built.value.tradeability.reasonCodes.includes('CORE_THESIS_FACTS_UNAVAILABLE'), true);
  assert.equal(built.value.tradeability.reasonCodes.includes('MARKET_STAGE_UNCLASSIFIED'), true);
  assert.equal(built.value.tradeability.reasonCodes.includes('HYPOTHESIS_UNCLASSIFIED'), true);
});

test('known depth insufficiency blocks while missing intended size remains unknown', () => {
  const low = feature(rules.bindings.depthSupportRatio, 0.5, rules.confirmationWindowMs, NOW - 1_500, ':low');
  const input = baseInput();
  input.features = replaceFeature(input.features, rules.bindings.depthSupportRatio, rules.confirmationWindowMs, low);
  const blocked = buildThesisPacket(input, rules);
  assert.equal(blocked.ok, true, blocked.ok ? '' : JSON.stringify(blocked.failure));
  assert.equal(blocked.value.hypothesis, 'THIN_BOOK_DISLOCATION');
  assert.equal(blocked.value.tradeability.state, 'BLOCKED');
  assert.equal(blocked.value.tradeability.reasonCodes.includes('INTENDED_SIZE_NOT_SUPPORTED_BY_DEPTH'), true);

  const unknown = buildThesisPacket({ ...baseInput(), intendedQuoteNotional: null }, rules);
  assert.equal(unknown.ok, true);
  assert.equal(unknown.value.tradeability.state, 'UNKNOWN');
  assert.equal(unknown.value.tradeability.reasonCodes.includes('INTENDED_SIZE_UNSPECIFIED'), true);
});

test('packet exposes no prescriptive or synthetic-certainty fields', () => {
  const built = buildThesisPacket(baseInput(), rules);
  assert.equal(built.ok, true);
  const forbidden = new Set(['score', 'confidence', 'probability', 'direction', 'proposal']);
  const visit = (value) => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key.toLowerCase()), false, key);
      visit(child);
    }
  };
  visit(built.value);
});

test('thesis module imports are pure and do not reach concrete engine modules', () => {
  const moduleUrl = new URL('../../../dist/intelligenceFoundation/thesis/index.js', import.meta.url).href;
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

  const source = readFileSync(new URL('../../../src/intelligenceFoundation/thesis/builder.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"][^'"]*(?:basis|volume|engine)[^'"]*['"]/i);
});

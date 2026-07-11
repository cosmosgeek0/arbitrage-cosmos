import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FORENSIC_CHECK_KINDS,
  analyzeFalsePositiveForensics,
} from '../../../dist/intelligenceFoundation/forensics/index.js';
import { stableId } from '../../../dist/intelligenceFoundation/contracts/index.js';

const NOW = 1_800_000_000_000;
const FEATURE_VERSION = 'feature-bank-test-1';
const SYMBOL = 'FORENSICSUSDT';

const instrument = (family = 'SPOT') => ({
  instrumentId: family === 'SPOT' ? 'instrument:forensics-primary' : 'instrument:forensics-perpetual',
  venue: 'BINANCE',
  productFamily: family,
  symbol: SYMBOL,
  pair: SYMBOL,
  baseAsset: 'FORENSICS',
  quoteAsset: 'USDT',
  contractType: family === 'SPOT' ? null : 'PERPETUAL',
  sourceMarketType: family === 'USD_M_PERPETUAL' ? 1 : null,
});

function truth(eventMs, id, options = {}) {
  const evaluatedAtMs = options.evaluatedAtMs ?? NOW;
  const receivedTimeMs = options.receivedTimeMs ?? eventMs + 1;
  const maxAgeMs = options.maxAgeMs ?? Math.max(30_000, evaluatedAtMs - eventMs + 1);
  const ageMs = evaluatedAtMs - eventMs;
  const state = options.state ?? (ageMs <= maxAgeMs ? 'FRESH' : 'STALE');
  const completeness = options.completeness ?? 'COMPLETE';
  return {
    schemaVersion: '1',
    producerVersion: 'forensics-fixture-1',
    configurationVersion: 'forensics-fixture-config-1',
    featureVersion: options.featureVersion ?? null,
    authority: {
      kind: 'REPLAY_SUPPLIED',
      sourceId: options.sourceId ?? 'forensics-fixture',
      dataset: options.dataset ?? 'fixture',
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: [id],
      sourceSet: ['forensics-fixture'],
      transforms: ['deterministic-fixture'],
    },
    temporal: {
      sourceEventTimeMs: eventMs,
      sourceTransactionTimeMs: eventMs,
      receivedTimeMs,
      sequence: options.sequence ?? null,
    },
    freshness: {
      basis: 'SOURCE_EVENT_TIME',
      evaluatedAtMs,
      ageMs,
      maxAgeMs,
      state,
    },
    completeness: {
      state: completeness,
      observedFields: completeness === 'MISSING' ? [] : ['fixture'],
      missingFields: completeness === 'COMPLETE' ? [] : ['fixture.required'],
      reasonCodes: completeness === 'COMPLETE' ? [] : ['FIXTURE_INCOMPLETE'],
    },
  };
}

let sequence = 0;
function trade(eventMs, price, quoteQuantity, aggressorSide) {
  const seq = String(++sequence);
  const id = stableId('evidence', { kind: 'TRADE', eventMs, price, quoteQuantity, seq });
  return {
    id,
    kind: 'TRADE',
    instrument: instrument(),
    truth: truth(eventMs, id, { evaluatedAtMs: eventMs + 1, maxAgeMs: 60_000, dataset: 'aggTrade' }),
    aggregateTradeId: seq,
    firstTradeId: seq,
    lastTradeId: seq,
    price,
    baseQuantity: quoteQuantity / price,
    quoteQuantity,
    normalBaseQuantityExcludingRpi: quoteQuantity / price,
    aggressorSide,
  };
}

function depth(eventMs, quantity) {
  const id = stableId('evidence', { kind: 'DEPTH_SNAPSHOT', eventMs, quantity });
  const sequence = String(eventMs);
  return {
    id,
    kind: 'DEPTH_SNAPSHOT',
    instrument: instrument(),
    truth: truth(eventMs, id, {
      evaluatedAtMs: eventMs + 1,
      maxAgeMs: 60_000,
      dataset: 'depth',
      sequence: { first: sequence, last: sequence, previous: null },
    }),
    bids: [{ price: 99.99, baseQuantity: quantity }, { price: 99.98, baseQuantity: quantity }],
    asks: [{ price: 100.01, baseQuantity: quantity }, { price: 100.02, baseQuantity: quantity }],
    bookScope: 'STANDARD_NO_RPI',
    maximumLevelsKnown: 2,
  };
}

function liquidation(eventMs, quoteNotional, sampledPerWindow = false, samplingSelection = sampledPerWindow ? 'LARGEST_PER_SYMBOL' : 'UNKNOWN') {
  const price = 100;
  const id = stableId('evidence', { kind: 'LIQUIDATION', eventMs, quoteNotional, sampledPerWindow, samplingSelection });
  return {
    id,
    kind: 'LIQUIDATION',
    instrument: instrument('USD_M_PERPETUAL'),
    truth: truth(eventMs, id, { evaluatedAtMs: eventMs + 1, maxAgeMs: 60_000, dataset: 'forceOrder' }),
    orderSide: 'SELL',
    liquidatedPositionSide: 'LONG',
    orderType: 'LIMIT',
    timeInForce: 'IOC',
    originalQuantity: quoteNotional / price,
    filledQuantity: quoteNotional / price,
    averagePrice: price,
    sampledPerWindow,
    samplingSelection,
    sampleWindowMs: sampledPerWindow ? 1_000 : null,
  };
}

function feature(name, value, windowMs = 60_000, options = {}) {
  const end = options.end ?? NOW - 1_000;
  const id = stableId('feature', { name, value, windowMs, end, suffix: options.suffix ?? '' });
  return {
    id,
    instrumentId: instrument().instrumentId,
    feature: name,
    featureVersion: options.featureVersion ?? FEATURE_VERSION,
    value,
    unit: options.unit ?? (name.includes('return') || name.includes('change') ? 'percent' : name.includes('volume') ? 'quote_asset' : 'ratio'),
    windowMs,
    observationStartMs: end - windowMs,
    observationEndMs: end,
    truth: truth(end, id, {
      evaluatedAtMs: NOW,
      maxAgeMs: options.maxAgeMs ?? 30_000,
      state: options.state,
      completeness: options.completeness,
      featureVersion: options.truthFeatureVersion ?? FEATURE_VERSION,
      dataset: name,
    }),
  };
}

function episode(index, fade = 0.1) {
  const triggerTimeMs = NOW - (index + 5) * 3_600_000;
  const horizonMs = 60_000;
  const id = stableId('history', { index, fade });
  return {
    id,
    symbol: SYMBOL,
    instrumentId: instrument().instrumentId,
    triggerTimeMs,
    horizonMs,
    peakReturnPct: 1,
    closingReturnPct: 1 - fade,
    fadeFromPeakPct: fade,
    complete: true,
    evidenceIds: [`historical-evidence:${index}`],
    truth: truth(triggerTimeMs + horizonMs, id, { evaluatedAtMs: NOW, maxAgeMs: 1_000_000_000, dataset: 'historical-wakeup' }),
  };
}

function normalTrades(prices = null) {
  const path = prices ?? Array.from({ length: 10 }, (_, index) => 100 + index * 0.01);
  return path.map((price, index) => trade(
    NOW - 27_000 + index * 2_500,
    price,
    1_000 + index * 137,
    index % 3 === 0 ? 'BUY' : index % 3 === 1 ? 'SELL' : 'BUY',
  ));
}

function baseInput() {
  const trades = normalTrades();
  return {
    symbol: SYMBOL,
    instrumentId: instrument().instrumentId,
    evaluatedAtMs: NOW,
    candidateObservedAtMs: NOW - 20_000,
    intendedQuoteNotional: 1_000,
    configurationVersion: 'forensics-test-config-1',
    featureVersion: FEATURE_VERSION,
    evidence: [
      ...trades,
      depth(NOW - 20_000, 100),
      depth(NOW - 3_000, 95),
      liquidation(NOW - 4_000, 1_000, false),
    ],
    features: [
      feature('relative_quote_volume', 2, 60_000, { unit: 'multiple' }),
      feature('spot_price_change_pct', 0.09, 60_000, { unit: 'percent' }),
      feature('spot_quote_volume', 100_000, 60_000, { unit: 'quote_asset' }),
      feature('market_spot_return_pct', 0.02, 60_000, { unit: 'percent' }),
      feature('symbol_specific_return_pct', 0.07, 60_000, { unit: 'percent' }),
      feature('long_liquidation_quote', 1_000, 60_000, { unit: 'quote_asset' }),
      feature('short_liquidation_quote', 0, 60_000, { unit: 'quote_asset' }),
    ],
    history: [episode(0), episode(1), episode(2)],
  };
}

function checked(input) {
  const result = analyzeFalsePositiveForensics(input);
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.failure));
  return result.value;
}

function check(report, name) {
  const found = report.checks.find((entry) => entry.check === name);
  assert.ok(found, `${name} missing`);
  return found;
}

function withFeature(input, name, value, options = {}) {
  return {
    ...input,
    features: [
      ...input.features.filter((entry) => entry.feature !== name),
      feature(name, value, 60_000, { ...options, suffix: `replacement-${name}-${value}` }),
    ],
  };
}

test('complete benign evidence deterministically passes every forensic check', () => {
  const input = baseInput();
  const first = checked(input);
  const second = checked({
    ...input,
    evidence: [...input.evidence].reverse(),
    features: [...input.features].reverse(),
    history: [...input.history].reverse(),
  });
  assert.equal(first.id, second.id);
  assert.deepEqual(first.checks.map((entry) => entry.id), second.checks.map((entry) => entry.id));
  assert.deepEqual(first.checks.map((entry) => entry.check), FORENSIC_CHECK_KINDS);
  assert.ok(first.checks.every((entry) => entry.verdict === 'PASS'));
  assert.equal(first.tradeability.state, 'CLEAR');
  assert.equal(first.tradeability.claimAllowed, true);
  for (const entry of first.checks) {
    assert.ok(entry.observationStartMs !== null);
    assert.ok(entry.observationEndMs !== null);
    assert.ok(['BLOCK', 'WARN'].includes(entry.severity));
  }
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes('confidence'), false);
  assert.equal(serialized.includes('proposal'), false);
});

test('empty inputs make every check UNKNOWN and fail closed', () => {
  const input = { ...baseInput(), evidence: [], features: [], history: [] };
  const report = checked(input);
  assert.ok(report.checks.every((entry) => entry.verdict === 'UNKNOWN'));
  assert.equal(report.tradeability.state, 'UNKNOWN');
  assert.equal(report.tradeability.claimAllowed, false);
  assert.ok(report.tradeability.unknownRequiredCheckIds.length > 0);
});

test('each required false-positive pattern is detected with FAIL evidence', () => {
  const scenarios = [
    ['ONE_PRINT_OR_CONCENTRATED_SPIKE', (input) => ({ ...input, evidence: [trade(NOW - 2_000, 100, 100_000, 'BUY')] })],
    ['WASH_LIKE_PING_PONG_CHURN', (input) => ({
      ...input,
      evidence: [
        ...Array.from({ length: 10 }, (_, index) => trade(NOW - 27_000 + index * 2_500, 100, 1_000, index % 2 === 0 ? 'BUY' : 'SELL')),
        ...input.evidence.filter((entry) => entry.kind !== 'TRADE'),
      ],
    })],
    ['VOLUME_WITHOUT_PRICE_RESPONSE', (input) => withFeature(withFeature(input, 'relative_quote_volume', 5, { unit: 'multiple' }), 'spot_price_change_pct', 0.02, { unit: 'percent' })],
    ['PRICE_JUMP_ON_THIN_OR_DISAPPEARING_DEPTH', (input) => ({
      ...withFeature(input, 'spot_price_change_pct', 1, { unit: 'percent' }),
      evidence: [
        ...input.evidence.filter((entry) => entry.kind !== 'DEPTH_SNAPSHOT'),
        depth(NOW - 20_000, 1_000),
        depth(NOW - 3_000, 10),
      ],
    })],
    ['ALREADY_EXHAUSTED_MOVE', (input) => ({
      ...input,
      evidence: [...normalTrades([100, 100.5, 101, 101.5, 102, 102.5, 103, 103.3, 103.7, 104]), ...input.evidence.filter((entry) => entry.kind !== 'TRADE')],
    })],
    ['FAKE_FOLLOW_THROUGH', (input) => ({
      ...input,
      evidence: [...normalTrades([100, 100.6, 100.7, 100.5, 100.4, 100.3, 100.2, 100.15, 100.12, 100.1]), ...input.evidence.filter((entry) => entry.kind !== 'TRADE')],
    })],
    ['REPEATED_WAKEUP_FADE', (input) => ({ ...input, history: [episode(10, 0.8), episode(11, 0.9), episode(12, 0.1)] })],
    ['MARKET_WIDE_MISCLASSIFICATION', (input) => withFeature(withFeature(withFeature(input, 'spot_price_change_pct', 1, { unit: 'percent' }), 'market_spot_return_pct', 0.95, { unit: 'percent' }), 'symbol_specific_return_pct', 0.05, { unit: 'percent' })],
    ['LIQUIDATION_ONLY_BURST', (input) => ({
      ...withFeature(withFeature(input, 'long_liquidation_quote', 1_000_000, { unit: 'quote_asset' }), 'short_liquidation_quote', 0, { unit: 'quote_asset' }),
      evidence: [...input.evidence.filter((entry) => entry.kind !== 'LIQUIDATION'), liquidation(NOW - 4_000, 1_000_000, false)],
    })],
    ['STALE_OR_INCOMPLETE_EVIDENCE', (input) => withFeature(input, 'spot_price_change_pct', 0.09, {
      unit: 'percent', end: NOW - 60_000, maxAgeMs: 1_000, state: 'STALE',
    })],
  ];
  for (const [name, mutate] of scenarios) {
    const report = checked(mutate(baseInput()));
    const result = check(report, name);
    assert.equal(result.verdict, 'FAIL', `${name}: ${JSON.stringify(result)}`);
    assert.ok(result.reasonCodes.length > 0);
    assert.ok(result.evidenceIds.length > 0 || result.featureIds.length > 0 || name === 'REPEATED_WAKEUP_FADE');
    if (result.severity === 'BLOCK') {
      assert.equal(report.tradeability.state, 'BLOCKED');
      assert.equal(report.tradeability.claimAllowed, false);
    }
  }
});

test('any per-window liquidation selection remains UNKNOWN below threshold because coverage is incomplete', () => {
  for (const samplingSelection of ['LARGEST_PER_SYMBOL', 'LATEST_PER_SYMBOL', 'UNKNOWN']) {
    let input = baseInput();
    input = withFeature(withFeature(input, 'long_liquidation_quote', 1_000, { unit: 'quote_asset' }), 'short_liquidation_quote', 0, { unit: 'quote_asset' });
    input = {
      ...input,
      evidence: [
        ...input.evidence.filter((entry) => entry.kind !== 'LIQUIDATION'),
        liquidation(NOW - 4_000, 1_000, true, samplingSelection),
      ],
    };
    const result = check(checked(input), 'LIQUIDATION_ONLY_BURST');
    assert.equal(result.verdict, 'UNKNOWN');
    assert.ok(result.reasonCodes.includes('FORENSICS_SAMPLED_LIQUIDATION_LOWER_BOUND_INCONCLUSIVE'));
    assert.equal(result.metrics.find((metric) => metric.name === 'liquidation_sampling').value, 'SAMPLED');
    assert.equal(result.metrics.find((metric) => metric.name === 'liquidation_sampling_selection').value, samplingSelection);
  }
});

test('wash screening stays UNKNOWN when aggressor coverage cannot support a negative finding', () => {
  const input = baseInput();
  const unknownAggressorTrades = Array.from({ length: 10 }, (_, index) =>
    trade(NOW - 27_000 + index * 2_500, 100, 1_000 + index * 11, 'UNKNOWN'));
  const report = checked({
    ...input,
    evidence: [
      ...unknownAggressorTrades,
      ...input.evidence.filter((entry) => entry.kind !== 'TRADE'),
    ],
  });
  const result = check(report, 'WASH_LIKE_PING_PONG_CHURN');
  assert.equal(result.verdict, 'UNKNOWN');
  assert.ok(result.reasonCodes.includes('FORENSICS_WASH_AGGRESSOR_COVERAGE_INSUFFICIENT'));
  assert.equal(result.metrics.find((metric) => metric.name === 'aggressor_known_notional').value, 0);
  assert.equal(result.metrics.find((metric) => metric.name === 'aggressor_known_pair_coverage').value, 0);
  assert.equal(report.tradeability.claimAllowed, false);
  assert.ok(report.tradeability.unknownRequiredCheckIds.includes(result.id));
});

test('one depth snapshot cannot prove survival even when current notional looks sufficient', () => {
  const base = withFeature(baseInput(), 'spot_price_change_pct', 1, { unit: 'percent' });
  const evidence = [
    ...base.evidence.filter((entry) => entry.kind !== 'DEPTH_SNAPSHOT'),
    depth(NOW - 3_000, 100),
  ];
  for (const intendedQuoteNotional of [1_000, null]) {
    const report = checked({ ...base, intendedQuoteNotional, evidence });
    const result = check(report, 'PRICE_JUMP_ON_THIN_OR_DISAPPEARING_DEPTH');
    assert.equal(result.verdict, 'UNKNOWN');
    assert.ok(result.reasonCodes.includes(intendedQuoteNotional === null
      ? 'FORENSICS_DEPTH_REFERENCE_OR_INTENDED_SIZE_UNAVAILABLE'
      : 'FORENSICS_DEPTH_SURVIVAL_UNAVAILABLE'));
    assert.equal(result.metrics.find((metric) => metric.name === 'depth_survival').value, null);
    assert.equal(report.tradeability.claimAllowed, false);
  }
});

test('evidence is re-aged at forensic evaluation and expired declared-FRESH records fail quality', () => {
  const base = baseInput();
  const expiredTrades = Array.from({ length: 10 }, (_, index) =>
    trade(NOW - 50_000 + index * 1_000, 100 + index * 0.01, 1_000 + index * 13, index % 2 === 0 ? 'BUY' : 'SELL'));
  assert.ok(expiredTrades.every((record) => record.truth.freshness.state === 'FRESH'));
  assert.ok(expiredTrades.every((record) => NOW - record.truth.temporal.sourceEventTimeMs > 30_000));
  const report = checked({
    ...base,
    evidence: [
      ...expiredTrades,
      ...base.evidence.filter((entry) => entry.kind !== 'TRADE'),
    ],
  });
  const quality = check(report, 'STALE_OR_INCOMPLETE_EVIDENCE');
  assert.equal(quality.verdict, 'FAIL');
  assert.ok(quality.reasonCodes.includes('FORENSICS_STALE_EVIDENCE_DETECTED'));
  assert.ok(quality.metrics.find((metric) => metric.name === 'stale_record_count').value >= expiredTrades.length);
  assert.equal(check(report, 'WASH_LIKE_PING_PONG_CHURN').verdict, 'UNKNOWN');
  assert.equal(report.tradeability.state, 'BLOCKED');
  assert.equal(report.tradeability.claimAllowed, false);
});

test('future evidence and bounded-input overflow are rejected stably', () => {
  const future = trade(NOW + 1_000, 100, 1_000, 'BUY');
  const futureResult = analyzeFalsePositiveForensics({ ...baseInput(), evidence: [future] });
  assert.equal(futureResult.ok, false);
  assert.equal(futureResult.failure.code, 'NO_LOOK_AHEAD_VIOLATION');

  const boundedResult = analyzeFalsePositiveForensics(
    { ...baseInput(), evidence: Array.from({ length: 4 }, (_, index) => trade(NOW - index - 1, 100, 1_000 + index, 'BUY')) },
    { maxEvidenceRecords: 3 },
  );
  assert.equal(boundedResult.ok, false);
  assert.equal(boundedResult.failure.code, 'BUDGET_EXHAUSTED');
});

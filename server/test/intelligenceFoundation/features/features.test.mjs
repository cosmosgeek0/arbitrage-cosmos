import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  REQUIRED_WINDOWS_MS,
  MarketFeatureBank,
} from '../../../dist/intelligenceFoundation/features/index.js';
import {
  canonicalJson,
  stableId,
  validateTruthMetadata,
} from '../../../dist/intelligenceFoundation/contracts/index.js';

const DAY = 86_400_000;
const NOW = Math.floor(1_720_000_000_000 / DAY) * DAY + 12 * 3_600_000 + 30_000;

class ManualClock {
  constructor(now = NOW) { this.time = now; }
  now() { return this.time; }
  set(time) { this.time = time; }
  advance(ms) { this.time += ms; }
}

const instrument = (symbol, family = 'SPOT') => ({
  instrumentId: stableId('instrument', { venue: 'BINANCE', family, symbol }),
  venue: 'BINANCE',
  productFamily: family,
  symbol,
  pair: symbol,
  baseAsset: symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol,
  quoteAsset: 'USDT',
  contractType: family === 'SPOT' ? null : 'PERPETUAL',
  sourceMarketType: family === 'USD_M_PERPETUAL' ? 1 : family === 'COIN_M_PERPETUAL' ? 2 : null,
});

const truth = (family, eventMs, id, overrides = {}) => {
  const receivedTimeMs = overrides.receivedTimeMs ?? eventMs + 5;
  return {
    schemaVersion: '1',
    producerVersion: 'feature-fixture-1',
    configurationVersion: 'feature-fixture-cfg-1',
    featureVersion: null,
    authority: {
      kind: 'REPLAY_SUPPLIED',
      sourceId: family === 'SPOT' ? 'binance-spot-fixture' : 'binance-usdm-fixture',
      dataset: overrides.dataset ?? 'fixture',
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: [id],
      sourceSet: [family === 'SPOT' ? 'binance-spot' : 'binance-usdm'],
      transforms: ['official-shaped-synthetic-fixture'],
    },
    temporal: {
      sourceEventTimeMs: eventMs,
      sourceTransactionTimeMs: overrides.sourceTransactionTimeMs ?? eventMs,
      receivedTimeMs,
      sequence: overrides.sequence ?? null,
    },
    freshness: {
      basis: 'SOURCE_EVENT_TIME',
      evaluatedAtMs: receivedTimeMs,
      ageMs: receivedTimeMs - eventMs,
      maxAgeMs: overrides.maxAgeMs ?? 60_000,
      state: 'FRESH',
    },
    completeness: {
      state: 'COMPLETE',
      observedFields: ['fixture'],
      missingFields: [],
      reasonCodes: [],
    },
  };
};

let sequence = 1;
function trade(symbol, family, eventMs, price, quoteQuantity, aggressorSide = 'BUY') {
  const seq = String(sequence++);
  const id = stableId('evidence', { kind: 'TRADE', symbol, family, eventMs, seq });
  return {
    id,
    kind: 'TRADE',
    instrument: instrument(symbol, family),
    truth: truth(family, eventMs, id, { dataset: 'aggTrade' }),
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

function book(symbol, family, eventMs, mid, spreadBps = 4, quantity = 1_000) {
  const seq = String(sequence++);
  const half = mid * spreadBps / 10_000 / 2;
  const id = stableId('evidence', { kind: 'BOOK_TICKER', symbol, family, eventMs, seq });
  return {
    id,
    kind: 'BOOK_TICKER',
    instrument: instrument(symbol, family),
    truth: truth(family, eventMs, id, { dataset: 'bookTicker' }),
    updateId: seq,
    bidPrice: mid - half,
    bidQuantity: quantity,
    askPrice: mid + half,
    askQuantity: quantity,
  };
}

function depth(symbol, family, eventMs, mid, quantity, levels = 3) {
  const seq = String(sequence++);
  const id = stableId('evidence', { kind: 'DEPTH_SNAPSHOT', symbol, family, eventMs, seq });
  return {
    id,
    kind: 'DEPTH_SNAPSHOT',
    instrument: instrument(symbol, family),
    truth: truth(family, eventMs, id, {
      dataset: 'depth',
      sequence: { first: seq, last: seq, previous: null },
    }),
    bids: Array.from({ length: levels }, (_, index) => ({ price: mid - 0.01 * (index + 1), baseQuantity: quantity })),
    asks: Array.from({ length: levels }, (_, index) => ({ price: mid + 0.01 * (index + 1), baseQuantity: quantity * 0.8 })),
    bookScope: 'STANDARD_NO_RPI',
    maximumLevelsKnown: levels,
  };
}

function funding(symbol, eventMs, rate) {
  const seq = String(sequence++);
  const id = stableId('evidence', { kind: 'FUNDING', symbol, eventMs, seq });
  return {
    id,
    kind: 'FUNDING',
    instrument: instrument(symbol, 'USD_M_PERPETUAL'),
    truth: truth('USD_M_PERPETUAL', eventMs, id, { dataset: 'markPrice' }),
    fundingRate: rate,
    fundingIntervalHours: 8,
    nextFundingTimeMs: eventMs + 8 * 3_600_000,
    adjustedRateCap: null,
    adjustedRateFloor: null,
  };
}

function openInterest(symbol, eventMs, base, quote) {
  const seq = String(sequence++);
  const id = stableId('evidence', { kind: 'OPEN_INTEREST', symbol, eventMs, seq });
  return {
    id,
    kind: 'OPEN_INTEREST',
    instrument: instrument(symbol, 'USD_M_PERPETUAL'),
    truth: truth('USD_M_PERPETUAL', eventMs, id, { dataset: 'openInterest' }),
    openInterestBase: base,
    openInterestQuoteValue: quote,
    changeBase: null,
    changeQuoteValue: null,
    comparisonWindowMs: null,
  };
}

function liquidation(symbol, eventMs, side, quantity, price) {
  const seq = String(sequence++);
  const id = stableId('evidence', { kind: 'LIQUIDATION', symbol, eventMs, seq });
  return {
    id,
    kind: 'LIQUIDATION',
    instrument: instrument(symbol, 'USD_M_PERPETUAL'),
    truth: truth('USD_M_PERPETUAL', eventMs, id, { dataset: 'forceOrder' }),
    orderSide: side === 'LONG' ? 'SELL' : 'BUY',
    liquidatedPositionSide: side,
    orderType: 'LIMIT',
    timeInForce: 'IOC',
    originalQuantity: quantity,
    filledQuantity: quantity,
    averagePrice: price,
    sampledPerWindow: true,
    samplingSelection: 'LATEST_PER_SYMBOL',
    sampleWindowMs: 1_000,
  };
}

function continuousTradeCoverage(symbol, startTimeMs, endTimeMs) {
  const seq = String(sequence++);
  const eventMs = Math.min(NOW - 1, endTimeMs);
  const id = stableId('evidence', { kind: 'CONTEXT', symbol, startTimeMs, endTimeMs, seq });
  return {
    id,
    kind: 'CONTEXT',
    instrument: instrument(symbol, 'SPOT'),
    truth: truth('SPOT', eventMs, id, { dataset: 'continuousTradeCoverage' }),
    contextType: 'CONTINUOUS_TRADE_COVERAGE',
    scope: 'SYMBOL',
    values: {
      productFamily: 'SPOT',
      startTimeMs,
      endTimeMs,
      complete: true,
    },
  };
}

const config = (overrides = {}) => ({
  baselineMinSamples: 4,
  baselineCapacity: 64,
  sessionBucketMs: DAY,
  minimumMarketSymbols: 3,
  largeTradeQuoteThreshold: 500,
  derivativeStaleAfterMs: 30_000,
  sourceStaleAfterMs: 15_000,
  ...overrides,
});

const feature = (snapshot, name, windowMs) => {
  const found = snapshot.features.find((item) => item.feature === name && item.windowMs === windowMs);
  assert.ok(found, `${name}@${windowMs} missing`);
  return found;
};

function baselineTrades(symbol, minutes = 6, outlierMinute = -1) {
  const records = [];
  for (let minute = 0; minute < minutes; minute += 1) {
    const time = NOW - (minutes + 2 - minute) * 60_000 + 5_000;
    const total = minute === outlierMinute ? 1_000_000_000 : 100;
    records.push(
      trade(symbol, 'SPOT', time, 10, total / 2, 'BUY'),
      trade(symbol, 'SPOT', time + 10_000, 10, total / 2, 'SELL'),
    );
  }
  return records;
}

test('cold start, insufficient history, robust ready baseline, and UTC-session normalization stay truthful', () => {
  const clock = new ManualClock();
  const bank = new MarketFeatureBank(clock, config());
  assert.equal(bank.ingest(book('BASEUSDT', 'SPOT', NOW - 500, 10)).accepted, 1);
  assert.equal(bank.snapshot('BASEUSDT').baseline.state, 'COLD_START');

  bank.ingest(baselineTrades('BASEUSDT', 2));
  assert.equal(bank.snapshot('BASEUSDT').baseline.state, 'INSUFFICIENT_HISTORY');
  bank.ingest(baselineTrades('BASEUSDT', 6, 2));
  const current = [
    trade('BASEUSDT', 'SPOT', NOW - 20_000, 10, 250, 'BUY'),
    trade('BASEUSDT', 'SPOT', NOW - 10_000, 10.02, 250, 'BUY'),
    trade('BASEUSDT', 'SPOT', NOW - 1_000, 10.04, 500, 'BUY'),
  ];
  bank.ingest(current);
  const snapshot = bank.snapshot('BASEUSDT');
  assert.equal(snapshot.baseline.state, 'READY');
  assert.match(snapshot.baseline.sessionBucket, /^UTC_/);
  const normal = snapshot.baseline.normalActivity.find((item) => item.feature === 'normal_quote_volume_per_bucket');
  assert.ok(normal.value < 1_000, `outlier poisoned robust baseline: ${normal.value}`);
  assert.ok(feature(snapshot, 'relative_quote_volume', 60_000).value > 5);
  assert.ok(feature(snapshot, 'session_relative_quote_volume', 60_000).value > 5);
  assert.equal(feature(snapshot, 'session_relative_quote_volume', 60_000).featureVersion, 'market-features-v1');
  assert.equal(feature(snapshot, 'session_relative_quote_volume', 60_000).instrumentId, snapshot.instrumentId);
  assert.equal(feature(snapshot, 'session_relative_quote_volume', 60_000).truth.featureVersion, 'market-features-v1');
  assert.ok(feature(snapshot, 'session_relative_quote_volume', 60_000).truth.provenance.sourceSet.includes('binance-spot'));
  assert.ok(feature(snapshot, 'session_relative_quote_volume', 60_000).observationEndMs <= NOW);
  assert.equal(validateTruthMetadata(snapshot.baseline.truth).ok, true);
  for (const item of [...snapshot.features, ...snapshot.baseline.normalActivity, ...snapshot.baseline.deadActivity]) {
    const validated = validateTruthMetadata(item.truth);
    assert.equal(validated.ok, true, validated.ok ? '' : `${item.feature}: ${validated.failure.message}`);
    assert.equal(item.truth.featureVersion, item.featureVersion);
  }
});

test('time-of-day normalization uses the matching UTC session instead of a different activity regime', () => {
  const dayStart = Math.floor(NOW / DAY) * DAY;
  const sessionNow = dayStart + 13 * 3_600_000 + 30 * 60_000 + 30_000;
  const clock = new ManualClock(sessionNow);
  const bank = new MarketFeatureBank(clock, config({ sessionBucketMs: 4 * 3_600_000, baselineCapacity: 512 }));
  const records = [];
  for (let minute = 0; minute < 60; minute += 1) {
    const busyOtherSession = dayStart + 11 * 3_600_000 + minute * 60_000 + 5_000;
    const quietTime = dayStart + 12 * 3_600_000 + minute * 60_000 + 5_000;
    records.push(
      trade('SESSIONUSDT', 'SPOT', quietTime, 10, 100, 'BUY'),
      trade('SESSIONUSDT', 'SPOT', busyOtherSession, 10, 10_000, 'BUY'),
    );
  }
  records.push(
    trade('SESSIONUSDT', 'SPOT', sessionNow - 20_000, 10, 500, 'BUY'),
    trade('SESSIONUSDT', 'SPOT', sessionNow - 5_000, 10.02, 500, 'BUY'),
  );
  assert.equal(bank.ingest(records).rejected, 0);
  const snapshot = bank.snapshot('SESSIONUSDT');
  const sessionNormal = snapshot.baseline.normalActivity.find((item) => item.feature === 'session_quote_volume_per_bucket');
  const globalNormal = snapshot.baseline.normalActivity.find((item) => item.feature === 'normal_quote_volume_per_bucket');
  assert.equal(snapshot.baseline.state, 'READY');
  assert.equal(sessionNormal.value, 100);
  assert.ok(globalNormal.value > 5_000);
  assert.ok(feature(snapshot, 'session_relative_quote_volume', 60_000).value >= 10);
  assert.ok(feature(snapshot, 'relative_quote_volume', 60_000).value < 0.25);
});

test('all required horizons compute irregular arrival, volume, flow, trade-size, and honest zero-trade windows', () => {
  const clock = new ManualClock();
  const bank = new MarketFeatureBank(clock, config());
  bank.ingest(baselineTrades('FLOWUSDT', 6));
  bank.ingest([
    trade('FLOWUSDT', 'SPOT', NOW - 14_500, 10, 100, 'SELL'),
    trade('FLOWUSDT', 'SPOT', NOW - 4_900, 10.01, 200, 'BUY'),
    trade('FLOWUSDT', 'SPOT', NOW - 900, 10.03, 600, 'BUY'),
    trade('FLOWUSDT', 'SPOT', NOW - 400, 10.05, 700, 'BUY'),
  ]);
  const snapshot = bank.snapshot('FLOWUSDT');
  assert.deepEqual([...new Set(snapshot.features.map((item) => item.windowMs))], REQUIRED_WINDOWS_MS);
  assert.equal(feature(snapshot, 'spot_trade_count', 1_000).value, 2);
  assert.ok(feature(snapshot, 'spot_trade_arrival_acceleration', 5_000).value > 0);
  assert.equal(feature(snapshot, 'spot_large_trade_count', 5_000).value, 2);
  assert.equal(feature(snapshot, 'spot_large_trade_cluster_count', 5_000).value, 1);
  assert.ok(feature(snapshot, 'spot_aggressor_imbalance', 5_000).value > 0);
  assert.equal(feature(snapshot, 'spot_trade_size_p90', 5_000).truth.completeness.state, 'COMPLETE');

  clock.advance(2 * 60_000);
  const quiet = bank.snapshot('FLOWUSDT');
  const count = feature(quiet, 'spot_trade_count', 1_000);
  assert.equal(count.value, 0);
  assert.equal(count.truth.completeness.state, 'PARTIAL');
  assert.ok(count.truth.completeness.reasonCodes.includes('ZERO_TRADE_WINDOW'));
  assert.equal(feature(quiet, 'spot_price_change_pct', 1_000).value, null);
});

test('book and depth features expose spread stability, imbalance, slope, replenishment, and absorption evidence', () => {
  const clock = new ManualClock();
  const bank = new MarketFeatureBank(clock, config());
  bank.ingest(baselineTrades('BOOKUSDT', 6));
  bank.ingest([
    book('BOOKUSDT', 'SPOT', NOW - 10_000, 100, 8, 100),
    book('BOOKUSDT', 'SPOT', NOW - 5_000, 100.2, 5, 120),
    book('BOOKUSDT', 'SPOT', NOW - 500, 100.4, 4, 150),
    depth('BOOKUSDT', 'SPOT', NOW - 8_000, 100, 10),
    depth('BOOKUSDT', 'SPOT', NOW - 400, 100.4, 20),
    trade('BOOKUSDT', 'SPOT', NOW - 9_000, 100, 2_000, 'BUY'),
    trade('BOOKUSDT', 'SPOT', NOW - 1_000, 100.4, 2_000, 'BUY'),
  ]);
  const snapshot = bank.snapshot('BOOKUSDT');
  assert.ok(feature(snapshot, 'spot_spread_bps', 15_000).value > 0);
  assert.ok(feature(snapshot, 'spot_spread_stability_bps', 15_000).value > 0);
  assert.ok(feature(snapshot, 'spot_top_book_depth_quote', 15_000).value > 0);
  assert.equal(typeof feature(snapshot, 'spot_top_book_imbalance', 15_000).value, 'number');
  assert.ok(feature(snapshot, 'spot_depth_quote', 15_000).value > 0);
  assert.ok(feature(snapshot, 'spot_depth_imbalance', 15_000).value > 0);
  assert.ok(feature(snapshot, 'spot_book_slope_bps_per_level', 15_000).value > 0);
  assert.ok(feature(snapshot, 'spot_depth_replenishment_ratio', 15_000).value > 0);
  assert.ok(feature(snapshot, 'spot_absorption_quote_per_pct', 15_000).value > 0);
});

test('spot/perpetual leadership and fresh funding, OI, liquidation, and crowding facts remain attributed', () => {
  const clock = new ManualClock();
  const bank = new MarketFeatureBank(clock, config());
  bank.ingest(baselineTrades('LEADUSDT', 6));
  bank.ingest([
    book('LEADUSDT', 'SPOT', NOW - 14_000, 100),
    book('LEADUSDT', 'SPOT', NOW - 11_000, 100.2),
    book('LEADUSDT', 'SPOT', NOW - 500, 100.5),
    book('LEADUSDT', 'USD_M_PERPETUAL', NOW - 14_000, 100),
    book('LEADUSDT', 'USD_M_PERPETUAL', NOW - 6_000, 100.2),
    book('LEADUSDT', 'USD_M_PERPETUAL', NOW - 400, 100.45),
    depth('LEADUSDT', 'USD_M_PERPETUAL', NOW - 300, 100.45, 20),
    funding('LEADUSDT', NOW - 12_000, 0.0001),
    funding('LEADUSDT', NOW - 200, 0.0003),
    openInterest('LEADUSDT', NOW - 12_000, 1_000, 100_000),
    openInterest('LEADUSDT', NOW - 100, 1_150, 115_000),
    liquidation('LEADUSDT', NOW - 800, 'SHORT', 10, 100.4),
  ]);
  const snapshot = bank.snapshot('LEADUSDT');
  assert.equal(feature(snapshot, 'spot_perpetual_lead_market', 15_000).value, 'SPOT');
  assert.ok(feature(snapshot, 'spot_perpetual_lead_lag_ms', 15_000).value > 0);
  assert.ok(feature(snapshot, 'spot_perpetual_divergence_pct', 15_000).value < 0);
  assert.ok(Math.abs(feature(snapshot, 'funding_rate_bps', 15_000).value - 3) < 1e-9);
  assert.ok(feature(snapshot, 'funding_rate_change_bps', 15_000).value > 0);
  assert.ok(feature(snapshot, 'open_interest_base_change_pct', 15_000).value > 14);
  assert.ok(feature(snapshot, 'short_liquidation_quote', 15_000).value > 1_000);
  assert.equal(feature(snapshot, 'crowding_funding_rate_bps', 15_000).truth.authority.kind, 'ENGINE_DERIVED');
});

test('market-relative movement separates beta from symbol-specific movement', () => {
  const clock = new ManualClock();
  const bank = new MarketFeatureBank(clock, config());
  const records = [];
  for (const [symbol, move] of [['BETA1USDT', 2], ['BETA2USDT', 2.1], ['ALPHAUSDT', 4]]) {
    records.push(
      book(symbol, 'SPOT', NOW - 14_000, 100),
      book(symbol, 'SPOT', NOW - 200, 100 * (1 + move / 100)),
    );
  }
  bank.ingest(records);
  const alpha = bank.snapshot('ALPHAUSDT');
  const beta = bank.snapshot('BETA1USDT');
  assert.ok(Math.abs(feature(alpha, 'market_spot_return_pct', 15_000).value - 2.1) < 0.02);
  assert.ok(feature(alpha, 'symbol_specific_return_pct', 15_000).value > 1.8);
  assert.ok(Math.abs(feature(beta, 'symbol_specific_return_pct', 15_000).value) < 0.2);
});

test('missing and stale Futures evidence stays null and names the failure honestly', () => {
  const clock = new ManualClock();
  const missingBank = new MarketFeatureBank(clock, config());
  missingBank.ingest([
    book('SPOTONLYUSDT', 'SPOT', NOW - 2_000, 10),
    book('SPOTONLYUSDT', 'SPOT', NOW - 100, 10.1),
  ]);
  const missing = feature(missingBank.snapshot('SPOTONLYUSDT'), 'spot_perpetual_divergence_pct', 5_000);
  assert.equal(missing.value, null);
  assert.ok(missing.truth.completeness.reasonCodes.includes('FUTURES_MISSING'));

  const staleBank = new MarketFeatureBank(clock, config());
  const stalePerpetualBook = book('STALEUSDT', 'USD_M_PERPETUAL', NOW - 90_000, 10);
  stalePerpetualBook.truth = truth('USD_M_PERPETUAL', NOW - 90_000, stalePerpetualBook.id, {
    dataset: 'bookTicker',
    receivedTimeMs: NOW - 5,
    maxAgeMs: 120_000,
  });
  staleBank.ingest([
    book('STALEUSDT', 'SPOT', NOW - 2_000, 10),
    book('STALEUSDT', 'SPOT', NOW - 100, 10.1),
    stalePerpetualBook,
    funding('STALEUSDT', NOW - 90_000, 0.0001),
    openInterest('STALEUSDT', NOW - 90_000, 100, 1_000),
  ]);
  const stale = feature(staleBank.snapshot('STALEUSDT'), 'spot_perpetual_divergence_pct', 5 * 60_000);
  assert.equal(stale.value, null);
  assert.ok(stale.truth.completeness.reasonCodes.includes('FUTURES_STALE'));
  assert.ok(stale.truth.provenance.sourceRecordIds.includes(stalePerpetualBook.id));
  assert.equal(stalePerpetualBook.truth.temporal.receivedTimeMs, NOW - 5, 'receipt is fresh but source event is stale');
  assert.equal(feature(staleBank.snapshot('STALEUSDT'), 'funding_rate_bps', 5 * 60_000).value, null);
});

test('current-timestamp unavailable evidence is retained for provenance but never becomes a usable feature', () => {
  const clock = new ManualClock();
  const bank = new MarketFeatureBank(clock, config());
  const unavailableTrade = trade('UNAVAILABLEUSDT', 'SPOT', NOW - 100, 10, 100, 'BUY');
  unavailableTrade.truth = {
    ...unavailableTrade.truth,
    authority: { ...unavailableTrade.truth.authority, kind: 'UNKNOWN' },
    freshness: {
      basis: 'UNAVAILABLE',
      evaluatedAtMs: unavailableTrade.truth.temporal.receivedTimeMs,
      ageMs: null,
      maxAgeMs: null,
      state: 'UNAVAILABLE',
    },
    completeness: {
      state: 'MISSING',
      observedFields: [],
      missingFields: ['authoritativeTradeTruth'],
      reasonCodes: ['SOURCE_TRUTH_UNAVAILABLE'],
    },
  };
  const result = bank.ingest(unavailableTrade);
  assert.equal(result.accepted, 1);
  const volume = feature(bank.snapshot('UNAVAILABLEUSDT'), 'spot_quote_volume', 1_000);
  assert.equal(volume.value, null);
  assert.equal(volume.truth.freshness.state, 'UNAVAILABLE');
  assert.equal(volume.truth.completeness.state, 'MISSING');
  assert.ok(volume.truth.completeness.reasonCodes.includes('UPSTREAM_TRUTH_UNUSABLE'));
  assert.ok(volume.truth.provenance.sourceRecordIds.includes(unavailableTrade.id));
});

test('baseline gaps stay insufficient unless explicit continuous trade coverage proves zero activity', () => {
  const clock = new ManualClock();
  const firstTime = NOW - 5 * 60_000 + 5_000;
  const lastTime = NOW - 2 * 60_000 + 5_000;
  const firstBucket = Math.floor(firstTime / 60_000) * 60_000;
  const lastBucketEnd = Math.floor(lastTime / 60_000) * 60_000 + 60_000;
  const records = [
    trade('GAPUSDT', 'SPOT', firstTime, 10, 100, 'BUY'),
    trade('GAPUSDT', 'SPOT', lastTime, 10, 100, 'BUY'),
  ];
  const uncovered = new MarketFeatureBank(clock, config({ baselineMinSamples: 2 }));
  uncovered.ingest(records);
  const uncoveredBaseline = uncovered.snapshot('GAPUSDT').baseline;
  assert.equal(uncoveredBaseline.state, 'INSUFFICIENT_HISTORY');
  assert.equal(uncoveredBaseline.sampleCount, 2);
  assert.ok(uncoveredBaseline.truth.completeness.reasonCodes.includes('BASELINE_COVERAGE_GAP'));

  const covered = new MarketFeatureBank(clock, config({ baselineMinSamples: 2 }));
  covered.ingest([
    ...records,
    continuousTradeCoverage('GAPUSDT', firstBucket, lastBucketEnd),
  ]);
  const coveredBaseline = covered.snapshot('GAPUSDT').baseline;
  assert.equal(coveredBaseline.state, 'READY');
  assert.ok(coveredBaseline.sampleCount > uncoveredBaseline.sampleCount);
});

test('numeric aggregation overflow returns null structured truth and cannot poison a baseline', () => {
  const clock = new ManualClock();
  const bank = new MarketFeatureBank(clock, config({ baselineMinSamples: 1 }));
  const records = [
    trade('OVERFLOWUSDT', 'SPOT', NOW - 70_000, 1, 1e308, 'BUY'),
    trade('OVERFLOWUSDT', 'SPOT', NOW - 69_000, 1, 1e308, 'BUY'),
    trade('OVERFLOWUSDT', 'SPOT', NOW - 400, 1, 1e308, 'BUY'),
    trade('OVERFLOWUSDT', 'SPOT', NOW - 200, 1, 1e308, 'BUY'),
  ];
  const ingest = bank.ingest(records);
  assert.equal(ingest.rejected, 0);
  const snapshot = bank.snapshot('OVERFLOWUSDT');
  const volume = feature(snapshot, 'spot_quote_volume', 1_000);
  assert.equal(volume.value, null);
  assert.notEqual(volume.truth.completeness.state, 'COMPLETE');
  assert.ok(volume.truth.completeness.reasonCodes.includes('NUMERIC_OVERFLOW'));
  assert.doesNotThrow(() => canonicalJson(snapshot));
  assert.notEqual(snapshot.baseline.state, 'READY');
  assert.ok(snapshot.baseline.truth.completeness.reasonCodes.includes('NUMERIC_OVERFLOW'));
});

test('oversized multi-symbol and multi-instrument batches are bounded independent of caller order', () => {
  const symbolRecords = [
    book('CCCUSDT', 'SPOT', NOW - 100, 3),
    book('AAAUSDT', 'SPOT', NOW - 100, 1),
    book('BBBUSDT', 'SPOT', NOW - 100, 2),
  ];
  const symbolLeft = new MarketFeatureBank(new ManualClock(), config({ maxSymbols: 2 }));
  const symbolRight = new MarketFeatureBank(new ManualClock(), config({ maxSymbols: 2 }));
  const leftSymbolsResult = symbolLeft.ingest(symbolRecords);
  const rightSymbolsResult = symbolRight.ingest([...symbolRecords].reverse());
  assert.deepEqual(symbolLeft.symbols(), ['AAAUSDT', 'BBBUSDT']);
  assert.deepEqual(symbolRight.symbols(), symbolLeft.symbols());
  assert.equal(canonicalJson(leftSymbolsResult.failures), canonicalJson(rightSymbolsResult.failures));

  const instrumentRecords = [
    book('MULTIUSDT', 'SPOT', NOW - 300, 10),
    book('MULTIUSDT', 'USD_M_PERPETUAL', NOW - 200, 10),
    book('MULTIUSDT', 'COIN_M_PERPETUAL', NOW - 100, 10),
  ];
  const instrumentLeft = new MarketFeatureBank(new ManualClock(), config({ maxInstrumentsPerSymbol: 2 }));
  const instrumentRight = new MarketFeatureBank(new ManualClock(), config({ maxInstrumentsPerSymbol: 2 }));
  const leftInstrumentsResult = instrumentLeft.ingest(instrumentRecords);
  const rightInstrumentsResult = instrumentRight.ingest([...instrumentRecords].reverse());
  assert.equal(leftInstrumentsResult.accepted, 2);
  assert.equal(leftInstrumentsResult.rejected, 1);
  assert.equal(canonicalJson(leftInstrumentsResult), canonicalJson(rightInstrumentsResult));
  assert.equal(canonicalJson(instrumentLeft.snapshot('MULTIUSDT')), canonicalJson(instrumentRight.snapshot('MULTIUSDT')));
  assert.equal(instrumentLeft.stats().instrumentIdentityCount, 2);
  assert.equal(instrumentLeft.stats().maximumInstrumentIdentityCapacity, instrumentLeft.config.maxSymbols * 2);
});

test('bounded storage rejects symbol overflow, caps records/baselines, and deterministic replay ignores input order', () => {
  const replayRecords = [
    ...baselineTrades('REPLAYUSDT', 6),
    book('REPLAYUSDT', 'SPOT', NOW - 4_000, 10),
    book('REPLAYUSDT', 'SPOT', NOW - 100, 10.1),
    trade('REPLAYUSDT', 'SPOT', NOW - 3_000, 10, 100, 'SELL'),
    trade('REPLAYUSDT', 'SPOT', NOW - 200, 10.1, 200, 'BUY'),
  ];
  const left = new MarketFeatureBank(new ManualClock(), config({ maxSymbols: 2, maxRecordsPerKind: 16, baselineCapacity: 8 }));
  const right = new MarketFeatureBank(new ManualClock(), config({ maxSymbols: 2, maxRecordsPerKind: 16, baselineCapacity: 8 }));
  assert.equal(left.ingest(replayRecords).rejected, 0);
  assert.equal(right.ingest([...replayRecords].reverse()).rejected, 0);
  assert.equal(canonicalJson(left.snapshot('REPLAYUSDT')), canonicalJson(right.snapshot('REPLAYUSDT')));
  assert.ok(left.stats().evidenceCount <= 16 * 10);
  assert.ok(left.stats().baselineBucketCount <= 8);

  assert.equal(left.ingest(book('SECONDUSDT', 'SPOT', NOW - 50, 2)).accepted, 1);
  const overflow = left.ingest(book('THIRDUSDT', 'SPOT', NOW - 40, 3));
  assert.equal(overflow.accepted, 0);
  assert.equal(overflow.failures[0].code, 'BUDGET_EXHAUSTED');
});

test('feature-bank import is pure and schedules no timers, sockets, or network', () => {
  const moduleUrl = new URL('../../../dist/intelligenceFoundation/features/index.js', import.meta.url).href;
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

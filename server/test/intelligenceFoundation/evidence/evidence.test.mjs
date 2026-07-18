import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  BINANCE_SOURCE_FACTS,
  assessEvidenceSet,
  assessSequence,
  normalizeBookTicker,
  normalizeBorrow,
  normalizeContext,
  normalizeDepth,
  normalizeFunding,
  normalizeLiquidation,
  normalizeMarkPrice,
  normalizeOpenInterest,
  normalizeTrade,
} from '../../../dist/intelligenceFoundation/evidence/index.js';

const RECEIVED = 1_720_000_000_125;
const EVALUATED = 1_720_000_000_200;

function instrument(family = 'SPOT') {
  if (family === 'BORROW') {
    return { productFamily: 'BORROW', symbol: 'BTC', pair: null, baseAsset: 'BTC', quoteAsset: null, contractType: null };
  }
  return {
    productFamily: family,
    symbol: 'BTCUSDT',
    pair: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    contractType: family === 'USD_M_PERPETUAL' ? 'PERPETUAL' : null,
  };
}

function context(sourceKey, overrides = {}) {
  const fact = BINANCE_SOURCE_FACTS[sourceKey];
  const family = fact.productFamily === 'ANY' ? 'SPOT' : fact.productFamily;
  return {
    sourceKey,
    sourceId: fact.sourceId,
    endpointClass: fact.endpointClass,
    instrument: instrument(family),
    receivedTimeMs: RECEIVED,
    evaluatedAtMs: EVALUATED,
    maxAgeMs: 1_000,
    ...overrides,
  };
}

function success(result) {
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.failures));
  return result.value;
}

function failure(result, code) {
  assert.equal(result.ok, false, result.ok ? JSON.stringify(result.value) : undefined);
  assert.ok(result.failures.some((entry) => entry.code === code), JSON.stringify(result.failures));
  return result.failures.find((entry) => entry.code === code);
}

const spotTrade = (overrides = {}) => ({
  e: 'aggTrade', E: 1_720_000_000_000, s: 'BTCUSDT', a: '90071992547409930',
  p: '60000.5', q: '0.25', f: '90071992547409931', l: '90071992547409935',
  T: 1_720_000_000_010, m: false, ...overrides,
});

const usdTrade = (overrides = {}) => ({
  ...spotTrade(), ps: 'BTCUSDT', st: 1, nq: '0.20', ...overrides,
});

test('source catalog pins current Binance endpoint classes, product boundaries, RPI scope, and sampling truth', () => {
  assert.equal(Object.isFrozen(BINANCE_SOURCE_FACTS), true);
  assert.equal(Object.isFrozen(BINANCE_SOURCE_FACTS.USD_M_AGG_TRADE), true);
  assert.equal(Object.isFrozen(BINANCE_SOURCE_FACTS.USD_M_AGG_TRADE.notes), true);
  assert.equal(BINANCE_SOURCE_FACTS.SPOT_BOOK_TICKER.freshnessBasis, 'RECEIVE_TIME');
  assert.equal(BINANCE_SOURCE_FACTS.USD_M_AGG_TRADE.endpoint, 'wss://fstream.binance.com/market');
  assert.equal(BINANCE_SOURCE_FACTS.USD_M_AGG_TRADE.sourceMarketType, 1);
  assert.match(BINANCE_SOURCE_FACTS.USD_M_AGG_TRADE.notes.join(' '), /st=2 is COIN-M/);
  assert.equal(BINANCE_SOURCE_FACTS.USD_M_DEPTH_DELTA.bookScope, 'STANDARD_NO_RPI');
  assert.equal(BINANCE_SOURCE_FACTS.USD_M_RPI_DEPTH_DELTA.bookScope, 'RPI_INCLUDED');
  assert.equal(BINANCE_SOURCE_FACTS.USD_M_LIQUIDATION.samplingWindowMs, 1_000);
  assert.match(BINANCE_SOURCE_FACTS.USD_M_LIQUIDATION.notes.join(' '), /latest liquidation order/);
  assert.match(BINANCE_SOURCE_FACTS.USD_M_LIQUIDATION.notes.join(' '), /silence is not proof of zero/);
  assert.match(BINANCE_SOURCE_FACTS.USD_M_FUNDING_INFO.endpoint, /fundingInfo$/);
  assert.equal(BINANCE_SOURCE_FACTS.MARGIN_ALL_ASSETS.endpointClass, 'REST');
  assert.match(BINANCE_SOURCE_FACTS.MARGIN_AVAILABLE_INVENTORY.notes.join(' '), /epoch seconds/);
  assert.match(BINANCE_SOURCE_FACTS.MARGIN_NEXT_HOURLY_RATE.notes[0], /0\.00002 means 0\.002%/);
});

test('Spot trade keeps event, transaction, and receive time separate and preserves identifiers beyond MAX_SAFE_INTEGER', () => {
  const result = normalizeTrade(spotTrade(), context('SPOT_AGG_TRADE'));
  const value = success(result);
  assert.equal(value.aggregateTradeId, '90071992547409930');
  assert.equal(value.firstTradeId, '90071992547409931');
  assert.equal(value.lastTradeId, '90071992547409935');
  assert.equal(value.quoteQuantity, 60_000.5 * 0.25);
  assert.equal(value.aggressorSide, 'BUY');
  assert.equal(value.normalBaseQuantityExcludingRpi, null);
  assert.deepEqual(value.truth.temporal, {
    sourceEventTimeMs: 1_720_000_000_000,
    sourceTransactionTimeMs: 1_720_000_000_010,
    receivedTimeMs: RECEIVED,
    sequence: { first: '90071992547409931', last: '90071992547409935', previous: null },
  });
  assert.equal(value.truth.freshness.basis, 'SOURCE_TRANSACTION_TIME');
  assert.equal(result.qualityFailures.length, 0);
});

test('USD-M trade names normal base quantity excluding RPI and refuses merged COIN-M contract quantity', () => {
  const value = success(normalizeTrade(usdTrade(), context('USD_M_AGG_TRADE')));
  assert.equal(value.instrument.productFamily, 'USD_M_PERPETUAL');
  assert.equal(value.instrument.sourceMarketType, 1);
  assert.equal(value.baseQuantity, 0.25);
  assert.equal(value.normalBaseQuantityExcludingRpi, 0.2);
  const allRpi = success(normalizeTrade(usdTrade({ nq: '0' }), context('USD_M_AGG_TRADE')));
  assert.equal(allRpi.normalBaseQuantityExcludingRpi, 0);
  assert.equal(allRpi.truth.completeness.state, 'COMPLETE');
  assert.equal(allRpi.truth.completeness.missingFields.includes('normalBaseQuantityExcludingRpi'), false);
  failure(normalizeTrade(usdTrade({ st: 2 }), context('USD_M_AGG_TRADE')), 'UNAVAILABLE');
  failure(normalizeTrade(usdTrade({ st: undefined }), context('USD_M_AGG_TRADE')), 'INCOMPLETE_EVIDENCE');
  failure(normalizeTrade(usdTrade({ nq: '0.30' }), context('USD_M_AGG_TRADE')), 'INVALID_VALUE');
});

test('trade rejects unsafe numeric IDs, malformed values, and deterministic duplicates', () => {
  failure(normalizeTrade(spotTrade({ a: 9_007_199_254_740_994 }), context('SPOT_AGG_TRADE')), 'INVALID_VALUE');
  failure(normalizeTrade(spotTrade({ q: '-1' }), context('SPOT_AGG_TRADE')), 'INVALID_VALUE');
  const first = success(normalizeTrade(spotTrade(), context('SPOT_AGG_TRADE')));
  const duplicateContext = context('SPOT_AGG_TRADE', {
    previousSequence: { last: '90071992547409935', recentSourceRecordIds: first.truth.provenance.sourceRecordIds },
  });
  failure(normalizeTrade(spotTrade(), duplicateContext), 'DUPLICATE_EVENT');
});

test('Spot bookTicker uses receive time while USD-M bookTicker uses transaction time', () => {
  const spot = success(normalizeBookTicker({ u: '44', s: 'BTCUSDT', b: '60000', B: '2', a: '60001', A: '3' }, context('SPOT_BOOK_TICKER')));
  assert.equal(spot.truth.temporal.sourceEventTimeMs, null);
  assert.equal(spot.truth.temporal.sourceTransactionTimeMs, null);
  assert.equal(spot.truth.freshness.basis, 'RECEIVE_TIME');
  assert.equal(spot.truth.freshness.ageMs, EVALUATED - RECEIVED);

  const future = success(normalizeBookTicker({
    e: 'bookTicker', E: 1_720_000_000_000, T: 1_720_000_000_010, s: 'BTCUSDT', ps: 'BTCUSDT',
    u: '45', b: '60000', B: '2', a: '60001', A: '3', st: 1,
  }, context('USD_M_BOOK_TICKER')));
  assert.equal(future.truth.freshness.basis, 'SOURCE_TRANSACTION_TIME');
  assert.equal(future.truth.temporal.sourceTransactionTimeMs, 1_720_000_000_010);
});

test('bookTicker update IDs are monotonic cursors and do not create false continuity gaps', () => {
  const result = normalizeBookTicker(
    { u: '45', s: 'BTCUSDT', b: '60000', B: '2', a: '60001', A: '3' },
    context('SPOT_BOOK_TICKER', { previousSequence: { last: '40' } }),
  );
  const value = success(result);
  assert.equal(value.truth.completeness.state, 'COMPLETE');
  assert.equal(result.qualityFailures.some((entry) => entry.code === 'SEQUENCE_GAP'), false);
  failure(normalizeBookTicker(
    { u: '40', s: 'BTCUSDT', b: '60000', B: '2', a: '60001', A: '3' },
    context('SPOT_BOOK_TICKER', { previousSequence: { last: '40' } }),
  ), 'DUPLICATE_EVENT');
});

test('book normalization rejects crossed books, missing source identity, and wrong endpoint class', () => {
  failure(normalizeBookTicker({ u: '1', s: 'BTCUSDT', b: '101', B: '1', a: '100', A: '1' }, context('SPOT_BOOK_TICKER')), 'CROSSED_BOOK');
  failure(normalizeBookTicker({ u: '1', s: 'BTCUSDT', b: '99', B: '1', a: '100', A: '1' }, {
    ...context('SPOT_BOOK_TICKER'), sourceId: '',
  }), 'MISSING_SOURCE');
  failure(normalizeBookTicker({ u: '1', s: 'BTCUSDT', b: '99', B: '1', a: '100', A: '1' }, {
    ...context('SPOT_BOOK_TICKER'), endpointClass: 'REST',
  }), 'WRONG_ENDPOINT_CLASS');
});

test('depth delta preserves zero-quantity removals and names sequence gaps without discarding evidence', () => {
  const result = normalizeDepth({
    e: 'depthUpdate', E: 1_720_000_000_000, s: 'BTCUSDT', U: '12', u: '13',
    b: [['60000', '0'], ['59999', '1']], a: [['60001', '0'], ['60002', '2']],
  }, context('SPOT_DEPTH_DELTA', { previousSequence: { last: '10' } }));
  const value = success(result);
  assert.equal(value.kind, 'DEPTH_DELTA');
  assert.equal(value.bids[0].baseQuantity, 0);
  assert.equal(value.truth.completeness.state, 'PARTIAL');
  assert.ok(value.truth.completeness.missingFields.includes('sequence.continuity'));
  assert.ok(result.qualityFailures.some((entry) => entry.code === 'SEQUENCE_GAP'));
});

test('depth normalization rejects duplicate/out-of-order events and impossible books', () => {
  const base = {
    e: 'depthUpdate', E: 1_720_000_000_000, s: 'BTCUSDT', U: '10', u: '10',
    b: [['60000', '0']], a: [['60001', '0']],
  };
  failure(normalizeDepth(base, context('SPOT_DEPTH_DELTA', { previousSequence: { last: '10' } })), 'DUPLICATE_EVENT');
  failure(normalizeDepth({ ...base, U: '8', u: '9' }, context('SPOT_DEPTH_DELTA', { previousSequence: { last: '10' } })), 'OUT_OF_ORDER_EVENT');
  failure(normalizeDepth({ ...base, U: '11', u: '11', b: [['60000', '-1']] }, context('SPOT_DEPTH_DELTA', { previousSequence: { last: '10' } })), 'INVALID_VALUE');
  failure(normalizeDepth({
    lastUpdateId: '100', bids: [['60002', '1']], asks: [['60001', '1']], requestedLimit: 100,
  }, context('SPOT_DEPTH_SNAPSHOT')), 'CROSSED_BOOK');
});

test('snapshot and Futures RPI depth retain explicit scope and source timing', () => {
  const snapshotResult = normalizeDepth({
    lastUpdateId: '100', bids: [['60000', '2'], ['59999', '1']], asks: [['60001', '2']], requestedLimit: 500,
  }, context('SPOT_DEPTH_SNAPSHOT'));
  const snapshot = success(snapshotResult);
  assert.equal(snapshot.kind, 'DEPTH_SNAPSHOT');
  assert.equal(snapshot.maximumLevelsKnown, 500);
  assert.equal(snapshot.bookScope, 'UNKNOWN');
  assert.equal(snapshot.truth.freshness.basis, 'RECEIVE_TIME');

  const rpi = success(normalizeDepth({
    e: 'depthUpdate', E: 1_720_000_000_000, T: 1_720_000_000_010, s: 'BTCUSDT', ps: 'BTCUSDT', st: 1,
    U: '11', u: '12', pu: '10', b: [['60000', '0']], a: [['60001', '1']],
  }, context('USD_M_RPI_DEPTH_DELTA', { previousSequence: { last: '10' } })));
  assert.equal(rpi.bookScope, 'RPI_INCLUDED');
  assert.equal(rpi.truth.temporal.sourceTransactionTimeMs, 1_720_000_000_010);
  assert.equal(rpi.truth.freshness.basis, 'SOURCE_TRANSACTION_TIME');
});

test('mark and funding normalization never mislabels next funding T as transaction time', () => {
  const raw = {
    e: 'markPriceUpdate', E: 1_720_000_000_000, s: 'BTCUSDT', ps: 'BTCUSDT', st: 1,
    p: '60000', i: '59990', P: '59995', ap: '59998', r: '0.0001', T: 1_720_028_800_000,
  };
  const mark = success(normalizeMarkPrice(raw, context('USD_M_MARK_PRICE')));
  assert.equal(mark.truth.temporal.sourceEventTimeMs, 1_720_000_000_000);
  assert.equal(mark.truth.temporal.sourceTransactionTimeMs, null);
  const funding = success(normalizeFunding(raw, context('USD_M_MARK_PRICE')));
  assert.equal(funding.nextFundingTimeMs, 1_720_028_800_000);
  assert.equal(funding.truth.temporal.sourceTransactionTimeMs, null);
  assert.equal(funding.fundingIntervalHours, null);
  assert.equal(funding.adjustedRateCap, null);
  assert.equal(funding.adjustedRateFloor, null);
  assert.equal(funding.truth.completeness.state, 'COMPLETE');

  const joined = success(normalizeFunding(raw, context('USD_M_MARK_PRICE', {
    fundingInfo: {
      symbol: 'BTCUSDT', fundingIntervalHours: 8,
      adjustedFundingRateCap: '0.0075', adjustedFundingRateFloor: '-0.0075',
      receivedTimeMs: RECEIVED - 5, recordId: 'funding-info-1',
    },
  })));
  assert.equal(joined.fundingIntervalHours, 8);
  assert.equal(joined.adjustedRateCap, 0.0075);
  assert.equal(joined.adjustedRateFloor, -0.0075);
  assert.equal(joined.truth.provenance.sourceRecordIds.length, 2);
  assert.equal(joined.truth.provenance.sourceSet.includes(BINANCE_SOURCE_FACTS.USD_M_FUNDING_INFO.sourceId), true);
});

test('funding history uses realized funding time without claiming mark or fundingInfo authority', () => {
  const result = normalizeFunding({ symbol: 'BTCUSDT', fundingRate: '0.0002', fundingTime: 1_720_000_000_010 }, context('USD_M_FUNDING_HISTORY'));
  const value = success(result);
  assert.equal(value.truth.temporal.sourceTransactionTimeMs, 1_720_000_000_010);
  assert.equal(value.nextFundingTimeMs, null);
  assert.equal(value.fundingIntervalHours, null);
  assert.equal(value.adjustedRateCap, null);
  assert.equal(value.adjustedRateFloor, null);
  assert.equal(value.truth.completeness.state, 'COMPLETE');
  assert.equal(result.qualityFailures.some((entry) => entry.code === 'INCOMPLETE_EVIDENCE'), false);
  failure(normalizeFunding({
    symbol: 'BTCUSDT', fundingRate: '0.0002', fundingTime: 1_720_000_000_010,
    fundingIntervalHours: 8,
  }, context('USD_M_FUNDING_HISTORY')), 'INVALID_VARIANT');
});

test('open interest current and history preserve units and compute changes only from explicit prior evidence', () => {
  const priorCurrent = success(normalizeOpenInterest({
    symbol: 'BTCUSDT', openInterest: '100', time: 1_719_999_940_010,
  }, context('USD_M_OPEN_INTEREST')));
  const currentResult = normalizeOpenInterest({ symbol: 'BTCUSDT', openInterest: '120.5', time: 1_720_000_000_010 }, context('USD_M_OPEN_INTEREST', {
    previousOpenInterest: priorCurrent,
  }));
  const current = success(currentResult);
  assert.equal(current.openInterestBase, 120.5);
  assert.equal(current.changeBase, 20.5);
  assert.equal(current.openInterestQuoteValue, null);
  assert.equal(current.comparisonWindowMs, 60_000);
  assert.equal(current.truth.provenance.sourceRecordIds.includes(priorCurrent.id), true);
  assert.equal(current.truth.provenance.sourceRecordIds.includes(priorCurrent.truth.provenance.sourceRecordIds[0]), true);

  const priorHistory = success(normalizeOpenInterest({
    symbol: 'BTCUSDT', sumOpenInterest: '100', sumOpenInterestValue: '6000000', timestamp: 1_719_999_940_010,
  }, context('USD_M_OPEN_INTEREST_HISTORY')));
  const history = success(normalizeOpenInterest({
    symbol: 'BTCUSDT', sumOpenInterest: '120.5', sumOpenInterestValue: '7230000', timestamp: 1_720_000_000_010,
  }, context('USD_M_OPEN_INTEREST_HISTORY', {
    previousOpenInterest: priorHistory,
  })));
  assert.equal(history.changeBase, 20.5);
  assert.equal(history.changeQuoteValue, 1_230_000);
  assert.equal(history.truth.completeness.state, 'COMPLETE');
});

test('open interest rejects equal-time duplicates and reversed comparison time', () => {
  const raw = { symbol: 'BTCUSDT', openInterest: '120', time: 1_720_000_000_010 };
  const sameTime = success(normalizeOpenInterest({ ...raw, openInterest: '100' }, context('USD_M_OPEN_INTEREST')));
  failure(normalizeOpenInterest(raw, context('USD_M_OPEN_INTEREST', {
    previousOpenInterest: sameTime,
  })), 'DUPLICATE_EVENT');
  const later = success(normalizeOpenInterest({
    symbol: 'BTCUSDT', openInterest: '100', time: 1_720_000_000_011,
  }, context('USD_M_OPEN_INTEREST')));
  failure(normalizeOpenInterest(raw, context('USD_M_OPEN_INTEREST', {
    previousOpenInterest: later,
  })), 'OUT_OF_ORDER_EVENT');
});

test('open-interest comparison rejects a prior normalized observation from another instrument', () => {
  const ethInstrument = {
    ...instrument('USD_M_PERPETUAL'), symbol: 'ETHUSDT', pair: 'ETHUSDT', baseAsset: 'ETH',
  };
  const ethPrior = success(normalizeOpenInterest({
    symbol: 'ETHUSDT', openInterest: '100', time: 1_719_999_940_010,
  }, context('USD_M_OPEN_INTEREST', { instrument: ethInstrument })));
  failure(normalizeOpenInterest({
    symbol: 'BTCUSDT', openInterest: '120', time: 1_720_000_000_010,
  }, context('USD_M_OPEN_INTEREST', { previousOpenInterest: ethPrior })), 'INVALID_VALUE');
});

test('liquidation records expose sampling loss and map order side to liquidated position side', () => {
  const sell = success(normalizeLiquidation({
    e: 'forceOrder', E: 1_720_000_000_000, ps: 'BTCUSDT', st: 1,
    o: { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', f: 'IOC', q: '2', p: '59900', ap: '59890', l: '1', z: '1.5', T: 1_720_000_000_010 },
  }, context('USD_M_LIQUIDATION')));
  assert.equal(sell.orderSide, 'SELL');
  assert.equal(sell.liquidatedPositionSide, 'LONG');
  assert.equal(sell.sampledPerWindow, true);
  assert.equal(sell.samplingSelection, 'LATEST_PER_SYMBOL');
  assert.equal(sell.sampleWindowMs, 1_000);
  assert.equal(sell.truth.temporal.sourceTransactionTimeMs, 1_720_000_000_010);

  const buy = success(normalizeLiquidation({
    e: 'forceOrder', E: 1_720_000_000_000, ps: 'BTCUSDT', st: 1,
    o: { s: 'BTCUSDT', S: 'BUY', o: 'MARKET', f: 'IOC', q: '2', p: '0', ap: '59890', l: '2', z: '2', T: 1_720_000_000_010 },
  }, context('USD_M_LIQUIDATION')));
  assert.equal(buy.liquidatedPositionSide, 'SHORT');
});

test('borrow composite preserves asset-level identity, decimal hourly rate, source age, and explicit zero availability', () => {
  const raw = {
    asset: 'BTC',
    allAssets: { assetName: 'BTC', isBorrowable: true, scope: 'CROSS', receivedTimeMs: RECEIVED - 10, recordId: 'eligibility-1' },
    maxBorrowable: { amount: '1.5', borrowLimit: '2', scope: 'CROSS', receivedTimeMs: RECEIVED - 9, recordId: 'limit-1' },
    availableInventory: { amount: '10', updateTime: 1_720_000_000, scope: 'CROSS', receivedTimeMs: RECEIVED - 8, recordId: 'inventory-1' },
    nextHourlyInterestRate: { nextHourlyInterestRate: '0.00002', scope: 'CROSS', receivedTimeMs: RECEIVED - 7, recordId: 'rate-1' },
  };
  const value = success(normalizeBorrow(raw, context('MARGIN_BORROW_COMPOSITE')));
  assert.equal(value.instrument.quoteAsset, null);
  assert.equal(value.instrument.pair, null);
  assert.equal(value.eligibility, 'ELIGIBLE');
  assert.equal(value.availability, 'AVAILABLE');
  assert.equal(value.systemAvailableAmount, 1.5);
  assert.equal(value.hourlyInterestRateDecimal, 0.00002);
  assert.equal(value.truth.freshness.basis, 'SOURCE_TRANSACTION_TIME');
  assert.equal(value.truth.temporal.sourceTransactionTimeMs, 1_720_000_000_000);
  assert.equal(value.truth.freshness.ageMs, EVALUATED - 1_720_000_000_000);

  const zero = success(normalizeBorrow({
    ...raw, maxBorrowable: { ...raw.maxBorrowable, amount: '0' },
  }, context('MARGIN_BORROW_COMPOSITE')));
  assert.equal(zero.availability, 'UNAVAILABLE');
  assert.equal(zero.systemAvailableAmount, 0);
});

test('borrow missingness remains UNKNOWN/PARTIAL and contradictory or absent sources fail closed', () => {
  const partialResult = normalizeBorrow({
    asset: 'BTC',
    allAssets: { assetName: 'BTC', isBorrowable: true, scope: 'CROSS', receivedTimeMs: RECEIVED - 50 },
  }, context('MARGIN_BORROW_COMPOSITE'));
  const partial = success(partialResult);
  assert.equal(partial.availability, 'UNKNOWN');
  assert.equal(partial.systemAvailableAmount, null);
  assert.equal(partial.truth.completeness.state, 'PARTIAL');
  assert.equal(partial.truth.freshness.basis, 'RECEIVE_TIME');
  failure(normalizeBorrow({ asset: 'BTC' }, context('MARGIN_BORROW_COMPOSITE')), 'MISSING_SOURCE');
  failure(normalizeBorrow({
    asset: 'BTC',
    allAssets: { assetName: 'BTC', isBorrowable: false, scope: 'CROSS', receivedTimeMs: RECEIVED - 10 },
    maxBorrowable: { amount: '1', borrowLimit: '2', scope: 'CROSS', receivedTimeMs: RECEIVED - 9 },
  }, context('MARGIN_BORROW_COMPOSITE')), 'INVALID_VALUE');
  failure(normalizeBorrow({
    asset: 'BTC', allAssets: { assetName: 'BTC', isBorrowable: true, scope: 'CROSS', receivedTimeMs: RECEIVED - 10 },
  }, context('MARGIN_BORROW_COMPOSITE', {
    instrument: { ...instrument('BORROW'), pair: 'BTCUSDT', quoteAsset: 'USDT' },
  })), 'INVALID_VALUE');
});

test('borrow composite rejects millisecond inventory input and cross/isolated scope mixing', () => {
  failure(normalizeBorrow({
    asset: 'BTC',
    availableInventory: {
      amount: '10', updateTime: 1_720_000_000_010,
      scope: 'CROSS', receivedTimeMs: RECEIVED - 5,
    },
  }, context('MARGIN_BORROW_COMPOSITE')), 'TIMESTAMP_SKEW');

  failure(normalizeBorrow({
    asset: 'BTC',
    allAssets: { assetName: 'BTC', isBorrowable: true, scope: 'CROSS', receivedTimeMs: RECEIVED - 10 },
    maxBorrowable: {
      amount: '1', borrowLimit: '2', scope: 'ISOLATED', isolatedSymbol: 'BTCUSDT', receivedTimeMs: RECEIVED - 9,
    },
  }, context('MARGIN_BORROW_COMPOSITE')), 'INVALID_VALUE');
});

test('borrow freshness uses the oldest independently timed fragment and fragment receipts affect identity', () => {
  const oldReceipt = RECEIVED - 2_000;
  const first = success(normalizeBorrow({
    asset: 'BTC',
    allAssets: { assetName: 'BTC', isBorrowable: true, scope: 'CROSS', receivedTimeMs: oldReceipt },
    availableInventory: { amount: '10', updateTime: 1_720_000_000, scope: 'CROSS', receivedTimeMs: RECEIVED - 5 },
  }, context('MARGIN_BORROW_COMPOSITE')));
  assert.equal(first.truth.freshness.basis, 'RECEIVE_TIME');
  assert.equal(first.truth.freshness.state, 'STALE');
  assert.equal(first.truth.temporal.receivedTimeMs, oldReceipt);

  const second = success(normalizeBorrow({
    asset: 'BTC',
    allAssets: { assetName: 'BTC', isBorrowable: true, scope: 'CROSS', receivedTimeMs: oldReceipt + 1 },
    availableInventory: { amount: '10', updateTime: 1_720_000_000, scope: 'CROSS', receivedTimeMs: RECEIVED - 5 },
  }, context('MARGIN_BORROW_COMPOSITE')));
  assert.notEqual(first.id, second.id);
});

test('context accepts only explicit primitive facts and rejects nested, non-finite, and secret-bearing values', () => {
  const raw = {
    recordId: 'market-1', contextType: 'MARKET_BREADTH', scope: 'MARKET',
    values: { advancingSymbols: 120, decliningSymbols: 80, riskOn: true, note: null },
    sourceEventTimeMs: 1_720_000_000_000,
  };
  const value = success(normalizeContext(raw, context('CONTEXT_INJECTED')));
  assert.deepEqual(value.values, raw.values);
  failure(normalizeContext({ ...raw, values: { nested: { invalid: true } } }, context('CONTEXT_INJECTED')), 'INVALID_VALUE');
  failure(normalizeContext({ ...raw, values: { invalid: Number.NaN } }, context('CONTEXT_INJECTED')), 'INVALID_VALUE');
  const secretFailure = failure(normalizeContext({ ...raw, values: { apiKey: 'must-not-survive' } }, context('CONTEXT_INJECTED')), 'SECRET_FIELD_REJECTED');
  assert.doesNotMatch(JSON.stringify(secretFailure), /must-not-survive/);
});

test('staleness and timestamp skew are named without replacing source time with refresh time', () => {
  const staleResult = normalizeTrade(spotTrade(), context('SPOT_AGG_TRADE', {
    evaluatedAtMs: 1_720_000_010_000,
    maxAgeMs: 1_000,
  }));
  const stale = success(staleResult);
  assert.equal(stale.truth.freshness.state, 'STALE');
  assert.equal(stale.truth.temporal.sourceTransactionTimeMs, 1_720_000_000_010);
  assert.ok(staleResult.qualityFailures.some((entry) => entry.code === 'STALE_SOURCE'));
  failure(normalizeTrade(spotTrade({ E: EVALUATED + 1, T: EVALUATED + 1 }), context('SPOT_AGG_TRADE')), 'TIMESTAMP_SKEW');
});

test('transaction/event clock divergence and missing required timestamps fail with distinct names', () => {
  failure(normalizeTrade(spotTrade({ E: 1_720_000_000_000, T: 1_720_000_000_500 }), context('SPOT_AGG_TRADE', {
    receivedTimeMs: 1_720_000_000_600,
    evaluatedAtMs: 1_720_000_000_700,
    maximumFutureSkewMs: 100,
  })), 'TIMESTAMP_SKEW');
  failure(normalizeTrade(spotTrade({ T: undefined }), context('SPOT_AGG_TRADE')), 'INCOMPLETE_EVIDENCE');
});

test('evidence IDs are independent of evaluation wall clock while truth age is explicitly reevaluated', () => {
  const first = success(normalizeTrade(spotTrade(), context('SPOT_AGG_TRADE')));
  const second = success(normalizeTrade(spotTrade(), context('SPOT_AGG_TRADE', {
    receivedTimeMs: RECEIVED + 10,
    evaluatedAtMs: EVALUATED + 10,
  })));
  assert.equal(first.id, second.id);
  assert.equal(first.truth.provenance.sourceRecordIds[0], second.truth.provenance.sourceRecordIds[0]);
  assert.notEqual(first.truth.freshness.ageMs, second.truth.freshness.ageMs);
});

test('evidence-set assessment names required missing kinds and stale/partial members', () => {
  const trade = success(normalizeTrade(spotTrade(), context('SPOT_AGG_TRADE')));
  const assessment = assessEvidenceSet([trade], ['TRADE', 'BOOK_TICKER', 'DEPTH_DELTA'], trade.instrument.instrumentId);
  assert.equal(assessment.complete, false);
  assert.deepEqual(assessment.observedKinds, ['TRADE']);
  assert.deepEqual(assessment.missingKinds, ['BOOK_TICKER', 'DEPTH_DELTA']);
  assert.ok(assessment.failures.some((entry) => entry.code === 'INCOMPLETE_EVIDENCE'));
});

test('evidence-set assessment never lets another instrument satisfy required kinds', () => {
  const trade = success(normalizeTrade(spotTrade(), context('SPOT_AGG_TRADE')));
  const ethInstrument = {
    ...instrument('SPOT'), symbol: 'ETHUSDT', pair: 'ETHUSDT', baseAsset: 'ETH',
  };
  const ethBook = success(normalizeBookTicker(
    { u: '45', s: 'ETHUSDT', b: '3000', B: '2', a: '3001', A: '3' },
    context('SPOT_BOOK_TICKER', { instrument: ethInstrument }),
  ));
  const assessment = assessEvidenceSet(
    [trade, ethBook], ['TRADE', 'BOOK_TICKER'], trade.instrument.instrumentId,
  );
  assert.equal(assessment.complete, false);
  assert.deepEqual(assessment.observedKinds, ['TRADE']);
  assert.deepEqual(assessment.missingKinds, ['BOOK_TICKER']);
});

test('sequence assessor distinguishes gap, duplicate, and out-of-order states using decimal strings', () => {
  assert.equal(assessSequence({ first: '12', last: '13', previous: null }, { last: '10' }, 'raw:1').state, 'GAP');
  assert.equal(assessSequence({ first: '10', last: '10', previous: null }, { last: '10' }, 'raw:1').state, 'DUPLICATE');
  assert.equal(assessSequence({ first: '8', last: '9', previous: null }, { last: '10' }, 'raw:1').state, 'OUT_OF_ORDER');
  assert.equal(assessSequence({ first: '11', last: '12', previous: '10' }, { last: '10' }, 'raw:1').state, 'OK');
});

test('evidence import is pure: no fetch, socket, or timer starts', () => {
  const moduleUrl = new URL('../../../dist/intelligenceFoundation/evidence/index.js', import.meta.url).href;
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

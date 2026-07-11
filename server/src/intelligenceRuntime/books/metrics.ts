import type { DepthLevel } from '../../intelligenceFoundation/contracts/index.js';
import type {
  BookDepthMetrics,
  DepthBandMetrics,
  SlippageQuery,
  SlippageResult,
} from './types.js';

const MAX_METRIC_LEVELS_PER_SIDE = 100_000;
const MAX_METRIC_BANDS = 8;

function validateLevels(levels: readonly DepthLevel[], side: 'BID' | 'ASK'): void {
  if (!Array.isArray(levels) || levels.length > MAX_METRIC_LEVELS_PER_SIDE) {
    throw new RangeError(`${side.toLowerCase()} levels exceed the metric safety bound`);
  }
  let previous: number | null = null;
  for (const level of levels) {
    if (typeof level !== 'object' || level === null
      || typeof level.price !== 'number' || !Number.isFinite(level.price) || level.price <= 0
      || typeof level.baseQuantity !== 'number' || !Number.isFinite(level.baseQuantity) || level.baseQuantity <= 0) {
      throw new TypeError(`${side.toLowerCase()} levels require positive finite price and quantity`);
    }
    if (previous !== null && (side === 'BID' ? level.price >= previous : level.price <= previous)) {
      throw new TypeError(`${side.toLowerCase()} levels must be strictly price sorted`);
    }
    previous = level.price;
  }
}

function validateBook(bids: readonly DepthLevel[], asks: readonly DepthLevel[]): void {
  validateLevels(bids, 'BID');
  validateLevels(asks, 'ASK');
  if (bids.length > 0 && asks.length > 0 && bids[0].price >= asks[0].price) {
    throw new TypeError('book levels must not be crossed or locked');
  }
}

function validateBands(depthBandsBps: readonly number[]): void {
  if (!Array.isArray(depthBandsBps) || depthBandsBps.length === 0 || depthBandsBps.length > MAX_METRIC_BANDS) {
    throw new RangeError('depth bands exceed the metric safety bound');
  }
  let previous = 0;
  for (const band of depthBandsBps) {
    if (!Number.isSafeInteger(band) || band <= previous || band > 10_000) {
      throw new TypeError('depth bands must be strictly increasing positive integer basis points');
    }
    previous = band;
  }
}

function validateSlippageQuery(query: SlippageQuery): void {
  if (typeof query !== 'object' || query === null || !['BUY', 'SELL'].includes(query.side)
    || typeof query.size !== 'object' || query.size === null
    || !['BASE', 'QUOTE'].includes(query.size.unit)
    || typeof query.size.value !== 'number' || !Number.isFinite(query.size.value) || query.size.value <= 0) {
    throw new TypeError('slippage query requires a positive finite BASE or QUOTE size');
  }
}

function finiteSum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) return null;
    total += value;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

function midpoint(bids: readonly DepthLevel[], asks: readonly DepthLevel[]): number | null {
  if (bids.length === 0 || asks.length === 0) return null;
  const value = bids[0].price / 2 + asks[0].price / 2;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function slope(levels: readonly DepthLevel[], mid: number, side: 'BID' | 'ASK'): number | null {
  if (levels.length < 2) return null;
  const distance = side === 'BID'
    ? levels[0].price - levels[levels.length - 1].price
    : levels[levels.length - 1].price - levels[0].price;
  const result = (distance / mid) * 10_000 / (levels.length - 1);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function bandMetrics(
  bids: readonly DepthLevel[],
  asks: readonly DepthLevel[],
  mid: number,
  distanceBps: number,
): Readonly<DepthBandMetrics> {
  const bidThreshold = mid * (1 - distanceBps / 10_000);
  const askThreshold = mid * (1 + distanceBps / 10_000);
  const bidLevels = bids.filter((level) => level.price >= bidThreshold);
  const askLevels = asks.filter((level) => level.price <= askThreshold);
  const bidBaseQuantity = finiteSum(bidLevels.map((level) => level.baseQuantity));
  const askBaseQuantity = finiteSum(askLevels.map((level) => level.baseQuantity));
  const bidQuoteNotional = finiteSum(bidLevels.map((level) => level.price * level.baseQuantity));
  const askQuoteNotional = finiteSum(askLevels.map((level) => level.price * level.baseQuantity));
  const totalQuoteNotional = bidQuoteNotional === null || askQuoteNotional === null
    ? null
    : finiteSum([bidQuoteNotional, askQuoteNotional]);
  const quoteImbalance = totalQuoteNotional !== null && totalQuoteNotional > 0
    && bidQuoteNotional !== null && askQuoteNotional !== null
    ? (bidQuoteNotional - askQuoteNotional) / totalQuoteNotional
    : null;
  return Object.freeze({
    distanceBps,
    bidBaseQuantity,
    askBaseQuantity,
    bidQuoteNotional,
    askQuoteNotional,
    totalQuoteNotional,
    quoteImbalance: quoteImbalance !== null && Number.isFinite(quoteImbalance) ? quoteImbalance : null,
    bidCoverageComplete: bids.length > 0 && bids[bids.length - 1].price <= bidThreshold,
    askCoverageComplete: asks.length > 0 && asks[asks.length - 1].price >= askThreshold,
  });
}

export function calculateBookDepthMetrics(
  bids: readonly DepthLevel[],
  asks: readonly DepthLevel[],
  depthBandsBps: readonly number[],
): Readonly<BookDepthMetrics> {
  validateBook(bids, asks);
  validateBands(depthBandsBps);
  const mid = midpoint(bids, asks);
  const bestBid = bids[0] ?? null;
  const bestAsk = asks[0] ?? null;
  if (mid === null || bestBid === null || bestAsk === null || bestBid.price >= bestAsk.price) {
    return Object.freeze({
      bestBidPrice: bestBid?.price ?? null,
      bestBidQuantity: bestBid?.baseQuantity ?? null,
      bestAskPrice: bestAsk?.price ?? null,
      bestAskQuantity: bestAsk?.baseQuantity ?? null,
      midpoint: null,
      spreadQuote: null,
      spreadBps: null,
      bidSlopeBpsPerLevel: null,
      askSlopeBpsPerLevel: null,
      symmetricSlopeBpsPerLevel: null,
      bands: Object.freeze([]),
    });
  }
  const spreadQuote = bestAsk.price - bestBid.price;
  const spreadBps = (spreadQuote / mid) * 10_000;
  const bidSlopeBpsPerLevel = slope(bids, mid, 'BID');
  const askSlopeBpsPerLevel = slope(asks, mid, 'ASK');
  const symmetricSlopeBpsPerLevel = bidSlopeBpsPerLevel === null || askSlopeBpsPerLevel === null
    ? null
    : (bidSlopeBpsPerLevel + askSlopeBpsPerLevel) / 2;
  return Object.freeze({
    bestBidPrice: bestBid.price,
    bestBidQuantity: bestBid.baseQuantity,
    bestAskPrice: bestAsk.price,
    bestAskQuantity: bestAsk.baseQuantity,
    midpoint: mid,
    spreadQuote,
    spreadBps: Number.isFinite(spreadBps) ? spreadBps : null,
    bidSlopeBpsPerLevel,
    askSlopeBpsPerLevel,
    symmetricSlopeBpsPerLevel,
    bands: Object.freeze(depthBandsBps.map((band) => bandMetrics(bids, asks, mid, band))),
  });
}

function unavailableSlippage(
  query: SlippageQuery,
  state: SlippageResult['state'],
  reason: string,
): Readonly<SlippageResult> {
  return Object.freeze({
    state,
    side: query.side,
    requestedUnit: query.size.unit,
    requestedValue: query.size.value,
    filledBaseQuantity: 0,
    filledQuoteNotional: 0,
    unfilledValue: query.size.value,
    touchPrice: null,
    worstPrice: null,
    averageFillPrice: null,
    slippageBpsAtRequestedSize: null,
    visibleFillAveragePrice: null,
    visibleFillSlippageBps: null,
    levelsConsumed: 0,
    reasonCodes: Object.freeze([reason]),
  });
}

export function unavailableSlippageResult(
  query: SlippageQuery,
  state: 'UNAVAILABLE' | 'STALE',
  reason: string,
): Readonly<SlippageResult> {
  validateSlippageQuery(query);
  return unavailableSlippage(query, state, reason);
}

export function calculateSlippage(
  bids: readonly DepthLevel[],
  asks: readonly DepthLevel[],
  query: SlippageQuery,
): Readonly<SlippageResult> {
  validateSlippageQuery(query);
  validateBook(bids, asks);
  const levels = query.side === 'BUY' ? asks : bids;
  if (levels.length === 0) return unavailableSlippage(query, 'UNAVAILABLE', 'BOOK_SIDE_MISSING');
  const touchPrice = levels[0].price;
  let remaining = query.size.value;
  let filledBaseQuantity = 0;
  let filledQuoteNotional = 0;
  let worstPrice: number | null = null;
  let levelsConsumed = 0;
  for (const level of levels) {
    const levelQuote = level.price * level.baseQuantity;
    if (!Number.isFinite(levelQuote)) return unavailableSlippage(query, 'UNAVAILABLE', 'NUMERIC_OVERFLOW');
    const takeBase = query.size.unit === 'BASE'
      ? Math.min(remaining, level.baseQuantity)
      : Math.min(remaining, levelQuote) / level.price;
    const takeQuote = takeBase * level.price;
    if (!Number.isFinite(takeBase) || !Number.isFinite(takeQuote)) {
      return unavailableSlippage(query, 'UNAVAILABLE', 'NUMERIC_OVERFLOW');
    }
    filledBaseQuantity += takeBase;
    filledQuoteNotional += takeQuote;
    remaining -= query.size.unit === 'BASE' ? takeBase : takeQuote;
    if (!Number.isFinite(filledBaseQuantity) || !Number.isFinite(filledQuoteNotional)
      || !Number.isFinite(remaining)) {
      return unavailableSlippage(query, 'UNAVAILABLE', 'NUMERIC_OVERFLOW');
    }
    worstPrice = level.price;
    levelsConsumed += 1;
    if (remaining <= Math.max(Number.EPSILON, query.size.value * 1e-12)) {
      remaining = 0;
      break;
    }
  }
  const visibleAverage = filledBaseQuantity > 0 ? filledQuoteNotional / filledBaseQuantity : null;
  if (visibleAverage !== null && !Number.isFinite(visibleAverage)) {
    return unavailableSlippage(query, 'UNAVAILABLE', 'NUMERIC_OVERFLOW');
  }
  const visibleSlippage = visibleAverage === null
    ? null
    : query.side === 'BUY'
      ? ((visibleAverage - touchPrice) / touchPrice) * 10_000
      : ((touchPrice - visibleAverage) / touchPrice) * 10_000;
  const complete = remaining === 0;
  return Object.freeze({
    state: complete ? 'COMPLETE' : 'INSUFFICIENT_VISIBLE_DEPTH',
    side: query.side,
    requestedUnit: query.size.unit,
    requestedValue: query.size.value,
    filledBaseQuantity,
    filledQuoteNotional,
    unfilledValue: remaining,
    touchPrice,
    worstPrice,
    averageFillPrice: complete ? visibleAverage : null,
    slippageBpsAtRequestedSize: complete && visibleSlippage !== null && Number.isFinite(visibleSlippage)
      ? Math.max(0, visibleSlippage)
      : null,
    visibleFillAveragePrice: visibleAverage,
    visibleFillSlippageBps: visibleSlippage !== null && Number.isFinite(visibleSlippage)
      ? Math.max(0, visibleSlippage)
      : null,
    levelsConsumed,
    reasonCodes: Object.freeze(complete ? [] : ['INSUFFICIENT_VISIBLE_DEPTH']),
  });
}

import {
  canonicalJson,
  stableId,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  BaselineCompletedCandle,
  HistoryFetchRequest,
} from './types.js';
import { intervalMilliseconds, isBaselineIntervalBoundary } from './config.js';

const MAX_DECIMAL_CHARACTERS = 160;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export class BaselineHistoryPageError extends TypeError {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BaselineHistoryPageError';
    this.code = code;
  }
}

export interface ParsedCompletedKlinePage {
  readonly records: readonly BaselineCompletedCandle[];
  readonly nextCursorTimeMs: number;
  readonly excludedIncompleteCount: number;
  readonly duplicateRecordCount: number;
  readonly gapCount: number;
}

function safeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new BaselineHistoryPageError('INVALID_KLINE_INTEGER', `${field} must be a non-negative safe integer`);
  }
  return value;
}

function decimal(value: unknown, field: string, allowZero: boolean): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_DECIMAL_CHARACTERS
    || !DECIMAL_PATTERN.test(value)) {
    throw new BaselineHistoryPageError('INVALID_KLINE_DECIMAL', `${field} must be a bounded unsigned decimal string`);
  }
  if (!allowZero && decimalIsZero(value)) {
    throw new BaselineHistoryPageError('INVALID_KLINE_PRICE', `${field} must be greater than zero`);
  }
  return value;
}

function decimalIsZero(value: string): boolean {
  return /^0+(?:\.0+)?$/.test(value);
}

/** Exact unsigned decimal comparison without binary floating-point conversion. */
function compareDecimals(left: string, right: string): number {
  const [leftIntegerRaw, leftFractionRaw = ''] = left.split('.');
  const [rightIntegerRaw, rightFractionRaw = ''] = right.split('.');
  const leftInteger = leftIntegerRaw.replace(/^0+(?=\d)/, '');
  const rightInteger = rightIntegerRaw.replace(/^0+(?=\d)/, '');
  if (leftInteger.length !== rightInteger.length) return leftInteger.length < rightInteger.length ? -1 : 1;
  if (leftInteger !== rightInteger) return leftInteger < rightInteger ? -1 : 1;
  const width = Math.max(leftFractionRaw.length, rightFractionRaw.length);
  const leftFraction = leftFractionRaw.padEnd(width, '0');
  const rightFraction = rightFractionRaw.padEnd(width, '0');
  return leftFraction < rightFraction ? -1 : leftFraction > rightFraction ? 1 : 0;
}

function validatePriceRange(open: string, high: string, low: string, close: string): void {
  if (compareDecimals(low, high) > 0
    || compareDecimals(open, low) < 0
    || compareDecimals(open, high) > 0
    || compareDecimals(close, low) < 0
    || compareDecimals(close, high) > 0) {
    throw new BaselineHistoryPageError('IMPOSSIBLE_KLINE_RANGE', 'OHLC values are outside the declared high/low range');
  }
}

interface DecodedTuple {
  readonly openTimeMs: number;
  readonly closeTimeMs: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly baseVolume: string;
  readonly quoteVolume: string;
  readonly tradeCount: number;
  readonly takerBuyBaseVolume: string;
  readonly takerBuyQuoteVolume: string;
}

function decodeTuple(row: unknown, intervalMs: number): DecodedTuple {
  if (!Array.isArray(row) || row.length < 11 || row.length > 16) {
    throw new BaselineHistoryPageError('INVALID_KLINE_TUPLE', 'kline row must be an official bounded tuple');
  }
  const openTimeMs = safeInteger(row[0], 'openTimeMs');
  const open = decimal(row[1], 'open', false);
  const high = decimal(row[2], 'high', false);
  const low = decimal(row[3], 'low', false);
  const close = decimal(row[4], 'close', false);
  const baseVolume = decimal(row[5], 'baseVolume', true);
  const closeTimeMs = safeInteger(row[6], 'closeTimeMs');
  const quoteVolume = decimal(row[7], 'quoteVolume', true);
  const tradeCount = safeInteger(row[8], 'tradeCount');
  const takerBuyBaseVolume = decimal(row[9], 'takerBuyBaseVolume', true);
  const takerBuyQuoteVolume = decimal(row[10], 'takerBuyQuoteVolume', true);
  const expectedCloseTimeMs = openTimeMs + intervalMs - 1;
  if (!Number.isSafeInteger(expectedCloseTimeMs) || closeTimeMs !== expectedCloseTimeMs) {
    throw new BaselineHistoryPageError('INVALID_KLINE_BOUNDARY', 'kline close time does not match its fixed interval');
  }
  validatePriceRange(open, high, low, close);
  if (compareDecimals(takerBuyBaseVolume, baseVolume) > 0
    || compareDecimals(takerBuyQuoteVolume, quoteVolume) > 0) {
    throw new BaselineHistoryPageError('IMPOSSIBLE_KLINE_VOLUME', 'taker-buy volume exceeds total volume');
  }
  return {
    openTimeMs,
    closeTimeMs,
    open,
    high,
    low,
    close,
    baseVolume,
    quoteVolume,
    tradeCount,
    takerBuyBaseVolume,
    takerBuyQuoteVolume,
  };
}

function tupleFingerprint(tuple: DecodedTuple): string {
  return canonicalJson(tuple);
}

export function parseCompletedKlinePage(
  request: Readonly<HistoryFetchRequest>,
  rows: readonly unknown[],
  receiveTimeMs: number,
): Readonly<ParsedCompletedKlinePage> {
  const receivedAtMs = safeInteger(receiveTimeMs, 'receiveTimeMs');
  const startTimeMs = safeInteger(request.startTimeMs, 'request.startTimeMs');
  const endTimeMs = safeInteger(request.endTimeMs, 'request.endTimeMs');
  const tickNowMs = safeInteger(request.tickNowMs, 'request.tickNowMs');
  if (startTimeMs > endTimeMs || endTimeMs > tickNowMs) {
    throw new BaselineHistoryPageError('INVALID_KLINE_REQUEST_TIME', 'history request time bounds are inconsistent');
  }
  if (receivedAtMs < tickNowMs) {
    throw new BaselineHistoryPageError('INVALID_KLINE_RECEIVE_TIME', 'history receipt cannot precede request dispatch');
  }
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 1_000) {
    throw new BaselineHistoryPageError('KLINE_PAGE_BOUND_EXCEEDED', 'history request limit must be in [1, 1000]');
  }
  const canonicalIntervalMs = intervalMilliseconds(request.interval);
  if (request.intervalMs !== canonicalIntervalMs) {
    throw new BaselineHistoryPageError('INVALID_KLINE_INTERVAL', 'history request intervalMs does not match its named fixed interval');
  }
  if (!Array.isArray(rows) || rows.length > request.limit || rows.length > 1_000) {
    throw new BaselineHistoryPageError('KLINE_PAGE_BOUND_EXCEEDED', 'history page exceeds the requested limit');
  }
  const records: BaselineCompletedCandle[] = [];
  const seen = new Map<number, string>();
  let previousSourceOpenTimeMs: number | null = null;
  let expectedOpenTimeMs = request.startTimeMs;
  let excludedIncompleteCount = 0;
  let duplicateRecordCount = 0;
  let gapCount = 0;

  for (const row of rows) {
    const tuple = decodeTuple(row, request.intervalMs);
    if (!isBaselineIntervalBoundary(tuple.openTimeMs, request.interval)) {
      throw new BaselineHistoryPageError('MISALIGNED_KLINE', 'kline open time is not aligned to its fixed interval');
    }
    if (tuple.openTimeMs < request.startTimeMs || tuple.openTimeMs > request.endTimeMs) {
      throw new BaselineHistoryPageError('KLINE_OUTSIDE_REQUEST', 'kline open time falls outside the requested page');
    }
    if (previousSourceOpenTimeMs !== null && tuple.openTimeMs < previousSourceOpenTimeMs) {
      throw new BaselineHistoryPageError('OUT_OF_ORDER_KLINE', 'history page is not chronological');
    }
    previousSourceOpenTimeMs = tuple.openTimeMs;
    const fingerprint = tupleFingerprint(tuple);
    const previousFingerprint = seen.get(tuple.openTimeMs);
    if (previousFingerprint !== undefined) {
      if (previousFingerprint !== fingerprint) {
        throw new BaselineHistoryPageError('CONFLICTING_DUPLICATE_KLINE', 'duplicate open time has conflicting values');
      }
      duplicateRecordCount += 1;
      continue;
    }
    seen.set(tuple.openTimeMs, fingerprint);

    // Binance kline tuples have no closed flag. This strict injected-clock gate
    // is the only authority for completion; the current candle is never seeded.
    if (tuple.closeTimeMs >= request.tickNowMs) {
      excludedIncompleteCount += 1;
      continue;
    }
    if (tuple.closeTimeMs > request.endTimeMs) {
      throw new BaselineHistoryPageError('KLINE_OUTSIDE_REQUEST', 'completed kline ends beyond the requested page');
    }
    if (tuple.openTimeMs < expectedOpenTimeMs) {
      throw new BaselineHistoryPageError('OVERLAPPING_KLINE_PAGE', 'completed kline overlaps an already requested interval');
    }
    const gapWidth = tuple.openTimeMs - expectedOpenTimeMs;
    if (gapWidth % request.intervalMs !== 0) {
      throw new BaselineHistoryPageError('MISALIGNED_KLINE_GAP', 'history gap is not interval aligned');
    }
    gapCount += gapWidth / request.intervalMs;
    expectedOpenTimeMs = tuple.openTimeMs + request.intervalMs;
    if (!Number.isSafeInteger(expectedOpenTimeMs)) {
      throw new BaselineHistoryPageError('KLINE_TIME_OVERFLOW', 'next kline cursor exceeds safe integer time');
    }
    const material = {
      planItemId: request.planItemId,
      sourceId: request.sourceId,
      symbol: request.symbol,
      instrumentId: request.instrumentId,
      productFamily: request.productFamily,
      feature: request.feature,
      featureVersion: request.featureVersion,
      interval: request.interval,
      ...tuple,
    };
    records.push(Object.freeze({
      id: stableId('baseline-candle', material),
      ...material,
      receiveTimeMs,
    }));
  }

  return Object.freeze({
    records: Object.freeze(records),
    nextCursorTimeMs: expectedOpenTimeMs,
    excludedIncompleteCount,
    duplicateRecordCount,
    gapCount,
  });
}

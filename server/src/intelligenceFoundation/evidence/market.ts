import type {
  DepthLevel,
  NormalizedBookTicker,
  NormalizedDepth,
  NormalizedTrade,
  SequenceRange,
  StableFailure,
} from '../contracts/index.js';
import { makeStableFailure } from '../contracts/index.js';
import {
  failureResult,
  finalizeEvidence,
  objectRecord,
  parseBoolean,
  parseDecimal,
  parseIdentifier,
  parseString,
  parseTimestamp,
  prepareContext,
  prepareRecord,
  sourceRecordId,
  verifySymbol,
  verifyUsdMStreamType,
  type ParseResult,
  type PreparedContext,
} from './common.js';
import type { BinanceSourceKey } from './sourceFacts.js';
import type { EvidenceNormalizationResult } from './types.js';

const TRADE_SOURCES = ['SPOT_AGG_TRADE', 'USD_M_AGG_TRADE'] as const satisfies readonly BinanceSourceKey[];
const BOOK_SOURCES = ['SPOT_BOOK_TICKER', 'USD_M_BOOK_TICKER'] as const satisfies readonly BinanceSourceKey[];
const DEPTH_SOURCES = [
  'SPOT_DEPTH_SNAPSHOT',
  'SPOT_DEPTH_DELTA',
  'USD_M_DEPTH_SNAPSHOT',
  'USD_M_DEPTH_DELTA',
  'USD_M_RPI_DEPTH_DELTA',
] as const satisfies readonly BinanceSourceKey[];

function pairFailure(record: Record<string, unknown>, prepared: PreparedContext, component: string): StableFailure | null {
  if (record.ps === undefined || record.ps === null) return null;
  const parsed = parseString(record.ps, 'ps', component);
  if (!parsed.ok) return parsed.failure;
  return parsed.value === prepared.instrument.pair
    ? null
    : makeStableFailure('INVALID_VALUE', component, 'source pair does not match the instrument seed', 'ps');
}

function requireSymbol(record: Record<string, unknown>, prepared: PreparedContext, component: string): StableFailure | null {
  const parsed = parseString(record.s ?? record.symbol, 'symbol', component);
  if (!parsed.ok) return parsed.failure;
  return verifySymbol(record, prepared, component);
}

function optionalNonNegative(
  value: unknown,
  field: string,
  component: string,
): { value: number | null; missing: boolean; failure: StableFailure | null } {
  if (value === undefined || value === null || value === '') return { value: null, missing: true, failure: null };
  const parsed = parseDecimal(value, field, component, 'NON_NEGATIVE');
  return parsed.ok
    ? { value: parsed.value, missing: false, failure: null }
    : { value: null, missing: false, failure: parsed.failure };
}

export function normalizeTrade(
  raw: unknown,
  context: unknown,
): EvidenceNormalizationResult<NormalizedTrade> {
  const component = 'evidence.trade';
  const preparedRecord = prepareRecord(raw, component);
  if (!preparedRecord.ok) return failureResult(preparedRecord.failure);
  const preparedContext = prepareContext(context, TRADE_SOURCES, component);
  if (!preparedContext.ok) return failureResult(preparedContext.failure);
  const record = preparedRecord.value;
  const prepared = preparedContext.value;

  const symbol = requireSymbol(record, prepared, component);
  if (symbol) return failureResult(symbol);
  if (prepared.sourceKey === 'USD_M_AGG_TRADE') {
    const marketType = verifyUsdMStreamType(record, component);
    if (marketType) return failureResult(marketType);
    const pair = pairFailure(record, prepared, component);
    if (pair) return failureResult(pair);
  }

  const aggregateId = parseIdentifier(record.a, 'a', component);
  if (!aggregateId.ok) return failureResult(aggregateId.failure);
  const firstId = parseIdentifier(record.f, 'f', component);
  if (!firstId.ok) return failureResult(firstId.failure);
  const lastId = parseIdentifier(record.l, 'l', component);
  if (!lastId.ok) return failureResult(lastId.failure);
  if (BigInt(firstId.value) > BigInt(lastId.value)) {
    return failureResult(makeStableFailure('INVALID_VALUE', component, 'first trade ID must not exceed last trade ID', 'f'));
  }
  const price = parseDecimal(record.p, 'p', component, 'POSITIVE');
  if (!price.ok) return failureResult(price.failure);
  const baseQuantity = parseDecimal(record.q, 'q', component, 'POSITIVE');
  if (!baseQuantity.ok) return failureResult(baseQuantity.failure);
  const eventTime = parseTimestamp(record.E, 'E', component);
  if (!eventTime.ok) return failureResult(eventTime.failure);
  const transactionTime = parseTimestamp(record.T, 'T', component);
  if (!transactionTime.ok) return failureResult(transactionTime.failure);
  const buyerIsMaker = parseBoolean(record.m, 'm', component);
  if (!buyerIsMaker.ok) return failureResult(buyerIsMaker.failure);
  const normalQuantity = prepared.sourceKey === 'USD_M_AGG_TRADE'
    ? optionalNonNegative(record.nq, 'nq', component)
    : { value: null, missing: false, failure: null };
  if (normalQuantity.failure) return failureResult(normalQuantity.failure);
  const quoteQuantity = price.value * baseQuantity.value;
  if (!Number.isFinite(quoteQuantity) || quoteQuantity <= 0) {
    const overflow = parseDecimal(quoteQuantity, 'quoteQuantity', component, 'POSITIVE');
    if (!overflow.ok) return failureResult(overflow.failure);
  }

  const sequence: SequenceRange = { first: firstId.value, last: lastId.value, previous: null };
  const rawId = sourceRecordId(prepared.sourceKey, {
    symbol: prepared.instrument.symbol,
    aggregateTradeId: aggregateId.value,
    firstTradeId: firstId.value,
    lastTradeId: lastId.value,
    transactionTimeMs: transactionTime.value,
  });
  return finalizeEvidence<NormalizedTrade>(prepared, {
    value: {
      kind: 'TRADE',
      aggregateTradeId: aggregateId.value,
      firstTradeId: firstId.value,
      lastTradeId: lastId.value,
      price: price.value,
      baseQuantity: baseQuantity.value,
      quoteQuantity,
      normalBaseQuantityExcludingRpi: normalQuantity.value,
      aggressorSide: buyerIsMaker.value ? 'SELL' : 'BUY',
    },
    sourceRecordIds: [rawId],
    transform: 'normalize-trade-v1',
    sourceEventTimeMs: eventTime.value,
    sourceTransactionTimeMs: transactionTime.value,
    sequence,
    observedFields: ['aggregateTradeId', 'firstTradeId', 'lastTradeId', 'price', 'baseQuantity', 'aggressorSide'],
    missingFields: normalQuantity.missing ? ['normalBaseQuantityExcludingRpi'] : [],
  }, component);
}

export function normalizeBookTicker(
  raw: unknown,
  context: unknown,
): EvidenceNormalizationResult<NormalizedBookTicker> {
  const component = 'evidence.book_ticker';
  const preparedRecord = prepareRecord(raw, component);
  if (!preparedRecord.ok) return failureResult(preparedRecord.failure);
  const preparedContext = prepareContext(context, BOOK_SOURCES, component);
  if (!preparedContext.ok) return failureResult(preparedContext.failure);
  const record = preparedRecord.value;
  const prepared = preparedContext.value;
  const symbol = requireSymbol(record, prepared, component);
  if (symbol) return failureResult(symbol);
  if (prepared.sourceKey === 'USD_M_BOOK_TICKER') {
    const marketType = verifyUsdMStreamType(record, component);
    if (marketType) return failureResult(marketType);
    const pair = pairFailure(record, prepared, component);
    if (pair) return failureResult(pair);
  }

  const updateId = parseIdentifier(record.u, 'u', component);
  if (!updateId.ok) return failureResult(updateId.failure);
  const bidPrice = parseDecimal(record.b, 'b', component, 'POSITIVE');
  if (!bidPrice.ok) return failureResult(bidPrice.failure);
  const bidQuantity = parseDecimal(record.B, 'B', component, 'POSITIVE');
  if (!bidQuantity.ok) return failureResult(bidQuantity.failure);
  const askPrice = parseDecimal(record.a, 'a', component, 'POSITIVE');
  if (!askPrice.ok) return failureResult(askPrice.failure);
  const askQuantity = parseDecimal(record.A, 'A', component, 'POSITIVE');
  if (!askQuantity.ok) return failureResult(askQuantity.failure);
  if (bidPrice.value >= askPrice.value) {
    return failureResult(makeStableFailure('CROSSED_BOOK', component, 'best bid must be below best ask', null));
  }

  let sourceEventTimeMs: number | null = null;
  let sourceTransactionTimeMs: number | null = null;
  if (prepared.sourceKey === 'USD_M_BOOK_TICKER') {
    const eventTime = parseTimestamp(record.E, 'E', component);
    if (!eventTime.ok) return failureResult(eventTime.failure);
    const transactionTime = parseTimestamp(record.T, 'T', component);
    if (!transactionTime.ok) return failureResult(transactionTime.failure);
    sourceEventTimeMs = eventTime.value;
    sourceTransactionTimeMs = transactionTime.value;
  }
  const rawId = sourceRecordId(prepared.sourceKey, { symbol: prepared.instrument.symbol, updateId: updateId.value });
  return finalizeEvidence<NormalizedBookTicker>(prepared, {
    value: {
      kind: 'BOOK_TICKER', updateId: updateId.value, bidPrice: bidPrice.value,
      bidQuantity: bidQuantity.value, askPrice: askPrice.value, askQuantity: askQuantity.value,
    },
    sourceRecordIds: [rawId], transform: 'normalize-book-ticker-v1',
    sourceEventTimeMs, sourceTransactionTimeMs,
    sequence: { first: updateId.value, last: updateId.value, previous: null },
    sequenceSemantics: 'MONOTONIC_CURSOR',
    observedFields: ['updateId', 'bidPrice', 'bidQuantity', 'askPrice', 'askQuantity'],
  }, component);
}

function parseLevels(
  value: unknown,
  field: string,
  component: string,
  allowZeroQuantity: boolean,
): ParseResult<DepthLevel[]> {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      failure: makeStableFailure(
        value === undefined || value === null ? 'INCOMPLETE_EVIDENCE' : 'INVALID_VALUE',
        component,
        'depth levels must be an array of price and quantity pairs',
        field,
      ),
    };
  }
  const levels: DepthLevel[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const level = value[index];
    if (!Array.isArray(level) || level.length < 2) {
      return {
        ok: false,
        failure: makeStableFailure('INVALID_VALUE', component, 'depth level must contain price and quantity', `${field}[${index}]`),
      };
    }
    const price = parseDecimal(level[0], `${field}[${index}][0]`, component, 'POSITIVE');
    if (!price.ok) return price;
    const quantity = parseDecimal(level[1], `${field}[${index}][1]`, component, allowZeroQuantity ? 'NON_NEGATIVE' : 'POSITIVE');
    if (!quantity.ok) return quantity;
    levels.push({ price: price.value, baseQuantity: quantity.value });
  }
  return { ok: true, value: levels };
}

export function normalizeDepth(
  raw: unknown,
  context: unknown,
): EvidenceNormalizationResult<NormalizedDepth> {
  const component = 'evidence.depth';
  const preparedRecord = prepareRecord(raw, component);
  if (!preparedRecord.ok) return failureResult(preparedRecord.failure);
  const preparedContext = prepareContext(context, DEPTH_SOURCES, component);
  if (!preparedContext.ok) return failureResult(preparedContext.failure);
  const record = preparedRecord.value;
  const prepared = preparedContext.value;
  const delta = ['SPOT_DEPTH_DELTA', 'USD_M_DEPTH_DELTA', 'USD_M_RPI_DEPTH_DELTA'].includes(prepared.sourceKey);
  const futuresStream = ['USD_M_DEPTH_DELTA', 'USD_M_RPI_DEPTH_DELTA'].includes(prepared.sourceKey);
  if (delta) {
    const symbol = requireSymbol(record, prepared, component);
    if (symbol) return failureResult(symbol);
  } else {
    const symbol = verifySymbol(record, prepared, component);
    if (symbol) return failureResult(symbol);
  }
  if (futuresStream) {
    const marketType = verifyUsdMStreamType(record, component);
    if (marketType) return failureResult(marketType);
    const pair = pairFailure(record, prepared, component);
    if (pair) return failureResult(pair);
  }

  const bidField = delta ? 'b' : 'bids';
  const askField = delta ? 'a' : 'asks';
  const bids = parseLevels(record[bidField], bidField, component, delta);
  if (!bids.ok) return failureResult(bids.failure);
  const asks = parseLevels(record[askField], askField, component, delta);
  if (!asks.ok) return failureResult(asks.failure);
  if (!delta && bids.value.length > 0 && asks.value.length > 0 && bids.value[0].price >= asks.value[0].price) {
    return failureResult(makeStableFailure('CROSSED_BOOK', component, 'depth best bid must be below best ask', null));
  }

  let sequence: SequenceRange;
  if (delta) {
    const first = parseIdentifier(record.U, 'U', component);
    if (!first.ok) return failureResult(first.failure);
    const last = parseIdentifier(record.u, 'u', component);
    if (!last.ok) return failureResult(last.failure);
    if (BigInt(first.value) > BigInt(last.value)) {
      return failureResult(makeStableFailure('INVALID_VALUE', component, 'depth first update ID must not exceed final update ID', 'U'));
    }
    let previous: string | null = null;
    if (futuresStream) {
      const parsedPrevious = parseIdentifier(record.pu, 'pu', component);
      if (!parsedPrevious.ok) return failureResult(parsedPrevious.failure);
      previous = parsedPrevious.value;
    }
    sequence = { first: first.value, last: last.value, previous };
  } else {
    const updateId = parseIdentifier(record.lastUpdateId, 'lastUpdateId', component);
    if (!updateId.ok) return failureResult(updateId.failure);
    sequence = { first: updateId.value, last: updateId.value, previous: null };
  }

  let sourceEventTimeMs: number | null = null;
  let sourceTransactionTimeMs: number | null = null;
  if (prepared.sourceKey === 'SPOT_DEPTH_DELTA') {
    const eventTime = parseTimestamp(record.E, 'E', component);
    if (!eventTime.ok) return failureResult(eventTime.failure);
    sourceEventTimeMs = eventTime.value;
  }
  if (futuresStream || prepared.sourceKey === 'USD_M_DEPTH_SNAPSHOT') {
    const eventTime = parseTimestamp(record.E, 'E', component);
    if (!eventTime.ok) return failureResult(eventTime.failure);
    const transactionTime = parseTimestamp(record.T, 'T', component);
    if (!transactionTime.ok) return failureResult(transactionTime.failure);
    sourceEventTimeMs = eventTime.value;
    sourceTransactionTimeMs = transactionTime.value;
  }

  let maximumLevelsKnown: number | null = null;
  const missingFields: string[] = [];
  if (!delta) {
    if (record.requestedLimit === undefined || record.requestedLimit === null) {
      missingFields.push('maximumLevelsKnown');
    } else if (!Number.isSafeInteger(record.requestedLimit) || (record.requestedLimit as number) <= 0) {
      return failureResult(makeStableFailure('INVALID_VALUE', component, 'requestedLimit must be a positive safe integer', 'requestedLimit'));
    } else {
      maximumLevelsKnown = record.requestedLimit as number;
    }
  }
  const rawId = sourceRecordId(prepared.sourceKey, {
    symbol: prepared.instrument.symbol,
    sequence,
    bids: bids.value,
    asks: asks.value,
  });
  return finalizeEvidence<NormalizedDepth>(prepared, {
    value: {
      kind: delta ? 'DEPTH_DELTA' : 'DEPTH_SNAPSHOT', bids: bids.value, asks: asks.value,
      bookScope: prepared.fact.bookScope ?? 'UNKNOWN', maximumLevelsKnown,
    },
    sourceRecordIds: [rawId], transform: delta ? 'normalize-depth-delta-v1' : 'normalize-depth-snapshot-v1',
    sourceEventTimeMs, sourceTransactionTimeMs, sequence,
    observedFields: ['bids', 'asks', 'bookScope', 'sequence'], missingFields,
  }, component);
}

import {
  makeStableFailure,
  validateNormalizedEvidence,
  type NormalizedFunding,
  type NormalizedLiquidation,
  type NormalizedMarkPrice,
  type NormalizedOpenInterest,
  type StableFailure,
} from '../contracts/index.js';
import {
  failureResult,
  finalizeEvidence,
  objectRecord,
  parseDecimal,
  parseString,
  parseTimestamp,
  prepareContext,
  prepareRecord,
  sourceRecordId,
  verifySymbol,
  verifyUsdMStreamType,
  type PreparedContext,
} from './common.js';
import { BINANCE_SOURCE_FACTS, type BinanceSourceKey } from './sourceFacts.js';
import type {
  EvidenceNormalizationResult,
  FundingNormalizationContext,
  OpenInterestNormalizationContext,
} from './types.js';

const MARK_SOURCES = ['USD_M_MARK_PRICE'] as const satisfies readonly BinanceSourceKey[];
const FUNDING_SOURCES = ['USD_M_MARK_PRICE', 'USD_M_FUNDING_HISTORY'] as const satisfies readonly BinanceSourceKey[];
const OPEN_INTEREST_SOURCES = ['USD_M_OPEN_INTEREST', 'USD_M_OPEN_INTEREST_HISTORY'] as const satisfies readonly BinanceSourceKey[];
const LIQUIDATION_SOURCES = ['USD_M_LIQUIDATION'] as const satisfies readonly BinanceSourceKey[];

function requireSymbol(record: Record<string, unknown>, prepared: PreparedContext, component: string): StableFailure | null {
  const parsed = parseString(record.s ?? record.symbol, 'symbol', component);
  if (!parsed.ok) return parsed.failure;
  return verifySymbol(record, prepared, component);
}

function pairFailure(record: Record<string, unknown>, prepared: PreparedContext, component: string): StableFailure | null {
  if (record.ps === undefined || record.ps === null) return null;
  const parsed = parseString(record.ps, 'ps', component);
  if (!parsed.ok) return parsed.failure;
  return parsed.value === prepared.instrument.pair
    ? null
    : makeStableFailure('INVALID_VALUE', component, 'source pair does not match the instrument seed', 'ps');
}

function optionalDecimal(
  value: unknown,
  field: string,
  component: string,
  constraint: 'FINITE' | 'NON_NEGATIVE' | 'POSITIVE',
): { value: number | null; missing: boolean; failure: StableFailure | null } {
  if (value === undefined || value === null || value === '') return { value: null, missing: true, failure: null };
  const parsed = parseDecimal(value, field, component, constraint);
  return parsed.ok
    ? { value: parsed.value, missing: false, failure: null }
    : { value: null, missing: false, failure: parsed.failure };
}

function optionalPrice(
  value: unknown,
  field: string,
  component: string,
): { value: number | null; missing: boolean; failure: StableFailure | null } {
  const parsed = optionalDecimal(value, field, component, 'NON_NEGATIVE');
  if (parsed.failure || parsed.value === null) return parsed;
  return parsed.value === 0
    ? { value: null, missing: true, failure: null }
    : { value: parsed.value, missing: false, failure: null };
}

function verifyStreamIdentity(record: Record<string, unknown>, prepared: PreparedContext, component: string): StableFailure | null {
  return requireSymbol(record, prepared, component) ??
    verifyUsdMStreamType(record, component) ??
    pairFailure(record, prepared, component);
}

export function normalizeMarkPrice(
  raw: unknown,
  context: unknown,
): EvidenceNormalizationResult<NormalizedMarkPrice> {
  const component = 'evidence.mark_price';
  const preparedRecord = prepareRecord(raw, component);
  if (!preparedRecord.ok) return failureResult(preparedRecord.failure);
  const preparedContext = prepareContext(context, MARK_SOURCES, component);
  if (!preparedContext.ok) return failureResult(preparedContext.failure);
  const record = preparedRecord.value;
  const prepared = preparedContext.value;
  const identity = verifyStreamIdentity(record, prepared, component);
  if (identity) return failureResult(identity);

  const eventTime = parseTimestamp(record.E, 'E', component);
  if (!eventTime.ok) return failureResult(eventTime.failure);
  const markPrice = parseDecimal(record.p, 'p', component, 'POSITIVE');
  if (!markPrice.ok) return failureResult(markPrice.failure);
  const indexPrice = optionalPrice(record.i, 'i', component);
  if (indexPrice.failure) return failureResult(indexPrice.failure);
  const settlementPrice = optionalPrice(record.P, 'P', component);
  if (settlementPrice.failure) return failureResult(settlementPrice.failure);
  const movingAverage = optionalPrice(record.ap, 'ap', component);
  if (movingAverage.failure) return failureResult(movingAverage.failure);

  const missingFields = [
    ...(indexPrice.missing ? ['indexPrice'] : []),
    ...(settlementPrice.missing ? ['estimatedSettlementPrice'] : []),
    ...(movingAverage.missing ? ['movingAverageMarkPrice'] : []),
  ];
  const rawId = sourceRecordId(prepared.sourceKey, {
    symbol: prepared.instrument.symbol, eventTimeMs: eventTime.value, markPrice: markPrice.value,
  });
  return finalizeEvidence<NormalizedMarkPrice>(prepared, {
    value: {
      kind: 'MARK_PRICE', markPrice: markPrice.value, indexPrice: indexPrice.value,
      estimatedSettlementPrice: settlementPrice.value, movingAverageMarkPrice: movingAverage.value,
    },
    sourceRecordIds: [rawId], transform: 'normalize-mark-price-v1',
    sourceEventTimeMs: eventTime.value, sourceTransactionTimeMs: null, sequence: null,
    observedFields: ['markPrice', ...(!indexPrice.missing ? ['indexPrice'] : []), ...(!settlementPrice.missing ? ['estimatedSettlementPrice'] : []), ...(!movingAverage.missing ? ['movingAverageMarkPrice'] : [])],
    missingFields,
  }, component);
}

export function normalizeFunding(
  raw: unknown,
  context: unknown,
): EvidenceNormalizationResult<NormalizedFunding> {
  const component = 'evidence.funding';
  const preparedRecord = prepareRecord(raw, component);
  if (!preparedRecord.ok) return failureResult(preparedRecord.failure);
  const preparedContext = prepareContext(context, FUNDING_SOURCES, component);
  if (!preparedContext.ok) return failureResult(preparedContext.failure);
  const record = preparedRecord.value;
  const prepared = preparedContext.value;
  const symbol = requireSymbol(record, prepared, component);
  if (symbol) return failureResult(symbol);
  const fundingInfoOnlyFields = [
    'fundingIntervalHours',
    'adjustedFundingRateCap',
    'adjustedFundingRateFloor',
    'adjustedRateCap',
    'adjustedRateFloor',
  ];
  const contaminatedField = fundingInfoOnlyFields.find((field) => record[field] !== undefined && record[field] !== null);
  if (contaminatedField !== undefined) {
    return failureResult(makeStableFailure(
      'INVALID_VARIANT',
      component,
      'funding adjustment metadata requires separately sourced /fapi/v1/fundingInfo provenance',
      contaminatedField,
    ));
  }

  let sourceEventTimeMs: number | null = null;
  let sourceTransactionTimeMs: number | null = null;
  let nextFundingTimeMs: number | null = null;
  let fundingRateValue: unknown;
  if (prepared.sourceKey === 'USD_M_MARK_PRICE') {
    const streamIdentity = verifyUsdMStreamType(record, component) ?? pairFailure(record, prepared, component);
    if (streamIdentity) return failureResult(streamIdentity);
    const eventTime = parseTimestamp(record.E, 'E', component);
    if (!eventTime.ok) return failureResult(eventTime.failure);
    const nextFunding = parseTimestamp(record.T, 'T', component);
    if (!nextFunding.ok) return failureResult(nextFunding.failure);
    sourceEventTimeMs = eventTime.value;
    nextFundingTimeMs = nextFunding.value;
    fundingRateValue = record.r;
  } else {
    const fundingTime = parseTimestamp(record.fundingTime, 'fundingTime', component);
    if (!fundingTime.ok) return failureResult(fundingTime.failure);
    sourceTransactionTimeMs = fundingTime.value;
    fundingRateValue = record.fundingRate;
  }
  const fundingRate = parseDecimal(fundingRateValue, prepared.sourceKey === 'USD_M_MARK_PRICE' ? 'r' : 'fundingRate', component, 'FINITE');
  if (!fundingRate.ok) return failureResult(fundingRate.failure);
  let interval: { value: number | null; missing: boolean } = { value: null, missing: true };
  let cap: { value: number | null; missing: boolean } = { value: null, missing: true };
  let floor: { value: number | null; missing: boolean } = { value: null, missing: true };
  const fundingInfoRecordIds: string[] = [];
  const fundingInfoSourceSet: string[] = [];
  const fundingInfo = (prepared.context as FundingNormalizationContext).fundingInfo;
  if (fundingInfo !== undefined && fundingInfo !== null) {
    if (!objectRecord(fundingInfo)) {
      return failureResult(makeStableFailure('INVALID_VALUE', component, 'fundingInfo must be a separately supplied source record', 'fundingInfo'));
    }
    const infoSymbol = parseString(fundingInfo.symbol, 'fundingInfo.symbol', component);
    if (!infoSymbol.ok) return failureResult(infoSymbol.failure);
    if (infoSymbol.value !== prepared.instrument.symbol) {
      return failureResult(makeStableFailure('INVALID_VALUE', component, 'fundingInfo symbol does not match the funding instrument', 'fundingInfo.symbol'));
    }
    const infoReceivedTime = parseTimestamp(fundingInfo.receivedTimeMs, 'fundingInfo.receivedTimeMs', component);
    if (!infoReceivedTime.ok) return failureResult(infoReceivedTime.failure);
    if (infoReceivedTime.value > prepared.context.receivedTimeMs || infoReceivedTime.value > prepared.context.evaluatedAtMs) {
      return failureResult(makeStableFailure('TIMESTAMP_SKEW', component, 'fundingInfo receipt follows the composite receipt or evaluation', 'fundingInfo.receivedTimeMs'));
    }
    const parsedInterval = parseDecimal(fundingInfo.fundingIntervalHours, 'fundingInfo.fundingIntervalHours', component, 'POSITIVE');
    if (!parsedInterval.ok) return failureResult(parsedInterval.failure);
    const parsedCap = parseDecimal(fundingInfo.adjustedFundingRateCap, 'fundingInfo.adjustedFundingRateCap', component, 'FINITE');
    if (!parsedCap.ok) return failureResult(parsedCap.failure);
    const parsedFloor = parseDecimal(fundingInfo.adjustedFundingRateFloor, 'fundingInfo.adjustedFundingRateFloor', component, 'FINITE');
    if (!parsedFloor.ok) return failureResult(parsedFloor.failure);
    interval = { value: parsedInterval.value, missing: false };
    cap = { value: parsedCap.value, missing: false };
    floor = { value: parsedFloor.value, missing: false };
    let externalRecordId: string | null = null;
    if (fundingInfo.recordId !== undefined && fundingInfo.recordId !== null) {
      const parsedRecordId = parseString(fundingInfo.recordId, 'fundingInfo.recordId', component);
      if (!parsedRecordId.ok) return failureResult(parsedRecordId.failure);
      externalRecordId = parsedRecordId.value;
    }
    fundingInfoRecordIds.push(sourceRecordId('USD_M_FUNDING_INFO', {
      symbol: infoSymbol.value,
      fundingIntervalHours: parsedInterval.value,
      adjustedFundingRateCap: parsedCap.value,
      adjustedFundingRateFloor: parsedFloor.value,
      receivedTimeMs: infoReceivedTime.value,
      externalRecordId,
    }));
    fundingInfoSourceSet.push(BINANCE_SOURCE_FACTS.USD_M_FUNDING_INFO.sourceId);
  }
  if (cap.value !== null && floor.value !== null && floor.value > cap.value) {
    return failureResult(makeStableFailure('INVALID_VALUE', component, 'adjusted funding floor cannot exceed cap', 'fundingInfo.adjustedFundingRateFloor'));
  }
  const missingFields: string[] = [];
  const rawId = sourceRecordId(prepared.sourceKey, {
    symbol: prepared.instrument.symbol,
    sourceEventTimeMs,
    sourceTransactionTimeMs,
    fundingRate: fundingRate.value,
  });
  return finalizeEvidence<NormalizedFunding>(prepared, {
    value: {
      kind: 'FUNDING', fundingRate: fundingRate.value, fundingIntervalHours: interval.value,
      nextFundingTimeMs, adjustedRateCap: cap.value, adjustedRateFloor: floor.value,
    },
    sourceRecordIds: [rawId, ...fundingInfoRecordIds],
    sourceSet: fundingInfoSourceSet,
    transform: fundingInfoRecordIds.length > 0 ? 'normalize-funding-with-info-v2' : 'normalize-funding-v2',
    sourceEventTimeMs, sourceTransactionTimeMs, sequence: null,
    observedFields: ['fundingRate', ...(!interval.missing ? ['fundingIntervalHours'] : []), ...(nextFundingTimeMs !== null ? ['nextFundingTimeMs'] : []), ...(!cap.missing ? ['adjustedRateCap'] : []), ...(!floor.missing ? ['adjustedRateFloor'] : [])],
    missingFields,
  }, component);
}

export function normalizeOpenInterest(
  raw: unknown,
  context: unknown,
): EvidenceNormalizationResult<NormalizedOpenInterest> {
  const component = 'evidence.open_interest';
  const preparedRecord = prepareRecord(raw, component);
  if (!preparedRecord.ok) return failureResult(preparedRecord.failure);
  const preparedContext = prepareContext(context, OPEN_INTEREST_SOURCES, component);
  if (!preparedContext.ok) return failureResult(preparedContext.failure);
  const record = preparedRecord.value;
  const prepared = preparedContext.value;
  const symbol = requireSymbol(record, prepared, component);
  if (symbol) return failureResult(symbol);

  let openInterestBase: number | null;
  let openInterestQuoteValue: number | null;
  let sourceTimeMs: number;
  if (prepared.sourceKey === 'USD_M_OPEN_INTEREST') {
    const base = parseDecimal(record.openInterest, 'openInterest', component, 'NON_NEGATIVE');
    if (!base.ok) return failureResult(base.failure);
    const time = parseTimestamp(record.time, 'time', component);
    if (!time.ok) return failureResult(time.failure);
    openInterestBase = base.value;
    openInterestQuoteValue = null;
    sourceTimeMs = time.value;
  } else {
    const base = parseDecimal(record.sumOpenInterest, 'sumOpenInterest', component, 'NON_NEGATIVE');
    if (!base.ok) return failureResult(base.failure);
    const quote = parseDecimal(record.sumOpenInterestValue, 'sumOpenInterestValue', component, 'NON_NEGATIVE');
    if (!quote.ok) return failureResult(quote.failure);
    const time = parseTimestamp(record.timestamp, 'timestamp', component);
    if (!time.ok) return failureResult(time.failure);
    openInterestBase = base.value;
    openInterestQuoteValue = quote.value;
    sourceTimeMs = time.value;
  }

  let changeBase: number | null = null;
  let changeQuoteValue: number | null = null;
  let comparisonWindowMs: number | null = null;
  const missingFields: string[] = [];
  const comparisonRecordIds: string[] = [];
  const comparisonSourceSet: string[] = [];
  const extended = prepared.context as OpenInterestNormalizationContext;
  const previous = extended.previousOpenInterest;
  if (previous === undefined || previous === null) {
    missingFields.push('changeBase', 'changeQuoteValue', 'comparisonWindowMs');
  } else {
    const validatedPrevious = validateNormalizedEvidence(previous);
    if (!validatedPrevious.ok) return failureResult(validatedPrevious.failure);
    if (validatedPrevious.value.kind !== 'OPEN_INTEREST') {
      return failureResult(makeStableFailure('INVALID_VARIANT', component, 'previousOpenInterest must be normalized open-interest evidence', 'previousOpenInterest.kind'));
    }
    const prior = validatedPrevious.value;
    if (prior.instrument.instrumentId !== prepared.instrument.instrumentId) {
      return failureResult(makeStableFailure('INVALID_VALUE', component, 'previous open-interest evidence belongs to another instrument', 'previousOpenInterest.instrument.instrumentId', [prior.id]));
    }
    const previousTime = prior.truth.temporal.sourceTransactionTimeMs;
    if (previousTime === null) {
      return failureResult(makeStableFailure('INCOMPLETE_EVIDENCE', component, 'previous open-interest evidence has no authoritative source time', 'previousOpenInterest.truth.temporal.sourceTransactionTimeMs', [prior.id]));
    }
    if (previousTime > sourceTimeMs) {
      return failureResult(makeStableFailure('OUT_OF_ORDER_EVENT', component, 'previous open-interest observation follows the current observation', 'previousOpenInterest.truth.temporal.sourceTransactionTimeMs', [prior.id]));
    }
    if (previousTime === sourceTimeMs) {
      return failureResult(makeStableFailure('DUPLICATE_EVENT', component, 'open-interest observations have the same source timestamp', 'previousOpenInterest.truth.temporal.sourceTransactionTimeMs', [prior.id]));
    }
    comparisonWindowMs = sourceTimeMs - previousTime;
    if (prior.openInterestBase === null) {
      missingFields.push('changeBase');
    } else {
      changeBase = openInterestBase - prior.openInterestBase;
    }
    if (openInterestQuoteValue === null || prior.openInterestQuoteValue === null) {
      missingFields.push('changeQuoteValue');
    } else {
      changeQuoteValue = openInterestQuoteValue - prior.openInterestQuoteValue;
    }
    comparisonRecordIds.push(prior.id, ...prior.truth.provenance.sourceRecordIds);
    comparisonSourceSet.push(prior.truth.authority.sourceId, ...prior.truth.provenance.sourceSet);
  }
  if (openInterestQuoteValue === null) missingFields.push('openInterestQuoteValue');
  const rawId = sourceRecordId(prepared.sourceKey, {
    symbol: prepared.instrument.symbol, sourceTimeMs, openInterestBase, openInterestQuoteValue,
  });
  return finalizeEvidence<NormalizedOpenInterest>(prepared, {
    value: {
      kind: 'OPEN_INTEREST', openInterestBase, openInterestQuoteValue, changeBase,
      changeQuoteValue, comparisonWindowMs,
    },
    sourceRecordIds: [rawId, ...comparisonRecordIds],
    sourceSet: comparisonSourceSet,
    transform: 'normalize-open-interest-v2',
    sourceEventTimeMs: null, sourceTransactionTimeMs: sourceTimeMs, sequence: null,
    observedFields: ['openInterestBase', ...(openInterestQuoteValue !== null ? ['openInterestQuoteValue'] : []), ...(changeBase !== null ? ['changeBase'] : []), ...(changeQuoteValue !== null ? ['changeQuoteValue'] : []), ...(comparisonWindowMs !== null ? ['comparisonWindowMs'] : [])],
    missingFields,
  }, component);
}

export function normalizeLiquidation(
  raw: unknown,
  context: unknown,
): EvidenceNormalizationResult<NormalizedLiquidation> {
  const component = 'evidence.liquidation';
  const preparedRecord = prepareRecord(raw, component);
  if (!preparedRecord.ok) return failureResult(preparedRecord.failure);
  const preparedContext = prepareContext(context, LIQUIDATION_SOURCES, component);
  if (!preparedContext.ok) return failureResult(preparedContext.failure);
  const record = preparedRecord.value;
  const prepared = preparedContext.value;
  const marketType = verifyUsdMStreamType(record, component);
  if (marketType) return failureResult(marketType);
  const pair = pairFailure(record, prepared, component);
  if (pair) return failureResult(pair);
  if (!objectRecord(record.o)) {
    return failureResult(makeStableFailure(record.o === undefined || record.o === null ? 'INCOMPLETE_EVIDENCE' : 'INVALID_VALUE', component, 'liquidation order payload is required', 'o'));
  }
  const order = record.o;
  const symbol = requireSymbol(order, prepared, component);
  if (symbol) return failureResult(symbol);
  const eventTime = parseTimestamp(record.E, 'E', component);
  if (!eventTime.ok) return failureResult(eventTime.failure);
  const transactionTime = parseTimestamp(order.T, 'o.T', component);
  if (!transactionTime.ok) return failureResult(transactionTime.failure);
  const side = parseString(order.S, 'o.S', component);
  if (!side.ok) return failureResult(side.failure);
  if (side.value !== 'BUY' && side.value !== 'SELL') {
    return failureResult(makeStableFailure('INVALID_VALUE', component, 'liquidation order side must be BUY or SELL', 'o.S'));
  }
  const orderType = parseString(order.o, 'o.o', component);
  if (!orderType.ok) return failureResult(orderType.failure);
  const timeInForce = parseString(order.f, 'o.f', component);
  if (!timeInForce.ok) return failureResult(timeInForce.failure);
  const originalQuantity = parseDecimal(order.q, 'o.q', component, 'POSITIVE');
  if (!originalQuantity.ok) return failureResult(originalQuantity.failure);
  const filledQuantity = parseDecimal(order.z, 'o.z', component, 'NON_NEGATIVE');
  if (!filledQuantity.ok) return failureResult(filledQuantity.failure);
  if (filledQuantity.value > originalQuantity.value) {
    return failureResult(makeStableFailure('INVALID_VALUE', component, 'filled liquidation quantity cannot exceed original quantity', 'o.z'));
  }
  const average = optionalDecimal(order.ap, 'o.ap', component, 'NON_NEGATIVE');
  if (average.failure) return failureResult(average.failure);
  const averagePrice = average.value === 0 ? null : average.value;
  const missingFields = average.missing || averagePrice === null ? ['averagePrice'] : [];
  const rawId = sourceRecordId(prepared.sourceKey, {
    symbol: prepared.instrument.symbol, transactionTimeMs: transactionTime.value,
    orderSide: side.value, originalQuantity: originalQuantity.value, filledQuantity: filledQuantity.value,
  });
  return finalizeEvidence<NormalizedLiquidation>(prepared, {
    value: {
      kind: 'LIQUIDATION', orderSide: side.value, liquidatedPositionSide: side.value === 'SELL' ? 'LONG' : 'SHORT',
      orderType: orderType.value, timeInForce: timeInForce.value, originalQuantity: originalQuantity.value,
      filledQuantity: filledQuantity.value, averagePrice, sampledPerWindow: true,
      samplingSelection: 'LATEST_PER_SYMBOL',
      sampleWindowMs: prepared.fact.samplingWindowMs,
    },
    sourceRecordIds: [rawId], transform: 'normalize-liquidation-v1',
    sourceEventTimeMs: eventTime.value, sourceTransactionTimeMs: transactionTime.value, sequence: null,
    observedFields: ['orderSide', 'liquidatedPositionSide', 'orderType', 'timeInForce', 'originalQuantity', 'filledQuantity', 'sampledPerWindow', 'samplingSelection', ...(!missingFields.length ? ['averagePrice'] : [])],
    missingFields,
  }, component);
}

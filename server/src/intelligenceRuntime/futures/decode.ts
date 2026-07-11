import type {
  FuturesBookTickerObservation,
  FuturesContractBracketObservation,
  FuturesContractObservation,
  FuturesDecodeBatch,
  FuturesDecodeIssue,
  FuturesIgnoredRecord,
  FuturesLiquidationObservation,
  FuturesMarkFundingObservation,
  UsdMRuntimeIdentity,
} from './types.js';
import { CURRENT_LIQUIDATION_SAMPLING, FUTURES_RUNTIME_HARD_LIMITS } from './types.js';

const MAX_WIRE_TEXT_CHARS = 2_000_000;
const DEFAULT_MAXIMUM_FUTURE_SKEW_MS = 2_000;
const DEFAULT_MAXIMUM_RECORDS_PER_MESSAGE = 4_096;
const DEFAULT_MAXIMUM_CONTRACT_BRACKETS = 128;
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const SYMBOL = /^[\p{L}\p{N}._-]{1,128}$/u;

type PlainRecord = Record<string, unknown>;

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; issue: FuturesDecodeIssue };

export interface FuturesDecodeOptions {
  maximumFutureSkewMs?: number;
  maximumRecordsPerMessage?: number;
  maximumContractBrackets?: number;
}

function isRecord(value: unknown): value is PlainRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function issue(
  code: FuturesDecodeIssue['code'],
  recordIndex: number | null,
  field: string | null,
  message: string,
): FuturesDecodeIssue {
  return Object.freeze({ code, recordIndex, field, message });
}

function failure<T>(value: FuturesDecodeIssue): ParseResult<T> {
  return { ok: false, issue: value };
}

function success<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

function validateReceiveTime(receiveTimeMs: number): FuturesDecodeIssue | null {
  return Number.isSafeInteger(receiveTimeMs) && receiveTimeMs >= 0
    ? null
    : issue('INVALID_FIELD', null, 'receiveTimeMs', 'receiveTimeMs must be a non-negative safe integer');
}

function maximumFutureSkew(options: FuturesDecodeOptions): number | FuturesDecodeIssue {
  const value = options.maximumFutureSkewMs ?? DEFAULT_MAXIMUM_FUTURE_SKEW_MS;
  return Number.isSafeInteger(value) && value >= 0 && value <= FUTURES_RUNTIME_HARD_LIMITS.maximumFutureSkewMs
    ? value
    : issue(
      'INVALID_FIELD',
      null,
      'maximumFutureSkewMs',
      `maximumFutureSkewMs must be within [0, ${FUTURES_RUNTIME_HARD_LIMITS.maximumFutureSkewMs}]`,
    );
}

function positiveLimit(
  value: number | undefined,
  fallback: number,
  field: 'maximumRecordsPerMessage' | 'maximumContractBrackets',
  hardMaximum: number,
): number | FuturesDecodeIssue {
  const resolved = value ?? fallback;
  return Number.isSafeInteger(resolved) && resolved > 0 && resolved <= hardMaximum
    ? resolved
    : issue('INVALID_FIELD', null, field, `${field} must be within [1, ${hardMaximum}]`);
}

function decodeWire(raw: unknown): ParseResult<unknown> {
  if (typeof raw !== 'string') return success(raw);
  if (raw.length > MAX_WIRE_TEXT_CHARS) {
    return failure(issue('MALFORMED_PAYLOAD', null, null, 'Futures message exceeds the bounded text limit'));
  }
  try {
    return success(JSON.parse(raw) as unknown);
  } catch {
    return failure(issue('MALFORMED_PAYLOAD', null, null, 'Futures message is not valid JSON'));
  }
}

function recordsFromWire(raw: unknown, expectedStream: string): ParseResult<readonly unknown[]> {
  const decoded = decodeWire(raw);
  if (!decoded.ok) return decoded;
  let root = decoded.value;
  if (isRecord(root) && Object.hasOwn(root, 'stream')) {
    if (root.stream !== expectedStream) {
      return failure(issue('INVALID_FIELD', null, 'stream', `Combined stream envelope must match ${expectedStream}`));
    }
    if (!Object.hasOwn(root, 'data')) {
      return failure(issue('MALFORMED_PAYLOAD', null, 'data', 'Combined stream envelope is missing data'));
    }
    root = root.data;
  }
  if (Array.isArray(root)) return success(root);
  if (isRecord(root)) return success([root]);
  return failure(issue('MALFORMED_PAYLOAD', null, null, 'Futures payload must be an object or array'));
}

function requiredString(record: PlainRecord, field: string, index: number): ParseResult<string> {
  const value = record[field];
  if (value === undefined || value === null) {
    return failure(issue('MISSING_FIELD', index, field, `${field} is required`));
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || value.trim() !== value) {
    return failure(issue('INVALID_FIELD', index, field, `${field} must be a bounded non-empty string`));
  }
  return success(value);
}

function identity(
  record: PlainRecord,
  index: number,
  allowSymbolOnlyPair = false,
): ParseResult<UsdMRuntimeIdentity> {
  const symbol = requiredString(record, 's', index);
  if (!symbol.ok) return symbol;
  if (!SYMBOL.test(symbol.value)) {
    return failure(issue('INVALID_FIELD', index, 's', 's must be an uppercase Binance symbol'));
  }
  let pair: string;
  let pairAuthority: UsdMRuntimeIdentity['pairAuthority'];
  if (record.ps === undefined || record.ps === null) {
    if (!allowSymbolOnlyPair) return failure(issue('MISSING_FIELD', index, 'ps', 'ps is required'));
    pair = symbol.value;
    pairAuthority = 'SYMBOL_ONLY_REQUIRES_RESOLUTION';
  } else {
    const parsedPair = requiredString(record, 'ps', index);
    if (!parsedPair.ok) return parsedPair;
    if (!SYMBOL.test(parsedPair.value)) {
      return failure(issue('INVALID_FIELD', index, 'ps', 'ps must be an uppercase Binance pair identity'));
    }
    pair = parsedPair.value;
    pairAuthority = 'OFFICIAL_PS';
  }
  return success(Object.freeze({
    symbol: symbol.value,
    pair,
    pairAuthority,
    sourceMarketType: 1 as const,
    marketSegment: 'USD_M' as const,
    productFamily: 'USD_M_PERPETUAL' as const,
  }));
}

function decimal(
  value: unknown,
  index: number,
  field: string,
  constraint: 'FINITE' | 'NON_NEGATIVE' | 'POSITIVE',
): ParseResult<number> {
  if (value === undefined || value === null || value === '') {
    return failure(issue('MISSING_FIELD', index, field, `${field} is required`));
  }
  if (typeof value !== 'number' && (typeof value !== 'string' || !DECIMAL.test(value))) {
    return failure(issue('INVALID_FIELD', index, field, `${field} must be a finite decimal`));
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return failure(issue('INVALID_FIELD', index, field, `${field} must be finite`));
  }
  if (constraint === 'POSITIVE' && parsed <= 0) {
    return failure(issue('INVALID_FIELD', index, field, `${field} must be positive`));
  }
  if (constraint === 'NON_NEGATIVE' && parsed < 0) {
    return failure(issue('INVALID_FIELD', index, field, `${field} must be non-negative`));
  }
  return success(Object.is(parsed, -0) ? 0 : parsed);
}

function optionalDecimal(
  value: unknown,
  index: number,
  field: string,
  constraint: 'FINITE' | 'NON_NEGATIVE' | 'POSITIVE',
  zeroIsMissing = false,
): ParseResult<number | null> {
  if (value === undefined || value === null || value === '') return success(null);
  const parsed = decimal(value, index, field, constraint);
  if (!parsed.ok) return parsed;
  return success(zeroIsMissing && parsed.value === 0 ? null : parsed.value);
}

function timestamp(
  value: unknown,
  index: number,
  field: string,
  receiveTimeMs?: number,
  futureSkewMs?: number,
): ParseResult<number> {
  let parsed: number;
  if (typeof value === 'number') parsed = value;
  else if (typeof value === 'string' && /^\d+$/.test(value)) parsed = Number(value);
  else return failure(issue(value === undefined || value === null ? 'MISSING_FIELD' : 'INVALID_FIELD', index, field, `${field} must be an epoch-millisecond safe integer`));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return failure(issue('INVALID_FIELD', index, field, `${field} must be a non-negative safe integer`));
  }
  if (receiveTimeMs !== undefined && futureSkewMs !== undefined && parsed > receiveTimeMs + futureSkewMs) {
    return failure(issue('INVALID_FIELD', index, field, `${field} exceeds maximum future skew`));
  }
  return success(parsed);
}

function optionalTimestamp(value: unknown, index: number, field: string, zeroIsMissing = false): ParseResult<number | null> {
  if (value === undefined || value === null || value === '') return success(null);
  const parsed = timestamp(value, index, field);
  if (!parsed.ok) return parsed;
  return success(zeroIsMissing && parsed.value === 0 ? null : parsed.value);
}

function identifier(value: unknown, index: number, field: string): ParseResult<string> {
  if (typeof value === 'string' && /^\d+$/.test(value)) return success(value.replace(/^0+(?=\d)/, ''));
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return success(String(value));
  return failure(issue(value === undefined || value === null ? 'MISSING_FIELD' : 'INVALID_FIELD', index, field, `${field} must be a decimal integer identity`));
}

function eventType(record: PlainRecord, expected: string, index: number): FuturesDecodeIssue | null {
  if (record.e === expected) return null;
  return issue(
    record.e === undefined || record.e === null ? 'MISSING_FIELD' : 'INVALID_EVENT_TYPE',
    index,
    'e',
    `Expected Futures event type ${expected}`,
  );
}

function frozenMissing(fields: string[]): readonly string[] {
  return Object.freeze([...fields]);
}

function officialRecord(record: PlainRecord, fields: readonly string[]): Readonly<PlainRecord> {
  const output: PlainRecord = {};
  for (const field of fields) {
    if (Object.hasOwn(record, field) && record[field] !== undefined) output[field] = record[field];
  }
  return Object.freeze(output);
}

function parseBook(
  record: PlainRecord,
  index: number,
  receiveTimeMs: number,
  futureSkewMs: number,
): ParseResult<FuturesBookTickerObservation> {
  const typeIssue = eventType(record, 'bookTicker', index);
  if (typeIssue) return failure(typeIssue);
  const id = identity(record, index);
  if (!id.ok) return id;
  const eventTime = timestamp(record.E, index, 'E', receiveTimeMs, futureSkewMs);
  if (!eventTime.ok) return eventTime;
  const transactionTime = timestamp(record.T, index, 'T', receiveTimeMs, futureSkewMs);
  if (!transactionTime.ok) return transactionTime;
  const updateId = identifier(record.u, index, 'u');
  if (!updateId.ok) return updateId;
  const bidPrice = decimal(record.b, index, 'b', 'POSITIVE');
  if (!bidPrice.ok) return bidPrice;
  const bidQuantity = decimal(record.B, index, 'B', 'POSITIVE');
  if (!bidQuantity.ok) return bidQuantity;
  const askPrice = decimal(record.a, index, 'a', 'POSITIVE');
  if (!askPrice.ok) return askPrice;
  const askQuantity = decimal(record.A, index, 'A', 'POSITIVE');
  if (!askQuantity.ok) return askQuantity;
  if (bidPrice.value >= askPrice.value) {
    return failure(issue('CROSSED_BOOK', index, null, 'Best bid must be below best ask'));
  }
  return success(Object.freeze({
    kind: 'USD_M_BOOK_TICKER' as const,
    ...id.value,
    rawRecord: officialRecord(record, ['e', 'E', 'T', 's', 'ps', 'st', 'u', 'b', 'B', 'a', 'A']),
    sourceEventTimeMs: eventTime.value,
    sourceTransactionTimeMs: transactionTime.value,
    receiveTimeMs,
    completeness: 'COMPLETE' as const,
    missingFields: frozenMissing([]),
    updateId: updateId.value,
    bidPrice: bidPrice.value,
    bidQuantity: bidQuantity.value,
    askPrice: askPrice.value,
    askQuantity: askQuantity.value,
    lastPrice: null,
  }));
}

function parseMarkFunding(
  record: PlainRecord,
  index: number,
  receiveTimeMs: number,
  futureSkewMs: number,
): ParseResult<FuturesMarkFundingObservation> {
  const typeIssue = eventType(record, 'markPriceUpdate', index);
  if (typeIssue) return failure(typeIssue);
  const id = identity(record, index, true);
  if (!id.ok) return id;
  const eventTime = timestamp(record.E, index, 'E', receiveTimeMs, futureSkewMs);
  if (!eventTime.ok) return eventTime;
  const markPrice = decimal(record.p, index, 'p', 'POSITIVE');
  if (!markPrice.ok) return markPrice;
  const indexPrice = decimal(record.i, index, 'i', 'POSITIVE');
  if (!indexPrice.ok) return indexPrice;
  const settlement = optionalDecimal(record.P, index, 'P', 'NON_NEGATIVE', true);
  if (!settlement.ok) return settlement;
  const movingAverage = optionalDecimal(record.ap, index, 'ap', 'NON_NEGATIVE', true);
  if (!movingAverage.ok) return movingAverage;
  const fundingRate = optionalDecimal(record.r, index, 'r', 'FINITE');
  if (!fundingRate.ok) return fundingRate;
  const nextFunding = optionalTimestamp(record.T, index, 'T', true);
  if (!nextFunding.ok) return nextFunding;
  const interval = optionalDecimal(record.fundingIntervalHours, index, 'fundingIntervalHours', 'POSITIVE');
  if (!interval.ok) return interval;
  const missingFields = [
    ...(id.value.pairAuthority === 'SYMBOL_ONLY_REQUIRES_RESOLUTION' ? ['pairSourceEvidence'] : []),
    ...(settlement.value === null ? ['estimatedSettlementPrice'] : []),
    ...(movingAverage.value === null ? ['movingAverageMarkPrice'] : []),
    ...(fundingRate.value === null ? ['fundingRate'] : []),
    ...(interval.value === null ? ['fundingIntervalHours'] : []),
    ...(nextFunding.value === null ? ['nextFundingTimeMs'] : []),
  ];
  return success(Object.freeze({
    kind: 'USD_M_MARK_FUNDING' as const,
    ...id.value,
    rawRecord: officialRecord(record, ['e', 'E', 's', 'ps', 'st', 'p', 'i', 'P', 'ap', 'r', 'T', 'fundingIntervalHours']),
    sourceEventTimeMs: eventTime.value,
    sourceTransactionTimeMs: null,
    receiveTimeMs,
    completeness: missingFields.some((field) => field !== 'fundingIntervalHours') ? 'PARTIAL' as const : 'COMPLETE' as const,
    missingFields: frozenMissing(missingFields),
    markPrice: markPrice.value,
    indexPrice: indexPrice.value,
    estimatedSettlementPrice: settlement.value,
    movingAverageMarkPrice: movingAverage.value,
    fundingRate: fundingRate.value,
    fundingIntervalHours: interval.value,
    nextFundingTimeMs: nextFunding.value,
    lastPrice: null,
  }));
}

function parseBracket(value: unknown, recordIndex: number, bracketIndex: number): ParseResult<FuturesContractBracketObservation> {
  if (!isRecord(value)) {
    return failure(issue('INVALID_FIELD', recordIndex, `bks[${bracketIndex}]`, 'Contract bracket must be an object'));
  }
  const fields = {
    bracket: decimal(value.bs, recordIndex, `bks[${bracketIndex}].bs`, 'POSITIVE'),
    notionalFloor: decimal(value.bnf, recordIndex, `bks[${bracketIndex}].bnf`, 'NON_NEGATIVE'),
    notionalCap: decimal(value.bnc, recordIndex, `bks[${bracketIndex}].bnc`, 'POSITIVE'),
    maintenanceMarginRate: decimal(value.mmr, recordIndex, `bks[${bracketIndex}].mmr`, 'NON_NEGATIVE'),
    cumulativeMaintenanceAmount: decimal(value.cf, recordIndex, `bks[${bracketIndex}].cf`, 'NON_NEGATIVE'),
    minimumLeverage: decimal(value.mi, recordIndex, `bks[${bracketIndex}].mi`, 'NON_NEGATIVE'),
    maximumLeverage: decimal(value.ma, recordIndex, `bks[${bracketIndex}].ma`, 'POSITIVE'),
  };
  for (const parsed of Object.values(fields)) if (!parsed.ok) return parsed;
  if (
    !fields.bracket.ok || !fields.notionalFloor.ok || !fields.notionalCap.ok
    || !fields.maintenanceMarginRate.ok || !fields.cumulativeMaintenanceAmount.ok
    || !fields.minimumLeverage.ok || !fields.maximumLeverage.ok
  ) {
    return failure(issue('INVALID_FIELD', recordIndex, `bks[${bracketIndex}]`, 'Invalid contract bracket'));
  }
  if (fields.notionalFloor.value > fields.notionalCap.value) {
    return failure(issue('INVALID_FIELD', recordIndex, `bks[${bracketIndex}]`, 'Contract bracket floor exceeds cap'));
  }
  if (fields.minimumLeverage.value > fields.maximumLeverage.value) {
    return failure(issue('INVALID_FIELD', recordIndex, `bks[${bracketIndex}]`, 'Contract bracket minimum leverage exceeds maximum'));
  }
  return success(Object.freeze({
    bracket: fields.bracket.value,
    notionalFloor: fields.notionalFloor.value,
    notionalCap: fields.notionalCap.value,
    maintenanceMarginRate: fields.maintenanceMarginRate.value,
    cumulativeMaintenanceAmount: fields.cumulativeMaintenanceAmount.value,
    minimumLeverage: fields.minimumLeverage.value,
    maximumLeverage: fields.maximumLeverage.value,
  }));
}

function parseBrackets(
  value: unknown,
  recordIndex: number,
  maximumContractBrackets: number,
): ParseResult<readonly FuturesContractBracketObservation[] | null> {
  if (value === undefined || value === null) return success(null);
  if (!Array.isArray(value)) return failure(issue('INVALID_FIELD', recordIndex, 'bks', 'bks must be an array when supplied'));
  if (value.length > maximumContractBrackets) {
    return failure(issue('CAPACITY_EXCEEDED', recordIndex, 'bks', 'Contract bracket update exceeds the bounded bracket capacity'));
  }
  const output: FuturesContractBracketObservation[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsed = parseBracket(value[index], recordIndex, index);
    if (!parsed.ok) return parsed;
    output.push(parsed.value);
  }
  output.sort((left, right) => left.bracket - right.bracket);
  for (let index = 1; index < output.length; index += 1) {
    if (output[index - 1]?.bracket === output[index]?.bracket) {
      return failure(issue('INVALID_FIELD', recordIndex, 'bks', 'Contract bracket IDs must be unique'));
    }
  }
  return success(Object.freeze(output));
}

function parseContract(
  record: PlainRecord,
  index: number,
  receiveTimeMs: number,
  futureSkewMs: number,
  maximumContractBrackets: number,
): ParseResult<FuturesContractObservation> {
  const typeIssue = eventType(record, 'contractInfo', index);
  if (typeIssue) return failure(typeIssue);
  const id = identity(record, index, true);
  if (!id.ok) return id;
  const eventTime = timestamp(record.E, index, 'E', receiveTimeMs, futureSkewMs);
  if (!eventTime.ok) return eventTime;
  const contractType = requiredString(record, 'ct', index);
  if (!contractType.ok) return contractType;
  if (contractType.value !== 'PERPETUAL') {
    return failure(issue('INVALID_FIELD', index, 'ct', 'Only PERPETUAL USD-M contract info belongs to this runtime product family'));
  }
  const contractStatus = requiredString(record, 'cs', index);
  if (!contractStatus.ok) return contractStatus;
  const delivery = timestamp(record.dt, index, 'dt');
  if (!delivery.ok) return delivery;
  const onboard = timestamp(record.ot, index, 'ot');
  if (!onboard.ok) return onboard;
  const brackets = parseBrackets(record.bks, index, maximumContractBrackets);
  if (!brackets.ok) return brackets;
  const missingFields = id.value.pairAuthority === 'SYMBOL_ONLY_REQUIRES_RESOLUTION'
    ? frozenMissing(['pairSourceEvidence'])
    : frozenMissing([]);
  return success(Object.freeze({
    kind: 'USD_M_CONTRACT_INFO' as const,
    ...id.value,
    rawRecord: Object.freeze({
      ...officialRecord(record, ['e', 'E', 's', 'ps', 'st', 'ct', 'dt', 'ot', 'cs']),
      ...(Array.isArray(record.bks)
        ? { bks: Object.freeze(record.bks.map((entry) => isRecord(entry)
          ? officialRecord(entry, ['bs', 'bnf', 'bnc', 'mmr', 'cf', 'mi', 'ma'])
          : entry)) }
        : {}),
    }),
    sourceEventTimeMs: eventTime.value,
    sourceTransactionTimeMs: null,
    receiveTimeMs,
    completeness: missingFields.length === 0 ? 'COMPLETE' as const : 'PARTIAL' as const,
    missingFields,
    contractType: contractType.value,
    contractStatus: contractStatus.value,
    deliveryTimeMs: delivery.value,
    onboardTimeMs: onboard.value,
    brackets: brackets.value,
  }));
}

function parseLiquidation(
  record: PlainRecord,
  index: number,
  receiveTimeMs: number,
  futureSkewMs: number,
): ParseResult<FuturesLiquidationObservation> {
  const typeIssue = eventType(record, 'forceOrder', index);
  if (typeIssue) return failure(typeIssue);
  if (!isRecord(record.o)) return failure(issue('MISSING_FIELD', index, 'o', 'Liquidation order object is required'));
  const order = record.o;
  const combined = { ...record, s: order.s };
  const id = identity(combined, index);
  if (!id.ok) return id;
  const eventTime = timestamp(record.E, index, 'E', receiveTimeMs, futureSkewMs);
  if (!eventTime.ok) return eventTime;
  const tradeTime = timestamp(order.T, index, 'o.T', receiveTimeMs, futureSkewMs);
  if (!tradeTime.ok) return tradeTime;
  const orderSide = order.S;
  if (orderSide !== 'BUY' && orderSide !== 'SELL') {
    return failure(issue(orderSide === undefined || orderSide === null ? 'MISSING_FIELD' : 'INVALID_FIELD', index, 'o.S', 'Liquidation side must be BUY or SELL'));
  }
  const orderType = requiredString(order, 'o', index);
  if (!orderType.ok) return orderType;
  const timeInForce = requiredString(order, 'f', index);
  if (!timeInForce.ok) return timeInForce;
  const orderStatus = requiredString(order, 'X', index);
  if (!orderStatus.ok) return orderStatus;
  const originalQuantity = decimal(order.q, index, 'o.q', 'POSITIVE');
  if (!originalQuantity.ok) return originalQuantity;
  const lastFilled = decimal(order.l, index, 'o.l', 'NON_NEGATIVE');
  if (!lastFilled.ok) return lastFilled;
  const accumulated = decimal(order.z, index, 'o.z', 'NON_NEGATIVE');
  if (!accumulated.ok) return accumulated;
  const limitPrice = optionalDecimal(order.p, index, 'o.p', 'NON_NEGATIVE', true);
  if (!limitPrice.ok) return limitPrice;
  const averagePrice = optionalDecimal(order.ap, index, 'o.ap', 'NON_NEGATIVE', true);
  if (!averagePrice.ok) return averagePrice;
  return success(Object.freeze({
    kind: 'USD_M_LIQUIDATION_CONTEXT' as const,
    ...id.value,
    rawRecord: Object.freeze({
      ...officialRecord(record, ['e', 'E', 'ps', 'st']),
      o: officialRecord(order, ['s', 'S', 'o', 'f', 'q', 'p', 'ap', 'X', 'l', 'z', 'T']),
    }),
    sourceEventTimeMs: eventTime.value,
    sourceTransactionTimeMs: tradeTime.value,
    receiveTimeMs,
    completeness: CURRENT_LIQUIDATION_SAMPLING.completeness,
    missingFields: frozenMissing([
      ...(limitPrice.value === null ? ['limitPrice'] : []),
      ...(averagePrice.value === null ? ['averagePrice'] : []),
    ]),
    orderSide,
    liquidatedPositionSide: orderSide === 'SELL' ? 'LONG' as const : 'SHORT' as const,
    orderType: orderType.value,
    timeInForce: timeInForce.value,
    orderStatus: orderStatus.value,
    originalQuantity: originalQuantity.value,
    lastFilledQuantity: lastFilled.value,
    accumulatedFilledQuantity: accumulated.value,
    limitPrice: limitPrice.value,
    averagePrice: averagePrice.value,
    sampledPerWindow: CURRENT_LIQUIDATION_SAMPLING.sampledPerWindow,
    samplingSelection: CURRENT_LIQUIDATION_SAMPLING.samplingSelection,
    sampleWindowMs: CURRENT_LIQUIDATION_SAMPLING.sampleWindowMs,
  }));
}

function decodeBatch<T>(
  raw: unknown,
  receiveTimeMs: number,
  options: FuturesDecodeOptions,
  expectedStream: string,
  parse: (
    record: PlainRecord,
    index: number,
    receiveTimeMs: number,
    futureSkewMs: number,
    maximumContractBrackets: number,
  ) => ParseResult<T>,
  ignoreNonPerpetualContracts = false,
): FuturesDecodeBatch<T> {
  const receiveIssue = validateReceiveTime(receiveTimeMs);
  const skew = maximumFutureSkew(options);
  const maximumRecords = positiveLimit(
    options.maximumRecordsPerMessage,
    DEFAULT_MAXIMUM_RECORDS_PER_MESSAGE,
    'maximumRecordsPerMessage',
    FUTURES_RUNTIME_HARD_LIMITS.maximumRecordsPerMessage,
  );
  const maximumBrackets = positiveLimit(
    options.maximumContractBrackets,
    DEFAULT_MAXIMUM_CONTRACT_BRACKETS,
    'maximumContractBrackets',
    FUTURES_RUNTIME_HARD_LIMITS.maximumContractBrackets,
  );
  if (receiveIssue || typeof skew !== 'number' || typeof maximumRecords !== 'number' || typeof maximumBrackets !== 'number') {
    const configurationIssue = receiveIssue ?? (typeof skew === 'number'
      ? typeof maximumRecords === 'number'
        ? typeof maximumBrackets === 'number'
          ? issue('INVALID_FIELD', null, 'maximumFutureSkewMs', 'maximumFutureSkewMs is invalid')
          : maximumBrackets
        : maximumRecords
      : skew);
    const issues = Object.freeze([configurationIssue]);
    return Object.freeze({
      observations: Object.freeze([]),
      ignored: Object.freeze([]),
      issues,
      overflow: Object.freeze({ records: 0, contractBrackets: 0 }),
      complete: false,
    });
  }
  const decoded = recordsFromWire(raw, expectedStream);
  if (!decoded.ok) {
    return Object.freeze({
      observations: Object.freeze([]),
      ignored: Object.freeze([]),
      issues: Object.freeze([decoded.issue]),
      overflow: Object.freeze({ records: 0, contractBrackets: 0 }),
      complete: false,
    });
  }
  const observations: T[] = [];
  const ignored: FuturesIgnoredRecord[] = [];
  const issues: FuturesDecodeIssue[] = [];
  const overflowRecords = Math.max(0, decoded.value.length - maximumRecords);
  let overflowContractBrackets = 0;
  if (overflowRecords > 0) {
    issues.push(issue(
      'CAPACITY_EXCEEDED',
      null,
      'records',
      `Futures payload exceeded maximumRecordsPerMessage by ${overflowRecords} records`,
    ));
  }
  const boundedLength = Math.min(decoded.value.length, maximumRecords);
  for (let index = 0; index < boundedLength; index += 1) {
    const candidate = decoded.value[index];
    if (!isRecord(candidate)) {
      issues.push(issue('MALFORMED_PAYLOAD', index, null, 'Array member must be an object'));
      continue;
    }
    if (Object.hasOwn(candidate, 'result') && Object.hasOwn(candidate, 'id') && !Object.hasOwn(candidate, 'e')) {
      ignored.push(Object.freeze({ recordIndex: index, reason: 'CONTROL_MESSAGE' as const }));
      continue;
    }
    if (candidate.st === 2) {
      ignored.push(Object.freeze({ recordIndex: index, reason: 'COIN_M_ST2' as const }));
      continue;
    }
    if (candidate.st !== 1) {
      issues.push(issue(
        candidate.st === undefined || candidate.st === null ? 'MISSING_FIELD' : 'INVALID_FIELD',
        index,
        'st',
        'Merged Futures payload must use numeric st=1 for USD-M',
      ));
      continue;
    }
    if (
      ignoreNonPerpetualContracts
      && candidate.e === 'contractInfo'
      && typeof candidate.ct === 'string'
      && candidate.ct.length > 0
      && candidate.ct !== 'PERPETUAL'
    ) {
      ignored.push(Object.freeze({ recordIndex: index, reason: 'NON_PERPETUAL_USD_M' as const }));
      continue;
    }
    const parsed = parse(candidate, index, receiveTimeMs, skew, maximumBrackets);
    if (parsed.ok) observations.push(parsed.value);
    else {
      issues.push(parsed.issue);
      if (parsed.issue.code === 'CAPACITY_EXCEEDED' && parsed.issue.field === 'bks' && Array.isArray(candidate.bks)) {
        overflowContractBrackets += Math.max(0, candidate.bks.length - maximumBrackets);
      }
    }
  }
  const overflow = Object.freeze({ records: overflowRecords, contractBrackets: overflowContractBrackets });
  return Object.freeze({
    observations: Object.freeze(observations),
    ignored: Object.freeze(ignored),
    issues: Object.freeze(issues),
    overflow,
    complete: issues.length === 0 && overflowRecords === 0 && overflowContractBrackets === 0,
  });
}

export function decodeUsdMBookTicker(
  raw: unknown,
  receiveTimeMs: number,
  options: FuturesDecodeOptions = {},
): FuturesDecodeBatch<FuturesBookTickerObservation> {
  return decodeBatch(raw, receiveTimeMs, options, '!bookTicker', parseBook);
}

export function decodeUsdMMarkFunding(
  raw: unknown,
  receiveTimeMs: number,
  options: FuturesDecodeOptions = {},
): FuturesDecodeBatch<FuturesMarkFundingObservation> {
  return decodeBatch(raw, receiveTimeMs, options, '!markPrice@arr@1s', parseMarkFunding);
}

export function decodeUsdMContractInfo(
  raw: unknown,
  receiveTimeMs: number,
  options: FuturesDecodeOptions = {},
): FuturesDecodeBatch<FuturesContractObservation> {
  return decodeBatch(raw, receiveTimeMs, options, '!contractInfo', parseContract, true);
}

export function decodeUsdMLiquidationContext(
  raw: unknown,
  receiveTimeMs: number,
  options: FuturesDecodeOptions = {},
): FuturesDecodeBatch<FuturesLiquidationObservation> {
  return decodeBatch(raw, receiveTimeMs, options, '!forceOrder@arr', parseLiquidation);
}

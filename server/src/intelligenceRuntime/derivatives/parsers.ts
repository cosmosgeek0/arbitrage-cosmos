import type {
  DerivativesCompleteness,
  DerivativesFactValue,
  DerivativesPeriod,
  FundingHistoryRow,
  FundingInfoValue,
  GlobalLongShortRow,
  OpenInterestHistoryRow,
  RefreshableDerivativesFactKind,
  TakerBuySellRow,
} from './types.js';

export interface ParsedRestFact {
  ok: boolean;
  value: DerivativesFactValue | null;
  sourceTimeMs: number | null;
  completeness: DerivativesCompleteness;
  issueCount: number;
  detail: string;
}

export interface ParsedFundingInfoFact {
  symbol: string;
  value: FundingInfoValue;
  completeness: 'COMPLETE' | 'PARTIAL';
  issueCount: number;
  detail: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedSymbol(value: unknown): string | null {
  return typeof value === 'string' && /^[\p{L}\p{N}._-]{1,128}$/u.test(value) ? value : null;
}

function decimal(value: unknown, nonNegative: boolean, positive = false): number | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128
    || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (nonNegative && parsed < 0) || (positive && parsed <= 0)) return null;
  return Object.is(parsed, -0) ? 0 : parsed;
}

function timestamp(value: unknown, receiveTimeMs: number, maximumFutureSkewMs: number): number | null {
  let parsed: number;
  if (typeof value === 'number') parsed = value;
  else if (typeof value === 'string' && /^\d{1,16}$/.test(value)) parsed = Number(value);
  else return null;
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= receiveTimeMs + maximumFutureSkewMs
    ? parsed
    : null;
}

function freezeRows<T extends object>(rows: readonly T[]): readonly T[] {
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

function invalid(detail: string): ParsedRestFact {
  return Object.freeze({
    ok: false,
    value: null,
    sourceTimeMs: null,
    completeness: 'MISSING' as const,
    issueCount: 1,
    detail,
  });
}

function seriesInput(body: unknown, maximumRows: number): {
  rows: readonly unknown[];
  truncated: boolean;
} | null {
  if (!Array.isArray(body)) return null;
  const truncated = body.length > maximumRows;
  return {
    rows: truncated ? body.slice(body.length - maximumRows) : body,
    truncated,
  };
}

function finishSeries(
  kind: Exclude<RefreshableDerivativesFactKind, 'OPEN_INTEREST_CURRENT' | 'FUNDING_INFO'>,
  rows: readonly object[],
  inputCount: number,
  issues: number,
  truncated: boolean,
  period: DerivativesPeriod,
): ParsedRestFact {
  if (inputCount > 0 && rows.length === 0 && issues > 0) return invalid(`${kind} response contained no valid rows`);
  const completeness = issues > 0 || truncated ? 'PARTIAL' as const : 'COMPLETE' as const;
  const sourceTimeMs = rows.length === 0 ? null : (rows.at(-1) as { timestampMs: number }).timestampMs;
  let value: DerivativesFactValue;
  if (kind === 'OPEN_INTEREST_HISTORY') {
    value = Object.freeze({ kind, period, rows: freezeRows(rows as OpenInterestHistoryRow[]) });
  } else if (kind === 'FUNDING_HISTORY') {
    value = Object.freeze({ kind, rows: freezeRows(rows as FundingHistoryRow[]) });
  } else if (kind === 'TAKER_BUY_SELL') {
    value = Object.freeze({ kind, period, rows: freezeRows(rows as TakerBuySellRow[]) });
  } else {
    value = Object.freeze({ kind, period, rows: freezeRows(rows as GlobalLongShortRow[]) });
  }
  return Object.freeze({
    ok: true,
    value,
    sourceTimeMs,
    completeness,
    issueCount: issues + (truncated ? 1 : 0),
    detail: completeness === 'COMPLETE' ? 'complete public response' : 'valid rows retained from a partial public response',
  });
}

function parseOpenInterestCurrent(
  body: unknown,
  symbol: string,
  receiveTimeMs: number,
  maximumFutureSkewMs: number,
): ParsedRestFact {
  if (!record(body) || boundedSymbol(body.symbol) !== symbol) return invalid('open-interest response identity is invalid');
  const openInterest = decimal(body.openInterest, true);
  const sourceTimeMs = timestamp(body.time, receiveTimeMs, maximumFutureSkewMs);
  if (openInterest === null || sourceTimeMs === null) return invalid('open-interest value or source time is invalid');
  return Object.freeze({
    ok: true,
    value: Object.freeze({ kind: 'OPEN_INTEREST_CURRENT' as const, openInterest }),
    sourceTimeMs,
    completeness: 'COMPLETE' as const,
    issueCount: 0,
    detail: 'complete public response',
  });
}

function parseOpenInterestHistory(
  body: unknown,
  symbol: string,
  period: DerivativesPeriod,
  receiveTimeMs: number,
  maximumFutureSkewMs: number,
  maximumRows: number,
): ParsedRestFact {
  const input = seriesInput(body, maximumRows);
  if (!input) return invalid('open-interest history response must be an array');
  const byTime = new Map<number, OpenInterestHistoryRow>();
  let issues = 0;
  for (const item of input.rows) {
    if (!record(item) || boundedSymbol(item.symbol) !== symbol) { issues += 1; continue; }
    const openInterest = decimal(item.sumOpenInterest, true);
    const openInterestValue = decimal(item.sumOpenInterestValue, true);
    const circulatingSupply = item.CMCCirculatingSupply === undefined || item.CMCCirculatingSupply === null
      ? null
      : decimal(item.CMCCirculatingSupply, true);
    const timestampMs = timestamp(item.timestamp, receiveTimeMs, maximumFutureSkewMs);
    if (openInterest === null || openInterestValue === null || timestampMs === null
      || (item.CMCCirculatingSupply !== undefined && item.CMCCirculatingSupply !== null && circulatingSupply === null)) {
      issues += 1;
      continue;
    }
    if (byTime.has(timestampMs)) issues += 1;
    byTime.set(timestampMs, { symbol, openInterest, openInterestValue, circulatingSupply, timestampMs });
  }
  const rows = [...byTime.values()].sort((left, right) => left.timestampMs - right.timestampMs);
  return finishSeries('OPEN_INTEREST_HISTORY', rows, input.rows.length, issues, input.truncated, period);
}

function parseFundingHistory(
  body: unknown,
  symbol: string,
  period: DerivativesPeriod,
  receiveTimeMs: number,
  maximumFutureSkewMs: number,
  maximumRows: number,
): ParsedRestFact {
  const input = seriesInput(body, maximumRows);
  if (!input) return invalid('funding history response must be an array');
  const byTime = new Map<number, FundingHistoryRow>();
  let issues = 0;
  for (const item of input.rows) {
    if (!record(item) || boundedSymbol(item.symbol) !== symbol) { issues += 1; continue; }
    const fundingRate = decimal(item.fundingRate, false);
    const markPrice = item.markPrice === undefined || item.markPrice === null || item.markPrice === ''
      ? null
      : decimal(item.markPrice, true, true);
    const fundingTimeMs = timestamp(item.fundingTime, receiveTimeMs, maximumFutureSkewMs);
    if (fundingRate === null || fundingTimeMs === null
      || (item.markPrice !== undefined && item.markPrice !== null && item.markPrice !== '' && markPrice === null)) {
      issues += 1;
      continue;
    }
    if (byTime.has(fundingTimeMs)) issues += 1;
    byTime.set(fundingTimeMs, { symbol, fundingRate, markPrice, fundingTimeMs });
  }
  const rows = [...byTime.values()]
    .sort((left, right) => left.fundingTimeMs - right.fundingTimeMs)
    .map((row) => ({ ...row, timestampMs: row.fundingTimeMs }));
  const parsed = finishSeries('FUNDING_HISTORY', rows, input.rows.length, issues, input.truncated, period);
  if (!parsed.ok || parsed.value?.kind !== 'FUNDING_HISTORY') return parsed;
  const value = Object.freeze({
    kind: 'FUNDING_HISTORY' as const,
    rows: freezeRows(rows.map(({ timestampMs: _timestampMs, ...row }) => row)),
  });
  return Object.freeze({ ...parsed, value });
}

function parseTakerBuySell(
  body: unknown,
  period: DerivativesPeriod,
  receiveTimeMs: number,
  maximumFutureSkewMs: number,
  maximumRows: number,
): ParsedRestFact {
  const input = seriesInput(body, maximumRows);
  if (!input) return invalid('taker buy/sell response must be an array');
  const byTime = new Map<number, TakerBuySellRow>();
  let issues = 0;
  for (const item of input.rows) {
    if (!record(item)) { issues += 1; continue; }
    const buySellRatio = decimal(item.buySellRatio, true);
    const buyVolume = decimal(item.buyVol, true);
    const sellVolume = decimal(item.sellVol, true);
    const timestampMs = timestamp(item.timestamp, receiveTimeMs, maximumFutureSkewMs);
    if (buySellRatio === null || buyVolume === null || sellVolume === null || timestampMs === null) {
      issues += 1;
      continue;
    }
    if (byTime.has(timestampMs)) issues += 1;
    byTime.set(timestampMs, { buySellRatio, buyVolume, sellVolume, timestampMs });
  }
  const rows = [...byTime.values()].sort((left, right) => left.timestampMs - right.timestampMs);
  return finishSeries('TAKER_BUY_SELL', rows, input.rows.length, issues, input.truncated, period);
}

function parseGlobalLongShort(
  body: unknown,
  symbol: string,
  period: DerivativesPeriod,
  receiveTimeMs: number,
  maximumFutureSkewMs: number,
  maximumRows: number,
): ParsedRestFact {
  const input = seriesInput(body, maximumRows);
  if (!input) return invalid('global long/short response must be an array');
  const byTime = new Map<number, GlobalLongShortRow>();
  let issues = 0;
  for (const item of input.rows) {
    if (!record(item) || boundedSymbol(item.symbol) !== symbol) { issues += 1; continue; }
    const longShortRatio = decimal(item.longShortRatio, true);
    const longAccount = decimal(item.longAccount, true);
    const shortAccount = decimal(item.shortAccount, true);
    const timestampMs = timestamp(item.timestamp, receiveTimeMs, maximumFutureSkewMs);
    if (longShortRatio === null || longAccount === null || shortAccount === null || timestampMs === null) {
      issues += 1;
      continue;
    }
    if (byTime.has(timestampMs)) issues += 1;
    byTime.set(timestampMs, { symbol, longShortRatio, longAccount, shortAccount, timestampMs });
  }
  const rows = [...byTime.values()].sort((left, right) => left.timestampMs - right.timestampMs);
  return finishSeries('GLOBAL_LONG_SHORT', rows, input.rows.length, issues, input.truncated, period);
}

export function parseDerivativesRestBody(input: {
  kind: Exclude<RefreshableDerivativesFactKind, 'FUNDING_INFO'>;
  body: unknown;
  symbol: string;
  period: DerivativesPeriod;
  receiveTimeMs: number;
  maximumFutureSkewMs: number;
  maximumRows: number;
}): ParsedRestFact {
  if (input.kind === 'OPEN_INTEREST_CURRENT') {
    return parseOpenInterestCurrent(input.body, input.symbol, input.receiveTimeMs, input.maximumFutureSkewMs);
  }
  if (input.kind === 'OPEN_INTEREST_HISTORY') {
    return parseOpenInterestHistory(input.body, input.symbol, input.period, input.receiveTimeMs, input.maximumFutureSkewMs, input.maximumRows);
  }
  if (input.kind === 'FUNDING_HISTORY') {
    return parseFundingHistory(input.body, input.symbol, input.period, input.receiveTimeMs, input.maximumFutureSkewMs, input.maximumRows);
  }
  if (input.kind === 'TAKER_BUY_SELL') {
    return parseTakerBuySell(input.body, input.period, input.receiveTimeMs, input.maximumFutureSkewMs, input.maximumRows);
  }
  return parseGlobalLongShort(input.body, input.symbol, input.period, input.receiveTimeMs, input.maximumFutureSkewMs, input.maximumRows);
}

export function parseFundingInfoBody(
  body: unknown,
  requestedSymbols: readonly string[],
  maximumRows: number,
): readonly ParsedFundingInfoFact[] | null {
  if (!Array.isArray(body)) return null;
  const truncated = body.length > maximumRows;
  const inspected = truncated ? body.slice(0, maximumRows) : body;
  const requested = new Set(requestedSymbols);
  const values = new Map<string, FundingInfoValue>();
  let issues = truncated ? 1 : 0;
  for (const item of inspected) {
    if (!record(item)) { issues += 1; continue; }
    const symbol = boundedSymbol(item.symbol);
    if (symbol === null) { issues += 1; continue; }
    if (!requested.has(symbol)) continue;
    const cap = decimal(item.adjustedFundingRateCap, false);
    const floor = decimal(item.adjustedFundingRateFloor, false);
    const interval = typeof item.fundingIntervalHours === 'number'
      && Number.isSafeInteger(item.fundingIntervalHours) && item.fundingIntervalHours > 0
      ? item.fundingIntervalHours
      : null;
    if (cap === null || floor === null || interval === null || floor > cap) { issues += 1; continue; }
    if (values.has(symbol)) issues += 1;
    values.set(symbol, Object.freeze({
      kind: 'FUNDING_INFO', adjusted: true, fundingIntervalHours: interval,
      adjustedFundingRateCap: cap, adjustedFundingRateFloor: floor,
    }));
  }
  const complete = issues === 0;
  return Object.freeze([...requestedSymbols].sort().map((symbol) => Object.freeze({
    symbol,
    value: values.get(symbol) ?? Object.freeze({
      kind: 'FUNDING_INFO' as const,
      adjusted: complete ? false : null,
      fundingIntervalHours: null,
      adjustedFundingRateCap: null,
      adjustedFundingRateFloor: null,
    }),
    completeness: complete ? 'COMPLETE' as const : 'PARTIAL' as const,
    issueCount: issues,
    detail: complete
      ? 'complete adjustment response; absence means no adjusted row'
      : 'funding-info response was incomplete; absent adjustment rows remain unknown',
  })));
}

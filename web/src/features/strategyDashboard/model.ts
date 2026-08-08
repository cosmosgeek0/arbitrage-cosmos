import type {
  AccountPnlInput,
  AccountPnlMirror,
  AccountPnlPoint,
  AccountPnlView,
  StrategyDashboardEvidence,
  StrategyDashboardEvidenceSource,
  StrategyDashboardEvidenceState,
} from './types';

export type StrategyDashboardTone = 'ok' | 'warn' | 'bad' | 'idle';

const NON_PUBLISHABLE = new Set<StrategyDashboardEvidenceState>([
  'NOT_CONFIGURED',
  'UNAVAILABLE',
  'MISSING',
  'UNKNOWN',
]);
const EVIDENCE_STATES = new Set<StrategyDashboardEvidenceState>([
  'CURRENT',
  'STALE',
  'PARTIAL',
  'NOT_CONFIGURED',
  'UNAVAILABLE',
  'MISSING',
  'UNKNOWN',
]);
const EVIDENCE_SOURCES = new Set<StrategyDashboardEvidenceSource>([
  'PRODUCTION_OBSERVED',
  'RECORDED_REPLAY',
  'SYNTHETIC_ONLY',
]);
const MAX_ABS_MONEY = 1_000_000_000_000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeInstant(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function finiteMoney(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Math.abs(value) <= MAX_ABS_MONEY;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function safeReasonCodes(value: unknown): string[] {
  return stringArray(value) ? [...value] : [];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0))].sort();
}

function validDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DAY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function effectiveEvidenceState(
  evidence: Readonly<StrategyDashboardEvidence>,
  nowMs: number,
): StrategyDashboardEvidenceState {
  if (!isRecord(evidence)) return 'UNKNOWN';
  if (!EVIDENCE_STATES.has(evidence.state as StrategyDashboardEvidenceState)) return 'UNKNOWN';
  if (!EVIDENCE_SOURCES.has(evidence.source as StrategyDashboardEvidenceSource)
    || !stringArray(evidence.reasonCodes)
    || !safeInstant(nowMs)) {
    return 'UNKNOWN';
  }
  const state = evidence.state as StrategyDashboardEvidenceState;
  if (NON_PUBLISHABLE.has(state)) {
    const observedValid = evidence.observedAtMs === null
      || safeInstant(evidence.observedAtMs) && evidence.observedAtMs <= nowMs;
    const maxAgeValid = evidence.maxAgeMs === null
      || safeInstant(evidence.maxAgeMs) && evidence.maxAgeMs > 0;
    return observedValid && maxAgeValid ? state : 'UNKNOWN';
  }
  if (!safeInstant(evidence.observedAtMs)
    || evidence.observedAtMs > nowMs
    || !safeInstant(evidence.maxAgeMs)
    || evidence.maxAgeMs === 0) {
    return 'UNKNOWN';
  }
  if (state === 'STALE' || nowMs - evidence.observedAtMs > evidence.maxAgeMs) {
    return 'STALE';
  }
  return state;
}

const absoluteUsdFormatters = new Map<string, Intl.NumberFormat>();

function absoluteUsdFormatter(
  fractionDigits: number,
  useGrouping: boolean,
): Intl.NumberFormat {
  const key = `${fractionDigits}:${useGrouping}`;
  const existing = absoluteUsdFormatters.get(key);
  if (existing) return existing;
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    roundingMode: 'halfExpand',
    useGrouping,
  } as Intl.NumberFormatOptions);
  absoluteUsdFormatters.set(key, formatter);
  return formatter;
}

function formatAbsoluteUsd(
  value: number,
  fractionDigits: number,
  useGrouping = true,
): string {
  return absoluteUsdFormatter(fractionDigits, useGrouping).format(Math.abs(value));
}

function adaptiveFractionDigits(value: number): number | null {
  const absolute = Math.abs(value);
  if (absolute === 0 || absolute >= 0.01) return 2;
  const tolerance = Number.EPSILON * 4;
  for (let digits = 3; digits <= 8; digits += 1) {
    const formatted = Number(formatAbsoluteUsd(value, digits, false));
    if (formatted > 0 && Math.abs(formatted - absolute) <= tolerance) return digits;
  }
  return Number(formatAbsoluteUsd(value, 8, false)) > 0 ? 8 : null;
}

export function formatUsd(value: number | null, signed = false): string {
  if (!finiteMoney(value)) return '—';
  const fractionDigits = adaptiveFractionDigits(value);
  const sign = value < 0 ? '−' : signed && value > 0 ? '+' : '';
  if (fractionDigits === null) {
    return `${sign}$<0.00000001`;
  }
  return `${sign}$${formatAbsoluteUsd(value, fractionDigits)}`;
}

function compensatedMoneySum(values: readonly number[]): number | null {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    if (!finiteMoney(value)) return null;
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value)
      ? (sum - next) + value
      : (value - next) + sum;
    sum = next;
  }
  const total = sum + correction;
  if (!finiteMoney(total)) return null;
  return total === 0 ? 0 : total;
}

function validNamedMoneyRow(
  value: unknown,
  key: 'symbol' | 'asset',
  amount: 'usd' | 'amount',
): boolean {
  return isRecord(value)
    && typeof value[key] === 'string'
    && (value[key] as string).trim().length > 0
    && finiteMoney(value[amount]);
}

function mirrorMalformedReason(mirror: unknown): string | null {
  if (!isRecord(mirror)
    || !Array.isArray(mirror.realizedByDay)
    || !Array.isArray(mirror.realizedBySymbol)
    || !Array.isArray(mirror.feesByAsset)
    || !Array.isArray(mirror.equitySnapshots)
    || !isRecord(mirror.integrity)
    || !Array.isArray(mirror.integrity.days)
    || !stringArray(mirror.integrity.reasons)) {
    return 'PNL_MIRROR_MALFORMED';
  }
  if (!mirror.realizedBySymbol.every((row) => validNamedMoneyRow(row, 'symbol', 'usd'))
    || !mirror.feesByAsset.every((row) => validNamedMoneyRow(row, 'asset', 'amount'))
    || !mirror.equitySnapshots.every((row) => isRecord(row)
      && safeInstant(row.ts)
      && finiteMoney(row.totalUsdt))) {
    return 'PNL_MIRROR_MALFORMED';
  }
  const days = new Set<string>();
  for (const row of mirror.realizedByDay) {
    if (!isRecord(row)
      || !validDay(row.day)
      || !finiteMoney(row.usd)
      || days.has(row.day)) {
      return 'PNL_MIRROR_MALFORMED';
    }
    days.add(row.day);
  }
  const integrityDays = new Set<string>();
  for (const row of mirror.integrity.days) {
    if (!isRecord(row)
      || !validDay(row.day)
      || typeof row.complete !== 'boolean'
      || !finiteMoney(row.feeUsd)
      || !finiteMoney(row.netUsd)
      || !stringArray(row.reasons)
      || integrityDays.has(row.day)) {
      return 'PNL_INTEGRITY_MALFORMED';
    }
    integrityDays.add(row.day);
  }
  if (!['UNKNOWN', 'COMPLETE', 'PARTIAL'].includes(mirror.integrity.state as string)
    || typeof mirror.integrity.complete !== 'boolean'
    || ((mirror.integrity.state === 'COMPLETE') !== mirror.integrity.complete)) {
    return 'PNL_INTEGRITY_CONTRADICTORY';
  }
  if (mirror.integrity.state === 'COMPLETE') {
    if (mirror.integrity.days.length === 0) {
      return 'PNL_COMPLETE_INTEGRITY_EMPTY';
    }
    if (mirror.integrity.reasons.length > 0
      || mirror.integrity.days.some((row) => !row.complete || row.reasons.length > 0)
      || [...days].some((day) => !integrityDays.has(day))) {
      return 'PNL_INTEGRITY_CONTRADICTORY';
    }
  }
  const total = compensatedMoneySum(mirror.realizedByDay.map((row) => {
    return (row as Record<string, number>).usd;
  }));
  return total === null ? 'PNL_TOTAL_OUT_OF_RANGE' : null;
}

export function projectAccountPnl(
  input: Readonly<AccountPnlInput>,
  nowMs: number,
): AccountPnlView {
  let state = effectiveEvidenceState(input, nowMs);
  const inputRecord: Record<string, unknown> = isRecord(input) ? input : {};
  const reasons = safeReasonCodes(inputRecord.reasonCodes);
  if (state === 'CURRENT' && reasons.length > 0) state = 'PARTIAL';
  const mirror = inputRecord.mirror;
  let validMirror: Readonly<AccountPnlMirror> | null = null;
  let integrityState: AccountPnlView['integrityState'] = 'UNAVAILABLE';
  if (mirror === null) {
    if (state === 'CURRENT' || state === 'PARTIAL' || state === 'STALE') state = 'UNAVAILABLE';
    reasons.push('PNL_MIRROR_UNAVAILABLE');
  } else {
    const malformed = mirrorMalformedReason(mirror);
    if (malformed) {
      state = 'UNKNOWN';
      reasons.push(malformed);
    } else {
      validMirror = mirror as unknown as Readonly<AccountPnlMirror>;
      integrityState = validMirror.integrity.state;
    }
    if (validMirror?.integrity.state === 'UNKNOWN') {
      state = 'UNKNOWN';
      reasons.push(...validMirror.integrity.reasons, 'PNL_INTEGRITY_UNKNOWN');
    } else if (validMirror
      && !NON_PUBLISHABLE.has(state)
      && (!validMirror.integrity.complete || validMirror.integrity.state === 'PARTIAL')) {
      reasons.push(...validMirror.integrity.reasons, 'PNL_INTEGRITY_PARTIAL');
      if (state !== 'STALE') state = 'PARTIAL';
    }
  }
  const publishable = !NON_PUBLISHABLE.has(state);
  const points: AccountPnlPoint[] = publishable && validMirror
    ? [...validMirror.realizedByDay]
      .sort((left, right) => left.day.localeCompare(right.day))
      .map((row) => ({ day: row.day, realizedUsd: row.usd }))
    : [];
  const total = publishable && !(integrityState === 'PARTIAL' && points.length === 0)
    ? compensatedMoneySum(points.map((point) => point.realizedUsd))
    : null;
  const sourceLabel = inputRecord.source === 'RECORDED_REPLAY'
    || inputRecord.source === 'SYNTHETIC_ONLY'
    ? inputRecord.source
    : null;
  const label = state === 'CURRENT'
    ? sourceLabel ?? 'CURRENT'
    : publishable
      ? [
        state,
        state !== 'PARTIAL' && integrityState === 'PARTIAL' ? 'PARTIAL' : null,
        sourceLabel,
      ].filter((part): part is string => part !== null).join(' · ')
      : state;
  const tone: StrategyDashboardTone = state === 'CURRENT'
    ? inputRecord.source === 'PRODUCTION_OBSERVED'
      ? 'ok'
      : EVIDENCE_SOURCES.has(inputRecord.source as StrategyDashboardEvidenceSource) ? 'warn' : 'bad'
    : state === 'STALE' || state === 'PARTIAL'
      ? 'warn'
      : 'bad';
  return {
    evidenceState: state,
    evidenceLabel: label,
    integrityState,
    tone,
    publishable,
    totalRealizedUsd: total,
    points,
    reasonCodes: uniqueSorted(reasons),
  };
}

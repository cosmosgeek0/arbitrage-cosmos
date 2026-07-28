import type {
  SystemComponentSnapshot,
  SystemSupervisorSnapshot,
  SystemTruthLabel,
} from '../../lib/systemIntegration';
import type {
  AccountPnlInput,
  AccountPnlMirror,
  AccountPnlPoint,
  AccountPnlView,
  StrategyDashboardEvidence,
  StrategyDashboardEvidenceSource,
  StrategyDashboardEvidenceState,
  StrategyDashboardView,
  StrategyEngineView,
  StrategyId,
  SupervisorRuntimeInput,
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
const TRUTH_LABELS = new Set<SystemTruthLabel>([
  'LIVE_PUBLIC',
  'DRY_RUN',
  'SYNTHETIC_ONLY',
  'RECORDED_REPLAY',
  'UNAVAILABLE',
  'UNKNOWN',
]);
const EVIDENCE_SOURCES = new Set<StrategyDashboardEvidenceSource>([
  'PRODUCTION_OBSERVED',
  'RECORDED_REPLAY',
  'SYNTHETIC_ONLY',
]);
const READINESS_STATES = new Set([
  'STOPPED',
  'WARMING',
  'READY',
  'DEGRADED',
  'BLOCKED',
  'FAILED',
]);
const TRACE_KINDS = new Set([
  'CONTROL',
  'SOURCE',
  'STRATEGY',
  'INTELLIGENCE',
  'CAPITAL',
  'RISK',
  'EXECUTION',
  'RECONCILIATION',
  'PERSISTENCE',
  'SUPERVISOR',
]);
const MAX_ABS_MONEY = 1_000_000_000_000;
const CLOCK_SKEW_TOLERANCE_MS = 2_000;
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

export function evidenceLabel(
  evidence: Readonly<StrategyDashboardEvidence>,
  nowMs: number,
): string {
  const state = effectiveEvidenceState(evidence, nowMs);
  if (state !== 'CURRENT') return state;
  if (!EVIDENCE_SOURCES.has(evidence.source)) return 'UNKNOWN';
  return evidence.source === 'PRODUCTION_OBSERVED' ? 'CURRENT' : evidence.source;
}

export function evidenceTone(
  evidence: Readonly<StrategyDashboardEvidence>,
  nowMs: number,
): StrategyDashboardTone {
  const state = effectiveEvidenceState(evidence, nowMs);
  if (state === 'CURRENT') {
    return evidence.source === 'PRODUCTION_OBSERVED'
      ? 'ok'
      : EVIDENCE_SOURCES.has(evidence.source) ? 'warn' : 'bad';
  }
  return state === 'STALE' || state === 'PARTIAL' ? 'warn' : 'bad';
}

export function publishableEvidence(
  evidence: Readonly<StrategyDashboardEvidence>,
  nowMs: number,
): boolean {
  return !NON_PUBLISHABLE.has(effectiveEvidenceState(evidence, nowMs));
}

export function projectUsdToSignedCents(value: unknown): number | null {
  if (!finiteMoney(value)) return null;
  const cents = scaledUnitsFromFormatted(value, 2);
  if (!Number.isSafeInteger(cents)) return null;
  if (cents === 0) return 0;
  return value < 0 ? -cents : cents;
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

function scaledUnitsFromFormatted(value: number, fractionDigits: number): number {
  const fixed = formatAbsoluteUsd(value, fractionDigits, false);
  const [whole = '0', fraction = ''] = fixed.split('.');
  return Number(whole) * (10 ** fractionDigits)
    + Number(fraction.padEnd(fractionDigits, '0'));
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

export function formatCount(value: number | null): string {
  return value !== null && Number.isSafeInteger(value) && value >= 0
    ? value.toLocaleString('en-US')
    : '—';
}

export function formatAge(atMs: number | null, nowMs: number): string {
  if (!safeInstant(atMs) || !safeInstant(nowMs) || nowMs < atMs) return 'Age Unknown';
  const seconds = Math.floor((nowMs - atMs) / 1_000);
  if (seconds < 60) return `${seconds}s Ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m Ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h Ago`;
  return `${Math.floor(hours / 24)}d Ago`;
}

function componentFreshness(
  component: Readonly<SystemComponentSnapshot> | null,
  nowMs: number,
): { state: StrategyDashboardEvidenceState; label: string; reasons: string[] } {
  if (!component) {
    return { state: 'UNAVAILABLE', label: 'UNAVAILABLE', reasons: ['ENGINE_COMPONENT_UNAVAILABLE'] };
  }
  const reasons: string[] = [];
  if (component.freshness?.state !== 'FRESH') {
    reasons.push(`FRESHNESS_${component.freshness?.state ?? 'UNKNOWN'}`);
  }
  if (component.freshness?.ageMs === null) {
    reasons.push('FRESHNESS_AGE_UNAVAILABLE');
  }
  const source = component.sourceTimestamp;
  if (!source) {
    reasons.push('SOURCE_TIMESTAMP_UNAVAILABLE');
  }
  if (component.freshness
    && component.freshness.ageMs !== null
    && source) {
    const basisTime = source.sourceTimeMs ?? source.receivedAtMs;
    const evaluatedAge = component.freshness.evaluatedAt - basisTime;
    if (component.freshness.ageMs !== evaluatedAge) {
      reasons.push('FRESHNESS_AGE_INCONSISTENT');
    }
    if (component.freshness.ageMs < -CLOCK_SKEW_TOLERANCE_MS) {
      reasons.push('FRESHNESS_CLOCK_SKEWED');
    }
    if (component.freshness.ageMs > source.maxAgeMs) {
      reasons.push('FRESHNESS_CONTRACT_EXCEEDED');
    }
  }
  const sourceAge = source && safeInstant(nowMs)
    ? nowMs - (source.sourceTimeMs ?? source.receivedAtMs)
    : null;
  if (source && sourceAge !== null && sourceAge < -CLOCK_SKEW_TOLERANCE_MS) {
    reasons.push('FRESHNESS_CLOCK_SKEWED');
  }
  if (source && sourceAge !== null && sourceAge > source.maxAgeMs) {
    reasons.push('FRESHNESS_CONTRACT_EXCEEDED');
  }
  if (!component.freshness || reasons.length > 0) {
    const stale = reasons.some((reason) => reason.includes('STALE') || reason.includes('EXCEEDED'));
    return {
      state: stale ? 'STALE' : 'UNKNOWN',
      label: stale ? 'STALE' : component.freshness?.state ?? 'UNKNOWN',
      reasons,
    };
  }
  return { state: 'CURRENT', label: 'FRESH', reasons: [] };
}

function nullableInstant(value: unknown): boolean {
  return value === null || safeInstant(value);
}

function nullableAge(value: unknown): boolean {
  return value === null || Number.isSafeInteger(value);
}

function nullableCount(value: unknown): boolean {
  return value === null
    || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function validStrategySummary(value: unknown, upperBoundMs: number): boolean {
  if (!isRecord(value)
    || !TRUTH_LABELS.has(value.truthLabel as SystemTruthLabel)
    || !nullableInstant(value.heartbeatAtMs)
    || !nullableInstant(value.lastDecisionAtMs)
    || safeInstant(value.heartbeatAtMs) && value.heartbeatAtMs > upperBoundMs
    || safeInstant(value.lastDecisionAtMs) && value.lastDecisionAtMs > upperBoundMs
    || !nullableString(value.sourceRevision)) {
    return false;
  }
  return [
    value.candidateCount,
    value.proposalCount,
    value.cooldownCount,
    value.rejectionCount,
    value.acceptedCount,
  ].every(nullableCount);
}

function validEngineComponent(value: unknown, upperBoundMs: number): boolean {
  if (!isRecord(value)
    || typeof value.componentId !== 'string'
    || !READINESS_STATES.has(value.readiness as string)
    || typeof value.phase !== 'string'
    || !TRUTH_LABELS.has(value.truthLabel as SystemTruthLabel)
    || !stringArray(value.blockerCodes)) {
    return false;
  }
  if (value.lastFailure !== null
    && (!isRecord(value.lastFailure) || typeof value.lastFailure.code !== 'string')) {
    return false;
  }
  if (value.freshness !== null
    && (!isRecord(value.freshness)
      || typeof value.freshness.state !== 'string'
      || !nullableAge(value.freshness.ageMs)
      || !safeInstant(value.freshness.evaluatedAt)
      || value.freshness.evaluatedAt > upperBoundMs)) {
    return false;
  }
  if (value.sourceTimestamp !== null
    && (!isRecord(value.sourceTimestamp)
      || !nullableInstant(value.sourceTimestamp.sourceTimeMs)
      || !safeInstant(value.sourceTimestamp.receivedAtMs)
      || !safeInstant(value.sourceTimestamp.maxAgeMs)
      || value.sourceTimestamp.maxAgeMs === 0
      || value.sourceTimestamp.receivedAtMs > upperBoundMs
      || safeInstant(value.sourceTimestamp.sourceTimeMs)
        && value.sourceTimestamp.sourceTimeMs - upperBoundMs > CLOCK_SKEW_TOLERANCE_MS)) {
    return false;
  }
  return true;
}

function validTrace(value: unknown, upperBoundMs: number): boolean {
  if (!isRecord(value)
    || typeof value.eventId !== 'string'
    || typeof value.correlationId !== 'string'
    || typeof value.componentId !== 'string'
    || typeof value.kind !== 'string'
    || !safeInstant(value.occurredAtMs)
    || value.occurredAtMs > upperBoundMs
    || !TRUTH_LABELS.has(value.truthLabel as SystemTruthLabel)
    || !nullableString(value.ownerId)
    || !nullableString(value.failureCode)) {
    return false;
  }
  if (!TRACE_KINDS.has(value.kind as string)) return false;
  return value.componentId !== 'basis-engine'
    && value.componentId !== 'volume-engine'
    || value.kind === 'STRATEGY';
}

function supervisorMalformedReason(value: unknown, upperBoundMs: number): string | null {
  if (!isRecord(value)
    || !TRUTH_LABELS.has(value.truthLabel as SystemTruthLabel)
    || !safeInstant(value.evaluatedAtMs)
    || !Array.isArray(value.components)
    || !value.components.every(isRecord)
    || !isRecord(value.summaries)
    || !isRecord(value.summaries.strategies)
    || !validStrategySummary(value.summaries.strategies.basis, upperBoundMs)
    || !validStrategySummary(value.summaries.strategies.volume, upperBoundMs)
    || !Array.isArray(value.recentCorrelatedDecisions)
    || !value.recentCorrelatedDecisions.every((trace) => {
      return validTrace(trace, upperBoundMs);
    })) {
    return 'SYSTEM_SUPERVISOR_SNAPSHOT_MALFORMED';
  }
  const engineComponents = value.components.filter((component) => {
    return component.componentId === 'basis-engine' || component.componentId === 'volume-engine';
  });
  const engineIds = new Set(engineComponents.map((component) => component.componentId));
  return engineComponents.length === 2
    && engineIds.size === 2
    && engineIds.has('basis-engine')
    && engineIds.has('volume-engine')
    && engineComponents.every((component) => {
      return validEngineComponent(component, upperBoundMs);
    })
    ? null
    : 'SYSTEM_SUPERVISOR_SNAPSHOT_MALFORMED';
}

interface RuntimeSnapshotEvaluation {
  readonly state: StrategyDashboardEvidenceState;
  readonly snapshot: Readonly<SystemSupervisorSnapshot> | null;
  readonly reasonCodes: readonly string[];
}

function evaluateRuntimeSnapshot(
  runtime: Readonly<SupervisorRuntimeInput>,
  nowMs: number,
): RuntimeSnapshotEvaluation {
  if (!isRecord(runtime)) {
    return {
      state: 'UNKNOWN',
      snapshot: null,
      reasonCodes: ['SYSTEM_RUNTIME_EVIDENCE_MALFORMED'],
    };
  }
  const envelope = effectiveEvidenceState(runtime, nowMs);
  if (NON_PUBLISHABLE.has(envelope)) {
    return {
      state: envelope,
      snapshot: null,
      reasonCodes: envelope === 'UNKNOWN' ? ['SYSTEM_RUNTIME_EVIDENCE_MALFORMED'] : [],
    };
  }
  if (runtime.snapshot === null) {
    return {
      state: envelope === 'UNKNOWN' ? 'UNKNOWN' : 'UNAVAILABLE',
      snapshot: null,
      reasonCodes: ['SYSTEM_SUPERVISOR_SNAPSHOT_UNAVAILABLE'],
    };
  }
  if (!safeInstant(nowMs)
    || !safeInstant(runtime.maxAgeMs)
    || runtime.maxAgeMs === 0
    || !isRecord(runtime.snapshot)
    || !safeInstant(runtime.snapshot.evaluatedAtMs)) {
    return {
      state: 'UNKNOWN',
      snapshot: null,
      reasonCodes: ['SYSTEM_SUPERVISOR_SNAPSHOT_TIME_INVALID'],
    };
  }
  const snapshot = runtime.snapshot as Readonly<SystemSupervisorSnapshot>;
  if (snapshot.evaluatedAtMs > nowMs) {
    return {
      state: 'UNKNOWN',
      snapshot: null,
      reasonCodes: ['SYSTEM_SUPERVISOR_SNAPSHOT_FUTURE'],
    };
  }
  const malformed = supervisorMalformedReason(snapshot, nowMs);
  if (malformed) {
    return { state: 'UNKNOWN', snapshot: null, reasonCodes: [malformed] };
  }
  if (snapshot.truthLabel === 'UNAVAILABLE') {
    return {
      state: 'UNAVAILABLE',
      snapshot: null,
      reasonCodes: ['SYSTEM_SUPERVISOR_TRUTH_UNAVAILABLE'],
    };
  }
  if (snapshot.truthLabel === 'UNKNOWN') {
    return {
      state: 'UNKNOWN',
      snapshot: null,
      reasonCodes: ['SYSTEM_SUPERVISOR_TRUTH_UNKNOWN'],
    };
  }
  if (nowMs - snapshot.evaluatedAtMs > runtime.maxAgeMs) {
    return {
      state: 'STALE',
      snapshot,
      reasonCodes: ['SYSTEM_SUPERVISOR_SNAPSHOT_STALE'],
    };
  }
  if (envelope !== 'CURRENT') {
    return {
      state: envelope,
      snapshot: NON_PUBLISHABLE.has(envelope) ? null : snapshot,
      reasonCodes: envelope === 'UNKNOWN' ? ['SYSTEM_RUNTIME_EVIDENCE_MALFORMED'] : [],
    };
  }
  return safeReasonCodes(runtime.reasonCodes).length > 0
    ? { state: 'PARTIAL', snapshot, reasonCodes: [] }
    : { state: 'CURRENT', snapshot, reasonCodes: [] };
}

function runtimeLabel(
  source: unknown,
  state: StrategyDashboardEvidenceState,
  snapshot: Readonly<SystemSupervisorSnapshot> | null,
): string {
  if (state !== 'CURRENT') return state;
  if (!snapshot) return 'UNAVAILABLE';
  if (source !== 'PRODUCTION_OBSERVED') {
    return EVIDENCE_SOURCES.has(source as StrategyDashboardEvidenceSource)
      ? source as StrategyDashboardEvidenceSource
      : 'UNKNOWN';
  }
  return snapshot.truthLabel;
}

function runtimeTone(
  source: unknown,
  state: StrategyDashboardEvidenceState,
  snapshot: Readonly<SystemSupervisorSnapshot> | null,
): StrategyDashboardTone {
  if (state === 'STALE' || state === 'PARTIAL') return 'warn';
  if (state !== 'CURRENT' || !snapshot) return 'bad';
  if (source !== 'PRODUCTION_OBSERVED'
    || snapshot.truthLabel !== 'LIVE_PUBLIC') return 'warn';
  return 'ok';
}

function strategyFromSnapshot(
  strategyId: StrategyId,
  runtimeSource: unknown,
  runtimeReasons: readonly string[],
  snapshot: Readonly<SystemSupervisorSnapshot> | null,
  runtimeState: StrategyDashboardEvidenceState,
  nowMs: number,
): StrategyEngineView {
  const componentId = strategyId === 'basis' ? 'basis-engine' : 'volume-engine';
  const component = snapshot?.components.find((item) => item.componentId === componentId) ?? null;
  const sourceSummary = snapshot?.summaries.strategies[strategyId] ?? null;
  const summary = sourceSummary
    && sourceSummary.truthLabel !== 'UNKNOWN'
    && sourceSummary.truthLabel !== 'UNAVAILABLE'
    ? sourceSummary
    : null;
  const freshness = componentFreshness(component, nowMs);
  const reasons = uniqueSorted([
    ...runtimeReasons,
    ...freshness.reasons,
    ...(component?.blockerCodes ?? []),
    ...(component?.lastFailure ? [component.lastFailure.code] : []),
    ...(!summary ? ['STRATEGY_RUNTIME_SUMMARY_UNAVAILABLE'] : []),
  ]);
  const hardFailure = !component
    || runtimeState === 'UNAVAILABLE'
    || runtimeState === 'UNKNOWN'
    || component.readiness === 'FAILED'
    || component.readiness === 'BLOCKED'
    || component.blockerCodes.length > 0
    || component.lastFailure !== null
    || component.truthLabel === 'UNAVAILABLE'
    || component.truthLabel === 'UNKNOWN';
  const productionCurrent = runtimeState === 'CURRENT'
    && runtimeSource === 'PRODUCTION_OBSERVED'
    && snapshot?.truthLabel === 'LIVE_PUBLIC'
    && component?.truthLabel === 'LIVE_PUBLIC'
    && summary?.truthLabel === 'LIVE_PUBLIC'
    && component?.readiness === 'READY'
    && freshness.state === 'CURRENT';
  const tone: StrategyDashboardTone = hardFailure
    ? 'bad'
    : productionCurrent
      ? 'ok'
      : 'warn';

  return {
    strategyId,
    label: strategyId === 'basis' ? 'Basis' : 'Volume',
    readiness: component?.readiness ?? 'UNAVAILABLE',
    phase: component?.phase ?? 'Runtime Unavailable',
    truthLabel: component?.truthLabel ?? 'UNAVAILABLE',
    tone,
    freshnessLabel: freshness.label,
    heartbeatAtMs: summary?.heartbeatAtMs ?? null,
    lastDecisionAtMs: summary?.lastDecisionAtMs ?? null,
    candidateCount: summary?.candidateCount ?? null,
    proposalCount: summary?.proposalCount ?? null,
    rejectionCount: summary?.rejectionCount ?? null,
    acceptedCount: summary?.acceptedCount ?? null,
    reasonCodes: reasons,
    component,
  };
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

function overallTone(
  runtime: StrategyDashboardTone,
  pnl: StrategyDashboardTone,
): StrategyDashboardTone {
  if (runtime === 'bad' || pnl === 'bad') return 'bad';
  if (runtime === 'warn' || pnl === 'warn') return 'warn';
  return runtime === 'ok' && pnl === 'ok' ? 'ok' : 'idle';
}

export function projectStrategyDashboard(
  runtime: Readonly<SupervisorRuntimeInput>,
  pnlInput: Readonly<AccountPnlInput>,
  nowMs: number,
): StrategyDashboardView {
  const runtimeRecord: Record<string, unknown> = isRecord(runtime) ? runtime : {};
  const runtimeEvaluation = evaluateRuntimeSnapshot(runtime, nowMs);
  const runtimeState = runtimeEvaluation.state;
  const runtimeReasons = uniqueSorted([
    ...safeReasonCodes(runtimeRecord.reasonCodes),
    ...runtimeEvaluation.reasonCodes,
  ]);
  const projectedRuntimeTone = runtimeTone(
    runtimeRecord.source,
    runtimeState,
    runtimeEvaluation.snapshot,
  );
  const pnl = projectAccountPnl(pnlInput, nowMs);
  const strategies = [
    strategyFromSnapshot(
      'basis',
      runtimeRecord.source,
      runtimeReasons,
      runtimeEvaluation.snapshot,
      runtimeState,
      nowMs,
    ),
    strategyFromSnapshot(
      'volume',
      runtimeRecord.source,
      runtimeReasons,
      runtimeEvaluation.snapshot,
      runtimeState,
      nowMs,
    ),
  ] as const;
  const inputTone = overallTone(projectedRuntimeTone, pnl.tone);
  const combinedTone = strategies.reduce<StrategyDashboardTone>((tone, strategy) => {
    return overallTone(tone, strategy.tone);
  }, inputTone);
  // Strategy performance has no canonical owner in either real input. The
  // dashboard-level badge therefore cannot be green even when its two owned
  // inputs are current production observations.
  const dashboardTone: StrategyDashboardTone = combinedTone === 'ok' ? 'warn' : combinedTone;
  return {
    supervisorEvaluatedAtMs: runtimeEvaluation.snapshot?.evaluatedAtMs ?? null,
    overallLabel: combinedTone === 'ok'
      ? 'NON-GREEN · PERFORMANCE EVIDENCE UNAVAILABLE'
      : combinedTone === 'warn'
        ? 'NON-GREEN · MIXED OR INCOMPLETE EVIDENCE'
        : 'NON-GREEN · TRUTH UNAVAILABLE',
    overallTone: dashboardTone,
    runtimeLabel: runtimeLabel(runtimeRecord.source, runtimeState, runtimeEvaluation.snapshot),
    runtimeTone: projectedRuntimeTone,
    runtimeReasonCodes: runtimeReasons,
    strategies,
    pnl,
  };
}

export function moneyTone(
  value: number | null,
  evidenceToneValue: StrategyDashboardTone,
): StrategyDashboardTone {
  const cents = projectUsdToSignedCents(value);
  if (cents === null || value === 0) return 'idle';
  if ((value ?? 0) < 0) return 'bad';
  return evidenceToneValue === 'ok' ? 'ok' : 'warn';
}

export function sourceCanBeGreen(source: StrategyDashboardEvidenceSource): boolean {
  return source === 'PRODUCTION_OBSERVED';
}

export function truthCanBeGreen(truth: SystemTruthLabel): boolean {
  return truth === 'LIVE_PUBLIC';
}

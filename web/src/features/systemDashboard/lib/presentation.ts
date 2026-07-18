// systemDashboard/lib/presentation.ts — the single honest-labels authority.
// Every tone, truth badge, and unknown rendering on the dashboard routes
// through here so the DASHBOARD_TRUTH hard laws hold everywhere at once:
//   - UNKNOWN renders as the literal word UNKNOWN, never blank/green/zero.
//   - Synthetic / dry-run / replay truth is always a visible labeled badge.
//   - Silent or stale data can never map to the green tone.

import type {
  SystemComponentId,
  SystemComponentSnapshot,
  SystemControlMutation,
  SystemOverallPosture,
  SystemReadiness,
  SystemSupervisorSnapshot,
  SystemTruthLabel,
} from '../../../lib/systemIntegration';

export type Tone = 'ok' | 'warn' | 'bad' | 'idle';

export const UNKNOWN_TEXT = 'UNKNOWN';

export type ExposureVerdict = Readonly<{
  kind: 'ACTIVE' | 'NONE' | 'UNKNOWN';
  count: number | null;
  amount: string | null;
}>;

/** Exposure is tri-state. Absence is proven only by explicit zero count and amount. */
export function exposureVerdict(
  reportedCount: number | null,
  reportedAmount: string | null,
): ExposureVerdict {
  const count = Number.isInteger(reportedCount) && reportedCount !== null && reportedCount >= 0
    ? reportedCount
    : null;
  const parsedAmount = reportedAmount === null || reportedAmount.trim() === ''
    ? null
    : Number.parseFloat(reportedAmount.replaceAll(',', ''));
  const amount = parsedAmount !== null && Number.isFinite(parsedAmount) && parsedAmount >= 0
    ? reportedAmount
    : null;
  if ((count !== null && count > 0) || (parsedAmount !== null && parsedAmount > 0)) {
    return { kind: 'ACTIVE', count, amount };
  }
  if (count === 0 && parsedAmount === 0) return { kind: 'NONE', count, amount };
  return { kind: 'UNKNOWN', count, amount };
}

/** The full managed-component set the owner expects on the machine graph.
 *  A member absent from a snapshot renders as an explicit MISSING box. */
export const EXPECTED_COMPONENTS: SystemComponentId[] = [
  'public-spot-source',
  'public-usdm-source',
  'market-universe',
  'intelligence-runtime',
  'market-intelligence',
  'q-inference',
  'basis-engine',
  'volume-engine',
  'capital-supervision',
  'multileg-risk',
  'execution-coordinator-validate-only',
  'reconciliation',
  'ledger-persistence',
  'engine-supervisor',
];

export function words(value: string): string {
  return value
    .replaceAll('-', ' ')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Counts: null is UNKNOWN, never blank and never zero. */
export function countText(value: number | null): string {
  return value === null ? UNKNOWN_TEXT : value.toLocaleString('en-US');
}

/** Amount strings arrive preformatted from the supervisor; null is UNKNOWN. */
export function amountText(value: string | null): string {
  return value === null || value === '' ? UNKNOWN_TEXT : value;
}

export function textOrUnknown(value: string | null): string {
  return value === null || value === '' ? UNKNOWN_TEXT : value;
}

/** Age relative to now. null is UNKNOWN — an unknown age is never "0s". */
export function ageText(timestampMs: number | null, nowMs: number): string {
  if (timestampMs === null) return UNKNOWN_TEXT;
  const seconds = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function millisecondsText(value: number | null): string {
  if (value === null) return UNKNOWN_TEXT;
  const seconds = value / 1000;
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

// ---------------------------------------------------------------------------
// Freshness — the anti-green law.
// ---------------------------------------------------------------------------

export type FreshnessKind = 'FRESH' | 'STALE' | 'SILENT' | 'UNKNOWN';

export interface FreshnessVerdict {
  kind: FreshnessKind;
  ageMs: number | null;
}

export function freshnessOf(component: SystemComponentSnapshot): FreshnessVerdict {
  const freshness = component.freshness;
  if (!freshness) return { kind: 'UNKNOWN', ageMs: null };
  const state = freshness.state.toUpperCase();
  let kind: FreshnessKind;
  if (state.includes('SILENT')) kind = 'SILENT';
  else if (state.includes('STALE') || state.includes('EXPIRED')) kind = 'STALE';
  else if (state.includes('FRESH') || state === 'OK' || state === 'LIVE') kind = 'FRESH';
  else kind = 'UNKNOWN';
  // A reported FRESH that exceeds its own contract age is stale, whatever the
  // publisher said. The UI may format, never soften.
  if (
    kind === 'FRESH'
    && component.sourceTimestamp
    && freshness.ageMs !== null
    && freshness.ageMs > component.sourceTimestamp.maxAgeMs
  ) {
    kind = 'STALE';
  }
  return { kind, ageMs: freshness.ageMs };
}

export function freshnessText(verdict: FreshnessVerdict): string {
  if (verdict.kind === 'UNKNOWN') return UNKNOWN_TEXT;
  if (verdict.ageMs === null) return verdict.kind;
  return `${verdict.kind} · ${millisecondsText(verdict.ageMs)}`;
}

// ---------------------------------------------------------------------------
// Tones.
// ---------------------------------------------------------------------------

export function readinessTone(readiness: SystemReadiness | SystemOverallPosture): Tone {
  if (readiness === 'READY') return 'ok';
  if (readiness === 'WARMING' || readiness === 'DEGRADED') return 'warn';
  if (readiness === 'BLOCKED' || readiness === 'FAILED') return 'bad';
  return 'idle'; // STOPPED
}

/** Component tone under the honest-labels law: readiness may claim READY, but
 *  stale demotes to warn, silent demotes to bad, and an unknown freshness or
 *  truth demotes to idle. Green is only reachable by fresh, known, ready. */
export function componentTone(component: SystemComponentSnapshot): Tone {
  const base = readinessTone(component.readiness);
  if (base !== 'ok') return base;
  const fresh = freshnessOf(component);
  if (fresh.kind === 'SILENT') return 'bad';
  if (fresh.kind === 'STALE') return 'warn';
  if (fresh.kind === 'UNKNOWN') return 'idle';
  if (component.truthLabel === 'UNKNOWN' || component.truthLabel === 'UNAVAILABLE') return 'idle';
  return 'ok';
}

/** State text shown beside the component tone dot. */
export function componentStateText(component: SystemComponentSnapshot): string {
  const fresh = freshnessOf(component);
  if (component.readiness === 'READY' && fresh.kind === 'SILENT') return 'READY · SILENT';
  if (component.readiness === 'READY' && fresh.kind === 'STALE') return 'READY · STALE';
  if (component.readiness === 'READY' && fresh.kind === 'UNKNOWN') return 'READY · AGE UNKNOWN';
  return component.readiness;
}

// ---------------------------------------------------------------------------
// Truth labels — always visible, synthetic never confusable with live.
// ---------------------------------------------------------------------------

export interface TruthBadgeSpec {
  text: string;
  klass: 'live' | 'synthetic' | 'unavailable' | 'unknown';
}

export function truthBadge(label: SystemTruthLabel): TruthBadgeSpec {
  switch (label) {
    case 'LIVE_PUBLIC':
      return { text: 'LIVE PUBLIC', klass: 'live' };
    case 'DRY_RUN':
      return { text: 'DRY-RUN', klass: 'synthetic' };
    case 'SYNTHETIC_ONLY':
      return { text: 'SYNTHETIC', klass: 'synthetic' };
    case 'RECORDED_REPLAY':
      return { text: 'REPLAY', klass: 'synthetic' };
    case 'UNAVAILABLE':
      return { text: 'UNAVAILABLE', klass: 'unavailable' };
    default:
      return { text: UNKNOWN_TEXT, klass: 'unknown' };
  }
}

// ---------------------------------------------------------------------------
export function severityTone(severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'): Tone {
  if (severity === 'CRITICAL' || severity === 'HIGH') return 'bad';
  if (severity === 'MEDIUM') return 'warn';
  return 'idle';
}

// ---------------------------------------------------------------------------
// Trace chain stages — presentation grouping only, never inference.
// ---------------------------------------------------------------------------

export type TraceStage =
  | 'Evidence'
  | 'Assessment'
  | 'Decision'
  | 'Capital'
  | 'Risk'
  | 'Plan'
  | 'Reconciliation'
  | 'Ledger';

export const STAGE_ORDER: TraceStage[] = [
  'Evidence',
  'Assessment',
  'Decision',
  'Capital',
  'Risk',
  'Plan',
  'Reconciliation',
  'Ledger',
];

export function traceStage(componentId: SystemComponentId): TraceStage {
  switch (componentId) {
    case 'public-spot-source':
    case 'public-usdm-source':
    case 'market-universe':
      return 'Evidence';
    case 'intelligence-runtime':
    case 'market-intelligence':
    case 'q-inference':
      return 'Assessment';
    case 'basis-engine':
    case 'volume-engine':
      return 'Decision';
    case 'capital-supervision':
      return 'Capital';
    case 'multileg-risk':
      return 'Risk';
    case 'execution-coordinator-validate-only':
      return 'Plan';
    case 'reconciliation':
      return 'Reconciliation';
    default:
      return 'Ledger';
  }
}

// ---------------------------------------------------------------------------
// Control consequences — item 10: what would happen if I pressed it.
// Text derives only from control semantics plus current snapshot state.
// ---------------------------------------------------------------------------

export function controlConsequence(
  mutation: SystemControlMutation,
  snapshot: SystemSupervisorSnapshot,
): string {
  switch (mutation.command) {
    case 'SET_SAFE_MODE': {
      if (mutation.safeMode === snapshot.control.safeMode) return 'Already the active mode. Applying records a no-op revision.';
      if (mutation.safeMode === 'READ_ONLY') return 'Stops advisory output and validate-only planning. Evidence intake continues; nothing downstream of assessment runs.';
      if (mutation.safeMode === 'ADVISORY') return 'Engines may publish assessments and proposals. No plan is validated and no capital is reserved.';
      return 'Proposals may become validate-only plans behind the LIVE_EXECUTION_NOT_IMPLEMENTED barrier. No order can reach an exchange.';
    }
    case 'SET_KILL_SWITCH': {
      if (mutation.engaged === snapshot.control.killSwitchEngaged) return 'Kill switch is already in this position. Applying records a no-op revision.';
      return mutation.engaged
        ? 'Fails closed: new proposals, capital reservations, and validate-only plans are refused immediately. Evidence and the ledger keep running. Existing exposure is not liquidated.'
        : 'Releases the fail-closed gate. Components resume the current safe mode; nothing restarts automatically.';
    }
    case 'SET_INTAKE_PAUSED': {
      if (mutation.paused === snapshot.control.intakePaused) return 'Intake is already in this position. Applying records a no-op revision.';
      return mutation.paused
        ? 'New evidence stops entering the universe. Running assessments finish; ages on every source begin to grow honestly.'
        : 'Reopens evidence intake. Sources resume; expect a warming window before freshness recovers.';
    }
    default: {
      const component = snapshot.components.find((c) => c.componentId === mutation.componentId);
      if (!component) return 'Component is not present in the current snapshot. The supervisor will refuse this restart.';
      return `Stops and restarts ${words(component.componentId)} (generation ${component.generation} → ${component.generation + 1}). Dependents see it BLOCKED until readiness returns.`;
    }
  }
}

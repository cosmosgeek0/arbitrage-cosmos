import type { SystemSupervisorReadModel } from '../supervisor/index.js';

export const I00_HEALTH_SCHEMA = 'i00.health.v1' as const;

export type I00HealthKind = 'LIVE' | 'READY' | 'TRADE_READY';

export interface I00MeaningfulAdvanceEvidence {
  /** Stable component ID supplied by the canonical owner of the advance. */
  readonly ownerComponentId: string;
  /** Owner-observed time of the latest semantically meaningful advance. */
  readonly observedAtMs: number;
  /** Owner-supplied freshness policy; integration does not invent this value. */
  readonly maxAgeMs: number;
}

export interface I00HealthProjection {
  readonly schemaVersion: typeof I00_HEALTH_SCHEMA;
  readonly kind: I00HealthKind;
  readonly ok: boolean;
  readonly evaluatedAtMs: number;
  readonly overallPosture: SystemSupervisorReadModel['overallPosture'];
  readonly rootBlockerComponentId: string | null;
  readonly reasonCodes: readonly string[];
  readonly componentCount: number;
  readonly dependencyEdgeCount: number;
  readonly meaningfulAdvanceOwnerComponentId: string | null;
  readonly lastMeaningfulAdvanceAtMs: number | null;
  readonly meaningfulAdvanceAgeMs: number | null;
  readonly executionBarrier: 'LIVE_EXECUTION_NOT_IMPLEMENTED';
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

/**
 * Pure operational projection over the canonical supervisor. It deliberately
 * keeps process liveness, dependency readiness, and money readiness separate.
 */
export function projectI00Health(
  kind: I00HealthKind,
  supervisor: Readonly<SystemSupervisorReadModel>,
  applicationStartOk: boolean,
  meaningfulAdvance: Readonly<I00MeaningfulAdvanceEvidence> | null,
): Readonly<I00HealthProjection> {
  const reasons: string[] = [];
  const ledgerWritable = supervisor.summaries.ledger.writable;
  let meaningfulAdvanceAgeMs: number | null = null;
  let meaningfulAdvanceFresh = false;

  // Reaching this pure projection means the serving process is alive. Do not
  // turn a dependency/readiness fault into a restart loop by failing LIVE.
  let ok = true;
  if (kind === 'READY' || kind === 'TRADE_READY') {
    if (!applicationStartOk) reasons.push('APPLICATION_START_FAILED');
    if (ledgerWritable !== true) reasons.push(ledgerWritable === false ? 'LEDGER_NOT_WRITABLE' : 'LEDGER_WRITABILITY_UNKNOWN');
    if (supervisor.overallPosture !== 'READY') reasons.push(`PRODUCT_POSTURE_${supervisor.overallPosture}`);
    if (supervisor.firstRootBlockerComponentId !== null) reasons.push('ROOT_BLOCKER_PRESENT');

    if (meaningfulAdvance === null) {
      reasons.push('MEANINGFUL_ADVANCE_NOT_SUPPLIED');
    } else if (
      meaningfulAdvance.ownerComponentId.length === 0
      || !Number.isSafeInteger(meaningfulAdvance.observedAtMs)
      || meaningfulAdvance.observedAtMs <= 0
      || !Number.isSafeInteger(meaningfulAdvance.maxAgeMs)
      || meaningfulAdvance.maxAgeMs <= 0
    ) {
      reasons.push('MEANINGFUL_ADVANCE_EVIDENCE_INVALID');
    } else {
      meaningfulAdvanceAgeMs = supervisor.evaluatedAtMs - meaningfulAdvance.observedAtMs;
      if (meaningfulAdvanceAgeMs < 0) {
        reasons.push('MEANINGFUL_ADVANCE_CLOCK_SKEWED');
      } else if (meaningfulAdvanceAgeMs > meaningfulAdvance.maxAgeMs) {
        reasons.push('MEANINGFUL_ADVANCE_STALE');
      } else {
        meaningfulAdvanceFresh = true;
      }
    }

    ok = applicationStartOk
      && ledgerWritable === true
      && supervisor.overallPosture === 'READY'
      && supervisor.firstRootBlockerComponentId === null
      && meaningfulAdvanceFresh;
  }

  if (kind === 'TRADE_READY') {
    reasons.push('LIVE_EXECUTION_NOT_IMPLEMENTED');
    ok = false;
  }

  return Object.freeze({
    schemaVersion: I00_HEALTH_SCHEMA,
    kind,
    ok,
    evaluatedAtMs: supervisor.evaluatedAtMs,
    overallPosture: supervisor.overallPosture,
    rootBlockerComponentId: supervisor.firstRootBlockerComponentId,
    reasonCodes: unique(reasons),
    componentCount: supervisor.components.length,
    dependencyEdgeCount: supervisor.edges.length,
    meaningfulAdvanceOwnerComponentId: meaningfulAdvance?.ownerComponentId ?? null,
    lastMeaningfulAdvanceAtMs: meaningfulAdvance?.observedAtMs ?? null,
    meaningfulAdvanceAgeMs,
    executionBarrier: 'LIVE_EXECUTION_NOT_IMPLEMENTED',
  });
}

import type { SystemComponentId } from '../contracts/index.js';
import {
  SYSTEM_TOPOLOGY_NODES,
  type SystemSupervisorReadModel,
} from '../supervisor/index.js';

export const I00_HEALTH_SCHEMA = 'i00.health.v1' as const;

export type I00HealthKind = 'LIVE' | 'READY' | 'TRADE_READY';

export interface I00MeaningfulAdvanceEvidence {
  /** Stable component ID supplied by the canonical owner of the advance. */
  readonly ownerComponentId: SystemComponentId;
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
  // LIVE only: `ok` here is pure process-liveness truth and disagrees with
  // overallPosture by design. The label prevents the first field a consumer
  // reaches for from being read as product health, mirroring the existing
  // okSemantics: 'TRANSPORT_ONLY' (/api/system) and readinessSemantics
  // (/api/health) conventions.
  readonly okSemantics?: 'PROCESS_LIVENESS_ONLY';
}

const MEANINGFUL_ADVANCE_OWNER_ORDER = Object.freeze([
  'public-usdm-source',
  'market-universe',
] as const);

/**
 * Selects only a current canonical public-owner source timestamp already
 * present in this exact supervisor cut. It creates no timer, cache, heartbeat,
 * or inferred progress signal.
 */
export function deriveI00MeaningfulAdvanceEvidence(
  supervisor: Readonly<SystemSupervisorReadModel>,
): Readonly<I00MeaningfulAdvanceEvidence> | null {
  if (!supervisor || !Number.isSafeInteger(supervisor.evaluatedAtMs) || !Array.isArray(supervisor.components)) return null;
  for (const ownerComponentId of MEANINGFUL_ADVANCE_OWNER_ORDER) {
    const matches = supervisor.components.filter((component) => component.componentId === ownerComponentId);
    if (matches.length !== 1) continue;
    const owner = matches[0];
    const source = owner.sourceTimestamp;
    const freshness = owner.freshness;
    if (
      owner.truthLabel !== 'LIVE_PUBLIC'
      || owner.authority !== 'LIVE_PUBLIC'
      || owner.completeness !== 'COMPLETE'
      || owner.desiredState !== 'RUNNING'
      || owner.phase !== 'RUNNING'
      || owner.readiness !== 'READY'
      || source === null
      || source.authority !== 'LIVE_PUBLIC'
      || source.completeness !== 'COMPLETE'
      || !Number.isSafeInteger(source.sourceTimeMs)
      || source.sourceTimeMs <= 0
      || source.sourceTimeMs > supervisor.evaluatedAtMs
      || !Number.isSafeInteger(source.maxAgeMs)
      || source.maxAgeMs <= 0
      || freshness?.state !== 'FRESH'
      || freshness.evaluatedAt !== supervisor.evaluatedAtMs
      || freshness.ageMs !== supervisor.evaluatedAtMs - source.sourceTimeMs
    ) continue;
    return Object.freeze({
      ownerComponentId,
      observedAtMs: source.sourceTimeMs,
      maxAgeMs: source.maxAgeMs,
    });
  }
  return null;
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
  applicationStartFailureCodes: readonly string[] = Object.freeze([]),
): Readonly<I00HealthProjection> {
  const reasons: string[] = [];
  const ledgerWritable = supervisor.summaries.ledger.writable;
  const ledgerSchemaCompatibility = supervisor.summaries.ledger.schemaCompatibilityState;
  let meaningfulAdvanceAgeMs: number | null = null;
  let meaningfulAdvanceFresh = false;
  let meaningfulAdvanceOwnerCurrentAndReady = false;

  // Reaching this pure projection means the serving process is alive. Do not
  // turn a dependency/readiness fault into a restart loop by failing LIVE.
  let ok = true;
  if (kind === 'READY' || kind === 'TRADE_READY') {
    if (!applicationStartOk) {
      reasons.push(...applicationStartFailureCodes.filter(
        (code) => typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(code),
      ));
      reasons.push('APPLICATION_START_FAILED');
    }
    if (ledgerWritable !== true) reasons.push(ledgerWritable === false ? 'LEDGER_NOT_WRITABLE' : 'LEDGER_WRITABILITY_UNKNOWN');
    if (ledgerSchemaCompatibility !== 'AVAILABLE') {
      reasons.push(['UNAVAILABLE', 'MALFORMED', 'MISMATCH'].includes(String(ledgerSchemaCompatibility))
        ? `LEDGER_SCHEMA_COMPATIBILITY_${ledgerSchemaCompatibility}`
        : 'LEDGER_SCHEMA_COMPATIBILITY_UNAVAILABLE');
    }
    if (supervisor.overallPosture !== 'READY') reasons.push(`PRODUCT_POSTURE_${supervisor.overallPosture}`);
    if (supervisor.firstRootBlockerComponentId !== null) reasons.push('ROOT_BLOCKER_PRESENT');

    if (meaningfulAdvance === null) {
      reasons.push('MEANINGFUL_ADVANCE_NOT_SUPPLIED');
    } else if (
      typeof meaningfulAdvance.ownerComponentId !== 'string'
      || meaningfulAdvance.ownerComponentId.length === 0
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

      const owner = supervisor.components.find(
        (component) => component.componentId === meaningfulAdvance.ownerComponentId,
      );
      if (!owner) {
        reasons.push('MEANINGFUL_ADVANCE_OWNER_NOT_FOUND');
      } else {
        const ownerTruthAvailable = owner.truthLabel !== 'UNAVAILABLE'
          && owner.truthLabel !== 'UNKNOWN'
          && owner.authority !== 'UNAVAILABLE'
          && owner.completeness !== 'UNAVAILABLE';
        const ownerReady = owner.desiredState === 'RUNNING'
          && owner.phase === 'RUNNING'
          && owner.readiness === 'READY';
        const ownerTopology = SYSTEM_TOPOLOGY_NODES.find(
          (node) => node.componentId === owner.componentId,
        );
        const representedFreshness = owner.sourceTimestamp !== null || owner.freshness !== null;
        const ownerCurrent = !(ownerTopology?.requiresFreshSource || representedFreshness)
          || (owner.sourceTimestamp !== null
            && owner.freshness?.state === 'FRESH'
            && owner.freshness.evaluatedAt === supervisor.evaluatedAtMs);

        if (!ownerTruthAvailable) reasons.push('MEANINGFUL_ADVANCE_OWNER_UNAVAILABLE');
        if (!ownerReady) reasons.push('MEANINGFUL_ADVANCE_OWNER_NOT_READY');
        if (!ownerCurrent) reasons.push('MEANINGFUL_ADVANCE_OWNER_NOT_CURRENT');
        meaningfulAdvanceOwnerCurrentAndReady = ownerTruthAvailable && ownerReady && ownerCurrent;
      }
    }

    ok = applicationStartOk
      && ledgerWritable === true
      && ledgerSchemaCompatibility === 'AVAILABLE'
      && supervisor.overallPosture === 'READY'
      && supervisor.firstRootBlockerComponentId === null
      && meaningfulAdvanceFresh
      && meaningfulAdvanceOwnerCurrentAndReady;
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
    ...(kind === 'LIVE' ? { okSemantics: 'PROCESS_LIVENESS_ONLY' as const } : {}),
  });
}

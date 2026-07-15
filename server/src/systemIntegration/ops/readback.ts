import type { ProductIdentityReferenceRecord } from '../persistence/types.js';
import type { SystemComponentSnapshot } from '../contracts/types.js';
import type { SystemSupervisorReadModel } from '../supervisor/types.js';
import { OPS_STRONG_ACCOUNT_TRUTH_STATES } from './types.js';
import type {
  CanonicalSupervisorOpsReadPort,
  CanonicalSupervisorOpsReadback,
  CanonicalSupervisorOpsReadbackOptions,
  OpsAmbiguityState,
  OpsExposureState,
  OpsRecoveryState,
} from './types.js';

const SOURCE = 'CANONICAL_SUPERVISOR_READBACK' as const;
const DEFAULT_LEASE_MS = 10 * 60 * 1_000;
const DEFAULT_MAXIMUM_SUPERVISOR_AGE_MS = 30_000;
const IDENTITY_LIMIT = 2_000;
const UTC_MILLIS_MAX = 8_640_000_000_000_000;
const NON_NEGATIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const BLOCKING_REFERENCE_TYPES = new Set([
  'TICKET',
  'AMBIGUOUS_MUTATION',
  'POSITION',
  'LIABILITY',
  'RECOVERY_CAMPAIGN',
]);
const RESOLUTION_STATES = new Set([
  'OPEN',
  'AMBIGUOUS',
  'RECOVERY_REQUIRED',
  'UNAVAILABLE',
  'UNKNOWN',
]);
const FREEZE_PROJECTION_KEYS = Object.freeze([
  'ambiguity',
  'deploymentFrozen',
  'observedAtUtc',
  'reasons',
  'source',
  'state',
  'validUntilUtc',
] as const);
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{0,99}$/;
const STRONG_ACCOUNT_TRUTH_STATES = new Set<string>(OPS_STRONG_ACCOUNT_TRUTH_STATES);

interface IdentityTruth {
  readonly available: boolean;
  readonly references: readonly Readonly<ProductIdentityReferenceRecord>[];
}

interface ProjectedStates {
  readonly exposureState: OpsExposureState;
  readonly ambiguityState: OpsAmbiguityState;
  readonly recoveryState: OpsRecoveryState;
}

interface SchemaProjection {
  readonly currentSchemaVersion: number | null;
  readonly rollbackFloor: number | null;
}

function validUtcMillis(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= UTC_MILLIS_MAX;
}

function utcSeconds(value: number): string {
  return new Date(Math.floor(value / 1_000) * 1_000).toISOString().replace('.000Z', 'Z');
}

function exactUtcSeconds(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_SECONDS.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && utcSeconds(parsed) === value;
}

function deploymentFreezeValue(value: unknown, nowMs: number): boolean | 'UNKNOWN' {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'UNKNOWN';
  const freeze = value as Record<string, unknown>;
  const keys = Object.keys(freeze).sort();
  if (keys.length !== FREEZE_PROJECTION_KEYS.length
      || keys.some((key, index) => key !== FREEZE_PROJECTION_KEYS[index])) return 'UNKNOWN';
  if (
    freeze.source !== 'CANONICAL_DEPLOYMENT_FREEZE_MARKER_READBACK'
    || !exactUtcSeconds(freeze.observedAtUtc)
    || !exactUtcSeconds(freeze.validUntilUtc)
    || !Array.isArray(freeze.reasons)
    || freeze.reasons.length > 8
    || freeze.reasons.some((reason) => typeof reason !== 'string' || !REASON_CODE.test(reason))
    || new Set(freeze.reasons).size !== freeze.reasons.length
  ) return 'UNKNOWN';
  const observedAtMs = Date.parse(freeze.observedAtUtc);
  const validUntilMs = Date.parse(freeze.validUntilUtc);
  const leaseMs = validUntilMs - observedAtMs;
  if (
    observedAtMs > nowMs
    || nowMs - observedAtMs > DEFAULT_MAXIMUM_SUPERVISOR_AGE_MS
    || validUntilMs <= nowMs
    || leaseMs < 5 * 60 * 1_000
    || leaseMs > 60 * 60 * 1_000
  ) return 'UNKNOWN';
  if (
    freeze.state === 'FROZEN'
    && freeze.ambiguity === 'NONE'
    && freeze.deploymentFrozen === true
    && freeze.reasons.includes('DEPLOYMENT_FREEZE_MARKER_PRESENT')
  ) return true;
  if (
    freeze.state === 'NOT_FROZEN'
    && freeze.ambiguity === 'NONE'
    && freeze.deploymentFrozen === false
    && freeze.reasons.length === 0
  ) return false;
  return 'UNKNOWN';
}

function validBoundedInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function currentSupervisor(
  value: unknown,
  nowMs: number,
  maximumAgeMs: number,
): value is Readonly<SystemSupervisorReadModel> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<SystemSupervisorReadModel>;
  return candidate.schemaVersion === 1
    && validBoundedInteger(candidate.revision)
    && validUtcMillis(candidate.evaluatedAtMs)
    && candidate.evaluatedAtMs <= nowMs
    && nowMs - candidate.evaluatedAtMs <= maximumAgeMs
    && candidate.summaries !== null
    && typeof candidate.summaries === 'object'
    && !Array.isArray(candidate.summaries)
    && Array.isArray(candidate.components);
}

function component(
  supervisor: Readonly<SystemSupervisorReadModel>,
  componentId: SystemComponentSnapshot['componentId'],
): Readonly<SystemComponentSnapshot> | null {
  const matches = supervisor.components.filter((entry) => entry?.componentId === componentId);
  return matches.length === 1 ? matches[0] : null;
}

function identityRecord(value: unknown): value is Readonly<ProductIdentityReferenceRecord> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<ProductIdentityReferenceRecord>;
  if (
    !BLOCKING_REFERENCE_TYPES.has(String(row.referenceType))
    || !RESOLUTION_STATES.has(String(row.resolutionState))
  ) return false;
  for (const field of ['referenceId', 'ownerId', 'ownerRevision', 'ownerState', 'correlationId'] as const) {
    if (typeof row[field] !== 'string' || row[field]!.length < 1 || row[field]!.length > 256) return false;
  }
  if (!validUtcMillis(row.occurredAtMs) || !validBoundedInteger(row.ledgerEventId, 1)) return false;
  if (row.validUntilMs !== null && (!validUtcMillis(row.validUntilMs) || row.validUntilMs < row.occurredAtMs)) return false;
  if ((row.parentReferenceType === null) !== (row.parentReferenceId === null)) return false;
  return true;
}

function exactNonNegativeDecimal(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 80 && NON_NEGATIVE_DECIMAL.test(value)
    ? value
    : null;
}

function positiveDecimal(value: string): boolean {
  return /[1-9]/.test(value);
}

function positiveCanonicalExposure(supervisor: Readonly<SystemSupervisorReadModel>): boolean {
  const capital = supervisor.summaries.capital;
  if (capital === null || typeof capital !== 'object') return false;
  if (validBoundedInteger(capital.activeExposureCount) && capital.activeExposureCount > 0) return true;
  const amount = exactNonNegativeDecimal(capital.activeExposureAmount);
  return amount !== null && positiveDecimal(amount);
}

function strongCanonicalZeroExposure(supervisor: Readonly<SystemSupervisorReadModel>): boolean {
  const capital = supervisor.summaries.capital;
  const owner = component(supervisor, 'capital-supervision');
  if (!capital || !owner) return false;
  const amount = exactNonNegativeDecimal(capital.activeExposureAmount);
  const ownerCurrent = owner.readiness === 'READY'
    && owner.completeness === 'COMPLETE'
    && owner.freshness?.state === 'FRESH'
    && owner.sourceTimestamp !== null;
  return ownerCurrent
    && capital.truthLabel === 'RECORDED_REPLAY'
    && STRONG_ACCOUNT_TRUTH_STATES.has(capital.accountTruthState)
    && capital.activeExposureCount === 0
    && amount !== null
    && !positiveDecimal(amount);
}

function reconciliationAvailable(supervisor: Readonly<SystemSupervisorReadModel>): boolean {
  const summary = supervisor.summaries.reconciliation;
  const owner = component(supervisor, 'reconciliation');
  return Boolean(
    summary
    && owner
    && !['UNAVAILABLE', 'UNKNOWN', 'SYNTHETIC_ONLY'].includes(summary.truthLabel)
    && owner.readiness === 'READY'
    && owner.completeness === 'COMPLETE'
    && summary.status !== 'UNAVAILABLE',
  );
}

function explicitAmbiguity(supervisor: Readonly<SystemSupervisorReadModel>): boolean {
  const reconciliation = supervisor.summaries.reconciliation;
  return reconciliationAvailable(supervisor)
    && (
      reconciliation.status === 'AMBIGUOUS'
      || reconciliation.status === 'DIVERGED'
      || reconciliation.reasonCodes.some((code) => code.includes('AMBIGU'))
    );
}

function explicitRecovery(supervisor: Readonly<SystemSupervisorReadModel>): boolean {
  const execution = supervisor.summaries.execution;
  const executionRecovery = execution
    && !['UNAVAILABLE', 'UNKNOWN', 'SYNTHETIC_ONLY'].includes(execution.truthLabel)
    && typeof execution.recoveryState === 'string'
    && execution.recoveryState.length > 0;
  const reconciliation = supervisor.summaries.reconciliation;
  const reconciliationRecovery = reconciliationAvailable(supervisor)
    && reconciliation.reasonCodes.some((code) => code.includes('RECOVERY'));
  return Boolean(executionRecovery || reconciliationRecovery);
}

function states(
  supervisor: Readonly<SystemSupervisorReadModel>,
  identity: IdentityTruth,
): ProjectedStates {
  const references = identity.references;
  const identityRecovery = references.some((row) => (
    row.referenceType === 'RECOVERY_CAMPAIGN' || row.resolutionState === 'RECOVERY_REQUIRED'
  ));
  const identityAmbiguity = references.some((row) => (
    row.referenceType === 'AMBIGUOUS_MUTATION' || row.resolutionState === 'AMBIGUOUS'
  ));
  const identityExposure = references.some((row) => (
    row.referenceType === 'POSITION' || row.referenceType === 'LIABILITY'
  ));
  const unresolvedUnknown = references.some((row) => (
    row.resolutionState === 'UNAVAILABLE'
    || row.resolutionState === 'UNKNOWN'
    || row.referenceType === 'TICKET'
  ));

  const recovery = identityRecovery || explicitRecovery(supervisor);
  const ambiguity = identityAmbiguity || explicitAmbiguity(supervisor);
  const active = identityExposure || positiveCanonicalExposure(supervisor);
  const reconciliationKnown = reconciliationAvailable(supervisor);
  const unknown = !identity.available || unresolvedUnknown || !reconciliationKnown;

  const recoveryState: OpsRecoveryState = recovery
    ? 'RECOVERY_REQUIRED'
    : unknown ? 'UNKNOWN' : 'NONE';
  const ambiguityState: OpsAmbiguityState = ambiguity
    ? 'AMBIGUOUS'
    : unknown ? 'UNKNOWN' : 'NONE';
  const exposureState: OpsExposureState = recovery
    ? 'RECOVERY_REQUIRED'
    : ambiguity
      ? 'AMBIGUOUS'
      : active
        ? 'ACTIVE'
        : unknown || !strongCanonicalZeroExposure(supervisor)
          ? 'UNKNOWN'
          : 'NONE';
  return Object.freeze({ exposureState, ambiguityState, recoveryState });
}

function schema(supervisor: Readonly<SystemSupervisorReadModel>): Readonly<{
  currentSchemaVersion: number | null;
  rollbackFloor: number | null;
}> {
  const ledger = supervisor.summaries.ledger;
  if (
    ledger?.schemaCompatibilityState !== 'AVAILABLE'
    || !validBoundedInteger(ledger.currentSchemaVersion, 1)
    || !validBoundedInteger(ledger.rollbackFloor)
    || ledger.rollbackFloor > ledger.currentSchemaVersion
  ) return Object.freeze({ currentSchemaVersion: null, rollbackFloor: null });
  return Object.freeze({
    currentSchemaVersion: ledger.currentSchemaVersion,
    rollbackFloor: ledger.rollbackFloor,
  });
}

class CanonicalOpsReadbackService implements CanonicalSupervisorOpsReadPort {
  private readonly leaseMs: number;
  private readonly maximumSupervisorAgeMs: number;

  constructor(private readonly options: CanonicalSupervisorOpsReadbackOptions) {
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.maximumSupervisorAgeMs = options.maximumSupervisorAgeMs ?? DEFAULT_MAXIMUM_SUPERVISOR_AGE_MS;
  }

  async read(
    supervisorCut?: Readonly<SystemSupervisorReadModel>,
  ): Promise<Readonly<CanonicalSupervisorOpsReadback>> {
    let freezeProjection: unknown = null;
    try { freezeProjection = this.options.deploymentFreeze.read(); } catch { /* UNKNOWN */ }
    const nowMs = this.options.clock.nowMs();
    if (!validUtcMillis(nowMs) || !validUtcMillis(nowMs + this.leaseMs)) {
      throw new TypeError('canonical ops readback clock returned an invalid UTC millisecond');
    }
    const deploymentFrozen = deploymentFreezeValue(freezeProjection, nowMs);

    let supervisor: Readonly<SystemSupervisorReadModel> | null = null;
    try {
      // A caller that already owns one canonical supervisor cut may bind ops
      // truth to that exact cut. Freeze-marker and identity truth are still
      // read fresh below; an explicitly supplied malformed/stale cut fails
      // closed and never falls back to a later supervisor observation.
      const candidate = supervisorCut === undefined
        ? await this.options.readSupervisor()
        : supervisorCut;
      if (currentSupervisor(candidate, nowMs, this.maximumSupervisorAgeMs)) supervisor = candidate;
    } catch { /* fail closed below */ }

    let projected: ProjectedStates = Object.freeze({
      exposureState: 'UNKNOWN',
      ambiguityState: 'UNKNOWN',
      recoveryState: 'UNKNOWN',
    });
    let projectedSchema: Readonly<SchemaProjection> = Object.freeze({
      currentSchemaVersion: null,
      rollbackFloor: null,
    });
    if (supervisor !== null) {
      let identity: IdentityTruth = Object.freeze({ available: false, references: Object.freeze([]) });
      try {
        const references = await this.options.readBlockingIdentityReferences(IDENTITY_LIMIT);
        if (
          Array.isArray(references)
          && references.length < IDENTITY_LIMIT
          && references.every(identityRecord)
        ) {
          identity = Object.freeze({ available: true, references: Object.freeze([...references]) });
        }
      } catch { /* fail closed below */ }
      try {
        projected = states(supervisor, identity);
        projectedSchema = schema(supervisor);
      } catch {
        projected = Object.freeze({
          exposureState: 'UNKNOWN',
          ambiguityState: 'UNKNOWN',
          recoveryState: 'UNKNOWN',
        });
        projectedSchema = Object.freeze({ currentSchemaVersion: null, rollbackFloor: null });
      }
    }

    return Object.freeze({
      source: SOURCE,
      observedAtUtc: utcSeconds(nowMs),
      validUntilUtc: utcSeconds(nowMs + this.leaseMs),
      deploymentFrozen,
      exposureState: projected.exposureState,
      ambiguityState: projected.ambiguityState,
      recoveryState: projected.recoveryState,
      currentSchemaVersion: projectedSchema.currentSchemaVersion,
      rollbackFloor: projectedSchema.rollbackFloor,
    });
  }
}

export function createCanonicalSupervisorOpsReadback(
  options: CanonicalSupervisorOpsReadbackOptions,
): CanonicalSupervisorOpsReadPort {
  if (
    !options
    || typeof options.clock?.nowMs !== 'function'
    || typeof options.readSupervisor !== 'function'
    || typeof options.readBlockingIdentityReferences !== 'function'
    || typeof options.deploymentFreeze?.read !== 'function'
  ) throw new TypeError('canonical ops readback requires clock, supervisor, identity, and freeze read ports');
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const maximumSupervisorAgeMs = options.maximumSupervisorAgeMs ?? DEFAULT_MAXIMUM_SUPERVISOR_AGE_MS;
  if (!validBoundedInteger(leaseMs, 5 * 60 * 1_000) || leaseMs > 60 * 60 * 1_000) {
    throw new RangeError('canonical ops readback lease must be 5-60 minutes');
  }
  if (!validBoundedInteger(maximumSupervisorAgeMs, 1_000) || maximumSupervisorAgeMs > 5 * 60 * 1_000) {
    throw new RangeError('canonical supervisor maximum age must be 1 second to 5 minutes');
  }
  return Object.freeze(new CanonicalOpsReadbackService(options));
}

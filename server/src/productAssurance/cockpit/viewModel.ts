import {
  SYSTEM_RELEASE_STATUSES,
  SYSTEM_TRUTH_LABELS,
  type SystemReleaseStatus,
  type SystemTruthLabel,
} from '../../systemIntegration/contracts/constants.js';
import {
  ASSURANCE_VERDICTS,
  assertDigestOrNull,
  assertIdentifier,
  assertUtcMs,
  isPlainRecord,
  sortedUnique,
  type AssuranceVerdict,
} from '../common.js';
import type { ActionSafetyEvidenceResult } from '../actionEvidence/evaluator.js';
import type { AssuranceClaimGraphProjection } from '../assuranceCase/claimGraph.js';
import type { DiagnosticBoundaryDecision } from '../diagnostics/boundary.js';
import type { InvariantCatalogProjection } from '../invariants/evaluator.js';
import type { InventoryCoverageProjection } from '../inventory/coverage.js';
import type { OperationCoverageReport } from '../operations/policy.js';
import type {
  ExecutionLeaseProjection,
  RateBudgetProjection,
  SentinelProjection,
  TelemetryPipelineProjection,
  TemporalCoherenceProjection,
} from '../projections/operationalTruth.js';
import type { RemediationCampaign } from '../remediation/campaign.js';

/**
 * The cockpit is a render-only boundary. These sections deliberately mirror
 * canonical projections instead of deriving new owner, readiness, risk, or
 * execution state.
 */
export const ASSURANCE_COCKPIT_SECTION_IDS = Object.freeze([
  'INVARIANTS',
  'INVENTORY_COVERAGE',
  'OPERATION_STABILITY',
  'RATE_BUDGET',
  'TEMPORAL_COHERENCE',
  'EXECUTION_LEASE',
  'MUTATION_LIFECYCLE',
  'TELEMETRY_INDEPENDENT_PROOF',
  'WATCHDOG_NOTIFICATION',
  'INCIDENT_CORRELATION',
  'AUTONOMIC_DIAGNOSTICS',
] as const);
export type AssuranceCockpitSectionId = (typeof ASSURANCE_COCKPIT_SECTION_IDS)[number];

export type AssuranceCockpitWiringState = SystemReleaseStatus | 'UNKNOWN';

export const ASSURANCE_COCKPIT_OPERATOR_STATES = Object.freeze([
  'PASS',
  'FAIL',
  'UNKNOWN',
  'CURRENT',
  'STALE',
  'SILENT',
  'UNAVAILABLE',
  'MISSING',
  'NOT_CONFIGURED',
  'SYNTHETIC_ONLY',
  'DRY_RUN',
  'RECORDED_REPLAY',
  'BLOCKED',
] as const);
export type AssuranceCockpitOperatorState = (typeof ASSURANCE_COCKPIT_OPERATOR_STATES)[number];

export interface WatchdogCockpitProjection {
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
}

export interface OperationStabilityCockpitProjection {
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly operationCoverage: Readonly<OperationCoverageReport>;
  readonly campaigns: readonly Readonly<RemediationCampaign>[];
}

export interface MutationLifecycleCockpitRecord {
  readonly lifecycleId: string;
  readonly operationId: string;
  readonly actionId: string;
  readonly submissionState: 'NOT_SENT' | 'ACCEPTED' | 'UNKNOWN_SUBMISSION';
  readonly reconciliationState: 'NOT_REQUIRED' | 'PENDING' | 'PROVED_ABSENT' | 'PROVED_PRESENT' | 'UNKNOWN';
  readonly ambiguityState: 'NONE' | 'UNRESOLVED' | 'RESOLVED_ABSENT' | 'RESOLVED_PRESENT';
  readonly observedAtMs: number;
  readonly evidenceIds: readonly string[];
}

export interface MutationLifecycleCockpitProjection {
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly records: readonly Readonly<MutationLifecycleCockpitRecord>[];
}

export interface TelemetryIndependentProofCockpitProjection {
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly telemetry: Readonly<TelemetryPipelineProjection>;
  readonly independentSentinel: Readonly<SentinelProjection>;
}

export interface IncidentCorrelationCockpitProjection {
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly incidentIds: readonly string[];
  readonly causeIds: readonly string[];
  readonly effectIds: readonly string[];
  readonly correlationTraceIds: readonly string[];
  readonly claimGraph: Readonly<AssuranceClaimGraphProjection>;
}

export interface AutonomicDiagnosticsCockpitProjection {
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly campaigns: readonly Readonly<RemediationCampaign>[];
  readonly actionEvidence: readonly Readonly<ActionSafetyEvidenceResult>[];
  readonly claimGraph: Readonly<AssuranceClaimGraphProjection>;
  readonly diagnosticDecision: Readonly<DiagnosticBoundaryDecision>;
  readonly diagnosticTraceIds: readonly string[];
  readonly permissionLevel: string | null;
  readonly tokenBudget: number | null;
  readonly costBudgetMicrounits: number | null;
  readonly latencyBudgetMs: number | null;
  readonly approvalIds: readonly string[];
  readonly verifierIds: readonly string[];
  readonly postconditionIds: readonly string[];
  readonly providerState: 'READY' | 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'BUDGET_EXHAUSTED';
}

export interface CanonicalCockpitSection<
  TSectionId extends AssuranceCockpitSectionId,
  TProjection,
> {
  readonly sectionId: TSectionId;
  readonly ownerId: string;
  readonly sourceId: string;
  readonly sourceRevision: string | null;
  readonly observedAtMs: number | null;
  readonly maximumAgeMs: number;
  readonly sourceDigest: string | null;
  readonly producerId: string | null;
  readonly verifierId: string | null;
  readonly producerCommonModeGroupId: string | null;
  readonly verifierCommonModeGroupId: string | null;
  readonly wiringState: AssuranceCockpitWiringState;
  readonly truthLabel: SystemTruthLabel;
  /** Supplied by the canonical owner; the cockpit never recalculates it. */
  readonly canonicalVerdict: AssuranceVerdict;
  /** Explicit operator label, kept separate from canonical verdict and wiring. */
  readonly operatorState: AssuranceCockpitOperatorState;
  readonly reasonCodes: readonly string[];
  readonly projection: TProjection | null;
}

export type AssuranceCockpitSection =
  | CanonicalCockpitSection<'INVARIANTS', Readonly<InvariantCatalogProjection>>
  | CanonicalCockpitSection<'INVENTORY_COVERAGE', Readonly<InventoryCoverageProjection>>
  | CanonicalCockpitSection<'OPERATION_STABILITY', Readonly<OperationStabilityCockpitProjection>>
  | CanonicalCockpitSection<'RATE_BUDGET', Readonly<RateBudgetProjection>>
  | CanonicalCockpitSection<'TEMPORAL_COHERENCE', Readonly<TemporalCoherenceProjection>>
  | CanonicalCockpitSection<'EXECUTION_LEASE', Readonly<ExecutionLeaseProjection>>
  | CanonicalCockpitSection<'MUTATION_LIFECYCLE', Readonly<MutationLifecycleCockpitProjection>>
  | CanonicalCockpitSection<'TELEMETRY_INDEPENDENT_PROOF', Readonly<TelemetryIndependentProofCockpitProjection>>
  | CanonicalCockpitSection<'WATCHDOG_NOTIFICATION', Readonly<WatchdogCockpitProjection>>
  | CanonicalCockpitSection<'INCIDENT_CORRELATION', Readonly<IncidentCorrelationCockpitProjection>>
  | CanonicalCockpitSection<'AUTONOMIC_DIAGNOSTICS', Readonly<AutonomicDiagnosticsCockpitProjection>>;

export interface AssuranceCockpitViewModel {
  readonly schema: 'PRODUCT_ASSURANCE_COCKPIT_VIEW_V1';
  readonly generatedAtMs: number;
  readonly sections: readonly Readonly<AssuranceCockpitSection>[];
  readonly productReadinessComputed: false;
  readonly authorityGranted: false;
  readonly executionAuthorityGranted: false;
  readonly moneyAuthorityGranted: false;
}

const SPECIAL_WIRING_STATES = new Set<AssuranceCockpitWiringState>([
  'UNKNOWN',
  'MISSING',
  'NOT_CONFIGURED',
  'SYNTHETIC_ONLY',
  'BLOCKED',
]);

function assertVerdict(value: unknown, label: string): asserts value is AssuranceVerdict {
  if (!(ASSURANCE_VERDICTS as readonly unknown[]).includes(value)) {
    throw new TypeError(`${label} is unsupported`);
  }
}

function assertReasonCodes(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  for (const [index, reasonCode] of value.entries()) {
    assertIdentifier(reasonCode, `${label}[${index}]`);
  }
}

function verdictField(
  projection: unknown,
  field: string,
  label: string,
): AssuranceVerdict {
  if (!isPlainRecord(projection)) throw new TypeError(`${label} projection must be a plain object`);
  const verdict = projection[field];
  assertVerdict(verdict, `${label}.${field}`);
  return verdict;
}

/**
 * Reads the verdict from the canonical projection carried by each section.
 * Lists are reduced only from their owners' per-record verdict/state; the
 * cockpit never re-evaluates domain facts.
 */
function authoritativeProjectionVerdict(
  section: Readonly<AssuranceCockpitSection>,
): AssuranceVerdict {
  const projection = section.projection;
  if (projection === null) return 'UNKNOWN';
  switch (section.sectionId) {
    case 'INVARIANTS':
      return verdictField(projection, 'tradeReadinessVerdict', section.sectionId);
    case 'INVENTORY_COVERAGE':
      return verdictField(projection, 'overallVerdict', section.sectionId);
    case 'OPERATION_STABILITY':
    case 'RATE_BUDGET':
    case 'TEMPORAL_COHERENCE':
    case 'EXECUTION_LEASE':
    case 'MUTATION_LIFECYCLE':
    case 'TELEMETRY_INDEPENDENT_PROOF':
    case 'WATCHDOG_NOTIFICATION':
    case 'INCIDENT_CORRELATION':
    case 'AUTONOMIC_DIAGNOSTICS':
      return verdictField(projection, 'verdict', section.sectionId);
  }
}

const REQUIRED_PROJECTION_FIELDS: Readonly<Record<AssuranceCockpitSectionId, readonly string[]>> = Object.freeze({
  INVARIANTS: Object.freeze(['evaluatedAtMs', 'results', 'counts', 'blockingInvariantIds', 'unknownCriticalInvariantIds']),
  INVENTORY_COVERAGE: Object.freeze(['evaluatedAtMs', 'expectedCounts', 'componentStates', 'dependencyStates', 'controlStates', 'telemetryStates', 'counts', 'reasonCodes']),
  OPERATION_STABILITY: Object.freeze(['reasonCodes', 'operationCoverage', 'campaigns']),
  RATE_BUDGET: Object.freeze(['optionalWorkAllowed', 'reconciliationAllowed', 'riskReducingWorkAllowed', 'availableUnits', 'reservedUnits', 'reasonCodes']),
  TEMPORAL_COHERENCE: Object.freeze(['crossMarketSkewMs', 'stagesOrdered', 'continuityProven', 'reasonCodes']),
  EXECUTION_LEASE: Object.freeze(['active', 'ownerId', 'epoch', 'processIdentity', 'releaseIdentity', 'renewedAtMs', 'expiresAtMs', 'evaluatedAtMs', 'reasonCodes']),
  MUTATION_LIFECYCLE: Object.freeze(['reasonCodes', 'records']),
  TELEMETRY_INDEPENDENT_PROOF: Object.freeze(['reasonCodes', 'telemetry', 'independentSentinel']),
  WATCHDOG_NOTIFICATION: Object.freeze(['reasonCodes']),
  INCIDENT_CORRELATION: Object.freeze(['reasonCodes', 'incidentIds', 'causeIds', 'effectIds', 'correlationTraceIds', 'claimGraph']),
  AUTONOMIC_DIAGNOSTICS: Object.freeze(['reasonCodes', 'campaigns', 'actionEvidence', 'claimGraph', 'diagnosticDecision', 'diagnosticTraceIds', 'permissionLevel', 'tokenBudget', 'costBudgetMicrounits', 'latencyBudgetMs', 'approvalIds', 'verifierIds', 'postconditionIds', 'providerState']),
});

function validateProjectionShape(section: Readonly<AssuranceCockpitSection>): void {
  if (section.projection === null) return;
  if (!isPlainRecord(section.projection)) throw new TypeError(`${section.sectionId} projection must be a plain object`);
  for (const field of REQUIRED_PROJECTION_FIELDS[section.sectionId]) {
    if (!Object.hasOwn(section.projection, field)) throw new TypeError(`${section.sectionId} projection missing ${field}`);
  }
}

function requiredOperatorState(
  section: Readonly<AssuranceCockpitSection>,
  generatedAtMs: number,
): AssuranceCockpitOperatorState | null {
  if (SPECIAL_WIRING_STATES.has(section.wiringState)) {
    return section.wiringState as AssuranceCockpitOperatorState;
  }
  if (section.truthLabel === 'SYNTHETIC_ONLY') return 'SYNTHETIC_ONLY';
  if (section.truthLabel === 'DRY_RUN') return 'DRY_RUN';
  if (section.truthLabel === 'RECORDED_REPLAY') return 'RECORDED_REPLAY';
  if (section.truthLabel === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (section.truthLabel === 'UNKNOWN') return 'UNKNOWN';
  if (section.observedAtMs !== null && generatedAtMs - section.observedAtMs >= section.maximumAgeMs) return 'STALE';
  if (section.wiringState !== 'LIVE_PUBLIC') return 'UNKNOWN';
  if (section.canonicalVerdict === 'UNKNOWN') return 'UNKNOWN';
  if (section.canonicalVerdict === 'FAIL') return 'FAIL';
  return 'PASS';
}

function validateSection(
  section: Readonly<AssuranceCockpitSection>,
  generatedAtMs: number,
): void {
  if (!isPlainRecord(section)) throw new TypeError('cockpit section must be a plain object');
  if (!(ASSURANCE_COCKPIT_SECTION_IDS as readonly unknown[]).includes(section.sectionId)) {
    throw new TypeError('cockpit sectionId is unsupported');
  }
  assertIdentifier(section.ownerId, `${section.sectionId}.ownerId`);
  assertIdentifier(section.sourceId, `${section.sectionId}.sourceId`);
  if (
    !(
      (SYSTEM_RELEASE_STATUSES as readonly unknown[]).includes(section.wiringState)
      || section.wiringState === 'UNKNOWN'
    )
  ) {
    throw new TypeError(`${section.sectionId}.wiringState is unsupported`);
  }
  if (!(SYSTEM_TRUTH_LABELS as readonly unknown[]).includes(section.truthLabel)) {
    throw new TypeError(`${section.sectionId}.truthLabel is unsupported`);
  }
  assertVerdict(section.canonicalVerdict, `${section.sectionId}.canonicalVerdict`);
  assertReasonCodes(section.reasonCodes, `${section.sectionId}.reasonCodes`);
  if (section.sourceRevision !== null) {
    assertIdentifier(section.sourceRevision, `${section.sectionId}.sourceRevision`);
  }
  if (!Number.isSafeInteger(section.maximumAgeMs) || section.maximumAgeMs <= 0) throw new TypeError(`${section.sectionId}.maximumAgeMs must be a positive safe integer`);
  assertDigestOrNull(section.sourceDigest, `${section.sectionId}.sourceDigest`);
  for (const [label, value] of [
    ['producerId', section.producerId], ['verifierId', section.verifierId],
    ['producerCommonModeGroupId', section.producerCommonModeGroupId],
    ['verifierCommonModeGroupId', section.verifierCommonModeGroupId],
  ] as const) if (value !== null) assertIdentifier(value, `${section.sectionId}.${label}`);
  if (section.observedAtMs !== null) {
    assertUtcMs(section.observedAtMs, `${section.sectionId}.observedAtMs`);
    if (section.observedAtMs > generatedAtMs) {
      throw new TypeError(`${section.sectionId}.observedAtMs cannot follow generatedAtMs`);
    }
  }
  if (!(ASSURANCE_COCKPIT_OPERATOR_STATES as readonly string[]).includes(section.operatorState)) {
    throw new TypeError(`${section.sectionId}.operatorState is unsupported`);
  }

  const hasProjection = section.projection !== null;
  const hasCompleteSource = section.sourceRevision !== null && section.observedAtMs !== null;
  if (hasProjection !== hasCompleteSource) {
    throw new TypeError(
      `${section.sectionId} projection requires sourceRevision and observedAtMs together`,
    );
  }
  const hasCompleteProof = section.sourceDigest !== null
    && section.producerId !== null
    && section.verifierId !== null
    && section.producerCommonModeGroupId !== null
    && section.verifierCommonModeGroupId !== null;
  if (hasProjection !== hasCompleteProof) throw new TypeError(`${section.sectionId} projection requires digest and independent producer/verifier proof`);
  if (hasProjection && section.producerId === section.verifierId) throw new TypeError(`${section.sectionId} verifier must be independent`);
  if (hasProjection && section.producerCommonModeGroupId === section.verifierCommonModeGroupId) throw new TypeError(`${section.sectionId} verifier common mode must differ`);
  validateProjectionShape(section);
  const authoritativeVerdict = authoritativeProjectionVerdict(section);
  if (section.canonicalVerdict !== authoritativeVerdict) {
    throw new TypeError(
      `${section.sectionId}.canonicalVerdict must equal projection verdict ${authoritativeVerdict}`,
    );
  }

  const required = requiredOperatorState(section, generatedAtMs);
  if (required !== null && section.operatorState !== required) {
    throw new TypeError(
      `${section.sectionId}.operatorState must preserve ${required} source/wiring truth`,
    );
  }
  if (
    section.projection === null
    && !['UNKNOWN', 'UNAVAILABLE', 'MISSING', 'NOT_CONFIGURED', 'BLOCKED'].includes(section.operatorState)
  ) {
    throw new TypeError(`${section.sectionId} cannot present missing projection data as ${section.operatorState}`);
  }
}

/**
 * Produces a stable, canonically ordered view without aggregating a product
 * readiness verdict. Unknown and non-live labels are rejected if callers try
 * to mask them with a green operator state.
 */
export function buildAssuranceCockpitViewModel(
  sections: readonly Readonly<AssuranceCockpitSection>[],
  generatedAtMs: number,
): Readonly<AssuranceCockpitViewModel> {
  assertUtcMs(generatedAtMs, 'generatedAtMs');
  if (!Array.isArray(sections)) throw new TypeError('cockpit sections must be an array');
  const ids = sections.map((section) => section.sectionId);
  if (new Set(ids).size !== ids.length) throw new TypeError('cockpit contains duplicate section IDs');
  const missing = ASSURANCE_COCKPIT_SECTION_IDS.filter((sectionId) => !ids.includes(sectionId));
  const unexpected = ids.filter(
    (sectionId) => !(ASSURANCE_COCKPIT_SECTION_IDS as readonly string[]).includes(sectionId),
  );
  if (missing.length > 0 || unexpected.length > 0) {
    throw new TypeError(
      `cockpit section set mismatch: missing=${sortedUnique(missing).join(',') || 'NONE'} unexpected=${sortedUnique(unexpected).join(',') || 'NONE'}`,
    );
  }

  for (const section of sections) validateSection(section, generatedAtMs);
  const rank = new Map(ASSURANCE_COCKPIT_SECTION_IDS.map((sectionId, index) => [sectionId, index]));
  const ordered = sections
    .map((section) => Object.freeze({ ...section, reasonCodes: sortedUnique(section.reasonCodes) }))
    .sort((left, right) => (rank.get(left.sectionId) ?? 0) - (rank.get(right.sectionId) ?? 0));

  return Object.freeze({
    schema: 'PRODUCT_ASSURANCE_COCKPIT_VIEW_V1',
    generatedAtMs,
    sections: Object.freeze(ordered),
    productReadinessComputed: false,
    authorityGranted: false,
    executionAuthorityGranted: false,
    moneyAuthorityGranted: false,
  });
}

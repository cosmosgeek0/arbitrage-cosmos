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
import {
  OWNER_CONTRACT_WAITING_SEAMS,
  computeOwnerContractTupleDigest,
  consumeOwnerContract,
  digestOwnerContractPayload,
  type OwnerContractConsumption,
  type OwnerContractEnvelope,
  type OwnerContractExpectation,
  type OwnerContractSurface,
} from '../adapters/ownerContracts.js';
import type { DiagnosticBoundaryDecision } from '../diagnostics/boundary.js';
import type { InvariantCatalogProjection } from '../invariants/evaluator.js';
import type { OperationCoverageReport } from '../operations/policy.js';
import type {
  ExecutionLeaseProjection,
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
  readonly assuranceCase: Readonly<OpaqueOwnerProjection>;
}

export interface OpaqueOwnerTruthPayload extends Readonly<Record<string, unknown>> {
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
}

export type OpaqueOwnerProjection = OwnerContractConsumption<Readonly<OpaqueOwnerTruthPayload>>;

export const COCKPIT_OWNER_CONTRACT_SLOTS = Object.freeze([
  'INVENTORY_COVERAGE',
  'RATE_BUDGET',
  'INCIDENT_CORRELATION_ASSURANCE_CASE',
  'AUTONOMIC_DIAGNOSTICS_ACTION_EVIDENCE',
  'AUTONOMIC_DIAGNOSTICS_ASSURANCE_CASE',
  'AUTONOMIC_DIAGNOSTICS_GOVERNANCE',
] as const);
export type CockpitOwnerContractSlot = (typeof COCKPIT_OWNER_CONTRACT_SLOTS)[number];
export type TrustedCockpitOwnerExpectations = Readonly<Record<
  CockpitOwnerContractSlot,
  Readonly<OwnerContractExpectation>
>>;

export interface AutonomicDiagnosticsCockpitProjection {
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly campaigns: readonly Readonly<RemediationCampaign>[];
  readonly actionEvidence: Readonly<OpaqueOwnerProjection>;
  readonly assuranceCase: Readonly<OpaqueOwnerProjection>;
  readonly governance: Readonly<OpaqueOwnerProjection>;
  readonly diagnosticBoundary: Readonly<DiagnosticBoundaryDecision>;
  readonly diagnosticTraceIds: readonly string[];
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
  | CanonicalCockpitSection<'INVENTORY_COVERAGE', Readonly<OpaqueOwnerProjection>>
  | CanonicalCockpitSection<'OPERATION_STABILITY', Readonly<OperationStabilityCockpitProjection>>
  | CanonicalCockpitSection<'RATE_BUDGET', Readonly<OpaqueOwnerProjection>>
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

const DIRECT_OWNER_SECTION_SURFACES = Object.freeze({
  INVENTORY_COVERAGE: 'COVERAGE',
  RATE_BUDGET: 'RATE_BUDGET',
} as const);

const COCKPIT_OWNER_SLOT_SURFACES: Readonly<Record<CockpitOwnerContractSlot, OwnerContractSurface>> = Object.freeze({
  INVENTORY_COVERAGE: 'COVERAGE',
  RATE_BUDGET: 'RATE_BUDGET',
  INCIDENT_CORRELATION_ASSURANCE_CASE: 'ASSURANCE_CASE',
  AUTONOMIC_DIAGNOSTICS_ACTION_EVIDENCE: 'ACTION_EVIDENCE',
  AUTONOMIC_DIAGNOSTICS_ASSURANCE_CASE: 'ASSURANCE_CASE',
  AUTONOMIC_DIAGNOSTICS_GOVERNANCE: 'DIAGNOSTIC_GOVERNANCE',
});

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

function validateTrustedOwnerExpectations(
  expectations: Readonly<TrustedCockpitOwnerExpectations>,
): void {
  if (!isPlainRecord(expectations)) throw new TypeError('trustedOwnerExpectations must be a plain object');
  if (Object.keys(expectations).sort().join('\n') !== [...COCKPIT_OWNER_CONTRACT_SLOTS].sort().join('\n')) {
    throw new TypeError('trustedOwnerExpectations must bind every cockpit owner slot exactly once');
  }
  for (const slot of COCKPIT_OWNER_CONTRACT_SLOTS) {
    const expectation = expectations[slot];
    const expectedSurface = COCKPIT_OWNER_SLOT_SURFACES[slot];
    if (!isPlainRecord(expectation)) throw new TypeError(`${slot} trusted expectation must be a plain object`);
    if (expectation.surface !== expectedSurface) {
      throw new TypeError(`${slot} trusted expectation must bind ${expectedSurface}`);
    }
    if (expectation.ownerId !== OWNER_CONTRACT_WAITING_SEAMS[expectedSurface].ownerId) {
      throw new TypeError(`${slot} trusted expectation owner is not canonical`);
    }
    const probe = consumeOwnerContract(null, expectation);
    if (probe.state !== 'WAITING') throw new TypeError(`${slot} trusted expectation is invalid`);
  }
}

function reconsumeOwnerProjection(
  projection: Readonly<OpaqueOwnerProjection>,
  expectation: Readonly<OwnerContractExpectation>,
  expectedSurface: OwnerContractSurface,
  label: string,
): Readonly<OpaqueOwnerProjection> {
  if (!isPlainRecord(projection)) throw new TypeError(`${label} owner projection must be a plain object`);
  if (expectation.surface !== expectedSurface) throw new TypeError(`${label} trusted surface mismatch`);
  const envelope = projection.envelope === null ? null : projection.envelope;
  return consumeOwnerContract(envelope, expectation) as Readonly<OpaqueOwnerProjection>;
}

function normalizeOwnerAdapters(
  section: Readonly<AssuranceCockpitSection>,
  expectations: Readonly<TrustedCockpitOwnerExpectations>,
): Readonly<AssuranceCockpitSection> {
  if (section.projection === null) return section;
  if (section.sectionId === 'INVENTORY_COVERAGE') {
    return Object.freeze({
      ...section,
      projection: reconsumeOwnerProjection(
        section.projection,
        expectations.INVENTORY_COVERAGE,
        'COVERAGE',
        section.sectionId,
      ),
    });
  }
  if (section.sectionId === 'RATE_BUDGET') {
    return Object.freeze({
      ...section,
      projection: reconsumeOwnerProjection(
        section.projection,
        expectations.RATE_BUDGET,
        'RATE_BUDGET',
        section.sectionId,
      ),
    });
  }
  if (section.sectionId === 'INCIDENT_CORRELATION') {
    const projection = section.projection;
    return Object.freeze({
      ...section,
      projection: Object.freeze({
        ...projection,
        assuranceCase: reconsumeOwnerProjection(
          projection.assuranceCase,
          expectations.INCIDENT_CORRELATION_ASSURANCE_CASE,
          'ASSURANCE_CASE',
          `${section.sectionId}.assuranceCase`,
        ),
      }),
    });
  }
  if (section.sectionId === 'AUTONOMIC_DIAGNOSTICS') {
    const projection = section.projection;
    return Object.freeze({
      ...section,
      projection: Object.freeze({
        ...projection,
        actionEvidence: reconsumeOwnerProjection(
          projection.actionEvidence,
          expectations.AUTONOMIC_DIAGNOSTICS_ACTION_EVIDENCE,
          'ACTION_EVIDENCE',
          `${section.sectionId}.actionEvidence`,
        ),
        assuranceCase: reconsumeOwnerProjection(
          projection.assuranceCase,
          expectations.AUTONOMIC_DIAGNOSTICS_ASSURANCE_CASE,
          'ASSURANCE_CASE',
          `${section.sectionId}.assuranceCase`,
        ),
        governance: reconsumeOwnerProjection(
          projection.governance,
          expectations.AUTONOMIC_DIAGNOSTICS_GOVERNANCE,
          'DIAGNOSTIC_GOVERNANCE',
          `${section.sectionId}.governance`,
        ),
      }),
    });
  }
  return section;
}

function immutableSnapshot(value: unknown, label: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new TypeError(`${label} must be a dense array`);
    return Object.freeze(value.map((entry, index) => immutableSnapshot(entry, `${label}[${index}]`)));
  }
  if (!isPlainRecord(value)) throw new TypeError(`${label} must contain only plain JSON values`);
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    Object.defineProperty(output, key, {
      value: immutableSnapshot(value[key], `${label}.${key}`),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(output);
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

function opaqueOwnerVerdict(
  projection: unknown,
  expectedSurface: OwnerContractSurface,
  label: string,
): AssuranceVerdict {
  if (!isPlainRecord(projection)) throw new TypeError(`${label} owner projection must be a plain object`);
  if (projection.surface !== expectedSurface) {
    throw new TypeError(`${label} owner projection must consume ${expectedSurface}`);
  }
  const canonicalOwnerId = OWNER_CONTRACT_WAITING_SEAMS[expectedSurface].ownerId;
  if (projection.ownerId !== canonicalOwnerId) {
    throw new TypeError(`${label} owner projection must consume canonical owner ${canonicalOwnerId}`);
  }
  if (projection.authorityGranted !== false) {
    throw new TypeError(`${label} owner projection cannot grant authority`);
  }
  assertReasonCodes(projection.reasonCodes, `${label}.reasonCodes`);
  if (!['WAITING', 'REJECTED', 'CONSUMED'].includes(String(projection.state))) {
    throw new TypeError(`${label} owner projection state is unsupported`);
  }
  assertVerdict(projection.verdict, `${label}.contractVerdict`);
  if (projection.state === 'WAITING') {
    if (projection.verdict !== 'UNKNOWN' || projection.payload !== null
      || projection.tupleDigest !== null || projection.envelope !== null) {
      throw new TypeError(`${label} WAITING owner projection must remain UNKNOWN without payload`);
    }
    return 'UNKNOWN';
  }
  if (projection.state === 'REJECTED') {
    if (projection.verdict !== 'FAIL' || projection.payload !== null
      || projection.tupleDigest !== null || projection.envelope !== null) {
      throw new TypeError(`${label} REJECTED owner projection must remain FAIL without payload`);
    }
    return 'FAIL';
  }
  if (projection.verdict !== 'PASS' || !isPlainRecord(projection.payload)
    || !isPlainRecord(projection.envelope)) {
    throw new TypeError(`${label} CONSUMED owner projection requires an integrity PASS and owner payload`);
  }
  const verifiedEnvelope = projection.envelope as unknown as Readonly<OwnerContractEnvelope<OpaqueOwnerTruthPayload>>;
  assertIdentifier(projection.releaseId, `${label}.releaseId`);
  assertIdentifier(projection.subjectId, `${label}.subjectId`);
  assertDigestOrNull(projection.digest, `${label}.digest`);
  assertDigestOrNull(projection.tupleDigest, `${label}.tupleDigest`);
  if (projection.digest === null || projection.tupleDigest === null) {
    throw new TypeError(`${label} CONSUMED owner projection requires digest and tuple digest`);
  }
  if (digestOwnerContractPayload(projection.payload) !== projection.digest) {
    throw new TypeError(`${label} owner payload digest mismatch`);
  }
  const expectedTupleDigest = computeOwnerContractTupleDigest({
    schema: 'PRODUCT_ASSURANCE_OWNER_CONTRACT_TUPLE_V1',
    surface: expectedSurface,
    ownerId: canonicalOwnerId,
    releaseId: projection.releaseId,
    subjectId: projection.subjectId,
    digestAlgorithm: 'sha256',
    digest: projection.digest,
  });
  if (projection.tupleDigest !== expectedTupleDigest) {
    throw new TypeError(`${label} owner tuple digest mismatch`);
  }
  if (verifiedEnvelope.tupleDigest !== projection.tupleDigest
    || verifiedEnvelope.tuple.surface !== expectedSurface
    || verifiedEnvelope.tuple.ownerId !== canonicalOwnerId
    || verifiedEnvelope.tuple.releaseId !== projection.releaseId
    || verifiedEnvelope.tuple.subjectId !== projection.subjectId
    || verifiedEnvelope.tuple.digest !== projection.digest) {
    throw new TypeError(`${label} verified envelope metadata mismatch`);
  }
  const ownerVerdict = projection.payload.verdict;
  assertVerdict(ownerVerdict, `${label}.payload.verdict`);
  assertReasonCodes(projection.payload.reasonCodes, `${label}.payload.reasonCodes`);
  if (ownerVerdict === 'PASS' && projection.payload.reasonCodes.length > 0) {
    throw new TypeError(`${label} passing owner payload cannot carry reason codes`);
  }
  if (ownerVerdict !== 'PASS' && projection.payload.reasonCodes.length === 0) {
    throw new TypeError(`${label} non-passing owner payload requires reason codes`);
  }
  return ownerVerdict;
}

function assertParentPreservesOwnerTruth(
  parentVerdict: AssuranceVerdict,
  ownerVerdicts: readonly AssuranceVerdict[],
  label: string,
): void {
  if (ownerVerdicts.includes('FAIL') && parentVerdict !== 'FAIL') {
    throw new TypeError(`${label} cannot mask a failing owner projection`);
  }
  if (!ownerVerdicts.includes('FAIL') && ownerVerdicts.includes('UNKNOWN') && parentVerdict === 'PASS') {
    throw new TypeError(`${label} cannot mask an unknown owner projection`);
  }
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
      return opaqueOwnerVerdict(projection, 'COVERAGE', section.sectionId);
    case 'RATE_BUDGET':
      return opaqueOwnerVerdict(projection, 'RATE_BUDGET', section.sectionId);
    case 'OPERATION_STABILITY':
    case 'TEMPORAL_COHERENCE':
    case 'EXECUTION_LEASE':
    case 'MUTATION_LIFECYCLE':
    case 'TELEMETRY_INDEPENDENT_PROOF':
    case 'WATCHDOG_NOTIFICATION':
      return verdictField(projection, 'verdict', section.sectionId);
    case 'INCIDENT_CORRELATION': {
      const incident = projection as Readonly<IncidentCorrelationCockpitProjection>;
      const parent = verdictField(incident, 'verdict', section.sectionId);
      const owner = opaqueOwnerVerdict(incident.assuranceCase, 'ASSURANCE_CASE', `${section.sectionId}.assuranceCase`);
      assertParentPreservesOwnerTruth(parent, [owner], section.sectionId);
      return parent;
    }
    case 'AUTONOMIC_DIAGNOSTICS': {
      const diagnostics = projection as Readonly<AutonomicDiagnosticsCockpitProjection>;
      const parent = verdictField(diagnostics, 'verdict', section.sectionId);
      const owners = [
        opaqueOwnerVerdict(diagnostics.actionEvidence, 'ACTION_EVIDENCE', `${section.sectionId}.actionEvidence`),
        opaqueOwnerVerdict(diagnostics.assuranceCase, 'ASSURANCE_CASE', `${section.sectionId}.assuranceCase`),
        opaqueOwnerVerdict(diagnostics.governance, 'DIAGNOSTIC_GOVERNANCE', `${section.sectionId}.governance`),
      ];
      assertParentPreservesOwnerTruth(parent, owners, section.sectionId);
      return parent;
    }
  }
}

const REQUIRED_PROJECTION_FIELDS: Readonly<Record<AssuranceCockpitSectionId, readonly string[]>> = Object.freeze({
  INVARIANTS: Object.freeze(['evaluatedAtMs', 'results', 'counts', 'blockingInvariantIds', 'unknownCriticalInvariantIds']),
  INVENTORY_COVERAGE: Object.freeze(['surface', 'state', 'ownerId', 'releaseId', 'subjectId', 'digest', 'tupleDigest', 'envelope', 'reasonCodes', 'payload', 'authorityGranted']),
  OPERATION_STABILITY: Object.freeze(['reasonCodes', 'operationCoverage', 'campaigns']),
  RATE_BUDGET: Object.freeze(['surface', 'state', 'ownerId', 'releaseId', 'subjectId', 'digest', 'tupleDigest', 'envelope', 'reasonCodes', 'payload', 'authorityGranted']),
  TEMPORAL_COHERENCE: Object.freeze(['crossMarketSkewMs', 'stagesOrdered', 'continuityProven', 'reasonCodes']),
  EXECUTION_LEASE: Object.freeze(['active', 'ownerId', 'epoch', 'processIdentity', 'releaseIdentity', 'renewedAtMs', 'expiresAtMs', 'evaluatedAtMs', 'reasonCodes']),
  MUTATION_LIFECYCLE: Object.freeze(['reasonCodes', 'records']),
  TELEMETRY_INDEPENDENT_PROOF: Object.freeze(['reasonCodes', 'telemetry', 'independentSentinel']),
  WATCHDOG_NOTIFICATION: Object.freeze(['reasonCodes']),
  INCIDENT_CORRELATION: Object.freeze(['reasonCodes', 'incidentIds', 'causeIds', 'effectIds', 'correlationTraceIds', 'assuranceCase']),
  AUTONOMIC_DIAGNOSTICS: Object.freeze(['reasonCodes', 'campaigns', 'actionEvidence', 'assuranceCase', 'governance', 'diagnosticBoundary', 'diagnosticTraceIds', 'providerState']),
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
  const directOwnerSurface = section.sectionId === 'INVENTORY_COVERAGE'
    || section.sectionId === 'RATE_BUDGET'
    ? DIRECT_OWNER_SECTION_SURFACES[section.sectionId]
    : null;
  const projectionRecord: Readonly<Record<string, unknown>> | null = isPlainRecord(section.projection)
    ? section.projection as Readonly<Record<string, unknown>>
    : null;
  const directOwnerState = directOwnerSurface !== null
    && projectionRecord !== null
    && ['WAITING', 'REJECTED', 'CONSUMED'].includes(String(projectionRecord.state))
    ? projectionRecord.state
    : null;
  const projectionRequiresSourceProof = hasProjection && directOwnerState !== 'WAITING'
    && directOwnerState !== 'REJECTED';
  const hasCompleteSource = section.sourceRevision !== null && section.observedAtMs !== null;
  if (projectionRequiresSourceProof !== hasCompleteSource) {
    throw new TypeError(
      `${section.sectionId} projection requires sourceRevision and observedAtMs together`,
    );
  }
  const hasCompleteProof = section.sourceDigest !== null
    && section.producerId !== null
    && section.verifierId !== null
    && section.producerCommonModeGroupId !== null
    && section.verifierCommonModeGroupId !== null;
  if (projectionRequiresSourceProof !== hasCompleteProof) throw new TypeError(`${section.sectionId} projection requires digest and independent producer/verifier proof`);
  if (projectionRequiresSourceProof && section.producerId === section.verifierId) throw new TypeError(`${section.sectionId} verifier must be independent`);
  if (projectionRequiresSourceProof && section.producerCommonModeGroupId === section.verifierCommonModeGroupId) throw new TypeError(`${section.sectionId} verifier common mode must differ`);
  validateProjectionShape(section);
  const authoritativeVerdict = authoritativeProjectionVerdict(section);
  if (directOwnerSurface !== null && section.projection !== null) {
    const ownerProjection = section.projection as Readonly<OpaqueOwnerProjection>;
    const canonicalOwnerId = OWNER_CONTRACT_WAITING_SEAMS[directOwnerSurface].ownerId;
    if (section.ownerId !== canonicalOwnerId) {
      throw new TypeError(`${section.sectionId}.ownerId must equal canonical owner ${canonicalOwnerId}`);
    }
    if (ownerProjection.state === 'CONSUMED') {
      if (section.sourceRevision !== ownerProjection.releaseId
        || section.sourceId !== ownerProjection.subjectId
        || section.sourceDigest !== ownerProjection.digest) {
        throw new TypeError(`${section.sectionId} source metadata must bind the consumed owner tuple`);
      }
    } else if (hasCompleteSource || hasCompleteProof) {
      throw new TypeError(`${section.sectionId} ${ownerProjection.state} owner seam cannot claim source proof`);
    }
  }
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
  trustedOwnerExpectations: Readonly<TrustedCockpitOwnerExpectations>,
): Readonly<AssuranceCockpitViewModel> {
  assertUtcMs(generatedAtMs, 'generatedAtMs');
  if (!Array.isArray(sections)) throw new TypeError('cockpit sections must be an array');
  validateTrustedOwnerExpectations(trustedOwnerExpectations);
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

  const normalizedSections = sections.map((section) => normalizeOwnerAdapters(
    section,
    trustedOwnerExpectations,
  ));
  for (const section of normalizedSections) validateSection(section, generatedAtMs);
  const rank = new Map(ASSURANCE_COCKPIT_SECTION_IDS.map((sectionId, index) => [sectionId, index]));
  const ordered = normalizedSections
    .map((section) => immutableSnapshot({
      ...section,
      reasonCodes: sortedUnique(section.reasonCodes),
    }, `section.${section.sectionId}`) as Readonly<AssuranceCockpitSection>)
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

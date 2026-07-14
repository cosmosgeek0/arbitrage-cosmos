import { createHash } from 'node:crypto';
import {
  assertCode,
  assertIdentifier,
  assertSafeNonNegativeInteger,
  assertUtcMs,
  evaluateEvidenceBinding,
  evaluateEvidenceRef,
  sortedUnique,
  verdictFromReasons,
  type AssuranceEvidenceRef,
  type AssuranceEvidenceBinding,
  type AssuranceSeverity,
  type AssuranceVerdict,
} from '../common.js';

export const FAILURE_ASSURANCE_DIMENSIONS = Object.freeze([
  'DETECTION',
  'CONTAINMENT',
  'DIAGNOSIS',
  'RECOVERY',
  'PREVENTION',
] as const);
export type FailureAssuranceDimension = (typeof FAILURE_ASSURANCE_DIMENSIONS)[number];

export const FAILURE_FAIL_SAFE_POSTURES = Object.freeze([
  'BLOCK_RISK_INCREASE',
  'ALLOW_RISK_REDUCTION_ONLY',
  'QUARANTINE_AND_ESCALATE',
  'DEGRADED_NO_AUTHORITY',
  'STOP_COMPONENT',
] as const);
export type FailureFailSafePosture = (typeof FAILURE_FAIL_SAFE_POSTURES)[number];

export interface FailureDependencyOwnership {
  readonly dependencyId: string;
  readonly ownerId: string;
  readonly interfaceId: string;
  readonly failureEffect: string;
  readonly unavailablePosture: FailureFailSafePosture;
}

export interface FailureAssuranceControl {
  readonly dimension: FailureAssuranceDimension;
  readonly controlId: string;
  readonly ownerId: string;
  readonly evidenceType: string;
  readonly expectedEvidenceSubjectId: string;
  readonly runbookId: string;
  readonly independentVerificationRequired: boolean;
  readonly missingEvidenceLaw: 'UNKNOWN_NO_GREEN';
}

export interface OperationalFailureDefinition {
  readonly failureId: string;
  readonly familyId: string;
  readonly title: string;
  readonly ownerId: string;
  readonly severity: AssuranceSeverity;
  readonly capitalRelevant: boolean;
  readonly trigger: string;
  readonly effect: string;
  readonly failSafePosture: FailureFailSafePosture;
  readonly dependencyOwnership: readonly Readonly<FailureDependencyOwnership>[];
  readonly assuranceControls: readonly Readonly<FailureAssuranceControl>[];
  readonly invariantIds: readonly string[];
  readonly operationPolicyIds: readonly string[];
  readonly faultTestIds: readonly string[];
}

export interface OperationalFailureAtlasCatalog {
  readonly schema: 'PRODUCT_ASSURANCE_FAILURE_ATLAS_V1';
  readonly revision: number;
  readonly releaseId: string;
  readonly testedCommit: string;
  readonly generatedAtMs: number;
  readonly expectedFamilyIds: readonly string[];
  readonly failures: readonly Readonly<OperationalFailureDefinition>[];
}

export interface FailureControlObservation {
  readonly failureId: string;
  readonly controlId: string;
  readonly claimedVerdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly evidence: Readonly<AssuranceEvidenceRef> | null;
  readonly evidenceBinding: Readonly<FailureControlEvidenceBinding> | null;
}

/**
 * Typed binding carried beside an evidence reference. The referenced artifact
 * is usable only for this exact failure/control/dimension/type/subject tuple.
 */
export interface FailureControlEvidenceBinding {
  readonly failureId: string;
  readonly controlId: string;
  readonly dimension: FailureAssuranceDimension;
  readonly evidenceType: string;
  readonly evidenceSubjectId: string;
  readonly tupleBinding: Readonly<AssuranceEvidenceBinding>;
}

export const FAILURE_FAMILY_DENOMINATOR_SUBJECT_ID = 'FAILURE_ATLAS_EXPECTED_FAMILIES';

export interface FailureAtlasFamilyDenominatorBinding {
  readonly schema: 'PRODUCT_ASSURANCE_FAILURE_FAMILY_DENOMINATOR_V1';
  readonly releaseId: string;
  readonly testedCommit: string;
  readonly expectedFamilyIds: readonly string[];
  readonly expectedFamilyIdsDigest: string;
  readonly evidence: Readonly<AssuranceEvidenceRef>;
  readonly evidenceBinding: Readonly<AssuranceEvidenceBinding>;
}

export function failureFamilyDenominatorDigest(expectedFamilyIds: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify([...expectedFamilyIds].sort())).digest('hex');
}

export interface OperationalFailureAtlasObservation {
  readonly evaluatedAtMs: number;
  readonly controls: readonly Readonly<FailureControlObservation>[];
}

export interface FailureDimensionResult {
  readonly dimension: FailureAssuranceDimension;
  readonly controlId: string;
  readonly ownerId: string;
  readonly evidenceType: string;
  readonly evidenceSubjectId: string;
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface OperationalFailureResult {
  readonly failureId: string;
  readonly familyId: string;
  readonly ownerId: string;
  readonly severity: AssuranceSeverity;
  readonly capitalRelevant: boolean;
  readonly failSafePosture: FailureFailSafePosture;
  readonly dependencyOwnerIds: readonly string[];
  readonly dimensions: readonly Readonly<FailureDimensionResult>[];
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface OperationalFailureAtlasProjection {
  readonly schema: 'PRODUCT_ASSURANCE_FAILURE_ATLAS_PROJECTION_V1';
  readonly catalogRevision: number;
  readonly releaseId: string;
  readonly testedCommit: string;
  readonly evaluatedAtMs: number;
  readonly expectedFamilyCount: number;
  readonly representedFamilyCount: number;
  readonly familyDefinitionCoveragePercentage: number;
  readonly expectedControlCount: number;
  readonly assessedControlCount: number;
  readonly assessedControlCoveragePercentage: number;
  readonly missingExpectedFamilyIds: readonly string[];
  readonly counts: Readonly<Record<AssuranceVerdict, number>>;
  readonly failures: readonly Readonly<OperationalFailureResult>[];
  readonly capitalRelevantBlockingFailureIds: readonly string[];
  readonly overallVerdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
}

function assertBoundedText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 1_000) {
    throw new TypeError(`${label} must be non-empty text (<=1000 chars)`);
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique`);
}

function assertEnum(value: string, allowed: readonly string[], label: string): void {
  if (!allowed.includes(value)) throw new TypeError(`${label} is unsupported`);
}

export function failureControlEvidenceSubjectId(
  failureId: string,
  controlId: string,
): string {
  assertIdentifier(failureId, 'failureId');
  assertIdentifier(controlId, 'controlId');
  const subjectId = `${failureId}/${controlId}`;
  assertIdentifier(subjectId, 'failure/control evidence subject ID');
  return subjectId;
}

export function validateOperationalFailureAtlasCatalog(
  catalog: Readonly<OperationalFailureAtlasCatalog>,
): void {
  if (catalog.schema !== 'PRODUCT_ASSURANCE_FAILURE_ATLAS_V1') {
    throw new TypeError('failure atlas schema unsupported');
  }
  assertSafeNonNegativeInteger(catalog.revision, 'catalog.revision');
  assertIdentifier(catalog.releaseId, 'catalog.releaseId');
  if (!/^[a-f0-9]{40}$/u.test(catalog.testedCommit)) throw new TypeError('catalog.testedCommit must be a bound full lowercase Git SHA-1');
  assertUtcMs(catalog.generatedAtMs, 'catalog.generatedAtMs');
  if (catalog.expectedFamilyIds.length === 0) {
    throw new TypeError('catalog.expectedFamilyIds must not be empty');
  }
  assertUnique(catalog.expectedFamilyIds, 'catalog.expectedFamilyIds');
  for (const familyId of catalog.expectedFamilyIds) {
    assertIdentifier(familyId, 'catalog.expectedFamilyIds[]');
  }

  const expectedFamilies = new Set(catalog.expectedFamilyIds);
  const failureIds = catalog.failures.map((failure) => failure.failureId);
  assertUnique(failureIds, 'catalog.failures.failureId');

  for (const failure of catalog.failures) {
    assertIdentifier(failure.failureId, 'failure.failureId');
    assertIdentifier(failure.familyId, 'failure.familyId');
    if (!expectedFamilies.has(failure.familyId)) {
      throw new TypeError(`failure ${failure.failureId} has a family outside the expected denominator`);
    }
    assertBoundedText(failure.title, 'failure.title');
    assertIdentifier(failure.ownerId, 'failure.ownerId');
    assertEnum(failure.severity, ['INFO', 'WARNING', 'ERROR', 'CRITICAL'], 'failure.severity');
    assertBoolean(failure.capitalRelevant, 'failure.capitalRelevant');
    assertBoundedText(failure.trigger, 'failure.trigger');
    assertBoundedText(failure.effect, 'failure.effect');
    assertEnum(failure.failSafePosture, FAILURE_FAIL_SAFE_POSTURES, 'failure.failSafePosture');

    if (failure.dependencyOwnership.length === 0) {
      throw new TypeError(`failure ${failure.failureId} requires dependency ownership`);
    }
    assertUnique(
      failure.dependencyOwnership.map((dependency) => dependency.dependencyId),
      `failure ${failure.failureId} dependency IDs`,
    );
    for (const dependency of failure.dependencyOwnership) {
      assertIdentifier(dependency.dependencyId, 'dependency.dependencyId');
      assertIdentifier(dependency.ownerId, 'dependency.ownerId');
      assertIdentifier(dependency.interfaceId, 'dependency.interfaceId');
      assertBoundedText(dependency.failureEffect, 'dependency.failureEffect');
      assertEnum(
        dependency.unavailablePosture,
        FAILURE_FAIL_SAFE_POSTURES,
        'dependency.unavailablePosture',
      );
    }

    const dimensions = failure.assuranceControls.map((control) => control.dimension);
    assertUnique(dimensions, `failure ${failure.failureId} assurance dimensions`);
    if (
      dimensions.length !== FAILURE_ASSURANCE_DIMENSIONS.length ||
      FAILURE_ASSURANCE_DIMENSIONS.some((dimension) => !dimensions.includes(dimension))
    ) {
      throw new TypeError(`failure ${failure.failureId} must define every assurance dimension exactly once`);
    }
    assertUnique(
      failure.assuranceControls.map((control) => control.controlId),
      `failure ${failure.failureId} assurance control IDs`,
    );
    for (const control of failure.assuranceControls) {
      assertEnum(control.dimension, FAILURE_ASSURANCE_DIMENSIONS, 'control.dimension');
      assertIdentifier(control.controlId, 'control.controlId');
      assertIdentifier(control.ownerId, 'control.ownerId');
      assertIdentifier(control.evidenceType, 'control.evidenceType');
      assertIdentifier(
        control.expectedEvidenceSubjectId,
        'control.expectedEvidenceSubjectId',
      );
      if (
        control.expectedEvidenceSubjectId !==
        failureControlEvidenceSubjectId(failure.failureId, control.controlId)
      ) {
        throw new TypeError(
          `control ${control.controlId} evidence subject must bind its failure/control tuple`,
        );
      }
      assertIdentifier(control.runbookId, 'control.runbookId');
      assertBoolean(
        control.independentVerificationRequired,
        'control.independentVerificationRequired',
      );
      if (control.missingEvidenceLaw !== 'UNKNOWN_NO_GREEN') {
        throw new TypeError('control.missingEvidenceLaw must be UNKNOWN_NO_GREEN');
      }
    }

    for (const [values, label] of [
      [failure.invariantIds, 'failure.invariantIds'],
      [failure.operationPolicyIds, 'failure.operationPolicyIds'],
      [failure.faultTestIds, 'failure.faultTestIds'],
    ] as const) {
      assertUnique(values, label);
      for (const value of values) assertIdentifier(value, `${label}[]`);
    }
  }
}

function validateObservation(
  observation: Readonly<OperationalFailureAtlasObservation>,
  catalog: Readonly<OperationalFailureAtlasCatalog>,
): void {
  assertUtcMs(observation.evaluatedAtMs, 'observation.evaluatedAtMs');
  const observations = observation.controls.map(
    (entry) => `${entry.failureId}\u0000${entry.controlId}`,
  );
  assertUnique(observations, 'observation.controls');
  const definitions = new Map(
    catalog.failures.flatMap((failure) =>
      failure.assuranceControls.map(
        (control) => [`${failure.failureId}\u0000${control.controlId}`, control] as const,
      ),
    ),
  );
  for (const entry of observation.controls) {
    assertIdentifier(entry.failureId, 'observation.failureId');
    assertIdentifier(entry.controlId, 'observation.controlId');
    if (!definitions.has(`${entry.failureId}\u0000${entry.controlId}`)) {
      throw new TypeError(
        `observation references unknown failure control ${entry.failureId}/${entry.controlId}`,
      );
    }
    assertEnum(entry.claimedVerdict, ['PASS', 'FAIL', 'UNKNOWN'], 'observation.claimedVerdict');
    assertUnique(entry.reasonCodes, 'observation.reasonCodes');
    for (const reasonCode of entry.reasonCodes) assertCode(reasonCode, 'observation.reasonCode');
    if (entry.claimedVerdict === 'PASS' && entry.reasonCodes.length > 0) {
      throw new TypeError('PASS observation must not carry failure or unknown reason codes');
    }
    if (entry.claimedVerdict !== 'PASS' && entry.reasonCodes.length === 0) {
      throw new TypeError('FAIL or UNKNOWN observation requires at least one reason code');
    }
    if (entry.evidenceBinding !== null) {
      assertIdentifier(entry.evidenceBinding.failureId, 'evidenceBinding.failureId');
      assertIdentifier(entry.evidenceBinding.controlId, 'evidenceBinding.controlId');
      assertEnum(
        entry.evidenceBinding.dimension,
        FAILURE_ASSURANCE_DIMENSIONS,
        'evidenceBinding.dimension',
      );
      assertIdentifier(entry.evidenceBinding.evidenceType, 'evidenceBinding.evidenceType');
      assertIdentifier(
        entry.evidenceBinding.evidenceSubjectId,
        'evidenceBinding.evidenceSubjectId',
      );
      const tuple = entry.evidenceBinding.tupleBinding;
      assertIdentifier(tuple.ownerId, 'evidenceBinding.tupleBinding.ownerId');
      assertIdentifier(tuple.releaseId, 'evidenceBinding.tupleBinding.releaseId');
      assertIdentifier(tuple.subjectId, 'evidenceBinding.tupleBinding.subjectId');
      if (!/^[a-f0-9]{40}$/u.test(tuple.testedCommit)) throw new TypeError('evidenceBinding.tupleBinding.testedCommit must be a full Git SHA-1');
      if (!/^[a-f0-9]{64}$/u.test(tuple.evidenceDigest)) throw new TypeError('evidenceBinding.tupleBinding.evidenceDigest must be a SHA-256 digest');
    }
  }
}

function evaluateDimension(
  control: Readonly<FailureAssuranceControl>,
  observation: Readonly<FailureControlObservation> | undefined,
  nowMs: number,
  evidenceReusedAcrossControls: boolean,
  releaseId: string,
  testedCommit: string,
): Readonly<FailureDimensionResult> {
  if (observation === undefined) {
    return Object.freeze({
      dimension: control.dimension,
      controlId: control.controlId,
      ownerId: control.ownerId,
      evidenceType: control.evidenceType,
      evidenceSubjectId: control.expectedEvidenceSubjectId,
      verdict: 'UNKNOWN',
      reasonCodes: Object.freeze(['REQUIRED_CONTROL_OBSERVATION_MISSING']),
      evidenceIds: Object.freeze([]),
    });
  }

  const failed: string[] = [];
  const unknown: string[] = [];
  if (observation.claimedVerdict === 'FAIL') failed.push('CONTROL_OBSERVED_FAIL');
  if (observation.claimedVerdict === 'UNKNOWN') unknown.push('CONTROL_OBSERVED_UNKNOWN');
  if (observation.claimedVerdict === 'FAIL') failed.push(...observation.reasonCodes);
  if (observation.claimedVerdict === 'UNKNOWN') unknown.push(...observation.reasonCodes);

  const binding = observation.evidenceBinding;
  if (observation.evidence !== null && binding === null) {
    failed.push('EVIDENCE_BINDING_MISSING');
  } else if (observation.evidence === null && binding !== null) {
    failed.push('EVIDENCE_BINDING_WITHOUT_EVIDENCE');
  } else if (binding !== null) {
    if (binding.failureId !== observation.failureId) {
      failed.push('EVIDENCE_FAILURE_SUBJECT_MISMATCH');
    }
    if (binding.controlId !== observation.controlId) {
      failed.push('EVIDENCE_CONTROL_SUBJECT_MISMATCH');
    }
    if (binding.dimension !== control.dimension) {
      failed.push('EVIDENCE_DIMENSION_MISMATCH');
    }
    if (binding.evidenceType !== control.evidenceType) {
      failed.push('EVIDENCE_TYPE_MISMATCH');
    }
    if (binding.evidenceSubjectId !== control.expectedEvidenceSubjectId) {
      failed.push('EVIDENCE_SUBJECT_ID_MISMATCH');
    }
    if (observation.evidence !== null) {
      const exactBinding = evaluateEvidenceBinding(observation.evidence, binding.tupleBinding, {
        ownerId: control.ownerId,
        releaseId,
        testedCommit,
        subjectId: control.expectedEvidenceSubjectId,
        evidenceDigest: observation.evidence.digest ?? '',
      });
      if (exactBinding.verdict === 'FAIL') failed.push(...exactBinding.reasonCodes);
    }
  }
  if (evidenceReusedAcrossControls) {
    failed.push('EVIDENCE_ARTIFACT_REUSED_ACROSS_CONTROLS');
  }

  if (observation.evidence === null) {
    if (observation.claimedVerdict === 'FAIL') failed.push('EVIDENCE_MISSING_CONSERVATIVE_FAILURE');
    else unknown.push('REQUIRED_EVIDENCE_MISSING');
    return Object.freeze({
      dimension: control.dimension,
      controlId: control.controlId,
      ownerId: control.ownerId,
      evidenceType: control.evidenceType,
      evidenceSubjectId: control.expectedEvidenceSubjectId,
      verdict: verdictFromReasons(failed, unknown),
      reasonCodes: sortedUnique([...failed, ...unknown]),
      evidenceIds: Object.freeze([]),
    });
  }

  const evidence = evaluateEvidenceRef(
    observation.evidence,
    nowMs,
    control.independentVerificationRequired,
  );
  if (evidence.verdict === 'FAIL') failed.push(...evidence.reasonCodes);
  if (evidence.verdict === 'UNKNOWN') unknown.push(...evidence.reasonCodes);
  if (observation.evidence.ownerId !== control.ownerId) failed.push('EVIDENCE_CANONICAL_OWNER_MISMATCH');
  return Object.freeze({
    dimension: control.dimension,
    controlId: control.controlId,
    ownerId: control.ownerId,
    evidenceType: control.evidenceType,
    evidenceSubjectId: control.expectedEvidenceSubjectId,
    verdict: verdictFromReasons(failed, unknown),
    reasonCodes: sortedUnique([...failed, ...unknown]),
    evidenceIds: evidence.evidenceIds,
  });
}

function percentage(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export function projectOperationalFailureAtlas(
  catalog: Readonly<OperationalFailureAtlasCatalog>,
  observation: Readonly<OperationalFailureAtlasObservation>,
  familyBinding: Readonly<FailureAtlasFamilyDenominatorBinding>,
): Readonly<OperationalFailureAtlasProjection> {
  validateOperationalFailureAtlasCatalog(catalog);
  validateObservation(observation, catalog);
  if (familyBinding.schema !== 'PRODUCT_ASSURANCE_FAILURE_FAMILY_DENOMINATOR_V1') throw new TypeError('failure family denominator binding schema unsupported');
  assertIdentifier(familyBinding.releaseId, 'familyBinding.releaseId');
  if (!/^[a-f0-9]{40}$/u.test(familyBinding.testedCommit)) throw new TypeError('familyBinding.testedCommit must be a full Git SHA-1');
  if (familyBinding.releaseId !== catalog.releaseId || familyBinding.testedCommit !== catalog.testedCommit) throw new TypeError('failure family denominator release binding mismatch');
  const boundFamilies = [...familyBinding.expectedFamilyIds].sort();
  const catalogFamilies = [...catalog.expectedFamilyIds].sort();
  if (boundFamilies.join('\n') !== catalogFamilies.join('\n')) throw new TypeError('failure family denominator IDs mismatch');
  if (familyBinding.expectedFamilyIdsDigest !== failureFamilyDenominatorDigest(boundFamilies)) throw new TypeError('failure family denominator digest mismatch');
  const familyBindingEvidence = evaluateEvidenceRef(familyBinding.evidence, observation.evaluatedAtMs, true);
  if (familyBinding.evidence.digest !== familyBinding.expectedFamilyIdsDigest) throw new TypeError('failure family denominator evidence digest mismatch');
  if (familyBinding.evidence.ownerId !== 'IP_ASSURANCE_HAZARD_SATELLITE') throw new TypeError('failure family denominator owner mismatch');
  const familyBindingExact = evaluateEvidenceBinding(
    familyBinding.evidence,
    familyBinding.evidenceBinding,
    {
      ownerId: 'IP_ASSURANCE_HAZARD_SATELLITE',
      releaseId: catalog.releaseId,
      testedCommit: catalog.testedCommit,
      subjectId: FAILURE_FAMILY_DENOMINATOR_SUBJECT_ID,
      evidenceDigest: familyBinding.expectedFamilyIdsDigest,
    },
  );
  if (catalog.generatedAtMs > observation.evaluatedAtMs) throw new TypeError('failure atlas catalog cannot be generated after evaluation');
  const observationByControl = new Map(
    observation.controls.map(
      (entry) => [`${entry.failureId}\u0000${entry.controlId}`, entry] as const,
    ),
  );
  const evidenceUses = new Map<string, Set<string>>();
  for (const entry of observation.controls) {
    if (entry.evidence === null) continue;
    const subjectKey = `${entry.failureId}\u0000${entry.controlId}`;
    const artifactKeys = [
      `id:${entry.evidence.evidenceId}`,
      ...(entry.evidence.digest === null ? [] : [`digest:${entry.evidence.digest}`]),
    ];
    for (const artifactKey of artifactKeys) {
      const uses = evidenceUses.get(artifactKey) ?? new Set<string>();
      uses.add(subjectKey);
      evidenceUses.set(artifactKey, uses);
    }
  }

  const evidenceIsReused = (entry: Readonly<FailureControlObservation> | undefined): boolean => {
    if (entry?.evidence === null || entry?.evidence === undefined) return false;
    if ((evidenceUses.get(`id:${entry.evidence.evidenceId}`)?.size ?? 0) > 1) return true;
    return (
      entry.evidence.digest !== null &&
      (evidenceUses.get(`digest:${entry.evidence.digest}`)?.size ?? 0) > 1
    );
  };

  const failures = catalog.failures.map((failure): Readonly<OperationalFailureResult> => {
    const dimensions = failure.assuranceControls.map((control) => {
      const observed = observationByControl.get(
        `${failure.failureId}\u0000${control.controlId}`,
      );
      return evaluateDimension(
        control,
        observed,
        observation.evaluatedAtMs,
        evidenceIsReused(observed),
        catalog.releaseId,
        catalog.testedCommit,
      );
    });
    const verdict: AssuranceVerdict = dimensions.some((entry) => entry.verdict === 'FAIL')
      ? 'FAIL'
      : dimensions.some((entry) => entry.verdict === 'UNKNOWN')
        ? 'UNKNOWN'
        : 'PASS';
    return Object.freeze({
      failureId: failure.failureId,
      familyId: failure.familyId,
      ownerId: failure.ownerId,
      severity: failure.severity,
      capitalRelevant: failure.capitalRelevant,
      failSafePosture: failure.failSafePosture,
      dependencyOwnerIds: sortedUnique(
        failure.dependencyOwnership.map((dependency) => dependency.ownerId),
      ),
      dimensions: Object.freeze(dimensions),
      verdict,
      reasonCodes: sortedUnique(dimensions.flatMap((entry) => entry.reasonCodes)),
      evidenceIds: sortedUnique(dimensions.flatMap((entry) => entry.evidenceIds)),
    });
  });

  const representedFamilies = new Set(failures.map((failure) => failure.familyId));
  const missingFamilies = catalog.expectedFamilyIds.filter(
    (familyId) => !representedFamilies.has(familyId),
  );
  const dimensions = failures.flatMap((failure) => failure.dimensions);
  // A missing expected family represents at least one absent five-dimension
  // definition. It therefore remains in the control denominator instead of
  // disappearing merely because no reporter supplied it.
  const expectedControlCount =
    dimensions.length + missingFamilies.length * FAILURE_ASSURANCE_DIMENSIONS.length;
  const assessedControlCount = dimensions.filter((entry) => entry.verdict !== 'UNKNOWN').length;
  const counts: Record<AssuranceVerdict, number> = { PASS: 0, FAIL: 0, UNKNOWN: 0 };
  for (const failure of failures) counts[failure.verdict] += 1;
  const reasons: string[] = [];
  if (missingFamilies.length > 0) reasons.push('EXPECTED_FAILURE_FAMILY_MISSING');
  if (familyBindingEvidence.verdict === 'FAIL') reasons.push('FAILURE_FAMILY_DENOMINATOR_EVIDENCE_FAILED');
  if (familyBindingEvidence.verdict === 'UNKNOWN') reasons.push('FAILURE_FAMILY_DENOMINATOR_EVIDENCE_UNKNOWN');
  if (familyBindingExact.verdict === 'FAIL') {
    reasons.push('FAILURE_FAMILY_DENOMINATOR_BINDING_FAILED', ...familyBindingExact.reasonCodes);
  }
  if (failures.some((failure) => failure.verdict === 'FAIL')) {
    reasons.push('FAILURE_ASSURANCE_CONTROL_FAILED');
  }
  if (failures.some((failure) => failure.verdict === 'UNKNOWN')) {
    reasons.push('FAILURE_ASSURANCE_CONTROL_UNKNOWN');
  }

  const overallVerdict: AssuranceVerdict = familyBindingEvidence.verdict === 'FAIL'
    || familyBindingExact.verdict === 'FAIL' || failures.some(
    (failure) => failure.verdict === 'FAIL',
  )
    ? 'FAIL'
    : familyBindingEvidence.verdict === 'UNKNOWN' || missingFamilies.length > 0 || failures.some((failure) => failure.verdict === 'UNKNOWN')
      ? 'UNKNOWN'
      : 'PASS';

  return Object.freeze({
    schema: 'PRODUCT_ASSURANCE_FAILURE_ATLAS_PROJECTION_V1',
    catalogRevision: catalog.revision,
    releaseId: catalog.releaseId,
    testedCommit: catalog.testedCommit,
    evaluatedAtMs: observation.evaluatedAtMs,
    expectedFamilyCount: catalog.expectedFamilyIds.length,
    representedFamilyCount: representedFamilies.size,
    familyDefinitionCoveragePercentage: percentage(
      representedFamilies.size,
      catalog.expectedFamilyIds.length,
    ),
    expectedControlCount,
    assessedControlCount,
    assessedControlCoveragePercentage: percentage(assessedControlCount, expectedControlCount),
    missingExpectedFamilyIds: Object.freeze([...missingFamilies].sort()),
    counts: Object.freeze({ ...counts }),
    failures: Object.freeze(failures),
    capitalRelevantBlockingFailureIds: sortedUnique(
      failures
        .filter((failure) => failure.capitalRelevant && failure.verdict !== 'PASS')
        .map((failure) => failure.failureId),
    ),
    overallVerdict,
    reasonCodes: sortedUnique(reasons),
  });
}

export interface FailureTimelineEvent {
  readonly eventId: string;
  readonly occurredAtMs: number;
  readonly phase: 'TRIGGER' | 'SYMPTOM' | 'CONTAINMENT' | 'REPAIR' | 'VERIFICATION' | 'RECURRENCE';
  readonly componentId: string;
  readonly evidenceIds: readonly string[];
}

export interface FailureRepairAttemptRecord {
  readonly attemptId: string;
  readonly actionId: string;
  readonly result: 'SUCCEEDED' | 'FAILED' | 'FALSE_REPAIR' | 'AMBIGUOUS';
  readonly verifierId: string;
  readonly postconditionEvidenceIds: readonly string[];
}

export interface OperationalFailureRecord {
  readonly schema: 'PRODUCT_ASSURANCE_FAILURE_RECORD_V1';
  readonly revision: number;
  readonly recordId: string;
  readonly fingerprint: string;
  readonly releaseId: string;
  readonly testedCommit: string;
  readonly componentId: string;
  readonly dependencyIds: readonly string[];
  readonly componentRevision: string;
  readonly timeline: readonly Readonly<FailureTimelineEvent>[];
  readonly triggerCode: string;
  readonly symptomCodes: readonly string[];
  readonly failedInvariantIds: readonly string[];
  readonly capitalImpactUnits: number | null;
  readonly exposureImpactUnits: number | null;
  readonly liabilityImpactUnits: number | null;
  readonly ambiguityImpact: 'NONE' | 'PRESENT' | 'UNKNOWN';
  readonly containmentActionIds: readonly string[];
  readonly repairAttempts: readonly Readonly<FailureRepairAttemptRecord>[];
  readonly rootCauseIds: readonly string[];
  readonly contributingCauseIds: readonly string[];
  readonly regressionFixtureId: string;
  readonly faultSeed: number;
  readonly playbookRevision: string;
  readonly modelRevisionIds: readonly string[];
  readonly reviewerId: string;
  readonly postmortemId: string;
  readonly actionItemIds: readonly string[];
  readonly recurrenceCount: number;
  readonly provenanceDigest: string;
  readonly sanitized: boolean;
  readonly accessClass: 'ASSURANCE_RESTRICTED' | 'REVIEWER_RESTRICTED';
  readonly retentionUntilMs: number;
  readonly evidence: Readonly<AssuranceEvidenceRef>;
}

export interface OperationalFailureRecordProjection {
  readonly verdict: AssuranceVerdict;
  readonly eligibleRecordIds: readonly string[];
  readonly rejectedRecordIds: readonly string[];
  readonly recurrenceByFingerprint: Readonly<Record<string, number>>;
  readonly reasonCodes: readonly string[];
  readonly secondStoreCreated: false;
}

function validateIdentifierArray(values: readonly string[], label: string, requireNonempty = false): void {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  if (requireNonempty && values.length === 0) throw new TypeError(`${label} must be nonempty`);
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique`);
  for (const value of values) assertIdentifier(value, `${label}[]`);
}

export function projectOperationalFailureRecords(
  records: readonly Readonly<OperationalFailureRecord>[],
  evaluatedAtMs: number,
): Readonly<OperationalFailureRecordProjection> {
  assertUtcMs(evaluatedAtMs, 'evaluatedAtMs');
  if (records.length === 0) return Object.freeze({
    verdict: 'UNKNOWN', eligibleRecordIds: Object.freeze([]), rejectedRecordIds: Object.freeze([]),
    recurrenceByFingerprint: Object.freeze({}), reasonCodes: Object.freeze(['FAILURE_RECORD_CORPUS_EMPTY']), secondStoreCreated: false,
  });
  const recordIds = records.map((record) => record.recordId);
  if (new Set(recordIds).size !== recordIds.length) throw new TypeError('failure record IDs must be unique');
  for (const recordId of recordIds) assertIdentifier(recordId, 'record.recordId');
  return Object.freeze({
    verdict: 'UNKNOWN',
    eligibleRecordIds: Object.freeze([]),
    rejectedRecordIds: sortedUnique(recordIds),
    recurrenceByFingerprint: Object.freeze({}),
    reasonCodes: Object.freeze(['FAILURE_RECORD_OWNER_CONTRACT_WAITING']),
    secondStoreCreated: false,
  });
}

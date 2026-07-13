import {
  evaluateCoverageMatrix,
  projectCoverageFreshness,
  type CoverageChannelObservation,
  type CoverageFreshnessProjection,
  type CoverageMatrixProjection,
  type CoverageObligation,
  type CoverageSubjectKind,
  type ExpectedCoverageManifest,
} from '../coverage/matrix.js';
import { CANONICAL_FAULT_SCENARIOS } from '../faults/harness.js';
import {
  EXPECTED_CANONICAL_COMPONENTS,
  OPERATION_POLICY_REGISTRY,
  OWNER_QUESTION_COVERAGE,
  SAFETY_INVARIANT_CATALOG,
} from './core.js';

interface CoverageSeed {
  readonly subjectKind: CoverageSubjectKind;
  readonly subjectId: string;
  readonly capitalCritical: boolean;
  readonly freshnessMs: number;
  readonly severity: CoverageObligation['severity'];
  readonly cockpitSurface: string;
  readonly repairControlId: string;
  readonly fixtureId: string;
  readonly proofId: string;
}

function obligation(seed: Readonly<CoverageSeed>): Readonly<CoverageObligation> {
  const prefix = `${seed.subjectKind}.${seed.subjectId}`;
  return Object.freeze({
    schema: 'PRODUCT_ASSURANCE_COVERAGE_OBLIGATION_V1',
    subjectKind: seed.subjectKind,
    subjectId: seed.subjectId,
    metricId: `${prefix}.metric`,
    structuredLogId: `${prefix}.structured_log`,
    materialEventId: `${prefix}.material_event`,
    traceId: `${prefix}.trace`,
    incidentId: `${prefix}.incident`,
    freshnessMs: seed.freshnessMs,
    hysteresisMs: Math.min(5_000, seed.freshnessMs),
    missingDataLaw: 'UNKNOWN_BLOCKS_READINESS',
    severity: seed.severity,
    cockpitSurface: seed.cockpitSurface,
    repairControlId: seed.repairControlId,
    fixtureId: seed.fixtureId,
    proofId: seed.proofId,
    capitalCritical: seed.capitalCritical,
  });
}

const componentObligations = EXPECTED_CANONICAL_COMPONENTS.map((component) => obligation({
  subjectKind: 'COMPONENT',
  subjectId: component.componentId,
  capitalCritical: component.capitalCritical,
  freshnessMs: component.silentAfterMs,
  severity: component.capitalCritical ? 'CRITICAL' : 'ERROR',
  cockpitSurface: `health.components.${component.componentId}`,
  repairControlId: 'OWNER_COMPONENT_REVIEW',
  fixtureId: `FIXTURE_COMPONENT_${component.componentId}`,
  proofId: `PROOF_COMPONENT_${component.componentId}`,
}));

const invariantObligations = SAFETY_INVARIANT_CATALOG.map((definition) => obligation({
  subjectKind: 'INVARIANT',
  subjectId: definition.invariantId,
  capitalCritical: definition.capitalRelevant,
  freshnessMs: definition.cadenceMs,
  severity: definition.severity,
  cockpitSurface: definition.cockpitSurface,
  repairControlId: definition.repairControlId ?? 'NO_AUTOMATIC_REPAIR',
  fixtureId: definition.adversarialTestIds[0] ?? `FIXTURE_${definition.invariantId}`,
  proofId: `PROOF_${definition.invariantId}`,
}));

const failureObligations = CANONICAL_FAULT_SCENARIOS.map((scenario) => obligation({
  subjectKind: 'FAILURE_MODE',
  subjectId: scenario.scenarioId,
  capitalCritical: true,
  freshnessMs: 86_400_000,
  severity: 'CRITICAL',
  cockpitSurface: `logs.failure_atlas.${scenario.scenarioId}`,
  repairControlId: 'OWNER_APPROVED_REMEDIATION',
  fixtureId: scenario.scenarioId,
  proofId: scenario.requiredProofIds[0] ?? `PROOF_${scenario.scenarioId}`,
}));

const operationObligations = OPERATION_POLICY_REGISTRY.map((policy) => obligation({
  subjectKind: 'OPERATION_POLICY',
  subjectId: policy.operationId,
  capitalCritical: policy.rateBudget.priority === 'RISK_REDUCING'
    || policy.rateBudget.priority === 'RECONCILIATION'
    || policy.wiringState === 'DORMANT_BLOCKED',
  freshnessMs: Math.max(1, policy.deadlineMs),
  severity: policy.wiringState === 'DORMANT_BLOCKED' ? 'CRITICAL' : 'ERROR',
  cockpitSurface: policy.cockpitLocation,
  repairControlId: policy.escalationControlId,
  fixtureId: policy.faultTestIds[0] ?? `FIXTURE_${policy.operationId}`,
  proofId: `PROOF_${policy.operationId}`,
}));

const questionObligations = OWNER_QUESTION_COVERAGE.map((question) => obligation({
  subjectKind: 'OWNER_QUESTION',
  subjectId: question.questionId,
  capitalCritical: question.severity === 'CRITICAL',
  freshnessMs: question.freshnessMs,
  severity: question.severity,
  cockpitSurface: question.cockpitSurface,
  repairControlId: question.repairControlId ?? 'OWNER_REVIEW_REQUIRED',
  fixtureId: question.fixtureId,
  proofId: question.proofId,
}));

export const COVERAGE_OBLIGATIONS: readonly Readonly<CoverageObligation>[] = Object.freeze([
  ...componentObligations,
  ...invariantObligations,
  ...failureObligations,
  ...operationObligations,
  ...questionObligations,
]);

function ids(kind: CoverageSubjectKind): readonly string[] {
  return Object.freeze(COVERAGE_OBLIGATIONS.filter((entry) => entry.subjectKind === kind).map((entry) => entry.subjectId));
}

export const EXPECTED_COVERAGE_MANIFEST_TEMPLATE: Readonly<ExpectedCoverageManifest> = Object.freeze({
  schema: 'PRODUCT_ASSURANCE_EXPECTED_COVERAGE_V1',
  revision: 1,
  releaseId: 'IP_ASSURANCE_PRESTAGE_TEMPLATE',
  testedCommit: 'UNBOUND_TESTED_COMMIT',
  expectedSubjectIds: Object.freeze({
    COMPONENT: ids('COMPONENT'),
    INVARIANT: ids('INVARIANT'),
    FAILURE_MODE: ids('FAILURE_MODE'),
    OPERATION_POLICY: ids('OPERATION_POLICY'),
    OWNER_QUESTION: ids('OWNER_QUESTION'),
  }),
  minimumCoveragePercentage: 100,
});

export function bindExpectedCoverageManifest(
  releaseId: string,
  testedCommit: string,
): Readonly<ExpectedCoverageManifest> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(releaseId)) throw new TypeError('releaseId is invalid');
  if (!/^[a-f0-9]{40}$/u.test(testedCommit)) throw new TypeError('testedCommit must be a full lowercase Git SHA-1');
  return Object.freeze({ ...EXPECTED_COVERAGE_MANIFEST_TEMPLATE, releaseId, testedCommit });
}

export function evaluateCanonicalCoverageMatrix(
  releaseId: string,
  testedCommit: string,
): Readonly<CoverageMatrixProjection> {
  return evaluateCoverageMatrix(bindExpectedCoverageManifest(releaseId, testedCommit), COVERAGE_OBLIGATIONS);
}

export function projectCanonicalCoverageFreshness(
  releaseId: string,
  testedCommit: string,
  observations: readonly Readonly<CoverageChannelObservation>[],
  nowMs: number,
): Readonly<CoverageFreshnessProjection> {
  return projectCoverageFreshness(
    bindExpectedCoverageManifest(releaseId, testedCommit),
    COVERAGE_OBLIGATIONS,
    observations,
    nowMs,
  );
}

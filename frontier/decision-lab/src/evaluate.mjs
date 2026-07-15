import {
  cloneCanonical,
  contractError,
  deepFreeze,
  sha256,
} from '../../dock/src/index.mjs';
import {
  ALTERNATIVE_KINDS,
  MAX_ABLATIONS,
  MAX_ALTERNATIVES,
  DECISION_LAB_LIMITATIONS,
  alternativeComparisonStatus,
  assertAblationBaselineIdentity,
  assertDecisionLabFixtureTruth,
  assertRecordedReferenceBoundaries,
  createAblationComparison,
  createAlternativeReference,
  createDecisionEnvelope,
  decisionLabCutoffProof,
  decisionLabAlternativeAuthorityProof,
  decisionLabWarnings,
  decisionSourceDependenceWarnings,
  validateDecisionLabReport,
} from './contracts.mjs';
import { assertBoundedStructure } from './bounds.mjs';

function fail(code, message) {
  throw contractError(code, message);
}

function exactRequest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('REQUEST_RECORD_REQUIRED', 'DecisionLabRequestV1 must be an object');
  }
  const fields = ['schema', 'version', 'requestId', 'evaluatedAtMs', 'fixtureClass', 'decision', 'alternatives', 'ablations'];
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  const unknown = Object.keys(value).filter((field) => !fields.includes(field));
  if (missing.length > 0) fail('REQUEST_FIELD_MISSING', `DecisionLabRequestV1 is missing ${missing.join(',')}`);
  if (unknown.length > 0) fail('REQUEST_FIELD_UNKNOWN', `DecisionLabRequestV1 contains ${unknown.join(',')}`);
  if (value.schema !== 'DecisionLabRequestV1' || value.version !== 1) {
    fail('REQUEST_VERSION_INVALID', 'DecisionLabRequestV1 must be V1');
  }
  if (typeof value.requestId !== 'string' || value.requestId.trim() !== value.requestId || value.requestId.length === 0 || value.requestId.length > 256) {
    fail('REQUEST_ID_INVALID', 'DecisionLabRequestV1.requestId must be a bounded identifier');
  }
  if (!Number.isSafeInteger(value.evaluatedAtMs) || value.evaluatedAtMs < 0 || Object.is(value.evaluatedAtMs, -0)) {
    fail('EVALUATED_AT_INVALID', 'DecisionLabRequestV1.evaluatedAtMs must be an injected UTC millisecond value');
  }
  if (!['SYNTHETIC_FIXTURE', 'UNVERIFIED_RECORDED_SHAPE_FIXTURE'].includes(value.fixtureClass)) {
    fail('FIXTURE_CLASS_INVALID', 'DecisionLabRequestV1.fixtureClass must stay synthetic or explicitly unverified recorded-shape only');
  }
  return value;
}

function boundedUnique(values, minimum, maximum, identity, name) {
  if (!Array.isArray(values) || values.length < minimum || values.length > maximum) {
    fail('REQUEST_ARRAY_BOUNDS_INVALID', `${name} must contain ${minimum}..${maximum} records`);
  }
  const identities = values.map((entry) => entry?.[identity]);
  if (identities.some((value) => typeof value !== 'string' || value.length === 0)) {
    fail('REQUEST_IDENTITY_INVALID', `${name} entries require ${identity}`);
  }
  if (new Set(identities).size !== identities.length) fail('REQUEST_IDENTITY_DUPLICATE', `${name} contains duplicate ${identity}`);
}

function validateAblationCoverage(decision, ablations) {
  const qComparisons = ablations.filter((ablation) => ablation.kind === 'Q_ASSISTED_VS_MARKET_ONLY');
  const sourceRemovals = ablations
    .filter((ablation) => ablation.kind === 'REMOVE_EVIDENCE_SOURCE')
    .map((ablation) => ablation.removedRefId)
    .sort();
  const familyRemovals = ablations
    .filter((ablation) => ablation.kind === 'REMOVE_FEATURE_FAMILY')
    .map((ablation) => ablation.removedRefId)
    .sort();
  const expectedSources = decision.evidenceRefs.map((entry) => entry.ref.fixtureRecordId).sort();
  const expectedFamilies = decision.featureRefs.map((entry) => entry.featureFamilyId).sort();
  if (
    qComparisons.length !== 1
    || sha256(sourceRemovals) !== sha256(expectedSources)
    || sha256(familyRemovals) !== sha256(expectedFamilies)
  ) {
    fail('ABLATION_COVERAGE_INCOMPLETE', 'DecisionLab requires one Q-vs-market comparison and one-at-a-time removal of every evidence source and feature family');
  }
}

export function buildDecisionLabReport(input) {
  assertBoundedStructure(input, 'DecisionLabRequestV1');
  const request = exactRequest(cloneCanonical(input));
  const decision = createDecisionEnvelope(request.decision);
  if (request.evaluatedAtMs < decision.decisionTimeMs) {
    fail('EVALUATION_BEFORE_DECISION', 'DecisionLab evaluation cannot precede its immutable decision');
  }
  boundedUnique(request.alternatives, 2, MAX_ALTERNATIVES, 'alternativeId', 'DecisionLabRequestV1.alternatives');
  const alternativeContext = {
    fixtureClass: request.fixtureClass,
    canonicalDecisionRef: decision.canonicalDecisionRef,
    informationCutoffMs: decision.informationCutoffMs,
    disposition: decision.disposition,
    marketPathHash: decision.marketPathRef.fixtureIdentityHash,
    costAssumptionHash: decision.costAssumptionRef.fixtureIdentityHash,
  };
  const alternatives = request.alternatives
    .map((entry, index) => createAlternativeReference(entry, {
      ...alternativeContext,
      name: `DecisionLabRequestV1.alternatives[${index}]`,
    }))
    .sort((left, right) => left.alternativeId === right.alternativeId ? 0 : left.alternativeId < right.alternativeId ? -1 : 1);
  if (alternatives.filter((alternative) => alternative.role === 'OBSERVED_DECISION').length !== 1) {
    fail('OBSERVED_DECISION_CARDINALITY', 'one report requires exactly one observed-decision baseline');
  }
  const alternativeKinds = [...new Set(alternatives.map((alternative) => alternative.kind))].sort();
  if (sha256(alternativeKinds) !== sha256([...ALTERNATIVE_KINDS].sort())) {
    fail('ALTERNATIVE_COVERAGE_INCOMPLETE', 'one report requires all seven predeclared DecisionLab alternative kinds');
  }

  boundedUnique(request.ablations, 3, MAX_ABLATIONS, 'ablationId', 'DecisionLabRequestV1.ablations');
  const ablations = request.ablations
    .map((entry, index) => createAblationComparison(entry, {
      decision,
      fixtureClass: request.fixtureClass,
      name: `DecisionLabRequestV1.ablations[${index}]`,
    }))
    .sort((left, right) => left.ablationId === right.ablationId ? 0 : left.ablationId < right.ablationId ? -1 : 1);
  validateAblationCoverage(decision, ablations);
  assertAblationBaselineIdentity(ablations);
  const fixtureComposition = assertDecisionLabFixtureTruth({ decision, alternatives, ablations }, request.fixtureClass);
  assertRecordedReferenceBoundaries(request.fixtureClass, decision, alternatives, ablations);

  const projectedAlternatives = alternatives.map((alternative) => deepFreeze({
    ...alternative,
    comparisonStatus: alternativeComparisonStatus(alternative),
  }));
  const warnings = decisionLabWarnings(decision, projectedAlternatives, ablations);
  const core = {
    schema: 'DecisionLabReportV1',
    version: 1,
    contractVersion: '1.0.0',
    requestId: request.requestId,
    evaluatedAtMs: request.evaluatedAtMs,
    fixtureClass: request.fixtureClass,
    fixtureComposition,
    evaluationMode: 'DESCRIPTIVE_PATH_REPLAY',
    truthClass: 'ADVISORY',
    truthLabel: request.fixtureClass === 'SYNTHETIC_FIXTURE' ? 'SYNTHETIC_ONLY' : 'UNVERIFIED_RECORDED_SHAPE_ONLY',
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    canonical: false,
    decision,
    alternatives: projectedAlternatives,
    ablations,
    comparisonRules: deepFreeze({
      identicalMarketPathRequired: true,
      identicalCostAssumptionRequired: true,
      alternativesPredeclaredRequired: true,
      ownerPolicyPayloadRequiredForCounterfactualEvaluation: true,
      recordedPredeclarationEvidenceRequiredForCounterfactualEvaluation: true,
      syntheticScenarioMetadataIsTemporalEvidence: false,
      policiesEvaluatedOrSelectedByDecisionLab: false,
      postOutcomeFeatureAccessAllowed: false,
      strategyTournamentAllowed: false,
    }),
    identityProof: deepFreeze({
      marketPathHash: decision.marketPathRef.fixtureIdentityHash,
      costAssumptionHash: decision.costAssumptionRef.fixtureIdentityHash,
      alternativesWithMatchingPath: projectedAlternatives.length,
      alternativesWithMatchingCosts: projectedAlternatives.length,
      ablationsWithMatchingPathAndCosts: ablations.length,
    }),
    cutoffProof: decisionLabCutoffProof(decision),
    sourceDependenceWarnings: decisionSourceDependenceWarnings(decision),
    warnings,
    summary: deepFreeze({
      decisionDisposition: decision.disposition,
      alternativeCount: projectedAlternatives.length,
      descriptiveComparisonCount: projectedAlternatives.filter((entry) => entry.comparisonStatus === 'DESCRIPTIVE_PATH_REPLAY').length,
      unavailableAlternativeCount: projectedAlternatives.filter((entry) => entry.outcome.state === 'UNAVAILABLE').length,
      ablationCount: ablations.length,
      unavailableAblationCount: ablations.filter((entry) => entry.variant.state === 'UNAVAILABLE').length,
    }),
    alternativeAuthorityProof: decisionLabAlternativeAuthorityProof(projectedAlternatives),
    ownerBoundaryProof: deepFreeze({
      qExperimentRegistryWritten: false,
      qFeatureOrOutcomeComputed: false,
      lExecutionPolicyEvaluatorInvoked: false,
      lPolicySelected: false,
      lExchangeTwinExecuted: false,
      capitalOrRiskDecisionMade: false,
      orderIssued: false,
      externalMutationPerformed: false,
    }),
    winner: null,
    causalClaimStatus: 'NOT_IDENTIFIED',
    causalEffect: null,
    profitClaim: false,
    limitations: DECISION_LAB_LIMITATIONS,
  };
  const reportHash = sha256(core);
  const report = deepFreeze({ ...core, reportId: `dl_report_${reportHash}`, reportHash });
  validateDecisionLabReport(report, request);
  return report;
}

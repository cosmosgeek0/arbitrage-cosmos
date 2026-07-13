import {
  HAZARD_VIEW_MODEL_SCHEMA_VERSION,
  validateHazardAssurancePacket,
} from '../contracts/index.mjs';
import { evaluateFailureAtlasCoverage } from './atlas-coverage.mjs';
import { evaluateHazardAssurance } from './hazard-evaluator.mjs';

const MIN_UTC_MS = 1_262_304_000_000;
const MAX_UTC_MS = 4_102_444_800_000;

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

const cloneJson = (value) => {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJson(child)]));
  }
  return value;
};

const validClock = (nowMs) => (
  Number.isSafeInteger(nowMs) && nowMs >= MIN_UTC_MS && nowMs <= MAX_UTC_MS
);
const stableUnique = (values) => [...new Set(values)].sort();
const combineStatus = (statuses) => {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('UNKNOWN')) return 'UNKNOWN';
  return 'PASS';
};
const attentionFor = (status) => status !== 'PASS';

function buildInvalidView(nowMs, hazardEvaluation, atlasEvaluation, packetIssues) {
  const reasonCodes = stableUnique([
    'PACKET_INVALID',
    ...hazardEvaluation.reasonCodes,
    ...atlasEvaluation.reasonCodes,
    ...packetIssues.map((entry) => entry.code),
  ]);
  const annunciators = [
    ['PA-S1-ANN-ASSUMPTIONS', 'Capital-critical assumption registry', 'assumptions'],
    ['PA-S1-ANN-LOSSES', 'Unacceptable-loss family projection', 'hazards'],
    ['PA-S1-ANN-ATLAS', 'Expected Failure Atlas denominator', 'atlas'],
  ].map(([annunciatorId, label, drillDownTarget]) => ({
    annunciatorId,
    label,
    status: 'UNKNOWN',
    attentionRequired: true,
    reasonCodes,
    drillDownTarget,
  }));

  return deepFreeze({
    schemaVersion: HAZARD_VIEW_MODEL_SCHEMA_VERSION,
    truthLabel: 'SYNTHETIC_ONLY',
    evaluatedAtMs: validClock(nowMs) ? nowMs : null,
    assuranceProjectionStatus: 'UNKNOWN',
    authorityEffect: 'NONE',
    machineResponseOwner: 'CANONICAL_I00_DOMAIN_OWNERS',
    summary: {
      activeHazardCount: 0,
      capitalCriticalHazardCount: 0,
      unacceptableLossFamilyCount: 0,
      referencedRequiredLossFamilyCount: 0,
      assumptionCount: 0,
      passingAssumptionCount: 0,
      failingAssumptionCount: 0,
      unknownAssumptionCount: 0,
      invalidatedConsumerCount: 0,
      atlasExpectedCount: 0,
      atlasCoveredCount: 0,
      atlasCoveragePercent: null,
      atlasReviewState: 'UNKNOWN',
    },
    annunciators,
    hazards: [],
    assumptions: [],
    atlas: {
      status: 'UNKNOWN',
      sourceBasis: 'EXPECTED_RELEASE_MANIFEST',
      reviewState: 'UNKNOWN',
      liveOperationClasses: cloneJson(atlasEvaluation.liveOperationClasses ?? []),
      requiredFailureFamilyIds: cloneJson(atlasEvaluation.requiredFailureFamilyIds ?? []),
      expectedCount: 0,
      coveredCount: 0,
      coveragePercent: null,
      missingDecisionPairs: [],
      missingAtlasPairs: [],
      duplicateAtlasPairs: [],
      unexpectedAtlasPairs: [],
      operationCoverage: [],
      failureFamilyCoverage: [],
      truthLabel: 'SYNTHETIC_ONLY',
    },
  });
}

export function buildHazardAssuranceViewModel(packet, nowMs) {
  const hazardEvaluation = evaluateHazardAssurance(packet, nowMs);
  const atlasEvaluation = evaluateFailureAtlasCoverage(packet, nowMs);
  const packetIssues = validateHazardAssurancePacket(packet);
  const structuralIssues = packetIssues.filter((entry) => (
    entry.code === 'PLAIN_JSON_REQUIRED' || entry.code.startsWith('SCHEMA_')
  ));
  if (structuralIssues.length > 0) {
    return buildInvalidView(nowMs, hazardEvaluation, atlasEvaluation, structuralIssues);
  }

  const lossFamilyById = new Map(packet.unacceptableLossFamilies.map((family) => [family.lossId, family]));
  const hazardResultById = new Map(hazardEvaluation.hazardResults.map((result) => [result.hazardId, result]));
  const assumptionResultById = new Map(hazardEvaluation.assumptionResults.map((result) => [result.assumptionId, result]));
  const lossCoverageStatus = hazardEvaluation.reasonCodes.includes('PACKET_INVALID')
    ? 'UNKNOWN'
    : hazardEvaluation.lossFamilyCoverage.uncoveredLossFamilyIds.length === 0 ? 'PASS' : 'FAIL';
  const overallStatus = combineStatus([
    hazardEvaluation.status,
    lossCoverageStatus,
    atlasEvaluation.status,
  ]);

  const hazards = packet.hazards
    .filter((hazard) => hazard.active)
    .map((hazard) => {
      const evaluation = hazardResultById.get(hazard.hazardId);
      return deepFreeze({
        hazardId: hazard.hazardId,
        title: hazard.title,
        status: evaluation?.status ?? 'UNKNOWN',
        capitalCritical: hazard.capitalCritical,
        unsafeControlActionKind: hazard.unsafeControlAction.kind,
        unsafeControlAction: hazard.unsafeControlAction.controlAction,
        triggeringContext: hazard.triggeringContext,
        causalScenario: hazard.causalScenario,
        unacceptableLosses: hazard.unacceptableLossIds.map((lossId) => ({
          lossId,
          label: lossFamilyById.get(lossId)?.label ?? null,
        })),
        affectedBoundaries: [...hazard.affectedBoundaries].sort(),
        canonicalOwnerIds: hazard.canonicalOwners.map((owner) => owner.ownerId).sort(),
        containmentRecoveryOwnerId: hazard.containmentRecoveryOwner.ownerId,
        assumptionIds: [...hazard.assumptionIds].sort(),
        detection: {
          detectorId: hazard.detection.detectorId,
          detectionSloMs: hazard.detection.detectionSloMs,
        },
        proof: cloneJson(hazard.proof),
        cockpitProjection: cloneJson(hazard.cockpitProjection),
        residualRisk: hazard.residualRisk,
        ownerDisposition: cloneJson(hazard.ownerDisposition),
        truthLabel: 'SYNTHETIC_ONLY',
      });
    })
    .sort((left, right) => left.hazardId.localeCompare(right.hazardId));

  const assumptions = packet.assumptions
    .map((assumption) => {
      const result = assumptionResultById.get(assumption.assumptionId);
      return deepFreeze({
        assumptionId: assumption.assumptionId,
        statement: assumption.statement,
        scope: assumption.scope,
        canonicalOwnerId: assumption.canonicalOwner.ownerId,
        capitalCritical: assumption.capitalCritical,
        result: result?.result ?? 'UNKNOWN',
        reasonCode: result?.reasonCode ?? 'MISSING',
        freshnessStatus: result?.freshnessStatus ?? (validClock(nowMs) ? 'INCOHERENT' : 'CLOCK_INVALID'),
        ageMs: result?.ageMs ?? null,
        staleAtMs: result?.staleAtMs ?? null,
        evidenceIds: [...assumption.evidenceIds].sort(),
        dependentHazardIds: [...assumption.dependents.hazardIds].sort(),
        dependentClaimIds: [...assumption.dependents.claimIds].sort(),
        requiredOwnerResponse: assumption.requiredOwnerResponse,
        residualRisk: assumption.residualRisk,
        truthLabel: 'SYNTHETIC_ONLY',
      });
    })
    .sort((left, right) => left.assumptionId.localeCompare(right.assumptionId));

  const annunciators = [
    {
      annunciatorId: 'PA-S1-ANN-ASSUMPTIONS',
      label: 'Capital-critical assumption registry',
      status: hazardEvaluation.status,
      attentionRequired: attentionFor(hazardEvaluation.status),
      reasonCodes: hazardEvaluation.reasonCodes,
      drillDownTarget: 'assumptions',
    },
    {
      annunciatorId: 'PA-S1-ANN-LOSSES',
      label: 'Unacceptable-loss family projection',
      status: lossCoverageStatus,
      attentionRequired: attentionFor(lossCoverageStatus),
      reasonCodes: lossCoverageStatus === 'PASS'
        ? ['ALL_REQUIRED_LOSS_FAMILIES_REFERENCED']
        : lossCoverageStatus === 'FAIL'
          ? ['UNACCEPTABLE_LOSS_FAMILY_COVERAGE_FAILURE']
          : ['PACKET_INVALID'],
      drillDownTarget: 'hazards',
    },
    {
      annunciatorId: 'PA-S1-ANN-ATLAS',
      label: 'Expected Failure Atlas denominator',
      status: atlasEvaluation.status,
      attentionRequired: attentionFor(atlasEvaluation.status),
      reasonCodes: atlasEvaluation.reasonCodes,
      drillDownTarget: 'atlas',
    },
  ];

  return deepFreeze({
    schemaVersion: HAZARD_VIEW_MODEL_SCHEMA_VERSION,
    truthLabel: 'SYNTHETIC_ONLY',
    evaluatedAtMs: validClock(nowMs) ? nowMs : null,
    assuranceProjectionStatus: overallStatus,
    authorityEffect: 'NONE',
    machineResponseOwner: 'CANONICAL_I00_DOMAIN_OWNERS',
    summary: {
      activeHazardCount: hazards.length,
      capitalCriticalHazardCount: hazards.filter((hazard) => hazard.capitalCritical).length,
      unacceptableLossFamilyCount: lossFamilyById.size,
      referencedRequiredLossFamilyCount: hazardEvaluation.lossFamilyCoverage.requiredLossFamilyIds.length
        - hazardEvaluation.lossFamilyCoverage.uncoveredLossFamilyIds.length,
      assumptionCount: assumptions.length,
      passingAssumptionCount: assumptions.filter((assumption) => assumption.result === 'PASS').length,
      failingAssumptionCount: assumptions.filter((assumption) => assumption.result === 'FAIL').length,
      unknownAssumptionCount: assumptions.filter((assumption) => assumption.result === 'UNKNOWN').length,
      invalidatedConsumerCount: hazardEvaluation.invalidatedConsumers.length,
      atlasExpectedCount: atlasEvaluation.expectedCount,
      atlasCoveredCount: atlasEvaluation.coveredCount,
      atlasCoveragePercent: atlasEvaluation.coveragePercent,
      atlasReviewState: atlasEvaluation.reviewState,
    },
    annunciators,
    hazards,
    assumptions,
    atlas: {
      status: atlasEvaluation.status,
      sourceBasis: atlasEvaluation.sourceBasis,
      reviewState: atlasEvaluation.reviewState,
      liveOperationClasses: cloneJson(atlasEvaluation.liveOperationClasses),
      requiredFailureFamilyIds: cloneJson(atlasEvaluation.requiredFailureFamilyIds),
      expectedCount: atlasEvaluation.expectedCount,
      coveredCount: atlasEvaluation.coveredCount,
      coveragePercent: atlasEvaluation.coveragePercent,
      missingDecisionPairs: cloneJson(atlasEvaluation.missingDecisionPairs),
      missingAtlasPairs: cloneJson(atlasEvaluation.missingAtlasPairs),
      duplicateAtlasPairs: cloneJson(atlasEvaluation.duplicateAtlasPairs),
      unexpectedAtlasPairs: cloneJson(atlasEvaluation.unexpectedAtlasPairs),
      operationCoverage: cloneJson(atlasEvaluation.operationCoverage),
      failureFamilyCoverage: cloneJson(atlasEvaluation.failureFamilyCoverage),
      truthLabel: 'SYNTHETIC_ONLY',
    },
  });
}

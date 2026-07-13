import { createHash } from 'node:crypto';
import {
  bindEvidenceTuple,
} from '../../dist/productAssurance/index.js';

export const NOW = 1_783_900_800_000;

export function digest(label) {
  return createHash('sha256').update(String(label)).digest('hex');
}

export function evidence(label, overrides = {}) {
  return Object.freeze({
    evidenceId: `EVIDENCE_${label}`,
    ownerId: 'SYSTEM_INTEGRATION',
    sourcePath: `fixtures/productAssurance/fixtures-root/${label}.json`,
    observedAtMs: NOW - 1_000,
    expiresAtMs: NOW + 60_000,
    truthLabel: 'LIVE_PUBLIC',
    digest: digest(`evidence:${label}`),
    producerId: `PRODUCER_${label}`,
    verifierId: `VERIFIER_${label}`,
    ...overrides,
  });
}

export function invariantFacts(
  definitions,
  overrides = new Map(),
  releaseId = 'IP_ASSURANCE_TEST_RELEASE',
  testedCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
) {
  const factIds = [...new Set(definitions.flatMap((definition) => definition.factIds))].sort();
  const ownerByFactId = new Map(definitions.flatMap((definition) => definition.factIds.map((factId) => [factId, definition.factOwnerIds[factId]])));
  const invariantByFactId = new Map(definitions.flatMap((definition) => definition.factIds.map((factId) => [factId, definition.invariantId])));
  return Object.freeze(factIds.map((factId, index) => {
    const factEvidence = evidence(`FACT_${index}`, {
      ownerId: ownerByFactId.get(factId),
      producerId: `FACT_PRODUCER_${index}`,
      verifierId: `FACT_VERIFIER_${index}`,
    });
    return Object.freeze({
      factId,
      value: overrides.has(factId) ? overrides.get(factId) : true,
      evidence: factEvidence,
      evidenceBinding: bindEvidenceTuple({
        ownerId: ownerByFactId.get(factId),
        releaseId,
        testedCommit,
        subjectId: `INVARIANT:${invariantByFactId.get(factId)}:FACT:${factId}`,
        evidenceDigest: factEvidence.digest,
      }),
    });
  }));
}

export function campaign(overrides = {}) {
  const createdAtMs = overrides.createdAtMs ?? NOW;
  const updatedAtMs = overrides.updatedAtMs ?? createdAtMs;
  const state = overrides.state ?? 'DETECTED';
  const localAttempt = overrides.localAttempt ?? 0;
  const globalAttempt = overrides.globalAttempt ?? 0;
  const inProgressAttempt = state === 'EXECUTING' ? Object.freeze({
    attemptId: 'ATTEMPT_HELPER_ACTIVE',
    causeEvidenceIds: Object.freeze(['EVIDENCE_SEQUENCE_GAP']),
    policyRevision: 'REMEDIATION_POLICY_V1',
    localAttempt: Math.max(1, localAttempt),
    globalAttempt: Math.max(1, globalAttempt),
    startedAtMs: updatedAtMs,
    completedAtMs: null,
    beforeState: 'SEQUENCE_GAP',
    action: 'RESNAPSHOT_SEQUENCE_GAP',
    afterState: null,
    result: 'IN_PROGRESS',
    nextRetryAtMs: null,
    circuitState: 'CLOSED',
    costUnits: 0,
    concurrencyUnits: 1,
    materialEventRef: 'MATERIAL_EVENT_CAMPAIGN_001',
    cockpitTraceId: 'TRACE_CAMPAIGN_001',
  }) : null;
  return Object.freeze({
    schema: 'PRODUCT_ASSURANCE_REMEDIATION_CAMPAIGN_V1',
    revision: 1,
    campaignId: 'CAMPAIGN_001',
    fingerprint: 'FINGERPRINT_STREAM_GAP',
    policyRevision: 'REMEDIATION_POLICY_V1',
    action: 'RESNAPSHOT_SEQUENCE_GAP',
    state,
    desiredState: 'CONTINUOUS',
    observedState: 'SEQUENCE_GAP',
    lastKnownGoodState: 'CONTINUOUS',
    allowedDegradedState: 'BLOCK_NEW_EXPOSURE',
    dependencyIds: Object.freeze(['DEP_PUBLIC_SPOT_TO_UNIVERSE']),
    invariantIds: Object.freeze(['INV_SOURCE_FRESHNESS_COMPLETENESS_CONTINUITY']),
    triggerEvidenceIds: Object.freeze(['EVIDENCE_SEQUENCE_GAP']),
    diagnosticConfidence: null,
    preconditionIds: Object.freeze(['PRECONDITION_SOURCE_OWNER_BOUND']),
    resourceIds: Object.freeze(['RESOURCE_PUBLIC_SPOT_STREAM']),
    capitalPosture: 'NO_NEW_EXPOSURE',
    predictedResult: 'SOURCE_CONTINUITY_RESTORED',
    actionIdentity: 'ACTION_RESNAPSHOT_SOURCE_001',
    fencingOwnerId: 'REMEDIATION_OWNER_001',
    leaseEpoch: 7,
    localAttempt,
    maximumLocalAttempts: 2,
    globalAttempt,
    maximumGlobalAttempts: 3,
    elapsedMs: updatedAtMs - createdAtMs,
    maximumElapsedMs: 120_000,
    costUnits: 0,
    maximumCostUnits: 10,
    concurrencyUnits: inProgressAttempt === null ? 0 : 1,
    maximumConcurrencyUnits: 1,
    rollbackAction: 'RESTORE_LAST_KNOWN_GOOD_STREAM',
    compensationAction: 'QUARANTINE_SOURCE',
    independentVerifierId: 'REMEDIATION_VERIFIER_001',
    postconditionIds: Object.freeze(['POSTCONDITION_CONTINUITY', 'POSTCONDITION_SENTINEL']),
    provedPostconditionIds: Object.freeze([]),
    verifiedAtMs: null,
    quietPeriodMs: 5_000,
    nextRetryAtMs: null,
    materialEventRef: 'MATERIAL_EVENT_CAMPAIGN_001',
    cockpitTraceId: 'TRACE_CAMPAIGN_001',
    attemptRecords: Object.freeze(inProgressAttempt === null ? [] : [inProgressAttempt]),
    createdAtMs,
    updatedAtMs,
    ...overrides,
  });
}

export function campaignLeases(campaignValue, overrides = {}) {
  return Object.freeze(campaignValue.resourceIds.map((resourceId) => Object.freeze({
    resourceId,
    campaignId: campaignValue.campaignId,
    ownerId: campaignValue.fencingOwnerId,
    epoch: campaignValue.leaseEpoch,
    acquiredAtMs: campaignValue.createdAtMs,
    expiresAtMs: campaignValue.createdAtMs + 300_000,
    ...overrides,
  })));
}

export function stepCampaign(campaignValue, leases, kind, offsetMs, extra = {}) {
  return Object.freeze({
    kind,
    atMs: NOW + offsetMs,
    ownerId: campaignValue.fencingOwnerId,
    leaseEpoch: campaignValue.leaseEpoch,
    ...(kind === 'EXECUTE' ? {
      attemptId: `ATTEMPT_${campaignValue.revision + 1}`,
      costUnits: 1,
      concurrencyUnits: 1,
      circuitState: 'CLOSED',
    } : {}),
    ...(kind === 'ACTION_COMPLETED' ? {
      afterState: 'CONTINUOUS',
      result: 'SUCCEEDED',
      nextRetryAtMs: null,
      materialEventRef: `MATERIAL_EVENT_${campaignValue.revision + 1}`,
    } : {}),
    ...extra,
  });
}

import {
  ACCEPTED_S1_SOURCE,
  ASSURANCE_CASE_PROPAGATION_POLICY,
  ASSURANCE_CASE_SCHEMA_VERSION,
  MANDATORY_CLAIM_DRILL_DOWN,
  MANDATORY_CLAIM_REQUIREMENTS,
  MANDATORY_CLAIM_VALIDATOR,
  REQUIRED_MANDATORY_CLAIM_IDS,
  REQUIRED_ROOT_CLAIM_IDS,
  SAFE_EVENT_RECOMMENDATION_TYPE,
  SAFE_INCIDENT_RECOMMENDATION_TYPE,
  canonicalEvidenceStatement,
  clonePlainData,
  deepFreeze,
} from '../contracts/index.mjs';
import { FIXTURE_NOW_MS } from './s1-accepted-projection.mjs';

const domain = (className, id) => ({ class: className, id });
const failureDomains = (leg, number) => [
  domain('CLOCK', `${leg}-CLOCK-${number}`),
  domain('STORE', `${leg}-STORE-${number}`),
  domain('NETWORK', `${leg}-NETWORK-${number}`),
  domain('CREDENTIAL', `${leg}-CREDENTIAL-${number}`),
  domain('CODE_PATH', `${leg}-CODE-${number}`),
  domain('TELEMETRY_EXPORTER', `${leg}-EXPORTER-${number}`),
  domain('MODEL_FAMILY', `${leg}-MODEL-${number}`),
  domain('PROCESS', `${leg}-PROCESS-${number}`),
  domain('HOST', `${leg}-HOST-${number}`),
  domain('ORGANIZATION', `${leg}-ORG-${number}`),
];

const evidenceFor = (requirement, position) => {
  const number = String(position + 1).padStart(3, '0');
  const purpose = position === 12 ? 'DIAGNOSTIC_POSTURE' : 'CLAIM_SUPPORT';
  const claimBinding = {
    claimId: requirement.claimId,
    requirementKey: requirement.requirementKey,
    scope: requirement.scope,
  };
  return {
    evidenceId: `PA-S4-EVIDENCE-${number}`,
    role: 'SUPPORT',
    purpose,
    kind: requirement.requiredEvidenceKind,
    statement: canonicalEvidenceStatement({ purpose, claimBinding }),
    claimBinding,
    capitalCritical: true,
    result: 'PASS',
    reasonCode: 'SOURCE_PASS_CURRENT_INDEPENDENT_SUPPORT',
    sourceIdentity: {
      sourceId: `PA-S4-SOURCE-${number}`,
      sourceType: requirement.requiredEvidenceKind,
      revision: `PA-S4-SOURCE-REV-${number}`,
      digest: `sha256:${String(position + 1).padStart(64, '0')}`,
    },
    createdAtMs: FIXTURE_NOW_MS - 60_000,
    lastVerifiedAtMs: FIXTURE_NOW_MS - 1_000,
    maximumAgeMs: 10_000,
    expiresAtMs: FIXTURE_NOW_MS + 20_000,
    validator: {
      validatorId: `PA-S4-VALIDATOR-${number}`,
      version: 'PA-S4-VALIDATOR-V1',
    },
    producer: {
      actorId: `PA-S4-PRODUCER-${number}`,
      ownerId: requirement.canonicalOwner.ownerId,
      failureDomains: failureDomains('PRODUCER', number),
    },
    verifier: {
      actorId: `PA-S4-VERIFIER-${number}`,
      ownerId: `IP-ASSURANCE.independent-verifier-${number}`,
      failureDomains: failureDomains('VERIFIER', number),
    },
    independence: {
      required: true,
      declaredClass: position === 11 ? 'OUT_OF_BAND' : 'TECHNICAL_AND_OPERATIONAL',
      commonModeDependencyIds: [],
      basisEvidenceIds: [`PA-S4-INDEPENDENCE-BASIS-${number}`],
    },
    derivedFromClaimIds: [],
    derivedFromEvidenceIds: [],
    certifiesEvidenceIds: [],
  };
};

const independenceBasisFor = (requirement, position) => {
  const number = String(position + 1).padStart(3, '0');
  const purpose = 'INDEPENDENCE_BASIS';
  const claimBinding = {
    claimId: requirement.claimId,
    requirementKey: requirement.requirementKey,
    scope: requirement.scope,
  };
  return {
    evidenceId: `PA-S4-INDEPENDENCE-BASIS-${number}`,
    role: 'SUPPORT',
    purpose,
    kind: 'OWNER_AUTHORIZATION',
    statement: canonicalEvidenceStatement({ purpose, claimBinding }),
    claimBinding,
    capitalCritical: false,
    result: 'PASS',
    reasonCode: 'SOURCE_PASS_INDEPENDENCE_BASIS_CURRENT',
    sourceIdentity: {
      sourceId: `PA-S4-INDEPENDENCE-SOURCE-${number}`,
      sourceType: 'OWNER_AUTHORIZATION',
      revision: `PA-S4-INDEPENDENCE-REV-${number}`,
      digest: `sha256:${String(position + 101).padStart(64, '0')}`,
    },
    createdAtMs: FIXTURE_NOW_MS - 60_000,
    lastVerifiedAtMs: FIXTURE_NOW_MS - 1_000,
    maximumAgeMs: 10_000,
    expiresAtMs: FIXTURE_NOW_MS + 20_000,
    validator: {
      validatorId: `PA-S4-INDEPENDENCE-VALIDATOR-${number}`,
      version: 'PA-S4-INDEPENDENCE-VALIDATOR-V1',
    },
    producer: {
      actorId: `PA-S4-INDEPENDENCE-PRODUCER-${number}`,
      ownerId: requirement.canonicalOwner.ownerId,
      failureDomains: failureDomains('BASIS-PRODUCER', number),
    },
    verifier: {
      actorId: `PA-S4-INDEPENDENCE-VERIFIER-${number}`,
      ownerId: `IP-ASSURANCE.independence-contract-verifier-${number}`,
      failureDomains: failureDomains('BASIS-VERIFIER', number),
    },
    independence: {
      required: false,
      declaredClass: 'TECHNICAL',
      commonModeDependencyIds: [],
      basisEvidenceIds: [],
    },
    derivedFromClaimIds: [],
    derivedFromEvidenceIds: [],
    certifiesEvidenceIds: [`PA-S4-EVIDENCE-${number}`],
  };
};

const claimFor = (requirement, position) => {
  const number = String(position + 1).padStart(3, '0');
  return {
    claimId: requirement.claimId,
    requirementKey: requirement.requirementKey,
    statement: requirement.statement,
    scope: requirement.scope,
    canonicalOwner: requirement.canonicalOwner,
    resultConsumerOwner: requirement.resultConsumerOwner,
    capitalCritical: true,
    subclaimIds: requirement.requiredSubclaimIds,
    assumptionIds: requirement.requiredAssumptionIds,
    supportingEvidenceIds: [`PA-S4-EVIDENCE-${number}`],
    counterEvidenceIds: [],
    validator: MANDATORY_CLAIM_VALIDATOR,
    propagationSloMs: ASSURANCE_CASE_PROPAGATION_POLICY.propagationSloMs,
    assuranceSloMs: ASSURANCE_CASE_PROPAGATION_POLICY.assuranceSloMs,
    invariantProjection: {
      invariantId: `PA-S4-INVARIANT-${number}`,
      eventRecommendationType: SAFE_EVENT_RECOMMENDATION_TYPE,
      incidentRecommendationType: SAFE_INCIDENT_RECOMMENDATION_TYPE,
    },
    cockpitProjection: {
      surface: requirement.cockpitSurface,
      summaryField: requirement.requirementKey,
      drillDown: MANDATORY_CLAIM_DRILL_DOWN,
    },
    componentDrillDown: [{
      componentId: `PA-S4-COMPONENT-${number}`,
      componentScope: requirement.scope,
      canonicalOwnerId: requirement.canonicalOwner.ownerId,
      supportingEvidenceIds: [`PA-S4-EVIDENCE-${number}`],
    }],
    missingDataBehavior: 'UNKNOWN',
  };
};

export function buildCompleteAssuranceCaseFixture({
  claimOverrides = {},
  evidenceOverrides = {},
  packetOverrides = {},
} = {}) {
  const claims = MANDATORY_CLAIM_REQUIREMENTS.map((requirement, position) => ({
    ...claimFor(requirement, position),
    ...(claimOverrides[requirement.claimId] ?? {}),
  }));
  const primaryEvidence = MANDATORY_CLAIM_REQUIREMENTS.map((requirement, position) => {
    const base = evidenceFor(requirement, position);
    return { ...base, ...(evidenceOverrides[base.evidenceId] ?? {}) };
  });
  const basisEvidence = MANDATORY_CLAIM_REQUIREMENTS.map((requirement, position) => {
    const base = independenceBasisFor(requirement, position);
    return { ...base, ...(evidenceOverrides[base.evidenceId] ?? {}) };
  });
  const packet = {
    schemaVersion: ASSURANCE_CASE_SCHEMA_VERSION,
    graphId: 'PA-S4-GRAPH-001',
    revision: 'PA-S4-GRAPH-REV-001',
    releaseId: 'PA-S4-SYNTHETIC-RELEASE-001',
    truthLabel: 'SYNTHETIC_ONLY',
    authorityEffect: 'NONE',
    generatedAtMs: FIXTURE_NOW_MS,
    rootClaimIds: [...REQUIRED_ROOT_CLAIM_IDS],
    mandatoryClaimIds: [...REQUIRED_MANDATORY_CLAIM_IDS],
    s1SourceRequirement: ACCEPTED_S1_SOURCE,
    propagationPolicy: ASSURANCE_CASE_PROPAGATION_POLICY,
    diagnosticPlane: {
      posture: 'NOT_CONFIGURED',
      postureEvidenceIds: ['PA-S4-EVIDENCE-013'],
      containmentEvidenceIds: [],
      permissionEvidenceIds: [],
      providerOutageEvidenceIds: [],
      privacyEvidenceIds: [],
      independentEvidenceIds: [],
    },
    claims,
    evidence: [...primaryEvidence, ...basisEvidence],
    ...packetOverrides,
  };
  return deepFreeze(packet);
}

export const COMPLETE_ASSURANCE_CASE_FIXTURE = buildCompleteAssuranceCaseFixture();

export function mutableAssuranceCaseFixture() {
  return clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
}

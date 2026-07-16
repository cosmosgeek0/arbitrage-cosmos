import { canonicalEvidenceStatement, clonePlainData, deepFreeze } from '../contracts/index.mjs';
import { mutableAssuranceCaseFixture } from './baseline.mjs';
import {
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  FIXTURE_NOW_MS,
  buildS1AssumptionProjection,
} from './s1-accepted-projection.mjs';

const mutatePacket = (mutator) => {
  const packet = mutableAssuranceCaseFixture();
  mutator(packet);
  return deepFreeze(packet);
};

const evidenceById = (packet, evidenceId) => packet.evidence.find((entry) => entry.evidenceId === evidenceId);
const claimById = (packet, claimId) => packet.claims.find((entry) => entry.claimId === claimId);

export const buildExpiredEvidenceFixture = (evidenceId = 'PA-S4-EVIDENCE-004') => mutatePacket((packet) => {
  evidenceById(packet, evidenceId).expiresAtMs = FIXTURE_NOW_MS;
});

export const buildMaxAgeBoundaryFixture = (evidenceId = 'PA-S4-EVIDENCE-004') => mutatePacket((packet) => {
  const evidence = evidenceById(packet, evidenceId);
  evidence.lastVerifiedAtMs = FIXTURE_NOW_MS - evidence.maximumAgeMs;
  evidence.expiresAtMs = FIXTURE_NOW_MS + 60_000;
});

export const buildSelfVerifiedEvidenceFixture = (evidenceId = 'PA-S4-EVIDENCE-004') => mutatePacket((packet) => {
  const evidence = evidenceById(packet, evidenceId);
  evidence.verifier.actorId = evidence.producer.actorId;
});

export const buildSameOwnerEvidenceFixture = (evidenceId = 'PA-S4-EVIDENCE-005') => mutatePacket((packet) => {
  const evidence = evidenceById(packet, evidenceId);
  evidence.verifier.ownerId = evidence.producer.ownerId;
});

export const buildCommonModeEvidenceFixture = (evidenceId = 'PA-S4-EVIDENCE-004') => mutatePacket((packet) => {
  const evidence = evidenceById(packet, evidenceId);
  evidence.verifier.failureDomains[0] = clonePlainData(evidence.producer.failureDomains[0]);
});

export const buildDeclaredCommonModeFixture = (evidenceId = 'PA-S4-EVIDENCE-004') => mutatePacket((packet) => {
  evidenceById(packet, evidenceId).independence.commonModeDependencyIds = ['SHARED-TELEMETRY-EXPORTER-001'];
});

export const buildExpiredIndependenceBasisFixture = (evidenceId = 'PA-S4-EVIDENCE-004') => mutatePacket((packet) => {
  const evidence = evidenceById(packet, evidenceId);
  evidenceById(packet, evidence.independence.basisEvidenceIds[0]).expiresAtMs = FIXTURE_NOW_MS;
});

export const buildSelfCertifiedIndependenceFixture = (evidenceId = 'PA-S4-EVIDENCE-004') => mutatePacket((packet) => {
  evidenceById(packet, evidenceId).independence.basisEvidenceIds = [evidenceId];
});

export const buildFailureDomainCoverageGapFixture = (evidenceId = 'PA-S4-EVIDENCE-004') => mutatePacket((packet) => {
  const evidence = evidenceById(packet, evidenceId);
  evidence.verifier.failureDomains = evidence.verifier.failureDomains.filter((domain) => domain.class !== 'CODE_PATH');
});

export const buildFailedEvidenceFixture = (evidenceId = 'PA-S4-EVIDENCE-004') => mutatePacket((packet) => {
  const evidence = evidenceById(packet, evidenceId);
  evidence.result = 'FAIL';
  evidence.reasonCode = 'SOURCE_FAIL_COUNTEREVIDENCE_CONFIRMED';
});

export const buildCounterevidenceFixture = (result = 'FAIL') => mutatePacket((packet) => {
  const counterevidence = clonePlainData(evidenceById(packet, 'PA-S4-EVIDENCE-004'));
  const basis = clonePlainData(evidenceById(packet, 'PA-S4-INDEPENDENCE-BASIS-004'));
  counterevidence.evidenceId = 'PA-S4-COUNTEREVIDENCE-004';
  counterevidence.role = 'COUNTERCHECK';
  counterevidence.statement = canonicalEvidenceStatement(counterevidence);
  counterevidence.result = result;
  counterevidence.reasonCode = result === 'FAIL'
    ? 'SOURCE_FAIL_MISSING_SIGNAL_CONFIRMED'
    : result === 'PASS'
      ? 'SOURCE_PASS_NO_COUNTEREVIDENCE_FOUND'
      : 'SOURCE_UNKNOWN_COUNTEREVIDENCE_STATUS';
  counterevidence.sourceIdentity = {
    sourceId: 'PA-S4-COUNTER-SOURCE-004',
    sourceType: 'TELEMETRY_COVERAGE',
    revision: 'PA-S4-COUNTER-REV-004',
    digest: `sha256:${'f'.repeat(64)}`,
  };
  counterevidence.producer.actorId = 'PA-S4-COUNTER-PRODUCER-004';
  counterevidence.verifier.actorId = 'PA-S4-COUNTER-VERIFIER-004';
  counterevidence.verifier.ownerId = 'PA-S4-COUNTER-VERIFIER-OWNER-004';
  counterevidence.validator = {
    validatorId: 'PA-S4-COUNTER-VALIDATOR-004',
    version: 'PA-S4-COUNTER-VALIDATOR-004-V1',
  };
  counterevidence.producer.failureDomains = counterevidence.producer.failureDomains.map((domain) => ({
    ...domain,
    id: `PA-S4-COUNTER-PRODUCER-004-${domain.class}`,
  }));
  counterevidence.verifier.failureDomains = counterevidence.verifier.failureDomains.map((domain) => ({
    ...domain,
    id: `PA-S4-COUNTER-VERIFIER-004-${domain.class}`,
  }));
  counterevidence.derivedFromEvidenceIds = ['PA-S4-EVIDENCE-004'];
  basis.evidenceId = 'PA-S4-COUNTEREVIDENCE-BASIS-004';
  basis.statement = canonicalEvidenceStatement(basis);
  basis.sourceIdentity.sourceId = 'PA-S4-COUNTER-BASIS-SOURCE-004';
  basis.sourceIdentity.revision = 'PA-S4-COUNTER-BASIS-REV-004';
  basis.sourceIdentity.digest = `sha256:${'e'.repeat(64)}`;
  basis.producer.actorId = 'PA-S4-COUNTER-BASIS-PRODUCER-004';
  basis.verifier.actorId = 'PA-S4-COUNTER-BASIS-VERIFIER-004';
  basis.verifier.ownerId = 'PA-S4-COUNTER-BASIS-VERIFIER-OWNER-004';
  basis.validator = {
    validatorId: 'PA-S4-COUNTER-BASIS-VALIDATOR-004',
    version: 'PA-S4-COUNTER-BASIS-VALIDATOR-004-V1',
  };
  basis.producer.failureDomains = basis.producer.failureDomains.map((domain) => ({
    ...domain,
    id: `PA-S4-COUNTER-BASIS-PRODUCER-004-${domain.class}`,
  }));
  basis.verifier.failureDomains = basis.verifier.failureDomains.map((domain) => ({
    ...domain,
    id: `PA-S4-COUNTER-BASIS-VERIFIER-004-${domain.class}`,
  }));
  basis.certifiesEvidenceIds = [counterevidence.evidenceId];
  counterevidence.independence.basisEvidenceIds = [basis.evidenceId];
  packet.evidence.push(counterevidence, basis);
  claimById(packet, 'PA-S4-CLAIM-004').counterEvidenceIds = [counterevidence.evidenceId];
});

export const buildStaleFailedEvidenceFixture = (evidenceId = 'PA-S4-EVIDENCE-004') => mutatePacket((packet) => {
  const evidence = evidenceById(packet, evidenceId);
  evidence.result = 'FAIL';
  evidence.reasonCode = 'SOURCE_FAIL_COUNTEREVIDENCE_CONFIRMED';
  evidence.expiresAtMs = FIXTURE_NOW_MS;
  evidence.verifier.actorId = evidence.producer.actorId;
});

export const buildMissingEvidenceReferenceFixture = () => mutatePacket((packet) => {
  claimById(packet, 'PA-S4-CLAIM-004').supportingEvidenceIds = ['PA-S4-EVIDENCE-MISSING'];
  claimById(packet, 'PA-S4-CLAIM-004').componentDrillDown[0].supportingEvidenceIds = ['PA-S4-EVIDENCE-MISSING'];
  packet.evidence = packet.evidence.filter((entry) => ![
    'PA-S4-EVIDENCE-004',
    'PA-S4-INDEPENDENCE-BASIS-004',
  ].includes(entry.evidenceId));
});

export const buildClaimCycleFixture = () => mutatePacket((packet) => {
  claimById(packet, 'PA-S4-CLAIM-004').subclaimIds = ['PA-S4-CLAIM-001'];
});

export const buildEvidenceCycleFixture = () => mutatePacket((packet) => {
  evidenceById(packet, 'PA-S4-EVIDENCE-004').derivedFromClaimIds = ['PA-S4-CLAIM-004'];
});

export const buildDerivedEvidenceExpiryFixture = () => mutatePacket((packet) => {
  evidenceById(packet, 'PA-S4-EVIDENCE-004').expiresAtMs = FIXTURE_NOW_MS;
  evidenceById(packet, 'PA-S4-EVIDENCE-010').derivedFromEvidenceIds = ['PA-S4-EVIDENCE-004'];
});

export const buildDerivedClaimExpiryFixture = () => mutatePacket((packet) => {
  evidenceById(packet, 'PA-S4-EVIDENCE-004').expiresAtMs = FIXTURE_NOW_MS;
  evidenceById(packet, 'PA-S4-EVIDENCE-010').derivedFromClaimIds = ['PA-S4-CLAIM-004'];
});

export const buildMandatoryDependencyDriftFixture = () => mutatePacket((packet) => {
  claimById(packet, 'PA-S4-CLAIM-001').subclaimIds = [];
  for (const claim of packet.claims) claim.assumptionIds = [];
});

export const buildMissingMandatoryClaimFixture = () => mutatePacket((packet) => {
  packet.claims = packet.claims.filter((claim) => claim.claimId !== 'PA-S4-CLAIM-013');
  packet.mandatoryClaimIds = packet.mandatoryClaimIds.filter((claimId) => claimId !== 'PA-S4-CLAIM-013');
  packet.rootClaimIds = packet.rootClaimIds.filter((claimId) => claimId !== 'PA-S4-CLAIM-013');
});

export const buildMandatoryContractDriftFixture = () => mutatePacket((packet) => {
  claimById(packet, 'PA-S4-CLAIM-011').statement = 'A weaker release identity statement.';
});

export const buildUnknownAssumptionProjection = (assumptionId = 'PA-S1-AS-008', evaluatedAtMs = FIXTURE_NOW_MS) => (
  buildS1AssumptionProjection({
    evaluatedAtMs,
    overrides: {
      [assumptionId]: {
        result: 'UNKNOWN',
        reasonCode: 'EXPIRED',
        freshnessStatus: 'EXPIRED',
        staleAtMs: evaluatedAtMs,
      },
    },
  })
);

export const buildFailedAssumptionProjection = (assumptionId = 'PA-S1-AS-008', evaluatedAtMs = FIXTURE_NOW_MS) => (
  buildS1AssumptionProjection({
    evaluatedAtMs,
    overrides: {
      [assumptionId]: {
        result: 'FAIL',
        reasonCode: 'CONTRADICTED',
        freshnessStatus: 'CURRENT',
      },
    },
  })
);

export const buildMissingAssumptionProjection = (assumptionId = 'PA-S1-AS-008') => {
  const projection = clonePlainData(ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE);
  projection.assumptionResults = projection.assumptionResults.filter((record) => record.assumptionId !== assumptionId);
  return deepFreeze(projection);
};

export const buildStaleS1Projection = () => buildS1AssumptionProjection({ evaluatedAtMs: FIXTURE_NOW_MS - 1 });

const DIAGNOSTIC_FAMILIES = Object.freeze([
  ['containmentEvidenceIds', 'CONTAINMENT', 'DIAGNOSTIC_CONTAINMENT', 'DIAGNOSTIC_CONTAINMENT_TEST', 201],
  ['permissionEvidenceIds', 'PERMISSION', 'DIAGNOSTIC_PERMISSION', 'DIAGNOSTIC_PERMISSION_READBACK', 202],
  ['providerOutageEvidenceIds', 'PROVIDER-OUTAGE', 'DIAGNOSTIC_PROVIDER_OUTAGE', 'DIAGNOSTIC_PROVIDER_OUTAGE_EXERCISE', 203],
  ['privacyEvidenceIds', 'PRIVACY', 'DIAGNOSTIC_PRIVACY', 'DIAGNOSTIC_PRIVACY_REVIEW', 204],
  ['independentEvidenceIds', 'INDEPENDENCE', 'DIAGNOSTIC_INDEPENDENCE', 'DIAGNOSTIC_INDEPENDENCE_CHECK', 205],
]);

const replaceDomainSuffix = (domains, suffix) => domains.map((domain) => ({
  ...domain,
  id: `${domain.id.replace(/-013$/, '')}-${suffix}`,
}));

const configureDiagnostic = (packet, posture, omittedFields = []) => {
  const template = evidenceById(packet, 'PA-S4-EVIDENCE-013');
  const basisTemplate = evidenceById(packet, 'PA-S4-INDEPENDENCE-BASIS-013');
  const diagnosticPlane = {
    posture,
    postureEvidenceIds: ['PA-S4-EVIDENCE-013'],
    containmentEvidenceIds: [],
    permissionEvidenceIds: [],
    providerOutageEvidenceIds: [],
    privacyEvidenceIds: [],
    independentEvidenceIds: [],
  };
  const supportIds = ['PA-S4-EVIDENCE-013'];
  for (const [field, label, purpose, kind, number] of DIAGNOSTIC_FAMILIES) {
    if (omittedFields.includes(field)) continue;
    const evidence = clonePlainData(template);
    const basis = clonePlainData(basisTemplate);
    evidence.evidenceId = `PA-S4-DIAGNOSTIC-${label}-EVIDENCE`;
    evidence.purpose = purpose;
    evidence.kind = kind;
    evidence.statement = canonicalEvidenceStatement(evidence);
    evidence.sourceIdentity = {
      sourceId: `PA-S4-DIAGNOSTIC-${label}-SOURCE`,
      sourceType: kind,
      revision: `PA-S4-DIAGNOSTIC-${label}-REV-001`,
      digest: `sha256:${String(number).padStart(64, '0')}`,
    };
    evidence.producer.actorId = `PA-S4-DIAGNOSTIC-${label}-PRODUCER`;
    evidence.producer.failureDomains = replaceDomainSuffix(evidence.producer.failureDomains, label);
    evidence.verifier.actorId = `PA-S4-DIAGNOSTIC-${label}-VERIFIER`;
    evidence.verifier.ownerId = `IP-ASSURANCE.diagnostic-${label.toLowerCase()}-verifier`;
    evidence.verifier.failureDomains = replaceDomainSuffix(evidence.verifier.failureDomains, label);
    if (purpose === 'DIAGNOSTIC_INDEPENDENCE') evidence.independence.declaredClass = 'OUT_OF_BAND';
    evidence.validator = {
      validatorId: `PA-S4-DIAGNOSTIC-${label}-VALIDATOR`,
      version: 'PA-S4-DIAGNOSTIC-VALIDATOR-V1',
    };
    basis.evidenceId = `PA-S4-DIAGNOSTIC-${label}-BASIS`;
    basis.statement = canonicalEvidenceStatement(basis);
    basis.sourceIdentity = {
      sourceId: `PA-S4-DIAGNOSTIC-${label}-BASIS-SOURCE`,
      sourceType: 'OWNER_AUTHORIZATION',
      revision: `PA-S4-DIAGNOSTIC-${label}-BASIS-REV-001`,
      digest: `sha256:${String(number + 100).padStart(64, '0')}`,
    };
    basis.producer.actorId = `PA-S4-DIAGNOSTIC-${label}-BASIS-PRODUCER`;
    basis.producer.failureDomains = replaceDomainSuffix(basis.producer.failureDomains, label);
    basis.verifier.actorId = `PA-S4-DIAGNOSTIC-${label}-BASIS-VERIFIER`;
    basis.verifier.ownerId = `IP-ASSURANCE.diagnostic-${label.toLowerCase()}-basis-verifier`;
    basis.verifier.failureDomains = replaceDomainSuffix(basis.verifier.failureDomains, label);
    basis.validator = {
      validatorId: `PA-S4-DIAGNOSTIC-${label}-BASIS-VALIDATOR`,
      version: 'PA-S4-DIAGNOSTIC-BASIS-VALIDATOR-V1',
    };
    basis.certifiesEvidenceIds = [evidence.evidenceId];
    evidence.independence.basisEvidenceIds = [basis.evidenceId];
    packet.evidence.push(evidence, basis);
    diagnosticPlane[field] = [evidence.evidenceId];
    supportIds.push(evidence.evidenceId);
  }
  packet.diagnosticPlane = diagnosticPlane;
  const claim = claimById(packet, 'PA-S4-CLAIM-013');
  claim.supportingEvidenceIds = supportIds;
  claim.componentDrillDown[0].supportingEvidenceIds = supportIds;
};

export const buildCompleteConfiguredDiagnosticFixture = (posture = 'SHADOW') => mutatePacket((packet) => {
  configureDiagnostic(packet, posture);
});

export const buildIncompleteConfiguredDiagnosticFixture = () => mutatePacket((packet) => {
  configureDiagnostic(packet, 'ACTIVE', ['privacyEvidenceIds']);
});

export const buildAliasedConfiguredDiagnosticFixture = () => mutatePacket((packet) => {
  configureDiagnostic(packet, 'ACTIVE');
  const alias = packet.diagnosticPlane.containmentEvidenceIds[0];
  for (const [field] of DIAGNOSTIC_FAMILIES) packet.diagnosticPlane[field] = [alias];
  const claim = claimById(packet, 'PA-S4-CLAIM-013');
  claim.supportingEvidenceIds = ['PA-S4-EVIDENCE-013', alias];
  claim.componentDrillDown[0].supportingEvidenceIds = ['PA-S4-EVIDENCE-013', alias];
});

export const buildIndependenceBasisFanoutFixture = () => mutatePacket((packet) => {
  const basis = evidenceById(packet, 'PA-S4-INDEPENDENCE-BASIS-001');
  basis.certifiesEvidenceIds = ['PA-S4-EVIDENCE-001', 'PA-S4-EVIDENCE-002'];
});

export const buildClaimSupportAliasFixture = () => mutatePacket((packet) => {
  const claim = claimById(packet, 'PA-S4-CLAIM-003');
  claim.supportingEvidenceIds = ['PA-S4-EVIDENCE-001'];
  claim.componentDrillDown[0].supportingEvidenceIds = ['PA-S4-EVIDENCE-001'];
  evidenceById(packet, 'PA-S4-EVIDENCE-001').derivedFromEvidenceIds = ['PA-S4-EVIDENCE-003'];
});

export const buildClaimSourceAliasFixture = () => mutatePacket((packet) => {
  evidenceById(packet, 'PA-S4-EVIDENCE-003').sourceIdentity = clonePlainData(
    evidenceById(packet, 'PA-S4-EVIDENCE-001').sourceIdentity,
  );
});

export const buildDiagnosticSemanticCloneFixture = () => mutatePacket((packet) => {
  configureDiagnostic(packet, 'ACTIVE');
  const source = evidenceById(packet, packet.diagnosticPlane.containmentEvidenceIds[0]);
  const clone = evidenceById(packet, packet.diagnosticPlane.privacyEvidenceIds[0]);
  clone.sourceIdentity.sourceId = source.sourceIdentity.sourceId;
  clone.sourceIdentity.digest = source.sourceIdentity.digest;
  clone.producer.actorId = source.producer.actorId;
  clone.producer.failureDomains = clonePlainData(source.producer.failureDomains);
  clone.verifier.actorId = source.verifier.actorId;
  clone.verifier.failureDomains = clonePlainData(source.verifier.failureDomains);
});

export const buildReorderedFixture = () => mutatePacket((packet) => {
  packet.claims.reverse();
  packet.evidence.reverse();
  packet.rootClaimIds.reverse();
  packet.mandatoryClaimIds.reverse();
});

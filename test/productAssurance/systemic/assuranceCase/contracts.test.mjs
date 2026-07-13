import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTED_S1_ASSUMPTION_IDS,
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  ACCEPTED_S1_SOURCE,
  ASSURANCE_CASE_SCHEMA_DESCRIPTOR,
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  MANDATORY_CLAIM_DRILL_DOWN,
  MANDATORY_CLAIM_REQUIREMENTS,
  MANDATORY_CLAIM_VALIDATOR,
  PROHIBITED_ASSURANCE_COMMANDS,
  REQUIRED_MANDATORY_CLAIM_IDS,
  SAFE_EVENT_RECOMMENDATION_TYPE,
  SAFE_INCIDENT_RECOMMENDATION_TYPE,
  buildClaimCycleFixture,
  buildClaimSourceAliasFixture,
  buildClaimSupportAliasFixture,
  buildEvidenceCycleFixture,
  buildIndependenceBasisFanoutFixture,
  buildMandatoryContractDriftFixture,
  buildMandatoryDependencyDriftFixture,
  buildSelfCertifiedIndependenceFixture,
  capturePlainData,
  clonePlainData,
  validateAssuranceCasePacket,
  validateS1AssumptionProjection,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

test('S4 publishes a closed bounded versioned contract', () => {
  assert.equal(ASSURANCE_CASE_SCHEMA_DESCRIPTOR.schemaVersion, 'pa.s4.assurance-case.v1');
  assert.equal(ASSURANCE_CASE_SCHEMA_DESCRIPTOR.closedObjects, true);
  assert.equal(ASSURANCE_CASE_SCHEMA_DESCRIPTOR.bounded, true);
  assert.deepEqual(ASSURANCE_CASE_SCHEMA_DESCRIPTOR.resultVocabulary, ['PASS', 'FAIL', 'UNKNOWN']);
  assert.equal(ASSURANCE_CASE_SCHEMA_DESCRIPTOR.authorityBoundary.truthLabel, 'SYNTHETIC_ONLY');
  assert.equal(ASSURANCE_CASE_SCHEMA_DESCRIPTOR.authorityBoundary.authorityEffect, 'NONE');
  assert.equal(ASSURANCE_CASE_SCHEMA_DESCRIPTOR.authorityBoundary.runtimeProjectionOwner, 'I08.machine-supervisor');
  assert.deepEqual(ASSURANCE_CASE_SCHEMA_DESCRIPTOR.explanationBoundary, {
    llmMayExplain: true,
    llmMayRestoreSupport: false,
    prohibitedCommands: PROHIBITED_ASSURANCE_COMMANDS,
  });
  assert.deepEqual(PROHIBITED_ASSURANCE_COMMANDS, [
    'HALT', 'CLOSE', 'REPAIR', 'DEMOTION', 'DEPLOYMENT', 'CAPITAL',
    'ORDER', 'BORROW', 'REPAY', 'TRANSFER', 'WITHDRAWAL',
  ]);
});

test('mandatory claim topology and accepted S1 dependencies are immutable contract data', () => {
  assert.deepEqual(MANDATORY_CLAIM_REQUIREMENTS.map((entry) => ({
    claimId: entry.claimId,
    subclaims: entry.requiredSubclaimIds,
    assumptions: entry.requiredAssumptionIds,
  })), [
    { claimId: 'PA-S4-CLAIM-001', subclaims: ['PA-S4-CLAIM-002'], assumptions: ['PA-S1-AS-007', 'PA-S1-AS-008'] },
    { claimId: 'PA-S4-CLAIM-002', subclaims: ['PA-S4-CLAIM-003'], assumptions: ['PA-S1-AS-008'] },
    { claimId: 'PA-S4-CLAIM-003', subclaims: ['PA-S4-CLAIM-004'], assumptions: ['PA-S1-AS-008'] },
    { claimId: 'PA-S4-CLAIM-004', subclaims: [], assumptions: ['PA-S1-AS-008'] },
    { claimId: 'PA-S4-CLAIM-005', subclaims: [], assumptions: ['PA-S1-AS-003'] },
    { claimId: 'PA-S4-CLAIM-006', subclaims: ['PA-S4-CLAIM-005'], assumptions: ['PA-S1-AS-003'] },
    { claimId: 'PA-S4-CLAIM-007', subclaims: ['PA-S4-CLAIM-011'], assumptions: ['PA-S1-AS-007'] },
    { claimId: 'PA-S4-CLAIM-008', subclaims: [], assumptions: ['PA-S1-AS-002', 'PA-S1-AS-009'] },
    { claimId: 'PA-S4-CLAIM-009', subclaims: ['PA-S4-CLAIM-006'], assumptions: ['PA-S1-AS-006'] },
    { claimId: 'PA-S4-CLAIM-010', subclaims: [], assumptions: ['PA-S1-AS-005'] },
    { claimId: 'PA-S4-CLAIM-011', subclaims: [], assumptions: ['PA-S1-AS-007'] },
    { claimId: 'PA-S4-CLAIM-012', subclaims: ['PA-S4-CLAIM-004'], assumptions: ['PA-S1-AS-008'] },
    { claimId: 'PA-S4-CLAIM-013', subclaims: [], assumptions: ['PA-S1-AS-002', 'PA-S1-AS-007', 'PA-S1-AS-009'] },
  ]);
  assert.deepEqual(ACCEPTED_S1_ASSUMPTION_IDS, Array.from({ length: 9 }, (_, index) => (
    `PA-S1-AS-${String(index + 1).padStart(3, '0')}`
  )));
});

test('all thirteen mandatory §5.3 claims are exact and stable', () => {
  assert.equal(MANDATORY_CLAIM_REQUIREMENTS.length, 13);
  assert.deepEqual(REQUIRED_MANDATORY_CLAIM_IDS, Array.from({ length: 13 }, (_, index) => (
    `PA-S4-CLAIM-${String(index + 1).padStart(3, '0')}`
  )));
  assert.deepEqual(MANDATORY_CLAIM_REQUIREMENTS.map((entry) => entry.statement), [
    'Required inventory has an explicit disposition.',
    'Each enabled required component is discovered and instrumented.',
    'No missing or unsupported required component is hidden by the denominator.',
    'Telemetry completeness is sufficient for the exact claimed posture.',
    'Spot, Futures, and account inputs are temporally coherent for the exact action.',
    'Authoritative account and exchange truth is reconciled.',
    'Only a current fenced epoch may enter canonical mutation state.',
    'Live controls map to canonical commands.',
    'Required rollback and recovery paths have current scenario-bounded evidence.',
    'Model evidence matches the approved cohort and version.',
    'Displayed, tested, and deployed SHAs agree.',
    'Independent sentinel and paging evidence is current.',
    'Diagnostic-plane posture is explicit. NOT_CONFIGURED is valid and cannot degrade deterministic product readiness. If posture is SHADOW, OWNER_GATED, or ACTIVE, containment, permission, provider-outage, privacy, and independent evidence must be current.',
  ]);
});

test('baseline graph and accepted S1 adapter projection validate', () => {
  assert.deepEqual(validateAssuranceCasePacket(COMPLETE_ASSURANCE_CASE_FIXTURE), []);
  assert.deepEqual(validateS1AssumptionProjection(ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE), []);
});

test('accepted S1 source identity pins branch, commit, schema, blobs, and hashes', () => {
  assert.equal(ACCEPTED_S1_SOURCE.commit, 'ab33b3712cddd67c3ec91cfa1dd232c75226cd9f');
  assert.equal(ACCEPTED_S1_SOURCE.inputSchemaVersion, 'pa.s1.hazard-assurance.v1');
  assert.match(ACCEPTED_S1_SOURCE.schemaSha256, /^[0-9a-f]{64}$/);
  assert.match(ACCEPTED_S1_SOURCE.validationSha256, /^[0-9a-f]{64}$/);
  assert.match(ACCEPTED_S1_SOURCE.baselineSha256, /^[0-9a-f]{64}$/);
  assert.match(ACCEPTED_S1_SOURCE.evaluatorSha256, /^[0-9a-f]{64}$/);
});

test('unknown graph fields fail the closed contract', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  packet.claims[0].desiredState = 'HEALTHY';
  assert(validateAssuranceCasePacket(packet).some((entry) => entry.code === 'SCHEMA_UNKNOWN_FIELD'));
});

test('mandatory claim wording and owner contracts cannot drift', () => {
  const issues = validateAssuranceCasePacket(buildMandatoryContractDriftFixture());
  assert(issues.some((entry) => entry.code === 'MANDATORY_CLAIM_CONTRACT_DRIFT'));
});

for (const [name, mutate, expectedCode] of [
  ['scope', (claim) => { claim.scope = 'A weaker unbounded scope.'; }, 'MANDATORY_CLAIM_CONTRACT_DRIFT'],
  ['capital criticality', (claim) => { claim.capitalCritical = false; }, 'MANDATORY_CLAIM_CONTRACT_DRIFT'],
  ['validator identity', (claim) => { claim.validator = { ...MANDATORY_CLAIM_VALIDATOR, version: 'WEAKER-VERSION' }; }, 'MANDATORY_CLAIM_CONTRACT_DRIFT'],
  ['invariant event recommendation', (claim) => { claim.invariantProjection.eventRecommendationType = 'HALT'; }, 'MANDATORY_CLAIM_PROJECTION_DRIFT'],
  ['invariant incident recommendation', (claim) => { claim.invariantProjection.incidentRecommendationType = 'CAPITAL'; }, 'MANDATORY_CLAIM_PROJECTION_DRIFT'],
  ['cockpit surface', (claim) => { claim.cockpitProjection.surface = 'LOGS'; }, 'MANDATORY_CLAIM_PROJECTION_DRIFT'],
  ['cockpit drill-down', (claim) => { claim.cockpitProjection.drillDown = 'Opaque summary only.'; }, 'MANDATORY_CLAIM_PROJECTION_DRIFT'],
]) {
  test(`mandatory ${name} is exact contract data`, () => {
    const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
    mutate(packet.claims[0]);
    const issues = validateAssuranceCasePacket(packet);
    assert(issues.some((entry) => entry.code === expectedCode), JSON.stringify(issues));
  });
}

test('mandatory projections retain only the safe explanatory recommendation vocabulary', () => {
  for (const claim of COMPLETE_ASSURANCE_CASE_FIXTURE.claims) {
    assert.equal(claim.invariantProjection.eventRecommendationType, SAFE_EVENT_RECOMMENDATION_TYPE);
    assert.equal(claim.invariantProjection.incidentRecommendationType, SAFE_INCIDENT_RECOMMENDATION_TYPE);
    assert.equal(claim.cockpitProjection.drillDown, MANDATORY_CLAIM_DRILL_DOWN);
  }
});

test('mandatory claim dependency topology cannot be stripped', () => {
  const issues = validateAssuranceCasePacket(buildMandatoryDependencyDriftFixture());
  assert(issues.some((entry) => entry.code === 'MANDATORY_CLAIM_DEPENDENCY_DRIFT'));
});

test('independence basis must resolve and cannot self-certify', () => {
  const issues = validateAssuranceCasePacket(buildSelfCertifiedIndependenceFixture());
  assert(issues.some((entry) => entry.code === 'INDEPENDENCE_BASIS_SELF_REFERENCE'));
  assert(issues.some((entry) => entry.code === 'ASSURANCE_GRAPH_CYCLE'));
});

test('one independence basis cannot certify multiple evidence nodes', () => {
  const issues = validateAssuranceCasePacket(buildIndependenceBasisFanoutFixture());
  assert(issues.some((entry) => entry.code === 'INDEPENDENCE_BASIS_SCOPE_INVALID'));
  assert(issues.some((entry) => entry.code === 'INDEPENDENCE_BASIS_BACKLINK_MISSING'));
});

test('one direct evidence node cannot support multiple mandatory claims', () => {
  const issues = validateAssuranceCasePacket(buildClaimSupportAliasFixture());
  assert(issues.some((entry) => entry.code === 'DIRECT_EVIDENCE_ALIAS'));
  assert(!issues.some((entry) => entry.code === 'MANDATORY_EVIDENCE_KIND_MISMATCH'));
  assert(!issues.some((entry) => entry.code === 'MANDATORY_EVIDENCE_OWNER_MISMATCH'));
});

test('distinct direct evidence IDs cannot alias one source identity', () => {
  const issues = validateAssuranceCasePacket(buildClaimSourceAliasFixture());
  assert(issues.some((entry) => entry.code === 'DIRECT_SOURCE_ID_ALIAS'));
  assert(issues.some((entry) => entry.code === 'DIRECT_SOURCE_DIGEST_ALIAS'));
});

test('claim dependency cycles are rejected', () => {
  const issues = validateAssuranceCasePacket(buildClaimCycleFixture());
  assert(issues.some((entry) => entry.code === 'ASSURANCE_GRAPH_CYCLE'));
});

test('strongly connected evidence certification cycles are rejected', () => {
  const issues = validateAssuranceCasePacket(buildEvidenceCycleFixture());
  assert(issues.some((entry) => entry.code === 'ASSURANCE_GRAPH_CYCLE'));
});

test('S1 provenance drift is rejected', () => {
  const projection = clonePlainData(ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE);
  projection.provenance.commit = '0000000000000000000000000000000000000000';
  assert(validateS1AssumptionProjection(projection).some((entry) => entry.code === 'S1_PROVENANCE_MISMATCH'));
});

test('S1 owner substitution is rejected', () => {
  const projection = clonePlainData(ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE);
  projection.assumptionResults[0].sourceOwnerId = 'S4.shadow-assumption-owner';
  assert(validateS1AssumptionProjection(projection).some((entry) => entry.code === 'S1_ASSUMPTION_OWNER_MISMATCH'));
});

test('S1 projection cannot declare stale PASS as current support', () => {
  const projection = clonePlainData(ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE);
  projection.assumptionResults[0].freshnessStatus = 'EXPIRED';
  assert(validateS1AssumptionProjection(projection).some((entry) => entry.code === 'S1_PASS_NOT_CURRENT'));
});

test('S1 projection cannot carry PASS beyond its declared stale boundary', () => {
  const projection = clonePlainData(ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE);
  projection.assumptionResults[0].staleAtMs = projection.evaluatedAtMs - 1;
  assert(validateS1AssumptionProjection(projection).some((entry) => entry.code === 'S1_PASS_PAST_STALE_BOUNDARY'));
});

test('S1 projection requires the exact accepted nine-result set', () => {
  const projection = clonePlainData(ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE);
  projection.assumptionResults.pop();
  assert(validateS1AssumptionProjection(projection).some((entry) => entry.code === 'S1_ASSUMPTION_SET_INVALID'));
});

test('S1 PASS requires VALIDATED, CURRENT, and a non-null stale boundary', () => {
  for (const mutate of [
    (record) => { record.reasonCode = 'WEAK'; },
    (record) => { record.freshnessStatus = 'EXPIRED'; },
    (record) => { record.staleAtMs = null; },
  ]) {
    const projection = clonePlainData(ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE);
    mutate(projection.assumptionResults[0]);
    assert(validateS1AssumptionProjection(projection).length > 0);
  }
});

test('S1 result and freshness vocabularies reject incoherent projections', () => {
  const failed = clonePlainData(ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE);
  failed.assumptionResults[0].result = 'FAIL';
  assert(validateS1AssumptionProjection(failed).some((entry) => entry.code === 'S1_RESULT_REASON_INCOHERENT'));
  const unknown = clonePlainData(ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE);
  unknown.assumptionResults[0].result = 'UNKNOWN';
  unknown.assumptionResults[0].reasonCode = 'EXPIRED';
  unknown.assumptionResults[0].freshnessStatus = 'CURRENT';
  assert(validateS1AssumptionProjection(unknown).some((entry) => entry.code === 'S1_RESULT_REASON_INCOHERENT'));
  const invented = clonePlainData(ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE);
  invented.assumptionResults[0].freshnessStatus = 'FRESH_ENOUGH';
  assert(validateS1AssumptionProjection(invented).some((entry) => entry.code === 'S1_FRESHNESS_STATUS_INVALID'));
});

test('claim SLO cannot silently exceed graph policy', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  packet.claims[0].propagationSloMs = packet.propagationPolicy.propagationSloMs + 1;
  assert(validateAssuranceCasePacket(packet).some((entry) => entry.code === 'CLAIM_SLO_EXCEEDS_POLICY'));
});

test('plain-data capture never invokes an accessor', () => {
  let invoked = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'claims', {
    enumerable: true,
    get() {
      invoked += 1;
      return [];
    },
  });
  const captured = capturePlainData(hostile);
  assert.equal(captured.ok, false);
  assert.equal(captured.issues[0].code, 'PLAIN_DATA_ACCESSOR');
  assert.equal(invoked, 0);
});

test('plain-data capture rejects cycles and sparse arrays', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(capturePlainData(cyclic).issues[0].code, 'PLAIN_DATA_CYCLE');
  const sparse = [];
  sparse.length = 1;
  assert.equal(capturePlainData(sparse).issues[0].code, 'PLAIN_ARRAY_SPARSE');
});

test('plain-data capture cannot pollute Object.prototype through __proto__', () => {
  const input = {};
  Object.defineProperty(input, '__proto__', {
    value: { polluted: true },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  const captured = capturePlainData(input);
  assert.equal(captured.ok, true);
  assert.equal(Object.getPrototypeOf(captured.value), null);
  assert.equal({}.polluted, undefined);
  assert.equal(captured.value.__proto__.polluted, true);
});

test('exported packet and S1 validators reject null records without throwing', () => {
  const packetWithNullClaim = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  packetWithNullClaim.claims[0] = null;
  const packetWithNullEvidence = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  packetWithNullEvidence.evidence[0] = null;
  const projectionWithNullResult = clonePlainData(ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE);
  projectionWithNullResult.assumptionResults[0] = null;

  for (const input of [null, packetWithNullClaim, packetWithNullEvidence]) {
    let issues;
    assert.doesNotThrow(() => { issues = validateAssuranceCasePacket(input); });
    assert(issues.length > 0);
  }
  for (const input of [null, projectionWithNullResult]) {
    let issues;
    assert.doesNotThrow(() => { issues = validateS1AssumptionProjection(input); });
    assert(issues.length > 0);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  buildCompleteConfiguredDiagnosticFixture,
  buildCounterevidenceFixture,
  clonePlainData,
  validateAssuranceCasePacket,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const claimById = (packet, claimId) => packet.claims.find((claim) => claim.claimId === claimId);
const evidenceById = (packet, evidenceId) => packet.evidence.find((evidence) => evidence.evidenceId === evidenceId);
const issueCodes = (packet) => validateAssuranceCasePacket(packet).map((entry) => entry.code);

test('reciprocal claim binding rejects a forged evidence swap even when kind and owner are made plausible', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  const claim1 = claimById(packet, 'PA-S4-CLAIM-001');
  const claim3 = claimById(packet, 'PA-S4-CLAIM-003');
  const evidence1 = evidenceById(packet, 'PA-S4-EVIDENCE-001');
  const evidence3 = evidenceById(packet, 'PA-S4-EVIDENCE-003');

  evidence1.kind = evidence3.kind;
  evidence1.sourceIdentity.sourceType = evidence3.kind;
  evidence1.producer.ownerId = claim3.canonicalOwner.ownerId;
  evidence3.kind = COMPLETE_ASSURANCE_CASE_FIXTURE.evidence.find(
    (entry) => entry.evidenceId === 'PA-S4-EVIDENCE-001',
  ).kind;
  evidence3.sourceIdentity.sourceType = evidence3.kind;
  evidence3.producer.ownerId = claim1.canonicalOwner.ownerId;
  claim1.supportingEvidenceIds = [evidence3.evidenceId];
  claim1.componentDrillDown[0].supportingEvidenceIds = [evidence3.evidenceId];
  claim3.supportingEvidenceIds = [evidence1.evidenceId];
  claim3.componentDrillDown[0].supportingEvidenceIds = [evidence1.evidenceId];

  const codes = issueCodes(packet);
  assert(codes.includes('EVIDENCE_CLAIM_BINDING_MISMATCH'), codes.join(','));
});

test('counterevidence must be applicable to exactly one bound claim', () => {
  const applicabilityPacket = clonePlainData(buildCounterevidenceFixture());
  const counterevidence = evidenceById(applicabilityPacket, 'PA-S4-COUNTEREVIDENCE-004');
  counterevidence.claimBinding = clonePlainData(evidenceById(applicabilityPacket, 'PA-S4-EVIDENCE-005').claimBinding);
  assert(issueCodes(applicabilityPacket).includes('EVIDENCE_CLAIM_BINDING_MISMATCH'));

  const aliasPacket = clonePlainData(buildCounterevidenceFixture());
  claimById(aliasPacket, 'PA-S4-CLAIM-005').counterEvidenceIds = ['PA-S4-COUNTEREVIDENCE-004'];
  const aliasCodes = issueCodes(aliasPacket);
  assert(aliasCodes.includes('DIRECT_EVIDENCE_ALIAS'), aliasCodes.join(','));
  assert(aliasCodes.includes('EVIDENCE_CLAIM_BINDING_MISMATCH'), aliasCodes.join(','));
});

test('direct evidence source ID and digest aliases are rejected independently', () => {
  const sourceIdPacket = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  evidenceById(sourceIdPacket, 'PA-S4-EVIDENCE-003').sourceIdentity.sourceId = (
    evidenceById(sourceIdPacket, 'PA-S4-EVIDENCE-001').sourceIdentity.sourceId
  );
  const sourceIdCodes = issueCodes(sourceIdPacket);
  assert(sourceIdCodes.includes('DIRECT_SOURCE_ID_ALIAS'), sourceIdCodes.join(','));
  assert(!sourceIdCodes.includes('DIRECT_SOURCE_DIGEST_ALIAS'), sourceIdCodes.join(','));

  const digestPacket = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  evidenceById(digestPacket, 'PA-S4-EVIDENCE-003').sourceIdentity.digest = (
    evidenceById(digestPacket, 'PA-S4-EVIDENCE-001').sourceIdentity.digest
  );
  const digestCodes = issueCodes(digestPacket);
  assert(digestCodes.includes('DIRECT_SOURCE_DIGEST_ALIAS'), digestCodes.join(','));
  assert(!digestCodes.includes('DIRECT_SOURCE_ID_ALIAS'), digestCodes.join(','));
});

test('configured diagnostic independence bases cannot be semantic clones', () => {
  const packet = clonePlainData(buildCompleteConfiguredDiagnosticFixture('ACTIVE'));
  const firstMain = evidenceById(packet, packet.diagnosticPlane.containmentEvidenceIds[0]);
  const secondMain = evidenceById(packet, packet.diagnosticPlane.privacyEvidenceIds[0]);
  const first = evidenceById(packet, firstMain.independence.basisEvidenceIds[0]);
  const second = evidenceById(packet, secondMain.independence.basisEvidenceIds[0]);

  second.sourceIdentity.sourceId = first.sourceIdentity.sourceId;
  second.sourceIdentity.digest = first.sourceIdentity.digest;
  second.producer.actorId = first.producer.actorId;
  second.producer.failureDomains = clonePlainData(first.producer.failureDomains);
  second.verifier.actorId = first.verifier.actorId;
  second.verifier.ownerId = first.verifier.ownerId;
  second.verifier.failureDomains = clonePlainData(first.verifier.failureDomains);
  second.validator = clonePlainData(first.validator);

  const codes = new Set(issueCodes(packet));
  for (const code of [
    'DIAGNOSTIC_BASIS_SOURCE_ID_ALIAS',
    'DIAGNOSTIC_BASIS_SOURCE_DIGEST_ALIAS',
    'DIAGNOSTIC_BASIS_PRODUCER_ALIAS',
    'DIAGNOSTIC_BASIS_VERIFIER_ALIAS',
    'DIAGNOSTIC_BASIS_VERIFIER_OWNER_ALIAS',
    'DIAGNOSTIC_BASIS_VALIDATOR_ALIAS',
    'DIAGNOSTIC_BASIS_COMMON_MODE_FAILURE_DOMAIN',
  ]) assert(codes.has(code), `${code}: ${[...codes].join(',')}`);
});

for (const [name, mutate, expectedCode] of [
  [
    'verifier owner',
    (first, second) => { second.verifier.ownerId = first.verifier.ownerId; },
    'DIAGNOSTIC_VERIFIER_OWNER_ALIAS',
  ],
  [
    'validator identity',
    (first, second) => { second.validator = clonePlainData(first.validator); },
    'DIAGNOSTIC_VALIDATOR_ALIAS',
  ],
  [
    'failure domain',
    (first, second) => { second.verifier.failureDomains[0] = clonePlainData(first.producer.failureDomains[0]); },
    'DIAGNOSTIC_COMMON_MODE_FAILURE_DOMAIN',
  ],
]) {
  test(`configured diagnostic families reject a shared ${name}`, () => {
    const packet = clonePlainData(buildCompleteConfiguredDiagnosticFixture('SHADOW'));
    const first = evidenceById(packet, packet.diagnosticPlane.containmentEvidenceIds[0]);
    const second = evidenceById(packet, packet.diagnosticPlane.permissionEvidenceIds[0]);
    mutate(first, second);
    const codes = issueCodes(packet);
    assert(codes.includes(expectedCode), codes.join(','));
  });
}

test('every non-basis critical evidence record names exactly one independence basis', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  evidenceById(packet, 'PA-S4-EVIDENCE-001').independence.basisEvidenceIds = [
    'PA-S4-INDEPENDENCE-BASIS-001',
    'PA-S4-INDEPENDENCE-BASIS-002',
  ];
  const issues = validateAssuranceCasePacket(packet);
  assert(issues.some((entry) => (
    entry.code === 'SCHEMA_ID_ARRAY_INVALID'
    && entry.path.endsWith('.independence.basisEvidenceIds')
  )), JSON.stringify(issues));
});

test('diagnostic posture evidence retains the canonical claim 13 producer owner', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  evidenceById(packet, 'PA-S4-EVIDENCE-013').producer.ownerId = 'S4.invented-diagnostic-owner';
  const codes = issueCodes(packet);
  assert(codes.includes('MANDATORY_EVIDENCE_OWNER_MISMATCH'), codes.join(','));
});

test('ordinary independence bases cannot reuse semantic identities globally', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  const first = evidenceById(packet, 'PA-S4-INDEPENDENCE-BASIS-001');
  const second = evidenceById(packet, 'PA-S4-INDEPENDENCE-BASIS-002');
  second.sourceIdentity.sourceId = first.sourceIdentity.sourceId;
  second.sourceIdentity.digest = first.sourceIdentity.digest;
  second.producer.actorId = first.producer.actorId;
  second.producer.failureDomains = clonePlainData(first.producer.failureDomains);
  second.verifier.actorId = first.verifier.actorId;
  second.verifier.ownerId = first.verifier.ownerId;
  second.verifier.failureDomains = clonePlainData(first.verifier.failureDomains);
  second.validator = clonePlainData(first.validator);

  const codes = new Set(issueCodes(packet));
  for (const code of [
    'INDEPENDENCE_BASIS_SOURCE_ID_ALIAS',
    'INDEPENDENCE_BASIS_SOURCE_DIGEST_ALIAS',
    'INDEPENDENCE_BASIS_PRODUCER_ALIAS',
    'INDEPENDENCE_BASIS_VERIFIER_ALIAS',
    'INDEPENDENCE_BASIS_VERIFIER_OWNER_ALIAS',
    'INDEPENDENCE_BASIS_VALIDATOR_ALIAS',
    'INDEPENDENCE_BASIS_COMMON_MODE_FAILURE_DOMAIN',
  ]) assert(codes.has(code), `${code}: ${[...codes].join(',')}`);
});

for (const [name, mutate] of [
  ['claim subclaims', (packet) => { claimById(packet, 'PA-S4-CLAIM-001').subclaimIds = 'PA-S4-CLAIM-002'; }],
  ['claim assumptions', (packet) => { claimById(packet, 'PA-S4-CLAIM-001').assumptionIds = 'PA-S1-AS-007'; }],
  ['claim support', (packet) => { claimById(packet, 'PA-S4-CLAIM-001').supportingEvidenceIds = 'PA-S4-EVIDENCE-001'; }],
  ['claim counterevidence', (packet) => { claimById(packet, 'PA-S4-CLAIM-001').counterEvidenceIds = 'PA-S4-EVIDENCE-001'; }],
  ['derived claims', (packet) => { evidenceById(packet, 'PA-S4-EVIDENCE-001').derivedFromClaimIds = 'PA-S4-CLAIM-002'; }],
  ['derived evidence', (packet) => { evidenceById(packet, 'PA-S4-EVIDENCE-001').derivedFromEvidenceIds = 'PA-S4-EVIDENCE-002'; }],
  ['basis links', (packet) => { evidenceById(packet, 'PA-S4-EVIDENCE-001').independence.basisEvidenceIds = 'PA-S4-INDEPENDENCE-BASIS-001'; }],
  ['certification links', (packet) => { evidenceById(packet, 'PA-S4-INDEPENDENCE-BASIS-001').certifiesEvidenceIds = 'PA-S4-EVIDENCE-001'; }],
]) {
  test(`wrong-shaped ${name} return contract issues instead of throwing`, () => {
    const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
    mutate(packet);
    let issues;
    assert.doesNotThrow(() => { issues = validateAssuranceCasePacket(packet); });
    assert(issues.some((entry) => entry.code === 'SCHEMA_ID_ARRAY_INVALID'), JSON.stringify(issues));
  });
}

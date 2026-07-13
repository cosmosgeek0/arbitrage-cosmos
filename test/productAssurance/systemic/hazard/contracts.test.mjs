import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPLETE_HAZARD_FIXTURE,
  FAILURE_FAMILIES,
  FIXTURE_REGISTRY,
  HAZARD_ASSURANCE_SCHEMA,
  HAZARD_ASSURANCE_SCHEMA_VERSION,
  HAZARDS,
  OPERATION_CLASSES,
  REQUIRED_FAILURE_FAMILY_IDS,
  REQUIRED_UNACCEPTABLE_LOSS_IDS,
  UNACCEPTABLE_LOSS_FAMILIES,
  buildCompleteHazardFixture,
  canonicalStringify,
  findSecretLikePaths,
  validateHazardAssurancePacket,
} from '../../../../fixtures/productAssurance/systemic/hazard/index.mjs';

test('schema is versioned, closed, bounded, and uses the six accepted operation classes', () => {
  assert.equal(HAZARD_ASSURANCE_SCHEMA.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(HAZARD_ASSURANCE_SCHEMA.additionalProperties, false);
  assert.equal(HAZARD_ASSURANCE_SCHEMA.properties.schemaVersion.const, HAZARD_ASSURANCE_SCHEMA_VERSION);
  assert.equal(HAZARD_ASSURANCE_SCHEMA.$defs.Hazard.additionalProperties, false);
  assert.equal(HAZARD_ASSURANCE_SCHEMA.$defs.Assumption.additionalProperties, false);
  assert.equal(HAZARD_ASSURANCE_SCHEMA.$defs.AtlasRow.additionalProperties, false);
  assert.equal(HAZARD_ASSURANCE_SCHEMA.$defs.FixtureRegistration.additionalProperties, false);
  assert.deepEqual(OPERATION_CLASSES, [
    'PURE_READ',
    'REPLAYABLE_SUBSCRIPTION',
    'IDEMPOTENT_COMMAND',
    'NON_IDEMPOTENT_MUTATION',
    'MULTI_LEG_SAGA',
    'RISK_REDUCING_RECOVERY',
  ]);
});

test('complete fixture validates and carries every mandatory S1 family', () => {
  const fixture = buildCompleteHazardFixture();
  assert.deepEqual(validateHazardAssurancePacket(fixture), []);
  assert.equal(fixture.unacceptableLossFamilies.length, 10);
  assert.equal(fixture.hazards.length, 10);
  assert.equal(fixture.assumptions.length, 9);
  assert.equal(fixture.fixtureRegistry.length, 60);
  assert.equal(fixture.failureFamilies.length, 9);
  assert.equal(fixture.atlasManifest.coverageDecisions.length, 54);
  assert.equal(fixture.atlasRows.length, 54);
  assert.deepEqual(fixture.unacceptableLossFamilies.map((family) => family.lossId), REQUIRED_UNACCEPTABLE_LOSS_IDS);
  assert.deepEqual(fixture.failureFamilies.map((family) => family.failureFamilyId), REQUIRED_FAILURE_FAMILY_IDS);
});

test('every claimed deterministic proof resolves through the bounded fixture registry', () => {
  const fixture = buildCompleteHazardFixture();
  const registry = new Map(FIXTURE_REGISTRY.map((entry) => [entry.fixtureId, entry]));
  for (const hazard of fixture.hazards.filter((entry) => entry.proof.kind === 'DETERMINISTIC_FIXTURE')) {
    const registration = registry.get(hazard.proof.referenceId);
    assert.equal(registration?.fixtureKind, 'HAZARD_PROJECTION');
    assert.equal(registration?.targetId, hazard.hazardId);
  }
  for (const row of fixture.atlasRows.filter((entry) => entry.reproduction.fixtureId !== null)) {
    const registration = registry.get(row.reproduction.fixtureId);
    assert.equal(registration?.fixtureKind, 'ATLAS_REPRODUCTION');
    assert.equal(registration?.targetId, row.atlasRowId);
  }
});

test('mandatory IDs and packet-local STPA IDs are unique and stable', () => {
  assert.equal(new Set(UNACCEPTABLE_LOSS_FAMILIES.map((family) => family.lossId)).size, 10);
  assert.equal(new Set(FAILURE_FAMILIES.map((family) => family.failureFamilyId)).size, 9);
  assert.equal(new Set(HAZARDS.map((hazard) => hazard.hazardId)).size, 10);
  assert.deepEqual(HAZARDS.map((hazard) => hazard.hazardId), Array.from({ length: 10 }, (_, index) => `PA-S1-HZ-${String(index + 1).padStart(3, '0')}`));
});

test('closed schema rejects unknown fields and unsupported values', () => {
  const fixture = buildCompleteHazardFixture();
  const malformed = {
    ...fixture,
    undocumentedAuthority: true,
    hazards: [{ ...fixture.hazards[0], unsafeControlAction: { ...fixture.hazards[0].unsafeControlAction, kind: 'MAGIC_SAFE' } }, ...fixture.hazards.slice(1)],
  };
  const issues = validateHazardAssurancePacket(malformed);
  assert.ok(issues.some((entry) => entry.code === 'SCHEMA_UNKNOWN_FIELD' && entry.path === '$.undocumentedAuthority'));
  assert.ok(issues.some((entry) => entry.code === 'SCHEMA_ENUM' && entry.path.endsWith('.unsafeControlAction.kind')));
});

test('semantic validation rejects unknown references and incoherent proof claims', () => {
  const fixture = buildCompleteHazardFixture();
  const malformed = {
    ...fixture,
    hazards: [
      {
        ...fixture.hazards[0],
        unacceptableLossIds: ['PA-S1-UL-999'],
        proof: {
          kind: 'DETERMINISTIC_FIXTURE',
          referenceId: 'PA-S1-FX-HZ-001',
          assertionLevel: 'COMPOSED_BEHAVIOR',
          gapCode: null,
        },
      },
      ...fixture.hazards.slice(1),
    ],
  };
  const issues = validateHazardAssurancePacket(malformed);
  assert.ok(issues.some((entry) => entry.code === 'LOSS_REFERENCE_UNKNOWN'));
  assert.ok(issues.some((entry) => entry.code === 'FIXTURE_PROOF_OVERCLAIM'));
});

test('dependency links are bidirectional and cannot silently drift', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  const claim = fixture.assumptionConsumers.find((consumer) => consumer.consumerId === 'PA-S1-CONS-CLAIM-001');
  claim.assumptionIds = claim.assumptionIds.filter((assumptionId) => assumptionId !== 'PA-S1-AS-002');
  const issues = validateHazardAssurancePacket(fixture);
  assert.ok(issues.some((entry) => (
    entry.code === 'DEPENDENT_FORWARD_REFERENCE_MISSING'
    && entry.message === 'PA-S1-AS-002|PA-S1-CONS-CLAIM-001'
  )));
});

test('packet-local cockpit dependents and loss boundaries are semantically resolved', () => {
  const cockpitFixture = structuredClone(buildCompleteHazardFixture());
  cockpitFixture.assumptions[0].dependents.cockpitProjectionIds.push('PA-S1-CP-HZ-999');
  assert.ok(validateHazardAssurancePacket(cockpitFixture).some((entry) => entry.code === 'COCKPIT_PROJECTION_REFERENCE_UNKNOWN'));

  const boundaryFixture = structuredClone(buildCompleteHazardFixture());
  boundaryFixture.hazards[0].affectedBoundaries = ['COST'];
  assert.ok(validateHazardAssurancePacket(boundaryFixture).some((entry) => entry.code === 'LOSS_BOUNDARY_INCOHERENT'));
});

test('fixture registry rejects every dangling or orphaned registration', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.fixtureRegistry.push({
    ...fixture.fixtureRegistry[0],
    fixtureId: 'PA-S1-FX-DANGLING',
    targetId: 'PA-S1-HZ-999',
  });
  const issues = validateHazardAssurancePacket(fixture);
  assert.ok(issues.some((entry) => entry.code === 'FIXTURE_TARGET_UNKNOWN' && entry.message === 'PA-S1-HZ-999'));
});

test('read-only I08 projection is never assigned containment or recovery authority', () => {
  const fixture = buildCompleteHazardFixture();
  const silentComponentHazard = fixture.hazards.find((hazard) => hazard.hazardId === 'PA-S1-HZ-006');
  assert.equal(silentComponentHazard?.detection.owner.ownerId, 'IP-ASSURANCE.invariant-atlas-owner');
  assert.equal(silentComponentHazard?.containmentRecoveryOwner.ownerId, 'foundation.control-plane');
  const telemetryRows = fixture.atlasRows.filter((row) => row.failureFamilyId === 'PA-S1-FF-005');
  assert.ok(telemetryRows.every((row) => row.detector.owner.ownerId === 'IP-ASSURANCE.invariant-atlas-owner'));
  assert.ok(telemetryRows.every((row) => row.containmentOwner.ownerId === 'foundation.control-plane'));
});

test('PASS evidence and reasoned not-applicable decisions cannot be empty or whitespace', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.assumptions[0].supportingSourceIds = [];
  fixture.atlasManifest.coverageDecisions[0] = {
    ...fixture.atlasManifest.coverageDecisions[0],
    disposition: 'NOT_APPLICABLE',
    rationale: '   ',
  };
  const issues = validateHazardAssurancePacket(fixture);
  assert.ok(issues.some((entry) => entry.code === 'SCHEMA_MIN_ITEMS' && entry.path.endsWith('.supportingSourceIds')));

  const reasonOnlyFixture = structuredClone(buildCompleteHazardFixture());
  reasonOnlyFixture.atlasManifest.coverageDecisions[0] = {
    ...reasonOnlyFixture.atlasManifest.coverageDecisions[0],
    disposition: 'NOT_APPLICABLE',
    rationale: '   ',
  };
  assert.ok(validateHazardAssurancePacket(reasonOnlyFixture).some((entry) => entry.code === 'NOT_APPLICABLE_RATIONALE_MISSING'));
});

test('the six-class live-operation inventory is contract-bound', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.atlasManifest.liveOperationClasses = ['PURE_READ'];
  const issues = validateHazardAssurancePacket(fixture);
  assert.ok(issues.some((entry) => entry.code === 'SCHEMA_MIN_ITEMS' && entry.path === '$.atlasManifest.liveOperationClasses'));
});

test('owner review binds the exact versioned denominator and cannot use UNTESTED evidence', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.atlasManifest.coverageDecisions[0].rationale = 'Unreviewed content mutation.';
  fixture.atlasManifest.review.evidenceState = 'UNTESTED';
  const issues = validateHazardAssurancePacket(fixture);
  assert.ok(issues.some((entry) => entry.code === 'DENOMINATOR_FINGERPRINT_MISMATCH'));
  assert.ok(issues.some((entry) => entry.code === 'OWNER_REVIEW_EVIDENCE_UNTESTED'));
});

test('whitespace cannot stand in for an exact Atlas reproduction gap', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.atlasRows[0].reproduction = { fixtureId: null, exactGap: '   ' };
  const issues = validateHazardAssurancePacket(fixture);
  assert.ok(issues.some((entry) => entry.code === 'EXACT_GAP_MISSING'));
});

test('fixture contains no secret-bearing keys and remains visibly synthetic', () => {
  assert.deepEqual(findSecretLikePaths(COMPLETE_HAZARD_FIXTURE), []);
  assert.equal(COMPLETE_HAZARD_FIXTURE.truthLabel, 'SYNTHETIC_ONLY');
  assert.equal(COMPLETE_HAZARD_FIXTURE.atlasManifest.review.evidenceState, 'SYNTHETIC');
});

test('canonical serialization is stable and exported fixture data is deeply frozen', () => {
  const first = buildCompleteHazardFixture();
  const second = buildCompleteHazardFixture();
  assert.equal(canonicalStringify(first), canonicalStringify(second));
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.hazards), true);
  assert.equal(Object.isFrozen(first.hazards[0].controlStructure), true);
  assert.throws(() => {
    first.hazards.push({});
  }, TypeError);
});

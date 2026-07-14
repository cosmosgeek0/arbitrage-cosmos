import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTION_EVIDENCE_CLASSES,
  ACTION_EVIDENCE_SCHEMA,
  ACTION_EVIDENCE_FIXTURE_BUNDLE_SCHEMA,
  ACTION_EVIDENCE_RESULT_SCHEMA,
  ACTION_EVIDENCE_USE_PROJECTION_SCHEMA,
  ACTION_EVIDENCE_USE_REQUEST_SCHEMA,
  COMPLETE_ACTION_EVIDENCE_FIXTURE_BUNDLE,
  FIXTURE_NOW_MS,
  FROZEN_ACTION_BINDINGS,
  REQUIRED_EVIDENCE_FAMILIES,
  buildActionEvidenceEnvelope,
  buildForgedApprovalEnvelope,
  buildForgedAuthorityEffectEnvelope,
  clonePlain,
  evaluateActionEvidenceEnvelope,
  validateActionEvidenceEnvelope,
  validateActionEvidenceFixtureBundle,
} from '../../../../fixtures/productAssurance/systemic/actionEvidence/index.mjs';

test('single-action and fixture-bundle schemas are closed and honestly labeled', () => {
  assert.equal(ACTION_EVIDENCE_SCHEMA.additionalProperties, false);
  assert.equal(ACTION_EVIDENCE_FIXTURE_BUNDLE_SCHEMA.additionalProperties, false);
  assert.equal(ACTION_EVIDENCE_SCHEMA.properties.truthLabel.const, 'SYNTHETIC_ONLY');
  assert.equal(ACTION_EVIDENCE_SCHEMA.properties.useClass.const, 'SUPPORTING_EVIDENCE_ONLY');
  assert.equal(ACTION_EVIDENCE_SCHEMA.properties.authorityEffect.const, 'NONE');
});

test('exported schemas close every nested record, result, request, and projection shape', () => {
  const definitions = ACTION_EVIDENCE_SCHEMA.$defs;
  for (const name of [
    'Actor', 'EvidenceReference', 'OwnerDecisionReference', 'TemporalSource',
    'TemporalContext', 'FencingContext', 'ScenarioEnvelope', 'EvidenceFamily',
    'ActiveAssumption', 'InvariantResult', 'Invalidation',
  ]) {
    assert.equal(definitions[name].additionalProperties, false, name);
  }
  assert.equal(definitions.ActionEvidenceRecord.oneOf.length, ACTION_EVIDENCE_CLASSES.length);
  for (const actionClass of ACTION_EVIDENCE_CLASSES) {
    assert.equal(definitions[`Identity_${actionClass}`].additionalProperties, false);
    assert.equal(definitions[`ActionFacts_${actionClass}`].additionalProperties, false);
    assert.equal(definitions[`Versions_${actionClass}`].additionalProperties, false);
    const record = definitions[`Record_${actionClass}`];
    assert.equal(record.additionalProperties, false);
    assert(record.required.includes('subjectDigest'));
    assert(record.required.includes('activeAssumptions'));
    assert(record.required.includes('invariantResults'));
    assert.equal(record.properties.families.allOf.length, REQUIRED_EVIDENCE_FAMILIES[actionClass].length);
  }
  assert.equal(ACTION_EVIDENCE_RESULT_SCHEMA.additionalProperties, false);
  assert.equal(ACTION_EVIDENCE_RESULT_SCHEMA.properties.familyResults.items.additionalProperties, false);
  assert.equal(ACTION_EVIDENCE_USE_REQUEST_SCHEMA.additionalProperties, false);
  assert.equal(
    ACTION_EVIDENCE_USE_REQUEST_SCHEMA.properties.purpose.const,
    'SUPPORTING_EVIDENCE_ONLY',
  );
  assert.equal(ACTION_EVIDENCE_RESULT_SCHEMA.properties.reasonCodes.maxItems, 32);
  assert.equal(
    ACTION_EVIDENCE_RESULT_SCHEMA.properties.familyResults.items.properties.reasonCodes.maxItems,
    32,
  );
  assert.equal(ACTION_EVIDENCE_USE_PROJECTION_SCHEMA.additionalProperties, false);
  assert.equal(
    ACTION_EVIDENCE_USE_PROJECTION_SCHEMA.properties.familyStatuses.items.additionalProperties,
    false,
  );
});

test('complete fixture bundle validates with exactly one envelope per class', () => {
  const validation = validateActionEvidenceFixtureBundle(COMPLETE_ACTION_EVIDENCE_FIXTURE_BUNDLE);
  assert.deepEqual(validation, { valid: true, issues: [] });
  assert.deepEqual(
    COMPLETE_ACTION_EVIDENCE_FIXTURE_BUNDLE.envelopes.map((entry) => entry.record.actionClass).sort(),
    [...ACTION_EVIDENCE_CLASSES].sort(),
  );
});

test('every single-action envelope validates independently', () => {
  for (const actionClass of ACTION_EVIDENCE_CLASSES) {
    assert.deepEqual(validateActionEvidenceEnvelope(buildActionEvidenceEnvelope(actionClass)), {
      valid: true,
      issues: [],
    });
  }
});

test('each class binds the exact frozen L discriminant', () => {
  for (const actionClass of ACTION_EVIDENCE_CLASSES) {
    const envelope = buildActionEvidenceEnvelope(actionClass);
    assert.deepEqual(envelope.record.actionBinding, FROZEN_ACTION_BINDINGS[actionClass]);
  }
  assert.equal(FROZEN_ACTION_BINDINGS.ORDER_INTENT.discriminantValue, 'PLACE');
  assert.equal(FROZEN_ACTION_BINDINGS.CANCELLATION.discriminantValue, 'CANCEL');
  assert.equal(FROZEN_ACTION_BINDINGS.REPAIR_STEP.discriminantValue, 'SAFE_RESTART_COMPONENT');
  assert.equal(FROZEN_ACTION_BINDINGS.HALT.discriminantValue, 'HALT');
  assert.equal(FROZEN_ACTION_BINDINGS.RECOVERY_STEP.discriminantValue, 'RECOVER');
});

test('missing required family is invalid and cannot pass', () => {
  const envelope = clonePlain(buildActionEvidenceEnvelope('HALT'));
  envelope.record.families.pop();
  const validation = validateActionEvidenceEnvelope(envelope);
  assert.equal(validation.valid, false);
  assert(validation.issues.some((entry) => entry.code === 'REQUIRED_EVIDENCE_FAMILY_SET_MISMATCH'));
  assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'UNKNOWN');
});

test('extra unknown family is invalid and cannot pass', () => {
  const envelope = clonePlain(buildActionEvidenceEnvelope('HALT'));
  envelope.record.families.push({
    ...clonePlain(envelope.record.families[0]),
    family: 'ACTION_APPROVAL',
    evidenceIds: ['PA-S2-EV-HA-FORBIDDEN'],
  });
  const validation = validateActionEvidenceEnvelope(envelope);
  assert.equal(validation.valid, false);
  assert(validation.issues.some((entry) => entry.code === 'REQUIRED_EVIDENCE_FAMILY_SET_MISMATCH'));
  assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'UNKNOWN');
});

test('cross-class schema mismatch is diagnostic UNKNOWN, never approval evidence', () => {
  const envelope = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
  envelope.record.actionBinding = clonePlain(FROZEN_ACTION_BINDINGS.CANCELLATION);
  const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('ACTION_BINDING_MISMATCH'));
  assert.equal(result.authorityEffect, 'NONE');
});

test('forged approval and authority-effect fields are rejected', () => {
  for (const envelope of [buildForgedApprovalEnvelope(), buildForgedAuthorityEffectEnvelope()]) {
    const validation = validateActionEvidenceEnvelope(envelope);
    assert.equal(validation.valid, false);
    assert.notEqual(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'PASS');
  }
});

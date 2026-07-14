import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTION_EVIDENCE_CLASSES,
  COMPLETE_ACTION_EVIDENCE_FIXTURE_BUNDLE,
  FIXTURE_NOW_MS,
  REQUIRED_EVIDENCE_FAMILIES,
  buildActionEvidenceEnvelope,
  clonePlain,
  evaluateActionEvidenceEnvelope,
} from '../../../../fixtures/productAssurance/systemic/actionEvidence/index.mjs';

test('each frozen-L action class derives a standalone PASS evidence record', () => {
  for (const envelope of COMPLETE_ACTION_EVIDENCE_FIXTURE_BUNDLE.envelopes) {
    const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
    assert.equal(result.status, 'PASS', envelope.record.actionClass);
    assert.equal(result.actionClass, envelope.record.actionClass);
    assert.equal(result.recordId, envelope.record.recordId);
    assert.equal(result.authorityEffect, 'NONE');
    assert.equal(result.commandsIssued, 0);
  }
});

test('fixture bundle has no cross-action status, comparison, or ranking output', () => {
  assert.equal(Object.hasOwn(COMPLETE_ACTION_EVIDENCE_FIXTURE_BUNDLE, 'status'), false);
  assert.equal(Object.hasOwn(COMPLETE_ACTION_EVIDENCE_FIXTURE_BUNDLE, 'rank'), false);
  assert.equal(Object.hasOwn(COMPLETE_ACTION_EVIDENCE_FIXTURE_BUNDLE, 'decision'), false);
});

test('every class reports every and only its required family explicitly', () => {
  for (const actionClass of ACTION_EVIDENCE_CLASSES) {
    const result = evaluateActionEvidenceEnvelope(buildActionEvidenceEnvelope(actionClass), FIXTURE_NOW_MS);
    assert.deepEqual(
      result.familyResults.map((entry) => entry.family).sort(),
      [...REQUIRED_EVIDENCE_FAMILIES[actionClass]].sort(),
    );
    assert(result.familyResults.every((entry) => entry.status === 'PASS'));
  }
});

test('repair evidence binds only safe reconcile-first control-plane restart', () => {
  const identity = buildActionEvidenceEnvelope('REPAIR_STEP').record.identity;
  assert.equal(identity.componentId, 'control-plane-runtime');
  assert.equal(identity.restartMode, 'SAFE_RECONCILE_FIRST');
});

test('halt evidence preserves NEW_RISK scope and supervision', () => {
  const identity = buildActionEvidenceEnvelope('HALT').record.identity;
  assert.equal(identity.scope, 'NEW_RISK');
  assert.equal(identity.retainSupervision, true);
});

test('recovery evidence is exact, fill-bound, and risk-reducing only', () => {
  const identity = buildActionEvidenceEnvelope('RECOVERY_STEP').record.identity;
  assert.equal(identity.quantitySource, 'RISK_REDUCING_RECOVERY_EVIDENCE');
  assert.equal(identity.exposureEffect, 'RISK_REDUCING_ONLY');
  assert.match(identity.actualFillLegId, /actual_fill/);
});

test('CANCEL_PENDING is not cancellation completion evidence', () => {
  const envelope = clonePlain(buildActionEvidenceEnvelope('CANCELLATION'));
  envelope.record.actionFacts.cancellationState = 'CANCEL_PENDING';
  envelope.record.actionFacts.terminalAtMs = null;
  assert(envelope.record.families.every((entry) => entry.assertion === 'SATISFIED'));
  const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('CANCEL_PENDING_NOT_TERMINAL'));
});

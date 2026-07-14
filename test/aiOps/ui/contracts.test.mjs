import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ABSOLUTE_HARD_DENIALS,
  AI_OPS_CONTROL_CATEGORIES,
  FORBIDDEN_CAPABILITY_REACHABILITY,
  buildAiOpsControlSpecificationProjection,
  projectNarrowingControlIntent,
  validateControlSpecificationProjection,
} from '../../../web/src/aiOps/controlProjection.ts';
import { buildAiOpsShadowFixture } from '../../../web/src/aiOps/fixture.ts';

const manifestUrl = new URL('../../../fixtures/aiOps/ui/ai-ops-shadow-fixture.v1.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));

test('fixture builds deterministically from the checked-in manifest and is deeply frozen', () => {
  const first = buildAiOpsShadowFixture(manifest);
  const second = buildAiOpsShadowFixture(manifest);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.controls));
  assert.ok(Object.isFrozen(first.controls[0].envelope));
  assert.equal(first.posture, 'SHADOW_SPECULATIVE');
  assert.equal(first.environment, 'SYNTHETIC_FIXTURE');
  assert.equal(first.mountState, 'DIRECTOR_MOUNT_REQUIRED');
  assert.equal(first.baseSha, '03857dcdaff8d8b12627d27ddcc97505da1f2f86');
});

test('fixture identities are obviously fake and real-looking identities are rejected', () => {
  assert.match(manifest.obviousFakeProvider, /\.invalid$/);
  assert.match(manifest.obviousFakeModel, /^fixture-/);
  assert.throws(
    () => buildAiOpsShadowFixture({ ...manifest, obviousFakeProvider: 'api.openai.com' }),
    /AI_OPS_FIXTURE_IDENTITY_MUST_BE_OBVIOUSLY_FAKE/,
  );
  assert.throws(
    () => buildAiOpsShadowFixture({ ...manifest, obviousFakeModel: 'production-model' }),
    /AI_OPS_FIXTURE_IDENTITY_MUST_BE_OBVIOUSLY_FAKE/,
  );
  assert.throws(
    () => buildAiOpsShadowFixture({ ...manifest, requestedControlIntents: { 'LIVE_CONTROL.A01': true } }),
    /AI_OPS_FIXTURE_REQUESTED_CONTROL_ID_INVALID/,
  );
});

test('the directive specification catalog contains exactly A01 through L10, ten controls per category', () => {
  const controls = buildAiOpsControlSpecificationProjection({
    generatedAt: manifest.generatedAt,
    provider: manifest.obviousFakeProvider,
    model: manifest.obviousFakeModel,
    requestedControlIntents: manifest.requestedControlIntents,
  });
  assert.equal(AI_OPS_CONTROL_CATEGORIES.length, 12);
  assert.equal(controls.length, 120);
  assert.equal(new Set(controls.map((control) => control.controlId)).size, 120);
  for (const category of AI_OPS_CONTROL_CATEGORIES) {
    assert.equal(category.controls.length, 10, category.code);
    assert.deepEqual(
      controls.filter((control) => control.category === category.code).map((control) => control.controlId),
      Array.from({ length: 10 }, (_, index) => `AI_OPS.${category.code}${String(index + 1).padStart(2, '0')}`),
    );
  }
  assert.deepEqual(validateControlSpecificationProjection(controls), []);
});

test('every specification row reserves complete authority fields without fabricating canonical values', () => {
  const snapshot = buildAiOpsShadowFixture(manifest);
  for (const control of snapshot.controls) {
    assert.match(control.controlId, /^AI_OPS\.[A-L](?:0[1-9]|10)$/);
    assert.ok(control.owner);
    assert.ok(control.type);
    assert.deepEqual(control.allowedValues, []);
    assert.equal(control.safeDefault, null);
    assert.ok(control.scope);
    assert.ok(control.environment);
    assert.ok(control.modeCeiling);
    assert.ok(control.approvalRequirement);
    assert.ok(control.revision);
    assert.ok(control.lastChangedBy);
    assert.ok(control.reason);
    assert.ok(control.envelope.envelopeId);
    assert.equal(control.envelope.policyRevision, 'UNMOUNTED');
    assert.deepEqual(control.envelope.requestableValues, []);
    assert.deepEqual(control.envelope.authorityOrder, []);
    assert.equal(control.envelope.maximumAuthorityValue, null);
    assert.equal(control.envelope.hardDenialsRemainUnreachable, true);
    assert.equal(control.currentStatus, 'NOT_WIRED');
    assert.equal(control.effectHandler, null);
    assert.equal(control.readbackHandler, null);
    assert.equal(control.effective, null);
    assert.equal(control.readback, null);
    assert.equal(control.source.wiring, 'FIXTURE_ONLY');
  }
});

test('no local value can bypass missing server envelope, effect, or readback handlers', () => {
  const snapshot = buildAiOpsShadowFixture(manifest);
  const control = snapshot.controls.find((row) => row.controlId === 'AI_OPS.A01');
  assert.ok(control);
  const draft = projectNarrowingControlIntent(control, true);
  assert.equal(draft.disposition, 'NOT_WIRED');
  assert.equal(draft.authorityCreated, false);
  assert.equal(draft.effectiveUnchanged, true);
  assert.equal(draft.readbackRequired, true);
});

test('an owner-supplied maximum-authority envelope admits only values at or below its maximum', () => {
  const snapshot = buildAiOpsShadowFixture(manifest);
  const control = snapshot.controls.find((row) => row.controlId === 'AI_OPS.A01');
  assert.ok(control);
  const mountedProjection = {
    ...control,
    allowedValues: [false, true],
    currentStatus: 'SYNTHETIC_READBACK',
    effectHandler: 'fixture:server-effect-handler',
    readbackHandler: 'fixture:independent-readback-handler',
    envelope: {
      ...control.envelope,
      envelopeId: 'fixture-owner-envelope-a01',
      policyRevision: 'fixture-owner-policy-r1',
      requestableValues: [false],
      authorityOrder: [false, true],
      maximumAuthorityValue: false,
    },
  };
  const narrowerDraft = projectNarrowingControlIntent(mountedProjection, false);
  assert.equal(narrowerDraft.disposition, 'PENDING_SERVER_POLICY');
  assert.equal(narrowerDraft.authorityCreated, false);
  assert.equal(narrowerDraft.effectiveUnchanged, true);
  const wideningDraft = projectNarrowingControlIntent(mountedProjection, true);
  assert.equal(wideningDraft.disposition, 'CLIENT_NARROWING_REJECTED');
  assert.equal(wideningDraft.authorityCreated, false);

  const malformedEnvelope = {
    ...mountedProjection,
    envelope: { ...mountedProjection.envelope, requestableValues: [false, true] },
  };
  assert.deepEqual(validateControlSpecificationProjection([malformedEnvelope]), [
    'EXPECTED_120_CONTROLS_GOT_1',
    'MISSING_REQUIRED_CONTROL_ID',
    'WIDENING_ENVELOPE_VALUE:AI_OPS.A01',
  ]);
});

test('immutable safety-floor controls cannot be weakened by a client request', () => {
  const snapshot = buildAiOpsShadowFixture(manifest);
  for (const controlId of ['AI_OPS.E10', 'AI_OPS.F09', 'AI_OPS.H05', 'AI_OPS.L09', 'AI_OPS.L10']) {
    const control = snapshot.controls.find((row) => row.controlId === controlId);
    assert.ok(control, controlId);
    const draft = projectNarrowingControlIntent(control, false);
    assert.equal(draft.disposition, 'LOCKED_INVARIANT', controlId);
    assert.equal(draft.authorityCreated, false, controlId);
    assert.equal(control.effective, null, controlId);
    assert.equal(control.readback, null, controlId);
    assert.equal(control.currentStatus, 'NOT_WIRED', controlId);
  }
});

test('maximum-looking requests across all 120 rows cannot create authority or reach hard denials', () => {
  const snapshot = buildAiOpsShadowFixture(manifest);
  for (const control of snapshot.controls) {
    const maximumProjectedValue = control.envelope.requestableValues.at(-1) ?? null;
    const draft = projectNarrowingControlIntent(control, maximumProjectedValue);
    assert.equal(draft.authorityCreated, false, control.controlId);
    assert.equal(draft.effectiveUnchanged, true, control.controlId);
    assert.notEqual(draft.disposition, 'PENDING_SERVER_POLICY', `${control.controlId} is fixture-unwired and must not become submit-ready`);
  }
  assert.equal(ABSOLUTE_HARD_DENIALS.length, 12);
  assert.deepEqual(ABSOLUTE_HARD_DENIALS, [
    'DIRECT_ORDER_ACTION',
    'BORROW_REPAY_TRANSFER_WITHDRAW',
    'RISK_OR_CAPITAL_MUTATION',
    'PRIVATE_CREDENTIAL_ACCESS',
    'PERMISSION_OR_GUARDRAIL_SELF_CHANGE',
    'EVIDENCE_OR_LEDGER_REWRITE',
    'MAIN_OR_LIVE_RUNTIME_WRITE',
    'SELF_APPROVAL_OR_SELF_VERIFICATION',
    'SELF_MERGE_OR_DEPLOY',
    'ARBITRARY_SHELL_NETWORK_OR_FILESYSTEM',
    'DISABLE_SAFETY_MONITORING_OR_RECONCILIATION',
    'CREATE_DUPLICATE_CONTROL_RISK_EXECUTION_OR_LEDGER_AUTHORITY',
  ]);
  assert.deepEqual(Object.values(FORBIDDEN_CAPABILITY_REACHABILITY), Array(12).fill(false));
});

test('requested, effective, and readback states remain distinct for the shadow-mode request', () => {
  const snapshot = buildAiOpsShadowFixture(manifest);
  const mode = snapshot.controls.find((control) => control.controlId === 'AI_OPS.A02');
  assert.ok(mode);
  assert.equal(mode.requested, 'SHADOW');
  assert.equal(mode.effective, null);
  assert.equal(mode.readback, null);
  assert.equal(mode.changedFromSafeDefault, false);
  assert.equal(mode.currentStatus, 'NOT_WIRED');
});

test('unknown canonical values remain null rather than fabricated zeroes', () => {
  const snapshot = buildAiOpsShadowFixture(manifest);
  const leases = snapshot.safetySummary.find((fact) => fact.id === 'safety-leases');
  const reconciliation = snapshot.trends.find((series) => series.seriesId === 'reconciliation-gap');
  const dropped = snapshot.trends.find((series) => series.seriesId === 'dropped-events');
  const providerCost = snapshot.trends.find((series) => series.seriesId === 'provider-cost');
  assert.equal(leases?.value, null);
  assert.ok(reconciliation?.samples.every((sample) => sample.value === null));
  assert.ok(dropped?.samples.every((sample) => sample.value === null));
  assert.ok(providerCost?.samples.every((sample) => sample.value === null));
  assert.equal(snapshot.refreshDock.effective, null);
  assert.equal(snapshot.refreshDock.readback, null);
});

test('the fixture has no operational effect, money, secret, or self-approval capability', () => {
  const snapshot = buildAiOpsShadowFixture(manifest);
  assert.ok(snapshot.incidents[0].commands.every((command) => command.authorityCreated === false));
  assert.equal(snapshot.emergencyKill.authorityCreated, false);
  assert.equal(snapshot.refreshDock.authorityCreated, false);
  assert.equal(snapshot.emergencyKill.selfReenableAllowed, false);
  assert.equal(snapshot.emergencyKill.evidenceRetentionContinues, true);
  assert.equal(snapshot.safetySummary.find((fact) => fact.id === 'safety-money')?.value, 'NO_AI_AUTHORITY');
  assert.ok(snapshot.components.every((component) => component.posture !== 'READY'));
  assert.ok(snapshot.controls.every((control) => control.effective === null && control.readback === null));
});

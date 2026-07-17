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
import {
  DEFAULT_AI_OPS_FIXTURE_MANIFEST,
  buildAiOpsShadowFixture,
} from '../../../web/src/aiOps/fixture.ts';

const manifestUrl = new URL('../../../fixtures/aiOps/a4/ai-ops-shadow-fixture.v1.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));

test('fixture builds deterministically from the checked-in manifest and is deeply frozen', () => {
  assert.deepEqual(DEFAULT_AI_OPS_FIXTURE_MANIFEST, manifest);
  const first = buildAiOpsShadowFixture(manifest);
  const second = buildAiOpsShadowFixture(manifest);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.controls));
  assert.ok(Object.isFrozen(first.controls[0].envelope));
  assert.ok(Object.isFrozen(first.incidents[0].suppression));
  assert.ok(Object.isFrozen(first.incidents[0].diagnosticValidation.checks));
  assert.ok(Object.isFrozen(first.incidents[0].forensicBundle.artifacts));
  assert.ok(Object.isFrozen(first.providerQualifications));
  assert.ok(Object.isFrozen(first.capabilityGraduations[0].metrics));
  assert.ok(Object.isFrozen(first.contextManifest.authorityPointers));
  assert.ok(Object.isFrozen(first.evidenceCatalog));
  assert.ok(Object.isFrozen(first.lineage.checkpointIds));
  assert.ok(Object.isFrozen(first.emergencyKill.postconditions));
  assert.equal(first.schema, 'AiOpsShadowFixtureV1');
  assert.equal(first.posture, 'SHADOW_SPECULATIVE');
  assert.equal(first.environment, 'SYNTHETIC_FIXTURE');
  assert.equal(first.mountState, 'DIRECTOR_MOUNT_REQUIRED');
  assert.equal(first.baseSha, '03857dcdaff8d8b12627d27ddcc97505da1f2f86');
  assert.equal(first.extensionBaseSha, 'b5f4c478223796cf7f9d73ba8c424a179aaa8551');
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
    () => buildAiOpsShadowFixture({ ...manifest, extensionBaseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
    /AI_OPS_FIXTURE_EXTENSION_BASE_SHA_MISMATCH/,
  );
  assert.throws(
    () => buildAiOpsShadowFixture({ ...manifest, baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
    /AI_OPS_FIXTURE_SHADOW_BASE_SHA_MISMATCH/,
  );
  assert.throws(
    () => buildAiOpsShadowFixture({ ...manifest, obviousFakeProvider: 'https:\/\/fixture-provider.invalid' }),
    /AI_OPS_FIXTURE_IDENTITY_MUST_BE_OBVIOUSLY_FAKE/,
  );
  assert.throws(
    () => buildAiOpsShadowFixture({ ...manifest, obviousFakeProvider: 'user@fixture-provider.invalid' }),
    /AI_OPS_FIXTURE_IDENTITY_MUST_BE_OBVIOUSLY_FAKE/,
  );
  assert.throws(
    () => buildAiOpsShadowFixture({ ...manifest, requestedControlIntents: { 'LIVE_CONTROL.A01': true } }),
    /AI_OPS_FIXTURE_REQUESTED_CONTROL_INTENTS_INVALID/,
  );
  assert.throws(
    () => buildAiOpsShadowFixture({ ...manifest, requestedControlIntents: { 'AI_OPS.A02': true } }),
    /AI_OPS_FIXTURE_REQUESTED_CONTROL_INTENTS_INVALID/,
  );
  assert.throws(
    () => buildAiOpsShadowFixture({ ...manifest, generatedAt: '2026-07-14T12:00:00Z' }),
    /AI_OPS_FIXTURE_SCENARIO_MISMATCH/,
  );
  assert.throws(
    () => buildAiOpsShadowFixture({ ...manifest, unexpected: true }),
    /AI_OPS_FIXTURE_MANIFEST_KEYS_INVALID/,
  );
  assert.throws(
    () => buildAiOpsShadowFixture(null),
    /AI_OPS_FIXTURE_MANIFEST_SHAPE_INVALID/,
  );
  assert.throws(
    () => buildAiOpsShadowFixture({ ...manifest, version: '1' }),
    /AI_OPS_FIXTURE_MANIFEST_UNSUPPORTED/,
  );
  assert.throws(
    () => buildAiOpsShadowFixture({ ...manifest, fixtureId: 'FIXTURE-CASE-A4-0001' }),
    /AI_OPS_FIXTURE_IDENTITY_MISMATCH/,
  );
  assert.throws(
    () => buildAiOpsShadowFixture({ ...manifest, selectedCaseId: 'FIXTURE-CASE-A4-0002' }),
    /AI_OPS_FIXTURE_IDENTITY_MISMATCH/,
  );
  assert.throws(
    () => buildAiOpsShadowFixture({ ...manifest, scenario: 'PROVIDER_OK' }),
    /AI_OPS_FIXTURE_SCENARIO_MISMATCH/,
  );
  assert.throws(
    () => buildAiOpsShadowFixture({ ...manifest, requestedControlIntents: [] }),
    /AI_OPS_FIXTURE_REQUESTED_CONTROL_INTENTS_REQUIRED/,
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

test('optional AI unavailability never fabricates deterministic core degradation', () => {
  const snapshot = buildAiOpsShadowFixture(manifest);
  const product = snapshot.safetySummary.find((fact) => fact.id === 'safety-product');
  const aiPlane = snapshot.safetySummary.find((fact) => fact.id === 'safety-ai');
  assert.equal(aiPlane?.posture, 'NOT_WIRED');
  assert.equal(product?.value, 'UNKNOWN');
  assert.equal(product?.posture, 'UNKNOWN');
  assert.notEqual(product?.posture, 'DEGRADED');
});

test('cockpit inventory counts are derived from the bounded component catalog', () => {
  const snapshot = buildAiOpsShadowFixture(manifest);
  const inventory = snapshot.cockpit.find((level) => level.levelId === 'L2_INVENTORY_DEPENDENCY_GRAPH');
  const factValue = (id) => inventory?.facts.find((fact) => fact.id === id)?.value;
  assert.equal(snapshot.components.length, 14);
  assert.equal(snapshot.components.filter((component) => component.reporting === true).length, 3);
  assert.equal(factValue('l2-expected'), snapshot.components.length);
  assert.equal(factValue('l2-reporting'), 3);
  assert.equal(
    factValue('l2-missing'),
    snapshot.components.filter((component) => component.discovered === false).length,
  );
});

test('every cited and validated evidence identity resolves to one bounded fixture catalog row', () => {
  const snapshot = buildAiOpsShadowFixture(manifest);
  const catalogIds = new Set(snapshot.evidenceCatalog.map((entry) => entry.evidenceId));
  assert.equal(catalogIds.size, snapshot.evidenceCatalog.length);
  assert.ok(snapshot.evidenceCatalog.every((entry) => entry.bounded && entry.posture === 'SYNTHETIC_ONLY'));
  const validatedIds = [
    ...snapshot.incidents.flatMap((incident) => [
      ...incident.diagnosticValidation.validatedEvidenceIds,
      ...incident.diagnosticValidation.checks
        .filter((check) => check.disposition === 'VALIDATED')
        .flatMap((check) => check.evidenceIds),
    ]),
    ...snapshot.contextManifest.validatedEvidenceIds,
  ];
  assert.ok(validatedIds.length > 0);
  assert.ok(validatedIds.every((evidenceId) => catalogIds.has(evidenceId)));
});

test('incident funnel preserves raw evidence while every suppression and actionability decision stays fail-closed', () => {
  const incident = buildAiOpsShadowFixture(manifest).incidents[0];
  assert.equal(incident.suppression.rawEventCount, 8);
  assert.equal(incident.suppression.deduplicatedCount, 7);
  assert.equal(incident.suppression.dependencyRootIncidentId, 'FIXTURE-INCIDENT-A4-0001');
  assert.equal(incident.suppression.inhibitedBy, 'provider-gateway');
  assert.equal(incident.suppression.inhibitedSymptomIds.length, 2);
  assert.equal(incident.suppression.childEvidencePreserved, true);
  assert.equal(incident.suppression.silenceWindow.status, 'UNKNOWN');
  assert.equal(incident.suppression.disposition, 'UNKNOWN');
  assert.equal(incident.suppression.criticalReserve, 'UNKNOWN');
  assert.equal(incident.suppression.actionable, null);
  assert.equal(incident.suppression.resourceCooldownUntil, null);
  assert.equal(incident.suppression.globalCooldownUntil, null);
  assert.equal(incident.suppression.backoffAttempt, null);
  assert.equal(incident.suppression.jitterMs, null);
  assert.deepEqual(incident.suppression.actionReceipts.map((receipt) => receipt.action), [
    'PAGE', 'TICKET', 'DIGEST', 'SUPPRESSION', 'INHIBITION', 'DISCARD',
  ]);
  assert.ok(incident.suppression.actionReceipts.every((receipt) => receipt.receiptId === null));
  assert.deepEqual(incident.suppression.actionabilityMetrics, {
    duplicateRate: null,
    pagesPerIncident: null,
    inhibitedSymptoms: 2,
    falsePageRate: null,
    acknowledgementLatencyMs: null,
    unresolvedAgeMs: null,
    ownerFeedback: null,
  });
  assert.match(incident.suppression.rawEventEscapeRef, /^fixture:/);
});

test('diagnostic validation and forensic drill-down expose mixed proof without authorizing an effect', () => {
  const incident = buildAiOpsShadowFixture(manifest).incidents[0];
  assert.equal(incident.diagnosticValidation.disposition, 'INCONCLUSIVE');
  assert.equal(incident.diagnosticValidation.effectAuthorized, false);
  assert.match(incident.diagnosticValidation.sourceHash, /^sha256:fixture-/);
  assert.match(incident.diagnosticValidation.parserRevision, /^fixture-/);
  assert.match(incident.diagnosticValidation.sanitizerRevision, /^fixture-/);
  assert.equal(incident.diagnosticValidation.extractionMethod, 'DETERMINISTIC_FIXTURE_FIELDS');
  assert.equal(incident.diagnosticValidation.confidence, null);
  assert.equal(incident.diagnosticValidation.freshness, 'STALE_94S');
  assert.match(incident.diagnosticValidation.temporalRelation, /FIXTURE_ONLY$/);
  assert.deepEqual(
    new Set(incident.diagnosticValidation.checks.map((check) => check.disposition)),
    new Set(['VALIDATED', 'INVALIDATED', 'INCONCLUSIVE']),
  );
  assert.equal(incident.diagnosticValidation.missingEvidence.length, 4);
  assert.ok(incident.diagnosticValidation.conflictingEvidence.length > 0);
  assert.ok(incident.diagnosticValidation.falsificationTests.length > 0);
  assert.match(incident.diagnosticValidation.stopCondition, /No operational effect/);
  assert.equal(incident.forensicBundle.rawStreamSentToModel, false);
  assert.equal(incident.forensicBundle.artifacts.length, 7);
  assert.ok(incident.forensicBundle.artifacts.every((artifact) => artifact.bounded === true));
  assert.ok(incident.forensicBundle.artifacts.some((artifact) => artifact.posture === 'MISSING'));
  assert.equal(incident.forensicBundle.postmortem.required, true);
  assert.equal(incident.forensicBundle.postmortem.status, 'NOT_CONFIGURED');
});

test('context manifest and session lineage are explicit, bounded, and forbid hidden cross-session memory', () => {
  const snapshot = buildAiOpsShadowFixture(manifest);
  assert.equal(snapshot.lineage.contextManifestId, snapshot.contextManifest.manifestId);
  assert.equal(snapshot.lineage.hiddenCrossSessionMemoryAllowed, false);
  assert.equal(snapshot.lineage.replacementReason, 'INITIAL_SESSION');
  assert.equal(snapshot.lineage.generation, 1);
  assert.equal(snapshot.lineage.childAgentLimit, 0);
  assert.equal(snapshot.lineage.toolDepthLimit, 0);
  assert.ok(snapshot.lineage.checkpointIds.length > 0);
  assert.equal(snapshot.contextManifest.signatureStatus, 'UNSIGNED_FIXTURE');
  assert.equal(snapshot.contextManifest.generationStatus, 'FAIL_CLOSED_UNRESOLVED_POINTERS');
  assert.equal(snapshot.contextManifest.baseSha, manifest.extensionBaseSha);
  assert.equal(snapshot.contextManifest.promptRevision, 'fixture-prompt-r1');
  assert.equal(snapshot.contextManifest.providerQualificationRevision, 'UNMOUNTED');
  assert.equal(snapshot.contextManifest.evidenceAgeLimitMs, 30000);
  assert.ok(snapshot.contextManifest.authorityPointers.every((pointer) => pointer.status === 'UNRESOLVED' && pointer.blobHash === null));
  assert.deepEqual(snapshot.contextManifest.allowedTools, []);
  assert.deepEqual(snapshot.contextManifest.writeScope, []);
  assert.deepEqual(snapshot.contextManifest.effectReceiptIds, []);
  assert.match(snapshot.contextManifest.stopCondition, /Stop when/);
});

test('provider qualification reflects supported activation states without credentials, API fallback, or implied graduation', () => {
  const snapshot = buildAiOpsShadowFixture(manifest);
  assert.deepEqual(snapshot.providerQualifications.map((route) => route.activationState), [
    'DIAGNOSTIC_PLANE_UNAVAILABLE',
    'SUBSCRIPTION_CODEX_WORKER',
    'SUBSCRIPTION_CLAUDE_CODE_WORKER',
    'NOT_CONFIGURED',
  ]);
  assert.ok(snapshot.providerQualifications.every((route) => route.provider.endsWith('.invalid')));
  assert.ok(snapshot.providerQualifications.every((route) => route.qualification !== 'QUALIFIED'));
  assert.ok(snapshot.providerQualifications.every((route) => route.fallbackRouteId === null));
  assert.ok(snapshot.providerQualifications.every((route) => route.credentialPosture === 'NOT_CONFIGURED'));
  assert.match(snapshot.providerQualifications[1].blockedReasons.join(' '), /must not fall back to API billing or another account/);
  assert.match(snapshot.providerQualifications[2].blockedReasons.join(' '), /must not fall back to API billing or another account/);

  const graduation = snapshot.capabilityGraduations[0];
  assert.equal(graduation.currentMode, 'OFF');
  assert.equal(graduation.proposedMode, 'SHADOW');
  assert.equal(graduation.disposition, 'NO_PROMOTION');
  assert.equal(graduation.independentReviewer, null);
  assert.equal(graduation.metrics.length, 11);
  assert.ok(graduation.metrics.some((metric) => metric.metricId === 'FALSE_POSITIVE_RATE'));
  assert.ok(graduation.metrics.every((metric) => metric.result !== 'PASS'));
  assert.equal(graduation.posture, 'BLOCKED');
  assert.ok(graduation.demotionTriggers.length >= 5);
});

test('historical trend contracts are bounded, windowed, gap-preserving, and correlation-only', () => {
  const trends = buildAiOpsShadowFixture(manifest).trends;
  assert.ok(trends.length > 0);
  for (const series of trends) {
    assert.equal(series.window, 'PT30M');
    assert.equal(series.resolution, 'PT5M');
    assert.equal(series.sampleLimit, 6);
    assert.equal(series.samples.length, 6);
    assert.equal(series.shortWindow, 'PT5M');
    assert.equal(series.longWindow, 'PT1H');
    assert.equal(series.alertClass, 'UNKNOWN');
    assert.equal(series.shortWindowBurn, null);
    assert.equal(series.longWindowBurn, null);
    assert.equal(series.drilldownLimit, 1);
    assert.ok(series.drilldownRefs.length > 0);
    assert.ok(series.drilldownRefs.every((reference) => reference.startsWith('fixture:')));
  }
  assert.ok(trends.some((series) => series.samples.some((sample) => sample.value === null)));
});

test('emergency kill keeps desired, requested, effective, and independent readback authority distinct', () => {
  const kill = buildAiOpsShadowFixture(manifest).emergencyKill;
  assert.equal(kill.desired, 'ENGAGED');
  assert.equal(kill.requested, 'ENGAGED');
  assert.equal(kill.requestStatus, 'LOCAL_FIXTURE_ONLY');
  assert.equal(kill.effective, 'UNKNOWN');
  assert.equal(kill.readback, 'UNKNOWN');
  assert.equal(kill.readbackAgreement, null);
  assert.equal(kill.effectHandler, null);
  assert.equal(kill.readbackHandler, null);
  assert.equal(kill.receiptId, null);
  assert.equal(kill.independentlyObservedAt, null);
  assert.equal(kill.quietPeriodEndsAt, null);
  assert.equal(kill.selfReenableAllowed, false);
  assert.equal(kill.evidenceRetentionContinues, true);
  assert.equal(kill.financialKillAlias, false);
  assert.equal(kill.authorityCreated, false);
  assert.equal(kill.postconditions.length, 6);
  assert.ok(kill.postconditions.some((condition) => condition.value === 'REQUIRED'));
  assert.ok(kill.postconditions.filter((condition) => condition.value === null).every((condition) => condition.posture === 'UNKNOWN'));
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

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertNetworkPermissionDenied, loadContracts } from './_network-denied-env.mjs';

const contracts = await loadContracts();

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('A1X materializes every sealed template and numerical capability target without authority', () => {
  assert.equal(contracts.AI_OPS_RUNBOOK_MANIFEST_INSTANCES.length, 10);
  assert.equal(contracts.AI_OPS_CAPABILITY_GRADUATION_TARGET_INSTANCES.length, 17);
  assert.deepEqual(contracts.validateA1xConcreteInstances(), []);

  const templateActions = contracts.AI_OPS_RUNBOOK_TEMPLATES.map((row) => row.actionId).sort();
  const instanceActions = contracts.AI_OPS_RUNBOOK_MANIFEST_INSTANCES.map((row) => row.actionId).sort();
  assert.deepEqual(instanceActions, templateActions);
  const targetCapabilities = contracts.AI_OPS_CAPABILITY_GRADUATION_TARGET_INSTANCES.map((row) => row.capabilityId).sort();
  assert.deepEqual(targetCapabilities, contracts.AI_OPS_CAPABILITY_RELIABILITY_TARGETS.map((row) => row.target.capabilityId).sort());

  for (const instance of [
    ...contracts.AI_OPS_RUNBOOK_MANIFEST_INSTANCES,
    ...contracts.AI_OPS_CAPABILITY_GRADUATION_TARGET_INSTANCES,
  ]) {
    assert.equal(instance.sealedA1BaseSha, contracts.AI_OPS_A1X_SEALED_BASE_SHA);
    assert.equal(instance.authorityCreated, false);
    assert.equal(instance.ownerSignature.signatureState, 'OWNER_SIGNATURE_REQUIRED');
    assert.equal(instance.ownerSignature.signedPayloadDigest, instance.unsignedPayloadDigest);
    assert.equal(instance.ownerSignature.signerIdentityId, null);
    assert.equal(instance.ownerSignature.algorithm, null);
    assert.equal(instance.ownerSignature.keyReference, null);
    assert.equal(instance.ownerSignature.signatureBytesBase64Url, null);
  }
});

test('runbook manifests are action-specific, bounded, unsigned and effect-free', () => {
  const fingerprints = new Set();
  const parameterSignatures = new Set();
  for (const runbook of contracts.AI_OPS_RUNBOOK_MANIFEST_INSTANCES) {
    assert.equal(runbook.actionClass, 'A');
    assert.equal(runbook.registrationState, 'UNSIGNED_INACTIVE');
    assert.equal(runbook.executionBindingState, 'NOT_WIRED');
    assert.equal(runbook.ownerBindingState, 'MISSING_REQUIRED');
    assert.equal(runbook.selectorProviderState, 'NOT_CONFIGURED');
    assert.equal(runbook.selectorAuthority, 'RECOMMEND_ONLY');
    assert.equal(runbook.liveExecutionState, 'LIVE_EXECUTION_NOT_IMPLEMENTED');
    assert.equal(runbook.maximumBlastRadiusResources, 1);
    assert.equal(runbook.maximumEffects, 1);
    assert.equal(runbook.leaseRequired, true);
    assert.equal(runbook.fencingRequired, true);
    assert.equal(runbook.networkPermitted, false);
    assert.equal(runbook.credentialAccessPermitted, false);
    assert.equal(runbook.effectPermitted, false);
    assert.deepEqual(runbook.triggerIds, [`AI_OPS_TRIGGER_${runbook.actionId}`]);
    assert.ok(runbook.eligibleFingerprintPatterns.length > 0);
    assert.ok(runbook.preconditionIds.length > 0);
    assert.ok(runbook.typedParameters.length > 0);
    assert.equal(runbook.resourceSelectors.length, 1);
    assert.ok(runbook.conflictKeys.length > 0);
    assert.ok(runbook.independentPostconditionIds.length > 0);
    assert.ok(runbook.rollbackOrCompensationId.length > 0);
    assert.ok(runbook.manualFallbackId.length > 0);
    assert.ok(runbook.requiredTelemetryIds.length > 0);
    assert.ok(runbook.requiredEvidenceIds.length > 0);
    fingerprints.add(JSON.stringify(runbook.eligibleFingerprintPatterns));
    parameterSignatures.add(JSON.stringify(runbook.typedParameters));
  }
  assert.equal(fingerprints.size, contracts.AI_OPS_RUNBOOK_MANIFEST_INSTANCES.length);
  assert.equal(parameterSignatures.size, contracts.AI_OPS_RUNBOOK_MANIFEST_INSTANCES.length);
});

test('concrete instances bind exact read-only prestage draft identities', () => {
  const drafts = contracts.AI_OPS_PRESTAGE_DRAFT_REFERENCES;
  assert.equal(drafts.identity.branch, 'aiops-prestage-20260714');
  assert.equal(drafts.identity.commitSha, contracts.AI_OPS_PRESTAGE_DRAFT_COMMIT_SHA);
  assert.equal(drafts.identity.gitBlobSha1, '82c6ca2b6a166a512a61e978f5d9afb86dd7c1d6');
  assert.equal(drafts.identity.sha256, 'f177b6f2fcbb4668303996bfc50cf0517e1888fa62908675fdca2a4937b02cb7');
  assert.equal(drafts.reliabilityTargets.gitBlobSha1, '4097bb6a5234f4c5dc456dac4c9928e7ef3266c5');
  assert.equal(drafts.reliabilityTargets.sha256, '12196c54cc5cb81888b59fd0e388df129a79bc69a30c1d8e88421158ea537269');
  assert.equal(drafts.identity.readOnly, true);
  assert.equal(drafts.reliabilityTargets.readOnly, true);
});

test('Class A-D fixtures encode the four directive dispositions without effects', () => {
  const fixtures = contracts.AI_OPS_ACTION_CLASS_FIXTURE_INSTANCES;
  assert.deepEqual(fixtures.map((row) => row.requestedActionClass), ['A', 'B', 'C', 'D']);
  assert.deepEqual(fixtures.map((row) => row.expectedEffectiveActionClass), ['C', 'B', 'C', 'D']);
  assert.deepEqual(fixtures.map((row) => row.expectedDisposition), [
    'SHADOW_CANDIDATE_ONLY',
    'PROPOSAL_ONLY',
    'ISOLATED_PATCH_ONLY',
    'PERMANENTLY_DENIED',
  ]);
  for (const fixture of fixtures) {
    assert.equal(fixture.syntheticOnly, true);
    assert.equal(fixture.providerState, 'NOT_CONFIGURED');
    assert.equal(fixture.networkPermitted, false);
    assert.equal(fixture.credentialMaterialPresent, false);
    assert.equal(fixture.effectPermitted, false);
    assert.equal(fixture.authorityCreated, false);
  }
  const denied = fixtures.find((row) => row.requestedActionClass === 'D');
  assert.equal(denied.actionId, 'SIGN_ORDER');
  assert.deepEqual(denied.hardDenialIds, ['AI_OPS_DENY_ORDER_MUTATION']);
});

test('mechanical authority manifests reuse deterministic transitive closure for all 31 roots', () => {
  const forward = contracts.generateA1xMechanicalAuthorityManifestSet(
    contracts.AI_OPS_A1X_SEALED_BASE_SHA,
    contracts.AI_OPS_CLASSIFICATION_INPUTS,
  );
  const reverse = contracts.generateA1xMechanicalAuthorityManifestSet(
    contracts.AI_OPS_A1X_SEALED_BASE_SHA,
    [...contracts.AI_OPS_CLASSIFICATION_INPUTS].reverse(),
  );
  assert.equal(forward.classificationManifestDigest, reverse.classificationManifestDigest);
  assert.deepEqual(forward.classification.entries, reverse.classification.entries);
  assert.deepEqual(forward.rootManifests, reverse.rootManifests);
  assert.equal(forward.classificationManifestDigest, contracts.AI_OPS_A1X_MECHANICAL_AUTHORITY_MANIFEST_TEMPLATE.classificationManifestDigest);
  assert.equal(forward.rootManifests.length, 31);
  assert.equal(forward.operationalAuthorityCreated, false);
  assert.equal(forward.ownerSignature.signatureState, 'OWNER_SIGNATURE_REQUIRED');

  for (const root of forward.rootManifests) {
    assert.deepEqual(root.unresolvedDependencyIds, [], root.rootResourceId);
    assert.deepEqual(root.cycleMemberIds, [], root.rootResourceId);
    assert.equal(root.authorityCreated, false);
    assert.ok(root.transitiveDependencyIds.includes('a1x-identity-draft'));
    assert.ok(root.transitiveDependencyIds.includes('a1x-reliability-targets-draft'));
  }
  const runbooks = forward.rootManifests.filter((row) => row.rootKind === 'RUNBOOK');
  assert.equal(runbooks.length, 10);
  for (const runbook of runbooks) {
    assert.equal(runbook.declaredActionClass, 'A');
    assert.equal(runbook.effectiveActionClass, 'C');
    assert.ok(runbook.transitiveDependencyIds.includes('remediation-owner'));
    assert.ok(runbook.transitiveDependencyIds.includes('command-owner'));
    assert.ok(runbook.transitiveDependencyIds.some((id) => id.startsWith('a1x-target-')));
  }
  const classD = forward.rootManifests.find((row) => row.rootResourceId === 'a1x-action-fixture-class-D');
  assert.equal(classD.effectiveActionClass, 'D');
  assert.deepEqual(classD.hardDenialIds, ['AI_OPS_DENY_ORDER_MUTATION']);
});

test('closed instance validators reject drift and hostile accessors without invoking them', () => {
  const target = jsonClone(contracts.AI_OPS_CAPABILITY_GRADUATION_TARGET_INSTANCES[0]);
  assert.equal(contracts.isAiOpsOwnerSignaturePlaceholder(target.ownerSignature, 'not-a-sha256-digest'), false);
  assert.equal(contracts.isClosedAiOpsCapabilityGraduationTargetInstance({ ...target, attackerOnly: true }), false);
  assert.equal(contracts.isClosedAiOpsCapabilityGraduationTargetInstance({ ...target, providerState: 'API_CONFIGURED' }), false);
  assert.equal(contracts.isClosedAiOpsCapabilityGraduationTargetInstance({ ...target, unsignedPayloadDigest: 'a'.repeat(64) }), false);

  const runbook = jsonClone(contracts.AI_OPS_RUNBOOK_MANIFEST_INSTANCES[0]);
  assert.equal(contracts.isClosedAiOpsRunbookManifestInstance({ ...runbook, effectPermitted: true }), false);
  assert.equal(contracts.isClosedAiOpsRunbookManifestInstance({
    ...runbook,
    ownerSignature: { ...runbook.ownerSignature, signatureBytesBase64Url: 'synthetic-signature' },
  }), false);

  const fixture = jsonClone(contracts.AI_OPS_ACTION_CLASS_FIXTURE_INSTANCES[0]);
  assert.equal(contracts.isClosedAiOpsActionClassFixtureInstance({ ...fixture, requestedActionClass: 'D' }), false);
  let getterCalls = 0;
  const accessorFixture = Object.defineProperty({ ...fixture }, 'schema', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'AI_OPS_ACTION_CLASS_FIXTURE_INSTANCE_V1';
    },
  });
  assert.equal(contracts.isClosedAiOpsActionClassFixtureInstance(accessorFixture), false);
  assert.equal(getterCalls, 0);
  assertNetworkPermissionDenied();
});

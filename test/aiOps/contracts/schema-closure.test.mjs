import assert from 'node:assert/strict';
import test from 'node:test';

import { loadContracts } from './_network-denied-env.mjs';

const contracts = await loadContracts();

test('adapted S6 schemas are Draft 2020-12 and close every new top-level shape', () => {
  const bundle = contracts.AI_OPS_ADAPTED_SCHEMA_BUNDLE;
  assert.equal(bundle.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(Object.keys(bundle.$defs).length, Object.keys(contracts.AI_OPS_CLOSED_KEYSETS).length);
  for (const schema of Object.values(bundle.$defs)) {
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.unevaluatedProperties, false);
    assert.deepEqual(Object.keys(schema.properties).sort(), [...schema.required].sort());
    for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
      assert.equal(
        propertySchema !== null && typeof propertySchema === 'object' && Object.keys(propertySchema).length > 0,
        true,
        `${propertyName} must have a meaningful schema`,
      );
    }
  }
  const runbookSchema = bundle.$defs.RunbookManifestTemplate;
  assert.equal(runbookSchema.allOf.length, contracts.AI_OPS_CLASS_A_ACTION_IDS.length);
  for (const actionId of contracts.AI_OPS_CLASS_A_ACTION_IDS) {
    const binding = runbookSchema.allOf.find((row) => row.if?.properties?.actionId?.const === actionId);
    assert.equal(binding?.then?.properties?.runbookId?.const, `AI_OPS_RUNBOOK_${actionId}`);
    assert.equal(binding?.then?.properties?.graduationTarget?.properties?.capabilityId?.const, actionId);
  }
  const parameterPropertySchema = runbookSchema.properties.typedParameterSchema.properties.properties.properties.resourceId;
  assert.equal(parameterPropertySchema.type, 'object');
  assert.equal(parameterPropertySchema.additionalProperties, false);
  assert.equal(parameterPropertySchema.unevaluatedProperties, false);
  assert.deepEqual(parameterPropertySchema.required, ['type', 'minLength', 'maxLength']);
  assert.deepEqual(Object.keys(parameterPropertySchema.properties).sort(), ['maxLength', 'minLength', 'type']);
  const targetProperties = runbookSchema.properties.graduationTarget.properties;
  assert.equal(targetProperties.minimumShadowRuns.maximum, 1_000_000_000);
  assert.equal(targetProperties.maximumResourceBytesPerRun.maximum, 1_000_000_000_000);
  assert.equal(targetProperties.minimumSuccessRatePermillion.maximum, 1_000_000);
  assert.equal(targetProperties.maximumRecurrenceRatePermillion.maximum, 1_000_000);
  assert.equal(bundle.$defs.ProviderCredentialMatrixRow.oneOf.length, contracts.AI_OPS_PROVIDER_CREDENTIAL_MATRIX.length);
  assert.equal(bundle.$defs.ControlRegistryInsertionRequest.oneOf.length, 120);
});

test('closed runtime validators reject unknown properties for every public artifact family', () => {
  const samples = {
    ProviderCredentialMatrixRow: contracts.AI_OPS_PROVIDER_CREDENTIAL_MATRIX[0],
    RunbookManifestTemplate: contracts.AI_OPS_RUNBOOK_TEMPLATES[0],
    ControlRegistryInsertionRequest: contracts.AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS[0],
    InsertionRequestRowV1: contracts.AI_OPS_INSERTION_REQUESTS[0],
    ClassificationResource: contracts.AI_OPS_CLASSIFICATION_INPUTS[0],
    SignedPolicyBundle: contracts.AI_OPS_SYNTHETIC_POLICY_BUNDLE_FIXTURE.candidate,
    DecisionLogRecord: contracts.AI_OPS_DECISION_LOG_DESIGN_FIXTURE,
  };
  for (const [name, sample] of Object.entries(samples)) {
    assert.equal(contracts.isClosedAiOpsContract(name, sample), true, name);
    assert.equal(contracts.isClosedAiOpsContract(name, { ...sample, attackerField: 'DENY_ME' }), false, name);
  }
});

test('closed runtime validators reject semantically invalid values even when keysets are exact', () => {
  const provider = contracts.AI_OPS_PROVIDER_CREDENTIAL_MATRIX[0];
  assert.equal(contracts.isClosedAiOpsContract('ProviderCredentialMatrixRow', { ...provider, providerState: 'UNKNOWN_PROVIDER_STATE' }), false);
  assert.equal(contracts.isClosedAiOpsContract('ProviderCredentialMatrixRow', { ...provider, authorityCreated: true }), false);
  assert.equal(contracts.isClosedAiOpsContract('ProviderCredentialMatrixRow', { ...provider, billingDomain: 'SYNTHETIC_API_BUDGET' }), false);
  const configuredProvider = contracts.AI_OPS_PROVIDER_CREDENTIAL_MATRIX.find((row) => row.credentialReference !== null);
  assert.ok(configuredProvider);
  assert.equal(contracts.isClosedAiOpsContract('ProviderCredentialMatrixRow', { ...configuredProvider, credentialReference: 'real-secret-ref' }), false);
  assert.equal(contracts.isClosedAiOpsContract('ProviderCredentialMatrixRow', { ...configuredProvider, credentialReference: 'SK-AAAAAAAAAAAA' }), false);
  for (const row of contracts.AI_OPS_PROVIDER_CREDENTIAL_MATRIX.filter((candidate) => candidate.credentialReference !== null)) {
    const prefix = row.credentialReference.slice(0, row.credentialReference.lastIndexOf('/') + 1);
    assert.equal(contracts.isClosedAiOpsContract('ProviderCredentialMatrixRow', { ...row, credentialReference: prefix }), false);
    assert.equal(contracts.isClosedAiOpsContract('ProviderCredentialMatrixRow', { ...row, credentialReference: `${prefix}silent-other-account` }), false);
  }

  const runbook = contracts.AI_OPS_RUNBOOK_TEMPLATES[0];
  assert.equal(contracts.isClosedAiOpsContract('RunbookManifestTemplate', { ...runbook, actionClass: 'B' }), false);
  assert.equal(contracts.isClosedAiOpsContract('RunbookManifestTemplate', {
    ...runbook,
    graduationTarget: { ...runbook.graduationTarget, minimumSuccessRatePermillion: 1_000_001 },
  }), false);
  assert.equal(contracts.isClosedAiOpsContract('RunbookManifestTemplate', {
    ...runbook,
    typedParameterSchema: { ...runbook.typedParameterSchema, additionalProperties: true },
  }), false);

  const control = contracts.AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS[0];
  assert.equal(contracts.isClosedAiOpsContract('ControlRegistryInsertionRequest', { ...control, effectHandler: 'fake-handler' }), false);
  assert.equal(contracts.isClosedAiOpsContract('ControlRegistryInsertionRequest', { ...control, authorityCreated: true }), false);
  assert.equal(contracts.isClosedAiOpsContract('ControlRegistryInsertionRequest', { ...control, allowedValues: ['WRONG_TYPE'] }), false);
  const sparseAllowedValues = Array(control.allowedValues.length + 1);
  for (let index = 0; index < control.allowedValues.length; index += 1) sparseAllowedValues[index] = control.allowedValues[index];
  assert.doesNotThrow(() => contracts.isClosedAiOpsContract('ControlRegistryInsertionRequest', { ...control, allowedValues: sparseAllowedValues }));
  assert.equal(contracts.isClosedAiOpsContract('ControlRegistryInsertionRequest', { ...control, allowedValues: sparseAllowedValues }), false);
  const structuredControl = contracts.AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS.find((row) => row.type === 'STRUCTURED_LIMITS');
  assert.ok(structuredControl);
  assert.doesNotThrow(() => contracts.isClosedAiOpsContract('ControlRegistryInsertionRequest', { ...structuredControl, allowedValues: [{ ['\ud800']: 0 }], safeDefault: { ['\ud800']: 0 } }));
  assert.equal(contracts.isClosedAiOpsContract('ControlRegistryInsertionRequest', { ...structuredControl, allowedValues: [{ ['\ud800']: 0 }], safeDefault: { ['\ud800']: 0 } }), false);
  for (const controlId of ['AI_OPS.A01', 'AI_OPS.A03', 'AI_OPS.E10', 'AI_OPS.H05', 'AI_OPS.L10']) {
    const canonicalControl = contracts.AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS.find((row) => row.controlId === controlId);
    assert.ok(canonicalControl);
    assert.equal(contracts.isClosedAiOpsContract('ControlRegistryInsertionRequest', {
      ...canonicalControl,
      label: 'forged permissive control',
      delegatedEffectOwnerId: 'RISK',
      type: 'BOOLEAN',
      allowedValues: [false, true],
      safeDefault: false,
      minimumSafetyFloor: 'NO_FLOOR',
      modeCeiling: 'SHADOW',
      permanentlyLocked: false,
    }), false, controlId);
  }

  const insertion = contracts.AI_OPS_INSERTION_REQUESTS[0];
  assert.equal(contracts.isClosedAiOpsContract('InsertionRequestRowV1', { ...insertion, status: 'ACCEPTED' }), false);
  assert.equal(contracts.isClosedAiOpsContract('InsertionRequestRowV1', { ...insertion, wiringState: 'WIRED' }), false);
  assert.equal(contracts.isClosedAiOpsContract('InsertionRequestRowV1', { ...insertion, authorityCreated: true }), false);
  assert.equal(contracts.isClosedAiOpsContract('InsertionRequestRowV1', { ...insertion, rowId: `AIOPS-IR-AKIA${'A'.repeat(16)}` }), false);
  assert.equal(contracts.isClosedAiOpsContract('InsertionRequestRowV1', { ...insertion, wiringState: `PENDING_BACKEND:AKIA${'A'.repeat(16)}` }), false);

  const classification = contracts.AI_OPS_CLASSIFICATION_INPUTS[0];
  assert.equal(contracts.isClosedAiOpsContract('ClassificationResource', { ...classification, kind: 'EXECUTABLE_AUTHORITY' }), false);
  assert.equal(contracts.isClosedAiOpsContract('ClassificationResource', {
    ...classification,
    evidenceDigestAlgorithm: 'SHA-256',
    evidenceDigest: '0'.repeat(40),
  }), false);
  assert.equal(contracts.isClosedAiOpsContract('ClassificationResource', {
    ...classification,
    hardDenialIds: ['UNKNOWN_DENIAL'],
  }), false);
  assert.equal(contracts.isClosedAiOpsContract('ClassificationResource', {
    ...classification,
    evidenceRevision: `revision-AKIA${'A'.repeat(16)}`,
  }), false);

  const policy = contracts.AI_OPS_SYNTHETIC_POLICY_BUNDLE_FIXTURE.candidate;
  assert.equal(contracts.isClosedAiOpsContract('SignedPolicyBundle', {
    ...policy,
    payload: { ...policy.payload, schema: 'EVIL_POLICY_BUNDLE' },
  }), false);
  assert.equal(contracts.isClosedAiOpsContract('SignedPolicyBundle', {
    ...policy,
    payload: { ...policy.payload, authorityExpansionRequested: true },
  }), false);
  assert.equal(contracts.isClosedAiOpsContract('SignedPolicyBundle', {
    ...policy,
    payload: { ...policy.payload, hardDenialIds: policy.payload.hardDenialIds.slice(1) },
  }), false);
  assert.equal(contracts.isClosedAiOpsContract('SignedPolicyBundle', {
    ...policy,
    declaredBundleDigest: '0'.repeat(64),
  }), false);

  const decision = contracts.AI_OPS_DECISION_LOG_DESIGN_FIXTURE;
  assert.equal(contracts.isClosedAiOpsContract('DecisionLogRecord', { ...decision, actionClass: 'E' }), false);
  assert.equal(contracts.isClosedAiOpsContract('DecisionLogRecord', { ...decision, requestedAssurance: 'NONE' }), false);
  assert.equal(contracts.isClosedAiOpsContract('DecisionLogRecord', { ...decision, assuranceVerified: true }), false);
  assert.equal(contracts.isClosedAiOpsContract('DecisionLogRecord', { ...decision, state: 'ACCEPTED' }), false);
  assert.equal(contracts.isClosedAiOpsContract('DecisionLogRecord', { ...decision, authorityCreated: true }), false);
  assert.equal(contracts.isClosedAiOpsContract('DecisionLogRecord', { ...decision, recordDigest: '0'.repeat(64) }), false);
  const { recordDigest: _decisionDigest, ...decisionBody } = decision;
  const duplicateReasonBody = { ...decisionBody, reasonCodes: [decision.reasonCodes[0], decision.reasonCodes[0]] };
  const duplicateReasonDecision = { ...duplicateReasonBody, recordDigest: contracts.sha256Canonical(duplicateReasonBody) };
  assert.equal(contracts.isClosedAiOpsContract('DecisionLogRecord', duplicateReasonDecision), false);
});

test('policy and decision evaluators enforce closed shapes rather than trusting TypeScript callers', () => {
  const fixture = contracts.AI_OPS_SYNTHETIC_POLICY_BUNDLE_FIXTURE;
  const malformed = { ...fixture.candidate, attackerField: 'DENY_ME' };
  const decision = contracts.evaluatePolicyBundle(malformed, null, { verify: () => true }, { verifyExactInventory: () => true }, 1_784_001_600_000);
  assert.equal(decision.candidateValidatedForPortRecheck, false);
  assert.deepEqual(decision.reasonCodes, ['POLICY_BUNDLE_SCHEMA_INVALID']);
  const first = contracts.AI_OPS_DECISION_LOG_DESIGN_FIXTURE;
  const {
    schema: _schema,
    recordDigest: _recordDigest,
    assuranceVerified: _assuranceVerified,
    state: _state,
    authorityCreated: _authorityCreated,
    ...input
  } = first;
  assert.throws(() => contracts.createDecisionLogRecord({ ...input, attackerField: 'DENY_ME' }), /schema or bounded semantics/);
});

test('unknown contract names, including prototype keys, fail closed without throwing', () => {
  for (const name of ['__proto__', 'constructor', 'toString', 'UNKNOWN_CONTRACT']) {
    assert.doesNotThrow(() => contracts.isClosedAiOpsContract(name, {}));
    assert.equal(contracts.isClosedAiOpsContract(name, {}), false);
  }
  let coercionCalls = 0;
  const hostileName = {
    [Symbol.toPrimitive]() {
      coercionCalls += 1;
      throw new Error('must not coerce contract names');
    },
  };
  assert.doesNotThrow(() => contracts.isClosedAiOpsContract(hostileName, {}));
  assert.equal(contracts.isClosedAiOpsContract(hostileName, {}), false);
  assert.equal(coercionCalls, 0);
});

test('public closed-contract guards reject accessors without invoking them', () => {
  let getterCalls = 0;
  const withAccessor = (sample, key, returnedValue) => Object.defineProperty({ ...sample }, key, {
    enumerable: true,
    get() {
      getterCalls += 1;
      return returnedValue;
    },
  });
  const provider = withAccessor(contracts.AI_OPS_PROVIDER_CREDENTIAL_MATRIX[0], 'providerState', 'NOT_CONFIGURED');
  const runbook = withAccessor(contracts.AI_OPS_RUNBOOK_TEMPLATES[0], 'actionClass', 'A');
  const policyPayload = withAccessor(contracts.AI_OPS_SYNTHETIC_POLICY_BUNDLE_FIXTURE.candidate.payload, 'bundleId', 'aiops-shadow-policy-fixture');
  const signedPolicy = withAccessor(contracts.AI_OPS_SYNTHETIC_POLICY_BUNDLE_FIXTURE.candidate, 'payload', contracts.AI_OPS_SYNTHETIC_POLICY_BUNDLE_FIXTURE.candidate.payload);
  const decision = withAccessor(contracts.AI_OPS_DECISION_LOG_DESIGN_FIXTURE, 'actionClass', 'A');
  for (const [name, sample] of [
    ['ProviderCredentialMatrixRow', provider],
    ['RunbookManifestTemplate', runbook],
    ['SignedPolicyBundle', signedPolicy],
    ['DecisionLogRecord', decision],
  ]) {
    assert.doesNotThrow(() => contracts.isClosedAiOpsContract(name, sample));
    assert.equal(contracts.isClosedAiOpsContract(name, sample), false, name);
  }
  assert.equal(contracts.isClosedAiOpsRunbookTemplate(runbook), false);
  assert.equal(contracts.isClosedAiOpsPolicyBundlePayload(policyPayload), false);
  assert.equal(contracts.isClosedSignedPolicyBundle(signedPolicy), false);
  assert.equal(contracts.isClosedAiOpsDecisionLogRecord(decision), false);
  assert.equal(getterCalls, 0, 'public guards must inspect descriptors, not accessor values');
});

test('decision receipt reference schema preserves the full bounded-ID boundary', () => {
  const rules = contracts.AI_OPS_ADAPTED_SCHEMA_BUNDLE.$defs.DecisionLogRecord.allOf;
  for (const [assurance, prefix, suffixLength] of [
    ['SIGNED_CHECKPOINT', 'checkpoint-receipt://', 171],
    ['TRANSPARENCY_RECEIPT', 'transparency-receipt://', 169],
  ]) {
    const rule = rules.find((candidate) => candidate.if?.properties?.requestedAssurance?.const === assurance);
    assert.ok(rule);
    const pattern = rule.then.properties.checkpointReceiptReference.allOf[1].pattern;
    const reference = `${prefix}${'A'.repeat(suffixLength)}`;
    assert.equal(reference.length, 192);
    assert.match(reference, new RegExp(pattern));
  }
});

test('canonical policy bytes reject negative zero and lone surrogates in values and keys', () => {
  assert.throws(() => contracts.canonicalPolicyJson({ value: -0 }), /invalid number/);
  assert.throws(() => contracts.canonicalPolicyJson({ value: '\ud800' }), /lone high surrogate/);
  assert.throws(() => contracts.canonicalPolicyJson({ ['\ud800']: 'value' }), /lone high surrogate/);
  assert.throws(() => contracts.canonicalPolicyJson(Array(1)), /sparse or oversized array|unsupported array properties/);
  assert.notEqual(contracts.sha256Canonical([]), contracts.sha256Canonical([null]));
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, 'value', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return getterCalls === 1 ? 'safe' : -0;
    },
  });
  assert.throws(() => contracts.canonicalPolicyJson(accessor), /accessor/);
  assert.equal(getterCalls, 0, 'accessors must be rejected without invocation');
  assert.throws(() => contracts.canonicalPolicyJson(Array(10_001).fill(null)), /oversized array/);
  assert.throws(() => contracts.canonicalPolicyJson('x'.repeat(1_048_577)), /text exceeds limits/);
  let deep = null;
  for (let depth = 0; depth < 66; depth += 1) deep = { child: deep };
  assert.throws(() => contracts.canonicalPolicyJson(deep), /structural limits/);
  let sortedGetterCalls = 0;
  const hostileStrings = Object.defineProperty(['safe'], 0, {
    enumerable: true,
    configurable: true,
    get() {
      sortedGetterCalls += 1;
      return 'safe';
    },
  });
  assert.throws(() => contracts.sortedUnique(hostileStrings), /requires strings/);
  assert.equal(sortedGetterCalls, 0);
  const secretKey = 'sk-proj-1234567890abcdef';
  const secretAccessor = Object.defineProperty({}, secretKey, { enumerable: true, get: () => 'value' });
  assert.throws(
    () => contracts.canonicalPolicySnapshot(secretAccessor),
    (error) => error instanceof TypeError && !error.message.includes(secretKey),
  );
});

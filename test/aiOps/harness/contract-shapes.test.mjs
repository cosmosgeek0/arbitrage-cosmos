import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalStringify, sha256Hex } from '../../../fixtures/aiOps/harness/canonical.mjs';
import {
  INTERFACE_BUNDLE_KEYS,
  PROVIDER_STATES,
  validateInterfaceBundle,
  validateShadowContract,
} from '../../../fixtures/aiOps/harness/contract-shapes.mjs';
import { SHADOW_INTERFACE_BUNDLE } from '../../../fixtures/aiOps/harness/fixture-factory.mjs';

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

function rehashContract(contract) {
  const { contentHash: _discarded, ...draft } = contract;
  contract.contentHash = sha256Hex(draft);
  return contract;
}

function rehashCheckpoint(contract) {
  const { checkpointHash: _discarded, ...checkpointDraft } = contract.payload;
  contract.payload.checkpointHash = sha256Hex(checkpointDraft);
  return rehashContract(contract);
}

test('the local A1-A3 target bundle contains 23 strict speculative contracts', () => {
  assert.equal(Object.keys(SHADOW_INTERFACE_BUNDLE).length, 23);
  assert.deepEqual(Object.keys(SHADOW_INTERFACE_BUNDLE).sort(), [...INTERFACE_BUNDLE_KEYS].sort());
  assert.deepEqual(validateInterfaceBundle(SHADOW_INTERFACE_BUNDLE), []);
  for (const contract of Object.values(SHADOW_INTERFACE_BUNDLE)) {
    assert.equal(contract.schemaVersion, 'AIOPS_A5_SHADOW_CONTRACT_V1');
    assert.equal(contract.shadowStatus, 'SHADOW_SPECULATIVE');
    assert.ok(Array.isArray(contract.unknownFields));
    assert.ok(Array.isArray(contract.missingFields));
    assert.ok(Object.isFrozen(contract));
    assert.ok(Object.isFrozen(contract.payload));
  }
});

test('provider state uses the directive enum and keeps health separate', () => {
  assert.deepEqual(PROVIDER_STATES, [
    'NOT_CONFIGURED',
    'SUBSCRIPTION_CODEX_WORKER',
    'SUBSCRIPTION_CLAUDE_CODE_WORKER',
    'API_CONFIGURED',
    'DIAGNOSTIC_PLANE_UNAVAILABLE',
  ]);
  assert.equal(PROVIDER_STATES.includes('UI_SUBSCRIPTION_ONLY'), false);
  assert.equal(SHADOW_INTERFACE_BUNDLE.a3ProviderDescriptor.payload.providerState, 'API_CONFIGURED');
  assert.equal(SHADOW_INTERFACE_BUNDLE.a3ProviderDescriptor.payload.healthState, 'AVAILABLE');
});

test('strict contract validation rejects enumerable, symbol, and non-enumerable extras', () => {
  const enumerable = mutable(SHADOW_INTERFACE_BUNDLE.a1PolicyDecision);
  enumerable.extra = true;
  assert.deepEqual(validateShadowContract(enumerable), ['CONTRACT_KEYS_MISMATCH']);

  const symbolExtra = mutable(SHADOW_INTERFACE_BUNDLE.a1PolicyDecision);
  symbolExtra[Symbol('hidden')] = true;
  assert.deepEqual(validateShadowContract(symbolExtra), ['CONTRACT_KEYS_MISMATCH']);

  const hidden = mutable(SHADOW_INTERFACE_BUNDLE.a1PolicyDecision);
  Object.defineProperty(hidden, 'hidden', { value: true, enumerable: false });
  assert.deepEqual(validateShadowContract(hidden), ['CONTRACT_KEYS_MISMATCH']);
  assert.throws(() => canonicalStringify(hidden), /non-enumerable/u);
});

test('semantic validation rejects contradictory policy and provider states', () => {
  const policy = mutable(SHADOW_INTERFACE_BUNDLE.a1PolicyDecision);
  policy.payload.allowed = true;
  rehashContract(policy);
  assert.ok(validateShadowContract(policy).includes('PAYLOAD_SEMANTICS_INVALID'));

  const provider = mutable(SHADOW_INTERFACE_BUNDLE.a3ProviderDescriptor);
  provider.payload.providerState = 'NOT_CONFIGURED';
  provider.payload.healthState = 'AVAILABLE';
  rehashContract(provider);
  assert.ok(validateShadowContract(provider).includes('PAYLOAD_SEMANTICS_INVALID'));
});

test('hard denials cannot be reclassified by policy, permissions, approvals, or tools', () => {
  const policy = mutable(SHADOW_INTERFACE_BUNDLE.a1PolicyDecision);
  policy.payload.capability = 'ORDER_MUTATION_DIRECT';
  policy.payload.allowed = true;
  policy.payload.hardDenialResult = 'NOT_APPLICABLE';
  rehashContract(policy);
  assert.ok(validateShadowContract(policy).includes('PAYLOAD_SEMANTICS_INVALID'));

  const permission = mutable(SHADOW_INTERFACE_BUNDLE.a1PermissionProfile);
  permission.payload.allowedCapabilities.push('ORDER_MUTATION_DIRECT');
  rehashContract(permission);
  assert.ok(validateShadowContract(permission).includes('PAYLOAD_SEMANTICS_INVALID'));

  for (const key of ['a1ApprovalRequest', 'a1ApprovalReceipt', 'a3ToolDescriptor']) {
    const contract = mutable(SHADOW_INTERFACE_BUNDLE[key]);
    contract.payload.capability = 'ORDER_MUTATION_DIRECT';
    rehashContract(contract);
    assert.ok(validateShadowContract(contract).includes('PAYLOAD_SEMANTICS_INVALID'), key);
  }
});

test('approval and action contracts independently require zero product effect', () => {
  for (const key of ['a1ApprovalRequest', 'a1ApprovalReceipt', 'a1ActionEnvelope']) {
    const contract = mutable(SHADOW_INTERFACE_BUNDLE[key]);
    contract.payload.maximumEffect = 'UNBOUNDED';
    rehashContract(contract);
    assert.ok(validateShadowContract(contract).includes('PAYLOAD_SEMANTICS_INVALID'), key);
  }
});

test('strict validation rejects production, malformed approval time, unsafe action, false-green tool, and false-green canary', () => {
  const cases = [];

  const production = mutable(SHADOW_INTERFACE_BUNDLE.a1PolicyDecision);
  production.environment = 'PRODUCTION';
  rehashContract(production);
  cases.push(production);

  const approval = mutable(SHADOW_INTERFACE_BUNDLE.a1ApprovalReceipt);
  approval.payload.createdAtMs = String(approval.payload.createdAtMs);
  rehashContract(approval);
  cases.push(approval);

  const action = mutable(SHADOW_INTERFACE_BUNDLE.a1ActionEnvelope);
  action.payload.attemptBudget = -1;
  action.payload.approvalReceiptIds = [];
  rehashContract(action);
  cases.push(action);

  const toolOutput = mutable(SHADOW_INTERFACE_BUNDLE.a3ToolOutput);
  toolOutput.payload.schemaValid = true;
  toolOutput.payload.injectionDetected = true;
  toolOutput.payload.additionalPropertiesPresent = true;
  rehashContract(toolOutput);
  cases.push(toolOutput);

  const canary = mutable(SHADOW_INTERFACE_BUNDLE.assuranceCanaryReceipt);
  canary.payload.cohortState = 'NO_DATA';
  canary.payload.disposition = 'PASS';
  canary.payload.promotionAllowed = true;
  rehashContract(canary);
  cases.push(canary);

  for (const contract of cases) {
    const issues = validateShadowContract(contract);
    assert.ok(issues.includes('PAYLOAD_SEMANTICS_INVALID') || issues.includes('COMMON_FIELD_INVALID'), contract.objectType);
  }
});

test('approval and action shapes bind exact tool, live preconditions, deadline, and TTL', () => {
  const approval = SHADOW_INTERFACE_BUNDLE.a1ApprovalReceipt.payload;
  assert.equal(approval.exactToolId, SHADOW_INTERFACE_BUNDLE.a3ToolDescriptor.payload.toolId);
  assert.ok(approval.livePreconditions.includes('NO_PRODUCT_WRITE'));
  const action = SHADOW_INTERFACE_BUNDLE.a1ActionEnvelope.payload;
  assert.ok(action.deadlineMs > SHADOW_INTERFACE_BUNDLE.a1ActionEnvelope.createdAtMs);
  assert.ok(action.ttlMs > 0);
  assert.equal(action.fencingEpoch, SHADOW_INTERFACE_BUNDLE.a2WorkflowCheckpoint.payload.fencingEpoch);
});

test('synthetic callback signature material is independently recomputed', () => {
  const callback = mutable(SHADOW_INTERFACE_BUNDLE.a3Callback);
  callback.payload.signatureMaterial = 'FORGED_SYNTHETIC_SIGNATURE';
  rehashContract(callback);
  assert.ok(validateShadowContract(callback).includes('PAYLOAD_SEMANTICS_INVALID'));
});

test('bundle validation rejects stale cross-contract identity and evidence links', () => {
  const caseMismatch = mutable(SHADOW_INTERFACE_BUNDLE);
  caseMismatch.a3Callback.payload.caseId = 'case-stale';
  rehashContract(caseMismatch.a3Callback);
  assert.ok(validateInterfaceBundle(caseMismatch).includes('CROSS_CONTRACT_CASE_ID_MISMATCH'));

  const evidenceMismatch = mutable(SHADOW_INTERFACE_BUNDLE);
  evidenceMismatch.a2DiagnosticReport.payload.evidenceBundleHash = sha256Hex('different-evidence');
  rehashContract(evidenceMismatch.a2DiagnosticReport);
  assert.ok(validateInterfaceBundle(evidenceMismatch).includes('CROSS_CONTRACT_EVIDENCE_HASH_MISMATCH'));
});

test('bundle validation rejects stale policy, context, generation, fencing, tool, and source revisions', () => {
  const mutations = [
    ['a1ActionEnvelope', 'policyRevision', 'stale-policy', 'CROSS_CONTRACT_POLICY_REVISION_MISMATCH'],
    ['a2WorkflowCheckpoint', 'contextHash', sha256Hex('stale-context'), 'CROSS_CONTRACT_CONTEXT_HASH_MISMATCH'],
    ['a3Callback', 'workflowGeneration', 7, 'CROSS_CONTRACT_WORKFLOW_GENERATION_MISMATCH'],
    ['a1ActionEnvelope', 'fencingEpoch', 7, 'CROSS_CONTRACT_FENCING_EPOCH_MISMATCH'],
    ['a3ToolOutput', 'toolId', 'different-tool', 'a3ToolOutput:PAYLOAD_SEMANTICS_INVALID'],
  ];
  for (const [key, field, value, expectedIssue] of mutations) {
    const bundle = mutable(SHADOW_INTERFACE_BUNDLE);
    bundle[key].payload[field] = value;
    if (key === 'a2WorkflowCheckpoint') rehashCheckpoint(bundle[key]);
    else rehashContract(bundle[key]);
    assert.ok(validateInterfaceBundle(bundle).includes(expectedIssue), `${key}.${field}`);
  }

  const source = mutable(SHADOW_INTERFACE_BUNDLE);
  source.a3ProviderDescriptor.sourceRevision = 'different-source';
  rehashContract(source.a3ProviderDescriptor);
  assert.ok(validateInterfaceBundle(source).includes('a3ProviderDescriptor:FIXTURE_METADATA_MISMATCH'));
});

test('no target contract can point at a real network endpoint or live environment', () => {
  for (const contract of Object.values(SHADOW_INTERFACE_BUNDLE)) {
    assert.equal(contract.environment, 'SYNTHETIC_ONLY');
    const serialized = JSON.stringify(contract);
    assert.equal(/https?:\/\//u.test(serialized), false);
    assert.equal(/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/u.test(serialized), false);
  }
  assert.ok(SHADOW_INTERFACE_BUNDLE.a3CredentialProxyRequest.payload.endpoint.startsWith('fixture://'));
});

test('every payload-level environment field rejects production', () => {
  for (const key of [
    'a1PolicyDecision',
    'a1ApprovalRequest',
    'a1ApprovalReceipt',
    'a2EvidenceBundle',
    'a3ToolDescriptor',
  ]) {
    const contract = mutable(SHADOW_INTERFACE_BUNDLE[key]);
    contract.payload.environment = 'PRODUCTION';
    rehashContract(contract);
    assert.ok(validateShadowContract(contract).includes('PAYLOAD_SEMANTICS_INVALID'), key);
  }
});

test('bundle validation binds approval identity, nonce, arguments, artifacts, scope, and lease', () => {
  const mutations = [
    ['a1ActionEnvelope', 'approvalReceiptIds', ['approval-never-issued'], 'CROSS_CONTRACT_APPROVAL_RECEIPT_ID_MISMATCH'],
    ['a1ApprovalReceipt', 'nonce', 'different-synthetic-nonce', 'CROSS_CONTRACT_APPROVAL_BINDING_MISMATCH'],
    ['a1ApprovalRequest', 'argumentHash', sha256Hex('different-arguments'), 'CROSS_CONTRACT_APPROVAL_BINDING_MISMATCH'],
    ['a1ApprovalReceipt', 'artifactHash', sha256Hex('different-artifact'), 'CROSS_CONTRACT_APPROVAL_BINDING_MISMATCH'],
    ['a1ActionEnvelope', 'leaseId', 'stale-fixture-lease', 'CROSS_CONTRACT_LEASE_ID_MISMATCH'],
    ['a1ActionEnvelope', 'preconditions', ['SHADOW_ONLY'], 'a1ActionEnvelope:PAYLOAD_SEMANTICS_INVALID'],
  ];
  for (const [key, field, value, expectedIssue] of mutations) {
    const bundle = mutable(SHADOW_INTERFACE_BUNDLE);
    bundle[key].payload[field] = value;
    rehashContract(bundle[key]);
    assert.ok(validateInterfaceBundle(bundle).includes(expectedIssue), `${key}.${field}`);
  }
});

test('bundle validation binds tool schema and permission capability/tool grants', () => {
  const schema = mutable(SHADOW_INTERFACE_BUNDLE);
  schema.a3ToolOutput.payload.schemaHash = sha256Hex('different-output-schema');
  rehashContract(schema.a3ToolOutput);
  assert.ok(validateInterfaceBundle(schema).includes('a3ToolOutput:PAYLOAD_SEMANTICS_INVALID'));

  const capability = mutable(SHADOW_INTERFACE_BUNDLE);
  capability.a1PermissionProfile.payload.allowedCapabilities = [];
  rehashContract(capability.a1PermissionProfile);
  assert.ok(validateInterfaceBundle(capability).includes('CROSS_CONTRACT_PERMISSION_CAPABILITY_MISMATCH'));

  const tool = mutable(SHADOW_INTERFACE_BUNDLE);
  for (const key of ['a1ApprovalRequest', 'a1ApprovalReceipt']) {
    tool[key].payload.exactToolId = 'ungranted-fixture-tool';
    rehashContract(tool[key]);
  }
  tool.a3ToolDescriptor.payload.toolId = 'ungranted-fixture-tool';
  rehashContract(tool.a3ToolDescriptor);
  tool.a3ToolOutput.payload.toolId = 'ungranted-fixture-tool';
  rehashContract(tool.a3ToolOutput);
  tool.a3CredentialProxyRequest.payload.toolId = 'ungranted-fixture-tool';
  rehashContract(tool.a3CredentialProxyRequest);
  assert.notDeepEqual(validateInterfaceBundle(tool), []);
});

test('bundle validation rejects a stale capability even when the mutated contract is well formed', () => {
  const bundle = mutable(SHADOW_INTERFACE_BUNDLE);
  bundle.a1ApprovalReceipt.payload.capability = 'STALE_CAPABILITY';
  rehashContract(bundle.a1ApprovalReceipt);
  assert.ok(validateInterfaceBundle(bundle).includes('CROSS_CONTRACT_CAPABILITY_MISMATCH'));
});

test('used, exhausted, unauthorized, substituted, or expired approval authority cannot bind an action', () => {
  const used = mutable(SHADOW_INTERFACE_BUNDLE);
  used.a1ApprovalReceipt.payload.used = true;
  used.a1ApprovalReceipt.state = 'USED';
  rehashContract(used.a1ApprovalReceipt);
  assert.notDeepEqual(validateInterfaceBundle(used), []);

  const exhausted = mutable(SHADOW_INTERFACE_BUNDLE);
  exhausted.a1ApprovalReceipt.payload.remainingActionCount = 0;
  rehashContract(exhausted.a1ApprovalReceipt);
  assert.ok(validateInterfaceBundle(exhausted).includes('CROSS_CONTRACT_APPROVAL_AUTHORITY_MISMATCH'));

  const approver = mutable(SHADOW_INTERFACE_BUNDLE);
  approver.a1ApprovalReceipt.payload.approverId = 'fixture-attacker';
  rehashContract(approver.a1ApprovalReceipt);
  assert.ok(validateInterfaceBundle(approver).includes('CROSS_CONTRACT_APPROVAL_AUTHORITY_MISMATCH'));

  const proposal = mutable(SHADOW_INTERFACE_BUNDLE);
  proposal.a1ActionEnvelope.payload.proposalHash = sha256Hex('substituted-action');
  rehashContract(proposal.a1ActionEnvelope);
  assert.ok(validateInterfaceBundle(proposal).includes('CROSS_CONTRACT_PROPOSAL_HASH_MISMATCH'));

  for (const key of ['a1PolicyDecision', 'a1PermissionProfile']) {
    const expired = mutable(SHADOW_INTERFACE_BUNDLE);
    expired[key].payload.expiresAtMs = expired[key].createdAtMs + 1;
    rehashContract(expired[key]);
    assert.ok(validateInterfaceBundle(expired).includes('CROSS_CONTRACT_ACTION_EXPIRY_MISMATCH'), key);
  }

  const executable = mutable(SHADOW_INTERFACE_BUNDLE.a1ActionEnvelope);
  executable.state = 'EXECUTABLE';
  rehashContract(executable);
  assert.ok(validateShadowContract(executable).includes('PAYLOAD_SEMANTICS_INVALID'));
});

test('policy, action, provider, and aggregate usage cannot exceed the owner budget', () => {
  const mutations = [
    ['a1PolicyDecision', 'attemptBudget', 999],
    ['a1PolicyDecision', 'concurrencyBudget', 999],
    ['a1PolicyDecision', 'costBudgetMicrounits', 999_999],
    ['a1ActionEnvelope', 'attemptBudget', 999],
    ['a1ActionEnvelope', 'concurrencyBudget', 999],
    ['a3ProviderDescriptor', 'budgetMicrounits', 999_999],
  ];
  for (const [key, field, value] of mutations) {
    const bundle = mutable(SHADOW_INTERFACE_BUNDLE);
    bundle[key].payload[field] = value;
    rehashContract(bundle[key]);
    assert.ok(validateInterfaceBundle(bundle).includes('CROSS_CONTRACT_BUDGET_EXCEEDED'), `${key}.${field}`);
  }

  for (const [field, value] of [
    ['globalAttemptUsage', 3],
    ['globalCostUsageMicrounits', 1_001],
    ['emergencyReserveMicrounits', 1_001],
  ]) {
    const contract = mutable(SHADOW_INTERFACE_BUNDLE.a1BudgetPolicy);
    contract.payload[field] = value;
    rehashContract(contract);
    assert.ok(validateShadowContract(contract).includes('PAYLOAD_SEMANTICS_INVALID'), field);
  }
});

test('tool and credential shapes reject disabled approval, host paths, invalid TTLs, and unallowlisted egress', () => {
  const toolMutations = [
    ['approvalRequired', false],
    ['pathAllowlist', ['/Users/cosmosgeek/.ssh']],
    ['ttlMs', -1],
  ];
  for (const [field, value] of toolMutations) {
    const contract = mutable(SHADOW_INTERFACE_BUNDLE.a3ToolDescriptor);
    contract.payload[field] = value;
    rehashContract(contract);
    assert.ok(validateShadowContract(contract).includes('PAYLOAD_SEMANTICS_INVALID'), field);
  }

  const endpoint = mutable(SHADOW_INTERFACE_BUNDLE);
  endpoint.a3CredentialProxyRequest.payload.endpoint = 'fixture://not-allowlisted';
  rehashContract(endpoint.a3CredentialProxyRequest);
  assert.ok(validateInterfaceBundle(endpoint)
    .includes('a3CredentialProxyRequest:PAYLOAD_SEMANTICS_INVALID'));

  const budget = mutable(SHADOW_INTERFACE_BUNDLE.a3CredentialProxyRequest);
  budget.payload.budgetMicrounits = -1;
  rehashContract(budget);
  assert.ok(validateShadowContract(budget).includes('PAYLOAD_SEMANTICS_INVALID'));
});

test('assurance contracts reject verification, canary, rollback, control, and break-glass false greens', () => {
  const verification = mutable(SHADOW_INTERFACE_BUNDLE.assuranceVerificationReceipt);
  verification.payload.disposition = 'VERIFIED';
  verification.payload.observedPostconditions = [];
  verification.payload.unresolvedAmbiguity = ['unknown'];
  verification.payload.rollbackRequired = true;
  rehashContract(verification);
  assert.ok(validateShadowContract(verification).includes('PAYLOAD_SEMANTICS_INVALID'));

  const canary = mutable(SHADOW_INTERFACE_BUNDLE.assuranceCanaryReceipt);
  Object.assign(canary.payload, {
    cohortState: 'COMPARABLE', comparisonState: 'COMPARABLE', finiteMetrics: true,
    sampleCount: 10, disposition: 'FAIL', promotionAllowed: true, rollbackRequired: false,
  });
  rehashContract(canary);
  assert.ok(validateShadowContract(canary).includes('PAYLOAD_SEMANTICS_INVALID'));

  const rollback = mutable(SHADOW_INTERFACE_BUNDLE.assuranceRollbackReceipt);
  Object.assign(rollback.payload, {
    disposition: 'ROLLED_BACK', independentReadbackState: 'MISMATCH', postconditionState: 'FAILED',
  });
  rehashContract(rollback);
  assert.ok(validateShadowContract(rollback).includes('PAYLOAD_SEMANTICS_INVALID'));

  const controls = mutable(SHADOW_INTERFACE_BUNDLE.assuranceControlChangeSet);
  Object.assign(controls.payload, { validationState: 'VALID', casState: 'STALE', appliedCount: 1 });
  rehashContract(controls);
  assert.ok(validateShadowContract(controls).includes('PAYLOAD_SEMANTICS_INVALID'));

  const breakGlass = mutable(SHADOW_INTERFACE_BUNDLE.assuranceBreakGlassReceipt);
  breakGlass.payload.allowedControlIds = ['WITHDRAW_FUNDS'];
  rehashContract(breakGlass);
  assert.ok(validateShadowContract(breakGlass).includes('PAYLOAD_SEMANTICS_INVALID'));
});

test('durable checkpoint content and workflow version are cryptographically bound', () => {
  const forged = mutable(SHADOW_INTERFACE_BUNDLE.a2WorkflowCheckpoint);
  forged.payload.checkpointHash = sha256Hex('forged-checkpoint');
  rehashContract(forged);
  assert.ok(validateShadowContract(forged).includes('PAYLOAD_SEMANTICS_INVALID'));

  const version = mutable(SHADOW_INTERFACE_BUNDLE);
  version.a2WorkflowCheckpoint.payload.workflowVersion = 'fixture-workflow-stale';
  rehashCheckpoint(version.a2WorkflowCheckpoint);
  assert.ok(validateInterfaceBundle(version).includes('CROSS_CONTRACT_WORKFLOW_VERSION_MISMATCH'));
});

test('shadow contracts default-deny coordinated authority and verifier escalation', () => {
  const permission = mutable(SHADOW_INTERFACE_BUNDLE.a1PermissionProfile);
  permission.payload.deniedCapabilities = ['UNRELATED_DENIAL'];
  rehashContract(permission);
  assert.ok(validateShadowContract(permission).includes('PAYLOAD_SEMANTICS_INVALID'));

  const selfVerifier = mutable(SHADOW_INTERFACE_BUNDLE);
  selfVerifier.a1ActionEnvelope.payload.independentVerifierId = 'fixture-principal';
  rehashContract(selfVerifier.a1ActionEnvelope);
  assert.ok(validateInterfaceBundle(selfVerifier).includes('CROSS_CONTRACT_INDEPENDENT_VERIFIER_MISMATCH'));

  const verified = mutable(SHADOW_INTERFACE_BUNDLE.assuranceVerificationReceipt);
  Object.assign(verified.payload, {
    disposition: 'VERIFIED',
    observedPostconditions: [...verified.payload.expectedPostconditions],
    unresolvedAmbiguity: [],
    rollbackRequired: false,
    verifierId: 'fixture-principal',
  });
  verified.state = 'VERIFIED';
  rehashContract(verified);
  assert.ok(validateShadowContract(verified).includes('PAYLOAD_SEMANTICS_INVALID'));

  const applied = mutable(SHADOW_INTERFACE_BUNDLE.assuranceControlChangeSet);
  Object.assign(applied.payload, {
    changes: [{ controlId: 'GRANT_ORDER_MUTATION', from: 'DENIED', to: 'ALLOWED' }],
    validationState: 'VALID',
    casState: 'APPLIED',
    appliedCount: 1,
    independentReadbackState: 'MATCH',
  });
  rehashContract(applied);
  assert.ok(validateShadowContract(applied).includes('PAYLOAD_SEMANTICS_INVALID'));

  const breakGlass = mutable(SHADOW_INTERFACE_BUNDLE.assuranceBreakGlassReceipt);
  breakGlass.payload.used = true;
  breakGlass.payload.authenticationStrength = 'NONE';
  rehashContract(breakGlass);
  assert.ok(validateShadowContract(breakGlass).includes('PAYLOAD_SEMANTICS_INVALID'));
});

test('provider, durable-workflow, and effect budgets are bound to the owner envelope', () => {
  const usage = mutable(SHADOW_INTERFACE_BUNDLE.assuranceProviderUsageReceipt);
  usage.payload.costMicrounits = 1_001;
  rehashContract(usage);
  assert.ok(validateShadowContract(usage).includes('PAYLOAD_SEMANTICS_INVALID'));

  const reserve = mutable(SHADOW_INTERFACE_BUNDLE.a3ProviderDescriptor);
  reserve.payload.emergencyReserveMicrounits = 1_001;
  rehashContract(reserve);
  assert.ok(validateShadowContract(reserve).includes('PAYLOAD_SEMANTICS_INVALID'));

  const aggregate = mutable(SHADOW_INTERFACE_BUNDLE);
  aggregate.a3ToolDescriptor.payload.costLimitMicrounits = 1_001;
  aggregate.a3CredentialProxyRequest.payload.budgetMicrounits = 1_001;
  rehashContract(aggregate.a3ToolDescriptor);
  rehashContract(aggregate.a3CredentialProxyRequest);
  assert.ok(validateInterfaceBundle(aggregate).includes('CROSS_CONTRACT_BUDGET_EXCEEDED'));

  const durable = mutable(SHADOW_INTERFACE_BUNDLE);
  durable.a2AgentCase.payload.attemptBudgetRemaining = 3;
  durable.a2WorkflowCheckpoint.payload.attemptBudgetRemaining = 3;
  rehashContract(durable.a2AgentCase);
  rehashCheckpoint(durable.a2WorkflowCheckpoint);
  assert.ok(validateInterfaceBundle(durable).includes('CROSS_CONTRACT_DURABLE_BUDGET_MISMATCH'));

  for (const [field, value] of [
    ['effectBudgetRemaining', 1],
    ['nextAction', 'SUBMIT_LIVE_ORDER'],
    ['baseSha', sha256Hex('other-base')],
  ]) {
    const checkpoint = mutable(SHADOW_INTERFACE_BUNDLE.a2WorkflowCheckpoint);
    checkpoint.payload[field] = value;
    rehashCheckpoint(checkpoint);
    assert.ok(validateShadowContract(checkpoint).includes('PAYLOAD_SEMANTICS_INVALID'), field);
  }

  const ttl = mutable(SHADOW_INTERFACE_BUNDLE.a1ActionEnvelope);
  ttl.payload.ttlMs = 1;
  rehashContract(ttl);
  assert.ok(validateShadowContract(ttl).includes('PAYLOAD_SEMANTICS_INVALID'));
});

test('tool, scope, rollback, and model-route boundaries reject coordinated substitution', () => {
  for (const [field, value] of [
    ['dataClassification', 'PRIVATE_CREDENTIAL'],
    ['auditFields', []],
    ['postconditions', []],
  ]) {
    const tool = mutable(SHADOW_INTERFACE_BUNDLE.a3ToolDescriptor);
    tool.payload[field] = value;
    rehashContract(tool);
    assert.ok(validateShadowContract(tool).includes('PAYLOAD_SEMANTICS_INVALID'), field);
  }

  const emptyTool = mutable(SHADOW_INTERFACE_BUNDLE.a3ToolDescriptor);
  emptyTool.payload.toolId = '';
  rehashContract(emptyTool);
  assert.ok(validateShadowContract(emptyTool).includes('PAYLOAD_SEMANTICS_INVALID'));

  const route = mutable(SHADOW_INTERFACE_BUNDLE);
  route.a3CredentialProxyRequest.payload.modelRoute = 'other-model';
  rehashContract(route.a3CredentialProxyRequest);
  assert.ok(validateInterfaceBundle(route)
    .includes('a3CredentialProxyRequest:PAYLOAD_SEMANTICS_INVALID'));

  const scope = mutable(SHADOW_INTERFACE_BUNDLE);
  scope.a1PolicyDecision.payload.resourceScope = ['different-resource'];
  rehashContract(scope.a1PolicyDecision);
  assert.ok(validateInterfaceBundle(scope).includes('a1PolicyDecision:PAYLOAD_SEMANTICS_INVALID'));

  const blast = mutable(SHADOW_INTERFACE_BUNDLE.a1ActionEnvelope);
  blast.payload.blastRadius = 'ALL_PRODUCTION_RESOURCES';
  rehashContract(blast);
  assert.ok(validateShadowContract(blast).includes('PAYLOAD_SEMANTICS_INVALID'));

  const rollback = mutable(SHADOW_INTERFACE_BUNDLE.assuranceRollbackReceipt);
  Object.assign(rollback.payload, {
    disposition: 'ROLLED_BACK', independentReadbackState: 'MATCH', postconditionState: 'PASS',
    fromSha: sha256Hex('arbitrary-from'), toSha: sha256Hex('arbitrary-to'),
  });
  rollback.state = 'ROLLED_BACK';
  rehashContract(rollback);
  assert.ok(validateShadowContract(rollback).includes('PAYLOAD_SEMANTICS_INVALID'));

  const postconditions = mutable(SHADOW_INTERFACE_BUNDLE.a1ActionEnvelope);
  postconditions.payload.requiredPostconditions = [];
  rehashContract(postconditions);
  assert.ok(validateShadowContract(postconditions).includes('PAYLOAD_SEMANTICS_INVALID'));
});

test('pinned speculative identities reject coordinated recomputed-hash substitutions', () => {
  const rollback = mutable(SHADOW_INTERFACE_BUNDLE.assuranceControlChangeSet);
  rollback.payload.rollbackState = 'ROLLED_BACK_SUCCESS';
  rehashContract(rollback);
  assert.ok(validateShadowContract(rollback).includes('PAYLOAD_SEMANTICS_INVALID'));

  const productionScope = mutable(SHADOW_INTERFACE_BUNDLE);
  for (const [key, field] of [
    ['a1PolicyDecision', 'resourceScope'],
    ['a1PermissionProfile', 'resourceScope'],
    ['a1ApprovalRequest', 'resourceScope'],
    ['a1ApprovalReceipt', 'resourceScope'],
    ['a1ActionEnvelope', 'targetResourceIds'],
    ['a3ToolDescriptor', 'resourceScope'],
  ]) {
    productionScope[key].payload[field] = ['production-account'];
    rehashContract(productionScope[key]);
  }
  assert.notDeepEqual(validateInterfaceBundle(productionScope), []);

  for (const [field, value] of [
    ['schemaVersion', 'unreviewed-schema'],
    ['redactionPolicy', 'NONE'],
    ['sandboxIdentity', 'production-root'],
    ['auditFields', ['anything']],
    ['preconditions', ['EXECUTE_UNTRUSTED_TEXT']],
  ]) {
    const tool = mutable(SHADOW_INTERFACE_BUNDLE.a3ToolDescriptor);
    tool.payload[field] = value;
    rehashContract(tool);
    assert.ok(validateShadowContract(tool).includes('PAYLOAD_SEMANTICS_INVALID'), field);
  }

  for (const [field, value] of [
    ['authType', 'REAL_API_KEY'],
    ['retentionPosture', 'STORE_FOREVER'],
    ['storeBehavior', 'ENABLED'],
    ['capabilities', ['READ_ONLY_DIAGNOSIS', 'ORDER_MUTATION_DIRECT']],
    ['schemaParityHash', sha256Hex('substituted-provider-schema')],
    ['toolParityHash', sha256Hex('substituted-provider-tools')],
  ]) {
    const provider = mutable(SHADOW_INTERFACE_BUNDLE.a3ProviderDescriptor);
    provider.payload[field] = value;
    rehashContract(provider);
    assert.ok(validateShadowContract(provider).includes('PAYLOAD_SEMANTICS_INVALID'), field);
  }

  const model = mutable(SHADOW_INTERFACE_BUNDLE);
  model.a1PolicyDecision.payload.modelId = 'fixture-other-model';
  model.a3ProviderDescriptor.payload.modelId = 'fixture-other-model';
  model.a3Callback.payload.modelId = 'fixture-other-model';
  model.a3CredentialProxyRequest.payload.modelRoute = 'fixture-other-model';
  model.assuranceProviderUsageReceipt.payload.modelId = 'fixture-other-model';
  for (const key of [
    'a1PolicyDecision', 'a3ProviderDescriptor', 'a3Callback',
    'a3CredentialProxyRequest', 'assuranceProviderUsageReceipt',
  ]) rehashContract(model[key]);
  assert.notDeepEqual(validateInterfaceBundle(model), []);

  for (const [descriptorField, consumerKey, consumerField] of [
    ['inputSchemaHash', 'a3CredentialProxyRequest', 'requestSchemaHash'],
    ['outputSchemaHash', 'a3ToolOutput', 'schemaHash'],
  ]) {
    const schema = mutable(SHADOW_INTERFACE_BUNDLE);
    const substituted = sha256Hex(`substituted-${descriptorField}`);
    schema.a3ToolDescriptor.payload[descriptorField] = substituted;
    schema[consumerKey].payload[consumerField] = substituted;
    rehashContract(schema.a3ToolDescriptor);
    rehashContract(schema[consumerKey]);
    assert.notDeepEqual(validateInterfaceBundle(schema), [], descriptorField);
  }
});

test('authority windows and verifier metadata fail closed after coordinated mutation', () => {
  const preconditions = mutable(SHADOW_INTERFACE_BUNDLE);
  preconditions.a1ApprovalRequest.payload.livePreconditions = ['PRODUCT_WRITE_ALLOWED'];
  preconditions.a1ApprovalReceipt.payload.livePreconditions = ['PRODUCT_WRITE_ALLOWED'];
  preconditions.a1ActionEnvelope.payload.preconditions = ['PRODUCT_WRITE_ALLOWED'];
  for (const key of ['a1ApprovalRequest', 'a1ApprovalReceipt', 'a1ActionEnvelope']) {
    rehashContract(preconditions[key]);
  }
  assert.notDeepEqual(validateInterfaceBundle(preconditions), []);

  const shortToolAuthority = mutable(SHADOW_INTERFACE_BUNDLE);
  shortToolAuthority.a3ToolDescriptor.payload.ttlMs = 1_000;
  rehashContract(shortToolAuthority.a3ToolDescriptor);
  assert.ok(validateInterfaceBundle(shortToolAuthority)
    .includes('CROSS_CONTRACT_TOOL_AUTHORITY_EXPIRY_MISMATCH'));

  const longCredentialAuthority = mutable(SHADOW_INTERFACE_BUNDLE);
  longCredentialAuthority.a3CredentialProxyRequest.payload.expiresAtMs += 1;
  rehashContract(longCredentialAuthority.a3CredentialProxyRequest);
  assert.ok(validateInterfaceBundle(longCredentialAuthority)
    .includes('a3CredentialProxyRequest:PAYLOAD_SEMANTICS_INVALID'));

  for (const [field, value] of [
    ['verifierRevision', ''],
    ['sharedAncestry', 'NONE'],
    ['recurrenceState', 'RESOLVED'],
  ]) {
    const verification = mutable(SHADOW_INTERFACE_BUNDLE.assuranceVerificationReceipt);
    verification.payload[field] = value;
    rehashContract(verification);
    assert.ok(validateShadowContract(verification).includes('PAYLOAD_SEMANTICS_INVALID'), field);
  }

  const verifier = mutable(SHADOW_INTERFACE_BUNDLE);
  verifier.a1ActionEnvelope.payload.independentVerifierId = 'fixture-independent-verifier-2';
  verifier.assuranceVerificationReceipt.payload.verifierId = 'fixture-independent-verifier-2';
  rehashContract(verifier.a1ActionEnvelope);
  rehashContract(verifier.assuranceVerificationReceipt);
  assert.notDeepEqual(validateInterfaceBundle(verifier), []);
});

test('all speculative contracts pin state, provenance, owner, base, and unfinished markers', () => {
  for (const canonical of Object.values(SHADOW_INTERFACE_BUNDLE)) {
    for (const mutate of [
      (contract) => { contract.state = 'ALLOWED'; },
      (contract) => { contract.sourceRevision = 'other-source-revision'; },
      (contract) => { contract.provenance = 'INTEGRATED_ACCEPTED_RECEIPT'; },
      (contract) => { contract.owner = 'CANONICAL_ACCEPTED_OWNER'; },
      (contract) => { contract.stableId = 'canonical-live-object'; },
      (contract) => { contract.unknownFields = []; },
    ]) {
      const contract = mutable(canonical);
      mutate(contract);
      rehashContract(contract);
      assert.ok(validateShadowContract(contract).includes('FIXTURE_METADATA_MISMATCH'),
        `${canonical.objectType}:${contract.state}:${contract.provenance}`);
    }
  }
});

test('typed output, canary, callback, and durable state reject recomputed false greens', () => {
  for (const mutate of [
    (contract) => { contract.payload.schemaValid = false; },
    (contract) => { contract.payload.data.instruction = 'WITHDRAW_FUNDS'; },
    (contract) => {
      contract.payload.data = { classification: 'PRIVATE_CREDENTIAL', finding: 'ORDER_ALLOWED' };
      contract.payload.contentHash = sha256Hex(contract.payload.data);
    },
  ]) {
    const output = mutable(SHADOW_INTERFACE_BUNDLE.a3ToolOutput);
    mutate(output);
    rehashContract(output);
    assert.ok(validateShadowContract(output).includes('PAYLOAD_SEMANTICS_INVALID'));
  }

  const canary = mutable(SHADOW_INTERFACE_BUNDLE.assuranceCanaryReceipt);
  Object.assign(canary.payload, {
    cohortState: 'COMPARABLE', comparisonState: 'COMPARABLE', disposition: 'PASS',
    finiteMetrics: true, promotionAllowed: true, sampleCount: 10,
  });
  canary.state = 'PASS';
  rehashContract(canary);
  assert.notDeepEqual(validateShadowContract(canary), []);

  const callback = mutable(SHADOW_INTERFACE_BUNDLE.a3Callback);
  callback.payload.signatureState = 'INVALID';
  callback.payload.timestampState = 'STALE';
  rehashContract(callback);
  assert.ok(validateShadowContract(callback).includes('PAYLOAD_SEMANTICS_INVALID'));

  const agentCase = mutable(SHADOW_INTERFACE_BUNDLE.a2AgentCase);
  agentCase.state = 'RESOLVED';
  agentCase.payload.state = 'RESOLVED';
  agentCase.payload.transitions = [];
  rehashContract(agentCase);
  assert.notDeepEqual(validateShadowContract(agentCase), []);

  const checkpoint = mutable(SHADOW_INTERFACE_BUNDLE.a2WorkflowCheckpoint);
  checkpoint.payload.state = 'RESOLVED';
  rehashCheckpoint(checkpoint);
  assert.ok(validateShadowContract(checkpoint).includes('PAYLOAD_SEMANTICS_INVALID'));
});

test('evidence truth, payload base SHAs, and standalone expiries remain fixture-bound', () => {
  const evidence = mutable(SHADOW_INTERFACE_BUNDLE.a2EvidenceBundle);
  evidence.payload.capitalPosture = 'READY';
  evidence.payload.lifecycleStates = ['HEALTHY'];
  evidence.payload.freshnessReport = { state: 'READY', observedAtMs: 0 };
  rehashContract(evidence);
  assert.ok(validateShadowContract(evidence).includes('PAYLOAD_SEMANTICS_INVALID'));

  for (const [key, fields] of [
    ['a1ApprovalRequest', ['baseSha', 'candidateSha', 'deployedSha']],
    ['a1ApprovalReceipt', ['baseSha', 'candidateSha', 'deployedSha']],
    ['a2EvidenceBundle', ['deployedSha']],
  ]) {
    for (const field of fields) {
      const contract = mutable(SHADOW_INTERFACE_BUNDLE[key]);
      contract.payload[field] = 'current-main';
      rehashContract(contract);
      assert.ok(validateShadowContract(contract).includes('PAYLOAD_SEMANTICS_INVALID'), `${key}.${field}`);
    }
  }

  for (const key of ['a1PolicyDecision', 'a1PermissionProfile', 'a1ApprovalRequest',
    'a1ApprovalReceipt', 'a3CredentialProxyRequest', 'assuranceBreakGlassReceipt']) {
    const contract = mutable(SHADOW_INTERFACE_BUNDLE[key]);
    contract.payload.expiresAtMs = 8_640_000_000_000_000;
    rehashContract(contract);
    assert.ok(validateShadowContract(contract).includes('PAYLOAD_SEMANTICS_INVALID'), key);
  }
});

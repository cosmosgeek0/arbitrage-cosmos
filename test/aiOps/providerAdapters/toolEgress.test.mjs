import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadA3 } from './networkDeny.mjs';

const a3 = await loadA3();
const digest = 'b'.repeat(64);
const nowMs = 1_700_000_000_000;

function standardInput() {
  return {
    atRevision: 'revision-test-only',
    requestId: 'tool-request-test-only',
    caseId: 'case-test-only',
    evidenceDigest: digest,
    scope: 'AI_OPS',
  };
}

function admissionRequest(overrides = {}) {
  const toolId = overrides.toolId ?? 'getSupervisorSnapshot';
  return {
    schema: 'AI_OPS_TOOL_CALL_ADMISSION_REQUEST_V1',
    requestId: 'tool-request-test-only',
    toolId,
    toolVersion: 1,
    role: 'RUNTIME_DIAGNOSTICIAN',
    principalId: 'principal-test-only',
    providerId: 'provider-test-only',
    providerRevision: 'provider-revision-test-only',
    modelId: 'model-test-only',
    modelRevision: 'model-revision-test-only',
    promptRevision: 'prompt-test-only',
    toolRevision: `${toolId}:v1`,
    controlRevision: 'control-test-only',
    runId: 'run-test-only',
    parentRunId: null,
    mode: 'SUBSCRIPTION_CODEX_WORKER',
    environmentId: 'isolated-diagnostic-test-only',
    repositoryRevision: null,
    pathScope: [],
    resourceIds: ['resource-test-only'],
    caseId: 'case-test-only',
    evidenceDigest: digest,
    evidenceBundleDigest: 'c'.repeat(64),
    actionArtifactDigest: null,
    capitalExposureState: 'NOT_APPLICABLE_DIAGNOSTIC_ONLY',
    riskClass: 'READ_ONLY',
    reversible: true,
    maximumBlastRadius: 'none-test-only',
    attemptBudget: 1,
    concurrencyBudget: 1,
    tokenBudget: 1000,
    costBudgetMicrounits: 0,
    requiredApproverIds: [],
    input: standardInput(),
    requestedPermission: 'OBSERVE_EXPLAIN',
    requestedCapabilities: ['READ_REDACTED_EVIDENCE'],
    hookPhase: 'PRE_TOOL_USE',
    bypassRequested: false,
    ...overrides,
  };
}

function policyFor(request, registry, overrides = {}) {
  const row = registry.find((candidate) => candidate.toolId === request.toolId);
  let inputDigest;
  try {
    inputDigest = a3.toolInputDigest(request.toolId, request.input);
  } catch {
    inputDigest = '0'.repeat(64);
  }
  return {
    schema: 'AI_OPS_TOOL_POLICY_EVIDENCE_V1',
    decision: 'ALLOW',
    signatureVerified: true,
    canonicalOwnerEvidenceVerified: true,
    canonicalOwnerEvidenceDigest: 'f'.repeat(64),
    ownerBoundaryDecision: {
      verdict: 'PASS',
      allowed: true,
      authorityGranted: false,
      providerState: 'READY',
      reasonCodes: [],
    },
    requestId: request.requestId,
    caseId: request.caseId,
    role: request.role,
    toolId: request.toolId,
    toolVersion: 1,
    principalId: request.principalId,
    providerId: request.providerId,
    providerRevision: request.providerRevision,
    modelId: request.modelId,
    modelRevision: request.modelRevision,
    promptRevision: request.promptRevision,
    toolRevision: request.toolRevision,
    controlRevision: request.controlRevision,
    runId: request.runId,
    parentRunId: request.parentRunId,
    mode: request.mode,
    environmentId: request.environmentId,
    repositoryRevision: request.repositoryRevision,
    pathScope: request.pathScope,
    resourceIds: request.resourceIds,
    evidenceDigest: request.evidenceDigest,
    evidenceBundleDigest: request.evidenceBundleDigest,
    actionArtifactDigest: request.actionArtifactDigest,
    registeredActionId: request.toolId === 'createTypedProposal' ? request.input.registeredActionId : null,
    registeredActionRegistryDigest: request.toolId === 'createTypedProposal' ? '7'.repeat(64) : null,
    registeredActionMembershipVerified: request.toolId === 'createTypedProposal',
    capitalExposureState: request.capitalExposureState,
    riskClass: request.riskClass,
    reversible: request.reversible,
    maximumBlastRadius: request.maximumBlastRadius,
    attemptBudget: request.attemptBudget,
    concurrencyBudget: request.concurrencyBudget,
    tokenBudget: request.tokenBudget,
    costBudgetMicrounits: request.costBudgetMicrounits,
    requiredApproverIds: request.requiredApproverIds,
    requiredPermission: row?.requiredPermission ?? 'OBSERVE_EXPLAIN',
    requiredCapability: row?.requiredCapability ?? 'READ_REDACTED_EVIDENCE',
    registryDigest: a3.toolRegistryDigest(registry),
    inputDigest,
    policyRevision: 'policy-test-only',
    validFromMs: nowMs - 1,
    expiresAtMs: nowMs + (row?.approvalTtlMs ?? 60_000) - 1,
    childCapabilities: [...request.requestedCapabilities],
    childGrantMode: 'EXACT_EXPLICIT',
    hardDenialResult: 'NONE',
    durableAuditAvailable: true,
    ...overrides,
  };
}

describe('A3 strict typed tool gateway', () => {
  it('owns no capability and ships a closed disabled registry', () => {
    assert.equal(a3.A3_TOOL_REGISTRY.length, 13);
    assert.equal(a3.A3_TOOL_REGISTRY.every((row) => row.enabled === false), true);
    assert.deepEqual(a3.validateToolRegistry(), []);
    assert.doesNotThrow(() => a3.validateToolRegistry([null]));
    assert.notDeepEqual(a3.validateToolRegistry([null]), []);
    for (const row of a3.A3_TOOL_REGISTRY) {
      assert.equal(row.inputSchema.additionalProperties, false);
      assert.equal(row.outputSchema.additionalProperties, false);
      assert.equal(row.networkAllowlist.length, 0);
      assert.equal(row.maximumCostMicrounits, 0);
      assert.equal(row.auditEvidenceFields.length > 0, true);
      assert.deepEqual([...row.inputSchema.required].sort(), Object.keys(row.inputSchema.properties).sort());
    }
    const explicitOwnerHandoff = a3.A3_TOOL_REGISTRY.find((row) => row.toolId === 'requestApproval');
    assert.deepEqual(explicitOwnerHandoff.allowedRoles, []);
    for (const row of a3.A3_TOOL_REGISTRY.filter((candidate) => candidate.toolId !== 'requestApproval')) {
      const eligible = row.allowedRoles.some((role) => {
        const identity = a3.AI_IDENTITY_MATRIX.find((candidate) => candidate.role === role);
        return identity !== undefined && identity.allowedCapabilities.includes(row.requiredCapability);
      });
      assert.equal(eligible, true, row.toolId);
    }
  });

  it('denies the shipped registry even with apparently valid policy evidence', () => {
    const request = admissionRequest();
    const decision = a3.evaluateToolCallAdmission(request, policyFor(request, a3.A3_TOOL_REGISTRY), nowMs);
    assert.equal(decision.allowed, false);
    assert.equal(decision.authorityGranted, false);
    assert.match(decision.reasonCodes.join(','), /TOOL_NOT_CONFIGURED/);
  });

  it('models an external owner enablement without executing and rejects bypass permission', () => {
    const registry = a3.A3_TOOL_REGISTRY.map((row) => row.toolId === 'getSupervisorSnapshot' ? { ...row, enabled: true } : row);
    const request = admissionRequest();
    const policy = policyFor(request, registry);
    const admitted = a3.evaluateToolCallAdmission(request, policy, nowMs, registry);
    assert.equal(admitted.allowed, true);
    assert.equal(admitted.authorityGranted, false);
    assert.equal(admitted.disposition, 'ADMIT_TO_EXTERNAL_EXECUTOR_PORT');

    const bypass = admissionRequest({ bypassRequested: true });
    const denied = a3.evaluateToolCallAdmission(bypass, policyFor(bypass, registry), nowMs, registry);
    assert.equal(denied.allowed, false);
    assert.match(denied.reasonCodes.join(','), /BYPASS_PERMISSION_FORBIDDEN/);
  });

  it('rejects unknown tools, extra input fields, stale evidence and child-capability escalation', () => {
    const unknown = admissionRequest({ toolId: 'unknownTool' });
    assert.equal(a3.evaluateToolCallAdmission(unknown, policyFor(unknown, a3.A3_TOOL_REGISTRY), nowMs).disposition, 'UNREGISTERED_PROPOSAL');

    const registry = a3.A3_TOOL_REGISTRY.map((row) => row.toolId === 'getSupervisorSnapshot' ? { ...row, enabled: true } : row);
    const extra = admissionRequest({ input: { ...standardInput(), surprise: true } });
    const extraDecision = a3.evaluateToolCallAdmission(extra, policyFor(extra, registry), nowMs, registry);
    assert.match(extraDecision.reasonCodes.join(','), /TOOL_INPUT_SCHEMA_REJECTED/);

    const child = admissionRequest();
    const childDecision = a3.evaluateToolCallAdmission(child, policyFor(child, registry, {
      childCapabilities: ['RUN_ISOLATED_TESTS'],
    }), nowMs, registry);
    assert.match(childDecision.reasonCodes.join(','), /CHILD_CAPABILITY_GRANT_MISMATCH/);

    const stale = admissionRequest();
    const staleDecision = a3.evaluateToolCallAdmission(stale, policyFor(stale, registry, {
      validFromMs: nowMs - 10_000,
      expiresAtMs: nowMs,
    }), nowMs, registry);
    assert.match(staleDecision.reasonCodes.join(','), /TOOL_POLICY_STALE_OR_INVALID/);
  });

  it('requires exact security booleans and canonical PASS owner evidence', () => {
    const registry = a3.A3_TOOL_REGISTRY.map((row) => row.toolId === 'getSupervisorSnapshot' ? { ...row, enabled: true } : row);
    const request = admissionRequest();
    const hostile = a3.evaluateToolCallAdmission(request, policyFor(request, registry, {
      signatureVerified: 'YES',
      canonicalOwnerEvidenceVerified: 'YES',
      durableAuditAvailable: 'YES',
      ownerBoundaryDecision: {
        verdict: 'SUPPORTED',
        allowed: true,
        authorityGranted: false,
        providerState: 'READY',
        reasonCodes: [],
      },
    }), nowMs, registry);
    assert.equal(hostile.allowed, false);
    assert.match(hostile.reasonCodes.join(','), /TOOL_POLICY_SIGNATURE_UNVERIFIED/);
    assert.match(hostile.reasonCodes.join(','), /CANONICAL_OWNER_EVIDENCE_UNVERIFIED/);
    assert.match(hostile.reasonCodes.join(','), /DURABLE_AUDIT_UNAVAILABLE/);
    assert.match(hostile.reasonCodes.join(','), /CANONICAL_DIAGNOSTIC_BOUNDARY_DENIED/);

    const reasonBearingPass = a3.evaluateToolCallAdmission(request, policyFor(request, registry, {
      ownerBoundaryDecision: {
        verdict: 'PASS',
        allowed: true,
        authorityGranted: false,
        providerState: 'READY',
        reasonCodes: ['unexpected-test-only'],
      },
    }), nowMs, registry);
    assert.match(reasonBearingPass.reasonCodes.join(','), /CANONICAL_DIAGNOSTIC_BOUNDARY_DENIED/);

    const nonBooleanRequest = admissionRequest({ reversible: 'YES' });
    const nonBooleanDecision = a3.evaluateToolCallAdmission(nonBooleanRequest, policyFor(nonBooleanRequest, registry), nowMs, registry);
    assert.match(nonBooleanDecision.reasonCodes.join(','), /TOOL_REVERSIBILITY_FLAG_INVALID/);

    const truthyRegistry = a3.A3_TOOL_REGISTRY.map((row) => row.toolId === 'getSupervisorSnapshot' ? { ...row, enabled: 'YES' } : row);
    const truthyDecision = a3.evaluateToolCallAdmission(request, policyFor(request, truthyRegistry), nowMs, truthyRegistry);
    assert.equal(truthyDecision.allowed, false);
    assert.match(truthyDecision.reasonCodes.join(','), /TOOL_REGISTRY_INVALID|TOOL_NOT_CONFIGURED/);

    const longLived = a3.evaluateToolCallAdmission(request, policyFor(request, registry, {
      validFromMs: nowMs - 1,
      expiresAtMs: nowMs + 60_000,
    }), nowMs, registry);
    assert.match(longLived.reasonCodes.join(','), /TOOL_POLICY_STALE_OR_INVALID/);

    const oversized = admissionRequest({ resourceIds: Array.from({ length: 65 }, (_, index) => `resource-${index}`) });
    const oversizedDecision = a3.evaluateToolCallAdmission(oversized, policyFor(oversized, registry), nowMs, registry);
    assert.match(oversizedDecision.reasonCodes.join(','), /TOOL_RESOURCE_SCOPE_INVALID/);
  });

  it('accepts exact patch roots and cross-binds proposal security fields', () => {
    const patchRow = a3.A3_TOOL_REGISTRY.find((row) => row.toolId === 'createIsolatedPatchTask');
    const patchInput = {
      artifactDigest: '1'.repeat(64),
      caseId: 'case-test-only',
      evidenceDigest: digest,
      repositoryRevision: '03857dcdaff8d8b12627d27ddcc97505da1f2f86',
      requestId: 'tool-request-test-only',
      scopeRoots: [...a3.A3_EXCLUSIVE_PATCH_ROOTS],
    };
    assert.equal(a3.validateStrictValue(patchRow.inputSchema, patchInput).valid, true);
    assert.equal(a3.validateStrictValue(patchRow.inputSchema, { ...patchInput, scopeRoots: ['server/src/index.ts'] }).valid, false);

    const registry = a3.A3_TOOL_REGISTRY.map((row) => row.toolId === 'createTypedProposal' ? { ...row, enabled: true } : row);
    const proposalInput = {
      artifactDigest: '1'.repeat(64),
      attemptBudget: 1,
      blastRadius: 'none-test-only',
      caseId: 'case-test-only',
      controlRevision: 'control-test-only',
      createdAtMs: nowMs,
      evidenceDigest: digest,
      exactTargetResourceIds: ['resource-test-only'],
      expectedPostconditions: ['postcondition-test-only'],
      expiresAtMs: nowMs + 60_000,
      incidentId: 'incident-test-only',
      independentVerifierId: 'verifier-test-only',
      maximumEffect: 'proposal-only-test',
      modelId: 'model-test-only',
      modelRevision: 'model-revision-test-only',
      policyRevision: 'policy-test-only',
      preconditions: ['precondition-test-only'],
      promptRevision: 'prompt-test-only',
      proposalId: 'proposal-test-only',
      providerId: 'provider-test-only',
      providerRevision: 'provider-revision-test-only',
      rationale: 'Test-only bounded proposal.',
      registeredActionId: 'registered-action-test-only',
      requestId: 'tool-request-test-only',
      requestedCapability: 'PROPOSE_REGISTERED_REMEDIATION',
      requiredApprovalPrincipalId: 'owner-test-only',
      rollbackOrCompensationId: 'rollback-test-only',
      supportingEvidenceHashes: [digest, 'c'.repeat(64)],
      toolRevision: 'createTypedProposal:v1',
    };
    const proposal = admissionRequest({
      toolId: 'createTypedProposal',
      requestedPermission: 'PROPOSE_TYPED_ACTION',
      requestedCapabilities: ['PROPOSE_REGISTERED_REMEDIATION'],
      input: proposalInput,
      actionArtifactDigest: '1'.repeat(64),
      riskClass: 'PROPOSAL',
      requiredApproverIds: ['owner-test-only'],
    });
    const policy = policyFor(proposal, registry);
    assert.equal(a3.evaluateToolCallAdmission(proposal, policy, nowMs, registry).allowed, true);
    const proxyEvidence = new Proxy([digest, 'c'.repeat(64)], {
      get(target, property, receiver) {
        if (property === 'includes') throw new Error('hostile includes');
        return Reflect.get(target, property, receiver);
      },
    });
    const proxyProposal = { ...proposal, input: { ...proposalInput, supportingEvidenceHashes: proxyEvidence } };
    assert.doesNotThrow(() => a3.evaluateToolCallAdmission(proxyProposal, policyFor(proxyProposal, registry), nowMs, registry));
    assert.equal(a3.evaluateToolCallAdmission(proxyProposal, policyFor(proxyProposal, registry), nowMs, registry).allowed, true);
    const underlyingEvidence = ['d'.repeat(64), 'e'.repeat(64)];
    const descriptorConfusedEvidence = new Proxy(underlyingEvidence, {
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (descriptor === undefined) return undefined;
        if (property === '0') return { ...descriptor, value: digest };
        if (property === '1') return { ...descriptor, value: 'c'.repeat(64) };
        return descriptor;
      },
    });
    const confusedEvidenceProposal = {
      ...proposal,
      input: { ...proposalInput, supportingEvidenceHashes: descriptorConfusedEvidence },
    };
    const confusedEvidenceDecision = a3.evaluateToolCallAdmission(
      confusedEvidenceProposal,
      policyFor(confusedEvidenceProposal, registry),
      nowMs,
      registry,
    );
    assert.equal(confusedEvidenceDecision.allowed, false);
    assert.match(confusedEvidenceDecision.reasonCodes.join(','), /TOOL_INPUT_DIGEST_MISMATCH/);
    const unregistered = {
      ...proposal,
      input: { ...proposalInput, registeredActionId: 'UNREGISTERED' },
    };
    const unregisteredDecision = a3.evaluateToolCallAdmission(unregistered, policyFor(unregistered, registry), nowMs, registry);
    assert.equal(unregisteredDecision.allowed, false);
    assert.equal(unregisteredDecision.disposition, 'UNREGISTERED_PROPOSAL');
    assert.match(unregisteredDecision.reasonCodes.join(','), /REGISTERED_ACTION_MEMBERSHIP_UNVERIFIED/);
    const confused = admissionRequest({
      ...proposal,
      input: { ...proposalInput, attemptBudget: 2 },
    });
    const confusedDecision = a3.evaluateToolCallAdmission(confused, policyFor(confused, registry), nowMs, registry);
    assert.match(confusedDecision.reasonCodes.join(','), /TOOL_SPECIFIC_SUBJECT_BINDING_MISMATCH/);
  });

  it('rejects empty signed grants, subject-confused inputs, identity escalation and non-JSON cycles', () => {
    const registry = a3.A3_TOOL_REGISTRY.map((row) => row.toolId === 'getSupervisorSnapshot' ? { ...row, enabled: true } : row);
    const request = admissionRequest();
    const emptyGrant = a3.evaluateToolCallAdmission(request, policyFor(request, registry, { childCapabilities: [] }), nowMs, registry);
    assert.match(emptyGrant.reasonCodes.join(','), /SIGNED_REQUIRED_CAPABILITY_MISSING/);

    const confused = admissionRequest({ input: { ...standardInput(), caseId: 'different-case-test-only' } });
    const confusedDecision = a3.evaluateToolCallAdmission(confused, policyFor(confused, registry), nowMs, registry);
    assert.match(confusedDecision.reasonCodes.join(','), /TOOL_INPUT_SUBJECT_BINDING_MISMATCH/);

    let resourceDescriptorReads = 0;
    const confusedResources = new Proxy(['resource-evil-test-only'], {
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property !== '0' || descriptor === undefined) return descriptor;
        resourceDescriptorReads += 1;
        return { ...descriptor, value: resourceDescriptorReads === 1 ? 'resource-evil-test-only' : 'resource-signed-test-only' };
      },
    });
    const resourceRequest = admissionRequest({ resourceIds: confusedResources });
    const resourcePolicy = policyFor(resourceRequest, registry, { resourceIds: ['resource-signed-test-only'] });
    const resourceDecision = a3.evaluateToolCallAdmission(resourceRequest, resourcePolicy, nowMs, registry);
    assert.equal(resourceDecision.allowed, false);
    assert.match(resourceDecision.reasonCodes.join(','), /TOOL_POLICY_SUBJECT_BINDING_MISMATCH/);

    const gateRegistry = a3.A3_TOOL_REGISTRY.map((row) => row.toolId === 'runSandboxGate' ? { ...row, enabled: true } : row);
    const gate = admissionRequest({
      toolId: 'runSandboxGate',
      role: 'INDEPENDENT_VERIFIER',
      requestedPermission: 'PATCH_ISOLATED_AND_TEST',
      requestedCapabilities: ['RUN_ISOLATED_TESTS'],
      repositoryRevision: '03857dcdaff8d8b12627d27ddcc97505da1f2f86',
      pathScope: [...a3.A3_EXCLUSIVE_PATCH_ROOTS],
      input: {
        requestId: 'tool-request-test-only',
        caseId: 'case-test-only',
        evidenceDigest: digest,
        gateId: 'gate-test-only',
        patchHash: '2'.repeat(64),
      },
      actionArtifactDigest: '1'.repeat(64),
      riskClass: 'CLASS_C_ISOLATED',
    });
    const gateDecision = a3.evaluateToolCallAdmission(gate, policyFor(gate, gateRegistry), nowMs, gateRegistry);
    assert.match(gateDecision.reasonCodes.join(','), /IDENTITY_PERMISSION_CEILING_EXCEEDED/);

    const cyclicInput = standardInput();
    cyclicInput.self = cyclicInput;
    const cyclic = admissionRequest({ input: cyclicInput });
    const cyclicDecision = a3.evaluateToolCallAdmission(cyclic, policyFor(cyclic, registry), nowMs, registry);
    assert.equal(cyclicDecision.allowed, false);
    assert.match(cyclicDecision.reasonCodes.join(','), /TOOL_INPUT_SCHEMA_REJECTED|TOOL_CANONICALIZATION_REJECTED/);

    const bigint = admissionRequest({ input: { ...standardInput(), atRevision: 1n } });
    assert.doesNotThrow(() => a3.evaluateToolCallAdmission(bigint, policyFor(bigint, registry), nowMs, registry));
    const bigintDecision = a3.evaluateToolCallAdmission(bigint, policyFor(bigint, registry), nowMs, registry);
    assert.equal(bigintDecision.allowed, false);
    assert.match(bigintDecision.reasonCodes.join(','), /TOOL_INPUT_SCHEMA_REJECTED|TOOL_CANONICALIZATION_REJECTED/);
  });

  it('rejects unsupported or malformed schema definitions without throwing', () => {
    assert.equal(a3.validateStrictSchemaDefinition({ type: 'number' }).valid, false);
    assert.equal(a3.validateStrictValue({ type: 'number' }, 1).valid, false);
    assert.equal(a3.validateStrictSchemaDefinition({
      type: 'object',
      properties: {},
      required: 'not-an-array',
      additionalProperties: false,
    }).valid, false);
    const hostileSchema = {};
    Object.defineProperty(hostileSchema, 'type', { enumerable: true, get() { throw new Error('hostile schema getter'); } });
    assert.doesNotThrow(() => a3.validateStrictSchemaDefinition(hostileSchema));
    assert.equal(a3.validateStrictSchemaDefinition(hostileSchema).valid, false);
    let schemaTypeReads = 0;
    const statefulSchema = new Proxy({ type: 'string' }, {
      get(target, property, receiver) {
        if (property === 'type') {
          schemaTypeReads += 1;
          if (schemaTypeReads >= 4) return 'boolean';
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const statefulSchemaDecision = a3.validateStrictValue(statefulSchema, true);
    assert.equal(statefulSchemaDecision.valid, false);
    const hostileRecord = new Proxy({}, { getPrototypeOf() { throw new Error('hostile prototype'); } });
    assert.equal(a3.isPlainRecord(hostileRecord), false);
    assert.equal(a3.isJsonValue(hostileRecord), false);
    assert.doesNotThrow(() => a3.validateStrictValue({
      type: 'object', properties: {}, required: [], additionalProperties: false,
    }, hostileRecord));
    const hostileArray = new Proxy([], {
      get(target, property, receiver) {
        if (property === 'length') throw new Error('hostile array length');
        return Reflect.get(target, property, receiver);
      },
    });
    assert.doesNotThrow(() => a3.validateStrictValue({
      type: 'array', items: { type: 'string' }, maxItems: 1,
    }, hostileArray));
    let oversizedArrayEnumerated = false;
    const oversizedArray = new Proxy(new Array(2), {
      ownKeys(target) {
        oversizedArrayEnumerated = true;
        return Reflect.ownKeys(target);
      },
    });
    assert.equal(a3.validateStrictValue({
      type: 'array', items: { type: 'string' }, maxItems: 1,
    }, oversizedArray).valid, false);
    assert.equal(oversizedArrayEnumerated, false);
    let ownKeysCalls = 0;
    const statefulRecord = new Proxy({}, {
      ownKeys() {
        ownKeysCalls += 1;
        if (ownKeysCalls > 1) throw new Error('stateful proxy keys');
        return [];
      },
    });
    assert.doesNotThrow(() => a3.validateStrictValue({
      type: 'object', properties: {}, required: [], additionalProperties: false,
    }, statefulRecord));
    assert.equal(a3.validateStrictValue({
      type: 'object', properties: {}, required: [], additionalProperties: false,
    }, statefulRecord).valid, false);
    const hostileRegistry = new Proxy([...a3.A3_TOOL_REGISTRY], {
      ownKeys() {
        throw new Error('hostile registry keys');
      },
    });
    assert.doesNotThrow(() => a3.validateToolRegistry(hostileRegistry));
    assert.notDeepEqual(a3.validateToolRegistry(hostileRegistry), []);
    let oversizedRegistryEnumerated = false;
    const oversizedRegistry = new Proxy(new Array(a3.A3_TOOL_REGISTRY.length + 1), {
      ownKeys(target) {
        oversizedRegistryEnumerated = true;
        return Reflect.ownKeys(target);
      },
    });
    assert.notDeepEqual(a3.validateToolRegistry(oversizedRegistry), []);
    assert.equal(oversizedRegistryEnumerated, false);

    const gatewayRegistry = a3.A3_TOOL_REGISTRY.map((row) => row.toolId === 'getSupervisorSnapshot'
      ? { ...row, enabled: true, allowedModes: new Proxy([...row.allowedModes], {
        get(target, property, receiver) {
          if (property === 'includes') throw new Error('hostile registry includes');
          return Reflect.get(target, property, receiver);
        },
      }) }
      : row);
    const gatewayRequest = admissionRequest();
    assert.doesNotThrow(() => a3.evaluateToolCallAdmission(gatewayRequest, policyFor(gatewayRequest, gatewayRegistry), nowMs, gatewayRegistry));
    assert.equal(a3.evaluateToolCallAdmission(gatewayRequest, policyFor(gatewayRequest, gatewayRegistry), nowMs, gatewayRegistry).allowed, true);
    const findTrapRegistry = new Proxy(gatewayRegistry, {
      get(target, property, receiver) {
        if (property === 'find') return () => ({ ...target[0], toolId: 'requestApproval' });
        return Reflect.get(target, property, receiver);
      },
    });
    assert.equal(
      a3.evaluateToolCallAdmission(gatewayRequest, policyFor(gatewayRequest, findTrapRegistry), nowMs, findTrapRegistry).allowed,
      true,
    );
    const disabledFindTrapRegistry = new Proxy(a3.A3_TOOL_REGISTRY, {
      get(target, property, receiver) {
        if (property === 'find') return () => ({ ...target[0], enabled: true });
        return Reflect.get(target, property, receiver);
      },
    });
    const disabledDecision = a3.evaluateToolCallAdmission(
      gatewayRequest,
      policyFor(gatewayRequest, disabledFindTrapRegistry),
      nowMs,
      disabledFindTrapRegistry,
    );
    assert.equal(disabledDecision.allowed, false);
    assert.match(disabledDecision.reasonCodes.join(','), /TOOL_NOT_CONFIGURED/);
  });

  it('validates outputs strictly and rejects unknown fields', () => {
    const registry = a3.A3_TOOL_REGISTRY.map((row) => row.toolId === 'getSupervisorSnapshot' ? { ...row, enabled: true } : row);
    const request = admissionRequest();
    const admission = a3.evaluateToolCallAdmission(request, policyFor(request, registry), nowMs, registry);
    assert.equal(admission.allowed, true);
    const valid = {
      caseId: admission.caseId,
      environmentId: admission.environmentId,
      inputDigest: admission.inputDigest,
      mode: admission.mode,
      modelId: admission.modelId,
      policyRevision: admission.policyRevision,
      principalId: admission.principalId,
      providerId: admission.providerId,
      requestId: 'tool-request-test-only',
      resultDigest: digest,
      role: admission.role,
      runId: admission.runId,
      status: 'COMPLETED',
      toolId: admission.toolId,
      evidenceRefs: ['evidence-test-only'],
    };
    assert.equal(a3.validateToolOutput(admission, valid).valid, true);
    assert.equal(a3.validateToolOutput(admission, { ...valid, hidden: 'not-allowed' }).valid, false);
    assert.equal(a3.validateToolOutput(admission, { ...valid, requestId: 'different-request-test-only' }).valid, false);
    const crossSubjectAdmission = { ...admission, principalId: 'different-principal-test-only' };
    assert.equal(a3.validateToolOutput(crossSubjectAdmission, valid).valid, false);
    const hostileOutput = {};
    for (const [key, value] of Object.entries(valid)) {
      Object.defineProperty(hostileOutput, key, key === 'requestId'
        ? { enumerable: true, get() { throw new Error('hostile output getter'); } }
        : { enumerable: true, value });
    }
    assert.doesNotThrow(() => a3.validateToolOutput(admission, hostileOutput));
    assert.equal(a3.validateToolOutput(admission, hostileOutput).valid, false);
  });
});

describe('A3 credential and egress boundary', () => {
  function request(overrides = {}) {
    return {
      schema: 'AI_OPS_EGRESS_ADMISSION_REQUEST_V1',
      requestId: 'egress-request-test-only',
      routeId: 'codex-provider-test-only',
      principalId: 'principal-test-only',
      identityRole: 'RUNTIME_DIAGNOSTICIAN',
      providerId: 'codex-subscription-worker',
      modelId: 'model-test-only',
      runId: 'run-test-only',
      environmentId: 'isolated-diagnostic-test-only',
      toolId: 'runApprovedWebResearch',
      toolAdmissionDigest: '8'.repeat(64),
      policyReceiptId: 'policy-receipt-test-only',
      exactHost: 'codex-provider.test.invalid',
      exactPath: '/v1/test-only-never-send',
      method: 'POST',
      caseId: 'case-test-only',
      evidenceDigest: digest,
      bodySchemaId: 'provider-body-test-only',
      bodyDigest: '9'.repeat(64),
      bodyClassification: 'REDACTED_INTERNAL_ONLY',
      policyRevision: 'policy-test-only',
      controlRevision: 'control-test-only',
      maximumCostMicrounits: 0,
      requestedCostMicrounits: 0,
      retentionPosture: 'COMPATIBLE',
      credentialReference: 'TEST_ONLY_INVALID_CREDENTIAL_REFERENCE_CODEX_DO_NOT_USE',
      credentialClassification: 'TEST_ONLY_SYNTHETIC_INVALID',
      callerProvidedAuthorizationHeader: false,
      signedPolicyDecision: 'ALLOW',
      policySignatureVerified: true,
      policyValidFromMs: nowMs - 1,
      policyExpiresAtMs: nowMs + 60_000,
      immutableAuditAvailable: true,
      ...overrides,
    };
  }

  it('returns neither route access nor credential material', () => {
    assert.equal(a3.SHADOW_EGRESS_ROUTES.every((row) => row.enabled === false), true);
    const decision = a3.evaluateShadowEgressAdmission(request(), nowMs);
    assert.equal(decision.allowed, false);
    assert.equal(decision.credentialMaterialReturned, false);
    assert.equal(decision.egressReceiptId, null);
    assert.match(decision.reasonCodes.join(','), /EGRESS_ROUTE_NOT_CONFIGURED/);
    assert.match(decision.reasonCodes.join(','), /CREDENTIAL_BROKER_AND_EGRESS_PROXY_I00_BINDING_PENDING/);
  });

  it('denies caller auth headers, destination drift, real-looking references and stale policy', () => {
    const decision = a3.evaluateShadowEgressAdmission(request({
      exactHost: '127.0.0.1',
      callerProvidedAuthorizationHeader: true,
      credentialReference: 'not-a-test-reference',
      policyExpiresAtMs: nowMs,
    }), nowMs);
    const reasons = decision.reasonCodes.join(',');
    assert.match(reasons, /EGRESS_DESTINATION_NOT_EXACTLY_REGISTERED/);
    assert.match(reasons, /CALLER_AUTHORIZATION_HEADER_FORBIDDEN/);
    assert.match(reasons, /CREDENTIAL_REFERENCE_NOT_EXACTLY_REGISTERED/);
    assert.match(reasons, /EGRESS_POLICY_STALE_OR_INVALID/);
  });

  it('rejects truthy non-boolean egress evidence flags', () => {
    const decision = a3.evaluateShadowEgressAdmission(request({
      callerProvidedAuthorizationHeader: 0,
      policySignatureVerified: 'YES',
      immutableAuditAvailable: { truthy: true },
    }), nowMs);
    const reasons = decision.reasonCodes.join(',');
    assert.match(reasons, /CALLER_AUTHORIZATION_HEADER_FLAG_INVALID/);
    assert.match(reasons, /CALLER_AUTHORIZATION_HEADER_FORBIDDEN/);
    assert.match(reasons, /EGRESS_POLICY_SIGNATURE_UNVERIFIED/);
    assert.match(reasons, /EGRESS_IMMUTABLE_AUDIT_UNAVAILABLE/);
  });

  it('rejects null, accessor-bearing and hostile proxy envelopes without throwing', () => {
    const accessorEnvelope = request();
    Object.defineProperty(accessorEnvelope, 'routeId', {
      enumerable: true,
      get() {
        throw new Error('TEST_ONLY_EGRESS_ACCESSOR_MUST_NOT_RUN');
      },
    });
    const hostileProxy = new Proxy(request(), {
      ownKeys() {
        throw new Error('TEST_ONLY_EGRESS_PROXY_MUST_FAIL_CLOSED');
      },
    });

    for (const envelope of [null, accessorEnvelope, hostileProxy]) {
      assert.doesNotThrow(() => a3.evaluateShadowEgressAdmission(envelope, nowMs));
      const decision = a3.evaluateShadowEgressAdmission(envelope, nowMs);
      assert.equal(decision.allowed, false);
      assert.match(decision.reasonCodes.join(','), /EGRESS_ADMISSION_ENVELOPE_REJECTED/);
    }
  });
});

describe('A3 Claude pre-tool hook adapter', () => {
  function hookInput(overrides = {}) {
    return {
      session_id: 'session-test-only',
      transcript_path: '/tmp/transcript-test-only.jsonl',
      cwd: '/tmp/isolated-worktree-test-only',
      permission_mode: 'dontAsk',
      hook_event_name: 'PreToolUse',
      tool_name: 'getSupervisorSnapshot',
      tool_input: standardInput(),
      tool_use_id: 'tool-use-test-only',
      ...overrides,
    };
  }

  it('ships a disabled fail-closed settings template and denies missing bindings', () => {
    assert.equal(a3.CLAUDE_FAIL_CLOSED_SETTINGS_TEMPLATE.activationAllowed, false);
    assert.equal(a3.CLAUDE_FAIL_CLOSED_SETTINGS_TEMPLATE.permissions.deny.includes('Bash'), true);
    assert.equal(a3.CLAUDE_FAIL_CLOSED_SETTINGS_TEMPLATE.sandbox.failIfUnavailable, true);
    const result = a3.adaptClaudePreToolUseHook(hookInput(), null);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.hookSpecificOutput.permissionDecision, 'deny');
  });

  it('keeps even an exact admitted subject binding inert until the I00 verifier exists', () => {
    const registry = a3.A3_TOOL_REGISTRY.map((row) => row.toolId === 'getSupervisorSnapshot' ? { ...row, enabled: true } : row);
    const request = admissionRequest();
    const admission = a3.evaluateToolCallAdmission(request, policyFor(request, registry), nowMs, registry);
    assert.equal(admission.allowed, true);
    const input = hookInput();
    const binding = {
      schema: 'AI_OPS_CLAUDE_TOOL_HOOK_BINDING_V1',
      toolUseId: input.tool_use_id,
      providerToolName: input.tool_name,
      providerToolInputDigest: a3.providerToolInputDigest(input.tool_name, input.tool_input),
      admissionInputDigest: admission.inputDigest,
      policyReceiptId: 'policy-receipt-test-only',
      sessionId: input.session_id,
      canonicalCwd: input.cwd,
      principalId: admission.principalId,
      runId: admission.runId,
      environmentId: admission.environmentId,
      admission,
    };
    const exactButUnconfigured = a3.adaptClaudePreToolUseHook(input, binding);
    assert.equal(exactButUnconfigured.stdout.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(exactButUnconfigured.stdout.hookSpecificOutput.permissionDecisionReason, /HOOK_BINDING_VERIFIER_NOT_CONFIGURED/);
    const bypass = a3.adaptClaudePreToolUseHook(hookInput({ permission_mode: 'bypassPermissions' }), binding);
    assert.equal(bypass.stdout.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(bypass.stdout.hookSpecificOutput.permissionDecisionReason, /BYPASS_PERMISSION_MODE_FORBIDDEN/);
    const changed = a3.adaptClaudePreToolUseHook(hookInput({ tool_input: { ...standardInput(), requestId: 'changed-test-only' } }), binding);
    assert.equal(changed.stdout.hookSpecificOutput.permissionDecision, 'deny');

    const substituted = a3.adaptClaudePreToolUseHook(hookInput({ tool_name: 'Write' }), {
      ...binding,
      providerToolName: 'Write',
      providerToolInputDigest: a3.providerToolInputDigest('Write', standardInput()),
    });
    assert.equal(substituted.stdout.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(substituted.stdout.hookSpecificOutput.permissionDecisionReason, /HOOK_TOOL_NOT_A3_REGISTERED|HOOK_ADMISSION_SUBJECT_MISMATCH/);

    const mainCwd = a3.adaptClaudePreToolUseHook(hookInput({ cwd: '/Users/cosmosgeek/Desktop/Main' }), {
      ...binding,
      canonicalCwd: '/Users/cosmosgeek/Desktop/Main',
    });
    assert.equal(mainCwd.stdout.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(mainCwd.stdout.hookSpecificOutput.permissionDecisionReason, /HOOK_CWD_NOT_CANONICAL_ISOLATED|HOOK_POLICY_RECEIPT_OR_SUBJECT_INVALID/);

    const crossSession = a3.adaptClaudePreToolUseHook(hookInput({ session_id: 'different-session-test-only' }), binding);
    assert.equal(crossSession.stdout.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(crossSession.stdout.hookSpecificOutput.permissionDecisionReason, /HOOK_ADMISSION_SUBJECT_MISMATCH/);

    const hostileReasonCodes = new Proxy([], {
      get(target, property, receiver) {
        if (property === 'length') throw new Error('hostile reason length');
        return Reflect.get(target, property, receiver);
      },
    });
    assert.doesNotThrow(() => a3.adaptClaudePreToolUseHook(input, {
      ...binding,
      admission: { ...admission, reasonCodes: hostileReasonCodes },
    }));
  });

  it('returns explicit deny JSON for malformed hook envelopes and admissions', () => {
    const accessorHook = hookInput();
    Object.defineProperty(accessorHook, 'tool_name', {
      enumerable: true,
      get() { throw new Error('hostile hook getter'); },
    });
    for (const [hook, binding] of [[null, null], [42, {}], [accessorHook, null], [hookInput(), { schema: 'AI_OPS_CLAUDE_TOOL_HOOK_BINDING_V1', admission: null }]]) {
      assert.doesNotThrow(() => a3.adaptClaudePreToolUseHook(hook, binding));
      const result = a3.adaptClaudePreToolUseHook(hook, binding);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.hookSpecificOutput.permissionDecision, 'deny');
    }
  });
});

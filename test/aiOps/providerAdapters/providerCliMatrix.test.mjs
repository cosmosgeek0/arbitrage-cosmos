import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadA3 } from './networkDeny.mjs';

const a3 = await loadA3();
const digest = 'a'.repeat(64);

function operationRequest(operation) {
  return Object.freeze({
    schema: 'AI_OPS_PROVIDER_OPERATION_REQUEST_V1',
    requestId: `request-${operation}`,
    operation,
    caseId: 'case-test-only',
    identityRole: 'RUNTIME_DIAGNOSTICIAN',
    providerId: 'provider-test-only',
    modelId: 'model-test-only',
    providerProtocolVersion: '1',
    adapterVersion: 'adapter-test-only',
    promptRevision: 'prompt-test-only',
    toolRegistryDigest: digest,
    policyBundleDigest: digest,
    redactionReceiptDigest: digest,
    cancellationTokenId: 'cancel-test-only',
    rateLimitReservationId: 'rate-limit-test-only',
    toolAllowlist: ['getSupervisorSnapshot'],
    backgroundMode: 'DISABLED',
    fallbackPolicy: 'NO_SILENT_FALLBACK',
    maximumTokens: 1000,
    maximumCostMicrounits: 0,
    evidenceDigest: digest,
    policyRevision: 'policy-test-only',
    requestedPermission: 'OBSERVE_EXPLAIN',
    workflowGeneration: 1,
    createdAtMs: 1_700_000_000_000,
    expiresAtMs: 1_700_000_060_000,
    deadlineAtMs: 1_700_000_030_000,
  });
}

function negotiationRequest(overrides = {}) {
  return {
    schema: 'AI_OPS_CAPABILITY_NEGOTIATION_REQUEST_V1',
    providerId: 'provider-test-only',
    modelId: 'model-test-only',
    identityRole: 'RUNTIME_DIAGNOSTICIAN',
    requestedProtocolVersion: '1',
    requestedAdapterVersion: 'adapter-test-only',
    requestedSchemaVersion: '1',
    requestedCapabilities: ['structured-output'],
    ...overrides,
  };
}

describe('A3 exact provider and identity model', () => {
  it('keeps the exact five configuration states and separate identities', () => {
    assert.deepEqual(a3.PROVIDER_CONFIGURATION_STATES, [
      'NOT_CONFIGURED',
      'SUBSCRIPTION_CODEX_WORKER',
      'SUBSCRIPTION_CLAUDE_CODE_WORKER',
      'API_CONFIGURED',
      'DIAGNOSTIC_PLANE_UNAVAILABLE',
    ]);
    assert.equal(a3.isExactProviderConfigurationState('UNCONFIGURED'), false);
    assert.equal(a3.isExactProviderConfigurationState('READY'), false);
    assert.deepEqual(a3.validateProviderAndIdentityMatrices(), []);
    assert.equal(a3.AI_IDENTITY_MATRIX.length, 4);
    assert.equal(a3.AI_IDENTITY_MATRIX.every((row) => row.configurationState === 'NOT_CONFIGURED'), true);
    assert.equal(a3.AI_IDENTITY_MATRIX.every((row) => row.activationAllowed === false), true);
    const advisor = a3.AI_IDENTITY_MATRIX.find((row) => row.role === 'RESEARCH_TRADE_CONTEXT_ADVISOR');
    assert.deepEqual(advisor.allowedCapabilities, []);
    assert.equal(advisor.maximumPermission, 'OBSERVE_EXPLAIN');
  });

  it('exposes all six typed operations but every shadow adapter fails closed', async () => {
    const adapter = a3.createShadowProviderAdapter({
      providerId: 'provider-test-only',
      configurationState: 'NOT_CONFIGURED',
    });
    for (const operation of a3.PROVIDER_OPERATION_IDS) {
      const result = await adapter[operation](operationRequest(operation));
      assert.equal(result.accepted, false);
      assert.equal(result.authorityGranted, false);
      assert.equal(result.providerRunId, null);
      assert.equal(result.usage, null);
      assert.equal(result.fallbackUsed, false);
      assert.equal(result.circuitState, 'OPEN_NOT_CONFIGURED');
      assert.equal(result.retentionReadback, 'UNKNOWN_BLOCKED');
      assert.match(result.reasonCodes.join(','), /PROVIDER_NOT_CONFIGURED/);
    }
    const mismatch = await adapter.health(operationRequest('status'));
    assert.equal(mismatch.accepted, false);
    assert.equal(mismatch.operation, 'health');
    assert.match(mismatch.reasonCodes.join(','), /PROVIDER_OPERATION_METHOD_MISMATCH/);
  });

  it('turns malformed external operation envelopes into inert results without invoking getters or leaking proxy throws', async () => {
    const adapter = a3.createShadowProviderAdapter({
      providerId: 'provider-test-only',
      configurationState: 'NOT_CONFIGURED',
    });
    let getterCalls = 0;
    const accessorEnvelope = { ...operationRequest('diagnose') };
    Object.defineProperty(accessorEnvelope, 'requestId', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('external getter must not execute');
      },
    });
    const accessorArray = [];
    Object.defineProperty(accessorArray, '0', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('external array getter must not execute');
      },
    });
    const nestedAccessorEnvelope = {
      ...operationRequest('diagnose'),
      toolAllowlist: accessorArray,
    };
    const throwingProxy = new Proxy({ ...operationRequest('diagnose') }, {
      ownKeys() {
        throw new Error('external ownKeys trap');
      },
    });
    const dataProxy = new Proxy({ ...operationRequest('diagnose') }, {
      get() {
        getterCalls += 1;
        throw new Error('external get trap must not execute');
      },
    });
    const revocable = Proxy.revocable({ ...operationRequest('diagnose') }, {});
    revocable.revoke();

    for (const envelope of [null, {}, accessorEnvelope, nestedAccessorEnvelope, throwingProxy, revocable.proxy]) {
      const result = await adapter.diagnose(envelope);
      assert.equal(result.accepted, false);
      assert.equal(result.authorityGranted, false);
      assert.equal(result.operation, 'diagnose');
      assert.equal(result.requestId, 'INVALID_EXTERNAL_ENVELOPE');
      assert.equal(result.providerRunId, null);
      assert.equal(result.responseProvenance, null);
      assert.equal(result.fallbackUsed, false);
      assert.match(result.reasonCodes.join(','), /PROVIDER_OPERATION_REQUEST_INVALID/);
      assert.match(result.reasonCodes.join(','), /SHADOW_PROVIDER_ACTIVATION_FORBIDDEN/);
    }
    const proxiedDataResult = await adapter.diagnose(dataProxy);
    assert.equal(proxiedDataResult.accepted, false);
    assert.equal(proxiedDataResult.requestId, 'request-diagnose');
    assert.equal(proxiedDataResult.reasonCodes.includes('PROVIDER_OPERATION_REQUEST_INVALID'), false);
    assert.equal(getterCalls, 0);

    const wrongSubject = await adapter.diagnose({
      ...operationRequest('diagnose'),
      providerId: 'other-provider-test-only',
    });
    assert.equal(wrongSubject.accepted, false);
    assert.equal(wrongSubject.requestId, 'request-diagnose');
    assert.match(wrongSubject.reasonCodes.join(','), /PROVIDER_ADAPTER_SUBJECT_MISMATCH/);
  });

  it('keeps capability negotiation inert and forbids silent billing switches', () => {
    const result = a3.negotiateShadowProviderCapabilities(negotiationRequest());
    assert.equal(result.negotiated, false);
    assert.deepEqual(result.capabilities, []);
    assert.equal(result.reasonCodes.includes('CAPABILITY_NEGOTIATION_REQUEST_INVALID'), false);

    const billing = a3.evaluateShadowProviderStateTransition('SUBSCRIPTION_CODEX_WORKER', 'API_CONFIGURED');
    assert.equal(billing.allowed, false);
    assert.match(billing.reasonCodes.join(','), /SILENT_BILLING_SWITCH_FORBIDDEN/);
    assert.equal(a3.evaluateShadowProviderStateTransition('API_CONFIGURED', 'NOT_CONFIGURED').allowed, true);
    assert.equal(a3.evaluateShadowProviderStateTransition('NOT_CONFIGURED', 'SUBSCRIPTION_CLAUDE_CODE_WORKER').allowed, false);
    assert.equal(a3.evaluateShadowProviderStateTransition('API_CONFIGURED', 'API_CONFIGURED').allowed, false);
    assert.throws(() => a3.evaluateShadowProviderStateTransition('GARBAGE', 'NOT_CONFIGURED'), /exact five-state vocabulary/);
    assert.throws(
      () => a3.createShadowProviderAdapter({ providerId: 'provider-test-only', configurationState: 'API_CONFIGURED' }),
      /fail-closed provider states/,
    );
  });

  it('fails malformed capability negotiation envelopes closed without invoking accessors or leaking proxy throws', () => {
    let getterCalls = 0;
    let overBoundOwnKeysCalls = 0;
    const accessorEnvelope = negotiationRequest();
    Object.defineProperty(accessorEnvelope, 'providerId', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('external getter must not execute');
      },
    });
    const accessorCapabilities = [];
    Object.defineProperty(accessorCapabilities, '0', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('external array getter must not execute');
      },
    });
    const throwingProxy = new Proxy(negotiationRequest(), {
      getOwnPropertyDescriptor() {
        throw new Error('external descriptor trap');
      },
    });
    const dataProxy = new Proxy(negotiationRequest(), {
      get() {
        getterCalls += 1;
        throw new Error('external get trap must not execute');
      },
    });
    const overBoundCapabilitiesTarget = [];
    overBoundCapabilitiesTarget.length = 65;
    const overBoundCapabilities = new Proxy(overBoundCapabilitiesTarget, {
      ownKeys() {
        overBoundOwnKeysCalls += 1;
        throw new Error('over-bound arrays must be rejected before key enumeration');
      },
    });
    const revocable = Proxy.revocable(negotiationRequest(), {});
    revocable.revoke();

    for (const envelope of [
      null,
      {},
      accessorEnvelope,
      negotiationRequest({ requestedCapabilities: accessorCapabilities }),
      negotiationRequest({ requestedCapabilities: ['duplicate', 'duplicate'] }),
      negotiationRequest({ requestedCapabilities: overBoundCapabilities }),
      { ...negotiationRequest(), unexpected: true },
      throwingProxy,
      revocable.proxy,
    ]) {
      const result = a3.negotiateShadowProviderCapabilities(envelope);
      assert.equal(result.negotiated, false);
      assert.equal(result.authorityGranted, false);
      assert.equal(result.protocolVersion, null);
      assert.equal(result.adapterVersion, null);
      assert.equal(result.schemaVersion, null);
      assert.deepEqual(result.capabilities, []);
      assert.match(result.reasonCodes.join(','), /CAPABILITY_NEGOTIATION_REQUEST_INVALID/);
      assert.match(result.reasonCodes.join(','), /SHADOW_NEGOTIATION_CANNOT_ACTIVATE_PROVIDER/);
    }
    const proxiedDataResult = a3.negotiateShadowProviderCapabilities(dataProxy);
    assert.equal(proxiedDataResult.negotiated, false);
    assert.equal(proxiedDataResult.reasonCodes.includes('CAPABILITY_NEGOTIATION_REQUEST_INVALID'), false);
    assert.equal(getterCalls, 0);
    assert.equal(overBoundOwnKeysCalls, 0);
  });
});

describe('A3 declarative CLI templates', () => {
  it('ships six NOT_CONFIGURED templates without login, activation or bypass flags', () => {
    assert.deepEqual(a3.validateSubscriptionCliTemplates(), []);
    assert.equal(a3.SUBSCRIPTION_CLI_TEMPLATES.length, 6);
    assert.equal(a3.SUBSCRIPTION_CLI_TEMPLATES.every((row) => row.configurationState === 'NOT_CONFIGURED'), true);
    assert.equal(a3.SUBSCRIPTION_CLI_TEMPLATES.every((row) => row.activationAllowed === false), true);
    assert.equal(a3.SUBSCRIPTION_CLI_TEMPLATES.some((row) => row.identityRole === 'RESEARCH_TRADE_CONTEXT_ADVISOR'), false);
    const flattened = a3.SUBSCRIPTION_CLI_TEMPLATES.flatMap((row) => row.argv);
    for (const forbidden of ['login', '--yolo', '--full-auto', '--dangerously-skip-permissions', 'bypassPermissions', 'danger-full-access']) {
      assert.equal(flattened.includes(forbidden), false, forbidden);
    }
  });

  it('uses current non-interactive, bounded, machine-readable patterns', () => {
    const codex = a3.SUBSCRIPTION_CLI_TEMPLATES.find((row) => row.provider === 'CODEX_CLI' && row.identityRole === 'ENGINEERING_REPAIR_WORKER');
    assert.deepEqual(codex.argv.slice(0, 5), ['--ask-for-approval', 'never', 'exec', '-C', '<ISOLATED_WORKTREE_PATH>']);
    for (const required of ['--ephemeral', '--ignore-user-config', '--model', '<I00_PINNED_MODEL_ID>', '--sandbox', '--ask-for-approval', '--json', '--output-schema']) {
      assert.equal(codex.argv.includes(required), true, required);
    }
    assert.equal(codex.argv.includes('sandbox_workspace_write.network_access=false'), true);

    const claude = a3.SUBSCRIPTION_CLI_TEMPLATES.find((row) => row.provider === 'CLAUDE_CODE_CLI' && row.identityRole === 'INDEPENDENT_VERIFIER');
    for (const required of ['-p', '--model', '<I00_PINNED_MODEL_ID>', '--output-format', '--json-schema', '--no-session-persistence', '--max-turns', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--setting-sources', '--settings']) {
      assert.equal(claude.argv.includes(required), true, required);
    }
    const toolsIndex = claude.argv.indexOf('--tools');
    const allowedToolsIndex = claude.argv.indexOf('--allowedTools');
    assert.equal(claude.argv[toolsIndex + 1], '');
    assert.equal(claude.argv[allowedToolsIndex + 1], '');
    const disallowedIndex = claude.argv.indexOf('--disallowedTools');
    const strictMcpIndex = claude.argv.indexOf('--strict-mcp-config');
    assert.deepEqual(claude.argv.slice(disallowedIndex + 1, strictMcpIndex), [
      'Bash', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Agent', 'Task',
      'TaskCreate', 'TaskUpdate', 'EnterPlanMode', 'ExitPlanMode',
    ]);
    assert.equal(claude.environmentDenylist.includes('ANTHROPIC_API_KEY'), true);
    assert.equal(claude.environmentDenylist.includes('OPENAI_API_KEY'), true);
    assert.equal(claude.argv.slice(disallowedIndex + 1, strictMcpIndex).includes('Bash'), true);
    assert.equal(claude.preToolEnforcement, 'OUTER_GATEWAY_AND_CLAUDE_PRE_TOOL_HOOK_REQUIRED');
  });

  it('freezes every exported fail-closed provider and identity row', () => {
    for (const row of [...a3.PROVIDER_CAPABILITY_RETENTION_MATRIX, ...a3.AI_IDENTITY_MATRIX]) {
      assert.equal(Object.isFrozen(row), true);
    }
    assert.throws(() => {
      a3.PROVIDER_CAPABILITY_RETENTION_MATRIX[0].activationAllowed = true;
    }, TypeError);
    assert.equal(a3.PROVIDER_CAPABILITY_RETENTION_MATRIX.every((row) => row.unattendedRuntimeEligible === false), true);
    assert.equal(a3.PROVIDER_CAPABILITY_RETENTION_MATRIX.every((row) => row.retentionZdrPosture === 'UNKNOWN_BLOCKED'), true);
  });
});

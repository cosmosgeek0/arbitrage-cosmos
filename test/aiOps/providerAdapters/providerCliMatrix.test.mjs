import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSyntheticProviderExecutionPort } from '../../../fixtures/aiOps/providerAdapters/syntheticPorts.mjs';
import { loadA3 } from './networkDeny.mjs';

const a3 = await loadA3();
const digest = 'a'.repeat(64);

function operationRequest(operation, overrides = {}) {
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
    ...overrides,
  });
}

function syntheticInvocation(route, overrides = {}) {
  return {
    schema: 'AI_OPS_SYNTHETIC_PROVIDER_INVOCATION_V1',
    routeId: route.routeId,
    accessClass: route.accessClass,
    credentialClass: route.credentialClass,
    configurationState: route.requiredConfigurationState,
    request: operationRequest('diagnose', { providerId: route.providerId }),
    ...overrides,
  };
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

describe('A3X synthetic provider capability classes', () => {
  it('defines four frozen fake routes on an orthogonal two-class access axis', () => {
    assert.deepEqual(a3.PROVIDER_ACCESS_CLASSES, ['PAID_API', 'OWNER_SUBSCRIPTION_CLI']);
    assert.deepEqual(a3.PROVIDER_CREDENTIAL_CLASSES, [
      'API_WORKLOAD_IDENTITY_REFERENCE',
      'OWNER_SUBSCRIPTION_SESSION_REFERENCE',
    ]);
    assert.deepEqual(a3.validateSyntheticProviderRoutes(), []);
    assert.deepEqual(a3.A3X_SYNTHETIC_PROVIDER_ROUTES.map((row) => [
      row.routeId,
      row.providerFamily,
      row.accessClass,
      row.credentialClass,
      row.requiredConfigurationState,
      row.cliTemplateProvider,
    ]), [
      ['OPENAI_API_FAKE', 'OPENAI', 'PAID_API', 'API_WORKLOAD_IDENTITY_REFERENCE', 'API_CONFIGURED', null],
      ['ANTHROPIC_API_FAKE', 'ANTHROPIC', 'PAID_API', 'API_WORKLOAD_IDENTITY_REFERENCE', 'API_CONFIGURED', null],
      ['CODEX_SUBSCRIPTION_CLI_FAKE', 'OPENAI', 'OWNER_SUBSCRIPTION_CLI', 'OWNER_SUBSCRIPTION_SESSION_REFERENCE', 'SUBSCRIPTION_CODEX_WORKER', 'CODEX_CLI'],
      ['CLAUDE_CODE_SUBSCRIPTION_CLI_FAKE', 'ANTHROPIC', 'OWNER_SUBSCRIPTION_CLI', 'OWNER_SUBSCRIPTION_SESSION_REFERENCE', 'SUBSCRIPTION_CLAUDE_CODE_WORKER', 'CLAUDE_CODE_CLI'],
    ]);
    assert.equal(a3.A3X_SYNTHETIC_PROVIDER_ROUTES.every((row) => row.syntheticOnly === true), true);
    assert.equal(a3.A3X_SYNTHETIC_PROVIDER_ROUTES.every((row) => row.activationAllowed === false), true);
    assert.equal(a3.A3X_SYNTHETIC_PROVIDER_ROUTES.every((row) => row.fallbackPolicy === 'NO_SILENT_FALLBACK'), true);
    assert.equal(a3.A3X_SYNTHETIC_PROVIDER_ROUTES.every(Object.isFrozen), true);
  });

  it('simulates OpenAI API, Anthropic API, Codex CLI and Claude Code CLI through injected zero-egress ports', async () => {
    const port = createSyntheticProviderExecutionPort();
    for (const route of a3.A3X_SYNTHETIC_PROVIDER_ROUTES) {
      const adapter = a3.createSyntheticProviderAdapter(route.routeId, port);
      const result = await adapter.invoke(syntheticInvocation(route));
      assert.equal(result.simulated, true, route.routeId);
      assert.equal(result.authorityGranted, false);
      assert.equal(result.syntheticOnly, true);
      assert.equal(result.providerActivationAllowed, false);
      assert.equal(result.requestedAccessClass, route.accessClass);
      assert.equal(result.actualAccessClass, route.accessClass);
      assert.equal(result.credentialClass, route.credentialClass);
      assert.equal(result.configurationState, route.requiredConfigurationState);
      assert.equal(result.fallbackUsed, false);
      assert.equal(result.networkAttempted, false);
      assert.equal(result.processSpawned, false);
      assert.equal(result.credentialMaterialObserved, false);
      assert.equal(result.usage.costMicrounits, 0);
      assert.equal(result.reasonCodes.includes('SYNTHETIC_FIXTURE_ONLY'), true);
      if (route.accessClass === 'OWNER_SUBSCRIPTION_CLI') {
        assert.equal(typeof result.cliTemplateId, 'string');
        assert.equal(result.cliTemplateProvider, route.cliTemplateProvider);
        assert.equal(result.cliTemplateConfigurationState, 'NOT_CONFIGURED');
        assert.equal(result.cliTemplateActivationAllowed, false);
      } else {
        assert.equal(result.cliTemplateId, null);
        assert.equal(result.cliTemplateProvider, null);
        assert.equal(result.cliTemplateConfigurationState, null);
        assert.equal(result.cliTemplateActivationAllowed, null);
      }
    }
    const snapshot = port.snapshot();
    assert.equal(snapshot.totalInvocations, 4);
    assert.deepEqual(snapshot.byRoute, {
      ANTHROPIC_API_FAKE: 1,
      CLAUDE_CODE_SUBSCRIPTION_CLI_FAKE: 1,
      CODEX_SUBSCRIPTION_CLI_FAKE: 1,
      OPENAI_API_FAKE: 1,
    });
  });

  it('resolves each supported subscription role through the canonical frozen NOT_CONFIGURED CLI templates', async () => {
    const port = createSyntheticProviderExecutionPort();
    const subscriptionRoutes = a3.A3X_SYNTHETIC_PROVIDER_ROUTES.filter((row) => row.accessClass === 'OWNER_SUBSCRIPTION_CLI');
    const roles = ['RUNTIME_DIAGNOSTICIAN', 'ENGINEERING_REPAIR_WORKER', 'INDEPENDENT_VERIFIER'];
    for (const route of subscriptionRoutes) {
      const adapter = a3.createSyntheticProviderAdapter(route.routeId, port);
      for (const identityRole of roles) {
        const result = await adapter.invoke(syntheticInvocation(route, {
          request: operationRequest('diagnose', { providerId: route.providerId, identityRole }),
        }));
        const template = a3.SUBSCRIPTION_CLI_TEMPLATES.find((candidate) => (
          candidate.provider === route.cliTemplateProvider && candidate.identityRole === identityRole
        ));
        assert.equal(result.simulated, true);
        assert.equal(result.cliTemplateId, template.templateId);
        assert.equal(result.cliTemplateProvider, template.provider);
        assert.equal(result.cliTemplateConfigurationState, 'NOT_CONFIGURED');
        assert.equal(result.cliTemplateActivationAllowed, false);
        assert.equal(Object.isFrozen(template), true);
      }
    }
    assert.equal(port.snapshot().totalInvocations, 6);
  });

  it('proves paid API and owner subscription CLI are never interchangeable and never fall back', async () => {
    const port = createSyntheticProviderExecutionPort();
    const openAiApiRoute = a3.A3X_SYNTHETIC_PROVIDER_ROUTES.find((row) => row.routeId === 'OPENAI_API_FAKE');
    const codexRoute = a3.A3X_SYNTHETIC_PROVIDER_ROUTES.find((row) => row.routeId === 'CODEX_SUBSCRIPTION_CLI_FAKE');
    const claudeRoute = a3.A3X_SYNTHETIC_PROVIDER_ROUTES.find((row) => row.routeId === 'CLAUDE_CODE_SUBSCRIPTION_CLI_FAKE');
    const apiAdapter = a3.createOpenAiApiFakeAdapter(port);
    const codexAdapter = a3.createCodexSubscriptionWorkerFakeAdapter(port);
    const claudeAdapter = a3.createClaudeSubscriptionWorkerFakeAdapter(port);

    const subscriptionAsApi = await codexAdapter.invoke(syntheticInvocation(codexRoute, {
      accessClass: 'PAID_API',
      credentialClass: 'API_WORKLOAD_IDENTITY_REFERENCE',
      configurationState: 'API_CONFIGURED',
    }));
    assert.equal(subscriptionAsApi.simulated, false);
    assert.equal(subscriptionAsApi.fallbackUsed, false);
    assert.match(subscriptionAsApi.reasonCodes.join(','), /PROVIDER_ACCESS_CLASS_MISMATCH/);
    assert.match(subscriptionAsApi.reasonCodes.join(','), /PROVIDER_CONFIGURATION_STATE_MISMATCH/);
    assert.match(subscriptionAsApi.reasonCodes.join(','), /PROVIDER_FALLBACK_FORBIDDEN/);

    const apiAsSubscription = await apiAdapter.invoke(syntheticInvocation(openAiApiRoute, {
      accessClass: 'OWNER_SUBSCRIPTION_CLI',
      credentialClass: 'OWNER_SUBSCRIPTION_SESSION_REFERENCE',
      configurationState: 'SUBSCRIPTION_CODEX_WORKER',
    }));
    assert.equal(apiAsSubscription.simulated, false);
    assert.equal(apiAsSubscription.fallbackUsed, false);
    assert.match(apiAsSubscription.reasonCodes.join(','), /PROVIDER_ACCESS_CLASS_MISMATCH/);

    const ambientApiWouldOverrideClaudeSubscription = await claudeAdapter.invoke(syntheticInvocation(claudeRoute, {
      credentialClass: 'API_WORKLOAD_IDENTITY_REFERENCE',
    }));
    assert.equal(ambientApiWouldOverrideClaudeSubscription.simulated, false);
    assert.equal(ambientApiWouldOverrideClaudeSubscription.fallbackUsed, false);
    assert.match(ambientApiWouldOverrideClaudeSubscription.reasonCodes.join(','), /PROVIDER_CREDENTIAL_CLASS_MISMATCH/);

    assert.deepEqual(port.snapshot(), { totalInvocations: 0, byRoute: {} });
  });

  it('rejects route/provider substitution and hostile invocation envelopes before touching a port', async () => {
    const port = createSyntheticProviderExecutionPort();
    const route = a3.A3X_SYNTHETIC_PROVIDER_ROUTES.find((row) => row.routeId === 'ANTHROPIC_API_FAKE');
    const adapter = a3.createAnthropicApiFakeAdapter(port);

    const wrongProvider = await adapter.invoke(syntheticInvocation(route, {
      request: operationRequest('diagnose', { providerId: 'openai-api-fake' }),
    }));
    assert.equal(wrongProvider.simulated, false);
    assert.match(wrongProvider.reasonCodes.join(','), /PROVIDER_ROUTE_SUBJECT_MISMATCH/);

    let getterCalls = 0;
    const accessor = syntheticInvocation(route);
    Object.defineProperty(accessor, 'accessClass', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('must not execute');
      },
    });
    const hostile = await adapter.invoke(accessor);
    assert.equal(hostile.simulated, false);
    assert.match(hostile.reasonCodes.join(','), /SYNTHETIC_PROVIDER_INVOCATION_INVALID/);
    assert.equal(getterCalls, 0);
    assert.deepEqual(port.snapshot(), { totalInvocations: 0, byRoute: {} });
  });

  it('rejects forbidden identities and positive cost budgets before invocation', async () => {
    const port = createSyntheticProviderExecutionPort();
    const apiRoute = a3.A3X_SYNTHETIC_PROVIDER_ROUTES.find((row) => row.routeId === 'OPENAI_API_FAKE');
    const cliRoute = a3.A3X_SYNTHETIC_PROVIDER_ROUTES.find((row) => row.routeId === 'CODEX_SUBSCRIPTION_CLI_FAKE');
    const apiAdapter = a3.createOpenAiApiFakeAdapter(port);
    const cliAdapter = a3.createCodexSubscriptionWorkerFakeAdapter(port);

    const positiveCost = await apiAdapter.invoke(syntheticInvocation(apiRoute, {
      request: operationRequest('diagnose', { providerId: apiRoute.providerId, maximumCostMicrounits: 1 }),
    }));
    assert.equal(positiveCost.simulated, false);
    assert.match(positiveCost.reasonCodes.join(','), /SYNTHETIC_PROVIDER_COST_BUDGET_FORBIDDEN/);

    for (const [adapter, route] of [[apiAdapter, apiRoute], [cliAdapter, cliRoute]]) {
      const advisor = await adapter.invoke(syntheticInvocation(route, {
        request: operationRequest('diagnose', {
          providerId: route.providerId,
          identityRole: 'RESEARCH_TRADE_CONTEXT_ADVISOR',
        }),
      }));
      assert.equal(advisor.simulated, false);
      assert.match(advisor.reasonCodes.join(','), /SYNTHETIC_PROVIDER_IDENTITY_ROUTE_FORBIDDEN/);
      assert.equal(advisor.fallbackUsed, false);
    }
    assert.deepEqual(port.snapshot(), { totalInvocations: 0, byRoute: {} });
  });

  it('rejects stale cross-route provider output instead of re-stamping it onto another capability class', async () => {
    const route = a3.A3X_SYNTHETIC_PROVIDER_ROUTES.find((row) => row.routeId === 'OPENAI_API_FAKE');
    const port = createSyntheticProviderExecutionPort({
      bindingOverridesByRoute: {
        OPENAI_API_FAKE: {
          routeId: 'CLAUDE_CODE_SUBSCRIPTION_CLI_FAKE',
          accessClass: 'OWNER_SUBSCRIPTION_CLI',
          credentialClass: 'OWNER_SUBSCRIPTION_SESSION_REFERENCE',
        },
      },
    });
    const result = await a3.createOpenAiApiFakeAdapter(port).invoke(syntheticInvocation(route));
    assert.equal(result.simulated, false);
    assert.equal(result.fallbackUsed, false);
    assert.match(result.reasonCodes.join(','), /SYNTHETIC_PROVIDER_PORT_OUTPUT_INVALID/);
    assert.equal(port.snapshot().totalInvocations, 1);
  });
});

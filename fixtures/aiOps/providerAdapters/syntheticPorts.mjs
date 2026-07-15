const freeze = (value) => Object.freeze(value);

export function createSyntheticCallbackDedupPort(options = {}) {
  const replay = new Map();
  const providerEvents = new Map();
  const internalRuns = new Map();
  const callbackIds = new Map();
  const callbackJobIds = new Map();
  const callbackAttemptIds = new Map();
  const jobIds = new Map();
  const attemptIds = new Map();
  let callbackReservations = 0;
  let jobReservations = 0;
  let deliveryAudits = 0;
  let sequence = 0;

  const unavailable = () => freeze({ status: 'UNAVAILABLE', receiptId: null, deliveryAuditReceiptId: null });
  const auditReceipt = () => {
    deliveryAudits += 1;
    sequence += 1;
    return `delivery-audit-test-only-${sequence}`;
  };

  const conflict = (receiptId) => freeze({
    status: 'CONFLICT',
    receiptId: receiptId ?? null,
    deliveryAuditReceiptId: auditReceipt(),
  });

  const duplicate = (receiptId) => freeze({
    status: 'DUPLICATE',
    receiptId,
    deliveryAuditReceiptId: auditReceipt(),
  });

  const reserveAtomic = ({ replayKey, contentDigest, semanticEntries, receiptPrefix }) => {
    if (options.throwError === true) throw new Error('TEST_ONLY_SYNTHETIC_STORE_FAILURE');
    if (options.invalidResult !== undefined) return options.invalidResult;
    if (options.unavailable === true) return unavailable();

    const replayExisting = replay.get(replayKey);
    if (replayExisting !== undefined) {
      if (replayExisting.digest !== contentDigest) return conflict(replayExisting.receiptId);
      return duplicate(replayExisting.receiptId);
    }

    const existing = semanticEntries.map(({ store, key }) => store.get(key));
    const present = existing.filter((row) => row !== undefined);
    if (present.length > 0) {
      const first = present[0];
      const exactDuplicate = present.length === semanticEntries.length
        && present.every((row) => row.digest === contentDigest && row.receiptId === first.receiptId);
      if (!exactDuplicate) return conflict(first.receiptId);
      replay.set(replayKey, { digest: contentDigest, receiptId: first.receiptId });
      return duplicate(first.receiptId);
    }

    sequence += 1;
    const receiptId = `${receiptPrefix}-test-only-${sequence}`;
    const row = { digest: contentDigest, receiptId };
    replay.set(replayKey, row);
    for (const entry of semanticEntries) entry.store.set(entry.key, row);
    return freeze({ status: 'RESERVED', receiptId, deliveryAuditReceiptId: auditReceipt() });
  };

  return freeze({
    schema: 'AI_OPS_CALLBACK_DEDUP_PORT_V1',
    reserveAuthenticatedCallback(input) {
      const result = reserveAtomic({
        replayKey: input.replayKey,
        contentDigest: input.contentDigest,
        semanticEntries: [
          { store: providerEvents, key: input.providerEventId },
          { store: internalRuns, key: input.internalRunId },
          { store: callbackIds, key: input.callbackId },
          { store: callbackJobIds, key: input.jobId },
          { store: callbackAttemptIds, key: input.attemptId },
        ],
        receiptPrefix: 'callback',
      });
      if (result.status === 'RESERVED') callbackReservations += 1;
      return Promise.resolve(result);
    },
    reserveAuthenticatedJob(input) {
      const result = reserveAtomic({
        replayKey: input.replayKey,
        contentDigest: input.contentDigest,
        semanticEntries: [
          { store: jobIds, key: input.jobId },
          { store: attemptIds, key: input.attemptId },
        ],
        receiptPrefix: 'job',
      });
      if (result.status === 'RESERVED') jobReservations += 1;
      return Promise.resolve(result);
    },
    snapshot() {
      return freeze({
        replayReservations: replay.size,
        callbackReservations,
        jobReservations,
        deliveryAudits,
      });
    },
  });
}

export const SYNTHETIC_TEST_KEY = freeze({
  keyId: 'test-only-invalid-callback-key',
  classification: 'TEST_ONLY_SYNTHETIC_INVALID',
  keyBytes: new TextEncoder().encode('TEST_ONLY_INVALID_KEY_MATERIAL_DO_NOT_USE'),
});

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

const PROVIDER_RESULT_DIGEST_CHARACTERS = freeze({
  OPENAI_API_FAKE: '1',
  ANTHROPIC_API_FAKE: '2',
  CODEX_SUBSCRIPTION_CLI_FAKE: '3',
  CLAUDE_CODE_SUBSCRIPTION_CLI_FAKE: '4',
});

export function createSyntheticProviderExecutionPort(options = {}) {
  const counts = new Map();

  return freeze({
    schema: 'AI_OPS_SYNTHETIC_PROVIDER_PORT_V1',
    invoke(input) {
      const routeId = input.route.routeId;
      counts.set(routeId, (counts.get(routeId) ?? 0) + 1);
      if (options.failRouteId === routeId) throw new Error('TEST_ONLY_SYNTHETIC_PROVIDER_FAILURE');
      if (options.invalidOutputRouteId === routeId) return Promise.resolve({ schema: 'INVALID' });
      const status = options.blockRouteId === routeId ? 'BLOCKED' : 'COMPLETED';
      const digestCharacter = PROVIDER_RESULT_DIGEST_CHARACTERS[routeId] ?? '0';
      const bindingOverrides = options.bindingOverridesByRoute?.[routeId] ?? {};
      return Promise.resolve(freeze({
        schema: 'AI_OPS_SYNTHETIC_PROVIDER_PORT_OUTPUT_V1',
        routeId,
        accessClass: input.route.accessClass,
        credentialClass: input.route.credentialClass,
        requestDigest: input.requestDigest,
        cliTemplateId: input.cliTemplate?.templateId ?? null,
        cliTemplateProvider: input.cliTemplate?.provider ?? null,
        status,
        providerRunId: status === 'COMPLETED'
          ? `synthetic-run-${routeId.toLowerCase()}-${input.request.operation}`
          : null,
        resultDigest: status === 'COMPLETED' ? digestCharacter.repeat(64) : null,
        usage: status === 'COMPLETED'
          ? freeze({ inputTokens: 17, outputTokens: 11, costMicrounits: 0 })
          : null,
        networkAttempted: false,
        processSpawned: false,
        credentialMaterialObserved: false,
        reasonCodes: freeze(status === 'COMPLETED' ? [] : ['SYNTHETIC_ROUTE_BLOCKED']),
        ...bindingOverrides,
      }));
    },
    snapshot() {
      return deepFreeze({
        totalInvocations: [...counts.values()].reduce((total, count) => total + count, 0),
        byRoute: Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right))),
      });
    },
  });
}

const DEFAULT_SYNTHETIC_WEB_RESULTS = deepFreeze([
  {
    citationId: 'citation-test-only-1',
    sourceRef: 'reserved-docs.test.invalid/provider-capability-boundary',
    title: 'Synthetic provider capability boundary',
  },
]);

function defaultSyntheticToolPayload(input) {
  if (input.toolId === 'runApprovedWebResearch') {
    return deepFreeze({
    kind: 'SYNTHETIC_SEARCH_RESULTS',
    queryId: 'query-test-only',
      domainPolicyId: input.input.domainPolicyId,
      query: input.input.query,
      results: DEFAULT_SYNTHETIC_WEB_RESULTS,
    });
  }
  if (input.toolId === 'searchRepositorySnapshot') {
    const root = input.input.scopeRoots[0];
    const path = root === 'server/src/aiOps/providerAdapters'
      ? `${root}/contracts.ts`
      : `${root}/synthetic-fixture.txt`;
    return deepFreeze({
      kind: 'SYNTHETIC_REPOSITORY_SEARCH_RESULTS',
      repositoryRevision: input.input.repositoryRevision,
      query: input.input.query,
      matches: [{
        line: 1,
        path,
        text: 'PROVIDER_ACCESS_CLASSES',
      }],
    });
  }
  if (input.toolId === 'inspectRepositoryPath') return deepFreeze({
    kind: 'SYNTHETIC_REPOSITORY_FILE',
    repositoryRevision: input.input.repositoryRevision,
    path: input.input.relativePath,
    contentDigest: '5'.repeat(64),
    excerpt: 'synthetic fixture content only',
  });
  return undefined;
}

export function createSyntheticToolExecutionPort(options = {}) {
  const counts = new Map();
  const payloads = deepFreeze({ ...(options.payloads ?? {}) });

  return freeze({
    schema: 'AI_OPS_SYNTHETIC_TOOL_PORT_V1',
    execute(input) {
      counts.set(input.toolId, (counts.get(input.toolId) ?? 0) + 1);
      if (options.failToolId === input.toolId) throw new Error('TEST_ONLY_SYNTHETIC_TOOL_FAILURE');
      if (options.invalidOutputToolId === input.toolId) return Promise.resolve({ schema: 'INVALID' });
      const payload = Object.hasOwn(payloads, input.toolId)
        ? payloads[input.toolId]
        : defaultSyntheticToolPayload(input);
      const bindingOverrides = options.bindingOverridesByTool?.[input.toolId] ?? {};
      return Promise.resolve(freeze({
        schema: 'AI_OPS_SYNTHETIC_TOOL_PORT_OUTPUT_V1',
        inputDigest: input.inputDigest,
        status: payload === undefined ? 'BLOCKED' : 'COMPLETED',
        payload: payload ?? null,
        evidenceRefs: freeze(payload === undefined ? [] : [`fixture-${input.toolId}`]),
        syntheticOnly: true,
        networkAttempted: false,
        filesystemReadAttempted: false,
        filesystemMutationAttempted: false,
        patchApplied: false,
        fallbackUsed: false,
        reasonCodes: freeze(payload === undefined ? ['SYNTHETIC_FIXTURE_MISSING'] : []),
        ...bindingOverrides,
      }));
    },
    snapshot() {
      return deepFreeze({
        totalInvocations: [...counts.values()].reduce((total, count) => total + count, 0),
        byTool: Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right))),
      });
    },
  });
}

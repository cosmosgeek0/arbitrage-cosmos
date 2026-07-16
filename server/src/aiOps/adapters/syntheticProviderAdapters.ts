import {
  isBoundedIdentifier,
  isExactProviderAccessClass,
  isExactProviderConfigurationState,
  isExactProviderCredentialClass,
  isLowercaseSha256,
  isPlainRecord,
  type ProviderAccessClass,
  type ProviderConfigurationState,
  type ProviderCredentialClass,
  type ProviderFamily,
  type ProviderOperationRequest,
} from './contracts.js';
import {
  providerOperationRequestDigest,
  snapshotProviderOperationRequest,
} from './providerGateway.js';
import {
  SUBSCRIPTION_CLI_TEMPLATES,
  type SubscriptionCliProvider,
  type SubscriptionCliTemplate,
} from './cliTemplates.js';
import { AI_IDENTITY_MATRIX } from './providerMatrix.js';

export const SYNTHETIC_PROVIDER_ROUTE_IDS = Object.freeze([
  'OPENAI_API_FAKE',
  'ANTHROPIC_API_FAKE',
  'CODEX_SUBSCRIPTION_CLI_FAKE',
  'CLAUDE_CODE_SUBSCRIPTION_CLI_FAKE',
] as const);

export type SyntheticProviderRouteId = (typeof SYNTHETIC_PROVIDER_ROUTE_IDS)[number];

export interface SyntheticProviderRouteDescriptor {
  readonly schema: 'AI_OPS_SYNTHETIC_PROVIDER_ROUTE_V1';
  readonly routeId: SyntheticProviderRouteId;
  readonly providerFamily: ProviderFamily;
  readonly providerId: string;
  readonly accessClass: ProviderAccessClass;
  readonly requiredConfigurationState: Extract<
    ProviderConfigurationState,
    'API_CONFIGURED' | 'SUBSCRIPTION_CODEX_WORKER' | 'SUBSCRIPTION_CLAUDE_CODE_WORKER'
  >;
  readonly credentialClass: ProviderCredentialClass;
  readonly executionLocus: 'EXTERNAL_PROVIDER_API_FAKE' | 'OWNER_OPERATED_CLI_FAKE';
  readonly cliTemplateProvider: SubscriptionCliProvider | null;
  readonly syntheticOnly: true;
  readonly activationAllowed: false;
  readonly fallbackPolicy: 'NO_SILENT_FALLBACK';
}

function route(
  routeId: SyntheticProviderRouteId,
  providerFamily: ProviderFamily,
  providerId: string,
  accessClass: ProviderAccessClass,
  requiredConfigurationState: SyntheticProviderRouteDescriptor['requiredConfigurationState'],
  credentialClass: ProviderCredentialClass,
  executionLocus: SyntheticProviderRouteDescriptor['executionLocus'],
  cliTemplateProvider: SubscriptionCliProvider | null,
): Readonly<SyntheticProviderRouteDescriptor> {
  return Object.freeze({
    schema: 'AI_OPS_SYNTHETIC_PROVIDER_ROUTE_V1',
    routeId,
    providerFamily,
    providerId,
    accessClass,
    requiredConfigurationState,
    credentialClass,
    executionLocus,
    cliTemplateProvider,
    syntheticOnly: true,
    activationAllowed: false,
    fallbackPolicy: 'NO_SILENT_FALLBACK',
  });
}

export const A3X_SYNTHETIC_PROVIDER_ROUTES: readonly Readonly<SyntheticProviderRouteDescriptor>[] = Object.freeze([
  route(
    'OPENAI_API_FAKE',
    'OPENAI',
    'openai-api-fake',
    'PAID_API',
    'API_CONFIGURED',
    'API_WORKLOAD_IDENTITY_REFERENCE',
    'EXTERNAL_PROVIDER_API_FAKE',
    null,
  ),
  route(
    'ANTHROPIC_API_FAKE',
    'ANTHROPIC',
    'anthropic-api-fake',
    'PAID_API',
    'API_CONFIGURED',
    'API_WORKLOAD_IDENTITY_REFERENCE',
    'EXTERNAL_PROVIDER_API_FAKE',
    null,
  ),
  route(
    'CODEX_SUBSCRIPTION_CLI_FAKE',
    'OPENAI',
    'codex-subscription-cli-fake',
    'OWNER_SUBSCRIPTION_CLI',
    'SUBSCRIPTION_CODEX_WORKER',
    'OWNER_SUBSCRIPTION_SESSION_REFERENCE',
    'OWNER_OPERATED_CLI_FAKE',
    'CODEX_CLI',
  ),
  route(
    'CLAUDE_CODE_SUBSCRIPTION_CLI_FAKE',
    'ANTHROPIC',
    'claude-code-subscription-cli-fake',
    'OWNER_SUBSCRIPTION_CLI',
    'SUBSCRIPTION_CLAUDE_CODE_WORKER',
    'OWNER_SUBSCRIPTION_SESSION_REFERENCE',
    'OWNER_OPERATED_CLI_FAKE',
    'CLAUDE_CODE_CLI',
  ),
]);

export interface SyntheticProviderInvocation {
  readonly schema: 'AI_OPS_SYNTHETIC_PROVIDER_INVOCATION_V1';
  readonly routeId: SyntheticProviderRouteId;
  readonly accessClass: ProviderAccessClass;
  readonly credentialClass: ProviderCredentialClass;
  readonly configurationState: SyntheticProviderRouteDescriptor['requiredConfigurationState'];
  readonly request: Readonly<ProviderOperationRequest>;
}

export interface SyntheticProviderPortInvocation {
  readonly schema: 'AI_OPS_SYNTHETIC_PROVIDER_PORT_INVOCATION_V1';
  readonly route: Readonly<SyntheticProviderRouteDescriptor>;
  readonly request: Readonly<ProviderOperationRequest>;
  readonly requestDigest: string;
  readonly cliTemplate: Readonly<SubscriptionCliTemplate> | null;
}

export interface SyntheticProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicrounits: 0;
}

export interface SyntheticProviderPortOutput {
  readonly schema: 'AI_OPS_SYNTHETIC_PROVIDER_PORT_OUTPUT_V1';
  readonly routeId: SyntheticProviderRouteId;
  readonly accessClass: ProviderAccessClass;
  readonly credentialClass: ProviderCredentialClass;
  readonly requestDigest: string;
  readonly cliTemplateId: string | null;
  readonly cliTemplateProvider: SubscriptionCliProvider | null;
  readonly status: 'COMPLETED' | 'BLOCKED' | 'FAILED';
  readonly providerRunId: string | null;
  readonly resultDigest: string | null;
  readonly usage: Readonly<SyntheticProviderUsage> | null;
  readonly networkAttempted: false;
  readonly processSpawned: false;
  readonly credentialMaterialObserved: false;
  readonly reasonCodes: readonly string[];
}

export interface SyntheticProviderPort {
  readonly schema: 'AI_OPS_SYNTHETIC_PROVIDER_PORT_V1';
  invoke(input: Readonly<SyntheticProviderPortInvocation>): Promise<Readonly<SyntheticProviderPortOutput>>;
}

export interface SyntheticProviderInvocationResult {
  readonly schema: 'AI_OPS_SYNTHETIC_PROVIDER_INVOCATION_RESULT_V1';
  readonly simulated: boolean;
  readonly authorityGranted: false;
  readonly syntheticOnly: true;
  readonly providerActivationAllowed: false;
  readonly routeId: SyntheticProviderRouteId;
  readonly providerFamily: ProviderFamily;
  readonly providerId: string;
  readonly requestedAccessClass: ProviderAccessClass | null;
  readonly actualAccessClass: ProviderAccessClass;
  readonly credentialClass: ProviderCredentialClass;
  readonly configurationState: SyntheticProviderRouteDescriptor['requiredConfigurationState'];
  readonly executionLocus: SyntheticProviderRouteDescriptor['executionLocus'];
  readonly cliTemplateId: string | null;
  readonly cliTemplateProvider: SubscriptionCliProvider | null;
  readonly cliTemplateConfigurationState: 'NOT_CONFIGURED' | null;
  readonly cliTemplateActivationAllowed: false | null;
  readonly requestId: string | null;
  readonly operation: string | null;
  readonly providerRunId: string | null;
  readonly resultDigest: string | null;
  readonly usage: Readonly<SyntheticProviderUsage> | null;
  readonly fallbackUsed: false;
  readonly networkAttempted: false;
  readonly processSpawned: false;
  readonly credentialMaterialObserved: false;
  readonly reasonCodes: readonly string[];
}

export interface SyntheticProviderCompatibilityDecision {
  readonly schema: 'AI_OPS_SYNTHETIC_PROVIDER_COMPATIBILITY_DECISION_V1';
  readonly compatible: boolean;
  readonly authorityGranted: false;
  readonly invocation: Readonly<SyntheticProviderInvocation> | null;
  readonly cliTemplate: Readonly<SubscriptionCliTemplate> | null;
  readonly reasonCodes: readonly string[];
}

export interface SyntheticProviderAdapter {
  readonly schema: 'AI_OPS_SYNTHETIC_PROVIDER_ADAPTER_V1';
  readonly route: Readonly<SyntheticProviderRouteDescriptor>;
  readonly syntheticOnly: true;
  readonly activationAllowed: false;
  invoke(input: Readonly<SyntheticProviderInvocation>): Promise<Readonly<SyntheticProviderInvocationResult>>;
}

const INVOCATION_KEYS = Object.freeze([
  'schema',
  'routeId',
  'accessClass',
  'credentialClass',
  'configurationState',
  'request',
]);
const PORT_OUTPUT_KEYS = Object.freeze([
  'schema',
  'routeId',
  'accessClass',
  'credentialClass',
  'requestDigest',
  'cliTemplateId',
  'cliTemplateProvider',
  'status',
  'providerRunId',
  'resultDigest',
  'usage',
  'networkAttempted',
  'processSpawned',
  'credentialMaterialObserved',
  'reasonCodes',
]);
const USAGE_KEYS = Object.freeze(['inputTokens', 'outputTokens', 'costMicrounits']);

function snapshotClosedRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | null {
  try {
    if (!isPlainRecord(value)) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return null;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function snapshotReasonCodes(value: unknown): readonly string[] | null {
  try {
    if (!Array.isArray(value) || value.length > 32) return null;
    const reasons: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')
        || !isBoundedIdentifier(descriptor.value)) return null;
      reasons.push(descriptor.value);
    }
    if (Reflect.ownKeys(value).length !== reasons.length + 1 || new Set(reasons).size !== reasons.length) return null;
    return Object.freeze(reasons);
  } catch {
    return null;
  }
}

function snapshotInvocation(value: unknown): Readonly<SyntheticProviderInvocation> | null {
  const record = snapshotClosedRecord(value, INVOCATION_KEYS);
  if (record === null || record.schema !== 'AI_OPS_SYNTHETIC_PROVIDER_INVOCATION_V1') return null;
  if (typeof record.routeId !== 'string' || !(SYNTHETIC_PROVIDER_ROUTE_IDS as readonly string[]).includes(record.routeId)) return null;
  if (!isExactProviderAccessClass(record.accessClass)
    || !isExactProviderCredentialClass(record.credentialClass)
    || !isExactProviderConfigurationState(record.configurationState)) return null;
  const request = snapshotProviderOperationRequest(record.request);
  if (request === null) return null;
  return Object.freeze({
    schema: 'AI_OPS_SYNTHETIC_PROVIDER_INVOCATION_V1',
    routeId: record.routeId as SyntheticProviderRouteId,
    accessClass: record.accessClass,
    credentialClass: record.credentialClass,
    configurationState: record.configurationState as SyntheticProviderInvocation['configurationState'],
    request,
  });
}

function expectedCredentialClass(accessClass: ProviderAccessClass): ProviderCredentialClass {
  return accessClass === 'PAID_API'
    ? 'API_WORKLOAD_IDENTITY_REFERENCE'
    : 'OWNER_SUBSCRIPTION_SESSION_REFERENCE';
}

function resolveSubscriptionCliTemplate(
  routeDescriptor: Readonly<SyntheticProviderRouteDescriptor>,
  invocation: Readonly<SyntheticProviderInvocation>,
): Readonly<SubscriptionCliTemplate> | null {
  if (routeDescriptor.cliTemplateProvider === null) return null;
  return SUBSCRIPTION_CLI_TEMPLATES.find((candidate) => (
    candidate.provider === routeDescriptor.cliTemplateProvider
    && candidate.identityRole === invocation.request.identityRole
  )) ?? null;
}

export function evaluateSyntheticProviderRouteCompatibility(
  routeDescriptor: Readonly<SyntheticProviderRouteDescriptor>,
  input: Readonly<SyntheticProviderInvocation>,
): Readonly<SyntheticProviderCompatibilityDecision> {
  const invocation = snapshotInvocation(input);
  let cliTemplate: Readonly<SubscriptionCliTemplate> | null = null;
  const reasons: string[] = [];
  if (invocation === null) reasons.push('SYNTHETIC_PROVIDER_INVOCATION_INVALID');
  else {
    if (invocation.routeId !== routeDescriptor.routeId) reasons.push('PROVIDER_ROUTE_MISMATCH');
    if (invocation.accessClass !== routeDescriptor.accessClass) reasons.push('PROVIDER_ACCESS_CLASS_MISMATCH');
    if (invocation.credentialClass !== routeDescriptor.credentialClass
      || invocation.credentialClass !== expectedCredentialClass(invocation.accessClass)) {
      reasons.push('PROVIDER_CREDENTIAL_CLASS_MISMATCH');
    }
    if (invocation.configurationState !== routeDescriptor.requiredConfigurationState) {
      reasons.push('PROVIDER_CONFIGURATION_STATE_MISMATCH');
    }
    if (invocation.request.providerId !== routeDescriptor.providerId) reasons.push('PROVIDER_ROUTE_SUBJECT_MISMATCH');
    if (invocation.request.fallbackPolicy !== 'NO_SILENT_FALLBACK') reasons.push('PROVIDER_FALLBACK_POLICY_MISMATCH');
    if (invocation.request.maximumCostMicrounits !== 0) reasons.push('SYNTHETIC_PROVIDER_COST_BUDGET_FORBIDDEN');
    const identity = AI_IDENTITY_MATRIX.find((candidate) => candidate.role === invocation.request.identityRole);
    if (identity === undefined || identity.allowedCapabilities.length === 0) reasons.push('SYNTHETIC_PROVIDER_IDENTITY_ROUTE_FORBIDDEN');
    cliTemplate = resolveSubscriptionCliTemplate(routeDescriptor, invocation);
    if (routeDescriptor.cliTemplateProvider !== null && cliTemplate === null) {
      reasons.push('SUBSCRIPTION_CLI_TEMPLATE_NOT_REGISTERED_FOR_ROLE');
    }
  }
  if (reasons.length > 0) reasons.push('PROVIDER_FALLBACK_FORBIDDEN');
  return Object.freeze({
    schema: 'AI_OPS_SYNTHETIC_PROVIDER_COMPATIBILITY_DECISION_V1',
    compatible: reasons.length === 0,
    authorityGranted: false,
    invocation,
    cliTemplate,
    reasonCodes: Object.freeze(reasons),
  });
}

function snapshotPortOutput(
  value: unknown,
  routeDescriptor: Readonly<SyntheticProviderRouteDescriptor>,
  requestDigest: string,
  cliTemplate: Readonly<SubscriptionCliTemplate> | null,
  maximumTokens: number,
): Readonly<SyntheticProviderPortOutput> | null {
  const record = snapshotClosedRecord(value, PORT_OUTPUT_KEYS);
  if (record === null || record.schema !== 'AI_OPS_SYNTHETIC_PROVIDER_PORT_OUTPUT_V1'
    || record.routeId !== routeDescriptor.routeId
    || record.accessClass !== routeDescriptor.accessClass
    || record.credentialClass !== routeDescriptor.credentialClass
    || record.requestDigest !== requestDigest
    || record.cliTemplateId !== (cliTemplate?.templateId ?? null)
    || record.cliTemplateProvider !== (cliTemplate?.provider ?? null)
    || !(['COMPLETED', 'BLOCKED', 'FAILED'] as const).includes(record.status as 'COMPLETED')
    || record.networkAttempted !== false
    || record.processSpawned !== false
    || record.credentialMaterialObserved !== false) return null;
  const reasonCodes = snapshotReasonCodes(record.reasonCodes);
  if (reasonCodes === null) return null;
  let usage: Readonly<SyntheticProviderUsage> | null = null;
  if (record.usage !== null) {
    const usageRecord = snapshotClosedRecord(record.usage, USAGE_KEYS);
    if (usageRecord === null
      || !Number.isSafeInteger(usageRecord.inputTokens) || (usageRecord.inputTokens as number) < 0
      || !Number.isSafeInteger(usageRecord.outputTokens) || (usageRecord.outputTokens as number) < 0
      || (usageRecord.inputTokens as number) > maximumTokens
      || (usageRecord.outputTokens as number) > maximumTokens - (usageRecord.inputTokens as number)
      || usageRecord.costMicrounits !== 0) return null;
    usage = Object.freeze({
      inputTokens: usageRecord.inputTokens as number,
      outputTokens: usageRecord.outputTokens as number,
      costMicrounits: 0,
    });
  }
  if (record.status === 'COMPLETED') {
    if (!isBoundedIdentifier(record.providerRunId) || !isLowercaseSha256(record.resultDigest) || usage === null) return null;
  } else if (record.providerRunId !== null || record.resultDigest !== null || usage !== null) return null;
  return Object.freeze({
    schema: 'AI_OPS_SYNTHETIC_PROVIDER_PORT_OUTPUT_V1',
    routeId: routeDescriptor.routeId,
    accessClass: routeDescriptor.accessClass,
    credentialClass: routeDescriptor.credentialClass,
    requestDigest,
    cliTemplateId: cliTemplate?.templateId ?? null,
    cliTemplateProvider: cliTemplate?.provider ?? null,
    status: record.status as SyntheticProviderPortOutput['status'],
    providerRunId: record.providerRunId as string | null,
    resultDigest: record.resultDigest as string | null,
    usage,
    networkAttempted: false,
    processSpawned: false,
    credentialMaterialObserved: false,
    reasonCodes,
  });
}

function inertResult(
  routeDescriptor: Readonly<SyntheticProviderRouteDescriptor>,
  decision: Readonly<SyntheticProviderCompatibilityDecision>,
  additionalReasons: readonly string[] = Object.freeze([]),
): Readonly<SyntheticProviderInvocationResult> {
  return Object.freeze({
    schema: 'AI_OPS_SYNTHETIC_PROVIDER_INVOCATION_RESULT_V1',
    simulated: false,
    authorityGranted: false,
    syntheticOnly: true,
    providerActivationAllowed: false,
    routeId: routeDescriptor.routeId,
    providerFamily: routeDescriptor.providerFamily,
    providerId: routeDescriptor.providerId,
    requestedAccessClass: decision.invocation?.accessClass ?? null,
    actualAccessClass: routeDescriptor.accessClass,
    credentialClass: routeDescriptor.credentialClass,
    configurationState: routeDescriptor.requiredConfigurationState,
    executionLocus: routeDescriptor.executionLocus,
    cliTemplateId: decision.cliTemplate?.templateId ?? null,
    cliTemplateProvider: decision.cliTemplate?.provider ?? null,
    cliTemplateConfigurationState: decision.cliTemplate?.configurationState ?? null,
    cliTemplateActivationAllowed: decision.cliTemplate?.activationAllowed ?? null,
    requestId: decision.invocation?.request.requestId ?? null,
    operation: decision.invocation?.request.operation ?? null,
    providerRunId: null,
    resultDigest: null,
    usage: null,
    fallbackUsed: false,
    networkAttempted: false,
    processSpawned: false,
    credentialMaterialObserved: false,
    reasonCodes: Object.freeze([...decision.reasonCodes, ...additionalReasons]),
  });
}

export function createSyntheticProviderAdapter(
  routeId: SyntheticProviderRouteId,
  port: Readonly<SyntheticProviderPort>,
): Readonly<SyntheticProviderAdapter> {
  const routeDescriptor = A3X_SYNTHETIC_PROVIDER_ROUTES.find((candidate) => candidate.routeId === routeId);
  if (routeDescriptor === undefined) throw new TypeError('synthetic provider route is not registered');
  if (!isPlainRecord(port) || port.schema !== 'AI_OPS_SYNTHETIC_PROVIDER_PORT_V1' || typeof port.invoke !== 'function') {
    throw new TypeError('synthetic provider port is invalid');
  }

  return Object.freeze({
    schema: 'AI_OPS_SYNTHETIC_PROVIDER_ADAPTER_V1',
    route: routeDescriptor,
    syntheticOnly: true,
    activationAllowed: false,
    async invoke(input: Readonly<SyntheticProviderInvocation>): Promise<Readonly<SyntheticProviderInvocationResult>> {
      const decision = evaluateSyntheticProviderRouteCompatibility(routeDescriptor, input);
      if (!decision.compatible || decision.invocation === null) return inertResult(routeDescriptor, decision);
      const invocation = decision.invocation;
      const requestDigest = providerOperationRequestDigest(invocation.request);
      let rawOutput: unknown;
      try {
        rawOutput = await port.invoke(Object.freeze({
          schema: 'AI_OPS_SYNTHETIC_PROVIDER_PORT_INVOCATION_V1',
          route: routeDescriptor,
          request: invocation.request,
          requestDigest,
          cliTemplate: decision.cliTemplate,
        }));
      } catch {
        return inertResult(routeDescriptor, decision, Object.freeze(['SYNTHETIC_PROVIDER_PORT_FAILED']));
      }
      const output = snapshotPortOutput(
        rawOutput,
        routeDescriptor,
        requestDigest,
        decision.cliTemplate,
        invocation.request.maximumTokens,
      );
      if (output === null) return inertResult(routeDescriptor, decision, Object.freeze(['SYNTHETIC_PROVIDER_PORT_OUTPUT_INVALID']));
      return Object.freeze({
        schema: 'AI_OPS_SYNTHETIC_PROVIDER_INVOCATION_RESULT_V1',
        simulated: output.status === 'COMPLETED',
        authorityGranted: false,
        syntheticOnly: true,
        providerActivationAllowed: false,
        routeId: routeDescriptor.routeId,
        providerFamily: routeDescriptor.providerFamily,
        providerId: routeDescriptor.providerId,
        requestedAccessClass: invocation.accessClass,
        actualAccessClass: routeDescriptor.accessClass,
        credentialClass: routeDescriptor.credentialClass,
        configurationState: routeDescriptor.requiredConfigurationState,
        executionLocus: routeDescriptor.executionLocus,
        cliTemplateId: decision.cliTemplate?.templateId ?? null,
        cliTemplateProvider: decision.cliTemplate?.provider ?? null,
        cliTemplateConfigurationState: decision.cliTemplate?.configurationState ?? null,
        cliTemplateActivationAllowed: decision.cliTemplate?.activationAllowed ?? null,
        requestId: invocation.request.requestId,
        operation: invocation.request.operation,
        providerRunId: output.providerRunId,
        resultDigest: output.resultDigest,
        usage: output.usage,
        fallbackUsed: false,
        networkAttempted: false,
        processSpawned: false,
        credentialMaterialObserved: false,
        reasonCodes: Object.freeze(['SYNTHETIC_FIXTURE_ONLY', ...output.reasonCodes]),
      });
    },
  });
}

export function createOpenAiApiFakeAdapter(port: Readonly<SyntheticProviderPort>): Readonly<SyntheticProviderAdapter> {
  return createSyntheticProviderAdapter('OPENAI_API_FAKE', port);
}

export function createAnthropicApiFakeAdapter(port: Readonly<SyntheticProviderPort>): Readonly<SyntheticProviderAdapter> {
  return createSyntheticProviderAdapter('ANTHROPIC_API_FAKE', port);
}

export function createCodexSubscriptionWorkerFakeAdapter(port: Readonly<SyntheticProviderPort>): Readonly<SyntheticProviderAdapter> {
  return createSyntheticProviderAdapter('CODEX_SUBSCRIPTION_CLI_FAKE', port);
}

export function createClaudeSubscriptionWorkerFakeAdapter(port: Readonly<SyntheticProviderPort>): Readonly<SyntheticProviderAdapter> {
  return createSyntheticProviderAdapter('CLAUDE_CODE_SUBSCRIPTION_CLI_FAKE', port);
}

export function validateSyntheticProviderRoutes(): readonly string[] {
  const issues: string[] = [];
  if (A3X_SYNTHETIC_PROVIDER_ROUTES.length !== SYNTHETIC_PROVIDER_ROUTE_IDS.length) issues.push('SYNTHETIC_PROVIDER_ROUTE_COUNT_MISMATCH');
  const observed = A3X_SYNTHETIC_PROVIDER_ROUTES.map((candidate) => candidate.routeId);
  if (observed.join('|') !== SYNTHETIC_PROVIDER_ROUTE_IDS.join('|')) issues.push('SYNTHETIC_PROVIDER_ROUTE_SET_MISMATCH');
  for (const candidate of A3X_SYNTHETIC_PROVIDER_ROUTES) {
    const expectedTemplateProvider = candidate.accessClass === 'OWNER_SUBSCRIPTION_CLI'
      ? candidate.providerFamily === 'OPENAI' ? 'CODEX_CLI' : 'CLAUDE_CODE_CLI'
      : null;
    const canonicalTemplates = expectedTemplateProvider === null
      ? []
      : SUBSCRIPTION_CLI_TEMPLATES.filter((template) => template.provider === expectedTemplateProvider);
    if (!isBoundedIdentifier(candidate.providerId)
      || !isExactProviderAccessClass(candidate.accessClass)
      || !isExactProviderCredentialClass(candidate.credentialClass)
      || candidate.credentialClass !== expectedCredentialClass(candidate.accessClass)
      || candidate.cliTemplateProvider !== expectedTemplateProvider
      || (expectedTemplateProvider !== null && canonicalTemplates.length !== 3)
      || canonicalTemplates.some((template) => (
        template.configurationState !== 'NOT_CONFIGURED'
        || template.activationAllowed !== false
        || !Object.isFrozen(template)
      ))
      || candidate.syntheticOnly !== true
      || candidate.activationAllowed !== false
      || candidate.fallbackPolicy !== 'NO_SILENT_FALLBACK') issues.push(`SYNTHETIC_PROVIDER_ROUTE_INVALID:${candidate.routeId}`);
  }
  return Object.freeze(issues);
}

import type { DiagnosticPermissionLevel } from '../../productAssurance/diagnostics/boundary.js';

export const PROVIDER_CONFIGURATION_STATES = Object.freeze([
  'NOT_CONFIGURED',
  'SUBSCRIPTION_CODEX_WORKER',
  'SUBSCRIPTION_CLAUDE_CODE_WORKER',
  'API_CONFIGURED',
  'DIAGNOSTIC_PLANE_UNAVAILABLE',
] as const);

export type ProviderConfigurationState = (typeof PROVIDER_CONFIGURATION_STATES)[number];

export const PROVIDER_ACCESS_CLASSES = Object.freeze([
  'PAID_API',
  'OWNER_SUBSCRIPTION_CLI',
] as const);

export type ProviderAccessClass = (typeof PROVIDER_ACCESS_CLASSES)[number];

export const PROVIDER_FAMILIES = Object.freeze([
  'OPENAI',
  'ANTHROPIC',
] as const);

export type ProviderFamily = (typeof PROVIDER_FAMILIES)[number];

export const PROVIDER_CREDENTIAL_CLASSES = Object.freeze([
  'API_WORKLOAD_IDENTITY_REFERENCE',
  'OWNER_SUBSCRIPTION_SESSION_REFERENCE',
] as const);

export type ProviderCredentialClass = (typeof PROVIDER_CREDENTIAL_CLASSES)[number];

export const PROVIDER_EXECUTION_LOCI = Object.freeze([
  'EXTERNAL_PROVIDER_API_FAKE',
  'OWNER_OPERATED_CLI_FAKE',
] as const);

export type ProviderExecutionLocus = (typeof PROVIDER_EXECUTION_LOCI)[number];

export const AI_OPS_IDENTITY_ROLES = Object.freeze([
  'RUNTIME_DIAGNOSTICIAN',
  'ENGINEERING_REPAIR_WORKER',
  'INDEPENDENT_VERIFIER',
  'RESEARCH_TRADE_CONTEXT_ADVISOR',
] as const);

export type AiOpsIdentityRole = (typeof AI_OPS_IDENTITY_ROLES)[number];

export const PROVIDER_OPERATION_IDS = Object.freeze([
  'diagnose',
  'continue',
  'cancel',
  'status',
  'usage',
  'health',
] as const);

export type ProviderOperationId = (typeof PROVIDER_OPERATION_IDS)[number];

export interface ProviderOperationRequest {
  readonly schema: 'AI_OPS_PROVIDER_OPERATION_REQUEST_V1';
  readonly requestId: string;
  readonly operation: ProviderOperationId;
  readonly caseId: string;
  readonly identityRole: AiOpsIdentityRole;
  readonly providerId: string;
  readonly modelId: string;
  readonly providerProtocolVersion: '1';
  readonly adapterVersion: string;
  readonly promptRevision: string;
  readonly toolRegistryDigest: string;
  readonly policyBundleDigest: string;
  readonly redactionReceiptDigest: string;
  readonly cancellationTokenId: string;
  readonly rateLimitReservationId: string;
  readonly toolAllowlist: readonly string[];
  readonly backgroundMode: 'DISABLED';
  readonly fallbackPolicy: 'NO_SILENT_FALLBACK';
  readonly maximumTokens: number;
  readonly maximumCostMicrounits: number;
  readonly evidenceDigest: string;
  readonly policyRevision: string;
  readonly requestedPermission: DiagnosticPermissionLevel;
  readonly workflowGeneration: number;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly deadlineAtMs: number;
}

export interface ProviderOperationResult {
  readonly schema: 'AI_OPS_PROVIDER_OPERATION_RESULT_V1';
  readonly requestId: string;
  readonly operation: ProviderOperationId;
  readonly accepted: false;
  readonly authorityGranted: false;
  readonly configurationState: ProviderConfigurationState;
  readonly providerRunId: null;
  readonly usage: null;
  readonly responseProvenance: null;
  readonly backgroundJobId: null;
  readonly circuitState: 'OPEN_NOT_CONFIGURED';
  readonly retentionReadback: 'UNKNOWN_BLOCKED';
  readonly fallbackUsed: false;
  readonly redactionVerified: false;
  readonly reasonCodes: readonly string[];
}

export interface ProviderAdapter {
  readonly schema: 'AI_OPS_PROVIDER_ADAPTER_V1';
  readonly providerId: string;
  readonly configurationState: ProviderConfigurationState;
  readonly activationAllowed: false;
  readonly adapterVersion: 'a3-shadow-v1';
  diagnose(request: Readonly<ProviderOperationRequest>): Promise<Readonly<ProviderOperationResult>>;
  continue(request: Readonly<ProviderOperationRequest>): Promise<Readonly<ProviderOperationResult>>;
  cancel(request: Readonly<ProviderOperationRequest>): Promise<Readonly<ProviderOperationResult>>;
  status(request: Readonly<ProviderOperationRequest>): Promise<Readonly<ProviderOperationResult>>;
  usage(request: Readonly<ProviderOperationRequest>): Promise<Readonly<ProviderOperationResult>>;
  health(request: Readonly<ProviderOperationRequest>): Promise<Readonly<ProviderOperationResult>>;
}

export interface CapabilityNegotiationRequest {
  readonly schema: 'AI_OPS_CAPABILITY_NEGOTIATION_REQUEST_V1';
  readonly providerId: string;
  readonly modelId: string;
  readonly identityRole: AiOpsIdentityRole;
  readonly requestedProtocolVersion: '1';
  readonly requestedAdapterVersion: string;
  readonly requestedSchemaVersion: '1';
  readonly requestedCapabilities: readonly string[];
}

export interface CapabilityNegotiationResult {
  readonly schema: 'AI_OPS_CAPABILITY_NEGOTIATION_RESULT_V1';
  readonly negotiated: false;
  readonly authorityGranted: false;
  readonly protocolVersion: null;
  readonly adapterVersion: null;
  readonly schemaVersion: null;
  readonly capabilities: readonly [];
  readonly reasonCodes: readonly string[];
}

export interface InsertionRequestRowV1 {
  readonly schema: 'InsertionRequestRowV1';
  readonly version: 1;
  readonly rowId: string;
  readonly status: 'DRAFT';
  readonly requestedOwner: string;
  readonly targetSeam: string;
  readonly reason: string;
  readonly contract: readonly string[];
  readonly tests: readonly string[];
  readonly expectedBehavior: readonly string[];
  readonly wiringState: string;
  readonly authorityCreated: false;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value) as unknown;
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function isExactProviderConfigurationState(value: unknown): value is ProviderConfigurationState {
  return typeof value === 'string' && (PROVIDER_CONFIGURATION_STATES as readonly string[]).includes(value);
}

export function isExactProviderAccessClass(value: unknown): value is ProviderAccessClass {
  return typeof value === 'string' && (PROVIDER_ACCESS_CLASSES as readonly string[]).includes(value);
}

export function isExactProviderFamily(value: unknown): value is ProviderFamily {
  return typeof value === 'string' && (PROVIDER_FAMILIES as readonly string[]).includes(value);
}

export function isExactProviderCredentialClass(value: unknown): value is ProviderCredentialClass {
  return typeof value === 'string' && (PROVIDER_CREDENTIAL_CLASSES as readonly string[]).includes(value);
}

export function isExactIdentityRole(value: unknown): value is AiOpsIdentityRole {
  return typeof value === 'string' && (AI_OPS_IDENTITY_ROLES as readonly string[]).includes(value);
}

export function isLowercaseSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function isGitCommitSha(value: unknown): value is string {
  return typeof value === 'string' && (/^[a-f0-9]{40}$/.test(value) || /^[a-f0-9]{64}$/.test(value));
}

export function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

export function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left.localeCompare(right)));
}

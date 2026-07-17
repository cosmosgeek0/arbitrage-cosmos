import {
  DIAGNOSTIC_ALLOWED_CAPABILITY_IDS,
  type DiagnosticPermissionLevel,
} from '../../productAssurance/diagnostics/boundary.js';
import {
  AI_OPS_IDENTITY_ROLES,
  PROVIDER_CONFIGURATION_STATES,
  type AiOpsIdentityRole,
  type ProviderConfigurationState,
} from './contracts.js';

export interface ProviderCapabilityRetentionRow {
  readonly schema: 'AI_OPS_PROVIDER_CAPABILITY_RETENTION_ROW_V1';
  readonly configurationState: ProviderConfigurationState;
  readonly adapterAvailability: 'DECLARATIVE_TEMPLATE_ONLY' | 'MISSING' | 'UNAVAILABLE';
  readonly activationAllowed: false;
  readonly structuredOutput: 'SUPPORTED_BY_TEMPLATE' | 'NOT_AVAILABLE';
  readonly continuation: 'SUPPORTED_BY_INTERFACE_ONLY' | 'NOT_AVAILABLE';
  readonly providerRetentionPolicy: 'UNKNOWN_NOT_CONFIGURED';
  readonly independentEvidenceRetention: 'REQUIRES_I00_LEDGER_BINDING';
  readonly authenticationMaterial: 'EXTERNAL_TRUSTED_RUNNER_ONLY' | 'NOT_PRESENT';
  readonly authenticationType: 'NONE' | 'EXTERNAL_SUBSCRIPTION_SESSION_REFERENCE' | 'API_WORKLOAD_IDENTITY_REQUIRED';
  readonly retentionZdrPosture: 'UNKNOWN_BLOCKED';
  readonly storeBehavior: 'UNKNOWN_BLOCKED';
  readonly backgroundModeCompatibility: 'UNKNOWN_BLOCKED';
  readonly region: 'UNKNOWN_BLOCKED';
  readonly schemaToolParity: 'UNQUALIFIED';
  readonly evalQualification: 'UNQUALIFIED';
  readonly budgetState: 'NOT_CONFIGURED';
  readonly emergencyReserve: 'NOT_CONFIGURED';
  readonly unattendedRuntimeEligible: false;
  readonly billingFallback: 'FORBIDDEN';
  readonly reasonCodes: readonly string[];
}

export interface AiIdentityRow {
  readonly schema: 'AI_OPS_IDENTITY_ROW_V1';
  readonly identityId: string;
  readonly role: AiOpsIdentityRole;
  readonly configurationState: 'NOT_CONFIGURED';
  readonly activationAllowed: false;
  readonly maximumPermission: DiagnosticPermissionLevel;
  readonly allowedCapabilities: readonly string[];
  readonly canWriteMain: false;
  readonly canUseArbitraryNetwork: false;
  readonly canHoldCredentials: false;
  readonly reasonCodes: readonly string[];
}

const OBSERVE = Object.freeze(['READ_REDACTED_EVIDENCE', 'EXPLAIN_CAUSAL_CHAIN']);
const DIAGNOSE = Object.freeze([
  ...OBSERVE,
  'QUERY_BOUNDED_EVIDENCE',
  'RUN_ISOLATED_REPLAY',
  'PROPOSE_REGISTERED_REMEDIATION',
]);
const REPAIR = Object.freeze([
  ...DIAGNOSE,
  'PROPOSE_ISOLATED_PATCH',
  'RUN_ISOLATED_TESTS',
]);

const BLOCKED_ROUTE_POSTURE = Object.freeze({
  retentionZdrPosture: 'UNKNOWN_BLOCKED',
  storeBehavior: 'UNKNOWN_BLOCKED',
  backgroundModeCompatibility: 'UNKNOWN_BLOCKED',
  region: 'UNKNOWN_BLOCKED',
  schemaToolParity: 'UNQUALIFIED',
  evalQualification: 'UNQUALIFIED',
  budgetState: 'NOT_CONFIGURED',
  emergencyReserve: 'NOT_CONFIGURED',
  unattendedRuntimeEligible: false,
} as const);

export const PROVIDER_CAPABILITY_RETENTION_MATRIX: readonly Readonly<ProviderCapabilityRetentionRow>[] = Object.freeze(([
  {
    schema: 'AI_OPS_PROVIDER_CAPABILITY_RETENTION_ROW_V1',
    configurationState: 'NOT_CONFIGURED',
    adapterAvailability: 'DECLARATIVE_TEMPLATE_ONLY',
    activationAllowed: false,
    structuredOutput: 'NOT_AVAILABLE',
    continuation: 'NOT_AVAILABLE',
    providerRetentionPolicy: 'UNKNOWN_NOT_CONFIGURED',
    independentEvidenceRetention: 'REQUIRES_I00_LEDGER_BINDING',
    authenticationMaterial: 'NOT_PRESENT',
    authenticationType: 'NONE',
    ...BLOCKED_ROUTE_POSTURE,
    billingFallback: 'FORBIDDEN',
    reasonCodes: Object.freeze(['NO_PROVIDER_SELECTED', 'NO_PROVIDER_CALL_ALLOWED']),
  },
  {
    schema: 'AI_OPS_PROVIDER_CAPABILITY_RETENTION_ROW_V1',
    configurationState: 'SUBSCRIPTION_CODEX_WORKER',
    adapterAvailability: 'DECLARATIVE_TEMPLATE_ONLY',
    activationAllowed: false,
    structuredOutput: 'SUPPORTED_BY_TEMPLATE',
    continuation: 'SUPPORTED_BY_INTERFACE_ONLY',
    providerRetentionPolicy: 'UNKNOWN_NOT_CONFIGURED',
    independentEvidenceRetention: 'REQUIRES_I00_LEDGER_BINDING',
    authenticationMaterial: 'EXTERNAL_TRUSTED_RUNNER_ONLY',
    authenticationType: 'EXTERNAL_SUBSCRIPTION_SESSION_REFERENCE',
    ...BLOCKED_ROUTE_POSTURE,
    billingFallback: 'FORBIDDEN',
    reasonCodes: Object.freeze(['UNCONFIGURED_TEMPLATE_ONLY', 'PORT_REVALIDATION_REQUIRED']),
  },
  {
    schema: 'AI_OPS_PROVIDER_CAPABILITY_RETENTION_ROW_V1',
    configurationState: 'SUBSCRIPTION_CLAUDE_CODE_WORKER',
    adapterAvailability: 'DECLARATIVE_TEMPLATE_ONLY',
    activationAllowed: false,
    structuredOutput: 'SUPPORTED_BY_TEMPLATE',
    continuation: 'SUPPORTED_BY_INTERFACE_ONLY',
    providerRetentionPolicy: 'UNKNOWN_NOT_CONFIGURED',
    independentEvidenceRetention: 'REQUIRES_I00_LEDGER_BINDING',
    authenticationMaterial: 'EXTERNAL_TRUSTED_RUNNER_ONLY',
    authenticationType: 'EXTERNAL_SUBSCRIPTION_SESSION_REFERENCE',
    ...BLOCKED_ROUTE_POSTURE,
    billingFallback: 'FORBIDDEN',
    reasonCodes: Object.freeze(['UNCONFIGURED_TEMPLATE_ONLY', 'PORT_REVALIDATION_REQUIRED']),
  },
  {
    schema: 'AI_OPS_PROVIDER_CAPABILITY_RETENTION_ROW_V1',
    configurationState: 'API_CONFIGURED',
    adapterAvailability: 'MISSING',
    activationAllowed: false,
    structuredOutput: 'NOT_AVAILABLE',
    continuation: 'NOT_AVAILABLE',
    providerRetentionPolicy: 'UNKNOWN_NOT_CONFIGURED',
    independentEvidenceRetention: 'REQUIRES_I00_LEDGER_BINDING',
    authenticationMaterial: 'NOT_PRESENT',
    authenticationType: 'API_WORKLOAD_IDENTITY_REQUIRED',
    ...BLOCKED_ROUTE_POSTURE,
    billingFallback: 'FORBIDDEN',
    reasonCodes: Object.freeze(['API_ADAPTER_NOT_IMPLEMENTED', 'REAL_CREDENTIALS_FORBIDDEN']),
  },
  {
    schema: 'AI_OPS_PROVIDER_CAPABILITY_RETENTION_ROW_V1',
    configurationState: 'DIAGNOSTIC_PLANE_UNAVAILABLE',
    adapterAvailability: 'UNAVAILABLE',
    activationAllowed: false,
    structuredOutput: 'NOT_AVAILABLE',
    continuation: 'NOT_AVAILABLE',
    providerRetentionPolicy: 'UNKNOWN_NOT_CONFIGURED',
    independentEvidenceRetention: 'REQUIRES_I00_LEDGER_BINDING',
    authenticationMaterial: 'NOT_PRESENT',
    authenticationType: 'NONE',
    ...BLOCKED_ROUTE_POSTURE,
    billingFallback: 'FORBIDDEN',
    reasonCodes: Object.freeze(['DIAGNOSTIC_PLANE_UNAVAILABLE']),
  },
] as ProviderCapabilityRetentionRow[]).map((row) => Object.freeze(row)));

export const AI_IDENTITY_MATRIX: readonly Readonly<AiIdentityRow>[] = Object.freeze(([
  {
    schema: 'AI_OPS_IDENTITY_ROW_V1',
    identityId: 'aiops-runtime-diagnostician',
    role: 'RUNTIME_DIAGNOSTICIAN',
    configurationState: 'NOT_CONFIGURED',
    activationAllowed: false,
    maximumPermission: 'PROPOSE_TYPED_ACTION',
    allowedCapabilities: DIAGNOSE,
    canWriteMain: false,
    canUseArbitraryNetwork: false,
    canHoldCredentials: false,
    reasonCodes: Object.freeze(['WORKLOAD_IDENTITY_PORT_PENDING', 'PROVIDER_ROUTE_NOT_CONFIGURED']),
  },
  {
    schema: 'AI_OPS_IDENTITY_ROW_V1',
    identityId: 'aiops-engineering-repair-worker',
    role: 'ENGINEERING_REPAIR_WORKER',
    configurationState: 'NOT_CONFIGURED',
    activationAllowed: false,
    maximumPermission: 'PATCH_ISOLATED_AND_TEST',
    allowedCapabilities: REPAIR,
    canWriteMain: false,
    canUseArbitraryNetwork: false,
    canHoldCredentials: false,
    reasonCodes: Object.freeze(['WORKLOAD_IDENTITY_PORT_PENDING', 'CLASS_C_RUNNER_NOT_CONFIGURED']),
  },
  {
    schema: 'AI_OPS_IDENTITY_ROW_V1',
    identityId: 'aiops-independent-verifier',
    role: 'INDEPENDENT_VERIFIER',
    configurationState: 'NOT_CONFIGURED',
    activationAllowed: false,
    maximumPermission: 'BOUNDED_QUERY_REPLAY',
    allowedCapabilities: Object.freeze([...OBSERVE, 'QUERY_BOUNDED_EVIDENCE', 'RUN_ISOLATED_REPLAY']),
    canWriteMain: false,
    canUseArbitraryNetwork: false,
    canHoldCredentials: false,
    reasonCodes: Object.freeze(['WORKLOAD_IDENTITY_PORT_PENDING', 'INDEPENDENCE_PROOF_PENDING']),
  },
  {
    schema: 'AI_OPS_IDENTITY_ROW_V1',
    identityId: 'aiops-research-trade-context-advisor',
    role: 'RESEARCH_TRADE_CONTEXT_ADVISOR',
    configurationState: 'NOT_CONFIGURED',
    activationAllowed: false,
    maximumPermission: 'OBSERVE_EXPLAIN',
    allowedCapabilities: Object.freeze([]),
    canWriteMain: false,
    canUseArbitraryNetwork: false,
    canHoldCredentials: false,
    reasonCodes: Object.freeze(['ADVISOR_NOT_CONFIGURED', 'BOUNDED_ADVISOR_HAS_NO_ROUTE']),
  },
] as AiIdentityRow[]).map((row) => Object.freeze(row)));

export function validateProviderAndIdentityMatrices(): readonly string[] {
  const issues: string[] = [];
  const states = PROVIDER_CAPABILITY_RETENTION_MATRIX.map((row) => row.configurationState);
  if (states.join('|') !== PROVIDER_CONFIGURATION_STATES.join('|')) issues.push('PROVIDER_STATE_MATRIX_NOT_EXACT');
  const roles = AI_IDENTITY_MATRIX.map((row) => row.role);
  if (roles.join('|') !== AI_OPS_IDENTITY_ROLES.join('|')) issues.push('IDENTITY_ROLE_MATRIX_NOT_EXACT');
  for (const row of AI_IDENTITY_MATRIX) {
    if (row.activationAllowed !== false || row.configurationState !== 'NOT_CONFIGURED') issues.push(`IDENTITY_ACTIVATED:${row.identityId}`);
    for (const capability of row.allowedCapabilities) {
      if (!(DIAGNOSTIC_ALLOWED_CAPABILITY_IDS as readonly string[]).includes(capability)) {
        issues.push(`UNKNOWN_DIAGNOSTIC_CAPABILITY:${row.identityId}:${capability}`);
      }
    }
  }
  for (const row of PROVIDER_CAPABILITY_RETENTION_MATRIX) {
    if (row.activationAllowed !== false || row.billingFallback !== 'FORBIDDEN') issues.push(`PROVIDER_ROW_NOT_FAIL_CLOSED:${row.configurationState}`);
  }
  return Object.freeze(issues);
}

import {
  AI_OPS_ALLOWED_CAPABILITIES_BY_ROLE,
  AI_OPS_IDENTITY_ROLES,
  AI_OPS_PROVIDER_STATES,
  type AiOpsIdentityRole,
  type AiOpsProviderState,
} from '../policy/authority.js';
import {
  canonicalPolicyJson,
  canonicalPolicySnapshot,
  exactKeys,
  immutableClone,
  isBoundedId,
  isSafeIntegerAtLeast,
  sortedUnique,
} from '../contracts/shared.js';

export const AI_OPS_AUTH_MODES = Object.freeze([
  'NONE',
  'CHATGPT_SUBSCRIPTION',
  'CLAUDE_SUBSCRIPTION',
  'API_KEY',
  'UNKNOWN',
] as const);
export type AiOpsAuthMode = (typeof AI_OPS_AUTH_MODES)[number];

export const AI_OPS_BILLING_DOMAINS = Object.freeze([
  'NONE',
  'CHATGPT_SUBSCRIPTION',
  'CLAUDE_SUBSCRIPTION',
  'SYNTHETIC_API_BUDGET',
  'UNKNOWN',
] as const);
export type AiOpsBillingDomain = (typeof AI_OPS_BILLING_DOMAINS)[number];

export interface AiOpsIdentityDescriptor {
  readonly identityId: string;
  readonly role: AiOpsIdentityRole;
  readonly isolatedFromIdentityIds: readonly string[];
  readonly capabilityIds: readonly string[];
  readonly credentialInheritance: 'DENIED';
  readonly crossRoleFallback: 'DENIED';
  readonly authorityCreated: false;
}

const IDENTITY_IDS: Readonly<Record<AiOpsIdentityRole, string>> = Object.freeze({
  RUNTIME_DIAGNOSTICIAN: 'aiops-shadow-runtime-diagnostician',
  ENGINEERING_REPAIR_WORKER: 'aiops-shadow-engineering-repair-worker',
  INDEPENDENT_VERIFICATION_WORKER: 'aiops-shadow-independent-verification-worker',
  RESEARCH_TRADE_CONTEXT_ADVISOR: 'aiops-shadow-research-trade-context-advisor',
});

export const AI_OPS_IDENTITIES: readonly Readonly<AiOpsIdentityDescriptor>[] = immutableClone(
  AI_OPS_IDENTITY_ROLES.map((role) => ({
    identityId: IDENTITY_IDS[role],
    role,
    isolatedFromIdentityIds: AI_OPS_IDENTITY_ROLES
      .filter((candidate) => candidate !== role)
      .map((candidate) => IDENTITY_IDS[candidate])
      .sort(),
    capabilityIds: sortedUnique(AI_OPS_ALLOWED_CAPABILITIES_BY_ROLE[role]),
    credentialInheritance: 'DENIED' as const,
    crossRoleFallback: 'DENIED' as const,
    authorityCreated: false as const,
  })),
);

export interface AiOpsProviderCredentialMatrixRow {
  readonly rowId: string;
  readonly identityId: string;
  readonly role: AiOpsIdentityRole;
  readonly providerState: AiOpsProviderState;
  readonly providerId: 'SYNTHETIC_SUBSCRIPTION_PROVIDER' | 'SYNTHETIC_API_PROVIDER' | null;
  readonly intendedAuthMode: AiOpsAuthMode;
  readonly observedAuthMode: AiOpsAuthMode;
  readonly billingDomain: AiOpsBillingDomain;
  readonly credentialReference: string | null;
  readonly credentialMaterialPresent: false;
  readonly executableCapabilityIds: readonly string[];
  readonly maximumCostMicrounits: number | null;
  readonly disposition: 'SYNTHETIC_FIXTURE_ONLY' | 'DENIED' | 'UNAVAILABLE';
  readonly reasonCodes: readonly string[];
  readonly paidFallbackAllowed: false;
  readonly authorityCreated: false;
}

function providerFields(
  state: AiOpsProviderState,
  role: AiOpsIdentityRole,
): Omit<AiOpsProviderCredentialMatrixRow, 'rowId' | 'identityId' | 'role'> {
  const advisor = role === 'RESEARCH_TRADE_CONTEXT_ADVISOR';
  if (advisor && state !== 'NOT_CONFIGURED') {
    return {
      providerState: state,
      providerId: null,
      intendedAuthMode: 'NONE',
      observedAuthMode: 'NONE',
      billingDomain: 'NONE',
      credentialReference: null,
      credentialMaterialPresent: false,
      executableCapabilityIds: [],
      maximumCostMicrounits: null,
      disposition: 'DENIED',
      reasonCodes: ['ADVISOR_MUST_REMAIN_NOT_CONFIGURED'],
      paidFallbackAllowed: false,
      authorityCreated: false,
    };
  }
  switch (state) {
    case 'NOT_CONFIGURED':
      return {
        providerState: state,
        providerId: null,
        intendedAuthMode: 'NONE',
        observedAuthMode: 'NONE',
        billingDomain: 'NONE',
        credentialReference: null,
        credentialMaterialPresent: false,
        executableCapabilityIds: [],
        maximumCostMicrounits: null,
        disposition: 'DENIED',
        reasonCodes: advisor ? ['ADVISOR_NOT_CONFIGURED'] : ['PROVIDER_NOT_CONFIGURED'],
        paidFallbackAllowed: false,
        authorityCreated: false,
      };
    case 'SUBSCRIPTION_CODEX_WORKER':
      return {
        providerState: state,
        providerId: 'SYNTHETIC_SUBSCRIPTION_PROVIDER',
        intendedAuthMode: 'CHATGPT_SUBSCRIPTION',
        observedAuthMode: 'NONE',
        billingDomain: 'CHATGPT_SUBSCRIPTION',
        credentialReference: `synthetic-ref://openai-codex/${role.toLowerCase()}`,
        credentialMaterialPresent: false,
        executableCapabilityIds: [],
        maximumCostMicrounits: null,
        disposition: 'SYNTHETIC_FIXTURE_ONLY',
        reasonCodes: ['NO_EXECUTION_CAPABILITY', 'NOT_MOUNTED', 'SYNTHETIC_FIXTURE_ONLY'],
        paidFallbackAllowed: false,
        authorityCreated: false,
      };
    case 'SUBSCRIPTION_CLAUDE_CODE_WORKER':
      return {
        providerState: state,
        providerId: 'SYNTHETIC_SUBSCRIPTION_PROVIDER',
        intendedAuthMode: 'CLAUDE_SUBSCRIPTION',
        observedAuthMode: 'NONE',
        billingDomain: 'CLAUDE_SUBSCRIPTION',
        credentialReference: `synthetic-ref://anthropic-claude-code/${role.toLowerCase()}`,
        credentialMaterialPresent: false,
        executableCapabilityIds: [],
        maximumCostMicrounits: null,
        disposition: 'SYNTHETIC_FIXTURE_ONLY',
        reasonCodes: ['NO_EXECUTION_CAPABILITY', 'NOT_MOUNTED', 'SYNTHETIC_FIXTURE_ONLY'],
        paidFallbackAllowed: false,
        authorityCreated: false,
      };
    case 'API_CONFIGURED':
      return {
        providerState: state,
        providerId: 'SYNTHETIC_API_PROVIDER',
        intendedAuthMode: 'API_KEY',
        observedAuthMode: 'NONE',
        billingDomain: 'SYNTHETIC_API_BUDGET',
        credentialReference: `synthetic-ref://fake-api/${role.toLowerCase()}`,
        credentialMaterialPresent: false,
        executableCapabilityIds: [],
        maximumCostMicrounits: null,
        disposition: 'SYNTHETIC_FIXTURE_ONLY',
        reasonCodes: ['NO_EXECUTION_CAPABILITY', 'NOT_MOUNTED', 'SYNTHETIC_FIXTURE_ONLY'],
        paidFallbackAllowed: false,
        authorityCreated: false,
      };
    case 'DIAGNOSTIC_PLANE_UNAVAILABLE':
      return {
        providerState: state,
        providerId: null,
        intendedAuthMode: 'UNKNOWN',
        observedAuthMode: 'UNKNOWN',
        billingDomain: 'UNKNOWN',
        credentialReference: null,
        credentialMaterialPresent: false,
        executableCapabilityIds: [],
        maximumCostMicrounits: null,
        disposition: 'UNAVAILABLE',
        reasonCodes: ['DIAGNOSTIC_EVIDENCE_UNAVAILABLE', 'FAIL_CLOSED'],
        paidFallbackAllowed: false,
        authorityCreated: false,
      };
  }
}

export const AI_OPS_PROVIDER_CREDENTIAL_MATRIX: readonly Readonly<AiOpsProviderCredentialMatrixRow>[] = immutableClone(
  AI_OPS_IDENTITIES.flatMap((identity) => (identity.role === 'RESEARCH_TRADE_CONTEXT_ADVISOR' ? ['NOT_CONFIGURED'] as const : AI_OPS_PROVIDER_STATES).map((providerState) => ({
    rowId: `${identity.identityId}:${providerState}`,
    identityId: identity.identityId,
    role: identity.role,
    ...providerFields(providerState, identity.role),
  }))),
);

/**
 * Any change to a provider row, route, or synthetic credential reference must
 * increment this revision. Transition candidates bind the exact revision and
 * both rows so a same-billing-domain account substitution cannot be silent.
 */
export const AI_OPS_PROVIDER_MATRIX_REVISION = 1 as const;

export interface AiOpsBillingTransitionAuthorization {
  readonly authorizationId: string;
  readonly identityId: string;
  readonly providerMatrixRevision: typeof AI_OPS_PROVIDER_MATRIX_REVISION;
  readonly fromProviderRowId: string;
  readonly toProviderRowId: string;
  readonly fromCredentialReference: string | null;
  readonly toCredentialReference: string | null;
  readonly fromBillingDomain: AiOpsBillingDomain;
  readonly toBillingDomain: AiOpsBillingDomain;
  readonly previousRevision: number;
  readonly revision: number;
  readonly ownerSignatureReference: string;
  readonly approvalReceiptReference: string;
  readonly readbackRevision: number;
  readonly expiresAtMs: number;
}

export interface AiOpsBillingAuthorizationVerifier {
  verify(authorization: Readonly<AiOpsBillingTransitionAuthorization>, exactAuthorizationBytes: Uint8Array): boolean;
}

export interface AiOpsProviderTransitionRequest {
  readonly identityId: string;
  readonly providerMatrixRevision: typeof AI_OPS_PROVIDER_MATRIX_REVISION;
  readonly fromProviderRowId: string;
  readonly toProviderRowId: string;
  readonly fromCredentialReference: string | null;
  readonly toCredentialReference: string | null;
  readonly fromState: AiOpsProviderState;
  readonly toState: AiOpsProviderState;
  readonly fromBillingDomain: AiOpsBillingDomain;
  readonly toBillingDomain: AiOpsBillingDomain;
  readonly trigger: 'OWNER_REQUEST' | 'AUTH_FAILURE' | 'QUOTA_EXHAUSTED' | 'ENVIRONMENT_CREDENTIAL_DETECTED' | 'DIAGNOSTIC_FAILURE';
  readonly nowMs: number;
  readonly authorization: Readonly<AiOpsBillingTransitionAuthorization> | null;
}

export interface AiOpsProviderTransitionDecision {
  /** Shadow artifacts never authorize or perform the proposed transition. */
  readonly allowed: false;
  /** Structural candidate verdict only; accepted interfaces must re-check it. */
  readonly candidateValidatedForPortRecheck: boolean;
  readonly nextState: AiOpsProviderState;
  readonly reasonCodes: readonly string[];
  readonly billingSwitchPerformed: false;
  readonly state: 'SHADOW_SPECULATIVE';
  readonly authorityCreated: false;
}

const BILLING_DOMAIN_BY_PROVIDER_STATE: Readonly<Record<AiOpsProviderState, AiOpsBillingDomain>> = Object.freeze({
  NOT_CONFIGURED: 'NONE',
  SUBSCRIPTION_CODEX_WORKER: 'CHATGPT_SUBSCRIPTION',
  SUBSCRIPTION_CLAUDE_CODE_WORKER: 'CLAUDE_SUBSCRIPTION',
  API_CONFIGURED: 'SYNTHETIC_API_BUDGET',
  DIAGNOSTIC_PLANE_UNAVAILABLE: 'UNKNOWN',
});

const AI_OPS_PROVIDER_TRANSITION_TRIGGERS = Object.freeze([
  'OWNER_REQUEST',
  'AUTH_FAILURE',
  'QUOTA_EXHAUSTED',
  'ENVIRONMENT_CREDENTIAL_DETECTED',
  'DIAGNOSTIC_FAILURE',
] as const);

type AiOpsProviderTransitionTrigger = (typeof AI_OPS_PROVIDER_TRANSITION_TRIGGERS)[number];

const FAILURE_TRANSITION_TRIGGERS: readonly AiOpsProviderTransitionTrigger[] = Object.freeze([
  'AUTH_FAILURE',
  'QUOTA_EXHAUSTED',
  'ENVIRONMENT_CREDENTIAL_DETECTED',
  'DIAGNOSTIC_FAILURE',
]);

const PROVIDER_TRANSITION_REQUEST_KEYS = Object.freeze([
  'identityId',
  'providerMatrixRevision',
  'fromProviderRowId',
  'toProviderRowId',
  'fromCredentialReference',
  'toCredentialReference',
  'fromState',
  'toState',
  'fromBillingDomain',
  'toBillingDomain',
  'trigger',
  'nowMs',
  'authorization',
] as const);

const BILLING_AUTHORIZATION_KEYS = Object.freeze([
  'authorizationId',
  'identityId',
  'providerMatrixRevision',
  'fromProviderRowId',
  'toProviderRowId',
  'fromCredentialReference',
  'toCredentialReference',
  'fromBillingDomain',
  'toBillingDomain',
  'previousRevision',
  'revision',
  'ownerSignatureReference',
  'approvalReceiptReference',
  'readbackRevision',
  'expiresAtMs',
] as const);

function isCredentialReference(value: unknown): value is string | null {
  return value === null || isBoundedId(value);
}

function isProviderState(value: unknown): value is AiOpsProviderState {
  return typeof value === 'string' && AI_OPS_PROVIDER_STATES.includes(value as AiOpsProviderState);
}

function isBillingDomain(value: unknown): value is AiOpsBillingDomain {
  return typeof value === 'string' && AI_OPS_BILLING_DOMAINS.includes(value as AiOpsBillingDomain);
}

function isTransitionTrigger(value: unknown): value is AiOpsProviderTransitionTrigger {
  return typeof value === 'string' && AI_OPS_PROVIDER_TRANSITION_TRIGGERS.includes(value as AiOpsProviderTransitionTrigger);
}

function isBoundedReference(value: unknown, prefix: string): value is string {
  return isBoundedId(value)
    && value.startsWith(prefix)
    && isBoundedId(value.slice(prefix.length));
}

function isProviderTransitionRequest(value: unknown): value is Readonly<AiOpsProviderTransitionRequest> {
  if (!exactKeys(value, PROVIDER_TRANSITION_REQUEST_KEYS)) return false;
  return isBoundedId(value.identityId)
    && value.providerMatrixRevision === AI_OPS_PROVIDER_MATRIX_REVISION
    && isBoundedId(value.fromProviderRowId)
    && isBoundedId(value.toProviderRowId)
    && isCredentialReference(value.fromCredentialReference)
    && isCredentialReference(value.toCredentialReference)
    && isProviderState(value.fromState)
    && isProviderState(value.toState)
    && isBillingDomain(value.fromBillingDomain)
    && isBillingDomain(value.toBillingDomain)
    && isTransitionTrigger(value.trigger)
    && isSafeIntegerAtLeast(value.nowMs, 0)
    && (value.authorization === null || exactKeys(value.authorization, BILLING_AUTHORIZATION_KEYS));
}

function transitionDecision(
  candidateValidatedForPortRecheck: boolean,
  nextState: AiOpsProviderState,
  reasonCodes: readonly string[],
): Readonly<AiOpsProviderTransitionDecision> {
  return immutableClone({
    allowed: false as const,
    candidateValidatedForPortRecheck,
    nextState,
    reasonCodes,
    billingSwitchPerformed: false as const,
    state: 'SHADOW_SPECULATIVE' as const,
    authorityCreated: false as const,
  });
}

function unavailableDecision(reasonCodes: readonly string[]): Readonly<AiOpsProviderTransitionDecision> {
  return transitionDecision(false, 'DIAGNOSTIC_PLANE_UNAVAILABLE', [
    ...reasonCodes,
    'FAIL_CLOSED_CANDIDATE_REQUIRES_DIAGNOSTIC_PLANE_UNAVAILABLE',
    'SHADOW_SPECULATIVE_REQUIRES_PORT_RECHECK',
  ]);
}

function matrixRow(identityId: string, state: AiOpsProviderState): Readonly<AiOpsProviderCredentialMatrixRow> | null {
  return AI_OPS_PROVIDER_CREDENTIAL_MATRIX.find((row) => row.identityId === identityId && row.providerState === state) ?? null;
}

function requestBindsExactRows(
  request: Readonly<AiOpsProviderTransitionRequest>,
  fromRow: Readonly<AiOpsProviderCredentialMatrixRow>,
  toRow: Readonly<AiOpsProviderCredentialMatrixRow>,
): boolean {
  return request.providerMatrixRevision === AI_OPS_PROVIDER_MATRIX_REVISION
    && request.fromProviderRowId === fromRow.rowId
    && request.toProviderRowId === toRow.rowId
    && request.fromCredentialReference === fromRow.credentialReference
    && request.toCredentialReference === toRow.credentialReference
    && request.fromBillingDomain === fromRow.billingDomain
    && request.toBillingDomain === toRow.billingDomain;
}

function isStructurallyValidAuthorization(
  value: unknown,
  request: Readonly<AiOpsProviderTransitionRequest>,
): value is Readonly<AiOpsBillingTransitionAuthorization> {
  if (!exactKeys(value, BILLING_AUTHORIZATION_KEYS)) return false;
  return isBoundedReference(value.authorizationId, 'synthetic-owner-authorization-')
    && value.identityId === request.identityId
    && value.providerMatrixRevision === request.providerMatrixRevision
    && value.fromProviderRowId === request.fromProviderRowId
    && value.toProviderRowId === request.toProviderRowId
    && value.fromCredentialReference === request.fromCredentialReference
    && value.toCredentialReference === request.toCredentialReference
    && value.fromBillingDomain === request.fromBillingDomain
    && value.toBillingDomain === request.toBillingDomain
    && isSafeIntegerAtLeast(value.previousRevision, 0)
    && (value.previousRevision as number) < Number.MAX_SAFE_INTEGER
    && isSafeIntegerAtLeast(value.revision, 1)
    && value.revision === (value.previousRevision as number) + 1
    && isSafeIntegerAtLeast(value.readbackRevision, 1)
    && value.readbackRevision === value.revision
    && isBoundedReference(value.ownerSignatureReference, 'synthetic-signature-ref://')
    && isBoundedReference(value.approvalReceiptReference, 'approval-receipt-ref://')
    && isSafeIntegerAtLeast(value.expiresAtMs, request.nowMs + 1);
}

export function evaluateProviderTransition(
  candidate: Readonly<AiOpsProviderTransitionRequest> | unknown,
  verifier: Readonly<AiOpsBillingAuthorizationVerifier> | null = null,
): Readonly<AiOpsProviderTransitionDecision> {
  let request: Readonly<AiOpsProviderTransitionRequest>;
  try {
    request = canonicalPolicySnapshot(candidate as Readonly<AiOpsProviderTransitionRequest>);
  } catch {
    return unavailableDecision(['TRANSITION_REQUEST_SCHEMA_INVALID']);
  }
  if (!isProviderTransitionRequest(request)) {
    return unavailableDecision(['TRANSITION_REQUEST_SCHEMA_INVALID']);
  }
  const identity = AI_OPS_IDENTITIES.find((row) => row.identityId === request.identityId);
  if (!identity) {
    return unavailableDecision(['IDENTITY_UNKNOWN']);
  }
  if (identity.role === 'RESEARCH_TRADE_CONTEXT_ADVISOR' && request.toState !== 'NOT_CONFIGURED') {
    return transitionDecision(false, 'NOT_CONFIGURED', ['ADVISOR_MUST_REMAIN_NOT_CONFIGURED', 'SHADOW_SPECULATIVE_REQUIRES_PORT_RECHECK']);
  }
  const fromRow = matrixRow(request.identityId, request.fromState);
  const toRow = matrixRow(request.identityId, request.toState);
  if (fromRow === null || toRow === null || !requestBindsExactRows(request, fromRow, toRow)) {
    return unavailableDecision(['PROVIDER_MATRIX_BINDING_INVALID']);
  }
  if (
    BILLING_DOMAIN_BY_PROVIDER_STATE[request.fromState] !== request.fromBillingDomain
    || BILLING_DOMAIN_BY_PROVIDER_STATE[request.toState] !== request.toBillingDomain
  ) {
    return unavailableDecision(['PROVIDER_STATE_BILLING_TUPLE_INVALID']);
  }
  const failureTriggered = FAILURE_TRANSITION_TRIGGERS.includes(request.trigger);
  if (failureTriggered && request.toState !== 'DIAGNOSTIC_PLANE_UNAVAILABLE') {
    return unavailableDecision([
      'FAILURE_TRIGGER_REQUIRES_DIAGNOSTIC_PLANE_UNAVAILABLE',
      `TRIGGER_${request.trigger}_CANNOT_REMAIN_CONFIGURED`,
      'SILENT_PROVIDER_OR_BILLING_SWITCH_DENIED',
    ]);
  }
  if (failureTriggered) {
    return transitionDecision(true, 'DIAGNOSTIC_PLANE_UNAVAILABLE', [
      'DIAGNOSTIC_TRUTH_UNAVAILABLE_FAIL_CLOSED_CANDIDATE_VALIDATED',
      `TRIGGER_${request.trigger}_REQUIRES_UNAVAILABLE`,
      'NO_BILLING_SWITCH_PERFORMED',
      'SHADOW_SPECULATIVE_REQUIRES_PORT_RECHECK',
    ]);
  }
  if (request.trigger !== 'OWNER_REQUEST') {
    return unavailableDecision(['SILENT_PROVIDER_OR_BILLING_SWITCH_DENIED']);
  }
  const providerRouteChanges = request.fromProviderRowId !== request.toProviderRowId
    || request.fromCredentialReference !== request.toCredentialReference;
  const billingChanges = request.fromBillingDomain !== request.toBillingDomain;
  if (!providerRouteChanges && !billingChanges) {
    return transitionDecision(true, request.toState, [
      'NO_PROVIDER_ROUTE_OR_BILLING_CHANGE',
      'SHADOW_SPECULATIVE_REQUIRES_PORT_RECHECK',
    ]);
  }
  const auth = request.authorization;
  const structurallyValidAuthorization = isStructurallyValidAuthorization(auth, request);
  let authorizationVerified = false;
  if (structurallyValidAuthorization && verifier !== null) {
    try {
      authorizationVerified = verifier.verify(auth, new TextEncoder().encode(canonicalPolicyJson(auth))) === true;
    } catch {
      authorizationVerified = false;
    }
  }
  if (!structurallyValidAuthorization || !authorizationVerified) {
    return unavailableDecision([
      'EXPLICIT_OWNER_PROVIDER_AND_BILLING_AUTHORIZATION_REQUIRED',
      'SILENT_PROVIDER_OR_BILLING_SWITCH_DENIED',
    ]);
  }
  return unavailableDecision([
    'AIOPS_IR_AUTH_004_OWNER_MOUNT_REQUIRED',
    'AIOPS_IR_APPROVAL_023_ONE_USE_RECEIPT_REQUIRED',
    'OWNER_TRUSTED_TIME_AND_CURRENT_REVISION_READBACK_REQUIRED',
    'SHADOW_SPECULATIVE_CANNOT_PERFORM_PROVIDER_OR_BILLING_SWITCH',
  ]);
}

export function validateIdentityAndProviderMatrix(): readonly string[] {
  const failures: string[] = [];
  const identityIds = AI_OPS_IDENTITIES.map((row) => row.identityId);
  if (new Set(identityIds).size !== identityIds.length) failures.push('IDENTITY_IDS_NOT_UNIQUE');
  if (AI_OPS_PROVIDER_CREDENTIAL_MATRIX.length !== 16) failures.push('MATRIX_CARDINALITY_INVALID');
  const refs = AI_OPS_PROVIDER_CREDENTIAL_MATRIX
    .map((row) => row.credentialReference)
    .filter((value): value is string => value !== null);
  if (new Set(refs).size !== refs.length) failures.push('CREDENTIAL_REFERENCE_REUSED');
  const advisor = AI_OPS_IDENTITIES.find((row) => row.role === 'RESEARCH_TRADE_CONTEXT_ADVISOR');
  if (!advisor || advisor.capabilityIds.length !== 0) failures.push('ADVISOR_CAPABILITY_NOT_EMPTY');
  for (const row of AI_OPS_PROVIDER_CREDENTIAL_MATRIX) {
    if (row.credentialMaterialPresent !== false || row.paidFallbackAllowed !== false || row.authorityCreated !== false) failures.push(`UNSAFE_ROW:${row.rowId}`);
    if (row.executableCapabilityIds.length !== 0) failures.push(`FIXTURE_ROW_HAS_EXECUTABLE_CAPABILITY:${row.rowId}`);
    if (row.observedAuthMode !== 'NONE' && row.observedAuthMode !== 'UNKNOWN') failures.push(`FIXTURE_ROW_CLAIMS_OBSERVED_AUTH:${row.rowId}`);
    if (row.role === 'RESEARCH_TRADE_CONTEXT_ADVISOR' && row.providerState !== 'NOT_CONFIGURED' && row.disposition !== 'DENIED') failures.push(`ADVISOR_ROW_NOT_DENIED:${row.rowId}`);
    if (row.providerState === 'DIAGNOSTIC_PLANE_UNAVAILABLE' && row.executableCapabilityIds.length !== 0) failures.push(`UNAVAILABLE_HAS_CAPABILITY:${row.rowId}`);
  }
  return sortedUnique(failures);
}

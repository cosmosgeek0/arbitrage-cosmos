import { createHash } from 'node:crypto';
import { canonicalJson } from '../../intelligenceFoundation/contracts/ids.js';
import {
  DIAGNOSTIC_PERMISSION_LEVELS,
} from '../../productAssurance/diagnostics/boundary.js';
import { isValidUtcMillis } from '../../foundation/contracts/time.js';
import {
  PROVIDER_OPERATION_IDS,
  isBoundedIdentifier,
  isExactProviderConfigurationState,
  isExactIdentityRole,
  isLowercaseSha256,
  isPlainRecord,
  type CapabilityNegotiationRequest,
  type CapabilityNegotiationResult,
  type ProviderAdapter,
  type ProviderConfigurationState,
  type ProviderOperationId,
  type ProviderOperationRequest,
  type ProviderOperationResult,
} from './contracts.js';

const OPERATION_REQUEST_KEYS = Object.freeze([
  'schema', 'requestId', 'operation', 'caseId', 'identityRole', 'providerId', 'modelId', 'providerProtocolVersion', 'adapterVersion',
  'promptRevision', 'toolRegistryDigest', 'policyBundleDigest', 'redactionReceiptDigest', 'cancellationTokenId', 'rateLimitReservationId',
  'toolAllowlist', 'backgroundMode', 'fallbackPolicy', 'maximumTokens', 'maximumCostMicrounits', 'evidenceDigest', 'policyRevision',
  'requestedPermission', 'workflowGeneration', 'createdAtMs', 'expiresAtMs', 'deadlineAtMs',
]);
const NEGOTIATION_REQUEST_KEYS = Object.freeze([
  'schema', 'providerId', 'modelId', 'identityRole', 'requestedProtocolVersion', 'requestedAdapterVersion', 'requestedSchemaVersion', 'requestedCapabilities',
]);

type ClosedDataSnapshot = Readonly<Record<string, unknown>>;

function snapshotClosedDataRecord(value: unknown, keys: readonly string[]): ClosedDataSnapshot | null {
  try {
    if (!isPlainRecord(value)) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length
      || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) return null;

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

function snapshotBoundedIdentifierArray(value: unknown, maximumLength: number): readonly string[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined
      || !Object.hasOwn(lengthDescriptor, 'value')
      || !Number.isSafeInteger(lengthDescriptor.value)
      || (lengthDescriptor.value as number) < 0
      || (lengthDescriptor.value as number) > maximumLength
    ) return null;
    const length = lengthDescriptor.value as number;
    const ownKeys = Reflect.ownKeys(value);
    const expectedKeys = new Set<PropertyKey>(['length', ...Array.from({ length }, (_, index) => String(index))]);
    if (ownKeys.length !== expectedKeys.size || ownKeys.some((key) => !expectedKeys.has(key))) return null;

    const snapshot: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || !isBoundedIdentifier(descriptor.value)
      ) return null;
      snapshot.push(descriptor.value);
    }
    if (new Set(snapshot).size !== snapshot.length) return null;
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

export interface ProviderStateTransitionDecision {
  readonly schema: 'AI_OPS_PROVIDER_STATE_TRANSITION_DECISION_V1';
  readonly allowed: boolean;
  readonly authorityGranted: false;
  readonly from: ProviderConfigurationState;
  readonly to: ProviderConfigurationState;
  readonly reasonCodes: readonly string[];
}

export function providerOperationRequestDigest(request: Readonly<ProviderOperationRequest>): string {
  const snapshot = assertOperationRequest(request);
  return createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
}

export function snapshotProviderOperationRequest(request: unknown): Readonly<ProviderOperationRequest> | null {
  const snapshot = snapshotClosedDataRecord(request, OPERATION_REQUEST_KEYS);
  if (snapshot === null || snapshot.schema !== 'AI_OPS_PROVIDER_OPERATION_REQUEST_V1') return null;
  if (typeof snapshot.operation !== 'string' || !(PROVIDER_OPERATION_IDS as readonly string[]).includes(snapshot.operation)) return null;
  for (const [label, value] of [
    ['requestId', snapshot.requestId],
    ['caseId', snapshot.caseId],
    ['providerId', snapshot.providerId],
    ['modelId', snapshot.modelId],
    ['adapterVersion', snapshot.adapterVersion],
    ['promptRevision', snapshot.promptRevision],
    ['cancellationTokenId', snapshot.cancellationTokenId],
    ['rateLimitReservationId', snapshot.rateLimitReservationId],
    ['policyRevision', snapshot.policyRevision],
  ] as const) {
    if (!isBoundedIdentifier(value)) return null;
  }
  if (!isExactIdentityRole(snapshot.identityRole) || !isLowercaseSha256(snapshot.evidenceDigest)) return null;
  if (!isLowercaseSha256(snapshot.toolRegistryDigest)
    || !isLowercaseSha256(snapshot.policyBundleDigest)
    || !isLowercaseSha256(snapshot.redactionReceiptDigest)) return null;
  if (snapshot.providerProtocolVersion !== '1' || snapshot.backgroundMode !== 'DISABLED' || snapshot.fallbackPolicy !== 'NO_SILENT_FALLBACK') return null;
  const toolAllowlist = snapshotBoundedIdentifierArray(snapshot.toolAllowlist, 64);
  if (toolAllowlist === null) return null;
  if (!Number.isSafeInteger(snapshot.maximumTokens) || (snapshot.maximumTokens as number) < 0
    || !Number.isSafeInteger(snapshot.maximumCostMicrounits) || (snapshot.maximumCostMicrounits as number) < 0) return null;
  if (!(DIAGNOSTIC_PERMISSION_LEVELS as readonly unknown[]).includes(snapshot.requestedPermission)) return null;
  if (!Number.isSafeInteger(snapshot.workflowGeneration) || (snapshot.workflowGeneration as number) < 0) return null;
  if (
    !isValidUtcMillis(snapshot.createdAtMs)
    || !isValidUtcMillis(snapshot.expiresAtMs)
    || !isValidUtcMillis(snapshot.deadlineAtMs)
    || (snapshot.expiresAtMs as number) <= (snapshot.createdAtMs as number)
    || (snapshot.deadlineAtMs as number) < (snapshot.createdAtMs as number)
    || (snapshot.deadlineAtMs as number) > (snapshot.expiresAtMs as number)
  ) return null;

  return Object.freeze({
    ...snapshot,
    toolAllowlist,
  }) as unknown as Readonly<ProviderOperationRequest>;
}

function assertOperationRequest(request: unknown): Readonly<ProviderOperationRequest> {
  const snapshot = snapshotProviderOperationRequest(request);
  if (snapshot === null) throw new TypeError('provider operation request invalid');
  return snapshot;
}

function unavailableResult(
  operation: ProviderOperationId,
  requestId: string,
  configurationState: ProviderConfigurationState,
  additionalReasonCodes: readonly string[] = Object.freeze([]),
): Readonly<ProviderOperationResult> {
  return Object.freeze({
    schema: 'AI_OPS_PROVIDER_OPERATION_RESULT_V1',
    requestId,
    operation,
    accepted: false,
    authorityGranted: false,
    configurationState,
    providerRunId: null,
    usage: null,
    responseProvenance: null,
    backgroundJobId: null,
    circuitState: 'OPEN_NOT_CONFIGURED',
    retentionReadback: 'UNKNOWN_BLOCKED',
    fallbackUsed: false,
    redactionVerified: false,
    reasonCodes: Object.freeze([
      ...additionalReasonCodes,
      configurationState === 'DIAGNOSTIC_PLANE_UNAVAILABLE' ? 'DIAGNOSTIC_PLANE_UNAVAILABLE' : 'PROVIDER_NOT_CONFIGURED',
      'PRESTAGE_PROVIDER_ACTIVATION_FORBIDDEN',
    ]),
  });
}

export function createPrestageProviderAdapter(input: Readonly<{
  providerId: string;
  configurationState: 'NOT_CONFIGURED' | 'DIAGNOSTIC_PLANE_UNAVAILABLE';
}>): Readonly<ProviderAdapter> {
  const adapterConfiguration = snapshotClosedDataRecord(input, ['providerId', 'configurationState']);
  if (adapterConfiguration === null || !isBoundedIdentifier(adapterConfiguration.providerId)) {
    throw new TypeError('providerId must be a bounded identifier');
  }
  if (adapterConfiguration.configurationState !== 'NOT_CONFIGURED' && adapterConfiguration.configurationState !== 'DIAGNOSTIC_PLANE_UNAVAILABLE') {
    throw new TypeError('prestage adapter may only represent fail-closed provider states');
  }
  const providerId = adapterConfiguration.providerId;
  const configurationState = adapterConfiguration.configurationState;

  const dispatch = (operation: ProviderOperationId, request: unknown): Promise<Readonly<ProviderOperationResult>> => {
    const snapshot = snapshotProviderOperationRequest(request);
    if (snapshot === null) {
      return Promise.resolve(unavailableResult(
        operation,
        'INVALID_EXTERNAL_ENVELOPE',
        configurationState,
        Object.freeze(['PROVIDER_OPERATION_REQUEST_INVALID']),
      ));
    }
    if (snapshot.operation !== operation) {
      return Promise.resolve(unavailableResult(
        operation,
        snapshot.requestId,
        configurationState,
        Object.freeze(['PROVIDER_OPERATION_METHOD_MISMATCH']),
      ));
    }
    if (snapshot.providerId !== providerId) {
      return Promise.resolve(unavailableResult(
        operation,
        snapshot.requestId,
        configurationState,
        Object.freeze(['PROVIDER_ADAPTER_SUBJECT_MISMATCH']),
      ));
    }
    return Promise.resolve(unavailableResult(operation, snapshot.requestId, configurationState));
  };

  return Object.freeze({
    schema: 'AI_OPS_PROVIDER_ADAPTER_V1',
    providerId,
    configurationState,
    activationAllowed: false,
    adapterVersion: 'a3-prestage-v1',
    diagnose: (request: Readonly<ProviderOperationRequest>) => dispatch('diagnose', request),
    continue: (request: Readonly<ProviderOperationRequest>) => dispatch('continue', request),
    cancel: (request: Readonly<ProviderOperationRequest>) => dispatch('cancel', request),
    status: (request: Readonly<ProviderOperationRequest>) => dispatch('status', request),
    usage: (request: Readonly<ProviderOperationRequest>) => dispatch('usage', request),
    health: (request: Readonly<ProviderOperationRequest>) => dispatch('health', request),
  });
}

export function negotiatePrestageProviderCapabilities(
  request: Readonly<CapabilityNegotiationRequest>,
): Readonly<CapabilityNegotiationResult> {
  const snapshot = snapshotClosedDataRecord(request, NEGOTIATION_REQUEST_KEYS);
  const requestedCapabilities = snapshot === null ? null : snapshotBoundedIdentifierArray(snapshot.requestedCapabilities, 64);
  const valid = snapshot !== null
    && snapshot.schema === 'AI_OPS_CAPABILITY_NEGOTIATION_REQUEST_V1'
    && isBoundedIdentifier(snapshot.providerId)
    && isBoundedIdentifier(snapshot.modelId)
    && isExactIdentityRole(snapshot.identityRole)
    && isBoundedIdentifier(snapshot.requestedAdapterVersion)
    && snapshot.requestedProtocolVersion === '1'
    && snapshot.requestedSchemaVersion === '1'
    && requestedCapabilities !== null;
  return Object.freeze({
    schema: 'AI_OPS_CAPABILITY_NEGOTIATION_RESULT_V1',
    negotiated: false,
    authorityGranted: false,
    protocolVersion: null,
    adapterVersion: null,
    schemaVersion: null,
    capabilities: Object.freeze([]) as readonly [],
    reasonCodes: Object.freeze([
      ...(valid ? [] : ['CAPABILITY_NEGOTIATION_REQUEST_INVALID']),
      'PROVIDER_NOT_CONFIGURED',
      'PRESTAGE_NEGOTIATION_CANNOT_ACTIVATE_PROVIDER',
    ]),
  });
}

export function evaluatePrestageProviderStateTransition(
  from: ProviderConfigurationState,
  to: ProviderConfigurationState,
): Readonly<ProviderStateTransitionDecision> {
  if (!isExactProviderConfigurationState(from) || !isExactProviderConfigurationState(to)) {
    throw new TypeError('provider transition states must use the exact five-state vocabulary');
  }
  let allowed = false;
  const reasons: string[] = [];
  if (from === to && (from === 'NOT_CONFIGURED' || from === 'DIAGNOSTIC_PLANE_UNAVAILABLE')) {
    allowed = true;
    reasons.push('NO_STATE_CHANGE');
  } else if (from === to) {
    reasons.push('PRESTAGE_PROVIDER_ACTIVATION_FORBIDDEN');
  } else if (to === 'NOT_CONFIGURED') {
    allowed = true;
    reasons.push('FAIL_CLOSED_DEACTIVATION');
  } else if (to === 'DIAGNOSTIC_PLANE_UNAVAILABLE') {
    allowed = true;
    reasons.push('FAIL_CLOSED_UNAVAILABLE_PROJECTION');
  } else {
    reasons.push('PRESTAGE_PROVIDER_ACTIVATION_FORBIDDEN');
    if (
      (from === 'SUBSCRIPTION_CODEX_WORKER' || from === 'SUBSCRIPTION_CLAUDE_CODE_WORKER')
      && to === 'API_CONFIGURED'
    ) {
      reasons.push('SILENT_BILLING_SWITCH_FORBIDDEN');
    }
    if (from === 'API_CONFIGURED' && (to === 'SUBSCRIPTION_CODEX_WORKER' || to === 'SUBSCRIPTION_CLAUDE_CODE_WORKER')) {
      reasons.push('SILENT_ACCOUNT_SWITCH_FORBIDDEN');
    }
  }

  return Object.freeze({
    schema: 'AI_OPS_PROVIDER_STATE_TRANSITION_DECISION_V1',
    allowed,
    authorityGranted: false,
    from,
    to,
    reasonCodes: Object.freeze(reasons),
  });
}

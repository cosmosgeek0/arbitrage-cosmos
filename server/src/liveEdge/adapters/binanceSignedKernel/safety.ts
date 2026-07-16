import { types as utilTypes } from 'node:util';

import {
  createStructuredFailure,
  type StructuredFailure,
} from '../../../foundation/contracts/failures.js';
import { isCanonicalFoundationCorrelationId } from './identity.js';

/**
 * Closed, deterministic failure vocabulary for the L03 construction-only
 * boundary. Callers select a code and supply identity/time facts; every other
 * public field is fixed here so an upstream exception can never become an
 * operator-facing message.
 */
export const SAFE_FAILURE_CODES = Object.freeze([
  'INPUT_REJECTED',
  'CONTRACT_REJECTED',
  'CONTRACT_NOT_FOUND',
  'CONTRACT_NOT_CURRENT',
  'CONTRACT_NOT_REST',
  'CONTRACT_NOT_SIGNABLE',
  'CONTRACT_SCOPE_MISMATCH',
  'PARAMETERS_REJECTED',
  'PAYLOAD_LIMIT_EXCEEDED',
  'SIGNING_REJECTED',
  'SIGNER_FAILURE_CONTAINED',
  'SIGNER_OUTPUT_REJECTED',
  'CLOCK_SAMPLE_REJECTED',
  'CLOCK_EVIDENCE_UNAVAILABLE',
  'CLOCK_EVIDENCE_STALE',
  'CLOCK_SKEW_BLOCKED',
  'RATE_CLAIM_UNAVAILABLE',
  'RATE_OBSERVATION_REJECTED',
  'RATE_BUDGET_EXHAUSTED',
  'RATE_COOLDOWN_ACTIVE',
  'IDENTITY_REJECTED',
  'SEQUENCE_REJECTED',
  'MUTATION_AMBIGUOUS',
  'AUTOMATIC_RESUBMISSION_BLOCKED',
  'STATE_TRANSITION_REJECTED',
  'INTERNAL_FAILURE_CONTAINED',
] as const);

export type SafeFailureCode = (typeof SAFE_FAILURE_CODES)[number];

export interface SafeFailureInput {
  readonly code: SafeFailureCode;
  /** Injected UTC milliseconds; this module never reads a clock. */
  readonly occurredAtMs: number;
  readonly correlationId: string;
}

interface FailureDefinition {
  readonly stage: string;
  readonly message: string;
  readonly safeCurrentState: string;
  readonly recommendedOperatorAction: string;
}

const SAFE_FAILURE_DEFINITIONS: Readonly<Record<SafeFailureCode, Readonly<FailureDefinition>>> = Object.freeze({
  INPUT_REJECTED: Object.freeze({
    stage: 'input-validation',
    message: 'Signed-kernel input was rejected by the closed safety policy.',
    safeCurrentState: 'UNCHANGED',
    recommendedOperatorAction: 'Correct the bounded input before constructing another request.',
  }),
  CONTRACT_REJECTED: Object.freeze({
    stage: 'contract-validation',
    message: 'The documentary contract did not pass the signed-kernel gate.',
    safeCurrentState: 'NOT_CONSTRUCTED',
    recommendedOperatorAction: 'Use an exact validated current L02 contract.',
  }),
  CONTRACT_NOT_FOUND: Object.freeze({
    stage: 'contract-resolution',
    message: 'The requested documentary contract is unavailable.',
    safeCurrentState: 'NOT_CONSTRUCTED',
    recommendedOperatorAction: 'Select a contract ID present in the accepted L02 matrix.',
  }),
  CONTRACT_NOT_CURRENT: Object.freeze({
    stage: 'contract-resolution',
    message: 'The requested documentary contract is not current.',
    safeCurrentState: 'NOT_CONSTRUCTED',
    recommendedOperatorAction: 'Select a current contract with complete official evidence.',
  }),
  CONTRACT_NOT_REST: Object.freeze({
    stage: 'contract-resolution',
    message: 'The requested documentary contract is not an eligible REST contract.',
    safeCurrentState: 'NOT_CONSTRUCTED',
    recommendedOperatorAction: 'Select the exact current REST contract for this construction path.',
  }),
  CONTRACT_NOT_SIGNABLE: Object.freeze({
    stage: 'contract-resolution',
    message: 'The requested documentary contract has no proved signing posture.',
    safeCurrentState: 'NOT_CONSTRUCTED',
    recommendedOperatorAction: 'Resolve signing evidence before enabling construction.',
  }),
  CONTRACT_SCOPE_MISMATCH: Object.freeze({
    stage: 'contract-resolution',
    message: 'The requested product or environment does not match the documentary contract.',
    safeCurrentState: 'NOT_CONSTRUCTED',
    recommendedOperatorAction: 'Use a contract from the exact intended product and environment.',
  }),
  PARAMETERS_REJECTED: Object.freeze({
    stage: 'canonical-serialization',
    message: 'Request parameters were rejected by canonical serialization.',
    safeCurrentState: 'NOT_CONSTRUCTED',
    recommendedOperatorAction: 'Correct the closed parameter set before construction.',
  }),
  PAYLOAD_LIMIT_EXCEEDED: Object.freeze({
    stage: 'canonical-serialization',
    message: 'The canonical signing payload exceeded a reviewed safety bound.',
    safeCurrentState: 'NOT_CONSTRUCTED',
    recommendedOperatorAction: 'Reduce the bounded parameter set before construction.',
  }),
  SIGNING_REJECTED: Object.freeze({
    stage: 'signing',
    message: 'The requested signer policy was rejected.',
    safeCurrentState: 'UNSIGNED',
    recommendedOperatorAction: 'Use the exact signer policy selected by the documentary contract.',
  }),
  SIGNER_FAILURE_CONTAINED: Object.freeze({
    stage: 'signing',
    message: 'The injected signer did not produce a usable result.',
    safeCurrentState: 'UNSIGNED',
    recommendedOperatorAction: 'Inspect the credential-owning signer through its private operational boundary.',
  }),
  SIGNER_OUTPUT_REJECTED: Object.freeze({
    stage: 'signing',
    message: 'The injected signer returned an invalid bounded result.',
    safeCurrentState: 'UNSIGNED',
    recommendedOperatorAction: 'Correct the credential-owning signer implementation before retrying.',
  }),
  CLOCK_SAMPLE_REJECTED: Object.freeze({
    stage: 'clock-estimation',
    message: 'A clock sample was rejected by the monotonic evidence policy.',
    safeCurrentState: 'CLOCK_UNAVAILABLE',
    recommendedOperatorAction: 'Provide a fresh bounded sample with valid monotonic timing.',
  }),
  CLOCK_EVIDENCE_UNAVAILABLE: Object.freeze({
    stage: 'clock-estimation',
    message: 'Clock evidence is insufficient for signed construction.',
    safeCurrentState: 'CLOCK_UNAVAILABLE',
    recommendedOperatorAction: 'Collect the required owner-authorized time evidence.',
  }),
  CLOCK_EVIDENCE_STALE: Object.freeze({
    stage: 'clock-estimation',
    message: 'Clock evidence is stale for signed construction.',
    safeCurrentState: 'CLOCK_UNAVAILABLE',
    recommendedOperatorAction: 'Collect a fresh owner-authorized clock sample.',
  }),
  CLOCK_SKEW_BLOCKED: Object.freeze({
    stage: 'clock-estimation',
    message: 'Observed clock skew exceeds the reviewed construction bound.',
    safeCurrentState: 'CLOCK_SKEWED',
    recommendedOperatorAction: 'Correct clock synchronization and collect fresh evidence.',
  }),
  RATE_CLAIM_UNAVAILABLE: Object.freeze({
    stage: 'rate-budget',
    message: 'The exact endpoint rate claim is unavailable.',
    safeCurrentState: 'RATE_UNKNOWN',
    recommendedOperatorAction: 'Resolve the endpoint rate evidence before construction.',
  }),
  RATE_OBSERVATION_REJECTED: Object.freeze({
    stage: 'rate-budget',
    message: 'A rate or cooldown observation was rejected.',
    safeCurrentState: 'RATE_BLOCKED',
    recommendedOperatorAction: 'Provide a valid bounded observation from the exact rate scope.',
  }),
  RATE_BUDGET_EXHAUSTED: Object.freeze({
    stage: 'rate-budget',
    message: 'The exact endpoint rate budget is exhausted.',
    safeCurrentState: 'RATE_EXHAUSTED',
    recommendedOperatorAction: 'Wait for proved budget availability; do not bypass the rate gate.',
  }),
  RATE_COOLDOWN_ACTIVE: Object.freeze({
    stage: 'rate-budget',
    message: 'The exact rate scope remains in cooldown.',
    safeCurrentState: 'COOLDOWN',
    recommendedOperatorAction: 'Wait until the proved cooldown boundary before a new read-only decision.',
  }),
  IDENTITY_REJECTED: Object.freeze({
    stage: 'identity',
    message: 'Deterministic request identity construction was rejected.',
    safeCurrentState: 'NOT_CONSTRUCTED',
    recommendedOperatorAction: 'Correct the stable identity inputs before construction.',
  }),
  SEQUENCE_REJECTED: Object.freeze({
    stage: 'identity',
    message: 'The injected monotonic request sequence was rejected.',
    safeCurrentState: 'NOT_CONSTRUCTED',
    recommendedOperatorAction: 'Provide the next valid monotonic sequence value.',
  }),
  MUTATION_AMBIGUOUS: Object.freeze({
    stage: 'ambiguity',
    message: 'A submitted mutation has an unknown venue outcome.',
    safeCurrentState: 'RECONCILIATION_REQUIRED',
    recommendedOperatorAction: 'Reconcile the deterministic client-order identity before any further action.',
  }),
  AUTOMATIC_RESUBMISSION_BLOCKED: Object.freeze({
    stage: 'ambiguity',
    message: 'Automatic mutation resubmission is mechanically blocked.',
    safeCurrentState: 'RECONCILIATION_REQUIRED',
    recommendedOperatorAction: 'Obtain owner-produced reconciliation evidence before a new action.',
  }),
  STATE_TRANSITION_REJECTED: Object.freeze({
    stage: 'ambiguity',
    message: 'The requested transport-state transition is invalid.',
    safeCurrentState: 'UNCHANGED',
    recommendedOperatorAction: 'Apply only a transition allowed by the closed ambiguity policy.',
  }),
  INTERNAL_FAILURE_CONTAINED: Object.freeze({
    stage: 'internal-boundary',
    message: 'An internal operation failed within the safe construction boundary.',
    safeCurrentState: 'BLOCKED',
    recommendedOperatorAction: 'Inspect the owning component without exposing upstream failure detail.',
  }),
});

export const SAFE_DIAGNOSTIC_SCHEMA = 'BINANCE_SIGNED_KERNEL_SAFE_DIAGNOSTIC_V1' as const;

export const SAFE_DIAGNOSTIC_BOUNDS = Object.freeze({
  maximumDepth: 6,
  maximumNodes: 128,
  maximumObjectKeys: 32,
  maximumArrayLength: 32,
  maximumStringLength: 128,
});

export const SAFE_DIAGNOSTIC_SENTINELS = Object.freeze({
  ACCESSOR: '[UNAVAILABLE:ACCESSOR]',
  ARRAY_LIMIT: '[UNAVAILABLE:ARRAY_LIMIT]',
  CYCLE: '[UNAVAILABLE:CYCLE]',
  DEPTH_LIMIT: '[UNAVAILABLE:DEPTH_LIMIT]',
  DESCRIPTOR: '[UNAVAILABLE:DESCRIPTOR]',
  INSPECTION: '[UNAVAILABLE:INSPECTION]',
  KEY_LIMIT: '[UNAVAILABLE:KEY_LIMIT]',
  NODE_LIMIT: '[UNAVAILABLE:NODE_LIMIT]',
  PROXY: '[UNAVAILABLE:PROXY]',
  STRING_LIMIT: '[UNAVAILABLE:STRING_LIMIT]',
  UNSAFE_TEXT: '[UNAVAILABLE:UNSAFE_TEXT]',
  UNSUPPORTED: '[UNAVAILABLE:UNSUPPORTED]',
} as const);

/** Every retained metadata key is explicit; unknown and private keys vanish. */
export const SAFE_DIAGNOSTIC_KEYS = Object.freeze([
  'attempt',
  'automaticRetry',
  'clientOrderId',
  'code',
  'condition',
  'contractId',
  'correlationId',
  'count',
  'detail',
  'details',
  'dimension',
  'dimensions',
  'environment',
  'fingerprint',
  'httpStatus',
  'interval',
  'item',
  'items',
  'kind',
  'lifecycle',
  'limit',
  'maximum',
  'metadata',
  'minimum',
  'mutationClass',
  'observations',
  'observedAtMs',
  'offsetMs',
  'operationKind',
  'product',
  'rateKind',
  'rateScope',
  'realm',
  'reasonCode',
  'reconciliationRequired',
  'recvWindowMs',
  'remaining',
  'requestId',
  'retryAfterMs',
  'retryAtMs',
  'retryable',
  'rttMs',
  'sampleCount',
  'scope',
  'sequence',
  'stage',
  'state',
  'statusCode',
  'timestampMs',
  'transport',
  'used',
] as const);

export type SafeDiagnosticStatus = 'EXACT' | 'SANITIZED' | 'BOUNDED';
export type SafeDiagnosticScalar = null | boolean | number | string;
export type SafeDiagnosticValue =
  | SafeDiagnosticScalar
  | readonly SafeDiagnosticValue[]
  | Readonly<{ readonly [key: string]: SafeDiagnosticValue }>;

export interface SafeDiagnosticProjection {
  readonly schema: typeof SAFE_DIAGNOSTIC_SCHEMA;
  readonly status: SafeDiagnosticStatus;
  readonly data: SafeDiagnosticValue;
}

interface ProjectionState {
  nodes: number;
  sanitized: boolean;
  bounded: boolean;
}

const FAILURE_INPUT_KEYS = ['code', 'occurredAtMs', 'correlationId'] as const;
const MAXIMUM_UTC_MS = 4_102_444_800_000;
const SAFE_REQUEST_ID = /^(?:lrq_[0-9a-f]{32}|rq_L03_[0-9]{12})$/;
const SAFE_CLIENT_ORDER_ID = /^cx-[0-9a-f]{24}-(?:0|[1-9][0-9]{0,2})$/;
const SAFE_CONTRACT_ID = /^(?:SPOT|USDM|MARGIN)_[A-Z0-9][A-Z0-9_.-]{1,122}$/;
const SAFE_FINGERPRINT = /^[0-9a-f]{32}$/;
const SAFE_ENUM_TEXT = /^[A-Z][A-Z0-9_]{0,62}$/;
const OPAQUE_SECRET_TEXT = /^[A-Za-z0-9]{64}$/;
const SAFE_ENUM_KEYS = [
  'code',
  'condition',
  'dimension',
  'environment',
  'interval',
  'kind',
  'lifecycle',
  'mutationClass',
  'operationKind',
  'product',
  'rateKind',
  'rateScope',
  'realm',
  'reasonCode',
  'scope',
  'stage',
  'state',
  'transport',
] as const;
const SENSITIVE_KEY_FRAGMENTS = [
  'account',
  'apikey',
  'authorization',
  'balance',
  'body',
  'cause',
  'credential',
  'listenkey',
  'listentoken',
  'message',
  'payload',
  'query',
  'secret',
  'signature',
  'signedpayload',
  'stack',
  'token',
  'upstream',
  'url',
  'uri',
] as const;

function codePointCompare(left: string, right: string): number {
  const leftPoints = left[Symbol.iterator]();
  const rightPoints = right[Symbol.iterator]();
  while (true) {
    const leftPoint = leftPoints.next();
    const rightPoint = rightPoints.next();
    if (leftPoint.done || rightPoint.done) {
      if (leftPoint.done === rightPoint.done) return 0;
      return leftPoint.done ? -1 : 1;
    }
    const leftCode = leftPoint.value.codePointAt(0) ?? 0;
    const rightCode = rightPoint.value.codePointAt(0) ?? 0;
    if (leftCode !== rightCode) return leftCode - rightCode;
  }
}

function sensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function allowedDiagnosticKey(key: string): boolean {
  return (SAFE_DIAGNOSTIC_KEYS as readonly string[]).includes(key) && !sensitiveKey(key);
}

function safeDiagnosticString(key: string | null, value: string): boolean {
  if (OPAQUE_SECRET_TEXT.test(value)) return false;
  if (key === 'correlationId') return isCanonicalFoundationCorrelationId(value);
  if (key === 'requestId') return SAFE_REQUEST_ID.test(value);
  if (key === 'clientOrderId') return SAFE_CLIENT_ORDER_ID.test(value);
  if (key === 'contractId') return SAFE_CONTRACT_ID.test(value);
  if (key === 'fingerprint') return SAFE_FINGERPRINT.test(value);
  return key !== null
    && (SAFE_ENUM_KEYS as readonly string[]).includes(key)
    && SAFE_ENUM_TEXT.test(value);
}

function fixedInputError(): TypeError {
  return new TypeError('createSafeFailure: input must be exact bounded own data');
}

function exactFailureInput(value: unknown): SafeFailureInput {
  if (typeof value !== 'object' || value === null || utilTypes.isProxy(value)) throw fixedInputError();
  try {
    if (Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
        || Object.getOwnPropertySymbols(value).length !== 0) throw fixedInputError();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort(codePointCompare);
    if (keys.length !== FAILURE_INPUT_KEYS.length
        || keys.some((key) => !(FAILURE_INPUT_KEYS as readonly string[]).includes(key))) {
      throw fixedInputError();
    }
    const values: Record<string, unknown> = {};
    for (const key of FAILURE_INPUT_KEYS) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw fixedInputError();
      values[key] = descriptor.value;
    }
    return values as unknown as SafeFailureInput;
  } catch {
    throw fixedInputError();
  }
}

interface UncheckedFailureFacts {
  readonly code: unknown;
  readonly occurredAtMs: unknown;
  readonly correlationId: unknown;
}

function validateFailureFacts(input: UncheckedFailureFacts): asserts input is SafeFailureInput {
  if (typeof input.code !== 'string' || !(SAFE_FAILURE_CODES as readonly string[]).includes(input.code)) {
    throw new TypeError('createSafeFailure: code is not in the closed failure vocabulary');
  }
  if (typeof input.occurredAtMs !== 'number' || !Number.isSafeInteger(input.occurredAtMs)
      || input.occurredAtMs < 0 || input.occurredAtMs > MAXIMUM_UTC_MS) {
    throw new TypeError('createSafeFailure: occurredAtMs is invalid');
  }
  if (!isCanonicalFoundationCorrelationId(input.correlationId)) {
    throw new TypeError('createSafeFailure: correlationId is invalid');
  }
}

export function createSafeFailure(input: SafeFailureInput): Readonly<StructuredFailure>;
export function createSafeFailure(
  code: SafeFailureCode,
  occurredAtMs: number,
  correlationId: string,
): Readonly<StructuredFailure>;
export function createSafeFailure(
  inputOrCode: SafeFailureInput | SafeFailureCode,
  suppliedOccurredAtMs?: number,
  suppliedCorrelationId?: string,
): Readonly<StructuredFailure> {
  const input = typeof inputOrCode === 'string'
    ? { code: inputOrCode, occurredAtMs: suppliedOccurredAtMs, correlationId: suppliedCorrelationId }
    : exactFailureInput(inputOrCode);
  validateFailureFacts(input);
  const definition = SAFE_FAILURE_DEFINITIONS[input.code];
  return createStructuredFailure({
    component: 'liveEdge.adapters.binanceSignedKernel',
    stage: definition.stage,
    code: input.code,
    message: definition.message,
    occurredAt: input.occurredAtMs,
    retryable: false,
    safeCurrentState: definition.safeCurrentState,
    recommendedOperatorAction: definition.recommendedOperatorAction,
    correlationId: input.correlationId,
  });
}

function markSanitized(state: ProjectionState, sentinel: string): string {
  state.sanitized = true;
  return sentinel;
}

function markBounded(state: ProjectionState, sentinel: string): string {
  state.bounded = true;
  return sentinel;
}

function projectArray(
  value: readonly unknown[],
  depth: number,
  state: ProjectionState,
  ancestors: Set<object>,
  field: string | null,
): SafeDiagnosticValue {
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return markSanitized(state, SAFE_DIAGNOSTIC_SENTINELS.UNSUPPORTED);
    }
    if (value.length > SAFE_DIAGNOSTIC_BOUNDS.maximumArrayLength) {
      return markBounded(state, SAFE_DIAGNOSTIC_SENTINELS.ARRAY_LIMIT);
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      return markSanitized(state, SAFE_DIAGNOSTIC_SENTINELS.DESCRIPTOR);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const allowedKeys = new Set(['length']);
    for (let index = 0; index < value.length; index += 1) allowedKeys.add(String(index));
    if (Object.keys(descriptors).some((key) => !allowedKeys.has(key))) {
      return markSanitized(state, SAFE_DIAGNOSTIC_SENTINELS.DESCRIPTOR);
    }
    const projected: SafeDiagnosticValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      projected.push(!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
        ? markSanitized(state, SAFE_DIAGNOSTIC_SENTINELS.ACCESSOR)
        : projectValue(descriptor.value, depth + 1, state, ancestors, field));
    }
    return Object.freeze(projected);
  } catch {
    return markSanitized(state, SAFE_DIAGNOSTIC_SENTINELS.INSPECTION);
  }
}

function projectRecord(
  value: object,
  depth: number,
  state: ProjectionState,
  ancestors: Set<object>,
): SafeDiagnosticValue {
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return markSanitized(state, SAFE_DIAGNOSTIC_SENTINELS.UNSUPPORTED);
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      return markSanitized(state, SAFE_DIAGNOSTIC_SENTINELS.DESCRIPTOR);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort(codePointCompare);
    if (keys.length > SAFE_DIAGNOSTIC_BOUNDS.maximumObjectKeys) {
      return markBounded(state, SAFE_DIAGNOSTIC_SENTINELS.KEY_LIMIT);
    }
    const projected: Record<string, SafeDiagnosticValue> = {};
    for (const key of keys) {
      if (!allowedDiagnosticKey(key)) {
        state.sanitized = true;
        continue;
      }
      const descriptor = descriptors[key];
      projected[key] = !descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
        ? markSanitized(state, SAFE_DIAGNOSTIC_SENTINELS.ACCESSOR)
        : projectValue(descriptor.value, depth + 1, state, ancestors, key);
    }
    return Object.freeze(projected);
  } catch {
    return markSanitized(state, SAFE_DIAGNOSTIC_SENTINELS.INSPECTION);
  }
}

function projectValue(
  value: unknown,
  depth: number,
  state: ProjectionState,
  ancestors: Set<object>,
  field: string | null,
): SafeDiagnosticValue {
  if (state.nodes >= SAFE_DIAGNOSTIC_BOUNDS.maximumNodes) {
    return markBounded(state, SAFE_DIAGNOSTIC_SENTINELS.NODE_LIMIT);
  }
  state.nodes += 1;
  if (depth > SAFE_DIAGNOSTIC_BOUNDS.maximumDepth) {
    return markBounded(state, SAFE_DIAGNOSTIC_SENTINELS.DEPTH_LIMIT);
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && !Object.is(value, -0)
      ? value
      : markSanitized(state, SAFE_DIAGNOSTIC_SENTINELS.UNSUPPORTED);
  }
  if (typeof value === 'string') {
    if (value.length > SAFE_DIAGNOSTIC_BOUNDS.maximumStringLength) {
      return markBounded(state, SAFE_DIAGNOSTIC_SENTINELS.STRING_LIMIT);
    }
    return safeDiagnosticString(field, value)
      ? value
      : markSanitized(state, SAFE_DIAGNOSTIC_SENTINELS.UNSAFE_TEXT);
  }
  if ((typeof value === 'object' || typeof value === 'function') && utilTypes.isProxy(value)) {
    return markSanitized(state, SAFE_DIAGNOSTIC_SENTINELS.PROXY);
  }
  if (typeof value !== 'object' || value === null) {
    return markSanitized(state, SAFE_DIAGNOSTIC_SENTINELS.UNSUPPORTED);
  }
  if (ancestors.has(value)) return markSanitized(state, SAFE_DIAGNOSTIC_SENTINELS.CYCLE);
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? projectArray(value, depth, state, ancestors, field)
      : projectRecord(value, depth, state, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Converts arbitrary diagnostic input into an exact three-field, deeply
 * frozen public projection. It never reads a property value directly: only
 * ordinary own data descriptors can be retained. Proxy traps and getters are
 * therefore not invoked, including for revoked proxies and Error causes.
 */
export function projectSafeDiagnostic(value: unknown): Readonly<SafeDiagnosticProjection> {
  const state: ProjectionState = { nodes: 0, sanitized: false, bounded: false };
  const data = projectValue(value, 0, state, new Set<object>(), null);
  return Object.freeze({
    schema: SAFE_DIAGNOSTIC_SCHEMA,
    status: state.bounded ? 'BOUNDED' : state.sanitized ? 'SANITIZED' : 'EXACT',
    data,
  });
}

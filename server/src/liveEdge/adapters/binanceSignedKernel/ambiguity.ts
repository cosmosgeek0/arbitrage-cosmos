import { types as nodeUtilTypes } from 'node:util';

import {
  isTransportOutcome,
  type TransportOutcome,
} from '../../../foundation/contracts/exchange.js';

/**
 * Pure documentary state for one deterministic signed mutation attempt.
 *
 * This reducer does not submit, persist, reconcile, or emit Foundation
 * execution events. It only preserves what the caller has already observed
 * and provides a narrow hand-off hint to the canonical owners.
 */

export const REQUEST_ATTEMPT_SCHEMA = 'BINANCE_SIGNED_REQUEST_ATTEMPT_V1' as const;

export const REQUEST_ATTEMPT_STAGES = Object.freeze([
  'PRE_SEND',
  'NOT_SENT',
  'SUBMITTED',
  'ACKNOWLEDGED',
  'REJECTED',
  'UNKNOWN',
  'TERMINAL_OBSERVED',
] as const);

export type RequestAttemptStage = (typeof REQUEST_ATTEMPT_STAGES)[number];

export const NO_DISPATCH_PROOF_CODES = Object.freeze([
  'REQUEST_CONSTRUCTION_REJECTED',
  'PRE_DISPATCH_POLICY_BLOCKED',
  'TRANSPORT_NOT_INVOKED',
] as const);

export type NoDispatchProofCode = (typeof NO_DISPATCH_PROOF_CODES)[number];

export const AMBIGUITY_CAUSES = Object.freeze([
  'TRANSPORT_TIMEOUT',
  'TRANSPORT_DISCONNECTED',
  'HTTP_408',
  'HTTP_5XX',
  'TRANSPORT_AMBIGUOUS',
  'TRANSPORT_ABORTED_AFTER_DISPATCH',
  'MALFORMED_RESPONSE_AFTER_DISPATCH',
  'INCOMPLETE_SUCCESS_RESPONSE',
] as const);

export type AmbiguityCause = (typeof AMBIGUITY_CAUSES)[number];

export type CanonicalOwnerGuidance =
  | 'NONE'
  | 'READ_ONLY_QUERY_BY_CLIENT_ORDER_ID'
  | 'HAND_OFF_TERMINAL_OBSERVATION';

export interface RequestAttemptState {
  readonly schema: typeof REQUEST_ATTEMPT_SCHEMA;
  readonly version: 1;
  readonly operationClass: 'MUTATION';
  readonly requestId: string;
  readonly clientOrderId: string;
  readonly stage: RequestAttemptStage;
  readonly revision: number;
  readonly submitCount: 0 | 1;
  readonly transportOutcome: TransportOutcome | null;
  readonly httpStatus: number | null;
  readonly ambiguityCause: AmbiguityCause | null;
  readonly noDispatchProof: NoDispatchProofCode | null;
  readonly terminalEvidenceRef: string | null;
  readonly reconciliationRequired: boolean;
  readonly duplicateSendBlocked: boolean;
  readonly automaticResubmission: false;
}

export interface CreateRequestAttemptInput {
  readonly requestId: string;
  readonly clientOrderId: string;
}

export type RequestAttemptEvent =
  | { readonly kind: 'SUBMIT' }
  | { readonly kind: 'PROVE_NOT_SENT'; readonly proofCode: NoDispatchProofCode }
  | {
      readonly kind: 'TRANSPORT_OBSERVED';
      readonly outcome: TransportOutcome;
      readonly httpStatus: number | null;
      readonly disconnected: boolean;
    }
  | {
      readonly kind: 'TERMINAL_EVIDENCE_REFERENCED';
      readonly evidenceRef: string;
    };

export type RequestAttemptRejectReason =
  | 'STATE_INVALID'
  | 'STATE_BOUND'
  | 'EVENT_INVALID'
  | 'TRANSITION_NOT_ALLOWED'
  | 'DUPLICATE_SUBMIT_BLOCKED';

export type RequestAttemptReducerResult =
  | {
      readonly applied: true;
      readonly state: Readonly<RequestAttemptState>;
    }
  | {
      readonly applied: false;
      readonly state: Readonly<RequestAttemptState> | null;
      readonly reasonCode: RequestAttemptRejectReason;
    };

export interface RequestAttemptMappingGuidance {
  readonly transportOutcome: TransportOutcome | null;
  readonly reconciliationRequired: boolean;
  readonly queryByDeterministicClientOrderId: boolean;
  readonly duplicateSendBlocked: boolean;
  readonly automaticResubmission: false;
  readonly canonicalOwnerGuidance: CanonicalOwnerGuidance;
}

type DataRecord = Readonly<Record<string, unknown>>;

const STATE_FIELDS = Object.freeze([
  'schema',
  'version',
  'operationClass',
  'requestId',
  'clientOrderId',
  'stage',
  'revision',
  'submitCount',
  'transportOutcome',
  'httpStatus',
  'ambiguityCause',
  'noDispatchProof',
  'terminalEvidenceRef',
  'reconciliationRequired',
  'duplicateSendBlocked',
  'automaticResubmission',
] as const);

const REQUEST_ID_PATTERN = /^lrq_[0-9a-f]{32}$/;
const CLIENT_ORDER_ID_PATTERN = /^cx-[0-9a-f]{24}-(?:0|[1-9][0-9]{0,2})$/;
const EVIDENCE_REFERENCE_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;
const CREDENTIAL_SHAPED_OPAQUE_TEXT = /^[A-Za-z0-9]{64}$/;
const MAXIMUM_STATE_REVISION = 1_000_000;

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

/**
 * Snapshot only own data properties. Accessors, inherited values, symbols,
 * unexpected fields, throwing proxies, and revoked proxies fail closed.
 */
function snapshotDataRecord(value: unknown, maximumFields: number): DataRecord | null {
  try {
    if (typeof value !== 'object' || value === null) return null;
    // Node's native proxy predicate does not invoke userland traps. Reject
    // active and revoked proxies before Array/Object/descriptor inspection.
    if (nodeUtilTypes.isProxy(value)) return null;
    if (Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > maximumFields || keys.some((key) => typeof key !== 'string')) {
      return null;
    }
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const field of keys as string[]) {
      const descriptor = descriptors[field];
      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      snapshot[field] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function hasExactFields(record: DataRecord, fields: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === fields.length && keys.every((key) => fields.includes(key));
}

function snapshotClosedDataRecord(value: unknown, fields: readonly string[]): DataRecord | null {
  const snapshot = snapshotDataRecord(value, fields.length);
  return snapshot !== null && hasExactFields(snapshot, fields) ? snapshot : null;
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

function validClientOrderId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_ORDER_ID_PATTERN.test(value);
}

function validEvidenceReference(value: unknown): value is string {
  return typeof value === 'string'
    && EVIDENCE_REFERENCE_PATTERN.test(value)
    && !CREDENTIAL_SHAPED_OPAQUE_TEXT.test(value);
}

function validHttpStatus(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 100 && value <= 599);
}

function validAmbiguityTuple(
  outcome: unknown,
  httpStatus: unknown,
  cause: unknown,
): boolean {
  if (!isTransportOutcome(outcome) || !validHttpStatus(httpStatus) || !includes(AMBIGUITY_CAUSES, cause)) {
    return false;
  }
  if (cause === 'TRANSPORT_DISCONNECTED') return true;
  if (cause === 'HTTP_408') return httpStatus === 408;
  if (cause === 'HTTP_5XX') return typeof httpStatus === 'number' && httpStatus >= 500;
  if (httpStatus === 408 || (typeof httpStatus === 'number' && httpStatus >= 500)) return false;
  if (cause === 'TRANSPORT_TIMEOUT') return outcome === 'TIMEOUT';
  if (cause === 'TRANSPORT_AMBIGUOUS') return outcome === 'AMBIGUOUS';
  if (cause === 'TRANSPORT_ABORTED_AFTER_DISPATCH') return outcome === 'ABORTED';
  if (cause === 'MALFORMED_RESPONSE_AFTER_DISPATCH') return outcome === 'MALFORMED';
  return cause === 'INCOMPLETE_SUCCESS_RESPONSE'
    && outcome === 'SUCCESS'
    && (httpStatus === null || httpStatus < 200 || httpStatus > 299);
}

function validTerminalHistory(outcome: unknown, httpStatus: unknown, cause: unknown): boolean {
  if (outcome === null && httpStatus === null && cause === null) return true;
  if (cause !== null) return validAmbiguityTuple(outcome, httpStatus, cause);
  if (outcome === 'SUCCESS') {
    return typeof httpStatus === 'number' && httpStatus >= 200 && httpStatus <= 299;
  }
  return outcome === 'REJECTED' && typeof httpStatus === 'number'
    && httpStatus >= 400 && httpStatus <= 499 && httpStatus !== 408;
}

function stageInvariants(record: DataRecord): boolean {
  const stage = record.stage as RequestAttemptStage;
  const submitCount = record.submitCount;
  const outcome = record.transportOutcome;
  const httpStatus = record.httpStatus;
  const cause = record.ambiguityCause;
  const proof = record.noDispatchProof;
  const terminalRef = record.terminalEvidenceRef;
  const reconciliationRequired = record.reconciliationRequired;
  const duplicateSendBlocked = record.duplicateSendBlocked;

  if (stage === 'PRE_SEND') {
    return submitCount === 0 && outcome === null && httpStatus === null && cause === null && proof === null
      && terminalRef === null && reconciliationRequired === false && duplicateSendBlocked === false;
  }
  if (stage === 'NOT_SENT') {
    return submitCount === 0 && outcome === null && httpStatus === null && cause === null
      && includes(NO_DISPATCH_PROOF_CODES, proof) && terminalRef === null
      && reconciliationRequired === false && duplicateSendBlocked === false;
  }
  if (submitCount !== 1 || duplicateSendBlocked !== true) return false;
  if (proof !== null && !includes(NO_DISPATCH_PROOF_CODES, proof)) return false;
  if (stage === 'SUBMITTED') {
    return outcome === null && httpStatus === null && cause === null && terminalRef === null
      && reconciliationRequired === false;
  }
  if (stage === 'ACKNOWLEDGED') {
    return outcome === 'SUCCESS' && typeof httpStatus === 'number' && httpStatus >= 200 && httpStatus <= 299
      && cause === null && terminalRef === null && reconciliationRequired === false;
  }
  if (stage === 'REJECTED') {
    return outcome === 'REJECTED' && typeof httpStatus === 'number' && httpStatus >= 400 && httpStatus <= 499
      && httpStatus !== 408 && cause === null && terminalRef === null && reconciliationRequired === false;
  }
  if (stage === 'UNKNOWN') {
    return validAmbiguityTuple(outcome, httpStatus, cause) && terminalRef === null
      && reconciliationRequired === true;
  }
  return stage === 'TERMINAL_OBSERVED' && validEvidenceReference(terminalRef)
    && validTerminalHistory(outcome, httpStatus, cause)
    // A reference label is not reconciliation proof. Preserve ambiguity until
    // a canonical owner independently resolves it in a later phase.
    && reconciliationRequired === (cause !== null);
}

function validatedState(value: unknown): Readonly<RequestAttemptState> | null {
  const record = snapshotClosedDataRecord(value, STATE_FIELDS);
  if (record === null
    || record.schema !== REQUEST_ATTEMPT_SCHEMA
    || record.version !== 1
    || record.operationClass !== 'MUTATION'
    || !validRequestId(record.requestId)
    || !validClientOrderId(record.clientOrderId)
    || !includes(REQUEST_ATTEMPT_STAGES, record.stage)
    || typeof record.revision !== 'number'
    || !Number.isSafeInteger(record.revision)
    || record.revision < 0
    || record.revision > MAXIMUM_STATE_REVISION
    || (record.submitCount !== 0 && record.submitCount !== 1)
    || (record.transportOutcome !== null && !isTransportOutcome(record.transportOutcome))
    || !validHttpStatus(record.httpStatus)
    || (record.ambiguityCause !== null && !includes(AMBIGUITY_CAUSES, record.ambiguityCause))
    || (record.noDispatchProof !== null && !includes(NO_DISPATCH_PROOF_CODES, record.noDispatchProof))
    || (record.terminalEvidenceRef !== null && !validEvidenceReference(record.terminalEvidenceRef))
    || typeof record.reconciliationRequired !== 'boolean'
    || typeof record.duplicateSendBlocked !== 'boolean'
    || record.automaticResubmission !== false
    || !stageInvariants(record)) {
    return null;
  }
  // Never return the caller's container. Even a valid state may be mutable or
  // use unusual property attributes; reduce it to one canonical frozen shape.
  return Object.freeze({
    schema: REQUEST_ATTEMPT_SCHEMA,
    version: 1 as const,
    operationClass: 'MUTATION' as const,
    requestId: record.requestId as string,
    clientOrderId: record.clientOrderId as string,
    stage: record.stage as RequestAttemptStage,
    revision: record.revision as number,
    submitCount: record.submitCount as 0 | 1,
    transportOutcome: record.transportOutcome as TransportOutcome | null,
    httpStatus: record.httpStatus as number | null,
    ambiguityCause: record.ambiguityCause as AmbiguityCause | null,
    noDispatchProof: record.noDispatchProof as NoDispatchProofCode | null,
    terminalEvidenceRef: record.terminalEvidenceRef as string | null,
    reconciliationRequired: record.reconciliationRequired as boolean,
    duplicateSendBlocked: record.duplicateSendBlocked as boolean,
    automaticResubmission: false as const,
  });
}

function stateFrom(
  state: Readonly<RequestAttemptState>,
  update: Partial<RequestAttemptState>,
): Readonly<RequestAttemptState> {
  return Object.freeze({
    ...state,
    ...update,
    revision: state.revision + 1,
    automaticResubmission: false as const,
  });
}

function accepted(state: Readonly<RequestAttemptState>): RequestAttemptReducerResult {
  return Object.freeze({ applied: true as const, state });
}

function rejected(
  state: Readonly<RequestAttemptState> | null,
  reasonCode: RequestAttemptRejectReason,
): RequestAttemptReducerResult {
  return Object.freeze({ applied: false as const, state, reasonCode });
}

function ambiguityCauseFor(
  outcome: TransportOutcome,
  httpStatus: number | null,
  disconnected: boolean,
): AmbiguityCause | null {
  if (disconnected) return 'TRANSPORT_DISCONNECTED';
  if (httpStatus === 408) return 'HTTP_408';
  if (httpStatus !== null && httpStatus >= 500) return 'HTTP_5XX';
  if (outcome === 'TIMEOUT') return 'TRANSPORT_TIMEOUT';
  if (outcome === 'AMBIGUOUS') return 'TRANSPORT_AMBIGUOUS';
  if (outcome === 'ABORTED') return 'TRANSPORT_ABORTED_AFTER_DISPATCH';
  if (outcome === 'MALFORMED') return 'MALFORMED_RESPONSE_AFTER_DISPATCH';
  if (outcome === 'SUCCESS' && (httpStatus === null || httpStatus < 200 || httpStatus > 299)) {
    return 'INCOMPLETE_SUCCESS_RESPONSE';
  }
  return null;
}

function transportEvent(record: DataRecord): DataRecord | null {
  if (!hasExactFields(record, ['kind', 'outcome', 'httpStatus', 'disconnected'])
    || record.kind !== 'TRANSPORT_OBSERVED' || !isTransportOutcome(record.outcome)
    || !validHttpStatus(record.httpStatus) || typeof record.disconnected !== 'boolean') {
    return null;
  }
  return record;
}

/** Create the immutable PRE_SEND state for exactly one deterministic mutation identity. */
export function createRequestAttempt(input: CreateRequestAttemptInput): Readonly<RequestAttemptState> {
  const record = snapshotClosedDataRecord(input, ['requestId', 'clientOrderId']);
  if (record === null || !validRequestId(record.requestId) || !validClientOrderId(record.clientOrderId)) {
    throw new TypeError('request attempt identity is invalid');
  }
  return Object.freeze({
    schema: REQUEST_ATTEMPT_SCHEMA,
    version: 1 as const,
    operationClass: 'MUTATION' as const,
    requestId: record.requestId,
    clientOrderId: record.clientOrderId,
    stage: 'PRE_SEND' as const,
    revision: 0,
    submitCount: 0 as const,
    transportOutcome: null,
    httpStatus: null,
    ambiguityCause: null,
    noDispatchProof: null,
    terminalEvidenceRef: null,
    reconciliationRequired: false,
    duplicateSendBlocked: false,
    automaticResubmission: false as const,
  });
}

/**
 * Reduce one closed observation. Every rejected transition preserves the
 * canonical state bytes without exposing the caller's container; duplicate
 * submission is a dedicated rejection.
 */
export function reduceRequestAttempt(stateValue: unknown, eventValue: unknown): RequestAttemptReducerResult {
  const state = validatedState(stateValue);
  if (state === null) return rejected(null, 'STATE_INVALID');

  const event = snapshotDataRecord(eventValue, 4);
  if (event === null) return rejected(state, 'EVENT_INVALID');
  if (state.revision === MAXIMUM_STATE_REVISION) return rejected(state, 'STATE_BOUND');

  if (event.kind === 'SUBMIT' && hasExactFields(event, ['kind'])) {
    if (state.stage !== 'PRE_SEND' && state.stage !== 'NOT_SENT') {
      return rejected(state, 'DUPLICATE_SUBMIT_BLOCKED');
    }
    return accepted(stateFrom(state, {
      stage: 'SUBMITTED',
      submitCount: 1,
      transportOutcome: null,
      httpStatus: null,
      ambiguityCause: null,
      terminalEvidenceRef: null,
      reconciliationRequired: false,
      duplicateSendBlocked: true,
    }));
  }

  if (event.kind === 'PROVE_NOT_SENT' && hasExactFields(event, ['kind', 'proofCode'])) {
    if (!includes(NO_DISPATCH_PROOF_CODES, event.proofCode)) return rejected(state, 'EVENT_INVALID');
    if (state.stage !== 'PRE_SEND') return rejected(state, 'TRANSITION_NOT_ALLOWED');
    return accepted(stateFrom(state, {
      stage: 'NOT_SENT',
      noDispatchProof: event.proofCode,
      reconciliationRequired: false,
      duplicateSendBlocked: false,
    }));
  }

  const observed = transportEvent(event);
  if (observed !== null) {
    if (state.stage !== 'SUBMITTED') return rejected(state, 'TRANSITION_NOT_ALLOWED');
    const outcome = observed.outcome as TransportOutcome;
    const httpStatus = observed.httpStatus as number | null;
    const cause = ambiguityCauseFor(outcome, httpStatus, observed.disconnected as boolean);
    if (cause !== null) {
      return accepted(stateFrom(state, {
        stage: 'UNKNOWN',
        transportOutcome: outcome,
        httpStatus,
        ambiguityCause: cause,
        reconciliationRequired: true,
        duplicateSendBlocked: true,
      }));
    }
    if (outcome === 'SUCCESS' && httpStatus !== null && httpStatus >= 200 && httpStatus <= 299) {
      return accepted(stateFrom(state, {
        stage: 'ACKNOWLEDGED',
        transportOutcome: outcome,
        httpStatus,
        ambiguityCause: null,
        reconciliationRequired: false,
        duplicateSendBlocked: true,
      }));
    }
    if (outcome === 'REJECTED' && httpStatus !== null && httpStatus >= 400 && httpStatus <= 499) {
      return accepted(stateFrom(state, {
        stage: 'REJECTED',
        transportOutcome: outcome,
        httpStatus,
        ambiguityCause: null,
        reconciliationRequired: false,
        duplicateSendBlocked: true,
      }));
    }
    return rejected(state, 'EVENT_INVALID');
  }

  if (event.kind === 'TERMINAL_EVIDENCE_REFERENCED'
    && hasExactFields(event, ['kind', 'evidenceRef'])) {
    if (!validEvidenceReference(event.evidenceRef)) {
      return rejected(state, 'EVENT_INVALID');
    }
    if (!['SUBMITTED', 'ACKNOWLEDGED', 'REJECTED', 'UNKNOWN'].includes(state.stage)) {
      return rejected(state, 'TRANSITION_NOT_ALLOWED');
    }
    return accepted(stateFrom(state, {
      stage: 'TERMINAL_OBSERVED',
      terminalEvidenceRef: event.evidenceRef,
      reconciliationRequired: state.reconciliationRequired,
      duplicateSendBlocked: true,
    }));
  }

  return rejected(state, 'EVENT_INVALID');
}

/**
 * Narrow adapter guidance only. This intentionally contains neither a
 * ReconciliationStatus nor an execution-event shape.
 */
export function requestAttemptMappingGuidance(stateValue: unknown): Readonly<RequestAttemptMappingGuidance> {
  const state = validatedState(stateValue);
  if (state === null) throw new TypeError('request attempt state is invalid');
  const canonicalOwnerGuidance: CanonicalOwnerGuidance = state.stage === 'UNKNOWN'
    ? 'READ_ONLY_QUERY_BY_CLIENT_ORDER_ID'
    : state.stage === 'TERMINAL_OBSERVED'
      ? 'HAND_OFF_TERMINAL_OBSERVATION'
      : 'NONE';
  return Object.freeze({
    transportOutcome: state.transportOutcome,
    reconciliationRequired: state.reconciliationRequired,
    queryByDeterministicClientOrderId: state.reconciliationRequired,
    duplicateSendBlocked: state.duplicateSendBlocked,
    automaticResubmission: false as const,
    canonicalOwnerGuidance,
  });
}

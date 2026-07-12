import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import {
  canonicalJson,
  deriveClientOrderId,
  isValidClientOrderId,
  LEG_LIFECYCLES,
  RECONCILIATION_RECOMMENDATIONS,
} from '../../../foundation/contracts/index.js';
import {
  deepFreezePrivate,
  privateAccountRealmReference,
  privateArray,
  privateIdentifier,
  privateInteger,
  privateRecord,
  privateString,
  snapshotPrivateData,
} from '../binancePrivateTruth/bounds.js';
import { validatePrivateLifecycleWitness } from '../binancePrivateTruth/lifecycleBinding.js';
import { validatePrivateTruthProjection } from '../binancePrivateTruth/projection.js';
import { createWaitingPrivateTruthBinding } from '../binancePrivateTruth/waiting.js';
import { createSpotRealmBoundRevision } from '../binancePrivateTruth/spotLifecycle.js';
import {
  createUsdmRealmBoundRevision,
  mapUsdmPrivateEventSemantics,
} from '../binancePrivateTruth/usdmLifecycle.js';
import {
  compareJournalQuantities,
  maximumJournalQuantity,
  normalizeJournalQuantity,
  sumJournalQuantities,
} from './exact.js';
import { deriveTransportRequestId } from '../binanceSignedKernel/identity.js';
import {
  requestAttemptMappingGuidance,
  type RequestAttemptState,
} from '../binanceSignedKernel/ambiguity.js';
import type {
  InstrumentSizingResult,
  InstrumentSizingTransformation,
} from '../binanceInstrumentSpecs/types.js';
import {
  FOUNDATION_MUTATION_EFFECTS,
  FOUNDATION_RECONCILIATION_STATUSES,
  L06_APPEND_ACK_SCHEMA,
  L06_APPEND_REQUEST_SCHEMA,
  L06_MATRIX_SHA256,
  L06_MUTATION_ENTRY_SCHEMA,
  L06_MUTATION_JOURNAL_SCHEMA,
  L06_RECONCILIATION_HANDOFF_SCHEMA,
  L06_SYNTHETIC_BOUNDARY_SCHEMA,
  MUTATION_AMBIGUITY_CAUSES,
  MUTATION_APPEND_DISPOSITIONS,
  MUTATION_CONTRACT_STATES,
  MUTATION_ENTRY_KINDS,
  MUTATION_JOURNAL_LIMITS,
  MUTATION_KINDS,
  MUTATION_PRODUCTS,
  PRIVATE_ORDER_STATUSES,
  type ConfirmMutationAppendResult,
  type CreateMutationJournalInput,
  type FoundationMutationEffect,
  type FoundationReconciliationObservedPayload,
  type FoundationPrivateReconciliationSummary,
  type FoundationReconciledLegSummary,
  type FoundationReconciliationResultSummary,
  type FoundationReconciliationStatus,
  type HttpObservedPayload,
  type MutationAmbiguityCause,
  type MutationAppendAcknowledgement,
  type MutationAppendRequest,
  type MutationContractState,
  type MutationEntryKind,
  type MutationEntryPayload,
  type MutationEvidenceBindings,
  type MutationIdentityGraph,
  type MutationJournalEntry,
  type MutationJournalSnapshot,
  type MutationKind,
  type MutationObservationInput,
  type ObservationIdConflictPayload,
  type MutationProduct,
  type MutationProjection,
  type MutationReconciliationHandoff,
  type PersistedMutationJournal,
  type PreparedMutationAppend,
  type PrepareObservationAppendResult,
  type PrivateFillObservedPayload,
  type PrivateOrderObservedPayload,
  type SubmissionObservedPayload,
  type SyntheticSubmissionBoundaryDecision,
  type TelemetryDegradedPayload,
} from './types.js';

const MAX_UTC_MS = 4_102_444_800_000;
const CORRELATION_ID = /^cor_[0-9a-f]{16}$/;
const ASSESSMENT_ID = /^(?:assessment[:._-]|asm_)[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const DECISION_ID = /^cdec_[0-9a-f]{16}$/;
const PROPOSAL_ID = /^cprop_[0-9a-f]{16}$/;
const CAPITAL_MANDATE_ID = /^cmdt_[0-9a-f]{32}$/;
const CAPITAL_RESERVATION_ID = /^cres_[0-9a-f]{32}$/;
const FOUNDATION_PLAN_ID = /^plan_[0-9a-f]{16}$/;
const FOUNDATION_LEG_ID = /^leg_[0-9a-f]{16}$/;
const L03_REQUEST_ID = /^lrq_[0-9a-f]{32}$/;
const L03_INTENT_FINGERPRINT = /^[0-9a-f]{32}$/;
const SYMBOL = /^(?=.{2,40}$)[\p{Lu}\p{N}._-]+$/u;
const REVISION = /^[A-Za-z][A-Za-z0-9._:-]{7,127}$/;
const SHA256 = /^(?:sha256:)?[0-9a-f]{64}$/;
const L04_INSTRUMENT_REVISION = /^l04-instrument-spec:[0-9a-f]{24}$/;
const L04_SOURCE_EVIDENCE_REVISION = /^l04-instrument-source-evidence:[0-9a-f]{24}$/;
const L04_REGISTRY_REVISION = /^l04-instrument-registry:[0-9a-f]{24}$/;
const L04_SNAPSHOT_REVISION = /^l04-instrument-registry-snapshot:[0-9a-f]{24}$/;
const MUTATION_ID = /^l06mut_[0-9a-f]{64}$/;
const ENTRY_ID = /^l06entry_[0-9a-f]{64}$/;
const OBSERVATION_ID = /^l06obs_[0-9a-f]{64}$/;
const CONTENT_REVISION = /^l06content_[0-9a-f]{64}$/;
const HEAD_DIGEST = /^l06head_[0-9a-f]{64}$/;
const OUTCOME_REVISION = /^l06outcome_[0-9a-f]{64}$/;
const APPEND_DIGEST = /^l06append_[0-9a-f]{64}$/;
const BOUNDARY_ID = /^l06boundary_[0-9a-f]{64}$/;
const FOUNDATION_RESULT_REVISION = /^foundation-reconciliation-result:[0-9a-f]{24,64}$/;
const L06_FOUNDATION_RESULT_CONTENT_REVISION = /^l06foundation_[0-9a-f]{64}$/;
const PRIVATE_SOURCE_CUT_REVISION = /^l05pcut_[0-9a-f]{64}$/;
const SPOT_REST_CUT_REVISION = /^spot_rest_[0-9a-f]{32}$/;
const USDM_REST_CUT_REVISION = /^usdm_rest_[0-9a-f]{32}$/;
const L05_LIFECYCLE_REVISION = /^l05lifecycle_[0-9a-f]{64}$/;
const SPOT_PRIVATE_EVENT_REVISION = /^spot_event_[0-9a-f]{32}$/;
const SPOT_PRIVATE_CONTENT_REVISION = /^spot_content_[0-9a-f]{32}$/;
const USDM_PRIVATE_EVENT_REVISION = /^usdm_event_[0-9a-f]{32}$/;
const USDM_PRIVATE_CONTENT_REVISION = /^usdm_content_[0-9a-f]{32}$/;
const VENUE_ORDER_ID = /^[0-9]{1,32}$/;
const TRADE_ID = /^[0-9]{1,32}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_.:-]{0,95}$/;

const IDENTITY_FIELDS = Object.freeze([
  'globalCorrelationId', 'assessmentId', 'decisionId', 'strategyId', 'proposalId',
  'capitalMandateId', 'capitalReservationId', 'ticketId', 'legId', 'requestId',
  'requestSequence', 'intentFingerprint', 'signerProfile',
  'clientOrderId', 'attempt', 'product', 'environment', 'accountRealmId', 'symbol',
  'mutationKind', 'contractId', 'contractState',
] as const);
const BINDING_FIELDS = Object.freeze([
  'instrumentRevision', 'sourceEvidenceRevision', 'snapshotRevision',
  'registryRevision',
  'referenceEvidenceRevision', 'preflightContentRevision', 'sanitizedRequestContentHash',
  'preflightResultQuantity', 'preflightResultNotional', 'preflightNotionalAsset',
  'preflightCanaryMaximumNotional',
  'privateProjectionRevision', 'privateSourceCutRevision', 'lifecycleRevisions',
  'foundationReconciliationResultRevision', 'capitalMandateRevision',
  'riskVerdictRevision', 'regimeAdvisoryRevision', 'regimePostureState',
  'sourceExchangeEventAtMs', 'sourceLocalReceiveAtMs', 'featuresReadyAtMs',
  'decisionAtMs', 'approvalAtMs', 'timingEvidenceRevision',
  'exchangeClockCalibrationRevision',
  'preflightEvaluatedAtMs', 'privateEvaluatedAtMs',
  'validUntilMs', 'preflightState',
] as const);
const ENTRY_FIELDS = Object.freeze([
  'schema', 'version', 'entryId', 'mutationId', 'observationId', 'journalVersion',
  'previousHeadDigest', 'kind', 'occurredAtMs', 'receivedAtMs', 'sourceRevision',
  'payload', 'contentRevision',
] as const);
const SNAPSHOT_FIELDS = Object.freeze([
  'schema', 'version', 'mutationId', 'identity', 'bindings', 'requestedQuantity',
  'journalVersion', 'entries', 'projection', 'headDigest', 'outcomeRevision',
  'persistenceProven', 'persistenceAuthority', 'reconciliationAuthority',
  'capitalAuthority', 'riskAuthority', 'actionAuthority',
  'externalActionAuthorization',
] as const);
const PROJECTION_FIELDS = Object.freeze([
  'lifecycle', 'submissionIntentPresent', 'submissionObserved', 'httpAcknowledged',
  'httpRejectedResponseSeen', 'partialMixed', 'ambiguityCauses', 'workingStatus',
  'cumulativeFilledQuantity', 'venueOrderId', 'tradeIds', 'terminalStatus',
  'reconciliationStatus', 'reconciliationEffect', 'reconciled', 'recoveryRequired',
  'telemetryDegraded', 'externalTruthRefs', 'conflictCodes', 'evidenceOnly',
] as const);
const REQUEST_FIELDS = Object.freeze([
  'schema', 'version', 'ownerTarget', 'mutationId', 'entryId', 'idempotencyKey',
  'expectedJournalVersion', 'nextJournalVersion', 'previousHeadDigest',
  'entry', 'nextHeadDigest', 'nextOutcomeRevision', 'entryContentRevision',
  'appendRequestDigest', 'externalActionAuthorization',
] as const);
const ACK_FIELDS = Object.freeze([
  'schema', 'version', 'owner', 'disposition', 'mutationId', 'entryId',
  'idempotencyKey', 'appendRequestDigest', 'expectedJournalVersion',
  'committedJournalVersion', 'previousHeadDigest', 'committedHeadDigest',
  'committedOutcomeRevision', 'appendedCount', 'ledgerEventId', 'committedAtMs',
  'failureCode', 'externalActionAuthorization',
] as const);

function digest(prefix: string, value: unknown): string {
  return `${prefix}${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function assertSerializedByteBound(value: unknown, maximum: number, label: string): void {
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > maximum) {
    throw new RangeError(`${label} exceeds its canonical UTF-8 byte bound`);
  }
}

export function isMutationTelemetryAppendCapacityAvailable(
  journalVersionValue: unknown,
  telemetryEntryCountValue: unknown,
): boolean {
  const journalVersion = privateInteger(
    journalVersionValue,
    'telemetry capacity journal version',
    0,
    MUTATION_JOURNAL_LIMITS.maximumEntries,
  );
  const telemetryEntryCount = privateInteger(
    telemetryEntryCountValue,
    'telemetry capacity entry count',
    0,
    MUTATION_JOURNAL_LIMITS.maximumTelemetryEntries,
  );
  return journalVersion < MUTATION_JOURNAL_LIMITS.maximumEntries
      - MUTATION_JOURNAL_LIMITS.reservedMoneyCriticalEntries
    && telemetryEntryCount < MUTATION_JOURNAL_LIMITS.maximumTelemetryEntries;
}

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function compareCodeUnits(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

const BOUNDED_OBSERVATION_ENTRY_COUNTS: Readonly<Partial<Record<MutationEntryKind, number>>> =
  Object.freeze({
    HTTP_OBSERVED: MUTATION_JOURNAL_LIMITS.maximumHttpEntries,
    PRIVATE_ORDER_OBSERVED: MUTATION_JOURNAL_LIMITS.maximumPrivateOrderEntries,
    PRIVATE_FILL_OBSERVED: MUTATION_JOURNAL_LIMITS.maximumPrivateFillEntries,
    FOUNDATION_RECONCILIATION_OBSERVED: MUTATION_JOURNAL_LIMITS.maximumReconciliationEntries,
    OBSERVATION_ID_CONFLICT: MUTATION_JOURNAL_LIMITS.maximumObservationIdentityConflictEntries,
    TELEMETRY_DEGRADED: MUTATION_JOURNAL_LIMITS.maximumTelemetryEntries,
  });

function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= 0 && value <= MAX_UTC_MS;
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Readonly<Record<string, unknown>> {
  const snapshot = snapshotPrivateData(value);
  return privateRecord(snapshot, fields, label);
}

function revision(value: unknown, label: string, pattern = REVISION): string {
  const normalized = privateIdentifier(value, label);
  if (!pattern.test(normalized)) throw new TypeError(`${label} namespace mismatch`);
  return normalized;
}

function optionalVenueOrderId(value: unknown, label: string): string | null {
  if (value === null) return null;
  const normalized = privateString(value, label, 32);
  if (!VENUE_ORDER_ID.test(normalized)) throw new TypeError(`${label} must be a decimal string`);
  return normalized;
}

function requiredVenueOrderId(value: unknown, label: string): string {
  const orderId = optionalVenueOrderId(value, label);
  if (orderId === null) throw new TypeError(`${label} is required`);
  return orderId;
}

function normalizedSymbol(value: unknown): string {
  const symbol = privateString(value, 'mutation symbol', 40);
  if (symbol.normalize('NFC') !== symbol || !SYMBOL.test(symbol)) {
    throw new TypeError('mutation symbol must already use canonical L04 form');
  }
  return symbol;
}

function expectedContract(
  product: MutationProduct,
  kind: MutationKind,
): Readonly<{ id: string; state: MutationContractState }> {
  if (kind === 'CANCEL_REPLACE') {
    return Object.freeze({
      id: 'UNAVAILABLE_L02_CONTRACT_GAP_CANCEL_REPLACE',
      state: 'UNAVAILABLE_L02_CONTRACT_GAP',
    });
  }
  if (kind === 'PLACE_ORDER') {
    if (product === 'SPOT') return Object.freeze({ id: 'SPOT_ORDER_POST', state: 'CURRENT' });
    if (product === 'USD_M_PERPETUAL') return Object.freeze({ id: 'USDM_ORDER_POST', state: 'CURRENT' });
    return Object.freeze({ id: 'MARGIN_ORDER_POST_SCOPE_CONFLICT', state: 'OFFICIAL_DOC_CONFLICT' });
  }
  if (product === 'SPOT') return Object.freeze({ id: 'SPOT_ORDER_CANCEL', state: 'CURRENT' });
  if (product === 'USD_M_PERPETUAL') return Object.freeze({ id: 'USDM_ORDER_CANCEL', state: 'CURRENT' });
  return Object.freeze({ id: 'MARGIN_ORDER_CANCEL', state: 'CURRENT' });
}

function normalizeIdentity(value: unknown): Readonly<MutationIdentityGraph> {
  const record = exactRecord(value, IDENTITY_FIELDS, 'mutation identity');
  const globalCorrelationId = privateIdentifier(record.globalCorrelationId, 'global correlation ID');
  const assessmentId = record.assessmentId === null
    ? null
    : privateIdentifier(record.assessmentId, 'assessment ID');
  const decisionId = privateIdentifier(record.decisionId, 'decision ID');
  const proposalId = privateIdentifier(record.proposalId, 'proposal ID');
  const capitalMandateId = privateIdentifier(record.capitalMandateId, 'Capital mandate ID');
  const capitalReservationId = privateIdentifier(record.capitalReservationId, 'Capital reservation ID');
  const ticketId = privateIdentifier(record.ticketId, 'Foundation ticket/plan ID');
  const legId = privateIdentifier(record.legId, 'Foundation leg ID');
  const requestId = privateIdentifier(record.requestId, 'L03 request ID');
  const requestSequence = privateInteger(record.requestSequence, 'L03 request sequence', 0, 999_999);
  const intentFingerprint = privateString(record.intentFingerprint, 'L03 intent fingerprint', 32);
  const clientOrderId = privateString(record.clientOrderId, 'client order ID', 36);
  const attempt = privateInteger(record.attempt, 'mutation attempt', 0, 999);
  if (!CORRELATION_ID.test(globalCorrelationId)
    || (assessmentId !== null && !ASSESSMENT_ID.test(assessmentId))
    || !DECISION_ID.test(decisionId)
    || !PROPOSAL_ID.test(proposalId)
    || !CAPITAL_MANDATE_ID.test(capitalMandateId)
    || !CAPITAL_RESERVATION_ID.test(capitalReservationId)
    || !FOUNDATION_PLAN_ID.test(ticketId)
    || !FOUNDATION_LEG_ID.test(legId)
    || !L03_REQUEST_ID.test(requestId)
    || !L03_INTENT_FINGERPRINT.test(intentFingerprint)
    || !isValidClientOrderId(clientOrderId)
    || deriveClientOrderId({ planId: ticketId, legId, attempt }) !== clientOrderId) {
    throw new TypeError('mutation identity graph contains a noncanonical owner identity');
  }
  if (record.strategyId !== 'BASIS' && record.strategyId !== 'VOLUME') {
    throw new TypeError('strategy owner identity is invalid');
  }
  if (!includes(MUTATION_PRODUCTS, record.product)
    || record.environment !== 'PRODUCTION'
    || !includes(MUTATION_KINDS, record.mutationKind)
    || !includes(MUTATION_CONTRACT_STATES, record.contractState)) {
    throw new TypeError('mutation product, environment, kind or contract state is invalid');
  }
  const accountRealmId = privateAccountRealmReference(record.accountRealmId);
  const symbol = normalizedSymbol(record.symbol);
  const contractId = privateIdentifier(record.contractId, 'L02 mutation contract ID');
  const expected = expectedContract(record.product, record.mutationKind);
  if (contractId !== expected.id || record.contractState !== expected.state) {
    throw new TypeError('mutation contract does not match the accepted L02 product/kind posture');
  }
  if (record.product === 'MARGIN') {
    throw new TypeError('L03 has no signed request identity for Margin mutations');
  }
  const expectedSignerProfile = record.product === 'SPOT'
    ? 'SPOT_HMAC_SHA256'
    : 'USDM_HMAC_SHA256';
  if (record.signerProfile !== expectedSignerProfile) {
    throw new TypeError('L03 signer profile does not match mutation product');
  }
  const derivedRequestIdentity = deriveTransportRequestId({
    contractId,
    product: record.product,
    environment: 'PRODUCTION',
    signerProfile: expectedSignerProfile,
    correlationId: globalCorrelationId,
    requestSequence,
    intentFingerprint,
  });
  if (derivedRequestIdentity.requestId !== requestId) {
    throw new TypeError('L03 request ID does not bind the exact mutation identity');
  }
  return deepFreezePrivate({
    globalCorrelationId,
    assessmentId,
    decisionId,
    strategyId: record.strategyId,
    proposalId,
    capitalMandateId,
    capitalReservationId,
    ticketId,
    legId,
    requestId,
    requestSequence,
    intentFingerprint,
    signerProfile: expectedSignerProfile,
    clientOrderId,
    attempt,
    product: record.product,
    environment: 'PRODUCTION' as const,
    accountRealmId,
    symbol,
    mutationKind: record.mutationKind,
    contractId,
    contractState: record.contractState,
  });
}

function nullableExactDecimal(value: unknown, label: string): string | null {
  return value === null ? null : normalizeJournalQuantity(value, label);
}

function nullableUtc(value: unknown, label: string): number | null {
  return value === null ? null : privateInteger(value, label, 0, MAX_UTC_MS);
}

function normalizePreflightResult(value: unknown): Readonly<InstrumentSizingResult> {
  const record = exactRecord(value, [
    'schema', 'staticState', 'reasonCodes', 'instrumentRevision',
    'sourceEvidenceRevision', 'registryRevision', 'snapshotRevision',
    'referenceEvidenceRevision', 'evaluatedAtMs', 'instrumentValidUntilMs',
    'referenceObservedAtMs', 'referenceValidUntilMs', 'notionalAsset',
    'requestedPrice', 'validationPrice', 'requestedQuantity', 'resultQuantity',
    'resultNotional', 'effectiveNotionalCeiling', 'transformations',
    'externalRequirements', 'canaryMaximumNotional', 'sendEligible',
    'documentaryAuthority', 'externalActionAuthorization', 'actionAuthority',
  ], 'L04 static preflight result');
  const reasons = privateArray(record.reasonCodes, 'L04 preflight reasons', 64);
  if (record.schema !== 'BINANCE_STATIC_FILTER_PREFLIGHT_V1'
    || record.staticState !== 'PASS' || reasons.length !== 0
    || record.notionalAsset !== 'USDT' || record.canaryMaximumNotional !== '10'
    || record.sendEligible !== false
    || record.documentaryAuthority !== 'DOCUMENTARY_EVIDENCE_ONLY'
    || record.externalActionAuthorization !== 'NONE'
    || record.actionAuthority !== 'NONE_RECORD_ONLY') {
    throw new TypeError('L04 preflight result is not an exact non-sendable PASS witness');
  }
  const instrumentRevision = revision(
    record.instrumentRevision,
    'L04 instrument revision',
    L04_INSTRUMENT_REVISION,
  );
  const sourceEvidenceRevision = revision(
    record.sourceEvidenceRevision,
    'L04 source evidence revision',
    L04_SOURCE_EVIDENCE_REVISION,
  );
  const registryRevision = revision(
    record.registryRevision,
    'L04 registry revision',
    L04_REGISTRY_REVISION,
  );
  const snapshotRevision = revision(
    record.snapshotRevision,
    'L04 snapshot revision',
    L04_SNAPSHOT_REVISION,
  );
  const referenceEvidenceRevision = record.referenceEvidenceRevision === null
    ? null
    : revision(record.referenceEvidenceRevision, 'L04 reference evidence revision');
  const evaluatedAtMs = privateInteger(record.evaluatedAtMs, 'L04 preflight evaluation time', 0, MAX_UTC_MS);
  const instrumentValidUntilMs = privateInteger(
    record.instrumentValidUntilMs,
    'L04 instrument validity',
    evaluatedAtMs,
    MAX_UTC_MS,
  );
  const referenceObservedAtMs = nullableUtc(record.referenceObservedAtMs, 'L04 reference observation time');
  const referenceValidUntilMs = nullableUtc(record.referenceValidUntilMs, 'L04 reference validity');
  if ((referenceEvidenceRevision === null) !== (referenceObservedAtMs === null)
    || (referenceEvidenceRevision === null) !== (referenceValidUntilMs === null)
    || (referenceObservedAtMs !== null && referenceValidUntilMs! < referenceObservedAtMs)
    || (referenceValidUntilMs !== null && referenceValidUntilMs < evaluatedAtMs)) {
    throw new TypeError('L04 reference evidence tuple is invalid');
  }
  const requestedPrice = nullableExactDecimal(record.requestedPrice, 'L04 requested price');
  const validationPrice = nullableExactDecimal(record.validationPrice, 'L04 validation price');
  const requestedQuantity = normalizeJournalQuantity(record.requestedQuantity, 'L04 requested quantity');
  const resultQuantity = normalizeJournalQuantity(record.resultQuantity, 'L04 result quantity');
  const resultNotional = normalizeJournalQuantity(record.resultNotional, 'L04 result notional');
  const effectiveNotionalCeiling = normalizeJournalQuantity(
    record.effectiveNotionalCeiling,
    'L04 effective notional ceiling',
  );
  if (validationPrice === null || compareJournalQuantities(requestedQuantity, '0') <= 0
    || compareJournalQuantities(resultQuantity, '0') <= 0
    || compareJournalQuantities(resultQuantity, requestedQuantity) > 0
    || compareJournalQuantities(resultNotional, '0') <= 0
    || compareJournalQuantities(resultNotional, effectiveNotionalCeiling) > 0
    || compareJournalQuantities(effectiveNotionalCeiling, '10') > 0) {
    throw new TypeError('L04 preflight quantity/notional invariants are invalid');
  }
  const transformations = privateArray(record.transformations, 'L04 preflight transformations', 64)
    .map((item) => {
      const transformation = exactRecord(item, ['kind', 'from', 'to', 'filterType'], 'L04 sizing transformation');
      if (transformation.kind !== 'MAX_QUANTITY_REDUCTION'
        && transformation.kind !== 'GRID_REDUCTION'
        && transformation.kind !== 'NOTIONAL_CEILING_REDUCTION') {
        throw new TypeError('L04 sizing transformation kind is invalid');
      }
      const from = normalizeJournalQuantity(transformation.from, 'L04 transformation source quantity');
      const to = normalizeJournalQuantity(transformation.to, 'L04 transformation result quantity');
      if (compareJournalQuantities(to, from) > 0) throw new TypeError('L04 transformation increases quantity');
      return deepFreezePrivate({
        kind: transformation.kind,
        from,
        to,
        filterType: transformation.filterType === null
          ? null
          : privateString(transformation.filterType, 'L04 transformation filter type', 128),
      }) as Readonly<InstrumentSizingTransformation>;
    });
  const externalRequirements = privateArray(
    record.externalRequirements,
    'L04 external requirements',
    64,
  ).map((item) => privateString(item, 'L04 external requirement', 128));
  if (new Set(externalRequirements).size !== externalRequirements.length
    || [...externalRequirements].sort().some((item, index) => item !== externalRequirements[index])) {
    throw new TypeError('L04 external requirements must be unique canonical order');
  }
  return deepFreezePrivate({
    schema: 'BINANCE_STATIC_FILTER_PREFLIGHT_V1' as const,
    staticState: 'PASS' as const,
    reasonCodes: Object.freeze([]),
    instrumentRevision,
    sourceEvidenceRevision,
    registryRevision,
    snapshotRevision,
    referenceEvidenceRevision,
    evaluatedAtMs,
    instrumentValidUntilMs,
    referenceObservedAtMs,
    referenceValidUntilMs,
    notionalAsset: 'USDT' as const,
    requestedPrice,
    validationPrice,
    requestedQuantity,
    resultQuantity,
    resultNotional,
    effectiveNotionalCeiling,
    transformations: Object.freeze(transformations),
    externalRequirements: Object.freeze(externalRequirements),
    canaryMaximumNotional: '10' as const,
    sendEligible: false as const,
    documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
  });
}

function preflightContentRevisionFor(result: Readonly<InstrumentSizingResult>): string {
  return digest('l06l04binding_', result);
}

function normalizeBindings(
  value: unknown,
  preflightResult: Readonly<InstrumentSizingResult>,
): Readonly<MutationEvidenceBindings> {
  const record = exactRecord(value, BINDING_FIELDS, 'mutation evidence bindings');
  const lifecycleValues = privateArray(record.lifecycleRevisions, 'lifecycle revisions', 3)
    .map((item) => revision(item, 'lifecycle revision', /^l05lifecycle_[0-9a-f]{64}$/));
  const lifecycleRevisions = [...new Set(lifecycleValues)].sort();
  if (lifecycleRevisions.length === 0 || lifecycleRevisions.length !== lifecycleValues.length) {
    throw new TypeError('lifecycle revisions must be non-empty and unique');
  }
  const preflightEvaluatedAtMs = privateInteger(record.preflightEvaluatedAtMs, 'preflight evaluation time', 0, MAX_UTC_MS);
  const privateEvaluatedAtMs = privateInteger(record.privateEvaluatedAtMs, 'private evaluation time', 0, MAX_UTC_MS);
  const validUntilMs = privateInteger(record.validUntilMs, 'mutation binding validity', 0, MAX_UTC_MS);
  if (record.preflightState !== 'CURRENT_NON_SENDABLE'
    || validUntilMs < preflightEvaluatedAtMs
    || validUntilMs < privateEvaluatedAtMs) {
    throw new TypeError('mutation evidence binding time/state is invalid');
  }
  const requestHash = privateString(record.sanitizedRequestContentHash, 'sanitized request content hash', 80);
  if (!SHA256.test(requestHash)) throw new TypeError('sanitized request content hash must be SHA-256');
  const preflightResultQuantity = normalizeJournalQuantity(
    record.preflightResultQuantity,
    'L04 preflight result quantity',
  );
  const preflightResultNotional = normalizeJournalQuantity(
    record.preflightResultNotional,
    'L04 preflight result notional',
  );
  if (record.preflightNotionalAsset !== 'USDT'
    || record.preflightCanaryMaximumNotional !== '10'
    || compareJournalQuantities(preflightResultQuantity, '0') <= 0
    || compareJournalQuantities(preflightResultNotional, '0') <= 0
    || compareJournalQuantities(preflightResultNotional, '10') > 0) {
    throw new TypeError('L04 preflight result does not bind the fixed 10-USDT canary');
  }
  if (record.regimePostureState !== 'UNKNOWN'
    && record.regimePostureState !== 'CURRENT_ADVISORY'
    && record.regimePostureState !== 'STALE'
    && record.regimePostureState !== 'UNSUPPORTED'
    && record.regimePostureState !== 'DISAGREEING') {
    throw new TypeError('regime posture state is invalid');
  }
  const regimeAdvisoryRevision = record.regimeAdvisoryRevision === null
    ? null
    : revision(record.regimeAdvisoryRevision, 'regime advisory revision');
  if ((record.regimePostureState === 'UNKNOWN') !== (regimeAdvisoryRevision === null)) {
    throw new TypeError('every observed regime posture requires its advisory evidence revision');
  }
  const sourceExchangeEventAtMs = nullableUtc(record.sourceExchangeEventAtMs, 'source exchange-event time');
  const sourceLocalReceiveAtMs = nullableUtc(record.sourceLocalReceiveAtMs, 'source local-receive time');
  const exchangeClockCalibrationRevision = record.exchangeClockCalibrationRevision === null
    ? null
    : revision(record.exchangeClockCalibrationRevision, 'exchange clock calibration revision');
  if ((sourceExchangeEventAtMs === null) !== (sourceLocalReceiveAtMs === null)
    || (sourceExchangeEventAtMs === null) !== (exchangeClockCalibrationRevision === null)
    || (sourceExchangeEventAtMs !== null && sourceLocalReceiveAtMs! < sourceExchangeEventAtMs)) {
    throw new TypeError('source timing/calibration tuple is invalid');
  }
  const featuresReadyAtMs = privateInteger(record.featuresReadyAtMs, 'features-ready time', 0, MAX_UTC_MS);
  const decisionAtMs = privateInteger(record.decisionAtMs, 'decision time', 0, MAX_UTC_MS);
  const approvalAtMs = privateInteger(record.approvalAtMs, 'approval time', 0, MAX_UTC_MS);
  if ((sourceLocalReceiveAtMs !== null && featuresReadyAtMs < sourceLocalReceiveAtMs)
    || decisionAtMs < featuresReadyAtMs || approvalAtMs < decisionAtMs
    || preflightEvaluatedAtMs < approvalAtMs || privateEvaluatedAtMs < approvalAtMs) {
    throw new TypeError('owner timing evidence regresses');
  }
  const expectedPreflightRevision = preflightContentRevisionFor(preflightResult);
  if (record.instrumentRevision !== preflightResult.instrumentRevision
    || record.sourceEvidenceRevision !== preflightResult.sourceEvidenceRevision
    || record.registryRevision !== preflightResult.registryRevision
    || record.snapshotRevision !== preflightResult.snapshotRevision
    || record.referenceEvidenceRevision !== preflightResult.referenceEvidenceRevision
    || record.preflightContentRevision !== expectedPreflightRevision
    || record.preflightResultQuantity !== preflightResult.resultQuantity
    || record.preflightResultNotional !== preflightResult.resultNotional
    || record.preflightNotionalAsset !== preflightResult.notionalAsset
    || record.preflightCanaryMaximumNotional !== preflightResult.canaryMaximumNotional
    || preflightEvaluatedAtMs !== preflightResult.evaluatedAtMs
    || validUntilMs > Math.min(
      preflightResult.instrumentValidUntilMs!,
      preflightResult.referenceValidUntilMs ?? preflightResult.instrumentValidUntilMs!,
    )) {
    throw new TypeError('mutation bindings do not match the exact L04 preflight result');
  }
  return deepFreezePrivate({
    instrumentRevision: revision(record.instrumentRevision, 'instrument revision'),
    sourceEvidenceRevision: revision(record.sourceEvidenceRevision, 'source evidence revision'),
    snapshotRevision: revision(record.snapshotRevision, 'snapshot revision'),
    registryRevision: revision(record.registryRevision, 'registry revision'),
    referenceEvidenceRevision: record.referenceEvidenceRevision === null
      ? null
      : revision(record.referenceEvidenceRevision, 'reference evidence revision'),
    preflightContentRevision: revision(record.preflightContentRevision, 'L06 preflight content revision'),
    preflightResultQuantity,
    preflightResultNotional,
    preflightNotionalAsset: 'USDT' as const,
    preflightCanaryMaximumNotional: '10' as const,
    sanitizedRequestContentHash: requestHash,
    privateProjectionRevision: revision(record.privateProjectionRevision, 'private projection revision', /^l05proj_[0-9a-f]{64}$/),
    privateSourceCutRevision: revision(record.privateSourceCutRevision, 'private source-cut revision', PRIVATE_SOURCE_CUT_REVISION),
    lifecycleRevisions: Object.freeze(lifecycleRevisions),
    foundationReconciliationResultRevision: revision(
      record.foundationReconciliationResultRevision,
      'Foundation reconciliation result revision',
      FOUNDATION_RESULT_REVISION,
    ),
    capitalMandateRevision: revision(record.capitalMandateRevision, 'Capital mandate revision'),
    riskVerdictRevision: revision(record.riskVerdictRevision, 'Risk verdict revision'),
    regimeAdvisoryRevision,
    regimePostureState: record.regimePostureState,
    sourceExchangeEventAtMs,
    sourceLocalReceiveAtMs,
    featuresReadyAtMs,
    decisionAtMs,
    approvalAtMs,
    timingEvidenceRevision: revision(record.timingEvidenceRevision, 'timing evidence revision'),
    exchangeClockCalibrationRevision,
    preflightEvaluatedAtMs,
    privateEvaluatedAtMs,
    validUntilMs,
    preflightState: 'CURRENT_NON_SENDABLE' as const,
  });
}

function normalizeCreateInput(value: unknown): Readonly<CreateMutationJournalInput> {
  const record = exactRecord(value, [
    'identity', 'bindings', 'preflightResult', 'requestedQuantity', 'createdAtMs',
  ], 'mutation create input');
  const identity = normalizeIdentity(record.identity);
  const preflightResult = normalizePreflightResult(record.preflightResult);
  const bindings = normalizeBindings(record.bindings, preflightResult);
  const requestedQuantity = normalizeJournalQuantity(record.requestedQuantity, 'requested quantity');
  const createdAtMs = privateInteger(record.createdAtMs, 'mutation creation time', 0, MAX_UTC_MS);
  if (compareJournalQuantities(requestedQuantity, '0') <= 0
    || requestedQuantity !== bindings.preflightResultQuantity
    || createdAtMs < bindings.preflightEvaluatedAtMs
    || createdAtMs < bindings.privateEvaluatedAtMs
    || (identity.mutationKind !== 'CANCEL_ORDER' && createdAtMs > bindings.validUntilMs)) {
    throw new TypeError('mutation creation quantity or causal cut is invalid');
  }
  return deepFreezePrivate({ identity, bindings, preflightResult, requestedQuantity, createdAtMs });
}

const L03_ATTEMPT_FIELDS = Object.freeze([
  'schema', 'version', 'operationClass', 'requestId', 'clientOrderId', 'stage',
  'revision', 'submitCount', 'transportOutcome', 'httpStatus', 'ambiguityCause',
  'noDispatchProof', 'terminalEvidenceRef', 'reconciliationRequired',
  'duplicateSendBlocked', 'automaticResubmission',
] as const);

function normalizeL03RequestAttempt(
  value: unknown,
  identity: Readonly<MutationIdentityGraph>,
): Readonly<RequestAttemptState> {
  const record = exactRecord(value, L03_ATTEMPT_FIELDS, 'L03 request attempt state');
  const attempt = {
    schema: record.schema,
    version: record.version,
    operationClass: record.operationClass,
    requestId: record.requestId,
    clientOrderId: record.clientOrderId,
    stage: record.stage,
    revision: record.revision,
    submitCount: record.submitCount,
    transportOutcome: record.transportOutcome,
    httpStatus: record.httpStatus,
    ambiguityCause: record.ambiguityCause,
    noDispatchProof: record.noDispatchProof,
    terminalEvidenceRef: record.terminalEvidenceRef,
    reconciliationRequired: record.reconciliationRequired,
    duplicateSendBlocked: record.duplicateSendBlocked,
    automaticResubmission: record.automaticResubmission,
  };
  requestAttemptMappingGuidance(attempt);
  if (attempt.requestId !== identity.requestId || attempt.clientOrderId !== identity.clientOrderId) {
    throw new TypeError('L03 request attempt crosses mutation identity');
  }
  return deepFreezePrivate(attempt) as Readonly<RequestAttemptState>;
}

function l03AttemptContentRevision(attempt: Readonly<RequestAttemptState>): string {
  return digest('l06l03binding_', attempt);
}

const RAW_HTTP_FIELDS = Object.freeze([
  'l03RequestAttempt', 'partialMixed', 'venueOrderId', 'responseContentRevision',
] as const);
const CANONICAL_HTTP_FIELDS = Object.freeze([
  'product', 'accountRealmId', 'symbol', 'requestId', 'clientOrderId',
  'l03RequestAttempt', 'l06AttemptContentRevision', 'classification',
  'httpStatus', 'ambiguityCause', 'venueOrderId', 'responseContentRevision',
] as const);

function normalizeRawHttpPayload(
  record: Readonly<Record<string, unknown>>,
  identity: Readonly<MutationIdentityGraph>,
): Readonly<HttpObservedPayload> {
  const closed = exactRecord(record, RAW_HTTP_FIELDS, 'HTTP observation payload');
  const attempt = normalizeL03RequestAttempt(closed.l03RequestAttempt, identity);
  if (attempt.stage !== 'ACKNOWLEDGED' && attempt.stage !== 'REJECTED' && attempt.stage !== 'UNKNOWN') {
    throw new TypeError('HTTP observation requires a terminal transport observation from L03');
  }
  if (closed.partialMixed !== true && closed.partialMixed !== false) {
    throw new TypeError('HTTP partial-mixed marker must be boolean');
  }
  const partialMixed = closed.partialMixed;
  if (partialMixed && (identity.mutationKind !== 'CANCEL_REPLACE'
    || attempt.stage !== 'REJECTED' || attempt.httpStatus !== 409)) {
    throw new TypeError('partial-mixed truth is unavailable outside exact cancel-replace 409 evidence');
  }
  const classification = partialMixed
    ? 'PARTIAL_MIXED' as const
    : attempt.stage === 'ACKNOWLEDGED'
      ? 'ACKNOWLEDGED' as const
      : attempt.stage === 'REJECTED'
        ? 'REJECTED_RESPONSE' as const
        : 'AMBIGUOUS' as const;
  const responseContentRevision = closed.responseContentRevision === null
    ? null
    : (() => {
      const hash = privateString(closed.responseContentRevision, 'sanitized response content hash', 80);
      if (!SHA256.test(hash)) throw new TypeError('sanitized response content must be a SHA-256 hash');
      return hash;
    })();
  if ((attempt.httpStatus !== null) !== (responseContentRevision !== null)) {
    throw new TypeError('HTTP response hash availability does not match the L03 attempt');
  }
  return deepFreezePrivate({
    product: identity.product,
    accountRealmId: identity.accountRealmId,
    symbol: identity.symbol,
    requestId: identity.requestId,
    clientOrderId: identity.clientOrderId,
    l03RequestAttempt: attempt,
    l06AttemptContentRevision: l03AttemptContentRevision(attempt),
    classification,
    httpStatus: attempt.httpStatus,
    ambiguityCause: attempt.ambiguityCause,
    venueOrderId: optionalVenueOrderId(closed.venueOrderId, 'HTTP venue order ID'),
    responseContentRevision,
  }) as unknown as Readonly<HttpObservedPayload>;
}

function validateHttpPayload(
  value: unknown,
  identity: Readonly<MutationIdentityGraph>,
): Readonly<HttpObservedPayload> {
  const snapshot = snapshotPrivateData(value);
  const keys = typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
    ? Object.keys(snapshot)
    : [];
  if (keys.length === RAW_HTTP_FIELDS.length
    && keys.every((key) => RAW_HTTP_FIELDS.includes(key as (typeof RAW_HTTP_FIELDS)[number]))) {
    return normalizeRawHttpPayload(snapshot as Readonly<Record<string, unknown>>, identity);
  }
  const canonical = exactRecord(snapshot, CANONICAL_HTTP_FIELDS, 'canonical HTTP observation payload');
  const rebuilt = normalizeRawHttpPayload({
    l03RequestAttempt: canonical.l03RequestAttempt,
    partialMixed: canonical.classification === 'PARTIAL_MIXED',
    venueOrderId: canonical.venueOrderId,
    responseContentRevision: canonical.responseContentRevision,
  }, identity);
  if (canonicalJson(canonical) !== canonicalJson(rebuilt)) {
    throw new TypeError('canonical HTTP observation payload does not match its L03 attempt');
  }
  return rebuilt;
}

function normalizePrivateLineage(
  record: Readonly<Record<string, unknown>>,
  identity: Readonly<MutationIdentityGraph>,
  bindings: Readonly<MutationEvidenceBindings>,
  observationKind: 'PRIVATE_ORDER_OBSERVED' | 'PRIVATE_FILL_OBSERVED',
  expectedContentRevision: string,
): Readonly<{
  privateLifecycleRevision: string;
  privateEventKind: string;
  privateEventRevision: string;
  privateContentRevision: string;
  privateReceiptTimeMs: number;
  privateTransactionTimeMs: number | null;
  privateSemanticCategory: string | null;
  privateOrderExecutionType: string | null;
  privateIsFill: boolean | null;
}> {
  const privateLifecycleRevision = revision(
    record.privateLifecycleRevision,
    'L05 private lifecycle revision',
    L05_LIFECYCLE_REVISION,
  );
  if (!bindings.lifecycleRevisions.includes(privateLifecycleRevision)) {
    throw new TypeError('private observation is not bound to an accepted L05 lifecycle revision');
  }
  const generation = privateInteger(record.connectionGeneration, 'private connection generation', 1, 1_000_000);
  const exchangeEventTimeMs = privateInteger(
    record.exchangeEventTimeMs,
    'private exchange event time',
    0,
    MAX_UTC_MS,
  );
  const privateReceiptTimeMs = privateInteger(
    record.privateReceiptTimeMs,
    'L05 private receipt time',
    exchangeEventTimeMs,
    MAX_UTC_MS,
  );
  const privateEventKind = privateString(record.privateEventKind, 'L05 private event kind', 64);
  const privateContentRevision = revision(
    record.privateContentRevision,
    'L05 private content revision',
    identity.product === 'SPOT' ? SPOT_PRIVATE_CONTENT_REVISION : USDM_PRIVATE_CONTENT_REVISION,
  );
  if (privateContentRevision !== expectedContentRevision) {
    throw new TypeError('L05 private content revision is detached from the exact L06 fact projection');
  }
  const privateEventRevision = revision(
    record.privateEventRevision,
    'L05 private event revision',
    identity.product === 'SPOT' ? SPOT_PRIVATE_EVENT_REVISION : USDM_PRIVATE_EVENT_REVISION,
  );
  let privateTransactionTimeMs: number | null = null;
  let privateSemanticCategory: string | null = null;
  let privateOrderExecutionType: string | null = null;
  let privateIsFill: boolean | null = null;
  let expectedEventRevision: string;
  if (identity.product === 'SPOT') {
    const expectedKind = observationKind === 'PRIVATE_ORDER_OBSERVED' ? 'ORDER' : 'FILL';
    if (privateEventKind !== expectedKind
      || record.privateTransactionTimeMs !== null
      || record.privateSemanticCategory !== null
      || record.privateOrderExecutionType !== null
      || record.privateIsFill !== null) {
      throw new TypeError('Spot private observation does not carry an exact L05 event marker');
    }
    expectedEventRevision = createSpotRealmBoundRevision('spot_event', identity.accountRealmId, {
      generation,
      eventKind: expectedKind,
      contentRevision: privateContentRevision,
      exchangeEventTimeMs,
      receiptTimeMs: privateReceiptTimeMs,
    });
  } else {
    privateTransactionTimeMs = record.privateTransactionTimeMs === null
      ? null
      : privateInteger(record.privateTransactionTimeMs, 'USD-M private transaction time', 0, MAX_UTC_MS);
    privateSemanticCategory = privateString(record.privateSemanticCategory, 'USD-M private semantic category', 32);
    privateOrderExecutionType = record.privateOrderExecutionType === null
      ? null
      : privateString(record.privateOrderExecutionType, 'USD-M order execution type', 32);
    if (record.privateIsFill !== true && record.privateIsFill !== false) {
      throw new TypeError('USD-M private fill marker must be boolean');
    }
    privateIsFill = record.privateIsFill;
    const semantics = mapUsdmPrivateEventSemantics(privateEventKind, privateOrderExecutionType);
    if (semantics === null
      || semantics.semanticCategory !== privateSemanticCategory
      || semantics.isFill !== privateIsFill
      || (observationKind === 'PRIVATE_ORDER_OBSERVED'
        && privateEventKind !== 'ORDER_TRADE_UPDATE')
      || (observationKind === 'PRIVATE_FILL_OBSERVED' && privateIsFill !== true)
      || exchangeEventTimeMs > privateReceiptTimeMs + 2_000
      || (privateTransactionTimeMs !== null
        && privateTransactionTimeMs > privateReceiptTimeMs + 2_000)) {
      throw new TypeError('USD-M private observation does not carry exact L05 event semantics');
    }
    expectedEventRevision = createUsdmRealmBoundRevision('usdm_event', identity.accountRealmId, {
      generation,
      eventKind: privateEventKind,
      contentRevision: privateContentRevision,
      exchangeEventTimeMs,
      transactionTimeMs: privateTransactionTimeMs,
      semanticCategory: privateSemanticCategory,
      orderExecutionType: privateOrderExecutionType,
      isFill: privateIsFill,
      receiptTimeMs: privateReceiptTimeMs,
    });
  }
  if (privateEventRevision !== expectedEventRevision) {
    throw new TypeError('L05 private event revision does not bind its exact owner marker');
  }
  return deepFreezePrivate({
    privateLifecycleRevision,
    privateEventKind,
    privateEventRevision,
    privateContentRevision,
    privateReceiptTimeMs,
    privateTransactionTimeMs,
    privateSemanticCategory,
    privateOrderExecutionType,
    privateIsFill,
  });
}

function privateFactContentRevisionFor(
  identity: Readonly<MutationIdentityGraph>,
  observationKind: 'PRIVATE_ORDER_OBSERVED' | 'PRIVATE_FILL_OBSERVED',
  fact: Readonly<Record<string, unknown>>,
): string {
  const prefix = identity.product === 'SPOT' ? 'spot_content_' : 'usdm_content_';
  return `${prefix}${createHash('sha256').update(canonicalJson({
    schema: observationKind === 'PRIVATE_ORDER_OBSERVED'
      ? 'L06_PRIVATE_ORDER_FACT_PROJECTION_V1'
      : 'L06_PRIVATE_FILL_FACT_PROJECTION_V1',
    product: identity.product,
    accountRealmId: identity.accountRealmId,
    symbol: identity.symbol,
    clientOrderId: identity.clientOrderId,
    ...fact,
  })).digest('hex').slice(0, 32)}`;
}

function validatePrivateOrderPayload(
  value: unknown,
  requestedQuantity: string,
  identity: Readonly<MutationIdentityGraph>,
  bindings: Readonly<MutationEvidenceBindings>,
): Readonly<PrivateOrderObservedPayload> {
  const record = exactRecord(value, [
    'product', 'accountRealmId', 'symbol', 'clientOrderId',
    'status', 'cumulativeFilledQuantity', 'venueOrderId', 'exchangeEventTimeMs',
    'connectionGeneration', 'privateLifecycleRevision', 'privateEventRevision',
    'privateContentRevision', 'privateEventKind', 'privateReceiptTimeMs',
    'privateTransactionTimeMs', 'privateSemanticCategory',
    'privateOrderExecutionType', 'privateIsFill',
  ], 'private order payload');
  if (!includes(PRIVATE_ORDER_STATUSES, record.status)) throw new TypeError('private order status is invalid');
  if (record.product !== identity.product || record.accountRealmId !== identity.accountRealmId
    || record.symbol !== identity.symbol || record.clientOrderId !== identity.clientOrderId) {
    throw new TypeError('private order evidence crosses mutation identity');
  }
  const cumulative = normalizeJournalQuantity(record.cumulativeFilledQuantity, 'private order cumulative quantity');
  if (compareJournalQuantities(cumulative, requestedQuantity) > 0) throw new TypeError('private order overfills requested quantity');
  if ((record.status === 'NEW' || record.status === 'PENDING_NEW')
    && compareJournalQuantities(cumulative, '0') !== 0) {
    throw new TypeError('NEW/PENDING_NEW order cannot carry a positive cumulative fill');
  }
  if (record.status === 'PARTIALLY_FILLED'
    && (compareJournalQuantities(cumulative, '0') <= 0
      || compareJournalQuantities(cumulative, requestedQuantity) >= 0)) {
    throw new TypeError('partial order quantity is invalid');
  }
  if (record.status === 'FILLED' && compareJournalQuantities(cumulative, requestedQuantity) !== 0) {
    throw new TypeError('FILLED order must equal requested quantity');
  }
  if (record.status === 'REJECTED' && compareJournalQuantities(cumulative, '0') !== 0) {
    throw new TypeError('REJECTED order cannot carry a positive cumulative fill');
  }
  const venueOrderId = requiredVenueOrderId(record.venueOrderId, 'private order venue ID');
  const exchangeEventTimeMs = privateInteger(record.exchangeEventTimeMs, 'private exchange event time', 0, MAX_UTC_MS);
  const connectionGeneration = privateInteger(record.connectionGeneration, 'private connection generation', 1, 1_000_000);
  const expectedContentRevision = privateFactContentRevisionFor(identity, 'PRIVATE_ORDER_OBSERVED', {
    status: record.status,
    cumulativeFilledQuantity: cumulative,
    venueOrderId,
    exchangeEventTimeMs,
    connectionGeneration,
  });
  const lineage = normalizePrivateLineage(
    record,
    identity,
    bindings,
    'PRIVATE_ORDER_OBSERVED',
    expectedContentRevision,
  );
  return deepFreezePrivate({
    product: identity.product,
    accountRealmId: identity.accountRealmId,
    symbol: identity.symbol,
    clientOrderId: identity.clientOrderId,
    status: record.status,
    cumulativeFilledQuantity: cumulative,
    venueOrderId,
    exchangeEventTimeMs,
    connectionGeneration,
    ...lineage,
  }) as Readonly<PrivateOrderObservedPayload>;
}

function validatePrivateFillPayload(
  value: unknown,
  requestedQuantity: string,
  identity: Readonly<MutationIdentityGraph>,
  bindings: Readonly<MutationEvidenceBindings>,
): Readonly<PrivateFillObservedPayload> {
  const record = exactRecord(value, [
    'product', 'accountRealmId', 'symbol', 'clientOrderId',
    'tradeId', 'fillQuantity', 'cumulativeFilledQuantity', 'venueOrderId',
    'exchangeEventTimeMs', 'connectionGeneration', 'privateLifecycleRevision',
    'privateEventRevision', 'privateContentRevision', 'privateEventKind',
    'privateReceiptTimeMs', 'privateTransactionTimeMs',
    'privateSemanticCategory', 'privateOrderExecutionType', 'privateIsFill',
  ], 'private fill payload');
  if (record.product !== identity.product || record.accountRealmId !== identity.accountRealmId
    || record.symbol !== identity.symbol || record.clientOrderId !== identity.clientOrderId) {
    throw new TypeError('private fill evidence crosses mutation identity');
  }
  const tradeId = privateString(record.tradeId, 'trade ID', 32);
  if (!TRADE_ID.test(tradeId)) throw new TypeError('trade ID must be a decimal string');
  const fillQuantity = normalizeJournalQuantity(record.fillQuantity, 'fill quantity');
  const cumulative = normalizeJournalQuantity(record.cumulativeFilledQuantity, 'fill cumulative quantity');
  if (compareJournalQuantities(fillQuantity, '0') <= 0
    || compareJournalQuantities(fillQuantity, cumulative) > 0
    || compareJournalQuantities(cumulative, requestedQuantity) > 0) {
    throw new TypeError('fill quantity relationship is invalid');
  }
  const venueOrderId = requiredVenueOrderId(record.venueOrderId, 'fill venue order ID');
  const exchangeEventTimeMs = privateInteger(record.exchangeEventTimeMs, 'fill exchange event time', 0, MAX_UTC_MS);
  const connectionGeneration = privateInteger(record.connectionGeneration, 'fill connection generation', 1, 1_000_000);
  const expectedContentRevision = privateFactContentRevisionFor(identity, 'PRIVATE_FILL_OBSERVED', {
    tradeId,
    fillQuantity,
    cumulativeFilledQuantity: cumulative,
    venueOrderId,
    exchangeEventTimeMs,
    connectionGeneration,
  });
  const lineage = normalizePrivateLineage(
    record,
    identity,
    bindings,
    'PRIVATE_FILL_OBSERVED',
    expectedContentRevision,
  );
  return deepFreezePrivate({
    product: identity.product,
    accountRealmId: identity.accountRealmId,
    symbol: identity.symbol,
    clientOrderId: identity.clientOrderId,
    tradeId,
    fillQuantity,
    cumulativeFilledQuantity: cumulative,
    venueOrderId,
    exchangeEventTimeMs,
    connectionGeneration,
    ...lineage,
  }) as Readonly<PrivateFillObservedPayload>;
}

const FOUNDATION_RESULT_SUMMARY_FIELDS = Object.freeze([
  'planId', 'correlationId', 'evaluatedAtMs', 'status', 'recommendation',
  'executionAuthority',
] as const);
const FOUNDATION_LEG_SUMMARY_FIELDS = Object.freeze([
  'phase', 'legKey', 'clientOrderId', 'venueOrderId', 'expectedLifecycle',
  'expectedSubmittedQuantityProjection', 'expectedFilledQuantityProjection',
  'observedOrderStatus', 'observedOrderFilledQuantityProjection',
  'observedTradeFilledQuantityProjection', 'observedFilledQuantityProjection',
  'observedRemainderQuantityProjection', 'status', 'reasonCodes',
] as const);
const PRIVATE_RECONCILIATION_SUMMARY_FIELDS = Object.freeze([
  'owner', 'status', 'resultRevision', 'sourceCutRevision',
  'productCutRevisions', 'observedAtMs', 'executionAuthority',
] as const);
const PRODUCT_CUT_FIELDS = Object.freeze(['SPOT', 'USD_M_PERPETUAL', 'MARGIN'] as const);

function normalizeFoundationResultSummary(value: unknown): Readonly<FoundationReconciliationResultSummary> {
  const record = exactRecord(value, FOUNDATION_RESULT_SUMMARY_FIELDS, 'Foundation result summary');
  if (!FOUNDATION_PLAN_ID.test(privateIdentifier(record.planId, 'Foundation result plan ID'))
    || !CORRELATION_ID.test(privateIdentifier(record.correlationId, 'Foundation result correlation ID'))
    || !includes(FOUNDATION_RECONCILIATION_STATUSES, record.status)
    || !(RECONCILIATION_RECOMMENDATIONS as readonly unknown[]).includes(record.recommendation)
    || record.executionAuthority !== 'NONE') {
    throw new TypeError('Foundation result summary is invalid');
  }
  return deepFreezePrivate({
    planId: record.planId,
    correlationId: record.correlationId,
    evaluatedAtMs: privateInteger(record.evaluatedAtMs, 'Foundation evaluation time', 0, MAX_UTC_MS),
    status: record.status,
    recommendation: record.recommendation,
    executionAuthority: 'NONE' as const,
  }) as Readonly<FoundationReconciliationResultSummary>;
}

function projectedBinary64Quantity(value: unknown, label: string): string | null {
  return value === null ? null : normalizeJournalQuantity(value, label);
}

function normalizeFoundationLegSummary(value: unknown): Readonly<FoundationReconciledLegSummary> {
  const record = exactRecord(value, FOUNDATION_LEG_SUMMARY_FIELDS, 'Foundation reconciled leg summary');
  if ((record.phase !== 'OPEN' && record.phase !== 'CLOSE')
    || (record.legKey !== 'SPOT' && record.legKey !== 'PERP')
    || !isValidClientOrderId(record.clientOrderId)
    || !(LEG_LIFECYCLES as readonly unknown[]).includes(record.expectedLifecycle)
    || (record.observedOrderStatus !== null
      && !['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'UNKNOWN']
        .includes(record.observedOrderStatus as string))
    || !includes(FOUNDATION_RECONCILIATION_STATUSES, record.status)) {
    throw new TypeError('Foundation reconciled leg summary is invalid');
  }
  const reasons = privateArray(record.reasonCodes, 'Foundation leg reason codes', 64)
    .map((item) => privateString(item, 'Foundation leg reason code', 96));
  return deepFreezePrivate({
    phase: record.phase,
    legKey: record.legKey,
    clientOrderId: record.clientOrderId,
    venueOrderId: optionalVenueOrderId(record.venueOrderId, 'Foundation leg venue order ID'),
    expectedLifecycle: record.expectedLifecycle,
    expectedSubmittedQuantityProjection: projectedBinary64Quantity(
      record.expectedSubmittedQuantityProjection,
      'Foundation expected submitted quantity projection',
    )!,
    expectedFilledQuantityProjection: projectedBinary64Quantity(
      record.expectedFilledQuantityProjection,
      'Foundation expected filled quantity projection',
    )!,
    observedOrderStatus: record.observedOrderStatus,
    observedOrderFilledQuantityProjection: projectedBinary64Quantity(
      record.observedOrderFilledQuantityProjection,
      'Foundation observed order fill projection',
    ),
    observedTradeFilledQuantityProjection: projectedBinary64Quantity(
      record.observedTradeFilledQuantityProjection,
      'Foundation observed trade fill projection',
    ),
    observedFilledQuantityProjection: projectedBinary64Quantity(
      record.observedFilledQuantityProjection,
      'Foundation observed fill projection',
    ),
    observedRemainderQuantityProjection: projectedBinary64Quantity(
      record.observedRemainderQuantityProjection,
      'Foundation observed remainder projection',
    ),
    status: record.status,
    reasonCodes: Object.freeze(reasons),
  }) as Readonly<FoundationReconciledLegSummary>;
}

function normalizePrivateReconciliationSummary(
  value: unknown,
  product: MutationProduct,
): Readonly<{ summary: Readonly<FoundationPrivateReconciliationSummary>; productCutRevision: string }> {
  const record = exactRecord(
    value,
    PRIVATE_RECONCILIATION_SUMMARY_FIELDS,
    'L05 Foundation reconciliation observation',
  );
  if (record.owner !== 'FOUNDATION_RECONCILIATION' || record.status !== 'EXACT'
    || record.executionAuthority !== 'NONE') {
    throw new TypeError('L05 Foundation reconciliation observation authority is invalid');
  }
  const cuts = exactRecord(record.productCutRevisions, PRODUCT_CUT_FIELDS, 'L05 product reconciliation cuts');
  if (cuts.MARGIN !== null) throw new TypeError('Margin reconciliation cut remains unavailable');
  const spot = cuts.SPOT === null ? null : revision(cuts.SPOT, 'Spot reconciliation cut', SPOT_REST_CUT_REVISION);
  const usdm = cuts.USD_M_PERPETUAL === null
    ? null
    : revision(cuts.USD_M_PERPETUAL, 'USD-M reconciliation cut', USDM_REST_CUT_REVISION);
  const selected = product === 'SPOT' ? spot : product === 'USD_M_PERPETUAL' ? usdm : null;
  if (selected === null || (product === 'SPOT' ? usdm !== null : spot !== null)) {
    throw new TypeError('L05 product cut does not match the exact mutation product');
  }
  const summary = deepFreezePrivate({
    owner: 'FOUNDATION_RECONCILIATION' as const,
    status: 'EXACT' as const,
    resultRevision: revision(record.resultRevision, 'Foundation result revision', FOUNDATION_RESULT_REVISION),
    sourceCutRevision: revision(record.sourceCutRevision, 'private source cut', PRIVATE_SOURCE_CUT_REVISION),
    productCutRevisions: deepFreezePrivate({ SPOT: spot, USD_M_PERPETUAL: usdm, MARGIN: null }),
    observedAtMs: privateInteger(record.observedAtMs, 'L05 reconciliation observation time', 0, MAX_UTC_MS),
    executionAuthority: 'NONE' as const,
  }) as Readonly<FoundationPrivateReconciliationSummary>;
  return deepFreezePrivate({ summary, productCutRevision: selected });
}

function exactSafeIntegerBridge(binary64Projection: string | null, exactQuantity: string): boolean {
  if (binary64Projection === null || !/^(?:0|[1-9][0-9]*)$/.test(binary64Projection)) return false;
  const numeric = Number(binary64Projection);
  return Number.isSafeInteger(numeric) && String(numeric) === binary64Projection
    && normalizeJournalQuantity(binary64Projection, 'safe-integer bridge quantity') === exactQuantity;
}

function derivedReconciliationEffect(
  result: Readonly<FoundationReconciliationResultSummary>,
  leg: Readonly<FoundationReconciledLegSummary>,
  exactJournalQuantity: string,
  requestedQuantity: string,
): FoundationMutationEffect {
  if (result.status !== 'EXACT' || leg.status !== 'EXACT'
    || !exactSafeIntegerBridge(leg.expectedSubmittedQuantityProjection, requestedQuantity)) {
    return 'UNKNOWN';
  }
  if (leg.observedOrderStatus === 'FILLED' && leg.expectedLifecycle === 'FILLED'
    && exactJournalQuantity === requestedQuantity
    && exactSafeIntegerBridge(leg.observedFilledQuantityProjection, exactJournalQuantity)
    && leg.venueOrderId !== null) return 'FILLED';
  if ((leg.observedOrderStatus === 'CANCELED' || leg.observedOrderStatus === 'EXPIRED')
    && leg.expectedLifecycle === 'CANCELLED'
    && exactSafeIntegerBridge(leg.observedFilledQuantityProjection, exactJournalQuantity)
    && leg.venueOrderId !== null) return leg.observedOrderStatus;
  if ((leg.observedOrderStatus === 'REJECTED' || leg.observedOrderStatus === null)
    && leg.expectedLifecycle === 'REJECTED'
    && exactJournalQuantity === '0'
    && (leg.observedFilledQuantityProjection === null
      || exactSafeIntegerBridge(leg.observedFilledQuantityProjection, '0'))) {
    return 'REJECTED_NO_EFFECT_PROVEN';
  }
  return 'UNKNOWN';
}

function validateReconciliationPayload(
  value: unknown,
  identity: Readonly<MutationIdentityGraph>,
  bindings: Readonly<MutationEvidenceBindings>,
  requestedQuantity: string,
): Readonly<FoundationReconciliationObservedPayload> {
  const record = exactRecord(value, [
    'owner', 'mutationId', 'product', 'accountRealmId', 'clientOrderId',
    'journalVersion', 'journalHeadDigest', 'status', 'effect', 'effectDialect',
    'quantityDialect', 'resultRevision', 'resultContentRevision',
    'foundationResult', 'matchingLeg', 'privateReconciliationObservation',
    'privateProjectionRevision', 'privateLifecycleRevision',
    'privateSourceCutRevision', 'privateProductCutRevision',
    'journalOutcomeRevision', 'venueOrderId', 'cumulativeFilledQuantity',
    'observedAtMs', 'externalTruthRefs',
  ], 'Foundation reconciliation payload');
  if (record.owner !== 'FOUNDATION_RECONCILIATION'
    || record.product !== identity.product
    || record.accountRealmId !== identity.accountRealmId
    || record.clientOrderId !== identity.clientOrderId
    || record.effectDialect !== 'L06_JOURNAL_PROJECTION_V1'
    || record.quantityDialect !== 'BINARY64_ROUND_TRIP_PROJECTION') {
    throw new TypeError('Foundation reconciliation owner/identity tuple is invalid');
  }
  const result = normalizeFoundationResultSummary(record.foundationResult);
  const leg = normalizeFoundationLegSummary(record.matchingLeg);
  const privateTruth = normalizePrivateReconciliationSummary(
    record.privateReconciliationObservation,
    identity.product,
  );
  const resultRevision = revision(record.resultRevision, 'Foundation result revision', FOUNDATION_RESULT_REVISION);
  const privateProjectionRevision = revision(
    record.privateProjectionRevision,
    'post-action private projection revision',
    /^l05proj_[0-9a-f]{64}$/,
  );
  const privateLifecycleRevision = revision(
    record.privateLifecycleRevision,
    'post-action private lifecycle revision',
    L05_LIFECYCLE_REVISION,
  );
  const observedAtMs = privateInteger(record.observedAtMs, 'reconciliation observation time', 0, MAX_UTC_MS);
  const quantity = normalizeJournalQuantity(record.cumulativeFilledQuantity, 'journal reconciliation quantity');
  const venueOrderId = optionalVenueOrderId(record.venueOrderId, 'reconciled venue order ID');
  const expectedLegKey = identity.product === 'SPOT' ? 'SPOT' : 'PERP';
  const effect = derivedReconciliationEffect(result, leg, quantity, requestedQuantity);
  const refs = privateArray(record.externalTruthRefs, 'external truth references', 0);
  if (refs.length !== 0
    || result.planId !== identity.ticketId || result.correlationId !== identity.globalCorrelationId
    || result.evaluatedAtMs !== observedAtMs || result.status !== record.status
    || leg.clientOrderId !== identity.clientOrderId || leg.legKey !== expectedLegKey
    || privateTruth.summary.resultRevision !== resultRevision
    || privateTruth.summary.observedAtMs !== observedAtMs
    || privateTruth.summary.sourceCutRevision !== record.privateSourceCutRevision
    || privateTruth.productCutRevision !== record.privateProductCutRevision
    || privateTruth.summary.sourceCutRevision === bindings.privateSourceCutRevision
    || privateProjectionRevision === bindings.privateProjectionRevision
    || bindings.lifecycleRevisions.includes(privateLifecycleRevision)
    || leg.venueOrderId !== venueOrderId
    || record.effect !== effect) {
    throw new TypeError('Foundation reconciliation projection does not regenerate from owner inputs');
  }
  return deepFreezePrivate({
    owner: 'FOUNDATION_RECONCILIATION' as const,
    mutationId: revision(record.mutationId, 'reconciliation mutation ID', MUTATION_ID),
    product: identity.product,
    accountRealmId: identity.accountRealmId,
    clientOrderId: identity.clientOrderId,
    journalVersion: privateInteger(record.journalVersion, 'reconciliation journal version', 1, MUTATION_JOURNAL_LIMITS.maximumEntries),
    journalHeadDigest: revision(record.journalHeadDigest, 'reconciliation journal head', HEAD_DIGEST),
    status: result.status,
    effect,
    effectDialect: 'L06_JOURNAL_PROJECTION_V1' as const,
    quantityDialect: 'BINARY64_ROUND_TRIP_PROJECTION' as const,
    resultRevision,
    resultContentRevision: revision(
      record.resultContentRevision,
      'L06 Foundation result content revision',
      L06_FOUNDATION_RESULT_CONTENT_REVISION,
    ),
    foundationResult: result,
    matchingLeg: leg,
    privateReconciliationObservation: privateTruth.summary,
    privateProjectionRevision,
    privateLifecycleRevision,
    privateSourceCutRevision: privateTruth.summary.sourceCutRevision,
    privateProductCutRevision: privateTruth.productCutRevision,
    journalOutcomeRevision: revision(record.journalOutcomeRevision, 'journal outcome revision', OUTCOME_REVISION),
    venueOrderId,
    cumulativeFilledQuantity: quantity,
    observedAtMs,
    externalTruthRefs: Object.freeze([]),
  }) as Readonly<FoundationReconciliationObservedPayload>;
}

function validatePayload(
  kind: MutationEntryKind,
  value: unknown,
  identity: Readonly<MutationIdentityGraph> | null,
  bindings: Readonly<MutationEvidenceBindings> | null,
  requestedQuantity: string | null,
): Readonly<MutationEntryPayload> {
  if (kind === 'CREATED') {
    const record = exactRecord(value, [
      'identity', 'bindings', 'preflightResult', 'requestedQuantity',
    ], 'created payload');
    const preflightResult = normalizePreflightResult(record.preflightResult);
    return deepFreezePrivate({
      identity: normalizeIdentity(record.identity),
      bindings: normalizeBindings(record.bindings, preflightResult),
      preflightResult,
      requestedQuantity: normalizeJournalQuantity(record.requestedQuantity, 'created requested quantity'),
    }) as unknown as Readonly<MutationEntryPayload>;
  }
  if (identity === null || bindings === null || requestedQuantity === null) {
    throw new TypeError('non-created mutation entry lacks its identity root');
  }
  if (kind === 'PREFLIGHTED') {
    const record = exactRecord(value, ['preflightContentRevision', 'preflightEvaluatedAtMs'], 'preflight payload');
    if (record.preflightContentRevision !== bindings.preflightContentRevision
      || record.preflightEvaluatedAtMs !== bindings.preflightEvaluatedAtMs) {
      throw new TypeError('preflight payload does not bind the accepted L04 result');
    }
    return deepFreezePrivate({
      preflightContentRevision: bindings.preflightContentRevision,
      preflightEvaluatedAtMs: bindings.preflightEvaluatedAtMs,
    });
  }
  if (kind === 'SUBMISSION_INTENT') {
    const record = exactRecord(value, ['reason'], 'submission intent payload');
    if (record.reason !== 'PERSIST_BEFORE_SYNTHETIC_DISPATCH') throw new TypeError('submission intent reason is invalid');
    return deepFreezePrivate({ reason: 'PERSIST_BEFORE_SYNTHETIC_DISPATCH' as const });
  }
  if (kind === 'SUBMISSION_OBSERVED') {
    const record = exactRecord(value, [
      'l03RequestAttempt', 'l06AttemptContentRevision',
      'durableIntentCommittedAtMs', 'durableIntentLedgerEventId',
      'durableIntentAppendRequestDigest', 'syntheticObservationOnly',
    ], 'submission observation payload');
    if (record.syntheticObservationOnly !== true) throw new TypeError('submission observation must remain synthetic');
    const attempt = normalizeL03RequestAttempt(record.l03RequestAttempt, identity);
    if (attempt.stage !== 'SUBMITTED' || attempt.submitCount !== 1
      || attempt.duplicateSendBlocked !== true || attempt.transportOutcome !== null
      || attempt.httpStatus !== null || attempt.ambiguityCause !== null) {
      throw new TypeError('submission observation requires exact L03 SUBMITTED state');
    }
    const attemptRevision = l03AttemptContentRevision(attempt);
    if (record.l06AttemptContentRevision !== attemptRevision) {
      throw new TypeError('L03 attempt content revision mismatch');
    }
    return deepFreezePrivate({
      l03RequestAttempt: attempt,
      l06AttemptContentRevision: attemptRevision,
      durableIntentCommittedAtMs: privateInteger(
        record.durableIntentCommittedAtMs,
        'durable intent commit time',
        0,
        MAX_UTC_MS,
      ),
      durableIntentLedgerEventId: privateInteger(
        record.durableIntentLedgerEventId,
        'durable intent Ledger event ID',
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      durableIntentAppendRequestDigest: revision(
        record.durableIntentAppendRequestDigest,
        'durable intent append request digest',
        APPEND_DIGEST,
      ),
      syntheticObservationOnly: true as const,
    });
  }
  if (kind === 'HTTP_OBSERVED') return validateHttpPayload(value, identity);
  if (kind === 'PRIVATE_ORDER_OBSERVED') {
    return validatePrivateOrderPayload(value, requestedQuantity, identity, bindings);
  }
  if (kind === 'PRIVATE_FILL_OBSERVED') {
    return validatePrivateFillPayload(value, requestedQuantity, identity, bindings);
  }
  if (kind === 'FOUNDATION_RECONCILIATION_OBSERVED') {
    return validateReconciliationPayload(value, identity, bindings, requestedQuantity);
  }
  if (kind === 'OBSERVATION_ID_CONFLICT') {
    const record = exactRecord(value, [
      'reusedObservationId', 'existingContentRevision', 'conflictingContentRevision',
    ], 'observation identity conflict payload');
    const existingContentRevision = revision(
      record.existingContentRevision,
      'existing observation content revision',
      CONTENT_REVISION,
    );
    const conflictingContentRevision = revision(
      record.conflictingContentRevision,
      'conflicting observation content revision',
      CONTENT_REVISION,
    );
    if (existingContentRevision === conflictingContentRevision) {
      throw new TypeError('observation identity conflict requires different content');
    }
    return deepFreezePrivate({
      reusedObservationId: revision(record.reusedObservationId, 'reused observation ID', OBSERVATION_ID),
      existingContentRevision,
      conflictingContentRevision,
    }) as Readonly<ObservationIdConflictPayload>;
  }
  const record = exactRecord(value, ['subsystem', 'reasonCode'], 'telemetry degradation payload');
  if (record.subsystem !== 'READ_MODEL'
    && record.subsystem !== 'TRACE'
    && record.subsystem !== 'INTELLIGENCE_RUNTIME_RECORDING') {
    throw new TypeError('telemetry subsystem is invalid');
  }
  const reasonCode = privateString(record.reasonCode, 'telemetry reason code', 96);
  if (!REASON_CODE.test(reasonCode)) throw new TypeError('telemetry reason code is invalid');
  return deepFreezePrivate({ subsystem: record.subsystem, reasonCode });
}

function contentRevisionFor(input: Omit<MutationJournalEntry, 'entryId' | 'contentRevision'>): string {
  return digest('l06content_', {
    schema: input.schema,
    version: input.version,
    mutationId: input.mutationId,
    observationId: input.observationId,
    kind: input.kind,
    occurredAtMs: input.occurredAtMs,
    receivedAtMs: input.receivedAtMs,
    sourceRevision: input.sourceRevision,
    payload: input.payload,
  });
}

function entryIdFor(input: Omit<MutationJournalEntry, 'entryId'>): string {
  return digest('l06entry_', {
    mutationId: input.mutationId,
    journalVersion: input.journalVersion,
    previousHeadDigest: input.previousHeadDigest,
    observationId: input.observationId,
    contentRevision: input.contentRevision,
  });
}

function headDigestFor(previous: string | null, entry: Readonly<MutationJournalEntry>): string {
  return digest('l06head_', {
    previous,
    journalVersion: entry.journalVersion,
    entryId: entry.entryId,
    contentRevision: entry.contentRevision,
  });
}

function createEntry(input: {
  readonly mutationId: string;
  readonly observationId: string;
  readonly journalVersion: number;
  readonly previousHeadDigest: string | null;
  readonly kind: MutationEntryKind;
  readonly occurredAtMs: number;
  readonly receivedAtMs: number;
  readonly sourceRevision: string;
  readonly payload: Readonly<MutationEntryPayload>;
}): Readonly<MutationJournalEntry> {
  if (!MUTATION_ID.test(input.mutationId)
    || !OBSERVATION_ID.test(input.observationId)
    || !includes(MUTATION_ENTRY_KINDS, input.kind)
    || !validTime(input.occurredAtMs)
    || !validTime(input.receivedAtMs)
    || input.receivedAtMs < input.occurredAtMs
    || input.journalVersion < 1
    || input.journalVersion > MUTATION_JOURNAL_LIMITS.maximumEntries
    || (input.previousHeadDigest !== null && !HEAD_DIGEST.test(input.previousHeadDigest))) {
    throw new TypeError('mutation journal entry envelope is invalid');
  }
  const sourceRevision = revision(input.sourceRevision, 'entry source revision');
  const base = {
    schema: L06_MUTATION_ENTRY_SCHEMA,
    version: 1 as const,
    mutationId: input.mutationId,
    observationId: input.observationId,
    journalVersion: input.journalVersion,
    previousHeadDigest: input.previousHeadDigest,
    kind: input.kind,
    occurredAtMs: input.occurredAtMs,
    receivedAtMs: input.receivedAtMs,
    sourceRevision,
    payload: input.payload,
  };
  const contentRevision = contentRevisionFor({ ...base, entryId: '' } as Omit<MutationJournalEntry, 'entryId' | 'contentRevision'>);
  const entryId = entryIdFor({ ...base, contentRevision });
  const entry = deepFreezePrivate({ ...base, entryId, contentRevision });
  assertSerializedByteBound(
    entry,
    MUTATION_JOURNAL_LIMITS.maximumSerializedEntryBytes,
    'mutation journal entry',
  );
  return entry;
}

function validateEntry(
  value: unknown,
  expectedVersion: number,
  expectedPrevious: string | null,
  identity: Readonly<MutationIdentityGraph> | null,
  bindings: Readonly<MutationEvidenceBindings> | null,
  requestedQuantity: string | null,
): Readonly<MutationJournalEntry> {
  const record = exactRecord(value, ENTRY_FIELDS, 'mutation journal entry');
  if (record.schema !== L06_MUTATION_ENTRY_SCHEMA || record.version !== 1
    || !includes(MUTATION_ENTRY_KINDS, record.kind)
    || record.journalVersion !== expectedVersion
    || record.previousHeadDigest !== expectedPrevious) {
    throw new TypeError('mutation journal entry sequence is invalid');
  }
  const mutationId = revision(record.mutationId, 'entry mutation ID', MUTATION_ID);
  const observationId = revision(record.observationId, 'entry observation ID', OBSERVATION_ID);
  const occurredAtMs = privateInteger(record.occurredAtMs, 'entry occurrence time', 0, MAX_UTC_MS);
  const receivedAtMs = privateInteger(record.receivedAtMs, 'entry receipt time', 0, MAX_UTC_MS);
  if (receivedAtMs < occurredAtMs) throw new TypeError('entry receipt predates occurrence');
  const payload = validatePayload(record.kind, record.payload, identity, bindings, requestedQuantity);
  const sourceRevision = revision(record.sourceRevision, 'entry source revision');
  if (record.kind === 'HTTP_OBSERVED'
    && sourceRevision !== (payload as Readonly<HttpObservedPayload>).l06AttemptContentRevision) {
    throw new TypeError('HTTP observation source must equal its exact L03 attempt content revision');
  }
  if ((record.kind === 'PRIVATE_ORDER_OBSERVED' || record.kind === 'PRIVATE_FILL_OBSERVED')
    && sourceRevision
      !== (payload as Readonly<PrivateOrderObservedPayload | PrivateFillObservedPayload>).privateEventRevision) {
    throw new TypeError('private observation source must equal its exact L05 event revision');
  }
  if (record.kind === 'FOUNDATION_RECONCILIATION_OBSERVED'
    && sourceRevision !== (payload as Readonly<FoundationReconciliationObservedPayload>).resultRevision) {
    throw new TypeError('reconciliation source must equal its Foundation result revision');
  }
  if ((record.kind === 'PRIVATE_ORDER_OBSERVED' || record.kind === 'PRIVATE_FILL_OBSERVED')
    && receivedAtMs
      !== (payload as Readonly<PrivateOrderObservedPayload | PrivateFillObservedPayload>).privateReceiptTimeMs) {
    throw new TypeError('private observation receipt must equal its exact L05 marker receipt');
  }
  const candidate = createEntry({
    mutationId,
    observationId,
    journalVersion: expectedVersion,
    previousHeadDigest: expectedPrevious,
    kind: record.kind,
    occurredAtMs,
    receivedAtMs,
    sourceRevision,
    payload,
  });
  if (candidate.entryId !== record.entryId || candidate.contentRevision !== record.contentRevision) {
    throw new TypeError('mutation journal entry content identity mismatch');
  }
  return candidate;
}

function sortedUnique(values: readonly string[], maximum: number): readonly string[] {
  const result = [...new Set(values)].sort();
  if (result.length > maximum) throw new RangeError('mutation projection bound exceeded');
  return Object.freeze(result);
}

function deriveProjection(
  entries: readonly Readonly<MutationJournalEntry>[],
  requestedQuantity: string,
  identity: Readonly<MutationIdentityGraph>,
): Readonly<MutationProjection> {
  const conflicts: string[] = [];
  const ambiguity: MutationAmbiguityCause[] = [];
  const venueIds = new Set<string>();
  const observedVenueIds = new Set<string>();
  const tradeById = new Map<string, string>();
  const tradeQuantityById = new Map<string, string>();
  const l03AttemptByRevision = new Map<string, string>();
  const httpResponseByAttempt = new Map<string, string | null>();
  const statuses: Array<{
    status: PrivateOrderObservedPayload['status'];
    quantity: string;
    generation: number;
    time: number;
    content: string;
  }> = [];
  const cumulativeFacts: Array<{
    quantity: string;
    generation: number;
    time: number;
    content: string;
  }> = [];
  const quantities: string[] = ['0'];
  const reconciliation: Array<Readonly<FoundationReconciliationObservedPayload>> = [];
  const externalTruthRefs: string[] = [];
  let submissionIntentPresent = false;
  let submissionObserved = false;
  let httpAcknowledged = false;
  let httpRejectedResponseSeen = false;
  let partialMixed = false;
  let telemetryDegraded = false;
  let latestSemanticEvidenceVersion = 0;
  let latestReconciliationEntryVersion = 0;

  for (const entry of entries) {
    if (entry.kind !== 'TELEMETRY_DEGRADED'
      && entry.kind !== 'FOUNDATION_RECONCILIATION_OBSERVED') {
      latestSemanticEvidenceVersion = Math.max(latestSemanticEvidenceVersion, entry.journalVersion);
    }
    if (entry.kind === 'SUBMISSION_INTENT') submissionIntentPresent = true;
    if (entry.kind === 'SUBMISSION_OBSERVED') submissionObserved = true;
    if (entry.kind === 'TELEMETRY_DEGRADED') telemetryDegraded = true;
    if (entry.kind === 'OBSERVATION_ID_CONFLICT') conflicts.push('OBSERVATION_ID_CONTENT_CONFLICT');
    if (entry.kind === 'HTTP_OBSERVED') {
      const payload = entry.payload as Readonly<HttpObservedPayload>;
      const attemptKey = `${payload.requestId}:${payload.l03RequestAttempt.revision}`;
      const priorAttempt = l03AttemptByRevision.get(attemptKey);
      if (priorAttempt !== undefined && priorAttempt !== payload.l06AttemptContentRevision) {
        conflicts.push('L03_ATTEMPT_REVISION_FORK');
      } else {
        l03AttemptByRevision.set(attemptKey, payload.l06AttemptContentRevision);
      }
      if (httpResponseByAttempt.has(payload.l06AttemptContentRevision)
        && httpResponseByAttempt.get(payload.l06AttemptContentRevision)
          !== payload.responseContentRevision) {
        conflicts.push('HTTP_RESPONSE_CONTENT_CONFLICT');
      } else {
        httpResponseByAttempt.set(payload.l06AttemptContentRevision, payload.responseContentRevision);
      }
      if (payload.classification === 'ACKNOWLEDGED') httpAcknowledged = true;
      if (payload.classification === 'REJECTED_RESPONSE') httpRejectedResponseSeen = true;
      if (payload.classification === 'PARTIAL_MIXED') partialMixed = true;
      if (payload.ambiguityCause !== null) ambiguity.push(payload.ambiguityCause);
      if (payload.venueOrderId !== null) {
        venueIds.add(payload.venueOrderId);
        observedVenueIds.add(payload.venueOrderId);
      }
    }
    if (entry.kind === 'PRIVATE_ORDER_OBSERVED') {
      const payload = entry.payload as Readonly<PrivateOrderObservedPayload>;
      venueIds.add(payload.venueOrderId);
      observedVenueIds.add(payload.venueOrderId);
      quantities.push(payload.cumulativeFilledQuantity);
      statuses.push({
        status: payload.status,
        quantity: payload.cumulativeFilledQuantity,
        generation: payload.connectionGeneration,
        time: payload.exchangeEventTimeMs,
        content: entry.contentRevision,
      });
      cumulativeFacts.push({
        quantity: payload.cumulativeFilledQuantity,
        generation: payload.connectionGeneration,
        time: payload.exchangeEventTimeMs,
        content: entry.contentRevision,
      });
    }
    if (entry.kind === 'PRIVATE_FILL_OBSERVED') {
      const payload = entry.payload as Readonly<PrivateFillObservedPayload>;
      venueIds.add(payload.venueOrderId);
      observedVenueIds.add(payload.venueOrderId);
      quantities.push(payload.cumulativeFilledQuantity);
      cumulativeFacts.push({
        quantity: payload.cumulativeFilledQuantity,
        generation: payload.connectionGeneration,
        time: payload.exchangeEventTimeMs,
        content: entry.contentRevision,
      });
      const fingerprint = digest('fill_', {
        tradeId: payload.tradeId,
        fillQuantity: payload.fillQuantity,
        cumulativeFilledQuantity: payload.cumulativeFilledQuantity,
        venueOrderId: payload.venueOrderId,
        exchangeEventTimeMs: payload.exchangeEventTimeMs,
      });
      const prior = tradeById.get(payload.tradeId);
      if (prior !== undefined && prior !== fingerprint) conflicts.push('TRADE_ID_CONTENT_CONFLICT');
      else {
        tradeById.set(payload.tradeId, fingerprint);
        tradeQuantityById.set(payload.tradeId, payload.fillQuantity);
      }
    }
    if (entry.kind === 'FOUNDATION_RECONCILIATION_OBSERVED') {
      const payload = entry.payload as Readonly<FoundationReconciliationObservedPayload>;
      latestReconciliationEntryVersion = Math.max(latestReconciliationEntryVersion, entry.journalVersion);
      reconciliation.push(payload);
      if (payload.venueOrderId !== null) venueIds.add(payload.venueOrderId);
      if (payload.cumulativeFilledQuantity !== null) quantities.push(payload.cumulativeFilledQuantity);
      externalTruthRefs.push(...payload.externalTruthRefs);
      if (payload.effect === 'PARTIAL_MIXED') partialMixed = true;
    }
  }

  if (venueIds.size > 1) conflicts.push('VENUE_ORDER_ID_CONFLICT');
  const cumulativeFilledQuantity = maximumJournalQuantity(quantities);
  if (compareJournalQuantities(cumulativeFilledQuantity, requestedQuantity) > 0) conflicts.push('OVERFILLED_REQUEST');
  const summedTradeQuantity = sumJournalQuantities([...tradeQuantityById.values()]);
  if (compareJournalQuantities(summedTradeQuantity, requestedQuantity) > 0) {
    conflicts.push('TRADE_FILL_SUM_EXCEEDS_REQUEST');
  }
  if (compareJournalQuantities(summedTradeQuantity, cumulativeFilledQuantity) > 0) {
    conflicts.push('TRADE_FILL_SUM_EXCEEDS_CUMULATIVE');
  }
  if (httpRejectedResponseSeen && compareJournalQuantities(cumulativeFilledQuantity, '0') > 0) {
    conflicts.push('HTTP_REJECTION_CONTRADICTS_OBSERVED_FILL');
  }
  if (httpAcknowledged && httpRejectedResponseSeen) {
    conflicts.push('HTTP_ACK_REJECTION_CONFLICT');
  }
  cumulativeFacts.sort((left, right) => left.time - right.time
    || left.generation - right.generation || compareCodeUnits(left.content, right.content));
  for (let index = 1; index < cumulativeFacts.length; index += 1) {
    const prior = cumulativeFacts[index - 1];
    const current = cumulativeFacts[index];
    if (current.time > prior.time
      && compareJournalQuantities(current.quantity, prior.quantity) < 0) {
      conflicts.push('CUMULATIVE_FILL_REGRESSION');
    }
    if (current.time === prior.time && current.quantity !== prior.quantity) {
      conflicts.push('SAME_TIME_CUMULATIVE_FILL_CONFLICT');
    }
  }
  statuses.sort((left, right) => left.time - right.time
    || left.generation - right.generation || compareCodeUnits(left.content, right.content));
  for (let index = 1; index < statuses.length; index += 1) {
    const priorTerminal = statuses[index - 1].status === 'FILLED'
      || statuses[index - 1].status === 'CANCELED'
      || statuses[index - 1].status === 'EXPIRED'
      || statuses[index - 1].status === 'REJECTED';
    const currentWorking = statuses[index].status === 'NEW'
      || statuses[index].status === 'PARTIALLY_FILLED';
    if (statuses[index].time > statuses[index - 1].time && priorTerminal && currentWorking) {
      conflicts.push('TERMINAL_TO_WORKING_REGRESSION');
    }
  }
  let workingStatus = statuses.at(-1)?.status ?? null;
  const latestTime = statuses.at(-1)?.time ?? null;
  if (latestTime !== null) {
    const atLatestTime = statuses.filter((item) => item.time === latestTime);
    const sameTime = new Set(atLatestTime.map((item) => item.status));
    const sameTimeQuantities = new Set(atLatestTime.map((item) => item.quantity));
    if (sameTime.size > 1) conflicts.push('SAME_TIME_ORDER_STATUS_CONFLICT');
    if (sameTimeQuantities.size > 1) conflicts.push('SAME_TIME_CUMULATIVE_FILL_CONFLICT');
  }
  const terminalStatuses = new Set(statuses
    .map((item) => item.status)
    .filter((status): status is 'FILLED' | 'CANCELED' | 'EXPIRED' | 'REJECTED' => (
      status === 'FILLED' || status === 'CANCELED' || status === 'EXPIRED' || status === 'REJECTED'
    )));
  if (terminalStatuses.size > 1) conflicts.push('TERMINAL_STATUS_CONFLICT');
  let terminalStatus = terminalStatuses.size === 1 ? [...terminalStatuses][0] : null;

  const reconciliationByRevision = new Map<string, string>();
  const reconciliationByCut = new Map<string, string>();
  for (const item of reconciliation) {
    const prior = reconciliationByRevision.get(item.resultRevision);
    if (prior !== undefined && prior !== item.resultContentRevision) {
      conflicts.push('RECONCILIATION_REVISION_CONFLICT');
    } else reconciliationByRevision.set(item.resultRevision, item.resultContentRevision);
    if (item.status === 'EXACT') {
      const cutFingerprint = digest('reconciliation_cut_', {
        effect: item.effect,
        venueOrderId: item.venueOrderId,
        cumulativeFilledQuantity: item.cumulativeFilledQuantity,
      });
      const priorCut = reconciliationByCut.get(item.privateSourceCutRevision);
      if (priorCut !== undefined && priorCut !== cutFingerprint) {
        conflicts.push('RECONCILIATION_CUT_CONTENT_CONFLICT');
      } else {
        reconciliationByCut.set(item.privateSourceCutRevision, cutFingerprint);
      }
    }
  }
  const orderedReconciliation = [...reconciliation].sort((left, right) => (
    left.observedAtMs - right.observedAtMs || compareCodeUnits(left.resultRevision, right.resultRevision)
  ));
  const latestReconciliation = orderedReconciliation.at(-1) ?? null;
  let reconciliationStatus: FoundationReconciliationStatus | null = latestReconciliation?.status ?? null;
  let reconciliationEffect: FoundationMutationEffect | null = latestReconciliation?.effect ?? null;
  let reconciled = false;
  const exactCompleteEffects = new Set(reconciliation
    .filter((item) => item.status === 'EXACT'
      && (item.effect === 'FILLED' || item.effect === 'CANCELED'
        || item.effect === 'EXPIRED' || item.effect === 'REJECTED_NO_EFFECT_PROVEN'))
    .map((item) => item.effect));
  if (exactCompleteEffects.size > 1) conflicts.push('RECONCILIATION_EFFECT_CONFLICT');
  const exactCompleteReconciliations = orderedReconciliation.filter((item) => (
    item.status === 'EXACT' && (item.effect === 'FILLED' || item.effect === 'CANCELED'
      || item.effect === 'EXPIRED' || item.effect === 'REJECTED_NO_EFFECT_PROVEN')
  ));
  const latestExactComplete = exactCompleteReconciliations.at(-1) ?? null;
  if (latestExactComplete !== null && latestReconciliation !== latestExactComplete) {
    conflicts.push('RECONCILIATION_STRENGTH_REGRESSION');
    if (latestExactComplete.effect === 'REJECTED_NO_EFFECT_PROVEN') terminalStatus = 'REJECTED';
    if (latestExactComplete.effect === 'FILLED' || latestExactComplete.effect === 'CANCELED'
      || latestExactComplete.effect === 'EXPIRED') terminalStatus = latestExactComplete.effect;
  }
  if (latestReconciliationEntryVersion > 0
    && latestSemanticEvidenceVersion > latestReconciliationEntryVersion) {
    conflicts.push('RECONCILIATION_STALE_AFTER_NEW_EVIDENCE');
  }
  if (latestReconciliation !== null && latestReconciliation.status === 'EXACT') {
    if (observedVenueIds.size === 1
      && latestReconciliation.venueOrderId !== [...observedVenueIds][0]) {
      conflicts.push('RECONCILIATION_VENUE_ORDER_ID_MISMATCH');
    }
    if (latestReconciliation.effect === 'FILLED'
      && latestReconciliation.cumulativeFilledQuantity !== requestedQuantity) {
      conflicts.push('RECONCILED_FILLED_QUANTITY_MISMATCH');
    }
    if (latestReconciliation.effect === 'REJECTED_NO_EFFECT_PROVEN'
      && compareJournalQuantities(cumulativeFilledQuantity, '0') > 0) {
      conflicts.push('NO_EFFECT_CONTRADICTS_FILL');
    }
    if (latestReconciliation.effect === 'REJECTED_NO_EFFECT_PROVEN'
      && latestReconciliation.cumulativeFilledQuantity !== '0') {
      conflicts.push('NO_EFFECT_REQUIRES_EXACT_ZERO_QUANTITY');
    }
    const completeEffect = latestReconciliation.effect === 'FILLED'
      || latestReconciliation.effect === 'CANCELED'
      || latestReconciliation.effect === 'EXPIRED'
      || latestReconciliation.effect === 'REJECTED_NO_EFFECT_PROVEN';
    if ((latestReconciliation.effect === 'CANCELED' || latestReconciliation.effect === 'EXPIRED')
      && latestReconciliation.cumulativeFilledQuantity !== cumulativeFilledQuantity) {
      conflicts.push('RECONCILED_TERMINAL_QUANTITY_MISMATCH');
    }
    if (!conflicts.length && completeEffect) {
      reconciled = true;
      if (latestReconciliation.effect === 'REJECTED_NO_EFFECT_PROVEN') terminalStatus = 'REJECTED';
      if (latestReconciliation.effect === 'FILLED'
        || latestReconciliation.effect === 'CANCELED'
        || latestReconciliation.effect === 'EXPIRED') terminalStatus = latestReconciliation.effect;
    }
  }

  const conflictCodes = sortedUnique(conflicts, MUTATION_JOURNAL_LIMITS.maximumConflicts);
  const ambiguityCauses = sortedUnique(ambiguity, MUTATION_AMBIGUITY_CAUSES.length) as readonly MutationAmbiguityCause[];
  const hasCreated = entries.some((entry) => entry.kind === 'CREATED');
  const hasPreflight = entries.some((entry) => entry.kind === 'PREFLIGHTED');
  let lifecycle: MutationProjection['lifecycle'] = hasCreated ? 'CREATED' : 'CONFLICT';
  if (hasPreflight) lifecycle = 'PREFLIGHTED';
  if (submissionIntentPresent) lifecycle = 'SUBMITTING';
  if (httpAcknowledged) lifecycle = 'ACKNOWLEDGED';
  if (workingStatus === 'PENDING_NEW') lifecycle = 'ACKNOWLEDGED';
  if (httpRejectedResponseSeen || ambiguityCauses.length > 0) lifecycle = 'UNKNOWN';
  if (partialMixed) lifecycle = 'PARTIAL_MIXED';
  if (workingStatus === 'NEW') lifecycle = 'NEW';
  if (workingStatus === 'PARTIALLY_FILLED'
    || compareJournalQuantities(cumulativeFilledQuantity, '0') > 0) lifecycle = 'PARTIALLY_FILLED';
  if (terminalStatus !== null) lifecycle = terminalStatus;
  if (conflictCodes.length > 0) lifecycle = 'CONFLICT';
  if (reconciled && conflictCodes.length === 0) lifecycle = 'RECONCILED';
  const recoveryRequired = submissionIntentPresent && !reconciled;
  if (identity.contractState !== 'CURRENT' && submissionObserved) {
    throw new TypeError('blocked documentary contract cannot have a submission observation');
  }
  return deepFreezePrivate({
    lifecycle,
    submissionIntentPresent,
    submissionObserved,
    httpAcknowledged,
    httpRejectedResponseSeen,
    partialMixed,
    ambiguityCauses,
    workingStatus,
    cumulativeFilledQuantity,
    venueOrderId: venueIds.size === 1 ? [...venueIds][0] : null,
    tradeIds: sortedUnique([...tradeById.keys()], MUTATION_JOURNAL_LIMITS.maximumTrades),
    terminalStatus,
    reconciliationStatus,
    reconciliationEffect,
    reconciled,
    recoveryRequired,
    telemetryDegraded,
    externalTruthRefs: sortedUnique(externalTruthRefs, MUTATION_JOURNAL_LIMITS.maximumExternalTruthRefs),
    conflictCodes,
    evidenceOnly: true as const,
  });
}

function outcomeRevisionFor(
  identity: Readonly<MutationIdentityGraph>,
  bindings: Readonly<MutationEvidenceBindings>,
  requestedQuantity: string,
  entries: readonly Readonly<MutationJournalEntry>[],
  projection: Readonly<MutationProjection>,
): string {
  const semanticEvidence = entries
    .filter((entry) => entry.kind !== 'TELEMETRY_DEGRADED')
    .map((entry) => ({ observationId: entry.observationId, contentRevision: entry.contentRevision }))
    .sort((left, right) => compareCodeUnits(left.observationId, right.observationId)
      || compareCodeUnits(left.contentRevision, right.contentRevision));
  const semanticProjection = { ...projection, telemetryDegraded: false };
  return digest('l06outcome_', {
    identity,
    bindings,
    requestedQuantity,
    semanticEvidence,
    projection: semanticProjection,
  });
}

function snapshotFromEntries(values: readonly unknown[]): Readonly<MutationJournalSnapshot> {
  if (!Array.isArray(values) || values.length < 1 || values.length > MUTATION_JOURNAL_LIMITS.maximumEntries) {
    throw new RangeError('mutation journal must contain a bounded non-empty entry array');
  }
  const entries: Readonly<MutationJournalEntry>[] = [];
  let identity: Readonly<MutationIdentityGraph> | null = null;
  let bindings: Readonly<MutationEvidenceBindings> | null = null;
  let requestedQuantity: string | null = null;
  let mutationId: string | null = null;
  let head: string | null = null;
  const observationContent = new Map<string, string>();
  const telemetrySubsystems = new Set<TelemetryDegradedPayload['subsystem']>();
  const observationKindCounts = new Map<MutationEntryKind, number>();
  let preflightSeen = false;
  let submissionIntent: Readonly<MutationJournalEntry> | null = null;
  let submissionSeen = false;
  for (let index = 0; index < values.length; index += 1) {
    const entry = validateEntry(values[index], index + 1, head, identity, bindings, requestedQuantity);
    const entryLimit = BOUNDED_OBSERVATION_ENTRY_COUNTS[entry.kind];
    if (entryLimit !== undefined) {
      const nextCount = (observationKindCounts.get(entry.kind) ?? 0) + 1;
      if (nextCount > entryLimit) {
        throw new RangeError(`${entry.kind} journal capacity is exhausted`);
      }
      observationKindCounts.set(entry.kind, nextCount);
    }
    if (index === 0) {
      if (entry.kind !== 'CREATED') throw new TypeError('mutation journal must begin with CREATED');
      const payload = entry.payload as unknown as {
        identity: MutationIdentityGraph;
        bindings: MutationEvidenceBindings;
        requestedQuantity: string;
      };
      identity = payload.identity;
      bindings = payload.bindings;
      requestedQuantity = normalizeJournalQuantity(payload.requestedQuantity, 'journal requested quantity');
      mutationId = digest('l06mut_', {
        matrixSha256: L06_MATRIX_SHA256,
        identity,
        bindings,
        requestedQuantity,
      });
      if (entry.mutationId !== mutationId) throw new TypeError('journal mutation identity mismatch');
      if (entry.observationId !== digest('l06obs_', { mutationId, kind: 'CREATED' })
        || entry.occurredAtMs !== entry.receivedAtMs
        || entry.occurredAtMs < bindings.preflightEvaluatedAtMs
        || entry.occurredAtMs < bindings.privateEvaluatedAtMs
        || (identity.mutationKind !== 'CANCEL_ORDER' && entry.occurredAtMs > bindings.validUntilMs)
        || entry.sourceRevision !== bindings.preflightContentRevision) {
        throw new TypeError('CREATED entry does not bind its exact causal owner cut');
      }
    }
    if (entry.mutationId !== mutationId) throw new TypeError('cross-mutation journal entry');
    const previous = entries.at(-1) ?? null;
    if (previous !== null && entry.receivedAtMs < previous.receivedAtMs) {
      throw new TypeError('journal local receipt sequence regresses');
    }
    if (index > 0 && entry.kind === 'CREATED') throw new TypeError('CREATED entry may appear only once');
    if (entry.kind === 'PREFLIGHTED') {
      if (preflightSeen || submissionIntent !== null
        || entry.observationId !== digest('l06obs_', { mutationId, kind: 'PREFLIGHTED' })
        || entry.sourceRevision !== bindings!.preflightContentRevision
        || (identity!.mutationKind !== 'CANCEL_ORDER'
          && entry.receivedAtMs > bindings!.validUntilMs)) {
        throw new TypeError('PREFLIGHTED entry is duplicated, stale or owner-unbound');
      }
      preflightSeen = true;
    }
    if (entry.kind === 'SUBMISSION_INTENT') {
      if (!preflightSeen || submissionIntent !== null || submissionSeen
        || identity!.contractState !== 'CURRENT'
        || entry.observationId !== digest('l06obs_', { mutationId, kind: 'SUBMISSION_INTENT' })
        || entry.sourceRevision !== bindings!.preflightContentRevision
        || entry.occurredAtMs !== entry.receivedAtMs
        || (identity!.mutationKind !== 'CANCEL_ORDER'
          && entry.occurredAtMs > bindings!.validUntilMs)) {
        throw new TypeError('SUBMISSION_INTENT entry is duplicated, stale or causally invalid');
      }
      submissionIntent = entry;
    }
    if (entry.kind === 'SUBMISSION_OBSERVED') {
      const payload = entry.payload as Readonly<SubmissionObservedPayload>;
      const intentProjection = submissionIntent === null
        ? null
        : deriveProjection(entries, requestedQuantity!, identity!);
      const intentOutcomeRevision = intentProjection === null
        ? null
        : outcomeRevisionFor(identity!, bindings!, requestedQuantity!, entries, intentProjection);
      const expectedIntentAppendDigest = submissionIntent === null || intentOutcomeRevision === null
        ? null
        : appendRequestDigestFor({
          schema: L06_APPEND_REQUEST_SCHEMA,
          version: 1,
          ownerTarget: 'SYSTEM_INTEGRATION_LEDGER',
          mutationId: mutationId!,
          entryId: submissionIntent.entryId,
          idempotencyKey: `l06append:${mutationId}:${submissionIntent.journalVersion}`,
          expectedJournalVersion: submissionIntent.journalVersion - 1,
          nextJournalVersion: submissionIntent.journalVersion,
          previousHeadDigest: submissionIntent.previousHeadDigest,
          entry: deepFreezePrivate(snapshotPrivateData(submissionIntent)) as Readonly<MutationJournalEntry>,
          nextHeadDigest: head!,
          nextOutcomeRevision: intentOutcomeRevision,
          entryContentRevision: submissionIntent.contentRevision,
          externalActionAuthorization: 'NONE',
        });
      if (submissionIntent === null || submissionSeen || previous?.kind !== 'SUBMISSION_INTENT'
        || entry.observationId !== digest('l06obs_', {
          mutationId,
          kind: 'SUBMISSION_OBSERVED',
          payload,
        })
        || entry.sourceRevision !== payload.l06AttemptContentRevision
        || entry.occurredAtMs !== entry.receivedAtMs
        || entry.occurredAtMs < submissionIntent.occurredAtMs
        || payload.durableIntentCommittedAtMs < submissionIntent.receivedAtMs
        || entry.occurredAtMs < payload.durableIntentCommittedAtMs
        || payload.durableIntentAppendRequestDigest !== expectedIntentAppendDigest
        || entry.occurredAtMs > bindings!.validUntilMs) {
        throw new TypeError('SUBMISSION_OBSERVED entry is duplicated, stale or causally invalid');
      }
      submissionSeen = true;
    }
    if (entry.kind === 'HTTP_OBSERVED' || entry.kind === 'PRIVATE_ORDER_OBSERVED'
      || entry.kind === 'PRIVATE_FILL_OBSERVED' || entry.kind === 'FOUNDATION_RECONCILIATION_OBSERVED') {
      if (submissionIntent === null || entry.occurredAtMs < submissionIntent.occurredAtMs) {
        throw new TypeError('money observation predates its durable submission intent');
      }
    }
    if (entry.kind === 'TELEMETRY_DEGRADED') {
      const subsystem = (entry.payload as Readonly<TelemetryDegradedPayload>).subsystem;
      if (telemetrySubsystems.has(subsystem)
        || !isMutationTelemetryAppendCapacityAvailable(
          entry.journalVersion - 1,
          telemetrySubsystems.size,
        )) {
        throw new TypeError('telemetry degradation history is not canonically coalesced');
      }
      telemetrySubsystems.add(subsystem);
    }
    if (entry.kind === 'OBSERVATION_ID_CONFLICT') {
      const payload = entry.payload as Readonly<ObservationIdConflictPayload>;
      if (observationContent.get(payload.reusedObservationId) !== payload.existingContentRevision
        || payload.conflictingContentRevision === payload.existingContentRevision
        || entry.observationId !== digest('l06obs_', {
          mutationId,
          kind: 'OBSERVATION_ID_CONFLICT',
          payload,
        })) {
        throw new TypeError('observation identity conflict does not bind prior durable content');
      }
    }
    if (entry.kind === 'FOUNDATION_RECONCILIATION_OBSERVED') {
      const payload = entry.payload as Readonly<FoundationReconciliationObservedPayload>;
      if (payload.mutationId !== mutationId
        || payload.journalVersion !== index
        || payload.journalHeadDigest !== head
        || payload.observedAtMs < (previous?.receivedAtMs ?? 0)) {
        throw new TypeError('reconciliation entry does not bind its exact prior journal head');
      }
      const priorProjection = deriveProjection(entries, requestedQuantity!, identity!);
      const priorOutcome = outcomeRevisionFor(identity!, bindings!, requestedQuantity!, entries, priorProjection);
      if (payload.journalOutcomeRevision !== priorOutcome
        || payload.cumulativeFilledQuantity !== priorProjection.cumulativeFilledQuantity
        || (priorProjection.venueOrderId !== null
          && payload.venueOrderId !== priorProjection.venueOrderId)) {
        throw new TypeError('reconciliation entry does not bind its exact prior outcome');
      }
    }
    const prior = observationContent.get(entry.observationId);
    if (prior !== undefined) {
      if (prior !== entry.contentRevision) throw new TypeError('observation identity content conflict');
      throw new TypeError('exact duplicate observations must not be appended');
    }
    observationContent.set(entry.observationId, entry.contentRevision);
    entries.push(entry);
    head = headDigestFor(head, entry);
  }
  if (identity === null || bindings === null || requestedQuantity === null || mutationId === null || head === null) {
    throw new TypeError('mutation journal root is unavailable');
  }
  const projection = deriveProjection(entries, requestedQuantity, identity);
  const outcomeRevision = outcomeRevisionFor(identity, bindings, requestedQuantity, entries, projection);
  // The hostile-input snapshotter deliberately rejects aliases. Keep the
  // top-level convenience projection structurally independent from the
  // immutable CREATED payload so an adapter-produced snapshot can be fed
  // back through exactly the same validator as an external persistence read.
  const snapshotIdentity = deepFreezePrivate(snapshotPrivateData(identity)) as Readonly<MutationIdentityGraph>;
  const snapshotBindings = deepFreezePrivate(snapshotPrivateData(bindings)) as Readonly<MutationEvidenceBindings>;
  const snapshot = deepFreezePrivate({
    schema: L06_MUTATION_JOURNAL_SCHEMA,
    version: 1 as const,
    mutationId,
    identity: snapshotIdentity,
    bindings: snapshotBindings,
    requestedQuantity,
    journalVersion: entries.length,
    entries: Object.freeze(entries),
    projection,
    headDigest: head,
    outcomeRevision,
    persistenceProven: false as const,
    persistenceAuthority: 'NONE' as const,
    reconciliationAuthority: 'NONE' as const,
    capitalAuthority: 'NONE' as const,
    riskAuthority: 'NONE' as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  });
  assertSerializedByteBound(
    snapshot,
    MUTATION_JOURNAL_LIMITS.maximumSerializedSnapshotBytes,
    'mutation journal snapshot',
  );
  return snapshot;
}

function validateSnapshot(value: unknown): Readonly<MutationJournalSnapshot> {
  const record = exactRecord(value, SNAPSHOT_FIELDS, 'mutation journal snapshot');
  if (record.schema !== L06_MUTATION_JOURNAL_SCHEMA || record.version !== 1
    || record.persistenceProven !== false || record.persistenceAuthority !== 'NONE'
    || record.reconciliationAuthority !== 'NONE' || record.capitalAuthority !== 'NONE'
    || record.riskAuthority !== 'NONE' || record.actionAuthority !== 'NONE_RECORD_ONLY'
    || record.externalActionAuthorization !== 'NONE') {
    throw new TypeError('mutation journal snapshot authority/schema is invalid');
  }
  const entries = privateArray(record.entries, 'journal entries', MUTATION_JOURNAL_LIMITS.maximumEntries);
  const rebuilt = snapshotFromEntries(entries);
  const projectionRecord = privateRecord(record.projection, PROJECTION_FIELDS, 'mutation projection');
  if (canonicalJson(rebuilt.identity) !== canonicalJson(record.identity)
    || canonicalJson(rebuilt.bindings) !== canonicalJson(record.bindings)
    || canonicalJson(rebuilt.projection) !== canonicalJson(projectionRecord)
    || rebuilt.mutationId !== record.mutationId
    || rebuilt.requestedQuantity !== record.requestedQuantity
    || rebuilt.journalVersion !== record.journalVersion
    || rebuilt.headDigest !== record.headDigest
    || rebuilt.outcomeRevision !== record.outcomeRevision) {
    throw new TypeError('mutation journal snapshot does not regenerate canonically');
  }
  return rebuilt;
}

function appendRequestDigestFor(value: Omit<MutationAppendRequest, 'appendRequestDigest'>): string {
  return digest('l06append_', value);
}

function prepareAppend(
  current: Readonly<PersistedMutationJournal> | null,
  entry: Readonly<MutationJournalEntry>,
): Readonly<PreparedMutationAppend> {
  const prior = current === null ? null : validatePersistedMutationJournal(current);
  const expected = prior?.snapshot.journalVersion ?? 0;
  if (entry.journalVersion !== expected + 1
    || entry.previousHeadDigest !== (prior?.snapshot.headDigest ?? null)) {
    throw new TypeError('append entry does not extend the exact persisted journal head');
  }
  const nextSnapshot = snapshotFromEntries([
    ...(prior?.snapshot.entries ?? []),
    entry,
  ]);
  const base: Omit<MutationAppendRequest, 'appendRequestDigest'> = {
    schema: L06_APPEND_REQUEST_SCHEMA,
    version: 1,
    ownerTarget: 'SYSTEM_INTEGRATION_LEDGER',
    mutationId: nextSnapshot.mutationId,
    entryId: entry.entryId,
    idempotencyKey: `l06append:${nextSnapshot.mutationId}:${entry.journalVersion}`,
    expectedJournalVersion: expected,
    nextJournalVersion: entry.journalVersion,
    previousHeadDigest: entry.previousHeadDigest,
    entry: deepFreezePrivate(snapshotPrivateData(entry)) as Readonly<MutationJournalEntry>,
    nextHeadDigest: nextSnapshot.headDigest,
    nextOutcomeRevision: nextSnapshot.outcomeRevision,
    entryContentRevision: entry.contentRevision,
    externalActionAuthorization: 'NONE',
  };
  const request = validateRequest({ ...base, appendRequestDigest: appendRequestDigestFor(base) });
  return deepFreezePrivate({ request, nextSnapshot });
}

export function prepareInitialMutationAppend(value: unknown): Readonly<PreparedMutationAppend> {
  const input = normalizeCreateInput(value);
  const mutationId = digest('l06mut_', {
    matrixSha256: L06_MATRIX_SHA256,
    identity: input.identity,
    bindings: input.bindings,
    requestedQuantity: input.requestedQuantity,
  });
  const observationId = digest('l06obs_', { mutationId, kind: 'CREATED' });
  const entry = createEntry({
    mutationId,
    observationId,
    journalVersion: 1,
    previousHeadDigest: null,
    kind: 'CREATED',
    occurredAtMs: input.createdAtMs,
    receivedAtMs: input.createdAtMs,
    sourceRevision: input.bindings.preflightContentRevision,
    payload: deepFreezePrivate({
      identity: input.identity,
      bindings: input.bindings,
      preflightResult: input.preflightResult,
      requestedQuantity: input.requestedQuantity,
    }) as Readonly<MutationEntryPayload>,
  });
  return prepareAppend(null, entry);
}

export function preparePreflightMutationAppend(
  currentValue: unknown,
  receivedAtMsValue: unknown,
): Readonly<PreparedMutationAppend> {
  const current = validatePersistedMutationJournal(currentValue);
  const receivedAtMs = privateInteger(receivedAtMsValue, 'preflight receipt time', 0, MAX_UTC_MS);
  if (current.snapshot.projection.lifecycle !== 'CREATED'
    || receivedAtMs < current.snapshot.bindings.preflightEvaluatedAtMs
    || receivedAtMs < current.snapshot.entries.at(-1)!.receivedAtMs
    || (current.snapshot.identity.mutationKind !== 'CANCEL_ORDER'
      && receivedAtMs > current.snapshot.bindings.validUntilMs)) {
    throw new TypeError('preflight append is not current or causally valid');
  }
  const entry = createEntry({
    mutationId: current.snapshot.mutationId,
    observationId: digest('l06obs_', { mutationId: current.snapshot.mutationId, kind: 'PREFLIGHTED' }),
    journalVersion: current.snapshot.journalVersion + 1,
    previousHeadDigest: current.snapshot.headDigest,
    kind: 'PREFLIGHTED',
    occurredAtMs: current.snapshot.bindings.preflightEvaluatedAtMs,
    receivedAtMs,
    sourceRevision: current.snapshot.bindings.preflightContentRevision,
    payload: deepFreezePrivate({
      preflightContentRevision: current.snapshot.bindings.preflightContentRevision,
      preflightEvaluatedAtMs: current.snapshot.bindings.preflightEvaluatedAtMs,
    }),
  });
  return prepareAppend(current, entry);
}

export function prepareSubmissionIntentAppend(
  currentValue: unknown,
  occurredAtMsValue: unknown,
): Readonly<PreparedMutationAppend> {
  const current = validatePersistedMutationJournal(currentValue);
  const occurredAtMs = privateInteger(occurredAtMsValue, 'submission intent time', 0, MAX_UTC_MS);
  if (current.snapshot.projection.lifecycle !== 'PREFLIGHTED'
    || current.snapshot.identity.contractState !== 'CURRENT'
    || occurredAtMs < current.snapshot.entries.at(-1)!.receivedAtMs
    || (current.snapshot.identity.mutationKind !== 'CANCEL_ORDER'
      && occurredAtMs > current.snapshot.bindings.validUntilMs)) {
    throw new TypeError('submission intent is blocked by lifecycle, contract or time');
  }
  const entry = createEntry({
    mutationId: current.snapshot.mutationId,
    observationId: digest('l06obs_', { mutationId: current.snapshot.mutationId, kind: 'SUBMISSION_INTENT' }),
    journalVersion: current.snapshot.journalVersion + 1,
    previousHeadDigest: current.snapshot.headDigest,
    kind: 'SUBMISSION_INTENT',
    occurredAtMs,
    receivedAtMs: occurredAtMs,
    sourceRevision: current.snapshot.bindings.preflightContentRevision,
    payload: deepFreezePrivate({ reason: 'PERSIST_BEFORE_SYNTHETIC_DISPATCH' as const }),
  });
  return prepareAppend(current, entry);
}

function normalizeObservation(
  value: unknown,
  current: Readonly<PersistedMutationJournal>,
): Readonly<MutationObservationInput> {
  const record = exactRecord(value, [
    'observationId', 'kind', 'occurredAtMs', 'receivedAtMs', 'sourceRevision', 'payload',
  ], 'mutation observation');
  const observationId = revision(record.observationId, 'observation ID', OBSERVATION_ID);
  if (record.kind !== 'HTTP_OBSERVED'
    && record.kind !== 'PRIVATE_ORDER_OBSERVED'
    && record.kind !== 'PRIVATE_FILL_OBSERVED'
    && record.kind !== 'FOUNDATION_RECONCILIATION_OBSERVED'
    && record.kind !== 'TELEMETRY_DEGRADED') {
    throw new TypeError('mutation observation kind is invalid');
  }
  const occurredAtMs = privateInteger(record.occurredAtMs, 'observation occurrence time', 0, MAX_UTC_MS);
  const receivedAtMs = privateInteger(record.receivedAtMs, 'observation receipt time', 0, MAX_UTC_MS);
  if (receivedAtMs < occurredAtMs || receivedAtMs < current.snapshot.entries[0].receivedAtMs) {
    throw new TypeError('mutation observation causality is invalid');
  }
  const payload = validatePayload(
    record.kind,
    record.payload,
    current.snapshot.identity,
    current.snapshot.bindings,
    current.snapshot.requestedQuantity,
  );
  if ((record.kind === 'PRIVATE_ORDER_OBSERVED' || record.kind === 'PRIVATE_FILL_OBSERVED')
    && (payload as Readonly<PrivateOrderObservedPayload | PrivateFillObservedPayload>).exchangeEventTimeMs !== occurredAtMs) {
    throw new TypeError('private observation occurrence must equal its exchange event time');
  }
  const sourceRevision = revision(record.sourceRevision, 'observation source revision');
  if (record.kind === 'HTTP_OBSERVED'
    && sourceRevision !== (payload as Readonly<HttpObservedPayload>).l06AttemptContentRevision) {
    throw new TypeError('HTTP observation source must equal its exact L03 attempt content revision');
  }
  if ((record.kind === 'PRIVATE_ORDER_OBSERVED' || record.kind === 'PRIVATE_FILL_OBSERVED')
    && sourceRevision
      !== (payload as Readonly<PrivateOrderObservedPayload | PrivateFillObservedPayload>).privateEventRevision) {
    throw new TypeError('private observation source must equal its exact L05 event revision');
  }
  if (record.kind === 'FOUNDATION_RECONCILIATION_OBSERVED'
    && sourceRevision !== (payload as Readonly<FoundationReconciliationObservedPayload>).resultRevision) {
    throw new TypeError('reconciliation source must equal its Foundation result revision');
  }
  if ((record.kind === 'PRIVATE_ORDER_OBSERVED' || record.kind === 'PRIVATE_FILL_OBSERVED')
    && receivedAtMs
      !== (payload as Readonly<PrivateOrderObservedPayload | PrivateFillObservedPayload>).privateReceiptTimeMs) {
    throw new TypeError('private observation receipt must equal its exact L05 marker receipt');
  }
  if (record.kind !== 'TELEMETRY_DEGRADED'
    && !current.snapshot.projection.submissionIntentPresent) {
    throw new TypeError('money observation requires a durable submission intent');
  }
  if ((record.kind === 'HTTP_OBSERVED')
    && (payload as Readonly<HttpObservedPayload>).classification === 'PARTIAL_MIXED'
    && current.snapshot.identity.mutationKind !== 'CANCEL_REPLACE') {
    throw new TypeError('partial-mixed HTTP truth is operation-specific to cancel-replace');
  }
  return deepFreezePrivate({
    observationId,
    kind: record.kind,
    occurredAtMs,
    receivedAtMs,
    sourceRevision,
    payload,
  });
}

function observationIdFor(
  mutationId: string,
  input: Omit<MutationObservationInput, 'observationId'>,
): string {
  return digest('l06obs_', {
    mutationId,
    kind: input.kind,
    occurredAtMs: input.occurredAtMs,
    receivedAtMs: input.receivedAtMs,
    sourceRevision: input.sourceRevision,
    payload: input.payload,
  });
}

export function prepareMutationObservationAppend(
  currentValue: unknown,
  observationValue: unknown,
): Readonly<PrepareObservationAppendResult> {
  const current = validatePersistedMutationJournal(currentValue);
  const observation = normalizeObservation(observationValue, current);
  const expectedObservationId = observationIdFor(current.snapshot.mutationId, {
    kind: observation.kind,
    occurredAtMs: observation.occurredAtMs,
    receivedAtMs: observation.receivedAtMs,
    sourceRevision: observation.sourceRevision,
    payload: observation.payload,
  });
  const candidate = createEntry({
    mutationId: current.snapshot.mutationId,
    observationId: observation.observationId,
    journalVersion: current.snapshot.journalVersion + 1,
    previousHeadDigest: current.snapshot.headDigest,
    kind: observation.kind,
    occurredAtMs: observation.occurredAtMs,
    receivedAtMs: observation.receivedAtMs,
    sourceRevision: observation.sourceRevision,
    payload: observation.payload,
  });
  const existing = current.snapshot.entries.find((entry) => entry.observationId === observation.observationId);
  if (existing !== undefined) {
    if (existing.contentRevision === candidate.contentRevision) {
      return deepFreezePrivate({ kind: 'EXACT_DUPLICATE' as const, persisted: current });
    }
    const payload = deepFreezePrivate({
      reusedObservationId: observation.observationId,
      existingContentRevision: existing.contentRevision,
      conflictingContentRevision: candidate.contentRevision,
    }) as Readonly<ObservationIdConflictPayload>;
    const conflictObservationId = digest('l06obs_', {
      mutationId: current.snapshot.mutationId,
      kind: 'OBSERVATION_ID_CONFLICT',
      payload,
    });
    const persistedConflict = current.snapshot.entries.find((entry) => (
      entry.observationId === conflictObservationId
    ));
    if (persistedConflict !== undefined) {
      return deepFreezePrivate({
        kind: 'IDENTITY_CONFLICT' as const,
        reasonCode: 'OBSERVATION_ID_REUSED' as const,
        preparedConflict: null,
        persistedConflict: current,
      });
    }
    const conflictEntry = createEntry({
      mutationId: current.snapshot.mutationId,
      observationId: conflictObservationId,
      journalVersion: current.snapshot.journalVersion + 1,
      previousHeadDigest: current.snapshot.headDigest,
      kind: 'OBSERVATION_ID_CONFLICT',
      occurredAtMs: observation.occurredAtMs,
      receivedAtMs: Math.max(
        observation.receivedAtMs,
        current.snapshot.entries.at(-1)!.receivedAtMs,
      ),
      sourceRevision: observation.sourceRevision,
      payload,
    });
    return deepFreezePrivate({
      kind: 'IDENTITY_CONFLICT' as const,
      reasonCode: 'OBSERVATION_ID_REUSED' as const,
      preparedConflict: prepareAppend(current, conflictEntry),
      persistedConflict: null,
    });
  }
  if (observation.observationId !== expectedObservationId) {
    throw new TypeError('observation ID does not bind its exact mutation/content envelope');
  }
  const submissionIntent = current.snapshot.entries.find((entry) => entry.kind === 'SUBMISSION_INTENT');
  if (observation.kind !== 'TELEMETRY_DEGRADED'
    && (submissionIntent === undefined || observation.occurredAtMs < submissionIntent.occurredAtMs)) {
    throw new TypeError('money observation predates its durable submission intent');
  }
  if (observation.kind === 'FOUNDATION_RECONCILIATION_OBSERVED') {
    const reconciled = observation.payload as Readonly<FoundationReconciliationObservedPayload>;
    if (reconciled.mutationId !== current.snapshot.mutationId
      || reconciled.journalVersion !== current.snapshot.journalVersion
      || reconciled.journalHeadDigest !== current.snapshot.headDigest
      || reconciled.journalOutcomeRevision !== current.snapshot.outcomeRevision
      || reconciled.observedAtMs !== observation.occurredAtMs
      || reconciled.observedAtMs < current.snapshot.entries.at(-1)!.receivedAtMs) {
      throw new TypeError('Foundation reconciliation does not bind the exact current journal/private cut');
    }
  }
  if (observation.kind === 'TELEMETRY_DEGRADED') {
    const telemetryEntries = current.snapshot.entries.filter((entry) => entry.kind === 'TELEMETRY_DEGRADED');
    const subsystem = (observation.payload as Readonly<TelemetryDegradedPayload>).subsystem;
    if (telemetryEntries.some((entry) => (
      (entry.payload as Readonly<TelemetryDegradedPayload>).subsystem === subsystem
    ))) {
      throw new TypeError('telemetry degradation is already recorded for this canonical subsystem');
    }
    if (!isMutationTelemetryAppendCapacityAvailable(
      current.snapshot.journalVersion,
      telemetryEntries.length,
    )) {
      throw new RangeError('money-critical journal capacity is reserved');
    }
  }
  if (observation.receivedAtMs < current.snapshot.entries.at(-1)!.receivedAtMs) {
    throw new TypeError('local observation receipt regresses behind the durable journal tail');
  }
  return deepFreezePrivate({ kind: 'PREPARED' as const, prepared: prepareAppend(current, candidate) });
}

const FOUNDATION_SECRET_FIELD = /(?:api.?key|secret|signature|credential|password|passphrase|mnemonic|seed(?:phrase)?|authorization|bearer|listen.?key|access.?key|session.?token|private.?key)/iu;
const FOUNDATION_SECRET_TEXT = /(?:\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\b(?:api.?key|secret|token|password|authorization)\s*[:=]\s*\S)/iu;

function opaqueExactRecord(
  value: unknown,
  fields: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must be a non-proxy data record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must have a plain prototype`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length
    || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
    throw new TypeError(`${label} must contain exactly: ${fields.join(', ')}`);
  }
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label}.${field} must be an enumerable data property`);
    }
    output[field] = descriptor.value;
  }
  return Object.freeze(output);
}

function snapshotFoundationOwnerData(value: unknown): unknown {
  const seen = new Set<object>();
  const budget = { nodes: 0, stringUnits: 0 };
  const visit = (item: unknown, depth: number): unknown => {
    budget.nodes += 1;
    if (depth > 10 || budget.nodes > 8_192) {
      throw new RangeError('Foundation result exceeds the L06 owner-input graph bound');
    }
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('Foundation result number is invalid');
      return Object.is(item, -0) ? 0 : item;
    }
    if (typeof item === 'string') {
      if (item.length > 512
        || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(item)
        || FOUNDATION_SECRET_TEXT.test(item)) {
        throw new TypeError('Foundation result text is unsafe or overbound');
      }
      budget.stringUnits += item.length;
      if (budget.stringUnits > 131_072) throw new RangeError('Foundation result text budget exceeded');
      return item;
    }
    if (typeof item !== 'object' || utilTypes.isProxy(item)) {
      throw new TypeError('Foundation result must be plain JSON-like data');
    }
    if (seen.has(item)) throw new TypeError('Foundation result aliases/cycles are forbidden');
    seen.add(item);
    const prototype = Object.getPrototypeOf(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) throw new TypeError('Foundation result symbol keys are forbidden');
    if (Array.isArray(item)) {
      if (prototype !== Array.prototype || item.length > 256 || keys.length !== item.length + 1) {
        throw new RangeError('Foundation result array is invalid or overbound');
      }
      const output: unknown[] = [];
      for (let index = 0; index < item.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('Foundation result array must be dense data');
        }
        output.push(visit(descriptor.value, depth + 1));
      }
      return output;
    }
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Foundation result objects must be plain');
    }
    if (keys.length > 64) throw new RangeError('Foundation result object is overbound');
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      if (key.length > 128 || FOUNDATION_SECRET_FIELD.test(key)) {
        throw new TypeError('secret-shaped Foundation result field is forbidden');
      }
      budget.stringUnits += key.length;
      if (budget.stringUnits > 131_072) throw new RangeError('Foundation result text budget exceeded');
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('Foundation result objects require enumerable data fields');
      }
      output[key] = visit(descriptor.value, depth + 1);
    }
    return output;
  };
  return visit(value, 0);
}

function binary64QuantityProjection(value: unknown, label: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite non-negative Foundation number`);
  }
  const projected = String(Object.is(value, -0) ? 0 : value);
  if (/[eE]/u.test(projected)) throw new TypeError(`${label} exponent form is outside the L06 comparison subset`);
  return normalizeJournalQuantity(projected, label);
}

function nullableBinary64QuantityProjection(value: unknown, label: string): string | null {
  return value === null ? null : binary64QuantityProjection(value, label);
}

const FOUNDATION_OWNER_RESULT_FIELDS = Object.freeze([
  'planId', 'correlationId', 'evaluatedAtMs', 'status', 'recommendation',
  'executionAuthority', 'reasons', 'legs', 'positions', 'sources', 'normalization',
] as const);
const FOUNDATION_OWNER_LEG_FIELDS = Object.freeze([
  'phase', 'legKey', 'clientOrderId', 'venueOrderId', 'expectedLifecycle',
  'expectedSubmittedQuantity', 'expectedFilledQuantity', 'observedOrderStatus',
  'observedOrderFilledQuantity', 'observedTradeFilledQuantity',
  'observedFilledQuantity', 'observedRemainderQuantity', 'status', 'reasonCodes',
] as const);
const FOUNDATION_OWNER_POSITION_FIELDS = Object.freeze([
  'venue', 'expectedDeltaQuantity', 'observedDeltaQuantity', 'differenceQuantity',
  'status', 'reasonCodes',
] as const);
const FOUNDATION_OWNER_SOURCE_FIELDS = Object.freeze([
  'sourceId', 'sourceTimeMs', 'receivedAtMs', 'maxAgeMs', 'freshness',
  'authority', 'completeness', 'coverageStartMs', 'coverageEndMs', 'status',
  'reasonCodes',
] as const);
const FOUNDATION_OWNER_REASON_FIELDS = Object.freeze([
  'code', 'status', 'detail', 'evidenceKind', 'phase', 'legKey',
] as const);
const FOUNDATION_OWNER_NORMALIZATION_FIELDS = Object.freeze([
  'exactDuplicateOrdersDropped', 'exactDuplicateFillsDropped',
  'exactDuplicatePositionsDropped', 'outOfOrderFillPairs',
] as const);
const FOUNDATION_SOURCE_FIELDS = Object.freeze(['orders', 'fills', 'positions'] as const);
const FOUNDATION_PRIVATE_AUTHORITIES = Object.freeze([
  'LIVE_PRIVATE', 'RECORDED_REPLAY', 'SYNTHETIC_TEST',
] as const);
const FOUNDATION_FRESHNESS_STATES = Object.freeze([
  'FRESH', 'STALE', 'UNAVAILABLE', 'CLOCK_SKEWED',
] as const);
const FOUNDATION_COMPLETENESS_STATES = Object.freeze([
  'COMPLETE', 'PARTIAL', 'UNAVAILABLE',
] as const);

function foundationReasonCodes(value: unknown, label: string): readonly string[] {
  const reasons = privateArray(value, label, 64)
    .map((item) => privateString(item, `${label} item`, 96));
  if (new Set(reasons).size !== reasons.length) throw new TypeError(`${label} contains duplicates`);
  for (const reason of reasons) {
    if (!REASON_CODE.test(reason)) throw new TypeError(`${label} contains an invalid code`);
  }
  return Object.freeze(reasons);
}

function foundationFiniteNumber(value: unknown, label: string, nonNegative = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (nonNegative && value < 0)) {
    throw new TypeError(`${label} must be a finite${nonNegative ? ' non-negative' : ''} number`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function foundationNullableNumber(
  value: unknown,
  label: string,
  nonNegative = false,
): number | null {
  return value === null ? null : foundationFiniteNumber(value, label, nonNegative);
}

function validateFoundationOwnerLeg(value: unknown, label: string): Readonly<Record<string, unknown>> {
  const leg = privateRecord(value, FOUNDATION_OWNER_LEG_FIELDS, label);
  if ((leg.phase !== 'OPEN' && leg.phase !== 'CLOSE')
    || (leg.legKey !== 'SPOT' && leg.legKey !== 'PERP')
    || !isValidClientOrderId(leg.clientOrderId)
    || !(LEG_LIFECYCLES as readonly unknown[]).includes(leg.expectedLifecycle)
    || (leg.observedOrderStatus !== null
      && !['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'UNKNOWN']
        .includes(leg.observedOrderStatus as string))
    || !includes(FOUNDATION_RECONCILIATION_STATUSES, leg.status)) {
    throw new TypeError(`${label} has an invalid canonical identity/status tuple`);
  }
  optionalVenueOrderId(leg.venueOrderId, `${label} venue order ID`);
  foundationFiniteNumber(leg.expectedSubmittedQuantity, `${label} expected submitted quantity`, true);
  foundationFiniteNumber(leg.expectedFilledQuantity, `${label} expected filled quantity`, true);
  foundationNullableNumber(leg.observedOrderFilledQuantity, `${label} observed order fill`, true);
  foundationNullableNumber(leg.observedTradeFilledQuantity, `${label} observed trade fill`, true);
  foundationNullableNumber(leg.observedFilledQuantity, `${label} observed fill`, true);
  foundationNullableNumber(leg.observedRemainderQuantity, `${label} observed remainder`, true);
  const reasonCodes = foundationReasonCodes(leg.reasonCodes, `${label} reason codes`);
  if (leg.status === 'EXACT' && reasonCodes.length !== 0) {
    throw new TypeError(`${label} EXACT status cannot retain reason codes`);
  }
  return leg;
}

function validateFoundationOwnerPosition(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  const position = privateRecord(value, FOUNDATION_OWNER_POSITION_FIELDS, label);
  if ((position.venue !== 'BINANCE_SPOT' && position.venue !== 'BINANCE_USDM')
    || !includes(FOUNDATION_RECONCILIATION_STATUSES, position.status)) {
    throw new TypeError(`${label} has an invalid venue/status tuple`);
  }
  const expected = foundationFiniteNumber(position.expectedDeltaQuantity, `${label} expected delta`);
  const observed = foundationNullableNumber(position.observedDeltaQuantity, `${label} observed delta`);
  const difference = foundationNullableNumber(position.differenceQuantity, `${label} difference`);
  if ((observed === null) !== (difference === null)
    || (observed !== null && difference !== observed - expected)) {
    throw new TypeError(`${label} difference does not reproduce from observed minus expected`);
  }
  const reasonCodes = foundationReasonCodes(position.reasonCodes, `${label} reason codes`);
  if (position.status === 'EXACT' && (observed === null || reasonCodes.length !== 0)) {
    throw new TypeError(`${label} EXACT status requires an observed quantity and no reasons`);
  }
  return position;
}

function validateFoundationOwnerSource(
  value: unknown,
  label: string,
  evaluatedAtMs: number,
  historyRequired: boolean,
): Readonly<Record<string, unknown>> {
  const source = privateRecord(value, FOUNDATION_OWNER_SOURCE_FIELDS, label);
  privateString(source.sourceId, `${label} source ID`, 128);
  const sourceTimeMs = source.sourceTimeMs === null
    ? null
    : privateInteger(source.sourceTimeMs, `${label} source time`, 0, MAX_UTC_MS);
  const receivedAtMs = privateInteger(source.receivedAtMs, `${label} received time`, 0, MAX_UTC_MS);
  const maxAgeMs = privateInteger(source.maxAgeMs, `${label} maximum age`, 1, MAX_UTC_MS);
  const coverageStartMs = source.coverageStartMs === null
    ? null
    : privateInteger(source.coverageStartMs, `${label} coverage start`, 0, MAX_UTC_MS);
  const coverageEndMs = source.coverageEndMs === null
    ? null
    : privateInteger(source.coverageEndMs, `${label} coverage end`, 0, MAX_UTC_MS);
  if (!includes(FOUNDATION_FRESHNESS_STATES, source.freshness)
    || (!includes(FOUNDATION_PRIVATE_AUTHORITIES, source.authority)
      && source.authority !== 'UNAVAILABLE')
    || !includes(FOUNDATION_COMPLETENESS_STATES, source.completeness)
    || !includes(FOUNDATION_RECONCILIATION_STATUSES, source.status)
    || ((coverageStartMs === null) !== (coverageEndMs === null))
    || (coverageStartMs !== null && coverageEndMs !== null && coverageStartMs > coverageEndMs)) {
    throw new TypeError(`${label} has an invalid canonical evidence tuple`);
  }
  const reasonCodes = foundationReasonCodes(source.reasonCodes, `${label} reason codes`);
  if (source.status === 'EXACT') {
    const freshnessTime = sourceTimeMs ?? receivedAtMs;
    if (source.freshness !== 'FRESH'
      || !includes(FOUNDATION_PRIVATE_AUTHORITIES, source.authority)
      || source.completeness !== 'COMPLETE'
      || reasonCodes.length !== 0
      || receivedAtMs > evaluatedAtMs
      || freshnessTime > evaluatedAtMs
      || evaluatedAtMs - freshnessTime > maxAgeMs
      || (historyRequired && (coverageStartMs === null || coverageEndMs === null
        || coverageEndMs < freshnessTime))) {
      throw new TypeError(`${label} EXACT status lacks fresh complete private evidence`);
    }
  }
  return source;
}

function validateFoundationOwnerReason(value: unknown, label: string): Readonly<Record<string, unknown>> {
  const reason = privateRecord(value, FOUNDATION_OWNER_REASON_FIELDS, label);
  if (!REASON_CODE.test(privateString(reason.code, `${label} code`, 96))
    || !includes(FOUNDATION_RECONCILIATION_STATUSES, reason.status)
    || (reason.evidenceKind !== null
      && reason.evidenceKind !== 'ORDERS'
      && reason.evidenceKind !== 'FILLS'
      && reason.evidenceKind !== 'POSITIONS')
    || (reason.phase !== null && reason.phase !== 'OPEN' && reason.phase !== 'CLOSE')
    || (reason.legKey !== null && reason.legKey !== 'SPOT' && reason.legKey !== 'PERP')) {
    throw new TypeError(`${label} is invalid`);
  }
  privateString(reason.detail, `${label} detail`, 512);
  return reason;
}

function validateCanonicalFoundationOwnerResult(
  value: unknown,
  evaluatedAtMs: number,
): Readonly<{
  result: Readonly<Record<string, unknown>>;
  legs: readonly Readonly<Record<string, unknown>>[];
}> {
  const result = privateRecord(value, FOUNDATION_OWNER_RESULT_FIELDS, 'canonical Foundation reconciliation result');
  const reasons = privateArray(result.reasons, 'Foundation result reasons', 256)
    .map((item, index) => validateFoundationOwnerReason(item, `Foundation result reason ${index}`));
  const legs = privateArray(result.legs, 'Foundation result legs', 4)
    .map((item, index) => validateFoundationOwnerLeg(item, `Foundation result leg ${index}`));
  if (legs.length !== 4
    || new Set(legs.map((leg) => `${leg.phase as string}:${leg.legKey as string}`)).size !== 4
    || new Set(legs.map((leg) => leg.clientOrderId as string)).size !== 4) {
    throw new TypeError('Foundation result requires the four unique OPEN/CLOSE x SPOT/PERP legs');
  }
  const positions = privateArray(result.positions, 'Foundation result positions', 2)
    .map((item, index) => validateFoundationOwnerPosition(item, `Foundation position ${index}`));
  if (positions.length !== 2 || new Set(positions.map((position) => position.venue as string)).size !== 2) {
    throw new TypeError('Foundation result requires exact Spot and USD-M position comparisons');
  }
  const sources = privateRecord(result.sources, FOUNDATION_SOURCE_FIELDS, 'Foundation result sources');
  const sourceReports = [
    validateFoundationOwnerSource(sources.orders, 'Foundation orders source', evaluatedAtMs, true),
    validateFoundationOwnerSource(sources.fills, 'Foundation fills source', evaluatedAtMs, true),
    validateFoundationOwnerSource(sources.positions, 'Foundation positions source', evaluatedAtMs, false),
  ];
  const normalization = privateRecord(
    result.normalization,
    FOUNDATION_OWNER_NORMALIZATION_FIELDS,
    'Foundation normalization statistics',
  );
  for (const field of FOUNDATION_OWNER_NORMALIZATION_FIELDS) {
    privateInteger(normalization[field], `Foundation normalization ${field}`, 0, Number.MAX_SAFE_INTEGER);
  }
  const resultSummary = normalizeFoundationResultSummary({
    planId: result.planId,
    correlationId: result.correlationId,
    evaluatedAtMs: result.evaluatedAtMs,
    status: result.status,
    recommendation: result.recommendation,
    executionAuthority: result.executionAuthority,
  });
  const componentStatuses = [
    ...legs.map((leg) => leg.status),
    ...positions.map((position) => position.status),
    ...sourceReports.map((source) => source.status),
    ...reasons.map((reason) => reason.status),
  ] as FoundationReconciliationStatus[];
  const severity: Readonly<Record<FoundationReconciliationStatus, number>> = Object.freeze({
    EXACT: 0, PENDING: 1, PARTIAL: 2, STALE: 3, UNAVAILABLE: 4,
    AMBIGUOUS: 5, DIVERGED: 6,
  });
  const worst = componentStatuses.reduce<FoundationReconciliationStatus>(
    (current, status) => severity[status] > severity[current] ? status : current,
    'EXACT',
  );
  if (resultSummary.status !== worst
    || (resultSummary.status === 'EXACT'
      && (resultSummary.recommendation !== 'NO_ACTION' || reasons.length !== 0))
    || (resultSummary.status !== 'EXACT' && resultSummary.recommendation === 'NO_ACTION')) {
    throw new TypeError('Foundation result status/recommendation does not reproduce from canonical evidence');
  }
  return deepFreezePrivate({ result, legs });
}

export function buildFoundationReconciliationObservation(
  currentValue: unknown,
  inputValue: unknown,
): Readonly<MutationObservationInput> {
  const current = validatePersistedMutationJournal(currentValue);
  const input = opaqueExactRecord(
    inputValue,
    ['resultRevision', 'result', 'privateProjection', 'privateLifecycleWitness', 'receivedAtMs'],
    'Foundation reconciliation builder input',
  );
  const resultRevision = revision(input.resultRevision, 'Foundation result revision', FOUNDATION_RESULT_REVISION);
  const resultSnapshot = snapshotFoundationOwnerData(input.result);
  const resultRecord = privateRecord(
    resultSnapshot,
    FOUNDATION_OWNER_RESULT_FIELDS,
    'canonical Foundation reconciliation result',
  );
  const result = resultRecord;
  const evaluatedAtMs = privateInteger(result.evaluatedAtMs, 'Foundation evaluation time', 0, MAX_UTC_MS);
  const receivedAtMs = privateInteger(input.receivedAtMs, 'Foundation result receipt time', evaluatedAtMs, MAX_UTC_MS);
  if (evaluatedAtMs < current.snapshot.entries.at(-1)!.receivedAtMs) {
    throw new TypeError('Foundation result evaluation predates the exact journal head');
  }
  const canonicalResult = validateCanonicalFoundationOwnerResult(result, evaluatedAtMs);
  const privateProjection = validatePrivateTruthProjection(input.privateProjection);
  const privateLifecycleWitness = validatePrivateLifecycleWitness(input.privateLifecycleWitness);
  if (current.snapshot.identity.product === 'MARGIN') {
    throw new TypeError('Margin has no L05 execution-private lifecycle owner cut');
  }
  const expectedPosture = current.snapshot.identity.product === 'SPOT'
    ? 'SPOT_NEW_EXPOSURE'
    : 'USDM_NEW_EXPOSURE';
  const privateOwnerBinding = createWaitingPrivateTruthBinding({
    currentSymbol: current.snapshot.identity.symbol,
    currentInstrumentRevision: current.snapshot.bindings.instrumentRevision,
    currentInstrumentEvidenceRevision: current.snapshot.bindings.sourceEvidenceRevision,
    currentInstrumentSnapshotRevision: current.snapshot.bindings.snapshotRevision,
    projection: privateProjection,
    lifecycleWitnesses: [privateLifecycleWitness],
  });
  const selectedProjection = current.snapshot.identity.product === 'SPOT'
    ? privateProjection.spot
    : privateProjection.futures;
  if (privateProjection.accountRealmId !== current.snapshot.identity.accountRealmId
    || privateProjection.targetSymbol !== current.snapshot.identity.symbol
    || privateProjection.evaluatedAtMs !== evaluatedAtMs
    || privateProjection.posture !== expectedPosture
    || privateProjection.entryEvidenceComplete !== true
    || privateProjection.completeness !== 'COMPLETE'
    || privateProjection.reasonCodes.length !== 0
    || selectedProjection.completeness !== 'COMPLETE'
    || selectedProjection.reasonCodes.length !== 0
    || privateOwnerBinding.privateProjectionRevision === current.snapshot.bindings.privateProjectionRevision
    || privateOwnerBinding.reconciliationCutRevision === current.snapshot.bindings.privateSourceCutRevision
    || privateProjection.reconciliationObservation === null) {
    throw new TypeError('post-action L05 private projection is incomplete, stale or crosses journal identity');
  }
  if (privateLifecycleWitness.product !== current.snapshot.identity.product
    || privateLifecycleWitness.accountRealmId !== current.snapshot.identity.accountRealmId
    || privateLifecycleWitness.evaluatedAtMs !== evaluatedAtMs
    || privateLifecycleWitness.acceptableForOwnerComparison !== true
    || privateLifecycleWitness.reasonCodes.length !== 0
    || privateOwnerBinding.lifecycleRevisions.length !== 1
    || privateOwnerBinding.lifecycleRevisions[0] !== privateLifecycleWitness.lifecycleRevision
    || current.snapshot.bindings.lifecycleRevisions.includes(privateLifecycleWitness.lifecycleRevision)) {
    throw new TypeError('post-action L05 lifecycle witness is incomplete, stale or crosses journal identity');
  }
  const resultSummary = normalizeFoundationResultSummary({
    planId: result.planId,
    correlationId: result.correlationId,
    evaluatedAtMs,
    status: result.status,
    recommendation: result.recommendation,
    executionAuthority: result.executionAuthority,
  });
  if (resultSummary.planId !== current.snapshot.identity.ticketId
    || resultSummary.correlationId !== current.snapshot.identity.globalCorrelationId) {
    throw new TypeError('Foundation result does not match the journal plan/correlation identity');
  }
  const matching = canonicalResult.legs.filter((item) => (
    item.clientOrderId === current.snapshot.identity.clientOrderId
  ));
  if (matching.length !== 1) throw new TypeError('Foundation result requires exactly one matching journal leg');
  const leg = privateRecord(matching[0], [
    'phase', 'legKey', 'clientOrderId', 'venueOrderId', 'expectedLifecycle',
    'expectedSubmittedQuantity', 'expectedFilledQuantity', 'observedOrderStatus',
    'observedOrderFilledQuantity', 'observedTradeFilledQuantity',
    'observedFilledQuantity', 'observedRemainderQuantity', 'status', 'reasonCodes',
  ], 'canonical Foundation reconciled leg');
  if (!Array.isArray(leg.reasonCodes)) throw new TypeError('Foundation leg reason codes must be an array');
  const legSummary = normalizeFoundationLegSummary({
    phase: leg.phase,
    legKey: leg.legKey,
    clientOrderId: leg.clientOrderId,
    venueOrderId: leg.venueOrderId,
    expectedLifecycle: leg.expectedLifecycle,
    expectedSubmittedQuantityProjection: binary64QuantityProjection(
      leg.expectedSubmittedQuantity,
      'Foundation expected submitted quantity',
    ),
    expectedFilledQuantityProjection: binary64QuantityProjection(
      leg.expectedFilledQuantity,
      'Foundation expected filled quantity',
    ),
    observedOrderStatus: leg.observedOrderStatus,
    observedOrderFilledQuantityProjection: nullableBinary64QuantityProjection(
      leg.observedOrderFilledQuantity,
      'Foundation observed order fill',
    ),
    observedTradeFilledQuantityProjection: nullableBinary64QuantityProjection(
      leg.observedTradeFilledQuantity,
      'Foundation observed trade fill',
    ),
    observedFilledQuantityProjection: nullableBinary64QuantityProjection(
      leg.observedFilledQuantity,
      'Foundation observed fill',
    ),
    observedRemainderQuantityProjection: nullableBinary64QuantityProjection(
      leg.observedRemainderQuantity,
      'Foundation observed remainder',
    ),
    status: leg.status,
    reasonCodes: leg.reasonCodes,
  });
  const expectedLegKey = current.snapshot.identity.product === 'SPOT' ? 'SPOT' : 'PERP';
  if (legSummary.legKey !== expectedLegKey) throw new TypeError('Foundation leg key crosses mutation product');
  const privateTruth = normalizePrivateReconciliationSummary(
    privateProjection.reconciliationObservation,
    current.snapshot.identity.product,
  );
  if (privateTruth.summary.resultRevision !== resultRevision
    || privateTruth.summary.observedAtMs !== evaluatedAtMs) {
    throw new TypeError('L05 reconciliation observation does not bind the Foundation result cut');
  }
  const exactJournalQuantity = current.snapshot.projection.cumulativeFilledQuantity;
  const effect = derivedReconciliationEffect(
    resultSummary,
    legSummary,
    exactJournalQuantity,
    current.snapshot.requestedQuantity,
  );
  if (current.snapshot.projection.venueOrderId !== null
    && legSummary.venueOrderId !== current.snapshot.projection.venueOrderId) {
    throw new TypeError('Foundation leg venue identity conflicts with journal private truth');
  }
  const payload = validateReconciliationPayload({
    owner: 'FOUNDATION_RECONCILIATION',
    mutationId: current.snapshot.mutationId,
    product: current.snapshot.identity.product,
    accountRealmId: current.snapshot.identity.accountRealmId,
    clientOrderId: current.snapshot.identity.clientOrderId,
    journalVersion: current.snapshot.journalVersion,
    journalHeadDigest: current.snapshot.headDigest,
    status: resultSummary.status,
    effect,
    effectDialect: 'L06_JOURNAL_PROJECTION_V1',
    quantityDialect: 'BINARY64_ROUND_TRIP_PROJECTION',
    resultRevision,
    resultContentRevision: digest('l06foundation_', resultSnapshot),
    foundationResult: resultSummary,
    matchingLeg: legSummary,
    privateReconciliationObservation: privateTruth.summary,
    privateProjectionRevision: privateOwnerBinding.privateProjectionRevision,
    privateLifecycleRevision: privateLifecycleWitness.lifecycleRevision,
    privateSourceCutRevision: privateTruth.summary.sourceCutRevision,
    privateProductCutRevision: privateTruth.productCutRevision,
    journalOutcomeRevision: current.snapshot.outcomeRevision,
    venueOrderId: legSummary.venueOrderId,
    cumulativeFilledQuantity: exactJournalQuantity,
    observedAtMs: evaluatedAtMs,
    externalTruthRefs: [],
  }, current.snapshot.identity, current.snapshot.bindings, current.snapshot.requestedQuantity);
  const identityMaterial = {
    kind: 'FOUNDATION_RECONCILIATION_OBSERVED' as const,
    occurredAtMs: evaluatedAtMs,
    receivedAtMs,
    sourceRevision: resultRevision,
    payload,
  };
  return deepFreezePrivate({
    observationId: mutationObservationId(current, identityMaterial),
    ...identityMaterial,
  });
}

function validateRequest(value: unknown): Readonly<MutationAppendRequest> {
  const record = exactRecord(value, REQUEST_FIELDS, 'mutation append request');
  if (record.schema !== L06_APPEND_REQUEST_SCHEMA || record.version !== 1
    || record.ownerTarget !== 'SYSTEM_INTEGRATION_LEDGER'
    || record.externalActionAuthorization !== 'NONE') {
    throw new TypeError('mutation append request schema/authority is invalid');
  }
  const request = {
    schema: L06_APPEND_REQUEST_SCHEMA,
    version: 1 as const,
    ownerTarget: 'SYSTEM_INTEGRATION_LEDGER' as const,
    mutationId: revision(record.mutationId, 'append mutation ID', MUTATION_ID),
    entryId: revision(record.entryId, 'append entry ID', ENTRY_ID),
    idempotencyKey: privateIdentifier(record.idempotencyKey, 'append idempotency key'),
    expectedJournalVersion: privateInteger(record.expectedJournalVersion, 'expected journal version', 0, MUTATION_JOURNAL_LIMITS.maximumEntries - 1),
    nextJournalVersion: privateInteger(record.nextJournalVersion, 'next journal version', 1, MUTATION_JOURNAL_LIMITS.maximumEntries),
    previousHeadDigest: record.previousHeadDigest === null
      ? null
      : revision(record.previousHeadDigest, 'previous head digest', HEAD_DIGEST),
    entry: deepFreezePrivate(snapshotPrivateData(
      privateRecord(record.entry, ENTRY_FIELDS, 'append request entry'),
    )) as Readonly<MutationJournalEntry>,
    nextHeadDigest: revision(record.nextHeadDigest, 'next head digest', HEAD_DIGEST),
    nextOutcomeRevision: revision(record.nextOutcomeRevision, 'next outcome revision', OUTCOME_REVISION),
    entryContentRevision: revision(record.entryContentRevision, 'entry content revision', CONTENT_REVISION),
    appendRequestDigest: revision(record.appendRequestDigest, 'append request digest', APPEND_DIGEST),
    externalActionAuthorization: 'NONE' as const,
  };
  const regeneratedEntry = createEntry({
    mutationId: request.entry.mutationId,
    observationId: request.entry.observationId,
    journalVersion: request.entry.journalVersion,
    previousHeadDigest: request.entry.previousHeadDigest,
    kind: request.entry.kind,
    occurredAtMs: request.entry.occurredAtMs,
    receivedAtMs: request.entry.receivedAtMs,
    sourceRevision: request.entry.sourceRevision,
    payload: request.entry.payload,
  });
  if (request.nextJournalVersion !== request.expectedJournalVersion + 1
    || request.idempotencyKey !== `l06append:${request.mutationId}:${request.nextJournalVersion}`
    || request.entry.schema !== L06_MUTATION_ENTRY_SCHEMA
    || request.entry.version !== 1
    || request.entry.mutationId !== request.mutationId
    || request.entry.entryId !== request.entryId
    || request.entry.journalVersion !== request.nextJournalVersion
    || request.entry.previousHeadDigest !== request.previousHeadDigest
    || request.entry.contentRevision !== request.entryContentRevision
    || canonicalJson(regeneratedEntry) !== canonicalJson(request.entry)
    || headDigestFor(request.previousHeadDigest, regeneratedEntry) !== request.nextHeadDigest
    || appendRequestDigestFor({
      schema: request.schema,
      version: request.version,
      ownerTarget: request.ownerTarget,
      mutationId: request.mutationId,
      entryId: request.entryId,
      idempotencyKey: request.idempotencyKey,
      expectedJournalVersion: request.expectedJournalVersion,
      nextJournalVersion: request.nextJournalVersion,
      previousHeadDigest: request.previousHeadDigest,
      entry: request.entry,
      nextHeadDigest: request.nextHeadDigest,
      nextOutcomeRevision: request.nextOutcomeRevision,
      entryContentRevision: request.entryContentRevision,
      externalActionAuthorization: request.externalActionAuthorization,
    }) !== request.appendRequestDigest) {
    throw new TypeError('mutation append request identity mismatch');
  }
  assertSerializedByteBound(
    request.entry,
    MUTATION_JOURNAL_LIMITS.maximumSerializedEntryBytes,
    'append request entry',
  );
  assertSerializedByteBound(
    request,
    MUTATION_JOURNAL_LIMITS.maximumSerializedAppendRequestBytes,
    'mutation append request',
  );
  return deepFreezePrivate(request);
}

export function validateMutationAppendRequest(
  value: unknown,
): Readonly<MutationAppendRequest> | null {
  try {
    return validateRequest(value);
  } catch {
    return null;
  }
}

export function applyMutationAppendRequest(
  priorSnapshotValue: unknown,
  requestValue: unknown,
): Readonly<MutationJournalSnapshot> | null {
  try {
    const request = validateRequest(requestValue);
    const prior = priorSnapshotValue === null ? null : validateSnapshot(priorSnapshotValue);
    if (request.expectedJournalVersion !== (prior?.journalVersion ?? 0)
      || request.previousHeadDigest !== (prior?.headDigest ?? null)) {
      return null;
    }
    const next = snapshotFromEntries([...(prior?.entries ?? []), request.entry]);
    if (next.mutationId !== request.mutationId
      || next.journalVersion !== request.nextJournalVersion
      || next.headDigest !== request.nextHeadDigest
      || next.outcomeRevision !== request.nextOutcomeRevision
      || next.entries.at(-1)!.entryId !== request.entryId
      || next.entries.at(-1)!.contentRevision !== request.entryContentRevision) {
      return null;
    }
    return next;
  } catch {
    return null;
  }
}

function validateAcknowledgement(value: unknown): Readonly<MutationAppendAcknowledgement> {
  const record = exactRecord(value, ACK_FIELDS, 'mutation append acknowledgement');
  if (record.schema !== L06_APPEND_ACK_SCHEMA || record.version !== 1
    || record.owner !== 'SYSTEM_INTEGRATION_LEDGER'
    || record.externalActionAuthorization !== 'NONE'
    || !includes(MUTATION_APPEND_DISPOSITIONS, record.disposition)) {
    throw new TypeError('mutation append acknowledgement schema/authority is invalid');
  }
  const committedJournalVersion = record.committedJournalVersion === null
    ? null
    : privateInteger(record.committedJournalVersion, 'committed journal version', 1, MUTATION_JOURNAL_LIMITS.maximumEntries);
  const ledgerEventId = record.ledgerEventId === null
    ? null
    : privateInteger(record.ledgerEventId, 'Ledger event ID', 1, Number.MAX_SAFE_INTEGER);
  const committedAtMs = record.committedAtMs === null
    ? null
    : privateInteger(record.committedAtMs, 'commit time', 0, MAX_UTC_MS);
  const failureCode = record.failureCode === null
    ? null
    : privateString(record.failureCode, 'append failure code', 96);
  if (failureCode !== null && !REASON_CODE.test(failureCode)) throw new TypeError('append failure code is invalid');
  if (record.appendedCount !== 0 && record.appendedCount !== 1) {
    throw new TypeError('append acknowledgement count is invalid');
  }
  const appendedCount = record.appendedCount;
  const committed = record.disposition === 'COMMITTED_NEW' || record.disposition === 'IDEMPOTENT_REPLAY';
  if (committed !== (
    committedJournalVersion !== null
    && record.committedHeadDigest !== null
    && record.committedOutcomeRevision !== null
    && appendedCount === (record.disposition === 'COMMITTED_NEW' ? 1 : 0)
    && ledgerEventId !== null
    && committedAtMs !== null
    && failureCode === null
  )) throw new TypeError('append acknowledgement disposition tuple is invalid');
  if (!committed && (
    committedJournalVersion !== null || record.committedHeadDigest !== null
    || record.committedOutcomeRevision !== null || appendedCount !== 0
    || ledgerEventId !== null || committedAtMs !== null || failureCode === null
  )) throw new TypeError('failed append acknowledgement must carry only a failure');
  return deepFreezePrivate({
    schema: L06_APPEND_ACK_SCHEMA,
    version: 1 as const,
    owner: 'SYSTEM_INTEGRATION_LEDGER' as const,
    disposition: record.disposition,
    mutationId: revision(record.mutationId, 'ack mutation ID', MUTATION_ID),
    entryId: revision(record.entryId, 'ack entry ID', ENTRY_ID),
    idempotencyKey: privateIdentifier(record.idempotencyKey, 'ack idempotency key'),
    appendRequestDigest: revision(record.appendRequestDigest, 'ack append digest', APPEND_DIGEST),
    expectedJournalVersion: privateInteger(record.expectedJournalVersion, 'ack expected journal version', 0, MUTATION_JOURNAL_LIMITS.maximumEntries - 1),
    committedJournalVersion,
    previousHeadDigest: record.previousHeadDigest === null
      ? null
      : revision(record.previousHeadDigest, 'ack previous head', HEAD_DIGEST),
    committedHeadDigest: record.committedHeadDigest === null
      ? null
      : revision(record.committedHeadDigest, 'ack committed head', HEAD_DIGEST),
    committedOutcomeRevision: record.committedOutcomeRevision === null
      ? null
      : revision(record.committedOutcomeRevision, 'ack committed outcome', OUTCOME_REVISION),
    appendedCount,
    ledgerEventId,
    committedAtMs,
    failureCode,
    externalActionAuthorization: 'NONE' as const,
  });
}

export function confirmMutationAppend(
  preparedValue: unknown,
  acknowledgementValue: unknown,
): Readonly<ConfirmMutationAppendResult> {
  let prepared: Readonly<PreparedMutationAppend>;
  let acknowledgement: Readonly<MutationAppendAcknowledgement>;
  try {
    const record = exactRecord(preparedValue, ['request', 'nextSnapshot'], 'prepared mutation append');
    const request = validateRequest(record.request);
    const nextSnapshot = validateSnapshot(record.nextSnapshot);
    if (request.mutationId !== nextSnapshot.mutationId
      || request.nextJournalVersion !== nextSnapshot.journalVersion
      || request.nextHeadDigest !== nextSnapshot.headDigest
      || request.nextOutcomeRevision !== nextSnapshot.outcomeRevision
      || request.entryId !== nextSnapshot.entries.at(-1)!.entryId
      || canonicalJson(request.entry) !== canonicalJson(nextSnapshot.entries.at(-1)!)
      || request.entryContentRevision !== nextSnapshot.entries.at(-1)!.contentRevision) {
      throw new TypeError('prepared append request/snapshot mismatch');
    }
    prepared = deepFreezePrivate({ request, nextSnapshot });
    acknowledgement = validateAcknowledgement(acknowledgementValue);
  } catch {
    return deepFreezePrivate({ ok: false as const, reasonCode: 'ACK_INVALID' as const });
  }
  if (acknowledgement.disposition !== 'COMMITTED_NEW'
    && acknowledgement.disposition !== 'IDEMPOTENT_REPLAY') {
    return deepFreezePrivate({ ok: false as const, reasonCode: 'ACK_NOT_COMMITTED' as const });
  }
  const request = prepared.request;
  if (acknowledgement.mutationId !== request.mutationId
    || acknowledgement.entryId !== request.entryId
    || acknowledgement.idempotencyKey !== request.idempotencyKey
    || acknowledgement.appendRequestDigest !== request.appendRequestDigest
    || acknowledgement.expectedJournalVersion !== request.expectedJournalVersion
    || acknowledgement.committedJournalVersion !== request.nextJournalVersion
    || acknowledgement.previousHeadDigest !== request.previousHeadDigest
    || acknowledgement.committedHeadDigest !== request.nextHeadDigest
    || acknowledgement.committedOutcomeRevision !== request.nextOutcomeRevision) {
    return deepFreezePrivate({ ok: false as const, reasonCode: 'ACK_BINDING_MISMATCH' as const });
  }
  const latestReceiptAt = prepared.nextSnapshot.entries.at(-1)!.receivedAtMs;
  if (acknowledgement.committedAtMs === null || acknowledgement.committedAtMs < latestReceiptAt) {
    return deepFreezePrivate({ ok: false as const, reasonCode: 'ACK_CAUSALITY_INVALID' as const });
  }
  const persisted = deepFreezePrivate({
    snapshot: prepared.nextSnapshot,
    acknowledgement,
    acknowledgementValidated: true as const,
    persistenceProven: false as const,
    persistenceOwnerTarget: 'SYSTEM_INTEGRATION_LEDGER' as const,
    provenance: 'INJECTED_ACKNOWLEDGEMENT_ONLY' as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  });
  return deepFreezePrivate({ ok: true as const, persisted });
}

export function validatePersistedMutationJournal(value: unknown): Readonly<PersistedMutationJournal> {
  const record = exactRecord(value, [
    'snapshot', 'acknowledgement', 'acknowledgementValidated', 'persistenceProven',
    'persistenceOwnerTarget', 'provenance', 'actionAuthority', 'externalActionAuthorization',
  ], 'persisted mutation journal');
  if (record.acknowledgementValidated !== true || record.persistenceProven !== false
    || record.persistenceOwnerTarget !== 'SYSTEM_INTEGRATION_LEDGER'
    || record.provenance !== 'INJECTED_ACKNOWLEDGEMENT_ONLY'
    || record.actionAuthority !== 'NONE_RECORD_ONLY'
    || record.externalActionAuthorization !== 'NONE') {
    throw new TypeError('injected acknowledgement journal authority is invalid');
  }
  const snapshot = validateSnapshot(record.snapshot);
  const acknowledgement = validateAcknowledgement(record.acknowledgement);
  const tail = snapshot.entries.at(-1)!;
  const expectedRequestBase: Omit<MutationAppendRequest, 'appendRequestDigest'> = {
    schema: L06_APPEND_REQUEST_SCHEMA,
    version: 1,
    ownerTarget: 'SYSTEM_INTEGRATION_LEDGER',
    mutationId: snapshot.mutationId,
    entryId: tail.entryId,
    idempotencyKey: `l06append:${snapshot.mutationId}:${snapshot.journalVersion}`,
    expectedJournalVersion: snapshot.journalVersion - 1,
    nextJournalVersion: snapshot.journalVersion,
    previousHeadDigest: tail.previousHeadDigest,
    entry: deepFreezePrivate(snapshotPrivateData(tail)) as Readonly<MutationJournalEntry>,
    nextHeadDigest: snapshot.headDigest,
    nextOutcomeRevision: snapshot.outcomeRevision,
    entryContentRevision: tail.contentRevision,
    externalActionAuthorization: 'NONE',
  };
  const expectedAppendDigest = appendRequestDigestFor(expectedRequestBase);
  if ((acknowledgement.disposition !== 'COMMITTED_NEW'
      && acknowledgement.disposition !== 'IDEMPOTENT_REPLAY')
    || acknowledgement.mutationId !== snapshot.mutationId
    || acknowledgement.idempotencyKey !== expectedRequestBase.idempotencyKey
    || acknowledgement.appendRequestDigest !== expectedAppendDigest
    || acknowledgement.expectedJournalVersion !== snapshot.journalVersion - 1
    || acknowledgement.committedJournalVersion !== snapshot.journalVersion
    || acknowledgement.previousHeadDigest !== tail.previousHeadDigest
    || acknowledgement.committedHeadDigest !== snapshot.headDigest
    || acknowledgement.committedOutcomeRevision !== snapshot.outcomeRevision
    || acknowledgement.entryId !== tail.entryId
    || acknowledgement.committedAtMs === null
    || acknowledgement.committedAtMs < tail.receivedAtMs) {
    throw new TypeError('persisted mutation journal acknowledgement does not anchor its head');
  }
  return deepFreezePrivate({
    snapshot,
    acknowledgement,
    acknowledgementValidated: true as const,
    persistenceProven: false as const,
    persistenceOwnerTarget: 'SYSTEM_INTEGRATION_LEDGER' as const,
    provenance: 'INJECTED_ACKNOWLEDGEMENT_ONLY' as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  });
}

export function validateMutationJournalSnapshot(value: unknown): Readonly<MutationJournalSnapshot> | null {
  try {
    return validateSnapshot(value);
  } catch {
    return null;
  }
}

export function reconstructPersistedMutationJournal(
  entriesValue: unknown,
  acknowledgementValue: unknown,
): Readonly<PersistedMutationJournal> | null {
  try {
    const entries = privateArray(snapshotPrivateData(entriesValue), 'replay entries', MUTATION_JOURNAL_LIMITS.maximumEntries);
    const snapshot = snapshotFromEntries(entries);
    const supplied = validateAcknowledgement(acknowledgementValue);
    const acknowledgement = supplied.disposition === 'COMMITTED_NEW'
      ? validateAcknowledgement({ ...supplied, disposition: 'IDEMPOTENT_REPLAY', appendedCount: 0 })
      : supplied;
    return validatePersistedMutationJournal({
      snapshot,
      acknowledgement,
      acknowledgementValidated: true,
      persistenceProven: false,
      persistenceOwnerTarget: 'SYSTEM_INTEGRATION_LEDGER',
      provenance: 'INJECTED_ACKNOWLEDGEMENT_ONLY',
      actionAuthority: 'NONE_RECORD_ONLY',
      externalActionAuthorization: 'NONE',
    });
  } catch {
    return null;
  }
}

export function evaluateSyntheticSubmissionBoundary(
  persistedValue: unknown,
  evaluatedAtMsValue: unknown,
): Readonly<SyntheticSubmissionBoundaryDecision> {
  let current: Readonly<PersistedMutationJournal> | null = null;
  let evaluatedAtMs = 0;
  const reasons: string[] = [];
  try {
    current = validatePersistedMutationJournal(persistedValue);
    evaluatedAtMs = privateInteger(evaluatedAtMsValue, 'synthetic boundary evaluation time', 0, MAX_UTC_MS);
    if (evaluatedAtMs < current.acknowledgement.committedAtMs!) reasons.push('EVALUATION_PRECEDES_DURABLE_ACK');
    if (current.snapshot.identity.mutationKind !== 'CANCEL_ORDER'
      && evaluatedAtMs > current.snapshot.bindings.validUntilMs) {
      reasons.push('BOUND_EVIDENCE_EXPIRED');
    }
    if (current.snapshot.identity.contractState !== 'CURRENT') reasons.push('MUTATION_CONTRACT_NOT_CURRENT');
    if (current.snapshot.projection.lifecycle !== 'SUBMITTING') reasons.push('SUBMISSION_INTENT_NOT_CURRENT');
    if (!current.snapshot.projection.submissionIntentPresent) reasons.push('SUBMISSION_INTENT_ABSENT');
    if (current.snapshot.projection.submissionObserved) reasons.push('DUPLICATE_SUBMISSION_OBSERVATION_BLOCKED');
    if (current.acknowledgement.disposition !== 'COMMITTED_NEW') reasons.push('REPLAYED_ACK_CANNOT_OPEN_BOUNDARY');
    if (current.snapshot.entries.at(-1)!.kind !== 'SUBMISSION_INTENT') reasons.push('DURABLE_HEAD_IS_NOT_SUBMISSION_INTENT');
  } catch {
    reasons.push('PERSISTED_JOURNAL_INVALID');
  }
  const mutationId = current?.snapshot.mutationId ?? 'l06mut_unavailable';
  const boundaryId = current === null
    ? 'l06boundary_unavailable'
    : digest('l06boundary_', {
      mutationId: current.snapshot.mutationId,
      journalVersion: current.snapshot.journalVersion,
      journalHeadDigest: current.snapshot.headDigest,
      outcomeRevision: current.snapshot.outcomeRevision,
    });
  return deepFreezePrivate({
    schema: L06_SYNTHETIC_BOUNDARY_SCHEMA,
    version: 1 as const,
    mutationId,
    boundaryId,
    state: reasons.length === 0 ? 'SYNTHETIC_OBSERVATION_ELIGIBLE' as const : 'BLOCKED' as const,
    reasonCodes: Object.freeze([...new Set(reasons)].sort()),
    journalVersion: current?.snapshot.journalVersion ?? 0,
    journalHeadDigest: current?.snapshot.headDigest ?? 'UNAVAILABLE',
    outcomeRevision: current?.snapshot.outcomeRevision ?? 'UNAVAILABLE',
    evaluatedAtMs,
    syntheticOnly: true as const,
    sendAuthorized: false as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  });
}

export function prepareSyntheticSubmissionObservationAppend(
  persistedValue: unknown,
  decisionValue: unknown,
  l03RequestAttemptValue: unknown,
  observedAtMsValue: unknown,
): Readonly<PreparedMutationAppend> {
  const current = validatePersistedMutationJournal(persistedValue);
  const decision = exactRecord(decisionValue, [
    'schema', 'version', 'mutationId', 'boundaryId', 'state', 'reasonCodes', 'journalVersion',
    'journalHeadDigest', 'outcomeRevision', 'evaluatedAtMs', 'syntheticOnly',
    'sendAuthorized', 'actionAuthority', 'externalActionAuthorization',
  ], 'synthetic boundary decision');
  if (decision.schema !== L06_SYNTHETIC_BOUNDARY_SCHEMA || decision.version !== 1
    || decision.state !== 'SYNTHETIC_OBSERVATION_ELIGIBLE'
    || revision(decision.boundaryId, 'synthetic boundary ID', BOUNDARY_ID) !== decision.boundaryId
    || privateArray(decision.reasonCodes, 'boundary reasons', 32).length !== 0
    || decision.mutationId !== current.snapshot.mutationId
    || decision.journalVersion !== current.snapshot.journalVersion
    || decision.journalHeadDigest !== current.snapshot.headDigest
    || decision.outcomeRevision !== current.snapshot.outcomeRevision
    || decision.syntheticOnly !== true || decision.sendAuthorized !== false
    || decision.actionAuthority !== 'NONE_RECORD_ONLY'
    || decision.externalActionAuthorization !== 'NONE') {
    throw new TypeError('synthetic boundary decision is not exact/current');
  }
  const decisionEvaluatedAtMs = privateInteger(
    decision.evaluatedAtMs,
    'synthetic boundary decision time',
    0,
    MAX_UTC_MS,
  );
  const expectedDecision = evaluateSyntheticSubmissionBoundary(current, decisionEvaluatedAtMs);
  if (canonicalJson(expectedDecision) !== canonicalJson(decision)) {
    throw new TypeError('synthetic boundary decision was not derived from the exact current persisted head');
  }
  const observedAtMs = privateInteger(observedAtMsValue, 'synthetic submission observation time', 0, MAX_UTC_MS);
  if (observedAtMs < decisionEvaluatedAtMs) throw new TypeError('synthetic submission observation predates decision');
  if (current.snapshot.identity.mutationKind !== 'CANCEL_ORDER'
    && observedAtMs > current.snapshot.bindings.validUntilMs) {
    throw new TypeError('synthetic submission observation is stale');
  }
  const l03RequestAttempt = normalizeL03RequestAttempt(
    l03RequestAttemptValue,
    current.snapshot.identity,
  );
  if (l03RequestAttempt.stage !== 'SUBMITTED' || l03RequestAttempt.submitCount !== 1
    || l03RequestAttempt.duplicateSendBlocked !== true
    || l03RequestAttempt.transportOutcome !== null || l03RequestAttempt.httpStatus !== null
    || l03RequestAttempt.ambiguityCause !== null) {
    throw new TypeError('synthetic submission requires the exact L03 SUBMITTED attempt state');
  }
  const payload = deepFreezePrivate({
    l03RequestAttempt,
    l06AttemptContentRevision: l03AttemptContentRevision(l03RequestAttempt),
    durableIntentCommittedAtMs: current.acknowledgement.committedAtMs!,
    durableIntentLedgerEventId: current.acknowledgement.ledgerEventId!,
    durableIntentAppendRequestDigest: current.acknowledgement.appendRequestDigest,
    syntheticObservationOnly: true as const,
  });
  const entry = createEntry({
    mutationId: current.snapshot.mutationId,
    observationId: digest('l06obs_', {
      mutationId: current.snapshot.mutationId,
      kind: 'SUBMISSION_OBSERVED',
      payload,
    }),
    journalVersion: current.snapshot.journalVersion + 1,
    previousHeadDigest: current.snapshot.headDigest,
    kind: 'SUBMISSION_OBSERVED',
    occurredAtMs: observedAtMs,
    receivedAtMs: observedAtMs,
    sourceRevision: payload.l06AttemptContentRevision,
    payload,
  });
  return prepareAppend(current, entry);
}

export function buildMutationReconciliationHandoff(
  persistedValue: unknown,
): Readonly<MutationReconciliationHandoff> {
  const current = validatePersistedMutationJournal(persistedValue);
  const projection = current.snapshot.projection;
  const reasons: string[] = [];
  if (!projection.submissionObserved) reasons.push('SUBMISSION_NOT_OBSERVED');
  if (projection.reconciled) reasons.push('ALREADY_RECONCILED');
  if (projection.ambiguityCauses.length > 0) reasons.push('MUTATION_AMBIGUOUS');
  if (projection.partialMixed) reasons.push('PARTIAL_MIXED_EFFECT');
  if (projection.conflictCodes.length > 0) reasons.push('EVIDENCE_CONFLICT');
  if (projection.terminalStatus !== null) reasons.push('TERMINAL_EFFECT_REQUIRES_OWNER_CONFIRMATION');
  if (projection.telemetryDegraded) reasons.push('NONCRITICAL_TELEMETRY_DEGRADED');
  return deepFreezePrivate({
    schema: L06_RECONCILIATION_HANDOFF_SCHEMA,
    version: 1 as const,
    ownerTarget: 'FOUNDATION_RECONCILIATION' as const,
    mutationId: current.snapshot.mutationId,
    product: current.snapshot.identity.product,
    accountRealmId: current.snapshot.identity.accountRealmId,
    symbol: current.snapshot.identity.symbol,
    mutationKind: current.snapshot.identity.mutationKind,
    clientOrderId: current.snapshot.identity.clientOrderId,
    venueOrderId: projection.venueOrderId,
    requestedQuantity: current.snapshot.requestedQuantity,
    observedFilledQuantity: projection.cumulativeFilledQuantity,
    journalVersion: current.snapshot.journalVersion,
    journalHeadDigest: current.snapshot.headDigest,
    outcomeRevision: current.snapshot.outcomeRevision,
    privateSourceCutRevision: current.snapshot.bindings.privateSourceCutRevision,
    lifecycleRevisions: current.snapshot.bindings.lifecycleRevisions,
    reasonCodes: Object.freeze([...new Set(reasons)].sort()),
    queryIdentityOnly: true as const,
    queryAuthorized: false as const,
    retryAuthorized: false as const,
    reconciliationAuthority: 'NONE' as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  });
}

export function mutationObservationId(
  persistedValue: unknown,
  value: unknown,
): string {
  const current = validatePersistedMutationJournal(persistedValue);
  const record = exactRecord(value, [
    'kind', 'occurredAtMs', 'receivedAtMs', 'sourceRevision', 'payload',
  ], 'mutation observation identity material');
  const normalized = normalizeObservation({
    observationId: `l06obs_${'0'.repeat(64)}`,
    kind: record.kind,
    occurredAtMs: record.occurredAtMs,
    receivedAtMs: record.receivedAtMs,
    sourceRevision: record.sourceRevision,
    payload: record.payload,
  }, current);
  return observationIdFor(current.snapshot.mutationId, {
    kind: normalized.kind,
    occurredAtMs: normalized.occurredAtMs,
    receivedAtMs: normalized.receivedAtMs,
    sourceRevision: normalized.sourceRevision,
    payload: normalized.payload,
  });
}

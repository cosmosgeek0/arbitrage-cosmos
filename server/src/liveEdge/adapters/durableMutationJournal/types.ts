import type { InstrumentSizingResult } from '../binanceInstrumentSpecs/types.js';
import type { RequestAttemptState } from '../binanceSignedKernel/ambiguity.js';
import {
  RECONCILIATION_STATUSES,
  type ReconciliationStatus,
} from '../../../foundation/contracts/index.js';

export const L06_MUTATION_JOURNAL_SCHEMA = 'LIVE_EDGE_MUTATION_JOURNAL_V1' as const;
export const L06_MUTATION_ENTRY_SCHEMA = 'LIVE_EDGE_MUTATION_ENTRY_V1' as const;
export const L06_APPEND_REQUEST_SCHEMA = 'LIVE_EDGE_MUTATION_APPEND_REQUEST_V1' as const;
export const L06_APPEND_ACK_SCHEMA = 'LIVE_EDGE_MUTATION_APPEND_ACK_V1' as const;
export const L06_SYNTHETIC_BOUNDARY_SCHEMA = 'LIVE_EDGE_SYNTHETIC_SUBMISSION_BOUNDARY_V1' as const;
export const L06_RECONCILIATION_HANDOFF_SCHEMA = 'LIVE_EDGE_MUTATION_RECONCILIATION_HANDOFF_V1' as const;

export const L06_MATRIX_SHA256 =
  '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac' as const;

export const MUTATION_PRODUCTS = Object.freeze([
  'SPOT',
  'USD_M_PERPETUAL',
  'MARGIN',
] as const);
export type MutationProduct = (typeof MUTATION_PRODUCTS)[number];

export const MUTATION_KINDS = Object.freeze([
  'PLACE_ORDER',
  'CANCEL_ORDER',
  'CANCEL_REPLACE',
] as const);
export type MutationKind = (typeof MUTATION_KINDS)[number];

export const MUTATION_CONTRACT_STATES = Object.freeze([
  'CURRENT',
  'OFFICIAL_DOC_CONFLICT',
  'UNAVAILABLE_L02_CONTRACT_GAP',
] as const);
export type MutationContractState = (typeof MUTATION_CONTRACT_STATES)[number];

export const MUTATION_ENTRY_KINDS = Object.freeze([
  'CREATED',
  'PREFLIGHTED',
  'SUBMISSION_INTENT',
  'SUBMISSION_OBSERVED',
  'HTTP_OBSERVED',
  'PRIVATE_ORDER_OBSERVED',
  'PRIVATE_FILL_OBSERVED',
  'FOUNDATION_RECONCILIATION_OBSERVED',
  'OBSERVATION_ID_CONFLICT',
  'TELEMETRY_DEGRADED',
] as const);
export type MutationEntryKind = (typeof MUTATION_ENTRY_KINDS)[number];

export const MUTATION_LIFECYCLES = Object.freeze([
  'CREATED',
  'PREFLIGHTED',
  'SUBMITTING',
  'ACKNOWLEDGED',
  'UNKNOWN',
  'PARTIAL_MIXED',
  'REJECTED',
  'NEW',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELED',
  'EXPIRED',
  'CONFLICT',
  'RECONCILED',
] as const);
export type MutationLifecycle = (typeof MUTATION_LIFECYCLES)[number];

export const HTTP_OBSERVATION_CLASSIFICATIONS = Object.freeze([
  'ACKNOWLEDGED',
  'REJECTED_RESPONSE',
  'AMBIGUOUS',
  'PARTIAL_MIXED',
] as const);
export type HttpObservationClassification =
  (typeof HTTP_OBSERVATION_CLASSIFICATIONS)[number];

export const MUTATION_AMBIGUITY_CAUSES = Object.freeze([
  'TRANSPORT_TIMEOUT',
  'TRANSPORT_DISCONNECTED',
  'HTTP_408',
  'HTTP_5XX',
  'TRANSPORT_AMBIGUOUS',
  'TRANSPORT_ABORTED_AFTER_DISPATCH',
  'MALFORMED_RESPONSE_AFTER_DISPATCH',
  'INCOMPLETE_SUCCESS_RESPONSE',
] as const);
export type MutationAmbiguityCause = (typeof MUTATION_AMBIGUITY_CAUSES)[number];

export const PRIVATE_ORDER_STATUSES = Object.freeze([
  'NEW',
  'PENDING_NEW',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELED',
  'REJECTED',
  'EXPIRED',
] as const);
export type PrivateOrderStatus = (typeof PRIVATE_ORDER_STATUSES)[number];

export const FOUNDATION_RECONCILIATION_STATUSES = RECONCILIATION_STATUSES;
export type FoundationReconciliationStatus = ReconciliationStatus;

export const FOUNDATION_MUTATION_EFFECTS = Object.freeze([
  'ACKNOWLEDGED',
  'NEW',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELED',
  'EXPIRED',
  'REJECTED_NO_EFFECT_PROVEN',
  'PARTIAL_MIXED',
  'UNKNOWN',
] as const);
export type FoundationMutationEffect = (typeof FOUNDATION_MUTATION_EFFECTS)[number];

export type JournalJson =
  | string
  | number
  | boolean
  | null
  | readonly JournalJson[]
  | { readonly [key: string]: JournalJson };

export interface MutationIdentityGraph {
  readonly globalCorrelationId: string;
  readonly assessmentId: string | null;
  readonly decisionId: string;
  readonly strategyId: 'BASIS' | 'VOLUME';
  readonly proposalId: string;
  readonly capitalMandateId: string;
  readonly capitalReservationId: string;
  /** Existing Foundation plan identity; L06 does not mint a second ticket. */
  readonly ticketId: string;
  readonly legId: string;
  readonly requestId: string;
  readonly requestSequence: number;
  readonly intentFingerprint: string;
  readonly signerProfile: 'SPOT_HMAC_SHA256' | 'USDM_HMAC_SHA256';
  readonly clientOrderId: string;
  readonly attempt: number;
  readonly product: MutationProduct;
  readonly environment: 'PRODUCTION';
  readonly accountRealmId: string;
  readonly symbol: string;
  readonly mutationKind: MutationKind;
  readonly contractId: string;
  readonly contractState: MutationContractState;
}

export interface MutationEvidenceBindings {
  readonly instrumentRevision: string;
  readonly sourceEvidenceRevision: string;
  readonly snapshotRevision: string;
  readonly registryRevision: string;
  readonly referenceEvidenceRevision: string | null;
  readonly preflightContentRevision: string;
  readonly preflightResultQuantity: string;
  readonly preflightResultNotional: string;
  readonly preflightNotionalAsset: 'USDT';
  readonly preflightCanaryMaximumNotional: '10';
  readonly sanitizedRequestContentHash: string;
  readonly privateProjectionRevision: string;
  readonly privateSourceCutRevision: string;
  readonly lifecycleRevisions: readonly string[];
  readonly foundationReconciliationResultRevision: string;
  readonly capitalMandateRevision: string;
  readonly riskVerdictRevision: string;
  readonly regimeAdvisoryRevision: string | null;
  readonly regimePostureState: 'UNKNOWN' | 'CURRENT_ADVISORY' | 'STALE' | 'UNSUPPORTED' | 'DISAGREEING';
  readonly sourceExchangeEventAtMs: number | null;
  readonly sourceLocalReceiveAtMs: number | null;
  readonly featuresReadyAtMs: number;
  readonly decisionAtMs: number;
  readonly approvalAtMs: number;
  readonly timingEvidenceRevision: string;
  readonly exchangeClockCalibrationRevision: string | null;
  readonly preflightEvaluatedAtMs: number;
  readonly privateEvaluatedAtMs: number;
  readonly validUntilMs: number;
  readonly preflightState: 'CURRENT_NON_SENDABLE';
}

export interface CreateMutationJournalInput {
  readonly identity: Readonly<MutationIdentityGraph>;
  readonly bindings: Readonly<MutationEvidenceBindings>;
  readonly preflightResult: Readonly<InstrumentSizingResult>;
  readonly requestedQuantity: string;
  readonly createdAtMs: number;
}

export interface CreatedPayload extends Record<string, JournalJson> {
  readonly identity: MutationIdentityGraph & { readonly [key: string]: JournalJson };
  readonly bindings: MutationEvidenceBindings & { readonly [key: string]: JournalJson };
  readonly preflightResult: InstrumentSizingResult & { readonly [key: string]: JournalJson };
  readonly requestedQuantity: string;
}

export interface PreflightedPayload extends Record<string, JournalJson> {
  readonly preflightContentRevision: string;
  readonly preflightEvaluatedAtMs: number;
}

export interface SubmissionIntentPayload extends Record<string, JournalJson> {
  readonly reason: 'PERSIST_BEFORE_SYNTHETIC_DISPATCH';
}

export interface SubmissionObservedPayload extends Record<string, JournalJson> {
  readonly l03RequestAttempt: RequestAttemptState & { readonly [key: string]: JournalJson };
  readonly l06AttemptContentRevision: string;
  readonly durableIntentCommittedAtMs: number;
  readonly durableIntentLedgerEventId: number;
  readonly durableIntentAppendRequestDigest: string;
  readonly syntheticObservationOnly: true;
}

export interface ObservationIdConflictPayload extends Record<string, JournalJson> {
  readonly reusedObservationId: string;
  readonly existingContentRevision: string;
  readonly conflictingContentRevision: string;
}

export interface HttpObservedPayload extends Record<string, JournalJson> {
  readonly product: MutationProduct;
  readonly accountRealmId: string;
  readonly symbol: string;
  readonly requestId: string;
  readonly clientOrderId: string;
  readonly l03RequestAttempt: RequestAttemptState & { readonly [key: string]: JournalJson };
  readonly l06AttemptContentRevision: string;
  readonly classification: HttpObservationClassification;
  readonly httpStatus: number | null;
  readonly ambiguityCause: MutationAmbiguityCause | null;
  readonly venueOrderId: string | null;
  readonly responseContentRevision: string | null;
}

export interface PrivateOrderObservedPayload extends Record<string, JournalJson> {
  readonly product: MutationProduct;
  readonly accountRealmId: string;
  readonly symbol: string;
  readonly clientOrderId: string;
  readonly status: PrivateOrderStatus;
  readonly cumulativeFilledQuantity: string;
  readonly venueOrderId: string;
  readonly exchangeEventTimeMs: number;
  readonly connectionGeneration: number;
  readonly privateLifecycleRevision: string;
  readonly privateEventKind: string;
  readonly privateEventRevision: string;
  readonly privateContentRevision: string;
  readonly privateReceiptTimeMs: number;
  readonly privateTransactionTimeMs: number | null;
  readonly privateSemanticCategory: string | null;
  readonly privateOrderExecutionType: string | null;
  readonly privateIsFill: boolean | null;
}

export interface PrivateFillObservedPayload extends Record<string, JournalJson> {
  readonly product: MutationProduct;
  readonly accountRealmId: string;
  readonly symbol: string;
  readonly clientOrderId: string;
  readonly tradeId: string;
  readonly fillQuantity: string;
  readonly cumulativeFilledQuantity: string;
  readonly venueOrderId: string;
  readonly exchangeEventTimeMs: number;
  readonly connectionGeneration: number;
  readonly privateLifecycleRevision: string;
  readonly privateEventKind: string;
  readonly privateEventRevision: string;
  readonly privateContentRevision: string;
  readonly privateReceiptTimeMs: number;
  readonly privateTransactionTimeMs: number | null;
  readonly privateSemanticCategory: string | null;
  readonly privateOrderExecutionType: string | null;
  readonly privateIsFill: boolean | null;
}

export interface FoundationReconciliationObservedPayload extends Record<string, JournalJson> {
  readonly owner: 'FOUNDATION_RECONCILIATION';
  readonly mutationId: string;
  readonly product: MutationProduct;
  readonly accountRealmId: string;
  readonly clientOrderId: string;
  readonly journalVersion: number;
  readonly journalHeadDigest: string;
  readonly status: FoundationReconciliationStatus;
  readonly effect: FoundationMutationEffect;
  readonly effectDialect: 'L06_JOURNAL_PROJECTION_V1';
  readonly quantityDialect: 'BINARY64_ROUND_TRIP_PROJECTION';
  readonly resultRevision: string;
  readonly resultContentRevision: string;
  readonly foundationResult: FoundationReconciliationResultSummary & { readonly [key: string]: JournalJson };
  readonly matchingLeg: FoundationReconciledLegSummary & { readonly [key: string]: JournalJson };
  readonly privateReconciliationObservation:
    FoundationPrivateReconciliationSummary & { readonly [key: string]: JournalJson };
  readonly privateProjectionRevision: string;
  readonly privateLifecycleRevision: string;
  readonly privateSourceCutRevision: string;
  readonly privateProductCutRevision: string;
  readonly journalOutcomeRevision: string;
  readonly venueOrderId: string | null;
  readonly cumulativeFilledQuantity: string | null;
  readonly observedAtMs: number;
  readonly externalTruthRefs: readonly string[];
}

export interface FoundationReconciliationResultSummary extends Record<string, JournalJson> {
  readonly planId: string;
  readonly correlationId: string;
  readonly evaluatedAtMs: number;
  readonly status: FoundationReconciliationStatus;
  readonly recommendation: string;
  readonly executionAuthority: 'NONE';
}

export interface FoundationReconciledLegSummary extends Record<string, JournalJson> {
  readonly phase: 'OPEN' | 'CLOSE';
  readonly legKey: 'SPOT' | 'PERP';
  readonly clientOrderId: string;
  readonly venueOrderId: string | null;
  readonly expectedLifecycle: string;
  readonly expectedSubmittedQuantityProjection: string;
  readonly expectedFilledQuantityProjection: string;
  readonly observedOrderStatus: string | null;
  readonly observedOrderFilledQuantityProjection: string | null;
  readonly observedTradeFilledQuantityProjection: string | null;
  readonly observedFilledQuantityProjection: string | null;
  readonly observedRemainderQuantityProjection: string | null;
  readonly status: FoundationReconciliationStatus;
  readonly reasonCodes: readonly string[];
}

export interface FoundationPrivateReconciliationSummary extends Record<string, JournalJson> {
  readonly owner: 'FOUNDATION_RECONCILIATION';
  readonly status: 'EXACT';
  readonly resultRevision: string;
  readonly sourceCutRevision: string;
  readonly productCutRevisions: Readonly<{
    readonly SPOT: string | null;
    readonly USD_M_PERPETUAL: string | null;
    readonly MARGIN: null;
    readonly [key: string]: JournalJson;
  }>;
  readonly observedAtMs: number;
  readonly executionAuthority: 'NONE';
}

export interface TelemetryDegradedPayload extends Record<string, JournalJson> {
  readonly subsystem: 'READ_MODEL' | 'TRACE' | 'INTELLIGENCE_RUNTIME_RECORDING';
  readonly reasonCode: string;
}

export type MutationEntryPayload =
  | CreatedPayload
  | PreflightedPayload
  | SubmissionIntentPayload
  | SubmissionObservedPayload
  | HttpObservedPayload
  | PrivateOrderObservedPayload
  | PrivateFillObservedPayload
  | FoundationReconciliationObservedPayload
  | ObservationIdConflictPayload
  | TelemetryDegradedPayload;

export interface MutationJournalEntry {
  readonly schema: typeof L06_MUTATION_ENTRY_SCHEMA;
  readonly version: 1;
  readonly entryId: string;
  readonly mutationId: string;
  readonly observationId: string;
  readonly journalVersion: number;
  readonly previousHeadDigest: string | null;
  readonly kind: MutationEntryKind;
  readonly occurredAtMs: number;
  readonly receivedAtMs: number;
  readonly sourceRevision: string;
  readonly payload: Readonly<MutationEntryPayload>;
  readonly contentRevision: string;
}

export interface MutationProjection {
  readonly lifecycle: MutationLifecycle;
  readonly submissionIntentPresent: boolean;
  readonly submissionObserved: boolean;
  readonly httpAcknowledged: boolean;
  readonly httpRejectedResponseSeen: boolean;
  readonly partialMixed: boolean;
  readonly ambiguityCauses: readonly MutationAmbiguityCause[];
  readonly workingStatus: PrivateOrderStatus | null;
  readonly cumulativeFilledQuantity: string;
  readonly venueOrderId: string | null;
  readonly tradeIds: readonly string[];
  readonly terminalStatus: 'FILLED' | 'CANCELED' | 'EXPIRED' | 'REJECTED' | null;
  readonly reconciliationStatus: FoundationReconciliationStatus | null;
  readonly reconciliationEffect: FoundationMutationEffect | null;
  readonly reconciled: boolean;
  readonly recoveryRequired: boolean;
  readonly telemetryDegraded: boolean;
  readonly externalTruthRefs: readonly string[];
  readonly conflictCodes: readonly string[];
  readonly evidenceOnly: true;
}

export interface MutationJournalSnapshot {
  readonly schema: typeof L06_MUTATION_JOURNAL_SCHEMA;
  readonly version: 1;
  readonly mutationId: string;
  readonly identity: Readonly<MutationIdentityGraph>;
  readonly bindings: Readonly<MutationEvidenceBindings>;
  readonly requestedQuantity: string;
  readonly journalVersion: number;
  readonly entries: readonly Readonly<MutationJournalEntry>[];
  readonly projection: Readonly<MutationProjection>;
  readonly headDigest: string;
  readonly outcomeRevision: string;
  readonly persistenceProven: false;
  readonly persistenceAuthority: 'NONE';
  readonly reconciliationAuthority: 'NONE';
  readonly capitalAuthority: 'NONE';
  readonly riskAuthority: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface MutationAppendRequest {
  readonly schema: typeof L06_APPEND_REQUEST_SCHEMA;
  readonly version: 1;
  readonly ownerTarget: 'SYSTEM_INTEGRATION_LEDGER';
  readonly mutationId: string;
  readonly entryId: string;
  readonly idempotencyKey: string;
  readonly expectedJournalVersion: number;
  readonly nextJournalVersion: number;
  readonly previousHeadDigest: string | null;
  readonly entry: Readonly<MutationJournalEntry>;
  readonly nextHeadDigest: string;
  readonly nextOutcomeRevision: string;
  readonly entryContentRevision: string;
  readonly appendRequestDigest: string;
  readonly externalActionAuthorization: 'NONE';
}

export interface PreparedMutationAppend {
  readonly request: Readonly<MutationAppendRequest>;
  readonly nextSnapshot: Readonly<MutationJournalSnapshot>;
}

export const MUTATION_APPEND_DISPOSITIONS = Object.freeze([
  'COMMITTED_NEW',
  'IDEMPOTENT_REPLAY',
  'VERSION_CONFLICT',
  'FAILED',
  'CAPACITY_EXHAUSTED',
] as const);
export type MutationAppendDisposition = (typeof MUTATION_APPEND_DISPOSITIONS)[number];

export interface MutationAppendAcknowledgement {
  readonly schema: typeof L06_APPEND_ACK_SCHEMA;
  readonly version: 1;
  readonly owner: 'SYSTEM_INTEGRATION_LEDGER';
  readonly disposition: MutationAppendDisposition;
  readonly mutationId: string;
  readonly entryId: string;
  readonly idempotencyKey: string;
  readonly appendRequestDigest: string;
  readonly expectedJournalVersion: number;
  readonly committedJournalVersion: number | null;
  readonly previousHeadDigest: string | null;
  readonly committedHeadDigest: string | null;
  readonly committedOutcomeRevision: string | null;
  readonly appendedCount: 0 | 1;
  readonly ledgerEventId: number | null;
  readonly committedAtMs: number | null;
  readonly failureCode: string | null;
  readonly externalActionAuthorization: 'NONE';
}

export interface PersistedMutationJournal {
  readonly snapshot: Readonly<MutationJournalSnapshot>;
  readonly acknowledgement: Readonly<MutationAppendAcknowledgement>;
  /** L06 validates only an injected acknowledgement; I00 owns durable proof. */
  readonly acknowledgementValidated: true;
  readonly persistenceProven: false;
  readonly persistenceOwnerTarget: 'SYSTEM_INTEGRATION_LEDGER';
  readonly provenance: 'INJECTED_ACKNOWLEDGEMENT_ONLY';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export type ConfirmMutationAppendResult =
  | {
      readonly ok: true;
      readonly persisted: Readonly<PersistedMutationJournal>;
    }
  | {
      readonly ok: false;
      readonly reasonCode:
        | 'ACK_INVALID'
        | 'ACK_NOT_COMMITTED'
        | 'ACK_BINDING_MISMATCH'
        | 'ACK_CAUSALITY_INVALID';
    };

export interface SyntheticSubmissionBoundaryDecision {
  readonly schema: typeof L06_SYNTHETIC_BOUNDARY_SCHEMA;
  readonly version: 1;
  readonly mutationId: string;
  readonly boundaryId: string;
  readonly state: 'SYNTHETIC_OBSERVATION_ELIGIBLE' | 'BLOCKED';
  readonly reasonCodes: readonly string[];
  readonly journalVersion: number;
  readonly journalHeadDigest: string;
  readonly outcomeRevision: string;
  readonly evaluatedAtMs: number;
  readonly syntheticOnly: true;
  readonly sendAuthorized: false;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface MutationObservationInput {
  readonly observationId: string;
  readonly kind:
    | 'HTTP_OBSERVED'
    | 'PRIVATE_ORDER_OBSERVED'
    | 'PRIVATE_FILL_OBSERVED'
    | 'FOUNDATION_RECONCILIATION_OBSERVED'
    | 'TELEMETRY_DEGRADED';
  readonly occurredAtMs: number;
  readonly receivedAtMs: number;
  readonly sourceRevision: string;
  readonly payload: Readonly<MutationEntryPayload>;
}

export type PrepareObservationAppendResult =
  | { readonly kind: 'PREPARED'; readonly prepared: Readonly<PreparedMutationAppend> }
  | { readonly kind: 'EXACT_DUPLICATE'; readonly persisted: Readonly<PersistedMutationJournal> }
  | {
      readonly kind: 'IDENTITY_CONFLICT';
      readonly reasonCode: 'OBSERVATION_ID_REUSED';
      readonly preparedConflict: Readonly<PreparedMutationAppend> | null;
      readonly persistedConflict: Readonly<PersistedMutationJournal> | null;
    };

export interface MutationReconciliationHandoff {
  readonly schema: typeof L06_RECONCILIATION_HANDOFF_SCHEMA;
  readonly version: 1;
  readonly ownerTarget: 'FOUNDATION_RECONCILIATION';
  readonly mutationId: string;
  readonly product: MutationProduct;
  readonly accountRealmId: string;
  readonly symbol: string;
  readonly mutationKind: MutationKind;
  readonly clientOrderId: string;
  readonly venueOrderId: string | null;
  readonly requestedQuantity: string;
  readonly observedFilledQuantity: string;
  readonly journalVersion: number;
  readonly journalHeadDigest: string;
  readonly outcomeRevision: string;
  readonly privateSourceCutRevision: string;
  readonly lifecycleRevisions: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly queryIdentityOnly: true;
  readonly queryAuthorized: false;
  readonly retryAuthorized: false;
  readonly reconciliationAuthority: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export const MUTATION_JOURNAL_LIMITS = Object.freeze({
  maximumEntries: 256,
  maximumSerializedEntryBytes: 128 * 1_024,
  maximumSerializedAppendRequestBytes: 128 * 1_024,
  maximumSerializedSnapshotBytes: 512 * 1_024,
  maximumTelemetryEntries: 3,
  reservedMoneyCriticalEntries: 8,
  maximumHttpEntries: 32,
  maximumPrivateOrderEntries: 64,
  maximumPrivateFillEntries: 128,
  maximumReconciliationEntries: 8,
  maximumObservationIdentityConflictEntries: 8,
  maximumTrades: 128,
  maximumExternalTruthRefs: 64,
  maximumConflicts: 32,
  maximumLatencyMilestones: 7,
} as const);

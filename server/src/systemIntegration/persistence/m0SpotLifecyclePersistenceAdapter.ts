/**
 * Sole-Ledger owner of the one-card/one-lifecycle M0 Spot lock.
 *
 * Every action reservation is a compare-and-set transition that consumes one
 * exact server-held authority and appends its audit evidence in the same
 * SQLite transaction. ENTRY and FLATTEN also append canonical order_request
 * rows before a transport may be claimed. Replays never regain dispatch.
 */
import { createHash } from 'node:crypto';

import { canonicalJson } from '../../foundation/contracts/identity.js';
import {
  addSpotDecimals,
  compareSpotDecimals,
  multiplySpotDecimals,
  normalizeSpotDecimal,
  subtractSpotDecimals,
} from '../../foundation/exchange/binanceSpot/filters.js';
import {
  normalizeNonNegativeExactDecimal,
} from '../../capitalFoundation/contracts/decimal.js';
import {
  calculateM0SpotIntentDigest,
  calculateM0SpotLifecycleCardDigest,
  deriveM0SpotLifecycleId,
  M0_SPOT_ACTION_CONSUMPTION_SCHEMA,
  validateM0SpotActionAuthority,
  validateM0SpotLifecycleCard,
  type M0SpotActionAuthority,
  type M0SpotActionConsumptionReceipt,
  type M0SpotEgressAction,
  type M0SpotLifecycleCard,
} from '../../foundation/execution/m0SpotLifecycleCard.js';
import type {
  SpotFillObservation,
  SpotFlattenIntent,
  SpotLiveSubmitIntent,
  SpotQueryByClientOrderIdIntent,
  SpotQueryFillsIntent,
} from '../../foundation/execution/spotPort.js';
import {
  reconstructCanonicalSpotExecutionTicket,
  type SpotExecutionTicket,
} from '../../foundation/execution/spotTicket.js';
import type {
  SpotAuthoritativeFlatEvidence,
  SpotCommissionTotal,
  SpotQuoteAccounting,
  SpotSignedQuoteAmount,
} from '../../foundation/execution/spotTransportCoordinator.js';
import {
  createSpotSignedQuoteAmount,
  deriveSpotQuoteAccounting,
  spotSignedQuoteAmountsEqual,
  subtractSpotSignedQuoteAmounts,
} from '../../foundation/execution/spotTransportCoordinator.js';
import {
  deriveFlattenLeg,
  type DerivedFlattenLeg,
  type SpotFlattenAttemptFillSet,
} from '../../foundation/execution/spotCore.js';
import {
  buildSpotLedgerAppendIntent,
  type SpotLedgerAppendIntent,
  type SpotClock,
} from '../../foundation/reconciliation/spotLedgerBridge.js';
import type {
  BinanceSpotDispatchLeaseFence,
  BinanceSpotDispatchAuthorityPort,
  BinanceSpotDispatchPermit,
  BinanceSpotEgressConfirmRequest,
  BinanceSpotEgressSpendPort,
  BinanceSpotEgressSpendReceipt,
  BinanceSpotEgressSpendRequest,
  BinanceSpotExecutionOperation,
  BinanceSpotSignedTransportRequest,
} from '../../foundation/execution/m0SpotDispatch.js';
import {
  BINANCE_SPOT_DISPATCH_PERMIT_SCHEMA,
  BINANCE_SPOT_EGRESS_SPEND_SCHEMA,
  BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
  calculateBinanceSpotDispatchPermitDigest,
  calculateBinanceSpotDispatchRequestDigest,
} from '../../foundation/execution/m0SpotDispatch.js';
import type { FillInput } from '../../ledger.js';
import type {
  LedgerConfigCompareAndSetResult,
  LedgerEventInputRecord,
} from './types.js';
import {
  calculateM0SpotReadinessDigest,
  type M0SpotReadinessCard,
} from '../evidence/m0SpotReadinessCard.js';
import {
  validateM0SpotReadyCard,
} from '../production/m0SpotRuntimeBoundary.js';

export const M0_SPOT_LIFECYCLE_CONFIG_KEY =
  'system.integration.m0.spot-lifecycle.v2' as const;
export const M0_SPOT_LIFECYCLE_STATE_SCHEMA =
  'cosmos.system-integration.m0-spot-lifecycle-state.v2' as const;
export const M0_SPOT_LIFECYCLE_AUDIT_SCHEMA =
  'cosmos.system-integration.m0-spot-lifecycle-audit.v2' as const;

export type M0SpotLifecyclePhase =
  | 'ARMED'
  | 'ENTRY_RESERVED'
  | 'RECOVERY_REQUIRED'
  | 'FLATTEN_RESERVED'
  | 'RECONCILING'
  | 'DISARMED_NO_EXPOSURE'
  | 'DISARMED_SAFE';

export interface M0SpotExecutionLease {
  readonly status: 'ACTIVE' | 'PARKED';
  readonly mode: 'ENTRY' | 'RECOVERY_ONLY';
  readonly requestId: `m0_req_${string}`;
  readonly idempotencyKeyDigest: `sha256:${string}`;
  readonly operatorId: string;
  readonly executorId: string;
  readonly hostId: string;
  readonly bootId: string;
  readonly processId: string;
  readonly revision: string;
  readonly clockFenceId: `m0_clock_fence_${string}`;
  readonly acquiredAtMs: number;
  readonly acquiredMonotonicMs: number;
}

export interface M0SpotPersistedAction {
  readonly receipt: Readonly<M0SpotActionConsumptionReceipt>;
  readonly operation: BinanceSpotExecutionOperation;
  readonly requestDigest: `sha256:${string}` | null;
  readonly dispatchClaimed: boolean;
  readonly dispatchClaimedAtMs: number | null;
  readonly dispatchClaimedMonotonicMs: number | null;
  readonly dispatchLease: Readonly<BinanceSpotDispatchLeaseFence> | null;
  readonly dispatchPermitDigest: `sha256:${string}` | null;
  readonly dispatchDeadlineAtMs: number | null;
  readonly dispatchDeadlineMonotonicMs: number | null;
  readonly requestTimeoutMs: number | null;
  readonly recvWindowMs: number | null;
  readonly acceptanceSettlesAtMs: number | null;
  readonly acceptanceSettlesMonotonicMs: number | null;
  readonly egressSpentAtMs: number | null;
  readonly egressSpentMonotonicMs: number | null;
  readonly egressConfirmedAtMs: number | null;
  readonly egressConfirmedMonotonicMs: number | null;
  readonly egressConfirmation:
    | 'RESPONSE_RECEIVED'
    | 'AMBIGUOUS'
    | null;
  readonly authorityExpiresAtMs: number;
  readonly authorityExpiresMonotonicMs: number;
  readonly outcome:
    | 'NONE'
    | 'unknown'
    | 'accepted'
    | 'accepted_reconciled'
    | 'not_sent'
    | 'not_sent_rejected'
    | 'not_sent_reconciled';
}

export interface M0SpotOrderLegState {
  readonly ticket: Readonly<SpotExecutionTicket>;
  readonly reservationId: string;
  readonly venueOrderId: string | null;
  readonly venueStatus: string | null;
  readonly terminal: boolean;
  readonly fillsComplete: boolean;
  readonly cumulativeFilledQuantity: string;
  readonly notFoundFirstObservedAtMs: number | null;
  readonly notFoundFirstObservedMonotonicMs: number | null;
  readonly notFoundFirstObservedClockFenceId:
    `m0_clock_fence_${string}` | null;
  readonly notFoundObservationCount: number;
  readonly notFoundEvidenceRevisions: readonly string[];
  readonly notFoundQueryAuthorizationIds: readonly string[];
}

export interface M0SpotPersistedFill {
  readonly leg: 'ENTRY' | 'FLATTEN';
  readonly fillId: string;
  readonly venueOrderId: string;
  readonly price: string;
  readonly quantity: string;
  readonly quoteQuantity: string;
  readonly commission: string;
  readonly commissionAsset: string;
  readonly occurredAtMs: number;
  readonly fillDigest: `sha256:${string}`;
}

export interface M0SpotLifecycleState {
  readonly schema: typeof M0_SPOT_LIFECYCLE_STATE_SCHEMA;
  readonly version: 2;
  readonly lifecycleId: `m0_lifecycle_${string}`;
  readonly revision: number;
  readonly phase: M0SpotLifecyclePhase;
  readonly lifecycleLock: 'HELD' | 'RELEASED';
  readonly newEntryArmed: boolean;
  readonly execution: Readonly<M0SpotExecutionLease> | null;
  readonly card: Readonly<M0SpotLifecycleCard>;
  /** Full digest-verified §7 basis retained for restart-only recovery. */
  readonly readinessCard: Readonly<M0SpotReadinessCard>;
  readonly entryTicket: Readonly<SpotExecutionTicket>;
  readonly flattenTicket: Readonly<SpotExecutionTicket> | null;
  readonly actions: readonly Readonly<M0SpotPersistedAction>[];
  readonly ledgerAppends: readonly Readonly<{
    readonly dedupeKey: string;
    readonly intentDigest: `sha256:${string}`;
  }>[];
  readonly fills: readonly Readonly<M0SpotPersistedFill>[];
  readonly entry: Readonly<M0SpotOrderLegState> | null;
  readonly flatten: Readonly<M0SpotOrderLegState> | null;
  /** Completed prior FOK recovery attempts; `flatten` is the active/latest. */
  readonly flattenHistory: readonly Readonly<M0SpotOrderLegState>[];
  readonly residualQuantity: string;
  readonly reconciliation: Readonly<{
    readonly revision: string;
    readonly evidenceDigest: `sha256:${string}`;
    readonly canonicalStatus: 'EXACT';
    readonly ledgerState: 'MATCHED';
    readonly baseAsset: string;
    readonly baselineRevision: string;
    readonly baselineBaseQuantity: string;
    readonly observedBaseQuantity: string;
    readonly exchangeBaseTolerance: string;
    readonly residualQuantity: string;
    readonly residualDustNotionalQuote: string;
    readonly residualCondition:
      | 'EXACT_ZERO_DELTA_BASELINE_VERIFIED'
      | 'EXPLICIT_BOUNDED_DUST_BASELINE_VERIFIED';
    readonly quoteAsset: 'USDT';
    readonly baselineQuoteQuantity: string;
    readonly observedQuoteQuantity: string;
    readonly quoteQuantityTolerance: string;
    readonly observedQuoteDelta: Readonly<SpotSignedQuoteAmount>;
    readonly sourceGrossQuoteDebit: string;
    readonly flattenGrossQuoteCredit: string;
    readonly observedGrossLifecycleTurnoverQuote: string;
    readonly authorizedFilledLifecycleTurnoverQuote: string;
    readonly favorableSellPriceImprovementQuote: string;
    readonly referencePnlQuote: Readonly<SpotSignedQuoteAmount>;
    readonly signedSlippageCostQuote: Readonly<SpotSignedQuoteAmount>;
    readonly quoteCommissionDebit: string;
    readonly fillDerivedQuoteCashflow:
      Readonly<SpotSignedQuoteAmount>;
    readonly realizedPnlAfterQuoteFees:
      Readonly<SpotSignedQuoteAmount>;
    readonly quoteEquationResidual: Readonly<SpotSignedQuoteAmount>;
    readonly commissionTotals:
      readonly Readonly<SpotCommissionTotal>[];
    readonly quoteCashflowStatus: 'EXACT_WITHIN_TOLERANCE';
    readonly quoteEconomicsStatus:
      | 'EXACT'
      | 'UNMEASURED_THIRD_ASSET_QUOTE_VALUE';
    readonly thirdAssetCommissionQuoteValueStatus:
      | 'NOT_APPLICABLE'
      | 'UNMEASURED_NO_DIGEST_BOUND_VALUATION';
    readonly thirdAssetCommissionQuoteValue: null;
    readonly thirdAssetValuationDigest: null;
    readonly flattenAttemptCount: number;
    readonly durableMutationPosture: 'PROVEN_ABSENT';
    readonly reconciledAtMs: number;
  }> | null;
  readonly lastTransitionAtMs: number;
  readonly previousStateDigest: `sha256:${string}` | null;
  readonly stateDigest: `sha256:${string}`;
}

export interface M0SpotLifecycleClock extends SpotClock {
  monotonicMs(): number;
  clockFenceId(): `m0_clock_fence_${string}`;
}

export interface M0SpotLifecycleLedgerPort {
  getConfigValue(key: string): string | null;
  compareAndSetConfigValueAndLogEvents(
    key: string,
    expectedValue: string | null,
    nextValue: string,
    records: readonly LedgerEventInputRecord[],
    commitBeforeMs?: number,
  ): LedgerConfigCompareAndSetResult;
  insertFill(input: FillInput): boolean;
  readDurableMutationAuthority(): Readonly<{
    posture: 'PROVEN_ABSENT' | 'AMBIGUOUS' | 'UNKNOWN';
    unresolvedOrderCount: number;
    malformedOrderRowCount: number;
    readErrorCount: number;
  }>;
}

export interface M0SpotResolvedAction {
  readonly action: M0SpotEgressAction;
  readonly authority: Readonly<M0SpotActionAuthority>;
  readonly ticket: Readonly<SpotExecutionTicket>;
}

export interface M0SpotLifecycleActionResolver {
  resolve(
    input: Parameters<BinanceSpotDispatchAuthorityPort['claimDispatch']>[0],
    state: Readonly<M0SpotLifecycleState>,
  ): Readonly<M0SpotResolvedAction> | null;
}

export interface M0SpotLifecyclePersistenceOptions {
  readonly ledger: Readonly<M0SpotLifecycleLedgerPort>;
  readonly clock: Readonly<M0SpotLifecycleClock>;
  readonly resolveAction: Readonly<M0SpotLifecycleActionResolver>;
}

export type M0SpotLifecycleMutationResult =
  | {
      readonly disposition: 'COMMITTED_NEW';
      readonly state: Readonly<M0SpotLifecycleState>;
      readonly receipt?: Readonly<M0SpotActionConsumptionReceipt>;
    }
  | {
      readonly disposition: 'REPLAY_QUERY_ONLY';
      readonly state: Readonly<M0SpotLifecycleState>;
      readonly receipt?: Readonly<M0SpotActionConsumptionReceipt>;
    }
  | {
      readonly disposition: 'BLOCKED' | 'CONFLICT';
      readonly code: string;
      readonly state: Readonly<M0SpotLifecycleState> | null;
    };

export type M0SpotExecutionLeaseResult =
  | Readonly<{
      disposition: 'ACQUIRED';
      recovery: boolean;
      state: Readonly<M0SpotLifecycleState>;
    }>
  | Readonly<{
      disposition: 'IN_FLIGHT' | 'BLOCKED' | 'CONFLICT';
      code: string;
      state: Readonly<M0SpotLifecycleState> | null;
    }>;

const STATE_FIELDS = Object.freeze([
  'schema',
  'version',
  'lifecycleId',
  'revision',
  'phase',
  'lifecycleLock',
  'newEntryArmed',
  'execution',
  'card',
  'readinessCard',
  'entryTicket',
  'flattenTicket',
  'actions',
  'ledgerAppends',
  'fills',
  'entry',
  'flatten',
  'flattenHistory',
  'residualQuantity',
  'reconciliation',
  'lastTransitionAtMs',
  'previousStateDigest',
  'stateDigest',
] as const);
const STATE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CLIENT_ORDER_ID = /^[A-Za-z0-9_-]{1,36}$/u;
const MAX_ACTIONS = 64;
const MAX_FILLS = 1_000;
/** Must remain identical to Ledger's bounded config CAS value ceiling. */
const MAX_CONFIG_BYTES = 512 * 1_024;
const DISPATCH_PERMIT_LIFETIME_MS = 1_000;
const DISPATCH_REQUEST_TIMEOUT_MS = 5_000;
const DISPATCH_RECV_WINDOW_MS = 5_000;
const DISPATCH_ACCEPTANCE_WINDOW_MS =
  DISPATCH_REQUEST_TIMEOUT_MS + DISPATCH_RECV_WINDOW_MS;
const AUTHORITATIVE_ABSENCE_CONFIRMATION_GAP_MS = 1_000;
const DISPATCH_LEASE_FIELDS = Object.freeze([
  'status',
  'mode',
  'requestId',
  'idempotencyKeyDigest',
  'operatorId',
  'executorId',
  'hostId',
  'bootId',
  'processId',
  'revision',
  'clockFenceId',
  'acquiredAtMs',
  'acquiredMonotonicMs',
] as const);
const ACTION_FIELDS = Object.freeze([
  'receipt',
  'operation',
  'requestDigest',
  'dispatchClaimed',
  'dispatchClaimedAtMs',
  'dispatchClaimedMonotonicMs',
  'dispatchLease',
  'dispatchPermitDigest',
  'dispatchDeadlineAtMs',
  'dispatchDeadlineMonotonicMs',
  'requestTimeoutMs',
  'recvWindowMs',
  'acceptanceSettlesAtMs',
  'acceptanceSettlesMonotonicMs',
  'egressSpentAtMs',
  'egressSpentMonotonicMs',
  'egressConfirmedAtMs',
  'egressConfirmedMonotonicMs',
  'egressConfirmation',
  'authorityExpiresAtMs',
  'authorityExpiresMonotonicMs',
  'outcome',
] as const);
const EGRESS_SPEND_REQUEST_FIELDS = Object.freeze([
  'schema',
  'version',
  'lifecycleId',
  'authorizationId',
  'permitDigest',
  'requestDigest',
  'executionRequestId',
  'clockFenceId',
  'dispatchDeadlineAtMs',
  'dispatchDeadlineMonotonicMs',
] as const);
const EGRESS_SPEND_RECEIPT_FIELDS = Object.freeze([
  ...EGRESS_SPEND_REQUEST_FIELDS,
  'spentAtMs',
  'spentMonotonicMs',
  'state',
] as const);
const RECEIPT_FIELDS = Object.freeze([
  'schema',
  'version',
  'lifecycleId',
  'authorizationId',
  'cardId',
  'cardDigest',
  'action',
  'ticketId',
  'termsDigest',
  'clientOrderId',
  'intentDigest',
  'stateRevision',
  'nextStateRevision',
  'clockFenceId',
  'consumedAtMs',
  'consumedMonotonicMs',
  'state',
  'authorizationReuseAllowed',
] as const);
const ORDER_LEG_FIELDS = Object.freeze([
  'ticket',
  'reservationId',
  'venueOrderId',
  'venueStatus',
  'terminal',
  'fillsComplete',
  'cumulativeFilledQuantity',
  'notFoundFirstObservedAtMs',
  'notFoundFirstObservedMonotonicMs',
  'notFoundFirstObservedClockFenceId',
  'notFoundObservationCount',
  'notFoundEvidenceRevisions',
  'notFoundQueryAuthorizationIds',
] as const);
const RECONCILIATION_FIELDS = Object.freeze([
  'revision',
  'evidenceDigest',
  'canonicalStatus',
  'ledgerState',
  'baseAsset',
  'baselineRevision',
  'baselineBaseQuantity',
  'observedBaseQuantity',
  'exchangeBaseTolerance',
  'residualQuantity',
  'residualDustNotionalQuote',
  'residualCondition',
  'quoteAsset',
  'baselineQuoteQuantity',
  'observedQuoteQuantity',
  'quoteQuantityTolerance',
  'observedQuoteDelta',
  'sourceGrossQuoteDebit',
  'flattenGrossQuoteCredit',
  'observedGrossLifecycleTurnoverQuote',
  'authorizedFilledLifecycleTurnoverQuote',
  'favorableSellPriceImprovementQuote',
  'referencePnlQuote',
  'signedSlippageCostQuote',
  'quoteCommissionDebit',
  'fillDerivedQuoteCashflow',
  'realizedPnlAfterQuoteFees',
  'quoteEquationResidual',
  'commissionTotals',
  'quoteCashflowStatus',
  'quoteEconomicsStatus',
  'thirdAssetCommissionQuoteValueStatus',
  'thirdAssetCommissionQuoteValue',
  'thirdAssetValuationDigest',
  'flattenAttemptCount',
  'durableMutationPosture',
  'reconciledAtMs',
] as const);
const FLAT_EVIDENCE_FIELDS = Object.freeze([
  'revision',
  'sourceTicketId',
  'sourceClientOrderId',
  'sourceVenueOrderId',
  'sourceOrderAuthoritativelyAbsent',
  'sourceOpenOrderAbsent',
  'sourceOrderTerminal',
  'sourceFillsComplete',
  'sourceCumulativeFilledQuantity',
  'flattenTicketId',
  'flattenClientOrderId',
  'flattenVenueOrderId',
  'flattenOrderTerminal',
  'flattenFillsComplete',
  'flattenCumulativeFilledQuantity',
  'baseAsset',
  'baselineRevision',
  'baselineBaseQuantity',
  'observedBaseQuantity',
  'exchangeBaseTolerance',
  'maximumResidualDustNotionalQuote',
  'residualDustNotionalQuote',
  'sourceBaseCommissionQuantity',
  'flattenBaseCommissionQuantity',
  'canaryAttributableBaseDeltaQuantity',
  'flattenAttemptCount',
  'allFlattenOrdersTerminal',
  'allFlattenFillsComplete',
  'flattenOpenOrdersAbsent',
  'authoritativelyAbsentFlattenClientOrderIds',
  'canonicalStatus',
  'ledgerState',
  'quoteAsset',
  'baselineQuoteQuantity',
  'observedQuoteQuantity',
  'quoteQuantityTolerance',
  'observedQuoteDelta',
  'sourceGrossQuoteDebit',
  'flattenGrossQuoteCredit',
  'observedGrossLifecycleTurnoverQuote',
  'authorizedFilledLifecycleTurnoverQuote',
  'favorableSellPriceImprovementQuote',
  'referencePnlQuote',
  'signedSlippageCostQuote',
  'quoteCommissionDebit',
  'fillDerivedQuoteCashflow',
  'realizedPnlAfterQuoteFees',
  'quoteEquationResidual',
  'commissionTotals',
  'quoteCashflowStatus',
  'quoteEconomicsStatus',
  'thirdAssetCommissionQuoteValueStatus',
  'thirdAssetCommissionQuoteValue',
  'thirdAssetValuationDigest',
  'occurredAtMs',
] as const);

function sha256(namespace: string, value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256')
    .update(`${namespace}|${canonicalJson(value)}`, 'utf8')
    .digest('hex')}` as const;
}

function stateDigest(
  state: Omit<M0SpotLifecycleState, 'stateDigest'>,
): `sha256:${string}` {
  return sha256('m0-spot-lifecycle-state', state);
}

function withoutStateDigest(
  state: Readonly<M0SpotLifecycleState>,
): Omit<M0SpotLifecycleState, 'stateDigest'> {
  const {
    stateDigest: _stateDigest,
    ...without
  } = state;
  return without;
}

function exactFields(
  value: unknown,
  fields: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length
    && keys.every((key) =>
      typeof key === 'string' && fields.includes(key),
  );
}

function snapshotEgressSpendRequest(
  value: unknown,
): Readonly<BinanceSpotEgressSpendRequest> | null {
  try {
    const snapshot = structuredClone(value) as unknown;
    if (
      !exactFields(snapshot, EGRESS_SPEND_REQUEST_FIELDS)
      || snapshot.schema !== BINANCE_SPOT_EGRESS_SPEND_SCHEMA
      || snapshot.version !== 1
      || typeof snapshot.lifecycleId !== 'string'
      || !/^m0_lifecycle_[0-9a-f]{32}$/u.test(snapshot.lifecycleId)
      || typeof snapshot.authorizationId !== 'string'
      || !/^m0_action_[0-9a-f]{32}$/u.test(snapshot.authorizationId)
      || typeof snapshot.permitDigest !== 'string'
      || !STATE_DIGEST.test(snapshot.permitDigest)
      || typeof snapshot.requestDigest !== 'string'
      || !STATE_DIGEST.test(snapshot.requestDigest)
      || typeof snapshot.executionRequestId !== 'string'
      || !/^m0_req_[0-9a-f]{32}$/u.test(snapshot.executionRequestId)
      || typeof snapshot.clockFenceId !== 'string'
      || !/^m0_clock_fence_[A-Za-z0-9_.:-]{16,160}$/u
        .test(snapshot.clockFenceId)
      || !Number.isSafeInteger(snapshot.dispatchDeadlineAtMs)
      || (snapshot.dispatchDeadlineAtMs as number) < 0
      || !Number.isSafeInteger(
        snapshot.dispatchDeadlineMonotonicMs,
      )
      || (snapshot.dispatchDeadlineMonotonicMs as number) < 0
    ) return null;
    return deepFreezeData(
      snapshot as unknown as BinanceSpotEgressSpendRequest,
    );
  } catch {
    return null;
  }
}

function snapshotEgressSpendReceipt(
  value: unknown,
): Readonly<BinanceSpotEgressSpendReceipt> | null {
  try {
    const snapshot = structuredClone(value) as unknown;
    if (
      !exactFields(snapshot, EGRESS_SPEND_RECEIPT_FIELDS)
      || snapshot.schema !== BINANCE_SPOT_EGRESS_SPEND_SCHEMA
      || snapshot.version !== 1
      || typeof snapshot.lifecycleId !== 'string'
      || !/^m0_lifecycle_[0-9a-f]{32}$/u.test(snapshot.lifecycleId)
      || typeof snapshot.authorizationId !== 'string'
      || !/^m0_action_[0-9a-f]{32}$/u.test(snapshot.authorizationId)
      || typeof snapshot.permitDigest !== 'string'
      || !STATE_DIGEST.test(snapshot.permitDigest)
      || typeof snapshot.requestDigest !== 'string'
      || !STATE_DIGEST.test(snapshot.requestDigest)
      || typeof snapshot.executionRequestId !== 'string'
      || !/^m0_req_[0-9a-f]{32}$/u.test(snapshot.executionRequestId)
      || typeof snapshot.clockFenceId !== 'string'
      || !/^m0_clock_fence_[A-Za-z0-9_.:-]{16,160}$/u
        .test(snapshot.clockFenceId)
      || !Number.isSafeInteger(snapshot.dispatchDeadlineAtMs)
      || (snapshot.dispatchDeadlineAtMs as number) < 0
      || !Number.isSafeInteger(
        snapshot.dispatchDeadlineMonotonicMs,
      )
      || (snapshot.dispatchDeadlineMonotonicMs as number) < 0
      || !Number.isSafeInteger(snapshot.spentAtMs)
      || (snapshot.spentAtMs as number) < 0
      || !Number.isSafeInteger(snapshot.spentMonotonicMs)
      || (snapshot.spentMonotonicMs as number) < 0
      || snapshot.state !== 'SPENT_ONCE'
    ) return null;
    return deepFreezeData(
      snapshot as unknown as BinanceSpotEgressSpendReceipt,
    );
  } catch {
    return null;
  }
}

function validDispatchLease(
  value: unknown,
): value is Readonly<BinanceSpotDispatchLeaseFence> {
  return exactFields(value, DISPATCH_LEASE_FIELDS)
    && value.status === 'ACTIVE'
    && (value.mode === 'ENTRY' || value.mode === 'RECOVERY_ONLY')
    && typeof value.requestId === 'string'
    && /^m0_req_[0-9a-f]{32}$/u.test(value.requestId)
    && typeof value.idempotencyKeyDigest === 'string'
    && STATE_DIGEST.test(value.idempotencyKeyDigest)
    && typeof value.operatorId === 'string'
    && value.operatorId.length >= 1
    && value.operatorId.length <= 160
    && typeof value.executorId === 'string'
    && value.executorId.length >= 1
    && value.executorId.length <= 160
    && typeof value.hostId === 'string'
    && value.hostId.length >= 1
    && value.hostId.length <= 160
    && typeof value.bootId === 'string'
    && value.bootId.length >= 1
    && value.bootId.length <= 160
    && typeof value.processId === 'string'
    && value.processId.length >= 1
    && value.processId.length <= 160
    && typeof value.revision === 'string'
    && /^[0-9a-f]{40}$/u.test(value.revision)
    && typeof value.clockFenceId === 'string'
    && /^m0_clock_fence_[A-Za-z0-9_.:-]{16,160}$/u
      .test(value.clockFenceId)
    && typeof value.acquiredAtMs === 'number'
    && Number.isSafeInteger(value.acquiredAtMs)
    && value.acquiredAtMs >= 0
    && typeof value.acquiredMonotonicMs === 'number'
    && Number.isSafeInteger(value.acquiredMonotonicMs)
    && value.acquiredMonotonicMs >= 0;
}

function rebasedWallDeadlineMonotonic(
  lease: Readonly<BinanceSpotDispatchLeaseFence | M0SpotExecutionLease>,
  wallDeadlineMs: number,
): number | null {
  const remainingAtAcquisitionMs = wallDeadlineMs - lease.acquiredAtMs;
  const deadline = lease.acquiredMonotonicMs + remainingAtAcquisitionMs;
  return remainingAtAcquisitionMs >= 0
    && Number.isSafeInteger(deadline)
    && deadline >= lease.acquiredMonotonicMs
    ? deadline
    : null;
}

function expectedPersistedDispatchPermitDigest(
  state: Readonly<M0SpotLifecycleState>,
  action: Readonly<M0SpotPersistedAction>,
): `sha256:${string}` | null {
  if (
    action.requestDigest === null
    || action.dispatchLease === null
    || action.dispatchClaimedAtMs === null
    || action.dispatchClaimedMonotonicMs === null
    || action.dispatchDeadlineAtMs === null
    || action.dispatchDeadlineMonotonicMs === null
    || action.requestTimeoutMs === null
    || action.recvWindowMs === null
    || action.acceptanceSettlesAtMs === null
    || action.acceptanceSettlesMonotonicMs === null
  ) return null;
  return calculateBinanceSpotDispatchPermitDigest(Object.freeze({
    schema: BINANCE_SPOT_DISPATCH_PERMIT_SCHEMA,
    version: 1 as const,
    operation: action.operation,
    credentialProfile:
      action.operation === 'QUERY_ORDER'
      || action.operation === 'QUERY_FILLS'
        ? 'USER_DATA_READ' as const
        : 'SPOT_TRADE_EXECUTION' as const,
    action: action.receipt.action,
    lifecycleId: state.lifecycleId,
    cardDigest: state.card.cardDigest,
    ticketId: action.receipt.ticketId,
    termsDigest: action.receipt.termsDigest,
    clientOrderId: action.receipt.clientOrderId,
    requestDigest: action.requestDigest,
    executionLease: action.dispatchLease,
    claimedAtMs: action.dispatchClaimedAtMs,
    claimedMonotonicMs: action.dispatchClaimedMonotonicMs,
    dispatchDeadlineAtMs: action.dispatchDeadlineAtMs,
    dispatchDeadlineMonotonicMs: action.dispatchDeadlineMonotonicMs,
    requestTimeoutMs: action.requestTimeoutMs,
    recvWindowMs: action.recvWindowMs,
    acceptanceSettlesAtMs: action.acceptanceSettlesAtMs,
    acceptanceSettlesMonotonicMs:
      action.acceptanceSettlesMonotonicMs,
    receipt: action.receipt,
    dispatchCardinality: 'ONE' as const,
    automaticRetry: false as const,
    externalActionAuthorization:
      'DURABLE_ONE_USE_ACTION_CONSUMED' as const,
  }));
}

function exactOrderedStrings(
  value: unknown,
  expected: readonly string[],
): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) {
    return false;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (
      !Object.prototype.hasOwnProperty.call(value, index)
      || typeof value[index] !== 'string'
      || value[index] !== expected[index]
    ) return false;
  }
  return true;
}

function validPersistedTicket(
  value: unknown,
): value is Readonly<SpotExecutionTicket> {
  return reconstructCanonicalSpotExecutionTicket(value) !== null;
}

function validOrderLeg(value: unknown): value is M0SpotOrderLegState {
  if (!exactFields(value, ORDER_LEG_FIELDS)) return false;
  const notFoundObservationCount = value.notFoundObservationCount;
  const notFoundFirstObservedAtMs = value.notFoundFirstObservedAtMs;
  const notFoundFirstObservedMonotonicMs =
    value.notFoundFirstObservedMonotonicMs;
  const notFoundFirstObservedClockFenceId =
    value.notFoundFirstObservedClockFenceId;
  const notFoundEvidenceRevisions = value.notFoundEvidenceRevisions;
  const notFoundQueryAuthorizationIds =
    value.notFoundQueryAuthorizationIds;
  if (
    !validPersistedTicket(value.ticket)
    || typeof value.reservationId !== 'string'
    || !/^[0-9a-f]{32}$/u.test(value.reservationId)
    || (
      value.venueOrderId !== null
      && (
        typeof value.venueOrderId !== 'string'
        || !/^[0-9]+$/u.test(value.venueOrderId)
      )
    )
    || (
      value.venueStatus !== null
      && (
        typeof value.venueStatus !== 'string'
        || !/^[A-Z_]{2,40}$/u.test(value.venueStatus)
      )
    )
    || typeof value.terminal !== 'boolean'
    || typeof value.fillsComplete !== 'boolean'
    || typeof value.cumulativeFilledQuantity !== 'string'
    || typeof notFoundObservationCount !== 'number'
    || !Number.isSafeInteger(notFoundObservationCount)
    || notFoundObservationCount < 0
    || !Array.isArray(notFoundEvidenceRevisions)
    || !Array.isArray(notFoundQueryAuthorizationIds)
    || notFoundEvidenceRevisions.length !== notFoundObservationCount
    || notFoundQueryAuthorizationIds.length !== notFoundObservationCount
    || notFoundEvidenceRevisions.length > 24
    || notFoundEvidenceRevisions.some((revision, index, rows) =>
      typeof revision !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u.test(revision)
      || rows.indexOf(revision) !== index
    )
    || notFoundQueryAuthorizationIds.some((authorizationId, index, rows) =>
      typeof authorizationId !== 'string'
      || !/^m0_action_[0-9a-f]{32}$/u.test(authorizationId)
      || rows.indexOf(authorizationId) !== index
    )
    || (
      notFoundFirstObservedAtMs !== null
      && (
        typeof notFoundFirstObservedAtMs !== 'number'
        || !Number.isSafeInteger(notFoundFirstObservedAtMs)
        || notFoundFirstObservedAtMs < 0
      )
    )
    || (
      notFoundFirstObservedMonotonicMs !== null
      && (
        typeof notFoundFirstObservedMonotonicMs !== 'number'
        || !Number.isSafeInteger(notFoundFirstObservedMonotonicMs)
        || notFoundFirstObservedMonotonicMs < 0
      )
    )
    || (
      notFoundFirstObservedClockFenceId !== null
      && (
        typeof notFoundFirstObservedClockFenceId !== 'string'
        || !/^m0_clock_fence_[A-Za-z0-9_.:-]{16,160}$/u
          .test(notFoundFirstObservedClockFenceId)
      )
    )
    || (
      notFoundObservationCount === 0
      && (
        notFoundFirstObservedAtMs !== null
        || notFoundFirstObservedMonotonicMs !== null
        || notFoundFirstObservedClockFenceId !== null
      )
    )
    || (
      notFoundObservationCount > 0
      && (
        notFoundFirstObservedAtMs === null
        || notFoundFirstObservedMonotonicMs === null
        || notFoundFirstObservedClockFenceId === null
        || value.venueOrderId !== null
        || (
          value.venueStatus !== 'NOT_FOUND_PENDING_CONFIRMATION'
          && value.venueStatus !== 'AUTHORITATIVE_NOT_FOUND'
        )
      )
    )
    || (
      value.venueStatus === 'AUTHORITATIVE_NOT_FOUND'
      && (!value.terminal || !value.fillsComplete)
    )
  ) return false;
  try {
    const quantity = normalizeSpotDecimal(
      value.cumulativeFilledQuantity,
      'M0 persisted cumulative fill quantity',
    );
    return quantity === value.cumulativeFilledQuantity
      && compareSpotDecimals(quantity, value.ticket.quantity) <= 0;
  } catch {
    return false;
  }
}

function validSignedQuoteAmount(
  value: unknown,
): value is Readonly<SpotSignedQuoteAmount> {
  if (
    !exactFields(value, ['direction', 'quantity'])
    || (
      value.direction !== 'CREDIT'
      && value.direction !== 'DEBIT'
      && value.direction !== 'ZERO'
    )
    || typeof value.quantity !== 'string'
  ) return false;
  try {
    const quantity = normalizeSpotDecimal(
      value.quantity,
      'M0 signed quote quantity',
    );
    return quantity === value.quantity
      && (value.direction === 'ZERO') === (quantity === '0');
  } catch {
    return false;
  }
}

function validCommissionTotals(
  value: unknown,
): value is readonly Readonly<SpotCommissionTotal>[] {
  if (!Array.isArray(value) || value.length > 64) return false;
  let previousKey: string | null = null;
  try {
    for (const row of value) {
      if (
        !exactFields(row, ['leg', 'asset', 'quantity'])
        || (row.leg !== 'ENTRY' && row.leg !== 'FLATTEN')
        || typeof row.asset !== 'string'
        || !/^[A-Z0-9]{1,16}$/u.test(row.asset)
        || typeof row.quantity !== 'string'
      ) return false;
      const quantity = normalizeSpotDecimal(
        row.quantity,
        'M0 commission total quantity',
      );
      const key = `${row.leg === 'ENTRY' ? '0' : '1'}|${row.asset}`;
      if (
        quantity === '0'
        || quantity !== row.quantity
        || (previousKey !== null && key <= previousKey)
      ) return false;
      previousKey = key;
    }
    return true;
  } catch {
    return false;
  }
}

function validReconciliation(
  value: unknown,
): value is NonNullable<M0SpotLifecycleState['reconciliation']> {
  if (!exactFields(value, RECONCILIATION_FIELDS)) return false;
  if (
    typeof value.revision !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u.test(value.revision)
    || typeof value.evidenceDigest !== 'string'
    || !STATE_DIGEST.test(value.evidenceDigest)
    || value.canonicalStatus !== 'EXACT'
    || value.ledgerState !== 'MATCHED'
    || typeof value.baseAsset !== 'string'
    || !/^[A-Z0-9]{1,16}$/u.test(value.baseAsset)
    || typeof value.baselineRevision !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$/u
      .test(value.baselineRevision)
    || typeof value.baselineBaseQuantity !== 'string'
    || typeof value.observedBaseQuantity !== 'string'
    || typeof value.exchangeBaseTolerance !== 'string'
    || typeof value.residualQuantity !== 'string'
    || typeof value.residualDustNotionalQuote !== 'string'
    || (
      value.residualCondition !== 'EXACT_ZERO_DELTA_BASELINE_VERIFIED'
      && value.residualCondition
        !== 'EXPLICIT_BOUNDED_DUST_BASELINE_VERIFIED'
    )
    || value.quoteAsset !== 'USDT'
    || typeof value.baselineQuoteQuantity !== 'string'
    || typeof value.observedQuoteQuantity !== 'string'
    || typeof value.quoteQuantityTolerance !== 'string'
    || !validSignedQuoteAmount(value.observedQuoteDelta)
    || typeof value.sourceGrossQuoteDebit !== 'string'
    || typeof value.flattenGrossQuoteCredit !== 'string'
    || typeof value.observedGrossLifecycleTurnoverQuote !== 'string'
    || typeof value.authorizedFilledLifecycleTurnoverQuote !== 'string'
    || typeof value.favorableSellPriceImprovementQuote !== 'string'
    || !validSignedQuoteAmount(value.referencePnlQuote)
    || !validSignedQuoteAmount(value.signedSlippageCostQuote)
    || typeof value.quoteCommissionDebit !== 'string'
    || !validSignedQuoteAmount(value.fillDerivedQuoteCashflow)
    || !validSignedQuoteAmount(value.realizedPnlAfterQuoteFees)
    || !validSignedQuoteAmount(value.quoteEquationResidual)
    || !validCommissionTotals(value.commissionTotals)
    || value.quoteCashflowStatus !== 'EXACT_WITHIN_TOLERANCE'
    || (
      value.quoteEconomicsStatus !== 'EXACT'
      && value.quoteEconomicsStatus
        !== 'UNMEASURED_THIRD_ASSET_QUOTE_VALUE'
    )
    || (
      value.thirdAssetCommissionQuoteValueStatus !== 'NOT_APPLICABLE'
      && value.thirdAssetCommissionQuoteValueStatus
        !== 'UNMEASURED_NO_DIGEST_BOUND_VALUATION'
    )
    || value.thirdAssetCommissionQuoteValue !== null
    || value.thirdAssetValuationDigest !== null
    || typeof value.flattenAttemptCount !== 'number'
    || !Number.isSafeInteger(value.flattenAttemptCount)
    || value.flattenAttemptCount < 0
    || value.flattenAttemptCount > 3
    || value.durableMutationPosture !== 'PROVEN_ABSENT'
    || typeof value.reconciledAtMs !== 'number'
    || !Number.isSafeInteger(value.reconciledAtMs)
    || value.reconciledAtMs < 0
  ) return false;
  try {
    const baseline = normalizeSpotDecimal(
      value.baselineBaseQuantity,
      'M0 reconciled baseline base quantity',
    );
    const observed = normalizeSpotDecimal(
      value.observedBaseQuantity,
      'M0 reconciled observed base quantity',
    );
    const tolerance = normalizeSpotDecimal(
      value.exchangeBaseTolerance,
      'M0 reconciled exchange base tolerance',
    );
    const residual = normalizeSpotDecimal(
      value.residualQuantity,
      'M0 reconciled residual quantity',
    );
    const residualDust = normalizeSpotDecimal(
      value.residualDustNotionalQuote,
      'M0 reconciled residual dust notional',
    );
    const baselineQuote = normalizeSpotDecimal(
      value.baselineQuoteQuantity,
      'M0 reconciled baseline quote quantity',
    );
    const observedQuote = normalizeSpotDecimal(
      value.observedQuoteQuantity,
      'M0 reconciled observed quote quantity',
    );
    const quoteTolerance = normalizeSpotDecimal(
      value.quoteQuantityTolerance,
      'M0 reconciled quote tolerance',
    );
    const sourceGross = normalizeSpotDecimal(
      value.sourceGrossQuoteDebit,
      'M0 reconciled source gross quote',
    );
    const flattenGross = normalizeSpotDecimal(
      value.flattenGrossQuoteCredit,
      'M0 reconciled flatten gross quote',
    );
    const observedGross = normalizeSpotDecimal(
      value.observedGrossLifecycleTurnoverQuote,
      'M0 reconciled observed gross turnover',
    );
    const authorizedGross = normalizeSpotDecimal(
      value.authorizedFilledLifecycleTurnoverQuote,
      'M0 reconciled authorized turnover',
    );
    const favorableSell = normalizeSpotDecimal(
      value.favorableSellPriceImprovementQuote,
      'M0 reconciled favorable SELL improvement',
    );
    const quoteCommission = normalizeSpotDecimal(
      value.quoteCommissionDebit,
      'M0 reconciled quote commission',
    );
    const quoteCommissionFromVector = value.commissionTotals
      .filter((row) => row.asset === 'USDT')
      .reduce(
        (sum, row) => addSpotDecimals(sum, row.quantity),
        '0',
      );
    const thirdAssetCommissionPresent = value.commissionTotals.some((row) =>
      row.asset !== value.baseAsset
      && row.asset !== 'USDT'
      && row.quantity !== '0',
    );
    const decomposedCashflow = subtractSpotSignedQuoteAmounts(
      subtractSpotSignedQuoteAmounts(
        value.referencePnlQuote,
        value.signedSlippageCostQuote,
      ),
      createSpotSignedQuoteAmount(quoteCommission, '0'),
    );
    const expectedEquationResidual = subtractSpotSignedQuoteAmounts(
      value.observedQuoteDelta,
      value.fillDerivedQuoteCashflow,
    );
    return baseline === value.baselineBaseQuantity
      && observed === value.observedBaseQuantity
      && tolerance === value.exchangeBaseTolerance
      && residual === value.residualQuantity
      && residualDust === value.residualDustNotionalQuote
      && baselineQuote === value.baselineQuoteQuantity
      && observedQuote === value.observedQuoteQuantity
      && quoteTolerance === value.quoteQuantityTolerance
      && sourceGross === value.sourceGrossQuoteDebit
      && flattenGross === value.flattenGrossQuoteCredit
      && observedGross === value.observedGrossLifecycleTurnoverQuote
      && observedGross === addSpotDecimals(sourceGross, flattenGross)
      && authorizedGross
        === value.authorizedFilledLifecycleTurnoverQuote
      && favorableSell === value.favorableSellPriceImprovementQuote
      && observedGross
        === addSpotDecimals(authorizedGross, favorableSell)
      && quoteCommission === value.quoteCommissionDebit
      && quoteCommission === quoteCommissionFromVector
      && spotSignedQuoteAmountsEqual(
        value.observedQuoteDelta,
        createSpotSignedQuoteAmount(observedQuote, baselineQuote),
      )
      && spotSignedQuoteAmountsEqual(
        value.fillDerivedQuoteCashflow,
        decomposedCashflow,
      )
      && spotSignedQuoteAmountsEqual(
        value.realizedPnlAfterQuoteFees,
        value.fillDerivedQuoteCashflow,
      )
      && spotSignedQuoteAmountsEqual(
        value.quoteEquationResidual,
        expectedEquationResidual,
      )
      && compareSpotDecimals(
        value.quoteEquationResidual.quantity,
        quoteTolerance,
      ) <= 0
      && (
        thirdAssetCommissionPresent
          ? (
              value.quoteEconomicsStatus
                === 'UNMEASURED_THIRD_ASSET_QUOTE_VALUE'
              && value.thirdAssetCommissionQuoteValueStatus
                === 'UNMEASURED_NO_DIGEST_BOUND_VALUATION'
            )
          : (
              value.quoteEconomicsStatus === 'EXACT'
              && value.thirdAssetCommissionQuoteValueStatus
                === 'NOT_APPLICABLE'
            )
      )
      && (
        value.residualCondition
          === 'EXACT_ZERO_DELTA_BASELINE_VERIFIED'
          ? residual === '0' && observed === baseline
          : residual !== '0' || observed !== baseline
      );
  } catch {
    return false;
  }
}

function terminalPhase(phase: M0SpotLifecyclePhase): boolean {
  return phase === 'DISARMED_SAFE' || phase === 'DISARMED_NO_EXPOSURE';
}

function ownsExecution(
  state: Readonly<M0SpotLifecycleState>,
  clockFenceId: string,
): boolean {
  return state.execution?.status === 'ACTIVE'
    && state.execution.clockFenceId === clockFenceId;
}

function deepFreezeData<T>(
  value: T,
  seen: WeakSet<object> = new WeakSet<object>(),
): Readonly<T> {
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const descriptor of Object.values(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        deepFreezeData(descriptor.value, seen);
      }
    }
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}

function canonicalTicketSnapshot(
  ticket: Readonly<SpotExecutionTicket>,
): Readonly<SpotExecutionTicket> {
  const canonical = reconstructCanonicalSpotExecutionTicket(ticket);
  if (canonical === null) {
    throw new TypeError('M0 Spot ticket is not canonical');
  }
  return canonical;
}

function frozenState(
  value: Omit<M0SpotLifecycleState, 'stateDigest'>,
): Readonly<M0SpotLifecycleState> {
  const digest = stateDigest(value);
  return deepFreezeData({
    ...value,
    execution:
      value.execution === null
        ? null
        : Object.freeze({ ...value.execution }),
    actions: Object.freeze(value.actions.map((action) =>
      Object.freeze({
        ...action,
        receipt: Object.freeze({ ...action.receipt }),
      }),
    )),
    ledgerAppends: Object.freeze(value.ledgerAppends.map((append) =>
      Object.freeze({ ...append }),
    )),
    fills: Object.freeze(value.fills.map((fill) =>
      Object.freeze({ ...fill }),
    )),
    flattenHistory: Object.freeze(value.flattenHistory.map((leg) =>
      Object.freeze({
        ...leg,
        ticket: Object.freeze({ ...leg.ticket }),
      }),
    )),
    stateDigest: digest,
  });
}

function serializeState(state: Readonly<M0SpotLifecycleState>): string {
  // This closed schema intentionally persists consumed authorization receipts.
  // The shared config codec rejects every authorization-shaped field because
  // arbitrary config values are not allowed to carry capabilities. These
  // receipts are tombstones, not reusable authority, and every nested field is
  // rebound and revalidated by parseState before it can influence dispatch.
  const serialized = canonicalJson(state);
  if (
    serialized !== canonicalJson(state)
    || Buffer.byteLength(serialized, 'utf8') > MAX_CONFIG_BYTES
  ) throw new RangeError('M0 Spot lifecycle state exceeds its durable bound');
  return serialized;
}

function validPhase(value: unknown): value is M0SpotLifecyclePhase {
  return [
    'ARMED',
    'ENTRY_RESERVED',
    'RECOVERY_REQUIRED',
    'FLATTEN_RESERVED',
    'RECONCILING',
    'DISARMED_NO_EXPOSURE',
    'DISARMED_SAFE',
  ].includes(value as string);
}

function parseState(
  serialized: string | null,
): Readonly<M0SpotLifecycleState> | null {
  if (serialized === null) return null;
  if (
    Buffer.byteLength(serialized, 'utf8') > MAX_CONFIG_BYTES
  ) throw new Error('M0_SPOT_LIFECYCLE_STATE_CORRUPT');
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error('M0_SPOT_LIFECYCLE_STATE_CORRUPT');
  }
  if (
    !exactFields(value, STATE_FIELDS)
    || value.schema !== M0_SPOT_LIFECYCLE_STATE_SCHEMA
    || value.version !== 2
    || typeof value.lifecycleId !== 'string'
    || !/^m0_lifecycle_[0-9a-f]{32}$/u.test(value.lifecycleId)
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 0
    || !validPhase(value.phase)
    || (value.lifecycleLock !== 'HELD' && value.lifecycleLock !== 'RELEASED')
    || typeof value.newEntryArmed !== 'boolean'
    || (
      value.execution !== null
      && (
        !exactFields(value.execution, [
          'status',
          'mode',
          'requestId',
          'idempotencyKeyDigest',
          'operatorId',
          'executorId',
          'hostId',
          'bootId',
          'processId',
          'revision',
          'clockFenceId',
          'acquiredAtMs',
          'acquiredMonotonicMs',
        ])
        || (
          value.execution.status !== 'ACTIVE'
          && value.execution.status !== 'PARKED'
        )
        || (
          value.execution.mode !== 'ENTRY'
          && value.execution.mode !== 'RECOVERY_ONLY'
        )
        || typeof value.execution.requestId !== 'string'
        || !/^m0_req_[0-9a-f]{32}$/u.test(value.execution.requestId)
        || typeof value.execution.idempotencyKeyDigest !== 'string'
        || !STATE_DIGEST.test(value.execution.idempotencyKeyDigest)
        || typeof value.execution.operatorId !== 'string'
        || value.execution.operatorId.length < 1
        || value.execution.operatorId.length > 160
        || typeof value.execution.executorId !== 'string'
        || value.execution.executorId.length < 1
        || value.execution.executorId.length > 160
        || typeof value.execution.hostId !== 'string'
        || value.execution.hostId.length < 1
        || value.execution.hostId.length > 160
        || typeof value.execution.bootId !== 'string'
        || value.execution.bootId.length < 1
        || value.execution.bootId.length > 160
        || typeof value.execution.processId !== 'string'
        || value.execution.processId.length < 1
        || value.execution.processId.length > 160
        || typeof value.execution.revision !== 'string'
        || !/^[0-9a-f]{40}$/u.test(value.execution.revision)
        || typeof value.execution.clockFenceId !== 'string'
        || !/^m0_clock_fence_[A-Za-z0-9_.:-]{16,160}$/u
          .test(value.execution.clockFenceId)
        || typeof value.execution.acquiredAtMs !== 'number'
        || !Number.isSafeInteger(value.execution.acquiredAtMs)
        || value.execution.acquiredAtMs < 0
        || typeof value.execution.acquiredMonotonicMs !== 'number'
        || !Number.isSafeInteger(value.execution.acquiredMonotonicMs)
        || value.execution.acquiredMonotonicMs < 0
      )
    )
    || !Array.isArray(value.actions)
    || value.actions.length > MAX_ACTIONS
    || !Array.isArray(value.ledgerAppends)
    || value.ledgerAppends.length > MAX_ACTIONS
    || !Array.isArray(value.fills)
    || value.fills.length > MAX_FILLS
    || !validPersistedTicket(value.entryTicket)
    || (
      value.flattenTicket !== null
      && !validPersistedTicket(value.flattenTicket)
    )
    || (value.entry !== null && !validOrderLeg(value.entry))
    || (value.flatten !== null && !validOrderLeg(value.flatten))
    || !Array.isArray(value.flattenHistory)
    || value.flattenHistory.length > 2
    || value.flattenHistory.some((leg) => !validOrderLeg(leg))
    || (
      value.reconciliation !== null
      && !validReconciliation(value.reconciliation)
    )
    || typeof value.residualQuantity !== 'string'
    || !Number.isSafeInteger(value.lastTransitionAtMs)
    || (value.lastTransitionAtMs as number) < 0
    || (
      value.previousStateDigest !== null
      && (
        typeof value.previousStateDigest !== 'string'
        || !STATE_DIGEST.test(value.previousStateDigest)
      )
    )
    || typeof value.stateDigest !== 'string'
    || !STATE_DIGEST.test(value.stateDigest)
  ) throw new Error('M0_SPOT_LIFECYCLE_STATE_CORRUPT');
  const state = value as unknown as M0SpotLifecycleState;
  let canonical: string;
  try {
    canonical = canonicalJson(state);
  } catch {
    throw new Error('M0_SPOT_LIFECYCLE_STATE_CORRUPT');
  }
  const expectedCardDigest = calculateM0SpotLifecycleCardDigest(
    Object.freeze(Object.fromEntries(
      Object.entries(state.card).filter(([key]) => key !== 'cardDigest'),
    )) as unknown as Omit<M0SpotLifecycleCard, 'cardDigest'>,
  );
  const expectedReadinessDigest = calculateM0SpotReadinessDigest(
    Object.freeze(Object.fromEntries(
      Object.entries(state.readinessCard).filter(
        ([key]) => key !== 'readinessDigest',
      ),
    )) as unknown as Omit<M0SpotReadinessCard, 'readinessDigest'>,
  );
  if (
    canonical !== serialized
    || state.lifecycleId !== deriveM0SpotLifecycleId(state.card.cardDigest)
    || state.card.cardDigest !== expectedCardDigest
    || state.readinessCard.readinessDigest !== expectedReadinessDigest
    || state.readinessCard.lifecycleCardDigest !== state.card.cardDigest
    || state.readinessCard.gate2Ready !== true
    || state.readinessCard.disposition !== 'READY_FOR_OWNER_GATE_2'
    || state.readinessCard.evidenceAuthority !== 'RUNTIME_PRIVATE'
    || state.readinessCard.clientIdentity.ticketId
      !== state.entryTicket.ticketId
    || state.readinessCard.clientIdentity.termsDigest
      !== state.entryTicket.termsDigest
    || state.readinessCard.clientIdentity.entryClientOrderId
      !== state.entryTicket.clientOrderId
    || state.readinessCard.order.symbol !== state.card.symbol
    || state.readinessCard.order.baseAsset !== state.card.baseAsset
    || state.readinessCard.order.quoteAmount
      !== state.card.entryNotionalQuote
    || state.readinessCard.order.baseQuantity !== state.entryTicket.quantity
    || state.readinessCard.order.price !== state.entryTicket.price
    || state.readinessCard.order.timeInForce !== state.entryTicket.timeInForce
    || state.readinessCard.limits.maximumGrossLifecycleTurnoverQuote
      !== state.card.maximumGrossLifecycleTurnoverQuote
    || state.readinessCard.limits.maximumResidualDustNotionalQuote
      !== state.card.maximumResidualDustNotionalQuote
    || state.readinessCard.baseline.baseAsset !== state.card.baseAsset
    || state.readinessCard.baseline.baselineRevision === null
    || state.readinessCard.baseline.baselineBaseQuantity === null
    || state.readinessCard.baseline.exchangeBaseTolerance === null
    || state.readinessCard.baseline.observedAtMs === null
    || state.readinessCard.recovery.baselineRevision
      !== state.readinessCard.baseline.baselineRevision
    || state.readinessCard.recovery.exchangeBaseTolerance
      !== state.readinessCard.baseline.exchangeBaseTolerance
    || state.readinessCard.recovery.maximumResidualDustNotionalQuote
      !== state.readinessCard.limits.maximumResidualDustNotionalQuote
    || state.entryTicket.ticketId !== state.card.entryTicketId
    || state.entryTicket.termsDigest !== state.card.entryTermsDigest
    || state.entryTicket.clientOrderId !== state.card.entryClientOrderId
    || state.actions.some((action, index, rows) => (
      !exactFields(action, ACTION_FIELDS)
      || !exactFields(action.receipt, RECEIPT_FIELDS)
      || action.receipt.schema !== M0_SPOT_ACTION_CONSUMPTION_SCHEMA
      || action.receipt.version !== 1
      || action.receipt.lifecycleId !== state.lifecycleId
      || action.receipt.cardDigest !== state.card.cardDigest
      || action.receipt.cardId !== state.card.cardId
      || !/^m0_action_[0-9a-f]{32}$/u
        .test(action.receipt.authorizationId)
      || ![
        'SIGNED_TEST',
        'ENTRY',
        'ENTRY_CANCEL',
        'QUERY_ORDER',
        'QUERY_FILLS',
        'FLATTEN',
        'FLATTEN_CANCEL',
      ].includes(action.receipt.action)
      || action.operation !== operationForAction(action.receipt.action)
      || typeof action.receipt.ticketId !== 'string'
      || !/^spt_[0-9a-f]{32}$/u.test(action.receipt.ticketId)
      || typeof action.receipt.termsDigest !== 'string'
      || !/^[0-9a-f]{32}$/u.test(action.receipt.termsDigest)
      || typeof action.receipt.clientOrderId !== 'string'
      || !CLIENT_ORDER_ID.test(action.receipt.clientOrderId)
      || typeof action.receipt.intentDigest !== 'string'
      || !STATE_DIGEST.test(action.receipt.intentDigest)
      || !Number.isSafeInteger(action.receipt.stateRevision)
      || action.receipt.stateRevision < 0
      || action.receipt.nextStateRevision
        !== action.receipt.stateRevision + 1
      || action.receipt.nextStateRevision > state.revision
      || typeof action.receipt.clockFenceId !== 'string'
      || !/^m0_clock_fence_[A-Za-z0-9_.:-]{16,160}$/u
        .test(action.receipt.clockFenceId)
      || !Number.isSafeInteger(action.receipt.consumedAtMs)
      || action.receipt.consumedAtMs < 0
      || !Number.isSafeInteger(action.receipt.consumedMonotonicMs)
      || action.receipt.consumedMonotonicMs < 0
      || action.receipt.state !== 'CONSUMED_ONCE'
      || action.receipt.authorizationReuseAllowed !== false
      || rows.findIndex((candidate) =>
        candidate?.receipt?.authorizationId
          === action.receipt.authorizationId
      ) !== index
      || typeof action.dispatchClaimed !== 'boolean'
      || !Number.isSafeInteger(action.authorityExpiresAtMs)
      || action.authorityExpiresAtMs < action.receipt.consumedAtMs
      || !Number.isSafeInteger(action.authorityExpiresMonotonicMs)
      || action.authorityExpiresMonotonicMs
        < action.receipt.consumedMonotonicMs
      || (
        action.dispatchClaimed
        && (
          action.dispatchClaimedAtMs === null
          || action.dispatchClaimedMonotonicMs === null
          || action.requestDigest === null
          || !validDispatchLease(action.dispatchLease)
          || action.dispatchPermitDigest === null
          || action.dispatchDeadlineAtMs === null
          || action.dispatchDeadlineMonotonicMs === null
          || action.requestTimeoutMs !== DISPATCH_REQUEST_TIMEOUT_MS
          || action.recvWindowMs !== DISPATCH_RECV_WINDOW_MS
          || action.acceptanceSettlesAtMs === null
          || action.acceptanceSettlesMonotonicMs === null
          || !Number.isSafeInteger(action.dispatchClaimedAtMs)
          || action.dispatchClaimedAtMs < action.receipt.consumedAtMs
          || action.dispatchClaimedAtMs >= action.authorityExpiresAtMs
          || !Number.isSafeInteger(action.dispatchClaimedMonotonicMs)
          || action.dispatchClaimedMonotonicMs
            < action.dispatchLease.acquiredMonotonicMs
          || action.dispatchClaimedAtMs < action.dispatchLease.acquiredAtMs
          || (
            action.receipt.clockFenceId
              === action.dispatchLease.clockFenceId
              ? (
                  action.dispatchClaimedMonotonicMs
                    < action.receipt.consumedMonotonicMs
                  || action.dispatchClaimedMonotonicMs
                    >= action.authorityExpiresMonotonicMs
                )
              : (
                  action.dispatchLease.mode !== 'RECOVERY_ONLY'
                  || action.dispatchLease.acquiredAtMs
                    < action.receipt.consumedAtMs
                  || rebasedWallDeadlineMonotonic(
                    action.dispatchLease,
                    action.authorityExpiresAtMs,
                  ) === null
                  || action.dispatchClaimedMonotonicMs
                    >= rebasedWallDeadlineMonotonic(
                      action.dispatchLease,
                      action.authorityExpiresAtMs,
                    )!
                )
          )
          || !STATE_DIGEST.test(action.dispatchPermitDigest)
          || action.dispatchPermitDigest
            !== expectedPersistedDispatchPermitDigest(state, action)
          || !Number.isSafeInteger(action.dispatchDeadlineAtMs)
          || action.dispatchDeadlineAtMs <= action.dispatchClaimedAtMs
          || action.dispatchDeadlineAtMs
            > action.dispatchClaimedAtMs + DISPATCH_PERMIT_LIFETIME_MS
          || action.dispatchDeadlineAtMs > action.authorityExpiresAtMs
          || !Number.isSafeInteger(action.dispatchDeadlineMonotonicMs)
          || action.dispatchDeadlineMonotonicMs
            <= action.dispatchClaimedMonotonicMs
          || action.dispatchDeadlineMonotonicMs
            > action.dispatchClaimedMonotonicMs
              + DISPATCH_PERMIT_LIFETIME_MS
          || (
            action.receipt.clockFenceId
              === action.dispatchLease.clockFenceId
            && action.dispatchDeadlineMonotonicMs
              > action.authorityExpiresMonotonicMs
          )
          || !Number.isSafeInteger(action.acceptanceSettlesAtMs)
          || action.acceptanceSettlesAtMs
            !== action.dispatchDeadlineAtMs + DISPATCH_ACCEPTANCE_WINDOW_MS
          || !Number.isSafeInteger(
            action.acceptanceSettlesMonotonicMs,
          )
          || action.acceptanceSettlesMonotonicMs
            !== action.dispatchDeadlineMonotonicMs
              + DISPATCH_ACCEPTANCE_WINDOW_MS
        )
      )
      || (
        !action.dispatchClaimed
        && (
          action.dispatchClaimedAtMs !== null
          || action.dispatchClaimedMonotonicMs !== null
          || action.requestDigest !== null
          || action.dispatchLease !== null
          || action.dispatchPermitDigest !== null
          || action.dispatchDeadlineAtMs !== null
          || action.dispatchDeadlineMonotonicMs !== null
          || action.requestTimeoutMs !== null
          || action.recvWindowMs !== null
          || action.acceptanceSettlesAtMs !== null
          || action.acceptanceSettlesMonotonicMs !== null
        )
      )
      || (
        action.egressSpentAtMs === null
          ? (
              action.egressSpentMonotonicMs !== null
              || action.egressConfirmedAtMs !== null
              || action.egressConfirmedMonotonicMs !== null
              || action.egressConfirmation !== null
            )
          : (
              !action.dispatchClaimed
              || action.dispatchClaimedAtMs === null
              || action.dispatchClaimedMonotonicMs === null
              || action.dispatchDeadlineAtMs === null
              || action.dispatchDeadlineMonotonicMs === null
              || action.acceptanceSettlesAtMs === null
              || action.acceptanceSettlesMonotonicMs === null
              || !Number.isSafeInteger(action.egressSpentAtMs)
              || action.egressSpentAtMs < action.dispatchClaimedAtMs
              || action.egressSpentAtMs >= action.dispatchDeadlineAtMs
              || !Number.isSafeInteger(action.egressSpentMonotonicMs)
              || action.egressSpentMonotonicMs!
                < action.dispatchClaimedMonotonicMs
              || action.egressSpentMonotonicMs!
                >= action.dispatchDeadlineMonotonicMs
              || (
                action.egressConfirmation === null
                  ? (
                      action.egressConfirmedAtMs !== null
                      || action.egressConfirmedMonotonicMs !== null
                    )
                  : (
                      (
                        action.egressConfirmation !== 'RESPONSE_RECEIVED'
                        && action.egressConfirmation !== 'AMBIGUOUS'
                      )
                      || !Number.isSafeInteger(action.egressConfirmedAtMs)
                      || action.egressConfirmedAtMs!
                        < action.egressSpentAtMs
                      || action.egressConfirmedAtMs!
                        > action.acceptanceSettlesAtMs
                      || !Number.isSafeInteger(
                        action.egressConfirmedMonotonicMs,
                      )
                      || action.egressConfirmedMonotonicMs!
                        < action.egressSpentMonotonicMs!
                      || action.egressConfirmedMonotonicMs!
                        > action.acceptanceSettlesMonotonicMs
                    )
              )
            )
      )
      || (
        action.requestDigest !== null
        && !STATE_DIGEST.test(action.requestDigest)
      )
      || ![
        'NONE',
        'unknown',
        'accepted',
        'accepted_reconciled',
        'not_sent',
        'not_sent_rejected',
        'not_sent_reconciled',
      ].includes(action.outcome)
      || (
        action.outcome !== 'NONE'
        && !action.dispatchClaimed
        && !(
          action.outcome === 'not_sent_reconciled'
          && (
            action.receipt.action === 'ENTRY'
            || action.receipt.action === 'FLATTEN'
          )
        )
      )
    ))
    || state.ledgerAppends.some((append) =>
      typeof append.dedupeKey !== 'string'
      || append.dedupeKey.length < 1
      || append.dedupeKey.length > 512
      || !STATE_DIGEST.test(append.intentDigest)
    )
    || state.fills.some((fill, index, rows) => {
      try {
        const withoutDigest = Object.freeze({
          leg: fill.leg,
          fillId: fill.fillId,
          venueOrderId: fill.venueOrderId,
          price: fill.price,
          quantity: fill.quantity,
          quoteQuantity: fill.quoteQuantity,
          commission: fill.commission,
          commissionAsset: fill.commissionAsset,
          occurredAtMs: fill.occurredAtMs,
        });
        return (
          (fill.leg !== 'ENTRY' && fill.leg !== 'FLATTEN')
          || !/^[0-9]+$/u.test(fill.fillId)
          || !/^[0-9]+$/u.test(fill.venueOrderId)
          || normalizeSpotDecimal(fill.price, 'M0 fill price')
            !== fill.price
          || normalizeSpotDecimal(fill.quantity, 'M0 fill quantity')
            !== fill.quantity
          || normalizeSpotDecimal(
            fill.quoteQuantity,
            'M0 fill quote quantity',
          ) !== fill.quoteQuantity
          || fill.quoteQuantity
            !== multiplySpotDecimals(fill.price, fill.quantity)
          || normalizeSpotDecimal(fill.commission, 'M0 fill commission')
            !== fill.commission
          || !/^[A-Z0-9]{1,16}$/u.test(fill.commissionAsset)
          || !Number.isSafeInteger(fill.occurredAtMs)
          || fill.occurredAtMs < 0
          || fill.fillDigest !== sha256('m0-spot-fill', withoutDigest)
          || rows.findIndex((candidate) =>
            candidate.fillId === fill.fillId,
          ) !== index
        );
      } catch {
        return true;
      }
    })
    || state.stateDigest !== stateDigest(withoutStateDigest(state))
    || (
      state.entry !== null
      && (
        state.entry.ticket.ticketId !== state.entryTicket.ticketId
        || state.entry.ticket.termsDigest !== state.entryTicket.termsDigest
        || state.entry.ticket.clientOrderId
          !== state.entryTicket.clientOrderId
      )
    )
    || (
      state.flatten !== null
      && (
        state.flattenTicket === null
        || state.flatten.ticket.ticketId !== state.flattenTicket.ticketId
        || state.flatten.ticket.termsDigest
          !== state.flattenTicket.termsDigest
        || state.flatten.ticket.clientOrderId
          !== state.flattenTicket.clientOrderId
      )
    )
    || state.flattenHistory.some((leg, index, rows) => (
      rows.findIndex((candidate) =>
        candidate.ticket.ticketId === leg.ticket.ticketId
      ) !== index
      || leg.ticket.ticketId === state.flatten?.ticket.ticketId
    ))
    || !persistedOrderGraphExact(state)
    || (
      state.reconciliation !== null
      && (
        state.phase !== 'DISARMED_SAFE'
        || state.reconciliation.baseAsset !== state.card.baseAsset
        || state.reconciliation.baselineRevision
          !== state.readinessCard.baseline.baselineRevision
        || state.reconciliation.baselineBaseQuantity
          !== state.readinessCard.baseline.baselineBaseQuantity
        || state.reconciliation.exchangeBaseTolerance
          !== state.readinessCard.baseline.exchangeBaseTolerance
        || state.reconciliation.quoteAsset !== state.card.quoteAsset
        || state.reconciliation.quoteAsset
          !== state.readinessCard.baseline.quoteAsset
        || state.reconciliation.baselineQuoteQuantity
          !== state.readinessCard.baseline.baselineQuoteQuantity
        || state.reconciliation.quoteQuantityTolerance
          !== state.readinessCard.baseline.quoteQuantityTolerance
        || state.reconciliation.residualQuantity
          !== state.residualQuantity
        || state.reconciliation.flattenAttemptCount
          !== orderedFlattenLegs(state).length
      )
    )
    || (
      (
        state.phase === 'DISARMED_SAFE'
        || state.phase === 'DISARMED_NO_EXPOSURE'
      )
      && (
        state.lifecycleLock !== 'RELEASED'
        || state.newEntryArmed
        || (
          state.phase === 'DISARMED_SAFE'
          && (
            state.reconciliation === null
            || persistedFlatAccounting(state) === null
          )
        )
        || (
          state.phase === 'DISARMED_NO_EXPOSURE'
          && (
            state.reconciliation !== null
            || state.residualQuantity !== '0'
            || state.entry !== null
            || state.flatten !== null
            || state.flattenHistory.length !== 0
            || state.fills.length !== 0
          )
        )
      )
    )
    || (
      state.phase !== 'DISARMED_SAFE'
      && state.phase !== 'DISARMED_NO_EXPOSURE'
      && state.lifecycleLock !== 'HELD'
    )
  ) throw new Error('M0_SPOT_LIFECYCLE_STATE_CORRUPT');
  normalizeSpotDecimal(state.residualQuantity, 'M0 residual quantity');
  return deepFreezeData(state);
}

function audit(
  state: Readonly<M0SpotLifecycleState>,
  next: Readonly<M0SpotLifecycleState>,
  transition: string,
  action: M0SpotEgressAction | null,
  authorizationId: string | null,
  intentDigest: string | null,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schema: M0_SPOT_LIFECYCLE_AUDIT_SCHEMA,
    version: 2,
    lifecycleId: next.lifecycleId,
    cardDigest: next.card.cardDigest,
    readinessDigest: next.readinessCard.readinessDigest,
    previousRevision: state.revision,
    nextRevision: next.revision,
    transition,
    action,
    authorizationId,
    intentDigest,
    previousStateDigest: state.stateDigest,
    nextStateDigest: next.stateDigest,
    executionAuthority: 'NONE',
    externalActionAuthorization: 'NONE',
  });
}

function initialAudit(
  next: Readonly<M0SpotLifecycleState>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schema: M0_SPOT_LIFECYCLE_AUDIT_SCHEMA,
    version: 2,
    lifecycleId: next.lifecycleId,
    cardDigest: next.card.cardDigest,
    previousRevision: null,
    nextRevision: next.revision,
    transition: 'ARMED',
    action: null,
    authorizationId: null,
    intentDigest: null,
    previousStateDigest: null,
    nextStateDigest: next.stateDigest,
    executionAuthority: 'NONE',
    externalActionAuthorization: 'NONE',
  });
}

function event(
  kind: string,
  symbol: string,
  data: unknown,
): Readonly<LedgerEventInputRecord> {
  return Object.freeze({ kind, symbol, data });
}

function attemptRecord(
  ticket: Readonly<SpotExecutionTicket>,
  action: M0SpotEgressAction,
  nowMs: number,
): Readonly<LedgerEventInputRecord> | null {
  const attemptKind = action === 'ENTRY'
    ? 'ORDER'
    : action === 'FLATTEN'
      ? 'FLATTEN'
      : action === 'ENTRY_CANCEL' || action === 'FLATTEN_CANCEL'
        ? 'CANCEL'
        : null;
  if (attemptKind === null) return null;
  const intent = buildSpotLedgerAppendIntent({
    eventKind: 'ATTEMPT',
    eventRevision: `m0-${action.toLowerCase()}-${ticket.ticketId}`,
    symbol: ticket.symbol,
    correlation: Object.freeze({
      ticketId: ticket.ticketId,
      clientOrderId: ticket.clientOrderId,
      orderId: null,
      fillId: null,
      cancelId:
        attemptKind === 'CANCEL' ? `cancel-${ticket.ticketId}` : null,
      flattenId: attemptKind === 'FLATTEN' ? ticket.ticketId : null,
      attemptKind,
    }),
    ...(attemptKind === 'CANCEL'
      ? {}
      : {
          side: ticket.side,
          baseQuantity: ticket.quantity,
          quoteQuantity: ticket.orderNotionalQuote,
        }),
    occurredAtMs: nowMs,
    status: 'SUBMITTING',
  }, Object.freeze({ nowMs: () => nowMs }));
  return Object.freeze({
    kind: intent.kind,
    symbol: intent.symbol,
    data: intent.data,
  });
}

function reservationId(
  lifecycleId: string,
  action: M0SpotEgressAction,
  ticketId: string,
  intentDigest: string,
): string {
  return createHash('sha256')
    .update(
      `m0-spot-reservation|${lifecycleId}|${action}|${ticketId}|${intentDigest}`,
      'utf8',
    )
    .digest('hex')
    .slice(0, 32);
}

function orderRequestRecord(
  state: Readonly<M0SpotLifecycleState>,
  action: M0SpotEgressAction,
  ticket: Readonly<SpotExecutionTicket>,
  authority: Readonly<M0SpotActionAuthority>,
  intentDigest: string,
): Readonly<LedgerEventInputRecord> | null {
  if (action !== 'ENTRY' && action !== 'FLATTEN') return null;
  if (!CLIENT_ORDER_ID.test(ticket.clientOrderId)) {
    throw new TypeError('M0 client order identity is not Ledger compatible');
  }
  const exact = normalizeSpotDecimal(
    ticket.orderNotionalQuote,
    'M0 order notional',
  );
  const compatibleNumber = Number(exact);
  if (!Number.isFinite(compatibleNumber) || compatibleNumber <= 0) {
    throw new TypeError('M0 order notional is not Ledger compatible');
  }
  return event('order_request', ticket.symbol, Object.freeze({
    schema: 'cosmos.system-integration.m0-spot-order-request.v1',
    lifecycleId: state.lifecycleId,
    cardDigest: state.card.cardDigest,
    action,
    authorizationId: authority.authorizationId,
    intentDigest,
    reservationId: reservationId(
      state.lifecycleId,
      action,
      ticket.ticketId,
      intentDigest,
    ),
    params: Object.freeze({
      newClientOrderId: ticket.clientOrderId,
      symbol: ticket.symbol,
      side: ticket.side,
      type: ticket.type,
      timeInForce: ticket.timeInForce,
      quantity: ticket.quantity,
      price: ticket.price,
    }),
    reservedNotionalUsd: compatibleNumber,
    reservedNotionalQuoteExact: exact,
    moneyEncoding: 'EXACT_DECIMAL',
    automaticRetry: false,
  }));
}

function operationForAction(action: M0SpotEgressAction): BinanceSpotExecutionOperation {
  switch (action) {
    case 'SIGNED_TEST': return 'SIGNED_TEST';
    case 'ENTRY': return 'SUBMIT';
    case 'ENTRY_CANCEL':
    case 'FLATTEN_CANCEL': return 'CANCEL';
    case 'QUERY_ORDER': return 'QUERY_ORDER';
    case 'QUERY_FILLS': return 'QUERY_FILLS';
    case 'FLATTEN': return 'FLATTEN';
  }
}

function actionAllowed(
  state: Readonly<M0SpotLifecycleState>,
  action: M0SpotEgressAction,
): boolean {
  if (terminalPhase(state.phase)) return false;
  const count = state.actions.filter((row) =>
    row.receipt.action === action,
  ).length;
  if (action === 'SIGNED_TEST') {
    return state.phase === 'ARMED'
      && count < state.card.maximumSignedTestSubmissions;
  }
  if (action === 'ENTRY') {
    return state.phase === 'ARMED'
      && state.newEntryArmed
      && count < state.card.maximumEntrySubmissions;
  }
  if (action === 'ENTRY_CANCEL') {
    return state.entry !== null
      && !state.entry.terminal
      && count < state.card.maximumEntryCancelSubmissions;
  }
  if (action === 'FLATTEN') {
    return state.entry !== null
      && state.entry.terminal
      && state.entry.fillsComplete
      && (
        state.flatten === null
        || (state.flatten.terminal && state.flatten.fillsComplete)
      )
      && compareSpotDecimals(state.residualQuantity, '0') > 0
      && count < state.card.maximumFlattenSubmissions;
  }
  if (action === 'FLATTEN_CANCEL') {
    return orderedFlattenLegs(state).some((leg) => !leg.terminal)
      && count < state.card.maximumFlattenCancelSubmissions;
  }
  return state.entry !== null && count < 24;
}

function actionMatchesDurableLeg(
  state: Readonly<M0SpotLifecycleState>,
  action: Readonly<M0SpotPersistedAction>,
): boolean {
  const exactLeg = (
    leg: Readonly<M0SpotOrderLegState> | null,
    requireActive: boolean,
  ): boolean => (
    leg !== null
    && leg.ticket.ticketId === action.receipt.ticketId
    && leg.ticket.termsDigest === action.receipt.termsDigest
    && leg.ticket.clientOrderId === action.receipt.clientOrderId
    && (!requireActive || !leg.terminal)
  );
  switch (action.receipt.action) {
    case 'SIGNED_TEST':
      return state.phase === 'ARMED';
    case 'ENTRY':
    case 'ENTRY_CANCEL':
      return exactLeg(state.entry, true);
    case 'FLATTEN':
      return exactLeg(state.flatten, true);
    case 'FLATTEN_CANCEL':
      return orderedFlattenLegs(state).some((leg) =>
        exactLeg(leg, true),
      );
    case 'QUERY_ORDER':
    case 'QUERY_FILLS':
      return exactLeg(state.entry, false)
        || orderedFlattenLegs(state).some((leg) =>
          exactLeg(leg, false),
        );
  }
}

function requestMatchesDurableAction(
  state: Readonly<M0SpotLifecycleState>,
  action: Readonly<M0SpotPersistedAction>,
  request: Readonly<BinanceSpotSignedTransportRequest>,
): boolean {
  try {
    if (
      !Array.isArray(request.parameters)
      || request.parameters.some((pair) =>
        !Array.isArray(pair)
        || pair.length !== 2
        || typeof pair[0] !== 'string'
        || typeof pair[1] !== 'string'
      )
    ) return false;
    const parameters = new Map(request.parameters);
    if (parameters.size !== request.parameters.length) return false;
    const exact = (keys: readonly string[]): boolean =>
      parameters.size === keys.length
      && keys.every((key) => parameters.has(key));
    const allTickets = [
      state.entryTicket,
      ...orderedFlattenLegs(state).map((leg) => leg.ticket),
    ];
    const ticket = allTickets.find((candidate) =>
      candidate.ticketId === action.receipt.ticketId
      && candidate.termsDigest === action.receipt.termsDigest
      && candidate.clientOrderId === action.receipt.clientOrderId,
    );
    if (ticket === undefined) return false;
    if (
      request.operation === 'SIGNED_TEST'
      || request.operation === 'SUBMIT'
      || request.operation === 'FLATTEN'
    ) {
      return (
        exact([
          'symbol',
          'side',
          'type',
          'quantity',
          'newClientOrderId',
          'newOrderRespType',
          'timeInForce',
          'price',
        ])
        && request.contractId === (
          request.operation === 'SIGNED_TEST'
            ? 'SPOT_TEST_ORDER_POST'
            : 'SPOT_ORDER_POST'
        )
        && request.method === 'POST'
        && request.path === (
          request.operation === 'SIGNED_TEST'
            ? '/api/v3/order/test'
            : '/api/v3/order'
        )
        && parameters.get('symbol') === ticket.symbol
        && parameters.get('side') === ticket.side
        && parameters.get('type') === 'LIMIT'
        && parameters.get('quantity') === ticket.quantity
        && parameters.get('newClientOrderId') === ticket.clientOrderId
        && parameters.get('newOrderRespType') === 'RESULT'
        && parameters.get('timeInForce') === 'FOK'
        && parameters.get('price') === ticket.price
      );
    }
    if (
      request.operation === 'QUERY_ORDER'
      || request.operation === 'CANCEL'
    ) {
      return (
        exact(['symbol', 'origClientOrderId'])
        && request.contractId === (
          request.operation === 'QUERY_ORDER'
            ? 'SPOT_ORDER_QUERY'
            : 'SPOT_ORDER_CANCEL'
        )
        && request.method === (
          request.operation === 'QUERY_ORDER' ? 'GET' : 'DELETE'
        )
        && request.path === '/api/v3/order'
        && parameters.get('symbol') === ticket.symbol
        && parameters.get('origClientOrderId') === ticket.clientOrderId
      );
    }
    const leg =
      state.entry?.ticket.ticketId === ticket.ticketId
        ? state.entry
        : orderedFlattenLegs(state).find((candidate) =>
            candidate.ticket.ticketId === ticket.ticketId,
          );
    return request.operation === 'QUERY_FILLS'
      && exact(['symbol', 'orderId'])
      && request.contractId === 'SPOT_MY_TRADES_QUERY'
      && request.method === 'GET'
      && request.path === '/api/v3/myTrades'
      && parameters.get('symbol') === ticket.symbol
      && leg?.venueOrderId !== null
      && leg?.venueOrderId !== undefined
      && parameters.get('orderId') === leg.venueOrderId;
  } catch {
    return false;
  }
}

function canonicalReadRequest(
  operation: 'QUERY_ORDER' | 'QUERY_FILLS',
  ticket: Readonly<SpotExecutionTicket>,
  venueOrderId: string | null,
): Readonly<{
  intent: Readonly<
    SpotQueryByClientOrderIdIntent | SpotQueryFillsIntent
  >;
  request: Readonly<BinanceSpotSignedTransportRequest>;
}> {
  const intent = operation === 'QUERY_ORDER'
    ? Object.freeze({
        kind: 'QUERY_BY_ORIGINAL_CLIENT_ORDER_ID' as const,
        ticketId: ticket.ticketId,
        symbol: ticket.symbol,
        originalClientOrderId: ticket.clientOrderId,
        readOnly: true as const,
      })
    : Object.freeze({
        kind: 'QUERY_FILLS' as const,
        ticketId: ticket.ticketId,
        symbol: ticket.symbol,
        originalClientOrderId: ticket.clientOrderId,
        venueOrderId,
        readOnly: true as const,
      });
  if (operation === 'QUERY_FILLS' && venueOrderId === null) {
    throw new TypeError('QUERY_FILLS requires an exact venue order ID');
  }
  const request: Readonly<BinanceSpotSignedTransportRequest> = Object.freeze({
    schema: BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
    operation,
    credentialProfile: 'USER_DATA_READ' as const,
    contractId:
      operation === 'QUERY_ORDER'
        ? 'SPOT_ORDER_QUERY' as const
        : 'SPOT_MY_TRADES_QUERY' as const,
    method: 'GET' as const,
    path:
      operation === 'QUERY_ORDER'
        ? '/api/v3/order' as const
        : '/api/v3/myTrades' as const,
    parameters: operation === 'QUERY_ORDER'
      ? Object.freeze([
          Object.freeze(['symbol', ticket.symbol] as const),
          Object.freeze([
            'origClientOrderId',
            ticket.clientOrderId,
          ] as const),
        ])
      : Object.freeze([
          Object.freeze(['symbol', ticket.symbol] as const),
          Object.freeze(['orderId', venueOrderId!] as const),
        ]),
    automaticRetry: false as const,
    transportCallsAuthorized: 1 as const,
    externalActionAuthorization:
      'DURABLE_DISPATCH_PERMIT_REQUIRED' as const,
  });
  return Object.freeze({ intent, request });
}

function exactCurrentReadResponseAction(
  state: Readonly<M0SpotLifecycleState>,
  authorizationId: string,
  operation: 'QUERY_ORDER' | 'QUERY_FILLS',
  ticket: Readonly<SpotExecutionTicket>,
  venueOrderId: string | null,
  currentClockFenceId: string,
): Readonly<{
  index: number;
  action: Readonly<M0SpotPersistedAction>;
}> | null {
  try {
    if (
      state.execution === null
      || state.execution.status !== 'ACTIVE'
      || state.execution.clockFenceId !== currentClockFenceId
      || reconstructCanonicalSpotExecutionTicket(ticket) === null
    ) return null;
    const matches = state.actions
      .map((action, index) => Object.freeze({ action, index }))
      .filter(({ action }) =>
        action.receipt.authorizationId === authorizationId,
      );
    if (matches.length !== 1) return null;
    const match = matches[0]!;
    const action = match.action;
    const expected = canonicalReadRequest(
      operation,
      ticket,
      venueOrderId,
    );
    if (
      action.receipt.action !== operation
      || action.operation !== operation
      || action.receipt.ticketId !== ticket.ticketId
      || action.receipt.termsDigest !== ticket.termsDigest
      || action.receipt.clientOrderId !== ticket.clientOrderId
      || action.receipt.intentDigest
        !== calculateM0SpotIntentDigest(expected.intent)
      || action.requestDigest
        !== calculateBinanceSpotDispatchRequestDigest(expected.request)
      || !requestMatchesDurableAction(state, action, expected.request)
      || !actionMatchesDurableLeg(state, action)
      || !action.dispatchClaimed
      || action.dispatchLease === null
      || action.dispatchLease.requestId !== state.execution.requestId
      || action.dispatchLease.idempotencyKeyDigest
        !== state.execution.idempotencyKeyDigest
      || action.dispatchLease.clockFenceId !== currentClockFenceId
      || action.dispatchLease.executorId !== state.execution.executorId
      || action.dispatchLease.hostId !== state.execution.hostId
      || action.dispatchLease.bootId !== state.execution.bootId
      || action.dispatchLease.processId !== state.execution.processId
      || action.dispatchLease.revision !== state.execution.revision
      || action.dispatchPermitDigest === null
      || action.dispatchPermitDigest
        !== expectedPersistedDispatchPermitDigest(state, action)
      || action.egressSpentAtMs === null
      || action.egressSpentMonotonicMs === null
      || action.egressConfirmedAtMs === null
      || action.egressConfirmedMonotonicMs === null
      || action.egressConfirmation !== 'RESPONSE_RECEIVED'
      || action.outcome !== 'NONE'
    ) return null;
    return match;
  } catch {
    return null;
  }
}

function nextPhaseForAction(
  state: Readonly<M0SpotLifecycleState>,
  action: M0SpotEgressAction,
): M0SpotLifecyclePhase {
  if (action === 'ENTRY') return 'ENTRY_RESERVED';
  if (action === 'FLATTEN') return 'FLATTEN_RESERVED';
  if (
    action === 'ENTRY_CANCEL'
    || action === 'FLATTEN_CANCEL'
  ) return 'RECOVERY_REQUIRED';
  return state.phase;
}

function orderLeg(
  state: Readonly<M0SpotLifecycleState>,
  action: M0SpotEgressAction,
  ticket: Readonly<SpotExecutionTicket>,
  intentDigest: string,
): Readonly<M0SpotOrderLegState> | null {
  if (action !== 'ENTRY' && action !== 'FLATTEN') return null;
  return Object.freeze({
    ticket,
    reservationId: reservationId(
      state.lifecycleId,
      action,
      ticket.ticketId,
      intentDigest,
    ),
    venueOrderId: null,
    venueStatus: null,
    terminal: false,
    fillsComplete: false,
    cumulativeFilledQuantity: '0',
    notFoundFirstObservedAtMs: null,
    notFoundFirstObservedMonotonicMs: null,
    notFoundFirstObservedClockFenceId: null,
    notFoundObservationCount: 0,
    notFoundEvidenceRevisions: Object.freeze([]),
    notFoundQueryAuthorizationIds: Object.freeze([]),
  });
}

function sumLegQuantities(
  legs: readonly Readonly<M0SpotOrderLegState>[],
): string {
  return legs.reduce(
    (sum, leg) => addSpotDecimals(sum, leg.cumulativeFilledQuantity),
    '0',
  );
}

function attributableBaseResidual(
  state: Readonly<M0SpotLifecycleState>,
  entry: Readonly<M0SpotOrderLegState> | null,
  flatten: Readonly<M0SpotOrderLegState> | null,
): string {
  const sourceGross = entry?.cumulativeFilledQuantity ?? '0';
  const flattenedGross = sumLegQuantities([
    ...state.flattenHistory,
    ...(flatten === null ? [] : [flatten]),
  ]);
  const sourceBaseCommission = state.fills
    .filter((fill) =>
      fill.leg === 'ENTRY' && fill.commissionAsset === state.card.baseAsset,
    )
    .reduce((sum, fill) => addSpotDecimals(sum, fill.commission), '0');
  const flattenBaseCommission = state.fills
    .filter((fill) =>
      fill.leg === 'FLATTEN' && fill.commissionAsset === state.card.baseAsset,
    )
    .reduce((sum, fill) => addSpotDecimals(sum, fill.commission), '0');
  return subtractSpotDecimals(
    subtractSpotDecimals(
      subtractSpotDecimals(sourceGross, sourceBaseCommission),
      flattenedGross,
    ),
    flattenBaseCommission,
  );
}

function absoluteSpotDifference(left: string, right: string): string {
  return compareSpotDecimals(left, right) >= 0
    ? subtractSpotDecimals(left, right)
    : subtractSpotDecimals(right, left);
}

function persistedFillObservation(
  fill: Readonly<M0SpotPersistedFill>,
): Readonly<SpotFillObservation> {
  return Object.freeze({
    fillId: fill.fillId,
    venueOrderId: fill.venueOrderId,
    price: fill.price,
    quantity: fill.quantity,
    quoteQuantity: fill.quoteQuantity,
    commission: fill.commission,
    commissionAsset: fill.commissionAsset,
    occurredAtMs: fill.occurredAtMs,
  });
}

function persistedFillQuantity(
  rows: readonly Readonly<M0SpotPersistedFill>[],
): string {
  return rows.reduce(
    (sum, fill) => addSpotDecimals(sum, fill.quantity),
    '0',
  );
}

function persistedFillQuote(
  rows: readonly Readonly<M0SpotPersistedFill>[],
): string {
  return rows.reduce(
    (sum, fill) => addSpotDecimals(sum, fill.quoteQuantity),
    '0',
  );
}

function orderedFlattenLegs(
  state: Readonly<M0SpotLifecycleState>,
): readonly Readonly<M0SpotOrderLegState>[] {
  return Object.freeze([
    ...state.flattenHistory,
    ...(state.flatten === null ? [] : [state.flatten]),
  ]);
}

function exactLegMutationAction(
  state: Readonly<M0SpotLifecycleState>,
  action: 'ENTRY' | 'FLATTEN',
  leg: Readonly<M0SpotOrderLegState>,
): Readonly<M0SpotPersistedAction> | null {
  const rows = state.actions.filter((row) =>
    row.receipt.action === action
    && row.receipt.ticketId === leg.ticket.ticketId
    && row.receipt.termsDigest === leg.ticket.termsDigest
    && row.receipt.clientOrderId === leg.ticket.clientOrderId,
  );
  return rows.length === 1 ? rows[0]! : null;
}

function legFillSetExact(
  leg: Readonly<M0SpotOrderLegState>,
  rows: readonly Readonly<M0SpotPersistedFill>[],
): boolean {
  const absent = leg.venueStatus === 'AUTHORITATIVE_NOT_FOUND';
  if (
    leg.fillsComplete && !leg.terminal
    || (
      leg.venueOrderId === null
      && rows.length !== 0
    )
    || (
      leg.venueOrderId !== null
      && rows.some((fill) =>
        fill.venueOrderId !== leg.venueOrderId
        || fill.occurredAtMs < leg.ticket.createdAtMs
        || compareSpotDecimals(fill.price, '0') <= 0
        || compareSpotDecimals(fill.quantity, '0') <= 0,
      )
    )
    || (
      absent
      && (
        leg.venueOrderId !== null
        || !leg.terminal
        || !leg.fillsComplete
        || leg.cumulativeFilledQuantity !== '0'
        || rows.length !== 0
        || leg.notFoundObservationCount < 2
      )
    )
  ) return false;
  const fillQuantity = persistedFillQuantity(rows);
  if (
    compareSpotDecimals(
      fillQuantity,
      leg.cumulativeFilledQuantity,
    ) > 0
    || (
      leg.fillsComplete
      && fillQuantity !== leg.cumulativeFilledQuantity
    )
    || (
      leg.terminal
      && leg.fillsComplete
      && leg.cumulativeFilledQuantity !== '0'
      && leg.cumulativeFilledQuantity !== leg.ticket.quantity
    )
    || (
      leg.terminal
      && leg.fillsComplete
      && leg.cumulativeFilledQuantity !== '0'
      && leg.venueStatus !== 'FILLED'
    )
    || (
      leg.terminal
      && leg.fillsComplete
      && leg.venueStatus === 'FILLED'
      && leg.cumulativeFilledQuantity !== leg.ticket.quantity
    )
  ) return false;
  return true;
}

/**
 * Closed persisted graph check used on every restart read. It intentionally
 * permits an in-progress leg whose final fills have not yet been fetched, but
 * rejects orphan fills, reordered attempts, partial FOK terminals, and any
 * ticket/action identity drift.
 */
function persistedOrderGraphExact(
  state: Readonly<M0SpotLifecycleState>,
): boolean {
  try {
    if (
      state.entryTicket.purpose !== 'ENTRY'
      || state.entryTicket.side !== 'BUY'
      || state.entryTicket.type !== 'LIMIT'
      || state.entryTicket.timeInForce !== 'FOK'
      || state.entryTicket.symbol !== state.card.symbol
      || state.entryTicket.accountId !== state.card.accountId
      || (
        state.entry === null
        && (
          state.flatten !== null
          || state.flattenHistory.length !== 0
          || state.flattenTicket !== null
          || state.fills.length !== 0
        )
      )
      || (state.flatten === null) !== (state.flattenTicket === null)
      || (
        state.flatten === null
        && state.flattenHistory.length !== 0
      )
    ) return false;

    const attempts = orderedFlattenLegs(state);
    if (
      attempts.length > state.card.maximumFlattenSubmissions
      || state.actions.filter((row) =>
        row.receipt.action === 'ENTRY',
      ).length !== (state.entry === null ? 0 : 1)
      || state.actions.filter((row) =>
        row.receipt.action === 'FLATTEN',
      ).length !== attempts.length
    ) return false;

    const globalFillIds = new Set<string>();
    for (const fill of state.fills) {
      if (globalFillIds.has(fill.fillId)) return false;
      globalFillIds.add(fill.fillId);
    }

    if (state.entry !== null) {
      const entry = state.entry;
      const entryAction = exactLegMutationAction(state, 'ENTRY', entry);
      const sourceRows = state.fills.filter((fill) =>
        fill.leg === 'ENTRY',
      );
      if (
        entryAction === null
        || entry.ticket.ticketId !== state.entryTicket.ticketId
        || entry.ticket.termsDigest !== state.entryTicket.termsDigest
        || entry.ticket.clientOrderId
          !== state.entryTicket.clientOrderId
        || sourceRows.some((fill) =>
          entry.venueOrderId === null
          || fill.venueOrderId !== entry.venueOrderId,
        )
        || !legFillSetExact(entry, sourceRows)
      ) return false;
    }

    const seenTicketIds = new Set<string>([
      state.entryTicket.ticketId,
    ]);
    const seenClientOrderIds = new Set<string>([
      state.entryTicket.clientOrderId,
    ]);
    const seenVenueOrderIds = new Set<string>(
      state.entry?.venueOrderId === null
      || state.entry?.venueOrderId === undefined
        ? []
        : [state.entry.venueOrderId],
    );
    for (let index = 0; index < attempts.length; index += 1) {
      const leg = attempts[index]!;
      const expectedAttempt = index + 1;
      const action = exactLegMutationAction(state, 'FLATTEN', leg);
      const rows = state.fills.filter((fill) =>
        fill.leg === 'FLATTEN'
        && leg.venueOrderId !== null
        && fill.venueOrderId === leg.venueOrderId,
      );
      if (
        action === null
        || leg.ticket.purpose !== 'FLATTEN'
        || leg.ticket.side !== 'SELL'
        || leg.ticket.type !== 'LIMIT'
        || leg.ticket.timeInForce !== 'FOK'
        || leg.ticket.attempt !== expectedAttempt
        || leg.ticket.symbol !== state.entryTicket.symbol
        || leg.ticket.accountId !== state.entryTicket.accountId
        || leg.ticket.planId !== state.entryTicket.planId
        || leg.ticket.correlationId !== state.entryTicket.correlationId
        || seenTicketIds.has(leg.ticket.ticketId)
        || seenClientOrderIds.has(leg.ticket.clientOrderId)
        || (
          leg.venueOrderId !== null
          && seenVenueOrderIds.has(leg.venueOrderId)
        )
        || !legFillSetExact(leg, rows)
      ) return false;
      seenTicketIds.add(leg.ticket.ticketId);
      seenClientOrderIds.add(leg.ticket.clientOrderId);
      if (leg.venueOrderId !== null) {
        seenVenueOrderIds.add(leg.venueOrderId);
      }
    }
    if (
      state.fills.some((fill) =>
        fill.leg === 'FLATTEN'
        && !seenVenueOrderIds.has(fill.venueOrderId),
      )
    ) return false;

    const allLegsComplete =
      state.entry !== null
      && state.entry.terminal
      && state.entry.fillsComplete
      && attempts.every((leg) => leg.terminal && leg.fillsComplete);
    if (
      allLegsComplete
      && attributableBaseResidual(
        state,
        state.entry,
        state.flatten,
      ) !== state.residualQuantity
    ) return false;
    return true;
  } catch {
    return false;
  }
}

interface PersistedFlatAccounting {
  readonly sourceAuthoritativelyAbsent: boolean;
  readonly sourceFills: readonly Readonly<M0SpotPersistedFill>[];
  readonly flattenFills: readonly Readonly<M0SpotPersistedFill>[];
  readonly attempts: readonly Readonly<M0SpotOrderLegState>[];
  readonly absentFlattenClientOrderIds: readonly string[];
  readonly sourceGrossFilledBaseQuantity: string;
  readonly sourceBaseCommissionQuantity: string;
  readonly sourceAttributableBaseQuantity: string;
  readonly cumulativeFilledSellQuantity: string;
  readonly flattenBaseCommissionQuantity: string;
  readonly residualQuantity: string;
  readonly residualDustNotionalQuote: string;
  readonly quoteAccounting: Readonly<SpotQuoteAccounting>;
}

function exactCompletedMutationOutcome(
  state: Readonly<M0SpotLifecycleState>,
  action: 'ENTRY' | 'FLATTEN',
  leg: Readonly<M0SpotOrderLegState>,
  authoritativelyAbsent: boolean,
): boolean {
  const row = exactLegMutationAction(state, action, leg);
  return row !== null
    && (
      authoritativelyAbsent
        ? (
            row.outcome === 'not_sent_reconciled'
            && (
              (
                row.dispatchClaimed
                && row.requestDigest !== null
              )
              || (
                !row.dispatchClaimed
                && row.requestDigest === null
              )
            )
          )
        : (
            row.dispatchClaimed
            && row.requestDigest !== null
            && row.outcome === 'accepted_reconciled'
          )
    );
}

function dispatchAcceptanceSettled(
  action: Readonly<M0SpotPersistedAction>,
  execution: Readonly<M0SpotExecutionLease> | null,
  nowMs: number,
  monotonicMs: number,
  currentClockFenceId: string,
): boolean {
  if (!action.dispatchClaimed) return true;
  if (
    action.dispatchLease === null
    || action.acceptanceSettlesAtMs === null
    || action.acceptanceSettlesMonotonicMs === null
    || !Number.isSafeInteger(nowMs)
    || !Number.isSafeInteger(monotonicMs)
    || nowMs <= action.acceptanceSettlesAtMs
  ) return false;
  if (action.dispatchLease.clockFenceId === currentClockFenceId) {
    return monotonicMs > action.acceptanceSettlesMonotonicMs;
  }
  if (
    execution === null
    || execution.status !== 'ACTIVE'
    || execution.clockFenceId !== currentClockFenceId
    || execution.mode !== 'RECOVERY_ONLY'
    || execution.acquiredAtMs
      < (action.dispatchClaimedAtMs ?? Number.MAX_SAFE_INTEGER)
  ) return false;
  const wallRemainingAtTakeover = Math.max(
    0,
    action.acceptanceSettlesAtMs - execution.acquiredAtMs,
  );
  const conservativeRemainingMs = Math.max(
    DISPATCH_ACCEPTANCE_WINDOW_MS,
    wallRemainingAtTakeover,
  );
  const takeoverAcceptanceDeadlineMonotonicMs =
    execution.acquiredMonotonicMs + conservativeRemainingMs;
  return Number.isSafeInteger(takeoverAcceptanceDeadlineMonotonicMs)
    && monotonicMs > takeoverAcceptanceDeadlineMonotonicMs;
}

/**
 * Independently reconstruct the complete source/flatten accounting from only
 * the durable ticket, order and fill graph. The coordinator's prior
 * validation is deliberately not trusted at this boundary.
 */
function persistedFlatAccounting(
  state: Readonly<M0SpotLifecycleState>,
): Readonly<PersistedFlatAccounting> | null {
  try {
    if (
      !persistedOrderGraphExact(state)
      || state.entry === null
      || !state.entry.terminal
      || !state.entry.fillsComplete
    ) return null;
    const entry = state.entry;
    const attempts = orderedFlattenLegs(state);
    if (attempts.some((leg) => !leg.terminal || !leg.fillsComplete)) {
      return null;
    }
    const sourceAuthoritativelyAbsent =
      entry.venueOrderId === null
      && entry.venueStatus === 'AUTHORITATIVE_NOT_FOUND';
    if (
      (entry.venueOrderId === null) !== sourceAuthoritativelyAbsent
      || !exactCompletedMutationOutcome(
        state,
        'ENTRY',
        entry,
        sourceAuthoritativelyAbsent,
      )
      || (
        sourceAuthoritativelyAbsent
        && attempts.length !== 0
      )
    ) return null;

    const sourceFills = Object.freeze(state.fills.filter((fill) =>
      fill.leg === 'ENTRY',
    ));
    const flattenFills = Object.freeze(state.fills.filter((fill) =>
      fill.leg === 'FLATTEN',
    ));

    if (sourceAuthoritativelyAbsent) {
      if (
        sourceFills.length !== 0
        || flattenFills.length !== 0
        || entry.cumulativeFilledQuantity !== '0'
        || state.residualQuantity !== '0'
      ) return null;
      return Object.freeze({
        sourceAuthoritativelyAbsent: true,
        sourceFills,
        flattenFills,
        attempts,
        absentFlattenClientOrderIds: Object.freeze([]),
        sourceGrossFilledBaseQuantity: '0',
        sourceBaseCommissionQuantity: '0',
        sourceAttributableBaseQuantity: '0',
        cumulativeFilledSellQuantity: '0',
        flattenBaseCommissionQuantity: '0',
        residualQuantity: '0',
        residualDustNotionalQuote: '0',
        quoteAccounting: deriveSpotQuoteAccounting({
          sourceTicket: state.entryTicket,
          sourceVenueOrderId: null,
          sourceFills: Object.freeze([]),
          flattenAttempts: Object.freeze([]),
          baseAsset: state.card.baseAsset,
          quoteAsset: state.card.quoteAsset,
        }),
      });
    }

    const sourceVenueOrderId = entry.venueOrderId;
    const quantityStepSize = state.readinessCard.filters.stepSize;
    const exchangeBaseTolerance =
      state.readinessCard.baseline.exchangeBaseTolerance;
    const maximumResidualDustNotionalQuote =
      state.readinessCard.limits.maximumResidualDustNotionalQuote;
    const maximumGrossLifecycleTurnoverQuote =
      state.readinessCard.limits.maximumGrossLifecycleTurnoverQuote;
    const totalFeeReserveQuote =
      state.readinessCard.economics.totalFeeReserveQuote;
    if (
      sourceVenueOrderId === null
      || quantityStepSize === null
      || exchangeBaseTolerance === null
      || maximumGrossLifecycleTurnoverQuote === null
      || totalFeeReserveQuote === null
      || state.entryTicket.price === null
      || maximumResidualDustNotionalQuote
        !== state.card.maximumResidualDustNotionalQuote
      || maximumGrossLifecycleTurnoverQuote
        !== state.card.maximumGrossLifecycleTurnoverQuote
    ) return null;

    const sourceObservations = Object.freeze(
      sourceFills.map(persistedFillObservation),
    );
    const priorAttempts: Readonly<SpotFlattenAttemptFillSet>[] = [];
    const absentFlattenClientOrderIds: string[] = [];
    for (let index = 0; index < attempts.length; index += 1) {
      const leg = attempts[index]!;
      const authoritativelyAbsent =
        leg.venueOrderId === null
        && leg.venueStatus === 'AUTHORITATIVE_NOT_FOUND';
      if (
        (leg.venueOrderId === null) !== authoritativelyAbsent
        || !exactCompletedMutationOutcome(
          state,
          'FLATTEN',
          leg,
          authoritativelyAbsent,
        )
        || leg.ticket.price === null
      ) return null;
      const attemptFills = Object.freeze(
        flattenFills
          .filter((fill) =>
            leg.venueOrderId !== null
            && fill.venueOrderId === leg.venueOrderId,
          )
          .map(persistedFillObservation),
      );
      const derived = deriveFlattenLeg({
        sourceTicket: state.entryTicket,
        sourceVenueOrderId,
        sourceFills: sourceObservations,
        previousFlattenAttempts: Object.freeze([...priorAttempts]),
        baseAsset: state.card.baseAsset,
        exchangeBaseTolerance,
        maximumResidualDustNotionalQuote,
        maximumGrossLifecycleTurnoverQuote,
        totalFeeReserveQuote,
        quantityStepSize,
        attempt: index + 1,
        price: leg.ticket.price,
        riskReferencePrice: leg.ticket.riskReferencePrice,
        estimatedMaxLossQuote: leg.ticket.estimatedMaxLossQuote,
        createdAtMs: leg.ticket.createdAtMs,
        expiresAtMs: leg.ticket.expiresAtMs,
      });
      if (
        derived.ticket === null
        || canonicalJson(derived.ticket) !== canonicalJson(leg.ticket)
      ) return null;
      const prior: Readonly<SpotFlattenAttemptFillSet> = Object.freeze({
        ticket: leg.ticket,
        venueOrderId: leg.venueOrderId,
        authoritativelyAbsent,
        fills: attemptFills,
      });
      priorAttempts.push(prior);
      if (authoritativelyAbsent) {
        absentFlattenClientOrderIds.push(leg.ticket.clientOrderId);
      }
    }

    const finalReferenceTicket =
      attempts.at(-1)?.ticket ?? state.entryTicket;
    if (finalReferenceTicket.price === null) return null;
    const finalDerivation: Readonly<DerivedFlattenLeg> = deriveFlattenLeg({
      sourceTicket: state.entryTicket,
      sourceVenueOrderId,
      sourceFills: sourceObservations,
      previousFlattenAttempts: Object.freeze([...priorAttempts]),
      baseAsset: state.card.baseAsset,
      exchangeBaseTolerance,
      maximumResidualDustNotionalQuote,
      maximumGrossLifecycleTurnoverQuote,
      totalFeeReserveQuote,
      quantityStepSize,
      attempt: Math.min(
        state.card.maximumFlattenSubmissions,
        attempts.length + 1,
      ),
      price: finalReferenceTicket.price,
      riskReferencePrice: finalReferenceTicket.riskReferencePrice,
      estimatedMaxLossQuote: finalReferenceTicket.estimatedMaxLossQuote,
      createdAtMs: finalReferenceTicket.createdAtMs,
      expiresAtMs: finalReferenceTicket.expiresAtMs,
    });
    if (
      finalDerivation.ticket !== null
      || finalDerivation.remainingAttributableBaseQuantity
        !== state.residualQuantity
      || finalDerivation.sourceGrossFilledBaseQuantity
        !== entry.cumulativeFilledQuantity
      || finalDerivation.cumulativeFilledSellQuantity
        !== sumLegQuantities(attempts)
      || finalDerivation.observedGrossLifecycleTurnoverQuote
        !== addSpotDecimals(
          persistedFillQuote(sourceFills),
          persistedFillQuote(flattenFills),
        )
    ) return null;
    const quoteAttempts = Object.freeze(
      attempts.map((leg, index) => Object.freeze({
        attempt: index + 1,
        ticket: leg.ticket,
        venueOrderId: leg.venueOrderId,
        authoritativelyAbsent:
          leg.venueOrderId === null
          && leg.venueStatus === 'AUTHORITATIVE_NOT_FOUND',
        terminal: true as const,
        fillsComplete: true as const,
        fills: Object.freeze(
          flattenFills
            .filter((fill) =>
              leg.venueOrderId !== null
              && fill.venueOrderId === leg.venueOrderId,
            )
            .map(persistedFillObservation),
        ),
      })),
    );
    const quoteAccounting = deriveSpotQuoteAccounting({
      sourceTicket: state.entryTicket,
      sourceVenueOrderId,
      sourceFills: sourceObservations,
      flattenAttempts: quoteAttempts,
      baseAsset: state.card.baseAsset,
      quoteAsset: state.card.quoteAsset,
    });
    if (
      quoteAccounting.observedGrossLifecycleTurnoverQuote
        !== finalDerivation.observedGrossLifecycleTurnoverQuote
      || quoteAccounting.authorizedFilledLifecycleTurnoverQuote
        !== finalDerivation.authorizedFilledLifecycleTurnoverQuote
      || quoteAccounting.favorableSellPriceImprovementQuote
        !== finalDerivation.favorableSellPriceImprovementQuote
    ) return null;
    return Object.freeze({
      sourceAuthoritativelyAbsent: false,
      sourceFills,
      flattenFills,
      attempts,
      absentFlattenClientOrderIds:
        Object.freeze(absentFlattenClientOrderIds),
      sourceGrossFilledBaseQuantity:
        finalDerivation.sourceGrossFilledBaseQuantity,
      sourceBaseCommissionQuantity:
        finalDerivation.sourceBaseCommissionQuantity,
      sourceAttributableBaseQuantity:
        finalDerivation.attributableBaseQuantity,
      cumulativeFilledSellQuantity:
        finalDerivation.cumulativeFilledSellQuantity,
      flattenBaseCommissionQuantity:
        finalDerivation.flattenBaseCommissionQuantity,
      residualQuantity:
        finalDerivation.remainingAttributableBaseQuantity,
      residualDustNotionalQuote:
        finalDerivation.residualDustNotionalQuote,
      quoteAccounting,
    });
  } catch {
    return null;
  }
}

function exactNextFlattenTicket(
  state: Readonly<M0SpotLifecycleState>,
  candidate: Readonly<SpotExecutionTicket>,
): boolean {
  try {
    if (
      !persistedOrderGraphExact(state)
      || state.entry === null
      || state.entry.venueOrderId === null
      || !state.entry.terminal
      || !state.entry.fillsComplete
      || !exactCompletedMutationOutcome(
        state,
        'ENTRY',
        state.entry,
        false,
      )
    ) return false;
    const attempts = orderedFlattenLegs(state);
    const quantityStepSize = state.readinessCard.filters.stepSize;
    const exchangeBaseTolerance =
      state.readinessCard.baseline.exchangeBaseTolerance;
    const maximumGrossLifecycleTurnoverQuote =
      state.readinessCard.limits.maximumGrossLifecycleTurnoverQuote;
    const maximumResidualDustNotionalQuote =
      state.readinessCard.limits.maximumResidualDustNotionalQuote;
    const totalFeeReserveQuote =
      state.readinessCard.economics.totalFeeReserveQuote;
    if (
      quantityStepSize === null
      || exchangeBaseTolerance === null
      || maximumGrossLifecycleTurnoverQuote === null
      || totalFeeReserveQuote === null
      || attempts.length >= state.card.maximumFlattenSubmissions
      || candidate.price === null
      || candidate.attempt !== attempts.length + 1
    ) return false;
    const sourceFills = Object.freeze(
      state.fills
        .filter((fill) => fill.leg === 'ENTRY')
        .map(persistedFillObservation),
    );
    const allFlattenFills = state.fills.filter((fill) =>
      fill.leg === 'FLATTEN',
    );
    const priorAttempts: Readonly<SpotFlattenAttemptFillSet>[] = [];
    for (let index = 0; index < attempts.length; index += 1) {
      const leg = attempts[index]!;
      const authoritativelyAbsent =
        leg.venueOrderId === null
        && leg.venueStatus === 'AUTHORITATIVE_NOT_FOUND';
      if (
        !leg.terminal
        || !leg.fillsComplete
        || (leg.venueOrderId === null) !== authoritativelyAbsent
        || !exactCompletedMutationOutcome(
          state,
          'FLATTEN',
          leg,
          authoritativelyAbsent,
        )
        || leg.ticket.price === null
      ) return false;
      const fills = Object.freeze(
        allFlattenFills
          .filter((fill) =>
            leg.venueOrderId !== null
            && fill.venueOrderId === leg.venueOrderId,
          )
          .map(persistedFillObservation),
      );
      const derived = deriveFlattenLeg({
        sourceTicket: state.entryTicket,
        sourceVenueOrderId: state.entry.venueOrderId,
        sourceFills,
        previousFlattenAttempts: Object.freeze([...priorAttempts]),
        baseAsset: state.card.baseAsset,
        exchangeBaseTolerance,
        maximumResidualDustNotionalQuote,
        maximumGrossLifecycleTurnoverQuote,
        totalFeeReserveQuote,
        quantityStepSize,
        attempt: index + 1,
        price: leg.ticket.price,
        riskReferencePrice: leg.ticket.riskReferencePrice,
        estimatedMaxLossQuote: leg.ticket.estimatedMaxLossQuote,
        createdAtMs: leg.ticket.createdAtMs,
        expiresAtMs: leg.ticket.expiresAtMs,
      });
      if (
        derived.ticket === null
        || canonicalJson(derived.ticket) !== canonicalJson(leg.ticket)
      ) return false;
      priorAttempts.push(Object.freeze({
        ticket: leg.ticket,
        venueOrderId: leg.venueOrderId,
        authoritativelyAbsent,
        fills,
      }));
    }
    const derived = deriveFlattenLeg({
      sourceTicket: state.entryTicket,
      sourceVenueOrderId: state.entry.venueOrderId,
      sourceFills,
      previousFlattenAttempts: Object.freeze([...priorAttempts]),
      baseAsset: state.card.baseAsset,
      exchangeBaseTolerance,
      maximumResidualDustNotionalQuote,
      maximumGrossLifecycleTurnoverQuote,
      totalFeeReserveQuote,
      quantityStepSize,
      attempt: attempts.length + 1,
      price: candidate.price,
      riskReferencePrice: candidate.riskReferencePrice,
      estimatedMaxLossQuote: candidate.estimatedMaxLossQuote,
      createdAtMs: candidate.createdAtMs,
      expiresAtMs: candidate.expiresAtMs,
    });
    return derived.ticket !== null
      && canonicalJson(derived.ticket) === canonicalJson(candidate);
  } catch {
    return false;
  }
}

function committed(
  result: LedgerConfigCompareAndSetResult,
): result is Extract<LedgerConfigCompareAndSetResult, { committed: true }> {
  return result.committed;
}

export class M0SpotLifecyclePersistenceAdapter
implements BinanceSpotDispatchAuthorityPort, BinanceSpotEgressSpendPort {
  readonly #ledger: Readonly<M0SpotLifecycleLedgerPort>;
  readonly #clock: Readonly<M0SpotLifecycleClock>;
  readonly #resolveAction: Readonly<M0SpotLifecycleActionResolver>;

  constructor(options: Readonly<M0SpotLifecyclePersistenceOptions>) {
    if (
      typeof options?.ledger?.getConfigValue !== 'function'
      || typeof options.ledger.compareAndSetConfigValueAndLogEvents
        !== 'function'
      || typeof options.ledger.insertFill !== 'function'
      || typeof options.ledger.readDurableMutationAuthority !== 'function'
      || typeof options?.clock?.nowMs !== 'function'
      || typeof options.clock.monotonicMs !== 'function'
      || typeof options.clock.clockFenceId !== 'function'
      || typeof options?.resolveAction?.resolve !== 'function'
    ) throw new TypeError('M0 Spot lifecycle persistence ports are required');
    this.#ledger = options.ledger;
    this.#clock = options.clock;
    this.#resolveAction = options.resolveAction;
  }

  read(): Readonly<M0SpotLifecycleState> | null {
    return parseState(this.#ledger.getConfigValue(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
    ));
  }

  acquireExecution(input: Readonly<{
    requestId: `m0_req_${string}`;
    idempotencyKeyDigest: `sha256:${string}`;
    operatorId: string;
    executorId: string;
    hostId: string;
    bootId: string;
    processId: string;
    revision: string;
    mode: 'ENTRY' | 'RECOVERY_ONLY';
  }>): M0SpotExecutionLeaseResult {
    if (
      !/^m0_req_[0-9a-f]{32}$/u.test(input.requestId)
      || !STATE_DIGEST.test(input.idempotencyKeyDigest)
      || typeof input.operatorId !== 'string'
      || input.operatorId.length < 1
      || input.operatorId.length > 160
      || input.operatorId !== input.operatorId.trim()
      || typeof input.executorId !== 'string'
      || input.executorId.length < 1
      || input.executorId.length > 160
      || typeof input.hostId !== 'string'
      || input.hostId.length < 1
      || input.hostId.length > 160
      || typeof input.bootId !== 'string'
      || input.bootId.length < 1
      || input.bootId.length > 160
      || typeof input.processId !== 'string'
      || input.processId.length < 1
      || input.processId.length > 160
      || !/^[0-9a-f]{40}$/u.test(input.revision)
      || (input.mode !== 'ENTRY' && input.mode !== 'RECOVERY_ONLY')
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_EXECUTION_IDENTITY_INVALID',
        state: null,
      });
    }
    const raw = this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
    const state = parseState(raw);
    if (
      state === null
      || (
        terminalPhase(state.phase)
        && !(
          state.phase === 'DISARMED_SAFE'
          && input.mode === 'RECOVERY_ONLY'
        )
      )
      || input.operatorId !== state.card.ownerId
      || input.executorId !== state.readinessCard.namedExecutor.executorId
      || input.hostId !== state.readinessCard.namedExecutor.hostId
      || input.hostId !== state.readinessCard.revisionHost.hostId
      || input.revision !== state.readinessCard.revisionHost.revision
      || (
        input.mode === 'ENTRY'
        && (
          state.entry !== null
          || state.phase !== 'ARMED'
          || !state.newEntryArmed
          || input.bootId !== state.readinessCard.namedExecutor.bootId
          || input.processId !== state.readinessCard.namedExecutor.processId
        )
      )
      || (
        input.mode === 'RECOVERY_ONLY'
        && state.entry === null
        && state.actions.some((action) =>
          action.receipt.action === 'ENTRY'
          || action.receipt.action === 'FLATTEN',
        )
      )
      || state.phase === 'DISARMED_NO_EXPOSURE'
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_EXECUTION_NOT_AVAILABLE',
        state,
      });
    }
    const fence = this.#clock.clockFenceId();
    if (
      state.execution?.status === 'ACTIVE'
      && state.execution.clockFenceId === fence
    ) {
      return Object.freeze({
        disposition: 'IN_FLIGHT' as const,
        code:
          state.execution.idempotencyKeyDigest
            === input.idempotencyKeyDigest
            ? 'M0_EXECUTION_IDEMPOTENT_IN_FLIGHT'
            : 'M0_EXECUTION_BUSY',
        state,
      });
    }
    const nowMs = this.#clock.nowMs();
    const monotonicMs = this.#clock.monotonicMs();
    if (
      !Number.isSafeInteger(nowMs)
      || nowMs < 0
      || !Number.isSafeInteger(monotonicMs)
      || monotonicMs < 0
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_EXECUTION_CLOCK_INVALID',
        state,
      });
    }
    const continuingRecoveryTakeover =
      input.mode === 'RECOVERY_ONLY'
      && state.execution?.status === 'PARKED'
      && state.execution.mode === 'RECOVERY_ONLY'
      && state.execution.clockFenceId === fence;
    if (
      continuingRecoveryTakeover
      && (
        nowMs < state.execution!.acquiredAtMs
        || monotonicMs < state.execution!.acquiredMonotonicMs
      )
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_EXECUTION_CLOCK_INVALID',
        state,
      });
    }
    const recovery =
      state.execution !== null
      || state.entry !== null
      || state.phase !== 'ARMED';
    const reopeningSafeTombstone =
      state.phase === 'DISARMED_SAFE'
      && input.mode === 'RECOVERY_ONLY';
    const execution: Readonly<M0SpotExecutionLease> = Object.freeze({
      status: 'ACTIVE' as const,
      mode: input.mode,
      requestId: input.requestId,
      idempotencyKeyDigest: input.idempotencyKeyDigest,
      operatorId: input.operatorId,
      executorId: input.executorId,
      hostId: input.hostId,
      bootId: input.bootId,
      processId: input.processId,
      revision: input.revision,
      clockFenceId: fence,
      acquiredAtMs: continuingRecoveryTakeover
        ? state.execution!.acquiredAtMs
        : nowMs,
      acquiredMonotonicMs: continuingRecoveryTakeover
        ? state.execution!.acquiredMonotonicMs
        : monotonicMs,
    });
    const next = frozenState({
      ...withoutStateDigest(state),
      revision: state.revision + 1,
      execution,
      phase:
        recovery && state.entry !== null
          ? 'RECOVERY_REQUIRED'
          : state.phase,
      lifecycleLock: reopeningSafeTombstone
        ? 'HELD' as const
        : state.lifecycleLock,
      newEntryArmed: reopeningSafeTombstone
        ? false
        : state.newEntryArmed,
      reconciliation: reopeningSafeTombstone
        ? null
        : state.reconciliation,
      lastTransitionAtMs: nowMs,
      previousStateDigest: state.stateDigest,
    });
    const cas = this.#ledger.compareAndSetConfigValueAndLogEvents(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
      raw,
      serializeState(next),
      [event(
        'system_integration.m0_spot.execution_acquired',
        state.card.symbol,
        Object.freeze({
          ...audit(
            state,
            next,
            recovery ? 'RECOVERY_EXECUTION_ACQUIRED' : 'EXECUTION_ACQUIRED',
            null,
            null,
            null,
          ),
          requestId: input.requestId,
          idempotencyKeyDigest: input.idempotencyKeyDigest,
          clockFenceId: fence,
        }),
      )],
    );
    return committed(cas)
      ? Object.freeze({
          disposition: 'ACQUIRED' as const,
          recovery,
          state: next,
        })
      : Object.freeze({
          disposition: 'CONFLICT' as const,
          code: cas.reason,
          state: parseState(cas.currentValue),
        });
  }

  parkExecution(requestId: string): M0SpotLifecycleMutationResult {
    const raw = this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
    const state = parseState(raw);
    const fence = this.#clock.clockFenceId();
    if (
      state === null
      || state.execution === null
      || state.execution.status !== 'ACTIVE'
      || state.execution.requestId !== requestId
      || state.execution.clockFenceId !== fence
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_EXECUTION_LEASE_NOT_OWNED',
        state,
      });
    }
    const nowMs = this.#clock.nowMs();
    const next = frozenState({
      ...withoutStateDigest(state),
      revision: state.revision + 1,
      execution: Object.freeze({
        ...state.execution,
        status: 'PARKED' as const,
      }),
      lastTransitionAtMs: nowMs,
      previousStateDigest: state.stateDigest,
    });
    const cas = this.#ledger.compareAndSetConfigValueAndLogEvents(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
      raw,
      serializeState(next),
      [event(
        'system_integration.m0_spot.execution_parked',
        state.card.symbol,
        audit(
          state,
          next,
          'EXECUTION_PARKED',
          null,
          null,
          null,
        ),
      )],
    );
    return committed(cas)
      ? Object.freeze({
          disposition: 'COMMITTED_NEW' as const,
          state: next,
        })
      : Object.freeze({
          disposition: 'CONFLICT' as const,
          code: cas.reason,
          state: parseState(cas.currentValue),
        });
  }

  disarmBeforeEntry(reasonCode: string): M0SpotLifecycleMutationResult {
    const raw = this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
    const state = parseState(raw);
    const mutationTruth = this.#ledger.readDurableMutationAuthority();
    if (
      state === null
      || terminalPhase(state.phase)
      || !ownsExecution(state, this.#clock.clockFenceId())
      || state.entry !== null
      || state.flatten !== null
      || state.flattenHistory.length !== 0
      || state.fills.length !== 0
      || state.actions.some((action) =>
        action.receipt.action === 'ENTRY'
        || action.receipt.action === 'FLATTEN'
        || action.receipt.action === 'ENTRY_CANCEL'
        || action.receipt.action === 'FLATTEN_CANCEL',
      )
      || mutationTruth.posture !== 'PROVEN_ABSENT'
      || mutationTruth.unresolvedOrderCount !== 0
      || mutationTruth.malformedOrderRowCount !== 0
      || mutationTruth.readErrorCount !== 0
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_NO_EXPOSURE_DISARM_NOT_PROVED',
        state,
      });
    }
    const nowMs = this.#clock.nowMs();
    const next = frozenState({
      ...withoutStateDigest(state),
      revision: state.revision + 1,
      phase: 'DISARMED_NO_EXPOSURE',
      lifecycleLock: 'RELEASED',
      newEntryArmed: false,
      lastTransitionAtMs: nowMs,
      previousStateDigest: state.stateDigest,
    });
    const cas = this.#ledger.compareAndSetConfigValueAndLogEvents(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
      raw,
      serializeState(next),
      [event(
        'system_integration.m0_spot.lifecycle_disarmed_no_exposure',
        state.card.symbol,
        Object.freeze({
          ...audit(
            state,
            next,
            'DISARMED_NO_EXPOSURE',
            null,
            null,
            null,
          ),
          reasonCode: reasonCode.slice(0, 160),
          entryReserved: false,
          moneyMutationPossible: false,
        }),
      )],
    );
    return committed(cas)
      ? Object.freeze({
          disposition: 'COMMITTED_NEW' as const,
          state: next,
        })
      : Object.freeze({
          disposition: 'CONFLICT' as const,
          code: cas.reason,
          state: parseState(cas.currentValue),
        });
  }

  armLifecycle(
    cardValue: unknown,
    entryTicket: Readonly<SpotExecutionTicket>,
    readinessCard: Readonly<M0SpotReadinessCard>,
  ): M0SpotLifecycleMutationResult {
    const nowMs = this.#clock.nowMs();
    const monotonicMs = this.#clock.monotonicMs();
    const fence = this.#clock.clockFenceId();
    let entryTicketSnapshot: Readonly<SpotExecutionTicket>;
    let readinessSnapshot: Readonly<M0SpotReadinessCard>;
    try {
      entryTicketSnapshot = canonicalTicketSnapshot(entryTicket);
      readinessSnapshot = deepFreezeData(structuredClone(readinessCard));
    } catch {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_ARM_INPUT_SNAPSHOT_INVALID',
        state: null,
      });
    }
    const validated = validateM0SpotLifecycleCard(
      cardValue,
      entryTicketSnapshot,
      nowMs,
      fence,
      monotonicMs,
    );
    if (!validated.ok) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: validated.code,
        state: null,
      });
    }
    const cardSnapshot = deepFreezeData(structuredClone(validated.card));
    let readinessDigest: `sha256:${string}`;
    try {
      const {
        readinessDigest: _readinessDigest,
        ...withoutReadinessDigest
      } = readinessSnapshot;
      readinessDigest = calculateM0SpotReadinessDigest(
        withoutReadinessDigest,
      );
    } catch {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_READINESS_CARD_INVALID',
        state: null,
      });
    }
    if (
      !validateM0SpotReadyCard(
        readinessSnapshot,
        readinessSnapshot.readinessDigest,
        nowMs,
      )
      || readinessSnapshot.readinessDigest !== readinessDigest
      || readinessSnapshot.lifecycleCardDigest !== cardSnapshot.cardDigest
      || readinessSnapshot.gate2Ready !== true
      || readinessSnapshot.disposition !== 'READY_FOR_OWNER_GATE_2'
      || readinessSnapshot.evidenceAuthority !== 'RUNTIME_PRIVATE'
      || readinessSnapshot.clientIdentity.ticketId
        !== entryTicketSnapshot.ticketId
      || readinessSnapshot.clientIdentity.termsDigest
        !== entryTicketSnapshot.termsDigest
      || readinessSnapshot.clientIdentity.entryClientOrderId
        !== entryTicketSnapshot.clientOrderId
      || readinessSnapshot.order.symbol !== cardSnapshot.symbol
      || readinessSnapshot.order.baseAsset !== cardSnapshot.baseAsset
      || readinessSnapshot.order.quoteAmount
        !== cardSnapshot.entryNotionalQuote
      || readinessSnapshot.order.baseQuantity !== entryTicketSnapshot.quantity
      || readinessSnapshot.order.price !== entryTicketSnapshot.price
      || readinessSnapshot.order.timeInForce
        !== entryTicketSnapshot.timeInForce
      || readinessSnapshot.limits.maximumGrossLifecycleTurnoverQuote
        !== cardSnapshot.maximumGrossLifecycleTurnoverQuote
      || readinessSnapshot.limits.maximumResidualDustNotionalQuote
        !== cardSnapshot.maximumResidualDustNotionalQuote
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_READINESS_CARD_BINDING_INVALID',
        state: null,
      });
    }
    const priorRaw = this.#ledger.getConfigValue(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
    );
    if (priorRaw !== null) {
      const prior = parseState(priorRaw);
      return Object.freeze({
        disposition: prior?.card.cardDigest === cardSnapshot.cardDigest
          ? 'REPLAY_QUERY_ONLY' as const
          : 'CONFLICT' as const,
        ...(prior?.card.cardDigest === cardSnapshot.cardDigest
          ? {}
          : { code: 'M0_LIFECYCLE_ALREADY_EXISTS' }),
        state: prior!,
      }) as M0SpotLifecycleMutationResult;
    }
    const next = frozenState({
      schema: M0_SPOT_LIFECYCLE_STATE_SCHEMA,
      version: 2,
      lifecycleId: deriveM0SpotLifecycleId(cardSnapshot.cardDigest),
      revision: 0,
      phase: 'ARMED',
      lifecycleLock: 'HELD',
      newEntryArmed: true,
      execution: null,
      card: cardSnapshot,
      readinessCard: readinessSnapshot,
      entryTicket: entryTicketSnapshot,
      flattenTicket: null,
      actions: Object.freeze([]),
      ledgerAppends: Object.freeze([]),
      fills: Object.freeze([]),
      entry: null,
      flatten: null,
      flattenHistory: Object.freeze([]),
      residualQuantity: '0',
      reconciliation: null,
      lastTransitionAtMs: nowMs,
      previousStateDigest: null,
    });
    const serialized = serializeState(next);
    const cas = this.#ledger.compareAndSetConfigValueAndLogEvents(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
      null,
      serialized,
      [event(
        'system_integration.m0_spot.lifecycle_armed',
        entryTicketSnapshot.symbol,
        initialAudit(next),
      )],
      cardSnapshot.expiresAtMs,
    );
    if (committed(cas)) {
      return Object.freeze({
        disposition: 'COMMITTED_NEW' as const,
        state: next,
      });
    }
    const current = parseState(cas.currentValue);
    return Object.freeze({
      disposition:
        current?.card.cardDigest === cardSnapshot.cardDigest
          ? 'REPLAY_QUERY_ONLY' as const
          : 'CONFLICT' as const,
      ...(current?.card.cardDigest === cardSnapshot.cardDigest
        ? {}
        : { code: cas.reason }),
      state: current!,
    }) as M0SpotLifecycleMutationResult;
  }

  reserveAction(input: Readonly<{
    action: M0SpotEgressAction;
    authority: Readonly<M0SpotActionAuthority>;
    ticket: Readonly<SpotExecutionTicket>;
    intent: unknown;
  }>): M0SpotLifecycleMutationResult {
    const raw = this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
    const state = parseState(raw);
    if (state === null) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_LIFECYCLE_NOT_ARMED',
        state: null,
      });
    }
    const currentClockFenceId = this.#clock.clockFenceId();
    if (
      terminalPhase(state.phase)
      || !ownsExecution(state, currentClockFenceId)
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_EXECUTION_LEASE_REQUIRED',
        state,
      });
    }
    let ticketSnapshot: Readonly<SpotExecutionTicket>;
    try {
      ticketSnapshot = canonicalTicketSnapshot(input.ticket);
    } catch {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_ACTION_TICKET_SNAPSHOT_INVALID',
        state,
      });
    }
    const intentDigest = calculateM0SpotIntentDigest(input.intent);
    if (
      (input.action === 'SIGNED_TEST' || input.action === 'ENTRY')
      && state.execution?.mode !== 'ENTRY'
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_RECOVERY_LEASE_CANNOT_ENTER',
        state,
      });
    }
    const replay = state.actions.find((row) =>
      row.receipt.authorizationId === input.authority.authorizationId,
    );
    if (replay !== undefined) {
      return Object.freeze({
        disposition: replay.receipt.intentDigest === intentDigest
          ? 'REPLAY_QUERY_ONLY' as const
          : 'CONFLICT' as const,
        ...(replay.receipt.intentDigest === intentDigest
          ? {}
          : { code: 'M0_ACTION_IDEMPOTENCY_CONFLICT' }),
        state,
        receipt: replay.receipt,
      }) as M0SpotLifecycleMutationResult;
    }
    if (!actionAllowed(state, input.action)) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_ACTION_NOT_ALLOWED_IN_CURRENT_LIFECYCLE',
        state,
      });
    }
    if (
      input.action === 'FLATTEN_CANCEL'
      && (
        !orderedFlattenLegs(state).some((leg) =>
          !leg.terminal
          && leg.ticket.ticketId === ticketSnapshot.ticketId
          && leg.ticket.termsDigest === ticketSnapshot.termsDigest
          && leg.ticket.clientOrderId === ticketSnapshot.clientOrderId
        )
        || state.actions.some((row) =>
          row.receipt.action === 'FLATTEN_CANCEL'
          && row.receipt.ticketId === ticketSnapshot.ticketId
        )
      )
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_FLATTEN_CANCEL_ATTEMPT_NOT_AVAILABLE',
        state,
      });
    }
    if (
      input.action === 'FLATTEN'
      && !exactNextFlattenTicket(state, ticketSnapshot)
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_FLATTEN_TICKET_NOT_INDEPENDENTLY_DERIVED',
        state,
      });
    }
    const nowMs = this.#clock.nowMs();
    const monotonicMs = this.#clock.monotonicMs();
    const context = Object.freeze({
      lifecycleId: state.lifecycleId,
      stateRevision: state.revision,
      currentClockFenceId,
      recoveryActive:
        input.action !== 'SIGNED_TEST' && input.action !== 'ENTRY',
      residualQuantity:
        input.action === 'FLATTEN' || input.action === 'FLATTEN_CANCEL'
          ? state.residualQuantity
          : null,
      entryTicket: state.entryTicket,
      activeFlattenTicket:
        input.action === 'FLATTEN_CANCEL'
          ? ticketSnapshot
          : state.flatten !== null && !state.flatten.terminal
            ? state.flatten.ticket
            : null,
      exchangeBaseTolerance:
        state.readinessCard.baseline.exchangeBaseTolerance,
      quantityStepSize: state.readinessCard.filters.stepSize,
      maximumResidualDustNotionalQuote:
        state.readinessCard.limits.maximumResidualDustNotionalQuote,
      derivedFlattenTicket:
        input.action === 'FLATTEN' ? ticketSnapshot : null,
    });
    const validated = validateM0SpotActionAuthority(
      input.authority,
      state.card,
      input.action,
      ticketSnapshot,
      input.intent,
      context,
      nowMs,
      monotonicMs,
    );
    if (!validated.ok) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: validated.code,
        state,
      });
    }
    const receipt = Object.freeze({
      schema: M0_SPOT_ACTION_CONSUMPTION_SCHEMA,
      version: 1 as const,
      lifecycleId: state.lifecycleId,
      authorizationId: validated.authority.authorizationId,
      cardId: state.card.cardId,
      cardDigest: state.card.cardDigest,
      action: input.action,
      ticketId: ticketSnapshot.ticketId,
      termsDigest: ticketSnapshot.termsDigest,
      clientOrderId: ticketSnapshot.clientOrderId,
      intentDigest,
      stateRevision: state.revision,
      nextStateRevision: state.revision + 1,
      clockFenceId: context.currentClockFenceId,
      consumedAtMs: nowMs,
      consumedMonotonicMs: monotonicMs,
      state: 'CONSUMED_ONCE' as const,
      authorizationReuseAllowed: false as const,
    });
    const leg = orderLeg(state, input.action, ticketSnapshot, intentDigest);
    const next = frozenState({
      ...withoutStateDigest(state),
      revision: state.revision + 1,
      phase: nextPhaseForAction(state, input.action),
      newEntryArmed:
        input.action === 'ENTRY' ? false : state.newEntryArmed,
      flattenTicket:
        input.action === 'FLATTEN' ? ticketSnapshot : state.flattenTicket,
      actions: Object.freeze([
        ...state.actions,
        Object.freeze({
          receipt,
          operation: operationForAction(input.action),
          requestDigest: null,
          dispatchClaimed: false,
          dispatchClaimedAtMs: null,
          dispatchClaimedMonotonicMs: null,
          dispatchLease: null,
          dispatchPermitDigest: null,
          dispatchDeadlineAtMs: null,
          dispatchDeadlineMonotonicMs: null,
          requestTimeoutMs: null,
          recvWindowMs: null,
          acceptanceSettlesAtMs: null,
          acceptanceSettlesMonotonicMs: null,
          egressSpentAtMs: null,
          egressSpentMonotonicMs: null,
          egressConfirmedAtMs: null,
          egressConfirmedMonotonicMs: null,
          egressConfirmation: null,
          authorityExpiresAtMs: validated.authority.expiresAtMs,
          authorityExpiresMonotonicMs:
            validated.authority.expiresMonotonicMs,
          outcome: 'NONE' as const,
        }),
      ]),
      entry: input.action === 'ENTRY' ? leg : state.entry,
      flatten: input.action === 'FLATTEN' ? leg : state.flatten,
      flattenHistory:
        input.action === 'FLATTEN' && state.flatten !== null
          ? Object.freeze([...state.flattenHistory, state.flatten])
          : state.flattenHistory,
      lastTransitionAtMs: nowMs,
      previousStateDigest: state.stateDigest,
    });
    const records: LedgerEventInputRecord[] = [
      event(
        'system_integration.m0_spot.action_consumed',
        ticketSnapshot.symbol,
        Object.freeze({
          ...audit(
            state,
            next,
            'ACTION_CONSUMED',
            input.action,
            receipt.authorizationId,
            intentDigest,
          ),
          receipt,
        }),
      ),
    ];
    const orderRequest = orderRequestRecord(
      state,
      input.action,
      ticketSnapshot,
      validated.authority,
      intentDigest,
    );
    if (orderRequest !== null) records.push(orderRequest);
    const cas = this.#ledger.compareAndSetConfigValueAndLogEvents(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
      raw,
      serializeState(next),
      Object.freeze(records),
      validated.authority.expiresAtMs,
    );
    if (committed(cas)) {
      return Object.freeze({
        disposition: 'COMMITTED_NEW' as const,
        state: next,
        receipt,
      });
    }
    const current = parseState(cas.currentValue);
    const currentAction = current?.actions.find((row) =>
      row.receipt.authorizationId === receipt.authorizationId,
    );
    if (
      currentAction !== undefined
      && currentAction.receipt.intentDigest === intentDigest
    ) {
      return Object.freeze({
        disposition: 'REPLAY_QUERY_ONLY' as const,
        state: current!,
        receipt: currentAction.receipt,
      });
    }
    return Object.freeze({
      disposition: 'CONFLICT' as const,
      code: cas.reason,
      state: current,
    });
  }

  appendSpotLedgerIntent(
    intent: Readonly<SpotLedgerAppendIntent>,
  ): 'APPENDED' | 'DUPLICATE' | 'CONFLICT' {
    const raw = this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
    const state = parseState(raw);
    if (
      state === null
      || terminalPhase(state.phase)
      || !ownsExecution(state, this.#clock.clockFenceId())
      || intent.symbol !== state.card.symbol
      || typeof intent.dedupeKey !== 'string'
      || intent.dedupeKey.length < 1
      || intent.dedupeKey.length > 512
    ) return 'CONFLICT';
    const intentDigest = sha256('m0-spot-ledger-intent', intent);
    const prior = state.ledgerAppends.find((append) =>
      append.dedupeKey === intent.dedupeKey,
    );
    if (prior !== undefined) {
      return prior.intentDigest === intentDigest
        ? 'DUPLICATE'
        : 'CONFLICT';
    }
    if (state.ledgerAppends.length >= MAX_ACTIONS) return 'CONFLICT';
    const nowMs = this.#clock.nowMs();
    const next = frozenState({
      ...withoutStateDigest(state),
      revision: state.revision + 1,
      ledgerAppends: Object.freeze([
        ...state.ledgerAppends,
        Object.freeze({ dedupeKey: intent.dedupeKey, intentDigest }),
      ]),
      lastTransitionAtMs: nowMs,
      previousStateDigest: state.stateDigest,
    });
    const record = Object.freeze({
      kind: intent.kind,
      symbol: intent.symbol,
      data: intent.data,
      severity: intent.severity,
      source: intent.source,
      strategy: intent.strategy,
      status: intent.status,
      reason: intent.reason,
      message: intent.message,
      correlation: intent.correlation,
      createdAt: intent.createdAt,
    });
    const cas = this.#ledger.compareAndSetConfigValueAndLogEvents(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
      raw,
      serializeState(next),
      [record],
    );
    if (committed(cas)) return 'APPENDED';
    const current = parseState(cas.currentValue);
    const raced = current?.ledgerAppends.find((append) =>
      append.dedupeKey === intent.dedupeKey,
    );
    return raced?.intentDigest === intentDigest
      ? 'DUPLICATE'
      : 'CONFLICT';
  }

  async claimDispatch(
    input: Parameters<BinanceSpotDispatchAuthorityPort['claimDispatch']>[0],
  ): Promise<Readonly<BinanceSpotDispatchPermit> | null> {
    let raw = this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
    let state = parseState(raw);
    const fence = this.#clock.clockFenceId();
    if (
      state === null
      || terminalPhase(state.phase)
      || !ownsExecution(state, fence)
    ) return null;
    const requestDigest = calculateBinanceSpotDispatchRequestDigest(
      input.request,
    );
    const expectedCredentialProfile =
      input.operation === 'QUERY_ORDER'
      || input.operation === 'QUERY_FILLS'
        ? 'USER_DATA_READ'
        : 'SPOT_TRADE_EXECUTION';
    if (
      input.request.operation !== input.operation
      || input.request.credentialProfile !== expectedCredentialProfile
    ) return null;
    const intentDigest = calculateM0SpotIntentDigest(input.intent);
    let action = state.actions.find((row) => (
      row.operation === input.operation
      && row.receipt.ticketId === (
        input.intent.kind === 'FLATTEN'
          ? input.intent.flattenTicket.ticketId
          : input.intent.ticketId
      )
      && row.receipt.clientOrderId === (
        input.intent.kind === 'SIGNED_TEST_ORDER'
        || input.intent.kind === 'SUBMIT_LIVE_ORDER'
          ? input.intent.clientOrderId
          : input.intent.kind === 'FLATTEN'
            ? input.intent.flattenTicket.clientOrderId
            : input.intent.originalClientOrderId
      )
      && !row.dispatchClaimed
      && row.outcome === 'NONE'
      && row.requestDigest === null
      && row.receipt.intentDigest === intentDigest
      && (
        input.action === 'ACTIVE_ORDER_CANCEL'
        || row.receipt.action === input.action
      )
    ));
    if (action === undefined) {
      if (
        input.operation === 'SUBMIT'
        || input.operation === 'FLATTEN'
        || input.operation === 'CANCEL'
      ) return null;
      const resolved = this.#resolveAction.resolve(input, state);
      if (resolved === null) return null;
      const reserved = this.reserveAction({
        action: resolved.action,
        authority: resolved.authority,
        ticket: resolved.ticket,
        intent: input.intent,
      });
      if (
        reserved.disposition !== 'COMMITTED_NEW'
        && reserved.disposition !== 'REPLAY_QUERY_ONLY'
      ) return null;
      raw = this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
      state = parseState(raw);
      action = state?.actions.find((row) =>
        row.receipt.authorizationId
          === reserved.receipt?.authorizationId
        && !row.dispatchClaimed,
      );
    }
    const nowMs = this.#clock.nowMs();
    const monotonicMs = this.#clock.monotonicMs();
    const execution = state?.execution;
    const sameReservationFence =
      action?.receipt.clockFenceId === fence;
    const rebasedAuthorityDeadlineMonotonicMs =
      execution === null || execution === undefined
        ? null
        : rebasedWallDeadlineMonotonic(
            execution,
            action?.authorityExpiresAtMs ?? -1,
          );
    const takeoverClaimAllowed =
      !sameReservationFence
      && execution?.status === 'ACTIVE'
      && execution.mode === 'RECOVERY_ONLY'
      && execution.acquiredAtMs >= (action?.receipt.consumedAtMs ?? Infinity)
      && (
        input.operation === 'QUERY_ORDER'
        || input.operation === 'QUERY_FILLS'
        || input.operation === 'CANCEL'
      )
      && rebasedAuthorityDeadlineMonotonicMs !== null
      && monotonicMs < rebasedAuthorityDeadlineMonotonicMs;
    if (
      state === null
      || terminalPhase(state.phase)
      || action === undefined
      || execution == null
      || execution.status !== 'ACTIVE'
      || action.dispatchClaimed
      || action.outcome !== 'NONE'
      || action.requestDigest !== null
      || !ownsExecution(state, fence)
      || (!sameReservationFence && !takeoverClaimAllowed)
      || !Number.isSafeInteger(nowMs)
      || nowMs < 0
      || !Number.isSafeInteger(monotonicMs)
      || monotonicMs < 0
      || nowMs >= action.authorityExpiresAtMs
      || (
        sameReservationFence
        && monotonicMs >= action.authorityExpiresMonotonicMs
      )
      || !actionMatchesDurableLeg(state, action)
      || !requestMatchesDurableAction(state, action, input.request)
    ) {
      return null;
    }
    const dispatchLease = Object.freeze({
      status: 'ACTIVE' as const,
      mode: execution.mode,
      requestId: execution.requestId,
      idempotencyKeyDigest: execution.idempotencyKeyDigest,
      operatorId: execution.operatorId,
      executorId: execution.executorId,
      hostId: execution.hostId,
      bootId: execution.bootId,
      processId: execution.processId,
      revision: execution.revision,
      clockFenceId: execution.clockFenceId,
      acquiredAtMs: execution.acquiredAtMs,
      acquiredMonotonicMs: execution.acquiredMonotonicMs,
    });
    const authorityDeadlineMonotonicMs = sameReservationFence
      ? action.authorityExpiresMonotonicMs
      : rebasedAuthorityDeadlineMonotonicMs!;
    const dispatchDeadlineAtMs = Math.min(
      action.authorityExpiresAtMs,
      nowMs + DISPATCH_PERMIT_LIFETIME_MS,
    );
    const dispatchDeadlineMonotonicMs = Math.min(
      authorityDeadlineMonotonicMs,
      monotonicMs + DISPATCH_PERMIT_LIFETIME_MS,
    );
    const acceptanceSettlesAtMs =
      dispatchDeadlineAtMs + DISPATCH_ACCEPTANCE_WINDOW_MS;
    const acceptanceSettlesMonotonicMs =
      dispatchDeadlineMonotonicMs + DISPATCH_ACCEPTANCE_WINDOW_MS;
    if (
      !Number.isSafeInteger(dispatchDeadlineAtMs)
      || dispatchDeadlineAtMs <= nowMs
      || !Number.isSafeInteger(dispatchDeadlineMonotonicMs)
      || dispatchDeadlineMonotonicMs <= monotonicMs
      || !Number.isSafeInteger(acceptanceSettlesAtMs)
      || !Number.isSafeInteger(acceptanceSettlesMonotonicMs)
    ) return null;
    const permitWithoutDigest: Readonly<
      Omit<BinanceSpotDispatchPermit, 'permitDigest'>
    > = Object.freeze({
      schema: BINANCE_SPOT_DISPATCH_PERMIT_SCHEMA,
      version: 1 as const,
      operation: action.operation,
      credentialProfile: input.request.credentialProfile,
      action: action.receipt.action,
      lifecycleId: state.lifecycleId,
      cardDigest: state.card.cardDigest,
      ticketId: action.receipt.ticketId,
      termsDigest: action.receipt.termsDigest,
      clientOrderId: action.receipt.clientOrderId,
      requestDigest,
      executionLease: dispatchLease,
      claimedAtMs: nowMs,
      claimedMonotonicMs: monotonicMs,
      dispatchDeadlineAtMs,
      dispatchDeadlineMonotonicMs,
      requestTimeoutMs: DISPATCH_REQUEST_TIMEOUT_MS,
      recvWindowMs: DISPATCH_RECV_WINDOW_MS,
      acceptanceSettlesAtMs,
      acceptanceSettlesMonotonicMs,
      receipt: action.receipt,
      dispatchCardinality: 'ONE' as const,
      automaticRetry: false as const,
      externalActionAuthorization:
        'DURABLE_ONE_USE_ACTION_CONSUMED' as const,
    });
    const permitDigest =
      calculateBinanceSpotDispatchPermitDigest(permitWithoutDigest);
    const actionIndex = state.actions.findIndex((row) =>
      row.receipt.authorizationId === action!.receipt.authorizationId,
    );
    if (actionIndex < 0) return null;
    const actions = state.actions.map((row, index) =>
      index === actionIndex
        ? Object.freeze({
            ...row,
            requestDigest,
            dispatchClaimed: true,
            dispatchClaimedAtMs: nowMs,
            dispatchClaimedMonotonicMs: monotonicMs,
            dispatchLease,
            dispatchPermitDigest: permitDigest,
            dispatchDeadlineAtMs,
            dispatchDeadlineMonotonicMs,
            requestTimeoutMs: DISPATCH_REQUEST_TIMEOUT_MS,
            recvWindowMs: DISPATCH_RECV_WINDOW_MS,
            acceptanceSettlesAtMs,
            acceptanceSettlesMonotonicMs,
          })
        : row,
    );
    const next = frozenState({
      ...withoutStateDigest(state),
      revision: state.revision + 1,
      actions: Object.freeze(actions),
      lastTransitionAtMs: nowMs,
      previousStateDigest: state.stateDigest,
    });
    const cas = this.#ledger.compareAndSetConfigValueAndLogEvents(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
      raw,
      serializeState(next),
      [event(
        'system_integration.m0_spot.dispatch_claimed',
        state.card.symbol,
        audit(
          state,
          next,
          'DISPATCH_CLAIMED',
          action.receipt.action,
          action.receipt.authorizationId,
          action.receipt.intentDigest,
        ),
      )],
      dispatchDeadlineAtMs,
    );
    if (!committed(cas)) return null;
    return Object.freeze({
      ...permitWithoutDigest,
      permitDigest,
    });
  }

  async spend(
    input: Readonly<BinanceSpotEgressSpendRequest>,
  ): Promise<Readonly<BinanceSpotEgressSpendReceipt> | null> {
    const request = snapshotEgressSpendRequest(input);
    if (request === null) return null;
    const raw = this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
    const state = parseState(raw);
    const fence = this.#clock.clockFenceId();
    const nowMs = this.#clock.nowMs();
    const monotonicMs = this.#clock.monotonicMs();
    const actionIndex = state?.actions.findIndex((row) =>
      row.receipt.authorizationId === request.authorizationId,
    ) ?? -1;
    const action = actionIndex < 0
      ? null
      : state!.actions[actionIndex] ?? null;
    if (
      state === null
      || terminalPhase(state.phase)
      || action === null
      || !ownsExecution(state, fence)
      || state.execution?.requestId !== request.executionRequestId
      || request.lifecycleId !== state.lifecycleId
      || !action.dispatchClaimed
      || action.dispatchPermitDigest !== request.permitDigest
      || action.requestDigest !== request.requestDigest
      || action.dispatchLease?.requestId !== request.executionRequestId
      || action.dispatchLease.clockFenceId !== request.clockFenceId
      || action.dispatchDeadlineAtMs !== request.dispatchDeadlineAtMs
      || action.dispatchDeadlineMonotonicMs
        !== request.dispatchDeadlineMonotonicMs
      || request.clockFenceId !== fence
      || action.egressSpentAtMs !== null
      || action.egressSpentMonotonicMs !== null
      || action.egressConfirmedAtMs !== null
      || action.egressConfirmedMonotonicMs !== null
      || action.egressConfirmation !== null
      || action.dispatchClaimedAtMs === null
      || action.dispatchClaimedMonotonicMs === null
      || !Number.isSafeInteger(nowMs)
      || nowMs < action.dispatchClaimedAtMs
      || nowMs >= request.dispatchDeadlineAtMs
      || !Number.isSafeInteger(monotonicMs)
      || monotonicMs < action.dispatchClaimedMonotonicMs
      || monotonicMs >= request.dispatchDeadlineMonotonicMs
    ) return null;
    const receipt: Readonly<BinanceSpotEgressSpendReceipt> = Object.freeze({
      ...request,
      spentAtMs: nowMs,
      spentMonotonicMs: monotonicMs,
      state: 'SPENT_ONCE' as const,
    });
    const actions = state.actions.map((row, index) =>
      index === actionIndex
        ? Object.freeze({
            ...row,
            egressSpentAtMs: nowMs,
            egressSpentMonotonicMs: monotonicMs,
          })
        : row,
    );
    const next = frozenState({
      ...withoutStateDigest(state),
      revision: state.revision + 1,
      actions: Object.freeze(actions),
      lastTransitionAtMs: nowMs,
      previousStateDigest: state.stateDigest,
    });
    const cas = this.#ledger.compareAndSetConfigValueAndLogEvents(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
      raw,
      serializeState(next),
      [event(
        'system_integration.m0_spot.egress_spent',
        state.card.symbol,
        audit(
          state,
          next,
          'EGRESS_SPENT_ONCE',
          action.receipt.action,
          action.receipt.authorizationId,
          action.receipt.intentDigest,
        ),
      )],
      request.dispatchDeadlineAtMs,
    );
    return committed(cas) ? receipt : null;
  }

  async confirm(
    input: Readonly<BinanceSpotEgressConfirmRequest>,
  ): Promise<boolean> {
    let snapshot: Readonly<Record<string, unknown>> | null = null;
    try {
      const cloned = structuredClone(input) as unknown;
      snapshot = exactFields(cloned, ['spend', 'outcome'])
        ? deepFreezeData(cloned)
        : null;
    } catch {
      snapshot = null;
    }
    const spend = snapshotEgressSpendReceipt(snapshot?.spend);
    const outcome = snapshot?.outcome;
    if (
      spend === null
      || (
        outcome !== 'RESPONSE_RECEIVED'
        && outcome !== 'AMBIGUOUS'
      )
    ) return false;
    const raw = this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
    const state = parseState(raw);
    const fence = this.#clock.clockFenceId();
    const nowMs = this.#clock.nowMs();
    const monotonicMs = this.#clock.monotonicMs();
    const actionIndex = state?.actions.findIndex((row) =>
      row.receipt.authorizationId === spend.authorizationId,
    ) ?? -1;
    const action = actionIndex < 0
      ? null
      : state!.actions[actionIndex] ?? null;
    const exactSpend =
      state !== null
      && action !== null
      && spend.lifecycleId === state.lifecycleId
      && action.dispatchPermitDigest === spend.permitDigest
      && action.requestDigest === spend.requestDigest
      && action.dispatchLease?.requestId === spend.executionRequestId
      && action.dispatchLease.clockFenceId === spend.clockFenceId
      && action.dispatchDeadlineAtMs === spend.dispatchDeadlineAtMs
      && action.dispatchDeadlineMonotonicMs
        === spend.dispatchDeadlineMonotonicMs
      && action.egressSpentAtMs === spend.spentAtMs
      && action.egressSpentMonotonicMs === spend.spentMonotonicMs;
    if (
      exactSpend
      && action!.egressConfirmation === outcome
      && action!.egressConfirmedAtMs !== null
      && action!.egressConfirmedMonotonicMs !== null
    ) return true;
    if (
      state === null
      || terminalPhase(state.phase)
      || action === null
      || !exactSpend
      || !ownsExecution(state, fence)
      || state.execution?.requestId !== spend.executionRequestId
      || spend.clockFenceId !== fence
      || action.egressConfirmation !== null
      || action.egressConfirmedAtMs !== null
      || action.egressConfirmedMonotonicMs !== null
      || action.acceptanceSettlesAtMs === null
      || action.acceptanceSettlesMonotonicMs === null
      || !Number.isSafeInteger(nowMs)
      || nowMs < spend.spentAtMs
      || nowMs > action.acceptanceSettlesAtMs
      || !Number.isSafeInteger(monotonicMs)
      || monotonicMs < spend.spentMonotonicMs
      || monotonicMs > action.acceptanceSettlesMonotonicMs
    ) return false;
    const actions = state.actions.map((row, index) =>
      index === actionIndex
        ? Object.freeze({
            ...row,
            egressConfirmedAtMs: nowMs,
            egressConfirmedMonotonicMs: monotonicMs,
            egressConfirmation: outcome,
          })
        : row,
    );
    const next = frozenState({
      ...withoutStateDigest(state),
      revision: state.revision + 1,
      actions: Object.freeze(actions),
      lastTransitionAtMs: nowMs,
      previousStateDigest: state.stateDigest,
    });
    const cas = this.#ledger.compareAndSetConfigValueAndLogEvents(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
      raw,
      serializeState(next),
      [event(
        'system_integration.m0_spot.egress_confirmed',
        state.card.symbol,
        Object.freeze({
          ...audit(
            state,
            next,
            'EGRESS_CONFIRMED',
            action.receipt.action,
            action.receipt.authorizationId,
            action.receipt.intentDigest,
          ),
          egressOutcome: outcome,
        }),
      )],
    );
    return committed(cas);
  }

  recordMutationOutcome(input: Readonly<{
    authorizationId: string;
    outcome: M0SpotPersistedAction['outcome'];
    detail: string;
  }>): M0SpotLifecycleMutationResult {
    const raw = this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
    const state = parseState(raw);
    if (
      state === null
      || terminalPhase(state.phase)
      || !ownsExecution(state, this.#clock.clockFenceId())
      || !/^m0_action_[0-9a-f]{32}$/u.test(input.authorizationId)
      || input.outcome === 'NONE'
      || typeof input.detail !== 'string'
      || input.detail.length < 1
      || input.detail.length > 1_024
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: state === null
          ? 'M0_LIFECYCLE_NOT_ARMED'
          : 'M0_EXECUTION_LEASE_REQUIRED',
        state,
      });
    }
    const index = state.actions.findIndex((row) =>
      row.receipt.authorizationId === input.authorizationId,
    );
    if (index < 0) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_ACTION_NOT_FOUND',
        state,
      });
    }
    const current = state.actions[index];
    if (
      !current.dispatchClaimed
      || current.requestDigest === null
      || current.dispatchLease?.requestId !== state.execution?.requestId
      || current.dispatchLease?.clockFenceId
        !== this.#clock.clockFenceId()
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_ACTION_NOT_DISPATCHED',
        state,
      });
    }
    if (current.outcome === input.outcome) {
      return Object.freeze({
        disposition: 'REPLAY_QUERY_ONLY' as const,
        state,
        receipt: current.receipt,
      });
    }
    if (current.outcome !== 'NONE' && current.outcome !== 'unknown') {
      return Object.freeze({
        disposition: 'CONFLICT' as const,
        code: 'M0_ACTION_OUTCOME_CONFLICT',
        state,
      });
    }
    const actions = state.actions.map((row, actionIndex) =>
      actionIndex === index
        ? Object.freeze({ ...row, outcome: input.outcome })
        : row,
    );
    const nowMs = this.#clock.nowMs();
    const next = frozenState({
      ...withoutStateDigest(state),
      revision: state.revision + 1,
      phase:
        current.receipt.action === 'ENTRY'
        || current.receipt.action === 'FLATTEN'
          ? 'RECOVERY_REQUIRED'
          : state.phase,
      actions: Object.freeze(actions),
      lastTransitionAtMs: nowMs,
      previousStateDigest: state.stateDigest,
    });
    const records: LedgerEventInputRecord[] = [event(
      'system_integration.m0_spot.action_outcome',
      state.card.symbol,
      Object.freeze({
        ...audit(
          state,
          next,
          'ACTION_OUTCOME',
          current.receipt.action,
          current.receipt.authorizationId,
          current.receipt.intentDigest,
        ),
        outcome: input.outcome,
        detail: input.detail.slice(0, 256),
      }),
    )];
    if (
      current.receipt.action === 'ENTRY'
      || current.receipt.action === 'FLATTEN'
    ) {
      const leg = current.receipt.action === 'ENTRY'
        ? state.entry
        : state.flatten;
      if (leg === null) throw new Error('M0_SPOT_ORDER_LEG_MISSING');
      records.push(event('order_response', state.card.symbol, Object.freeze({
        schema: 'cosmos.system-integration.m0-spot-order-response.v1',
        lifecycleId: state.lifecycleId,
        cardDigest: state.card.cardDigest,
        action: current.receipt.action,
        intentDigest: current.receipt.intentDigest,
        reservationId: leg.reservationId,
        outcome: input.outcome,
        detail: input.detail.slice(0, 256),
      })));
    }
    const cas = this.#ledger.compareAndSetConfigValueAndLogEvents(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
      raw,
      serializeState(next),
      Object.freeze(records),
    );
    if (committed(cas)) {
      return Object.freeze({
        disposition: 'COMMITTED_NEW' as const,
        state: next,
        receipt: current.receipt,
      });
    }
    return Object.freeze({
      disposition: 'CONFLICT' as const,
      code: cas.reason,
      state: parseState(cas.currentValue),
    });
  }

  recordOrderObservation(input: Readonly<{
    leg: 'ENTRY' | 'FLATTEN';
    ticketId?: string;
    queryAuthorizationId: string;
    venueOrderId: string;
    venueStatus: string;
    terminal: boolean;
    fillsComplete: boolean;
    cumulativeFilledQuantity: string;
    evidenceRevision: string;
  }>): M0SpotLifecycleMutationResult {
    const raw = this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
    const state = parseState(raw);
    const historicalFlattenIndex =
      input.leg === 'FLATTEN'
        ? state?.flattenHistory.findIndex((leg) =>
            leg.ticket.ticketId === input.ticketId,
          ) ?? -1
        : -1;
    const current =
      input.leg === 'ENTRY'
        ? state?.entry
        : historicalFlattenIndex >= 0
          ? state?.flattenHistory[historicalFlattenIndex]
          : state?.flatten;
    const currentFenceId = this.#clock.clockFenceId();
    const queryProof =
      state === null || current == null
        ? null
        : exactCurrentReadResponseAction(
            state,
            input.queryAuthorizationId,
            'QUERY_ORDER',
            current.ticket,
            null,
            currentFenceId,
          );
    const mutationAction =
      state === null || current == null
        ? null
        : exactLegMutationAction(state, input.leg, current);
    if (
      state === null
      || terminalPhase(state.phase)
      || !ownsExecution(state, currentFenceId)
      || current == null
      || queryProof === null
      || mutationAction === null
      || (
        input.ticketId !== undefined
        && current.ticket.ticketId !== input.ticketId
      )
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code:
          state !== null
          && !ownsExecution(state, this.#clock.clockFenceId())
            ? 'M0_EXECUTION_LEASE_REQUIRED'
            : 'M0_ORDER_LEG_NOT_RESERVED',
        state,
      });
    }
    const quantity = normalizeSpotDecimal(
      input.cumulativeFilledQuantity,
      'M0 observed fill quantity',
    );
    const replacesNotFoundObservation =
      current.notFoundObservationCount > 0
      && (
        current.venueStatus === 'NOT_FOUND_PENDING_CONFIRMATION'
        || current.venueStatus === 'AUTHORITATIVE_NOT_FOUND'
      );
    if (
      !/^[0-9]+$/u.test(input.venueOrderId)
      || typeof input.venueStatus !== 'string'
      || !/^[A-Z_]{2,32}$/u.test(input.venueStatus)
      || typeof input.evidenceRevision !== 'string'
      || input.evidenceRevision.length < 1
      || input.evidenceRevision.length > 160
      ||
      compareSpotDecimals(quantity, current.ticket.quantity) > 0
      || compareSpotDecimals(
        quantity,
        current.cumulativeFilledQuantity,
      ) < 0
      || (
        current.venueOrderId !== null
        && current.venueOrderId !== input.venueOrderId
      )
      || (
        current.terminal
        && input.terminal !== true
        && !replacesNotFoundObservation
      )
      || (
        mutationAction.outcome === 'not_sent_reconciled'
        && !replacesNotFoundObservation
      )
      || (
        mutationAction.outcome !== 'NONE'
        && mutationAction.outcome !== 'unknown'
        && mutationAction.outcome !== 'accepted'
        && mutationAction.outcome !== 'accepted_reconciled'
        && mutationAction.outcome !== 'not_sent_reconciled'
      )
      || (
        mutationAction.outcome !== 'not_sent_reconciled'
        && (
          !mutationAction.dispatchClaimed
          || mutationAction.requestDigest === null
        )
      )
      || [
        state.entry,
        ...orderedFlattenLegs(state),
      ].some((leg) =>
        leg !== null
        && leg.ticket.ticketId !== current.ticket.ticketId
        && leg.venueOrderId === input.venueOrderId,
      )
    ) {
      return Object.freeze({
        disposition: 'CONFLICT' as const,
        code: 'M0_ORDER_OBSERVATION_CONFLICT',
        state,
      });
    }
    const terminal = replacesNotFoundObservation
      ? input.terminal
      : current.terminal || input.terminal;
    const fillsComplete = replacesNotFoundObservation
      ? input.fillsComplete
      : current.fillsComplete || input.fillsComplete;
    const persistedOrderFillQuantity = persistedFillQuantity(
      state.fills.filter((fill) =>
        fill.leg === input.leg
        && fill.venueOrderId === input.venueOrderId,
      ),
    );
    if (
      (fillsComplete && !terminal)
      || compareSpotDecimals(
        persistedOrderFillQuantity,
        quantity,
      ) > 0
      || (
        fillsComplete
        && persistedOrderFillQuantity !== quantity
      )
      || (
        terminal
        && fillsComplete
        && quantity !== '0'
        && (
          quantity !== current.ticket.quantity
          || input.venueStatus !== 'FILLED'
        )
      )
      || (
        terminal
        && fillsComplete
        && input.venueStatus === 'FILLED'
        && quantity !== current.ticket.quantity
      )
      || (
        terminal
        && ![
          'FILLED',
          'CANCELED',
          'REJECTED',
          'EXPIRED',
          'EXPIRED_IN_MATCH',
        ].includes(input.venueStatus)
      )
    ) {
      return Object.freeze({
        disposition: 'CONFLICT' as const,
        code: 'M0_ORDER_FILL_SET_NOT_EXACT',
        state,
      });
    }
    const sameObservation =
      current.venueOrderId === input.venueOrderId
      && current.venueStatus === input.venueStatus
      && current.terminal === terminal
      && current.fillsComplete === fillsComplete
      && current.cumulativeFilledQuantity === quantity;
    if (
      current.fillsComplete
      && !replacesNotFoundObservation
      && !sameObservation
    ) {
      return Object.freeze({
        disposition: 'CONFLICT' as const,
        code: 'M0_COMPLETED_ORDER_OBSERVATION_IMMUTABLE',
        state,
      });
    }
    const nextLeg: Readonly<M0SpotOrderLegState> = Object.freeze({
      ...current,
      venueOrderId: input.venueOrderId,
      venueStatus: input.venueStatus,
      terminal,
      fillsComplete,
      cumulativeFilledQuantity: quantity,
      notFoundFirstObservedAtMs: null,
      notFoundFirstObservedMonotonicMs: null,
      notFoundFirstObservedClockFenceId: null,
      notFoundObservationCount: 0,
      notFoundEvidenceRevisions: Object.freeze([]),
      notFoundQueryAuthorizationIds: Object.freeze([]),
    });
    const queryConsumedActions = Object.freeze(
      state.actions.map((action, index) =>
        index === queryProof.index
          ? Object.freeze({ ...action, outcome: 'accepted' as const })
          : action,
      ),
    );
    const correctedActions = Object.freeze(queryConsumedActions.map(
      (action) =>
        action.receipt.authorizationId
          === mutationAction.receipt.authorizationId
          ? Object.freeze({
              ...action,
              outcome: 'accepted_reconciled' as const,
            })
          : action,
    ));
    const nextFlattenHistory =
      historicalFlattenIndex >= 0
        ? Object.freeze(state.flattenHistory.map((leg, index) =>
            index === historicalFlattenIndex ? nextLeg : leg,
          ))
        : state.flattenHistory;
    let residual: string;
    try {
      residual = attributableBaseResidual(
        historicalFlattenIndex >= 0
          ? Object.freeze({
              ...state,
              flattenHistory: nextFlattenHistory,
            })
          : state,
        input.leg === 'ENTRY' ? nextLeg : state.entry,
        input.leg === 'FLATTEN' && historicalFlattenIndex < 0
          ? nextLeg
          : state.flatten,
      );
    } catch {
      return Object.freeze({
        disposition: 'CONFLICT' as const,
        code: 'M0_RESIDUAL_QUANTITY_CONFLICT',
        state,
      });
    }
    const nowMs = this.#clock.nowMs();
    const next = frozenState({
      ...withoutStateDigest(state),
      revision: state.revision + 1,
      phase: 'RECOVERY_REQUIRED',
      actions: correctedActions,
      entry: input.leg === 'ENTRY' ? nextLeg : state.entry,
      flatten:
        input.leg === 'FLATTEN' && historicalFlattenIndex < 0
          ? nextLeg
          : state.flatten,
      flattenHistory: nextFlattenHistory,
      residualQuantity: residual,
      lastTransitionAtMs: nowMs,
      previousStateDigest: state.stateDigest,
    });
    const records: LedgerEventInputRecord[] = [event(
      'system_integration.m0_spot.order_observed',
      state.card.symbol,
      Object.freeze({
        ...audit(
          state,
          next,
          'ORDER_OBSERVED',
          'QUERY_ORDER',
          queryProof.action.receipt.authorizationId,
          queryProof.action.receipt.intentDigest,
        ),
        leg: input.leg,
        venueOrderId: input.venueOrderId,
        venueStatus: input.venueStatus,
        terminal,
        fillsComplete,
        cumulativeFilledQuantity: quantity,
        evidenceRevision: input.evidenceRevision,
        queryAuthorizationId:
          queryProof.action.receipt.authorizationId,
        queryRequestDigest: queryProof.action.requestDigest,
        residualQuantity: residual,
        lateFoundCorrection: replacesNotFoundObservation,
      }),
    )];
    if (mutationAction.outcome !== 'accepted_reconciled') {
      records.push(event(
        'order_response',
        state.card.symbol,
        Object.freeze({
          schema: 'cosmos.system-integration.m0-spot-order-response.v1',
          lifecycleId: state.lifecycleId,
          cardDigest: state.card.cardDigest,
          action: input.leg,
          intentDigest: mutationAction.receipt.intentDigest,
          reservationId: current.reservationId,
          outcome: 'accepted_reconciled',
          detail: replacesNotFoundObservation
            ? 'late venue FOUND corrected prior authoritative absence'
            : 'venue FOUND reconciled exact dispatched mutation',
        }),
      ));
    }
    const cas = this.#ledger.compareAndSetConfigValueAndLogEvents(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
      raw,
      serializeState(next),
      Object.freeze(records),
    );
    if (committed(cas)) {
      return Object.freeze({
        disposition: 'COMMITTED_NEW' as const,
        state: next,
      });
    }
    return Object.freeze({
      disposition: 'CONFLICT' as const,
      code: cas.reason,
      state: parseState(cas.currentValue),
    });
  }

  recordAuthoritativeAbsence(input: Readonly<{
    leg: 'ENTRY' | 'FLATTEN';
    ticketId?: string;
    queryAuthorizationId: string;
    originalClientOrderId: string;
    evidenceRevision: string;
  }>): M0SpotLifecycleMutationResult {
    const raw = this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
    const state = parseState(raw);
    const historicalFlattenIndex =
      input.leg === 'FLATTEN'
        ? state?.flattenHistory.findIndex((leg) =>
            leg.ticket.ticketId === input.ticketId,
          ) ?? -1
        : -1;
    const current =
      input.leg === 'ENTRY'
        ? state?.entry
        : historicalFlattenIndex >= 0
          ? state?.flattenHistory[historicalFlattenIndex]
          : state?.flatten;
    const originalAction = [...(state?.actions ?? [])].reverse().find((action) =>
      action.receipt.action === input.leg
      && action.receipt.ticketId === current?.ticket.ticketId
      && action.receipt.clientOrderId === input.originalClientOrderId,
    );
    const currentClockFenceId = this.#clock.clockFenceId();
    const queryProof =
      state === null || current == null
        ? null
        : exactCurrentReadResponseAction(
            state,
            input.queryAuthorizationId,
            'QUERY_ORDER',
            current.ticket,
            null,
            currentClockFenceId,
          );
    if (
      state === null
      || terminalPhase(state.phase)
      || !ownsExecution(state, currentClockFenceId)
      || current == null
      || originalAction === undefined
      || queryProof === null
      || (
        input.ticketId !== undefined
        && current.ticket.ticketId !== input.ticketId
      )
      || current.ticket.clientOrderId !== input.originalClientOrderId
      || current.venueOrderId !== null
      || current.cumulativeFilledQuantity !== '0'
      || (
        input.leg === 'ENTRY'
        && state.fills.some((fill) => fill.leg === 'ENTRY')
      )
      || typeof input.evidenceRevision !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u
        .test(input.evidenceRevision)
      || (
        originalAction.outcome !== 'NONE'
        && originalAction.outcome !== 'unknown'
        && originalAction.outcome !== 'not_sent_reconciled'
      )
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_AUTHORITATIVE_ABSENCE_CONFLICT',
        state,
      });
    }
    const queryAction = queryProof.action;
    if (
      current.notFoundEvidenceRevisions.includes(input.evidenceRevision)
      || current.notFoundQueryAuthorizationIds.includes(
        queryAction.receipt.authorizationId,
      )
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_AUTHORITATIVE_ABSENCE_QUERY_EVIDENCE_REQUIRED',
        state,
      });
    }
    const nowMs = this.#clock.nowMs();
    const monotonicMs = this.#clock.monotonicMs();
    if (
      !Number.isSafeInteger(nowMs)
      || nowMs < 0
      || !Number.isSafeInteger(monotonicMs)
      || monotonicMs < 0
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_AUTHORITATIVE_ABSENCE_CLOCK_INVALID',
        state,
      });
    }
    const sameObservationFence =
      current.notFoundFirstObservedClockFenceId === currentClockFenceId;
    const firstObservedAtMs =
      sameObservationFence
        ? current.notFoundFirstObservedAtMs ?? nowMs
        : nowMs;
    const firstObservedMonotonicMs =
      sameObservationFence
        ? current.notFoundFirstObservedMonotonicMs ?? monotonicMs
        : monotonicMs;
    const dispatchSettled = dispatchAcceptanceSettled(
      originalAction,
      state.execution,
      nowMs,
      monotonicMs,
      currentClockFenceId,
    );
    const settled =
      sameObservationFence
      && current.notFoundObservationCount >= 1
      && nowMs - firstObservedAtMs
        >= AUTHORITATIVE_ABSENCE_CONFIRMATION_GAP_MS
      && monotonicMs - firstObservedMonotonicMs
        >= AUTHORITATIVE_ABSENCE_CONFIRMATION_GAP_MS
      && dispatchSettled;
    const priorEvidenceRevisions = sameObservationFence
      ? current.notFoundEvidenceRevisions
      : Object.freeze([]);
    const priorQueryAuthorizationIds = sameObservationFence
      ? current.notFoundQueryAuthorizationIds
      : Object.freeze([]);
    const nextLeg: Readonly<M0SpotOrderLegState> = Object.freeze({
      ...current,
      venueStatus: settled
        ? 'AUTHORITATIVE_NOT_FOUND'
        : 'NOT_FOUND_PENDING_CONFIRMATION',
      terminal: settled,
      fillsComplete: settled,
      notFoundFirstObservedAtMs: firstObservedAtMs,
      notFoundFirstObservedMonotonicMs: firstObservedMonotonicMs,
      notFoundFirstObservedClockFenceId: currentClockFenceId,
      notFoundObservationCount: Math.min(
        (sameObservationFence ? current.notFoundObservationCount : 0) + 1,
        24,
      ),
      notFoundEvidenceRevisions: Object.freeze([
        ...priorEvidenceRevisions,
        input.evidenceRevision,
      ]),
      notFoundQueryAuthorizationIds: Object.freeze([
        ...priorQueryAuthorizationIds,
        queryAction.receipt.authorizationId,
      ]),
    });
    const actions = Object.freeze(state.actions.map((action) => {
      if (
        action.receipt.authorizationId
          === queryAction.receipt.authorizationId
      ) return Object.freeze({ ...action, outcome: 'accepted' as const });
      if (
        settled
        && action.receipt.authorizationId
          === originalAction.receipt.authorizationId
      ) {
        return Object.freeze({
          ...action,
          outcome: 'not_sent_reconciled' as const,
        });
      }
      return action;
    }));
    const nextFlattenHistory =
      historicalFlattenIndex >= 0
        ? Object.freeze(state.flattenHistory.map((leg, index) =>
            index === historicalFlattenIndex ? nextLeg : leg,
          ))
        : state.flattenHistory;
    const next = frozenState({
      ...withoutStateDigest(state),
      revision: state.revision + 1,
      phase: 'RECOVERY_REQUIRED',
      actions,
      entry: input.leg === 'ENTRY' ? nextLeg : state.entry,
      flatten:
        input.leg === 'FLATTEN' && historicalFlattenIndex < 0
          ? nextLeg
          : state.flatten,
      flattenHistory: nextFlattenHistory,
      lastTransitionAtMs: nowMs,
      previousStateDigest: state.stateDigest,
    });
    const records: LedgerEventInputRecord[] = [event(
      settled
        ? 'system_integration.m0_spot.order_proven_absent'
        : 'system_integration.m0_spot.order_absence_pending',
      state.card.symbol,
      Object.freeze({
        ...audit(
          state,
          next,
          settled
            ? 'AUTHORITATIVE_NOT_FOUND'
            : 'NOT_FOUND_PENDING_CONFIRMATION',
          'QUERY_ORDER',
          queryAction.receipt.authorizationId,
          queryAction.receipt.intentDigest,
        ),
        leg: input.leg,
        originalClientOrderId: input.originalClientOrderId,
        evidenceRevision: input.evidenceRevision,
        queryAuthorizationId: queryAction.receipt.authorizationId,
        queryPermitDigest: queryAction.dispatchPermitDigest,
        firstObservedAtMs,
        firstObservedMonotonicMs,
        firstObservedClockFenceId: currentClockFenceId,
        observationCount: nextLeg.notFoundObservationCount,
        mutationDispatchClaimed: originalAction.dispatchClaimed,
        dispatchClaimedAtMs: originalAction.dispatchClaimedAtMs,
        dispatchClaimedMonotonicMs:
          originalAction.dispatchClaimedMonotonicMs,
        dispatchDeadlineAtMs: originalAction.dispatchDeadlineAtMs,
        dispatchDeadlineMonotonicMs:
          originalAction.dispatchDeadlineMonotonicMs,
        acceptanceSettlesAtMs: originalAction.acceptanceSettlesAtMs,
        acceptanceSettlesMonotonicMs:
          originalAction.acceptanceSettlesMonotonicMs,
        requestTimeoutMs: originalAction.requestTimeoutMs,
        recvWindowMs: originalAction.recvWindowMs,
        dispatchSettled,
        settled,
        queryBeforeRetry: true,
        blindResend: false,
      }),
    )];
    if (settled) {
      records.push(event(
        'order_response',
        state.card.symbol,
        Object.freeze({
          schema: 'cosmos.system-integration.m0-spot-order-response.v1',
          lifecycleId: state.lifecycleId,
          cardDigest: state.card.cardDigest,
          action: input.leg,
          intentDigest: originalAction.receipt.intentDigest,
          reservationId: current.reservationId,
          outcome: 'not_sent_reconciled',
          detail: originalAction.dispatchClaimed
            ? 'venue absence confirmed beyond dispatch acceptance window'
            : 'reserved mutation durably proved never dispatch-claimed',
        }),
      ));
    }
    const cas = this.#ledger.compareAndSetConfigValueAndLogEvents(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
      raw,
      serializeState(next),
      Object.freeze(records),
    );
    return committed(cas)
      ? Object.freeze({
          disposition: 'COMMITTED_NEW' as const,
          state: next,
        })
      : Object.freeze({
          disposition: 'CONFLICT' as const,
          code: cas.reason,
          state: parseState(cas.currentValue),
        });
  }

  recordFill(input: Readonly<{
    leg: 'ENTRY' | 'FLATTEN';
    ticketId: string;
    queryAuthorizationId: string;
    symbol: string;
    fills: readonly Readonly<SpotFillObservation>[];
  }>): M0SpotLifecycleMutationResult {
    const raw = this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
    const state = parseState(raw);
    const historicalFlattenIndex =
      input.leg === 'FLATTEN'
        ? state?.flattenHistory.findIndex((leg) =>
            leg.ticket.ticketId === input.ticketId,
          ) ?? -1
        : -1;
    const order =
      input.leg === 'ENTRY'
        ? state?.entry
        : historicalFlattenIndex >= 0
          ? state?.flattenHistory[historicalFlattenIndex]
          : state?.flatten;
    const currentClockFenceId = this.#clock.clockFenceId();
    const queryProof =
      state === null || order == null || order.venueOrderId === null
        ? null
        : exactCurrentReadResponseAction(
            state,
            input.queryAuthorizationId,
            'QUERY_FILLS',
            order.ticket,
            order.venueOrderId,
            currentClockFenceId,
          );
    if (
      state === null
      || terminalPhase(state.phase)
      || !ownsExecution(state, currentClockFenceId)
      || order == null
      || order.ticket.ticketId !== input.ticketId
      || order.venueOrderId === null
      || queryProof === null
      || input.symbol !== state.card.symbol
      || !Array.isArray(input.fills)
      || input.fills.length > MAX_FILLS
      || !order.terminal
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_FILL_BATCH_PROOF_INVALID',
        state,
      });
    }
    const nowMs = this.#clock.nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_FILL_BATCH_CLOCK_INVALID',
        state,
      });
    }

    const persistedBatch: Readonly<M0SpotPersistedFill>[] = [];
    const batchFillIds = new Set<string>();
    try {
      for (const fill of input.fills) {
        if (
          fill === null
          || typeof fill !== 'object'
          || !/^[0-9]+$/u.test(fill.fillId)
          || fill.venueOrderId !== order.venueOrderId
          || !/^[0-9]+$/u.test(fill.venueOrderId)
          || !/^[A-Z0-9]{1,16}$/u.test(fill.commissionAsset)
          || !Number.isSafeInteger(fill.occurredAtMs)
          || fill.occurredAtMs < order.ticket.createdAtMs
          || fill.occurredAtMs > nowMs
          || batchFillIds.has(fill.fillId)
        ) throw new TypeError('M0 fill batch identity invalid');
        const tradeId = Number(fill.fillId);
        const orderId = Number(fill.venueOrderId);
        const price = normalizeSpotDecimal(fill.price, 'M0 fill price');
        const quantity = normalizeSpotDecimal(
          fill.quantity,
          'M0 fill quantity',
        );
        const quoteQuantity = normalizeSpotDecimal(
          fill.quoteQuantity,
          'M0 fill quote quantity',
        );
        const commission = normalizeSpotDecimal(
          fill.commission,
          'M0 fill commission',
        );
        if (
          !Number.isSafeInteger(tradeId)
          || tradeId < 0
          || !Number.isSafeInteger(orderId)
          || orderId < 0
          || price !== fill.price
          || quantity !== fill.quantity
          || quoteQuantity !== fill.quoteQuantity
          || commission !== fill.commission
          || compareSpotDecimals(price, '0') <= 0
          || compareSpotDecimals(quantity, '0') <= 0
          || quoteQuantity !== multiplySpotDecimals(price, quantity)
          || order.ticket.price === null
          || (
            order.ticket.side === 'BUY'
            && compareSpotDecimals(price, order.ticket.price) > 0
          )
          || (
            order.ticket.side === 'SELL'
            && compareSpotDecimals(price, order.ticket.price) < 0
          )
        ) throw new TypeError('M0 fill batch economics invalid');
        batchFillIds.add(fill.fillId);
        const fillTruth = Object.freeze({
          leg: input.leg,
          fillId: fill.fillId,
          venueOrderId: fill.venueOrderId,
          price,
          quantity,
          quoteQuantity,
          commission,
          commissionAsset: fill.commissionAsset,
          occurredAtMs: fill.occurredAtMs,
        });
        persistedBatch.push(Object.freeze({
          ...fillTruth,
          fillDigest: sha256('m0-spot-fill', fillTruth),
        }));
      }
    } catch {
      return Object.freeze({
        disposition: 'CONFLICT' as const,
        code: 'M0_FILL_BATCH_CONTENT_INVALID',
        state,
      });
    }
    persistedBatch.sort((left, right) =>
      Number(left.fillId) - Number(right.fillId),
    );

    const existingOrderFills = state.fills.filter((fill) =>
      fill.leg === input.leg
      && fill.venueOrderId === order.venueOrderId,
    );
    const persistedByFillId = new Map(
      persistedBatch.map((fill) => [fill.fillId, fill] as const),
    );
    const existingBatchExact = existingOrderFills.every((existing) => {
      const candidate = persistedByFillId.get(existing.fillId);
      return candidate !== undefined
        && canonicalJson(candidate) === canonicalJson(existing);
    });
    const globalFillIdentityExact = persistedBatch.every((candidate) => {
      const existing = state.fills.find((fill) =>
        fill.fillId === candidate.fillId,
      );
      return existing === undefined
        || (
          existing.leg === input.leg
          && existing.venueOrderId === order.venueOrderId
          && canonicalJson(existing) === canonicalJson(candidate)
        );
    });
    const batchQuantity = persistedFillQuantity(persistedBatch);
    if (
      !existingBatchExact
      || !globalFillIdentityExact
      || batchQuantity !== order.cumulativeFilledQuantity
    ) {
      return Object.freeze({
        disposition: 'CONFLICT' as const,
        code: 'M0_FILL_BATCH_NOT_EXACT',
        state,
      });
    }
    const newFills = persistedBatch.filter((candidate) =>
      !state.fills.some((existing) =>
        existing.fillId === candidate.fillId,
      ),
    );
    if (state.fills.length + newFills.length > MAX_FILLS) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_FILL_STATE_CAPACITY_EXHAUSTED',
        state,
      });
    }

    const nextLeg: Readonly<M0SpotOrderLegState> = Object.freeze({
      ...order,
      fillsComplete: true,
    });
    const nextFlattenHistory =
      historicalFlattenIndex >= 0
        ? Object.freeze(state.flattenHistory.map((leg, index) =>
            index === historicalFlattenIndex ? nextLeg : leg,
          ))
        : state.flattenHistory;
    const nextFills = Object.freeze([...state.fills, ...newFills]);
    const nextActions = Object.freeze(state.actions.map((action, index) =>
      index === queryProof.index
        ? Object.freeze({ ...action, outcome: 'accepted' as const })
        : action,
    ));
    let next: Readonly<M0SpotLifecycleState>;
    let nextSerialized: string;
    try {
      const residualState = Object.freeze({
        ...state,
        fills: nextFills,
        flattenHistory: nextFlattenHistory,
      });
      const residual = attributableBaseResidual(
        residualState,
        input.leg === 'ENTRY' ? nextLeg : state.entry,
        input.leg === 'FLATTEN' && historicalFlattenIndex < 0
          ? nextLeg
          : state.flatten,
      );
      next = frozenState({
        ...withoutStateDigest(state),
        revision: state.revision + 1,
        phase: 'RECOVERY_REQUIRED',
        actions: nextActions,
        fills: nextFills,
        entry: input.leg === 'ENTRY' ? nextLeg : state.entry,
        flatten:
          input.leg === 'FLATTEN' && historicalFlattenIndex < 0
            ? nextLeg
            : state.flatten,
        flattenHistory: nextFlattenHistory,
        residualQuantity: residual,
        lastTransitionAtMs: nowMs,
        previousStateDigest: state.stateDigest,
      });
      // Prove bounded state and graph validity before touching the fills table.
      nextSerialized = serializeState(next);
      if (parseState(nextSerialized)?.stateDigest !== next.stateDigest) {
        throw new TypeError('M0 fill batch state is not self-consistent');
      }
    } catch {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_FILL_STATE_CAPACITY_EXHAUSTED',
        state,
      });
    }
    if (
      this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY) !== raw
    ) {
      return Object.freeze({
        disposition: 'CONFLICT' as const,
        code: 'M0_FILL_BATCH_STATE_CHANGED',
        state: this.read(),
      });
    }
    try {
      for (const fill of newFills) {
        this.#ledger.insertFill({
          symbol: input.symbol,
          tradeId: Number(fill.fillId),
          orderId: Number(fill.venueOrderId),
          side: order.ticket.side,
          price: normalizeNonNegativeExactDecimal(fill.price),
          qty: normalizeNonNegativeExactDecimal(fill.quantity),
          quoteQty: normalizeNonNegativeExactDecimal(fill.quoteQuantity),
          commission: normalizeNonNegativeExactDecimal(fill.commission),
          commissionAsset: fill.commissionAsset,
          ts: fill.occurredAtMs,
          source: 'BINANCE_M0_SPOT',
        });
      }
    } catch {
      return Object.freeze({
        disposition: 'CONFLICT' as const,
        code: 'M0_FILL_LEDGER_CONFLICT',
        state,
      });
    }
    if (
      this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY) !== raw
    ) {
      return Object.freeze({
        disposition: 'CONFLICT' as const,
        code: 'M0_FILL_BATCH_STATE_CHANGED',
        state: this.read(),
      });
    }
    const records: LedgerEventInputRecord[] = newFills.map((fill) =>
      event(
        'foundation.spot.fill',
        input.symbol,
        Object.freeze({
          schema: 'cosmos.system-integration.m0-spot-fill-reference.v1',
          lifecycleId: state.lifecycleId,
          cardDigest: state.card.cardDigest,
          leg: input.leg,
          fillId: fill.fillId,
          venueOrderId: fill.venueOrderId,
          quoteQuantity: fill.quoteQuantity,
          fillDigest: fill.fillDigest,
          queryAuthorizationId:
            queryProof.action.receipt.authorizationId,
          executionAuthority: 'NONE',
          externalActionAuthorization: 'NONE',
        }),
      ),
    );
    records.push(event(
      'system_integration.m0_spot.fill_batch_adopted',
      input.symbol,
      Object.freeze({
        ...audit(
          state,
          next,
          'QUERY_FILLS_BATCH_ADOPTED',
          'QUERY_FILLS',
          queryProof.action.receipt.authorizationId,
          queryProof.action.receipt.intentDigest,
        ),
        leg: input.leg,
        ticketId: order.ticket.ticketId,
        venueOrderId: order.venueOrderId,
        fillCount: persistedBatch.length,
        newFillCount: newFills.length,
        cumulativeFilledQuantity: batchQuantity,
        queryRequestDigest: queryProof.action.requestDigest,
        queryPermitDigest: queryProof.action.dispatchPermitDigest,
      }),
    ));
    const cas = this.#ledger.compareAndSetConfigValueAndLogEvents(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
      raw,
      nextSerialized,
      Object.freeze(records),
    );
    return committed(cas)
      ? Object.freeze({
          disposition: 'COMMITTED_NEW' as const,
          state: next,
        })
      : Object.freeze({
          disposition: 'CONFLICT' as const,
          code: cas.reason,
          state: parseState(cas.currentValue),
        });
  }

  markRestartRecovery(restartId: string): M0SpotLifecycleMutationResult {
    const raw = this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
    const state = parseState(raw);
    if (
      state === null
      || terminalPhase(state.phase)
      || !ownsExecution(state, this.#clock.clockFenceId())
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code:
          state !== null
          && !terminalPhase(state.phase)
          && !ownsExecution(state, this.#clock.clockFenceId())
            ? 'M0_EXECUTION_LEASE_REQUIRED'
            : 'M0_RESTART_RECOVERY_NOT_REQUIRED',
        state,
      });
    }
    const nowMs = this.#clock.nowMs();
    const next = frozenState({
      ...withoutStateDigest(state),
      revision: state.revision + 1,
      phase: state.entry === null ? state.phase : 'RECOVERY_REQUIRED',
      newEntryArmed: state.entry === null && state.newEntryArmed,
      lastTransitionAtMs: nowMs,
      previousStateDigest: state.stateDigest,
    });
    const cas = this.#ledger.compareAndSetConfigValueAndLogEvents(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
      raw,
      serializeState(next),
      [event(
        'foundation.spot.restart-recovery',
        state.card.symbol,
        Object.freeze({
          ...audit(
            state,
            next,
            'RESTART_QUERY_FIRST',
            null,
            null,
            null,
          ),
          restartId: restartId.slice(0, 160),
          queryBeforeRetry: true,
          blindResend: false,
        }),
      )],
    );
    if (committed(cas)) {
      return Object.freeze({
        disposition: 'COMMITTED_NEW' as const,
        state: next,
      });
    }
    return Object.freeze({
      disposition: 'REPLAY_QUERY_ONLY' as const,
      state: parseState(cas.currentValue) ?? state,
    });
  }

  reconcileAndDisarm(
    evidence: Readonly<SpotAuthoritativeFlatEvidence>,
  ): M0SpotLifecycleMutationResult {
    const raw = this.#ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
    const state = parseState(raw);
    const mutationTruth = this.#ledger.readDurableMutationAuthority();
    let exactEvidence: Readonly<SpotAuthoritativeFlatEvidence> | null = null;
    try {
      const snapshot = structuredClone(evidence) as unknown;
      if (exactFields(snapshot, FLAT_EVIDENCE_FIELDS)) {
        exactEvidence = deepFreezeData(
          snapshot as unknown as SpotAuthoritativeFlatEvidence,
        );
      }
    } catch {
      exactEvidence = null;
    }
    if (state !== null && terminalPhase(state.phase)) {
      const sameEvidence =
        state.phase === 'DISARMED_SAFE'
        && exactEvidence !== null
        && state.reconciliation?.evidenceDigest
          === sha256('m0-spot-flat-evidence', exactEvidence);
      return sameEvidence
        ? Object.freeze({
            disposition: 'REPLAY_QUERY_ONLY' as const,
            state,
          })
        : Object.freeze({
            disposition: 'BLOCKED' as const,
            code: 'M0_LIFECYCLE_ALREADY_DISARMED',
            state,
          });
    }
    const accounting =
      state === null ? null : persistedFlatAccounting(state);
    const nowMs = this.#clock.nowMs();
    const monotonicMs = this.#clock.monotonicMs();
    const currentClockFenceId = this.#clock.clockFenceId();
    const mutationDispatchWindowsSettled =
      state !== null
      && state.actions
        .filter((action) =>
          action.operation === 'SUBMIT'
          || action.operation === 'FLATTEN'
          || action.operation === 'CANCEL',
        )
        .every((action) =>
          dispatchAcceptanceSettled(
            action,
            state.execution,
            nowMs,
            monotonicMs,
            currentClockFenceId,
          ),
        );
    const latestMutationAcceptanceAtMs = state === null
      ? null
      : state.actions
          .filter((action) =>
            action.dispatchClaimed
            && (
              action.operation === 'SUBMIT'
              || action.operation === 'FLATTEN'
              || action.operation === 'CANCEL'
            )
            && action.acceptanceSettlesAtMs !== null,
          )
          .reduce(
            (latest, action) =>
              Math.max(latest, action.acceptanceSettlesAtMs!),
            state.card.issuedAtMs,
          );
    const minimumFreshEvidenceAtMs =
      state === null || latestMutationAcceptanceAtMs === null
        ? null
        : Math.max(
            state.lastTransitionAtMs,
            latestMutationAcceptanceAtMs,
          );
    const terminalQueryActionsSettled =
      state !== null
      && state.actions
        .filter((action) =>
          action.dispatchClaimed
          && (
            action.operation === 'QUERY_ORDER'
            || action.operation === 'QUERY_FILLS'
          ),
        )
        .every((action) => {
          const leg = (
            state.entry !== null
            && state.entry.ticket.ticketId === action.receipt.ticketId
            && state.entry.ticket.termsDigest === action.receipt.termsDigest
            && state.entry.ticket.clientOrderId
              === action.receipt.clientOrderId
          )
            ? state.entry
            : orderedFlattenLegs(state).find((candidate) =>
                candidate.ticket.ticketId === action.receipt.ticketId
                && candidate.ticket.termsDigest
                  === action.receipt.termsDigest
                && candidate.ticket.clientOrderId
                  === action.receipt.clientOrderId
              ) ?? null;
          return leg !== null
            && leg.terminal
            && (
              action.operation === 'QUERY_ORDER'
              || leg.fillsComplete
            );
        });
    let evidenceExact = false;
    try {
      if (
        state === null
        || state.entry === null
        || accounting === null
        || exactEvidence === null
      ) throw new TypeError('flat reconciliation basis unavailable');
      const attempts = accounting.attempts;
      const latestFlatten = attempts.at(-1) ?? null;
      const baselineRevision =
        state.readinessCard.baseline.baselineRevision;
      const baselineBaseQuantity =
        state.readinessCard.baseline.baselineBaseQuantity;
      const baselineObservedAtMs =
        state.readinessCard.baseline.observedAtMs;
      const baselineQuoteQuantity =
        state.readinessCard.baseline.baselineQuoteQuantity;
      const exchangeBaseTolerance =
        state.readinessCard.baseline.exchangeBaseTolerance;
      const quoteQuantityTolerance =
        state.readinessCard.baseline.quoteQuantityTolerance;
      const quantityStepSize = state.readinessCard.filters.stepSize;
      const maximumResidualDustNotionalQuote =
        state.readinessCard.limits.maximumResidualDustNotionalQuote;
      const maximumGrossLifecycleTurnoverQuote =
        state.readinessCard.limits.maximumGrossLifecycleTurnoverQuote;
      if (
        baselineRevision === null
        || baselineBaseQuantity === null
        || baselineQuoteQuantity === null
        || baselineObservedAtMs === null
        || exchangeBaseTolerance === null
        || quoteQuantityTolerance === null
        || quantityStepSize === null
        || maximumGrossLifecycleTurnoverQuote === null
      ) throw new TypeError('persisted readiness basis unavailable');
      const baseline = normalizeSpotDecimal(
        baselineBaseQuantity,
        'M0 persisted baseline base quantity',
      );
      const observed = normalizeSpotDecimal(
        exactEvidence.observedBaseQuantity,
        'M0 observed base quantity',
      );
      const tolerance = normalizeSpotDecimal(
        exchangeBaseTolerance,
        'M0 exchange base tolerance',
      );
      const step = normalizeSpotDecimal(
        quantityStepSize,
        'M0 quantity step size',
      );
      const maximumDust = normalizeSpotDecimal(
        maximumResidualDustNotionalQuote,
        'M0 maximum residual dust notional',
      );
      const maximumTurnover = normalizeSpotDecimal(
        maximumGrossLifecycleTurnoverQuote,
        'M0 maximum lifecycle turnover',
      );
      const baselineQuote = normalizeSpotDecimal(
        baselineQuoteQuantity,
        'M0 persisted baseline quote quantity',
      );
      const observedQuote = normalizeSpotDecimal(
        exactEvidence.observedQuoteQuantity,
        'M0 observed quote quantity',
      );
      const quoteTolerance = normalizeSpotDecimal(
        quoteQuantityTolerance,
        'M0 quote quantity tolerance',
      );
      const observedQuoteDelta = createSpotSignedQuoteAmount(
        observedQuote,
        baselineQuote,
      );
      const quoteEquationResidual = subtractSpotSignedQuoteAmounts(
        observedQuoteDelta,
        accounting.quoteAccounting.fillDerivedQuoteCashflow,
      );
      const observedBaseDelta = absoluteSpotDifference(
        observed,
        baseline,
      );
      const observedDustNotional = multiplySpotDecimals(
        observedBaseDelta,
        state.entryTicket.riskReferencePrice,
      );
      const latestAbsent =
        latestFlatten?.venueStatus === 'AUTHORITATIVE_NOT_FOUND';
      const allFillsOccurredByEvidence = state.fills.every((fill) =>
        fill.occurredAtMs <= exactEvidence!.occurredAtMs,
      );
      evidenceExact =
        exactEvidence.canonicalStatus === 'EXACT'
        && exactEvidence.ledgerState === 'MATCHED'
        && typeof exactEvidence.revision === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u
          .test(exactEvidence.revision)
        && exactEvidence.sourceTicketId === state.entryTicket.ticketId
        && exactEvidence.sourceClientOrderId
          === state.entryTicket.clientOrderId
        && exactEvidence.sourceVenueOrderId === state.entry.venueOrderId
        && exactEvidence.sourceOrderAuthoritativelyAbsent
          === accounting.sourceAuthoritativelyAbsent
        && exactEvidence.sourceOpenOrderAbsent === true
        && exactEvidence.sourceOrderTerminal === state.entry.terminal
        && exactEvidence.sourceOrderTerminal === true
        && exactEvidence.sourceFillsComplete === state.entry.fillsComplete
        && exactEvidence.sourceFillsComplete === true
        && normalizeSpotDecimal(
          exactEvidence.sourceCumulativeFilledQuantity,
          'M0 source cumulative quantity',
        ) === accounting.sourceGrossFilledBaseQuantity
        && exactEvidence.sourceCumulativeFilledQuantity
          === accounting.sourceGrossFilledBaseQuantity
        && exactEvidence.flattenTicketId
          === (latestFlatten?.ticket.ticketId ?? null)
        && exactEvidence.flattenClientOrderId
          === (latestFlatten?.ticket.clientOrderId ?? null)
        && exactEvidence.flattenVenueOrderId
          === (latestFlatten?.venueOrderId ?? null)
        && exactEvidence.flattenOrderTerminal
          === (latestFlatten?.terminal ?? true)
        && exactEvidence.flattenOrderTerminal === true
        && exactEvidence.flattenFillsComplete
          === (latestFlatten?.fillsComplete ?? true)
        && exactEvidence.flattenFillsComplete === true
        && normalizeSpotDecimal(
          exactEvidence.flattenCumulativeFilledQuantity,
          'M0 flatten cumulative quantity',
        ) === accounting.cumulativeFilledSellQuantity
        && exactEvidence.flattenCumulativeFilledQuantity
          === accounting.cumulativeFilledSellQuantity
        && exactEvidence.baseAsset === state.card.baseAsset
        && exactEvidence.baselineRevision === baselineRevision
        && normalizeSpotDecimal(
          exactEvidence.baselineBaseQuantity,
          'M0 evidence baseline base quantity',
        ) === baseline
        && exactEvidence.baselineBaseQuantity === baseline
        && exactEvidence.observedBaseQuantity === observed
        && exactEvidence.exchangeBaseTolerance === tolerance
        && exactEvidence.maximumResidualDustNotionalQuote === maximumDust
        && normalizeSpotDecimal(
          exactEvidence.residualDustNotionalQuote,
          'M0 evidence residual dust notional',
        ) === accounting.residualDustNotionalQuote
        && exactEvidence.residualDustNotionalQuote
          === accounting.residualDustNotionalQuote
        && normalizeSpotDecimal(
          exactEvidence.sourceBaseCommissionQuantity,
          'M0 evidence source base commission',
        ) === accounting.sourceBaseCommissionQuantity
        && exactEvidence.sourceBaseCommissionQuantity
          === accounting.sourceBaseCommissionQuantity
        && normalizeSpotDecimal(
          exactEvidence.flattenBaseCommissionQuantity,
          'M0 evidence flatten base commission',
        ) === accounting.flattenBaseCommissionQuantity
        && exactEvidence.flattenBaseCommissionQuantity
          === accounting.flattenBaseCommissionQuantity
        && normalizeSpotDecimal(
          exactEvidence.canaryAttributableBaseDeltaQuantity,
          'M0 evidence canary attributable base delta',
        ) === accounting.residualQuantity
        && exactEvidence.canaryAttributableBaseDeltaQuantity
          === accounting.residualQuantity
        && exactEvidence.flattenAttemptCount === attempts.length
        && exactEvidence.allFlattenOrdersTerminal === true
        && exactEvidence.allFlattenFillsComplete === true
        && exactEvidence.flattenOpenOrdersAbsent === true
        && exactOrderedStrings(
          exactEvidence.authoritativelyAbsentFlattenClientOrderIds,
          accounting.absentFlattenClientOrderIds,
        )
        && (
          latestFlatten === null
          || latestAbsent === (latestFlatten.venueOrderId === null)
        )
        && exactEvidence.quoteAsset === state.card.quoteAsset
        && exactEvidence.quoteAsset === 'USDT'
        && exactEvidence.baselineQuoteQuantity === baselineQuote
        && exactEvidence.observedQuoteQuantity === observedQuote
        && exactEvidence.quoteQuantityTolerance === quoteTolerance
        && validSignedQuoteAmount(exactEvidence.observedQuoteDelta)
        && validSignedQuoteAmount(exactEvidence.referencePnlQuote)
        && validSignedQuoteAmount(exactEvidence.signedSlippageCostQuote)
        && validSignedQuoteAmount(exactEvidence.fillDerivedQuoteCashflow)
        && validSignedQuoteAmount(exactEvidence.realizedPnlAfterQuoteFees)
        && validSignedQuoteAmount(exactEvidence.quoteEquationResidual)
        && spotSignedQuoteAmountsEqual(
          exactEvidence.observedQuoteDelta,
          observedQuoteDelta,
        )
        && exactEvidence.sourceGrossQuoteDebit
          === accounting.quoteAccounting.sourceGrossQuoteDebit
        && exactEvidence.flattenGrossQuoteCredit
          === accounting.quoteAccounting.flattenGrossQuoteCredit
        && exactEvidence.observedGrossLifecycleTurnoverQuote
          === accounting.quoteAccounting
            .observedGrossLifecycleTurnoverQuote
        && exactEvidence.authorizedFilledLifecycleTurnoverQuote
          === accounting.quoteAccounting
            .authorizedFilledLifecycleTurnoverQuote
        && exactEvidence.favorableSellPriceImprovementQuote
          === accounting.quoteAccounting
            .favorableSellPriceImprovementQuote
        && spotSignedQuoteAmountsEqual(
          exactEvidence.referencePnlQuote,
          accounting.quoteAccounting.referencePnlQuote,
        )
        && spotSignedQuoteAmountsEqual(
          exactEvidence.signedSlippageCostQuote,
          accounting.quoteAccounting.signedSlippageCostQuote,
        )
        && exactEvidence.quoteCommissionDebit
          === accounting.quoteAccounting.quoteCommissionDebit
        && spotSignedQuoteAmountsEqual(
          exactEvidence.fillDerivedQuoteCashflow,
          accounting.quoteAccounting.fillDerivedQuoteCashflow,
        )
        && spotSignedQuoteAmountsEqual(
          exactEvidence.realizedPnlAfterQuoteFees,
          accounting.quoteAccounting.realizedPnlAfterQuoteFees,
        )
        && validCommissionTotals(exactEvidence.commissionTotals)
        && canonicalJson(exactEvidence.commissionTotals)
          === canonicalJson(
            accounting.quoteAccounting.commissionTotals,
          )
        && exactEvidence.quoteCashflowStatus
          === 'EXACT_WITHIN_TOLERANCE'
        && exactEvidence.quoteEconomicsStatus
          === accounting.quoteAccounting.quoteEconomicsStatus
        && exactEvidence.thirdAssetCommissionQuoteValueStatus
          === accounting.quoteAccounting
            .thirdAssetCommissionQuoteValueStatus
        && exactEvidence.thirdAssetCommissionQuoteValue === null
        && exactEvidence.thirdAssetValuationDigest === null
        && spotSignedQuoteAmountsEqual(
          exactEvidence.quoteEquationResidual,
          quoteEquationResidual,
        )
        && compareSpotDecimals(
          quoteEquationResidual.quantity,
          quoteTolerance,
        ) <= 0
        && Number.isSafeInteger(nowMs)
        && nowMs >= 0
        && Number.isSafeInteger(exactEvidence.occurredAtMs)
        && exactEvidence.occurredAtMs >= state.card.issuedAtMs
        && exactEvidence.occurredAtMs <= nowMs
        && minimumFreshEvidenceAtMs !== null
        && Number.isSafeInteger(minimumFreshEvidenceAtMs)
        && exactEvidence.occurredAtMs >= minimumFreshEvidenceAtMs
        && allFillsOccurredByEvidence
        && Number.isSafeInteger(baselineObservedAtMs)
        && baselineObservedAtMs >= 0
        && baselineObservedAtMs <= state.entryTicket.createdAtMs
        && baselineQuote === baselineQuoteQuantity
        && quoteTolerance === quoteQuantityTolerance
        && tolerance === exchangeBaseTolerance
        && step === quantityStepSize
        && maximumDust
          === state.card.maximumResidualDustNotionalQuote
        && maximumTurnover
          === state.card.maximumGrossLifecycleTurnoverQuote
        && step !== '0'
        && maximumDust !== '0'
        && maximumTurnover !== '0'
        && compareSpotDecimals(
          multiplySpotDecimals(maximumDust, '100'),
          state.entryTicket.orderNotionalQuote,
        ) <= 0
        && compareSpotDecimals(tolerance, step) < 0
        && compareSpotDecimals(
          accounting.residualQuantity,
          tolerance,
        ) <= 0
        && compareSpotDecimals(
          accounting.residualDustNotionalQuote,
          maximumDust,
        ) <= 0
        && compareSpotDecimals(
          accounting.quoteAccounting
            .authorizedFilledLifecycleTurnoverQuote,
          maximumTurnover,
        ) <= 0
        && compareSpotDecimals(observedBaseDelta, tolerance) <= 0
        && compareSpotDecimals(
          observedDustNotional,
          maximumDust,
        ) <= 0;
    } catch {
      evidenceExact = false;
    }
    if (
      state === null
      || !ownsExecution(state, this.#clock.clockFenceId())
      || state.entry === null
      || !state.entry.terminal
      || !state.entry.fillsComplete
      || !mutationDispatchWindowsSettled
      || !terminalQueryActionsSettled
      || accounting === null
      || exactEvidence === null
      || !evidenceExact
      || mutationTruth.posture !== 'PROVEN_ABSENT'
      || mutationTruth.unresolvedOrderCount !== 0
      || mutationTruth.malformedOrderRowCount !== 0
      || mutationTruth.readErrorCount !== 0
    ) {
      return Object.freeze({
        disposition: 'BLOCKED' as const,
        code: 'M0_EXACT_FLAT_RECONCILIATION_NOT_PROVED',
        state,
      });
    }
    const baselineBaseQuantity =
      state.readinessCard.baseline.baselineBaseQuantity!;
    const observedBaseQuantity = normalizeSpotDecimal(
      exactEvidence.observedBaseQuantity,
      'M0 reconciled observed base quantity',
    );
    const residualCondition =
      accounting.residualQuantity === '0'
      && observedBaseQuantity === baselineBaseQuantity
        ? 'EXACT_ZERO_DELTA_BASELINE_VERIFIED' as const
        : 'EXPLICIT_BOUNDED_DUST_BASELINE_VERIFIED' as const;
    const reconciliation = Object.freeze({
      revision: exactEvidence.revision,
      evidenceDigest: sha256('m0-spot-flat-evidence', exactEvidence),
      canonicalStatus: 'EXACT' as const,
      ledgerState: 'MATCHED' as const,
      baseAsset: state.card.baseAsset,
      baselineRevision:
        state.readinessCard.baseline.baselineRevision!,
      baselineBaseQuantity,
      observedBaseQuantity,
      exchangeBaseTolerance:
        state.readinessCard.baseline.exchangeBaseTolerance!,
      residualQuantity: accounting.residualQuantity,
      residualDustNotionalQuote:
        accounting.residualDustNotionalQuote,
      residualCondition,
      quoteAsset: 'USDT' as const,
      baselineQuoteQuantity:
        state.readinessCard.baseline.baselineQuoteQuantity!,
      observedQuoteQuantity: exactEvidence.observedQuoteQuantity,
      quoteQuantityTolerance:
        state.readinessCard.baseline.quoteQuantityTolerance!,
      observedQuoteDelta: exactEvidence.observedQuoteDelta,
      sourceGrossQuoteDebit:
        accounting.quoteAccounting.sourceGrossQuoteDebit,
      flattenGrossQuoteCredit:
        accounting.quoteAccounting.flattenGrossQuoteCredit,
      observedGrossLifecycleTurnoverQuote:
        accounting.quoteAccounting.observedGrossLifecycleTurnoverQuote,
      authorizedFilledLifecycleTurnoverQuote:
        accounting.quoteAccounting.authorizedFilledLifecycleTurnoverQuote,
      favorableSellPriceImprovementQuote:
        accounting.quoteAccounting.favorableSellPriceImprovementQuote,
      referencePnlQuote:
        accounting.quoteAccounting.referencePnlQuote,
      signedSlippageCostQuote:
        accounting.quoteAccounting.signedSlippageCostQuote,
      quoteCommissionDebit:
        accounting.quoteAccounting.quoteCommissionDebit,
      fillDerivedQuoteCashflow:
        accounting.quoteAccounting.fillDerivedQuoteCashflow,
      realizedPnlAfterQuoteFees:
        accounting.quoteAccounting.realizedPnlAfterQuoteFees,
      quoteEquationResidual: exactEvidence.quoteEquationResidual,
      commissionTotals: accounting.quoteAccounting.commissionTotals,
      quoteCashflowStatus: 'EXACT_WITHIN_TOLERANCE' as const,
      quoteEconomicsStatus:
        accounting.quoteAccounting.quoteEconomicsStatus,
      thirdAssetCommissionQuoteValueStatus:
        accounting.quoteAccounting.thirdAssetCommissionQuoteValueStatus,
      thirdAssetCommissionQuoteValue: null,
      thirdAssetValuationDigest: null,
      flattenAttemptCount: accounting.attempts.length,
      durableMutationPosture: 'PROVEN_ABSENT' as const,
      reconciledAtMs: nowMs,
    });
    const next = frozenState({
      ...withoutStateDigest(state),
      revision: state.revision + 1,
      phase: 'DISARMED_SAFE',
      lifecycleLock: 'RELEASED',
      newEntryArmed: false,
      reconciliation,
      lastTransitionAtMs: nowMs,
      previousStateDigest: state.stateDigest,
    });
    const cas = this.#ledger.compareAndSetConfigValueAndLogEvents(
      M0_SPOT_LIFECYCLE_CONFIG_KEY,
      raw,
      serializeState(next),
      [
        event(
          'foundation.spot.reconciliation',
          state.card.symbol,
          Object.freeze({
            ...audit(
              state,
              next,
              'BASELINE_FLAT_RECONCILED',
              null,
              null,
              null,
            ),
            reconciliation,
            flatEvidence: exactEvidence,
          }),
        ),
        event(
          'system_integration.m0_spot.lifecycle_disarmed',
          state.card.symbol,
          Object.freeze({
            ...audit(
              state,
              next,
              'DISARMED_SAFE',
              null,
              null,
              null,
            ),
            secondEntryPossible: false,
            blindResendPossible: false,
            reconciliationEvidenceDigest:
              reconciliation.evidenceDigest,
            residualCondition: reconciliation.residualCondition,
            durableMutationPosture:
              reconciliation.durableMutationPosture,
          }),
        ),
      ],
    );
    if (committed(cas)) {
      return Object.freeze({
        disposition: 'COMMITTED_NEW' as const,
        state: next,
      });
    }
    const current = parseState(cas.currentValue);
    const sameEvidence =
      current?.phase === 'DISARMED_SAFE'
      && current.reconciliation?.evidenceDigest
        === reconciliation.evidenceDigest;
    return Object.freeze({
      disposition:
        sameEvidence
          ? 'REPLAY_QUERY_ONLY' as const
          : 'CONFLICT' as const,
      ...(sameEvidence
        ? {}
        : { code: cas.reason }),
      state: current!,
    }) as M0SpotLifecycleMutationResult;
  }
}

export function m0SpotLiveSubmitIntent(
  input: unknown,
): input is Readonly<SpotLiveSubmitIntent | SpotFlattenIntent> {
  return typeof input === 'object' && input !== null
    && (
      (input as { kind?: unknown }).kind === 'SUBMIT_LIVE_ORDER'
      || (input as { kind?: unknown }).kind === 'FLATTEN'
    );
}

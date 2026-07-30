/**
 * Foundation-owned dispatch contract for one owner-bounded M0 Spot lifecycle.
 *
 * This direct-import leaf contains inert request, authority, permit, and
 * transport contracts. It owns no signer, credential, network client,
 * persistence implementation, retry loop, mount, or composition capability.
 */
import { createHash } from 'node:crypto';

import { canonicalJson } from '../contracts/identity.js';
import type {
  M0SpotActionConsumptionReceipt,
  M0SpotEgressAction,
} from './m0SpotLifecycleCard.js';
import type {
  SpotCancelIntent,
  SpotFlattenIntent,
  SpotLiveSubmitIntent,
  SpotQueryByClientOrderIdIntent,
  SpotQueryFillsIntent,
  SpotSignedTestOrderIntent,
} from './spotPort.js';

export const BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA =
  'cosmos.live-edge.binance-spot-execution-adapter.v1' as const;
export const BINANCE_SPOT_DISPATCH_PERMIT_SCHEMA =
  'cosmos.live-edge.binance-spot-dispatch-permit.v1' as const;
export const BINANCE_SPOT_EGRESS_SPEND_SCHEMA =
  'cosmos.system-integration.binance-spot-egress-spend.v1' as const;

export type BinanceSpotExecutionContractId =
  | 'SPOT_TEST_ORDER_POST'
  | 'SPOT_ORDER_POST'
  | 'SPOT_ORDER_QUERY'
  | 'SPOT_ORDER_CANCEL'
  | 'SPOT_MY_TRADES_QUERY';

export type BinanceSpotExecutionOperation =
  | 'SIGNED_TEST'
  | 'SUBMIT'
  | 'QUERY_ORDER'
  | 'QUERY_FILLS'
  | 'CANCEL'
  | 'FLATTEN';

export type BinanceSpotCredentialProfile =
  | 'USER_DATA_READ'
  | 'SPOT_TRADE_EXECUTION';

export interface BinanceSpotSignedTransportRequest {
  readonly schema: typeof BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA;
  readonly operation: BinanceSpotExecutionOperation;
  readonly credentialProfile: BinanceSpotCredentialProfile;
  readonly contractId: BinanceSpotExecutionContractId;
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: '/api/v3/order' | '/api/v3/order/test' | '/api/v3/myTrades';
  readonly parameters: readonly (readonly [string, string])[];
  readonly automaticRetry: false;
  readonly transportCallsAuthorized: 1;
  readonly externalActionAuthorization: 'DURABLE_DISPATCH_PERMIT_REQUIRED';
}

export interface BinanceSpotDispatchLeaseFence {
  readonly status: 'ACTIVE';
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

export interface BinanceSpotDispatchPermit {
  readonly schema: typeof BINANCE_SPOT_DISPATCH_PERMIT_SCHEMA;
  readonly version: 1;
  readonly operation: BinanceSpotExecutionOperation;
  readonly credentialProfile: BinanceSpotCredentialProfile;
  readonly action: M0SpotEgressAction;
  readonly lifecycleId: `m0_lifecycle_${string}`;
  readonly cardDigest: `sha256:${string}`;
  readonly ticketId: string;
  readonly termsDigest: string;
  readonly clientOrderId: string;
  readonly requestDigest: `sha256:${string}`;
  readonly executionLease: Readonly<BinanceSpotDispatchLeaseFence>;
  readonly claimedAtMs: number;
  readonly claimedMonotonicMs: number;
  readonly dispatchDeadlineAtMs: number;
  readonly dispatchDeadlineMonotonicMs: number;
  readonly requestTimeoutMs: number;
  readonly recvWindowMs: number;
  readonly acceptanceSettlesAtMs: number;
  readonly acceptanceSettlesMonotonicMs: number;
  readonly receipt: Readonly<M0SpotActionConsumptionReceipt>;
  readonly dispatchCardinality: 'ONE';
  readonly automaticRetry: false;
  readonly externalActionAuthorization: 'DURABLE_ONE_USE_ACTION_CONSUMED';
  readonly permitDigest: `sha256:${string}`;
}

export type BinanceSpotSignedTransportOutcome =
  | {
      readonly kind: 'RESPONSE';
      readonly status: number;
      readonly body: unknown;
    }
  | {
      readonly kind: 'TIMEOUT' | 'DISCONNECTED';
      /**
       * A false value is documentary evidence only. Consumers still fail
       * closed because the venue outcome cannot be proved through this port.
       */
      readonly dispatched: boolean;
    };

export interface BinanceSpotSignedTransportPort {
  send(
    request: Readonly<BinanceSpotSignedTransportRequest>,
    permit: Readonly<BinanceSpotDispatchPermit>,
  ): Promise<Readonly<BinanceSpotSignedTransportOutcome>>;
}

export interface BinanceSpotEgressSpendRequest {
  readonly schema: typeof BINANCE_SPOT_EGRESS_SPEND_SCHEMA;
  readonly version: 1;
  readonly lifecycleId: `m0_lifecycle_${string}`;
  readonly authorizationId: string;
  readonly permitDigest: `sha256:${string}`;
  readonly requestDigest: `sha256:${string}`;
  readonly executionRequestId: `m0_req_${string}`;
  readonly clockFenceId: `m0_clock_fence_${string}`;
  readonly dispatchDeadlineAtMs: number;
  readonly dispatchDeadlineMonotonicMs: number;
}

export interface BinanceSpotEgressSpendReceipt
extends BinanceSpotEgressSpendRequest {
  readonly spentAtMs: number;
  readonly spentMonotonicMs: number;
  readonly state: 'SPENT_ONCE';
}

export interface BinanceSpotEgressConfirmRequest {
  readonly spend: Readonly<BinanceSpotEgressSpendReceipt>;
  readonly outcome: 'RESPONSE_RECEIVED' | 'AMBIGUOUS';
}

export interface BinanceSpotEgressSpendPort {
  /**
   * Atomically spends the exact permit immediately before network dispatch.
   * A replay, mismatch, stale fence/deadline, or persistence conflict returns
   * null and therefore cannot reach fetch.
   */
  spend(
    input: Readonly<BinanceSpotEgressSpendRequest>,
  ): Promise<Readonly<BinanceSpotEgressSpendReceipt> | null>;
  /**
   * Durably confirms the first transport result. A crash after spend and
   * before confirmation deliberately remains ambiguous for query recovery.
   */
  confirm(
    input: Readonly<BinanceSpotEgressConfirmRequest>,
  ): Promise<boolean>;
}

export type BinanceSpotDispatchIntent = Readonly<
  | SpotSignedTestOrderIntent
  | SpotLiveSubmitIntent
  | SpotQueryByClientOrderIdIntent
  | SpotQueryFillsIntent
  | SpotCancelIntent
  | SpotFlattenIntent
>;

export type BinanceSpotDispatchClaimAction =
  | M0SpotEgressAction
  | 'ACTIVE_ORDER_CANCEL';

export interface BinanceSpotDispatchClaim {
  readonly operation: BinanceSpotExecutionOperation;
  readonly action: BinanceSpotDispatchClaimAction;
  readonly request: Readonly<BinanceSpotSignedTransportRequest>;
  readonly intent: BinanceSpotDispatchIntent;
}

export interface BinanceSpotDispatchAuthorityPort {
  /**
   * Atomically claim a previously reserved action and return its exact
   * Ledger-backed receipt. Replay, mismatch, expiry, or persistence failure
   * returns null and therefore cannot reach the signed transport.
   */
  claimDispatch(
    input: Readonly<BinanceSpotDispatchClaim>,
  ): Promise<Readonly<BinanceSpotDispatchPermit> | null>;
}

export function calculateBinanceSpotDispatchRequestDigest(
  value: Readonly<BinanceSpotSignedTransportRequest>,
): `sha256:${string}` {
  return `sha256:${createHash('sha256')
    .update(
      `binance-spot-dispatch-request|${canonicalJson(value)}`,
      'utf8',
    )
    .digest('hex')}` as const;
}

export function calculateBinanceSpotDispatchPermitDigest(
  value: Readonly<Omit<BinanceSpotDispatchPermit, 'permitDigest'>>,
): `sha256:${string}` {
  return `sha256:${createHash('sha256')
    .update(
      `binance-spot-dispatch-permit|${canonicalJson(value)}`,
      'utf8',
    )
    .digest('hex')}` as const;
}

/**
 * Effect-boundary contract for canonical Binance Spot execution.
 *
 * This file contains types only. It performs no signing, I/O, credential
 * access, permission change, or exchange mutation. A later shared-seam adapter
 * may implement this port only after the governing readiness gates are true.
 */
import type { SpotExecutionTicket } from './spotTicket.js';

export type SpotVenueObservationStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EXPIRED_IN_MATCH';

export interface SpotSignedTestOrderIntent {
  readonly kind: 'SIGNED_TEST_ORDER';
  readonly ticketId: string;
  readonly termsDigest: string;
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly side: SpotExecutionTicket['side'];
  readonly type: SpotExecutionTicket['type'];
  readonly timeInForce: SpotExecutionTicket['timeInForce'];
  readonly quantity: string;
  readonly price: string | null;
  readonly filterSnapshotRevision: string;
  readonly createsVenueOrder: false;
  readonly liveSendAuthorized: false;
}

export interface SpotLiveSubmitIntent {
  readonly kind: 'SUBMIT_LIVE_ORDER';
  readonly ticketId: string;
  readonly termsDigest: string;
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly side: SpotExecutionTicket['side'];
  readonly type: SpotExecutionTicket['type'];
  readonly timeInForce: SpotExecutionTicket['timeInForce'];
  readonly quantity: string;
  readonly price: string | null;
  readonly ownerAuthorizationId: string;
  readonly signedTestEvidenceId: string;
  readonly filterSnapshotRevision: string;
  readonly singleUse: true;
  readonly automaticRetry: false;
}

export interface SpotQueryByClientOrderIdIntent {
  readonly kind: 'QUERY_BY_ORIGINAL_CLIENT_ORDER_ID';
  readonly ticketId: string;
  readonly symbol: string;
  readonly originalClientOrderId: string;
  readonly readOnly: true;
}

export interface SpotQueryFillsIntent {
  readonly kind: 'QUERY_FILLS';
  readonly ticketId: string;
  readonly symbol: string;
  readonly originalClientOrderId: string;
  readonly venueOrderId: string | null;
  readonly readOnly: true;
}

export interface SpotCancelIntent {
  readonly kind: 'CANCEL_BY_ORIGINAL_CLIENT_ORDER_ID';
  readonly ticketId: string;
  readonly symbol: string;
  readonly originalClientOrderId: string;
  readonly automaticRetry: false;
}

export interface SpotFlattenIntent {
  readonly kind: 'FLATTEN';
  readonly sourceTicketId: string;
  readonly flattenTicket: Readonly<SpotExecutionTicket>;
  readonly residualQuantity: string;
  readonly automaticRetry: false;
}

export type SpotMutationOutcome =
  | {
      readonly kind: 'ACKNOWLEDGED';
      readonly venueOrderId: string | null;
      readonly cumulativeFilledQuantity: string;
    }
  | {
      readonly kind: 'REJECTED';
      readonly venueCode: number | null;
      readonly reasonCode: string;
    }
  | {
      readonly kind: 'AMBIGUOUS';
      readonly reasonCode: string;
      readonly queryOriginalClientOrderId: string;
      readonly automaticRetry: false;
    };

export type SpotQueryOutcome =
  | {
      readonly kind: 'FOUND';
      readonly status: SpotVenueObservationStatus;
      readonly venueOrderId: string | null;
      readonly cumulativeFilledQuantity: string;
    }
  | {
      readonly kind: 'AUTHORITATIVE_NOT_FOUND';
      readonly originalClientOrderId: string;
    }
  | {
      readonly kind: 'UNRESOLVED';
      readonly reasonCode: string;
    };

export interface SpotFillObservation {
  readonly fillId: string;
  readonly venueOrderId: string;
  readonly price: string;
  readonly quantity: string;
  /** Exact venue `quoteQty`; never reconstructed at a persistence boundary. */
  readonly quoteQuantity: string;
  readonly commission: string;
  readonly commissionAsset: string;
  readonly occurredAtMs: number;
}

/**
 * The mutation methods accept only fully gated intents. Implementations must
 * still perform their own canonical validation; TypeScript shapes are not an
 * authorization mechanism.
 */
export interface BinanceSpotExecutionPort {
  signedTestOrder(
    intent: Readonly<SpotSignedTestOrderIntent>,
  ): Promise<SpotMutationOutcome>;
  submitLiveOrder(
    intent: Readonly<SpotLiveSubmitIntent>,
  ): Promise<SpotMutationOutcome>;
  queryByOriginalClientOrderId(
    intent: Readonly<SpotQueryByClientOrderIdIntent>,
  ): Promise<SpotQueryOutcome>;
  queryFills(
    intent: Readonly<SpotQueryFillsIntent>,
  ): Promise<readonly Readonly<SpotFillObservation>[]>;
  cancel(
    intent: Readonly<SpotCancelIntent>,
  ): Promise<SpotMutationOutcome>;
  flatten(
    intent: Readonly<SpotFlattenIntent>,
  ): Promise<SpotMutationOutcome>;
}

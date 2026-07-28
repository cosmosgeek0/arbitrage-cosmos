/**
 * Direct-import-only Binance Spot execution adapter.
 *
 * The adapter owns no credentials, signer, socket, HTTP client, retry loop, or
 * environment access. Its only effect is an injected, already-signed transport
 * call. Nothing exports this module from a shared barrel or mounts it live.
 */
import { types as nodeUtilTypes } from 'node:util';

import { normalizeSpotDecimal } from '../../../foundation/exchange/binanceSpot/filters.js';
import type {
  BinanceSpotExecutionPort,
  SpotCancelIntent,
  SpotFillObservation,
  SpotFlattenIntent,
  SpotLiveSubmitIntent,
  SpotMutationOutcome,
  SpotQueryByClientOrderIdIntent,
  SpotQueryFillsIntent,
  SpotQueryOutcome,
  SpotSignedTestOrderIntent,
  SpotVenueObservationStatus,
} from '../../../foundation/execution/spotPort.js';
import type { SpotExecutionTicket } from '../../../foundation/execution/spotTicket.js';

export const BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA =
  'cosmos.live-edge.binance-spot-execution-adapter.v1' as const;

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

export interface BinanceSpotSignedTransportRequest {
  readonly schema: typeof BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA;
  readonly operation: BinanceSpotExecutionOperation;
  readonly contractId: BinanceSpotExecutionContractId;
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: '/api/v3/order' | '/api/v3/order/test' | '/api/v3/myTrades';
  readonly parameters: readonly (readonly [string, string])[];
  readonly automaticRetry: false;
  readonly transportCallsAuthorized: 1;
  readonly externalActionAuthorization: 'INJECTED_INTENT_ONLY';
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
       * A false value is useful documentary evidence, but the adapter still
       * fails closed because it cannot prove what happened beyond its port.
       */
      readonly dispatched: boolean;
    };

export interface BinanceSpotSignedTransportPort {
  send(
    request: Readonly<BinanceSpotSignedTransportRequest>,
  ): Promise<Readonly<BinanceSpotSignedTransportOutcome>>;
}

export interface BinanceSpotExecutionAdapterPorts
  extends BinanceSpotSignedTransportPort {
  /**
   * Independent canonical proof checks. Absence, throw, or any value other
   * than exact true keeps the corresponding venue mutation closed.
   */
  verifyLiveSubmitIntent(
    intent: Readonly<SpotLiveSubmitIntent>,
  ): boolean;
  verifyFlattenIntent(intent: Readonly<SpotFlattenIntent>): boolean;
  verifyCancelIntent(intent: Readonly<SpotCancelIntent>): boolean;
}

type DataRecord = Readonly<Record<string, unknown>>;

const SYMBOL = /^[A-Z0-9]{1,64}$/u;
const CLIENT_ORDER_ID = /^[.A-Z:/a-z0-9_-]{1,36}$/u;
const TEXT_ID = /^[A-Za-z0-9_.:-]{1,256}$/u;
const VENUE_STATUSES = new Set<SpotVenueObservationStatus>([
  'NEW',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELED',
  'REJECTED',
  'EXPIRED',
  'EXPIRED_IN_MATCH',
]);
const SIDES = new Set(['BUY', 'SELL']);
const TYPES = new Set(['LIMIT', 'MARKET']);
const TIME_IN_FORCE = new Set(['GTC', 'IOC', 'FOK']);

function snapshotRecord(value: unknown): DataRecord | null {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      nodeUtilTypes.isProxy(value)
    ) {
      return null;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') return null;
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) {
        return null;
      }
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function snapshotArray(value: unknown, maximum = 1_000): readonly unknown[] | null {
  try {
    if (
      !Array.isArray(value) ||
      nodeUtilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maximum
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) {
        return null;
      }
      output.push(descriptor.value);
    }
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function requireIdentity(value: unknown, label: string): string {
  if (typeof value !== 'string' || !TEXT_ID.test(value)) {
    throw new TypeError(`${label} is malformed`);
  }
  return value;
}

function requireSymbol(value: unknown): string {
  if (typeof value !== 'string' || !SYMBOL.test(value)) {
    throw new TypeError('symbol is malformed');
  }
  return value;
}

function requireClientOrderId(value: unknown): string {
  if (typeof value !== 'string' || !CLIENT_ORDER_ID.test(value)) {
    throw new TypeError('client order ID is malformed');
  }
  return value;
}

function decimal(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} is malformed`);
  return normalizeSpotDecimal(value, label);
}

function positiveDecimal(value: unknown, label: string): string {
  const normalized = decimal(value, label);
  if (normalized === '0') throw new TypeError(`${label} must be positive`);
  return normalized;
}

function venueId(value: unknown): string | null {
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return String(value);
  }
  if (typeof value === 'string' && /^[0-9]{1,40}$/u.test(value)) return value;
  return null;
}

function errorCode(body: unknown): number | null {
  const record = snapshotRecord(body);
  return record !== null &&
    typeof record.code === 'number' &&
    Number.isSafeInteger(record.code)
    ? record.code
    : null;
}

function freezeParameters(
  values: readonly (readonly [string, string])[],
): readonly (readonly [string, string])[] {
  return Object.freeze(
    values.map(([name, value]) => Object.freeze([name, value] as const)),
  );
}

function orderParameters(
  intent: Readonly<
    SpotSignedTestOrderIntent | SpotLiveSubmitIntent | SpotExecutionTicket
  >,
): readonly (readonly [string, string])[] {
  requireIdentity(intent.ticketId, 'ticketId');
  requireIdentity(intent.termsDigest, 'termsDigest');
  if (!SIDES.has(intent.side) || !TYPES.has(intent.type)) {
    throw new TypeError('order side or type is invalid');
  }
  const values: (readonly [string, string])[] = [
    ['symbol', requireSymbol(intent.symbol)],
    ['side', intent.side],
    ['type', intent.type],
    ['quantity', positiveDecimal(intent.quantity, 'quantity')],
    ['newClientOrderId', requireClientOrderId(intent.clientOrderId)],
    ['newOrderRespType', 'RESULT'],
  ];
  if (intent.type === 'LIMIT') {
    if (
      intent.timeInForce === null ||
      !TIME_IN_FORCE.has(intent.timeInForce) ||
      intent.price === null
    ) {
      throw new TypeError('LIMIT order fields are incomplete');
    }
    values.push(
      ['timeInForce', intent.timeInForce],
      ['price', positiveDecimal(intent.price, 'price')],
    );
  } else if (intent.timeInForce !== null || intent.price !== null) {
    throw new TypeError('MARKET order fields are invalid');
  }
  return freezeParameters(values);
}

function request(
  operation: BinanceSpotExecutionOperation,
  contractId: BinanceSpotExecutionContractId,
  method: BinanceSpotSignedTransportRequest['method'],
  path: BinanceSpotSignedTransportRequest['path'],
  parameters: readonly (readonly [string, string])[],
): Readonly<BinanceSpotSignedTransportRequest> {
  return Object.freeze({
    schema: BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
    operation,
    contractId,
    method,
    path,
    parameters,
    automaticRetry: false as const,
    transportCallsAuthorized: 1 as const,
    externalActionAuthorization: 'INJECTED_INTENT_ONLY' as const,
  });
}

function ambiguous(
  reasonCode: string,
  clientOrderId: string,
): Readonly<SpotMutationOutcome> {
  return Object.freeze({
    kind: 'AMBIGUOUS' as const,
    reasonCode,
    queryOriginalClientOrderId: clientOrderId,
    automaticRetry: false as const,
  });
}

function rejected(
  venueCode: number | null,
  reasonCode: string,
): Readonly<SpotMutationOutcome> {
  return Object.freeze({
    kind: 'REJECTED' as const,
    venueCode,
    reasonCode,
  });
}

function transportAmbiguity(
  outcome: Readonly<BinanceSpotSignedTransportOutcome>,
  clientOrderId: string,
): Readonly<SpotMutationOutcome> | null {
  if (outcome.kind !== 'RESPONSE') {
    return ambiguous(
      outcome.kind === 'TIMEOUT'
        ? 'TRANSPORT_TIMEOUT_STATUS_UNKNOWN'
        : 'TRANSPORT_DISCONNECTED_STATUS_UNKNOWN',
      clientOrderId,
    );
  }
  const code = errorCode(outcome.body);
  if (code === -1006 || code === -1007) {
    return ambiguous(`BINANCE_${code}_STATUS_UNKNOWN`, clientOrderId);
  }
  if (outcome.status === 408 || outcome.status >= 500) {
    return ambiguous(`HTTP_${outcome.status}_STATUS_UNKNOWN`, clientOrderId);
  }
  return null;
}

function acknowledgedOrder(
  outcome: Readonly<BinanceSpotSignedTransportOutcome>,
  clientOrderId: string,
  expectedSymbol: string,
): Readonly<SpotMutationOutcome> {
  const uncertainty = transportAmbiguity(outcome, clientOrderId);
  if (uncertainty !== null) return uncertainty;
  if (outcome.kind !== 'RESPONSE') {
    return ambiguous('TRANSPORT_STATUS_UNKNOWN', clientOrderId);
  }
  const code = errorCode(outcome.body);
  if (outcome.status < 200 || outcome.status >= 300) {
    return rejected(
      code,
      code === null ? `HTTP_${outcome.status}` : `BINANCE_${code}`,
    );
  }
  const body = snapshotRecord(outcome.body);
  const orderId = body === null ? null : venueId(body.orderId);
  if (
    body === null ||
    orderId === null ||
    body.symbol !== expectedSymbol ||
    typeof body.clientOrderId !== 'string' ||
    body.clientOrderId !== clientOrderId ||
    typeof body.status !== 'string' ||
    !VENUE_STATUSES.has(body.status as SpotVenueObservationStatus)
  ) {
    return ambiguous('MALFORMED_SUCCESS_STATUS_UNKNOWN', clientOrderId);
  }
  try {
    return Object.freeze({
      kind: 'ACKNOWLEDGED' as const,
      venueOrderId: orderId,
      cumulativeFilledQuantity: decimal(
        body.executedQty,
        'executed quantity',
      ),
    });
  } catch {
    return ambiguous('MALFORMED_SUCCESS_STATUS_UNKNOWN', clientOrderId);
  }
}

function acknowledgedCancellation(
  outcome: Readonly<BinanceSpotSignedTransportOutcome>,
  clientOrderId: string,
  expectedSymbol: string,
): Readonly<SpotMutationOutcome> {
  const uncertainty = transportAmbiguity(outcome, clientOrderId);
  if (uncertainty !== null) return uncertainty;
  if (outcome.kind !== 'RESPONSE') {
    return ambiguous('CANCEL_TRANSPORT_STATUS_UNKNOWN', clientOrderId);
  }
  const code = errorCode(outcome.body);
  if (outcome.status < 200 || outcome.status >= 300) {
    return rejected(
      code,
      code === null ? `HTTP_${outcome.status}` : `BINANCE_${code}`,
    );
  }
  const body = snapshotRecord(outcome.body);
  const orderId = body === null ? null : venueId(body.orderId);
  if (
    body === null ||
    body.symbol !== expectedSymbol ||
    body.origClientOrderId !== clientOrderId ||
    body.status !== 'CANCELED' ||
    orderId === null
  ) {
    return ambiguous('CANCEL_SUCCESS_NOT_TERMINAL', clientOrderId);
  }
  try {
    return Object.freeze({
      kind: 'ACKNOWLEDGED' as const,
      venueOrderId: orderId,
      cumulativeFilledQuantity: decimal(
        body.executedQty,
        'cancel executed quantity',
      ),
    });
  } catch {
    return ambiguous('CANCEL_SUCCESS_NOT_TERMINAL', clientOrderId);
  }
}

function acceptedSignedTest(
  outcome: Readonly<BinanceSpotSignedTransportOutcome>,
  clientOrderId: string,
): Readonly<SpotMutationOutcome> {
  const uncertainty = transportAmbiguity(outcome, clientOrderId);
  if (uncertainty !== null) return uncertainty;
  if (outcome.kind !== 'RESPONSE') {
    return ambiguous('SIGNED_TEST_TRANSPORT_UNKNOWN', clientOrderId);
  }
  const code = errorCode(outcome.body);
  if (outcome.status < 200 || outcome.status >= 300) {
    return rejected(
      code,
      code === null ? `HTTP_${outcome.status}` : `BINANCE_${code}`,
    );
  }
  const body = snapshotRecord(outcome.body);
  if (
    body === null ||
    ['orderId', 'clientOrderId', 'executedQty', 'status'].some((key) =>
      Object.prototype.hasOwnProperty.call(body, key),
    )
  ) {
    return rejected(null, 'SIGNED_TEST_RESPONSE_CLAIMS_VENUE_ORDER');
  }
  return Object.freeze({
    kind: 'ACKNOWLEDGED' as const,
    venueOrderId: null,
    cumulativeFilledQuantity: '0',
  });
}

async function sendMutation(
  transport: Readonly<BinanceSpotSignedTransportPort>,
  value: Readonly<BinanceSpotSignedTransportRequest>,
  clientOrderId: string,
  parse: (
    outcome: Readonly<BinanceSpotSignedTransportOutcome>,
    clientOrderId: string,
  ) => Readonly<SpotMutationOutcome>,
): Promise<Readonly<SpotMutationOutcome>> {
  try {
    return parse(await transport.send(value), clientOrderId);
  } catch {
    return ambiguous('TRANSPORT_THROW_STATUS_UNKNOWN', clientOrderId);
  }
}

/**
 * Build an unmounted implementation of the frozen Spot execution port.
 * Every method invokes the injected signed transport at most once.
 */
export function createBinanceSpotExecutionAdapter(
  transport: Readonly<BinanceSpotExecutionAdapterPorts>,
): BinanceSpotExecutionPort {
  if (
    typeof transport?.send !== 'function' ||
    typeof transport.verifyLiveSubmitIntent !== 'function' ||
    typeof transport.verifyFlattenIntent !== 'function' ||
    typeof transport.verifyCancelIntent !== 'function'
  ) {
    throw new TypeError('signed transport and canonical proof ports are required');
  }

  return Object.freeze({
    async signedTestOrder(intent: Readonly<SpotSignedTestOrderIntent>) {
      if (
        intent.createsVenueOrder !== false ||
        intent.liveSendAuthorized !== false
      ) {
        return rejected(null, 'SIGNED_TEST_INTENT_INVALID');
      }
      const parameters = orderParameters(intent);
      return sendMutation(
        transport,
        request(
          'SIGNED_TEST',
          'SPOT_TEST_ORDER_POST',
          'POST',
          '/api/v3/order/test',
          parameters,
        ),
        intent.clientOrderId,
        acceptedSignedTest,
      );
    },

    async submitLiveOrder(intent: Readonly<SpotLiveSubmitIntent>) {
      let independentlyVerified = false;
      try {
        independentlyVerified = transport.verifyLiveSubmitIntent(intent) === true;
      } catch {
        independentlyVerified = false;
      }
      if (
        !independentlyVerified ||
        intent.singleUse !== true ||
        intent.automaticRetry !== false ||
        !requireIdentity(intent.ownerAuthorizationId, 'owner authorization') ||
        !requireIdentity(intent.signedTestEvidenceId, 'signed test evidence')
      ) {
        return rejected(null, 'LIVE_SUBMIT_INTENT_INVALID');
      }
      const parameters = orderParameters(intent);
      return sendMutation(
        transport,
        request(
          'SUBMIT',
          'SPOT_ORDER_POST',
          'POST',
          '/api/v3/order',
          parameters,
        ),
        intent.clientOrderId,
        (outcome, clientOrderId) =>
          acknowledgedOrder(outcome, clientOrderId, intent.symbol),
      );
    },

    async queryByOriginalClientOrderId(
      intent: Readonly<SpotQueryByClientOrderIdIntent>,
    ) {
      requireIdentity(intent.ticketId, 'ticketId');
      const symbol = requireSymbol(intent.symbol);
      const clientOrderId = requireClientOrderId(
        intent.originalClientOrderId,
      );
      if (intent.readOnly !== true) {
        return Object.freeze({
          kind: 'UNRESOLVED' as const,
          reasonCode: 'QUERY_INTENT_INVALID',
        });
      }
      let outcome: Readonly<BinanceSpotSignedTransportOutcome>;
      try {
        outcome = await transport.send(
          request(
            'QUERY_ORDER',
            'SPOT_ORDER_QUERY',
            'GET',
            '/api/v3/order',
            freezeParameters([
              ['symbol', symbol],
              ['origClientOrderId', clientOrderId],
            ]),
          ),
        );
      } catch {
        return Object.freeze({
          kind: 'UNRESOLVED' as const,
          reasonCode: 'QUERY_TRANSPORT_THROW',
        });
      }
      if (outcome.kind !== 'RESPONSE') {
        return Object.freeze({
          kind: 'UNRESOLVED' as const,
          reasonCode: `QUERY_${outcome.kind}`,
        });
      }
      const code = errorCode(outcome.body);
      if (
        code === -2013 &&
        outcome.status >= 400 &&
        outcome.status < 500 &&
        outcome.status !== 408
      ) {
        return Object.freeze({
          kind: 'AUTHORITATIVE_NOT_FOUND' as const,
          originalClientOrderId: clientOrderId,
        });
      }
      if (outcome.status < 200 || outcome.status >= 300) {
        return Object.freeze({
          kind: 'UNRESOLVED' as const,
          reasonCode:
            code === null ? `QUERY_HTTP_${outcome.status}` : `BINANCE_${code}`,
        });
      }
      const body = snapshotRecord(outcome.body);
      const orderId = body === null ? null : venueId(body.orderId);
      if (
        body === null ||
        body.symbol !== symbol ||
        body.clientOrderId !== clientOrderId ||
        orderId === null ||
        typeof body.status !== 'string' ||
        !VENUE_STATUSES.has(body.status as SpotVenueObservationStatus)
      ) {
        return Object.freeze({
          kind: 'UNRESOLVED' as const,
          reasonCode: 'QUERY_RESPONSE_INVALID',
        });
      }
      try {
        return Object.freeze({
          kind: 'FOUND' as const,
          status: body.status as SpotVenueObservationStatus,
          venueOrderId: orderId,
          cumulativeFilledQuantity: decimal(
            body.executedQty,
            'executed quantity',
          ),
        });
      } catch {
        return Object.freeze({
          kind: 'UNRESOLVED' as const,
          reasonCode: 'QUERY_RESPONSE_INVALID',
        });
      }
    },

    async queryFills(
      intent: Readonly<SpotQueryFillsIntent>,
    ): Promise<readonly Readonly<SpotFillObservation>[]> {
      requireIdentity(intent.ticketId, 'ticketId');
      const symbol = requireSymbol(intent.symbol);
      requireClientOrderId(intent.originalClientOrderId);
      if (intent.readOnly !== true) throw new TypeError('fill query is not read-only');
      const orderId =
        intent.venueOrderId === null ? null : venueId(intent.venueOrderId);
      if (orderId === null) {
        throw new TypeError('exact venue order ID is required for fill query');
      }
      const parameters: (readonly [string, string])[] = [
        ['symbol', symbol],
        ['orderId', orderId],
      ];
      let outcome: Readonly<BinanceSpotSignedTransportOutcome>;
      try {
        outcome = await transport.send(
          request(
            'QUERY_FILLS',
            'SPOT_MY_TRADES_QUERY',
            'GET',
            '/api/v3/myTrades',
            freezeParameters(parameters),
          ),
        );
      } catch {
        throw new TypeError('fill query transport failed');
      }
      if (
        outcome.kind !== 'RESPONSE' ||
        outcome.status < 200 ||
        outcome.status >= 300
      ) {
        throw new TypeError('fill query unresolved');
      }
      const rows = snapshotArray(outcome.body);
      if (rows === null) throw new TypeError('fill query response is malformed');
      const fills = rows.map((value): Readonly<SpotFillObservation> => {
        const row = snapshotRecord(value);
        const rowOrderId = row === null ? null : venueId(row.orderId);
        const fillId = row === null ? null : venueId(row.id);
        if (
          row === null ||
          row.symbol !== symbol ||
          rowOrderId === null ||
          fillId === null ||
          (orderId !== null && rowOrderId !== orderId) ||
          typeof row.commissionAsset !== 'string' ||
          !/^[A-Z0-9]{1,32}$/u.test(row.commissionAsset) ||
          !Number.isSafeInteger(row.time) ||
          (row.time as number) < 0
        ) {
          throw new TypeError('fill query row is malformed');
        }
        return Object.freeze({
          fillId,
          venueOrderId: rowOrderId,
          price: decimal(row.price, 'fill price'),
          quantity: positiveDecimal(row.qty, 'fill quantity'),
          commission: decimal(row.commission, 'fill commission'),
          commissionAsset: row.commissionAsset,
          occurredAtMs: row.time as number,
        });
      });
      return Object.freeze(fills);
    },

    async cancel(intent: Readonly<SpotCancelIntent>) {
      let independentlyVerified = false;
      try {
        independentlyVerified = transport.verifyCancelIntent(intent) === true;
      } catch {
        independentlyVerified = false;
      }
      if (!independentlyVerified || intent.automaticRetry !== false) {
        return rejected(null, 'CANCEL_INTENT_INVALID');
      }
      requireIdentity(intent.ticketId, 'ticketId');
      const symbol = requireSymbol(intent.symbol);
      const clientOrderId = requireClientOrderId(
        intent.originalClientOrderId,
      );
      return sendMutation(
        transport,
        request(
          'CANCEL',
          'SPOT_ORDER_CANCEL',
          'DELETE',
          '/api/v3/order',
          freezeParameters([
            ['symbol', symbol],
            ['origClientOrderId', clientOrderId],
          ]),
        ),
        clientOrderId,
        (outcome, originalClientOrderId) =>
          acknowledgedCancellation(
            outcome,
            originalClientOrderId,
            symbol,
          ),
      );
    },

    async flatten(intent: Readonly<SpotFlattenIntent>) {
      let independentlyVerified = false;
      try {
        independentlyVerified = transport.verifyFlattenIntent(intent) === true;
      } catch {
        independentlyVerified = false;
      }
      if (
        !independentlyVerified ||
        intent.automaticRetry !== false ||
        intent.flattenTicket.purpose !== 'FLATTEN' ||
        intent.flattenTicket.side !== 'SELL' ||
        decimal(intent.residualQuantity, 'residual quantity') !==
          decimal(intent.flattenTicket.quantity, 'flatten quantity')
      ) {
        return rejected(null, 'FLATTEN_INTENT_INVALID');
      }
      requireIdentity(intent.sourceTicketId, 'source ticket ID');
      return sendMutation(
        transport,
        request(
          'FLATTEN',
          'SPOT_ORDER_POST',
          'POST',
          '/api/v3/order',
          orderParameters(intent.flattenTicket),
        ),
        intent.flattenTicket.clientOrderId,
        (outcome, clientOrderId) =>
          acknowledgedOrder(
            outcome,
            clientOrderId,
            intent.flattenTicket.symbol,
          ),
      );
    },
  });
}

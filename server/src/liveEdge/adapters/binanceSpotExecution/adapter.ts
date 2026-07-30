/**
 * Direct-import-only Binance Spot execution adapter.
 *
 * The adapter owns no credentials, signer, socket, HTTP client, retry loop, or
 * environment access. Its only effect is an injected signed transport call
 * after a separate durable authority owner returns an exact one-use dispatch
 * permit. Nothing exports this module from a shared barrel.
 */
import { types as nodeUtilTypes } from 'node:util';

import {
  multiplySpotDecimals,
  normalizeSpotDecimal,
} from '../../../foundation/exchange/binanceSpot/filters.js';
import {
  BINANCE_SPOT_DISPATCH_PERMIT_SCHEMA,
  BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
  calculateBinanceSpotDispatchRequestDigest,
} from '../../../foundation/execution/m0SpotDispatch.js';
import type {
  BinanceSpotDispatchAuthorityPort,
  BinanceSpotDispatchClaimAction,
  BinanceSpotDispatchIntent,
  BinanceSpotDispatchPermit,
  BinanceSpotCredentialProfile,
  BinanceSpotExecutionContractId,
  BinanceSpotExecutionOperation,
  BinanceSpotSignedTransportOutcome,
  BinanceSpotSignedTransportPort,
  BinanceSpotSignedTransportRequest,
} from '../../../foundation/execution/m0SpotDispatch.js';
import {
  calculateM0SpotIntentDigest,
  M0_SPOT_ACTION_CONSUMPTION_SCHEMA,
} from '../../../foundation/execution/m0SpotLifecycleCard.js';
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

export interface BinanceSpotExecutionAdapterPorts {
  readonly transport: Readonly<BinanceSpotSignedTransportPort>;
  readonly authority: Readonly<BinanceSpotDispatchAuthorityPort>;
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
  const credentialProfile: BinanceSpotCredentialProfile =
    operation === 'QUERY_ORDER' || operation === 'QUERY_FILLS'
      ? 'USER_DATA_READ'
      : 'SPOT_TRADE_EXECUTION';
  return Object.freeze({
    schema: BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
    operation,
    credentialProfile,
    contractId,
    method,
    path,
    parameters,
    automaticRetry: false as const,
    transportCallsAuthorized: 1 as const,
    externalActionAuthorization:
      'DURABLE_DISPATCH_PERMIT_REQUIRED' as const,
  });
}

function intentDispatchIdentity(
  intent: BinanceSpotDispatchIntent,
): Readonly<{
  ticketId: string;
  termsDigest: string | null;
  clientOrderId: string;
}> {
  if (intent.kind === 'FLATTEN') {
    return Object.freeze({
      ticketId: intent.flattenTicket.ticketId,
      termsDigest: intent.flattenTicket.termsDigest,
      clientOrderId: intent.flattenTicket.clientOrderId,
    });
  }
  if (
    intent.kind === 'SIGNED_TEST_ORDER'
    || intent.kind === 'SUBMIT_LIVE_ORDER'
  ) {
    return Object.freeze({
      ticketId: intent.ticketId,
      termsDigest: intent.termsDigest,
      clientOrderId: intent.clientOrderId,
    });
  }
  return Object.freeze({
    ticketId: intent.ticketId,
    termsDigest: null,
    clientOrderId: intent.originalClientOrderId,
  });
}

function exactDispatchPermit(
  permit: Readonly<BinanceSpotDispatchPermit> | null,
  operation: BinanceSpotExecutionOperation,
  action: BinanceSpotDispatchClaimAction,
  value: Readonly<BinanceSpotSignedTransportRequest>,
  intent: BinanceSpotDispatchIntent,
): permit is Readonly<BinanceSpotDispatchPermit> {
  if (permit === null) return false;
  const identity = intentDispatchIdentity(intent);
  const receipt = permit.receipt;
  const actionMatches = action === 'ACTIVE_ORDER_CANCEL'
    ? permit.action === 'ENTRY_CANCEL'
      || permit.action === 'FLATTEN_CANCEL'
    : permit.action === action;
  return (
    permit.schema === BINANCE_SPOT_DISPATCH_PERMIT_SCHEMA
    && permit.version === 1
    && permit.operation === operation
    && permit.credentialProfile === value.credentialProfile
    && actionMatches
    && permit.ticketId === identity.ticketId
    && (
      identity.termsDigest === null
      || permit.termsDigest === identity.termsDigest
    )
    && permit.clientOrderId === identity.clientOrderId
    && permit.requestDigest
      === calculateBinanceSpotDispatchRequestDigest(value)
    && permit.dispatchCardinality === 'ONE'
    && permit.automaticRetry === false
    && permit.externalActionAuthorization
      === 'DURABLE_ONE_USE_ACTION_CONSUMED'
    && receipt.schema === M0_SPOT_ACTION_CONSUMPTION_SCHEMA
    && receipt.version === 1
    && receipt.lifecycleId === permit.lifecycleId
    && receipt.cardDigest === permit.cardDigest
    && receipt.action === permit.action
    && receipt.ticketId === permit.ticketId
    && receipt.termsDigest === permit.termsDigest
    && receipt.clientOrderId === permit.clientOrderId
    && receipt.intentDigest === calculateM0SpotIntentDigest(intent)
    && receipt.state === 'CONSUMED_ONCE'
    && receipt.authorizationReuseAllowed === false
  );
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
  ports: Readonly<BinanceSpotExecutionAdapterPorts>,
  operation: BinanceSpotExecutionOperation,
  action: BinanceSpotDispatchClaimAction,
  intent: Readonly<
    | SpotSignedTestOrderIntent
    | SpotLiveSubmitIntent
    | SpotCancelIntent
    | SpotFlattenIntent
  >,
  value: Readonly<BinanceSpotSignedTransportRequest>,
  clientOrderId: string,
  parse: (
    outcome: Readonly<BinanceSpotSignedTransportOutcome>,
    clientOrderId: string,
  ) => Readonly<SpotMutationOutcome>,
): Promise<Readonly<SpotMutationOutcome>> {
  try {
    const permit = await ports.authority.claimDispatch({
      operation,
      action,
      request: value,
      intent,
    });
    if (!exactDispatchPermit(
      permit,
      operation,
      action,
      value,
      intent,
    )) {
      return rejected(null, 'DURABLE_ACTION_AUTHORITY_NOT_CONSUMED');
    }
    return parse(
      await ports.transport.send(value, permit),
      clientOrderId,
    );
  } catch {
    return ambiguous('TRANSPORT_THROW_STATUS_UNKNOWN', clientOrderId);
  }
}

/**
 * Build the bounded Spot execution adapter. Capability construction is not a
 * mount: every dispatch still requires an independent, durable, exact
 * one-use claim. Every method invokes the signed transport at most once.
 */
export function createBinanceSpotExecutionAdapter(
  ports: Readonly<BinanceSpotExecutionAdapterPorts>,
): BinanceSpotExecutionPort {
  if (
    typeof ports?.transport?.send !== 'function'
    || typeof ports?.authority?.claimDispatch !== 'function'
    || ports.transport === (ports.authority as unknown)
  ) {
    throw new TypeError(
      'separate signed transport and durable authority ports are required',
    );
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
        ports,
        'SIGNED_TEST',
        'SIGNED_TEST',
        intent,
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
      if (
        intent.singleUse !== true ||
        intent.automaticRetry !== false ||
        !requireIdentity(intent.ownerAuthorizationId, 'owner authorization') ||
        !requireIdentity(intent.signedTestEvidenceId, 'signed test evidence')
      ) {
        return rejected(null, 'LIVE_SUBMIT_INTENT_INVALID');
      }
      const parameters = orderParameters(intent);
      return sendMutation(
        ports,
        'SUBMIT',
        'ENTRY',
        intent,
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
        const transportRequest = request(
          'QUERY_ORDER',
          'SPOT_ORDER_QUERY',
          'GET',
          '/api/v3/order',
          freezeParameters([
            ['symbol', symbol],
            ['origClientOrderId', clientOrderId],
          ]),
        );
        const permit = await ports.authority.claimDispatch({
          operation: 'QUERY_ORDER',
          action: 'QUERY_ORDER',
          request: transportRequest,
          intent,
        });
        if (!exactDispatchPermit(
          permit,
          'QUERY_ORDER',
          'QUERY_ORDER',
          transportRequest,
          intent,
        )) {
          return Object.freeze({
            kind: 'UNRESOLVED' as const,
            reasonCode: 'QUERY_DURABLE_AUTHORITY_NOT_CONSUMED',
          });
        }
        outcome = await ports.transport.send(transportRequest, permit);
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
        const transportRequest = request(
          'QUERY_FILLS',
          'SPOT_MY_TRADES_QUERY',
          'GET',
          '/api/v3/myTrades',
          freezeParameters(parameters),
        );
        const permit = await ports.authority.claimDispatch({
          operation: 'QUERY_FILLS',
          action: 'QUERY_FILLS',
          request: transportRequest,
          intent,
        });
        if (!exactDispatchPermit(
          permit,
          'QUERY_FILLS',
          'QUERY_FILLS',
          transportRequest,
          intent,
        )) throw new TypeError('fill query authority is unavailable');
        outcome = await ports.transport.send(transportRequest, permit);
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
        const price = decimal(row.price, 'fill price');
        const quantity = positiveDecimal(row.qty, 'fill quantity');
        const quoteQuantity = decimal(
          row.quoteQty,
          'fill quote quantity',
        );
        if (
          quoteQuantity !== multiplySpotDecimals(price, quantity)
        ) {
          throw new TypeError(
            'fill quote quantity does not equal exact price times quantity',
          );
        }
        return Object.freeze({
          fillId,
          venueOrderId: rowOrderId,
          price,
          quantity,
          quoteQuantity,
          commission: decimal(row.commission, 'fill commission'),
          commissionAsset: row.commissionAsset,
          occurredAtMs: row.time as number,
        });
      });
      return Object.freeze(fills);
    },

    async cancel(intent: Readonly<SpotCancelIntent>) {
      if (intent.automaticRetry !== false) {
        return rejected(null, 'CANCEL_INTENT_INVALID');
      }
      requireIdentity(intent.ticketId, 'ticketId');
      const symbol = requireSymbol(intent.symbol);
      const clientOrderId = requireClientOrderId(
        intent.originalClientOrderId,
      );
      return sendMutation(
        ports,
        'CANCEL',
        'ACTIVE_ORDER_CANCEL',
        intent,
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
      if (
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
        ports,
        'FLATTEN',
        'FLATTEN',
        intent,
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

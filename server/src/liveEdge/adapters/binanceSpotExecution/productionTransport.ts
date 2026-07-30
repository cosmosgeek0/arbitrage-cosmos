/**
 * Narrow Binance Spot production transport for the owner-bounded M0 lifecycle.
 *
 * Construction is inert. The caller must inject separate USER_DATA-read and
 * Spot-TRADE signers, a fetch implementation, trusted clock, one exact symbol,
 * and a durable one-use dispatch permit for every request. There is no
 * combined credential profile, environment access, global fetch fallback,
 * time-sync retry, endpoint retry, cancel-all, Futures, Margin, borrow,
 * withdrawal, or transfer capability.
 */
import { types as nodeUtilTypes } from 'node:util';

import {
  compareSpotDecimals,
  multiplySpotDecimals,
  normalizeSpotDecimal,
} from '../../../foundation/exchange/binanceSpot/filters.js';
import {
  OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
} from '../../../foundation/risk/spotRiskPolicy.js';
import {
  BINANCE_SPOT_DISPATCH_PERMIT_SCHEMA,
  BINANCE_SPOT_EGRESS_SPEND_SCHEMA,
  BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
  calculateBinanceSpotDispatchPermitDigest,
  calculateBinanceSpotDispatchRequestDigest,
} from '../../../foundation/execution/m0SpotDispatch.js';
import type {
  BinanceSpotCredentialProfile,
  BinanceSpotDispatchPermit,
  BinanceSpotEgressSpendPort,
  BinanceSpotEgressSpendReceipt,
  BinanceSpotEgressSpendRequest,
  BinanceSpotExecutionOperation,
  BinanceSpotSignedTransportOutcome,
  BinanceSpotSignedTransportPort,
  BinanceSpotSignedTransportRequest,
} from '../../../foundation/execution/m0SpotDispatch.js';
import {
  M0_SPOT_ACTION_CONSUMPTION_SCHEMA,
} from '../../../foundation/execution/m0SpotLifecycleCard.js';

export const M0_SPOT_PRODUCTION_TRANSPORT_SCHEMA =
  'cosmos.binance.m0-spot-production-transport.v1' as const;

const ORIGIN = 'https://api.binance.com' as const;
const REQUEST_FIELDS = Object.freeze([
  'schema',
  'operation',
  'credentialProfile',
  'contractId',
  'method',
  'path',
  'parameters',
  'automaticRetry',
  'transportCallsAuthorized',
  'externalActionAuthorization',
] as const);
const SYMBOL = /^[A-Z0-9]{4,20}$/u;
const CLIENT_ORDER_ID = /^[A-Za-z0-9_-]{1,36}$/u;
const PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const HMAC_SIGNATURE = /^[0-9a-f]{64}$/u;
const ED25519_SIGNATURE = /^[A-Za-z0-9+/=_-]{64,512}$/u;
const API_KEY = /^[^\p{Cc}\p{Zl}\p{Zp}]{16,256}$/u;
const MAX_QUERY_BYTES = 8 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_PARAMETERS = 12;

type PlainRecord = Readonly<Record<string, unknown>>;

export interface M0SpotProductionClock {
  nowMs(): number;
  monotonicMs(): number;
  clockFenceId(): `m0_clock_fence_${string}`;
}

export interface M0SpotProductionSigner {
  readonly algorithm: 'ED25519' | 'HMAC_SHA256';
  readonly apiKey: string;
  sign(payload: string): Promise<string>;
}

export interface M0SpotProductionTransportOptions {
  readonly allowedSymbol: string;
  readonly allowedCardDigest: `sha256:${string}`;
  readonly recvWindowMs: number;
  readonly requestTimeoutMs: number;
  readonly maximumResponseBytes?: number;
  readonly clock: Readonly<M0SpotProductionClock>;
  readonly readSigner: Readonly<M0SpotProductionSigner>;
  readonly executionSigner: Readonly<M0SpotProductionSigner>;
  readonly egress: Readonly<BinanceSpotEgressSpendPort>;
  readonly fetch: typeof fetch;
}

interface EndpointContract {
  readonly contractId:
    | 'SPOT_TEST_ORDER_POST'
    | 'SPOT_ORDER_POST'
    | 'SPOT_ORDER_QUERY'
    | 'SPOT_ORDER_CANCEL'
    | 'SPOT_MY_TRADES_QUERY';
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly credentialProfile: BinanceSpotCredentialProfile;
  readonly path:
    | '/api/v3/order'
    | '/api/v3/order/test'
    | '/api/v3/myTrades';
}

const ENDPOINTS: Readonly<
  Record<BinanceSpotExecutionOperation, Readonly<EndpointContract>>
> = Object.freeze({
  SIGNED_TEST: Object.freeze({
    contractId: 'SPOT_TEST_ORDER_POST',
    method: 'POST',
    credentialProfile: 'SPOT_TRADE_EXECUTION',
    path: '/api/v3/order/test',
  }),
  SUBMIT: Object.freeze({
    contractId: 'SPOT_ORDER_POST',
    method: 'POST',
    credentialProfile: 'SPOT_TRADE_EXECUTION',
    path: '/api/v3/order',
  }),
  QUERY_ORDER: Object.freeze({
    contractId: 'SPOT_ORDER_QUERY',
    method: 'GET',
    credentialProfile: 'USER_DATA_READ',
    path: '/api/v3/order',
  }),
  QUERY_FILLS: Object.freeze({
    contractId: 'SPOT_MY_TRADES_QUERY',
    method: 'GET',
    credentialProfile: 'USER_DATA_READ',
    path: '/api/v3/myTrades',
  }),
  CANCEL: Object.freeze({
    contractId: 'SPOT_ORDER_CANCEL',
    method: 'DELETE',
    credentialProfile: 'SPOT_TRADE_EXECUTION',
    path: '/api/v3/order',
  }),
  FLATTEN: Object.freeze({
    contractId: 'SPOT_ORDER_POST',
    method: 'POST',
    credentialProfile: 'SPOT_TRADE_EXECUTION',
    path: '/api/v3/order',
  }),
});

function snapshotRecord(
  value: unknown,
  fields: readonly string[],
): PlainRecord | null {
  try {
    if (
      value === null
      || typeof value !== 'object'
      || Array.isArray(value)
      || nodeUtilTypes.isProxy(value)
      || Object.getPrototypeOf(value) !== Object.prototype
    ) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).length !== fields.length
      || fields.some((field) => {
        const descriptor = descriptors[field];
        return descriptor === undefined
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
          || descriptor.enumerable !== true;
      })
    ) return null;
    return Object.freeze(Object.fromEntries(
      fields.map((field) => [field, descriptors[field].value]),
    ));
  } catch {
    return null;
  }
}

function canonicalParameters(
  value: unknown,
): readonly (readonly [string, string])[] {
  if (
    !Array.isArray(value)
    || nodeUtilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1
    || value.length > MAX_PARAMETERS
  ) throw new TypeError('M0 Spot parameters are malformed');
  const output: (readonly [string, string])[] = [];
  const names = new Set<string>();
  for (const pair of value) {
    if (
      !Array.isArray(pair)
      || nodeUtilTypes.isProxy(pair)
      || Object.getPrototypeOf(pair) !== Array.prototype
      || pair.length !== 2
      || typeof pair[0] !== 'string'
      || typeof pair[1] !== 'string'
      || !PARAMETER_NAME.test(pair[0])
      || pair[1].length < 1
      || pair[1].length > 256
      || /[\p{Cc}\p{Bidi_Control}]/u.test(pair[1])
      || names.has(pair[0])
      || /^(?:timestamp|recvWindow|signature|apiKey|apiSecret|secretKey)$/iu
        .test(pair[0])
    ) throw new TypeError('M0 Spot parameters are malformed');
    names.add(pair[0]);
    output.push(Object.freeze([pair[0], pair[1]] as const));
  }
  return Object.freeze(output);
}

function parameterMap(
  values: readonly (readonly [string, string])[],
): ReadonlyMap<string, string> {
  return new Map(values);
}

function exactKeys(
  values: ReadonlyMap<string, string>,
  keys: readonly string[],
): boolean {
  return values.size === keys.length
    && keys.every((key) => values.has(key));
}

function positiveDecimal(value: string | undefined, label: string): string {
  if (value === undefined) throw new TypeError(`${label} is missing`);
  const canonical = normalizeSpotDecimal(value, label);
  if (canonical === '0' || canonical !== value) {
    throw new TypeError(`${label} is not a positive canonical decimal`);
  }
  return canonical;
}

function validateOrderParameters(
  operation: BinanceSpotExecutionOperation,
  values: ReadonlyMap<string, string>,
  allowedSymbol: string,
): void {
  if (!exactKeys(values, [
    'symbol',
    'side',
    'type',
    'quantity',
    'newClientOrderId',
    'newOrderRespType',
    'timeInForce',
    'price',
  ])) throw new TypeError('M0 Spot order parameters are not exact');
  if (
    values.get('symbol') !== allowedSymbol
    || values.get('type') !== 'LIMIT'
    || values.get('timeInForce') !== 'FOK'
    || values.get('newOrderRespType') !== 'RESULT'
    || (
      operation === 'SUBMIT'
        ? values.get('side') !== 'BUY'
        : operation === 'FLATTEN'
          ? values.get('side') !== 'SELL'
          : values.get('side') !== 'BUY'
    )
    || !CLIENT_ORDER_ID.test(values.get('newClientOrderId') ?? '')
  ) throw new TypeError('M0 Spot order parameters violate the card');
  const quantity = positiveDecimal(values.get('quantity'), 'quantity');
  const price = positiveDecimal(values.get('price'), 'price');
  const notional = multiplySpotDecimals(quantity, price);
  if (
    compareSpotDecimals(
      notional,
      OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
    ) > 0
  ) throw new TypeError('M0 Spot order exceeds the ten USDT ceiling');
}

function validateRequest(
  requestValue: Readonly<BinanceSpotSignedTransportRequest>,
  allowedSymbol: string,
): Readonly<{
  request: Readonly<BinanceSpotSignedTransportRequest>;
  parameters: readonly (readonly [string, string])[];
}> {
  const record = snapshotRecord(requestValue, REQUEST_FIELDS);
  if (
    record === null
    || record.schema !== BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA
    || typeof record.operation !== 'string'
    || !Object.prototype.hasOwnProperty.call(ENDPOINTS, record.operation)
    || record.automaticRetry !== false
    || record.transportCallsAuthorized !== 1
    || record.externalActionAuthorization
      !== 'DURABLE_DISPATCH_PERMIT_REQUIRED'
  ) throw new TypeError('M0 Spot transport request is malformed');
  const operation = record.operation as BinanceSpotExecutionOperation;
  const expected = ENDPOINTS[operation];
  if (
    record.credentialProfile !== expected.credentialProfile
    || record.contractId !== expected.contractId
    || record.method !== expected.method
    || record.path !== expected.path
  ) throw new TypeError('M0 Spot endpoint contract is not allowed');
  const parameters = canonicalParameters(record.parameters);
  const values = parameterMap(parameters);
  if (operation === 'SIGNED_TEST'
    || operation === 'SUBMIT'
    || operation === 'FLATTEN') {
    validateOrderParameters(operation, values, allowedSymbol);
  } else if (
    operation === 'QUERY_ORDER'
    || operation === 'CANCEL'
  ) {
    if (
      !exactKeys(values, ['symbol', 'origClientOrderId'])
      || values.get('symbol') !== allowedSymbol
      || !CLIENT_ORDER_ID.test(values.get('origClientOrderId') ?? '')
    ) throw new TypeError('M0 Spot order identity is malformed');
  } else if (
    !exactKeys(values, ['symbol', 'orderId'])
    || values.get('symbol') !== allowedSymbol
    || !/^[0-9]{1,40}$/u.test(values.get('orderId') ?? '')
  ) {
    throw new TypeError('M0 Spot fill identity is malformed');
  }
  return Object.freeze({
    request:
      record as unknown as Readonly<BinanceSpotSignedTransportRequest>,
    parameters,
  });
}

function exactPermit(
  permit: Readonly<BinanceSpotDispatchPermit>,
  request: Readonly<BinanceSpotSignedTransportRequest>,
  allowedCardDigest: string,
  requestTimeoutMs: number,
  recvWindowMs: number,
): boolean {
  const record = snapshotRecord(permit, [
    'schema',
    'version',
    'operation',
    'credentialProfile',
    'action',
    'lifecycleId',
    'cardDigest',
    'ticketId',
    'termsDigest',
    'clientOrderId',
    'requestDigest',
    'executionLease',
    'claimedAtMs',
    'claimedMonotonicMs',
    'dispatchDeadlineAtMs',
    'dispatchDeadlineMonotonicMs',
    'requestTimeoutMs',
    'recvWindowMs',
    'acceptanceSettlesAtMs',
    'acceptanceSettlesMonotonicMs',
    'receipt',
    'dispatchCardinality',
    'automaticRetry',
    'externalActionAuthorization',
    'permitDigest',
  ]);
  if (record === null) return false;
  const receipt = snapshotRecord(record.receipt, [
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
  ]);
  const executionLease = snapshotRecord(record.executionLease, [
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
  ]);
  if (receipt === null || executionLease === null) return false;
  const actionMatchesOperation =
    (
      request.operation === 'CANCEL'
      && (
        record.action === 'ENTRY_CANCEL'
        || record.action === 'FLATTEN_CANCEL'
      )
    )
    || (
      request.operation !== 'CANCEL'
      && record.action === (
        request.operation === 'SUBMIT'
          ? 'ENTRY'
          : request.operation
      )
    );
  const withoutDigest = Object.freeze(Object.fromEntries(
    Object.entries(record).filter(([field]) => field !== 'permitDigest'),
  )) as unknown as Readonly<
    Omit<BinanceSpotDispatchPermit, 'permitDigest'>
  >;
  return (
    record.schema === BINANCE_SPOT_DISPATCH_PERMIT_SCHEMA
    && record.version === 1
    && record.operation === request.operation
    && record.credentialProfile === request.credentialProfile
    && actionMatchesOperation
    && record.cardDigest === allowedCardDigest
    && record.requestDigest
      === calculateBinanceSpotDispatchRequestDigest(request)
    && record.dispatchCardinality === 'ONE'
    && record.automaticRetry === false
    && record.externalActionAuthorization
      === 'DURABLE_ONE_USE_ACTION_CONSUMED'
    && typeof record.permitDigest === 'string'
    && /^sha256:[0-9a-f]{64}$/u.test(record.permitDigest)
    && record.permitDigest
      === calculateBinanceSpotDispatchPermitDigest(withoutDigest)
    && Number.isSafeInteger(record.claimedAtMs)
    && (record.claimedAtMs as number) >= 0
    && Number.isSafeInteger(record.claimedMonotonicMs)
    && (record.claimedMonotonicMs as number) >= 0
    && Number.isSafeInteger(record.dispatchDeadlineAtMs)
    && (record.dispatchDeadlineAtMs as number) > (record.claimedAtMs as number)
    && Number.isSafeInteger(record.dispatchDeadlineMonotonicMs)
    && (record.dispatchDeadlineMonotonicMs as number)
      > (record.claimedMonotonicMs as number)
    && record.requestTimeoutMs === requestTimeoutMs
    && record.recvWindowMs === recvWindowMs
    && Number.isSafeInteger(record.acceptanceSettlesAtMs)
    && record.acceptanceSettlesAtMs
      === (record.dispatchDeadlineAtMs as number)
        + requestTimeoutMs + recvWindowMs
    && Number.isSafeInteger(record.acceptanceSettlesMonotonicMs)
    && record.acceptanceSettlesMonotonicMs
      === (record.dispatchDeadlineMonotonicMs as number)
        + requestTimeoutMs + recvWindowMs
    && executionLease.status === 'ACTIVE'
    && (
      executionLease.mode === 'ENTRY'
      || executionLease.mode === 'RECOVERY_ONLY'
    )
    && typeof executionLease.clockFenceId === 'string'
    && /^m0_clock_fence_[A-Za-z0-9_.:-]{16,160}$/u
      .test(executionLease.clockFenceId)
    && Number.isSafeInteger(executionLease.acquiredAtMs)
    && Number.isSafeInteger(executionLease.acquiredMonotonicMs)
    && (record.claimedAtMs as number)
      >= (executionLease.acquiredAtMs as number)
    && (record.claimedMonotonicMs as number)
      >= (executionLease.acquiredMonotonicMs as number)
    && receipt.schema === M0_SPOT_ACTION_CONSUMPTION_SCHEMA
    && receipt.version === 1
    && receipt.lifecycleId === record.lifecycleId
    && receipt.cardDigest === record.cardDigest
    && receipt.action === record.action
    && receipt.ticketId === record.ticketId
    && receipt.termsDigest === record.termsDigest
    && receipt.clientOrderId === record.clientOrderId
    && Number.isSafeInteger(receipt.consumedAtMs)
    && (record.claimedAtMs as number) >= (receipt.consumedAtMs as number)
    && receipt.state === 'CONSUMED_ONCE'
    && receipt.authorizationReuseAllowed === false
  );
}

function livePermitTimestamp(
  permit: Readonly<BinanceSpotDispatchPermit>,
  clock: Readonly<M0SpotProductionClock>,
): number {
  const nowMs = clock.nowMs();
  const monotonicMs = clock.monotonicMs();
  const clockFenceId = clock.clockFenceId();
  if (
    !Number.isSafeInteger(nowMs)
    || nowMs < permit.claimedAtMs
    || nowMs >= permit.dispatchDeadlineAtMs
    || !Number.isSafeInteger(monotonicMs)
    || monotonicMs < permit.claimedMonotonicMs
    || monotonicMs >= permit.dispatchDeadlineMonotonicMs
    || clockFenceId !== permit.executionLease.clockFenceId
  ) throw new TypeError('M0 Spot dispatch permit is stale');
  return nowMs;
}

function egressSpendRequest(
  permit: Readonly<BinanceSpotDispatchPermit>,
): Readonly<BinanceSpotEgressSpendRequest> {
  return Object.freeze({
    schema: BINANCE_SPOT_EGRESS_SPEND_SCHEMA,
    version: 1 as const,
    lifecycleId: permit.lifecycleId,
    authorizationId: permit.receipt.authorizationId,
    permitDigest: permit.permitDigest,
    requestDigest: permit.requestDigest,
    executionRequestId: permit.executionLease.requestId,
    clockFenceId: permit.executionLease.clockFenceId,
    dispatchDeadlineAtMs: permit.dispatchDeadlineAtMs,
    dispatchDeadlineMonotonicMs:
      permit.dispatchDeadlineMonotonicMs,
  });
}

function exactEgressSpendReceipt(
  value: Readonly<BinanceSpotEgressSpendReceipt> | null,
  request: Readonly<BinanceSpotEgressSpendRequest>,
): value is Readonly<BinanceSpotEgressSpendReceipt> {
  if (value === null) return false;
  const record = snapshotRecord(value, [
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
    'spentAtMs',
    'spentMonotonicMs',
    'state',
  ]);
  return record !== null
    && record.schema === request.schema
    && record.version === request.version
    && record.lifecycleId === request.lifecycleId
    && record.authorizationId === request.authorizationId
    && record.permitDigest === request.permitDigest
    && record.requestDigest === request.requestDigest
    && record.executionRequestId === request.executionRequestId
    && record.clockFenceId === request.clockFenceId
    && record.dispatchDeadlineAtMs === request.dispatchDeadlineAtMs
    && record.dispatchDeadlineMonotonicMs
      === request.dispatchDeadlineMonotonicMs
    && Number.isSafeInteger(record.spentAtMs)
    && (record.spentAtMs as number) >= 0
    && (record.spentAtMs as number) < request.dispatchDeadlineAtMs
    && Number.isSafeInteger(record.spentMonotonicMs)
    && (record.spentMonotonicMs as number) >= 0
    && (record.spentMonotonicMs as number)
      < request.dispatchDeadlineMonotonicMs
    && record.state === 'SPENT_ONCE';
}

async function boundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const advertised = response.headers.get('content-length');
  if (
    advertised !== null
    && Number.isFinite(Number(advertised))
    && Number(advertised) > maximumBytes
  ) throw new Error('M0_SPOT_RESPONSE_INVALID');
  if (response.body === null) return Object.freeze({});
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const row = await reader.read();
      if (row.done) break;
      if (!(row.value instanceof Uint8Array)) {
        throw new Error('M0_SPOT_RESPONSE_INVALID');
      }
      totalBytes += row.value.byteLength;
      if (totalBytes > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size violation remains authoritative.
        }
        throw new Error('M0_SPOT_RESPONSE_INVALID');
      }
      chunks.push(row.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.allocUnsafe(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = bytes.toString('utf8');
  if (text.length === 0) return Object.freeze({});
  return JSON.parse(text) as unknown;
}

function validSigner(
  signer: Readonly<M0SpotProductionSigner> | undefined,
): boolean {
  return (
    typeof signer?.sign === 'function'
    && (
      signer.algorithm === 'ED25519'
      || signer.algorithm === 'HMAC_SHA256'
    )
    && typeof signer.apiKey === 'string'
    && API_KEY.test(signer.apiKey)
  );
}

function validConfig(
  options: Readonly<M0SpotProductionTransportOptions>,
): void {
  if (
    !SYMBOL.test(options?.allowedSymbol)
    || !/^sha256:[0-9a-f]{64}$/u.test(options?.allowedCardDigest)
    || !Number.isSafeInteger(options?.recvWindowMs)
    || options.recvWindowMs < 1
    || options.recvWindowMs > 5_000
    || !Number.isSafeInteger(options?.requestTimeoutMs)
    || options.requestTimeoutMs < 1
    || options.requestTimeoutMs > 5_000
    || typeof options?.clock?.nowMs !== 'function'
    || typeof options?.clock?.monotonicMs !== 'function'
    || typeof options?.clock?.clockFenceId !== 'function'
    || !validSigner(options?.readSigner)
    || !validSigner(options?.executionSigner)
    || options.readSigner === options.executionSigner
    || options.readSigner.apiKey === options.executionSigner.apiKey
    || typeof options?.egress?.spend !== 'function'
    || typeof options.egress.confirm !== 'function'
    || typeof options?.fetch !== 'function'
    || (
      options.maximumResponseBytes !== undefined
      && (
        !Number.isSafeInteger(options.maximumResponseBytes)
        || options.maximumResponseBytes < 64
        || options.maximumResponseBytes > MAX_RESPONSE_BYTES
      )
    )
  ) throw new TypeError('M0 Spot production transport is not configured');
}

/**
 * Create the exact Spot transport. No signer or network call occurs until
 * `send` receives a valid, unused durable permit.
 */
export function createM0SpotProductionTransport(
  options: Readonly<M0SpotProductionTransportOptions>,
): Readonly<BinanceSpotSignedTransportPort> {
  validConfig(options);
  const consumedAuthorizations = new Set<string>();
  const fetchImpl = options.fetch;
  const maximumResponseBytes =
    options.maximumResponseBytes ?? MAX_RESPONSE_BYTES;

  return Object.freeze({
    async send(
      requestValue: Readonly<BinanceSpotSignedTransportRequest>,
      permit: Readonly<BinanceSpotDispatchPermit>,
    ): Promise<Readonly<BinanceSpotSignedTransportOutcome>> {
      const validated = validateRequest(
        requestValue,
        options.allowedSymbol,
      );
      if (!exactPermit(
        permit,
        validated.request,
        options.allowedCardDigest,
        options.requestTimeoutMs,
        options.recvWindowMs,
      )) throw new TypeError('M0 Spot dispatch permit is invalid');
      const authorizationId = permit.receipt.authorizationId;
      if (consumedAuthorizations.has(authorizationId)) {
        throw new TypeError('M0 Spot dispatch permit was already used');
      }
      const timestamp = livePermitTimestamp(permit, options.clock);
      consumedAuthorizations.add(authorizationId);

      const query = new URLSearchParams();
      for (const [name, value] of validated.parameters) {
        query.append(name, value);
      }
      query.append('recvWindow', String(options.recvWindowMs));
      query.append('timestamp', String(timestamp));
      const unsigned = query.toString();
      if (Buffer.byteLength(unsigned, 'utf8') > MAX_QUERY_BYTES) {
        throw new RangeError('M0 Spot signed query exceeds its bound');
      }
      const signer = validated.request.credentialProfile === 'USER_DATA_READ'
        ? options.readSigner
        : options.executionSigner;
      livePermitTimestamp(permit, options.clock);
      const signature = await signer.sign(unsigned);
      if (
        typeof signature !== 'string'
        || (
          signer.algorithm === 'HMAC_SHA256'
            ? !HMAC_SIGNATURE.test(signature)
            : !ED25519_SIGNATURE.test(signature)
        )
      ) throw new TypeError('M0 Spot signer result is invalid');
      query.append('signature', signature);
      const url = `${ORIGIN}${validated.request.path}?${query.toString()}`;
      const timeoutSignal = AbortSignal.timeout(options.requestTimeoutMs);
      livePermitTimestamp(permit, options.clock);
      const spendRequest = egressSpendRequest(permit);
      const spend = await options.egress.spend(spendRequest);
      if (!exactEgressSpendReceipt(spend, spendRequest)) {
        throw new TypeError('M0 Spot dispatch permit was already spent');
      }
      // The persistence call above is awaited and may outlive either clock
      // deadline or the process fence. Revalidate both clocks and the exact
      // fence synchronously at the final pre-fetch boundary.
      livePermitTimestamp(permit, options.clock);
      let dispatched = false;
      let confirmed = false;
      try {
        dispatched = true;
        const response = await fetchImpl(url, {
          method: validated.request.method,
          headers: Object.freeze({
            Accept: 'application/json',
            'X-MBX-APIKEY': signer.apiKey,
          }),
          redirect: 'error',
          signal: timeoutSignal,
        });
        confirmed = await options.egress.confirm(Object.freeze({
          spend,
          outcome: 'RESPONSE_RECEIVED' as const,
        }));
        if (!confirmed) {
          return Object.freeze({
            kind: 'DISCONNECTED' as const,
            dispatched: true as const,
          });
        }
        const body = await boundedJson(response, maximumResponseBytes);
        return Object.freeze({
          kind: 'RESPONSE' as const,
          status: response.status,
          body,
        });
      } catch (error) {
        if (!dispatched) throw error;
        if (!confirmed) {
          try {
            confirmed = await options.egress.confirm(Object.freeze({
              spend,
              outcome: 'AMBIGUOUS' as const,
            }));
          } catch {
            confirmed = false;
          }
        }
        return Object.freeze({
          kind:
            timeoutSignal.aborted
            || (error instanceof Error && error.name === 'AbortError')
              ? 'TIMEOUT' as const
              : 'DISCONNECTED' as const,
          dispatched: true as const,
        });
      }
    },
  });
}

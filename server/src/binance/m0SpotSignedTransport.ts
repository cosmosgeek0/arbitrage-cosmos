/**
 * Pure M0 Spot signed-transport mapper.
 *
 * This source maps only the accepted Spot adapter tuples into the audited
 * signed-request kernel. It owns no API key, secret, environment read, host,
 * URL, dispatcher, HTTP client, retry loop, or external-action authority.
 * Production does not construct or import it in M0-I2.
 */
import { types as nodeUtilTypes } from 'node:util';

import {
  deriveKernelClientOrderId,
} from '../liveEdge/adapters/binanceSignedKernel/identity.js';
import {
  constructSignedRequest,
  type BoundHmacSigner,
  type ConstructedSignedRequest,
  type SignedRequestFailureCode,
} from '../liveEdge/adapters/binanceSignedKernel/request.js';
import type { BinanceClockSample } from '../liveEdge/adapters/binanceSignedKernel/clock.js';
import {
  BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
  type BinanceSpotExecutionContractId,
  type BinanceSpotExecutionOperation,
  type BinanceSpotSignedTransportRequest,
} from '../liveEdge/adapters/binanceSpotExecution/adapter.js';

export const M0_SPOT_SIGNED_TRANSPORT_SCHEMA =
  'cosmos.binance.m0-spot-signed-transport.v1' as const;

const REQUEST_KEYS = Object.freeze([
  'schema',
  'operation',
  'contractId',
  'method',
  'path',
  'parameters',
  'automaticRetry',
  'transportCallsAuthorized',
  'externalActionAuthorization',
] as const);
const BINDING_KEYS = Object.freeze([
  'clockSamples',
  'nowMonotonicMs',
  'correlationId',
  'requestSequence',
  'clientOrderIdentity',
] as const);
const CLIENT_ORDER_KEYS = Object.freeze(['planId', 'legId', 'attempt'] as const);

const EXACT_TUPLES = new Set([
  'SIGNED_TEST|SPOT_TEST_ORDER_POST|POST|/api/v3/order/test',
  'SUBMIT|SPOT_ORDER_POST|POST|/api/v3/order',
  'QUERY_ORDER|SPOT_ORDER_QUERY|GET|/api/v3/order',
  'QUERY_FILLS|SPOT_MY_TRADES_QUERY|GET|/api/v3/myTrades',
  'CANCEL|SPOT_ORDER_CANCEL|DELETE|/api/v3/order',
  'FLATTEN|SPOT_ORDER_POST|POST|/api/v3/order',
]);
const IDENTITY_OPERATIONS = new Set<BinanceSpotExecutionOperation>([
  'SIGNED_TEST',
  'SUBMIT',
  'FLATTEN',
]);

export type M0SpotSignedTransportFailureCode =
  | SignedRequestFailureCode
  | 'REQUEST_INVALID'
  | 'REQUEST_TUPLE_FORBIDDEN'
  | 'BINDING_INVALID'
  | 'CLIENT_ORDER_BINDING_REQUIRED'
  | 'CLIENT_ORDER_BINDING_FORBIDDEN'
  | 'CLIENT_ORDER_BINDING_MISMATCH'
  | 'SIGNED_REQUEST_SCOPE_MISMATCH';

export interface M0SpotClientOrderIdentity {
  readonly planId: string;
  readonly legId: string;
  readonly attempt: number;
}

export interface M0SpotSignedTransportBinding {
  readonly clockSamples: readonly Readonly<BinanceClockSample>[];
  readonly nowMonotonicMs: number;
  readonly correlationId: string;
  readonly requestSequence: number;
  readonly clientOrderIdentity: Readonly<M0SpotClientOrderIdentity> | null;
}

export interface M0SpotMappedSignedTransportRequest {
  readonly schema: typeof M0_SPOT_SIGNED_TRANSPORT_SCHEMA;
  readonly operation: BinanceSpotExecutionOperation;
  readonly contractId: BinanceSpotExecutionContractId;
  readonly method: BinanceSpotSignedTransportRequest['method'];
  readonly path: BinanceSpotSignedTransportRequest['path'];
  readonly request: Readonly<ConstructedSignedRequest>;
  readonly automaticRetry: false;
  readonly transportCallsAuthorized: 0;
  readonly dispatchAuthorized: false;
  readonly externalActionAuthorization: 'NONE';
}

export type M0SpotSignedTransportMapResult =
  | {
      readonly ok: true;
      readonly mapped: Readonly<M0SpotMappedSignedTransportRequest>;
    }
  | {
      readonly ok: false;
      readonly failure: Readonly<{
        readonly code: M0SpotSignedTransportFailureCode;
      }>;
    };

type PlainRecord = Readonly<Record<string, unknown>>;
type ParameterPair = readonly [string, string];

function failure(
  code: M0SpotSignedTransportFailureCode,
): M0SpotSignedTransportMapResult {
  return Object.freeze({
    ok: false as const,
    failure: Object.freeze({ code }),
  });
}

function closedRecord(
  value: unknown,
  keys: readonly string[],
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
      Reflect.ownKeys(descriptors).length !== keys.length
      || keys.some((key) => {
        const descriptor = descriptors[key];
        return (
          descriptor === undefined
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
          || descriptor.enumerable !== true
        );
      })
    ) return null;
    return Object.freeze(Object.fromEntries(
      keys.map((key) => [key, descriptors[key].value]),
    ));
  } catch {
    return null;
  }
}

function denseParameters(value: unknown): readonly ParameterPair[] | null {
  try {
    if (
      !Array.isArray(value)
      || nodeUtilTypes.isProxy(value)
      || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > 64
    ) return null;
    const rows: ParameterPair[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      const row = descriptor?.value;
      if (
        descriptor === undefined
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        || !Array.isArray(row)
        || nodeUtilTypes.isProxy(row)
        || Object.getPrototypeOf(row) !== Array.prototype
        || row.length !== 2
      ) return null;
      const first = Object.getOwnPropertyDescriptor(row, '0');
      const second = Object.getOwnPropertyDescriptor(row, '1');
      if (
        first === undefined
        || second === undefined
        || !Object.prototype.hasOwnProperty.call(first, 'value')
        || !Object.prototype.hasOwnProperty.call(second, 'value')
        || typeof first.value !== 'string'
        || typeof second.value !== 'string'
      ) return null;
      rows.push(Object.freeze([first.value, second.value] as const));
    }
    return Object.freeze(rows);
  } catch {
    return null;
  }
}

function clientOrderIdentity(
  value: unknown,
): Readonly<M0SpotClientOrderIdentity> | null {
  const record = closedRecord(value, CLIENT_ORDER_KEYS);
  if (record === null) return null;
  if (
    typeof record.planId !== 'string'
    || typeof record.legId !== 'string'
    || !Number.isSafeInteger(record.attempt)
  ) return null;
  return Object.freeze({
    planId: record.planId,
    legId: record.legId,
    attempt: record.attempt as number,
  });
}

/**
 * Construct sensitive signed bytes for one exact accepted adapter request.
 * The result still authorizes zero dispatches and zero external actions.
 */
export function mapM0SpotSignedTransportRequest(
  requestInput: unknown,
  bindingInput: unknown,
  signer: Readonly<BoundHmacSigner>,
): M0SpotSignedTransportMapResult {
  const request = closedRecord(requestInput, REQUEST_KEYS);
  if (
    request === null
    || request.schema !== BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA
    || typeof request.operation !== 'string'
    || typeof request.contractId !== 'string'
    || typeof request.method !== 'string'
    || typeof request.path !== 'string'
    || request.automaticRetry !== false
    || request.transportCallsAuthorized !== 1
    || request.externalActionAuthorization !== 'INJECTED_INTENT_ONLY'
  ) return failure('REQUEST_INVALID');

  const tuple = [
    request.operation,
    request.contractId,
    request.method,
    request.path,
  ].join('|');
  if (!EXACT_TUPLES.has(tuple)) return failure('REQUEST_TUPLE_FORBIDDEN');

  const parameters = denseParameters(request.parameters);
  const binding = closedRecord(bindingInput, BINDING_KEYS);
  if (parameters === null || binding === null) return failure('BINDING_INVALID');

  const operation = request.operation as BinanceSpotExecutionOperation;
  const requiresIdentity = IDENTITY_OPERATIONS.has(operation);
  const identity = binding.clientOrderIdentity === null
    ? null
    : clientOrderIdentity(binding.clientOrderIdentity);
  if (requiresIdentity && identity === null) {
    return failure('CLIENT_ORDER_BINDING_REQUIRED');
  }
  if (!requiresIdentity && binding.clientOrderIdentity !== null) {
    return failure('CLIENT_ORDER_BINDING_FORBIDDEN');
  }

  let kernelParameters = parameters;
  if (requiresIdentity && identity !== null) {
    const clientRows = parameters.filter(([name]) => name === 'newClientOrderId');
    let expectedClientOrderId: string;
    try {
      expectedClientOrderId = deriveKernelClientOrderId(
        identity.planId,
        identity.legId,
        identity.attempt,
      );
    } catch {
      return failure('CLIENT_ORDER_BINDING_MISMATCH');
    }
    if (
      clientRows.length !== 1
      || clientRows[0][1] !== expectedClientOrderId
    ) return failure('CLIENT_ORDER_BINDING_MISMATCH');
    kernelParameters = Object.freeze(
      parameters.filter(([name]) => name !== 'newClientOrderId'),
    );
  }

  const constructed = constructSignedRequest({
    contractId: request.contractId,
    expectedProduct: 'SPOT',
    expectedEnvironment: 'PRODUCTION',
    parameters: kernelParameters,
    clockSamples: binding.clockSamples,
    nowMonotonicMs: binding.nowMonotonicMs,
    correlationId: binding.correlationId,
    requestSequence: binding.requestSequence,
    clientOrderIdentity: identity,
  }, signer);
  if (!constructed.ok) return failure(constructed.failure.code);
  if (
    constructed.request.contractId !== request.contractId
    || constructed.request.method !== request.method
    || constructed.request.product !== 'SPOT'
    || constructed.request.environment !== 'PRODUCTION'
  ) return failure('SIGNED_REQUEST_SCOPE_MISMATCH');

  return Object.freeze({
    ok: true as const,
    mapped: Object.freeze({
      schema: M0_SPOT_SIGNED_TRANSPORT_SCHEMA,
      operation,
      contractId: request.contractId as BinanceSpotExecutionContractId,
      method: request.method as BinanceSpotSignedTransportRequest['method'],
      path: request.path as BinanceSpotSignedTransportRequest['path'],
      request: constructed.request,
      automaticRetry: false as const,
      transportCallsAuthorized: 0 as const,
      dispatchAuthorized: false as const,
      externalActionAuthorization: 'NONE' as const,
    }),
  });
}

export const M0_SPOT_SIGNED_TRANSPORT_TUPLES = Object.freeze(
  [...EXACT_TUPLES].sort(),
);

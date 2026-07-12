import {
  deriveClientOrderId,
  isValidClientOrderId,
} from '../../../foundation/contracts/exchange.js';
import {
  canonicalJson,
  stableHash128Hex,
  type CorrelationId,
} from '../../../foundation/contracts/identity.js';
import { types as utilTypes } from 'node:util';
import {
  BINANCE_SIGNER_PROFILES,
  L03_BINANCE_MATRIX_SHA256,
  type BinanceSignerProfile,
} from './contract.js';

const CONTRACT_ID = /^[A-Z0-9][A-Z0-9_.-]{2,127}$/;
const FOUNDATION_CORRELATION_ID = /^cor_[0-9a-f]{16}$/;
const INTENT_FINGERPRINT = /^[0-9a-f]{32}$/;
const MAXIMUM_SEQUENCE = 999_999;
const MAXIMUM_CANONICAL_PAYLOAD_BYTES = 8_192;

export interface TransportRequestIdentity {
  readonly requestId: `lrq_${string}`;
  readonly requestSequence: number;
  readonly intentFingerprint: string;
  readonly correlationId: CorrelationId;
  readonly contractId: string;
  readonly product: 'SPOT' | 'USD_M_PERPETUAL';
  readonly environment: 'PRODUCTION';
  readonly signerProfile: BinanceSignerProfile;
}

export function fingerprintCanonicalIntent(payload: unknown): string {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new TypeError('canonical payload must be a non-empty string');
  }
  if (Buffer.byteLength(payload, 'utf8') > MAXIMUM_CANONICAL_PAYLOAD_BYTES) {
    throw new TypeError('canonical payload exceeds the L03 byte bound');
  }
  return stableHash128Hex(`liveEdge.binanceSignedKernel.intent.v1\u0000${payload}`);
}

/** Narrow syntax guard for IDs produced by Foundation deriveCorrelationId. */
export function isCanonicalFoundationCorrelationId(value: unknown): value is CorrelationId {
  return typeof value === 'string' && FOUNDATION_CORRELATION_ID.test(value);
}

/**
 * Local transport correlation only. It is not a Foundation CommandId, EventId,
 * PlanId, ticket or persistence authority.
 */
export function deriveTransportRequestId(input: {
  readonly contractId: unknown;
  readonly product: unknown;
  readonly environment: unknown;
  readonly signerProfile: unknown;
  readonly correlationId: unknown;
  readonly requestSequence: unknown;
  readonly intentFingerprint: unknown;
}): Readonly<TransportRequestIdentity> {
  if (typeof input !== 'object' || input === null || utilTypes.isProxy(input) || Array.isArray(input)) {
    throw new TypeError('request identity input must be a record');
  }
  if (Object.getPrototypeOf(input) !== Object.prototype) throw new TypeError('request identity input must be a record');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const expectedKeys = [
    'contractId', 'product', 'environment', 'signerProfile', 'correlationId',
    'requestSequence', 'intentFingerprint',
  ] as const;
  if (Reflect.ownKeys(input).length !== expectedKeys.length
    || expectedKeys.some((key) => {
      const descriptor = descriptors[key];
      return descriptor === undefined || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true;
    })) {
    throw new TypeError('request identity input must be a closed data record');
  }
  const record = Object.fromEntries(expectedKeys.map((key) => [key, descriptors[key].value]));
  if (typeof record.contractId !== 'string' || !CONTRACT_ID.test(record.contractId)) {
    throw new TypeError('contractId is invalid');
  }
  if (record.product !== 'SPOT' && record.product !== 'USD_M_PERPETUAL') {
    throw new TypeError('product is invalid');
  }
  if (record.environment !== 'PRODUCTION') throw new TypeError('environment is invalid');
  if (typeof record.signerProfile !== 'string' || !(BINANCE_SIGNER_PROFILES as readonly string[]).includes(record.signerProfile)) {
    throw new TypeError('signerProfile is invalid');
  }
  const expectedProfile: BinanceSignerProfile = record.product === 'SPOT'
    ? 'SPOT_HMAC_SHA256'
    : 'USDM_HMAC_SHA256';
  if (record.signerProfile !== expectedProfile) {
    throw new TypeError('signerProfile does not match product');
  }
  if (!isCanonicalFoundationCorrelationId(record.correlationId)) {
    throw new TypeError('correlationId is invalid');
  }
  if (
    typeof record.requestSequence !== 'number'
    || !Number.isSafeInteger(record.requestSequence)
    || record.requestSequence < 0
    || record.requestSequence > MAXIMUM_SEQUENCE
  ) {
    throw new TypeError('requestSequence is invalid');
  }
  if (typeof record.intentFingerprint !== 'string' || !INTENT_FINGERPRINT.test(record.intentFingerprint)) {
    throw new TypeError('intentFingerprint is invalid');
  }
  const fields = {
    schema: 'liveEdge.binanceSignedKernel.request.v1',
    matrixSha256: L03_BINANCE_MATRIX_SHA256,
    contractId: record.contractId,
    product: record.product,
    environment: record.environment,
    signerProfile: record.signerProfile,
    correlationId: record.correlationId,
    requestSequence: record.requestSequence,
    intentFingerprint: record.intentFingerprint,
  };
  const requestId = `lrq_${stableHash128Hex(canonicalJson(fields))}` as const;
  return Object.freeze({
    requestId,
    requestSequence: record.requestSequence as number,
    intentFingerprint: record.intentFingerprint as string,
    correlationId: record.correlationId,
    contractId: record.contractId as string,
    product: record.product as TransportRequestIdentity['product'],
    environment: 'PRODUCTION',
    signerProfile: record.signerProfile as BinanceSignerProfile,
  });
}

/** Exact delegation to the canonical Foundation venue identity owner. */
export function deriveKernelClientOrderId(planId: unknown, legId: unknown, attempt: unknown): string {
  const id = deriveClientOrderId({
    planId: planId as string,
    legId: legId as string,
    attempt: attempt as number,
  });
  if (!isValidClientOrderId(id)) throw new TypeError('Foundation returned an invalid client-order ID');
  return id;
}

export const L03_REQUEST_ID_MAX_SEQUENCE = MAXIMUM_SEQUENCE;
export const L03_CANONICAL_PAYLOAD_MAX_BYTES = MAXIMUM_CANONICAL_PAYLOAD_BYTES;

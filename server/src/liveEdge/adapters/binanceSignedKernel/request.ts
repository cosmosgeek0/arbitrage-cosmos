import { types as utilTypes } from 'node:util';

import { isValidClientOrderId } from '../../../foundation/contracts/exchange.js';

import {
  decideBinanceSigningClock,
  estimateBinanceClock,
} from './clock.js';
import {
  resolveSignedContract,
  type BinanceSignerProfile,
  type ResolveSignedContractFailureCode,
  type ResolvedSignedContract,
} from './contract.js';
import {
  deriveKernelClientOrderId,
  deriveTransportRequestId,
  fingerprintCanonicalIntent,
  L03_CANONICAL_PAYLOAD_MAX_BYTES,
  type TransportRequestIdentity,
} from './identity.js';

const INPUT_KEYS = [
  'contractId',
  'expectedProduct',
  'expectedEnvironment',
  'parameters',
  'clockSamples',
  'nowMonotonicMs',
  'correlationId',
  'requestSequence',
  'clientOrderIdentity',
] as const;
const CLIENT_ORDER_KEYS = ['planId', 'legId', 'attempt'] as const;
const SIGNER_KEYS = ['algorithm', 'profile', 'product', 'environment', 'sign'] as const;
const PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const SIGNATURE = /^[0-9a-fA-F]{64}$/;
const MAXIMUM_PARAMETERS = 64;
const MAXIMUM_PARAMETER_VALUE_BYTES = 512;
const RESERVED_PARAMETER = /^(?:timestamp|recvwindow|newclientorderid)$/i;
const UNSAFE_TEXT = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u;
const CREDENTIAL_SHAPED_VALUE = /(?:-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}|private[ _-]?key|api[ _-]?secret|secret(?:[ _:=\-]|$)|credential|authorization|bearer(?:[ _:=\-]|$))/i;

export type SignedRequestFailureCode =
  | ResolveSignedContractFailureCode
  | 'INPUT_INVALID'
  | 'PARAMETER_INVALID'
  | 'DUPLICATE_PARAMETER'
  | 'RESERVED_PARAMETER'
  | 'REQUIRED_PARAMETER_MISSING'
  | 'PARAMETER_EXCLUSIVITY_INVALID'
  | 'CLIENT_ORDER_IDENTITY_REQUIRED'
  | 'CLIENT_ORDER_IDENTITY_FORBIDDEN'
  | 'CLIENT_ORDER_IDENTITY_INVALID'
  | 'CANCEL_CONTRACT_IDENTITY_UNRESOLVED'
  | 'CANCEL_CLIENT_ORDER_ID_REQUIRED'
  | 'CANCEL_CLIENT_ORDER_ID_INVALID'
  | 'CLOCK_EVIDENCE_INVALID'
  | 'CLOCK_DECISION_BLOCKED'
  | 'PAYLOAD_TOO_LARGE'
  | 'REQUEST_IDENTITY_INVALID'
  | 'SIGNER_INVALID'
  | 'SIGNER_SCOPE_MISMATCH'
  | 'SIGNER_FAILED'
  | 'SIGNER_OUTPUT_INVALID';

export interface BoundHmacSigner {
  readonly algorithm: 'HMAC_SHA256';
  readonly profile: BinanceSignerProfile;
  readonly product: 'SPOT' | 'USD_M_PERPETUAL';
  readonly environment: 'PRODUCTION';
  sign(payload: string): string;
}

export interface SensitiveSignedRequestMaterial {
  readonly classification: 'SENSITIVE_SIGNED_REQUEST_MATERIAL';
  readonly query: string;
}

export interface SensitiveUnsignedRequestMaterial {
  readonly classification: 'SENSITIVE_UNSIGNED_REQUEST_MATERIAL';
  readonly query: string;
}

export interface ConstructedUnsignedRequest {
  readonly contractId: string;
  readonly product: 'SPOT' | 'USD_M_PERPETUAL';
  readonly environment: 'PRODUCTION';
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly signerProfile: BinanceSignerProfile;
  readonly requestIdentity: Readonly<TransportRequestIdentity>;
  readonly clientOrderId: string | null;
  readonly mutationClass: ResolvedSignedContract['mutationClass'];
  readonly safeRetryClass: ResolvedSignedContract['safeRetryClass'];
  readonly documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY';
  readonly externalActionAuthorization: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly material: Readonly<SensitiveUnsignedRequestMaterial>;
}

export interface ConstructedSignedRequest {
  readonly contractId: string;
  readonly product: 'SPOT' | 'USD_M_PERPETUAL';
  readonly environment: 'PRODUCTION';
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly signerProfile: BinanceSignerProfile;
  readonly requestIdentity: Readonly<TransportRequestIdentity>;
  readonly clientOrderId: string | null;
  readonly mutationClass: ResolvedSignedContract['mutationClass'];
  readonly safeRetryClass: ResolvedSignedContract['safeRetryClass'];
  readonly documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY';
  readonly externalActionAuthorization: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly material: Readonly<SensitiveSignedRequestMaterial>;
}

export type ConstructSignedRequestResult =
  | { readonly ok: true; readonly request: Readonly<ConstructedSignedRequest> }
  | { readonly ok: false; readonly failure: Readonly<{ readonly code: SignedRequestFailureCode }> };

export type ConstructUnsignedRequestResult =
  | { readonly ok: true; readonly request: Readonly<ConstructedUnsignedRequest> }
  | { readonly ok: false; readonly failure: Readonly<{ readonly code: SignedRequestFailureCode }> };

type ConstructRequestFailure = Readonly<{
  readonly ok: false;
  readonly failure: Readonly<{ readonly code: SignedRequestFailureCode }>;
}>;

type DataRecord = Record<string, unknown>;
type ParameterPair = readonly [string, string];

function fail(code: SignedRequestFailureCode): ConstructRequestFailure {
  return Object.freeze({ ok: false as const, failure: Object.freeze({ code }) });
}

function plainRecordWithKeys(value: unknown, expected: readonly string[]): DataRecord | null {
  if (typeof value !== 'object' || value === null || utilTypes.isProxy(value) || Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string') || ownKeys.length !== expected.length) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
  }
  if (Object.keys(descriptors).some((key) => !expected.includes(key))) return null;
  return Object.fromEntries(expected.map((key) => [key, descriptors[key].value]));
}

function denseArray(value: unknown, maximum: number): readonly unknown[] | null {
  if (typeof value !== 'object' || value === null || utilTypes.isProxy(value) || !Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || (key !== 'length' && !/^(?:0|[1-9]\d*)$/.test(key)))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
  }
  if (Object.keys(descriptors).length !== value.length + 1) return null;
  return Object.freeze(Array.from({ length: value.length }, (_, index) => descriptors[String(index)].value));
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function safeParameterValue(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && Buffer.byteLength(value, 'utf8') <= MAXIMUM_PARAMETER_VALUE_BYTES
    && !UNSAFE_TEXT.test(value)
    && !hasUnpairedSurrogate(value)
    && !value.includes('%');
}

function reservedParameterName(value: string): boolean {
  const normalized = value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return RESERVED_PARAMETER.test(normalized)
    || normalized === 'secret'
    || normalized.includes('key')
    || normalized.includes('credential')
    || normalized.includes('authorization')
    || normalized.includes('bearer')
    || normalized.includes('token')
    || normalized.includes('signature');
}

function credentialShapedParameterValue(value: string): boolean {
  return /^[A-Za-z0-9]{64}$/.test(value) || CREDENTIAL_SHAPED_VALUE.test(value);
}

function readParameters(value: unknown):
  | { readonly ok: true; readonly pairs: readonly ParameterPair[] }
  | { readonly ok: false; readonly code: Extract<SignedRequestFailureCode, 'PARAMETER_INVALID' | 'DUPLICATE_PARAMETER' | 'RESERVED_PARAMETER'> } {
  const rows = denseArray(value, MAXIMUM_PARAMETERS);
  if (rows === null) return { ok: false, code: 'PARAMETER_INVALID' };
  const accepted: ParameterPair[] = [];
  const names = new Set<string>();
  for (const row of rows) {
    const pair = denseArray(row, 2);
    if (pair === null || pair.length !== 2) return { ok: false, code: 'PARAMETER_INVALID' };
    const [name, rawValue] = pair;
    if (typeof name !== 'string' || typeof rawValue !== 'string') {
      return { ok: false, code: 'PARAMETER_INVALID' };
    }
    if (reservedParameterName(name)) return { ok: false, code: 'RESERVED_PARAMETER' };
    if (!PARAMETER_NAME.test(name)
      || !safeParameterValue(rawValue)
      || credentialShapedParameterValue(rawValue)) return { ok: false, code: 'PARAMETER_INVALID' };
    const folded = name.toLowerCase();
    if (names.has(folded)) return { ok: false, code: 'DUPLICATE_PARAMETER' };
    names.add(folded);
    accepted.push(Object.freeze([name, rawValue] as const));
  }
  return { ok: true, pairs: Object.freeze(accepted) };
}

function encodeComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeCanonicalPairs(pairs: readonly ParameterPair[]): string {
  return [...pairs]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, value]) => `${encodeComponent(name)}=${encodeComponent(value)}`)
    .join('&');
}

function requiredParametersPresent(contract: ResolvedSignedContract, pairs: readonly ParameterPair[]): SignedRequestFailureCode | null {
  const names = new Set(pairs.map(([name]) => name));
  if (contract.mutationClass === 'ORDER_CANCEL_MUTATION'
    && !contract.requiredParameters.includes('orderIdOrOrigClientOrderId')) {
    return 'CANCEL_CONTRACT_IDENTITY_UNRESOLVED';
  }
  for (const required of contract.requiredParameters) {
    if (required === 'timestamp' || required === 'signature' || required === 'apiKey') continue;
    if (required === 'orderIdOrOrigClientOrderId') {
      if (contract.mutationClass === 'ORDER_CANCEL_MUTATION') {
        if (names.has('orderId') || !names.has('origClientOrderId')) {
          return 'CANCEL_CLIENT_ORDER_ID_REQUIRED';
        }
        continue;
      }
      const count = Number(names.has('orderId')) + Number(names.has('origClientOrderId'));
      if (count !== 1) return 'PARAMETER_EXCLUSIVITY_INVALID';
      continue;
    }
    if (!names.has(required)) return 'REQUIRED_PARAMETER_MISSING';
  }
  return null;
}

function deriveClientOrder(
  contract: ResolvedSignedContract,
  value: unknown,
  pairs: readonly ParameterPair[],
): { readonly ok: true; readonly clientOrderId: string | null } | { readonly ok: false; readonly code: SignedRequestFailureCode } {
  if (contract.mutationClass === 'ORDER_CANCEL_MUTATION') {
    if (value !== null) return { ok: false, code: 'CLIENT_ORDER_IDENTITY_FORBIDDEN' };
    const clientOrderId = pairs.find(([name]) => name === 'origClientOrderId')?.[1];
    if (clientOrderId === undefined) return { ok: false, code: 'CANCEL_CLIENT_ORDER_ID_REQUIRED' };
    if (!isValidClientOrderId(clientOrderId)
      || !/^cx-[0-9a-f]{24}-(?:0|[1-9][0-9]{0,2})$/.test(clientOrderId)) {
      return { ok: false, code: 'CANCEL_CLIENT_ORDER_ID_INVALID' };
    }
    return { ok: true, clientOrderId };
  }
  const requiresIdentity = contract.mutationClass === 'ORDER_MUTATION' || contract.mutationClass === 'TEST_ORDER_MUTATION';
  if (!requiresIdentity) {
    return value === null
      ? { ok: true, clientOrderId: null }
      : { ok: false, code: 'CLIENT_ORDER_IDENTITY_FORBIDDEN' };
  }
  if (value === null) return { ok: false, code: 'CLIENT_ORDER_IDENTITY_REQUIRED' };
  const record = plainRecordWithKeys(value, CLIENT_ORDER_KEYS);
  if (record === null) return { ok: false, code: 'CLIENT_ORDER_IDENTITY_INVALID' };
  try {
    return {
      ok: true,
      clientOrderId: deriveKernelClientOrderId(record.planId, record.legId, record.attempt),
    };
  } catch {
    return { ok: false, code: 'CLIENT_ORDER_IDENTITY_INVALID' };
  }
}

function injectsNewClientOrderId(contract: ResolvedSignedContract): boolean {
  return contract.mutationClass === 'ORDER_MUTATION'
    || contract.mutationClass === 'TEST_ORDER_MUTATION';
}

function readSigner(value: unknown): Readonly<BoundHmacSigner> | null {
  const record = plainRecordWithKeys(value, SIGNER_KEYS);
  if (record === null
    || record.algorithm !== 'HMAC_SHA256'
    || typeof record.profile !== 'string'
    || typeof record.sign !== 'function') return null;
  return Object.freeze({
    algorithm: 'HMAC_SHA256' as const,
    profile: record.profile as BinanceSignerProfile,
    product: record.product as BoundHmacSigner['product'],
    environment: record.environment as BoundHmacSigner['environment'],
    sign: record.sign as (payload: string) => string,
  });
}

function constructUnsignedRequestInternal(input: unknown): ConstructUnsignedRequestResult {
  const record = plainRecordWithKeys(input, INPUT_KEYS);
  if (record === null) return fail('INPUT_INVALID');

  const resolved = resolveSignedContract(record.contractId, record.expectedProduct, record.expectedEnvironment);
  if (!resolved.ok) return fail(resolved.code);
  const contract = resolved.contract;

  const parsed = readParameters(record.parameters);
  if (!parsed.ok) return fail(parsed.code);
  const requiredFailure = requiredParametersPresent(contract, parsed.pairs);
  if (requiredFailure !== null) return fail(requiredFailure);

  const clientIdentity = deriveClientOrder(contract, record.clientOrderIdentity, parsed.pairs);
  if (!clientIdentity.ok) return fail(clientIdentity.code);

  const estimate = estimateBinanceClock(record.clockSamples, record.nowMonotonicMs);
  if (!estimate.ok) return fail('CLOCK_EVIDENCE_INVALID');
  const clock = decideBinanceSigningClock(contract.contractId, estimate.value, record.nowMonotonicMs);
  if (!clock.ok || clock.value.state !== 'READY') return fail('CLOCK_DECISION_BLOCKED');
  if (clock.value.product !== contract.product || clock.value.environment !== contract.environment) {
    return fail('CLOCK_DECISION_BLOCKED');
  }

  const pairs: ParameterPair[] = [...parsed.pairs];
  if (clientIdentity.clientOrderId !== null && injectsNewClientOrderId(contract)) {
    pairs.push(Object.freeze(['newClientOrderId', clientIdentity.clientOrderId]));
  }
  pairs.push(Object.freeze(['recvWindow', String(clock.value.recvWindowMs)]));
  pairs.push(Object.freeze(['timestamp', String(clock.value.timestampMs)]));
  const canonicalPayload = encodeCanonicalPairs(pairs);
  if (Buffer.byteLength(canonicalPayload, 'utf8') > L03_CANONICAL_PAYLOAD_MAX_BYTES) {
    return fail('PAYLOAD_TOO_LARGE');
  }

  let requestIdentity: Readonly<TransportRequestIdentity>;
  try {
    requestIdentity = deriveTransportRequestId({
      contractId: contract.contractId,
      product: contract.product,
      environment: contract.environment,
      signerProfile: contract.signerProfile,
      correlationId: record.correlationId,
      requestSequence: record.requestSequence,
      intentFingerprint: fingerprintCanonicalIntent(canonicalPayload),
    });
  } catch {
    return fail('REQUEST_IDENTITY_INVALID');
  }

  return Object.freeze({
    ok: true as const,
    request: Object.freeze({
      contractId: contract.contractId,
      product: contract.product,
      environment: contract.environment,
      method: contract.method,
      signerProfile: contract.signerProfile,
      requestIdentity,
      clientOrderId: clientIdentity.clientOrderId,
      mutationClass: contract.mutationClass,
      safeRetryClass: contract.safeRetryClass,
      documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY' as const,
      externalActionAuthorization: 'NONE' as const,
      actionAuthority: 'NONE_RECORD_ONLY' as const,
      material: Object.freeze({
        classification: 'SENSITIVE_UNSIGNED_REQUEST_MATERIAL' as const,
        query: canonicalPayload,
      }),
    }),
  });
}

/**
 * Builds the exact sensitive unsigned payload after every contract, parameter,
 * client-order, clock and request-identity gate. It performs no signing or
 * transport and accepts no prepared/free-form request bytes.
 */
export function constructUnsignedRequest(input: unknown): ConstructUnsignedRequestResult {
  return constructUnsignedRequestInternal(input);
}

/**
 * Reruns the complete unsigned construction path, then invokes one exact
 * product-bound signer. A caller cannot supply or substitute prepared bytes.
 */
export function constructSignedRequest(input: unknown, signerInput: unknown): ConstructSignedRequestResult {
  const unsigned = constructUnsignedRequestInternal(input);
  if (!unsigned.ok) return unsigned;
  const request = unsigned.request;

  const signer = readSigner(signerInput);
  if (signer === null) return fail('SIGNER_INVALID');
  if (
    signer.profile !== request.signerProfile
    || signer.product !== request.product
    || signer.environment !== request.environment
  ) return fail('SIGNER_SCOPE_MISMATCH');

  let signature: unknown;
  try {
    signature = signer.sign(request.material.query);
  } catch {
    return fail('SIGNER_FAILED');
  }
  if (typeof signature !== 'string' || !SIGNATURE.test(signature)) return fail('SIGNER_OUTPUT_INVALID');
  const signedQuery = `${request.material.query}&signature=${signature.toLowerCase()}`;

  return Object.freeze({
    ok: true as const,
    request: Object.freeze({
      contractId: request.contractId,
      product: request.product,
      environment: request.environment,
      method: request.method,
      signerProfile: request.signerProfile,
      requestIdentity: request.requestIdentity,
      clientOrderId: request.clientOrderId,
      mutationClass: request.mutationClass,
      safeRetryClass: request.safeRetryClass,
      documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY' as const,
      externalActionAuthorization: 'NONE' as const,
      actionAuthority: 'NONE_RECORD_ONLY' as const,
      material: Object.freeze({
        classification: 'SENSITIVE_SIGNED_REQUEST_MATERIAL' as const,
        query: signedQuery,
      }),
    }),
  });
}

export const L03_MAXIMUM_PARAMETERS = MAXIMUM_PARAMETERS;
export const L03_MAXIMUM_PARAMETER_VALUE_BYTES = MAXIMUM_PARAMETER_VALUE_BYTES;

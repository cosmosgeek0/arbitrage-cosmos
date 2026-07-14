import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import { canonicalJson } from '../../../foundation/contracts/index.js';
import {
  bindSpotOrderTifCapability,
  preflightInstrumentSizing,
} from '../binanceInstrumentSpecs/sizing.js';
import {
  validateSpotOrderTifCapability,
} from '../binanceInstrumentSpecs/spotOrderTifCapability.js';
import type {
  BindBinanceSpotOrderTifCapabilityResult,
  InstrumentSizingResult,
} from '../binanceInstrumentSpecs/types.js';
import {
  reserveRateBudget,
  type BinanceRateReservationDecision,
} from '../binanceSignedKernel/rateBudget.js';
import { constructUnsignedRequest } from '../binanceSignedKernel/request.js';
import { validateMutationJournalSnapshot } from '../durableMutationJournal/journal.js';
import type { MutationJournalSnapshot } from '../durableMutationJournal/types.js';
import {
  TWIN_REQUEST_SEMANTIC_EVIDENCE_SCHEMA,
  type BindTwinRequestSemanticEvidenceResult,
  type TwinRequestSemanticEvidence,
} from './types.js';
import { twinPositiveDecimal } from './exact.js';

const REQUEST_OWNER_MAXIMUM_DEPTH = 24;
const REQUEST_OWNER_MAXIMUM_NODES = 20_000;
const REQUEST_OWNER_MAXIMUM_ARRAY_LENGTH = 512;
const REQUEST_OWNER_MAXIMUM_OBJECT_KEYS = 256;
const REQUEST_OWNER_MAXIMUM_STRING_LENGTH = 8_192;
const REQUEST_SYMBOL = /^(?=.{2,40}$)[A-Z0-9._-]+$/;
const REQUEST_SECRET_FIELD = /(?:api.?key|secret|signature|credential|password|passphrase|mnemonic|seed(?:phrase)?|authorization|bearer|listen.?key|access.?key|session.?token|private.?key)/iu;
const REQUEST_OPAQUE_SECRET_TEXT = /^[A-Za-z0-9]{64}$/;
const REQUEST_SECRET_TEXT = /(?:\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|private[ _-]?key|(?:api|client)[ _-]?(?:key|secret)|secret(?:[ _:=\-]|$)|signature(?:[ _:=\-]|$)|credential|password|passphrase|mnemonic|seed[ _-]?phrase|authorization|bearer(?:[ _:=\-]|$)|listen[ _-]?key|access[ _-]?key|session[ _-]?token)/iu;

function requireOwnerValidatedTime(
  value: unknown,
  field: 'evaluatedAtMs' | 'atMs',
  suppliedAtMs: unknown,
  label: string,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(value as object, field);
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
    || descriptor.value !== suppliedAtMs) {
    throw new TypeError(`${label} must equal the supplied twin time`);
  }
}

/**
 * Reuses L04 as the sole owner of registry and sizing-request validation.
 * A rejected hostile input remains the canonical L04 blocked result. For an
 * owner-validated request, its evaluation time must be the injected venue time.
 */
export function evaluateExchangeTwinInstrumentPreflight(
  registrySnapshot: unknown,
  sizingRequest: unknown,
  venueAtMs: unknown,
): Readonly<InstrumentSizingResult> {
  const result = preflightInstrumentSizing(registrySnapshot, sizingRequest);
  if (!result.reasonCodes.includes('STATIC_PREFLIGHT_INPUT_REJECTED')) {
    requireOwnerValidatedTime(
      sizingRequest,
      'evaluatedAtMs',
      venueAtMs,
      'sizing request evaluatedAtMs',
    );
  }
  return result;
}

/**
 * Reuses the additive L08.1/L04 owner seam for one exact Spot LIMIT/TIF
 * capability. The current owner is rerun from its registry/request inputs;
 * callers cannot supply a positive capability projection. A valid request is
 * bound to the injected twin time exactly and every result remains non-sendable.
 */
export function evaluateExchangeTwinSpotOrderTifPreflight(
  registrySnapshot: unknown,
  sizingRequest: unknown,
  venueAtMs: unknown,
): BindBinanceSpotOrderTifCapabilityResult {
  const result = bindSpotOrderTifCapability(registrySnapshot, sizingRequest);
  if (result.ok || !result.reasonCodes.includes('SPOT_CAPABILITY_INPUT_REJECTED')) {
    requireOwnerValidatedTime(
      sizingRequest,
      'evaluatedAtMs',
      venueAtMs,
      'Spot sizing request evaluatedAtMs',
    );
  }
  if (!result.ok) return result;
  return Object.freeze({
    ok: true as const,
    binding: validateSpotOrderTifCapability(result.binding),
  });
}

/**
 * Reuses L03 as the sole owner of rate-state and reservation validation. The
 * supplied twin time is a binding assertion only; it does not create a clock.
 */
export function evaluateExchangeTwinRateReservation(
  rateState: unknown,
  reservationInput: unknown,
  atMs: unknown,
): BinanceRateReservationDecision {
  const decision = reserveRateBudget(rateState, reservationInput);
  requireOwnerValidatedTime(reservationInput, 'atMs', atMs, 'rate reservation atMs');
  return decision;
}

/** Reuses L06's canonical replay validator; no L07 journal projection exists. */
export function evaluateExchangeTwinMutationSnapshot(
  snapshotValue: unknown,
): Readonly<MutationJournalSnapshot> {
  const snapshot = validateMutationJournalSnapshot(snapshotValue);
  if (snapshot === null) throw new TypeError('L06 mutation snapshot is invalid');
  return snapshot;
}

const REQUEST_EVIDENCE_FIELDS = Object.freeze([
  'schema', 'contractId', 'product', 'symbol', 'side', 'orderType',
  'timeInForce', 'price', 'quantity', 'positionSide', 'reduceOnly',
  'clientOrderId', 'requestId', 'requestSequence', 'intentFingerprint',
  'sanitizedRequestContentHash', 'requestOwnerInput', 'evidenceRevision', 'documentaryAuthority',
  'externalActionAuthorization', 'actionAuthority',
] as const);

function closedRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a closed data record`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== fields.length
    || fields.some((field) => {
      const descriptor = descriptors[field];
      return descriptor === undefined || !Object.hasOwn(descriptor, 'value')
        || descriptor.enumerable !== true;
    })) {
    throw new TypeError(`${label} fields are not canonical`);
  }
  return Object.fromEntries(fields.map((field) => [field, descriptors[field]!.value]));
}

function evidenceRevision(value: unknown): string {
  return `l07request_${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function oneParameter(parameters: URLSearchParams, name: string, required: boolean): string | null {
  const values = parameters.getAll(name);
  if (values.length > 1 || (required && values.length !== 1)) {
    throw new TypeError(`unsigned request ${name} parameter is not exact`);
  }
  return values[0] ?? null;
}

function freezeData<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) freezeData(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function snapshotRequestOwnerInput(
  value: unknown,
  depth = 0,
  state: { nodes: number; seen: Set<object> } = { nodes: 0, seen: new Set() },
): unknown {
  state.nodes += 1;
  if (state.nodes > REQUEST_OWNER_MAXIMUM_NODES || depth > REQUEST_OWNER_MAXIMUM_DEPTH) {
    throw new RangeError('request owner input is overbound');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > REQUEST_OWNER_MAXIMUM_STRING_LENGTH
      || REQUEST_OPAQUE_SECRET_TEXT.test(value)
      || REQUEST_SECRET_TEXT.test(value)) {
      throw new RangeError('request owner input string is unsafe or overbound');
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('request owner input number is invalid');
    return value;
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value) || state.seen.has(value)) {
    throw new TypeError('request owner input must be acyclic closed data');
  }
  state.seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype
      || value.length > REQUEST_OWNER_MAXIMUM_ARRAY_LENGTH
      || Reflect.ownKeys(value).length !== value.length + 1) {
      throw new TypeError('request owner input array is not dense bounded data');
    }
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
        || descriptor.enumerable !== true) {
        throw new TypeError('request owner input array element is not canonical data');
      }
      output.push(snapshotRequestOwnerInput(descriptor.value, depth + 1, state));
    }
    return output;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('request owner input record prototype is invalid');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > REQUEST_OWNER_MAXIMUM_OBJECT_KEYS
    || keys.some((key) => typeof key !== 'string'
      || REQUEST_SECRET_FIELD.test(key))) {
    throw new RangeError('request owner input record is overbound');
  }
  return Object.fromEntries(keys.map((key) => {
    const descriptor = descriptors[key as string];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
      || descriptor.enumerable !== true) {
      throw new TypeError('request owner input record field is not canonical data');
    }
    return [key, snapshotRequestOwnerInput(descriptor.value, depth + 1, state)];
  }));
}

function exactQueryParameterNames(
  parameters: URLSearchParams,
  product: 'SPOT' | 'USD_M_PERPETUAL',
  orderType: 'LIMIT' | 'MARKET',
): boolean {
  const expected = new Set([
    'symbol', 'side', 'type', 'quantity', 'newClientOrderId', 'timestamp', 'recvWindow',
    ...(orderType === 'LIMIT' ? ['timeInForce', 'price'] : []),
    ...(product === 'USD_M_PERPETUAL' ? ['positionSide', 'reduceOnly'] : []),
  ]);
  const names = [...parameters.keys()];
  return names.length === expected.size
    && new Set(names).size === names.length
    && names.every((name) => expected.has(name));
}

/**
 * Reruns L03's pure unsigned-request owner and projects only safe request
 * semantics plus a SHA-256 commitment. The canonical query never leaves this
 * function and no signer or transport is invoked.
 */
export function bindExchangeTwinRequestSemanticEvidence(
  input: unknown,
): BindTwinRequestSemanticEvidenceResult {
  let requestOwnerInput: Readonly<Record<string, unknown>>;
  try {
    const cloned = snapshotRequestOwnerInput(input);
    if (typeof cloned !== 'object' || cloned === null || Array.isArray(cloned)
      || Object.getPrototypeOf(cloned) !== Object.prototype) {
      return Object.freeze({ ok: false as const, code: 'REQUEST_OWNER_INPUT_NOT_DATA' });
    }
    requestOwnerInput = freezeData(cloned as Record<string, unknown>);
  } catch {
    return Object.freeze({ ok: false as const, code: 'REQUEST_OWNER_INPUT_NOT_DATA' });
  }
  const result = constructUnsignedRequest(requestOwnerInput);
  if (!result.ok) return Object.freeze({ ok: false as const, code: result.failure.code });
  try {
    const request = result.request;
    if (request.contractId !== 'SPOT_ORDER_POST' && request.contractId !== 'USDM_ORDER_POST') {
      return Object.freeze({ ok: false as const, code: 'REQUEST_CONTRACT_NOT_PLACEMENT' });
    }
    if (request.clientOrderId === null) {
      return Object.freeze({ ok: false as const, code: 'REQUEST_CLIENT_ORDER_ID_MISSING' });
    }
    const query = request.material.query;
    const parameters = new URLSearchParams(query);
    const orderType = oneParameter(parameters, 'type', true);
    const timeInForce = oneParameter(parameters, 'timeInForce', orderType === 'LIMIT');
    const price = oneParameter(parameters, 'price', orderType === 'LIMIT');
    const positionSide = oneParameter(
      parameters,
      'positionSide',
      request.product === 'USD_M_PERPETUAL',
    );
    const reduceOnlyValue = oneParameter(
      parameters,
      'reduceOnly',
      request.product === 'USD_M_PERPETUAL',
    );
    const symbol = oneParameter(parameters, 'symbol', true);
    const side = oneParameter(parameters, 'side', true);
    const quantity = oneParameter(parameters, 'quantity', true);
    const clientOrderId = oneParameter(parameters, 'newClientOrderId', true);
    oneParameter(parameters, 'timestamp', true);
    oneParameter(parameters, 'recvWindow', true);
    let decimalSemanticsExact = true;
    try {
      twinPositiveDecimal(quantity, 'unsigned request quantity');
      if (orderType === 'LIMIT') twinPositiveDecimal(price, 'unsigned request price');
    } catch {
      decimalSemanticsExact = false;
    }
    if ((orderType !== 'LIMIT' && orderType !== 'MARKET')
      || !exactQueryParameterNames(parameters, request.product, orderType)
      || typeof symbol !== 'string' || !REQUEST_SYMBOL.test(symbol)
      || (side !== 'BUY' && side !== 'SELL')
      || !decimalSemanticsExact
      || !['GTC', 'IOC', 'FOK', null].includes(timeInForce)
      || (orderType === 'MARKET' && (timeInForce !== null || price !== null))
      || clientOrderId !== request.clientOrderId
      || (request.product === 'SPOT' && (positionSide !== null || reduceOnlyValue !== null))
      || (request.product === 'USD_M_PERPETUAL'
        && (positionSide !== 'BOTH' || !['true', 'false'].includes(reduceOnlyValue ?? '')))) {
      return Object.freeze({ ok: false as const, code: 'REQUEST_SEMANTICS_NOT_CANONICAL' });
    }
    const material = Object.freeze({
      contractId: request.contractId,
      product: request.product,
      symbol,
      side,
      orderType,
      timeInForce,
      price,
      quantity,
      positionSide,
      reduceOnly: reduceOnlyValue === 'true',
      clientOrderId: request.clientOrderId,
      requestId: request.requestIdentity.requestId,
      requestSequence: request.requestIdentity.requestSequence,
      intentFingerprint: request.requestIdentity.intentFingerprint,
      sanitizedRequestContentHash: `sha256:${createHash('sha256').update(query).digest('hex')}`,
      requestOwnerInput,
      documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY' as const,
      externalActionAuthorization: 'NONE' as const,
      actionAuthority: 'NONE_RECORD_ONLY' as const,
    });
    return Object.freeze({
      ok: true as const,
      evidence: Object.freeze({
        schema: TWIN_REQUEST_SEMANTIC_EVIDENCE_SCHEMA,
        ...material,
        evidenceRevision: evidenceRevision(material),
      }) as Readonly<TwinRequestSemanticEvidence>,
    });
  } catch {
    return Object.freeze({ ok: false as const, code: 'REQUEST_SEMANTIC_PROJECTION_FAILED' });
  }
}

/** Revalidates one retained safe request projection without request bytes. */
export function validateExchangeTwinRequestSemanticEvidence(
  value: unknown,
): Readonly<TwinRequestSemanticEvidence> {
  const record = closedRecord(value, REQUEST_EVIDENCE_FIELDS, 'request semantic evidence');
  const replayed = bindExchangeTwinRequestSemanticEvidence(record.requestOwnerInput);
  if (!replayed.ok || canonicalJson(replayed.evidence) !== canonicalJson(record)) {
    throw new TypeError('request semantic evidence is not canonical');
  }
  return replayed.evidence;
}

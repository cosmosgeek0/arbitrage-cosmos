import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { MAX_ENGINE_SYMBOLS, isCanonicalSymbol } from './validation.js';

export const OBSERVED_ORDER_FOCUS_SOURCE_OWNER = 'FOUNDATION_RECONCILIATION' as const;
export const OBSERVED_ORDER_FOCUS_MAX_AGE_MS = 5 * 60_000;

export type ObservedOrderFocusAuthority =
  | 'LIVE_PRIVATE'
  | 'RECORDED_REPLAY'
  | 'SYNTHETIC_TEST'
  | 'UNAVAILABLE';

export type ObservedOrderFocusState = 'AVAILABLE' | 'UNAVAILABLE';

/**
 * Lossy, read-only projection consumed by Volume focus. Order identifiers,
 * quantities, sides, prices, credentials, and transport capability never
 * cross this boundary. A known-empty account cut is `openSymbols: []`;
 * unknown truth is `null` and can never clear existing protection early.
 */
export interface ObservedOrderFocusSnapshot {
  readonly sourceOwner: typeof OBSERVED_ORDER_FOCUS_SOURCE_OWNER;
  readonly sourceId: string;
  readonly authority: ObservedOrderFocusAuthority;
  readonly state: ObservedOrderFocusState;
  readonly observedAtMs: number | null;
  readonly validUntilMs: number | null;
  readonly openSymbols: readonly string[] | null;
  readonly reasonCodes: readonly string[];
}

export type ObservedOrderFocusApplyStatus =
  | 'APPLIED'
  | 'IDEMPOTENT'
  | 'UNAVAILABLE_RETAINED'
  | 'UNAVAILABLE_EXPIRED'
  | 'REJECTED_INVALID'
  | 'REJECTED_EXPIRED'
  | 'REJECTED_NON_MONOTONIC'
  | 'REJECTED_CONFLICT'
  | 'REJECTED_PERSISTENCE_UNAVAILABLE'
  | 'REJECTED_PERSISTENCE_CORRUPT'
  | 'REJECTED_PERSISTENCE_CONFLICT';

export interface ObservedOrderFocusApplyResult {
  readonly status: ObservedOrderFocusApplyStatus;
  readonly applied: boolean;
  readonly focusedOpenSymbols: readonly string[];
  readonly unfocusedOpenSymbols: readonly string[];
  readonly untrackedOpenSymbols: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface ObservedOrderFocusInspection {
  readonly snapshot: Readonly<ObservedOrderFocusSnapshot> | null;
  readonly reasonCodes: readonly string[];
}

const SNAPSHOT_KEYS = Object.freeze([
  'authority',
  'observedAtMs',
  'openSymbols',
  'reasonCodes',
  'sourceId',
  'sourceOwner',
  'state',
  'validUntilMs',
]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareText));
}

/** Read own data descriptors only; never invoke getters, proxies, or coercion. */
function dataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || utilTypes.isProxy(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== Object.prototype && prototype !== null)
        || Object.getOwnPropertySymbols(value).length !== 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor | undefined>;
    const out: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
      out[key] = descriptor.value;
    }
    return Object.freeze(out);
  } catch {
    return null;
  }
}

/** Read an exact dense ordinary array without touching indexed accessors. */
function dataArray(value: unknown): readonly unknown[] | null {
  if (!Array.isArray(value) || utilTypes.isProxy(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype
        || Object.getOwnPropertySymbols(value).length !== 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor | undefined>;
    const lengthDescriptor = descriptors.length;
    const lengthValue = lengthDescriptor?.value;
    if (typeof lengthValue !== 'number'
        || !Number.isSafeInteger(lengthValue)
        || lengthValue < 0) return null;
    const length = lengthValue;
    const names = Object.keys(descriptors);
    if (names.length !== length + 1) return null;
    const out: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
      out.push(descriptor.value);
    }
    return Object.freeze(out);
  } catch {
    return null;
  }
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareText);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validUtcMillis(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 4_102_444_800_000;
}

function validReason(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,119}$/.test(value);
}

/**
 * Inspect and normalize an unknown boundary value without executing any
 * caller-owned property access. The normalized snapshot contains only frozen
 * primitive data and dense arrays.
 */
export function inspectObservedOrderFocusSnapshot(value: unknown): Readonly<ObservedOrderFocusInspection> {
  const record = dataRecord(value);
  if (record === null) {
    return Object.freeze({
      snapshot: null,
      reasonCodes: Object.freeze(['OBSERVED_ORDER_FOCUS_OBJECT_REQUIRED']),
    });
  }
  if (!exactKeys(record, SNAPSHOT_KEYS)) {
    return Object.freeze({
      snapshot: null,
      reasonCodes: Object.freeze(['OBSERVED_ORDER_FOCUS_SCHEMA_INVALID']),
    });
  }

  const reasons: string[] = [];
  if (record.sourceOwner !== OBSERVED_ORDER_FOCUS_SOURCE_OWNER) reasons.push('OBSERVED_ORDER_FOCUS_OWNER_INVALID');
  if (typeof record.sourceId !== 'string'
      || record.sourceId.trim().length === 0
      || record.sourceId.length > 200) reasons.push('OBSERVED_ORDER_FOCUS_SOURCE_INVALID');
  if (record.authority !== 'LIVE_PRIVATE'
      && record.authority !== 'RECORDED_REPLAY'
      && record.authority !== 'SYNTHETIC_TEST'
      && record.authority !== 'UNAVAILABLE') reasons.push('OBSERVED_ORDER_FOCUS_AUTHORITY_INVALID');
  if (record.state !== 'AVAILABLE' && record.state !== 'UNAVAILABLE') {
    reasons.push('OBSERVED_ORDER_FOCUS_STATE_INVALID');
  }

  const reasonValues = dataArray(record.reasonCodes);
  if (reasonValues === null
      || reasonValues.length > 100
      || reasonValues.some((reason) => !validReason(reason))
      || new Set(reasonValues).size !== reasonValues.length) {
    reasons.push('OBSERVED_ORDER_FOCUS_REASONS_INVALID');
  }

  let openSymbols: readonly string[] | null = null;
  if (record.state === 'AVAILABLE') {
    if (record.authority === 'UNAVAILABLE') reasons.push('OBSERVED_ORDER_FOCUS_AUTHORITY_UNAVAILABLE');
    if (!validUtcMillis(record.observedAtMs)) reasons.push('OBSERVED_ORDER_FOCUS_OBSERVED_AT_INVALID');
    if (!validUtcMillis(record.validUntilMs)
        || (validUtcMillis(record.observedAtMs) && (
          record.validUntilMs < record.observedAtMs
          || record.validUntilMs - record.observedAtMs > OBSERVED_ORDER_FOCUS_MAX_AGE_MS
        ))) reasons.push('OBSERVED_ORDER_FOCUS_VALID_UNTIL_INVALID');

    const symbolValues = dataArray(record.openSymbols);
    if (symbolValues === null
        || symbolValues.length > MAX_ENGINE_SYMBOLS
        || symbolValues.some((symbol) => !isCanonicalSymbol(symbol))
        || new Set(symbolValues).size !== symbolValues.length
        || [...(symbolValues as readonly string[])].sort(compareText)
          .some((symbol, index) => symbol !== symbolValues[index])) {
      reasons.push('OBSERVED_ORDER_FOCUS_SYMBOLS_INVALID');
    } else {
      openSymbols = Object.freeze(symbolValues.map((symbol) => symbol as string));
    }
    if (reasonValues !== null && reasonValues.length > 0) {
      reasons.push('OBSERVED_ORDER_FOCUS_AVAILABLE_HAS_REASONS');
    }
  } else if (record.state === 'UNAVAILABLE') {
    if (record.openSymbols !== null || record.validUntilMs !== null) {
      reasons.push('OBSERVED_ORDER_FOCUS_UNKNOWN_MUST_BE_NULL');
    }
    if (record.observedAtMs !== null && !validUtcMillis(record.observedAtMs)) {
      reasons.push('OBSERVED_ORDER_FOCUS_OBSERVED_AT_INVALID');
    }
    if (reasonValues !== null && reasonValues.length === 0) {
      reasons.push('OBSERVED_ORDER_FOCUS_UNAVAILABLE_REASON_REQUIRED');
    }
  }

  const reasonCodes = sortedUnique(reasons);
  if (reasonCodes.length > 0) return Object.freeze({ snapshot: null, reasonCodes });
  const snapshot = Object.freeze({
    sourceOwner: OBSERVED_ORDER_FOCUS_SOURCE_OWNER,
    sourceId: record.sourceId as string,
    authority: record.authority as ObservedOrderFocusAuthority,
    state: record.state as ObservedOrderFocusState,
    observedAtMs: record.observedAtMs as number | null,
    validUntilMs: record.validUntilMs as number | null,
    openSymbols,
    reasonCodes: Object.freeze((reasonValues ?? []).map((reason) => reason as string)),
  });
  return Object.freeze({ snapshot, reasonCodes: Object.freeze([]) });
}

/** Structural validator used at the final strategy-owner boundary. */
export function validateObservedOrderFocusSnapshot(value: unknown): readonly string[] {
  return inspectObservedOrderFocusSnapshot(value).reasonCodes;
}

export function observedOrderFocusFingerprint(snapshot: Readonly<ObservedOrderFocusSnapshot>): string {
  const canonical = JSON.stringify({
    sourceOwner: snapshot.sourceOwner,
    sourceId: snapshot.sourceId,
    authority: snapshot.authority,
    observedAtMs: snapshot.observedAtMs,
    validUntilMs: snapshot.validUntilMs,
    openSymbols: snapshot.openSymbols,
  });
  return `oof_${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

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
  | 'REJECTED_CONFLICT';

export interface ObservedOrderFocusApplyResult {
  readonly status: ObservedOrderFocusApplyStatus;
  readonly applied: boolean;
  readonly focusedOpenSymbols: readonly string[];
  readonly unfocusedOpenSymbols: readonly string[];
  readonly untrackedOpenSymbols: readonly string[];
  readonly reasonCodes: readonly string[];
}

function plainDataObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => 'value' in descriptor);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function plainDataArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
    && Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => 'value' in descriptor);
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

/** Structural validator used at the final strategy-owner boundary. */
export function validateObservedOrderFocusSnapshot(value: unknown): readonly string[] {
  if (!plainDataObject(value)) return Object.freeze(['OBSERVED_ORDER_FOCUS_OBJECT_REQUIRED']);
  if (!exactKeys(value, [
    'authority',
    'observedAtMs',
    'openSymbols',
    'reasonCodes',
    'sourceId',
    'sourceOwner',
    'state',
    'validUntilMs',
  ])) return Object.freeze(['OBSERVED_ORDER_FOCUS_SCHEMA_INVALID']);

  const reasons: string[] = [];
  if (value.sourceOwner !== OBSERVED_ORDER_FOCUS_SOURCE_OWNER) reasons.push('OBSERVED_ORDER_FOCUS_OWNER_INVALID');
  if (typeof value.sourceId !== 'string' || value.sourceId.trim().length === 0 || value.sourceId.length > 200) {
    reasons.push('OBSERVED_ORDER_FOCUS_SOURCE_INVALID');
  }
  if (!['LIVE_PRIVATE', 'RECORDED_REPLAY', 'SYNTHETIC_TEST', 'UNAVAILABLE'].includes(String(value.authority))) {
    reasons.push('OBSERVED_ORDER_FOCUS_AUTHORITY_INVALID');
  }
  if (value.state !== 'AVAILABLE' && value.state !== 'UNAVAILABLE') reasons.push('OBSERVED_ORDER_FOCUS_STATE_INVALID');
  if (!plainDataArray(value.reasonCodes)
    || value.reasonCodes.length > 100
    || value.reasonCodes.some((reason) => !validReason(reason))
    || new Set(value.reasonCodes).size !== value.reasonCodes.length) {
    reasons.push('OBSERVED_ORDER_FOCUS_REASONS_INVALID');
  }

  if (value.state === 'AVAILABLE') {
    if (value.authority === 'UNAVAILABLE') reasons.push('OBSERVED_ORDER_FOCUS_AUTHORITY_UNAVAILABLE');
    if (!validUtcMillis(value.observedAtMs)) reasons.push('OBSERVED_ORDER_FOCUS_OBSERVED_AT_INVALID');
    if (!validUtcMillis(value.validUntilMs)
      || (validUtcMillis(value.observedAtMs) && (
        (value.validUntilMs as number) < value.observedAtMs
        || (value.validUntilMs as number) - value.observedAtMs > OBSERVED_ORDER_FOCUS_MAX_AGE_MS
      ))) {
      reasons.push('OBSERVED_ORDER_FOCUS_VALID_UNTIL_INVALID');
    }
    const symbols = value.openSymbols;
    if (!plainDataArray(symbols)
      || symbols.length > MAX_ENGINE_SYMBOLS
      || symbols.some((symbol) => !isCanonicalSymbol(symbol))
      || new Set(symbols).size !== symbols.length
      || [...symbols].sort().some((symbol, index) => symbol !== symbols[index])) {
      reasons.push('OBSERVED_ORDER_FOCUS_SYMBOLS_INVALID');
    }
    if (Array.isArray(value.reasonCodes) && value.reasonCodes.length > 0) {
      reasons.push('OBSERVED_ORDER_FOCUS_AVAILABLE_HAS_REASONS');
    }
  } else if (value.state === 'UNAVAILABLE') {
    if (value.openSymbols !== null || value.validUntilMs !== null) reasons.push('OBSERVED_ORDER_FOCUS_UNKNOWN_MUST_BE_NULL');
    if (value.observedAtMs !== null && !validUtcMillis(value.observedAtMs)) {
      reasons.push('OBSERVED_ORDER_FOCUS_OBSERVED_AT_INVALID');
    }
    if (Array.isArray(value.reasonCodes) && value.reasonCodes.length === 0) {
      reasons.push('OBSERVED_ORDER_FOCUS_UNAVAILABLE_REASON_REQUIRED');
    }
  }

  return Object.freeze([...new Set(reasons)].sort());
}

export function observedOrderFocusFingerprint(snapshot: Readonly<ObservedOrderFocusSnapshot>): string {
  return JSON.stringify({
    sourceOwner: snapshot.sourceOwner,
    sourceId: snapshot.sourceId,
    authority: snapshot.authority,
    observedAtMs: snapshot.observedAtMs,
    validUntilMs: snapshot.validUntilMs,
    openSymbols: snapshot.openSymbols,
  });
}

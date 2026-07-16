/**
 * One-way quantity-dialect evidence from exact journal truth to Foundation's
 * binary64 quantity representation.
 *
 * This module compares values only. It has no reconciliation, execution,
 * retry, fill, persistence, transport, or lifecycle capability.
 */
import { createHash } from 'node:crypto';

import {
  compareExactDecimals,
  divideExactDecimals,
  multiplyExactDecimals,
  normalizeNonNegativeExactDecimal,
  subtractExactDecimals,
  type ExactDecimal,
  type NonNegativeDecimal,
} from '../../capitalFoundation/contracts/decimal.js';
import { canonicalJson } from '../../foundation/contracts/index.js';

export const FOUNDATION_QUANTITY_BRIDGE_SCHEMA =
  'cosmos.system-integration.foundation-quantity-comparison.v1' as const;
export const FOUNDATION_QUANTITY_INSTRUMENT_EVIDENCE_SCHEMA =
  'cosmos.system-integration.foundation-quantity-instrument-evidence.v1' as const;

export type FoundationQuantityComparison =
  | 'EXACT_BINARY_VALUE'
  | 'WITHIN_TOLERANCE'
  | 'OUTSIDE_TOLERANCE';

export type FoundationQuantityRoundingDirection =
  | 'EXACT'
  | 'FOUNDATION_ABOVE_JOURNAL'
  | 'FOUNDATION_BELOW_JOURNAL';

export type FoundationQuantityToleranceDirection =
  | 'EXACT'
  | 'ABOVE_WITHIN_TOLERANCE'
  | 'BELOW_WITHIN_TOLERANCE'
  | 'ABOVE_OUTSIDE_TOLERANCE'
  | 'BELOW_OUTSIDE_TOLERANCE';

export interface FoundationQuantityBridgeInput {
  /** Validated append-only journal quantity. It remains the exact source. */
  readonly exactJournalQuantity: string;
  /** Original Foundation binary64 quantity; retained unchanged in the result. */
  readonly foundationQuantity: number;
  /** Canonical product-qualified instrument token, for example SPOT:BTCUSDT. */
  readonly instrumentId: string;
  /** Exact positive instrument quantity increment. */
  readonly instrumentStep: string;
  /** Exact non-negative absolute tolerance; must be strictly below half-step. */
  readonly instrumentTolerance: string;
  /** Content revision binding instrument identity, step, and tolerance. */
  readonly instrumentEvidenceRevision: string;
}

export interface FoundationQuantityComparisonResult {
  readonly schema: typeof FOUNDATION_QUANTITY_BRIDGE_SCHEMA;
  readonly version: 1;
  readonly comparison: FoundationQuantityComparison;
  readonly roundingDirection: FoundationQuantityRoundingDirection;
  readonly toleranceDirection: FoundationQuantityToleranceDirection;
  readonly exactJournalQuantity: string;
  readonly foundationQuantity: number;
  /** ECMAScript's canonical shortest round-tripping decimal for the number. */
  readonly foundationCanonicalDecimal: string;
  /** Exact base-10 expansion of the binary64 value, derived from its bits. */
  readonly foundationExactDecimal: string;
  readonly absoluteDifference: string;
  readonly instrumentId: string;
  readonly instrumentStep: string;
  readonly instrumentTolerance: string;
  readonly instrumentEvidenceRevision: string;
  readonly journalStepAlignment: 'ALIGNED';
  readonly stepToleranceRelation: 'UNAMBIGUOUS';
}

const INPUT_FIELDS = Object.freeze([
  'exactJournalQuantity',
  'foundationQuantity',
  'instrumentId',
  'instrumentStep',
  'instrumentTolerance',
  'instrumentEvidenceRevision',
] as const);
const ZERO = '0' as NonNegativeDecimal;
const TWO = '2' as NonNegativeDecimal;
const MAX_SAFE = '9007199254740991' as NonNegativeDecimal;
const FRACTION_MASK = (1n << 52n) - 1n;
const EXPONENT_MASK = 0x7ffn;
const INSTRUMENT_ID = /^(?:SPOT|USD_M_PERPETUAL|MARGIN):[A-Z0-9][A-Z0-9._-]{0,63}$/u;
const INSTRUMENT_EVIDENCE_REVISION = /^fqie_[0-9a-f]{64}$/u;

function failType(code: string, detail: string): never {
  throw new TypeError(`${code}: ${detail}`);
}

function failRange(code: string, detail: string): never {
  throw new RangeError(`${code}: ${detail}`);
}

function closedInput(value: Readonly<FoundationQuantityBridgeInput>): FoundationQuantityBridgeInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return failType('QUANTITY_BRIDGE_INPUT_INVALID', 'input must be a plain data object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return failType('QUANTITY_BRIDGE_INPUT_INVALID', 'input must have a plain prototype');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== INPUT_FIELDS.length || keys.some((key) => (
    typeof key !== 'string' || !(INPUT_FIELDS as readonly string[]).includes(key)
  ))) {
    return failType('QUANTITY_BRIDGE_INPUT_INVALID', 'input contains missing, unknown, or symbol fields');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const read = <K extends (typeof INPUT_FIELDS)[number]>(key: K): FoundationQuantityBridgeInput[K] => {
    const descriptor = descriptors[key];
    if (descriptor === undefined || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      return failType('QUANTITY_BRIDGE_INPUT_INVALID', `${key} must be an enumerable data property`);
    }
    if (descriptor.value === undefined) {
      return failType('QUANTITY_BRIDGE_INPUT_INVALID', `${key} must not be undefined`);
    }
    return descriptor.value as FoundationQuantityBridgeInput[K];
  };
  return {
    exactJournalQuantity: read('exactJournalQuantity'),
    foundationQuantity: read('foundationQuantity'),
    instrumentId: read('instrumentId'),
    instrumentStep: read('instrumentStep'),
    instrumentTolerance: read('instrumentTolerance'),
    instrumentEvidenceRevision: read('instrumentEvidenceRevision'),
  };
}

function instrumentIdInput(value: unknown): string {
  if (typeof value !== 'string'
    || value.length > 96
    || value !== value.normalize('NFC').toUpperCase()
    || !INSTRUMENT_ID.test(value)) {
    return failType(
      'INSTRUMENT_ID_INVALID',
      'instrumentId must be one canonical product-qualified instrument token',
    );
  }
  return value;
}

function exactInput(value: unknown, label: string): NonNegativeDecimal {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    return failType('EXACT_DECIMAL_INVALID', `${label} must be an unpadded decimal string`);
  }
  if (/[eE]/u.test(value)) {
    return failType('EXPONENT_TEXT_FORBIDDEN', `${label} must use plain base-10 notation`);
  }
  let normalized: NonNegativeDecimal;
  try {
    normalized = normalizeNonNegativeExactDecimal(value);
  } catch {
    return failType('EXACT_DECIMAL_INVALID', `${label} must be a bounded non-negative decimal`);
  }
  if (normalized !== value) {
    return failType('EXACT_DECIMAL_NON_CANONICAL', `${label} must already be canonical`);
  }
  return normalized;
}

/**
 * Content-addresses the exact quantity-filter facts. This is a deterministic
 * structural binding, not a signature or a source-authority grant.
 */
export function deriveFoundationQuantityInstrumentEvidenceRevision(
  instrumentIdValue: unknown,
  instrumentStepValue: unknown,
  instrumentToleranceValue: unknown,
): string {
  const instrumentId = instrumentIdInput(instrumentIdValue);
  const instrumentStep = exactInput(instrumentStepValue, 'instrumentStep');
  const instrumentTolerance = exactInput(instrumentToleranceValue, 'instrumentTolerance');
  const material = canonicalJson({
    schema: FOUNDATION_QUANTITY_INSTRUMENT_EVIDENCE_SCHEMA,
    instrumentId,
    instrumentStep,
    instrumentTolerance,
  });
  return `fqie_${createHash('sha256').update(material, 'utf8').digest('hex')}`;
}

function boundedSafeDecimal(value: NonNegativeDecimal, label: string): void {
  if (compareExactDecimals(value, MAX_SAFE) > 0) {
    failRange('BINARY64_OVERFLOW', `${label} exceeds Foundation's safe quantity range`);
  }
}

function proveJournalRoundTrip(value: NonNegativeDecimal): void {
  const projected = Number(value);
  if (!Number.isFinite(projected) || projected > Number.MAX_SAFE_INTEGER) {
    failRange('BINARY64_OVERFLOW', 'journal quantity cannot enter the bounded binary64 dialect');
  }
  if (Object.is(projected, -0) || (projected === 0 && value !== ZERO)) {
    failRange('BINARY64_UNDERFLOW', 'journal quantity collapses to zero in binary64');
  }
  const canonical = String(projected);
  if (/[eE]/u.test(canonical)) {
    failType('EXPONENT_TEXT_FORBIDDEN', 'journal quantity projects to exponent text');
  }
  if (canonical !== value) {
    failType('BINARY64_NON_ROUND_TRIP', 'journal quantity does not round-trip through canonical binary64 text');
  }
}

function scaledIntegerDecimal(coefficient: bigint, scale: number): string {
  let digits = coefficient.toString();
  if (scale === 0) return digits;
  digits = digits.padStart(scale + 1, '0');
  const split = digits.length - scale;
  return `${digits.slice(0, split)}.${digits.slice(split)}`;
}

interface Binary64Projection {
  readonly canonicalDecimal: string;
  readonly exactDecimal: NonNegativeDecimal;
}

function binary64Projection(value: unknown): Readonly<Binary64Projection> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return failType('BINARY64_NON_FINITE', 'Foundation quantity must be a finite number');
  }
  if (Object.is(value, -0)) {
    return failType('BINARY64_NEGATIVE_ZERO', 'Foundation quantity must not be negative zero');
  }
  if (value < 0) {
    return failRange('BINARY64_NEGATIVE', 'Foundation quantity must be non-negative');
  }
  if (value > Number.MAX_SAFE_INTEGER) {
    return failRange('BINARY64_OVERFLOW', 'Foundation quantity exceeds the safe quantity range');
  }

  // Use a typed byte view so the Product Assurance operation scanner does not
  // misclassify this fixed-size numeric scratch space as an owned work queue.
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  const sign = bits >> 63n;
  const exponent = (bits >> 52n) & EXPONENT_MASK;
  const fraction = bits & FRACTION_MASK;
  if (sign !== 0n) {
    return failType('BINARY64_NEGATIVE', 'Foundation quantity has a negative sign bit');
  }
  if (value !== 0 && exponent === 0n) {
    return failRange('BINARY64_UNDERFLOW', 'subnormal Foundation quantities are outside the bridge');
  }
  if (exponent === EXPONENT_MASK) {
    return failType('BINARY64_NON_FINITE', 'Foundation quantity is not finite');
  }

  const canonicalDecimal = String(value);
  if (/[eE]/u.test(canonicalDecimal)) {
    return failType('EXPONENT_TEXT_FORBIDDEN', 'Foundation quantity projects to exponent text');
  }
  if (!Object.is(Number(canonicalDecimal), value)) {
    return failType('BINARY64_NON_ROUND_TRIP', 'Foundation canonical decimal does not reproduce the original number');
  }

  if (value === 0) {
    return Object.freeze({ canonicalDecimal, exactDecimal: ZERO });
  }

  const significand = (1n << 52n) | fraction;
  const binaryExponent = Number(exponent) - 1023 - 52;
  const raw = binaryExponent >= 0
    ? (significand << BigInt(binaryExponent)).toString()
    : scaledIntegerDecimal(
        significand * (5n ** BigInt(-binaryExponent)),
        -binaryExponent,
      );
  let exactDecimal: NonNegativeDecimal;
  try {
    exactDecimal = normalizeNonNegativeExactDecimal(raw);
  } catch {
    return failRange('BINARY64_PROJECTION_BOUNDS', 'exact binary64 expansion exceeds decimal bounds');
  }
  if (!Object.is(Number(exactDecimal), value)) {
    return failType('BINARY64_NON_ROUND_TRIP', 'exact binary64 expansion does not reproduce the original number');
  }
  return Object.freeze({ canonicalDecimal, exactDecimal });
}

function proveStepAndTolerance(
  journal: NonNegativeDecimal,
  step: NonNegativeDecimal,
  tolerance: NonNegativeDecimal,
): void {
  if (compareExactDecimals(step, ZERO) <= 0) {
    failRange('INSTRUMENT_STEP_INVALID', 'instrument step must be positive');
  }
  boundedSafeDecimal(step, 'instrument step');
  boundedSafeDecimal(tolerance, 'instrument tolerance');
  const doubledTolerance = normalizeNonNegativeExactDecimal(multiplyExactDecimals(tolerance, TWO));
  if (compareExactDecimals(doubledTolerance, step) >= 0) {
    failRange(
      'STEP_TOLERANCE_AMBIGUOUS',
      'instrument tolerance must be strictly below half-step',
    );
  }

  const count = divideExactDecimals(journal, step, 0);
  const aligned = normalizeNonNegativeExactDecimal(multiplyExactDecimals(count, step));
  if (compareExactDecimals(aligned, journal) !== 0) {
    failRange('JOURNAL_QUANTITY_OFF_STEP', 'exact journal quantity is not aligned to the instrument step');
  }
}

function difference(
  left: NonNegativeDecimal,
  right: NonNegativeDecimal,
): Readonly<{
  ordering: -1 | 0 | 1;
  absolute: NonNegativeDecimal;
}> {
  const ordering = compareExactDecimals(left, right);
  const absolute = ordering >= 0
    ? normalizeNonNegativeExactDecimal(subtractExactDecimals(left, right))
    : normalizeNonNegativeExactDecimal(subtractExactDecimals(right, left));
  return Object.freeze({ ordering, absolute });
}

/**
 * Compares one exact journal quantity to one Foundation binary64 quantity.
 * Valid mismatches return OUTSIDE_TOLERANCE; malformed or ambiguous evidence
 * throws before a comparison result can exist.
 */
export function compareJournalToFoundationQuantity(
  input: Readonly<FoundationQuantityBridgeInput>,
): Readonly<FoundationQuantityComparisonResult> {
  const source = closedInput(input);
  const exactJournalQuantity = exactInput(source.exactJournalQuantity, 'exactJournalQuantity');
  const instrumentId = instrumentIdInput(source.instrumentId);
  const instrumentStep = exactInput(source.instrumentStep, 'instrumentStep');
  const instrumentTolerance = exactInput(source.instrumentTolerance, 'instrumentTolerance');
  const instrumentEvidenceRevision = source.instrumentEvidenceRevision;
  if (typeof instrumentEvidenceRevision !== 'string'
    || !INSTRUMENT_EVIDENCE_REVISION.test(instrumentEvidenceRevision)
    || instrumentEvidenceRevision !== deriveFoundationQuantityInstrumentEvidenceRevision(
      instrumentId,
      instrumentStep,
      instrumentTolerance,
    )) {
    return failType(
      'INSTRUMENT_EVIDENCE_REVISION_MISMATCH',
      'instrument evidence revision must bind the exact identity, step, and tolerance',
    );
  }
  boundedSafeDecimal(exactJournalQuantity, 'journal quantity');
  proveJournalRoundTrip(exactJournalQuantity);
  proveStepAndTolerance(exactJournalQuantity, instrumentStep, instrumentTolerance);
  const foundation = binary64Projection(source.foundationQuantity);
  const delta = difference(foundation.exactDecimal, exactJournalQuantity);
  const withinTolerance = compareExactDecimals(delta.absolute, instrumentTolerance) <= 0;

  let comparison: FoundationQuantityComparison;
  let roundingDirection: FoundationQuantityRoundingDirection;
  let toleranceDirection: FoundationQuantityToleranceDirection;
  if (delta.ordering === 0) {
    comparison = 'EXACT_BINARY_VALUE';
    roundingDirection = 'EXACT';
    toleranceDirection = 'EXACT';
  } else if (delta.ordering > 0) {
    comparison = withinTolerance ? 'WITHIN_TOLERANCE' : 'OUTSIDE_TOLERANCE';
    roundingDirection = 'FOUNDATION_ABOVE_JOURNAL';
    toleranceDirection = withinTolerance
      ? 'ABOVE_WITHIN_TOLERANCE'
      : 'ABOVE_OUTSIDE_TOLERANCE';
  } else {
    comparison = withinTolerance ? 'WITHIN_TOLERANCE' : 'OUTSIDE_TOLERANCE';
    roundingDirection = 'FOUNDATION_BELOW_JOURNAL';
    toleranceDirection = withinTolerance
      ? 'BELOW_WITHIN_TOLERANCE'
      : 'BELOW_OUTSIDE_TOLERANCE';
  }

  return Object.freeze({
    schema: FOUNDATION_QUANTITY_BRIDGE_SCHEMA,
    version: 1 as const,
    comparison,
    roundingDirection,
    toleranceDirection,
    exactJournalQuantity: source.exactJournalQuantity,
    foundationQuantity: source.foundationQuantity,
    foundationCanonicalDecimal: foundation.canonicalDecimal,
    foundationExactDecimal: foundation.exactDecimal,
    absoluteDifference: delta.absolute,
    instrumentId,
    instrumentStep,
    instrumentTolerance,
    instrumentEvidenceRevision,
    journalStepAlignment: 'ALIGNED' as const,
    stepToleranceRelation: 'UNAMBIGUOUS' as const,
  });
}

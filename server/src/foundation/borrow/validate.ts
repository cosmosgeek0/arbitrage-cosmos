/**
 * Exact, pure consumer boundary for BorrowTruth.
 *
 * Derivation owns the decision. Consumers still validate the immutable wire
 * shape, provenance cut, freshness, and authority before using a truth for
 * capital. This prevents a hand-shaped AVAILABLE object from bypassing the
 * private-account evidence law.
 */
import {
  evaluateFreshness,
  isValidUtcMillis,
  validateSourcedTimestamp,
  type DataAuthority,
  type FreshnessReport,
  type SourcedTimestamp,
} from '../contracts/index.js';
import { compareNonNegativeDecimals, normalizeNonNegativeDecimal } from './decimal.js';
import {
  BORROW_EVIDENCE_AUTHORITIES,
  BORROW_TRUTH_REASONS,
  BORROW_TRUTH_STATES,
  MARGIN_ACCOUNT_MODES,
  type BorrowEvidenceAuthority,
  type BorrowTruth,
} from './types.js';

export const BORROW_EVIDENCE_KEYS = [
  'account',
  'permission',
  'maxBorrow',
  'rate',
  'liability',
  'collateral',
] as const;
export type BorrowEvidenceKey = (typeof BORROW_EVIDENCE_KEYS)[number];

export const BORROW_TRUTH_KEYS = [
  'accountId',
  'symbol',
  'asset',
  'mode',
  'permissionId',
  'state',
  'reason',
  'positionBucket',
  'maxBorrowableAsset',
  'borrowLimitAsset',
  'hourlyRate',
  'currentBorrowedAsset',
  'accruedInterestAsset',
  'collateralAmount',
  'collateralAsset',
  'currentLtv',
  'evaluatedAtMs',
  'expiresAtMs',
  'provenance',
  'freshness',
] as const;

const TIMESTAMP_KEYS = [
  'sourceTimeMs',
  'receivedAtMs',
  'maxAgeMs',
  'authority',
  'completeness',
  'sourceId',
] as const;
const FRESHNESS_KEYS = ['state', 'ageMs', 'basis', 'effectiveAuthority', 'evaluatedAt'] as const;
const REQUIRED_EVIDENCE_KEYS = ['account', 'permission', 'maxBorrow', 'liability'] as const;
const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SYMBOL = /^[A-Z0-9]{2,30}$/;
const ASSET = /^[A-Z0-9]{1,20}$/;
const PERMISSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface BorrowTruthConsumptionPolicy {
  /** Injected live, replay-virtual, or test clock at the consuming boundary. */
  evaluatedAtMs: number;
  /** Explicit subset of private/replay/test authorities admitted in this mode. */
  acceptedAuthorities: readonly BorrowEvidenceAuthority[];
  /** Capital economics needs rate; account capital currently does not. */
  requireRate: boolean;
}

function exactDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const expected = new Set(expectedKeys);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expected.has(key))
  ) {
    return null;
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) return null;
  }
  return value as Record<string, unknown>;
}

function canonicalNullableDecimal(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  try {
    return normalizeNonNegativeDecimal(value, 'BorrowTruth decimal') === value;
  } catch {
    return false;
  }
}

function sameFreshness(left: Record<string, unknown>, right: Readonly<FreshnessReport>): boolean {
  return left.state === right.state
    && left.ageMs === right.ageMs
    && left.basis === right.basis
    && left.effectiveAuthority === right.effectiveAuthority
    && left.evaluatedAt === right.evaluatedAt;
}

function validatePolicy(policy: BorrowTruthConsumptionPolicy): void {
  if (!isValidUtcMillis(policy.evaluatedAtMs)) {
    throw new TypeError('BorrowTruth consumption policy evaluatedAtMs must be injected valid UTC milliseconds');
  }
  if (!Array.isArray(policy.acceptedAuthorities) || policy.acceptedAuthorities.length === 0) {
    throw new TypeError('BorrowTruth consumption policy must admit at least one explicit evidence authority');
  }
  if (
    policy.acceptedAuthorities.some(
      (authority) => !(BORROW_EVIDENCE_AUTHORITIES as readonly string[]).includes(authority),
    )
    || new Set(policy.acceptedAuthorities).size !== policy.acceptedAuthorities.length
  ) {
    throw new TypeError('BorrowTruth consumption policy authorities must be unique private/replay/test authorities');
  }
  if (typeof policy.requireRate !== 'boolean') {
    throw new TypeError('BorrowTruth consumption policy requireRate must be boolean');
  }
}

/**
 * Empty means the truth is an exact, current, authorized AVAILABLE cut for the
 * supplied consumer policy. Issues are stable strings and the returned array
 * is sorted, unique, and frozen.
 */
export function validateBorrowTruthForConsumption(
  value: unknown,
  policy: BorrowTruthConsumptionPolicy,
): readonly string[] {
  validatePolicy(policy);
  const issues: string[] = [];
  const truth = exactDataRecord(value, BORROW_TRUTH_KEYS);
  if (truth === null) return Object.freeze(['BORROW_TRUTH_SCHEMA_INVALID']);

  const provenance = exactDataRecord(truth.provenance, BORROW_EVIDENCE_KEYS);
  const freshness = exactDataRecord(truth.freshness, BORROW_EVIDENCE_KEYS);
  if (provenance === null) issues.push('BORROW_TRUTH_PROVENANCE_SCHEMA_INVALID');
  if (freshness === null) issues.push('BORROW_TRUTH_FRESHNESS_SCHEMA_INVALID');
  if (provenance === null || freshness === null) return Object.freeze(issues.sort());

  if (typeof truth.accountId !== 'string' || !ACCOUNT_ID.test(truth.accountId)) {
    issues.push('BORROW_TRUTH_ACCOUNT_ID_INVALID');
  }
  if (typeof truth.symbol !== 'string' || !SYMBOL.test(truth.symbol)) {
    issues.push('BORROW_TRUTH_SYMBOL_INVALID');
  }
  if (typeof truth.asset !== 'string' || !ASSET.test(truth.asset)) {
    issues.push('BORROW_TRUTH_ASSET_INVALID');
  }
  if (
    typeof truth.mode !== 'string'
    || !(MARGIN_ACCOUNT_MODES as readonly string[]).includes(truth.mode)
  ) {
    issues.push('BORROW_TRUTH_MODE_INVALID');
  }
  if (typeof truth.permissionId !== 'string' || !PERMISSION_ID.test(truth.permissionId)) {
    issues.push('BORROW_TRUTH_PERMISSION_ID_INVALID');
  }
  if (
    typeof truth.state !== 'string'
    || !(BORROW_TRUTH_STATES as readonly string[]).includes(truth.state)
  ) {
    issues.push('BORROW_TRUTH_STATE_INVALID');
  }
  if (
    typeof truth.reason !== 'string'
    || !(BORROW_TRUTH_REASONS as readonly string[]).includes(truth.reason)
  ) {
    issues.push('BORROW_TRUTH_REASON_INVALID');
  }
  const expectedBucket = truth.mode === 'ISOLATED' ? 'MARGIN_ISOLATED' : 'MARGIN_CROSS';
  if (truth.positionBucket !== expectedBucket) issues.push('BORROW_TRUTH_POSITION_BUCKET_INVALID');

  for (const key of [
    'maxBorrowableAsset',
    'borrowLimitAsset',
    'hourlyRate',
    'currentBorrowedAsset',
    'accruedInterestAsset',
    'collateralAmount',
    'currentLtv',
  ] as const) {
    if (!canonicalNullableDecimal(truth[key])) issues.push(`BORROW_TRUTH_${key.toUpperCase()}_INVALID`);
  }
  if (truth.collateralAsset !== null && (typeof truth.collateralAsset !== 'string' || !ASSET.test(truth.collateralAsset))) {
    issues.push('BORROW_TRUTH_COLLATERAL_ASSET_INVALID');
  }
  if ((truth.collateralAmount === null) !== (truth.collateralAsset === null)) {
    issues.push('BORROW_TRUTH_COLLATERAL_PAIR_INVALID');
  }
  if (
    typeof truth.maxBorrowableAsset === 'string'
    && typeof truth.borrowLimitAsset === 'string'
  ) {
    try {
      if (compareNonNegativeDecimals(truth.maxBorrowableAsset, truth.borrowLimitAsset) > 0) {
        issues.push('BORROW_TRUTH_MAX_BORROW_EXCEEDS_LIMIT');
      }
    } catch {
      // Canonical decimal issues above already describe malformed values.
    }
  }
  if (typeof truth.currentLtv === 'string') {
    try {
      if (compareNonNegativeDecimals(truth.currentLtv, '1') > 0) {
        issues.push('BORROW_TRUTH_CURRENT_LTV_OUT_OF_RANGE');
      }
    } catch {
      // Canonical decimal issues above already describe malformed values.
    }
  }
  if (!isValidUtcMillis(truth.evaluatedAtMs)) issues.push('BORROW_TRUTH_EVALUATED_AT_INVALID');
  if (truth.expiresAtMs !== null && !isValidUtcMillis(truth.expiresAtMs)) {
    issues.push('BORROW_TRUTH_EXPIRES_AT_INVALID');
  }

  const sources = new Map<BorrowEvidenceKey, Readonly<SourcedTimestamp>>();
  const reports = new Map<BorrowEvidenceKey, Readonly<FreshnessReport>>();
  for (const key of BORROW_EVIDENCE_KEYS) {
    const sourceValue = provenance[key];
    const reportValue = freshness[key];
    if ((sourceValue === null) !== (reportValue === null)) {
      issues.push(`BORROW_TRUTH_${key.toUpperCase()}_EVIDENCE_PAIR_INVALID`);
      continue;
    }
    if (sourceValue === null && reportValue === null) continue;
    const sourceRecord = exactDataRecord(sourceValue, TIMESTAMP_KEYS);
    const reportRecord = exactDataRecord(reportValue, FRESHNESS_KEYS);
    if (sourceRecord === null || validateSourcedTimestamp(sourceRecord).length > 0) {
      issues.push(`BORROW_TRUTH_${key.toUpperCase()}_SOURCE_SCHEMA_INVALID`);
      continue;
    }
    if (reportRecord === null) {
      issues.push(`BORROW_TRUTH_${key.toUpperCase()}_FRESHNESS_SCHEMA_INVALID`);
      continue;
    }
    const source = sourceRecord as unknown as Readonly<SourcedTimestamp>;
    const report = reportRecord as unknown as Readonly<FreshnessReport>;
    sources.set(key, source);
    reports.set(key, report);
    if (isValidUtcMillis(truth.evaluatedAtMs)) {
      const expected = evaluateFreshness(source, truth.evaluatedAtMs);
      if (!sameFreshness(reportRecord, expected)) {
        issues.push(`BORROW_TRUTH_${key.toUpperCase()}_FRESHNESS_MISMATCH`);
      }
    }
  }

  if (truth.state !== 'AVAILABLE') {
    return Object.freeze([...new Set(issues)].sort());
  }

  if (truth.reason !== 'BORROW_AMOUNT_POSITIVE') {
    issues.push('BORROW_TRUTH_AVAILABLE_REASON_INVALID');
  }
  if (typeof truth.maxBorrowableAsset !== 'string') {
    issues.push('BORROW_TRUTH_AVAILABLE_MAX_BORROW_MISSING');
  } else {
    try {
      if (compareNonNegativeDecimals(truth.maxBorrowableAsset, '0') <= 0) {
        issues.push('BORROW_TRUTH_AVAILABLE_MAX_BORROW_NOT_POSITIVE');
      }
    } catch {
      // Canonical decimal issue already recorded.
    }
  }
  if (typeof truth.currentBorrowedAsset !== 'string') {
    issues.push('BORROW_TRUTH_AVAILABLE_CURRENT_BORROW_MISSING');
  }
  if (typeof truth.accruedInterestAsset !== 'string') {
    issues.push('BORROW_TRUTH_AVAILABLE_ACCRUED_INTEREST_MISSING');
  }
  if (policy.requireRate && typeof truth.hourlyRate !== 'string') {
    issues.push('BORROW_TRUTH_AVAILABLE_RATE_MISSING');
  }
  if (
    !isValidUtcMillis(truth.evaluatedAtMs)
    || truth.evaluatedAtMs > policy.evaluatedAtMs
    || !isValidUtcMillis(truth.expiresAtMs)
    || policy.evaluatedAtMs > truth.expiresAtMs
  ) {
    issues.push('BORROW_TRUTH_NOT_CURRENT');
  }

  const requiredKeys = new Set<BorrowEvidenceKey>(REQUIRED_EVIDENCE_KEYS);
  if (sources.has('rate') || policy.requireRate) requiredKeys.add('rate');
  const collateralPublished = truth.collateralAmount !== null
    || truth.collateralAsset !== null
    || truth.currentLtv !== null;
  if (collateralPublished) requiredKeys.add('collateral');

  const cutAuthorities: DataAuthority[] = [];
  for (const [key, source] of sources) {
    if (source.authority !== 'UNAVAILABLE') {
      cutAuthorities.push(source.authority);
      if (!(BORROW_EVIDENCE_AUTHORITIES as readonly string[]).includes(source.authority)) {
        issues.push(`BORROW_TRUTH_${key.toUpperCase()}_PRIVATE_AUTHORITY_REQUIRED`);
      } else if (!(policy.acceptedAuthorities as readonly string[]).includes(source.authority)) {
        issues.push(`BORROW_TRUTH_${key.toUpperCase()}_AUTHORITY_NOT_ACCEPTED`);
      }
    }
  }
  if (new Set(cutAuthorities).size > 1) issues.push('BORROW_TRUTH_EVIDENCE_AUTHORITY_MISMATCH');

  for (const key of requiredKeys) {
    const source = sources.get(key);
    const report = reports.get(key);
    if (source === undefined || report === undefined) {
      issues.push(`BORROW_TRUTH_${key.toUpperCase()}_EVIDENCE_MISSING`);
      continue;
    }
    if (source.completeness !== 'COMPLETE') {
      issues.push(`BORROW_TRUTH_${key.toUpperCase()}_EVIDENCE_INCOMPLETE`);
    }
    if (!(policy.acceptedAuthorities as readonly string[]).includes(source.authority)) {
      issues.push(`BORROW_TRUTH_${key.toUpperCase()}_AUTHORITY_NOT_ACCEPTED`);
    }
    if (report.state !== 'FRESH') {
      issues.push(`BORROW_TRUTH_${key.toUpperCase()}_EVIDENCE_NOT_FRESH`);
    }
    // Optional collateral/LTV is a historical fact on the BorrowTruth cut,
    // not part of the required preflight lifetime. It must have been fresh at
    // truth derivation, but it cannot later expire an otherwise current
    // account/permission/max-borrow/liability cut.
    if (key !== 'collateral' && evaluateFreshness(source, policy.evaluatedAtMs).state !== 'FRESH') {
      issues.push(`BORROW_TRUTH_${key.toUpperCase()}_EVIDENCE_EXPIRED`);
    }
  }

  if (isValidUtcMillis(truth.evaluatedAtMs)) {
    const expirySources = [...REQUIRED_EVIDENCE_KEYS, ...(sources.has('rate') ? (['rate'] as const) : [])]
      .map((key) => sources.get(key))
      .filter((source): source is Readonly<SourcedTimestamp> => source !== undefined);
    if (expirySources.length === REQUIRED_EVIDENCE_KEYS.length + (sources.has('rate') ? 1 : 0)) {
      let expectedExpiry = Number.POSITIVE_INFINITY;
      for (const source of expirySources) {
        const basis = source.sourceTimeMs ?? source.receivedAtMs;
        const expiry = basis + source.maxAgeMs;
        if (!Number.isSafeInteger(expiry)) {
          issues.push('BORROW_TRUTH_EXPIRY_OUT_OF_RANGE');
          expectedExpiry = Number.NaN;
          break;
        }
        expectedExpiry = Math.min(expectedExpiry, expiry);
      }
      if (Number.isFinite(expectedExpiry) && truth.expiresAtMs !== expectedExpiry) {
        issues.push('BORROW_TRUTH_EXPIRY_MISMATCH');
      }
    }
  }

  return Object.freeze([...new Set(issues)].sort());
}

/** Compile-time assertion that the exact key law covers the public type. */
const _borrowTruthKeysCoverType: readonly (keyof BorrowTruth)[] = BORROW_TRUTH_KEYS;
void _borrowTruthKeysCoverType;

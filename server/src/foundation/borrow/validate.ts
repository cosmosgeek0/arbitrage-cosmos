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
  isDataAuthority,
  isFreshnessState,
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

export interface BorrowTruthConsumptionResult {
  /** Stable, sorted, immutable fail-closed reasons. */
  readonly issues: readonly string[];
  /**
   * One deeply frozen exact-key snapshot captured from the caller exactly
   * once. Null means structural capture failed and the caller must reject.
   */
  readonly truth: Readonly<BorrowTruth> | null;
}

/**
 * Capture data descriptors once. In particular, never validate a caller
 * object and then read its properties again: a Proxy could otherwise change
 * a value between validation and consumption.
 */
function captureExactDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const expected = new Set(expectedKeys);
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length
      || keys.some((key) => typeof key !== 'string' || !expected.has(key))
    ) {
      return null;
    }
    const captured: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor
        || !('value' in descriptor)
        || descriptor.get
        || descriptor.set
        || !descriptor.enumerable
      ) {
        return null;
      }
      Object.defineProperty(captured, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(captured);
  } catch {
    // Revoked or invariant-violating Proxies fail closed without a later read.
    return null;
  }
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

function sameFreshness(left: Readonly<Record<string, unknown>>, right: Readonly<FreshnessReport>): boolean {
  return left.state === right.state
    && left.ageMs === right.ageMs
    && left.basis === right.basis
    && left.effectiveAuthority === right.effectiveAuthority
    && left.evaluatedAt === right.evaluatedAt;
}

function validFreshnessRecord(value: Readonly<Record<string, unknown>>): boolean {
  return isFreshnessState(value.state)
    && (value.ageMs === null || (typeof value.ageMs === 'number' && Number.isSafeInteger(value.ageMs)))
    && (value.basis === 'SOURCE_TIME' || value.basis === 'RECEIPT_TIME' || value.basis === 'NONE')
    && isDataAuthority(value.effectiveAuthority)
    && isValidUtcMillis(value.evaluatedAt)
    && ((value.basis === 'NONE') === (value.ageMs === null));
}

function finish(
  issues: readonly string[],
  truth: Readonly<BorrowTruth> | null,
): Readonly<BorrowTruthConsumptionResult> {
  const stableIssues = Object.freeze([...new Set(issues)].sort());
  return Object.freeze({ issues: stableIssues, truth });
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
 * Validate and capture one consumer-owned BorrowTruth snapshot. The caller's
 * object is never returned and is never read again after the descriptor
 * capture. A null snapshot is a structural rejection; a non-null snapshot may
 * still carry semantic issues and must not be used when `issues` is non-empty.
 */
export function validateBorrowTruthForConsumption(
  value: unknown,
  policy: BorrowTruthConsumptionPolicy,
): Readonly<BorrowTruthConsumptionResult> {
  validatePolicy(policy);
  const issues: string[] = [];
  let structurallySafe = true;
  const structuralIssue = (issue: string): void => {
    issues.push(issue);
    structurallySafe = false;
  };

  const record = captureExactDataRecord(value, BORROW_TRUTH_KEYS);
  if (record === null) return finish(['BORROW_TRUTH_SCHEMA_INVALID'], null);
  const capturedProvenance = captureExactDataRecord(record.provenance, BORROW_EVIDENCE_KEYS);
  const capturedFreshness = captureExactDataRecord(record.freshness, BORROW_EVIDENCE_KEYS);
  if (capturedProvenance === null) structuralIssue('BORROW_TRUTH_PROVENANCE_SCHEMA_INVALID');
  if (capturedFreshness === null) structuralIssue('BORROW_TRUTH_FRESHNESS_SCHEMA_INVALID');
  if (capturedProvenance === null || capturedFreshness === null) return finish(issues, null);

  if (typeof record.accountId !== 'string' || !ACCOUNT_ID.test(record.accountId)) {
    structuralIssue('BORROW_TRUTH_ACCOUNT_ID_INVALID');
  }
  if (typeof record.symbol !== 'string' || !SYMBOL.test(record.symbol)) {
    structuralIssue('BORROW_TRUTH_SYMBOL_INVALID');
  }
  if (typeof record.asset !== 'string' || !ASSET.test(record.asset)) {
    structuralIssue('BORROW_TRUTH_ASSET_INVALID');
  }
  if (
    typeof record.mode !== 'string'
    || !(MARGIN_ACCOUNT_MODES as readonly string[]).includes(record.mode)
  ) {
    structuralIssue('BORROW_TRUTH_MODE_INVALID');
  }
  if (typeof record.permissionId !== 'string' || !PERMISSION_ID.test(record.permissionId)) {
    structuralIssue('BORROW_TRUTH_PERMISSION_ID_INVALID');
  }
  if (
    typeof record.state !== 'string'
    || !(BORROW_TRUTH_STATES as readonly string[]).includes(record.state)
  ) {
    structuralIssue('BORROW_TRUTH_STATE_INVALID');
  }
  if (
    typeof record.reason !== 'string'
    || !(BORROW_TRUTH_REASONS as readonly string[]).includes(record.reason)
  ) {
    structuralIssue('BORROW_TRUTH_REASON_INVALID');
  }
  const expectedBucket = record.mode === 'ISOLATED' ? 'MARGIN_ISOLATED' : 'MARGIN_CROSS';
  if (record.positionBucket !== expectedBucket) structuralIssue('BORROW_TRUTH_POSITION_BUCKET_INVALID');

  for (const key of [
    'maxBorrowableAsset',
    'borrowLimitAsset',
    'hourlyRate',
    'currentBorrowedAsset',
    'accruedInterestAsset',
    'collateralAmount',
    'currentLtv',
  ] as const) {
    if (!canonicalNullableDecimal(record[key])) structuralIssue(`BORROW_TRUTH_${key.toUpperCase()}_INVALID`);
  }
  if (
    record.collateralAsset !== null
    && (typeof record.collateralAsset !== 'string' || !ASSET.test(record.collateralAsset))
  ) {
    structuralIssue('BORROW_TRUTH_COLLATERAL_ASSET_INVALID');
  }
  if (!isValidUtcMillis(record.evaluatedAtMs)) structuralIssue('BORROW_TRUTH_EVALUATED_AT_INVALID');
  if (record.expiresAtMs !== null && !isValidUtcMillis(record.expiresAtMs)) {
    structuralIssue('BORROW_TRUTH_EXPIRES_AT_INVALID');
  }

  const sourceSnapshots: Record<BorrowEvidenceKey, Readonly<SourcedTimestamp> | null> = {
    account: null,
    permission: null,
    maxBorrow: null,
    rate: null,
    liability: null,
    collateral: null,
  };
  const reportSnapshots: Record<BorrowEvidenceKey, Readonly<FreshnessReport> | null> = {
    account: null,
    permission: null,
    maxBorrow: null,
    rate: null,
    liability: null,
    collateral: null,
  };
  const sources = new Map<BorrowEvidenceKey, Readonly<SourcedTimestamp>>();
  const reports = new Map<BorrowEvidenceKey, Readonly<FreshnessReport>>();
  for (const key of BORROW_EVIDENCE_KEYS) {
    const sourceValue = capturedProvenance[key];
    const reportValue = capturedFreshness[key];
    if ((sourceValue === null) !== (reportValue === null)) {
      issues.push(`BORROW_TRUTH_${key.toUpperCase()}_EVIDENCE_PAIR_INVALID`);
    }
    if (sourceValue !== null) {
      const sourceRecord = captureExactDataRecord(sourceValue, TIMESTAMP_KEYS);
      if (sourceRecord === null || validateSourcedTimestamp(sourceRecord).length > 0) {
        structuralIssue(`BORROW_TRUTH_${key.toUpperCase()}_SOURCE_SCHEMA_INVALID`);
      } else {
        const source = sourceRecord as unknown as Readonly<SourcedTimestamp>;
        sourceSnapshots[key] = source;
        sources.set(key, source);
      }
    }
    if (reportValue !== null) {
      const reportRecord = captureExactDataRecord(reportValue, FRESHNESS_KEYS);
      if (reportRecord === null || !validFreshnessRecord(reportRecord)) {
        structuralIssue(`BORROW_TRUTH_${key.toUpperCase()}_FRESHNESS_SCHEMA_INVALID`);
      } else {
        const report = reportRecord as unknown as Readonly<FreshnessReport>;
        reportSnapshots[key] = report;
        reports.set(key, report);
      }
    }
    const source = sources.get(key);
    const report = reports.get(key);
    if (source !== undefined && report !== undefined && isValidUtcMillis(record.evaluatedAtMs)) {
      const expected = evaluateFreshness(source, record.evaluatedAtMs);
      if (!sameFreshness(report as unknown as Readonly<Record<string, unknown>>, expected)) {
        issues.push(`BORROW_TRUTH_${key.toUpperCase()}_FRESHNESS_MISMATCH`);
      }
    }
  }
  if (!structurallySafe) return finish(issues, null);

  const provenance = Object.freeze({ ...sourceSnapshots });
  const freshness = Object.freeze({ ...reportSnapshots });
  const truth = Object.freeze({
    accountId: record.accountId as string,
    symbol: record.symbol as string,
    asset: record.asset as string,
    mode: record.mode as BorrowTruth['mode'],
    permissionId: record.permissionId as string,
    state: record.state as BorrowTruth['state'],
    reason: record.reason as BorrowTruth['reason'],
    positionBucket: record.positionBucket as BorrowTruth['positionBucket'],
    maxBorrowableAsset: record.maxBorrowableAsset as string | null,
    borrowLimitAsset: record.borrowLimitAsset as string | null,
    hourlyRate: record.hourlyRate as string | null,
    currentBorrowedAsset: record.currentBorrowedAsset as string | null,
    accruedInterestAsset: record.accruedInterestAsset as string | null,
    collateralAmount: record.collateralAmount as string | null,
    collateralAsset: record.collateralAsset as string | null,
    currentLtv: record.currentLtv as string | null,
    evaluatedAtMs: record.evaluatedAtMs as number,
    expiresAtMs: record.expiresAtMs as number | null,
    provenance,
    freshness,
  }) satisfies Readonly<BorrowTruth>;

  if ((truth.collateralAmount === null) !== (truth.collateralAsset === null)) {
    issues.push('BORROW_TRUTH_COLLATERAL_PAIR_INVALID');
  }
  if (
    truth.maxBorrowableAsset !== null
    && truth.borrowLimitAsset !== null
    && compareNonNegativeDecimals(truth.maxBorrowableAsset, truth.borrowLimitAsset) > 0
  ) {
    issues.push('BORROW_TRUTH_MAX_BORROW_EXCEEDS_LIMIT');
  }
  if (truth.currentLtv !== null && compareNonNegativeDecimals(truth.currentLtv, '1') > 0) {
    issues.push('BORROW_TRUTH_CURRENT_LTV_OUT_OF_RANGE');
  }

  if (truth.state !== 'AVAILABLE') return finish(issues, truth);
  if (truth.reason !== 'BORROW_AMOUNT_POSITIVE') issues.push('BORROW_TRUTH_AVAILABLE_REASON_INVALID');
  if (truth.maxBorrowableAsset === null) {
    issues.push('BORROW_TRUTH_AVAILABLE_MAX_BORROW_MISSING');
  } else if (compareNonNegativeDecimals(truth.maxBorrowableAsset, '0') <= 0) {
    issues.push('BORROW_TRUTH_AVAILABLE_MAX_BORROW_NOT_POSITIVE');
  }
  if (truth.currentBorrowedAsset === null) {
    issues.push('BORROW_TRUTH_AVAILABLE_CURRENT_BORROW_MISSING');
  }
  if (truth.accruedInterestAsset === null) {
    issues.push('BORROW_TRUTH_AVAILABLE_ACCRUED_INTEREST_MISSING');
  }
  if (policy.requireRate && truth.hourlyRate === null) {
    issues.push('BORROW_TRUTH_AVAILABLE_RATE_MISSING');
  }
  if (
    truth.evaluatedAtMs > policy.evaluatedAtMs
    || truth.expiresAtMs === null
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
    // not part of the required preflight lifetime.
    if (key !== 'collateral' && evaluateFreshness(source, policy.evaluatedAtMs).state !== 'FRESH') {
      issues.push(`BORROW_TRUTH_${key.toUpperCase()}_EVIDENCE_EXPIRED`);
    }
  }

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

  return finish(issues, truth);
}

/** Compile-time assertion that the exact key law covers the public type. */
const _borrowTruthKeysCoverType: readonly (keyof BorrowTruth)[] = BORROW_TRUTH_KEYS;
void _borrowTruthKeysCoverType;

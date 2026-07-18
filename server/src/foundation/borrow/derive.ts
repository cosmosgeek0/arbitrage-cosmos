/**
 * Lane J — pure read-only borrow truth derivation.
 *
 * This module deliberately has no API client, environment access, timers, or
 * capital-action surface. Adapters provide already-read evidence; this module
 * validates its identity and derives one expiring truth state against `nowMs`.
 */
import {
  createSourcedTimestamp,
  evaluateFreshness,
  isValidUtcMillis,
  validateSourcedTimestamp,
  type FreshnessReport,
  type SourcedTimestamp,
} from '../contracts/index.js';
import { compareNonNegativeDecimals, normalizeNonNegativeDecimal } from './decimal.js';
import {
  BORROW_COLLATERAL_PRODUCTS,
  BORROW_READ_STATUSES,
  MARGIN_ACCOUNT_MODES,
  type BorrowAccountEvidence,
  type BorrowCollateralEvidence,
  type BorrowEvidenceProvenance,
  type BorrowFreshnessEvidence,
  type BorrowLiabilityEvidence,
  type BorrowPermissionEvidence,
  type BorrowRateEvidence,
  type BorrowReadEvidenceBase,
  type BorrowReadStatus,
  type BorrowScopeIdentity,
  type BorrowTruth,
  type BorrowTruthReason,
  type BorrowTruthState,
  type DeriveBorrowTruthInput,
  type MaxBorrowEvidence,
} from './types.js';

const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SYMBOL = /^[A-Z0-9]{2,30}$/;
const ASSET = /^[A-Z0-9]{1,20}$/;
const PERMISSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const SCOPE_KEYS = ['accountId', 'symbol', 'asset', 'mode', 'permissionId'] as const;
const TIMESTAMP_KEYS = [
  'sourceTimeMs',
  'receivedAtMs',
  'maxAgeMs',
  'authority',
  'completeness',
  'sourceId',
] as const;
const INPUT_KEYS = [
  'scope',
  'nowMs',
  'account',
  'permission',
  'maxBorrow',
  'rate',
  'liability',
  'collateral',
] as const;
const ACCOUNT_KEYS = [
  ...SCOPE_KEYS,
  'status',
  'observedAt',
  'accountCreated',
  'modeEnabled',
  'borrowEnabled',
] as const;
const PERMISSION_KEYS = [
  ...SCOPE_KEYS,
  'status',
  'observedAt',
  'enableReading',
  'enableMargin',
  'enableSpotAndMarginTrading',
] as const;
const MAX_BORROW_KEYS = [...SCOPE_KEYS, 'status', 'observedAt', 'amount', 'borrowLimit'] as const;
const RATE_KEYS = [...SCOPE_KEYS, 'status', 'observedAt', 'hourlyRate'] as const;
const LIABILITY_KEYS = [
  ...SCOPE_KEYS,
  'status',
  'observedAt',
  'currentBorrowedAsset',
  'accruedInterestAsset',
] as const;
const COLLATERAL_KEYS = [
  ...SCOPE_KEYS,
  'status',
  'observedAt',
  'product',
  'collateralAmount',
  'collateralAsset',
  'currentLtv',
] as const;

type AnyEvidence =
  | BorrowAccountEvidence
  | BorrowPermissionEvidence
  | MaxBorrowEvidence
  | BorrowRateEvidence
  | BorrowLiabilityEvidence
  | BorrowCollateralEvidence;

function isSupplied<T>(value: T | null): value is T {
  return value !== null;
}

interface NormalizedEvidence {
  account: BorrowAccountEvidence | null;
  permission: BorrowPermissionEvidence | null;
  maxBorrow: MaxBorrowEvidence | null;
  rate: BorrowRateEvidence | null;
  liability: BorrowLiabilityEvidence | null;
  collateral: BorrowCollateralEvidence | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${path} must be a plain object`);
}

/** Exact enumerable data records only; never invokes caller accessors. */
function assertExactDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): asserts value is Record<string, unknown> {
  assertRecord(value, path);
  const ownKeys = Reflect.ownKeys(value);
  const expected = new Set(expectedKeys);
  if (
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !expected.has(key))
  ) {
    throw new TypeError(`${path} must contain exactly the documented fields`);
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      throw new TypeError(`${path}.${key} must be an enumerable data field`);
    }
  }
}

function assertDenseInputArray(value: unknown): asserts value is readonly DeriveBorrowTruthInput[] {
  if (!Array.isArray(value)) throw new TypeError('inputs must be an array');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError('inputs must not carry symbol properties');
    if (key === 'length') continue;
    if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
      throw new TypeError('inputs must not carry named side-properties');
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      throw new TypeError('inputs must be dense enumerable data values');
    }
  }
}

function assertNullableBoolean(value: unknown, path: string): asserts value is boolean | null {
  if (value !== null && typeof value !== 'boolean') throw new TypeError(`${path} must be boolean or explicit null`);
}

function assertExplicitNullable(value: unknown, path: string): void {
  if (value === undefined) throw new TypeError(`${path} must be supplied; use explicit null when unknown`);
}

function validateScope(value: unknown, path: string): BorrowScopeIdentity {
  assertRecord(value, path);
  if (typeof value.accountId !== 'string' || !ACCOUNT_ID.test(value.accountId)) {
    throw new TypeError(`${path}.accountId is invalid`);
  }
  if (typeof value.symbol !== 'string' || !SYMBOL.test(value.symbol)) {
    throw new TypeError(`${path}.symbol must be an uppercase venue symbol`);
  }
  if (typeof value.asset !== 'string' || !ASSET.test(value.asset)) {
    throw new TypeError(`${path}.asset must be an uppercase venue asset`);
  }
  if (typeof value.mode !== 'string' || !(MARGIN_ACCOUNT_MODES as readonly string[]).includes(value.mode)) {
    throw new TypeError(`${path}.mode is invalid`);
  }
  if (typeof value.permissionId !== 'string' || !PERMISSION_ID.test(value.permissionId)) {
    throw new TypeError(`${path}.permissionId must be a non-secret permission snapshot identity`);
  }
  return Object.freeze({
    accountId: value.accountId,
    symbol: value.symbol,
    asset: value.asset,
    mode: value.mode as BorrowScopeIdentity['mode'],
    permissionId: value.permissionId,
  });
}

function cloneTimestamp(value: unknown, path: string): Readonly<SourcedTimestamp> {
  assertExactDataRecord(value, TIMESTAMP_KEYS, path);
  const issues = validateSourcedTimestamp(value);
  if (issues.length > 0) {
    throw new TypeError(`${path} is invalid: ${issues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`);
  }
  const timestamp = value as unknown as SourcedTimestamp;
  return createSourcedTimestamp({
    sourceTimeMs: timestamp.sourceTimeMs,
    receivedAtMs: timestamp.receivedAtMs,
    maxAgeMs: timestamp.maxAgeMs,
    authority: timestamp.authority,
    completeness: timestamp.completeness,
    sourceId: timestamp.sourceId,
  });
}

function validateBase(value: Record<string, unknown>, path: string): BorrowReadEvidenceBase {
  const scope = validateScope(value, path);
  if (typeof value.status !== 'string' || !(BORROW_READ_STATUSES as readonly string[]).includes(value.status)) {
    throw new TypeError(`${path}.status is invalid`);
  }
  return Object.freeze({
    ...scope,
    status: value.status as BorrowReadStatus,
    observedAt: cloneTimestamp(value.observedAt, `${path}.observedAt`),
  });
}

function ensureNoPayloadOnFailedRead(
  status: BorrowReadStatus,
  values: readonly unknown[],
  path: string,
): void {
  if (status !== 'OK' && values.some((value) => value !== null)) {
    throw new TypeError(`${path} cannot combine status ${status} with payload values`);
  }
}

function validateAccount(value: unknown): BorrowAccountEvidence | null {
  assertExplicitNullable(value, 'account');
  if (value === null) return null;
  assertExactDataRecord(value, ACCOUNT_KEYS, 'account');
  const base = validateBase(value, 'account');
  assertNullableBoolean(value.accountCreated, 'account.accountCreated');
  assertNullableBoolean(value.modeEnabled, 'account.modeEnabled');
  assertNullableBoolean(value.borrowEnabled, 'account.borrowEnabled');
  ensureNoPayloadOnFailedRead(base.status, [value.accountCreated, value.modeEnabled, value.borrowEnabled], 'account');
  return Object.freeze({
    ...base,
    accountCreated: value.accountCreated,
    modeEnabled: value.modeEnabled,
    borrowEnabled: value.borrowEnabled,
  });
}

function validatePermission(value: unknown): BorrowPermissionEvidence | null {
  assertExplicitNullable(value, 'permission');
  if (value === null) return null;
  assertExactDataRecord(value, PERMISSION_KEYS, 'permission');
  const base = validateBase(value, 'permission');
  assertNullableBoolean(value.enableReading, 'permission.enableReading');
  assertNullableBoolean(value.enableMargin, 'permission.enableMargin');
  assertNullableBoolean(value.enableSpotAndMarginTrading, 'permission.enableSpotAndMarginTrading');
  ensureNoPayloadOnFailedRead(
    base.status,
    [value.enableReading, value.enableMargin, value.enableSpotAndMarginTrading],
    'permission',
  );
  return Object.freeze({
    ...base,
    enableReading: value.enableReading,
    enableMargin: value.enableMargin,
    enableSpotAndMarginTrading: value.enableSpotAndMarginTrading,
  });
}

function normalizeNullableDecimal(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`${path} must be an exact decimal string or explicit null`);
  return normalizeNonNegativeDecimal(value, path);
}

function validateMaxBorrow(value: unknown): MaxBorrowEvidence | null {
  assertExplicitNullable(value, 'maxBorrow');
  if (value === null) return null;
  assertExactDataRecord(value, MAX_BORROW_KEYS, 'maxBorrow');
  const base = validateBase(value, 'maxBorrow');
  const amount = normalizeNullableDecimal(value.amount, 'maxBorrow.amount');
  const borrowLimit = normalizeNullableDecimal(value.borrowLimit, 'maxBorrow.borrowLimit');
  ensureNoPayloadOnFailedRead(base.status, [amount, borrowLimit], 'maxBorrow');
  if (amount !== null && borrowLimit !== null && compareNonNegativeDecimals(amount, borrowLimit) > 0) {
    throw new TypeError('maxBorrow.amount cannot exceed maxBorrow.borrowLimit');
  }
  return Object.freeze({ ...base, amount, borrowLimit });
}

function validateRate(value: unknown): BorrowRateEvidence | null {
  assertExplicitNullable(value, 'rate');
  if (value === null) return null;
  assertExactDataRecord(value, RATE_KEYS, 'rate');
  const base = validateBase(value, 'rate');
  const hourlyRate = normalizeNullableDecimal(value.hourlyRate, 'rate.hourlyRate');
  ensureNoPayloadOnFailedRead(base.status, [hourlyRate], 'rate');
  return Object.freeze({ ...base, hourlyRate });
}

function validateLiability(value: unknown): BorrowLiabilityEvidence | null {
  assertExplicitNullable(value, 'liability');
  if (value === null) return null;
  assertExactDataRecord(value, LIABILITY_KEYS, 'liability');
  const base = validateBase(value, 'liability');
  const currentBorrowedAsset = normalizeNullableDecimal(
    value.currentBorrowedAsset,
    'liability.currentBorrowedAsset',
  );
  const accruedInterestAsset = normalizeNullableDecimal(
    value.accruedInterestAsset,
    'liability.accruedInterestAsset',
  );
  ensureNoPayloadOnFailedRead(
    base.status,
    [currentBorrowedAsset, accruedInterestAsset],
    'liability',
  );
  return Object.freeze({ ...base, currentBorrowedAsset, accruedInterestAsset });
}

function validateCollateral(value: unknown): BorrowCollateralEvidence | null {
  assertExplicitNullable(value, 'collateral');
  if (value === null) return null;
  assertExactDataRecord(value, COLLATERAL_KEYS, 'collateral');
  const base = validateBase(value, 'collateral');
  if (
    typeof value.product !== 'string'
    || !(BORROW_COLLATERAL_PRODUCTS as readonly string[]).includes(value.product)
  ) {
    throw new TypeError('collateral.product must be MARGIN_ACCOUNT; flexible-loan evidence requires a separate owner');
  }
  const collateralAmount = normalizeNullableDecimal(value.collateralAmount, 'collateral.collateralAmount');
  const currentLtv = normalizeNullableDecimal(value.currentLtv, 'collateral.currentLtv');
  const collateralAsset = value.collateralAsset;
  if (collateralAsset !== null && (typeof collateralAsset !== 'string' || !ASSET.test(collateralAsset))) {
    throw new TypeError('collateral.collateralAsset must be an uppercase venue asset or explicit null');
  }
  if ((collateralAmount === null) !== (collateralAsset === null)) {
    throw new TypeError('collateral amount and asset must be supplied together');
  }
  if (currentLtv !== null && compareNonNegativeDecimals(currentLtv, '1') > 0) {
    throw new TypeError('collateral.currentLtv must be a fractional ratio between 0 and 1');
  }
  ensureNoPayloadOnFailedRead(
    base.status,
    [collateralAmount, collateralAsset, currentLtv],
    'collateral',
  );
  return Object.freeze({
    ...base,
    product: value.product as BorrowCollateralEvidence['product'],
    collateralAmount,
    collateralAsset,
    currentLtv,
  });
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function scopeKey(scope: BorrowScopeIdentity): string {
  return [scope.accountId, scope.mode, scope.symbol, scope.asset, scope.permissionId].join('\u0000');
}

function exactlyMatchesScope(scope: BorrowScopeIdentity, evidence: BorrowReadEvidenceBase): boolean {
  return (
    evidence.accountId === scope.accountId &&
    evidence.symbol === scope.symbol &&
    evidence.asset === scope.asset &&
    evidence.mode === scope.mode &&
    evidence.permissionId === scope.permissionId
  );
}

function identityOutcome(
  scope: BorrowScopeIdentity,
  evidence: NormalizedEvidence,
): { state: BorrowTruthState; reason: BorrowTruthReason } | null {
  for (const item of [
    evidence.account,
    evidence.permission,
    evidence.maxBorrow,
    evidence.rate,
    evidence.liability,
    evidence.collateral,
  ]) {
    if (item !== null && item.mode !== scope.mode) {
      return { state: 'ACCOUNT_MODE_MISMATCH', reason: 'MODE_IDENTITY_MISMATCH' };
    }
  }
  if (evidence.permission !== null && evidence.permission.permissionId !== scope.permissionId) {
    return { state: 'PERMISSION_MISSING', reason: 'PERMISSION_IDENTITY_MISMATCH' };
  }
  for (const item of [
    evidence.account,
    evidence.permission,
    evidence.maxBorrow,
    evidence.rate,
    evidence.liability,
    evidence.collateral,
  ]) {
    if (
      item !== null &&
      (item.accountId !== scope.accountId || item.symbol !== scope.symbol || item.asset !== scope.asset)
    ) {
      return { state: 'SOURCE_ERROR', reason: 'EVIDENCE_IDENTITY_MISMATCH' };
    }
  }
  for (const item of [
    evidence.account,
    evidence.maxBorrow,
    evidence.rate,
    evidence.liability,
    evidence.collateral,
  ]) {
    if (item !== null && item.permissionId !== scope.permissionId) {
      return { state: 'SOURCE_ERROR', reason: 'EVIDENCE_IDENTITY_MISMATCH' };
    }
  }
  return null;
}

function computeExpiry(items: readonly AnyEvidence[]): number | null {
  if (items.length === 0) return null;
  let earliest = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item.observedAt.authority === 'UNAVAILABLE' || item.observedAt.completeness === 'UNAVAILABLE') continue;
    const basis = item.observedAt.sourceTimeMs ?? item.observedAt.receivedAtMs;
    const expiresAt = basis + item.observedAt.maxAgeMs;
    if (!Number.isSafeInteger(expiresAt)) throw new TypeError('evidence expiry exceeds safe integer range');
    earliest = Math.min(earliest, expiresAt);
  }
  return Number.isFinite(earliest) ? earliest : null;
}

function cloneReports(
  evidence: NormalizedEvidence,
  nowMs: number,
): { provenance: BorrowEvidenceProvenance; freshness: BorrowFreshnessEvidence; reports: FreshnessReport[] } {
  const provenance: BorrowEvidenceProvenance = {
    account: evidence.account?.observedAt ?? null,
    permission: evidence.permission?.observedAt ?? null,
    maxBorrow: evidence.maxBorrow?.observedAt ?? null,
    rate: evidence.rate?.observedAt ?? null,
    liability: evidence.liability?.observedAt ?? null,
    collateral: evidence.collateral?.observedAt ?? null,
  };
  const freshness: BorrowFreshnessEvidence = {
    account: evidence.account === null ? null : evaluateFreshness(evidence.account.observedAt, nowMs),
    permission: evidence.permission === null ? null : evaluateFreshness(evidence.permission.observedAt, nowMs),
    maxBorrow: evidence.maxBorrow === null ? null : evaluateFreshness(evidence.maxBorrow.observedAt, nowMs),
    rate: evidence.rate === null ? null : evaluateFreshness(evidence.rate.observedAt, nowMs),
    liability: evidence.liability === null ? null : evaluateFreshness(evidence.liability.observedAt, nowMs),
    collateral: evidence.collateral === null ? null : evaluateFreshness(evidence.collateral.observedAt, nowMs),
  };
  return {
    provenance: Object.freeze(provenance),
    freshness: Object.freeze(freshness),
    reports: [
      freshness.account,
      freshness.permission,
      freshness.maxBorrow,
      freshness.rate,
      freshness.liability,
    ].filter(
      (value): value is FreshnessReport => value !== null,
    ),
  };
}

function buildTruth(
  scope: BorrowScopeIdentity,
  evidence: NormalizedEvidence,
  nowMs: number,
  state: BorrowTruthState,
  reason: BorrowTruthReason,
  provenance: BorrowEvidenceProvenance,
  freshness: BorrowFreshnessEvidence,
): Readonly<BorrowTruth> {
  const requiredSupplied = [
    evidence.account,
    evidence.permission,
    evidence.maxBorrow,
    evidence.rate,
    evidence.liability,
  ].filter(isSupplied);
  const usableCollateral = evidence.collateral !== null
    && exactlyMatchesScope(scope, evidence.collateral)
    && evidence.collateral.status === 'OK'
    && evidence.collateral.observedAt.completeness === 'COMPLETE'
    && freshness.collateral?.state === 'FRESH'
    ? evidence.collateral
    : null;
  return Object.freeze({
    ...scope,
    state,
    reason,
    positionBucket: scope.mode === 'ISOLATED' ? ('MARGIN_ISOLATED' as const) : ('MARGIN_CROSS' as const),
    // Never re-label a value under a scope it did not explicitly evidence.
    maxBorrowableAsset:
      evidence.maxBorrow !== null && exactlyMatchesScope(scope, evidence.maxBorrow)
        ? evidence.maxBorrow.amount
        : null,
    borrowLimitAsset:
      evidence.maxBorrow !== null && exactlyMatchesScope(scope, evidence.maxBorrow)
        ? evidence.maxBorrow.borrowLimit
        : null,
    hourlyRate:
      evidence.rate !== null && exactlyMatchesScope(scope, evidence.rate)
        ? evidence.rate.hourlyRate
        : null,
    currentBorrowedAsset:
      evidence.liability !== null && exactlyMatchesScope(scope, evidence.liability)
        ? evidence.liability.currentBorrowedAsset
        : null,
    accruedInterestAsset:
      evidence.liability !== null && exactlyMatchesScope(scope, evidence.liability)
        ? evidence.liability.accruedInterestAsset
        : null,
    collateralAmount:
      usableCollateral !== null
        ? usableCollateral.collateralAmount
        : null,
    collateralAsset:
      usableCollateral !== null
        ? usableCollateral.collateralAsset
        : null,
    currentLtv:
      usableCollateral !== null
        ? usableCollateral.currentLtv
        : null,
    evaluatedAtMs: nowMs,
    // ENGINE §11 makes collateral/LTV optional; it cannot shorten the
    // availability lifetime of the required margin preflight cut.
    expiresAtMs: computeExpiry(requiredSupplied),
    provenance,
    freshness,
  });
}

function sourceStatusOutcome(evidence: NormalizedEvidence): { state: BorrowTruthState; reason: BorrowTruthReason } | null {
  const statuses = [
    evidence.account,
    evidence.permission,
    evidence.maxBorrow,
    evidence.rate,
    evidence.liability,
  ]
    .filter(isSupplied)
    .map((item) => item.status);
  if (statuses.includes('SOURCE_ERROR')) return { state: 'SOURCE_ERROR', reason: 'SOURCE_REPORTED_ERROR' };
  if (statuses.includes('RATE_LIMITED')) return { state: 'RATE_LIMITED', reason: 'SOURCE_RATE_LIMITED' };
  if (statuses.includes('UNAVAILABLE')) return { state: 'UNAVAILABLE', reason: 'SOURCE_UNAVAILABLE' };
  return null;
}

/** Derive one immutable borrow truth from explicit, already-read evidence. */
export function deriveBorrowTruth(input: DeriveBorrowTruthInput): Readonly<BorrowTruth> {
  assertExactDataRecord(input, INPUT_KEYS, 'input');
  assertExactDataRecord(input.scope, SCOPE_KEYS, 'scope');
  const scope = validateScope(input.scope, 'scope');
  if (!isValidUtcMillis(input.nowMs)) throw new TypeError('nowMs must be injected valid UTC milliseconds');
  const evidence: NormalizedEvidence = Object.freeze({
    account: validateAccount(input.account),
    permission: validatePermission(input.permission),
    maxBorrow: validateMaxBorrow(input.maxBorrow),
    rate: validateRate(input.rate),
    liability: validateLiability(input.liability),
    collateral: validateCollateral(input.collateral),
  });
  const snapshots = cloneReports(evidence, input.nowMs);
  const finish = (state: BorrowTruthState, reason: BorrowTruthReason): Readonly<BorrowTruth> =>
    buildTruth(scope, evidence, input.nowMs, state, reason, snapshots.provenance, snapshots.freshness);

  const identity = identityOutcome(scope, evidence);
  if (identity !== null) return finish(identity.state, identity.reason);

  if (
    evidence.account === null
    || evidence.permission === null
    || evidence.maxBorrow === null
    || evidence.liability === null
  ) {
    return finish('UNKNOWN', 'REQUIRED_EVIDENCE_MISSING');
  }

  if (snapshots.reports.some((report) => report.state === 'CLOCK_SKEWED')) {
    return finish('SOURCE_ERROR', 'EVIDENCE_CLOCK_SKEWED');
  }
  if (snapshots.reports.some((report) => report.state === 'STALE')) {
    return finish('STALE', 'EVIDENCE_EXPIRED');
  }
  if (snapshots.reports.some((report) => report.state === 'UNAVAILABLE')) {
    return finish('UNAVAILABLE', 'SOURCE_UNAVAILABLE');
  }

  const sourceStatus = sourceStatusOutcome(evidence);
  if (sourceStatus !== null) return finish(sourceStatus.state, sourceStatus.reason);

  if (
    [
      evidence.account,
      evidence.permission,
      evidence.maxBorrow,
      evidence.rate,
      evidence.liability,
    ]
      .filter(isSupplied)
      .some((item) => item.observedAt.completeness === 'PARTIAL')
  ) {
    return finish('UNKNOWN', 'EVIDENCE_PARTIAL');
  }

  if (
    evidence.permission.enableReading === false ||
    evidence.permission.enableMargin === false ||
    evidence.permission.enableSpotAndMarginTrading === false
  ) {
    return finish('PERMISSION_MISSING', 'MARGIN_PERMISSION_DISABLED');
  }
  if (
    evidence.permission.enableReading === null ||
    evidence.permission.enableMargin === null ||
    evidence.permission.enableSpotAndMarginTrading === null
  ) {
    return finish('UNKNOWN', 'PERMISSION_UNKNOWN');
  }

  if (evidence.account.accountCreated === false) return finish('ACCOUNT_MODE_MISMATCH', 'ACCOUNT_NOT_CREATED');
  if (evidence.account.modeEnabled === false) return finish('ACCOUNT_MODE_MISMATCH', 'ACCOUNT_MODE_DISABLED');
  if (evidence.account.borrowEnabled === false) return finish('UNAVAILABLE', 'BORROW_DISABLED');
  if (
    evidence.account.accountCreated === null ||
    evidence.account.modeEnabled === null ||
    evidence.account.borrowEnabled === null
  ) {
    return finish('UNKNOWN', 'ACCOUNT_STATUS_UNKNOWN');
  }

  if (evidence.maxBorrow.amount === null) return finish('UNKNOWN', 'BORROW_AMOUNT_UNKNOWN');
  if (evidence.maxBorrow.amount === '0') return finish('UNAVAILABLE', 'BORROW_AMOUNT_ZERO');
  if (evidence.liability.currentBorrowedAsset === null) return finish('UNKNOWN', 'CURRENT_BORROW_UNKNOWN');
  if (evidence.liability.accruedInterestAsset === null) return finish('UNKNOWN', 'ACCRUED_INTEREST_UNKNOWN');
  return finish('AVAILABLE', 'BORROW_AMOUNT_POSITIVE');
}

/** Stable-sort a bounded batch and reject duplicate decision scopes. */
export function deriveBorrowTruthBatch(
  inputs: readonly DeriveBorrowTruthInput[],
): readonly Readonly<BorrowTruth>[] {
  assertDenseInputArray(inputs);
  if (inputs.length > 1_000) throw new TypeError('inputs must contain at most 1000 decisions');
  const seen = new Set<string>();
  const results: Readonly<BorrowTruth>[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const result = deriveBorrowTruth(inputs[index] as DeriveBorrowTruthInput);
    const key = scopeKey(result);
    if (seen.has(key)) throw new TypeError('inputs contain a duplicate borrow scope');
    seen.add(key);
    results.push(result);
  }
  results.sort((left, right) => compareCodeUnits(scopeKey(left), scopeKey(right)));
  return Object.freeze(results);
}

import {
  BORROW_TRUTH_STATES,
  MARGIN_ACCOUNT_MODES,
  type BorrowTruth,
} from '../../foundation/borrow/index.js';
import {
  createSourcedTimestamp,
  isDataAuthority,
  isFreshnessState,
  isValidUtcMillis,
  type FreshnessReport,
  type SourcedTimestamp,
} from '../../foundation/contracts/index.js';
import {
  absoluteExactDecimal,
  addExactDecimals,
  assessCapitalTruth,
  compareExactDecimals,
  maximumExactDecimal,
  multiplyExactDecimals,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  subtractExactDecimals,
  sumExactDecimals,
  truthAllowsNewExposure,
  weakestCapitalTruth,
  type ExactDecimal,
  type NonNegativeDecimal,
  type TruthMetadata,
} from '../contracts/index.js';
import {
  ACCOUNT_SNAPSHOT_KEYS,
  type AccountCapitalProjection,
  type AccountInputSnapshot,
  type AccountSnapshotProvenance,
  type AccountSnapshotKey,
  type AssetValuationProjection,
  type BorrowCapacityByAssetProjection,
  type BorrowTruthReferenceProjection,
  type CapitalCommitmentInput,
  type CollateralByAssetProjection,
  type CommitmentProjection,
  type ConservativeValuationInput,
  type DeriveAccountCapitalProjectionInput,
  type DirectionalExposureInput,
  type HardReserveProjection,
  type LiabilityByAssetProjection,
} from './types.js';

const ZERO = '0' as NonNegativeDecimal;
const ONE = '1' as NonNegativeDecimal;
const ASSET = /^[A-Z0-9]{1,20}$/;
const SYMBOL = /^[A-Z0-9]{2,30}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function compareText(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty unpadded string`);
  }
  return value;
}

function asset(value: unknown, path: string): string {
  const normalized = text(value, path);
  if (!ASSET.test(normalized)) throw new TypeError(`${path} must be an uppercase asset`);
  return normalized;
}

function identifier(value: unknown, path: string): string {
  const normalized = text(value, path);
  if (!IDENTIFIER.test(normalized)) throw new TypeError(`${path} must be a canonical identifier`);
  return normalized;
}

function symbol(value: unknown, path: string): string {
  const normalized = text(value, path);
  if (!SYMBOL.test(normalized)) throw new TypeError(`${path} must be an uppercase venue symbol`);
  return normalized;
}

function safeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`${path} must be a safe integer`);
  }
  return value;
}

function nonNegative(value: unknown, path: string): NonNegativeDecimal {
  try {
    return normalizeNonNegativeExactDecimal(value);
  } catch (error) {
    throw new TypeError(`${path} must be an exact non-negative decimal`, { cause: error });
  }
}

function exact(value: unknown, path: string): ExactDecimal {
  try {
    return normalizeExactDecimal(value);
  } catch (error) {
    throw new TypeError(`${path} must be an exact decimal`, { cause: error });
  }
}

function positive(value: ExactDecimal): boolean {
  return compareExactDecimals(value, ZERO) > 0;
}

function addNonNegative(left: NonNegativeDecimal, right: NonNegativeDecimal): NonNegativeDecimal {
  return normalizeNonNegativeExactDecimal(addExactDecimals(left, right));
}

function multiplyNonNegative(left: NonNegativeDecimal, right: NonNegativeDecimal): NonNegativeDecimal {
  return normalizeNonNegativeExactDecimal(multiplyExactDecimals(left, right));
}

function freezeArray<T>(values: readonly T[]): readonly Readonly<T>[] {
  return Object.freeze(values.map((value) => Object.freeze(value)));
}

function snapshotTruth(snapshot: Readonly<AccountInputSnapshot<unknown>>, evaluatedAtMs: number): Readonly<TruthMetadata> {
  return assessCapitalTruth({
    source: snapshot.source,
    evaluatedAtMs,
    requiredValuePresent: snapshot.value !== null,
    reasons: snapshot.reasons,
    evidenceReferences: snapshot.evidenceReferences,
    revision: snapshot.revision,
    divergent: snapshot.divergent,
  });
}

function snapshotProvenance(
  snapshot: Readonly<AccountInputSnapshot<unknown>>,
  key: AccountSnapshotKey,
): Readonly<AccountSnapshotProvenance> {
  if (typeof snapshot.provenance !== 'object' || snapshot.provenance === null || Array.isArray(snapshot.provenance)) {
    throw new TypeError(`${key}.provenance must be a plain data object`);
  }
  return Object.freeze({
    accountId: identifier(snapshot.provenance.accountId, `${key}.provenance.accountId`),
    capitalPoolId: identifier(snapshot.provenance.capitalPoolId, `${key}.provenance.capitalPoolId`),
    coherentCutId: identifier(snapshot.provenance.coherentCutId, `${key}.provenance.coherentCutId`),
  });
}

function cloneSourcedTimestamp(value: Readonly<SourcedTimestamp> | null, path: string): Readonly<SourcedTimestamp> | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object or null`);
  try {
    return createSourcedTimestamp({
      sourceTimeMs: value.sourceTimeMs,
      receivedAtMs: value.receivedAtMs,
      maxAgeMs: value.maxAgeMs,
      authority: value.authority,
      completeness: value.completeness,
      sourceId: value.sourceId,
    });
  } catch (error) {
    throw new TypeError(`${path} must be a canonical sourced timestamp`, { cause: error });
  }
}

function cloneFreshnessReport(value: Readonly<FreshnessReport> | null, path: string): Readonly<FreshnessReport> | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object or null`);
  if (!isFreshnessState(value.state)) throw new TypeError(`${path}.state is invalid`);
  if (!['SOURCE_TIME', 'RECEIPT_TIME', 'NONE'].includes(value.basis)) throw new TypeError(`${path}.basis is invalid`);
  if (!isDataAuthority(value.effectiveAuthority)) throw new TypeError(`${path}.effectiveAuthority is invalid`);
  if (!isValidUtcMillis(value.evaluatedAt)) throw new TypeError(`${path}.evaluatedAt is invalid`);
  const ageMs = value.ageMs === null ? null : safeInteger(value.ageMs, `${path}.ageMs`);
  if ((value.basis === 'NONE') !== (ageMs === null)) {
    throw new TypeError(`${path}.basis and ageMs contradict one another`);
  }
  return Object.freeze({
    state: value.state,
    ageMs,
    basis: value.basis,
    effectiveAuthority: value.effectiveAuthority,
    evaluatedAt: value.evaluatedAt,
  });
}

function cloneBorrowTruth(value: Readonly<BorrowTruth>, path: string): Readonly<BorrowTruth> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  const mode = value.mode;
  if (!(MARGIN_ACCOUNT_MODES as readonly string[]).includes(mode)) throw new TypeError(`${path}.mode is invalid`);
  if (!(BORROW_TRUTH_STATES as readonly string[]).includes(value.state)) throw new TypeError(`${path}.state is invalid`);
  if (!['MARGIN_CROSS', 'MARGIN_ISOLATED'].includes(value.positionBucket)) {
    throw new TypeError(`${path}.positionBucket is invalid`);
  }
  const expectedBucket = mode === 'ISOLATED' ? 'MARGIN_ISOLATED' : 'MARGIN_CROSS';
  if (value.positionBucket !== expectedBucket) throw new TypeError(`${path}.positionBucket contradicts mode`);
  const maxBorrowableAsset = value.maxBorrowableAsset === null
    ? null
    : nonNegative(value.maxBorrowableAsset, `${path}.maxBorrowableAsset`);
  const borrowLimitAsset = value.borrowLimitAsset === null
    ? null
    : nonNegative(value.borrowLimitAsset, `${path}.borrowLimitAsset`);
  const hourlyRate = value.hourlyRate === null
    ? null
    : nonNegative(value.hourlyRate, `${path}.hourlyRate`);
  if (
    maxBorrowableAsset !== null && borrowLimitAsset !== null
    && compareExactDecimals(maxBorrowableAsset, borrowLimitAsset) > 0
  ) {
    throw new TypeError(`${path}.maxBorrowableAsset cannot exceed borrowLimitAsset`);
  }
  if (!isValidUtcMillis(value.evaluatedAtMs)) throw new TypeError(`${path}.evaluatedAtMs is invalid`);
  if (value.expiresAtMs !== null && !isValidUtcMillis(value.expiresAtMs)) {
    throw new TypeError(`${path}.expiresAtMs is invalid`);
  }
  const provenance = Object.freeze({
    account: cloneSourcedTimestamp(value.provenance.account, `${path}.provenance.account`),
    permission: cloneSourcedTimestamp(value.provenance.permission, `${path}.provenance.permission`),
    maxBorrow: cloneSourcedTimestamp(value.provenance.maxBorrow, `${path}.provenance.maxBorrow`),
    rate: cloneSourcedTimestamp(value.provenance.rate, `${path}.provenance.rate`),
  });
  const freshness = Object.freeze({
    account: cloneFreshnessReport(value.freshness.account, `${path}.freshness.account`),
    permission: cloneFreshnessReport(value.freshness.permission, `${path}.freshness.permission`),
    maxBorrow: cloneFreshnessReport(value.freshness.maxBorrow, `${path}.freshness.maxBorrow`),
    rate: cloneFreshnessReport(value.freshness.rate, `${path}.freshness.rate`),
  });
  return Object.freeze({
    accountId: identifier(value.accountId, `${path}.accountId`),
    symbol: symbol(value.symbol, `${path}.symbol`),
    asset: asset(value.asset, `${path}.asset`),
    mode,
    permissionId: identifier(value.permissionId, `${path}.permissionId`),
    state: value.state,
    reason: text(value.reason, `${path}.reason`) as BorrowTruth['reason'],
    positionBucket: value.positionBucket,
    maxBorrowableAsset,
    borrowLimitAsset,
    hourlyRate,
    evaluatedAtMs: value.evaluatedAtMs,
    expiresAtMs: value.expiresAtMs,
    provenance,
    freshness,
  });
}

function sourceReason(key: AccountSnapshotKey, truth: TruthMetadata): string {
  return `SOURCE_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}_${truth.completeness}`;
}

interface ValuationIndex {
  readonly get: (assetCode: string) => Readonly<AssetValuationProjection>;
}

function valuationIndex(
  rows: readonly Readonly<ConservativeValuationInput>[] | null,
  valuationAsset: string,
  unavailable: string[],
): ValuationIndex {
  const indexed = new Map<string, AssetValuationProjection>();
  for (const [index, row] of (rows ?? []).entries()) {
    const sourceAsset = asset(row.asset, `valuations[${index}].asset`);
    const targetAsset = asset(row.valuationAsset, `valuations[${index}].valuationAsset`);
    if (indexed.has(sourceAsset)) unavailable.push(`DUPLICATE_VALUATION_${sourceAsset}`);
    if (targetAsset !== valuationAsset) unavailable.push(`VALUATION_TARGET_MISMATCH_${sourceAsset}`);
    const unit = row.conservativeUnitValue === null
      ? null
      : nonNegative(row.conservativeUnitValue, `valuations[${index}].conservativeUnitValue`);
    indexed.set(sourceAsset, Object.freeze({
      asset: sourceAsset,
      valuationAsset,
      status: unit === null ? 'UNVALUED' : 'VALUED',
      conservativeUnitValue: unit,
      reasonCodes: sortedUnique(row.reasonCodes.map((reason, reasonIndex) => text(reason, `valuations[${index}].reasonCodes[${reasonIndex}]`))),
    }));
  }
  return Object.freeze({
    get(sourceAsset: string): Readonly<AssetValuationProjection> {
      if (sourceAsset === valuationAsset) {
        return Object.freeze({ asset: sourceAsset, valuationAsset, status: 'NATIVE', conservativeUnitValue: ONE, reasonCodes: [] });
      }
      return indexed.get(sourceAsset) ?? Object.freeze({
        asset: sourceAsset,
        valuationAsset,
        status: 'UNVALUED',
        conservativeUnitValue: null,
        reasonCodes: Object.freeze(['VALUATION_NOT_SUPPLIED']),
      });
    },
  });
}

function valueAmount(
  amount: NonNegativeDecimal,
  valuation: AssetValuationProjection,
  unknown: string[],
): NonNegativeDecimal | null {
  if (valuation.conservativeUnitValue !== null) return multiplyNonNegative(amount, valuation.conservativeUnitValue);
  if (positive(amount)) unknown.push(`UNVALUED_REQUIRED_ASSET_${valuation.asset}`);
  return positive(amount) ? null : ZERO;
}

function valueSignedAmount(
  amount: ExactDecimal,
  valuation: AssetValuationProjection,
  unknown: string[],
): ExactDecimal | null {
  if (valuation.conservativeUnitValue !== null) return multiplyExactDecimals(amount, valuation.conservativeUnitValue);
  if (amount !== ZERO) unknown.push(`UNVALUED_REQUIRED_ASSET_${valuation.asset}`);
  return amount === ZERO ? ZERO : null;
}

interface MutableCollateral {
  spotTotal: NonNegativeDecimal;
  spotAvailable: NonNegativeDecimal;
  spotLocked: NonNegativeDecimal;
  futuresWallet: ExactDecimal;
  futuresAvailable: NonNegativeDecimal;
  futuresMargin: ExactDecimal;
  initialMargin: NonNegativeDecimal;
  maintenanceMargin: NonNegativeDecimal;
}

function emptyCollateral(): MutableCollateral {
  return {
    spotTotal: ZERO,
    spotAvailable: ZERO,
    spotLocked: ZERO,
    futuresWallet: ZERO,
    futuresAvailable: ZERO,
    futuresMargin: ZERO,
    initialMargin: ZERO,
    maintenanceMargin: ZERO,
  };
}

function deriveCollateral(
  input: DeriveAccountCapitalProjectionInput,
  valuations: ValuationIndex,
  unavailable: string[],
  unknown: string[],
): readonly Readonly<CollateralByAssetProjection>[] {
  const byAsset = new Map<string, MutableCollateral>();
  const spotSeen = new Set<string>();
  for (const [index, row] of (input.spot.value?.balances ?? []).entries()) {
    const code = asset(row.asset, `spot.balances[${index}].asset`);
    const total = nonNegative(row.total, `spot.balances[${index}].total`);
    const available = nonNegative(row.available, `spot.balances[${index}].available`);
    const locked = nonNegative(row.locked, `spot.balances[${index}].locked`);
    if (spotSeen.has(code)) unavailable.push(`DUPLICATE_SPOT_BALANCE_${code}`);
    spotSeen.add(code);
    if (compareExactDecimals(total, addExactDecimals(available, locked)) !== 0) {
      unavailable.push(`SPOT_BALANCE_CONTRADICTION_${code}`);
    }
    const current = byAsset.get(code) ?? emptyCollateral();
    current.spotTotal = total;
    current.spotAvailable = available;
    current.spotLocked = locked;
    byAsset.set(code, current);
  }
  const futuresSeen = new Set<string>();
  for (const [index, row] of (input.futures.value?.wallets ?? []).entries()) {
    const code = asset(row.asset, `futures.wallets[${index}].asset`);
    if (futuresSeen.has(code)) unavailable.push(`DUPLICATE_FUTURES_WALLET_${code}`);
    futuresSeen.add(code);
    const current = byAsset.get(code) ?? emptyCollateral();
    current.futuresWallet = exact(row.walletBalance, `futures.wallets[${index}].walletBalance`);
    current.futuresAvailable = nonNegative(row.availableBalance, `futures.wallets[${index}].availableBalance`);
    current.futuresMargin = exact(row.marginBalance, `futures.wallets[${index}].marginBalance`);
    current.initialMargin = nonNegative(row.initialMargin, `futures.wallets[${index}].initialMargin`);
    current.maintenanceMargin = nonNegative(row.maintenanceMargin, `futures.wallets[${index}].maintenanceMargin`);
    byAsset.set(code, current);
  }
  return freezeArray([...byAsset.entries()].sort(([left], [right]) => compareText(left, right)).map(([code, row]) => {
    const valuation = valuations.get(code);
    const totalCollateral = addExactDecimals(row.spotTotal, row.futuresMargin);
    const availableCollateral = addNonNegative(row.spotAvailable, row.futuresAvailable);
    if (compareExactDecimals(row.futuresWallet, ZERO) < 0) unavailable.push(`NEGATIVE_FUTURES_WALLET_${code}`);
    if (compareExactDecimals(row.futuresMargin, ZERO) < 0) unavailable.push(`NEGATIVE_FUTURES_MARGIN_${code}`);
    if (compareExactDecimals(row.futuresAvailable, row.futuresMargin) > 0) {
      unavailable.push(`FUTURES_AVAILABLE_EXCEEDS_MARGIN_${code}`);
    }
    if (compareExactDecimals(totalCollateral, ZERO) < 0) unavailable.push(`NEGATIVE_TOTAL_COLLATERAL_${code}`);
    if (compareExactDecimals(availableCollateral, totalCollateral) > 0) {
      unavailable.push(`AVAILABLE_COLLATERAL_EXCEEDS_TOTAL_${code}`);
    }
    return {
      asset: code,
      ...row,
      totalCollateral,
      availableCollateral,
      totalConservativeValue: valueSignedAmount(totalCollateral, valuation, unknown),
      availableConservativeValue: valueAmount(availableCollateral, valuation, unknown),
      valuation,
    };
  }));
}

interface MutableLiability {
  principal: NonNegativeDecimal;
  accruedInterest: NonNegativeDecimal;
  fees: NonNegativeDecimal;
  total: NonNegativeDecimal;
  liabilityIds: string[];
}

function deriveLiabilities(
  input: DeriveAccountCapitalProjectionInput,
  valuations: ValuationIndex,
  unavailable: string[],
  unknown: string[],
): readonly Readonly<LiabilityByAssetProjection>[] {
  const byAsset = new Map<string, MutableLiability>();
  const ids = new Set<string>();
  for (const [index, row] of (input.liabilities.value ?? []).entries()) {
    const id = text(row.liabilityId, `liabilities[${index}].liabilityId`);
    const code = asset(row.asset, `liabilities[${index}].asset`);
    const principal = nonNegative(row.principal, `liabilities[${index}].principal`);
    const interest = nonNegative(row.accruedInterest, `liabilities[${index}].accruedInterest`);
    const fees = nonNegative(row.fees, `liabilities[${index}].fees`);
    const total = nonNegative(row.total, `liabilities[${index}].total`);
    if (ids.has(id)) unavailable.push(`DUPLICATE_LIABILITY_${id}`);
    ids.add(id);
    if (compareExactDecimals(total, sumExactDecimals([principal, interest, fees])) !== 0) {
      unavailable.push(`LIABILITY_TOTAL_CONTRADICTION_${id}`);
    }
    const current = byAsset.get(code) ?? { principal: ZERO, accruedInterest: ZERO, fees: ZERO, total: ZERO, liabilityIds: [] };
    current.principal = addNonNegative(current.principal, principal);
    current.accruedInterest = addNonNegative(current.accruedInterest, interest);
    current.fees = addNonNegative(current.fees, fees);
    current.total = addNonNegative(current.total, total);
    current.liabilityIds.push(id);
    byAsset.set(code, current);
  }
  return freezeArray([...byAsset.entries()].sort(([left], [right]) => compareText(left, right)).map(([code, row]) => {
    const valuation = valuations.get(code);
    return {
      asset: code,
      principal: row.principal,
      accruedInterest: row.accruedInterest,
      fees: row.fees,
      total: row.total,
      conservativeValue: valueAmount(row.total, valuation, unknown),
      liabilityIds: sortedUnique(row.liabilityIds),
      valuation,
    };
  }));
}

type CommitmentCategory = CommitmentProjection['category'];

function normalizeCommitments(
  rows: readonly Readonly<CapitalCommitmentInput>[] | null,
  category: CommitmentCategory,
  valuations: ValuationIndex,
  ids: Set<string>,
  unavailable: string[],
  unknown: string[],
): readonly Readonly<CommitmentProjection>[] {
  return freezeArray((rows ?? []).map((row, index) => {
    const id = text(row.commitmentId, `${category}[${index}].commitmentId`);
    if (ids.has(id)) unavailable.push(`DUPLICATE_COMMITMENT_${id}`);
    ids.add(id);
    const group = text(row.commitmentGroupId, `${category}[${index}].commitmentGroupId`);
    const code = asset(row.asset, `${category}[${index}].asset`);
    const amount = nonNegative(row.amount, `${category}[${index}].amount`);
    if (typeof row.reflectedInAvailable !== 'boolean') throw new TypeError(`${category}[${index}].reflectedInAvailable must be boolean`);
    return {
      commitmentId: id,
      commitmentGroupId: group,
      category,
      asset: code,
      amount,
      reflectedInAvailable: row.reflectedInAvailable,
      conservativeValue: valueAmount(amount, valuations.get(code), unknown),
    };
  }));
}

function sumKnown(values: readonly (NonNegativeDecimal | null)[]): NonNegativeDecimal | null {
  return values.some((value) => value === null)
    ? null
    : normalizeNonNegativeExactDecimal(sumExactDecimals(values as readonly NonNegativeDecimal[]));
}

function deriveCommitments(
  input: DeriveAccountCapitalProjectionInput,
  valuations: ValuationIndex,
  unavailable: string[],
  unknown: string[],
): AccountCapitalProjection['commitments'] {
  const ids = new Set<string>();
  const orders = normalizeCommitments(input.orders.value, 'ORDER', valuations, ids, unavailable, unknown);
  const plans = normalizeCommitments(input.plans.value, 'PLAN', valuations, ids, unavailable, unknown);
  const reservations = normalizeCommitments(input.reservations.value, 'RESERVATION', valuations, ids, unavailable, unknown);
  const entries = [...orders, ...plans, ...reservations].sort((left, right) => compareText(left.commitmentId, right.commitmentId));
  const groups = new Map<string, { asset: string; reflected: NonNegativeDecimal; unreflected: NonNegativeDecimal; known: boolean }>();
  for (const entry of entries) {
    const value = entry.conservativeValue;
    const current = groups.get(entry.commitmentGroupId) ?? { asset: entry.asset, reflected: ZERO, unreflected: ZERO, known: true };
    if (current.asset !== entry.asset) unavailable.push(`COMMITMENT_GROUP_ASSET_MISMATCH_${entry.commitmentGroupId}`);
    if (value === null) current.known = false;
    else if (entry.reflectedInAvailable) current.reflected = maximumExactDecimal(current.reflected, value) as NonNegativeDecimal;
    else current.unreflected = maximumExactDecimal(current.unreflected, value) as NonNegativeDecimal;
    groups.set(entry.commitmentGroupId, current);
  }
  let incrementalValue: NonNegativeDecimal | null = ZERO;
  for (const group of groups.values()) {
    if (!group.known) incrementalValue = null;
    else if (incrementalValue !== null) {
      const uncovered = maximumExactDecimal(subtractExactDecimals(group.unreflected, group.reflected), ZERO) as NonNegativeDecimal;
      incrementalValue = addNonNegative(incrementalValue, uncovered);
    }
  }
  return Object.freeze({
    entries: freezeArray(entries),
    orderValue: input.orders.value === null ? null : sumKnown(orders.map((entry) => entry.conservativeValue)),
    planValue: input.plans.value === null ? null : sumKnown(plans.map((entry) => entry.conservativeValue)),
    reservationValue: input.reservations.value === null ? null : sumKnown(reservations.map((entry) => entry.conservativeValue)),
    incrementalValue: input.orders.value === null || input.plans.value === null || input.reservations.value === null ? null : incrementalValue,
  });
}

function deriveReserves(
  input: DeriveAccountCapitalProjectionInput,
  valuations: ValuationIndex,
  unavailable: string[],
  unknown: string[],
): readonly Readonly<HardReserveProjection>[] {
  const ids = new Set<string>();
  return freezeArray((input.hardReserves.value ?? []).map((row, index) => {
    const reserveId = text(row.reserveId, `hardReserves[${index}].reserveId`);
    if (ids.has(reserveId)) unavailable.push(`DUPLICATE_HARD_RESERVE_${reserveId}`);
    ids.add(reserveId);
    const code = asset(row.asset, `hardReserves[${index}].asset`);
    const amount = nonNegative(row.amount, `hardReserves[${index}].amount`);
    return {
      reserveId,
      asset: code,
      amount,
      reasonCode: text(row.reasonCode, `hardReserves[${index}].reasonCode`),
      conservativeValue: valueAmount(amount, valuations.get(code), unknown),
    };
  }).sort((left, right) => compareText(left.reserveId, right.reserveId)));
}

function deriveExposure(
  input: DeriveAccountCapitalProjectionInput,
  unavailable: string[],
): { projection: AccountCapitalProjection['exposure']; observedPositive: boolean } {
  const positions: readonly Readonly<DirectionalExposureInput>[] = [
    ...(input.spot.value?.positions ?? []),
    ...(input.futures.value?.positions ?? []),
  ];
  const ids = new Set<string>();
  const long: NonNegativeDecimal[] = [];
  const short: NonNegativeDecimal[] = [];
  let observedPositive = false;
  positions.forEach((position, index) => {
    const id = text(position.positionId, `positions[${index}].positionId`);
    text(position.instrumentId, `positions[${index}].instrumentId`);
    if (ids.has(id)) unavailable.push(`DUPLICATE_POSITION_${id}`);
    ids.add(id);
    const longValue = nonNegative(position.longExposure, `positions[${index}].longExposure`);
    const shortValue = nonNegative(position.shortExposure, `positions[${index}].shortExposure`);
    observedPositive ||= positive(longValue) || positive(shortValue);
    if (asset(position.valuationAsset, `positions[${index}].valuationAsset`) !== input.valuationAsset) {
      unavailable.push(`POSITION_VALUATION_ASSET_MISMATCH_${id}`);
    } else {
      long.push(longValue);
      short.push(shortValue);
    }
  });
  const totalLong = normalizeNonNegativeExactDecimal(sumExactDecimals(long));
  const totalShort = normalizeNonNegativeExactDecimal(sumExactDecimals(short));
  const net = subtractExactDecimals(totalLong, totalShort);
  return {
    projection: Object.freeze({
      long: totalLong,
      short: totalShort,
      gross: addNonNegative(totalLong, totalShort),
      netDirectional: net,
      hedgeImbalance: absoluteExactDecimal(net),
      activePositionCount: positions.length,
    }),
    observedPositive,
  };
}

function deriveBorrow(
  input: DeriveAccountCapitalProjectionInput,
  valuations: ValuationIndex,
  expectedAccountId: string,
  unavailable: string[],
  unknown: string[],
): { references: readonly Readonly<BorrowTruthReferenceProjection>[]; capacity: readonly Readonly<BorrowCapacityByAssetProjection>[] } {
  const ids = new Set<string>();
  const duplicateReferenceIds = new Set<string>();
  const references = input.borrowTruthReferences.map((reference, index) => {
    const referenceId = text(reference.referenceId, `borrowTruthReferences[${index}].referenceId`);
    if (ids.has(referenceId)) {
      unavailable.push(`DUPLICATE_BORROW_REFERENCE_${referenceId}`);
      duplicateReferenceIds.add(referenceId);
    }
    ids.add(referenceId);
    const capacityPoolId = identifier(reference.capacityPoolId, `borrowTruthReferences[${index}].capacityPoolId`);
    if (typeof reference.requiredForNewAllocation !== 'boolean') throw new TypeError(`borrowTruthReferences[${index}].requiredForNewAllocation must be boolean`);
    const truth = cloneBorrowTruth(reference.truth, `borrowTruthReferences[${index}].truth`);
    const maxBorrow = truth.maxBorrowableAsset as NonNegativeDecimal | null;
    const current = truth.evaluatedAtMs <= input.evaluatedAtMs
      && truth.expiresAtMs !== null
      && input.evaluatedAtMs <= truth.expiresAtMs;
    const availableStateConsistent = truth.state !== 'AVAILABLE'
      || (maxBorrow !== null && positive(maxBorrow) && truth.reason === 'BORROW_AMOUNT_POSITIVE');
    if (!availableStateConsistent) unavailable.push(`BORROW_TRUTH_${referenceId}_CONTRADICTORY_AVAILABLE_STATE`);
    const accountMatches = truth.accountId === expectedAccountId;
    if (!accountMatches) unavailable.push(`BORROW_TRUTH_${referenceId}_ACCOUNT_MISMATCH`);
    const usable = truth.state === 'AVAILABLE' && current && maxBorrow !== null
      && availableStateConsistent && accountMatches;
    if (reference.requiredForNewAllocation && !usable) {
      const reason = current ? `BORROW_TRUTH_${referenceId}_${truth.state}` : `BORROW_TRUTH_${referenceId}_EXPIRED_OR_UNBOUNDED`;
      if (['UNAVAILABLE', 'PERMISSION_MISSING', 'ACCOUNT_MODE_MISMATCH'].includes(truth.state)) unavailable.push(reason);
      else unknown.push(reason);
    }
    return Object.freeze({
      referenceId,
      capacityPoolId,
      requiredForNewAllocation: reference.requiredForNewAllocation,
      current,
      usableForNewAllocation: usable,
      maxBorrowableAsset: maxBorrow,
      truth,
    });
  }).sort((left, right) => compareText(left.referenceId, right.referenceId));

  const poolsByScope = new Map<string, Set<string>>();
  for (const reference of references) {
    const truth = reference.truth;
    const scopeKey = [truth.accountId, truth.mode, truth.symbol, truth.asset, truth.permissionId].join('\u0000');
    const poolIds = poolsByScope.get(scopeKey) ?? new Set<string>();
    poolIds.add(reference.capacityPoolId);
    poolsByScope.set(scopeKey, poolIds);
  }
  const invalidPoolIds = new Set<string>();
  for (const poolIds of poolsByScope.values()) {
    if (poolIds.size <= 1) continue;
    const sorted = [...poolIds].sort(compareText);
    unavailable.push(`BORROW_SCOPE_CAPACITY_POOL_DIVERGENT_${sorted.join('__')}`);
    sorted.forEach((poolId) => invalidPoolIds.add(poolId));
  }

  interface BorrowPool {
    readonly capacityPoolId: string;
    readonly references: BorrowTruthReferenceProjection[];
    divergent: boolean;
  }
  const pools = new Map<string, BorrowPool>();
  for (const reference of references) {
    const current = pools.get(reference.capacityPoolId);
    if (current === undefined) {
      pools.set(reference.capacityPoolId, { capacityPoolId: reference.capacityPoolId, references: [reference], divergent: false });
      continue;
    }
    const expected = current.references[0];
    const left = expected.truth;
    const right = reference.truth;
    const samePoolFacts = left.accountId === right.accountId
      && left.mode === right.mode
      && left.asset === right.asset
      && left.permissionId === right.permissionId
      && (left.mode !== 'ISOLATED' || left.symbol === right.symbol)
      && left.state === right.state
      && left.reason === right.reason
      && left.maxBorrowableAsset === right.maxBorrowableAsset
      && left.borrowLimitAsset === right.borrowLimitAsset
      && left.hourlyRate === right.hourlyRate
      && expected.current === reference.current
      && expected.usableForNewAllocation === reference.usableForNewAllocation;
    if (!samePoolFacts) {
      current.divergent = true;
      unavailable.push(`BORROW_CAPACITY_POOL_DIVERGENT_${reference.capacityPoolId}`);
      invalidPoolIds.add(reference.capacityPoolId);
    }
    current.references.push(reference);
  }
  for (const reference of references) {
    if (duplicateReferenceIds.has(reference.referenceId)) invalidPoolIds.add(reference.capacityPoolId);
  }

  const capacity = new Map<string, {
    amount: NonNegativeDecimal;
    value: NonNegativeDecimal | null;
    poolIds: string[];
    referenceIds: string[];
  }>();
  for (const pool of [...pools.values()].sort((left, right) => compareText(left.capacityPoolId, right.capacityPoolId))) {
    if (pool.divergent || invalidPoolIds.has(pool.capacityPoolId)) continue;
    const representative = pool.references[0];
    const maxBorrow = representative.maxBorrowableAsset;
    if (!representative.usableForNewAllocation || maxBorrow === null) continue;
    const code = representative.truth.asset;
    const required = pool.references.some((reference) => reference.requiredForNewAllocation);
    const value = valueAmount(maxBorrow, valuations.get(code), required ? unknown : []);
    const currentCapacity = capacity.get(code) ?? {
      amount: ZERO,
      value: ZERO,
      poolIds: [],
      referenceIds: [],
    };
    currentCapacity.amount = addNonNegative(currentCapacity.amount, maxBorrow);
    currentCapacity.value = currentCapacity.value === null || value === null
      ? null
      : addNonNegative(currentCapacity.value, value);
    currentCapacity.poolIds.push(pool.capacityPoolId);
    currentCapacity.referenceIds.push(...pool.references.map((reference) => reference.referenceId));
    capacity.set(code, currentCapacity);
  }
  return {
    references: Object.freeze(references),
    capacity: freezeArray([...capacity.entries()].sort(([left], [right]) => compareText(left, right)).map(([code, row]) => ({
      asset: code,
      maxBorrowableAsset: row.amount,
      conservativeValue: row.value,
      capacityPoolIds: sortedUnique(row.poolIds),
      referenceIds: sortedUnique(row.referenceIds),
    }))),
  };
}

function aggregateKnown(values: readonly (ExactDecimal | null)[], sourceKnown: boolean): NonNegativeDecimal | null {
  if (!sourceKnown || values.some((value) => value === null)) return null;
  return normalizeNonNegativeExactDecimal(sumExactDecimals(values as readonly ExactDecimal[]));
}

export function deriveAccountCapitalProjection(
  input: Readonly<DeriveAccountCapitalProjectionInput>,
): Readonly<AccountCapitalProjection> {
  const valuationAsset = asset(input.valuationAsset, 'valuationAsset');
  const unavailable: string[] = [];
  const unknown: string[] = [];
  const normalizedSnapshotProvenance = Object.freeze(Object.fromEntries(ACCOUNT_SNAPSHOT_KEYS.map((key) => [
    key,
    snapshotProvenance(input[key], key),
  ])) as unknown as Record<AccountSnapshotKey, Readonly<AccountSnapshotProvenance>>);
  const accountIds = sortedUnique(ACCOUNT_SNAPSHOT_KEYS.map((key) => normalizedSnapshotProvenance[key].accountId));
  const coherentCutIds = sortedUnique(ACCOUNT_SNAPSHOT_KEYS.map((key) => normalizedSnapshotProvenance[key].coherentCutId));
  if (accountIds.length !== 1) unavailable.push('ACCOUNT_SNAPSHOT_ACCOUNT_MISMATCH');
  if (coherentCutIds.length !== 1) unavailable.push('ACCOUNT_SNAPSHOT_COHERENT_CUT_MISMATCH');
  if (
    input.spot.value !== null && input.futures.value !== null
    && normalizedSnapshotProvenance.spot.capitalPoolId === normalizedSnapshotProvenance.futures.capitalPoolId
  ) {
    unavailable.push(`SPOT_FUTURES_CAPITAL_POOL_OVERLAP_${normalizedSnapshotProvenance.spot.capitalPoolId}`);
  }
  const sourceTruth = Object.freeze(Object.fromEntries(ACCOUNT_SNAPSHOT_KEYS.map((key) => [
    key,
    snapshotTruth(input[key], input.evaluatedAtMs),
  ])) as unknown as Record<AccountSnapshotKey, Readonly<TruthMetadata>>);
  for (const key of ACCOUNT_SNAPSHOT_KEYS) {
    const truth = sourceTruth[key];
    if (truthAllowsNewExposure(truth)) continue;
    const reason = sourceReason(key, truth);
    if (truth.completeness === 'DIVERGENT') unavailable.push(reason);
    else unknown.push(reason);
  }
  const valuations = valuationIndex(input.valuations.value, valuationAsset, unavailable);
  const collateral = deriveCollateral(input, valuations, unavailable, unknown);
  const liabilities = deriveLiabilities(input, valuations, unavailable, unknown);
  const commitments = deriveCommitments(input, valuations, unavailable, unknown);
  const reserves = deriveReserves(input, valuations, unavailable, unknown);
  const exposure = deriveExposure(input, unavailable);
  const borrow = deriveBorrow(input, valuations, accountIds[0], unavailable, unknown);

  const collateralValue = aggregateKnown(
    collateral.map((row) => row.availableConservativeValue),
    input.spot.value !== null && input.futures.value !== null && input.valuations.value !== null,
  );
  const liabilityValue = aggregateKnown(
    liabilities.map((row) => row.conservativeValue),
    input.liabilities.value !== null && input.valuations.value !== null,
  );
  const reserveValue = aggregateKnown(
    reserves.map((row) => row.conservativeValue),
    input.hardReserves.value !== null && input.valuations.value !== null,
  );
  const commitmentsValue = commitments.incrementalValue;
  const unavailableReasons = sortedUnique(unavailable);
  const unknownReasons = sortedUnique(unknown);
  let status: AccountCapitalProjection['allocatable']['status'];
  let amount: NonNegativeDecimal | null = null;
  const knownInputs = collateralValue !== null && liabilityValue !== null && reserveValue !== null && commitmentsValue !== null;
  if (unavailableReasons.length > 0) status = 'UNAVAILABLE';
  else if (unknownReasons.length > 0 || !knownInputs) status = 'UNKNOWN';
  else {
    const remaining = subtractExactDecimals(
      subtractExactDecimals(subtractExactDecimals(collateralValue, liabilityValue), commitmentsValue),
      reserveValue,
    );
    amount = maximumExactDecimal(remaining, ZERO) as NonNegativeDecimal;
    status = amount === ZERO ? 'UNAVAILABLE' : 'AVAILABLE';
  }
  const exhaustion = status === 'UNAVAILABLE' && amount === ZERO ? ['ALLOCATABLE_CAPITAL_EXHAUSTED'] : [];
  const finalUnavailable = sortedUnique([...unavailableReasons, ...exhaustion]);
  const blockingReasons = sortedUnique([...finalUnavailable, ...unknownReasons]);
  const truthStates = ACCOUNT_SNAPSHOT_KEYS.map((key) => sourceTruth[key].completeness);
  if (unavailableReasons.length > 0) truthStates.push('DIVERGENT');
  else if (unknownReasons.length > 0) truthStates.push('UNKNOWN');
  const truthReasons = sortedUnique([
    ...blockingReasons,
    ...ACCOUNT_SNAPSHOT_KEYS.flatMap((key) => sourceTruth[key].reasons),
  ]);
  const liabilityObserved = liabilities.some((row) => positive(row.total));
  const commitmentObserved = commitments.entries.some((entry) => positive(entry.amount));
  const lockedOrMarginedCapitalObserved = collateral.some((row) => (
    positive(row.spotLocked) || positive(row.initialMargin) || positive(row.maintenanceMargin)
  ));
  const signedDeficitObserved = collateral.some((row) => (
    compareExactDecimals(row.futuresWallet, ZERO) < 0
    || compareExactDecimals(row.futuresMargin, ZERO) < 0
    || compareExactDecimals(row.totalCollateral, ZERO) < 0
  ));
  const requiredBorrowTruthUsable = borrow.references.every((reference) => (
    !reference.requiredForNewAllocation || reference.usableForNewAllocation
  ));
  return Object.freeze({
    evaluatedAtMs: input.evaluatedAtMs,
    valuationAsset,
    collateralByAsset: collateral,
    liabilitiesByAsset: liabilities,
    commitments,
    hardReserves: reserves,
    borrowTruthReferences: borrow.references,
    borrowCapacityByAsset: borrow.capacity,
    exposure: exposure.projection,
    truth: Object.freeze({
      completeness: weakestCapitalTruth(truthStates),
      allRequiredSourcesFreshAndComplete: ACCOUNT_SNAPSHOT_KEYS.every((key) => truthAllowsNewExposure(sourceTruth[key]))
        && requiredBorrowTruthUsable
        && unavailableReasons.length === 0
        && unknownReasons.length === 0,
      snapshotProvenance: normalizedSnapshotProvenance,
      sourceTruth,
      reasons: truthReasons,
    }),
    allocatable: Object.freeze({
      status,
      amount,
      valuationAsset,
      availableCollateralValue: collateralValue,
      liabilityValue,
      incrementalCommitmentValue: commitmentsValue,
      hardReserveValue: reserveValue,
      unavailableReasons: finalUnavailable,
      unknownReasons,
      blockingReasons,
    }),
    supervisionVisible: exposure.observedPositive || liabilityObserved || commitmentObserved
      || lockedOrMarginedCapitalObserved || signedDeficitObserved,
  });
}

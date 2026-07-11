import {
  ACCOUNT_SNAPSHOT_KEYS,
  type AccountCapitalProjection,
} from '../accountTruth/index.js';
import {
  absoluteExactDecimal,
  addExactDecimals,
  assessCapitalTruth,
  capitalDigest,
  compareExactDecimals,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  truthAllowsNewExposure,
  type NonNegativeDecimal,
  type TruthMetadata,
} from '../contracts/index.js';
import {
  isValidUtcMillis,
  validateSourcedTimestamp,
  weakestAuthority,
  type SourcedTimestamp,
} from '../../foundation/contracts/index.js';
import type {
  AccountBoundBudgetSnapshotResult,
  CapitalCommitmentReference,
  KeyedExactAmount,
  PortfolioBudgetSnapshot,
  ProjectPortfolioBudgetSnapshotFromAccountInput,
} from './types.js';
import { validatePortfolioBudgetSnapshot } from './validate.js';

const ZERO = normalizeNonNegativeExactDecimal('0');

function compareText(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareText));
}

function blocked(accountProjectionDigest: string | null, reasons: readonly string[]): AccountBoundBudgetSnapshotResult {
  return Object.freeze({
    ok: false,
    accountProjectionDigest,
    snapshot: null,
    reasonCodes: sortedUnique(reasons),
  });
}

function freezeKeyed(values: readonly Readonly<KeyedExactAmount>[]): readonly Readonly<KeyedExactAmount>[] {
  return Object.freeze(values.map((value) => Object.freeze({ key: value.key, amount: value.amount }))
    .sort((left, right) => compareText(left.key, right.key)));
}

function freezeCommitments(
  values: readonly Readonly<CapitalCommitmentReference>[],
): readonly Readonly<CapitalCommitmentReference>[] {
  return Object.freeze(values.map((value) => Object.freeze({
    id: value.id,
    capitalClaimKey: value.capitalClaimKey,
    kind: value.kind,
  })).sort((left, right) => compareText(left.id, right.id)));
}

function aggregateAccountTruth(
  account: Readonly<AccountCapitalProjection>,
  digest: string,
): Readonly<TruthMetadata> | null {
  try {
    if (!isValidUtcMillis(account.evaluatedAtMs)
        || account.truth.completeness !== 'COMPLETE'
        || account.truth.allRequiredSourcesFreshAndComplete !== true) return null;
    const truths = ACCOUNT_SNAPSHOT_KEYS.map((key) => account.truth.sourceTruth[key]);
    if (truths.some((truth) => truth === undefined || validateSourcedTimestamp(truth.source).length > 0)) return null;
    for (const truth of truths) {
      const current = assessCapitalTruth({
        source: truth.source,
        evaluatedAtMs: account.evaluatedAtMs,
        requiredValuePresent: true,
        reasons: truth.reasons,
        evidenceReferences: truth.evidenceReferences,
        revision: truth.revision,
      });
      if (current.completeness !== 'COMPLETE' || !truthAllowsNewExposure(current)) return null;
    }

    const sources = truths.map((truth) => truth.source);
    let oldestBasis = sources[0].sourceTimeMs ?? sources[0].receivedAtMs;
    let earliestExpiry = oldestBasis + sources[0].maxAgeMs;
    // A derived cut cannot exist before its final required source arrived.
    let latestReceipt = sources[0].receivedAtMs;
    for (const source of sources.slice(1)) {
      const basis = source.sourceTimeMs ?? source.receivedAtMs;
      if (basis < oldestBasis) oldestBasis = basis;
      const expiry = basis + source.maxAgeMs;
      if (expiry < earliestExpiry) earliestExpiry = expiry;
      if (source.receivedAtMs > latestReceipt) latestReceipt = source.receivedAtMs;
    }
    const maximumAge = earliestExpiry - oldestBasis;
    if (!Number.isSafeInteger(maximumAge) || maximumAge <= 0) return null;
    const source: SourcedTimestamp = {
      sourceTimeMs: oldestBasis,
      receivedAtMs: latestReceipt,
      maxAgeMs: maximumAge,
      authority: weakestAuthority(...sources.map((entry) => entry.authority)),
      completeness: 'COMPLETE',
      sourceId: `account_projection_${digest}`,
    };
    if (validateSourcedTimestamp(source).length > 0) return null;
    const reasons = sortedUnique([
      ...account.truth.reasons,
      ...truths.flatMap((truth) => truth.reasons),
    ]);
    const evidenceReferences = sortedUnique(truths.flatMap((truth) => truth.evidenceReferences));
    return assessCapitalTruth({
      source,
      evaluatedAtMs: account.evaluatedAtMs,
      requiredValuePresent: true,
      reasons,
      evidenceReferences,
      revision: digest,
    });
  } catch {
    return null;
  }
}

/**
 * Pure AccountTruth -> PortfolioBudgetSnapshot bridge. Account-owned monetary
 * facts cannot be restated by the caller: this function binds them to a full
 * content digest and accepts only the separate portfolio facts this lane does
 * not own. It never performs I/O and never invents an unknown amount or time.
 */
export function projectPortfolioBudgetSnapshotFromAccount(
  input: Readonly<ProjectPortfolioBudgetSnapshotFromAccountInput>,
): AccountBoundBudgetSnapshotResult {
  let digest: string | null = null;
  try {
    digest = capitalDigest(input.accountProjection);
  } catch {
    return blocked(null, ['ACCOUNT_PROJECTION_NOT_CANONICAL']);
  }

  const account = input.accountProjection;
  const portfolio = input.portfolio;
  const reasons: string[] = [];
  const truth = aggregateAccountTruth(account, digest);
  if (truth === null) reasons.push('ACCOUNT_TRUTH_NOT_COMPLETE');
  if (account.allocatable.valuationAsset !== account.valuationAsset) reasons.push('ACCOUNT_VALUATION_ASSET_MISMATCH');

  const entry = account.allocatable.amount;
  const sourceTotal = account.allocatable.availableCollateralValue;
  const liability = account.allocatable.liabilityValue;
  const incrementalCommitment = account.allocatable.incrementalCommitmentValue;
  const reserve = account.allocatable.hardReserveValue;
  if (entry === null || sourceTotal === null || liability === null || incrementalCommitment === null || reserve === null) {
    reasons.push('ACCOUNT_ALLOCATABLE_FACT_UNKNOWN');
  }

  let otherUnavailable: NonNegativeDecimal | null = null;
  if (liability !== null && incrementalCommitment !== null) {
    try {
      otherUnavailable = normalizeNonNegativeExactDecimal(addExactDecimals(liability, incrementalCommitment));
    } catch {
      reasons.push('ACCOUNT_COLLATERAL_PARTITION_INVALID');
    }
  }
  if (entry !== null && sourceTotal !== null && reserve !== null && otherUnavailable !== null) {
    try {
      const partitionTotal = addExactDecimals(addExactDecimals(entry, reserve), otherUnavailable);
      if (compareExactDecimals(partitionTotal, sourceTotal) !== 0) reasons.push('ACCOUNT_COLLATERAL_PARTITION_DIVERGENT');
    } catch {
      reasons.push('ACCOUNT_COLLATERAL_PARTITION_INVALID');
    }
  }

  if (!Array.isArray(account.borrowCapacityByAsset)) {
    reasons.push('ACCOUNT_BORROW_CAPACITY_INVALID');
  } else {
    for (const capacity of account.borrowCapacityByAsset) {
      try {
        if (typeof capacity.asset !== 'string' || capacity.asset.trim().length === 0
            || normalizeNonNegativeExactDecimal(capacity.maxBorrowableAsset) !== capacity.maxBorrowableAsset) {
          reasons.push('ACCOUNT_BORROW_CAPACITY_INVALID');
        }
      } catch {
        reasons.push('ACCOUNT_BORROW_CAPACITY_UNKNOWN');
      }
    }
  }

  try {
    if (account.commitments.incrementalValue === null) {
      reasons.push('ACCOUNT_COMMITMENT_VALUE_UNKNOWN');
    } else {
      const accountGrossFloor = normalizeNonNegativeExactDecimal(addExactDecimals(
        account.exposure.gross,
        account.commitments.incrementalValue,
      ));
      if (compareExactDecimals(portfolio.grossExposureAndCommitments, accountGrossFloor) < 0) {
        reasons.push('PORTFOLIO_GROSS_UNDERSTATES_ACCOUNT');
      }
    }

    const accountNet = normalizeExactDecimal(account.exposure.netDirectional);
    const portfolioNet = normalizeExactDecimal(portfolio.netDirectionalExposure);
    const accountSign = compareExactDecimals(accountNet, ZERO);
    const portfolioSign = compareExactDecimals(portfolioNet, ZERO);
    if (accountSign !== 0 && portfolioSign !== accountSign) reasons.push('PORTFOLIO_NET_CONTRADICTS_ACCOUNT');
    if (compareExactDecimals(absoluteExactDecimal(portfolioNet), absoluteExactDecimal(accountNet)) < 0) {
      reasons.push('PORTFOLIO_NET_UNDERSTATES_ACCOUNT');
    }
  } catch {
    reasons.push('PORTFOLIO_EXPOSURE_INVALID');
  }

  if (reasons.length > 0 || truth === null || entry === null || sourceTotal === null
      || reserve === null || otherUnavailable === null) return blocked(digest, reasons);

  try {
    const commitments = freezeCommitments(portfolio.commitments);
    const snapshot: Readonly<PortfolioBudgetSnapshot> = Object.freeze({
      valuationAsset: account.valuationAsset,
      truth,
      entryCollateralAvailable: entry,
      protectedRiskReductionReserve: reserve,
      collateralPoolBinding: Object.freeze({
        sourcePoolId: digest,
        sourcePoolTotal: sourceTotal,
        otherUnavailableCollateral: otherUnavailable,
      }),
      marginHeadroomAvailable: portfolio.marginHeadroomAvailable,
      grossExposureAndCommitments: portfolio.grossExposureAndCommitments,
      netDirectionalExposure: portfolio.netDirectionalExposure,
      strategyUse: freezeKeyed(portfolio.strategyUse),
      symbolUse: freezeKeyed(portfolio.symbolUse),
      correlatedGroupUse: freezeKeyed(portfolio.correlatedGroupUse),
      venueInstrumentUse: freezeKeyed(portfolio.venueInstrumentUse),
      currentConcurrentPlans: commitments.filter((item) => item.kind === 'STAGED_PLAN').length,
      currentActivePositions: commitments.filter((item) => (
        item.kind === 'PARTIALLY_EXPOSED_POSITION' || item.kind === 'ACTIVE_POSITION'
      )).length,
      borrowCapacityByAsset: freezeKeyed(account.borrowCapacityByAsset.map((capacity) => ({
        key: capacity.asset,
        amount: capacity.maxBorrowableAsset,
      }))),
      liquidityCapacityByKey: freezeKeyed(portfolio.liquidityCapacityByKey),
      commitmentCoverage: Object.freeze({ ...portfolio.commitmentCoverage }),
      commitments,
    });
    const validation = validatePortfolioBudgetSnapshot(snapshot, account.evaluatedAtMs);
    if (!validation.valid) return blocked(digest, validation.reasonCodes);
    return Object.freeze({
      ok: true,
      accountProjectionDigest: digest,
      snapshot,
      reasonCodes: Object.freeze([]),
    });
  } catch {
    return blocked(digest, ['PORTFOLIO_BUDGET_FACTS_INVALID']);
  }
}

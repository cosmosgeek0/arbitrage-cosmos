import {
  assessCapitalTruth,
  compareExactDecimals,
  isExactDecimal,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  policyBoundIsValid,
  truthAllowsNewExposure,
  type CapitalBudgetPolicy,
  type ExactPolicyBound,
  type IntegerPolicyBound,
  type TruthMetadata,
} from '../contracts/index.js';
import { COMMITMENT_KINDS, type BudgetValidation, type KeyedExactAmount, type PortfolioBudgetSnapshot } from './types.js';

const REQUIRED_COMMITMENT_COVERAGE = [
  'orders',
  'reservations',
  'plans',
  'partiallyExposedPositions',
  'activePositions',
] as const;

const completeCoverage = (snapshot: PortfolioBudgetSnapshot): boolean => {
  const coverage = snapshot.commitmentCoverage as Readonly<Record<string, unknown>>;
  return REQUIRED_COMMITMENT_COVERAGE.every((key) => (
    Object.prototype.hasOwnProperty.call(coverage, key) && coverage[key] === 'COMPLETE'
  ));
};

function currentTruthState(truth: Readonly<TruthMetadata>, nowMs: number): TruthMetadata['completeness'] {
  if (truth.completeness !== 'COMPLETE') return truth.completeness;
  return assessCapitalTruth({
    source: truth.source,
    evaluatedAtMs: nowMs,
    requiredValuePresent: true,
    reasons: truth.reasons,
    evidenceReferences: truth.evidenceReferences,
    revision: truth.revision,
  }).completeness;
}

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validExactBound(bound: ExactPolicyBound, unit: string): boolean {
  try {
    return bound.unit === unit
      && normalizeNonNegativeExactDecimal(bound.value) === bound.value
      && normalizeNonNegativeExactDecimal(bound.minimum) === bound.minimum
      && normalizeNonNegativeExactDecimal(bound.maximum) === bound.maximum
      && compareExactDecimals(bound.minimum, bound.maximum) <= 0
      && policyBoundIsValid(bound);
  } catch {
    return false;
  }
}

function validIntegerBound(bound: IntegerPolicyBound): boolean {
  return Number.isSafeInteger(bound.value)
    && Number.isSafeInteger(bound.minimum)
    && Number.isSafeInteger(bound.maximum)
    && bound.minimum >= 0
    && bound.minimum <= bound.maximum
    && bound.value >= bound.minimum
    && bound.value <= bound.maximum
    && bound.unit.length > 0;
}

function validateKeyed(values: readonly KeyedExactAmount[], label: string, reasons: string[]): void {
  const keys = new Set<string>();
  for (const value of values) {
    if (value.key.trim().length === 0) reasons.push(`${label}_KEY_MISSING`);
    if (keys.has(value.key)) reasons.push(`${label}_KEY_DUPLICATE`);
    keys.add(value.key);
    try {
      if (normalizeNonNegativeExactDecimal(value.amount) !== value.amount) reasons.push(`${label}_AMOUNT_NOT_CANONICAL`);
    } catch {
      reasons.push(`${label}_AMOUNT_INVALID`);
    }
  }
}

export function validateCapitalBudgetPolicy(policy: Readonly<CapitalBudgetPolicy>, nowMs: number): BudgetValidation {
  const reasons: string[] = [];
  if (!validTime(nowMs)) reasons.push('NOW_INVALID');
  if (policy.valuationAsset.trim().length === 0) reasons.push('VALUATION_ASSET_MISSING');
  const authority = policy.authority;
  if (authority.revision.trim().length === 0) reasons.push('POLICY_REVISION_MISSING');
  if (authority.sourceId.trim().length === 0) reasons.push('POLICY_SOURCE_MISSING');
  if (!validTime(authority.issuedAtMs) || !validTime(authority.effectiveFromMs)) reasons.push('POLICY_TIME_INVALID');
  if (authority.effectiveUntilMs !== null && !validTime(authority.effectiveUntilMs)) reasons.push('POLICY_EXPIRY_INVALID');
  if (validTime(authority.issuedAtMs) && validTime(authority.effectiveFromMs) && authority.issuedAtMs > authority.effectiveFromMs) {
    reasons.push('POLICY_ISSUED_AFTER_EFFECTIVE');
  }
  if (authority.effectiveUntilMs !== null && validTime(authority.effectiveFromMs)
      && validTime(authority.effectiveUntilMs) && authority.effectiveUntilMs <= authority.effectiveFromMs) {
    reasons.push('POLICY_EFFECTIVE_WINDOW_INVALID');
  }
  if (validTime(nowMs) && nowMs < authority.effectiveFromMs) reasons.push('POLICY_NOT_EFFECTIVE');
  if (authority.effectiveUntilMs !== null && nowMs >= authority.effectiveUntilMs) reasons.push('POLICY_EXPIRED');

  const exactBounds: readonly [string, ExactPolicyBound][] = [
    ['PORTFOLIO_GROSS', policy.portfolioGrossLimit],
    ['PORTFOLIO_NET', policy.portfolioNetLimit],
    ['STRATEGY_BASIS', policy.perStrategyLimits.BASIS],
    ['STRATEGY_VOLUME', policy.perStrategyLimits.VOLUME],
    ['SYMBOL', policy.perSymbolLimit],
    ['CORRELATED_GROUP', policy.perCorrelatedGroupLimit],
    ['VENUE_INSTRUMENT', policy.perVenueInstrumentLimit],
    ['RISK_REDUCTION_RESERVE', policy.riskReductionReserve],
  ];
  for (const [label, bound] of exactBounds) {
    if (!validExactBound(bound, policy.valuationAsset)) reasons.push(`${label}_BOUND_INVALID`);
  }
  const integerBounds: readonly [string, IntegerPolicyBound][] = [
    ['MAX_CONCURRENT_PLANS', policy.maximumConcurrentPlans],
    ['MAX_ACTIVE_POSITIONS', policy.maximumActivePositions],
    ['RESERVATION_TTL', policy.reservationTtlMs],
  ];
  for (const [label, bound] of integerBounds) if (!validIntegerBound(bound)) reasons.push(`${label}_BOUND_INVALID`);
  return Object.freeze({ valid: reasons.length === 0, reasonCodes: Object.freeze([...new Set(reasons)].sort()) });
}

export function validatePortfolioBudgetSnapshot(snapshot: Readonly<PortfolioBudgetSnapshot>, nowMs: number): BudgetValidation {
  const reasons: string[] = [];
  if (!validTime(nowMs)) reasons.push('NOW_INVALID');
  if (snapshot.valuationAsset.trim().length === 0) reasons.push('SNAPSHOT_VALUATION_ASSET_MISSING');
  const truthState = validTime(nowMs) ? currentTruthState(snapshot.truth, nowMs) : snapshot.truth.completeness;
  if (truthState !== 'COMPLETE' || !truthAllowsNewExposure(snapshot.truth)) reasons.push(`SNAPSHOT_TRUTH_${truthState}`);
  if (!completeCoverage(snapshot)) reasons.push('COMMITMENT_COVERAGE_INCOMPLETE');
  for (const [label, value] of [
    ['ENTRY_COLLATERAL', snapshot.entryCollateralAvailable],
    ['PROTECTED_RISK_REDUCTION_RESERVE', snapshot.protectedRiskReductionReserve],
    ['MARGIN_HEADROOM', snapshot.marginHeadroomAvailable],
    ['GROSS_USE', snapshot.grossExposureAndCommitments],
  ] as const) {
    try {
      if (normalizeNonNegativeExactDecimal(value) !== value) reasons.push(`${label}_NOT_CANONICAL`);
    } catch {
      reasons.push(`${label}_INVALID`);
    }
  }
  try {
    if (!isExactDecimal(snapshot.netDirectionalExposure)
      || normalizeExactDecimal(snapshot.netDirectionalExposure) !== snapshot.netDirectionalExposure) {
      reasons.push('NET_EXPOSURE_INVALID');
    }
  } catch {
    reasons.push('NET_EXPOSURE_INVALID');
  }
  if (!Number.isSafeInteger(snapshot.currentConcurrentPlans) || snapshot.currentConcurrentPlans < 0) reasons.push('PLAN_COUNT_INVALID');
  if (!Number.isSafeInteger(snapshot.currentActivePositions) || snapshot.currentActivePositions < 0) reasons.push('POSITION_COUNT_INVALID');
  validateKeyed(snapshot.strategyUse, 'STRATEGY_USE', reasons);
  validateKeyed(snapshot.symbolUse, 'SYMBOL_USE', reasons);
  validateKeyed(snapshot.correlatedGroupUse, 'CORRELATED_GROUP_USE', reasons);
  validateKeyed(snapshot.venueInstrumentUse, 'VENUE_INSTRUMENT_USE', reasons);
  validateKeyed(snapshot.borrowCapacityByAsset, 'BORROW_CAPACITY', reasons);
  validateKeyed(snapshot.liquidityCapacityByKey, 'LIQUIDITY_CAPACITY', reasons);

  const ids = new Set<string>();
  const claims = new Set<string>();
  for (const item of snapshot.commitments) {
    if (item.id.trim().length === 0 || item.capitalClaimKey.trim().length === 0) reasons.push('COMMITMENT_IDENTITY_MISSING');
    if (!(COMMITMENT_KINDS as readonly string[]).includes(item.kind)) reasons.push('COMMITMENT_KIND_INVALID');
    if (ids.has(item.id)) reasons.push('COMMITMENT_ID_DUPLICATE');
    if (claims.has(item.capitalClaimKey)) reasons.push('CAPITAL_CLAIM_DOUBLE_COUNTED');
    ids.add(item.id);
    claims.add(item.capitalClaimKey);
  }
  return Object.freeze({ valid: reasons.length === 0, reasonCodes: Object.freeze([...new Set(reasons)].sort()) });
}

export function validateBudgetContext(
  policy: Readonly<CapitalBudgetPolicy>,
  snapshot: Readonly<PortfolioBudgetSnapshot>,
  nowMs: number,
): BudgetValidation {
  const reasons = [
    ...validateCapitalBudgetPolicy(policy, nowMs).reasonCodes,
    ...validatePortfolioBudgetSnapshot(snapshot, nowMs).reasonCodes,
  ];
  if (policy.valuationAsset !== snapshot.valuationAsset) reasons.push('VALUATION_ASSET_MISMATCH');
  try {
    if (compareExactDecimals(snapshot.protectedRiskReductionReserve, policy.riskReductionReserve.value) < 0) {
      reasons.push('RISK_REDUCTION_RESERVE_UNDERPROTECTED');
    }
    if (compareExactDecimals(snapshot.grossExposureAndCommitments, policy.portfolioGrossLimit.value) > 0) {
      reasons.push('CURRENT_GROSS_LIMIT_BREACH');
    }
    const net = snapshot.netDirectionalExposure.startsWith('-')
      ? normalizeNonNegativeExactDecimal(snapshot.netDirectionalExposure.slice(1))
      : normalizeNonNegativeExactDecimal(snapshot.netDirectionalExposure);
    if (compareExactDecimals(net, policy.portfolioNetLimit.value) > 0) reasons.push('CURRENT_NET_LIMIT_BREACH');
  } catch {
    // The narrow validators above already emit the exact malformed-field code.
  }
  if (snapshot.currentConcurrentPlans > policy.maximumConcurrentPlans.value) reasons.push('CURRENT_PLAN_LIMIT_BREACH');
  if (snapshot.currentActivePositions > policy.maximumActivePositions.value) reasons.push('CURRENT_POSITION_LIMIT_BREACH');
  return Object.freeze({ valid: reasons.length === 0, reasonCodes: Object.freeze([...new Set(reasons)].sort()) });
}

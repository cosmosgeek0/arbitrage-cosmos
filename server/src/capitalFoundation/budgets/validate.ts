import {
  absoluteExactDecimal,
  addExactDecimals,
  assessCapitalTruth,
  compareExactDecimals,
  deriveCapitalConfigRevision,
  isExactDecimal,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  policyBoundIsValid,
  truthAllowsNewExposure,
  type CapitalBudgetPolicy,
  type CapitalTruthState,
  type ExactPolicyBound,
  type IntegerPolicyBound,
  type NonNegativeDecimal,
  type TruthMetadata,
} from '../contracts/index.js';
import { COMMITMENT_KINDS, type BudgetValidation, type KeyedExactAmount, type PortfolioBudgetSnapshot } from './types.js';
import {
  isDataAuthority,
  isFreshnessState,
  isValidUtcMillis,
  validateSourcedTimestamp,
} from '../../foundation/contracts/index.js';

const REQUIRED_COMMITMENT_COVERAGE = [
  'orders',
  'reservations',
  'plans',
  'partiallyExposedPositions',
  'activePositions',
] as const;

const CAPITAL_TRUTH_STATES = ['COMPLETE', 'PARTIAL', 'STALE', 'UNKNOWN', 'DIVERGENT'] as const;
const FRESHNESS_BASES = ['SOURCE_TIME', 'RECEIPT_TIME', 'NONE'] as const;
const CANONICAL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

const completeCoverage = (snapshot: PortfolioBudgetSnapshot): boolean => {
  const coverage = snapshot.commitmentCoverage as unknown;
  if (!record(coverage)) return false;
  return REQUIRED_COMMITMENT_COVERAGE.every((key) => (
    Object.prototype.hasOwnProperty.call(coverage, key) && coverage[key] === 'COMPLETE'
  ));
};

interface InspectedTruth {
  readonly valid: boolean;
  readonly currentState: CapitalTruthState;
  readonly allowsNewExposure: boolean;
}

/** Structural truth inspection that never throws on a hostile JS caller. */
function inspectTruth(truth: unknown, nowMs: number): InspectedTruth {
  if (!record(truth)
      || !(CAPITAL_TRUTH_STATES as readonly unknown[]).includes(truth.completeness)
      || !isValidUtcMillis(truth.evaluatedAtMs)
      || validateSourcedTimestamp(truth.source).length > 0
      || !stringArray(truth.reasons)
      || !stringArray(truth.evidenceReferences)
      || !(truth.revision === null || (typeof truth.revision === 'string' && truth.revision.trim().length > 0))
      || !record(truth.freshness)) {
    return Object.freeze({ valid: false, currentState: 'UNKNOWN', allowsNewExposure: false });
  }
  const freshness = truth.freshness;
  if (!isFreshnessState(freshness.state)
      || !(FRESHNESS_BASES as readonly unknown[]).includes(freshness.basis)
      || !(freshness.ageMs === null || (typeof freshness.ageMs === 'number' && Number.isSafeInteger(freshness.ageMs)))
      || !isDataAuthority(freshness.effectiveAuthority)
      || !isValidUtcMillis(freshness.evaluatedAt)
      || freshness.evaluatedAt !== truth.evaluatedAtMs) {
    return Object.freeze({ valid: false, currentState: 'UNKNOWN', allowsNewExposure: false });
  }

  const typed = truth as unknown as Readonly<TruthMetadata>;
  if (typed.completeness !== 'COMPLETE') {
    return Object.freeze({ valid: true, currentState: typed.completeness, allowsNewExposure: false });
  }
  try {
    const originallyAssessed = assessCapitalTruth({
      source: typed.source,
      evaluatedAtMs: typed.evaluatedAtMs,
      requiredValuePresent: true,
      reasons: typed.reasons,
      evidenceReferences: typed.evidenceReferences,
      revision: typed.revision,
    });
    if (originallyAssessed.completeness !== typed.completeness
        || originallyAssessed.freshness.state !== typed.freshness.state
        || originallyAssessed.freshness.ageMs !== typed.freshness.ageMs
        || originallyAssessed.freshness.basis !== typed.freshness.basis
        || originallyAssessed.freshness.effectiveAuthority !== typed.freshness.effectiveAuthority) {
      return Object.freeze({ valid: false, currentState: 'UNKNOWN', allowsNewExposure: false });
    }
    const current = assessCapitalTruth({
      source: typed.source,
      evaluatedAtMs: nowMs,
      requiredValuePresent: true,
      reasons: typed.reasons,
      evidenceReferences: typed.evidenceReferences,
      revision: typed.revision,
    });
    return Object.freeze({
      valid: true,
      currentState: current.completeness,
      allowsNewExposure: truthAllowsNewExposure(current),
    });
  } catch {
    return Object.freeze({ valid: false, currentState: 'UNKNOWN', allowsNewExposure: false });
  }
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

function validIntegerBound(bound: IntegerPolicyBound, unit: 'COUNT' | 'MILLISECONDS'): boolean {
  return Number.isSafeInteger(bound.value)
    && Number.isSafeInteger(bound.minimum)
    && Number.isSafeInteger(bound.maximum)
    && bound.minimum >= 0
    && bound.minimum <= bound.maximum
    && bound.value >= bound.minimum
    && bound.value <= bound.maximum
    && bound.unit === unit;
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

/**
 * Derives the only valid revision for a CapitalBudgetPolicy from every policy
 * semantic except the revision field itself. This prevents a caller from
 * retaining an old revision while widening a limit or changing its authority
 * window. Authentic distribution of that content-addressed policy remains the
 * responsibility of a future trusted configuration adapter.
 */
export function deriveCapitalBudgetPolicyRevision(
  policy: Readonly<CapitalBudgetPolicy>,
): CapitalBudgetPolicy['authority']['revision'] {
  const { authority, ...policySemantics } = policy;
  const { revision: _revision, ...authoritySemantics } = authority;
  return deriveCapitalConfigRevision('budget-policy', Object.freeze({
    ...policySemantics,
    authority: authoritySemantics,
  }));
}

export function validateCapitalBudgetPolicy(policy: Readonly<CapitalBudgetPolicy>, nowMs: number): BudgetValidation {
  const reasons: string[] = [];
  if (!isValidUtcMillis(nowMs)) reasons.push('NOW_INVALID');
  if (policy.valuationAsset.trim().length === 0) reasons.push('VALUATION_ASSET_MISSING');
  const authority = policy.authority;
  if (authority.revision.trim().length === 0) reasons.push('POLICY_REVISION_MISSING');
  else {
    try {
      if (authority.revision !== deriveCapitalBudgetPolicyRevision(policy)) reasons.push('POLICY_REVISION_CONTENT_MISMATCH');
    } catch {
      reasons.push('POLICY_REVISION_CONTENT_MISMATCH');
    }
  }
  if (authority.sourceId.trim().length === 0) reasons.push('POLICY_SOURCE_MISSING');
  if (!isValidUtcMillis(authority.issuedAtMs) || !isValidUtcMillis(authority.effectiveFromMs)) reasons.push('POLICY_TIME_INVALID');
  if (authority.effectiveUntilMs !== null && !isValidUtcMillis(authority.effectiveUntilMs)) reasons.push('POLICY_EXPIRY_INVALID');
  if (isValidUtcMillis(authority.issuedAtMs) && isValidUtcMillis(authority.effectiveFromMs) && authority.issuedAtMs > authority.effectiveFromMs) {
    reasons.push('POLICY_ISSUED_AFTER_EFFECTIVE');
  }
  if (authority.effectiveUntilMs !== null && isValidUtcMillis(authority.effectiveFromMs)
      && isValidUtcMillis(authority.effectiveUntilMs) && authority.effectiveUntilMs <= authority.effectiveFromMs) {
    reasons.push('POLICY_EFFECTIVE_WINDOW_INVALID');
  }
  if (isValidUtcMillis(nowMs) && nowMs < authority.effectiveFromMs) reasons.push('POLICY_NOT_EFFECTIVE');
  if (isValidUtcMillis(nowMs) && authority.effectiveUntilMs !== null
      && isValidUtcMillis(authority.effectiveUntilMs) && nowMs >= authority.effectiveUntilMs) reasons.push('POLICY_EXPIRED');

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
  const integerBounds: readonly [string, IntegerPolicyBound, 'COUNT' | 'MILLISECONDS'][] = [
    ['MAX_CONCURRENT_PLANS', policy.maximumConcurrentPlans, 'COUNT'],
    ['MAX_ACTIVE_POSITIONS', policy.maximumActivePositions, 'COUNT'],
    ['RESERVATION_TTL', policy.reservationTtlMs, 'MILLISECONDS'],
  ];
  for (const [label, bound, unit] of integerBounds) {
    if (!validIntegerBound(bound, unit)) reasons.push(`${label}_BOUND_INVALID`);
  }
  return Object.freeze({ valid: reasons.length === 0, reasonCodes: Object.freeze([...new Set(reasons)].sort()) });
}

export function validatePortfolioBudgetSnapshot(snapshot: Readonly<PortfolioBudgetSnapshot>, nowMs: number): BudgetValidation {
  const reasons: string[] = [];
  if (!isValidUtcMillis(nowMs)) reasons.push('NOW_INVALID');
  if (snapshot.valuationAsset.trim().length === 0) reasons.push('SNAPSHOT_VALUATION_ASSET_MISSING');
  const inspectedTruth = inspectTruth(snapshot.truth, nowMs);
  if (!inspectedTruth.valid) reasons.push('SNAPSHOT_TRUTH_INVALID');
  else if (inspectedTruth.currentState !== 'COMPLETE' || !inspectedTruth.allowsNewExposure) {
    reasons.push(`SNAPSHOT_TRUTH_${inspectedTruth.currentState}`);
  }
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
  try {
    if (compareExactDecimals(absoluteExactDecimal(snapshot.netDirectionalExposure), snapshot.grossExposureAndCommitments) > 0) {
      reasons.push('NET_EXPOSURE_EXCEEDS_GROSS');
    }
  } catch {
    // Exact-field issues above are the canonical malformed-value reports.
  }

  const binding = snapshot.collateralPoolBinding as unknown;
  if (!record(binding)) {
    reasons.push('COLLATERAL_POOL_BINDING_INVALID');
  } else {
    if (typeof binding.sourcePoolId !== 'string' || !CANONICAL_IDENTIFIER.test(binding.sourcePoolId)) {
      reasons.push('COLLATERAL_POOL_SOURCE_INVALID');
    }
    for (const [label, value] of [
      ['COLLATERAL_POOL_TOTAL', binding.sourcePoolTotal],
      ['OTHER_UNAVAILABLE_COLLATERAL', binding.otherUnavailableCollateral],
    ] as const) {
      try {
        if (normalizeNonNegativeExactDecimal(value as NonNegativeDecimal) !== value) reasons.push(`${label}_NOT_CANONICAL`);
      } catch {
        reasons.push(`${label}_INVALID`);
      }
    }
    try {
      const exactPartitionTotal = addExactDecimals(
        addExactDecimals(snapshot.entryCollateralAvailable, snapshot.protectedRiskReductionReserve),
        binding.otherUnavailableCollateral as NonNegativeDecimal,
      );
      if (compareExactDecimals(exactPartitionTotal, binding.sourcePoolTotal as NonNegativeDecimal) !== 0) {
        reasons.push('COLLATERAL_POOL_PARTITION_MISMATCH');
      }
    } catch {
      // Exact-field issues above are the canonical malformed-value reports.
    }
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
  let derivedConcurrentPlans = 0;
  let derivedActivePositions = 0;
  if (!Array.isArray(snapshot.commitments)) {
    reasons.push('COMMITMENTS_INVALID');
  } else {
    for (const item of snapshot.commitments) {
      if (!record(item)) {
        reasons.push('COMMITMENT_INVALID');
        continue;
      }
      const id = item.id;
      const capitalClaimKey = item.capitalClaimKey;
      const kind = item.kind;
      if (typeof id !== 'string' || id.trim().length === 0
          || typeof capitalClaimKey !== 'string' || capitalClaimKey.trim().length === 0) {
        reasons.push('COMMITMENT_IDENTITY_MISSING');
      }
      if (!(COMMITMENT_KINDS as readonly unknown[]).includes(kind)) reasons.push('COMMITMENT_KIND_INVALID');
      if (typeof id === 'string' && ids.has(id)) reasons.push('COMMITMENT_ID_DUPLICATE');
      if (typeof capitalClaimKey === 'string' && claims.has(capitalClaimKey)) reasons.push('CAPITAL_CLAIM_DOUBLE_COUNTED');
      if (typeof id === 'string') ids.add(id);
      if (typeof capitalClaimKey === 'string') claims.add(capitalClaimKey);
      if (kind === 'STAGED_PLAN') derivedConcurrentPlans += 1;
      if (kind === 'PARTIALLY_EXPOSED_POSITION' || kind === 'ACTIVE_POSITION') derivedActivePositions += 1;
    }
    if (snapshot.currentConcurrentPlans !== derivedConcurrentPlans) reasons.push('PLAN_COUNT_COMMITMENT_MISMATCH');
    if (snapshot.currentActivePositions !== derivedActivePositions) reasons.push('POSITION_COUNT_COMMITMENT_MISMATCH');
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

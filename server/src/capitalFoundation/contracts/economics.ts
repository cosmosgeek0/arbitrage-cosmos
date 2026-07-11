import type { CapitalTruthState } from './truth.js';
import {
  compareExactDecimals,
  isExactDecimal,
  normalizeExactDecimal,
  type ExactDecimal,
} from './decimal.js';

export const ECONOMIC_COMPONENT_STATUSES = Object.freeze([
  'KNOWN',
  'ESTIMATED',
  'MISSING',
  'NOT_APPLICABLE',
] as const);
export type EconomicComponentStatus = (typeof ECONOMIC_COMPONENT_STATUSES)[number];

export const ECONOMIC_COMPONENT_KINDS = Object.freeze([
  'MARK_TO_MARKET_LEG_PNL',
  'REALIZED_LEG_PNL',
  'BASIS_CONVERGENCE_DIVERGENCE',
  'DIRECTIONAL_CONTRIBUTION',
  'FUNDING',
  'BORROW_INTEREST_AND_FEES',
  'TRADING_COMMISSIONS',
  'ENTRY_SPREAD_COST',
  'EXIT_SPREAD_COST',
  'ESTIMATED_SLIPPAGE',
  'REALIZED_SLIPPAGE',
  'EXECUTION_SHORTFALL',
  'ONE_LEG_EXPOSURE',
  'CONVERSION_VALUATION',
  'OPERATIONAL_RECOVERY_COST',
  'RESIDUAL_UNEXPLAINED',
] as const);
export type EconomicComponentKind = (typeof ECONOMIC_COMPONENT_KINDS)[number];

export interface EconomicEstimateRange {
  readonly low: ExactDecimal;
  readonly high: ExactDecimal;
}

export interface EconomicComponent {
  readonly id: string;
  readonly kind: EconomicComponentKind;
  readonly status: EconomicComponentStatus;
  /** Signed result in the declared valuation asset; null for missing/N/A. */
  readonly amount: ExactDecimal | null;
  readonly estimateRange: Readonly<EconomicEstimateRange> | null;
  readonly valuationAsset: string;
  readonly observedAtMs: number | null;
  readonly sourceIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly strategy: 'BASIS' | 'VOLUME' | null;
  readonly opportunityId: string | null;
  readonly configRevision: string | null;
  readonly stage: string | null;
  readonly symbol: string | null;
  readonly legId: string | null;
  readonly correlationId: string | null;
}

export interface EconomicAttribution {
  readonly components: readonly Readonly<EconomicComponent>[];
  readonly valuationAsset: string;
  readonly netKnown: ExactDecimal;
  readonly netEstimatedRange: Readonly<EconomicEstimateRange> | null;
  readonly completeness: CapitalTruthState;
  readonly accountingIdentityProven: boolean;
  readonly includedComponentIds: readonly string[];
  readonly missingComponentKinds: readonly EconomicComponentKind[];
  readonly divergentReasons: readonly string[];
  readonly evaluatedAtMs: number;
}

export function validateEconomicComponent(component: EconomicComponent): readonly string[] {
  const reasons: string[] = [];
  if (typeof component.id !== 'string' || component.id.trim().length === 0) reasons.push('ID_REQUIRED');
  if (typeof component.valuationAsset !== 'string' || component.valuationAsset.trim().length === 0) {
    reasons.push('VALUATION_ASSET_REQUIRED');
  }
  if (!(ECONOMIC_COMPONENT_KINDS as readonly string[]).includes(component.kind)) reasons.push('KIND_UNKNOWN');
  if (!(ECONOMIC_COMPONENT_STATUSES as readonly string[]).includes(component.status)) reasons.push('STATUS_UNKNOWN');
  if ((component.status === 'MISSING' || component.status === 'NOT_APPLICABLE') && component.amount !== null) {
    reasons.push('ABSENT_STATUS_MUST_NOT_HAVE_AMOUNT');
  }
  if ((component.status === 'KNOWN' || component.status === 'ESTIMATED') && component.amount === null) {
    reasons.push('PRESENT_STATUS_REQUIRES_AMOUNT');
  }
  if (component.status === 'ESTIMATED' && component.estimateRange === null) {
    reasons.push('ESTIMATED_REQUIRES_RANGE');
  }
  if (component.status !== 'ESTIMATED' && component.estimateRange !== null) {
    reasons.push('ONLY_ESTIMATED_MAY_HAVE_RANGE');
  }
  if (component.amount !== null) {
    if (!isExactDecimal(component.amount)) {
      reasons.push('AMOUNT_DECIMAL_INVALID');
    } else if (normalizeExactDecimal(component.amount) !== component.amount) {
      reasons.push('AMOUNT_DECIMAL_NOT_CANONICAL');
    }
  }
  if (component.estimateRange !== null) {
    const { low, high } = component.estimateRange;
    if (!isExactDecimal(low) || !isExactDecimal(high)) {
      reasons.push('ESTIMATE_RANGE_DECIMAL_INVALID');
    } else {
      if (normalizeExactDecimal(low) !== low || normalizeExactDecimal(high) !== high) {
        reasons.push('ESTIMATE_RANGE_NOT_CANONICAL');
      }
      if (compareExactDecimals(low, high) > 0) reasons.push('ESTIMATE_RANGE_REVERSED');
      if (component.amount !== null && isExactDecimal(component.amount)
        && (compareExactDecimals(component.amount, low) < 0 || compareExactDecimals(component.amount, high) > 0)) {
        reasons.push('ESTIMATE_AMOUNT_OUTSIDE_RANGE');
      }
    }
  }
  return Object.freeze([...new Set(reasons)]);
}

export function validateEconomicAttribution(attribution: EconomicAttribution): readonly string[] {
  const reasons: string[] = [];
  if (typeof attribution.valuationAsset !== 'string' || attribution.valuationAsset.trim().length === 0) {
    reasons.push('ATTRIBUTION_VALUATION_ASSET_REQUIRED');
  }
  for (const component of attribution.components) {
    for (const reason of validateEconomicComponent(component)) {
      reasons.push(`COMPONENT_${component.id || 'UNKNOWN'}_${reason}`);
    }
    if (component.valuationAsset !== attribution.valuationAsset) {
      reasons.push(`MIXED_VALUATION_ASSET_${component.id || 'UNKNOWN'}`);
    }
  }
  if (!isExactDecimal(attribution.netKnown) || normalizeExactDecimal(attribution.netKnown) !== attribution.netKnown) {
    reasons.push('NET_KNOWN_DECIMAL_INVALID');
  }
  if (attribution.netEstimatedRange !== null) {
    if (!isExactDecimal(attribution.netEstimatedRange.low) || !isExactDecimal(attribution.netEstimatedRange.high)) {
      reasons.push('NET_ESTIMATE_RANGE_INVALID');
    } else if (compareExactDecimals(attribution.netEstimatedRange.low, attribution.netEstimatedRange.high) > 0) {
      reasons.push('NET_ESTIMATE_RANGE_REVERSED');
    }
  }
  return Object.freeze([...new Set(reasons)]);
}

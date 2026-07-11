import type {
  CapitalTruthState,
  ConfigurationAuthority,
  EconomicAttribution,
  EconomicComponent,
  EconomicComponentKind,
  EconomicComponentStatus,
  EconomicEstimateRange,
  ExactDecimal,
} from '../contracts/index.js';

export const ECONOMIC_SCOPE_KINDS = Object.freeze([
  'PROPOSAL',
  'MANDATE',
  'STAGE',
  'LEG',
  'POSITION',
  'CLOSED_OUTCOME',
] as const);
export type EconomicScopeKind = (typeof ECONOMIC_SCOPE_KINDS)[number];

export const PRICE_PNL_BASES = Object.freeze(['LEG_PRICE', 'BASIS_AND_DIRECTIONAL'] as const);
export type PricePnlBasis = (typeof PRICE_PNL_BASES)[number];

export const EXECUTION_COST_BASES = Object.freeze(['DETAILED_SPREAD_SLIPPAGE', 'EXECUTION_SHORTFALL'] as const);
export type ExecutionCostBasis = (typeof EXECUTION_COST_BASES)[number];

export interface EconomicScopeReference {
  readonly kind: EconomicScopeKind;
  readonly id: string;
  readonly strategy: 'BASIS' | 'VOLUME' | null;
  readonly opportunityId: string | null;
  readonly configRevision: string | null;
  readonly stage: string | null;
  readonly symbol: string | null;
  readonly legId: string | null;
  readonly correlationId: string | null;
}

export interface EconomicAccountingPolicy {
  /**
   * Content-addressed policy authority. Its revision covers the source,
   * effective window, and every accounting choice. It is an integrity address,
   * not a signature or an assertion that the source is trusted.
   */
  readonly authority: Readonly<ConfigurationAuthority>;
  readonly pricePnlBasis: PricePnlBasis;
  readonly executionCostBasis: ExecutionCostBasis;
  /** Expected kinds must appear as KNOWN, ESTIMATED, or explicit NOT_APPLICABLE. */
  readonly expectedComponentKinds: readonly EconomicComponentKind[];
}

export type EconomicAccountingPolicySemantics = Omit<EconomicAccountingPolicy, 'authority'> & {
  readonly authority: Omit<ConfigurationAuthority, 'revision'>;
};

export interface ComposeEconomicReportInput {
  readonly scope: Readonly<EconomicScopeReference>;
  readonly valuationAsset: string;
  readonly components: readonly Readonly<EconomicComponent>[];
  readonly policy: Readonly<EconomicAccountingPolicy>;
  readonly evaluatedAtMs: number;
}

export type EconomicMeasureStatus = EconomicComponentStatus | 'DIVERGENT';

export interface EconomicMeasure {
  readonly status: EconomicMeasureStatus;
  /** Sum of KNOWN values only; null means no known value, not zero. */
  readonly knownAmount: ExactDecimal | null;
  /** KNOWN sum plus every ESTIMATED range, when estimates exist. */
  readonly estimatedRange: Readonly<EconomicEstimateRange> | null;
  readonly componentIds: readonly string[];
  readonly missingComponentKinds: readonly EconomicComponentKind[];
  readonly reasonCodes: readonly string[];
}

export interface EconomicMeasures {
  readonly grossPricePnl: Readonly<EconomicMeasure>;
  readonly basisContribution: Readonly<EconomicMeasure>;
  readonly directionalContribution: Readonly<EconomicMeasure>;
  readonly realizedPnl: Readonly<EconomicMeasure>;
  readonly unrealizedPnl: Readonly<EconomicMeasure>;
  readonly fees: Readonly<EconomicMeasure>;
  readonly spread: Readonly<EconomicMeasure>;
  readonly slippage: Readonly<EconomicMeasure>;
  readonly funding: Readonly<EconomicMeasure>;
  readonly borrow: Readonly<EconomicMeasure>;
  readonly executionShortfall: Readonly<EconomicMeasure>;
  readonly oneLegExposure: Readonly<EconomicMeasure>;
  readonly recovery: Readonly<EconomicMeasure>;
  readonly fxValuation: Readonly<EconomicMeasure>;
  readonly unexplainedResidual: Readonly<EconomicMeasure>;
}

export const ECONOMIC_DIMENSIONS = Object.freeze([
  'strategy',
  'opportunityId',
  'configRevision',
  'stage',
  'symbol',
  'legId',
  'correlationId',
] as const);
export type EconomicDimension = (typeof ECONOMIC_DIMENSIONS)[number];

export interface EconomicDimensionSummary {
  readonly dimension: EconomicDimension;
  readonly expectedValue: string | null;
  readonly values: readonly string[];
  readonly completeness: CapitalTruthState;
  readonly missingComponentIds: readonly string[];
  readonly conflictingComponentIds: readonly string[];
}

export interface EconomicIdentityProof {
  readonly knownIncludedComponentIds: readonly string[];
  readonly estimatedIncludedComponentIds: readonly string[];
  readonly knownComponentSum: ExactDecimal;
  readonly estimatedLowSum: ExactDecimal | null;
  readonly estimatedHighSum: ExactDecimal | null;
  readonly equation: 'NET_KNOWN_EQUALS_SUM_KNOWN_INCLUDED_COMPONENTS';
  readonly proven: boolean;
}

export interface EconomicReport {
  readonly scope: Readonly<EconomicScopeReference>;
  readonly policy: Readonly<EconomicAccountingPolicy>;
  readonly attribution: Readonly<EconomicAttribution>;
  readonly measures: Readonly<EconomicMeasures>;
  readonly dimensions: readonly Readonly<EconomicDimensionSummary>[];
  readonly accountingStatus: 'COMPLETE' | 'INCOMPLETE' | 'DIVERGENT';
  readonly accountingConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  readonly identity: Readonly<EconomicIdentityProof>;
  readonly excludedComponentIds: readonly string[];
}

export interface RollUpEconomicReportsInput extends Omit<ComposeEconomicReportInput, 'components'> {
  readonly childReports: readonly Readonly<EconomicReport>[];
}

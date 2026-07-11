import type {
  ActivePosition,
  AllocationDecision,
  BoundRiskDecisionReference,
  CapitalMandate,
  CapitalReservation,
  CapitalTruthState,
  EconomicAttribution,
  ExternalExecutionReference,
  ExternalReconciliationReference,
  OperatorApproval,
  OpportunityConsideration,
  PositionActionIntent,
  StagedPlan,
  StrategyProposalReference,
  TruthMetadata,
} from '../contracts/index.js';
import type { PositionEconomicsRecord } from '../checkpoint/index.js';

export const CAPITAL_TOPOLOGY_NODE_KINDS = [
  'STRATEGY_PROPOSAL', 'EVIDENCE', 'OPPORTUNITY', 'CAPITAL_BUDGET',
  'RESERVATION', 'MANDATE', 'STAGED_PLAN', 'STAGE', 'APPROVAL',
  'FUTURE_RISK', 'FUTURE_EXECUTION', 'THESIS', 'POSITION', 'POSITION_LEG',
  'RECONCILIATION', 'SUPERVISION', 'ACTION_INTENT', 'ECONOMICS', 'CHECKPOINT',
] as const;
export type CapitalTopologyNodeKind = (typeof CAPITAL_TOPOLOGY_NODE_KINDS)[number];

export const CAPITAL_TOPOLOGY_EDGE_KINDS = [
  'DERIVES_FROM', 'EVIDENCES', 'ALLOCATES', 'RESERVES', 'PLANS', 'CONTAINS',
  'AUTHORIZES', 'GATES', 'COORDINATES', 'EXPOSES', 'RECONCILES', 'SUPERVISES',
  'RECOMMENDS', 'ATTRIBUTES', 'CHECKPOINTS',
] as const;
export type CapitalTopologyEdgeKind = (typeof CAPITAL_TOPOLOGY_EDGE_KINDS)[number];

export const CAPITAL_BLOCK_CATEGORIES = [
  'NONE', 'STRATEGY_REJECTION', 'CAPITAL_BLOCK', 'APPROVAL_BLOCK', 'RISK_BLOCK',
  'EXECUTION_UNCERTAINTY', 'RECONCILIATION_DIVERGENCE', 'ECONOMIC_INVALIDATION',
  'TRUTH_DEGRADATION',
] as const;
export type CapitalBlockCategory = (typeof CAPITAL_BLOCK_CATEGORIES)[number];

export type CapitalAuthorityOwner =
  | 'BASIS_ENGINE' | 'VOLUME_ENGINE' | 'MARKET_INTELLIGENCE'
  | 'CAPITAL_SUPERVISION' | 'OPERATOR'
  | 'BACKEND_FOUNDATION_RISK' | 'BACKEND_FOUNDATION_EXECUTION'
  | 'BACKEND_FOUNDATION_RECONCILIATION' | 'UNKNOWN';

export type CapitalTopologyFreshness = 'FRESH' | 'STALE' | 'UNAVAILABLE' | 'CLOCK_SKEWED' | 'UNKNOWN';

export interface CapitalTopologyNode {
  readonly id: string;
  readonly sourceId: string;
  readonly kind: CapitalTopologyNodeKind;
  readonly authorityOwner: CapitalAuthorityOwner;
  readonly status: string;
  readonly freshness: CapitalTopologyFreshness;
  readonly completeness: CapitalTruthState;
  readonly directBlockCategory: CapitalBlockCategory;
  readonly effectiveBlockCategories: readonly CapitalBlockCategory[];
  readonly blockingReasons: readonly string[];
  readonly degradedReasons: readonly string[];
  readonly rootCauseNodeIds: readonly string[];
  readonly upstreamIds: readonly string[];
  readonly downstreamIds: readonly string[];
  readonly lastTransitionAtMs: number | null;
  readonly supportedFutureControls: readonly string[];
  readonly capitalExposed: boolean;
  readonly operatorAttentionRequired: boolean;
}

export interface CapitalTopologyEdge {
  readonly id: string;
  readonly kind: CapitalTopologyEdgeKind;
  readonly from: string;
  readonly to: string;
  readonly status: 'ACTIVE' | 'DEGRADED' | 'BLOCKED' | 'UNKNOWN';
  readonly reasonCodes: readonly string[];
}

export interface CapitalCriticalPath {
  readonly positionId: string;
  readonly positionNodeId: string;
  readonly nodeIds: readonly string[];
  readonly rootCauseNodeIds: readonly string[];
  readonly status: 'CLEAR' | 'DEGRADED' | 'BLOCKED' | 'RECOVERY_REQUIRED';
  readonly urgency: 'ROUTINE' | 'ELEVATED' | 'URGENT' | 'EMERGENCY';
}

export interface CapitalTopologySnapshot {
  readonly id: string;
  readonly evaluatedAtMs: number;
  readonly status: 'OPERATIONAL' | 'DEGRADED' | 'ATTENTION_REQUIRED';
  readonly nodes: readonly Readonly<CapitalTopologyNode>[];
  readonly edges: readonly Readonly<CapitalTopologyEdge>[];
  readonly criticalPaths: readonly Readonly<CapitalCriticalPath>[];
  readonly attentionNodeIds: readonly string[];
  readonly exposedPositionIds: readonly string[];
}

export interface CapitalTopologyEvidenceReference {
  readonly id: string;
  readonly status: string;
  readonly truth: Readonly<TruthMetadata>;
  readonly lastTransitionAtMs: number | null;
  readonly reasonCodes: readonly string[];
}

export interface CapitalSupervisorDecisionReference {
  readonly id: string;
  readonly positionId: string;
  readonly status: string;
  readonly truth: Readonly<TruthMetadata>;
  readonly lastTransitionAtMs: number;
  readonly reasonCodes: readonly string[];
  readonly actionIntentIds: readonly string[];
}

export interface CapitalTopologyCheckpointReference {
  readonly id: string;
  readonly revision: number;
  readonly createdAtMs: number;
  readonly recordIds: readonly string[];
  readonly truth: Readonly<TruthMetadata>;
}

export interface CapitalTopologyTruthReference {
  readonly sourceId: string;
  readonly truth: Readonly<TruthMetadata>;
}

export interface CapitalTopologyInput {
  readonly evaluatedAtMs: number;
  readonly proposals: readonly Readonly<StrategyProposalReference>[];
  readonly evidence: readonly Readonly<CapitalTopologyEvidenceReference>[];
  readonly considerations: readonly Readonly<OpportunityConsideration>[];
  readonly allocationDecisions: readonly Readonly<AllocationDecision>[];
  readonly reservations: readonly Readonly<CapitalReservation>[];
  readonly mandates: readonly Readonly<CapitalMandate>[];
  readonly stagedPlans: readonly Readonly<StagedPlan>[];
  readonly approvals: readonly Readonly<OperatorApproval>[];
  readonly riskDecisions: readonly Readonly<BoundRiskDecisionReference>[];
  readonly executionReferences: readonly Readonly<ExternalExecutionReference>[];
  readonly positions: readonly Readonly<ActivePosition>[];
  readonly reconciliationReferences: readonly Readonly<ExternalReconciliationReference>[];
  readonly supervisionDecisions: readonly Readonly<CapitalSupervisorDecisionReference>[];
  readonly intents: readonly Readonly<PositionActionIntent>[];
  readonly economics: readonly Readonly<PositionEconomicsRecord>[];
  readonly checkpoint: Readonly<CapitalTopologyCheckpointReference> | null;
  readonly truthReferences: readonly Readonly<CapitalTopologyTruthReference>[];
}

export interface CapitalTopologyEconomicReference {
  readonly positionId: string;
  readonly attribution: Readonly<EconomicAttribution>;
}

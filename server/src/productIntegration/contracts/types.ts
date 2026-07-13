import type {
  Completeness,
  DataAuthority,
  DesiredRuntimeState,
  StructuredFailure,
} from '../../foundation/contracts/index.js';

/**
 * Product-integration contracts are read/projection contracts only. Domain
 * owners remain the authorities named in ARCHITECTURE.md Part II.
 */
export const PRODUCT_COMPONENT_LIFECYCLES = Object.freeze([
  'STOPPED',
  'START_REQUESTED',
  'STARTING',
  'WARMING',
  'READY',
  'DEGRADED',
  'PAUSED',
  'DRAINING',
  'RECONCILING',
  'RECOVERY_REQUIRED',
  'BLOCKED',
  'FAILED',
  'STOPPING',
] as const);
export type ProductComponentLifecycle = (typeof PRODUCT_COMPONENT_LIFECYCLES)[number];

export const PRODUCT_CAPABILITY_POSTURES = Object.freeze([
  'LIVE_PUBLIC',
  'LIVE_PRIVATE_READ',
  'LIVE_SIGNED_VALIDATE',
  'LIVE_MANUAL_CAPPED',
  'SHADOW',
  'DRY_RUN',
  'REPLAY',
  'SYNTHETIC',
  'NOT_CONFIGURED',
  'UNAVAILABLE',
  'UNKNOWN',
] as const);
export type ProductCapabilityPosture = (typeof PRODUCT_CAPABILITY_POSTURES)[number];

export const PRODUCT_COMPONENT_ROLES = Object.freeze([
  'SHELL',
  'SOURCE',
  'INTAKE',
  'ANALYTICAL',
  'OPPORTUNITY',
  'CAPITAL',
  'RISK',
  'PRIVATE_TRUTH',
  'EXECUTION',
  'RECONCILIATION',
  'RECOVERY',
  'OUTCOME',
  'PERSISTENCE',
  'COCKPIT',
] as const);
export type ProductComponentRole = (typeof PRODUCT_COMPONENT_ROLES)[number];

export const PRODUCT_LIVENESS_STATES = Object.freeze(['ALIVE', 'STALE', 'STOPPED', 'UNKNOWN'] as const);
export type ProductLivenessState = (typeof PRODUCT_LIVENESS_STATES)[number];

export const PRODUCT_READINESS_STATES = Object.freeze([
  'READY',
  'WARMING',
  'DEGRADED',
  'RECOVERY_REQUIRED',
  'BLOCKED',
  'FAILED',
  'STOPPED',
  'UNKNOWN',
] as const);
export type ProductReadinessState = (typeof PRODUCT_READINESS_STATES)[number];

export const PRODUCT_TRADE_READINESS_STATES = Object.freeze([
  'READY',
  'DEGRADED',
  'BLOCKED',
  'NOT_APPLICABLE',
] as const);
export type ProductTradeReadinessState = (typeof PRODUCT_TRADE_READINESS_STATES)[number];

export const PRODUCT_SEVERITIES = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'] as const);
export type ProductSeverity = (typeof PRODUCT_SEVERITIES)[number];

export interface ProductRevisionSet {
  readonly build: string | null;
  readonly config: string | null;
  readonly schema: string | null;
  readonly model: string | null;
}

export interface ProductQueueEvidence {
  readonly depth: number | null;
  readonly capacity: number | null;
  readonly dropped: number | null;
  readonly coalesced: number | null;
  readonly backpressure: 'NONE' | 'ACTIVE' | 'SATURATED' | 'UNKNOWN';
  readonly observedAtMs: number | null;
  readonly maxAgeMs: number;
}

export interface ProductTimingEvidence {
  readonly heartbeatAtMs: number | null;
  readonly lastInputEventAtMs: number | null;
  readonly lastReceiveAtMs: number | null;
  readonly lastProcessedAtMs: number | null;
  readonly lastMeaningfulAdvanceAtMs: number | null;
  readonly heartbeatMaxAgeMs: number;
  readonly sourceMaxAgeMs: number | null;
  readonly processingMaxAgeMs: number | null;
  readonly meaningfulAdvanceMaxAgeMs: number | null;
}

/** Owner-supplied evidence. This shape does not decide or mutate owner state. */
export interface ProductComponentEvidence {
  readonly componentId: string;
  readonly ownerId: string;
  readonly ownerPath: string;
  readonly desiredState: DesiredRuntimeState;
  readonly observedLifecycle: ProductComponentLifecycle;
  readonly capability: ProductCapabilityPosture;
  readonly authority: DataAuthority;
  readonly completeness: Completeness;
  readonly roles: readonly ProductComponentRole[];
  readonly requiredDependencies: readonly string[];
  readonly optionalDependencies: readonly string[];
  readonly timing: Readonly<ProductTimingEvidence>;
  readonly queue: Readonly<ProductQueueEvidence> | null;
  readonly queueRequired: boolean;
  readonly blockerCodes: readonly string[];
  readonly lastFailure: Readonly<StructuredFailure> | null;
  readonly supportedCommandIds: readonly string[];
  readonly revisions: Readonly<ProductRevisionSet>;
  readonly restartGeneration: number;
  readonly restartCount: number;
  readonly capitalExposed: boolean;
  readonly operatorAttentionRequired: boolean;
  /** True only when this component is a required gate for new exposure. */
  readonly tradeCritical: boolean;
  /** Explicit owner/integration declaration; never inferred from graph shape. */
  readonly requiredForProductReadiness: boolean;
}

export interface ProductAgeProjection {
  readonly heartbeatAgeMs: number | null;
  readonly sourceEventAgeMs: number | null;
  readonly receiveAgeMs: number | null;
  readonly processingAgeMs: number | null;
  readonly meaningfulAdvanceAgeMs: number | null;
}

export interface ProductComponentProjection extends ProductComponentEvidence {
  readonly liveness: ProductLivenessState;
  readonly readiness: ProductReadinessState;
  readonly tradeReadiness: ProductTradeReadinessState;
  readonly ages: Readonly<ProductAgeProjection>;
  readonly rootBlockerComponentId: string | null;
  readonly dependencyPath: readonly string[];
  readonly affectedComponentIds: readonly string[];
  readonly affectedCapitalExposed: boolean;
  readonly severity: ProductSeverity;
  readonly projectionReasonCodes: readonly string[];
}

export interface ProductDependencyProjection {
  readonly from: string;
  readonly to: string;
  readonly required: boolean;
  readonly state: 'AVAILABLE' | 'DEGRADED' | 'BLOCKED' | 'UNKNOWN';
  readonly rootBlockerComponentId: string | null;
}

export interface ProductOperatorAttentionItem {
  readonly componentId: string;
  readonly rootBlockerComponentId: string;
  readonly severity: ProductSeverity;
  readonly reasonCodes: readonly string[];
  readonly capitalExposed: boolean;
  readonly recommendedOperatorAction: string | null;
}

export interface ProductSupervisorProjection {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly evaluatedAtMs: number;
  readonly overallReadiness: ProductReadinessState;
  readonly tradeReadiness: ProductTradeReadinessState;
  readonly components: readonly Readonly<ProductComponentProjection>[];
  readonly dependencies: readonly Readonly<ProductDependencyProjection>[];
  readonly rootBlockerComponentIds: readonly string[];
  readonly operatorAttention: readonly Readonly<ProductOperatorAttentionItem>[];
  readonly revisions: Readonly<ProductRevisionSet>;
}

export interface ProductStrategyDecisionReference {
  readonly strategy: 'BASIS' | 'VOLUME';
  readonly ownerId: string;
  readonly decisionId: string;
  readonly proposalId: string | null;
  readonly revision: string | null;
  readonly correlationId: string;
  readonly occurredAtMs: number;
  readonly verdict: 'PROPOSED' | 'REJECTED' | 'NO_ACTION' | 'UNKNOWN';
  readonly reasonCodes: readonly string[];
  readonly authority: DataAuthority;
  readonly completeness: Completeness;
  readonly expiresAtMs: number | null;
}

export interface ProductQAssessmentReference {
  readonly protocolVersion: 1;
  readonly protocolSchemaSha256: string;
  readonly assessmentId: string;
  readonly traceId: string;
  readonly envelopeHash: string;
  readonly revision: number;
  readonly strategyFamily: string;
  readonly hypothesisId: string;
  readonly symbol: string;
  readonly datasetVersion: string;
  readonly featureVersion: string;
  readonly labelVersion: string;
  readonly modelVersion: string;
  readonly calibrationVersion: string;
  readonly configVersion: string | null;
  readonly advisoryAction: 'IGNORE' | 'WATCH' | 'FOCUS' | 'PROPOSE_CONSIDERATION' | 'ABSTAIN_UNKNOWN';
  readonly disposition: 'USABLE_ADVISORY' | 'ABSTAIN' | 'REJECTED';
  readonly authority: DataAuthority;
  readonly completeness: Completeness;
  readonly generatedAtMs: number;
  readonly eventTimeMs: number | null;
  readonly receiveAtMs: number;
  readonly expiresAtMs: number;
  readonly uncertainty: Readonly<{ epistemic: string; model: string; data: string }>;
  readonly oodState: string;
  readonly driftState: string;
  readonly sourceQuality: Readonly<{
    freshness: string;
    protocolCompleteness: string;
    gapCount: number;
    duplicate: boolean;
    reconstructed: boolean;
  }>;
  readonly predictionTargets: readonly string[];
  readonly economicAssumptionState: 'LIVE' | 'HYPOTHETICAL';
  readonly economicAssumptionExpiresAtMs: number;
  readonly missingEconomicFields: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly parentEvidenceIds: readonly string[];
}

export interface ProductCapitalRiskReference {
  readonly opportunityId: string;
  readonly capitalVerdictId: string | null;
  readonly riskVerdictId: string | null;
  readonly capitalVerdict: 'PERMIT' | 'CAP' | 'REJECT' | 'UNAVAILABLE';
  readonly riskVerdict: 'APPROVE' | 'CAP' | 'REJECT' | 'UNAVAILABLE';
  readonly evaluatedAtMs: number;
  readonly reasonCodes: readonly string[];
  readonly authority: DataAuthority;
}

export interface ProductOpportunityReference {
  readonly opportunityId: string;
  readonly ownerId: string;
  readonly revision: string | null;
  readonly status: string;
  readonly correlationId: string;
  readonly authority: DataAuthority;
  readonly completeness: Completeness;
  readonly expiresAtMs: number | null;
}

export interface ProductExecutionReference {
  readonly ticketId: string | null;
  readonly executionState: string;
  readonly reconciliationState: 'EXACT' | 'PENDING' | 'PARTIAL' | 'AMBIGUOUS' | 'DIVERGED' | 'STALE' | 'UNAVAILABLE';
  readonly positionIds: readonly string[];
  readonly liabilityIds: readonly string[];
  readonly recoveryCampaignIds: readonly string[];
  readonly blocksNewExposure: boolean;
  readonly authority: DataAuthority;
  readonly observedAtMs: number;
  readonly reasonCodes: readonly string[];
}

export interface ProductOutcomeFeedbackReference {
  readonly outcomeId: string;
  readonly assessmentId: string | null;
  readonly dedupeKey: string;
  readonly payloadHash: string;
  readonly reconciliationState: ProductExecutionReference['reconciliationState'];
  readonly completeness: Completeness;
}

export type {
  Completeness,
  DataAuthority,
  DesiredRuntimeState,
  StructuredFailure,
};

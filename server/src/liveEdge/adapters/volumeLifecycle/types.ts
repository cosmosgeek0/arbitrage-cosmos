import type { TwinScenarioState } from '../exchangeTwin/index.js';

export const VOLUME_PROTECTION_POLICY_SCHEMA = 'LIVE_EDGE_VOLUME_PROTECTION_POLICY_V1' as const;
export const VOLUME_PROTECTION_REVISION_DECISION_SCHEMA = 'LIVE_EDGE_VOLUME_PROTECTION_REVISION_DECISION_V1' as const;
export const VOLUME_LIFECYCLE_INPUT_SCHEMA = 'LIVE_EDGE_VOLUME_LIFECYCLE_INPUT_V1' as const;
export const VOLUME_LIFECYCLE_PROJECTION_SCHEMA = 'LIVE_EDGE_VOLUME_LIFECYCLE_PROJECTION_V1' as const;
export const VOLUME_LIFECYCLE_DECISION_SCHEMA = 'LIVE_EDGE_VOLUME_LIFECYCLE_DECISION_V1' as const;

export type VolumeLifecycleState =
  | 'PROBE'
  | 'CONFIRM'
  | 'ADD_ALLOWED'
  | 'HOLD'
  | 'REDUCE'
  | 'EXIT'
  | 'RECOVERY_REQUIRED';

export type VolumeDirection = 'LONG' | 'SHORT';
export type VolumeSide = 'BUY' | 'SELL';
export type VolumeEntryKind = 'CONTINUATION' | 'FADE';
export type VolumeSignalState = 'PRESENT' | 'ABSENT' | 'UNKNOWN';
export type VolumeTruthState = 'COMPLETE' | 'PARTIAL' | 'STALE' | 'UNKNOWN';

export interface VolumeProtectionPolicy {
  readonly schema: typeof VOLUME_PROTECTION_POLICY_SCHEMA;
  readonly policyId: string;
  readonly policyRevision: string;
  readonly revisionSequence: number;
  readonly priorPolicyRevision: string | null;
  readonly effectiveFromMs: number;
  readonly maximumHoldingMs: number;
  readonly maximumLossBps: number;
  readonly trailingActivationBps: number;
  readonly trailingDistanceBps: number;
  readonly maximumEvidenceAgeMs: number;
  readonly noRepeatWindowMs: number;
  readonly probeCumulativePpm: number;
  readonly confirmCumulativePpm: number;
  readonly fullCumulativePpm: number;
  readonly exhaustionReductionTargetPpm: number;
  readonly sourceDegradationAction: 'REDUCE' | 'EXIT';
}

export interface VolumeProtectionRevisionDecision {
  readonly schema: typeof VOLUME_PROTECTION_REVISION_DECISION_SCHEMA;
  readonly state: 'ACCEPTED' | 'REJECTED' | 'NOOP';
  readonly reasonCodes: readonly string[];
  readonly currentPolicyRevision: string;
  readonly proposedPolicyRevision: string;
  readonly evaluatedAtMs: number;
  readonly favorableExtremeMustBePreserved: true;
  readonly decisionRevision: string;
  readonly lifecycleAuthority: 'ADVISORY_LIFECYCLE_PROJECTION_ONLY';
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly sendEligible: false;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface VolumeProposalProjection {
  readonly owner: 'VOLUME_ENGINE';
  readonly strategy: 'VOLUME';
  readonly proposalId: string;
  readonly correlationId: string;
  readonly proposalRevision: string;
  readonly proposalDigest: string;
  readonly symbol: string;
  readonly direction: VolumeDirection;
  readonly status: 'OPEN' | 'UPDATED' | 'EXPIRED' | 'REJECTED';
  readonly entryKind: VolumeEntryKind;
  readonly marketStage: 'EMERGING' | 'CONFIRMED' | 'EXHAUSTED' | 'UNKNOWN';
  readonly createdAtMs: number;
  readonly observedAtMs: number;
  readonly expiresAtMs: number;
  readonly featureRevision: string;
  readonly evidenceRevision: string;
  readonly exitPlanRevision: string;
  readonly invalidationConditions: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface VolumeAdvisoryProjection {
  readonly owner: 'EDGE_ASSESSMENT_BRIDGE';
  readonly state: 'OBSERVED' | 'REJECTED' | 'UNKNOWN';
  readonly advisoryAction: 'PROPOSE_CONSIDERATION' | 'ABSTAIN' | 'BLOCK';
  readonly strategyFamily: 'VOLUME_WAKEUP';
  readonly ownerReference: string | null;
  readonly assessmentId: string;
  readonly assessmentRevision: number;
  readonly assessmentFingerprintSha256: string;
  readonly modelRevision: string;
  readonly featureRevision: string;
  readonly evidenceRevision: string;
  readonly observedAtMs: number;
  readonly expiresAtMs: number;
  readonly economicExpiresAtMs: number;
  readonly sourceQuality: VolumeTruthState;
  readonly stage: 'EMERGING' | 'CONFIRMED' | 'EXHAUSTED' | 'FADE' | 'UNKNOWN';
  readonly exhaustion: VolumeSignalState;
  readonly reversal: VolumeSignalState;
  readonly fadeEligible: boolean;
  readonly evidenceIds: readonly string[];
}

export interface VolumeOwnerAuthorityProjection {
  readonly evidenceKind: 'SYNTHETIC_OWNER_FIXTURE';
  readonly systemMode: 'READ_ONLY' | 'ADVISORY' | 'VALIDATE_ONLY';
  readonly capitalState: 'ACTIVE' | 'BLOCKED' | 'UNKNOWN';
  readonly capitalMandateId: string;
  readonly capitalMandateRevision: number;
  readonly capitalMandateDigest: string;
  readonly capitalReservationId: string;
  readonly capitalReservationRevision: number;
  readonly capitalMaximumQuote: string;
  readonly capitalConsumedQuote: string;
  readonly capitalExpiresAtMs: number;
  readonly riskState: 'ALLOWED' | 'BLOCKED' | 'UNKNOWN';
  readonly riskActionClass: 'OPEN' | 'ADD' | 'REDUCE' | 'EXIT' | 'RECOVERY';
  readonly riskVerdictId: string;
  readonly riskVerdictRevision: string;
  readonly riskVerdictDigest: string;
  readonly riskEvaluatedAtMs: number;
  readonly riskExpiresAtMs: number;
  readonly riskBoundLifecycleId: string | null;
  readonly riskBoundProjectionRevision: string | null;
  readonly riskBoundPositionQuantity: string;
  readonly riskContextRevision: string;
  readonly approvalState: 'VALIDATE_ONLY' | 'MISSING' | 'EXPIRED' | 'REVOKED';
  readonly approvalId: string | null;
  readonly approvalRevision: number | null;
  readonly approvalExpiresAtMs: number | null;
  readonly accountTruth: VolumeTruthState;
  readonly positionTruth: VolumeTruthState;
  readonly executionReady: false;
  readonly capitalAuthority: 'SYNTHETIC_CAPITAL_FIXTURE';
  readonly riskAuthority: 'SYNTHETIC_FOUNDATION_FIXTURE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface VolumeStageSizingCut {
  readonly targetState: 'PROBE' | 'CONFIRM' | 'HOLD';
  readonly cumulativeQuantity: string;
  readonly cumulativeNotionalQuote: string;
  readonly priceBound: string;
}

export interface VolumeSizingProjection {
  readonly owner: 'L04_BINANCE_INSTRUMENT_SPECS';
  readonly state: 'READY' | 'UNAVAILABLE' | 'STALE' | 'UNKNOWN';
  readonly product: 'SPOT';
  readonly symbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly accountRealmId: string;
  readonly instrumentRevision: string;
  readonly filterRevision: string;
  readonly sourceEvidenceRevision: string;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly inventoryMode: 'QUOTE_FUNDED_LONG' | 'PREOWNED_BASE_SHORT';
  readonly availableBaseQuantity: string | null;
  readonly inventoryRevision: string | null;
  readonly inventoryAsset: string | null;
  readonly inventoryAccountRealmId: string | null;
  readonly inventoryObservedAtMs: number | null;
  readonly inventoryValidUntilMs: number | null;
  readonly cuts: readonly VolumeStageSizingCut[];
}

export interface VolumeMarketProjection {
  readonly truth: VolumeTruthState;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly currentPrice: string;
  readonly intendedPriceBound: string;
  readonly riskReductionPriceBound: string;
  readonly intendedDepthQuote: string;
  readonly minimumDepthQuote: string;
  readonly expectedCostQuote: string;
  readonly expectedDownsideQuote: string;
  readonly spreadBps: number;
  readonly maximumSpreadBps: number;
  readonly bookRevision: string;
  readonly costRevision: string;
  readonly downsideRevision: string;
  readonly evidenceIds: readonly string[];
}

export interface VolumeLifecycleSignals {
  readonly thesisInvalidated: boolean | null;
  readonly exhaustion: VolumeSignalState;
  readonly reversal: VolumeSignalState;
  readonly confirmation: 'CONFIRMED' | 'PENDING' | 'FAILED' | 'UNKNOWN';
  readonly addPermission: 'ALLOWED' | 'BLOCKED' | 'UNKNOWN';
  readonly manualClose: boolean;
  readonly globalHalt: boolean;
  readonly sourceState: 'HEALTHY' | 'DEGRADED' | 'STALE' | 'UNKNOWN';
  readonly spreadDepthState: 'HEALTHY' | 'DETERIORATED' | 'UNKNOWN';
  readonly reconciliationState: 'EXACT' | 'MISMATCH' | 'UNKNOWN';
  readonly recoveryDisposition: 'PENDING' | 'RESOLVED' | 'MANUAL' | 'UNKNOWN';
  readonly recoveryOutcome: 'NONE' | 'NO_EFFECT' | 'POSITION_RECONSTRUCTION_REQUIRED' | 'UNKNOWN';
  readonly recoveryRevision: string | null;
  readonly currentPrice: string;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly evidenceIds: readonly string[];
}

export interface VolumeOccupancyRecord {
  readonly recordId: string;
  readonly recordRevision: string;
  readonly kind: 'POSITION' | 'TICKET';
  readonly lifecycleId: string;
  readonly proposalId: string;
  readonly assessmentId: string;
  readonly symbol: string;
  readonly direction: VolumeDirection;
  readonly ownerFamily: string;
  readonly state: 'ACTIVE' | 'RECOVERY_REQUIRED' | 'CLOSED';
  readonly positionQuantity: string | null;
  readonly intentKey: string | null;
  readonly actionKey: string | null;
}

export interface VolumePriorActionRecord {
  readonly actionKey: string;
  readonly intentKey: string;
  readonly lifecycleId: string;
  readonly proposalId: string;
  readonly assessmentId: string;
  readonly symbol: string;
  readonly direction: VolumeDirection;
  readonly kind: 'ENTRY' | 'ADD' | 'REDUCE' | 'EXIT';
  readonly state: 'PLANNED' | 'APPLIED' | 'TERMINAL';
  readonly recordedAtMs: number;
}

export interface VolumeOccupancyProjection {
  readonly owner: 'CANONICAL_POSITION_TICKET_JOURNAL_PROJECTION';
  readonly truth: VolumeTruthState;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly activeRecords: readonly VolumeOccupancyRecord[];
  readonly priorActions: readonly VolumePriorActionRecord[];
}

export interface VolumeLifecycleActionRequest {
  readonly schema: 'LIVE_EDGE_VOLUME_ACTION_REQUEST_V1';
  readonly actionKey: string;
  readonly intentKey: string;
  readonly lifecycleId: string;
  readonly projectionRevision: string;
  readonly positionBeforeQuantity: string;
  readonly symbol: string;
  readonly direction: VolumeDirection;
  readonly kind: 'ENTRY' | 'ADD' | 'REDUCE' | 'EXIT';
  readonly stageFrom: VolumeLifecycleState | null;
  readonly stageTo: VolumeLifecycleState;
  readonly side: VolumeSide;
  readonly requestedQuantity: string;
  readonly priceBound: string;
  readonly maximumNotionalQuote: string;
  readonly mandateUsageBeforeQuote: string;
  readonly mandateUsageAfterQuote: string;
  readonly proposalId: string;
  readonly proposalRevision: string;
  readonly proposalDigest: string;
  readonly assessmentId: string;
  readonly assessmentRevision: number;
  readonly assessmentFingerprintSha256: string;
  readonly modelRevision: string;
  readonly featureRevision: string;
  readonly evidenceRevision: string;
  readonly exitPlanRevision: string;
  readonly entryEvidenceRevision: string;
  readonly ownerEvidenceRevision: string;
  readonly capitalMandateId: string;
  readonly capitalMandateRevision: number;
  readonly capitalMandateDigest: string;
  readonly capitalReservationId: string;
  readonly capitalReservationRevision: number;
  readonly capitalMaximumQuote: string;
  readonly riskVerdictId: string;
  readonly riskVerdictRevision: string;
  readonly riskVerdictDigest: string;
  readonly riskActionClass: 'OPEN' | 'ADD' | 'REDUCE' | 'EXIT';
  readonly riskContextRevision: string;
  readonly approvalId: string | null;
  readonly approvalRevision: number | null;
  readonly accountRealmId: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly inventoryMode: 'QUOTE_FUNDED_LONG' | 'PREOWNED_BASE_SHORT';
  readonly availableBaseQuantity: string | null;
  readonly inventoryRevision: string | null;
  readonly inventoryAsset: string | null;
  readonly inventoryAccountRealmId: string | null;
  readonly inventoryObservedAtMs: number | null;
  readonly inventoryValidUntilMs: number | null;
  readonly instrumentRevision: string;
  readonly filterRevision: string;
  readonly sourceEvidenceRevision: string;
  readonly bookRevision: string;
  readonly costRevision: string;
  readonly downsideRevision: string;
  readonly triggerEpisodeRevision: string | null;
  readonly triggerReasonCodes: readonly string[];
  readonly policyRevision: string;
  readonly plannedAtMs: number;
  readonly requiresOwnerPreflight: true;
  readonly requiresCanonicalRisk: true;
  readonly syntheticTwinProofRequired: true;
  readonly sendEligible: false;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
  readonly lifecycleAuthority: 'ADVISORY_LIFECYCLE_PROJECTION_ONLY';
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
}

export interface VolumeLastTransition {
  readonly from: VolumeLifecycleState | null;
  readonly to: VolumeLifecycleState;
  readonly primaryReasonCode: string;
  readonly reasonCodes: readonly string[];
  readonly occurredAtMs: number;
  readonly evidenceIds: readonly string[];
  readonly twinOutcomeRevision: string | null;
}

export interface VolumeSettledTwinRecord {
  readonly actionKey: string;
  readonly fixtureId: string;
  readonly twinStateRevision: string;
  readonly twinOutcomeRevision: string;
}

export interface VolumeLifecycleProjection {
  readonly schema: typeof VOLUME_LIFECYCLE_PROJECTION_SCHEMA;
  readonly lifecycleId: string;
  readonly projectionRevision: string;
  readonly revision: number;
  readonly symbol: string;
  readonly direction: VolumeDirection;
  readonly accountRealmId: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly proposalId: string;
  readonly proposalRevision: string;
  readonly proposalDigest: string;
  readonly featureRevision: string;
  readonly evidenceRevision: string;
  readonly exitPlanRevision: string;
  readonly invalidationConditions: readonly string[];
  readonly assessmentId: string;
  readonly assessmentRevision: number;
  readonly assessmentFingerprintSha256: string;
  readonly advisoryModelRevision: string;
  readonly advisoryFeatureRevision: string;
  readonly advisoryEvidenceRevision: string;
  readonly entryInstrumentRevision: string;
  readonly entryFilterRevision: string;
  readonly entrySourceEvidenceRevision: string;
  readonly entrySizingCuts: readonly Readonly<VolumeStageSizingCut>[];
  readonly entryInventoryMode: 'QUOTE_FUNDED_LONG' | 'PREOWNED_BASE_SHORT';
  readonly entryAvailableBaseQuantity: string | null;
  readonly entryInventoryRevision: string | null;
  readonly entryInventoryAsset: string | null;
  readonly entryInventoryAccountRealmId: string | null;
  readonly entryInventoryObservedAtMs: number | null;
  readonly entryInventoryValidUntilMs: number | null;
  readonly entryBookRevision: string;
  readonly entryCostRevision: string;
  readonly entryDownsideRevision: string;
  readonly entryEvidenceRevision: string;
  readonly capitalMandateId: string;
  readonly capitalMandateRevision: number;
  readonly capitalMandateDigest: string;
  readonly capitalReservationId: string;
  readonly capitalReservationRevision: number;
  readonly capitalMaximumQuote: string;
  readonly policyRevision: string;
  readonly state: VolumeLifecycleState;
  readonly recoveryResumeState: Exclude<VolumeLifecycleState, 'RECOVERY_REQUIRED'> | null;
  readonly openedAtMs: number | null;
  readonly stageEnteredAtMs: number;
  readonly entryAveragePrice: string | null;
  readonly currentPrice: string;
  readonly favorableExtremePrice: string | null;
  readonly positionQuantity: string;
  readonly positionQuantityTruth: 'EXACT' | 'UNKNOWN';
  readonly mandateUsageAtLifecycleStartQuote: string;
  readonly projectedMandateUsageQuote: string;
  readonly capitalUsageTruth: 'EXACT' | 'UNKNOWN';
  readonly lastNoFillOwnerEvidenceRevision: string | null;
  readonly lastNoFillIntentKey: string | null;
  readonly reductionEpisodeRevision: string | null;
  readonly reductionEpisodeReasonCodes: readonly string[] | null;
  readonly reductionBasisQuantity: string | null;
  readonly reductionTargetQuantity: string | null;
  readonly pendingAction: Readonly<VolumeLifecycleActionRequest> | null;
  readonly pendingActionBaseProjectionRevision: string | null;
  readonly pendingTwinStateRevision: string | null;
  readonly pendingTwinOutcomeRevision: string | null;
  readonly lastSettledActionKey: string | null;
  readonly lastTwinStateRevision: string | null;
  readonly lastTwinOutcomeRevision: string | null;
  readonly settledTwinHistory: readonly Readonly<VolumeSettledTwinRecord>[];
  readonly recoveryEvidenceActionKey: string | null;
  readonly recoveryEvidenceFixtureId: string | null;
  readonly recoveryEvidenceTwinStateRevision: string | null;
  readonly recoveryEvidenceTwinOutcomeRevision: string | null;
  readonly lastRecoveryResolutionRevision: string | null;
  readonly terminalOutcomeReasonCodes: readonly string[] | null;
  readonly feedbackOutcomeRevision: string | null;
  readonly lastTransition: Readonly<VolumeLastTransition>;
  readonly lifecycleAuthority: 'ADVISORY_LIFECYCLE_PROJECTION_ONLY';
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly sendEligible: false;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface VolumeTwinEvidence {
  readonly schema: 'LIVE_EDGE_VOLUME_TWIN_EVIDENCE_V1';
  readonly actionKey: string;
  readonly fixtureId: string;
  readonly twinState: Readonly<TwinScenarioState>;
}

export interface VolumeTwinSettlement {
  readonly state: 'FILLED' | 'NO_FILL' | 'PENDING' | 'RECOVERY_REQUIRED';
  readonly fixtureId: string;
  readonly twinStateRevision: string;
  readonly twinOutcomeRevision: string;
  readonly venueStatus: string;
  readonly localTruth: string;
  readonly filledQuantity: string;
  readonly filledQuoteNotional: string;
  readonly filledFeeQuote: string;
  readonly filledCapitalUsageQuote: string;
  readonly remainingQuantity: string;
  readonly reasonCodes: readonly string[];
}

export interface VolumeRecoveryHandoff {
  readonly schema: 'LIVE_EDGE_VOLUME_RECOVERY_HANDOFF_V1';
  readonly targetOwner: 'FOUNDATION_EXECUTION_RECOVERY';
  readonly kind: 'RECONCILIATION_REQUIRED' | 'CANCEL_OR_REDUCE' | 'POSITION_RECONSTRUCTION';
  readonly lifecycleId: string;
  readonly actionKey: string | null;
  readonly fixtureId: string | null;
  readonly twinStateRevision: string | null;
  readonly twinOutcomeRevision: string | null;
  readonly reasonCodes: readonly string[];
  readonly recommendationOnly: true;
  readonly sendEligible: false;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
  readonly lifecycleAuthority: 'ADVISORY_LIFECYCLE_PROJECTION_ONLY';
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
}

export interface VolumeFeedbackHandoff {
  readonly schema: 'LIVE_EDGE_VOLUME_FEEDBACK_HANDOFF_V1';
  readonly targetOwner: 'EDGE_PROTOCOL_OUTCOME_FEEDBACK';
  readonly outcomeClass: 'HYPOTHETICAL_REPLAY';
  readonly outcomeRevision: string;
  readonly lifecycleId: string;
  readonly proposalId: string;
  readonly assessmentId: string;
  readonly policyRevision: string;
  readonly terminalState: 'EXIT' | 'RECOVERY_REQUIRED';
  readonly primaryReasonCode: string;
  readonly reasonCodes: readonly string[];
  readonly twinOutcomeRevision: string | null;
  readonly realizedPnlAuthority: 'UNAVAILABLE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly lifecycleAuthority: 'ADVISORY_LIFECYCLE_PROJECTION_ONLY';
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly sendEligible: false;
  readonly externalActionAuthorization: 'NONE';
}

export interface VolumeLifecycleInput {
  readonly schema: typeof VOLUME_LIFECYCLE_INPUT_SCHEMA;
  readonly evaluatedAtMs: number;
  readonly proposal: Readonly<VolumeProposalProjection>;
  readonly advisory: Readonly<VolumeAdvisoryProjection>;
  readonly authority: Readonly<VolumeOwnerAuthorityProjection>;
  readonly policy: Readonly<VolumeProtectionPolicy>;
  readonly sizing: Readonly<VolumeSizingProjection>;
  readonly market: Readonly<VolumeMarketProjection>;
  readonly signals: Readonly<VolumeLifecycleSignals>;
  readonly occupancy: Readonly<VolumeOccupancyProjection>;
  readonly current: Readonly<VolumeLifecycleProjection> | null;
  readonly twinEvidence: Readonly<VolumeTwinEvidence> | null;
}

export interface VolumeLifecycleDecision {
  readonly schema: typeof VOLUME_LIFECYCLE_DECISION_SCHEMA;
  readonly disposition: 'PLANNED' | 'SETTLED' | 'HOLD' | 'BLOCKED' | 'NOOP_REPEAT' | 'RECOVERY_REQUIRED' | 'TERMINAL';
  readonly primaryReasonCode: string;
  readonly reasonCodes: readonly string[];
  readonly projection: Readonly<VolumeLifecycleProjection> | null;
  readonly actionRequest: Readonly<VolumeLifecycleActionRequest> | null;
  readonly twinSettlement: Readonly<VolumeTwinSettlement> | null;
  readonly recoveryHandoff: Readonly<VolumeRecoveryHandoff> | null;
  readonly feedbackHandoff: Readonly<VolumeFeedbackHandoff> | null;
  readonly decisionRevision: string;
  readonly lifecycleAuthority: 'ADVISORY_LIFECYCLE_PROJECTION_ONLY';
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly sendEligible: false;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

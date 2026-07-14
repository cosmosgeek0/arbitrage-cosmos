export const EXPOSURE_RECOVERY_SNAPSHOT_SCHEMA =
  'LIVE_EDGE_EXPOSURE_RECOVERY_SNAPSHOT_V1' as const;

export const L12_CHAIN_STAGES = Object.freeze([
  'PROPOSAL',
  'CAPITAL_MANDATE',
  'RESERVATION',
  'APPROVAL_AUTHORITY',
  'RISK_VERDICT',
  'TICKET_PREFLIGHT',
  'MUTATION_DISPATCH',
  'CONFIRMED_FILL_EXPOSURE',
  'RESERVATION_SETTLEMENT',
  'OUTCOME_RECONCILIATION',
] as const);
export type L12ChainStage = (typeof L12_CHAIN_STAGES)[number];

export const L12_CONTROL_ACTIONS = Object.freeze([
  'ACTIVATE_PROPOSAL',
  'OPEN_EXPOSURE',
  'ADD_EXPOSURE',
  'REPEAT_ENTRY',
  'MARKET_PRIVATE_STREAMS',
  'RECONCILIATION_READ',
  'CANCEL',
  'REDUCE',
  'CLOSE',
  'HEDGE',
  'UNWIND',
  'REPAY_LIABILITY',
  'RECOVERY',
  'LEDGER_READ_MODEL',
] as const);
export type L12ControlAction = (typeof L12_CONTROL_ACTIONS)[number];

export const L12_COLD_START_STEPS = Object.freeze([
  'LOAD_DURABLE_TICKETS_AND_JOURNAL',
  'CONNECT_RELEVANT_PRIVATE_STREAMS',
  'FETCH_SIGNED_ACCOUNT_TRUTH',
  'RECONSTRUCT_AND_COMPARE',
  'DECLARE_MISMATCHES_AND_ORPHANS',
  'RESUME_SUPERVISION_AND_RECOVERY',
  'ENABLE_DESIRED_ENTRY_MODE',
] as const);
export type L12ColdStartStep = (typeof L12_COLD_START_STEPS)[number];

export const L12_RECOVERY_SCENARIOS = Object.freeze([
  'TIMEOUT_AFTER_SUBMIT',
  'PRIVATE_EVENT_BEFORE_HTTP_RESPONSE',
  'DUPLICATE_OR_OUT_OF_ORDER_PRIVATE_EVENTS',
  'PARTIAL_FIRST_LEG_FILL',
  'SECOND_LEG_REJECTED_OR_PARTIAL',
  'DISCONNECT_DURING_ENTRY',
  'DISCONNECT_DURING_EXIT',
  'SERVER_CRASH_EVERY_TICKET_STATE',
  'MANUAL_EXCHANGE_ORDER_POSITION_OR_REPAYMENT',
  'BORROW_CONFIRMED_SPOT_REJECTED',
  'SPOT_SHORT_COVERED_REPAY_REJECTED',
  'FUTURES_POSITION_WITHOUT_LOCAL_TICKET',
  'LOCAL_TICKET_WITHOUT_EXCHANGE_POSITION',
  'DATABASE_FAILURE_BEFORE_SEND',
  'DATABASE_OR_TELEMETRY_DEGRADED_AFTER_AMBIGUOUS_SEND',
  'STALE_PRIVATE_TRUTH',
  'EXCHANGE_FILTER_OR_STATUS_CHANGED',
  'RATE_LIMIT_OR_BAN_COOLDOWN',
  'QUANT_BRIDGE_FAILURE_WHILE_ACTIVE',
  'CLOUD_ALARM_FORCED_HALT',
] as const);
export type L12RecoveryScenario = (typeof L12_RECOVERY_SCENARIOS)[number];

export const L12_CRASH_FAULT_CUTS = Object.freeze([
  'BEFORE_FIRST_EVENT',
  'AFTER_BORROW_AND_LIABILITY',
  'AFTER_MARGIN_ENTRY',
  'AFTER_FUTURES_ENTRY',
  'AFTER_MARGIN_EXIT',
  'AFTER_FUTURES_EXIT',
  'AFTER_REPAY_OBSERVED',
  'AFTER_ZERO_LIABILITY',
  'AFTER_CLOSURE_RECONCILED',
] as const);
export type L12CrashFaultCut = (typeof L12_CRASH_FAULT_CUTS)[number];

export interface L12SubjectIdentity {
  readonly strategy: 'NORMAL_BASIS' | 'REVERSE_BASIS' | 'VOLUME';
  readonly proposalId: string;
  readonly assessmentId: string | null;
  readonly mandateId: string;
  readonly reservationId: string;
  readonly approvalId: string | null;
  readonly planOrLifecycleId: string;
  readonly correlationId: string;
  readonly accountRealmId: string;
  readonly symbol: string;
}

export interface L12OwnerStageEvidence {
  readonly stage: L12ChainStage;
  readonly owner:
    | 'STRATEGY_OWNER'
    | 'CAPITAL_FOUNDATION'
    | 'CAPITAL_APPROVALS'
    | 'FOUNDATION_RISK'
    | 'FOUNDATION_EXECUTION'
    | 'FOUNDATION_RECONCILIATION';
  readonly status: 'COMPLETE' | 'BLOCKED' | 'OWNER_GATED' | 'NOT_APPLICABLE';
  readonly subject: Readonly<L12SubjectIdentity>;
  readonly revision: string;
  readonly observedAtMs: number;
  readonly reasonCodes: readonly string[];
}

export interface L12RiskRecheckEvidence {
  readonly owner: 'FOUNDATION_RISK';
  readonly subject: Readonly<L12SubjectIdentity>;
  readonly verdictRevision: string;
  readonly truthRevision: string;
  readonly mutationId: string;
  readonly dispatchRevision: string;
  readonly evaluatedAtMs: number;
  readonly mutationAttemptAtMs: number;
  readonly maximumAgeMs: number;
  readonly disposition: 'PASS' | 'FAIL' | 'UNKNOWN';
  readonly currentTruthUsed: boolean;
}

export interface L12ControlAdmissionEvidence {
  readonly action: L12ControlAction;
  readonly allowed: boolean;
  readonly ownerReasonCode: string;
}

export interface L12ControlPostureEvidence {
  readonly owner: 'FOUNDATION_CONTROL';
  readonly subject: Readonly<L12SubjectIdentity>;
  readonly revision: string;
  readonly halted: boolean;
  readonly observedAtMs: number;
  readonly admissions: readonly Readonly<L12ControlAdmissionEvidence>[];
}

export interface L12ExposureVector {
  readonly owner: 'CAPITAL_FOUNDATION';
  readonly source: 'CONFIRMED_FILLS_AND_RECONCILED_EXCHANGE_TRUTH';
  readonly subject: Readonly<L12SubjectIdentity>;
  readonly ownerRevision: string;
  readonly truthRevision: string;
  readonly completeness: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  readonly observedAtMs: number;
  readonly spotBase: string | null;
  readonly marginBase: string | null;
  readonly futuresBaseEquivalent: string | null;
  readonly netBase: string | null;
  readonly grossNotional: string | null;
  readonly marginLiability: string | null;
  readonly unhedgedNotional: string | null;
  readonly unhedgedSinceMs: number | null;
}

export interface L12CapitalEconomicsEvidence {
  readonly owner: 'CAPITAL_FOUNDATION';
  readonly subject: Readonly<L12SubjectIdentity>;
  readonly positionRevision: string;
  readonly accountCapacityRevision: string;
  readonly economicsRevision: string;
  readonly supervisionRevision: string;
  readonly completeness: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  readonly observedAtMs: number;
  readonly availableCapacity: string | null;
  readonly funding: string | null;
  readonly borrowCost: string | null;
  readonly fees: string | null;
  readonly realizedPnl: string | null;
  readonly unrealizedPnl: string | null;
  readonly supervisionIntent:
    | 'HOLD'
    | 'ADD'
    | 'REDUCE'
    | 'HEDGE'
    | 'EXIT'
    | 'EMERGENCY'
    | 'FREEZE'
    | 'UNKNOWN';
  readonly requiredFutureGates: readonly string[];
}

export interface L12ReconciliationEvidence {
  readonly owner: 'FOUNDATION_RECONCILIATION' | 'OWNER_INJECTED_RECONCILIATION_EVIDENCE';
  readonly subject: Readonly<L12SubjectIdentity>;
  readonly revision: string;
  readonly status: 'EXACT' | 'MISMATCH' | 'PARTIAL' | 'STALE' | 'UNKNOWN';
  readonly observedAtMs: number;
  readonly orphanState: 'ABSENT' | 'PRESENT' | 'UNKNOWN';
  readonly orphanReferences: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface L12OutstandingEvidence {
  readonly owner: 'FOUNDATION_EXECUTION' | 'OWNER_INJECTED_RECONCILIATION_EVIDENCE';
  readonly subject: Readonly<L12SubjectIdentity>;
  readonly ownerRevision: string;
  readonly openOrderReferences: readonly string[];
  readonly ambiguousMutationReferences: readonly string[];
  readonly unmatchedFillReferences: readonly string[];
  readonly manualActivityReferences: readonly string[];
}

export interface L12RecoveryRecommendation {
  readonly owner: 'FOUNDATION_EXECUTION' | 'FOUNDATION_RECONCILIATION' | 'CAPITAL_FOUNDATION';
  readonly kind: string;
  readonly ownerRevision: string;
  readonly automatic: false;
}

export interface L12RecoveryEvidence {
  readonly subject: Readonly<L12SubjectIdentity>;
  readonly required: boolean;
  readonly ownerEndState: 'OPEN' | 'CLOSED' | 'RECOVERED' | 'MANUAL_INTERVENTION' | null;
  readonly ownerRevision: string;
  readonly residualExposure: string | null;
  readonly residualLiability: string | null;
  readonly reasonCodes: readonly string[];
  readonly recommendations: readonly Readonly<L12RecoveryRecommendation>[];
}

export interface L12ColdStartStepEvidence {
  readonly step: L12ColdStartStep;
  readonly status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED' | 'OWNER_GATED' | 'UNAVAILABLE';
  readonly ownerRevision: string | null;
  readonly observedAtMs: number | null;
  readonly reasonCodes: readonly string[];
}

export interface L12ColdStartEvidence {
  readonly startupPosture: 'HALTED' | 'RECOVERY_REQUIRED';
  readonly steps: readonly Readonly<L12ColdStartStepEvidence>[];
  readonly effectiveEntryMode: 'BLOCKED' | 'OWNER_REVIEW_ONLY';
  readonly completenessRevision: string;
}

export interface L12RecoveryCampaignEvidence {
  readonly scenario: L12RecoveryScenario;
  readonly campaignId: string;
  readonly subject: Readonly<L12SubjectIdentity>;
  readonly terminalState: 'OPEN' | 'CLOSED' | 'RECOVERED' | 'MANUAL_INTERVENTION';
  readonly ownerRevision: string;
  readonly fixtureAuthority: 'SYNTHETIC_FAULT_INJECTION';
  readonly duplicateOrderCount: 0;
  readonly residualExposureExplicit: true;
  readonly residualLiabilityExplicit: true;
  readonly hiddenResidualExposure: false;
  readonly hiddenResidualLiability: false;
  readonly traceAuthority: 'INJECTED_OWNER_TRACE_EVIDENCE';
  readonly traceDigest: string;
  readonly traceRevision: string;
  readonly initialStateRevision: string;
  readonly terminalStateRevision: string;
  readonly mutationIdentities: readonly string[];
  readonly replayObservedMutationIdentities: readonly string[];
  readonly terminalResidualExposure: string;
  readonly terminalResidualLiability: string;
  readonly terminalOutstandingReferences: readonly string[];
  readonly replayWitnesses: readonly Readonly<L12CrashReplayWitness>[];
}

export interface L12CrashReplayWitness {
  readonly faultCut: L12CrashFaultCut;
  readonly ownerState: string;
  readonly checkpointRevision: string;
  readonly cutStateRevision: string;
  readonly restoredStateRevision: string;
  readonly terminalStateRevision: string;
  readonly mutationIdentitiesBefore: readonly string[];
  readonly terminalMutationIdentities: readonly string[];
  readonly terminalResidualExposure: string;
  readonly terminalResidualLiability: string;
  readonly terminalOutstandingReferences: readonly string[];
}

export interface L12CanonicalTruthBinding {
  readonly owner: 'CAPITAL_FOUNDATION';
  readonly subject: Readonly<L12SubjectIdentity>;
  readonly accountingScopeId: string;
  readonly mutationId: string;
  readonly exposureTruthRevision: string;
  readonly capitalPositionRevision: string;
  readonly accountCapacityRevision: string;
  readonly reservationRevision: string;
  readonly reservationSettlementRevision: string;
  readonly executionRevision: string;
  readonly outstandingRevision: string;
  readonly reconciliationRevision: string;
  readonly recoveryRevision: string;
}

export interface L12ComponentEvidence {
  readonly capitalExposed: boolean;
  readonly operatorAttentionRequired: boolean;
  readonly ownerRevision: string;
  readonly reasonCodes: readonly string[];
}

export interface ExposureRecoveryProjectionInput {
  readonly subject: Readonly<L12SubjectIdentity>;
  readonly canonicalTruth: Readonly<L12CanonicalTruthBinding>;
  readonly chain: readonly Readonly<L12OwnerStageEvidence>[];
  readonly riskRecheck: Readonly<L12RiskRecheckEvidence>;
  readonly control: Readonly<L12ControlPostureEvidence>;
  readonly exposure: Readonly<L12ExposureVector>;
  readonly capital: Readonly<L12CapitalEconomicsEvidence>;
  readonly reconciliation: Readonly<L12ReconciliationEvidence>;
  readonly outstanding: Readonly<L12OutstandingEvidence>;
  readonly recovery: Readonly<L12RecoveryEvidence>;
  readonly coldStart: Readonly<L12ColdStartEvidence>;
  readonly campaigns: readonly Readonly<L12RecoveryCampaignEvidence>[];
  readonly componentEvidence: Readonly<L12ComponentEvidence>;
}

export type L12ProjectionStatus = 'BLOCKED' | 'RECOVERY_REQUIRED' | 'COMPLETE_FOR_OWNER_REVIEW';

export interface L12SupervisorSnapshot extends ExposureRecoveryProjectionInput {
  readonly schema: typeof EXPOSURE_RECOVERY_SNAPSHOT_SCHEMA;
  readonly version: 1;
  readonly projectionStatus: L12ProjectionStatus;
  readonly snapshotRevision: string;
  readonly projectionAuthority: 'OWNER_EVIDENCE_ADAPTER_ONLY';
  readonly capitalAuthority: 'CAPITAL_FOUNDATION';
  readonly lifecycleAuthority: 'FOUNDATION_EXECUTION_RECONCILIATION';
  readonly reconciliationAuthority: 'FOUNDATION_RECONCILIATION_OR_EXPLICIT_OWNER_INJECTION';
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly truthClass: 'SYNTHETIC_ONLY';
  readonly sendEligible: false;
  readonly canAuthorizeEntry: false;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

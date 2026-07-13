/**
 * Packet-local S5 cockpit reference evaluator.
 *
 * Pure and render-neutral by construction: no I/O, ambient clock, timers,
 * environment, network, persistence, controls, or production imports.
 */

export const COCKPIT_SCHEMA_VERSION = 1;

export const I00_SURFACE_IDS = Object.freeze([
  'dashboard',
  'control-room',
  'account',
  'markets',
  'token',
  'basis',
  'volume',
  'opportunities',
  'borrow',
  'execution',
  'orders',
  'positions',
  'fills',
  'pnl',
  'risk',
  'health',
  'logs-ledger',
  'notifications',
]);

export const INFORMATION_LEVEL_DEFINITIONS = Object.freeze([
  Object.freeze({
    level: 1,
    levelId: 'L1_IMMEDIATE_SAFETY_VIEW',
    title: 'Immediate safety view',
    topics: Object.freeze([
      Object.freeze({ topicId: 'L1_OVERALL_POSTURE_REASON', definition: 'Overall posture and the exact reason for it.' }),
      Object.freeze({ topicId: 'L1_TRUTH_MODE_LABEL', definition: 'Exact live, shadow, validate-only, dry-run, synthetic, blocked, unavailable, missing, or unknown truth label.' }),
      Object.freeze({ topicId: 'L1_EXPOSURE_UNRESOLVED_LIABILITY', definition: 'Active exposure and unresolved liability.' }),
      Object.freeze({ topicId: 'L1_EXECUTION_OWNER_FENCING', definition: 'Execution ownership and fencing posture.' }),
      Object.freeze({ topicId: 'L1_SOURCE_AGE_COHERENCE', definition: 'Critical source age and temporal coherence.' }),
      Object.freeze({ topicId: 'L1_SCENARIO_BOUNDED_RECOVERABILITY', definition: 'Scenario-bounded recovery and exit capacity.' }),
      Object.freeze({ topicId: 'L1_CRITICAL_UNSUPPORTED_CLAIMS', definition: 'Critical unsupported, unconfigured, or unknown claims.' }),
      Object.freeze({ topicId: 'L1_INCIDENT_PAGE_DRILLDOWN', definition: 'Immediate incident and bounded drill-down.' }),
    ]),
  }),
  Object.freeze({
    level: 2,
    levelId: 'L2_INVENTORY_DEPENDENCY_GRAPH',
    title: 'Inventory and dependency graph',
    topics: Object.freeze([
      Object.freeze({ topicId: 'L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE', definition: 'Expected, discovered, instrumented, current, stale, silent, and missing posture.' }),
      Object.freeze({ topicId: 'L2_STARTUP_RUNTIME_DEPENDENCIES', definition: 'Startup and runtime dependency identities.' }),
      Object.freeze({ topicId: 'L2_BLOCKED_DEGRADED_EDGES', definition: 'Blocked and degraded dependency edges.' }),
      Object.freeze({ topicId: 'L2_COMPONENT_IDENTITY_DENOMINATOR_COUNTS', definition: 'Component identity, owner, version, release, and exact denominator counts.' }),
    ]),
  }),
  Object.freeze({
    level: 3,
    levelId: 'L3_AUTOMATION_RESILIENCE',
    title: 'Automation and resilience',
    topics: Object.freeze([
      Object.freeze({ topicId: 'L3_RETRY_CIRCUIT_QUARANTINE_REPAIR', definition: 'Retry, circuit, quarantine, and repair state.' }),
      Object.freeze({ topicId: 'L3_PROGRESS_CADENCE_COOLDOWN_ATTEMPTS', definition: 'Progress, cadence, cooldown, attempts used, and attempt budget.' }),
      Object.freeze({ topicId: 'L3_DEADLINE_LEASE_CANCELLATION_LATE_RESULT', definition: 'Deadline, lease, cancellation, and late-result handling.' }),
      Object.freeze({ topicId: 'L3_ROLLBACK_FALLBACK_READINESS', definition: 'Rollback, fallback, and recovery readiness.' }),
      Object.freeze({ topicId: 'L3_SLO_ERROR_BUDGET_TRENDS', definition: 'SLO, error-budget, resource, backpressure, and trend state.' }),
      Object.freeze({ topicId: 'L3_SENTINEL_PAGING_RECEIPTS', definition: 'Independent sentinel, paging, and receipt evidence.' }),
    ]),
  }),
  Object.freeze({
    level: 4,
    levelId: 'L4_MONEY_DECISION_LIFECYCLE',
    title: 'Money and decision lifecycle',
    topics: Object.freeze([
      Object.freeze({ topicId: 'L4_EVIDENCE_TO_PNL_CHAIN', definition: 'Evidence through decision, action lifecycle, reconciliation, and PnL.' }),
      Object.freeze({ topicId: 'L4_PREDICTED_REALIZED_ECONOMICS', definition: 'Predicted and realized economics with costs and liabilities.' }),
      Object.freeze({ topicId: 'L4_AMBIGUITY_ABSTENTION_VERSIONING', definition: 'Ambiguity, abstention, rejection, and model or policy versioning.' }),
    ]),
  }),
  Object.freeze({
    level: 5,
    levelId: 'L5_INCIDENT_FORENSIC_DRILLDOWN',
    title: 'Incident and forensic drill-down',
    topics: Object.freeze([
      Object.freeze({ topicId: 'L5_TIMELINE_CORRELATION_TRACE', definition: 'Bounded timeline, correlation, and trace.' }),
      Object.freeze({ topicId: 'L5_ASSUMPTION_CLAIM_CAUSALITY', definition: 'Assumption, claim, and causal-dependency evidence.' }),
      Object.freeze({ topicId: 'L5_BOUNDED_EVIDENCE_IMMUTABLE_REFS', definition: 'Bounded raw evidence and immutable references.' }),
      Object.freeze({ topicId: 'L5_REPAIR_PROPOSALS_APPROVALS', definition: 'Repair proposals and approval evidence.' }),
      Object.freeze({ topicId: 'L5_DEPLOYMENT_AGENT_PROVENANCE', definition: 'Deployment revision and agent provenance.' }),
      Object.freeze({ topicId: 'L5_COUNTEREXAMPLE_FAILURE_ATLAS', definition: 'Counterexample and registered failure-atlas evidence.' }),
      Object.freeze({ topicId: 'L5_CORRECTIVE_ACTIONS', definition: 'Corrective actions, results, and proof of recovery.' }),
    ]),
  }),
]);

const SURFACE_ROUTE_LAW = Object.freeze({
  dashboard: Object.freeze({ routeKind: 'CANONICAL_SURFACE', canonicalRoute: 'dashboard', pageOwner: 'dashboard' }),
  'control-room': Object.freeze({ routeKind: 'CANONICAL_SURFACE', canonicalRoute: 'control-room', pageOwner: 'control-room' }),
  account: Object.freeze({ routeKind: 'CANONICAL_SURFACE', canonicalRoute: 'account', pageOwner: 'account' }),
  markets: Object.freeze({ routeKind: 'CANONICAL_SURFACE', canonicalRoute: 'markets', pageOwner: 'markets' }),
  token: Object.freeze({ routeKind: 'CANONICAL_SURFACE', canonicalRoute: 'token', pageOwner: 'token' }),
  basis: Object.freeze({ routeKind: 'CANONICAL_SURFACE', canonicalRoute: 'basis', pageOwner: 'basis' }),
  volume: Object.freeze({ routeKind: 'CANONICAL_SURFACE', canonicalRoute: 'volume', pageOwner: 'volume' }),
  opportunities: Object.freeze({ routeKind: 'CANONICAL_SURFACE', canonicalRoute: 'opportunities', pageOwner: 'opportunities' }),
  borrow: Object.freeze({ routeKind: 'CANONICAL_SURFACE', canonicalRoute: 'borrow', pageOwner: 'borrow' }),
  execution: Object.freeze({ routeKind: 'ACCOUNT_ALIAS', canonicalRoute: 'account', pageOwner: 'account' }),
  orders: Object.freeze({ routeKind: 'ACCOUNT_ALIAS', canonicalRoute: 'account', pageOwner: 'account' }),
  positions: Object.freeze({ routeKind: 'ACCOUNT_ALIAS', canonicalRoute: 'account', pageOwner: 'account' }),
  fills: Object.freeze({ routeKind: 'ACCOUNT_ALIAS', canonicalRoute: 'account', pageOwner: 'account' }),
  pnl: Object.freeze({ routeKind: 'ACCOUNT_ALIAS', canonicalRoute: 'account', pageOwner: 'account' }),
  risk: Object.freeze({ routeKind: 'CANONICAL_SURFACE', canonicalRoute: 'risk', pageOwner: 'risk' }),
  health: Object.freeze({ routeKind: 'CANONICAL_SURFACE', canonicalRoute: 'health', pageOwner: 'health' }),
  'logs-ledger': Object.freeze({ routeKind: 'CANONICAL_SURFACE', canonicalRoute: 'logs-ledger', pageOwner: 'logs-ledger' }),
  notifications: Object.freeze({ routeKind: 'CANONICAL_SURFACE', canonicalRoute: 'notifications', pageOwner: 'notifications' }),
});

const FACT_TOPIC_LAW_SOURCE = Object.freeze({
  "PANEL_DASHBOARD_TRUTH_V1": Object.freeze({
    "desiredState": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "observedState": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "readiness": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "liveness": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "heartbeatAgeMs": "L1_SOURCE_AGE_COHERENCE",
    "restartCount": "L3_PROGRESS_CADENCE_COOLDOWN_ATTEMPTS",
    "currentError": "L2_BLOCKED_DEGRADED_EDGES",
    "renderTruthLabel": "L1_TRUTH_MODE_LABEL",
    "mode": "L1_TRUTH_MODE_LABEL",
    "desiredMode": "L1_TRUTH_MODE_LABEL",
    "effectiveMode": "L1_TRUTH_MODE_LABEL",
    "killSwitchState": "L1_EXECUTION_OWNER_FENCING",
    "killSwitchEffect": "L1_EXECUTION_OWNER_FENCING",
    "startupGeneration": "L2_COMPONENT_IDENTITY_DENOMINATOR_COUNTS",
    "lastRestart": "L3_PROGRESS_CADENCE_COOLDOWN_ATTEMPTS",
    "lastRestartResult": "L3_PROGRESS_CADENCE_COOLDOWN_ATTEMPTS",
    "rootBlocker": "L1_OVERALL_POSTURE_REASON",
    "overallPosture": "L1_OVERALL_POSTURE_REASON",
    "activeExposureCount": "L1_EXPOSURE_UNRESOLVED_LIABILITY",
    "newestCandidateDisposition": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "newestCandidateDispositionReason": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "newestCandidateId": "L5_BOUNDED_EVIDENCE_IMMUTABLE_REFS",
    "newestCandidateSymbol": "L4_EVIDENCE_TO_PNL_CHAIN",
    "newestCandidateEvidenceRevision": "L5_BOUNDED_EVIDENCE_IMMUTABLE_REFS",
    "degradedSourceCount": "L2_BLOCKED_DEGRADED_EDGES",
    "degradedSourceIdentities": "L2_BLOCKED_DEGRADED_EDGES",
    "degradedSourceReasons": "L2_BLOCKED_DEGRADED_EDGES",
    "bootStartupTransactionState": "L2_STARTUP_RUNTIME_DEPENDENCIES",
    "deployedRevision": "L5_DEPLOYMENT_AGENT_PROVENANCE",
    "testedRevision": "L5_DEPLOYMENT_AGENT_PROVENANCE",
    "dataSourceHealthState": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "dataSourceConnectionStates": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "oldestDataSourceMessageAgeMs": "L1_SOURCE_AGE_COHERENCE",
    "dataSourceSequenceGapCount": "L2_COMPONENT_IDENTITY_DENOMINATOR_COUNTS",
    "dataSourceRateLimitBackoffState": "L3_RETRY_CIRCUIT_QUARANTINE_REPAIR",
    "dataSourceCoverageExpectedCount": "L2_COMPONENT_IDENTITY_DENOMINATOR_COUNTS",
    "dataSourceCoverageCurrentCount": "L2_COMPONENT_IDENTITY_DENOMINATOR_COUNTS",
    "quietSymbolCount": "L2_COMPONENT_IDENTITY_DENOMINATOR_COUNTS",
    "basisLiveAgeMs": "L1_SOURCE_AGE_COHERENCE",
    "basisUniverseCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "basisCandidateCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "basisFocusCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "basisProposalCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "basisLatestDecision": "L4_EVIDENCE_TO_PNL_CHAIN",
    "basisLatestRejectReasonCode": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "volumeLiveAgeMs": "L1_SOURCE_AGE_COHERENCE",
    "volumeUniverseCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "volumeCandidateCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "volumeFocusCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "volumeProposalCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "volumeLatestDecision": "L4_EVIDENCE_TO_PNL_CHAIN",
    "volumeLatestRejectReasonCode": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "qHealthState": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "qModelVersion": "L5_DEPLOYMENT_AGENT_PROVENANCE",
    "qDatasetVersion": "L5_DEPLOYMENT_AGENT_PROVENANCE",
    "qDriftState": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "qLatestAssessment": "L4_EVIDENCE_TO_PNL_CHAIN",
    "qLatestAssessmentAction": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "qLatestAbstentionReason": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "allocatableTruthState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "reservationCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "stagedMandateCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "approvalState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "approvalExpiresAtMs": "L4_EVIDENCE_TO_PNL_CHAIN",
    "capitalCeiling": "L4_PREDICTED_REALIZED_ECONOMICS",
    "equity": "L4_PREDICTED_REALIZED_ECONOMICS",
    "availableCapital": "L4_PREDICTED_REALIZED_ECONOMICS",
    "realizedPnl": "L4_PREDICTED_REALIZED_ECONOMICS",
    "drawdown": "L4_PREDICTED_REALIZED_ECONOMICS",
    "universeCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "candidateCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "focusCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "opportunityCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "activeOrderCount": "L1_EXPOSURE_UNRESOLVED_LIABILITY",
    "activePositionCount": "L1_EXPOSURE_UNRESOLVED_LIABILITY",
    "activeLiabilityCount": "L1_EXPOSURE_UNRESOLVED_LIABILITY",
    "activeRecoveryCount": "L1_SCENARIO_BOUNDED_RECOVERABILITY",
    "latestRiskVerdict": "L4_EVIDENCE_TO_PNL_CHAIN",
    "latestRiskBlockCodes": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "executionDryRunPlanState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "executionDryRunLegState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "executionReconciliationState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "liveExecutionBarrier": "L1_CRITICAL_UNSUPPORTED_CLAIMS",
    "attentionQueueCount": "L1_INCIDENT_PAGE_DRILLDOWN",
    "attentionQueueRankedState": "L1_INCIDENT_PAGE_DRILLDOWN",
    "topAttentionPriority": "L1_INCIDENT_PAGE_DRILLDOWN",
    "topAttentionReason": "L1_INCIDENT_PAGE_DRILLDOWN",
    "topAttentionResolvingControl": "L1_INCIDENT_PAGE_DRILLDOWN",
    "dashboardCorrelationChainId": "L5_TIMELINE_CORRELATION_TRACE",
    "traceTargetCount": "L5_TIMELINE_CORRELATION_TRACE",
    "strategyStatus": "L1_OVERALL_POSTURE_REASON",
    "qStatus": "L1_OVERALL_POSTURE_REASON",
    "recentMaterialDecisionCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "recentMaterialDecisionSummary": "L4_EVIDENCE_TO_PNL_CHAIN",
    "executionOwner": "L1_EXECUTION_OWNER_FENCING",
    "executionFencingEpoch": "L1_EXECUTION_OWNER_FENCING",
  }),
  "PANEL_CONTROL_ROOM_TRUTH_V1": Object.freeze({
    "desiredState": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "observedState": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "readiness": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "liveness": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "heartbeatAgeMs": "L1_SOURCE_AGE_COHERENCE",
    "restartCount": "L3_PROGRESS_CADENCE_COOLDOWN_ATTEMPTS",
    "currentError": "L2_BLOCKED_DEGRADED_EDGES",
    "renderTruthLabel": "L1_TRUTH_MODE_LABEL",
    "dependencyState": "L2_STARTUP_RUNTIME_DEPENDENCIES",
    "bootTimelineState": "L5_TIMELINE_CORRELATION_TRACE",
    "configHistoryState": "L5_DEPLOYMENT_AGENT_PROVENANCE",
    "controlAvailabilityState": "L1_CRITICAL_UNSUPPORTED_CLAIMS",
    "correlationTraceId": "L5_TIMELINE_CORRELATION_TRACE",
    "repairProposalApprovalState": "L5_REPAIR_PROPOSALS_APPROVALS",
  }),
  "CONTROL_KILL_SWITCH_V1": Object.freeze({
    "killSwitchState": "L1_EXECUTION_OWNER_FENCING",
    "killSwitchEffect": "L1_EXECUTION_OWNER_FENCING",
    "controlProofState": "L3_ROLLBACK_FALLBACK_READINESS",
    "controlOwner": "L1_EXECUTION_OWNER_FENCING",
    "boundsState": "L3_ROLLBACK_FALLBACK_READINESS",
    "previewState": "L3_ROLLBACK_FALLBACK_READINESS",
  }),
  "CONTROL_SAFE_MODE_V1": Object.freeze({
    "currentSafeMode": "L1_TRUTH_MODE_LABEL",
    "requestedSafeMode": "L1_TRUTH_MODE_LABEL",
    "controlOwner": "L1_EXECUTION_OWNER_FENCING",
    "maximumEffect": "L1_EXECUTION_OWNER_FENCING",
    "boundsState": "L3_ROLLBACK_FALLBACK_READINESS",
    "previewState": "L3_ROLLBACK_FALLBACK_READINESS",
  }),
  "CONTROL_INTAKE_PAUSE_V1": Object.freeze({
    "currentIntakePauseState": "L1_TRUTH_MODE_LABEL",
    "requestedIntakePauseState": "L1_TRUTH_MODE_LABEL",
    "controlOwner": "L1_EXECUTION_OWNER_FENCING",
    "maximumEffect": "L1_EXECUTION_OWNER_FENCING",
    "boundsState": "L3_ROLLBACK_FALLBACK_READINESS",
    "previewState": "L3_ROLLBACK_FALLBACK_READINESS",
  }),
  "CONTROL_COMPONENT_DESIRED_STATE_V1": Object.freeze({
    "targetComponentId": "L2_COMPONENT_IDENTITY_DENOMINATOR_COUNTS",
    "currentComponentDesiredState": "L1_TRUTH_MODE_LABEL",
    "requestedComponentDesiredState": "L1_TRUTH_MODE_LABEL",
    "controlOwner": "L1_EXECUTION_OWNER_FENCING",
    "maximumEffect": "L1_EXECUTION_OWNER_FENCING",
    "boundsState": "L3_ROLLBACK_FALLBACK_READINESS",
    "previewState": "L3_ROLLBACK_FALLBACK_READINESS",
  }),
  "CONTROL_APPROVAL_REVOKE_V1": Object.freeze({
    "approvalId": "L5_BOUNDED_EVIDENCE_IMMUTABLE_REFS",
    "currentApprovalState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "requestedApprovalState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "controlOwner": "L1_EXECUTION_OWNER_FENCING",
    "maximumEffect": "L1_EXECUTION_OWNER_FENCING",
    "boundsState": "L3_ROLLBACK_FALLBACK_READINESS",
    "previewState": "L3_ROLLBACK_FALLBACK_READINESS",
  }),
  "CONTROL_BOUNDED_CONFIG_REVISION_V1": Object.freeze({
    "requestedConfigurationRevision": "L5_DEPLOYMENT_AGENT_PROVENANCE",
    "requestedPayloadDigest": "L5_BOUNDED_EVIDENCE_IMMUTABLE_REFS",
    "boundedConfigValidationState": "L3_ROLLBACK_FALLBACK_READINESS",
    "controlOwner": "L1_EXECUTION_OWNER_FENCING",
    "maximumEffect": "L1_EXECUTION_OWNER_FENCING",
    "boundsState": "L3_ROLLBACK_FALLBACK_READINESS",
    "previewState": "L3_ROLLBACK_FALLBACK_READINESS",
  }),
  "PANEL_ACCOUNT_TRUTH_V1": Object.freeze({
    "accountTruthState": "L1_TRUTH_MODE_LABEL",
    "equity": "L4_PREDICTED_REALIZED_ECONOMICS",
    "availableCapital": "L4_PREDICTED_REALIZED_ECONOMICS",
    "openOrdersCount": "L1_EXPOSURE_UNRESOLVED_LIABILITY",
    "openPositionsCount": "L1_EXPOSURE_UNRESOLVED_LIABILITY",
    "liabilitiesTotal": "L1_EXPOSURE_UNRESOLVED_LIABILITY",
    "reconciliationState": "L4_EVIDENCE_TO_PNL_CHAIN",
  }),
  "PANEL_MARKETS_TRUTH_V1": Object.freeze({
    "universeCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "candidateCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "focusCount": "L4_EVIDENCE_TO_PNL_CHAIN",
    "sourceFreshness": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "sourceCompleteness": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "qAssessmentState": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
  }),
  "PANEL_TOKEN_TRUTH_V1": Object.freeze({
    "timelineState": "L5_TIMELINE_CORRELATION_TRACE",
    "firstChangedEvidence": "L5_BOUNDED_EVIDENCE_IMMUTABLE_REFS",
    "evidenceChronologyState": "L5_TIMELINE_CORRELATION_TRACE",
    "modelUncertainty": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "basisDecisionState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "volumeDecisionState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "outcomeState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "correlationTraceId": "L5_TIMELINE_CORRELATION_TRACE",
  }),
  "PANEL_BASIS_TRUTH_V1": Object.freeze({
    "basisDecisionState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "directionalCase": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "executableNetEconomics": "L4_PREDICTED_REALIZED_ECONOMICS",
    "gapPersistence": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "fundingContext": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "depthSlippage": "L4_PREDICTED_REALIZED_ECONOMICS",
    "borrowFeasibility": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "proposalDisposition": "L4_EVIDENCE_TO_PNL_CHAIN",
    "lifecycleState": "L4_EVIDENCE_TO_PNL_CHAIN",
  }),
  "PANEL_VOLUME_TRUTH_V1": Object.freeze({
    "volumeDecisionState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "quietBaselineState": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "transitionStage": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "anomalyEvidence": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "followThroughEvidence": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "leadershipState": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "liquidityCrowdingState": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "modelUncertainty": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "proposalDisposition": "L4_EVIDENCE_TO_PNL_CHAIN",
    "outcomeState": "L4_EVIDENCE_TO_PNL_CHAIN",
  }),
  "PANEL_OPPORTUNITIES_TRUTH_V1": Object.freeze({
    "opportunityDisposition": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "sourceRevision": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "evidenceMissingness": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "modelAssessment": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "netEconomics": "L4_PREDICTED_REALIZED_ECONOMICS",
    "capitalVerdict": "L4_PREDICTED_REALIZED_ECONOMICS",
    "riskVerdict": "L4_PREDICTED_REALIZED_ECONOMICS",
    "sizeStaging": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "expiryInvalidation": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "rejectionReason": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
  }),
  "PANEL_BORROW_TRUTH_V1": Object.freeze({
    "borrowTruthState": "L1_TRUTH_MODE_LABEL",
    "assetAvailability": "L1_EXPOSURE_UNRESOLVED_LIABILITY",
    "maximumBorrowable": "L1_EXPOSURE_UNRESOLVED_LIABILITY",
    "interestRate": "L4_PREDICTED_REALIZED_ECONOMICS",
    "collateralMode": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "principalLiability": "L1_EXPOSURE_UNRESOLVED_LIABILITY",
    "accruedInterest": "L4_PREDICTED_REALIZED_ECONOMICS",
    "repayStatus": "L4_EVIDENCE_TO_PNL_CHAIN",
    "ticketLinkage": "L4_EVIDENCE_TO_PNL_CHAIN",
  }),
  "PANEL_EXECUTION_TRUTH_V1": Object.freeze({
    "executionLifecycleState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "ticketState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "legState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "requestedQuantity": "L4_EVIDENCE_TO_PNL_CHAIN",
    "acknowledgedQuantity": "L4_EVIDENCE_TO_PNL_CHAIN",
    "filledQuantity": "L4_EVIDENCE_TO_PNL_CHAIN",
    "ambiguityState": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "fencingTokenState": "L1_EXECUTION_OWNER_FENCING",
    "reconciliationState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "recoveryState": "L3_ROLLBACK_FALLBACK_READINESS",
    "deadlineState": "L3_DEADLINE_LEASE_CANCELLATION_LATE_RESULT",
    "correlationTraceId": "L5_TIMELINE_CORRELATION_TRACE",
  }),
  "PANEL_ORDERS_TRUTH_V1": Object.freeze({
    "orderLifecycleState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "orderIdentity": "L5_BOUNDED_EVIDENCE_IMMUTABLE_REFS",
    "requestedQuantity": "L4_EVIDENCE_TO_PNL_CHAIN",
    "acknowledgedQuantity": "L4_EVIDENCE_TO_PNL_CHAIN",
    "filledQuantity": "L4_EVIDENCE_TO_PNL_CHAIN",
    "ambiguityState": "L4_AMBIGUITY_ABSTENTION_VERSIONING",
    "reconciliationState": "L4_EVIDENCE_TO_PNL_CHAIN",
  }),
  "PANEL_POSITIONS_TRUTH_V1": Object.freeze({
    "positionLifecycleState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "exposureState": "L1_EXPOSURE_UNRESOLVED_LIABILITY",
    "exitCapacity": "L1_SCENARIO_BOUNDED_RECOVERABILITY",
    "fundingBorrowState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "positionRecoveryState": "L5_CORRECTIVE_ACTIONS",
    "correlationTraceId": "L5_TIMELINE_CORRELATION_TRACE",
  }),
  "PANEL_FILLS_TRUTH_V1": Object.freeze({
    "fillLifecycleState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "fillIdentity": "L5_BOUNDED_EVIDENCE_IMMUTABLE_REFS",
    "filledQuantity": "L4_EVIDENCE_TO_PNL_CHAIN",
    "fee": "L4_PREDICTED_REALIZED_ECONOMICS",
    "slippage": "L4_PREDICTED_REALIZED_ECONOMICS",
    "correlationTraceId": "L5_TIMELINE_CORRELATION_TRACE",
  }),
  "PANEL_PNL_TRUTH_V1": Object.freeze({
    "pnlAttributionState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "realizedPnl": "L4_PREDICTED_REALIZED_ECONOMICS",
    "feeAttribution": "L4_PREDICTED_REALIZED_ECONOMICS",
    "fundingAttribution": "L4_PREDICTED_REALIZED_ECONOMICS",
    "slippageAttribution": "L4_PREDICTED_REALIZED_ECONOMICS",
    "unresolvedError": "L1_CRITICAL_UNSUPPORTED_CLAIMS",
    "rootBlocker": "L1_OVERALL_POSTURE_REASON",
    "pnlEvidenceRef": "L5_BOUNDED_EVIDENCE_IMMUTABLE_REFS",
  }),
  "PANEL_RISK_TRUTH_V1": Object.freeze({
    "riskGateState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "envelopeState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "utilizationState": "L4_PREDICTED_REALIZED_ECONOMICS",
    "blockerReasons": "L1_OVERALL_POSTURE_REASON",
    "haltState": "L1_OVERALL_POSTURE_REASON",
    "reservationState": "L4_EVIDENCE_TO_PNL_CHAIN",
    "recoveryReadiness": "L3_ROLLBACK_FALLBACK_READINESS",
    "correlationTraceId": "L5_TIMELINE_CORRELATION_TRACE",
  }),
  "PANEL_HEALTH_TRUTH_V1": Object.freeze({
    "desiredState": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "observedState": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "readiness": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "liveness": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "heartbeatAgeMs": "L1_SOURCE_AGE_COHERENCE",
    "restartCount": "L3_PROGRESS_CADENCE_COOLDOWN_ATTEMPTS",
    "currentError": "L2_BLOCKED_DEGRADED_EDGES",
    "renderTruthLabel": "L1_TRUTH_MODE_LABEL",
    "sloState": "L3_SLO_ERROR_BUDGET_TRENDS",
    "resourcePressureState": "L3_SLO_ERROR_BUDGET_TRENDS",
    "backpressureState": "L3_SLO_ERROR_BUDGET_TRENDS",
    "watchdogProofState": "L3_SENTINEL_PAGING_RECEIPTS",
    "releaseState": "L5_DEPLOYMENT_AGENT_PROVENANCE",
    "failureAtlasEvidenceRef": "L5_COUNTEREXAMPLE_FAILURE_ATLAS",
    "deploymentAgentProvenanceRef": "L5_DEPLOYMENT_AGENT_PROVENANCE",
  }),
  "PANEL_LOGS_LEDGER_TRUTH_V1": Object.freeze({
    "traceState": "L5_TIMELINE_CORRELATION_TRACE",
    "correlationId": "L5_TIMELINE_CORRELATION_TRACE",
    "structuredEventCount": "L5_BOUNDED_EVIDENCE_IMMUTABLE_REFS",
    "ledgerEvidenceRef": "L5_BOUNDED_EVIDENCE_IMMUTABLE_REFS",
    "retentionState": "L5_BOUNDED_EVIDENCE_IMMUTABLE_REFS",
    "redactionState": "L5_BOUNDED_EVIDENCE_IMMUTABLE_REFS",
    "assumptionClaimCausalityRefs": "L5_ASSUMPTION_CLAIM_CAUSALITY",
    "deploymentAgentProvenanceRef": "L5_DEPLOYMENT_AGENT_PROVENANCE",
  }),
  "PANEL_NOTIFICATIONS_TRUTH_V1": Object.freeze({
    "incidentState": "L1_INCIDENT_PAGE_DRILLDOWN",
    "rootCauseId": "L5_ASSUMPTION_CLAIM_CAUSALITY",
    "deduplicationKey": "L5_ASSUMPTION_CLAIM_CAUSALITY",
    "recoveryProofRef": "L5_CORRECTIVE_ACTIONS",
    "actionRequired": "L1_INCIDENT_PAGE_DRILLDOWN",
    "pagingReceiptState": "L3_SENTINEL_PAGING_RECEIPTS",
    "repairProposalApprovalState": "L5_REPAIR_PROPOSALS_APPROVALS",
  }),
  "PANEL_HEALTH_OUT_OF_BAND_LIVENESS_V1": Object.freeze({
    "desiredState": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "observedState": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "readiness": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "liveness": "L2_EXPECTED_DISCOVERED_INSTRUMENTED_POSTURE",
    "heartbeatAgeMs": "L1_SOURCE_AGE_COHERENCE",
    "restartCount": "L3_PROGRESS_CADENCE_COOLDOWN_ATTEMPTS",
    "currentError": "L2_BLOCKED_DEGRADED_EDGES",
    "renderTruthLabel": "L1_TRUTH_MODE_LABEL",
    "watchdogProofState": "L3_SENTINEL_PAGING_RECEIPTS",
    "correlationTraceId": "L5_TIMELINE_CORRELATION_TRACE",
  }),
});

const TOPIC_LEVELS = new Map(INFORMATION_LEVEL_DEFINITIONS.flatMap((definition) => (
  definition.topics.map((topic) => [topic.topicId, definition.level])
)));

const NON_NEGATIVE_DECIMAL_PATTERN = '^(?:0|[1-9][0-9]*)(?:\\.[0-9]*[1-9])?$';
const SIGNED_DECIMAL_PATTERN = '^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]*[1-9])?$';

function immutableValueLaw(valueKind, unit, enumValues = null, valueConstraints = null) {
  const canonicalKind = valueKind === 'ENUM_SET'
    ? 'ENUM_SET'
    : enumValues !== null
    ? 'ENUM'
    : ({
      STRING: 'TEXT',
      INTEGER: unit === 'UTC_MILLISECONDS' ? 'UTC_MILLISECONDS' : 'NON_NEGATIVE_INTEGER',
      NUMBER: 'FINITE_NUMBER',
      NON_NEGATIVE_DECIMAL_STRING: 'NON_NEGATIVE_DECIMAL_STRING',
      SIGNED_DECIMAL_STRING: 'SIGNED_DECIMAL_STRING',
      BOOLEAN: 'BOOLEAN',
      IDENTITY_SET: 'IDENTITY_SET',
      ENUM_SET: 'ENUM_SET',
      PACKET_REASON_CODE_SET: 'PACKET_REASON_CODE_SET',
      DOMAIN_REASON_CODE: 'DOMAIN_REASON_CODE',
      DOMAIN_REASON_CODE_SET: 'DOMAIN_REASON_CODE_SET',
    })[valueKind];
  return Object.freeze({
    valueKind: canonicalKind,
    unit,
    enumValues: enumValues === null ? null : Object.freeze([...enumValues].sort()),
    valueConstraints: valueConstraints === null ? null : Object.freeze({ ...valueConstraints }),
  });
}

function nonNegativeDecimalLaw(unit, extraConstraints = {}) {
  return immutableValueLaw('NON_NEGATIVE_DECIMAL_STRING', unit, null, {
    canonicalPattern: NON_NEGATIVE_DECIMAL_PATTERN,
    maximumTotalDigits: 96,
    signPolicy: 'NON_NEGATIVE',
    ...extraConstraints,
  });
}

function signedDecimalLaw(unit, extraConstraints = {}) {
  return immutableValueLaw('SIGNED_DECIMAL_STRING', unit, null, {
    canonicalPattern: SIGNED_DECIMAL_PATTERN,
    maximumTotalDigits: 96,
    signPolicy: 'SIGNED_NEGATIVE_ZERO_FORBIDDEN',
    ...extraConstraints,
  });
}

function boundedNumberLaw(unit, minimum, maximum) {
  return immutableValueLaw('NUMBER', unit, null, {
    minimum,
    maximum,
    finite: true,
  });
}

const COMPONENT_STATE_VALUES = Object.freeze(['RUNNING', 'STOPPED', 'DEGRADED', 'BLOCKED', 'UNKNOWN']);
const READINESS_VALUE_ENUM = Object.freeze(['READY', 'WARMING', 'STOPPED', 'DEGRADED', 'BLOCKED', 'FAILED']);
const LIVENESS_VALUE_ENUM = Object.freeze(['LIVE', 'SILENT', 'DEAD', 'UNKNOWN']);
const RENDER_TRUTH_VALUE_ENUM = Object.freeze([
  'LIVE', 'SHADOW', 'VALIDATE_ONLY', 'DRY_RUN', 'SYNTHETIC', 'BLOCKED',
  'NOT_CONFIGURED', 'MISSING', 'UNKNOWN', 'UNAVAILABLE',
]);
const MODE_VALUE_ENUM = Object.freeze(['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY']);
const SOURCE_CONNECTION_VALUE_ENUM = Object.freeze([
  'CONNECTED', 'CONNECTING', 'BACKING_OFF', 'RATE_LIMITED', 'DISCONNECTED',
  'NOT_CONFIGURED', 'MISSING', 'UNKNOWN',
]);

export const COMPONENT_FACT_CATALOG_ID = 'SYSTEM_COMPONENT_IDS_V1';
export const COMPONENT_FACT_CATALOG = Object.freeze([
  Object.freeze({ componentId: 'public-spot-source', ownerId: 'INTELLIGENCE_RUNTIME', expectedManifestItemId: 'component:public-spot-source' }),
  Object.freeze({ componentId: 'public-usdm-source', ownerId: 'INTELLIGENCE_RUNTIME', expectedManifestItemId: 'component:public-usdm-source' }),
  Object.freeze({ componentId: 'market-universe', ownerId: 'AUDITED_APP', expectedManifestItemId: 'component:market-universe' }),
  Object.freeze({ componentId: 'intelligence-runtime', ownerId: 'INTELLIGENCE_RUNTIME', expectedManifestItemId: 'component:intelligence-runtime' }),
  Object.freeze({ componentId: 'market-intelligence', ownerId: 'MARKET_INTELLIGENCE', expectedManifestItemId: 'component:market-intelligence' }),
  Object.freeze({ componentId: 'basis-engine', ownerId: 'BASIS_ENGINE', expectedManifestItemId: 'component:basis-engine' }),
  Object.freeze({ componentId: 'volume-engine', ownerId: 'VOLUME_ENGINE', expectedManifestItemId: 'component:volume-engine' }),
  Object.freeze({ componentId: 'capital-supervision', ownerId: 'CAPITAL_SUPERVISION', expectedManifestItemId: 'component:capital-supervision' }),
  Object.freeze({ componentId: 'multileg-risk', ownerId: 'BACKEND_FOUNDATION_RISK', expectedManifestItemId: 'component:multileg-risk' }),
  Object.freeze({ componentId: 'execution-coordinator-validate-only', ownerId: 'BACKEND_FOUNDATION_EXECUTION', expectedManifestItemId: 'component:execution-coordinator-validate-only' }),
  Object.freeze({ componentId: 'reconciliation', ownerId: 'BACKEND_FOUNDATION_RECONCILIATION', expectedManifestItemId: 'component:reconciliation' }),
  Object.freeze({ componentId: 'ledger-persistence', ownerId: 'EXISTING_LEDGER', expectedManifestItemId: 'component:ledger-persistence' }),
  Object.freeze({ componentId: 'engine-supervisor', ownerId: 'SYSTEM_INTEGRATION', expectedManifestItemId: 'component:engine-supervisor' }),
]);
export const COMPONENT_FACT_IDS = Object.freeze(COMPONENT_FACT_CATALOG.map((entry) => entry.componentId));
export const SOURCE_ROW_CATALOG_ID = 'SOURCE_AGGREGATION_IDS_V1';
export const SEMANTIC_SOURCE_STREAM_CATALOG_ID = 'SYSTEM_SEMANTIC_STREAMS_V1';
export const SEMANTIC_SOURCE_STREAM_IDS = Object.freeze([
  'MARKET_UNIVERSE', 'SPOT_MINI_TICKER', 'SPOT_AGGREGATE_TRADE',
  'SPOT_BEST_BID_ASK', 'USD_M_BEST_BID_ASK', 'USD_M_MARK_FUNDING',
  'USD_M_LIQUIDATION',
]);
export const SOURCE_ROW_CATALOG = Object.freeze([
  Object.freeze({
    sourceAggregationId: 'spot-mini-ticker-universe',
    ownerId: 'INTELLIGENCE_RUNTIME',
    coveredExpectedManifestItemIds: Object.freeze(['source:MARKET_UNIVERSE', 'source:SPOT_MINI_TICKER']),
    physicalProducerIds: Object.freeze(['MarketEngine']),
    componentIds: Object.freeze(['public-spot-source', 'market-universe']),
  }),
  Object.freeze({
    sourceAggregationId: 'spot-aggregate-trades',
    ownerId: 'INTELLIGENCE_RUNTIME',
    coveredExpectedManifestItemIds: Object.freeze(['source:SPOT_AGGREGATE_TRADE']),
    physicalProducerIds: Object.freeze(['VolumeRuntime']),
    componentIds: Object.freeze(['public-spot-source', 'volume-engine']),
  }),
  Object.freeze({
    sourceAggregationId: 'spot-perpetual-bbo',
    ownerId: 'INTELLIGENCE_RUNTIME',
    coveredExpectedManifestItemIds: Object.freeze(['source:SPOT_BEST_BID_ASK', 'source:USD_M_BEST_BID_ASK']),
    physicalProducerIds: Object.freeze(['BasisRuntime']),
    componentIds: Object.freeze(['public-spot-source', 'public-usdm-source', 'basis-engine']),
  }),
  Object.freeze({
    sourceAggregationId: 'usdm-mark-funding-liquidation',
    ownerId: 'INTELLIGENCE_RUNTIME',
    coveredExpectedManifestItemIds: Object.freeze(['source:USD_M_MARK_FUNDING', 'source:USD_M_LIQUIDATION']),
    physicalProducerIds: Object.freeze(['MarketEngine']),
    componentIds: Object.freeze(['public-usdm-source', 'market-universe']),
  }),
]);

const VALUE_SEMANTIC_OVERRIDES = Object.freeze({
  actionRequired: immutableValueLaw('BOOLEAN', 'BOOLEAN'),
  approvalState: immutableValueLaw('STRING', 'STATE', ['APPROVED', 'PENDING', 'REVOKED', 'EXPIRED', 'NOT_REQUIRED', 'UNKNOWN']),
  approvalId: immutableValueLaw('STRING', 'IDENTITY'),
  attentionQueueRankedState: immutableValueLaw('STRING', 'STATE', ['RANKED', 'EMPTY', 'UNAVAILABLE', 'UNKNOWN']),
  availableCapital: nonNegativeDecimalLaw('USD'),
  boundedConfigValidationState: immutableValueLaw('STRING', 'STATE', ['WITHIN_BOUNDS', 'OUT_OF_BOUNDS', 'UNKNOWN']),
  boundsState: immutableValueLaw('STRING', 'STATE', ['BOUNDED', 'UNBOUNDED', 'UNKNOWN']),
  capitalCeiling: nonNegativeDecimalLaw('USD'),
  dashboardCorrelationChainId: immutableValueLaw('STRING', 'CORRELATION_ID'),
  dataSourceConnectionStates: immutableValueLaw('ENUM_SET', 'STATE_SET', SOURCE_CONNECTION_VALUE_ENUM),
  deployedRevision: immutableValueLaw('STRING', 'GIT_SHA'),
  degradedSourceIdentities: immutableValueLaw('IDENTITY_SET', 'IDENTITY_SET'),
  degradedSourceReasons: immutableValueLaw('DOMAIN_REASON_CODE_SET', 'REASON_CODE_SET'),
  desiredMode: immutableValueLaw('STRING', 'STATE', MODE_VALUE_ENUM),
  desiredState: immutableValueLaw('STRING', 'STATE', COMPONENT_STATE_VALUES),
  drawdown: boundedNumberLaw('RATIO', 0, 1),
  effectiveMode: immutableValueLaw('STRING', 'STATE', MODE_VALUE_ENUM),
  equity: nonNegativeDecimalLaw('USD'),
  executableNetEconomics: signedDecimalLaw('USD'),
  executionFencingEpoch: immutableValueLaw('INTEGER', 'EPOCH'),
  executionOwner: immutableValueLaw('STRING', 'IDENTITY'),
  fee: nonNegativeDecimalLaw('USD'),
  feeAttribution: signedDecimalLaw('USD'),
  fundingAttribution: signedDecimalLaw('USD'),
  heartbeatAgeMs: immutableValueLaw('INTEGER', 'MILLISECONDS'),
  interestRate: nonNegativeDecimalLaw('RATIO'),
  killSwitchEffect: immutableValueLaw('STRING', 'STATE', ['BLOCKS_ADVISORY_PROGRESSION_NO_MONEY_MUTATION', 'NO_EFFECT', 'UNKNOWN']),
  killSwitchState: immutableValueLaw('STRING', 'STATE', ['DISENGAGED', 'ENGAGED', 'UNKNOWN']),
  lastRestart: immutableValueLaw('INTEGER', 'UTC_MILLISECONDS'),
  lastRestartResult: immutableValueLaw('STRING', 'STATE', ['SUCCESS', 'FAILED', 'IN_PROGRESS', 'NOT_ATTEMPTED', 'UNKNOWN']),
  latestRiskVerdict: immutableValueLaw('STRING', 'STATE', ['ALLOW', 'BLOCK', 'ABSTAIN', 'UNKNOWN']),
  liabilitiesTotal: nonNegativeDecimalLaw('USD'),
  liveExecutionBarrier: immutableValueLaw('STRING', 'BARRIER_CODE', ['LIVE_EXECUTION_NOT_IMPLEMENTED']),
  liveness: immutableValueLaw('STRING', 'STATE', LIVENESS_VALUE_ENUM),
  maximumBorrowable: nonNegativeDecimalLaw('QUANTITY'),
  mode: immutableValueLaw('STRING', 'STATE', MODE_VALUE_ENUM),
  currentSafeMode: immutableValueLaw('STRING', 'STATE', MODE_VALUE_ENUM),
  requestedSafeMode: immutableValueLaw('STRING', 'STATE', MODE_VALUE_ENUM),
  currentIntakePauseState: immutableValueLaw('STRING', 'STATE', ['RUNNING', 'PAUSED', 'UNKNOWN']),
  requestedIntakePauseState: immutableValueLaw('STRING', 'STATE', ['RUNNING', 'PAUSED']),
  currentComponentDesiredState: immutableValueLaw('STRING', 'STATE', ['STOPPED', 'RUNNING', 'PAUSED', 'UNKNOWN']),
  requestedComponentDesiredState: immutableValueLaw('STRING', 'STATE', ['STOPPED', 'RUNNING', 'PAUSED']),
  currentApprovalState: immutableValueLaw('STRING', 'STATE', ['APPROVED', 'PENDING', 'REVOKED', 'EXPIRED', 'UNKNOWN']),
  requestedApprovalState: immutableValueLaw('STRING', 'STATE', ['REVOKED']),
  targetComponentId: immutableValueLaw('STRING', 'IDENTITY', COMPONENT_FACT_IDS),
  controlOwner: immutableValueLaw('STRING', 'IDENTITY'),
  maximumEffect: immutableValueLaw('STRING', 'EFFECT_DESCRIPTION'),
  previewState: immutableValueLaw('STRING', 'STATE', ['UNAVAILABLE', 'READY_FOR_CONFIRMATION', 'BLOCKED', 'UNKNOWN']),
  requestedConfigurationRevision: immutableValueLaw('STRING', 'REVISION_ID'),
  requestedPayloadDigest: immutableValueLaw('STRING', 'SHA256'),
  rootBlocker: immutableValueLaw('STRING', 'IDENTITY', COMPONENT_FACT_IDS, { knownAbsenceAllowed: true }),
  modelUncertainty: boundedNumberLaw('RATIO', 0, 1),
  netEconomics: signedDecimalLaw('USD'),
  newestCandidateDisposition: immutableValueLaw('STRING', 'STATE', ['ACCEPTED', 'REJECTED', 'ABSTAINED', 'UNKNOWN']),
  newestCandidateId: immutableValueLaw('STRING', 'IDENTITY'),
  newestCandidateSymbol: immutableValueLaw('STRING', 'SYMBOL'),
  newestCandidateEvidenceRevision: immutableValueLaw('STRING', 'REVISION_ID'),
  observedState: immutableValueLaw('STRING', 'STATE', COMPONENT_STATE_VALUES),
  overallPosture: immutableValueLaw('STRING', 'STATE', ['READY', 'DEGRADED', 'BLOCKED', 'UNKNOWN']),
  principalLiability: nonNegativeDecimalLaw('USD'),
  qDatasetVersion: immutableValueLaw('STRING', 'VERSION'),
  qHealthState: immutableValueLaw('STRING', 'STATE', ['READY', 'DEGRADED', 'BLOCKED', 'UNKNOWN']),
  qLatestAssessmentAction: immutableValueLaw('STRING', 'STATE', ['WATCH', 'FOCUS', 'PROPOSE_CONSIDERATION', 'ABSTAIN_UNKNOWN']),
  qModelVersion: immutableValueLaw('STRING', 'VERSION'),
  qStatus: immutableValueLaw('STRING', 'STATE', ['READY', 'DEGRADED', 'BLOCKED', 'UNKNOWN']),
  readiness: immutableValueLaw('STRING', 'STATE', READINESS_VALUE_ENUM),
  realizedPnl: signedDecimalLaw('USD'),
  renderTruthLabel: immutableValueLaw('STRING', 'STATE', RENDER_TRUTH_VALUE_ENUM),
  requestedQuantity: nonNegativeDecimalLaw('QUANTITY'),
  acknowledgedQuantity: nonNegativeDecimalLaw('QUANTITY'),
  filledQuantity: nonNegativeDecimalLaw('QUANTITY'),
  slippage: signedDecimalLaw('BPS', { minimum: '-1000000', maximum: '1000000' }),
  slippageAttribution: signedDecimalLaw('USD'),
  sourceRevision: immutableValueLaw('STRING', 'REVISION_ID'),
  startupGeneration: immutableValueLaw('INTEGER', 'GENERATION'),
  strategyStatus: immutableValueLaw('STRING', 'STATE', ['READY', 'DEGRADED', 'BLOCKED', 'UNKNOWN']),
  testedRevision: immutableValueLaw('STRING', 'GIT_SHA'),
  topAttentionPriority: immutableValueLaw('STRING', 'PRIORITY', ['P0', 'P1', 'P2', 'P3'], { knownAbsenceAllowed: true }),
  topAttentionResolvingControl: immutableValueLaw('STRING', 'CONTROL_ID', [
    'CONTROL_APPROVAL_REVOKE_V1',
    'CONTROL_BOUNDED_CONFIG_REVISION_V1',
    'CONTROL_COMPONENT_DESIRED_STATE_V1',
    'CONTROL_INTAKE_PAUSE_V1',
    'CONTROL_KILL_SWITCH_V1',
    'CONTROL_SAFE_MODE_V1',
  ], { knownAbsenceAllowed: true }),
});

const MONETARY_VALUE_KEYS = new Set(['accruedInterest']);
const REASON_CODE_VALUE_KEYS = new Set([
  'basisLatestRejectReasonCode', 'currentError', 'unresolvedError',
  'volumeLatestRejectReasonCode',
]);
const REASON_CODE_SET_VALUE_KEYS = new Set([
  'blockerReasons', 'latestRiskBlockCodes',
  'newestCandidateDispositionReason', 'qLatestAbstentionReason', 'rejectionReason',
  'topAttentionReason',
]);
const CORRELATION_VALUE_KEYS = new Set(['correlationId', 'correlationTraceId']);
const IDENTITY_VALUE_KEYS = new Set([
  'deduplicationKey', 'fillIdentity', 'orderIdentity', 'rootCauseId',
]);
const VERSION_VALUE_KEYS = new Set(['qModelVersion', 'qDatasetVersion']);

function valueSemanticForKey(valueKey) {
  if (VALUE_SEMANTIC_OVERRIDES[valueKey]) return VALUE_SEMANTIC_OVERRIDES[valueKey];
  if (MONETARY_VALUE_KEYS.has(valueKey)) return nonNegativeDecimalLaw('USD');
  if (valueKey.endsWith('Count')) return immutableValueLaw('INTEGER', 'COUNT');
  if (valueKey.endsWith('AgeMs')) return immutableValueLaw('INTEGER', 'MILLISECONDS');
  if (valueKey.endsWith('AtMs')) return immutableValueLaw('INTEGER', 'UTC_MILLISECONDS');
  if (valueKey.endsWith('Quantity')) return nonNegativeDecimalLaw('QUANTITY');
  if (valueKey.endsWith('Refs')) return immutableValueLaw('STRING', 'REFERENCE_SET');
  if (valueKey.endsWith('Ref')) return immutableValueLaw('STRING', 'REFERENCE');
  if (valueKey.endsWith('Identities')) return immutableValueLaw('STRING', 'IDENTITY_SET');
  if (REASON_CODE_SET_VALUE_KEYS.has(valueKey) || valueKey.endsWith('Reasons') || valueKey.endsWith('BlockCodes')) {
    return immutableValueLaw('DOMAIN_REASON_CODE_SET', 'REASON_CODE_SET');
  }
  if (REASON_CODE_VALUE_KEYS.has(valueKey)) return immutableValueLaw('DOMAIN_REASON_CODE', 'REASON_CODE');
  if (CORRELATION_VALUE_KEYS.has(valueKey)) return immutableValueLaw('STRING', 'CORRELATION_ID');
  if (IDENTITY_VALUE_KEYS.has(valueKey)) return immutableValueLaw('STRING', 'IDENTITY');
  if (VERSION_VALUE_KEYS.has(valueKey)) return immutableValueLaw('STRING', 'VERSION');
  if (valueKey === 'executionOwner') return immutableValueLaw('STRING', 'IDENTITY');
  if (valueKey === 'ticketLinkage') return immutableValueLaw('STRING', 'REFERENCE');
  return immutableValueLaw('STRING', 'STATE');
}

const ENGINE_REJECT_CODES_V0 = Object.freeze([
  'account_not_connected', 'baseline_missing', 'book_missing', 'borrow_cost_too_high',
  'borrow_required', 'borrow_too_small', 'borrow_unavailable', 'borrow_unknown',
  'data_stale', 'depth_too_thin', 'edge_below_fees', 'edge_below_threshold',
  'funding_against_trade', 'gap_not_persistent', 'kill_switch_on',
  'move_already_extended', 'one_print_spike', 'perp_missing',
  'price_no_followthrough', 'risk_blocked', 'spot_missing', 'spread_too_wide',
  'symbol_blocked', 'taker_imbalance_missing', 'trade_count_too_low',
  'volume_not_abnormal',
]);

const RISK_CHECK_CODES_V1 = Object.freeze([
  'KILL_SWITCH', 'APPROVAL_PRESENT', 'APPROVAL_EXPIRY', 'APPROVAL_SCOPE',
  'PROPOSAL_PRESENT', 'PROPOSAL_EXPIRY', 'EVIDENCE_AUTHORITY', 'SPOT_PERP_SKEW',
  'PERMISSION_POSTURE', 'SPOT_INVENTORY', 'MAX_GROSS_NOTIONAL',
  'HEDGE_RATIO_TOLERANCE', 'RESIDUAL_DELTA', 'MAX_NAKED_DURATION', 'NET_EDGE',
  'COST_EVIDENCE', 'SPREAD', 'DEPTH', 'SLIPPAGE', 'MARGIN_HEADROOM',
  'LIQUIDATION_DISTANCE', 'BORROW_AVAILABILITY', 'BORROW_AMOUNT', 'BORROW_RATE',
  'BORROW_FRESHNESS', 'DAILY_LOSS_LIMIT', 'DAILY_NOTIONAL_LIMIT',
  'DUPLICATE_ACTIVE_PLAN', 'OPEN_ORDER_LIMIT', 'COOLDOWN',
]);

export const DOMAIN_REASON_VOCABULARY_REGISTRY_ID = 'cockpit-domain-reason-binding-registry.v1';
export const DOMAIN_REASON_VOCABULARY_REGISTRY_REVISION = 1;
export const DOMAIN_REASON_VOCABULARY_REGISTRY_SHA256 = '4ceef88031faac2ddcaac3ed2d49020be46c8091294c47fdaae02a5f4175e5e1';
export const DOMAIN_REASON_VOCABULARIES = Object.freeze([
  Object.freeze({
    vocabularyId: 'BASIS_ENGINE_REJECT_CODE_V0', ownerId: 'BASIS_ENGINE', bindingState: 'MOUNTED',
    revision: 0, sourcePath: 'server/src/engine/v0/types.ts',
    sourceSha256: 'bdb99ede2e5aaf6a01b28c805681aa8ce4594553708e2e6f974f17aac8a1efd0',
    matchKind: 'EXACT', exactCodes: ENGINE_REJECT_CODES_V0, parameterizedPrefixes: Object.freeze([]),
    codePattern: null, maxSetItems: 26, ordering: 'OWNER_ORDER',
  }),
  Object.freeze({
    vocabularyId: 'CANONICAL_OPPORTUNITY_REJECTION_REASON_V1', ownerId: 'FOUNDATION_READ_MODEL', bindingState: 'MOUNTED',
    revision: 1, sourcePath: 'server/src/foundation/contracts/opportunity.ts',
    sourceSha256: 'eaaddb8dd995389f9d8a7ee98c876ed826b0c7dbd2bcaefd88ab7de6e4386905',
    matchKind: 'EXACT', exactCodes: ENGINE_REJECT_CODES_V0, parameterizedPrefixes: Object.freeze([]),
    codePattern: null, maxSetItems: 26, ordering: 'OWNER_ORDER',
  }),
  Object.freeze({
    vocabularyId: 'EDGE_PROTOCOL_V1_ABSTENTION_REASON', ownerId: 'Q_EDGE_PROTOCOL', bindingState: 'UNMOUNTED',
    revision: 1, sourcePath: 'DIRECTOR_MOUNT_REQUIRED', sourceSha256: null,
    matchKind: 'UNMOUNTED', exactCodes: Object.freeze([]), parameterizedPrefixes: Object.freeze([]),
    codePattern: null, maxSetItems: 64, ordering: 'OWNER_ORDER',
  }),
  Object.freeze({
    vocabularyId: 'FOUNDATION_RISK_CHECK_CODE_V1', ownerId: 'BACKEND_FOUNDATION_RISK', bindingState: 'MOUNTED',
    revision: 1, sourcePath: 'server/src/foundation/risk/checks.ts',
    sourceSha256: 'bbecf37e026caf3c60ecad6ebe65d4ce4e6d44e60801322152b5f51126bed1ed',
    matchKind: 'EXACT_AND_PARAMETERIZED', exactCodes: RISK_CHECK_CODES_V1,
    parameterizedPrefixes: Object.freeze(['LEG_EVIDENCE_FRESHNESS_', 'LEG_NOTIONAL_', 'SYMBOL_FILTERS_']),
    codePattern: '^[A-Z][A-Z0-9_]{0,99}$', maxSetItems: 64, ordering: 'CHECK_ORDER',
  }),
  Object.freeze({
    vocabularyId: 'INTELLIGENCE_RUNTIME_SOURCE_REASON_V1', ownerId: 'INTELLIGENCE_RUNTIME', bindingState: 'UNMOUNTED',
    revision: 1, sourcePath: 'DIRECTOR_MOUNT_REQUIRED', sourceSha256: null,
    matchKind: 'UNMOUNTED', exactCodes: Object.freeze([]), parameterizedPrefixes: Object.freeze([]),
    codePattern: null, maxSetItems: 32, ordering: 'CODE_POINT_ASC',
  }),
  Object.freeze({
    vocabularyId: 'STRUCTURED_FAILURE_CODE_V1', ownerId: 'BACKEND_FOUNDATION_CONTROL', bindingState: 'MOUNTED',
    revision: 1, sourcePath: 'server/src/foundation/contracts/failures.ts',
    sourceSha256: 'da8601d20ae96515e90a36cbe54df7bc0dce820c1e3fbcbc7b0d9449e8e70dc2',
    matchKind: 'PATTERN', exactCodes: Object.freeze([]), parameterizedPrefixes: Object.freeze([]),
    codePattern: '^[A-Z][A-Z0-9_]{0,99}$', maxSetItems: 1, ordering: 'SCALAR',
  }),
  Object.freeze({
    vocabularyId: 'SYSTEM_SUPERVISOR_REASON_CODE_V1', ownerId: 'SYSTEM_INTEGRATION', bindingState: 'MOUNTED',
    revision: 1, sourcePath: 'server/src/systemIntegration/supervisor/rootCause.ts',
    sourceSha256: '41e37620c4e6181ec65c43d4dfca5bc7209a4e45288eb5e35a7d4e25baa368de',
    matchKind: 'EXACT', exactCodes: Object.freeze([
      'DEPENDENCY_SNAPSHOT_MISSING', 'OPERATOR_ATTENTION_REQUIRED', 'READINESS_BLOCKED',
      'READINESS_DEGRADED', 'READINESS_FAILED', 'READINESS_READY', 'READINESS_STOPPED',
      'READINESS_WARMING',
    ]), parameterizedPrefixes: Object.freeze([]), codePattern: null, maxSetItems: 64,
    ordering: 'CODE_POINT_ASC',
  }),
  Object.freeze({
    vocabularyId: 'VOLUME_ENGINE_REJECT_CODE_V0', ownerId: 'VOLUME_ENGINE', bindingState: 'MOUNTED',
    revision: 0, sourcePath: 'server/src/engine/v0/types.ts',
    sourceSha256: 'bdb99ede2e5aaf6a01b28c805681aa8ce4594553708e2e6f974f17aac8a1efd0',
    matchKind: 'EXACT', exactCodes: ENGINE_REJECT_CODES_V0, parameterizedPrefixes: Object.freeze([]),
    codePattern: null, maxSetItems: 26, ordering: 'OWNER_ORDER',
  }),
]);

const DOMAIN_REASON_VOCABULARIES_BY_ID = new Map(
  DOMAIN_REASON_VOCABULARIES.map((entry) => [entry.vocabularyId, entry]),
);

function domainReasonVocabularyId(contractId, valueKey) {
  if (valueKey === 'basisLatestRejectReasonCode') return 'BASIS_ENGINE_REJECT_CODE_V0';
  if (valueKey === 'volumeLatestRejectReasonCode') return 'VOLUME_ENGINE_REJECT_CODE_V0';
  if (valueKey === 'qLatestAbstentionReason') return 'EDGE_PROTOCOL_V1_ABSTENTION_REASON';
  if (valueKey === 'latestRiskBlockCodes' || (contractId === 'PANEL_RISK_TRUTH_V1' && valueKey === 'blockerReasons')) {
    return 'FOUNDATION_RISK_CHECK_CODE_V1';
  }
  if (valueKey === 'rejectionReason') return 'CANONICAL_OPPORTUNITY_REJECTION_REASON_V1';
  if (valueKey === 'newestCandidateDispositionReason') return 'CANONICAL_OPPORTUNITY_REJECTION_REASON_V1';
  if (valueKey === 'currentError' || valueKey === 'unresolvedError') return 'STRUCTURED_FAILURE_CODE_V1';
  if (valueKey === 'degradedSourceReasons') return 'INTELLIGENCE_RUNTIME_SOURCE_REASON_V1';
  return 'SYSTEM_SUPERVISOR_REASON_CODE_V1';
}

function domainReasonBindingFor(contractId, valueKey, valueKind) {
  if (!['DOMAIN_REASON_CODE', 'DOMAIN_REASON_CODE_SET'].includes(valueKind)) return null;
  const vocabulary = DOMAIN_REASON_VOCABULARIES_BY_ID.get(domainReasonVocabularyId(contractId, valueKey));
  return Object.freeze({
    ownerId: vocabulary.ownerId,
    vocabularyId: vocabulary.vocabularyId,
    revision: vocabulary.revision,
    sourceSha256: vocabulary.sourceSha256,
    bindingState: vocabulary.bindingState,
    shape: valueKind === 'DOMAIN_REASON_CODE_SET' ? 'SET' : 'SCALAR',
    ordering: vocabulary.ordering,
    emptyLaw: valueKind === 'DOMAIN_REASON_CODE_SET' ? 'EMPTY_ARRAY_IS_KNOWN_EMPTY' : 'NULL_WITHOUT_UNKNOWN_REASON_IS_KNOWN_ABSENT',
  });
}

export const FACT_SEMANTICS_BY_CONTRACT = Object.freeze(Object.fromEntries(
  Object.entries(FACT_TOPIC_LAW_SOURCE).map(([contractId, facts]) => [
    contractId,
    Object.freeze(Object.entries(facts).map(([valueKey, topicId]) => {
      const valueLaw = valueSemanticForKey(valueKey);
      return Object.freeze({
        valueKey,
        level: TOPIC_LEVELS.get(topicId),
        topicId,
        valueKind: valueLaw.valueKind,
        unit: valueLaw.unit,
        enumValues: valueLaw.enumValues,
        valueConstraints: valueLaw.valueConstraints,
        reasonVocabularyBinding: domainReasonBindingFor(contractId, valueKey, valueLaw.valueKind),
      });
    })),
  ]),
));

const FACT_SEMANTIC_LAW = Object.freeze(Object.fromEntries(Object.entries(FACT_SEMANTICS_BY_CONTRACT).flatMap(
  ([contractId, facts]) => facts.map((fact) => [`${contractId}\u0000${fact.valueKey}`, fact]),
)));

export const DASHBOARD_REQUIRED_VALUE_KEYS = Object.freeze(
  FACT_SEMANTICS_BY_CONTRACT.PANEL_DASHBOARD_TRUTH_V1.map((fact) => fact.valueKey),
);

export const PACKET_REASON_CODE_REGISTRY_VERSION = 'S5_COCKPIT_REASON_CODES_V1';
export const PACKET_REASON_CODES = Object.freeze([
  'BLOCKING_REASON_PRESENT',
  'BORROW_READ_ONLY_NO_MONEY_UI',
  'COMPONENT_BLOCKED',
  'COMPONENT_DRY_RUN',
  'COMPONENT_MISSING',
  'COMPONENT_NOT_CONFIGURED',
  'COMPONENT_SHADOW',
  'COMPONENT_SILENT',
  'COMPONENT_STALE',
  'COMPONENT_SYNTHETIC',
  'COMPONENT_UNKNOWN',
  'COMPONENT_UNAVAILABLE',
  'COMPONENT_VALIDATE_ONLY',
  'CONTROL_UNAVAILABLE',
  'DEGRADED_REASON_PRESENT',
  'DIRECTOR_MOUNT_REQUIRED',
  'EXPOSURE_UNAVAILABLE',
  'FIXTURE_CONTROL_UNAVAILABLE',
  'MISSING',
  'OPERATOR_MUTATION_NOT_AUTOMATIC',
  'OWNER_REASON_VOCABULARY_UNMOUNTED',
  'READ_ONLY_PROJECTION_NO_AUTOMATIC_ACTION',
  'ROOT_BLOCKER_UNAVAILABLE',
  'SILENT',
  'SOURCE_COVERAGE_INCOMPLETE',
  'SOURCE_DISCONNECTED',
  'SOURCE_RATE_LIMITED',
  'SOURCE_SEQUENCE_GAP',
  'SOURCE_STALE',
  'SOURCE_SYNTHETIC',
  'STALE',
  'SYNTHETIC',
  'UNKNOWN',
]);
const PACKET_REASON_CODE_SET = new Set(PACKET_REASON_CODES);

export const COCKPIT_RELEASE_MANIFEST_LAW = Object.freeze({
  manifestId: 'manifest.release.fixture-001',
  manifestRevision: 5,
  manifestSha256: '076e3e2e74ae960b43d59364ac42e66cb924339f1146ddcd8de87879ac68e9be',
  acceptedReleaseSha: '9785c93102b00389847b77c2f9348c06abc4344b',
  totalExpectedCount: 84,
  requiredExpectedCount: 80,
  cockpitProjectionSetSha256: 'ee5eaf2be95e9745cd3264a4d667a90a7a755e08556e621d464259c9eea9ef2c',
  commandPathSetSha256: '18821f9a416381af6c21488598f7e0e735cf9a7dd62f193a78d5ce5d25cc5615',
  componentSetSha256: 'e764c9adcc490f96125965277453b804a26522d3cd8d8a1ca7d35b5557ded26a',
  sourceSetSha256: 'bc4871ecbaf95acd704846586e58abf4412bc8241b78715acd21fc77c04e74aa',
  observationSha256: 'd5b663b08c2128a48f88caf61a7287f65faec47d53bcbea2f66480179f42c2ff',
  evaluationEvidenceSha256: '25a87b40835b26c3c1d5fd52d5b14221d45a774f7fb02f525254184890b7b5b8',
});
export const COCKPIT_EXPECTED_PROJECTION_COUNT = 25;
export const COCKPIT_EXPECTED_COMMAND_PATH_COUNT = 8;

export const INFORMATION_LEVELS = Object.freeze([1, 2, 3, 4, 5]);
export const PANEL_KINDS = Object.freeze(['PANEL', 'GAUGE', 'GRAPH', 'TABLE', 'BADGE', 'CONTROL']);
export const DISPLAY_STATES = Object.freeze([
  'GREEN', 'YELLOW', 'RED', 'UNKNOWN', 'STALE', 'SILENT', 'MISSING', 'SYNTHETIC',
]);

const SAFE_MODES = new Set(['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY']);
const RELEASE_STATUSES = new Set([
  'BUILT_AND_TESTED', 'IMPORTED', 'WIRED', 'LIVE_PUBLIC', 'SYNTHETIC_ONLY',
  'BLOCKED', 'NOT_CONFIGURED', 'MISSING',
]);
const CONTRADICTORY_LIVE_RELEASE_STATUSES = Object.freeze([
  'BLOCKED', 'NOT_CONFIGURED', 'MISSING', 'SYNTHETIC_ONLY',
]);
const TRUTH_LABELS = new Set([
  'LIVE_PUBLIC', 'DRY_RUN', 'SYNTHETIC_ONLY', 'RECORDED_REPLAY', 'UNAVAILABLE', 'UNKNOWN',
]);
const READINESS_STATES = new Set(['STOPPED', 'WARMING', 'READY', 'DEGRADED', 'BLOCKED', 'FAILED']);
const AUTHORITIES = new Set([
  'LIVE_PUBLIC', 'LIVE_PRIVATE', 'DERIVED_LIVE', 'RECORDED_REPLAY', 'SYNTHETIC_TEST', 'UNAVAILABLE',
]);
const COMPLETENESS_STATES = new Set(['COMPLETE', 'PARTIAL', 'UNAVAILABLE']);
const FRESHNESS_STATES = new Set(['FRESH', 'STALE', 'UNAVAILABLE', 'CLOCK_SKEWED']);
const DATA_MODES = new Set([
  'LIVE_PUBLIC', 'SHADOW', 'VALIDATE_ONLY', 'DRY_RUN', 'SYNTHETIC_ONLY',
  'RECORDED_REPLAY', 'UNAVAILABLE', 'UNKNOWN',
]);
const RENDER_TRUTH_LABELS = new Set([
  'LIVE', 'SHADOW', 'VALIDATE_ONLY', 'DRY_RUN', 'SYNTHETIC', 'BLOCKED',
  'NOT_CONFIGURED', 'MISSING', 'UNKNOWN', 'UNAVAILABLE',
]);
const COHERENCE_STATES = new Set(['COHERENT', 'INCOHERENT', 'UNKNOWN']);
const SUBJECT_KINDS = new Set(['COMPONENT', 'INVARIANT', 'SLO', 'CLAIM', 'MONEY_LIFECYCLE_STAGE']);
const WINDOW_KINDS = new Set(['INSTANT', 'ROLLING', 'FIXED', 'LIFECYCLE']);
const CONTROL_COMMANDS = new Set([
  'SET_COMPONENT_STATE', 'SET_INTAKE_PAUSED', 'SET_SAFE_MODE', 'SET_KILL_SWITCH',
  'APPLY_CONFIGURATION', 'REVOKE_APPROVAL', 'REVOKE_RESERVATION', 'RESTART_COMPONENT',
]);
const CONTROL_CONTRACT_LAW = Object.freeze({
  CONTROL_KILL_SWITCH_V1: Object.freeze({ command: 'SET_KILL_SWITCH', backendMutationId: 'SYSTEM_INTEGRATION.SET_KILL_SWITCH' }),
  CONTROL_SAFE_MODE_V1: Object.freeze({ command: 'SET_SAFE_MODE', backendMutationId: 'SYSTEM_INTEGRATION.SET_SAFE_MODE' }),
  CONTROL_INTAKE_PAUSE_V1: Object.freeze({ command: 'SET_INTAKE_PAUSED', backendMutationId: 'SYSTEM_INTEGRATION.SET_INTAKE_PAUSED' }),
  CONTROL_COMPONENT_DESIRED_STATE_V1: Object.freeze({ command: 'SET_COMPONENT_STATE', backendMutationId: 'SYSTEM_INTEGRATION.SET_COMPONENT_STATE' }),
  CONTROL_APPROVAL_REVOKE_V1: Object.freeze({ command: 'REVOKE_APPROVAL', backendMutationId: 'SYSTEM_INTEGRATION.REVOKE_APPROVAL' }),
  CONTROL_BOUNDED_CONFIG_REVISION_V1: Object.freeze({ command: 'APPLY_CONFIGURATION', backendMutationId: 'SYSTEM_INTEGRATION.APPLY_CONFIGURATION' }),
});

const COMPONENT_DESIRED_STATES = new Set(['STOPPED', 'RUNNING', 'PAUSED', 'UNKNOWN']);
const COMPONENT_OBSERVED_STATES = new Set([
  'STOPPED', 'VALIDATING', 'STARTING', 'RUNNING', 'DEGRADED', 'PAUSING',
  'PAUSED', 'STOPPING', 'BLOCKED', 'FAILED', 'MISSING', 'UNKNOWN',
]);
const COMPONENT_LIVENESS_STATES = new Set(['LIVE', 'SILENT', 'STALE', 'DEAD', 'MISSING', 'UNKNOWN']);
const COMPONENT_FACT_UNITS = Object.freeze({
  desiredState: 'STATE',
  observedState: 'STATE',
  readiness: 'STATE',
  liveness: 'STATE',
  heartbeatAgeMs: 'MILLISECONDS',
  restartCount: 'COUNT',
  currentError: 'REASON_CODE',
  renderTruthLabel: 'STATE',
});
const COMPONENT_REASON_BY_TRUTH_LABEL = Object.freeze({
  SHADOW: 'COMPONENT_SHADOW',
  VALIDATE_ONLY: 'COMPONENT_VALIDATE_ONLY',
  DRY_RUN: 'COMPONENT_DRY_RUN',
  SYNTHETIC: 'COMPONENT_SYNTHETIC',
  BLOCKED: 'COMPONENT_BLOCKED',
  NOT_CONFIGURED: 'COMPONENT_NOT_CONFIGURED',
  MISSING: 'COMPONENT_MISSING',
  UNKNOWN: 'COMPONENT_UNKNOWN',
  UNAVAILABLE: 'COMPONENT_UNAVAILABLE',
});

const GREEN_REQUIRED = Object.freeze([
  'MANIFEST_MATCH', 'DENOMINATOR_COMPLETE', 'EVIDENCE_SUFFICIENT', 'SUPPORTED',
  'CONFIGURED', 'DISCOVERED', 'INSTRUMENTED', 'TELEMETRY_PRESENT', 'FRESH', 'COHERENT',
  'LIVE_AUTHORITY', 'REQUIRED_VALUES_PRESENT', 'DETECTION_CLAIM_SATISFIED',
]);
const GREEN_FORBIDDEN = Object.freeze([
  'UNKNOWN', 'STALE', 'SILENT', 'MISSING', 'SYNTHETIC', 'MANIFEST_MISMATCH',
  'DENOMINATOR_INCOMPLETE', 'EVIDENCE_INSUFFICIENT',
]);

export class CockpitContractError extends TypeError {
  constructor(code, path, detail) {
    super(`${code} at ${path}: ${detail}`);
    this.name = 'CockpitContractError';
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, detail) {
  throw new CockpitContractError(code, path, detail);
}

function object(value, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('OBJECT_REQUIRED', path, 'expected a plain object');
  }
  return value;
}

function closed(value, keys, path) {
  const rec = object(value, path);
  const allowed = new Set(keys);
  for (const key of Object.keys(rec)) {
    if (!allowed.has(key)) fail('UNKNOWN_PROPERTY', `${path}.${key}`, 'closed contract rejects this property');
  }
  for (const key of keys) {
    if (!Object.hasOwn(rec, key)) fail('REQUIRED_PROPERTY_MISSING', `${path}.${key}`, 'required property is absent');
  }
  return rec;
}

function text(value, path, maximum = 512) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    fail('TEXT_INVALID', path, `expected non-empty text <= ${maximum} characters`);
  }
}

function nullableText(value, path, maximum = 512) {
  if (value !== null) text(value, path, maximum);
}

function boolOrNull(value, path) {
  if (value !== null && typeof value !== 'boolean') fail('BOOLEAN_OR_NULL_REQUIRED', path, 'expected boolean or null');
}

function nonNegativeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) {
    fail('COUNT_INVALID', path, 'expected a bounded non-negative safe integer');
  }
}

function utcMsOrNull(value, path) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 4_102_444_800_000)) {
    fail('UTC_MILLIS_INVALID', path, 'expected null or a safe UTC millisecond through 2100-01-01');
  }
}

function enumValue(value, values, path) {
  if (!values.has(value)) fail('ENUM_INVALID', path, `unsupported value ${JSON.stringify(value)}`);
}

function uniqueStrings(values, path, maximum = 64) {
  if (!Array.isArray(values) || values.length > maximum) fail('ARRAY_INVALID', path, `expected an array with <= ${maximum} entries`);
  const seen = new Set();
  for (let index = 0; index < values.length; index += 1) {
    text(values[index], `${path}[${index}]`, 160);
    if (seen.has(values[index])) fail('DUPLICATE_ENTRY', `${path}[${index}]`, 'duplicate values are forbidden');
    seen.add(values[index]);
  }
}

function exactLevels(values, path) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 5) fail('LEVELS_INVALID', path, 'expected 1..5 levels');
  const sorted = [...new Set(values)].sort((left, right) => left - right);
  if (sorted.length !== values.length || sorted.some((value, index) => value !== values[index])
      || sorted.some((value) => !INFORMATION_LEVELS.includes(value))) {
    fail('LEVELS_INVALID', path, 'levels must be unique, ascending, and in 1..5');
  }
}

function validateRuleSet(ruleSet, path) {
  const rec = closed(ruleSet, ['ruleSetId', 'states'], path);
  text(rec.ruleSetId, `${path}.ruleSetId`, 120);
  if (!Array.isArray(rec.states) || rec.states.length !== DISPLAY_STATES.length) {
    fail('STATE_RULES_INCOMPLETE', `${path}.states`, 'all eight display states are required');
  }
  const found = new Set();
  for (let index = 0; index < rec.states.length; index += 1) {
    const statePath = `${path}.states[${index}]`;
    const state = closed(rec.states[index], ['state', 'requiresAll', 'forbidsAny', 'reason'], statePath);
    enumValue(state.state, new Set(DISPLAY_STATES), `${statePath}.state`);
    if (found.has(state.state)) fail('DUPLICATE_STATE_RULE', `${statePath}.state`, 'state rule is duplicated');
    found.add(state.state);
    uniqueStrings(state.requiresAll, `${statePath}.requiresAll`, 32);
    uniqueStrings(state.forbidsAny, `${statePath}.forbidsAny`, 32);
    text(state.reason, `${statePath}.reason`, 300);
    if (state.state === 'GREEN') {
      for (const flag of GREEN_REQUIRED) {
        if (!state.requiresAll.includes(flag)) fail('GREEN_RULE_INCOMPLETE', statePath, `missing required flag ${flag}`);
      }
      for (const flag of GREEN_FORBIDDEN) {
        if (!state.forbidsAny.includes(flag)) fail('GREEN_RULE_INCOMPLETE', statePath, `missing forbidden flag ${flag}`);
      }
    }
    if (state.state === 'YELLOW' && !state.requiresAll.includes('DEGRADED_REASON_PRESENT')) {
      fail('YELLOW_RULE_INCOMPLETE', statePath, 'yellow requires an explicit degraded machine reason flag');
    }
    if (state.state === 'RED' && !state.requiresAll.includes('BLOCKING_REASON_PRESENT')) {
      fail('RED_RULE_INCOMPLETE', statePath, 'red requires an explicit blocking machine reason flag');
    }
  }
}

function validatePanelContract(contract, ruleSetIds, path) {
  const rec = closed(contract, [
    'contractId', 'panelKind', 'surfaceId', 'informationLevels', 'ownerQuestion',
    'sourceBinding', 'releaseBinding', 'subjectBinding', 'measurement', 'stateRuleSetId', 'detectionClaim', 'denominatorLaw',
    'greenEvidence', 'requiredValueKeys', 'factSemantics', 'actionBinding', 'drilldowns', 'drilldownBounds',
    'lastIndependentProofTimePath', 'controlBinding', 'componentFactsBinding',
  ], path);
  text(rec.contractId, `${path}.contractId`, 120);
  enumValue(rec.panelKind, new Set(PANEL_KINDS), `${path}.panelKind`);
  enumValue(rec.surfaceId, new Set(I00_SURFACE_IDS), `${path}.surfaceId`);
  exactLevels(rec.informationLevels, `${path}.informationLevels`);
  text(rec.ownerQuestion, `${path}.ownerQuestion`, 300);

  const source = closed(rec.sourceBinding, ['canonicalOwner', 'schemaId', 'schemaVersion', 'aggregationPath'], `${path}.sourceBinding`);
  text(source.canonicalOwner, `${path}.sourceBinding.canonicalOwner`, 120);
  text(source.schemaId, `${path}.sourceBinding.schemaId`, 180);
  if (!Number.isSafeInteger(source.schemaVersion) || source.schemaVersion < 1) fail('SCHEMA_VERSION_INVALID', `${path}.sourceBinding.schemaVersion`, 'expected a positive integer');
  text(source.aggregationPath, `${path}.sourceBinding.aggregationPath`, 300);

  const release = closed(rec.releaseBinding, [
    'manifestId', 'manifestRevision', 'manifestSha256', 'acceptedReleaseSha', 'expectedManifestItemId',
  ], `${path}.releaseBinding`);
  text(release.manifestId, `${path}.releaseBinding.manifestId`, 180);
  if (!Number.isSafeInteger(release.manifestRevision) || release.manifestRevision < 1) {
    fail('MANIFEST_REVISION_INVALID', `${path}.releaseBinding.manifestRevision`, 'expected a positive manifest revision');
  }
  if (typeof release.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(release.manifestSha256)) {
    fail('SHA_INVALID', `${path}.releaseBinding.manifestSha256`, 'expected lowercase SHA-256');
  }
  if (typeof release.acceptedReleaseSha !== 'string' || !/^[a-f0-9]{40}$/.test(release.acceptedReleaseSha)) {
    fail('SHA_INVALID', `${path}.releaseBinding.acceptedReleaseSha`, 'expected lowercase Git SHA');
  }
  for (const key of ['manifestId', 'manifestRevision', 'manifestSha256', 'acceptedReleaseSha']) {
    if (release[key] !== COCKPIT_RELEASE_MANIFEST_LAW[key]) {
      fail('RELEASE_BINDING_LAW_MISMATCH', `${path}.releaseBinding.${key}`, 'release binding must match the immutable accepted manifest law');
    }
  }
  if (release.expectedManifestItemId !== `cockpit-projection:${rec.contractId}`) {
    fail('EXPECTED_MANIFEST_ITEM_ID_MISMATCH', `${path}.releaseBinding.expectedManifestItemId`, 'expected manifest item must bind uniquely to this panel contract');
  }

  const subject = closed(rec.subjectBinding, ['kind', 'id'], `${path}.subjectBinding`);
  enumValue(subject.kind, SUBJECT_KINDS, `${path}.subjectBinding.kind`);
  text(subject.id, `${path}.subjectBinding.id`, 180);

  const measurement = closed(rec.measurement, ['unit', 'windowKind', 'windowMs', 'freshnessLawId', 'coherenceLawId'], `${path}.measurement`);
  text(measurement.unit, `${path}.measurement.unit`, 80);
  enumValue(measurement.windowKind, WINDOW_KINDS, `${path}.measurement.windowKind`);
  if (measurement.windowMs !== null) nonNegativeInteger(measurement.windowMs, `${path}.measurement.windowMs`);
  if (measurement.windowKind === 'INSTANT' && measurement.windowMs !== null) fail('WINDOW_INVALID', `${path}.measurement.windowMs`, 'instant windows use null');
  if (measurement.windowKind !== 'INSTANT' && measurement.windowMs === null) fail('WINDOW_INVALID', `${path}.measurement.windowMs`, 'non-instant windows require milliseconds');
  text(measurement.freshnessLawId, `${path}.measurement.freshnessLawId`, 120);
  text(measurement.coherenceLawId, `${path}.measurement.coherenceLawId`, 120);

  text(rec.stateRuleSetId, `${path}.stateRuleSetId`, 120);
  if (!ruleSetIds.has(rec.stateRuleSetId)) fail('RULE_SET_MISSING', `${path}.stateRuleSetId`, 'referenced state rules are absent');

  const detection = closed(rec.detectionClaim, [
    'kind', 'registeredFailureId', 'detectorPath', 'telemetryPath', 'browserPath',
    'sloId', 'sloMaximumDetectionMs', 'outOfBandProofPath',
  ], `${path}.detectionClaim`);
  enumValue(detection.kind, new Set(['NONE', 'FIVE_SECOND', 'OUT_OF_BAND_ONLY']), `${path}.detectionClaim.kind`);
  for (const key of ['registeredFailureId', 'detectorPath', 'telemetryPath', 'browserPath', 'sloId', 'outOfBandProofPath']) {
    nullableText(detection[key], `${path}.detectionClaim.${key}`, 300);
  }
  if (detection.sloMaximumDetectionMs !== null) {
    if (!Number.isSafeInteger(detection.sloMaximumDetectionMs) || detection.sloMaximumDetectionMs < 1 || detection.sloMaximumDetectionMs > 1_000_000_000) {
      fail('DETECTION_CLAIM_INVALID', `${path}.detectionClaim.sloMaximumDetectionMs`, 'declared detection SLO must be bounded');
    }
  }
  const detectionFacts = [
    detection.registeredFailureId, detection.detectorPath, detection.telemetryPath,
    detection.browserPath, detection.sloId, detection.sloMaximumDetectionMs, detection.outOfBandProofPath,
  ];
  if (detection.kind === 'NONE' && detectionFacts.some((value) => value !== null)) {
    fail('DETECTION_CLAIM_INVALID', `${path}.detectionClaim`, 'NONE must carry only explicit null facts');
  }
  if (detection.kind === 'FIVE_SECOND') {
    if (!rec.informationLevels.includes(1)) {
      fail('FIVE_SECOND_CLAIM_UNPROVEN', `${path}.detectionClaim`, '5s is only an immediate-safety Level-1 projection claim');
    }
    if (!detection.registeredFailureId || !detection.detectorPath || !detection.telemetryPath
        || !detection.browserPath || !detection.sloId || detection.sloMaximumDetectionMs !== 5000
        || detection.outOfBandProofPath !== null) {
      fail('FIVE_SECOND_CLAIM_UNPROVEN', `${path}.detectionClaim`, '5s requires registered failure, detector, telemetry, browser, and matching 5000ms SLO');
    }
  }
  const deadPathFailure = typeof detection.registeredFailureId === 'string'
    && /(?:APP|HOST|TUNNEL).*DEAD|DEAD.*(?:APP|HOST|TUNNEL)/.test(detection.registeredFailureId);
  if (deadPathFailure && detection.kind !== 'OUT_OF_BAND_ONLY') {
    fail('OUT_OF_BAND_PROOF_REQUIRED', `${path}.detectionClaim`, 'app/host/tunnel-dead failures cannot rely on the browser path');
  }
  if (detection.kind === 'OUT_OF_BAND_ONLY') {
    if (!rec.informationLevels.includes(1)) {
      fail('OUT_OF_BAND_PROOF_REQUIRED', `${path}.detectionClaim`, 'dead-path proof must project into immediate-safety Level 1');
    }
    if (!deadPathFailure || !detection.detectorPath || !detection.telemetryPath || detection.browserPath !== null
        || !detection.sloId || detection.sloMaximumDetectionMs === null || !detection.outOfBandProofPath) {
      fail('OUT_OF_BAND_PROOF_REQUIRED', `${path}.detectionClaim`, 'dead-path claim requires independent detector, telemetry, SLO, and proof path with no browser dependency');
    }
  }

  const denominator = closed(rec.denominatorLaw, [
    'expectedSource', 'expectedCount', 'requireExactPartition',
    'requireHiddenFilteredCounts', 'requireUnknownCount',
  ], `${path}.denominatorLaw`);
  text(denominator.expectedSource, `${path}.denominatorLaw.expectedSource`, 240);
  nonNegativeInteger(denominator.expectedCount, `${path}.denominatorLaw.expectedCount`);
  const expectedDenominator = rec.panelKind === 'CONTROL'
    ? { source: 'releaseBoundExpectedManifest.commandPaths', count: COCKPIT_EXPECTED_COMMAND_PATH_COUNT }
    : { source: 'releaseBoundExpectedManifest.cockpitProjections', count: COCKPIT_EXPECTED_PROJECTION_COUNT };
  if (denominator.expectedSource !== expectedDenominator.source || denominator.expectedCount !== expectedDenominator.count) {
    fail('DENOMINATOR_LAW_INCOMPLETE', `${path}.denominatorLaw`, 'panel denominator must bind to its exact release-manifest projection or command-path set');
  }
  if (denominator.requireExactPartition !== true || denominator.requireHiddenFilteredCounts !== true || denominator.requireUnknownCount !== true) {
    fail('DENOMINATOR_LAW_INCOMPLETE', `${path}.denominatorLaw`, 'exact partition and hidden/filtered/unknown counts are mandatory');
  }

  const componentBinding = closed(rec.componentFactsBinding, [
    'required', 'catalogId', 'expectedCount',
  ], `${path}.componentFactsBinding`);
  if (typeof componentBinding.required !== 'boolean') fail('BOOLEAN_REQUIRED', `${path}.componentFactsBinding.required`, 'expected boolean');
  nullableText(componentBinding.catalogId, `${path}.componentFactsBinding.catalogId`, 120);
  nonNegativeInteger(componentBinding.expectedCount, `${path}.componentFactsBinding.expectedCount`);
  const dashboardComponentBinding = rec.contractId === 'PANEL_DASHBOARD_TRUTH_V1';
  if (dashboardComponentBinding) {
    if (componentBinding.required !== true || componentBinding.catalogId !== COMPONENT_FACT_CATALOG_ID
        || componentBinding.expectedCount !== COMPONENT_FACT_CATALOG.length) {
      fail('COMPONENT_FACT_BINDING_MISMATCH', `${path}.componentFactsBinding`, 'Dashboard must bind the exact 13-component system catalog');
    }
  } else if (componentBinding.required !== false || componentBinding.catalogId !== null || componentBinding.expectedCount !== 0) {
    fail('COMPONENT_FACT_BINDING_MISMATCH', `${path}.componentFactsBinding`, 'non-Dashboard contracts cannot claim the Dashboard component graph');
  }

  const evidence = closed(rec.greenEvidence, [
    'minimumCount', 'evidenceMaximumAgeMs', 'independentProofRequired',
    'independentProofMaximumAgeMs',
  ], `${path}.greenEvidence`);
  if (!Number.isSafeInteger(evidence.minimumCount) || evidence.minimumCount < 1 || evidence.minimumCount > 1_000_000) {
    fail('GREEN_EVIDENCE_INVALID', `${path}.greenEvidence.minimumCount`, 'minimum evidence must be 1..1,000,000');
  }
  if (typeof evidence.independentProofRequired !== 'boolean') fail('BOOLEAN_REQUIRED', `${path}.greenEvidence.independentProofRequired`, 'expected boolean');
  if (!Number.isSafeInteger(evidence.evidenceMaximumAgeMs) || evidence.evidenceMaximumAgeMs < 1 || evidence.evidenceMaximumAgeMs > 1_000_000_000) {
    fail('GREEN_EVIDENCE_INVALID', `${path}.greenEvidence.evidenceMaximumAgeMs`, 'evidence maximum age must be 1..1,000,000,000ms');
  }
  if (!Number.isSafeInteger(evidence.independentProofMaximumAgeMs) || evidence.independentProofMaximumAgeMs < 1 || evidence.independentProofMaximumAgeMs > 1_000_000_000) {
    fail('GREEN_EVIDENCE_INVALID', `${path}.greenEvidence.independentProofMaximumAgeMs`, 'independent proof maximum age must be 1..1,000,000,000ms');
  }
  uniqueStrings(rec.requiredValueKeys, `${path}.requiredValueKeys`, 128);
  if (rec.requiredValueKeys.length < 1) fail('REQUIRED_VALUE_KEYS_MISSING', `${path}.requiredValueKeys`, 'every panel must name at least one truth-answer value key');
  if (!Array.isArray(rec.factSemantics) || rec.factSemantics.length !== rec.requiredValueKeys.length) {
    fail('FACT_SEMANTIC_LAW_INCOMPLETE', `${path}.factSemantics`, 'every required value key needs exactly one semantic level/topic owner');
  }
  const semanticKeys = new Set();
  rec.factSemantics.forEach((semantic, index) => {
    const semanticPath = `${path}.factSemantics[${index}]`;
    const fact = closed(semantic, [
      'valueKey', 'level', 'topicId', 'valueKind', 'unit', 'enumValues',
      'valueConstraints', 'reasonVocabularyBinding',
    ], semanticPath);
    text(fact.valueKey, `${semanticPath}.valueKey`, 120);
    if (semanticKeys.has(fact.valueKey)) fail('FACT_SEMANTIC_LAW_INCOMPLETE', semanticPath, 'value key semantic owner is duplicated');
    semanticKeys.add(fact.valueKey);
    if (!rec.requiredValueKeys.includes(fact.valueKey)) fail('FACT_SEMANTIC_KEY_UNDECLARED', `${semanticPath}.valueKey`, 'semantic law references a non-required value key');
    enumValue(fact.valueKind, new Set([
      'ENUM', 'TEXT', 'BOOLEAN', 'NON_NEGATIVE_INTEGER', 'UTC_MILLISECONDS',
      'FINITE_NUMBER', 'NON_NEGATIVE_DECIMAL_STRING', 'SIGNED_DECIMAL_STRING',
      'IDENTITY_SET', 'ENUM_SET', 'PACKET_REASON_CODE_SET',
      'DOMAIN_REASON_CODE', 'DOMAIN_REASON_CODE_SET',
    ]), `${semanticPath}.valueKind`);
    text(fact.unit, `${semanticPath}.unit`, 80);
    if (fact.valueKind === 'ENUM' || fact.valueKind === 'ENUM_SET') {
      if (!Array.isArray(fact.enumValues) || fact.enumValues.length < 1 || fact.enumValues.length > 32) {
        fail('FACT_ENUM_LAW_INVALID', `${semanticPath}.enumValues`, 'enum facts require 1..32 values');
      }
      uniqueStrings(fact.enumValues, `${semanticPath}.enumValues`, 32);
      const sortedEnum = [...fact.enumValues].sort(compareCodePoints);
      if (sortedEnum.some((value, enumIndex) => value !== fact.enumValues[enumIndex])) {
        fail('FACT_ENUM_LAW_INVALID', `${semanticPath}.enumValues`, 'enum values must be unique and code-point sorted');
      }
    } else if (fact.enumValues !== null) {
      fail('FACT_ENUM_LAW_INVALID', `${semanticPath}.enumValues`, 'non-enum facts require an explicit null enum vocabulary');
    }
    const expected = FACT_SEMANTIC_LAW[`${rec.contractId}\u0000${fact.valueKey}`];
    const enumMatches = expected && (
      (expected.enumValues === null && fact.enumValues === null)
      || (Array.isArray(expected.enumValues) && Array.isArray(fact.enumValues)
        && expected.enumValues.length === fact.enumValues.length
        && expected.enumValues.every((value, enumIndex) => value === fact.enumValues[enumIndex]))
    );
    const constraintsMatch = expected && JSON.stringify(fact.valueConstraints) === JSON.stringify(expected.valueConstraints);
    const reasonBindingMatches = expected
      && JSON.stringify(fact.reasonVocabularyBinding) === JSON.stringify(expected.reasonVocabularyBinding);
    if (!expected || fact.level !== expected.level || fact.topicId !== expected.topicId
        || fact.valueKind !== expected.valueKind || fact.unit !== expected.unit || !enumMatches
        || !constraintsMatch || !reasonBindingMatches) {
      fail('FACT_SEMANTIC_LAW_MISMATCH', semanticPath, 'value key must use its immutable level, topic, type, unit, enum, bounds, and owner-vocabulary law');
    }
    if (!rec.informationLevels.includes(fact.level)) {
      fail('FACT_SEMANTIC_LEVEL_UNSUPPORTED', semanticPath, 'contract does not project the semantic level owned by this value key');
    }
  });
  if (rec.requiredValueKeys.some((valueKey) => !semanticKeys.has(valueKey))) {
    fail('FACT_SEMANTIC_LAW_INCOMPLETE', `${path}.factSemantics`, 'required value key is missing its semantic owner');
  }
  const lawKeys = Object.keys(FACT_TOPIC_LAW_SOURCE[rec.contractId] ?? {}).sort(compareCodePoints);
  const requiredKeys = [...rec.requiredValueKeys].sort(compareCodePoints);
  if (lawKeys.length !== requiredKeys.length || lawKeys.some((valueKey, index) => valueKey !== requiredKeys[index])) {
    fail('FACT_SEMANTIC_KEYSET_MISMATCH', `${path}.requiredValueKeys`, 'contract required keys must exactly equal the immutable fact-topic law keyset');
  }
  const semanticLevels = [...new Set(rec.factSemantics.map((fact) => fact.level))].sort((left, right) => left - right);
  if (semanticLevels.length !== rec.informationLevels.length
      || semanticLevels.some((level, index) => level !== rec.informationLevels[index])) {
    fail('FACT_SEMANTIC_LEVELSET_MISMATCH', `${path}.informationLevels`, 'information levels must exactly equal semantic fact levels');
  }

  const action = closed(rec.actionBinding, ['currentOwner', 'actionAuthority', 'automaticActionId', 'noAutomaticActionReasonCode', 'operatorResponse', 'runbookRef'], `${path}.actionBinding`);
  text(action.currentOwner, `${path}.actionBinding.currentOwner`, 120);
  text(action.actionAuthority, `${path}.actionBinding.actionAuthority`, 120);
  nullableText(action.automaticActionId, `${path}.actionBinding.automaticActionId`, 160);
  nullableText(action.noAutomaticActionReasonCode, `${path}.actionBinding.noAutomaticActionReasonCode`, 160);
  if (action.noAutomaticActionReasonCode !== null && !PACKET_REASON_CODE_SET.has(action.noAutomaticActionReasonCode)) {
    fail('REASON_CODE_NOT_REGISTERED', `${path}.actionBinding.noAutomaticActionReasonCode`, 'reason code is absent from the frozen packet registry');
  }
  if ((action.automaticActionId === null) === (action.noAutomaticActionReasonCode === null)) {
    fail('ACTION_DECLARATION_INVALID', `${path}.actionBinding`, 'declare exactly one automatic action or bounded absence reason');
  }
  text(action.operatorResponse, `${path}.actionBinding.operatorResponse`, 300);
  text(action.runbookRef, `${path}.actionBinding.runbookRef`, 240);

  const drilldowns = closed(rec.drilldowns, ['incident', 'trace', 'evidence'], `${path}.drilldowns`);
  text(drilldowns.incident, `${path}.drilldowns.incident`, 200);
  text(drilldowns.trace, `${path}.drilldowns.trace`, 200);
  text(drilldowns.evidence, `${path}.drilldowns.evidence`, 200);
  const drilldownBounds = closed(rec.drilldownBounds, ['perComponentRequired', 'maximumRows', 'maximumTraceEvents'], `${path}.drilldownBounds`);
  if (drilldownBounds.perComponentRequired !== true) fail('DRILLDOWN_BOUNDS_INVALID', `${path}.drilldownBounds.perComponentRequired`, 'per-component drill-down is mandatory');
  for (const key of ['maximumRows', 'maximumTraceEvents']) {
    if (!Number.isSafeInteger(drilldownBounds[key]) || drilldownBounds[key] < 1 || drilldownBounds[key] > 10_000) {
      fail('DRILLDOWN_BOUNDS_INVALID', `${path}.drilldownBounds.${key}`, 'drill-down limits must be 1..10,000');
    }
  }
  text(rec.lastIndependentProofTimePath, `${path}.lastIndependentProofTimePath`, 240);

  if (rec.panelKind === 'CONTROL') {
    const control = closed(rec.controlBinding, [
      'command', 'backendMutationId', 'testedContractRef', 'previewConfirmResultRequired',
      'beforeAfterEvidenceRequired', 'ledgerEvidenceRequired', 'unavailableReasonCode',
    ], `${path}.controlBinding`);
    enumValue(control.command, CONTROL_COMMANDS, `${path}.controlBinding.command`);
    text(control.backendMutationId, `${path}.controlBinding.backendMutationId`, 200);
    text(control.testedContractRef, `${path}.controlBinding.testedContractRef`, 300);
    text(control.unavailableReasonCode, `${path}.controlBinding.unavailableReasonCode`, 160);
    if (!PACKET_REASON_CODE_SET.has(control.unavailableReasonCode)) {
      fail('REASON_CODE_NOT_REGISTERED', `${path}.controlBinding.unavailableReasonCode`, 'reason code is absent from the frozen packet registry');
    }
    const expectedControl = CONTROL_CONTRACT_LAW[rec.contractId];
    if (!expectedControl || control.command !== expectedControl.command
        || control.backendMutationId !== expectedControl.backendMutationId) {
      fail('CONTROL_CONTRACT_LAW_MISMATCH', `${path}.controlBinding`, 'control contract must bind its exact canonical command and backend mutation');
    }
    if (control.unavailableReasonCode !== 'DIRECTOR_MOUNT_REQUIRED') {
      fail('CONTROL_AVAILABILITY_INVALID', `${path}.controlBinding.unavailableReasonCode`, 'packet controls remain director-mount-required');
    }
    if (control.previewConfirmResultRequired !== true || control.beforeAfterEvidenceRequired !== true || control.ledgerEvidenceRequired !== true) {
      fail('FAKE_CONTROL', `${path}.controlBinding`, 'controls require preview/confirm/result, before/after, and ledger evidence');
    }
  } else if (rec.controlBinding !== null) {
    fail('ORPHAN_CONTROL_BINDING', `${path}.controlBinding`, 'non-control visuals cannot smuggle a control binding');
  }
}

export function validateCockpitContractSet(input) {
  const root = closed(input, [
    'schemaVersion', 'contractSetId', 'reasonCodeRegistryVersion', 'reasonCodeRegistry',
    'domainReasonVocabularyRegistryId', 'domainReasonVocabularyRegistryRevision',
    'domainReasonVocabularyRegistrySha256', 'domainReasonVocabularies',
    'stateRuleSets', 'contracts',
  ], '$');
  if (root.schemaVersion !== COCKPIT_SCHEMA_VERSION) fail('SCHEMA_VERSION_INVALID', '$.schemaVersion', 'unsupported cockpit schema version');
  text(root.contractSetId, '$.contractSetId', 120);
  if (root.reasonCodeRegistryVersion !== PACKET_REASON_CODE_REGISTRY_VERSION) {
    fail('REASON_CODE_REGISTRY_VERSION_MISMATCH', '$.reasonCodeRegistryVersion', 'contract set must name the frozen packet reason-code registry version');
  }
  uniqueStrings(root.reasonCodeRegistry, '$.reasonCodeRegistry', 64);
  if (root.reasonCodeRegistry.length !== PACKET_REASON_CODES.length
      || root.reasonCodeRegistry.some((code, index) => code !== PACKET_REASON_CODES[index])) {
    fail('REASON_CODE_REGISTRY_MISMATCH', '$.reasonCodeRegistry', 'contract set registry must exactly equal the frozen packet reason-code vocabulary');
  }
  if (root.domainReasonVocabularyRegistryId !== DOMAIN_REASON_VOCABULARY_REGISTRY_ID
      || root.domainReasonVocabularyRegistryRevision !== DOMAIN_REASON_VOCABULARY_REGISTRY_REVISION
      || root.domainReasonVocabularyRegistrySha256 !== DOMAIN_REASON_VOCABULARY_REGISTRY_SHA256
      || JSON.stringify(root.domainReasonVocabularies) !== JSON.stringify(DOMAIN_REASON_VOCABULARIES)) {
    fail('DOMAIN_REASON_VOCABULARY_REGISTRY_MISMATCH', '$.domainReasonVocabularies', 'contract set must exactly bind the frozen owner-scoped reason vocabularies');
  }
  if (!Array.isArray(root.stateRuleSets) || root.stateRuleSets.length < 1 || root.stateRuleSets.length > 16) fail('RULE_SET_ARRAY_INVALID', '$.stateRuleSets', 'expected 1..16 rule sets');
  const ruleSetIds = new Set();
  root.stateRuleSets.forEach((ruleSet, index) => {
    validateRuleSet(ruleSet, `$.stateRuleSets[${index}]`);
    if (ruleSetIds.has(ruleSet.ruleSetId)) fail('DUPLICATE_RULE_SET', `$.stateRuleSets[${index}].ruleSetId`, 'duplicate rule set');
    ruleSetIds.add(ruleSet.ruleSetId);
  });
  const canonicalContractIds = Object.keys(FACT_TOPIC_LAW_SOURCE);
  if (!Array.isArray(root.contracts) || root.contracts.length !== canonicalContractIds.length) {
    fail('CONTRACT_ARRAY_INVALID', '$.contracts', `expected exactly ${canonicalContractIds.length} canonical contracts`);
  }
  const ids = new Set();
  const surfaces = new Set();
  root.contracts.forEach((contract, index) => {
    validatePanelContract(contract, ruleSetIds, `$.contracts[${index}]`);
    if (ids.has(contract.contractId)) fail('DUPLICATE_CONTRACT', `$.contracts[${index}].contractId`, 'duplicate contract ID');
    ids.add(contract.contractId);
    surfaces.add(contract.surfaceId);
  });
  if (I00_SURFACE_IDS.some((surfaceId) => !surfaces.has(surfaceId)) || surfaces.size !== I00_SURFACE_IDS.length) {
    fail('SURFACE_COVERAGE_INCOMPLETE', '$.contracts', 'contract set must cover exactly the 18 existing I00 section 15 surfaces');
  }
  for (const contractId of canonicalContractIds) {
    if (!ids.has(contractId)) fail('CONTRACT_COVERAGE_INCOMPLETE', '$.contracts', `missing ${contractId}`);
  }
  if (root.contracts.filter((contract) => contract.panelKind === 'CONTROL').length !== Object.keys(CONTROL_CONTRACT_LAW).length) {
    fail('CONTROL_CONTRACT_COVERAGE_INCOMPLETE', '$.contracts', 'all six Dashboard truth control mutation classes are required');
  }
  return true;
}

export function validateSurfaceProjectionMatrix(input) {
  const root = closed(input, ['schemaVersion', 'matrixId', 'levelDefinitions', 'rows'], '$');
  if (root.schemaVersion !== COCKPIT_SCHEMA_VERSION) fail('SCHEMA_VERSION_INVALID', '$.schemaVersion', 'unsupported matrix version');
  text(root.matrixId, '$.matrixId', 120);
  if (!Array.isArray(root.levelDefinitions) || root.levelDefinitions.length !== INFORMATION_LEVEL_DEFINITIONS.length) {
    fail('LEVEL_DEFINITIONS_INCOMPLETE', '$.levelDefinitions', 'exactly five canonical level definitions are required');
  }
  const canonicalTopicLevels = new Map();
  root.levelDefinitions.forEach((definition, index) => {
    const path = `$.levelDefinitions[${index}]`;
    const rec = closed(definition, ['level', 'levelId', 'title', 'topics'], path);
    const expected = INFORMATION_LEVEL_DEFINITIONS[index];
    if (rec.level !== expected.level || rec.levelId !== expected.levelId || rec.title !== expected.title
        || !Array.isArray(rec.topics) || rec.topics.length !== expected.topics.length) {
      fail('LEVEL_DEFINITION_MISMATCH', path, 'level ID, title, and topic count must match the canonical five-level law');
    }
    rec.topics.forEach((topic, topicIndex) => {
      const topicPath = `${path}.topics[${topicIndex}]`;
      const fact = closed(topic, ['topicId', 'definition'], topicPath);
      const expectedTopic = expected.topics[topicIndex];
      if (fact.topicId !== expectedTopic.topicId || fact.definition !== expectedTopic.definition) {
        fail('LEVEL_DEFINITION_MISMATCH', topicPath, 'topic ID and definition must match the canonical five-level law');
      }
      canonicalTopicLevels.set(fact.topicId, rec.level);
    });
  });
  if (!Array.isArray(root.rows) || root.rows.length !== I00_SURFACE_IDS.length) fail('SURFACE_MATRIX_SIZE', '$.rows', 'exactly 18 rows are required');
  const seen = new Set();
  const representedLevels = new Set();
  const representedTopics = new Set();
  const globallyBoundPairs = new Set();
  root.rows.forEach((row, index) => {
    const rowPath = `$.rows[${index}]`;
    const rec = closed(row, [
      'surfaceId', 'informationLevels', 'projectionQuestion', 'routeKind',
      'canonicalRoute', 'pageOwner', 'factBindings',
    ], rowPath);
    if (rec.surfaceId !== I00_SURFACE_IDS[index]) fail('SURFACE_ORDER_INVALID', `${rowPath}.surfaceId`, 'rows must use exact I00 order without invented pages');
    if (seen.has(rec.surfaceId)) fail('DUPLICATE_SURFACE', `${rowPath}.surfaceId`, 'surface appears more than once');
    seen.add(rec.surfaceId);
    exactLevels(rec.informationLevels, `${rowPath}.informationLevels`);
    rec.informationLevels.forEach((level) => representedLevels.add(level));
    text(rec.projectionQuestion, `${rowPath}.projectionQuestion`, 300);
    const expectedRoute = SURFACE_ROUTE_LAW[rec.surfaceId];
    if (rec.routeKind !== expectedRoute.routeKind || rec.canonicalRoute !== expectedRoute.canonicalRoute
        || rec.pageOwner !== expectedRoute.pageOwner) {
      fail('SURFACE_ROUTE_LAW_MISMATCH', rowPath, 'surface must use its existing canonical route and page owner');
    }
    if (!Array.isArray(rec.factBindings) || rec.factBindings.length < 1 || rec.factBindings.length > 256) {
      fail('FACT_BINDINGS_INVALID', `${rowPath}.factBindings`, 'expected 1..256 bounded fact bindings');
    }
    const bindingKeys = new Set();
    const boundPairs = new Set();
    const boundLevels = new Set();
    rec.factBindings.forEach((binding, bindingIndex) => {
      const bindingPath = `${rowPath}.factBindings[${bindingIndex}]`;
      const fact = closed(binding, ['level', 'topicId', 'contractId', 'valueKey'], bindingPath);
      if (!rec.informationLevels.includes(fact.level)) fail('FACT_LEVEL_MISMATCH', `${bindingPath}.level`, 'binding level is absent from the surface projection');
      if (canonicalTopicLevels.get(fact.topicId) !== fact.level) fail('FACT_TOPIC_MISMATCH', `${bindingPath}.topicId`, 'topic ID does not belong to binding level');
      text(fact.contractId, `${bindingPath}.contractId`, 120);
      text(fact.valueKey, `${bindingPath}.valueKey`, 120);
      const identity = `${fact.level}\u0000${fact.topicId}\u0000${fact.contractId}\u0000${fact.valueKey}`;
      if (bindingKeys.has(identity)) fail('DUPLICATE_FACT_BINDING', bindingPath, 'fact binding is duplicated');
      bindingKeys.add(identity);
      const pairIdentity = `${fact.contractId}\u0000${fact.valueKey}`;
      if (boundPairs.has(pairIdentity)) fail('DUPLICATE_FACT_PAIR_BINDING', bindingPath, 'contract/value pair must have exactly one binding');
      boundPairs.add(pairIdentity);
      if (globallyBoundPairs.has(pairIdentity)) fail('DUPLICATE_FACT_PAIR_BINDING', bindingPath, 'contract/value pair cannot be projected on more than one surface');
      globallyBoundPairs.add(pairIdentity);
      const expectedSemantic = FACT_SEMANTIC_LAW[pairIdentity];
      if (!expectedSemantic || fact.level !== expectedSemantic.level || fact.topicId !== expectedSemantic.topicId) {
        fail('FACT_SEMANTIC_BINDING_MISMATCH', bindingPath, 'contract/value pair must use its immutable semantic level and topic');
      }
      boundLevels.add(fact.level);
      representedTopics.add(fact.topicId);
    });
    if (rec.informationLevels.some((level) => !boundLevels.has(level))) {
      fail('LEVEL_FACT_COVERAGE_INCOMPLETE', `${rowPath}.factBindings`, 'every declared surface level requires at least one fact binding');
    }
  });
  if (INFORMATION_LEVELS.some((level) => !representedLevels.has(level))) fail('LEVEL_COVERAGE_INCOMPLETE', '$.rows', 'all five information levels must be projections');
  const lawPairs = Object.keys(FACT_SEMANTIC_LAW).sort(compareCodePoints);
  const matrixPairs = [...globallyBoundPairs].sort(compareCodePoints);
  if (lawPairs.length !== matrixPairs.length || lawPairs.some((pair, index) => pair !== matrixPairs[index])) {
    fail('FACT_BINDING_KEYSET_MISMATCH', '$.rows', 'matrix contract/value pairs must exactly equal the immutable fact law keyset');
  }
  const missingTopics = [...canonicalTopicLevels.keys()].filter((topicId) => !representedTopics.has(topicId));
  if (missingTopics.length > 0) fail('TOPIC_COVERAGE_INCOMPLETE', '$.rows', `unbound topics: ${missingTopics.join(',')}`);
  return true;
}

function validateComponentFactCollections(root, valuesByKey) {
  if (root.contractId !== 'PANEL_DASHBOARD_TRUTH_V1') {
    if (root.componentDenominator !== null || !Array.isArray(root.componentFacts) || root.componentFacts.length !== 0) {
      fail('ORPHAN_COMPONENT_FACTS', '$.componentFacts', 'only the Dashboard contract may carry the canonical component graph');
    }
    return;
  }
  const denominator = closed(root.componentDenominator, [
    'catalogId', 'expectedCount', 'rowCount', 'visibleCount', 'filteredCount',
    'hiddenCount', 'missingCount', 'unknownCount',
  ], '$.componentDenominator');
  if (denominator.catalogId !== COMPONENT_FACT_CATALOG_ID) fail('COMPONENT_DENOMINATOR_MISMATCH', '$.componentDenominator.catalogId', 'wrong component catalog');
  for (const key of ['expectedCount', 'rowCount', 'visibleCount', 'filteredCount', 'hiddenCount', 'missingCount', 'unknownCount']) {
    nonNegativeInteger(denominator[key], `$.componentDenominator.${key}`);
  }
  if (!Array.isArray(root.componentFacts) || root.componentFacts.length !== COMPONENT_FACT_CATALOG.length) {
    fail('COMPONENT_FACT_COVERAGE_MISMATCH', '$.componentFacts', 'exactly 13 canonical component rows are required');
  }
  const ids = root.componentFacts.map((row) => object(row, '$.componentFacts').componentId);
  if (new Set(ids).size !== ids.length) fail('DUPLICATE_COMPONENT_FACT', '$.componentFacts', 'component identities must be unique');
  let missingCount = 0;
  let unknownCount = 0;
  root.componentFacts.forEach((row, index) => {
    const path = `$.componentFacts[${index}]`;
    const rec = closed(row, [
      'componentId', 'ownerId', 'sourceCanonicalOwner', 'sourceSchemaId', 'sourceSchemaVersion',
      'supervisorSnapshotRevision', 'expectedManifestItemId', 'acceptedReleaseSha', 'runningReleaseSha',
      'releaseStatuses', 'freshnessLawId', 'maximumHeartbeatAgeMs', 'coherenceLawId',
      'desiredState', 'observedState', 'readiness', 'liveness',
      'heartbeatAgeMs', 'restartCount', 'currentError', 'renderTruthLabel', 'reasonCode',
      'units', 'ownerResponse', 'runbookRef', 'incidentDrilldownRef',
      'traceDrilldownRef', 'evidenceDrilldownRef',
    ], path);
    const expected = COMPONENT_FACT_CATALOG[index];
    if (rec.componentId !== expected.componentId || rec.ownerId !== expected.ownerId
        || rec.expectedManifestItemId !== expected.expectedManifestItemId) {
      fail('COMPONENT_FACT_IDENTITY_MISMATCH', path, 'component ID, owner, manifest item, and catalog order must be exact');
    }
    if (rec.sourceCanonicalOwner !== 'SYSTEM_INTEGRATION'
        || rec.sourceSchemaId !== 'SYSTEM_SUPERVISOR_COMPONENT_SNAPSHOT'
        || rec.sourceSchemaVersion !== 1) {
      fail('COMPONENT_FACT_SOURCE_MISMATCH', path, 'component facts must retain canonical supervisor source provenance');
    }
    nonNegativeInteger(rec.supervisorSnapshotRevision, `${path}.supervisorSnapshotRevision`);
    text(rec.freshnessLawId, `${path}.freshnessLawId`, 160);
    nonNegativeInteger(rec.maximumHeartbeatAgeMs, `${path}.maximumHeartbeatAgeMs`);
    if (rec.maximumHeartbeatAgeMs < 1) fail('COMPONENT_FRESHNESS_LAW_INVALID', `${path}.maximumHeartbeatAgeMs`, 'component maximum heartbeat age must be positive');
    text(rec.coherenceLawId, `${path}.coherenceLawId`, 160);
    if (rec.acceptedReleaseSha !== COCKPIT_RELEASE_MANIFEST_LAW.acceptedReleaseSha
        || rec.runningReleaseSha !== COCKPIT_RELEASE_MANIFEST_LAW.acceptedReleaseSha) {
      fail('COMPONENT_FACT_RELEASE_MISMATCH', path, 'component row release provenance must match the accepted release');
    }
    if (!Array.isArray(rec.releaseStatuses) || rec.releaseStatuses.length < 1
        || rec.releaseStatuses.length > RELEASE_STATUSES.size || new Set(rec.releaseStatuses).size !== rec.releaseStatuses.length) {
      fail('COMPONENT_FACT_RELEASE_MISMATCH', `${path}.releaseStatuses`, 'component release statuses must be unique and bounded');
    }
    rec.releaseStatuses.forEach((status, statusIndex) => enumValue(status, RELEASE_STATUSES, `${path}.releaseStatuses[${statusIndex}]`));
    enumValue(rec.desiredState, COMPONENT_DESIRED_STATES, `${path}.desiredState`);
    enumValue(rec.observedState, COMPONENT_OBSERVED_STATES, `${path}.observedState`);
    enumValue(rec.readiness, new Set([...READINESS_STATES, 'MISSING', 'UNKNOWN']), `${path}.readiness`);
    enumValue(rec.liveness, COMPONENT_LIVENESS_STATES, `${path}.liveness`);
    if (rec.heartbeatAgeMs !== null) nonNegativeInteger(rec.heartbeatAgeMs, `${path}.heartbeatAgeMs`);
    if (rec.restartCount !== null) nonNegativeInteger(rec.restartCount, `${path}.restartCount`);
    if ((rec.heartbeatAgeMs === null || rec.restartCount === null) && rec.reasonCode === null) {
      fail('COMPONENT_FACT_VALUE_INVALID', path, 'unknown component age/count requires a causal reason');
    }
    nullableText(rec.currentError, `${path}.currentError`, 160);
    if (rec.currentError !== null
        && !vocabularyAcceptsCode(DOMAIN_REASON_VOCABULARIES_BY_ID.get('STRUCTURED_FAILURE_CODE_V1'), rec.currentError)) {
      fail('DOMAIN_REASON_CODE_NOT_REGISTERED', `${path}.currentError`, 'component error is absent from the StructuredFailure owner vocabulary');
    }
    enumValue(rec.renderTruthLabel, RENDER_TRUTH_LABELS, `${path}.renderTruthLabel`);
    nullableText(rec.reasonCode, `${path}.reasonCode`, 160);
    if (rec.reasonCode !== null && !PACKET_REASON_CODE_SET.has(rec.reasonCode)) fail('REASON_CODE_NOT_REGISTERED', `${path}.reasonCode`, 'component reason is absent from the packet registry');
    const units = closed(rec.units, Object.keys(COMPONENT_FACT_UNITS), `${path}.units`);
    for (const [key, unit] of Object.entries(COMPONENT_FACT_UNITS)) {
      if (units[key] !== unit) fail('COMPONENT_FACT_UNIT_MISMATCH', `${path}.units.${key}`, `expected ${unit}`);
    }
    text(rec.ownerResponse, `${path}.ownerResponse`, 500);
    text(rec.runbookRef, `${path}.runbookRef`, 240);
    for (const key of ['incidentDrilldownRef', 'traceDrilldownRef', 'evidenceDrilldownRef']) text(rec[key], `${path}.${key}`, 240);
    if (rec.incidentDrilldownRef !== `component:${rec.componentId}:incident`
        || rec.traceDrilldownRef !== `component:${rec.componentId}:trace`
        || rec.evidenceDrilldownRef !== `component:${rec.componentId}:evidence`) {
      fail('COMPONENT_FACT_DRILLDOWN_MISMATCH', path, 'component drill-down references must bind the same stable identity');
    }
    const contradictory = rec.releaseStatuses.some((status) => CONTRADICTORY_LIVE_RELEASE_STATUSES.includes(status));
    if (rec.renderTruthLabel === 'LIVE') {
      if (!rec.releaseStatuses.includes('LIVE_PUBLIC') || contradictory) fail('COMPONENT_TRUTH_RELEASE_CONFLICT', path, 'LIVE component truth requires non-contradictory LIVE_PUBLIC release status');
      if (rec.desiredState !== 'RUNNING' || rec.observedState !== 'RUNNING'
          || rec.readiness !== 'READY' || rec.liveness !== 'LIVE'
          || rec.heartbeatAgeMs === null || rec.heartbeatAgeMs > rec.maximumHeartbeatAgeMs
          || rec.restartCount === null || rec.currentError !== null || rec.reasonCode !== null) {
        fail('COMPONENT_LIVE_FACT_CONTRADICTION', path, 'LIVE requires running, ready, live, current heartbeat, known restart count, and no failure/cause');
      }
    } else {
      if (rec.releaseStatuses.includes('LIVE_PUBLIC')) fail('COMPONENT_TRUTH_RELEASE_CONFLICT', path, 'non-live component truth cannot carry LIVE_PUBLIC release status');
      if (rec.reasonCode !== COMPONENT_REASON_BY_TRUTH_LABEL[rec.renderTruthLabel]) {
        fail('COMPONENT_CAUSE_MISMATCH', `${path}.reasonCode`, 'non-live component truth requires its exact causal reason');
      }
    }
    if (rec.renderTruthLabel === 'MISSING') missingCount += 1;
    if (rec.renderTruthLabel === 'UNKNOWN' || rec.renderTruthLabel === 'UNAVAILABLE') unknownCount += 1;
  });
  if (denominator.expectedCount !== COMPONENT_FACT_CATALOG.length
      || denominator.rowCount !== root.componentFacts.length
      || denominator.visibleCount !== COMPONENT_FACT_CATALOG.length
      || denominator.filteredCount !== 0 || denominator.hiddenCount !== 0
      || denominator.missingCount !== missingCount || denominator.unknownCount !== unknownCount) {
    fail('COMPONENT_DENOMINATOR_MISMATCH', '$.componentDenominator', 'component denominator must exactly partition and expose the canonical catalog');
  }
  const supervisor = root.componentFacts.find((row) => row.componentId === 'engine-supervisor');
  const scalarBindings = ['desiredState', 'observedState', 'readiness', 'liveness', 'heartbeatAgeMs', 'restartCount', 'currentError', 'renderTruthLabel'];
  for (const key of scalarBindings) {
    if (valuesByKey.get(key)?.value !== supervisor[key]) {
      fail('COMPONENT_AGGREGATE_BINDING_MISMATCH', `$.values.${key}`, 'Dashboard generic component facts must equal the engine-supervisor row');
    }
  }
  if (root.requestedDisplayState === 'GREEN' && root.componentFacts.some((row) => row.renderTruthLabel !== 'LIVE')) {
    fail('ROW_GREEN_CONTRADICTION', '$.componentFacts', 'GREEN Dashboard requires every canonical component row to be live');
  }
}

function validateSourceRowCollections(root, valuesByKey) {
  if (root.contractId !== 'PANEL_DASHBOARD_TRUTH_V1') {
    if (root.sourceDenominator !== null || root.sourceAggregationDenominator !== null
        || !Array.isArray(root.sourceRows) || root.sourceRows.length !== 0) {
      fail('ORPHAN_SOURCE_ROWS', '$.sourceRows', 'only the Dashboard contract may carry source rows');
    }
    return;
  }
  const denominator = closed(root.sourceDenominator, [
    'catalogId', 'expectedCount', 'coveredCount', 'missingCount', 'unknownCount',
  ], '$.sourceDenominator');
  if (denominator.catalogId !== SEMANTIC_SOURCE_STREAM_CATALOG_ID) fail('SOURCE_DENOMINATOR_MISMATCH', '$.sourceDenominator.catalogId', 'wrong semantic stream catalog');
  for (const key of ['expectedCount', 'coveredCount', 'missingCount', 'unknownCount']) nonNegativeInteger(denominator[key], `$.sourceDenominator.${key}`);
  const aggregationDenominator = closed(root.sourceAggregationDenominator, [
    'catalogId', 'expectedCount', 'rowCount', 'visibleCount', 'filteredCount',
    'hiddenCount', 'missingCount', 'unknownCount',
  ], '$.sourceAggregationDenominator');
  if (aggregationDenominator.catalogId !== SOURCE_ROW_CATALOG_ID) fail('SOURCE_DENOMINATOR_MISMATCH', '$.sourceAggregationDenominator.catalogId', 'wrong named aggregation catalog');
  for (const key of ['expectedCount', 'rowCount', 'visibleCount', 'filteredCount', 'hiddenCount', 'missingCount', 'unknownCount']) {
    nonNegativeInteger(aggregationDenominator[key], `$.sourceAggregationDenominator.${key}`);
  }
  if (!Array.isArray(root.sourceRows) || root.sourceRows.length !== SOURCE_ROW_CATALOG.length) {
    fail('SOURCE_ROW_COVERAGE_MISMATCH', '$.sourceRows', 'exactly four canonical named source aggregations are required');
  }
  const ids = root.sourceRows.map((row) => object(row, '$.sourceRows').sourceAggregationId);
  if (new Set(ids).size !== ids.length) fail('DUPLICATE_SOURCE_ROW', '$.sourceRows', 'source identities must be unique');
  let coverageExpected = 0;
  let coverageCurrent = 0;
  let quietSymbols = 0;
  let sequenceGaps = 0;
  let oldestAge = null;
  let missing = 0;
  let unknown = 0;
  let missingStreamCount = 0;
  let unknownStreamCount = 0;
  const streamIds = [];
  const allQuietSymbolIds = new Set();
  const degradedRows = [];
  const connectionStates = new Set();
  const backoffStates = new Set();
  root.sourceRows.forEach((row, index) => {
    const path = `$.sourceRows[${index}]`;
    const rec = closed(row, [
      'aggregationKind', 'canonicalRegistryRef', 'sourceAggregationId', 'ownerId',
      'coveredExpectedManifestItemIds', 'physicalProducerIds', 'componentIds',
      'acceptedReleaseSha', 'runningReleaseSha', 'sourceSchemaId', 'sourceSchemaVersion',
      'freshnessLawId', 'maximumMessageAgeMs', 'coherenceLawId',
      'connectionState', 'lastMessageAgeMs', 'sequenceGapCount', 'rateLimitBackoffState',
      'coverageExpectedCount', 'coverageCurrentCount', 'quietSymbolCount', 'quietSymbolIds',
      'renderTruthLabel', 'domainReasonCodes', 'reasonVocabularyBinding', 'projectionCauseCode',
      'units', 'publisherDrilldownRef',
      'producerDrilldownRefs', 'componentDrilldownRefs', 'incidentRef', 'traceRef', 'evidenceRef',
    ], path);
    const expected = SOURCE_ROW_CATALOG[index];
    if (rec.aggregationKind !== 'NAMED_AGGREGATION'
        || rec.canonicalRegistryRef !== 'ARCHITECTURE_CANONICAL_SEMANTIC_SOURCE_REGISTRY'
        || rec.sourceAggregationId !== expected.sourceAggregationId || rec.ownerId !== expected.ownerId
        || JSON.stringify(rec.coveredExpectedManifestItemIds) !== JSON.stringify(expected.coveredExpectedManifestItemIds)
        || JSON.stringify(rec.physicalProducerIds) !== JSON.stringify(expected.physicalProducerIds)
        || JSON.stringify(rec.componentIds) !== JSON.stringify(expected.componentIds)) {
      fail('SOURCE_ROW_IDENTITY_MISMATCH', path, 'named aggregation, owner, covered manifest items, producers, components, and order must be exact');
    }
    uniqueStrings(rec.coveredExpectedManifestItemIds, `${path}.coveredExpectedManifestItemIds`, SEMANTIC_SOURCE_STREAM_IDS.length);
    const coveredStreamIds = rec.coveredExpectedManifestItemIds.map((id) => (
      typeof id === 'string' && id.startsWith('source:') ? id.slice('source:'.length) : null
    ));
    if (coveredStreamIds.length < 1 || coveredStreamIds.some((id) => !SEMANTIC_SOURCE_STREAM_IDS.includes(id))) {
      fail('SOURCE_STREAM_ID_INVALID', `${path}.coveredExpectedManifestItemIds`, 'source aggregation must bind one or more canonical release-manifest source items');
    }
    if (rec.sourceSchemaId !== 'SYSTEM_SUPERVISOR_SOURCE_AGGREGATION_SNAPSHOT' || rec.sourceSchemaVersion !== 1) fail('SOURCE_ROW_SOURCE_MISMATCH', path, 'source rows must preserve supervisor source aggregation provenance');
    text(rec.freshnessLawId, `${path}.freshnessLawId`, 160);
    nonNegativeInteger(rec.maximumMessageAgeMs, `${path}.maximumMessageAgeMs`);
    if (rec.maximumMessageAgeMs < 1) fail('SOURCE_FRESHNESS_LAW_INVALID', `${path}.maximumMessageAgeMs`, 'source maximum message age must be positive');
    text(rec.coherenceLawId, `${path}.coherenceLawId`, 160);
    if (rec.acceptedReleaseSha !== COCKPIT_RELEASE_MANIFEST_LAW.acceptedReleaseSha
        || rec.runningReleaseSha !== COCKPIT_RELEASE_MANIFEST_LAW.acceptedReleaseSha) fail('SOURCE_ROW_RELEASE_MISMATCH', path, 'source release provenance must match');
    enumValue(rec.connectionState, new Set(SOURCE_CONNECTION_VALUE_ENUM), `${path}.connectionState`);
    for (const key of ['lastMessageAgeMs', 'sequenceGapCount', 'coverageExpectedCount', 'coverageCurrentCount', 'quietSymbolCount']) {
      if (rec[key] !== null) nonNegativeInteger(rec[key], `${path}.${key}`);
    }
    uniqueStrings(rec.quietSymbolIds, `${path}.quietSymbolIds`, 1_000);
    if (rec.quietSymbolCount !== null && rec.quietSymbolIds.length !== rec.quietSymbolCount) fail('SOURCE_ROW_VALUE_INVALID', path, 'quiet-symbol identities must exactly match the count');
    if (rec.coverageExpectedCount !== null && rec.coverageCurrentCount !== null
        && (rec.coverageCurrentCount > rec.coverageExpectedCount
          || (rec.quietSymbolCount !== null && rec.quietSymbolCount > rec.coverageExpectedCount))) {
      fail('SOURCE_ROW_VALUE_INVALID', path, 'coverage and quiet-symbol counts must remain within the expected source universe');
    }
    enumValue(rec.rateLimitBackoffState, new Set(['CLEAR', 'BACKING_OFF', 'RATE_LIMITED', 'UNKNOWN']), `${path}.rateLimitBackoffState`);
    enumValue(rec.renderTruthLabel, RENDER_TRUTH_LABELS, `${path}.renderTruthLabel`);
    const sourceReasonSemantic = FACT_SEMANTIC_LAW['PANEL_DASHBOARD_TRUTH_V1\u0000degradedSourceReasons'];
    if (JSON.stringify(rec.reasonVocabularyBinding) !== JSON.stringify(sourceReasonSemantic.reasonVocabularyBinding)) fail('OWNER_REASON_VOCABULARY_BINDING_MISMATCH', `${path}.reasonVocabularyBinding`, 'source domain reasons must bind the runtime owner vocabulary');
    if (!Array.isArray(rec.domainReasonCodes)) fail('DOMAIN_REASON_CODE_SET_INVALID', `${path}.domainReasonCodes`, 'source domain reasons must be an array');
    if (rec.domainReasonCodes.length > 0) validateDomainReasonValue(rec.domainReasonCodes, sourceReasonSemantic, `${path}.domainReasonCodes`);
    nullableText(rec.projectionCauseCode, `${path}.projectionCauseCode`, 160);
    if (rec.projectionCauseCode !== null && !PACKET_REASON_CODE_SET.has(rec.projectionCauseCode)) fail('REASON_CODE_NOT_REGISTERED', `${path}.projectionCauseCode`, 'source projection cause must be packet-owned and registered');
    const units = closed(rec.units, [
      'lastMessageAgeMs', 'sequenceGapCount', 'coverageExpectedCount',
      'coverageCurrentCount', 'quietSymbolCount',
    ], `${path}.units`);
    const expectedUnits = { lastMessageAgeMs: 'MILLISECONDS', sequenceGapCount: 'COUNT', coverageExpectedCount: 'COUNT', coverageCurrentCount: 'COUNT', quietSymbolCount: 'COUNT' };
    for (const [key, unit] of Object.entries(expectedUnits)) if (units[key] !== unit) fail('SOURCE_ROW_UNIT_MISMATCH', `${path}.units.${key}`, `expected ${unit}`);
    text(rec.publisherDrilldownRef, `${path}.publisherDrilldownRef`, 240);
    uniqueStrings(rec.producerDrilldownRefs, `${path}.producerDrilldownRefs`, 16);
    uniqueStrings(rec.componentDrilldownRefs, `${path}.componentDrilldownRefs`, 16);
    if (rec.publisherDrilldownRef !== `source-aggregation:${rec.sourceAggregationId}:publisher`
        || JSON.stringify(rec.producerDrilldownRefs) !== JSON.stringify(rec.physicalProducerIds.map((id) => `producer:${id}`))
        || JSON.stringify(rec.componentDrilldownRefs) !== JSON.stringify(rec.componentIds.map((id) => `component:${id}`))) {
      fail('SOURCE_ROW_DRILLDOWN_MISMATCH', path, 'publisher, producer, and component drill-downs must retain exact source identities');
    }
    for (const key of ['incidentRef', 'traceRef', 'evidenceRef']) text(rec[key], `${path}.${key}`, 240);
    const measurementsKnown = ['lastMessageAgeMs', 'sequenceGapCount', 'coverageExpectedCount', 'coverageCurrentCount', 'quietSymbolCount']
      .every((key) => rec[key] !== null);
    const healthy = rec.connectionState === 'CONNECTED' && rec.lastMessageAgeMs !== null
      && rec.lastMessageAgeMs <= rec.maximumMessageAgeMs
      && rec.sequenceGapCount === 0 && rec.rateLimitBackoffState === 'CLEAR'
      && rec.coverageExpectedCount > 0 && rec.coverageCurrentCount === rec.coverageExpectedCount
      && rec.renderTruthLabel === 'LIVE';
    if (healthy && rec.projectionCauseCode !== null) fail('SOURCE_ROW_CAUSE_MISMATCH', `${path}.projectionCauseCode`, 'healthy source forbids a decorative cause');
    if (!healthy && rec.projectionCauseCode === null) fail('SOURCE_ROW_CAUSE_MISMATCH', `${path}.projectionCauseCode`, 'degraded source requires a packet projection cause');
    if (rec.renderTruthLabel === 'LIVE' && (!measurementsKnown || !healthy)) fail('ROW_GREEN_CONTRADICTION', path, 'LIVE source aggregation requires complete current measurements and full expected coverage');
    if (measurementsKnown) {
      coverageExpected += rec.coverageExpectedCount;
      coverageCurrent += rec.coverageCurrentCount;
      quietSymbols += rec.quietSymbolCount;
      sequenceGaps += rec.sequenceGapCount;
      oldestAge = oldestAge === null ? rec.lastMessageAgeMs : Math.max(oldestAge, rec.lastMessageAgeMs);
    }
    for (const symbol of rec.quietSymbolIds) allQuietSymbolIds.add(symbol);
    streamIds.push(...coveredStreamIds);
    connectionStates.add(rec.connectionState);
    backoffStates.add(rec.rateLimitBackoffState);
    if (!healthy) degradedRows.push(rec);
    const missingRow = rec.connectionState === 'MISSING' || rec.renderTruthLabel === 'MISSING';
    const unknownRow = !missingRow && (!measurementsKnown || rec.connectionState === 'UNKNOWN'
      || rec.renderTruthLabel === 'UNKNOWN' || rec.renderTruthLabel === 'UNAVAILABLE');
    if (missingRow) {
      missing += 1;
      missingStreamCount += rec.coveredExpectedManifestItemIds.length;
    } else if (unknownRow) {
      unknown += 1;
      unknownStreamCount += rec.coveredExpectedManifestItemIds.length;
    }
  });
  if (streamIds.length !== SEMANTIC_SOURCE_STREAM_IDS.length
      || new Set(streamIds).size !== SEMANTIC_SOURCE_STREAM_IDS.length
      || [...new Set(streamIds)].sort(compareCodePoints).some((id, index) => id !== [...SEMANTIC_SOURCE_STREAM_IDS].sort(compareCodePoints)[index])) {
    fail('SOURCE_STREAM_COVERAGE_MISMATCH', '$.sourceRows', 'four aggregations must exactly cover all seven canonical semantic streams once');
  }
  if (denominator.expectedCount !== SEMANTIC_SOURCE_STREAM_IDS.length
      || denominator.coveredCount !== SEMANTIC_SOURCE_STREAM_IDS.length - missingStreamCount - unknownStreamCount
      || denominator.missingCount !== missingStreamCount || denominator.unknownCount !== unknownStreamCount) {
    fail('SOURCE_DENOMINATOR_MISMATCH', '$.sourceDenominator', 'semantic stream denominator must exactly partition seven release-bound streams');
  }
  if (aggregationDenominator.expectedCount !== SOURCE_ROW_CATALOG.length || aggregationDenominator.rowCount !== root.sourceRows.length
      || aggregationDenominator.visibleCount !== SOURCE_ROW_CATALOG.length || aggregationDenominator.filteredCount !== 0
      || aggregationDenominator.hiddenCount !== 0 || aggregationDenominator.missingCount !== missing
      || aggregationDenominator.unknownCount !== unknown) fail('SOURCE_DENOMINATOR_MISMATCH', '$.sourceAggregationDenominator', 'named aggregation denominator must exactly expose all four rows');
  const knownMeasurements = root.sourceRows.every((row) => ['lastMessageAgeMs', 'sequenceGapCount', 'coverageExpectedCount', 'coverageCurrentCount', 'quietSymbolCount'].every((key) => row[key] !== null));
  const aggregatePairs = [
    ['dataSourceCoverageExpectedCount', knownMeasurements ? coverageExpected : null],
    ['dataSourceCoverageCurrentCount', knownMeasurements ? coverageCurrent : null],
    ['quietSymbolCount', knownMeasurements ? allQuietSymbolIds.size : null],
    ['dataSourceSequenceGapCount', knownMeasurements ? sequenceGaps : null],
    ['oldestDataSourceMessageAgeMs', knownMeasurements ? oldestAge : null],
    ['degradedSourceCount', degradedRows.length],
  ];
  for (const [key, expected] of aggregatePairs) {
    const fact = valuesByKey.get(key);
    if (fact?.value !== expected || (expected === null && fact?.valueState !== 'UNKNOWN')) fail('SOURCE_AGGREGATE_MISMATCH', `$.values.${key}`, 'Dashboard source aggregate must equal its exact source rows without collapsing unknown to zero');
  }
  const expectedConnections = [...connectionStates].sort(compareCodePoints);
  const expectedDegradedIds = degradedRows.map((row) => row.sourceAggregationId).sort(compareCodePoints);
  const sourceVocabularyMounted = sourceReasonVocabularyMounted();
  const expectedDegradedReasons = degradedRows.length > 0 && !sourceVocabularyMounted
    ? null
    : [...new Set(degradedRows.flatMap((row) => row.domainReasonCodes))].sort(compareCodePoints);
  const healthState = degradedRows.length === 0 ? 'READY'
    : degradedRows.some((row) => ['DISCONNECTED', 'MISSING', 'NOT_CONFIGURED'].includes(row.connectionState)) ? 'BLOCKED'
      : unknown > 0 ? 'UNKNOWN' : 'DEGRADED';
  const backoffState = backoffStates.has('RATE_LIMITED') ? 'RATE_LIMITED'
    : backoffStates.has('BACKING_OFF') ? 'BACKING_OFF'
      : backoffStates.has('UNKNOWN') ? 'UNKNOWN' : 'CLEAR';
  const structuredAggregates = [
    ['dataSourceConnectionStates', expectedConnections],
    ['degradedSourceIdentities', expectedDegradedIds],
    ['degradedSourceReasons', expectedDegradedReasons],
    ['dataSourceHealthState', healthState],
    ['dataSourceRateLimitBackoffState', backoffState],
  ];
  for (const [key, expected] of structuredAggregates) {
    const fact = valuesByKey.get(key);
    if (JSON.stringify(fact?.value) !== JSON.stringify(expected)
        || (key === 'degradedSourceReasons' && expected === null
          && (fact?.valueState !== 'UNKNOWN' || fact?.unknownReasonCode !== 'OWNER_REASON_VOCABULARY_UNMOUNTED'))) {
      fail('SOURCE_AGGREGATE_MISMATCH', `$.values.${key}`, 'Dashboard source posture facts must exactly derive from named aggregation rows');
    }
  }
  if (root.requestedDisplayState === 'GREEN' && degradedRows.length > 0) fail('ROW_GREEN_CONTRADICTION', '$.sourceRows', 'GREEN Dashboard cannot contain a degraded source aggregation');
}

function sourceReasonVocabularyMounted() {
  return DOMAIN_REASON_VOCABULARIES_BY_ID.get('INTELLIGENCE_RUNTIME_SOURCE_REASON_V1')?.bindingState === 'MOUNTED';
}

function validateAttentionRows(root, valuesByKey) {
  if (root.contractId !== 'PANEL_DASHBOARD_TRUTH_V1') {
    if (root.attentionDenominator !== null || !Array.isArray(root.attentionRows) || root.attentionRows.length !== 0) fail('ORPHAN_ATTENTION_ROWS', '$.attentionRows', 'only Dashboard may carry attention rows');
    return;
  }
  const denominator = closed(root.attentionDenominator, [
    'expectedCount', 'rowCount', 'visibleCount', 'filteredCount', 'hiddenCount', 'unknownCount',
  ], '$.attentionDenominator');
  for (const key of ['expectedCount', 'rowCount', 'visibleCount', 'filteredCount', 'hiddenCount', 'unknownCount']) nonNegativeInteger(denominator[key], `$.attentionDenominator.${key}`);
  if (!Array.isArray(root.attentionRows) || root.attentionRows.length > 64) fail('ATTENTION_ROWS_UNBOUNDED', '$.attentionRows', 'at most 64 attention rows are allowed');
  const ids = new Set();
  const severityOrder = new Map([['CRITICAL', 0], ['HIGH', 1], ['MEDIUM', 2], ['LOW', 3]]);
  let nonExposedSeen = false;
  let previousSeverity = -1;
  root.attentionRows.forEach((row, index) => {
    const path = `$.attentionRows[${index}]`;
    const rec = closed(row, [
      'attentionId', 'rank', 'capitalExposed', 'unresolvedLiability', 'severity',
      'reasonCodes', 'reasonVocabularyBinding', 'resolvingControlId',
      'subjectKind', 'subjectId', 'incidentRef', 'traceRef', 'evidenceRef',
    ], path);
    text(rec.attentionId, `${path}.attentionId`, 160);
    if (ids.has(rec.attentionId)) fail('DUPLICATE_ATTENTION_ROW', `${path}.attentionId`, 'attention identity must be unique');
    ids.add(rec.attentionId);
    if (rec.rank !== index + 1) fail('ATTENTION_RANK_INVALID', `${path}.rank`, 'attention ranks must be contiguous and ordered');
    if (typeof rec.capitalExposed !== 'boolean') fail('BOOLEAN_REQUIRED', `${path}.capitalExposed`, 'expected boolean');
    if (typeof rec.unresolvedLiability !== 'boolean') fail('BOOLEAN_REQUIRED', `${path}.unresolvedLiability`, 'expected boolean');
    enumValue(rec.severity, new Set(severityOrder.keys()), `${path}.severity`);
    const reasonSemantic = FACT_SEMANTIC_LAW['PANEL_DASHBOARD_TRUTH_V1\u0000topAttentionReason'];
    if (JSON.stringify(rec.reasonVocabularyBinding) !== JSON.stringify(reasonSemantic.reasonVocabularyBinding)) fail('OWNER_REASON_VOCABULARY_BINDING_MISMATCH', `${path}.reasonVocabularyBinding`, 'attention reasons must retain the supervisor owner binding');
    if (!Array.isArray(rec.reasonCodes) || rec.reasonCodes.length < 1) fail('DOMAIN_REASON_CODE_SET_INVALID', `${path}.reasonCodes`, 'attention row needs at least one owner reason');
    validateDomainReasonValue(rec.reasonCodes, reasonSemantic, `${path}.reasonCodes`);
    enumValue(rec.resolvingControlId, new Set(Object.keys(CONTROL_CONTRACT_LAW)), `${path}.resolvingControlId`);
    enumValue(rec.subjectKind, new Set(['COMPONENT', 'CANDIDATE', 'DECISION', 'PLAN', 'INCIDENT']), `${path}.subjectKind`);
    text(rec.subjectId, `${path}.subjectId`, 180);
    for (const key of ['incidentRef', 'traceRef', 'evidenceRef']) text(rec[key], `${path}.${key}`, 240);
    if (!rec.capitalExposed) nonExposedSeen = true;
    else if (nonExposedSeen) fail('ATTENTION_EXPOSURE_ORDER_INVALID', path, 'capital-exposed attention must rank before unexposed attention');
    const currentSeverity = severityOrder.get(rec.severity);
    if (index > 0 && currentSeverity < previousSeverity && root.attentionRows[index - 1].capitalExposed === rec.capitalExposed) {
      fail('ATTENTION_SEVERITY_ORDER_INVALID', path, 'severity must not increase within the same exposure class');
    }
    previousSeverity = currentSeverity;
    if (index > 0) {
      const prior = root.attentionRows[index - 1];
      if (prior.capitalExposed === rec.capitalExposed && prior.severity === rec.severity
          && prior.attentionId >= rec.attentionId) fail('ATTENTION_TIEBREAK_ORDER_INVALID', path, 'equal exposure/severity rows must be code-point ordered by stable identity');
    }
  });
  if (denominator.expectedCount !== root.attentionRows.length || denominator.rowCount !== root.attentionRows.length
      || denominator.visibleCount !== root.attentionRows.length || denominator.filteredCount !== 0
      || denominator.hiddenCount !== 0 || denominator.unknownCount !== 0
      || valuesByKey.get('attentionQueueCount')?.value !== root.attentionRows.length) fail('ATTENTION_COUNT_MISMATCH', '$.attentionDenominator', 'attention count must equal the complete ranked row set');
  const rankedState = root.attentionRows.length === 0 ? 'EMPTY' : 'RANKED';
  if (valuesByKey.get('attentionQueueRankedState')?.value !== rankedState) fail('ATTENTION_AGGREGATE_MISMATCH', '$.values.attentionQueueRankedState', 'attention ranked state must match rows');
  const first = root.attentionRows[0];
  const topPriority = first ? ({ CRITICAL: 'P0', HIGH: 'P1', MEDIUM: 'P2', LOW: 'P3' })[first.severity] : null;
  const topReason = first?.reasonCodes ?? [];
  const topControl = first?.resolvingControlId ?? null;
  if (valuesByKey.get('topAttentionPriority')?.value !== topPriority
      || JSON.stringify(valuesByKey.get('topAttentionReason')?.value) !== JSON.stringify(topReason)
      || valuesByKey.get('topAttentionResolvingControl')?.value !== topControl) {
    fail('ATTENTION_AGGREGATE_MISMATCH', '$.values', 'top attention facts must equal rank one or canonical absence');
  }
  if (valuesByKey.get('activeExposureCount')?.value > 0 && !root.attentionRows.some((row) => row.capitalExposed)) fail('EXPOSED_CAPITAL_ATTENTION_MISSING', '$.attentionRows', 'active exposure requires an exposed-capital attention item');
  if (valuesByKey.get('activeLiabilityCount')?.value > 0 && !root.attentionRows.some((row) => row.unresolvedLiability)) fail('UNRESOLVED_LIABILITY_ATTENTION_MISSING', '$.attentionRows', 'active liability requires a liability attention item');
}

function validateTraceTargets(root, valuesByKey) {
  if (root.contractId !== 'PANEL_DASHBOARD_TRUTH_V1') {
    if (root.traceDenominator !== null || !Array.isArray(root.traceTargets) || root.traceTargets.length !== 0) fail('ORPHAN_TRACE_TARGETS', '$.traceTargets', 'only Dashboard may carry trace targets');
    return;
  }
  const denominator = closed(root.traceDenominator, [
    'expectedCount', 'rowCount', 'visibleCount', 'filteredCount', 'hiddenCount',
    'unknownCount', 'availabilityState', 'absenceReasonCode',
  ], '$.traceDenominator');
  for (const key of ['expectedCount', 'rowCount', 'visibleCount', 'filteredCount', 'hiddenCount', 'unknownCount']) nonNegativeInteger(denominator[key], `$.traceDenominator.${key}`);
  enumValue(denominator.availabilityState, new Set(['COMPLETE', 'UNAVAILABLE']), '$.traceDenominator.availabilityState');
  nullableText(denominator.absenceReasonCode, '$.traceDenominator.absenceReasonCode', 160);
  if (!Array.isArray(root.traceTargets) || root.traceTargets.length > 64) fail('TRACE_TARGET_COVERAGE_MISMATCH', '$.traceTargets', 'trace targets must be bounded');
  if (root.traceTargets.length === 0) {
    if (denominator.expectedCount !== 0 || denominator.rowCount !== 0 || denominator.visibleCount !== 0
        || denominator.filteredCount !== 0 || denominator.hiddenCount !== 0 || denominator.unknownCount !== 0
        || denominator.availabilityState !== 'UNAVAILABLE' || denominator.absenceReasonCode === null
        || !PACKET_REASON_CODE_SET.has(denominator.absenceReasonCode)
        || valuesByKey.get('traceTargetCount')?.value !== 0) {
      fail('TRACE_TARGET_COVERAGE_MISMATCH', '$.traceDenominator', 'empty trace availability requires an explicit packet cause and exact zero denominator');
    }
    return;
  }
  if (denominator.expectedCount !== root.traceTargets.length || denominator.rowCount !== root.traceTargets.length
      || denominator.visibleCount !== root.traceTargets.length || denominator.filteredCount !== 0
      || denominator.hiddenCount !== 0 || denominator.unknownCount !== 0
      || denominator.availabilityState !== 'COMPLETE' || denominator.absenceReasonCode !== null) {
    fail('TRACE_TARGET_COVERAGE_MISMATCH', '$.traceDenominator', 'available trace denominator must exactly expose every target');
  }
  const identities = new Set();
  const kinds = new Set();
  const stageKeys = ['EVIDENCE', 'ASSESSMENT', 'DECISION', 'CAPITAL', 'RISK', 'PLAN', 'RECONCILIATION', 'LEDGER'];
  root.traceTargets.forEach((row, index) => {
    const path = `$.traceTargets[${index}]`;
    const rec = closed(row, [
      'targetKind', 'subjectId', 'symbol', 'correlationId', 'evidenceRevision',
      'disposition', 'dispositionReasonCodes', 'reasonVocabularyBinding', 'stages',
    ], path);
    enumValue(rec.targetKind, new Set(['CANDIDATE', 'DECISION', 'PLAN']), `${path}.targetKind`);
    text(rec.subjectId, `${path}.subjectId`, 180);
    nullableText(rec.symbol, `${path}.symbol`, 80);
    text(rec.correlationId, `${path}.correlationId`, 180);
    text(rec.evidenceRevision, `${path}.evidenceRevision`, 180);
    nullableText(rec.disposition, `${path}.disposition`, 80);
    if (!Array.isArray(rec.dispositionReasonCodes)) fail('DOMAIN_REASON_CODE_SET_INVALID', `${path}.dispositionReasonCodes`, 'candidate reason envelope must be an array');
    const identity = `${rec.targetKind}\u0000${rec.subjectId}`;
    if (identities.has(identity)) fail('DUPLICATE_TRACE_TARGET', path, 'trace target identity must be unique');
    identities.add(identity);
    kinds.add(rec.targetKind);
    if (rec.targetKind === 'CANDIDATE') {
      enumValue(rec.disposition, new Set(['ACCEPTED', 'REJECTED', 'ABSTAINED', 'UNKNOWN']), `${path}.disposition`);
      const semantic = FACT_SEMANTIC_LAW['PANEL_DASHBOARD_TRUTH_V1\u0000newestCandidateDispositionReason'];
      if (JSON.stringify(rec.reasonVocabularyBinding) !== JSON.stringify(semantic.reasonVocabularyBinding)) fail('OWNER_REASON_VOCABULARY_BINDING_MISMATCH', `${path}.reasonVocabularyBinding`, 'candidate reasons must retain the canonical opportunity owner binding');
      if (rec.disposition === 'ACCEPTED' && rec.dispositionReasonCodes.length !== 0) fail('CANDIDATE_REASON_CONTRADICTION', `${path}.dispositionReasonCodes`, 'accepted candidate requires a known-empty rejection-reason set');
      if (rec.disposition !== 'ACCEPTED' && rec.dispositionReasonCodes.length === 0) fail('CANDIDATE_REASON_CONTRADICTION', `${path}.dispositionReasonCodes`, 'non-accepted candidate requires at least one owner reason');
      if (rec.dispositionReasonCodes.length > 0) validateDomainReasonValue(rec.dispositionReasonCodes, semantic, `${path}.dispositionReasonCodes`);
      text(rec.symbol, `${path}.symbol`, 80);
    } else if (rec.disposition !== null || rec.dispositionReasonCodes.length !== 0 || rec.reasonVocabularyBinding !== null || rec.symbol !== null) {
      fail('TRACE_TARGET_KIND_MISMATCH', path, 'decision and plan targets cannot smuggle candidate-only facts');
    }
    if (!Array.isArray(rec.stages) || rec.stages.length !== stageKeys.length) fail('TRACE_STAGE_ORDER_INVALID', `${path}.stages`, 'exact eight-stage trace chain is required');
    rec.stages.forEach((stage, stageIndex) => {
      const stagePath = `${path}.stages[${stageIndex}]`;
      const item = closed(stage, ['stage', 'state', 'reference', 'reasonCode', 'evidenceRef'], stagePath);
      if (item.stage !== stageKeys[stageIndex]) fail('TRACE_STAGE_ORDER_INVALID', `${stagePath}.stage`, 'trace stages must preserve canonical order');
      enumValue(item.state, new Set(['PRESENT', 'MISSING', 'UNKNOWN', 'UNAVAILABLE', 'NOT_APPLICABLE']), `${stagePath}.state`);
      nullableText(item.reference, `${stagePath}.reference`, 240);
      nullableText(item.reasonCode, `${stagePath}.reasonCode`, 160);
      text(item.evidenceRef, `${stagePath}.evidenceRef`, 240);
      if (item.state === 'PRESENT') {
        if (item.reference === null || item.reasonCode !== null) fail('TRACE_STAGE_EVIDENCE_INVALID', stagePath, 'present stage requires reference and forbids an absence reason');
      } else if (item.reference !== null || item.reasonCode === null || !PACKET_REASON_CODE_SET.has(item.reasonCode)) {
        fail('TRACE_STAGE_EVIDENCE_INVALID', stagePath, 'non-present stage requires null reference, registered packet cause, and evidence');
      }
    });
  });
  for (const kind of ['CANDIDATE', 'DECISION', 'PLAN']) if (!kinds.has(kind)) fail('TRACE_TARGET_COVERAGE_MISMATCH', '$.traceTargets', `missing ${kind}`);
  if (valuesByKey.get('traceTargetCount')?.value !== root.traceTargets.length) fail('TRACE_TARGET_COUNT_MISMATCH', '$.values.traceTargetCount', 'trace target count must equal the complete target set');
  const candidate = root.traceTargets.find((target) => target.targetKind === 'CANDIDATE'
    && target.subjectId === valuesByKey.get('newestCandidateId')?.value);
  if (!candidate || candidate.symbol !== valuesByKey.get('newestCandidateSymbol')?.value
      || candidate.evidenceRevision !== valuesByKey.get('newestCandidateEvidenceRevision')?.value
      || candidate.correlationId !== valuesByKey.get('dashboardCorrelationChainId')?.value
      || candidate.disposition !== valuesByKey.get('newestCandidateDisposition')?.value
      || JSON.stringify(candidate.dispositionReasonCodes) !== JSON.stringify(valuesByKey.get('newestCandidateDispositionReason')?.value)) {
    fail('NEWEST_CANDIDATE_TRACE_MISMATCH', '$.traceTargets', 'newest candidate identity, symbol, evidence revision, correlation, disposition, and reason must share one trace target');
  }
}

function validateStateCauseEvidence(root) {
  if (root.requestedDisplayState === 'GREEN') {
    if (root.stateCauseEvidence !== null) fail('NON_GREEN_CAUSE_EVIDENCE_INVALID', '$.stateCauseEvidence', 'GREEN forbids a decorative non-green cause');
    return;
  }
  const cause = closed(root.stateCauseEvidence, ['state', 'causeCode', 'subjectId', 'evidenceRef', 'observedAtMs'], '$.stateCauseEvidence');
  if (cause.state !== root.requestedDisplayState) fail('NON_GREEN_CAUSE_EVIDENCE_INVALID', '$.stateCauseEvidence.state', 'cause state must match requested display state');
  if (!PACKET_REASON_CODE_SET.has(cause.causeCode)
      || ['DEGRADED_REASON_PRESENT', 'BLOCKING_REASON_PRESENT'].includes(cause.causeCode)) {
    fail('NON_GREEN_CAUSE_EVIDENCE_REQUIRED', '$.stateCauseEvidence.causeCode', 'non-green state requires an actual registered cause, not a marker');
  }
  text(cause.subjectId, '$.stateCauseEvidence.subjectId', 180);
  text(cause.evidenceRef, '$.stateCauseEvidence.evidenceRef', 240);
  utcMsOrNull(cause.observedAtMs, '$.stateCauseEvidence.observedAtMs');
  if (cause.observedAtMs === null || !root.reasonCodes.includes(cause.causeCode)) {
    fail('NON_GREEN_CAUSE_EVIDENCE_REQUIRED', '$.stateCauseEvidence', 'cause evidence must be timestamped and included in observation reasons');
  }
  if (cause.observedAtMs > root.evidence.observedAtMs) {
    fail('NON_GREEN_CAUSE_EVIDENCE_TIME_INVALID', '$.stateCauseEvidence.observedAtMs', 'cause evidence cannot postdate the panel observation');
  }
}

function canonicalExactDecimal(value, signed, constraints) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return false;
  const pattern = signed ? /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/ : /^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/;
  if (!pattern.test(value) || value === '-0') return false;
  const digitCount = [...value].filter((char) => char >= '0' && char <= '9').length;
  if (digitCount > constraints.maximumTotalDigits) return false;
  if (constraints.minimum !== undefined && compareCanonicalDecimals(value, constraints.minimum) < 0) return false;
  if (constraints.maximum !== undefined && compareCanonicalDecimals(value, constraints.maximum) > 0) return false;
  return true;
}

function decimalParts(value) {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  return { negative, coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function compareCanonicalDecimals(left, right) {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.scale, b.scale);
  const av = (a.negative ? -a.coefficient : a.coefficient) * (10n ** BigInt(scale - a.scale));
  const bv = (b.negative ? -b.coefficient : b.coefficient) * (10n ** BigInt(scale - b.scale));
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function vocabularyAcceptsCode(vocabulary, code) {
  if (vocabulary.bindingState !== 'MOUNTED') return false;
  if (vocabulary.exactCodes.includes(code)) return true;
  if (vocabulary.matchKind === 'PATTERN') return new RegExp(vocabulary.codePattern).test(code);
  if (vocabulary.matchKind === 'EXACT_AND_PARAMETERIZED'
      && new RegExp(vocabulary.codePattern).test(code)
      && vocabulary.parameterizedPrefixes.some((prefix) => code.startsWith(prefix) && code.length > prefix.length)) return true;
  return false;
}

function validateDomainReasonValue(value, semantic, path) {
  const binding = semantic.reasonVocabularyBinding;
  const vocabulary = binding === null ? null : DOMAIN_REASON_VOCABULARIES_BY_ID.get(binding.vocabularyId);
  if (!vocabulary || vocabulary.ownerId !== binding.ownerId || vocabulary.revision !== binding.revision
      || vocabulary.sourceSha256 !== binding.sourceSha256 || vocabulary.bindingState !== binding.bindingState) {
    fail('OWNER_REASON_VOCABULARY_BINDING_MISMATCH', path, 'fact reason vocabulary binding is not the frozen owner source');
  }
  const codes = semantic.valueKind === 'DOMAIN_REASON_CODE_SET' ? value : [value];
  if (codes.length > vocabulary.maxSetItems || new Set(codes).size !== codes.length) {
    fail('DOMAIN_REASON_CODE_SET_INVALID', path, 'owner reason set must be bounded and unique');
  }
  for (const code of codes) {
    if (typeof code !== 'string' || !vocabularyAcceptsCode(vocabulary, code)) {
      const failure = vocabulary.bindingState === 'UNMOUNTED'
        ? 'OWNER_REASON_VOCABULARY_UNMOUNTED'
        : 'DOMAIN_REASON_CODE_NOT_REGISTERED';
      fail(failure, path, 'reason code is not accepted by its exact owner vocabulary');
    }
  }
  if (vocabulary.ordering === 'CODE_POINT_ASC') {
    const sorted = [...codes].sort(compareCodePoints);
    if (sorted.some((code, index) => code !== codes[index])) fail('DOMAIN_REASON_CODE_SET_ORDER_INVALID', path, 'owner reason set must be code-point sorted');
  }
  if (vocabulary.ordering === 'OWNER_ORDER' && vocabulary.exactCodes.length > 0) {
    const ranks = codes.map((code) => vocabulary.exactCodes.indexOf(code));
    if (ranks.some((rank, index) => index > 0 && rank <= ranks[index - 1])) fail('DOMAIN_REASON_CODE_SET_ORDER_INVALID', path, 'owner reason set must preserve owner vocabulary order');
  }
}

function validateFactValue(rec, semantic, path) {
  const setKind = ['IDENTITY_SET', 'ENUM_SET', 'PACKET_REASON_CODE_SET', 'DOMAIN_REASON_CODE_SET'].includes(semantic.valueKind);
  enumValue(rec.valueState, new Set(['KNOWN', 'KNOWN_ABSENT', 'UNKNOWN']), `${path}.valueState`);
  nullableText(rec.unknownReasonCode, `${path}.unknownReasonCode`, 160);
  if (rec.valueState === 'UNKNOWN') {
    if (rec.value !== null || rec.unknownReasonCode === null || !PACKET_REASON_CODE_SET.has(rec.unknownReasonCode)) {
      fail('UNKNOWN_VALUE_DISCIPLINE', path, 'UNKNOWN requires null plus one registered packet reason');
    }
    return;
  }
  if (rec.unknownReasonCode !== null) fail('UNKNOWN_VALUE_DISCIPLINE', path, 'known facts forbid an unknown reason');
  if (rec.valueState === 'KNOWN_ABSENT') {
    const scalarAbsence = rec.value === null && (
      semantic.valueKind === 'DOMAIN_REASON_CODE' || semantic.valueConstraints?.knownAbsenceAllowed === true
    );
    const setAbsence = setKind && Array.isArray(rec.value) && rec.value.length === 0;
    if (!scalarAbsence && !setAbsence) fail('KNOWN_ABSENCE_INVALID', path, 'known absence is legal only for declared nullable facts or empty sets');
    return;
  }
  if (rec.value === null || (setKind && (!Array.isArray(rec.value) || rec.value.length === 0))) {
    fail('FACT_VALUE_KIND_MISMATCH', `${path}.value`, `KNOWN requires a present ${semantic.valueKind} value`);
  }
  let kindMatches = false;
  if (semantic.valueKind === 'ENUM') kindMatches = typeof rec.value === 'string';
  else if (semantic.valueKind === 'TEXT') kindMatches = typeof rec.value === 'string' && rec.value.length > 0;
  else if (semantic.valueKind === 'BOOLEAN') kindMatches = typeof rec.value === 'boolean';
  else if (semantic.valueKind === 'NON_NEGATIVE_INTEGER') {
    kindMatches = Number.isSafeInteger(rec.value) && rec.value >= 0 && rec.value <= 1_000_000_000;
  } else if (semantic.valueKind === 'UTC_MILLISECONDS') {
    kindMatches = Number.isSafeInteger(rec.value) && rec.value >= 0 && rec.value <= 4_102_444_800_000;
  } else if (semantic.valueKind === 'FINITE_NUMBER') {
    kindMatches = typeof rec.value === 'number' && Number.isFinite(rec.value)
      && rec.value >= semantic.valueConstraints.minimum && rec.value <= semantic.valueConstraints.maximum;
  } else if (semantic.valueKind === 'NON_NEGATIVE_DECIMAL_STRING') {
    kindMatches = canonicalExactDecimal(rec.value, false, semantic.valueConstraints);
  } else if (semantic.valueKind === 'SIGNED_DECIMAL_STRING') {
    kindMatches = canonicalExactDecimal(rec.value, true, semantic.valueConstraints);
  } else if (semantic.valueKind === 'IDENTITY_SET') {
    kindMatches = Array.isArray(rec.value) && rec.value.length <= 128
      && rec.value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 180)
      && new Set(rec.value).size === rec.value.length
      && [...rec.value].sort(compareCodePoints).every((item, index) => item === rec.value[index]);
  } else if (semantic.valueKind === 'ENUM_SET') {
    kindMatches = Array.isArray(rec.value) && rec.value.length <= semantic.enumValues.length
      && rec.value.every((item) => semantic.enumValues.includes(item))
      && new Set(rec.value).size === rec.value.length
      && [...rec.value].sort(compareCodePoints).every((item, index) => item === rec.value[index]);
  } else if (semantic.valueKind === 'PACKET_REASON_CODE_SET') {
    kindMatches = Array.isArray(rec.value) && rec.value.length <= 64
      && rec.value.every((item) => PACKET_REASON_CODE_SET.has(item))
      && new Set(rec.value).size === rec.value.length
      && [...rec.value].sort(compareCodePoints).every((item, index) => item === rec.value[index]);
  } else if (semantic.valueKind === 'DOMAIN_REASON_CODE') {
    kindMatches = typeof rec.value === 'string';
    if (kindMatches) validateDomainReasonValue(rec.value, semantic, `${path}.value`);
  } else if (semantic.valueKind === 'DOMAIN_REASON_CODE_SET') {
    kindMatches = Array.isArray(rec.value) && rec.value.every((item) => typeof item === 'string');
    if (kindMatches) validateDomainReasonValue(rec.value, semantic, `${path}.value`);
  }
  if (!kindMatches) fail('FACT_VALUE_KIND_MISMATCH', `${path}.value`, `expected ${semantic.valueKind}`);
  if (semantic.valueKind === 'ENUM' && !semantic.enumValues.includes(rec.value)) {
    fail('FACT_VALUE_ENUM_INVALID', `${path}.value`, 'value is absent from the bounded fact vocabulary');
  }
}

export function validatePanelObservation(input) {
  const root = closed(input, [
    'schemaVersion', 'contractId', 'requestedDisplayState', 'sourceProvenance', 'truthAxes', 'denominator',
    'evidence', 'detectionEvidence', 'values', 'reasonCodes', 'controlState',
    'componentDenominator', 'componentFacts', 'sourceDenominator',
    'sourceAggregationDenominator', 'sourceRows', 'attentionDenominator',
    'attentionRows', 'traceDenominator', 'traceTargets', 'stateCauseEvidence',
  ], '$');
  if (root.schemaVersion !== COCKPIT_SCHEMA_VERSION) fail('SCHEMA_VERSION_INVALID', '$.schemaVersion', 'unsupported observation version');
  text(root.contractId, '$.contractId', 120);
  enumValue(root.requestedDisplayState, new Set(DISPLAY_STATES), '$.requestedDisplayState');
  const provenance = closed(root.sourceProvenance, [
    'canonicalOwner', 'sourceSchemaId', 'sourceSchemaVersion', 'supervisorSnapshotRevision',
    'manifestId', 'manifestRevision', 'manifestSha256', 'manifestItemId',
    'acceptedReleaseSha', 'runningReleaseSha', 'manifestEvaluationResult',
  ], '$.sourceProvenance');
  text(provenance.canonicalOwner, '$.sourceProvenance.canonicalOwner', 120);
  text(provenance.sourceSchemaId, '$.sourceProvenance.sourceSchemaId', 180);
  if (!Number.isSafeInteger(provenance.sourceSchemaVersion) || provenance.sourceSchemaVersion < 1) fail('SCHEMA_VERSION_INVALID', '$.sourceProvenance.sourceSchemaVersion', 'expected positive schema version');
  nonNegativeInteger(provenance.supervisorSnapshotRevision, '$.sourceProvenance.supervisorSnapshotRevision');
  text(provenance.manifestId, '$.sourceProvenance.manifestId', 180);
  if (!Number.isSafeInteger(provenance.manifestRevision) || provenance.manifestRevision < 1) {
    fail('MANIFEST_REVISION_INVALID', '$.sourceProvenance.manifestRevision', 'expected a positive manifest revision');
  }
  if (typeof provenance.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(provenance.manifestSha256)) fail('SHA_INVALID', '$.sourceProvenance.manifestSha256', 'expected lowercase SHA-256');
  text(provenance.manifestItemId, '$.sourceProvenance.manifestItemId', 240);
  for (const key of ['acceptedReleaseSha', 'runningReleaseSha']) {
    if (typeof provenance[key] !== 'string' || !/^[a-f0-9]{40}$/.test(provenance[key])) fail('SHA_INVALID', `$.sourceProvenance.${key}`, 'expected lowercase Git SHA');
  }
  enumValue(provenance.manifestEvaluationResult, new Set(['MATCH', 'MISMATCH', 'UNKNOWN']), '$.sourceProvenance.manifestEvaluationResult');
  const axes = closed(root.truthAxes, [
    'supportState', 'configurationState', 'discovered', 'instrumented', 'telemetrySilent',
    'freshnessState', 'coherenceState', 'safeMode', 'releaseStatuses', 'truthLabel',
    'readiness', 'authority', 'completeness', 'dataMode', 'independentProbeRequired',
    'independentProbePassing',
  ], '$.truthAxes');
  for (const key of ['discovered', 'instrumented', 'telemetrySilent', 'independentProbePassing']) boolOrNull(axes[key], `$.truthAxes.${key}`);
  enumValue(axes.supportState, new Set(['SUPPORTED', 'UNSUPPORTED', 'UNKNOWN']), '$.truthAxes.supportState');
  enumValue(axes.configurationState, new Set(['CONFIGURED', 'NOT_CONFIGURED', 'UNKNOWN']), '$.truthAxes.configurationState');
  if (typeof axes.independentProbeRequired !== 'boolean') fail('BOOLEAN_REQUIRED', '$.truthAxes.independentProbeRequired', 'expected boolean');
  enumValue(axes.freshnessState, FRESHNESS_STATES, '$.truthAxes.freshnessState');
  enumValue(axes.coherenceState, COHERENCE_STATES, '$.truthAxes.coherenceState');
  enumValue(axes.safeMode, SAFE_MODES, '$.truthAxes.safeMode');
  if (!Array.isArray(axes.releaseStatuses) || axes.releaseStatuses.length > RELEASE_STATUSES.size || new Set(axes.releaseStatuses).size !== axes.releaseStatuses.length) fail('RELEASE_STATUSES_INVALID', '$.truthAxes.releaseStatuses', 'expected unique bounded release statuses');
  axes.releaseStatuses.forEach((value, index) => enumValue(value, RELEASE_STATUSES, `$.truthAxes.releaseStatuses[${index}]`));
  enumValue(axes.truthLabel, TRUTH_LABELS, '$.truthAxes.truthLabel');
  enumValue(axes.readiness, READINESS_STATES, '$.truthAxes.readiness');
  enumValue(axes.authority, AUTHORITIES, '$.truthAxes.authority');
  enumValue(axes.completeness, COMPLETENESS_STATES, '$.truthAxes.completeness');
  enumValue(axes.dataMode, DATA_MODES, '$.truthAxes.dataMode');

  const denominator = closed(root.denominator, ['expectedCount', 'visibleCount', 'filteredCount', 'hiddenCount', 'unknownCount'], '$.denominator');
  for (const key of Object.keys(denominator)) nonNegativeInteger(denominator[key], `$.denominator.${key}`);
  if (denominator.visibleCount + denominator.filteredCount + denominator.hiddenCount !== denominator.expectedCount) {
    fail('DENOMINATOR_INCOMPLETE', '$.denominator', 'visible + filtered + hidden must equal expected');
  }
  if (denominator.unknownCount > denominator.expectedCount) fail('DENOMINATOR_INCOMPLETE', '$.denominator.unknownCount', 'unknown cannot exceed expected');

  const evidence = closed(root.evidence, ['observedCount', 'observedAtMs', 'lastIndependentProofAtMs'], '$.evidence');
  nonNegativeInteger(evidence.observedCount, '$.evidence.observedCount');
  utcMsOrNull(evidence.observedAtMs, '$.evidence.observedAtMs');
  if (evidence.observedAtMs === null) fail('UTC_MILLIS_INVALID', '$.evidence.observedAtMs', 'evidence observation time is required');
  utcMsOrNull(evidence.lastIndependentProofAtMs, '$.evidence.lastIndependentProofAtMs');

  const detectionEvidence = closed(root.detectionEvidence, [
    'registeredFailureId', 'detectorConnected', 'telemetryConnected', 'browserConnected',
    'sloMatched', 'outOfBandProofPresent',
  ], '$.detectionEvidence');
  nullableText(detectionEvidence.registeredFailureId, '$.detectionEvidence.registeredFailureId', 180);
  for (const key of ['detectorConnected', 'telemetryConnected', 'browserConnected', 'sloMatched', 'outOfBandProofPresent']) {
    boolOrNull(detectionEvidence[key], `$.detectionEvidence.${key}`);
  }

  if (!Array.isArray(root.values) || root.values.length > 192) fail('VALUES_UNBOUNDED', '$.values', 'at most 192 values are allowed');
  const valueKeys = new Set();
  root.values.forEach((value, index) => {
    const path = `$.values[${index}]`;
    const rec = closed(value, ['key', 'value', 'valueState', 'unit', 'unknownReasonCode'], path);
    text(rec.key, `${path}.key`, 120);
    if (valueKeys.has(rec.key)) fail('DUPLICATE_VALUE', `${path}.key`, 'duplicate value key');
    valueKeys.add(rec.key);
    text(rec.unit, `${path}.unit`, 80);
    const semantic = FACT_SEMANTIC_LAW[`${root.contractId}\u0000${rec.key}`];
    if (!semantic) fail('FACT_VALUE_KEY_UNDECLARED', `${path}.key`, 'observation value is not declared by the immutable panel fact law');
    if (rec.unit !== semantic.unit) fail('FACT_VALUE_UNIT_MISMATCH', `${path}.unit`, `expected exact unit ${semantic.unit}`);
    validateFactValue(rec, semantic, path);
  });
  uniqueStrings(root.reasonCodes, '$.reasonCodes', 64);
  root.reasonCodes.forEach((reasonCode, index) => {
    if (!PACKET_REASON_CODE_SET.has(reasonCode)) {
      fail('REASON_CODE_NOT_REGISTERED', `$.reasonCodes[${index}]`, 'observation reason is absent from the frozen packet registry');
    }
  });
  if (root.controlState !== null) {
    const control = closed(root.controlState, [
      'available', 'unavailableReasonCode', 'backendMutationId', 'effectPreview', 'currentState',
      'previewState', 'confirmState', 'resultState', 'beforeRevision', 'afterRevision',
      'ledgerEvidenceRef', 'correlationId',
    ], '$.controlState');
    if (typeof control.available !== 'boolean') fail('BOOLEAN_REQUIRED', '$.controlState.available', 'expected boolean');
    nullableText(control.unavailableReasonCode, '$.controlState.unavailableReasonCode', 160);
    if (control.unavailableReasonCode !== null && !PACKET_REASON_CODE_SET.has(control.unavailableReasonCode)) {
      fail('REASON_CODE_NOT_REGISTERED', '$.controlState.unavailableReasonCode', 'control reason is absent from the frozen packet registry');
    }
    text(control.backendMutationId, '$.controlState.backendMutationId', 200);
    if (control.effectPreview !== null) {
      const effect = closed(control.effectPreview, ['effectType', 'summary', 'maximumEffect'], '$.controlState.effectPreview');
      text(effect.effectType, '$.controlState.effectPreview.effectType', 120);
      text(effect.summary, '$.controlState.effectPreview.summary', 500);
      text(effect.maximumEffect, '$.controlState.effectPreview.maximumEffect', 500);
    }
    if (control.currentState !== null) {
      const current = closed(control.currentState, ['stateType', 'value'], '$.controlState.currentState');
      text(current.stateType, '$.controlState.currentState.stateType', 120);
      if (!['string', 'number', 'boolean'].includes(typeof current.value)) fail('VALUE_INVALID', '$.controlState.currentState.value', 'current control state must be a scalar');
      if (typeof current.value === 'number' && !Number.isFinite(current.value)) fail('VALUE_INVALID', '$.controlState.currentState.value', 'numeric control state must be finite');
    }
    for (const key of ['previewState', 'confirmState', 'resultState', 'ledgerEvidenceRef', 'correlationId']) nullableText(control[key], `$.controlState.${key}`, 240);
    for (const key of ['beforeRevision', 'afterRevision']) {
      if (control[key] !== null) nonNegativeInteger(control[key], `$.controlState.${key}`);
    }
    if (control.available) {
      if (control.unavailableReasonCode !== null || control.effectPreview === null || control.currentState === null
          || control.previewState === null || control.confirmState === null || control.resultState === null
          || control.beforeRevision === null || control.afterRevision === null
          || control.afterRevision < control.beforeRevision || control.ledgerEvidenceRef === null
          || control.correlationId === null) {
        fail('CONTROL_EVIDENCE_INCOMPLETE', '$.controlState', 'available control requires bounded preview/current state, preview/confirm/result, ordered revisions, ledger evidence, and correlation');
      }
    } else {
      if (control.unavailableReasonCode === null || control.effectPreview !== null || control.currentState !== null
          || control.previewState !== null || control.confirmState !== null || control.resultState !== null
          || control.beforeRevision !== null || control.afterRevision !== null
          || control.ledgerEvidenceRef !== null || control.correlationId !== null) {
        fail('CONTROL_AVAILABILITY_INVALID', '$.controlState', 'unavailable controls require one reason and null mutation evidence');
      }
    }
  }
  const valuesByKey = new Map(root.values.map((value) => [value.key, value]));
  validateComponentFactCollections(root, valuesByKey);
  validateSourceRowCollections(root, valuesByKey);
  validateAttentionRows(root, valuesByKey);
  validateTraceTargets(root, valuesByKey);
  validateStateCauseEvidence(root);
  return true;
}

function requiredValueEvaluation(contract, observation) {
  const valuesByKey = new Map(observation.values.map((value) => [value.key, value]));
  const missingKeys = contract.requiredValueKeys.filter((key) => !valuesByKey.has(key));
  const unknownKeys = contract.requiredValueKeys.filter((key) => valuesByKey.get(key)?.valueState === 'UNKNOWN');
  return {
    satisfied: missingKeys.length === 0 && unknownKeys.length === 0,
    missingKeys,
    unknownKeys,
  };
}

function sourceProvenanceEvaluation(contract, observation) {
  const provenance = observation.sourceProvenance;
  const source = contract.sourceBinding;
  const release = contract.releaseBinding;
  const ownerMatches = provenance.canonicalOwner === source.canonicalOwner;
  const schemaMatches = provenance.sourceSchemaId === source.schemaId
    && provenance.sourceSchemaVersion === source.schemaVersion;
  const manifestIdMatches = provenance.manifestId === release.manifestId;
  const manifestRevisionMatches = provenance.manifestRevision === release.manifestRevision;
  const manifestShaMatches = provenance.manifestSha256 === release.manifestSha256;
  const manifestItemMatches = provenance.manifestItemId === release.expectedManifestItemId;
  const acceptedReleaseMatches = provenance.acceptedReleaseSha === release.acceptedReleaseSha;
  const runningReleaseMatches = provenance.runningReleaseSha === release.acceptedReleaseSha;
  const manifestMatches = provenance.manifestEvaluationResult === 'MATCH';
  const reasons = [];
  if (!ownerMatches) reasons.push('SOURCE_OWNER_MISMATCH');
  if (!schemaMatches) reasons.push('SOURCE_SCHEMA_MISMATCH');
  if (!manifestIdMatches) reasons.push('MANIFEST_ID_MISMATCH');
  if (!manifestRevisionMatches) reasons.push('MANIFEST_REVISION_MISMATCH');
  if (!manifestShaMatches) reasons.push('MANIFEST_SHA256_MISMATCH');
  if (!manifestItemMatches) reasons.push('MANIFEST_ITEM_ID_MISMATCH');
  if (!acceptedReleaseMatches) reasons.push('ACCEPTED_RELEASE_SHA_MISMATCH');
  if (!runningReleaseMatches) reasons.push('RUNNING_RELEASE_SHA_MISMATCH');
  if (!manifestMatches) reasons.push('RELEASE_MANIFEST_NOT_MATCHED');
  return {
    satisfied: ownerMatches && schemaMatches && manifestIdMatches && manifestRevisionMatches
      && manifestShaMatches && manifestItemMatches
      && acceptedReleaseMatches && runningReleaseMatches && manifestMatches,
    reasons,
  };
}

function detectionEvidenceEvaluation(contract, observation) {
  const claim = contract.detectionClaim;
  const evidence = observation.detectionEvidence;
  if (claim.kind === 'NONE') {
    const explicitNone = Object.values(evidence).every((value) => value === null);
    return {
      satisfied: explicitNone,
      reason: explicitNone ? null : 'UNDECLARED_DETECTION_EVIDENCE',
    };
  }
  const identityMatches = evidence.registeredFailureId === claim.registeredFailureId;
  if (claim.kind === 'FIVE_SECOND') {
    const satisfied = identityMatches
      && evidence.detectorConnected === true
      && evidence.telemetryConnected === true
      && evidence.browserConnected === true
      && evidence.sloMatched === true
      && evidence.outOfBandProofPresent !== true;
    return { satisfied, reason: satisfied ? null : 'DETECTION_PATH_NOT_PROVEN' };
  }
  const satisfied = identityMatches
    && evidence.detectorConnected === true
    && evidence.telemetryConnected === true
    && evidence.browserConnected !== true
    && evidence.sloMatched === true
    && evidence.outOfBandProofPresent === true;
  return { satisfied, reason: satisfied ? null : 'OUT_OF_BAND_PROOF_NOT_OBSERVED' };
}

function expectedRenderTruthLabel(axes) {
  if (axes.truthLabel === 'UNKNOWN' || axes.dataMode === 'UNKNOWN') return 'UNKNOWN';
  if (axes.truthLabel === 'UNAVAILABLE' || axes.authority === 'UNAVAILABLE'
      || axes.dataMode === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (axes.releaseStatuses.includes('SYNTHETIC_ONLY')) return 'SYNTHETIC';
  if (axes.releaseStatuses.includes('MISSING')) return 'MISSING';
  if (axes.releaseStatuses.includes('NOT_CONFIGURED')) return 'NOT_CONFIGURED';
  if (axes.releaseStatuses.includes('BLOCKED')) return 'BLOCKED';
  if (axes.truthLabel === 'SYNTHETIC_ONLY' || axes.truthLabel === 'RECORDED_REPLAY'
      || axes.authority === 'SYNTHETIC_TEST' || axes.authority === 'RECORDED_REPLAY'
      || axes.dataMode === 'SYNTHETIC_ONLY' || axes.dataMode === 'RECORDED_REPLAY') return 'SYNTHETIC';
  if (axes.dataMode === 'SHADOW') return 'SHADOW';
  if (axes.dataMode === 'VALIDATE_ONLY') return 'VALIDATE_ONLY';
  if (axes.dataMode === 'DRY_RUN' || axes.truthLabel === 'DRY_RUN') return 'DRY_RUN';
  if (axes.truthLabel === 'LIVE_PUBLIC' && axes.dataMode === 'LIVE_PUBLIC'
      && ['LIVE_PUBLIC', 'LIVE_PRIVATE', 'DERIVED_LIVE'].includes(axes.authority)
      && axes.releaseStatuses.includes('LIVE_PUBLIC')) return 'LIVE';
  return 'UNKNOWN';
}

function renderTruthLabelEvaluation(observation) {
  const value = observation.values.find((entry) => entry.key === 'renderTruthLabel');
  const expected = expectedRenderTruthLabel(observation.truthAxes);
  return {
    expected,
    observed: value?.value ?? null,
    consistent: value === undefined || value.value === expected,
  };
}

function antiGreen(observation, contract, evaluatedAtMs) {
  const axes = observation.truthAxes;
  const reasons = [];
  let state = null;
  if (axes.supportState === 'UNSUPPORTED' || axes.configurationState === 'NOT_CONFIGURED' || axes.discovered === false) {
    state = 'MISSING';
    if (axes.supportState === 'UNSUPPORTED') reasons.push('SUPPORT_UNSUPPORTED');
    if (axes.configurationState === 'NOT_CONFIGURED') reasons.push('CONFIGURATION_NOT_CONFIGURED');
    if (axes.discovered === false) reasons.push('EXPECTED_ENTITY_MISSING');
  }
  if (axes.instrumented === true && axes.telemetrySilent === true) {
    state ??= 'SILENT';
    reasons.push('TELEMETRY_SILENT');
  }
  if (axes.freshnessState === 'STALE') {
    state ??= 'STALE';
    reasons.push('EVIDENCE_STALE');
  }
  if (axes.dataMode === 'SYNTHETIC_ONLY' || axes.truthLabel === 'SYNTHETIC_ONLY' || axes.authority === 'SYNTHETIC_TEST') {
    state ??= 'SYNTHETIC';
    reasons.push('SYNTHETIC_NOT_LIVE');
  }
  const requiredValues = requiredValueEvaluation(contract, observation);
  const detection = detectionEvidenceEvaluation(contract, observation);
  const sourceProvenance = sourceProvenanceEvaluation(contract, observation);
  const renderTruth = renderTruthLabelEvaluation(observation);
  const contradictoryReleaseStatuses = axes.releaseStatuses.includes('LIVE_PUBLIC')
    ? CONTRADICTORY_LIVE_RELEASE_STATUSES.filter((status) => axes.releaseStatuses.includes(status))
    : [];
  if (contradictoryReleaseStatuses.includes('SYNTHETIC_ONLY')) state ??= 'SYNTHETIC';
  else if (contradictoryReleaseStatuses.length > 0) state ??= 'UNKNOWN';
  for (const status of contradictoryReleaseStatuses) {
    reasons.push(`RELEASE_STATUS_CONTRADICTION_${status}`);
  }
  if (!renderTruth.consistent) {
    state ??= 'UNKNOWN';
    reasons.push('RENDER_TRUTH_LABEL_INCONSISTENT');
  }
  const unknownFacts = [
    ...sourceProvenance.reasons.map((reason) => [true, reason]),
    [axes.supportState !== 'SUPPORTED', 'SUPPORT_NOT_SUPPORTED'],
    [axes.configurationState !== 'CONFIGURED', 'CONFIGURATION_NOT_PROVEN'],
    [axes.discovered !== true, 'DISCOVERY_UNKNOWN'],
    [axes.instrumented !== true, 'INSTRUMENTATION_INCOMPLETE'],
    [axes.telemetrySilent !== false, 'TELEMETRY_PRESENCE_UNKNOWN'],
    [axes.freshnessState !== 'FRESH', 'FRESHNESS_NOT_FRESH'],
    [axes.coherenceState !== 'COHERENT', 'COHERENCE_NOT_PROVEN'],
    [axes.truthLabel !== 'LIVE_PUBLIC', 'TRUTH_NOT_LIVE_PUBLIC'],
    [!['LIVE_PUBLIC', 'LIVE_PRIVATE', 'DERIVED_LIVE'].includes(axes.authority), 'AUTHORITY_NOT_LIVE'],
    [axes.completeness !== 'COMPLETE', 'COMPLETENESS_NOT_COMPLETE'],
    [axes.dataMode !== 'LIVE_PUBLIC', 'DATA_MODE_NOT_LIVE'],
    [axes.readiness !== 'READY', 'READINESS_NOT_READY'],
    [contract.panelKind === 'CONTROL' && observation.controlState?.available !== true, 'CONTROL_UNAVAILABLE'],
    [!axes.releaseStatuses.includes('LIVE_PUBLIC'), 'RELEASE_NOT_LIVE_PUBLIC'],
    [observation.denominator.unknownCount !== 0, 'DENOMINATOR_HAS_UNKNOWN'],
    [observation.denominator.expectedCount !== contract.denominatorLaw.expectedCount, 'EXPECTED_MANIFEST_DENOMINATOR_MISMATCH'],
    [observation.evidence.observedCount < contract.greenEvidence.minimumCount, 'EVIDENCE_INSUFFICIENT'],
    [observation.evidence.observedCount !== observation.denominator.expectedCount, 'EXPECTED_EVIDENCE_COUNT_MISMATCH'],
    [observation.values.length === 0, 'GREEN_VALUE_EVIDENCE_MISSING'],
    [!requiredValues.satisfied, 'REQUIRED_VALUE_KEYS_MISSING'],
    [!detection.satisfied, detection.reason],
    [evaluatedAtMs - observation.evidence.observedAtMs > contract.greenEvidence.evidenceMaximumAgeMs, 'EVIDENCE_EXPIRED'],
    [contract.greenEvidence.independentProofRequired && observation.evidence.lastIndependentProofAtMs === null, 'INDEPENDENT_PROOF_MISSING'],
    [contract.greenEvidence.independentProofRequired
      && observation.evidence.lastIndependentProofAtMs !== null
      && evaluatedAtMs - observation.evidence.lastIndependentProofAtMs > contract.greenEvidence.independentProofMaximumAgeMs,
    'INDEPENDENT_PROOF_EXPIRED'],
    [axes.independentProbeRequired && axes.independentProbePassing !== true, 'INDEPENDENT_PROBE_NOT_PASSING'],
  ];
  for (const key of requiredValues.missingKeys) reasons.push(`REQUIRED_VALUE_KEY_MISSING_${key.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`);
  for (const key of requiredValues.unknownKeys) reasons.push(`REQUIRED_VALUE_KEY_UNKNOWN_${key.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`);
  for (const [failed, reason] of unknownFacts) if (failed) reasons.push(reason);
  if (reasons.length > 0 && state === null) state = 'UNKNOWN';
  return { state, reasons: [...new Set(reasons)].sort(compareCodePoints) };
}

function declaredStateRuleEvaluation(ruleSet, observation, contract, evaluatedAtMs) {
  const requestedRule = ruleSet.states.find((rule) => rule.state === observation.requestedDisplayState);
  if (!requestedRule) fail('STATE_RULES_INCOMPLETE', '$.stateRuleSet.states', `${observation.requestedDisplayState} rule is required`);
  const axes = observation.truthAxes;
  const flags = new Set(observation.reasonCodes);
  const sourceProvenance = sourceProvenanceEvaluation(contract, observation);
  if (sourceProvenance.satisfied) flags.add('MANIFEST_MATCH');
  else flags.add('MANIFEST_MISMATCH');
  if (observation.denominator.expectedCount === contract.denominatorLaw.expectedCount) flags.add('DENOMINATOR_COMPLETE');
  else flags.add('DENOMINATOR_INCOMPLETE');
  const evidenceCurrent = evaluatedAtMs - observation.evidence.observedAtMs <= contract.greenEvidence.evidenceMaximumAgeMs;
  const requiredValues = requiredValueEvaluation(contract, observation);
  const detection = detectionEvidenceEvaluation(contract, observation);
  if (observation.evidence.observedCount >= contract.greenEvidence.minimumCount
      && observation.evidence.observedCount === observation.denominator.expectedCount
      && observation.denominator.expectedCount === contract.denominatorLaw.expectedCount
      && observation.values.length > 0 && evidenceCurrent) flags.add('EVIDENCE_SUFFICIENT');
  else flags.add('EVIDENCE_INSUFFICIENT');
  if (axes.supportState === 'SUPPORTED') flags.add('SUPPORTED');
  else if (axes.supportState === 'UNSUPPORTED') flags.add('MISSING');
  else flags.add('UNKNOWN');
  if (axes.configurationState === 'CONFIGURED') flags.add('CONFIGURED');
  else if (axes.configurationState === 'NOT_CONFIGURED') flags.add('MISSING');
  else flags.add('UNKNOWN');
  if (axes.discovered === true) flags.add('DISCOVERED');
  else if (axes.discovered === false) flags.add('MISSING');
  if (axes.instrumented === true) flags.add('INSTRUMENTED');
  if (axes.telemetrySilent === false) flags.add('TELEMETRY_PRESENT');
  else if (axes.telemetrySilent === true) flags.add('SILENT');
  if (axes.freshnessState === 'FRESH') flags.add('FRESH');
  else if (axes.freshnessState === 'STALE') flags.add('STALE');
  if (axes.coherenceState === 'COHERENT') flags.add('COHERENT');
  if (axes.truthLabel === 'LIVE_PUBLIC'
      && ['LIVE_PUBLIC', 'LIVE_PRIVATE', 'DERIVED_LIVE'].includes(axes.authority)
      && axes.dataMode === 'LIVE_PUBLIC') flags.add('LIVE_AUTHORITY');
  if (axes.truthLabel === 'SYNTHETIC_ONLY' || axes.authority === 'SYNTHETIC_TEST'
      || axes.dataMode === 'SYNTHETIC_ONLY') flags.add('SYNTHETIC');
  const contradictoryReleaseStatuses = axes.releaseStatuses.includes('LIVE_PUBLIC')
    ? CONTRADICTORY_LIVE_RELEASE_STATUSES.filter((status) => axes.releaseStatuses.includes(status))
    : [];
  if (contradictoryReleaseStatuses.length > 0) flags.add('UNKNOWN');
  if (contradictoryReleaseStatuses.includes('SYNTHETIC_ONLY')) flags.add('SYNTHETIC');
  if (contradictoryReleaseStatuses.some((status) => status === 'MISSING' || status === 'NOT_CONFIGURED')) flags.add('MISSING');
  if (axes.truthLabel === 'UNKNOWN' || axes.dataMode === 'UNKNOWN'
      || axes.coherenceState === 'UNKNOWN' || !sourceProvenance.satisfied) flags.add('UNKNOWN');
  if (contract.panelKind === 'CONTROL' && observation.controlState?.available !== true) flags.add('UNKNOWN');
  if (requiredValues.satisfied) flags.add('REQUIRED_VALUES_PRESENT');
  if (detection.satisfied) flags.add('DETECTION_CLAIM_SATISFIED');

  const forbidden = observation.requestedDisplayState === 'GREEN'
    ? requestedRule.forbidsAny.filter((flag) => flags.has(flag))
    : [];
  const missingRequired = requestedRule.requiresAll.filter((flag) => !flags.has(flag));
  if (forbidden.length === 0 && missingRequired.length === 0) return { state: null, reasons: [] };
  const displayOrder = ['MISSING', 'SILENT', 'STALE', 'SYNTHETIC', 'UNKNOWN'];
  const state = displayOrder.find((candidate) => forbidden.includes(candidate)) ?? 'UNKNOWN';
  const reasons = [
    ...forbidden.map((flag) => `DECLARED_${observation.requestedDisplayState}_FORBIDDEN_${flag}`),
    ...missingRequired.map((flag) => `DECLARED_${observation.requestedDisplayState}_REQUIRED_${flag}_MISSING`),
  ].sort(compareCodePoints);
  return { state, reasons };
}

function strictestDowngradeState(...states) {
  const order = ['MISSING', 'SILENT', 'STALE', 'SYNTHETIC', 'UNKNOWN'];
  return order.find((candidate) => states.includes(candidate)) ?? null;
}

function frozenClone(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenClone));
  if (typeof value === 'object' && value !== null) {
    const output = {};
    for (const key of Object.keys(value)) output[key] = frozenClone(value[key]);
    return Object.freeze(output);
  }
  return value;
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function evaluatePanel(contract, observation, evaluatedAtMs, stateRuleSet) {
  validateRuleSet(stateRuleSet, '$.stateRuleSet');
  validatePanelContract(contract, new Set([stateRuleSet.ruleSetId]), '$.contract');
  validatePanelObservation(observation);
  if (stateRuleSet.ruleSetId !== contract.stateRuleSetId) fail('RULE_SET_MISSING', '$.stateRuleSet.ruleSetId', 'panel received a different declared rule set');
  utcMsOrNull(evaluatedAtMs, '$.evaluatedAtMs');
  if (evaluatedAtMs === null) fail('UTC_MILLIS_INVALID', '$.evaluatedAtMs', 'an injected evaluation time is required');
  if (observation.evidence.observedAtMs > evaluatedAtMs) fail('EVIDENCE_TIME_IN_FUTURE', '$.evidence.observedAtMs', 'evidence cannot postdate evaluation');
  if (observation.evidence.lastIndependentProofAtMs !== null
      && observation.evidence.lastIndependentProofAtMs > evaluatedAtMs) {
    fail('EVIDENCE_TIME_IN_FUTURE', '$.evidence.lastIndependentProofAtMs', 'independent proof cannot postdate evaluation');
  }
  if (contract.contractId !== observation.contractId) fail('CONTRACT_OBSERVATION_MISMATCH', '$.contractId', 'observation targets a different contract');
  if (contract.panelKind === 'CONTROL') {
    if (observation.controlState === null) fail('FAKE_CONTROL', '$.controlState', 'control projection lacks backend binding state');
    if (observation.controlState.backendMutationId !== contract.controlBinding.backendMutationId) fail('FAKE_CONTROL', '$.controlState.backendMutationId', 'control does not map to its tested backend mutation');
  } else if (observation.controlState !== null) {
    fail('ORPHAN_CONTROL_STATE', '$.controlState', 'non-control panel supplied control state');
  }
  const baseDowngrade = antiGreen(observation, contract, evaluatedAtMs);
  const declaredDowngrade = declaredStateRuleEvaluation(stateRuleSet, observation, contract, evaluatedAtMs);
  const downgrade = {
    state: strictestDowngradeState(baseDowngrade.state, declaredDowngrade.state),
    reasons: [...new Set([...baseDowngrade.reasons, ...declaredDowngrade.reasons])].sort(compareCodePoints),
  };
  const displayState = downgrade.state ?? observation.requestedDisplayState;
  const reasonCodes = [...new Set([...observation.reasonCodes, ...downgrade.reasons])].sort(compareCodePoints);
  const renderTruth = renderTruthLabelEvaluation(observation);
  const failClosedValues = observation.values.map((value) => (
    value.key === 'renderTruthLabel' && !renderTruth.consistent
      ? { ...value, value: renderTruth.expected, unknownReasonCode: null }
      : value
  ));
  return frozenClone({
    schemaVersion: COCKPIT_SCHEMA_VERSION,
    contractId: contract.contractId,
    surfaceId: contract.surfaceId,
    informationLevels: contract.informationLevels,
    panelKind: contract.panelKind,
    ownerQuestion: contract.ownerQuestion,
    releaseBinding: contract.releaseBinding,
    requiredValueKeys: contract.requiredValueKeys,
    factSemantics: contract.factSemantics,
    drilldownBounds: contract.drilldownBounds,
    detectionClaim: contract.detectionClaim,
    displayState,
    sourceProvenance: observation.sourceProvenance,
    truthAxes: observation.truthAxes,
    denominator: observation.denominator,
    evidence: observation.evidence,
    detectionEvidence: observation.detectionEvidence,
    componentDenominator: observation.componentDenominator,
    componentFacts: observation.componentFacts,
    sourceDenominator: observation.sourceDenominator,
    sourceAggregationDenominator: observation.sourceAggregationDenominator,
    sourceRows: observation.sourceRows,
    attentionDenominator: observation.attentionDenominator,
    attentionRows: observation.attentionRows,
    traceDenominator: observation.traceDenominator,
    traceTargets: observation.traceTargets,
    stateCauseEvidence: observation.stateCauseEvidence,
    values: [...failClosedValues].sort((left, right) => compareCodePoints(left.key, right.key)),
    reasonCodes,
    actionBinding: contract.actionBinding,
    drilldowns: contract.drilldowns,
    control: contract.panelKind === 'CONTROL'
      ? { contract: contract.controlBinding, state: observation.controlState }
      : null,
  });
}

export function buildCockpitViewModel(input) {
  const root = closed(input, [
    'schemaVersion', 'viewModelId', 'evaluatedAtMs', 'fixtureProvenance',
    'contractSet', 'projectionMatrix', 'observations',
  ], '$');
  if (root.schemaVersion !== COCKPIT_SCHEMA_VERSION) fail('SCHEMA_VERSION_INVALID', '$.schemaVersion', 'unsupported view-model version');
  text(root.viewModelId, '$.viewModelId', 120);
  utcMsOrNull(root.evaluatedAtMs, '$.evaluatedAtMs');
  if (root.evaluatedAtMs === null) fail('UTC_MILLIS_INVALID', '$.evaluatedAtMs', 'an injected evaluation time is required');
  const provenance = closed(root.fixtureProvenance, ['truthLabel', 'authority', 'wiringState', 'note'], '$.fixtureProvenance');
  if (provenance.truthLabel !== 'SYNTHETIC_ONLY' || provenance.authority !== 'SYNTHETIC_TEST'
      || provenance.wiringState !== 'WIRED_FIXTURE') {
    fail('FIXTURE_PROVENANCE_INVALID', '$.fixtureProvenance', 'packet fixture projections must remain explicitly synthetic and fixture-wired');
  }
  text(provenance.note, '$.fixtureProvenance.note', 500);
  validateCockpitContractSet(root.contractSet);
  validateSurfaceProjectionMatrix(root.projectionMatrix);
  const matrixLevels = new Map(root.projectionMatrix.rows.map((row) => [row.surfaceId, new Set(row.informationLevels)]));
  for (const contract of root.contractSet.contracts) {
    if (contract.informationLevels.some((level) => !matrixLevels.get(contract.surfaceId)?.has(level))) {
      fail('LEVEL_PROJECTION_MISMATCH', '$.contractSet.contracts', `${contract.contractId} claims a level not routed by ${contract.surfaceId}`);
    }
  }
  const contractsById = new Map(root.contractSet.contracts.map((contract) => [contract.contractId, contract]));
  for (const row of root.projectionMatrix.rows) {
    for (const binding of row.factBindings) {
      const contract = contractsById.get(binding.contractId);
      if (!contract) fail('FACT_CONTRACT_MISSING', '$.projectionMatrix.rows', `unknown contract ${binding.contractId}`);
      if (contract.surfaceId !== row.surfaceId) fail('FACT_SURFACE_MISMATCH', '$.projectionMatrix.rows', `${binding.contractId} is not owned by ${row.surfaceId}`);
      if (!contract.informationLevels.includes(binding.level)) fail('FACT_LEVEL_MISMATCH', '$.projectionMatrix.rows', `${binding.contractId} does not project level ${binding.level}`);
      if (!contract.requiredValueKeys.includes(binding.valueKey)) fail('FACT_VALUE_KEY_MISMATCH', '$.projectionMatrix.rows', `${binding.valueKey} is not required by ${binding.contractId}`);
      const semantic = contract.factSemantics.find((fact) => fact.valueKey === binding.valueKey);
      if (!semantic || semantic.level !== binding.level || semantic.topicId !== binding.topicId) {
        fail('FACT_SEMANTIC_BINDING_MISMATCH', '$.projectionMatrix.rows', `${binding.contractId}.${binding.valueKey} is bound to the wrong semantic topic`);
      }
    }
    const surfaceContracts = root.contractSet.contracts.filter((contract) => contract.surfaceId === row.surfaceId);
    for (const contract of surfaceContracts) {
      const contractBindings = row.factBindings.filter((binding) => binding.contractId === contract.contractId);
      const matrixKeys = contractBindings.map((binding) => binding.valueKey).sort(compareCodePoints);
      const requiredKeys = [...contract.requiredValueKeys].sort(compareCodePoints);
      if (matrixKeys.length !== requiredKeys.length
          || matrixKeys.some((valueKey, index) => valueKey !== requiredKeys[index])) {
        fail('FACT_BINDING_KEYSET_MISMATCH', '$.projectionMatrix.rows', `${contract.contractId} matrix bindings must exactly equal required keys`);
      }
      for (const key of contract.requiredValueKeys) {
        if (!contractBindings.some((binding) => binding.valueKey === key)) {
          fail('FACT_VALUE_COVERAGE_INCOMPLETE', '$.projectionMatrix.rows', `${contract.contractId}.${key} is unbound`);
        }
      }
      for (const level of contract.informationLevels) {
        if (!contractBindings.some((binding) => binding.level === level)) {
          fail('FACT_LEVEL_COVERAGE_INCOMPLETE', '$.projectionMatrix.rows', `${contract.contractId} lacks a level ${level} binding`);
        }
      }
    }
  }
  if (!Array.isArray(root.observations) || root.observations.length !== root.contractSet.contracts.length) {
    fail('OBSERVATION_COVERAGE_INCOMPLETE', '$.observations', 'exactly one observation per panel contract is required');
  }
  const observations = new Map();
  for (const observation of root.observations) {
    validatePanelObservation(observation);
    if (observations.has(observation.contractId)) fail('DUPLICATE_OBSERVATION', '$.observations', `duplicate ${observation.contractId}`);
    observations.set(observation.contractId, observation);
  }
  const evaluatedBySurface = new Map(I00_SURFACE_IDS.map((surfaceId) => [surfaceId, []]));
  const ruleSets = new Map(root.contractSet.stateRuleSets.map((ruleSet) => [ruleSet.ruleSetId, ruleSet]));
  for (const contract of root.contractSet.contracts) {
    const observation = observations.get(contract.contractId);
    if (!observation) fail('OBSERVATION_COVERAGE_INCOMPLETE', '$.observations', `missing ${contract.contractId}`);
    const evaluated = evaluatePanel(contract, observation, root.evaluatedAtMs, ruleSets.get(contract.stateRuleSetId));
    const syntheticReleaseStatuses = [...new Set([
      ...evaluated.truthAxes.releaseStatuses.filter((status) => status !== 'LIVE_PUBLIC'),
      'SYNTHETIC_ONLY',
    ])].sort(compareCodePoints);
    const syntheticTruthAxes = {
      ...evaluated.truthAxes,
      releaseStatuses: syntheticReleaseStatuses,
      truthLabel: 'SYNTHETIC_ONLY',
      authority: 'SYNTHETIC_TEST',
      dataMode: 'SYNTHETIC_ONLY',
    };
    const syntheticValues = evaluated.values.map((value) => (
      value.key === 'renderTruthLabel'
        ? { ...value, value: 'SYNTHETIC', unknownReasonCode: null }
        : value
    ));
    const fixtureControl = evaluated.control === null ? null : {
      contract: evaluated.control.contract,
      state: {
        available: false,
        unavailableReasonCode: 'FIXTURE_CONTROL_UNAVAILABLE',
        backendMutationId: evaluated.control.state.backendMutationId,
        effectPreview: null,
        currentState: null,
        previewState: null,
        confirmState: null,
        resultState: null,
        beforeRevision: null,
        afterRevision: null,
        ledgerEvidenceRef: null,
        correlationId: null,
      },
    };
    evaluatedBySurface.get(contract.surfaceId).push(frozenClone({
      ...evaluated,
      displayState: 'SYNTHETIC',
      truthAxes: syntheticTruthAxes,
      values: syntheticValues,
      control: fixtureControl,
      reasonCodes: [...new Set([...evaluated.reasonCodes, 'FIXTURE_PROVENANCE_SYNTHETIC'])].sort(compareCodePoints),
    }));
  }
  const surfaces = root.projectionMatrix.rows.map((row) => ({
    surfaceId: row.surfaceId,
    informationLevels: [...row.informationLevels],
    projectionQuestion: row.projectionQuestion,
    routeKind: row.routeKind,
    canonicalRoute: row.canonicalRoute,
    pageOwner: row.pageOwner,
    factBindings: row.factBindings,
    panels: evaluatedBySurface.get(row.surfaceId).sort((left, right) => compareCodePoints(left.contractId, right.contractId)),
  }));
  return frozenClone({
    schemaVersion: COCKPIT_SCHEMA_VERSION,
    viewModelId: root.viewModelId,
    evaluatedAtMs: root.evaluatedAtMs,
    fixtureProvenance: provenance,
    reasonCodeRegistryVersion: root.contractSet.reasonCodeRegistryVersion,
    reasonCodeRegistry: root.contractSet.reasonCodeRegistry,
    levelDefinitions: root.projectionMatrix.levelDefinitions,
    surfaceCount: surfaces.length,
    panelCount: root.contractSet.contracts.length,
    surfaces,
  });
}

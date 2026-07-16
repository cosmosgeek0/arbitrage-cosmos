import {
  L12_CHAIN_STAGES,
  L12_CRASH_FAULT_CUTS,
  L12_COLD_START_STEPS,
  L12_CONTROL_ACTIONS,
  L12_RECOVERY_SCENARIOS,
  deriveRecoveryCampaignTraceDigest,
} from '../../../dist/liveEdge/adapters/exposureRecoveryProjection/index.js';

const BASE_TIME = 1_783_980_000_000;

export function subject(overrides = {}) {
  return {
    strategy: 'NORMAL_BASIS',
    proposalId: 'proposal-normal-btcusdt-1',
    assessmentId: 'assessment-normal-btcusdt-1',
    mandateId: 'mandate-normal-btcusdt-1',
    reservationId: 'reservation-normal-btcusdt-1',
    approvalId: 'approval-normal-btcusdt-1',
    planOrLifecycleId: 'plan-normal-btcusdt-1',
    correlationId: 'correlation-normal-btcusdt-1',
    accountRealmId: 'realm-binance-primary',
    symbol: 'BTCUSDT',
    ...overrides,
  };
}

function ownerForStage(stage) {
  if (stage === 'PROPOSAL') return 'STRATEGY_OWNER';
  if (['CAPITAL_MANDATE', 'RESERVATION', 'RESERVATION_SETTLEMENT'].includes(stage)) return 'CAPITAL_FOUNDATION';
  if (stage === 'APPROVAL_AUTHORITY') return 'CAPITAL_APPROVALS';
  if (stage === 'RISK_VERDICT') return 'FOUNDATION_RISK';
  if (stage === 'OUTCOME_RECONCILIATION') return 'FOUNDATION_RECONCILIATION';
  return 'FOUNDATION_EXECUTION';
}

export function completeInput() {
  const identity = subject();
  const chain = L12_CHAIN_STAGES.map((stage, index) => ({
    stage,
    owner: ownerForStage(stage),
    status: 'COMPLETE',
    subject: identity,
    revision: `owner-${stage.toLowerCase()}-revision-1`,
    observedAtMs: BASE_TIME + index,
    reasonCodes: [],
  }));
  const control = {
    owner: 'FOUNDATION_CONTROL',
    subject: identity,
    revision: 'foundation-control-revision-1',
    halted: true,
    observedAtMs: BASE_TIME + 10,
    admissions: L12_CONTROL_ACTIONS.map((action) => ({
      action,
      allowed: !['ACTIVATE_PROPOSAL', 'OPEN_EXPOSURE', 'ADD_EXPOSURE', 'REPEAT_ENTRY'].includes(action),
      ownerReasonCode: ['ACTIVATE_PROPOSAL', 'OPEN_EXPOSURE', 'ADD_EXPOSURE', 'REPEAT_ENTRY'].includes(action)
        ? 'KILL_SWITCH_ENGAGED'
        : 'SAFE_DURING_HALT',
    })),
  };
  const campaigns = L12_RECOVERY_SCENARIOS.map((scenario, index) => {
    const trace = {
      scenario,
      campaignId: `campaign-${String(index + 1).padStart(2, '0')}`,
      subject: identity,
      terminalState: 'RECOVERED',
      ownerRevision: `campaign-owner-revision-${index + 1}`,
      fixtureAuthority: 'SYNTHETIC_FAULT_INJECTION',
      duplicateOrderCount: 0,
      residualExposureExplicit: true,
      residualLiabilityExplicit: true,
      hiddenResidualExposure: false,
      hiddenResidualLiability: false,
      traceAuthority: 'INJECTED_OWNER_TRACE_EVIDENCE',
      traceRevision: `campaign-trace-revision-${index + 1}`,
      initialStateRevision: `campaign-initial-state-revision-${index + 1}`,
      terminalStateRevision: `campaign-terminal-state-revision-${index + 1}`,
      mutationIdentities: [`campaign-mutation-identity-${index + 1}`],
      replayObservedMutationIdentities: [`campaign-mutation-identity-${index + 1}`],
      terminalResidualExposure: '0',
      terminalResidualLiability: '0',
      terminalOutstandingReferences: [],
      replayWitnesses: scenario === 'SERVER_CRASH_EVERY_TICKET_STATE'
        ? L12_CRASH_FAULT_CUTS.map((faultCut, cutIndex) => ({
            faultCut,
            ownerState: `SYNTHETIC_OWNER_STATE_${cutIndex + 1}`,
            checkpointRevision: `synthetic-checkpoint-revision-${cutIndex + 1}`,
            cutStateRevision: `synthetic-cut-state-revision-${cutIndex + 1}`,
            restoredStateRevision: `synthetic-cut-state-revision-${cutIndex + 1}`,
            terminalStateRevision: `campaign-terminal-state-revision-${index + 1}`,
            mutationIdentitiesBefore: cutIndex === 0 ? [] : [`campaign-mutation-identity-${index + 1}`],
            terminalMutationIdentities: [`campaign-mutation-identity-${index + 1}`],
            terminalResidualExposure: '0',
            terminalResidualLiability: '0',
            terminalOutstandingReferences: [],
          }))
        : [],
    };
    return { ...trace, traceDigest: deriveRecoveryCampaignTraceDigest(trace) };
  });
  return {
    subject: identity,
    canonicalTruth: {
      owner: 'CAPITAL_FOUNDATION',
      subject: identity,
      accountingScopeId: 'capital-accounting-scope-btcusdt-1',
      mutationId: 'foundation-mutation-identity-1',
      exposureTruthRevision: 'current-truth-revision-1',
      capitalPositionRevision: 'capital-position-revision-1',
      accountCapacityRevision: 'capital-capacity-revision-1',
      reservationRevision: chain[1 + 1].revision,
      reservationSettlementRevision: chain[8].revision,
      executionRevision: chain[7].revision,
      outstandingRevision: 'foundation-outstanding-revision-1',
      reconciliationRevision: chain[9].revision,
      recoveryRevision: 'foundation-recovery-revision-1',
    },
    chain,
    riskRecheck: {
      owner: 'FOUNDATION_RISK',
      subject: identity,
      verdictRevision: chain[4].revision,
      truthRevision: 'current-truth-revision-1',
      mutationId: 'foundation-mutation-identity-1',
      dispatchRevision: chain[6].revision,
      evaluatedAtMs: BASE_TIME + 5,
      mutationAttemptAtMs: BASE_TIME + 6,
      maximumAgeMs: 10,
      disposition: 'PASS',
      currentTruthUsed: true,
    },
    control,
    exposure: {
      owner: 'CAPITAL_FOUNDATION',
      source: 'CONFIRMED_FILLS_AND_RECONCILED_EXCHANGE_TRUTH',
      subject: identity,
      ownerRevision: 'capital-position-revision-1',
      truthRevision: 'current-truth-revision-1',
      completeness: 'COMPLETE',
      observedAtMs: BASE_TIME + 7,
      spotBase: '0',
      marginBase: '0',
      futuresBaseEquivalent: '0',
      netBase: '0',
      grossNotional: '0',
      marginLiability: '0',
      unhedgedNotional: '0',
      unhedgedSinceMs: null,
    },
    capital: {
      owner: 'CAPITAL_FOUNDATION',
      subject: identity,
      positionRevision: 'capital-position-revision-1',
      accountCapacityRevision: 'capital-capacity-revision-1',
      economicsRevision: 'capital-economics-revision-1',
      supervisionRevision: 'capital-supervision-revision-1',
      completeness: 'COMPLETE',
      observedAtMs: BASE_TIME + 7,
      availableCapacity: '1000',
      funding: '0',
      borrowCost: '0',
      fees: '0',
      realizedPnl: '0',
      unrealizedPnl: '0',
      supervisionIntent: 'HOLD',
      requiredFutureGates: ['MULTI_LEG_RISK', 'EXECUTION_COORDINATOR', 'RECONCILIATION'],
    },
    reconciliation: {
      owner: 'FOUNDATION_RECONCILIATION',
      subject: identity,
      revision: chain[9].revision,
      status: 'EXACT',
      observedAtMs: BASE_TIME + 9,
      orphanState: 'ABSENT',
      orphanReferences: [],
      reasonCodes: [],
    },
    outstanding: {
      owner: 'FOUNDATION_EXECUTION',
      subject: identity,
      ownerRevision: 'foundation-outstanding-revision-1',
      openOrderReferences: [],
      ambiguousMutationReferences: [],
      unmatchedFillReferences: [],
      manualActivityReferences: [],
    },
    recovery: {
      subject: identity,
      required: false,
      ownerEndState: 'CLOSED',
      ownerRevision: 'foundation-recovery-revision-1',
      residualExposure: '0',
      residualLiability: '0',
      reasonCodes: [],
      recommendations: [],
    },
    coldStart: {
      startupPosture: 'HALTED',
      steps: L12_COLD_START_STEPS.map((step, index) => ({
        step,
        status: 'COMPLETE',
        ownerRevision: `cold-start-owner-revision-${index + 1}`,
        observedAtMs: BASE_TIME + index,
        reasonCodes: [],
      })),
      effectiveEntryMode: 'OWNER_REVIEW_ONLY',
      completenessRevision: 'cold-start-completeness-revision-1',
    },
    campaigns,
    componentEvidence: {
      capitalExposed: false,
      operatorAttentionRequired: false,
      ownerRevision: 'component-owner-revision-1',
      reasonCodes: [],
    },
  };
}

export function recoveryRequiredInput() {
  const input = completeInput();
  input.exposure = {
    ...input.exposure,
    spotBase: '1',
    netBase: '1',
    grossNotional: '50000',
    unhedgedNotional: '50000',
    unhedgedSinceMs: BASE_TIME + 4,
  };
  input.reconciliation = {
    ...input.reconciliation,
    status: 'MISMATCH',
    orphanState: 'PRESENT',
    orphanReferences: ['exchange-position-without-local-ticket-1'],
    reasonCodes: ['VENUE_POSITION_WITHOUT_LOCAL_TICKET'],
  };
  input.recovery = {
    ...input.recovery,
    required: true,
    ownerEndState: 'MANUAL_INTERVENTION',
    residualExposure: '50000',
    reasonCodes: ['VENUE_POSITION_WITHOUT_LOCAL_TICKET'],
    recommendations: [{
      owner: 'FOUNDATION_RECONCILIATION',
      kind: 'INSPECT_FOREIGN_POSITION',
      ownerRevision: 'foundation-reconciliation-revision-1',
      automatic: false,
    }],
  };
  input.componentEvidence = {
    capitalExposed: true,
    operatorAttentionRequired: true,
    ownerRevision: 'component-owner-revision-2',
    reasonCodes: ['CAPITAL_EXPOSED', 'OPERATOR_ATTENTION_REQUIRED'],
  };
  return input;
}

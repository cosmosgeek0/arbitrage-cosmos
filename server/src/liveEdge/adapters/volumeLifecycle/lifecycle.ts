import { checkpointExchangeTwin, type TwinOrderState } from '../exchangeTwin/index.js';
import {
  addVolumeDecimals,
  compareVolumeDecimals,
  divideVolumeDecimals,
  favorableExtreme,
  lossStopReachedFromCostBasis,
  multiplyVolumeDecimals,
  multiplyVolumePpm,
  subtractVolumeDecimals,
  sumVolumeDecimals,
  trailingStopReachedFromCostBasis,
} from './exact.js';
import {
  evaluateVolumeProtectionRevision,
  validateVolumeProtectionPolicy,
} from './policy.js';
import {
  VOLUME_LIFECYCLE_DECISION_SCHEMA,
  VOLUME_LIFECYCLE_PROJECTION_SCHEMA,
  type VolumeFeedbackHandoff,
  type VolumeLifecycleActionRequest,
  type VolumeLifecycleDecision,
  type VolumeLifecycleInput,
  type VolumeLifecycleProjection,
  type VolumeLifecycleState,
  type VolumeNoFillRecord,
  type VolumeProtectionPolicy,
  type VolumeProtectionRevisionDecision,
  type VolumeRecoveryHandoff,
  type VolumeSide,
  type VolumeTwinSettlement,
  type VolumeUnresolvedTwinConflict,
} from './types.js';
import {
  deepFreeze,
  deriveVolumeActionKey,
  deriveVolumeEntryEvidenceRevision,
  deriveVolumeIntentKey,
  deriveVolumeRecoveryConsumptionRevision,
  deriveVolumeRecoveryRetryRevision,
  digest,
  finalizeProjection,
  snapshot,
  sortedUnique,
  validateVolumeLifecycleActionRequest,
  validateLifecycleInput,
  validateLifecycleProjection,
  validateVolumeOccupancyProjection,
} from './validation.js';

const AUTHORITY = Object.freeze({
  lifecycleAuthority: 'ADVISORY_LIFECYCLE_PROJECTION_ONLY' as const,
  simulationAuthority: 'SYNTHETIC_FIXTURE' as const,
  sendEligible: false as const,
  actionAuthority: 'NONE_RECORD_ONLY' as const,
  externalActionAuthorization: 'NONE' as const,
});

const ACTION_KEY = /^l11action_[0-9a-f]{64}$/u;
const UNRESOLVED_TWIN_REASON_CODES = new Set([
  'CANONICAL_RECOVERY_TWIN_EVIDENCE_CONFLICT',
  'CANONICAL_RECOVERY_TWIN_EVIDENCE_UNRESOLVED',
  'CANONICAL_NO_EFFECT_LATE_TWIN_CONFLICT',
  'LATE_TWIN_EVIDENCE_REQUIRES_RECONCILIATION',
  'SETTLED_TWIN_REPLAY_MISMATCH',
  'ORPHAN_TWIN_EVIDENCE',
  'TWIN_CHRONOLOGY_INVALID',
  'TWIN_EFFECT_RECONSTRUCTION_REQUIRED',
  'UNRESOLVED_TWIN_CONFLICT_REQUIRES_RECONSTRUCTION',
]);

const EXIT_REASON_ORDER = Object.freeze([
  'RECONCILIATION_MISMATCH',
  'RECONCILIATION_UNKNOWN',
  'ACTIVE_MARKET_TRUTH_INCOMPLETE',
  'ACTIVE_ACCOUNT_TRUTH_INCOMPLETE',
  'ACTIVE_POSITION_TRUTH_INCOMPLETE',
  'ACTIVE_MARKET_EVIDENCE_STALE',
  'ACTIVE_SIGNAL_EVIDENCE_STALE',
  'ACTIVE_MARKET_SIGNAL_PRICE_MISMATCH',
  'VOLUME_REVERSAL_UNKNOWN',
  'VOLUME_EXHAUSTION_UNKNOWN',
  'GLOBAL_HALT',
  'MANUAL_CLOSE',
  'THESIS_INVALIDATED',
  'THESIS_INVALIDATION_UNKNOWN',
  'VOLUME_REVERSAL',
  'MAXIMUM_LOSS_REACHED',
  'TRAILING_STOP_REACHED',
  'TIME_STOP_REACHED',
  'SOURCE_DEGRADED_EXIT',
  'SPREAD_DEPTH_DETERIORATED',
  'SPREAD_DEPTH_UNKNOWN',
  'VOLUME_EXHAUSTION',
  'SOURCE_DEGRADED_REDUCE',
] as const);

const ENTRY_REASON_ORDER = Object.freeze([
  'POLICY_NOT_EFFECTIVE',
  'EVALUATION_TIME_REGRESSION',
  'PROPOSAL_NOT_OPEN',
  'PROPOSAL_EXPIRED',
  'PROPOSAL_TIME_INVALID',
  'PROPOSAL_STAGE_UNKNOWN',
  'PROPOSAL_EXHAUSTED',
  'ADVISORY_NOT_OBSERVED',
  'ADVISORY_NOT_CONSIDERATION',
  'ADVISORY_EXPIRED',
  'ADVISORY_ECONOMICALLY_EXPIRED',
  'ADVISORY_SOURCE_NOT_COMPLETE',
  'ADVISORY_STAGE_UNKNOWN',
  'ADVISORY_EXHAUSTED',
  'ADVISORY_REVERSAL_PRESENT',
  'ADVISORY_REVERSAL_UNKNOWN',
  'ADVISORY_BINDING_MISMATCH',
  'FADE_NOT_EXPLICITLY_ELIGIBLE',
  'GLOBAL_HALT_BLOCKS_INCREASE',
  'MANUAL_CLOSE_BLOCKS_INCREASE',
  'THESIS_INVALIDATED_BLOCKS_INCREASE',
  'THESIS_INVALIDATION_UNKNOWN_BLOCKS_INCREASE',
  'VOLUME_REVERSAL_BLOCKS_INCREASE',
  'VOLUME_REVERSAL_UNKNOWN_BLOCKS_INCREASE',
  'VOLUME_EXHAUSTION_BLOCKS_INCREASE',
  'VOLUME_EXHAUSTION_UNKNOWN_BLOCKS_INCREASE',
  'SOURCE_STATE_BLOCKS_INCREASE',
  'SPREAD_DEPTH_BLOCKS_INCREASE',
  'SYSTEM_MODE_NOT_VALIDATE_ONLY',
  'CAPITAL_NOT_ACTIVE',
  'CAPITAL_EXPIRED',
  'CAPITAL_CONSUMPTION_INVALID',
  'RISK_NOT_ALLOWED',
  'RISK_EXPIRED',
  'RISK_CONTEXT_MISMATCH',
  'APPROVAL_NOT_VALIDATE_ONLY',
  'APPROVAL_EXPIRED',
  'ACCOUNT_TRUTH_NOT_COMPLETE',
  'POSITION_TRUTH_NOT_COMPLETE',
  'RECONCILIATION_NOT_EXACT',
  'MARKET_TRUTH_NOT_COMPLETE',
  'MARKET_EVIDENCE_EXPIRED',
  'MARKET_EVIDENCE_TOO_OLD',
  'MARKET_PRICE_BOUND_EXCEEDED',
  'MARKET_DEPTH_INSUFFICIENT',
  'MARKET_SPREAD_EXCEEDED',
  'MARKET_SIGNAL_PRICE_MISMATCH',
  'SIGNAL_EVIDENCE_EXPIRED',
  'SIGNAL_EVIDENCE_TOO_OLD',
  'SIZING_NOT_READY',
  'SIZING_EXPIRED',
  'SIZING_EVIDENCE_TOO_OLD',
  'SIZING_STAGE_CAP_INVALID',
  'SIZING_QUANTITY_NOTIONAL_INCOHERENT',
  'SIZING_PRICE_BOUND_WIDENED',
  'SIZING_OWNER_BINDING_MISMATCH',
  'SHORT_INVENTORY_NOT_PROVED',
  'SHORT_INVENTORY_EXPIRED',
  'OCCUPANCY_TRUTH_NOT_COMPLETE',
  'OCCUPANCY_EXPIRED',
  'ONE_POSITION_LIMIT',
  'NO_REPEAT_LIFECYCLE',
  'CANONICAL_PROJECTION_REVISION_MISMATCH',
  'CANONICAL_OCCUPANCY_BINDING_MISMATCH',
  'OCCUPANCY_HISTORY_TIME_INVALID',
  'CURRENT_BINDING_MISMATCH',
  'POLICY_REVISION_NOT_ADOPTED',
] as const);

type ProjectionDraft = Omit<VolumeLifecycleProjection, 'projectionRevision'>;

function orderReasons(reasons: Iterable<string>, order: readonly string[]): readonly string[] {
  const set = new Set(reasons);
  const ordered = order.filter((reason) => set.delete(reason));
  return Object.freeze([...ordered, ...[...set].sort()]);
}

function evidenceIds(input: Readonly<VolumeLifecycleInput>): readonly string[] {
  return sortedUnique([
    ...input.proposal.evidenceIds,
    ...input.advisory.evidenceIds,
    ...input.market.evidenceIds,
    ...input.signals.evidenceIds,
  ]);
}

function entryEvidenceMaterial(input: Readonly<VolumeLifecycleInput>): Readonly<Record<string, unknown>> {
  return {
    symbol: input.proposal.symbol,
    direction: input.proposal.direction,
    accountRealmId: input.sizing.accountRealmId,
    baseAsset: input.sizing.baseAsset,
    quoteAsset: input.sizing.quoteAsset,
    proposalId: input.proposal.proposalId,
    proposalRevision: input.proposal.proposalRevision,
    proposalDigest: input.proposal.proposalDigest,
    entryKind: input.proposal.entryKind,
    featureRevision: input.proposal.featureRevision,
    evidenceRevision: input.proposal.evidenceRevision,
    exitPlanRevision: input.proposal.exitPlanRevision,
    invalidationConditions: input.proposal.invalidationConditions,
    assessmentId: input.advisory.assessmentId,
    assessmentRevision: input.advisory.assessmentRevision,
    assessmentFingerprintSha256: input.advisory.assessmentFingerprintSha256,
    advisoryModelRevision: input.advisory.modelRevision,
    advisoryFeatureRevision: input.advisory.featureRevision,
    advisoryEvidenceRevision: input.advisory.evidenceRevision,
    entryInstrumentRevision: input.sizing.instrumentRevision,
    entryFilterRevision: input.sizing.filterRevision,
    entrySourceEvidenceRevision: input.sizing.sourceEvidenceRevision,
    entrySizingCuts: input.sizing.cuts,
    entryInventoryMode: input.sizing.inventoryMode,
    entryAvailableBaseQuantity: input.sizing.availableBaseQuantity,
    entryInventoryRevision: input.sizing.inventoryRevision,
    entryInventoryAsset: input.sizing.inventoryAsset,
    entryInventoryAccountRealmId: input.sizing.inventoryAccountRealmId,
    entryInventoryObservedAtMs: input.sizing.inventoryObservedAtMs,
    entryInventoryValidUntilMs: input.sizing.inventoryValidUntilMs,
    entryBookRevision: input.market.bookRevision,
    entryCostRevision: input.market.costRevision,
    entryDownsideRevision: input.market.downsideRevision,
    capitalMandateId: input.authority.capitalMandateId,
    capitalMandateRevision: input.authority.capitalMandateRevision,
    capitalMandateDigest: input.authority.capitalMandateDigest,
    capitalReservationId: input.authority.capitalReservationId,
    capitalReservationRevision: input.authority.capitalReservationRevision,
    capitalMaximumQuote: input.authority.capitalMaximumQuote,
  };
}

function entryEvidenceRevision(input: Readonly<VolumeLifecycleInput>): string {
  return deriveVolumeEntryEvidenceRevision(entryEvidenceMaterial(input));
}

function ownerEvidenceRevision(input: Readonly<VolumeLifecycleInput>): string {
  return digest('l11owner_', {
    proposal: {
      proposalId: input.proposal.proposalId,
      proposalRevision: input.proposal.proposalRevision,
      proposalDigest: input.proposal.proposalDigest,
      status: input.proposal.status,
      entryKind: input.proposal.entryKind,
      marketStage: input.proposal.marketStage,
      featureRevision: input.proposal.featureRevision,
      evidenceRevision: input.proposal.evidenceRevision,
      exitPlanRevision: input.proposal.exitPlanRevision,
      invalidationConditions: input.proposal.invalidationConditions,
      evidenceIds: input.proposal.evidenceIds,
    },
    advisory: {
      assessmentId: input.advisory.assessmentId,
      assessmentRevision: input.advisory.assessmentRevision,
      assessmentFingerprintSha256: input.advisory.assessmentFingerprintSha256,
      modelRevision: input.advisory.modelRevision,
      featureRevision: input.advisory.featureRevision,
      evidenceRevision: input.advisory.evidenceRevision,
      stage: input.advisory.stage,
      exhaustion: input.advisory.exhaustion,
      reversal: input.advisory.reversal,
      fadeEligible: input.advisory.fadeEligible,
      evidenceIds: input.advisory.evidenceIds,
    },
    policyRevision: input.policy.policyRevision,
    sizing: {
      owner: input.sizing.owner,
      state: input.sizing.state,
      product: input.sizing.product,
      symbol: input.sizing.symbol,
      baseAsset: input.sizing.baseAsset,
      quoteAsset: input.sizing.quoteAsset,
      accountRealmId: input.sizing.accountRealmId,
      instrumentRevision: input.sizing.instrumentRevision,
      filterRevision: input.sizing.filterRevision,
      sourceEvidenceRevision: input.sizing.sourceEvidenceRevision,
      inventoryMode: input.sizing.inventoryMode,
      availableBaseQuantity: input.sizing.availableBaseQuantity,
      inventoryRevision: input.sizing.inventoryRevision,
      inventoryAsset: input.sizing.inventoryAsset,
      inventoryAccountRealmId: input.sizing.inventoryAccountRealmId,
      cuts: input.sizing.cuts,
    },
    market: {
      currentPrice: input.market.currentPrice,
      intendedPriceBound: input.market.intendedPriceBound,
      riskReductionPriceBound: input.market.riskReductionPriceBound,
      intendedDepthQuote: input.market.intendedDepthQuote,
      spreadBps: input.market.spreadBps,
      bookRevision: input.market.bookRevision,
      costRevision: input.market.costRevision,
      downsideRevision: input.market.downsideRevision,
      evidenceIds: input.market.evidenceIds,
    },
    signals: {
      thesisInvalidated: input.signals.thesisInvalidated,
      exhaustion: input.signals.exhaustion,
      reversal: input.signals.reversal,
      confirmation: input.signals.confirmation,
      addPermission: input.signals.addPermission,
      manualClose: input.signals.manualClose,
      globalHalt: input.signals.globalHalt,
      sourceState: input.signals.sourceState,
      spreadDepthState: input.signals.spreadDepthState,
      currentPrice: input.signals.currentPrice,
      evidenceIds: input.signals.evidenceIds,
    },
  });
}

export function deriveVolumeRiskContextRevision(input: Readonly<VolumeLifecycleInput>): string {
  const safeInput = snapshot(input);
  const { riskContextRevision: _revision, ...authority } = safeInput.authority;
  return digest('l11riskcontext_', {
    authority,
    currentLifecycleId: safeInput.current?.lifecycleId ?? null,
    currentProjectionRevision: safeInput.current?.projectionRevision ?? null,
    currentPositionQuantity: safeInput.current?.positionQuantity ?? '0',
    proposal: safeInput.proposal,
    advisory: safeInput.advisory,
    policyRevision: safeInput.policy.policyRevision,
    sizing: safeInput.sizing,
    market: safeInput.market,
    signals: safeInput.signals,
  });
}

function transition(
  from: VolumeLifecycleState | null,
  to: VolumeLifecycleState,
  reasons: readonly string[],
  input: Readonly<VolumeLifecycleInput>,
  twinOutcomeRevision: string | null = null,
) {
  const occurredAtMs = Math.max(input.evaluatedAtMs,
    input.current?.lastTransition.occurredAtMs ?? input.evaluatedAtMs);
  return deepFreeze({
    from,
    to,
    primaryReasonCode: reasons[0],
    reasonCodes: Object.freeze([...reasons]),
    occurredAtMs,
    evidenceIds: evidenceIds(input),
    twinOutcomeRevision,
  });
}

function projectionDraft(
  input: Readonly<VolumeLifecycleInput>,
  lifecycleId: string,
  state: VolumeLifecycleState,
  pendingAction: Readonly<VolumeLifecycleActionRequest> | null,
): ProjectionDraft {
  return {
    schema: VOLUME_LIFECYCLE_PROJECTION_SCHEMA,
    lifecycleId,
    revision: 1,
    symbol: input.proposal.symbol,
    direction: input.proposal.direction,
    accountRealmId: input.sizing.accountRealmId,
    baseAsset: input.sizing.baseAsset,
    quoteAsset: input.sizing.quoteAsset,
    proposalId: input.proposal.proposalId,
    proposalRevision: input.proposal.proposalRevision,
    proposalDigest: input.proposal.proposalDigest,
    entryKind: input.proposal.entryKind,
    featureRevision: input.proposal.featureRevision,
    evidenceRevision: input.proposal.evidenceRevision,
    exitPlanRevision: input.proposal.exitPlanRevision,
    invalidationConditions: Object.freeze([...input.proposal.invalidationConditions]),
    assessmentId: input.advisory.assessmentId,
    assessmentRevision: input.advisory.assessmentRevision,
    assessmentFingerprintSha256: input.advisory.assessmentFingerprintSha256,
    advisoryModelRevision: input.advisory.modelRevision,
    advisoryFeatureRevision: input.advisory.featureRevision,
    advisoryEvidenceRevision: input.advisory.evidenceRevision,
    entryInstrumentRevision: input.sizing.instrumentRevision,
    entryFilterRevision: input.sizing.filterRevision,
    entrySourceEvidenceRevision: input.sizing.sourceEvidenceRevision,
    entrySizingCuts: Object.freeze(input.sizing.cuts.map((cut) => Object.freeze({ ...cut }))),
    entryInventoryMode: input.sizing.inventoryMode,
    entryAvailableBaseQuantity: input.sizing.availableBaseQuantity,
    entryInventoryRevision: input.sizing.inventoryRevision,
    entryInventoryAsset: input.sizing.inventoryAsset,
    entryInventoryAccountRealmId: input.sizing.inventoryAccountRealmId,
    entryInventoryObservedAtMs: input.sizing.inventoryObservedAtMs,
    entryInventoryValidUntilMs: input.sizing.inventoryValidUntilMs,
    entryBookRevision: input.market.bookRevision,
    entryCostRevision: input.market.costRevision,
    entryDownsideRevision: input.market.downsideRevision,
    entryEvidenceRevision: entryEvidenceRevision(input),
    capitalMandateId: input.authority.capitalMandateId,
    capitalMandateRevision: input.authority.capitalMandateRevision,
    capitalMandateDigest: input.authority.capitalMandateDigest,
    capitalReservationId: input.authority.capitalReservationId,
    capitalReservationRevision: input.authority.capitalReservationRevision,
    capitalMaximumQuote: input.authority.capitalMaximumQuote,
    policyRevision: input.policy.policyRevision,
    state,
    recoveryResumeState: null,
    openedAtMs: null,
    stageEnteredAtMs: input.evaluatedAtMs,
    entryAveragePrice: null,
    entryCostBasisQuote: '0',
    entryCostBasisQuantity: '0',
    currentPrice: input.signals.currentPrice,
    favorableExtremePrice: null,
    lastMarketObservedAtMs: null,
    lastSignalObservedAtMs: null,
    lastMarketObservationRevision: null,
    lastSignalObservationRevision: null,
    positionQuantity: '0',
    positionQuantityTruth: 'EXACT',
    mandateUsageAtLifecycleStartQuote: input.authority.capitalConsumedQuote,
    projectedMandateUsageQuote: input.authority.capitalConsumedQuote,
    capitalUsageTruth: 'EXACT',
    lastNoFill: null,
    reductionEpisodeRevision: null,
    reductionEpisodeReasonCodes: null,
    reductionBasisQuantity: null,
    reductionTargetQuantity: null,
    pendingAction,
    pendingActionBaseProjectionRevision: null,
    pendingTwinStateRevision: null,
    pendingTwinOutcomeRevision: null,
    lastSettledActionKey: null,
    lastTwinStateRevision: null,
    lastTwinOutcomeRevision: null,
    settledTwinHistory: Object.freeze([]),
    recoveryEvidenceActionKey: null,
    recoveryEvidenceFixtureId: null,
    recoveryEvidenceTwinStateRevision: null,
    recoveryEvidenceTwinOutcomeRevision: null,
    unresolvedTwinConflict: null,
    lastRecoveryResolutionRevision: null,
    lastRecoveryResolvedAtMs: null,
    consumedRecoveryRevisions: Object.freeze([]),
    recoveryConsumptionHistory: Object.freeze([]),
    terminalOutcomeReasonCodes: null,
    feedbackOutcomeRevision: null,
    lastTransition: transition(null, state, ['LIFECYCLE_PROJECTION_CREATED'], input),
    ...AUTHORITY,
  };
}

function decision(
  disposition: VolumeLifecycleDecision['disposition'],
  reasons: readonly string[],
  projection: Readonly<VolumeLifecycleProjection> | null,
  actionRequest: Readonly<VolumeLifecycleActionRequest> | null = null,
  twinSettlement: Readonly<VolumeTwinSettlement> | null = null,
  recoveryHandoff: Readonly<VolumeRecoveryHandoff> | null = null,
  feedbackHandoff: Readonly<VolumeFeedbackHandoff> | null = null,
): Readonly<VolumeLifecycleDecision> {
  const verifiedProjection = projection === null ? null : validateLifecycleProjection(projection);
  const retainedAction = verifiedProjection?.pendingAction ?? null;
  if ((retainedAction?.actionKey ?? null) !== (actionRequest?.actionKey ?? null)) {
    throw new TypeError('Volume decision action request is not the retained pending action');
  }
  if (recoveryHandoff !== null
    && (verifiedProjection?.state !== 'RECOVERY_REQUIRED'
      || recoveryHandoff.actionKey !== verifiedProjection.recoveryEvidenceActionKey
      || recoveryHandoff.fixtureId !== verifiedProjection.recoveryEvidenceFixtureId
      || recoveryHandoff.twinStateRevision !== verifiedProjection.recoveryEvidenceTwinStateRevision
      || recoveryHandoff.twinOutcomeRevision !== verifiedProjection.recoveryEvidenceTwinOutcomeRevision)) {
    throw new TypeError('Volume recovery handoff is not bound to its recovery projection');
  }
  if (feedbackHandoff !== null
    && (verifiedProjection?.state !== 'EXIT'
      || feedbackHandoff.outcomeRevision !== verifiedProjection.feedbackOutcomeRevision)) {
    throw new TypeError('Volume feedback handoff is not bound to its terminal projection');
  }
  const semantic = {
    disposition,
    primaryReasonCode: reasons[0],
    reasonCodes: [...reasons],
    projectionRevision: verifiedProjection?.projectionRevision ?? null,
    actionKey: actionRequest?.actionKey ?? null,
    twinOutcomeRevision: twinSettlement?.twinOutcomeRevision ?? null,
    recoveryKind: recoveryHandoff?.kind ?? null,
    feedbackTerminalState: feedbackHandoff?.terminalState ?? null,
  };
  return deepFreeze({
    schema: VOLUME_LIFECYCLE_DECISION_SCHEMA,
    disposition,
    primaryReasonCode: reasons[0],
    reasonCodes: Object.freeze([...reasons]),
    projection: verifiedProjection,
    actionRequest: retainedAction,
    twinSettlement,
    recoveryHandoff,
    feedbackHandoff,
    decisionRevision: digest('l11decision_', semantic),
    ...AUTHORITY,
  });
}

function lifecycleId(input: Readonly<VolumeLifecycleInput>): string {
  const binding = input.current;
  return digest('l11lifecycle_', {
    symbol: input.proposal.symbol,
    direction: input.proposal.direction,
    proposalId: input.proposal.proposalId,
    proposalRevision: input.proposal.proposalRevision,
    assessmentId: input.advisory.assessmentId,
    assessmentRevision: input.advisory.assessmentRevision,
    mandateId: binding?.capitalMandateId ?? input.authority.capitalMandateId,
    mandateRevision: binding?.capitalMandateRevision ?? input.authority.capitalMandateRevision,
    mandateDigest: binding?.capitalMandateDigest ?? input.authority.capitalMandateDigest,
    reservationId: binding?.capitalReservationId ?? input.authority.capitalReservationId,
    reservationRevision: binding?.capitalReservationRevision ?? input.authority.capitalReservationRevision,
    capitalMaximumQuote: binding?.capitalMaximumQuote ?? input.authority.capitalMaximumQuote,
    entryEvidenceRevision: binding?.entryEvidenceRevision ?? entryEvidenceRevision(input),
  });
}

function stageCut(input: Readonly<VolumeLifecycleInput>, state: 'PROBE' | 'CONFIRM' | 'HOLD') {
  return input.sizing.cuts.find((candidate) => candidate.targetState === state) as (typeof input.sizing.cuts)[number];
}

function stagePpm(policy: Readonly<VolumeProtectionPolicy>, state: 'PROBE' | 'CONFIRM' | 'HOLD'): number {
  if (state === 'PROBE') return policy.probeCumulativePpm;
  if (state === 'CONFIRM') return policy.confirmCumulativePpm;
  return policy.fullCumulativePpm;
}

function entryGateReasons(input: Readonly<VolumeLifecycleInput>, id: string): readonly string[] {
  const reasons: string[] = [];
  const now = input.evaluatedAtMs;
  if (input.policy.effectiveFromMs > now) reasons.push('POLICY_NOT_EFFECTIVE');
  if (input.current !== null && now < input.current.lastTransition.occurredAtMs) reasons.push('EVALUATION_TIME_REGRESSION');
  if (input.proposal.status !== 'OPEN' && input.proposal.status !== 'UPDATED') reasons.push('PROPOSAL_NOT_OPEN');
  if (now >= input.proposal.expiresAtMs) reasons.push('PROPOSAL_EXPIRED');
  if (input.proposal.createdAtMs > input.proposal.observedAtMs || input.proposal.observedAtMs > now) reasons.push('PROPOSAL_TIME_INVALID');
  if (input.proposal.marketStage === 'UNKNOWN') reasons.push('PROPOSAL_STAGE_UNKNOWN');
  if (input.proposal.marketStage === 'EXHAUSTED' && input.proposal.entryKind !== 'FADE') reasons.push('PROPOSAL_EXHAUSTED');
  if (input.advisory.state !== 'OBSERVED' || input.advisory.ownerReference === null) reasons.push('ADVISORY_NOT_OBSERVED');
  if (input.advisory.advisoryAction !== 'PROPOSE_CONSIDERATION') reasons.push('ADVISORY_NOT_CONSIDERATION');
  if (now >= input.advisory.expiresAtMs) reasons.push('ADVISORY_EXPIRED');
  if (now >= input.advisory.economicExpiresAtMs) reasons.push('ADVISORY_ECONOMICALLY_EXPIRED');
  if (input.advisory.sourceQuality !== 'COMPLETE') reasons.push('ADVISORY_SOURCE_NOT_COMPLETE');
  if (input.advisory.observedAtMs > now) reasons.push('ADVISORY_NOT_OBSERVED');
  if (input.advisory.stage === 'UNKNOWN') reasons.push('ADVISORY_STAGE_UNKNOWN');
  if (input.advisory.exhaustion === 'PRESENT' && input.proposal.entryKind !== 'FADE') reasons.push('ADVISORY_EXHAUSTED');
  else if (input.advisory.exhaustion === 'UNKNOWN') reasons.push('ADVISORY_EXHAUSTION_UNKNOWN');
  if (input.advisory.reversal === 'PRESENT') reasons.push('ADVISORY_REVERSAL_PRESENT');
  if (input.advisory.reversal === 'UNKNOWN') reasons.push('ADVISORY_REVERSAL_UNKNOWN');
  if (input.advisory.featureRevision !== input.proposal.featureRevision
    || input.advisory.evidenceRevision !== input.proposal.evidenceRevision) reasons.push('ADVISORY_BINDING_MISMATCH');
  if (input.proposal.entryKind === 'FADE'
    && (!input.advisory.fadeEligible || input.advisory.stage !== 'FADE')) reasons.push('FADE_NOT_EXPLICITLY_ELIGIBLE');
  if (input.signals.globalHalt) reasons.push('GLOBAL_HALT_BLOCKS_INCREASE');
  if (input.signals.manualClose) reasons.push('MANUAL_CLOSE_BLOCKS_INCREASE');
  if (input.signals.thesisInvalidated === true) reasons.push('THESIS_INVALIDATED_BLOCKS_INCREASE');
  else if (input.signals.thesisInvalidated === null) reasons.push('THESIS_INVALIDATION_UNKNOWN_BLOCKS_INCREASE');
  if (input.signals.reversal === 'PRESENT') reasons.push('VOLUME_REVERSAL_BLOCKS_INCREASE');
  else if (input.signals.reversal === 'UNKNOWN') reasons.push('VOLUME_REVERSAL_UNKNOWN_BLOCKS_INCREASE');
  if (input.signals.exhaustion === 'PRESENT' && input.proposal.entryKind !== 'FADE') {
    reasons.push('VOLUME_EXHAUSTION_BLOCKS_INCREASE');
  } else if (input.signals.exhaustion === 'UNKNOWN') reasons.push('VOLUME_EXHAUSTION_UNKNOWN_BLOCKS_INCREASE');
  if (input.signals.sourceState !== 'HEALTHY') reasons.push('SOURCE_STATE_BLOCKS_INCREASE');
  if (input.signals.spreadDepthState !== 'HEALTHY') reasons.push('SPREAD_DEPTH_BLOCKS_INCREASE');
  if (input.authority.systemMode !== 'VALIDATE_ONLY') reasons.push('SYSTEM_MODE_NOT_VALIDATE_ONLY');
  if (input.authority.capitalState !== 'ACTIVE') reasons.push('CAPITAL_NOT_ACTIVE');
  if (now >= input.authority.capitalExpiresAtMs) reasons.push('CAPITAL_EXPIRED');
  if (compareVolumeDecimals(input.authority.capitalConsumedQuote, input.authority.capitalMaximumQuote) > 0) {
    reasons.push('CAPITAL_CONSUMPTION_INVALID');
  }
  if (input.authority.riskState !== 'ALLOWED') reasons.push('RISK_NOT_ALLOWED');
  if (now >= input.authority.riskExpiresAtMs || input.authority.riskEvaluatedAtMs > now
    || (input.current !== null
      && input.authority.riskEvaluatedAtMs < input.current.lastTransition.occurredAtMs)
    || input.authority.riskEvaluatedAtMs < input.proposal.observedAtMs
    || input.authority.riskEvaluatedAtMs < input.advisory.observedAtMs
    || input.authority.riskEvaluatedAtMs < input.market.observedAtMs
    || input.authority.riskEvaluatedAtMs < input.signals.observedAtMs
    || input.authority.riskEvaluatedAtMs < input.sizing.observedAtMs
    || input.authority.riskEvaluatedAtMs < input.occupancy.observedAtMs
    || (input.sizing.inventoryObservedAtMs !== null
      && input.authority.riskEvaluatedAtMs < input.sizing.inventoryObservedAtMs)) reasons.push('RISK_EXPIRED');
  const expectedRiskLifecycle = input.current?.lifecycleId ?? null;
  const expectedRiskProjection = input.current?.projectionRevision ?? null;
  const expectedRiskQuantity = input.current?.positionQuantity ?? '0';
  if (input.authority.riskBoundLifecycleId !== expectedRiskLifecycle
    || input.authority.riskBoundProjectionRevision !== expectedRiskProjection
    || input.authority.riskBoundPositionQuantity !== expectedRiskQuantity
    || input.authority.riskContextRevision !== deriveVolumeRiskContextRevision(input)) {
    reasons.push('RISK_CONTEXT_MISMATCH');
  }
  if (input.authority.approvalState !== 'VALIDATE_ONLY' || input.authority.approvalId === null
    || input.authority.approvalRevision === null || input.authority.approvalExpiresAtMs === null) {
    reasons.push('APPROVAL_NOT_VALIDATE_ONLY');
  } else if (now >= input.authority.approvalExpiresAtMs) reasons.push('APPROVAL_EXPIRED');
  if (input.authority.accountTruth !== 'COMPLETE') reasons.push('ACCOUNT_TRUTH_NOT_COMPLETE');
  if (input.authority.positionTruth !== 'COMPLETE') reasons.push('POSITION_TRUTH_NOT_COMPLETE');
  if (input.signals.reconciliationState !== 'EXACT') reasons.push('RECONCILIATION_NOT_EXACT');
  if (input.market.truth !== 'COMPLETE') reasons.push('MARKET_TRUTH_NOT_COMPLETE');
  if (now >= input.market.validUntilMs) reasons.push('MARKET_EVIDENCE_EXPIRED');
  if (now < input.market.observedAtMs || now - input.market.observedAtMs > input.policy.maximumEvidenceAgeMs) {
    reasons.push('MARKET_EVIDENCE_TOO_OLD');
  }
  if ((input.proposal.direction === 'LONG'
      && compareVolumeDecimals(input.market.currentPrice, input.market.intendedPriceBound) > 0)
    || (input.proposal.direction === 'SHORT'
      && compareVolumeDecimals(input.market.currentPrice, input.market.intendedPriceBound) < 0)) {
    reasons.push('MARKET_PRICE_BOUND_EXCEEDED');
  }
  if (compareVolumeDecimals(input.market.intendedDepthQuote, input.market.minimumDepthQuote) < 0) {
    reasons.push('MARKET_DEPTH_INSUFFICIENT');
  }
  if (input.market.spreadBps > input.market.maximumSpreadBps) reasons.push('MARKET_SPREAD_EXCEEDED');
  if (input.market.currentPrice !== input.signals.currentPrice) reasons.push('MARKET_SIGNAL_PRICE_MISMATCH');
  if (now >= input.signals.validUntilMs) reasons.push('SIGNAL_EVIDENCE_EXPIRED');
  if (now < input.signals.observedAtMs || now - input.signals.observedAtMs > input.policy.maximumEvidenceAgeMs) {
    reasons.push('SIGNAL_EVIDENCE_TOO_OLD');
  }
  if (input.sizing.state !== 'READY') reasons.push('SIZING_NOT_READY');
  if (now >= input.sizing.validUntilMs) reasons.push('SIZING_EXPIRED');
  if (now < input.sizing.observedAtMs || now - input.sizing.observedAtMs > input.policy.maximumEvidenceAgeMs) {
    reasons.push('SIZING_EVIDENCE_TOO_OLD');
  }
  if (input.sizing.product !== 'SPOT' || input.sizing.symbol !== input.proposal.symbol
    || input.sizing.quoteAsset !== 'USDT') reasons.push('SIZING_OWNER_BINDING_MISMATCH');
  const inventoryProof = [input.sizing.availableBaseQuantity, input.sizing.inventoryRevision,
    input.sizing.inventoryAsset, input.sizing.inventoryAccountRealmId,
    input.sizing.inventoryObservedAtMs, input.sizing.inventoryValidUntilMs];
  if (input.proposal.direction === 'LONG'
    && (input.sizing.inventoryMode !== 'QUOTE_FUNDED_LONG'
      || inventoryProof.some((entry) => entry !== null))) {
    reasons.push('SIZING_OWNER_BINDING_MISMATCH');
  }
  let priorQuantity = '0';
  let priorNotional = '0';
  for (const cut of input.sizing.cuts) {
    const ceiling = multiplyVolumePpm(input.authority.capitalMaximumQuote, stagePpm(input.policy, cut.targetState));
    const quantityMonotonic = compareVolumeDecimals(cut.cumulativeQuantity, priorQuantity) > 0;
    const notionalMonotonic = compareVolumeDecimals(cut.cumulativeNotionalQuote, priorNotional) > 0;
    if (compareVolumeDecimals(cut.cumulativeQuantity, priorQuantity) <= 0
      || compareVolumeDecimals(cut.cumulativeNotionalQuote, priorNotional) <= 0
      || compareVolumeDecimals(cut.cumulativeNotionalQuote, ceiling) > 0
      || compareVolumeDecimals(addVolumeDecimals(input.authority.capitalConsumedQuote, cut.cumulativeNotionalQuote), input.authority.capitalMaximumQuote) > 0) {
      reasons.push('SIZING_STAGE_CAP_INVALID');
    }
    if (compareVolumeDecimals(
      multiplyVolumeDecimals(cut.cumulativeQuantity, cut.priceBound),
      cut.cumulativeNotionalQuote,
    ) > 0 || (quantityMonotonic && notionalMonotonic
      && compareVolumeDecimals(
        multiplyVolumeDecimals(subtractVolumeDecimals(cut.cumulativeQuantity, priorQuantity), cut.priceBound),
        subtractVolumeDecimals(cut.cumulativeNotionalQuote, priorNotional),
      ) > 0)) {
      reasons.push('SIZING_QUANTITY_NOTIONAL_INCOHERENT');
    }
    if ((input.proposal.direction === 'LONG'
        && compareVolumeDecimals(cut.priceBound, input.market.intendedPriceBound) > 0)
      || (input.proposal.direction === 'SHORT'
        && compareVolumeDecimals(cut.priceBound, input.market.intendedPriceBound) < 0)) {
      reasons.push('SIZING_PRICE_BOUND_WIDENED');
    }
    priorQuantity = cut.cumulativeQuantity;
    priorNotional = cut.cumulativeNotionalQuote;
  }
  if (input.proposal.direction === 'LONG' && input.sizing.inventoryMode !== 'QUOTE_FUNDED_LONG') {
    reasons.push('SHORT_INVENTORY_NOT_PROVED');
  }
  if (input.proposal.direction === 'SHORT'
    && (input.sizing.inventoryMode !== 'PREOWNED_BASE_SHORT'
      || input.sizing.availableBaseQuantity === null || input.sizing.inventoryRevision === null
      || input.sizing.inventoryAsset !== input.sizing.baseAsset
      || input.sizing.inventoryAccountRealmId !== input.sizing.accountRealmId
      || compareVolumeDecimals(input.sizing.availableBaseQuantity, stageCut(input, 'HOLD').cumulativeQuantity) < 0)) {
    reasons.push('SHORT_INVENTORY_NOT_PROVED');
  }
  if (input.proposal.direction === 'SHORT'
    && (input.sizing.inventoryObservedAtMs === null || input.sizing.inventoryValidUntilMs === null
      || input.sizing.inventoryObservedAtMs > now || input.sizing.inventoryValidUntilMs <= now
      || now - input.sizing.inventoryObservedAtMs > input.policy.maximumEvidenceAgeMs)) {
    reasons.push('SHORT_INVENTORY_EXPIRED');
  }
  if (input.occupancy.truth !== 'COMPLETE') reasons.push('OCCUPANCY_TRUTH_NOT_COMPLETE');
  if (now >= input.occupancy.validUntilMs || now < input.occupancy.observedAtMs) reasons.push('OCCUPANCY_EXPIRED');
  if (input.current === null && input.occupancy.activeRecords.some((record) => record.symbol === input.proposal.symbol
    && record.state !== 'CLOSED')) reasons.push('ONE_POSITION_LIMIT');
  if (input.current === null && input.occupancy.activeRecords.some((record) => (
    record.ownerFamily === 'VOLUME_LIFECYCLE_ADAPTER'
    && record.state === 'CLOSED'
    && (record.lifecycleId === id || record.proposalId === input.proposal.proposalId
      || record.assessmentId === input.advisory.assessmentId)
  ))) reasons.push('NO_REPEAT_LIFECYCLE');
  if (input.occupancy.priorActions.some((record) => record.recordedAtMs > now
    || record.recordedAtMs > input.occupancy.observedAtMs)) {
    reasons.push('OCCUPANCY_HISTORY_TIME_INVALID');
  }
  if (input.current === null && input.occupancy.priorActions.some((record) => {
    if (record.recordedAtMs > now) return false;
    const sameOwnerSignal = record.lifecycleId === id || record.proposalId === input.proposal.proposalId
      || record.assessmentId === input.advisory.assessmentId;
    if (record.state === 'TERMINAL') return sameOwnerSignal;
    const sameDirectionalScope = record.symbol === input.proposal.symbol
      && record.direction === input.proposal.direction;
    return sameDirectionalScope && now - record.recordedAtMs < input.policy.noRepeatWindowMs;
  })) reasons.push('NO_REPEAT_LIFECYCLE');
  if (input.current !== null) {
    if (input.current.lifecycleId !== id || input.current.symbol !== input.proposal.symbol
      || input.current.proposalId !== input.proposal.proposalId
      || input.current.assessmentId !== input.advisory.assessmentId
      || input.current.capitalMandateId !== input.authority.capitalMandateId
      || input.current.capitalMandateDigest !== input.authority.capitalMandateDigest
      || input.current.capitalReservationId !== input.authority.capitalReservationId
      || input.current.capitalReservationRevision !== input.authority.capitalReservationRevision
      || input.current.capitalMaximumQuote !== input.authority.capitalMaximumQuote) reasons.push('CURRENT_BINDING_MISMATCH');
    if (input.current.policyRevision !== input.policy.policyRevision) reasons.push('POLICY_REVISION_NOT_ADOPTED');
  }
  return orderReasons(reasons, ENTRY_REASON_ORDER);
}

function currentBindingReasons(input: Readonly<VolumeLifecycleInput>, id: string): readonly string[] {
  if (input.current === null) return Object.freeze([]);
  const reasons: string[] = [];
  const current = input.current;
  if (input.current.lifecycleId !== id || input.current.symbol !== input.proposal.symbol
    || input.current.proposalId !== input.proposal.proposalId
    || input.current.proposalRevision !== input.proposal.proposalRevision
    || input.current.proposalDigest !== input.proposal.proposalDigest
    || input.current.entryKind !== input.proposal.entryKind
    || input.current.featureRevision !== input.proposal.featureRevision
    || input.current.evidenceRevision !== input.proposal.evidenceRevision
    || input.current.exitPlanRevision !== input.proposal.exitPlanRevision
    || JSON.stringify(input.current.invalidationConditions) !== JSON.stringify(input.proposal.invalidationConditions)
    || input.current.assessmentId !== input.advisory.assessmentId
    || input.current.assessmentRevision !== input.advisory.assessmentRevision
    || input.current.assessmentFingerprintSha256 !== input.advisory.assessmentFingerprintSha256
    || input.current.advisoryModelRevision !== input.advisory.modelRevision
    || input.current.advisoryFeatureRevision !== input.advisory.featureRevision
    || input.current.advisoryEvidenceRevision !== input.advisory.evidenceRevision
    || input.current.entryInstrumentRevision !== input.sizing.instrumentRevision
    || input.current.entryFilterRevision !== input.sizing.filterRevision
    || input.current.entrySourceEvidenceRevision !== input.sizing.sourceEvidenceRevision
    || JSON.stringify(input.current.entrySizingCuts) !== JSON.stringify(input.sizing.cuts)
    || input.current.accountRealmId !== input.sizing.accountRealmId
    || input.current.baseAsset !== input.sizing.baseAsset
    || input.current.quoteAsset !== input.sizing.quoteAsset
    || input.current.capitalMandateId !== input.authority.capitalMandateId
    || input.current.capitalMandateRevision !== input.authority.capitalMandateRevision
    || input.current.capitalMandateDigest !== input.authority.capitalMandateDigest
    || input.current.capitalReservationId !== input.authority.capitalReservationId
    || input.current.capitalReservationRevision !== input.authority.capitalReservationRevision
    || input.current.capitalMaximumQuote !== input.authority.capitalMaximumQuote) reasons.push('CURRENT_BINDING_MISMATCH');
  if (input.current.policyRevision !== input.policy.policyRevision) reasons.push('POLICY_REVISION_NOT_ADOPTED');
  if (input.evaluatedAtMs < current.lastTransition.occurredAtMs) reasons.push('EVALUATION_TIME_REGRESSION');
  if (input.occupancy.truth !== 'COMPLETE') reasons.push('OCCUPANCY_TRUTH_NOT_COMPLETE');
  if (input.evaluatedAtMs >= input.occupancy.validUntilMs || input.evaluatedAtMs < input.occupancy.observedAtMs) {
    reasons.push('OCCUPANCY_EXPIRED');
  }
  if (input.occupancy.priorActions.some((record) => record.recordedAtMs > input.evaluatedAtMs
    || record.recordedAtMs > input.occupancy.observedAtMs)) {
    reasons.push('OCCUPANCY_HISTORY_TIME_INVALID');
  }
  if (input.occupancy.observedAtMs < current.lastTransition.occurredAtMs) {
    reasons.push('CANONICAL_OCCUPANCY_BINDING_MISMATCH');
  }
  const scoped = input.occupancy.activeRecords.filter((record) => record.symbol === input.proposal.symbol);
  const active = scoped.filter((record) => record.state !== 'CLOSED');
  if (active.some((record) => record.lifecycleId !== id)) reasons.push('ONE_POSITION_LIMIT');
  const own = scoped.filter((record) => record.lifecycleId === id);
  const positions = own.filter((record) => record.kind === 'POSITION');
  const tickets = own.filter((record) => record.kind === 'TICKET');
  const expectedPositionCount = 1;
  const canonicalNoEffectTicketClosure = current.state === 'RECOVERY_REQUIRED'
    && current.pendingAction !== null
    && input.signals.recoveryDisposition === 'RESOLVED'
    && input.signals.recoveryOutcome === 'NO_EFFECT'
    && input.signals.recoveryRevision !== null
    && !current.consumedRecoveryRevisions.includes(input.signals.recoveryRevision)
    && current.consumedRecoveryRevisions.length < 32
    && input.signals.reconciliationState === 'EXACT';
  const expectedTicketCount = current.pendingAction === null || canonicalNoEffectTicketClosure ? 0 : 1;
  const expectedOccupancyState = current.state === 'RECOVERY_REQUIRED' ? 'RECOVERY_REQUIRED'
    : current.state === 'EXIT' ? 'CLOSED' : 'ACTIVE';
  const activePositionAnchorMissing = positions.length !== 1
      || positions[0]?.ownerFamily !== 'VOLUME_LIFECYCLE_ADAPTER'
      || positions[0]?.projectionRevision !== current.projectionRevision;
  if (activePositionAnchorMissing
    || [...positions, ...tickets].some((record) => record.ownerFamily === 'VOLUME_LIFECYCLE_ADAPTER'
      && record.projectionRevision !== current.projectionRevision)) {
    reasons.push('CANONICAL_PROJECTION_REVISION_MISMATCH');
  }
  if (positions.length !== expectedPositionCount || tickets.length !== expectedTicketCount
    || positions.some((record) => record.positionQuantity !== current.positionQuantity
      || record.proposalId !== current.proposalId || record.assessmentId !== current.assessmentId
      || record.direction !== current.direction || record.ownerFamily !== 'VOLUME_LIFECYCLE_ADAPTER'
      || record.projectionRevision !== current.projectionRevision
      || record.state !== expectedOccupancyState)
    || tickets.some((record) => record.actionKey !== current.pendingAction?.actionKey
      || record.intentKey !== current.pendingAction?.intentKey
      || record.proposalId !== current.proposalId
      || record.assessmentId !== current.assessmentId
      || record.direction !== current.direction
      || record.ownerFamily !== 'VOLUME_LIFECYCLE_ADAPTER'
      || record.projectionRevision !== current.projectionRevision
      || record.state !== expectedOccupancyState)) {
    reasons.push('CANONICAL_OCCUPANCY_BINDING_MISMATCH');
  }
  return orderReasons(reasons, ENTRY_REASON_ORDER);
}

function riskVerdictCoversEvidence(
  input: Readonly<VolumeLifecycleInput>,
  minimumEvaluatedAtMs: number,
  includeOccupancy: boolean,
): boolean {
  const evidenceTimes = [
    minimumEvaluatedAtMs,
    input.proposal.observedAtMs,
    input.advisory.observedAtMs,
    input.market.observedAtMs,
    input.signals.observedAtMs,
    input.sizing.observedAtMs,
    ...(input.sizing.inventoryObservedAtMs === null ? [] : [input.sizing.inventoryObservedAtMs]),
    ...(includeOccupancy ? [input.occupancy.observedAtMs] : []),
  ];
  return evidenceTimes.every((observedAtMs) => input.authority.riskEvaluatedAtMs >= observedAtMs);
}

function actionSide(direction: 'LONG' | 'SHORT', increasing: boolean): VolumeSide {
  if (direction === 'LONG') return increasing ? 'BUY' : 'SELL';
  return increasing ? 'SELL' : 'BUY';
}

function actionRequest(
  input: Readonly<VolumeLifecycleInput>,
  projection: Readonly<VolumeLifecycleProjection>,
  kind: VolumeLifecycleActionRequest['kind'],
  targetState: VolumeLifecycleState,
  requestedQuantity: string,
  priceBound: string,
  maximumNotionalQuote: string,
  mandateUsageAfterQuote: string,
  triggerEpisodeRevision: string | null = null,
  triggerReasonCodes: readonly string[] = Object.freeze([]),
): Readonly<VolumeLifecycleActionRequest> {
  const stageFrom = projection.openedAtMs === null && kind === 'ENTRY' ? null : projection.state;
  const increasing = kind === 'ENTRY' || kind === 'ADD';
  const recoveryRetryRevision = (kind === 'REDUCE' || kind === 'EXIT')
    && projection.lastNoFill?.action.kind === kind
    && projection.lastNoFill.recoveryResolutionRevision !== null
    ? deriveVolumeRecoveryRetryRevision({
      lifecycleId: projection.lifecycleId,
      kind,
      priorNoFillActionKey: projection.lastNoFill.action.actionKey,
      priorNoFillIntentKey: projection.lastNoFill.action.intentKey,
      canonicalRecoveryResolutionRevision: projection.lastNoFill.recoveryResolutionRevision,
    })
    : null;
  const base = {
    schema: 'LIVE_EDGE_VOLUME_ACTION_REQUEST_V1' as const,
    lifecycleId: projection.lifecycleId,
    projectionRevision: projection.projectionRevision,
    positionBeforeQuantity: projection.positionQuantity,
    symbol: projection.symbol,
    direction: projection.direction,
    kind,
    stageFrom,
    stageTo: targetState,
    side: actionSide(input.proposal.direction, kind === 'ENTRY' || kind === 'ADD'),
    requestedQuantity,
    priceBound,
    maximumNotionalQuote,
    mandateUsageBeforeQuote: projection.projectedMandateUsageQuote,
    mandateUsageAfterQuote,
    proposalId: input.proposal.proposalId,
    proposalRevision: input.proposal.proposalRevision,
    proposalDigest: input.proposal.proposalDigest,
    assessmentId: input.advisory.assessmentId,
    assessmentRevision: input.advisory.assessmentRevision,
    assessmentFingerprintSha256: input.advisory.assessmentFingerprintSha256,
    modelRevision: input.advisory.modelRevision,
    featureRevision: input.proposal.featureRevision,
    evidenceRevision: input.proposal.evidenceRevision,
    exitPlanRevision: input.proposal.exitPlanRevision,
    entryEvidenceRevision: projection.entryEvidenceRevision,
    ownerEvidenceRevision: ownerEvidenceRevision(input),
    capitalMandateId: input.authority.capitalMandateId,
    capitalMandateRevision: input.authority.capitalMandateRevision,
    capitalMandateDigest: input.authority.capitalMandateDigest,
    capitalReservationId: input.authority.capitalReservationId,
    capitalReservationRevision: input.authority.capitalReservationRevision,
    capitalMaximumQuote: input.authority.capitalMaximumQuote,
    riskVerdictId: input.authority.riskVerdictId,
    riskVerdictRevision: input.authority.riskVerdictRevision,
    riskVerdictDigest: input.authority.riskVerdictDigest,
    riskActionClass: input.authority.riskActionClass as 'OPEN' | 'ADD' | 'REDUCE' | 'EXIT',
    riskContextRevision: input.authority.riskContextRevision,
    approvalId: input.authority.approvalId,
    approvalRevision: input.authority.approvalRevision,
    accountRealmId: input.sizing.accountRealmId,
    baseAsset: input.sizing.baseAsset,
    quoteAsset: input.sizing.quoteAsset,
    inventoryMode: increasing ? input.sizing.inventoryMode : projection.entryInventoryMode,
    availableBaseQuantity: increasing ? input.sizing.availableBaseQuantity : projection.entryAvailableBaseQuantity,
    inventoryRevision: increasing ? input.sizing.inventoryRevision : projection.entryInventoryRevision,
    inventoryAsset: increasing ? input.sizing.inventoryAsset : projection.entryInventoryAsset,
    inventoryAccountRealmId: increasing
      ? input.sizing.inventoryAccountRealmId : projection.entryInventoryAccountRealmId,
    inventoryObservedAtMs: increasing ? input.sizing.inventoryObservedAtMs : projection.entryInventoryObservedAtMs,
    inventoryValidUntilMs: increasing ? input.sizing.inventoryValidUntilMs : projection.entryInventoryValidUntilMs,
    instrumentRevision: input.sizing.instrumentRevision,
    filterRevision: input.sizing.filterRevision,
    sourceEvidenceRevision: input.sizing.sourceEvidenceRevision,
    bookRevision: input.market.bookRevision,
    costRevision: input.market.costRevision,
    downsideRevision: input.market.downsideRevision,
    triggerEpisodeRevision,
    triggerReasonCodes: Object.freeze([...triggerReasonCodes]),
    recoveryRetryRevision,
    policyRevision: input.policy.policyRevision,
    plannedAtMs: input.evaluatedAtMs,
    requiresOwnerPreflight: true as const,
    requiresCanonicalRisk: true as const,
    syntheticTwinProofRequired: true as const,
    ...AUTHORITY,
  };
  const intentKey = deriveVolumeIntentKey(base);
  const withIntent = { ...base, intentKey };
  return deepFreeze({ ...withIntent, actionKey: deriveVolumeActionKey(withIntent) });
}

export function deriveVolumeTwinFixtureId(actionKey: string): string {
  if (typeof actionKey !== 'string' || !ACTION_KEY.test(actionKey)) {
    throw new TypeError('Volume action key cannot derive an L07 fixture identity');
  }
  return `l11fixture_${actionKey.slice('l11action_'.length)}`;
}

export function deriveVolumeL07Binding(action: unknown) {
  const safeAction = validateVolumeLifecycleActionRequest(action);
  const rootHash = digest('', { schema: 'L11_VOLUME_TO_ACCEPTED_L07_BINDING_V1', action: safeAction });
  const domain = (label: string): string => digest('', { rootHash, label });
  return deepFreeze({
    rootHash,
    globalCorrelationId: `cor_${domain('correlation').slice(0, 16)}`,
    assessmentId: `asm_${domain('assessment').slice(0, 32)}`,
    decisionId: `cdec_${domain('decision').slice(0, 16)}`,
    proposalId: `cprop_${domain('proposal').slice(0, 16)}`,
    capitalMandateId: `cmdt_${domain('mandate').slice(0, 32)}`,
    capitalReservationId: `cres_${domain('reservation').slice(0, 32)}`,
    ticketId: `plan_${domain('ticket').slice(0, 16)}`,
    legId: `leg_${domain('leg').slice(0, 16)}`,
    intentFingerprint: domain('intent').slice(0, 32),
    sanitizedRequestContentHash: `sha256:${rootHash}`,
    capitalMandateRevision: `l11capital_${domain('capital-revision')}`,
    riskVerdictRevision: `l11risk_${domain('risk-revision')}`,
  });
}

function withProjection(
  current: Readonly<VolumeLifecycleProjection>,
  changes: Partial<ProjectionDraft>,
): Readonly<VolumeLifecycleProjection> {
  const { projectionRevision: _revision, ...draft } = current;
  return finalizeProjection({ ...draft, ...changes, revision: current.revision + 1 });
}

function feedback(
  projection: Readonly<VolumeLifecycleProjection>,
  reasons: readonly string[],
): Readonly<VolumeFeedbackHandoff> {
  const outcomeRevision = projection.feedbackOutcomeRevision ?? digest('l11feedback_', {
    lifecycleId: projection.lifecycleId,
    policyRevision: projection.policyRevision,
    reasonCodes: reasons,
    twinOutcomeRevision: projection.lastTwinOutcomeRevision,
    positionQuantity: projection.positionQuantity,
  });
  return deepFreeze({
    schema: 'LIVE_EDGE_VOLUME_FEEDBACK_HANDOFF_V1' as const,
    targetOwner: 'EDGE_PROTOCOL_OUTCOME_FEEDBACK' as const,
    outcomeClass: 'HYPOTHETICAL_REPLAY' as const,
    outcomeRevision,
    lifecycleId: projection.lifecycleId,
    proposalId: projection.proposalId,
    assessmentId: projection.assessmentId,
    policyRevision: projection.policyRevision,
    terminalState: projection.state === 'EXIT' ? 'EXIT' as const : 'RECOVERY_REQUIRED' as const,
    primaryReasonCode: reasons[0],
    reasonCodes: Object.freeze([...reasons]),
    twinOutcomeRevision: projection.lastTwinOutcomeRevision,
    realizedPnlAuthority: 'UNAVAILABLE' as const,
    ...AUTHORITY,
  });
}

interface RecoveryEvidenceCorrelation {
  readonly actionKey: string;
  readonly fixtureId: string;
  readonly twinStateRevision: string;
  readonly twinOutcomeRevision: string;
}

function retainedRecoveryCorrelation(
  current: Readonly<VolumeLifecycleProjection>,
): Readonly<RecoveryEvidenceCorrelation> | null {
  if (current.recoveryEvidenceActionKey === null
    || current.recoveryEvidenceFixtureId === null
    || current.recoveryEvidenceTwinStateRevision === null
    || current.recoveryEvidenceTwinOutcomeRevision === null) return null;
  return Object.freeze({
    actionKey: current.recoveryEvidenceActionKey,
    fixtureId: current.recoveryEvidenceFixtureId,
    twinStateRevision: current.recoveryEvidenceTwinStateRevision,
    twinOutcomeRevision: current.recoveryEvidenceTwinOutcomeRevision,
  });
}

function recoveryEvidenceCorrelation(
  input: Readonly<VolumeLifecycleInput>,
  current: Readonly<VolumeLifecycleProjection>,
  twin: Readonly<VolumeTwinSettlement> | null,
): Readonly<RecoveryEvidenceCorrelation> | null {
  const evidence = input.twinEvidence;
  if (evidence !== null) {
    const knownAction = current.pendingAction?.actionKey === evidence.actionKey
      || current.lastNoFill?.action.actionKey === evidence.actionKey
      || current.recoveryConsumptionHistory.some((record) => (
        record.noFill?.evidenceKind === 'CANONICAL_NO_EFFECT'
        && record.noFill.action.actionKey === evidence.actionKey
      ))
      || current.settledTwinHistory.some((record) => record.actionKey === evidence.actionKey);
    if (!knownAction || evidence.fixtureId !== deriveVolumeTwinFixtureId(evidence.actionKey)) return null;
    if (twin !== null && twin.fixtureId === evidence.fixtureId) {
      return Object.freeze({
        actionKey: evidence.actionKey,
        fixtureId: evidence.fixtureId,
        twinStateRevision: twin.twinStateRevision,
        twinOutcomeRevision: twin.twinOutcomeRevision,
      });
    }
    try {
      const state = checkpointExchangeTwin(evidence.twinState).state;
      if (state.orders.length === 1
        && state.product === 'SPOT'
        && state.symbol === current.symbol
        && state.orders[0]?.fixture.fixtureId === evidence.fixtureId) {
        return Object.freeze({
          actionKey: evidence.actionKey,
          fixtureId: evidence.fixtureId,
          twinStateRevision: state.stateRevision,
          twinOutcomeRevision: state.outcomeRevision,
        });
      }
    } catch {
      // Malformed replay/orphan evidence stays uncorrelated and recommendation-only.
    }
    return null;
  }
  if (current.state === 'RECOVERY_REQUIRED'
    && current.recoveryEvidenceActionKey !== null
    && current.recoveryEvidenceFixtureId !== null
    && current.recoveryEvidenceTwinStateRevision !== null
    && current.recoveryEvidenceTwinOutcomeRevision !== null) {
    return Object.freeze({
      actionKey: current.recoveryEvidenceActionKey,
      fixtureId: current.recoveryEvidenceFixtureId,
      twinStateRevision: current.recoveryEvidenceTwinStateRevision,
      twinOutcomeRevision: current.recoveryEvidenceTwinOutcomeRevision,
    });
  }
  return null;
}

function recovery(
  input: Readonly<VolumeLifecycleInput>,
  current: Readonly<VolumeLifecycleProjection>,
  reasons: readonly string[],
  kind: VolumeRecoveryHandoff['kind'],
  twin: Readonly<VolumeTwinSettlement> | null,
  forcedCorrelation?: Readonly<RecoveryEvidenceCorrelation> | null,
  unresolvedTwinConflict?: Readonly<VolumeUnresolvedTwinConflict>,
): Readonly<VolumeLifecycleDecision> {
  const recoveryReasons = unresolvedTwinConflict === undefined ? reasons : Object.freeze([
    ...new Set([...reasons, 'UNRESOLVED_TWIN_CONFLICT_REQUIRES_RECONSTRUCTION']),
  ]);
  const resume = current.state === 'RECOVERY_REQUIRED'
    ? current.recoveryResumeState
    : current.state as Exclude<VolumeLifecycleState, 'RECOVERY_REQUIRED'>;
  if (resume === null) throw new TypeError('Volume recovery requires an exact resume state');
  const correlation = forcedCorrelation === undefined
    ? recoveryEvidenceCorrelation(input, current, twin) : forcedCorrelation;
  const observedMarket = marketObservation(input, current);
  const sameTwinConflict = unresolvedTwinConflict === undefined
    || current.unresolvedTwinConflict?.conflictRevision === unresolvedTwinConflict.conflictRevision;
  const sameRecovery = current.state === 'RECOVERY_REQUIRED'
    && current.lastTransition.primaryReasonCode === recoveryReasons[0]
    && current.lastTransition.reasonCodes.length === recoveryReasons.length
    && current.lastTransition.reasonCodes.every((reason, index) => reason === recoveryReasons[index])
    && current.currentPrice === observedMarket.currentPrice
    && current.favorableExtremePrice === observedMarket.favorableExtremePrice
    && current.lastMarketObservedAtMs === observedMarket.lastMarketObservedAtMs
    && current.lastSignalObservedAtMs === observedMarket.lastSignalObservedAtMs
    && current.lastMarketObservationRevision === observedMarket.lastMarketObservationRevision
    && current.lastSignalObservationRevision === observedMarket.lastSignalObservationRevision
    && (correlation?.actionKey ?? null) === current.recoveryEvidenceActionKey
    && (correlation?.fixtureId ?? null) === current.recoveryEvidenceFixtureId
    && (correlation?.twinStateRevision ?? null) === current.recoveryEvidenceTwinStateRevision
    && (correlation?.twinOutcomeRevision ?? null) === current.recoveryEvidenceTwinOutcomeRevision
    && sameTwinConflict;
  const projection = sameRecovery ? current : withProjection(current, {
    state: 'RECOVERY_REQUIRED',
    recoveryResumeState: resume,
    ...observedMarket,
    recoveryEvidenceActionKey: correlation?.actionKey ?? null,
    recoveryEvidenceFixtureId: correlation?.fixtureId ?? null,
    recoveryEvidenceTwinStateRevision: correlation?.twinStateRevision ?? null,
    recoveryEvidenceTwinOutcomeRevision: correlation?.twinOutcomeRevision ?? null,
    ...(unresolvedTwinConflict === undefined ? {} : {
      unresolvedTwinConflict,
      positionQuantityTruth: unresolvedTwinConflict.kind === 'TWIN_EFFECT_RECONSTRUCTION_REQUIRED'
        ? current.positionQuantityTruth : 'UNKNOWN' as const,
      capitalUsageTruth: unresolvedTwinConflict.kind === 'TWIN_EFFECT_RECONSTRUCTION_REQUIRED'
        ? current.capitalUsageTruth : 'UNKNOWN' as const,
      feedbackOutcomeRevision: null,
      pendingTwinStateRevision: correlation?.actionKey === current.pendingAction?.actionKey
        ? correlation?.twinStateRevision ?? null : null,
      pendingTwinOutcomeRevision: correlation?.actionKey === current.pendingAction?.actionKey
        ? correlation?.twinOutcomeRevision ?? null : null,
    }),
    lastTransition: transition(current.state, 'RECOVERY_REQUIRED', recoveryReasons, input,
      correlation?.twinOutcomeRevision ?? null),
  });
  const handoff = deepFreeze({
    schema: 'LIVE_EDGE_VOLUME_RECOVERY_HANDOFF_V1' as const,
    targetOwner: 'FOUNDATION_EXECUTION_RECOVERY' as const,
    kind,
    lifecycleId: projection.lifecycleId,
    actionKey: projection.recoveryEvidenceActionKey,
    fixtureId: projection.recoveryEvidenceFixtureId,
    twinStateRevision: projection.recoveryEvidenceTwinStateRevision,
    twinOutcomeRevision: projection.recoveryEvidenceTwinOutcomeRevision,
    reasonCodes: Object.freeze([...recoveryReasons]),
    recommendationOnly: true as const,
    ...AUTHORITY,
  });
  return decision('RECOVERY_REQUIRED', recoveryReasons, projection, projection.pendingAction, twin, handoff, null);
}

function twinConflict(
  current: Readonly<VolumeLifecycleProjection>,
  action: Readonly<VolumeLifecycleActionRequest>,
  kind: VolumeUnresolvedTwinConflict['kind'],
  recoveryResolutionRevision: string | null,
  twin: Readonly<VolumeTwinSettlement>,
): Readonly<VolumeUnresolvedTwinConflict> {
  return twinConflictRecord(current, kind, action.actionKey, twin.fixtureId,
    recoveryResolutionRevision, twin.twinStateRevision, twin.twinOutcomeRevision,
    twin.filledQuantity);
}

function twinConflictRecord(
  current: Readonly<VolumeLifecycleProjection>,
  kind: VolumeUnresolvedTwinConflict['kind'],
  actionKey: string,
  fixtureId: string,
  recoveryResolutionRevision: string | null,
  twinStateRevision: string,
  twinOutcomeRevision: string,
  filledQuantity: string,
): Readonly<VolumeUnresolvedTwinConflict> {
  const material = Object.freeze({
    kind,
    actionKey,
    fixtureId,
    recoveryResolutionRevision,
    twinStateRevision,
    twinOutcomeRevision,
    filledQuantity,
  });
  return deepFreeze({
    ...material,
    conflictRevision: digest('l11twinconflict_', {
      lifecycleId: current.lifecycleId,
      ...material,
    }),
  });
}

function unboundTwinConflict(
  input: Readonly<VolumeLifecycleInput>,
  current: Readonly<VolumeLifecycleProjection>,
  kind: 'SETTLED_TWIN_REPLAY_MISMATCH' | 'ORPHAN_TWIN_EVIDENCE',
): Readonly<{ conflict: Readonly<VolumeUnresolvedTwinConflict>;
  correlation: Readonly<RecoveryEvidenceCorrelation> }> {
  if (input.twinEvidence === null) throw new TypeError('Volume unbound twin conflict requires evidence');
  if (input.twinEvidence.fixtureId !== deriveVolumeTwinFixtureId(input.twinEvidence.actionKey)) {
    throw new TypeError('Volume unbound twin fixture identity is invalid');
  }
  const state = checkpointExchangeTwin(input.twinEvidence.twinState).state;
  if (state.orders.length !== 1) {
    throw new TypeError('Volume unbound twin conflict must be scoped to exactly one action');
  }
  const order = state.orders[0];
  const identity = order.fixture.l06Snapshot.identity;
  if (state.product !== 'SPOT' || state.symbol !== current.symbol
    || order.fixture.fixtureId !== input.twinEvidence.fixtureId
    || order.fixture.product !== 'SPOT' || order.fixture.symbol !== current.symbol
    || order.fixture.baseAsset !== current.baseAsset || order.fixture.quoteAsset !== current.quoteAsset
    || identity.strategyId !== 'VOLUME' || identity.product !== 'SPOT'
    || identity.environment !== 'PRODUCTION' || identity.accountRealmId !== current.accountRealmId
    || identity.symbol !== current.symbol || identity.mutationKind !== 'PLACE_ORDER'
    || identity.contractId !== 'SPOT_ORDER_POST' || identity.contractState !== 'CURRENT') {
    throw new TypeError('Volume unbound twin conflict is outside the retained lifecycle scope');
  }
  const filledQuantity = order.filledQuantity;
  const correlation = Object.freeze({
    actionKey: input.twinEvidence.actionKey,
    fixtureId: input.twinEvidence.fixtureId,
    twinStateRevision: state.stateRevision,
    twinOutcomeRevision: state.outcomeRevision,
  });
  return Object.freeze({
    correlation,
    conflict: twinConflictRecord(current, kind, correlation.actionKey, correlation.fixtureId,
      null, correlation.twinStateRevision, correlation.twinOutcomeRevision, filledQuantity),
  });
}

function evaluateInertTwinEvidence(
  input: Readonly<VolumeLifecycleInput>,
  current: Readonly<VolumeLifecycleProjection>,
  reason: 'TWIN_EVIDENCE_ALREADY_SETTLED' | 'CANONICAL_NO_EFFECT_TWIN_NO_FILL_CONFIRMED',
  twin: Readonly<VolumeTwinSettlement> | null,
): Readonly<VolumeLifecycleDecision> {
  const withoutTwin = evaluateVolumeLifecycle({ ...input, twinEvidence: null });
  const protectiveAction = withoutTwin.actionRequest?.kind === 'REDUCE'
    || withoutTwin.actionRequest?.kind === 'EXIT';
  const recoveryResolved = current.state === 'RECOVERY_REQUIRED'
    && withoutTwin.projection?.state !== 'RECOVERY_REQUIRED';
  if (withoutTwin.disposition === 'RECOVERY_REQUIRED'
    || withoutTwin.disposition === 'TERMINAL'
    || protectiveAction
    || recoveryResolved
    || current.state === 'EXIT') return withoutTwin;
  const passiveProjection = withoutTwin.projection !== null
    && withoutTwin.projection.state === current.state
    && withoutTwin.projection.pendingAction?.actionKey === current.pendingAction?.actionKey
    ? withoutTwin.projection : retainMarketObservation(input, current);
  return decision('NOOP_REPEAT', [reason], passiveProjection, passiveProjection.pendingAction, twin);
}

function terminalDecision(
  projection: Readonly<VolumeLifecycleProjection>,
  reasons: readonly string[],
  twin: Readonly<VolumeTwinSettlement> | null,
): Readonly<VolumeLifecycleDecision> {
  if (projection.state !== 'EXIT') throw new TypeError('Volume terminal decision requires EXIT state');
  const outcomeRevision = digest('l11feedback_', {
    lifecycleId: projection.lifecycleId,
    policyRevision: projection.policyRevision,
    reasonCodes: reasons,
    twinOutcomeRevision: projection.lastTwinOutcomeRevision,
    positionQuantity: projection.positionQuantity,
  });
  const alreadySealed = projection.feedbackOutcomeRevision === outcomeRevision
    && projection.terminalOutcomeReasonCodes !== null;
  const sealed = alreadySealed
    ? projection
    : withProjection(projection, {
      terminalOutcomeReasonCodes: Object.freeze([...reasons]),
      feedbackOutcomeRevision: outcomeRevision,
    });
  return decision('TERMINAL', reasons, sealed, null, twin, null, feedback(sealed, reasons));
}

function twinSettlement(
  input: Readonly<VolumeLifecycleInput>,
  current: Readonly<VolumeLifecycleProjection>,
  retainedAction: Readonly<VolumeLifecycleActionRequest> | null = current.pendingAction,
) {
  if (input.twinEvidence === null || retainedAction === null) return null;
  if (input.twinEvidence.actionKey !== retainedAction.actionKey) {
    throw new TypeError('Volume twin evidence action binding is invalid');
  }
  if (input.twinEvidence.fixtureId !== deriveVolumeTwinFixtureId(retainedAction.actionKey)) {
    throw new TypeError('Volume twin fixture identity is not intrinsic to the pending action');
  }
  const state = checkpointExchangeTwin(input.twinEvidence.twinState).state;
  if (state.orders.length !== 1) throw new TypeError('Volume twin evidence must be scoped to exactly one L11 action');
  const order = state.orders[0];
  const action = retainedAction;
  const l07 = deriveVolumeL07Binding(action);
  const identity = order.fixture.l06Snapshot.identity;
  const bindings = order.fixture.l06Snapshot.bindings;
  if (order.fixture.fixtureId !== input.twinEvidence.fixtureId
    || state.product !== 'SPOT' || state.symbol !== current.symbol
    || order.fixture.product !== 'SPOT' || order.fixture.symbol !== current.symbol
    || order.fixture.baseAsset !== action.baseAsset || order.fixture.quoteAsset !== action.quoteAsset
    || order.fixture.side !== action.side
    || order.fixture.orderType !== 'MARKET' || order.fixture.timeInForce !== null
    || compareVolumeDecimals(order.fixture.quantity, action.requestedQuantity) !== 0
    || order.fixture.instrumentRevision !== action.instrumentRevision
    || order.fixture.sourceEvidenceRevision !== action.sourceEvidenceRevision
    || state.book.bookRevision !== action.bookRevision
    || identity.globalCorrelationId !== l07.globalCorrelationId
    || identity.assessmentId !== l07.assessmentId
    || identity.decisionId !== l07.decisionId
    || identity.strategyId !== 'VOLUME'
    || identity.proposalId !== l07.proposalId
    || identity.capitalMandateId !== l07.capitalMandateId
    || identity.capitalReservationId !== l07.capitalReservationId
    || identity.ticketId !== l07.ticketId || identity.legId !== l07.legId
    || identity.intentFingerprint !== l07.intentFingerprint
    || identity.product !== 'SPOT' || identity.environment !== 'PRODUCTION'
    || identity.accountRealmId !== action.accountRealmId
    || identity.symbol !== current.symbol || identity.mutationKind !== 'PLACE_ORDER'
    || identity.contractId !== 'SPOT_ORDER_POST' || identity.contractState !== 'CURRENT'
    || bindings.sanitizedRequestContentHash !== l07.sanitizedRequestContentHash
    || bindings.capitalMandateRevision !== l07.capitalMandateRevision
    || bindings.riskVerdictRevision !== l07.riskVerdictRevision
    || bindings.instrumentRevision !== action.instrumentRevision
    || bindings.sourceEvidenceRevision !== action.sourceEvidenceRevision
    || bindings.registryRevision !== action.filterRevision
    || bindings.preflightResultQuantity !== action.requestedQuantity
    || order.fixture.l06Snapshot.requestedQuantity !== action.requestedQuantity) {
    throw new TypeError('Volume twin evidence fixture binding is invalid');
  }
  const filledQuoteNotional = sumVolumeDecimals(order.fills.map((fill) => fill.quoteNotional));
  const positiveFills = order.fills.filter((fill) => compareVolumeDecimals(fill.quantity, '0') > 0);
  const feeEvidenceMissing = positiveFills.some((fill) => fill.feeEvidenceRevision === null
    || fill.feeAmount === null || fill.feeAsset === null);
  const feeConversionUnknown = positiveFills.some((fill) => fill.feeEvidenceRevision !== null
    && fill.quoteEquivalentFee === null);
  const positionQuantityFeeAmbiguous = order.fills.some((fill) => fill.feeAmount !== null
    && compareVolumeDecimals(fill.feeAmount, '0') > 0 && fill.feeAsset === action.baseAsset);
  const filledFeeQuote = feeEvidenceMissing || feeConversionUnknown ? null
    : sumVolumeDecimals(positiveFills.map((fill) => fill.quoteEquivalentFee as string));
  const filledCapitalUsageQuote = filledFeeQuote === null ? null
    : addVolumeDecimals(filledQuoteNotional, filledFeeQuote);
  const reasons: string[] = [];
  let settlementState: VolumeTwinSettlement['state'];
  const l06Entries = order.fixture.l06Snapshot.entries;
  const l06BoundaryAtMs = order.fixture.l06Boundary.evaluatedAtMs;
  const chronologyInvalid = l06Entries
    .filter((entry) => entry.kind === 'CREATED' || entry.kind === 'SUBMISSION_INTENT')
    .some((entry) => entry.occurredAtMs < action.plannedAtMs)
    || l06Entries.some((entry) => entry.occurredAtMs > input.evaluatedAtMs
      || entry.receivedAtMs > input.evaluatedAtMs
      || entry.occurredAtMs > l06BoundaryAtMs || entry.receivedAtMs > l06BoundaryAtMs)
    || l06BoundaryAtMs < action.plannedAtMs || l06BoundaryAtMs > input.evaluatedAtMs
    || state.processedEvents.some((event) => event.occurredAtMs < action.plannedAtMs
      || event.occurredAtMs > input.evaluatedAtMs)
    || order.fills.some((fill) => fill.occurredAtMs < action.plannedAtMs || fill.occurredAtMs > input.evaluatedAtMs)
    || (order.dispatchAtMs !== null && (order.dispatchAtMs < action.plannedAtMs || order.dispatchAtMs > input.evaluatedAtMs));
  if (chronologyInvalid) reasons.push('TWIN_CHRONOLOGY_INVALID');
  if (state.orderingTruth !== 'PROVED') reasons.push('TWIN_ORDERING_AMBIGUOUS');
  if (order.recoveryRequired || order.localTruth === 'UNKNOWN' || order.localTruth === 'RECOVERY_REQUIRED') {
    reasons.push('TWIN_LOCAL_RECOVERY_REQUIRED');
  }
  if (order.localObservedVenueStatus !== null && order.localObservedVenueStatus !== order.venueStatus) {
    reasons.push('TWIN_LOCAL_VENUE_MISMATCH');
  }
  const increasing = action.kind === 'ENTRY' || action.kind === 'ADD';
  const buy = action.side === 'BUY';
  if (order.fills.some((fill) => buy
    ? compareVolumeDecimals(fill.price, action.priceBound) > 0
    : compareVolumeDecimals(fill.price, action.priceBound) < 0)) {
    reasons.push('TWIN_PRICE_BOUND_EXCEEDED');
  }
  if (positionQuantityFeeAmbiguous) reasons.push('TWIN_POSITION_QUANTITY_FEE_AMBIGUOUS');
  if (feeEvidenceMissing) reasons.push('TWIN_FEE_EVIDENCE_MISSING');
  if (feeConversionUnknown) reasons.push('TWIN_FEE_CONVERSION_UNKNOWN');
  if ((increasing || action.side === 'BUY')
    && compareVolumeDecimals(filledQuoteNotional, action.maximumNotionalQuote) > 0) {
    reasons.push('TWIN_NOTIONAL_BOUND_EXCEEDED');
  }
  if (increasing && filledCapitalUsageQuote !== null && compareVolumeDecimals(
    addVolumeDecimals(current.projectedMandateUsageQuote, filledCapitalUsageQuote),
    action.capitalMaximumQuote,
  ) > 0) {
    reasons.push('TWIN_FILL_EXCEEDS_SINGLE_MANDATE_CAP');
  }
  if (compareVolumeDecimals(order.filledQuantity, action.requestedQuantity) > 0) {
    reasons.push('TWIN_FILL_EXCEEDS_REQUEST');
  }
  if (!increasing && compareVolumeDecimals(order.filledQuantity, action.positionBeforeQuantity) > 0) {
    reasons.push('TWIN_REDUCTION_EXCEEDS_POSITION');
  }
  if (reasons.length > 0) settlementState = 'RECOVERY_REQUIRED';
  else if (order.localTruth !== 'OBSERVED') {
    settlementState = 'PENDING';
    reasons.push('TWIN_LOCAL_OBSERVATION_PENDING');
  } else if (compareVolumeDecimals(order.remainingQuantity, '0') > 0) {
    settlementState = 'RECOVERY_REQUIRED';
    reasons.push('TWIN_OPEN_REMAINDER_REQUIRES_RECOVERY');
  } else if (compareVolumeDecimals(order.filledQuantity, '0') === 0) {
    settlementState = 'NO_FILL';
    reasons.push('TWIN_PROVED_NO_FILL');
  } else if (compareVolumeDecimals(order.filledQuantity, action.requestedQuantity) < 0) {
    settlementState = 'RECOVERY_REQUIRED';
    reasons.push('TWIN_PARTIAL_FILL_REQUIRES_RECOVERY');
  } else {
    settlementState = 'FILLED';
    reasons.push('TWIN_PROVED_ACTUAL_FILL');
  }
  return deepFreeze({
    state: settlementState,
    fixtureId: order.fixture.fixtureId,
    twinStateRevision: state.stateRevision,
    twinOutcomeRevision: state.outcomeRevision,
    venueStatus: order.venueStatus,
    localTruth: order.localTruth,
    filledQuantity: order.filledQuantity,
    filledQuoteNotional,
    filledFeeQuote,
    filledCapitalUsageQuote,
    remainingQuantity: order.remainingQuantity,
    reasonCodes: Object.freeze(reasons),
  } satisfies VolumeTwinSettlement);
}

function settledTwinReplayMatches(
  input: Readonly<VolumeLifecycleInput>,
  current: Readonly<VolumeLifecycleProjection>,
): boolean {
  if (input.twinEvidence === null) return false;
  const retained = current.settledTwinHistory.find((record) => record.actionKey === input.twinEvidence?.actionKey);
  if (retained === undefined
    || input.twinEvidence.fixtureId !== retained.fixtureId
    || input.twinEvidence.fixtureId !== deriveVolumeTwinFixtureId(input.twinEvidence.actionKey)) return false;
  try {
    const state = checkpointExchangeTwin(input.twinEvidence.twinState).state;
    if (state.orders.length !== 1) return false;
    const order = state.orders[0];
    return state.stateRevision === retained.twinStateRevision
      && state.outcomeRevision === retained.twinOutcomeRevision
      && state.product === 'SPOT'
      && state.symbol === current.symbol
      && order.fixture.fixtureId === retained.fixtureId
      && order.fixture.product === 'SPOT'
      && order.fixture.symbol === current.symbol;
  } catch {
    return false;
  }
}

function retainedCanonicalNoEffect(
  current: Readonly<VolumeLifecycleProjection>,
  actionKey: string,
): Readonly<VolumeNoFillRecord> | null {
  if (current.lastNoFill?.evidenceKind === 'CANONICAL_NO_EFFECT'
    && current.lastNoFill.action.actionKey === actionKey) return current.lastNoFill;
  for (let index = current.recoveryConsumptionHistory.length - 1; index >= 0; index -= 1) {
    const retained = current.recoveryConsumptionHistory[index]?.noFill;
    if (retained?.evidenceKind === 'CANONICAL_NO_EFFECT'
      && retained.action.actionKey === actionKey) return retained;
  }
  return null;
}

function settleTwin(
  input: Readonly<VolumeLifecycleInput>,
  current: Readonly<VolumeLifecycleProjection>,
): Readonly<VolumeLifecycleDecision> {
  const settled = twinSettlement(input, current);
  if (settled === null) throw new TypeError('Volume twin settlement requires pending action and evidence');
  const action = current.pendingAction as Readonly<VolumeLifecycleActionRequest>;
  const retained = (reasons: readonly string[]): readonly string[] => Object.freeze([
    ...new Set([...action.triggerReasonCodes, ...reasons]),
  ]);
  const settledTwinHistory = (): VolumeLifecycleProjection['settledTwinHistory'] => Object.freeze([
    ...current.settledTwinHistory.filter((record) => record.actionKey !== action.actionKey).slice(-31),
    Object.freeze({
      actionKey: action.actionKey,
      fixtureId: settled.fixtureId,
      twinStateRevision: settled.twinStateRevision,
      twinOutcomeRevision: settled.twinOutcomeRevision,
      settlementState: settled.state as Exclude<VolumeTwinSettlement['state'], 'PENDING'>,
      outcomeSequence: current.revision + 1,
    }),
  ]);
  if (compareVolumeDecimals(settled.filledQuantity, '0') > 0
    && settled.localTruth !== 'OBSERVED') {
    const concurrentTriggers = exitTriggers(input, current);
    const reasons = retained([
      ...settled.reasonCodes,
      ...(concurrentTriggers.action === null ? [] : ['PENDING_ACTION_DURING_EXIT_TRIGGER']),
      ...concurrentTriggers.reasons,
      'TWIN_POSITION_RECONSTRUCTION_REQUIRED',
      'TWIN_CAPITAL_RECONSTRUCTION_REQUIRED',
      'TWIN_EFFECT_RECONSTRUCTION_REQUIRED',
    ]);
    const ambiguous = withProjection(current, {
      positionQuantityTruth: 'UNKNOWN',
      capitalUsageTruth: 'UNKNOWN',
      pendingTwinStateRevision: settled.twinStateRevision,
      pendingTwinOutcomeRevision: settled.twinOutcomeRevision,
    });
    const conflict = twinConflict(ambiguous, action, 'TWIN_EFFECT_RECONSTRUCTION_REQUIRED', null, settled);
    return recovery(input, ambiguous, reasons, 'POSITION_RECONSTRUCTION', settled, undefined, conflict);
  }
  if (settled.state === 'PENDING') {
    if (current.state === 'RECOVERY_REQUIRED') {
      const pendingTwinChanged = current.pendingTwinStateRevision !== null
        && (current.pendingTwinStateRevision !== settled.twinStateRevision
          || current.pendingTwinOutcomeRevision !== settled.twinOutcomeRevision);
      const refreshed = !pendingTwinChanged ? current : withProjection(current, {
        pendingTwinStateRevision: settled.twinStateRevision,
        pendingTwinOutcomeRevision: settled.twinOutcomeRevision,
      });
      return recovery(input, refreshed, retained(settled.reasonCodes), 'RECONCILIATION_REQUIRED', settled);
    }
    return decision('HOLD', retained(settled.reasonCodes), current, current.pendingAction, settled);
  }
  if (settled.state === 'RECOVERY_REQUIRED') {
    if (settled.reasonCodes.includes('TWIN_CHRONOLOGY_INVALID')) {
      const conflict = twinConflict(current, action, 'TWIN_CHRONOLOGY_INVALID', null, settled);
      return recovery(input, current, retained(settled.reasonCodes),
        'POSITION_RECONSTRUCTION', settled, undefined, conflict);
    }
    const observedPositiveFill = settled.localTruth === 'OBSERVED'
      && compareVolumeDecimals(settled.filledQuantity, '0') > 0;
    if (observedPositiveFill) {
      const increasing = action.kind === 'ENTRY' || action.kind === 'ADD';
      const quantityAmbiguous = (current.positionQuantityTruth === 'UNKNOWN'
        && current.pendingTwinStateRevision === null)
        || settled.reasonCodes.includes('TWIN_FEE_EVIDENCE_MISSING')
        || settled.reasonCodes.includes('TWIN_POSITION_QUANTITY_FEE_AMBIGUOUS')
        || settled.reasonCodes.includes('TWIN_REDUCTION_EXCEEDS_POSITION');
      const capitalAmbiguous = (current.capitalUsageTruth === 'UNKNOWN'
        && current.pendingTwinStateRevision === null)
        || settled.filledCapitalUsageQuote === null
        || settled.reasonCodes.includes('TWIN_FEE_EVIDENCE_MISSING')
        || settled.reasonCodes.includes('TWIN_FEE_CONVERSION_UNKNOWN');
      let nextQuantity = current.positionQuantity;
      let nextUsage = current.projectedMandateUsageQuote;
      let average = current.entryAveragePrice;
      let nextCostBasisQuote = current.entryCostBasisQuote;
      let nextCostBasisQuantity = current.entryCostBasisQuantity;
      let openedAtMs = current.openedAtMs;
      if (increasing) {
        nextQuantity = addVolumeDecimals(current.positionQuantity, settled.filledQuantity);
        nextUsage = settled.filledCapitalUsageQuote === null ? current.projectedMandateUsageQuote
          : addVolumeDecimals(current.projectedMandateUsageQuote, settled.filledCapitalUsageQuote);
        nextCostBasisQuote = addVolumeDecimals(current.entryCostBasisQuote, settled.filledQuoteNotional);
        nextCostBasisQuantity = addVolumeDecimals(current.entryCostBasisQuantity, settled.filledQuantity);
        average = divideVolumeDecimals(nextCostBasisQuote, nextCostBasisQuantity);
        const fillTimes = input.twinEvidence?.twinState.orders[0]?.fills.map((fill) => fill.occurredAtMs) ?? [];
        openedAtMs = current.openedAtMs
          ?? (fillTimes.length === 0 ? input.evaluatedAtMs : Math.min(...fillTimes));
      } else if (!quantityAmbiguous) {
        nextQuantity = subtractVolumeDecimals(current.positionQuantity, settled.filledQuantity);
      }
      const settlementPriceTrusted = openedAtMs !== null && marketPriceIsTrusted(
        input,
        current.lastTransition.occurredAtMs,
        openedAtMs,
        current.lastMarketObservedAtMs,
        current.lastSignalObservedAtMs,
        current.lastMarketObservationRevision,
        current.lastSignalObservationRevision,
      );
      const terminal = !increasing && !quantityAmbiguous
        && compareVolumeDecimals(nextQuantity, '0') === 0;
      const resumeState = current.state === 'RECOVERY_REQUIRED'
        ? current.recoveryResumeState as Exclude<VolumeLifecycleState, 'RECOVERY_REQUIRED'>
        : current.state;
      const observedState: VolumeLifecycleState = terminal ? 'EXIT'
        : !increasing && action.kind === 'REDUCE' ? 'REDUCE' : resumeState;
      const observedReasons = retained([
        ...settled.reasonCodes,
        ...(quantityAmbiguous ? ['TWIN_POSITION_RECONSTRUCTION_REQUIRED'] : []),
        ...(capitalAmbiguous ? ['TWIN_CAPITAL_RECONSTRUCTION_REQUIRED'] : []),
        ...(terminal ? ['POSITION_SYNTHETICALLY_CLOSED'] : !increasing ? ['POSITION_SYNTHETICALLY_REDUCED'] : []),
      ]);
      const breached = withProjection(current, {
        state: observedState,
        recoveryResumeState: null,
        openedAtMs,
        entryAveragePrice: average,
        entryCostBasisQuote: nextCostBasisQuote,
        entryCostBasisQuantity: nextCostBasisQuantity,
        currentPrice: settlementPriceTrusted
          ? input.signals.currentPrice : current.openedAtMs === null ? average as string : current.currentPrice,
        favorableExtremePrice: settlementPriceTrusted
          ? favorableExtreme(current.direction, current.favorableExtremePrice ?? average, input.signals.currentPrice)
          : current.favorableExtremePrice ?? average,
        lastMarketObservedAtMs: settlementPriceTrusted
          ? input.market.observedAtMs : current.lastMarketObservedAtMs,
        lastSignalObservedAtMs: settlementPriceTrusted
          ? input.signals.observedAtMs : current.lastSignalObservedAtMs,
        lastMarketObservationRevision: settlementPriceTrusted
          ? digest('l11marketobservation_', input.market) : current.lastMarketObservationRevision,
        lastSignalObservationRevision: settlementPriceTrusted
          ? digest('l11signalobservation_', input.signals) : current.lastSignalObservationRevision,
        positionQuantity: nextQuantity,
        positionQuantityTruth: quantityAmbiguous ? 'UNKNOWN' : 'EXACT',
        projectedMandateUsageQuote: nextUsage,
        capitalUsageTruth: capitalAmbiguous ? 'UNKNOWN' : 'EXACT',
        lastNoFill: null,
        pendingAction: null,
        pendingActionBaseProjectionRevision: null,
        pendingTwinStateRevision: null,
        pendingTwinOutcomeRevision: null,
        lastSettledActionKey: action.actionKey,
        lastTwinStateRevision: settled.twinStateRevision,
        lastTwinOutcomeRevision: settled.twinOutcomeRevision,
        settledTwinHistory: settledTwinHistory(),
        recoveryEvidenceActionKey: null,
        recoveryEvidenceFixtureId: null,
        recoveryEvidenceTwinStateRevision: null,
        recoveryEvidenceTwinOutcomeRevision: null,
        terminalOutcomeReasonCodes: terminal ? observedReasons : current.terminalOutcomeReasonCodes,
        feedbackOutcomeRevision: terminal ? null : current.feedbackOutcomeRevision,
        lastTransition: transition(current.state, observedState, observedReasons, input, settled.twinOutcomeRevision),
      });
      const reconstructionReasons = Object.freeze([
        ...new Set([...observedReasons, 'TWIN_EFFECT_RECONSTRUCTION_REQUIRED']),
      ]);
      const conflict = twinConflict(breached, action, 'TWIN_EFFECT_RECONSTRUCTION_REQUIRED', null, settled);
      return recovery(input, breached, reconstructionReasons,
        quantityAmbiguous || capitalAmbiguous ? 'POSITION_RECONSTRUCTION' : 'CANCEL_OR_REDUCE',
        settled, undefined, conflict);
    }
    const ambiguousUnchanged = current.state === 'RECOVERY_REQUIRED'
      && current.positionQuantityTruth === 'UNKNOWN'
      && current.capitalUsageTruth === 'UNKNOWN'
      && current.pendingTwinStateRevision === settled.twinStateRevision
      && current.pendingTwinOutcomeRevision === settled.twinOutcomeRevision;
    const ambiguous = ambiguousUnchanged ? current : withProjection(current, {
      positionQuantityTruth: 'UNKNOWN',
      capitalUsageTruth: 'UNKNOWN',
      pendingTwinStateRevision: settled.twinStateRevision,
      pendingTwinOutcomeRevision: settled.twinOutcomeRevision,
    });
    return recovery(input, ambiguous, retained(settled.reasonCodes), 'RECONCILIATION_REQUIRED', settled);
  }
  if (settled.state === 'NO_FILL') {
    if (action.kind === 'ENTRY' && current.openedAtMs === null) {
      const reasons = orderReasons([...retained(settled.reasonCodes), 'ENTRY_TERMINAL_NO_FILL'], EXIT_REASON_ORDER);
      const projection = withProjection(current, {
        state: 'EXIT',
        recoveryResumeState: null,
        positionQuantityTruth: 'EXACT',
        capitalUsageTruth: 'EXACT',
        pendingAction: null,
        pendingActionBaseProjectionRevision: null,
        pendingTwinStateRevision: null,
        pendingTwinOutcomeRevision: null,
        lastNoFill: Object.freeze({
          action,
          evidenceKind: 'TWIN_NO_FILL' as const,
          fixtureId: settled.fixtureId,
          twinStateRevision: settled.twinStateRevision,
          twinOutcomeRevision: settled.twinOutcomeRevision,
          recoveryResolutionRevision: null,
        }),
        lastSettledActionKey: action.actionKey,
        lastTwinStateRevision: settled.twinStateRevision,
        lastTwinOutcomeRevision: settled.twinOutcomeRevision,
        settledTwinHistory: settledTwinHistory(),
        recoveryEvidenceActionKey: null,
        recoveryEvidenceFixtureId: null,
        recoveryEvidenceTwinStateRevision: null,
        recoveryEvidenceTwinOutcomeRevision: null,
        lastTransition: transition(current.state, 'EXIT', reasons, input, settled.twinOutcomeRevision),
      });
      return terminalDecision(projection, reasons, settled);
    }
    const reasons = retained([...settled.reasonCodes, 'STAGE_REMAINS_UNCHANGED']);
    const resumedState = current.state === 'RECOVERY_REQUIRED'
      ? current.recoveryResumeState as Exclude<VolumeLifecycleState, 'RECOVERY_REQUIRED'>
      : current.state;
    const noFill = withProjection(current, {
      ...marketObservation(input, current),
      state: resumedState,
      recoveryResumeState: null,
      positionQuantityTruth: 'EXACT',
      capitalUsageTruth: 'EXACT',
      pendingAction: null,
      pendingActionBaseProjectionRevision: null,
      pendingTwinStateRevision: null,
      pendingTwinOutcomeRevision: null,
      lastNoFill: Object.freeze({
        action,
        evidenceKind: 'TWIN_NO_FILL' as const,
        fixtureId: settled.fixtureId,
        twinStateRevision: settled.twinStateRevision,
        twinOutcomeRevision: settled.twinOutcomeRevision,
        recoveryResolutionRevision: null,
      }),
      lastSettledActionKey: action.actionKey,
      lastTwinStateRevision: settled.twinStateRevision,
      lastTwinOutcomeRevision: settled.twinOutcomeRevision,
      settledTwinHistory: settledTwinHistory(),
      recoveryEvidenceActionKey: null,
      recoveryEvidenceFixtureId: null,
      recoveryEvidenceTwinStateRevision: null,
      recoveryEvidenceTwinOutcomeRevision: null,
      lastTransition: transition(current.state, resumedState, reasons, input, settled.twinOutcomeRevision),
    });
    if (action.kind === 'REDUCE' || action.kind === 'EXIT') {
      return recovery(input, noFill, [...reasons, 'RISK_REDUCTION_PROVED_NO_FILL'], 'CANCEL_OR_REDUCE', settled);
    }
    return decision('SETTLED', reasons, noFill, null, settled);
  }

  if (settled.filledCapitalUsageQuote === null || settled.filledFeeQuote === null) {
    throw new TypeError('Volume filled settlement requires exact fee and Capital usage evidence');
  }
  if (action.kind === 'ENTRY' || action.kind === 'ADD') {
    const nextQuantity = addVolumeDecimals(current.positionQuantity, settled.filledQuantity);
    const nextUsage = addVolumeDecimals(current.projectedMandateUsageQuote, settled.filledCapitalUsageQuote);
    const nextCostBasisQuote = addVolumeDecimals(current.entryCostBasisQuote, settled.filledQuoteNotional);
    const nextCostBasisQuantity = addVolumeDecimals(current.entryCostBasisQuantity, settled.filledQuantity);
    const average = divideVolumeDecimals(nextCostBasisQuote, nextCostBasisQuantity);
    const fillTimes = input.twinEvidence?.twinState.orders
      .find((candidate) => candidate.fixture.fixtureId === settled.fixtureId)?.fills.map((fill) => fill.occurredAtMs) ?? [];
    const firstFillAt = fillTimes.length === 0 ? input.evaluatedAtMs : Math.min(...fillTimes);
    const openedAtMs = current.openedAtMs ?? firstFillAt;
    const settlementPriceTrusted = marketPriceIsTrusted(
      input,
      current.lastTransition.occurredAtMs,
      openedAtMs,
      current.lastMarketObservedAtMs,
      current.lastSignalObservedAtMs,
      current.lastMarketObservationRevision,
      current.lastSignalObservationRevision,
    );
    const reasons = retained([...settled.reasonCodes, `STAGE_${action.stageTo}_APPLIED`]);
    const projection = withProjection(current, {
      state: action.stageTo,
      recoveryResumeState: null,
      openedAtMs,
      stageEnteredAtMs: input.evaluatedAtMs,
      entryAveragePrice: average,
      entryCostBasisQuote: nextCostBasisQuote,
      entryCostBasisQuantity: nextCostBasisQuantity,
      currentPrice: settlementPriceTrusted
        ? input.signals.currentPrice : current.openedAtMs === null ? average : current.currentPrice,
      favorableExtremePrice: settlementPriceTrusted
        ? favorableExtreme(current.direction, current.favorableExtremePrice ?? average, input.signals.currentPrice)
        : current.favorableExtremePrice ?? average,
      lastMarketObservedAtMs: settlementPriceTrusted
        ? input.market.observedAtMs : current.lastMarketObservedAtMs,
      lastSignalObservedAtMs: settlementPriceTrusted
        ? input.signals.observedAtMs : current.lastSignalObservedAtMs,
      lastMarketObservationRevision: settlementPriceTrusted
        ? digest('l11marketobservation_', input.market) : current.lastMarketObservationRevision,
      lastSignalObservationRevision: settlementPriceTrusted
        ? digest('l11signalobservation_', input.signals) : current.lastSignalObservationRevision,
      positionQuantity: nextQuantity,
      positionQuantityTruth: 'EXACT',
      projectedMandateUsageQuote: nextUsage,
      capitalUsageTruth: 'EXACT',
      lastNoFill: null,
      pendingAction: null,
      pendingActionBaseProjectionRevision: null,
      pendingTwinStateRevision: null,
      pendingTwinOutcomeRevision: null,
      lastSettledActionKey: action.actionKey,
      lastTwinStateRevision: settled.twinStateRevision,
      lastTwinOutcomeRevision: settled.twinOutcomeRevision,
      settledTwinHistory: settledTwinHistory(),
      recoveryEvidenceActionKey: null,
      recoveryEvidenceFixtureId: null,
      recoveryEvidenceTwinStateRevision: null,
      recoveryEvidenceTwinOutcomeRevision: null,
      lastTransition: transition(current.state, action.stageTo, reasons, input, settled.twinOutcomeRevision),
    });
    return decision('SETTLED', reasons, projection, null, settled);
  }

  if (compareVolumeDecimals(settled.filledQuantity, current.positionQuantity) > 0) {
    return recovery(input, current, ['TWIN_REDUCTION_EXCEEDS_POSITION'], 'POSITION_RECONSTRUCTION', settled);
  }
  const remaining = subtractVolumeDecimals(current.positionQuantity, settled.filledQuantity);
  const terminal = compareVolumeDecimals(remaining, '0') === 0;
  const nextState: VolumeLifecycleState = terminal ? 'EXIT' : action.kind === 'REDUCE' ? 'REDUCE' : 'RECOVERY_REQUIRED';
  if (action.kind === 'EXIT' && !terminal) {
    return recovery(input, current, ['EXIT_TWIN_LEFT_RESIDUAL_POSITION'], 'CANCEL_OR_REDUCE', settled);
  }
  const settlementPriceTrusted = current.openedAtMs !== null && marketPriceIsTrusted(
    input,
    current.lastTransition.occurredAtMs,
    current.openedAtMs,
    current.lastMarketObservedAtMs,
    current.lastSignalObservedAtMs,
    current.lastMarketObservationRevision,
    current.lastSignalObservationRevision,
  );
  const reasons = retained([...settled.reasonCodes, terminal ? 'POSITION_SYNTHETICALLY_CLOSED' : 'POSITION_SYNTHETICALLY_REDUCED']);
  const projection = withProjection(current, {
    state: nextState,
    recoveryResumeState: null,
    stageEnteredAtMs: input.evaluatedAtMs,
    currentPrice: settlementPriceTrusted ? input.signals.currentPrice : current.currentPrice,
    favorableExtremePrice: settlementPriceTrusted
      ? favorableExtreme(current.direction, current.favorableExtremePrice, input.signals.currentPrice)
      : current.favorableExtremePrice,
    lastMarketObservedAtMs: settlementPriceTrusted
      ? input.market.observedAtMs : current.lastMarketObservedAtMs,
    lastSignalObservedAtMs: settlementPriceTrusted
      ? input.signals.observedAtMs : current.lastSignalObservedAtMs,
    lastMarketObservationRevision: settlementPriceTrusted
      ? digest('l11marketobservation_', input.market) : current.lastMarketObservationRevision,
    lastSignalObservationRevision: settlementPriceTrusted
      ? digest('l11signalobservation_', input.signals) : current.lastSignalObservationRevision,
    positionQuantity: remaining,
    positionQuantityTruth: 'EXACT',
    capitalUsageTruth: 'EXACT',
    lastNoFill: null,
    pendingAction: null,
    pendingActionBaseProjectionRevision: null,
    pendingTwinStateRevision: null,
    pendingTwinOutcomeRevision: null,
    lastSettledActionKey: action.actionKey,
    lastTwinStateRevision: settled.twinStateRevision,
    lastTwinOutcomeRevision: settled.twinOutcomeRevision,
    settledTwinHistory: settledTwinHistory(),
    recoveryEvidenceActionKey: null,
    recoveryEvidenceFixtureId: null,
    recoveryEvidenceTwinStateRevision: null,
    recoveryEvidenceTwinOutcomeRevision: null,
    lastTransition: transition(current.state, nextState, reasons, input, settled.twinOutcomeRevision),
  });
  return terminal ? terminalDecision(projection, reasons, settled) : decision('SETTLED', reasons, projection, null, settled);
}

function planIncreasingStage(
  input: Readonly<VolumeLifecycleInput>,
  current: Readonly<VolumeLifecycleProjection>,
  kind: 'ENTRY' | 'ADD',
  targetState: 'PROBE' | 'CONFIRM' | 'HOLD',
): Readonly<VolumeLifecycleDecision> {
  const gates = entryGateReasons(input, current.lifecycleId);
  if (gates.length > 0) return decision('BLOCKED', gates, retainMarketObservation(input, current));
  if (kind === 'ADD' && (input.signals.confirmation !== 'CONFIRMED'
    || input.signals.addPermission !== 'ALLOWED')) {
    return decision('BLOCKED', ['ADD_OWNER_EVIDENCE_NOT_CONFIRMED'], retainMarketObservation(input, current));
  }
  const requiredRiskClass = kind === 'ENTRY' ? 'OPEN' : 'ADD';
  if (input.authority.riskActionClass !== requiredRiskClass) {
    return decision('BLOCKED', [`RISK_ACTION_CLASS_${requiredRiskClass}_REQUIRED`],
      retainMarketObservation(input, current));
  }
  const cut = stageCut(input, targetState);
  const currentOwnerEvidenceRevision = ownerEvidenceRevision(input);
  if (current.lastNoFill?.action.ownerEvidenceRevision === currentOwnerEvidenceRevision) {
    return decision('HOLD', ['UNCHANGED_OWNER_EVIDENCE_AFTER_NO_FILL'], retainMarketObservation(input, current));
  }
  if (compareVolumeDecimals(cut.cumulativeQuantity, current.positionQuantity) <= 0) {
    return decision('HOLD', ['STAGE_TARGET_ALREADY_REACHED'], retainMarketObservation(input, current));
  }
  const lifecycleUsage = subtractVolumeDecimals(
    current.projectedMandateUsageQuote,
    current.mandateUsageAtLifecycleStartQuote,
  );
  if (compareVolumeDecimals(cut.cumulativeNotionalQuote, lifecycleUsage) <= 0) {
    return decision('HOLD', ['STAGE_NOTIONAL_TARGET_ALREADY_REACHED'], retainMarketObservation(input, current));
  }
  const requestedQuantity = subtractVolumeDecimals(cut.cumulativeQuantity, current.positionQuantity);
  const maximumNotionalQuote = subtractVolumeDecimals(cut.cumulativeNotionalQuote, lifecycleUsage);
  if (compareVolumeDecimals(input.market.intendedDepthQuote, maximumNotionalQuote) < 0) {
    return decision('BLOCKED', ['STAGE_DEPTH_INSUFFICIENT'], retainMarketObservation(input, current));
  }
  const nextUsage = addVolumeDecimals(current.projectedMandateUsageQuote, maximumNotionalQuote);
  if (compareVolumeDecimals(nextUsage, input.authority.capitalMaximumQuote) > 0) {
    return decision('BLOCKED', ['SINGLE_MANDATE_CAP_EXCEEDED'], retainMarketObservation(input, current));
  }
  const request = actionRequest(input, current, kind, targetState, requestedQuantity, cut.priceBound, maximumNotionalQuote, nextUsage);
  if (current.lastNoFill?.action.intentKey === request.intentKey) {
    return decision('HOLD', ['UNCHANGED_INTENT_AFTER_NO_FILL'], retainMarketObservation(input, current));
  }
  const priorActionMatch = priorActionMatchState(input, request);
  if (priorActionMatch === 'CONFLICT') {
    if (input.current === null) {
      return decision('BLOCKED', ['CANONICAL_PRIOR_ACTION_BINDING_MISMATCH'], current);
    }
    return recovery(input, current, ['CANONICAL_PRIOR_ACTION_BINDING_MISMATCH'],
      'POSITION_RECONSTRUCTION', null);
  }
  if (priorActionMatch === 'EXACT') {
    return decision('NOOP_REPEAT', ['ACTION_ALREADY_RECORDED'], current);
  }
  const reasons = Object.freeze([kind === 'ENTRY' ? 'STAGED_PROBE_PLANNED' : `STAGED_${targetState}_PLANNED`]);
  const projection = withProjection(current, {
    ...marketObservation(input, current),
    pendingAction: request,
    pendingActionBaseProjectionRevision: request.projectionRevision,
    lastTransition: transition(current.openedAtMs === null ? null : current.state, current.state, reasons, input),
  });
  return decision('PLANNED', reasons, projection, request);
}

function priorActionMatchState(
  input: Readonly<VolumeLifecycleInput>,
  request: Readonly<VolumeLifecycleActionRequest>,
): 'NONE' | 'EXACT' | 'CONFLICT' {
  const matches = input.occupancy.priorActions.filter((prior) => (
    prior.actionKey === request.actionKey || prior.intentKey === request.intentKey
  ));
  if (matches.length === 0) return 'NONE';
  const exact = matches.every((prior) => (prior.actionKey !== request.actionKey
      || prior.intentKey === request.intentKey)
    && prior.intentKey === request.intentKey
    && prior.lifecycleId === request.lifecycleId
    && prior.proposalId === request.proposalId
    && prior.assessmentId === request.assessmentId
    && prior.symbol === request.symbol
    && prior.direction === request.direction
    && prior.kind === request.kind);
  return exact ? 'EXACT' : 'CONFLICT';
}

function planRiskReduction(
  input: Readonly<VolumeLifecycleInput>,
  current: Readonly<VolumeLifecycleProjection>,
  kind: 'REDUCE' | 'EXIT',
  reasons: readonly string[],
): Readonly<VolumeLifecycleDecision> {
  const now = input.evaluatedAtMs;
  const recoveryRetryLineage = (current.lastNoFill?.action.kind === 'REDUCE'
    || current.lastNoFill?.action.kind === 'EXIT')
    && current.lastNoFill.recoveryResolutionRevision !== null;
  const inventoryProof = [input.sizing.availableBaseQuantity, input.sizing.inventoryRevision,
    input.sizing.inventoryAsset, input.sizing.inventoryAccountRealmId,
    input.sizing.inventoryObservedAtMs, input.sizing.inventoryValidUntilMs];
  const sizingDirectionReady = current.direction === 'LONG'
    ? input.sizing.inventoryMode === 'QUOTE_FUNDED_LONG'
      && inventoryProof.every((entry) => entry === null)
    : input.sizing.inventoryMode === 'PREOWNED_BASE_SHORT'
      && inventoryProof.every((entry) => entry !== null)
      && input.sizing.inventoryAsset === current.baseAsset
      && input.sizing.inventoryAccountRealmId === current.accountRealmId;
  const ownerRecheckReady = input.authority.riskState === 'ALLOWED'
    && input.authority.riskActionClass === kind
    && input.authority.riskEvaluatedAtMs <= now
    && input.authority.riskEvaluatedAtMs >= input.market.observedAtMs
    && input.authority.riskEvaluatedAtMs >= input.signals.observedAtMs
    && riskVerdictCoversEvidence(input, Math.max(
      current.lastTransition.occurredAtMs,
      current.lastRecoveryResolvedAtMs ?? 0,
    ), false)
    && (!recoveryRetryLineage || current.lastRecoveryResolvedAtMs !== null)
    && now < input.authority.riskExpiresAtMs
    && input.authority.riskBoundLifecycleId === current.lifecycleId
    && input.authority.riskBoundProjectionRevision === input.current?.projectionRevision
    && input.authority.riskBoundPositionQuantity === input.current?.positionQuantity
    && input.authority.riskContextRevision === deriveVolumeRiskContextRevision(input)
    && input.authority.accountTruth === 'COMPLETE'
    && input.authority.positionTruth === 'COMPLETE'
    && input.sizing.state === 'READY'
    && input.sizing.product === 'SPOT'
    && input.sizing.symbol === current.symbol
    && input.sizing.accountRealmId === current.accountRealmId
    && input.sizing.baseAsset === current.baseAsset
    && input.sizing.quoteAsset === current.quoteAsset
    && sizingDirectionReady
    && input.sizing.observedAtMs <= now
    && input.sizing.observedAtMs <= input.authority.riskEvaluatedAtMs
    && now < input.sizing.validUntilMs
    && now - input.sizing.observedAtMs <= input.policy.maximumEvidenceAgeMs
    && input.market.truth === 'COMPLETE'
    && now >= input.market.observedAtMs && now < input.market.validUntilMs
    && now - input.market.observedAtMs <= input.policy.maximumEvidenceAgeMs
    && now >= input.signals.observedAtMs && now < input.signals.validUntilMs
    && now - input.signals.observedAtMs <= input.policy.maximumEvidenceAgeMs;
  if (!ownerRecheckReady) {
    return recovery(
      input,
      current,
      orderReasons(['RISK_REDUCTION_OWNER_RECHECK_REQUIRED', ...reasons], EXIT_REASON_ORDER),
      'CANCEL_OR_REDUCE',
      null,
    );
  }
  if (compareVolumeDecimals(current.positionQuantity, '0') === 0) {
    const projection = withProjection(current, {
      state: 'EXIT',
      recoveryResumeState: null,
      pendingAction: null,
      pendingActionBaseProjectionRevision: null,
      lastTransition: transition(current.state, 'EXIT', reasons, input),
    });
    return terminalDecision(projection, reasons, null);
  }
  let episodeRevision: string | null = null;
  let episodeReasons: readonly string[] | null = null;
  let episodeBasis: string | null = null;
  let targetRemaining: string;
  if (kind === 'EXIT') {
    targetRemaining = '0';
  } else {
    episodeReasons = Object.freeze([...reasons]);
    const sameEpisode = current.reductionEpisodeRevision !== null
      && current.reductionEpisodeReasonCodes !== null
      && current.reductionEpisodeReasonCodes.length === episodeReasons.length
      && current.reductionEpisodeReasonCodes.every((reason, index) => reason === episodeReasons?.[index]);
    const reductionBasis = sameEpisode
      ? current.reductionBasisQuantity ?? current.positionQuantity : current.positionQuantity;
    episodeBasis = reductionBasis;
    episodeRevision = sameEpisode ? current.reductionEpisodeRevision : digest('l11reduction_', {
      lifecycleId: current.lifecycleId,
      basisQuantity: reductionBasis,
      triggerReasonCodes: episodeReasons,
      priorTwinOutcomeRevision: current.lastTwinOutcomeRevision,
      signalObservedAtMs: input.signals.observedAtMs,
      signalEvidenceIds: input.signals.evidenceIds,
      advisoryEvidenceRevision: input.advisory.evidenceRevision,
    });
    targetRemaining = multiplyVolumePpm(reductionBasis, input.policy.exhaustionReductionTargetPpm);
  }
  if (compareVolumeDecimals(current.positionQuantity, targetRemaining) <= 0) {
    if (episodeRevision !== null && (current.reductionEpisodeRevision !== episodeRevision
      || current.reductionTargetQuantity !== targetRemaining)) {
      const satisfied = withProjection(current, {
        ...marketObservation(input, current),
        reductionEpisodeRevision: episodeRevision,
        reductionEpisodeReasonCodes: episodeReasons,
        reductionBasisQuantity: episodeBasis,
        reductionTargetQuantity: targetRemaining,
        lastTransition: transition(current.state, current.state, ['REDUCTION_TARGET_ALREADY_REACHED'], input),
      });
      return decision('HOLD', ['REDUCTION_TARGET_ALREADY_REACHED'], satisfied);
    }
    return decision('HOLD', ['REDUCTION_TARGET_ALREADY_REACHED'], retainMarketObservation(input, current));
  }
  const requestedQuantity = subtractVolumeDecimals(current.positionQuantity, targetRemaining);
  const maximumNotionalQuote = multiplyVolumeDecimals(input.market.riskReductionPriceBound, requestedQuantity);
  const request = actionRequest(
    input,
    current,
    kind,
    kind,
    requestedQuantity,
    input.market.riskReductionPriceBound,
    maximumNotionalQuote,
    current.projectedMandateUsageQuote,
    episodeRevision,
    reasons,
  );
  if (current.lastNoFill?.action.intentKey === request.intentKey) {
    return decision('HOLD', ['UNCHANGED_INTENT_AFTER_NO_FILL', ...reasons],
      retainMarketObservation(input, current));
  }
  const priorActionMatch = priorActionMatchState(input, request);
  if (priorActionMatch === 'CONFLICT') {
    return recovery(input, current, Object.freeze([
      'CANONICAL_PRIOR_ACTION_BINDING_MISMATCH',
      ...request.triggerReasonCodes,
    ]), 'POSITION_RECONSTRUCTION', null);
  }
  if (priorActionMatch === 'EXACT') {
    return decision('NOOP_REPEAT', ['ACTION_ALREADY_RECORDED', ...reasons], current);
  }
  const projection = withProjection(current, {
    ...marketObservation(input, current),
    reductionEpisodeRevision: episodeRevision ?? current.reductionEpisodeRevision,
    reductionEpisodeReasonCodes: episodeRevision === null ? current.reductionEpisodeReasonCodes : episodeReasons,
    reductionBasisQuantity: episodeRevision === null ? current.reductionBasisQuantity : episodeBasis,
    reductionTargetQuantity: episodeRevision === null ? current.reductionTargetQuantity : targetRemaining,
    pendingAction: request,
    pendingActionBaseProjectionRevision: request.projectionRevision,
    lastTransition: transition(current.state, current.state, reasons, input),
  });
  return decision('PLANNED', reasons, projection, request);
}

function exitTriggers(
  input: Readonly<VolumeLifecycleInput>,
  current: Readonly<VolumeLifecycleProjection>,
): Readonly<{ reasons: readonly string[]; action: 'RECOVERY' | 'EXIT' | 'REDUCE' | null }> {
  const reasons: string[] = [];
  if (input.signals.reconciliationState === 'MISMATCH') reasons.push('RECONCILIATION_MISMATCH');
  else if (input.signals.reconciliationState === 'UNKNOWN') reasons.push('RECONCILIATION_UNKNOWN');
  if (input.signals.globalHalt) reasons.push('GLOBAL_HALT');
  if (input.signals.manualClose) reasons.push('MANUAL_CLOSE');
  if (input.signals.thesisInvalidated === true) reasons.push('THESIS_INVALIDATED');
  else if (input.signals.thesisInvalidated === null) reasons.push('THESIS_INVALIDATION_UNKNOWN');
  if (input.signals.reversal === 'PRESENT') reasons.push('VOLUME_REVERSAL');
  else if (input.signals.reversal === 'UNKNOWN') reasons.push('VOLUME_REVERSAL_UNKNOWN');
  if (current.entryAveragePrice !== null
    && lossStopReachedFromCostBasis(
      current.direction,
      current.entryCostBasisQuote,
      current.entryCostBasisQuantity,
      input.signals.currentPrice,
      input.policy.maximumLossBps,
    )) {
    reasons.push('MAXIMUM_LOSS_REACHED');
  }
  if (current.entryAveragePrice !== null && current.favorableExtremePrice !== null
    && trailingStopReachedFromCostBasis(
      current.direction,
      current.entryCostBasisQuote,
      current.entryCostBasisQuantity,
      favorableExtreme(current.direction, current.favorableExtremePrice, input.signals.currentPrice),
      input.signals.currentPrice,
      input.policy.trailingActivationBps,
      input.policy.trailingDistanceBps,
    )) reasons.push('TRAILING_STOP_REACHED');
  if (current.openedAtMs !== null && input.evaluatedAtMs - current.openedAtMs >= input.policy.maximumHoldingMs) {
    reasons.push('TIME_STOP_REACHED');
  }
  if (input.signals.sourceState !== 'HEALTHY') {
    reasons.push(input.policy.sourceDegradationAction === 'EXIT' ? 'SOURCE_DEGRADED_EXIT' : 'SOURCE_DEGRADED_REDUCE');
  }
  if (input.signals.spreadDepthState === 'DETERIORATED') reasons.push('SPREAD_DEPTH_DETERIORATED');
  else if (input.signals.spreadDepthState === 'UNKNOWN') reasons.push('SPREAD_DEPTH_UNKNOWN');
  if (input.signals.exhaustion === 'PRESENT' && current.entryKind !== 'FADE') {
    reasons.push('VOLUME_EXHAUSTION');
  }
  else if (input.signals.exhaustion === 'UNKNOWN') reasons.push('VOLUME_EXHAUSTION_UNKNOWN');
  const ordered = orderReasons(reasons, EXIT_REASON_ORDER);
  if (ordered.some((reason) => [
    'RECONCILIATION_MISMATCH', 'RECONCILIATION_UNKNOWN', 'VOLUME_REVERSAL_UNKNOWN',
    'VOLUME_EXHAUSTION_UNKNOWN', 'SPREAD_DEPTH_UNKNOWN',
  ].includes(reason))) {
    return Object.freeze({ reasons: ordered, action: 'RECOVERY' });
  }
  if (ordered.some((reason) => [
    'GLOBAL_HALT', 'MANUAL_CLOSE', 'THESIS_INVALIDATED', 'THESIS_INVALIDATION_UNKNOWN',
    'VOLUME_REVERSAL', 'MAXIMUM_LOSS_REACHED', 'TRAILING_STOP_REACHED',
    'TIME_STOP_REACHED', 'SOURCE_DEGRADED_EXIT',
  ].includes(reason))) return Object.freeze({ reasons: ordered, action: 'EXIT' });
  if (ordered.length > 0) return Object.freeze({ reasons: ordered, action: 'REDUCE' });
  return Object.freeze({ reasons: Object.freeze([]), action: null });
}

function activeEvidenceReasons(
  input: Readonly<VolumeLifecycleInput>,
  current: Readonly<VolumeLifecycleProjection>,
): readonly string[] {
  const reasons: string[] = [];
  const now = input.evaluatedAtMs;
  const minimumMarketObservedAtMs = Math.max(
    current.openedAtMs ?? 0,
    current.lastMarketObservedAtMs ?? 0,
  );
  const minimumSignalObservedAtMs = Math.max(
    current.openedAtMs ?? 0,
    current.lastSignalObservedAtMs ?? 0,
  );
  const marketRevision = digest('l11marketobservation_', input.market);
  const signalRevision = digest('l11signalobservation_', input.signals);
  const marketChronologyConflict = current.lastMarketObservedAtMs !== null
    && input.market.observedAtMs === current.lastMarketObservedAtMs
    && marketRevision !== current.lastMarketObservationRevision;
  const signalChronologyConflict = current.lastSignalObservedAtMs !== null
    && input.signals.observedAtMs === current.lastSignalObservedAtMs
    && signalRevision !== current.lastSignalObservationRevision;
  if (input.market.truth !== 'COMPLETE') reasons.push('ACTIVE_MARKET_TRUTH_INCOMPLETE');
  if (input.authority.accountTruth !== 'COMPLETE') reasons.push('ACTIVE_ACCOUNT_TRUTH_INCOMPLETE');
  if (input.authority.positionTruth !== 'COMPLETE') reasons.push('ACTIVE_POSITION_TRUTH_INCOMPLETE');
  if (marketChronologyConflict || input.market.observedAtMs < minimumMarketObservedAtMs
    || input.market.observedAtMs > now || input.market.validUntilMs <= now
    || now - input.market.observedAtMs > input.policy.maximumEvidenceAgeMs) {
    reasons.push('ACTIVE_MARKET_EVIDENCE_STALE');
  }
  if (signalChronologyConflict || input.signals.observedAtMs < minimumSignalObservedAtMs
    || input.signals.observedAtMs > now || input.signals.validUntilMs <= now
    || now - input.signals.observedAtMs > input.policy.maximumEvidenceAgeMs) {
    reasons.push('ACTIVE_SIGNAL_EVIDENCE_STALE');
  }
  if (input.market.currentPrice !== input.signals.currentPrice) {
    reasons.push('ACTIVE_MARKET_SIGNAL_PRICE_MISMATCH');
  }
  return orderReasons(reasons, EXIT_REASON_ORDER);
}

function marketPriceIsTrusted(
  input: Readonly<VolumeLifecycleInput>,
  minimumChronologyMs: number,
  minimumObservationMs: number,
  priorMarketObservedAtMs: number | null,
  priorSignalObservedAtMs: number | null,
  priorMarketObservationRevision: string | null,
  priorSignalObservationRevision: string | null,
): boolean {
  const marketRevision = digest('l11marketobservation_', input.market);
  const signalRevision = digest('l11signalobservation_', input.signals);
  return input.evaluatedAtMs >= minimumChronologyMs
    && input.market.truth === 'COMPLETE'
    && input.market.currentPrice === input.signals.currentPrice
    && input.market.observedAtMs >= minimumObservationMs
    && input.signals.observedAtMs >= minimumObservationMs
    && (priorMarketObservedAtMs === null || input.market.observedAtMs >= priorMarketObservedAtMs)
    && (priorSignalObservedAtMs === null || input.signals.observedAtMs >= priorSignalObservedAtMs)
    && (priorMarketObservedAtMs === null || input.market.observedAtMs > priorMarketObservedAtMs
      || marketRevision === priorMarketObservationRevision)
    && (priorSignalObservedAtMs === null || input.signals.observedAtMs > priorSignalObservedAtMs
      || signalRevision === priorSignalObservationRevision)
    && input.market.observedAtMs <= input.evaluatedAtMs
    && input.signals.observedAtMs <= input.evaluatedAtMs
    && input.evaluatedAtMs < input.market.validUntilMs
    && input.evaluatedAtMs < input.signals.validUntilMs
    && input.evaluatedAtMs - input.market.observedAtMs <= input.policy.maximumEvidenceAgeMs
    && input.evaluatedAtMs - input.signals.observedAtMs <= input.policy.maximumEvidenceAgeMs;
}

function marketObservation(
  input: Readonly<VolumeLifecycleInput>,
  current: Readonly<VolumeLifecycleProjection>,
): Readonly<Pick<VolumeLifecycleProjection, 'currentPrice' | 'favorableExtremePrice'
  | 'lastMarketObservedAtMs' | 'lastSignalObservedAtMs'
  | 'lastMarketObservationRevision' | 'lastSignalObservationRevision'>> {
  const trusted = current.openedAtMs !== null
    && compareVolumeDecimals(current.positionQuantity, '0') > 0
    && marketPriceIsTrusted(
      input,
      current.lastTransition.occurredAtMs,
      current.openedAtMs,
      current.lastMarketObservedAtMs,
      current.lastSignalObservedAtMs,
      current.lastMarketObservationRevision,
      current.lastSignalObservationRevision,
    );
  if (!trusted) {
    return Object.freeze({
      currentPrice: current.currentPrice,
      favorableExtremePrice: current.favorableExtremePrice,
      lastMarketObservedAtMs: current.lastMarketObservedAtMs,
      lastSignalObservedAtMs: current.lastSignalObservedAtMs,
      lastMarketObservationRevision: current.lastMarketObservationRevision,
      lastSignalObservationRevision: current.lastSignalObservationRevision,
    });
  }
  return Object.freeze({
    currentPrice: input.signals.currentPrice,
    favorableExtremePrice: favorableExtreme(
      current.direction,
      current.favorableExtremePrice,
      input.signals.currentPrice,
    ),
    lastMarketObservedAtMs: input.market.observedAtMs,
    lastSignalObservedAtMs: input.signals.observedAtMs,
    lastMarketObservationRevision: digest('l11marketobservation_', input.market),
    lastSignalObservationRevision: digest('l11signalobservation_', input.signals),
  });
}

function retainMarketObservation(
  input: Readonly<VolumeLifecycleInput>,
  current: Readonly<VolumeLifecycleProjection>,
): Readonly<VolumeLifecycleProjection> {
  const observed = marketObservation(input, current);
  if (current.currentPrice === observed.currentPrice
    && current.favorableExtremePrice === observed.favorableExtremePrice
    && current.lastMarketObservedAtMs === observed.lastMarketObservedAtMs
    && current.lastSignalObservedAtMs === observed.lastSignalObservedAtMs
    && current.lastMarketObservationRevision === observed.lastMarketObservationRevision
    && current.lastSignalObservationRevision === observed.lastSignalObservationRevision) return current;
  return withProjection(current, {
    ...observed,
    lastTransition: transition(current.state, current.state, ['MARKET_OBSERVATION_PROJECTED'], input),
  });
}

function updateMarketProjection(
  input: Readonly<VolumeLifecycleInput>,
  current: Readonly<VolumeLifecycleProjection>,
): Readonly<VolumeLifecycleProjection> {
  const observed = marketObservation(input, current);
  if (current.pendingAction !== null) {
    if (current.currentPrice === observed.currentPrice
      && current.favorableExtremePrice === observed.favorableExtremePrice
      && current.lastMarketObservedAtMs === observed.lastMarketObservedAtMs
      && current.lastSignalObservedAtMs === observed.lastSignalObservedAtMs
      && current.lastMarketObservationRevision === observed.lastMarketObservationRevision
      && current.lastSignalObservationRevision === observed.lastSignalObservationRevision) return current;
    return withProjection(current, {
      ...observed,
      lastTransition: transition(current.state, current.state, ['MARKET_OBSERVATION_PROJECTED'], input),
    });
  }
  const triggers = exitTriggers(input, current);
  const sameReductionTrigger = triggers.action === 'REDUCE'
    && current.reductionEpisodeReasonCodes !== null
    && current.reductionEpisodeReasonCodes.length === triggers.reasons.length
    && current.reductionEpisodeReasonCodes.every((reason, index) => reason === triggers.reasons[index]);
  const clearReduction = current.reductionEpisodeRevision !== null && !sameReductionTrigger;
  if (current.currentPrice === observed.currentPrice
    && current.favorableExtremePrice === observed.favorableExtremePrice
    && current.lastMarketObservedAtMs === observed.lastMarketObservedAtMs
    && current.lastSignalObservedAtMs === observed.lastSignalObservedAtMs
    && current.lastMarketObservationRevision === observed.lastMarketObservationRevision
    && current.lastSignalObservationRevision === observed.lastSignalObservationRevision
    && !clearReduction) {
    return current;
  }
  return withProjection(current, {
    ...observed,
    ...(clearReduction ? {
      reductionEpisodeRevision: null,
      reductionEpisodeReasonCodes: null,
      reductionBasisQuantity: null,
      reductionTargetQuantity: null,
    } : {}),
    lastTransition: transition(current.state, current.state,
      [clearReduction ? 'REDUCTION_EPISODE_CLEARED' : 'MARKET_OBSERVATION_PROJECTED'], input),
  });
}

export function projectVolumeProtectionRevision(input: Readonly<{
  projection: unknown;
  occupancy: unknown;
  currentPolicy: unknown;
  proposedPolicy: unknown;
  evaluatedAtMs: number;
}>): Readonly<{
  decision: Readonly<VolumeProtectionRevisionDecision>;
  projection: Readonly<VolumeLifecycleProjection>;
}> {
  const safeInput = snapshot(input);
  const expectedFields = new Set([
    'projection', 'occupancy', 'currentPolicy', 'proposedPolicy', 'evaluatedAtMs',
  ]);
  if (safeInput === null || typeof safeInput !== 'object' || Array.isArray(safeInput)
    || Object.keys(safeInput).length !== expectedFields.size
    || Object.keys(safeInput).some((field) => !expectedFields.has(field))) {
    throw new TypeError('Volume protection revision projection input must use its closed schema');
  }
  const projection = validateLifecycleProjection(safeInput.projection);
  const occupancy = validateVolumeOccupancyProjection(safeInput.occupancy);
  const currentPolicy = validateVolumeProtectionPolicy(safeInput.currentPolicy);
  const proposedPolicy = validateVolumeProtectionPolicy(safeInput.proposedPolicy);
  if (!Number.isSafeInteger(safeInput.evaluatedAtMs)
    || safeInput.evaluatedAtMs < projection.lastTransition.occurredAtMs) {
    throw new TypeError('Volume protection revision evaluation time regresses lifecycle chronology');
  }
  if (occupancy.priorActions.some((record) => record.recordedAtMs > safeInput.evaluatedAtMs
    || record.recordedAtMs > occupancy.observedAtMs)) {
    throw new TypeError('Volume protection revision occupancy history exceeds its observation chronology');
  }
  if (projection.pendingAction !== null) {
    throw new TypeError('Volume protection revision cannot supersede a pending action');
  }
  if (projection.unresolvedTwinConflict !== null) {
    throw new TypeError('Volume protection revision cannot supersede unresolved twin reconstruction');
  }
  const ownRecords = occupancy.activeRecords.filter((record) => (
    record.symbol === projection.symbol && record.lifecycleId === projection.lifecycleId
  ));
  const positionHeads = ownRecords.filter((record) => record.kind === 'POSITION');
  const expectedState = projection.state === 'RECOVERY_REQUIRED' ? 'RECOVERY_REQUIRED'
    : projection.state === 'EXIT' ? 'CLOSED' : 'ACTIVE';
  if (occupancy.truth !== 'COMPLETE'
    || occupancy.observedAtMs < projection.lastTransition.occurredAtMs
    || occupancy.observedAtMs > safeInput.evaluatedAtMs
    || safeInput.evaluatedAtMs >= occupancy.validUntilMs
    || positionHeads.length !== 1
    || positionHeads[0]?.projectionRevision !== projection.projectionRevision
    || positionHeads[0]?.ownerFamily !== 'VOLUME_LIFECYCLE_ADAPTER'
    || positionHeads[0]?.proposalId !== projection.proposalId
    || positionHeads[0]?.assessmentId !== projection.assessmentId
    || positionHeads[0]?.direction !== projection.direction
    || positionHeads[0]?.state !== expectedState
    || positionHeads[0]?.positionQuantity !== projection.positionQuantity
    || ownRecords.some((record) => record.kind === 'TICKET')
    || occupancy.activeRecords.some((record) => record.symbol === projection.symbol
      && record.state !== 'CLOSED' && record.lifecycleId !== projection.lifecycleId)) {
    throw new TypeError('Volume protection revision requires the exact canonical projection head');
  }
  if (projection.state === 'EXIT'
    || (projection.state === 'RECOVERY_REQUIRED' && projection.recoveryResumeState === 'EXIT')) {
    throw new TypeError('Volume protection revision cannot rewrite terminal lifecycle lineage');
  }
  if (projection.policyRevision !== currentPolicy.policyRevision) {
    throw new TypeError('Volume policy revision projection is not bound to the current policy');
  }
  const revisionDecision = evaluateVolumeProtectionRevision({
    current: currentPolicy,
    proposed: proposedPolicy,
    evaluatedAtMs: safeInput.evaluatedAtMs,
    positionActive: projection.pendingAction !== null || projection.state === 'RECOVERY_REQUIRED'
      || compareVolumeDecimals(projection.positionQuantity, '0') > 0,
  });
  if (revisionDecision.state !== 'ACCEPTED') return deepFreeze({ decision: revisionDecision, projection });
  const revised = withProjection(projection, {
    policyRevision: proposedPolicy.policyRevision,
    lastTransition: {
      ...projection.lastTransition,
      from: projection.state,
      to: projection.state,
      primaryReasonCode: 'PROTECTION_POLICY_REVISION_ADOPTED',
      reasonCodes: Object.freeze(['PROTECTION_POLICY_REVISION_ADOPTED']),
      occurredAtMs: safeInput.evaluatedAtMs,
    },
  });
  if (revised.favorableExtremePrice !== projection.favorableExtremePrice) {
    throw new TypeError('Volume protection revision changed the favorable extreme');
  }
  return deepFreeze({ decision: revisionDecision, projection: validateLifecycleProjection(revised) });
}

/**
 * Pure L11 projection. It consumes owner-bound strategy/advisory/Capital/Risk
 * facts and accepted L07 synthetic evidence, and can only return record-only
 * action/recovery/feedback handoffs. It owns no detector, position, journal,
 * recovery, exchange or money authority.
 */
export function evaluateVolumeLifecycle(rawInput: unknown): Readonly<VolumeLifecycleDecision> {
  const input = validateLifecycleInput(rawInput);
  const id = lifecycleId(input);
  let current = input.current;
  if (current === null) {
    if (input.twinEvidence !== null) throw new TypeError('Volume twin evidence cannot exist without a current lifecycle');
    const gates = entryGateReasons(input, id);
    if (gates.length > 0) return decision(gates.length === 1 && gates[0] === 'NO_REPEAT_LIFECYCLE'
      ? 'NOOP_REPEAT' : 'BLOCKED', gates, null);
    current = finalizeProjection(projectionDraft(input, id, 'PROBE', null));
    return planIncreasingStage(input, current, 'ENTRY', 'PROBE');
  }
  const bindingReasons = currentBindingReasons(input, id);
  const boundPendingTwin = current.pendingAction !== null
    && input.twinEvidence !== null
    && input.twinEvidence.actionKey === current.pendingAction.actionKey
    && input.twinEvidence.fixtureId === deriveVolumeTwinFixtureId(current.pendingAction.actionKey);
  const retainedCanonicalNoEffectProof = input.twinEvidence === null ? null
    : retainedCanonicalNoEffect(current, input.twinEvidence.actionKey);
  const boundHistoricalTwin = retainedCanonicalNoEffectProof !== null
    && input.twinEvidence !== null
    && input.twinEvidence.fixtureId
      === deriveVolumeTwinFixtureId(retainedCanonicalNoEffectProof.action.actionKey);
  const boundSettledTwin = input.twinEvidence !== null
    && current.settledTwinHistory.some((record) => (
      record.actionKey === input.twinEvidence?.actionKey
      && record.fixtureId === input.twinEvidence.fixtureId
      && record.fixtureId === deriveVolumeTwinFixtureId(record.actionKey)
    ));
  const boundKnownTwin = boundPendingTwin || boundHistoricalTwin || boundSettledTwin;
  const canonicalProjectionMismatch = bindingReasons.includes('CANONICAL_PROJECTION_REVISION_MISMATCH');
  if (canonicalProjectionMismatch) {
    throw new TypeError('Volume current projection does not match canonical occupancy lineage');
  }
  if (current.unresolvedTwinConflict !== null) {
    let inspectedTwin: Readonly<VolumeTwinSettlement> | null = null;
    if (input.twinEvidence !== null) {
      const retainedAction = input.twinEvidence.actionKey === current.pendingAction?.actionKey
        ? current.pendingAction : retainedCanonicalNoEffectProof?.action ?? null;
      if (retainedAction !== null) inspectedTwin = twinSettlement(input, current, retainedAction);
    }
    return recovery(input, current, Object.freeze([...new Set([
      ...bindingReasons,
      ...current.lastTransition.reasonCodes,
      ...(input.twinEvidence !== null && inspectedTwin === null ? ['ORPHAN_TWIN_EVIDENCE'] : []),
      ...(inspectedTwin?.reasonCodes ?? []),
      'UNRESOLVED_TWIN_CONFLICT_REQUIRES_RECONSTRUCTION',
    ])]), 'POSITION_RECONSTRUCTION', inspectedTwin, retainedRecoveryCorrelation(current),
    current.unresolvedTwinConflict);
  }

  const simultaneousRecoveryAndTwinTruth = current.state === 'RECOVERY_REQUIRED'
    && current.pendingAction !== null
    && boundPendingTwin
    && input.signals.recoveryDisposition === 'RESOLVED'
    && input.signals.recoveryOutcome === 'NO_EFFECT'
    && input.signals.recoveryRevision !== null
    && input.signals.reconciliationState === 'EXACT';
  if (simultaneousRecoveryAndTwinTruth) {
    const concurrentTwin = twinSettlement(input, current);
    const positiveFillConflict = concurrentTwin !== null
      && compareVolumeDecimals(concurrentTwin.filledQuantity, '0') > 0;
    if (concurrentTwin !== null && concurrentTwin.state !== 'NO_FILL') {
      const conflictReason = positiveFillConflict
        ? 'CANONICAL_RECOVERY_TWIN_EVIDENCE_CONFLICT'
        : 'CANONICAL_RECOVERY_TWIN_EVIDENCE_UNRESOLVED';
      const conflict = twinConflict(current, current.pendingAction as Readonly<VolumeLifecycleActionRequest>,
        'SIMULTANEOUS_CANONICAL_NO_EFFECT', input.signals.recoveryRevision as string, concurrentTwin);
      return recovery(input, current, Object.freeze([...new Set([
        conflictReason,
        ...bindingReasons,
        ...current.lastTransition.reasonCodes,
      ])]), 'RECONCILIATION_REQUIRED', concurrentTwin, undefined, conflict);
    }
  }

  if (input.twinEvidence !== null
    && current.settledTwinHistory.some((record) => record.actionKey === input.twinEvidence?.actionKey)) {
    if (settledTwinReplayMatches(input, current)) {
      return evaluateInertTwinEvidence(input, current, 'TWIN_EVIDENCE_ALREADY_SETTLED', null);
    }
    const replayConflict = unboundTwinConflict(input, current, 'SETTLED_TWIN_REPLAY_MISMATCH');
    return recovery(input, current, Object.freeze([...new Set([
      'SETTLED_TWIN_REPLAY_MISMATCH',
      ...bindingReasons,
    ])]), 'RECONCILIATION_REQUIRED', null, replayConflict.correlation, replayConflict.conflict);
  }

  if (input.twinEvidence !== null && retainedCanonicalNoEffectProof !== null
    && input.twinEvidence.actionKey !== current.pendingAction?.actionKey) {
    const lateTwin = twinSettlement(input, current, retainedCanonicalNoEffectProof.action);
    const positiveFillConflict = lateTwin !== null
      && compareVolumeDecimals(lateTwin.filledQuantity, '0') > 0;
    if (lateTwin !== null && lateTwin.state !== 'NO_FILL') {
      const conflictReason = positiveFillConflict
        ? 'CANONICAL_NO_EFFECT_LATE_TWIN_CONFLICT'
        : 'LATE_TWIN_EVIDENCE_REQUIRES_RECONCILIATION';
      const conflict = twinConflict(current, retainedCanonicalNoEffectProof.action,
        'LATE_CANONICAL_NO_EFFECT', retainedCanonicalNoEffectProof.recoveryResolutionRevision as string,
        lateTwin);
      return recovery(input, current, Object.freeze([...new Set([
        conflictReason,
        ...bindingReasons,
      ])]), 'POSITION_RECONSTRUCTION', lateTwin, undefined, conflict);
    }
    if (lateTwin?.state === 'NO_FILL') {
      return evaluateInertTwinEvidence(input, current,
        'CANONICAL_NO_EFFECT_TWIN_NO_FILL_CONFIRMED', lateTwin);
    }
  }

  if (input.twinEvidence !== null && !boundKnownTwin) {
    const orphanConflict = unboundTwinConflict(input, current, 'ORPHAN_TWIN_EVIDENCE');
    return recovery(input, current, Object.freeze([...new Set([
      'ORPHAN_TWIN_EVIDENCE',
      ...bindingReasons,
    ])]), 'POSITION_RECONSTRUCTION', null, orphanConflict.correlation, orphanConflict.conflict);
  }

  if (bindingReasons.length > 0 && input.twinEvidence === null) {
    const concurrentTriggers = exitTriggers(input, current);
    return recovery(input, current, Object.freeze([...new Set([
      ...bindingReasons,
      ...(current.pendingAction?.triggerReasonCodes ?? []),
      ...concurrentTriggers.reasons,
    ])]), 'POSITION_RECONSTRUCTION', null);
  }

  if (current.pendingAction !== null && input.twinEvidence !== null) {
    const preSettlementTriggers = exitTriggers(input, current);
    const settledDecision = settleTwin(input, current);
    const settledProjection = settledDecision.projection;
    if (settledProjection === null) return settledDecision;
    const unrelatedRecovery = current.state === 'RECOVERY_REQUIRED'
      && current.recoveryEvidenceActionKey !== null
      && current.recoveryEvidenceFixtureId !== null
      && current.recoveryEvidenceTwinStateRevision !== null
      && current.recoveryEvidenceTwinOutcomeRevision !== null
      && current.recoveryEvidenceActionKey !== current.pendingAction.actionKey;
    if (unrelatedRecovery && settledDecision.disposition !== 'HOLD') {
      const correlation = Object.freeze({
        actionKey: current.recoveryEvidenceActionKey as string,
        fixtureId: current.recoveryEvidenceFixtureId as string,
        twinStateRevision: current.recoveryEvidenceTwinStateRevision as string,
        twinOutcomeRevision: current.recoveryEvidenceTwinOutcomeRevision as string,
      });
      const divergentProjection = withProjection(settledProjection, {
        positionQuantityTruth: 'UNKNOWN',
        capitalUsageTruth: 'UNKNOWN',
      });
      return recovery(input, divergentProjection, Object.freeze([...new Set([
        ...current.lastTransition.reasonCodes,
        ...settledDecision.reasonCodes,
      ])]), 'RECONCILIATION_REQUIRED', settledDecision.twinSettlement, correlation);
    }
    if (bindingReasons.length > 0) {
      const reasons = Object.freeze([...new Set([
        ...bindingReasons,
        ...settledDecision.reasonCodes,
        ...current.pendingAction.triggerReasonCodes,
        ...preSettlementTriggers.reasons,
      ])]);
      const deferred = settledProjection.state === 'EXIT' && settledProjection.feedbackOutcomeRevision !== null
        ? withProjection(settledProjection, { feedbackOutcomeRevision: null }) : settledProjection;
      return recovery(input, deferred, reasons, 'POSITION_RECONSTRUCTION', settledDecision.twinSettlement);
    }
    if (settledDecision.disposition === 'RECOVERY_REQUIRED') {
      if (preSettlementTriggers.reasons.length === 0) return settledDecision;
      const reasons = Object.freeze([...new Set([
        ...settledDecision.reasonCodes,
        ...preSettlementTriggers.reasons,
      ])]);
      return recovery(input, settledProjection, reasons,
        settledDecision.recoveryHandoff?.kind ?? 'RECONCILIATION_REQUIRED', settledDecision.twinSettlement);
    }
    if (settledDecision.disposition === 'HOLD') {
      const pendingFreshness = activeEvidenceReasons(input, settledProjection);
      if (pendingFreshness.length > 0) {
        return recovery(input, settledProjection, Object.freeze([...new Set([
          ...pendingFreshness,
          ...current.pendingAction.triggerReasonCodes,
          ...preSettlementTriggers.reasons,
        ])]), 'RECONCILIATION_REQUIRED', settledDecision.twinSettlement);
      }
      if (preSettlementTriggers.action === null) {
        const observed = updateMarketProjection(input, settledProjection);
        return decision(
          'HOLD',
          settledDecision.reasonCodes,
          observed,
          observed.pendingAction,
          settledDecision.twinSettlement,
        );
      }
      return recovery(input, settledProjection, Object.freeze([...new Set([
        'PENDING_ACTION_DURING_EXIT_TRIGGER',
        ...current.pendingAction.triggerReasonCodes,
        ...preSettlementTriggers.reasons,
      ])]), 'RECONCILIATION_REQUIRED', settledDecision.twinSettlement);
    }
    const freshness = activeEvidenceReasons(input, settledProjection);
    if (freshness.length > 0) {
      const staleReasons = Object.freeze([...new Set([...freshness, ...preSettlementTriggers.reasons])]);
      const deferred = settledProjection.state === 'EXIT' && settledProjection.feedbackOutcomeRevision !== null
        ? withProjection(settledProjection, { feedbackOutcomeRevision: null }) : settledProjection;
      return recovery(input, deferred, staleReasons, 'POSITION_RECONSTRUCTION', settledDecision.twinSettlement);
    }
    const postSettlementTriggers = exitTriggers(input, settledProjection);
    const settledReductionSatisfied = current.pendingAction.kind === 'REDUCE'
      && postSettlementTriggers.action === 'REDUCE'
      && settledProjection.reductionTargetQuantity !== null
      && current.pendingAction.triggerReasonCodes.length === postSettlementTriggers.reasons.length
      && current.pendingAction.triggerReasonCodes.every((reason, index) => reason === postSettlementTriggers.reasons[index])
      && compareVolumeDecimals(settledProjection.positionQuantity, settledProjection.reductionTargetQuantity) <= 0;
    if (postSettlementTriggers.action !== null && settledProjection.state !== 'EXIT' && !settledReductionSatisfied) {
      return recovery(
        input,
        settledProjection,
        ['POST_SETTLEMENT_RISK_RECHECK_REQUIRED', ...postSettlementTriggers.reasons],
        'CANCEL_OR_REDUCE',
        settledDecision.twinSettlement,
      );
    }
    if (settledProjection.state === 'EXIT'
      && (postSettlementTriggers.reasons.includes('RECONCILIATION_MISMATCH')
        || postSettlementTriggers.reasons.includes('RECONCILIATION_UNKNOWN'))) {
      const deferred = settledProjection.feedbackOutcomeRevision === null ? settledProjection : withProjection(settledProjection, {
        feedbackOutcomeRevision: null,
      });
      return recovery(input, deferred, postSettlementTriggers.reasons, 'POSITION_RECONSTRUCTION', settledDecision.twinSettlement);
    }
    return settledDecision;
  }

  const freshness = activeEvidenceReasons(input, current);
  if (freshness.length > 0) {
    const staleTriggers = exitTriggers(input, current);
    return recovery(input, current, Object.freeze([...new Set([...freshness, ...staleTriggers.reasons])]),
      'POSITION_RECONSTRUCTION', null);
  }
  if (current.state === 'RECOVERY_REQUIRED') {
    const recoveryReady = input.signals.recoveryDisposition === 'RESOLVED'
      && input.signals.recoveryOutcome === 'NO_EFFECT'
      && input.signals.recoveryRevision !== null
      && input.signals.observedAtMs >= current.lastTransition.occurredAtMs
      && !current.consumedRecoveryRevisions.includes(input.signals.recoveryRevision)
      && current.consumedRecoveryRevisions.length < 32
      && input.signals.reconciliationState === 'EXACT'
      && input.authority.riskState === 'ALLOWED'
      && input.authority.riskActionClass === 'RECOVERY'
      && input.authority.riskEvaluatedAtMs <= input.evaluatedAtMs
      && riskVerdictCoversEvidence(input, current.lastTransition.occurredAtMs, true)
      && input.evaluatedAtMs < input.authority.riskExpiresAtMs
      && input.authority.riskBoundLifecycleId === input.current?.lifecycleId
      && input.authority.riskBoundProjectionRevision === input.current?.projectionRevision
      && input.authority.riskBoundPositionQuantity === input.current?.positionQuantity
      && input.authority.riskContextRevision === deriveVolumeRiskContextRevision(input)
      && input.authority.accountTruth === 'COMPLETE'
      && input.authority.positionTruth === 'COMPLETE'
      && input.occupancy.truth === 'COMPLETE'
      && input.occupancy.observedAtMs >= current.lastTransition.occurredAtMs
      && current.unresolvedTwinConflict === null
      && !current.lastTransition.reasonCodes.some((reason) => UNRESOLVED_TWIN_REASON_CODES.has(reason))
      && !current.lastTransition.reasonCodes.includes('CANONICAL_RECOVERY_TWIN_EVIDENCE_CONFLICT')
      && !current.lastTransition.reasonCodes.includes('CANONICAL_NO_EFFECT_LATE_TWIN_CONFLICT')
      && (current.pendingAction !== null
        || (current.capitalUsageTruth === 'EXACT' && current.positionQuantityTruth === 'EXACT'));
    const recoveryScopedToPending = current.pendingAction === null
      || current.recoveryEvidenceActionKey === null
      || current.recoveryEvidenceActionKey === current.pendingAction.actionKey;
    if (recoveryReady && recoveryScopedToPending && current.recoveryResumeState !== null) {
      const pendingBeforeResolution = current.pendingAction;
      const correlatedUnresolvedTwinNoFill = pendingBeforeResolution === null
        && current.lastNoFill?.evidenceKind === 'TWIN_NO_FILL'
        && current.lastNoFill.recoveryResolutionRevision === null
        && current.recoveryEvidenceActionKey === current.lastNoFill.action.actionKey
        && current.recoveryEvidenceFixtureId === current.lastNoFill.fixtureId
        && current.recoveryEvidenceTwinStateRevision === current.lastNoFill.twinStateRevision
        && current.recoveryEvidenceTwinOutcomeRevision === current.lastNoFill.twinOutcomeRevision;
      const correlatedTwinNoFill = correlatedUnresolvedTwinNoFill ? current.lastNoFill : null;
      const newlyResolvedNoFill = pendingBeforeResolution !== null
        ? Object.freeze({
          action: pendingBeforeResolution,
          evidenceKind: 'CANONICAL_NO_EFFECT' as const,
          fixtureId: null,
          twinStateRevision: null,
          twinOutcomeRevision: null,
          recoveryResolutionRevision: input.signals.recoveryRevision,
        })
        : correlatedTwinNoFill !== null ? Object.freeze({
          ...correlatedTwinNoFill,
          recoveryResolutionRevision: input.signals.recoveryRevision,
        }) : null;
      const retainedLastNoFill = newlyResolvedNoFill ?? current.lastNoFill;
      const priorConsumptionRevision = current.recoveryConsumptionHistory.at(-1)?.consumptionRevision ?? null;
      const consumptionNoFill = newlyResolvedNoFill === null ? null : deepFreeze(snapshot(newlyResolvedNoFill));
      const recoveryConsumption = Object.freeze({
        recoveryResolutionRevision: input.signals.recoveryRevision,
        baseProjectionRevision: current.projectionRevision,
        noFill: consumptionNoFill,
        priorConsumptionRevision,
        outcomeSequence: current.revision + 1,
        consumptionRevision: deriveVolumeRecoveryConsumptionRevision({
          lifecycleId: current.lifecycleId,
          recoveryResolutionRevision: input.signals.recoveryRevision,
          baseProjectionRevision: current.projectionRevision,
          noFill: consumptionNoFill,
          priorConsumptionRevision,
          outcomeSequence: current.revision + 1,
        }),
      });
      const entryNoEffect = pendingBeforeResolution?.kind === 'ENTRY'
        && current.openedAtMs === null
        && current.positionQuantity === '0';
      const resolvedState = entryNoEffect ? 'EXIT' : current.recoveryResumeState;
      const resumeReasons = entryNoEffect
        ? Object.freeze(['ENTRY_CANONICAL_NO_EFFECT', 'CANONICAL_RECOVERY_RESOLVED'])
        : current.recoveryResumeState === 'EXIT'
        && current.terminalOutcomeReasonCodes !== null
        ? current.terminalOutcomeReasonCodes : Object.freeze(['CANONICAL_RECOVERY_RESOLVED']);
      const resumed = withProjection(current, {
        ...marketObservation(input, current),
        state: resolvedState,
        recoveryResumeState: null,
        pendingAction: null,
        pendingActionBaseProjectionRevision: null,
        pendingTwinStateRevision: null,
        pendingTwinOutcomeRevision: null,
        recoveryEvidenceActionKey: null,
        recoveryEvidenceFixtureId: null,
        recoveryEvidenceTwinStateRevision: null,
        recoveryEvidenceTwinOutcomeRevision: null,
        lastRecoveryResolutionRevision: input.signals.recoveryRevision,
        lastRecoveryResolvedAtMs: input.evaluatedAtMs,
        positionQuantityTruth: 'EXACT',
        capitalUsageTruth: 'EXACT',
        consumedRecoveryRevisions: Object.freeze([
          ...current.consumedRecoveryRevisions,
          input.signals.recoveryRevision,
        ]),
        recoveryConsumptionHistory: Object.freeze([
          ...current.recoveryConsumptionHistory,
          recoveryConsumption,
        ]),
        lastNoFill: retainedLastNoFill,
        terminalOutcomeReasonCodes: entryNoEffect ? resumeReasons : current.terminalOutcomeReasonCodes,
        feedbackOutcomeRevision: entryNoEffect ? null : current.feedbackOutcomeRevision,
        lastTransition: transition(current.state, resolvedState, resumeReasons, input),
      });
      if (resumed.state === 'EXIT' && resumed.terminalOutcomeReasonCodes !== null
        && resumed.feedbackOutcomeRevision === null) {
        return terminalDecision(resumed, resumed.terminalOutcomeReasonCodes, null);
      }
      const postRecoveryTriggers = exitTriggers(input, resumed);
      if (postRecoveryTriggers.action === 'RECOVERY') {
        return recovery(input, resumed, Object.freeze([
          'CANONICAL_RECOVERY_RESOLVED_NEW_RECOVERY_TRIGGER',
          ...postRecoveryTriggers.reasons,
        ]), 'POSITION_RECONSTRUCTION', null, null);
      }
      if (postRecoveryTriggers.action !== null) {
        const recheckReasons = Object.freeze([
          'CANONICAL_RECOVERY_RESOLVED_RISK_RECHECK_REQUIRED',
          ...postRecoveryTriggers.reasons,
        ]);
        const recheck = withProjection(resumed, {
          lastTransition: transition(resumed.state, resumed.state, recheckReasons, input),
        });
        return decision('BLOCKED', recheckReasons, recheck);
      }
      return decision('SETTLED', ['CANONICAL_RECOVERY_RESOLVED'], resumed);
    }
    const recoveryTriggers = exitTriggers(input, current);
    const recoveryProjection = updateMarketProjection(input, current);
    return recovery(input, recoveryProjection, Object.freeze([...new Set([current.pendingAction === null
      ? 'CANONICAL_RECOVERY_NOT_RESOLVED' : 'RECOVERY_AWAITS_TWIN_RECONCILIATION',
    ...(current.pendingAction?.triggerReasonCodes ?? []), ...recoveryTriggers.reasons])]),
    current.pendingAction === null ? 'POSITION_RECONSTRUCTION' : 'RECONCILIATION_REQUIRED', null);
  }

  const triggers = exitTriggers(input, current);
  if (current.state === 'EXIT') {
    if (triggers.action === 'RECOVERY') return recovery(input, current, triggers.reasons, 'POSITION_RECONSTRUCTION', null);
    if (current.feedbackOutcomeRevision === null && current.terminalOutcomeReasonCodes !== null) {
      return terminalDecision(current, current.terminalOutcomeReasonCodes, null);
    }
    return decision('TERMINAL', current.terminalOutcomeReasonCodes ?? current.lastTransition.reasonCodes, current);
  }
  if (current.pendingAction !== null) {
    if (triggers.action !== null) {
      return recovery(input, current, ['PENDING_ACTION_DURING_EXIT_TRIGGER', ...triggers.reasons], 'RECONCILIATION_REQUIRED', null);
    }
    const observed = updateMarketProjection(input, current);
    return decision('HOLD', ['PENDING_ACTION_AWAITS_TWIN_EVIDENCE'], observed, observed.pendingAction);
  }
  if (triggers.action === 'RECOVERY') return recovery(input, current, triggers.reasons, 'POSITION_RECONSTRUCTION', null);
  const passiveProjection = updateMarketProjection(input, current);
  if (triggers.action === 'EXIT') return planRiskReduction(input, current, 'EXIT', triggers.reasons);
  if (triggers.action === 'REDUCE') return planRiskReduction(input, current, 'REDUCE', triggers.reasons);

  if (current.state === 'PROBE') {
    if (input.signals.confirmation !== 'CONFIRMED') {
      return decision('HOLD', [input.signals.confirmation === 'PENDING'
        ? 'CONFIRMATION_PENDING' : 'CONFIRMATION_NOT_ACTIONABLE'], passiveProjection);
    }
    return planIncreasingStage(input, current, 'ADD', 'CONFIRM');
  }
  if (current.state === 'CONFIRM') {
    if (input.signals.confirmation === 'CONFIRMED' && input.signals.addPermission === 'ALLOWED') {
      const gates = entryGateReasons(input, id);
      if (gates.length > 0) return decision('BLOCKED', gates, passiveProjection);
      const reasons = Object.freeze(['ADD_ALLOWED_BY_OWNER_EVIDENCE']);
      const projection = withProjection(passiveProjection, {
        state: 'ADD_ALLOWED',
        stageEnteredAtMs: input.evaluatedAtMs,
        lastTransition: transition(passiveProjection.state, 'ADD_ALLOWED', reasons, input),
      });
      return decision('SETTLED', reasons, projection);
    }
    return decision('HOLD', ['ADD_NOT_ALLOWED_BY_OWNER_EVIDENCE'], passiveProjection);
  }
  if (current.state === 'ADD_ALLOWED') return planIncreasingStage(input, current, 'ADD', 'HOLD');
  return decision('HOLD', ['VOLUME_THESIS_WITHIN_POLICY'], passiveProjection);
}

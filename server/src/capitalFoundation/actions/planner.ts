import {
  ACTION_URGENCIES,
  FUTURE_GATES,
  actionRiskEffect,
  addExactDecimals,
  absoluteExactDecimal,
  compareExactDecimals,
  deriveActionIntentId,
  isExactDecimal,
  normalizeExactDecimal,
  postureAllowsRiskIncrease,
  subtractExactDecimals,
  validatePositionActionIntent,
  type DeltaExposureTarget,
  type ExposureTarget,
  type FutureGate,
  type PositionActionIntent,
  type PositionActionIntentKind,
  type TotalExposureTarget,
} from '../contracts/index.js';
import {
  createStructuredFailure,
  fail,
  isValidUtcMillis,
  ok,
  type ContractResult,
} from '../../foundation/contracts/index.js';
import type {
  EconomicActionDecision,
  EconomicActionDecisionBase,
  PlanEconomicActionInput,
} from './types.js';

const ZERO = normalizeExactDecimal('0');

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values.map((value) => value.trim()).filter(Boolean))].sort());
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function failure(input: PlanEconomicActionInput, code: string, message: string): ContractResult<PositionActionIntent> {
  return fail(createStructuredFailure({
    component: 'capitalFoundation.actions',
    stage: `plan:${input.decision.kind}`,
    code,
    message,
    occurredAt: input.nowMs,
    retryable: false,
    safeCurrentState: 'EXPOSURE_UNCHANGED',
    recommendedOperatorAction: 'Correct the supervision input or satisfy the named authority gate.',
    correlationId: input.correlationKey,
  }));
}

function validateCommon(input: PlanEconomicActionInput): string | null {
  if (!isValidUtcMillis(input.nowMs)) return 'NOW_INVALID';
  if (!Number.isSafeInteger(input.position.positionRevision) || input.position.positionRevision < 0) return 'POSITION_REVISION_INVALID';
  if (!Number.isSafeInteger(input.position.thesisRevision) || input.position.thesisRevision < 0) return 'THESIS_REVISION_INVALID';
  if (!nonEmpty(input.position.valuationAsset)) return 'VALUATION_ASSET_REQUIRED';
  if (!nonEmpty(input.idempotencyKey)) return 'IDEMPOTENCY_KEY_REQUIRED';
  if (!nonEmpty(input.correlationKey)) return 'CORRELATION_KEY_REQUIRED';
  if (!isExactDecimal(input.position.currentTotalExposure)
    || compareExactDecimals(input.position.currentTotalExposure, ZERO) < 0) return 'CURRENT_EXPOSURE_INVALID';
  if (!isExactDecimal(input.position.currentNetDirectionalExposure)) return 'CURRENT_NET_DIRECTIONAL_EXPOSURE_INVALID';
  if (input.position.currentBaseQuantity !== null && !isExactDecimal(input.position.currentBaseQuantity)) return 'CURRENT_BASE_QUANTITY_INVALID';
  if (input.position.currentHedgeRatio !== null && !isExactDecimal(input.position.currentHedgeRatio)) return 'CURRENT_HEDGE_RATIO_INVALID';
  if (!(ACTION_URGENCIES as readonly string[]).includes(input.decision.urgency)) return 'URGENCY_INVALID';
  if (input.decision.why.length === 0) return 'WHY_REQUIRED';
  if (input.decision.triggerCodes.length === 0) return 'TRIGGER_REQUIRED';
  if (input.decision.invalidationConditions.length === 0) return 'INVALIDATION_REQUIRED';
  if (input.decision.hardDeadlineMs !== null
    && (!isValidUtcMillis(input.decision.hardDeadlineMs) || input.decision.hardDeadlineMs < input.nowMs)) return 'DEADLINE_INVALID';
  for (const value of [input.decision.economicCostOfWaiting, input.decision.expectedCostOfActing]) {
    if (value !== null && (!isExactDecimal(value) || compareExactDecimals(value, ZERO) < 0)) return 'ACTION_COST_INVALID';
  }
  if (input.decision.requiredFutureGates.some((gate) => !(FUTURE_GATES as readonly string[]).includes(gate))) return 'FUTURE_GATE_INVALID';
  return null;
}

function totalTarget(input: PlanEconomicActionInput, quoteNotional: string, baseQuantity: string | null, hedgeRatio: string | null): Readonly<TotalExposureTarget> {
  return Object.freeze({
    kind: 'TOTAL',
    valuationAsset: input.position.valuationAsset,
    quoteNotional: normalizeExactDecimal(quoteNotional) as TotalExposureTarget['quoteNotional'],
    baseQuantity: baseQuantity === null ? null : normalizeExactDecimal(baseQuantity),
    targetHedgeRatio: hedgeRatio === null ? null : normalizeExactDecimal(hedgeRatio),
  });
}

function deltaTarget(input: PlanEconomicActionInput, quoteNotional: string, baseQuantity: string | null, hedgeRatio: string | null): Readonly<DeltaExposureTarget> {
  return Object.freeze({
    kind: 'DELTA',
    valuationAsset: input.position.valuationAsset,
    quoteNotional: normalizeExactDecimal(quoteNotional),
    baseQuantity: baseQuantity === null ? null : normalizeExactDecimal(baseQuantity),
    targetHedgeRatio: hedgeRatio === null ? null : normalizeExactDecimal(hedgeRatio),
  });
}

function automaticGates(kind: PositionActionIntentKind): readonly FutureGate[] {
  if (kind === 'ADD_STAGE') {
    return Object.freeze(['OPERATOR_APPROVAL', 'MULTI_LEG_RISK', 'EXECUTION_COORDINATOR', 'RECONCILIATION', 'FRESH_ACCOUNT_TRUTH', 'FRESH_MARKET_EVIDENCE']);
  }
  if (kind === 'REDUCE' || kind === 'REQUEST_HEDGE' || kind === 'REQUEST_EXIT' || kind === 'REQUEST_EMERGENCY_UNWIND') {
    return Object.freeze(['MULTI_LEG_RISK', 'EXECUTION_COORDINATOR', 'RECONCILIATION']);
  }
  if (kind === 'FREEZE_NEW_ACTIONS') return Object.freeze(['RECONCILIATION']);
  return Object.freeze([]);
}

function buildIntent(
  input: PlanEconomicActionInput,
  decision: EconomicActionDecisionBase,
  kind: PositionActionIntentKind,
  target: Readonly<ExposureTarget>,
  addedWhy: readonly string[] = [],
  addedBlockingFacts: readonly string[] = [],
): ContractResult<PositionActionIntent> {
  const why = sortedUnique([...decision.why, ...decision.triggerCodes.map((code) => `TRIGGER:${code}`), ...addedWhy]);
  const blockingFacts = sortedUnique([...decision.blockingFacts, ...addedBlockingFacts]);
  const semantic = {
    positionId: input.position.positionId,
    positionRevision: input.position.positionRevision,
    thesisId: input.position.thesisId,
    thesisRevision: input.position.thesisRevision,
    kind,
    target,
    idempotencyKey: input.idempotencyKey,
    correlationKey: input.correlationKey,
  };
  const common = {
    id: deriveActionIntentId(semantic),
    positionId: input.position.positionId,
    sourcePositionRevision: input.position.positionRevision,
    sourceThesisId: input.position.thesisId,
    sourceThesisRevision: input.position.thesisRevision,
    target,
    urgency: decision.urgency,
    hardDeadlineMs: decision.hardDeadlineMs,
    why,
    supportingEvidenceIds: sortedUnique(decision.supportingEvidenceIds),
    conflictingEvidenceIds: sortedUnique(decision.conflictingEvidenceIds),
    requiredFutureGates: sortedUnique([...decision.requiredFutureGates, ...automaticGates(kind)]) as readonly FutureGate[],
    completeness: input.position.completeness,
    blockingFacts: sortedUnique([...blockingFacts, ...input.position.truthReasonCodes]),
    idempotencyKey: input.idempotencyKey,
    correlationKey: input.correlationKey,
    economicCostOfWaiting: decision.economicCostOfWaiting,
    expectedCostOfActing: decision.expectedCostOfActing,
    invalidationConditions: sortedUnique(decision.invalidationConditions),
    createdAtMs: input.nowMs,
  };
  const riskEffect = actionRiskEffect(kind);
  const intent = Object.freeze({ ...common, kind, riskEffect }) as PositionActionIntent;
  const issues = validatePositionActionIntent(intent);
  return issues.length === 0
    ? ok(intent)
    : failure(input, 'ACTION_INVARIANT_VIOLATION', issues.join(','));
}

function planAdd(input: PlanEconomicActionInput, decision: Extract<EconomicActionDecision, { kind: 'ADD_STAGE' }>): ContractResult<PositionActionIntent> {
  if (!postureAllowsRiskIncrease(input.controlPosture)) {
    return buildIntent(
      input,
      decision,
      'FREEZE_NEW_ACTIONS',
      totalTarget(input, input.position.currentTotalExposure, input.position.currentBaseQuantity, input.position.currentHedgeRatio),
      [`CONTROL_POSTURE:${input.controlPosture.posture}`],
      ['RISK_INCREASE_BLOCKED_BY_CONTROL', ...input.controlPosture.reasonCodes],
    );
  }
  if (input.position.completeness !== 'COMPLETE') {
    return failure(input, 'COMPLETE_POSITION_TRUTH_REQUIRED', 'ADD_STAGE requires complete current position truth');
  }
  const authority = decision.authority;
  if (!Number.isSafeInteger(authority.currentStageSequence)
    || !Number.isSafeInteger(authority.authorizedStageSequence)
    || authority.authorizedStageSequence !== authority.currentStageSequence + 1) {
    return failure(input, 'NEXT_AUTHORIZED_STAGE_REQUIRED', 'ADD_STAGE may target only the immediately authorized next stage');
  }
  if (!authority.freshEvidence) return failure(input, 'FRESH_EVIDENCE_REQUIRED', 'ADD_STAGE requires fresh evidence');
  if (!authority.reservationAvailable) return failure(input, 'RESERVATION_REQUIRED', 'ADD_STAGE requires available reservation');
  if (!authority.approvalValidated) return failure(input, 'APPROVAL_REQUIRED', 'ADD_STAGE requires current scoped approval');
  if (!authority.futureRiskRecheckRequired) return failure(input, 'FUTURE_RISK_RECHECK_REQUIRED', 'ADD_STAGE must remain gated by Foundation risk');
  if (authority.adversePriceMoveIsSoleReason) return failure(input, 'AVERAGING_DOWN_FORBIDDEN', 'adverse price movement alone cannot authorize ADD_STAGE');
  if (!isExactDecimal(decision.targetTotalExposure)
    || !isExactDecimal(authority.maximumAdditionalExposure)
    || !isExactDecimal(authority.maximumTotalExposure)) return failure(input, 'ADD_TARGET_INVALID', 'ADD_STAGE exact exposure values are invalid');
  const change = subtractExactDecimals(decision.targetTotalExposure, input.position.currentTotalExposure);
  if (compareExactDecimals(change, ZERO) <= 0) return failure(input, 'ADD_MUST_INCREASE_EXPOSURE', 'ADD_STAGE target must exceed current exposure');
  if (compareExactDecimals(change, authority.maximumAdditionalExposure) > 0
    || compareExactDecimals(decision.targetTotalExposure, authority.maximumTotalExposure) > 0) {
    return failure(input, 'ADD_STAGE_LIMIT_EXCEEDED', 'ADD_STAGE target exceeds the authorized next-stage bounds');
  }
  return buildIntent(
    input,
    decision,
    'ADD_STAGE',
    totalTarget(input, decision.targetTotalExposure, decision.targetBaseQuantity, decision.targetHedgeRatio),
    [`AUTHORIZED_STAGE:${authority.authorizedStage}`],
  );
}

/** Pure economic planner. It emits no order sequence and calls no authority owner. */
export function planEconomicAction(input: PlanEconomicActionInput): ContractResult<PositionActionIntent> {
  const commonIssue = validateCommon(input);
  if (commonIssue !== null) return failure(input, commonIssue, `invalid action planning input: ${commonIssue}`);
  const decision = input.decision;
  switch (decision.kind) {
    case 'HOLD':
      return buildIntent(input, decision, 'HOLD', totalTarget(input, input.position.currentTotalExposure, input.position.currentBaseQuantity, input.position.currentHedgeRatio));
    case 'ADD_STAGE':
      return planAdd(input, decision);
    case 'REDUCE':
      if (!isExactDecimal(decision.targetTotalExposure)
        || !isExactDecimal(decision.targetNetDirectionalExposure)
        || (decision.targetBaseQuantity !== null && !isExactDecimal(decision.targetBaseQuantity))
        || (decision.targetHedgeRatio !== null && !isExactDecimal(decision.targetHedgeRatio))
        || compareExactDecimals(decision.targetTotalExposure, ZERO) < 0
        || compareExactDecimals(decision.targetTotalExposure, input.position.currentTotalExposure) >= 0) {
        return failure(input, 'REDUCTION_TARGET_INVALID', 'REDUCE requires an exact non-negative target below current exposure');
      }
      if (compareExactDecimals(
        absoluteExactDecimal(decision.targetNetDirectionalExposure),
        absoluteExactDecimal(input.position.currentNetDirectionalExposure),
      ) > 0) {
        return failure(input, 'REDUCTION_INCREASES_DIRECTIONAL_RISK', 'REDUCE cannot increase absolute net directional exposure');
      }
      return buildIntent(input, decision, 'REDUCE', totalTarget(input, decision.targetTotalExposure, decision.targetBaseQuantity, decision.targetHedgeRatio));
    case 'REQUEST_HEDGE':
      if (!isExactDecimal(decision.targetQuoteDelta)
        || (decision.targetBaseQuantity !== null && !isExactDecimal(decision.targetBaseQuantity))
        || !isExactDecimal(decision.targetHedgeRatio)
        || compareExactDecimals(decision.targetQuoteDelta, ZERO) === 0) {
        return failure(input, 'RISK_REDUCING_HEDGE_REQUIRED', 'REQUEST_HEDGE requires a non-zero exact delta proven to reduce risk');
      }
      if (compareExactDecimals(
        absoluteExactDecimal(addExactDecimals(input.position.currentNetDirectionalExposure, decision.targetQuoteDelta)),
        absoluteExactDecimal(input.position.currentNetDirectionalExposure),
      ) >= 0) {
        return failure(input, 'RISK_REDUCING_HEDGE_REQUIRED', 'REQUEST_HEDGE delta must strictly reduce absolute net directional exposure');
      }
      return buildIntent(input, decision, 'REQUEST_HEDGE', deltaTarget(input, decision.targetQuoteDelta, decision.targetBaseQuantity, decision.targetHedgeRatio));
    case 'REQUEST_EXIT':
      return buildIntent(input, decision, 'REQUEST_EXIT', totalTarget(input, ZERO, ZERO, null));
    case 'REQUEST_EMERGENCY_UNWIND':
      return buildIntent(input, decision, 'REQUEST_EMERGENCY_UNWIND', totalTarget(input, ZERO, ZERO, null));
    case 'FREEZE_NEW_ACTIONS':
      return buildIntent(input, decision, 'FREEZE_NEW_ACTIONS', totalTarget(input, input.position.currentTotalExposure, input.position.currentBaseQuantity, input.position.currentHedgeRatio));
    case 'NO_ACTION_UNKNOWN':
      if (decision.unknownReasonCodes.length === 0) return failure(input, 'UNKNOWN_REASON_REQUIRED', 'NO_ACTION_UNKNOWN requires at least one reason');
      return buildIntent(input, decision, 'NO_ACTION_UNKNOWN', Object.freeze({
        kind: 'UNKNOWN',
        valuationAsset: input.position.valuationAsset,
        reasonCodes: sortedUnique(decision.unknownReasonCodes),
      }));
  }
}

export function targetExposureChange(intent: PositionActionIntent, currentExposure: string): string | null {
  if (intent.target.kind === 'UNKNOWN' || !isExactDecimal(currentExposure)) return null;
  if (intent.target.kind === 'DELTA') return normalizeExactDecimal(intent.target.quoteNotional);
  return subtractExactDecimals(intent.target.quoteNotional, normalizeExactDecimal(currentExposure));
}

export function resultingExposure(intent: PositionActionIntent, currentExposure: string): string | null {
  if (intent.target.kind === 'UNKNOWN' || !isExactDecimal(currentExposure)) return null;
  return intent.target.kind === 'TOTAL'
    ? normalizeExactDecimal(intent.target.quoteNotional)
    : addExactDecimals(normalizeExactDecimal(currentExposure), intent.target.quoteNotional);
}

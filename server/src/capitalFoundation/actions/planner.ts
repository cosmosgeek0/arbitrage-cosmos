import {
  ACTION_URGENCIES,
  CAPITAL_STAGES,
  FUTURE_GATES,
  actionRiskEffect,
  addExactDecimals,
  assessCapitalTruth,
  absoluteExactDecimal,
  compareExactDecimals,
  deriveActionIntentId,
  isExactDecimal,
  normalizeExactDecimal,
  postureAllowsRiskIncrease,
  subtractExactDecimals,
  validatePositionActionIntent,
  weakestCapitalTruth,
  type DeltaExposureTarget,
  type ExposureTarget,
  type FutureGate,
  type PositionActionIntent,
  type PositionActionIntentKind,
  type TotalExposureTarget,
  type TruthMetadata,
} from '../contracts/index.js';
import {
  createStructuredFailure,
  fail,
  isValidUtcMillis,
  ok,
  type ContractResult,
} from '../../foundation/contracts/index.js';
import type {
  ActionIntentAuthorityProjection,
  DirectionalReductionGeometry,
  EconomicActionDecision,
  EconomicActionDecisionBase,
  NextStageIncreaseAuthority,
  PlanEconomicActionInput,
  PlannedEconomicActionIntent,
} from './types.js';

const ZERO = normalizeExactDecimal('0');
const MAX_ID_LENGTH = 256;
const MAX_CORRELATION_ID_LENGTH = 128;
const REQUIRED_STAGE_AUTHORITY_GATES = Object.freeze([
  'OPERATOR_APPROVAL',
  'MULTI_LEG_RISK',
  'FRESH_ACCOUNT_TRUTH',
  'FRESH_MARKET_EVIDENCE',
] as const satisfies readonly FutureGate[]);
const EMPTY_AUTHORITY_PROJECTION: Readonly<ActionIntentAuthorityProjection> = Object.freeze({
  stageTransitionAuthorization: null,
  directionalReductionGeometry: null,
});

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function boundedNonEmpty(value: unknown, maximumLength = MAX_ID_LENGTH): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumLength
    && value.trim() === value;
}

function canonicalStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => boundedNonEmpty(entry));
}

function failure(input: PlanEconomicActionInput, code: string, message: string): ContractResult<PlannedEconomicActionIntent> {
  const safeCorrelationId = boundedNonEmpty(input.correlationKey, MAX_CORRELATION_ID_LENGTH)
    ? input.correlationKey
    : 'capital-actions-invalid-correlation';
  const safeOccurredAt = isValidUtcMillis(input.nowMs) ? input.nowMs : 0;
  return fail(createStructuredFailure({
    component: 'capitalFoundation.actions',
    stage: `plan:${input.decision.kind}`,
    code,
    message,
    occurredAt: safeOccurredAt,
    retryable: false,
    safeCurrentState: 'EXPOSURE_UNCHANGED',
    recommendedOperatorAction: 'Correct the supervision input or satisfy the named authority gate.',
    correlationId: safeCorrelationId,
  }));
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function refreshTruth(truth: Readonly<TruthMetadata>, nowMs: number): Readonly<TruthMetadata> {
  const assessed = assessCapitalTruth({
    source: truth.source,
    evaluatedAtMs: nowMs,
    requiredValuePresent: truth.completeness !== 'UNKNOWN',
    divergent: truth.completeness === 'DIVERGENT',
    reasons: truth.reasons,
    evidenceReferences: truth.evidenceReferences,
    revision: truth.revision,
  });
  return Object.freeze({ ...assessed, completeness: weakestCapitalTruth([truth.completeness, assessed.completeness]) });
}

function stageAuthorityIssue(input: PlanEconomicActionInput, authority: Readonly<NextStageIncreaseAuthority>): string | null {
  const binding = input.position.activeStageAuthority;
  if (binding === null || typeof binding !== 'object') return 'ACTIVE_STAGE_BINDING_REQUIRED';
  if (!boundedNonEmpty(binding.planId) || !positiveSafeInteger(binding.planRevision) || !boundedNonEmpty(binding.planDigest)
    || !boundedNonEmpty(binding.reservationId) || !positiveSafeInteger(binding.reservationRevision)
    || !boundedNonEmpty(binding.approvalId) || !positiveSafeInteger(binding.approvalRevision)
    || !(CAPITAL_STAGES as readonly string[]).includes(binding.activeStage)) return 'ACTIVE_STAGE_BINDING_INVALID';
  if (authority === null || typeof authority !== 'object') return 'STAGE_TRANSITION_AUTHORIZATION_REQUIRED';
  if (authority.to !== 'ADD' || authority.from !== binding.activeStage
    || authority.authorizedForExternalRiskEvaluation !== true || authority.executionReady !== false) {
    return 'STAGE_TRANSITION_NOT_AUTHORIZED';
  }
  if (authority.evaluatedAtMs !== input.nowMs || !isValidUtcMillis(authority.evaluatedAtMs)) return 'STAGE_TRANSITION_AUTHORIZATION_STALE';
  if (!boundedNonEmpty(authority.planId) || !boundedNonEmpty(authority.planDigest)
    || !boundedNonEmpty(authority.reservationId) || !boundedNonEmpty(authority.approvalId)) {
    return 'STAGE_AUTHORITY_IDENTITY_INVALID';
  }
  if (!positiveSafeInteger(authority.planRevision)
    || !positiveSafeInteger(authority.reservationRevision)
    || !positiveSafeInteger(authority.approvalRevision)) return 'STAGE_AUTHORITY_REVISION_INVALID';
  if (authority.planId !== binding.planId || authority.planRevision !== binding.planRevision
    || authority.planDigest !== binding.planDigest) return 'STAGE_PLAN_BINDING_MISMATCH';
  if (authority.reservationId !== binding.reservationId || authority.reservationRevision !== binding.reservationRevision
    || authority.approvalId !== binding.approvalId || authority.approvalRevision !== binding.approvalRevision) {
    return 'STAGE_AUTHORITY_REFERENCE_MISMATCH';
  }
  if (!Array.isArray(authority.requiredFutureGates)
    || new Set(authority.requiredFutureGates).size !== authority.requiredFutureGates.length
    || authority.requiredFutureGates.some((gate) => !(FUTURE_GATES as readonly string[]).includes(gate))
    || REQUIRED_STAGE_AUTHORITY_GATES.some((gate) => !authority.requiredFutureGates.includes(gate))) {
    return 'STAGE_AUTHORITY_FUTURE_GATES_INVALID';
  }
  if (!isExactDecimal(authority.reservationConsumption)
    || !isExactDecimal(authority.reservationAvailable)
    || compareExactDecimals(authority.reservationConsumption, ZERO) <= 0
    || compareExactDecimals(authority.reservationAvailable, authority.reservationConsumption) < 0) {
    return 'STAGE_RESERVATION_AUTHORITY_INVALID';
  }
  return null;
}

function freezeStageAuthority(authority: Readonly<NextStageIncreaseAuthority>): Readonly<NextStageIncreaseAuthority> {
  return Object.freeze({
    ...authority,
    requiredFutureGates: sortedUnique(authority.requiredFutureGates) as readonly FutureGate[],
  });
}

function validateCommon(input: PlanEconomicActionInput): string | null {
  if (!isValidUtcMillis(input.nowMs)) return 'NOW_INVALID';
  if (!boundedNonEmpty(input.position.positionId)) return 'POSITION_ID_INVALID';
  if (!positiveSafeInteger(input.position.positionRevision)) return 'POSITION_REVISION_INVALID';
  if (!boundedNonEmpty(input.position.thesisId)) return 'THESIS_ID_INVALID';
  if (!positiveSafeInteger(input.position.thesisRevision)) return 'THESIS_REVISION_INVALID';
  if (!boundedNonEmpty(input.position.valuationAsset)) return 'VALUATION_ASSET_REQUIRED';
  if (!boundedNonEmpty(input.idempotencyKey)) return 'IDEMPOTENCY_KEY_REQUIRED';
  if (!boundedNonEmpty(input.correlationKey, MAX_CORRELATION_ID_LENGTH)) return 'CORRELATION_KEY_REQUIRED';
  if (input.controlPosture.revision !== null && !boundedNonEmpty(input.controlPosture.revision)) return 'CONTROL_POSTURE_REVISION_INVALID';
  if (!canonicalStringArray(input.position.truthReasonCodes)) return 'POSITION_TRUTH_REASON_INVALID';
  if (!canonicalStringArray(input.controlPosture.reasonCodes)) return 'CONTROL_POSTURE_REASON_INVALID';
  if (!canonicalStringArray(input.controlPosture.truth.reasons)) return 'CONTROL_TRUTH_REASON_INVALID';
  if (!canonicalStringArray(input.controlPosture.truth.evidenceReferences)) return 'CONTROL_TRUTH_EVIDENCE_INVALID';
  if (!isExactDecimal(input.position.currentTotalExposure)
    || compareExactDecimals(input.position.currentTotalExposure, ZERO) < 0) return 'CURRENT_EXPOSURE_INVALID';
  if (!isExactDecimal(input.position.currentNetDirectionalExposure)) return 'CURRENT_NET_DIRECTIONAL_EXPOSURE_INVALID';
  if (input.position.currentBaseQuantity !== null && !isExactDecimal(input.position.currentBaseQuantity)) return 'CURRENT_BASE_QUANTITY_INVALID';
  if (input.position.currentHedgeRatio !== null && !isExactDecimal(input.position.currentHedgeRatio)) return 'CURRENT_HEDGE_RATIO_INVALID';
  if (!(ACTION_URGENCIES as readonly string[]).includes(input.decision.urgency)) return 'URGENCY_INVALID';
  if (!canonicalStringArray(input.decision.why)) return 'WHY_INVALID';
  if (input.decision.why.length === 0) return 'WHY_REQUIRED';
  if (!canonicalStringArray(input.decision.triggerCodes)) return 'TRIGGER_INVALID';
  if (input.decision.triggerCodes.length === 0) return 'TRIGGER_REQUIRED';
  if (!canonicalStringArray(input.decision.supportingEvidenceIds)) return 'SUPPORTING_EVIDENCE_ID_INVALID';
  if (!canonicalStringArray(input.decision.conflictingEvidenceIds)) return 'CONFLICTING_EVIDENCE_ID_INVALID';
  if (!canonicalStringArray(input.decision.blockingFacts)) return 'BLOCKING_FACT_INVALID';
  if (!canonicalStringArray(input.decision.invalidationConditions)) return 'INVALIDATION_CONDITION_INVALID';
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
  authorityProjection: Readonly<ActionIntentAuthorityProjection> = EMPTY_AUTHORITY_PROJECTION,
): ContractResult<PlannedEconomicActionIntent> {
  const why = sortedUnique([...decision.why, ...decision.triggerCodes.map((code) => `TRIGGER:${code}`), ...addedWhy]);
  const blockingFacts = sortedUnique([...decision.blockingFacts, ...addedBlockingFacts]);
  const semantic = {
    positionId: input.position.positionId,
    positionRevision: input.position.positionRevision,
    thesisId: input.position.thesisId,
    thesisRevision: input.position.thesisRevision,
    kind,
    target,
    stageTransitionAuthorization: authorityProjection.stageTransitionAuthorization,
    directionalReductionGeometry: authorityProjection.directionalReductionGeometry,
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
    stageTransitionAuthorization: authorityProjection.stageTransitionAuthorization,
    directionalReductionGeometry: authorityProjection.directionalReductionGeometry,
  };
  const riskEffect = actionRiskEffect(kind);
  const intent = Object.freeze({ ...common, kind, riskEffect }) as PlannedEconomicActionIntent;
  const issues = validatePositionActionIntent(intent);
  return issues.length === 0
    ? ok(intent)
    : failure(input, 'ACTION_INVARIANT_VIOLATION', issues.join(','));
}

function planAdd(input: PlanEconomicActionInput, decision: Extract<EconomicActionDecision, { kind: 'ADD_STAGE' }>): ContractResult<PlannedEconomicActionIntent> {
  const currentControlTruth = refreshTruth(input.controlPosture.truth, input.nowMs);
  if (!postureAllowsRiskIncrease(Object.freeze({ ...input.controlPosture, truth: currentControlTruth }))) {
    return buildIntent(
      input,
      decision,
      'FREEZE_NEW_ACTIONS',
      totalTarget(input, input.position.currentTotalExposure, input.position.currentBaseQuantity, input.position.currentHedgeRatio),
      [`CONTROL_POSTURE:${input.controlPosture.posture}`],
      ['RISK_INCREASE_BLOCKED_BY_CONTROL', `CONTROL_TRUTH:${currentControlTruth.completeness}`, ...input.controlPosture.reasonCodes],
    );
  }
  if (input.position.completeness !== 'COMPLETE') {
    return failure(input, 'COMPLETE_POSITION_TRUTH_REQUIRED', 'ADD_STAGE requires complete current position truth');
  }
  const authority = decision.authority;
  const authorityIssue = stageAuthorityIssue(input, authority);
  if (authorityIssue !== null) return failure(input, authorityIssue, `ADD_STAGE requires a current bound stages-lane authorization: ${authorityIssue}`);
  if (!isExactDecimal(decision.targetTotalExposure)
    || (decision.targetBaseQuantity !== null && !isExactDecimal(decision.targetBaseQuantity))
    || (decision.targetHedgeRatio !== null && !isExactDecimal(decision.targetHedgeRatio))) {
    return failure(input, 'ADD_TARGET_INVALID', 'ADD_STAGE exact exposure values are invalid');
  }
  const change = subtractExactDecimals(decision.targetTotalExposure, input.position.currentTotalExposure);
  if (compareExactDecimals(change, ZERO) <= 0) return failure(input, 'ADD_MUST_INCREASE_EXPOSURE', 'ADD_STAGE target must exceed current exposure');
  if (compareExactDecimals(change, authority.reservationConsumption) !== 0) {
    return failure(input, 'ADD_STAGE_TARGET_NOT_AUTHORIZED', 'ADD_STAGE target change must exactly equal the bound transition authorization');
  }
  const frozenAuthority = freezeStageAuthority(authority);
  return buildIntent(
    input,
    decision,
    'ADD_STAGE',
    totalTarget(input, decision.targetTotalExposure, decision.targetBaseQuantity, decision.targetHedgeRatio),
    [`AUTHORIZED_STAGE:${authority.to}`, `STAGED_PLAN:${authority.planId}:r${authority.planRevision}`],
    [],
    Object.freeze({ stageTransitionAuthorization: frozenAuthority, directionalReductionGeometry: null }),
  );
}

/** Pure economic planner. It emits no order sequence and calls no authority owner. */
export function planEconomicAction(input: PlanEconomicActionInput): ContractResult<PlannedEconomicActionIntent> {
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
      {
        const directionalReductionGeometry: Readonly<DirectionalReductionGeometry> = Object.freeze({
          currentTotalExposure: normalizeExactDecimal(input.position.currentTotalExposure) as DirectionalReductionGeometry['currentTotalExposure'],
          targetTotalExposure: normalizeExactDecimal(decision.targetTotalExposure) as DirectionalReductionGeometry['targetTotalExposure'],
          currentNetDirectionalExposure: normalizeExactDecimal(input.position.currentNetDirectionalExposure),
          targetNetDirectionalExposure: normalizeExactDecimal(decision.targetNetDirectionalExposure),
          absoluteDirectionalExposureReduction: subtractExactDecimals(
            absoluteExactDecimal(input.position.currentNetDirectionalExposure),
            absoluteExactDecimal(decision.targetNetDirectionalExposure),
          ) as DirectionalReductionGeometry['absoluteDirectionalExposureReduction'],
        });
        return buildIntent(
          input,
          decision,
          'REDUCE',
          totalTarget(input, decision.targetTotalExposure, decision.targetBaseQuantity, decision.targetHedgeRatio),
          [],
          [],
          Object.freeze({ stageTransitionAuthorization: null, directionalReductionGeometry }),
        );
      }
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
      if (!canonicalStringArray(decision.unknownReasonCodes)) {
        return failure(input, 'UNKNOWN_REASON_INVALID', 'NO_ACTION_UNKNOWN reasons must be canonical non-empty strings');
      }
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

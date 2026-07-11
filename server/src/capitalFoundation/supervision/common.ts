import {
  absoluteExactDecimal,
  actionRiskEffect,
  capitalDigest,
  compareExactDecimals,
  deriveActionIntentId,
  negateExactDecimal,
  normalizeNonNegativeExactDecimal,
  policyBoundIsValid,
  subtractExactDecimals,
  truthAllowsNewExposure,
  weakestCapitalTruth,
  type CapitalTruthState,
  type ExactDecimal,
  type FutureGate,
  type NonNegativeDecimal,
  type PositionActionIntent,
  type PositionActionIntentKind,
  type TotalExposureTarget,
  type TruthMetadata,
} from '../contracts/index.js';
import type {
  CommonSupervisionInput,
  SupervisionCheck,
  SupervisionDecision,
  SupervisionCheckStatus,
} from './types.js';

const ZERO = '0' as NonNegativeDecimal;

export interface IntentDirective {
  readonly kind: PositionActionIntentKind;
  readonly urgency: PositionActionIntent['urgency'];
  readonly reasons: readonly string[];
  readonly hardDeadlineMs: number | null;
  readonly evidenceIds?: readonly string[];
  readonly invalidationConditions?: readonly string[];
}

export interface UniversalAssessment {
  readonly checks: readonly Readonly<SupervisionCheck>[];
  readonly allTruthAllowsIncrease: boolean;
  readonly universalDirective: Readonly<IntentDirective> | null;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0));
}

function check(code: string, status: SupervisionCheckStatus, detail: string, evidenceIds: readonly string[] = [], blockingForIncrease = status !== 'PASS'): Readonly<SupervisionCheck> {
  return Object.freeze({ code, status, detail, evidenceIds: sortedUnique(evidenceIds), blockingForIncrease });
}

function exactBoundValid(bound: CommonSupervisionInput['policy']['maximumOneLegExposure']): boolean {
  return policyBoundIsValid(bound);
}

function integerBoundValid(bound: CommonSupervisionInput['policy']['maximumOneLegDurationMs']): boolean {
  return Number.isSafeInteger(bound.value) && Number.isSafeInteger(bound.minimum) && Number.isSafeInteger(bound.maximum)
    && bound.minimum >= 0 && bound.maximum >= bound.minimum && bound.value >= bound.minimum && bound.value <= bound.maximum;
}

export function policyAuthorityCurrent(input: CommonSupervisionInput, extraAuthority?: CommonSupervisionInput['policy']['authority']): boolean {
  const authorities = [input.policy.authority, ...(extraAuthority === undefined ? [] : [extraAuthority])];
  return authorities.every((authority) => Number.isSafeInteger(authority.issuedAtMs)
    && Number.isSafeInteger(authority.effectiveFromMs)
    && String(authority.revision).trim().length > 0
    && authority.sourceId.trim().length > 0
    && authority.issuedAtMs <= input.nowMs
    && authority.effectiveFromMs <= input.nowMs
    && (authority.effectiveUntilMs === null || input.nowMs < authority.effectiveUntilMs));
}

function truthStatus(truth: Readonly<TruthMetadata>): SupervisionCheckStatus {
  if (truth.completeness === 'DIVERGENT') return 'BREACH';
  return truthAllowsNewExposure(truth) ? 'PASS' : 'UNKNOWN';
}

function hasBothSides(input: CommonSupervisionInput): boolean {
  return input.expectedLegs.some((leg) => leg.side === 'LONG') && input.expectedLegs.some((leg) => leg.side === 'SHORT');
}

function policyCheck(input: CommonSupervisionInput): Readonly<SupervisionCheck> {
  const exactBounds = [
    input.policy.targetHedgeRatio,
    input.policy.maximumHedgeRatioDrift,
    input.policy.maximumOneLegExposure,
    input.policy.minimumExitCapacity,
    input.policy.minimumAvailableDepth,
    input.policy.maximumExecutableSpreadCost,
    input.policy.maximumProjectedExitCost,
    input.policy.maximumTotalGrossExposure,
    input.policy.reductionTargetExposure,
  ];
  const integerBounds = [input.policy.maximumOneLegDurationMs, input.policy.emergencyOneLegDurationMs, input.policy.maximumOutstandingIntents];
  const valid = input.policy.valuationAsset.trim().length > 0
    && policyAuthorityCurrent(input)
    && exactBounds.every(exactBoundValid)
    && integerBounds.every(integerBoundValid)
    && input.policy.emergencyOneLegDurationMs.value >= input.policy.maximumOneLegDurationMs.value
    && compareExactDecimals(input.policy.reductionTargetExposure.value, input.policy.maximumTotalGrossExposure.value) <= 0;
  return check('POLICY_AUTHORITY', valid ? 'PASS' : 'UNKNOWN', valid ? `policy ${input.policy.authority.revision} is current and bounded` : 'policy is expired, future, unbounded, or internally inconsistent');
}

function reconciliationCheck(input: CommonSupervisionInput): Readonly<SupervisionCheck> {
  const reference = input.position.reconciliationReference;
  if (reference === null) return check('RECONCILIATION', 'UNKNOWN', 'Foundation reconciliation reference is missing');
  if (reference.status === 'DIVERGED' || reference.status === 'AMBIGUOUS' || reference.truth.completeness === 'DIVERGENT') return check('RECONCILIATION', 'BREACH', `Foundation reconciliation is ${reference.status}`, reference.reasonCodes);
  if (reference.status !== 'EXACT' || !truthAllowsNewExposure(reference.truth)) return check('RECONCILIATION', 'UNKNOWN', `Foundation reconciliation is ${reference.status}/${reference.truth.completeness}`, reference.reasonCodes);
  return check('RECONCILIATION', 'PASS', 'Foundation reconciliation is exact and current', reference.reasonCodes, false);
}

function expectedLegChecks(input: CommonSupervisionInput): readonly Readonly<SupervisionCheck>[] {
  const missing: string[] = [];
  const zeroQuantity: string[] = [];
  const truthIssues: string[] = [];
  for (const expected of input.expectedLegs) {
    const leg = input.position.legs.find((candidate) => candidate.instrumentId === expected.instrumentId && candidate.side === expected.side);
    if (leg === undefined) missing.push(`${expected.instrumentId}:${expected.side}`);
    else {
      if (compareExactDecimals(leg.quantity, ZERO) <= 0 || compareExactDecimals(leg.quoteExposure, ZERO) <= 0) zeroQuantity.push(leg.id);
      if (!truthAllowsNewExposure(leg.truth)) truthIssues.push(leg.id);
    }
  }
  return Object.freeze([
    check('LEG_PRESENCE_AND_SIDE', missing.length === 0 ? 'PASS' : 'BREACH', missing.length === 0 ? 'all expected instruments/sides are present' : `missing ${missing.join(',')}`, missing),
    check('LEG_QUANTITY', zeroQuantity.length === 0 ? 'PASS' : 'BREACH', zeroQuantity.length === 0 ? 'expected legs have positive exact quantities/exposure' : `zero or absent exposure on ${zeroQuantity.join(',')}`, zeroQuantity),
    check('LEG_FRESHNESS', truthIssues.length === 0 ? 'PASS' : 'UNKNOWN', truthIssues.length === 0 ? 'leg truth is fresh and complete' : `leg truth incomplete for ${truthIssues.join(',')}`, truthIssues),
  ]);
}

export function evaluateUniversalSupervision(input: CommonSupervisionInput): Readonly<UniversalAssessment> {
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < input.position.openedAtMs) throw new TypeError('supervision requires injected UTC time at or after position open');
  if (!Number.isSafeInteger(input.position.thesis.openedAtMs) || input.position.thesis.openedAtMs > input.nowMs) throw new TypeError('position thesis open time cannot be in the future');
  const checks: Readonly<SupervisionCheck>[] = [];
  checks.push(policyCheck(input));
  checks.push(check('POSITION_TRUTH', truthStatus(input.position.truth), `${input.position.truth.completeness}/${input.position.truth.freshness.state}`, input.position.truth.evidenceReferences));
  checks.push(check('EXECUTION_REFERENCE', input.position.executionReference !== null && truthAllowsNewExposure(input.position.executionReference.truth) ? 'PASS' : 'UNKNOWN', input.position.executionReference === null ? 'Foundation execution reference is missing' : `${input.position.executionReference.lifecycle}/${input.position.executionReference.truth.completeness}`));
  checks.push(reconciliationCheck(input));
  checks.push(...expectedLegChecks(input));

  const paired = hasBothSides(input);
  const hedgeDrift = input.position.hedgeRatio === null
    ? null
    : absoluteExactDecimal(subtractExactDecimals(input.position.hedgeRatio, input.policy.targetHedgeRatio.value));
  checks.push(check('HEDGE_RATIO', !paired ? 'PASS' : hedgeDrift === null ? 'UNKNOWN' : compareExactDecimals(hedgeDrift, input.policy.maximumHedgeRatioDrift.value) > 0 ? 'BREACH' : 'PASS', !paired ? 'directional position has no two-leg hedge requirement' : hedgeDrift === null ? 'hedge ratio is unknown' : `hedge drift ${hedgeDrift}`));

  let oneLegStatus: SupervisionCheckStatus = 'PASS';
  let oneLegDetail = 'no one-leg exposure';
  let durationStatus: SupervisionCheckStatus = 'PASS';
  let durationDetail = 'no one-leg duration';
  if (paired && compareExactDecimals(input.position.oneLegExposure, ZERO) > 0) {
    oneLegStatus = compareExactDecimals(input.position.oneLegExposure, input.policy.maximumOneLegExposure.value) > 0 ? 'BREACH' : 'WATCH';
    oneLegDetail = `one-leg exposure ${input.position.oneLegExposure}`;
    if (input.position.oneLegSinceMs === null) {
      durationStatus = 'UNKNOWN';
      durationDetail = 'one-leg start time is missing';
    } else {
      const duration = input.nowMs - input.position.oneLegSinceMs;
      durationStatus = duration > input.policy.maximumOneLegDurationMs.value ? 'BREACH' : 'WATCH';
      durationDetail = `one-leg duration ${duration}ms`;
    }
  }
  checks.push(check('ONE_LEG_EXPOSURE', oneLegStatus, oneLegDetail));
  checks.push(check('ONE_LEG_DURATION', durationStatus, durationDetail));

  checks.push(check('MARKET_FRESHNESS', truthStatus(input.market.truth), `${input.market.truth.completeness}/${input.market.truth.freshness.state}`, input.market.evidenceIds));
  checks.push(check('SPREAD_COST', input.market.executableSpreadCost === null ? 'UNKNOWN' : compareExactDecimals(input.market.executableSpreadCost, input.policy.maximumExecutableSpreadCost.value) > 0 ? 'BREACH' : 'PASS', input.market.executableSpreadCost === null ? 'executable spread cost is missing' : `spread cost ${input.market.executableSpreadCost}`, input.market.evidenceIds));
  checks.push(check('MARKET_DEPTH', input.market.availableDepth === null ? 'UNKNOWN' : compareExactDecimals(input.market.availableDepth, input.policy.minimumAvailableDepth.value) < 0 ? 'BREACH' : 'PASS', input.market.availableDepth === null ? 'available depth is missing' : `available depth ${input.market.availableDepth}`, input.market.evidenceIds));
  checks.push(check('EXIT_CAPACITY', input.market.exitCapacity === null ? 'UNKNOWN' : compareExactDecimals(input.market.exitCapacity, input.policy.minimumExitCapacity.value) < 0 ? 'BREACH' : 'PASS', input.market.exitCapacity === null ? 'exit capacity is missing' : `exit capacity ${input.market.exitCapacity}`, input.market.evidenceIds));
  checks.push(check('PROJECTED_EXIT_COST', input.market.projectedExitCost === null ? 'UNKNOWN' : compareExactDecimals(input.market.projectedExitCost, input.policy.maximumProjectedExitCost.value) > 0 ? 'BREACH' : 'PASS', input.market.projectedExitCost === null ? 'projected exit cost is missing' : `projected exit cost ${input.market.projectedExitCost}`, input.market.evidenceIds));
  checks.push(check('CURRENT_AND_PROJECTED_COST', input.costs.projectedAdditionalCost === null || input.costs.accruedKnownCost === null || !truthAllowsNewExposure(input.costs.truth) ? 'UNKNOWN' : 'PASS', input.costs.projectedAdditionalCost === null || input.costs.accruedKnownCost === null ? 'current/projected costs incomplete' : `accrued ${input.costs.accruedKnownCost}; projected ${input.costs.projectedAdditionalCost}`, input.costs.sourceIds));
  checks.push(check('THESIS_TRUTH', truthStatus(input.thesisAssessment.truth), `${input.thesisAssessment.truth.completeness}/${input.thesisAssessment.truth.freshness.state}`, [...input.thesisAssessment.supportingEvidenceIds, ...input.thesisAssessment.conflictingEvidenceIds]));
  checks.push(check('THESIS_INVALIDATION', input.thesisAssessment.invalidated === null ? 'UNKNOWN' : input.thesisAssessment.invalidated ? 'BREACH' : 'PASS', input.thesisAssessment.invalidated === null ? 'thesis invalidation is unknown' : input.thesisAssessment.invalidated ? input.thesisAssessment.reasonCodes.join(',') || 'thesis invalidated' : 'thesis remains valid', input.thesisAssessment.conflictingEvidenceIds));
  checks.push(check('THESIS_TARGET', input.thesisAssessment.targetReached === null ? 'UNKNOWN' : input.thesisAssessment.targetReached ? 'WATCH' : 'PASS', input.thesisAssessment.targetReached === null ? 'thesis target assessment is unknown' : input.thesisAssessment.targetReached ? 'original thesis target reached' : 'original thesis target not yet reached', input.thesisAssessment.supportingEvidenceIds));
  const age = input.nowMs - input.position.thesis.openedAtMs;
  checks.push(check('THESIS_AGE', age >= input.position.thesis.maximumHoldingHorizonMs ? 'BREACH' : age >= input.position.thesis.expectedHorizonMs ? 'WATCH' : 'PASS', `thesis age ${age}ms of maximum ${input.position.thesis.maximumHoldingHorizonMs}ms`));
  checks.push(check('GROSS_EXPOSURE_LIMIT', compareExactDecimals(input.position.totalGrossExposure, input.policy.maximumTotalGrossExposure.value) > 0 ? 'BREACH' : 'PASS', `gross ${input.position.totalGrossExposure}; limit ${input.policy.maximumTotalGrossExposure.value}`));
  checks.push(check('OUTSTANDING_INTENTS', input.position.outstandingActionIntentIds.length > input.policy.maximumOutstandingIntents.value ? 'BREACH' : input.position.outstandingActionIntentIds.length > 0 ? 'WATCH' : 'PASS', `${input.position.outstandingActionIntentIds.length} outstanding intent(s)`));
  checks.push(check('CONTROL_POSTURE', input.controlPosture.posture === 'OPEN' && truthAllowsNewExposure(input.controlPosture.truth) ? 'PASS' : 'WATCH', `${input.controlPosture.posture}/${input.controlPosture.truth.completeness}`, input.controlPosture.reasonCodes, input.controlPosture.posture !== 'OPEN'));
  const stage = input.nextStageAuthority;
  const requestedAdditionalExposure = stage === null
    ? null
    : subtractExactDecimals(stage.maximumTotalExposure, input.position.totalGrossExposure);
  const stageValid = stage !== null
    && compareExactDecimals(stage.maximumAdditionalExposure, ZERO) > 0
    && requestedAdditionalExposure !== null
    && compareExactDecimals(requestedAdditionalExposure, ZERO) > 0
    && compareExactDecimals(requestedAdditionalExposure, stage.maximumAdditionalExposure) <= 0
    && compareExactDecimals(stage.maximumTotalExposure, input.policy.maximumTotalGrossExposure.value) <= 0
    && stage.evidenceFresh
    && stage.reservationAvailable
    && stage.approvalCurrent
    && stage.futureRiskRecheckRequired
    && !stage.adversePriceMoveIsSoleReason;
  checks.push(check('NEXT_STAGE_AUTHORITY', stage === null ? 'WATCH' : stageValid ? 'PASS' : 'BREACH', stage === null ? 'no next-stage increase requested' : stageValid ? `next stage capped at ${stage.maximumTotalExposure}` : 'next-stage authority is incomplete, exceeds its additional/portfolio cap, is non-increasing, or is averaging-down only', stage?.authorityReferences ?? [], true));

  const byCode = (code: string): Readonly<SupervisionCheck> => checks.find((entry) => entry.code === code) as Readonly<SupervisionCheck>;
  let universalDirective: Readonly<IntentDirective> | null = null;
  if (input.position.state === 'CLOSED') universalDirective = Object.freeze({ kind: 'HOLD', urgency: 'ROUTINE', reasons: Object.freeze(['POSITION_CLOSED']), hardDeadlineMs: null });
  else if (paired && compareExactDecimals(input.position.oneLegExposure, ZERO) > 0) {
    const duration = input.position.oneLegSinceMs === null ? null : input.nowMs - input.position.oneLegSinceMs;
    const reconciliationUncertain = byCode('RECONCILIATION').status !== 'PASS' || input.position.state === 'RECOVERY_REQUIRED';
    if (reconciliationUncertain) universalDirective = Object.freeze({ kind: 'REQUEST_EMERGENCY_UNWIND', urgency: 'EMERGENCY', reasons: Object.freeze(['ONE_LEG_RECONCILIATION_UNCERTAIN']), hardDeadlineMs: input.nowMs });
    else if (duration === null || duration > input.policy.emergencyOneLegDurationMs.value) universalDirective = Object.freeze({ kind: 'REQUEST_EMERGENCY_UNWIND', urgency: 'EMERGENCY', reasons: Object.freeze(['ONE_LEG_DURATION_EMERGENCY']), hardDeadlineMs: input.nowMs });
    else universalDirective = Object.freeze({ kind: 'REQUEST_HEDGE', urgency: byCode('ONE_LEG_EXPOSURE').status === 'BREACH' || byCode('ONE_LEG_DURATION').status === 'BREACH' ? 'URGENT' : 'ELEVATED', reasons: Object.freeze(['ONE_LEG_EXPOSURE']), hardDeadlineMs: input.nowMs - duration + input.policy.maximumOneLegDurationMs.value });
  } else if (byCode('RECONCILIATION').status !== 'PASS' || input.position.state === 'RECOVERY_REQUIRED') universalDirective = Object.freeze({ kind: 'FREEZE_NEW_ACTIONS', urgency: byCode('RECONCILIATION').status === 'BREACH' ? 'EMERGENCY' : 'URGENT', reasons: Object.freeze(['RECONCILIATION_NOT_EXACT', `POSITION_${input.position.state}`]), hardDeadlineMs: null });
  else if (byCode('THESIS_INVALIDATION').status === 'BREACH' || byCode('THESIS_AGE').status === 'BREACH' || byCode('THESIS_TARGET').status === 'WATCH') universalDirective = Object.freeze({ kind: 'REQUEST_EXIT', urgency: byCode('THESIS_TARGET').status === 'WATCH' ? 'ROUTINE' : 'URGENT', reasons: Object.freeze([byCode('THESIS_INVALIDATION').status === 'BREACH' ? 'THESIS_INVALIDATED' : byCode('THESIS_TARGET').status === 'WATCH' ? 'THESIS_TARGET_REACHED' : 'MAXIMUM_HOLDING_HORIZON']), hardDeadlineMs: input.nowMs });
  else if (byCode('GROSS_EXPOSURE_LIMIT').status === 'BREACH') universalDirective = Object.freeze({ kind: 'REDUCE', urgency: 'URGENT', reasons: Object.freeze(['GROSS_EXPOSURE_LIMIT_BREACH']), hardDeadlineMs: input.nowMs });
  else if (byCode('MARKET_DEPTH').status === 'BREACH' || byCode('EXIT_CAPACITY').status === 'BREACH') universalDirective = Object.freeze({ kind: 'REDUCE', urgency: 'ELEVATED', reasons: Object.freeze(['MARKET_EXIT_CAPACITY_DETERIORATED']), hardDeadlineMs: null });
  else if (byCode('OUTSTANDING_INTENTS').status === 'BREACH') universalDirective = Object.freeze({ kind: 'FREEZE_NEW_ACTIONS', urgency: 'ELEVATED', reasons: Object.freeze(['OUTSTANDING_INTENT_LIMIT']), hardDeadlineMs: null });

  const allTruthAllowsIncrease = checks.every((entry) => entry.status === 'PASS');
  return Object.freeze({ checks: Object.freeze(checks), allTruthAllowsIncrease, universalDirective });
}

function gatesFor(kind: PositionActionIntentKind): readonly FutureGate[] {
  if (kind === 'ADD_STAGE') return Object.freeze(['OPERATOR_APPROVAL', 'MULTI_LEG_RISK', 'EXECUTION_COORDINATOR', 'RECONCILIATION', 'FRESH_ACCOUNT_TRUTH', 'FRESH_MARKET_EVIDENCE']);
  if (kind === 'REDUCE' || kind === 'REQUEST_HEDGE' || kind === 'REQUEST_EXIT' || kind === 'REQUEST_EMERGENCY_UNWIND') return Object.freeze(['MULTI_LEG_RISK', 'EXECUTION_COORDINATOR', 'RECONCILIATION', 'FRESH_ACCOUNT_TRUTH', 'FRESH_MARKET_EVIDENCE']);
  if (kind === 'FREEZE_NEW_ACTIONS') return Object.freeze(['RECONCILIATION']);
  return Object.freeze([]);
}

function targetFor(input: CommonSupervisionInput, kind: PositionActionIntentKind) {
  const total = (quoteNotional: NonNegativeDecimal): Readonly<TotalExposureTarget> => Object.freeze({ kind: 'TOTAL', valuationAsset: input.policy.valuationAsset, quoteNotional, baseQuantity: null, targetHedgeRatio: input.policy.targetHedgeRatio.value });
  if (kind === 'NO_ACTION_UNKNOWN') return Object.freeze({ kind: 'UNKNOWN' as const, valuationAsset: input.policy.valuationAsset, reasonCodes: Object.freeze(['EXPOSURE_TARGET_UNSAFE_TO_DERIVE']) });
  if (kind === 'ADD_STAGE') return total(normalizeNonNegativeExactDecimal(input.nextStageAuthority?.maximumTotalExposure ?? input.position.totalGrossExposure));
  if (kind === 'REDUCE') {
    const configured = normalizeNonNegativeExactDecimal(input.policy.reductionTargetExposure.value);
    return total(compareExactDecimals(configured, input.position.totalGrossExposure) < 0 ? configured : ZERO);
  }
  if (kind === 'REQUEST_HEDGE') return Object.freeze({ kind: 'DELTA' as const, valuationAsset: input.policy.valuationAsset, quoteNotional: negateExactDecimal(input.position.netDirectionalExposure), baseQuantity: null, targetHedgeRatio: input.policy.targetHedgeRatio.value });
  if (kind === 'REQUEST_EXIT' || kind === 'REQUEST_EMERGENCY_UNWIND') return total(ZERO);
  return total(normalizeNonNegativeExactDecimal(input.position.totalGrossExposure));
}

export function buildSupervisionDecision(
  strategy: 'BASIS' | 'VOLUME',
  input: CommonSupervisionInput,
  checks: readonly Readonly<SupervisionCheck>[],
  directive: Readonly<IntentDirective>,
  strategyTruths: readonly Readonly<TruthMetadata>[],
  strategyDecisionInput: unknown,
): Readonly<SupervisionDecision> {
  const target = targetFor(input, directive.kind);
  const supportingEvidenceIds = sortedUnique([...(directive.evidenceIds ?? []), ...input.thesisAssessment.supportingEvidenceIds]);
  const conflictingEvidenceIds = sortedUnique(input.thesisAssessment.conflictingEvidenceIds);
  const blockingFacts = sortedUnique(checks.filter((entry) => entry.status === 'UNKNOWN').map((entry) => entry.code));
  const truthStates: CapitalTruthState[] = [
    input.position.truth.completeness,
    ...input.position.legs.map((leg) => leg.truth.completeness),
    ...(input.position.executionReference === null ? [] : [input.position.executionReference.truth.completeness]),
    ...(input.position.reconciliationReference === null ? [] : [input.position.reconciliationReference.truth.completeness]),
    input.market.truth.completeness,
    input.costs.truth.completeness,
    input.thesisAssessment.truth.completeness,
    input.controlPosture.truth.completeness,
    ...strategyTruths.map((truth) => truth.completeness),
  ];
  const sourceCompleteness = weakestCapitalTruth(truthStates);
  const completeness = sourceCompleteness === 'COMPLETE' && checks.some((entry) => entry.status === 'UNKNOWN')
    ? 'UNKNOWN'
    : sourceCompleteness;
  const why = sortedUnique(directive.reasons);
  const requiredFutureGates = gatesFor(directive.kind);
  const invalidationConditions = sortedUnique(directive.invalidationConditions ?? input.position.thesis.invalidationConditions);
  const semantic = {
    strategy,
    positionId: input.position.id,
    positionRevision: input.position.revision,
    thesisId: input.position.thesis.id,
    thesisRevision: input.position.thesis.revision,
    kind: directive.kind,
    target,
    urgency: directive.urgency,
    hardDeadlineMs: directive.hardDeadlineMs,
    why,
    supportingEvidenceIds,
    conflictingEvidenceIds,
    requiredFutureGates,
    completeness,
    blockingFacts,
    economicCostOfWaiting: input.economicCostOfWaiting,
    expectedCostOfActing: input.expectedCostOfActing,
    invalidationConditions,
    decisionInputDigest: capitalDigest({ common: input, strategy: strategyDecisionInput, checks }),
    evaluatedAtMs: input.nowMs,
  };
  const digest = capitalDigest(semantic);
  const base = {
    id: deriveActionIntentId(semantic),
    positionId: input.position.id,
    sourcePositionRevision: input.position.revision,
    sourceThesisId: input.position.thesis.id,
    sourceThesisRevision: input.position.thesis.revision,
    target,
    urgency: directive.urgency,
    hardDeadlineMs: directive.hardDeadlineMs,
    why,
    supportingEvidenceIds,
    conflictingEvidenceIds,
    requiredFutureGates,
    completeness,
    blockingFacts,
    idempotencyKey: `capital-supervision:${digest}`,
    correlationKey: `capital-position:${input.position.id}:r${input.position.revision}`,
    economicCostOfWaiting: input.economicCostOfWaiting,
    expectedCostOfActing: input.expectedCostOfActing,
    invalidationConditions,
    createdAtMs: input.nowMs,
  };
  let intent: PositionActionIntent;
  switch (directive.kind) {
    case 'ADD_STAGE': intent = Object.freeze({ ...base, kind: directive.kind, riskEffect: 'RISK_INCREASING', target: target as Exclude<typeof target, { kind: 'UNKNOWN' }> }); break;
    case 'REDUCE':
    case 'REQUEST_HEDGE':
    case 'REQUEST_EXIT':
    case 'REQUEST_EMERGENCY_UNWIND': intent = Object.freeze({ ...base, kind: directive.kind, riskEffect: 'RISK_REDUCING', target: target as Exclude<typeof target, { kind: 'UNKNOWN' }> }); break;
    case 'NO_ACTION_UNKNOWN': intent = Object.freeze({ ...base, kind: directive.kind, riskEffect: 'NO_CHANGE', target: target as Extract<typeof target, { kind: 'UNKNOWN' }> }); break;
    case 'HOLD':
    case 'FREEZE_NEW_ACTIONS': intent = Object.freeze({ ...base, kind: directive.kind, riskEffect: 'NO_CHANGE' }); break;
  }
  if (intent.riskEffect !== actionRiskEffect(intent.kind)) throw new TypeError('supervision intent risk direction mismatch');
  return Object.freeze({ strategy, positionId: input.position.id, positionRevision: input.position.revision, thesisRevision: input.position.thesis.revision, priority: 'EXPOSED_CAPITAL', intent, checks: Object.freeze([...checks]), evaluatedAtMs: input.nowMs, decisionKey: digest });
}

export function appendChecks(base: readonly Readonly<SupervisionCheck>[], additions: readonly Readonly<SupervisionCheck>[]): readonly Readonly<SupervisionCheck>[] {
  return Object.freeze([...base, ...additions]);
}

export function strategyCheck(code: string, status: SupervisionCheckStatus, detail: string, evidenceIds: readonly string[] = []): Readonly<SupervisionCheck> {
  return check(code, status, detail, evidenceIds);
}

export function signalStatus(state: 'PRESENT' | 'ABSENT' | 'UNKNOWN', strength: ExactDecimal | null, threshold: ExactDecimal, breachWhenAbove: boolean): SupervisionCheckStatus {
  if (state === 'UNKNOWN' || strength === null) return 'UNKNOWN';
  if (state === 'ABSENT') return breachWhenAbove ? 'PASS' : 'BREACH';
  const beyond = compareExactDecimals(strength, threshold) >= 0;
  return beyond === breachWhenAbove ? 'BREACH' : 'PASS';
}

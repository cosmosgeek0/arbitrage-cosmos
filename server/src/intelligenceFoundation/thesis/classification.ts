import { sortedUnique } from '../contracts/index.js';
import type {
  HypothesisAssessment,
  HypothesisClassificationInput,
  StageAssessment,
  StageClassificationInput,
  ThesisRules,
} from './types.js';

function absolute(value: number | null): number | null {
  return value === null ? null : Math.abs(value);
}

function meets(value: number | null, threshold: number): boolean {
  return value !== null && value >= threshold;
}

function active(activity: number | null, acceleration: number | null, rules: ThesisRules): boolean {
  return meets(activity, rules.activityMultiple) || meets(acceleration, rules.arrivalAcceleration);
}

function sameNonZeroSign(left: number | null, right: number | null): boolean {
  return left !== null && right !== null && left !== 0 && right !== 0 && Math.sign(left) === Math.sign(right);
}

function oppositeNonZeroSign(left: number | null, right: number | null): boolean {
  return left !== null && right !== null && left !== 0 && right !== 0 && Math.sign(left) !== Math.sign(right);
}

function stage(stage: StageAssessment['stage'], ...reasonCodes: string[]): StageAssessment {
  return { stage, reasonCodes: sortedUnique(reasonCodes) };
}

/** Pure stage classifier. The order below is the required precedence order. */
export function classifyMarketStage(input: StageClassificationInput, rules: ThesisRules): StageAssessment {
  const shortActive = active(input.shortActivityMultiple, input.shortArrivalAcceleration, rules);
  const confirmationActive = active(input.confirmationActivityMultiple, input.confirmationArrivalAcceleration, rules);
  const mediumActive = active(input.mediumActivityMultiple, input.mediumArrivalAcceleration, rules);
  const persistentActivity = [shortActive, confirmationActive, mediumActive].filter(Boolean).length >= 2;
  const shortMove = absolute(input.shortMovePct);
  const confirmationMove = absolute(input.confirmationMovePct);
  const mediumMove = absolute(input.mediumMovePct);
  const priorExpansion = (confirmationMove ?? 0) >= rules.visibleMovePct || (mediumMove ?? 0) >= rules.visibleMovePct;
  const flowAligned = input.aggressorImbalance !== null
    && sameNonZeroSign(input.aggressorImbalance, input.confirmationMovePct ?? input.mediumMovePct)
    && Math.abs(input.aggressorImbalance) >= rules.flowImbalanceAbs;
  const depthSupportive = input.depthSupportRatio !== null && input.depthSupportRatio >= rules.depthSupportRatio;
  const depthCollapsed = input.depthChangeRatio !== null && input.depthChangeRatio <= rules.depthCollapseRatio;
  const faded = input.fadeFromPeakPct !== null && input.fadeFromPeakPct >= rules.reversalFadePct;

  if (priorExpansion && faded && oppositeNonZeroSign(input.shortMovePct, input.mediumMovePct ?? input.confirmationMovePct)) {
    return stage('REVERSAL', 'STAGE_REVERSAL_FADE', 'SHORT_MOVE_OPPOSES_PRIOR_MOVE');
  }

  const detectionLagMs = input.changedAtMs === null
    ? null
    : Math.max(0, input.candidateOpenedAtMs - input.changedAtMs);
  if (priorExpansion && detectionLagMs !== null && detectionLagMs > rules.tooLateDetectionLagMs) {
    return stage('TOO_LATE', 'DETECTION_LAG_EXCEEDED', 'VISIBLE_MOVE_PRECEDED_CANDIDATE');
  }

  const deterioration = [
    input.shortActivityMultiple !== null && input.confirmationActivityMultiple !== null
      && input.shortActivityMultiple < input.confirmationActivityMultiple,
    input.shortArrivalAcceleration !== null && input.shortArrivalAcceleration <= 0,
    input.spreadChangeBps !== null && input.spreadChangeBps > 0,
    depthCollapsed,
    input.fadeFromPeakPct !== null && input.fadeFromPeakPct >= rules.reversalFadePct / 2,
  ].filter(Boolean).length;
  if (((mediumMove ?? confirmationMove ?? 0) >= rules.exhaustionMovePct) && deterioration >= 2) {
    return stage('EXHAUSTION', 'EXPANSION_EXTENDED', 'MULTIPLE_DETERIORATION_SIGNALS');
  }

  if (
    (mediumMove ?? 0) >= rules.continuationMovePct
    && (confirmationMove ?? 0) >= rules.visibleMovePct
    && persistentActivity
    && flowAligned
    && !faded
  ) {
    return stage('CONTINUATION', 'MOVE_CONFIRMED_ACROSS_WINDOWS', 'FLOW_ALIGNED_WITH_MOVE');
  }

  if (
    Math.max(confirmationMove ?? 0, mediumMove ?? 0) >= rules.visibleMovePct
    && (shortActive || persistentActivity)
  ) {
    return stage('VISIBLE_EXPANSION', 'VISIBLE_MOVE_THRESHOLD_REACHED', 'ACTIVITY_ELEVATED');
  }

  if (
    confirmationMove !== null
    && confirmationMove < rules.visibleMovePct
    && (mediumMove === null || mediumMove < rules.visibleMovePct)
    && persistentActivity
    && (flowAligned || depthSupportive)
  ) {
    return stage('BEFORE_VISIBLE_MOVE', 'ACTIVITY_PERSISTS_BEFORE_VISIBLE_MOVE', flowAligned ? 'FLOW_COHERENT' : 'DEPTH_SUPPORTIVE');
  }

  if (shortActive) return stage('EARLY_CHANGE', 'SHORT_WINDOW_ACTIVITY_CHANGED');

  const observedActivity = [input.shortActivityMultiple, input.confirmationActivityMultiple, input.mediumActivityMultiple]
    .filter((value): value is number => value !== null);
  const observedAcceleration = [input.shortArrivalAcceleration, input.confirmationArrivalAcceleration, input.mediumArrivalAcceleration]
    .filter((value): value is number => value !== null);
  const quietActivity = observedActivity.length > 0 && observedActivity.every((value) => value < rules.activityMultiple);
  const quietArrival = observedAcceleration.length === 0 || observedAcceleration.every((value) => value < rules.arrivalAcceleration);
  if (
    input.baselineReady
    && quietActivity
    && quietArrival
    && confirmationMove !== null
    && confirmationMove <= rules.quietMovePct
  ) {
    return stage('QUIET', 'BASELINE_READY', 'ACTIVITY_AND_MOVE_QUIET');
  }

  return stage('UNCLASSIFIED', 'STAGE_EVIDENCE_INSUFFICIENT_OR_MIXED');
}

function hypothesis(value: HypothesisAssessment['hypothesis'], ...reasonCodes: string[]): HypothesisAssessment {
  return { hypothesis: value, reasonCodes: sortedUnique(reasonCodes) };
}

/** Pure hypothesis classifier. The order below is the required precedence order. */
export function classifyHypothesis(input: HypothesisClassificationInput, rules: ThesisRules): HypothesisAssessment {
  const visibleOrLater = input.visibleMove === true || [
    'VISIBLE_EXPANSION',
    'CONTINUATION',
    'EXHAUSTION',
    'REVERSAL',
    'TOO_LATE',
  ].includes(input.stage);

  if (visibleOrLater && ['EXHAUSTION', 'REVERSAL', 'TOO_LATE'].includes(input.stage)) {
    return hypothesis('EXHAUSTED_MOVE', 'MOVE_IS_LATE_OR_DETERIORATING', `STAGE_${input.stage}`);
  }

  const churn = input.persistentActivity === true
    && input.aggressorImbalance !== null
    && Math.abs(input.aggressorImbalance) < rules.flowImbalanceAbs
    && input.priceResponsePerFlow !== null
    && Math.abs(input.priceResponsePerFlow) <= rules.lowPriceResponsePerFlow
    && input.tradeSizeRepeatRatio !== null
    && input.tradeSizeRepeatRatio >= rules.churnRepeatRatio
    && input.sideAlternationRatio !== null
    && input.sideAlternationRatio >= rules.churnAlternationRatio;
  if (churn) return hypothesis('CHURN_WITHOUT_FOLLOW_THROUGH', 'ACTIVITY_PERSISTS_WITH_LOW_PRICE_RESPONSE', 'REPETITION_AND_ALTERNATION_ELEVATED');

  const thinBook = visibleOrLater && (
    input.depthSupportRatio !== null && input.depthSupportRatio < rules.depthSupportRatio
    || input.depthChangeRatio !== null && input.depthChangeRatio <= rules.depthCollapseRatio
  );
  if (thinBook) return hypothesis('THIN_BOOK_DISLOCATION', 'VISIBLE_MOVE_WITH_WEAK_OR_COLLAPSING_DEPTH');

  if (
    input.marketParticipationRatio !== null
    && input.marketParticipationRatio >= rules.marketParticipationRatio
    && input.symbolMarketResidualReturnPct !== null
    && Math.abs(input.symbolMarketResidualReturnPct) <= rules.maxSymbolResidualPct
  ) {
    return hypothesis('MARKET_WIDE_BETA_MOVE', 'MARKET_PARTICIPATION_BROAD', 'SYMBOL_RESIDUAL_SMALL');
  }

  if (
    input.liquidationFlowShare !== null
    && input.liquidationFlowShare >= rules.liquidationFlowShare
    && input.openInterestChangePct !== null
    && input.openInterestChangePct <= rules.oiDropPct
    && (input.leadMarket === 'PERPETUAL' || input.spotActivityHot === false)
  ) {
    return hypothesis('LIQUIDATION_DRIVEN_MOVE', 'LIQUIDATION_FLOW_ELEVATED', 'OPEN_INTEREST_DROPPED');
  }

  const derivativeFacts = [
    input.fundingRateChange !== null && Math.abs(input.fundingRateChange) >= rules.fundingChangeAbs,
    input.openInterestChangePct !== null && Math.abs(input.openInterestChangePct) >= rules.oiChangeAbs,
    input.liquidationFlowShare !== null && input.liquidationFlowShare >= rules.liquidationFlowShare / 2,
  ].filter(Boolean).length;
  if (input.leadMarket === 'PERPETUAL' && derivativeFacts >= 2) {
    return hypothesis('PERPETUAL_LED_SQUEEZE', 'PERPETUAL_MARKET_CHANGED_FIRST', 'MULTIPLE_DERIVATIVE_SIGNALS');
  }

  if (
    input.leadMarket === 'SPOT'
    && input.persistentActivity === true
    && input.priceResponsePerFlow !== null
    && Math.abs(input.priceResponsePerFlow) > rules.lowPriceResponsePerFlow
  ) {
    return hypothesis('SPOT_LED_EXPANSION', 'SPOT_MARKET_CHANGED_FIRST', 'ACTIVITY_AND_PRICE_RESPONSE_PERSIST');
  }

  const accumulationBook = input.absorptionRatio !== null && input.absorptionRatio >= rules.absorptionRatio
    || input.replenishmentRatio !== null && input.replenishmentRatio >= rules.replenishmentRatio;
  if (
    input.persistentActivity === true
    && input.aggressorImbalance !== null
    && Math.abs(input.aggressorImbalance) >= rules.flowImbalanceAbs
    && accumulationBook
    && ['BEFORE_VISIBLE_MOVE', 'VISIBLE_EXPANSION'].includes(input.stage)
  ) {
    return hypothesis('ACCUMULATION_TO_EXPANSION', 'PERSISTENT_ONE_SIDED_FLOW', 'ABSORPTION_OR_REPLENISHMENT_PRESENT');
  }

  if (
    input.deadBaseline === true
    && ['EARLY_CHANGE', 'BEFORE_VISIBLE_MOVE', 'VISIBLE_EXPANSION'].includes(input.stage)
  ) {
    return hypothesis('DEAD_VOLUME_WAKEUP', 'DEAD_BASELINE_REACTIVATED', `STAGE_${input.stage}`);
  }

  return hypothesis('UNCLASSIFIED_ANOMALY', 'HYPOTHESIS_EVIDENCE_INSUFFICIENT_OR_MIXED');
}

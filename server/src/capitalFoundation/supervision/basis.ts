import {
  absoluteExactDecimal,
  compareExactDecimals,
  policyBoundIsValid,
  subtractExactDecimals,
  truthAllowsNewExposure,
  type ExactDecimal,
} from '../contracts/index.js';
import {
  appendChecks,
  buildSupervisionDecision,
  evaluateUniversalSupervision,
  policyAuthorityCurrent,
  strategyCheck,
  type IntentDirective,
} from './common.js';
import type { BasisPathObservation, BasisSupervisionInput, SupervisionCheck, SupervisionDecision } from './types.js';

function integerBoundValid(bound: BasisSupervisionInput['policy']['fundingExitLeadTimeMs']): boolean {
  return Number.isSafeInteger(bound.value) && Number.isSafeInteger(bound.minimum) && Number.isSafeInteger(bound.maximum)
    && bound.minimum >= 0 && bound.value >= bound.minimum && bound.value <= bound.maximum;
}

function pathConvergenceCount(path: readonly Readonly<BasisPathObservation>[]): number {
  const ordered = [...path].sort((a, b) => a.observedAtMs - b.observedAtMs || (a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0));
  let count = ordered.length > 0 ? 1 : 0;
  for (let index = ordered.length - 1; index > 0; index -= 1) {
    if (compareExactDecimals(absoluteExactDecimal(ordered[index].executableBasis), absoluteExactDecimal(ordered[index - 1].executableBasis)) <= 0) count += 1;
    else break;
  }
  return count;
}

function basisChecks(input: BasisSupervisionInput): readonly Readonly<SupervisionCheck>[] {
  const policyBounds = [
    input.policy.minimumRemainingEdge,
    input.policy.minimumRemainingEdgeForAdd,
    input.policy.maximumAdverseBasisMove,
    input.policy.maximumAdverseFundingRate,
    input.policy.maximumBorrowRate,
    input.policy.maximumHedgeDrift,
    input.policy.minimumLiquidationDistance,
    input.policy.minimumMarginDistance,
    input.policy.maximumLiquidityDeterioration,
  ];
  const policyValid = policyAuthorityCurrent(input.common, input.policy.authority)
    && policyBounds.every(policyBoundIsValid)
    && integerBoundValid(input.policy.fundingExitLeadTimeMs)
    && integerBoundValid(input.policy.requiredConvergingObservationsForAdd)
    && compareExactDecimals(input.policy.minimumRemainingEdgeForAdd.value, input.policy.minimumRemainingEdge.value) >= 0;
  const factsFresh = truthAllowsNewExposure(input.basis.truth);
  const entryMagnitude = absoluteExactDecimal(input.basis.entryExecutableBasis);
  const currentMagnitude = absoluteExactDecimal(input.basis.currentExecutableBasis);
  const adverseMoveRaw = subtractExactDecimals(currentMagnitude, entryMagnitude);
  const adverseMove = compareExactDecimals(adverseMoveRaw, '0' as ExactDecimal) > 0 ? adverseMoveRaw : '0' as ExactDecimal;
  const pathFresh = input.basis.convergencePath.length > 0 && input.basis.convergencePath.every((item) => truthAllowsNewExposure(item.truth) && item.observedAtMs <= input.common.nowMs);
  const convergingCount = pathConvergenceCount(input.basis.convergencePath);
  const remaining = input.basis.expectedRemainingEdgeAfterExitCosts;
  const adverseFunding = input.basis.funding.direction === 'PAID'
    && input.basis.funding.rate !== null
    && compareExactDecimals(absoluteExactDecimal(input.basis.funding.rate), input.policy.maximumAdverseFundingRate.value) > 0
    && input.basis.funding.nextFundingAtMs !== null
    && input.basis.funding.nextFundingAtMs <= input.common.nowMs + input.policy.fundingExitLeadTimeMs.value;
  const liquidity = input.basis.spotLiquidityDeterioration === null || input.basis.perpetualLiquidityDeterioration === null
    ? null
    : compareExactDecimals(input.basis.spotLiquidityDeterioration, input.basis.perpetualLiquidityDeterioration) >= 0 ? input.basis.spotLiquidityDeterioration : input.basis.perpetualLiquidityDeterioration;
  return Object.freeze([
    strategyCheck('BASIS_POLICY', policyValid ? 'PASS' : 'UNKNOWN', policyValid ? `policy ${input.policy.authority.revision} is current and bounded` : 'Basis policy is invalid or not current'),
    strategyCheck('BASIS_FACT_FRESHNESS', factsFresh ? 'PASS' : input.basis.truth.completeness === 'DIVERGENT' ? 'BREACH' : 'UNKNOWN', `${input.basis.truth.completeness}/${input.basis.truth.freshness.state}`, input.basis.evidenceIds),
    strategyCheck('BASIS_PATH', !pathFresh ? 'UNKNOWN' : convergingCount >= input.policy.requiredConvergingObservationsForAdd.value ? 'PASS' : 'WATCH', pathFresh ? `${convergingCount} trailing converging observation(s)` : 'basis path missing or stale', input.basis.convergencePath.map((item) => item.evidenceId)),
    strategyCheck('BASIS_DIVERGENCE', compareExactDecimals(adverseMove, input.policy.maximumAdverseBasisMove.value) > 0 ? 'BREACH' : 'PASS', `adverse absolute-basis move ${adverseMove}`, input.basis.evidenceIds),
    strategyCheck('BASIS_REMAINING_EDGE', remaining === null ? 'UNKNOWN' : compareExactDecimals(remaining, input.policy.minimumRemainingEdge.value) <= 0 ? 'BREACH' : compareExactDecimals(remaining, input.policy.minimumRemainingEdgeForAdd.value) < 0 ? 'WATCH' : 'PASS', remaining === null ? 'remaining edge is missing' : `remaining edge after exit costs ${remaining}`, input.basis.evidenceIds),
    strategyCheck('BASIS_FUNDING', !truthAllowsNewExposure(input.basis.funding.truth) || input.basis.funding.rate === null || input.basis.funding.direction === 'UNKNOWN' || input.basis.funding.nextFundingAtMs === null || input.basis.funding.accruedFunding === null ? 'UNKNOWN' : adverseFunding ? 'BREACH' : 'PASS', adverseFunding ? 'adverse funding exceeds policy before the next event' : `funding ${input.basis.funding.direction}`, input.basis.funding.evidenceIds),
    strategyCheck('BASIS_BORROW', !truthAllowsNewExposure(input.basis.borrow.truth) || input.basis.borrow.availability === 'UNKNOWN' || (input.basis.borrow.availability !== 'NOT_REQUIRED' && (input.basis.borrow.rate === null || input.basis.borrow.accruedCost === null)) ? 'UNKNOWN' : input.basis.borrow.availability === 'RECALLED' || input.basis.borrow.availability === 'UNAVAILABLE' ? 'BREACH' : input.basis.borrow.rate !== null && compareExactDecimals(input.basis.borrow.rate, input.policy.maximumBorrowRate.value) > 0 ? 'BREACH' : 'PASS', `borrow ${input.basis.borrow.availability}${input.basis.borrow.rate === null ? '' : ` rate ${input.basis.borrow.rate}`}`, input.basis.borrow.evidenceIds),
    strategyCheck('BASIS_HEDGE_DRIFT', input.basis.hedgeDrift === null ? 'UNKNOWN' : compareExactDecimals(input.basis.hedgeDrift, input.policy.maximumHedgeDrift.value) > 0 ? 'BREACH' : 'PASS', input.basis.hedgeDrift === null ? 'hedge drift missing' : `hedge drift ${input.basis.hedgeDrift}`, input.basis.evidenceIds),
    strategyCheck('BASIS_LIQUIDATION_DISTANCE', input.basis.liquidationDistance === null ? 'UNKNOWN' : compareExactDecimals(input.basis.liquidationDistance, input.policy.minimumLiquidationDistance.value) < 0 ? 'BREACH' : 'PASS', input.basis.liquidationDistance === null ? 'liquidation distance missing' : `liquidation distance ${input.basis.liquidationDistance}`, input.basis.evidenceIds),
    strategyCheck('BASIS_MARGIN_DISTANCE', input.basis.marginDistance === null ? 'UNKNOWN' : compareExactDecimals(input.basis.marginDistance, input.policy.minimumMarginDistance.value) < 0 ? 'BREACH' : 'PASS', input.basis.marginDistance === null ? 'margin distance missing' : `margin distance ${input.basis.marginDistance}`, input.basis.evidenceIds),
    strategyCheck('BASIS_LIQUIDITY', liquidity === null ? 'UNKNOWN' : compareExactDecimals(liquidity, input.policy.maximumLiquidityDeterioration.value) > 0 ? 'BREACH' : 'PASS', liquidity === null ? 'spot/perpetual liquidity deterioration missing' : `worst liquidity deterioration ${liquidity}`, input.basis.evidenceIds),
  ]);
}

function status(checks: readonly Readonly<SupervisionCheck>[], code: string) {
  return checks.find((item) => item.code === code)?.status ?? 'UNKNOWN';
}

export function superviseBasisPosition(input: BasisSupervisionInput): Readonly<SupervisionDecision> {
  if (input.common.position.thesis.strategy !== 'BASIS') throw new TypeError('Basis supervisor requires a BASIS position thesis');
  const universal = evaluateUniversalSupervision(input.common);
  const checks = appendChecks(universal.checks, basisChecks(input));
  let directive: Readonly<IntentDirective> | null = universal.universalDirective;
  if (directive === null && (status(checks, 'BASIS_LIQUIDATION_DISTANCE') === 'BREACH' || status(checks, 'BASIS_MARGIN_DISTANCE') === 'BREACH' || input.basis.borrow.availability === 'RECALLED')) directive = Object.freeze({ kind: 'REQUEST_EMERGENCY_UNWIND', urgency: 'EMERGENCY', reasons: Object.freeze(['BASIS_CAPITAL_SURVIVAL_LIMIT']), hardDeadlineMs: input.common.nowMs, evidenceIds: input.basis.evidenceIds });
  else if (directive === null && input.basis.borrow.availability === 'UNAVAILABLE') directive = Object.freeze({ kind: 'REQUEST_EXIT', urgency: 'URGENT', reasons: Object.freeze(['BORROW_UNAVAILABLE']), hardDeadlineMs: input.common.nowMs, evidenceIds: input.basis.borrow.evidenceIds });
  else if (directive === null && status(checks, 'BASIS_HEDGE_DRIFT') === 'BREACH') directive = Object.freeze({ kind: 'REQUEST_HEDGE', urgency: 'URGENT', reasons: Object.freeze(['BASIS_HEDGE_DRIFT']), hardDeadlineMs: input.common.nowMs, evidenceIds: input.basis.evidenceIds });
  else if (directive === null && (status(checks, 'BASIS_REMAINING_EDGE') === 'BREACH' || status(checks, 'BASIS_DIVERGENCE') === 'BREACH')) directive = Object.freeze({ kind: 'REQUEST_EXIT', urgency: 'URGENT', reasons: Object.freeze([status(checks, 'BASIS_REMAINING_EDGE') === 'BREACH' ? 'REMAINING_EDGE_EXHAUSTED' : 'BASIS_DIVERGENCE_INVALIDATION']), hardDeadlineMs: input.common.nowMs, evidenceIds: input.basis.evidenceIds });
  else if (directive === null && (status(checks, 'BASIS_FUNDING') === 'BREACH' || status(checks, 'BASIS_BORROW') === 'BREACH' || status(checks, 'BASIS_LIQUIDITY') === 'BREACH')) directive = Object.freeze({ kind: 'REDUCE', urgency: 'ELEVATED', reasons: Object.freeze(['BASIS_CARRY_OR_LIQUIDITY_DETERIORATION']), hardDeadlineMs: null, evidenceIds: input.basis.evidenceIds });
  else if (directive === null && checks.some((item) => item.status === 'UNKNOWN')) directive = Object.freeze({ kind: 'FREEZE_NEW_ACTIONS', urgency: 'ELEVATED', reasons: Object.freeze(['BASIS_REQUIRED_TRUTH_UNKNOWN']), hardDeadlineMs: null, evidenceIds: input.basis.evidenceIds });
  else if (directive === null && universal.allTruthAllowsIncrease && checks.every((item) => item.status === 'PASS')) directive = Object.freeze({ kind: 'ADD_STAGE', urgency: 'ROUTINE', reasons: Object.freeze(['BASIS_CONVERGENCE_AND_EDGE_SUPPORT_NEXT_STAGE']), hardDeadlineMs: null, evidenceIds: input.basis.evidenceIds });
  else if (directive === null) directive = Object.freeze({ kind: 'HOLD', urgency: 'ROUTINE', reasons: Object.freeze(['BASIS_THESIS_REMAINS_WITHIN_POLICY']), hardDeadlineMs: null, evidenceIds: input.basis.evidenceIds });
  return buildSupervisionDecision(
    'BASIS',
    input.common,
    checks,
    directive,
    Object.freeze([
      input.basis.truth,
      input.basis.funding.truth,
      input.basis.borrow.truth,
      ...input.basis.convergencePath.map((observation) => observation.truth),
    ]),
    Object.freeze({ policy: input.policy, facts: input.basis }),
  );
}

import {
  absoluteExactDecimal,
  compareExactDecimals,
  deriveCapitalConfigRevision,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  subtractExactDecimals,
  type ExactDecimal,
  type ExactPolicyBound,
  type NonNegativeDecimal,
  type TruthMetadata,
} from '../contracts/index.js';
import { isValidUtcMillis } from '../../foundation/contracts/index.js';
import {
  appendChecks,
  buildSupervisionDecision,
  evaluateUniversalSupervision,
  policyAuthorityCurrent,
  supervisionTruthAllowsIncreaseAt,
  supervisionTruthStateAt,
  SUPERVISION_COUNT_UNIT,
  SUPERVISION_MILLISECONDS_UNIT,
  SUPERVISION_RATIO_UNIT,
  strategyCheck,
  type IntentDirective,
} from './common.js';
import {
  BASIS_RESOURCE_AVAILABILITIES,
  BASIS_FUNDING_DIRECTIONS,
  type BasisPathObservation,
  type BasisSpecificFacts,
  type BasisSupervisionInput,
  type BasisSupervisionPolicy,
  type SupervisionCheck,
  type SupervisionDecision,
} from './types.js';

function exactBoundValid(bound: ExactPolicyBound): boolean {
  try {
    return bound.unit === SUPERVISION_RATIO_UNIT
      && normalizeNonNegativeExactDecimal(bound.value) === bound.value
      && normalizeNonNegativeExactDecimal(bound.minimum) === bound.minimum
      && normalizeNonNegativeExactDecimal(bound.maximum) === bound.maximum
      && compareExactDecimals(bound.minimum, bound.maximum) <= 0
      && compareExactDecimals(bound.value, bound.minimum) >= 0
      && compareExactDecimals(bound.value, bound.maximum) <= 0;
  } catch {
    return false;
  }
}

function integerBoundValid(
  bound: BasisSupervisionInput['policy']['fundingExitLeadTimeMs'],
  expectedUnit: typeof SUPERVISION_MILLISECONDS_UNIT | typeof SUPERVISION_COUNT_UNIT,
): boolean {
  return bound.unit === expectedUnit
    && Number.isSafeInteger(bound.value) && Number.isSafeInteger(bound.minimum) && Number.isSafeInteger(bound.maximum)
    && bound.minimum >= 0 && bound.maximum >= bound.minimum
    && bound.value >= bound.minimum && bound.value <= bound.maximum;
}

export function deriveBasisSupervisionPolicyRevision(
  policy: Readonly<BasisSupervisionPolicy>,
): BasisSupervisionPolicy['authority']['revision'] {
  const { authority, ...semantics } = policy;
  const { revision: _revision, ...authoritySemantics } = authority;
  return deriveCapitalConfigRevision('supervision.basis-policy', Object.freeze({ ...semantics, authority: authoritySemantics }));
}

export function basisSupervisionPolicyIsValid(input: BasisSupervisionInput): boolean {
  const policy = input.policy;
  try {
    return policyAuthorityCurrent(input.common, policy.authority)
      && policy.authority.revision === deriveBasisSupervisionPolicyRevision(policy)
      && [
        policy.minimumRemainingEdge,
        policy.minimumRemainingEdgeForAdd,
        policy.maximumAdverseBasisMove,
        policy.maximumAdverseFundingRate,
        policy.maximumBorrowRate,
        policy.maximumHedgeDrift,
        policy.minimumLiquidationDistance,
        policy.minimumMarginDistance,
        policy.maximumLiquidityDeterioration,
      ].every(exactBoundValid)
      && integerBoundValid(policy.fundingExitLeadTimeMs, SUPERVISION_MILLISECONDS_UNIT)
      && integerBoundValid(policy.requiredConvergingObservationsForAdd, SUPERVISION_COUNT_UNIT)
      && compareExactDecimals(policy.minimumRemainingEdgeForAdd.value, policy.minimumRemainingEdge.value) >= 0;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCanonicalExact(value: unknown): value is ExactDecimal {
  try {
    return normalizeExactDecimal(value) === value;
  } catch {
    return false;
  }
}

function isCanonicalNonNegative(value: unknown): value is NonNegativeDecimal {
  try {
    return normalizeNonNegativeExactDecimal(value) === value;
  } catch {
    return false;
  }
}

function exactOrNull(value: unknown): value is ExactDecimal | null {
  return value === null || isCanonicalExact(value);
}

function nonNegativeOrNull(value: unknown): value is NonNegativeDecimal | null {
  return value === null || isCanonicalNonNegative(value);
}

function isCanonicalEvidenceId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
}

function evidenceIdsValid(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isCanonicalEvidenceId);
}

function safeEvidenceIds(value: unknown): readonly string[] {
  return evidenceIdsValid(value) ? value : Object.freeze([]);
}

function isTruthLike(value: unknown): value is Readonly<TruthMetadata> {
  return isRecord(value);
}

function pathObservationValid(value: unknown, nowMs: number): value is Readonly<BasisPathObservation> {
  if (!isRecord(value)) return false;
  return isCanonicalExact(value.executableBasis)
    && isValidUtcMillis(value.observedAtMs)
    && value.observedAtMs <= nowMs
    && isTruthLike(value.truth)
    && isCanonicalEvidenceId(value.evidenceId);
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
  const policyValid = basisSupervisionPolicyIsValid(input);
  const rawBasis: unknown = input.basis;
  const basis = (isRecord(rawBasis) ? rawBasis : Object.freeze({})) as unknown as Readonly<BasisSpecificFacts>;
  const evidenceIds = safeEvidenceIds(basis.evidenceIds);
  const factShapeValid = isRecord(rawBasis) && isTruthLike(basis.truth) && evidenceIdsValid(basis.evidenceIds);
  const factTruthState = isTruthLike(basis.truth) ? supervisionTruthStateAt(basis.truth, input.common.nowMs) : 'UNKNOWN';
  const factsFresh = factShapeValid && supervisionTruthAllowsIncreaseAt(basis.truth, input.common.nowMs);

  const divergenceShapeValid = isCanonicalExact(basis.entryExecutableBasis) && isCanonicalExact(basis.currentExecutableBasis);
  let adverseMove: ExactDecimal | null = null;
  if (divergenceShapeValid) {
    const entryMagnitude = absoluteExactDecimal(basis.entryExecutableBasis);
    const currentMagnitude = absoluteExactDecimal(basis.currentExecutableBasis);
    const adverseMoveRaw = subtractExactDecimals(currentMagnitude, entryMagnitude);
    adverseMove = compareExactDecimals(adverseMoveRaw, '0' as ExactDecimal) > 0 ? adverseMoveRaw : '0' as ExactDecimal;
  }

  const pathShapeValid = Array.isArray(basis.convergencePath)
    && basis.convergencePath.length > 0
    && basis.convergencePath.every((item) => pathObservationValid(item, input.common.nowMs));
  const path = pathShapeValid
    ? basis.convergencePath as readonly Readonly<BasisPathObservation>[]
    : Object.freeze([] as Readonly<BasisPathObservation>[]);
  const pathFresh = pathShapeValid && path.every((item) => supervisionTruthAllowsIncreaseAt(item.truth, input.common.nowMs));
  const convergingCount = pathShapeValid ? pathConvergenceCount(path) : 0;

  const remainingShapeValid = exactOrNull(basis.expectedRemainingEdgeAfterExitCosts);
  const remaining = remainingShapeValid ? basis.expectedRemainingEdgeAfterExitCosts : null;

  const funding = isRecord(basis.funding) ? basis.funding : null;
  const fundingDirectionValid = funding !== null
    && (BASIS_FUNDING_DIRECTIONS as readonly unknown[]).includes(funding.direction);
  const fundingShapeValid = funding !== null
    && fundingDirectionValid
    && exactOrNull(funding.rate)
    && exactOrNull(funding.accruedFunding)
    && (funding.nextFundingAtMs === null || isValidUtcMillis(funding.nextFundingAtMs))
    && isTruthLike(funding.truth)
    && evidenceIdsValid(funding.evidenceIds);
  const fundingEvidenceIds = safeEvidenceIds(funding?.evidenceIds);
  let adverseFunding = false;
  if (policyValid && fundingShapeValid && funding.direction === 'PAID'
      && funding.rate !== null && funding.nextFundingAtMs !== null) {
    adverseFunding = compareExactDecimals(absoluteExactDecimal(funding.rate), input.policy.maximumAdverseFundingRate.value) > 0
      && funding.nextFundingAtMs <= input.common.nowMs + input.policy.fundingExitLeadTimeMs.value;
  }

  const borrow = isRecord(basis.borrow) ? basis.borrow : null;
  const borrowAvailabilityValid = borrow !== null
    && (BASIS_RESOURCE_AVAILABILITIES as readonly unknown[]).includes(borrow.availability);
  const borrowShapeValid = borrow !== null
    && borrowAvailabilityValid
    && nonNegativeOrNull(borrow.rate)
    && nonNegativeOrNull(borrow.accruedCost)
    && isTruthLike(borrow.truth)
    && evidenceIdsValid(borrow.evidenceIds);
  const borrowEvidenceIds = safeEvidenceIds(borrow?.evidenceIds);

  const hedgeDriftValid = nonNegativeOrNull(basis.hedgeDrift);
  const liquidationDistanceValid = nonNegativeOrNull(basis.liquidationDistance);
  const marginDistanceValid = nonNegativeOrNull(basis.marginDistance);
  const spotLiquidityValid = nonNegativeOrNull(basis.spotLiquidityDeterioration);
  const perpetualLiquidityValid = nonNegativeOrNull(basis.perpetualLiquidityDeterioration);
  const liquidityShapeValid = spotLiquidityValid && perpetualLiquidityValid;
  const liquidity = liquidityShapeValid
    && basis.spotLiquidityDeterioration !== null
    && basis.perpetualLiquidityDeterioration !== null
    ? compareExactDecimals(basis.spotLiquidityDeterioration, basis.perpetualLiquidityDeterioration) >= 0
      ? basis.spotLiquidityDeterioration
      : basis.perpetualLiquidityDeterioration
    : null;
  return Object.freeze([
    strategyCheck('BASIS_POLICY', policyValid ? 'PASS' : 'UNKNOWN', policyValid ? `content-addressed policy ${input.policy.authority.revision} is current, ratio-unit-bound, and bounded` : 'Basis policy is invalid, wrong-unit, content-mismatched, or not current'),
    strategyCheck('BASIS_FACT_FRESHNESS', factsFresh ? 'PASS' : factShapeValid && factTruthState === 'DIVERGENT' ? 'BREACH' : 'UNKNOWN', factShapeValid ? `${factTruthState}` : 'Basis aggregate truth or evidence collection is malformed', evidenceIds),
    strategyCheck('BASIS_PATH', !policyValid || !pathFresh ? 'UNKNOWN' : convergingCount >= input.policy.requiredConvergingObservationsForAdd.value ? 'PASS' : 'WATCH', pathFresh ? `${convergingCount} trailing converging observation(s)` : pathShapeValid ? 'basis path truth is stale or incomplete' : 'basis path collection, decimal, timestamp, truth, or evidence ID is malformed', path.map((item) => item.evidenceId)),
    strategyCheck('BASIS_DIVERGENCE', !policyValid || adverseMove === null ? 'UNKNOWN' : compareExactDecimals(adverseMove, input.policy.maximumAdverseBasisMove.value) > 0 ? 'BREACH' : 'PASS', adverseMove === null ? 'entry/current executable basis is malformed or non-canonical' : `adverse absolute-basis move ${adverseMove}`, evidenceIds),
    strategyCheck('BASIS_REMAINING_EDGE', !policyValid || !remainingShapeValid || remaining === null ? 'UNKNOWN' : compareExactDecimals(remaining, input.policy.minimumRemainingEdge.value) <= 0 ? 'BREACH' : compareExactDecimals(remaining, input.policy.minimumRemainingEdgeForAdd.value) < 0 ? 'WATCH' : 'PASS', !remainingShapeValid ? 'remaining edge is malformed or non-canonical' : remaining === null ? 'remaining edge is missing' : `remaining edge after exit costs ${remaining}`, evidenceIds),
    strategyCheck('BASIS_FUNDING', !policyValid || !fundingShapeValid || funding === null || !supervisionTruthAllowsIncreaseAt(funding.truth as Readonly<TruthMetadata>, input.common.nowMs) || funding.rate === null || funding.direction === 'UNKNOWN' || funding.nextFundingAtMs === null || funding.accruedFunding === null ? 'UNKNOWN' : adverseFunding ? 'BREACH' : 'PASS', !fundingShapeValid || funding === null ? 'funding decimal, direction, timestamp, truth, or evidence collection is malformed' : adverseFunding ? 'adverse funding exceeds policy before the next event' : `funding ${funding.direction}`, fundingEvidenceIds),
    strategyCheck('BASIS_BORROW', !policyValid || !borrowShapeValid || borrow === null || !supervisionTruthAllowsIncreaseAt(borrow.truth as Readonly<TruthMetadata>, input.common.nowMs) || borrow.availability === 'UNKNOWN' || (borrow.availability !== 'NOT_REQUIRED' && (borrow.rate === null || borrow.accruedCost === null)) ? 'UNKNOWN' : borrow.availability === 'RECALLED' || borrow.availability === 'UNAVAILABLE' ? 'BREACH' : borrow.rate !== null && compareExactDecimals(borrow.rate, input.policy.maximumBorrowRate.value) > 0 ? 'BREACH' : 'PASS', !borrowShapeValid || borrow === null ? 'resource availability, decimal, truth, or evidence collection is malformed' : `resource ${borrow.availability}${borrow.rate === null ? '' : ` rate ${borrow.rate}`}`, borrowEvidenceIds),
    strategyCheck('BASIS_HEDGE_DRIFT', !policyValid || !hedgeDriftValid || basis.hedgeDrift === null ? 'UNKNOWN' : compareExactDecimals(basis.hedgeDrift, input.policy.maximumHedgeDrift.value) > 0 ? 'BREACH' : 'PASS', !hedgeDriftValid ? 'hedge drift is malformed or non-canonical' : basis.hedgeDrift === null ? 'hedge drift missing' : `hedge drift ${basis.hedgeDrift}`, evidenceIds),
    strategyCheck('BASIS_LIQUIDATION_DISTANCE', !policyValid || !liquidationDistanceValid || basis.liquidationDistance === null ? 'UNKNOWN' : compareExactDecimals(basis.liquidationDistance, input.policy.minimumLiquidationDistance.value) < 0 ? 'BREACH' : 'PASS', !liquidationDistanceValid ? 'liquidation distance is malformed or non-canonical' : basis.liquidationDistance === null ? 'liquidation distance missing' : `liquidation distance ${basis.liquidationDistance}`, evidenceIds),
    strategyCheck('BASIS_MARGIN_DISTANCE', !policyValid || !marginDistanceValid || basis.marginDistance === null ? 'UNKNOWN' : compareExactDecimals(basis.marginDistance, input.policy.minimumMarginDistance.value) < 0 ? 'BREACH' : 'PASS', !marginDistanceValid ? 'margin distance is malformed or non-canonical' : basis.marginDistance === null ? 'margin distance missing' : `margin distance ${basis.marginDistance}`, evidenceIds),
    strategyCheck('BASIS_LIQUIDITY', !policyValid || !liquidityShapeValid || liquidity === null ? 'UNKNOWN' : compareExactDecimals(liquidity, input.policy.maximumLiquidityDeterioration.value) > 0 ? 'BREACH' : 'PASS', !liquidityShapeValid ? 'spot/perpetual liquidity deterioration is malformed or non-canonical' : liquidity === null ? 'spot/perpetual liquidity deterioration missing' : `worst liquidity deterioration ${liquidity}`, evidenceIds),
  ]);
}

function status(checks: readonly Readonly<SupervisionCheck>[], code: string) {
  return checks.find((item) => item.code === code)?.status ?? 'UNKNOWN';
}

function basisStrategyTruths(value: unknown): readonly Readonly<TruthMetadata>[] {
  if (!isRecord(value)) return Object.freeze([]);
  const candidates: unknown[] = [value.truth];
  if (isRecord(value.funding)) candidates.push(value.funding.truth);
  if (isRecord(value.borrow)) candidates.push(value.borrow.truth);
  if (Array.isArray(value.convergencePath)) {
    for (const observation of value.convergencePath) {
      if (isRecord(observation)) candidates.push(observation.truth);
    }
  }
  return Object.freeze(candidates.filter(isTruthLike));
}

export function superviseBasisPosition(input: BasisSupervisionInput): Readonly<SupervisionDecision> {
  if (input.common.position.thesis.strategy !== 'BASIS') throw new TypeError('Basis supervisor requires a BASIS position thesis');
  const universal = evaluateUniversalSupervision(input.common);
  const checks = appendChecks(universal.checks, basisChecks(input));
  const basis: Readonly<Record<string, unknown>> = isRecord(input.basis) ? input.basis : Object.freeze({});
  const borrow: Readonly<Record<string, unknown>> = isRecord(basis.borrow) ? basis.borrow : Object.freeze({});
  const basisEvidenceIds = safeEvidenceIds(basis.evidenceIds);
  const borrowEvidenceIds = safeEvidenceIds(borrow.evidenceIds);
  let directive: Readonly<IntentDirective> | null = universal.universalDirective;
  if (directive === null && (status(checks, 'BASIS_LIQUIDATION_DISTANCE') === 'BREACH' || status(checks, 'BASIS_MARGIN_DISTANCE') === 'BREACH' || borrow.availability === 'RECALLED')) directive = Object.freeze({ kind: 'REQUEST_EMERGENCY_UNWIND', urgency: 'EMERGENCY', reasons: Object.freeze(['BASIS_CAPITAL_SURVIVAL_LIMIT']), hardDeadlineMs: input.common.nowMs, evidenceIds: basisEvidenceIds });
  else if (directive === null && borrow.availability === 'UNAVAILABLE') directive = Object.freeze({ kind: 'REQUEST_EXIT', urgency: 'URGENT', reasons: Object.freeze(['BORROW_UNAVAILABLE']), hardDeadlineMs: input.common.nowMs, evidenceIds: borrowEvidenceIds });
  else if (directive === null && status(checks, 'BASIS_HEDGE_DRIFT') === 'BREACH') directive = Object.freeze({ kind: 'REQUEST_HEDGE', urgency: 'URGENT', reasons: Object.freeze(['BASIS_HEDGE_DRIFT']), hardDeadlineMs: input.common.nowMs, evidenceIds: basisEvidenceIds });
  else if (directive === null && (status(checks, 'BASIS_REMAINING_EDGE') === 'BREACH' || status(checks, 'BASIS_DIVERGENCE') === 'BREACH')) directive = Object.freeze({ kind: 'REQUEST_EXIT', urgency: 'URGENT', reasons: Object.freeze([status(checks, 'BASIS_REMAINING_EDGE') === 'BREACH' ? 'REMAINING_EDGE_EXHAUSTED' : 'BASIS_DIVERGENCE_INVALIDATION']), hardDeadlineMs: input.common.nowMs, evidenceIds: basisEvidenceIds });
  else if (directive === null && (status(checks, 'BASIS_FUNDING') === 'BREACH' || status(checks, 'BASIS_BORROW') === 'BREACH' || status(checks, 'BASIS_LIQUIDITY') === 'BREACH')) directive = Object.freeze({ kind: 'REDUCE', urgency: 'ELEVATED', reasons: Object.freeze(['BASIS_CARRY_OR_LIQUIDITY_DETERIORATION']), hardDeadlineMs: null, evidenceIds: basisEvidenceIds });
  else if (directive === null && checks.some((item) => item.status === 'UNKNOWN')) directive = Object.freeze({ kind: 'FREEZE_NEW_ACTIONS', urgency: 'ELEVATED', reasons: Object.freeze(['BASIS_REQUIRED_TRUTH_UNKNOWN']), hardDeadlineMs: null, evidenceIds: basisEvidenceIds });
  else if (directive === null && universal.allTruthAllowsIncrease && checks.every((item) => item.status === 'PASS')) directive = Object.freeze({ kind: 'ADD_STAGE', urgency: 'ROUTINE', reasons: Object.freeze(['BASIS_CONVERGENCE_AND_EDGE_SUPPORT_NEXT_STAGE']), hardDeadlineMs: null, evidenceIds: basisEvidenceIds });
  else if (directive === null) directive = Object.freeze({ kind: 'HOLD', urgency: 'ROUTINE', reasons: Object.freeze(['BASIS_THESIS_REMAINS_WITHIN_POLICY']), hardDeadlineMs: null, evidenceIds: basisEvidenceIds });
  return buildSupervisionDecision(
    'BASIS',
    input.common,
    checks,
    directive,
    basisStrategyTruths(input.basis),
    Object.freeze({ policy: input.policy, facts: input.basis }),
  );
}

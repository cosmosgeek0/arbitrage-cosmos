import {
  compareExactDecimals,
  policyBoundIsValid,
  truthAllowsNewExposure,
} from '../contracts/index.js';
import {
  appendChecks,
  buildSupervisionDecision,
  evaluateUniversalSupervision,
  policyAuthorityCurrent,
  signalStatus,
  strategyCheck,
  type IntentDirective,
} from './common.js';
import type { ExactEvidenceSignal, SupervisionCheck, SupervisionDecision, VolumeSupervisionInput } from './types.js';

function signalCheck(
  code: string,
  signal: Readonly<ExactEvidenceSignal>,
  threshold: VolumeSupervisionInput['policy']['maximumReversalStrength']['value'],
  breachWhenAbove: boolean,
): Readonly<SupervisionCheck> {
  if (!truthAllowsNewExposure(signal.truth)) return strategyCheck(code, signal.truth.completeness === 'DIVERGENT' ? 'BREACH' : 'UNKNOWN', `${signal.truth.completeness}/${signal.truth.freshness.state}`, signal.evidenceIds);
  const status = signalStatus(signal.state, signal.strength, threshold, breachWhenAbove);
  return strategyCheck(code, status, `${signal.state}${signal.strength === null ? '' : ` strength ${signal.strength}`}`, signal.evidenceIds);
}

function volumeChecks(input: VolumeSupervisionInput): readonly Readonly<SupervisionCheck>[] {
  const policyValid = policyAuthorityCurrent(input.common, input.policy.authority)
    && [
      input.policy.minimumContinuationStrength,
      input.policy.minimumAccelerationStrengthForAdd,
      input.policy.maximumExhaustionStrength,
      input.policy.maximumReversalStrength,
      input.policy.maximumCrowdingStrength,
      input.policy.maximumLiquidityDeterioration,
    ].every(policyBoundIsValid);
  const leadershipStatus = input.volume.leadership === 'UNKNOWN' ? 'UNKNOWN'
    : input.policy.reduceOnPerpetualLeadership && input.volume.leadership === 'PERPETUAL' ? 'BREACH'
      : input.policy.requireSpotLeadershipForAdd && input.volume.leadership !== 'SPOT' ? 'WATCH' : 'PASS';
  const liquidityStatus = input.volume.liquidityDeterioration === null ? 'UNKNOWN'
    : compareExactDecimals(input.volume.liquidityDeterioration, input.policy.maximumLiquidityDeterioration.value) > 0 ? 'BREACH' : 'PASS';
  const calibrationStatus = !truthAllowsNewExposure(input.volume.calibrationTruth) ? 'UNKNOWN'
    : input.volume.calibrationMode === 'MANUAL_ARMED' ? 'PASS' : 'WATCH';
  return Object.freeze([
    strategyCheck('VOLUME_POLICY', policyValid ? 'PASS' : 'UNKNOWN', policyValid ? `policy ${input.policy.authority.revision} is current and bounded` : 'Volume policy is invalid or not current'),
    strategyCheck('VOLUME_FACT_FRESHNESS', truthAllowsNewExposure(input.volume.truth) ? 'PASS' : input.volume.truth.completeness === 'DIVERGENT' ? 'BREACH' : 'UNKNOWN', `${input.volume.truth.completeness}/${input.volume.truth.freshness.state}`, input.volume.evidenceIds),
    strategyCheck('VOLUME_ORIGINAL_STAGE', input.volume.originalThesisStage.trim().length > 0 ? 'PASS' : 'UNKNOWN', input.volume.originalThesisStage.trim().length > 0 ? `original stage ${input.volume.originalThesisStage}` : 'original dormant-to-active stage missing'),
    signalCheck('VOLUME_CONTINUATION', input.volume.continuation, input.policy.minimumContinuationStrength.value, false),
    signalCheck('VOLUME_ACCELERATION', input.volume.acceleration, input.policy.minimumAccelerationStrengthForAdd.value, false),
    signalCheck('VOLUME_EXHAUSTION', input.volume.exhaustion, input.policy.maximumExhaustionStrength.value, true),
    signalCheck('VOLUME_REVERSAL', input.volume.reversal, input.policy.maximumReversalStrength.value, true),
    strategyCheck('VOLUME_LEADERSHIP', leadershipStatus, `leadership ${input.volume.leadership}`, input.volume.evidenceIds),
    strategyCheck('VOLUME_LIQUIDITY', liquidityStatus, input.volume.liquidityDeterioration === null ? 'liquidity deterioration missing' : `liquidity deterioration ${input.volume.liquidityDeterioration}`, input.volume.evidenceIds),
    signalCheck('VOLUME_CROWDING', input.volume.crowding, input.policy.maximumCrowdingStrength.value, true),
    strategyCheck('VOLUME_FUNDING_CONTEXT', input.volume.funding.state === 'UNKNOWN' || !truthAllowsNewExposure(input.volume.funding.truth) ? 'WATCH' : 'PASS', `funding context ${input.volume.funding.state}`, input.volume.funding.evidenceIds),
    strategyCheck('VOLUME_OPEN_INTEREST_CONTEXT', input.volume.openInterest.state === 'UNKNOWN' || !truthAllowsNewExposure(input.volume.openInterest.truth) ? 'WATCH' : 'PASS', `open-interest context ${input.volume.openInterest.state}`, input.volume.openInterest.evidenceIds),
    strategyCheck('VOLUME_FALSE_FOLLOW_THROUGH', input.volume.falseFollowThrough === null ? 'UNKNOWN' : input.volume.falseFollowThrough ? 'BREACH' : 'PASS', input.volume.falseFollowThrough === null ? 'false-follow-through assessment missing' : input.volume.falseFollowThrough ? 'false follow-through observed' : 'no false follow through observed', input.volume.evidenceIds),
    strategyCheck('VOLUME_WASH_LIKE', input.volume.washLike === null ? 'UNKNOWN' : input.volume.washLike ? 'BREACH' : 'PASS', input.volume.washLike === null ? 'wash-like assessment missing' : input.volume.washLike ? 'wash-like evidence observed' : 'no wash-like evidence observed', input.volume.evidenceIds),
    strategyCheck('VOLUME_CALIBRATION_MODE', calibrationStatus, `${input.volume.calibrationMode}/${input.volume.calibrationTruth.completeness}`, input.volume.evidenceIds),
  ]);
}

function status(checks: readonly Readonly<SupervisionCheck>[], code: string) {
  return checks.find((item) => item.code === code)?.status ?? 'UNKNOWN';
}

export function superviseVolumePosition(input: VolumeSupervisionInput): Readonly<SupervisionDecision> {
  if (input.common.position.thesis.strategy !== 'VOLUME') throw new TypeError('Volume supervisor requires a VOLUME position thesis');
  const universal = evaluateUniversalSupervision(input.common);
  const checks = appendChecks(universal.checks, volumeChecks(input));
  let directive: Readonly<IntentDirective> | null = universal.universalDirective;
  if (directive === null && (status(checks, 'VOLUME_REVERSAL') === 'BREACH' || status(checks, 'VOLUME_FALSE_FOLLOW_THROUGH') === 'BREACH' || status(checks, 'VOLUME_WASH_LIKE') === 'BREACH')) directive = Object.freeze({ kind: 'REQUEST_EXIT', urgency: 'URGENT', reasons: Object.freeze(['VOLUME_THESIS_REVERSAL_OR_FALSE_FOLLOW_THROUGH']), hardDeadlineMs: input.common.nowMs, evidenceIds: input.volume.evidenceIds });
  else if (directive === null && (status(checks, 'VOLUME_EXHAUSTION') === 'BREACH' || status(checks, 'VOLUME_CROWDING') === 'BREACH' || status(checks, 'VOLUME_LIQUIDITY') === 'BREACH' || status(checks, 'VOLUME_LEADERSHIP') === 'BREACH' || status(checks, 'VOLUME_CONTINUATION') === 'BREACH')) directive = Object.freeze({ kind: 'REDUCE', urgency: 'ELEVATED', reasons: Object.freeze(['VOLUME_CONTINUATION_OR_CAPACITY_DETERIORATED']), hardDeadlineMs: null, evidenceIds: input.volume.evidenceIds });
  else if (directive === null && checks.some((item) => item.status === 'UNKNOWN')) directive = Object.freeze({ kind: 'FREEZE_NEW_ACTIONS', urgency: 'ELEVATED', reasons: Object.freeze(['VOLUME_REQUIRED_TRUTH_UNKNOWN']), hardDeadlineMs: null, evidenceIds: input.volume.evidenceIds });
  else if (directive === null && checks.some((item) => item.status === 'BREACH')) directive = Object.freeze({ kind: 'FREEZE_NEW_ACTIONS', urgency: 'ELEVATED', reasons: Object.freeze(['VOLUME_UNHANDLED_BREACH_BLOCKS_INCREASE']), hardDeadlineMs: null, evidenceIds: input.volume.evidenceIds });
  else if (directive === null && universal.allTruthAllowsIncrease
    && !checks.some((item) => item.status === 'UNKNOWN' || item.status === 'BREACH')
    && input.volume.calibrationMode === 'MANUAL_ARMED'
    && status(checks, 'VOLUME_CONTINUATION') === 'PASS'
    && status(checks, 'VOLUME_ACCELERATION') === 'PASS'
    && status(checks, 'VOLUME_EXHAUSTION') === 'PASS'
    && status(checks, 'VOLUME_REVERSAL') === 'PASS'
    && status(checks, 'VOLUME_CROWDING') === 'PASS'
    && (!input.policy.requireSpotLeadershipForAdd || input.volume.leadership === 'SPOT')) directive = Object.freeze({ kind: 'ADD_STAGE', urgency: 'ROUTINE', reasons: Object.freeze(['VOLUME_CONTINUATION_ACCELERATION_AND_CALIBRATION_SUPPORT_NEXT_STAGE']), hardDeadlineMs: null, evidenceIds: input.volume.evidenceIds });
  else if (directive === null) directive = Object.freeze({ kind: 'HOLD', urgency: 'ROUTINE', reasons: Object.freeze([input.volume.calibrationMode === 'MANUAL_ARMED' ? 'VOLUME_THESIS_REMAINS_WITHIN_POLICY' : 'VOLUME_CALIBRATION_MODE_FORBIDS_ADD']), hardDeadlineMs: null, evidenceIds: input.volume.evidenceIds });
  return buildSupervisionDecision(
    'VOLUME',
    input.common,
    checks,
    directive,
    Object.freeze([
      input.volume.truth,
      input.volume.calibrationTruth,
      input.volume.continuation.truth,
      input.volume.acceleration.truth,
      input.volume.exhaustion.truth,
      input.volume.reversal.truth,
      input.volume.crowding.truth,
      input.volume.funding.truth,
      input.volume.openInterest.truth,
    ]),
    Object.freeze({ policy: input.policy, facts: input.volume }),
  );
}

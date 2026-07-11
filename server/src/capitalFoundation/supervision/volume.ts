import {
  compareExactDecimals,
  deriveCapitalConfigRevision,
  normalizeNonNegativeExactDecimal,
  type ExactDecimal,
  type ExactPolicyBound,
  type NonNegativeDecimal,
  type TruthMetadata,
} from '../contracts/index.js';
import {
  appendChecks,
  buildSupervisionDecision,
  evaluateUniversalSupervision,
  policyAuthorityCurrent,
  signalStatus,
  supervisionTruthAllowsIncreaseAt,
  supervisionTruthStateAt,
  SUPERVISION_RATIO_UNIT,
  strategyCheck,
  type IntentDirective,
} from './common.js';
import {
  EXACT_EVIDENCE_SIGNAL_STATES,
  VOLUME_CALIBRATION_MODES,
  VOLUME_LEADERSHIP_STATES,
  type ExactEvidenceSignal,
  type SupervisionCheck,
  type SupervisionDecision,
  type VolumeSupervisionInput,
  type VolumeSupervisionPolicy,
} from './types.js';

const ZERO = '0' as NonNegativeDecimal;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCanonicalNonNegative(value: unknown): value is NonNegativeDecimal {
  try {
    return normalizeNonNegativeExactDecimal(value) === value;
  } catch {
    return false;
  }
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

export function deriveVolumeSupervisionPolicyRevision(
  policy: Readonly<VolumeSupervisionPolicy>,
): VolumeSupervisionPolicy['authority']['revision'] {
  const { authority, ...semantics } = policy;
  const { revision: _revision, ...authoritySemantics } = authority;
  return deriveCapitalConfigRevision('supervision.volume-policy', Object.freeze({ ...semantics, authority: authoritySemantics }));
}

export function volumeSupervisionPolicyIsValid(input: VolumeSupervisionInput): boolean {
  const policy = input.policy;
  try {
    return policyAuthorityCurrent(input.common, policy.authority)
      && policy.authority.revision === deriveVolumeSupervisionPolicyRevision(policy)
      && [
        policy.minimumContinuationStrength,
        policy.minimumAccelerationStrengthForAdd,
        policy.maximumExhaustionStrength,
        policy.maximumReversalStrength,
        policy.maximumCrowdingStrength,
        policy.maximumLiquidityDeterioration,
      ].every(exactBoundValid)
      && typeof policy.requireSpotLeadershipForAdd === 'boolean'
      && typeof policy.reduceOnPerpetualLeadership === 'boolean';
  } catch {
    return false;
  }
}

function signalCheck(
  code: string,
  signal: unknown,
  threshold: ExactDecimal,
  breachWhenAbove: boolean,
  nowMs: number,
  policyValid: boolean,
): Readonly<SupervisionCheck> {
  if (!isRecord(signal)) return strategyCheck(code, 'UNKNOWN', 'signal object is malformed');
  const evidenceIds = safeEvidenceIds(signal.evidenceIds);
  if (!(EXACT_EVIDENCE_SIGNAL_STATES as readonly unknown[]).includes(signal.state)
      || !nonNegativeOrNull(signal.strength)
      || !isTruthLike(signal.truth)
      || !evidenceIdsValid(signal.evidenceIds)) {
    return strategyCheck(code, 'UNKNOWN', 'signal state, strength, truth, or evidence collection is malformed', evidenceIds);
  }
  const state = signal.state as ExactEvidenceSignal['state'];
  const strength = signal.strength as ExactEvidenceSignal['strength'];
  const truth = signal.truth as Readonly<TruthMetadata>;
  if (!supervisionTruthAllowsIncreaseAt(truth, nowMs)) return strategyCheck(code, supervisionTruthStateAt(truth, nowMs) === 'DIVERGENT' ? 'BREACH' : 'UNKNOWN', `${supervisionTruthStateAt(truth, nowMs)}`, evidenceIds);
  if (!policyValid) return strategyCheck(code, 'UNKNOWN', 'signal policy threshold is invalid', evidenceIds);
  const status = signalStatus(state, strength, threshold, breachWhenAbove);
  return strategyCheck(code, status, `${state}${strength === null ? '' : ` strength ${strength}`}`, evidenceIds);
}

function contextSignalCheck(code: string, label: string, signal: unknown, nowMs: number): Readonly<SupervisionCheck> {
  if (!isRecord(signal)) return strategyCheck(code, 'UNKNOWN', `${label} signal object is malformed`);
  const evidenceIds = safeEvidenceIds(signal.evidenceIds);
  if (!(EXACT_EVIDENCE_SIGNAL_STATES as readonly unknown[]).includes(signal.state)
      || !nonNegativeOrNull(signal.strength)
      || !isTruthLike(signal.truth)
      || !evidenceIdsValid(signal.evidenceIds)) {
    return strategyCheck(code, 'UNKNOWN', `${label} state, strength, truth, or evidence collection is malformed`, evidenceIds);
  }
  const truth = signal.truth as Readonly<TruthMetadata>;
  if (!supervisionTruthAllowsIncreaseAt(truth, nowMs)) return strategyCheck(code, 'UNKNOWN', `${label} truth is stale or incomplete`, evidenceIds);
  return strategyCheck(code, signal.state === 'UNKNOWN' ? 'WATCH' : 'PASS', `${label} ${signal.state}`, evidenceIds);
}

function policyThreshold(bound: unknown): ExactDecimal {
  return isRecord(bound) && isCanonicalNonNegative(bound.value) ? bound.value : ZERO;
}

function volumeChecks(input: VolumeSupervisionInput): readonly Readonly<SupervisionCheck>[] {
  const policyValid = volumeSupervisionPolicyIsValid(input);
  const rawVolume: unknown = input.volume;
  const volume = (isRecord(rawVolume) ? rawVolume : Object.freeze({})) as Readonly<Record<string, unknown>>;
  const evidenceIds = safeEvidenceIds(volume.evidenceIds);
  const factShapeValid = isRecord(rawVolume) && isTruthLike(volume.truth) && evidenceIdsValid(volume.evidenceIds);
  const factTruthState = isTruthLike(volume.truth) ? supervisionTruthStateAt(volume.truth, input.common.nowMs) : 'UNKNOWN';
  const factsFresh = factShapeValid && supervisionTruthAllowsIncreaseAt(volume.truth as Readonly<TruthMetadata>, input.common.nowMs);
  const originalStageValid = isCanonicalEvidenceId(volume.originalThesisStage);
  const leadershipValid = (VOLUME_LEADERSHIP_STATES as readonly unknown[]).includes(volume.leadership);
  const calibrationModeValid = (VOLUME_CALIBRATION_MODES as readonly unknown[]).includes(volume.calibrationMode);
  const falseFollowThroughValid = volume.falseFollowThrough === null || typeof volume.falseFollowThrough === 'boolean';
  const washLikeValid = volume.washLike === null || typeof volume.washLike === 'boolean';
  const leadershipStatus = !policyValid || !leadershipValid || volume.leadership === 'UNKNOWN' ? 'UNKNOWN'
    : input.policy.reduceOnPerpetualLeadership && volume.leadership === 'PERPETUAL' ? 'BREACH'
      : input.policy.requireSpotLeadershipForAdd && volume.leadership !== 'SPOT' ? 'WATCH' : 'PASS';
  const liquidityValid = nonNegativeOrNull(volume.liquidityDeterioration);
  const liquidity = liquidityValid ? volume.liquidityDeterioration as NonNegativeDecimal | null : null;
  const liquidityStatus = !policyValid || liquidity === null ? 'UNKNOWN'
    : compareExactDecimals(liquidity, input.policy.maximumLiquidityDeterioration.value) > 0 ? 'BREACH' : 'PASS';
  const calibrationTruthValid = isTruthLike(volume.calibrationTruth);
  const calibrationStatus = !calibrationModeValid || !calibrationTruthValid || !supervisionTruthAllowsIncreaseAt(volume.calibrationTruth as Readonly<TruthMetadata>, input.common.nowMs) ? 'UNKNOWN'
    : volume.calibrationMode === 'MANUAL_ARMED' ? 'PASS' : 'WATCH';
  return Object.freeze([
    strategyCheck('VOLUME_POLICY', policyValid ? 'PASS' : 'UNKNOWN', policyValid ? `content-addressed policy ${input.policy.authority.revision} is current, ratio-unit-bound, and bounded` : 'Volume policy is invalid, wrong-unit, content-mismatched, or not current'),
    strategyCheck('VOLUME_FACT_FRESHNESS', factsFresh ? 'PASS' : factShapeValid && factTruthState === 'DIVERGENT' ? 'BREACH' : 'UNKNOWN', factShapeValid ? `${factTruthState}` : 'Volume aggregate truth or evidence collection is malformed', evidenceIds),
    strategyCheck('VOLUME_ORIGINAL_STAGE', originalStageValid ? 'PASS' : 'UNKNOWN', originalStageValid ? `original stage ${volume.originalThesisStage}` : 'original dormant-to-active stage is missing or malformed'),
    signalCheck('VOLUME_CONTINUATION', volume.continuation, policyThreshold(input.policy.minimumContinuationStrength), false, input.common.nowMs, policyValid),
    signalCheck('VOLUME_ACCELERATION', volume.acceleration, policyThreshold(input.policy.minimumAccelerationStrengthForAdd), false, input.common.nowMs, policyValid),
    signalCheck('VOLUME_EXHAUSTION', volume.exhaustion, policyThreshold(input.policy.maximumExhaustionStrength), true, input.common.nowMs, policyValid),
    signalCheck('VOLUME_REVERSAL', volume.reversal, policyThreshold(input.policy.maximumReversalStrength), true, input.common.nowMs, policyValid),
    strategyCheck('VOLUME_LEADERSHIP', leadershipStatus, leadershipValid ? `leadership ${volume.leadership}` : 'leadership is outside the runtime vocabulary', evidenceIds),
    strategyCheck('VOLUME_LIQUIDITY', liquidityStatus, !liquidityValid ? 'liquidity deterioration is malformed or non-canonical' : volume.liquidityDeterioration === null ? 'liquidity deterioration missing' : `liquidity deterioration ${volume.liquidityDeterioration}`, evidenceIds),
    signalCheck('VOLUME_CROWDING', volume.crowding, policyThreshold(input.policy.maximumCrowdingStrength), true, input.common.nowMs, policyValid),
    contextSignalCheck('VOLUME_FUNDING_CONTEXT', 'funding context', volume.funding, input.common.nowMs),
    contextSignalCheck('VOLUME_OPEN_INTEREST_CONTEXT', 'open-interest context', volume.openInterest, input.common.nowMs),
    strategyCheck('VOLUME_FALSE_FOLLOW_THROUGH', !falseFollowThroughValid || volume.falseFollowThrough === null ? 'UNKNOWN' : volume.falseFollowThrough ? 'BREACH' : 'PASS', !falseFollowThroughValid ? 'false-follow-through assessment must be a boolean or null' : volume.falseFollowThrough === null ? 'false-follow-through assessment missing' : volume.falseFollowThrough ? 'false follow-through observed' : 'no false follow through observed', evidenceIds),
    strategyCheck('VOLUME_WASH_LIKE', !washLikeValid || volume.washLike === null ? 'UNKNOWN' : volume.washLike ? 'BREACH' : 'PASS', !washLikeValid ? 'wash-like assessment must be a boolean or null' : volume.washLike === null ? 'wash-like assessment missing' : volume.washLike ? 'wash-like evidence observed' : 'no wash-like evidence observed', evidenceIds),
    strategyCheck('VOLUME_CALIBRATION_MODE', calibrationStatus, calibrationModeValid && calibrationTruthValid ? `${volume.calibrationMode}/${(volume.calibrationTruth as Readonly<TruthMetadata>).completeness}` : 'calibration mode or truth is malformed', evidenceIds),
  ]);
}

function status(checks: readonly Readonly<SupervisionCheck>[], code: string) {
  return checks.find((item) => item.code === code)?.status ?? 'UNKNOWN';
}

function volumeStrategyTruths(value: unknown): readonly Readonly<TruthMetadata>[] {
  if (!isRecord(value)) return Object.freeze([]);
  const candidates: unknown[] = [value.truth, value.calibrationTruth];
  for (const key of ['continuation', 'acceleration', 'exhaustion', 'reversal', 'crowding', 'funding', 'openInterest'] as const) {
    const signal = value[key];
    if (isRecord(signal)) candidates.push(signal.truth);
  }
  return Object.freeze(candidates.filter(isTruthLike));
}

export function superviseVolumePosition(input: VolumeSupervisionInput): Readonly<SupervisionDecision> {
  if (input.common.position.thesis.strategy !== 'VOLUME') throw new TypeError('Volume supervisor requires a VOLUME position thesis');
  const universal = evaluateUniversalSupervision(input.common);
  const checks = appendChecks(universal.checks, volumeChecks(input));
  const volume: Readonly<Record<string, unknown>> = isRecord(input.volume) ? input.volume : Object.freeze({});
  const evidenceIds = safeEvidenceIds(volume.evidenceIds);
  let directive: Readonly<IntentDirective> | null = universal.universalDirective;
  if (directive === null && (status(checks, 'VOLUME_REVERSAL') === 'BREACH' || status(checks, 'VOLUME_FALSE_FOLLOW_THROUGH') === 'BREACH' || status(checks, 'VOLUME_WASH_LIKE') === 'BREACH')) directive = Object.freeze({ kind: 'REQUEST_EXIT', urgency: 'URGENT', reasons: Object.freeze(['VOLUME_THESIS_REVERSAL_OR_FALSE_FOLLOW_THROUGH']), hardDeadlineMs: input.common.nowMs, evidenceIds });
  else if (directive === null && (status(checks, 'VOLUME_EXHAUSTION') === 'BREACH' || status(checks, 'VOLUME_CROWDING') === 'BREACH' || status(checks, 'VOLUME_LIQUIDITY') === 'BREACH' || status(checks, 'VOLUME_LEADERSHIP') === 'BREACH' || status(checks, 'VOLUME_CONTINUATION') === 'BREACH')) directive = Object.freeze({ kind: 'REDUCE', urgency: 'ELEVATED', reasons: Object.freeze(['VOLUME_CONTINUATION_OR_CAPACITY_DETERIORATED']), hardDeadlineMs: null, evidenceIds });
  else if (directive === null && checks.some((item) => item.status === 'UNKNOWN')) directive = Object.freeze({ kind: 'FREEZE_NEW_ACTIONS', urgency: 'ELEVATED', reasons: Object.freeze(['VOLUME_REQUIRED_TRUTH_UNKNOWN']), hardDeadlineMs: null, evidenceIds });
  else if (directive === null && checks.some((item) => item.status === 'BREACH')) directive = Object.freeze({ kind: 'FREEZE_NEW_ACTIONS', urgency: 'ELEVATED', reasons: Object.freeze(['VOLUME_UNHANDLED_BREACH_BLOCKS_INCREASE']), hardDeadlineMs: null, evidenceIds });
  else if (directive === null && universal.allTruthAllowsIncrease
    && !checks.some((item) => item.status === 'UNKNOWN' || item.status === 'BREACH')
    && volume.calibrationMode === 'MANUAL_ARMED'
    && status(checks, 'VOLUME_CONTINUATION') === 'PASS'
    && status(checks, 'VOLUME_ACCELERATION') === 'PASS'
    && status(checks, 'VOLUME_EXHAUSTION') === 'PASS'
    && status(checks, 'VOLUME_REVERSAL') === 'PASS'
    && status(checks, 'VOLUME_CROWDING') === 'PASS'
    && (!input.policy.requireSpotLeadershipForAdd || volume.leadership === 'SPOT')) directive = Object.freeze({ kind: 'ADD_STAGE', urgency: 'ROUTINE', reasons: Object.freeze(['VOLUME_CONTINUATION_ACCELERATION_AND_CALIBRATION_SUPPORT_NEXT_STAGE']), hardDeadlineMs: null, evidenceIds });
  else if (directive === null) directive = Object.freeze({ kind: 'HOLD', urgency: 'ROUTINE', reasons: Object.freeze([volume.calibrationMode === 'MANUAL_ARMED' ? 'VOLUME_THESIS_REMAINS_WITHIN_POLICY' : 'VOLUME_CALIBRATION_MODE_FORBIDS_ADD']), hardDeadlineMs: null, evidenceIds });
  return buildSupervisionDecision(
    'VOLUME',
    input.common,
    checks,
    directive,
    volumeStrategyTruths(input.volume),
    Object.freeze({ policy: input.policy, facts: input.volume }),
  );
}

import {
  ATTENTION_TIERS,
  FAILURE_CODES,
  makeStableFailure,
  sortedUnique,
  stableId,
  stableSetId,
  validateNoSecretFields,
  validateTruthMetadata,
  type AttentionRequest,
  type AttentionTier,
  type CandidateState,
  type EvidenceKind,
  type StableFailure,
  type StrategyCandidateHint,
  type TruthMetadata,
  type ValidationResult,
} from '../contracts/index.js';
import { attentionConfig, type AttentionPlannerConfig } from './config.js';
import {
  FOCUS_ELIGIBILITY_STATES,
  SOURCE_QUALITY_STATES,
  type AttentionAllocation,
  type AttentionInstrument,
  type AttentionPlan,
  type AttentionPlanResult,
  type AttentionPlanningInput,
  type AttentionTierCounts,
  type IgnoredCandidateHint,
  type SourceQualityState,
  type StrategyCandidateHintPort,
} from './types.js';

const MAX_OUTPUT_RECORD_IDS = 256;
const MAX_OUTPUT_SOURCE_SET = 64;
const MAX_OUTPUT_TRANSFORMS = 64;

const ACTIVE_TIERS = ['UNIVERSE', 'WATCH', 'CANDIDATE', 'FOCUS', 'DEEP_FOCUS'] as const;
type ActiveAttentionTier = (typeof ACTIVE_TIERS)[number];

const ACTIVE_RANK: Record<ActiveAttentionTier, number> = {
  UNIVERSE: 0,
  WATCH: 1,
  CANDIDATE: 2,
  FOCUS: 3,
  DEEP_FOCUS: 4,
};

const HINT_STATE_TARGET: Record<StrategyCandidateHint['sourceState'], AttentionTier> = {
  WATCHING: 'WATCH',
  FOCUS: 'FOCUS',
  PROPOSED: 'DEEP_FOCUS',
  ACTIVE: 'DEEP_FOCUS',
  COOLDOWN: 'RELEASED',
  UNKNOWN: 'UNIVERSE',
};

const QUALITY_PRIORITY: Record<SourceQualityState, number> = {
  HEALTHY: 4,
  DEGRADED: 3,
  STALE: 2,
  UNKNOWN: 1,
  FAILED: 0,
};

interface HintSummary {
  fresh: StrategyCandidateHint[];
  hintIds: string[];
  priority: number | null;
  desiredTier: AttentionTier;
  latestSignalAtMs: number | null;
  protected: boolean;
  reasonCodes: string[];
}

interface WorkingAllocation {
  instrument: AttentionInstrument;
  previous: AttentionAllocation | null;
  summary: HintSummary;
  tier: AttentionTier;
  desiredTier: AttentionTier;
  protected: boolean;
  operatorPinned: boolean;
  priority: number | null;
  hintIds: string[];
  lastSignalAtMs: number | null;
  cooldownUntilMs: number | null;
  promotionReasons: string[];
  demotionReasons: string[];
  sourceQuality: SourceQualityState;
}

function fail(
  code: StableFailure['code'],
  message: string,
  field: string | null,
  evidenceIds: string[] = [],
): AttentionPlanResult {
  return { ok: false, failure: makeStableFailure(code, 'intelligence.attention', message, field, evidenceIds) };
}

function isSafeTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 256 && value.every(isNonEmptyString);
}

function truthIsBounded(truth: TruthMetadata): boolean {
  return truth.provenance.sourceRecordIds.length <= 256 &&
    truth.provenance.sourceSet.length <= 64 &&
    truth.provenance.transforms.length <= 64 &&
    truth.completeness.observedFields.length <= 256 &&
    truth.completeness.missingFields.length <= 256 &&
    truth.completeness.reasonCodes.length <= 256;
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rank(tier: AttentionTier): number {
  return tier === 'RELEASED' ? -1 : ACTIVE_RANK[tier];
}

function activeTierAt(value: number): ActiveAttentionTier {
  return ACTIVE_TIERS[Math.max(0, Math.min(ACTIVE_TIERS.length - 1, value))];
}

function higherTier(left: AttentionTier, right: AttentionTier): AttentionTier {
  return rank(left) >= rank(right) ? left : right;
}

function lowerActiveTier(left: AttentionTier, right: ActiveAttentionTier): ActiveAttentionTier {
  if (left === 'RELEASED') return 'UNIVERSE';
  return activeTierAt(Math.min(rank(left), rank(right)));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function copyEvidence(values: readonly EvidenceKind[]): EvidenceKind[] {
  return sortedUnique(values) as EvidenceKind[];
}

function basisTime(truth: TruthMetadata): number | null {
  switch (truth.freshness.basis) {
    case 'SOURCE_EVENT_TIME': return truth.temporal.sourceEventTimeMs;
    case 'SOURCE_TRANSACTION_TIME': return truth.temporal.sourceTransactionTimeMs;
    case 'RECEIVE_TIME': return truth.temporal.receivedTimeMs;
    case 'UNAVAILABLE': return null;
  }
}

function truthHasFutureTime(truth: TruthMetadata, atMs: number): boolean {
  return [
    truth.temporal.sourceEventTimeMs,
    truth.temporal.sourceTransactionTimeMs,
    truth.temporal.receivedTimeMs,
    truth.freshness.evaluatedAtMs,
  ].some((time) => time !== null && time > atMs);
}

function hintTruthExpired(hint: StrategyCandidateHint, atMs: number, config: AttentionPlannerConfig): boolean {
  const truth = hint.truth;
  const declaredMaximum = truth.freshness.maxAgeMs ?? config.hintStaleAfterMs;
  const maximumAge = Math.min(config.hintStaleAfterMs, declaredMaximum);
  return [
    truth.temporal.sourceEventTimeMs,
    truth.temporal.sourceTransactionTimeMs,
    truth.temporal.receivedTimeMs,
    truth.freshness.evaluatedAtMs,
    hint.engineObservedAtMs,
  ].some((time) => time !== null && atMs - time > maximumAge);
}

function effectiveSourceQuality(instrument: AttentionInstrument, atMs: number): SourceQualityState {
  const declared = instrument.sourceQuality.state;
  if (declared === 'FAILED' || declared === 'STALE' || declared === 'UNKNOWN') return declared;
  const truth = instrument.truth;
  if (truth.completeness.state === 'MISSING' || truth.freshness.state === 'UNAVAILABLE') return 'FAILED';
  if (truth.completeness.state === 'UNKNOWN' || truth.freshness.state === 'UNKNOWN') return 'UNKNOWN';
  if (truth.freshness.state === 'STALE') return 'STALE';
  const timestamp = basisTime(truth);
  const maximumAge = truth.freshness.maxAgeMs;
  if (timestamp === null || maximumAge === null || timestamp > atMs || atMs - timestamp > maximumAge) return 'STALE';
  if (declared === 'DEGRADED' || truth.completeness.state === 'PARTIAL') return 'DEGRADED';
  return 'HEALTHY';
}

function validateHint(hint: StrategyCandidateHint): ValidationResult<StrategyCandidateHint> {
  const secret = validateNoSecretFields(hint, 'attention_hint');
  if (!secret.ok) return secret as ValidationResult<StrategyCandidateHint>;
  if (
    !isNonEmptyString(hint.id) ||
    !['basis', 'volume_spike', 'other'].includes(hint.strategy) ||
    !isNonEmptyString(hint.instrumentId) ||
    !isNonEmptyString(hint.symbol) ||
    !Object.hasOwn(HINT_STATE_TARGET, hint.sourceState) ||
    !isSafeTime(hint.engineObservedAtMs) ||
    !(hint.priority === null || typeof hint.priority === 'number' && Number.isFinite(hint.priority)) ||
    !isStringArray(hint.reasonCodes) ||
    typeof hint.protected !== 'boolean' ||
    !(hint.upstreamCorrelationId === null || isNonEmptyString(hint.upstreamCorrelationId))
  ) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', 'intelligence.attention', 'invalid strategy candidate hint', 'hints', [hint.id].filter(isNonEmptyString)) };
  }
  const truth = validateTruthMetadata(hint.truth);
  if (!truth.ok) return truth as ValidationResult<StrategyCandidateHint>;
  if (!truthIsBounded(truth.value)) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', 'intelligence.attention', 'candidate hint truth exceeds planner bounds', 'hints.truth', [hint.id]) };
  }
  return { ok: true, value: { ...hint, reasonCodes: sortedUnique(hint.reasonCodes), truth: truth.value } };
}

function validateAllocation(allocation: AttentionAllocation): ValidationResult<AttentionAllocation> {
  const secret = validateNoSecretFields(allocation, 'attention_allocation');
  if (!secret.ok) return secret as ValidationResult<AttentionAllocation>;
  if (
    !isNonEmptyString(allocation.id) ||
    !isNonEmptyString(allocation.instrumentId) ||
    !isNonEmptyString(allocation.symbol) ||
    !ATTENTION_TIERS.includes(allocation.tier) ||
    !ATTENTION_TIERS.includes(allocation.desiredTier) ||
    !isSafeTime(allocation.enteredAtMs) ||
    !isSafeTime(allocation.lastChangedAtMs) ||
    allocation.enteredAtMs > allocation.lastChangedAtMs ||
    typeof allocation.protected !== 'boolean' ||
    !(allocation.priority === null || typeof allocation.priority === 'number' && Number.isFinite(allocation.priority)) ||
    !isStringArray(allocation.promotionReasons) ||
    !isStringArray(allocation.demotionReasons) ||
    !isStringArray(allocation.requestedEvidence) ||
    !isStringArray(allocation.requestedFeatures) ||
    !isStringArray(allocation.hintIds) ||
    !(allocation.lastSignalAtMs === null || isSafeTime(allocation.lastSignalAtMs)) ||
    !(allocation.cooldownUntilMs === null || isSafeTime(allocation.cooldownUntilMs)) ||
    !(allocation.candidateOpenedAtMs === null || isSafeTime(allocation.candidateOpenedAtMs)) ||
    !allocation.focusEligibility ||
    !FOCUS_ELIGIBILITY_STATES.includes(allocation.focusEligibility.state) ||
    !isStringArray(allocation.focusEligibility.reasonCodes) ||
    (allocation.focusEligibility.state !== 'ELIGIBLE' && allocation.focusEligibility.reasonCodes.length === 0) ||
    !SOURCE_QUALITY_STATES.includes(allocation.sourceQuality)
  ) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', 'intelligence.attention', 'invalid previous attention allocation', 'previousAllocations', [allocation.id].filter(isNonEmptyString)) };
  }
  const truth = validateTruthMetadata(allocation.truth);
  if (!truth.ok) return truth as ValidationResult<AttentionAllocation>;
  if (!truthIsBounded(truth.value)) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', 'intelligence.attention', 'previous allocation truth exceeds planner bounds', 'previousAllocations.truth', [allocation.id]) };
  }
  return { ok: true, value: { ...allocation, truth: truth.value } };
}

function validateInstrument(instrument: AttentionInstrument, atMs: number): ValidationResult<AttentionInstrument> {
  const secret = validateNoSecretFields(instrument, 'attention_instrument');
  if (!secret.ok) return secret as ValidationResult<AttentionInstrument>;
  if (
    !isNonEmptyString(instrument.instrumentId) ||
    !isNonEmptyString(instrument.symbol) ||
    !(instrument.operatorPinned === undefined || typeof instrument.operatorPinned === 'boolean') ||
    typeof instrument.protectedCapital !== 'boolean' ||
    typeof instrument.releaseRequested !== 'boolean' ||
    !isStringArray(instrument.releaseReasonCodes) ||
    !instrument.focusEligibility ||
    !FOCUS_ELIGIBILITY_STATES.includes(instrument.focusEligibility.state) ||
    !isStringArray(instrument.focusEligibility.reasonCodes) ||
    (instrument.focusEligibility.state !== 'ELIGIBLE' && instrument.focusEligibility.reasonCodes.length === 0) ||
    !instrument.sourceQuality ||
    !SOURCE_QUALITY_STATES.includes(instrument.sourceQuality.state) ||
    !isStringArray(instrument.sourceQuality.reasonCodes)
  ) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', 'intelligence.attention', 'invalid attention instrument', 'instruments') };
  }
  const truth = validateTruthMetadata(instrument.truth);
  if (!truth.ok) return truth as ValidationResult<AttentionInstrument>;
  if (!truthIsBounded(truth.value)) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', 'intelligence.attention', 'instrument truth exceeds planner bounds', 'instruments.truth') };
  }
  if (truth.value.temporal.receivedTimeMs > atMs || truth.value.freshness.evaluatedAtMs > atMs) {
    return { ok: false, failure: makeStableFailure('TIMESTAMP_SKEW', 'intelligence.attention', 'instrument truth is newer than planning time', 'instruments.truth', truth.value.provenance.sourceRecordIds) };
  }
  return {
    ok: true,
    value: {
      ...instrument,
      operatorPinned: instrument.operatorPinned === true,
      releaseReasonCodes: sortedUnique(instrument.releaseReasonCodes),
      focusEligibility: {
        state: instrument.focusEligibility.state,
        reasonCodes: sortedUnique(instrument.focusEligibility.reasonCodes),
      },
      sourceQuality: {
        state: instrument.sourceQuality.state,
        reasonCodes: sortedUnique(instrument.sourceQuality.reasonCodes),
      },
      truth: truth.value,
    },
  };
}

function validatePortFailure(value: StableFailure): ValidationResult<StableFailure> {
  if (
    !isNonEmptyString(value.id) ||
    !FAILURE_CODES.includes(value.code) ||
    !isNonEmptyString(value.component) ||
    !isNonEmptyString(value.message) ||
    typeof value.retryable !== 'boolean' ||
    !(value.field === null || isNonEmptyString(value.field)) ||
    !isStringArray(value.evidenceIds)
  ) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', 'intelligence.attention', 'invalid hint port failure', 'hintPortFailures') };
  }
  return { ok: true, value: { ...value, evidenceIds: sortedUnique(value.evidenceIds) } };
}

function targetFromPriority(priority: number | null, config: AttentionPlannerConfig): AttentionTier {
  if (priority === null || priority < config.priorityThresholds.WATCH) return 'UNIVERSE';
  if (priority >= config.priorityThresholds.DEEP_FOCUS) return 'DEEP_FOCUS';
  if (priority >= config.priorityThresholds.FOCUS) return 'FOCUS';
  if (priority >= config.priorityThresholds.CANDIDATE) return 'CANDIDATE';
  return 'WATCH';
}

function summarizeHints(hints: StrategyCandidateHint[], config: AttentionPlannerConfig): HintSummary {
  if (hints.length === 0) {
    return { fresh: [], hintIds: [], priority: null, desiredTier: 'UNIVERSE', latestSignalAtMs: null, protected: false, reasonCodes: [] };
  }
  const ordered = [...hints].sort((left, right) => codePointCompare(left.id, right.id));
  let priority: number | null = null;
  let desiredTier: AttentionTier = 'UNIVERSE';
  let latestSignalAtMs: number | null = null;
  let protectedHint = false;
  const reasons: string[] = [];
  let onlyCooldown = true;
  for (const hint of ordered) {
    if (hint.priority !== null && (priority === null || hint.priority > priority)) priority = hint.priority;
    if (hint.sourceState !== 'COOLDOWN') {
      onlyCooldown = false;
      desiredTier = higherTier(desiredTier, HINT_STATE_TARGET[hint.sourceState]);
    }
    if (latestSignalAtMs === null || hint.engineObservedAtMs > latestSignalAtMs) latestSignalAtMs = hint.engineObservedAtMs;
    if (hint.protected || hint.sourceState === 'ACTIVE') protectedHint = true;
    reasons.push(...hint.reasonCodes, `HINT_${hint.strategy.toUpperCase()}`, `HINT_STATE_${hint.sourceState}`);
  }
  desiredTier = onlyCooldown ? 'RELEASED' : higherTier(desiredTier, targetFromPriority(priority, config));
  return {
    fresh: ordered,
    hintIds: ordered.map((hint) => hint.id),
    priority,
    desiredTier,
    latestSignalAtMs,
    protected: protectedHint,
    reasonCodes: sortedUnique(reasons),
  };
}

function transition(
  instrument: AttentionInstrument,
  previous: AttentionAllocation | null,
  summary: HintSummary,
  quality: SourceQualityState,
  config: AttentionPlannerConfig,
  atMs: number,
): WorkingAllocation {
  const currentTier = previous?.tier ?? 'UNIVERSE';
  const operatorPinned = instrument.operatorPinned === true;
  const protectedCapital = instrument.protectedCapital || summary.protected;
  const minimumProtectedTier = config.protectedMinimumTier;
  const sourceCeiling = config.sourceTierCeilings[quality];
  const eligibilityCeiling = config.focusEligibilityTierCeilings[instrument.focusEligibility.state];
  const effectiveCeiling = lowerActiveTier(sourceCeiling, eligibilityCeiling);
  const requestedTier = operatorPinned ? higherTier(summary.desiredTier, 'FOCUS') : summary.desiredTier;
  let desiredTier = requestedTier;
  const promotionReasons = [...summary.reasonCodes];
  const demotionReasons: string[] = [...instrument.sourceQuality.reasonCodes];

  if (desiredTier !== 'RELEASED') {
    desiredTier = lowerActiveTier(desiredTier, sourceCeiling);
    desiredTier = lowerActiveTier(desiredTier, eligibilityCeiling);
  }
  if (operatorPinned) promotionReasons.push('OPERATOR_FOCUS_PIN');
  if (rank(requestedTier) > rank(sourceCeiling)) demotionReasons.push(`SOURCE_${quality}_PROMOTION_CAPPED`);
  if (rank(requestedTier) > rank(eligibilityCeiling)) {
    demotionReasons.push(
      `FOCUS_ELIGIBILITY_${instrument.focusEligibility.state}_PROMOTION_CAPPED`,
      ...instrument.focusEligibility.reasonCodes,
    );
  }
  if (protectedCapital && rank(desiredTier) < rank(minimumProtectedTier)) {
    desiredTier = minimumProtectedTier;
    promotionReasons.push('PROTECTED_ACTIVE_CAPITAL');
    if (quality !== 'HEALTHY') demotionReasons.push(`PROTECTED_CAPITAL_SOURCE_${quality}`);
    if (instrument.focusEligibility.state !== 'ELIGIBLE') {
      demotionReasons.push(`PROTECTED_CAPITAL_FOCUS_ELIGIBILITY_${instrument.focusEligibility.state}`);
    }
  }

  let tier = currentTier;
  let cooldownUntilMs = previous?.cooldownUntilMs ?? null;
  const lastSignalAtMs = summary.latestSignalAtMs === null
    ? previous?.lastSignalAtMs ?? null
    : Math.min(summary.latestSignalAtMs, atMs);

  if (protectedCapital && rank(tier) < rank(minimumProtectedTier)) {
    tier = minimumProtectedTier;
    cooldownUntilMs = null;
    promotionReasons.push('PROTECTED_FOCUS_FLOOR');
  } else if (operatorPinned && rank(effectiveCeiling) >= rank('FOCUS') && rank(tier) < rank('FOCUS')) {
    tier = 'FOCUS';
    cooldownUntilMs = null;
    promotionReasons.push('OPERATOR_FOCUS_PIN_APPLIED');
  } else if (instrument.releaseRequested && !protectedCapital) {
    tier = 'RELEASED';
    cooldownUntilMs = atMs + config.promotionCooldownMs;
    demotionReasons.push('RELEASE_REQUESTED', ...instrument.releaseReasonCodes);
  } else if (currentTier === 'RELEASED') {
    if (cooldownUntilMs !== null && atMs < cooldownUntilMs) {
      tier = 'RELEASED';
      demotionReasons.push('COOLDOWN_ACTIVE');
    } else {
      tier = 'UNIVERSE';
      cooldownUntilMs = null;
      promotionReasons.push('COOLDOWN_EXPIRED');
    }
  } else if (desiredTier === 'RELEASED' && !protectedCapital) {
    tier = 'RELEASED';
    cooldownUntilMs = atMs + config.promotionCooldownMs;
    demotionReasons.push('UPSTREAM_COOLDOWN');
  } else if (rank(desiredTier) > rank(currentTier)) {
    const dwellAge = atMs - (previous?.enteredAtMs ?? atMs);
    if (cooldownUntilMs !== null && atMs < cooldownUntilMs) {
      demotionReasons.push('PROMOTION_COOLDOWN_ACTIVE');
    } else if (dwellAge < config.minTierDwellMs[currentTier]) {
      demotionReasons.push('PROMOTION_DWELL_ACTIVE');
    } else {
      tier = activeTierAt(rank(currentTier) + 1);
      promotionReasons.push('PROMOTED_BY_FRESH_HINT');
      cooldownUntilMs = null;
    }
  } else if (rank(desiredTier) < rank(currentTier)) {
    if (rank(effectiveCeiling) < rank(currentTier)) {
      tier = effectiveCeiling;
      cooldownUntilMs = atMs + config.promotionCooldownMs;
      if (rank(sourceCeiling) < rank(currentTier)) demotionReasons.push(`SOURCE_${quality}_IMMEDIATE_DEMOTION`);
      if (rank(eligibilityCeiling) < rank(currentTier)) {
        demotionReasons.push(`FOCUS_ELIGIBILITY_${instrument.focusEligibility.state}_IMMEDIATE_DEMOTION`);
      }
    } else if (summary.fresh.length === 0) {
      if (lastSignalAtMs !== null && atMs - lastSignalAtMs < config.signalHoldMs) {
        demotionReasons.push('SIGNAL_HYSTERESIS_HOLD');
      } else {
        tier = 'RELEASED';
        cooldownUntilMs = atMs + config.promotionCooldownMs;
        demotionReasons.push('SIGNAL_RELEASED');
      }
    } else {
      const dwellAge = atMs - (previous?.enteredAtMs ?? atMs);
      if (dwellAge < config.minTierDwellMs[currentTier]) {
        demotionReasons.push('DEMOTION_DWELL_ACTIVE');
      } else {
        tier = activeTierAt(rank(currentTier) - 1);
        cooldownUntilMs = atMs + config.promotionCooldownMs;
        demotionReasons.push('SIGNAL_WEAKENED');
      }
    }
  }

  return {
    instrument,
    previous,
    summary,
    tier,
    desiredTier,
    protected: protectedCapital,
    operatorPinned,
    priority: summary.priority,
    hintIds: summary.hintIds,
    lastSignalAtMs,
    cooldownUntilMs,
    promotionReasons: sortedUnique(promotionReasons),
    demotionReasons: sortedUnique(demotionReasons),
    sourceQuality: quality,
  };
}

function allocationCompare(left: WorkingAllocation, right: WorkingAllocation): number {
  if (left.protected !== right.protected) return left.protected ? -1 : 1;
  if (left.operatorPinned !== right.operatorPinned) return left.operatorPinned ? -1 : 1;
  if (QUALITY_PRIORITY[left.sourceQuality] !== QUALITY_PRIORITY[right.sourceQuality]) {
    return QUALITY_PRIORITY[right.sourceQuality] - QUALITY_PRIORITY[left.sourceQuality];
  }
  const leftPriority = left.priority ?? Number.NEGATIVE_INFINITY;
  const rightPriority = right.priority ?? Number.NEGATIVE_INFINITY;
  if (leftPriority !== rightPriority) return rightPriority - leftPriority;
  const leftSignal = left.lastSignalAtMs ?? -1;
  const rightSignal = right.lastSignalAtMs ?? -1;
  if (leftSignal !== rightSignal) return rightSignal - leftSignal;
  return codePointCompare(left.instrument.instrumentId, right.instrument.instrumentId);
}

function enforceCapacity(working: WorkingAllocation[], config: AttentionPlannerConfig, atMs: number): ValidationResult<WorkingAllocation[]> {
  for (const threshold of ['DEEP_FOCUS', 'FOCUS', 'CANDIDATE', 'WATCH'] as const) {
    const cap = config.tierCaps[threshold];
    const consuming = working.filter((entry) => rank(entry.tier) >= rank(threshold)).sort(allocationCompare);
    if (consuming.length <= cap) continue;
    const kept = new Set(consuming.slice(0, cap).map((entry) => entry.instrument.instrumentId));
    const demotionTier = activeTierAt(rank(threshold) - 1);
    for (const entry of consuming.slice(cap)) {
      if (kept.has(entry.instrument.instrumentId)) continue;
      if (entry.protected && rank(demotionTier) < rank(config.protectedMinimumTier)) {
        return {
          ok: false,
          failure: makeStableFailure(
            'PROTECTED_CAPITAL',
            'intelligence.attention',
            'protected active capital exceeds the configured focus capacity',
            `tierCaps.${threshold}`,
            entry.hintIds,
          ),
        };
      }
      entry.tier = demotionTier;
      entry.cooldownUntilMs = Math.max(entry.cooldownUntilMs ?? 0, atMs + config.promotionCooldownMs);
      entry.demotionReasons = sortedUnique([...entry.demotionReasons, 'CAPACITY_EVICTED', `${threshold}_BUDGET_EXHAUSTED`]);
    }
  }
  return { ok: true, value: working };
}

function allocationTruth(
  entry: WorkingAllocation,
  config: AttentionPlannerConfig,
  atMs: number,
): TruthMetadata {
  const upstream = entry.instrument.truth;
  const hintTruths = entry.summary.fresh.map((hint) => hint.truth);
  const allSourceRecordIds = sortedUnique([
    ...upstream.provenance.sourceRecordIds,
    ...entry.hintIds,
    ...hintTruths.flatMap((truth) => truth.provenance.sourceRecordIds),
  ]);
  const allSourceSet = sortedUnique([
    ...upstream.provenance.sourceSet,
    ...hintTruths.map((truth) => truth.authority.sourceId),
    ...hintTruths.flatMap((truth) => truth.provenance.sourceSet),
  ]);
  const allTransforms = sortedUnique([
    ...upstream.provenance.transforms,
    ...hintTruths.flatMap((truth) => truth.provenance.transforms),
    'attention-planner-v1',
  ]);
  const sourceRecordIds = allSourceRecordIds.slice(0, MAX_OUTPUT_RECORD_IDS);
  const sourceSet = allSourceSet.slice(0, MAX_OUTPUT_SOURCE_SET);
  const transforms = allTransforms.slice(0, MAX_OUTPUT_TRANSFORMS);
  const recordIdsTruncated = allSourceRecordIds.length > sourceRecordIds.length;
  const sourceSetTruncated = allSourceSet.length > sourceSet.length;
  const transformsTruncated = allTransforms.length > transforms.length;
  const upstreamBasis = basisTime(upstream);
  const maximumAge = upstream.freshness.maxAgeMs;
  let freshness: TruthMetadata['freshness'];
  if (entry.sourceQuality === 'FAILED') {
    freshness = { basis: 'UNAVAILABLE', evaluatedAtMs: atMs, ageMs: null, maxAgeMs: null, state: 'UNAVAILABLE' };
  } else if (entry.sourceQuality === 'UNKNOWN' || upstreamBasis === null || maximumAge === null || upstreamBasis > atMs) {
    freshness = { basis: upstream.freshness.basis, evaluatedAtMs: atMs, ageMs: upstreamBasis === null || upstreamBasis > atMs ? null : atMs - upstreamBasis, maxAgeMs: maximumAge, state: 'UNKNOWN' };
  } else {
    const ageMs = atMs - upstreamBasis;
    const objectivelyStale = ageMs > maximumAge;
    freshness = {
      basis: upstream.freshness.basis,
      evaluatedAtMs: atMs,
      ageMs,
      maxAgeMs: maximumAge,
      state: objectivelyStale ? 'STALE' : entry.sourceQuality === 'STALE' ? 'UNKNOWN' : 'FRESH',
    };
  }

  let completenessState = upstream.completeness.state;
  let missingFields = [...upstream.completeness.missingFields];
  if (entry.sourceQuality === 'FAILED') {
    completenessState = 'MISSING';
    missingFields.push('source_evidence');
  } else if (entry.sourceQuality === 'UNKNOWN') {
    completenessState = 'UNKNOWN';
  } else if (entry.sourceQuality === 'DEGRADED' && completenessState === 'COMPLETE') {
    completenessState = 'PARTIAL';
  }
  if (recordIdsTruncated || sourceSetTruncated || transformsTruncated) {
    if (completenessState === 'COMPLETE') completenessState = 'PARTIAL';
    if (recordIdsTruncated) missingFields.push('provenance.sourceRecordIds');
    if (sourceSetTruncated) missingFields.push('provenance.sourceSet');
    if (transformsTruncated) missingFields.push('provenance.transforms');
  }
  return {
    schemaVersion: '1',
    producerVersion: config.producerVersion,
    configurationVersion: config.configurationVersion,
    featureVersion: upstream.featureVersion,
    authority: {
      kind: 'ENGINE_DERIVED',
      sourceId: 'intelligence-foundation-attention',
      dataset: 'attention-allocation',
      endpointClass: 'INJECTED',
    },
    provenance: { sourceRecordIds, sourceSet, transforms },
    temporal: { ...upstream.temporal },
    freshness,
    completeness: {
      state: completenessState,
      observedFields: sortedUnique(upstream.completeness.observedFields),
      missingFields: sortedUnique(missingFields),
      reasonCodes: sortedUnique([
        ...upstream.completeness.reasonCodes,
        ...entry.instrument.sourceQuality.reasonCodes,
        ...entry.instrument.focusEligibility.reasonCodes,
        `SOURCE_QUALITY_${entry.sourceQuality}`,
        `FOCUS_ELIGIBILITY_${entry.instrument.focusEligibility.state}`,
        ...(recordIdsTruncated ? ['ATTENTION_PROVENANCE_RECORD_IDS_TRUNCATED'] : []),
        ...(sourceSetTruncated ? ['ATTENTION_PROVENANCE_SOURCE_SET_TRUNCATED'] : []),
        ...(transformsTruncated ? ['ATTENTION_PROVENANCE_TRANSFORMS_TRUNCATED'] : []),
      ]),
    },
  };
}

function planTruth(
  entries: AttentionAllocation[],
  failures: readonly StableFailure[],
  config: AttentionPlannerConfig,
  atMs: number,
): TruthMetadata {
  const hasMissingSource = entries.some((entry) => entry.sourceQuality === 'FAILED');
  const allRecordIds = entries.map((entry) => entry.id);
  const recordIdsTruncated = allRecordIds.length > MAX_OUTPUT_RECORD_IDS;
  const incomplete = hasMissingSource || failures.length > 0 || recordIdsTruncated || entries.some((entry) => entry.sourceQuality !== 'HEALTHY');
  return {
    schemaVersion: '1',
    producerVersion: config.producerVersion,
    configurationVersion: config.configurationVersion,
    featureVersion: null,
    authority: {
      kind: 'ENGINE_DERIVED',
      sourceId: 'intelligence-foundation-attention',
      dataset: 'attention-plan',
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: allRecordIds.slice(0, MAX_OUTPUT_RECORD_IDS),
      sourceSet: ['intelligence-foundation-attention'],
      transforms: ['attention-plan-v1'],
    },
    temporal: {
      sourceEventTimeMs: null,
      sourceTransactionTimeMs: null,
      receivedTimeMs: atMs,
      sequence: null,
    },
    freshness: {
      basis: 'RECEIVE_TIME',
      evaluatedAtMs: atMs,
      ageMs: 0,
      maxAgeMs: 0,
      state: 'FRESH',
    },
    completeness: {
      state: incomplete ? 'PARTIAL' : 'COMPLETE',
      observedFields: ['allocations', 'requests', 'tierCounts'],
      missingFields: sortedUnique([
        ...(hasMissingSource ? ['source_evidence'] : []),
        ...(failures.length > 0 ? ['candidate_hint_ports'] : []),
        ...(recordIdsTruncated ? ['provenance.sourceRecordIds'] : []),
      ]),
      reasonCodes: sortedUnique([
        ...(hasMissingSource ? ['SOURCE_EVIDENCE_MISSING'] : []),
        ...(failures.length > 0 ? ['HINT_PORT_UNAVAILABLE'] : []),
        ...(recordIdsTruncated ? ['ATTENTION_PROVENANCE_RECORD_IDS_TRUNCATED'] : []),
      ]),
    },
  };
}

function tierCounts(allocations: readonly AttentionAllocation[]): AttentionTierCounts {
  const counts: AttentionTierCounts = { UNIVERSE: 0, WATCH: 0, CANDIDATE: 0, FOCUS: 0, DEEP_FOCUS: 0, RELEASED: 0 };
  for (const allocation of allocations) counts[allocation.tier] += 1;
  return counts;
}

function finalizeAllocation(entry: WorkingAllocation, config: AttentionPlannerConfig, atMs: number): AttentionAllocation {
  const previous = entry.previous;
  const changed = previous === null || previous.tier !== entry.tier;
  const profile = config.profiles[entry.tier];
  const atOrAboveCandidate = rank(entry.tier) >= rank('CANDIDATE');
  const previouslyCandidate = previous !== null && rank(previous.tier) >= rank('CANDIDATE');
  return {
    id: stableId('attention-state', { instrumentId: entry.instrument.instrumentId }),
    instrumentId: entry.instrument.instrumentId,
    symbol: entry.instrument.symbol,
    tier: entry.tier,
    desiredTier: entry.desiredTier,
    enteredAtMs: changed ? atMs : previous.enteredAtMs,
    lastChangedAtMs: changed ? atMs : previous.lastChangedAtMs,
    protected: entry.protected,
    priority: entry.priority,
    hintIds: [...entry.hintIds],
    lastSignalAtMs: entry.lastSignalAtMs,
    cooldownUntilMs: entry.cooldownUntilMs,
    candidateOpenedAtMs: atOrAboveCandidate
      ? previouslyCandidate && previous.candidateOpenedAtMs !== null ? previous.candidateOpenedAtMs : atMs
      : null,
    focusEligibility: {
      state: entry.instrument.focusEligibility.state,
      reasonCodes: [...entry.instrument.focusEligibility.reasonCodes],
    },
    sourceQuality: entry.sourceQuality,
    promotionReasons: entry.promotionReasons,
    demotionReasons: entry.demotionReasons,
    requestedEvidence: copyEvidence(profile.requestedEvidence),
    requestedFeatures: sortedUnique(profile.requestedFeatures),
    truth: allocationTruth(entry, config, atMs),
  };
}

function makeRequest(
  allocation: AttentionAllocation,
  previous: AttentionAllocation | null,
  config: AttentionPlannerConfig,
  atMs: number,
): AttentionRequest | null {
  const initial = previous === null;
  const tierChanged = previous !== null && previous.tier !== allocation.tier;
  const profileChanged = previous !== null && (
    !sameStrings(previous.requestedEvidence, allocation.requestedEvidence) ||
    !sameStrings(previous.requestedFeatures, allocation.requestedFeatures)
  );
  if (!initial && !tierChanged && !profileChanged) return null;
  const reasonCodes = sortedUnique([
    ...(initial ? ['UNIVERSE_COVERAGE_ESTABLISHED'] : []),
    ...(profileChanged ? ['ENRICHMENT_PROFILE_CHANGED'] : []),
    ...allocation.promotionReasons,
    ...allocation.demotionReasons,
  ]);
  const fromTier = previous?.tier ?? 'UNIVERSE';
  return {
    id: stableSetId('attention-request', {
      instrumentId: allocation.instrumentId,
      fromTier,
      toTier: allocation.tier,
      createdAtMs: atMs,
      configurationVersion: config.configurationVersion,
      reasonCodes,
    }, ['reasonCodes']),
    instrumentId: allocation.instrumentId,
    fromTier,
    toTier: allocation.tier,
    requestedEvidence: [...allocation.requestedEvidence],
    requestedFeatures: [...allocation.requestedFeatures],
    priority: allocation.priority ?? 0,
    reasonCodes,
    createdAtMs: atMs,
    truth: allocation.truth,
  };
}

function candidateFor(allocation: AttentionAllocation, atMs: number): CandidateState | null {
  if (rank(allocation.tier) < rank('CANDIDATE') || allocation.candidateOpenedAtMs === null) return null;
  return {
    id: stableId('candidate-state', {
      instrumentId: allocation.instrumentId,
      openedAtMs: allocation.candidateOpenedAtMs,
    }),
    instrumentId: allocation.instrumentId,
    openedAtMs: allocation.candidateOpenedAtMs,
    updatedAtMs: atMs,
    reasonCodes: sortedUnique([...allocation.promotionReasons, ...allocation.demotionReasons]),
    score: allocation.priority,
    hintIds: [...allocation.hintIds],
    truth: allocation.truth,
  };
}

/**
 * Pure deterministic reducer. It owns scarce observation resources only; it
 * cannot create a proposal, order intent, execution instruction, or runtime.
 */
export function planAttention(
  input: AttentionPlanningInput,
  suppliedConfig: AttentionPlannerConfig = attentionConfig(),
): AttentionPlanResult {
  let config: AttentionPlannerConfig;
  try {
    config = attentionConfig(suppliedConfig);
  } catch {
    return fail('INVALID_VALUE', 'invalid attention planner configuration', 'config');
  }
  if (input === null || typeof input !== 'object') {
    return fail('INVALID_VALUE', 'attention planning input must be an object', 'input');
  }
  const secret = validateNoSecretFields(input, 'attention_input');
  if (!secret.ok) return secret as AttentionPlanResult;
  if (
    !isSafeTime(input.atMs) ||
    !Array.isArray(input.instruments) ||
    !(input.previousAllocations === undefined || Array.isArray(input.previousAllocations)) ||
    !(input.hints === undefined || Array.isArray(input.hints)) ||
    !(input.hintPortFailures === undefined || Array.isArray(input.hintPortFailures))
  ) {
    return fail('INVALID_VALUE', 'planning time and instruments are required', 'input');
  }
  if (input.atMs > Number.MAX_SAFE_INTEGER - Math.max(config.promotionCooldownMs, config.maxFutureHintSkewMs)) {
    return fail('INVALID_VALUE', 'planning time cannot safely represent configured future boundaries', 'input.atMs');
  }
  if (input.instruments.length > config.tierCaps.UNIVERSE) {
    return fail('BUDGET_EXHAUSTED', 'configured universe capacity cannot represent every supplied instrument', 'tierCaps.UNIVERSE');
  }
  if ((input.previousAllocations?.length ?? 0) > config.tierCaps.UNIVERSE) {
    return fail('BUDGET_EXHAUSTED', 'previous allocation set exceeds configured universe capacity', 'previousAllocations');
  }
  if ((input.hints?.length ?? 0) > config.maxHintsPerPlan) {
    return fail('BUDGET_EXHAUSTED', 'candidate hint batch exceeds configured planner capacity', 'hints');
  }
  if ((input.hintPortFailures?.length ?? 0) > 64) {
    return fail('BUDGET_EXHAUSTED', 'hint port failure set exceeds planner capacity', 'hintPortFailures');
  }

  const instruments = new Map<string, AttentionInstrument>();
  for (const raw of input.instruments) {
    const validated = validateInstrument(raw, input.atMs);
    if (!validated.ok) return validated as AttentionPlanResult;
    if (instruments.has(validated.value.instrumentId)) {
      return fail('INVALID_VALUE', 'duplicate instrument identity in attention universe', 'instruments', [validated.value.instrumentId]);
    }
    instruments.set(validated.value.instrumentId, validated.value);
  }

  const previous = new Map<string, AttentionAllocation>();
  for (const raw of input.previousAllocations ?? []) {
    const validated = validateAllocation(raw);
    if (!validated.ok) return validated as AttentionPlanResult;
    if (validated.value.lastChangedAtMs > input.atMs || validated.value.enteredAtMs > input.atMs) {
      return fail('OUT_OF_ORDER_EVENT', 'planning time precedes previous attention state', 'previousAllocations', [validated.value.id]);
    }
    if (validated.value.truth.temporal.receivedTimeMs > input.atMs || validated.value.truth.freshness.evaluatedAtMs > input.atMs) {
      return fail('OUT_OF_ORDER_EVENT', 'planning time precedes previous allocation truth', 'previousAllocations.truth', [validated.value.id]);
    }
    if (
      (validated.value.lastSignalAtMs !== null && validated.value.lastSignalAtMs > input.atMs) ||
      (validated.value.candidateOpenedAtMs !== null && validated.value.candidateOpenedAtMs > input.atMs)
    ) {
      return fail('OUT_OF_ORDER_EVENT', 'planning time precedes previous signal or candidate state', 'previousAllocations', [validated.value.id]);
    }
    if (previous.has(validated.value.instrumentId)) {
      return fail('INVALID_VALUE', 'duplicate previous attention state', 'previousAllocations', [validated.value.id]);
    }
    previous.set(validated.value.instrumentId, validated.value);
  }

  const hintIds = new Set<string>();
  const hintsByInstrument = new Map<string, StrategyCandidateHint[]>();
  const ignoredHints: IgnoredCandidateHint[] = [];
  for (const raw of input.hints ?? []) {
    const validated = validateHint(raw);
    if (!validated.ok) return validated as AttentionPlanResult;
    const hint = validated.value;
    if (hintIds.has(hint.id)) return fail('DUPLICATE_EVENT', 'duplicate candidate hint id', 'hints', [hint.id]);
    hintIds.add(hint.id);
    const instrument = instruments.get(hint.instrumentId);
    if (!instrument) {
      ignoredHints.push({ hintId: hint.id, instrumentId: hint.instrumentId, reasonCode: 'UNKNOWN_INSTRUMENT' });
      continue;
    }
    if (instrument.symbol !== hint.symbol) {
      ignoredHints.push({ hintId: hint.id, instrumentId: hint.instrumentId, reasonCode: 'SYMBOL_MISMATCH' });
      continue;
    }
    if (hint.engineObservedAtMs > input.atMs + config.maxFutureHintSkewMs || truthHasFutureTime(hint.truth, input.atMs)) {
      ignoredHints.push({ hintId: hint.id, instrumentId: hint.instrumentId, reasonCode: 'FUTURE_HINT' });
      continue;
    }
    if (hint.truth.freshness.state === 'UNAVAILABLE' || hint.truth.freshness.state === 'UNKNOWN' || hint.truth.completeness.state === 'MISSING') {
      ignoredHints.push({ hintId: hint.id, instrumentId: hint.instrumentId, reasonCode: 'UNAVAILABLE_HINT' });
      continue;
    }
    if (hint.truth.freshness.state === 'STALE' || hintTruthExpired(hint, input.atMs, config)) {
      ignoredHints.push({ hintId: hint.id, instrumentId: hint.instrumentId, reasonCode: 'STALE_HINT' });
      continue;
    }
    const bucket = hintsByInstrument.get(hint.instrumentId) ?? [];
    if (bucket.length >= config.maxHintsPerInstrument) {
      return fail('BUDGET_EXHAUSTED', 'instrument candidate hint set exceeds configured capacity', 'maxHintsPerInstrument', [hint.id]);
    }
    bucket.push(hint);
    hintsByInstrument.set(hint.instrumentId, bucket);
  }

  const working: WorkingAllocation[] = [];
  for (const instrument of [...instruments.values()].sort((left, right) => codePointCompare(left.instrumentId, right.instrumentId))) {
    const quality = effectiveSourceQuality(instrument, input.atMs);
    const summary = summarizeHints(hintsByInstrument.get(instrument.instrumentId) ?? [], config);
    working.push(transition(instrument, previous.get(instrument.instrumentId) ?? null, summary, quality, config, input.atMs));
  }

  const capacity = enforceCapacity(working, config, input.atMs);
  if (!capacity.ok) return capacity as AttentionPlanResult;
  const allocations = capacity.value
    .map((entry) => finalizeAllocation(entry, config, input.atMs))
    .sort((left, right) => codePointCompare(left.instrumentId, right.instrumentId));
  const requests = allocations
    .map((allocation) => makeRequest(allocation, previous.get(allocation.instrumentId) ?? null, config, input.atMs))
    .filter((request): request is AttentionRequest => request !== null)
    .sort((left, right) => codePointCompare(left.instrumentId, right.instrumentId));
  const candidates = allocations
    .map((allocation) => candidateFor(allocation, input.atMs))
    .filter((candidate): candidate is CandidateState => candidate !== null)
    .sort((left, right) => codePointCompare(left.instrumentId, right.instrumentId));
  const portFailures: StableFailure[] = [];
  const portFailureIds = new Set<string>();
  for (const raw of input.hintPortFailures ?? []) {
    const validated = validatePortFailure(raw);
    if (!validated.ok) return validated as AttentionPlanResult;
    if (portFailureIds.has(validated.value.id)) {
      return fail('DUPLICATE_EVENT', 'duplicate hint port failure id', 'hintPortFailures', [validated.value.id]);
    }
    portFailureIds.add(validated.value.id);
    portFailures.push(validated.value);
  }
  portFailures.sort((left, right) => codePointCompare(left.id, right.id));
  const truth = planTruth(allocations, portFailures, config, input.atMs);
  const counts = tierCounts(allocations);
  const allocationKeys = allocations.map((allocation) => `${allocation.instrumentId}:${allocation.tier}:${allocation.priority ?? 'null'}`);
  const ignoredHintKeys = ignoredHints.map((hint) => `${hint.hintId}:${hint.reasonCode}`);
  const plan: AttentionPlan = {
    id: stableSetId('attention-plan', {
      atMs: input.atMs,
      configurationVersion: config.configurationVersion,
      allocationKeys,
      requestIds: requests.map((request) => request.id),
      ignoredHintKeys,
      failureIds: portFailures.map((failure) => failure.id),
    }, ['allocationKeys', 'requestIds', 'ignoredHintKeys', 'failureIds']),
    atMs: input.atMs,
    configurationVersion: config.configurationVersion,
    allocations,
    candidates,
    requests,
    ignoredHints: ignoredHints.sort((left, right) => codePointCompare(`${left.hintId}:${left.reasonCode}`, `${right.hintId}:${right.reasonCode}`)),
    hintPortFailures: portFailures,
    tierCounts: counts,
    truth,
  };
  return { ok: true, value: plan };
}

export function planAttentionFromPorts(
  input: Omit<AttentionPlanningInput, 'hints' | 'hintPortFailures'> & { hints?: readonly StrategyCandidateHint[] },
  ports: readonly StrategyCandidateHintPort[],
  suppliedConfig: AttentionPlannerConfig = attentionConfig(),
): AttentionPlanResult {
  let config: AttentionPlannerConfig;
  try {
    config = attentionConfig(suppliedConfig);
  } catch {
    return fail('INVALID_VALUE', 'invalid attention planner configuration', 'config');
  }
  if (input === null || typeof input !== 'object' || !isSafeTime(input.atMs)) {
    return fail('INVALID_VALUE', 'attention planning input must include a safe planning time', 'input');
  }
  if (!Array.isArray(ports) || ports.length > 64) {
    return fail('BUDGET_EXHAUSTED', 'hint port set exceeds planner capacity', 'ports');
  }
  if (ports.some((port) => port === null || typeof port !== 'object' || typeof port.portId !== 'string' || typeof port.readCandidateHints !== 'function')) {
    return fail('INVALID_VALUE', 'hint ports must expose canonical ids and synchronous readers', 'ports');
  }
  const seen = new Set<string>();
  const hints = [...(input.hints ?? [])];
  const failures: StableFailure[] = [];
  for (const port of [...ports].sort((left, right) => codePointCompare(left.portId, right.portId))) {
    if (!/^[a-z][a-z0-9._-]{0,63}$/i.test(port.portId) || seen.has(port.portId)) {
      return fail('INVALID_VALUE', 'hint port identifiers must be unique and canonical', 'ports');
    }
    seen.add(port.portId);
    try {
      const read = port.readCandidateHints(input.atMs);
      if (!Array.isArray(read)) throw new TypeError('invalid hint batch');
      hints.push(...read);
      if (hints.length > config.maxHintsPerPlan) {
        return fail('BUDGET_EXHAUSTED', 'candidate hint batch exceeds configured planner capacity', 'hints');
      }
    } catch {
      failures.push(makeStableFailure(
        'UNAVAILABLE',
        'intelligence.attention.hint-port',
        'candidate hint port unavailable',
        port.portId,
      ));
    }
  }
  return planAttention({ ...input, hints, hintPortFailures: failures }, config);
}

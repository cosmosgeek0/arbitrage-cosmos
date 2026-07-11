import {
  ATTENTION_TIERS,
  EVIDENCE_KINDS,
  type AttentionTier,
  type EvidenceKind,
  sortedUnique,
} from '../contracts/index.js';
import {
  FOCUS_ELIGIBILITY_STATES,
  SOURCE_QUALITY_STATES,
  type FocusEligibilityState,
  type SourceQualityState,
} from './types.js';

export interface AttentionEnrichmentProfile {
  requestedEvidence: EvidenceKind[];
  requestedFeatures: string[];
}

const ACTIVE_TIERS_FOR_PROFILES = ['UNIVERSE', 'WATCH', 'CANDIDATE', 'FOCUS', 'DEEP_FOCUS'] as const;

export type AttentionTierCaps = Record<AttentionTier, number>;
export type AttentionTierProfiles = Record<AttentionTier, AttentionEnrichmentProfile>;

export interface AttentionPlannerConfig {
  producerVersion: string;
  configurationVersion: string;
  tierCaps: AttentionTierCaps;
  minTierDwellMs: Record<AttentionTier, number>;
  sourceTierCeilings: Record<SourceQualityState, Exclude<AttentionTier, 'RELEASED'>>;
  focusEligibilityTierCeilings: Record<FocusEligibilityState, Exclude<AttentionTier, 'RELEASED'>>;
  profiles: AttentionTierProfiles;
  priorityThresholds: {
    WATCH: number;
    CANDIDATE: number;
    FOCUS: number;
    DEEP_FOCUS: number;
  };
  hintStaleAfterMs: number;
  maxFutureHintSkewMs: number;
  signalHoldMs: number;
  promotionCooldownMs: number;
  maxHintsPerPlan: number;
  maxHintsPerInstrument: number;
  protectedMinimumTier: 'FOCUS' | 'DEEP_FOCUS';
}

export type AttentionPlannerConfigInput = Partial<Omit<
  AttentionPlannerConfig,
  'tierCaps' | 'minTierDwellMs' | 'sourceTierCeilings' | 'focusEligibilityTierCeilings' | 'profiles' | 'priorityThresholds'
>> & {
  tierCaps?: Partial<AttentionTierCaps>;
  minTierDwellMs?: Partial<Record<AttentionTier, number>>;
  sourceTierCeilings?: Partial<Record<SourceQualityState, Exclude<AttentionTier, 'RELEASED'>>>;
  focusEligibilityTierCeilings?: Partial<Record<FocusEligibilityState, Exclude<AttentionTier, 'RELEASED'>>>;
  profiles?: Partial<AttentionTierProfiles>;
  priorityThresholds?: Partial<AttentionPlannerConfig['priorityThresholds']>;
};

const profile = (requestedEvidence: EvidenceKind[], requestedFeatures: string[]): AttentionEnrichmentProfile => ({
  requestedEvidence,
  requestedFeatures,
});

export const ATTENTION_DEFAULTS: AttentionPlannerConfig = {
  producerVersion: 'attention-planner-1',
  configurationVersion: 'attention-defaults-1',
  // Caps are cumulative: FOCUS includes DEEP_FOCUS, CANDIDATE includes both.
  tierCaps: {
    UNIVERSE: 2_500,
    WATCH: 512,
    CANDIDATE: 128,
    FOCUS: 25,
    DEEP_FOCUS: 10,
    RELEASED: 2_500,
  },
  minTierDwellMs: {
    UNIVERSE: 0,
    WATCH: 2_000,
    CANDIDATE: 3_000,
    FOCUS: 5_000,
    DEEP_FOCUS: 10_000,
    RELEASED: 0,
  },
  sourceTierCeilings: {
    HEALTHY: 'DEEP_FOCUS',
    DEGRADED: 'CANDIDATE',
    STALE: 'WATCH',
    FAILED: 'UNIVERSE',
    UNKNOWN: 'WATCH',
  },
  focusEligibilityTierCeilings: {
    ELIGIBLE: 'DEEP_FOCUS',
    INELIGIBLE: 'CANDIDATE',
    UNKNOWN: 'WATCH',
  },
  profiles: {
    UNIVERSE: profile(
      ['TRADE', 'BOOK_TICKER'],
      ['quote_volume_1m', 'relative_volume_1m', 'spread_bps', 'trade_arrival_rate_1m'],
    ),
    WATCH: profile(
      ['TRADE', 'BOOK_TICKER', 'MARK_PRICE', 'FUNDING', 'CONTEXT'],
      ['price_acceleration_15s', 'quote_volume_1m', 'relative_volume_1m', 'relative_volume_15s', 'spread_bps', 'trade_arrival_acceleration', 'trade_arrival_rate_1m'],
    ),
    CANDIDATE: profile(
      ['TRADE', 'BOOK_TICKER', 'DEPTH_SNAPSHOT', 'MARK_PRICE', 'FUNDING', 'OPEN_INTEREST', 'CONTEXT'],
      ['aggressor_imbalance_15s', 'depth_imbalance', 'price_acceleration_15s', 'price_response_per_flow', 'quote_volume_1m', 'relative_volume_1m', 'relative_volume_15s', 'relative_volume_5s', 'spot_perpetual_divergence', 'spread_bps', 'trade_arrival_acceleration', 'trade_arrival_rate_1m'],
    ),
    FOCUS: profile(
      ['TRADE', 'BOOK_TICKER', 'DEPTH_SNAPSHOT', 'DEPTH_DELTA', 'MARK_PRICE', 'FUNDING', 'OPEN_INTEREST', 'LIQUIDATION', 'BORROW', 'CONTEXT'],
      ['absorption_evidence', 'aggressor_imbalance_15s', 'book_replenishment', 'depth_imbalance', 'depth_slope', 'large_trade_clustering', 'price_acceleration_15s', 'price_response_per_flow', 'quote_volume_1m', 'relative_volume_1m', 'relative_volume_15s', 'relative_volume_5s', 'spot_perpetual_divergence', 'spot_perpetual_lead_lag', 'spread_bps', 'trade_arrival_acceleration', 'trade_arrival_rate_1m'],
    ),
    DEEP_FOCUS: profile(
      [...EVIDENCE_KINDS],
      ['absorption_evidence', 'aggressor_imbalance_15s', 'book_replenishment', 'crowding_change', 'depth_imbalance', 'depth_slope', 'large_trade_clustering', 'market_specific_residual', 'price_acceleration_15s', 'price_response_per_flow', 'quote_volume_1m', 'relative_volume_1m', 'relative_volume_15s', 'relative_volume_5s', 'spot_perpetual_divergence', 'spot_perpetual_lead_lag', 'spread_bps', 'trade_arrival_acceleration', 'trade_arrival_rate_1m'],
    ),
    RELEASED: profile([], []),
  },
  priorityThresholds: {
    WATCH: 0,
    CANDIDATE: 0.25,
    FOCUS: 0.5,
    DEEP_FOCUS: 0.8,
  },
  hintStaleAfterMs: 15_000,
  maxFutureHintSkewMs: 2_000,
  signalHoldMs: 5_000,
  promotionCooldownMs: 30_000,
  maxHintsPerPlan: 10_000,
  maxHintsPerInstrument: 64,
  protectedMinimumTier: 'FOCUS',
};

function copyProfile(value: AttentionEnrichmentProfile): AttentionEnrichmentProfile {
  return {
    requestedEvidence: sortedUnique(value.requestedEvidence) as EvidenceKind[],
    requestedFeatures: sortedUnique(value.requestedFeatures),
  };
}

function finiteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`invalid attention config ${name}: expected finite non-negative number`);
}

function safeDuration(name: string, value: number): void {
  const maximum = 365 * 24 * 60 * 60_000;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`invalid attention config ${name}: expected safe duration 0..${maximum}ms`);
  }
}

function safeCap(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 50_000) {
    throw new RangeError(`invalid attention config ${name}: expected safe integer 0..50000`);
  }
}

export function attentionConfig(partial: AttentionPlannerConfigInput = {}): AttentionPlannerConfig {
  const config: AttentionPlannerConfig = {
    ...ATTENTION_DEFAULTS,
    ...partial,
    tierCaps: { ...ATTENTION_DEFAULTS.tierCaps, ...(partial.tierCaps ?? {}) },
    minTierDwellMs: { ...ATTENTION_DEFAULTS.minTierDwellMs, ...(partial.minTierDwellMs ?? {}) },
    sourceTierCeilings: { ...ATTENTION_DEFAULTS.sourceTierCeilings, ...(partial.sourceTierCeilings ?? {}) },
    focusEligibilityTierCeilings: {
      ...ATTENTION_DEFAULTS.focusEligibilityTierCeilings,
      ...(partial.focusEligibilityTierCeilings ?? {}),
    },
    priorityThresholds: { ...ATTENTION_DEFAULTS.priorityThresholds, ...(partial.priorityThresholds ?? {}) },
    profiles: Object.fromEntries(ATTENTION_TIERS.map((tier) => [
      tier,
      copyProfile(partial.profiles?.[tier] ?? ATTENTION_DEFAULTS.profiles[tier]),
    ])) as AttentionTierProfiles,
  };

  if (
    config.producerVersion.trim().length === 0 ||
    config.configurationVersion.trim().length === 0 ||
    config.producerVersion.length > 96 ||
    config.configurationVersion.length > 96
  ) {
    throw new RangeError('invalid attention config: versions must be non-empty');
  }
  for (const tier of ATTENTION_TIERS) {
    safeCap(`tierCaps.${tier}`, config.tierCaps[tier]);
    safeDuration(`minTierDwellMs.${tier}`, config.minTierDwellMs[tier]);
  }
  if (config.tierCaps.RELEASED < config.tierCaps.UNIVERSE) {
    throw new RangeError('invalid attention config: RELEASED cap must cover the full configured universe');
  }
  const orderedCaps = ['UNIVERSE', 'WATCH', 'CANDIDATE', 'FOCUS', 'DEEP_FOCUS'] as const;
  for (let index = 1; index < orderedCaps.length; index += 1) {
    const broader = orderedCaps[index - 1];
    const narrower = orderedCaps[index];
    if (config.tierCaps[narrower] > config.tierCaps[broader]) {
      throw new RangeError(`invalid attention config: ${narrower} cap exceeds ${broader} cap`);
    }
  }
  const thresholds = config.priorityThresholds;
  for (const [name, value] of Object.entries(thresholds)) finiteNonNegative(`priorityThresholds.${name}`, value);
  if (!(thresholds.WATCH <= thresholds.CANDIDATE && thresholds.CANDIDATE <= thresholds.FOCUS && thresholds.FOCUS <= thresholds.DEEP_FOCUS)) {
    throw new RangeError('invalid attention config: priority thresholds must be ascending');
  }
  safeDuration('hintStaleAfterMs', config.hintStaleAfterMs);
  safeDuration('maxFutureHintSkewMs', config.maxFutureHintSkewMs);
  safeDuration('signalHoldMs', config.signalHoldMs);
  safeDuration('promotionCooldownMs', config.promotionCooldownMs);
  safeCap('maxHintsPerPlan', config.maxHintsPerPlan);
  safeCap('maxHintsPerInstrument', config.maxHintsPerInstrument);
  if (config.maxHintsPerPlan === 0 || config.maxHintsPerInstrument === 0 || config.maxHintsPerInstrument > config.maxHintsPerPlan) {
    throw new RangeError('invalid attention config: hint bounds must satisfy 0 < per-instrument <= per-plan');
  }

  for (const state of SOURCE_QUALITY_STATES) {
    const ceiling = config.sourceTierCeilings[state];
    if (!ATTENTION_TIERS.includes(ceiling)) {
      throw new RangeError(`invalid attention config sourceTierCeilings.${state}`);
    }
  }
  for (const state of FOCUS_ELIGIBILITY_STATES) {
    const ceiling = config.focusEligibilityTierCeilings[state];
    if (!ATTENTION_TIERS.includes(ceiling)) {
      throw new RangeError(`invalid attention config focusEligibilityTierCeilings.${state}`);
    }
    if (state !== 'ELIGIBLE' && (ceiling === 'FOCUS' || ceiling === 'DEEP_FOCUS')) {
      throw new RangeError(`invalid attention config: ${state} focus eligibility must remain below FOCUS`);
    }
  }
  for (const tier of ATTENTION_TIERS) {
    const value = config.profiles[tier];
    if (!value || !Array.isArray(value.requestedEvidence) || !Array.isArray(value.requestedFeatures)) {
      throw new RangeError(`invalid attention config profiles.${tier}`);
    }
    if (value.requestedEvidence.some((kind) => !EVIDENCE_KINDS.includes(kind))) {
      throw new RangeError(`invalid attention config profiles.${tier}.requestedEvidence`);
    }
    if (value.requestedFeatures.some((feature) => typeof feature !== 'string' || feature.trim().length === 0)) {
      throw new RangeError(`invalid attention config profiles.${tier}.requestedFeatures`);
    }
    if (value.requestedEvidence.length > 128 || value.requestedFeatures.length > 256 || value.requestedFeatures.some((feature) => feature.length > 128)) {
      throw new RangeError(`invalid attention config profiles.${tier}: profile exceeds bounded size`);
    }
  }
  if (config.profiles.RELEASED.requestedEvidence.length > 0 || config.profiles.RELEASED.requestedFeatures.length > 0) {
    throw new RangeError('invalid attention config: RELEASED must request no resources');
  }
  for (let index = 1; index < ACTIVE_TIERS_FOR_PROFILES.length; index += 1) {
    const lower = config.profiles[ACTIVE_TIERS_FOR_PROFILES[index - 1]];
    const upper = config.profiles[ACTIVE_TIERS_FOR_PROFILES[index]];
    if (lower.requestedEvidence.some((item) => !upper.requestedEvidence.includes(item)) || lower.requestedFeatures.some((item) => !upper.requestedFeatures.includes(item))) {
      throw new RangeError(`invalid attention config: ${ACTIVE_TIERS_FOR_PROFILES[index]} profile must include lower-tier resources`);
    }
  }
  return config;
}

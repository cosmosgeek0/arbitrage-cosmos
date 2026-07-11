import {
  sortedUnique,
  type AttentionTier,
  type EvidenceKind,
  type InstrumentIdentity,
  type TruthMetadata,
} from '../../intelligenceFoundation/contracts/index.js';
import {
  attentionConfig,
  type AttentionPlan,
  type AttentionSourceQuality,
} from '../../intelligenceFoundation/attention/index.js';
import {
  featureBankConfig,
} from '../../intelligenceFoundation/features/index.js';
import { forensicsConfig } from '../../intelligenceFoundation/forensics/index.js';
import {
  THESIS_FEATURE_BINDINGS,
  thesisRules,
  type ThesisFeatureBindings,
} from '../../intelligenceFoundation/thesis/index.js';
import type { UniverseMarketNode } from '../../intelligenceFoundation/universe/index.js';
import { deepFreeze } from './boundedIndex.js';
import type {
  IntelligenceBridgeConfig,
  IntelligenceBridgeConfigInput,
  ProjectedFeatureBinding,
  PublicAttentionProjection,
} from './types.js';

const DAY_MS = 24 * 60 * 60_000;

const DEFAULT_LIMITS = Object.freeze({
  maximumUniverseNodes: 640,
  maximumEvidenceBatch: 4_096,
  maximumEvidenceBytes: 2 * 1024 * 1024,
  maximumEvidenceNodes: 16_384,
  maximumEvidenceStringBytes: 16_384,
  maximumEvidenceArrayLength: 4_096,
  maximumEvidenceNestingDepth: 32,
  maximumDepthLevels: 2_000,
  maximumProvenanceIds: 256,
  maximumIndexedEvidence: 65_536,
  maximumEvidencePerSymbol: 2_048,
  maximumEvidencePerSymbolKind: 512,
  maximumLineageEntries: 131_072,
  maximumCorrelationRootsPerEntry: 32,
  maximumArtifacts: 128,
  maximumFailureRecords: 512,
  maximumHintPorts: 8,
  maximumThesisEvidence: 2_048,
  maximumThesisFeatures: 1_024,
});

const THESIS_BINDINGS: ThesisFeatureBindings = Object.freeze({
  ...THESIS_FEATURE_BINDINGS,
  spotRelativeVolume: 'relative_quote_volume',
  spotArrivalAcceleration: 'spot_trade_arrival_acceleration',
  symbolReturnPct: 'spot_price_change_pct',
  spotReturnPct: 'spot_price_change_pct',
  perpetualReturnPct: 'perpetual_price_change_pct',
  aggressorImbalance: 'spot_aggressor_imbalance',
  priceResponsePerFlow: 'spot_price_response_per_million_flow',
  fundingRateChange: 'funding_rate_change_bps',
  openInterestChangePct: 'open_interest_quote_change_pct',
  symbolMarketResidualReturnPct: 'symbol_specific_return_pct',
});

function boundedInteger(value: number, name: string, minimum = 1, maximum = 1_000_000): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function boundedVersion(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw new TypeError('bridge configurationVersion must be a bounded non-empty string');
  }
  return value;
}

export function intelligenceBridgeConfig(input: IntelligenceBridgeConfigInput = {}): IntelligenceBridgeConfig {
  const limits = {
    maximumUniverseNodes: boundedInteger(input.maximumUniverseNodes ?? DEFAULT_LIMITS.maximumUniverseNodes, 'maximumUniverseNodes', 1, 20_000),
    maximumEvidenceBatch: boundedInteger(input.maximumEvidenceBatch ?? DEFAULT_LIMITS.maximumEvidenceBatch, 'maximumEvidenceBatch', 1, 100_000),
    maximumEvidenceBytes: boundedInteger(input.maximumEvidenceBytes ?? DEFAULT_LIMITS.maximumEvidenceBytes, 'maximumEvidenceBytes', 512, 32 * 1024 * 1024),
    maximumEvidenceNodes: boundedInteger(input.maximumEvidenceNodes ?? DEFAULT_LIMITS.maximumEvidenceNodes, 'maximumEvidenceNodes', 16, 1_000_000),
    maximumEvidenceStringBytes: boundedInteger(input.maximumEvidenceStringBytes ?? DEFAULT_LIMITS.maximumEvidenceStringBytes, 'maximumEvidenceStringBytes', 16, 1_000_000),
    maximumEvidenceArrayLength: boundedInteger(input.maximumEvidenceArrayLength ?? DEFAULT_LIMITS.maximumEvidenceArrayLength, 'maximumEvidenceArrayLength', 1, 100_000),
    maximumEvidenceNestingDepth: boundedInteger(input.maximumEvidenceNestingDepth ?? DEFAULT_LIMITS.maximumEvidenceNestingDepth, 'maximumEvidenceNestingDepth', 1, 128),
    maximumDepthLevels: boundedInteger(input.maximumDepthLevels ?? DEFAULT_LIMITS.maximumDepthLevels, 'maximumDepthLevels', 1, 50_000),
    maximumProvenanceIds: boundedInteger(input.maximumProvenanceIds ?? DEFAULT_LIMITS.maximumProvenanceIds, 'maximumProvenanceIds', 1, 10_000),
    maximumIndexedEvidence: boundedInteger(input.maximumIndexedEvidence ?? DEFAULT_LIMITS.maximumIndexedEvidence, 'maximumIndexedEvidence'),
    maximumEvidencePerSymbol: boundedInteger(input.maximumEvidencePerSymbol ?? DEFAULT_LIMITS.maximumEvidencePerSymbol, 'maximumEvidencePerSymbol'),
    maximumEvidencePerSymbolKind: boundedInteger(input.maximumEvidencePerSymbolKind ?? DEFAULT_LIMITS.maximumEvidencePerSymbolKind, 'maximumEvidencePerSymbolKind'),
    maximumLineageEntries: boundedInteger(input.maximumLineageEntries ?? DEFAULT_LIMITS.maximumLineageEntries, 'maximumLineageEntries'),
    maximumCorrelationRootsPerEntry: boundedInteger(input.maximumCorrelationRootsPerEntry ?? DEFAULT_LIMITS.maximumCorrelationRootsPerEntry, 'maximumCorrelationRootsPerEntry', 1, 256),
    maximumArtifacts: boundedInteger(input.maximumArtifacts ?? DEFAULT_LIMITS.maximumArtifacts, 'maximumArtifacts', 1, 10_000),
    maximumFailureRecords: boundedInteger(input.maximumFailureRecords ?? DEFAULT_LIMITS.maximumFailureRecords, 'maximumFailureRecords', 1, 10_000),
    maximumHintPorts: boundedInteger(input.maximumHintPorts ?? DEFAULT_LIMITS.maximumHintPorts, 'maximumHintPorts', 1, 64),
    maximumThesisEvidence: boundedInteger(input.maximumThesisEvidence ?? DEFAULT_LIMITS.maximumThesisEvidence, 'maximumThesisEvidence', 1, 20_000),
    maximumThesisFeatures: boundedInteger(input.maximumThesisFeatures ?? DEFAULT_LIMITS.maximumThesisFeatures, 'maximumThesisFeatures', 1, 5_000),
  };
  if (!(limits.maximumEvidencePerSymbolKind <= limits.maximumEvidencePerSymbol
    && limits.maximumEvidencePerSymbol <= limits.maximumIndexedEvidence)) {
    throw new RangeError('evidence limits must satisfy per-kind <= per-symbol <= total');
  }
  if (limits.maximumThesisEvidence > limits.maximumIndexedEvidence) {
    throw new RangeError('maximumThesisEvidence cannot exceed indexed evidence capacity');
  }
  const featureBank = featureBankConfig({
    maxSymbols: limits.maximumUniverseNodes,
    maxInstrumentsPerSymbol: 3,
    maxRecordsPerKind: 512,
    historyRetentionMs: DAY_MS,
    baselineCapacity: 1_440,
    maxProvenanceIds: 128,
    ...(input.featureBank ?? {}),
  });
  if (featureBank.maxSymbols < limits.maximumUniverseNodes) {
    throw new RangeError('feature bank must cover the configured bridge universe');
  }
  const derivedCaps = {
    UNIVERSE: limits.maximumUniverseNodes,
    WATCH: Math.min(512, limits.maximumUniverseNodes),
    CANDIDATE: Math.min(128, limits.maximumUniverseNodes),
    FOCUS: Math.min(25, limits.maximumUniverseNodes),
    DEEP_FOCUS: Math.min(10, limits.maximumUniverseNodes),
    RELEASED: limits.maximumUniverseNodes,
  };
  const attention = attentionConfig({
    ...input.attention,
    configurationVersion: input.attention?.configurationVersion ?? 'live-intelligence-bridge-attention-1',
    tierCaps: { ...derivedCaps, ...(input.attention?.tierCaps ?? {}) },
  });
  if (attention.tierCaps.UNIVERSE < limits.maximumUniverseNodes || attention.tierCaps.RELEASED < limits.maximumUniverseNodes) {
    throw new RangeError('attention planner must cover the configured bridge universe');
  }
  const forensics = forensicsConfig({
    maxEvidenceRecords: limits.maximumThesisEvidence,
    maxFeatureRecords: limits.maximumThesisFeatures,
    ...(input.forensics ?? {}),
  });
  if (forensics.maxEvidenceRecords < limits.maximumThesisEvidence || forensics.maxFeatureRecords < limits.maximumThesisFeatures) {
    throw new RangeError('forensics bounds cannot be below bridge thesis input bounds');
  }
  const thesis = thesisRules({
    version: 'live-intelligence-bridge-thesis-rules-1',
    bindings: THESIS_BINDINGS,
    // The feature bank emits basis points, while the frozen thesis default is
    // expressed as a decimal funding-rate change. One bp is the exact unit
    // conversion of the default 0.0001 threshold.
    fundingChangeAbs: 1,
  });
  return deepFreeze({
    configurationVersion: boundedVersion(input.configurationVersion ?? 'live-intelligence-bridge-config-1'),
    ...limits,
    featureBank,
    attention,
    forensics,
    thesis,
  });
}

function direct(requestedFeature: string, featureNames: readonly string[], windowMs: number | null): ProjectedFeatureBinding {
  return deepFreeze({ requestedFeature, status: 'DIRECT', featureNames: [...featureNames], windowMs, reasonCodes: [] });
}

function composite(requestedFeature: string, featureNames: readonly string[], windowMs: number | null): ProjectedFeatureBinding {
  return deepFreeze({
    requestedFeature,
    status: 'COMPOSITE',
    featureNames: [...featureNames],
    windowMs,
    reasonCodes: ['MULTIPLE_FEATURE_FACTS_REQUIRED'],
  });
}

function unavailable(
  requestedFeature: string,
  status: 'UNAVAILABLE' | 'NON_EQUIVALENT',
  featureNames: readonly string[] = [],
): ProjectedFeatureBinding {
  return deepFreeze({
    requestedFeature,
    status,
    featureNames: [...featureNames],
    windowMs: null,
    reasonCodes: [status === 'UNAVAILABLE' ? 'FEATURE_NOT_PRODUCED_BY_FROZEN_BANK' : 'NEAR_MATCH_HAS_DIFFERENT_UNITS_OR_SEMANTICS'],
  });
}

export function projectRequestedFeature(requestedFeature: string): ProjectedFeatureBinding {
  const relative = /^relative_volume_(5s|15s|1m)$/.exec(requestedFeature);
  if (relative) {
    const windowMs = relative[1] === '5s' ? 5_000 : relative[1] === '15s' ? 15_000 : 60_000;
    return direct(requestedFeature, ['relative_quote_volume'], windowMs);
  }
  switch (requestedFeature) {
    case 'quote_volume_1m': return direct(requestedFeature, ['spot_quote_volume'], 60_000);
    case 'spread_bps': return direct(requestedFeature, ['spot_spread_bps'], null);
    case 'trade_arrival_rate_1m': return direct(requestedFeature, ['spot_trade_arrival_rate'], 60_000);
    case 'trade_arrival_acceleration': return direct(requestedFeature, ['spot_trade_arrival_acceleration'], null);
    case 'aggressor_imbalance_15s': return direct(requestedFeature, ['spot_aggressor_imbalance'], 15_000);
    case 'depth_imbalance': return direct(requestedFeature, ['spot_depth_imbalance'], null);
    case 'depth_slope': return direct(requestedFeature, ['spot_book_slope_bps_per_level'], null);
    case 'price_response_per_flow': return direct(requestedFeature, ['spot_price_response_per_million_flow'], null);
    case 'spot_perpetual_divergence': return direct(requestedFeature, ['spot_perpetual_divergence_pct'], null);
    case 'spot_perpetual_lead_lag': return composite(requestedFeature, ['spot_perpetual_lead_market', 'spot_perpetual_lead_lag_ms'], null);
    case 'large_trade_clustering': return composite(requestedFeature, ['spot_large_trade_count', 'spot_large_trade_cluster_count', 'spot_largest_trade_cluster_quote'], null);
    case 'crowding_change': return composite(requestedFeature, ['crowding_open_interest_change_pct', 'crowding_funding_rate_bps', 'crowding_liquidation_imbalance'], null);
    case 'market_specific_residual': return direct(requestedFeature, ['symbol_specific_return_pct'], null);
    case 'price_acceleration_15s': return unavailable(requestedFeature, 'UNAVAILABLE');
    case 'absorption_evidence': return unavailable(requestedFeature, 'NON_EQUIVALENT', ['spot_absorption_quote_per_pct']);
    case 'book_replenishment': return unavailable(requestedFeature, 'NON_EQUIVALENT', ['spot_depth_replenishment_ratio']);
    default: return unavailable(requestedFeature, 'UNAVAILABLE');
  }
}

export function projectPublicAttention(
  plan: AttentionPlan,
  rootsForAllocation: (allocationId: string, hintIds: readonly string[]) => readonly string[],
): PublicAttentionProjection {
  let excludedPrivateEvidenceCount = 0;
  const allocations = [...plan.allocations]
    .sort((left, right) => left.instrumentId < right.instrumentId ? -1 : left.instrumentId > right.instrumentId ? 1 : 0)
    .map((allocation) => {
      const excludedEvidence = allocation.requestedEvidence.filter((kind) => kind === 'BORROW');
      excludedPrivateEvidenceCount += excludedEvidence.length;
      const requestedEvidence = sortedUnique(allocation.requestedEvidence.filter((kind) => kind !== 'BORROW')) as EvidenceKind[];
      return deepFreeze({
        allocationId: allocation.id,
        instrumentId: allocation.instrumentId,
        symbol: allocation.symbol,
        tier: allocation.tier,
        priority: allocation.priority,
        protected: allocation.protected,
        requestedEvidence,
        excludedEvidence: sortedUnique(excludedEvidence) as EvidenceKind[],
        requestedFeatures: allocation.requestedFeatures.map(projectRequestedFeature),
        correlationIds: [...rootsForAllocation(allocation.id, allocation.hintIds)],
        reasonCodes: sortedUnique([
          ...(excludedEvidence.length > 0 ? ['PRIVATE_ENDPOINT_FORBIDDEN'] : []),
          ...(allocation.requestedEvidence.includes('CONTEXT') ? ['CONTEXT_REQUIRES_PUBLIC_OR_EXPLICIT_INJECTED_SOURCE'] : []),
        ]),
      });
    });
  return deepFreeze({
    sourcePlanId: plan.id,
    atMs: plan.atMs,
    allocations,
    excludedPrivateEvidenceCount,
    authority: 'PUBLIC_OBSERVATION_ONLY' as const,
  });
}

export function attentionTierRank(tier: AttentionTier): number {
  if (tier === 'RELEASED') return -1;
  return ['UNIVERSE', 'WATCH', 'CANDIDATE', 'FOCUS', 'DEEP_FOCUS'].indexOf(tier);
}

export function primaryInstrument(node: UniverseMarketNode): InstrumentIdentity | null {
  return node.spot?.instrument ?? node.usdMPerpetual?.instrument ?? null;
}

export function derivedSourceQuality(node: UniverseMarketNode): AttentionSourceQuality {
  const truths = [node.spot?.truth, node.usdMPerpetual?.truth]
    .filter((truth): truth is TruthMetadata => truth !== undefined);
  if (truths.length === 0) return { state: 'FAILED', reasonCodes: ['NO_PUBLIC_MARKET_LEG'] };
  if (truths.some((truth) => truth.freshness.state === 'STALE')) {
    return { state: 'STALE', reasonCodes: ['PUBLIC_MARKET_LEG_STALE'] };
  }
  if (truths.every((truth) => truth.freshness.state === 'UNAVAILABLE')) {
    return { state: 'FAILED', reasonCodes: ['PUBLIC_MARKET_LEGS_UNAVAILABLE'] };
  }
  if (truths.some((truth) => truth.freshness.state !== 'FRESH' || truth.completeness.state !== 'COMPLETE')) {
    return { state: 'DEGRADED', reasonCodes: ['PUBLIC_MARKET_LEG_PARTIAL'] };
  }
  return { state: 'HEALTHY', reasonCodes: [] };
}

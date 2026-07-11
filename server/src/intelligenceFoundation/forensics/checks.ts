import {
  sortedUnique,
  stableSetId,
  type FeatureValue,
  type NormalizedDepth,
  type NormalizedEvidence,
  type NormalizedLiquidation,
  type NormalizedTrade,
  type TruthMetadata,
} from '../contracts/index.js';
import type { ForensicsConfig } from './config.js';
import { derivedForensicsTruth } from './truth.js';
import type {
  ForensicCheckKind,
  ForensicCheckResult,
  ForensicMetric,
  ForensicsInput,
  HistoricalWakeupEpisode,
} from './types.js';

interface CheckContext {
  input: ForensicsInput;
  config: Readonly<ForensicsConfig>;
}

interface CheckDraft {
  check: ForensicCheckKind;
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  severity: 'BLOCK' | 'WARN';
  required: boolean;
  reasonCodes: readonly string[];
  evidence?: readonly NormalizedEvidence[];
  features?: readonly FeatureValue[];
  history?: readonly HistoricalWakeupEpisode[];
  metrics?: readonly ForensicMetric[];
  missingFields?: readonly string[];
  transforms?: readonly string[];
}

interface FeatureSelection {
  feature: FeatureValue | null;
  seen: FeatureValue[];
}

interface PriceSignal {
  value: number | null;
  evidence: NormalizedTrade[];
  features: FeatureValue[];
}

const RELEVANT_FEATURES = new Set([
  'relative_quote_volume',
  'session_relative_quote_volume',
  'spot_price_change_pct',
  'spot_quote_volume',
  'market_spot_return_pct',
  'symbol_specific_return_pct',
  'long_liquidation_quote',
  'short_liquidation_quote',
]);

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function evidenceTime(record: NormalizedEvidence): number {
  return record.truth.temporal.sourceTransactionTimeMs
    ?? record.truth.temporal.sourceEventTimeMs
    ?? record.truth.temporal.receivedTimeMs;
}

function featureTime(feature: FeatureValue): number {
  return feature.observationEndMs
    ?? feature.truth.temporal.sourceTransactionTimeMs
    ?? feature.truth.temporal.sourceEventTimeMs
    ?? feature.truth.temporal.receivedTimeMs;
}

function truthBasisTime(truth: TruthMetadata): number | null {
  switch (truth.freshness.basis) {
    case 'SOURCE_EVENT_TIME': return truth.temporal.sourceEventTimeMs;
    case 'SOURCE_TRANSACTION_TIME': return truth.temporal.sourceTransactionTimeMs;
    case 'RECEIVE_TIME': return truth.temporal.receivedTimeMs;
    case 'UNAVAILABLE': return null;
  }
}

function truthFreshAtEvaluation(context: CheckContext, truth: TruthMetadata): boolean {
  if (truth.freshness.state !== 'FRESH' || truth.completeness.state !== 'COMPLETE') return false;
  const basis = truthBasisTime(truth);
  if (basis === null || basis > context.input.evaluatedAtMs) return false;
  const declaredMaximum = truth.freshness.maxAgeMs ?? context.config.maxFreshAgeMs;
  const ageAtEvaluation = context.input.evaluatedAtMs - basis;
  return ageAtEvaluation <= Math.min(declaredMaximum, context.config.maxFreshAgeMs);
}

function evidenceUsable(context: CheckContext, record: NormalizedEvidence): boolean {
  return truthFreshAtEvaluation(context, record.truth);
}

function featureUsable(context: CheckContext, feature: FeatureValue): boolean {
  if (
    feature.featureVersion !== context.input.featureVersion ||
    feature.value === null
  ) return false;
  return truthFreshAtEvaluation(context, feature.truth);
}

function inWindow(timeMs: number, context: CheckContext, windowMs: number): boolean {
  return timeMs >= context.input.evaluatedAtMs - windowMs && timeMs <= context.input.evaluatedAtMs;
}

function spotTrades(context: CheckContext, windowMs: number, usableOnly: boolean): NormalizedTrade[] {
  return context.input.evidence
    .filter((record): record is NormalizedTrade =>
      record.kind === 'TRADE' &&
      record.instrument.productFamily === 'SPOT' &&
      inWindow(evidenceTime(record), context, windowMs) &&
      (!usableOnly || evidenceUsable(context, record)))
    .sort((left, right) => evidenceTime(left) - evidenceTime(right) || codePointCompare(left.id, right.id));
}

function depthSnapshots(context: CheckContext, windowMs: number, usableOnly: boolean): NormalizedDepth[] {
  return context.input.evidence
    .filter((record): record is NormalizedDepth =>
      record.kind === 'DEPTH_SNAPSHOT' &&
      record.instrument.productFamily === 'SPOT' &&
      inWindow(evidenceTime(record), context, windowMs) &&
      (!usableOnly || evidenceUsable(context, record)))
    .sort((left, right) => evidenceTime(left) - evidenceTime(right) || codePointCompare(left.id, right.id));
}

function liquidations(context: CheckContext, windowMs: number, usableOnly: boolean): NormalizedLiquidation[] {
  return context.input.evidence
    .filter((record): record is NormalizedLiquidation =>
      record.kind === 'LIQUIDATION' &&
      inWindow(evidenceTime(record), context, windowMs) &&
      (!usableOnly || evidenceUsable(context, record)))
    .sort((left, right) => evidenceTime(left) - evidenceTime(right) || codePointCompare(left.id, right.id));
}

function selectFeature(context: CheckContext, names: readonly string[], windowMs: number): FeatureSelection {
  const seen = context.input.features
    .filter((feature) =>
      feature.instrumentId === context.input.instrumentId &&
      names.includes(feature.feature) &&
      feature.windowMs === windowMs)
    .sort((left, right) => featureTime(right) - featureTime(left) || codePointCompare(left.id, right.id));
  for (const name of names) {
    const selected = seen.find((feature) => feature.feature === name && featureUsable(context, feature));
    if (selected) return { feature: selected, seen };
  }
  return { feature: null, seen };
}

function numeric(feature: FeatureValue | null): number | null {
  return feature && typeof feature.value === 'number' && Number.isFinite(feature.value) ? feature.value : null;
}

function priceSignal(context: CheckContext, windowMs: number): PriceSignal {
  const selected = selectFeature(context, ['spot_price_change_pct'], windowMs);
  const featureValue = numeric(selected.feature);
  if (featureValue !== null) return { value: featureValue, evidence: [], features: [selected.feature as FeatureValue] };
  const trades = spotTrades(context, windowMs, true);
  if (trades.length < 2 || trades[0].price <= 0) return { value: null, evidence: trades, features: selected.seen };
  return {
    value: ((trades[trades.length - 1].price - trades[0].price) / trades[0].price) * 100,
    evidence: trades,
    features: selected.seen,
  };
}

function observationRange(
  evidence: readonly NormalizedEvidence[],
  features: readonly FeatureValue[],
  history: readonly HistoricalWakeupEpisode[],
): { start: number | null; end: number | null } {
  const times: number[] = [];
  for (const record of evidence) times.push(evidenceTime(record));
  for (const feature of features) {
    if (feature.observationStartMs !== null) times.push(feature.observationStartMs);
    if (feature.observationEndMs !== null) times.push(feature.observationEndMs);
  }
  for (const episode of history) {
    times.push(episode.triggerTimeMs, episode.triggerTimeMs + episode.horizonMs);
  }
  return times.length === 0 ? { start: null, end: null } : { start: Math.min(...times), end: Math.max(...times) };
}

function metricOrder(left: ForensicMetric, right: ForensicMetric): number {
  return codePointCompare(left.name, right.name);
}

function makeCheck(context: CheckContext, draft: CheckDraft): ForensicCheckResult {
  const evidence = [...(draft.evidence ?? [])];
  const features = [...(draft.features ?? [])];
  const history = [...(draft.history ?? [])];
  // This field is a strict foreign key into a frozen packet's normalized
  // evidence array. Feature and historical provenance remains available in
  // featureIds and truth.provenance; mixing those IDs here breaks composition.
  const evidenceIds = sortedUnique(evidence.map((record) => record.id))
    .slice(0, context.config.maxProvenanceIds);
  const featureIds = sortedUnique(features.map((feature) => feature.id)).slice(0, context.config.maxProvenanceIds);
  const reasonCodes = sortedUnique(draft.reasonCodes);
  const metrics = [...(draft.metrics ?? [])].sort(metricOrder);
  const range = observationRange(evidence, features, history);
  const missingFields = draft.verdict === 'UNKNOWN'
    ? [...(draft.missingFields ?? [`forensics.${draft.check}.requiredEvidence`])]
    : [];
  const truths = [
    ...evidence.map((record) => record.truth),
    ...features.map((feature) => feature.truth),
    ...history.map((episode) => episode.truth),
  ];
  const truth = derivedForensicsTruth({
    config: context.config,
    configurationVersion: context.input.configurationVersion,
    featureVersion: context.input.featureVersion,
    dataset: draft.check,
    evaluatedAtMs: context.input.evaluatedAtMs,
    truths,
    recordIds: [
      ...evidence.map((record) => record.id),
      ...features.map((feature) => feature.id),
      ...history.map((episode) => episode.id),
    ],
    transforms: [draft.check.toLowerCase(), ...(draft.transforms ?? [])],
    observedFields: draft.verdict === 'UNKNOWN' && truths.length === 0 ? [] : [`forensics.${draft.check}.verdict`],
    missingFields,
    reasonCodes,
  });
  const id = stableSetId('forensic-check', {
    check: draft.check,
    symbol: context.input.symbol,
    instrumentId: context.input.instrumentId,
    evaluatedAtMs: context.input.evaluatedAtMs,
    candidateObservedAtMs: context.input.candidateObservedAtMs,
    verdict: draft.verdict,
    severity: draft.severity,
    required: draft.required,
    reasonCodes,
    evidenceIds,
    featureIds,
    observationStartMs: range.start,
    observationEndMs: range.end,
    metrics,
    rulesVersion: context.config.rulesVersion,
  }, ['reasonCodes', 'evidenceIds', 'featureIds']);
  return {
    id,
    check: draft.check,
    verdict: draft.verdict,
    severity: draft.severity,
    required: draft.required,
    reasonCodes,
    evidenceIds,
    featureIds,
    observationStartMs: range.start,
    observationEndMs: range.end,
    metrics,
    truth,
  };
}

function onePrintCheck(context: CheckContext): ForensicCheckResult {
  const all = spotTrades(context, context.config.shortWindowMs, false);
  const trades = all.filter((trade) => evidenceUsable(context, trade));
  if (trades.length === 0) return makeCheck(context, {
    check: 'ONE_PRINT_OR_CONCENTRATED_SPIKE', verdict: 'UNKNOWN', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_SPOT_PRINTS_UNAVAILABLE'], evidence: all,
  });
  const total = trades.reduce((sum, trade) => sum + trade.quoteQuantity, 0);
  const largest = Math.max(...trades.map((trade) => trade.quoteQuantity));
  const dominance = total > 0 ? largest / total : 1;
  const failed = trades.length <= context.config.onePrintMaximumTrades || dominance >= context.config.onePrintDominanceRatio;
  return makeCheck(context, {
    check: 'ONE_PRINT_OR_CONCENTRATED_SPIKE', verdict: failed ? 'FAIL' : 'PASS', severity: 'BLOCK', required: true,
    reasonCodes: [failed ? 'FORENSICS_PRINT_CONCENTRATION_DETECTED' : 'FORENSICS_PRINT_DISTRIBUTION_OBSERVED'],
    evidence: trades,
    metrics: [
      { name: 'largest_print_share', value: dominance, unit: 'ratio' },
      { name: 'spot_trade_count', value: trades.length, unit: 'trades' },
      { name: 'spot_quote_volume', value: total, unit: 'quote_asset' },
    ],
    // Aggregate public trades cannot identify participants; concentration is an explicit proxy.
    transforms: ['public-aggregate-trade-concentration-proxy'],
  });
}

function dominantSizeClusterRatio(trades: readonly NormalizedTrade[], tolerance: number): number {
  const sizes = trades.map((trade) => trade.quoteQuantity).sort((left, right) => left - right);
  let left = 0;
  let maximum = 0;
  for (let right = 0; right < sizes.length; right += 1) {
    while (sizes[right] > sizes[left] * (1 + tolerance)) left += 1;
    maximum = Math.max(maximum, right - left + 1);
  }
  return sizes.length === 0 ? 0 : maximum / sizes.length;
}

function washCheck(context: CheckContext): ForensicCheckResult {
  const all = spotTrades(context, context.config.confirmationWindowMs, false);
  const trades = all.filter((trade) => evidenceUsable(context, trade));
  if (trades.length < context.config.washMinimumTrades) return makeCheck(context, {
    check: 'WASH_LIKE_PING_PONG_CHURN', verdict: 'UNKNOWN', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_WASH_SAMPLE_INSUFFICIENT'], evidence: all,
    metrics: [{ name: 'spot_trade_count', value: trades.length, unit: 'trades' }],
  });
  let alternations = 0;
  let knownPairs = 0;
  for (let index = 1; index < trades.length; index += 1) {
    const previous = trades[index - 1].aggressorSide;
    const current = trades[index].aggressorSide;
    if (previous === 'UNKNOWN' || current === 'UNKNOWN') continue;
    knownPairs += 1;
    if (previous !== current) alternations += 1;
  }
  const total = trades.reduce((sum, trade) => sum + trade.quoteQuantity, 0);
  const buy = trades.filter((trade) => trade.aggressorSide === 'BUY').reduce((sum, trade) => sum + trade.quoteQuantity, 0);
  const sell = trades.filter((trade) => trade.aggressorSide === 'SELL').reduce((sum, trade) => sum + trade.quoteQuantity, 0);
  const known = buy + sell;
  const knownRatio = total > 0 ? known / total : 0;
  const knownPairRatio = trades.length > 1 ? knownPairs / (trades.length - 1) : 0;
  const balance = known > 0 ? 1 - Math.abs(buy - sell) / known : 0;
  const alternation = knownPairs > 0 ? alternations / knownPairs : 0;
  const repeated = dominantSizeClusterRatio(trades, context.config.washSizeToleranceRatio);
  const minimum = Math.min(...trades.map((trade) => trade.price));
  const maximum = Math.max(...trades.map((trade) => trade.price));
  const priceRangePct = minimum > 0 ? ((maximum - minimum) / minimum) * 100 : Number.MAX_VALUE;
  const metrics: ForensicMetric[] = [
    { name: 'aggressor_alternation', value: alternation, unit: 'ratio' },
    { name: 'aggressor_known_notional', value: knownRatio, unit: 'ratio' },
    { name: 'aggressor_known_pair_coverage', value: knownPairRatio, unit: 'ratio' },
    { name: 'buy_sell_balance', value: balance, unit: 'ratio' },
    { name: 'price_range', value: priceRangePct, unit: 'percent' },
    { name: 'repeated_size_cluster', value: repeated, unit: 'ratio' },
  ];
  if (
    knownRatio < context.config.washKnownAggressorRatio ||
    knownPairRatio < context.config.washKnownAggressorRatio
  ) return makeCheck(context, {
    check: 'WASH_LIKE_PING_PONG_CHURN', verdict: 'UNKNOWN', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_WASH_AGGRESSOR_COVERAGE_INSUFFICIENT'],
    evidence: trades,
    metrics,
    missingFields: ['trade.aggressorSide'],
    transforms: ['balanced-alternating-repeated-size-churn-proxy'],
  });
  const failed =
    balance >= context.config.washBuySellBalanceRatio &&
    alternation >= context.config.washAlternationRatio &&
    repeated >= context.config.washRepeatedSizeRatio &&
    priceRangePct <= context.config.washMaximumPriceRangePct;
  return makeCheck(context, {
    check: 'WASH_LIKE_PING_PONG_CHURN', verdict: failed ? 'FAIL' : 'PASS', severity: 'BLOCK', required: true,
    reasonCodes: [failed ? 'FORENSICS_WASH_LIKE_CHURN_DETECTED' : 'FORENSICS_WASH_PATTERN_NOT_OBSERVED'],
    evidence: trades,
    metrics,
    transforms: ['balanced-alternating-repeated-size-churn-proxy'],
  });
}

function volumeNoResponseCheck(context: CheckContext): ForensicCheckResult {
  const relative = selectFeature(context, ['relative_quote_volume', 'session_relative_quote_volume'], context.config.confirmationWindowMs);
  const relativeValue = numeric(relative.feature);
  const price = priceSignal(context, context.config.confirmationWindowMs);
  const features = sortedFeatureUnion(relative.feature ? [relative.feature] : relative.seen, price.features);
  if (relativeValue === null || relativeValue < 0 || price.value === null) return makeCheck(context, {
    check: 'VOLUME_WITHOUT_PRICE_RESPONSE', verdict: 'UNKNOWN', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_RELATIVE_VOLUME_OR_PRICE_RESPONSE_UNAVAILABLE'], evidence: price.evidence, features,
  });
  const failed = relativeValue >= context.config.abnormalVolumeMultiple && Math.abs(price.value) <= context.config.maximumNoResponsePct;
  return makeCheck(context, {
    check: 'VOLUME_WITHOUT_PRICE_RESPONSE', verdict: failed ? 'FAIL' : 'PASS', severity: 'BLOCK', required: true,
    reasonCodes: [failed ? 'FORENSICS_VOLUME_WITHOUT_RESPONSE_DETECTED' : 'FORENSICS_VOLUME_PRICE_RESPONSE_ACCEPTABLE'],
    evidence: price.evidence, features,
    metrics: [
      { name: 'relative_quote_volume', value: relativeValue, unit: 'multiple' },
      { name: 'spot_price_change', value: price.value, unit: 'percent' },
    ],
  });
}

function depthNotional(depth: NormalizedDepth): number {
  return [...depth.bids, ...depth.asks].reduce((sum, level) => sum + level.price * level.baseQuantity, 0);
}

function thinDepthCheck(context: CheckContext): ForensicCheckResult {
  const price = priceSignal(context, context.config.confirmationWindowMs);
  if (price.value === null) return makeCheck(context, {
    check: 'PRICE_JUMP_ON_THIN_OR_DISAPPEARING_DEPTH', verdict: 'UNKNOWN', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_PRICE_PATH_UNAVAILABLE'], evidence: price.evidence, features: price.features,
  });
  if (Math.abs(price.value) < context.config.minimumPriceJumpPct) return makeCheck(context, {
    check: 'PRICE_JUMP_ON_THIN_OR_DISAPPEARING_DEPTH', verdict: 'PASS', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_MATERIAL_PRICE_JUMP_NOT_OBSERVED'], evidence: price.evidence, features: price.features,
    metrics: [{ name: 'spot_price_change', value: price.value, unit: 'percent' }],
  });
  const all = depthSnapshots(context, context.config.confirmationWindowMs, false);
  const depths = all.filter((depth) => evidenceUsable(context, depth));
  if (depths.length === 0) return makeCheck(context, {
    check: 'PRICE_JUMP_ON_THIN_OR_DISAPPEARING_DEPTH', verdict: 'UNKNOWN', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_FRESH_DEPTH_UNAVAILABLE_FOR_PRICE_JUMP'], evidence: [...price.evidence, ...all], features: price.features,
  });
  const firstNotional = depthNotional(depths[0]);
  const latestNotional = depthNotional(depths[depths.length - 1]);
  const survival = depths.length >= 2 && firstNotional > 0 ? latestNotional / firstNotional : null;
  const thin = context.input.intendedQuoteNotional !== null &&
    latestNotional < context.input.intendedQuoteNotional * context.config.intendedDepthSupportRatio;
  const disappearing = survival !== null && survival <= context.config.maximumDepthSurvivalRatio;
  if (survival === null && !thin) return makeCheck(context, {
    check: 'PRICE_JUMP_ON_THIN_OR_DISAPPEARING_DEPTH', verdict: 'UNKNOWN', severity: 'BLOCK', required: true,
    reasonCodes: [context.input.intendedQuoteNotional === null
      ? 'FORENSICS_DEPTH_REFERENCE_OR_INTENDED_SIZE_UNAVAILABLE'
      : 'FORENSICS_DEPTH_SURVIVAL_UNAVAILABLE'],
    evidence: [...price.evidence, ...depths],
    features: price.features,
    missingFields: [context.input.intendedQuoteNotional === null ? 'intendedQuoteNotional' : 'depth.survival'],
    metrics: [
      { name: 'depth_survival', value: null, unit: 'ratio' },
      { name: 'latest_depth_notional', value: latestNotional, unit: 'quote_asset' },
      { name: 'spot_price_change', value: price.value, unit: 'percent' },
    ],
  });
  const failed = thin || disappearing;
  return makeCheck(context, {
    check: 'PRICE_JUMP_ON_THIN_OR_DISAPPEARING_DEPTH', verdict: failed ? 'FAIL' : 'PASS', severity: 'BLOCK', required: true,
    reasonCodes: [failed ? (thin ? 'FORENSICS_DEPTH_THIN_FOR_INTENDED_SIZE' : 'FORENSICS_DEPTH_DISAPPEARED_DURING_JUMP') : 'FORENSICS_DEPTH_SURVIVED_PRICE_JUMP'],
    evidence: [...price.evidence, ...depths], features: price.features,
    metrics: [
      { name: 'depth_survival', value: survival, unit: 'ratio' },
      { name: 'latest_depth_notional', value: latestNotional, unit: 'quote_asset' },
      { name: 'spot_price_change', value: price.value, unit: 'percent' },
    ],
  });
}

function pathMetrics(trades: readonly NormalizedTrade[]): { current: number; peak: number; peakIndex: number; retention: number; fade: number } {
  const origin = trades[0].price;
  const returns = trades.map((trade) => ((trade.price - origin) / origin) * 100);
  let peakIndex = 0;
  for (let index = 1; index < returns.length; index += 1) {
    if (Math.abs(returns[index]) > Math.abs(returns[peakIndex])) peakIndex = index;
  }
  const peak = returns[peakIndex];
  const current = returns[returns.length - 1];
  const directionalCurrent = Math.sign(peak) * current;
  const retention = peak === 0 ? 1 : Math.max(0, directionalCurrent / Math.abs(peak));
  return { current, peak, peakIndex, retention, fade: Math.max(0, 1 - Math.min(1, retention)) };
}

function exhaustedCheck(context: CheckContext): ForensicCheckResult {
  const all = spotTrades(context, context.config.mediumWindowMs, false);
  const trades = all.filter((trade) => evidenceUsable(context, trade));
  if (trades.length < 3) return makeCheck(context, {
    check: 'ALREADY_EXHAUSTED_MOVE', verdict: 'UNKNOWN', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_EXHAUSTION_PATH_INSUFFICIENT'], evidence: all,
  });
  const path = pathMetrics(trades);
  const failed = Math.abs(path.current) >= context.config.exhaustedCurrentMovePct ||
    (Math.abs(path.peak) >= context.config.exhaustionPeakMovePct && path.fade >= context.config.exhaustionFadeRatio);
  return makeCheck(context, {
    check: 'ALREADY_EXHAUSTED_MOVE', verdict: failed ? 'FAIL' : 'PASS', severity: 'BLOCK', required: true,
    reasonCodes: [failed ? 'FORENSICS_MOVE_ALREADY_EXHAUSTED' : 'FORENSICS_MOVE_NOT_EXHAUSTED'], evidence: trades,
    metrics: [
      { name: 'current_return', value: path.current, unit: 'percent' },
      { name: 'fade_from_peak', value: path.fade, unit: 'ratio' },
      { name: 'peak_excursion', value: path.peak, unit: 'percent' },
    ],
  });
}

function fakeFollowThroughCheck(context: CheckContext): ForensicCheckResult {
  const all = spotTrades(context, context.config.confirmationWindowMs, false);
  const trades = all.filter((trade) => evidenceUsable(context, trade));
  if (trades.length < 3) return makeCheck(context, {
    check: 'FAKE_FOLLOW_THROUGH', verdict: 'UNKNOWN', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_FOLLOW_THROUGH_PATH_INSUFFICIENT'], evidence: all,
  });
  const origin = trades[0].price;
  const returns = trades.map((trade) => ((trade.price - origin) / origin) * 100);
  const crossing = returns.findIndex((value, index) => index > 0 && Math.abs(value) >= context.config.fakeFollowThroughInitialMovePct);
  if (crossing < 0) return makeCheck(context, {
    check: 'FAKE_FOLLOW_THROUGH', verdict: 'PASS', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_FALSE_FOLLOW_THROUGH_NOT_TRIGGERED'], evidence: trades,
    metrics: [{ name: 'maximum_excursion', value: Math.max(...returns.map(Math.abs)), unit: 'percent' }],
  });
  if (crossing === trades.length - 1) return makeCheck(context, {
    check: 'FAKE_FOLLOW_THROUGH', verdict: 'UNKNOWN', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_POST_BREAKOUT_CONFIRMATION_NOT_OBSERVED'], evidence: trades,
  });
  const initial = returns[crossing];
  const current = returns[returns.length - 1];
  const retention = Math.sign(initial) * current / Math.abs(initial);
  const failed = retention < context.config.fakeFollowThroughMinimumRetentionRatio;
  return makeCheck(context, {
    check: 'FAKE_FOLLOW_THROUGH', verdict: failed ? 'FAIL' : 'PASS', severity: 'BLOCK', required: true,
    reasonCodes: [failed ? 'FORENSICS_FAKE_FOLLOW_THROUGH_DETECTED' : 'FORENSICS_FOLLOW_THROUGH_RETAINED'], evidence: trades,
    metrics: [
      { name: 'breakout_move', value: initial, unit: 'percent' },
      { name: 'current_move', value: current, unit: 'percent' },
      { name: 'follow_through_retention', value: retention, unit: 'ratio' },
    ],
  });
}

function episodeFade(episode: HistoricalWakeupEpisode): number | null {
  if (episode.fadeFromPeakPct !== null) return episode.fadeFromPeakPct;
  if (episode.peakReturnPct === null || episode.closingReturnPct === null || episode.peakReturnPct === 0) return null;
  return Math.max(0, Math.abs(episode.peakReturnPct) - Math.sign(episode.peakReturnPct) * episode.closingReturnPct);
}

function historyCheck(context: CheckContext): ForensicCheckResult {
  const supplied = [...context.input.history];
  const usable = supplied.filter((episode) =>
    episode.complete &&
    episode.truth.freshness.state === 'FRESH' &&
    episode.truth.completeness.state === 'COMPLETE' &&
    episode.triggerTimeMs + episode.horizonMs <= context.input.evaluatedAtMs &&
    episodeFade(episode) !== null);
  if (usable.length < context.config.minimumHistoryEpisodes) return makeCheck(context, {
    check: 'REPEATED_WAKEUP_FADE', verdict: 'UNKNOWN', severity: 'WARN', required: false,
    reasonCodes: [supplied.length === 0 ? 'FORENSICS_WAKEUP_HISTORY_NOT_SUPPLIED' : 'FORENSICS_WAKEUP_HISTORY_INSUFFICIENT'],
    history: supplied,
    metrics: [{ name: 'usable_history_episodes', value: usable.length, unit: 'episodes' }],
  });
  const fades = usable.filter((episode) => (episodeFade(episode) as number) >= context.config.historyFadeThresholdPct);
  const rate = fades.length / usable.length;
  const failed = rate >= context.config.historyFadeRate;
  return makeCheck(context, {
    check: 'REPEATED_WAKEUP_FADE', verdict: failed ? 'FAIL' : 'PASS', severity: 'WARN', required: false,
    reasonCodes: [failed ? 'FORENSICS_REPEATED_WAKEUP_FADE_DETECTED' : 'FORENSICS_WAKEUP_HISTORY_ACCEPTABLE'], history: usable,
    metrics: [
      { name: 'fade_episode_rate', value: rate, unit: 'ratio' },
      { name: 'usable_history_episodes', value: usable.length, unit: 'episodes' },
    ],
  });
}

function marketWideCheck(context: CheckContext): ForensicCheckResult {
  const symbol = selectFeature(context, ['spot_price_change_pct'], context.config.confirmationWindowMs);
  const market = selectFeature(context, ['market_spot_return_pct'], context.config.confirmationWindowMs);
  const residual = selectFeature(context, ['symbol_specific_return_pct'], context.config.confirmationWindowMs);
  const symbolValue = numeric(symbol.feature);
  const marketValue = numeric(market.feature);
  const residualValue = numeric(residual.feature) ?? (symbolValue !== null && marketValue !== null ? symbolValue - marketValue : null);
  const features = sortedFeatureUnion(
    symbol.feature ? [symbol.feature] : symbol.seen,
    market.feature ? [market.feature] : market.seen,
    residual.feature ? [residual.feature] : residual.seen,
  );
  if (symbolValue === null || marketValue === null || residualValue === null) return makeCheck(context, {
    check: 'MARKET_WIDE_MISCLASSIFICATION', verdict: 'UNKNOWN', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_MARKET_COMPARATOR_UNAVAILABLE'], features,
  });
  const share = Math.abs(symbolValue) > 0 ? Math.abs(marketValue) / Math.abs(symbolValue) : 0;
  const sameDirection = symbolValue === 0 || marketValue === 0 ? false : Math.sign(symbolValue) === Math.sign(marketValue);
  const failed =
    Math.abs(marketValue) >= context.config.marketMinimumMovePct &&
    Math.abs(residualValue) <= context.config.maximumSymbolSpecificResidualPct &&
    share >= context.config.minimumMarketShareRatio &&
    sameDirection;
  return makeCheck(context, {
    check: 'MARKET_WIDE_MISCLASSIFICATION', verdict: failed ? 'FAIL' : 'PASS', severity: 'BLOCK', required: true,
    reasonCodes: [failed ? 'FORENSICS_MARKET_WIDE_MOVE_MISCLASSIFIED' : 'FORENSICS_SYMBOL_MOVE_NOT_EXPLAINED_BY_MARKET'], features,
    metrics: [
      { name: 'market_return', value: marketValue, unit: 'percent' },
      { name: 'market_share_of_symbol_move', value: share, unit: 'ratio' },
      { name: 'symbol_return', value: symbolValue, unit: 'percent' },
      { name: 'symbol_specific_return', value: residualValue, unit: 'percent' },
    ],
  });
}

function liquidationCheck(context: CheckContext): ForensicCheckResult {
  const rawAll = liquidations(context, context.config.confirmationWindowMs, false);
  const raw = rawAll.filter((record) => evidenceUsable(context, record) && record.averagePrice !== null);
  const long = selectFeature(context, ['long_liquidation_quote'], context.config.confirmationWindowMs);
  const short = selectFeature(context, ['short_liquidation_quote'], context.config.confirmationWindowMs);
  const volume = selectFeature(context, ['spot_quote_volume'], context.config.confirmationWindowMs);
  const featureLiquidation = numeric(long.feature) !== null && numeric(short.feature) !== null
    ? (numeric(long.feature) as number) + (numeric(short.feature) as number)
    : null;
  const rawLiquidation = raw.reduce((sum, record) => sum + record.filledQuantity * (record.averagePrice as number), 0);
  const liquidationQuote = featureLiquidation ?? (raw.length > 0 ? rawLiquidation : null);
  const spot = numeric(volume.feature);
  const spotTradesForFallback = spotTrades(context, context.config.confirmationWindowMs, true);
  const spotQuote = spot ?? (spotTradesForFallback.length > 0
    ? spotTradesForFallback.reduce((sum, trade) => sum + trade.quoteQuantity, 0)
    : null);
  const features = sortedFeatureUnion(
    long.feature ? [long.feature] : long.seen,
    short.feature ? [short.feature] : short.seen,
    volume.feature ? [volume.feature] : volume.seen,
  );
  const evidence: NormalizedEvidence[] = [...rawAll, ...(spot === null ? spotTradesForFallback : [])];
  if (liquidationQuote === null || liquidationQuote < 0 || spotQuote === null || spotQuote < 0) return makeCheck(context, {
    check: 'LIQUIDATION_ONLY_BURST', verdict: 'UNKNOWN', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_LIQUIDATION_OR_ACTIVITY_NOTIONAL_UNAVAILABLE'], evidence, features,
  });
  const denominator = liquidationQuote + spotQuote;
  const share = denominator > 0 ? liquidationQuote / denominator : 0;
  const sampling = raw.length === 0 ? 'UNKNOWN' : raw.some((record) => record.sampledPerWindow) ? 'SAMPLED' : 'COMPLETE';
  const samplingSelection = raw.length === 0
    ? 'UNKNOWN'
    : sortedUnique(raw.map((record) => record.samplingSelection)).join('|');
  if (share >= context.config.liquidationDominanceRatio) return makeCheck(context, {
    check: 'LIQUIDATION_ONLY_BURST', verdict: 'FAIL', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_LIQUIDATION_DOMINATED_BURST'], evidence, features,
    metrics: [
      { name: 'liquidation_activity_share', value: share, unit: 'ratio' },
      { name: 'liquidation_sampling', value: sampling, unit: 'state' },
      { name: 'liquidation_sampling_selection', value: samplingSelection, unit: 'state' },
      { name: 'liquidation_quote_notional', value: liquidationQuote, unit: 'quote_asset' },
    ],
    transforms: ['sampled-force-order-notional-is-a-conservative-lower-bound'],
  });
  // A per-window source exposes only its selected event, whether largest, latest,
  // or unspecified; a sub-threshold sampled total cannot prove the full total.
  if (sampling !== 'COMPLETE') return makeCheck(context, {
    check: 'LIQUIDATION_ONLY_BURST', verdict: 'UNKNOWN', severity: 'BLOCK', required: true,
    reasonCodes: [sampling === 'SAMPLED' ? 'FORENSICS_SAMPLED_LIQUIDATION_LOWER_BOUND_INCONCLUSIVE' : 'FORENSICS_LIQUIDATION_SAMPLING_SCOPE_UNKNOWN'],
    evidence, features,
    metrics: [
      { name: 'liquidation_activity_share_lower_bound', value: share, unit: 'ratio' },
      { name: 'liquidation_sampling', value: sampling, unit: 'state' },
      { name: 'liquidation_sampling_selection', value: samplingSelection, unit: 'state' },
    ],
  });
  return makeCheck(context, {
    check: 'LIQUIDATION_ONLY_BURST', verdict: 'PASS', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_COMPLETE_LIQUIDATION_SHARE_ACCEPTABLE'], evidence, features,
    metrics: [
      { name: 'liquidation_activity_share', value: share, unit: 'ratio' },
      { name: 'liquidation_sampling', value: sampling, unit: 'state' },
      { name: 'liquidation_sampling_selection', value: samplingSelection, unit: 'state' },
    ],
  });
}

function latestRelevantFeatures(context: CheckContext): FeatureValue[] {
  const groups = new Map<string, FeatureValue[]>();
  for (const feature of context.input.features) {
    if (feature.instrumentId !== context.input.instrumentId || !RELEVANT_FEATURES.has(feature.feature)) continue;
    const key = `${feature.feature}\u0000${feature.windowMs ?? 'null'}`;
    const group = groups.get(key) ?? [];
    group.push(feature);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => group.sort((left, right) =>
    featureTime(right) - featureTime(left) || codePointCompare(left.id, right.id))[0]);
}

function qualityCheck(context: CheckContext): ForensicCheckResult {
  const evidence = context.input.evidence.filter((record) => inWindow(evidenceTime(record), context, context.config.mediumWindowMs));
  const features = latestRelevantFeatures(context);
  if (evidence.length === 0 && features.length === 0) return makeCheck(context, {
    check: 'STALE_OR_INCOMPLETE_EVIDENCE', verdict: 'UNKNOWN', severity: 'BLOCK', required: true,
    reasonCodes: ['FORENSICS_CURRENT_EVIDENCE_NOT_SUPPLIED'],
  });
  const staleEvidence = evidence.filter((record) =>
    record.truth.completeness.state === 'COMPLETE' && !truthFreshAtEvaluation(context, record.truth));
  const incompleteEvidence = evidence.filter((record) => record.truth.completeness.state !== 'COMPLETE');
  const staleFeatures = features.filter((feature) => !featureUsable(context, feature) && feature.truth.completeness.state === 'COMPLETE' && feature.value !== null && feature.featureVersion === context.input.featureVersion);
  const incompleteFeatures = features.filter((feature) => feature.truth.completeness.state !== 'COMPLETE' || feature.value === null);
  const versionMismatch = features.filter((feature) => feature.featureVersion !== context.input.featureVersion);
  const reasonCodes: string[] = [];
  if (staleEvidence.length > 0 || staleFeatures.length > 0) reasonCodes.push('FORENSICS_STALE_EVIDENCE_DETECTED');
  if (incompleteEvidence.length > 0 || incompleteFeatures.length > 0) reasonCodes.push('FORENSICS_INCOMPLETE_EVIDENCE_DETECTED');
  if (versionMismatch.length > 0) reasonCodes.push('FORENSICS_FEATURE_VERSION_MISMATCH');
  const failed = reasonCodes.length > 0;
  return makeCheck(context, {
    check: 'STALE_OR_INCOMPLETE_EVIDENCE', verdict: failed ? 'FAIL' : 'PASS', severity: 'BLOCK', required: true,
    reasonCodes: failed ? reasonCodes : ['FORENSICS_EVIDENCE_QUALITY_EXPLICIT_AND_CURRENT'], evidence, features,
    metrics: [
      { name: 'incomplete_record_count', value: incompleteEvidence.length + incompleteFeatures.length, unit: 'records' },
      { name: 'stale_record_count', value: staleEvidence.length + staleFeatures.length, unit: 'records' },
      { name: 'version_mismatch_count', value: versionMismatch.length, unit: 'records' },
    ],
  });
}

function sortedFeatureUnion(...groups: readonly FeatureValue[][]): FeatureValue[] {
  const byId = new Map<string, FeatureValue>();
  for (const feature of groups.flat()) byId.set(feature.id, feature);
  return [...byId.values()].sort((left, right) => codePointCompare(left.id, right.id));
}

export function runForensicChecks(input: ForensicsInput, config: Readonly<ForensicsConfig>): ForensicCheckResult[] {
  const context = { input, config };
  return [
    onePrintCheck(context),
    washCheck(context),
    volumeNoResponseCheck(context),
    thinDepthCheck(context),
    exhaustedCheck(context),
    fakeFollowThroughCheck(context),
    historyCheck(context),
    marketWideCheck(context),
    liquidationCheck(context),
    qualityCheck(context),
  ];
}

import {
  sortedUnique,
  stableSetId,
  type BaselineState,
  type FeatureValue,
  type NormalizedEvidence,
} from '../contracts/index.js';
import type { FeatureBankConfig } from './config.js';
import { robustValues, median, quantile } from './stats.js';
import { derivedTruth, featureValue, isUsableEvidenceTruth } from './truth.js';
import type { ActivityBucket, SymbolFeatureState } from './types.js';

function sessionBucketAt(timeMs: number, sessionBucketMs: number): string {
  const insideDay = ((timeMs % 86_400_000) + 86_400_000) % 86_400_000;
  const startHour = Math.floor(insideDay / sessionBucketMs) * (sessionBucketMs / 3_600_000);
  const endHour = startHour + sessionBucketMs / 3_600_000;
  return `UTC_${String(startHour).padStart(2, '0')}_${String(endHour).padStart(2, '0')}`;
}

export function activitySessionBucket(timeMs: number, config: FeatureBankConfig): string {
  return sessionBucketAt(timeMs, config.sessionBucketMs);
}

function recordsForBuckets(state: SymbolFeatureState, buckets: readonly ActivityBucket[]): NormalizedEvidence[] {
  const ids = new Set(buckets.flatMap((bucket) => bucket.evidenceIds));
  return (Object.values(state.evidence).flat() as NormalizedEvidence[])
    .filter((record) => ids.has(record.id));
}

function continuousCoverageForBucket(
  state: SymbolFeatureState,
  startMs: number,
  endMs: number,
): NormalizedEvidence | null {
  return state.evidence.CONTEXT.find((record) => (
    record.contextType === 'CONTINUOUS_TRADE_COVERAGE' &&
    record.scope === 'SYMBOL' &&
    record.instrument.productFamily === 'SPOT' &&
    isUsableEvidenceTruth(record) &&
    record.values.productFamily === 'SPOT' &&
    record.values.complete === true &&
    typeof record.values.startTimeMs === 'number' &&
    Number.isFinite(record.values.startTimeMs) &&
    typeof record.values.endTimeMs === 'number' &&
    Number.isFinite(record.values.endTimeMs) &&
    record.values.startTimeMs <= startMs &&
    record.values.endTimeMs >= endMs
  )) ?? null;
}

function valueOf(features: readonly FeatureValue[], name: string): number | null {
  const value = features.find((feature) => feature.feature === name)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export interface BaselineSummary {
  state: BaselineState;
  globalQuotePerBucket: number | null;
  sessionQuotePerBucket: number | null;
  globalTradesPerBucket: number | null;
  sessionTradesPerBucket: number | null;
}

export function buildBaseline(
  state: SymbolFeatureState,
  instrumentId: string,
  evaluatedAtMs: number,
  config: FeatureBankConfig,
): BaselineSummary {
  const currentSession = sessionBucketAt(evaluatedAtMs, config.sessionBucketMs);
  const rawCompleted = state.activityBuckets
    .filter((bucket) => bucket.endMs <= evaluatedAtMs)
    .sort((left, right) => left.startMs - right.startMs)
    .slice(-config.baselineCapacity);
  const observedCompleted = rawCompleted.filter((bucket) => !bucket.numericOverflow);
  const numericOverflow = rawCompleted.some((bucket) => bucket.numericOverflow);
  const completed: ActivityBucket[] = [];
  let coverageGap = false;
  if (rawCompleted.length > 0) {
    const byStart = new Map(observedCompleted.map((bucket) => [bucket.startMs, bucket]));
    const overflowStarts = new Set(rawCompleted
      .filter((bucket) => bucket.numericOverflow)
      .map((bucket) => bucket.startMs));
    const firstStart = Math.max(
      rawCompleted[0].startMs,
      rawCompleted[rawCompleted.length - 1].startMs - (config.baselineCapacity - 1) * config.baselineBucketMs,
    );
    const lastStart = rawCompleted[rawCompleted.length - 1].startMs;
    for (let startMs = firstStart; startMs <= lastStart; startMs += config.baselineBucketMs) {
      const observed = byStart.get(startMs);
      if (observed) {
        completed.push(observed);
        continue;
      }
      if (overflowStarts.has(startMs)) continue;
      const coverage = continuousCoverageForBucket(state, startMs, startMs + config.baselineBucketMs);
      if (!coverage) {
        coverageGap = true;
        continue;
      }
      completed.push({
        startMs,
        endMs: startMs + config.baselineBucketMs,
        sessionBucket: sessionBucketAt(startMs, config.sessionBucketMs),
        quoteVolume: 0,
        baseVolume: 0,
        tradeCount: 0,
        maximumTradeQuote: 0,
        evidenceIds: [coverage.id],
        sourceSet: sortedUnique([
          coverage.truth.authority.sourceId,
          ...coverage.truth.provenance.sourceSet,
        ]),
        lastReceivedTimeMs: coverage.truth.temporal.receivedTimeMs,
        numericOverflow: false,
      });
    }
  }
  const sessionSamples = completed.filter((bucket) => bucket.sessionBucket === currentSession);
  const globalRecords = recordsForBuckets(state, completed);
  const sessionRecords = recordsForBuckets(state, sessionSamples);
  const rawRecords = recordsForBuckets(state, rawCompleted);
  const latestBucketEnd = rawCompleted.length > 0 ? rawCompleted[rawCompleted.length - 1].endMs : null;
  const stale = latestBucketEnd !== null && evaluatedAtMs - latestBucketEnd > config.baselineStaleAfterMs;
  const baselineState: BaselineState['state'] = rawCompleted.length === 0
    ? 'COLD_START'
    : stale
      ? 'STALE'
      : coverageGap || numericOverflow || sessionSamples.length < config.baselineMinSamples
        ? 'INSUFFICIENT_HISTORY'
        : 'READY';
  const globalQuote = robustValues(completed.map((bucket) => bucket.quoteVolume));
  const sessionQuote = robustValues(sessionSamples.map((bucket) => bucket.quoteVolume));
  const globalBase = robustValues(completed.map((bucket) => bucket.baseVolume));
  const sessionBase = robustValues(sessionSamples.map((bucket) => bucket.baseVolume));
  const globalTrades = robustValues(completed.map((bucket) => bucket.tradeCount));
  const sessionTrades = robustValues(sessionSamples.map((bucket) => bucket.tradeCount));
  const globalAverageTrade = robustValues(completed
    .filter((bucket) => bucket.tradeCount > 0)
    .map((bucket) => bucket.quoteVolume / bucket.tradeCount));
  const sessionAverageTrade = robustValues(sessionSamples
    .filter((bucket) => bucket.tradeCount > 0)
    .map((bucket) => bucket.quoteVolume / bucket.tradeCount));
  const reasonCodes = sortedUnique([
    ...(baselineState === 'COLD_START' ? ['BASELINE_COLD_START'] : []),
    ...(baselineState === 'STALE' ? ['BASELINE_STALE'] : []),
    ...(baselineState === 'INSUFFICIENT_HISTORY' ? ['SESSION_HISTORY_INSUFFICIENT'] : []),
    ...(coverageGap ? ['BASELINE_COVERAGE_GAP'] : []),
    ...(numericOverflow ? ['NUMERIC_OVERFLOW'] : []),
  ]);
  const add = (
    feature: string,
    value: number | null,
    evidence: readonly NormalizedEvidence[],
    transform: string,
  ): FeatureValue => featureValue({
    config,
    instrumentId,
    feature,
    value,
    unit: feature.includes('trades') ? 'trades' : feature.includes('base') ? 'base_asset' : 'quote_asset',
    windowMs: config.baselineBucketMs,
    evaluatedAtMs,
    evidence: evidence.length > 0 || !numericOverflow ? evidence : rawRecords,
    maxAgeMs: config.baselineStaleAfterMs,
    reasonCodes,
    missingFields: value === null ? [feature] : baselineState === 'READY' ? [] : ['readySessionBaseline'],
    transforms: [transform, 'explicit-continuous-coverage-zero-gating', 'robust-median-mad-winsorization'],
  });
  const normalActivity = [
    add('normal_quote_volume_per_bucket', median(globalQuote), globalRecords, 'global-activity-baseline'),
    add('session_quote_volume_per_bucket', median(sessionQuote), sessionRecords, 'utc-session-activity-baseline'),
    add('normal_base_volume_per_bucket', median(globalBase), globalRecords, 'global-activity-baseline'),
    add('session_base_volume_per_bucket', median(sessionBase), sessionRecords, 'utc-session-activity-baseline'),
    add('normal_trades_per_bucket', median(globalTrades), globalRecords, 'global-activity-baseline'),
    add('session_trades_per_bucket', median(sessionTrades), sessionRecords, 'utc-session-activity-baseline'),
    add('normal_average_trade_quote', median(globalAverageTrade), globalRecords, 'global-trade-size-baseline'),
    add('session_average_trade_quote', median(sessionAverageTrade), sessionRecords, 'utc-session-trade-size-baseline'),
  ];
  const deadActivity = [
    add('dead_quote_volume_per_bucket', quantile(globalQuote, 0.25), globalRecords, 'lower-quartile-activity-baseline'),
    add('dead_trades_per_bucket', quantile(globalTrades, 0.25), globalRecords, 'lower-quartile-activity-baseline'),
    add('dead_average_trade_quote', quantile(globalAverageTrade, 0.25), globalRecords, 'lower-quartile-trade-size-baseline'),
  ];
  const baselineEvidence = sessionRecords.length > 0
    ? sessionRecords
    : globalRecords.length > 0
      ? globalRecords
      : rawRecords;
  const truth = derivedTruth({
    config,
    dataset: 'symbol-session-baseline',
    evaluatedAtMs,
    evidence: baselineEvidence,
    maxAgeMs: config.baselineStaleAfterMs,
    completeness: {
      state: baselineState === 'READY' ? 'COMPLETE' : baselineEvidence.length > 0 ? 'PARTIAL' : 'MISSING',
      observedFields: baselineEvidence.length > 0 ? ['activityBuckets'] : [],
      missingFields: baselineState === 'READY' ? [] : ['readySessionBaseline'],
      reasonCodes,
    },
    transforms: ['bounded-minute-buckets', 'explicit-continuous-coverage-zero-gating', 'utc-session-normalization', 'robust-median-mad-winsorization'],
  });
  const id = stableSetId('baseline', {
    instrumentId,
    sessionBucket: currentSession,
    featureVersion: config.featureVersion,
    normalFeatureIds: normalActivity.map((feature) => feature.id),
    deadFeatureIds: deadActivity.map((feature) => feature.id),
  }, ['normalFeatureIds', 'deadFeatureIds']);
  const output: BaselineState = {
    id,
    instrumentId,
    state: baselineState,
    sampleCount: sessionSamples.length,
    capacity: config.baselineCapacity,
    sessionBucket: currentSession,
    normalActivity,
    deadActivity,
    truth,
  };
  return {
    state: output,
    globalQuotePerBucket: valueOf(normalActivity, 'normal_quote_volume_per_bucket'),
    sessionQuotePerBucket: valueOf(normalActivity, 'session_quote_volume_per_bucket'),
    globalTradesPerBucket: valueOf(normalActivity, 'normal_trades_per_bucket'),
    sessionTradesPerBucket: valueOf(normalActivity, 'session_trades_per_bucket'),
  };
}

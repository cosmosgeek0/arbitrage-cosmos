import {
  makeStableFailure,
  sortedUnique,
  validateNormalizedEvidence,
  type FeatureValue,
  type InstrumentIdentity,
  type NormalizedDepth,
  type NormalizedEvidence,
  type NormalizedTrade,
} from '../contracts/index.js';
import { activitySessionBucket, buildBaseline, type BaselineSummary } from './baseline.js';
import { featureBankConfig, type FeatureBankConfig } from './config.js';
import { codePointCompare, mean, median, percentChange, quantile, safeAdd, safeMultiply, standardDeviation, sum } from './stats.js';
import { evidenceTime, featureValue, isUsableEvidenceTruth } from './truth.js';
import type {
  ActivityBucket,
  EvidenceByKind,
  FeatureBankStats,
  FeatureClock,
  FeatureIngestResult,
  FeatureSnapshot,
  SymbolFeatureState,
} from './types.js';

type ProductFamily = InstrumentIdentity['productFamily'];

interface PricePoint {
  timeMs: number;
  price: number;
  evidence: NormalizedEvidence;
}

function emptyEvidence(): EvidenceByKind {
  return {
    TRADE: [],
    BOOK_TICKER: [],
    DEPTH_SNAPSHOT: [],
    DEPTH_DELTA: [],
    MARK_PRICE: [],
    FUNDING: [],
    OPEN_INTEREST: [],
    LIQUIDATION: [],
    BORROW: [],
    CONTEXT: [],
  };
}

function isPerpetual(family: ProductFamily): boolean {
  return family === 'USD_M_PERPETUAL' || family === 'COIN_M_PERPETUAL';
}

function sameFamily(record: NormalizedEvidence, family: 'SPOT' | 'PERPETUAL'): boolean {
  return family === 'SPOT'
    ? record.instrument.productFamily === 'SPOT'
    : isPerpetual(record.instrument.productFamily);
}

function within(record: NormalizedEvidence, startMs: number, endMs: number): boolean {
  const time = evidenceTime(record);
  return time >= startMs && time <= endMs;
}

function stableEvidenceOrder(left: NormalizedEvidence, right: NormalizedEvidence): number {
  const time = evidenceTime(left) - evidenceTime(right);
  return time !== 0 ? time : codePointCompare(left.id, right.id);
}

function midpoint(bid: number, ask: number): number | null {
  const value = bid / 2 + ask / 2;
  return Number.isFinite(value) ? value : null;
}

function spreadBps(bid: number, ask: number): number | null {
  const mid = midpoint(bid, ask);
  if (mid === null || mid <= 0) return null;
  const value = ((ask - bid) / mid) * 10_000;
  return Number.isFinite(value) ? value : null;
}

function pricePoints(
  state: SymbolFeatureState,
  family: 'SPOT' | 'PERPETUAL',
  startMs: number,
  endMs: number,
): PricePoint[] {
  const points: PricePoint[] = [];
  for (const trade of state.evidence.TRADE) {
    if (isUsableEvidenceTruth(trade) && sameFamily(trade, family) && within(trade, startMs, endMs)) {
      points.push({ timeMs: evidenceTime(trade), price: trade.price, evidence: trade });
    }
  }
  for (const book of state.evidence.BOOK_TICKER) {
    if (isUsableEvidenceTruth(book) && sameFamily(book, family) && within(book, startMs, endMs)) {
      const price = midpoint(book.bidPrice, book.askPrice);
      if (price === null) continue;
      points.push({
        timeMs: evidenceTime(book),
        price,
        evidence: book,
      });
    }
  }
  points.sort((left, right) => {
    const time = left.timeMs - right.timeMs;
    return time !== 0 ? time : codePointCompare(left.evidence.id, right.evidence.id);
  });
  return points;
}

function firstMoveTime(points: readonly PricePoint[], thresholdPct: number): number | null {
  if (points.length < 2 || points[0].price <= 0) return null;
  const origin = points[0].price;
  for (let index = 1; index < points.length; index += 1) {
    if (Math.abs(((points[index].price - origin) / origin) * 100) >= thresholdPct) return points[index].timeMs;
  }
  return null;
}

function latestFresh<T extends NormalizedEvidence>(records: readonly T[], nowMs: number, maxAgeMs: number): T | null {
  const latest = records.length > 0 ? records[records.length - 1] : null;
  if (!latest) return null;
  const age = nowMs - evidenceTime(latest);
  if (age < 0 || age > maxAgeMs) return null;
  if (!isUsableEvidenceTruth(latest)) return null;
  return latest;
}

function depthNotional(depth: NormalizedDepth): { bid: number; ask: number; total: number } | null {
  const bid = sum(depth.bids.map((level) => level.price * level.baseQuantity));
  const ask = sum(depth.asks.map((level) => level.price * level.baseQuantity));
  if (bid === null || ask === null) return null;
  const total = safeAdd(bid, ask);
  return total === null ? null : { bid, ask, total };
}

function bookSlope(depth: NormalizedDepth): number | null {
  if (depth.bids.length < 2 || depth.asks.length < 2) return null;
  const bestBid = depth.bids[0].price;
  const bestAsk = depth.asks[0].price;
  const mid = midpoint(bestBid, bestAsk);
  if (mid === null || mid <= 0) return null;
  const bidSlope = ((bestBid - depth.bids[depth.bids.length - 1].price) / mid) * 10_000 / (depth.bids.length - 1);
  const askSlope = ((depth.asks[depth.asks.length - 1].price - bestAsk) / mid) * 10_000 / (depth.asks.length - 1);
  return (bidSlope + askSlope) / 2;
}

function clusterLargeTrades(trades: readonly NormalizedTrade[], threshold: number, gapMs: number): {
  count: number;
  largestQuote: number | null;
  numericOverflow: boolean;
} {
  const large = trades.filter((trade) => trade.quoteQuantity >= threshold);
  if (large.length === 0) return { count: 0, largestQuote: 0, numericOverflow: false };
  let count = 0;
  let largestQuote = 0;
  let currentQuote = 0;
  let numericOverflow = false;
  let previousTime: number | null = null;
  for (const trade of large) {
    const time = evidenceTime(trade);
    if (previousTime === null || time - previousTime > gapMs) {
      if (currentQuote > 0) largestQuote = Math.max(largestQuote, currentQuote);
      count += 1;
      currentQuote = 0;
    }
    const nextQuote = safeAdd(currentQuote, trade.quoteQuantity);
    if (nextQuote === null) numericOverflow = true;
    else currentQuote = nextQuote;
    previousTime = time;
  }
  largestQuote = Math.max(largestQuote, currentQuote);
  return { count, largestQuote: numericOverflow ? null : largestQuote, numericOverflow };
}

export class MarketFeatureBank {
  readonly config: FeatureBankConfig;
  private readonly states = new Map<string, SymbolFeatureState>();
  private marketCacheAtMs: number | null = null;
  private readonly marketCache = new Map<number, { value: number | null; evidence: NormalizedEvidence[] }>();

  constructor(
    private readonly clock: FeatureClock,
    overrides: Partial<FeatureBankConfig> = {},
  ) {
    this.config = featureBankConfig(overrides);
  }

  ingest(input: NormalizedEvidence | readonly NormalizedEvidence[]): FeatureIngestResult {
    const records = Array.isArray(input) ? input : [input];
    const failures = [] as FeatureIngestResult['failures'];
    const validatedRecords: NormalizedEvidence[] = [];
    let accepted = 0;
    for (const candidate of records) {
      const validation = validateNormalizedEvidence(candidate);
      if (!validation.ok) {
        failures.push(validation.failure);
        continue;
      }
      validatedRecords.push(validation.value);
    }
    validatedRecords.sort((left, right) => (
      codePointCompare(left.instrument.symbol, right.instrument.symbol) ||
      codePointCompare(left.instrument.instrumentId, right.instrument.instrumentId) ||
      stableEvidenceOrder(left, right)
    ));
    const now = this.clock.now();
    for (const evidence of validatedRecords) {
      const temporalTimes = [
        evidence.truth.temporal.sourceEventTimeMs,
        evidence.truth.temporal.sourceTransactionTimeMs,
        evidence.truth.temporal.receivedTimeMs,
      ].filter((value): value is number => value !== null);
      if (temporalTimes.some((time) => time > now)) {
        failures.push(makeStableFailure(
          'TIMESTAMP_SKEW',
          'feature_bank',
          'evidence occurs after the injected feature clock',
          'truth.temporal',
          [evidence.id],
        ));
        continue;
      }
      let state = this.states.get(evidence.instrument.symbol);
      if (!state) {
        if (this.states.size >= this.config.maxSymbols) {
          failures.push(makeStableFailure(
            'BUDGET_EXHAUSTED',
            'feature_bank',
            'bounded symbol capacity reached',
            'maxSymbols',
            [evidence.id],
          ));
          continue;
        }
        state = {
          symbol: evidence.instrument.symbol,
          instruments: [],
          evidence: emptyEvidence(),
          activityBuckets: [],
          lastTouchedMs: evidenceTime(evidence),
        };
        this.states.set(state.symbol, state);
      }
      const kindRecords = state.evidence[evidence.kind] as NormalizedEvidence[];
      if (kindRecords.some((record) => record.id === evidence.id)) {
        failures.push(makeStableFailure(
          'DUPLICATE_EVENT',
          'feature_bank',
          'duplicate evidence ID rejected',
          'id',
          [evidence.id],
        ));
        continue;
      }
      const existingInstrument = state.instruments.findIndex((instrument) => instrument.instrumentId === evidence.instrument.instrumentId);
      if (existingInstrument >= 0) state.instruments[existingInstrument] = { ...evidence.instrument };
      else {
        if (state.instruments.length >= this.config.maxInstrumentsPerSymbol) {
          failures.push(makeStableFailure(
            'BUDGET_EXHAUSTED',
            'feature_bank',
            'bounded per-symbol instrument identity capacity reached',
            'maxInstrumentsPerSymbol',
            [evidence.id],
          ));
          continue;
        }
        state.instruments.push({ ...evidence.instrument });
      }
      state.instruments.sort((left, right) => codePointCompare(left.instrumentId, right.instrumentId));
      kindRecords.push(evidence);
      kindRecords.sort(stableEvidenceOrder);
      this.pruneState(state, now);
      if (evidence.kind === 'TRADE' && evidence.instrument.productFamily === 'SPOT' && isUsableEvidenceTruth(evidence)) {
        this.updateActivityBucket(state, evidence);
      }
      state.lastTouchedMs = Math.max(state.lastTouchedMs, evidenceTime(evidence));
      this.marketCacheAtMs = null;
      this.marketCache.clear();
      accepted += 1;
    }
    failures.sort((left, right) => codePointCompare(left.id, right.id));
    return { accepted, rejected: failures.length, failures };
  }

  snapshot(symbol: string): FeatureSnapshot | null {
    const state = this.states.get(symbol);
    if (!state) return null;
    const now = this.clock.now();
    this.pruneState(state, now);
    const instrument = this.primaryInstrument(state);
    const baseline = buildBaseline(state, instrument.instrumentId, now, this.config);
    const features: FeatureValue[] = [];
    for (const windowMs of this.config.windowsMs) {
      features.push(...this.windowFeatures(state, instrument.instrumentId, baseline, windowMs, now));
    }
    features.sort((left, right) => {
      const leftWindow = left.windowMs ?? Number.MAX_SAFE_INTEGER;
      const rightWindow = right.windowMs ?? Number.MAX_SAFE_INTEGER;
      return leftWindow - rightWindow || codePointCompare(left.feature, right.feature) || codePointCompare(left.id, right.id);
    });
    const allEvidence = this.allEvidence(state);
    const nullCount = features.filter((feature) => feature.value === null).length;
    const staleCount = features.filter((feature) => feature.truth.freshness.state === 'STALE').length;
    const reasonCodes = sortedUnique([
      ...(allEvidence.length === 0 ? ['NO_EVIDENCE'] : []),
      ...(nullCount > 0 ? ['FEATURES_UNAVAILABLE'] : []),
      ...(staleCount > 0 ? ['FEATURES_STALE'] : []),
      ...(baseline.state.state === 'READY' ? [] : [`BASELINE_${baseline.state.state}`]),
    ]);
    return {
      symbol,
      instrumentId: instrument.instrumentId,
      computedAtMs: now,
      baseline: baseline.state,
      features,
      sourceEvidenceIds: allEvidence.map((record) => record.id).sort(codePointCompare).slice(0, this.config.maxProvenanceIds),
      completeness: allEvidence.length === 0 ? 'MISSING' : nullCount === 0 ? 'COMPLETE' : 'PARTIAL',
      reasonCodes,
    };
  }

  snapshots(): FeatureSnapshot[] {
    return [...this.states.keys()].sort(codePointCompare)
      .map((symbol) => this.snapshot(symbol))
      .filter((snapshot): snapshot is FeatureSnapshot => snapshot !== null);
  }

  symbols(): string[] {
    return [...this.states.keys()].sort(codePointCompare);
  }

  stats(): FeatureBankStats {
    let evidenceCount = 0;
    let baselineBucketCount = 0;
    let instrumentIdentityCount = 0;
    for (const state of this.states.values()) {
      evidenceCount += this.allEvidence(state).length;
      baselineBucketCount += state.activityBuckets.length;
      instrumentIdentityCount += state.instruments.length;
    }
    return {
      symbolCount: this.states.size,
      maxSymbols: this.config.maxSymbols,
      evidenceCount,
      maximumEvidenceCapacity: this.config.maxSymbols * this.config.maxRecordsPerKind * 10,
      instrumentIdentityCount,
      maximumInstrumentIdentityCapacity: this.config.maxSymbols * this.config.maxInstrumentsPerSymbol,
      baselineBucketCount,
      maximumBaselineCapacity: this.config.maxSymbols * this.config.baselineCapacity,
    };
  }

  private primaryInstrument(state: SymbolFeatureState): InstrumentIdentity {
    const spot = state.instruments.find((instrument) => instrument.productFamily === 'SPOT');
    return spot ?? state.instruments[0];
  }

  private allEvidence(state: SymbolFeatureState): NormalizedEvidence[] {
    return Object.values(state.evidence).flat() as NormalizedEvidence[];
  }

  private pruneState(state: SymbolFeatureState, nowMs: number): void {
    const cutoff = nowMs - this.config.historyRetentionMs;
    for (const kind of Object.keys(state.evidence) as (keyof EvidenceByKind)[]) {
      const records = state.evidence[kind] as NormalizedEvidence[];
      const retained = records.filter((record) => evidenceTime(record) >= cutoff)
        .slice(-this.config.maxRecordsPerKind);
      (state.evidence[kind] as NormalizedEvidence[]).splice(0, records.length, ...retained);
    }
    state.activityBuckets = state.activityBuckets
      .filter((bucket) => bucket.endMs >= cutoff)
      .slice(-this.config.baselineCapacity);
  }

  private updateActivityBucket(state: SymbolFeatureState, trade: NormalizedTrade): void {
    const time = evidenceTime(trade);
    const startMs = Math.floor(time / this.config.baselineBucketMs) * this.config.baselineBucketMs;
    let bucket = state.activityBuckets.find((candidate) => candidate.startMs === startMs);
    if (!bucket) {
      bucket = {
        startMs,
        endMs: startMs + this.config.baselineBucketMs,
        sessionBucket: activitySessionBucket(startMs, this.config),
        quoteVolume: 0,
        baseVolume: 0,
        tradeCount: 0,
        maximumTradeQuote: 0,
        evidenceIds: [],
        sourceSet: [],
        lastReceivedTimeMs: 0,
        numericOverflow: false,
      };
      state.activityBuckets.push(bucket);
      state.activityBuckets.sort((left, right) => left.startMs - right.startMs);
      if (state.activityBuckets.length > this.config.baselineCapacity) {
        state.activityBuckets.splice(0, state.activityBuckets.length - this.config.baselineCapacity);
      }
    }
    const quoteVolume = safeAdd(bucket.quoteVolume, trade.quoteQuantity);
    const baseVolume = safeAdd(bucket.baseVolume, trade.baseQuantity);
    if (quoteVolume === null || baseVolume === null) bucket.numericOverflow = true;
    else {
      bucket.quoteVolume = quoteVolume;
      bucket.baseVolume = baseVolume;
    }
    bucket.tradeCount = Math.min(Number.MAX_SAFE_INTEGER, bucket.tradeCount + 1);
    bucket.maximumTradeQuote = Math.max(bucket.maximumTradeQuote, trade.quoteQuantity);
    bucket.evidenceIds = sortedUnique([...bucket.evidenceIds, trade.id]).slice(-this.config.maxProvenanceIds);
    bucket.sourceSet = sortedUnique([
      ...bucket.sourceSet,
      trade.truth.authority.sourceId,
      ...trade.truth.provenance.sourceSet,
    ]).slice(0, this.config.maxProvenanceIds);
    bucket.lastReceivedTimeMs = Math.max(bucket.lastReceivedTimeMs, trade.truth.temporal.receivedTimeMs);
  }

  private records<K extends keyof EvidenceByKind>(
    state: SymbolFeatureState,
    kind: K,
    family: 'SPOT' | 'PERPETUAL' | 'ANY',
    startMs: number,
    endMs: number,
  ): EvidenceByKind[K] {
    return state.evidence[kind].filter((record) => (
      within(record, startMs, endMs) && (
        family === 'ANY' || sameFamily(record, family)
      )
    )) as EvidenceByKind[K];
  }

  private marketReturn(windowMs: number, nowMs: number): { value: number | null; evidence: NormalizedEvidence[] } {
    if (this.marketCacheAtMs !== nowMs) {
      this.marketCacheAtMs = nowMs;
      this.marketCache.clear();
    }
    const cached = this.marketCache.get(windowMs);
    if (cached) return cached;
    const returns: { value: number; evidence: NormalizedEvidence[] }[] = [];
    for (const state of [...this.states.values()].sort((left, right) => codePointCompare(left.symbol, right.symbol))) {
      const points = pricePoints(state, 'SPOT', nowMs - windowMs, nowMs);
      const value = points.length >= 2 ? percentChange(points[0].price, points[points.length - 1].price) : null;
      if (value !== null) returns.push({ value, evidence: [points[0].evidence, points[points.length - 1].evidence] });
    }
    const evidence = [...new Map(
      returns.flatMap((entry) => entry.evidence).map((record) => [record.id, record] as const),
    ).values()].sort((left, right) => codePointCompare(left.id, right.id)).slice(0, this.config.maxProvenanceIds);
    const result = returns.length < this.config.minimumMarketSymbols ? { value: null, evidence } : {
      value: median(returns.map((entry) => entry.value)),
      evidence,
    };
    this.marketCache.set(windowMs, result);
    return result;
  }

  private windowFeatures(
    state: SymbolFeatureState,
    instrumentId: string,
    baseline: BaselineSummary,
    windowMs: number,
    nowMs: number,
  ): FeatureValue[] {
    const startMs = nowMs - windowMs;
    const rawSpotTrades = this.records(state, 'TRADE', 'SPOT', startMs, nowMs);
    const rawSpotBooks = this.records(state, 'BOOK_TICKER', 'SPOT', startMs, nowMs);
    const rawSpotDepths = this.records(state, 'DEPTH_SNAPSHOT', 'SPOT', startMs, nowMs);
    const rawPerpTrades = this.records(state, 'TRADE', 'PERPETUAL', startMs, nowMs);
    const rawPerpBooks = this.records(state, 'BOOK_TICKER', 'PERPETUAL', startMs, nowMs);
    const rawPerpDepths = this.records(state, 'DEPTH_SNAPSHOT', 'PERPETUAL', startMs, nowMs);
    const rawFunding = this.records(state, 'FUNDING', 'PERPETUAL', startMs, nowMs);
    const rawOpenInterest = this.records(state, 'OPEN_INTEREST', 'PERPETUAL', startMs, nowMs);
    const rawLiquidations = this.records(state, 'LIQUIDATION', 'PERPETUAL', startMs, nowMs);
    const spotTrades = rawSpotTrades.filter(isUsableEvidenceTruth);
    const spotBooks = rawSpotBooks.filter(isUsableEvidenceTruth);
    const spotDepths = rawSpotDepths.filter(isUsableEvidenceTruth);
    const perpTrades = rawPerpTrades.filter(isUsableEvidenceTruth);
    const perpBooks = rawPerpBooks.filter(isUsableEvidenceTruth);
    const perpDepths = rawPerpDepths.filter(isUsableEvidenceTruth);
    const funding = rawFunding.filter(isUsableEvidenceTruth);
    const openInterest = rawOpenInterest.filter(isUsableEvidenceTruth);
    const liquidations = rawLiquidations.filter(isUsableEvidenceTruth);
    const output: FeatureValue[] = [];
    const add = (
      feature: string,
      value: FeatureValue['value'],
      unit: string,
      evidence: readonly NormalizedEvidence[],
      options: {
        maxAgeMs?: number;
        reasonCodes?: readonly string[];
        missingFields?: readonly string[];
        transforms?: readonly string[];
      } = {},
    ): void => {
      output.push(featureValue({
        config: this.config,
        instrumentId,
        feature,
        value,
        unit,
        windowMs,
        evaluatedAtMs: nowMs,
        evidence,
        maxAgeMs: options.maxAgeMs ?? this.config.sourceStaleAfterMs,
        reasonCodes: options.reasonCodes,
        missingFields: options.missingFields,
        transforms: options.transforms,
      }));
    };

    const hasSpotTradeHistory = state.evidence.TRADE.some((trade) => (
      trade.instrument.productFamily === 'SPOT' && isUsableEvidenceTruth(trade)
    ));
    const unusableTradeWindow = rawSpotTrades.length > 0 && spotTrades.length === 0;
    const zeroTradeWindow = rawSpotTrades.length === 0 && hasSpotTradeHistory;
    const tradeMissing = spotTrades.length === 0 && !zeroTradeWindow;
    const zeroReasons = zeroTradeWindow
      ? ['ZERO_TRADE_WINDOW']
      : unusableTradeWindow
        ? ['SPOT_TRADES_UNUSABLE']
        : tradeMissing
          ? ['SPOT_TRADES_MISSING']
          : [];
    const zeroMissing = zeroTradeWindow
      ? ['continuousTradeCoverage']
      : unusableTradeWindow
        ? ['usableSpotTrades']
        : tradeMissing
          ? ['spotTrades']
          : [];
    const quoteVolume = tradeMissing ? null : sum(spotTrades.map((trade) => trade.quoteQuantity));
    const baseVolume = tradeMissing ? null : sum(spotTrades.map((trade) => trade.baseQuantity));
    const quoteOverflow = !tradeMissing && quoteVolume === null;
    const baseOverflow = !tradeMissing && baseVolume === null;
    const tradeCount = tradeMissing ? null : spotTrades.length;
    const windowSeconds = windowMs / 1_000;
    add('spot_quote_volume', quoteVolume, 'quote_asset', rawSpotTrades, { reasonCodes: [...zeroReasons, ...(quoteOverflow ? ['NUMERIC_OVERFLOW'] : [])], missingFields: [...zeroMissing, ...(quoteOverflow ? ['finiteQuoteVolume'] : [])], transforms: ['sum-trade-quote'] });
    add('spot_base_volume', baseVolume, 'base_asset', rawSpotTrades, { reasonCodes: [...zeroReasons, ...(baseOverflow ? ['NUMERIC_OVERFLOW'] : [])], missingFields: [...zeroMissing, ...(baseOverflow ? ['finiteBaseVolume'] : [])], transforms: ['sum-trade-base'] });
    add('spot_trade_count', tradeCount, 'trades', rawSpotTrades, { reasonCodes: zeroReasons, missingFields: zeroMissing, transforms: ['count-trades'] });
    add('spot_trade_arrival_rate', tradeCount === null ? null : tradeCount / windowSeconds, 'trades_per_second', rawSpotTrades, { reasonCodes: zeroReasons, missingFields: zeroMissing, transforms: ['trade-arrival-rate'] });

    const halfWindowStart = nowMs - windowMs / 2;
    const recentCount = spotTrades.filter((trade) => evidenceTime(trade) >= halfWindowStart).length;
    const priorCount = spotTrades.length - recentCount;
    const halfSeconds = windowSeconds / 2;
    const acceleration = tradeMissing ? null : ((recentCount / halfSeconds) - (priorCount / halfSeconds)) / halfSeconds;
    add('spot_trade_arrival_acceleration', acceleration, 'trades_per_second_squared', rawSpotTrades, { reasonCodes: zeroReasons, missingFields: zeroMissing, transforms: ['split-window-arrival-acceleration'] });

    const tradeSizes = spotTrades.map((trade) => trade.quoteQuantity);
    add('spot_trade_size_mean', mean(tradeSizes), 'quote_asset', rawSpotTrades, { transforms: ['trade-size-distribution'] });
    add('spot_trade_size_median', median(tradeSizes), 'quote_asset', rawSpotTrades, { transforms: ['trade-size-distribution'] });
    add('spot_trade_size_p90', quantile(tradeSizes, 0.9), 'quote_asset', rawSpotTrades, { transforms: ['trade-size-distribution'] });
    add('spot_trade_size_maximum', tradeSizes.length > 0 ? tradeSizes.reduce((largest, value) => Math.max(largest, value), 0) : null, 'quote_asset', rawSpotTrades, { transforms: ['trade-size-distribution'] });
    const clusters = clusterLargeTrades(spotTrades, this.config.largeTradeQuoteThreshold, this.config.largeTradeClusterGapMs);
    add('spot_large_trade_count', tradeMissing ? null : spotTrades.filter((trade) => trade.quoteQuantity >= this.config.largeTradeQuoteThreshold).length, 'trades', rawSpotTrades, { reasonCodes: zeroReasons, missingFields: zeroMissing, transforms: ['fixed-threshold-large-trades'] });
    add('spot_large_trade_cluster_count', tradeMissing ? null : clusters.count, 'clusters', rawSpotTrades, { reasonCodes: zeroReasons, missingFields: zeroMissing, transforms: ['time-gap-large-trade-clustering'] });
    add('spot_largest_trade_cluster_quote', tradeMissing ? null : clusters.largestQuote, 'quote_asset', rawSpotTrades, { reasonCodes: [...zeroReasons, ...(clusters.numericOverflow ? ['NUMERIC_OVERFLOW'] : [])], missingFields: [...zeroMissing, ...(clusters.numericOverflow ? ['finiteLargeTradeClusterQuote'] : [])], transforms: ['time-gap-large-trade-clustering'] });

    const knownAggressor = spotTrades.filter((trade) => trade.aggressorSide !== 'UNKNOWN');
    const takerBuyQuote = sum(knownAggressor.filter((trade) => trade.aggressorSide === 'BUY').map((trade) => trade.quoteQuantity));
    const takerSellQuote = sum(knownAggressor.filter((trade) => trade.aggressorSide === 'SELL').map((trade) => trade.quoteQuantity));
    const knownFlow = takerBuyQuote === null || takerSellQuote === null ? null : safeAdd(takerBuyQuote, takerSellQuote);
    const flowOverflow = knownFlow === null;
    const imbalance = knownFlow !== null && knownFlow > 0 && takerBuyQuote !== null && takerSellQuote !== null
      ? (takerBuyQuote - takerSellQuote) / knownFlow
      : null;
    add('spot_aggressor_imbalance', imbalance, 'ratio', rawSpotTrades, {
      reasonCodes: imbalance === null ? [flowOverflow ? 'NUMERIC_OVERFLOW' : 'AGGRESSOR_SIDE_UNAVAILABLE'] : [],
      missingFields: imbalance === null ? [flowOverflow ? 'finiteAggressorFlow' : 'knownAggressorSide'] : [],
      transforms: ['quote-weighted-aggressor-imbalance'],
    });
    const netFlow = knownFlow !== null && knownFlow > 0 && takerBuyQuote !== null && takerSellQuote !== null
      ? takerBuyQuote - takerSellQuote
      : null;
    add('spot_net_aggressive_flow_quote', netFlow, 'quote_asset', rawSpotTrades, {
      reasonCodes: knownFlow !== null && knownFlow > 0 ? [] : [flowOverflow ? 'NUMERIC_OVERFLOW' : 'AGGRESSOR_SIDE_UNAVAILABLE'],
      missingFields: knownFlow !== null && knownFlow > 0 ? [] : [flowOverflow ? 'finiteAggressorFlow' : 'knownAggressorSide'],
      transforms: ['net-aggressive-flow'],
    });

    const spotPrice = pricePoints(state, 'SPOT', startMs, nowMs);
    const spotReturn = spotPrice.length >= 2 ? percentChange(spotPrice[0].price, spotPrice[spotPrice.length - 1].price) : null;
    add('spot_price_change_pct', spotReturn, 'percent', [...rawSpotTrades, ...rawSpotBooks], { transforms: ['first-last-price-return'] });
    const responsePerFlow = spotReturn !== null && netFlow !== null && Math.abs(netFlow) > 0 ? spotReturn / (Math.abs(netFlow) / 1_000_000) : null;
    add('spot_price_response_per_million_flow', responsePerFlow, 'percent_per_million_quote', [...rawSpotTrades, ...rawSpotBooks], {
      reasonCodes: responsePerFlow === null ? ['PRICE_OR_FLOW_UNAVAILABLE'] : [],
      missingFields: responsePerFlow === null ? ['priceResponseAndNetFlow'] : [],
      transforms: ['price-return-per-absolute-net-flow'],
    });

    const globalExpectedQuote = baseline.globalQuotePerBucket === null
      ? null
      : safeMultiply(baseline.globalQuotePerBucket, windowMs / this.config.baselineBucketMs);
    const sessionExpectedQuote = baseline.sessionQuotePerBucket === null
      ? null
      : safeMultiply(baseline.sessionQuotePerBucket, windowMs / this.config.baselineBucketMs);
    const globalExpectedTrades = baseline.globalTradesPerBucket === null
      ? null
      : safeMultiply(baseline.globalTradesPerBucket, windowMs / this.config.baselineBucketMs);
    const sessionExpectedTrades = baseline.sessionTradesPerBucket === null
      ? null
      : safeMultiply(baseline.sessionTradesPerBucket, windowMs / this.config.baselineBucketMs);
    const baselineReady = baseline.state.state === 'READY';
    const relativeQuote = baselineReady && quoteVolume !== null && globalExpectedQuote !== null && globalExpectedQuote > 0
      ? quoteVolume / globalExpectedQuote
      : null;
    const sessionRelativeQuote = baselineReady && quoteVolume !== null && sessionExpectedQuote !== null && sessionExpectedQuote > 0
      ? quoteVolume / sessionExpectedQuote
      : null;
    const relativeTrades = baselineReady && tradeCount !== null && globalExpectedTrades !== null && globalExpectedTrades > 0
      ? tradeCount / globalExpectedTrades
      : null;
    const sessionRelativeTrades = baselineReady && tradeCount !== null && sessionExpectedTrades !== null && sessionExpectedTrades > 0
      ? tradeCount / sessionExpectedTrades
      : null;
    const baselineOverflow = baselineReady && (
      globalExpectedQuote === null || sessionExpectedQuote === null ||
      globalExpectedTrades === null || sessionExpectedTrades === null
    );
    const baselineReasons = baselineReady
      ? baselineOverflow ? ['NUMERIC_OVERFLOW'] : []
      : [`BASELINE_${baseline.state.state}`];
    add('relative_quote_volume', relativeQuote, 'multiple', rawSpotTrades, { reasonCodes: baselineReasons, missingFields: relativeQuote === null ? ['readyGlobalBaseline'] : [], transforms: ['global-baseline-normalization'] });
    add('session_relative_quote_volume', sessionRelativeQuote, 'multiple', rawSpotTrades, { reasonCodes: baselineReasons, missingFields: sessionRelativeQuote === null ? ['readySessionBaseline'] : [], transforms: ['utc-session-baseline-normalization'] });
    add('relative_trade_count', relativeTrades, 'multiple', rawSpotTrades, { reasonCodes: baselineReasons, missingFields: relativeTrades === null ? ['readyGlobalBaseline'] : [], transforms: ['global-baseline-normalization'] });
    add('session_relative_trade_count', sessionRelativeTrades, 'multiple', rawSpotTrades, { reasonCodes: baselineReasons, missingFields: sessionRelativeTrades === null ? ['readySessionBaseline'] : [], transforms: ['utc-session-baseline-normalization'] });

    const latestSpotBook = latestFresh(spotBooks, nowMs, this.config.sourceStaleAfterMs);
    const latestSpotTrade = latestFresh(spotTrades, nowMs, this.config.sourceStaleAfterMs);
    const spreadValues = spotBooks
      .map((book) => spreadBps(book.bidPrice, book.askPrice))
      .filter((value): value is number => value !== null);
    const latestSpread = latestSpotBook ? spreadBps(latestSpotBook.bidPrice, latestSpotBook.askPrice) : null;
    const bookReasons = rawSpotBooks.length === 0
      ? ['SPOT_BOOK_MISSING']
      : spotBooks.length === 0
        ? ['SPOT_BOOK_UNUSABLE']
        : latestSpotBook === null
          ? ['SPOT_BOOK_STALE']
          : [];
    add('spot_spread_bps', latestSpread, 'basis_points', rawSpotBooks, { reasonCodes: bookReasons, missingFields: latestSpread === null ? ['freshSpotBook'] : [], transforms: ['top-book-spread'] });
    add('spot_spread_stability_bps', standardDeviation(spreadValues), 'basis_points_stddev', rawSpotBooks, { reasonCodes: spreadValues.length < 2 ? ['SPREAD_HISTORY_INSUFFICIENT'] : [], missingFields: spreadValues.length < 2 ? ['multipleSpotBooks'] : [], transforms: ['spread-standard-deviation'] });
    const topBidNotional = latestSpotBook ? safeMultiply(latestSpotBook.bidPrice, latestSpotBook.bidQuantity) : null;
    const topAskNotional = latestSpotBook ? safeMultiply(latestSpotBook.askPrice, latestSpotBook.askQuantity) : null;
    const topTotalNotional = topBidNotional === null || topAskNotional === null ? null : safeAdd(topBidNotional, topAskNotional);
    const topNotionalOverflow = latestSpotBook !== null && topTotalNotional === null;
    const topDepth = topTotalNotional === null ? null : topTotalNotional / 2;
    const topImbalance = topTotalNotional !== null && topTotalNotional > 0 && topBidNotional !== null && topAskNotional !== null
      ? (topBidNotional - topAskNotional) / topTotalNotional
      : null;
    add('spot_top_book_depth_quote', topDepth, 'quote_asset', rawSpotBooks, { reasonCodes: [...bookReasons, ...(topNotionalOverflow ? ['NUMERIC_OVERFLOW'] : [])], missingFields: topDepth === null ? [topNotionalOverflow ? 'finiteTopBookNotional' : 'freshSpotBook'] : [], transforms: ['top-book-notional'] });
    add('spot_top_book_imbalance', topImbalance, 'ratio', rawSpotBooks, { reasonCodes: [...bookReasons, ...(topNotionalOverflow ? ['NUMERIC_OVERFLOW'] : [])], missingFields: topImbalance === null ? [topNotionalOverflow ? 'finiteTopBookNotional' : 'freshSpotBook'] : [], transforms: ['top-book-notional-imbalance'] });

    const latestSpotDepth = latestFresh(spotDepths, nowMs, this.config.sourceStaleAfterMs);
    const depthReasons = rawSpotDepths.length === 0
      ? ['SPOT_DEPTH_MISSING']
      : spotDepths.length === 0
        ? ['SPOT_DEPTH_UNUSABLE']
        : latestSpotDepth === null
          ? ['SPOT_DEPTH_STALE']
          : [];
    const currentDepth = latestSpotDepth ? depthNotional(latestSpotDepth) : null;
    const depthOverflow = latestSpotDepth !== null && currentDepth === null;
    const effectiveDepthReasons = [...depthReasons, ...(depthOverflow ? ['NUMERIC_OVERFLOW'] : [])];
    add('spot_depth_quote', currentDepth?.total ?? null, 'quote_asset', rawSpotDepths, { reasonCodes: effectiveDepthReasons, missingFields: currentDepth === null ? [depthOverflow ? 'finiteSpotDepth' : 'freshSpotDepth'] : [], transforms: ['l2-depth-notional'] });
    add('spot_depth_imbalance', currentDepth && currentDepth.total > 0 ? (currentDepth.bid - currentDepth.ask) / currentDepth.total : null, 'ratio', rawSpotDepths, { reasonCodes: effectiveDepthReasons, missingFields: currentDepth === null ? [depthOverflow ? 'finiteSpotDepth' : 'freshSpotDepth'] : [], transforms: ['l2-depth-notional-imbalance'] });
    add('spot_book_slope_bps_per_level', latestSpotDepth ? bookSlope(latestSpotDepth) : null, 'basis_points_per_level', rawSpotDepths, { reasonCodes: depthReasons, missingFields: latestSpotDepth === null ? ['freshSpotDepth'] : [], transforms: ['symmetric-book-slope'] });
    let replenishment: number | null = null;
    if (latestSpotDepth && spotDepths.length >= 2) {
      const firstDepth = depthNotional(spotDepths[0]);
      replenishment = firstDepth && currentDepth && firstDepth.total > 0
        ? (currentDepth.total - firstDepth.total) / firstDepth.total
        : null;
    }
    add('spot_depth_replenishment_ratio', replenishment, 'ratio', rawSpotDepths, { reasonCodes: replenishment === null ? [depthOverflow ? 'NUMERIC_OVERFLOW' : 'DEPTH_HISTORY_INSUFFICIENT'] : [], missingFields: replenishment === null ? [depthOverflow ? 'finiteSpotDepthHistory' : 'multipleSpotDepthSnapshots'] : [], transforms: ['first-last-depth-change'] });
    const absorption = spotReturn !== null && Math.abs(spotReturn) > 1e-9 && knownFlow !== null && knownFlow > 0 && netFlow !== null
      ? Math.abs(netFlow) / Math.abs(spotReturn)
      : null;
    add('spot_absorption_quote_per_pct', absorption, 'quote_asset_per_percent', [...rawSpotTrades, ...rawSpotBooks], { reasonCodes: absorption === null ? [flowOverflow ? 'NUMERIC_OVERFLOW' : 'PRICE_OR_FLOW_UNAVAILABLE'] : [], missingFields: absorption === null ? [flowOverflow ? 'finiteAggressorFlow' : 'priceResponseAndNetFlow'] : [], transforms: ['flow-absorbed-per-price-response'] });

    const latestPerpBook = latestFresh(perpBooks, nowMs, this.config.derivativeStaleAfterMs);
    const latestPerpTrade = latestFresh(perpTrades, nowMs, this.config.derivativeStaleAfterMs);
    const latestPerpDepth = latestFresh(perpDepths, nowMs, this.config.derivativeStaleAfterMs);
    const futuresRecords = [...rawPerpTrades, ...rawPerpBooks, ...rawPerpDepths, ...rawFunding, ...rawOpenInterest, ...rawLiquidations];
    const usableFuturesRecords = [...perpTrades, ...perpBooks, ...perpDepths, ...funding, ...openInterest, ...liquidations];
    const futuresSeen = state.evidence.TRADE.some((record) => isPerpetual(record.instrument.productFamily)) ||
      state.evidence.BOOK_TICKER.some((record) => isPerpetual(record.instrument.productFamily)) ||
      state.evidence.FUNDING.length > 0 || state.evidence.OPEN_INTEREST.length > 0;
    const futuresCurrent = latestPerpBook !== null || latestPerpTrade !== null;
    const futuresReasons = !futuresSeen
      ? ['FUTURES_MISSING']
      : usableFuturesRecords.length === 0
        ? ['FUTURES_UNUSABLE']
        : !futuresCurrent
          ? ['FUTURES_STALE']
          : [];
    const perpPrice = pricePoints(state, 'PERPETUAL', startMs, nowMs);
    const freshPerpPrice = futuresCurrent ? perpPrice : [];
    const perpReturn = freshPerpPrice.length >= 2 ? percentChange(freshPerpPrice[0].price, freshPerpPrice[freshPerpPrice.length - 1].price) : null;
    add('perpetual_price_change_pct', perpReturn, 'percent', futuresRecords, { maxAgeMs: this.config.derivativeStaleAfterMs, reasonCodes: futuresReasons, missingFields: perpReturn === null ? ['freshPerpetualPriceHistory'] : [], transforms: ['first-last-price-return'] });
    const currentSpotPrice = latestSpotBook
      ? midpoint(latestSpotBook.bidPrice, latestSpotBook.askPrice)
      : latestSpotTrade?.price ?? null;
    const currentPerpPrice = latestPerpBook ? midpoint(latestPerpBook.bidPrice, latestPerpBook.askPrice) : latestPerpTrade?.price ?? null;
    const divergence = currentSpotPrice !== null && currentPerpPrice !== null
      ? ((currentPerpPrice - currentSpotPrice) / currentSpotPrice) * 100
      : null;
    add('spot_perpetual_divergence_pct', divergence, 'percent', [
      ...rawSpotBooks,
      ...rawSpotTrades,
      ...rawPerpBooks,
      ...rawPerpTrades,
    ], { maxAgeMs: this.config.derivativeStaleAfterMs, reasonCodes: divergence === null ? futuresReasons.length > 0 ? futuresReasons : ['CROSS_MARKET_PRICE_MISSING'] : [], missingFields: divergence === null ? ['freshSpotAndPerpetualPrices'] : [], transforms: ['spot-perpetual-mid-divergence'] });
    const spotCurrent = latestSpotBook !== null || latestSpotTrade !== null;
    const spotMoveTime = spotCurrent ? firstMoveTime(spotPrice, this.config.leadMoveThresholdPct) : null;
    const perpMoveTime = futuresCurrent ? firstMoveTime(perpPrice, this.config.leadMoveThresholdPct) : null;
    const leadMarket = spotMoveTime !== null && perpMoveTime !== null
      ? spotMoveTime < perpMoveTime ? 'SPOT' : perpMoveTime < spotMoveTime ? 'PERPETUAL' : 'NEITHER'
      : spotMoveTime !== null && futuresCurrent ? 'SPOT'
        : perpMoveTime !== null ? 'PERPETUAL'
          : 'UNKNOWN';
    const leadLagMs = spotMoveTime !== null && perpMoveTime !== null ? perpMoveTime - spotMoveTime : null;
    add('spot_perpetual_lead_market', futuresCurrent && spotCurrent ? leadMarket : null, 'label', [...rawSpotTrades, ...rawSpotBooks, ...rawPerpTrades, ...rawPerpBooks], { maxAgeMs: this.config.derivativeStaleAfterMs, reasonCodes: futuresCurrent && spotCurrent ? [] : futuresCurrent ? ['SPOT_PRICE_STALE'] : futuresReasons, missingFields: futuresCurrent && spotCurrent ? [] : ['freshSpotAndPerpetualPrices'], transforms: ['first-threshold-crossing-lead-market'] });
    add('spot_perpetual_lead_lag_ms', leadLagMs, 'milliseconds', [...rawSpotTrades, ...rawSpotBooks, ...rawPerpTrades, ...rawPerpBooks], { maxAgeMs: this.config.derivativeStaleAfterMs, reasonCodes: leadLagMs === null ? futuresReasons.length > 0 ? futuresReasons : ['LEAD_LAG_UNRESOLVED'] : [], missingFields: leadLagMs === null ? ['bothMarketMoveTimes'] : [], transforms: ['first-threshold-crossing-lead-lag'] });
    const perpetualDepth = latestPerpDepth ? depthNotional(latestPerpDepth) : null;
    const perpetualDepthOverflow = latestPerpDepth !== null && perpetualDepth === null;
    add('perpetual_depth_quote', perpetualDepth?.total ?? null, 'quote_asset', rawPerpDepths, { maxAgeMs: this.config.derivativeStaleAfterMs, reasonCodes: latestPerpDepth ? perpetualDepthOverflow ? ['NUMERIC_OVERFLOW'] : [] : futuresReasons.length > 0 ? futuresReasons : ['PERPETUAL_DEPTH_MISSING'], missingFields: perpetualDepth === null ? [perpetualDepthOverflow ? 'finitePerpetualDepth' : 'freshPerpetualDepth'] : [], transforms: ['l2-depth-notional'] });

    const latestFunding = latestFresh(funding, nowMs, this.config.derivativeStaleAfterMs);
    const fundingChange = latestFunding && funding.length >= 2 ? (latestFunding.fundingRate - funding[0].fundingRate) * 10_000 : null;
    add('funding_rate_bps', latestFunding ? latestFunding.fundingRate * 10_000 : null, 'basis_points', rawFunding, { maxAgeMs: this.config.derivativeStaleAfterMs, reasonCodes: latestFunding ? [] : rawFunding.length > 0 ? funding.length > 0 ? ['FUNDING_STALE'] : ['FUNDING_UNUSABLE'] : ['FUNDING_MISSING'], missingFields: latestFunding ? [] : ['freshFunding'], transforms: ['funding-rate-to-basis-points'] });
    add('funding_rate_change_bps', fundingChange, 'basis_points', rawFunding, { maxAgeMs: this.config.derivativeStaleAfterMs, reasonCodes: fundingChange === null ? latestFunding ? ['FUNDING_HISTORY_INSUFFICIENT'] : ['FUNDING_MISSING_OR_STALE'] : [], missingFields: fundingChange === null ? ['multipleFreshFundingObservations'] : [], transforms: ['first-last-funding-change'] });

    const latestOi = latestFresh(openInterest, nowMs, this.config.derivativeStaleAfterMs);
    const firstOi = openInterest[0] ?? null;
    const oiBaseChangePct = latestOi && firstOi && latestOi.openInterestBase !== null && firstOi.openInterestBase !== null
      ? percentChange(firstOi.openInterestBase, latestOi.openInterestBase)
      : null;
    const oiQuoteChangePct = latestOi && firstOi && latestOi.openInterestQuoteValue !== null && firstOi.openInterestQuoteValue !== null
      ? percentChange(firstOi.openInterestQuoteValue, latestOi.openInterestQuoteValue)
      : null;
    add('open_interest_base', latestOi?.openInterestBase ?? null, 'base_asset', rawOpenInterest, { maxAgeMs: this.config.derivativeStaleAfterMs, reasonCodes: latestOi ? [] : rawOpenInterest.length > 0 ? openInterest.length > 0 ? ['OPEN_INTEREST_STALE'] : ['OPEN_INTEREST_UNUSABLE'] : ['OPEN_INTEREST_MISSING'], missingFields: latestOi?.openInterestBase === null || latestOi === null ? ['freshOpenInterestBase'] : [], transforms: ['latest-open-interest'] });
    add('open_interest_quote', latestOi?.openInterestQuoteValue ?? null, 'quote_asset', rawOpenInterest, { maxAgeMs: this.config.derivativeStaleAfterMs, reasonCodes: latestOi ? [] : rawOpenInterest.length > 0 ? openInterest.length > 0 ? ['OPEN_INTEREST_STALE'] : ['OPEN_INTEREST_UNUSABLE'] : ['OPEN_INTEREST_MISSING'], missingFields: latestOi?.openInterestQuoteValue === null || latestOi === null ? ['freshOpenInterestQuote'] : [], transforms: ['latest-open-interest'] });
    add('open_interest_base_change_pct', oiBaseChangePct, 'percent', rawOpenInterest, { maxAgeMs: this.config.derivativeStaleAfterMs, reasonCodes: oiBaseChangePct === null ? ['OPEN_INTEREST_HISTORY_INSUFFICIENT'] : [], missingFields: oiBaseChangePct === null ? ['multipleOpenInterestBaseObservations'] : [], transforms: ['first-last-open-interest-change'] });
    add('open_interest_quote_change_pct', oiQuoteChangePct, 'percent', rawOpenInterest, { maxAgeMs: this.config.derivativeStaleAfterMs, reasonCodes: oiQuoteChangePct === null ? ['OPEN_INTEREST_HISTORY_INSUFFICIENT'] : [], missingFields: oiQuoteChangePct === null ? ['multipleOpenInterestQuoteObservations'] : [], transforms: ['first-last-open-interest-change'] });

    const liquidationWithPrice = liquidations.filter((liquidation) => liquidation.averagePrice !== null);
    const longLiquidationQuote = sum(liquidationWithPrice.filter((liquidation) => liquidation.liquidatedPositionSide === 'LONG').map((liquidation) => liquidation.filledQuantity * (liquidation.averagePrice as number)));
    const shortLiquidationQuote = sum(liquidationWithPrice.filter((liquidation) => liquidation.liquidatedPositionSide === 'SHORT').map((liquidation) => liquidation.filledQuantity * (liquidation.averagePrice as number)));
    const totalLiquidationQuote = longLiquidationQuote === null || shortLiquidationQuote === null
      ? null
      : safeAdd(longLiquidationQuote, shortLiquidationQuote);
    const liquidationOverflow = liquidationWithPrice.length > 0 && totalLiquidationQuote === null;
    const liquidationImbalance = totalLiquidationQuote !== null && totalLiquidationQuote > 0 && longLiquidationQuote !== null && shortLiquidationQuote !== null
      ? (shortLiquidationQuote - longLiquidationQuote) / totalLiquidationQuote
      : null;
    const liquidationReasons = liquidationOverflow ? ['NUMERIC_OVERFLOW'] : liquidationWithPrice.length > 0 ? [] : ['LIQUIDATIONS_MISSING'];
    const liquidationMissing = liquidationOverflow ? ['finiteLiquidationNotional'] : liquidationWithPrice.length > 0 ? [] : ['pricedLiquidations'];
    add('long_liquidation_quote', liquidationWithPrice.length > 0 ? longLiquidationQuote : null, 'quote_asset', rawLiquidations, { maxAgeMs: windowMs, reasonCodes: liquidationReasons, missingFields: liquidationMissing, transforms: ['liquidation-notional-by-position-side'] });
    add('short_liquidation_quote', liquidationWithPrice.length > 0 ? shortLiquidationQuote : null, 'quote_asset', rawLiquidations, { maxAgeMs: windowMs, reasonCodes: liquidationReasons, missingFields: liquidationMissing, transforms: ['liquidation-notional-by-position-side'] });
    add('liquidation_position_imbalance', liquidationImbalance, 'ratio', rawLiquidations, { maxAgeMs: windowMs, reasonCodes: liquidationImbalance === null ? liquidationOverflow ? ['NUMERIC_OVERFLOW'] : ['LIQUIDATIONS_MISSING'] : [], missingFields: liquidationImbalance === null ? liquidationOverflow ? ['finiteLiquidationNotional'] : ['pricedLiquidations'] : [], transforms: ['liquidation-position-imbalance'] });
    add('crowding_open_interest_change_pct', oiQuoteChangePct ?? oiBaseChangePct, 'percent', rawOpenInterest, { maxAgeMs: this.config.derivativeStaleAfterMs, reasonCodes: oiQuoteChangePct === null && oiBaseChangePct === null ? ['CROWDING_OI_UNAVAILABLE'] : [], missingFields: oiQuoteChangePct === null && oiBaseChangePct === null ? ['openInterestChange'] : [], transforms: ['crowding-open-interest-change'] });
    add('crowding_funding_rate_bps', latestFunding ? latestFunding.fundingRate * 10_000 : null, 'basis_points', rawFunding, { maxAgeMs: this.config.derivativeStaleAfterMs, reasonCodes: latestFunding ? [] : ['CROWDING_FUNDING_UNAVAILABLE'], missingFields: latestFunding ? [] : ['freshFunding'], transforms: ['crowding-funding-level'] });
    add('crowding_liquidation_imbalance', liquidationImbalance, 'ratio', rawLiquidations, { maxAgeMs: windowMs, reasonCodes: liquidationImbalance === null ? liquidationOverflow ? ['NUMERIC_OVERFLOW'] : ['CROWDING_LIQUIDATIONS_UNAVAILABLE'] : [], missingFields: liquidationImbalance === null ? liquidationOverflow ? ['finiteLiquidationNotional'] : ['pricedLiquidations'] : [], transforms: ['crowding-liquidation-imbalance'] });

    const market = this.marketReturn(windowMs, nowMs);
    const specific = spotReturn !== null && market.value !== null ? spotReturn - market.value : null;
    const marketReasons = market.value === null ? ['MARKET_SAMPLE_INSUFFICIENT'] : [];
    add('market_spot_return_pct', market.value, 'percent', market.evidence, { maxAgeMs: this.config.sourceStaleAfterMs, reasonCodes: marketReasons, missingFields: market.value === null ? ['minimumMarketSample'] : [], transforms: ['cross-sectional-median-return'] });
    add('symbol_specific_return_pct', specific, 'percent', [...rawSpotTrades, ...rawSpotBooks, ...market.evidence], { maxAgeMs: this.config.sourceStaleAfterMs, reasonCodes: specific === null ? marketReasons.length > 0 ? marketReasons : ['SYMBOL_RETURN_UNAVAILABLE'] : [], missingFields: specific === null ? ['symbolAndMarketReturn'] : [], transforms: ['symbol-return-minus-market-median'] });
    return output;
  }
}

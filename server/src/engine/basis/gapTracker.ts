/**
 * Basis engine — gap lifecycle tracking per symbol+direction.
 * Answers: how old is this gap, is it widening or closing, how many ticks has
 * it persisted above the entry threshold, and how stable is it (a flickering
 * gap is book noise, not a dislocation).
 */
import type { Clock } from '../v0/types.js';
import { coefficientOfVariation, slopePerMinute } from './math.js';
import type { BasisConfig } from './config.js';
import { gapLongSpotShortPerpPct, gapShortSpotLongPerpPct } from './math.js';
import type {
  BasisBookIngestResult,
  BasisBookPair,
  BasisCausalMarket,
  BasisDirection,
  BasisGapCausality,
  BasisGapEvolution,
  BasisGapTrend,
  GapState,
} from './types.js';

interface CausalLifecycle {
  publicState: BasisGapCausality;
  baselineGapPct: number;
  initiatingPriceTrend: BasisGapTrend;
  samples: Array<{ ts: number; v: number }>;
  initiatedAtAcceptedMs: number;
}

interface TrackerBucket {
  samples: Array<{ ts: number; v: number }>;
  openedTs: number | null; // when the gap first crossed watchGapPct
  persistTicks: number; // consecutive ticks ≥ watchGapPct
  lifecycle: CausalLifecycle | null;
}

function unknownCausality(): BasisGapCausality {
  return {
    quadrant: 'UNKNOWN',
    trend: 'UNKNOWN',
    initiatingMarket: 'UNKNOWN',
    source: 'UNKNOWN',
    initiatingSourceTs: null,
    initiatingSourceSequence: null,
    acceptedEventSequence: null,
    initiatingPriceTrend: 'UNKNOWN',
    ageMs: null,
    persistenceEvents: 0,
    slopePctPerMin: null,
    evolution: 'UNKNOWN',
    followerMarket: 'UNKNOWN',
    followerConfirmation: 'UNKNOWN',
    followerSourceTs: null,
    followerSourceSequence: null,
    lastSourceTs: null,
    lastSourceSequence: null,
    lastAcceptedEventSequence: null,
  };
}

export class GapTracker {
  private buckets = new Map<string, TrackerBucket>();

  constructor(
    private clock: Clock,
    private cfg: BasisConfig,
  ) {}

  private key(symbol: string, direction: BasisDirection): string {
    return `${symbol}|${direction}`;
  }

  private bucket(symbol: string, direction: BasisDirection): TrackerBucket {
    const k = this.key(symbol, direction);
    let b = this.buckets.get(k);
    if (!b) {
      b = { samples: [], openedTs: null, persistTicks: 0, lifecycle: null };
      if (this.buckets.size < this.cfg.maxUniverseSize * 2) this.buckets.set(k, b);
    }
    return b;
  }

  /** Attribute accepted, chronologically ordered price changes exactly once. */
  onBookIngest(result: BasisBookIngestResult | null): void {
    if (result === null) return;
    if (result.kind === 'DISCONTINUITY') {
      this.resetCausality(result.symbol);
      return;
    }
    // Causality belongs to the immutable cut that produced it. A later
    // refresh of the opposite leg must never make a stale or over-skewed
    // baseline look usable after the fact, so both sides of this accepted
    // event are judged at its own acceptance time.
    if (
      !this.causalPairUsable(result.before, result.acceptedAtMs) ||
      !this.causalPairUsable(result.after, result.acceptedAtMs)
    ) {
      this.resetCausality(result.symbol);
      return;
    }
    this.attribute(result.symbol, 'long_spot_short_perp', result.market, result.before, result.after, result.sourceEventTimeMs, result.sourceSequence, result.acceptedAtMs, result.acceptedEventSequence);
    this.attribute(result.symbol, 'short_spot_long_perp', result.market, result.before, result.after, result.sourceEventTimeMs, result.sourceSequence, result.acceptedAtMs, result.acceptedEventSequence);
  }

  /**
   * Record the current executable gap for one direction (call once per engine
   * tick) and return the derived state.
   */
  observe(symbol: string, direction: BasisDirection, gapPct: number | null, causalUsable = true): GapState {
    const b = this.bucket(symbol, direction);
    const now = this.clock.now();

    if (gapPct !== null && Number.isFinite(gapPct)) {
      b.samples.push({ ts: now, v: gapPct });
      if (b.samples.length > this.cfg.gapWindowSize) {
        b.samples.splice(0, b.samples.length - this.cfg.gapWindowSize);
      }
      if (gapPct >= this.cfg.watchGapPct) {
        if (b.openedTs === null) b.openedTs = now;
        b.persistTicks += 1;
      } else {
        b.openedTs = null;
        b.persistTicks = 0;
        b.lifecycle = null;
      }
    } else {
      // no data → the gap cannot be said to persist
      b.openedTs = null;
      b.persistTicks = 0;
      b.lifecycle = null;
    }

    if (!causalUsable || this.expired(b, now)) b.lifecycle = null;

    return this.state(symbol, direction, gapPct, causalUsable);
  }

  state(symbol: string, direction: BasisDirection, gapPct: number | null, causalUsable = true): GapState {
    const b = this.bucket(symbol, direction);
    const now = this.clock.now();
    // stability over the recent open-gap stretch only (all-window CV would
    // punish a gap for having opened at all)
    const recent = b.samples.slice(-Math.max(this.cfg.persistTicks * 2, 6)).map((s) => s.v);
    return {
      direction,
      gapPct,
      gapAgeMs: b.openedTs === null ? null : now - b.openedTs,
      persistTicks: b.persistTicks,
      slopePctPerMin: slopePerMinute(b.samples),
      stabilityCv: recent.length >= 3 ? coefficientOfVariation(recent) : null,
      samples: b.samples.length,
      causality: causalUsable ? this.publicCausality(b, now) : unknownCausality(),
    };
  }

  private attribute(
    symbol: string,
    direction: BasisDirection,
    market: Exclude<BasisCausalMarket, 'UNKNOWN'>,
    before: BasisBookPair,
    after: BasisBookPair,
    sourceEventTimeMs: number | null,
    sourceSequence: number | null,
    acceptedAtMs: number,
    acceptedEventSequence: number,
  ): void {
    const bucket = this.bucket(symbol, direction);
    const prior = this.gap(direction, before);
    const current = this.gap(direction, after);
    if (prior === null || current === null || current < this.cfg.watchGapPct) {
      bucket.lifecycle = null;
      return;
    }
    const delta = current - prior;
    if (!Number.isFinite(delta)) {
      bucket.lifecycle = null;
      return;
    }
    const significant = Math.abs(delta) >= this.cfg.causalMoveThresholdPct;
    const trend: BasisGapTrend = delta > 0 ? 'RISING' : delta < 0 ? 'FALLING' : 'UNKNOWN';
    const priceTrend = this.executableQuoteTrend(direction, market, before, after);
    const lifecycle = bucket.lifecycle;
    if (lifecycle && this.resolved(lifecycle, current)) {
      bucket.lifecycle = null;
      return;
    }
    if (!lifecycle || this.expired(bucket, this.clock.now())) {
      if (!significant || trend === 'UNKNOWN') {
        bucket.lifecycle = null;
        return;
      }
      this.startLifecycle(
        bucket,
        market,
        trend,
        priceTrend,
        prior,
        current,
        before,
        sourceEventTimeMs,
        sourceSequence,
        acceptedAtMs,
        acceptedEventSequence,
      );
      return;
    }

    const state = lifecycle.publicState;
    const decaying = this.distanceFromBaseline(lifecycle, current) < this.distanceFromBaseline(lifecycle, prior);
    if (
      market !== state.initiatingMarket &&
      lifecycle.initiatingPriceTrend !== 'UNKNOWN' &&
      priceTrend === lifecycle.initiatingPriceTrend &&
      decaying
    ) {
      state.followerConfirmation = 'CONFIRMED';
      state.followerSourceTs = sourceEventTimeMs;
      state.followerSourceSequence = sourceSequence;
      this.advanceLifecycle(
        bucket,
        lifecycle,
        current,
        sourceEventTimeMs,
        sourceSequence,
        acceptedEventSequence,
        'DECAYING',
      );
      return;
    }

    if (!significant || trend === 'UNKNOWN') {
      if (delta !== 0) {
        this.advanceLifecycle(
          bucket,
          lifecycle,
          current,
          sourceEventTimeMs,
          sourceSequence,
          acceptedEventSequence,
          decaying ? 'DECAYING' : 'GROWING',
        );
      }
      return;
    }

    if (market === state.initiatingMarket) {
      const sourcePriceFlipped = lifecycle.initiatingPriceTrend !== 'UNKNOWN' &&
        priceTrend !== lifecycle.initiatingPriceTrend;
      if (trend !== state.trend || sourcePriceFlipped) {
        this.startLifecycle(
          bucket,
          market,
          trend,
          priceTrend,
          prior,
          current,
          before,
          sourceEventTimeMs,
          sourceSequence,
          acceptedAtMs,
          acceptedEventSequence,
        );
        return;
      }
      this.advanceLifecycle(
        bucket,
        lifecycle,
        current,
        sourceEventTimeMs,
        sourceSequence,
        acceptedEventSequence,
        'GROWING',
      );
      return;
    }

    // An opposite-market move that does not confirm the initiator becomes a
    // new source cut; prior source/persistence never leak across the flip.
    this.startLifecycle(
      bucket,
      market,
      trend,
      priceTrend,
      prior,
      current,
      before,
      sourceEventTimeMs,
      sourceSequence,
      acceptedAtMs,
      acceptedEventSequence,
    );
  }

  private startLifecycle(
    bucket: TrackerBucket,
    market: Exclude<BasisCausalMarket, 'UNKNOWN'>,
    trend: Exclude<BasisGapTrend, 'UNKNOWN'>,
    priceTrend: BasisGapTrend,
    prior: number,
    current: number,
    before: BasisBookPair,
    sourceEventTimeMs: number | null,
    sourceSequence: number | null,
    acceptedAtMs: number,
    acceptedEventSequence: number,
  ): void {
    const baselineSourceTimeMs = this.pairCutSourceTime(before);
    const samples = sourceEventTimeMs === null
      ? []
      : baselineSourceTimeMs !== null && baselineSourceTimeMs < sourceEventTimeMs
        ? [{ ts: baselineSourceTimeMs, v: prior }, { ts: sourceEventTimeMs, v: current }]
        : [{ ts: sourceEventTimeMs, v: current }];
    const followerMarket = market === 'SPOT' ? 'PERPETUAL' : 'SPOT';
    const slope = slopePerMinute(samples);
    bucket.lifecycle = {
      baselineGapPct: prior,
      initiatingPriceTrend: priceTrend,
      samples,
      initiatedAtAcceptedMs: acceptedAtMs,
      publicState: {
        quadrant: `${trend}_${market === 'PERPETUAL' ? 'PERPETUAL' : 'SPOT'}_LED`,
        trend,
        initiatingMarket: market,
        source: market === 'SPOT' ? 'SPOT_BOOK' : 'PERPETUAL_BOOK',
        initiatingSourceTs: sourceEventTimeMs,
        initiatingSourceSequence: sourceSequence,
        acceptedEventSequence,
        initiatingPriceTrend: priceTrend,
        ageMs: null,
        persistenceEvents: 1,
        slopePctPerMin: slope !== null && Number.isFinite(slope) ? slope : null,
        evolution: 'GROWING',
        followerMarket,
        followerConfirmation: priceTrend === 'UNKNOWN' ? 'UNKNOWN' : 'PENDING',
        followerSourceTs: null,
        followerSourceSequence: null,
        lastSourceTs: sourceEventTimeMs,
        lastSourceSequence: sourceSequence,
        lastAcceptedEventSequence: acceptedEventSequence,
      },
    };
  }

  private advanceLifecycle(
    bucket: TrackerBucket,
    lifecycle: CausalLifecycle,
    current: number,
    sourceEventTimeMs: number | null,
    sourceSequence: number | null,
    acceptedEventSequence: number,
    evolution: Exclude<BasisGapEvolution, 'UNKNOWN'>,
  ): void {
    const lastTimed = lifecycle.samples.at(-1)?.ts ?? null;
    if (sourceEventTimeMs !== null && (lastTimed === null || sourceEventTimeMs > lastTimed)) {
      lifecycle.samples.push({ ts: sourceEventTimeMs, v: current });
      if (lifecycle.samples.length > this.cfg.gapWindowSize) {
        lifecycle.samples.splice(0, lifecycle.samples.length - this.cfg.gapWindowSize);
      }
    }
    const slope = slopePerMinute(lifecycle.samples);
    lifecycle.publicState.persistenceEvents = Math.min(
      this.cfg.gapWindowSize,
      lifecycle.publicState.persistenceEvents + 1,
    );
    lifecycle.publicState.slopePctPerMin = slope !== null && Number.isFinite(slope) ? slope : null;
    lifecycle.publicState.evolution = evolution;
    if (sourceEventTimeMs !== null) lifecycle.publicState.lastSourceTs = sourceEventTimeMs;
    if (sourceSequence !== null) lifecycle.publicState.lastSourceSequence = sourceSequence;
    lifecycle.publicState.lastAcceptedEventSequence = acceptedEventSequence;
  }

  private executableQuoteTrend(
    direction: BasisDirection,
    market: Exclude<BasisCausalMarket, 'UNKNOWN'>,
    before: BasisBookPair,
    after: BasisBookPair,
  ): BasisGapTrend {
    const prior = market === 'SPOT' ? before.spot : before.perpetual;
    const current = market === 'SPOT' ? after.spot : after.perpetual;
    if (!prior || !current) return 'UNKNOWN';
    const useBid = direction === 'long_spot_short_perp'
      ? market === 'PERPETUAL'
      : market === 'SPOT';
    const priorQuote = useBid ? prior.bid : prior.ask;
    const currentQuote = useBid ? current.bid : current.ask;
    if (!(priorQuote > 0) || !(currentQuote > 0)) return 'UNKNOWN';
    return currentQuote > priorQuote ? 'RISING' : currentQuote < priorQuote ? 'FALLING' : 'UNKNOWN';
  }

  private publicCausality(bucket: TrackerBucket, now: number): BasisGapCausality {
    if (!bucket.lifecycle || this.expired(bucket, now)) return unknownCausality();
    const initiated = bucket.lifecycle.publicState.initiatingSourceTs;
    const ageMs = initiated !== null && Number.isSafeInteger(now) && now >= initiated
      ? now - initiated
      : null;
    return { ...bucket.lifecycle.publicState, ageMs };
  }

  private expired(bucket: TrackerBucket, now: number): boolean {
    const initiated = bucket.lifecycle?.initiatedAtAcceptedMs;
    return initiated !== undefined &&
      (!Number.isSafeInteger(now) || now < initiated || now - initiated > this.cfg.causalExpiryMs);
  }

  private resolved(lifecycle: CausalLifecycle, current: number): boolean {
    return lifecycle.publicState.trend === 'RISING'
      ? current <= lifecycle.baselineGapPct
      : current >= lifecycle.baselineGapPct;
  }

  private distanceFromBaseline(lifecycle: CausalLifecycle, current: number): number {
    return Math.abs(current - lifecycle.baselineGapPct);
  }

  private gap(direction: BasisDirection, pair: BasisBookPair): number | null {
    if (!pair.spot || !pair.perpetual) return null;
    return direction === 'long_spot_short_perp'
      ? gapLongSpotShortPerpPct(pair.spot.ask, pair.perpetual.bid)
      : gapShortSpotLongPerpPct(pair.spot.bid, pair.perpetual.ask);
  }

  private pairCutSourceTime(pair: BasisBookPair): number | null {
    const spot = pair.spot?.sourceEventTimeMs;
    const perpetual = pair.perpetual?.sourceEventTimeMs;
    return Number.isSafeInteger(spot) && Number.isSafeInteger(perpetual)
      ? Math.max(spot!, perpetual!)
      : null;
  }

  private causalPairUsable(pair: BasisBookPair, acceptedAtMs: number): boolean {
    if (!pair.spot || !pair.perpetual || !Number.isSafeInteger(acceptedAtMs)) return false;
    const spotAgeMs = Math.max(0, acceptedAtMs - pair.spot.ts);
    const perpetualAgeMs = Math.max(0, acceptedAtMs - pair.perpetual.ts);
    return spotAgeMs <= this.cfg.staleMs &&
      perpetualAgeMs <= this.cfg.staleMs &&
      Math.abs(pair.spot.ts - pair.perpetual.ts) <= this.cfg.maxLegSkewMs;
  }

  private resetCausality(symbol: string): void {
    for (const direction of ['long_spot_short_perp', 'short_spot_long_perp'] as const) {
      const bucket = this.buckets.get(this.key(symbol, direction));
      if (bucket) bucket.lifecycle = null;
    }
  }

  /** Drop tracking state (symbol left the universe / entered cooldown). */
  reset(symbol: string): void {
    this.buckets.delete(this.key(symbol, 'long_spot_short_perp'));
    this.buckets.delete(this.key(symbol, 'short_spot_long_perp'));
  }

  retainSymbols(symbols: ReadonlySet<string>): void {
    for (const key of this.buckets.keys()) {
      const separator = key.indexOf('|');
      if (separator < 0 || !symbols.has(key.slice(0, separator))) this.buckets.delete(key);
    }
  }

  clear(): void {
    this.buckets.clear();
  }
}

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
  BasisGapTrend,
  GapState,
} from './types.js';

interface TrackerBucket {
  samples: Array<{ ts: number; v: number }>;
  openedTs: number | null; // when the gap first crossed watchGapPct
  persistTicks: number; // consecutive ticks ≥ watchGapPct
  causality: BasisGapCausality;
}

function unknownCausality(): BasisGapCausality {
  return {
    quadrant: 'UNKNOWN',
    trend: 'UNKNOWN',
    initiatingMarket: 'UNKNOWN',
    initiatingSourceTs: null,
    acceptedEventSequence: null,
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
      b = { samples: [], openedTs: null, persistTicks: 0, causality: unknownCausality() };
      if (this.buckets.size < this.cfg.maxUniverseSize * 2) this.buckets.set(k, b);
    }
    return b;
  }

  /** Attribute accepted, chronologically ordered price changes exactly once. */
  onBookIngest(result: BasisBookIngestResult | null): void {
    if (result === null) return;
    if (result.kind === 'DISCONTINUITY' || result.chronology !== 'ORDERED') {
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
    this.attribute(result.symbol, 'long_spot_short_perp', result.market, result.before, result.after, result.sourceTs, result.acceptedEventSequence);
    this.attribute(result.symbol, 'short_spot_long_perp', result.market, result.before, result.after, result.sourceTs, result.acceptedEventSequence);
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
        b.causality = unknownCausality();
      }
    } else {
      // no data → the gap cannot be said to persist
      b.openedTs = null;
      b.persistTicks = 0;
      b.causality = unknownCausality();
    }

    if (!causalUsable) b.causality = unknownCausality();

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
      causality: causalUsable ? { ...b.causality } : unknownCausality(),
    };
  }

  private attribute(
    symbol: string,
    direction: BasisDirection,
    market: Exclude<BasisCausalMarket, 'UNKNOWN'>,
    before: BasisBookPair,
    after: BasisBookPair,
    sourceTs: number,
    acceptedEventSequence: number,
  ): void {
    const bucket = this.bucket(symbol, direction);
    const prior = this.gap(direction, before);
    const current = this.gap(direction, after);
    if (prior === null || current === null || current < this.cfg.watchGapPct) {
      bucket.causality = unknownCausality();
      return;
    }
    const delta = current - prior;
    if (!Number.isFinite(delta) || Math.abs(delta) < this.cfg.causalMoveThresholdPct) return;
    const trend: Exclude<BasisGapTrend, 'UNKNOWN'> = delta > 0 ? 'RISING' : 'FALLING';
    bucket.causality = {
      quadrant: `${trend}_${market === 'PERPETUAL' ? 'PERPETUAL' : 'SPOT'}_LED`,
      trend,
      initiatingMarket: market,
      initiatingSourceTs: sourceTs,
      acceptedEventSequence,
    };
  }

  private gap(direction: BasisDirection, pair: BasisBookPair): number | null {
    if (!pair.spot || !pair.perpetual) return null;
    return direction === 'long_spot_short_perp'
      ? gapLongSpotShortPerpPct(pair.spot.ask, pair.perpetual.bid)
      : gapShortSpotLongPerpPct(pair.spot.bid, pair.perpetual.ask);
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
      if (bucket) bucket.causality = unknownCausality();
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

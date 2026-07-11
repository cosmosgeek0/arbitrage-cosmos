/**
 * Basis engine — gap lifecycle tracking per symbol+direction.
 * Answers: how old is this gap, is it widening or closing, how many ticks has
 * it persisted above the entry threshold, and how stable is it (a flickering
 * gap is book noise, not a dislocation).
 */
import type { Clock } from '../v0/types.js';
import { coefficientOfVariation, slopePerMinute } from './math.js';
import type { BasisConfig } from './config.js';
import type { BasisDirection, GapState } from './types.js';

interface TrackerBucket {
  samples: Array<{ ts: number; v: number }>;
  openedTs: number | null; // when the gap first crossed watchGapPct
  persistTicks: number; // consecutive ticks ≥ watchGapPct
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
      b = { samples: [], openedTs: null, persistTicks: 0 };
      if (this.buckets.size < this.cfg.maxUniverseSize * 2) this.buckets.set(k, b);
    }
    return b;
  }

  /**
   * Record the current executable gap for one direction (call once per engine
   * tick) and return the derived state.
   */
  observe(symbol: string, direction: BasisDirection, gapPct: number | null): GapState {
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
      }
    } else {
      // no data → the gap cannot be said to persist
      b.openedTs = null;
      b.persistTicks = 0;
    }

    return this.state(symbol, direction, gapPct);
  }

  state(symbol: string, direction: BasisDirection, gapPct: number | null): GapState {
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
    };
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

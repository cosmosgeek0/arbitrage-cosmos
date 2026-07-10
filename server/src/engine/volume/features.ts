/**
 * Feature assembler — implements the frozen FeatureSource contract and
 * produces WakeupSnapshot (a structural superset of FeatureSnapshot).
 * Pure state + math; no I/O, no express, no network.
 */
import type { Clock, FeatureSnapshot, TradeTick, BookTicker, WindowKey } from '../v0/types.js';
import { WINDOW_KEYS } from '../v0/types.js';
import type { WakeupSnapshot, BaselineStats } from './types.js';
import type { VolumeConfig } from './config.js';
import { RollingTape, type SeedMinute } from './rolling.js';
import { BookQualityTracker } from './depth.js';
import { computeBaseline, volumeMultipleOf, tradeCountMultipleOf } from './baseline.js';
import { analyzeTape } from './tape.js';

const WINDOW_SECONDS: Record<WindowKey, number> = {
  '1s': 1,
  '5s': 5,
  '15s': 15,
  '60s': 60,
  '5m': 300,
  '1h': 3600,
};

interface SymbolState {
  tape: RollingTape;
  book: BookQualityTracker;
  /** ts when the 1s activation multiple first crossed the trigger; null when calm */
  triggerFirstTs: number | null;
  baselineCache: { minuteKey: number; stats: BaselineStats } | null;
}

export class VolumeFeatureEngine {
  private state = new Map<string, SymbolState>();

  constructor(
    private cfg: VolumeConfig,
    private clock: Clock,
  ) {}

  /** Register a symbol for observation (starts its baseline clock). */
  observe(symbol: string): void {
    if (!this.state.has(symbol)) {
      this.state.set(symbol, {
        tape: new RollingTape(this.cfg, this.clock.now()),
        book: new BookQualityTracker(this.cfg),
        triggerFirstTs: null,
        baselineCache: null,
      });
    }
  }

  onTrade(t: TradeTick, printCount = 1): void {
    this.observe(t.symbol);
    this.state.get(t.symbol)!.tape.addTrade(t, printCount);
  }

  onBook(b: BookTicker): void {
    this.observe(b.symbol);
    this.state.get(b.symbol)!.book.onBook(b);
  }

  seedMinute(symbol: string, sample: SeedMinute): void {
    this.observe(symbol);
    const state = this.state.get(symbol)!;
    state.tape.seedMinute(sample);
    state.baselineCache = null;
  }

  symbols(): string[] {
    return [...this.state.keys()];
  }

  /** FeatureSource contract. */
  snapshot(symbol: string): FeatureSnapshot | null {
    return this.snapshotEx(symbol, 0);
  }

  /** Extended snapshot; focusAgeMs is injected by the orchestrator. */
  snapshotEx(symbol: string, focusAgeMs: number): WakeupSnapshot | null {
    const s = this.state.get(symbol);
    if (!s) return null;
    const now = this.clock.now();

    // baseline (cached per completed minute — samples only change on rollover)
    const minuteKey = Math.floor(now / 60_000);
    if (!s.baselineCache || s.baselineCache.minuteKey !== minuteKey) {
      s.baselineCache = {
        minuteKey,
        stats: computeBaseline(s.tape.minuteHistory(now), this.cfg),
      };
    }
    const baseline = s.baselineCache.stats;

    const windows: WakeupSnapshot['windows'] = {};
    const volumeMultiple: WakeupSnapshot['volumeMultiple'] = {};
    const tradeCountMultiple: WakeupSnapshot['tradeCountMultiple'] = {};
    const realizedVolPct: WakeupSnapshot['realizedVolPct'] = {};
    for (const key of WINDOW_KEYS) {
      const w = s.tape.window(key, now);
      windows[key] = {
        quoteVolume: w.quoteVolume,
        tradeCount: w.tradeCount,
        avgTradeSize: w.avgTradeSize,
        priceMovePct: w.priceMovePct,
        takerBuyRatio: w.takerBuyRatio,
        largeTradeCount: w.largeTradeCount,
      };
      volumeMultiple[key] = volumeMultipleOf(w.quoteVolume, WINDOW_SECONDS[key], baseline);
      tradeCountMultiple[key] = tradeCountMultipleOf(w.tradeCount, WINDOW_SECONDS[key], baseline);
      realizedVolPct[key] = w.realizedVolPct;
    }

    // signal-age tracking: arm on 1s trigger, disarm when 60s normalizes
    const m1s = volumeMultiple['1s'];
    const m60s = volumeMultiple['60s'];
    if (
      m1s !== null &&
      m1s !== undefined &&
      m1s >= this.cfg.vol1sMultiple &&
      windows['1s']!.quoteVolume >= this.cfg.minActivationQuote1s
    ) {
      if (s.triggerFirstTs === null) s.triggerFirstTs = now;
    } else if (
      s.triggerFirstTs !== null &&
      (m60s === null || m60s === undefined || m60s < this.cfg.volumeNormalizedBelowMultiple)
    ) {
      s.triggerFirstTs = null;
    }

    // price acceleration: recent 15s rate vs the prior 45s rate (pct/min)
    const move15 = windows['15s']!.priceMovePct;
    const move60 = windows['60s']!.priceMovePct;
    let accelerationPctPerMin: number | null = null;
    if (windows['60s']!.tradeCount > 0) {
      const prior45 = ((1 + move60 / 100) / (1 + move15 / 100) - 1) * 100;
      accelerationPctPerMin = move15 * 4 - prior45 * (4 / 3);
    }

    const book = s.book.quality(now);

    return {
      symbol,
      ts: now,
      spotBid: s.book.lastBook()?.bid ?? null,
      spotAsk: s.book.lastBook()?.ask ?? null,
      perpBid: null,
      perpAsk: null,
      markPrice: null,
      fundingRate: null,
      spotSpreadBps: book.spreadBps,
      perpSpreadBps: null,
      spotStalenessMs: book.stalenessMs,
      perpStalenessMs: null,
      basisLongSpotPct: null,
      basisShortSpotPct: null,
      basisSlopePctPerMin: null,
      windows,
      volumeMultiple,
      tradeCountMultiple,
      baselineReady: baseline.ready,
      depthScore: book.depthScore,
      baseline,
      tape:
        s.tape.lastTradeTs !== null
          ? analyzeTape(s.tape.rawWindow(now, this.cfg.rawTradeWindowMs), this.cfg.rawTradeWindowMs, this.cfg)
          : null,
      book,
      accelerationPctPerMin,
      realizedVolPct,
      focusAgeMs,
      signalAgeMs: s.triggerFirstTs === null ? Infinity : now - s.triggerFirstTs,
    };
  }
}

/**
 * Synthetic replay runner — drives the whole engine from scripted tick
 * sequences on an injected ManualClock (ENGINE.md §16 Part 12 posture:
 * prove event → feature → decision → proposal/reject → ledger with ZERO
 * network). Also ships deterministic scenario builders for tests.
 */
import type { ManualClock } from '../v0/clock.js';
import type { ScenarioBook, ScenarioSymbolScript, ScenarioTrade } from './types.js';
import type { VolumeEngine } from './engine.js';

export interface PlayOptions {
  tickMs?: number;
  /** also tick immediately after each event timestamp (hot-path evaluation) */
  tickOnEvent?: boolean;
}

export class SyntheticReplayRunner {
  constructor(
    private engine: VolumeEngine,
    private clock: ManualClock,
  ) {}

  play(symbols: ScenarioSymbolScript[], durationMs: number, opts: PlayOptions = {}): void {
    const tickMs = opts.tickMs ?? this.engine.cfg.tickMs;
    const tickOnEvent = opts.tickOnEvent ?? true;
    const base = this.clock.now();

    for (const s of symbols) {
      if (s.pinned) this.engine.pin(s.symbol);
      if (s.openPosition) this.engine.markOpenPosition(s.symbol, true);
    }

    type Ev = { ts: number; apply: () => void };
    const evs: Ev[] = [];
    for (const s of symbols) {
      for (const t of s.trades) {
        const ts = base + t.atMs;
        evs.push({
          ts,
          apply: () =>
            this.engine.onTrade(
              {
                symbol: s.symbol,
                price: t.price,
                qty: t.qty,
                quoteQty: t.price * t.qty,
                isBuyerMaker: t.isBuyerMaker ?? false,
                ts,
              },
              t.printCount ?? 1,
            ),
        });
      }
      for (const b of s.books) {
        const ts = base + b.atMs;
        evs.push({
          ts,
          apply: () =>
            this.engine.onBook({
              symbol: s.symbol,
              bid: b.bid,
              ask: b.ask,
              bidQty: b.bidQty ?? 1_000_000,
              askQty: b.askQty ?? 1_000_000,
              ts,
            }),
        });
      }
    }
    evs.sort((a, b) => a.ts - b.ts);

    const end = base + durationMs;
    let nextTick = base + tickMs;
    let i = 0;
    let lastEventTickTs = -1;
    for (;;) {
      const tEv = i < evs.length ? evs[i].ts : Infinity;
      const tNext = Math.min(tEv, nextTick);
      if (tNext > end) break;
      this.clock.set(tNext);
      if (tEv <= nextTick) {
        while (i < evs.length && evs[i].ts === tEv) {
          evs[i].apply();
          i++;
        }
        if (tickOnEvent && tEv !== lastEventTickTs) {
          this.engine.tick();
          lastEventTickTs = tEv;
        }
      } else {
        this.engine.tick();
        nextTick += tickMs;
      }
    }
    this.clock.set(end);
    this.engine.tick();
  }
}

// ---------- deterministic scenario builders ----------

/** mulberry32 — tiny deterministic PRNG so scenarios replay identically. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Quiet/dead tape: sparse small trades at flat price — the symbol's "normal". */
export function quietTape(opts: {
  startMs: number;
  minutes: number;
  quotePerMin: number;
  tradesPerMin: number;
  price: number;
  rand: () => number;
}): ScenarioTrade[] {
  const out: ScenarioTrade[] = [];
  const gap = 60_000 / opts.tradesPerMin;
  for (let m = 0; m < opts.minutes; m++) {
    for (let k = 0; k < opts.tradesPerMin; k++) {
      const jitter = 0.5 + opts.rand();
      out.push({
        atMs: opts.startMs + m * 60_000 + Math.floor(k * gap),
        price: opts.price,
        qty: (opts.quotePerMin / opts.tradesPerMin / opts.price) * jitter,
        isBuyerMaker: opts.rand() < 0.5,
      });
    }
  }
  return out;
}

/** Wakeup burst: dense tape with configurable ramp, taker bias, size shape. */
export function burstTape(opts: {
  startMs: number;
  durationMs: number;
  quotePerSec: number;
  tradesPerSec: number;
  startPrice: number;
  totalMovePct: number;
  takerBuyRatio: number;
  rand: () => number;
  uniformQty?: boolean;
  alternateSides?: boolean;
}): ScenarioTrade[] {
  const out: ScenarioTrade[] = [];
  const n = Math.max(1, Math.round((opts.durationMs / 1000) * opts.tradesPerSec));
  const gap = opts.durationMs / n;
  for (let k = 0; k < n; k++) {
    const progress = k / Math.max(1, n - 1);
    const price = opts.startPrice * (1 + (opts.totalMovePct / 100) * progress);
    const jitter = opts.uniformQty ? 1 : 0.4 + 1.2 * opts.rand();
    const isBuyerMaker = opts.alternateSides ? k % 2 === 0 : opts.rand() >= opts.takerBuyRatio;
    out.push({
      atMs: opts.startMs + Math.floor(k * gap),
      price,
      qty: (opts.quotePerSec / opts.tradesPerSec / price) * jitter,
      isBuyerMaker,
    });
  }
  return out;
}

/** Steady book updates (spread/depth controlled). */
export function steadyBooks(opts: {
  startMs: number;
  durationMs: number;
  everyMs: number;
  mid: number;
  spreadBps: number;
  qty: number;
}): ScenarioBook[] {
  const out: ScenarioBook[] = [];
  const half = (opts.mid * opts.spreadBps) / 10_000 / 2;
  for (let t = opts.startMs; t <= opts.startMs + opts.durationMs; t += opts.everyMs) {
    out.push({ atMs: t, bid: opts.mid - half, ask: opts.mid + half, bidQty: opts.qty, askQty: opts.qty });
  }
  return out;
}

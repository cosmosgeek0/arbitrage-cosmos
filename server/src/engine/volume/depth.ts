/**
 * Depth / spread quality analyzer. BookTicker-fed (top of book) with a rolling
 * norm so "depth vanished while volume spiked" is detectable — liquidity that
 * evaporates on activation is a classic fake-wakeup tell. Partial-depth
 * upgrades arrive only at focus tier (see adapters.ts) and simply refine
 * topDepthUsd; the math here stays the same.
 */
import type { BookTicker } from '../v0/types.js';
import type { BookQuality } from './types.js';
import type { VolumeConfig } from './config.js';

export class BookQualityTracker {
  private last: BookTicker | null = null;
  private depthHistory: number[] = []; // rolling topDepthUsd samples
  constructor(private cfg: VolumeConfig) {}

  onBook(b: BookTicker): void {
    this.last = b;
    const depthUsd = (b.bid * b.bidQty + b.ask * b.askQty) / 2;
    this.depthHistory.push(depthUsd);
    if (this.depthHistory.length > this.cfg.bookHistorySize) this.depthHistory.shift();
  }

  lastBook(): BookTicker | null {
    return this.last;
  }

  quality(nowTs: number): BookQuality {
    const b = this.last;
    if (!b || b.bid <= 0 || b.ask <= 0) {
      return {
        spreadBps: null,
        topDepthUsd: null,
        depthScore: null,
        depthVsNorm: null,
        stalenessMs: null,
      };
    }
    const mid = (b.bid + b.ask) / 2;
    const spreadBps = ((b.ask - b.bid) / mid) * 10_000;
    const topDepthUsd = (b.bid * b.bidQty + b.ask * b.askQty) / 2;
    // spread component: 1 at zero spread, 0 at maxSpreadBps; depth component:
    // saturates at benchmarkDepthUsd. Composite is their product.
    const spreadComponent = Math.max(0, 1 - spreadBps / this.cfg.maxSpreadBps);
    const depthComponent = Math.min(1, topDepthUsd / this.cfg.benchmarkDepthUsd);
    const sorted = [...this.depthHistory].sort((x, y) => x - y);
    const medDepth = sorted.length > 0 ? sorted[sorted.length >> 1] : null;
    return {
      spreadBps,
      topDepthUsd,
      depthScore: spreadComponent * depthComponent,
      depthVsNorm: medDepth && medDepth > 0 ? topDepthUsd / medDepth : null,
      stalenessMs: nowTs - b.ts,
    };
  }
}

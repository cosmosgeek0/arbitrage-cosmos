import type { Ledger } from '../ledger.js';
import type { ActiveSignal, AppConfig, SymbolRow, SymbolStatus } from '../types.js';

interface TrackState {
  ticksAbove: number;
  ticksBelow: number;
  signal: ActiveSignal | null;
}

/**
 * Paper basis scanner — strategy module #1.
 * Detects a spot/perp basis wide enough to survive fees, requires it to
 * persist across ticks, then opens a paper "signal" (NOT an order — nothing
 * here talks to trading endpoints). Every open/close is ledgered.
 */
export class Scanner {
  private track = new Map<string, TrackState>();

  constructor(
    private readonly cfg: AppConfig,
    private readonly ledger: Ledger
  ) {}

  get grossThresholdPct(): number {
    return this.cfg.feesPct + this.cfg.minNetBasisPct;
  }

  statusOf(symbol: string): SymbolStatus {
    const t = this.track.get(symbol);
    if (!t) return 'idle';
    if (t.signal) return 'signal';
    if (t.ticksAbove > 0) return 'watching';
    return 'idle';
  }

  activeSignals(): ActiveSignal[] {
    const out: ActiveSignal[] = [];
    for (const t of this.track.values()) if (t.signal) out.push(t.signal);
    out.sort((a, b) => b.openedTs - a.openedTs);
    return out;
  }

  watchingCount(): number {
    let n = 0;
    for (const t of this.track.values()) if (!t.signal && t.ticksAbove > 0) n++;
    return n;
  }

  tick(rows: SymbolRow[]): void {
    const threshold = this.grossThresholdPct;
    for (const row of rows) {
      if (row.basisPct === null) continue;
      if ((row.quoteVolume24h ?? 0) < this.cfg.minQuoteVolume24h) continue;

      let t = this.track.get(row.symbol);
      if (!t) {
        t = { ticksAbove: 0, ticksBelow: 0, signal: null };
        this.track.set(row.symbol, t);
      }

      const gross = Math.abs(row.basisPct);

      if (t.signal) {
        t.signal.basisNow = row.basisPct;
        if (Math.abs(row.basisPct) > Math.abs(t.signal.basisPeak)) {
          t.signal.basisPeak = row.basisPct;
          this.ledger.updateSignalPeak(t.signal.id, row.basisPct);
        }
        // Signal closes when the edge no longer covers fees, persistently.
        if (gross < this.cfg.feesPct) {
          t.ticksBelow++;
          if (t.ticksBelow >= this.cfg.persistTicks) {
            this.ledger.closeSignal(t.signal.id, Date.now(), row.basisPct);
            this.ledger.logEvent('signal.close', row.symbol, {
              id: t.signal.id,
              basisClose: row.basisPct,
              basisPeak: t.signal.basisPeak,
              openedTs: t.signal.openedTs,
            });
            t.signal = null;
            t.ticksAbove = 0;
            t.ticksBelow = 0;
          }
        } else {
          t.ticksBelow = 0;
        }
        continue;
      }

      if (gross >= threshold) {
        t.ticksAbove++;
        if (t.ticksAbove >= this.cfg.persistTicks) {
          const side = row.basisPct > 0 ? 'SHORT_PERP_LONG_SPOT' : 'LONG_PERP_SHORT_SPOT';
          const id = this.ledger.openSignal({
            symbol: row.symbol,
            side,
            openedTs: Date.now(),
            basisOpen: row.basisPct,
            fundingOpen: row.fundingRate,
          });
          t.signal = {
            id,
            symbol: row.symbol,
            side,
            openedTs: Date.now(),
            basisOpen: row.basisPct,
            basisNow: row.basisPct,
            basisPeak: row.basisPct,
            fundingOpen: row.fundingRate,
            spotOpen: row.spot,
            perpOpen: row.perpMark,
          };
          this.ledger.logEvent('signal.open', row.symbol, {
            id,
            side,
            basisOpen: row.basisPct,
            fundingOpen: row.fundingRate,
            spot: row.spot,
            perpMark: row.perpMark,
          });
        }
      } else {
        t.ticksAbove = 0;
      }
    }
  }
}

import type { Ledger } from '../ledger.js';
import type { AppConfig, Proposal, SymbolRow, SymbolStatus } from '../types.js';

interface TrackState {
  ticksAbove: number;
  ticksBelow: number;
  proposal: Proposal | null;
}

/**
 * Basis strategy — monitor only. Produces PROPOSALS with an explanation.
 * It never places orders: approving a proposal only prefills the manual
 * trade ticket, which still passes the risk gate and confirmation modal.
 */
export class Scanner {
  private track = new Map<string, TrackState>();
  lastTickTs: number | null = null;

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
    if (t.proposal) return 'signal';
    if (t.ticksAbove > 0) return 'watching';
    return 'idle';
  }

  proposals(): Proposal[] {
    const out: Proposal[] = [];
    for (const t of this.track.values()) if (t.proposal) out.push(t.proposal);
    out.sort((a, b) => Math.abs(b.basisNow) - Math.abs(a.basisNow));
    return out;
  }

  watchingCount(): number {
    let n = 0;
    for (const t of this.track.values()) if (!t.proposal && t.ticksAbove > 0) n++;
    return n;
  }

  private confidence(row: SymbolRow, ageMs: number): number {
    // Deliberately simple and explainable: persistence + liquidity.
    const ageScore = Math.min(ageMs / (30 * 60 * 1000), 1) * 0.3;
    const vol = row.quoteVolume24h ?? 0;
    const volScore = vol > 20_000_000 ? 0.2 : vol > 8_000_000 ? 0.1 : 0;
    return Math.round((0.3 + ageScore + volScore) * 100) / 100;
  }

  private reason(row: SymbolRow): string {
    const vol = row.quoteVolume24h ? `$${(row.quoteVolume24h / 1e6).toFixed(1)}M` : '?';
    return (
      `|basis| ${Math.abs(row.basisPct!).toFixed(2)}% > threshold ${this.grossThresholdPct.toFixed(2)}% ` +
      `for ${this.cfg.persistTicks}+ ticks · 24h spot vol ${vol} · funding ${row.fundingRate !== null ? (row.fundingRate * 100).toFixed(4) + '%' : '?'}`
    );
  }

  tick(rows: SymbolRow[]): void {
    this.lastTickTs = Date.now();
    const threshold = this.grossThresholdPct;
    for (const row of rows) {
      if (row.basisPct === null) continue;
      if ((row.quoteVolume24h ?? 0) < this.cfg.minQuoteVolume24h) continue;

      let t = this.track.get(row.symbol);
      if (!t) {
        t = { ticksAbove: 0, ticksBelow: 0, proposal: null };
        this.track.set(row.symbol, t);
      }

      const gross = Math.abs(row.basisPct);

      if (t.proposal) {
        const p = t.proposal;
        p.basisNow = row.basisPct;
        p.netEdgePct = gross - this.cfg.feesPct;
        p.spotPrice = row.spot;
        p.perpMark = row.perpMark;
        p.fundingRate = row.fundingRate;
        p.confidence = this.confidence(row, Date.now() - p.openedTs);
        if (Math.abs(row.basisPct) > Math.abs(p.basisPeak)) {
          p.basisPeak = row.basisPct;
          this.ledger.updateSignalPeak(p.id, row.basisPct);
        }
        if (gross < this.cfg.feesPct) {
          t.ticksBelow++;
          if (t.ticksBelow >= this.cfg.persistTicks) {
            this.ledger.closeSignal(p.id, Date.now(), row.basisPct);
            this.ledger.logEvent('strategy_signal', row.symbol, {
              action: 'closed',
              id: p.id,
              basisClose: row.basisPct,
              basisPeak: p.basisPeak,
            });
            t.proposal = null;
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
          t.proposal = {
            id,
            symbol: row.symbol,
            side,
            openedTs: Date.now(),
            basisOpen: row.basisPct,
            basisNow: row.basisPct,
            basisPeak: row.basisPct,
            fundingRate: row.fundingRate,
            spotPrice: row.spot,
            perpMark: row.perpMark,
            feesPct: this.cfg.feesPct,
            netEdgePct: gross - this.cfg.feesPct,
            borrow:
              side === 'LONG_PERP_SHORT_SPOT'
                ? 'required — availability NOT checked in v0'
                : 'not required',
            reason: this.reason(row),
            confidence: this.confidence(row, 0),
            quoteVolume24h: row.quoteVolume24h,
          };
          this.ledger.logEvent('strategy_signal', row.symbol, {
            action: 'opened',
            id,
            side,
            basisOpen: row.basisPct,
            fundingOpen: row.fundingRate,
            reason: t.proposal.reason,
          });
        }
      } else {
        t.ticksAbove = 0;
      }
    }
  }
}

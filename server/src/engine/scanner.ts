import type { Ledger } from '../ledger.js';
import type { AppConfig, Proposal, SymbolRow, SymbolStatus } from '../types.js';

interface TrackState {
  ticksAbove: number;
  ticksBelow: number;
  proposal: Proposal | null;
}

type ReconciliationReason = 'symbol_removed' | 'evidence_stale' | 'symbol_ineligible';

interface ReconciliationFailure {
  reason: ReconciliationReason;
  detail: string;
  basisClose: number | null;
}

interface Retirement extends ReconciliationFailure {
  symbol: string;
  proposal: Proposal | null;
  ticksAbove: number;
  ticksBelow: number;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
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

  /** Manual rejection of a proposal — closes it and records why it vanished. */
  dismiss(id: number): boolean {
    for (const t of this.track.values()) {
      if (t.proposal?.id === id) {
        this.ledger.closeSignal(id, Date.now(), t.proposal.basisNow);
        this.ledger.logEvent('strategy_signal', t.proposal.symbol, {
          action: 'dismissed_by_user',
          id,
          basisAtDismiss: t.proposal.basisNow,
        });
        t.proposal = null;
        t.ticksAbove = 0;
        t.ticksBelow = 0;
        return true;
      }
    }
    return false;
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

  /**
   * Scanner eligibility is deliberately recomputed from each complete tick.
   * MarketEngine nulls price/basis fields once either leg is stale, so missing
   * or non-finite evidence must invalidate an existing proposal immediately.
   */
  private reconciliationFailure(row: SymbolRow): ReconciliationFailure | null {
    if (!positive(row.spot) || !positive(row.perpMark) || !finite(row.basisPct)) {
      return {
        reason: 'evidence_stale',
        detail: 'fresh spot/perpetual basis evidence is unavailable',
        basisClose: null,
      };
    }

    if (
      !finite(row.quoteVolume24h) ||
      row.quoteVolume24h < 0 ||
      row.quoteVolume24h < this.cfg.minQuoteVolume24h
    ) {
      return {
        reason: 'symbol_ineligible',
        detail: finite(row.quoteVolume24h)
          ? `24h spot quote volume ${row.quoteVolume24h} is below ${this.cfg.minQuoteVolume24h}`
          : '24h spot quote volume is unavailable',
        basisClose: row.basisPct,
      };
    }

    return null;
  }

  /**
   * Remove approvability before touching persistence. If SQLite is degraded,
   * stale evidence still cannot leave a proposal available through the API.
   */
  private retireTrackedSymbols(retirements: Retirement[], now: number): void {
    let firstError: unknown = null;
    for (const retirement of retirements) {
      const { proposal } = retirement;
      if (proposal) {
        const basisClose = finite(retirement.basisClose) ? retirement.basisClose : proposal.basisNow;
        try {
          this.ledger.closeSignal(proposal.id, now, basisClose);
          this.ledger.logEvent('strategy_signal', retirement.symbol, {
            action: 'closed',
            reason: retirement.reason,
            closureReason: retirement.reason,
            detail: retirement.detail,
            id: proposal.id,
            basisClose,
            basisPeak: proposal.basisPeak,
          });
        } catch (error) {
          firstError ??= error;
        }
        continue;
      }

      if (retirement.ticksAbove > 0 || retirement.ticksBelow > 0) {
        try {
          this.ledger.logEvent('strategy_signal', retirement.symbol, {
            action: 'watch_reset',
            reason: retirement.reason,
            closureReason: retirement.reason,
            detail: retirement.detail,
            ticksAbove: retirement.ticksAbove,
            ticksBelow: retirement.ticksBelow,
          });
        } catch (error) {
          firstError ??= error;
        }
      }
    }
    if (firstError) throw firstError;
  }

  tick(rows: SymbolRow[]): void {
    const now = Date.now();
    this.lastTickTs = now;
    const threshold = this.grossThresholdPct;

    const seen = new Set<string>();
    const eligible = new Map<string, SymbolRow>();
    const failures = new Map<string, ReconciliationFailure>();
    for (const row of rows) {
      if (typeof row.symbol !== 'string' || !/^[A-Z0-9]{4,20}$/.test(row.symbol)) continue;
      seen.add(row.symbol);
      const failure = this.reconciliationFailure(row);
      if (failure) {
        failures.set(row.symbol, failure);
        eligible.delete(row.symbol);
      } else {
        failures.delete(row.symbol);
        eligible.set(row.symbol, row);
      }
    }

    // Reconcile before scanning new evidence. Deleting the map entries first is
    // intentional: even if the audit write fails, stale proposals are no longer
    // returned by proposals() and cannot reach the approval endpoint.
    const retirements: Retirement[] = [];
    for (const [symbol, state] of this.track) {
      const failure = !seen.has(symbol)
        ? {
            reason: 'symbol_removed' as const,
            detail: 'symbol is absent from the current scanner universe',
            basisClose: null,
          }
        : failures.get(symbol);
      if (!failure) continue;
      retirements.push({
        symbol,
        proposal: state.proposal,
        ticksAbove: state.ticksAbove,
        ticksBelow: state.ticksBelow,
        ...failure,
      });
      state.proposal = null;
      state.ticksAbove = 0;
      state.ticksBelow = 0;
      this.track.delete(symbol);
    }
    this.retireTrackedSymbols(retirements, now);

    for (const row of eligible.values()) {
      // reconciliationFailure() proves this is a finite basis value.
      const basisPct = row.basisPct as number;

      let t = this.track.get(row.symbol);
      if (!t) {
        t = { ticksAbove: 0, ticksBelow: 0, proposal: null };
        this.track.set(row.symbol, t);
      }

      const gross = Math.abs(basisPct);

      if (t.proposal) {
        const p = t.proposal;
        p.basisNow = basisPct;
        p.netEdgePct = gross - this.cfg.feesPct;
        p.spotPrice = row.spot;
        p.perpMark = row.perpMark;
        p.fundingRate = row.fundingRate;
        p.confidence = this.confidence(row, now - p.openedTs);
        if (Math.abs(basisPct) > Math.abs(p.basisPeak)) {
          p.basisPeak = basisPct;
          this.ledger.updateSignalPeak(p.id, basisPct);
        }
        if (gross < this.cfg.feesPct) {
          t.ticksBelow++;
          if (t.ticksBelow >= this.cfg.persistTicks) {
            this.ledger.closeSignal(p.id, now, basisPct);
            this.ledger.logEvent('strategy_signal', row.symbol, {
              action: 'closed',
              reason: 'gap_closed',
              closureReason: 'gap_closed',
              id: p.id,
              basisClose: basisPct,
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
          const side = basisPct > 0 ? 'SHORT_PERP_LONG_SPOT' : 'LONG_PERP_SHORT_SPOT';
          const id = this.ledger.openSignal({
            symbol: row.symbol,
            side,
            openedTs: now,
            basisOpen: basisPct,
            fundingOpen: row.fundingRate,
          });
          t.proposal = {
            id,
            symbol: row.symbol,
            side,
            openedTs: now,
            basisOpen: basisPct,
            basisNow: basisPct,
            basisPeak: basisPct,
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
            basisOpen: basisPct,
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

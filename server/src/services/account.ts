import type { BinanceClient, ApiRestrictions } from '../binance/client.js';
import type { Ledger, FillRow } from '../ledger.js';
import type { BalanceEntry, PositionEntry } from '../types.js';

const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;

function utcDayStart(ts = Date.now()): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export class AccountService {
  connected = false;
  lastSyncTs: number | null = null;
  lastError: string | null = null;
  canWithdraw: boolean | null = null; // KEY-level withdraw permission (see sync)
  canTrade: boolean | null = null;
  keyRestrictions: ApiRestrictions | null = null; // authoritative per-key permissions
  private balances = new Map<string, { free: number; locked: number }>();
  private lastSnapshotTs = 0;
  private pnlCacheDirty = true;
  private pnlCache: {
    realizedByDay: Map<string, number>;
    realizedBySymbol: Map<string, number>;
    feesByAsset: Map<string, number>;
    avgCost: Map<string, { qty: number; avgCost: number }>;
  } = { realizedByDay: new Map(), realizedBySymbol: new Map(), feesByAsset: new Map(), avgCost: new Map() };

  constructor(
    private readonly client: BinanceClient | null,
    private readonly ledger: Ledger,
    private readonly priceOf: (symbol: string) => number | null
  ) {}

  get keysPresent(): boolean {
    return this.client !== null;
  }

  async sync(): Promise<void> {
    if (!this.client) return;
    try {
      const acct = await this.client.account();
      this.balances.clear();
      for (const b of acct.balances) {
        const free = Number(b.free);
        const locked = Number(b.locked);
        if (free > 0 || locked > 0) this.balances.set(b.asset, { free, locked });
      }
      this.canTrade = acct.canTrade;
      // /api/v3/account.canWithdraw is ACCOUNT-level and stays true for a
      // read-only key. Prefer the KEY-level flag from apiRestrictions so the UI
      // never falsely warns that a read-only key "can withdraw". Fetched
      // best-effort — a failure here must not break the balance sync.
      try {
        this.keyRestrictions = await this.client.apiRestrictions();
        this.canWithdraw = this.keyRestrictions.enableWithdrawals;
      } catch {
        this.keyRestrictions = null;
        this.canWithdraw = acct.canWithdraw; // fallback: account-level flag
      }
      const wasConnected = this.connected;
      this.connected = true;
      this.lastSyncTs = Date.now();
      this.lastError = null;
      if (!wasConnected) {
        this.ledger.logEvent('binance.connected', null, {
          assets: this.balances.size,
          canTrade: acct.canTrade,
          canWithdraw: this.canWithdraw,
        });
        if (this.canWithdraw) {
          this.ledger.logEvent('error_event', null, {
            severity: 'warning',
            message:
              'API key has WITHDRAWAL permission enabled. This app never withdraws, but the key should not have that power. Recreate the key with withdrawals disabled.',
          });
        }
      }
      this.maybeSnapshot();
    } catch (err) {
      const msg = (err as Error).message;
      if (this.connected || this.lastError !== msg) {
        this.ledger.logEvent('error_event', null, { source: 'account.sync', message: msg });
      }
      this.connected = false;
      this.lastError = msg;
    }
  }

  /** Balance updates pushed by the user data stream. */
  applyStreamBalances(list: { a: string; f: string; l: string }[]): void {
    for (const b of list) {
      const free = Number(b.f);
      const locked = Number(b.l);
      if (free > 0 || locked > 0) this.balances.set(b.a, { free, locked });
      else this.balances.delete(b.a);
    }
    this.lastSyncTs = Date.now();
  }

  recordFill(fill: FillRow): void {
    const isNew = this.ledger.insertFill(fill);
    if (isNew) {
      this.pnlCacheDirty = true;
      this.ledger.logEvent('fill_event', fill.symbol, {
        tradeId: fill.tradeId,
        orderId: fill.orderId,
        side: fill.side,
        price: fill.price,
        qty: fill.qty,
        quoteQty: fill.quoteQty,
        source: fill.source,
      });
    }
  }

  equity(): { totalUsdt: number; availableUsdt: number; entries: BalanceEntry[] } {
    const entries: BalanceEntry[] = [];
    let total = 0;
    for (const [asset, b] of this.balances) {
      const qty = b.free + b.locked;
      const price = asset === 'USDT' ? 1 : this.priceOf(`${asset}USDT`);
      const value = price !== null ? qty * price : 0;
      total += value;
      entries.push({ asset, free: b.free, locked: b.locked, priceUsdt: price, valueUsdt: value });
    }
    entries.sort((a, b) => b.valueUsdt - a.valueUsdt);
    return { totalUsdt: total, availableUsdt: this.balances.get('USDT')?.free ?? 0, entries };
  }

  /**
   * Spot "positions" = non-USDT holdings. Average cost and unrealized PnL are
   * only known for assets whose fills are in the ledger — otherwise null,
   * shown honestly as unknown in the UI.
   */
  positions(): PositionEntry[] {
    const { avgCost } = this.pnl();
    return this.equity()
      .entries.filter((e) => e.asset !== 'USDT' && e.valueUsdt > 0.01)
      .map((e) => {
        const base = e.asset;
        const cost = avgCost.get(base);
        const hasCost = cost !== undefined && cost.qty > 0 && e.priceUsdt !== null;
        return {
          ...e,
          avgCost: hasCost ? cost.avgCost : null,
          unrealizedUsd: hasCost ? (e.priceUsdt! - cost.avgCost) * Math.min(cost.qty, e.free + e.locked) : null,
        };
      });
  }

  /** Realized PnL per UTC day / per symbol + fees + avg cost, from ledgered fills. */
  pnl(): {
    realizedByDay: Map<string, number>;
    realizedBySymbol: Map<string, number>;
    feesByAsset: Map<string, number>;
    avgCost: Map<string, { qty: number; avgCost: number }>;
  } {
    if (!this.pnlCacheDirty) return this.pnlCache;
    const realizedByDay = new Map<string, number>();
    const realizedBySymbol = new Map<string, number>();
    const feesByAsset = new Map<string, number>();
    const avgCost = new Map<string, { qty: number; avgCost: number }>();
    for (const f of this.ledger.allFillsAsc()) {
      const base = f.symbol.replace(/USDT$/, '');
      const pos = avgCost.get(base) ?? { qty: 0, avgCost: 0 };
      if (f.commission > 0 && f.commissionAsset) {
        feesByAsset.set(f.commissionAsset, (feesByAsset.get(f.commissionAsset) ?? 0) + f.commission);
      }
      if (f.side === 'BUY') {
        const newQty = pos.qty + f.qty;
        pos.avgCost = newQty > 0 ? (pos.avgCost * pos.qty + f.price * f.qty) / newQty : 0;
        pos.qty = newQty;
      } else {
        const matched = Math.min(f.qty, pos.qty);
        if (matched > 0) {
          const day = new Date(f.ts).toISOString().slice(0, 10);
          const gain = (f.price - pos.avgCost) * matched;
          realizedByDay.set(day, (realizedByDay.get(day) ?? 0) + gain);
          realizedBySymbol.set(f.symbol, (realizedBySymbol.get(f.symbol) ?? 0) + gain);
        }
        pos.qty = Math.max(0, pos.qty - f.qty);
      }
      avgCost.set(base, pos);
    }
    this.pnlCache = { realizedByDay, realizedBySymbol, feesByAsset, avgCost };
    this.pnlCacheDirty = false;
    return this.pnlCache;
  }

  realizedTodayUsd(): number {
    const day = new Date().toISOString().slice(0, 10);
    return this.pnl().realizedByDay.get(day) ?? 0;
  }

  /** Equity at the first snapshot of the current UTC day (for the day-change card). */
  dayOpenEquity(): number | null {
    const ev = this.ledger.firstEventSince(utcDayStart(), 'account_snapshot');
    const data = ev?.data as { totalUsdt?: number } | null;
    return data?.totalUsdt ?? null;
  }

  private maybeSnapshot(): void {
    const now = Date.now();
    const needDaily = this.ledger.firstEventSince(utcDayStart(), 'account_snapshot') === null;
    if (!needDaily && now - this.lastSnapshotTs < SNAPSHOT_INTERVAL_MS) return;
    const eq = this.equity();
    this.ledger.logEvent('account_snapshot', null, {
      totalUsdt: eq.totalUsdt,
      availableUsdt: eq.availableUsdt,
      assets: eq.entries.length,
    });
    this.lastSnapshotTs = now;
  }
}

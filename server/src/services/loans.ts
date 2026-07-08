import { BinanceApiError, type BinanceClient } from '../binance/client.js';
import type { Ledger } from '../ledger.js';
import type { AppConfig } from '../types.js';

export interface LoanableAsset {
  loanCoin: string;
  hourlyRatePct: number;
  yearlyRatePct: number;
  minLimit: number;
  maxLimit: number;
}

export interface CollateralAsset {
  collateralCoin: string;
  initialLTV: number;
  marginCallLTV: number;
  liquidationLTV: number;
  maxLimit: number;
}

export interface OngoingLoan {
  loanCoin: string;
  collateralCoin: string;
  totalDebt: number;
  collateralAmount: number;
  currentLTV: number;
}

export interface LoanActivity {
  ts: number;
  kind: 'flex_borrow' | 'flex_repay' | 'ltv_adjust' | 'margin_borrow' | 'margin_repay' | 'margin_interest';
  loanCoin: string;
  collateralCoin: string | null;
  amount: number;
  collateralAmount: number | null;
  status: string | null;
  detail: string | null;
}

export interface MarginAssetRow {
  asset: string;
  free: number;
  locked: number;
  borrowed: number;
  interest: number;
  netAsset: number;
}

export interface MarginSnapshot {
  available: boolean;
  error: string | null;
  fetchedAt: number | null;
  borrowEnabled: boolean;
  marginLevel: number | null;
  totalAssetBtc: number;
  totalLiabilityBtc: number;
  totalNetAssetBtc: number;
  assets: MarginAssetRow[];
  interestHistory: { asset: string; interest: number; rate: number; ts: number }[];
  borrowRecords: { asset: string; amount: number; ts: number; status: string }[];
  repayRecords: { asset: string; amount: number; ts: number; status: string }[];
}

export interface LoansSnapshot {
  available: boolean;
  error: string | null;
  fetchedAt: number | null;
  ongoing: OngoingLoan[];
  loanable: LoanableAsset[];
  collateral: CollateralAsset[];
  activity: LoanActivity[];
  margin: MarginSnapshot;
}

const EMPTY_MARGIN: MarginSnapshot = {
  available: false,
  error: null,
  fetchedAt: null,
  borrowEnabled: false,
  marginLevel: null,
  totalAssetBtc: 0,
  totalLiabilityBtc: 0,
  totalNetAssetBtc: 0,
  assets: [],
  interestHistory: [],
  borrowRecords: [],
  repayRecords: [],
};

const CACHE_MS = 60_000;

/**
 * Binance Flexible Loans (crypto loans v2). Read views cached 60s; borrow and
 * repay are money-state-changing actions and pass the same discipline as
 * trading: kill switch off, live trading armed, typed confirmation, ledgered.
 * There is deliberately no collateral-withdrawal or transfer code here.
 */
export class LoanService {
  private cache: LoansSnapshot = {
    available: false,
    error: null,
    fetchedAt: null,
    ongoing: [],
    loanable: [],
    collateral: [],
    activity: [],
    margin: { ...EMPTY_MARGIN },
  };
  private lastFetch = 0;
  private marginCache: MarginSnapshot = { ...EMPTY_MARGIN };
  private lastMarginFetch = 0;

  constructor(
    private readonly client: BinanceClient | null,
    private readonly cfg: AppConfig,
    private readonly ledger: Ledger
  ) {}

  /** Cross-margin visibility: account, liabilities, interest, borrow/repay records. */
  async marginSnapshot(force = false): Promise<MarginSnapshot> {
    if (!this.client) {
      return { ...EMPTY_MARGIN, error: 'Binance keys not configured' };
    }
    if (!force && Date.now() - this.lastMarginFetch < CACHE_MS) return this.marginCache;
    this.lastMarginFetch = Date.now();
    try {
      const [acct, interest, borrows, repays] = await Promise.all([
        this.client.marginAccount(),
        this.client.marginInterestHistory().catch(() => ({ rows: [] })),
        this.client.borrowRepayRecords('BORROW').catch(() => ({ rows: [] })),
        this.client.borrowRepayRecords('REPAY').catch(() => ({ rows: [] })),
      ]);
      this.marginCache = {
        available: true,
        error: null,
        fetchedAt: Date.now(),
        borrowEnabled: acct.borrowEnabled,
        marginLevel: Number(acct.marginLevel) || null,
        totalAssetBtc: Number(acct.totalAssetOfBtc),
        totalLiabilityBtc: Number(acct.totalLiabilityOfBtc),
        totalNetAssetBtc: Number(acct.totalNetAssetOfBtc),
        assets: acct.userAssets
          .map((a) => ({
            asset: a.asset,
            free: Number(a.free),
            locked: Number(a.locked),
            borrowed: Number(a.borrowed),
            interest: Number(a.interest),
            netAsset: Number(a.netAsset),
          }))
          .filter((a) => a.free > 0 || a.locked > 0 || a.borrowed > 0 || a.netAsset !== 0),
        interestHistory: (interest.rows ?? []).map((r) => ({
          asset: r.asset,
          interest: Number(r.interest),
          rate: Number(r.interestRate),
          ts: r.interestAccuredTime,
        })),
        borrowRecords: (borrows.rows ?? []).map((r) => ({ asset: r.asset, amount: Number(r.amount), ts: r.timestamp, status: r.status })),
        repayRecords: (repays.rows ?? []).map((r) => ({ asset: r.asset, amount: Number(r.amount), ts: r.timestamp, status: r.status })),
      };
    } catch (err) {
      const msg = err instanceof BinanceApiError ? `Binance ${err.binanceCode}: ${err.message}` : String(err);
      this.marginCache = { ...EMPTY_MARGIN, error: msg };
      this.ledger.logEvent('error_event', null, { source: 'loans.margin', message: msg });
    }
    return this.marginCache;
  }

  async maxBorrowable(asset: string): Promise<{ ok: boolean; amount?: number; borrowLimit?: number; error?: string }> {
    if (!this.client) return { ok: false, error: 'Binance keys not configured' };
    try {
      const r = await this.client.maxBorrowable(asset);
      return { ok: true, amount: Number(r.amount), borrowLimit: Number(r.borrowLimit) };
    } catch (err) {
      const msg = err instanceof BinanceApiError ? `Binance ${err.binanceCode}: ${err.message}` : String(err);
      return { ok: false, error: msg };
    }
  }

  async snapshot(force = false): Promise<LoansSnapshot> {
    if (!this.client) {
      return { ...this.cache, available: false, error: 'Binance keys not configured', margin: await this.marginSnapshot(force) };
    }
    const margin = await this.marginSnapshot(force);
    if (!force && Date.now() - this.lastFetch < CACHE_MS) return { ...this.cache, margin };
    this.lastFetch = Date.now();
    try {
      const [loanableRes, collateralRes, ongoingRes, flexBorrows, flexRepays, flexLtv] = await Promise.all([
        this.client.loanableData(),
        this.client.collateralData(),
        this.client.ongoingLoans(),
        this.client.flexibleBorrowHistory().catch(() => ({ rows: [] })),
        this.client.flexibleRepayHistory().catch(() => ({ rows: [] })),
        this.client.flexibleLtvAdjustmentHistory().catch(() => ({ rows: [] })),
      ]);
      const activity = this.buildActivity(margin, flexBorrows.rows ?? [], flexRepays.rows ?? [], flexLtv.rows ?? []);
      this.cache = {
        available: true,
        error: null,
        fetchedAt: Date.now(),
        margin,
        loanable: (loanableRes.rows ?? [])
          .map((r) => {
            // v2 loanable/data returns ONE annual rate: flexibleInterestRate
            // (fraction, e.g. 0.0381 = 3.81% APR). Hourly = APR / 8760,
            // Binance's own display convention for flexible loans.
            const annualPct = Number(r.flexibleInterestRate ?? r.flexibleYearlyInterestRate ?? 0) * 100;
            return {
              loanCoin: r.loanCoin,
              hourlyRatePct: annualPct / 8760,
              yearlyRatePct: annualPct,
              minLimit: Number(r.flexibleMinLimit ?? r.minLimit ?? 0),
              maxLimit: Number(r.flexibleMaxLimit ?? r.maxLimit ?? 0),
            };
          })
          .sort((a, b) => a.loanCoin.localeCompare(b.loanCoin)),
        collateral: (collateralRes.rows ?? []).map((r) => ({
          collateralCoin: r.collateralCoin,
          initialLTV: Number(r.initialLTV ?? 0),
          marginCallLTV: Number(r.marginCallLTV ?? 0),
          liquidationLTV: Number(r.liquidationLTV ?? 0),
          maxLimit: Number(r.maxLimit ?? 0),
        })),
        ongoing: (ongoingRes.rows ?? []).map((r) => ({
          loanCoin: r.loanCoin,
          collateralCoin: r.collateralCoin,
          totalDebt: Number(r.totalDebt ?? 0),
          collateralAmount: Number(r.collateralAmount ?? 0),
          currentLTV: Number(r.currentLTV ?? 0),
        })),
        activity,
      };
    } catch (err) {
      const msg = err instanceof BinanceApiError ? `Binance ${err.binanceCode}: ${err.message}` : String(err);
      this.cache = { ...this.cache, available: false, error: msg, margin };
      this.ledger.logEvent('error_event', null, { source: 'loans.snapshot', message: msg });
    }
    return { ...this.cache, margin };
  }

  private baseGate(): string | null {
    if (!this.client) return 'Binance keys not configured';
    if (this.cfg.killSwitch) return 'kill switch is ON — everything halted';
    if (!this.cfg.liveTradingEnabled) return 'live trading is not armed (Risk page)';
    return null;
  }

  private buildActivity(
    margin: MarginSnapshot,
    flexBorrows: Record<string, string | number>[],
    flexRepays: Record<string, string | number>[],
    flexLtv: Record<string, string | number>[]
  ): LoanActivity[] {
    const n = (v: unknown) => {
      const x = Number(v ?? 0);
      return Number.isFinite(x) ? x : 0;
    };
    const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
    const ev: LoanActivity[] = [];
    for (const r of flexBorrows) {
      ev.push({
        ts: n(r.borrowTime),
        kind: 'flex_borrow',
        loanCoin: s(r.loanCoin),
        collateralCoin: s(r.collateralCoin) || null,
        amount: n(r.initialLoanAmount),
        collateralAmount: n(r.initialCollateralAmount),
        status: s(r.status) || null,
        detail: 'Flexible loan borrow',
      });
    }
    for (const r of flexRepays) {
      ev.push({
        ts: n(r.repayTime),
        kind: 'flex_repay',
        loanCoin: s(r.loanCoin),
        collateralCoin: s(r.collateralCoin) || null,
        amount: n(r.repayAmount),
        collateralAmount: null,
        status: s(r.repayStatus) || s(r.status) || null,
        detail: 'Flexible loan repay',
      });
    }
    for (const r of flexLtv) {
      const direction = s(r.direction);
      ev.push({
        ts: n(r.adjustTime),
        kind: 'ltv_adjust',
        loanCoin: s(r.loanCoin),
        collateralCoin: s(r.collateralCoin) || null,
        amount: n(r.collateralAmount),
        collateralAmount: n(r.collateralAmount),
        status: null,
        detail: direction ? `${direction} collateral` : 'LTV adjusted',
      });
    }
    for (const b of margin.borrowRecords) {
      ev.push({
        ts: b.ts,
        kind: 'margin_borrow',
        loanCoin: b.asset,
        collateralCoin: null,
        amount: b.amount,
        collateralAmount: null,
        status: b.status,
        detail: 'Cross margin borrow',
      });
    }
    for (const r of margin.repayRecords) {
      ev.push({
        ts: r.ts,
        kind: 'margin_repay',
        loanCoin: r.asset,
        collateralCoin: null,
        amount: r.amount,
        collateralAmount: null,
        status: r.status,
        detail: 'Cross margin repay',
      });
    }
    for (const i of margin.interestHistory) {
      ev.push({
        ts: i.ts,
        kind: 'margin_interest',
        loanCoin: i.asset,
        collateralCoin: null,
        amount: i.interest,
        collateralAmount: null,
        status: null,
        detail: 'Cross margin interest',
      });
    }
    return ev.filter((x) => x.ts > 0 && x.loanCoin).sort((a, b) => b.ts - a.ts).slice(0, 24);
  }

  private async borrowGuard(loanCoin: string, collateralCoin: string): Promise<string | null> {
    const blocked = this.baseGate();
    if (blocked) return blocked;
    const guard = this.cfg.borrowGuard;
    if (!guard?.enabled) return null;
    if (guard.newBorrowPaused) return 'borrow guard: new borrowing is paused';
    if (guard.repayOnly) return 'borrow guard: repay-only mode is active';
    if (guard.allowedCollateralCoins.length > 0 && !guard.allowedCollateralCoins.includes(collateralCoin)) {
      return `borrow guard: ${collateralCoin} collateral is not allowed`;
    }
    if (guard.blockedLoanCoins.includes(loanCoin)) {
      return `borrow guard: ${loanCoin} is blocked`;
    }
    const snap = await this.snapshot(true);
    if (guard.requireLiveCatalog && !snap.available) {
      return `borrow guard: live loan catalog unavailable${snap.error ? ` (${snap.error})` : ''}`;
    }
    const hot = snap.ongoing.find((o) => o.currentLTV * 100 >= guard.maxLtvPct);
    if (hot) {
      return `borrow guard: ${hot.loanCoin}/${hot.collateralCoin} LTV ${Math.round(hot.currentLTV * 10000) / 100}% >= ${guard.maxLtvPct}%`;
    }
    const row = snap.loanable.find((r) => r.loanCoin === loanCoin);
    if (row && row.yearlyRatePct > guard.maxAprPct) {
      return `borrow guard: ${loanCoin} APR ${row.yearlyRatePct.toFixed(2)}% > ${guard.maxAprPct}%`;
    }
    return null;
  }

  async borrow(
    loanCoin: string,
    collateralCoin: string,
    loanAmount: number,
    confirmCoin: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (confirmCoin !== loanCoin) {
      this.ledger.logEvent('manual_action', null, {
        action: 'loan_borrow',
        result: 'rejected',
        error: 'typed confirmation did not match loan coin',
      });
      return { ok: false, error: 'Typed confirmation does not match the loan coin.' };
    }
    const blocked = await this.borrowGuard(loanCoin, collateralCoin);
    this.ledger.logEvent('risk_decision', null, {
      stage: 'loan_borrow',
      allowed: !blocked,
      reasons: blocked ? [blocked] : [],
      loanCoin,
      collateralCoin,
      loanAmount,
    });
    if (blocked) return { ok: false, error: blocked };
    this.ledger.logEvent('loan_request', null, { action: 'borrow', loanCoin, collateralCoin, loanAmount });
    try {
      const res = await this.client!.flexibleBorrow(loanCoin, collateralCoin, loanAmount);
      this.ledger.logEvent('loan_response', null, { action: 'borrow', res });
      this.lastFetch = 0;
      return { ok: true };
    } catch (err) {
      const msg = err instanceof BinanceApiError ? `Binance ${err.binanceCode}: ${err.message}` : String(err);
      this.ledger.logEvent('error_event', null, { source: 'loans.borrow', message: msg });
      return { ok: false, error: msg };
    }
  }

  /** Collateral add/remove — risk-adjusting, kill-switch gated, ledgered. */
  async adjustLtv(
    loanCoin: string,
    collateralCoin: string,
    amount: number,
    direction: 'ADDITIONAL' | 'REDUCED'
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.client) return { ok: false, error: 'Binance keys not configured' };
    if (this.cfg.killSwitch) return { ok: false, error: 'kill switch is ON' };
    this.ledger.logEvent('loan_request', null, { action: 'adjust_ltv', loanCoin, collateralCoin, amount, direction });
    try {
      const res = await this.client.flexibleAdjustLtv(loanCoin, collateralCoin, amount, direction);
      this.ledger.logEvent('loan_response', null, { action: 'adjust_ltv', res });
      this.lastFetch = 0;
      return { ok: true };
    } catch (err) {
      const msg = err instanceof BinanceApiError ? `Binance ${err.binanceCode}: ${err.message}` : String(err);
      this.ledger.logEvent('error_event', null, { source: 'loans.adjustLtv', message: msg });
      return { ok: false, error: msg };
    }
  }

  async repay(
    loanCoin: string,
    collateralCoin: string,
    repayAmount: number
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.client) return { ok: false, error: 'Binance keys not configured' };
    if (this.cfg.killSwitch) return { ok: false, error: 'kill switch is ON' };
    this.ledger.logEvent('loan_request', null, { action: 'repay', loanCoin, collateralCoin, repayAmount });
    try {
      const res = await this.client.flexibleRepay(loanCoin, collateralCoin, repayAmount);
      this.ledger.logEvent('loan_response', null, { action: 'repay', res });
      this.lastFetch = 0;
      return { ok: true };
    } catch (err) {
      const msg = err instanceof BinanceApiError ? `Binance ${err.binanceCode}: ${err.message}` : String(err);
      this.ledger.logEvent('error_event', null, { source: 'loans.repay', message: msg });
      return { ok: false, error: msg };
    }
  }
}

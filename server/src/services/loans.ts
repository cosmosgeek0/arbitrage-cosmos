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

export interface LoansSnapshot {
  available: boolean;
  error: string | null;
  fetchedAt: number | null;
  ongoing: OngoingLoan[];
  loanable: LoanableAsset[];
  collateral: CollateralAsset[];
}

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
  };
  private lastFetch = 0;

  constructor(
    private readonly client: BinanceClient | null,
    private readonly cfg: AppConfig,
    private readonly ledger: Ledger
  ) {}

  async snapshot(force = false): Promise<LoansSnapshot> {
    if (!this.client) {
      return { ...this.cache, available: false, error: 'Binance keys not configured' };
    }
    if (!force && Date.now() - this.lastFetch < CACHE_MS) return this.cache;
    this.lastFetch = Date.now();
    try {
      const [loanableRes, collateralRes, ongoingRes] = await Promise.all([
        this.client.loanableData(),
        this.client.collateralData(),
        this.client.ongoingLoans(),
      ]);
      this.cache = {
        available: true,
        error: null,
        fetchedAt: Date.now(),
        loanable: (loanableRes.rows ?? [])
          .map((r) => ({
            loanCoin: r.loanCoin,
            hourlyRatePct: Number(r.flexibleHourlyInterestRate ?? r.hourlyInterestRate ?? 0) * 100,
            yearlyRatePct: Number(r.flexibleYearlyInterestRate ?? r.yearlyInterestRate ?? 0) * 100,
            minLimit: Number(r.flexibleMinLimit ?? r.minLimit ?? 0),
            maxLimit: Number(r.flexibleMaxLimit ?? r.maxLimit ?? 0),
          }))
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
      };
    } catch (err) {
      const msg = err instanceof BinanceApiError ? `Binance ${err.binanceCode}: ${err.message}` : String(err);
      this.cache = { ...this.cache, available: false, error: msg };
      this.ledger.logEvent('error_event', null, { source: 'loans.snapshot', message: msg });
    }
    return this.cache;
  }

  private gate(): string | null {
    if (!this.client) return 'Binance keys not configured';
    if (this.cfg.killSwitch) return 'kill switch is ON — everything halted';
    if (!this.cfg.liveTradingEnabled) return 'live trading is not armed (Risk page)';
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
    const blocked = this.gate();
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

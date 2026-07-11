import { randomUUID } from 'node:crypto';
import { BinanceApiError, type BinanceClient } from '../binance/client.js';
import type { Ledger } from '../ledger.js';
import type { AppConfig } from '../types.js';
import type { AccountService } from './account.js';

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
  stale: boolean;
  error: string | null;
  fetchedAt: number | null;
  attemptedAt: number | null;
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

export interface LoanActionResult {
  ok: boolean;
  error?: string;
  status?: 'succeeded' | 'failed' | 'unknown';
  reconciliationRequired?: boolean;
}

interface LoanRiskSnapshot {
  fetchedAt: number;
  loanable: LoanableAsset[];
  collateral: CollateralAsset[];
  ongoing: OngoingLoan[];
}

const EMPTY_MARGIN: MarginSnapshot = {
  available: false,
  stale: false,
  error: null,
  fetchedAt: null,
  attemptedAt: null,
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
const MAX_CATALOG_ROWS = 2_000;
const ASSET_RE = /^[A-Z0-9]{1,20}$/;
const LTV_PRECISION = 100_000_000;
const MAX_ACCOUNT_SYNC_AGE_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredRows(response: unknown, source: string): Record<string, unknown>[] {
  if (!isRecord(response) || !Array.isArray(response.rows)) {
    throw new Error(`Binance returned malformed ${source}`);
  }
  if (response.rows.length > MAX_CATALOG_ROWS) {
    throw new Error(`Binance ${source} exceeds the ${MAX_CATALOG_ROWS}-row safety cap`);
  }
  if (response.rows.some((row) => !isRecord(row))) {
    throw new Error(`Binance returned malformed ${source} rows`);
  }
  return response.rows as Record<string, unknown>[];
}

function isCanonicalAsset(value: unknown): value is string {
  return typeof value === 'string' && ASSET_RE.test(value);
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof BinanceApiError
    ? `Binance ${error.binanceCode ?? error.httpStatus}: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);
}

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
  private snapshotInFlight: Promise<LoansSnapshot> | null = null;
  private marginSnapshotInFlight: Promise<MarginSnapshot> | null = null;
  private riskSnapshotInFlight: Promise<LoanRiskSnapshot> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();
  private stateVersion = 0;

  constructor(
    private readonly client: BinanceClient | null,
    private readonly cfg: AppConfig,
    private readonly ledger: Ledger,
    private readonly account: AccountService | null = null,
    private readonly priceOf: (symbol: string) => number | null = () => null,
  ) {}

  /** Cross-margin visibility: account, liabilities, interest, borrow/repay records. */
  async marginSnapshot(force = false): Promise<MarginSnapshot> {
    if (!this.client) {
      return { ...EMPTY_MARGIN, error: 'Binance keys not configured' };
    }
    if (!force && Date.now() - this.lastMarginFetch < CACHE_MS) return this.marginCache;
    if (this.marginSnapshotInFlight) return this.marginSnapshotInFlight;

    const sourceVersion = this.stateVersion;
    const load = (async (): Promise<MarginSnapshot> => {
      const attemptedAt = Date.now();
      let succeeded = false;
      try {
        const [acct, interest, borrows, repays] = await Promise.all([
          this.client!.marginAccount(),
          this.client!.marginInterestHistory(),
          this.client!.borrowRepayRecords('BORROW'),
          this.client!.borrowRepayRecords('REPAY'),
        ]);
        if (!isRecord(acct) || typeof acct.borrowEnabled !== 'boolean'
          || !Array.isArray(acct.userAssets) || acct.userAssets.some((row) => !isRecord(row))) {
          throw new Error('Binance returned malformed margin account state');
        }
        if (acct.userAssets.length > MAX_CATALOG_ROWS) {
          throw new Error(`Binance margin account state exceeds the ${MAX_CATALOG_ROWS}-row safety cap`);
        }
        const marginLevel = Number(acct.marginLevel);
        const totalAssetBtc = Number(acct.totalAssetOfBtc);
        const totalLiabilityBtc = Number(acct.totalLiabilityOfBtc);
        const totalNetAssetBtc = Number(acct.totalNetAssetOfBtc);
        if (!Number.isFinite(marginLevel) || marginLevel <= 0
          || !Number.isFinite(totalAssetBtc) || totalAssetBtc < 0
          || !Number.isFinite(totalLiabilityBtc) || totalLiabilityBtc < 0
          || !Number.isFinite(totalNetAssetBtc)) {
          throw new Error('Binance returned malformed margin account totals');
        }

        const userAssets = (acct.userAssets as Record<string, unknown>[]).map((row) => ({
          asset: row.asset,
          free: Number(row.free),
          locked: Number(row.locked),
          borrowed: Number(row.borrowed),
          interest: Number(row.interest),
          netAsset: Number(row.netAsset),
        }));
        if (userAssets.some((row) => !isCanonicalAsset(row.asset)
          || ![row.free, row.locked, row.borrowed, row.interest, row.netAsset].every(Number.isFinite)
          || row.free < 0 || row.locked < 0 || row.borrowed < 0 || row.interest < 0)) {
          throw new Error('Binance returned malformed margin asset state');
        }

        const interestHistory = requiredRows(interest, 'margin interest history').map((row) => ({
          asset: row.asset,
          interest: Number(row.interest),
          rate: Number(row.interestRate),
          ts: Number(row.interestAccuredTime),
        }));
        if (interestHistory.some((row) => !isCanonicalAsset(row.asset)
          || !Number.isFinite(row.interest) || row.interest < 0
          || !Number.isFinite(row.rate) || row.rate < 0
          || !Number.isFinite(row.ts) || row.ts <= 0)) {
          throw new Error('Binance returned malformed margin interest history');
        }

        const parseRecords = (response: unknown, source: string) => {
          const records = requiredRows(response, source).map((row) => ({
            asset: row.asset,
            amount: Number(row.amount),
            ts: Number(row.timestamp),
            status: row.status,
          }));
          if (records.some((row) => !isCanonicalAsset(row.asset)
            || !Number.isFinite(row.amount) || row.amount < 0
            || !Number.isFinite(row.ts) || row.ts <= 0
            || typeof row.status !== 'string' || row.status.length > 64)) {
            throw new Error(`Binance returned malformed ${source}`);
          }
          return records as { asset: string; amount: number; ts: number; status: string }[];
        };

        const fetchedAt = Date.now();
        this.marginCache = {
          available: true,
          stale: false,
          error: null,
          fetchedAt,
          attemptedAt,
          borrowEnabled: acct.borrowEnabled === true,
          marginLevel,
          totalAssetBtc,
          totalLiabilityBtc,
          totalNetAssetBtc,
          assets: userAssets.filter((row) => row.free > 0 || row.locked > 0 || row.borrowed > 0 || row.interest > 0 || row.netAsset !== 0) as MarginAssetRow[],
          interestHistory: interestHistory as { asset: string; interest: number; rate: number; ts: number }[],
          borrowRecords: parseRecords(borrows, 'margin borrow history'),
          repayRecords: parseRecords(repays, 'margin repay history'),
        };
        succeeded = true;
      } catch (err) {
        const msg = errorMessage(err);
        this.marginCache = this.marginCache.fetchedAt === null
          ? { ...EMPTY_MARGIN, error: msg, attemptedAt }
          : {
              ...this.marginCache,
              available: false,
              stale: true,
              error: msg,
              attemptedAt,
            };
        this.safeLog('error_event', null, { source: 'loans.margin', message: msg });
      }
      this.lastMarginFetch = succeeded && sourceVersion === this.stateVersion ? Date.now() : 0;
      return this.marginCache;
    })();
    this.marginSnapshotInFlight = load;
    void load.finally(() => {
      if (this.marginSnapshotInFlight === load) this.marginSnapshotInFlight = null;
    }).catch(() => undefined);
    return load;
  }

  async maxBorrowable(asset: string): Promise<{ ok: boolean; amount?: number; borrowLimit?: number; error?: string }> {
    if (!this.client) return { ok: false, error: 'Binance keys not configured' };
    if (!isCanonicalAsset(asset)) return { ok: false, error: 'asset must be an exact uppercase Binance asset code' };
    try {
      const r = await this.client.maxBorrowable(asset);
      const amount = Number(r.amount);
      const borrowLimit = Number(r.borrowLimit);
      if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(borrowLimit) || borrowLimit < 0) {
        return { ok: false, error: 'Binance returned an invalid max-borrowable response' };
      }
      return { ok: true, amount, borrowLimit };
    } catch (err) {
      const msg = errorMessage(err);
      return { ok: false, error: msg };
    }
  }

  async snapshot(force = false): Promise<LoansSnapshot> {
    if (!this.client) {
      return { ...this.cache, available: false, error: 'Binance keys not configured', margin: await this.marginSnapshot(force) };
    }
    if (!force && Date.now() - this.lastFetch < CACHE_MS) {
      return { ...this.cache, margin: await this.marginSnapshot(false) };
    }
    if (this.snapshotInFlight) return this.snapshotInFlight;

    const sourceVersion = this.stateVersion;
    const load = (async (): Promise<LoansSnapshot> => {
      const margin = await this.marginSnapshot(force);
      let succeeded = false;
      try {
        const [loanableRes, collateralRes, ongoingRes, flexBorrows, flexRepays, flexLtv] = await Promise.all([
          this.client!.loanableData(),
          this.client!.collateralData(),
          this.client!.ongoingLoans(),
          this.client!.flexibleBorrowHistory(),
          this.client!.flexibleRepayHistory(),
          this.client!.flexibleLtvAdjustmentHistory(),
        ]);
        const activity = this.buildActivity(
          margin,
          requiredRows(flexBorrows, 'flexible borrow history') as Record<string, string | number>[],
          requiredRows(flexRepays, 'flexible repay history') as Record<string, string | number>[],
          requiredRows(flexLtv, 'flexible LTV history') as Record<string, string | number>[],
        );
        this.cache = {
          available: true,
          error: null,
          fetchedAt: Date.now(),
          margin,
          loanable: this.parseLoanable(loanableRes),
          collateral: this.parseCollateral(collateralRes),
          ongoing: this.parseOngoing(ongoingRes),
          activity,
        };
        succeeded = true;
      } catch (err) {
        const msg = errorMessage(err);
        this.cache = { ...this.cache, available: false, error: msg, margin };
        this.safeLog('error_event', null, { source: 'loans.snapshot', message: msg });
      }
      this.lastFetch = succeeded && sourceVersion === this.stateVersion ? Date.now() : 0;
      return { ...this.cache, margin };
    })();
    this.snapshotInFlight = load;
    void load.finally(() => {
      if (this.snapshotInFlight === load) this.snapshotInFlight = null;
    }).catch(() => undefined);
    return load;
  }

  private parseLoanable(response: unknown): LoanableAsset[] {
    return requiredRows(response, 'flexible loan catalog').map((row): LoanableAsset => {
      const loanCoin = row.loanCoin;
      // Binance documents flexibleInterestRate as a fractional annual rate.
      // It is deliberately not guessed from magnitude or treated as a percent.
      const annualRate = Number(row.flexibleInterestRate ?? row.flexibleYearlyInterestRate);
      const minLimit = Number(row.flexibleMinLimit ?? row.minLimit);
      const maxLimit = Number(row.flexibleMaxLimit ?? row.maxLimit);
      if (!isCanonicalAsset(loanCoin)
        || !Number.isFinite(annualRate) || annualRate < 0 || annualRate >= 1
        || !Number.isFinite(minLimit) || minLimit <= 0
        || !Number.isFinite(maxLimit) || maxLimit < minLimit) {
        throw new Error('Binance returned a malformed flexible loan catalog row');
      }
      const yearlyRatePct = annualRate * 100;
      return {
        loanCoin,
        hourlyRatePct: yearlyRatePct / 8760,
        yearlyRatePct,
        minLimit,
        maxLimit,
      };
    }).sort((a, b) => a.loanCoin.localeCompare(b.loanCoin));
  }

  private parseCollateral(response: unknown): CollateralAsset[] {
    return requiredRows(response, 'flexible collateral catalog').map((row): CollateralAsset => {
      const collateralCoin = row.collateralCoin;
      // All three Binance LTV fields are documented fractions in [0, 1].
      const initialLTV = Number(row.initialLTV);
      const marginCallLTV = Number(row.marginCallLTV);
      const liquidationLTV = Number(row.liquidationLTV);
      const maxLimit = Number(row.maxLimit);
      if (!isCanonicalAsset(collateralCoin)
        || !Number.isFinite(initialLTV) || initialLTV <= 0 || initialLTV >= 1
        || !Number.isFinite(marginCallLTV) || marginCallLTV <= initialLTV || marginCallLTV >= 1
        || !Number.isFinite(liquidationLTV) || liquidationLTV <= marginCallLTV || liquidationLTV >= 1
        || !Number.isFinite(maxLimit) || maxLimit <= 0) {
        throw new Error('Binance returned a malformed flexible collateral catalog row');
      }
      return { collateralCoin, initialLTV, marginCallLTV, liquidationLTV, maxLimit };
    }).sort((a, b) => a.collateralCoin.localeCompare(b.collateralCoin));
  }

  private parseOngoing(response: unknown): OngoingLoan[] {
    return requiredRows(response, 'ongoing flexible loan state').map((row): OngoingLoan => {
      const loanCoin = row.loanCoin;
      const collateralCoin = row.collateralCoin;
      const totalDebt = Number(row.totalDebt);
      const collateralAmount = Number(row.collateralAmount);
      const currentLTV = Number(row.currentLTV);
      if (!isCanonicalAsset(loanCoin) || !isCanonicalAsset(collateralCoin)
        || !Number.isFinite(totalDebt) || totalDebt <= 0
        || !Number.isFinite(collateralAmount) || collateralAmount <= 0
        || !Number.isFinite(currentLTV) || currentLTV <= 0 || currentLTV >= 1) {
        throw new Error('Binance returned malformed ongoing flexible loan state');
      }
      return { loanCoin, collateralCoin, totalDebt, collateralAmount, currentLTV };
    });
  }

  private async freshRiskSnapshot(): Promise<LoanRiskSnapshot> {
    if (!this.client) throw new Error('Binance keys not configured');
    if (this.riskSnapshotInFlight) return this.riskSnapshotInFlight;
    const load = Promise.all([
      this.client.loanableData(),
      this.client.collateralData(),
      this.client.ongoingLoans(),
    ]).then(([loanable, collateral, ongoing]) => ({
      fetchedAt: Date.now(),
      loanable: this.parseLoanable(loanable),
      collateral: this.parseCollateral(collateral),
      ongoing: this.parseOngoing(ongoing),
    }));
    this.riskSnapshotInFlight = load;
    void load.finally(() => {
      if (this.riskSnapshotInFlight === load) this.riskSnapshotInFlight = null;
    }).catch(() => undefined);
    return load;
  }

  private async baseGate(riskIncreasing = false, actionKey = ''): Promise<string | null> {
    if (!this.client) return 'Binance keys not configured';
    if (this.cfg.killSwitch) return 'kill switch is ON — everything halted';
    if (this.cfg.fundsLocked) return 'funds access is OFF — money actions are blocked';
    if (this.cfg.controlModes?.funds !== 'allowed') return 'funds control mode is not allowed';
    if (!this.cfg.liveTradingEnabled || this.cfg.controlModes?.liveOrders !== 'allowed') {
      return 'live money actions are not armed';
    }
    if (riskIncreasing && this.cfg.controlModes?.borrowing !== 'allowed') {
      return 'borrowing control mode is not allowed';
    }
    const unresolved = this.ledger.unresolvedLoanMutations();
    if (unresolved.some((item) => (riskIncreasing && item.riskIncreasing) || item.actionKey === actionKey)) {
      return 'a prior loan action has an unresolved outcome; reconcile Binance before retrying this action';
    }
    const posture = await this.moneyPostureError();
    if (posture) return posture;
    return null;
  }

  private async moneyPostureError(): Promise<string | null> {
    if (!this.account) return 'signed account posture is unavailable';
    const age = this.account.lastSyncTs === null ? Number.POSITIVE_INFINITY : Date.now() - this.account.lastSyncTs;
    if (!this.account.connected || !Number.isFinite(age) || age < -1_000 || age > MAX_ACCOUNT_SYNC_AGE_MS || !this.account.keyRestrictions) {
      await this.account.sync().catch(() => undefined);
    }
    if (!this.account.connected) return 'signed account connection is unavailable';
    const refreshedAge = this.account.lastSyncTs === null ? Number.POSITIVE_INFINITY : Date.now() - this.account.lastSyncTs;
    if (!Number.isFinite(refreshedAge) || refreshedAge < -1_000 || refreshedAge > MAX_ACCOUNT_SYNC_AGE_MS) {
      return 'signed account state is stale';
    }
    const restrictions = this.account.keyRestrictions;
    if (!restrictions) return 'API-key permissions are unknown';
    if (!restrictions.enableReading || !restrictions.enableSpotAndMarginTrading) return 'API key is not enabled for signed money actions';
    if (restrictions.enableWithdrawals) return 'API key has withdrawals enabled';
    if (restrictions.enableInternalTransfer || restrictions.permitsUniversalTransfer) return 'API key permits asset transfers';
    return null;
  }

  private buildActivity(
    margin: MarginSnapshot,
    flexBorrows: Record<string, string | number>[],
    flexRepays: Record<string, string | number>[],
    flexLtv: Record<string, string | number>[]
  ): LoanActivity[] {
    const number = (value: unknown, source: string, allowZero = true): number => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0)) {
        throw new Error(`Binance returned malformed ${source}`);
      }
      return parsed;
    };
    const asset = (value: unknown, source: string): string => {
      if (!isCanonicalAsset(value)) throw new Error(`Binance returned malformed ${source}`);
      return value;
    };
    const optionalStatus = (value: unknown, source: string): string | null => {
      if (value === undefined || value === null || value === '') return null;
      if (typeof value !== 'string' || value.length > 64) throw new Error(`Binance returned malformed ${source}`);
      return value;
    };
    const ev: LoanActivity[] = [];
    for (const r of flexBorrows) {
      ev.push({
        ts: number(r.borrowTime, 'flexible borrow timestamp', false),
        kind: 'flex_borrow',
        loanCoin: asset(r.loanCoin, 'flexible borrow asset'),
        collateralCoin: asset(r.collateralCoin, 'flexible borrow collateral'),
        amount: number(r.initialLoanAmount, 'flexible borrow amount', false),
        collateralAmount: number(r.initialCollateralAmount, 'flexible borrow collateral amount', false),
        status: optionalStatus(r.status, 'flexible borrow status'),
        detail: 'Flexible loan borrow',
      });
    }
    for (const r of flexRepays) {
      ev.push({
        ts: number(r.repayTime, 'flexible repay timestamp', false),
        kind: 'flex_repay',
        loanCoin: asset(r.loanCoin, 'flexible repay asset'),
        collateralCoin: asset(r.collateralCoin, 'flexible repay collateral'),
        amount: number(r.repayAmount, 'flexible repay amount', false),
        collateralAmount: null,
        status: optionalStatus(r.repayStatus ?? r.status, 'flexible repay status'),
        detail: 'Flexible loan repay',
      });
    }
    for (const r of flexLtv) {
      const direction = optionalStatus(r.direction, 'flexible LTV direction');
      ev.push({
        ts: number(r.adjustTime, 'flexible LTV timestamp', false),
        kind: 'ltv_adjust',
        loanCoin: asset(r.loanCoin, 'flexible LTV loan asset'),
        collateralCoin: asset(r.collateralCoin, 'flexible LTV collateral asset'),
        amount: number(r.collateralAmount, 'flexible LTV collateral amount', false),
        collateralAmount: number(r.collateralAmount, 'flexible LTV collateral amount', false),
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
    return ev.sort((a, b) => b.ts - a.ts).slice(0, 24);
  }

  private validateActionInput(
    loanCoin: unknown,
    collateralCoin: unknown,
    amount: unknown,
  ): string | null {
    if (!isCanonicalAsset(loanCoin) || !isCanonicalAsset(collateralCoin)) {
      return 'loan and collateral assets must be exact uppercase Binance asset codes';
    }
    if (!isFinitePositive(amount)) return 'amount must be a finite positive number';
    return null;
  }

  private configuredMaxLtvPct(): number | null {
    const value = this.cfg.borrowGuard?.maxLtvPct;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100
      ? value
      : null;
  }

  private enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(task, task);
    this.mutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private invalidateCachedState(): void {
    this.stateVersion += 1;
    this.lastFetch = 0;
    this.lastMarginFetch = 0;
  }

  private async borrowGuard(
    loanCoin: string,
    collateralCoin: string,
    loanAmount: number,
    actionKey: string,
  ): Promise<{ error: string | null; initialLtvPct: number | null; fetchedAt: number | null }> {
    const blocked = await this.baseGate(true, actionKey);
    if (blocked) return { error: blocked, initialLtvPct: null, fetchedAt: null };
    if (!isFinitePositive(loanAmount)) {
      return { error: 'borrow guard: loan amount must be finite and positive', initialLtvPct: null, fetchedAt: null };
    }
    const guard = this.cfg.borrowGuard;
    if (!guard?.enabled) return { error: 'borrow guard is disabled; new debt is blocked', initialLtvPct: null, fetchedAt: null };
    if (guard.newBorrowPaused) return { error: 'borrow guard: new borrowing is paused', initialLtvPct: null, fetchedAt: null };
    if (guard.repayOnly) return { error: 'borrow guard: repay-only mode is active', initialLtvPct: null, fetchedAt: null };
    if (!Array.isArray(guard.allowedCollateralCoins) || !Array.isArray(guard.blockedLoanCoins)) {
      return { error: 'borrow guard: asset policy is invalid', initialLtvPct: null, fetchedAt: null };
    }
    if (guard.allowedCollateralCoins.length > 0 && !guard.allowedCollateralCoins.includes(collateralCoin)) {
      return { error: `borrow guard: ${collateralCoin} collateral is not allowed`, initialLtvPct: null, fetchedAt: null };
    }
    if (guard.blockedLoanCoins.includes(loanCoin)) {
      return { error: `borrow guard: ${loanCoin} is blocked`, initialLtvPct: null, fetchedAt: null };
    }
    const maxLtvPct = this.configuredMaxLtvPct();
    if (maxLtvPct === null || !Number.isFinite(guard.maxAprPct) || guard.maxAprPct < 0) {
      return { error: 'borrow guard: numeric policy is invalid', initialLtvPct: null, fetchedAt: null };
    }

    let snap: LoanRiskSnapshot;
    try {
      snap = await this.freshRiskSnapshot();
    } catch (error) {
      return {
        error: `borrow guard: live loan catalog unavailable (${errorMessage(error)})`,
        initialLtvPct: null,
        fetchedAt: null,
      };
    }

    const loanRows = snap.loanable.filter((row) => row.loanCoin === loanCoin);
    const collateralRows = snap.collateral.filter((row) => row.collateralCoin === collateralCoin);
    if (loanRows.length !== 1 || collateralRows.length !== 1) {
      return {
        error: 'borrow guard: exact loan/collateral catalog pair is unavailable or ambiguous',
        initialLtvPct: null,
        fetchedAt: snap.fetchedAt,
      };
    }

    const collateral = collateralRows[0];
    const initialLtvPct = collateral.initialLTV * 100;
    if (!Number.isFinite(initialLtvPct) || initialLtvPct <= 0 || initialLtvPct >= 100) {
      return { error: 'borrow guard: invalid catalog initial LTV unit', initialLtvPct: null, fetchedAt: snap.fetchedAt };
    }
    const safeInitialLtvPct = Math.min(
      maxLtvPct,
      collateral.marginCallLTV * 100 - 1,
      collateral.liquidationLTV * 100 - 2,
    );
    if (!Number.isFinite(safeInitialLtvPct) || safeInitialLtvPct <= 0 || initialLtvPct >= safeInitialLtvPct) {
      return {
        error: `borrow guard: initial LTV ${initialLtvPct.toFixed(2)}% >= safe limit ${Number.isFinite(safeInitialLtvPct) ? safeInitialLtvPct.toFixed(2) : 'unknown'}%`,
        initialLtvPct,
        fetchedAt: snap.fetchedAt,
      };
    }

    for (const position of snap.ongoing) {
      const terms = snap.collateral.filter((item) => item.collateralCoin === position.collateralCoin);
      if (terms.length !== 1) {
        return {
          error: `borrow guard: exchange LTV terms are unavailable or ambiguous for ${position.collateralCoin}`,
          initialLtvPct,
          fetchedAt: snap.fetchedAt,
        };
      }
      const limit = Math.min(
        guard.maxLtvPct,
        terms[0].marginCallLTV * 100 - 1,
        terms[0].liquidationLTV * 100 - 2,
      );
      if (!Number.isFinite(limit) || limit <= 0 || position.currentLTV * 100 >= limit) {
        return {
          error: `borrow guard: ${position.loanCoin}/${position.collateralCoin} LTV ${(position.currentLTV * 100).toFixed(2)}% >= safe limit ${Number.isFinite(limit) ? limit.toFixed(2) : 'unknown'}%`,
          initialLtvPct,
          fetchedAt: snap.fetchedAt,
        };
      }
    }
    const row = loanRows[0];
    if (row.yearlyRatePct > guard.maxAprPct) {
      return {
        error: `borrow guard: ${loanCoin} APR ${row.yearlyRatePct.toFixed(2)}% > ${guard.maxAprPct}%`,
        initialLtvPct,
        fetchedAt: snap.fetchedAt,
      };
    }
    // USDT is the quote unit used by this policy. Other stablecoins can and do
    // depeg, so they require the same live market valuation as every asset.
    const price = loanCoin === 'USDT' ? 1 : this.priceOf(`${loanCoin}USDT`);
    if (!isFinitePositive(price)) {
      return { error: `borrow guard: fresh ${loanCoin}USDT valuation is unavailable`, initialLtvPct, fetchedAt: snap.fetchedAt };
    }
    const notionalUsd = loanAmount * price;
    if (!isFinitePositive(notionalUsd)) {
      return { error: 'borrow guard: loan notional is invalid', initialLtvPct, fetchedAt: snap.fetchedAt };
    }
    if (notionalUsd < row.minLimit || notionalUsd > row.maxLimit) {
      return {
        error: `borrow guard: $${notionalUsd.toFixed(2)} is outside Binance product limits $${row.minLimit.toFixed(2)}-$${row.maxLimit.toFixed(2)}`,
        initialLtvPct,
        fetchedAt: snap.fetchedAt,
      };
    }
    if (!isFinitePositive(guard.maxBorrowNotionalUsd) || notionalUsd > guard.maxBorrowNotionalUsd) {
      return {
        error: `borrow guard: $${notionalUsd.toFixed(2)} exceeds app loan cap $${Number(guard.maxBorrowNotionalUsd).toFixed(2)}`,
        initialLtvPct,
        fetchedAt: snap.fetchedAt,
      };
    }
    return { error: null, initialLtvPct, fetchedAt: snap.fetchedAt };
  }

  private async reductionGuard(
    loanCoin: string,
    collateralCoin: string,
    amount: number,
  ): Promise<{
    error: string | null;
    currentLtvPct: number | null;
    projectedLtvPct: number | null;
    fetchedAt: number | null;
  }> {
    const guard = this.cfg.borrowGuard;
    if (!guard?.enabled) return { error: 'collateral guard is disabled; collateral reduction is blocked', currentLtvPct: null, projectedLtvPct: null, fetchedAt: null };
    const maxLtvPct = this.configuredMaxLtvPct();
    if (maxLtvPct === null) {
      return { error: 'collateral guard: maximum LTV policy is invalid', currentLtvPct: null, projectedLtvPct: null, fetchedAt: null };
    }

    let snap: LoanRiskSnapshot;
    try {
      snap = await this.freshRiskSnapshot();
    } catch (error) {
      return {
        error: `collateral guard: live loan state unavailable (${errorMessage(error)})`,
        currentLtvPct: null,
        projectedLtvPct: null,
        fetchedAt: null,
      };
    }
    const positions = snap.ongoing.filter((row) => row.loanCoin === loanCoin && row.collateralCoin === collateralCoin);
    const collateralRows = snap.collateral.filter((row) => row.collateralCoin === collateralCoin);
    if (positions.length !== 1 || collateralRows.length !== 1) {
      return {
        error: 'collateral guard: exact live loan state is unavailable or ambiguous',
        currentLtvPct: null,
        projectedLtvPct: null,
        fetchedAt: snap.fetchedAt,
      };
    }
    const position = positions[0];
    const collateral = collateralRows[0];
    const effectiveMaxLtvPct = Math.min(
      maxLtvPct,
      collateral.marginCallLTV * 100 - 1,
      collateral.liquidationLTV * 100 - 2,
    );
    if (!Number.isFinite(effectiveMaxLtvPct) || effectiveMaxLtvPct <= 0) {
      return {
        error: 'collateral guard: exchange LTV thresholds are invalid',
        currentLtvPct: position.currentLTV * 100,
        projectedLtvPct: null,
        fetchedAt: snap.fetchedAt,
      };
    }
    const remainingCollateral = position.collateralAmount - amount;
    // Derive the current debt/collateral unit-value ratio from Binance's fresh
    // pair state. If any unit input is absent or inconsistent, do not guess.
    const unitValueRatio = position.currentLTV * position.collateralAmount / position.totalDebt;
    if (!Number.isFinite(remainingCollateral) || remainingCollateral <= 0
      || !Number.isFinite(unitValueRatio) || unitValueRatio <= 0) {
      return {
        error: 'collateral guard: reduction amount or price/unit state is invalid',
        currentLtvPct: position.currentLTV * 100,
        projectedLtvPct: null,
        fetchedAt: snap.fetchedAt,
      };
    }
    const rawProjectedLtv = position.totalDebt * unitValueRatio / remainingCollateral;
    // Round upward at eight decimal places so floating-point error never makes
    // a borderline reduction look safer than the source state supports.
    const projectedLtv = Math.ceil(rawProjectedLtv * LTV_PRECISION) / LTV_PRECISION;
    const projectedLtvPct = projectedLtv * 100;
    if (!Number.isFinite(projectedLtvPct) || projectedLtvPct >= effectiveMaxLtvPct) {
      return {
        error: `collateral guard: projected LTV ${Number.isFinite(projectedLtvPct) ? `${projectedLtvPct.toFixed(2)}%` : 'unknown'} >= safe limit ${effectiveMaxLtvPct.toFixed(2)}%`,
        currentLtvPct: position.currentLTV * 100,
        projectedLtvPct: Number.isFinite(projectedLtvPct) ? projectedLtvPct : null,
        fetchedAt: snap.fetchedAt,
      };
    }
    return {
      error: null,
      currentLtvPct: position.currentLTV * 100,
      projectedLtvPct,
      fetchedAt: snap.fetchedAt,
    };
  }

  private safeLog(kind: string, symbol: string | null, data: unknown): void {
    try {
      this.ledger.logEvent(kind, symbol, data);
    } catch {
      // Background cache refresh remains available while observability storage is degraded.
    }
  }

  private commitLoanResponse(data: Record<string, unknown>): boolean {
    try {
      this.ledger.logEvent('loan_response', null, data);
      return true;
    } catch {
      return false;
    }
  }

  private classifySignedResponse(action: string, mutationId: string, response: unknown): LoanActionResult {
    const record = isRecord(response) ? response : {};
    const rawStatus = record.repayStatus ?? record.status;
    const normalized = typeof rawStatus === 'string' ? rawStatus.trim().toUpperCase() : '';
    if (['SUCCEEDS', 'SUCCEEDED', 'SUCCESS', 'SUCCESSFUL', 'REPAID'].includes(normalized)) {
      this.invalidateCachedState();
      if (!this.commitLoanResponse({ action, mutationId, outcome: 'succeeded', response })) {
        return { ok: false, status: 'unknown', reconciliationRequired: true, error: `${action} succeeded at Binance but its audit response could not be committed` };
      }
      return { ok: true, status: 'succeeded' };
    }
    if (['FAILED', 'FAILURE', 'REJECTED'].includes(normalized)) {
      if (!this.commitLoanResponse({ action, mutationId, outcome: 'failed', response })) {
        return { ok: false, status: 'unknown', reconciliationRequired: true, error: `${action} rejection could not be committed` };
      }
      return { ok: false, status: 'failed', error: `${action} was rejected by Binance` };
    }
    this.invalidateCachedState();
    this.commitLoanResponse({
      action,
      mutationId,
      outcome: 'unknown',
      reconciliationRequired: true,
      response,
    });
    return {
      ok: false,
      status: 'unknown',
      reconciliationRequired: true,
      error: `${action} outcome is unknown; signed account reconciliation is required`,
    };
  }

  private classifySignedError(action: string, mutationId: string, error: unknown): LoanActionResult {
    const message = errorMessage(error);
    const ambiguousBinanceCodes = new Set([-1000, -1001, -1006, -1007, -1008, -1016]);
    const knownFailure = error instanceof BinanceApiError
      && error.httpStatus < 500
      && !ambiguousBinanceCodes.has(error.binanceCode ?? 0);
    if (!knownFailure) this.invalidateCachedState();
    const committed = this.commitLoanResponse({
      action,
      mutationId,
      outcome: knownFailure ? 'failed' : 'unknown',
      reconciliationRequired: !knownFailure,
      error: message,
    });
    this.safeLog('error_event', null, {
      source: `loans.${action}`,
      message,
      outcome: knownFailure ? 'failed' : 'unknown',
      reconciliationRequired: !knownFailure,
    });
    if (!committed) {
      return { ok: false, status: 'unknown', reconciliationRequired: true, error: `${action} outcome could not be committed; reconcile Binance (${message})` };
    }
    if (knownFailure) return { ok: false, status: 'failed', error: message };
    return {
      ok: false,
      status: 'unknown',
      reconciliationRequired: true,
      error: `${action} outcome is unknown; signed account reconciliation is required (${message})`,
    };
  }

  async borrow(
    loanCoin: string,
    collateralCoin: string,
    loanAmount: number,
    confirmCoin: string
  ): Promise<LoanActionResult> {
    return this.enqueueMutation(async () => {
      const invalid = this.validateActionInput(loanCoin, collateralCoin, loanAmount);
      if (invalid) return { ok: false, status: 'failed', error: invalid };
      if (!isCanonicalAsset(confirmCoin) || confirmCoin !== loanCoin) {
        this.ledger.logEvent('manual_action', null, {
          action: 'loan_borrow',
          result: 'rejected',
          error: 'typed confirmation did not exactly match loan coin',
        });
        return { ok: false, status: 'failed', error: 'Typed confirmation does not exactly match the loan coin.' };
      }
      const actionKey = `borrow:${loanCoin}:${collateralCoin}`;
      const decision = await this.borrowGuard(loanCoin, collateralCoin, loanAmount, actionKey);
      this.ledger.logEvent('risk_decision', null, {
        stage: 'loan_borrow',
        allowed: !decision.error,
        reasons: decision.error ? [decision.error] : [],
        loanCoin,
        collateralCoin,
        loanAmount,
        proposedInitialLtvPct: decision.initialLtvPct,
        sourceFetchedAt: decision.fetchedAt,
      });
      if (decision.error) return { ok: false, status: 'failed', error: decision.error };
      const mutationId = randomUUID();
      this.ledger.logEvent('loan_request', null, { mutationId, actionKey, riskIncreasing: true, action: 'borrow', loanCoin, collateralCoin, loanAmount });
      try {
        const response = await this.client!.flexibleBorrow(loanCoin, collateralCoin, loanAmount);
        return this.classifySignedResponse('borrow', mutationId, response);
      } catch (error) {
        return this.classifySignedError('borrow', mutationId, error);
      }
    });
  }

  /** Collateral add/remove — risk-adjusting, kill-switch gated, ledgered. */
  async adjustLtv(
    loanCoin: string,
    collateralCoin: string,
    amount: number,
    direction: 'ADDITIONAL' | 'REDUCED',
    confirmCoin: string,
  ): Promise<LoanActionResult> {
    return this.enqueueMutation(async () => {
      const invalid = this.validateActionInput(loanCoin, collateralCoin, amount);
      if (invalid) return { ok: false, status: 'failed', error: invalid };
      if (direction !== 'ADDITIONAL' && direction !== 'REDUCED') {
        return { ok: false, status: 'failed', error: 'direction must be exactly ADDITIONAL or REDUCED' };
      }
      if (!isCanonicalAsset(confirmCoin) || confirmCoin !== loanCoin) {
        this.safeLog('manual_action', null, { action: 'loan_adjust_ltv', result: 'rejected', error: 'typed confirmation did not exactly match loan coin' });
        return { ok: false, status: 'failed', error: 'Typed confirmation does not exactly match the loan coin.' };
      }
      const actionKey = `adjust_ltv:${direction}:${loanCoin}:${collateralCoin}`;
      const blocked = await this.baseGate(direction === 'REDUCED', actionKey);
      if (blocked) return { ok: false, status: 'failed', error: blocked };

      if (direction === 'REDUCED') {
        const decision = await this.reductionGuard(loanCoin, collateralCoin, amount);
        this.ledger.logEvent('risk_decision', null, {
          stage: 'loan_collateral_reduction',
          allowed: !decision.error,
          reasons: decision.error ? [decision.error] : [],
          loanCoin,
          collateralCoin,
          reductionAmount: amount,
          currentLtvPct: decision.currentLtvPct,
          projectedLtvPct: decision.projectedLtvPct,
          sourceFetchedAt: decision.fetchedAt,
        });
        if (decision.error) return { ok: false, status: 'failed', error: decision.error };
      }

      const mutationId = randomUUID();
      this.ledger.logEvent('loan_request', null, { mutationId, actionKey, riskIncreasing: direction === 'REDUCED', action: 'adjust_ltv', loanCoin, collateralCoin, amount, direction });
      try {
        const response = await this.client!.flexibleAdjustLtv(loanCoin, collateralCoin, amount, direction);
        return this.classifySignedResponse('adjust_ltv', mutationId, response);
      } catch (error) {
        return this.classifySignedError('adjust_ltv', mutationId, error);
      }
    });
  }

  async repay(
    loanCoin: string,
    collateralCoin: string,
    repayAmount: number,
    confirmCoin: string,
  ): Promise<LoanActionResult> {
    return this.enqueueMutation(async () => {
      const invalid = this.validateActionInput(loanCoin, collateralCoin, repayAmount);
      if (invalid) return { ok: false, status: 'failed', error: invalid };
      if (!isCanonicalAsset(confirmCoin) || confirmCoin !== loanCoin) {
        this.safeLog('manual_action', null, { action: 'loan_repay', result: 'rejected', error: 'typed confirmation did not exactly match loan coin' });
        return { ok: false, status: 'failed', error: 'Typed confirmation does not exactly match the loan coin.' };
      }
      const actionKey = `repay:${loanCoin}:${collateralCoin}`;
      const blocked = await this.baseGate(false, actionKey);
      if (blocked) return { ok: false, status: 'failed', error: blocked };
      const mutationId = randomUUID();
      this.ledger.logEvent('loan_request', null, { mutationId, actionKey, riskIncreasing: false, action: 'repay', loanCoin, collateralCoin, repayAmount });
      try {
        const response = await this.client!.flexibleRepay(loanCoin, collateralCoin, repayAmount);
        return this.classifySignedResponse('repay', mutationId, response);
      } catch (error) {
        return this.classifySignedError('repay', mutationId, error);
      }
    });
  }

  acknowledgeReconciliation(confirm: string): LoanActionResult {
    if (confirm !== 'BINANCE LOAN STATE VERIFIED') {
      return { ok: false, status: 'failed', error: 'Exact reconciliation confirmation is required.' };
    }
    const unresolved = this.ledger.unresolvedLoanMutations();
    if (!unresolved.length) return { ok: true, status: 'succeeded' };
    try {
      this.ledger.logEvent('manual_action', null, {
        action: 'loan_reconciliation_acknowledged',
        source: 'operator_verified_binance',
      });
      for (const item of unresolved) {
        this.ledger.logEvent('loan_response', null, {
          action: 'reconciliation',
          mutationId: item.mutationId,
          outcome: 'reconciled_by_operator',
        });
      }
      return { ok: true, status: 'succeeded' };
    } catch {
      return { ok: false, status: 'failed', error: 'Reconciliation acknowledgement could not be committed.' };
    }
  }
}

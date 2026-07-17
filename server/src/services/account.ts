import type { BinanceClient, ApiRestrictions } from '../binance/client.js';
import { boundedBinanceIdentifier } from '../binance/identifiers.js';
import {
  addExactDecimals,
  compareExactDecimals,
  divideExactDecimals,
  minimumExactDecimal,
  multiplyExactDecimals,
  normalizeNonNegativeExactDecimal,
  subtractExactDecimals,
  type ExactDecimal,
  type NonNegativeDecimal,
} from '../capitalFoundation/contracts/decimal.js';
import type { Ledger, FillInput, FillRow } from '../ledger.js';
import type { BalanceEntry, PositionEntry } from '../types.js';

const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const FILL_RECONCILE_FRESH_MS = 90_000;
const FILL_RECONCILE_PAGE_SIZE = 1_000;
const FILL_RECONCILE_MAX_PAGES = 10;
const FILL_RECONCILE_MAX_SYMBOLS = 50;
const FILL_SYMBOL_UNIVERSE_MAX = 500;
const FILL_SYMBOL_UNIVERSE_KEY = 'fill_reconcile:symbol_universe:v1';
const USDT_SYMBOL_RE = /^[A-Z0-9]{1,16}USDT$/;
const SCOPED_FILL_LIMITATION =
  'Binance trade history is symbol-scoped; current-day configured and observed symbols do not prove account-wide fill coverage';

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finiteNonNegative(value: number): boolean {
  return finite(value) && value >= 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fillDay(ts: number): string | null {
  if (!finite(ts) || ts <= 0) return null;
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

const EXACT_ZERO = normalizeNonNegativeExactDecimal('0');

function exactPositive(value: unknown): value is NonNegativeDecimal {
  try {
    const normalized = normalizeNonNegativeExactDecimal(value);
    return normalized === value && compareExactDecimals(normalized, EXACT_ZERO) > 0;
  } catch {
    return false;
  }
}

function exactNonNegative(value: unknown): value is NonNegativeDecimal {
  try {
    return normalizeNonNegativeExactDecimal(value) === value;
  } catch {
    return false;
  }
}

function validateFill(fill: FillInput | FillRow): string | null {
  // PnL and equity in this service are explicitly denominated in USDT. A
  // non-USDT fill cannot safely share the same cost-basis calculation.
  if (!/^[A-Z0-9]{1,16}USDT$/.test(fill.symbol)) return 'invalid USDT symbol';
  if (!Number.isSafeInteger(fill.tradeId) || fill.tradeId < 0) return 'invalid trade id';
  if (fill.orderId !== null && (!Number.isSafeInteger(fill.orderId) || fill.orderId < 0)) return 'invalid order id';
  if (fill.side !== 'BUY' && fill.side !== 'SELL') return 'invalid side';
  if (!exactPositive(fill.price)) return 'invalid price';
  if (!exactPositive(fill.qty)) return 'invalid quantity';
  if (!exactPositive(fill.quoteQty)) return 'invalid quote quantity';
  if (!exactNonNegative(fill.commission)) return 'invalid commission';
  if (fill.commissionAsset !== null && !boundedBinanceIdentifier(fill.commissionAsset, 20, 80)) return 'invalid commission asset';
  if (!Number.isInteger(fill.ts) || fill.ts <= 0 || fillDay(fill.ts) === null || fill.ts > Date.now() + 5 * 60_000) {
    return 'invalid timestamp';
  }
  if (typeof fill.source !== 'string' || fill.source.length === 0 || fill.source.length > 64) return 'invalid source';
  return null;
}

function exactMapAdd<K>(map: Map<K, ExactDecimal>, key: K, amount: ExactDecimal): void {
  map.set(key, addExactDecimals(map.get(key) ?? EXACT_ZERO, amount));
}

function exactNumber(value: ExactDecimal): number {
  const projected = Number(value);
  if (!Number.isFinite(projected)) throw new Error('PNL_NUMERIC_PROJECTION_UNAVAILABLE');
  return projected;
}

function numberMap<K>(map: ReadonlyMap<K, ExactDecimal>): Map<K, number> {
  return new Map([...map].map(([key, value]) => [key, exactNumber(value)]));
}

function utcDayStart(ts = Date.now()): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export interface FillReconciliationStatus {
  /** True only when the account-wide safety boundary has been reconciled. */
  complete: boolean;
  /** True when every symbol in `symbols` has been reconciled recently. */
  scopeComplete: boolean;
  fresh: boolean;
  reconciledAt: number | null;
  dayStart: number | null;
  symbols: string[];
  coverageScope: 'not_applicable' | 'configured_and_observed_symbols';
  accountWide: boolean | null;
  limitation: string | null;
  error: string | null;
}

function parseFillSymbolUniverse(raw: string): { dayStart: number; symbols: string[] } {
  const value = JSON.parse(raw) as { version?: unknown; dayStart?: unknown; symbols?: unknown } | null;
  if (!value || value.version !== 1 || !Array.isArray(value.symbols)) {
    throw new Error('persisted fill-symbol universe has an invalid format');
  }
  if (
    !Number.isSafeInteger(value.dayStart)
    || (value.dayStart as number) < 0
    || (value.dayStart as number) % ONE_DAY_MS !== 0
  ) {
    throw new Error('persisted fill-symbol universe has an invalid UTC day');
  }
  if (value.symbols.length > FILL_SYMBOL_UNIVERSE_MAX) {
    throw new Error(`persisted fill-symbol universe exceeds ${FILL_SYMBOL_UNIVERSE_MAX} symbols`);
  }
  const symbols = new Set<string>();
  for (const rawSymbol of value.symbols) {
    if (typeof rawSymbol !== 'string' || !USDT_SYMBOL_RE.test(rawSymbol)) {
      throw new Error('persisted fill-symbol universe contains an unsupported symbol');
    }
    symbols.add(rawSymbol);
  }
  if (symbols.size !== value.symbols.length) {
    throw new Error('persisted fill-symbol universe contains duplicate symbols');
  }
  return { dayStart: value.dayStart as number, symbols: [...symbols].sort() };
}

function parseFillCursor(
  raw: string | null,
  expectedDayStart: number,
  now: number,
): { lastId: number | null; throughTs: number } | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.dayStart !== expectedDayStart) return null;
    const throughTs = Number(value.throughTs);
    const lastId = value.lastId === null ? null : Number(value.lastId);
    if (!Number.isSafeInteger(throughTs) || throughTs < expectedDayStart || throughTs > now + 5 * 60_000) return null;
    if (lastId !== null && (!Number.isSafeInteger(lastId) || lastId < 0)) return null;
    return { lastId, throughTs };
  } catch {
    return null;
  }
}

export class AccountService {
  connected = false;
  lastSyncTs: number | null = null;
  lastError: string | null = null;
  canWithdraw: boolean | null = null; // KEY-level withdraw permission (see sync)
  canTrade: boolean | null = null;
  keyRestrictions: ApiRestrictions | null = null; // authoritative per-key permissions
  lastRestrictionsTs: number | null = null;
  private balances = new Map<string, { free: number; locked: number }>();
  private syncInFlight: Promise<void> | null = null;
  private balanceSourceTs = 0;
  private balanceMutationVersion = 0;
  private lastSnapshotTs = 0;
  private configuredFillSymbols = new Set<string>();
  private durableFillSymbols = new Set<string>();
  private fillUniverseDayStart = utcDayStart();
  private configuredFillScopeError: string | null = null;
  private fillUniverseLoadError: string | null = null;
  private fillUniverseWriteError: string | null = null;
  private fillUniverseCapacityError: string | null = null;
  private fillReconcileInFlight: Promise<FillReconciliationStatus> | null = null;
  private lastFillReconcileScope = '';
  lastFillReconcileTs: number | null = null;
  lastFillReconcileError: string | null = null;
  private pnlCacheDirty = true;
  private pnlCostBasisIncomplete = new Set<string>();
  private pnlDailyPolicyExact = new Map<string, ExactDecimal>();
  private pnlCache: {
    realizedByDay: Map<string, number>;
    realizedBySymbol: Map<string, number>;
    feesByAsset: Map<string, number>;
    avgCost: Map<string, { qty: number; avgCost: number }>;
    feeUsdByDay: Map<string, number>;
    incompleteByDay: Map<string, string[]>;
  } = {
    realizedByDay: new Map(),
    realizedBySymbol: new Map(),
    feesByAsset: new Map(),
    avgCost: new Map(),
    feeUsdByDay: new Map(),
    incompleteByDay: new Map(),
  };

  constructor(
    private readonly client: BinanceClient | null,
    private readonly ledger: Ledger,
    private readonly priceOf: (symbol: string) => number | null
  ) {
    this.restoreFillSymbolUniverse();
    // Keep the cache coherent for both service-boundary fill events and legacy
    // import audit events.
    this.ledger.on('event', (event: { kind?: string; data?: unknown }) => {
      const data = event.data as { action?: unknown } | null;
      if (event.kind === 'fill_event' || (event.kind === 'manual_action' && data?.action === 'import_fills')) {
        this.pnlCacheDirty = true;
      }
    });
  }

  get keysPresent(): boolean {
    return this.client !== null;
  }

  private restoreFillSymbolUniverse(): void {
    const today = utcDayStart();
    this.fillUniverseDayStart = today;
    const persisted = this.ledger.getConfigValue(FILL_SYMBOL_UNIVERSE_KEY);
    const restored = new Set<string>();
    let persistRequired = persisted === null;
    if (persisted !== null) {
      try {
        const parsed = parseFillSymbolUniverse(persisted);
        if (parsed.dayStart === today) {
          for (const symbol of parsed.symbols) restored.add(symbol);
        } else {
          // Yesterday's discovery scope cannot affect today's daily-loss
          // boundary. Start a fresh UTC-day registry instead of accumulating
          // historical symbols until the active reconciliation cap is hit.
          persistRequired = true;
        }
      } catch (error) {
        this.fillUniverseLoadError = errorMessage(error);
      }
    }

    // The fills table is also durable evidence. The indexed, bounded distinct
    // query repairs an older/interrupted registry without materializing the
    // lifetime fill ledger during service startup.
    const observedToday = this.ledger.distinctFillSymbolsBetween(
      today,
      today + ONE_DAY_MS,
      FILL_SYMBOL_UNIVERSE_MAX + 1,
    );
    if (observedToday.length > FILL_SYMBOL_UNIVERSE_MAX) {
      this.fillUniverseCapacityError = `fill-symbol universe exceeds ${FILL_SYMBOL_UNIVERSE_MAX} symbols`;
    }
    for (const symbol of observedToday.slice(0, FILL_SYMBOL_UNIVERSE_MAX)) {
      if (!USDT_SYMBOL_RE.test(symbol)) {
        this.fillUniverseLoadError ??= `ledger contains unsupported fill-reconciliation symbol: ${symbol}`;
        continue;
      }
      if (!restored.has(symbol) && restored.size >= FILL_SYMBOL_UNIVERSE_MAX) {
        this.fillUniverseCapacityError = `fill-symbol universe exceeds ${FILL_SYMBOL_UNIVERSE_MAX} symbols`;
        continue;
      }
      if (!restored.has(symbol)) persistRequired = true;
      restored.add(symbol);
    }
    this.durableFillSymbols = restored;

    if (this.fillUniverseLoadError === null && persistRequired) this.persistFillSymbolUniverse();
  }

  private ensureCurrentFillUniverse(): void {
    const today = utcDayStart();
    if (today === this.fillUniverseDayStart) return;
    this.fillUniverseDayStart = today;
    this.durableFillSymbols = new Set([...this.configuredFillSymbols].slice(0, FILL_SYMBOL_UNIVERSE_MAX));
    this.fillUniverseLoadError = null;
    this.fillUniverseWriteError = null;
    this.fillUniverseCapacityError = this.configuredFillSymbols.size > FILL_SYMBOL_UNIVERSE_MAX
      ? `fill-symbol universe exceeds ${FILL_SYMBOL_UNIVERSE_MAX} symbols`
      : null;
    this.lastFillReconcileScope = '';
    this.lastFillReconcileTs = null;
    this.lastFillReconcileError = null;
    this.persistFillSymbolUniverse();
  }

  private persistFillSymbolUniverse(): void {
    if (this.fillUniverseLoadError !== null || this.fillUniverseCapacityError !== null) return;
    try {
      this.ledger.setConfigValue(FILL_SYMBOL_UNIVERSE_KEY, JSON.stringify({
        version: 1,
        dayStart: this.fillUniverseDayStart,
        symbols: [...this.durableFillSymbols].sort(),
      }));
      this.fillUniverseWriteError = null;
    } catch (error) {
      this.fillUniverseWriteError = `fill-symbol universe could not be persisted: ${errorMessage(error)}`;
    }
  }

  private rememberFillSymbols(symbols: Iterable<string>): void {
    this.ensureCurrentFillUniverse();
    let changed = false;
    for (const symbol of symbols) {
      if (this.durableFillSymbols.has(symbol)) continue;
      if (this.durableFillSymbols.size >= FILL_SYMBOL_UNIVERSE_MAX) {
        this.fillUniverseCapacityError = `fill-symbol universe exceeds ${FILL_SYMBOL_UNIVERSE_MAX} symbols`;
        continue;
      }
      this.durableFillSymbols.add(symbol);
      changed = true;
    }
    if (changed || this.fillUniverseWriteError !== null) this.persistFillSymbolUniverse();
  }

  private fillSymbols(): string[] {
    this.ensureCurrentFillUniverse();
    return [...new Set([...this.configuredFillSymbols, ...this.durableFillSymbols])].sort();
  }

  private fillScopeError(symbols = this.fillSymbols()): string | null {
    if (this.configuredFillScopeError) return this.configuredFillScopeError;
    if (this.fillUniverseLoadError) return this.fillUniverseLoadError;
    if (this.fillUniverseWriteError) return this.fillUniverseWriteError;
    if (this.fillUniverseCapacityError) return this.fillUniverseCapacityError;
    if (symbols.length > FILL_RECONCILE_MAX_SYMBOLS) {
      return `fill-reconciliation scope exceeds ${FILL_RECONCILE_MAX_SYMBOLS} symbols`;
    }
    return null;
  }

  setRequiredFillSymbols(symbols: Iterable<string>): void {
    const next = new Set<string>();
    let error: string | null = null;
    for (const raw of symbols) {
      const symbol = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
      if (!USDT_SYMBOL_RE.test(symbol)) {
        error = `unsupported fill-reconciliation symbol: ${symbol || 'empty'}`;
        continue;
      }
      next.add(symbol);
    }
    if (next.size > FILL_SYMBOL_UNIVERSE_MAX) {
      error = `fill-symbol universe exceeds ${FILL_SYMBOL_UNIVERSE_MAX} symbols`;
    }
    this.configuredFillSymbols = next;
    this.configuredFillScopeError = error;
    this.rememberFillSymbols(next);
  }

  /**
   * Persist a current-day symbol before an app-initiated order mutation can
   * affect it. This is deliberately local/synchronous; risk-reducing cancels
   * must not wait for, or be blocked by, a trade-history network request.
   */
  registerFillSymbols(symbols: Iterable<string>): void {
    const registered = new Set<string>();
    for (const raw of symbols) {
      const symbol = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
      if (!USDT_SYMBOL_RE.test(symbol)) {
        this.configuredFillScopeError = `unsupported fill-reconciliation symbol: ${symbol || 'empty'}`;
        continue;
      }
      registered.add(symbol);
    }
    this.rememberFillSymbols(registered);
  }

  fillReconciliationStatus(): FillReconciliationStatus {
    if (!this.client) {
      return {
        complete: true,
        scopeComplete: true,
        fresh: true,
        reconciledAt: null,
        dayStart: null,
        symbols: [],
        coverageScope: 'not_applicable',
        accountWide: null,
        limitation: null,
        error: null,
      };
    }
    const symbols = this.fillSymbols();
    const scope = symbols.join(',');
    const age = this.lastFillReconcileTs === null ? Number.POSITIVE_INFINITY : Date.now() - this.lastFillReconcileTs;
    const scopeError = this.fillScopeError(symbols);
    const scopeComplete =
      scopeError === null &&
      this.lastFillReconcileError === null &&
      this.lastFillReconcileScope === scope &&
      Number.isFinite(age) &&
      age >= -1_000 &&
      age <= FILL_RECONCILE_FRESH_MS;
    return {
      // Binance's account trade-list endpoint requires a symbol. Even a
      // successful pass over every symbol the app knows cannot certify that
      // an external same-day round trip did not occur on another symbol.
      complete: false,
      scopeComplete,
      fresh: scopeComplete,
      reconciledAt: this.lastFillReconcileTs,
      dayStart: this.fillUniverseDayStart,
      symbols,
      coverageScope: 'configured_and_observed_symbols',
      accountWide: false,
      limitation: SCOPED_FILL_LIMITATION,
      error: scopeError ?? this.lastFillReconcileError ?? (scopeComplete ? null : 'fill reconciliation is stale or has not completed'),
    };
  }

  async reconcileFills(extraSymbols: Iterable<string> = []): Promise<FillReconciliationStatus> {
    if (!this.client) return this.fillReconciliationStatus();
    this.registerFillSymbols(extraSymbols);
    if (this.fillReconcileInFlight) return this.fillReconcileInFlight;
    const run = this.reconcileFillsOnce();
    this.fillReconcileInFlight = run;
    try {
      return await run;
    } finally {
      if (this.fillReconcileInFlight === run) this.fillReconcileInFlight = null;
    }
  }

  private async reconcileFillsOnce(): Promise<FillReconciliationStatus> {
    if (!this.client) return this.fillReconciliationStatus();
    const symbols = this.fillSymbols();
    const scope = symbols.join(',');
    const startedAt = Date.now();
    const dayStart = utcDayStart(startedAt);
    const scopeError = this.fillScopeError(symbols);
    if (scopeError) {
      this.lastFillReconcileError = scopeError;
      return this.fillReconciliationStatus();
    }
    let imported = 0;
    try {
      for (const symbol of symbols) {
        const key = `fill_reconcile:${symbol}`;
        const cursor = parseFillCursor(this.ledger.getConfigValue(key), dayStart, startedAt);
        let lastId = cursor?.lastId ?? null;
        let options: { fromId?: number; startTime?: number; endTime?: number } = lastId === null
          ? { startTime: Math.max(dayStart, (cursor?.throughTs ?? dayStart) - 1_000), endTime: startedAt }
          : { fromId: lastId + 1 };
        let completed = false;
        for (let page = 0; page < FILL_RECONCILE_MAX_PAGES; page += 1) {
          const trades = await this.client.myTrades(symbol, FILL_RECONCILE_PAGE_SIZE, options);
          if (!Array.isArray(trades) || trades.length > FILL_RECONCILE_PAGE_SIZE) {
            throw new Error(`Binance returned invalid trade history for ${symbol}`);
          }
          let pageMaxId = lastId;
          for (const trade of trades) {
            if (
              !trade ||
              trade.symbol !== symbol ||
              !Number.isSafeInteger(trade.id) ||
              trade.id < 0 ||
              !Number.isSafeInteger(trade.orderId) ||
              trade.orderId < 0 ||
              typeof trade.isBuyer !== 'boolean'
            ) {
              throw new Error(`Binance returned malformed trade history for ${symbol}`);
            }
            const fill: FillInput = {
              symbol,
              tradeId: trade.id,
              orderId: trade.orderId,
              side: trade.isBuyer ? 'BUY' : 'SELL',
              price: normalizeNonNegativeExactDecimal(trade.price),
              qty: normalizeNonNegativeExactDecimal(trade.qty),
              quoteQty: normalizeNonNegativeExactDecimal(trade.quoteQty),
              commission: normalizeNonNegativeExactDecimal(trade.commission),
              commissionAsset: trade.commissionAsset,
              ts: trade.time,
              source: 'rest_reconciliation',
            };
            const invalid = validateFill(fill);
            if (invalid) throw new Error(`Binance returned invalid trade history for ${symbol}: ${invalid}`);
            if (this.recordFill(fill)) imported += 1;
            pageMaxId = pageMaxId === null ? trade.id : Math.max(pageMaxId, trade.id);
          }
          if (trades.length < FILL_RECONCILE_PAGE_SIZE) {
            lastId = pageMaxId;
            completed = true;
            break;
          }
          if (pageMaxId === null || pageMaxId === lastId) {
            throw new Error(`Binance trade pagination did not advance for ${symbol}`);
          }
          lastId = pageMaxId;
          options = { fromId: lastId + 1 };
        }
        if (!completed) throw new Error(`Trade reconciliation exceeded ${FILL_RECONCILE_MAX_PAGES * FILL_RECONCILE_PAGE_SIZE} rows for ${symbol}`);
        this.ledger.setConfigValue(key, JSON.stringify({ dayStart, lastId, throughTs: startedAt }));
      }
      this.lastFillReconcileScope = scope;
      this.lastFillReconcileTs = startedAt;
      this.lastFillReconcileError = null;
      if (imported > 0) this.safeLog('fill_reconciliation', null, { imported, symbols: symbols.length, reconciledAt: startedAt });
    } catch (error) {
      this.lastFillReconcileError = errorMessage(error);
      this.safeLog('error_event', null, { source: 'account.fill_reconciliation', message: this.lastFillReconcileError });
    }
    return this.fillReconciliationStatus();
  }

  async sync(): Promise<void> {
    if (!this.client) return;
    if (this.syncInFlight) return this.syncInFlight;
    const run = this.syncOnce();
    this.syncInFlight = run;
    try {
      await run;
    } finally {
      if (this.syncInFlight === run) this.syncInFlight = null;
    }
  }

  private async syncOnce(): Promise<void> {
    if (!this.client) return;
    const balanceVersionAtRequest = this.balanceMutationVersion;
    try {
      const acct = await this.client.account();
      if (!acct || !Array.isArray(acct.balances)) throw new Error('Binance account payload is invalid');
      const nextBalances = new Map<string, { free: number; locked: number }>();
      for (const b of acct.balances) {
        if (!b || !boundedBinanceIdentifier(b.asset, 20, 80)) throw new Error('Binance account payload has an invalid asset');
        const free = Number(b.free);
        const locked = Number(b.locked);
        if (!finiteNonNegative(free) || !finiteNonNegative(locked)) {
          throw new Error(`Binance account payload has an invalid balance for ${b.asset}`);
        }
        if (free > 0 || locked > 0) nextBalances.set(b.asset, { free, locked });
      }
      // /api/v3/account.canTrade/canWithdraw are ACCOUNT-level and stay true for a
      // read-only key. Prefer the KEY-level flags from apiRestrictions so the UI
      // reflects the real key scope, not the account. Fetched best-effort — a
      // failure here must not break the balance sync.
      try {
        this.keyRestrictions = await this.client.apiRestrictions();
        this.lastRestrictionsTs = Date.now();
        this.canWithdraw = this.keyRestrictions.enableWithdrawals;
        this.canTrade = this.keyRestrictions.enableSpotAndMarginTrading;
      } catch {
        this.keyRestrictions = null;
        this.lastRestrictionsTs = null;
        // Account-level flags describe the Binance account, not this API key.
        // Treat a failed per-key posture lookup as unknown rather than
        // claiming that withdrawals or trading are either enabled or disabled.
        this.canWithdraw = null;
        this.canTrade = null;
      }
      const sourceTs = Number((acct as { updateTime?: unknown }).updateTime);
      const hasSourceTs = Number.isSafeInteger(sourceTs) && sourceTs > 0;
      const streamArrivedDuringRequest = this.balanceMutationVersion !== balanceVersionAtRequest;
      const olderThanStreamState = this.balanceSourceTs > 0 && (!hasSourceTs || sourceTs < this.balanceSourceTs);
      if (!streamArrivedDuringRequest && !olderThanStreamState) {
        this.balances = nextBalances;
        if (hasSourceTs) this.balanceSourceTs = sourceTs;
        this.balanceMutationVersion += 1;
      }
      const wasConnected = this.connected;
      this.connected = true;
      this.lastSyncTs = Date.now();
      this.lastError = null;
      if (!wasConnected) {
        this.safeLog('binance.connected', null, {
          assets: this.balances.size,
          canTrade: acct.canTrade,
          canWithdraw: this.canWithdraw,
        });
        if (this.canWithdraw) {
          this.safeLog('error_event', null, {
            severity: 'warning',
            message:
              'API key has WITHDRAWAL permission enabled. This app never withdraws, but the key should not have that power. Recreate the key with withdrawals disabled.',
          });
        }
      }
      this.maybeSnapshot();
    } catch (err) {
      const msg = errorMessage(err);
      if (this.connected || this.lastError !== msg) {
        this.safeLog('error_event', null, { source: 'account.sync', message: msg });
      }
      this.connected = false;
      this.lastError = msg;
      this.keyRestrictions = null;
      this.lastRestrictionsTs = null;
      this.canWithdraw = null;
      this.canTrade = null;
    }
  }

  /** Balance updates pushed by the user data stream. */
  applyStreamBalances(list: { a: string; f: string; l: string }[], updateTime: number): void {
    if (!Array.isArray(list)) {
      this.safeLog('error_event', null, { source: 'account.stream', message: 'invalid balance update payload' });
      return;
    }
    if (!Number.isSafeInteger(updateTime) || updateTime <= 0) {
      this.safeLog('error_event', null, { source: 'account.stream', message: 'invalid balance update timestamp' });
      return;
    }
    if (updateTime < this.balanceSourceTs) return;
    const updates: { asset: string; free: number; locked: number }[] = [];
    for (const b of list) {
      if (!b || !boundedBinanceIdentifier(b.a, 20, 80)) {
        this.safeLog('error_event', null, { source: 'account.stream', message: 'invalid balance update asset' });
        return;
      }
      const free = Number(b.f);
      const locked = Number(b.l);
      if (!finiteNonNegative(free) || !finiteNonNegative(locked)) {
        this.safeLog('error_event', b.a, { source: 'account.stream', message: 'invalid balance update amount' });
        return;
      }
      updates.push({ asset: b.a, free, locked });
    }
    for (const b of updates) {
      if (b.free > 0 || b.locked > 0) this.balances.set(b.asset, { free: b.free, locked: b.locked });
      else this.balances.delete(b.asset);
    }
    this.balanceSourceTs = updateTime;
    this.balanceMutationVersion += 1;
    this.lastSyncTs = Date.now();
  }

  recordFill(fill: FillInput): boolean {
    const invalid = validateFill(fill);
    if (invalid) {
      this.safeLog('error_event', /^[A-Z0-9]{4,20}$/.test(fill.symbol) ? fill.symbol : null, {
        source: 'account.fill',
        message: `fill rejected: ${invalid}`,
      });
      return false;
    }
    // User-stream, order-response, manual-import, and REST-reconciled fills
    // all become durable discovery evidence before future scope is evaluated.
    this.rememberFillSymbols([fill.symbol]);
    const isNew = this.ledger.insertFill(fill);
    if (isNew) {
      this.pnlCacheDirty = true;
      this.safeLog('fill_event', fill.symbol, {
        tradeId: fill.tradeId,
        orderId: fill.orderId,
        side: fill.side,
        price: fill.price,
        qty: fill.qty,
        quoteQty: fill.quoteQty,
        source: fill.source,
      });
    }
    return isNew;
  }

  equity(): {
    totalUsdt: number;
    availableUsdt: number;
    entries: BalanceEntry[];
    complete: boolean;
    sourceFresh: boolean;
    pricedAssets: string[];
    unpricedAssets: string[];
  } {
    const entries: BalanceEntry[] = [];
    const pricedAssets: string[] = [];
    const unpricedAssets: string[] = [];
    let total = 0;
    for (const [asset, b] of this.balances) {
      const qty = b.free + b.locked;
      const rawPrice = asset === 'USDT' ? 1 : this.priceOf(`${asset}USDT`);
      const price = rawPrice !== null && finite(rawPrice) && rawPrice > 0 ? rawPrice : null;
      const value = price !== null ? qty * price : 0;
      total += value;
      if (price === null && qty > 0) unpricedAssets.push(asset);
      else pricedAssets.push(asset);
      entries.push({ asset, free: b.free, locked: b.locked, priceUsdt: price, valueUsdt: value });
    }
    entries.sort((a, b) => b.valueUsdt - a.valueUsdt);
    pricedAssets.sort();
    unpricedAssets.sort();
    const sourceAge = this.lastSyncTs === null ? Number.POSITIVE_INFINITY : Date.now() - this.lastSyncTs;
    const sourceFresh = this.connected && Number.isFinite(sourceAge) && sourceAge >= -1_000 && sourceAge <= 60_000;
    return {
      totalUsdt: total,
      availableUsdt: this.balances.get('USDT')?.free ?? 0,
      entries,
      complete: sourceFresh && unpricedAssets.length === 0,
      sourceFresh,
      pricedAssets,
      unpricedAssets,
    };
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
        const hasCost = cost !== undefined
          && cost.qty > 0
          && e.priceUsdt !== null
          && !this.pnlCostBasisIncomplete.has(base);
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
    feeUsdByDay: Map<string, number>;
    incompleteByDay: Map<string, string[]>;
  } {
    if (!this.pnlCacheDirty) return this.pnlCache;
    const fills = this.ledger.allFillsAsc();
    const realizedByDayExact = new Map<string, ExactDecimal>();
    const realizedBySymbolExact = new Map<string, ExactDecimal>();
    const feesByAssetExact = new Map<string, ExactDecimal>();
    const positionsExact = new Map<string, {
      qty: ExactDecimal;
      totalCost: ExactDecimal;
      legacyTainted: boolean;
    }>();
    const feeUsdByDayExact = new Map<string, ExactDecimal>();
    const incompleteByDay = new Map<string, string[]>();
    const markIncomplete = (day: string, reason: string) => {
      const reasons = incompleteByDay.get(day) ?? [];
      if (!reasons.includes(reason)) reasons.push(reason);
      incompleteByDay.set(day, reasons);
    };
    for (const f of fills) {
      const day = fillDay(f.ts) ?? new Date().toISOString().slice(0, 10);
      const invalid = validateFill(f);
      if (invalid) {
        markIncomplete(day, `invalid fill: ${invalid}`);
        continue;
      }
      const base = f.symbol.replace(/USDT$/, '');
      const pos = positionsExact.get(base) ?? {
        qty: EXACT_ZERO,
        totalCost: EXACT_ZERO,
        legacyTainted: false,
      };
      if (f.moneyEncoding === 'LEGACY_BINARY64') {
        markIncomplete(day, `legacy binary64 fill requires authoritative reconciliation for ${f.symbol}`);
        pos.legacyTainted = true;
      }
      if (compareExactDecimals(f.commission, EXACT_ZERO) > 0 && f.commissionAsset) {
        exactMapAdd(feesByAssetExact, f.commissionAsset, f.commission);
        const feeUsd = this.fillFeeUsd(f, base);
        if (feeUsd === null) markIncomplete(day, `fee basis unavailable for ${f.commissionAsset}`);
        else exactMapAdd(feeUsdByDayExact, day, feeUsd);
      } else if (compareExactDecimals(f.commission, EXACT_ZERO) > 0) {
        markIncomplete(day, 'fee asset unavailable');
      }
      if (f.side === 'BUY') {
        pos.qty = addExactDecimals(pos.qty, f.qty);
        pos.totalCost = addExactDecimals(pos.totalCost, f.quoteQty);
      } else {
        if (pos.legacyTainted) {
          markIncomplete(day, `cost basis depends on legacy binary64 fill for ${f.symbol}`);
        }
        const matched = minimumExactDecimal(f.qty, pos.qty);
        let matchedCost: ExactDecimal = EXACT_ZERO;
        if (compareExactDecimals(matched, EXACT_ZERO) > 0) {
          matchedCost = compareExactDecimals(matched, pos.qty) === 0
            ? pos.totalCost
            : divideExactDecimals(multiplyExactDecimals(pos.totalCost, matched), pos.qty, 24);
          const matchedProceeds = compareExactDecimals(matched, f.qty) === 0
            ? f.quoteQty
            : divideExactDecimals(multiplyExactDecimals(f.quoteQty, matched), f.qty, 24);
          const gain = subtractExactDecimals(matchedProceeds, matchedCost);
          exactMapAdd(realizedByDayExact, day, gain);
          exactMapAdd(realizedBySymbolExact, f.symbol, gain);
        }
        if (compareExactDecimals(matched, f.qty) < 0) {
          markIncomplete(day, `cost basis unavailable for ${f.symbol} sell`);
        }
        if (compareExactDecimals(matched, pos.qty) === 0) {
          pos.qty = EXACT_ZERO;
          pos.totalCost = EXACT_ZERO;
          pos.legacyTainted = false;
        } else if (compareExactDecimals(matched, EXACT_ZERO) > 0) {
          pos.qty = normalizeNonNegativeExactDecimal(subtractExactDecimals(pos.qty, matched));
          pos.totalCost = normalizeNonNegativeExactDecimal(subtractExactDecimals(
            pos.totalCost,
            matchedCost,
          ));
        }
      }
      positionsExact.set(base, pos);
    }
    const avgCost = new Map<string, { qty: number; avgCost: number }>();
    this.pnlCostBasisIncomplete = new Set();
    for (const [base, pos] of positionsExact) {
      const qty = exactNumber(pos.qty);
      const averageCost = compareExactDecimals(pos.qty, EXACT_ZERO) > 0
        ? exactNumber(divideExactDecimals(pos.totalCost, pos.qty, 24))
        : 0;
      avgCost.set(base, { qty, avgCost: averageCost });
      if (pos.legacyTainted && compareExactDecimals(pos.qty, EXACT_ZERO) > 0) {
        this.pnlCostBasisIncomplete.add(base);
      }
    }
    const realizedByDay = numberMap(realizedByDayExact);
    const realizedBySymbol = numberMap(realizedBySymbolExact);
    const feesByAsset = numberMap(feesByAssetExact);
    const feeUsdByDay = numberMap(feeUsdByDayExact);
    this.pnlDailyPolicyExact = new Map(
      [...new Set([...realizedByDayExact.keys(), ...feeUsdByDayExact.keys()])]
        .map((day) => [
          day,
          subtractExactDecimals(
            realizedByDayExact.get(day) ?? EXACT_ZERO,
            feeUsdByDayExact.get(day) ?? EXACT_ZERO,
          ),
        ]),
    );
    this.pnlCache = { realizedByDay, realizedBySymbol, feesByAsset, avgCost, feeUsdByDay, incompleteByDay };
    this.pnlCacheDirty = false;
    return this.pnlCache;
  }

  realizedTodayUsd(): number {
    const day = new Date().toISOString().slice(0, 10);
    return this.pnl().realizedByDay.get(day) ?? 0;
  }

  /**
   * Conservative daily-loss input for the live risk gate. Realized PnL remains
   * a separate truthful UI number; policy PnL additionally deducts every fee
   * that can be valued in USDT and fails closed when sell cost basis or a fee
   * valuation is unavailable.
   */
  dailyLossPolicy(): { valueUsd: number; complete: boolean; reasons: string[] } {
    const day = new Date().toISOString().slice(0, 10);
    this.pnl();
    const pnl = this.pnlCache;
    const valueUsd = exactNumber(this.pnlDailyPolicyExact.get(day) ?? EXACT_ZERO);
    const reasons = [...(pnl.incompleteByDay.get(day) ?? [])];
    const coverage = this.fillReconciliationStatus();
    if (!coverage.scopeComplete) {
      reasons.push(coverage.error ?? 'configured and observed fill reconciliation is incomplete');
    } else if (coverage.accountWide === false) {
      reasons.push(coverage.limitation ?? SCOPED_FILL_LIMITATION);
    }
    return { valueUsd, complete: reasons.length === 0 && finite(valueUsd), reasons };
  }

  /** Equity at the first snapshot of the current UTC day (for the day-change card). */
  dayOpenEquity(): number | null {
    const ev = this.firstCompleteSnapshotSince(utcDayStart());
    const data = ev?.data as { totalUsdt?: number } | null;
    return finite(data?.totalUsdt ?? Number.NaN) ? data!.totalUsdt! : null;
  }

  private maybeSnapshot(): void {
    const now = Date.now();
    const eq = this.equity();
    const hasDailyComplete = this.firstCompleteSnapshotSince(utcDayStart()) !== null;
    // Retry immediately when pricing becomes complete so the first truthful
    // daily baseline is not delayed by a prior incomplete snapshot.
    if (now - this.lastSnapshotTs < SNAPSHOT_INTERVAL_MS && (hasDailyComplete || !eq.complete)) return;
    try {
      this.ledger.logEvent('account_snapshot', null, {
        totalUsdt: eq.totalUsdt,
        availableUsdt: eq.availableUsdt,
        assets: eq.entries.length,
        complete: eq.complete,
        pricedAssets: eq.pricedAssets,
        unpricedAssets: eq.unpricedAssets,
      });
      this.lastSnapshotTs = now;
    } catch {
      // A telemetry write must not make a successfully refreshed Binance
      // account appear disconnected. The next sync retries the snapshot.
    }
  }

  private firstCompleteSnapshotSince(ts: number) {
    return this.ledger.eventsSince(ts, 'account_snapshot').find((event) => {
      const data = event.data as { complete?: unknown; totalUsdt?: unknown } | null;
      return data?.complete === true && typeof data.totalUsdt === 'number' && finite(data.totalUsdt);
    }) ?? null;
  }

  private fillFeeUsd(fill: FillRow, base: string): ExactDecimal | null {
    if (compareExactDecimals(fill.commission, EXACT_ZERO) === 0) return EXACT_ZERO;
    if (fill.commissionAsset === 'USDT') return fill.commission;
    if (fill.commissionAsset === base) return multiplyExactDecimals(fill.commission, fill.price);
    // A current BNB/USDT (or other third-asset) quote is not the historical
    // fill-time fee value. Until that value is persisted with the fill, mark
    // the day incomplete instead of rewriting past PnL with today's price.
    return null;
  }

  private safeLog(kind: string, symbol: string | null, data: unknown): void {
    try {
      this.ledger.logEvent(kind, symbol, data);
    } catch {
      // Account sync/stream callbacks must never become unhandled background
      // failures. The next health/state read still exposes the disconnected or
      // stale account posture.
    }
  }
}

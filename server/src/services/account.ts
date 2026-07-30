import type { BinanceClient, ApiRestrictions } from '../binance/client.js';
import { boundedBinanceIdentifier } from '../binance/identifiers.js';
import {
  absoluteExactDecimal,
  addExactDecimals,
  compareExactDecimals,
  divideExactDecimals,
  minimumExactDecimal,
  multiplyExactDecimals,
  negateExactDecimal,
  normalizeNonNegativeExactDecimal,
  subtractExactDecimals,
  type ExactDecimal,
  type NonNegativeDecimal,
} from '../capitalFoundation/contracts/decimal.js';
import type { Ledger, FillInput, FillRow } from '../ledger.js';
import type { BalanceEntry, PositionEntry } from '../types.js';
import { isValidUtcMillis } from '../foundation/contracts/time.js';

const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const FILL_RECONCILE_FRESH_MS = 90_000;
const FILL_RECONCILE_PAGE_SIZE = 1_000;
const FILL_RECONCILE_MAX_PAGES = 10;
const FILL_RECONCILE_MAX_SYMBOLS = 50;
const FILL_SYMBOL_UNIVERSE_MAX = 500;
const FILL_SYMBOL_UNIVERSE_KEY = 'fill_reconcile:symbol_universe:v1';
const ACCOUNT_CLOCK_HIGH_WATER_KEY = 'account:clock_high_water:v1';
const USDT_SYMBOL_RE = /^[A-Z0-9]{1,16}USDT$/;
const SCOPED_FILL_LIMITATION =
  'Binance trade history is symbol-scoped; current-day configured and observed symbols do not prove account-wide fill coverage';
const ACCOUNT_CLOCK_INVALID = 'account clock did not return safe epoch milliseconds';
const ACCOUNT_CLOCK_REGRESSED = 'account clock regressed below its prior high-water mark';
const ACCOUNT_CLOCK_PERSISTENCE_DIVERGED =
  'account clock high-water witnesses diverge; repair required';
const ACCOUNT_CLOCK_ADVANCE_REQUIRED =
  'account clock must advance beyond its durable high-water before no-client policy can recover';

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
  if (!finite(ts) || ts < 0) return null;
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

function validateFill(fill: FillInput | FillRow, nowMs: number | null): string | null {
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
  if (
    !isValidUtcMillis(fill.ts)
    || fill.ts <= 0
    || fillDay(fill.ts) === null
    || nowMs === null
    || fill.ts > nowMs + 5 * 60_000
  ) {
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

interface FillEconomicDeltas {
  readonly baseDelta: ExactDecimal;
  readonly quoteDelta: ExactDecimal;
  readonly inventoryQty: NonNegativeDecimal;
  readonly inventoryQuoteAmount: NonNegativeDecimal;
}

/**
 * One exact owner for fill economics. Gross exchange quantities stay durable;
 * inventory consumes the signed net asset deltas while fees remain a separate
 * policy deduction, so base commission is neither ignored nor double-counted.
 */
function fillEconomicDeltas(fill: Readonly<FillRow>, base: string): FillEconomicDeltas {
  const baseCommission = fill.commissionAsset === base ? fill.commission : EXACT_ZERO;
  const quoteCommission = fill.commissionAsset === 'USDT' ? fill.commission : EXACT_ZERO;
  const baseDelta = fill.side === 'BUY'
    ? subtractExactDecimals(fill.qty, baseCommission)
    : negateExactDecimal(addExactDecimals(fill.qty, baseCommission));
  if (fill.side === 'BUY' && compareExactDecimals(baseDelta, EXACT_ZERO) <= 0) {
    throw new Error('base commission consumes the acquired quantity');
  }

  const quoteDelta = fill.side === 'BUY'
    ? negateExactDecimal(addExactDecimals(fill.quoteQty, quoteCommission))
    : subtractExactDecimals(fill.quoteQty, quoteCommission);
  if (fill.side === 'SELL' && compareExactDecimals(quoteDelta, EXACT_ZERO) < 0) {
    throw new Error('quote commission exceeds sell proceeds');
  }

  // Remove quote-denominated commission because the fee map accounts for it.
  // Base-denominated commission changes inventory, so value those consumed
  // units at the fill price before the same amount is deducted as a fee.
  const grossInventoryQuote = fill.side === 'BUY'
    ? subtractExactDecimals(absoluteExactDecimal(quoteDelta), quoteCommission)
    : addExactDecimals(quoteDelta, quoteCommission);
  const baseCommissionValue = multiplyExactDecimals(baseCommission, fill.price);
  const inventoryQuoteAmount = fill.side === 'BUY'
    ? subtractExactDecimals(grossInventoryQuote, baseCommissionValue)
    : addExactDecimals(grossInventoryQuote, baseCommissionValue);
  if (compareExactDecimals(inventoryQuoteAmount, EXACT_ZERO) < 0) {
    throw new Error('base commission value exceeds acquisition cost');
  }
  return Object.freeze({
    baseDelta,
    quoteDelta,
    inventoryQty: normalizeNonNegativeExactDecimal(absoluteExactDecimal(baseDelta)),
    inventoryQuoteAmount: normalizeNonNegativeExactDecimal(inventoryQuoteAmount),
  });
}

function utcDayStart(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

interface AccountClockReading {
  readonly nowMs: number | null;
  readonly trustworthy: boolean;
  readonly reason: string | null;
}

interface AccountPnl {
  realizedByDay: Map<string, number>;
  realizedBySymbol: Map<string, number>;
  feesByAsset: Map<string, number>;
  avgCost: Map<string, { qty: number; avgCost: number }>;
  feeUsdByDay: Map<string, number>;
  incompleteByDay: Map<string, string[]>;
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

function parseAccountClockHighWater(raw: string): number {
  const value = JSON.parse(raw) as {
    version?: unknown;
    clockHighWaterMs?: unknown;
  } | null;
  if (
    value === null
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).sort().join(',') !== 'clockHighWaterMs,version'
    || value.version !== 1
    || !isValidUtcMillis(value.clockHighWaterMs)
  ) {
    throw new Error('persisted account clock high-water witness has an invalid format');
  }
  return value.clockHighWaterMs;
}

function parseFillSymbolUniverse(raw: string): {
  dayStart: number;
  clockHighWaterMs: number;
  symbols: string[];
} {
  const value = JSON.parse(raw) as {
    version?: unknown;
    dayStart?: unknown;
    clockHighWaterMs?: unknown;
    symbols?: unknown;
  } | null;
  if (!value || value.version !== 1 || !Array.isArray(value.symbols)) {
    throw new Error('persisted fill-symbol universe has an invalid format');
  }
  if (
    !isValidUtcMillis(value.dayStart)
    || (value.dayStart as number) % ONE_DAY_MS !== 0
  ) {
    throw new Error('persisted fill-symbol universe has an invalid UTC day');
  }
  const clockHighWaterMs =
    value.clockHighWaterMs === undefined
      ? value.dayStart
      : value.clockHighWaterMs;
  if (
    !isValidUtcMillis(clockHighWaterMs)
    || clockHighWaterMs < value.dayStart
  ) {
    throw new Error('persisted fill-symbol universe has an invalid clock high-water mark');
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
  return {
    dayStart: value.dayStart as number,
    clockHighWaterMs,
    symbols: [...symbols].sort(),
  };
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
    const throughTs = value.throughTs;
    const lastId = value.lastId === null ? null : Number(value.lastId);
    if (
      !isValidUtcMillis(throughTs)
      || throughTs < expectedDayStart
      || throughTs - expectedDayStart >= ONE_DAY_MS
      || throughTs > now + 5 * 60_000
    ) return null;
    if (lastId !== null && (!Number.isSafeInteger(lastId) || lastId < 0)) return null;
    return { lastId, throughTs };
  } catch {
    return null;
  }
}

function parseFillCursorFloor(
  raw: string | null,
  expectedDayStart: number,
): number | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.dayStart !== expectedDayStart) return null;
    const lastId = value.lastId === null ? null : Number(value.lastId);
    if (
      !isValidUtcMillis(value.throughTs)
      || value.throughTs < expectedDayStart
      || value.throughTs - expectedDayStart >= ONE_DAY_MS
    ) return null;
    if (lastId !== null && (!Number.isSafeInteger(lastId) || lastId < 0)) return null;
    return value.throughTs;
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
  private balanceAssetStreamTombstones = new Map<string, {
    version: number;
    sourceTs: number;
  }>();
  private balanceFullSnapshotComplete = false;
  private balanceFullSnapshotSourceTs = 0;
  private balanceInvalidationGeneration = 0;
  private balanceStreamContinuityBroken = false;
  private balanceStreamContinuitySourceFloor: number | null = null;
  private lastSnapshotTs = 0;
  private clockHighWaterMs: number | null = null;
  private clockFailureReason: string | null = null;
  private clockRevision = 0;
  private requiredDurableClockHighWaterMs: number | null = null;
  private persistedGlobalClockHighWaterMs: number | null = null;
  private persistedRegistryClockHighWaterMs: number | null = null;
  private clockHighWaterLoadError: string | null = null;
  private clockHighWaterWriteError: string | null = null;
  private clockHighWaterRepairRequired = false;
  private faultPersistenceAttemptedFloor: number | null = null;
  private nullClientClockAdvanceFloorMs: number | null = null;
  private lastSyncClockRevision = -1;
  private lastFillReconcileClockRevision = -1;
  private configuredFillSymbols = new Set<string>();
  private durableFillSymbols = new Set<string>();
  private pendingFillSymbols = new Set<string>();
  private fillUniverseDayStart: number | null = null;
  private fillUniversePersistRequired = false;
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
  private pnlCache: AccountPnl = {
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
    private readonly priceOf: (symbol: string) => number | null,
    private readonly nowSource: () => number = Date.now,
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

  /**
   * The single account-service wall-clock seam. The high-water mark preserves
   * the last truthful UTC boundary, while an invalid or backward observation
   * is surfaced as unavailable instead of turning a negative age into fresh
   * account truth.
   */
  private readClock(): AccountClockReading {
    let observed: number;
    try {
      observed = this.nowSource();
    } catch {
      this.clockFailureReason = ACCOUNT_CLOCK_INVALID;
      this.persistClockHighWaterOnFault();
      return {
        nowMs: this.clockHighWaterMs,
        trustworthy: false,
        reason: this.clockFailureReason,
      };
    }
    if (!isValidUtcMillis(observed)) {
      this.clockFailureReason = ACCOUNT_CLOCK_INVALID;
      this.persistClockHighWaterOnFault();
      return {
        nowMs: this.clockHighWaterMs,
        trustworthy: false,
        reason: this.clockFailureReason,
      };
    }
    if (this.clockHighWaterMs !== null && observed < this.clockHighWaterMs) {
      this.clockFailureReason = ACCOUNT_CLOCK_REGRESSED;
      this.persistClockHighWaterOnFault();
      return {
        nowMs: this.clockHighWaterMs,
        trustworthy: false,
        reason: this.clockFailureReason,
      };
    }
    if (
      this.nullClientClockAdvanceFloorMs !== null
      && observed > this.nullClientClockAdvanceFloorMs
    ) {
      this.nullClientClockAdvanceFloorMs = null;
    }
    const recovered = this.clockFailureReason !== null;
    this.clockHighWaterMs = observed;
    this.clockFailureReason = null;
    if (recovered) {
      this.clockRevision += 1;
      this.pnlCacheDirty = true;
      if (this.clockHighWaterRepairRequired && this.fillUniverseDayStart !== null) {
        this.persistClockHighWaterCopies();
      }
    }
    return { nowMs: observed, trustworthy: true, reason: null };
  }

  private restoreFillSymbolUniverse(clock = this.readClock()): void {
    const persistedClockHighWater = this.ledger.getConfigValue(ACCOUNT_CLOCK_HIGH_WATER_KEY);
    if (persistedClockHighWater !== null) {
      try {
        this.persistedGlobalClockHighWaterMs = parseAccountClockHighWater(persistedClockHighWater);
      } catch (error) {
        this.clockHighWaterLoadError = errorMessage(error);
      }
    }
    const persisted = this.ledger.getConfigValue(FILL_SYMBOL_UNIVERSE_KEY);
    const restored = new Set<string>();
    let persistRequired = persisted === null;
    let persistedUniverse: ReturnType<typeof parseFillSymbolUniverse> | null = null;
    const observedDayStart =
      clock.trustworthy && clock.nowMs !== null
        ? utcDayStart(clock.nowMs)
        : null;
    let universeDayStart = observedDayStart;
    if (persisted !== null) {
      try {
        const parsed = parseFillSymbolUniverse(persisted);
        persistedUniverse = parsed;
        this.persistedRegistryClockHighWaterMs = parsed.clockHighWaterMs;
        if (observedDayStart === null || parsed.dayStart >= observedDayStart) {
          universeDayStart = parsed.dayStart;
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
    if (universeDayStart === null) {
      this.fillUniversePersistRequired ||= persistRequired;
      return;
    }
    this.fillUniverseDayStart = universeDayStart;

    // The fills table is also durable evidence. The indexed, bounded distinct
    // query repairs an older/interrupted registry without materializing the
    // lifetime fill ledger during service startup.
    if (this.mergeObservedFillSymbols(universeDayStart, restored)) persistRequired = true;
    for (const symbol of [...this.configuredFillSymbols, ...this.pendingFillSymbols]) {
      if (!restored.has(symbol) && restored.size >= FILL_SYMBOL_UNIVERSE_MAX) {
        this.fillUniverseCapacityError = `fill-symbol universe exceeds ${FILL_SYMBOL_UNIVERSE_MAX} symbols`;
        continue;
      }
      if (!restored.has(symbol)) persistRequired = true;
      restored.add(symbol);
    }
    this.durableFillSymbols = restored;
    this.pendingFillSymbols.clear();
    this.fillUniversePersistRequired ||= persistRequired;
    const registryFloor =
      Math.max(
        universeDayStart,
        this.persistedGlobalClockHighWaterMs ?? universeDayStart,
        persistedUniverse?.clockHighWaterMs ?? universeDayStart,
      );
    const clockUsable = this.adoptDurableClockFloor(
      universeDayStart,
      restored,
      registryFloor,
      clock,
    );
    const durableFloor = this.requiredDurableClockHighWaterMs;
    const hadDurableClockEvidence =
      persistedClockHighWater !== null
      || persisted !== null
      || (durableFloor !== null && durableFloor > universeDayStart);
    if (
      this.client === null
      && hadDurableClockEvidence
      && durableFloor !== null
      && (clock.nowMs === null || clock.nowMs <= durableFloor)
    ) {
      this.nullClientClockAdvanceFloorMs = Math.max(
        this.nullClientClockAdvanceFloorMs ?? 0,
        durableFloor,
      );
    }

    this.updateClockHighWaterRepairState();
    if (
      this.clockHighWaterLoadError === null
      && this.fillUniverseLoadError === null
      && (
        this.fillUniversePersistRequired
        || this.clockHighWaterRepairRequired
        || (clockUsable && this.clockFailureReason === null && persistedClockHighWater === null)
      )
    ) this.persistClockHighWaterCopies();
  }

  private mergeObservedFillSymbols(dayStart: number, target: Set<string>): boolean {
    let changed = false;
    const observed = this.ledger.distinctFillSymbolsBetween(
      dayStart,
      dayStart + ONE_DAY_MS,
      FILL_SYMBOL_UNIVERSE_MAX + 1,
    );
    if (observed.length > FILL_SYMBOL_UNIVERSE_MAX) {
      this.fillUniverseCapacityError = `fill-symbol universe exceeds ${FILL_SYMBOL_UNIVERSE_MAX} symbols`;
    }
    for (const symbol of observed.slice(0, FILL_SYMBOL_UNIVERSE_MAX)) {
      if (!USDT_SYMBOL_RE.test(symbol)) {
        this.fillUniverseLoadError ??= `ledger contains unsupported fill-reconciliation symbol: ${symbol}`;
        continue;
      }
      if (!target.has(symbol) && target.size >= FILL_SYMBOL_UNIVERSE_MAX) {
        this.fillUniverseCapacityError = `fill-symbol universe exceeds ${FILL_SYMBOL_UNIVERSE_MAX} symbols`;
        continue;
      }
      if (!target.has(symbol)) {
        target.add(symbol);
        changed = true;
      }
    }
    return changed;
  }

  private adoptDurableClockFloor(
    dayStart: number,
    symbols: Iterable<string>,
    initialFloor: number,
    clock: AccountClockReading,
  ): boolean {
    let durableClockFloor = initialFloor;
    for (const symbol of symbols) {
      const cursorFloor = parseFillCursorFloor(
        this.ledger.getConfigValue(`fill_reconcile:${symbol}`),
        dayStart,
      );
      if (cursorFloor !== null) durableClockFloor = Math.max(durableClockFloor, cursorFloor);
    }
    this.clockHighWaterMs = Math.max(this.clockHighWaterMs ?? 0, durableClockFloor);
    this.requiredDurableClockHighWaterMs = Math.max(
      this.requiredDurableClockHighWaterMs ?? 0,
      durableClockFloor,
    );
    this.updateClockHighWaterRepairState();
    if (!clock.trustworthy || clock.nowMs === null || clock.nowMs < durableClockFloor) {
      // Durable local evidence is stronger than an invalid or regressed
      // process clock. Keep current-day claims fenced until that exact floor.
      if (clock.trustworthy) this.clockFailureReason = ACCOUNT_CLOCK_REGRESSED;
      return false;
    }
    return true;
  }

  private ensureCurrentFillUniverse(clock = this.readClock()): boolean {
    if (!clock.trustworthy || clock.nowMs === null) return false;
    if (this.fillUniverseDayStart === null) {
      this.restoreFillSymbolUniverse(clock);
      return this.fillUniverseDayStart !== null && this.clockFailureReason === null;
    }
    const today = utcDayStart(clock.nowMs);
    if (today < this.fillUniverseDayStart) {
      this.clockHighWaterMs = Math.max(this.clockHighWaterMs ?? 0, this.fillUniverseDayStart);
      this.clockFailureReason = ACCOUNT_CLOCK_REGRESSED;
      return false;
    }
    if (today === this.fillUniverseDayStart) {
      if (this.fillUniversePersistRequired || this.clockHighWaterRepairRequired) {
        this.persistClockHighWaterCopies();
      }
      return true;
    }
    this.fillUniverseDayStart = today;
    this.durableFillSymbols = new Set(
      [...this.configuredFillSymbols, ...this.pendingFillSymbols].slice(0, FILL_SYMBOL_UNIVERSE_MAX),
    );
    this.pendingFillSymbols.clear();
    this.fillUniverseLoadError = null;
    this.fillUniverseWriteError = null;
    this.fillUniverseCapacityError = this.configuredFillSymbols.size > FILL_SYMBOL_UNIVERSE_MAX
      ? `fill-symbol universe exceeds ${FILL_SYMBOL_UNIVERSE_MAX} symbols`
      : null;
    this.mergeObservedFillSymbols(today, this.durableFillSymbols);
    this.lastFillReconcileScope = '';
    this.lastFillReconcileTs = null;
    this.lastFillReconcileClockRevision = -1;
    this.lastFillReconcileError = null;
    this.fillUniversePersistRequired = true;
    if (!this.adoptDurableClockFloor(today, this.durableFillSymbols, today, clock)) {
      return false;
    }
    this.persistClockHighWaterCopies();
    return true;
  }

  private persistFillSymbolUniverse(): void {
    if (
      this.fillUniverseDayStart === null
      || this.fillUniverseLoadError !== null
      || this.fillUniverseCapacityError !== null
    ) return;
    try {
      const clockHighWaterMs =
        this.clockHighWaterMs !== null
          ? Math.max(this.fillUniverseDayStart, this.clockHighWaterMs)
          : this.fillUniverseDayStart;
      this.ledger.setConfigValue(FILL_SYMBOL_UNIVERSE_KEY, JSON.stringify({
        version: 1,
        dayStart: this.fillUniverseDayStart,
        clockHighWaterMs,
        symbols: [...this.durableFillSymbols].sort(),
      }));
      this.persistedRegistryClockHighWaterMs = clockHighWaterMs;
      this.fillUniversePersistRequired = false;
      this.fillUniverseWriteError = null;
    } catch (error) {
      this.fillUniversePersistRequired = true;
      this.fillUniverseWriteError = `fill-symbol universe could not be persisted: ${errorMessage(error)}`;
    }
  }

  private persistAccountClockHighWater(): void {
    if (
      this.clockHighWaterMs === null
      || this.clockHighWaterLoadError !== null
    ) return;
    try {
      const clockHighWaterMs = Math.max(
        this.requiredDurableClockHighWaterMs ?? 0,
        this.clockHighWaterMs,
      );
      this.ledger.setConfigValue(ACCOUNT_CLOCK_HIGH_WATER_KEY, JSON.stringify({
        version: 1,
        clockHighWaterMs,
      }));
      this.persistedGlobalClockHighWaterMs = clockHighWaterMs;
      this.clockHighWaterWriteError = null;
    } catch (error) {
      this.clockHighWaterWriteError =
        `account clock high-water witness could not be persisted: ${errorMessage(error)}`;
    }
  }

  private updateClockHighWaterRepairState(): void {
    const required = this.requiredDurableClockHighWaterMs;
    const global = this.persistedGlobalClockHighWaterMs;
    const registry = this.persistedRegistryClockHighWaterMs;
    this.clockHighWaterRepairRequired =
      required !== null
      && (
        global === null
        || registry === null
        || global < required
        || registry < required
        || global !== registry
      );
  }

  private persistClockHighWaterCopies(): void {
    if (
      this.clockHighWaterLoadError !== null
      || this.fillUniverseLoadError !== null
      || this.clockHighWaterMs === null
      || this.fillUniverseDayStart === null
    ) {
      this.updateClockHighWaterRepairState();
      return;
    }
    const target = Math.max(
      this.requiredDurableClockHighWaterMs ?? 0,
      this.clockHighWaterMs,
      this.fillUniverseDayStart,
    );
    if (
      this.persistedGlobalClockHighWaterMs === null
      || this.persistedGlobalClockHighWaterMs < target
    ) {
      this.persistAccountClockHighWater();
    }
    if (
      this.fillUniversePersistRequired
      || this.persistedRegistryClockHighWaterMs === null
      || this.persistedRegistryClockHighWaterMs < target
    ) {
      this.persistFillSymbolUniverse();
    }
    this.updateClockHighWaterRepairState();
  }

  private clockHighWaterStatusError(): string | null {
    return (
      this.clockHighWaterLoadError
      ?? this.fillUniverseLoadError
      ?? this.clockHighWaterWriteError
      ?? this.fillUniverseWriteError
      ?? (this.clockHighWaterRepairRequired ? ACCOUNT_CLOCK_PERSISTENCE_DIVERGED : null)
    );
  }

  private persistClockHighWaterOnFault(): void {
    if (this.client === null && this.clockHighWaterMs !== null) {
      this.nullClientClockAdvanceFloorMs = Math.max(
        this.nullClientClockAdvanceFloorMs ?? 0,
        this.clockHighWaterMs,
      );
    }
    if (
      this.fillUniverseDayStart === null
      || this.clockHighWaterMs === null
    ) return;
    this.requiredDurableClockHighWaterMs = Math.max(
      this.requiredDurableClockHighWaterMs ?? 0,
      this.clockHighWaterMs,
    );
    this.updateClockHighWaterRepairState();
    if (
      !this.clockHighWaterRepairRequired
      || (
        this.faultPersistenceAttemptedFloor !== null
        && this.faultPersistenceAttemptedFloor >= this.clockHighWaterMs
      )
    ) return;
    this.faultPersistenceAttemptedFloor = this.clockHighWaterMs;
    // Independent writes are deliberate: either durable copy is sufficient
    // for restart to adopt the exact maximum, while divergence stays non-green
    // until the missing copy is repaired.
    this.persistClockHighWaterCopies();
  }

  private rememberFillSymbols(symbols: Iterable<string>): void {
    const candidates = new Set(symbols);
    const clock = this.readClock();
    if (!this.ensureCurrentFillUniverse(clock)) {
      for (const symbol of candidates) this.pendingFillSymbols.add(symbol);
      return;
    }
    const symbolsToRemember = [...this.pendingFillSymbols, ...candidates];
    if (
      this.fillUniverseDayStart === null
      || !this.adoptDurableClockFloor(
        this.fillUniverseDayStart,
        symbolsToRemember,
        this.fillUniverseDayStart,
        clock,
      )
    ) {
      for (const symbol of symbolsToRemember) this.pendingFillSymbols.add(symbol);
      return;
    }
    let changed = false;
    for (const symbol of symbolsToRemember) {
      if (this.durableFillSymbols.has(symbol)) continue;
      if (this.durableFillSymbols.size >= FILL_SYMBOL_UNIVERSE_MAX) {
        this.fillUniverseCapacityError = `fill-symbol universe exceeds ${FILL_SYMBOL_UNIVERSE_MAX} symbols`;
        continue;
      }
      this.durableFillSymbols.add(symbol);
      changed = true;
    }
    this.pendingFillSymbols.clear();
    if (changed) this.fillUniversePersistRequired = true;
    if (this.fillUniversePersistRequired || this.fillUniverseWriteError !== null) {
      this.persistClockHighWaterCopies();
    }
  }

  private fillSymbols(clock = this.readClock()): string[] {
    this.ensureCurrentFillUniverse(clock);
    return [...new Set([
      ...this.configuredFillSymbols,
      ...this.durableFillSymbols,
      ...this.pendingFillSymbols,
    ])].sort();
  }

  private fillScopeError(symbols: string[]): string | null {
    const clockHighWaterError = this.clockHighWaterStatusError();
    if (clockHighWaterError) return clockHighWaterError;
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
    return this.fillReconciliationStatusAt(this.readClock());
  }

  private fillReconciliationStatusAt(clock: AccountClockReading): FillReconciliationStatus {
    if (!this.client) {
      const clockStatusError =
        this.clockHighWaterStatusError()
        ?? (
          this.nullClientClockAdvanceFloorMs !== null
            ? ACCOUNT_CLOCK_ADVANCE_REQUIRED
            : null
        );
      if (!clock.trustworthy || clockStatusError !== null) {
        return {
          complete: false,
          scopeComplete: false,
          fresh: false,
          reconciledAt: null,
          dayStart: null,
          symbols: [],
          coverageScope: 'not_applicable',
          accountWide: null,
          limitation: null,
          error: clock.reason ?? clockStatusError ?? ACCOUNT_CLOCK_INVALID,
        };
      }
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
    const symbols = this.fillSymbols(clock);
    const scope = symbols.join(',');
    const age =
      !clock.trustworthy || clock.nowMs === null || this.lastFillReconcileTs === null
        ? Number.POSITIVE_INFINITY
        : clock.nowMs - this.lastFillReconcileTs;
    const scopeError = this.fillScopeError(symbols);
    const clockReason = clock.reason ?? this.clockFailureReason;
    const scopeComplete =
      clock.trustworthy &&
      this.clockFailureReason === null &&
      scopeError === null &&
      this.lastFillReconcileError === null &&
      this.lastFillReconcileScope === scope &&
      this.lastFillReconcileClockRevision === this.clockRevision &&
      Number.isFinite(age) &&
      age >= 0 &&
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
      error:
        clockReason
        ?? scopeError
        ?? this.lastFillReconcileError
        ?? (scopeComplete ? null : 'fill reconciliation is stale or has not completed'),
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
    const startedClock = this.readClock();
    const symbols = this.fillSymbols(startedClock);
    const scope = symbols.join(',');
    if (!startedClock.trustworthy || startedClock.nowMs === null) {
      this.lastFillReconcileError = startedClock.reason ?? ACCOUNT_CLOCK_INVALID;
      return this.fillReconciliationStatus();
    }
    const startedAt = startedClock.nowMs;
    const startedClockRevision = this.clockRevision;
    const dayStart = utcDayStart(startedAt);
    const scopeError = this.fillScopeError(symbols);
    if (scopeError) {
      this.lastFillReconcileError = scopeError;
      return this.fillReconciliationStatus();
    }
    let imported = 0;
    const cursorUpdates = new Map<string, { lastId: number | null }>();
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
            const invalid = validateFill(fill, startedAt);
            if (invalid) throw new Error(`Binance returned invalid trade history for ${symbol}: ${invalid}`);
            if (this.recordValidatedFill(fill)) imported += 1;
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
        cursorUpdates.set(key, { lastId });
      }
      const completedClock = this.readClock();
      if (!completedClock.trustworthy || completedClock.nowMs === null) {
        throw new Error(completedClock.reason ?? ACCOUNT_CLOCK_INVALID);
      }
      const completedScopeError = this.fillScopeError(symbols);
      if (completedScopeError !== null) throw new Error(completedScopeError);
      if (this.clockRevision !== startedClockRevision) {
        throw new Error('account clock recovered during fill reconciliation; a new pass is required');
      }
      if (utcDayStart(completedClock.nowMs) !== dayStart) {
        throw new Error('account clock crossed the UTC-day boundary during fill reconciliation');
      }
      for (const [key, cursor] of cursorUpdates) {
        this.ledger.setConfigValue(
          key,
          JSON.stringify({ dayStart, lastId: cursor.lastId, throughTs: startedAt }),
        );
      }
      this.lastFillReconcileScope = scope;
      this.lastFillReconcileTs = startedAt;
      this.lastFillReconcileClockRevision = this.clockRevision;
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
    try {
      const startedClock = this.readClock();
      if (!startedClock.trustworthy || startedClock.nowMs === null) {
        throw new Error(startedClock.reason ?? ACCOUNT_CLOCK_INVALID);
      }
      const startedClockStatusError = this.clockHighWaterStatusError();
      if (startedClockStatusError !== null) throw new Error(startedClockStatusError);
      const startedClockRevision = this.clockRevision;
      const balanceVersionAtRequest = this.balanceMutationVersion;
      const balanceSourceTsAtRequest = this.balanceSourceTs;
      const balanceInvalidationAtRequest = this.balanceInvalidationGeneration;
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
      // read-only key. Stage the KEY-level flags from apiRestrictions so neither
      // posture nor balances can publish before the completion clock cut.
      let nextKeyRestrictions: ApiRestrictions | null = null;
      try {
        nextKeyRestrictions = await this.client.apiRestrictions();
      } catch {
        // Account-level flags describe the Binance account, not this API key.
        // Treat a failed per-key posture lookup as unknown rather than
        // claiming that withdrawals or trading are either enabled or disabled.
      }
      const sourceTs = Number((acct as { updateTime?: unknown }).updateTime);
      const hasSourceTs = isValidUtcMillis(sourceTs) && sourceTs > 0;
      const completedClock = this.readClock();
      if (!completedClock.trustworthy || completedClock.nowMs === null) {
        throw new Error(completedClock.reason ?? ACCOUNT_CLOCK_INVALID);
      }
      const completedClockStatusError = this.clockHighWaterStatusError();
      if (completedClockStatusError !== null) throw new Error(completedClockStatusError);
      if (this.clockRevision !== startedClockRevision) {
        throw new Error('account clock recovered during account sync; a new sync is required');
      }
      if (this.balanceInvalidationGeneration !== balanceInvalidationAtRequest) {
        this.safeLog('error_event', null, {
          source: 'account.sync',
          message: 'account balance observation was invalidated during account sync',
        });
        return;
      }
      if (sourceTs > completedClock.nowMs) {
        throw new Error('Binance account payload has a future update timestamp');
      }
      const belowStreamContinuityFloor =
        this.balanceStreamContinuitySourceFloor !== null
        && (!hasSourceTs || sourceTs < this.balanceStreamContinuitySourceFloor);
      if (belowStreamContinuityFloor) return;
      const olderThanFullSnapshot =
        hasSourceTs && sourceTs < this.balanceFullSnapshotSourceTs;
      const missingSourceAfterNewerStream =
        !hasSourceTs
        && balanceSourceTsAtRequest > this.balanceFullSnapshotSourceTs;
      if (olderThanFullSnapshot || missingSourceAfterNewerStream) return;
      // outboundAccountPosition is partial. A full REST snapshot may repair
      // every asset except those with newer stream evidence, or equal stream
      // evidence observed during this request.
      const assets = new Set([...this.balances.keys(), ...nextBalances.keys()]);
      for (const asset of assets) {
        const streamTombstone = this.balanceAssetStreamTombstones.get(asset);
        const streamWins =
          streamTombstone !== undefined
          && (
            hasSourceTs
              ? (
                streamTombstone.sourceTs > sourceTs
                || (
                  streamTombstone.sourceTs === sourceTs
                  && streamTombstone.version > balanceVersionAtRequest
                )
              )
              : streamTombstone.version > balanceVersionAtRequest
          );
        if (streamWins) continue;
        const balance = nextBalances.get(asset);
        if (balance) this.balances.set(asset, balance);
        else this.balances.delete(asset);
      }
      const streamArrivedDuringRequest =
        this.balanceMutationVersion !== balanceVersionAtRequest;
      if (hasSourceTs || !streamArrivedDuringRequest) {
        this.balanceFullSnapshotComplete = true;
        this.balanceStreamContinuityBroken = false;
        this.balanceStreamContinuitySourceFloor = null;
      }
      if (hasSourceTs) {
        this.balanceSourceTs = Math.max(this.balanceSourceTs, sourceTs);
      }
      this.balanceMutationVersion += 1;
      if (hasSourceTs) this.balanceFullSnapshotSourceTs = sourceTs;
      this.keyRestrictions = nextKeyRestrictions;
      this.canWithdraw = nextKeyRestrictions?.enableWithdrawals ?? null;
      this.canTrade = nextKeyRestrictions?.enableSpotAndMarginTrading ?? null;
      const wasConnected = this.connected;
      this.connected = true;
      this.lastSyncTs = completedClock.nowMs;
      this.lastSyncClockRevision = this.clockRevision;
      this.lastRestrictionsTs =
        nextKeyRestrictions !== null
          ? completedClock.nowMs
          : null;
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
      this.maybeSnapshot(completedClock);
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

  private invalidateBalanceStreamContinuity(sourceFloor: number | null = null): void {
    this.balanceInvalidationGeneration += 1;
    this.balanceStreamContinuityBroken = true;
    if (sourceFloor !== null) {
      this.balanceStreamContinuitySourceFloor =
        this.balanceStreamContinuitySourceFloor === null
          ? sourceFloor
          : Math.max(this.balanceStreamContinuitySourceFloor, sourceFloor);
    }
    this.balanceFullSnapshotComplete = false;
    this.lastSyncTs = null;
    this.lastSyncClockRevision = -1;
  }

  /** Balance updates pushed by the user data stream. */
  applyStreamBalances(list: { a: string; f: string; l: string }[], updateTime: number): void {
    if (!isValidUtcMillis(updateTime) || updateTime <= 0) {
      this.invalidateBalanceStreamContinuity();
      this.safeLog('error_event', null, { source: 'account.stream', message: 'invalid balance update timestamp' });
      return;
    }
    if (updateTime < this.balanceSourceTs) return;
    const receivedClock = this.readClock();
    if (!receivedClock.trustworthy || receivedClock.nowMs === null) {
      const sourceFloor =
        receivedClock.nowMs !== null && updateTime <= receivedClock.nowMs
          ? updateTime
          : null;
      this.invalidateBalanceStreamContinuity(sourceFloor);
      this.safeLog('error_event', null, {
        source: 'account.stream',
        message: receivedClock.reason ?? ACCOUNT_CLOCK_INVALID,
      });
      return;
    }
    if (updateTime > receivedClock.nowMs) {
      this.invalidateBalanceStreamContinuity();
      this.safeLog('error_event', null, {
        source: 'account.stream',
        message: 'balance update timestamp is in the future',
      });
      return;
    }
    if (!Array.isArray(list)) {
      this.invalidateBalanceStreamContinuity(updateTime);
      this.safeLog('error_event', null, { source: 'account.stream', message: 'invalid balance update payload' });
      return;
    }
    const updates: { asset: string; free: number; locked: number }[] = [];
    for (const b of list) {
      if (!b || !boundedBinanceIdentifier(b.a, 20, 80)) {
        this.invalidateBalanceStreamContinuity(updateTime);
        this.safeLog('error_event', null, { source: 'account.stream', message: 'invalid balance update asset' });
        return;
      }
      const free = Number(b.f);
      const locked = Number(b.l);
      if (!finiteNonNegative(free) || !finiteNonNegative(locked)) {
        this.invalidateBalanceStreamContinuity(updateTime);
        this.safeLog('error_event', b.a, { source: 'account.stream', message: 'invalid balance update amount' });
        return;
      }
      updates.push({ asset: b.a, free, locked });
    }
    if (
      this.balanceStreamContinuityBroken
      && this.balanceStreamContinuitySourceFloor === null
    ) {
      this.balanceStreamContinuitySourceFloor = updateTime;
    }
    const streamMutationVersion = this.balanceMutationVersion + 1;
    for (const b of updates) {
      if (b.free > 0 || b.locked > 0) this.balances.set(b.asset, { free: b.free, locked: b.locked });
      else this.balances.delete(b.asset);
      this.balanceAssetStreamTombstones.set(b.asset, {
        version: streamMutationVersion,
        sourceTs: updateTime,
      });
    }
    this.balanceSourceTs = updateTime;
    this.balanceMutationVersion = streamMutationVersion;
    this.lastSyncTs = receivedClock.nowMs;
    this.lastSyncClockRevision = this.clockRevision;
  }

  recordFill(fill: FillInput): boolean {
    const clock = this.readClock();
    const invalid =
      clock.nowMs === null
        ? clock.reason ?? ACCOUNT_CLOCK_INVALID
        : validateFill(fill, clock.nowMs);
    if (invalid) {
      this.safeLog('error_event', /^[A-Z0-9]{4,20}$/.test(fill.symbol) ? fill.symbol : null, {
        source: 'account.fill',
        message: `fill rejected: ${invalid}`,
      });
      return false;
    }
    return this.recordValidatedFill(fill);
  }

  private recordValidatedFill(fill: FillInput): boolean {
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
    return this.equityAt(this.readClock());
  }

  private equityAt(clock: AccountClockReading): {
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
    const sourceAge =
      !clock.trustworthy || clock.nowMs === null || this.lastSyncTs === null
        ? Number.POSITIVE_INFINITY
        : clock.nowMs - this.lastSyncTs;
    const sourceFresh =
      clock.trustworthy
      && this.clockHighWaterStatusError() === null
      && this.balanceFullSnapshotComplete
      && this.connected
      && this.lastSyncClockRevision === this.clockRevision
      && Number.isFinite(sourceAge)
      && sourceAge >= 0
      && sourceAge <= 60_000;
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
  pnl(): AccountPnl {
    return this.pnlAt(this.readClock());
  }

  private pnlAt(clock: AccountClockReading): AccountPnl {
    if (!this.pnlCacheDirty) return this.pnlCache;
    const validationNowMs = clock.nowMs;
    const fallbackDay = validationNowMs === null ? 'unknown' : fillDay(validationNowMs) ?? 'unknown';
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
      const day = fillDay(f.ts) ?? fallbackDay;
      const invalid = validateFill(f, validationNowMs);
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
      let economics: FillEconomicDeltas;
      try {
        economics = fillEconomicDeltas(f, base);
      } catch (error) {
        markIncomplete(day, `invalid fill economics for ${f.symbol}: ${errorMessage(error)}`);
        positionsExact.set(base, pos);
        continue;
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
        pos.qty = addExactDecimals(pos.qty, economics.inventoryQty);
        pos.totalCost = addExactDecimals(pos.totalCost, economics.inventoryQuoteAmount);
      } else {
        if (pos.legacyTainted) {
          markIncomplete(day, `cost basis depends on legacy binary64 fill for ${f.symbol}`);
        }
        const matched = minimumExactDecimal(economics.inventoryQty, pos.qty);
        let matchedCost: ExactDecimal = EXACT_ZERO;
        if (compareExactDecimals(matched, EXACT_ZERO) > 0) {
          matchedCost = compareExactDecimals(matched, pos.qty) === 0
            ? pos.totalCost
            : divideExactDecimals(multiplyExactDecimals(pos.totalCost, matched), pos.qty, 24);
          const matchedProceeds = compareExactDecimals(matched, economics.inventoryQty) === 0
            ? economics.inventoryQuoteAmount
            : divideExactDecimals(
              multiplyExactDecimals(economics.inventoryQuoteAmount, matched),
              economics.inventoryQty,
              24,
            );
          const gain = subtractExactDecimals(matchedProceeds, matchedCost);
          exactMapAdd(realizedByDayExact, day, gain);
          exactMapAdd(realizedBySymbolExact, f.symbol, gain);
        }
        if (compareExactDecimals(matched, economics.inventoryQty) < 0) {
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
    const clock = this.readClock();
    const day = clock.nowMs === null ? null : fillDay(clock.nowMs);
    if (!clock.trustworthy || day === null) return Number.NaN;
    return this.pnlAt(clock).realizedByDay.get(day) ?? 0;
  }

  /**
   * Conservative daily-loss input for the live risk gate. Realized PnL remains
   * a separate truthful UI number; policy PnL additionally deducts every fee
   * that can be valued in USDT and fails closed when sell cost basis or a fee
   * valuation is unavailable.
   */
  dailyLossPolicy(): { valueUsd: number; complete: boolean; reasons: string[] } {
    const clock = this.readClock();
    const day = clock.nowMs === null ? null : fillDay(clock.nowMs);
    const pnl = this.pnlAt(clock);
    const valueUsd = exactNumber(day === null ? EXACT_ZERO : this.pnlDailyPolicyExact.get(day) ?? EXACT_ZERO);
    const reasons = day === null ? [] : [...(pnl.incompleteByDay.get(day) ?? [])];
    if (!clock.trustworthy) reasons.push(clock.reason ?? ACCOUNT_CLOCK_INVALID);
    const coverage = this.fillReconciliationStatusAt(clock);
    if (!coverage.scopeComplete) {
      const reason = coverage.error ?? 'configured and observed fill reconciliation is incomplete';
      if (!reasons.includes(reason)) reasons.push(reason);
    } else if (coverage.accountWide === false) {
      const reason = coverage.limitation ?? SCOPED_FILL_LIMITATION;
      if (!reasons.includes(reason)) reasons.push(reason);
    }
    return { valueUsd, complete: reasons.length === 0 && finite(valueUsd), reasons };
  }

  /** Equity at the first snapshot of the current UTC day (for the day-change card). */
  dayOpenEquity(): number | null {
    const clock = this.readClock();
    if (!clock.trustworthy || clock.nowMs === null) return null;
    const ev = this.firstCompleteSnapshotSince(utcDayStart(clock.nowMs));
    const data = ev?.data as { totalUsdt?: number } | null;
    return finite(data?.totalUsdt ?? Number.NaN) ? data!.totalUsdt! : null;
  }

  private maybeSnapshot(clock: AccountClockReading): void {
    if (!clock.trustworthy || clock.nowMs === null) return;
    const now = clock.nowMs;
    const eq = this.equityAt(clock);
    const hasDailyComplete = this.firstCompleteSnapshotSince(utcDayStart(now)) !== null;
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

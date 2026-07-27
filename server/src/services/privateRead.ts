import type { ApiRestrictions } from '../binance/client.js';

export type PrivateReadState = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
export type CoverageState =
  | 'COMPLETE_CURRENT'
  | 'PARTIAL_SYMBOL_SCOPED'
  | 'UNAVAILABLE'
  | 'NOT_CONFIGURED';
export type ReconciliationState = 'RECONCILED' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_CONFIGURED';

export interface PrivateReadGateway {
  apiRestrictions(): Promise<ApiRestrictions>;
  spotAccount(): Promise<unknown>;
  spotOpenOrders(): Promise<unknown>;
  spotTrades(symbol: string): Promise<unknown>;
  marginAccount(): Promise<unknown>;
  marginOpenOrders(): Promise<unknown>;
  marginTrades(symbol: string): Promise<unknown>;
  usdmBalances(): Promise<unknown>;
  usdmPositions(): Promise<unknown>;
  usdmOpenOrders(): Promise<unknown>;
  usdmTrades(symbol: string): Promise<unknown>;
}

export interface PrivateReadPermissionPosture {
  state: 'VERIFIED_READ_ONLY' | 'UNSAFE' | 'UNKNOWN' | 'NOT_CONFIGURED';
  observedAt: number | null;
  keyLabel: string;
  keyLast4: string | null;
  reading: boolean | null;
  spotMarginTrading: boolean | null;
  margin: boolean | null;
  futures: boolean | null;
  withdrawals: boolean | null;
  internalTransfer: boolean | null;
  universalTransfer: boolean | null;
  ipRestricted: boolean | null;
  fixTrade: boolean | null;
  portfolioMarginTrading: boolean | null;
}

export interface PrivateReadCoverage {
  state: CoverageState;
  symbols: string[];
  limitation: string | null;
}

export interface SpotBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface SpotOrder {
  symbol: string;
  orderId: string;
  side: string;
  type: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  time: number;
}

export interface SpotFill {
  symbol: string;
  id: string;
  orderId: string;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
}

export interface MarginAsset {
  asset: string;
  free: string;
  locked: string;
  borrowed: string;
  interest: string;
  netAsset: string;
}

export interface UsdmBalance {
  asset: string;
  balance: string;
  availableBalance: string;
  crossWalletBalance: string;
  crossUnPnl: string;
}

export interface UsdmPosition {
  symbol: string;
  positionSide: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  marginType: string;
  isolatedMargin: string;
  notional: string;
  updateTime: number;
}

export interface UsdmOrder {
  symbol: string;
  orderId: string;
  side: string;
  positionSide: string;
  type: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  time: number;
  updateTime: number;
  reduceOnly: boolean;
}

export interface UsdmFill {
  symbol: string;
  id: string;
  orderId: string;
  side: string;
  positionSide: string;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  realizedPnl: string;
  time: number;
  buyer: boolean;
  maker: boolean;
}

export interface PrivateReadSnapshot {
  schemaVersion: 'binance.private-read.v1';
  state: PrivateReadState;
  observedAt: number | null;
  permissionPosture: PrivateReadPermissionPosture;
  spot: {
    state: PrivateReadState;
    observedAt: number | null;
    balances: SpotBalance[] | null;
    openOrders: SpotOrder[] | null;
    fills: SpotFill[] | null;
    coverage: PrivateReadCoverage;
  };
  margin: {
    state: PrivateReadState;
    observedAt: number | null;
    totalAssetBtc: string | null;
    totalLiabilityBtc: string | null;
    totalNetAssetBtc: string | null;
    assets: MarginAsset[] | null;
    openOrders: SpotOrder[] | null;
    fills: SpotFill[] | null;
    coverage: PrivateReadCoverage;
  };
  usdm: {
    state: PrivateReadState;
    observedAt: number | null;
    balances: UsdmBalance[] | null;
    positions: UsdmPosition[] | null;
    openOrders: UsdmOrder[] | null;
    fills: UsdmFill[] | null;
    coverage: PrivateReadCoverage;
  };
  reconciliation: Record<
    'balances' | 'orders' | 'fills' | 'positions' | 'liabilities',
    { state: ReconciliationState; observedAt: number | null; reason: string | null }
  >;
}

export interface PrivateReadServiceOptions {
  now?: () => number;
  refreshIntervalMs?: number;
  symbols?: readonly string[];
  keyLabel?: string;
  keyLast4?: string | null;
}

const SYMBOL_RE = /^[A-Z0-9]{5,30}$/;
const TOKEN_RE = /^[A-Za-z0-9_./:-]{1,64}$/;
const DECIMAL_RE = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const MAX_ROWS = 5_000;
const MAX_SYMBOLS = 16;
const DEFAULT_KEY_LABEL = 'Binance Read Only';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} is malformed`);
  return value;
}

function rows(value: unknown, label: string, maximum = MAX_ROWS): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} is malformed`);
  }
  return value;
}

function token(value: unknown, label: string): string {
  if (typeof value !== 'string' || !TOKEN_RE.test(value)) {
    throw new TypeError(`${label} is malformed`);
  }
  return value;
}

function symbol(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SYMBOL_RE.test(value)) {
    throw new TypeError(`${label} is malformed`);
  }
  return value;
}

function decimal(value: unknown, label: string): string {
  if (typeof value !== 'string' || !DECIMAL_RE.test(value)) {
    throw new TypeError(`${label} is malformed`);
  }
  return value;
}

function integerId(value: unknown, label: string): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)) return value;
  throw new TypeError(`${label} is malformed`);
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} is malformed`);
  }
  return value;
}

function exactBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} is malformed`);
  return value;
}

function safeKeyLabel(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_KEY_LABEL;
  const label = value.trim();
  if (label.length === 0
    || label.length > 48
    || (!label.includes(' ') && label.length > 16)
    || !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(label)
    || /(?:secret|signature|https?:|[?&=])/i.test(label)) {
    return DEFAULT_KEY_LABEL;
  }
  return label;
}

function normalizeRestrictions(value: unknown): ApiRestrictions {
  const row = record(value, 'API restrictions');
  return {
    ipRestrict: exactBoolean(row.ipRestrict, 'API restrictions ipRestrict'),
    enableReading: exactBoolean(row.enableReading, 'API restrictions enableReading'),
    enableWithdrawals: exactBoolean(row.enableWithdrawals, 'API restrictions enableWithdrawals'),
    enableInternalTransfer: exactBoolean(row.enableInternalTransfer, 'API restrictions enableInternalTransfer'),
    enableMargin: exactBoolean(row.enableMargin, 'API restrictions enableMargin'),
    enableSpotAndMarginTrading: exactBoolean(
      row.enableSpotAndMarginTrading,
      'API restrictions enableSpotAndMarginTrading',
    ),
    enableFutures: exactBoolean(row.enableFutures, 'API restrictions enableFutures'),
    permitsUniversalTransfer: exactBoolean(
      row.permitsUniversalTransfer,
      'API restrictions permitsUniversalTransfer',
    ),
    enableVanillaOptions: exactBoolean(row.enableVanillaOptions, 'API restrictions enableVanillaOptions'),
    enableFixApiTrade: exactBoolean(row.enableFixApiTrade, 'API restrictions enableFixApiTrade'),
    enableFixReadOnly: row.enableFixReadOnly === undefined
      ? undefined
      : exactBoolean(row.enableFixReadOnly, 'API restrictions enableFixReadOnly'),
    enablePortfolioMarginTrading: exactBoolean(
      row.enablePortfolioMarginTrading,
      'API restrictions enablePortfolioMarginTrading',
    ),
    createTime: row.createTime === undefined
      ? undefined
      : timestamp(row.createTime, 'API restrictions createTime'),
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function normalizeSpotBalances(value: unknown): SpotBalance[] {
  const account = record(value, 'Spot account');
  return rows(account.balances, 'Spot balances').map((entry, index) => {
    const row = record(entry, `Spot balance ${index}`);
    return {
      asset: token(row.asset, `Spot balance ${index} asset`),
      free: decimal(row.free, `Spot balance ${index} free`),
      locked: decimal(row.locked, `Spot balance ${index} locked`),
    };
  });
}

function normalizeSpotOrders(value: unknown, label: string): SpotOrder[] {
  return rows(value, label).map((entry, index) => {
    const row = record(entry, `${label} ${index}`);
    return {
      symbol: symbol(row.symbol, `${label} ${index} symbol`),
      orderId: integerId(row.orderId, `${label} ${index} orderId`),
      side: token(row.side, `${label} ${index} side`),
      type: token(row.type, `${label} ${index} type`),
      price: decimal(row.price, `${label} ${index} price`),
      origQty: decimal(row.origQty, `${label} ${index} origQty`),
      executedQty: decimal(row.executedQty, `${label} ${index} executedQty`),
      status: token(row.status, `${label} ${index} status`),
      time: timestamp(row.time, `${label} ${index} time`),
    };
  });
}

function normalizeSpotFills(value: unknown, label: string): SpotFill[] {
  return rows(value, label, 1_000).map((entry, index) => {
    const row = record(entry, `${label} ${index}`);
    return {
      symbol: symbol(row.symbol, `${label} ${index} symbol`),
      id: integerId(row.id, `${label} ${index} id`),
      orderId: integerId(row.orderId, `${label} ${index} orderId`),
      price: decimal(row.price, `${label} ${index} price`),
      qty: decimal(row.qty, `${label} ${index} qty`),
      quoteQty: decimal(row.quoteQty, `${label} ${index} quoteQty`),
      commission: decimal(row.commission, `${label} ${index} commission`),
      commissionAsset: token(row.commissionAsset, `${label} ${index} commissionAsset`),
      time: timestamp(row.time, `${label} ${index} time`),
      isBuyer: exactBoolean(row.isBuyer, `${label} ${index} isBuyer`),
    };
  });
}

function normalizeMarginAccount(value: unknown): {
  totalAssetBtc: string;
  totalLiabilityBtc: string;
  totalNetAssetBtc: string;
  assets: MarginAsset[];
} {
  const account = record(value, 'Margin account');
  const assets = rows(account.userAssets, 'Margin assets').map((entry, index) => {
    const row = record(entry, `Margin asset ${index}`);
    return {
      asset: token(row.asset, `Margin asset ${index} asset`),
      free: decimal(row.free, `Margin asset ${index} free`),
      locked: decimal(row.locked, `Margin asset ${index} locked`),
      borrowed: decimal(row.borrowed, `Margin asset ${index} borrowed`),
      interest: decimal(row.interest, `Margin asset ${index} interest`),
      netAsset: decimal(row.netAsset, `Margin asset ${index} netAsset`),
    };
  });
  return {
    totalAssetBtc: decimal(account.totalAssetOfBtc, 'Margin total asset BTC'),
    totalLiabilityBtc: decimal(account.totalLiabilityOfBtc, 'Margin total liability BTC'),
    totalNetAssetBtc: decimal(account.totalNetAssetOfBtc, 'Margin total net asset BTC'),
    assets,
  };
}

function normalizeUsdmBalances(value: unknown): UsdmBalance[] {
  return rows(value, 'USD-M balances').map((entry, index) => {
    const row = record(entry, `USD-M balance ${index}`);
    return {
      asset: token(row.asset, `USD-M balance ${index} asset`),
      balance: decimal(row.balance, `USD-M balance ${index} balance`),
      availableBalance: decimal(row.availableBalance, `USD-M balance ${index} availableBalance`),
      crossWalletBalance: decimal(row.crossWalletBalance, `USD-M balance ${index} crossWalletBalance`),
      crossUnPnl: decimal(row.crossUnPnl, `USD-M balance ${index} crossUnPnl`),
    };
  });
}

function normalizeUsdmPositions(value: unknown): UsdmPosition[] {
  return rows(value, 'USD-M positions').map((entry, index) => {
    const row = record(entry, `USD-M position ${index}`);
    return {
      symbol: symbol(row.symbol, `USD-M position ${index} symbol`),
      positionSide: token(row.positionSide, `USD-M position ${index} positionSide`),
      positionAmt: decimal(row.positionAmt, `USD-M position ${index} positionAmt`),
      entryPrice: decimal(row.entryPrice, `USD-M position ${index} entryPrice`),
      markPrice: decimal(row.markPrice, `USD-M position ${index} markPrice`),
      unRealizedProfit: decimal(row.unRealizedProfit, `USD-M position ${index} unRealizedProfit`),
      liquidationPrice: decimal(row.liquidationPrice, `USD-M position ${index} liquidationPrice`),
      leverage: decimal(row.leverage, `USD-M position ${index} leverage`),
      marginType: token(row.marginType, `USD-M position ${index} marginType`),
      isolatedMargin: decimal(row.isolatedMargin, `USD-M position ${index} isolatedMargin`),
      notional: decimal(row.notional, `USD-M position ${index} notional`),
      updateTime: timestamp(row.updateTime, `USD-M position ${index} updateTime`),
    };
  });
}

function normalizeUsdmOrders(value: unknown): UsdmOrder[] {
  return rows(value, 'USD-M open orders').map((entry, index) => {
    const row = record(entry, `USD-M open order ${index}`);
    return {
      symbol: symbol(row.symbol, `USD-M open order ${index} symbol`),
      orderId: integerId(row.orderId, `USD-M open order ${index} orderId`),
      side: token(row.side, `USD-M open order ${index} side`),
      positionSide: token(row.positionSide, `USD-M open order ${index} positionSide`),
      type: token(row.type, `USD-M open order ${index} type`),
      price: decimal(row.price, `USD-M open order ${index} price`),
      origQty: decimal(row.origQty, `USD-M open order ${index} origQty`),
      executedQty: decimal(row.executedQty, `USD-M open order ${index} executedQty`),
      status: token(row.status, `USD-M open order ${index} status`),
      time: timestamp(row.time, `USD-M open order ${index} time`),
      updateTime: timestamp(row.updateTime, `USD-M open order ${index} updateTime`),
      reduceOnly: exactBoolean(row.reduceOnly, `USD-M open order ${index} reduceOnly`),
    };
  });
}

function normalizeUsdmFills(value: unknown): UsdmFill[] {
  return rows(value, 'USD-M fills', 1_000).map((entry, index) => {
    const row = record(entry, `USD-M fill ${index}`);
    return {
      symbol: symbol(row.symbol, `USD-M fill ${index} symbol`),
      id: integerId(row.id, `USD-M fill ${index} id`),
      orderId: integerId(row.orderId, `USD-M fill ${index} orderId`),
      side: token(row.side, `USD-M fill ${index} side`),
      positionSide: token(row.positionSide, `USD-M fill ${index} positionSide`),
      price: decimal(row.price, `USD-M fill ${index} price`),
      qty: decimal(row.qty, `USD-M fill ${index} qty`),
      quoteQty: decimal(row.quoteQty, `USD-M fill ${index} quoteQty`),
      commission: decimal(row.commission, `USD-M fill ${index} commission`),
      commissionAsset: token(row.commissionAsset, `USD-M fill ${index} commissionAsset`),
      realizedPnl: decimal(row.realizedPnl, `USD-M fill ${index} realizedPnl`),
      time: timestamp(row.time, `USD-M fill ${index} time`),
      buyer: exactBoolean(row.buyer, `USD-M fill ${index} buyer`),
      maker: exactBoolean(row.maker, `USD-M fill ${index} maker`),
    };
  });
}

function configuredCoverage(): PrivateReadCoverage {
  return { state: 'UNAVAILABLE', symbols: [], limitation: 'No successful symbol-scoped history read.' };
}

function unconfiguredCoverage(): PrivateReadCoverage {
  return { state: 'NOT_CONFIGURED', symbols: [], limitation: 'Private Binance credentials are not configured.' };
}

function initialSnapshot(
  configured: boolean,
  keyLabel: string,
  keyLast4: string | null,
): PrivateReadSnapshot {
  const state = configured ? 'UNAVAILABLE' : 'NOT_CONFIGURED';
  const coverage = configuredCoverage();
  const reconciliationState = configured ? 'UNAVAILABLE' : 'NOT_CONFIGURED';
  const reason = configured ? 'No successful private read has completed.' : 'Private Binance credentials are not configured.';
  return deepFreeze<PrivateReadSnapshot>({
    schemaVersion: 'binance.private-read.v1',
    state,
    observedAt: null,
    permissionPosture: {
      state: configured ? 'UNKNOWN' : 'NOT_CONFIGURED',
      observedAt: null,
      keyLabel,
      keyLast4,
      reading: null,
      spotMarginTrading: null,
      margin: null,
      futures: null,
      withdrawals: null,
      internalTransfer: null,
      universalTransfer: null,
      ipRestricted: null,
      fixTrade: null,
      portfolioMarginTrading: null,
    },
    spot: {
      state,
      observedAt: null,
      balances: null,
      openOrders: null,
      fills: null,
      coverage: configured ? coverage : unconfiguredCoverage(),
    },
    margin: {
      state,
      observedAt: null,
      totalAssetBtc: null,
      totalLiabilityBtc: null,
      totalNetAssetBtc: null,
      assets: null,
      openOrders: null,
      fills: null,
      coverage: configured ? coverage : unconfiguredCoverage(),
    },
    usdm: {
      state,
      observedAt: null,
      balances: null,
      positions: null,
      openOrders: null,
      fills: null,
      coverage: configured ? coverage : unconfiguredCoverage(),
    },
    reconciliation: {
      balances: { state: reconciliationState, observedAt: null, reason },
      orders: { state: reconciliationState, observedAt: null, reason },
      fills: { state: reconciliationState, observedAt: null, reason },
      positions: { state: reconciliationState, observedAt: null, reason },
      liabilities: { state: reconciliationState, observedAt: null, reason },
    },
  });
}

async function settled<T>(
  task: () => Promise<unknown>,
  normalize: (value: unknown) => T,
): Promise<T | null> {
  try {
    return normalize(await task());
  } catch {
    return null;
  }
}

async function scopedRows<T>(
  symbols: readonly string[],
  read: (symbol: string) => Promise<unknown>,
  normalize: (value: unknown) => T[],
): Promise<{ rows: T[] | null; symbols: string[]; failed: number }> {
  if (symbols.length === 0) return { rows: null, symbols: [], failed: 0 };
  const results = await Promise.all(symbols.map(async (current) => {
    const value = await settled(() => read(current), normalize);
    return { symbol: current, value };
  }));
  const successful = results.filter((entry): entry is { symbol: string; value: T[] } => entry.value !== null);
  if (successful.length === 0) return { rows: null, symbols: [], failed: results.length };
  return {
    rows: successful.flatMap((entry) => entry.value),
    symbols: successful.map((entry) => entry.symbol),
    failed: results.length - successful.length,
  };
}

function coverageOf(symbols: string[], failed: number): PrivateReadCoverage {
  if (symbols.length === 0) return configuredCoverage();
  return {
    state: 'PARTIAL_SYMBOL_SCOPED',
    symbols,
    limitation: failed > 0
      ? `History is symbol-scoped and ${failed} configured symbol read(s) were unavailable.`
      : 'History is limited to the configured symbol scope; Binance does not provide account-wide trade history.',
  };
}

function productState(values: readonly unknown[], coverage: PrivateReadCoverage): PrivateReadState {
  const available = values.filter((value) => value !== null).length;
  if (available === 0) return 'UNAVAILABLE';
  if (available < values.length || coverage.state !== 'COMPLETE_CURRENT') return 'PARTIAL';
  return 'AVAILABLE';
}

function reconciliation(
  values: readonly unknown[],
  observedAt: number | null,
  partialReason: string,
): { state: ReconciliationState; observedAt: number | null; reason: string | null } {
  const available = values.filter((value) => value !== null).length;
  if (available === 0) return { state: 'UNAVAILABLE', observedAt: null, reason: 'Required provider reads were unavailable.' };
  if (available < values.length) return { state: 'PARTIAL', observedAt, reason: partialReason };
  return { state: 'RECONCILED', observedAt, reason: null };
}

export class PrivateReadService {
  private readonly now: () => number;
  private readonly refreshIntervalMs: number;
  private readonly symbols: readonly string[];
  private readonly keyLabel: string;
  private readonly keyLast4: string | null;
  private current: PrivateReadSnapshot;
  private refreshInFlight: Promise<PrivateReadSnapshot> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly gateway: PrivateReadGateway | null,
    options: PrivateReadServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.refreshIntervalMs = Math.min(
      5 * 60_000,
      Math.max(10_000, Math.trunc(options.refreshIntervalMs ?? 30_000)),
    );
    this.symbols = Object.freeze(
      [...new Set((options.symbols ?? []).filter((value) => SYMBOL_RE.test(value)))]
        .sort()
        .slice(0, MAX_SYMBOLS),
    );
    this.keyLabel = safeKeyLabel(options.keyLabel);
    this.keyLast4 = typeof options.keyLast4 === 'string' && /^[A-Za-z0-9]{4}$/.test(options.keyLast4)
      ? options.keyLast4
      : null;
    this.current = initialSnapshot(gateway !== null, this.keyLabel, this.keyLast4);
  }

  snapshot(): PrivateReadSnapshot {
    return this.current;
  }

  start(): void {
    if (this.gateway === null || this.timer !== null) return;
    void this.refresh().catch(() => undefined);
    this.timer = setInterval(() => void this.refresh().catch(() => undefined), this.refreshIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  refresh(): Promise<PrivateReadSnapshot> {
    if (this.gateway === null) return Promise.resolve(this.current);
    if (this.refreshInFlight !== null) return this.refreshInFlight;
    const inFlight = this.readOnce();
    this.refreshInFlight = inFlight;
    const clear = () => {
      if (this.refreshInFlight === inFlight) this.refreshInFlight = null;
    };
    void inFlight.then(clear, clear);
    return inFlight;
  }

  private async readOnce(): Promise<PrivateReadSnapshot> {
    const gateway = this.gateway!;
    const [
      restrictions,
      spotBalances,
      spotOrders,
      spotFills,
      marginAccount,
      marginOrders,
      marginFills,
      usdmBalances,
      usdmPositions,
      usdmOrders,
      usdmFills,
    ] = await Promise.all([
      settled(() => gateway.apiRestrictions(), normalizeRestrictions),
      settled(() => gateway.spotAccount(), normalizeSpotBalances),
      settled(() => gateway.spotOpenOrders(), (value) => normalizeSpotOrders(value, 'Spot open orders')),
      scopedRows(this.symbols, (current) => gateway.spotTrades(current), (value) => normalizeSpotFills(value, 'Spot fills')),
      settled(() => gateway.marginAccount(), normalizeMarginAccount),
      settled(() => gateway.marginOpenOrders(), (value) => normalizeSpotOrders(value, 'Margin open orders')),
      scopedRows(this.symbols, (current) => gateway.marginTrades(current), (value) => normalizeSpotFills(value, 'Margin fills')),
      settled(() => gateway.usdmBalances(), normalizeUsdmBalances),
      settled(() => gateway.usdmPositions(), normalizeUsdmPositions),
      settled(() => gateway.usdmOpenOrders(), normalizeUsdmOrders),
      scopedRows(this.symbols, (current) => gateway.usdmTrades(current), normalizeUsdmFills),
    ]);
    const observedAt = this.now();
    const permissionPosture: PrivateReadPermissionPosture = restrictions === null
      ? {
          ...this.current.permissionPosture,
          state: 'UNKNOWN',
          observedAt: null,
          reading: null,
          spotMarginTrading: null,
          margin: null,
          futures: null,
          withdrawals: null,
          internalTransfer: null,
          universalTransfer: null,
          ipRestricted: null,
          fixTrade: null,
          portfolioMarginTrading: null,
        }
      : {
          state: restrictions.enableReading
            && restrictions.ipRestrict
            && !restrictions.enableWithdrawals
            && !restrictions.enableInternalTransfer
            && !restrictions.enableMargin
            && !restrictions.enableFutures
            && !restrictions.permitsUniversalTransfer
            && !restrictions.enableVanillaOptions
            && !restrictions.enableFixApiTrade
            && !restrictions.enableSpotAndMarginTrading
            && !restrictions.enablePortfolioMarginTrading
            ? 'VERIFIED_READ_ONLY'
            : 'UNSAFE',
          observedAt,
          keyLabel: this.keyLabel,
          keyLast4: this.keyLast4,
          reading: restrictions.enableReading,
          spotMarginTrading: restrictions.enableSpotAndMarginTrading,
          margin: restrictions.enableMargin,
          futures: restrictions.enableFutures,
          withdrawals: restrictions.enableWithdrawals,
          internalTransfer: restrictions.enableInternalTransfer,
          universalTransfer: restrictions.permitsUniversalTransfer,
          ipRestricted: restrictions.ipRestrict,
          fixTrade: restrictions.enableFixApiTrade,
          portfolioMarginTrading: restrictions.enablePortfolioMarginTrading,
        };

    const spotCoverage = coverageOf(spotFills.symbols, spotFills.failed);
    const marginCoverage = coverageOf(marginFills.symbols, marginFills.failed);
    const usdmCoverage = coverageOf(usdmFills.symbols, usdmFills.failed);
    const spotObservedAt = [spotBalances, spotOrders, spotFills.rows].some((value) => value !== null) ? observedAt : null;
    const marginObservedAt = [marginAccount, marginOrders, marginFills.rows].some((value) => value !== null) ? observedAt : null;
    const usdmObservedAt = [usdmBalances, usdmPositions, usdmOrders, usdmFills.rows].some((value) => value !== null)
      ? observedAt
      : null;
    const spotState = productState([spotBalances, spotOrders, spotFills.rows], spotCoverage);
    const marginState = productState([marginAccount, marginOrders, marginFills.rows], marginCoverage);
    const usdmState = productState([usdmBalances, usdmPositions, usdmOrders, usdmFills.rows], usdmCoverage);
    const productStates = [spotState, marginState, usdmState];
    const productStateSummary: PrivateReadState = productStates.every((value) => value === 'UNAVAILABLE')
      ? 'UNAVAILABLE'
      : productStates.every((value) => value === 'AVAILABLE')
        ? 'AVAILABLE'
        : 'PARTIAL';
    const state: PrivateReadState = permissionPosture.state === 'VERIFIED_READ_ONLY'
      ? productStateSummary
      : 'UNAVAILABLE';
    const latestObservedAt = [permissionPosture.observedAt, spotObservedAt, marginObservedAt, usdmObservedAt]
      .filter((value): value is number => value !== null)
      .reduce<number | null>((latest, value) => latest === null ? value : Math.max(latest, value), null);
    const balanceReconciliation = reconciliation(
      [spotBalances, marginAccount?.assets ?? null, usdmBalances],
      latestObservedAt,
      'One or more product balance reads were unavailable.',
    );
    const orderReconciliation = reconciliation(
      [spotOrders, marginOrders, usdmOrders],
      latestObservedAt,
      'One or more current open-order reads were unavailable.',
    );
    const fillReconciliation = [spotFills.rows, marginFills.rows, usdmFills.rows].some((value) => value !== null)
      ? {
          state: 'PARTIAL' as const,
          observedAt: latestObservedAt,
          reason: 'Trade history is symbol-scoped and cannot prove account-wide completeness.',
        }
      : {
          state: 'UNAVAILABLE' as const,
          observedAt: null,
          reason: 'No configured symbol-scoped trade history read succeeded.',
        };

    this.current = deepFreeze<PrivateReadSnapshot>({
      schemaVersion: 'binance.private-read.v1',
      state,
      observedAt: latestObservedAt,
      permissionPosture,
      spot: {
        state: spotState,
        observedAt: spotObservedAt,
        balances: spotBalances,
        openOrders: spotOrders,
        fills: spotFills.rows,
        coverage: spotCoverage,
      },
      margin: {
        state: marginState,
        observedAt: marginObservedAt,
        totalAssetBtc: marginAccount?.totalAssetBtc ?? null,
        totalLiabilityBtc: marginAccount?.totalLiabilityBtc ?? null,
        totalNetAssetBtc: marginAccount?.totalNetAssetBtc ?? null,
        assets: marginAccount?.assets ?? null,
        openOrders: marginOrders,
        fills: marginFills.rows,
        coverage: marginCoverage,
      },
      usdm: {
        state: usdmState,
        observedAt: usdmObservedAt,
        balances: usdmBalances,
        positions: usdmPositions,
        openOrders: usdmOrders,
        fills: usdmFills.rows,
        coverage: usdmCoverage,
      },
      reconciliation: {
        balances: balanceReconciliation,
        orders: orderReconciliation,
        fills: fillReconciliation,
        positions: reconciliation(
          [usdmPositions],
          usdmObservedAt,
          'USD-M position read was unavailable.',
        ),
        liabilities: reconciliation(
          [marginAccount?.assets ?? null],
          marginObservedAt,
          'Cross Margin liability read was unavailable.',
        ),
      },
    });
    return this.current;
  }
}

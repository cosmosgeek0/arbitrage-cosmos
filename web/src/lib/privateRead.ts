export type PrivateReadState = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
export type PermissionPostureState = 'VERIFIED_READ_ONLY' | 'UNSAFE' | 'UNKNOWN' | 'NOT_CONFIGURED';
export type CoverageState = 'COMPLETE_CURRENT' | 'PARTIAL_SYMBOL_SCOPED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
export type ReconciliationState = 'RECONCILED' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
export type PrivateReadTone = 'ok' | 'warn' | 'bad' | 'idle';

export interface PermissionPosture {
  state: PermissionPostureState;
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

export interface PrivateReadReconciliationFact {
  state: ReconciliationState;
  observedAt: number | null;
  reason: string | null;
}

export interface SpotBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface SpotOrder {
  symbol: string;
  orderId: string;
  side: 'BUY' | 'SELL';
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
  positionSide: 'BOTH' | 'LONG' | 'SHORT';
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
  side: 'BUY' | 'SELL';
  positionSide: 'BOTH' | 'LONG' | 'SHORT';
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
  side: 'BUY' | 'SELL';
  positionSide: 'BOTH' | 'LONG' | 'SHORT';
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
  permissionPosture: PermissionPosture;
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
  reconciliation: {
    balances: PrivateReadReconciliationFact;
    orders: PrivateReadReconciliationFact;
    fills: PrivateReadReconciliationFact;
    positions: PrivateReadReconciliationFact;
    liabilities: PrivateReadReconciliationFact;
  };
}

export interface ApiPermissionsEnvelope {
  schemaVersion: 'binance.api-permissions.v1';
  permissionPosture: PermissionPosture;
}

const PRIVATE_STATES = new Set<PrivateReadState>(['AVAILABLE', 'PARTIAL', 'UNAVAILABLE', 'NOT_CONFIGURED']);
const POSTURE_STATES = new Set<PermissionPostureState>(['VERIFIED_READ_ONLY', 'UNSAFE', 'UNKNOWN', 'NOT_CONFIGURED']);
const COVERAGE_STATES = new Set<CoverageState>(['COMPLETE_CURRENT', 'PARTIAL_SYMBOL_SCOPED', 'UNAVAILABLE', 'NOT_CONFIGURED']);
const RECONCILIATION_STATES = new Set<ReconciliationState>(['RECONCILED', 'PARTIAL', 'UNAVAILABLE', 'NOT_CONFIGURED']);
const POSITION_SIDES = new Set(['BOTH', 'LONG', 'SHORT']);
const INVALID = Symbol('invalid-private-read');
const SECRET_LIKE = /(?:api[-_ ]?secret|secret[-_ ]?key|signature|signed[?&/]|x-mbx-apikey|recvwindow|[?&](?:timestamp|signature)=)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isTimestampOrNull(value: unknown): value is number | null {
  return value === null || isTimestamp(value);
}

function isBooleanOrNull(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean';
}

function isSafeText(value: unknown, maximum = 240): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !SECRET_LIKE.test(value);
}

function isSafeTextOrNull(value: unknown, maximum = 240): value is string | null {
  return value === null || isSafeText(value, maximum);
}

function isSafeToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_-]{0,31}$/.test(value);
}

function isAsset(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9]{1,20}$/.test(value);
}

function isSymbol(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9]{2,32}$/.test(value);
}

function isDecimal(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 96
    && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
    && value !== '-0'
    && !/^-0\.0+$/.test(value);
}

function isDecimalId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9]\d{0,39})$/.test(value);
}

function isKeyLabel(value: unknown): value is string {
  if (typeof value !== 'string'
      || value.length < 1
      || value.length > 48
      || !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(value)
      || SECRET_LIKE.test(value)) return false;
  return value.includes(' ') || value.length <= 16;
}

function decodeNullableArray<T>(
  value: unknown,
  decode: (row: unknown) => T | typeof INVALID,
  maximum = 10_000,
): T[] | null | typeof INVALID {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > maximum) return INVALID;
  const output: T[] = [];
  for (const row of value) {
    const decoded = decode(row);
    if (decoded === INVALID) return INVALID;
    output.push(decoded);
  }
  return output;
}

function decodePermissionPosture(value: unknown): PermissionPosture | typeof INVALID {
  const keys = [
    'state', 'observedAt', 'keyLabel', 'keyLast4', 'reading', 'spotMarginTrading',
    'margin', 'futures', 'withdrawals', 'internalTransfer', 'universalTransfer',
    'ipRestricted', 'fixTrade', 'portfolioMarginTrading',
  ] as const;
  if (!hasExactKeys(value, keys)
      || !POSTURE_STATES.has(value.state as PermissionPostureState)
      || !isTimestampOrNull(value.observedAt)
      || !isKeyLabel(value.keyLabel)
      || !(value.keyLast4 === null || (typeof value.keyLast4 === 'string' && /^[A-Za-z0-9]{4}$/.test(value.keyLast4)))
      || !isBooleanOrNull(value.reading)
      || !isBooleanOrNull(value.spotMarginTrading)
      || !isBooleanOrNull(value.margin)
      || !isBooleanOrNull(value.futures)
      || !isBooleanOrNull(value.withdrawals)
      || !isBooleanOrNull(value.internalTransfer)
      || !isBooleanOrNull(value.universalTransfer)
      || !isBooleanOrNull(value.ipRestricted)
      || !isBooleanOrNull(value.fixTrade)
      || !isBooleanOrNull(value.portfolioMarginTrading)) return INVALID;

  const state = value.state as PermissionPostureState;
  const flags = [
    value.reading, value.spotMarginTrading, value.margin, value.futures,
    value.withdrawals, value.internalTransfer, value.universalTransfer,
    value.ipRestricted, value.fixTrade, value.portfolioMarginTrading,
  ];
  if (state === 'VERIFIED_READ_ONLY' && (
    value.observedAt === null
    || value.reading !== true
    || value.ipRestricted !== true
    || flags.slice(1, 7).some((flag) => flag !== false)
    || value.fixTrade !== false
    || value.portfolioMarginTrading !== false
  )) return INVALID;
  if (state === 'NOT_CONFIGURED' && (
    value.observedAt !== null
    || value.keyLast4 !== null
    || flags.some((flag) => flag !== null)
  )) return INVALID;
  if (state === 'UNSAFE' && (
    value.observedAt === null
    || ![
      value.reading === false,
      value.spotMarginTrading === true,
      value.margin === true,
      value.futures === true,
      value.withdrawals === true,
      value.internalTransfer === true,
      value.universalTransfer === true,
      value.ipRestricted === false,
      value.fixTrade === true,
      value.portfolioMarginTrading === true,
    ].some(Boolean)
  )) return INVALID;

  return { ...(value as unknown as PermissionPosture) };
}

function decodeCoverage(value: unknown): PrivateReadCoverage | typeof INVALID {
  if (!hasExactKeys(value, ['state', 'symbols', 'limitation'])
      || !COVERAGE_STATES.has(value.state as CoverageState)
      || !Array.isArray(value.symbols)
      || value.symbols.length > 4_096
      || !value.symbols.every(isSymbol)
      || new Set(value.symbols).size !== value.symbols.length
      || !isSafeTextOrNull(value.limitation)) return INVALID;
  const state = value.state as CoverageState;
  if (state === 'COMPLETE_CURRENT' && value.limitation !== null) return INVALID;
  if (state === 'PARTIAL_SYMBOL_SCOPED' && value.limitation === null) return INVALID;
  if ((state === 'UNAVAILABLE' || state === 'NOT_CONFIGURED') && value.symbols.length !== 0) return INVALID;
  return {
    state,
    symbols: [...value.symbols] as string[],
    limitation: value.limitation as string | null,
  };
}

function decodeReconciliationFact(value: unknown): PrivateReadReconciliationFact | typeof INVALID {
  if (!hasExactKeys(value, ['state', 'observedAt', 'reason'])
      || !RECONCILIATION_STATES.has(value.state as ReconciliationState)
      || !isTimestampOrNull(value.observedAt)
      || !isSafeTextOrNull(value.reason)) return INVALID;
  const state = value.state as ReconciliationState;
  if (state === 'RECONCILED' && (value.observedAt === null || value.reason !== null)) return INVALID;
  if ((state === 'PARTIAL' || state === 'UNAVAILABLE') && value.reason === null) return INVALID;
  if (state === 'NOT_CONFIGURED' && value.observedAt !== null) return INVALID;
  return { ...(value as unknown as PrivateReadReconciliationFact) };
}

function decodeSpotBalance(value: unknown): SpotBalance | typeof INVALID {
  if (!hasExactKeys(value, ['asset', 'free', 'locked'])
      || !isAsset(value.asset) || !isDecimal(value.free) || !isDecimal(value.locked)) return INVALID;
  return { ...(value as unknown as SpotBalance) };
}

function decodeSpotOrder(value: unknown): SpotOrder | typeof INVALID {
  if (!hasExactKeys(value, ['symbol', 'orderId', 'side', 'type', 'price', 'origQty', 'executedQty', 'status', 'time'])
      || !isSymbol(value.symbol)
      || !isDecimalId(value.orderId)
      || (value.side !== 'BUY' && value.side !== 'SELL')
      || !isSafeToken(value.type)
      || !isDecimal(value.price)
      || !isDecimal(value.origQty)
      || !isDecimal(value.executedQty)
      || !isSafeToken(value.status)
      || !isTimestamp(value.time)) return INVALID;
  return { ...(value as unknown as SpotOrder) };
}

function decodeSpotFill(value: unknown): SpotFill | typeof INVALID {
  if (!hasExactKeys(value, ['symbol', 'id', 'orderId', 'price', 'qty', 'quoteQty', 'commission', 'commissionAsset', 'time', 'isBuyer'])
      || !isSymbol(value.symbol)
      || !isDecimalId(value.id)
      || !isDecimalId(value.orderId)
      || !isDecimal(value.price)
      || !isDecimal(value.qty)
      || !isDecimal(value.quoteQty)
      || !isDecimal(value.commission)
      || !isAsset(value.commissionAsset)
      || !isTimestamp(value.time)
      || typeof value.isBuyer !== 'boolean') return INVALID;
  return { ...(value as unknown as SpotFill) };
}

function decodeMarginAsset(value: unknown): MarginAsset | typeof INVALID {
  if (!hasExactKeys(value, ['asset', 'free', 'locked', 'borrowed', 'interest', 'netAsset'])
      || !isAsset(value.asset)
      || !isDecimal(value.free)
      || !isDecimal(value.locked)
      || !isDecimal(value.borrowed)
      || !isDecimal(value.interest)
      || !isDecimal(value.netAsset)) return INVALID;
  return { ...(value as unknown as MarginAsset) };
}

function decodeUsdmBalance(value: unknown): UsdmBalance | typeof INVALID {
  if (!hasExactKeys(value, ['asset', 'balance', 'availableBalance', 'crossWalletBalance', 'crossUnPnl'])
      || !isAsset(value.asset)
      || !isDecimal(value.balance)
      || !isDecimal(value.availableBalance)
      || !isDecimal(value.crossWalletBalance)
      || !isDecimal(value.crossUnPnl)) return INVALID;
  return { ...(value as unknown as UsdmBalance) };
}

function decodeUsdmPosition(value: unknown): UsdmPosition | typeof INVALID {
  if (!hasExactKeys(value, [
    'symbol', 'positionSide', 'positionAmt', 'entryPrice', 'markPrice',
    'unRealizedProfit', 'liquidationPrice', 'leverage', 'marginType',
    'isolatedMargin', 'notional', 'updateTime',
  ])
      || !isSymbol(value.symbol)
      || !POSITION_SIDES.has(String(value.positionSide))
      || !isDecimal(value.positionAmt)
      || !isDecimal(value.entryPrice)
      || !isDecimal(value.markPrice)
      || !isDecimal(value.unRealizedProfit)
      || !isDecimal(value.liquidationPrice)
      || !isDecimal(value.leverage)
      || !isSafeToken(String(value.marginType).toUpperCase())
      || !isDecimal(value.isolatedMargin)
      || !isDecimal(value.notional)
      || !isTimestamp(value.updateTime)) return INVALID;
  return { ...(value as unknown as UsdmPosition) };
}

function decodeUsdmOrder(value: unknown): UsdmOrder | typeof INVALID {
  if (!hasExactKeys(value, [
    'symbol', 'orderId', 'side', 'positionSide', 'type', 'price', 'origQty',
    'executedQty', 'status', 'time', 'updateTime', 'reduceOnly',
  ])
      || !isSymbol(value.symbol)
      || !isDecimalId(value.orderId)
      || (value.side !== 'BUY' && value.side !== 'SELL')
      || !POSITION_SIDES.has(String(value.positionSide))
      || !isSafeToken(value.type)
      || !isDecimal(value.price)
      || !isDecimal(value.origQty)
      || !isDecimal(value.executedQty)
      || !isSafeToken(value.status)
      || !isTimestamp(value.time)
      || !isTimestamp(value.updateTime)
      || typeof value.reduceOnly !== 'boolean') return INVALID;
  return { ...(value as unknown as UsdmOrder) };
}

function decodeUsdmFill(value: unknown): UsdmFill | typeof INVALID {
  if (!hasExactKeys(value, [
    'symbol', 'id', 'orderId', 'side', 'positionSide', 'price', 'qty',
    'quoteQty', 'commission', 'commissionAsset', 'realizedPnl', 'time',
    'buyer', 'maker',
  ])
      || !isSymbol(value.symbol)
      || !isDecimalId(value.id)
      || !isDecimalId(value.orderId)
      || (value.side !== 'BUY' && value.side !== 'SELL')
      || !POSITION_SIDES.has(String(value.positionSide))
      || !isDecimal(value.price)
      || !isDecimal(value.qty)
      || !isDecimal(value.quoteQty)
      || !isDecimal(value.commission)
      || !isAsset(value.commissionAsset)
      || !isDecimal(value.realizedPnl)
      || !isTimestamp(value.time)
      || typeof value.buyer !== 'boolean'
      || typeof value.maker !== 'boolean') return INVALID;
  return { ...(value as unknown as UsdmFill) };
}

function productShapeIsConsistent(
  state: PrivateReadState,
  observedAt: number | null,
  coverage: PrivateReadCoverage,
  collections: readonly (readonly unknown[] | null)[],
): boolean {
  if (state === 'AVAILABLE') {
    return observedAt !== null
      && coverage.state === 'COMPLETE_CURRENT'
      && collections.every((collection) => collection !== null);
  }
  if (state === 'PARTIAL') {
    return observedAt !== null
      && coverage.state !== 'NOT_CONFIGURED'
      && collections.some((collection) => collection !== null);
  }
  if (state === 'NOT_CONFIGURED') {
    return observedAt === null
      && coverage.state === 'NOT_CONFIGURED'
      && collections.every((collection) => collection === null);
  }
  return coverage.state === 'UNAVAILABLE' && collections.every((collection) => collection === null);
}

function decodeSpot(value: unknown): PrivateReadSnapshot['spot'] | typeof INVALID {
  if (!hasExactKeys(value, ['state', 'observedAt', 'balances', 'openOrders', 'fills', 'coverage'])
      || !PRIVATE_STATES.has(value.state as PrivateReadState)
      || !isTimestampOrNull(value.observedAt)) return INVALID;
  const balances = decodeNullableArray(value.balances, decodeSpotBalance);
  const openOrders = decodeNullableArray(value.openOrders, decodeSpotOrder);
  const fills = decodeNullableArray(value.fills, decodeSpotFill);
  const coverage = decodeCoverage(value.coverage);
  if (balances === INVALID || openOrders === INVALID || fills === INVALID || coverage === INVALID
      || !productShapeIsConsistent(value.state as PrivateReadState, value.observedAt, coverage, [balances, openOrders, fills])) return INVALID;
  return {
    state: value.state as PrivateReadState,
    observedAt: value.observedAt,
    balances,
    openOrders,
    fills,
    coverage,
  };
}

function decodeMargin(value: unknown): PrivateReadSnapshot['margin'] | typeof INVALID {
  if (!hasExactKeys(value, [
    'state', 'observedAt', 'totalAssetBtc', 'totalLiabilityBtc',
    'totalNetAssetBtc', 'assets', 'openOrders', 'fills', 'coverage',
  ])
      || !PRIVATE_STATES.has(value.state as PrivateReadState)
      || !isTimestampOrNull(value.observedAt)
      || !(value.totalAssetBtc === null || isDecimal(value.totalAssetBtc))
      || !(value.totalLiabilityBtc === null || isDecimal(value.totalLiabilityBtc))
      || !(value.totalNetAssetBtc === null || isDecimal(value.totalNetAssetBtc))) return INVALID;
  const assets = decodeNullableArray(value.assets, decodeMarginAsset);
  const openOrders = decodeNullableArray(value.openOrders, decodeSpotOrder);
  const fills = decodeNullableArray(value.fills, decodeSpotFill);
  const coverage = decodeCoverage(value.coverage);
  if (assets === INVALID || openOrders === INVALID || fills === INVALID || coverage === INVALID
      || !productShapeIsConsistent(value.state as PrivateReadState, value.observedAt, coverage, [assets, openOrders, fills])) return INVALID;
  const totals = [value.totalAssetBtc, value.totalLiabilityBtc, value.totalNetAssetBtc];
  if (value.state === 'AVAILABLE' && totals.some((total) => total === null)) return INVALID;
  if ((value.state === 'UNAVAILABLE' || value.state === 'NOT_CONFIGURED') && totals.some((total) => total !== null)) return INVALID;
  return {
    state: value.state as PrivateReadState,
    observedAt: value.observedAt,
    totalAssetBtc: value.totalAssetBtc as string | null,
    totalLiabilityBtc: value.totalLiabilityBtc as string | null,
    totalNetAssetBtc: value.totalNetAssetBtc as string | null,
    assets,
    openOrders,
    fills,
    coverage,
  };
}

function decodeUsdm(value: unknown): PrivateReadSnapshot['usdm'] | typeof INVALID {
  if (!hasExactKeys(value, ['state', 'observedAt', 'balances', 'positions', 'openOrders', 'fills', 'coverage'])
      || !PRIVATE_STATES.has(value.state as PrivateReadState)
      || !isTimestampOrNull(value.observedAt)) return INVALID;
  const balances = decodeNullableArray(value.balances, decodeUsdmBalance);
  const positions = decodeNullableArray(value.positions, decodeUsdmPosition);
  const openOrders = decodeNullableArray(value.openOrders, decodeUsdmOrder);
  const fills = decodeNullableArray(value.fills, decodeUsdmFill);
  const coverage = decodeCoverage(value.coverage);
  if (balances === INVALID || positions === INVALID || openOrders === INVALID || fills === INVALID || coverage === INVALID
      || !productShapeIsConsistent(value.state as PrivateReadState, value.observedAt, coverage, [balances, positions, openOrders, fills])) return INVALID;
  return {
    state: value.state as PrivateReadState,
    observedAt: value.observedAt,
    balances,
    positions,
    openOrders,
    fills,
    coverage,
  };
}

export function decodePrivateReadSnapshot(value: unknown): PrivateReadSnapshot | null {
  if (!hasExactKeys(value, [
    'schemaVersion', 'state', 'observedAt', 'permissionPosture',
    'spot', 'margin', 'usdm', 'reconciliation',
  ])
      || value.schemaVersion !== 'binance.private-read.v1'
      || !PRIVATE_STATES.has(value.state as PrivateReadState)
      || !isTimestampOrNull(value.observedAt)
      || !hasExactKeys(value.reconciliation, ['balances', 'orders', 'fills', 'positions', 'liabilities'])) return null;
  const permissionPosture = decodePermissionPosture(value.permissionPosture);
  const spot = decodeSpot(value.spot);
  const margin = decodeMargin(value.margin);
  const usdm = decodeUsdm(value.usdm);
  const reconciliationRecord = value.reconciliation;
  const balances = decodeReconciliationFact(reconciliationRecord.balances);
  const orders = decodeReconciliationFact(reconciliationRecord.orders);
  const fills = decodeReconciliationFact(reconciliationRecord.fills);
  const positions = decodeReconciliationFact(reconciliationRecord.positions);
  const liabilities = decodeReconciliationFact(reconciliationRecord.liabilities);
  if (
    permissionPosture === INVALID || spot === INVALID || margin === INVALID || usdm === INVALID
    || balances === INVALID || orders === INVALID || fills === INVALID
    || positions === INVALID || liabilities === INVALID
  ) return null;
  const state = value.state as PrivateReadState;
  if (state === 'AVAILABLE' && (
    value.observedAt === null
    || permissionPosture.state !== 'VERIFIED_READ_ONLY'
    || [spot.state, margin.state, usdm.state].some((productState) => productState !== 'AVAILABLE')
  )) return null;
  if (state === 'NOT_CONFIGURED' && (
    value.observedAt !== null
    || permissionPosture.state !== 'NOT_CONFIGURED'
    || [spot.state, margin.state, usdm.state].some((productState) => productState !== 'NOT_CONFIGURED')
  )) return null;
  if (permissionPosture.state !== 'VERIFIED_READ_ONLY' && (state === 'AVAILABLE' || state === 'PARTIAL')) return null;
  return {
    schemaVersion: 'binance.private-read.v1',
    state,
    observedAt: value.observedAt,
    permissionPosture,
    spot,
    margin,
    usdm,
    reconciliation: { balances, orders, fills, positions, liabilities },
  };
}

export function decodeApiPermissionsEnvelope(value: unknown): ApiPermissionsEnvelope | null {
  if (!hasExactKeys(value, ['schemaVersion', 'permissionPosture'])
      || value.schemaVersion !== 'binance.api-permissions.v1') return null;
  const permissionPosture = decodePermissionPosture(value.permissionPosture);
  return permissionPosture === INVALID
    ? null
    : { schemaVersion: 'binance.api-permissions.v1', permissionPosture };
}

export function unavailablePrivateRead(reason = 'PRIVATE_READ_UNAVAILABLE'): PrivateReadSnapshot {
  const unavailableFact = (): PrivateReadReconciliationFact => ({
    state: 'UNAVAILABLE',
    observedAt: null,
    reason,
  });
  const coverage = (): PrivateReadCoverage => ({
    state: 'UNAVAILABLE',
    symbols: [],
    limitation: reason,
  });
  return {
    schemaVersion: 'binance.private-read.v1',
    state: 'UNAVAILABLE',
    observedAt: null,
    permissionPosture: {
      state: 'UNKNOWN',
      observedAt: null,
      keyLabel: 'Binance Private Read',
      keyLast4: null,
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
      state: 'UNAVAILABLE', observedAt: null, balances: null, openOrders: null, fills: null, coverage: coverage(),
    },
    margin: {
      state: 'UNAVAILABLE', observedAt: null, totalAssetBtc: null, totalLiabilityBtc: null,
      totalNetAssetBtc: null, assets: null, openOrders: null, fills: null, coverage: coverage(),
    },
    usdm: {
      state: 'UNAVAILABLE', observedAt: null, balances: null, positions: null,
      openOrders: null, fills: null, coverage: coverage(),
    },
    reconciliation: {
      balances: unavailableFact(),
      orders: unavailableFact(),
      fills: unavailableFact(),
      positions: unavailableFact(),
      liabilities: unavailableFact(),
    },
  };
}

function titleState(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function privateReadTone(state: PrivateReadState): PrivateReadTone {
  if (state === 'AVAILABLE') return 'ok';
  if (state === 'PARTIAL') return 'warn';
  if (state === 'UNAVAILABLE') return 'bad';
  return 'idle';
}

export function permissionPostureTone(state: PermissionPostureState): PrivateReadTone {
  if (state === 'VERIFIED_READ_ONLY') return 'ok';
  if (state === 'UNSAFE') return 'bad';
  if (state === 'UNKNOWN') return 'warn';
  return 'idle';
}

export function privateReadAge(observedAt: number | null, now = Date.now()): string {
  if (observedAt === null || !Number.isFinite(now) || now < observedAt) return 'Freshness Unknown';
  const seconds = Math.floor((now - observedAt) / 1_000);
  if (seconds < 60) return `${seconds}s Ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m Ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h Ago`;
  return `${Math.floor(seconds / 86_400)}d Ago`;
}

export function exactOrDash(value: string | null | undefined): string {
  return value ?? '—';
}

export interface PermissionPresentationRow {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: PrivateReadTone;
}

export interface PrivateReadPresentation {
  state: PrivateReadState;
  stateLabel: string;
  tone: PrivateReadTone;
  observedLabel: string;
  postureLabel: string;
  postureTone: PrivateReadTone;
  identityLabel: string;
  permissionRows: PermissionPresentationRow[];
  spotAvailableUsdt: string | null;
  marginLiabilityBtc: string | null;
  counts: {
    spotBalances: number | null;
    marginAssets: number | null;
    usdmBalances: number | null;
    openOrders: number | null;
    fills: number | null;
    positions: number | null;
    liabilities: number | null;
  };
  coverageLabel: string;
  reconciliationLabel: string;
}

function permissionRow(
  posture: PermissionPosture,
  id: string,
  label: string,
  fact: boolean | null,
  expected: boolean,
  enabled: string,
  disabled: string,
): PermissionPresentationRow {
  const verified = posture.state === 'VERIFIED_READ_ONLY' && fact === expected;
  const value = fact === null ? 'UNKNOWN' : fact ? enabled : disabled;
  return {
    id,
    label,
    value,
    detail: fact === null
      ? 'Provider permission readback unavailable'
      : verified
        ? 'Verified by current provider readback'
        : fact === expected
          ? `Fact observed; overall posture is ${titleState(posture.state)}`
          : `Expected ${expected ? enabled : disabled}`,
    tone: verified ? 'ok' : fact === null ? 'warn' : fact === expected ? permissionPostureTone(posture.state) : 'bad',
  };
}

export function projectPrivateRead(snapshot: PrivateReadSnapshot, now = Date.now()): PrivateReadPresentation {
  const permissionPosture = snapshot.permissionPosture;
  const counts = {
    spotBalances: snapshot.spot.balances?.length ?? null,
    marginAssets: snapshot.margin.assets?.length ?? null,
    usdmBalances: snapshot.usdm.balances?.length ?? null,
    openOrders: [snapshot.spot.openOrders, snapshot.margin.openOrders, snapshot.usdm.openOrders].every((rows) => rows !== null)
      ? (snapshot.spot.openOrders?.length ?? 0) + (snapshot.margin.openOrders?.length ?? 0) + (snapshot.usdm.openOrders?.length ?? 0)
      : null,
    fills: [snapshot.spot.fills, snapshot.margin.fills, snapshot.usdm.fills].every((rows) => rows !== null)
      ? (snapshot.spot.fills?.length ?? 0) + (snapshot.margin.fills?.length ?? 0) + (snapshot.usdm.fills?.length ?? 0)
      : null,
    positions: snapshot.usdm.positions?.length ?? null,
    liabilities: snapshot.margin.assets === null
      ? null
      : snapshot.margin.assets.filter((asset) => asset.borrowed !== '0' || asset.interest !== '0').length,
  };
  const reconciliationStates = Object.values(snapshot.reconciliation).map((fact) => fact.state);
  const reconciliationLabel = reconciliationStates.every((state) => state === 'RECONCILED')
    ? 'All Facts Reconciled'
    : reconciliationStates.some((state) => state === 'PARTIAL')
      ? 'Partial Reconciliation'
      : reconciliationStates.every((state) => state === 'NOT_CONFIGURED')
        ? 'Reconciliation Not Configured'
        : 'Reconciliation Unavailable';
  const coverage = [snapshot.spot.coverage, snapshot.margin.coverage, snapshot.usdm.coverage];
  const coverageLabel = coverage.every((item) => item.state === 'COMPLETE_CURRENT')
    ? 'Complete Current Coverage'
    : coverage.some((item) => item.state === 'PARTIAL_SYMBOL_SCOPED')
      ? 'Partial Symbol-Scoped History'
      : coverage.every((item) => item.state === 'NOT_CONFIGURED')
        ? 'Coverage Not Configured'
        : 'Coverage Unavailable';
  const identityLabel = permissionPosture.keyLast4
    ? `${permissionPosture.keyLabel} · Ending ${permissionPosture.keyLast4}`
    : permissionPosture.keyLabel;
  return {
    state: snapshot.state,
    stateLabel: titleState(snapshot.state),
    tone: privateReadTone(snapshot.state),
    observedLabel: privateReadAge(snapshot.observedAt, now),
    postureLabel: titleState(permissionPosture.state),
    postureTone: permissionPostureTone(permissionPosture.state),
    identityLabel,
    permissionRows: [
      permissionRow(permissionPosture, 'reading', 'Reading', permissionPosture.reading, true, 'On', 'Off'),
      permissionRow(permissionPosture, 'spot-margin-trading', 'Spot / Margin Trading', permissionPosture.spotMarginTrading, false, 'On', 'Off'),
      permissionRow(permissionPosture, 'margin', 'Margin', permissionPosture.margin, false, 'On', 'Off'),
      permissionRow(permissionPosture, 'futures', 'Futures', permissionPosture.futures, false, 'On', 'Off'),
      permissionRow(permissionPosture, 'withdrawals', 'Withdrawals', permissionPosture.withdrawals, false, 'On', 'Off'),
      permissionRow(
        permissionPosture,
        'transfers',
        'Transfers',
        permissionPosture.internalTransfer === null || permissionPosture.universalTransfer === null
          ? null
          : permissionPosture.internalTransfer || permissionPosture.universalTransfer,
        false,
        'On',
        'Off',
      ),
      permissionRow(permissionPosture, 'ip-restriction', 'IP Restriction', permissionPosture.ipRestricted, true, 'Verified', 'Off'),
    ],
    spotAvailableUsdt: snapshot.spot.balances?.find((balance) => balance.asset === 'USDT')?.free ?? null,
    marginLiabilityBtc: snapshot.margin.totalLiabilityBtc,
    counts,
    coverageLabel,
    reconciliationLabel,
  };
}

import {
  canonicalJson,
  stableId,
} from '../../../intelligenceFoundation/contracts/index.js';
import {
  isCompleteness,
  isDataAuthority,
  isValidUtcMillis,
} from '../../../foundation/contracts/index.js';

import {
  PRIVATE_DATA_BOUNDS,
  deepFreezePrivate,
  privateAccountRealmReference,
  privateArray,
  privateBoolean,
  privateIdentifier,
  privateInteger,
  privateProfileReference,
  privateRecord,
  privateSortedUnique,
  privateString,
  privateToken,
  snapshotPrivateData,
} from './bounds.js';
import {
  L05_PRIVATE_MARGIN_INTEREST_PAGE,
  L05_PRIVATE_MARGIN_INTEREST_MAXIMUM_SPAN_MS,
  L05_PRIVATE_MARGIN_INTEREST_RATE_CONSERVATIVE_MAXIMUM_SPAN_MS,
  L05_PRIVATE_MARGIN_INTEREST_SIZE,
  L05_PRIVATE_MARGIN_TRADE_MAXIMUM_SPAN_MS,
  L05_PRIVATE_SPOT_TRADE_MAXIMUM_SPAN_MS,
  L05_PRIVATE_TRADE_HISTORY_LIMIT,
  L05_PRIVATE_USDM_TRADE_MAXIMUM_SPAN_MS,
  L05_BINANCE_MATRIX_SHA256,
  PRIVATE_FACT_QUERY_POLICY,
  PRIVATE_TRADE_HISTORY_FACT_KINDS,
  resolvePrivateFactContract,
} from './contracts.js';
import {
  normalizePrivateExactDecimal,
  normalizePrivateNonNegativeDecimal,
} from './exact.js';
import { evaluatePrivateFactFreshness } from './freshness.js';
import {
  L05_PRIVATE_EMBEDDED_TIME_TOLERANCE_MS,
  L05_PRIVATE_FACT_SCHEMA,
  L05_PRIVATE_FACT_SCHEMA_REVISIONS,
  NO_PRIVATE_ACTION_AUTHORITY,
  PRIVATE_FACT_KINDS,
  PRIVATE_MARGIN_INVENTORY_QUERY_TYPES,
  PRIVATE_MARGIN_QUERY_MODES,
  PRIVATE_PRODUCTS,
  PRIVATE_QUERY_COVERAGE_KINDS,
  PRIVATE_QUERY_SCOPES,
  PRIVATE_READ_STATES,
  type NormalizedPrivateFact,
  type PrivateFactEvidenceInput,
  type PrivateFactKind,
  type PrivateFactQueryCoverage,
} from './types.js';

type PlainRecord = Readonly<Record<string, unknown>>;

interface NormalizedValue {
  readonly value: unknown;
  readonly warningCodes: readonly string[];
  readonly blockingCodes: readonly string[];
}

const INPUT_FIELDS = Object.freeze([
  'schema',
  'matrixSha256',
  'factKind',
  'product',
  'environment',
  'realm',
  'accountRealmId',
  'profileId',
  'contractId',
  'queryScope',
  'querySymbol',
  'queryAsset',
  'queryType',
  'marginMode',
  'queryCoverage',
  'sourceId',
  'schemaRevision',
  'receiptId',
  'readState',
  'authority',
  'completeness',
  'sourceTimeMs',
  'receivedAtMs',
  'maxAgeMs',
  'value',
] as const);

const QUERY_COVERAGE_FIELDS = Object.freeze([
  'kind', 'omitZeroBalances', 'startTimeMs', 'endTimeMs', 'limit',
  'orderId', 'fromId', 'cursor', 'page', 'size', 'vipLevel',
  'isolatedSymbol', 'asset',
] as const);
const QUERY_COVERAGE_FIELDS_WITHOUT_ASSET = Object.freeze(
  QUERY_COVERAGE_FIELDS.filter((field) => field !== 'asset'),
);

const PERMISSION_FIELDS = Object.freeze([
  'ipRestrict', 'createTime', 'enableReading', 'enableWithdrawals',
  'enableInternalTransfer', 'enableMargin', 'enableFutures',
  'permitsUniversalTransfer', 'enableVanillaOptions', 'enableFixApiTrade',
  'enableFixReadOnly', 'enableSpotAndMarginTrading',
  'enablePortfolioMarginTrading',
] as const);

const SPOT_ACCOUNT_FIELDS = Object.freeze([
  'makerCommission', 'takerCommission', 'buyerCommission', 'sellerCommission',
  'commissionRates', 'canTrade', 'canWithdraw', 'canDeposit', 'brokered',
  'requireSelfTradePrevention', 'preventSor', 'updateTime', 'accountType',
  'balances', 'permissions', 'uid',
] as const);
const COMMISSION_RATE_FIELDS = Object.freeze(['maker', 'taker', 'buyer', 'seller'] as const);
const SPOT_BALANCE_FIELDS = Object.freeze(['asset', 'free', 'locked'] as const);

const SPOT_ORDER_FIELDS = Object.freeze([
  'symbol', 'orderId', 'orderListId', 'clientOrderId', 'price', 'origQty',
  'executedQty', 'cummulativeQuoteQty', 'status', 'timeInForce', 'type',
  'side', 'time', 'updateTime', 'isWorking', 'origQuoteOrderQty',
  'selfTradePreventionMode',
] as const);
const SPOT_ORDER_CONDITIONAL_FIELDS = Object.freeze([
  'stopPrice', 'icebergQty', 'workingTime', 'strategyId', 'strategyType', 'trailingDelta',
  'trailingTime', 'usedSor', 'workingFloor', 'pegPriceType', 'peggedPrice',
  'pegOffsetType', 'pegOffsetValue',
] as const);
const SPOT_TRADE_FIELDS = Object.freeze([
  'symbol', 'id', 'orderId', 'orderListId', 'price', 'qty', 'quoteQty',
  'commission', 'commissionAsset', 'time', 'isBuyer', 'isMaker', 'isBestMatch',
] as const);
const SPOT_COMMISSION_FIELDS = Object.freeze([
  'symbol', 'standardCommission', 'specialCommission', 'taxCommission', 'discount',
] as const);
const SPOT_DISCOUNT_FIELDS = Object.freeze([
  'enabledForAccount', 'enabledForSymbol', 'discountAsset', 'discount',
] as const);

const ACCOUNT_STATUS_FIELDS = Object.freeze(['data'] as const);
const TRADING_STATUS_FIELDS = Object.freeze(['data'] as const);
const TRADING_STATUS_DATA_FIELDS = Object.freeze([
  'isLocked', 'plannedRecoverTime', 'triggerCondition', 'updateTime',
] as const);
const TRIGGER_CONDITION_FIELDS = Object.freeze(['GCR', 'IFER', 'UFR'] as const);

const USDM_ACCOUNT_FIELDS = Object.freeze([
  'totalInitialMargin', 'totalMaintMargin', 'totalWalletBalance',
  'totalUnrealizedProfit', 'totalMarginBalance', 'totalPositionInitialMargin',
  'totalOpenOrderInitialMargin', 'totalCrossWalletBalance', 'totalCrossUnPnl',
  'availableBalance', 'maxWithdrawAmount', 'assets', 'positions',
] as const);
const USDM_ACCOUNT_ASSET_FIELDS = Object.freeze([
  'asset', 'walletBalance', 'unrealizedProfit', 'marginBalance', 'maintMargin',
  'initialMargin', 'positionInitialMargin', 'openOrderInitialMargin',
  'crossWalletBalance', 'crossUnPnl', 'availableBalance', 'maxWithdrawAmount',
  'updateTime',
] as const);
const USDM_ACCOUNT_POSITION_FIELDS = Object.freeze([
  'symbol', 'positionSide', 'positionAmt', 'unrealizedProfit', 'isolatedMargin',
  'notional', 'isolatedWallet', 'initialMargin', 'maintMargin', 'updateTime',
] as const);
const USDM_BALANCE_FIELDS = Object.freeze([
  'accountAlias', 'asset', 'balance', 'crossWalletBalance', 'crossUnPnl',
  'availableBalance', 'maxWithdrawAmount', 'marginAvailable', 'updateTime',
] as const);
const USDM_POSITION_FIELDS = Object.freeze([
  'symbol', 'positionSide', 'positionAmt', 'entryPrice', 'breakEvenPrice',
  'markPrice', 'unRealizedProfit', 'liquidationPrice', 'isolatedMargin',
  'notional', 'marginAsset', 'isolatedWallet', 'initialMargin', 'maintMargin',
  'positionInitialMargin', 'openOrderInitialMargin', 'adl', 'bidNotional',
  'askNotional', 'updateTime',
] as const);
const USDM_ORDER_FIELDS = Object.freeze([
  'avgPrice', 'clientOrderId', 'cumQuote', 'executedQty', 'orderId', 'origQty',
  'origType', 'price', 'reduceOnly', 'side', 'positionSide', 'status', 'stopPrice',
  'closePosition', 'symbol', 'time', 'timeInForce', 'type', 'activatePrice',
  'priceRate', 'updateTime', 'workingType', 'priceProtect', 'priceMatch',
  'selfTradePreventionMode', 'goodTillDate',
] as const);
const USDM_TRADE_FIELDS = Object.freeze([
  'symbol', 'id', 'orderId', 'price', 'qty', 'quoteQty', 'commission',
  'commissionAsset', 'realizedPnl', 'side', 'positionSide', 'buyer', 'maker', 'time',
] as const);

const MARGIN_CROSS_FIELDS = Object.freeze([
  'created', 'borrowEnabled', 'marginLevel', 'collateralMarginLevel',
  'totalAssetOfBtc', 'totalLiabilityOfBtc', 'totalNetAssetOfBtc',
  'TotalCollateralValueInUSDT', 'totalOpenOrderLossInUSDT', 'tradeEnabled',
  'transferInEnabled', 'transferOutEnabled', 'accountType', 'userAssets',
] as const);
const MARGIN_CROSS_ASSET_FIELDS = Object.freeze([
  'asset', 'borrowed', 'free', 'interest', 'locked', 'netAsset',
] as const);
const MARGIN_ISOLATED_FIELDS = Object.freeze([
  'assets', 'totalAssetOfBtc', 'totalLiabilityOfBtc', 'totalNetAssetOfBtc',
] as const);
const MARGIN_ISOLATED_PAIR_FIELDS = Object.freeze([
  'baseAsset', 'quoteAsset', 'symbol', 'isolatedCreated', 'enabled',
  'marginLevel', 'marginLevelStatus', 'marginRatio', 'indexPrice',
  'liquidatePrice', 'liquidateRate', 'tradeEnabled',
] as const);
const MARGIN_ISOLATED_ASSET_FIELDS = Object.freeze([
  'asset', 'borrowEnabled', 'borrowed', 'free', 'interest', 'locked', 'netAsset',
  'netAssetOfBtc', 'repayEnabled', 'totalAsset',
] as const);
const MARGIN_ORDER_FIELDS = Object.freeze([
  'symbol', 'orderId', 'clientOrderId', 'price', 'origQty', 'executedQty',
  'cummulativeQuoteQty', 'status', 'timeInForce', 'type', 'side', 'stopPrice',
  'icebergQty', 'time', 'updateTime', 'isWorking', 'isIsolated',
  'selfTradePreventionMode',
] as const);
const MARGIN_TRADE_FIELDS = Object.freeze([
  'symbol', 'id', 'orderId', 'price', 'qty', 'commission',
  'commissionAsset', 'time', 'isBuyer', 'isMaker', 'isBestMatch', 'isIsolated',
] as const);
const MARGIN_INTEREST_FIELDS = Object.freeze(['rows', 'total'] as const);
const MARGIN_INTEREST_ROW_FIELDS = Object.freeze([
  'asset', 'interest', 'interestAccuredTime', 'interestRate', 'principal',
  'type', 'isolatedSymbol', 'txId',
] as const);
const MARGIN_INTEREST_ROW_OPTIONAL_FIELDS = Object.freeze(['rawAsset'] as const);
const MARGIN_RATE_FIELDS = Object.freeze([
  'asset', 'dailyInterestRate', 'timestamp', 'vipLevel',
] as const);
const MARGIN_INVENTORY_FIELDS = Object.freeze(['assets', 'updateTime'] as const);

const USDM_POSITION_MODE_FIELDS = Object.freeze(['dualSidePosition'] as const);
const USDM_MULTI_ASSETS_FIELDS = Object.freeze(['multiAssetsMargin'] as const);

const RECEIPT_FALLBACK_FACTS = Object.freeze([
  'SPOT_PERMISSIONS', 'SPOT_COMMISSIONS', 'SPOT_ACCOUNT_STATUS',
  'SPOT_TRADING_STATUS', 'USDM_PERMISSIONS', 'USDM_ACCOUNT_STATUS',
  'USDM_TRADING_STATUS', 'USDM_MULTI_ASSETS_MODE', 'USDM_POSITION_MODE',
  'MARGIN_PERMISSIONS', 'MARGIN_CROSS_ACCOUNT', 'MARGIN_ISOLATED_ACCOUNT',
  'MARGIN_ACCOUNT_STATUS', 'MARGIN_TRADING_STATUS',
] as const satisfies readonly PrivateFactKind[]);

export const L05_PRIVATE_GAP_SOURCE_ID = 'L02-BINANCE-2026-07-12' as const;

function venueToken(value: unknown, label: string): string {
  const token = privateString(value, label, 128);
  if (token !== token.normalize('NFC').toUpperCase()
    || !/^[\p{L}\p{N}._:-]+$/u.test(token)) {
    throw new TypeError(`${label} must be a canonical uppercase venue token`);
  }
  return token;
}

function queryToken(value: unknown, label: string): string {
  const token = privateString(value, label, 128);
  if (token !== token.normalize('NFC').toUpperCase()
    || !/^[\p{L}\p{N}._-]+$/u.test(token)) {
    throw new TypeError(`${label} must match the canonical L04 instrument token grammar`);
  }
  return token;
}

function nullableQueryToken(value: unknown, label: string): string | null {
  return value === null ? null : queryToken(value, label);
}

function validateQueryMetadata(
  input: PrivateFactEvidenceInput,
  gapReason: string | null,
): void {
  const policy = PRIVATE_FACT_QUERY_POLICY[input.factKind];
  if (policy === undefined) throw new TypeError('private fact query policy is missing');

  if (gapReason !== null) {
    if (input.queryScope !== 'ACCOUNT_WIDE'
      || input.querySymbol !== null
      || input.queryAsset !== null
      || input.queryType !== null
      || input.marginMode !== null) {
      throw new TypeError('L02 gap evidence cannot carry query selectors');
    }
    return;
  }

  if (policy.scope === 'ACCOUNT_WIDE') {
    if (input.queryScope !== 'ACCOUNT_WIDE' || input.querySymbol !== null) {
      throw new TypeError('account-wide private fact cannot carry a symbol selector');
    }
  } else if (policy.scope === 'ALL_SYMBOLS_OPTIONAL') {
    if (input.queryScope === 'ALL_SYMBOLS') {
      if (input.querySymbol !== null) {
        throw new TypeError('all-symbol private fact cannot carry a query symbol');
      }
    } else if (input.queryScope === 'SYMBOL') {
      if (input.querySymbol === null) {
        throw new TypeError('symbol-scoped private fact requires a query symbol');
      }
    } else {
      throw new TypeError('optional-symbol private fact requires ALL_SYMBOLS or SYMBOL scope');
    }
  } else if (input.queryScope !== 'SYMBOL' || input.querySymbol === null) {
    throw new TypeError('private fact requires exact symbol scope');
  }

  if (policy.queryAssetRequired !== (input.queryAsset !== null)) {
    throw new TypeError(policy.queryAssetRequired
      ? 'private fact requires an exact query asset'
      : 'private fact cannot carry a query asset');
  }
  if (policy.queryTypeRequired !== (input.queryType !== null)) {
    throw new TypeError(policy.queryTypeRequired
      ? 'private fact requires an exact query type'
      : 'private fact cannot carry a query type');
  }
  if (input.factKind === 'MARGIN_INVENTORY'
    && !PRIVATE_MARGIN_INVENTORY_QUERY_TYPES.includes(input.queryType as never)) {
    throw new TypeError('Margin inventory query type must be exactly MARGIN or ISOLATED');
  }
  if (policy.marginModeRequired !== (input.marginMode !== null)) {
    throw new TypeError(policy.marginModeRequired
      ? 'private fact requires an exact Margin query mode'
      : 'private fact cannot carry a Margin query mode');
  }
  if (input.factKind === 'MARGIN_OPEN_ORDERS'
    && input.marginMode === 'ISOLATED'
    && input.queryScope !== 'SYMBOL') {
    throw new TypeError('isolated Margin open orders require exact symbol scope');
  }
}

function normalizedArray(value: unknown, label: string): readonly PlainRecord[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must normalize to an array`);
  return value as readonly PlainRecord[];
}

function assertNormalizedQueryBinding(
  input: PrivateFactEvidenceInput,
  value: unknown,
): void {
  if (input.queryScope === 'SYMBOL') {
    let observedSymbols: readonly unknown[];
    switch (input.factKind) {
      case 'SPOT_OPEN_ORDERS':
      case 'SPOT_TRADES':
      case 'USDM_OPEN_ORDERS':
      case 'USDM_TRADES':
      case 'MARGIN_OPEN_ORDERS':
      case 'MARGIN_TRADES':
        observedSymbols = normalizedArray(value, input.factKind).map((row) => row.symbol);
        break;
      case 'SPOT_COMMISSIONS':
        observedSymbols = [(value as PlainRecord).symbol];
        break;
      default:
        observedSymbols = [];
    }
    if (observedSymbols.some((symbol) => symbol !== input.querySymbol)) {
      throw new TypeError('normalized private fact contains cross-symbol query substitution');
    }
  }

  if (input.factKind === 'MARGIN_OPEN_ORDERS' || input.factKind === 'MARGIN_TRADES') {
    const expectedIsolated = input.marginMode === 'ISOLATED';
    if (normalizedArray(value, input.factKind).some((row) => (
      row.isIsolated !== expectedIsolated
    ))) {
      throw new TypeError('normalized Margin fact does not match its query mode');
    }
  }

  if (input.factKind === 'MARGIN_INTEREST_RATE'
    && normalizedArray(value, input.factKind).some((row) => row.asset !== input.queryAsset)) {
    throw new TypeError('normalized Margin rate contains cross-asset query substitution');
  }

  if (input.factKind === 'MARGIN_INTEREST') {
    const rows = ((value as PlainRecord).rows as readonly PlainRecord[]);
    const expectedIsolatedSymbol = input.queryCoverage.isolatedSymbol;
    if (rows.some((row) => row.isolatedSymbol !== expectedIsolatedSymbol)) {
      throw new TypeError('normalized Margin interest row does not match its exact mode selector');
    }
    const expectedAsset = input.queryCoverage.asset;
    if (expectedAsset !== null && rows.some((row) => row.asset !== expectedAsset)) {
      throw new TypeError('normalized Margin interest row does not match its exact asset selector');
    }
  }

  if (input.queryCoverage.kind === 'HISTORY_EXPLICIT_WINDOW') {
    const startTimeMs = input.queryCoverage.startTimeMs;
    const endTimeMs = input.queryCoverage.endTimeMs;
    if (startTimeMs === null || endTimeMs === null) {
      throw new TypeError('explicit history window lost its exact time bounds');
    }
    const rows = input.factKind === 'MARGIN_INTEREST'
      ? ((value as PlainRecord).rows as readonly PlainRecord[])
      : normalizedArray(value, input.factKind);
    const timeField = input.factKind === 'MARGIN_INTEREST'
      ? 'interestAccuredTime'
      : input.factKind === 'MARGIN_INTEREST_RATE'
        ? 'timestamp'
        : 'time';
    if (rows.some((row) => (
      typeof row[timeField] !== 'number'
      || row[timeField] < startTimeMs
      || row[timeField] > endTimeMs
    ))) {
      throw new TypeError('normalized history response contains evidence outside its exact query window');
    }
  }
}

const CURRENT_EMBEDDED_TIMESTAMP_FIELDS = Object.freeze([
  'createTime', 'time', 'updateTime', 'workingTime', 'trailingTime',
] as const satisfies readonly string[]);

function currentEmbeddedTimestamps(
  value: unknown,
  path = 'value',
): readonly { readonly path: string; readonly timestampMs: number }[] {
  if (value === null || typeof value !== 'object') return Object.freeze([]);
  if (Array.isArray(value)) {
    return Object.freeze(value.flatMap((item, index) => (
      currentEmbeddedTimestamps(item, `${path}[${index}]`)
    )));
  }
  const timestamps: { path: string; timestampMs: number }[] = [];
  for (const [field, entry] of Object.entries(value)) {
    const fieldPath = `${path}.${field}`;
    if ((CURRENT_EMBEDDED_TIMESTAMP_FIELDS as readonly string[]).includes(field)) {
      if (entry !== -1) {
        if (typeof entry !== 'number' || !Number.isSafeInteger(entry)) {
          throw new TypeError(`${fieldPath} must retain a safe UTC millisecond timestamp`);
        }
        timestamps.push({ path: fieldPath, timestampMs: entry });
      }
    } else {
      timestamps.push(...currentEmbeddedTimestamps(entry, fieldPath));
    }
  }
  return Object.freeze(timestamps);
}

function assertCurrentEmbeddedTimestampCausality(
  input: Readonly<PrivateFactEvidenceInput>,
  normalizedValue: unknown,
  evaluatedAtMs: number,
): void {
  if (input.readState !== 'OK'
    || input.queryCoverage.kind !== 'CURRENT_UNFILTERED'
    // This documentary field has an accepted seconds-versus-milliseconds
    // conflict and is already unusable; interpreting it here would fabricate
    // a clock unit.
    || input.factKind === 'MARGIN_INVENTORY') return;
  for (const timestamp of currentEmbeddedTimestamps(normalizedValue)) {
    if (input.sourceTimeMs !== null
      && timestamp.timestampMs > input.sourceTimeMs + L05_PRIVATE_EMBEDDED_TIME_TOLERANCE_MS) {
      throw new TypeError(`${timestamp.path} is after the current private source cut`);
    }
    if (timestamp.timestampMs > input.receivedAtMs + L05_PRIVATE_EMBEDDED_TIME_TOLERANCE_MS) {
      throw new TypeError(`${timestamp.path} would be locally available before its receipt`);
    }
    if (timestamp.timestampMs > evaluatedAtMs + L05_PRIVATE_EMBEDDED_TIME_TOLERANCE_MS) {
      throw new TypeError(`${timestamp.path} is after the private evaluation cut`);
    }
  }
}

function enumText(value: unknown, label: string, allowed: readonly string[]): string {
  const normalized = privateString(value, label, 128);
  if (!allowed.includes(normalized)) throw new TypeError(`${label} has an unsupported value`);
  return normalized;
}

function nullableOrEmptyVenueToken(value: unknown, label: string): string | null {
  return value === null || value === '' ? null : venueToken(value, label);
}

function utcMillis(value: unknown, label: string): number {
  if (!isValidUtcMillis(value)) throw new TypeError(`${label} must be valid UTC milliseconds`);
  return value;
}

function nullableUtcMillis(value: unknown, label: string): number | null {
  return value === null ? null : utcMillis(value, label);
}

function exchangeIntegerId(value: unknown, label: string, allowNegativeOne = false): string {
  const pattern = allowNegativeOne ? /^(?:-1|0|[1-9]\d*)$/ : /^(?:0|[1-9]\d*)$/;
  if (typeof value === 'string' && value.length <= 40 && pattern.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)
    && (value >= 0 || (allowNegativeOne && value === -1))) return String(value);
  throw new TypeError(`${label} must preserve an exact integer identity`);
}

function nullableExchangeIntegerId(value: unknown, label: string): string | null {
  return value === null ? null : exchangeIntegerId(value, label);
}

function binanceClientOrderId(value: unknown, label: string): string {
  const normalized = privateString(value, label, 36);
  if (/^(?:A3T[A-Z0-9]|ABIA|ACCA|AGPA|AIDA|AIPA|AKIA|ANPA|ANVA|APKA|AROA|ASCA|ASIA)[A-Z0-9]{16}$/.test(normalized)) {
    throw new TypeError(`${label} cannot retain a secret-shaped AWS access-key identifier`);
  }
  if (!/^[.A-Za-z0-9_:/-]{1,36}$/.test(normalized)) {
    throw new TypeError(`${label} must match the exact Binance client-order-id grammar`);
  }
  return normalized;
}

function nullableBoundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | null {
  return value === null ? null : privateInteger(value, label, minimum, maximum);
}

function normalizeQueryCoverage(value: unknown): Readonly<PrivateFactQueryCoverage> {
  const hasAsset = typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.hasOwn(value, 'asset');
  const record = privateRecord(
    value,
    hasAsset ? QUERY_COVERAGE_FIELDS : QUERY_COVERAGE_FIELDS_WITHOUT_ASSET,
    'private fact query coverage',
  );
  if (!PRIVATE_QUERY_COVERAGE_KINDS.includes(record.kind as never)) {
    throw new TypeError('private fact query coverage kind is unsupported');
  }
  return Object.freeze({
    kind: record.kind as PrivateFactQueryCoverage['kind'],
    omitZeroBalances: record.omitZeroBalances === null
      ? null
      : privateBoolean(record.omitZeroBalances, 'query coverage omitZeroBalances'),
    startTimeMs: nullableUtcMillis(record.startTimeMs, 'query coverage startTimeMs'),
    endTimeMs: nullableUtcMillis(record.endTimeMs, 'query coverage endTimeMs'),
    limit: nullableBoundedInteger(record.limit, 'query coverage limit', 1, 10_000),
    orderId: nullableExchangeIntegerId(record.orderId, 'query coverage orderId'),
    fromId: nullableExchangeIntegerId(record.fromId, 'query coverage fromId'),
    cursor: nullableExchangeIntegerId(record.cursor, 'query coverage cursor'),
    page: nullableBoundedInteger(record.page, 'query coverage page', 1, 100_000),
    size: nullableBoundedInteger(record.size, 'query coverage size', 1, 1_000),
    vipLevel: nullableBoundedInteger(record.vipLevel, 'query coverage vipLevel', 0, 100),
    isolatedSymbol: nullableQueryToken(record.isolatedSymbol, 'query coverage isolatedSymbol'),
    asset: hasAsset ? nullableQueryToken(record.asset, 'query coverage asset') : null,
  });
}

const COVERAGE_NULLABLE_FIELDS = Object.freeze([
  'omitZeroBalances', 'startTimeMs', 'endTimeMs', 'limit', 'orderId',
  'fromId', 'cursor', 'page', 'size', 'vipLevel', 'isolatedSymbol',
  'asset',
] as const satisfies readonly (keyof PrivateFactQueryCoverage)[]);

function requireNullCoverageFields(
  coverage: Readonly<PrivateFactQueryCoverage>,
  exceptions: readonly (keyof PrivateFactQueryCoverage)[] = [],
): void {
  const admitted = new Set(exceptions);
  if (COVERAGE_NULLABLE_FIELDS.some((field) => (
    !admitted.has(field) && coverage[field] !== null
  ))) {
    throw new TypeError('private fact query coverage carries an unsupported selector');
  }
}

function validateExplicitWindow(coverage: Readonly<PrivateFactQueryCoverage>): void {
  if (coverage.startTimeMs === null || coverage.endTimeMs === null
    || coverage.startTimeMs > coverage.endTimeMs) {
    throw new TypeError('historical private query requires an exact ordered start/end window');
  }
}

function subtractUtcCalendarMonths(timestampMs: number, months: number): number {
  const source = new Date(timestampMs);
  const targetMonthStart = Date.UTC(
    source.getUTCFullYear(),
    source.getUTCMonth() - months,
    1,
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds(),
  );
  const target = new Date(targetMonthStart);
  const targetLastDay = new Date(Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  return Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    Math.min(source.getUTCDate(), targetLastDay),
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds(),
  );
}

function validateExplicitHistoryHorizon(
  factKind: PrivateFactKind,
  coverage: Readonly<PrivateFactQueryCoverage>,
  evaluatedAtMs: number,
): void {
  const startTimeMs = coverage.startTimeMs!;
  const endTimeMs = coverage.endTimeMs!;
  const spanMs = endTimeMs - startTimeMs;
  switch (factKind) {
    case 'SPOT_TRADES':
      if (spanMs > L05_PRIVATE_SPOT_TRADE_MAXIMUM_SPAN_MS) {
        throw new TypeError('Spot trade history window exceeds the documented 24-hour maximum');
      }
      return;
    case 'USDM_TRADES':
      if (spanMs > L05_PRIVATE_USDM_TRADE_MAXIMUM_SPAN_MS) {
        throw new TypeError('USD-M trade history window exceeds the documented 7-day maximum');
      }
      if (startTimeMs < subtractUtcCalendarMonths(evaluatedAtMs, 6)) {
        throw new TypeError('USD-M trade history start is older than six calendar months before the evaluation cut');
      }
      return;
    case 'MARGIN_TRADES':
      if (spanMs >= L05_PRIVATE_MARGIN_TRADE_MAXIMUM_SPAN_MS) {
        throw new TypeError('Margin trade history window must be strictly shorter than 24 hours');
      }
      return;
    case 'MARGIN_INTEREST':
      if (spanMs > L05_PRIVATE_MARGIN_INTEREST_MAXIMUM_SPAN_MS) {
        throw new TypeError('Margin interest history window exceeds the documented 30-day maximum');
      }
      return;
    case 'MARGIN_INTEREST_RATE':
      if (spanMs > L05_PRIVATE_MARGIN_INTEREST_RATE_CONSERVATIVE_MAXIMUM_SPAN_MS) {
        throw new TypeError('MARGIN_INTEREST_RATE_CALENDAR_MONTH_CONSERVATIVE_30D_POLICY');
      }
      return;
    default:
      throw new TypeError('explicit history horizon policy is missing');
  }
}

function validateQueryCoverageMetadata(
  input: PrivateFactEvidenceInput,
  coverage: Readonly<PrivateFactQueryCoverage>,
  gapReason: string | null,
  evaluatedAtMs: number,
): void {
  if (gapReason !== null) {
    if (coverage.kind !== 'UNAVAILABLE_GAP') {
      throw new TypeError('L02 gap fact requires unavailable query coverage');
    }
    requireNullCoverageFields(coverage);
    return;
  }

  if ((PRIVATE_TRADE_HISTORY_FACT_KINDS as readonly PrivateFactKind[]).includes(input.factKind)) {
    if (coverage.kind === 'HISTORY_EXPLICIT_WINDOW') {
      validateExplicitWindow(coverage);
      validateExplicitHistoryHorizon(input.factKind, coverage, evaluatedAtMs);
      requireNullCoverageFields(coverage, ['startTimeMs', 'endTimeMs', 'limit']);
      if (coverage.limit !== L05_PRIVATE_TRADE_HISTORY_LIMIT) {
        throw new TypeError('trade history terminal witness requires the exact maximum limit');
      }
      return;
    }
    if (coverage.kind === 'HISTORY_DEFAULT_PARTIAL') {
      requireNullCoverageFields(coverage);
      return;
    }
    if (coverage.kind === 'HISTORY_CURSOR_PARTIAL') {
      requireNullCoverageFields(coverage, ['limit', 'orderId', 'fromId', 'cursor']);
      const cursors = [coverage.orderId, coverage.fromId, coverage.cursor]
        .filter((candidate) => candidate !== null);
      if (coverage.limit !== L05_PRIVATE_TRADE_HISTORY_LIMIT || cursors.length !== 1) {
        throw new TypeError('trade history cursor witness requires one exact cursor and maximum limit');
      }
      return;
    }
    throw new TypeError('trade history fact requires an exact historical coverage witness');
  }

  if (input.factKind === 'MARGIN_INTEREST') {
    if (coverage.kind === 'HISTORY_EXPLICIT_WINDOW') {
      validateExplicitWindow(coverage);
      validateExplicitHistoryHorizon(input.factKind, coverage, evaluatedAtMs);
      requireNullCoverageFields(
        coverage,
        ['startTimeMs', 'endTimeMs', 'page', 'size', 'isolatedSymbol', 'asset'],
      );
      if (coverage.page !== L05_PRIVATE_MARGIN_INTEREST_PAGE
        || coverage.size !== L05_PRIVATE_MARGIN_INTEREST_SIZE) {
        throw new TypeError('Margin interest coverage requires exact page 1 and size 100');
      }
    } else if (coverage.kind === 'HISTORY_DEFAULT_PARTIAL') {
      requireNullCoverageFields(coverage, ['isolatedSymbol', 'asset']);
    } else {
      throw new TypeError('Margin interest requires explicit-window or default-partial coverage');
    }
    if (input.marginMode === 'CROSS' && coverage.isolatedSymbol !== null) {
      throw new TypeError('cross Margin interest query cannot carry isolatedSymbol');
    }
    if (input.marginMode === 'ISOLATED' && coverage.isolatedSymbol === null) {
      throw new TypeError('isolated Margin interest query requires exact isolatedSymbol');
    }
    return;
  }

  if (input.factKind === 'MARGIN_INTEREST_RATE') {
    if (coverage.kind === 'HISTORY_EXPLICIT_WINDOW') {
      validateExplicitWindow(coverage);
      validateExplicitHistoryHorizon(input.factKind, coverage, evaluatedAtMs);
      requireNullCoverageFields(coverage, ['startTimeMs', 'endTimeMs']);
    } else if (coverage.kind === 'HISTORY_DEFAULT_PARTIAL') {
      requireNullCoverageFields(coverage);
    } else {
      throw new TypeError('Margin rate requires explicit-window or default-partial coverage');
    }
    // The current accepted response is account-tier neutral; a VIP selector
    // would describe a different evidence cut and remains unsupported.
    if (coverage.vipLevel !== null) {
      throw new TypeError('Margin rate coverage requires vipLevel omitted');
    }
    return;
  }

  if (coverage.kind !== 'CURRENT_UNFILTERED') {
    throw new TypeError('current private fact requires unfiltered current query coverage');
  }
  if (input.factKind === 'SPOT_ACCOUNT') {
    requireNullCoverageFields(coverage, ['omitZeroBalances']);
    if (coverage.omitZeroBalances !== false) {
      throw new TypeError('Spot account completeness requires omitZeroBalances=false');
    }
  } else {
    requireNullCoverageFields(coverage);
  }
}

function queryCoverageBlockingCodes(
  input: PrivateFactEvidenceInput,
  coverage: Readonly<PrivateFactQueryCoverage>,
  normalizedValue: unknown,
): readonly string[] {
  const reasons: string[] = [];
  if (coverage.kind === 'HISTORY_DEFAULT_PARTIAL'
    || coverage.kind === 'HISTORY_CURSOR_PARTIAL') {
    reasons.push(`PRIVATE_QUERY_COVERAGE_PARTIAL_${input.factKind}`);
  }
  if ((PRIVATE_TRADE_HISTORY_FACT_KINDS as readonly PrivateFactKind[]).includes(input.factKind)) {
    const count = normalizedArray(normalizedValue, input.factKind).length;
    if (coverage.limit !== null && count > coverage.limit) {
      throw new TypeError('trade history response exceeds its exact request limit');
    }
    if (coverage.kind === 'HISTORY_EXPLICIT_WINDOW'
      && count >= L05_PRIVATE_TRADE_HISTORY_LIMIT) {
      reasons.push(`PRIVATE_QUERY_TERMINAL_PAGE_UNPROVEN_${input.factKind}`);
    }
  }
  if (input.factKind === 'MARGIN_INTEREST') {
    const value = normalizedValue as Readonly<{ rows: readonly unknown[]; total: number }>;
    if (value.rows.length > L05_PRIVATE_MARGIN_INTEREST_SIZE) {
      throw new TypeError('Margin interest response exceeds exact page size');
    }
    if (coverage.kind === 'HISTORY_EXPLICIT_WINDOW'
      && value.total !== value.rows.length) {
      reasons.push('MARGIN_INTEREST_HISTORY_PARTIAL_PAGE');
    }
    if (coverage.asset !== null) {
      reasons.push('MARGIN_INTEREST_ASSET_FILTER_PARTIAL');
    }
  }
  return privateSortedUnique(reasons);
}

function rateRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  const row = privateRecord(value, COMMISSION_RATE_FIELDS, label);
  return Object.freeze({
    maker: normalizePrivateNonNegativeDecimal(row.maker, `${label}.maker`),
    taker: normalizePrivateNonNegativeDecimal(row.taker, `${label}.taker`),
    buyer: normalizePrivateNonNegativeDecimal(row.buyer, `${label}.buyer`),
    seller: normalizePrivateNonNegativeDecimal(row.seller, `${label}.seller`),
  });
}

function normalizeStringSet(value: unknown, label: string, maximum = 128): readonly string[] {
  const rows = privateArray(value, label, maximum).map((entry, index) => venueToken(entry, `${label}[${index}]`));
  if (new Set(rows).size !== rows.length) throw new TypeError(`${label} contains duplicate values`);
  return privateSortedUnique(rows);
}

function normalizeRows<T>(
  value: unknown,
  label: string,
  maximum: number,
  parse: (row: unknown, index: number) => Readonly<T>,
  identity: (row: Readonly<T>) => string,
): Readonly<{ rows: readonly Readonly<T>[]; warningCodes: readonly string[] }> {
  const input = privateArray(value, label, maximum);
  const byIdentity = new Map<string, { canonical: string; row: Readonly<T> }>();
  for (let index = 0; index < input.length; index += 1) {
    const row = parse(input[index], index);
    const key = identity(row);
    const canonical = canonicalJson(row);
    const previous = byIdentity.get(key);
    if (previous === undefined) byIdentity.set(key, { canonical, row });
    else if (previous.canonical === canonical) {
      throw new TypeError(`${label} contains duplicate identity ${key}`);
    } else {
      throw new TypeError(`${label} contains conflicting duplicate identity ${key}`);
    }
  }
  const rows = [...byIdentity.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, entry]) => entry.row);
  return Object.freeze({
    rows: Object.freeze(rows),
    warningCodes: Object.freeze([]),
  });
}

function normalizePermissions(value: unknown): NormalizedValue {
  const row = privateRecord(value, PERMISSION_FIELDS, 'permission evidence');
  return Object.freeze({
    value: Object.freeze({
      ipRestrict: privateBoolean(row.ipRestrict, 'permissions.ipRestrict'),
      createTime: utcMillis(row.createTime, 'permissions.createTime'),
      enableReading: privateBoolean(row.enableReading, 'permissions.enableReading'),
      enableWithdrawals: privateBoolean(row.enableWithdrawals, 'permissions.enableWithdrawals'),
      enableInternalTransfer: privateBoolean(row.enableInternalTransfer, 'permissions.enableInternalTransfer'),
      enableMargin: privateBoolean(row.enableMargin, 'permissions.enableMargin'),
      enableFutures: privateBoolean(row.enableFutures, 'permissions.enableFutures'),
      permitsUniversalTransfer: privateBoolean(row.permitsUniversalTransfer, 'permissions.permitsUniversalTransfer'),
      enableVanillaOptions: privateBoolean(row.enableVanillaOptions, 'permissions.enableVanillaOptions'),
      enableFixApiTrade: privateBoolean(row.enableFixApiTrade, 'permissions.enableFixApiTrade'),
      enableFixReadOnly: privateBoolean(row.enableFixReadOnly, 'permissions.enableFixReadOnly'),
      enableSpotAndMarginTrading: privateBoolean(row.enableSpotAndMarginTrading, 'permissions.enableSpotAndMarginTrading'),
      enablePortfolioMarginTrading: privateBoolean(row.enablePortfolioMarginTrading, 'permissions.enablePortfolioMarginTrading'),
    }),
    warningCodes: Object.freeze([]),
    blockingCodes: Object.freeze([]),
  });
}

function normalizeSpotAccount(value: unknown): NormalizedValue {
  const row = privateRecord(value, SPOT_ACCOUNT_FIELDS, 'Spot account');
  const balances = normalizeRows(
    row.balances,
    'spot balances',
    PRIVATE_DATA_BOUNDS.maximumAssets,
    (entry, index) => {
      const balance = privateRecord(entry, SPOT_BALANCE_FIELDS, `spot balances[${index}]`);
      return Object.freeze({
        asset: venueToken(balance.asset, `spot balances[${index}].asset`),
        free: normalizePrivateNonNegativeDecimal(balance.free, `spot balances[${index}].free`),
        locked: normalizePrivateNonNegativeDecimal(balance.locked, `spot balances[${index}].locked`),
      });
    },
    (entry) => (entry as { asset: string }).asset,
  );
  const canTrade = privateBoolean(row.canTrade, 'Spot canTrade');
  const accountType = privateToken(row.accountType, 'Spot accountType');
  const permissions = normalizeStringSet(row.permissions, 'Spot permissions');
  const blockingCodes: string[] = [];
  if (!canTrade) blockingCodes.push('SPOT_ACCOUNT_TRADE_DISABLED');
  if (accountType !== 'SPOT') blockingCodes.push('SPOT_ACCOUNT_TYPE_UNSUPPORTED');
  if (!permissions.includes('SPOT')) blockingCodes.push('SPOT_ACCOUNT_PERMISSION_MISSING');
  return Object.freeze({
    value: Object.freeze({
      makerCommission: privateInteger(row.makerCommission, 'Spot makerCommission'),
      takerCommission: privateInteger(row.takerCommission, 'Spot takerCommission'),
      buyerCommission: privateInteger(row.buyerCommission, 'Spot buyerCommission'),
      sellerCommission: privateInteger(row.sellerCommission, 'Spot sellerCommission'),
      commissionRates: rateRecord(row.commissionRates, 'Spot commissionRates'),
      canTrade,
      canWithdraw: privateBoolean(row.canWithdraw, 'Spot canWithdraw'),
      canDeposit: privateBoolean(row.canDeposit, 'Spot canDeposit'),
      brokered: privateBoolean(row.brokered, 'Spot brokered'),
      requireSelfTradePrevention: privateBoolean(row.requireSelfTradePrevention, 'Spot requireSelfTradePrevention'),
      preventSor: privateBoolean(row.preventSor, 'Spot preventSor'),
      updateTime: utcMillis(row.updateTime, 'Spot updateTime'),
      accountType,
      balances: balances.rows,
      permissions,
      uid: exchangeIntegerId(row.uid, 'Spot uid'),
    }),
    warningCodes: balances.warningCodes,
    blockingCodes: privateSortedUnique(blockingCodes),
  });
}

function recordWithClosedOptionalFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return privateRecord(value, required, label);
  }
  const present = optional.filter((field) => Object.hasOwn(value, field));
  return privateRecord(value, [...required, ...present], label);
}

function optionalUtcOrNegativeOne(value: unknown, label: string): number {
  if (value === -1) return -1;
  return utcMillis(value, label);
}

function parseSpotOrder(value: unknown, index: number): Readonly<Record<string, unknown>> {
  const label = `Spot openOrders[${index}]`;
  const row = recordWithClosedOptionalFields(
    value,
    SPOT_ORDER_FIELDS,
    SPOT_ORDER_CONDITIONAL_FIELDS,
    label,
  );
  const isWorking = privateBoolean(row.isWorking, `${label}.isWorking`);
  const has = (field: string): boolean => Object.hasOwn(row, field);
  const workingTime = has('workingTime')
    ? optionalUtcOrNegativeOne(row.workingTime, `${label}.workingTime`)
    : null;
  if (isWorking && (workingTime === null || workingTime === -1)) {
    throw new TypeError(`${label}.workingTime must identify when a working order entered the book`);
  }
  if (!isWorking && workingTime !== null && workingTime !== -1) {
    throw new TypeError(`${label}.workingTime cannot claim a book time for a non-working order`);
  }
  if (has('trailingTime') && !has('trailingDelta')) {
    throw new TypeError(`${label}.trailingTime requires trailingDelta`);
  }
  const hasPegDefinition = has('pegPriceType');
  if ((has('peggedPrice') || has('pegOffsetType') || has('pegOffsetValue'))
    && !hasPegDefinition) {
    throw new TypeError(`${label} pegged fields require pegPriceType`);
  }
  if (has('pegOffsetType') !== has('pegOffsetValue')) {
    throw new TypeError(`${label} peg offset fields must be retained together`);
  }
  const status = enumText(row.status, `${label}.status`, [
    'NEW', 'PENDING_NEW', 'PARTIALLY_FILLED',
  ]);
  if (status === 'PENDING_NEW'
    && (isWorking || (workingTime !== null && workingTime !== -1))) {
    throw new TypeError(`${label} PENDING_NEW order cannot claim a working book placement`);
  }
  const timeInForce = enumText(row.timeInForce, `${label}.timeInForce`, [
    'GTC', 'IOC', 'FOK',
  ]);
  const type = enumText(row.type, `${label}.type`, [
    'LIMIT', 'MARKET', 'STOP_LOSS', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT',
    'TAKE_PROFIT_LIMIT', 'LIMIT_MAKER',
  ]);
  const nonTimeInForceTypes = ['MARKET', 'STOP_LOSS', 'TAKE_PROFIT', 'LIMIT_MAKER'];
  if (nonTimeInForceTypes.includes(type) && timeInForce !== 'GTC') {
    throw new TypeError(`${label}.timeInForce is incompatible with its order type`);
  }
  const conditionalTypes = [
    'STOP_LOSS', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT', 'TAKE_PROFIT_LIMIT',
  ];
  const stopPrice = has('stopPrice')
    ? normalizePrivateNonNegativeDecimal(row.stopPrice, `${label}.stopPrice`)
    : null;
  const stopPriceActive = stopPrice !== null && stopPrice !== '0';
  const trailingActive = has('trailingDelta');
  if ((stopPriceActive || trailingActive) !== conditionalTypes.includes(type)) {
    throw new TypeError(`${label} stop/trailing fields do not match its order type`);
  }
  const icebergTypes = ['LIMIT', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT_LIMIT', 'LIMIT_MAKER'];
  const icebergQty = has('icebergQty')
    ? normalizePrivateNonNegativeDecimal(row.icebergQty, `${label}.icebergQty`)
    : null;
  const icebergActive = icebergQty !== null && icebergQty !== '0';
  if (icebergActive && (!icebergTypes.includes(type) || timeInForce !== 'GTC')) {
    throw new TypeError(`${label}.icebergQty requires a GTC iceberg-capable order type`);
  }
  const pegTypes = ['LIMIT', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT_LIMIT', 'LIMIT_MAKER'];
  if (hasPegDefinition && !pegTypes.includes(type)) {
    throw new TypeError(`${label}.pegPriceType is incompatible with its order type`);
  }
  if (has('peggedPrice') && (!isWorking || workingTime === null || workingTime === -1)) {
    throw new TypeError(`${label}.peggedPrice requires a working book placement`);
  }
  const output: Record<string, unknown> = {
    symbol: venueToken(row.symbol, `${label}.symbol`),
    orderId: exchangeIntegerId(row.orderId, `${label}.orderId`),
    orderListId: exchangeIntegerId(row.orderListId, `${label}.orderListId`, true),
    clientOrderId: binanceClientOrderId(row.clientOrderId, `${label}.clientOrderId`),
    price: normalizePrivateNonNegativeDecimal(row.price, `${label}.price`),
    origQty: normalizePrivateNonNegativeDecimal(row.origQty, `${label}.origQty`),
    executedQty: normalizePrivateNonNegativeDecimal(row.executedQty, `${label}.executedQty`),
    cummulativeQuoteQty: normalizePrivateNonNegativeDecimal(row.cummulativeQuoteQty, `${label}.cummulativeQuoteQty`),
    status,
    timeInForce,
    type,
    side: enumText(row.side, `${label}.side`, ['BUY', 'SELL']),
    time: utcMillis(row.time, `${label}.time`),
    updateTime: utcMillis(row.updateTime, `${label}.updateTime`),
    isWorking,
    origQuoteOrderQty: normalizePrivateNonNegativeDecimal(row.origQuoteOrderQty, `${label}.origQuoteOrderQty`),
    selfTradePreventionMode: enumText(
      row.selfTradePreventionMode,
      `${label}.selfTradePreventionMode`,
      ['NONE', 'EXPIRE_MAKER', 'EXPIRE_TAKER', 'EXPIRE_BOTH', 'DECREMENT', 'TRANSFER'],
    ),
  };
  if (stopPrice !== null) output.stopPrice = stopPrice;
  if (icebergQty !== null) output.icebergQty = icebergQty;
  if (workingTime !== null) output.workingTime = workingTime;
  if (has('strategyId')) output.strategyId = exchangeIntegerId(row.strategyId, `${label}.strategyId`);
  if (has('strategyType')) {
    output.strategyType = privateInteger(
      row.strategyType,
      `${label}.strategyType`,
      1_000_000,
      Number.MAX_SAFE_INTEGER,
    );
  }
  if (has('trailingDelta')) {
    output.trailingDelta = privateInteger(
      row.trailingDelta,
      `${label}.trailingDelta`,
      1,
      Number.MAX_SAFE_INTEGER,
    );
  }
  if (has('trailingTime')) output.trailingTime = optionalUtcOrNegativeOne(row.trailingTime, `${label}.trailingTime`);
  if (has('usedSor')) output.usedSor = privateBoolean(row.usedSor, `${label}.usedSor`);
  if (has('workingFloor')) {
    output.workingFloor = enumText(
      row.workingFloor,
      `${label}.workingFloor`,
      ['EXCHANGE', 'SOR'],
    );
  }
  if (hasPegDefinition) {
    output.pegPriceType = enumText(
      row.pegPriceType,
      `${label}.pegPriceType`,
      ['PRIMARY_PEG', 'MARKET_PEG'],
    );
  }
  if (has('peggedPrice')) output.peggedPrice = normalizePrivateNonNegativeDecimal(row.peggedPrice, `${label}.peggedPrice`);
  if (has('pegOffsetType')) {
    output.pegOffsetType = enumText(
      row.pegOffsetType,
      `${label}.pegOffsetType`,
      ['PRICE_LEVEL'],
    );
    output.pegOffsetValue = privateInteger(
      row.pegOffsetValue,
      `${label}.pegOffsetValue`,
      0,
      100,
    );
  }
  return Object.freeze(output);
}

function normalizeSpotOrders(value: unknown): NormalizedValue {
  const rows = normalizeRows(
    value,
    'spot open orders',
    PRIVATE_DATA_BOUNDS.maximumOrders,
    parseSpotOrder,
    (entry) => `${String((entry as PlainRecord).symbol)}:${String((entry as PlainRecord).orderId)}`,
  );
  return Object.freeze({ value: rows.rows, warningCodes: rows.warningCodes, blockingCodes: Object.freeze([]) });
}

function parseSpotTrade(value: unknown, index: number): Readonly<Record<string, unknown>> {
  const label = `Spot trades[${index}]`;
  const row = privateRecord(value, SPOT_TRADE_FIELDS, label);
  return Object.freeze({
    symbol: venueToken(row.symbol, `${label}.symbol`),
    id: exchangeIntegerId(row.id, `${label}.id`),
    orderId: exchangeIntegerId(row.orderId, `${label}.orderId`),
    orderListId: exchangeIntegerId(row.orderListId, `${label}.orderListId`, true),
    price: normalizePrivateNonNegativeDecimal(row.price, `${label}.price`),
    qty: normalizePrivateNonNegativeDecimal(row.qty, `${label}.qty`),
    quoteQty: normalizePrivateNonNegativeDecimal(row.quoteQty, `${label}.quoteQty`),
    commission: normalizePrivateNonNegativeDecimal(row.commission, `${label}.commission`),
    commissionAsset: venueToken(row.commissionAsset, `${label}.commissionAsset`),
    time: utcMillis(row.time, `${label}.time`),
    isBuyer: privateBoolean(row.isBuyer, `${label}.isBuyer`),
    isMaker: privateBoolean(row.isMaker, `${label}.isMaker`),
    isBestMatch: privateBoolean(row.isBestMatch, `${label}.isBestMatch`),
  });
}

function normalizeSpotTrades(value: unknown): NormalizedValue {
  const rows = normalizeRows(
    value,
    'spot trades',
    PRIVATE_DATA_BOUNDS.maximumTrades,
    parseSpotTrade,
    (entry) => `${String((entry as PlainRecord).symbol)}:${String((entry as PlainRecord).id)}`,
  );
  return Object.freeze({ value: rows.rows, warningCodes: rows.warningCodes, blockingCodes: Object.freeze([]) });
}

function normalizeSpotCommissions(value: unknown): NormalizedValue {
  const row = privateRecord(value, SPOT_COMMISSION_FIELDS, 'Spot commissions');
  const discount = privateRecord(row.discount, SPOT_DISCOUNT_FIELDS, 'Spot commissions.discount');
  return Object.freeze({
    value: Object.freeze({
      symbol: venueToken(row.symbol, 'Spot commissions.symbol'),
      standardCommission: rateRecord(row.standardCommission, 'Spot standardCommission'),
      specialCommission: rateRecord(row.specialCommission, 'Spot specialCommission'),
      taxCommission: rateRecord(row.taxCommission, 'Spot taxCommission'),
      discount: Object.freeze({
        enabledForAccount: privateBoolean(discount.enabledForAccount, 'Spot discount.enabledForAccount'),
        enabledForSymbol: privateBoolean(discount.enabledForSymbol, 'Spot discount.enabledForSymbol'),
        discountAsset: venueToken(discount.discountAsset, 'Spot discount.discountAsset'),
        discount: normalizePrivateNonNegativeDecimal(discount.discount, 'Spot discount.discount'),
      }),
    }),
    warningCodes: Object.freeze([]),
    blockingCodes: Object.freeze([]),
  });
}

function normalizeAccountStatus(value: unknown): NormalizedValue {
  const row = privateRecord(value, ACCOUNT_STATUS_FIELDS, 'account status');
  const status = privateString(row.data, 'account status.data', 64);
  return Object.freeze({
    value: Object.freeze({ data: status }),
    warningCodes: Object.freeze([]),
    blockingCodes: status === 'Normal' ? Object.freeze([]) : Object.freeze(['ACCOUNT_STATUS_NOT_NORMAL']),
  });
}

function normalizeTradingStatus(value: unknown): NormalizedValue {
  const row = privateRecord(value, TRADING_STATUS_FIELDS, 'API trading status');
  const data = privateRecord(row.data, TRADING_STATUS_DATA_FIELDS, 'API trading status.data');
  const trigger = privateRecord(data.triggerCondition, TRIGGER_CONDITION_FIELDS, 'API trading status.triggerCondition');
  const locked = privateBoolean(data.isLocked, 'API trading status.isLocked');
  return Object.freeze({
    value: Object.freeze({
      data: Object.freeze({
        isLocked: locked,
        plannedRecoverTime: nullableUtcMillis(data.plannedRecoverTime, 'API trading status.plannedRecoverTime'),
        triggerCondition: Object.freeze({
          GCR: privateInteger(trigger.GCR, 'API trading status.triggerCondition.GCR'),
          IFER: privateInteger(trigger.IFER, 'API trading status.triggerCondition.IFER'),
          UFR: privateInteger(trigger.UFR, 'API trading status.triggerCondition.UFR'),
        }),
        updateTime: utcMillis(data.updateTime, 'API trading status.updateTime'),
      }),
    }),
    warningCodes: Object.freeze([]),
    blockingCodes: locked ? Object.freeze(['API_TRADING_LOCKED']) : Object.freeze([]),
  });
}

function parseUsdmAccountAsset(value: unknown, index: number): Readonly<Record<string, unknown>> {
  const label = `USD-M account.assets[${index}]`;
  const row = privateRecord(value, USDM_ACCOUNT_ASSET_FIELDS, label);
  return Object.freeze({
    asset: venueToken(row.asset, `${label}.asset`),
    walletBalance: normalizePrivateExactDecimal(row.walletBalance, `${label}.walletBalance`),
    unrealizedProfit: normalizePrivateExactDecimal(row.unrealizedProfit, `${label}.unrealizedProfit`),
    marginBalance: normalizePrivateExactDecimal(row.marginBalance, `${label}.marginBalance`),
    maintMargin: normalizePrivateNonNegativeDecimal(row.maintMargin, `${label}.maintMargin`),
    initialMargin: normalizePrivateNonNegativeDecimal(row.initialMargin, `${label}.initialMargin`),
    positionInitialMargin: normalizePrivateNonNegativeDecimal(row.positionInitialMargin, `${label}.positionInitialMargin`),
    openOrderInitialMargin: normalizePrivateNonNegativeDecimal(row.openOrderInitialMargin, `${label}.openOrderInitialMargin`),
    crossWalletBalance: normalizePrivateExactDecimal(row.crossWalletBalance, `${label}.crossWalletBalance`),
    crossUnPnl: normalizePrivateExactDecimal(row.crossUnPnl, `${label}.crossUnPnl`),
    availableBalance: normalizePrivateExactDecimal(row.availableBalance, `${label}.availableBalance`),
    maxWithdrawAmount: normalizePrivateNonNegativeDecimal(row.maxWithdrawAmount, `${label}.maxWithdrawAmount`),
    updateTime: utcMillis(row.updateTime, `${label}.updateTime`),
  });
}

function parseUsdmAccountPosition(value: unknown, index: number): Readonly<Record<string, unknown>> {
  const label = `USD-M account.positions[${index}]`;
  const row = privateRecord(value, USDM_ACCOUNT_POSITION_FIELDS, label);
  return Object.freeze({
    symbol: venueToken(row.symbol, `${label}.symbol`),
    positionSide: enumText(row.positionSide, `${label}.positionSide`, ['BOTH', 'LONG', 'SHORT']),
    positionAmt: normalizePrivateExactDecimal(row.positionAmt, `${label}.positionAmt`),
    unrealizedProfit: normalizePrivateExactDecimal(row.unrealizedProfit, `${label}.unrealizedProfit`),
    isolatedMargin: normalizePrivateNonNegativeDecimal(row.isolatedMargin, `${label}.isolatedMargin`),
    notional: normalizePrivateExactDecimal(row.notional, `${label}.notional`),
    isolatedWallet: normalizePrivateNonNegativeDecimal(row.isolatedWallet, `${label}.isolatedWallet`),
    initialMargin: normalizePrivateNonNegativeDecimal(row.initialMargin, `${label}.initialMargin`),
    maintMargin: normalizePrivateNonNegativeDecimal(row.maintMargin, `${label}.maintMargin`),
    updateTime: utcMillis(row.updateTime, `${label}.updateTime`),
  });
}

function normalizeUsdmAccount(value: unknown): NormalizedValue {
  const row = privateRecord(value, USDM_ACCOUNT_FIELDS, 'USD-M account');
  const assets = normalizeRows(row.assets, 'usd-m account assets', PRIVATE_DATA_BOUNDS.maximumAssets,
    parseUsdmAccountAsset, (entry) => String((entry as PlainRecord).asset));
  const positions = normalizeRows(row.positions, 'usd-m account positions', PRIVATE_DATA_BOUNDS.maximumPositions,
    parseUsdmAccountPosition,
    (entry) => `${String((entry as PlainRecord).symbol)}:${String((entry as PlainRecord).positionSide)}`);
  return Object.freeze({
    value: Object.freeze({
      totalInitialMargin: normalizePrivateNonNegativeDecimal(row.totalInitialMargin, 'USD-M totalInitialMargin'),
      totalMaintMargin: normalizePrivateNonNegativeDecimal(row.totalMaintMargin, 'USD-M totalMaintMargin'),
      totalWalletBalance: normalizePrivateExactDecimal(row.totalWalletBalance, 'USD-M totalWalletBalance'),
      totalUnrealizedProfit: normalizePrivateExactDecimal(row.totalUnrealizedProfit, 'USD-M totalUnrealizedProfit'),
      totalMarginBalance: normalizePrivateExactDecimal(row.totalMarginBalance, 'USD-M totalMarginBalance'),
      totalPositionInitialMargin: normalizePrivateNonNegativeDecimal(row.totalPositionInitialMargin, 'USD-M totalPositionInitialMargin'),
      totalOpenOrderInitialMargin: normalizePrivateNonNegativeDecimal(row.totalOpenOrderInitialMargin, 'USD-M totalOpenOrderInitialMargin'),
      totalCrossWalletBalance: normalizePrivateExactDecimal(row.totalCrossWalletBalance, 'USD-M totalCrossWalletBalance'),
      totalCrossUnPnl: normalizePrivateExactDecimal(row.totalCrossUnPnl, 'USD-M totalCrossUnPnl'),
      availableBalance: normalizePrivateExactDecimal(row.availableBalance, 'USD-M availableBalance'),
      maxWithdrawAmount: normalizePrivateNonNegativeDecimal(row.maxWithdrawAmount, 'USD-M maxWithdrawAmount'),
      assets: assets.rows,
      positions: positions.rows,
    }),
    warningCodes: privateSortedUnique([...assets.warningCodes, ...positions.warningCodes]),
    blockingCodes: Object.freeze([]),
  });
}

function parseUsdmBalance(value: unknown, index: number): Readonly<Record<string, unknown>> {
  const label = `USD-M balance[${index}]`;
  const row = privateRecord(value, USDM_BALANCE_FIELDS, label);
  return Object.freeze({
    accountAlias: privateIdentifier(row.accountAlias, `${label}.accountAlias`),
    asset: venueToken(row.asset, `${label}.asset`),
    balance: normalizePrivateExactDecimal(row.balance, `${label}.balance`),
    crossWalletBalance: normalizePrivateExactDecimal(row.crossWalletBalance, `${label}.crossWalletBalance`),
    crossUnPnl: normalizePrivateExactDecimal(row.crossUnPnl, `${label}.crossUnPnl`),
    availableBalance: normalizePrivateExactDecimal(row.availableBalance, `${label}.availableBalance`),
    maxWithdrawAmount: normalizePrivateNonNegativeDecimal(row.maxWithdrawAmount, `${label}.maxWithdrawAmount`),
    marginAvailable: row.marginAvailable === null ? null : privateBoolean(row.marginAvailable, `${label}.marginAvailable`),
    updateTime: utcMillis(row.updateTime, `${label}.updateTime`),
  });
}

function normalizeUsdmBalances(value: unknown): NormalizedValue {
  const rows = normalizeRows(value, 'usd-m balances', PRIVATE_DATA_BOUNDS.maximumAssets,
    parseUsdmBalance, (entry) => String((entry as PlainRecord).asset));
  return Object.freeze({ value: rows.rows, warningCodes: rows.warningCodes, blockingCodes: Object.freeze([]) });
}

function parseUsdmPosition(value: unknown, index: number): Readonly<Record<string, unknown>> {
  const label = `USD-M positions[${index}]`;
  const row = privateRecord(value, USDM_POSITION_FIELDS, label);
  return Object.freeze({
    symbol: venueToken(row.symbol, `${label}.symbol`),
    positionSide: enumText(row.positionSide, `${label}.positionSide`, ['BOTH', 'LONG', 'SHORT']),
    positionAmt: normalizePrivateExactDecimal(row.positionAmt, `${label}.positionAmt`),
    entryPrice: normalizePrivateNonNegativeDecimal(row.entryPrice, `${label}.entryPrice`),
    breakEvenPrice: normalizePrivateNonNegativeDecimal(row.breakEvenPrice, `${label}.breakEvenPrice`),
    markPrice: normalizePrivateNonNegativeDecimal(row.markPrice, `${label}.markPrice`),
    unRealizedProfit: normalizePrivateExactDecimal(row.unRealizedProfit, `${label}.unRealizedProfit`),
    liquidationPrice: normalizePrivateNonNegativeDecimal(row.liquidationPrice, `${label}.liquidationPrice`),
    isolatedMargin: normalizePrivateNonNegativeDecimal(row.isolatedMargin, `${label}.isolatedMargin`),
    notional: normalizePrivateExactDecimal(row.notional, `${label}.notional`),
    marginAsset: venueToken(row.marginAsset, `${label}.marginAsset`),
    isolatedWallet: normalizePrivateNonNegativeDecimal(row.isolatedWallet, `${label}.isolatedWallet`),
    initialMargin: normalizePrivateNonNegativeDecimal(row.initialMargin, `${label}.initialMargin`),
    maintMargin: normalizePrivateNonNegativeDecimal(row.maintMargin, `${label}.maintMargin`),
    positionInitialMargin: normalizePrivateNonNegativeDecimal(row.positionInitialMargin, `${label}.positionInitialMargin`),
    openOrderInitialMargin: normalizePrivateNonNegativeDecimal(row.openOrderInitialMargin, `${label}.openOrderInitialMargin`),
    adl: privateInteger(row.adl, `${label}.adl`, 0, 4),
    bidNotional: normalizePrivateNonNegativeDecimal(row.bidNotional, `${label}.bidNotional`),
    askNotional: normalizePrivateNonNegativeDecimal(row.askNotional, `${label}.askNotional`),
    updateTime: utcMillis(row.updateTime, `${label}.updateTime`),
  });
}

function normalizeUsdmPositions(value: unknown): NormalizedValue {
  const rows = normalizeRows(value, 'usd-m positions', PRIVATE_DATA_BOUNDS.maximumPositions,
    parseUsdmPosition,
    (entry) => `${String((entry as PlainRecord).symbol)}:${String((entry as PlainRecord).positionSide)}`);
  return Object.freeze({ value: rows.rows, warningCodes: rows.warningCodes, blockingCodes: Object.freeze([]) });
}

function parseUsdmOrder(value: unknown, index: number): Readonly<Record<string, unknown>> {
  const label = `USD-M openOrders[${index}]`;
  const row = privateRecord(value, USDM_ORDER_FIELDS, label);
  const status = enumText(row.status, `${label}.status`, ['NEW', 'PARTIALLY_FILLED']);
  const timeInForce = enumText(row.timeInForce, `${label}.timeInForce`, [
    'GTC', 'IOC', 'FOK', 'GTX', 'GTD', 'RPI',
  ]);
  const type = enumText(row.type, `${label}.type`, [
    'LIMIT', 'MARKET', 'STOP', 'STOP_MARKET', 'TAKE_PROFIT',
    'TAKE_PROFIT_MARKET', 'TRAILING_STOP_MARKET',
  ]);
  const origType = enumText(row.origType, `${label}.origType`, [
    'LIMIT', 'MARKET', 'STOP', 'STOP_MARKET', 'TAKE_PROFIT',
    'TAKE_PROFIT_MARKET', 'TRAILING_STOP_MARKET',
  ]);
  if (type !== origType) {
    throw new TypeError(`${label}.type cannot substitute a different original order type`);
  }
  const price = normalizePrivateNonNegativeDecimal(row.price, `${label}.price`);
  const origQty = normalizePrivateNonNegativeDecimal(row.origQty, `${label}.origQty`);
  const reduceOnly = privateBoolean(row.reduceOnly, `${label}.reduceOnly`);
  const closePosition = privateBoolean(row.closePosition, `${label}.closePosition`);
  const positionSide = enumText(
    row.positionSide,
    `${label}.positionSide`,
    ['BOTH', 'LONG', 'SHORT'],
  );
  const stopPrice = normalizePrivateNonNegativeDecimal(row.stopPrice, `${label}.stopPrice`);
  const activatePrice = normalizePrivateNonNegativeDecimal(
    row.activatePrice,
    `${label}.activatePrice`,
  );
  const priceRate = normalizePrivateNonNegativeDecimal(row.priceRate, `${label}.priceRate`);
  const workingType = enumText(
    row.workingType,
    `${label}.workingType`,
    ['MARK_PRICE', 'CONTRACT_PRICE'],
  );
  const priceProtect = privateBoolean(row.priceProtect, `${label}.priceProtect`);
  const priceMatch = enumText(row.priceMatch, `${label}.priceMatch`, [
    'NONE',
    'OPPONENT', 'OPPONENT_5', 'OPPONENT_10', 'OPPONENT_20',
    'QUEUE', 'QUEUE_5', 'QUEUE_10', 'QUEUE_20',
  ]);
  const selfTradePreventionMode = enumText(
    row.selfTradePreventionMode,
    `${label}.selfTradePreventionMode`,
    ['NONE', 'EXPIRE_TAKER', 'EXPIRE_MAKER', 'EXPIRE_BOTH'],
  );
  const goodTillDate = privateInteger(row.goodTillDate, `${label}.goodTillDate`);

  const priceBearingTypes = ['LIMIT', 'STOP', 'TAKE_PROFIT'];
  const triggerPriceTypes = ['STOP', 'STOP_MARKET', 'TAKE_PROFIT', 'TAKE_PROFIT_MARKET'];
  const closeAllTypes = ['STOP_MARKET', 'TAKE_PROFIT_MARKET'];
  const trailing = type === 'TRAILING_STOP_MARKET';
  if (!priceBearingTypes.includes(type) && timeInForce !== 'GTC') {
    throw new TypeError(`${label}.timeInForce is incompatible with its order type`);
  }
  if (timeInForce === 'RPI' && type !== 'LIMIT') {
    throw new TypeError(`${label}.RPI timeInForce requires a LIMIT order`);
  }
  if ((timeInForce === 'GTD') !== (goodTillDate > 0)) {
    throw new TypeError(`${label}.goodTillDate must be present only for GTD orders`);
  }
  if ((stopPrice !== '0') !== triggerPriceTypes.includes(type)) {
    throw new TypeError(`${label}.stopPrice does not match its order type`);
  }
  if ((activatePrice !== '0' || priceRate !== '0') !== trailing
    || (trailing && (activatePrice === '0' || priceRate === '0'))) {
    throw new TypeError(`${label} trailing fields do not match its order type`);
  }
  if (closePosition
    && (!closeAllTypes.includes(type) || reduceOnly || origQty !== '0')) {
    throw new TypeError(`${label}.closePosition has an incompatible type, quantity, or reduce-only flag`);
  }
  if (positionSide !== 'BOTH' && reduceOnly) {
    throw new TypeError(`${label}.reduceOnly is incompatible with a hedge-side order`);
  }
  if (priceProtect && !triggerPriceTypes.includes(type)) {
    throw new TypeError(`${label}.priceProtect is incompatible with its order type`);
  }
  if (priceMatch !== 'NONE'
    && (!priceBearingTypes.includes(type) || price !== '0')) {
    throw new TypeError(`${label}.priceMatch requires a price-capable order without an explicit price`);
  }
  return Object.freeze({
    symbol: venueToken(row.symbol, `${label}.symbol`),
    orderId: exchangeIntegerId(row.orderId, `${label}.orderId`),
    clientOrderId: binanceClientOrderId(row.clientOrderId, `${label}.clientOrderId`),
    price,
    avgPrice: normalizePrivateNonNegativeDecimal(row.avgPrice, `${label}.avgPrice`),
    origQty,
    executedQty: normalizePrivateNonNegativeDecimal(row.executedQty, `${label}.executedQty`),
    cumQuote: normalizePrivateNonNegativeDecimal(row.cumQuote, `${label}.cumQuote`),
    status,
    timeInForce,
    type,
    origType,
    side: enumText(row.side, `${label}.side`, ['BUY', 'SELL']),
    positionSide,
    reduceOnly,
    closePosition,
    stopPrice,
    activatePrice,
    priceRate,
    time: utcMillis(row.time, `${label}.time`),
    updateTime: utcMillis(row.updateTime, `${label}.updateTime`),
    workingType,
    priceProtect,
    priceMatch,
    selfTradePreventionMode,
    goodTillDate,
  });
}

function normalizeUsdmOrders(value: unknown): NormalizedValue {
  const rows = normalizeRows(value, 'usd-m open orders', PRIVATE_DATA_BOUNDS.maximumOrders,
    parseUsdmOrder,
    (entry) => `${String((entry as PlainRecord).symbol)}:${String((entry as PlainRecord).orderId)}`);
  return Object.freeze({ value: rows.rows, warningCodes: rows.warningCodes, blockingCodes: Object.freeze([]) });
}

function parseUsdmTrade(value: unknown, index: number): Readonly<Record<string, unknown>> {
  const label = `USD-M trades[${index}]`;
  const row = privateRecord(value, USDM_TRADE_FIELDS, label);
  return Object.freeze({
    symbol: venueToken(row.symbol, `${label}.symbol`),
    id: exchangeIntegerId(row.id, `${label}.id`),
    orderId: exchangeIntegerId(row.orderId, `${label}.orderId`),
    price: normalizePrivateNonNegativeDecimal(row.price, `${label}.price`),
    qty: normalizePrivateNonNegativeDecimal(row.qty, `${label}.qty`),
    quoteQty: normalizePrivateNonNegativeDecimal(row.quoteQty, `${label}.quoteQty`),
    commission: normalizePrivateNonNegativeDecimal(row.commission, `${label}.commission`),
    commissionAsset: venueToken(row.commissionAsset, `${label}.commissionAsset`),
    realizedPnl: normalizePrivateExactDecimal(row.realizedPnl, `${label}.realizedPnl`),
    side: enumText(row.side, `${label}.side`, ['BUY', 'SELL']),
    positionSide: enumText(row.positionSide, `${label}.positionSide`, ['BOTH', 'LONG', 'SHORT']),
    buyer: privateBoolean(row.buyer, `${label}.buyer`),
    maker: privateBoolean(row.maker, `${label}.maker`),
    time: utcMillis(row.time, `${label}.time`),
  });
}

function normalizeUsdmTrades(value: unknown): NormalizedValue {
  const rows = normalizeRows(value, 'usd-m trades', PRIVATE_DATA_BOUNDS.maximumTrades,
    parseUsdmTrade,
    (entry) => `${String((entry as PlainRecord).symbol)}:${String((entry as PlainRecord).id)}`);
  return Object.freeze({ value: rows.rows, warningCodes: rows.warningCodes, blockingCodes: Object.freeze([]) });
}

function normalizeUsdmMode(value: unknown, kind: 'POSITION' | 'MULTI_ASSETS'): NormalizedValue {
  const fields = kind === 'POSITION' ? USDM_POSITION_MODE_FIELDS : USDM_MULTI_ASSETS_FIELDS;
  const row = privateRecord(value, fields, `USD-M ${kind.toLowerCase()} mode`);
  const field = kind === 'POSITION' ? 'dualSidePosition' : 'multiAssetsMargin';
  const enabled = privateBoolean(row[field], `USD-M ${field}`);
  return Object.freeze({
    value: Object.freeze({ [field]: enabled }),
    warningCodes: Object.freeze([]),
    blockingCodes: enabled
      ? Object.freeze([kind === 'POSITION' ? 'USDM_HEDGE_MODE_UNSUPPORTED' : 'USDM_MULTI_ASSETS_MODE_UNSUPPORTED'])
      : Object.freeze([]),
  });
}

function parseMarginCrossAsset(value: unknown, index: number): Readonly<Record<string, unknown>> {
  const label = `Margin cross.userAssets[${index}]`;
  const row = privateRecord(value, MARGIN_CROSS_ASSET_FIELDS, label);
  return Object.freeze({
    asset: venueToken(row.asset, `${label}.asset`),
    borrowed: normalizePrivateNonNegativeDecimal(row.borrowed, `${label}.borrowed`),
    free: normalizePrivateNonNegativeDecimal(row.free, `${label}.free`),
    interest: normalizePrivateNonNegativeDecimal(row.interest, `${label}.interest`),
    locked: normalizePrivateNonNegativeDecimal(row.locked, `${label}.locked`),
    netAsset: normalizePrivateExactDecimal(row.netAsset, `${label}.netAsset`),
  });
}

function normalizeMarginCross(value: unknown): NormalizedValue {
  const row = privateRecord(value, MARGIN_CROSS_FIELDS, 'Margin cross account');
  const assets = normalizeRows(row.userAssets, 'margin cross assets', PRIVATE_DATA_BOUNDS.maximumAssets,
    parseMarginCrossAsset, (entry) => String((entry as PlainRecord).asset));
  const accountType = enumText(row.accountType, 'Margin cross accountType', ['MARGIN_1', 'MARGIN_2']);
  const created = privateBoolean(row.created, 'Margin cross.created');
  const borrowEnabled = privateBoolean(row.borrowEnabled, 'Margin cross.borrowEnabled');
  const tradeEnabled = privateBoolean(row.tradeEnabled, 'Margin cross.tradeEnabled');
  const blockingCodes: string[] = [];
  if (accountType === 'MARGIN_2') blockingCodes.push('MARGIN_CROSS_PRO_POSTURE_UNRESOLVED');
  if (!created) blockingCodes.push('MARGIN_CROSS_ACCOUNT_NOT_CREATED');
  if (!borrowEnabled) blockingCodes.push('MARGIN_CROSS_BORROW_DISABLED');
  if (!tradeEnabled) blockingCodes.push('MARGIN_CROSS_TRADE_DISABLED');
  return Object.freeze({
    value: Object.freeze({
      created,
      borrowEnabled,
      marginLevel: normalizePrivateNonNegativeDecimal(row.marginLevel, 'Margin cross.marginLevel'),
      collateralMarginLevel: normalizePrivateNonNegativeDecimal(row.collateralMarginLevel, 'Margin cross.collateralMarginLevel'),
      totalAssetOfBtc: normalizePrivateNonNegativeDecimal(row.totalAssetOfBtc, 'Margin cross.totalAssetOfBtc'),
      totalLiabilityOfBtc: normalizePrivateNonNegativeDecimal(row.totalLiabilityOfBtc, 'Margin cross.totalLiabilityOfBtc'),
      totalNetAssetOfBtc: normalizePrivateExactDecimal(row.totalNetAssetOfBtc, 'Margin cross.totalNetAssetOfBtc'),
      TotalCollateralValueInUSDT: normalizePrivateNonNegativeDecimal(row.TotalCollateralValueInUSDT, 'Margin cross.TotalCollateralValueInUSDT'),
      totalOpenOrderLossInUSDT: normalizePrivateNonNegativeDecimal(row.totalOpenOrderLossInUSDT, 'Margin cross.totalOpenOrderLossInUSDT'),
      tradeEnabled,
      transferInEnabled: privateBoolean(row.transferInEnabled, 'Margin cross.transferInEnabled'),
      transferOutEnabled: privateBoolean(row.transferOutEnabled, 'Margin cross.transferOutEnabled'),
      accountType,
      userAssets: assets.rows,
    }),
    warningCodes: assets.warningCodes,
    blockingCodes: privateSortedUnique(blockingCodes),
  });
}

function parseMarginIsolatedAsset(value: unknown, label: string): Readonly<Record<string, unknown>> {
  const row = privateRecord(value, MARGIN_ISOLATED_ASSET_FIELDS, label);
  return Object.freeze({
    asset: venueToken(row.asset, `${label}.asset`),
    borrowEnabled: privateBoolean(row.borrowEnabled, `${label}.borrowEnabled`),
    borrowed: normalizePrivateNonNegativeDecimal(row.borrowed, `${label}.borrowed`),
    free: normalizePrivateNonNegativeDecimal(row.free, `${label}.free`),
    interest: normalizePrivateNonNegativeDecimal(row.interest, `${label}.interest`),
    locked: normalizePrivateNonNegativeDecimal(row.locked, `${label}.locked`),
    netAsset: normalizePrivateExactDecimal(row.netAsset, `${label}.netAsset`),
    netAssetOfBtc: normalizePrivateExactDecimal(row.netAssetOfBtc, `${label}.netAssetOfBtc`),
    repayEnabled: privateBoolean(row.repayEnabled, `${label}.repayEnabled`),
    totalAsset: normalizePrivateNonNegativeDecimal(row.totalAsset, `${label}.totalAsset`),
  });
}

function parseMarginIsolatedPair(value: unknown, index: number): Readonly<Record<string, unknown>> {
  const label = `Margin isolated.assets[${index}]`;
  const row = privateRecord(value, MARGIN_ISOLATED_PAIR_FIELDS, label);
  return Object.freeze({
    baseAsset: parseMarginIsolatedAsset(row.baseAsset, `${label}.baseAsset`),
    quoteAsset: parseMarginIsolatedAsset(row.quoteAsset, `${label}.quoteAsset`),
    symbol: venueToken(row.symbol, `${label}.symbol`),
    isolatedCreated: privateBoolean(row.isolatedCreated, `${label}.isolatedCreated`),
    enabled: privateBoolean(row.enabled, `${label}.enabled`),
    marginLevel: normalizePrivateNonNegativeDecimal(row.marginLevel, `${label}.marginLevel`),
    marginLevelStatus: privateToken(row.marginLevelStatus, `${label}.marginLevelStatus`),
    marginRatio: normalizePrivateNonNegativeDecimal(row.marginRatio, `${label}.marginRatio`),
    indexPrice: normalizePrivateNonNegativeDecimal(row.indexPrice, `${label}.indexPrice`),
    liquidatePrice: normalizePrivateNonNegativeDecimal(row.liquidatePrice, `${label}.liquidatePrice`),
    liquidateRate: normalizePrivateNonNegativeDecimal(row.liquidateRate, `${label}.liquidateRate`),
    tradeEnabled: privateBoolean(row.tradeEnabled, `${label}.tradeEnabled`),
  });
}

function normalizeMarginIsolated(value: unknown): NormalizedValue {
  const row = privateRecord(value, MARGIN_ISOLATED_FIELDS, 'Margin isolated account');
  const pairs = normalizeRows(row.assets, 'margin isolated pairs', PRIVATE_DATA_BOUNDS.maximumPositions,
    parseMarginIsolatedPair, (entry) => String((entry as PlainRecord).symbol));
  return Object.freeze({
    value: Object.freeze({
      assets: pairs.rows,
      totalAssetOfBtc: normalizePrivateNonNegativeDecimal(row.totalAssetOfBtc, 'Margin isolated.totalAssetOfBtc'),
      totalLiabilityOfBtc: normalizePrivateNonNegativeDecimal(row.totalLiabilityOfBtc, 'Margin isolated.totalLiabilityOfBtc'),
      totalNetAssetOfBtc: normalizePrivateExactDecimal(row.totalNetAssetOfBtc, 'Margin isolated.totalNetAssetOfBtc'),
    }),
    warningCodes: pairs.warningCodes,
    blockingCodes: Object.freeze([]),
  });
}

function parseMarginOrder(value: unknown, index: number): Readonly<Record<string, unknown>> {
  const label = `Margin openOrders[${index}]`;
  const row = privateRecord(value, MARGIN_ORDER_FIELDS, label);
  const status = enumText(row.status, `${label}.status`, [
    'NEW', 'PENDING_NEW', 'PARTIALLY_FILLED',
  ]);
  const timeInForce = enumText(row.timeInForce, `${label}.timeInForce`, [
    'GTC', 'IOC', 'FOK',
  ]);
  const type = enumText(row.type, `${label}.type`, [
    'LIMIT', 'MARKET', 'STOP_LOSS', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT',
    'TAKE_PROFIT_LIMIT', 'LIMIT_MAKER',
  ]);
  const isWorking = privateBoolean(row.isWorking, `${label}.isWorking`);
  const stopPrice = normalizePrivateNonNegativeDecimal(row.stopPrice, `${label}.stopPrice`);
  const icebergQty = normalizePrivateNonNegativeDecimal(row.icebergQty, `${label}.icebergQty`);
  const conditionalTypes = [
    'STOP_LOSS', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT', 'TAKE_PROFIT_LIMIT',
  ];
  const icebergTypes = ['LIMIT', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT_LIMIT', 'LIMIT_MAKER'];
  const noExplicitTimeInForceTypes = [
    'MARKET', 'STOP_LOSS', 'TAKE_PROFIT', 'LIMIT_MAKER',
  ];
  if (status === 'PENDING_NEW' && isWorking) {
    throw new TypeError(`${label} PENDING_NEW order cannot claim a working book placement`);
  }
  if (noExplicitTimeInForceTypes.includes(type) && timeInForce !== 'GTC') {
    throw new TypeError(`${label}.timeInForce is incompatible with its order type`);
  }
  if ((stopPrice !== '0') !== conditionalTypes.includes(type)) {
    throw new TypeError(`${label}.stopPrice does not match its order type`);
  }
  if (icebergQty !== '0' && (!icebergTypes.includes(type) || timeInForce !== 'GTC')) {
    throw new TypeError(`${label}.icebergQty requires a GTC iceberg-capable order type`);
  }
  return Object.freeze({
    symbol: venueToken(row.symbol, `${label}.symbol`),
    orderId: exchangeIntegerId(row.orderId, `${label}.orderId`),
    clientOrderId: binanceClientOrderId(row.clientOrderId, `${label}.clientOrderId`),
    price: normalizePrivateNonNegativeDecimal(row.price, `${label}.price`),
    origQty: normalizePrivateNonNegativeDecimal(row.origQty, `${label}.origQty`),
    executedQty: normalizePrivateNonNegativeDecimal(row.executedQty, `${label}.executedQty`),
    cummulativeQuoteQty: normalizePrivateNonNegativeDecimal(row.cummulativeQuoteQty, `${label}.cummulativeQuoteQty`),
    status,
    timeInForce,
    type,
    side: enumText(row.side, `${label}.side`, ['BUY', 'SELL']),
    stopPrice,
    icebergQty,
    time: utcMillis(row.time, `${label}.time`),
    updateTime: utcMillis(row.updateTime, `${label}.updateTime`),
    isWorking,
    isIsolated: privateBoolean(row.isIsolated, `${label}.isIsolated`),
    selfTradePreventionMode: enumText(
      row.selfTradePreventionMode,
      `${label}.selfTradePreventionMode`,
      ['NONE', 'EXPIRE_MAKER', 'EXPIRE_TAKER', 'EXPIRE_BOTH', 'DECREMENT', 'TRANSFER'],
    ),
  });
}

function normalizeMarginOrders(value: unknown): NormalizedValue {
  const rows = normalizeRows(value, 'margin open orders', PRIVATE_DATA_BOUNDS.maximumOrders,
    parseMarginOrder,
    (entry) => `${String((entry as PlainRecord).symbol)}:${String((entry as PlainRecord).orderId)}:${String((entry as PlainRecord).isIsolated)}`);
  return Object.freeze({ value: rows.rows, warningCodes: rows.warningCodes, blockingCodes: Object.freeze([]) });
}

function parseMarginTrade(value: unknown, index: number): Readonly<Record<string, unknown>> {
  const label = `Margin trades[${index}]`;
  const row = privateRecord(value, MARGIN_TRADE_FIELDS, label);
  return Object.freeze({
    symbol: venueToken(row.symbol, `${label}.symbol`),
    id: exchangeIntegerId(row.id, `${label}.id`),
    orderId: exchangeIntegerId(row.orderId, `${label}.orderId`),
    price: normalizePrivateNonNegativeDecimal(row.price, `${label}.price`),
    qty: normalizePrivateNonNegativeDecimal(row.qty, `${label}.qty`),
    commission: normalizePrivateNonNegativeDecimal(row.commission, `${label}.commission`),
    commissionAsset: venueToken(row.commissionAsset, `${label}.commissionAsset`),
    time: utcMillis(row.time, `${label}.time`),
    isBuyer: privateBoolean(row.isBuyer, `${label}.isBuyer`),
    isMaker: privateBoolean(row.isMaker, `${label}.isMaker`),
    isBestMatch: privateBoolean(row.isBestMatch, `${label}.isBestMatch`),
    isIsolated: privateBoolean(row.isIsolated, `${label}.isIsolated`),
  });
}

function normalizeMarginTrades(value: unknown): NormalizedValue {
  const rows = normalizeRows(value, 'margin trades', PRIVATE_DATA_BOUNDS.maximumTrades,
    parseMarginTrade,
    (entry) => `${String((entry as PlainRecord).symbol)}:${String((entry as PlainRecord).id)}:${String((entry as PlainRecord).isIsolated)}`);
  return Object.freeze({ value: rows.rows, warningCodes: rows.warningCodes, blockingCodes: Object.freeze([]) });
}

function parseMarginInterest(value: unknown, index: number): Readonly<Record<string, unknown>> {
  const label = `Margin interest.rows[${index}]`;
  const row = recordWithClosedOptionalFields(
    value,
    MARGIN_INTEREST_ROW_FIELDS,
    MARGIN_INTEREST_ROW_OPTIONAL_FIELDS,
    label,
  );
  const asset = venueToken(row.asset, `${label}.asset`);
  const rawAsset = Object.hasOwn(row, 'rawAsset')
    ? privateString(row.rawAsset, `${label}.rawAsset`, 128)
    : null;
  return Object.freeze({
    rawAsset,
    asset,
    interest: normalizePrivateNonNegativeDecimal(row.interest, `${label}.interest`),
    interestAccuredTime: utcMillis(row.interestAccuredTime, `${label}.interestAccuredTime`),
    interestRate: normalizePrivateNonNegativeDecimal(row.interestRate, `${label}.interestRate`),
    principal: normalizePrivateNonNegativeDecimal(row.principal, `${label}.principal`),
    type: enumText(row.type, `${label}.type`, [
      'PERIODIC',
      'ON_BORROW',
      'PERIODIC_CONVERTED',
      'ON_BORROW_CONVERTED',
      'PORTFOLIO',
    ]),
    isolatedSymbol: nullableOrEmptyVenueToken(row.isolatedSymbol, `${label}.isolatedSymbol`),
    txId: exchangeIntegerId(row.txId, `${label}.txId`),
  });
}

function normalizeMarginInterest(value: unknown): NormalizedValue {
  const row = privateRecord(value, MARGIN_INTEREST_FIELDS, 'Margin interest');
  const rows = normalizeRows(row.rows, 'margin interest rows', PRIVATE_DATA_BOUNDS.maximumTrades,
    parseMarginInterest,
    (entry) => `${String((entry as PlainRecord).asset)}:${String((entry as PlainRecord).txId)}`);
  const total = privateInteger(row.total, 'Margin interest.total');
  if (total < rows.rows.length) throw new TypeError('Margin interest.total cannot be below retained row count');
  const blockingCodes: string[] = [];
  if (rows.rows.some((entry) => (entry as PlainRecord).rawAsset === null)) {
    blockingCodes.push('MARGIN_INTEREST_RAW_ASSET_MISSING');
  }
  if (total !== rows.rows.length) blockingCodes.push('MARGIN_INTEREST_HISTORY_PARTIAL_PAGE');
  return Object.freeze({
    value: Object.freeze({ rows: rows.rows, total }),
    warningCodes: rows.warningCodes,
    blockingCodes: privateSortedUnique(blockingCodes),
  });
}

function parseMarginRate(value: unknown, index: number): Readonly<Record<string, unknown>> {
  const label = `Margin interest rates[${index}]`;
  const row = privateRecord(value, MARGIN_RATE_FIELDS, label);
  return Object.freeze({
    asset: venueToken(row.asset, `${label}.asset`),
    dailyInterestRate: normalizePrivateNonNegativeDecimal(row.dailyInterestRate, `${label}.dailyInterestRate`),
    timestamp: utcMillis(row.timestamp, `${label}.timestamp`),
    vipLevel: privateInteger(row.vipLevel, `${label}.vipLevel`),
  });
}

function normalizeMarginRates(value: unknown): NormalizedValue {
  const rows = normalizeRows(value, 'margin interest rates', PRIVATE_DATA_BOUNDS.maximumTrades,
    parseMarginRate,
    (entry) => `${String((entry as PlainRecord).asset)}:${String((entry as PlainRecord).timestamp)}:${String((entry as PlainRecord).vipLevel)}`);
  return Object.freeze({ value: rows.rows, warningCodes: rows.warningCodes, blockingCodes: Object.freeze([]) });
}

function normalizeMarginInventory(value: unknown): NormalizedValue {
  const row = privateRecord(value, MARGIN_INVENTORY_FIELDS, 'Margin inventory');
  const assets = row.assets;
  if (typeof assets !== 'object' || assets === null || Array.isArray(assets)) {
    throw new TypeError('Margin inventory.assets must be an asset-to-amount record');
  }
  const keys = Object.keys(assets);
  if (keys.length > PRIVATE_DATA_BOUNDS.maximumAssets) throw new RangeError('Margin inventory asset bound exceeded');
  const output = keys.map((rawAsset) => {
    const asset = venueToken(rawAsset, 'Margin inventory asset');
    return Object.freeze({
      asset,
      available: normalizePrivateNonNegativeDecimal((assets as Record<string, unknown>)[rawAsset], `Margin inventory.${asset}`),
    });
  }).sort((left, right) => left.asset < right.asset ? -1 : left.asset > right.asset ? 1 : 0);
  if (new Set(output.map((entry) => entry.asset)).size !== output.length) {
    throw new TypeError('Margin inventory contains duplicate canonical asset identities');
  }
  privateInteger(row.updateTime, 'Margin inventory.updateTime');
  return Object.freeze({
    value: Object.freeze({
      assets: Object.freeze(output),
      updateTime: row.updateTime,
      updateTimeUnit: 'UNKNOWN' as const,
    }),
    warningCodes: Object.freeze([]),
    blockingCodes: Object.freeze(['OFFICIAL_DOC_CONFLICT_MARGIN_INVENTORY_TIME_UNIT']),
  });
}

function normalizeValue(kind: PrivateFactKind, value: unknown): NormalizedValue {
  switch (kind) {
    case 'SPOT_PERMISSIONS':
    case 'USDM_PERMISSIONS':
    case 'MARGIN_PERMISSIONS':
      return normalizePermissions(value);
    case 'SPOT_ACCOUNT': return normalizeSpotAccount(value);
    case 'SPOT_OPEN_ORDERS': return normalizeSpotOrders(value);
    case 'SPOT_TRADES': return normalizeSpotTrades(value);
    case 'SPOT_COMMISSIONS': return normalizeSpotCommissions(value);
    case 'SPOT_ACCOUNT_STATUS':
    case 'USDM_ACCOUNT_STATUS':
    case 'MARGIN_ACCOUNT_STATUS':
      return normalizeAccountStatus(value);
    case 'SPOT_TRADING_STATUS':
    case 'USDM_TRADING_STATUS':
    case 'MARGIN_TRADING_STATUS':
      return normalizeTradingStatus(value);
    case 'USDM_ACCOUNT': return normalizeUsdmAccount(value);
    case 'USDM_BALANCE': return normalizeUsdmBalances(value);
    case 'USDM_POSITIONS': return normalizeUsdmPositions(value);
    case 'USDM_OPEN_ORDERS': return normalizeUsdmOrders(value);
    case 'USDM_TRADES': return normalizeUsdmTrades(value);
    case 'USDM_POSITION_MODE': return normalizeUsdmMode(value, 'POSITION');
    case 'USDM_MULTI_ASSETS_MODE': return normalizeUsdmMode(value, 'MULTI_ASSETS');
    case 'MARGIN_CROSS_ACCOUNT': return normalizeMarginCross(value);
    case 'MARGIN_ISOLATED_ACCOUNT': return normalizeMarginIsolated(value);
    case 'MARGIN_OPEN_ORDERS': return normalizeMarginOrders(value);
    case 'MARGIN_TRADES': return normalizeMarginTrades(value);
    case 'MARGIN_INTEREST': return normalizeMarginInterest(value);
    case 'MARGIN_INTEREST_RATE': return normalizeMarginRates(value);
    case 'MARGIN_INVENTORY': return normalizeMarginInventory(value);
    case 'USDM_COMMISSIONS':
    case 'USDM_INCOME':
    case 'USDM_ADL':
    case 'USDM_ALGO_OPEN_ORDERS':
    case 'USDM_ACCOUNT_CONFIGURATION':
    case 'USDM_SYMBOL_CONFIGURATION':
    case 'MARGIN_MAX_BORROWABLE':
    case 'MARGIN_BORROW_REPAY_HISTORY':
      throw new TypeError('L02 gap facts cannot carry a value');
  }
}

function validateTopLevel(record: PlainRecord): PrivateFactEvidenceInput {
  if (record.schema !== L05_PRIVATE_FACT_SCHEMA) throw new TypeError('private fact schema mismatch');
  if (record.matrixSha256 !== L05_BINANCE_MATRIX_SHA256) throw new TypeError('private fact matrix SHA mismatch');
  if (!PRIVATE_FACT_KINDS.includes(record.factKind as PrivateFactKind)) throw new TypeError('private fact kind invalid');
  const factKind = record.factKind as PrivateFactKind;
  if (!PRIVATE_PRODUCTS.includes(record.product as never)) throw new TypeError('private fact product invalid');
  if (record.environment !== 'PRODUCTION') throw new TypeError('private fact environment invalid');
  privateString(record.realm, 'private fact realm', 64);
  privateAccountRealmReference(record.accountRealmId, 'private fact accountRealmId');
  if (record.profileId !== null) privateProfileReference(record.profileId, 'private fact profileId');
  if (record.contractId !== null) privateIdentifier(record.contractId, 'private fact contractId');
  if (!PRIVATE_QUERY_SCOPES.includes(record.queryScope as never)) {
    throw new TypeError('private fact queryScope invalid');
  }
  nullableQueryToken(record.querySymbol, 'private fact querySymbol');
  nullableQueryToken(record.queryAsset, 'private fact queryAsset');
  nullableQueryToken(record.queryType, 'private fact queryType');
  if (record.marginMode !== null
    && !PRIVATE_MARGIN_QUERY_MODES.includes(record.marginMode as never)) {
    throw new TypeError('private fact marginMode invalid');
  }
  const queryCoverage = normalizeQueryCoverage(record.queryCoverage);
  privateIdentifier(record.sourceId, 'private fact sourceId');
  if (record.schemaRevision !== L05_PRIVATE_FACT_SCHEMA_REVISIONS[factKind]) {
    throw new TypeError('private fact schemaRevision is not the closed per-fact L05 schema');
  }
  if (typeof record.receiptId !== 'string'
    || !/^private-receipt:[0-9a-f]{24}$/.test(record.receiptId)) {
    throw new TypeError('private fact receiptId must be an exact non-secret receipt reference');
  }
  if (!PRIVATE_READ_STATES.includes(record.readState as never)) throw new TypeError('private fact readState invalid');
  if (!isDataAuthority(record.authority)) throw new TypeError('private fact authority invalid');
  if (!isCompleteness(record.completeness)) throw new TypeError('private fact completeness invalid');
  if (record.sourceTimeMs !== null && !isValidUtcMillis(record.sourceTimeMs)) throw new TypeError('private fact sourceTimeMs invalid');
  if (!isValidUtcMillis(record.receivedAtMs)) throw new TypeError('private fact receivedAtMs invalid');
  privateInteger(record.maxAgeMs, 'private fact maxAgeMs', 1, PRIVATE_DATA_BOUNDS.maximumFactAgeMs);
  return Object.freeze({ ...record, queryCoverage }) as unknown as PrivateFactEvidenceInput;
}

function validateAvailabilityTuple(input: PrivateFactEvidenceInput, gapReason: string | null): void {
  if (gapReason !== null) {
    if (input.readState !== 'UNAVAILABLE' || input.authority !== 'UNAVAILABLE'
      || input.completeness !== 'UNAVAILABLE' || input.value !== null
      || input.sourceTimeMs !== null || input.sourceId !== L05_PRIVATE_GAP_SOURCE_ID) {
      throw new TypeError('L02 gap evidence must be an explicit unavailable null fact');
    }
    return;
  }
  if (input.profileId === null) throw new TypeError('current private fact requires a non-secret profile identity');
  if (input.readState === 'OK') {
    if (input.value === null) throw new TypeError('successful private fact read cannot fabricate a null value');
  } else if (input.value !== null) {
    throw new TypeError('failed private fact read cannot retain a value');
  }
  if (input.readState !== 'OK'
    && input.completeness !== 'UNAVAILABLE') {
    throw new TypeError('failed private fact read must be explicitly unavailable');
  }
}

/**
 * Normalize one injected REST fact. No private read, signer, transport, cache,
 * reconciliation, Capital calculation, or external action is available here.
 */
export function normalizePrivateFactEvidence(
  rawInput: unknown,
  evaluatedAtMs: number,
): Readonly<NormalizedPrivateFact> {
  if (!isValidUtcMillis(evaluatedAtMs)) throw new TypeError('private fact evaluatedAtMs must be injected UTC milliseconds');
  const snapshot = snapshotPrivateData(rawInput);
  const input = validateTopLevel(privateRecord(snapshot, INPUT_FIELDS, 'private fact evidence'));
  const resolution = resolvePrivateFactContract(input.factKind, input.matrixSha256, input.contractId);
  if (input.product !== resolution.policy.product) throw new TypeError('private fact product does not match contract policy');
  validateAvailabilityTuple(input, resolution.policy.gapReason);
  validateQueryMetadata(input, resolution.policy.gapReason);
  validateQueryCoverageMetadata(
    input,
    input.queryCoverage,
    resolution.policy.gapReason,
    evaluatedAtMs,
  );
  if (input.readState === 'OK'
    && input.queryCoverage.kind === 'HISTORY_EXPLICIT_WINDOW'
    && input.sourceTimeMs !== input.queryCoverage.endTimeMs) {
    throw new TypeError('historical private fact source time must equal its exact coverage cut');
  }

  if (resolution.contract !== null) {
    if (input.realm !== resolution.contract.realm) throw new TypeError('private fact realm does not match contract');
    if (!resolution.contract.sourceIds.includes(input.sourceId)) throw new TypeError('private fact sourceId is not bound to the exact contract');
  } else {
    const gapRealm = resolution.policy.product === 'MARGIN'
      ? 'PRIVATE_MARGIN_ACCOUNT'
      : 'PRIVATE_ACCOUNT';
    if (input.realm !== gapRealm) throw new TypeError('L02 gap private fact must remain in its exact private realm');
  }

  const normalizedLocal = resolution.policy.gapReason !== null
    ? Object.freeze({
        value: null,
        warningCodes: Object.freeze([]),
        blockingCodes: Object.freeze([resolution.policy.gapReason]),
      })
    : input.readState === 'OK'
      ? normalizeValue(input.factKind, input.value)
      : Object.freeze({ value: null, warningCodes: Object.freeze([]), blockingCodes: Object.freeze([]) });
  if (input.readState === 'OK') {
    assertNormalizedQueryBinding(input, normalizedLocal.value);
    assertCurrentEmbeddedTimestampCausality(input, normalizedLocal.value, evaluatedAtMs);
  }
  const coverageBlockingCodes = input.readState === 'OK'
    ? queryCoverageBlockingCodes(input, input.queryCoverage, normalizedLocal.value)
    : Object.freeze([]);
  if (input.completeness === 'COMPLETE' && coverageBlockingCodes.length > 0) {
    throw new TypeError('private fact cannot claim COMPLETE without exact terminal query coverage');
  }
  const local = Object.freeze({
    value: normalizedLocal.value,
    warningCodes: normalizedLocal.warningCodes,
    blockingCodes: privateSortedUnique([
      ...normalizedLocal.blockingCodes,
      ...coverageBlockingCodes,
    ]),
  });

  const receiptTimeFallbackAllowed = RECEIPT_FALLBACK_FACTS.includes(input.factKind as never);
  const temporal = evaluatePrivateFactFreshness({
    readState: input.readState,
    authority: input.authority,
    completeness: input.completeness,
    sourceId: input.sourceId,
    sourceTimeMs: input.sourceTimeMs,
    receivedAtMs: input.receivedAtMs,
    maxAgeMs: input.maxAgeMs,
    receiptTimeFallbackAllowed,
  }, evaluatedAtMs);
  const reasonCodes = privateSortedUnique([
    ...local.warningCodes,
    ...local.blockingCodes,
    ...temporal.reasonCodes,
  ]);
  const injectedValue = input.value;
  const usableAsPrivateEvidence = temporal.usableAsPrivateEvidence && local.blockingCodes.length === 0;
  const contentRevision = stableId('l05-private-fact-content', {
    schema: L05_PRIVATE_FACT_SCHEMA,
    matrixSha256: input.matrixSha256,
    factKind: input.factKind,
    product: input.product,
    environment: input.environment,
    realm: input.realm,
    accountRealmId: input.accountRealmId,
    profileId: input.profileId,
    contractId: input.contractId,
    queryScope: input.queryScope,
    querySymbol: input.querySymbol,
    queryAsset: input.queryAsset,
    queryType: input.queryType,
    marginMode: input.marginMode,
    queryCoverage: input.queryCoverage,
    sourceId: input.sourceId,
    schemaRevision: input.schemaRevision,
    readState: input.readState,
    injectedValue,
    value: local.value,
    blockingCodes: local.blockingCodes,
  });
  const evidenceRevision = stableId('l05-private-fact-evidence', {
    contentRevision,
    receiptId: input.receiptId,
    authority: input.authority,
    completeness: input.completeness,
    sourceTimeMs: input.sourceTimeMs,
    receivedAtMs: input.receivedAtMs,
    maxAgeMs: input.maxAgeMs,
    evaluatedAtMs,
    freshness: temporal.freshness,
    validUntilMs: temporal.validUntilMs,
    usableAsPrivateEvidence,
    reasonCodes,
  });

  return deepFreezePrivate({
    ...NO_PRIVATE_ACTION_AUTHORITY,
    schema: L05_PRIVATE_FACT_SCHEMA,
    matrixSha256: input.matrixSha256,
    factKind: input.factKind,
    product: input.product,
    environment: input.environment,
    realm: input.realm,
    accountRealmId: input.accountRealmId,
    profileId: input.profileId,
    contractId: input.contractId,
    queryScope: input.queryScope,
    querySymbol: input.querySymbol,
    queryAsset: input.queryAsset,
    queryType: input.queryType,
    marginMode: input.marginMode,
    queryCoverage: input.queryCoverage,
    sourceId: input.sourceId,
    schemaRevision: input.schemaRevision,
    receiptId: input.receiptId,
    readState: input.readState,
    authority: input.authority,
    completeness: input.completeness,
    sourceTimeMs: input.sourceTimeMs,
    receivedAtMs: input.receivedAtMs,
    maxAgeMs: input.maxAgeMs,
    injectedValue,
    value: local.value,
    contentRevision,
    evidenceRevision,
    freshness: temporal.freshness,
    validUntilMs: temporal.validUntilMs,
    usableAsPrivateEvidence,
    contentBlockingCodes: local.blockingCodes,
    reasonCodes,
  });
}

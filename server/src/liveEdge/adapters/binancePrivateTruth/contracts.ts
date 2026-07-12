import {
  BINANCE_CONTRACT_MATRIX_CONTENT_SHA256,
  canonicalBinanceContractMatrix,
  type BinanceContractRecord,
} from '../binanceContracts/index.js';
import type { PrivateFactKind, PrivateProduct } from './types.js';

export const L05_BINANCE_MATRIX_SHA256 = BINANCE_CONTRACT_MATRIX_CONTENT_SHA256;

export const L05_PRIVATE_TRADE_HISTORY_LIMIT = 1_000 as const;
export const L05_PRIVATE_MARGIN_INTEREST_PAGE = 1 as const;
export const L05_PRIVATE_MARGIN_INTEREST_SIZE = 100 as const;

export const L05_PRIVATE_SPOT_TRADE_MAXIMUM_SPAN_MS = 24 * 60 * 60 * 1_000;
export const L05_PRIVATE_USDM_TRADE_MAXIMUM_SPAN_MS = 7 * 24 * 60 * 60 * 1_000;
export const L05_PRIVATE_MARGIN_TRADE_MAXIMUM_SPAN_MS = 24 * 60 * 60 * 1_000;
export const L05_PRIVATE_MARGIN_INTEREST_MAXIMUM_SPAN_MS = 30 * 24 * 60 * 60 * 1_000;
/**
 * MARGIN_INTEREST_RATE documents a maximum of "one month", which is not a
 * fixed duration. L05 deliberately admits only a conservative fixed 30-day
 * subset; changing this policy requires a new accepted documentary decision.
 */
export const L05_PRIVATE_MARGIN_INTEREST_RATE_CONSERVATIVE_MAXIMUM_SPAN_MS =
  30 * 24 * 60 * 60 * 1_000;

export const PRIVATE_TRADE_HISTORY_FACT_KINDS = Object.freeze([
  'SPOT_TRADES', 'USDM_TRADES', 'MARGIN_TRADES',
] as const satisfies readonly PrivateFactKind[]);

export interface PrivateFactContractPolicy {
  readonly factKind: PrivateFactKind;
  readonly product: PrivateProduct;
  readonly contractId: string | null;
  readonly gapReason: string | null;
}

export type PrivateFactQueryScopePolicy =
  | 'ACCOUNT_WIDE'
  | 'ALL_SYMBOLS_OPTIONAL'
  | 'SYMBOL_REQUIRED';

export interface PrivateFactQueryPolicy {
  readonly factKind: PrivateFactKind;
  readonly scope: PrivateFactQueryScopePolicy;
  readonly queryAssetRequired: boolean;
  readonly queryTypeRequired: boolean;
  readonly marginModeRequired: boolean;
}

function queryPolicy(
  factKind: PrivateFactKind,
  scope: PrivateFactQueryScopePolicy,
  selectors: Readonly<{
    queryAssetRequired?: boolean;
    queryTypeRequired?: boolean;
    marginModeRequired?: boolean;
  }> = {},
): Readonly<PrivateFactQueryPolicy> {
  return Object.freeze({
    factKind,
    scope,
    queryAssetRequired: selectors.queryAssetRequired ?? false,
    queryTypeRequired: selectors.queryTypeRequired ?? false,
    marginModeRequired: selectors.marginModeRequired ?? false,
  });
}

const POLICY: Readonly<Record<PrivateFactKind, Readonly<PrivateFactContractPolicy>>> = Object.freeze({
  SPOT_PERMISSIONS: Object.freeze({ factKind: 'SPOT_PERMISSIONS', product: 'SPOT', contractId: 'SPOT_API_KEY_PERMISSIONS', gapReason: null }),
  SPOT_ACCOUNT: Object.freeze({ factKind: 'SPOT_ACCOUNT', product: 'SPOT', contractId: 'SPOT_ACCOUNT_BALANCES', gapReason: null }),
  SPOT_OPEN_ORDERS: Object.freeze({ factKind: 'SPOT_OPEN_ORDERS', product: 'SPOT', contractId: 'SPOT_OPEN_ORDERS_QUERY', gapReason: null }),
  SPOT_TRADES: Object.freeze({ factKind: 'SPOT_TRADES', product: 'SPOT', contractId: 'SPOT_MY_TRADES_QUERY', gapReason: null }),
  SPOT_COMMISSIONS: Object.freeze({ factKind: 'SPOT_COMMISSIONS', product: 'SPOT', contractId: 'SPOT_COMMISSION_QUERY', gapReason: null }),
  SPOT_ACCOUNT_STATUS: Object.freeze({ factKind: 'SPOT_ACCOUNT_STATUS', product: 'SPOT', contractId: 'SPOT_ACCOUNT_STATUS', gapReason: null }),
  SPOT_TRADING_STATUS: Object.freeze({ factKind: 'SPOT_TRADING_STATUS', product: 'SPOT', contractId: 'SPOT_ACCOUNT_API_TRADING_STATUS', gapReason: null }),
  USDM_PERMISSIONS: Object.freeze({ factKind: 'USDM_PERMISSIONS', product: 'USD_M_PERPETUAL', contractId: 'USDM_API_KEY_PERMISSIONS', gapReason: null }),
  USDM_ACCOUNT: Object.freeze({ factKind: 'USDM_ACCOUNT', product: 'USD_M_PERPETUAL', contractId: 'USDM_ACCOUNT_V3', gapReason: null }),
  USDM_BALANCE: Object.freeze({ factKind: 'USDM_BALANCE', product: 'USD_M_PERPETUAL', contractId: 'USDM_BALANCE_V3', gapReason: null }),
  USDM_POSITIONS: Object.freeze({ factKind: 'USDM_POSITIONS', product: 'USD_M_PERPETUAL', contractId: 'USDM_POSITION_RISK_V3', gapReason: null }),
  USDM_OPEN_ORDERS: Object.freeze({ factKind: 'USDM_OPEN_ORDERS', product: 'USD_M_PERPETUAL', contractId: 'USDM_OPEN_ORDERS_QUERY', gapReason: null }),
  USDM_ALGO_OPEN_ORDERS: Object.freeze({ factKind: 'USDM_ALGO_OPEN_ORDERS', product: 'USD_M_PERPETUAL', contractId: null, gapReason: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_ALGO_OPEN_ORDERS' }),
  USDM_TRADES: Object.freeze({ factKind: 'USDM_TRADES', product: 'USD_M_PERPETUAL', contractId: 'USDM_USER_TRADES_QUERY', gapReason: null }),
  USDM_COMMISSIONS: Object.freeze({ factKind: 'USDM_COMMISSIONS', product: 'USD_M_PERPETUAL', contractId: null, gapReason: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_COMMISSION' }),
  USDM_INCOME: Object.freeze({ factKind: 'USDM_INCOME', product: 'USD_M_PERPETUAL', contractId: null, gapReason: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_INCOME' }),
  USDM_ADL: Object.freeze({ factKind: 'USDM_ADL', product: 'USD_M_PERPETUAL', contractId: null, gapReason: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_ADL' }),
  USDM_ACCOUNT_CONFIGURATION: Object.freeze({ factKind: 'USDM_ACCOUNT_CONFIGURATION', product: 'USD_M_PERPETUAL', contractId: null, gapReason: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_ACCOUNT_CONFIGURATION' }),
  USDM_SYMBOL_CONFIGURATION: Object.freeze({ factKind: 'USDM_SYMBOL_CONFIGURATION', product: 'USD_M_PERPETUAL', contractId: null, gapReason: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_SYMBOL_CONFIGURATION' }),
  USDM_ACCOUNT_STATUS: Object.freeze({ factKind: 'USDM_ACCOUNT_STATUS', product: 'USD_M_PERPETUAL', contractId: 'USDM_ACCOUNT_STATUS', gapReason: null }),
  USDM_TRADING_STATUS: Object.freeze({ factKind: 'USDM_TRADING_STATUS', product: 'USD_M_PERPETUAL', contractId: 'USDM_ACCOUNT_API_TRADING_STATUS', gapReason: null }),
  USDM_MULTI_ASSETS_MODE: Object.freeze({ factKind: 'USDM_MULTI_ASSETS_MODE', product: 'USD_M_PERPETUAL', contractId: 'USDM_MULTI_ASSETS_MODE_QUERY', gapReason: null }),
  USDM_POSITION_MODE: Object.freeze({ factKind: 'USDM_POSITION_MODE', product: 'USD_M_PERPETUAL', contractId: 'USDM_POSITION_MODE_QUERY', gapReason: null }),
  MARGIN_PERMISSIONS: Object.freeze({ factKind: 'MARGIN_PERMISSIONS', product: 'MARGIN', contractId: 'MARGIN_API_KEY_PERMISSIONS', gapReason: null }),
  MARGIN_CROSS_ACCOUNT: Object.freeze({ factKind: 'MARGIN_CROSS_ACCOUNT', product: 'MARGIN', contractId: 'MARGIN_CROSS_ACCOUNT_BALANCES', gapReason: null }),
  MARGIN_ISOLATED_ACCOUNT: Object.freeze({ factKind: 'MARGIN_ISOLATED_ACCOUNT', product: 'MARGIN', contractId: 'MARGIN_ISOLATED_ACCOUNT_BALANCES', gapReason: null }),
  MARGIN_OPEN_ORDERS: Object.freeze({ factKind: 'MARGIN_OPEN_ORDERS', product: 'MARGIN', contractId: 'MARGIN_OPEN_ORDERS_QUERY', gapReason: null }),
  MARGIN_TRADES: Object.freeze({ factKind: 'MARGIN_TRADES', product: 'MARGIN', contractId: 'MARGIN_MY_TRADES_QUERY', gapReason: null }),
  MARGIN_INTEREST: Object.freeze({ factKind: 'MARGIN_INTEREST', product: 'MARGIN', contractId: 'MARGIN_INTEREST_HISTORY_QUERY', gapReason: null }),
  MARGIN_INTEREST_RATE: Object.freeze({ factKind: 'MARGIN_INTEREST_RATE', product: 'MARGIN', contractId: 'MARGIN_INTEREST_RATE_HISTORY_QUERY', gapReason: null }),
  MARGIN_INVENTORY: Object.freeze({ factKind: 'MARGIN_INVENTORY', product: 'MARGIN', contractId: 'MARGIN_AVAILABLE_INVENTORY_QUERY', gapReason: null }),
  MARGIN_MAX_BORROWABLE: Object.freeze({ factKind: 'MARGIN_MAX_BORROWABLE', product: 'MARGIN', contractId: null, gapReason: 'OFFICIAL_DOC_CONFLICT_MARGIN_MAX_BORROWABLE_WEIGHT' }),
  MARGIN_BORROW_REPAY_HISTORY: Object.freeze({ factKind: 'MARGIN_BORROW_REPAY_HISTORY', product: 'MARGIN', contractId: null, gapReason: 'OFFICIAL_DOC_CONFLICT_MARGIN_BORROW_REPAY_HISTORY_PARAMETERS' }),
  MARGIN_ACCOUNT_STATUS: Object.freeze({ factKind: 'MARGIN_ACCOUNT_STATUS', product: 'MARGIN', contractId: 'MARGIN_ACCOUNT_STATUS', gapReason: null }),
  MARGIN_TRADING_STATUS: Object.freeze({ factKind: 'MARGIN_TRADING_STATUS', product: 'MARGIN', contractId: 'MARGIN_ACCOUNT_API_TRADING_STATUS', gapReason: null }),
});

export const PRIVATE_FACT_CONTRACT_POLICY = POLICY;

/**
 * Exact query-scope posture admitted by the accepted L02 contracts.
 * Null-contract gap markers remain account-wide documentary blockers and
 * therefore admit no selector metadata.
 */
export const PRIVATE_FACT_QUERY_POLICY: Readonly<
  Record<PrivateFactKind, Readonly<PrivateFactQueryPolicy>>
> = Object.freeze({
  SPOT_PERMISSIONS: queryPolicy('SPOT_PERMISSIONS', 'ACCOUNT_WIDE'),
  SPOT_ACCOUNT: queryPolicy('SPOT_ACCOUNT', 'ACCOUNT_WIDE'),
  SPOT_OPEN_ORDERS: queryPolicy('SPOT_OPEN_ORDERS', 'ALL_SYMBOLS_OPTIONAL'),
  SPOT_TRADES: queryPolicy('SPOT_TRADES', 'SYMBOL_REQUIRED'),
  SPOT_COMMISSIONS: queryPolicy('SPOT_COMMISSIONS', 'SYMBOL_REQUIRED'),
  SPOT_ACCOUNT_STATUS: queryPolicy('SPOT_ACCOUNT_STATUS', 'ACCOUNT_WIDE'),
  SPOT_TRADING_STATUS: queryPolicy('SPOT_TRADING_STATUS', 'ACCOUNT_WIDE'),
  USDM_PERMISSIONS: queryPolicy('USDM_PERMISSIONS', 'ACCOUNT_WIDE'),
  USDM_ACCOUNT: queryPolicy('USDM_ACCOUNT', 'ACCOUNT_WIDE'),
  USDM_BALANCE: queryPolicy('USDM_BALANCE', 'ACCOUNT_WIDE'),
  USDM_POSITIONS: queryPolicy('USDM_POSITIONS', 'ACCOUNT_WIDE'),
  USDM_OPEN_ORDERS: queryPolicy('USDM_OPEN_ORDERS', 'ALL_SYMBOLS_OPTIONAL'),
  USDM_ALGO_OPEN_ORDERS: queryPolicy('USDM_ALGO_OPEN_ORDERS', 'ACCOUNT_WIDE'),
  USDM_TRADES: queryPolicy('USDM_TRADES', 'SYMBOL_REQUIRED'),
  USDM_COMMISSIONS: queryPolicy('USDM_COMMISSIONS', 'ACCOUNT_WIDE'),
  USDM_INCOME: queryPolicy('USDM_INCOME', 'ACCOUNT_WIDE'),
  USDM_ADL: queryPolicy('USDM_ADL', 'ACCOUNT_WIDE'),
  USDM_ACCOUNT_CONFIGURATION: queryPolicy('USDM_ACCOUNT_CONFIGURATION', 'ACCOUNT_WIDE'),
  USDM_SYMBOL_CONFIGURATION: queryPolicy('USDM_SYMBOL_CONFIGURATION', 'ACCOUNT_WIDE'),
  USDM_ACCOUNT_STATUS: queryPolicy('USDM_ACCOUNT_STATUS', 'ACCOUNT_WIDE'),
  USDM_TRADING_STATUS: queryPolicy('USDM_TRADING_STATUS', 'ACCOUNT_WIDE'),
  USDM_MULTI_ASSETS_MODE: queryPolicy('USDM_MULTI_ASSETS_MODE', 'ACCOUNT_WIDE'),
  USDM_POSITION_MODE: queryPolicy('USDM_POSITION_MODE', 'ACCOUNT_WIDE'),
  MARGIN_PERMISSIONS: queryPolicy('MARGIN_PERMISSIONS', 'ACCOUNT_WIDE'),
  MARGIN_CROSS_ACCOUNT: queryPolicy('MARGIN_CROSS_ACCOUNT', 'ACCOUNT_WIDE'),
  MARGIN_ISOLATED_ACCOUNT: queryPolicy('MARGIN_ISOLATED_ACCOUNT', 'ACCOUNT_WIDE'),
  MARGIN_OPEN_ORDERS: queryPolicy('MARGIN_OPEN_ORDERS', 'ALL_SYMBOLS_OPTIONAL', {
    marginModeRequired: true,
  }),
  MARGIN_TRADES: queryPolicy('MARGIN_TRADES', 'SYMBOL_REQUIRED', {
    marginModeRequired: true,
  }),
  MARGIN_INTEREST: queryPolicy('MARGIN_INTEREST', 'ACCOUNT_WIDE', {
    marginModeRequired: true,
  }),
  MARGIN_INTEREST_RATE: queryPolicy('MARGIN_INTEREST_RATE', 'ACCOUNT_WIDE', {
    queryAssetRequired: true,
  }),
  MARGIN_INVENTORY: queryPolicy('MARGIN_INVENTORY', 'ACCOUNT_WIDE', {
    queryTypeRequired: true,
  }),
  MARGIN_MAX_BORROWABLE: queryPolicy('MARGIN_MAX_BORROWABLE', 'ACCOUNT_WIDE'),
  MARGIN_BORROW_REPAY_HISTORY: queryPolicy('MARGIN_BORROW_REPAY_HISTORY', 'ACCOUNT_WIDE'),
  MARGIN_ACCOUNT_STATUS: queryPolicy('MARGIN_ACCOUNT_STATUS', 'ACCOUNT_WIDE'),
  MARGIN_TRADING_STATUS: queryPolicy('MARGIN_TRADING_STATUS', 'ACCOUNT_WIDE'),
});

function findContract(contractId: string): BinanceContractRecord {
  const matrix = canonicalBinanceContractMatrix();
  const contract = matrix.contracts.find((candidate) => candidate.id === contractId);
  if (contract === undefined) throw new Error('L05 required contract is absent from the accepted L02 matrix');
  return contract;
}

export function resolvePrivateFactContract(
  factKind: PrivateFactKind,
  matrixSha256: unknown,
  candidateContractId: unknown,
): Readonly<{ policy: Readonly<PrivateFactContractPolicy>; contract: BinanceContractRecord | null }> {
  if (matrixSha256 !== L05_BINANCE_MATRIX_SHA256) throw new TypeError('private evidence matrix SHA is not the accepted L02 revision');
  const policy = POLICY[factKind];
  if (policy === undefined) throw new TypeError('private fact kind is unsupported');
  if (policy.contractId === null) {
    if (candidateContractId !== null) throw new TypeError('private fact has no accepted L02 contract');
    return Object.freeze({ policy, contract: null });
  }
  if (candidateContractId !== policy.contractId) throw new TypeError('private fact contract identity mismatch');
  const contract = findContract(policy.contractId);
  if (contract.product !== policy.product || contract.environment !== 'PRODUCTION'
    || contract.lifecycle !== 'CURRENT' || !contract.realm.startsWith('PRIVATE')) {
    throw new Error('L05 required private fact contract posture changed');
  }
  if (contract.externalActionAuthorization !== 'NONE' || contract.actionAuthority !== 'NONE_RECORD_ONLY') {
    throw new Error('L05 documentary contract unexpectedly claims action authority');
  }
  return Object.freeze({ policy, contract });
}

export const PRIVATE_LIFECYCLE_CONTRACT_IDS = Object.freeze({
  SPOT: Object.freeze([
    'SPOT_WS_API_USER_DATA_SIGNATURE',
    'SPOT_WS_USER_DATA_UNSUBSCRIBE',
  ]),
  USD_M_PERPETUAL: Object.freeze([
    'USDM_WS_PRIVATE_USER_DATA',
    'USDM_WS_PRIVATE_USER_DATA_QUERY_RAW',
    'USDM_WS_PRIVATE_USER_DATA_COMBINED',
    'USDM_LISTEN_KEY_POST',
    'USDM_LISTEN_KEY_PUT',
    'USDM_LISTEN_KEY_DELETE',
  ]),
  MARGIN: Object.freeze([
    'MARGIN_RISK_LISTEN_KEY_POST',
    'MARGIN_RISK_LISTEN_KEY_PUT',
    'MARGIN_RISK_LISTEN_KEY_DELETE_CONFLICT',
    'MARGIN_RISK_WS_RAW',
    'MARGIN_RISK_WS_COMBINED',
  ]),
} as const);

export function resolvePrivateLifecycleContract(
  product: PrivateProduct,
  matrixSha256: unknown,
  contractId: unknown,
): BinanceContractRecord {
  if (matrixSha256 !== L05_BINANCE_MATRIX_SHA256) throw new TypeError('private lifecycle matrix SHA mismatch');
  if (typeof contractId !== 'string'
    || !(PRIVATE_LIFECYCLE_CONTRACT_IDS[product] as readonly string[]).includes(contractId)) {
    throw new TypeError('private lifecycle contract is not in the closed L05 selection');
  }
  const contract = findContract(contractId);
  if (contract.product !== product || contract.environment !== 'PRODUCTION'
    || contract.externalActionAuthorization !== 'NONE') {
    throw new Error('private lifecycle contract posture changed');
  }
  return contract;
}

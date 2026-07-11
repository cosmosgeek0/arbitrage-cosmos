import { createRuntimeSourceId, RUNTIME_ENDPOINTS } from '../contracts/index.js';
import type {
  DerivativesFactKind,
  DerivativesSourceDescriptor,
  DerivativesTtlConfig,
  RefreshableDerivativesFactKind,
} from './types.js';

const REST_DOC = 'https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data';
const LIQUIDATION_DOC = 'https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market#all-market-liquidation-order-streams';

/** Exact source identity emitted by FuturesRuntimeAdapter for !forceOrder@arr. */
export const DERIVATIVES_LIQUIDATION_INPUT_SOURCE_ID = createRuntimeSourceId({
  capability: 'usd-m-liquidation',
  endpointClass: 'MARKET',
  productFamily: 'USD_M_PERPETUAL',
  streamOrPath: '!forceOrder@arr',
});

export const DERIVATIVES_DEFAULT_TTLS: Readonly<DerivativesTtlConfig> = Object.freeze({
  OPEN_INTEREST_CURRENT: 15_000,
  OPEN_INTEREST_HISTORY: 10 * 60_000,
  FUNDING_HISTORY: 9 * 60 * 60_000,
  FUNDING_INFO: 60 * 60_000,
  TAKER_BUY_SELL: 10 * 60_000,
  GLOBAL_LONG_SHORT: 10 * 60_000,
  LIQUIDATION_CONTEXT: 30_000,
});

interface SourceSeed {
  kind: DerivativesFactKind;
  dataset: string;
  pathOrStream: string;
  access: DerivativesSourceDescriptor['access'];
  officialIpWeight: number | null;
  sharedLimit: string | null;
  localBudgetUnits: number;
  ttlMs: number;
  documentationUrl: string;
  notes: readonly string[];
}

function source(seed: SourceSeed): DerivativesSourceDescriptor {
  const stream = seed.access === 'PUBLIC_STREAM_INPUT';
  const baseUrl = stream
    ? RUNTIME_ENDPOINTS.USD_M_MARKET_WEBSOCKET.baseUrl
    : RUNTIME_ENDPOINTS.USD_M_PUBLIC_REST.baseUrl;
  const endpointClass = stream ? 'MARKET' as const : 'REST' as const;
  return Object.freeze({
    ...seed,
    sourceId: createRuntimeSourceId({
      capability: `derivatives-${seed.kind.toLowerCase().replaceAll('_', '-')}`,
      endpointClass,
      productFamily: 'USD_M_PERPETUAL',
      streamOrPath: seed.pathOrStream,
    }),
    baseUrl,
    endpoint: stream ? `${baseUrl}/ws/${seed.pathOrStream}` : `${baseUrl}${seed.pathOrStream}`,
    notes: Object.freeze([...seed.notes]),
  });
}

export const DERIVATIVES_SOURCES: Readonly<Record<DerivativesFactKind, DerivativesSourceDescriptor>> = Object.freeze({
  OPEN_INTEREST_CURRENT: source({
    kind: 'OPEN_INTEREST_CURRENT', dataset: 'usd_m.open_interest', pathOrStream: '/fapi/v1/openInterest',
    access: 'PUBLIC_NO_KEY', officialIpWeight: 1, sharedLimit: null, localBudgetUnits: 1,
    ttlMs: DERIVATIVES_DEFAULT_TTLS.OPEN_INTEREST_CURRENT, documentationUrl: `${REST_DOC}#open-interest`,
    notes: ['openInterest is non-negative base-asset open interest', 'time is the source transaction time'],
  }),
  OPEN_INTEREST_HISTORY: source({
    kind: 'OPEN_INTEREST_HISTORY', dataset: 'usd_m.open_interest_history', pathOrStream: '/futures/data/openInterestHist',
    access: 'PUBLIC_NO_KEY', officialIpWeight: 0, sharedLimit: '1000 requests per 5 minutes per IP', localBudgetUnits: 1,
    ttlMs: DERIVATIVES_DEFAULT_TTLS.OPEN_INTEREST_HISTORY, documentationUrl: `${REST_DOC}#open-interest-statistics`,
    notes: ['latest one month only', 'sumOpenInterestValue is quote-value context'],
  }),
  FUNDING_HISTORY: source({
    kind: 'FUNDING_HISTORY', dataset: 'usd_m.funding_history', pathOrStream: '/fapi/v1/fundingRate',
    access: 'PUBLIC_NO_KEY', officialIpWeight: null, sharedLimit: '500 requests per 5 minutes per IP shared with fundingInfo', localBudgetUnits: 1,
    ttlMs: DERIVATIVES_DEFAULT_TTLS.FUNDING_HISTORY, documentationUrl: `${REST_DOC}#get-funding-rate-history`,
    notes: ['fundingTime is the realized funding source time', 'markPrice is associated with the funding charge'],
  }),
  FUNDING_INFO: source({
    kind: 'FUNDING_INFO', dataset: 'usd_m.funding_info', pathOrStream: '/fapi/v1/fundingInfo',
    access: 'PUBLIC_NO_KEY', officialIpWeight: 0, sharedLimit: '500 requests per 5 minutes per IP shared with fundingRate', localBudgetUnits: 1,
    ttlMs: DERIVATIVES_DEFAULT_TTLS.FUNDING_INFO, documentationUrl: `${REST_DOC}#get-funding-rate-info`,
    notes: ['response contains only adjusted symbols', 'response has no exchange source timestamp'],
  }),
  TAKER_BUY_SELL: source({
    kind: 'TAKER_BUY_SELL', dataset: 'usd_m.taker_buy_sell', pathOrStream: '/futures/data/takerlongshortRatio',
    access: 'PUBLIC_NO_KEY', officialIpWeight: 0, sharedLimit: '1000 requests per 5 minutes per IP', localBudgetUnits: 1,
    ttlMs: DERIVATIVES_DEFAULT_TTLS.TAKER_BUY_SELL, documentationUrl: `${REST_DOC}#taker-buysell-volume`,
    notes: ['latest 30 days only', 'buy and sell volume are preserved without inference'],
  }),
  GLOBAL_LONG_SHORT: source({
    kind: 'GLOBAL_LONG_SHORT', dataset: 'usd_m.global_long_short', pathOrStream: '/futures/data/globalLongShortAccountRatio',
    access: 'PUBLIC_NO_KEY', officialIpWeight: 0, sharedLimit: '1000 requests per 5 minutes per IP', localBudgetUnits: 1,
    ttlMs: DERIVATIVES_DEFAULT_TTLS.GLOBAL_LONG_SHORT, documentationUrl: `${REST_DOC}#longshort-ratio`,
    notes: ['all-trader account context', 'latest 30 days only'],
  }),
  TOP_TRADER_ACCOUNT: source({
    kind: 'TOP_TRADER_ACCOUNT', dataset: 'usd_m.top_trader_account_ratio', pathOrStream: '/futures/data/topLongShortAccountRatio',
    access: 'API_KEY_REQUIRED', officialIpWeight: null, sharedLimit: '1000 requests per 5 minutes per IP', localBudgetUnits: 0,
    ttlMs: DERIVATIVES_DEFAULT_TTLS.GLOBAL_LONG_SHORT, documentationUrl: `${REST_DOC}#top-trader-longshort-account-ratio-market_data`,
    notes: ['current official documentation requires X-MBX-APIKEY', 'no-key runtime never requests this endpoint'],
  }),
  TOP_TRADER_POSITION: source({
    kind: 'TOP_TRADER_POSITION', dataset: 'usd_m.top_trader_position_ratio', pathOrStream: '/futures/data/topLongShortPositionRatio',
    access: 'API_KEY_REQUIRED', officialIpWeight: 0, sharedLimit: '1000 requests per 5 minutes per IP', localBudgetUnits: 0,
    ttlMs: DERIVATIVES_DEFAULT_TTLS.GLOBAL_LONG_SHORT, documentationUrl: `${REST_DOC}#top-trader-longshort-position-ratio-market_data`,
    notes: ['current official documentation requires X-MBX-APIKEY', 'no-key runtime never requests this endpoint'],
  }),
  LIQUIDATION_CONTEXT: source({
    kind: 'LIQUIDATION_CONTEXT', dataset: 'usd_m.liquidation_context', pathOrStream: '!forceOrder@arr',
    access: 'PUBLIC_STREAM_INPUT', officialIpWeight: 0, sharedLimit: null, localBudgetUnits: 0,
    ttlMs: DERIVATIVES_DEFAULT_TTLS.LIQUIDATION_CONTEXT, documentationUrl: LIQUIDATION_DOC,
    notes: ['st=1 is required for USD-M after the merged market migration', 'latest liquidation per symbol per 1000ms window is sampled'],
  }),
});

export const DERIVATIVES_REFRESH_PRIORITY: Readonly<Record<RefreshableDerivativesFactKind, number>> = Object.freeze({
  OPEN_INTEREST_CURRENT: 10,
  OPEN_INTEREST_HISTORY: 20,
  FUNDING_HISTORY: 30,
  FUNDING_INFO: 40,
  TAKER_BUY_SELL: 50,
  GLOBAL_LONG_SHORT: 60,
});

export const DERIVATIVES_REFRESHABLE_KINDS = Object.freeze([
  'OPEN_INTEREST_CURRENT',
  'OPEN_INTEREST_HISTORY',
  'FUNDING_HISTORY',
  'FUNDING_INFO',
  'TAKER_BUY_SELL',
  'GLOBAL_LONG_SHORT',
] as const satisfies readonly RefreshableDerivativesFactKind[]);

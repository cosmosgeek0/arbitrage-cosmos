import type { BinanceSourceFact } from './types.js';

const facts = {
  SPOT_AGG_TRADE: {
    sourceId: 'binance-spot-market-stream', dataset: 'spot.aggregate_trade', endpointClass: 'PUBLIC',
    productFamily: 'SPOT', evidenceKinds: ['TRADE'], endpoint: 'wss://stream.binance.com:9443/ws',
    channel: '<symbol>@aggTrade', freshnessBasis: 'SOURCE_TRANSACTION_TIME', sourceEventTimeField: 'E',
    sourceTransactionTimeField: 'T', sequenceFields: ['f', 'l'], bookScope: null, sourceMarketType: null,
    samplingWindowMs: null, notes: ['q is base-asset quantity', 'm=true means the buyer is the maker'],
  },
  USD_M_AGG_TRADE: {
    sourceId: 'binance-futures-market-stream', dataset: 'usd_m.aggregate_trade', endpointClass: 'MARKET',
    productFamily: 'USD_M_PERPETUAL', evidenceKinds: ['TRADE'], endpoint: 'wss://fstream.binance.com/market',
    channel: '<symbol>@aggTrade', freshnessBasis: 'SOURCE_TRANSACTION_TIME', sourceEventTimeField: 'E',
    sourceTransactionTimeField: 'T', sequenceFields: ['f', 'l'], bookScope: null, sourceMarketType: 1,
    samplingWindowMs: 100, notes: ['st=1 identifies USD-M', 'st=2 is COIN-M and q is contracts', 'nq is normal base quantity excluding RPI trades'],
  },
  SPOT_BOOK_TICKER: {
    sourceId: 'binance-spot-market-stream', dataset: 'spot.book_ticker', endpointClass: 'PUBLIC',
    productFamily: 'SPOT', evidenceKinds: ['BOOK_TICKER'], endpoint: 'wss://stream.binance.com:9443/ws',
    channel: '<symbol>@bookTicker', freshnessBasis: 'RECEIVE_TIME', sourceEventTimeField: null,
    sourceTransactionTimeField: null, sequenceFields: ['u'], bookScope: null, sourceMarketType: null,
    samplingWindowMs: null, notes: ['Spot bookTicker has no exchange event or transaction timestamp', 'u is a monotonic cursor and is not guaranteed contiguous'],
  },
  USD_M_BOOK_TICKER: {
    sourceId: 'binance-futures-public-stream', dataset: 'usd_m.book_ticker', endpointClass: 'PUBLIC',
    productFamily: 'USD_M_PERPETUAL', evidenceKinds: ['BOOK_TICKER'], endpoint: 'wss://fstream.binance.com/public',
    channel: '<symbol>@bookTicker', freshnessBasis: 'SOURCE_TRANSACTION_TIME', sourceEventTimeField: 'E',
    sourceTransactionTimeField: 'T', sequenceFields: ['u'], bookScope: 'STANDARD_NO_RPI', sourceMarketType: 1,
    samplingWindowMs: null, notes: ['standard Futures book excludes RPI orders', 'st=1 identifies USD-M', 'u is a monotonic cursor and is not guaranteed contiguous'],
  },
  SPOT_DEPTH_SNAPSHOT: {
    sourceId: 'binance-spot-rest', dataset: 'spot.depth_snapshot', endpointClass: 'REST',
    productFamily: 'SPOT', evidenceKinds: ['DEPTH_SNAPSHOT'], endpoint: 'https://api.binance.com/api/v3/depth',
    channel: null, freshnessBasis: 'RECEIVE_TIME', sourceEventTimeField: null, sourceTransactionTimeField: null,
    sequenceFields: ['lastUpdateId'], bookScope: 'UNKNOWN', sourceMarketType: null, samplingWindowMs: null,
    notes: ['REST snapshot has no exchange timestamp'],
  },
  SPOT_DEPTH_DELTA: {
    sourceId: 'binance-spot-market-stream', dataset: 'spot.depth_delta', endpointClass: 'PUBLIC',
    productFamily: 'SPOT', evidenceKinds: ['DEPTH_DELTA'], endpoint: 'wss://stream.binance.com:9443/ws',
    channel: '<symbol>@depth@100ms', freshnessBasis: 'SOURCE_EVENT_TIME', sourceEventTimeField: 'E',
    sourceTransactionTimeField: null, sequenceFields: ['U', 'u'], bookScope: 'UNKNOWN', sourceMarketType: null,
    samplingWindowMs: 100, notes: ['zero quantity removes a price level'],
  },
  USD_M_DEPTH_SNAPSHOT: {
    sourceId: 'binance-futures-rest', dataset: 'usd_m.depth_snapshot', endpointClass: 'REST',
    productFamily: 'USD_M_PERPETUAL', evidenceKinds: ['DEPTH_SNAPSHOT'], endpoint: 'https://fapi.binance.com/fapi/v1/depth',
    channel: null, freshnessBasis: 'SOURCE_TRANSACTION_TIME', sourceEventTimeField: 'E', sourceTransactionTimeField: 'T',
    sequenceFields: ['lastUpdateId'], bookScope: 'STANDARD_NO_RPI', sourceMarketType: 1, samplingWindowMs: null,
    notes: ['standard Futures book excludes RPI orders'],
  },
  USD_M_DEPTH_DELTA: {
    sourceId: 'binance-futures-public-stream', dataset: 'usd_m.depth_delta', endpointClass: 'PUBLIC',
    productFamily: 'USD_M_PERPETUAL', evidenceKinds: ['DEPTH_DELTA'], endpoint: 'wss://fstream.binance.com/public',
    channel: '<symbol>@depth@100ms', freshnessBasis: 'SOURCE_TRANSACTION_TIME', sourceEventTimeField: 'E',
    sourceTransactionTimeField: 'T', sequenceFields: ['U', 'u', 'pu'], bookScope: 'STANDARD_NO_RPI', sourceMarketType: 1,
    samplingWindowMs: 100, notes: ['standard Futures book excludes RPI orders', 'pu links the previous final update ID', 'zero quantity removes a price level'],
  },
  USD_M_RPI_DEPTH_DELTA: {
    sourceId: 'binance-futures-public-stream', dataset: 'usd_m.rpi_depth_delta', endpointClass: 'PUBLIC',
    productFamily: 'USD_M_PERPETUAL', evidenceKinds: ['DEPTH_DELTA'], endpoint: 'wss://fstream.binance.com/public',
    channel: '<symbol>@rpiDepth@500ms', freshnessBasis: 'SOURCE_TRANSACTION_TIME', sourceEventTimeField: 'E',
    sourceTransactionTimeField: 'T', sequenceFields: ['U', 'u', 'pu'], bookScope: 'RPI_INCLUDED', sourceMarketType: 1,
    samplingWindowMs: 500, notes: ['includes RPI orders', 'pu links the previous final update ID'],
  },
  USD_M_MARK_PRICE: {
    sourceId: 'binance-futures-market-stream', dataset: 'usd_m.mark_price', endpointClass: 'MARKET',
    productFamily: 'USD_M_PERPETUAL', evidenceKinds: ['MARK_PRICE', 'FUNDING'], endpoint: 'wss://fstream.binance.com/market',
    channel: '<symbol>@markPrice@1s', freshnessBasis: 'SOURCE_EVENT_TIME', sourceEventTimeField: 'E',
    sourceTransactionTimeField: null, sequenceFields: [], bookScope: null, sourceMarketType: 1,
    samplingWindowMs: 1_000, notes: ['T is next funding time, not source transaction time', 'r is the latest funding rate'],
  },
  USD_M_FUNDING_HISTORY: {
    sourceId: 'binance-futures-rest', dataset: 'usd_m.funding_history', endpointClass: 'REST',
    productFamily: 'USD_M_PERPETUAL', evidenceKinds: ['FUNDING'], endpoint: 'https://fapi.binance.com/fapi/v1/fundingRate',
    channel: null, freshnessBasis: 'SOURCE_TRANSACTION_TIME', sourceEventTimeField: null,
    sourceTransactionTimeField: 'fundingTime', sequenceFields: [], bookScope: null, sourceMarketType: 1,
    samplingWindowMs: null, notes: ['fundingTime is the realized funding timestamp'],
  },
  USD_M_FUNDING_INFO: {
    sourceId: 'binance-futures-rest', dataset: 'usd_m.funding_info', endpointClass: 'REST',
    productFamily: 'USD_M_PERPETUAL', evidenceKinds: ['FUNDING'], endpoint: 'https://fapi.binance.com/fapi/v1/fundingInfo',
    channel: null, freshnessBasis: 'RECEIVE_TIME', sourceEventTimeField: null,
    sourceTransactionTimeField: null, sequenceFields: [], bookScope: null, sourceMarketType: 1,
    samplingWindowMs: null, notes: ['authoritative source for adjustedFundingRateCap, adjustedFundingRateFloor, and fundingIntervalHours', 'response has no exchange timestamp'],
  },
  USD_M_OPEN_INTEREST: {
    sourceId: 'binance-futures-rest', dataset: 'usd_m.open_interest', endpointClass: 'REST',
    productFamily: 'USD_M_PERPETUAL', evidenceKinds: ['OPEN_INTEREST'], endpoint: 'https://fapi.binance.com/fapi/v1/openInterest',
    channel: null, freshnessBasis: 'SOURCE_TRANSACTION_TIME', sourceEventTimeField: null,
    sourceTransactionTimeField: 'time', sequenceFields: [], bookScope: null, sourceMarketType: 1,
    samplingWindowMs: null, notes: ['openInterest is base-asset open interest for USD-M'],
  },
  USD_M_OPEN_INTEREST_HISTORY: {
    sourceId: 'binance-futures-data-rest', dataset: 'usd_m.open_interest_history', endpointClass: 'REST',
    productFamily: 'USD_M_PERPETUAL', evidenceKinds: ['OPEN_INTEREST'], endpoint: 'https://fapi.binance.com/futures/data/openInterestHist',
    channel: null, freshnessBasis: 'SOURCE_TRANSACTION_TIME', sourceEventTimeField: null,
    sourceTransactionTimeField: 'timestamp', sequenceFields: [], bookScope: null, sourceMarketType: 1,
    samplingWindowMs: null, notes: ['sumOpenInterest is base quantity', 'sumOpenInterestValue is quote value'],
  },
  USD_M_LIQUIDATION: {
    sourceId: 'binance-futures-market-stream', dataset: 'usd_m.liquidation', endpointClass: 'MARKET',
    productFamily: 'USD_M_PERPETUAL', evidenceKinds: ['LIQUIDATION'], endpoint: 'wss://fstream.binance.com/market',
    channel: '!forceOrder@arr', freshnessBasis: 'SOURCE_TRANSACTION_TIME', sourceEventTimeField: 'E',
    sourceTransactionTimeField: 'o.T', sequenceFields: [], bookScope: null, sourceMarketType: 1,
    samplingWindowMs: 1_000, notes: ['only the latest liquidation order per symbol in each 1000ms window is pushed', 'the stream is sampled and silence is not proof of zero liquidations', 'SELL liquidates a LONG; BUY liquidates a SHORT'],
  },
  MARGIN_ALL_ASSETS: {
    sourceId: 'binance-margin-rest', dataset: 'margin.all_assets', endpointClass: 'REST',
    productFamily: 'BORROW', evidenceKinds: ['BORROW'], endpoint: 'https://api.binance.com/sapi/v1/margin/allAssets',
    channel: null, freshnessBasis: 'RECEIVE_TIME', sourceEventTimeField: null, sourceTransactionTimeField: null,
    sequenceFields: [], bookScope: null, sourceMarketType: null, samplingWindowMs: null,
    notes: ['security type is MARKET_DATA', 'isBorrowable is asset-level eligibility'],
  },
  MARGIN_MAX_BORROWABLE: {
    sourceId: 'binance-margin-user-data-rest', dataset: 'margin.max_borrowable', endpointClass: 'REST',
    productFamily: 'BORROW', evidenceKinds: ['BORROW'], endpoint: 'https://api.binance.com/sapi/v1/margin/maxBorrowable',
    channel: null, freshnessBasis: 'RECEIVE_TIME', sourceEventTimeField: null, sourceTransactionTimeField: null,
    sequenceFields: [], bookScope: null, sourceMarketType: null, samplingWindowMs: null,
    notes: ['amount is currently max-borrowable with sufficient system availability', 'borrowLimit is account-level'],
  },
  MARGIN_AVAILABLE_INVENTORY: {
    sourceId: 'binance-margin-user-data-rest', dataset: 'margin.available_inventory', endpointClass: 'REST',
    productFamily: 'BORROW', evidenceKinds: ['BORROW'], endpoint: 'https://api.binance.com/sapi/v1/margin/available-inventory',
    channel: null, freshnessBasis: 'SOURCE_TRANSACTION_TIME', sourceEventTimeField: null,
    sourceTransactionTimeField: 'updateTime', sequenceFields: [], bookScope: null, sourceMarketType: null,
    samplingWindowMs: null, notes: ['asset inventory is returned in the assets map', 'updateTime is epoch seconds and is normalized to milliseconds'],
  },
  MARGIN_NEXT_HOURLY_RATE: {
    sourceId: 'binance-margin-user-data-rest', dataset: 'margin.next_hourly_interest_rate', endpointClass: 'REST',
    productFamily: 'BORROW', evidenceKinds: ['BORROW'], endpoint: 'https://api.binance.com/sapi/v1/margin/next-hourly-interest-rate',
    channel: null, freshnessBasis: 'RECEIVE_TIME', sourceEventTimeField: null, sourceTransactionTimeField: null,
    sequenceFields: [], bookScope: null, sourceMarketType: null, samplingWindowMs: null,
    notes: ['nextHourlyInterestRate is a decimal hourly rate; 0.00002 means 0.002% per hour'],
  },
  MARGIN_BORROW_COMPOSITE: {
    sourceId: 'binance-margin-borrow-composite', dataset: 'margin.borrow_composite', endpointClass: 'INJECTED',
    productFamily: 'BORROW', evidenceKinds: ['BORROW'], endpoint: 'injected://binance-margin-borrow-composite',
    channel: null, freshnessBasis: 'RECEIVE_TIME', sourceEventTimeField: null,
    sourceTransactionTimeField: 'availableInventory.updateTime', sequenceFields: [], bookScope: null, sourceMarketType: null,
    samplingWindowMs: null, notes: ['pure composite of separately supplied official endpoint records; no request credentials are retained'],
  },
  CONTEXT_INJECTED: {
    sourceId: 'operator-context-injected', dataset: 'market.context', endpointClass: 'INJECTED',
    productFamily: 'ANY', evidenceKinds: ['CONTEXT'], endpoint: 'injected://market-context', channel: null,
    freshnessBasis: 'SOURCE_EVENT_TIME', sourceEventTimeField: 'sourceEventTimeMs',
    sourceTransactionTimeField: 'sourceTransactionTimeMs', sequenceFields: [], bookScope: null,
    sourceMarketType: null, samplingWindowMs: null, notes: ['context is accepted only as explicit primitive-valued evidence'],
  },
} as const satisfies Record<string, BinanceSourceFact>;

for (const fact of Object.values(facts)) {
  Object.freeze(fact.evidenceKinds);
  Object.freeze(fact.sequenceFields);
  Object.freeze(fact.notes);
  Object.freeze(fact);
}
export const BINANCE_SOURCE_FACTS: Readonly<typeof facts> = Object.freeze(facts);
export type BinanceSourceKey = keyof typeof BINANCE_SOURCE_FACTS;

export function getBinanceSourceFact(sourceKey: unknown): BinanceSourceFact | null {
  if (typeof sourceKey !== 'string' || !Object.prototype.hasOwnProperty.call(BINANCE_SOURCE_FACTS, sourceKey)) return null;
  return BINANCE_SOURCE_FACTS[sourceKey as BinanceSourceKey];
}

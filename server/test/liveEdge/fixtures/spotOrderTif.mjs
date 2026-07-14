import assert from 'node:assert/strict';

import {
  RUNTIME_UNIVERSE_DEFAULTS,
  RUNTIME_UNIVERSE_SOURCE_IDS,
  parseExchangeInformation,
} from '../../../dist/intelligenceRuntime/universe/index.js';
import {
  L04_BINANCE_MATRIX_SHA256,
  L04_EXCHANGE_INFO_CONTRACT_IDS,
  bindSpotOrderTifCapability,
  normalizeRuntimeInstrumentRegistry,
} from '../../../dist/liveEdge/adapters/binanceInstrumentSpecs/index.js';

export const L081_T0 = 1_783_920_000_000;

const CONFIG = Object.freeze({
  ...RUNTIME_UNIVERSE_DEFAULTS,
  configurationVersion: 'l081-spot-order-tif-fixture-v1',
  universePolicy: Object.freeze({ ...RUNTIME_UNIVERSE_DEFAULTS.universePolicy }),
});

export function makeSpotRegistry({
  symbol = 'ETHUSDT',
  baseAsset = 'ETH',
  quoteAsset = 'USDT',
  receivedAtMs = L081_T0 - 1_000,
  evaluatedAtMs = L081_T0,
  maximumAgeMs = 120_000,
  orderTypes = ['LIMIT', 'MARKET'],
  filters,
} = {}) {
  const parsed = parseExchangeInformation({
    timezone: 'UTC',
    serverTime: receivedAtMs - 1,
    exchangeFilters: [],
    symbols: [{
      symbol,
      status: 'TRADING',
      baseAsset,
      baseAssetPrecision: 8,
      quoteAsset,
      quotePrecision: 8,
      quoteAssetPrecision: 8,
      baseCommissionPrecision: 8,
      quoteCommissionPrecision: 8,
      orderTypes,
      isSpotTradingAllowed: true,
      isMarginTradingAllowed: false,
      permissionSets: [['SPOT']],
      filters: filters ?? [
        { filterType: 'PRICE_FILTER', minPrice: '0.01', maxPrice: '1000000', tickSize: '0.01' },
        { filterType: 'LOT_SIZE', minQty: '0.001', maxQty: '1000', stepSize: '0.001' },
        { filterType: 'MIN_NOTIONAL', minNotional: '0.1', applyToMarket: true, avgPriceMins: 5 },
      ],
    }],
  }, {
    source: 'SPOT',
    sourceId: RUNTIME_UNIVERSE_SOURCE_IDS.SPOT,
    dataset: 'spot.exchange_info',
    receivedTimeMs: receivedAtMs,
    evaluatedAtMs: receivedAtMs,
    config: CONFIG,
  });
  assert.equal(parsed.listings.length, 1, 'L08.1 fixture must remain Runtime-parseable');
  const normalized = normalizeRuntimeInstrumentRegistry({
    matrixSha256: L04_BINANCE_MATRIX_SHA256,
    contractId: L04_EXCHANGE_INFO_CONTRACT_IDS.SPOT,
    product: 'SPOT',
    environment: 'PRODUCTION',
    evaluatedAtMs,
    maximumAgeMs,
    metadata: [parsed.listings[0].metadata],
  });
  assert.equal(normalized.ok, true, normalized.reasonCodes?.join(','));
  return normalized.snapshot;
}

export function makeSpotSizingRequest(registry, overrides = {}) {
  const instrument = registry.instruments[0];
  return {
    symbol: instrument.symbol,
    instrumentRevision: instrument.instrumentRevision,
    side: 'BUY',
    orderType: 'LIMIT',
    timeInForce: 'GTC',
    requestedPrice: '100',
    referencePrice: null,
    requestedQuantity: '0.1',
    notionalAsset: 'USDT',
    approvedNotional: '10',
    intendedExposure: '10',
    evaluatedAtMs: L081_T0,
    ...structuredClone(overrides),
  };
}

export function makeSpotOrderTifCapability(options = {}) {
  const registry = makeSpotRegistry(options.registry);
  const request = makeSpotSizingRequest(registry, options.request);
  const result = bindSpotOrderTifCapability(registry, request);
  assert.equal(result.ok, true, result.reasonCodes?.join(','));
  return { registry, request, capability: result.binding };
}

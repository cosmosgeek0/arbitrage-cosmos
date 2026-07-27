#!/usr/bin/env node
/**
 * Focused, network-free proof that Binance Spot venue filters fail closed.
 *
 * Run:
 *   npm run build -w server
 *   node --test server/test/foundation/execution/spot-filter-unsupported.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBinanceSpotOrderFilters } from '../../../dist/foundation/exchange/binanceSpot/filters.js';

const order = Object.freeze({
  type: 'LIMIT',
  side: 'BUY',
  quantity: '1',
  price: '10',
});

function supportedFilters() {
  return [
    {
      filterType: 'PRICE_FILTER',
      minPrice: '0',
      maxPrice: '0',
      tickSize: '0',
    },
    {
      filterType: 'LOT_SIZE',
      minQty: '0.001',
      maxQty: '100',
      stepSize: '0.001',
    },
    {
      filterType: 'NOTIONAL',
      minNotional: '1',
      applyMinToMarket: true,
      maxNotional: '100',
      applyMaxToMarket: true,
      avgPriceMins: 5,
    },
  ];
}

const currentUnimplementedSendConstraints = [
  'PERCENT_PRICE',
  'ICEBERG_PARTS',
  'MAX_NUM_ORDERS',
  'MAX_NUM_ALGO_ORDERS',
  'MAX_NUM_ICEBERG_ORDERS',
  'MAX_POSITION',
  'TRAILING_DELTA',
  'MAX_NUM_ORDER_AMENDS',
  'MAX_NUM_ORDER_LISTS',
  'EXCHANGE_MAX_NUM_ORDERS',
  'EXCHANGE_MAX_NUM_ALGO_ORDERS',
  'EXCHANGE_MAX_NUM_ICEBERG_ORDERS',
  'EXCHANGE_MAX_NUM_ORDER_LISTS',
  'MAX_ASSET',
];

const percentPriceBySide = Object.freeze({
  filterType: 'PERCENT_PRICE_BY_SIDE',
  bidMultiplierUp: '5',
  bidMultiplierDown: '0.2',
  askMultiplierUp: '5',
  askMultiplierDown: '0.2',
  avgPriceMins: 5,
});

test('a fully supported filter snapshot passes with disabled PRICE_FILTER zero fields', () => {
  const result = validateBinanceSpotOrderFilters(order, supportedFilters());

  assert.equal(result.ok, true);
  assert.equal(result.notional, '10');
  assert.deepEqual(result.failures, []);
});

test('every current unimplemented price, order-count, position, and asset constraint fails closed', () => {
  for (const filterType of currentUnimplementedSendConstraints) {
    const result = validateBinanceSpotOrderFilters(order, [
      ...supportedFilters(),
      { filterType },
    ]);

    assert.equal(result.ok, false, filterType);
    assert.deepEqual(
      result.failures.filter((failure) => failure.code === 'UNSUPPORTED_FILTER'),
      [
        {
          code: 'UNSUPPORTED_FILTER',
          filterType,
          field: 'filterType',
          observed: filterType,
          limit: 'locally implemented filter',
        },
      ],
      filterType,
    );
  }
});

test('PERCENT_PRICE_BY_SIDE is implemented and no longer blocks as unsupported', () => {
  const result = validateBinanceSpotOrderFilters(
    order,
    [...supportedFilters(), percentPriceBySide],
    {
      referencePrice: {
        state: 'SET',
        price: '10',
        providerTimestampMs: 1,
      },
      fallbackPrices: [],
      executionRules: [],
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('PRICE_RANGE is not an exchangeInfo filter and fails closed inside a snapshot', () => {
  const result = validateBinanceSpotOrderFilters(order, [
    ...supportedFilters(),
    {
      filterType: 'PRICE_RANGE',
      ruleType: 'PRICE_RANGE',
      bidLimitMultUp: '2',
    },
  ]);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.failures.filter((failure) => failure.code === 'UNSUPPORTED_FILTER'),
    [
      {
        code: 'UNSUPPORTED_FILTER',
        filterType: 'PRICE_RANGE',
        field: 'filterType',
        observed: 'PRICE_RANGE',
        limit: 'locally implemented filter',
      },
    ],
  );
  // The snapshot entry is rejected rather than silently promoted to the
  // separate execution-time rule it impersonates.
  assert.deepEqual(result.priceRange, {
    rulePresent: false,
    side: 'BUY',
    limitMultiplierDown: null,
    limitMultiplierUp: null,
    referencePriceState: 'UNKNOWN',
    enforcementPhase: 'TAKER_EXECUTION',
    outOfRangeOutcome: 'EXPIRED_EXECUTION_RULE_PRICE_RANGE_EXCEEDED',
    venueAcceptance: 'NOT_CLAIMED',
  });
});

test('an unknown future filter and malformed filter entries cannot pass', () => {
  const future = validateBinanceSpotOrderFilters(order, [
    ...supportedFilters(),
    { filterType: 'FUTURE_SEND_CONSTRAINT' },
  ]);
  assert.equal(future.ok, false);
  assert.equal(future.failures.at(-1)?.code, 'UNSUPPORTED_FILTER');

  for (const candidate of [null, [], {}, { filterType: '' }]) {
    const malformed = validateBinanceSpotOrderFilters(order, [
      ...supportedFilters(),
      candidate,
    ]);
    assert.equal(malformed.ok, false);
    assert.equal(
      malformed.failures.some((failure) => failure.code === 'MALFORMED_FILTER'),
      true,
    );
  }
});

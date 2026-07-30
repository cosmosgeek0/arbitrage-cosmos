#!/usr/bin/env node
/**
 * Focused, network-free proof for Outcome-3 Slice A.
 *
 * Run:
 *   npm run build -w server
 *   node --test server/test/foundation/execution/spot-ticket-risk-filter-client-id.mjs
 */
import assert from 'node:assert/strict';
import {
  createSpotExecutionTicket,
  isSameSpotExecutionIntent,
} from '../../../dist/foundation/execution/spotTicket.js';
import {
  BINANCE_SPOT_CLIENT_ORDER_ID_PATTERN,
  deriveBinanceSpotClientOrderId,
  isBinanceSpotClientOrderId,
} from '../../../dist/foundation/exchange/binanceSpot/clientOrderId.js';
import { deriveClientOrderId } from '../../../dist/foundation/contracts/exchange.js';
import {
  addSpotDecimals,
  compareSpotDecimals,
  multiplySpotDecimals,
  normalizeSpotDecimal,
  validateBinanceSpotOrderFilters,
} from '../../../dist/foundation/exchange/binanceSpot/filters.js';
import {
  OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
  SpotRiskRejectedError,
  assertSpotRiskAllowed,
  createSpotRiskPolicy,
  evaluateSpotRiskPolicy,
} from '../../../dist/foundation/risk/spotRiskPolicy.js';
import {
  deriveFlattenLeg,
} from '../../../dist/foundation/execution/spotCore.js';

let assertions = 0;
function check(name, test) {
  test();
  assertions += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = 1_900_000_000_000;

function ticketInput(overrides = {}) {
  return {
    correlationId: 'cor_spot_001',
    planId: 'plan_spot_001',
    accountId: 'binance-primary',
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity: '0.1000',
    price: '100.00',
    riskReferencePrice: '100.00',
    estimatedMaxLossQuote: '5.00',
    purpose: 'ENTRY',
    attempt: 0,
    createdAtMs: NOW,
    expiresAtMs: NOW + 5_000,
    ...overrides,
  };
}

function supportedFilters(overrides = {}) {
  return [
    {
      filterType: 'PRICE_FILTER',
      minPrice: '0.01',
      maxPrice: '1000000',
      tickSize: '0.01',
    },
    {
      filterType: 'LOT_SIZE',
      minQty: '0.0001',
      maxQty: '100',
      stepSize: '0.0001',
    },
    {
      filterType: 'MARKET_LOT_SIZE',
      minQty: '0.001',
      maxQty: '50',
      stepSize: '0.001',
    },
    {
      filterType: 'MIN_NOTIONAL',
      minNotional: '10',
      applyToMarket: true,
      avgPriceMins: 5,
    },
    {
      filterType: 'NOTIONAL',
      minNotional: '5',
      applyMinToMarket: true,
      maxNotional: '1000',
      applyMaxToMarket: true,
      avgPriceMins: 5,
    },
  ].map((filter) =>
    filter.filterType === overrides.filterType
      ? { ...filter, ...overrides }
      : filter,
  );
}

function codes(result) {
  return result.failures.map((item) => item.code);
}

function riskPolicy(overrides = {}) {
  return createSpotRiskPolicy({
    minOrderNotionalQuote: '10',
    maxOrderNotionalQuote: OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
    maxLossPerOrderQuote: '20',
    maxDailyLossQuote: '100',
    ...overrides,
  });
}

function riskInput(overrides = {}) {
  const ticket = createSpotExecutionTicket(ticketInput());
  return {
    nowMs: NOW + 1,
    policy: riskPolicy(),
    subject: ticket,
    killSwitch: { engaged: false },
    realizedDailyLossQuote: '50',
    ...overrides,
  };
}

console.log('\nExact decimal kernel');
check('normalizes without Number coercion', () => {
  assert.equal(normalizeSpotDecimal('00012.3400'), '12.34');
  assert.equal(multiplySpotDecimals('0.00000003', '0.2'), '0.000000006');
  assert.equal(addSpotDecimals('999999999999999999.9', '0.1'), '1000000000000000000');
  assert.equal(compareSpotDecimals('1.0000000000000000001', '1'), 1);
});
check('compares the bounded exact output of 120-digit multiplication', () => {
  const operand = '9'.repeat(120);
  const product = multiplySpotDecimals(operand, operand);
  assert.equal(product.length, 240);
  assert.equal(compareSpotDecimals(product, product), 0);
  const result = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', side: 'BUY', quantity: operand, price: operand },
    [
      {
        filterType: 'PRICE_FILTER',
        minPrice: '0',
        maxPrice: '0',
        tickSize: '0',
      },
      {
        filterType: 'LOT_SIZE',
        minQty: '1',
        maxQty: operand,
        stepSize: '1',
      },
      {
        filterType: 'MIN_NOTIONAL',
        minNotional: '1',
        applyToMarket: true,
        avgPriceMins: 5,
      },
    ],
  );
  assert.equal(result.ok, true);
  assert.equal(result.notional, product);
});
check('rejects exponent, sign, whitespace, NaN, and Infinity forms', () => {
  for (const value of ['1e-8', '-1', '+1', ' 1', 'NaN', 'Infinity', '.1']) {
    assert.throws(() => normalizeSpotDecimal(value), TypeError);
  }
});

console.log('\nDeterministic ticket and client ID');
check('same semantic inputs produce byte-identical frozen tickets', () => {
  const first = createSpotExecutionTicket(ticketInput());
  const second = createSpotExecutionTicket(ticketInput());
  assert.deepEqual(first, second);
  assert.equal(isSameSpotExecutionIntent(first, second), true);
  assert.equal(first.quantity, '0.1');
  assert.equal(first.price, '100');
  assert.equal(first.notionalPrice, '100');
  assert.equal(first.orderNotionalQuote, '10');
  assert.equal(Object.isFrozen(first), true);
  assert.throws(() => {
    first.symbol = 'ETHUSDT';
  }, TypeError);
});
check('any bound semantic change produces a distinct ticket/client identity', () => {
  const original = createSpotExecutionTicket(ticketInput());
  const changed = createSpotExecutionTicket(
    ticketInput({ riskReferencePrice: '100.01' }),
  );
  assert.notEqual(changed.ticketId, original.ticketId);
  assert.notEqual(changed.clientOrderId, original.clientOrderId);
  assert.equal(isSameSpotExecutionIntent(original, changed), false);
});
check('MARKET tickets require null price/TIF and preserve injected risk price', () => {
  const ticket = createSpotExecutionTicket(
    ticketInput({
      type: 'MARKET',
      timeInForce: null,
      price: null,
      purpose: 'FLATTEN',
    }),
  );
  assert.equal(ticket.price, null);
  assert.equal(ticket.timeInForce, null);
  assert.equal(ticket.riskEffect, 'UNPROVEN_RISK_REDUCTION');
  assert.equal(ticket.notionalPrice, '100');
  assert.match(ticket.clientOrderId, /^cx-/);
  assert.throws(
    () =>
      createSpotExecutionTicket(
        ticketInput({ type: 'MARKET', timeInForce: 'GTC', price: null }),
      ),
    TypeError,
  );
});
check('ticket rejects non-plain decimals and invalid validity windows', () => {
  assert.throws(
    () => createSpotExecutionTicket(ticketInput({ quantity: '1e-3' })),
    TypeError,
  );
  assert.throws(
    () => createSpotExecutionTicket(ticketInput({ expiresAtMs: NOW })),
    TypeError,
  );
});
check('client ID is deterministic, purpose-bound, and Binance-safe', () => {
  const input = {
    planId: 'plan_spot_001',
    legId: 'leg_spot_entry_001',
    attempt: 999,
  };
  const first = deriveBinanceSpotClientOrderId(input);
  assert.equal(first, deriveBinanceSpotClientOrderId(input));
  assert.equal(first, deriveClientOrderId(input));
  assert.equal(isBinanceSpotClientOrderId(first), true);
  assert.equal(first.length <= 36, true);
  assert.equal(BINANCE_SPOT_CLIENT_ORDER_ID_PATTERN.test(first), true);
  assert.notEqual(
    first,
    deriveBinanceSpotClientOrderId({
      ...input,
      legId: 'leg_spot_flatten_001',
    }),
  );
  assert.throws(
    () => deriveBinanceSpotClientOrderId({ ...input, attempt: 1000 }),
    TypeError,
  );
});

console.log('\nBinance Spot filter contract');
check('accepts exact LIMIT boundaries and computes exact notional', () => {
  const result = validateBinanceSpotOrderFilters(
    {
      type: 'LIMIT',
      side: 'BUY',
      quantity: '0.1000',
      price: '100.00',
      stopPrice: '99.99',
    },
    supportedFilters(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.notional, '10');
  assert.deepEqual(result.failures, []);
  assert.equal(Object.isFrozen(result.failures), true);
});
check('enforces PRICE_FILTER tick and bounds for price and stopPrice', () => {
  const tick = validateBinanceSpotOrderFilters(
    {
      type: 'LIMIT',
      side: 'BUY',
      quantity: '0.1',
      price: '100.001',
      stopPrice: '99.999',
    },
    supportedFilters(),
  );
  assert.equal(tick.ok, false);
  assert.equal(
    codes(tick).filter((code) => code === 'PRICE_TICK_MISMATCH').length,
    2,
  );
  const below = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', side: 'BUY', quantity: '100', price: '0.001' },
    supportedFilters(),
  );
  assert.equal(codes(below).includes('PRICE_BELOW_MIN'), true);
});
check('honors disabled PRICE_FILTER rules represented by zero', () => {
  const result = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', side: 'BUY', quantity: '0.1', price: '100.001' },
    supportedFilters({
      filterType: 'PRICE_FILTER',
      minPrice: '0',
      maxPrice: '0',
      tickSize: '0',
    }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});
check('enforces LOT_SIZE and MARKET_LOT_SIZE independently', () => {
  const lot = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', side: 'BUY', quantity: '0.10005', price: '100' },
    supportedFilters(),
  );
  assert.equal(codes(lot).includes('QUANTITY_STEP_MISMATCH'), true);
  const marketLot = validateBinanceSpotOrderFilters(
    {
      type: 'MARKET',
      side: 'BUY',
      quantity: '0.0005',
      price: null,
    },
    supportedFilters(),
    venueEvidence({ referencePrice: referencePriceSet('20000') }),
  );
  assert.equal(codes(marketLot).includes('QUANTITY_BELOW_MIN'), true);
});
check('enforces MIN_NOTIONAL and NOTIONAL lower/upper limits', () => {
  const low = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', side: 'BUY', quantity: '0.09', price: '100' },
    supportedFilters(),
  );
  assert.equal(codes(low).includes('NOTIONAL_BELOW_MIN'), true);
  const high = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', side: 'BUY', quantity: '10.0001', price: '100' },
    supportedFilters(),
  );
  assert.equal(codes(high).includes('NOTIONAL_ABOVE_MAX'), true);
});
check('MARKET notional is fail-closed without its injected reference price', () => {
  const missing = validateBinanceSpotOrderFilters(
    { type: 'MARKET', side: 'BUY', quantity: '0.1', price: null },
    supportedFilters(),
  );
  assert.equal(
    codes(missing).includes('MISSING_MARKET_REFERENCE_PRICE'),
    true,
  );
  const valid = validateBinanceSpotOrderFilters(
    {
      type: 'MARKET',
      side: 'BUY',
      quantity: '0.1',
      price: null,
    },
    supportedFilters(),
    venueEvidence(),
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.notional, '10');

  const vwapFallback = validateBinanceSpotOrderFilters(
    { type: 'MARKET', side: 'BUY', quantity: '0.1', price: null },
    supportedFilters(),
    fallbackEvidence([vwapFallbackPrice()]),
  );
  assert.equal(vwapFallback.ok, true);
  assert.equal(vwapFallback.notional, '10');

  // Concurrently published filters can demand different windows, so a fallback
  // set carries one entry per window rather than one shared price.
  const mixedWindows = validateBinanceSpotOrderFilters(
    { type: 'MARKET', side: 'BUY', quantity: '0.1', price: null },
    supportedFilters().map((filter) =>
      filter.filterType === 'MIN_NOTIONAL'
        ? { ...filter, avgPriceMins: 1 }
        : filter,
    ),
    fallbackEvidence([
      vwapFallbackPrice('100', 1),
      vwapFallbackPrice('110', 5),
    ]),
  );
  assert.equal(mixedWindows.ok, true);
  assert.equal(mixedWindows.notional, '11');

  const belowMinWindow = validateBinanceSpotOrderFilters(
    { type: 'MARKET', side: 'BUY', quantity: '0.1', price: null },
    supportedFilters().map((filter) =>
      filter.filterType === 'MIN_NOTIONAL'
        ? { ...filter, avgPriceMins: 1 }
        : filter,
    ),
    fallbackEvidence([
      vwapFallbackPrice('99', 1),
      vwapFallbackPrice('110', 5),
    ]),
  );
  assert.ok(
    belowMinWindow.failures.some(
      (failure) =>
        failure.code === 'NOTIONAL_BELOW_MIN' &&
        failure.filterType === 'MIN_NOTIONAL',
    ),
  );

  const aboveMaxWindow = validateBinanceSpotOrderFilters(
    { type: 'MARKET', side: 'BUY', quantity: '0.1', price: null },
    supportedFilters().map((filter) => {
      if (filter.filterType === 'MIN_NOTIONAL') {
        return { ...filter, avgPriceMins: 1 };
      }
      if (filter.filterType === 'NOTIONAL') {
        return { ...filter, maxNotional: '10.5' };
      }
      return filter;
    }),
    fallbackEvidence([
      vwapFallbackPrice('100', 1),
      vwapFallbackPrice('110', 5),
    ]),
  );
  assert.ok(
    aboveMaxWindow.failures.some(
      (failure) =>
        failure.code === 'NOTIONAL_ABOVE_MAX' &&
        failure.filterType === 'NOTIONAL',
    ),
  );
});
check('market-application flags can disable reference-price notional checks', () => {
  const filters = supportedFilters().map((filter) => {
    if (filter.filterType === 'MIN_NOTIONAL') {
      return { ...filter, applyToMarket: false };
    }
    if (filter.filterType === 'NOTIONAL') {
      return {
        ...filter,
        applyMinToMarket: false,
        applyMaxToMarket: false,
      };
    }
    return filter;
  });
  const result = validateBinanceSpotOrderFilters(
    { type: 'MARKET', side: 'BUY', quantity: '0.1', price: null },
    filters,
  );
  assert.equal(result.ok, true);
  assert.equal(result.notional, null);
});
check('missing, duplicate, and malformed safety filters reject', () => {
  const missing = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', side: 'BUY', quantity: '0.1', price: '100' },
    supportedFilters().filter((filter) => filter.filterType !== 'LOT_SIZE'),
  );
  assert.equal(codes(missing).includes('MISSING_LOT_SIZE_FILTER'), true);

  const duplicateFilters = supportedFilters();
  duplicateFilters.push({ ...duplicateFilters[0] });
  const duplicate = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', side: 'BUY', quantity: '0.1', price: '100' },
    duplicateFilters,
  );
  assert.equal(codes(duplicate).includes('DUPLICATE_FILTER'), true);

  const malformed = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', side: 'BUY', quantity: '0.1', price: '100' },
    supportedFilters({ filterType: 'PRICE_FILTER', tickSize: '1e-2' }),
  );
  assert.equal(codes(malformed).includes('MALFORMED_FILTER'), true);

  const disabled = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', side: 'BUY', quantity: '0.1', price: '100' },
    supportedFilters({ filterType: 'LOT_SIZE', stepSize: '0' }),
  );
  assert.equal(codes(disabled).includes('MALFORMED_FILTER'), true);

  const evolvedKnownFilter = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', side: 'BUY', quantity: '0.1', price: '100' },
    supportedFilters({
      filterType: 'PRICE_FILTER',
      futureConstraint: '1',
    }),
  );
  assert.equal(
    codes(evolvedKnownFilter).includes('MALFORMED_FILTER'),
    true,
  );
});

function percentPriceBySide(overrides = {}) {
  return {
    filterType: 'PERCENT_PRICE_BY_SIDE',
    bidMultiplierUp: '1.2',
    bidMultiplierDown: '0.8',
    askMultiplierUp: '1.5',
    askMultiplierDown: '0.5',
    avgPriceMins: 5,
    ...overrides,
  };
}

function priceRangeRule(overrides = {}) {
  return {
    ruleType: 'PRICE_RANGE',
    bidLimitMultUp: '1.2',
    bidLimitMultDown: '0.8',
    askLimitMultUp: '1.5',
    askLimitMultDown: '0.5',
    ...overrides,
  };
}

function sideOrder(side, price) {
  return { type: 'LIMIT', side, quantity: '1', price };
}

function referencePriceSet(price = '100') {
  return {
    state: 'SET',
    price,
    providerTimestampMs: NOW - 10,
  };
}

function referencePriceNull() {
  return { state: 'NULL', providerTimestampMs: NOW - 20 };
}

function referencePriceNeverSet() {
  return { state: 'NEVER_SET', errorCode: -2043 };
}

function vwapFallbackPrice(price = '100', windowMins = 5) {
  return {
    basis: 'VWAP',
    price,
    windowMins,
    providerCloseTimeMs: NOW - 10,
  };
}

function lastFallbackPrice(price = '100') {
  return {
    basis: 'LAST_PRICE',
    price,
    retrievedAtMs: NOW - 10,
    providerTimestampMs: null,
  };
}

function venueEvidence(overrides = {}) {
  return {
    referencePrice: referencePriceSet(),
    fallbackPrices: [],
    executionRules: [],
    ...overrides,
  };
}

/** Fallbacks are only in force while the venue reports no reference price. */
function fallbackEvidence(fallbackPrices, overrides = {}) {
  return venueEvidence({
    referencePrice: referencePriceNull(),
    fallbackPrices,
    ...overrides,
  });
}

function percentAdmission(side, price, evidence = venueEvidence()) {
  return validateBinanceSpotOrderFilters(
    sideOrder(side, price),
    [...supportedFilters(), percentPriceBySide()],
    evidence,
  );
}

check('an order without an exact side cannot be validated at all', () => {
  for (const side of [undefined, null, 'buy', 'LONG', '']) {
    const result = validateBinanceSpotOrderFilters(
      { type: 'LIMIT', side, quantity: '1', price: '100' },
      supportedFilters(),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(codes(result), ['INVALID_ORDER']);
    assert.equal(result.failures[0].field, 'side');
    assert.equal(result.priceRange, null);
  }
});
check('numeric-zero stepSize disables only MARKET_LOT_SIZE while LOT_SIZE stays active', () => {
  const enforced = validateBinanceSpotOrderFilters(
    {
      type: 'MARKET',
      side: 'BUY',
      quantity: '0.1005',
      price: null,
    },
    supportedFilters(),
    venueEvidence(),
  );
  assert.equal(
    codes(enforced).includes('QUANTITY_STEP_MISMATCH'),
    true,
  );

  const disabled = validateBinanceSpotOrderFilters(
    {
      type: 'MARKET',
      side: 'BUY',
      quantity: '0.1005',
      price: null,
    },
    supportedFilters({
      filterType: 'MARKET_LOT_SIZE',
      minQty: '0.00000000',
      maxQty: '0.2',
      stepSize: '0.00000000',
    }),
    venueEvidence(),
  );
  assert.equal(disabled.ok, true);
  assert.deepEqual(disabled.failures, []);

  const lotStillActive = validateBinanceSpotOrderFilters(
    {
      type: 'MARKET',
      side: 'BUY',
      quantity: '0.10005',
      price: null,
    },
    supportedFilters({
      filterType: 'MARKET_LOT_SIZE',
      minQty: '0.00000000',
      maxQty: '0.2',
      stepSize: '0.00000000',
    }),
    venueEvidence(),
  );
  assert.deepEqual(
    lotStillActive.failures.map((item) => [item.code, item.filterType]),
    [['QUANTITY_STEP_MISMATCH', 'LOT_SIZE']],
  );

  const marketMaxStillActive = validateBinanceSpotOrderFilters(
    {
      type: 'MARKET',
      side: 'BUY',
      quantity: '0.2001',
      price: null,
    },
    supportedFilters({
      filterType: 'MARKET_LOT_SIZE',
      minQty: '0.00000000',
      maxQty: '0.2',
      stepSize: '0.00000000',
    }),
    venueEvidence(),
  );
  assert.deepEqual(
    marketMaxStillActive.failures
      .filter((item) => item.code === 'QUANTITY_ABOVE_MAX')
      .map((item) => item.filterType),
    ['MARKET_LOT_SIZE'],
  );

  const lotZeroStep = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', side: 'BUY', quantity: '0.1', price: '100' },
    supportedFilters({ filterType: 'LOT_SIZE', stepSize: '0.00000000' }),
  );
  assert.equal(codes(lotZeroStep).includes('MALFORMED_FILTER'), true);
});
check('PERCENT_PRICE_BY_SIDE admits inclusively from the order side multipliers', () => {
  for (const price of ['80', '100', '120']) {
    assert.equal(percentAdmission('BUY', price).ok, true, price);
  }
  for (const price of ['50', '100', '150']) {
    assert.equal(percentAdmission('SELL', price).ok, true, price);
  }

  const above = percentAdmission('BUY', '120.01');
  assert.deepEqual(codes(above), ['PRICE_ABOVE_PERCENT_BOUND']);
  assert.equal(above.failures[0].limit, '120');
  assert.equal(above.failures[0].observed, '120.01');

  const below = percentAdmission('BUY', '79.99');
  assert.deepEqual(codes(below), ['PRICE_BELOW_PERCENT_BOUND']);
  assert.equal(below.failures[0].limit, '80');

  // The same prices are admissible on the ask side and not on the bid side.
  assert.equal(percentAdmission('SELL', '120.01').ok, true);
  assert.equal(percentAdmission('SELL', '79.99').ok, true);
  assert.equal(percentAdmission('SELL', '150.01').ok, false);
  assert.equal(percentAdmission('BUY', '150').ok, false);
});
check('PERCENT_PRICE_BY_SIDE never substitutes a caller-supplied price', () => {
  const missing = validateBinanceSpotOrderFilters(
    {
      type: 'LIMIT',
      side: 'BUY',
      quantity: '1',
      price: '120',
    },
    [...supportedFilters(), percentPriceBySide()],
  );
  assert.deepEqual(codes(missing), ['MISSING_PERCENT_PRICE_REFERENCE']);

  const vwapFallback = percentAdmission(
    'BUY',
    '120',
    fallbackEvidence([vwapFallbackPrice()]),
  );
  assert.equal(vwapFallback.ok, true);

  // Only the filter's own window answers it; a nearby window is not evidence.
  const wrongWindow = percentAdmission(
    'BUY',
    '120',
    fallbackEvidence([vwapFallbackPrice('100', 1)]),
  );
  assert.deepEqual(codes(wrongWindow), ['MISSING_PERCENT_PRICE_REFERENCE']);

  const lastFallback = validateBinanceSpotOrderFilters(
    sideOrder('BUY', '120'),
    [
      ...supportedFilters(),
      percentPriceBySide({ avgPriceMins: 0 }),
    ],
    fallbackEvidence([lastFallbackPrice()], {
      referencePrice: referencePriceNeverSet(),
    }),
  );
  assert.equal(lastFallback.ok, true);

  // PERCENT_PRICE_BY_SIDE applies to order price, not stopPrice.
  const stop = validateBinanceSpotOrderFilters(
    {
      type: 'LIMIT',
      side: 'BUY',
      quantity: '1',
      price: '120',
      stopPrice: '120.01',
    },
    [...supportedFilters(), percentPriceBySide()],
    venueEvidence(),
  );
  assert.equal(stop.ok, true);
  assert.equal(
    stop.failures.some((failure) =>
      failure.code === 'PRICE_ABOVE_PERCENT_BOUND'),
    false,
  );
});
check('PERCENT_PRICE_BY_SIDE rejects zero, inverted, duplicate, and malformed rules', () => {
  for (const override of [
    { bidMultiplierDown: '0' },
    { askMultiplierUp: '0.00000000' },
    { bidMultiplierUp: '1.2', bidMultiplierDown: '1.5' },
    { askMultiplierUp: '1e2' },
    { avgPriceMins: '5' },
    { avgPriceMins: -1 },
  ]) {
    const result = validateBinanceSpotOrderFilters(
      sideOrder('BUY', '100'),
      [...supportedFilters(), percentPriceBySide(override)],
      venueEvidence(),
    );
    assert.equal(result.ok, false, JSON.stringify(override));
    assert.equal(
      codes(result).includes('MALFORMED_FILTER'),
      true,
      JSON.stringify(override),
    );
  }

  const duplicate = validateBinanceSpotOrderFilters(
    sideOrder('BUY', '100'),
    [...supportedFilters(), percentPriceBySide(), percentPriceBySide()],
    venueEvidence(),
  );
  assert.equal(codes(duplicate).includes('DUPLICATE_FILTER'), true);

  const badEvidence = validateBinanceSpotOrderFilters(
    sideOrder('BUY', '100'),
    [...supportedFilters(), percentPriceBySide()],
    venueEvidence({ referencePrice: referencePriceSet('0') }),
  );
  assert.equal(codes(badEvidence).includes('VENUE_EVIDENCE_INVALID'), true);

  for (const evidence of [
    // A live reference price and a fallback cannot both be in force.
    venueEvidence({ fallbackPrices: [vwapFallbackPrice()] }),
    // Two rows for one window leave no single answer for that window.
    fallbackEvidence([vwapFallbackPrice(), vwapFallbackPrice()]),
    // Present-but-unusable evidence is corruption, not documented disabling.
    venueEvidence({ referencePrice: { state: 'MAYBE', price: '100' } }),
    fallbackEvidence([{ ...vwapFallbackPrice(), windowMins: 0 }]),
  ]) {
    const ambiguousEvidence = validateBinanceSpotOrderFilters(
      sideOrder('BUY', '100'),
      [...supportedFilters(), percentPriceBySide()],
      evidence,
    );
    assert.equal(
      codes(ambiguousEvidence).includes('VENUE_EVIDENCE_INVALID'),
      true,
    );
  }
});
check('PRICE_RANGE is recognized as taker-execution-only compatibility state', () => {
  const buy = validateBinanceSpotOrderFilters(
    sideOrder('BUY', '130'),
    supportedFilters(),
    venueEvidence({ executionRules: [priceRangeRule()] }),
  );
  // PRICE_RANGE is enforced by Binance at taker execution, not order admission.
  assert.equal(buy.ok, true);
  assert.deepEqual(buy.priceRange, {
    rulePresent: true,
    side: 'BUY',
    limitMultiplierDown: '0.8',
    limitMultiplierUp: '1.2',
    referencePriceState: 'SET',
    enforcementPhase: 'TAKER_EXECUTION',
    outOfRangeOutcome: 'EXPIRED_EXECUTION_RULE_PRICE_RANGE_EXCEEDED',
    venueAcceptance: 'NOT_CLAIMED',
  });

  const sell = validateBinanceSpotOrderFilters(
    sideOrder('SELL', '130'),
    supportedFilters(),
    venueEvidence({ executionRules: [priceRangeRule()] }),
  );
  assert.equal(sell.priceRange.limitMultiplierDown, '0.5');
  assert.equal(sell.priceRange.limitMultiplierUp, '1.5');

  // A different validation-time reference never becomes an admitted bound.
  const moved = validateBinanceSpotOrderFilters(
    sideOrder('BUY', '120'),
    supportedFilters(),
    venueEvidence({
      referencePrice: referencePriceSet('200'),
      executionRules: [priceRangeRule()],
    }),
  );
  assert.equal(moved.ok, true);
  assert.deepEqual(codes(moved), []);
  assert.equal(moved.priceRange.limitMultiplierDown, '0.8');
  assert.equal(moved.priceRange.limitMultiplierUp, '1.2');
  assert.equal(moved.priceRange.enforcementPhase, 'TAKER_EXECUTION');
  assert.equal(moved.priceRange.venueAcceptance, 'NOT_CLAIMED');
});
check('PRICE_RANGE preserves absent rule, reference, and individual bound disabling', () => {
  // Unreadable evidence reports UNKNOWN; the venue's own answers report
  // themselves.
  for (const evidence of [
    null,
    fallbackEvidence([vwapFallbackPrice()]),
    fallbackEvidence([lastFallbackPrice()], {
      referencePrice: referencePriceNeverSet(),
    }),
    venueEvidence(),
  ]) {
    const absent = validateBinanceSpotOrderFilters(
      sideOrder('BUY', '100'),
      supportedFilters(),
      evidence,
    );
    assert.equal(absent.ok, true);
    assert.deepEqual(absent.priceRange, {
      rulePresent: false,
      side: 'BUY',
      limitMultiplierDown: null,
      limitMultiplierUp: null,
      referencePriceState:
        evidence === null ? 'UNKNOWN' : evidence.referencePrice.state,
      enforcementPhase: 'TAKER_EXECUTION',
      outOfRangeOutcome: 'EXPIRED_EXECUTION_RULE_PRICE_RANGE_EXCEEDED',
      venueAcceptance: 'NOT_CLAIMED',
    });
  }

  const unreferenced = validateBinanceSpotOrderFilters(
    sideOrder('BUY', '100'),
    supportedFilters(),
    fallbackEvidence([vwapFallbackPrice()], {
      executionRules: [priceRangeRule()],
    }),
  );
  assert.equal(unreferenced.ok, true);
  assert.equal(unreferenced.priceRange.rulePresent, true);
  assert.equal(unreferenced.priceRange.referencePriceState, 'NULL');

  const upperOnlyRule = priceRangeRule();
  delete upperOnlyRule.bidLimitMultDown;
  delete upperOnlyRule.askLimitMultDown;
  const upperOnly = validateBinanceSpotOrderFilters(
    sideOrder('BUY', '10'),
    supportedFilters(),
    venueEvidence({ executionRules: [upperOnlyRule] }),
  );
  assert.equal(upperOnly.ok, true);
  assert.equal(upperOnly.priceRange.limitMultiplierDown, null);
  assert.equal(upperOnly.priceRange.limitMultiplierUp, '1.2');

  const bothBoundsAbsent = validateBinanceSpotOrderFilters(
    sideOrder('BUY', '1000'),
    supportedFilters(),
    venueEvidence({
      executionRules: [{
        ruleType: 'PRICE_RANGE',
        askLimitMultUp: '1.5',
      }],
    }),
  );
  assert.equal(bothBoundsAbsent.ok, true);
  assert.equal(bothBoundsAbsent.priceRange.limitMultiplierDown, null);
  assert.equal(bothBoundsAbsent.priceRange.limitMultiplierUp, null);
});
check('PRICE_RANGE fails closed on unknown rule types and corrupt bounds', () => {
  for (const ruleType of ['PERCENT', 'ABSOLUTE', 'FUTURE_RULE', '', 7, null]) {
    const unknown = validateBinanceSpotOrderFilters(
      sideOrder('BUY', '100'),
      supportedFilters(),
      venueEvidence({
        executionRules: [{ ...priceRangeRule(), ruleType }],
      }),
    );
    assert.equal(unknown.ok, false, String(ruleType));
    assert.deepEqual(codes(unknown), ['PRICE_RANGE_RULE_UNSUPPORTED']);
    assert.equal(unknown.priceRange.rulePresent, false);
  }

  for (const override of [
    { bidLimitMultUp: '0' },
    { bidLimitMultUp: '1.2', bidLimitMultDown: '1.5' },
    { bidLimitMultUp: null },
  ]) {
    const corrupt = validateBinanceSpotOrderFilters(
      sideOrder('BUY', '100'),
      supportedFilters(),
      venueEvidence({ executionRules: [priceRangeRule(override)] }),
    );
    assert.equal(corrupt.ok, false, JSON.stringify(override));
    assert.equal(
      codes(corrupt).includes('PRICE_RANGE_EVIDENCE_INVALID'),
      true,
      JSON.stringify(override),
    );
  }

  for (const rule of ['PRICE_RANGE', 7, []]) {
    const shape = validateBinanceSpotOrderFilters(
      sideOrder('BUY', '100'),
      supportedFilters(),
      venueEvidence({ executionRules: [rule] }),
    );
    assert.equal(shape.ok, false, JSON.stringify(rule));
    assert.deepEqual(codes(shape), ['PRICE_RANGE_EVIDENCE_INVALID']);
  }

  for (const price of ['0', '1e2']) {
    const corruptReference = validateBinanceSpotOrderFilters(
      sideOrder('BUY', '100'),
      supportedFilters(),
      venueEvidence({
        referencePrice: referencePriceSet(price),
        executionRules: [priceRangeRule()],
      }),
    );
    assert.equal(corruptReference.ok, false, price);
    assert.equal(
      codes(corruptReference).includes('VENUE_EVIDENCE_INVALID'),
      true,
    );
    // A reference this validation cannot read is UNKNOWN, never a venue answer.
    assert.equal(corruptReference.priceRange.referencePriceState, 'UNKNOWN');
  }

  const duplicate = validateBinanceSpotOrderFilters(
    sideOrder('BUY', '100'),
    supportedFilters(),
    venueEvidence({
      executionRules: [priceRangeRule(), priceRangeRule()],
    }),
  );
  assert.equal(codes(duplicate).includes('PRICE_RANGE_RULE_DUPLICATE'), true);
});
check('dynamic price bounds retain decimal precision beyond binary64', () => {
  const exactUpper = '100.00000000000000001';
  const preciseFilter = percentPriceBySide({
    bidMultiplierUp: '1.0000000000000000001',
  });
  const exact = validateBinanceSpotOrderFilters(
    sideOrder('BUY', exactUpper),
    [
      ...supportedFilters({ filterType: 'PRICE_FILTER', tickSize: '0' }),
      preciseFilter,
    ],
    venueEvidence(),
  );
  assert.equal(exact.ok, true);

  const above = validateBinanceSpotOrderFilters(
    sideOrder('BUY', '100.000000000000000011'),
    [
      ...supportedFilters({ filterType: 'PRICE_FILTER', tickSize: '0' }),
      preciseFilter,
    ],
    venueEvidence(),
  );
  assert.equal(codes(above).includes('PRICE_ABOVE_PERCENT_BOUND'), true);

  const range = validateBinanceSpotOrderFilters(
    sideOrder('BUY', '100'),
    supportedFilters(),
    venueEvidence({
      executionRules: [
        priceRangeRule({ bidLimitMultUp: '1.0000000000000000001' }),
      ],
    }),
  );
  assert.equal(
    range.priceRange.limitMultiplierUp,
    '1.0000000000000000001',
  );
});

console.log('\nHard Spot risk policy');
check('FLATTEN stays unproven and receives no purpose-based relaxation', () => {
  const flatten = createSpotExecutionTicket(
    ticketInput({
      type: 'MARKET',
      timeInForce: null,
      price: null,
      purpose: 'FLATTEN',
    }),
  );
  assert.equal(flatten.riskEffect, 'UNPROVEN_RISK_REDUCTION');

  const clear = evaluateSpotRiskPolicy(riskInput({ subject: flatten }));
  assert.equal(clear.allowed, false);
  assert.equal(
    clear.checks.find(
      (check) => check.code === 'RISK_CLASSIFICATION_PROVEN',
    )?.status,
    'UNKNOWN',
  );
  assert.equal(clear.blockingCodes.includes('ORDER_NOTIONAL_MAX'), false);

  const killed = evaluateSpotRiskPolicy(
    riskInput({ subject: flatten, killSwitch: { engaged: true } }),
  );
  assert.equal(killed.blockingCodes.includes('RISK_CLASSIFICATION_PROVEN'), true);
  assert.equal(killed.blockingCodes.includes('KILL_SWITCH_CLEAR'), true);

  const {
    purpose: _purpose,
    riskEffect: _riskEffect,
    ...legacyUnclassified
  } = flatten;
  const unclassified = evaluateSpotRiskPolicy(
    riskInput({ subject: legacyUnclassified }),
  );
  assert.equal(
    unclassified.blockingCodes.includes('RISK_CLASSIFICATION_PROVEN'),
    true,
  );

  const reconciled = evaluateSpotRiskPolicy(
    riskInput({
      subject: {
        ...flatten,
        riskEffect: 'RECONCILED_RISK_REDUCTION',
        recovery: {
          attributableBaseQuantity: flatten.quantity,
          cumulativeFilledSellQuantity: '0',
          cumulativeAuthorizedLifecycleTurnoverQuote: '0',
          maximumAuthorizedLifecycleTurnoverQuote: '10',
        },
      },
    }),
  );
  assert.equal(reconciled.allowed, true);
  assert.equal(
    reconciled.checks.find(
      (check) => check.code === 'RISK_CLASSIFICATION_PROVEN',
    )?.status,
    'PASS',
  );

  const mismatchedEntry = evaluateSpotRiskPolicy(
    riskInput({
      subject: {
        ...flatten,
        purpose: 'ENTRY',
        riskEffect: 'RECONCILED_RISK_REDUCTION',
      },
    }),
  );
  assert.equal(
    mismatchedEntry.blockingCodes.includes('RISK_CLASSIFICATION_PROVEN'),
    true,
  );
});
check('allows exact-boundary notional, max-loss, and projected daily loss', () => {
  const ticket = createSpotExecutionTicket(
    ticketInput({
      quantity: '0.1',
      riskReferencePrice: '100',
      estimatedMaxLossQuote: '20',
    }),
  );
  const verdict = evaluateSpotRiskPolicy(
    riskInput({
      subject: ticket,
      realizedDailyLossQuote: '80',
    }),
  );
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.orderNotionalQuote, '10');
  assert.equal(verdict.projectedDailyLossQuote, '100');
  assert.deepEqual(verdict.blockingCodes, []);
});
check('LIMIT policy notional uses the order price, not a lower risk reference', () => {
  const ticket = createSpotExecutionTicket(
    ticketInput({
      quantity: '0.1001',
      price: '100',
      riskReferencePrice: '1',
    }),
  );
  const verdict = evaluateSpotRiskPolicy(riskInput({ subject: ticket }));
  assert.equal(verdict.orderNotionalQuote, '10.01');
  assert.equal(verdict.blockingCodes.includes('ORDER_NOTIONAL_MAX'), true);
});
check('owner ceiling equality is valid and any higher config fails closed', () => {
  assert.equal(
    createSpotRiskPolicy({
      minOrderNotionalQuote: '1',
      maxOrderNotionalQuote: '10.000',
      maxLossPerOrderQuote: '5',
      maxDailyLossQuote: '100',
    }).maxOrderNotionalQuote,
    '10',
  );
  const aboveOwner = evaluateSpotRiskPolicy(
    riskInput({
      policy: {
        minOrderNotionalQuote: '1',
        maxOrderNotionalQuote: '10.0000000000000000001',
        maxLossPerOrderQuote: '5',
        maxDailyLossQuote: '100',
      },
    }),
  );
  assert.equal(aboveOwner.allowed, false);
  assert.deepEqual(aboveOwner.blockingCodes, ['POLICY_VALID']);
});
check('blocks minimum and maximum notional violations', () => {
  const below = evaluateSpotRiskPolicy(
    riskInput({
      subject: createSpotExecutionTicket(
        ticketInput({ quantity: '0.099', riskReferencePrice: '100' }),
      ),
    }),
  );
  assert.equal(below.blockingCodes.includes('ORDER_NOTIONAL_MIN'), true);
  const above = evaluateSpotRiskPolicy(
    riskInput({
      subject: createSpotExecutionTicket(
        ticketInput({ quantity: '0.1001', riskReferencePrice: '100' }),
      ),
    }),
  );
  assert.equal(above.blockingCodes.includes('ORDER_NOTIONAL_MAX'), true);
});
check('blocks per-order max loss and projected daily loss independently', () => {
  const ticket = createSpotExecutionTicket(
    ticketInput({ estimatedMaxLossQuote: '20.01' }),
  );
  const perOrder = evaluateSpotRiskPolicy(riskInput({ subject: ticket }));
  assert.equal(perOrder.blockingCodes.includes('ORDER_MAX_LOSS'), true);

  const daily = evaluateSpotRiskPolicy(
    riskInput({ realizedDailyLossQuote: '95.01' }),
  );
  assert.equal(daily.blockingCodes.includes('PROJECTED_DAILY_LOSS'), true);
});
check('engaged or unknown kill switch blocks', () => {
  const engaged = evaluateSpotRiskPolicy(
    riskInput({ killSwitch: { engaged: true } }),
  );
  assert.equal(engaged.blockingCodes.includes('KILL_SWITCH_CLEAR'), true);
  const unknown = evaluateSpotRiskPolicy(riskInput({ killSwitch: null }));
  assert.equal(unknown.blockingCodes.includes('KILL_SWITCH_CLEAR'), true);
  assert.equal(
    unknown.checks.find((check) => check.code === 'KILL_SWITCH_CLEAR')?.status,
    'UNKNOWN',
  );
});
check('expiry equality blocks and missing daily-loss evidence is UNKNOWN', () => {
  const ticket = createSpotExecutionTicket(ticketInput());
  const expired = evaluateSpotRiskPolicy(
    riskInput({ nowMs: ticket.expiresAtMs, subject: ticket }),
  );
  assert.equal(expired.blockingCodes.includes('TICKET_UNEXPIRED'), true);
  const unknown = evaluateSpotRiskPolicy(
    riskInput({ realizedDailyLossQuote: null }),
  );
  assert.equal(
    unknown.checks.find((check) => check.code === 'PROJECTED_DAILY_LOSS')
      ?.status,
    'UNKNOWN',
  );
});
check('invalid policy fails closed and assertion helper carries verdict', () => {
  const invalid = evaluateSpotRiskPolicy(
    riskInput({
      policy: {
        minOrderNotionalQuote: '100',
        maxOrderNotionalQuote: '10',
        maxLossPerOrderQuote: '20',
        maxDailyLossQuote: '100',
      },
    }),
  );
  assert.equal(invalid.allowed, false);
  assert.deepEqual(invalid.blockingCodes, ['POLICY_VALID']);
  assert.throws(
    () => assertSpotRiskAllowed(riskInput({ killSwitch: { engaged: true } })),
    SpotRiskRejectedError,
  );
});

console.log('\nFOK recovery derivation');
check('derives a fresh LIMIT FOK leg from exact fills and base commissions', () => {
  const sourceTicket = createSpotExecutionTicket(ticketInput({
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'FOK',
    quantity: '0.05',
    price: '100',
    riskReferencePrice: '100',
    purpose: 'ENTRY',
    estimatedMaxLossQuote: '5',
  }));
  const sourceFills = [Object.freeze({
    fillId: 'source-fill-fok-1',
    venueOrderId: 'source-order-fok-1',
    price: '100',
    quantity: '0.05',
    quoteQuantity: '5',
    commission: '0.0005',
    commissionAsset: 'BTC',
    occurredAtMs: NOW + 1,
  })];
  const derive = (overrides = {}) => deriveFlattenLeg({
    sourceTicket,
    sourceVenueOrderId: 'source-order-fok-1',
    sourceFills,
    previousFlattenAttempts: [],
    baseAsset: 'BTC',
    exchangeBaseTolerance: '0.0006',
    maximumResidualDustNotionalQuote: '0.05',
    maximumGrossLifecycleTurnoverQuote: '10',
    totalFeeReserveQuote: '0.02',
    quantityStepSize: '0.001',
    attempt: 1,
    price: '100',
    riskReferencePrice: '100',
    estimatedMaxLossQuote: '5',
    createdAtMs: NOW + 1,
    expiresAtMs: NOW + 4_000,
    ...overrides,
  });
  const first = derive();
  assert.equal(first.attributableBaseQuantity, '0.0495');
  assert.equal(first.sellQuantity, '0.049');
  assert.equal(first.roundingRemainderBaseQuantity, '0.0005');
  assert.equal(first.residualDustNotionalQuote, '0.05');
  assert.equal(first.ticket?.type, 'LIMIT');
  assert.equal(first.ticket?.timeInForce, 'FOK');
  assert.equal(first.ticket?.attempt, 1);

  const priorTicket = first.ticket;
  assert.ok(priorTicket);
  const second = derive({
    previousFlattenAttempts: [{
      ticket: priorTicket,
      venueOrderId: 'flatten-order-fok-1',
      authoritativelyAbsent: false,
      fills: [{
        fillId: 'flatten-fill-fok-1',
        venueOrderId: 'flatten-order-fok-1',
        price: '100',
        quantity: '0.02',
        quoteQuantity: '2',
        commission: '0.0001',
        commissionAsset: 'BTC',
        occurredAtMs: NOW + 2,
      }],
    }],
    attempt: 2,
  });
  assert.equal(second.cumulativeFilledSellQuantity, '0.02');
  assert.equal(second.flattenBaseCommissionQuantity, '0.0001');
  assert.equal(second.remainingAttributableBaseQuantity, '0.0294');
  assert.equal(second.sellQuantity, '0.029');
  assert.equal(second.ticket?.attempt, 2);
  assert.notEqual(second.ticket?.clientOrderId, priorTicket.clientOrderId);

  assert.throws(
    () => derive({ exchangeBaseTolerance: '0.001' }),
    /unsafe/u,
  );
  assert.throws(
    () => derive({ maximumResidualDustNotionalQuote: '0.051' }),
    /unsafe/u,
  );
  assert.throws(
    () => derive({ estimatedMaxLossQuote: '6' }),
    /loss authority/u,
  );
  assert.throws(
    () => derive({ attempt: 4 }),
    /attempt binding/u,
  );
  assert.throws(
    () => derive({ maximumGrossLifecycleTurnoverQuote: '4.99' }),
    /turnover exceeds/u,
  );
  assert.throws(
    () => derive({
      previousFlattenAttempts: [{
        ticket: priorTicket,
        venueOrderId: 'flatten-order-over-sell',
        authoritativelyAbsent: false,
        fills: [{
          fillId: 'flatten-fill-over-sell',
          venueOrderId: 'flatten-order-over-sell',
          price: '100',
          quantity: '0.05',
          quoteQuantity: '5',
          commission: '0',
          commissionAsset: 'USDT',
          occurredAtMs: NOW + 2,
        }],
      }],
      attempt: 2,
    }),
    /ticket quantity|canary-attributable/u,
  );
});

check('fee reserve is inside the loss ceiling and favorable execution never spends authorized turnover', () => {
  const sourceTicket = createSpotExecutionTicket(ticketInput({
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'FOK',
    quantity: '0.05',
    price: '100',
    riskReferencePrice: '100',
    purpose: 'ENTRY',
    estimatedMaxLossQuote: '0.52',
  }));
  const sourceFills = [Object.freeze({
    fillId: 'source-fill-accounting-1',
    venueOrderId: 'source-order-accounting-1',
    price: '100',
    quantity: '0.05',
    quoteQuantity: '5',
    commission: '0',
    commissionAsset: 'USDT',
    occurredAtMs: NOW + 1,
  })];
  const derive = (overrides = {}) => deriveFlattenLeg({
    sourceTicket,
    sourceVenueOrderId: 'source-order-accounting-1',
    sourceFills,
    previousFlattenAttempts: [],
    baseAsset: 'BTC',
    exchangeBaseTolerance: '0.0001',
    maximumResidualDustNotionalQuote: '0.01',
    maximumGrossLifecycleTurnoverQuote: '10',
    totalFeeReserveQuote: '0.02',
    quantityStepSize: '0.001',
    attempt: 1,
    price: '90',
    riskReferencePrice: '100',
    estimatedMaxLossQuote: '0.52',
    createdAtMs: NOW + 1,
    expiresAtMs: NOW + 4_000,
    ...overrides,
  });

  const adverse = derive();
  assert.equal(adverse.projectedLifecycleQuoteShortfall, '0.5');
  assert.equal(adverse.totalFeeReserveQuote, '0.02');
  assert.equal(adverse.projectedLifecycleLossWithFeeReserveQuote, '0.52');
  assert.throws(
    () => derive({ totalFeeReserveQuote: '0.03' }),
    /loss ceiling/u,
  );

  const first = derive({
    price: '100',
    riskReferencePrice: '100',
  });
  assert.ok(first.ticket);
  const favorable = derive({
    previousFlattenAttempts: [Object.freeze({
      ticket: first.ticket,
      venueOrderId: 'flatten-order-accounting-1',
      authoritativelyAbsent: false,
      fills: [Object.freeze({
        fillId: 'flatten-fill-accounting-1',
        venueOrderId: 'flatten-order-accounting-1',
        price: '110',
        quantity: '0.02',
        quoteQuantity: '2.2',
        commission: '0',
        commissionAsset: 'USDT',
        occurredAtMs: NOW + 2,
      })],
    })],
    attempt: 2,
    price: '100',
    riskReferencePrice: '100',
  });
  assert.equal(favorable.flattenGrossTurnoverQuote, '2.2');
  assert.equal(favorable.observedGrossLifecycleTurnoverQuote, '7.2');
  assert.equal(favorable.authorizedFlattenTurnoverQuote, '2');
  assert.equal(favorable.authorizedFilledLifecycleTurnoverQuote, '7');
  assert.equal(favorable.projectedAuthorizedLifecycleTurnoverQuote, '10');
  assert.equal(favorable.favorableSellPriceImprovementQuote, '0.2');
  assert.equal(favorable.ticket?.quantity, '0.03');
});

console.log(`\nPASS ${assertions} focused Slice-A checks`);

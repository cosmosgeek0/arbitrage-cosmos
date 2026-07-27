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
    { type: 'LIMIT', quantity: '100', price: '0.001' },
    supportedFilters(),
  );
  assert.equal(codes(below).includes('PRICE_BELOW_MIN'), true);
});
check('honors disabled PRICE_FILTER rules represented by zero', () => {
  const result = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', quantity: '0.1', price: '100.001' },
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
    { type: 'LIMIT', quantity: '0.10005', price: '100' },
    supportedFilters(),
  );
  assert.equal(codes(lot).includes('QUANTITY_STEP_MISMATCH'), true);
  const marketLot = validateBinanceSpotOrderFilters(
    {
      type: 'MARKET',
      quantity: '0.0005',
      price: null,
      marketReferencePrice: '20000',
    },
    supportedFilters(),
  );
  assert.equal(codes(marketLot).includes('QUANTITY_BELOW_MIN'), true);
});
check('enforces MIN_NOTIONAL and NOTIONAL lower/upper limits', () => {
  const low = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', quantity: '0.09', price: '100' },
    supportedFilters(),
  );
  assert.equal(codes(low).includes('NOTIONAL_BELOW_MIN'), true);
  const high = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', quantity: '10.0001', price: '100' },
    supportedFilters(),
  );
  assert.equal(codes(high).includes('NOTIONAL_ABOVE_MAX'), true);
});
check('MARKET notional is fail-closed without its injected reference price', () => {
  const missing = validateBinanceSpotOrderFilters(
    { type: 'MARKET', quantity: '0.1', price: null },
    supportedFilters(),
  );
  assert.equal(
    codes(missing).includes('MISSING_MARKET_REFERENCE_PRICE'),
    true,
  );
  const valid = validateBinanceSpotOrderFilters(
    {
      type: 'MARKET',
      quantity: '0.1',
      price: null,
      marketReferencePrice: '100',
    },
    supportedFilters(),
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.notional, '10');
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
    { type: 'MARKET', quantity: '0.1', price: null },
    filters,
  );
  assert.equal(result.ok, true);
  assert.equal(result.notional, null);
});
check('missing, duplicate, and malformed safety filters reject', () => {
  const missing = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', quantity: '0.1', price: '100' },
    supportedFilters().filter((filter) => filter.filterType !== 'LOT_SIZE'),
  );
  assert.equal(codes(missing).includes('MISSING_LOT_SIZE_FILTER'), true);

  const duplicateFilters = supportedFilters();
  duplicateFilters.push({ ...duplicateFilters[0] });
  const duplicate = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', quantity: '0.1', price: '100' },
    duplicateFilters,
  );
  assert.equal(codes(duplicate).includes('DUPLICATE_FILTER'), true);

  const malformed = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', quantity: '0.1', price: '100' },
    supportedFilters({ filterType: 'PRICE_FILTER', tickSize: '1e-2' }),
  );
  assert.equal(codes(malformed).includes('MALFORMED_FILTER'), true);

  const disabled = validateBinanceSpotOrderFilters(
    { type: 'LIMIT', quantity: '0.1', price: '100' },
    supportedFilters({ filterType: 'LOT_SIZE', stepSize: '0' }),
  );
  assert.equal(codes(disabled).includes('MALFORMED_FILTER'), true);
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

console.log(`\nPASS ${assertions} focused Slice-A checks`);

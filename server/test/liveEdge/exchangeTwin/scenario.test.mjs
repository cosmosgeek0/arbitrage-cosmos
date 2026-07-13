import assert from 'node:assert/strict';
import test from 'node:test';

import { runExchangeTwinScenario } from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  baselineEvents,
  event,
  orderByFixtureId,
  orderFixture,
  scenarioInput,
} from './fixtures.mjs';

test('BUY consumes exact eligible asks across levels with exact notional, fee and VWAP', () => {
  const result = runExchangeTwinScenario(scenarioInput());
  const order = orderByFixtureId(result);

  assert.equal(order.venueStatus, 'FILLED');
  assert.equal(order.filledQuantity, '0.03');
  assert.equal(order.remainingQuantity, '0');
  assert.equal(order.expiredQuantity, '0');
  assert.deepEqual(
    order.fills.map(({ price, quantity, quoteNotional }) => ({ price, quantity, quoteNotional })),
    [
      { price: '100', quantity: '0.01', quoteNotional: '1' },
      { price: '101', quantity: '0.02', quoteNotional: '2.02' },
    ],
  );
  assert.deepEqual(order.vwap, {
    numeratorQuoteNotional: '3.02',
    denominatorBaseQuantity: '0.03',
    decimalScale24: '100.666666666666666666666666',
    decimalPolicy: 'TRUNCATED_SCALE_24',
  });
  assert.equal(order.spreadDepthImpactQuote, '0.02');
  assert.equal(order.latencyMovementQuote, null);
  assert.equal(order.adverseSelectionQuote, null);
  assert.equal(order.fills[0].liquidityRole, 'TAKER');
  assert.equal(order.fills[0].feeAmount, '0.001');
  assert.equal(order.fills[0].feeAsset, 'USDT');
  assert.equal(order.fills[0].quoteEquivalentFee, '0.001');
});

test('SELL consumes side-correct bids from highest price down and never crosses its limit', () => {
  const fixture = orderFixture({ side: 'SELL', price: '100', quantity: '0.03' });
  const events = baselineEvents(fixture, {
    bids: [
      { price: '102', quantity: '0.01' },
      { price: '101', quantity: '0.02' },
      { price: '99', quantity: '0.09' },
    ],
    asks: [{ price: '103', quantity: '0.1' }],
  });
  const order = orderByFixtureId(runExchangeTwinScenario(scenarioInput({ fixture, events })));

  assert.equal(order.venueStatus, 'FILLED');
  assert.deepEqual(
    order.fills.map(({ price, quantity }) => ({ price, quantity })),
    [{ price: '102', quantity: '0.01' }, { price: '101', quantity: '0.02' }],
  );
  assert.ok(order.fills.every((fill) => Number(fill.price) >= 100));
});

test('FOK is atomic: insufficient depth expires without a fill and sufficient depth fills fully', () => {
  const fixture = orderFixture({ timeInForce: 'FOK', price: '100', quantity: '0.02' });
  const insufficientEvents = baselineEvents(fixture, {
    asks: [{ price: '100', quantity: '0.01' }],
  });
  const insufficient = orderByFixtureId(runExchangeTwinScenario(
    scenarioInput({ fixture, events: insufficientEvents }),
  ));
  assert.equal(insufficient.venueStatus, 'EXPIRED');
  assert.equal(insufficient.filledQuantity, '0');
  assert.equal(insufficient.expiredQuantity, '0.02');
  assert.deepEqual(insufficient.fills, []);

  const sufficientEvents = baselineEvents(fixture, {
    asks: [{ price: '100', quantity: '0.02' }],
  });
  const sufficient = orderByFixtureId(runExchangeTwinScenario(
    scenarioInput({ fixture, events: sufficientEvents }),
  ));
  assert.equal(sufficient.venueStatus, 'FILLED');
  assert.equal(sufficient.filledQuantity, '0.02');
  assert.equal(sufficient.expiredQuantity, '0');
});

test('IOC expires its exact unfilled remainder while GTC rests it', () => {
  for (const [timeInForce, expectedStatus, expectedExpired, expectedRemaining] of [
    ['IOC', 'EXPIRED', '0.02', '0'],
    ['GTC', 'PARTIALLY_FILLED', '0', '0.02'],
  ]) {
    const fixture = orderFixture({ timeInForce, price: '100', quantity: '0.03' });
    const events = baselineEvents(fixture, { asks: [{ price: '100', quantity: '0.01' }] });
    const order = orderByFixtureId(runExchangeTwinScenario(scenarioInput({ fixture, events })));
    assert.equal(order.venueStatus, expectedStatus, timeInForce);
    assert.equal(order.filledQuantity, '0.01', timeInForce);
    assert.equal(order.expiredQuantity, expectedExpired, timeInForce);
    assert.equal(order.remainingQuantity, expectedRemaining, timeInForce);
  }
});

test('MARKET consumes only explicit depth and expires when depth is insufficient', () => {
  const fixture = orderFixture({
    orderType: 'MARKET',
    timeInForce: null,
    price: null,
    quantity: '0.04',
  });
  const events = baselineEvents(fixture, {
    asks: [{ price: '100', quantity: '0.01' }, { price: '101', quantity: '0.02' }],
  });
  const order = orderByFixtureId(runExchangeTwinScenario(scenarioInput({ fixture, events })));

  assert.equal(order.venueStatus, 'EXPIRED');
  assert.equal(order.filledQuantity, '0.03');
  assert.equal(order.expiredQuantity, '0.01');
  assert.equal(order.remainingQuantity, '0');
  assert.deepEqual(order.fills.map((fill) => fill.quantity), ['0.01', '0.02']);
});

test('canonical event ordering is permutation-stable and outputs are deeply frozen', () => {
  const fixture = orderFixture();
  const events = baselineEvents(fixture);
  const forward = runExchangeTwinScenario(scenarioInput({ fixture, events }));
  const reverse = runExchangeTwinScenario(scenarioInput({ fixture, events: [...events].reverse() }));

  assert.deepEqual(reverse, forward);
  assert.equal(reverse.stateRevision, forward.stateRevision);
  assert.equal(reverse.outcomeRevision, forward.outcomeRevision);
  assert.ok(Object.isFrozen(forward));
  assert.ok(Object.isFrozen(forward.orders));
  assert.ok(Object.isFrozen(forward.orders[0]));
  assert.ok(Object.isFrozen(forward.orders[0].fills));
  assert.throws(() => { forward.orders[0].fills.push({}); }, TypeError);
  assert.equal(forward.simulationAuthority, 'SYNTHETIC_FIXTURE');
  assert.equal(forward.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(forward.externalActionAuthorization, 'NONE');
});

test('equal-time evidence without source ordering remains explicitly AMBIGUOUS', () => {
  const fixture = orderFixture();
  const trading = event('SYMBOL_STATUS', 1, 2_100_000_000_000, {
    product: fixture.product,
    symbol: fixture.symbol,
    status: 'TRADING',
    evidenceRevision: `symbol-status:${'1'.repeat(24)}`,
    observedAtMs: 2_100_000_000_000,
    validUntilMs: 2_100_000_010_000,
  });
  const halt = event('SYMBOL_STATUS', 2, 2_100_000_000_000, {
    product: fixture.product,
    symbol: fixture.symbol,
    status: 'HALT',
    evidenceRevision: `symbol-status:${'2'.repeat(24)}`,
    observedAtMs: 2_100_000_000_000,
    validUntilMs: 2_100_000_010_000,
  });
  const forward = runExchangeTwinScenario(scenarioInput({ fixture, events: [trading, halt] }));
  const reverse = runExchangeTwinScenario(scenarioInput({ fixture, events: [halt, trading] }));
  assert.equal(forward.orderingTruth, 'AMBIGUOUS');
  assert.deepEqual(reverse, forward);
});

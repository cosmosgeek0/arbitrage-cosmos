#!/usr/bin/env node
/**
 * Focused financial-safety regressions. Zero network and isolated in-memory
 * collaborators; run after the server build:
 *   node server/test/financial-safety.mjs
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BinanceApiError } from '../dist/binance/client.js';
import { MAX_UTC_MS } from '../dist/foundation/contracts/time.js';
import { Ledger } from '../dist/ledger.js';
import { AccountService } from '../dist/services/account.js';
import { OrderService } from '../dist/services/orders.js';
import { RiskService } from '../dist/services/risk.js';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

class FakeLedger extends EventEmitter {
  events = [];
  fills = [];
  config = new Map();

  logEvent(kind, symbol = null, data = null) {
    const event = { id: this.events.length + 1, ts: Date.now(), kind, symbol, data };
    this.events.push(event);
    this.emit('event', event);
    return event;
  }

  logEventsAtomically(records) {
    return records.map((record) => this.logEvent(record.kind, record.symbol ?? null, record.data));
  }

  eventsSince(ts, kind) {
    return this.events.filter((event) => event.ts >= ts && event.kind === kind);
  }

  lastEvent(kind) {
    return [...this.events].reverse().find((event) => event.kind === kind) ?? null;
  }

  firstEventSince(ts, kind) {
    return this.events.find((event) => event.ts >= ts && event.kind === kind) ?? null;
  }

  unresolvedOrderRequestsBefore(ts) {
    const responses = new Set(this.events
      .filter((event) => event.kind === 'order_response')
      .map((event) => event.data?.reservationId)
      .filter((id) => typeof id === 'string'));
    return this.events.filter((event) => (
      event.kind === 'order_request' &&
      event.ts < ts &&
      typeof event.data?.reservationId === 'string' &&
      !responses.has(event.data.reservationId)
    )).length;
  }

  insertFill(fill) {
    if (this.fills.some((row) => row.symbol === fill.symbol && row.tradeId === fill.tradeId)) return false;
    this.fills.push({ ...fill, moneyEncoding: 'EXACT_DECIMAL' });
    return true;
  }

  allFillsAsc() {
    return [...this.fills].sort((left, right) => (
      left.ts - right.ts
      || (left.symbol < right.symbol ? -1 : left.symbol > right.symbol ? 1 : 0)
      || left.tradeId - right.tradeId
    ));
  }

  distinctFillSymbolsBetween(startTs, endTs, limit = 501) {
    return [...new Set(this.fills
      .filter((fill) => fill.ts >= startTs && fill.ts < endTs)
      .map((fill) => fill.symbol))]
      .sort()
      .slice(0, limit);
  }

  getConfigValue(key) {
    return this.config.get(key) ?? null;
  }

  setConfigValue(key, value) {
    this.config.set(key, value);
  }
}

function config(overrides = {}) {
  return {
    killSwitch: false,
    fundsLocked: false,
    automationPaused: false,
    liveTradingEnabled: true,
    maxOrderNotionalUsd: 500,
    maxDailyNotionalUsd: 1_000,
    maxDailyLossUsd: 100,
    maxOpenOrders: 10,
    cooldownSec: 0,
    allowedSymbols: ['BTCUSDT'],
    blockedSymbols: [],
    ...overrides,
  };
}

const filters = new Map([
  ['BTCUSDT', { stepSize: 0.00001, minQty: 0.00001, tickSize: 0.01, minNotional: 5 }],
]);

const safeRestrictions = {
  ipRestrict: true,
  enableReading: true,
  enableWithdrawals: false,
  enableInternalTransfer: false,
  enableMargin: false,
  enableSpotAndMarginTrading: true,
  enableFutures: false,
  permitsUniversalTransfer: false,
};

function acceptedOrder(orderId, clientOrderId) {
  return {
    symbol: 'BTCUSDT',
    orderId,
    clientOrderId,
    transactTime: Date.now(),
    status: 'NEW',
    executedQty: '0',
    cummulativeQuoteQty: '0',
    fills: [],
  };
}

function accountStub(overrides = {}) {
  return {
    connected: true,
    lastSyncTs: Date.now(),
    keyRestrictions: { ...safeRestrictions },
    realizedTodayUsd: () => 0,
    dailyLossPolicy: () => ({ valueUsd: 0, complete: true, reasons: [] }),
    recordFill: () => undefined,
    registerFillSymbols: () => undefined,
    reconcileFills: async () => ({
      complete: false,
      scopeComplete: true,
      fresh: true,
      reconciledAt: Date.now(),
      dayStart: Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
      symbols: ['BTCUSDT'],
      coverageScope: 'configured_and_observed_symbols',
      accountWide: false,
      limitation: 'symbol-scoped',
      error: null,
    }),
    sync: async () => undefined,
    ...overrides,
  };
}

function orderService({ client, ledger = new FakeLedger(), cfg = config(), account = accountStub(), updatedAt } = {}) {
  const risk = new RiskService(cfg, ledger);
  const service = new OrderService(
    client,
    filters,
    () => 100,
    risk,
    ledger,
    account,
    updatedAt,
  );
  return { service, risk, ledger };
}

console.log('\nFinancial safety regressions:');

// The vulnerable implementation entered placeOrder twice before either order
// had committed its response/reservation.
{
  let placeCalls = 0;
  let activePlaces = 0;
  let maxActivePlaces = 0;
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const client = {
    openOrders: async () => [],
    placeOrder: async (params) => {
      placeCalls += 1;
      activePlaces += 1;
      maxActivePlaces = Math.max(maxActivePlaces, activePlaces);
      if (placeCalls === 1) await firstGate;
      activePlaces -= 1;
      return acceptedOrder(placeCalls, params.newClientOrderId);
    },
  };
  const { service } = orderService({ client });
  const intent = { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, source: 'manual' };
  const first = service.send(intent, 'BTCUSDT');
  const second = service.send(intent, 'BTCUSDT');
  await new Promise((resolve) => setImmediate(resolve));
  check('live sends serialize before the exchange commit', placeCalls === 1 && maxActivePlaces === 1);
  releaseFirst();
  const sent = await Promise.all([first, second]);
  check('serialized legitimate sends remain accepted', sent.every((row) => row.sent && row.outcome === 'accepted'));
}

// A failed authoritative open-order read used to be swallowed before risk.
{
  let placeCalls = 0;
  const client = {
    openOrders: async () => { throw new Error('sync offline'); },
    placeOrder: async (params) => { placeCalls += 1; return acceptedOrder(1, params.newClientOrderId); },
  };
  const { service } = orderService({ client });
  const result = await service.send(
    { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, source: 'manual' },
    'BTCUSDT',
  );
  check('open-order sync failure blocks the live send', !result.sent && result.outcome === 'not_sent' && placeCalls === 0);
}

// Base-quantity MARKET admission cannot bound the final quote spend.
{
  let placeCalls = 0;
  const client = {
    openOrders: async () => [],
    placeOrder: async (params) => { placeCalls += 1; return acceptedOrder(1, params.newClientOrderId); },
  };
  const { service } = orderService({ client });
  const result = await service.send(
    { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.1, source: 'manual' },
    'BTCUSDT',
  );
  check('live MARKET base quantity is rejected as unbounded', !result.sent && /require a quote amount/.test(result.error ?? '') && placeCalls === 0);

  const quoteBounded = await service.send(
    { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, source: 'manual' },
    'BTCUSDT',
  );
  check('quote-bounded MARKET control remains accepted', quoteBounded.sent === true && placeCalls === 1);
}

// Zero-executed accepted orders and unmatched reservations both consume the
// daily budget; the old nullish-coalescing logic counted the first as zero.
{
  const ledger = new FakeLedger();
  ledger.logEvent('order_response', 'BTCUSDT', { executedQuoteUsd: 0, estNotionalUsd: 60 });
  ledger.logEvent('order_request', 'BTCUSDT', { reservationId: 'pending-1', reservedNotionalUsd: 30 });
  ledger.logEvent('order_response', 'BTCUSDT', { reservationId: 'pending-1', executedQuoteUsd: 0, estNotionalUsd: 30 });
  const risk = new RiskService(config({ maxDailyNotionalUsd: 100 }), ledger);
  const decision = risk.evaluate(
    { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 20, source: 'manual' },
    { estNotionalUsd: 20, openOrdersCount: 0, pendingOpenOrdersNotionalUsd: 0, realizedTodayUsd: 0 },
    { forLiveSend: true },
  );
  check('unfilled and reserved notional count toward daily use', risk.dailyNotionalUsedUsd() === 90);
  check('conservative daily notional blocks over-commit', decision.checks.find((row) => row.name === 'max_daily_notional')?.pass === false);
}

// Open orders that predate this process still reserve remaining notional.
{
  let placeCalls = 0;
  const client = {
    openOrders: async () => [{
      symbol: 'BTCUSDT', orderId: 77, side: 'BUY', type: 'LIMIT', status: 'NEW',
      price: '100', origQty: '0.5', executedQty: '0', time: Date.now(),
    }],
    placeOrder: async (params) => { placeCalls += 1; return acceptedOrder(1, params.newClientOrderId); },
  };
  const { service } = orderService({ client, cfg: config({ maxDailyNotionalUsd: 55 }) });
  const result = await service.send(
    { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, source: 'manual' },
    'BTCUSDT',
  );
  check('remaining open-order notional blocks daily over-commit', !result.sent && placeCalls === 0 && result.risk?.checks.find((row) => row.name === 'max_daily_notional')?.pass === false);
}

// A transport failure after request dispatch cannot be represented as a clean
// rejection. It also leaves an unresolved ledger state that blocks a follow-up.
{
  let placeCalls = 0;
  const client = {
    openOrders: async () => [],
    placeOrder: async () => { placeCalls += 1; throw new Error('socket closed after write'); },
  };
  const { service } = orderService({ client });
  const intent = { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, source: 'manual' };
  const first = await service.send(intent, 'BTCUSDT');
  const second = await service.send(intent, 'BTCUSDT');
  check('ambiguous exchange outcome is explicitly unknown', !first.sent && first.outcome === 'unknown' && first.reconciliationRequired === true);
  check('unreconciled outcome blocks a follow-up live send', !second.sent && second.outcome === 'not_sent' && placeCalls === 1);
}

// Once the request reservation is durable, even a definitive Binance reject
// cannot be reported as not-sent unless its correlated response audit commits.
{
  const store = new FakeLedger();
  const originalLog = store.logEvent.bind(store);
  store.logEvent = (kind, symbol, data) => {
    if (kind === 'order_response') throw new Error('audit disk unavailable');
    return originalLog(kind, symbol, data);
  };
  const client = {
    openOrders: async () => [],
    placeOrder: async () => { throw new BinanceApiError(400, -1013, 'Filter failure'); },
    queryOrder: async () => { throw new BinanceApiError(400, -2013, 'Order does not exist'); },
  };
  const { service } = orderService({ client, ledger: store });
  const result = await service.send(
    { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, source: 'manual' },
    'BTCUSDT',
  );
  check('rejection audit failure remains explicitly unknown', !result.sent && result.outcome === 'unknown' && result.reconciliationRequired === true);
  check('failed rejection audit never manufactures a terminal response', store.events.some((event) => event.kind === 'order_request') && !store.events.some((event) => event.kind === 'order_response'));
}

// UTC rollover must not clear an unresolved exchange outcome.
{
  const ledger = new FakeLedger();
  const event = ledger.logEvent('order_request', 'BTCUSDT', {
    reservationId: 'prior-day-unknown',
    reservedNotionalUsd: 10,
  });
  event.ts = Date.now() - 25 * 60 * 60_000;
  const risk = new RiskService(config(), ledger);
  const decision = risk.evaluate(
    { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, source: 'manual' },
    { estNotionalUsd: 10, openOrdersCount: 0, pendingOpenOrdersNotionalUsd: 0, realizedTodayUsd: 0 },
    { forLiveSend: true },
  );
  check('prior-day unresolved order keeps admission fail-closed', decision.checks.find((row) => row.name === 'daily_notional_state_known')?.pass === false);
}

{
  const ledger = new FakeLedger();
  const client = {
    openOrders: async () => [],
    cancelOrder: async () => { throw new Error('socket closed after write'); },
  };
  const account = new AccountService({ myTrades: async () => [] }, ledger, () => 1);
  const { service } = orderService({ client, ledger, account });
  const result = await service.cancel('BTCUSDT', 9);
  const registry = JSON.parse(ledger.config.get('fill_reconcile:symbol_universe:v1'));
  check(
    'ambiguous cancel outcome requires reconciliation',
    !result.ok
      && result.outcome === 'unknown'
      && result.reconciliationRequired === true
      && registry.symbols.includes('BTCUSDT'),
  );
}

// Background account refresh errors are caught and ledgered, not leaked as an
// unhandled rejection after a successful order response.
{
  const ledger = new FakeLedger();
  const client = { openOrders: async () => [], placeOrder: async (params) => acceptedOrder(9, params.newClientOrderId) };
  const account = accountStub({ sync: async () => { throw new Error('account refresh failed'); } });
  const { service } = orderService({ client, ledger, account });
  const result = await service.send(
    { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, source: 'manual' },
    'BTCUSDT',
  );
  await new Promise((resolve) => setImmediate(resolve));
  check('accepted send survives contained background refresh failure', result.sent === true);
  check('background refresh failure remains observable', ledger.events.some((event) => event.kind === 'error_event' && event.data?.source === 'order.account_refresh'));
}

// Account PnL cache is invalidated at the service boundary used by imports.
{
  const ledger = new FakeLedger();
  const account = new AccountService(null, ledger, () => 300);
  const now = Date.now();
  account.recordFill({ symbol: 'BTCUSDT', tradeId: 1, orderId: 1, side: 'BUY', price: '100', qty: '1', quoteQty: '100', commission: '0', commissionAsset: 'USDT', ts: now - 1_000, source: 'test' });
  account.pnl();
  account.recordFill({ symbol: 'BTCUSDT', tradeId: 2, orderId: 2, side: 'SELL', price: '90', qty: '1', quoteQty: '90', commission: '1', commissionAsset: 'USDT', ts: now, source: 'import' });
  check('fill import invalidates an already-built PnL cache', account.realizedTodayUsd() === -10);
  const policy = account.dailyLossPolicy();
  check('daily-loss policy deducts valued fees', policy.complete && policy.valueUsd === -11);
}

// Exact quote truth and the total fill order must survive values that collapse
// to the same binary64 number. The higher-id SELL is inserted first on purpose.
{
  const ledger = new FakeLedger();
  const account = new AccountService(null, ledger, () => 1);
  const ts = Date.now();
  account.recordFill({
    symbol: 'BTCUSDT', tradeId: 2, orderId: 2, side: 'SELL',
    price: '9007199254740993.02', qty: '1', quoteQty: '9007199254740993.02',
    commission: '0', commissionAsset: 'USDT', ts, source: 'test',
  });
  account.recordFill({
    symbol: 'BTCUSDT', tradeId: 1, orderId: 1, side: 'BUY',
    price: '9007199254740993.01', qty: '1', quoteQty: '9007199254740993.01',
    commission: '0', commissionAsset: 'USDT', ts, source: 'test',
  });
  check(
    'equal-millisecond PnL replays by total order with exact decimal cancellation',
    account.realizedTodayUsd() === 0.01,
  );
}

// A migrated binary64 acquisition cannot prove later cost basis merely because
// the later SELL itself is exact. The taint persists until inventory resets or
// authoritative reconciliation upgrades that fill identity.
{
  const ledger = new FakeLedger();
  const ts = Date.now() - 1_000;
  ledger.fills.push({
    symbol: 'BTCUSDT', tradeId: 1, orderId: 1, side: 'BUY', price: '100', qty: '2',
    quoteQty: '200', commission: '0', commissionAsset: 'USDT', ts,
    source: 'legacy-v1', moneyEncoding: 'LEGACY_BINARY64',
  });
  ledger.fills.push({
    symbol: 'BTCUSDT', tradeId: 2, orderId: 2, side: 'SELL', price: '110', qty: '1',
    quoteQty: '110', commission: '0', commissionAsset: 'USDT', ts: ts + 1,
    source: 'rest_reconciliation', moneyEncoding: 'EXACT_DECIMAL',
  });
  const account = new AccountService(null, ledger, () => 110);
  const policy = account.dailyLossPolicy();
  check(
    'legacy binary64 cost basis taints downstream PnL until inventory truth resets',
    !policy.complete
      && policy.reasons.some((reason) => /legacy binary64 fill/.test(reason))
      && policy.reasons.some((reason) => /cost basis depends/.test(reason)),
  );
}

// Selling inventory with no ledgered acquisition basis must not be interpreted
// as zero PnL for policy admission.
{
  const ledger = new FakeLedger();
  const account = new AccountService(null, ledger, () => 100);
  account.recordFill({ symbol: 'BTCUSDT', tradeId: 3, orderId: 3, side: 'SELL', price: '100', qty: '1', quoteQty: '100', commission: '0', commissionAsset: 'USDT', ts: Date.now(), source: 'test' });
  const policy = account.dailyLossPolicy();
  check('unknown sell basis makes daily-loss policy incomplete', !policy.complete && policy.reasons.some((reason) => /cost basis unavailable/.test(reason)));
}

// Base-asset commission changes real inventory on both sides. Fee attribution
// remains separate, so inventory PnL plus the fee deduction conserves value.
{
  const firstLedger = new FakeLedger();
  const first = new AccountService(null, firstLedger, () => 110);
  const ts = Date.now();
  first.recordFill({
    symbol: 'BTCUSDT', tradeId: 1, orderId: 1, side: 'BUY', price: '100', qty: '1',
    quoteQty: '100', commission: '0.01', commissionAsset: 'BTC', ts, source: 'test',
  });
  first.recordFill({
    symbol: 'BTCUSDT', tradeId: 2, orderId: 2, side: 'SELL', price: '110', qty: '0.99',
    quoteQty: '108.9', commission: '0', commissionAsset: 'USDT', ts: ts + 1, source: 'test',
  });
  const firstPolicy = first.dailyLossPolicy();
  check(
    'BUY base commission removes acquired inventory without double-counting its fee',
    first.pnl().avgCost.get('BTC')?.qty === 0
      && firstPolicy.complete
      && firstPolicy.valueUsd === 8.9,
  );

  const secondLedger = new FakeLedger();
  const second = new AccountService(null, secondLedger, () => 110);
  second.recordFill({
    symbol: 'BTCUSDT', tradeId: 1, orderId: 1, side: 'BUY', price: '100', qty: '1.01',
    quoteQty: '101', commission: '0', commissionAsset: 'USDT', ts, source: 'test',
  });
  second.recordFill({
    symbol: 'BTCUSDT', tradeId: 2, orderId: 2, side: 'SELL', price: '110', qty: '1',
    quoteQty: '110', commission: '0.01', commissionAsset: 'BTC', ts: ts + 1, source: 'test',
  });
  const secondPolicy = second.dailyLossPolicy();
  check(
    'SELL base commission removes the extra disposed inventory without phantom quantity',
    second.pnl().avgCost.get('BTC')?.qty === 0
      && secondPolicy.complete
      && secondPolicy.valueUsd === 9,
  );
}

// Service boundaries reject non-finite internal values even if a caller skips
// the HTTP parser.
{
  const client = { openOrders: async () => [], placeOrder: async (params) => acceptedOrder(1, params.newClientOrderId) };
  const { service } = orderService({ client });
  const preview = service.preview({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: Number.NaN, source: 'manual' });
  check('non-finite internal order value fails validation', !preview.ok && preview.errors.some((error) => /finite/.test(error)));
}

// Live admission requires fresh, authoritative, non-transfer-capable API-key
// posture rather than trusting account-level flags.
{
  let placeCalls = 0;
  const client = {
    openOrders: async () => [],
    placeOrder: async (params) => { placeCalls += 1; return acceptedOrder(1, params.newClientOrderId); },
  };
  const unknown = accountStub({ connected: false, lastSyncTs: null, keyRestrictions: null });
  const { service: unknownService } = orderService({ client, account: unknown });
  const unknownResult = await unknownService.send(
    { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, source: 'manual' },
    'BTCUSDT',
  );
  check('unknown account/key posture blocks live admission', !unknownResult.sent && /account connection|permissions/.test(unknownResult.error ?? '') && placeCalls === 0);

  const unsafe = accountStub({ keyRestrictions: { ...safeRestrictions, enableWithdrawals: true } });
  const { service: unsafeService } = orderService({ client, account: unsafe });
  const unsafeResult = await unsafeService.send(
    { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, source: 'manual' },
    'BTCUSDT',
  );
  check('withdrawal-capable API key blocks live admission', !unsafeResult.sent && /withdrawals enabled/.test(unsafeResult.error ?? '') && placeCalls === 0);
}

// Silent price normalization would make the preview differ from the live
// request. Off-tick prices are rejected explicitly.
{
  const { service } = orderService({ client: null });
  const preview = service.preview({
    symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: 0.1, price: 100.005, source: 'manual',
  });
  check('off-tick LIMIT price is rejected explicitly', !preview.ok && preview.errors.some((error) => /tickSize/.test(error)));
}

// Terminal statuses can still contain real execution. Those outcomes must be
// recorded as accepted and reconciled, never represented as "not sent".
{
  const client = {
    openOrders: async () => [],
    placeOrder: async (params) => ({
      symbol: 'BTCUSDT',
      orderId: 33,
      clientOrderId: params.newClientOrderId,
      transactTime: Date.now(),
      status: 'EXPIRED',
      executedQty: '0.05',
      cummulativeQuoteQty: '5',
      fills: [{ tradeId: 9, price: '100', qty: '0.05', commission: '0', commissionAsset: 'USDT' }],
    }),
    queryOrder: async (_symbol, clientOrderId) => ({
      symbol: 'BTCUSDT', orderId: 33, clientOrderId, status: 'EXPIRED',
      executedQty: '0.05', cummulativeQuoteQty: '5',
    }),
  };
  const { service, ledger } = orderService({ client });
  const result = await service.send(
    { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, source: 'manual' },
    'BTCUSDT',
  );
  const response = ledger.events.find((event) => event.kind === 'order_response' && event.data?.orderId === 33);
  check('partially executed terminal order is accepted', result.sent && result.outcome === 'accepted');
  check('partially executed terminal order requires reconciliation', result.reconciliationRequired === true && response?.data?.reservationReleased === false);
}

// Inline execution evidence is multiplied and compared to the acknowledgement
// in base 10, without an intermediate Number conversion.
{
  const recorded = [];
  const client = {
    openOrders: async () => [],
    placeOrder: async (params) => ({
      symbol: 'BTCUSDT', orderId: 34, clientOrderId: params.newClientOrderId,
      transactTime: Date.now(), status: 'FILLED', executedQty: '0.00000000000000001',
      cummulativeQuoteQty: '0.0000000000000000010000000000000001',
      fills: [{
        tradeId: 10, price: '0.10000000000000001', qty: '0.00000000000000001',
        commission: '0.000000000000000001', commissionAsset: 'USDT',
      }],
    }),
  };
  const account = accountStub({ recordFill: (fill) => { recorded.push(fill); return true; } });
  const { service } = orderService({ client, account });
  const result = await service.send(
    { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, source: 'manual' },
    'BTCUSDT',
  );
  check(
    'inline fill money remains exact through multiplication and completeness proof',
    result.sent
      && result.reconciliationRequired === false
      && recorded[0]?.price === '0.10000000000000001'
      && recorded[0]?.qty === '0.00000000000000001'
      && recorded[0]?.quoteQty === '0.0000000000000000010000000000000001',
  );
}

// Concurrent callers share one authoritative open-order request and the
// validator accepts current conditional market order types.
{
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const client = {
    openOrders: async () => {
      calls += 1;
      await gate;
      return [{
        symbol: 'BTCUSDT', orderId: 44, side: 'SELL', type: 'STOP_LOSS', status: 'NEW',
        price: '0', origQty: '0.1', executedQty: '0', time: Date.now(),
      }];
    },
  };
  const { service } = orderService({ client });
  const first = service.syncOpenOrders();
  const second = service.syncOpenOrders();
  await new Promise((resolve) => setImmediate(resolve));
  check('concurrent open-order syncs are coalesced', calls === 1);
  release();
  await Promise.all([first, second]);
  check('current STOP_LOSS open orders are accepted', service.openOrdersCache[0]?.type === 'STOP_LOSS');
}

// Cancel-all uses the same serialized service boundary and preserves unknown
// transport outcomes for reconciliation.
{
  const knownClient = { cancelAllOrders: async () => [], openOrders: async () => [] };
  const { service: known } = orderService({ client: knownClient });
  const canceled = await known.cancelAll('BTCUSDT');
  check('cancel-all known success is reconciled', canceled.ok && canceled.outcome === 'canceled');

  const unknownClient = { cancelAllOrders: async () => { throw new Error('socket closed after write'); }, openOrders: async () => [] };
  const { service: unknown } = orderService({ client: unknownClient });
  const ambiguous = await unknown.cancelAll('BTCUSDT');
  check('cancel-all transport failure is explicitly unknown', !ambiguous.ok && ambiguous.outcome === 'unknown' && ambiguous.reconciliationRequired === true);
}

// Account refreshes are coalesced, telemetry failures do not corrupt
// connectivity, and only fully priced equity can become the daily baseline.
{
  let accountCalls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const client = {
    account: async () => {
      accountCalls += 1;
      await gate;
      return { balances: [{ asset: 'USDT', free: '10', locked: '0' }], canTrade: true, canWithdraw: false };
    },
    apiRestrictions: async () => ({ ...safeRestrictions }),
  };
  const account = new AccountService(client, new FakeLedger(), () => 1);
  const first = account.sync();
  const second = account.sync();
  await new Promise((resolve) => setImmediate(resolve));
  check('concurrent account syncs are coalesced', accountCalls === 1);
  release();
  await Promise.all([first, second]);
  check('coalesced account sync commits connected state', account.connected && account.equity().complete);
}

{
  class SnapshotFailLedger extends FakeLedger {
    logEvent(kind, symbol = null, data = null) {
      if (kind === 'account_snapshot' || kind === 'binance.connected') throw new Error('disk telemetry unavailable');
      return super.logEvent(kind, symbol, data);
    }
  }
  const client = {
    account: async () => ({ balances: [{ asset: 'USDT', free: '10', locked: '0' }], canTrade: true, canWithdraw: false }),
    apiRestrictions: async () => ({ ...safeRestrictions }),
  };
  const account = new AccountService(client, new SnapshotFailLedger(), () => 1);
  await account.sync();
  check('telemetry write failure does not mark a refreshed account disconnected', account.connected && account.lastError === null);
}

{
  const ledger = new FakeLedger();
  let price = null;
  const client = {
    account: async () => ({ balances: [{ asset: 'BTC', free: '1', locked: '0' }], canTrade: true, canWithdraw: false }),
    apiRestrictions: async () => ({ ...safeRestrictions }),
  };
  const account = new AccountService(client, ledger, () => price);
  await account.sync();
  check('unpriced holdings mark equity incomplete', !account.equity().complete && account.dayOpenEquity() === null);
  price = 100;
  await account.sync();
  check('first complete snapshot becomes the daily baseline', account.equity().complete && account.dayOpenEquity() === 100);
  const rejected = account.recordFill({
    symbol: 'BTCUSDC', tradeId: 99, orderId: 99, side: 'BUY', price: '100', qty: '1',
    quoteQty: '100', commission: '0', commissionAsset: 'USDC', ts: Date.now(), source: 'test',
  });
  check('non-USDT fills are rejected from USDT PnL', rejected === false && ledger.fills.every((fill) => fill.symbol !== 'BTCUSDC'));
}

// A REST snapshot started before a newer private-stream update must not roll
// the account balance backward when it eventually resolves.
{
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const t0 = Date.UTC(2026, 6, 10, 11);
  let now = t0;
  const client = {
    account: async () => {
      await gate;
      return {
        balances: [{ asset: 'USDT', free: '1', locked: '0' }],
        canTrade: true,
        canWithdraw: false,
        updateTime: t0,
      };
    },
    apiRestrictions: async () => ({ ...safeRestrictions }),
  };
  const account = new AccountService(client, new FakeLedger(), () => 1, () => now);
  const syncing = account.sync();
  await new Promise((resolve) => setImmediate(resolve));
  now = t0 + 2;
  account.applyStreamBalances([{ a: 'USDT', f: '2', l: '0' }], now);
  release();
  await syncing;
  check('newer stream balance survives an older in-flight REST snapshot', account.equity().availableUsdt === 2);
  account.applyStreamBalances([{ a: 'USDT', f: '0.5', l: '0' }], t0 + 1);
  check('out-of-order stream balance update is ignored', account.equity().availableUsdt === 2);
}

// A partial stream update races a full REST snapshot. Stream-owned assets win,
// while untouched REST assets still advance and the merged state is snapshotted.
{
  const t0 = Date.UTC(2026, 6, 10, 11, 30);
  const refreshAt = t0 + 15 * 60_000;
  let now = t0;
  let accountCalls = 0;
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
  const ledger = new FakeLedger();
  const account = new AccountService({
    account: async () => {
      accountCalls += 1;
      if (accountCalls === 1) {
        return {
          balances: [
            { asset: 'USDT', free: '1', locked: '0' },
            { asset: 'BTC', free: '1', locked: '0' },
          ],
          canTrade: true,
          canWithdraw: false,
          updateTime: t0,
        };
      }
      return refreshGate;
    },
    apiRestrictions: async () => ({ ...safeRestrictions }),
  }, ledger, (symbol) => (symbol === 'BTCUSDT' ? 100 : null), () => now);
  await account.sync();

  now = refreshAt;
  const refreshing = account.sync();
  await new Promise((resolve) => setImmediate(resolve));
  now = refreshAt + 2;
  account.applyStreamBalances(
    [{ a: 'USDT', f: '2', l: '0' }],
    now,
  );
  releaseRefresh({
    balances: [
      { asset: 'USDT', free: '10', locked: '0' },
      { asset: 'BTC', free: '2', locked: '0' },
    ],
    canTrade: true,
    canWithdraw: false,
    updateTime: refreshAt,
  });
  await refreshing;
  const merged = account.equity();
  const mergedSnapshot = ledger.lastEvent('account_snapshot');

  now = refreshAt + 3;
  account.applyStreamBalances([{ a: 'BTC', f: '0', l: '0' }], now);
  const afterDelete = account.equity();
  check(
    'partial stream race merges untouched REST assets and preserves stream deletion',
    merged.availableUsdt === 2
      && merged.entries.some((entry) => entry.asset === 'BTC' && entry.free === 2)
      && merged.totalUsdt === 202
      && merged.sourceFresh
      && merged.complete
      && account.connected
      && mergedSnapshot?.data?.availableUsdt === 2
      && mergedSnapshot?.data?.totalUsdt === 202
      && mergedSnapshot?.data?.assets === 2
      && mergedSnapshot?.data?.complete === true
      && afterDelete.availableUsdt === 2
      && !afterDelete.entries.some((entry) => entry.asset === 'BTC')
      && afterDelete.totalUsdt === 2
      && afterDelete.sourceFresh
      && afterDelete.complete,
  );
}

// A partial stream event older than an in-flight REST snapshot may be visible
// temporarily, but the newer REST value must win for that asset.
{
  const t0 = Date.UTC(2026, 6, 10, 12);
  const restTs = t0 + 15 * 60_000 + 100;
  const streamTs = restTs - 10;
  let now = t0;
  let accountCalls = 0;
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
  const ledger = new FakeLedger();
  const account = new AccountService({
    account: async () => {
      accountCalls += 1;
      if (accountCalls === 1) {
        return {
          balances: [
            { asset: 'USDT', free: '1', locked: '0' },
            { asset: 'BTC', free: '1', locked: '0' },
          ],
          canTrade: true,
          canWithdraw: false,
          updateTime: t0,
        };
      }
      return refreshGate;
    },
    apiRestrictions: async () => ({ ...safeRestrictions }),
  }, ledger, (symbol) => (symbol === 'BTCUSDT' ? 100 : null), () => now);
  await account.sync();

  now = restTs;
  const refreshing = account.sync();
  await new Promise((resolve) => setImmediate(resolve));
  account.applyStreamBalances([{ a: 'USDT', f: '9', l: '0' }], streamTs);
  const duringRace = account.equity();
  releaseRefresh({
    balances: [
      { asset: 'USDT', free: '5', locked: '0' },
      { asset: 'BTC', free: '2', locked: '0' },
    ],
    canTrade: true,
    canWithdraw: false,
    updateTime: restTs,
  });
  await refreshing;
  const merged = account.equity();
  const mergedSnapshot = ledger.lastEvent('account_snapshot');
  check(
    'newer REST asset value wins over an older partial stream race',
    duringRace.availableUsdt === 9
      && merged.availableUsdt === 5
      && merged.entries.some((entry) => entry.asset === 'BTC' && entry.free === 2)
      && merged.totalUsdt === 205
      && account.connected
      && merged.sourceFresh
      && merged.complete
      && mergedSnapshot?.data?.availableUsdt === 5
      && mergedSnapshot?.data?.totalUsdt === 205
      && mergedSnapshot?.data?.assets === 2
      && mergedSnapshot?.data?.complete === true,
  );
}

// On cold start, a partial stream can precede the first full REST snapshot.
// Its newer asset value overlays REST while untouched REST assets still load.
{
  const t0 = Date.UTC(2026, 6, 10, 13);
  let now = t0 + 100;
  const ledger = new FakeLedger();
  const account = new AccountService({
    account: async () => ({
      balances: [
        { asset: 'USDT', free: '10', locked: '0' },
        { asset: 'BTC', free: '2', locked: '0' },
      ],
      canTrade: true,
      canWithdraw: false,
      updateTime: t0 + 99,
    }),
    apiRestrictions: async () => ({ ...safeRestrictions }),
  }, ledger, (symbol) => (symbol === 'BTCUSDT' ? 100 : null), () => now);
  account.applyStreamBalances([{ a: 'USDT', f: '2', l: '0' }], t0 + 100);
  const partial = account.equity();
  await account.sync();
  const merged = account.equity();
  const mergedSnapshot = ledger.lastEvent('account_snapshot');
  check(
    'cold-start partial stream overlays older REST while untouched assets load',
    partial.availableUsdt === 2
      && !partial.sourceFresh
      && merged.availableUsdt === 2
      && merged.entries.some((entry) => entry.asset === 'BTC' && entry.free === 2)
      && merged.totalUsdt === 202
      && account.connected
      && merged.sourceFresh
      && merged.complete
      && mergedSnapshot?.data?.availableUsdt === 2
      && mergedSnapshot?.data?.totalUsdt === 202
      && mergedSnapshot?.data?.assets === 2
      && mergedSnapshot?.data?.complete === true,
  );
}

// A full REST snapshot older than the committed full-source watermark cannot
// mutate balances, refresh availability, or emit a complete snapshot. A newer
// source timestamp must still recover normally afterward.
{
  const base = Date.UTC(2026, 6, 10, 14);
  const t90 = base + 90;
  const t100 = base + 100;
  const t101 = base + 101;
  let now = t100;
  let snapshot = {
    balances: [{ asset: 'USDT', free: '1', locked: '0' }],
    canTrade: true,
    canWithdraw: false,
    updateTime: t100,
  };
  const ledger = new FakeLedger();
  const account = new AccountService({
    account: async () => snapshot,
    apiRestrictions: async () => ({ ...safeRestrictions }),
  }, ledger, () => 1, () => now);
  await account.sync();
  const baseline = account.equity();
  const baselineSyncTs = account.lastSyncTs;
  const baselineSnapshotCount =
    ledger.events.filter((event) => event.kind === 'account_snapshot').length;

  now = t100 + 15 * 60_000 + 1;
  snapshot = {
    balances: [{ asset: 'USDT', free: '9', locked: '0' }],
    canTrade: true,
    canWithdraw: false,
    updateTime: t90,
  };
  await account.sync();
  const afterStale = account.equity();
  const staleSyncTs = account.lastSyncTs;
  const staleSnapshotCount =
    ledger.events.filter((event) => event.kind === 'account_snapshot').length;

  now += 1;
  snapshot = {
    balances: [{ asset: 'USDT', free: '2', locked: '0' }],
    canTrade: true,
    canWithdraw: false,
    updateTime: t101,
  };
  await account.sync();
  const recovered = account.equity();
  const recoveredSnapshot = ledger.lastEvent('account_snapshot');
  check(
    'stale full REST cannot mutate, refresh, or snapshot before newer recovery',
    baseline.availableUsdt === 1
      && baseline.sourceFresh
      && baseline.complete
      && baselineSnapshotCount === 1
      && afterStale.availableUsdt === 1
      && !afterStale.sourceFresh
      && !afterStale.complete
      && staleSyncTs === baselineSyncTs
      && staleSnapshotCount === baselineSnapshotCount
      && recovered.availableUsdt === 2
      && recovered.sourceFresh
      && recovered.complete
      && account.connected
      && recoveredSnapshot?.data?.availableUsdt === 2
      && recoveredSnapshot?.data?.totalUsdt === 2
      && recoveredSnapshot?.data?.complete === true,
  );
}

// Equal source timestamps use request causality as the tie-breaker: REST may
// repair state that existed before its request, while an equal stream event
// observed during the request owns its touched asset.
{
  const t0 = Date.UTC(2026, 6, 10, 15);
  const sourceTs = t0 + 100;

  const preRequestLedger = new FakeLedger();
  const preRequestAccount = new AccountService({
    account: async () => ({
      balances: [
        { asset: 'USDT', free: '10', locked: '0' },
        { asset: 'BTC', free: '2', locked: '0' },
      ],
      canTrade: true,
      canWithdraw: false,
      updateTime: sourceTs,
    }),
    apiRestrictions: async () => ({ ...safeRestrictions }),
  }, preRequestLedger, (symbol) => (symbol === 'BTCUSDT' ? 100 : null), () => sourceTs);
  preRequestAccount.applyStreamBalances(
    [{ a: 'USDT', f: '2', l: '0' }],
    sourceTs,
  );
  const preRequestPartial = preRequestAccount.equity();
  await preRequestAccount.sync();
  const repaired = preRequestAccount.equity();
  const repairedSnapshot = preRequestLedger.lastEvent('account_snapshot');

  let releaseEqualRest;
  const equalRestGate = new Promise((resolve) => { releaseEqualRest = resolve; });
  const duringRequestLedger = new FakeLedger();
  const duringRequestAccount = new AccountService({
    account: async () => equalRestGate,
    apiRestrictions: async () => ({ ...safeRestrictions }),
  }, duringRequestLedger, (symbol) => {
    if (symbol === 'BTCUSDT') return 100;
    if (symbol === 'ETHUSDT') return 50;
    return null;
  }, () => sourceTs);
  const syncing = duringRequestAccount.sync();
  await new Promise((resolve) => setImmediate(resolve));
  duringRequestAccount.applyStreamBalances(
    [
      { a: 'USDT', f: '2', l: '0' },
      { a: 'BTC', f: '0', l: '0' },
    ],
    sourceTs,
  );
  const duringRequestPartial = duringRequestAccount.equity();
  releaseEqualRest({
    balances: [
      { asset: 'USDT', free: '10', locked: '0' },
      { asset: 'BTC', free: '2', locked: '0' },
      { asset: 'ETH', free: '3', locked: '0' },
    ],
    canTrade: true,
    canWithdraw: false,
    updateTime: sourceTs,
  });
  await syncing;
  const streamWon = duringRequestAccount.equity();
  const streamWonSnapshot = duringRequestLedger.lastEvent('account_snapshot');
  check(
    'equal source times use pre-request REST repair and in-flight stream ownership',
    preRequestPartial.availableUsdt === 2
      && !preRequestPartial.sourceFresh
      && repaired.availableUsdt === 10
      && repaired.entries.some((entry) => entry.asset === 'BTC' && entry.free === 2)
      && repaired.totalUsdt === 210
      && repaired.sourceFresh
      && repaired.complete
      && repairedSnapshot?.data?.totalUsdt === 210
      && repairedSnapshot?.data?.complete === true
      && duringRequestPartial.availableUsdt === 2
      && !duringRequestPartial.sourceFresh
      && streamWon.availableUsdt === 2
      && !streamWon.entries.some((entry) => entry.asset === 'BTC')
      && streamWon.entries.some((entry) => entry.asset === 'ETH' && entry.free === 3)
      && streamWon.totalUsdt === 152
      && streamWon.sourceFresh
      && streamWon.complete
      && streamWonSnapshot?.data?.totalUsdt === 152
      && streamWonSnapshot?.data?.assets === 2
      && streamWonSnapshot?.data?.complete === true,
  );
}

// A source-less full REST snapshot may refresh a clean, previously sourced
// full state. Once a newer partial stream exists before the request, that same
// unknown ordering cannot restamp or snapshot the partial state.
{
  const t0 = Date.UTC(2026, 6, 10, 16);
  let now = t0 + 100;
  let snapshot = {
    balances: [
      { asset: 'USDT', free: '1', locked: '0' },
      { asset: 'BTC', free: '1', locked: '0' },
    ],
    canTrade: true,
    canWithdraw: false,
    updateTime: t0 + 100,
  };
  const ledger = new FakeLedger();
  const account = new AccountService({
    account: async () => snapshot,
    apiRestrictions: async () => ({ ...safeRestrictions }),
  }, ledger, (symbol) => (symbol === 'BTCUSDT' ? 100 : null), () => now);
  await account.sync();

  now += 15 * 60_000 + 1;
  const cleanSourceLessNow = now;
  snapshot = {
    balances: [
      { asset: 'USDT', free: '2', locked: '0' },
      { asset: 'BTC', free: '2', locked: '0' },
    ],
    canTrade: true,
    canWithdraw: false,
  };
  await account.sync();
  const cleanSourceLess = account.equity();
  const cleanSourceLessSyncTs = account.lastSyncTs;
  const cleanSourceLessSnapshot = ledger.lastEvent('account_snapshot');
  const snapshotCountBeforeStream =
    ledger.events.filter((event) => event.kind === 'account_snapshot').length;

  now += 1;
  account.applyStreamBalances([{ a: 'USDT', f: '3', l: '0' }], now);
  const partialStream = account.equity();
  const partialStreamSyncTs = account.lastSyncTs;
  now += 15 * 60_000 + 1;
  snapshot = {
    balances: [
      { asset: 'USDT', free: '9', locked: '0' },
      { asset: 'BTC', free: '9', locked: '0' },
    ],
    canTrade: true,
    canWithdraw: false,
  };
  await account.sync();
  const afterUnsafeSourceLess = account.equity();
  const unsafeSnapshotCount =
    ledger.events.filter((event) => event.kind === 'account_snapshot').length;
  check(
    'source-less REST refreshes clean full state but not newer partial stream state',
    cleanSourceLess.availableUsdt === 2
      && cleanSourceLess.entries.some((entry) => entry.asset === 'BTC' && entry.free === 2)
      && cleanSourceLess.totalUsdt === 202
      && cleanSourceLess.sourceFresh
      && cleanSourceLess.complete
      && cleanSourceLessSyncTs === cleanSourceLessNow
      && cleanSourceLessSnapshot?.data?.totalUsdt === 202
      && cleanSourceLessSnapshot?.data?.complete === true
      && snapshotCountBeforeStream === 2
      && partialStream.availableUsdt === 3
      && partialStream.entries.some((entry) => entry.asset === 'BTC' && entry.free === 2)
      && partialStream.totalUsdt === 203
      && partialStream.sourceFresh
      && partialStream.complete
      && afterUnsafeSourceLess.availableUsdt === 3
      && !afterUnsafeSourceLess.sourceFresh
      && !afterUnsafeSourceLess.complete
      && account.lastSyncTs === partialStreamSyncTs
      && unsafeSnapshotCount === snapshotCountBeforeStream,
  );
}

// A valid-time malformed partial creates a continuity floor even though no
// balance mutates. Source-less or pre-floor REST cannot certify across that
// gap; a full source reaching the floor may recover while preserving newer
// per-asset stream ownership.
{
  const base = Date.UTC(2026, 6, 10, 17);
  const t100 = base + 100;
  const t150 = base + 150;
  const t200 = base + 200;
  const t300 = base + 300;
  let now = t100;
  let fullSnapshot = {
    balances: [
      { asset: 'USDT', free: '1', locked: '0' },
      { asset: 'BTC', free: '1', locked: '0' },
    ],
    canTrade: true,
    canWithdraw: false,
    updateTime: t100,
  };
  const ledger = new FakeLedger();
  const account = new AccountService({
    account: async () => fullSnapshot,
    apiRestrictions: async () => ({ ...safeRestrictions }),
  }, ledger, (symbol) => (symbol === 'BTCUSDT' ? 100 : null), () => now);
  await account.sync();
  const baseline = account.equity();
  const baselineSyncTs = account.lastSyncTs;
  const baselineSnapshotCount =
    ledger.events.filter((event) => event.kind === 'account_snapshot').length;

  now = t100 + 15 * 60_000 + 1;
  account.applyStreamBalances(
    [{ a: 'BTC', f: 'not-a-number', l: '0' }],
    t200,
  );
  const afterInvalid = account.equity();
  const invalidSyncTs = account.lastSyncTs;

  fullSnapshot = {
    balances: [
      { asset: 'USDT', free: '9', locked: '0' },
      { asset: 'BTC', free: '9', locked: '0' },
    ],
    canTrade: true,
    canWithdraw: false,
  };
  await account.sync();
  const afterSourceLess = account.equity();
  const sourceLessSyncTs = account.lastSyncTs;
  const sourceLessSnapshotCount =
    ledger.events.filter((event) => event.kind === 'account_snapshot').length;

  account.applyStreamBalances([{ a: 'USDT', f: '0', l: '0' }], t300);
  const afterCurrentTombstone = account.equity();
  const tombstoneSyncTs = account.lastSyncTs;

  fullSnapshot = {
    balances: [
      { asset: 'USDT', free: '9', locked: '0' },
      { asset: 'BTC', free: '9', locked: '0' },
    ],
    canTrade: true,
    canWithdraw: false,
    updateTime: t150,
  };
  await account.sync();
  const afterPreFloor = account.equity();
  const preFloorSyncTs = account.lastSyncTs;
  const preFloorSnapshotCount =
    ledger.events.filter((event) => event.kind === 'account_snapshot').length;

  fullSnapshot = {
    balances: [
      { asset: 'USDT', free: '9', locked: '0' },
      { asset: 'BTC', free: '2', locked: '0' },
    ],
    canTrade: true,
    canWithdraw: false,
    updateTime: t200,
  };
  await account.sync();
  const recovered = account.equity();
  const recoveredSnapshot = ledger.lastEvent('account_snapshot');
  const recoveredSnapshotCount =
    ledger.events.filter((event) => event.kind === 'account_snapshot').length;
  check(
    'continuity gap recovers only at its full-source floor with newer tombstones intact',
    baseline.availableUsdt === 1
      && baseline.entries.some((entry) => entry.asset === 'BTC' && entry.free === 1)
      && baseline.totalUsdt === 101
      && baseline.sourceFresh
      && baseline.complete
      && baselineSyncTs === t100
      && baselineSnapshotCount === 1
      && afterInvalid.availableUsdt === 1
      && afterInvalid.entries.some((entry) => entry.asset === 'BTC' && entry.free === 1)
      && !afterInvalid.sourceFresh
      && !afterInvalid.complete
      && invalidSyncTs === null
      && ledger.events.some(
        (event) => (
          event.kind === 'error_event'
          && event.data?.source === 'account.stream'
          && /invalid balance update amount/.test(event.data?.message ?? '')
        ),
      )
      && afterSourceLess.availableUsdt === 1
      && afterSourceLess.entries.some((entry) => entry.asset === 'BTC' && entry.free === 1)
      && afterSourceLess.totalUsdt === 101
      && !afterSourceLess.sourceFresh
      && !afterSourceLess.complete
      && sourceLessSyncTs === invalidSyncTs
      && sourceLessSnapshotCount === baselineSnapshotCount
      && afterCurrentTombstone.availableUsdt === 0
      && !afterCurrentTombstone.entries.some((entry) => entry.asset === 'USDT')
      && afterCurrentTombstone.entries.some((entry) => entry.asset === 'BTC' && entry.free === 1)
      && afterCurrentTombstone.totalUsdt === 100
      && !afterCurrentTombstone.sourceFresh
      && !afterCurrentTombstone.complete
      && afterPreFloor.availableUsdt === 0
      && !afterPreFloor.entries.some((entry) => entry.asset === 'USDT')
      && afterPreFloor.entries.some((entry) => entry.asset === 'BTC' && entry.free === 1)
      && afterPreFloor.totalUsdt === 100
      && !afterPreFloor.sourceFresh
      && !afterPreFloor.complete
      && preFloorSyncTs === tombstoneSyncTs
      && preFloorSnapshotCount === baselineSnapshotCount
      && recovered.availableUsdt === 0
      && !recovered.entries.some((entry) => entry.asset === 'USDT')
      && recovered.entries.some((entry) => entry.asset === 'BTC' && entry.free === 2)
      && recovered.totalUsdt === 200
      && account.connected
      && recovered.sourceFresh
      && recovered.complete
      && recoveredSnapshotCount === baselineSnapshotCount + 1
      && recoveredSnapshot?.data?.availableUsdt === 0
      && recoveredSnapshot?.data?.totalUsdt === 200
      && recoveredSnapshot?.data?.assets === 1
      && recoveredSnapshot?.data?.complete === true,
  );
}

// A future REST source timestamp cannot mutate balances, keep the prior
// snapshot fresh, or poison ordering against the next valid current snapshot.
{
  const t0 = Date.UTC(2026, 6, 10, 12);
  let now = t0;
  let snapshot = {
    balances: [{ asset: 'USDT', free: '1', locked: '0' }],
    canTrade: true,
    canWithdraw: false,
    updateTime: t0,
  };
  const account = new AccountService({
    account: async () => snapshot,
    apiRestrictions: async () => ({ ...safeRestrictions }),
  }, new FakeLedger(), () => 1, () => now);
  await account.sync();
  const baseline = account.equity();

  snapshot = {
    balances: [{ asset: 'USDT', free: '9', locked: '0' }],
    canTrade: true,
    canWithdraw: false,
    updateTime: t0 + 10_000,
  };
  await account.sync();
  const afterFuture = account.equity();
  const futureError = account.lastError;

  now = t0 + 1;
  snapshot = {
    balances: [{ asset: 'USDT', free: '2', locked: '0' }],
    canTrade: true,
    canWithdraw: false,
    updateTime: now,
  };
  await account.sync();
  const afterCurrent = account.equity();
  check(
    'future REST balance time cannot mutate, poison ordering, or preserve stale freshness',
    baseline.availableUsdt === 1
      && baseline.sourceFresh
      && afterFuture.availableUsdt === 1
      && !afterFuture.sourceFresh
      && !account.lastError
      && /future|timestamp/.test(futureError ?? '')
      && afterCurrent.availableUsdt === 2
      && afterCurrent.sourceFresh,
  );
}

// Rejecting a future partial stream breaks full-account continuity. A later
// current partial may update its asset, but only a coherent full REST snapshot
// can restore freshness, completeness, and complete-snapshot eligibility.
{
  const t0 = Date.UTC(2026, 6, 10, 13);
  let now = t0;
  const ledger = new FakeLedger();
  let fullSnapshot = {
    balances: [
      { asset: 'USDT', free: '1', locked: '0' },
      { asset: 'BTC', free: '1', locked: '0' },
    ],
    canTrade: true,
    canWithdraw: false,
    updateTime: t0,
  };
  const account = new AccountService({
    account: async () => fullSnapshot,
    apiRestrictions: async () => ({ ...safeRestrictions }),
  }, ledger, (symbol) => (symbol === 'BTCUSDT' ? 100 : null), () => now);
  await account.sync();
  const baseline = account.equity();
  const baselineSnapshotCount =
    ledger.events.filter((event) => event.kind === 'account_snapshot').length;

  account.applyStreamBalances(
    [{ a: 'BTC', f: '0', l: '0' }],
    t0 + 10_000,
  );
  const afterFuture = account.equity();

  now = t0 + 15 * 60_000 + 1;
  account.applyStreamBalances(
    [{ a: 'USDT', f: '2', l: '0' }],
    now,
  );
  const afterCurrentPartial = account.equity();
  const partialSnapshotCount =
    ledger.events.filter((event) => event.kind === 'account_snapshot').length;

  fullSnapshot = {
    balances: [
      { asset: 'USDT', free: '2', locked: '0' },
      { asset: 'BTC', free: '1', locked: '0' },
    ],
    canTrade: true,
    canWithdraw: false,
    updateTime: now,
  };
  await account.sync();
  const recovered = account.equity();
  const recoveredSnapshot = ledger.lastEvent('account_snapshot');
  const recoveredSnapshotCount =
    ledger.events.filter((event) => event.kind === 'account_snapshot').length;
  check(
    'future stream rejection requires coherent full REST before continuity re-greens',
    baseline.availableUsdt === 1
      && baseline.entries.some((entry) => entry.asset === 'BTC' && entry.free === 1)
      && baseline.totalUsdt === 101
      && baseline.sourceFresh
      && baseline.complete
      && baselineSnapshotCount === 1
      && afterFuture.availableUsdt === 1
      && afterFuture.entries.some((entry) => entry.asset === 'BTC' && entry.free === 1)
      && !afterFuture.sourceFresh
      && ledger.events.some(
        (event) => (
          event.kind === 'error_event'
          && event.data?.source === 'account.stream'
          && /future|timestamp/.test(event.data?.message ?? '')
        ),
      )
      && afterCurrentPartial.availableUsdt === 2
      && afterCurrentPartial.entries.some((entry) => entry.asset === 'BTC' && entry.free === 1)
      && afterCurrentPartial.totalUsdt === 102
      && !afterCurrentPartial.sourceFresh
      && !afterCurrentPartial.complete
      && partialSnapshotCount === baselineSnapshotCount
      && recovered.availableUsdt === 2
      && recovered.entries.some((entry) => entry.asset === 'BTC' && entry.free === 1)
      && recovered.totalUsdt === 102
      && account.connected
      && recovered.sourceFresh
      && recovered.complete
      && recoveredSnapshotCount === baselineSnapshotCount + 1
      && recoveredSnapshot?.data?.availableUsdt === 2
      && recoveredSnapshot?.data?.totalUsdt === 102
      && recoveredSnapshot?.data?.assets === 2
      && recoveredSnapshot?.data?.complete === true,
  );
}

// A stream rejected under an untrustworthy clock creates the same continuity
// break as a future timestamp. Later valid partial data can update values, but
// cannot certify the full account before a coherent REST refresh.
{
  const t0 = Date.UTC(2026, 6, 10, 13, 30);
  const highWater = t0 + 15 * 60_000 + 1;
  let now = t0;
  const ledger = new FakeLedger();
  let fullSnapshot = {
    balances: [
      { asset: 'USDT', free: '1', locked: '0' },
      { asset: 'BTC', free: '1', locked: '0' },
    ],
    canTrade: true,
    canWithdraw: false,
    updateTime: t0,
  };
  const account = new AccountService({
    account: async () => fullSnapshot,
    apiRestrictions: async () => ({ ...safeRestrictions }),
  }, ledger, (symbol) => (symbol === 'BTCUSDT' ? 100 : null), () => now);
  await account.sync();
  const baseline = account.equity();
  const baselineSnapshotCount =
    ledger.events.filter((event) => event.kind === 'account_snapshot').length;

  now = highWater;
  account.equity();
  now = highWater - 1;
  account.applyStreamBalances([{ a: 'BTC', f: '0', l: '0' }], now);
  const duringFault = account.equity();

  now = highWater + 1;
  account.applyStreamBalances([{ a: 'USDT', f: '2', l: '0' }], now);
  const afterCurrentPartial = account.equity();
  const partialSnapshotCount =
    ledger.events.filter((event) => event.kind === 'account_snapshot').length;

  fullSnapshot = {
    balances: [
      { asset: 'USDT', free: '2', locked: '0' },
      { asset: 'BTC', free: '1', locked: '0' },
    ],
    canTrade: true,
    canWithdraw: false,
    updateTime: now,
  };
  await account.sync();
  const recovered = account.equity();
  const recoveredSnapshot = ledger.lastEvent('account_snapshot');
  const recoveredSnapshotCount =
    ledger.events.filter((event) => event.kind === 'account_snapshot').length;
  check(
    'clock-rejected stream requires coherent full REST before continuity re-greens',
    baseline.totalUsdt === 101
      && baseline.sourceFresh
      && baseline.complete
      && baselineSnapshotCount === 1
      && duringFault.availableUsdt === 1
      && duringFault.entries.some((entry) => entry.asset === 'BTC' && entry.free === 1)
      && !duringFault.sourceFresh
      && !duringFault.complete
      && ledger.events.some(
        (event) => (
          event.kind === 'error_event'
          && event.data?.source === 'account.stream'
          && /clock regressed/.test(event.data?.message ?? '')
        ),
      )
      && afterCurrentPartial.availableUsdt === 2
      && afterCurrentPartial.entries.some((entry) => entry.asset === 'BTC' && entry.free === 1)
      && afterCurrentPartial.totalUsdt === 102
      && !afterCurrentPartial.sourceFresh
      && !afterCurrentPartial.complete
      && partialSnapshotCount === baselineSnapshotCount
      && recovered.availableUsdt === 2
      && recovered.entries.some((entry) => entry.asset === 'BTC' && entry.free === 1)
      && recovered.totalUsdt === 102
      && account.connected
      && recovered.sourceFresh
      && recovered.complete
      && recoveredSnapshotCount === baselineSnapshotCount + 1
      && recoveredSnapshot?.data?.totalUsdt === 102
      && recoveredSnapshot?.data?.assets === 2
      && recoveredSnapshot?.data?.complete === true,
  );
}

// A rejected future stream event still invalidates the REST request that was
// already in flight. The request cannot publish balances or freshness against
// a source race it did not observe, and the rejected time cannot poison later
// current REST or stream ordering.
{
  const t0 = Date.UTC(2026, 6, 10, 14);
  let now = t0;
  let accountCalls = 0;
  let releaseRacedRest;
  const racedRest = new Promise((resolve) => { releaseRacedRest = resolve; });
  const ledger = new FakeLedger();
  const account = new AccountService({
    account: async () => {
      accountCalls += 1;
      if (accountCalls === 1) {
        return {
          balances: [{ asset: 'USDT', free: '1', locked: '0' }],
          canTrade: true,
          canWithdraw: false,
          updateTime: t0,
        };
      }
      if (accountCalls === 2) return racedRest;
      return {
        balances: [{ asset: 'USDT', free: '2', locked: '0' }],
        canTrade: true,
        canWithdraw: false,
        updateTime: now,
      };
    },
    apiRestrictions: async () => ({ ...safeRestrictions }),
  }, ledger, () => 1, () => now);
  await account.sync();
  const seeded = account.equity();

  const syncing = account.sync();
  await new Promise((resolve) => setImmediate(resolve));
  account.applyStreamBalances(
    [{ a: 'USDT', f: '9', l: '0' }],
    t0 + 10_000,
  );
  const afterFutureDuringRequest = account.equity();
  releaseRacedRest({
    balances: [{ asset: 'USDT', free: '3', locked: '0' }],
    canTrade: true,
    canWithdraw: false,
    updateTime: t0,
  });
  await syncing;
  const afterRacedRest = account.equity();

  now = t0 + 1;
  await account.sync();
  const afterCurrentRest = account.equity();
  now = t0 + 2;
  account.applyStreamBalances(
    [{ a: 'USDT', f: '4', l: '0' }],
    now,
  );
  const afterCurrentStream = account.equity();
  check(
    'future stream rejection invalidates in-flight REST without poisoning recovery order',
    seeded.availableUsdt === 1
      && seeded.sourceFresh
      && afterFutureDuringRequest.availableUsdt === 1
      && !afterFutureDuringRequest.sourceFresh
      && afterRacedRest.availableUsdt === 1
      && !afterRacedRest.sourceFresh
      && ledger.events.some(
        (event) => (
          event.kind === 'error_event'
          && event.data?.source === 'account.stream'
          && /future|timestamp/.test(event.data?.message ?? '')
        ),
      )
      && afterCurrentRest.availableUsdt === 2
      && afterCurrentRest.sourceFresh
      && afterCurrentStream.availableUsdt === 4
      && afterCurrentStream.sourceFresh,
  );
}

// Binance trade history is symbol-scoped. The service may certify its durable
// configured/observed scope, but it must never promote that to account-wide
// daily-loss coverage. Later passes still advance from the per-symbol cursor.
{
  const ledger = new FakeLedger();
  const optionsSeen = [];
  let calls = 0;
  const client = {
    myTrades: async (_symbol, _limit, options) => {
      optionsSeen.push(options);
      calls += 1;
      return calls === 1 ? [{
        symbol: 'BTCUSDT', id: 10, orderId: 20, price: '9007199254740993.00000001',
        qty: '0.00000001', quoteQty: '90071992.5474099300000001',
        commission: '0.000000000000000001', commissionAsset: 'USDT', time: Date.now(), isBuyer: true,
      }] : [];
    },
  };
  const account = new AccountService(client, ledger, () => 100);
  account.setRequiredFillSymbols(['BTCUSDT']);
  check('daily-loss policy fails closed before fill reconciliation', !account.dailyLossPolicy().complete);
  const first = await account.reconcileFills();
  const second = await account.reconcileFills();
  check(
    'signed fill reconciliation certifies only its named symbol scope',
    first.scopeComplete && second.scopeComplete && !second.complete
      && second.accountWide === false
      && second.coverageScope === 'configured_and_observed_symbols',
  );
  check(
    'configured-scope reconciliation cannot certify account-wide daily loss',
    !account.dailyLossPolicy().complete
      && account.dailyLossPolicy().reasons.some((reason) => /account-wide fill coverage/.test(reason)),
  );
  check('fill reconciliation persists and advances a per-symbol cursor', optionsSeen[0]?.startTime > 0 && optionsSeen[1]?.fromId === 11);
  check(
    'REST reconciliation records authoritative decimal strings exactly once',
    ledger.fills.length === 1
      && ledger.fills[0].source === 'rest_reconciliation'
      && ledger.fills[0].price === '9007199254740993.00000001'
      && ledger.fills[0].quoteQty === '90071992.5474099300000001'
      && ledger.fills[0].commission === '0.000000000000000001',
  );
}

// Account freshness and UTC-day policy share one injected wall-clock seam.
// Once that clock regresses, no negative age may re-green signed truth.
{
  const ledger = new FakeLedger();
  const t0 = Date.UTC(2026, 6, 11, 12);
  let now = t0;
  const client = {
    account: async () => ({
      balances: [{ asset: 'USDT', free: '10', locked: '0' }],
      canTrade: true,
      canWithdraw: false,
      updateTime: t0,
    }),
    apiRestrictions: async () => ({ ...safeRestrictions }),
    myTrades: async () => [],
  };
  const account = new AccountService(client, ledger, () => 1, () => now);
  account.setRequiredFillSymbols(['BTCUSDT']);
  await account.sync();
  await account.reconcileFills();

  check(
    'account and fill truth are fresh at the injected-clock forward origin',
    account.equity().sourceFresh && account.fillReconciliationStatus().fresh,
  );
  now = t0 + 60_000;
  check('account freshness includes its exact forward boundary', account.equity().sourceFresh);
  now = t0 + 60_001;
  check('account freshness expires immediately beyond its forward boundary', !account.equity().sourceFresh);
  now = t0 + 90_000;
  check('fill freshness includes its exact forward boundary', account.fillReconciliationStatus().fresh);
  now = t0 + 90_001;
  check('fill freshness expires immediately beyond its forward boundary', !account.fillReconciliationStatus().fresh);

  now = t0 + 500;
  const backwardEquity = account.equity();
  const backwardFill = account.fillReconciliationStatus();
  const backwardPolicy = account.dailyLossPolicy();
  check(
    'backward clock steps cannot re-green stale account or fill truth',
    !backwardEquity.sourceFresh
      && !backwardFill.fresh
      && /clock regressed/.test(backwardFill.error ?? ''),
  );
  check(
    'last-known balances remain visible but unavailable during a clock fault',
    backwardEquity.availableUsdt === 10
      && backwardEquity.totalUsdt === 10
      && backwardEquity.entries.some((entry) => entry.asset === 'USDT' && entry.free === 10)
      && !backwardEquity.complete,
  );
  check(
    'backward clock steps make current-day policy and day-open truth unavailable',
    !backwardPolicy.complete
      && backwardPolicy.reasons.some((reason) => /clock regressed/.test(reason))
      && account.dayOpenEquity() === null
      && Number.isNaN(account.realizedTodayUsd()),
  );
  const faultFill = {
    symbol: 'BTCUSDT', tradeId: 91, orderId: 92, side: 'BUY',
    price: '100', qty: '0.1', quoteQty: '10', commission: '0',
    commissionAsset: 'USDT', ts: t0 + 500, source: 'order_response',
  };
  const recordedDuringFault = account.recordFill(faultFill);
  const coverageDuringFault = account.fillReconciliationStatus();
  check(
    'accepted fill truth remains durable while clock-based freshness is fenced',
    recordedDuringFault
      && ledger.fills.some((fill) => fill.symbol === faultFill.symbol && fill.tradeId === faultFill.tradeId)
      && !coverageDuringFault.fresh
      && /clock regressed/.test(coverageDuringFault.error ?? '')
      && !account.dailyLossPolicy().complete,
  );

  now = t0 + 90_000;
  await account.sync();
  await account.reconcileFills();
  check(
    'clock recovery stays fenced below the prior high-water mark',
    !account.equity().sourceFresh && !account.fillReconciliationStatus().fresh,
  );
  now = t0 + 90_001;
  await account.sync();
  await account.reconcileFills();
  check(
    'clock recovery resumes only at the prior high-water mark',
    account.equity().sourceFresh && account.fillReconciliationStatus().fresh,
  );

  now = Number.NaN;
  check(
    'invalid injected clock fails current-day policy and day-open truth closed',
    !account.dailyLossPolicy().complete && account.dayOpenEquity() === null,
  );
}

// Recovering trust at the exact high-water mark does not refresh the account
// or fill observations that were current before the clock fault.
{
  const t0 = Date.UTC(2026, 6, 12, 10);
  let now = t0;
  const account = new AccountService({
    account: async () => ({
      balances: [{ asset: 'USDT', free: '10', locked: '0' }],
      canTrade: true,
      canWithdraw: false,
      updateTime: t0,
    }),
    apiRestrictions: async () => ({ ...safeRestrictions }),
    myTrades: async () => [],
  }, new FakeLedger(), () => 1, () => now);
  account.setRequiredFillSymbols(['BTCUSDT']);
  await account.sync();
  await account.reconcileFills();

  now = t0 + 500;
  const freshBeforeFault =
    account.equity().sourceFresh && account.fillReconciliationStatus().fresh;
  now = t0 + 499;
  const unavailableDuringFault =
    !account.equity().sourceFresh && !account.fillReconciliationStatus().fresh;
  now = t0 + 500;
  check(
    'equal-floor recovery cannot re-green pre-fault truth without refresh',
    freshBeforeFault
      && unavailableDuringFault
      && !account.equity().sourceFresh
      && !account.fillReconciliationStatus().fresh,
  );
}

// One policy evaluation owns one clock cut. A clock source that would regress
// on a second read must not split daily PnL from its reconciliation posture.
{
  const highWater = Date.UTC(2026, 6, 12, 12);
  let sequence = null;
  let reads = 0;
  const account = new AccountService(
    null,
    new FakeLedger(),
    () => 1,
    () => {
      if (sequence === null) return highWater;
      const value = sequence[Math.min(reads, sequence.length - 1)];
      reads += 1;
      return value;
    },
  );
  sequence = [highWater, highWater - 1, highWater];
  const policy = account.dailyLossPolicy();
  check(
    'daily-loss policy uses one H/H-1/H clock cut',
    reads === 1
      && policy.complete
      && !policy.reasons.some((reason) => /clock regressed/.test(reason)),
  );
}

// Canonical UTC range violations must not mutate the durable day registry.
{
  const ledger = new FakeLedger();
  const t0 = Date.UTC(2026, 6, 13, 12);
  let now = t0;
  const account = new AccountService({ myTrades: async () => [] }, ledger, () => 1, () => now);
  account.setRequiredFillSymbols(['BTCUSDT']);
  const durableBefore = JSON.stringify([...ledger.config]);

  now = MAX_UTC_MS + 1;
  account.setRequiredFillSymbols(['SOLUSDT']);
  const overRange = account.fillReconciliationStatus();
  const durableAfterRange = JSON.stringify([...ledger.config]);
  now = Number.MAX_SAFE_INTEGER;
  account.setRequiredFillSymbols(['ETHUSDT']);
  const unsafeRange = account.fillReconciliationStatus();
  check(
    'out-of-range injected clocks fail closed without changing durable day state',
    !overRange.fresh
      && !unsafeRange.fresh
      && /clock did not return safe epoch milliseconds/.test(overRange.error ?? '')
      && /clock did not return safe epoch milliseconds/.test(unsafeRange.error ?? '')
      && durableAfterRange === durableBefore
      && JSON.stringify([...ledger.config]) === durableBefore,
  );
}

// Both canonical UTC endpoints are valid account clock cuts; the first value
// immediately below the lower endpoint is unavailable.
{
  const zeroLedger = new FakeLedger();
  const zero = new AccountService(
    { myTrades: async () => [] },
    zeroLedger,
    () => 1,
    () => 0,
  );
  zero.setRequiredFillSymbols(['BTCUSDT']);
  const atZero = await zero.reconcileFills();
  const zeroPolicy = new AccountService(null, new FakeLedger(), () => 1, () => 0);

  const maxLedger = new FakeLedger();
  const maximum = new AccountService(
    { myTrades: async () => [] },
    maxLedger,
    () => 1,
    () => MAX_UTC_MS,
  );
  maximum.setRequiredFillSymbols(['BTCUSDT']);
  const atMaximum = await maximum.reconcileFills();

  const belowLedger = new FakeLedger();
  const below = new AccountService(
    { myTrades: async () => [] },
    belowLedger,
    () => 1,
    () => -1,
  );
  const belowMinimum = below.fillReconciliationStatus();
  check(
    'account clock accepts exact UTC 0 and MAX and rejects exact -1',
    atZero.fresh
      && atZero.dayStart === 0
      && atZero.reconciledAt === 0
      && zeroPolicy.realizedTodayUsd() === 0
      && zeroPolicy.dailyLossPolicy().complete
      && atMaximum.fresh
      && atMaximum.dayStart === MAX_UTC_MS
      && atMaximum.reconciledAt === MAX_UTC_MS
      && !belowMinimum.fresh
      && /clock did not return safe epoch milliseconds/.test(belowMinimum.error ?? '')
      && belowLedger.config.size === 0,
  );
}

// Exchange/account timestamps share the canonical UTC range rail. An
// over-range source value cannot poison later stream ordering or enter fills.
{
  const ledger = new FakeLedger();
  const account = new AccountService({
    account: async () => ({
      balances: [{ asset: 'USDT', free: '2', locked: '0' }],
      canTrade: true,
      canWithdraw: false,
      updateTime: MAX_UTC_MS + 1,
    }),
    apiRestrictions: async () => ({ ...safeRestrictions }),
  }, ledger, () => 1, () => MAX_UTC_MS);
  await account.sync();
  account.applyStreamBalances([{ a: 'USDT', f: '3', l: '0' }], MAX_UTC_MS);
  account.applyStreamBalances([{ a: 'USDT', f: '4', l: '0' }], MAX_UTC_MS + 1);
  const overRangeFill = account.recordFill({
    symbol: 'BTCUSDT',
    tradeId: 301,
    orderId: 401,
    side: 'BUY',
    price: '100',
    qty: '0.1',
    quoteQty: '10',
    commission: '0',
    commissionAsset: 'USDT',
    ts: MAX_UTC_MS + 1,
    source: 'test',
  });
  check(
    'over-range account timestamps cannot poison canonical stream or fill truth',
    account.equity().availableUsdt === 3
      && !overRangeFill
      && !ledger.fills.some((fill) => fill.tradeId === 301),
  );
}

// A completion clock can be above the constructor value and still be a
// rollback when a newer read has already raised the service high-water mark.
{
  const ledger = new FakeLedger();
  const constructorFloor = Date.UTC(2026, 6, 14, 12);
  let now = constructorFloor;
  let releaseAccount;
  const accountGate = new Promise((resolve) => { releaseAccount = resolve; });
  const account = new AccountService({
    account: async () => accountGate,
    apiRestrictions: async () => ({ ...safeRestrictions }),
  }, ledger, () => 1, () => now);

  now = constructorFloor + 10_000;
  const syncing = account.sync();
  await new Promise((resolve) => setImmediate(resolve));
  now = constructorFloor + 9_999;
  releaseAccount({
    balances: [{ asset: 'USDT', free: '20', locked: '0' }],
    canTrade: true,
    canWithdraw: false,
    updateTime: constructorFloor + 9_999,
  });
  await syncing;
  const unavailable = account.equity();
  check(
    'sync completion rolls back against the latest floor, not only the constructor floor',
    !account.connected
      && account.lastSyncTs === null
      && /clock regressed/.test(account.lastError ?? '')
      && !unavailable.sourceFresh
      && !unavailable.complete
      && unavailable.availableUsdt === 0
      && !ledger.events.some((event) => event.kind === 'binance.connected' || event.kind === 'account_snapshot'),
  );
}

// A clock fault that appears while a signed refresh is in flight cannot
// publish a connection success, freshness timestamp, or account snapshot.
{
  const ledger = new FakeLedger();
  const t0 = Date.UTC(2026, 6, 14, 12);
  let now = t0;
  let releaseAccount;
  const accountGate = new Promise((resolve) => { releaseAccount = resolve; });
  const account = new AccountService({
    account: async () => accountGate,
    apiRestrictions: async () => ({ ...safeRestrictions }),
  }, ledger, () => 1, () => now);
  const syncing = account.sync();
  await new Promise((resolve) => setImmediate(resolve));
  now = t0 - 1;
  releaseAccount({
    balances: [{ asset: 'USDT', free: '10', locked: '0' }],
    canTrade: true,
    canWithdraw: false,
    updateTime: t0,
  });
  await syncing;
  const unavailable = account.equity();
  check(
    'in-flight account refresh fails closed when its completion clock regresses',
    !account.connected
      && account.lastSyncTs === null
      && /clock regressed/.test(account.lastError ?? '')
      && !unavailable.sourceFresh
      && unavailable.availableUsdt === 0
      && !ledger.events.some((event) => event.kind === 'binance.connected' || event.kind === 'account_snapshot'),
  );
}

// A fill pass that crosses UTC midnight after its request starts cannot stamp
// a cursor or claim completion for either day.
{
  const ledger = new FakeLedger();
  const dayTwo = Date.UTC(2026, 6, 16);
  let now = dayTwo - 1;
  let releaseTrades;
  const tradesGate = new Promise((resolve) => { releaseTrades = resolve; });
  const account = new AccountService({
    myTrades: async () => tradesGate,
  }, ledger, () => 1, () => now);
  account.setRequiredFillSymbols(['BTCUSDT']);
  const reconciling = account.reconcileFills();
  await new Promise((resolve) => setImmediate(resolve));
  now = dayTwo;
  releaseTrades([]);
  const status = await reconciling;
  check(
    'in-flight fill reconciliation cannot commit across the UTC-day boundary',
    !status.fresh
      && account.lastFillReconcileTs === null
      && ledger.getConfigValue('fill_reconcile:BTCUSDT') === null
      && !ledger.events.some((event) => event.kind === 'fill_reconciliation'),
  );
}

// A requested symbol must survive process restart even after it disappears
// from the current allowlist/watchlist/open-order/holding snapshot. Otherwise
// a same-day round trip can vanish from the next reconciliation pass.
{
  const ledger = new FakeLedger();
  const firstCalls = [];
  const first = new AccountService({
    myTrades: async (symbol) => {
      firstCalls.push(symbol);
      return [];
    },
  }, ledger, () => 1);
  first.setRequiredFillSymbols(['BTCUSDT']);
  await first.reconcileFills(['SOLUSDT']);

  const restartedCalls = [];
  const restarted = new AccountService({
    myTrades: async (symbol) => {
      restartedCalls.push(symbol);
      return [];
    },
  }, ledger, () => 1);
  restarted.setRequiredFillSymbols(['BTCUSDT']);
  const status = await restarted.reconcileFills();
  check(
    'requested fill symbols persist across restart and scope refresh',
    firstCalls.includes('SOLUSDT')
      && restartedCalls.includes('SOLUSDT')
      && status.symbols.includes('SOLUSDT')
      && status.scopeComplete,
  );
}

// A same-day restart at the exact persisted throughTs floor must resume from
// the durable trade ID rather than replaying the day's start-time window.
{
  const ledger = new FakeLedger();
  const cursorFloor = Date.UTC(2026, 6, 17, 12);
  let firstCall = true;
  const first = new AccountService({
    myTrades: async () => {
      if (!firstCall) return [];
      firstCall = false;
      return [{
        symbol: 'BTCUSDT',
        id: 41,
        orderId: 51,
        price: '100',
        qty: '0.1',
        quoteQty: '10',
        commission: '0',
        commissionAsset: 'USDT',
        time: cursorFloor,
        isBuyer: true,
      }];
    },
  }, ledger, () => 1, () => cursorFloor);
  first.setRequiredFillSymbols(['BTCUSDT']);
  await first.reconcileFills();
  const cursor = JSON.parse(ledger.getConfigValue('fill_reconcile:BTCUSDT'));
  ledger.config.delete('fill_reconcile:symbol_universe:v1');

  const optionsSeen = [];
  let restartNow = cursorFloor - 1;
  const restarted = new AccountService({
    myTrades: async (_symbol, _limit, options) => {
      optionsSeen.push(options);
      return [];
    },
  }, ledger, () => 1, () => restartNow);
  const cursorBeforeRecovery = ledger.getConfigValue('fill_reconcile:BTCUSDT');
  const regressed = restarted.fillReconciliationStatus();
  const cursorWhileRegressed = ledger.getConfigValue('fill_reconcile:BTCUSDT');
  restartNow = cursorFloor;
  const resumed = await restarted.reconcileFills();
  check(
    'same-day restart resumes at the exact durable cursor floor',
    cursor.dayStart === Date.UTC(2026, 6, 17)
      && cursor.throughTs === cursorFloor
      && cursor.lastId === 41
      && !regressed.fresh
      && /clock regressed/.test(regressed.error ?? '')
      && regressed.symbols.includes('BTCUSDT')
      && cursorBeforeRecovery !== null
      && cursorWhileRegressed === cursorBeforeRecovery
      && optionsSeen.length === 1
      && optionsSeen[0]?.fromId === 42
      && optionsSeen[0]?.startTime === undefined
      && resumed.fresh,
  );
}

// The durable registry protects the current UTC-day risk boundary, not an
// ever-growing account history. Day rollover must retire yesterday-only
// symbols so long-lived accounts do not permanently exceed the active cap.
{
  const dayTwo = Date.UTC(2026, 6, 12);
  let now = dayTwo - 1;
  const ledger = new FakeLedger();
  const calls = [];
  const account = new AccountService({
    myTrades: async (symbol) => {
      calls.push(symbol);
      return [];
    },
  }, ledger, () => 1, () => now);
  account.setRequiredFillSymbols(['BTCUSDT']);
  await account.reconcileFills(['SOLUSDT']);

  calls.length = 0;
  now = dayTwo;
  account.setRequiredFillSymbols(['BTCUSDT']);
  const status = await account.reconcileFills();
  const persisted = JSON.parse(ledger.config.get('fill_reconcile:symbol_universe:v1'));
  check(
    'injected-clock UTC-day rollover retires prior-day-only reconciliation symbols at the boundary',
    status.dayStart === dayTwo
      && status.scopeComplete
      && !status.symbols.includes('SOLUSDT')
      && calls.length === 1
      && calls[0] === 'BTCUSDT'
      && persisted.dayStart === dayTwo
      && !persisted.symbols.includes('SOLUSDT'),
  );
}

// A persisted later-day registry is a durable clock floor across restart. A
// restarted process on an earlier day must not rewrite it as a new rollover.
{
  const ledger = new FakeLedger();
  const dayTwo = Date.UTC(2026, 6, 18);
  let now = dayTwo + 12 * 60 * 60_000;
  const first = new AccountService({ myTrades: async () => [] }, ledger, () => 1, () => now);
  first.setRequiredFillSymbols(['BTCUSDT']);
  await first.reconcileFills(['SOLUSDT']);
  const durableDayTwo = ledger.getConfigValue('fill_reconcile:symbol_universe:v1');

  now = dayTwo - 1;
  const calls = [];
  const restarted = new AccountService({
    myTrades: async (symbol) => {
      calls.push(symbol);
      return [];
    },
  }, ledger, () => 1, () => now);
  const regressed = restarted.fillReconciliationStatus();
  now = dayTwo - 1;
  const stillRegressed = restarted.fillReconciliationStatus();
  check(
    'restart on an earlier UTC day preserves the durable registry and stays fenced',
    !regressed.fresh
      && !stillRegressed.fresh
      && /clock regressed/.test(regressed.error ?? '')
      && regressed.symbols.includes('SOLUSDT')
      && ledger.getConfigValue('fill_reconcile:symbol_universe:v1') === durableDayTwo,
  );

  now = dayTwo + 12 * 60 * 60_000;
  const recovered = await restarted.reconcileFills();
  check(
    'restart clock recovers only at the exact persisted cursor floor',
    recovered.fresh
      && recovered.dayStart === dayTwo
      && calls.includes('BTCUSDT')
      && calls.includes('SOLUSDT'),
  );
}

// Invalid startup time cannot erase a durable later-day registry. Once a valid
// earlier observation arrives, that registry becomes the recovery floor.
{
  const ledger = new FakeLedger();
  const durableDay = Date.UTC(2026, 6, 19);
  const durableRegistry = JSON.stringify({
    version: 1,
    dayStart: durableDay,
    symbols: ['SOLUSDT'],
  });
  ledger.config.set('fill_reconcile:symbol_universe:v1', durableRegistry);
  let now = Number.NaN;
  const calls = [];
  const account = new AccountService({
    myTrades: async (symbol) => {
      calls.push(symbol);
      return [];
    },
  }, ledger, () => 1, () => now);
  const invalidStartup = account.fillReconciliationStatus();

  now = durableDay - 1;
  account.fillReconciliationStatus();
  const belowDurableFloor = account.fillReconciliationStatus();
  check(
    'invalid startup preserves and adopts the durable UTC-day floor',
    !invalidStartup.fresh
      && /clock did not return safe epoch milliseconds/.test(invalidStartup.error ?? '')
      && !belowDurableFloor.fresh
      && /clock regressed/.test(belowDurableFloor.error ?? '')
      && belowDurableFloor.symbols.includes('SOLUSDT')
      && ledger.getConfigValue('fill_reconcile:symbol_universe:v1') === durableRegistry
      && JSON.parse(
        ledger.getConfigValue('account:clock_high_water:v1'),
      ).clockHighWaterMs === durableDay,
  );

  now = durableDay;
  const recovered = await account.reconcileFills();
  check(
    'invalid-startup clock recovers only at the durable floor',
    recovered.fresh
      && recovered.dayStart === durableDay
      && calls.length === 1
      && calls[0] === 'SOLUSDT',
  );
}

// Either independent witness may lose its one fault-time write. The surviving
// copy must still fence H-1 after restart, and startup repairs the divergence.
for (const failedKey of [
  'account:clock_high_water:v1',
  'fill_reconcile:symbol_universe:v1',
]) {
  const ledger = new FakeLedger();
  const persistedFloor = Date.UTC(2026, 6, 20, 12);
  const highWater = persistedFloor + 10_000;
  let now = persistedFloor;
  const account = new AccountService(
    { myTrades: async () => [] },
    ledger,
    () => 1,
    () => now,
  );
  account.setRequiredFillSymbols(['BTCUSDT']);
  const globalBeforeHighWater = JSON.parse(
    ledger.getConfigValue('account:clock_high_water:v1'),
  );
  const registryBeforeHighWater = JSON.parse(
    ledger.getConfigValue('fill_reconcile:symbol_universe:v1'),
  );

  now = highWater;
  account.equity();
  const setConfigValue = ledger.setConfigValue.bind(ledger);
  let injectedFailures = 0;
  let faultWriteAttempts = 0;
  ledger.setConfigValue = (key, value) => {
    if (
      key === 'account:clock_high_water:v1'
      || key === 'fill_reconcile:symbol_universe:v1'
    ) {
      faultWriteAttempts += 1;
      if (key === failedKey && injectedFailures === 0) {
        injectedFailures += 1;
        throw new Error(`injected one-shot ${failedKey} write failure`);
      }
    }
    setConfigValue(key, value);
  };

  now = highWater - 1;
  account.equity();
  const globalAfterFault = JSON.parse(
    ledger.getConfigValue('account:clock_high_water:v1'),
  );
  const registryAfterFault = JSON.parse(
    ledger.getConfigValue('fill_reconcile:symbol_universe:v1'),
  );
  const survivingHighWater =
    failedKey === 'account:clock_high_water:v1'
      ? registryAfterFault.clockHighWaterMs
      : globalAfterFault.clockHighWaterMs;
  const failedCopyHighWater =
    failedKey === 'account:clock_high_water:v1'
      ? globalAfterFault.clockHighWaterMs
      : registryAfterFault.clockHighWaterMs;
  const writesBeforeRestart = faultWriteAttempts;
  let restartProviderCalls = 0;
  const restarted = new AccountService({
    myTrades: async () => {
      restartProviderCalls += 1;
      return [];
    },
  }, ledger, () => 1, () => now);
  const restartStatus = await restarted.reconcileFills();
  const globalAfterRepair = JSON.parse(
    ledger.getConfigValue('account:clock_high_water:v1'),
  );
  const registryAfterRepair = JSON.parse(
    ledger.getConfigValue('fill_reconcile:symbol_universe:v1'),
  );
  const failedCopyName =
    failedKey === 'account:clock_high_water:v1' ? 'global witness' : 'registry witness';
  check(
    `one-shot ${failedCopyName} failure still fences restart`,
    globalBeforeHighWater.clockHighWaterMs === persistedFloor
      && registryBeforeHighWater.clockHighWaterMs === persistedFloor
      && injectedFailures === 1
      && writesBeforeRestart === 2
      && survivingHighWater === highWater
      && failedCopyHighWater === persistedFloor
      && !restartStatus.fresh
      && /clock regressed/.test(restartStatus.error ?? '')
      && restartProviderCalls === 0
      && globalAfterRepair.clockHighWaterMs === highWater
      && registryAfterRepair.clockHighWaterMs === highWater,
  );
}

// Repairing a one-shot witness failure restores the durable clock floor, but a
// no-client restart cannot manufacture new policy evidence at that floor.
{
  const ledger = new FakeLedger();
  const persistedFloor = Date.UTC(2026, 6, 20, 18);
  const highWater = persistedFloor + 10_000;
  let now = persistedFloor;
  const account = new AccountService(null, ledger, () => 1, () => now);
  const initiallyComplete = account.dailyLossPolicy().complete;

  now = highWater;
  account.equity();
  const setConfigValue = ledger.setConfigValue.bind(ledger);
  let injectedFailures = 0;
  ledger.setConfigValue = (key, value) => {
    if (key === 'account:clock_high_water:v1' && injectedFailures === 0) {
      injectedFailures += 1;
      throw new Error('injected one-shot no-client clock-witness write failure');
    }
    setConfigValue(key, value);
  };

  now = highWater - 1;
  account.equity();
  const registryAfterFault = JSON.parse(
    ledger.getConfigValue('fill_reconcile:symbol_universe:v1'),
  );
  const restarted = new AccountService(null, ledger, () => 1, () => now);
  const belowFloor = restarted.dailyLossPolicy();
  const globalAfterRepair = JSON.parse(
    ledger.getConfigValue('account:clock_high_water:v1'),
  );
  const registryAfterRepair = JSON.parse(
    ledger.getConfigValue('fill_reconcile:symbol_universe:v1'),
  );
  now = highWater;
  const restartedAtFloor = new AccountService(null, ledger, () => 1, () => now);
  const atFloorWithoutEvidence = restartedAtFloor.dailyLossPolicy();
  now = highWater + 1;
  const beyondFloorPolicy = restartedAtFloor.dailyLossPolicy();
  const ordinaryNoClientStatus = restartedAtFloor.fillReconciliationStatus();
  check(
    'no-client restart cannot re-green daily-loss policy without post-fault evidence',
    initiallyComplete
      && injectedFailures === 1
      && registryAfterFault.clockHighWaterMs === highWater
      && globalAfterRepair.clockHighWaterMs === highWater
      && registryAfterRepair.clockHighWaterMs === highWater
      && !belowFloor.complete
      && belowFloor.reasons.some((reason) => /clock regressed/.test(reason))
      && !atFloorWithoutEvidence.complete
      && atFloorWithoutEvidence.reasons.some(
        (reason) => /must advance beyond its durable high-water/.test(reason),
      )
      && !atFloorWithoutEvidence.reasons.some((reason) => /clock regressed/.test(reason))
      && beyondFloorPolicy.complete
      && ordinaryNoClientStatus.complete
      && ordinaryNoClientStatus.scopeComplete
      && ordinaryNoClientStatus.fresh
      && ordinaryNoClientStatus.coverageScope === 'not_applicable'
      && ordinaryNoClientStatus.accountWide === null
      && ordinaryNoClientStatus.error === null,
  );
}

// A detected rollback durably fences the exact volatile high-water. A
// just-after-midnight fill then survives a crash and joins the next-day scope.
{
  const ledger = new FakeLedger();
  const persistedFloor = Date.UTC(2026, 6, 20, 23, 59);
  const highWater = Date.UTC(2026, 6, 20, 23, 59, 59, 999);
  const restartClock = Date.UTC(2026, 6, 20, 23, 59, 30);
  const futureFillTs = Date.UTC(2026, 6, 21, 0, 0, 1);
  let now = persistedFloor;
  const calls = [];
  const account = new AccountService({
    myTrades: async (symbol) => {
      calls.push(symbol);
      return [];
    },
  }, ledger, () => 1, () => now);
  account.setRequiredFillSymbols(['BTCUSDT']);
  await account.reconcileFills();

  now = highWater;
  account.equity();
  const futureRegistryBeforeFault = JSON.parse(
    ledger.getConfigValue('fill_reconcile:symbol_universe:v1'),
  );
  now = restartClock;
  const faultFill = {
    symbol: 'SOLUSDT',
    tradeId: 61,
    orderId: 71,
    side: 'BUY',
    price: '100',
    qty: '0.1',
    quoteQty: '10',
    commission: '0',
    commissionAsset: 'USDT',
    ts: futureFillTs,
    source: 'user_stream',
  };
  const accepted = account.recordFill(faultFill);
  const durableDuringFault = JSON.parse(
    ledger.getConfigValue('fill_reconcile:symbol_universe:v1'),
  );
  check(
    'future-day clock fault retains the accepted fill symbol without premature persistence',
    accepted
      && ledger.fills.some((fill) => fill.symbol === 'SOLUSDT' && fill.tradeId === 61)
      && futureRegistryBeforeFault.clockHighWaterMs === persistedFloor
      && durableDuringFault.clockHighWaterMs === highWater
      && !futureRegistryBeforeFault.symbols.includes('SOLUSDT')
      && !durableDuringFault.symbols.includes('SOLUSDT'),
  );

  const restartCalls = [];
  const restarted = new AccountService({
    myTrades: async (symbol) => {
      restartCalls.push(symbol);
      return [];
    },
  }, ledger, () => 1, () => now);
  restarted.setRequiredFillSymbols(['BTCUSDT']);
  const restartRegressed = restarted.fillReconciliationStatus();
  const registryWhileRestartFenced = JSON.parse(
    ledger.getConfigValue('fill_reconcile:symbol_universe:v1'),
  );
  now = highWater;
  const recoveredAtFloor = restarted.fillReconciliationStatus();
  now = futureFillTs;
  const recovered = await restarted.reconcileFills();
  const durableAfterRecovery = JSON.parse(
    ledger.getConfigValue('fill_reconcile:symbol_universe:v1'),
  );
  check(
    'future-day fault fill symbol survives restart into durable scope',
    !restartRegressed.fresh
      && /clock regressed/.test(restartRegressed.error ?? '')
      && !recoveredAtFloor.fresh
      && registryWhileRestartFenced.clockHighWaterMs === highWater
      && !registryWhileRestartFenced.symbols.includes('SOLUSDT')
      && recovered.fresh
      && recovered.symbols.includes('SOLUSDT')
      && restartCalls.includes('SOLUSDT')
      && durableAfterRecovery.dayStart === Date.UTC(2026, 6, 21)
      && durableAfterRecovery.clockHighWaterMs === futureFillTs
      && durableAfterRecovery.symbols.includes('SOLUSDT'),
  );
}

// Ledger-observed/user-stream fills are a second durable recovery source. A
// damaged registry must fail closed instead of being silently replaced.
{
  const ledger = new FakeLedger();
  const source = new AccountService(null, ledger, () => 1);
  source.recordFill({
    symbol: 'ETHUSDT', tradeId: 1, orderId: 2, side: 'BUY', price: '100', qty: '1',
    quoteQty: '100', commission: '0', commissionAsset: 'USDT', ts: Date.now(), source: 'user_stream',
  });
  ledger.config.delete('fill_reconcile:symbol_universe:v1');
  const recovered = new AccountService({ myTrades: async () => [] }, ledger, () => 1);
  check('ledger-observed fill symbols repair a missing durable registry', recovered.fillReconciliationStatus().symbols.includes('ETHUSDT'));

  ledger.config.set('fill_reconcile:symbol_universe:v1', JSON.stringify({ version: 1, symbols: ['NOT_USDT'] }));
  const corrupted = new AccountService({ myTrades: async () => [] }, ledger, () => 1);
  const status = await corrupted.reconcileFills();
  check(
    'invalid persisted fill-symbol scope fails closed explicitly',
    !status.scopeComplete && /persisted fill-symbol universe/.test(status.error ?? ''),
  );

  const clockWitnessLedger = new FakeLedger();
  const clockWitnessNow = Date.UTC(2026, 6, 22, 12);
  new AccountService(null, clockWitnessLedger, () => 1, () => clockWitnessNow);
  const malformedClockWitness = JSON.stringify({
    version: 1,
    clockHighWaterMs: clockWitnessNow,
    unsupported: true,
  });
  clockWitnessLedger.config.set('account:clock_high_water:v1', malformedClockWitness);
  const corruptedClockWitness = new AccountService(
    null,
    clockWitnessLedger,
    () => 1,
    () => clockWitnessNow,
  );
  const corruptedClockStatus = corruptedClockWitness.fillReconciliationStatus();
  check(
    'invalid persisted clock witness fails closed without overwrite',
    !corruptedClockStatus.fresh
      && /persisted account clock high-water witness/.test(corruptedClockStatus.error ?? '')
      && clockWitnessLedger.getConfigValue('account:clock_high_water:v1') === malformedClockWitness,
  );

  const capped = new AccountService({ myTrades: async () => [] }, new FakeLedger(), () => 1);
  capped.setRequiredFillSymbols(Array.from({ length: 51 }, (_, index) => `T${index}USDT`));
  const cappedStatus = await capped.reconcileFills();
  check(
    'active fill-reconciliation cap fails closed explicitly',
    !cappedStatus.scopeComplete && /exceeds 50 symbols/.test(cappedStatus.error ?? ''),
  );
}

// Valid international asset identifiers survive the account boundary as
// explicitly unpriced holdings instead of disconnecting the whole snapshot.
{
  const client = {
    account: async () => ({ balances: [{ asset: '国際資産', free: '1', locked: '0' }], canTrade: true, canWithdraw: false }),
    apiRestrictions: async () => ({ ...safeRestrictions }),
  };
  const account = new AccountService(client, new FakeLedger(), () => null);
  await account.sync();
  check('bounded international assets remain visible and unpriced', account.connected && account.equity().unpricedAssets.includes('国際資産'));
}

// A later signed-account failure clears an earlier API-key posture rather than
// continuing to show or admit against stale permissions.
{
  let fail = false;
  const client = {
    account: async () => {
      if (fail) throw new Error('signed account unavailable');
      return { balances: [{ asset: 'USDT', free: '1', locked: '0' }], canTrade: true, canWithdraw: false };
    },
    apiRestrictions: async () => ({ ...safeRestrictions }),
  };
  const account = new AccountService(client, new FakeLedger(), () => 1);
  await account.sync();
  const hadPosture = account.keyRestrictions !== null && account.lastRestrictionsTs !== null;
  fail = true;
  await account.sync();
  check('account failure clears stale key posture', hadPosture && !account.connected && account.keyRestrictions === null && account.lastRestrictionsTs === null);
}

// An ambiguous submit self-reconciles by deterministic client order ID and
// writes the correlated response that releases the risk latch.
{
  const ledger = new FakeLedger();
  let lookupId = null;
  const client = {
    openOrders: async () => [],
    placeOrder: async () => { throw new Error('socket closed after write'); },
    queryOrder: async (_symbol, clientOrderId) => {
      lookupId = clientOrderId;
      return {
        symbol: 'BTCUSDT', orderId: 88, clientOrderId, status: 'NEW',
        executedQty: '0', cummulativeQuoteQty: '0',
      };
    },
  };
  const { service } = orderService({ client, ledger });
  const result = await service.send(
    { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, source: 'manual' },
    'BTCUSDT',
  );
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const reconciled = ledger.events.find((event) => event.kind === 'order_response' && event.data?.reconciliationSource === 'query_order');
  check('unknown order returns conservatively before reconciliation', result.outcome === 'unknown' && result.reconciliationRequired === true);
  check('unknown order self-reconciles by client order ID', typeof lookupId === 'string' && reconciled?.data?.clientOrderId === lookupId);
}

// A response for the wrong client order can never resolve the reservation,
// even when its numeric order ID and status otherwise look valid.
{
  const client = {
    openOrders: async () => [],
    placeOrder: async (params) => ({ ...acceptedOrder(91, params.newClientOrderId), clientOrderId: 'wrong-order' }),
    queryOrder: async (_symbol, clientOrderId) => ({
      symbol: 'BTCUSDT', orderId: 91, clientOrderId, status: 'NEW', executedQty: '0', cummulativeQuoteQty: '0',
    }),
  };
  const { service } = orderService({ client });
  const result = await service.send(
    { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, source: 'manual' },
    'BTCUSDT',
  );
  check('mismatched order acknowledgement remains unknown', result.outcome === 'unknown' && result.reconciliationRequired === true);
}

// Recovery scheduling wraps around a persisted request-id cursor, held rows
// remain visible/fail-closed without being auto-queried, and explicit operator
// outcomes are auditable rather than silently manufactured as success.
{
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-order-recovery-'));
  const store = new Ledger(dataDir);
  const reservationId = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const clientOrderId = (index) => `c${String(index).padStart(32, '0')}`;
  try {
    for (let index = 1; index <= 45; index += 1) {
      store.logEvent('order_request', 'BTCUSDT', {
        reservationId: reservationId(index),
        reservedNotionalUsd: 10,
        params: { newClientOrderId: clientOrderId(index) },
        source: 'manual',
      });
    }
    const queried = [];
    const client = {
      openOrders: async () => [],
      queryOrder: async (_symbol, id) => {
        queried.push(id);
        throw new BinanceApiError(400, -2013, 'Order does not exist');
      },
    };
    let { service } = orderService({ client, ledger: store });
    const held = await service.resolveOrderRecovery({
      reservationId: reservationId(1),
      clientOrderId: clientOrderId(1),
      action: 'hold',
      confirm: `HOLD ${reservationId(1)}`,
      reason: 'Operator is collecting independent Binance evidence.',
      operator: 'operator@example.com',
    });
    await service.reconcilePendingOrders();
    ({ service } = orderService({ client, ledger: store }));
    await service.reconcilePendingOrders();
    ({ service } = orderService({ client, ledger: store }));
    await service.reconcilePendingOrders();
    const queriedSet = new Set(queried);
    check('persisted fair recovery cursor reaches requests beyond a permanent oldest batch after restarts', queriedSet.has(clientOrderId(45)) && [...Array(44)].every((_, offset) => queriedSet.has(clientOrderId(offset + 2))));
    check('operator hold remains visible and suppresses automatic lookup', held.ok && !queriedSet.has(clientOrderId(1)) && service.pendingOrderRecoveries(100).find((row) => row.reservationId === reservationId(1))?.recoveryState === 'held_by_operator');
    const operatorPage = service.pendingOrderRecoveries(10, 20);
    check('operator recovery pagination advances without wrapping to the oldest rows', operatorPage[0]?.requestId === 21 && service.pendingOrderRecoveries(10, 45).length === 0);

    const wrongConfirmation = await service.resolveOrderRecovery({
      reservationId: reservationId(1),
      clientOrderId: clientOrderId(1),
      action: 'confirm_not_sent',
      confirm: 'wrong',
      reason: 'Binance order history and fills were checked independently.',
      operator: 'operator@example.com',
    });
    const resolvedNotSent = await service.resolveOrderRecovery({
      reservationId: reservationId(1),
      clientOrderId: clientOrderId(1),
      action: 'confirm_not_sent',
      confirm: `CONFIRM NOT SENT ${reservationId(1)}`,
      reason: 'Binance order history and fills were checked independently.',
      operator: 'operator@example.com',
    });
    const notSentResponse = store.eventsSince(0, 'order_response').find((event) => event.data?.reservationId === reservationId(1));
    check('operator resolution requires exact typed confirmation', !wrongConfirmation.ok && resolvedNotSent.ok);
    check('confirmed non-send is explicit, audited, and releases only that reservation', notSentResponse?.data?.outcome === 'not_sent_operator_verified' && notSentResponse?.data?.reservationReleased === true && !service.pendingOrderRecoveries(100).some((row) => row.reservationId === reservationId(1)));

    store.logEvent('order_request', 'BTCUSDT', {
      reservationId: reservationId(46),
      reservedNotionalUsd: 25,
      params: { newClientOrderId: clientOrderId(46) },
      source: 'manual',
    });
    const resolvedAccepted = await service.resolveOrderRecovery({
      reservationId: reservationId(46),
      clientOrderId: clientOrderId(46),
      action: 'confirm_accepted',
      confirm: `CONFIRM ACCEPTED ${reservationId(46)}`,
      reason: 'Binance order history shows the exact filled order and totals.',
      operator: 'operator@example.com',
      orderId: 460,
      status: 'FILLED',
      executedQty: 0.25,
      executedQuoteUsd: 25,
    });
    const acceptedResponse = store.eventsSince(0, 'order_response').find((event) => event.data?.reservationId === reservationId(46));
    check('accepted operator recovery stays conservative and never claims generic success', resolvedAccepted.ok && acceptedResponse?.data?.outcome === 'accepted_operator_verified' && acceptedResponse?.data?.reservationReleased === false);

    store.logEvent('order_request', 'BTCUSDT', {
      reservationId: reservationId(47),
      reservedNotionalUsd: 30,
      params: { newClientOrderId: clientOrderId(47) },
      source: 'manual',
    });
    const staleAccount = accountStub({
      reconcileFills: async () => ({
        complete: false,
        scopeComplete: false,
        fresh: false,
        reconciledAt: null,
        dayStart: Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
        symbols: ['BTCUSDT'],
        coverageScope: 'configured_and_observed_symbols',
        accountWide: false,
        limitation: 'symbol-scoped',
        error: 'signed fills unavailable',
      }),
    });
    const staleClient = {
      openOrders: async () => { throw new Error('signed open orders unavailable'); },
      queryOrder: client.queryOrder,
    };
    const { service: staleService } = orderService({ client: staleClient, ledger: store, account: staleAccount });
    const resolvedWithWarning = await staleService.resolveOrderRecovery({
      reservationId: reservationId(47),
      clientOrderId: clientOrderId(47),
      action: 'confirm_accepted',
      confirm: `CONFIRM ACCEPTED ${reservationId(47)}`,
      reason: 'Binance order history shows the exact accepted open order.',
      operator: 'operator@example.com',
      orderId: 470,
      status: 'NEW',
      executedQty: 0,
      executedQuoteUsd: 0,
    });
    check('accepted recovery refresh failure stays durable and explicitly visible', resolvedWithWarning.ok && resolvedWithWarning.reconciliationRequired === true && /refresh remains incomplete/.test(resolvedWithWarning.warning ?? '') && store.eventsSince(0, 'error_event').some((event) => event.data?.source === 'order.operator_recovery_refresh'));
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

// Corrupt durable financial evidence must never be projected as proof that
// local mutation authority is absent. Direct SQL simulates legacy/on-disk
// corruption that bypasses current write-boundary validation.
{
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-mutation-authority-'));
  const store = new Ledger(dataDir);
  try {
    const clean = store.readDurableMutationAuthority();
    check(
      'clean financial evidence can prove local mutation authority absent',
      clean.posture === 'PROVEN_ABSENT'
        && clean.unresolvedOrderCount === 0
        && clean.unresolvedLoanCount === 0
        && clean.malformedOrderRowCount === 0
        && clean.malformedLoanRowCount === 0
        && clean.readErrorCount === 0,
    );

    let malformedOrderRejected = false;
    let malformedLoanRejected = false;
    try {
      store.logEvent('order_request', 'BTCUSDT', { reservationId: 'missing-required-fields' });
    } catch {
      malformedOrderRejected = true;
    }
    try {
      store.logEvent('loan_request', null, { mutationId: 'missing-required-fields' });
    } catch {
      malformedLoanRejected = true;
    }
    check(
      'financial mutation writes reject malformed requests before commit',
      malformedOrderRejected && malformedLoanRejected,
    );

    const insertRaw = store.db.prepare(
      'INSERT INTO events (ts, kind, symbol, data, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    const corruptOrderTs = Date.now();
    insertRaw.run(corruptOrderTs, 'order_request', 'BTCUSDT', '{broken', corruptOrderTs);
    const corruptLoanTs = Date.now();
    insertRaw.run(corruptLoanTs, 'loan_request', null, JSON.stringify({
      mutationId: 'legacy-corrupt-loan',
      riskIncreasing: true,
    }), corruptLoanTs);

    const corrupt = store.readDurableMutationAuthority();
    check(
      'corrupt order and loan rows fail closed instead of proving absence',
      corrupt.posture === 'AMBIGUOUS'
        && corrupt.malformedOrderRowCount === 1
        && corrupt.malformedLoanRowCount === 1
        && corrupt.readErrorCount === 0,
      JSON.stringify(corrupt),
    );

    store.close();
    const unreadable = store.readDurableMutationAuthority();
    check(
      'financial mutation read failures remain unknown',
      unreadable.posture === 'UNKNOWN' && unreadable.readErrorCount === 1,
    );
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} financial safety checks passed.`);
if (failed.length > 0) process.exitCode = 1;

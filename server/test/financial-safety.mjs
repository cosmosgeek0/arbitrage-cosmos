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
    this.fills.push({ ...fill });
    return true;
  }

  allFillsAsc() {
    return [...this.fills].sort((left, right) => left.ts - right.ts);
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
  account.recordFill({ symbol: 'BTCUSDT', tradeId: 1, orderId: 1, side: 'BUY', price: 100, qty: 1, quoteQty: 100, commission: 0, commissionAsset: 'USDT', ts: now - 1_000, source: 'test' });
  account.pnl();
  account.recordFill({ symbol: 'BTCUSDT', tradeId: 2, orderId: 2, side: 'SELL', price: 90, qty: 1, quoteQty: 90, commission: 1, commissionAsset: 'USDT', ts: now, source: 'import' });
  check('fill import invalidates an already-built PnL cache', account.realizedTodayUsd() === -10);
  const policy = account.dailyLossPolicy();
  check('daily-loss policy deducts valued fees', policy.complete && policy.valueUsd === -11);
}

// Selling inventory with no ledgered acquisition basis must not be interpreted
// as zero PnL for policy admission.
{
  const ledger = new FakeLedger();
  const account = new AccountService(null, ledger, () => 100);
  account.recordFill({ symbol: 'BTCUSDT', tradeId: 3, orderId: 3, side: 'SELL', price: 100, qty: 1, quoteQty: 100, commission: 0, commissionAsset: 'USDT', ts: Date.now(), source: 'test' });
  const policy = account.dailyLossPolicy();
  check('unknown sell basis makes daily-loss policy incomplete', !policy.complete && policy.reasons.some((reason) => /cost basis unavailable/.test(reason)));
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
    symbol: 'BTCUSDC', tradeId: 99, orderId: 99, side: 'BUY', price: 100, qty: 1,
    quoteQty: 100, commission: 0, commissionAsset: 'USDC', ts: Date.now(), source: 'test',
  });
  check('non-USDT fills are rejected from USDT PnL', rejected === false && ledger.fills.every((fill) => fill.symbol !== 'BTCUSDC'));
}

// A REST snapshot started before a newer private-stream update must not roll
// the account balance backward when it eventually resolves.
{
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const now = Date.now();
  const client = {
    account: async () => {
      await gate;
      return {
        balances: [{ asset: 'USDT', free: '1', locked: '0' }],
        canTrade: true,
        canWithdraw: false,
        updateTime: now,
      };
    },
    apiRestrictions: async () => ({ ...safeRestrictions }),
  };
  const account = new AccountService(client, new FakeLedger(), () => 1);
  const syncing = account.sync();
  await new Promise((resolve) => setImmediate(resolve));
  account.applyStreamBalances([{ a: 'USDT', f: '2', l: '0' }], now + 2);
  release();
  await syncing;
  check('newer stream balance survives an older in-flight REST snapshot', account.equity().availableUsdt === 2);
account.applyStreamBalances([{ a: 'USDT', f: '0.5', l: '0' }], now + 1);
  check('out-of-order stream balance update is ignored', account.equity().availableUsdt === 2);
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
        symbol: 'BTCUSDT', id: 10, orderId: 20, price: '100', qty: '0.1', quoteQty: '10',
        commission: '0', commissionAsset: 'USDT', time: Date.now(), isBuyer: true,
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
  check('REST reconciliation records authoritative fills exactly once', ledger.fills.length === 1 && ledger.fills[0].source === 'rest_reconciliation');
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

// The durable registry protects the current UTC-day risk boundary, not an
// ever-growing account history. Day rollover must retire yesterday-only
// symbols so long-lived accounts do not permanently exceed the active cap.
{
  const realNow = Date.now;
  const dayOne = Date.UTC(2026, 6, 11);
  const dayTwo = dayOne + 24 * 60 * 60 * 1_000;
  try {
    let now = dayOne + 12 * 60 * 60 * 1_000;
    Date.now = () => now;
    const ledger = new FakeLedger();
    const calls = [];
    const account = new AccountService({
      myTrades: async (symbol) => {
        calls.push(symbol);
        return [];
      },
    }, ledger, () => 1);
    account.setRequiredFillSymbols(['BTCUSDT']);
    await account.reconcileFills(['SOLUSDT']);

    calls.length = 0;
    now = dayTwo + 12 * 60 * 60 * 1_000;
    account.setRequiredFillSymbols(['BTCUSDT']);
    const status = await account.reconcileFills();
    const persisted = JSON.parse(ledger.config.get('fill_reconcile:symbol_universe:v1'));
    check(
      'UTC-day rollover retires yesterday-only reconciliation symbols',
      status.dayStart === dayTwo
        && status.scopeComplete
        && !status.symbols.includes('SOLUSDT')
        && calls.length === 1
        && calls[0] === 'BTCUSDT'
        && persisted.dayStart === dayTwo
        && !persisted.symbols.includes('SOLUSDT'),
    );
  } finally {
    Date.now = realNow;
  }
}

// Ledger-observed/user-stream fills are a second durable recovery source. A
// damaged registry must fail closed instead of being silently replaced.
{
  const ledger = new FakeLedger();
  const source = new AccountService(null, ledger, () => 1);
  source.recordFill({
    symbol: 'ETHUSDT', tradeId: 1, orderId: 2, side: 'BUY', price: 100, qty: 1,
    quoteQty: 100, commission: 0, commissionAsset: 'USDT', ts: Date.now(), source: 'user_stream',
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

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} financial safety checks passed.`);
if (failed.length > 0) process.exitCode = 1;

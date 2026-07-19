#!/usr/bin/env node
/**
 * Per-gate negative coverage for every named RiskService check. Each row
 * constructs the minimal config/context that should trip exactly that gate,
 * asserts admission is refused, and asserts the refusal names that gate —
 * asserting only `allowed === false` would pass if a different gate fired.
 * Zero network; run after the server build:
 *   node server/test/risk-gates.mjs
 */
import { EventEmitter } from 'node:events';
import { RiskService } from '../dist/services/risk.js';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

class FakeLedger extends EventEmitter {
  events = [];

  logEvent(kind, symbol = null, data = null) {
    const event = { id: this.events.length + 1, ts: Date.now(), kind, symbol, data };
    this.events.push(event);
    return event;
  }

  eventsSince(ts, kind) {
    return this.events.filter((event) => event.ts >= ts && event.kind === kind);
  }

  lastEvent(kind) {
    return [...this.events].reverse().find((event) => event.kind === kind) ?? null;
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
    )).length; // the durable Ledger returns a count, not rows
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
    blockedSymbols: ['DOGEUSDT'],
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    estNotionalUsd: 20,
    openOrdersCount: 0,
    realizedTodayUsd: 0,
    pendingOpenOrdersNotionalUsd: 0,
    ...overrides,
  };
}

function intent(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    quoteQty: 20,
    source: 'manual',
    ...overrides,
  };
}

// gate | config | context | intent | opts | optional ledger seeding
const NEGATIVE_ROWS = [
  ['risk_config_valid', { maxOrderNotionalUsd: -1 }, {}, {}, { forLiveSend: true }, null],
  ['order_intent_valid', {}, {}, { side: 'HOLD' }, { forLiveSend: true }, null],
  ['kill_switch_off', { killSwitch: true }, {}, {}, { forLiveSend: true }, null],
  ['funds_access_unlocked', { fundsLocked: true }, {}, {}, { forLiveSend: true }, null],
  ['automation_running', { automationPaused: true }, {}, { source: 'proposal' }, { forLiveSend: true }, null],
  ['live_trading_enabled', { liveTradingEnabled: false }, {}, {}, { forLiveSend: true }, null],
  ['symbol_allowed', {}, {}, { symbol: 'ETHUSDT' }, { forLiveSend: true }, null],
  [
    'symbol_not_blocked',
    { allowedSymbols: ['BTCUSDT', 'DOGEUSDT'] },
    {},
    { symbol: 'DOGEUSDT' },
    { forLiveSend: true },
    null,
  ],
  ['notional_known', {}, { estNotionalUsd: null }, {}, { forLiveSend: true }, null],
  ['max_order_notional', { maxOrderNotionalUsd: 10 }, {}, {}, { forLiveSend: true }, null],
  [
    'daily_notional_state_known',
    {},
    { pendingOpenOrdersNotionalUsd: Number.NaN },
    {},
    { forLiveSend: true },
    null,
  ],
  ['max_daily_notional', { maxDailyNotionalUsd: 10 }, {}, {}, { forLiveSend: true }, null],
  ['max_open_orders', {}, { openOrdersCount: 10 }, {}, { forLiveSend: true }, null],
  [
    'cooldown',
    { cooldownSec: 3_600 },
    {},
    {},
    { forLiveSend: true },
    (ledger) => {
      ledger.logEvent('order_request', 'BTCUSDT', { reservationId: 'cool-1', reservedNotionalUsd: 5 });
    },
  ],
  ['daily_loss_basis_known', {}, { dailyLossPolicyComplete: false }, {}, { forLiveSend: true }, null],
  ['daily_loss_limit', {}, { realizedTodayUsd: -200 }, {}, { forLiveSend: true }, null],
];

console.log('risk gate negative coverage (one tripped gate per row):');
for (const [gate, configOverrides, contextOverrides, intentOverrides, opts, seed] of NEGATIVE_ROWS) {
  const ledger = new FakeLedger();
  seed?.(ledger);
  const risk = new RiskService(config(configOverrides), ledger);
  const decision = risk.evaluate(intent(intentOverrides), context(contextOverrides), opts);
  const named = decision.checks.find((row) => row.name === gate);
  check(`${gate}: refuses admission`, decision.allowed === false);
  check(
    `${gate}: the refusal names this gate`,
    named !== undefined && named.pass === false
      && decision.reasons.some((reason) => reason.startsWith(`${gate}:`)),
    JSON.stringify(decision.reasons),
  );
}

console.log('all sixteen gates pass together:');
{
  const ledger = new FakeLedger();
  const risk = new RiskService(config(), ledger);
  const decision = risk.evaluate(intent(), context(), { forLiveSend: true });
  check('a clean live send is admitted', decision.allowed === true, JSON.stringify(decision.reasons));
  check('no check reports failure on the clean path', decision.checks.every((row) => row.pass === true));

  const proposalDecision = risk.evaluate(
    intent({ source: 'proposal' }),
    context(),
    { forLiveSend: true },
  );
  check(
    'the proposal path additionally evaluates automation_running',
    proposalDecision.allowed === true
      && proposalDecision.checks.some((row) => row.name === 'automation_running' && row.pass === true),
  );
}

// Sixteen negative rows at two assertions each, plus three positive checks. A
// section that stops executing must not print PASS with a shrunken total.
const EXPECTED_CHECKS = NEGATIVE_ROWS.length * 2 + 3;
if (results.length !== EXPECTED_CHECKS) {
  console.error(`RISK_GATE_CHECK_COUNT_DRIFT:${results.length}:EXPECTED_${EXPECTED_CHECKS}`);
  process.exitCode = 1;
}
const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} risk gate checks passed.`);
if (failed.length > 0) process.exitCode = 1;

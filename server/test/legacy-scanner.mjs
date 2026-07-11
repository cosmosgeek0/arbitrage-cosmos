#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { Scanner } from '../dist/engine/scanner.js';

class FakeLedger {
  nextId = 1;
  signals = new Map();
  events = [];

  openSignal(signal) {
    const id = this.nextId++;
    this.signals.set(id, { id, ...signal, closedTs: null, basisClose: null });
    return id;
  }

  updateSignalPeak(id, basisPeak) {
    const signal = this.signals.get(id);
    if (signal) signal.basisPeak = basisPeak;
  }

  closeSignal(id, closedTs, basisClose) {
    const signal = this.signals.get(id);
    assert.ok(signal, `signal ${id} exists`);
    signal.closedTs = closedTs;
    signal.basisClose = basisClose;
  }

  logEvent(kind, symbol, data) {
    const event = { id: this.events.length + 1, ts: Date.now(), kind, symbol, data };
    this.events.push(event);
    return event;
  }
}

function config(overrides = {}) {
  return {
    feesPct: 0.3,
    minNetBasisPct: 0.2,
    persistTicks: 2,
    minQuoteVolume24h: 1_000_000,
    ...overrides,
  };
}

function marketRow(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    base: 'BTC',
    spot: 100,
    perpMark: 101,
    basisPct: 1,
    fundingRate: 0.0001,
    nextFundingTime: Date.now() + 3_600_000,
    change24hPct: 1,
    quoteVolume24h: 25_000_000,
    high24h: 102,
    low24h: 98,
    status: 'idle',
    ...overrides,
  };
}

function harness(overrides = {}) {
  const ledger = new FakeLedger();
  const scanner = new Scanner(config(overrides), ledger);
  return { ledger, scanner };
}

function openProposal(scanner, row = marketRow()) {
  scanner.tick([row]);
  scanner.tick([row]);
  const proposal = scanner.proposals()[0];
  assert.ok(proposal, 'proposal opened after the persistence gate');
  return proposal;
}

function closure(ledger, id) {
  return ledger.events.find((event) => (
    event.kind === 'strategy_signal' &&
    event.data?.action === 'closed' &&
    event.data?.id === id
  ));
}

test('removed symbols close and de-list proposals before they can be approved', () => {
  const { ledger, scanner } = harness();
  const proposal = openProposal(scanner);

  scanner.tick([]);

  assert.equal(scanner.proposals().find((item) => item.id === proposal.id), undefined);
  assert.equal(scanner.statusOf(proposal.symbol), 'idle');
  assert.equal(scanner.watchingCount(), 0);
  assert.ok(ledger.signals.get(proposal.id)?.closedTs);
  assert.equal(closure(ledger, proposal.id)?.data.reason, 'symbol_removed');

  scanner.tick([]);
  assert.equal(
    ledger.events.filter((event) => event.data?.id === proposal.id && event.data?.action === 'closed').length,
    1,
    'repeated empty ticks do not duplicate the closure',
  );
});

test('stale evidence immediately expires a proposal and resets persistence', () => {
  const { ledger, scanner } = harness();
  const fresh = marketRow();
  const proposal = openProposal(scanner, fresh);

  scanner.tick([marketRow({ spot: null, perpMark: null, basisPct: null })]);

  assert.equal(scanner.proposals().length, 0);
  assert.equal(closure(ledger, proposal.id)?.data.closureReason, 'evidence_stale');
  assert.equal(ledger.signals.get(proposal.id)?.basisClose, proposal.basisNow);

  scanner.tick([fresh]);
  assert.equal(scanner.proposals().length, 0, 'one fresh tick cannot reuse pre-stale persistence');
  assert.equal(scanner.statusOf(fresh.symbol), 'watching');
  scanner.tick([fresh]);
  assert.equal(scanner.proposals().length, 1, 'fresh evidence may open a new proposal normally');
  assert.notEqual(scanner.proposals()[0].id, proposal.id);
});

test('liquidity ineligibility expires proposals and resets watcher-only state', () => {
  const { ledger, scanner } = harness();
  const proposal = openProposal(scanner);

  scanner.tick([marketRow({ quoteVolume24h: 999_999 })]);

  assert.equal(scanner.proposals().length, 0);
  assert.equal(closure(ledger, proposal.id)?.data.reason, 'symbol_ineligible');

  scanner.tick([marketRow()]);
  assert.equal(scanner.statusOf('BTCUSDT'), 'watching');
  scanner.tick([marketRow({ quoteVolume24h: null })]);
  assert.equal(scanner.statusOf('BTCUSDT'), 'idle');
  assert.equal(scanner.watchingCount(), 0);
  assert.ok(ledger.events.some((event) => (
    event.kind === 'strategy_signal' &&
    event.symbol === 'BTCUSDT' &&
    event.data?.action === 'watch_reset' &&
    event.data?.reason === 'symbol_ineligible'
  )));
});

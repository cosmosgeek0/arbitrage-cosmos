#!/usr/bin/env node
/**
 * M1-P1 — accepted-proposal Basis handoff lifecycle. ZERO network, ZERO timers:
 * every case drives the BUILT engine through the scripted replay harness on a
 * ManualClock, then exercises the acceptance + handoff seam directly. The
 * runtime case constructs BasisRuntime with a ledger and a fetch that THROW if
 * touched, so "no effect" is proved by failure, not by assertion prose.
 *
 * Fill truth is a canonical non-negative exact-decimal STRING of base quantity.
 * It is never a number and never comparable to the accepted USD notional.
 *
 * Run after `npm run build -w server`:
 *   node --test --test-concurrency=1 server/test/m1/basis-handoff-lifecycle.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createReplayHarness } from '../../dist/engine/basis/index.js';
import { BasisHandoffLifecycle } from '../../dist/engine/basis/lifecycle.js';
import { BasisRuntime } from '../../dist/services/basisRuntime.js';

const T0 = 1_000_000;
const SYM = 'TESTUSDT';
const CFG = { persistTicks: 3 };

/** The complete, exhaustive shape of a handoff record — no claim fields exist. */
const RECORD_KEYS = [
  'handoffId', 'proposalId', 'correlationId', 'symbol', 'direction',
  'acceptedBy', 'acceptedTs', 'acceptedRevisionTs', 'acceptedNetEdgePct', 'acceptedNotionalUsd',
  'boundTs', 'state', 'terminalKind', 'terminalTs',
  'cumulativeFilledQuantity', 'lastSequence', 'lastObservedAtMs', 'ambiguousObservations',
].sort();

// ---------- market fixtures (same shape the engine proof uses) ----------

function meta(symbol = SYM) {
  return {
    symbol,
    base: symbol.replace('USDT', ''),
    quote: 'USDT',
    hasSpot: true,
    hasPerp: true,
    marginBorrowable: null,
    minNotionalUsd: 5,
    tickSize: 0.01,
    stepSize: 0.001,
    quoteVolume24hUsd: 50_000_000,
    eligible: true,
    ineligibleReason: null,
  };
}

function marketStep(atMs, o = {}) {
  const spotBid = o.spotBid ?? 100.0;
  const spotAsk = o.spotAsk ?? 100.02;
  const perpBid = o.perpBid ?? 100.8;
  const perpAsk = o.perpAsk ?? 100.82;
  const mark = (perpBid + perpAsk) / 2;
  const qty = 500;
  return {
    atMs,
    events: [
      { type: 'spotBook', tick: { symbol: SYM, bid: spotBid, ask: spotAsk, bidQty: qty, askQty: qty, ts: atMs } },
      { type: 'perpBook', tick: { symbol: SYM, bid: perpBid, ask: perpAsk, bidQty: qty, askQty: qty, ts: atMs } },
      {
        type: 'markFunding',
        tick: { symbol: SYM, markPrice: mark, fundingRate: 0.0001, nextFundingTs: atMs + 4 * 3_600_000, ts: atMs },
      },
      { type: 'spotDepth', ladder: { symbol: SYM, bids: [[spotBid, qty]], asks: [[spotAsk, qty]], ts: atMs } },
      { type: 'perpDepth', ladder: { symbol: SYM, bids: [[perpBid, qty]], asks: [[perpAsk, qty]], ts: atMs } },
    ],
  };
}

/** Steady 0.78% executable gap, one step every 2s, tick k at T0 + 2000·k. */
function gapSteps(count, startTick = 1) {
  const spotAsk = 100.02;
  const perpBid = spotAsk * 1.0078;
  return Array.from({ length: count }, (_, i) =>
    marketStep(T0 + 2000 * (startTick + i), { spotAsk, perpBid, perpAsk: perpBid + 0.02 }));
}

function initStep(atMs) {
  return { atMs, events: [{ type: 'universe', symbols: [meta()] }], tick: false };
}

// ---------- seam helpers ----------

/** A real engine-produced proposal — never a hand-built proposal literal. */
function openWorld() {
  const h = createReplayHarness(CFG, T0);
  h.run([initStep(T0), ...gapSteps(3)]);
  const [proposal] = h.engine.proposals.open();
  assert.ok(proposal, 'fixture must produce one open proposal');
  return { h, store: h.engine.proposals, proposal };
}

function acceptanceRequest(proposal, over = {}) {
  return {
    proposalId: proposal.id,
    acceptedBy: 'owner',
    acceptedRevisionTs: proposal.updatedTs,
    acceptedNetEdgePct: proposal.netEdgePct,
    acceptedNotionalUsd: proposal.suggestedNotionalUsd,
    ...over,
  };
}

function acceptOne() {
  const world = openWorld();
  const result = world.store.accept(acceptanceRequest(world.proposal));
  assert.equal(result.ok, true, `acceptance must succeed, got ${result.refusal}`);
  return { ...world, acceptance: result.acceptance };
}

function bindOne() {
  const world = acceptOne();
  const lifecycle = new BasisHandoffLifecycle(world.h.clock, world.store, { enabled: true });
  const result = lifecycle.consumeAccepted(world.acceptance.proposalId);
  assert.equal(result.ok, true, `consumption must succeed, got ${result.refusal}`);
  return { ...world, lifecycle, handoff: result.handoff };
}

/** Identity restated by every feedback, accepted revision included. */
function identity(handoff, over = {}) {
  return {
    handoffId: handoff.handoffId,
    proposalId: handoff.proposalId,
    correlationId: handoff.correlationId,
    symbol: handoff.symbol,
    direction: handoff.direction,
    acceptedRevisionTs: handoff.acceptedRevisionTs,
    sequence: 1,
    observedAtMs: handoff.boundTs + 1_000,
    ...over,
  };
}

/** Terminal feedback: the only kind that carries a cumulative quantity. */
function terminal(handoff, over = {}) {
  return { outcome: 'TERMINAL', cumulativeFilledQuantity: '0', ...identity(handoff), ...over };
}

/** Nonterminal feedback carries NO quantity field at all. */
function nonterminal(handoff, over = {}) {
  return { outcome: 'WORKING', ...identity(handoff), ...over };
}

// =====================================================================

test('default OFF: the runtime seam is inert and burns nothing', () => {
  const runtime = new BasisRuntime(
    { logEvent() { throw new Error('ledger must not be touched'); } },
    () => ({ feesPct: 0.3, minNetBasisPct: 0.25, persistTicks: 3, minQuoteVolume24h: 0, killSwitch: false, blockedSymbols: [] }),
    () => { throw new Error('universe must not be read'); },
    async () => { throw new Error('network must not be touched'); },
  );

  const snapshot = runtime.basisHandoffSnapshot();
  assert.equal(snapshot.enabled, false);
  assert.equal(snapshot.handoff, null);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(runtime.connectionStatus().running, false);
  assert.equal(runtime.connectionStatus().lastBookTs, null);

  assert.deepEqual(runtime.consumeAcceptedBasisProposal('bp_whatever'), { ok: false, refusal: 'DISABLED' });
  assert.deepEqual(
    runtime.applyBasisHandoffFeedback({
      handoffId: 'bh_bp_whatever',
      proposalId: 'bp_whatever',
      correlationId: 'corr',
      symbol: SYM,
      direction: 'long_spot_short_perp',
      acceptedRevisionTs: T0,
      sequence: 1,
      observedAtMs: T0,
      outcome: 'TERMINAL',
      cumulativeFilledQuantity: '0.5',
    }),
    { ok: false, refusal: 'DISABLED' },
  );
  assert.equal(runtime.basisHandoffSnapshot().handoff, null);
});

test('default OFF: the lifecycle refuses intake before the store is touched', () => {
  const { store, acceptance } = acceptOne();
  const lifecycle = new BasisHandoffLifecycle({ now: () => T0 }, store);

  assert.equal(lifecycle.enabled(), false);
  assert.deepEqual(lifecycle.consumeAccepted(acceptance.proposalId), { ok: false, refusal: 'DISABLED' });
  // the refusal must not have burned the single-shot claim
  assert.equal(store.acceptanceConsumed(acceptance.proposalId), false);
  assert.equal(lifecycle.snapshot().handoff, null);

  const clockFailure = new BasisHandoffLifecycle(
    { now: () => { throw new Error('clock unavailable'); } },
    store,
    { enabled: true },
  );
  assert.throws(() => clockFailure.consumeAccepted(acceptance.proposalId), /clock unavailable/);
  assert.equal(store.acceptanceConsumed(acceptance.proposalId), false, 'a clock failure must not burn the claim');
  assert.equal(clockFailure.snapshot().handoff, null);

  const invalidClock = new BasisHandoffLifecycle({ now: () => Number.NaN }, store, { enabled: true });
  assert.throws(() => invalidClock.consumeAccepted(acceptance.proposalId), /non-negative safe-integer/);
  assert.equal(store.acceptanceConsumed(acceptance.proposalId), false, 'an invalid clock must not burn the claim');

  const regressedClock = new BasisHandoffLifecycle(
    { now: () => acceptance.acceptedTs - 1 },
    store,
    { enabled: true },
  );
  assert.deepEqual(
    regressedClock.consumeAccepted(acceptance.proposalId),
    { ok: false, refusal: 'BOUND_TIME_REGRESSION' },
  );
  assert.equal(store.acceptanceConsumed(acceptance.proposalId), false, 'a regressed bind must not burn the claim');
  assert.equal(regressedClock.snapshot().handoff, null);

  const enabled = new BasisHandoffLifecycle({ now: () => acceptance.acceptedTs }, store, { enabled: true });
  assert.equal(enabled.consumeAccepted(acceptance.proposalId).ok, true);
});

test('one accepted proposal is consumed exactly once and bound verbatim', () => {
  const { store, proposal, acceptance, handoff, lifecycle } = bindOne();

  assert.equal(handoff.handoffId, `bh_${proposal.id}`);
  assert.equal(handoff.proposalId, proposal.id);
  assert.equal(handoff.correlationId, proposal.correlationId);
  assert.equal(handoff.symbol, proposal.symbol);
  assert.equal(handoff.direction, proposal.direction);
  assert.equal(handoff.acceptedBy, acceptance.acceptedBy);
  assert.equal(handoff.acceptedTs, acceptance.acceptedTs);
  assert.equal(handoff.acceptedRevisionTs, acceptance.acceptedRevisionTs);
  assert.equal(handoff.acceptedNetEdgePct, acceptance.acceptedNetEdgePct);
  assert.equal(handoff.acceptedNotionalUsd, acceptance.acceptedNotionalUsd);

  assert.equal(handoff.state, 'AWAITING_FEEDBACK');
  assert.equal(handoff.terminalKind, null);
  assert.equal(handoff.terminalTs, null);
  assert.equal(handoff.cumulativeFilledQuantity, null, 'unsettled quantity stays unknown');
  assert.equal(handoff.lastSequence, null);
  assert.equal(handoff.ambiguousObservations, 0);

  // the record states acceptance + terminal fill and nothing else: no plan, no
  // reservation, no leg order, no flatness, residual, unwind, or recovery claim
  assert.deepEqual(Object.keys(handoff).sort(), RECORD_KEYS);

  assert.equal(store.acceptanceConsumed(proposal.id), true);
  assert.equal(Object.isFrozen(handoff), true);
  assert.throws(() => { handoff.state = 'TERMINAL'; }, TypeError);
  assert.equal(lifecycle.snapshot().handoff.state, 'AWAITING_FEEDBACK');
});

test('acceptance mints no authority: revision, edge, and notional are bounded', () => {
  const { store, proposal } = openWorld();

  const regressingClock = openWorld();
  regressingClock.h.clock.set(regressingClock.proposal.updatedTs - 1);
  assert.throws(
    () => regressingClock.store.accept(acceptanceRequest(regressingClock.proposal)),
    /non-regressing safe-integer/,
  );
  assert.equal(regressingClock.proposal.status, 'open');
  assert.equal(regressingClock.store.acceptanceFor(regressingClock.proposal.id), null);

  const invalidClock = openWorld();
  invalidClock.h.clock.set(Number.NaN);
  assert.throws(
    () => invalidClock.store.accept(acceptanceRequest(invalidClock.proposal)),
    /non-regressing safe-integer/,
  );
  assert.equal(invalidClock.proposal.status, 'open');
  assert.equal(invalidClock.store.acceptanceFor(invalidClock.proposal.id), null);

  const failingClock = openWorld();
  failingClock.h.clock.now = () => { throw new Error('acceptance clock unavailable'); };
  assert.throws(
    () => failingClock.store.accept(acceptanceRequest(failingClock.proposal)),
    /acceptance clock unavailable/,
  );
  assert.equal(failingClock.proposal.status, 'open');
  assert.equal(failingClock.store.acceptanceFor(failingClock.proposal.id), null);

  assert.deepEqual(
    store.accept(acceptanceRequest(proposal, { acceptedRevisionTs: proposal.updatedTs - 1 })),
    { ok: false, refusal: 'REVISION_MISMATCH' },
  );
  assert.deepEqual(
    store.accept(acceptanceRequest(proposal, { acceptedNetEdgePct: proposal.netEdgePct + 0.01 })),
    { ok: false, refusal: 'EDGE_MISMATCH' },
  );
  assert.deepEqual(
    store.accept(acceptanceRequest(proposal, { acceptedNotionalUsd: proposal.suggestedNotionalUsd + 0.01 })),
    { ok: false, refusal: 'NOTIONAL_OUT_OF_BOUNDS' },
  );
  assert.deepEqual(
    store.accept(acceptanceRequest(proposal, { acceptedNotionalUsd: 0 })),
    { ok: false, refusal: 'NOTIONAL_OUT_OF_BOUNDS' },
  );
  const missingCeiling = openWorld();
  missingCeiling.proposal.suggestedNotionalUsd = null;
  assert.deepEqual(
    missingCeiling.store.accept(acceptanceRequest(missingCeiling.proposal, { acceptedNotionalUsd: 1 })),
    { ok: false, refusal: 'NOTIONAL_OUT_OF_BOUNDS' },
  );
  assert.deepEqual(
    store.accept(acceptanceRequest(proposal, { acceptedBy: '  ' })),
    { ok: false, refusal: 'ACCEPTOR_INVALID' },
  );
  assert.deepEqual(store.accept(acceptanceRequest(proposal, { proposalId: 'bp_missing' })), { ok: false, refusal: 'UNKNOWN_PROPOSAL' });
  assert.equal(proposal.status, 'open');
  assert.equal(store.acceptanceFor(proposal.id), null);

  // a notional strictly below the proposal's own suggestion is allowed
  const lower = store.accept(acceptanceRequest(proposal, { acceptedNotionalUsd: proposal.suggestedNotionalUsd / 2 }));
  assert.equal(lower.ok, true);
  assert.equal(lower.acceptance.acceptedNotionalUsd, proposal.suggestedNotionalUsd / 2);
  assert.equal(Object.isFrozen(lower.acceptance), true);
});

test('a second consumption is always refused — same id, fresh instance, second proposal', () => {
  const { h, store, proposal, acceptance, lifecycle } = bindOne();

  // the same proposal can never be accepted twice
  assert.deepEqual(store.accept(acceptanceRequest(proposal)), { ok: false, refusal: 'PROPOSAL_NOT_OPEN' });
  assert.deepEqual(lifecycle.consumeAccepted(acceptance.proposalId), { ok: false, refusal: 'ALREADY_BOUND' });

  const fresh = new BasisHandoffLifecycle(h.clock, store, { enabled: true });
  assert.deepEqual(fresh.consumeAccepted(acceptance.proposalId), { ok: false, refusal: 'ALREADY_CONSUMED' });
  assert.deepEqual(fresh.consumeAccepted('bp_missing'), { ok: false, refusal: 'NOT_ACCEPTED' });

  // acceptance frees the symbol, so the engine opens a fresh proposal for it
  h.run(gapSteps(3, 4));
  const [second] = store.open();
  assert.ok(second && second.id !== acceptance.proposalId);
  const secondAccepted = store.accept(acceptanceRequest(second));
  assert.equal(secondAccepted.ok, true);

  assert.deepEqual(lifecycle.consumeAccepted(second.id), { ok: false, refusal: 'ALREADY_BOUND' });
  assert.equal(store.acceptanceConsumed(second.id), false, 'a refused intake must not burn another acceptance');
  assert.equal(lifecycle.snapshot().handoff.proposalId, acceptance.proposalId);
});

test('acceptance preserves scanner, upsert, replacement, and invalidation semantics', () => {
  const { h, store, proposal } = openWorld();
  const eventsBefore = h.sink.events.length;

  const accepted = store.accept(acceptanceRequest(proposal));
  assert.equal(accepted.ok, true);
  assert.equal(h.sink.events.length, eventsBefore, 'acceptance emits no engine event');

  assert.equal(proposal.status, 'approved_manual');
  assert.equal(store.open().length, 0, 'an accepted proposal is no longer an open opportunity');
  assert.equal(store.openFor(SYM), null);
  assert.ok(store.all().some((row) => row.id === proposal.id), 'history still carries it');

  // expiry and invalidation can never rewrite the facts an acceptance froze
  store.expire(proposal.id, 'ttl_elapsed');
  assert.equal(proposal.status, 'approved_manual');
  assert.deepEqual(store.sweep(() => null), []);
  store.expireForSymbol(SYM, 'symbol_left_universe');
  store.expireAll('config_revised');
  store.retainSymbols(new Set());
  assert.equal(proposal.status, 'approved_manual');
  assert.deepEqual(store.acceptanceFor(proposal.id), accepted.acceptance);

  // replacement semantics intact: the next tick opens a new proposal for the symbol
  h.run(gapSteps(3, 4));
  const [next] = store.open();
  assert.ok(next && next.id !== proposal.id);
  assert.equal(h.sink.byKind('proposal_created').length, 2);
  assert.equal(h.sink.byKind('proposal_expired').length, 0);
});

test('wrong identity and stale accepted revision never advance the handoff', () => {
  const { lifecycle, handoff } = bindOne();

  for (const over of [
    { handoffId: 'bh_other' },
    { proposalId: 'bp_other' },
    { correlationId: 'corr_other' },
    { symbol: 'OTHERUSDT' },
    { direction: 'short_spot_long_perp' },
  ]) {
    const result = lifecycle.applyFeedback(terminal(handoff, { ...over, cumulativeFilledQuantity: '0.5' }));
    assert.deepEqual(result, { ok: false, refusal: 'WRONG_IDENTITY' }, JSON.stringify(over));
  }

  // feedback bound to a different accepted revision is about a different fact
  for (const revision of [handoff.acceptedRevisionTs - 1, handoff.acceptedRevisionTs + 1]) {
    assert.deepEqual(
      lifecycle.applyFeedback(terminal(handoff, { acceptedRevisionTs: revision, cumulativeFilledQuantity: '0.5' })),
      { ok: false, refusal: 'REVISION_MISMATCH' },
    );
    assert.deepEqual(
      lifecycle.applyFeedback(nonterminal(handoff, { acceptedRevisionTs: revision })),
      { ok: false, refusal: 'REVISION_MISMATCH' },
    );
  }
  assert.deepEqual(lifecycle.snapshot().handoff, handoff, 'record unchanged');
});

test('nonterminal, ambiguous, and unconfirmed-cancel feedback move neither fill nor progress', () => {
  const { lifecycle, handoff } = bindOne();

  const working = lifecycle.applyFeedback(nonterminal(handoff, { sequence: 1, outcome: 'WORKING' }));
  assert.equal(working.ok, true);
  assert.equal(working.progressed, false);
  assert.equal(working.handoff.state, 'AWAITING_FEEDBACK');
  assert.equal(working.handoff.cumulativeFilledQuantity, null);

  const ambiguous = lifecycle.applyFeedback(nonterminal(handoff, { sequence: 2, outcome: 'AMBIGUOUS' }));
  assert.equal(ambiguous.progressed, false);
  assert.equal(ambiguous.handoff.state, 'AWAITING_FEEDBACK');
  assert.equal(ambiguous.handoff.ambiguousObservations, 1);
  assert.equal(ambiguous.handoff.cumulativeFilledQuantity, null, 'unknown results never state a fill');

  const requested = lifecycle.applyFeedback(nonterminal(handoff, { sequence: 3, outcome: 'CANCEL_REQUESTED' }));
  assert.equal(requested.progressed, false);
  assert.equal(requested.handoff.state, 'AWAITING_FEEDBACK');
  assert.equal(requested.handoff.terminalKind, null);
  assert.equal(requested.handoff.terminalTs, null);
  assert.equal(requested.handoff.cumulativeFilledQuantity, null, 'an unconfirmed cancel settles nothing');

  // a quantity attached to nonterminal feedback is ignored, never recorded
  const smuggled = lifecycle.applyFeedback(nonterminal(handoff, { sequence: 4, outcome: 'WORKING', cumulativeFilledQuantity: '9' }));
  assert.equal(smuggled.progressed, false);
  assert.equal(smuggled.handoff.cumulativeFilledQuantity, null);

  assert.deepEqual(lifecycle.applyFeedback(terminal(handoff, { sequence: 5, outcome: 'PARTIAL' })), {
    ok: false,
    refusal: 'FEEDBACK_MALFORMED',
  });
});

test('matching terminal feedback progresses with the exact cumulative quantity', () => {
  const world = acceptOne();
  let now = world.h.clock.now();
  let clockFails = false;
  const clock = {
    now() {
      if (clockFails) throw new Error('terminal clock unavailable');
      return now;
    },
  };
  const lifecycle = new BasisHandoffLifecycle(clock, world.store, { enabled: true });
  const consumed = lifecycle.consumeAccepted(world.acceptance.proposalId);
  assert.equal(consumed.ok, true);
  const handoff = consumed.handoff;
  lifecycle.applyFeedback(nonterminal(handoff, { sequence: 1, outcome: 'WORKING' }));

  const beforeTerminal = lifecycle.snapshot().handoff;
  clockFails = true;
  assert.throws(
    () => lifecycle.applyFeedback(terminal(handoff, { sequence: 2, cumulativeFilledQuantity: '0.0075' })),
    /terminal clock unavailable/,
  );
  assert.deepEqual(lifecycle.snapshot().handoff, beforeTerminal, 'a terminal clock failure changes nothing');

  clockFails = false;
  now = handoff.boundTs - 1;
  assert.throws(
    () => lifecycle.applyFeedback(terminal(handoff, { sequence: 2, cumulativeFilledQuantity: '0.0075' })),
    /must not regress/,
  );
  assert.deepEqual(lifecycle.snapshot().handoff, beforeTerminal, 'a regressing terminal clock changes nothing');

  now = handoff.boundTs;
  const result = lifecycle.applyFeedback(terminal(handoff, { sequence: 2, cumulativeFilledQuantity: '0.0075' }));
  assert.equal(result.ok, true);
  assert.equal(result.progressed, true);
  assert.equal(result.handoff.state, 'TERMINAL');
  assert.equal(result.handoff.terminalKind, 'TERMINAL_REPORTED');
  assert.equal(result.handoff.terminalTs, now);
  assert.equal(result.handoff.cumulativeFilledQuantity, '0.0075', 'recorded verbatim, still a string');
  assert.equal(typeof result.handoff.cumulativeFilledQuantity, 'string');
  assert.equal(result.handoff.lastSequence, 2);
});

test('cancel-confirmed is terminal at zero and at a nonzero first-leg fill', () => {
  const zero = bindOne();
  const zeroResult = zero.lifecycle.applyFeedback(terminal(zero.handoff, {
    sequence: 4,
    outcome: 'CANCEL_CONFIRMED',
    cumulativeFilledQuantity: '0',
  }));
  assert.equal(zeroResult.progressed, true);
  assert.equal(zeroResult.handoff.state, 'TERMINAL');
  assert.equal(zeroResult.handoff.terminalKind, 'CANCEL_CONFIRMED');
  assert.equal(zeroResult.handoff.cumulativeFilledQuantity, '0');

  const partial = bindOne();
  const partialResult = partial.lifecycle.applyFeedback(terminal(partial.handoff, {
    sequence: 9,
    outcome: 'CANCEL_CONFIRMED',
    cumulativeFilledQuantity: '0.004',
  }));
  assert.equal(partialResult.progressed, true);
  assert.equal(partialResult.handoff.state, 'TERMINAL');
  assert.equal(partialResult.handoff.terminalKind, 'CANCEL_CONFIRMED');
  assert.equal(partialResult.handoff.cumulativeFilledQuantity, '0.004', 'the first leg terminally filled this much');
  // terminal on a nonzero cancel states the fill and claims nothing else:
  // no flatness, no residual, no unwind, no recovery field appears
  assert.deepEqual(Object.keys(partialResult.handoff).sort(), RECORD_KEYS);
});

test('cumulative quantity must be a canonical non-negative exact decimal string', () => {
  const { lifecycle, handoff } = bindOne();
  const before = lifecycle.snapshot().handoff;

  for (const quantity of ['0.0045000', '00.5', ' 0.5', '0.5 ', '+0.5', '1e-3', '-0.5', '', 'abc', 0.5, null, undefined]) {
    assert.deepEqual(
      lifecycle.applyFeedback(terminal(handoff, { sequence: 2, cumulativeFilledQuantity: quantity })),
      { ok: false, refusal: 'QUANTITY_NOT_EXACT' },
      String(quantity),
    );
    assert.deepEqual(lifecycle.snapshot().handoff, before, 'a refused quantity changes nothing');
  }

  // quantity and the accepted USD notional are different units and are never
  // compared: a quantity far above the $10 acceptance is still exact truth
  assert.equal(handoff.acceptedNotionalUsd, 10);
  const large = lifecycle.applyFeedback(terminal(handoff, { sequence: 2, cumulativeFilledQuantity: '250' }));
  assert.equal(large.ok, true);
  assert.equal(large.progressed, true);
  assert.equal(large.handoff.cumulativeFilledQuantity, '250');
});

test('stale and duplicate feedback never advance', () => {
  const { lifecycle, handoff } = bindOne();
  lifecycle.applyFeedback(nonterminal(handoff, { sequence: 5, observedAtMs: handoff.boundTs + 5_000, outcome: 'WORKING' }));
  const after = lifecycle.snapshot().handoff;

  const cases = [
    [{ sequence: 5, observedAtMs: handoff.boundTs + 6_000 }, 'DUPLICATE_SEQUENCE'],
    [{ sequence: 4, observedAtMs: handoff.boundTs + 6_000 }, 'STALE_SEQUENCE'],
    [{ sequence: 6, observedAtMs: handoff.boundTs + 4_999 }, 'STALE_OBSERVATION'],
    [{ sequence: 6, observedAtMs: handoff.boundTs - 1 }, 'STALE_OBSERVATION'],
    [{ sequence: 1.5 }, 'FEEDBACK_MALFORMED'],
    [{ sequence: -1 }, 'FEEDBACK_MALFORMED'],
    [{ sequence: Number.MAX_SAFE_INTEGER + 1 }, 'FEEDBACK_MALFORMED'],
    [{ observedAtMs: 1.5 }, 'FEEDBACK_MALFORMED'],
    [{ acceptedRevisionTs: Number.NaN }, 'FEEDBACK_MALFORMED'],
  ];
  for (const [over, refusal] of cases) {
    const message = terminal(handoff, { ...over, cumulativeFilledQuantity: '9' });
    assert.deepEqual(lifecycle.applyFeedback(message), { ok: false, refusal }, JSON.stringify(over));
    assert.deepEqual(lifecycle.snapshot().handoff, after, 'a refused observation changes nothing');
  }
});

test('a terminal handoff is immutable', () => {
  const { lifecycle, handoff } = bindOne();
  const done = lifecycle.applyFeedback(terminal(handoff, { sequence: 2, cumulativeFilledQuantity: '5' }));
  assert.equal(done.progressed, true);

  for (const over of [
    { sequence: 3, outcome: 'TERMINAL', cumulativeFilledQuantity: '9' },
    { sequence: 3, outcome: 'CANCEL_CONFIRMED', cumulativeFilledQuantity: '1' },
  ]) {
    assert.deepEqual(lifecycle.applyFeedback(terminal(handoff, over)), { ok: false, refusal: 'ALREADY_TERMINAL' }, JSON.stringify(over));
  }
  for (const outcome of ['WORKING', 'AMBIGUOUS', 'CANCEL_REQUESTED']) {
    assert.deepEqual(lifecycle.applyFeedback(nonterminal(handoff, { sequence: 3, outcome })), {
      ok: false,
      refusal: 'ALREADY_TERMINAL',
    });
  }
  assert.deepEqual(lifecycle.snapshot().handoff, done.handoff);
  assert.equal(lifecycle.snapshot().handoff.cumulativeFilledQuantity, '5');
});

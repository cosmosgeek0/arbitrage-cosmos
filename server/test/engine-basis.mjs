#!/usr/bin/env node
/**
 * Basis engine — synthetic proof. ZERO network: every case drives the built
 * engine through the scripted replay harness with a ManualClock.
 * Run after `npm run build -w server`:  node server/test/engine-basis.mjs
 * Prints ✓/✗ per case and exits non-zero on any failure.
 */
import {
  BASIS_DEFAULTS,
  buildFundingContext,
  buildSnapshots,
  createReplayHarness,
  estimateEdge,
  fundingCarryPctOverHold,
} from '../dist/engine/basis/index.js';
import { BasisRuntime } from '../dist/services/basisRuntime.js';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}
function approx(a, b, eps = 1e-6) {
  return typeof a === 'number' && Math.abs(a - b) <= eps;
}

// ---------- fixture builders ----------

const T0 = 1_000_000;
const SYM = 'TESTUSDT';

function meta(symbol = SYM, over = {}) {
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
    ...over,
  };
}

/**
 * One replay step: books both legs + mark/funding + generous depth ladders.
 * Overridable per case (thin depth, skewed timestamps, missing mark, …).
 */
function marketStep(atMs, o = {}) {
  const symbol = o.symbol ?? SYM;
  const spotBid = o.spotBid ?? 100.0;
  const spotAsk = o.spotAsk ?? 100.02;
  const perpBid = o.perpBid ?? 100.8;
  const perpAsk = o.perpAsk ?? 100.82;
  const funding = o.funding ?? 0.0001;
  const mark = o.mark ?? (perpBid + perpAsk) / 2;
  const perpTs = atMs - (o.perpTsOffsetMs ?? 0);
  const qty = o.topQty ?? 500;
  const depthQty = o.depthQty ?? 500;
  const events = [
    { type: 'spotBook', tick: { symbol, bid: spotBid, ask: spotAsk, bidQty: qty, askQty: qty, ts: atMs } },
    { type: 'perpBook', tick: { symbol, bid: perpBid, ask: perpAsk, bidQty: qty, askQty: qty, ts: perpTs } },
    {
      type: 'markFunding',
      tick: { symbol, markPrice: mark, fundingRate: funding, nextFundingTs: o.nextFundingTs ?? atMs + 4 * 3_600_000, ts: atMs },
    },
  ];
  if (o.depth !== false) {
    events.push(
      { type: 'spotDepth', ladder: { symbol, bids: [[spotBid, depthQty]], asks: [[spotAsk, depthQty]], ts: atMs } },
      { type: 'perpDepth', ladder: { symbol, bids: [[perpBid, depthQty]], asks: [[perpAsk, depthQty]], ts: perpTs } },
    );
  }
  return { atMs, events };
}

function initStep(atMs, symbols = [meta()], extraEvents = []) {
  return { atMs, events: [{ type: 'universe', symbols }, ...extraEvents], tick: false };
}

/**
 * Market steps every 2s, gap values via perp offset. `startTick` numbers the
 * first step (tick k lands at T0 + 2000·k) so multi-batch runs keep event
 * timestamps aligned with the clock.
 */
function gapSeries(gapsPct, o = {}, startTick = 1) {
  return gapsPct.map((g, i) => {
    const spotAsk = o.spotAsk ?? 100.02;
    // perpBid such that (perpBid − spotAsk)/spotAsk = g%
    const perpBid = spotAsk * (1 + g / 100);
    return marketStep(T0 + 2000 * (startTick + i), { ...o, spotAsk, perpBid, perpAsk: perpBid + 0.02 });
  });
}

const CFG = { persistTicks: 3 }; // default proof config: propose on the 3rd persisting tick

// =====================================================================
section('1. perp expensive ⇒ proposal (executable gap, itemised costs)');
{
  const h = createReplayHarness(CFG, T0);
  h.run([initStep(T0), ...gapSeries([0.78, 0.78, 0.78])]);
  const open = h.engine.proposals.open();
  const p = open[0];
  check('one open proposal', open.length === 1, `got ${open.length}`);
  check('direction long_spot_short_perp', p?.direction === 'long_spot_short_perp');
  check('gross edge ≈ executable (perpBid−spotAsk)/spotAsk', p && Math.abs(p.grossEdgePct - 0.78) < 0.01, `gross=${p?.grossEdgePct}`);
  check('net edge = gross − 4-leg fees − slippage + funding carry', p && p.netEdgePct > 0.45 && p.netEdgePct < 0.52, `net=${p?.netEdgePct}`);
  check('cost breakdown itemised (fees 2×spot+2×perp)', p && approx(p.costBreakdown.feesPct, 0.3, 1e-9), `fees=${p?.costBreakdown.feesPct}`);
  check('no borrow needed for direction A', p?.borrowRequired === false && p?.borrowStatus === 'not_needed');
  check('staged sizes are metadata only (3 stages)', p?.stagedSizes.length === 3 && approx(p.stagedSizes[0].notionalUsd, 2.5, 0.01));
  check('invalidation spec attached', p && p.invalidationSpec.gapClosesBelowPct > 0 && p.invalidationSpec.expiresTs > T0);
  check('proposal_created ledgered', h.sink.byKind('proposal_created').length === 1);
  const early = h.sink.byKind('strategy_decision').slice(0, 2);
  check('persistence gate: first ticks focus, not proposal', early.every((e) => e.payload.kind === 'focus'));
}

// =====================================================================
section('2. reverse basis + borrow unknown ⇒ named reject, never a proposal');
{
  const h = createReplayHarness(CFG, T0);
  // spot expensive: gap B open, no borrow info injected anywhere
  const steps = [1, 2, 3].map((i) =>
    marketStep(T0 + 2000 * i, { spotBid: 100.8, spotAsk: 100.82, perpBid: 100.0, perpAsk: 100.02 }),
  );
  const r = h.run([initStep(T0), ...steps]);
  const rejects = r.decisions.filter((d) => d.kind === 'reject');
  check('every tick rejects', rejects.length === 3, `got ${rejects.length}`);
  check('named reject borrow_unknown', rejects.every((d) => d.rejectCode === 'borrow_unknown'));
  check('reject targets reverse direction', rejects.every((d) => d.evidence.direction === 'short_spot_long_perp'));
  check('NO proposal exists', h.engine.proposals.all().length === 0);
  check('rejects are ledgered (hidden rejects forbidden)', h.sink.byKind('strategy_decision').every((e) => e.rejectCode === 'borrow_unknown'));
}

// =====================================================================
section('3. widening gap ⇒ priority rises (momentum + net edge components)');
{
  const h = createReplayHarness({ persistTicks: 10 }, T0);
  h.run([initStep(T0), ...gapSeries([0.4, 0.5])]);
  const p1 = h.engine.priorityOf(SYM);
  h.run(gapSeries([0.65, 0.8], {}, 3));
  const p2 = h.engine.priorityOf(SYM);
  check('priority rises as gap widens', p1 && p2 && p2.score > p1.score, `${p1?.score.toFixed(4)} → ${p2?.score.toFixed(4)}`);
  check('momentum component > 1 while widening', p2 && p2.components.momentum > 1, `momentum=${p2?.components.momentum.toFixed(3)}`);
  check('priority is explainable (all components present)', p2 && ['netEdge', 'persistence', 'liquidity', 'fundingUsefulness', 'dataQuality', 'momentum'].every((k) => typeof p2.components[k] === 'number'));
}

// =====================================================================
section('4. closing gap ⇒ priority drops and proposal closes (gap_closed)');
{
  const h = createReplayHarness(CFG, T0);
  h.run([initStep(T0), ...gapSeries([0.8, 0.8, 0.8])]);
  const p = h.engine.proposals.open()[0];
  const before = h.engine.priorityOf(SYM);
  check('setup: proposal open', !!p);
  h.run([marketStep(T0 + 8000, { perpBid: 100.02 * 1.006, perpAsk: 100.02 * 1.006 + 0.02 })]); // 0.6% still proposal-grade
  check('refresh while alive → proposal_updated ledgered', h.sink.byKind('proposal_updated').length >= 1);
  h.run([marketStep(T0 + 10_000, { perpBid: 100.02 * 1.0012, perpAsk: 100.02 * 1.0012 + 0.02 })]); // 0.12% < watch
  const after = h.engine.priorityOf(SYM);
  check('proposal expired with gap_closed', p.status === 'expired' && p.reason.includes('gap_closed'), p.reason);
  check('proposal_expired ledgered', h.sink.byKind('proposal_expired').some((e) => e.payload.why === 'gap_closed'));
  check('priority drops as gap closes', before && after && after.score < before.score, `${before?.score.toFixed(4)} → ${after?.score.toFixed(4)}`);
  check('no open proposals remain', h.engine.proposals.open().length === 0);
}

// =====================================================================
section('5. funding against the trade ⇒ funding_against_trade');
{
  const h = createReplayHarness(CFG, T0);
  // gap A open but shorts PAY 1%/period → drag over 4h hold = 0.5% > max 0.15%
  const r = h.run([initStep(T0), marketStep(T0 + 2000, { funding: -0.01 })]);
  const d = r.decisions[0];
  check('reject funding_against_trade', d?.kind === 'reject' && d?.rejectCode === 'funding_against_trade', d?.humanReason);
  check('evidence carries funding drag over expected hold', typeof d?.evidence.fundingCarryPctOverHold === 'number' && d.evidence.fundingCarryPctOverHold < -0.15);
  check('no proposal', h.engine.proposals.all().length === 0);
}

// =====================================================================
section('5b. funding is charged only at known discrete settlements');
{
  const period = 8 * 60 * 60_000;
  const hold = 4 * 60 * 60_000;
  const noSettlement = fundingCarryPctOverHold(
    [0.001], 'long_spot_short_perp', hold, period, hold + 1,
  );
  const oneSettlement = fundingCarryPctOverHold(
    [0.001], 'long_spot_short_perp', hold, period, 60_000,
  );
  const unknownSecondSettlement = fundingCarryPctOverHold(
    [0.001], 'long_spot_short_perp', 17 * 60 * 60_000, period, 60_000,
  );
  check('hold ending before funding has zero carry', noSettlement === 0, `carry=${noSettlement}`);
  check('one crossed funding timestamp charges the full known rate', approx(oneSettlement, 0.1), `carry=${oneSettlement}`);
  check('a crossed settlement without a known future rate stays unknown', unknownSecondSettlement === null, `carry=${unknownSecondSettlement}`);

  const staleSchedule = buildFundingContext(
    { symbol: SYM, markPrice: 100, fundingRate: 0.001, nextFundingTs: T0 - 1, ts: T0 },
    [],
    'long_spot_short_perp',
    { gapPct: 1, slopePctPerMin: 0, samples: 1 },
    T0,
    BASIS_DEFAULTS,
    0,
  );
  check(
    'past next-funding metadata cannot manufacture a current settlement',
    !staleSchedule.fresh && staleSchedule.carryPctOverHold === null,
  );

  const unknownFunding = {
    fundingRate: 0.001, stalenessMs: 0, fresh: true, nextFundingTs: T0 + 60_000,
    msToFunding: 60_000, carryPctOverHold: null, expectedHoldMs: hold,
    flipRisk: 0, captureFactor: 0,
  };
  const edge = estimateEdge(
    'long_spot_short_perp',
    { gapPct: 1, slopePctPerMin: 0, samples: 1 },
    unknownFunding,
    { slippagePct: 0.01, depthScore: 1, sufficient: true, source: 'ladder' },
    0,
    BASIS_DEFAULTS,
  );
  check('unknown crossed-settlement carry keeps net edge unknown', edge.netEdgePct === null, `net=${edge.netEdgePct}`);
}

// =====================================================================
section('6. stale data ⇒ data_stale, then cooldown suppresses the symbol');
{
  const h = createReplayHarness(CFG, T0);
  h.run([initStep(T0), marketStep(T0 + 2000)]);
  const r2 = h.run([{ atMs: T0 + 12_000, events: [] }]); // 10s silence > staleMs 5s
  const d = r2.decisions[0];
  check('reject data_stale after silence', d?.kind === 'reject' && d?.rejectCode === 'data_stale', d?.humanReason);
  const r3 = h.run([{ atMs: T0 + 14_000, events: [] }]);
  check('cooldown: symbol skipped next tick', r3.decisions.length === 0);
  check('lifecycle state is COOLDOWN', h.engine.lifecycle.get(SYM).state === 'COOLDOWN');
}

// =====================================================================
section('7. wide spread ⇒ spread_too_wide');
{
  const h = createReplayHarness(CFG, T0);
  const r = h.run([
    initStep(T0),
    marketStep(T0 + 2000, { spotBid: 100.0, spotAsk: 100.6, perpBid: 101.5, perpAsk: 101.52 }),
  ]);
  const d = r.decisions[0];
  check('reject spread_too_wide', d?.kind === 'reject' && d?.rejectCode === 'spread_too_wide', d?.humanReason);
  check('evidence carries both leg spreads', typeof d?.evidence.spotSpreadBps === 'number' && d.evidence.spotSpreadBps > 25);
}

// =====================================================================
section('8. kill switch ⇒ blocked from the execution path');
{
  // (a) armed signal converts to a named reject at the scanner
  const h1 = createReplayHarness(CFG, T0);
  const r1 = h1.run([initStep(T0, [meta()], [{ type: 'killSwitch', on: true }]), ...gapSeries([0.78, 0.78, 0.78])]);
  const last = r1.decisions[r1.decisions.length - 1];
  check('would-be proposal rejected kill_switch_on', last?.kind === 'reject' && last?.rejectCode === 'kill_switch_on', last?.humanReason);
  check('no proposal created under kill switch', h1.engine.proposals.all().length === 0);

  // (b) an existing open proposal cannot produce order intents
  const h2 = createReplayHarness(CFG, T0);
  h2.run([initStep(T0), ...gapSeries([0.78, 0.78, 0.78])]);
  const p = h2.engine.proposals.open()[0];
  h2.engine.setKillSwitch(true);
  const blocked = h2.engine.prepareOrderIntents(p.id);
  check('prepareOrderIntents blocked', blocked.blocked === true && blocked.intents.length === 0);
  check('verdict names kill_switch_on', blocked.verdict.allowed === false && blocked.verdict.reasons.includes('kill_switch_on'));
  check('risk_rejected ledgered with rejectCode', h2.sink.byKind('risk_rejected').some((e) => e.rejectCode === 'kill_switch_on'));
  h2.engine.setKillSwitch(false);
  const ok = h2.engine.prepareOrderIntents(p.id);
  check('unkilled: two-leg intent stubs (BUY spot / SELL perp)', !ok.blocked && ok.intents.length === 2 && ok.intents[0].side === 'BUY' && ok.intents[1].side === 'SELL');
  check('intents are stubs for the risk gate (source=proposal)', ok.intents.every((i) => i.source === 'proposal' && i.proposalId === p.id));

  // (c) traceability — one signal end-to-end by correlationId
  section('9. correlationId traces one signal end-to-end');
  const corr = p.correlationId;
  const chain = h2.sink.byCorrelation(corr).map((e) => e.kind);
  check('chain: candidate → focus → decisions → proposal → risk block', ['candidate_opened', 'focus_opened', 'strategy_decision', 'proposal_created', 'risk_rejected'].every((k) => chain.includes(k)), chain.join(','));
  check('intents carry the same correlationId', ok.intents.every((i) => i.correlationId === corr));
  const r2all = h2.sink.events;
  check('every event has a correlationId', r2all.every((e) => typeof e.correlationId === 'string' && e.correlationId.length > 0));
}

// =====================================================================
section('10. snapshots return contract-shaped data (pure, no express)');
{
  const h = createReplayHarness(CFG, T0);
  h.run([initStep(T0), ...gapSeries([0.78, 0.78, 0.78])]);
  const snaps = buildSnapshots(h.engine, h.sink);
  const st = snaps.status();
  check(
    'status shape',
    typeof st.running === 'boolean' &&
      typeof st.universeSize === 'number' &&
      typeof st.eligibleSize === 'number' &&
      typeof st.watching === 'number' &&
      typeof st.focused === 'number' &&
      typeof st.openProposals === 'number' &&
      st.lastTickTs === T0 + 6000,
    JSON.stringify(st),
  );
  check('status counts: 1 universe / 1 open proposal', st.universeSize === 1 && st.openProposals === 1);
  const ds = snaps.decisions(10);
  check('decisions shape', ds.length === 3 && ds.every((d) => d.symbol === SYM && d.strategy === 'basis' && typeof d.correlationId === 'string' && typeof d.evidence === 'object'));
  check('universe slice', snaps.universe().length === 1 && snaps.universe()[0].symbol === SYM);
  check('candidates sortable by score', Array.isArray(snaps.candidates()));
  check('focus sessions listed', snaps.focus().length >= 1 && snaps.focus()[0].symbol === SYM);
  const pr = snaps.proposals();
  check('proposals expose net edge + confidence + invalidation', pr.length === 1 && typeof pr[0].netEdgePct === 'number' && typeof pr[0].confidence === 'number' && typeof pr[0].invalidation === 'string');
  check('events readable', snaps.events().length > 0);
  check('priorities ranked desc', (() => { const xs = snaps.priorities(); return xs.every((x, i) => i === 0 || xs[i - 1].score >= x.score); })());
  const fd = snaps.featureDetail(SYM);
  check('feature detail carries full basis signals', !!fd?.basis && !!fd.basis.gapA && !!fd.basis.dq && !!fd.basis.edge.A.costs);
}

// =====================================================================
section('11. EXTRA: flickering gap ⇒ gap_not_persistent (stability CV guard)');
{
  const h = createReplayHarness({ persistTicks: 5, minNetBasisPct: 0.01 }, T0);
  const r = h.run([initStep(T0), ...gapSeries([1.4, 0.35, 1.4, 0.35])]);
  const last = r.decisions[r.decisions.length - 1];
  check('unstable gap rejected gap_not_persistent', last?.kind === 'reject' && last?.rejectCode === 'gap_not_persistent', last?.humanReason);
  check('evidence carries stability CV', typeof last?.evidence.gapStabilityCv === 'number' && last.evidence.gapStabilityCv > 0.6);
}

// =====================================================================
section('12. EXTRA: borrow modelled as injectable data (cost / size / ok)');
{
  const revSteps = (n) =>
    Array.from({ length: n }, (_, i) =>
      marketStep(T0 + 2000 * (i + 1), { spotBid: 100.8, spotAsk: 100.82, perpBid: 100.0, perpAsk: 100.02 }),
    );

  // too expensive
  const h1 = createReplayHarness(CFG, T0);
  const r1 = h1.run([
    initStep(T0, [meta()], [{ type: 'borrow', info: { asset: 'TEST', status: 'available', maxBorrowableBase: 1000, hourlyRatePct: 0.05, asOfTs: T0 } }]),
    ...revSteps(1),
  ]);
  check('expensive borrow ⇒ borrow_cost_too_high', r1.decisions[0]?.rejectCode === 'borrow_cost_too_high', r1.decisions[0]?.humanReason);

  // too small
  const h2 = createReplayHarness(CFG, T0);
  const r2 = h2.run([
    initStep(T0, [meta()], [{ type: 'borrow', info: { asset: 'TEST', status: 'available', maxBorrowableBase: 0.01, hourlyRatePct: 0.002, asOfTs: T0 } }]),
    ...revSteps(1),
  ]);
  check('insufficient max borrowable ⇒ borrow_too_small', r2.decisions[0]?.rejectCode === 'borrow_too_small', r2.decisions[0]?.humanReason);

  // available and cheap → reverse proposal with borrow cost in the breakdown
  const h3 = createReplayHarness(CFG, T0);
  h3.run([
    initStep(T0, [meta()], [{ type: 'borrow', info: { asset: 'TEST', status: 'available', maxBorrowableBase: 1000, hourlyRatePct: 0.002, asOfTs: T0 } }]),
    ...revSteps(3),
  ]);
  const p = h3.engine.proposals.open()[0];
  check('borrow ok ⇒ reverse proposal opens', p?.direction === 'short_spot_long_perp');
  check('proposal declares borrowRequired + status', p?.borrowRequired === true && p?.borrowStatus === 'available');
  check('borrow interest itemised in costs', p && p.costBreakdown.borrowCostPct > 0, `borrowCost=${p?.costBreakdown.borrowCostPct}`);
}

// =====================================================================
section('13. EXTRA: cross-leg timestamp skew ⇒ data_stale (gap is fiction)');
{
  const h = createReplayHarness(CFG, T0);
  const r = h.run([initStep(T0), marketStep(T0 + 2000, { perpTsOffsetMs: 4000 })]);
  const d = r.decisions[0];
  check('skewed legs rejected data_stale', d?.kind === 'reject' && d?.rejectCode === 'data_stale', d?.humanReason);
  check('reason names the skew', (d?.humanReason ?? '').includes('skew'));
}

// =====================================================================
section('14. EXTRA: mark-book divergence degrades data quality ⇒ reject');
{
  const h = createReplayHarness({ ...CFG, minDataQuality: 0.7 }, T0);
  const r = h.run([initStep(T0), marketStep(T0 + 2000, { mark: 95 })]);
  const d = r.decisions[0];
  check('divergent mark rejected data_stale (quality gate)', d?.kind === 'reject' && d?.rejectCode === 'data_stale', d?.humanReason);
  check('evidence: markDivergenceBps > threshold', typeof d?.evidence.markDivergenceBps === 'number' && d.evidence.markDivergenceBps > 50);
}

// =====================================================================
section('15. EXTRA: depth too thin at intended size ⇒ depth_too_thin');
{
  const h = createReplayHarness(CFG, T0);
  const r = h.run([initStep(T0), marketStep(T0 + 2000, { depthQty: 0.02 })]); // ~$2 visible vs $10 size
  const d = r.decisions[0];
  check('thin ladder rejected depth_too_thin', d?.kind === 'reject' && d?.rejectCode === 'depth_too_thin', d?.humanReason);
}

// =====================================================================
section('16. EXTRA: edge below fees / below threshold are distinct rejects');
{
  const h1 = createReplayHarness(CFG, T0);
  const r1 = h1.run([initStep(T0), ...gapSeries([0.25])]);
  check('gross ≤ 4-leg fees ⇒ edge_below_fees', r1.decisions[0]?.rejectCode === 'edge_below_fees', r1.decisions[0]?.humanReason);

  const h2 = createReplayHarness(CFG, T0);
  const r2 = h2.run([initStep(T0), ...gapSeries([0.45])]);
  check('net < required ⇒ edge_below_threshold', r2.decisions[0]?.rejectCode === 'edge_below_threshold', r2.decisions[0]?.humanReason);
}

// =====================================================================
section('17. EXTRA: focus is scarce — caps + score eviction');
{
  const syms = ['AAAUSDT', 'BBBUSDT', 'CCCUSDT', 'DDDUSDT'];
  const gaps = [0.6, 0.7, 0.8, 1.0]; // all clear the net-edge bar → all want focus
  const h = createReplayHarness({ persistTicks: 10, focusSoftCap: 2, focusHardCap: 3 }, T0);
  const events = syms.flatMap((s, i) => {
    const perpBid = 100.02 * (1 + gaps[i] / 100);
    return marketStep(T0 + 2000, { symbol: s, perpBid, perpAsk: perpBid + 0.02 }).events;
  });
  h.run([initStep(T0, syms.map((s) => meta(s))), { atMs: T0 + 2000, events }]);
  const active = h.engine.lifecycle.activeFocusCount();
  check('hard cap respected', active <= 3, `active=${active}`);
  const evicted = h.sink.byKind('focus_closed').filter((e) => e.payload.exitReason === 'capacity_evicted');
  check('weakest evicted for stronger signal', evicted.length === 1 && evicted[0].symbol === 'AAAUSDT', evicted.map((e) => e.symbol).join(','));
  const focusSyms = h.engine.lifecycle.focusSessions().filter((s) => s.exitedTs === null).map((s) => s.symbol).sort();
  check('strongest three hold focus', JSON.stringify(focusSyms) === JSON.stringify(['BBBUSDT', 'CCCUSDT', 'DDDUSDT']), focusSyms.join(','));
}

// =====================================================================
section('18. EXTRA: replay is deterministic (same script ⇒ same story)');
{
  const script = () => [initStep(T0), ...gapSeries([0.4, 0.78, 0.78, 0.78, 0.5])];
  const a = createReplayHarness(CFG, T0);
  const b = createReplayHarness(CFG, T0);
  const ra = a.run(script());
  const rb = b.run(script());
  const kindsA = ra.decisions.map((d) => `${d.symbol}:${d.kind}:${d.rejectCode}`).join('|');
  const kindsB = rb.decisions.map((d) => `${d.symbol}:${d.kind}:${d.rejectCode}`).join('|');
  check('identical decision sequences', kindsA === kindsB);
  check('identical event kind sequences', a.sink.events.map((e) => e.kind).join('|') === b.sink.events.map((e) => e.kind).join('|'));
  check('identical net edges', JSON.stringify(a.engine.proposals.all().map((p) => p.netEdgePct)) === JSON.stringify(b.engine.proposals.all().map((p) => p.netEdgePct)));
}

// =====================================================================
section('19. EXTRA: symbol blocklist ⇒ symbol_blocked');
{
  const h = createReplayHarness(CFG, T0);
  h.engine.blockSymbol(SYM);
  const r = h.run([initStep(T0), ...gapSeries([0.78])]);
  check('blocked symbol rejected symbol_blocked', r.decisions[0]?.rejectCode === 'symbol_blocked', r.decisions[0]?.humanReason);
}

// =====================================================================
section('20. SAFETY: ingress accepts only known, finite, monotonic, uncrossed books');
{
  const h = createReplayHarness(CFG, T0);
  h.run([initStep(T0), marketStep(T0 + 2000)]);
  const validSpot = h.engine.market.spotBook(SYM);
  h.engine.onSpotBook({ symbol: 'UNKNOWNUSDT', bid: 1, ask: 2, bidQty: 1, askQty: 1, ts: T0 + 2000 });
  check('unknown symbol does not allocate market state', !h.engine.market.symbols().includes('UNKNOWNUSDT'));
  h.engine.onSpotBook({ symbol: SYM, bid: 999, ask: 1000, bidQty: 1, askQty: 1, ts: T0 + 1000 });
  check('out-of-order book cannot replace the latest book', h.engine.market.spotBook(SYM)?.bid === validSpot?.bid);

  const crossed = marketStep(T0 + 4000);
  crossed.events[0] = {
    type: 'spotBook',
    tick: { symbol: SYM, bid: 101, ask: 100, bidQty: 10, askQty: 10, ts: T0 + 4000 },
  };
  const crossedResult = h.run([crossed]);
  check('crossed book is invalidated, not priced', crossedResult.decisions[0]?.rejectCode === 'spot_missing');

  const bad = createReplayHarness(CFG, T0);
  const badStep = marketStep(T0 + 2000);
  badStep.events = badStep.events.map((event) => event.type === 'markFunding'
    ? { ...event, tick: { ...event.tick, fundingRate: Number.NaN } }
    : event);
  const badResult = bad.run([initStep(T0), badStep]);
  check('non-finite funding is invalidated and fails closed', badResult.decisions[0]?.rejectCode === 'data_stale');
  check('invalid funding never opens a proposal', bad.engine.proposals.open().length === 0);
}

// =====================================================================
section('21. SAFETY: missing/stale funding and borrow inputs fail closed');
{
  const missing = createReplayHarness(CFG, T0);
  const noMark = marketStep(T0 + 2000);
  noMark.events = noMark.events.filter((event) => event.type !== 'markFunding');
  const missingResult = missing.run([initStep(T0), noMark]);
  check('missing funding produces data_stale', missingResult.decisions[0]?.rejectCode === 'data_stale');

  const stale = createReplayHarness({ ...CFG, fundingStaleMs: 5_000, staleMs: 20_000 }, T0);
  stale.run([initStep(T0), marketStep(T0 + 2000)]);
  const freshBooksOnly = marketStep(T0 + 9000);
  freshBooksOnly.events = freshBooksOnly.events.filter((event) => event.type !== 'markFunding');
  const staleResult = stale.run([freshBooksOnly]);
  check('stale funding produces data_stale despite fresh books', staleResult.decisions[0]?.rejectCode === 'data_stale');
  check('stale funding exposes no carry estimate', stale.engine.featureSnapshot(SYM)?.basis.funding.A.carryPctOverHold === null);

  const borrow = createReplayHarness({ ...CFG, borrowStaleMs: 3_000 }, T0);
  const reverse = (atMs) => marketStep(atMs, { spotBid: 100.8, spotAsk: 100.82, perpBid: 100, perpAsk: 100.02 });
  const borrowResult = borrow.run([
    initStep(T0, [meta()], [{ type: 'borrow', info: { asset: 'TEST', status: 'available', maxBorrowableBase: 1000, hourlyRatePct: 0.002, asOfTs: T0 } }]),
    reverse(T0 + 2000),
    reverse(T0 + 4000),
  ]);
  check('stale borrow state becomes borrow_unknown', borrowResult.decisions.at(-1)?.rejectCode === 'borrow_unknown');
  check('stale borrow state never reaches a proposal', borrow.engine.proposals.open().length === 0);
}

// =====================================================================
section('22. SAFETY: universe/config reconciliation prunes derived state');
{
  const h = createReplayHarness(CFG, T0);
  h.run([initStep(T0), ...gapSeries([0.78, 0.78, 0.78])]);
  const oldProposal = h.engine.proposals.open()[0];
  h.run([{ atMs: T0 + 6000, events: [{ type: 'universe', symbols: [meta('NEWUSDT')] }], tick: false }]);
  check('removed symbol leaves market state', !h.engine.market.symbols().includes(SYM));
  check('removed symbol leaves lifecycle state', !h.engine.lifecycle.all().some((row) => row.symbol === SYM));
  check('removed symbol leaves priority state', h.engine.priorityOf(SYM) === null);
  check('removed symbol proposal expires immediately', oldProposal?.status === 'expired' && h.engine.proposals.open().length === 0);

  h.engine.seedFundingHistory('NEWUSDT', [
    { fundingRate: 0.001, ts: T0 + 1 },
    { fundingRate: 0.002, ts: T0 + 2 },
    { fundingRate: 0.003, ts: T0 + 3 },
    { fundingRate: 0.004, ts: T0 + 4 },
    { fundingRate: 0.005, ts: T0 + 5 },
  ]);
  h.engine.updateConfig({ fundingHistoryKeep: 3 });
  h.engine.seedFundingHistory('NEWUSDT', [
    { fundingRate: 0.001, ts: T0 + 1 },
    { fundingRate: 0.002, ts: T0 + 2 },
    { fundingRate: 0.003, ts: T0 + 3 },
    { fundingRate: 0.004, ts: T0 + 4 },
    { fundingRate: 0.005, ts: T0 + 5 },
  ]);
  check('funding history is bounded by config', h.engine.market.fundingHistory('NEWUSDT').length === 3);

  const revised = createReplayHarness(CFG, T0);
  revised.run([initStep(T0), ...gapSeries([0.78, 0.78, 0.78])]);
  const proposal = revised.engine.proposals.open()[0];
  check('config revision is detected', revised.engine.updateConfig({ persistTicks: 4 }) === true);
  check('config revision invalidates old proposal', proposal?.status === 'expired' && proposal.reason.includes('config_changed'));
  check('config revision clears signal-derived priorities', revised.engine.priorityOf(SYM) === null);
  let invalidConfigRejected = false;
  try {
    revised.engine.updateConfig({ fundingPeriodMs: 0 });
  } catch {
    invalidConfigRejected = true;
  }
  check('invalid zero funding period is rejected', invalidConfigRejected);

  const capped = createReplayHarness({ maxUniverseSize: 1 }, T0);
  let oversizedRejected = false;
  try {
    capped.engine.setUniverse([meta('AAAUSDT'), meta('BBBUSDT')]);
  } catch {
    oversizedRejected = true;
  }
  check('oversized universe is rejected before allocation', oversizedRejected && capped.engine.market.symbols().length === 0);
}

// =====================================================================
section('23. SAFETY: proposal history and execution validity remain bounded');
{
  const h = createReplayHarness({ persistTicks: 1, proposalHistoryKeep: 2 }, T0);
  h.run([initStep(T0, [meta()], [{ type: 'borrow', info: { asset: 'TEST', status: 'available', maxBorrowableBase: 1000, hourlyRatePct: 0.002, asOfTs: T0 } }])]);
  const forward = (atMs) => marketStep(atMs, { spotBid: 100, spotAsk: 100.02, perpBid: 100.8, perpAsk: 100.82 });
  const reverse = (atMs) => marketStep(atMs, { spotBid: 100.8, spotAsk: 100.82, perpBid: 100, perpAsk: 100.02 });
  h.run([forward(T0 + 2000), reverse(T0 + 4000), forward(T0 + 6000), reverse(T0 + 8000)]);
  check('closed proposal history stays within configured bound', h.engine.proposals.all().length <= 2, `got ${h.engine.proposals.all().length}`);
  check('one current proposal remains discoverable', h.engine.proposals.open().length === 1);

  const ttl = createReplayHarness({ persistTicks: 1, proposalTtlMs: 3_000 }, T0);
  ttl.run([initStep(T0), forward(T0 + 2000)]);
  const live = ttl.engine.proposals.open()[0];
  ttl.clock.set(T0 + 6000);
  const prepared = ttl.engine.prepareOrderIntents(live.id);
  check('prepare path revalidates elapsed proposal TTL', prepared.blocked && prepared.verdict.reasons.includes('proposal_not_open'));
  check('expired proposal cannot emit intents', prepared.intents.length === 0 && live.status === 'expired');
  check('decision reads clamp untrusted limits', ttl.engine.decisions(999_999).length <= 2_000 && ttl.engine.decisions(Number.POSITIVE_INFINITY).length === 0);

  const tampered = createReplayHarness({ persistTicks: 1 }, T0);
  tampered.run([initStep(T0), forward(T0 + 2000)]);
  const tamperedProposal = tampered.engine.proposals.open()[0];
  tamperedProposal.suggestedNotionalUsd = Number.POSITIVE_INFINITY;
  const tamperedResult = tampered.engine.prepareOrderIntents(tamperedProposal.id);
  check('non-finite proposal sizing is rejected at the execution bridge', tamperedResult.blocked && tamperedResult.verdict.reasons.includes('proposal_invalid'));
}

// =====================================================================
section('24. SAFETY: runtime generations own timers and persistence failures stay isolated');
{
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let fetchCalls = 0;
  let hold = true;
  const fakeFetch = async () => {
    fetchCalls += 1;
    if (hold) await gate;
    return new Map([[SYM, { bidPrice: 100, askPrice: 100.02, bidQty: 10, askQty: 10 }]]);
  };
  let ledgerCalls = 0;
  const throwingLedger = {
    logEvent() {
      ledgerCalls += 1;
      throw new Error('simulated ledger write failure');
    },
  };
  const runtimeConfig = {
    feesPct: 0.3,
    minNetBasisPct: 0.25,
    persistTicks: 3,
    minQuoteVolume24h: 0,
    killSwitch: false,
    blockedSymbols: [],
  };
  const runtimeUniverse = [{
    symbol: SYM,
    base: 'TEST',
    quoteVolume24h: 50_000_000,
    hasSpot: true,
    hasPerp: true,
    perpMark: 100.01,
    fundingRate: 0.0001,
    nextFundingTime: Date.now() + 3_600_000,
    markUpdatedAt: Date.now(),
  }];
  const runtime = new BasisRuntime(throwingLedger, () => runtimeConfig, () => runtimeUniverse, fakeFetch);
  const firstStart = runtime.start();
  runtime.stop();
  hold = false;
  release();
  await firstStart;
  const stopped = runtime.connectionStatus();
  check('stopped generation cannot publish late book state', !stopped.running && stopped.lastBookTs === null);

  const callsBeforeRestart = fetchCalls;
  await Promise.all([runtime.start(), runtime.start()]);
  const restarted = runtime.connectionStatus();
  check('concurrent starts share one generation refresh', fetchCalls - callsBeforeRestart === 2, `calls=${fetchCalls - callsBeforeRestart}`);
  check('fresh generation starts after cancelled generation', restarted.running && restarted.bookState === 'fresh');
  check('ledger callback failures do not abort engine refresh', restarted.lastError?.includes('basis-runtime.ledger') === true);
  check('ledger failure handling is non-recursive and bounded', ledgerCalls > 0 && ledgerCalls < 50, `calls=${ledgerCalls}`);
  runtime.stop();
}

// =====================================================================
section('25. SAFETY: runtime retries an empty startup and trusts source timestamps');
{
  const runtimeConfig = {
    feesPct: 0.3,
    minNetBasisPct: 0.25,
    persistTicks: 3,
    minQuoteVolume24h: 0,
    killSwitch: false,
    blockedSymbols: [],
  };
  let universe = [];
  let fetchCalls = 0;
  const fakeFetch = async () => {
    fetchCalls += 1;
    return new Map([[SYM, { bidPrice: 100, askPrice: 100.02, bidQty: 10, askQty: 10 }]]);
  };
  const ledger = { logEvent() {} };
  const runtime = new BasisRuntime(ledger, () => runtimeConfig, () => universe, fakeFetch);
  await runtime.start();
  check('empty startup avoids pointless book requests', fetchCalls === 0);
  universe = [{
    symbol: SYM,
    base: 'TEST',
    quoteVolume24h: 50_000_000,
    hasSpot: true,
    hasPerp: true,
    perpMark: 100.01,
    fundingRate: 0.0001,
    nextFundingTime: Date.now() + 3_600_000,
    markUpdatedAt: Date.now(),
  }];
  await runtime.refreshBooks();
  check('short book refresh recovers an initially empty universe', fetchCalls === 2 && runtime.connectionStatus().bookState === 'fresh');
  runtime.stop();

  const staleRuntime = new BasisRuntime(
    ledger,
    () => runtimeConfig,
    () => [{ ...universe[0], markUpdatedAt: Date.now() - 60_000 }],
    fakeFetch,
  );
  await staleRuntime.start();
  check('unchanged stale mark is not refreshed by adapter receipt time', staleRuntime.connectionStatus().markState === 'stale');
  staleRuntime.stop();
}

// ---------- summary ----------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  ✗ ${f.name}`);
  process.exit(1);
}

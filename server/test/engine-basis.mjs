#!/usr/bin/env node
/**
 * Basis engine — synthetic proof. ZERO network: every case drives the built
 * engine through the scripted replay harness with a ManualClock.
 * Run after `npm run build -w server`:  node server/test/engine-basis.mjs
 * Prints ✓/✗ per case and exits non-zero on any failure.
 */
import { createReplayHarness, buildSnapshots } from '../dist/engine/basis/index.js';

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

// ---------- summary ----------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  ✗ ${f.name}`);
  process.exit(1);
}

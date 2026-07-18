#!/usr/bin/env node
/**
 * Volume/wakeup engine — synthetic proof suite (TASK_VOLUME_OVERDRIVE.md Phase 3).
 * ZERO network: everything runs on ManualClock + scripted tapes.
 * Run: node server/test/engine-volume.mjs   (after npm run build)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VolumeEngine,
  VolumeSnapshots,
  VolumeFeatureEngine,
  SyntheticReplayRunner,
  ManualClock,
  volumeConfig,
  seededRng,
  quietTape,
  burstTape,
  steadyBooks,
  mapAggTrade,
  miniTickerDelta,
} from '../dist/engine/volume/index.js';
import { VolumeRuntime } from '../dist/services/volumeRuntime.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let passCount = 0;
let failCount = 0;

function check(name, pass, detail = '') {
  if (pass) passCount++;
  else failCount++;
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n— ${title}`);
}
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------- shared scenario plumbing ----------

const SYM = 'WAKEUSDT';
const PRICE = 0.05;
const TEST_CFG = {
  baselineMinSamples: 30,
  baselineWindowMinutes: 60,
  tickMs: 1000,
  minFocusDwellMs: 4000,
  verificationGraceMs: 3000,
  cooldownMs: 60_000,
};

const TEST_SYMBOLS = [
  SYM,
  'AAAUSDT', 'BBBUSDT', 'CCCUSDT', 'DDDUSDT', 'PINUSDT',
  'E1USDT', 'E2USDT', 'E3USDT', 'E4USDT', 'E5USDT',
];

const symbolMeta = (symbol) => ({
  symbol,
  base: symbol.slice(0, -4),
  quote: 'USDT',
  hasSpot: true,
  hasPerp: false,
  marginBorrowable: null,
  minNotionalUsd: 5,
  tickSize: 0.00001,
  stepSize: 0.1,
  quoteVolume24hUsd: 5_000_000,
  eligible: true,
  ineligibleReason: null,
});

function mkWorld(cfg = {}) {
  const clock = new ManualClock(0);
  const engine = new VolumeEngine(clock, { ...TEST_CFG, ...cfg });
  const runner = new SyntheticReplayRunner(engine, clock);
  engine.start();
  engine.setUniverse(TEST_SYMBOLS.map(symbolMeta));
  return { clock, engine, runner };
}

/** 35 quiet minutes → trusted "dead" baseline (~300 USD/min, 4 trades/min). */
function warmup(runner, rand, opts = {}) {
  const minutes = opts.minutes ?? 35;
  const symbols = opts.symbols ?? [SYM];
  const bookMinutes = opts.bookMinutes ?? minutes;
  const script = symbols.map((symbol) => ({
    symbol,
    trades: quietTape({ startMs: 0, minutes, quotePerMin: 300, tradesPerMin: 4, price: PRICE, rand }),
    books: steadyBooks({
      startMs: 0,
      durationMs: bookMinutes * 60_000,
      everyMs: 5_000,
      mid: PRICE,
      spreadBps: 4,
      qty: opts.bookQty ?? 1_000_000,
    }),
  }));
  runner.play(script, minutes * 60_000, { tickMs: 30_000, tickOnEvent: false });
}

function cleanBurst(rand, opts = {}) {
  return burstTape({
    startMs: opts.startMs ?? 0,
    durationMs: opts.durationMs ?? 15_000,
    quotePerSec: opts.quotePerSec ?? 2_000,
    tradesPerSec: opts.tradesPerSec ?? 20,
    startPrice: opts.startPrice ?? PRICE,
    totalMovePct: opts.totalMovePct ?? 1.2,
    takerBuyRatio: opts.takerBuyRatio ?? 0.85,
    rand,
    uniformQty: opts.uniformQty,
    alternateSides: opts.alternateSides,
  });
}

function burstBooks(opts = {}) {
  return steadyBooks({
    startMs: opts.startMs ?? 0,
    durationMs: opts.durationMs ?? 20_000,
    everyMs: 500,
    mid: opts.mid ?? PRICE,
    spreadBps: opts.spreadBps ?? 4,
    qty: opts.qty ?? 1_000_000,
  });
}

const hasReject = (engine, code) =>
  engine.decisions(2000).some((d) => d.kind === 'reject' && d.rejectCode === code);
const rejectWithDetail = (engine, code, detail) =>
  engine.decisions(2000).find(
    (d) => d.kind === 'reject' && d.rejectCode === code && d.evidence?.detailCode === detail,
  );

// ================================================================
section('1. dead symbol wakes from low baseline ⇒ candidate');
{
  const rand = seededRng(11);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  const snap = engine.featureSnapshot(SYM);
  check('baseline ready after warmup', snap.baselineReady === true, `samples=${snap.baseline.samples}`);
  check('symbol classified dead vs own history', snap.baseline.isDead === true, `median/min=${snap.baseline.quotePerMinMedian.toFixed(1)}`);
  runner.play(
    [{ symbol: SYM, trades: cleanBurst(rand, { quotePerSec: 250, tradesPerSec: 4, durationMs: 2_500, totalMovePct: 0.05 }), books: burstBooks({ durationMs: 2_500 }) }],
    2_500,
  );
  check('state is WATCHING (candidate)', engine.focusMgr.stateOf(SYM) === 'WATCHING', engine.focusMgr.stateOf(SYM));
  check('candidate_opened ledgered', engine.memSink.byKind('candidate_opened').length >= 1);
  check('no focus yet', engine.memSink.byKind('focus_opened').length === 0);
  check('no proposal from a mere flicker', engine.proposalStore.all().length === 0);
}

// ================================================================
section('2. sustained volume + trade-count activation ⇒ focus → proposal');
{
  const rand = seededRng(22);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  runner.play([{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks() }], 16_000);
  check('focus_opened ledgered', engine.memSink.byKind('focus_opened').length === 1);
  const proposals = engine.proposalStore.all();
  check('exactly one proposal created', proposals.length === 1);
  const p = proposals[0];
  check('proposal direction long (taker-buy pressure)', p?.direction === 'long', p?.direction);
  check('proposal open/updated', p?.status === 'open' || p?.status === 'updated', p?.status);
  check('confidence in (0,1]', typeof p?.confidence === 'number' && p.confidence > 0 && p.confidence <= 1, `c=${p?.confidence?.toFixed(3)}`);
  check('invalidation metadata present', typeof p?.invalidation === 'string' && p.invalidation.includes('volume multiple'));
  check('state is PROPOSED', engine.focusMgr.stateOf(SYM) === 'PROPOSED', engine.focusMgr.stateOf(SYM));
  check('no automatic order anywhere', engine.memSink.all().every((e) => !/order/.test(e.kind)));
}

// ================================================================
section('3. one-print fake spike ⇒ reject');
{
  const rand = seededRng(33);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  runner.play(
    [{ symbol: SYM, trades: [{ atMs: 0, price: PRICE, qty: 100_000, isBuyerMaker: false }], books: burstBooks({ durationMs: 10_000 }) }],
    10_000,
  );
  check('rejected as one_print_spike', hasReject(engine, 'one_print_spike'));
  check('no proposal from one print', engine.proposalStore.all().length === 0);
  check('symbol cooled down after fake', engine.focusMgr.stateOf(SYM) === 'COOLDOWN', engine.focusMgr.stateOf(SYM));
}

// ================================================================
section('4. volume without price follow-through ⇒ reject');
{
  const rand = seededRng(44);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  runner.play(
    [{ symbol: SYM, trades: cleanBurst(rand, { totalMovePct: 0.02, durationMs: 10_000 }), books: burstBooks() }],
    12_000,
  );
  check('rejected as price_no_followthrough', hasReject(engine, 'price_no_followthrough'));
  check('no proposal without follow-through', engine.proposalStore.all().length === 0);
}

// ================================================================
section('5. already-extended pump ⇒ reject (too late)');
{
  const rand = seededRng(55);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  const prePump = burstTape({
    startMs: 0, durationMs: 180_000, quotePerSec: 30, tradesPerSec: 2,
    startPrice: PRICE, totalMovePct: 4, takerBuyRatio: 0.7, rand,
  });
  const lateBurst = cleanBurst(rand, { startMs: 180_000, startPrice: PRICE * 1.04, totalMovePct: 0.8, durationMs: 10_000 });
  runner.play(
    [{ symbol: SYM, trades: [...prePump, ...lateBurst], books: burstBooks({ durationMs: 195_000, mid: PRICE * 1.02 }) }],
    192_000,
  );
  check('rejected as move_already_extended', hasReject(engine, 'move_already_extended'));
  check('no proposal chasing an extended move', engine.proposalStore.all().length === 0);
}

// ================================================================
section('6. bad spread / thin depth ⇒ reject');
{
  const rand = seededRng(66);
  const wide = mkWorld();
  warmup(wide.runner, rand);
  wide.runner.play(
    [{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks({ spreadBps: 60 }) }],
    12_000,
  );
  check('wide spread rejected as spread_too_wide', hasReject(wide.engine, 'spread_too_wide'));
  check('no proposal through a 60bps spread', wide.engine.proposalStore.all().length === 0);

  const thin = mkWorld();
  warmup(thin.runner, seededRng(67), { bookQty: 2_000 });
  thin.runner.play(
    [{ symbol: SYM, trades: cleanBurst(seededRng(68)), books: burstBooks({ qty: 2_000 }) }],
    12_000,
  );
  check('thin book rejected as depth_too_thin', hasReject(thin.engine, 'depth_too_thin'));
  check('no proposal into a 100-USD book', thin.engine.proposalStore.all().length === 0);
}

// ================================================================
section('7. baseline missing ⇒ never proposes, named reject');
{
  const rand = seededRng(77);
  const { engine, runner } = mkWorld();
  warmup(runner, rand, { minutes: 10 }); // 10 < baselineMinSamples(30)
  runner.play([{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks() }], 16_000);
  check('rejected as baseline_missing', hasReject(engine, 'baseline_missing'));
  check('never focused', engine.memSink.byKind('focus_opened').length === 0);
  check('never proposed', engine.proposalStore.all().length === 0);
}

// ================================================================
section('8. focus caps + priority eviction + pinned survives');
{
  const rand = seededRng(88);
  const world = mkWorld({ focusSoftCap: 3, focusHardCap: 5, minFocusDwellMs: 60_000 });
  const { engine, runner } = world;
  const A = 'AAAUSDT', B = 'BBBUSDT', C = 'CCCUSDT', D = 'DDDUSDT', PIN = 'PINUSDT';
  engine.pin(PIN);
  warmup(runner, rand, { symbols: [PIN, A, B, D, C] });
  check('pinned symbol focused via reserve slot', engine.focusMgr.isFocused(PIN));

  const wake = (sym, quotePerSec, tradesPerSec) => ({
    symbol: sym,
    trades: cleanBurst(rand, { quotePerSec, tradesPerSec }),
    books: burstBooks(),
  });
  runner.play([wake(A, 2_000, 20), wake(B, 500, 10), wake(D, 300, 6)], 20_000);
  check('soft cap holds at 3', engine.focusMgr.focusSessions().length === 3, `size=${engine.focusMgr.focusSessions().length}`);
  check('A and B focused, D not (priority too low)',
    engine.focusMgr.isFocused(A) && engine.focusMgr.isFocused(B) && !engine.focusMgr.isFocused(D));
  check('D stays a candidate', engine.focusMgr.stateOf(D) === 'WATCHING', engine.focusMgr.stateOf(D));

  runner.play([wake(C, 4_000, 30)], 8_000);
  check('stronger fresher C admitted by evicting a stale member', engine.focusMgr.isFocused(C));
  const evictions = engine.focusMgr.closedFocusSessions().filter((s) => s.exitReason === 'capacity_evicted');
  check('exactly one stale member (A or B) capacity_evicted',
    evictions.length === 1 && [A, B].includes(evictions[0].symbol), evictions.map((s) => s.symbol).join(','));
  check('pinned symbol survived all evictions', engine.focusMgr.isFocused(PIN));
  check('D never got focus', engine.memSink.byKind('focus_opened').every((e) => e.symbol !== D));

  engine.pin('E1USDT'); engine.pin('E2USDT'); engine.pin('E3USDT'); engine.pin('E4USDT');
  check('hard cap 5 absolute', engine.focusMgr.focusSessions().length === 5, `size=${engine.focusMgr.focusSessions().length}`);
  engine.pin('E5USDT');
  check('pin beyond hard cap with all-pinned focus is refused', !engine.focusMgr.isFocused('E5USDT'));
  check('original pin still there', engine.focusMgr.isFocused(PIN));
}

// ================================================================
section('9. kill switch ⇒ blocked from execution path');
{
  const rand = seededRng(99);
  const armed = mkWorld();
  armed.engine.setKillSwitch(true);
  warmup(armed.runner, rand);
  armed.runner.play([{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks() }], 16_000);
  check('observation still works (focus opened)', armed.engine.memSink.byKind('focus_opened').length === 1);
  check('verified wakeup rejected with kill_switch_on', hasReject(armed.engine, 'kill_switch_on'));
  check('zero proposals under kill switch', armed.engine.proposalStore.all().length === 0);

  const live = mkWorld();
  warmup(live.runner, seededRng(100));
  live.runner.play([{ symbol: SYM, trades: cleanBurst(seededRng(101)), books: burstBooks() }], 16_000);
  const p = live.engine.proposalStore.all()[0];
  check('proposal exists with kill switch off', !!p);
  const ok = live.engine.intentFor(p.id);
  check('intent minted when allowed', ok.ok === true && ok.intent.side === 'BUY' && ok.intent.source === 'proposal');
  check('intent carries suggested notional', ok.ok && approx(ok.intent.notionalUsd, 10));
  live.engine.setKillSwitch(true);
  const blocked = live.engine.intentFor(p.id);
  check('kill switch blocks intent minting', blocked.ok === false && blocked.reason === 'kill_switch_on');
  check('block ledgered as risk_rejected/kill_switch_on',
    live.engine.memSink.byKind('risk_rejected').some((e) => e.rejectCode === 'kill_switch_on'));
  globalThis.__live = live; // reused by case 10
}

// ================================================================
section('10. one signal traceable end-to-end by correlationId');
{
  const { engine } = globalThis.__live;
  const p = engine.proposalStore.all()[0];
  const cid = p.correlationId;
  const chain = engine.memSink.byCorrelation(cid);
  const kinds = new Set(chain.map((e) => e.kind));
  check('candidate_opened in chain', kinds.has('candidate_opened'));
  check('focus_opened in chain', kinds.has('focus_opened'));
  check('strategy decisions in chain', kinds.has('strategy_decision'));
  check('proposal_created in chain', kinds.has('proposal_created'));
  check('risk_rejected (kill switch) in same chain', kinds.has('risk_rejected'));
  check('all decisions for the signal share the id',
    engine.decisions(2000).filter((d) => d.symbol === SYM && d.kind !== 'ignore').every((d) => d.correlationId === cid));
}

// ================================================================
section('11. snapshots return contract-shaped data');
{
  const rand = seededRng(111);
  const { engine, runner } = mkWorld();
  const fixture = JSON.parse(readFileSync(path.join(here, 'fixtures/volume/universe.json'), 'utf8'));
  engine.setUniverse(fixture.symbols);
  warmup(runner, rand);
  runner.play([{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks() }], 16_000);
  const snap = new VolumeSnapshots(engine);
  const st = snap.status();
  check('status shape', st.running === true && st.universeSize === 3 && st.eligibleSize === 2 &&
    typeof st.watching === 'number' && st.focused >= 1 && st.openProposals >= 1 &&
    typeof st.lastTickTs === 'number' && typeof st.heartbeatAgeMs === 'number');
  check('universe passthrough', snap.universe().length === 3 && snap.universe()[2].ineligibleReason === 'quote_volume_below_min');
  const ds = snap.decisions(3);
  check('decisions limit + shape', ds.length <= 3 && ds.every((d) =>
    typeof d.symbol === 'string' && d.strategy === 'volume_spike' &&
    typeof d.correlationId === 'string' && typeof d.evidence === 'object'));
  check('focus session shape', snap.focus().every((f) =>
    typeof f.enteredTs === 'number' && typeof f.score === 'number' && typeof f.pinned === 'boolean'));
  const pr = snap.proposals()[0];
  check('proposal shape', pr && typeof pr.id === 'string' && pr.strategy === 'volume_spike' &&
    ['long', 'short'].includes(pr.direction) && typeof pr.evidence === 'object' && pr.borrowStatus === 'not_needed');
  const evs = snap.events(10);
  check('events limit + shape', evs.length <= 10 && evs.every((e) =>
    typeof e.kind === 'string' && typeof e.ts === 'number' && typeof e.correlationId === 'string'));
  check('per-symbol features exposed', snap.featuresOf(SYM)?.baselineReady === true);
  check('ignore decisions counted, not stored', engine.ignoredCount() > 0 &&
    engine.decisions(2000).every((d) => d.kind !== 'ignore'));
}

// ================================================================
section('12. wash-y uniform tape ⇒ reject (invented signal)');
{
  const rand = seededRng(122);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  runner.play(
    [{ symbol: SYM, trades: cleanBurst(rand, { uniformQty: true, alternateSides: true, totalMovePct: 0.01, durationMs: 10_000 }), books: burstBooks() }],
    12_000,
  );
  const d = rejectWithDetail(engine, 'taker_imbalance_missing', 'wash_uniformity_suspect');
  check('wash tape rejected (mapped to taker_imbalance_missing)', !!d);
  check('washScore evidence attached', typeof d?.evidence?.washScore === 'number' && d.evidence.washScore >= 0.7, `score=${d?.evidence?.washScore?.toFixed(2)}`);
  check('no proposal from wash tape', engine.proposalStore.all().length === 0);
}

// ================================================================
section('13. depth vanishes during spike ⇒ reject (invented signal)');
{
  const rand = seededRng(133);
  const { engine, runner } = mkWorld({ benchmarkDepthUsd: 2_000 });
  warmup(runner, rand); // 50k USD top-of-book norm
  runner.play(
    [{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks({ qty: 60_000 }) }], // depth collapses to 3k
    12_000,
  );
  const d = rejectWithDetail(engine, 'depth_too_thin', 'depth_vanished');
  check('depth collapse rejected with depth_vanished detail', !!d, d ? `vsNorm=${(d.evidence.depthVsNorm * 100).toFixed(0)}%` : '');
  check('no proposal into vanished liquidity', engine.proposalStore.all().length === 0);
}

// ================================================================
section('14. proposal invalidation: volume normalizes ⇒ expired');
{
  const rand = seededRng(144);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  runner.play([{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks() }], 16_000);
  const p = engine.proposalStore.all()[0];
  check('proposal open before silence', p && (p.status === 'open' || p.status === 'updated'));
  runner.play([], 130_000); // dead silence
  check('proposal expired after volume normalized', engine.proposalStore.byId(p.id)?.status === 'expired');
  const exp = engine.memSink.byKind('proposal_expired').find((e) => e.payload?.id === p.id);
  check('expiry ledgered with named invalidation', exp?.payload?.invalidatedBy === 'volume_normalized', exp?.payload?.invalidatedBy);
  check('focus released after normalization', !engine.focusMgr.isFocused(SYM));
}

// ================================================================
section('15. cooldown blocks re-entry, then a real wakeup re-arms cleanly');
{
  const rand = seededRng(155);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  runner.play(
    [{ symbol: SYM, trades: [{ atMs: 0, price: PRICE, qty: 100_000, isBuyerMaker: false }], books: burstBooks({ durationMs: 10_000 }) }],
    10_000,
  );
  const firstReject = engine.decisions(2000).find((d) => d.rejectCode === 'one_print_spike');
  check('fake spike rejected first', !!firstReject);
  check('cooldown active', engine.focusMgr.stateOf(SYM) === 'COOLDOWN');
  const proposalsBefore = engine.proposalStore.all().length;
  runner.play([{ symbol: SYM, trades: cleanBurst(rand, { durationMs: 10_000 }), books: burstBooks() }], 12_000);
  check('genuine burst during cooldown still ignored', engine.proposalStore.all().length === proposalsBefore);
  runner.play([], 65_000); // cooldown lapses AND the 60s window drains past the mid-cooldown burst
  runner.play([{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks() }], 16_000);
  const p = engine.proposalStore.all()[0];
  check('post-cooldown wakeup proposes', !!p);
  check('new signal path gets a NEW correlationId', p && p.correlationId !== firstReject.correlationId);
}

// ================================================================
section('16. rolling window math is exact');
{
  const clock = new ManualClock(0);
  const feats = new VolumeFeatureEngine(volumeConfig({ largeTradeQuoteUsd: 200 }), clock);
  feats.onTrade({ symbol: 'X', price: 100, qty: 1, quoteQty: 100, isBuyerMaker: false, ts: 1_000 });
  feats.onTrade({ symbol: 'X', price: 101, qty: 2, quoteQty: 202, isBuyerMaker: true, ts: 1_500 });
  feats.onTrade({ symbol: 'X', price: 99, qty: 1, quoteQty: 99, isBuyerMaker: false, ts: 2_500 });
  clock.set(2_500);
  const f = feats.snapshotEx('X', 0);
  const w1 = f.windows['1s'];
  const w5 = f.windows['5s'];
  check('1s bucket isolation', approx(w1.quoteVolume, 99) && w1.tradeCount === 1 && approx(w1.avgTradeSize, 99));
  check('5s aggregation', approx(w5.quoteVolume, 401) && w5.tradeCount === 3 && approx(w5.avgTradeSize, 401 / 3));
  check('5s price move open→close', approx(w5.priceMovePct, -1));
  check('taker buy ratio', approx(w5.takerBuyRatio, 199 / 401));
  check('large trade counter', w5.largeTradeCount === 1);
  check('no baseline ⇒ multiples null, not fabricated', f.baselineReady === false && f.volumeMultiple['5s'] === null);
}

// ================================================================
section('17. stale book during burst ⇒ reject');
{
  const rand = seededRng(177);
  const { engine, runner } = mkWorld();
  warmup(runner, rand, { bookMinutes: 34 }); // books stop 1 min before burst
  runner.play([{ symbol: SYM, trades: cleanBurst(rand), books: [] }], 12_000);
  check('rejected as data_stale', hasReject(engine, 'data_stale'));
  check('no proposal on stale book', engine.proposalStore.all().length === 0);
}

// ================================================================
section('18. robust baseline: one freak minute cannot poison the norm');
{
  const rand = seededRng(188);
  const { engine, runner } = mkWorld();
  const monster = Array.from({ length: 10 }, (_, i) => ({
    atMs: 15 * 60_000 + i * 100, price: PRICE, qty: 1_000_000, isBuyerMaker: false,
  }));
  const script = [{
    symbol: SYM,
    trades: [...quietTape({ startMs: 0, minutes: 35, quotePerMin: 300, tradesPerMin: 4, price: PRICE, rand }), ...monster].sort((a, b) => a.atMs - b.atMs),
    books: steadyBooks({ startMs: 0, durationMs: 35 * 60_000, everyMs: 5_000, mid: PRICE, spreadBps: 4, qty: 1_000_000 }),
  }];
  runner.play(script, 35 * 60_000, { tickMs: 30_000, tickOnEvent: false });
  const b = engine.featureSnapshot(SYM).baseline;
  check('median unmoved by 500k freak minute', b.quotePerMinMedian < 1_000, `median=${b.quotePerMinMedian.toFixed(1)}`);
  runner.play([{ symbol: SYM, trades: cleanBurst(rand, { startMs: 0 }), books: burstBooks() }], 16_000);
  check('detection still fires against the robust norm', engine.proposalStore.all().length === 1);
}

// ================================================================
section('19. adapter mappers (fixture payloads, zero network)');
{
  const agg = mapAggTrade({ e: 'aggTrade', E: 1, s: 'WAKEUSDT', a: 7, p: '0.05', q: '100', f: 10, l: 14, T: 999, m: true });
  check('aggTrade mapping', agg.tick.quoteQty === 5 && agg.tick.isBuyerMaker === true && agg.printCount === 5);
  const prev = { e: '24hrMiniTicker', E: 1000, s: 'WAKEUSDT', c: '0.05', o: '0.05', h: '0.05', l: '0.05', v: '100', q: '1000' };
  const cur = { ...prev, E: 2000, q: '1250' };
  const delta = miniTickerDelta(prev, cur);
  check('miniTicker delta → universe volume tick', delta?.quoteQty === 250 && delta.ts === 2000);
  check('shrinking 24h window never fabricates volume', miniTickerDelta(cur, prev) === null);
}

// ================================================================
section('20. feed boundary rejects unknown, invalid, stale, and out-of-order data');
{
  const clock = new ManualClock(100_000);
  const engine = new VolumeEngine(clock, TEST_CFG);
  engine.setUniverse([symbolMeta('SAFEUSDT')]);
  engine.start();

  check('unknown symbol trade rejected', engine.onTrade({
    symbol: 'UNKNOWNUSDT', price: 10, qty: 1, quoteQty: 10, isBuyerMaker: false, ts: 100_000,
  }) === false);
  check('non-finite trade rejected', engine.onTrade({
    symbol: 'SAFEUSDT', price: Number.NaN, qty: 1, quoteQty: 10, isBuyerMaker: false, ts: 100_000,
  }) === false);
  check('stale trade rejected', engine.onTrade({
    symbol: 'SAFEUSDT', price: 10, qty: 1, quoteQty: 10, isBuyerMaker: false, ts: 1,
  }) === false);
  check('valid trade accepted', engine.onTrade({
    symbol: 'SAFEUSDT', price: 10, qty: 1, quoteQty: 10, isBuyerMaker: false, ts: 100_000,
  }) === true);
  check('out-of-order trade rejected', engine.onTrade({
    symbol: 'SAFEUSDT', price: 10, qty: 1, quoteQty: 10, isBuyerMaker: false, ts: 99_999,
  }) === false);
  check('crossed book rejected', engine.onBook({
    symbol: 'SAFEUSDT', bid: 10.1, ask: 10, bidQty: 5, askQty: 5, ts: 100_000,
  }) === false);
  check('non-positive depth rejected', engine.onBook({
    symbol: 'SAFEUSDT', bid: 9.9, ask: 10, bidQty: 0, askQty: 5, ts: 100_000,
  }) === false);
  check('valid book accepted', engine.onBook({
    symbol: 'SAFEUSDT', bid: 9.9, ask: 10, bidQty: 5, askQty: 5, ts: 100_000,
  }) === true);
  check('out-of-order book rejected', engine.onBook({
    symbol: 'SAFEUSDT', bid: 9.9, ask: 10, bidQty: 5, askQty: 5, ts: 99_999,
  }) === false);
  check('only accepted trade reached rolling state', approx(engine.featureSnapshot('SAFEUSDT').windows['1s'].quoteVolume, 10));
}

// ================================================================
section('21. universe reconciliation prunes stale symbol state');
{
  const clock = new ManualClock(200_000);
  const engine = new VolumeEngine(clock, TEST_CFG);
  engine.setUniverse([symbolMeta('OLDUSDT')]);
  engine.start();
  engine.onTrade({ symbol: 'OLDUSDT', price: 2, qty: 2, quoteQty: 4, isBuyerMaker: false, ts: 200_000 });
  engine.onBook({ symbol: 'OLDUSDT', bid: 1.99, ask: 2.01, bidQty: 100, askQty: 100, ts: 200_000 });
  check('old symbol initially observed', engine.featureSnapshot('OLDUSDT') !== null);
  engine.setUniverse([symbolMeta('NEWUSDT')]);
  check('removed symbol feature state pruned', engine.featureSnapshot('OLDUSDT') === null);
  check('removed symbol no longer accepts input', engine.onTrade({
    symbol: 'OLDUSDT', price: 2, qty: 2, quoteQty: 4, isBuyerMaker: false, ts: 200_000,
  }) === false);
  check('new universe is authoritative', engine.universe().length === 1 && engine.universe()[0].symbol === 'NEWUSDT');
}

// ================================================================
section('22. lifecycle and proposal persistence are idempotent');
{
  const clock = new ManualClock(300_000);
  const engine = new VolumeEngine(clock, TEST_CFG);
  engine.setUniverse([symbolMeta('IDEMUSDT')]);
  engine.start();
  engine.start();
  check('double start emits one engine_started event', engine.memSink.byKind('engine_started').length === 1);
  engine.onTrade({ symbol: 'IDEMUSDT', price: 5, qty: 2, quoteQty: 10, isBuyerMaker: false, ts: 300_000 });
  engine.onBook({ symbol: 'IDEMUSDT', bid: 4.99, ask: 5.01, bidQty: 100, askQty: 100, ts: 300_000 });
  const feature = engine.featureSnapshot('IDEMUSDT');
  const decision = {
    symbol: 'IDEMUSDT',
    ts: 300_000,
    strategy: 'volume_spike',
    kind: 'proposal',
    rejectCode: null,
    humanReason: 'same verified signal',
    correlationId: 'same-correlation',
    evidence: { direction: 'long', confidence: 0.8 },
  };
  engine.proposalStore.upsertFromDecision(decision, feature);
  engine.proposalStore.upsertFromDecision(decision, feature);
  check('identical proposal persisted exactly once', engine.memSink.byKind('proposal_created').length === 1 &&
    engine.memSink.byKind('proposal_updated').length === 0);
  engine.stop();
  engine.stop();
  check('double stop emits one engine_stopped event', engine.memSink.byKind('engine_stopped').length === 1);
}

// ================================================================
section('23. runtime symbol policy applies immediately without cooldown debt');
{
  const clock = new ManualClock(400_000);
  const engine = new VolumeEngine(clock, { ...TEST_CFG, heartbeatMs: 30_000 });
  engine.setUniverse([symbolMeta('POLICYUSDT')]);
  engine.setSymbolPolicy([], []);
  engine.start();
  engine.onTrade({ symbol: 'POLICYUSDT', price: 10, qty: 1, quoteQty: 10, isBuyerMaker: false, ts: 400_000 });
  engine.onBook({ symbol: 'POLICYUSDT', bid: 9.99, ask: 10.01, bidQty: 100, askQty: 100, ts: 400_000 });
  engine.tick();
  clock.advance(2_000);
  engine.tick();
  check('blocked decision persisted once inside dedupe window',
    engine.memSink.byKind('strategy_decision').filter((event) => event.rejectCode === 'symbol_blocked').length === 1);
  check('policy rejection does not create cooldown', !engine.focusMgr.inCooldown('POLICYUSDT'));
  engine.setSymbolPolicy(['POLICYUSDT'], []);
  clock.advance(1_000);
  engine.tick();
  check('new allowlist takes effect on next tick', !engine.decisions(10).some((decision) =>
    decision.ts === clock.now() && decision.rejectCode === 'symbol_blocked'));
  check('symbol remains free of stale cooldown', engine.focusMgr.stateOf('POLICYUSDT') === 'IDLE');
}

// ================================================================
section('24. external sink failures are contained');
{
  const clock = new ManualClock(500_000);
  let deliveryAttempts = 0;
  let durableDeliveries = 0;
  const engine = new VolumeEngine(clock, TEST_CFG, {
    emit: () => {
      deliveryAttempts += 1;
      if (deliveryAttempts === 1) return Promise.reject(new Error('synthetic sink failure'));
      durableDeliveries += 1;
      return Promise.resolve();
    },
  });
  const retryableEvent = {
    kind: 'strategy_decision',
    ts: clock.now(),
    symbol: 'SINKUSDT',
    strategy: 'volume_spike',
    correlationId: 'sink-retry-correlation',
    rejectCode: 'data_stale',
    message: 'retry durable delivery',
    payload: { proof: 'RB-01' },
  };
  engine.sink.emit(retryableEvent);
  await Promise.resolve();
  await Promise.resolve();
  engine.sink.emit(retryableEvent);
  await Promise.resolve();
  await Promise.resolve();
  engine.sink.emit(retryableEvent);
  check('memory evidence remains available exactly once',
    engine.memSink.byKind('strategy_decision').filter((event) => event.correlationId === 'sink-retry-correlation').length === 1);
  check('async sink rejection recorded without escaping', engine.sinkFailures() >= 1);
  check('failed async delivery is retried until one durable success',
    deliveryAttempts === 2 && durableDeliveries === 1,
    `attempts=${deliveryAttempts}, durable=${durableDeliveries}`);

  let ledgerAttempts = 0;
  let ledgerCommits = 0;
  const runtime = new VolumeRuntime(
    {
      logEvent: () => {
        ledgerAttempts += 1;
        if (ledgerAttempts === 1) throw new Error('synthetic ledger failure');
        ledgerCommits += 1;
      },
    },
    () => ({
      killSwitch: true,
      maxOrderNotionalUsd: 10,
      minQuoteVolume24h: 3_000_000,
      allowedSymbols: [],
      blockedSymbols: [],
    }),
    () => [],
  );
  try { runtime.persistEvent(retryableEvent); } catch {}
  runtime.persistEvent(retryableEvent);
  runtime.persistEvent(retryableEvent);
  check('runtime ledger dedupe records only committed delivery',
    ledgerAttempts === 2 && ledgerCommits === 1,
    `attempts=${ledgerAttempts}, committed=${ledgerCommits}`);
}

// ================================================================
section('25. live runtime start/stop generations are idempotent (zero network)');
{
  const config = {
    killSwitch: true,
    maxOrderNotionalUsd: 10,
    minQuoteVolume24h: 3_000_000,
    allowedSymbols: [],
    blockedSymbols: [],
  };
  const runtime = new VolumeRuntime(
    { logEvent: () => { throw new Error('synthetic ledger outage'); } },
    () => config,
    () => [],
  );
  await Promise.all([runtime.start(), runtime.start()]);
  check('concurrent starts share one live generation', runtime.connectionStatus().running === true);
  check('empty universe opens no sockets', runtime.connectionStatus().streamConnections === 0);
  check('ledger outage is surfaced without stopping runtime', runtime.snapshot().status.ledgerFailures >= 1);
  runtime.stop();
  runtime.stop();
  check('double stop leaves runtime stopped', runtime.connectionStatus().running === false);
  await runtime.start();
  check('restart creates a fresh live generation', runtime.connectionStatus().running === true);
  runtime.stop();
  check('final stop is clean', runtime.snapshot().status.running === false);
}

// ================================================================
section('26. hostile config values are normalized to bounded invariants');
{
  const cfg = volumeConfig({
    maxRawTrades: Number.POSITIVE_INFINITY,
    focusSoftCap: 50_000,
    focusHardCap: 50_000,
    tickMs: -1,
    baselineWindowMinutes: 1_000_000,
    baselineMinSamples: 1_000_000,
    onePrintDominanceRatio: 9,
  });
  check('non-finite override falls back to default', cfg.maxRawTrades === 512);
  check('focus capacity hard bounded', cfg.focusSoftCap === 100 && cfg.focusHardCap === 100);
  check('tick interval has safe floor', cfg.tickMs === 100);
  check('baseline history is bounded and internally consistent',
    cfg.baselineWindowMinutes === 1_440 && cfg.baselineMinSamples === 1_440);
  check('ratio threshold clamped', cfg.onePrintDominanceRatio === 1);
}

// ================================================================
section('27. proposal history has a hard retention cap');
{
  const clock = new ManualClock(600_000);
  const engine = new VolumeEngine(clock, TEST_CFG);
  engine.setUniverse([symbolMeta('CAPUSDT')]);
  engine.start();
  engine.onTrade({ symbol: 'CAPUSDT', price: 5, qty: 2, quoteQty: 10, isBuyerMaker: false, ts: 600_000 });
  engine.onBook({ symbol: 'CAPUSDT', bid: 4.99, ask: 5.01, bidQty: 100, askQty: 100, ts: 600_000 });
  const feature = engine.featureSnapshot('CAPUSDT');
  for (let index = 0; index < 2_005; index++) {
    const symbol = `P${index}USDT`;
    engine.proposalStore.upsertFromDecision({
      symbol,
      ts: clock.now(),
      strategy: 'volume_spike',
      kind: 'proposal',
      rejectCode: null,
      humanReason: 'retention proof',
      correlationId: `retention-${index}`,
      evidence: { direction: 'long', confidence: 0.5 },
    }, { ...feature, symbol });
  }
  check('proposal map never exceeds cap', engine.proposalStore.all().length === 2_000);
  check('capacity pruning is explicit in evidence', engine.memSink.byKind('proposal_expired').some((event) =>
    event.payload.invalidatedBy === 'capacity_pruned'));
}

// ---------- summary ----------
console.log(`\n${passCount} passed, ${failCount} failed`);
if (failCount > 0) process.exit(1);

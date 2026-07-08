/* Command Center — a strategy control room, not a homepage.
   Zone 1 (overview): equity + quant performance truth from the ledger —
   cumulative PnL, daily bars, distribution, attribution, profit structure.
   Zone 2 (strategy brain): the engines and their live output. Small names,
   no boxes — this is where behind-the-scenes scripts are monitored.
   Zone 3 (ops): control & security, system sources, market intelligence.
   Every number is server truth. Metrics that need more history say so. */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useRefreshSignal } from '../lib/refresh';
import { Dot, Empty, Group, PageHead, Pill, Row, Sec, Seg, TINT, type Tone } from '../components/px';
import { PerfChart, DistChart, EquityChart, WinLoseBar, type PerfDay } from '../components/PerfChart';
import { Donut } from '../components/Donut';
import { TokenIcon, brandColor } from '../components/TokenIcon';
import { Num } from '../components/Num';
import {
  IconBook,
  IconTerminal,
  IconBrain,
  IconCalendar,
  IconChart,
  IconGrid,
  IconKey,
  IconList,
  IconNewspaper,
  IconPower,
  IconPulse,
  IconRadar,
  IconShield,
  IconTicket,
  IconWallet,
  IconWifi,
} from '../components/Icons';
import { baseOf, duration, fmtMoney, fmtPct, fmtPrice, signClass, timeAgo } from '../format';
import type { LedgerEvent } from '../types';

interface PnlData {
  realizedByDay: PerfDay[];
  realizedBySymbol: { symbol: string; usd: number }[];
  feesByAsset: { asset: string; amount: number }[];
  equitySnapshots: { ts: number; totalUsdt: number }[];
}

interface NewsItem { id: string; title: string; url: string; date?: string }
interface CalItem { id: string; title: string; country: string; date: string; importance: number }

function num(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function rejectionInfo(ev: LedgerEvent): string {
  const d = (ev.data && typeof ev.data === 'object' ? ev.data : {}) as Record<string, unknown>;
  const reasons = Array.isArray(d.reasons) ? d.reasons.map(String).filter(Boolean).join(' / ') : '';
  return reasons || 'risk gate rejected the intent';
}

function maxDrawdown(values: number[]): { pct: number; usd: number } | null {
  if (values.length < 2) return null;
  let peak = -Infinity;
  let ddPct = 0;
  let ddUsd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    if (peak > 0) {
      ddPct = Math.max(ddPct, ((peak - v) / peak) * 100);
      ddUsd = Math.max(ddUsd, peak - v);
    }
  }
  return { pct: ddPct, usd: ddUsd };
}

/** Annualized Sharpe from equity snapshot day-over-day returns. Honest: null until enough points. */
function sharpe(equity: number[]): number | null {
  if (equity.length < 8) return null;
  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1] > 0) rets.push(equity[i] / equity[i - 1] - 1);
  }
  if (rets.length < 7) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const varr = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  const sd = Math.sqrt(varr);
  if (sd === 0) return null;
  // snapshots are ~15min; scale to daily (96 per day) then annualize
  return (mean / sd) * Math.sqrt(96 * 365);
}

export function Dashboard() {
  const { state, setPage, openDetail, approveProposal } = useStore();
  const [pnl, setPnl] = useState<PnlData | null>(null);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [cal, setCal] = useState<CalItem[] | null>(null);
  const [perfMode, setPerfMode] = useState<'usd' | 'pct' | 'equity'>('usd');
  const [btcCloses, setBtcCloses] = useState<{ t: number; v: number }[] | null>(null);
  const [tick, setTick] = useState(0);
  useRefreshSignal(() => setTick((n) => n + 1));

  useEffect(() => {
    let alive = true;
    void fetch('/api/pnl').then((r) => (r.ok ? r.json() : null)).then((d) => alive && d && setPnl(d as PnlData)).catch(() => undefined);
    const t = window.setInterval(() => {
      void fetch('/api/pnl').then((r) => (r.ok ? r.json() : null)).then((d) => alive && d && setPnl(d as PnlData)).catch(() => undefined);
    }, 30_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [tick]);

  useEffect(() => {
    let alive = true;
    void fetch('/api/news?catalog=48').then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setNews(((d as { items: NewsItem[] }).items ?? []).slice(0, 3)))
      .catch(() => alive && setNews([]));
    void fetch('/api/klines?symbol=BTCUSDT&interval=1d&limit=120')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && Array.isArray(d) && setBtcCloses(d as { t: number; v: number }[]))
      .catch(() => undefined);
    void fetch('/api/calendar').then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        const items = ((d as { items: CalItem[] }).items ?? []).filter((it) => it.importance >= 1 && new Date(it.date).getTime() > Date.now());
        setCal(items.slice(0, 3));
      })
      .catch(() => alive && setCal([]));
    return () => { alive = false; };
  }, [tick]);

  const s = state;
  const days = pnl?.realizedByDay ?? [];
  useEffect(() => {
    if (days.length < 2 && (pnl?.equitySnapshots.length ?? 0) >= 2) setPerfMode('equity');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pnl === null]);
  const equity = (pnl?.equitySnapshots ?? []).map((x) => x.totalUsdt).filter((v) => Number.isFinite(v));
  const bySymbol = pnl?.realizedBySymbol ?? [];
  const proposals = useMemo(() => [...(s?.proposals ?? [])].sort((a, b) => b.netEdgePct - a.netEdgePct), [s?.proposals]);
  const openOrders = s?.openOrders ?? [];
  const positions = s?.positions ?? [];
  const exposure = positions.reduce((acc, p) => acc + p.valueUsdt, 0);
  const heldNotional = openOrders.reduce((acc, o) => acc + num(o.price) * num(o.origQty), 0);
  const lastRejection = useMemo(
    () =>
      (s?.events ?? []).find((ev) => {
        if (ev.kind !== 'risk_decision') return false;
        const d = (ev.data && typeof ev.data === 'object' ? ev.data : {}) as Record<string, unknown>;
        return d.allowed === false;
      }) ?? null,
    [s?.events],
  );

  // ---- honest quant metrics -------------------------------------------
  const totalRealized = days.reduce((acc, d) => acc + d.usd, 0);
  const winDays = days.filter((d) => d.usd > 0);
  const lossDays = days.filter((d) => d.usd < 0);
  const grossProfit = winDays.reduce((acc, d) => acc + d.usd, 0);
  const grossLoss = Math.abs(lossDays.reduce((acc, d) => acc + d.usd, 0));
  const winRate = days.length ? (winDays.length / days.length) * 100 : null;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : winDays.length > 0 ? Infinity : null;
  const dd = maxDrawdown(equity);
  const sr = sharpe(equity);
  const baseEquity = equity[0] ?? null;
  const totalPct = baseEquity && baseEquity > 0 ? (totalRealized / baseEquity) * 100 : null;
  const usdtFees = pnl?.feesByAsset.find((f) => f.asset === 'USDT')?.amount ?? 0;
  const otherFeeAssets = (pnl?.feesByAsset ?? []).filter((f) => f.asset !== 'USDT').length;
  const winnersBySymbol = bySymbol.filter((r) => r.usd > 0);

  // BTC buy & hold benchmark: real daily closes aligned to the PnL days.
  const bench = useMemo(() => {
    if (!btcCloses?.length || !days.length) return null;
    const closeByDay = new Map<string, number>();
    for (const k of btcCloses) closeByDay.set(new Date(k.t).toISOString().slice(0, 10), k.v);
    const first = closeByDay.get(days[0].day);
    if (!first || first <= 0) return null;
    let last = first;
    return days.map((d) => {
      const c = closeByDay.get(d.day);
      if (c && c > 0) last = c;
      return (last / first - 1) * 100;
    });
  }, [btcCloses, days]);

  // Run-up / drawdown segments from equity snapshots (peak/trough walk).
  const segs = useMemo(() => {
    const snaps = pnl?.equitySnapshots ?? [];
    if (snaps.length < 3) return null;
    const ups: { ms: number; pct: number }[] = [];
    const downs: { ms: number; pct: number }[] = [];
    let start = 0;
    let dir: 'up' | 'down' | null = null;
    for (let i = 1; i < snaps.length; i++) {
      const step: 'up' | 'down' = snaps[i].totalUsdt >= snaps[i - 1].totalUsdt ? 'up' : 'down';
      if (dir === null) dir = step;
      if (step !== dir || i === snaps.length - 1) {
        const endIdx = i === snaps.length - 1 && step === dir ? i : i - 1;
        const pct = snaps[start].totalUsdt > 0 ? (snaps[endIdx].totalUsdt / snaps[start].totalUsdt - 1) * 100 : 0;
        const ms = snaps[endIdx].ts - snaps[start].ts;
        if (Math.abs(pct) >= 0.01 && ms > 0) (dir === 'up' ? ups : downs).push({ ms, pct });
        start = endIdx;
        dir = step;
      }
    }
    const avg = (arr: { ms: number }[]) => (arr.length ? arr.reduce((x, y) => x + y.ms, 0) / arr.length : null);
    const maxUp = ups.length ? Math.max(...ups.map((u) => u.pct)) : null;
    return { ups, downs, avgUpMs: avg(ups), avgDownMs: avg(downs), maxUp };
  }, [pnl?.equitySnapshots]);

  // Day analysis (TradingView "trades analysis", honestly per-day).
  const dayStats = useMemo(() => {
    if (!days.length) return null;
    const best = days.reduce((a, b) => (b.usd > a.usd ? b : a));
    const worst = days.reduce((a, b) => (b.usd < a.usd ? b : a));
    const winsArr = days.filter((d) => d.usd > 0).map((d) => d.usd);
    const lossArr = days.filter((d) => d.usd < 0).map((d) => d.usd);
    const avgWin = winsArr.length ? winsArr.reduce((a, b) => a + b, 0) / winsArr.length : null;
    const avgLoss = lossArr.length ? Math.abs(lossArr.reduce((a, b) => a + b, 0) / lossArr.length) : null;
    let streak = 0;
    let maxStreak = 0;
    for (const d of days) {
      streak = d.usd > 0 ? streak + 1 : 0;
      maxStreak = Math.max(maxStreak, streak);
    }
    return { best, worst, avgWin, avgLoss, plRatio: avgWin !== null && avgLoss ? avgWin / avgLoss : null, maxStreak, curStreak: streak };
  }, [days]);

  if (!s) {
    return (
      <div className="container page hp-page">
        <PageHead mark={<IconGrid size={18} />} tone="idle" title="Dashboard" sub="Strategy control room — engines, risk, and ledger truth in one view." />
        <div className="hp-loading">
          <Pill tone="idle">Connecting</Pill>
          <b>Waiting for server state…</b>
        </div>
      </div>
    );
  }

  const modeTone: Tone = s.config.killSwitch ? 'bad' : s.config.liveTradingEnabled ? 'ok' : 'warn';
  const modeLabel = s.config.killSwitch ? 'Halted' : s.config.liveTradingEnabled ? 'Live armed' : 'Manual only';
  const scannerFresh = s.scanner.lastTickTs ? Date.now() - s.scanner.lastTickTs < 45_000 : false;
  const acct = s.account;
  const posture = s.binance.keyPosture;

  const structureRows = [
    { label: 'Total profit', value: grossProfit, cls: 'pos' },
    { label: 'Total loss', value: -grossLoss, cls: 'neg' },
    { label: 'Fees (USDT)', value: -usdtFees, cls: 'fee' },
    { label: 'Net PnL', value: totalRealized - usdtFees, cls: totalRealized - usdtFees >= 0 ? 'pos' : 'neg' },
  ];
  const structureMax = Math.max(1e-9, ...structureRows.map((r) => Math.abs(r.value)));

  return (
    <div className="container page hp-page wide dash-page">
      <PageHead
        mark={<IconGrid size={18} />}
        tone={modeTone}
        title="Dashboard"
        sub="Strategy control room — engines, risk, and ledger truth in one view."
        meta={
          <>
            <Pill tone={modeTone}>{modeLabel}</Pill>
            <span>
              {s.binance.connected ? `account synced ${timeAgo(s.binance.lastSyncTs)}` : s.binance.keysPresent ? 'account sync failing' : 'account disconnected'}
            </span>
            <span className="hp-head-btns">
              <button className="hp-btn" type="button" onClick={() => setPage('opportunities')}>
                <IconRadar size={13} /> Queue{proposals.length ? ` · ${proposals.length}` : ''}
              </button>
            </span>
          </>
        }
      />

      {/* ================= ZONE 1 · OVERVIEW ============================ */}
      <section className="hp-group lg-feed dash-perf">
        <div className="lg-feed-head">
          <h3>Key stats</h3>
          <span className="hp-val">
            {perfMode === 'equity' ? (
              <>
                <span className="pc-key pos" /> live equity · {pnl?.equitySnapshots.length ?? 0} snapshots
              </>
            ) : perfMode === 'usd' ? (
              <>
                <span className="pc-key pos" /> cumulative PnL
                <span className="pc-key bars" /> daily realized
              </>
            ) : (
              <>
                <span className="pc-key pos" /> strategy %
                <span className="pc-key bench" /> BTC buy &amp; hold
              </>
            )}
            <Seg
              value={perfMode}
              options={[
                { id: 'equity', label: 'Equity' },
                { id: 'usd', label: 'PnL' },
                { id: 'pct', label: 'ROI %' },
              ]}
              onChange={setPerfMode}
            />
          </span>
        </div>
      <div className="hp-stats dash-keystats">
        <div className="hp-stat">
          <span className="k">Total equity</span>
          <span className="v">{acct ? <Num value={acct.totalUsdt}>{fmtPrice(acct.totalUsdt)}</Num> : '—'}</span>
          <span className="s">{acct ? `${fmtPrice(acct.availableUsdt)} free · ${fmtPrice(exposure)} exposed` : 'read sync pending'}</span>
        </div>
        <div className="hp-stat">
          <span className="k">Total PnL</span>
          <span className={`v ${days.length ? signClass(totalRealized) : ''}`}>
            {days.length ? fmtPrice(totalRealized) : '—'}
          </span>
          <span className="s">{totalPct !== null && days.length ? `${totalPct >= 0 ? '+' : ''}${totalPct.toFixed(2)}% on starting equity` : `realized · ${days.length} day${days.length === 1 ? '' : 's'} of history`}</span>
        </div>
        <div className="hp-stat">
          <span className="k">Max drawdown</span>
          <span className="v">{dd ? `${dd.pct.toFixed(2)}%` : '—'}</span>
          <span className="s">{dd ? `${fmtPrice(dd.usd)} peak to trough` : 'needs equity snapshots'}</span>
        </div>
        <div className="hp-stat">
          <span className="k">Win rate</span>
          <span className="v">{winRate !== null ? `${winRate.toFixed(0)}%` : '—'}</span>
          <span className="s">{days.length ? `${winDays.length}W / ${lossDays.length}L days` : 'no closed PnL days yet'}</span>
        </div>
        <div className="hp-stat">
          <span className="k">Profit factor</span>
          <span className="v">{profitFactor === null ? '—' : profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}</span>
          <span className="s">{profitFactor === Infinity ? 'no losing day recorded yet' : 'gross profit / gross loss'}</span>
        </div>
        <div className="hp-stat">
          <span className="k">Sharpe</span>
          <span className="v">{sr !== null ? sr.toFixed(2) : '—'}</span>
          <span className="s">{sr !== null ? 'annualized from snapshots' : `needs ${Math.max(0, 8 - equity.length)} more snapshots`}</span>
        </div>
      </div>


        {perfMode === 'equity' ? (
          (pnl?.equitySnapshots.length ?? 0) >= 2 ? (
            <div className="dash-perf-body">
              <EquityChart snaps={pnl!.equitySnapshots} />
            </div>
          ) : (
            <div className="lg-empty-pad">
              <Empty title="Equity snapshots are warming up">The account is snapshotted every 15 minutes once connected.</Empty>
            </div>
          )
        ) : days.length >= 2 ? (
          <div className="dash-perf-body">
            <PerfChart days={days} mode={baseEquity && perfMode === 'pct' ? 'pct' : 'usd'} base={baseEquity} bench={bench} />
            {perfMode === 'pct' && !bench && <p className="loan-console-note">Benchmark needs BTC daily closes covering the PnL window.</p>}
          </div>
        ) : (
          <div className="lg-empty-pad">
            <Empty title="Realized PnL curve arms after the first closed round-trips">
              Switch to Equity for the live account curve — realized PnL and daily bars draw from ledgered fills only, never simulated.
            </Empty>
          </div>
        )}
      </section>

      {days.length === 0 && winnersBySymbol.length === 0 ? (
        <div className="hp-note dash-arming">
          Realized analytics — distribution, attribution, profit structure, day analysis — arm automatically when the first round-trips close. Nothing here is simulated.
        </div>
      ) : (
      <div className="dash-analytics">
        <section className="hp-group lg-feed">
          <div className="lg-feed-head">
            <h3>Returns distribution</h3>
            <span>{days.length ? `${days.length} daily results` : 'waiting'}</span>
          </div>
          {days.length >= 3 ? (
            <div className="dash-chart-pad"><DistChart days={days} /></div>
          ) : (
            <div className="lg-empty-pad"><Empty title="Needs 3+ PnL days">The histogram of daily results appears with history.</Empty></div>
          )}
        </section>

        <section className="hp-group lg-feed">
          <div className="lg-feed-head">
            <h3>Attribution</h3>
            <span>{winnersBySymbol.length ? `${bySymbol.length} symbols` : 'waiting'}</span>
          </div>
          {winnersBySymbol.length ? (
            <div className="dash-donut">
              <Donut slices={winnersBySymbol.map((r) => ({ label: baseOf(r.symbol), value: r.usd }))} size={124} />
              <div className="dash-donut-legend">
                {bySymbol.slice(0, 5).map((r) => (
                  <button key={r.symbol} type="button" onClick={() => openDetail(r.symbol)}>
                    <span><i style={{ background: brandColor(r.symbol) }} />{baseOf(r.symbol)}</span>
                    <b className={signClass(r.usd)}>{fmtPrice(r.usd)}</b>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="lg-empty-pad"><Empty title="No closed symbol PnL">Attribution starts after the first sell fill matches average cost.</Empty></div>
          )}
        </section>

        <section className="hp-group lg-feed">
          <div className="lg-feed-head">
            <h3>Profit structure</h3>
            <span>{otherFeeAssets ? `+${otherFeeAssets} non-USDT fee asset${otherFeeAssets === 1 ? '' : 's'}` : 'ledger totals'}</span>
          </div>
          <div className="dash-structure">
            {structureRows.map((r) => (
              <div key={r.label} className="dash-struct-row">
                <span className="dash-struct-label">{r.label}</span>
                <span className="dash-struct-track">
                  <i className={r.cls} style={{ width: `${Math.max(days.length ? 2 : 0, (Math.abs(r.value) / structureMax) * 100)}%` }} />
                </span>
                <b className={`num ${r.value > 0 ? 'up' : r.value < 0 ? 'down' : ''}`}>{days.length ? fmtPrice(r.value) : '—'}</b>
              </div>
            ))}
          </div>
        </section>
      </div>

      )}

      <div className="dash-analytics dash-analytics2">
        <section className="hp-group lg-feed">
          <div className="lg-feed-head">
            <h3>Run-ups &amp; drawdowns</h3>
            <span>{segs ? `${segs.ups.length} run-ups · ${segs.downs.length} drawdowns` : 'needs equity snapshots'}</span>
          </div>
          {segs ? (
            <dl className="lg-facts dash-facts">
              <div><dt>Avg run-up</dt><dd className="num">{segs.avgUpMs !== null ? duration(0, segs.avgUpMs) : '—'}</dd></div>
              <div><dt>Avg drawdown</dt><dd className="num">{segs.avgDownMs !== null ? duration(0, segs.avgDownMs) : '—'}</dd></div>
              <div><dt>Max run-up</dt><dd className="num up">{segs.maxUp !== null ? `+${segs.maxUp.toFixed(2)}%` : '—'}</dd></div>
              <div><dt>Max DD of capital</dt><dd className="num down">{dd && baseEquity ? `${((dd.usd / baseEquity) * 100).toFixed(2)}%` : '—'}</dd></div>
              <div><dt>Return / max DD</dt><dd className="num">{dd && dd.usd > 0 ? (totalRealized / dd.usd).toFixed(2) : '—'}</dd></div>
            </dl>
          ) : (
            <div className="lg-empty-pad"><Empty title="Needs 3+ equity snapshots">Run-up and drawdown durations are measured on the real equity curve.</Empty></div>
          )}
        </section>

        <section className="hp-group lg-feed">
          <div className="lg-feed-head">
            <h3>Day analysis</h3>
            <span>{days.length ? `${days.length} PnL days` : 'waiting'}</span>
          </div>
          {dayStats ? (
            <>
            <div className="dash-wl"><WinLoseBar win={winDays.length} lose={lossDays.length} winLabel="Win days" loseLabel="Loss days" /></div>
            <dl className="lg-facts dash-facts">
              <div><dt>Best day</dt><dd className="num up">{fmtPrice(dayStats.best.usd)} <em>{dayStats.best.day.slice(5)}</em></dd></div>
              <div><dt>Worst day</dt><dd className={`num ${dayStats.worst.usd < 0 ? 'down' : ''}`}>{fmtPrice(dayStats.worst.usd)} <em>{dayStats.worst.day.slice(5)}</em></dd></div>
              <div><dt>Avg win / loss day</dt><dd className="num">{dayStats.avgWin !== null ? fmtPrice(dayStats.avgWin) : '—'} / {dayStats.avgLoss !== null ? fmtPrice(-dayStats.avgLoss) : '—'}</dd></div>
              <div><dt>Win : loss ratio</dt><dd className="num">{dayStats.plRatio !== null ? `${dayStats.plRatio.toFixed(2)} : 1` : '—'}</dd></div>
              <div><dt>Win streak</dt><dd className="num">{dayStats.curStreak} now · {dayStats.maxStreak} best</dd></div>
            </dl>
            </>
          ) : (
            <div className="lg-empty-pad"><Empty title="No PnL days yet">Best/worst days, averages, and streaks appear with closed round-trips.</Empty></div>
          )}
        </section>
      </div>

      {/* ================= ZONE 2 · STRATEGY BRAIN ====================== */}
      <Sec>Strategy brain</Sec>
      <Group>
        <Row
          icon={<IconBrain size={15} />}
          tint={TINT.indigo}
          label="basis-scanner"
          sub={`${s.scanner.pairs} pairs · ${s.scanner.watching} watching · gate ${s.scanner.grossThresholdPct.toFixed(2)}% · tick ${s.scanner.lastTickTs ? timeAgo(s.scanner.lastTickTs) : '—'}`}
          end={
            <>
              <span className="hp-val">{proposals.length} proposal{proposals.length === 1 ? '' : 's'}</span>
              <Pill tone={scannerFresh ? 'ok' : 'bad'}>{scannerFresh ? 'running' : 'stale'}</Pill>
              <button className="hp-btn" type="button" onClick={() => setPage('strategies')}>Monitor</button>
            </>
          }
        />
        <Row
          icon={<IconPulse size={15} />}
          tint={TINT.teal}
          label="volume-scanner"
          sub="88/88 synthetic proofs · live stream adapters pending — never simulated."
          end={
            <>
              <Pill tone="idle">not wired</Pill>
              <button className="hp-btn" type="button" onClick={() => setPage('volume')}>Board</button>
            </>
          }
        />
        {proposals.slice(0, 3).map((p) => (
          <Row
            key={p.id}
            icon={<TokenIcon symbol={p.symbol} size={16} />}
            label={`${baseOf(p.symbol)} · ${p.side === 'SHORT_PERP_LONG_SPOT' ? 'carry' : 'borrow'} setup`}
            sub={p.reason}
            end={
              <>
                <span className={`hp-val ${signClass(p.netEdgePct)}`}>{fmtPct(p.netEdgePct, 2)}</span>
                <button className="hp-btn" type="button" onClick={() => void approveProposal(p.id)}>Ticket</button>
                <button className="hp-btn" type="button" onClick={() => setPage('opportunities')}>Inspect</button>
              </>
            }
          />
        ))}
        <Row
          icon={<IconShield size={15} />}
          tint={TINT.red}
          label="risk-gate"
          sub={lastRejection ? `last reject ${timeAgo(lastRejection.ts)} — ${rejectionInfo(lastRejection)}` : 'No rejected decisions in the current snapshot.'}
          end={
            <>
              <span className="hp-val">{s.risk.rejectionsToday} today</span>
              <button className="hp-btn" type="button" onClick={() => setPage('ledger')}>Logs</button>
            </>
          }
        />
      </Group>

      {/* ================= ZONE 3 · OPS & CONTEXT ======================= */}
      <div className="dash-grid">
        <div className="dash-col">
          <Sec>Control &amp; security</Sec>
          <Group>
            <Row
              icon={<IconPower size={15} />}
              tint={TINT.red}
              label="Kill switch"
              sub={s.config.killSwitch ? 'Live orders stop before routing.' : 'Off — the server risk gate still checks every order.'}
              end={
                <>
                  <Pill tone={s.config.killSwitch ? 'bad' : 'ok'}>{s.config.killSwitch ? 'On' : 'Off'}</Pill>
                  <button className="hp-btn" type="button" onClick={() => setPage('risk')}>Risk</button>
                </>
              }
            />
            <Row
              icon={<IconKey size={15} />}
              tint={TINT.orange}
              label="Key posture"
              sub={s.binance.keyFingerprint ? `key ${s.binance.keyFingerprint} · server-side only` : 'no server keys configured'}
              end={<Pill tone={posture.tone as Tone}>{posture.label}</Pill>}
            />
            <Row
              icon={<IconList size={15} />}
              tint={TINT.blue}
              label="Execution truth"
              sub={`${openOrders.length}/${s.config.maxOpenOrders} open orders · ${fmtMoney(heldNotional)} held · ${positions.length} position${positions.length === 1 ? '' : 's'}`}
              end={<button className="hp-btn" type="button" onClick={() => setPage('orders')}>Execution</button>}
            />
            <Row
              icon={<IconWallet size={15} />}
              tint={TINT.green}
              label="Daily notional"
              sub={`${fmtMoney(s.risk.dailyNotionalUsedUsd)} used of ${fmtMoney(s.config.maxDailyNotionalUsd)} cap`}
              end={
                <span className="hp-val">
                  <Dot tone={s.risk.dailyNotionalUsedUsd < s.config.maxDailyNotionalUsd ? 'ok' : 'bad'} />
                  {fmtMoney(Math.max(0, s.config.maxDailyNotionalUsd - s.risk.dailyNotionalUsedUsd))} left
                </span>
              }
            />
          </Group>
        </div>

        <div className="dash-col">
          <Sec>System</Sec>
          <Group>
            <Row
              icon={<IconWifi size={15} />}
              tint={TINT.blue}
              label="Account stream"
              sub={s.binance.userStream === 'open' ? 'User stream live.' : 'Signed polling keeps account truth fresh.'}
              end={<Pill tone={s.binance.connected ? (s.binance.userStream === 'open' ? 'ok' : 'warn') : 'bad'}>{s.binance.connected ? (s.binance.userStream === 'open' ? 'stream' : 'polling') : 'down'}</Pill>}
            />
            <Row
              icon={<IconPulse size={15} />}
              tint={TINT.green}
              label="Market feed"
              sub={s.scanner.lastTickTs ? `scanner tick ${timeAgo(s.scanner.lastTickTs)}` : 'waiting for first tick'}
              end={<Pill tone={scannerFresh ? 'ok' : 'bad'}>{scannerFresh ? 'live' : 'stale'}</Pill>}
            />
            <Row
              icon={<IconBrain size={15} />}
              tint={TINT.indigo}
              label="Engine heartbeat"
              sub="Engine process heartbeat not started."
              end={
                <>
                  <Pill tone="idle">not started</Pill>
                  <button className="hp-btn" type="button" onClick={() => setPage('system')}>Health</button>
                </>
              }
            />
            <Row
              icon={<IconBook size={15} />}
              tint={TINT.indigo}
              label="Ledger"
              sub={`${s.events.length} events in state · every action recorded`}
              end={<button className="hp-btn" type="button" onClick={() => setPage('ledger')}>Logs</button>}
            />
            <Row
              icon={<IconTerminal size={15} />}
              tint={TINT.orange}
              label="AWS cost &amp; usage"
              sub="Cost Explorer not connected — no invented billing numbers."
              end={<Pill tone="idle">not connected</Pill>}
            />
          </Group>
        </div>

        <div className="dash-col">
          <Sec>Intelligence</Sec>
          <section className="hp-group lg-facet dash-events">
            <h3><IconNewspaper size={12} /> Latest listings</h3>
            {news === null ? (
              <div className="lg-empty-pad"><Empty title="Fetching news…" /></div>
            ) : news.length === 0 ? (
              <div className="lg-empty-pad"><Empty title="News feed unavailable">Binance could not be reached — nothing is invented.</Empty></div>
            ) : (
              news.map((it) => (
                <a key={it.id} href={it.url} target="_blank" rel="noreferrer noopener" title={it.title}>
                  <span>{it.title}</span>
                </a>
              ))
            )}
            <h3><IconCalendar size={12} /> High-impact events</h3>
            {cal === null ? (
              <div className="lg-empty-pad"><Empty title="Fetching calendar…" /></div>
            ) : cal.length === 0 ? (
              <div className="lg-empty-pad"><Empty title="No upcoming high-impact events" /></div>
            ) : (
              cal.map((it) => (
                <button key={it.id} type="button" onClick={() => setPage('calendar')} title={it.title}>
                  <span>{it.country} · {it.title}</span>
                  <b>{new Date(it.date).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</b>
                </button>
              ))
            )}
            <button type="button" onClick={() => setPage('news')}>
              <span>Open News &amp; Calendar</span>
              <b>→</b>
            </button>
          </section>
        </div>
      </div>

    </div>
  );
}

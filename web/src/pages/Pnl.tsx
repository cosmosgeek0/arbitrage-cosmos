import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { EmptyState, StatePill } from '../components/ui';
import { TokenIcon } from '../components/TokenIcon';
import { SparkArea } from '../components/Spark';
import { Num } from '../components/Num';
import {
  IconBook,
  IconChart,
  IconClock,
  IconCoins,
  IconList,
  IconPulse,
  IconReceipt,
  IconShield,
  IconWallet,
} from '../components/Icons';
import { baseOf, fmtDateTime, fmtMoney, fmtPrice, fmtQty, signClass, timeAgo } from '../format';
import type { FillRow } from '../types';

interface PnlData {
  realizedByDay: { day: string; usd: number }[];
  realizedBySymbol: { symbol: string; usd: number }[];
  feesByAsset: { asset: string; amount: number }[];
  equitySnapshots: { ts: number; totalUsdt: number }[];
}

type Lens = 'realized' | 'equity' | 'costs';

function finite(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
}

function tone(v: number | null | undefined): 'ok' | 'bad' | 'idle' {
  if (!finite(v) || v === 0) return 'idle';
  return v > 0 ? 'ok' : 'bad';
}

function feeText(fees: { asset: string; amount: number }[]): string {
  if (fees.length === 0) return 'no fees yet';
  if (fees.length === 1) return `${fmtQty(fees[0].amount)} ${fees[0].asset}`;
  return `${fees.length} assets`;
}

function cumulative(days: { day: string; usd: number }[]): number[] {
  let running = 0;
  return days.map((d) => {
    running += d.usd;
    return running;
  });
}

function maxDrawdownPct(values: number[]): number | null {
  if (values.length < 2) return null;
  let peak = -Infinity;
  let maxDd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - v) / peak) * 100);
  }
  return maxDd;
}

function PnlHero({
  connected,
  keysPresent,
  realizedToday,
  totalRealized,
  fills,
  onFills,
  onLedger,
}: {
  connected: boolean;
  keysPresent: boolean;
  realizedToday: number;
  totalRealized: number;
  fills: number;
  onFills: () => void;
  onLedger: () => void;
}) {
  const hasHistory = fills > 0;
  return (
    <section className="pnl-hero card">
      <div className="pnl-hero-copy">
        <span className="pnl-eyebrow">
          <IconChart size={15} />
          ledger performance
        </span>
        <h1 className="page-title">PnL</h1>
        <p>
          A read-only performance workstation for realized fills, account equity snapshots, fees, and attribution.
          Missing Binance keys are shown as source status, not hidden behind blank tiles.
        </p>
        <div className="pnl-hero-actions">
          <button className="cta-pill" type="button" onClick={onFills}>
            <IconReceipt size={14} />
            Open fills ledger
          </button>
          <button className="mini-btn" type="button" onClick={onLedger}>
            <IconBook size={14} />
            Audit events
          </button>
        </div>
      </div>

      <div className="pnl-hero-panel">
        <StatePill tone={connected ? 'ok' : keysPresent ? 'warn' : 'idle'}>
          {connected ? 'account connected' : keysPresent ? 'keys present' : 'keys not set'}
        </StatePill>
        <span>Today</span>
        <b className={`num ${signClass(realizedToday)}`}>
          <Num value={realizedToday}>{fmtPrice(realizedToday)}</Num>
        </b>
        <em>{hasHistory ? `${fills} ledger fills tracked` : 'waiting for imported or live fills'}</em>
        <div className="pnl-hero-spark">
          <SparkArea values={hasHistory ? [0, totalRealized || 0, realizedToday] : []} dots endDot />
        </div>
      </div>
    </section>
  );
}

function PnlMetric({
  label,
  value,
  sub,
  icon,
  toneClass,
}: {
  label: string;
  value: ReactNode;
  sub: ReactNode;
  icon: ReactNode;
  toneClass?: string;
}) {
  return (
    <div className={`pnl-metric ${toneClass ?? ''}`}>
      <span className="pnl-metric-icon">{icon}</span>
      <span className="pnl-metric-copy">
        <span>{label}</span>
        <b className={`num ${toneClass ?? ''}`}>{value}</b>
        <em>{sub}</em>
      </span>
    </div>
  );
}

function SourceCard({
  icon,
  title,
  detail,
  state,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  state: 'ok' | 'warn' | 'idle';
}) {
  const label = state === 'ok' ? 'ready' : state === 'warn' ? 'partial' : 'waiting';
  return (
    <div className={`pnl-source-card ${state}`}>
      <span>{icon}</span>
      <div>
        <b>{title}</b>
        <em>{detail}</em>
      </div>
      <StatePill tone={state}>{label}</StatePill>
    </div>
  );
}

function LensButton({ value, active, onClick, children }: { value: Lens; active: Lens; onClick: (v: Lens) => void; children: ReactNode }) {
  return (
    <button className={active === value ? 'on' : ''} type="button" onClick={() => onClick(value)}>
      {children}
    </button>
  );
}

function DayBars({ days }: { days: { day: string; usd: number }[] }) {
  const recent = days.slice(-30);
  const maxAbs = Math.max(1e-9, ...recent.map((d) => Math.abs(d.usd)));
  if (recent.length === 0) {
    return (
      <div className="pnl-empty-chart">
        <div className="pnl-empty-grid" />
        <span className="pnl-empty-line" />
        <strong>Realized day bars will appear after the first sell fill closes inventory.</strong>
        <em>Current ledger has no closed round-trip PnL yet.</em>
      </div>
    );
  }
  return (
    <div className="pnl-day-bars">
      {recent.map((d) => {
        const size = Math.max(5, (Math.abs(d.usd) / maxAbs) * 100);
        return (
          <button key={d.day} className={`pnl-day-col ${d.usd >= 0 ? 'pos' : 'neg'}`} type="button" title={`${d.day}: ${fmtPrice(d.usd)}`}>
            <span className="pnl-day-value num">{fmtPrice(d.usd)}</span>
            <span className="pnl-day-track">
              <i style={{ height: `${size}%` }} />
            </span>
            <span className="pnl-day-label num">{d.day.slice(5)}</span>
          </button>
        );
      })}
    </div>
  );
}

function SymbolRow({ symbol, usd, onOpen }: { symbol: string; usd: number; onOpen: () => void }) {
  return (
    <button className="pnl-symbol-row" type="button" onClick={onOpen}>
      <span>
        <TokenIcon symbol={symbol} size={30} />
        <span>
          <b>{baseOf(symbol)}</b>
          <em>{symbol}</em>
        </span>
      </span>
      <strong className={`num ${signClass(usd)}`}>{fmtPrice(usd)}</strong>
    </button>
  );
}

function FillTape({ fills, onOpen }: { fills: FillRow[]; onOpen: (symbol: string) => void }) {
  if (fills.length === 0) {
    return (
      <EmptyState title="No fills in the ledger">
        Live fills and imported Binance trades will create the realized PnL timeline here.
      </EmptyState>
    );
  }
  return (
    <div className="pnl-fill-tape">
      {fills.slice(0, 8).map((f) => (
        <button key={`${f.symbol}-${f.tradeId}`} className="pnl-fill-row" type="button" onClick={() => onOpen(f.symbol)}>
          <TokenIcon symbol={f.symbol} size={28} />
          <span>
            <b>{f.side} {baseOf(f.symbol)}</b>
            <em>{fmtDateTime(f.ts)} - {f.source}</em>
          </span>
          <span className="num">{fmtPrice(f.quoteQty)}</span>
        </button>
      ))}
    </div>
  );
}

export function Pnl() {
  const { state, setPage, openDetail } = useStore();
  const [data, setData] = useState<PnlData | null>(null);
  const [fills, setFills] = useState<FillRow[]>([]);
  const [lens, setLens] = useState<Lens>('realized');

  useEffect(() => {
    const load = () => {
      void fetch('/api/pnl')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setData(d as PnlData))
        .catch(() => undefined);
      void fetch('/api/fills')
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setFills(d as FillRow[]))
        .catch(() => undefined);
    };
    load();
    const t = window.setInterval(load, 30_000);
    return () => window.clearInterval(t);
  }, [state?.recentFills.length]);

  const days = data?.realizedByDay ?? [];
  const symbols = data?.realizedBySymbol ?? [];
  const fees = data?.feesByAsset ?? [];
  const equity = (data?.equitySnapshots ?? []).map((s) => s.totalUsdt).filter(finite);
  const todayKey = new Date().toISOString().slice(0, 10);
  const realizedToday = state?.account?.realizedTodayUsd ?? days.find((d) => d.day === todayKey)?.usd ?? 0;
  const totalRealized = sum(days.map((d) => d.usd));
  const wins = days.filter((d) => d.usd > 0).length;
  const losses = days.filter((d) => d.usd < 0).length;
  const maxDd = maxDrawdownPct(equity);
  const equityChange = equity.length > 1 ? equity[equity.length - 1] - equity[0] : state?.account?.dayChangeUsd ?? null;
  const lastSnapshotTs = data?.equitySnapshots.at(-1)?.ts ?? null;
  const tradedSymbols = new Set(fills.map((f) => f.symbol)).size;
  const quoteTraded = sum(fills.map((f) => f.quoteQty));
  const buys = fills.filter((f) => f.side === 'BUY').length;
  const sells = fills.filter((f) => f.side === 'SELL').length;
  const curve = useMemo(() => cumulative(days), [days]);
  const connected = !!state?.binance.connected;
  const keysPresent = !!state?.binance.keysPresent;
  const hasRealized = days.length > 0 || totalRealized !== 0;
  const equityReady = equity.length >= 2;

  return (
    <div className="container page pnl-page">
      <PnlHero
        connected={connected}
        keysPresent={keysPresent}
        realizedToday={realizedToday}
        totalRealized={totalRealized}
        fills={fills.length}
        onFills={() => setPage('fills')}
        onLedger={() => setPage('ledger')}
      />

      <section className="pnl-metric-grid">
        <PnlMetric
          label="Realized today"
          value={<Num value={realizedToday}>{fmtPrice(realizedToday)}</Num>}
          sub={state?.account ? 'server account state' : 'ledger fallback, account disconnected'}
          icon={<IconPulse size={16} />}
          toneClass={signClass(realizedToday)}
        />
        <PnlMetric
          label="Realized all-time"
          value={fmtPrice(totalRealized)}
          sub={`${days.length} PnL day${days.length === 1 ? '' : 's'} recorded`}
          icon={<IconChart size={16} />}
          toneClass={signClass(totalRealized)}
        />
        <PnlMetric
          label="Equity change"
          value={equityChange === null ? 'waiting' : fmtPrice(equityChange)}
          sub={equityReady ? `${equity.length} snapshots` : 'needs account snapshots'}
          icon={<IconWallet size={16} />}
          toneClass={signClass(equityChange)}
        />
        <PnlMetric
          label="Max drawdown"
          value={maxDd === null ? 'waiting' : `${maxDd.toFixed(2)}%`}
          sub={maxDd === null ? 'curve needs 2+ points' : 'peak to trough'}
          icon={<IconShield size={16} />}
          toneClass={maxDd && maxDd > 0 ? 'down' : ''}
        />
      </section>

      <section className="pnl-source-grid">
        <SourceCard
          icon={<IconReceipt size={16} />}
          title="Fill ledger"
          detail={fills.length ? `${fills.length} executions, ${tradedSymbols} symbols` : 'empty until live stream or import'}
          state={fills.length ? 'ok' : 'idle'}
        />
        <SourceCard
          icon={<IconClock size={16} />}
          title="Equity snapshots"
          detail={lastSnapshotTs ? `last ${timeAgo(lastSnapshotTs)}` : 'requires connected account'}
          state={equityReady ? 'ok' : keysPresent ? 'warn' : 'idle'}
        />
        <SourceCard
          icon={<IconCoins size={16} />}
          title="Costs"
          detail={feeText(fees)}
          state={fees.length ? 'ok' : fills.length ? 'warn' : 'idle'}
        />
        <SourceCard
          icon={<IconShield size={16} />}
          title="Safety state"
          detail={`${state?.mode ?? 'HALTED'} - no withdrawals in this app`}
          state={state?.mode === 'LIVE_ARMED' ? 'warn' : 'ok'}
        />
      </section>

      <div className="pnl-lens-row">
        <div className="seg pnl-lens">
          <LensButton value="realized" active={lens} onClick={setLens}>Realized</LensButton>
          <LensButton value="equity" active={lens} onClick={setLens}>Equity</LensButton>
          <LensButton value="costs" active={lens} onClick={setLens}>Costs</LensButton>
        </div>
        <span>
          {lens === 'realized'
            ? 'avg-cost from ledgered fills'
            : lens === 'equity'
              ? 'account snapshots, not deposits-adjusted'
              : 'commissions now; funding and borrow once account data exists'}
        </span>
      </div>

      <div className="pnl-layout">
        <main className="pnl-main">
          <section className={`pnl-chart-card card ${lens}`}>
            <div className="pnl-card-head">
              <div>
                <h2>{lens === 'realized' ? 'Realized PnL tape' : lens === 'equity' ? 'Equity curve' : 'Cost attribution'}</h2>
                <span>
                  {lens === 'realized'
                    ? 'Daily realized gains and losses from closed inventory.'
                    : lens === 'equity'
                      ? 'Snapshots appear when the account is connected.'
                      : 'Commissions are ledger-backed; funding and borrow are source-gated.'}
                </span>
              </div>
              <StatePill tone={lens === 'realized' ? tone(totalRealized) : lens === 'equity' ? (equityReady ? 'ok' : 'idle') : (fees.length ? 'ok' : 'idle')}>
                {lens === 'realized' ? (hasRealized ? 'ledgered' : 'waiting') : lens === 'equity' ? (equityReady ? 'snapshots' : 'waiting') : (fees.length ? 'costs' : 'waiting')}
              </StatePill>
            </div>

            {lens === 'realized' && (
              <>
                <div className="pnl-curve">
                  {curve.length > 1 ? (
                    <SparkArea values={curve} color={totalRealized >= 0 ? 'var(--up)' : 'var(--down)'} dots endDot />
                  ) : (
                    <div className="pnl-empty-chart compact">
                      <span className="pnl-empty-line" />
                      <strong>Realized curve is armed.</strong>
                      <em>It will draw from the ledger as soon as closed trades exist.</em>
                    </div>
                  )}
                </div>
                <DayBars days={days} />
              </>
            )}

            {lens === 'equity' && (
              <div className="pnl-equity-panel">
                {equityReady ? (
                  <SparkArea values={equity} color={equity[equity.length - 1] >= equity[0] ? 'var(--up)' : 'var(--down)'} dots endDot />
                ) : (
                  <div className="pnl-empty-chart">
                    <div className="pnl-empty-grid" />
                    <span className="pnl-empty-line" />
                    <strong>Equity snapshots are waiting for account data.</strong>
                    <em>The app will snapshot every 15 minutes after Binance read-only keys are configured.</em>
                  </div>
                )}
              </div>
            )}

            {lens === 'costs' && (
              <div className="pnl-cost-grid">
                <div>
                  <b>Commissions</b>
                  <strong>{feeText(fees)}</strong>
                  <span>{fees.length ? 'from recorded fills' : 'no execution fees recorded yet'}</span>
                </div>
                <div>
                  <b>Funding</b>
                  <strong>{keysPresent ? 'pending futures history' : 'keys not set'}</strong>
                  <span>Binance futures income history is source-gated.</span>
                </div>
                <div>
                  <b>Borrow interest</b>
                  <strong>{keysPresent ? 'waiting for margin usage' : 'keys not set'}</strong>
                  <span>Shows after margin or loan activity is ledgered.</span>
                </div>
              </div>
            )}
          </section>

          <section className="pnl-breakdown-grid">
            <div className="pnl-panel card">
              <div className="pnl-card-head">
                <div>
                  <h2>Symbol attribution</h2>
                  <span>Click a row to inspect that market.</span>
                </div>
                <StatePill tone={symbols.length ? 'ok' : 'idle'}>{symbols.length ? `${symbols.length} symbols` : 'empty'}</StatePill>
              </div>
              {symbols.length === 0 ? (
                <EmptyState title="No closed symbol PnL">
                  Symbol attribution starts after the first sell fill can be matched against average cost.
                </EmptyState>
              ) : (
                <div className="pnl-symbol-list">
                  {symbols.slice(0, 10).map((r) => <SymbolRow key={r.symbol} symbol={r.symbol} usd={r.usd} onOpen={() => openDetail(r.symbol)} />)}
                </div>
              )}
            </div>

            <div className="pnl-panel card">
              <div className="pnl-card-head">
                <div>
                  <h2>Execution tape</h2>
                  <span>Recent ledger fills that feed PnL.</span>
                </div>
                <button className="mini-btn" type="button" onClick={() => setPage('fills')}>
                  Open fills
                </button>
              </div>
              <FillTape fills={fills} onOpen={openDetail} />
            </div>
          </section>
        </main>

        <aside className="pnl-rail">
          <section className="pnl-rail-card card">
            <div className="pnl-card-head">
              <div>
                <h2>Session ledger</h2>
                <span>What this page can prove now.</span>
              </div>
            </div>
            <div className="pnl-ledger-stack">
              <div>
                <span><IconReceipt size={14} /> Fills</span>
                <b className="num">{fills.length}</b>
              </div>
              <div>
                <span><IconList size={14} /> Buy / sell</span>
                <b className="num">{buys} / {sells}</b>
              </div>
              <div>
                <span><IconCoins size={14} /> Notional</span>
                <b className="num">{fmtMoney(quoteTraded)}</b>
              </div>
              <div>
                <span><IconChart size={14} /> Win / loss days</span>
                <b className="num">{wins} / {losses}</b>
              </div>
            </div>
          </section>

          <section className="pnl-rail-card card">
            <div className="pnl-card-head">
              <div>
                <h2>Data runway</h2>
                <span>Honest path to a live PnL surface.</span>
              </div>
            </div>
            <div className="pnl-runway">
              <div className={fills.length ? 'done' : ''}>
                <i>1</i>
                <span><b>Import or stream fills</b><em>spot executions enter the ledger</em></span>
              </div>
              <div className={symbols.length ? 'done' : ''}>
                <i>2</i>
                <span><b>Close inventory</b><em>avg-cost engine books realized PnL</em></span>
              </div>
              <div className={equityReady ? 'done' : ''}>
                <i>3</i>
                <span><b>Connect read-only account</b><em>equity curve snapshots every 15 minutes</em></span>
              </div>
              <div className={fees.length ? 'done' : ''}>
                <i>4</i>
                <span><b>Attribute costs</b><em>fees now, funding and borrow when available</em></span>
              </div>
            </div>
          </section>

          <section className="pnl-rail-card card">
            <div className="pnl-card-head">
              <div>
                <h2>Actions</h2>
                <span>Navigation only, no money movement.</span>
              </div>
            </div>
            <div className="pnl-action-stack">
              <button className="cta-pill" type="button" onClick={() => setPage('fills')}>Import fill history</button>
              <button className="mini-btn" type="button" onClick={() => setPage('account')}>Account snapshot</button>
              <button className="mini-btn" type="button" onClick={() => setPage('risk')}>Risk limits</button>
              <button className="mini-btn" type="button" onClick={() => setPage('ledger')}>Ledger search</button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

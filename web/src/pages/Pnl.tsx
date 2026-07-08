import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useRefreshSignal } from '../lib/refresh';
import { Empty, Pill, Seg } from '../components/px';
import { TokenIcon } from '../components/TokenIcon';
import { SparkArea } from '../components/Spark';
import { EquityChart } from '../components/PerfChart';
import { Num } from '../components/Num';
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

function DayBars({ days }: { days: { day: string; usd: number }[] }) {
  const recent = days.slice(-30);
  const maxAbs = Math.max(1e-9, ...recent.map((d) => Math.abs(d.usd)));
  if (recent.length === 0) {
    return (
      <div className="lg-empty-pad">
        <Empty title="No realized days yet">Day bars appear after the first sell fill closes inventory.</Empty>
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

export function Pnl() {
  const { state, setPage, openDetail } = useStore();
  const [data, setData] = useState<PnlData | null>(null);
  const [fills, setFills] = useState<FillRow[]>([]);
  const [lens, setLens] = useState<Lens>('realized');
  const [refreshTick, setRefreshTick] = useState(0);
  useRefreshSignal(() => setRefreshTick((n) => n + 1));

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
  }, [state?.recentFills.length, refreshTick]);

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
  const quoteTraded = sum(fills.map((f) => f.quoteQty));
  const curve = useMemo(() => cumulative(days), [days]);
  const keysPresent = !!state?.binance.keysPresent;
  const equityReady = equity.length >= 2;

  return (
    <>
      <div className="hp-stats exec-stats">
        <div className="hp-stat">
          <span className="k">Realized today</span>
          <span className={`v ${signClass(realizedToday)}`}>
            <Num value={realizedToday}>{fmtPrice(realizedToday)}</Num>
          </span>
          <span className="s">{state?.account ? 'server account state' : 'ledger fallback — account disconnected'}</span>
        </div>
        <div className="hp-stat">
          <span className="k">Realized all-time</span>
          <span className={`v ${signClass(totalRealized)}`}>{fmtPrice(totalRealized)}</span>
          <span className="s">{days.length} PnL day{days.length === 1 ? '' : 's'} · {wins}W / {losses}L</span>
        </div>
        <div className="hp-stat">
          <span className="k">Equity change</span>
          <span className={`v ${equityChange === null ? '' : signClass(equityChange)}`}>{equityChange === null ? '—' : fmtPrice(equityChange)}</span>
          <span className="s">{equityReady ? `${equity.length} snapshots · last ${lastSnapshotTs ? timeAgo(lastSnapshotTs) : '—'}` : 'needs account snapshots'}</span>
        </div>
        <div className="hp-stat">
          <span className="k">Max drawdown</span>
          <span className="v">{maxDd === null ? '—' : `${maxDd.toFixed(2)}%`}</span>
          <span className="s">{maxDd === null ? 'curve needs 2+ points' : 'peak to trough on equity'}</span>
        </div>
      </div>

      <div className="lg-filters">
        <Seg
          value={lens}
          options={[
            { id: 'realized', label: 'Realized' },
            { id: 'equity', label: 'Equity' },
            { id: 'costs', label: 'Costs' },
          ]}
          onChange={setLens}
        />
        <span className="pnl-lens-note">
          {lens === 'realized'
            ? 'avg-cost from ledgered fills'
            : lens === 'equity'
              ? 'account snapshots, not deposits-adjusted'
              : 'commissions now; funding and borrow once account data exists'}
        </span>
      </div>

      <section className="hp-group lg-feed" aria-label="PnL chart">
        <div className="lg-feed-head">
          <h3>{lens === 'realized' ? 'Realized PnL' : lens === 'equity' ? 'Equity curve' : 'Cost attribution'}</h3>
          <span className="hp-val">
            {lens === 'realized'
              ? `${fmtMoney(quoteTraded)} traded · ${fills.length} fills`
              : lens === 'equity'
                ? equityReady ? `${equity.length} snapshots` : 'waiting for account data'
                : feeText(fees)}
          </span>
        </div>

        {lens === 'realized' && (
          <div className="pnl-chart-pad">
            {curve.length > 1 ? (
              <div className="pnl-curve">
                <SparkArea values={curve} color={totalRealized >= 0 ? 'var(--up)' : 'var(--down)'} dots endDot />
              </div>
            ) : null}
            <DayBars days={days} />
          </div>
        )}

        {lens === 'equity' && (
          <div className="pnl-chart-pad">
            {equityReady && data ? (
              <EquityChart snaps={data.equitySnapshots} />
            ) : (
              <Empty title="Equity snapshots are waiting for account data">
                The app snapshots equity every 15 minutes once Binance read-only keys are configured.
              </Empty>
            )}
          </div>
        )}

        {lens === 'costs' && (
          <div className="pnl-costs">
            <div>
              <span className="k">Commissions</span>
              <b>{feeText(fees)}</b>
              <em>{fees.length ? 'from recorded fills' : 'no execution fees recorded yet'}</em>
            </div>
            <div>
              <span className="k">Funding</span>
              <b>{keysPresent ? 'pending futures history' : 'keys not set'}</b>
              <em>Binance futures income history is source-gated.</em>
            </div>
            <div>
              <span className="k">Borrow interest</span>
              <b>{keysPresent ? 'waiting for margin usage' : 'keys not set'}</b>
              <em>Shows after margin or loan activity is ledgered.</em>
            </div>
          </div>
        )}
      </section>

      <div className="lg-grid pnl-grid">
        <section className="hp-group lg-feed" aria-label="Symbol attribution">
          <div className="lg-feed-head">
            <h3>Symbol attribution</h3>
            <span>{symbols.length ? `${symbols.length} symbols` : 'empty'}</span>
          </div>
          {symbols.length === 0 ? (
            <div className="lg-empty-pad">
              <Empty title="No closed symbol PnL">Attribution starts after the first sell fill matches against average cost.</Empty>
            </div>
          ) : (
            <div className="hp-table-wrap">
              <table className="hp-table">
                <colgroup>
                  <col />
                  <col style={{ width: 130 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th className="num-r">Realized</th>
                  </tr>
                </thead>
                <tbody>
                  {symbols.slice(0, 10).map((r) => (
                    <tr key={r.symbol} onClick={() => openDetail(r.symbol)}>
                      <td className="t-source">
                        <span className="exec-sym">
                          <TokenIcon symbol={r.symbol} size={16} />
                          {baseOf(r.symbol)}
                        </span>
                      </td>
                      <td className={`t-value num-r ${signClass(r.usd)}`}>{fmtPrice(r.usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="hp-group lg-feed" aria-label="Recent fills">
          <div className="lg-feed-head">
            <h3>Recent fills</h3>
            <button className="hp-btn" type="button" onClick={() => setPage('fills')}>Open fills</button>
          </div>
          {fills.length === 0 ? (
            <div className="lg-empty-pad">
              <Empty title="No fills in the ledger">Live fills and imported Binance trades create the realized timeline here.</Empty>
            </div>
          ) : (
            <div className="hp-table-wrap">
              <table className="hp-table">
                <colgroup>
                  <col style={{ width: 140 }} />
                  <col />
                  <col style={{ width: 110 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Fill</th>
                    <th>Time · source</th>
                    <th className="num-r">Notional</th>
                  </tr>
                </thead>
                <tbody>
                  {fills.slice(0, 8).map((f) => (
                    <tr key={`${f.symbol}-${f.tradeId}`} onClick={() => openDetail(f.symbol)}>
                      <td className="t-source">
                        <span className="exec-sym">
                          <TokenIcon symbol={f.symbol} size={16} />
                          <Pill tone={f.side === 'BUY' ? 'ok' : 'bad'}>{f.side === 'BUY' ? 'Buy' : 'Sell'}</Pill>
                          {baseOf(f.symbol)}
                        </span>
                      </td>
                      <td className="t-detail">{fmtDateTime(f.ts)} · {f.source}</td>
                      <td className="t-value num-r">{fmtPrice(f.quoteQty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

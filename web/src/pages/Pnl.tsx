import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { StatCard, EmptyState } from '../components/ui';
import { AreaChart } from '../components/AreaChart';
import { fmtPrice } from '../format';

interface PnlData {
  realizedByDay: { day: string; usd: number }[];
  equitySnapshots: { ts: number; totalUsdt: number }[];
}

export function Pnl() {
  const { state } = useStore();
  const [data, setData] = useState<PnlData | null>(null);

  useEffect(() => {
    void fetch('/api/pnl')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d as PnlData));
    const t = setInterval(() => {
      void fetch('/api/pnl')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setData(d as PnlData));
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  if (!state) return <div className="page-loading">Connecting…</div>;
  const days = data?.realizedByDay ?? [];
  const maxAbs = Math.max(1e-9, ...days.map((d) => Math.abs(d.usd)));
  const totalRealized = days.reduce((s, d) => s + d.usd, 0);

  return (
    <>
      <div className="stat-grid">
        <StatCard
          label="Realized today"
          value={state.account ? fmtPrice(state.account.realizedTodayUsd) : '—'}
          accent={state.account && state.account.realizedTodayUsd !== 0 ? (state.account.realizedTodayUsd > 0 ? 'green' : 'red') : undefined}
          sub="from ledgered fills (fees not netted in v0)"
        />
        <StatCard
          label="Equity change today"
          value={state.account?.dayChangeUsd !== null && state.account ? fmtPrice(state.account.dayChangeUsd) : '—'}
          sub="vs first snapshot of the UTC day (includes deposits)"
        />
        <StatCard label="Realized all-time (ledger)" value={fmtPrice(totalRealized)} sub={`${days.length} day${days.length === 1 ? '' : 's'} with fills`} />
      </div>

      <div className="section-title">Realized PnL by day</div>
      <div className="card">
        {days.length === 0 ? (
          <EmptyState title="No realized PnL yet">
            Every sell fill books realized PnL against the ledger’s average cost. Trade or import fill history to
            populate this chart.
          </EmptyState>
        ) : (
          <div className="pnl-bars">
            {days.slice(-30).map((d) => (
              <div key={d.day} className="pnl-bar-col" title={`${d.day}: ${fmtPrice(d.usd)}`}>
                <div
                  className={`pnl-bar ${d.usd >= 0 ? 'pnl-pos' : 'pnl-neg'}`}
                  style={{ height: `${Math.max(4, (Math.abs(d.usd) / maxAbs) * 100)}%` }}
                />
                <span className="pnl-day">{d.day.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section-title">Equity (account snapshots)</div>
      <div className="card">
        {!data || data.equitySnapshots.length < 2 ? (
          <EmptyState title="Not enough snapshots yet">
            Equity is snapshotted every 15 minutes while connected. The curve appears after a few snapshots.
          </EmptyState>
        ) : (
          <AreaChart data={data.equitySnapshots.map((s) => ({ t: s.ts, v: s.totalUsdt }))} height={240} />
        )}
      </div>
    </>
  );
}

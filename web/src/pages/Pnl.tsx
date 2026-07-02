import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { EmptyState } from '../components/ui';
import { BigChart } from '../components/BigChart';
import { fmtPrice, signClass } from '../format';

interface PnlData {
  realizedByDay: { day: string; usd: number }[];
  realizedBySymbol: { symbol: string; usd: number }[];
  feesByAsset: { asset: string; amount: number }[];
  equitySnapshots: { ts: number; totalUsdt: number }[];
}

export function Pnl() {
  const { state } = useStore();
  const [data, setData] = useState<PnlData | null>(null);

  useEffect(() => {
    const load = () =>
      fetch('/api/pnl')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setData(d as PnlData))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const days = data?.realizedByDay ?? [];
  const maxAbs = Math.max(1e-9, ...days.map((d) => Math.abs(d.usd)));
  const totalRealized = days.reduce((s, d) => s + d.usd, 0);
  const acct = state?.account;

  let drawdown: number | null = null;
  if (data && data.equitySnapshots.length > 2) {
    let peak = -Infinity;
    let maxDd = 0;
    for (const s of data.equitySnapshots) {
      peak = Math.max(peak, s.totalUsdt);
      if (peak > 0) maxDd = Math.max(maxDd, ((peak - s.totalUsdt) / peak) * 100);
    }
    drawdown = maxDd;
  }

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">PnL</h1>
          <div className="page-sub">Realized from ledgered fills (avg-cost) · equity from account snapshots</div>
        </div>
      </div>

      <div className="metric-strip">
        <div className="metric">
          <span className="k">Realized today</span>
          <span className={`v num ${acct ? signClass(acct.realizedTodayUsd) : ''}`}>
            {acct ? fmtPrice(acct.realizedTodayUsd) : '—'}
          </span>
          <span className="s">fees not netted in v0</span>
        </div>
        <div className="metric">
          <span className="k">Equity change today</span>
          <span className={`v num ${acct?.dayChangeUsd != null ? signClass(acct.dayChangeUsd) : ''}`}>
            {acct?.dayChangeUsd != null ? fmtPrice(acct.dayChangeUsd) : '—'}
          </span>
          <span className="s">vs first snapshot of UTC day (incl. deposits)</span>
        </div>
        <div className="metric">
          <span className="k">Realized all-time</span>
          <span className={`v num ${signClass(totalRealized)}`}>{fmtPrice(totalRealized)}</span>
          <span className="s">
            {days.length} day{days.length === 1 ? '' : 's'} with fills
          </span>
        </div>
        <div className="metric">
          <span className="k">Max drawdown</span>
          <span className={`v num ${drawdown !== null && drawdown > 0 ? 'down' : ''}`}>
            {drawdown !== null ? `${drawdown.toFixed(2)}%` : '—'}
          </span>
          <span className="s">peak-to-trough on the equity curve</span>
        </div>
      </div>

      <div className="sec-head">
        <h2 className="sec-title">Realized by day</h2>
      </div>
      {days.length === 0 ? (
        <EmptyState title="No realized PnL yet">
          Every sell fill books realized PnL against the ledger’s average cost. Trade or import fill history to
          populate this chart.
        </EmptyState>
      ) : (
        <div className="pnl-bars">
          {days.slice(-30).map((d) => (
            <div key={d.day} className="pnl-col" title={`${d.day}: ${fmtPrice(d.usd)}`}>
              <div
                className={`pnl-bar ${d.usd >= 0 ? 'pos' : 'neg'}`}
                style={{ height: `${Math.max(4, (Math.abs(d.usd) / maxAbs) * 100)}%` }}
              />
              <span className="pnl-day num">{d.day.slice(5)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="sec-head">
        <h2 className="sec-title">Equity</h2>
        <span className="sec-note">snapshotted every 15 minutes while connected</span>
      </div>
      {!data || data.equitySnapshots.length < 2 ? (
        <EmptyState title="Not enough snapshots yet">The curve appears after a few snapshots.</EmptyState>
      ) : (
        <BigChart
          data={data.equitySnapshots.map((s) => ({ t: s.ts, v: s.totalUsdt }))}
          height={260}
          animateKey={`eq-${data.equitySnapshots.length}`}
        />
      )}

      <div className="two-col" style={{ marginTop: 8 }}>
        <div>
          <div className="sec-head">
            <h2 className="sec-title">Realized by symbol</h2>
          </div>
          {(data?.realizedBySymbol.length ?? 0) === 0 ? (
            <EmptyState title="No closed round-trips yet" />
          ) : (
            data!.realizedBySymbol.slice(0, 12).map((r) => (
              <div key={r.symbol} className="xrow">
                <span className="k">{r.symbol}</span>
                <span className={`v num ${signClass(r.usd)}`}>{fmtPrice(r.usd)}</span>
              </div>
            ))
          )}
        </div>
        <div className="rail">
          <div className="rail-head">
            <span className="rail-title">Costs</span>
          </div>
          {(data?.feesByAsset.length ?? 0) === 0 ? (
            <div className="muted small">No fees recorded yet — commissions land here per asset as fills arrive.</div>
          ) : (
            data!.feesByAsset.map((f) => (
              <div key={f.asset} className="drow">
                <span className="k">Fees paid ({f.asset})</span>
                <span className="v num">{f.amount}</span>
              </div>
            ))
          )}
          <div className="drow">
            <span className="k">Funding paid/received</span>
            <span className="v muted small">— needs futures account (planned)</span>
          </div>
          <div className="drow">
            <span className="k">Borrow interest</span>
            <span className="v muted small">— shows once margin/loans are used</span>
          </div>
        </div>
      </div>
    </div>
  );
}

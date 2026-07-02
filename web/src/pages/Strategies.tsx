import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { fmtPct, fmtDateTime, duration, timeAgo } from '../format';
import type { SignalRecord } from '../types';

export function Strategies() {
  const { state, setPage } = useStore();
  const [history, setHistory] = useState<SignalRecord[]>([]);

  useEffect(() => {
    void fetch('/api/signals')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setHistory((d as { recent: SignalRecord[] }).recent))
      .catch(() => undefined);
  }, [state?.proposals.length]);

  if (!state) return <div className="page-loading">Connecting…</div>;

  return (
    <>
      <div className="card strat-card">
        <div className="card-head">
          <div className="strat-title">
            <span className="dot dot-open" />
            <b>Basis monitor</b>
            <span className="chip chip-gold">monitor only</span>
          </div>
          <button className="link-btn" onClick={() => setPage('opportunities')}>
            {state.proposals.length} active proposal{state.proposals.length === 1 ? '' : 's'} →
          </button>
        </div>
        <p className="muted">
          Watches all {state.scanner.pairs} exact spot+perp pairs. When |spot−perp basis| stays above{' '}
          <b>{state.scanner.grossThresholdPct.toFixed(2)}%</b> (est. fees {state.config.feesPct}% + required edge{' '}
          {state.config.minNetBasisPct}%) for {state.config.persistTicks} consecutive ticks on a pair with ≥ $
          {(state.config.minQuoteVolume24h / 1e6).toFixed(0)}M volume, it opens a proposal. It never places orders —
          approving a proposal only prefills the manual ticket.
        </p>
        <div className="strat-stats">
          <span>last tick {state.scanner.lastTickTs ? timeAgo(state.scanner.lastTickTs) : '—'}</span>
          <span>{state.scanner.watching} watching</span>
          <span>{state.proposals.length} proposing</span>
        </div>
      </div>

      <div className="card strat-card disabled-card">
        <div className="card-head">
          <div className="strat-title">
            <span className="dot dot-idle" />
            <b>Volume spike monitor</b>
            <span className="chip">in development</span>
          </div>
        </div>
        <p className="muted">
          Planned: baseline volume tracking across all pairs, promotion to focus mode on anomalies, order-flow
          confirmation before proposing. Not running — this card is a placeholder, not a fake bot.
        </p>
      </div>

      <div className="section-title">Proposal history</div>
      <div className="card table-card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th>Opened</th>
              <th>Duration</th>
              <th>Open</th>
              <th>Peak</th>
              <th>Close</th>
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.id}>
                <td className="strong">{r.symbol}</td>
                <td className="muted small">{r.side === 'SHORT_PERP_LONG_SPOT' ? 'Short perp' : 'Long perp'}</td>
                <td className="muted small">{fmtDateTime(r.openedTs)}</td>
                <td className="muted small">{r.closedTs ? duration(r.openedTs, r.closedTs) : 'open'}</td>
                <td className="num">{fmtPct(r.basisOpen, 2)}</td>
                <td className="num">{fmtPct(r.basisPeak, 2)}</td>
                <td className="num">{r.basisClose !== null ? fmtPct(r.basisClose, 2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {history.length === 0 && <div className="empty-inline">No proposals recorded yet.</div>}
      </div>
    </>
  );
}

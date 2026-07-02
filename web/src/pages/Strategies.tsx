import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { StatusDot } from '../components/ui';
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

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Strategies</h1>
          <div className="page-sub">Every strategy explains itself. None places orders — proposals prefill the ticket.</div>
        </div>
      </div>

      <div className="arm-row armed">
        <span className="a-ic">
          <StatusDot status="live" />
        </span>
        <div className="arm-body">
          <div className="arm-name">
            Basis monitor <span className="chip-tag gold">running · monitor only</span>
          </div>
          <div className="arm-sub">
            Watches all {state?.scanner.pairs ?? '—'} exact spot+perp pairs. |basis| above{' '}
            <b>{state?.scanner.grossThresholdPct.toFixed(2)}%</b> (fees {state?.config.feesPct}% + edge{' '}
            {state?.config.minNetBasisPct}%) persisting {state?.config.persistTicks} ticks on ≥ $
            {((state?.config.minQuoteVolume24h ?? 0) / 1e6).toFixed(0)}M volume opens a proposal.
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            last tick {state?.scanner.lastTickTs ? timeAgo(state.scanner.lastTickTs) : '—'} ·{' '}
            {state?.scanner.watching ?? 0} watching · {state?.proposals.length ?? 0} proposing
          </div>
        </div>
        <button className="cta-pill" onClick={() => setPage('opportunities')}>
          {state?.proposals.length ?? 0} proposals →
        </button>
      </div>

      <div className="arm-row">
        <span className="a-ic">
          <StatusDot status="none" />
        </span>
        <div className="arm-body">
          <div className="arm-name">
            Volume spike monitor <span className="chip-tag">in development</span>
          </div>
          <div className="arm-sub">
            Planned: baseline volume tracking, focus-mode promotion on anomalies, order-flow confirmation before
            proposing. Not running — this row is a placeholder, not a fake bot.
          </div>
        </div>
      </div>

      <div className="sec-head">
        <h2 className="sec-title">Proposal history</h2>
        <span className="sec-note">everything the monitor ever opened, from the ledger</span>
      </div>
      <div className="table-scroll">
        <table className="mkt dense">
          <thead>
            <tr>
              <th className="l">Symbol</th>
              <th className="l">Side</th>
              <th className="l">Opened</th>
              <th>Duration</th>
              <th>Open</th>
              <th>Peak</th>
              <th>Close</th>
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.id}>
                <td className="l val-strong">{r.symbol}</td>
                <td className="l muted">{r.side === 'SHORT_PERP_LONG_SPOT' ? 'Short perp' : 'Long perp'}</td>
                <td className="l muted">{fmtDateTime(r.openedTs)}</td>
                <td>
                  <span className="num muted">{r.closedTs ? duration(r.openedTs, r.closedTs) : 'open'}</span>
                </td>
                <td>
                  <span className="num">{fmtPct(r.basisOpen, 2)}</span>
                </td>
                <td>
                  <span className="num">{fmtPct(r.basisPeak, 2)}</span>
                </td>
                <td>
                  <span className="num">{r.basisClose !== null ? fmtPct(r.basisClose, 2) : '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {history.length === 0 && <div className="empty-state">No proposals recorded yet.</div>}
    </div>
  );
}

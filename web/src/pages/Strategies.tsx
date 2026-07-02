import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { StatusDot } from '../components/ui';
import { TokenIcon } from '../components/TokenIcon';
import { fmtPct, fmtFunding, fmtDateTime, duration, timeAgo, signClass } from '../format';
import type { MarketRow, SignalRecord } from '../types';

export function Strategies() {
  const { state, setPage, openDetail } = useStore();
  const [history, setHistory] = useState<SignalRecord[]>([]);
  const [extremes, setExtremes] = useState<{ positive: MarketRow[]; negative: MarketRow[] } | null>(null);

  useEffect(() => {
    void fetch('/api/signals')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setHistory((d as { recent: SignalRecord[] }).recent))
      .catch(() => undefined);
  }, [state?.proposals.length]);

  useEffect(() => {
    const load = () =>
      fetch('/api/funding/extremes')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setExtremes(d as typeof extremes))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

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

      <div className="arm-row armed">
        <span className="a-ic">
          <StatusDot status="live" />
        </span>
        <div className="arm-body">
          <div className="arm-name">
            Funding monitor <span className="chip-tag gold">running · monitor only</span>
          </div>
          <div className="arm-sub">
            Watches live funding across all liquid pairs. Extreme funding is the raw material for carry trades —
            these are candidates, not proposals; verify basis and depth before touching anything.
          </div>
          {extremes && (
            <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginTop: 8 }}>
              <div style={{ minWidth: 220, flex: 1 }}>
                <div className="stat-k" style={{ marginBottom: 4 }}>Most positive (shorts get paid)</div>
                {extremes.positive.slice(0, 4).map((r) => (
                  <button key={r.symbol} className="lb-row" style={{ minHeight: 36 }} onClick={() => openDetail(r.symbol)}>
                    <TokenIcon symbol={r.symbol} size={20} />
                    <span className="lb-name" style={{ fontSize: 12.5 }}>{r.base}</span>
                    <span className={`lb-val num ${signClass(r.fundingRate)}`} style={{ fontSize: 12.5 }}>
                      {fmtFunding(r.fundingRate)}
                    </span>
                  </button>
                ))}
              </div>
              <div style={{ minWidth: 220, flex: 1 }}>
                <div className="stat-k" style={{ marginBottom: 4 }}>Most negative (longs get paid)</div>
                {extremes.negative.slice(0, 4).map((r) => (
                  <button key={r.symbol} className="lb-row" style={{ minHeight: 36 }} onClick={() => openDetail(r.symbol)}>
                    <TokenIcon symbol={r.symbol} size={20} />
                    <span className="lb-name" style={{ fontSize: 12.5 }}>{r.base}</span>
                    <span className={`lb-val num ${signClass(r.fundingRate)}`} style={{ fontSize: 12.5 }}>
                      {fmtFunding(r.fundingRate)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="arm-row">
        <span className="a-ic">
          <StatusDot status={state?.binance.keysPresent ? 'stale' : 'none'} />
        </span>
        <div className="arm-body">
          <div className="arm-name">
            Borrow / reverse-basis monitor <span className="chip-tag">{state?.binance.keysPresent ? 'partial' : 'needs keys'}</span>
          </div>
          <div className="arm-sub">
            Checks whether “Long perp · Short spot” proposals are actually executable: is the base asset borrowable,
            at what limit and rate. Lives on the Loans → Cross margin tab; automatic pre-checks land with the
            two-leg executor.
          </div>
        </div>
        <button className="mini-btn" onClick={() => setPage('loans')}>
          Loans →
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

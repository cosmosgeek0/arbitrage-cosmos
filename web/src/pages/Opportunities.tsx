import { useStore } from '../store';
import { AssetDot } from '../components/AssetDot';
import { StatCard } from '../components/StatCard';
import { fmtFunding, fmtPct, timeAgo, duration, fmtDateTime } from '../format';

const SIDE_LABEL: Record<string, string> = {
  SHORT_PERP_LONG_SPOT: 'Short perp · Long spot',
  LONG_PERP_SHORT_SPOT: 'Long perp · Short spot (borrow)',
};

const KIND_ICON: Record<string, string> = {
  'signal.open': '🟢',
  'signal.close': '⚪',
  'engine.start': '🚀',
  'engine.init_error': '⚠️',
  'ws.open': '🔌',
  'ws.closed': '⚠️',
  'config.change': '⚙️',
  killswitch: '🛑',
};

export function Opportunities() {
  const { snap, signals, events } = useStore();
  const s = snap?.stats;

  return (
    <>
      <div className="stat-grid">
        <StatCard label="Active signals" value={s?.activeSignals ?? '—'} accent={s && s.activeSignals > 0 ? 'green' : undefined} sub="paper mode — nothing is traded" />
        <StatCard label="Watching" value={s?.watching ?? '—'} sub="above threshold, not persistent yet" />
        <StatCard
          label="Signal threshold"
          value={s ? `${s.grossThresholdPct.toFixed(2)}%` : '—'}
          sub="est. fees + required net edge"
        />
      </div>

      <div className="section-title">Active signals</div>
      {signals && signals.active.length > 0 ? (
        <div className="signal-grid">
          {signals.active.map((sig) => (
            <div key={sig.id} className="card signal-card">
              <div className="signal-head">
                <AssetDot base={sig.symbol.replace('USDT', '')} size={36} />
                <div className="signal-sym">{sig.symbol}</div>
                <span className="chip chip-paper">PAPER</span>
              </div>
              <div className={`side-badge ${sig.side === 'SHORT_PERP_LONG_SPOT' ? 'side-classic' : 'side-borrow'}`}>
                {SIDE_LABEL[sig.side] ?? sig.side}
              </div>
              <div className="signal-basis">
                <div>
                  <div className="muted small">Basis now</div>
                  <div className={`big-num ${sig.basisNow > 0 ? 'pos' : 'neg'}`}>{fmtPct(sig.basisNow, 3)}</div>
                </div>
                <div>
                  <div className="muted small">Opened at</div>
                  <div className="mid-num">{fmtPct(sig.basisOpen, 3)}</div>
                </div>
                <div>
                  <div className="muted small">Peak</div>
                  <div className="mid-num">{fmtPct(sig.basisPeak, 3)}</div>
                </div>
              </div>
              <div className="signal-foot muted">
                Funding at open {fmtFunding(sig.fundingOpen)} · opened {timeAgo(sig.openedTs)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card empty-card">
          No active signals right now. The scanner needs a basis wider than{' '}
          {s ? `${s.grossThresholdPct.toFixed(2)}%` : '…'} that persists — most of the time the market offers
          nothing, and that is the honest answer.
        </div>
      )}

      <div className="two-col">
        <div>
          <div className="section-title">Signal history</div>
          <div className="card table-card">
            <table className="market-table">
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
                {(signals?.recent ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="asset-base">{r.symbol}</td>
                    <td className="muted small">{r.side === 'SHORT_PERP_LONG_SPOT' ? 'Short perp' : 'Long perp'}</td>
                    <td className="muted small">{fmtDateTime(r.openedTs)}</td>
                    <td className="muted small">{r.closedTs ? duration(r.openedTs, r.closedTs) : <span className="status-chip status-signal">open</span>}</td>
                    <td className="num">{fmtPct(r.basisOpen, 2)}</td>
                    <td className="num">{fmtPct(r.basisPeak, 2)}</td>
                    <td className="num">{r.basisClose !== null ? fmtPct(r.basisClose, 2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!signals || signals.recent.length === 0) && <div className="empty-inline">No signals recorded yet.</div>}
          </div>
        </div>
        <div>
          <div className="section-title">Ledger feed</div>
          <div className="card feed-card">
            {events.slice(0, 30).map((ev) => (
              <div key={ev.id} className="feed-row">
                <span className="feed-icon">{KIND_ICON[ev.kind] ?? '•'}</span>
                <div className="feed-body">
                  <div className="feed-kind">
                    {ev.kind}
                    {ev.symbol ? <span className="chip">{ev.symbol}</span> : null}
                  </div>
                  {ev.data != null && <div className="feed-data muted">{JSON.stringify(ev.data).slice(0, 90)}</div>}
                </div>
                <span className="feed-time muted">{timeAgo(ev.ts)}</span>
              </div>
            ))}
            {events.length === 0 && <div className="empty-inline">Ledger is empty.</div>}
          </div>
        </div>
      </div>
    </>
  );
}

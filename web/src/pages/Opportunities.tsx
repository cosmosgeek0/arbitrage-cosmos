import { useStore } from '../store';
import { AssetDot } from '../components/AssetDot';
import { EmptyState, StatCard } from '../components/ui';
import { fmtFunding, fmtPct, fmtPrice, fmtCompact, timeAgo } from '../format';

const SIDE_LABEL: Record<string, string> = {
  SHORT_PERP_LONG_SPOT: 'Short perp · Long spot',
  LONG_PERP_SHORT_SPOT: 'Long perp · Short spot (borrow)',
};

export function Opportunities() {
  const { state, approveProposal } = useStore();
  if (!state) return <div className="page-loading">Connecting…</div>;

  return (
    <>
      <div className="stat-grid">
        <StatCard label="Active proposals" value={state.proposals.length} accent={state.proposals.length > 0 ? 'gold' : undefined} sub="monitor only — nothing auto-trades" />
        <StatCard label="Watching" value={state.scanner.watching} sub="above threshold, not persistent yet" />
        <StatCard label="Threshold" value={`${state.scanner.grossThresholdPct.toFixed(2)}%`} sub="est. fees + required net edge" />
      </div>

      {state.proposals.length === 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <EmptyState title="No opportunities right now">
            The basis monitor needs a spot/perp gap above {state.scanner.grossThresholdPct.toFixed(2)}% that
            persists. Most of the time the market offers nothing — that is the honest state, not a bug.
          </EmptyState>
        </div>
      ) : (
        <div className="proposal-grid">
          {state.proposals.map((p) => (
            <div key={p.id} className="card proposal-card">
              <div className="proposal-head">
                <AssetDot base={p.symbol.replace(/USDT$/, '')} size={34} />
                <div>
                  <div className="strong">{p.symbol}</div>
                  <div className="muted small">opened {timeAgo(p.openedTs)}</div>
                </div>
                <span className="chip chip-gold">confidence {Math.round(p.confidence * 100)}%</span>
              </div>
              <div className={`side-badge ${p.side === 'SHORT_PERP_LONG_SPOT' ? 'side-classic' : 'side-borrow'}`}>
                {SIDE_LABEL[p.side]}
              </div>
              <div className="pv-row"><span className="muted">Basis now / peak</span><span className="num strong">{fmtPct(p.basisNow, 3)} / {fmtPct(p.basisPeak, 3)}</span></div>
              <div className="pv-row"><span className="muted">Net edge after fees</span><span className={`num ${p.netEdgePct > 0 ? 'pos' : 'neg'}`}>{fmtPct(p.netEdgePct, 3)}</span></div>
              <div className="pv-row"><span className="muted">Spot / perp mark</span><span className="num">{fmtPrice(p.spotPrice)} / {fmtPrice(p.perpMark)}</span></div>
              <div className="pv-row"><span className="muted">Funding</span><span className="num">{fmtFunding(p.fundingRate)}</span></div>
              <div className="pv-row"><span className="muted">24h volume</span><span className="num">{fmtCompact(p.quoteVolume24h)}</span></div>
              <div className="pv-row"><span className="muted">Borrow</span><span className="small">{p.borrow}</span></div>
              <div className="proposal-reason muted small">{p.reason}</div>
              <button className="btn btn-dark wide" onClick={() => void approveProposal(p.id)}>
                Approve → open trade ticket
              </button>
              <div className="muted small center-note">
                Approving only prefills the spot-leg ticket. Risk gate + confirmation still apply.
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

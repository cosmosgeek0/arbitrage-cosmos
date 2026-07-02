import { useStore } from '../store';
import { TokenIcon } from '../components/TokenIcon';
import { EmptyState } from '../components/ui';
import { fmtFunding, fmtPct, fmtPrice, fmtMoney, timeAgo, signClass, baseOf } from '../format';

const SIDE_LABEL: Record<string, string> = {
  SHORT_PERP_LONG_SPOT: 'Short perp · Long spot',
  LONG_PERP_SHORT_SPOT: 'Long perp · Short spot (borrow)',
};

export function Opportunities() {
  const { state, approveProposal, openDetail } = useStore();
  const s = state;

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Opportunities</h1>
          <div className="page-sub">
            Live basis proposals — monitor only, nothing auto-trades. Threshold{' '}
            {s ? `${s.scanner.grossThresholdPct.toFixed(2)}%` : '…'} · {s?.scanner.watching ?? 0} watching
          </div>
        </div>
      </div>

      {(s?.proposals.length ?? 0) === 0 ? (
        <EmptyState title="No opportunities right now">
          The basis monitor needs a spot/perp gap above {s ? `${s.scanner.grossThresholdPct.toFixed(2)}%` : '…'} that
          persists. Most of the time the market offers nothing — that is the honest state, not a bug.
        </EmptyState>
      ) : (
        <div>
          {s!.proposals.map((p) => (
            <div key={p.id} style={{ borderBottom: '1px solid var(--line)', padding: '18px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button className="lb-row" style={{ flex: 'none', margin: 0, padding: 0, minHeight: 0 }} onClick={() => openDetail(p.symbol)}>
                  <TokenIcon symbol={p.symbol} size={34} />
                </button>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span className="strong" style={{ fontSize: 16, fontWeight: 680 }}>
                      {baseOf(p.symbol)}
                    </span>
                    <span className={`chip-tag ${p.side === 'SHORT_PERP_LONG_SPOT' ? 'ok' : 'purple'}`}>
                      {SIDE_LABEL[p.side]}
                    </span>
                    <span className="chip-tag gold">confidence {Math.round(p.confidence * 100)}%</span>
                  </div>
                  <div className="muted small">opened {timeAgo(p.openedTs)} · {p.reason}</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 26, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="kv">
                    <div className="k">Basis now / peak</div>
                    <div className={`v num ${signClass(p.basisNow)}`}>
                      {fmtPct(p.basisNow, 2)} / {fmtPct(p.basisPeak, 2)}
                    </div>
                  </div>
                  <div className="kv">
                    <div className="k">Net edge</div>
                    <div className={`v num ${signClass(p.netEdgePct)}`}>{fmtPct(p.netEdgePct, 2)}</div>
                  </div>
                  <div className="kv col-hide-sm">
                    <div className="k">Funding</div>
                    <div className={`v num ${signClass(p.fundingRate)}`}>{fmtFunding(p.fundingRate)}</div>
                  </div>
                  <div className="kv col-hide-sm">
                    <div className="k">Spot / perp</div>
                    <div className="v num sm">
                      {fmtPrice(p.spotPrice)} / {fmtPrice(p.perpMark)}
                    </div>
                  </div>
                  <div className="kv col-hide-xs">
                    <div className="k">24h vol</div>
                    <div className="v num sm">{fmtMoney(p.quoteVolume24h)}</div>
                  </div>
                  <button className="cta-pill" onClick={() => void approveProposal(p.id)}>
                    Approve → ticket
                  </button>
                </div>
              </div>
              <div className="muted small" style={{ marginTop: 8 }}>
                Borrow: {p.borrow}. Approving only prefills the spot-leg ticket — risk gate + typed confirmation
                still apply.
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

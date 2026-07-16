import { Empty } from '../components/px';

/**
 * Dormant compatibility page. Private position truth has no accepted owner in
 * this runtime, so legacy account metadata must never be treated as evidence.
 */
export function Positions() {
  return (
    <>
      <div className="hp-stats exec-stats" aria-label="Position Capability Status">
        <div className="hp-stat">
          <span className="k">Private Position Truth</span>
          <span className="v">Not Configured</span>
          <span className="s">No signed/private position adapter is mounted</span>
        </div>
        <div className="hp-stat">
          <span className="k">Spot Exposure</span>
          <span className="v">—</span>
          <span className="s">Unknown · unavailable truth is not a flatness claim</span>
        </div>
        <div className="hp-stat">
          <span className="k">Unrealized PnL</span>
          <span className="v">—</span>
          <span className="s">Owner gated until canonical position and cost-basis evidence exists</span>
        </div>
      </div>

      <section className="hp-group lg-feed" aria-label="Positions">
        <div className="lg-feed-head">
          <h3>Spot Positions</h3>
          <span className="hp-val">Unknown · Private Owner Not Configured</span>
        </div>
        <div className="lg-empty-pad">
          <Empty title="Private Position Truth Is Not Configured">
            No legacy account payload is accepted as position evidence. Use the canonical Product binding for current owner, readiness, and blocker truth.
          </Empty>
        </div>
      </section>
    </>
  );
}

import { Empty } from '../components/px';

/**
 * Dormant compatibility page. The mounted Orders route is owned by Account and
 * the canonical Product surface binding; this file must remain safe if it is
 * accidentally re-mounted before an accepted private order owner exists.
 */
export function Orders() {
  return (
    <>
      <div className="hp-stats exec-stats" aria-label="Order Capability Status">
        <div className="hp-stat">
          <span className="k">Private Order Truth</span>
          <span className="v">Not Configured</span>
          <span className="s">No signed/private order adapter is mounted</span>
        </div>
        <div className="hp-stat">
          <span className="k">Working Orders</span>
          <span className="v">Unknown</span>
          <span className="s">Absence of private truth is not a zero-order claim</span>
        </div>
        <div className="hp-stat">
          <span className="k">Money Actions</span>
          <span className="v">Blocked</span>
          <span className="s">Send, test, cancel, and cancel-all are unavailable</span>
        </div>
      </div>

      <section className="hp-group lg-feed" aria-label="Order Evidence">
        <div className="lg-feed-head">
          <h3>Order Evidence</h3>
          <span className="hp-val">Owner Gated</span>
        </div>
        <div className="lg-empty-pad">
          <Empty title="Private Order Truth Is Not Configured">
            This runtime exposes no signed order history or money-moving control. Use the canonical Product binding for current readiness and blocker evidence.
          </Empty>
        </div>
      </section>
    </>
  );
}

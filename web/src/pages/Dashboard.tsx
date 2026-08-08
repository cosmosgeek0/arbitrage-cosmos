import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useProductControlRoomContext } from '../features/productControlRoom/ProductControlRoomProvider';
import { SystemDashboard } from '../features/systemDashboard/SystemDashboard';
import { useStore } from '../store';
import './Dashboard.css';

export function Dashboard() {
  const { setPage } = useStore();
  const { binding } = useProductControlRoomContext();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const continuityProven = binding.continuity === 'PROVEN';
  const dashboardSnapshot = continuityProven
    ? binding.snapshot?.dashboard ?? null
    : null;
  const unavailableReason = binding.error
    ?? (continuityProven
      ? 'Canonical product truth does not include a dashboard snapshot.'
      : `Material-event continuity is ${binding.continuity}.`);

  return (
    <div className="container page dashboard-page">
      <section
        className="dashboard-task"
        aria-labelledby="dashboard-task-title"
        data-dashboard-task
      >
        <span className="dashboard-task-copy">
          <small>Operator task</small>
          <strong id="dashboard-task-title">Review provider fill evidence</strong>
          <span id="dashboard-task-detail">
            Opens read-only Account fills from symbol-scoped private-provider history. This action does not place, cancel, or alter orders.
          </span>
        </span>
        <button
          type="button"
          aria-describedby="dashboard-task-detail"
          onClick={() => setPage('fills')}
        >
          Review Account Fills
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </section>

      <SystemDashboard
        snapshot={dashboardSnapshot}
        nowMs={nowMs}
        busy={binding.loading}
        unavailableReason={unavailableReason}
        readOnlyProjection
      />
    </div>
  );
}

// SystemDashboard — the composed owner-contract surface (DASHBOARD_TRUTH
// items 1–10) in one Health-anatomy frame. Pure over the supervisor snapshot:
// data enters as props, mutations leave through the injected mutate callback
// typed against the real control API. Nothing here fetches.

import { useState } from 'react';
import type {
  SystemControlMutation,
  SystemControlReceipt,
  SystemSupervisorSnapshot,
} from '../../lib/systemIntegration';
import { AttentionQueuePanel } from './components/AttentionQueuePanel';
import { TruthTag } from './components/bits';
import { BrainPanel } from './components/BrainPanel';
import { CapitalPanel } from './components/CapitalPanel';
import { ControlsPanel } from './components/ControlsPanel';
import { EnginesPanel } from './components/EnginesPanel';
import { MachineGraph } from './components/MachineGraph';
import { ExposureBanner, PostureStrip } from './components/PostureStrip';
import { RiskExecutionPanel } from './components/RiskExecutionPanel';
import { SourceHealthPanel } from './components/SourceHealthPanel';
import { TraceDrilldown } from './components/TraceDrilldown';
import { ageText } from './lib/presentation';
import './styles/systemDashboard.css';

interface SystemDashboardCommonProps {
  /** Canonical supervisor snapshot. Null renders the honest unavailable frame. */
  snapshot: SystemSupervisorSnapshot | null;
  /** Reference instant for every age on the surface. */
  nowMs: number;
  /** True while a mutation is in flight; controls disable. */
  busy: boolean;
  /** Why the snapshot is unavailable (poll error text), when it is. */
  unavailableReason?: string | null;
}

interface SystemDashboardInteractiveProps {
  readonly readOnlyProjection?: false;
  /** Fires a real control mutation. Fixture previews apply this in memory. */
  readonly mutate: (mutation: SystemControlMutation, reason: string) => void;
  /** Receipt of the last fired mutation, shown before/after in Controls. */
  readonly lastReceipt: SystemControlReceipt | null;
}

interface SystemDashboardReadOnlyProps {
  readonly readOnlyProjection: true;
  readonly mutate?: never;
  readonly lastReceipt?: never;
}

export type SystemDashboardProps = SystemDashboardCommonProps
  & (SystemDashboardInteractiveProps | SystemDashboardReadOnlyProps);

export function SystemDashboard(props: SystemDashboardProps) {
  const { snapshot, nowMs, busy, unavailableReason = null } = props;
  const [selectedCorrelationId, setSelectedCorrelationId] = useState<string | null>(null);

  if (!snapshot) {
    return (
      <div className="sdx-page">
        <div className="sdx-frame">
          <div className="sdx-toolbar">
            <div className="sdx-toolbar-title">
              <h1>System Dashboard</h1>
              <span className="sdx-truth unavailable">UNAVAILABLE</span>
            </div>
          </div>
          <div className="sdx-unavailable" role="alert">
            <strong>Canonical Supervisor Unreachable</strong>
            <span>{unavailableReason ?? 'No supervisor snapshot has been published. Nothing on this machine can be presumed running.'}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sdx-page">
      <div className="sdx-frame">
        <div className="sdx-toolbar">
          <div className="sdx-toolbar-title">
            <h1>System Dashboard</h1>
            <TruthTag label={snapshot.truthLabel} />
          </div>
          <div className="sdx-toolbar-meta">
            <span>Snapshot <code>rev {snapshot.revision}</code></span>
            <span>Evaluated <code>{ageText(snapshot.evaluatedAtMs, nowMs)}</code></span>
            <span>Schema <code>v{snapshot.schemaVersion}</code></span>
          </div>
        </div>

        <PostureStrip snapshot={snapshot} nowMs={nowMs} />
        <ExposureBanner snapshot={snapshot} />
        {props.readOnlyProjection !== true && (
          <AttentionQueuePanel snapshot={snapshot} onControl={props.mutate} busy={busy} />
        )}
        <MachineGraph snapshot={snapshot} />
        <SourceHealthPanel snapshot={snapshot} nowMs={nowMs} />
        <EnginesPanel snapshot={snapshot} nowMs={nowMs} onTrace={setSelectedCorrelationId} />
        <BrainPanel snapshot={snapshot} nowMs={nowMs} />
        <CapitalPanel snapshot={snapshot} />
        <RiskExecutionPanel snapshot={snapshot} nowMs={nowMs} onTrace={setSelectedCorrelationId} />
        <TraceDrilldown
          snapshot={snapshot}
          nowMs={nowMs}
          selectedCorrelationId={selectedCorrelationId}
          onSelect={setSelectedCorrelationId}
        />
        {props.readOnlyProjection !== true && (
          <ControlsPanel snapshot={snapshot} mutate={props.mutate} lastReceipt={props.lastReceipt} busy={busy} />
        )}
      </div>
    </div>
  );
}

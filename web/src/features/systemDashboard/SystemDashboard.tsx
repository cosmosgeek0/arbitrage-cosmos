// SystemDashboard — the composed owner-contract surface (DASHBOARD_TRUTH
// items 1–10) in one Health-anatomy frame. Pure over the supervisor snapshot:
// data enters as props, mutations leave through the injected mutate callback
// typed against the real control API. Nothing here fetches.

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
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
import {
  DASHBOARD_TABS,
  dashboardTabIndexForKey,
  type DashboardTabId,
  type DashboardTabOrientation,
} from './lib/tabs';
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
  const snapshotAvailable = snapshot !== null;
  const tabIdPrefix = useId();
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeTab, setActiveTab] = useState<DashboardTabId>('overview');
  const [tabOrientation, setTabOrientation] = useState<DashboardTabOrientation>('vertical');
  const [selectedCorrelationId, setSelectedCorrelationId] = useState<string | null>(null);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || typeof ResizeObserver === 'undefined') return;
    const updateOrientation = (width: number) => {
      setTabOrientation(width <= 660 ? 'horizontal' : 'vertical');
    };
    updateOrientation(workspace.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => updateOrientation(entry.contentRect.width));
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [snapshotAvailable]);

  const activateTab = (index: number, focus = false) => {
    const tab = DASHBOARD_TABS[index];
    if (!tab) return;
    setActiveTab(tab.id);
    if (focus) tabRefs.current[index]?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = dashboardTabIndexForKey(index, event.key, tabOrientation);
    if (nextIndex === null) return;
    event.preventDefault();
    activateTab(nextIndex, true);
  };

  const selectTrace = (correlationId: string) => {
    setSelectedCorrelationId(correlationId);
    setActiveTab('transitions');
  };

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

        <ExposureBanner snapshot={snapshot} />

        <div className="sdx-workspace" ref={workspaceRef}>
          <div
            className="sdx-subtabs"
            role="tablist"
            aria-label="Control Room Views"
            aria-orientation={tabOrientation}
          >
            {DASHBOARD_TABS.map((tab, index) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(node) => { tabRefs.current[index] = node; }}
                  type="button"
                  role="tab"
                  id={`${tabIdPrefix}-${tab.id}-tab`}
                  aria-controls={`${tabIdPrefix}-${tab.id}-panel`}
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  className={selected ? 'selected' : ''}
                  onClick={() => activateTab(index)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  <span>{tab.label}</span>
                  <small>{tab.detail}</small>
                </button>
              );
            })}
          </div>

          <div className="sdx-tabpanels">
            <div
              role="tabpanel"
              id={`${tabIdPrefix}-overview-panel`}
              aria-labelledby={`${tabIdPrefix}-overview-tab`}
              tabIndex={0}
              hidden={activeTab !== 'overview'}
              className="sdx-tabpanel overview"
            >
              <PostureStrip snapshot={snapshot} nowMs={nowMs} />
              <AttentionQueuePanel snapshot={snapshot} onControl={props.mutate} busy={busy} />
            </div>

            <div
              role="tabpanel"
              id={`${tabIdPrefix}-engines-panel`}
              aria-labelledby={`${tabIdPrefix}-engines-tab`}
              tabIndex={0}
              hidden={activeTab !== 'engines'}
              className="sdx-tabpanel"
            >
              <EnginesPanel snapshot={snapshot} nowMs={nowMs} onTrace={selectTrace} />
              <BrainPanel snapshot={snapshot} nowMs={nowMs} />
            </div>

            <div
              role="tabpanel"
              id={`${tabIdPrefix}-connections-panel`}
              aria-labelledby={`${tabIdPrefix}-connections-tab`}
              tabIndex={0}
              hidden={activeTab !== 'connections'}
              className="sdx-tabpanel"
            >
              <div className="sdx-view-boundary" role="note">
                <strong>Read-Only Connection Evidence</strong>
                <span>Canonical source coverage is shown here. Browser recovery and polling controls remain in the single bottom-right Connection Watchman.</span>
              </div>
              <SourceHealthPanel snapshot={snapshot} nowMs={nowMs} />
            </div>

            <div
              role="tabpanel"
              id={`${tabIdPrefix}-transitions-panel`}
              aria-labelledby={`${tabIdPrefix}-transitions-tab`}
              tabIndex={0}
              hidden={activeTab !== 'transitions'}
              className="sdx-tabpanel"
              data-sdx-view="transitions"
            >
              <div className="sdx-view-boundary" role="note">
                <strong>Managed Transition Evidence</strong>
                <span>Component state and correlated traces are read-only here. Host restart authority is not exposed in this dashboard.</span>
              </div>
              <MachineGraph snapshot={snapshot} />
              <TraceDrilldown
                snapshot={snapshot}
                nowMs={nowMs}
                selectedCorrelationId={selectedCorrelationId}
                onSelect={setSelectedCorrelationId}
              />
            </div>

            <div
              role="tabpanel"
              id={`${tabIdPrefix}-risk-panel`}
              aria-labelledby={`${tabIdPrefix}-risk-tab`}
              tabIndex={0}
              hidden={activeTab !== 'risk'}
              className="sdx-tabpanel"
            >
              {props.readOnlyProjection === true && (
                <div className="sdx-view-boundary" role="note">
                  <strong>Product Control Registry Owns Commands</strong>
                  <span>This embedded dashboard is read-only. Canonical command preview and commit controls remain in the Product Control Registry above.</span>
                </div>
              )}
              <CapitalPanel snapshot={snapshot} />
              <RiskExecutionPanel snapshot={snapshot} nowMs={nowMs} onTrace={selectTrace} />
              {props.readOnlyProjection !== true && (
                <ControlsPanel snapshot={snapshot} mutate={props.mutate} lastReceipt={props.lastReceipt} busy={busy} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

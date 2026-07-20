import { useEffect, useMemo, useRef, useState } from 'react';
import type { SystemSupervisorSnapshot } from '../../lib/systemIntegration';
import {
  advanceFixtureSession,
  applyFixtureCommand,
  createFixtureSession,
  productTraceHasSyntheticEvidence,
  type ProductCommandRequest,
  type ProductCommandResultIdentity,
  type ProductCommandResultReadback,
  type ProductControlPreview,
  type ProductControlRegistryEntry,
  type ProductControlResult,
  type ProductCorrelationTrace,
  type ProductFixtureScenarioId,
  type ProductFixtureSession,
  type MaterialEventPage,
  type ProductSupervisorEnvelope,
} from '../../lib/productIntegration';
import { SystemDashboard } from '../systemDashboard/SystemDashboard';
import { ControlRegistryPanel } from './components/ControlRegistryPanel';
import { ComponentAuthorityPanel } from './components/ComponentAuthorityPanel';
import { IncidentCursorPanel } from './components/IncidentCursorPanel';
import { ManagedInventoryPanel } from './components/ManagedInventoryPanel';
import { OwnerViewPanel } from './components/OwnerViewPanel';
import { ProductTracePanel } from './components/ProductTracePanel';
import { SurfaceBindingPanel } from './components/SurfaceBindingPanel';
import { buildProductControlRoomFixture } from './fixtureBinding';
import './styles/productControlRoom.css';

const SYSTEM_WALL_CLOCK = () => Date.now();
// Ages rendered from the donor dashboard are minutes-scale; tick at the
// provider's 5s poll cadence rather than 1s so the correctness fix does not
// buy a per-second re-render of every panel.
const AGE_TICK_INTERVAL_MS = 5_000;

export interface ProductControlRoomProps {
  readonly snapshot: ProductSupervisorEnvelope<SystemSupervisorSnapshot> | null;
  readonly staleSnapshot?: ProductSupervisorEnvelope<SystemSupervisorSnapshot> | null;
  readonly materialEvents?: Readonly<MaterialEventPage> | null;
  readonly clock?: () => number;
  readonly busy: boolean;
  readonly unavailableReason?: string | null;
  readonly bindingBlocker?: string | null;
  readonly allowFixtureControls?: boolean;
  readonly onPreview: (
    control: Readonly<ProductControlRegistryEntry>,
    signal: AbortSignal,
  ) => Promise<ProductControlPreview>;
  readonly onSubmit: (request: Readonly<ProductCommandRequest>) => Promise<ProductControlResult>;
  readonly onReadCommandResult?: (
    identity: Readonly<ProductCommandResultIdentity>,
    signal?: AbortSignal,
  ) => Promise<ProductCommandResultReadback>;
  readonly onReadTrace?: (correlationId: string) => Promise<ProductCorrelationTrace>;
}

export function ProductControlRoom({
  snapshot,
  staleSnapshot = null,
  materialEvents = null,
  clock = SYSTEM_WALL_CLOCK,
  busy,
  unavailableReason = null,
  bindingBlocker = null,
  allowFixtureControls = false,
  onPreview,
  onSubmit,
  onReadCommandResult,
  onReadTrace,
}: ProductControlRoomProps) {
  const [liveTrace, setLiveTrace] = useState<ProductCorrelationTrace | null>(null);
  const [traceBusy, setTraceBusy] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  // The dashboard contract takes nowMs as a prop and expects the integrator
  // to supply a ticking clock. Reading the snapshot's own evaluatedAtMs froze
  // every rendered age at "0s ago", so a wedged supervisor serving its last
  // snapshot was indistinguishable from a live one.
  const [nowMs, setNowMs] = useState(() => clock());
  const traceRequestRef = useRef(0);

  useEffect(() => () => { traceRequestRef.current += 1; }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(clock()), AGE_TICK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [clock]);

  const readTrace = (correlationId: string) => {
    const exactId = correlationId.trim();
    if (!exactId) return;
    const requestId = traceRequestRef.current + 1;
    traceRequestRef.current = requestId;
    if (!onReadTrace) {
      setLiveTrace(snapshot?.traces.find((trace) => trace.correlationId === exactId) ?? null);
      setTraceError(snapshot?.traces.some((trace) => trace.correlationId === exactId) ? null : 'Trace is not present in this fixture snapshot.');
      return;
    }
    setTraceBusy(true);
    setTraceError(null);
    void onReadTrace(exactId)
      .then((trace) => {
        if (traceRequestRef.current === requestId) setLiveTrace(trace);
      })
      .catch((cause) => {
        if (traceRequestRef.current !== requestId) return;
        setLiveTrace(null);
        setTraceError(cause instanceof Error ? cause.message : 'Canonical trace lookup failed.');
      })
      .finally(() => {
        if (traceRequestRef.current === requestId) setTraceBusy(false);
      });
  };

  return (
    <div className="pcr-page">
      {(snapshot?.persistentSyntheticLabel || staleSnapshot?.persistentSyntheticLabel || productTraceHasSyntheticEvidence(liveTrace)) && (
        <div className="pcr-synthetic-banner" role="status">
          SYNTHETIC EVIDENCE · NO LIVE AUTHORITY · NO EXCHANGE MUTATION
        </div>
      )}
      <div className="pcr-frame">
        {(snapshot || staleSnapshot) && <div className="pcr-execution-barrier">LIVE_EXECUTION_NOT_IMPLEMENTED · NO LIVE ORDER, BORROW, TRANSFER, OR WITHDRAWAL AUTHORITY</div>}
        {bindingBlocker && snapshot && <div className="pcr-binding-blocker" role="alert">BINDING BLOCKED · {bindingBlocker}</div>}
        {!snapshot && staleSnapshot ? (
          <>
            <div className="pcr-binding-blocker" role="alert">STALE LAST-KNOWN TRUTH · CONTROLS DISABLED · {bindingBlocker ?? unavailableReason ?? 'Continuity is not proven.'}</div>
            <OwnerViewPanel view={staleSnapshot.ownerView} />
          </>
        ) : !snapshot && busy ? (
          <div className="pcr-loading" role="status" aria-live="polite" aria-busy="true">Loading canonical supervisor truth…</div>
        ) : !snapshot ? (
          <div className="pcr-binding-blocker" role="alert">BINDING BLOCKED · {bindingBlocker ?? unavailableReason ?? 'Canonical supervisor truth is unavailable.'}</div>
        ) : (
          <>
            <OwnerViewPanel view={snapshot.ownerView} />
            <ControlRegistryPanel
              controls={snapshot.controls}
              busy={busy}
              allowFixtureControls={allowFixtureControls}
              onPreview={onPreview}
              onSubmit={onSubmit}
              onReadCommandResult={onReadCommandResult}
            />
            <div className="pcr-donor">
              <SystemDashboard
                snapshot={snapshot.dashboard}
                nowMs={nowMs}
                readOnlyProjection
                busy
                unavailableReason={null}
              />
            </div>
            <ComponentAuthorityPanel
              components={snapshot.components}
              edges={snapshot.dependencyEdges}
              serviceReadinessPolicy={snapshot.serviceReadinessPolicy}
              onTrace={readTrace}
            />
            <ManagedInventoryPanel inventory={snapshot.managedInventory} />
            <IncidentCursorPanel
              availability={snapshot.incidentAvailability}
              incidents={snapshot.incidents}
              materialEvents={materialEvents ?? snapshot.materialEvents}
              onTrace={readTrace}
            />
            <ProductTracePanel
              traces={snapshot.traces}
              liveTrace={liveTrace}
              busy={traceBusy}
              error={traceError}
              onReadTrace={readTrace}
            />
            <SurfaceBindingPanel snapshot={snapshot} onTrace={readTrace} />
          </>
        )}
      </div>
    </div>
  );
}

export interface FixtureProductControlRoomProps {
  readonly scenarioId: ProductFixtureScenarioId;
  readonly clock?: () => number;
  readonly tickIntervalMs?: number;
}

const SYSTEM_FIXTURE_CLOCK = () => Date.now();

export function FixtureProductControlRoom({
  scenarioId,
  clock = SYSTEM_FIXTURE_CLOCK,
  tickIntervalMs = 1_000,
}: FixtureProductControlRoomProps) {
  const [session, setSession] = useState<ProductFixtureSession>(() => {
    const now = clock();
    return createFixtureSession(scenarioId, `preview-${scenarioId.toLowerCase()}`, now);
  });

  useEffect(() => {
    const now = clock();
    setSession(createFixtureSession(scenarioId, `preview-${scenarioId.toLowerCase()}`, now));
  }, [clock, scenarioId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSession((current) => advanceFixtureSession(current, clock()));
    }, tickIntervalMs);
    return () => window.clearInterval(timer);
  }, [clock, tickIntervalMs]);

  const snapshot = useMemo(() => buildProductControlRoomFixture(session), [session]);
  const onPreview = async (control: Readonly<ProductControlRegistryEntry>) => {
    if (!control.preview) throw new Error(control.disabledReason ?? 'CONTROL_PREVIEW_UNAVAILABLE');
    return control.preview;
  };
  const onSubmit = async (request: Readonly<ProductCommandRequest>) => {
    const next = applyFixtureCommand(session, request);
    setSession(next);
    if (!next.lastResult) throw new Error('FIXTURE_RESULT_MISSING');
    return next.lastResult;
  };
  return <ProductControlRoom snapshot={snapshot} clock={clock} busy={false} allowFixtureControls onPreview={onPreview} onSubmit={onSubmit} />;
}

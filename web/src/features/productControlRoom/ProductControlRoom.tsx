import { useEffect, useMemo, useRef, useState } from 'react';
import type { SystemSupervisorSnapshot } from '../../lib/systemIntegration';
import {
  advanceFixtureSession,
  applyFixtureCommand,
  createFixtureSession,
  productTraceHasSyntheticEvidence,
  type ProductCommandRequest,
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
import { OwnerViewPanel } from './components/OwnerViewPanel';
import { ProductTracePanel } from './components/ProductTracePanel';
import { SurfaceBindingPanel } from './components/SurfaceBindingPanel';
import { buildProductControlRoomFixture } from './fixtureBinding';
import './styles/productControlRoom.css';

export interface ProductControlRoomProps {
  readonly snapshot: ProductSupervisorEnvelope<SystemSupervisorSnapshot> | null;
  readonly staleSnapshot?: ProductSupervisorEnvelope<SystemSupervisorSnapshot> | null;
  readonly materialEvents?: Readonly<MaterialEventPage> | null;
  readonly busy: boolean;
  readonly unavailableReason?: string | null;
  readonly bindingBlocker?: string | null;
  readonly allowFixtureControls?: boolean;
  readonly onPreview: (control: Readonly<ProductControlRegistryEntry>) => Promise<ProductControlPreview>;
  readonly onSubmit: (request: Readonly<ProductCommandRequest>) => Promise<ProductControlResult>;
  readonly onReadTrace?: (correlationId: string) => Promise<ProductCorrelationTrace>;
}

export function ProductControlRoom({
  snapshot,
  staleSnapshot = null,
  materialEvents = null,
  busy,
  unavailableReason = null,
  bindingBlocker = null,
  allowFixtureControls = false,
  onPreview,
  onSubmit,
  onReadTrace,
}: ProductControlRoomProps) {
  const [liveTrace, setLiveTrace] = useState<ProductCorrelationTrace | null>(null);
  const [traceBusy, setTraceBusy] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const traceRequestRef = useRef(0);

  useEffect(() => () => { traceRequestRef.current += 1; }, []);

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
            <ControlRegistryPanel controls={snapshot.controls} busy={busy} allowFixtureControls={allowFixtureControls} onPreview={onPreview} onSubmit={onSubmit} />
            <div className="pcr-donor">
              <SystemDashboard
                snapshot={snapshot.dashboard}
                nowMs={snapshot.evaluatedAtMs}
                readOnlyProjection
                busy
                unavailableReason={null}
              />
            </div>
            <ComponentAuthorityPanel components={snapshot.components} edges={snapshot.dependencyEdges} onTrace={readTrace} />
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
  return <ProductControlRoom snapshot={snapshot} busy={false} allowFixtureControls onPreview={onPreview} onSubmit={onSubmit} />;
}

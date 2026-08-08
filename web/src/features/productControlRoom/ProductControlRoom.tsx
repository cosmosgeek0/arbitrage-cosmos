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

export type OwnerCommandTruth = 'CURRENT' | 'STALE' | 'UNAVAILABLE';
export const OWNER_COMMAND_SNAPSHOT_STALE_AFTER_MS = 15_000;
const OWNER_COMMAND_CLOCK_SKEW_TOLERANCE_MS = 5_000;
const OWNER_COMMAND_MAX_PUBLIC_SOURCE_AGE_MS = 5 * 60_000;
const SYSTEM_WALL_CLOCK = () => Date.now();
// Ages rendered from the donor dashboard are minutes-scale; tick at the
// provider's 5s poll cadence rather than 1s so the correctness fix does not
// buy a per-second re-render of every panel.
const AGE_TICK_INTERVAL_MS = 5_000;
const PUBLIC_SOURCE_COMPONENT_IDS = Object.freeze(['public-spot-source', 'public-usdm-source']);
const PRODUCTION_DATA_FRESHNESS = /^(0|[1-9][0-9]{0,15})ms max public-source age$/;
const FIXTURE_CURRENT_FRESHNESS = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?s$/;
const STALE_FRESHNESS = /\b(?:stale|degraded|expired)\b/i;
const UNAVAILABLE_FRESHNESS = /\b(?:unknown|unavailable|missing|clock[-_\s]?skewed)\b/i;

function projectPublicSourceTruth(
  candidate: Readonly<ProductSupervisorEnvelope<unknown>>,
  freshness: string,
): OwnerCommandTruth {
  const sources = PUBLIC_SOURCE_COMPONENT_IDS.map((componentId) => (
    candidate.components.filter((component) => component.componentId === componentId)
  ));
  if (sources.some((matches) => matches.length !== 1)) return 'UNAVAILABLE';

  const exactSources = sources.map(([component]) => component!);
  if (exactSources.some((component) => (
    component.freshnessState === 'CLOCK_SKEWED' || component.freshnessState === 'UNAVAILABLE'
  ))) return 'UNAVAILABLE';
  if (exactSources.some((component) => component.freshnessState === 'STALE')) return 'STALE';
  if (!exactSources.every((component) => component.freshnessState === 'FRESH')) return 'UNAVAILABLE';

  const productionAge = PRODUCTION_DATA_FRESHNESS.exec(freshness);
  if (productionAge) {
    const ownerAgeMs = Number(productionAge[1]);
    if (!Number.isSafeInteger(ownerAgeMs) || ownerAgeMs < 0) return 'UNAVAILABLE';
    if (ownerAgeMs > OWNER_COMMAND_MAX_PUBLIC_SOURCE_AGE_MS) return 'STALE';

    const componentAges = exactSources.map((component) => component.sourceAgeMs);
    if (componentAges.some((age) => age === null || !Number.isSafeInteger(age) || age < 0)) {
      return 'UNAVAILABLE';
    }
    if (componentAges.some((age) => age! > OWNER_COMMAND_MAX_PUBLIC_SOURCE_AGE_MS)) return 'STALE';
    return 'CURRENT';
  }

  if (UNAVAILABLE_FRESHNESS.test(freshness)) return 'UNAVAILABLE';
  if (STALE_FRESHNESS.test(freshness)) return 'STALE';
  return FIXTURE_CURRENT_FRESHNESS.test(freshness) ? 'CURRENT' : 'UNAVAILABLE';
}

export function projectOwnerCommandTruth(
  snapshot: Readonly<ProductSupervisorEnvelope<unknown>> | null,
  staleSnapshot: Readonly<ProductSupervisorEnvelope<unknown>> | null,
  nowMs: number,
): OwnerCommandTruth {
  const candidate = snapshot ?? staleSnapshot;
  if (!candidate) return 'UNAVAILABLE';
  if (!snapshot) return 'STALE';
  if (!Number.isFinite(nowMs)
    || !Number.isFinite(candidate.evaluatedAtMs)
    || candidate.evaluatedAtMs <= 0
    || candidate.evaluatedAtMs - nowMs > OWNER_COMMAND_CLOCK_SKEW_TOLERANCE_MS) return 'UNAVAILABLE';
  const freshness = candidate.ownerView.dataFreshness?.trim() ?? '';
  if (!freshness) return 'UNAVAILABLE';
  const sourceTruth = projectPublicSourceTruth(candidate, freshness);
  if (sourceTruth !== 'CURRENT') return sourceTruth;
  return nowMs - candidate.evaluatedAtMs >= OWNER_COMMAND_SNAPSHOT_STALE_AFTER_MS
    ? 'STALE'
    : 'CURRENT';
}

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

  const commandTruth = projectOwnerCommandTruth(snapshot, staleSnapshot, nowMs);
  const commandMaterialEvents = materialEvents ?? snapshot?.materialEvents ?? staleSnapshot?.materialEvents ?? null;
  const commandContinuityProven = snapshot !== null
    && staleSnapshot === null
    && bindingBlocker === null
    && commandMaterialEvents?.continuity === 'PROVEN';
  const commandAuthorityReady = commandTruth === 'CURRENT' && commandContinuityProven;
  const commandAvailabilityBlocker = commandAuthorityReady
    ? null
    : !commandContinuityProven
      ? `COMMAND_CONTINUITY_NOT_PROVEN · ${bindingBlocker ?? `MATERIAL_EVENT_CONTINUITY_${commandMaterialEvents?.continuity ?? 'UNPROVEN'}`}`
      : commandTruth === 'STALE'
        ? 'COMMAND_POSTURE_STALE'
        : 'COMMAND_POSTURE_UNAVAILABLE';
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
      <div className="pcr-frame" data-owner-command-truth={commandTruth.toLowerCase()}>
        {(snapshot || staleSnapshot) && <div className="pcr-execution-barrier">LIVE_EXECUTION_NOT_IMPLEMENTED · NO LIVE ORDER, BORROW, TRANSFER, OR WITHDRAWAL AUTHORITY</div>}
        {bindingBlocker && snapshot && <div className="pcr-binding-blocker" role="alert">BINDING BLOCKED · {bindingBlocker}</div>}
        {snapshot && commandTruth !== 'CURRENT' && (
          <div className="pcr-binding-blocker" role="alert">
            {commandTruth === 'STALE' ? 'STALE CANONICAL POSTURE' : 'CANONICAL POSTURE UNAVAILABLE'} · {snapshot.ownerView.dataFreshness ?? 'DATA FRESHNESS UNKNOWN'}
          </div>
        )}
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
              busy={busy || !commandAuthorityReady}
              availabilityBlocker={commandAvailabilityBlocker}
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

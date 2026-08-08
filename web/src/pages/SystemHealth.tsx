import { useCallback, useMemo } from 'react';
import {
  Activity,
  BookOpen,
  ShieldCheck,
} from 'lucide-react';
import { ControlRegistryPanel } from '../features/productControlRoom/components/ControlRegistryPanel';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import { useProductControlRoomContext } from '../features/productControlRoom/ProductControlRoomProvider';
import { useStore } from '../store';
import { timeAgo } from '../format';
import { projectPrivateRead } from '../lib/privateRead';
import {
  type ProductBindingContinuity,
  type ProductCommandRequest,
  type ProductCommandResultIdentity,
  type ProductControlRegistryEntry,
} from '../lib/productIntegration';
import { ComponentOperationalHealthTable } from './ComponentOperationalHealthTable';
import './Health.css';

type HealthTone = 'healthy' | 'degraded' | 'broken';

export const HEALTH_MANAGED_RESTART_CONTROL_ID = 'component.engine-supervisor.restart' as const;

export function selectHealthManagedRestartControl(
  controls: readonly Readonly<ProductControlRegistryEntry>[],
  continuity: ProductBindingContinuity,
): Readonly<ProductControlRegistryEntry> | null {
  if (continuity !== 'PROVEN') return null;
  const control = controls.find((entry) => entry.controlId === HEALTH_MANAGED_RESTART_CONTROL_ID);
  if (!control
    || control.wiringState !== 'WIRED_LIVE'
    || control.backendCommandId !== 'RESTART_COMPONENT'
    || control.targetType !== 'COMPONENT'
    || control.targetId !== 'engine-supervisor'
    || control.effect !== 'RESTART'
    || Object.keys(control.payload).length !== 1
    || control.payload.componentId !== 'engine-supervisor') {
    return null;
  }
  return control;
}

export function SystemHealth() {
  const { privateRead, privateReadError, setPage } = useStore();
  const { binding, client } = useProductControlRoomContext();
  const snapshot = binding.snapshot;
  const healthSurface = snapshot?.surfaces.health;
  const machineReady = snapshot?.ownerView.machineReady ?? null;
  const restartControl = useMemo(
    () => selectHealthManagedRestartControl(snapshot?.controls ?? [], binding.continuity),
    [binding.continuity, snapshot?.controls],
  );
  const recoveryControls = useMemo<readonly Readonly<ProductControlRegistryEntry>[]>(
    () => restartControl ? [restartControl] : [],
    [restartControl],
  );
  const previewRestart = useCallback((
    control: Readonly<ProductControlRegistryEntry>,
    signal: AbortSignal,
  ) => {
    if (selectHealthManagedRestartControl([control], binding.continuity) === null) {
      return Promise.reject(new Error('HEALTH_MANAGED_RESTART_CONTROL_INVALID'));
    }
    return client.previewCommand(control.controlId, control.currentStateRevision, undefined, signal);
  }, [binding.continuity, client]);
  const submitRestart = useCallback((request: Readonly<ProductCommandRequest>) => {
    if (request.controlId !== HEALTH_MANAGED_RESTART_CONTROL_ID) {
      return Promise.reject(new Error('HEALTH_MANAGED_RESTART_SUBMIT_INVALID'));
    }
    return client.submitCommand(request);
  }, [client]);
  const readRestartResult = useCallback((
    identity: Readonly<ProductCommandResultIdentity>,
    signal?: AbortSignal,
  ) => client.readCommandResult(identity, signal), [client]);
  const overallPresentation = snapshot && binding.continuity === 'PROVEN'
    ? snapshot.canonicalCockpit.watchmanOverall
    : { status: 'outage' as const, label: 'Canonical Truth Unavailable' };
  const overallTone: HealthTone = overallPresentation.status === 'operational'
    ? 'healthy'
    : overallPresentation.status === 'outage'
      ? 'broken'
      : 'degraded';
  const advance = healthSurface?.evidence.find((datum) => datum.fieldId === 'heartbeat-advance');
  const ledgerSchema = healthSurface?.evidence.find((datum) => datum.fieldId === 'ledger-schema-compatibility');
  const privatePresentation = projectPrivateRead(privateRead);
  // Transport error first, then the freshness guard, then why the key posture
  // is what it is. Health never reports a reason it cannot substantiate.
  const privateReadReason = privateReadError
    ?? (privateRead.permissionPosture.state === 'UNSAFE'
      ? `${privatePresentation.postureDetail} · ${privatePresentation.freshness.reason}`
      : privatePresentation.freshness.state === 'CURRENT'
        ? privatePresentation.postureDetail
        : privatePresentation.freshness.reason);

  return (
    <div className="container page healthx-page">
      <section className="healthx-frame">
        <header className="healthx-toolbar">
          <div className="healthx-title">
            <img className="healthx-page-mark" src="/health-shield.png" alt="" aria-hidden="true" />
            <h1>Health</h1>
            <span className={`healthx-live ${overallTone}`}>
              <i aria-hidden="true" />
              {overallPresentation.label}
            </span>
            <span className="healthx-updated">
              {snapshot?.evaluatedAtMs
                ? `Evaluated ${timeAgo(snapshot.evaluatedAtMs)}`
                : binding.loading ? 'Reading Canonical Owner' : 'Canonical Read Unavailable'}
            </span>
          </div>
          <div className="healthx-toolbar-actions">
            <span className="healthx-access">
              <ShieldCheck size={14} />
              Product Integration
            </span>
          </div>
        </header>

        {snapshot ? (
          <div className="healthx-summary" aria-label="Canonical Health Summary">
            <div className="healthx-summary-cell">
              <span>Machine Readiness</span>
              <strong className={overallTone}>{machineReady ?? 'UNKNOWN'}</strong>
              <small>{snapshot.ownerView.topRootBlocker ?? `${overallPresentation.label} · Effective mode ${snapshot.ownerView.effectiveMode}`}</small>
            </div>
            <div className="healthx-summary-cell">
              <span>Meaningful Advance</span>
              <strong>{advance?.value ?? 'UNKNOWN'}</strong>
              <small>{advance?.unavailableReason ?? advance?.truthLabel ?? 'Canonical owner evidence unavailable.'}</small>
            </div>
            <div className="healthx-summary-cell">
              <span>Ops Interlock</span>
              <strong>{snapshot.opsIntakeInterlock.state}</strong>
              <small>{snapshot.opsIntakeInterlock.reasonCodes[0] ?? 'Canonical ops readback is current.'}</small>
            </div>
            <div className="healthx-summary-cell">
              <span>Ledger Compatibility</span>
              <strong>{ledgerSchema?.value ?? 'UNKNOWN'}</strong>
              <small>{ledgerSchema?.unavailableReason ?? ledgerSchema?.truthLabel ?? 'Canonical Ledger evidence unavailable.'}</small>
            </div>
          </div>
        ) : null}

        <ProductSurfaceAdapter surfaceId="health" />

        <section className="healthx-recovery" aria-labelledby="healthx-recovery-title">
          <header className="healthx-recovery-head">
            <div>
              <span>Operational Recovery</span>
              <h2 id="healthx-recovery-title">Restart Managed Root</h2>
              <p>One bounded task: preview the current canonical revision, confirm the supervised graph restart, then prove its durable receipt and readback.</p>
            </div>
            <strong className={restartControl ? 'ready' : 'blocked'}>
              {restartControl ? restartControl.wiringState : 'CONTROL UNAVAILABLE'}
            </strong>
          </header>
          {restartControl ? (
            <div className="healthx-recovery-control">
              <ControlRegistryPanel
                controls={recoveryControls}
                busy={binding.loading || binding.continuity !== 'PROVEN'}
                onPreview={previewRestart}
                onSubmit={submitRestart}
                onReadCommandResult={readRestartResult}
              />
            </div>
          ) : (
            <div className="healthx-recovery-unavailable" role="status">
              <ShieldCheck size={15} />
              <span>
                <strong>Managed restart is unavailable.</strong>
                Canonical continuity and the exact live restart registry entry are both required.
              </span>
            </div>
          )}
        </section>

        {snapshot ? (
          <>

            <ComponentOperationalHealthTable components={snapshot.components} />

            <div className="healthx-alert" title={privatePresentation.postureDetail}>
              <ShieldCheck size={14} />
              Private Account {privatePresentation.stateLabel} · Permissions {privatePresentation.postureLabel} · {privatePresentation.freshness.label} · {privateReadReason}
            </div>

            <div className="healthx-filter-actions">
              <span>Binding continuity: {binding.continuity}</span>
              <button type="button" className="healthx-button" onClick={() => setPage('ledger')}>
                <BookOpen size={14} />
                Audit Ledger
              </button>
            </div>
          </>
        ) : (
          <div className="healthx-empty healthx-loading">
            <Activity size={18} />
            <strong>Canonical Health Unavailable</strong>
            <span>{binding.error ?? 'Waiting for the Product Integration supervisor.'}</span>
          </div>
        )}
      </section>
    </div>
  );
}

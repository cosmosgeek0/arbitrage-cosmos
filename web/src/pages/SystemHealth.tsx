import {
  Activity,
  BookOpen,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import { useProductControlRoomContext } from '../features/productControlRoom/ProductControlRoomProvider';
import { useStore } from '../store';
import { timeAgo } from '../format';
import { projectPrivateRead } from '../lib/privateRead';
import { ComponentOperationalHealthTable } from './ComponentOperationalHealthTable';
import './Health.css';

type HealthTone = 'healthy' | 'degraded' | 'broken';

export function SystemHealth() {
  const { privateRead, privateReadError, setPage } = useStore();
  const { binding } = useProductControlRoomContext();
  const snapshot = binding.snapshot;
  const healthSurface = snapshot?.surfaces.health;
  const machineReady = snapshot?.ownerView.machineReady ?? null;
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
            <button
              type="button"
              className={`healthx-button${binding.loading ? ' loading' : ''}`}
              disabled={binding.loading}
              onClick={() => void binding.refresh()}
            >
              <RefreshCw size={14} />
              {binding.loading ? 'Refreshing' : 'Refresh'}
            </button>
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
            {!binding.loading ? (
              <button type="button" className="healthx-button" onClick={() => void binding.refresh()}>Try Again</button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

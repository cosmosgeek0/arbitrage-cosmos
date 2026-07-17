import type { ProductSurfaceProjection, ProductSupervisorEnvelope, SurfaceId } from '../../../lib/productIntegration';
import { productSurfaceReadinessBlocker, REQUIRED_SURFACE_IDS } from '../../../lib/productIntegration';
import { useProductControlRoomContext } from '../ProductControlRoomProvider';

export function ProductSurfaceAdapter({
  surfaceId,
}: {
  surfaceId: SurfaceId;
}) {
  const { binding } = useProductControlRoomContext();
  const surface = binding.snapshot?.surfaces[surfaceId];
  if (!surface) {
    return (
      <section className="pcr-surface pcr-surface-unavailable" aria-label={`${surfaceId} Binding`}>
        <span><strong>{surfaceId}</strong><small>{binding.error ?? 'Canonical supervisor projection is unavailable.'}</small></span>
        <span className="pcr-surface-end"><em>MISSING</em><b>BLOCKED_BACKEND</b></span>
      </section>
    );
  }
  return (
    <section className="pcr-surface-adapter pcr-section" aria-label={`${surface.label} Canonical Binding`}>
      {binding.continuity !== 'PROVEN' && <div className="pcr-binding-blocker" role="alert">STALE LAST-KNOWN TRUTH · BLOCKED_BACKEND · {binding.error ?? `Continuity is ${binding.continuity}.`}</div>}
      <header className="pcr-band"><h2>{surface.label} Binding</h2><span>{surface.evidence.length} Required Evidence Fields</span></header>
      <SurfaceRow surface={surface} blocked={binding.continuity !== 'PROVEN'} />
      <SurfaceEvidenceGrid surface={surface} blocked={binding.continuity !== 'PROVEN'} />
    </section>
  );
}

export function SurfaceBindingPanel({ snapshot, onTrace }: {
  snapshot: Readonly<ProductSupervisorEnvelope<unknown>>;
  onTrace?: (correlationId: string) => void;
}) {
  return (
    <section className="pcr-section" aria-label="Surface Adapter Package">
      <header className="pcr-band"><h2>Surface Adapter Package</h2><span>{REQUIRED_SURFACE_IDS.length} Exact Mount Rows</span></header>
      <div className="pcr-surface-list">
        {REQUIRED_SURFACE_IDS.map((surfaceId) => <SurfaceRow key={surfaceId} surface={snapshot.surfaces[surfaceId]} onTrace={onTrace} />)}
      </div>
      <header className="pcr-band"><h2>Control Room Required Evidence</h2><span>{snapshot.surfaces['control-room'].evidence.length} Contract Fields</span></header>
      <SurfaceEvidenceGrid surface={snapshot.surfaces['control-room']} />
    </section>
  );
}

function SurfaceEvidenceGrid({ surface, blocked = false }: { surface: Readonly<ProductSurfaceProjection>; blocked?: boolean }) {
  return (
    <dl className="pcr-surface-evidence">
      {surface.evidence.map((datum) => (
        <div key={datum.fieldId}>
          <dt>{datum.label}</dt>
          <dd><strong>{datum.value ?? 'UNKNOWN'}</strong><small>{datum.unavailableReason ?? datum.canonicalSource}</small></dd>
          <em className={blocked ? 'truth-blocked' : `truth-${datum.truthLabel.toLowerCase().replaceAll('_', '-')}`}>{blocked ? 'STALE' : datum.truthLabel}</em>
        </div>
      ))}
    </dl>
  );
}

function SurfaceRow({ surface, blocked = false, onTrace }: {
  surface: Readonly<ProductSurfaceProjection>;
  blocked?: boolean;
  onTrace?: (correlationId: string) => void;
}) {
  const requiredEvidenceBlocker = productSurfaceReadinessBlocker(surface);
  const relationallyBlocked = requiredEvidenceBlocker !== null;
  const effectiveBlocked = blocked || relationallyBlocked;
  const truthClass = `truth-${surface.truthLabel.toLowerCase().replaceAll('_', '-')}`;
  return (
    <article className="pcr-surface" data-surface-ready={effectiveBlocked ? 'false' : 'true'} aria-label={`${surface.label} Binding`}>
      <span><strong>{surface.label}</strong><small>{surface.summary}</small></span>
      <span>
        <code>{surface.canonicalSource}</code>
        <small>{surface.evidence.length} required fields · {blocked ? 'STALE_CANONICAL_CONTINUITY' : requiredEvidenceBlocker ?? surface.blocker ?? 'No Adapter Blocker'}</small>
        {surface.correlationId && onTrace && <button className="pcr-trace-link" type="button" onClick={() => onTrace(surface.correlationId!)}>Read Trace</button>}
      </span>
      <span className="pcr-surface-end"><em className={effectiveBlocked ? 'truth-blocked' : truthClass}>{effectiveBlocked ? 'BLOCKED' : surface.truthLabel}</em><b className={`binding-${effectiveBlocked ? 'blocked-backend' : surface.bindingState.toLowerCase().replaceAll('_', '-')}`}>{effectiveBlocked ? 'BLOCKED_BACKEND' : surface.bindingState}</b></span>
    </article>
  );
}

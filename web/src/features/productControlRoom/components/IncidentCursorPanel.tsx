import type { ProductIncidentProjection, MaterialEventPage } from '../../../lib/productIntegration';

export function IncidentCursorPanel({ incidents, materialEvents }: {
  incidents: readonly Readonly<ProductIncidentProjection>[];
  materialEvents: Readonly<MaterialEventPage>;
}) {
  return (
    <section className="pcr-section" aria-label="Incidents And Material Event Cursor">
      <header className="pcr-band"><h2>Incidents & Material Cursor</h2><span>{materialEvents.continuity} · Cursor {materialEvents.nextCursor}</span></header>
      <div className="pcr-cursor">
        <span>Gap-Free <strong>{materialEvents.continuity}</strong></span>
        <span>Truncated <strong>{materialEvents.truncated ? 'YES' : 'NO'}</strong></span>
        <span>Backfill <strong>{materialEvents.backfillRequired ? 'REQUIRED' : 'NOT REQUIRED'}</strong></span>
        <span>Material Events <strong>{materialEvents.items.length}</strong></span>
      </div>
      <div className="pcr-incident-list">
        {incidents.length === 0 ? <p>No grouped incident requires attention.</p> : incidents.map((incident) => (
          <article key={incident.fingerprint}>
            <span><strong>{incident.reasonCode}</strong><small>{incident.operatorAction ?? 'No operator action published.'}</small></span>
            <span><code>{incident.rootComponentId}</code><small>{incident.count} grouped · {incident.state}</small></span>
            <em className={`severity-${incident.severity.toLowerCase()} state-${incident.state.toLowerCase()}`}>{incident.severity}{incident.capitalRelevant ? ' · CAPITAL' : ''}</em>
          </article>
        ))}
      </div>
    </section>
  );
}

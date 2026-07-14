import type {
  MaterialEventPage,
  ProductIncidentAvailability,
  ProductIncidentProjection,
} from '../../../lib/productIntegration';

export function IncidentCursorPanel({ availability, incidents, materialEvents, onTrace }: {
  availability: Readonly<ProductIncidentAvailability>;
  incidents: readonly Readonly<ProductIncidentProjection>[];
  materialEvents: Readonly<MaterialEventPage>;
  onTrace?: (correlationId: string) => void;
}) {
  return (
    <section className="pcr-section" aria-label="Incidents And Material Event Cursor">
      <header className="pcr-band"><h2>Incidents & Material Cursor</h2><span>{materialEvents.continuity} · Cursor {materialEvents.nextCursor}/{materialEvents.highWaterCursor}</span></header>
      <div className="pcr-cursor">
        <span>Gap-Free <strong>{materialEvents.continuity}</strong></span>
        <span>Truncated <strong>{materialEvents.truncated ? 'YES' : 'NO'}</strong></span>
        <span>Backfill <strong>{materialEvents.backfillRequired || materialEvents.hasMore ? 'REQUIRED' : 'NOT REQUIRED'}</strong></span>
        <span>Material Events <strong>{materialEvents.items.length}</strong></span>
      </div>
      <div className="pcr-incident-list">
        {availability.state !== 'AVAILABLE' ? (
          <div className="pcr-incident-unavailable" role="status">
            <strong>Incident Truth {availability.state}</strong>
            <span>{availability.blocker ?? 'The canonical incident owner did not publish availability.'}</span>
            <em className={`truth-${availability.truthLabel.toLowerCase().replaceAll('_', '-')}`}>{availability.truthLabel}</em>
          </div>
        ) : incidents.length === 0 ? (
          <p>Incident owner is available; no grouped incident requires attention.</p>
        ) : incidents.map((incident) => (
          <article key={incident.fingerprint}>
            <span><strong>{incident.reasonCode}</strong><small>{incident.operatorAction ?? 'No operator action published.'}</small></span>
            <span>
              <code>{incident.rootComponentId}</code>
              <small>{incident.count} grouped · {incident.state}</small>
              {incident.correlationId && onTrace && <button className="pcr-trace-link" type="button" onClick={() => onTrace(incident.correlationId!)}>Read Trace</button>}
            </span>
            <em className={`severity-${incident.severity.toLowerCase()} state-${incident.state.toLowerCase()}`}>{incident.severity}{incident.capitalRelevant ? ' · CAPITAL' : ''}</em>
          </article>
        ))}
      </div>
    </section>
  );
}

import type { CuratedNotification } from '../notifications';
import type { ProductIncidentAvailability, ProductIncidentProjection } from './model';

function componentLabel(componentId: string): string {
  return componentId
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/** One-to-one browser presentation of server-grouped durable incident episodes. */
export function projectCanonicalIncidentNotifications(
  availability: Readonly<ProductIncidentAvailability>,
  incidents: readonly Readonly<ProductIncidentProjection>[],
): readonly Readonly<CuratedNotification>[] {
  if (availability.state !== 'AVAILABLE') return Object.freeze([]);
  return Object.freeze([...incidents]
    .sort((left, right) => {
      const stateRank = { OPEN: 0, ACKNOWLEDGED: 1, RESOLVED: 2 } as const;
      const severityRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
      return stateRank[left.state] - stateRank[right.state]
        || severityRank[left.severity] - severityRank[right.severity]
        || right.lastSeenAtMs - left.lastSeenAtMs
        || left.incidentId.localeCompare(right.incidentId);
    })
    .map((incident) => {
      const recovered = incident.state === 'RESOLVED';
      const subject = componentLabel(incident.rootComponentId);
      const severity = recovered
        ? 'resolved' as const
        : incident.severity === 'CRITICAL'
          ? 'critical' as const
          : incident.severity === 'LOW' ? 'info' as const : 'warning' as const;
      const category = incident.sourceGroup === 'infrastructure'
        ? 'infrastructure' as const
        : incident.capitalRelevant || incident.severity === 'CRITICAL'
          ? 'critical' as const
          : 'health' as const;
      return Object.freeze({
        id: incident.ledgerEventId,
        ts: incident.lastSeenAtMs,
        category,
        severity,
        title: recovered ? `${subject} Recovered` : `${subject} Incident`,
        detail: `${incident.reasonCode.replaceAll('_', ' ')} · ${incident.operatorAction ?? 'No operator action published.'}`,
        subject,
        symbol: null,
        kind: 'product_incident',
        count: incident.count,
        origin: 'bot' as const,
        needsAction: incident.state !== 'RESOLVED',
      });
    }));
}

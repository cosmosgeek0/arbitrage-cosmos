import { useMemo, useState } from 'react';
import type { ProductComponentProjection, ProductDependencyEdgeProjection } from '../../../lib/productIntegration';

export function ComponentAuthorityPanel({
  components,
  edges,
  onTrace,
}: {
  readonly components: readonly Readonly<ProductComponentProjection>[];
  readonly edges: readonly Readonly<ProductDependencyEdgeProjection>[];
  readonly onTrace?: (correlationId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return components.filter((component) => `${component.componentId} ${component.owner} ${component.blockerCode ?? ''}`.toLowerCase().includes(needle));
  }, [components, query]);
  return (
    <section className="pcr-section" aria-label="Canonical Component Authority">
      <header className="pcr-band"><h2>Component Authority</h2><span>{filtered.length}/{components.length} Components · {edges.length} Dependency Edges</span></header>
      <div className="pcr-component-search"><label>Search component, owner, blocker<input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label></div>
      <div className="pcr-component-list">
        {filtered.map((component) => {
          const incoming = edges.filter((edge) => edge.toComponentId === component.componentId);
          return (
            <article key={component.componentId}>
              <header><span><strong>{component.componentId}</strong><small>{component.owner}</small></span><em>{component.truthLabel}</em></header>
              <dl>
                <div><dt>Desired / Observed</dt><dd>{component.desiredLifecycle} / {component.observedLifecycle}</dd></div>
                <div><dt>Capability</dt><dd>{component.capability}</dd></div>
                <div><dt>Heartbeat / Advance</dt><dd>{value(component.heartbeatAtMs)} / {value(component.lastAdvanceAtMs)}</dd></div>
                <div><dt>Source / Event / Processing Age</dt><dd>{value(component.sourceAgeMs)} / {value(component.eventAgeMs)} / {value(component.processingAgeMs)}</dd></div>
                <div><dt>Queue / Dropped</dt><dd>{value(component.queueDepth)}/{value(component.queueCapacity)} · {value(component.droppedCount)}</dd></div>
                <div><dt>Blocker / Root</dt><dd>{component.blockerCode ?? 'NONE'} / {component.rootCauseComponentId ?? 'NONE'}</dd></div>
                <div><dt>Capital</dt><dd>{component.capitalRelevance}</dd></div>
                <div><dt>Controls</dt><dd>{component.supportedControlIds.join(' · ') || 'NONE'}</dd></div>
                <div><dt>Correlation</dt><dd>{component.correlationId ?? 'UNKNOWN'}{component.correlationId && onTrace && <button className="pcr-trace-link" type="button" onClick={() => onTrace(component.correlationId!)}>Read Trace</button>}</dd></div>
                <div><dt>Dependencies</dt><dd>{incoming.length ? incoming.map((edge) => `${edge.fromComponentId}:${edge.state}`).join(' · ') : 'NONE PUBLISHED'}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function value(input: number | null): string {
  return input === null ? 'UNKNOWN' : String(input);
}

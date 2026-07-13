import type { ProductCorrelationTrace } from '../../../lib/productIntegration';

export function ProductTracePanel({ traces }: { readonly traces: readonly Readonly<ProductCorrelationTrace>[] }) {
  return (
    <section className="pcr-section" aria-label="Canonical Twelve Stage Traces">
      <header className="pcr-band"><h2>Canonical Trace</h2><span>12 Stages · Null Stays Unknown</span></header>
      {traces.length === 0 ? (
        <div className="pcr-empty">No canonical correlation trace is available.</div>
      ) : traces.map((trace) => (
        <article className="pcr-trace" key={trace.correlationId} aria-label={`Trace ${trace.correlationId}`}>
          <header><code>{trace.correlationId}</code><span>{trace.symbol ?? 'SYMBOL UNKNOWN'}</span></header>
          <ol>
            {trace.stages.map((stage, index) => (
              <li key={`${trace.correlationId}-${stage.stage}`}>
                <b>{String(index + 1).padStart(2, '0')}</b>
                <span><strong>{stage.stage}</strong><small>{stage.owner}</small></span>
                <span><code>{stage.referenceId ?? 'UNKNOWN'}</code><small>{stage.outcome}</small></span>
                <em className={`truth-${stage.truthLabel.toLowerCase().replaceAll('_', '-')}`}>{stage.truthLabel}</em>
              </li>
            ))}
          </ol>
        </article>
      ))}
    </section>
  );
}

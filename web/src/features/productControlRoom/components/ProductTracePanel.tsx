import { useMemo, useState, type FormEvent } from 'react';
import type { ProductCorrelationTrace } from '../../../lib/productIntegration';

export function ProductTracePanel({ traces, liveTrace, busy, error, onReadTrace }: {
  readonly traces: readonly Readonly<ProductCorrelationTrace>[];
  readonly liveTrace: Readonly<ProductCorrelationTrace> | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onReadTrace: (correlationId: string) => void;
}) {
  const [correlationId, setCorrelationId] = useState('');
  const displayed = useMemo(() => liveTrace
    ? [liveTrace, ...traces.filter((trace) => trace.correlationId !== liveTrace.correlationId)]
    : traces, [liveTrace, traces]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (correlationId.trim()) onReadTrace(correlationId.trim());
  };
  return (
    <section className="pcr-section" aria-label="Canonical Twelve Stage Traces">
      <header className="pcr-band"><h2>Canonical Trace</h2><span>12 Stages · Evidence Bounds Stay Explicit</span></header>
      <form className="pcr-trace-lookup" onSubmit={submit}>
        <label>Correlation ID<input type="text" value={correlationId} onChange={(event) => setCorrelationId(event.currentTarget.value)} maxLength={160} /></label>
        <button type="submit" disabled={busy || correlationId.trim().length === 0}>{busy ? 'Reading…' : 'Read Live Trace'}</button>
        {error && <span role="alert">{error}</span>}
      </form>
      {displayed.length === 0 ? (
        <div className="pcr-empty">No canonical correlation trace is available.</div>
      ) : displayed.map((trace) => (
        <article className="pcr-trace" key={trace.correlationId} aria-label={`Trace ${trace.correlationId}`}>
          <header>
            <code>{trace.correlationId}</code>
            <span>{trace.symbol ?? 'SYMBOL UNKNOWN'}</span>
            <button className="pcr-trace-link" type="button" onClick={() => onReadTrace(trace.correlationId)} disabled={busy}>Refresh</button>
            <em className={`pcr-trace-completeness ${trace.truncated ? 'truncated' : 'complete'}`}>{trace.completeness}</em>
          </header>
          <ol>
            {trace.stages.map((stage, index) => (
              <li key={`${trace.correlationId}-${stage.stage}`}>
                <b>{String(index + 1).padStart(2, '0')}</b>
                <span><strong>{stage.stage}</strong><small>{stage.owner}</small></span>
                <span><code>{stage.referenceId ?? 'UNKNOWN'}</code><small>{stage.outcome} · {stage.evidenceState}</small></span>
                <em className={`truth-${stage.truthLabel.toLowerCase().replaceAll('_', '-')}`}>{stage.truthLabel}</em>
              </li>
            ))}
          </ol>
        </article>
      ))}
    </section>
  );
}

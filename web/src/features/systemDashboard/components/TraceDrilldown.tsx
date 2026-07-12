// TraceDrilldown — DASHBOARD_TRUTH item 9: click any decision → the full
// correlated chain by correlation ID, staged evidence → assessment →
// decision → capital → risk → plan → reconciliation → ledger. Grouping is
// presentation only; every fact is the trace verbatim.

import { useEffect, useRef } from 'react';
import type { SystemSupervisorSnapshot, SystemTraceDecision } from '../../../lib/systemIntegration';
import {
  STAGE_ORDER,
  ageText,
  traceStage,
  words,
} from '../lib/presentation';
import { Band, TruthTag } from './bits';

interface TraceGroup {
  correlationId: string;
  traces: SystemTraceDecision[];
  newestAtMs: number;
  failureCount: number;
}

function groupTraces(decisions: SystemTraceDecision[]): TraceGroup[] {
  const groups = new Map<string, SystemTraceDecision[]>();
  for (const trace of decisions) {
    const list = groups.get(trace.correlationId) ?? [];
    list.push(trace);
    groups.set(trace.correlationId, list);
  }
  return [...groups.entries()]
    .map(([correlationId, traces]) => ({
      correlationId,
      traces: [...traces].sort((a, b) => a.occurredAtMs - b.occurredAtMs),
      newestAtMs: Math.max(...traces.map((t) => t.occurredAtMs)),
      failureCount: traces.filter((t) => t.failureCode !== null).length,
    }))
    .sort((a, b) => b.newestAtMs - a.newestAtMs);
}

function ChainRow({ trace, nowMs }: { trace: SystemTraceDecision; nowMs: number }) {
  const identity = trace.ownerId ?? trace.canonicalProjectionId ?? trace.referenceIds[0] ?? null;
  return (
    <div className="sdx-chain-row">
      <span className="sdx-chain-stage">{traceStage(trace.componentId)}</span>
      <span className="sdx-chain-main">
        <strong>
          {words(trace.kind)}
          {identity && <code>{identity}</code>}
        </strong>
        <small>
          {words(trace.componentId)} · {ageText(trace.occurredAtMs, nowMs)}
          {trace.revisionDigest ? ` · rev ${trace.revisionDigest.slice(0, 12)}` : ''}
          {trace.referenceIds.length ? ` · refs ${trace.referenceIds.join(', ')}` : ''}
        </small>
      </span>
      <span className="sdx-chain-end">
        {trace.failureCode && <span className="sdx-reason">{trace.failureCode}</span>}
        <TruthTag label={trace.truthLabel} />
      </span>
    </div>
  );
}

export function TraceDrilldown({
  snapshot,
  nowMs,
  selectedCorrelationId,
  onSelect,
}: {
  snapshot: SystemSupervisorSnapshot;
  nowMs: number;
  selectedCorrelationId: string | null;
  onSelect: (correlationId: string | null) => void;
}) {
  const groups = groupTraces(snapshot.recentCorrelatedDecisions);
  const sectionRef = useRef<HTMLElement | null>(null);

  // When an engine/risk row links here, bring the chain into view.
  useEffect(() => {
    if (selectedCorrelationId && sectionRef.current) {
      sectionRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedCorrelationId]);

  return (
    <section className="sdx-section" aria-label="Trace drill-down" ref={sectionRef}>
      <Band
        title="Trace Drill-Down"
        meta={<span>{groups.length} correlation{groups.length === 1 ? '' : 's'} in the recent window</span>}
      />
      {groups.length === 0 ? (
        <div className="sdx-attn-empty">No correlated decision in the supervisor's recent window. The supervisor will not fabricate a trace.</div>
      ) : groups.map((group) => {
        const open = group.correlationId === selectedCorrelationId;
        const stages = new Set(group.traces.map((t) => traceStage(t.componentId)));
        const stageSpan = STAGE_ORDER.filter((stage) => stages.has(stage));
        return (
          <div key={group.correlationId} className="sdx-trace-group">
            <button
              type="button"
              className={`sdx-trace-head${open ? ' selected' : ''}`}
              aria-expanded={open}
              onClick={() => onSelect(open ? null : group.correlationId)}
            >
              <span className="sdx-row-main">
                <strong><code className="sdx-code">{group.correlationId}</code></strong>
                <small>
                  {group.traces.length} event{group.traces.length === 1 ? '' : 's'} · {stageSpan[0]} → {stageSpan[stageSpan.length - 1]} · newest {ageText(group.newestAtMs, nowMs)}
                </small>
              </span>
              <span className="sdx-row-end">
                {group.failureCount > 0 && <span className="sdx-reason">{group.failureCount} FAILURE{group.failureCount === 1 ? '' : 'S'}</span>}
                <span className="sdx-val">{open ? 'Collapse' : 'Expand'}</span>
              </span>
            </button>
            {open && (
              <div className="sdx-chain">
                {group.traces.map((trace) => <ChainRow key={trace.eventId} trace={trace} nowMs={nowMs} />)}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

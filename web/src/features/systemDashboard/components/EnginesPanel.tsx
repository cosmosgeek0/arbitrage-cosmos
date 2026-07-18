// EnginesPanel — DASHBOARD_TRUTH item 4: Basis and Volume live ages, counts,
// and the latest decisions/rejects with EXACT reason codes (verbatim mono,
// never prettified away). Decision rows link into the trace drill-down.

import type {
  SystemComponentId,
  SystemSupervisorSnapshot,
  SystemTraceDecision,
} from '../../../lib/systemIntegration';
import {
  UNKNOWN_TEXT,
  ageText,
  componentStateText,
  componentTone,
  countText,
  words,
} from '../lib/presentation';
import { Band, Chip, FactRow, TruthTag, Val } from './bits';

function EngineSection({
  engineId,
  title,
  snapshot,
  nowMs,
  onTrace,
}: {
  engineId: 'basis-engine' | 'volume-engine';
  title: string;
  snapshot: SystemSupervisorSnapshot;
  nowMs: number;
  onTrace: (correlationId: string) => void;
}) {
  const summary = snapshot.summaries.strategies[engineId === 'basis-engine' ? 'basis' : 'volume'];
  const component = snapshot.components.find((c) => c.componentId === engineId);
  const universe = snapshot.summaries.sourceCoverage.universeSymbols;
  const focusActive = snapshot.summaries.intelligence.focusActiveCount;
  const decisions = snapshot.recentCorrelatedDecisions
    .filter((trace) => trace.componentId === engineId)
    .sort((a, b) => b.occurredAtMs - a.occurredAtMs)
    .slice(0, 4);

  return (
    <section className="sdx-section" aria-label={title}>
      <Band
        title={title}
        meta={<>
          <span>Universe <code>{countText(universe)}</code> · Focus <code>{countText(focusActive)}</code></span>
          {component
            ? <Chip tone={componentTone(component)}>{componentStateText(component)}</Chip>
            : <span className="sdx-truth unknown">MISSING</span>}
          <TruthTag label={summary.truthLabel} />
        </>}
      />
      <div className="sdx-stats">
        <div className="sdx-stat"><span>Heartbeat</span><b className={summary.heartbeatAtMs === null ? 'unk' : ''}>{ageText(summary.heartbeatAtMs, nowMs)}</b></div>
        <div className="sdx-stat"><span>Candidates</span><b className={summary.candidateCount === null ? 'unk' : ''}>{countText(summary.candidateCount)}</b></div>
        <div className="sdx-stat"><span>Proposals</span><b className={summary.proposalCount === null ? 'unk' : ''}>{countText(summary.proposalCount)}</b></div>
        <div className="sdx-stat"><span>Cooldown</span><b className={summary.cooldownCount === null ? 'unk' : (summary.cooldownCount > 0 ? 'warn' : '')}>{countText(summary.cooldownCount)}</b></div>
        <div className="sdx-stat"><span>Accepted</span><b className={summary.acceptedCount === null ? 'unk' : ''}>{countText(summary.acceptedCount)}</b></div>
        <div className="sdx-stat"><span>Rejected</span><b className={summary.rejectionCount === null ? 'unk' : (summary.rejectionCount > 0 ? 'warn' : '')}>{countText(summary.rejectionCount)}</b></div>
      </div>
      <div className="sdx-rows">
        <FactRow
          label="Last Decision"
          sub={`Source revision ${summary.sourceRevision ?? UNKNOWN_TEXT}`}
          end={<Val text={ageText(summary.lastDecisionAtMs, nowMs)} />}
        />
        {decisions.length === 0 ? (
          <FactRow
            label="No decision in the recent trace window"
            sub="The supervisor reported no correlated decision for this engine."
            end={<Val text={UNKNOWN_TEXT} />}
          />
        ) : decisions.map((trace) => <DecisionRow key={trace.eventId} trace={trace} nowMs={nowMs} onTrace={onTrace} />)}
      </div>
    </section>
  );
}

function DecisionRow({
  trace,
  nowMs,
  onTrace,
}: {
  trace: SystemTraceDecision;
  nowMs: number;
  onTrace: (correlationId: string) => void;
}) {
  return (
    <div className="sdx-row">
      <span className="sdx-row-main">
        <strong>{words(trace.kind)}{trace.ownerId ? ` · ${trace.ownerId}` : ''}</strong>
        <small>{ageText(trace.occurredAtMs, nowMs)} · {trace.correlationId}</small>
      </span>
      <span className="sdx-row-end">
        {trace.failureCode && <span className="sdx-reason">{trace.failureCode}</span>}
        <TruthTag label={trace.truthLabel} />
        <button type="button" className="sdx-button" onClick={() => onTrace(trace.correlationId)}>Trace</button>
      </span>
    </div>
  );
}

export function EnginesPanel({
  snapshot,
  nowMs,
  onTrace,
}: {
  snapshot: SystemSupervisorSnapshot;
  nowMs: number;
  onTrace: (correlationId: string) => void;
}) {
  return (
    <div className="sdx-duo">
      <EngineSection engineId="basis-engine" title="Basis Engine" snapshot={snapshot} nowMs={nowMs} onTrace={onTrace} />
      <EngineSection engineId="volume-engine" title="Volume Engine" snapshot={snapshot} nowMs={nowMs} onTrace={onTrace} />
    </div>
  );
}

export type EngineComponentId = Extract<SystemComponentId, 'basis-engine' | 'volume-engine'>;

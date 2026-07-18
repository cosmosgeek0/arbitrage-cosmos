// RiskExecutionPanel — DASHBOARD_TRUTH item 7: latest multi-leg verdicts
// with blocking codes, dry-run plan/leg lifecycle, reconciliation state, and
// the permanent LIVE_EXECUTION_NOT_IMPLEMENTED barrier, always visible.

import type { SystemSupervisorSnapshot } from '../../../lib/systemIntegration';
import {
  ageText,
  countText,
  reconciliationVerdict,
  textOrUnknown,
  words,
  type Tone,
} from '../lib/presentation';
import { Band, Chip, FactRow, TruthTag, Val } from './bits';

function verdictTone(verdict: 'APPROVE' | 'REJECT' | 'CAP' | 'UNAVAILABLE'): Tone {
  if (verdict === 'APPROVE') return 'ok';
  if (verdict === 'REJECT') return 'bad';
  if (verdict === 'CAP') return 'warn';
  return 'idle';
}

/** Find the correlation carrying a reference id (plan id, verdict id) so the
 *  row can link into the trace drill-down. Lookup only, never inference. */
function correlationForReference(snapshot: SystemSupervisorSnapshot, referenceId: string | null): string | null {
  if (!referenceId) return null;
  const trace = snapshot.recentCorrelatedDecisions.find((t) => t.referenceIds.includes(referenceId));
  return trace?.correlationId ?? null;
}

function TraceLink({ correlationId, onTrace }: { correlationId: string | null; onTrace: (id: string) => void }) {
  if (!correlationId) return null;
  return <button type="button" className="sdx-button" onClick={() => onTrace(correlationId)}>Trace</button>;
}

function RiskSection({
  snapshot,
  nowMs,
  onTrace,
}: {
  snapshot: SystemSupervisorSnapshot;
  nowMs: number;
  onTrace: (correlationId: string) => void;
}) {
  const risk = snapshot.summaries.risk;
  return (
    <section className="sdx-section" aria-label="Multi-leg risk">
      <Band title="Multi-Leg Risk" meta={<TruthTag label={risk.truthLabel} />} />
      <div className="sdx-rows">
        <FactRow
          label={`Latest Verdict · ${words(risk.latestVerdict)}`}
          sub={`${textOrUnknown(risk.latestVerdictId)} · ${ageText(risk.latestVerdictAtMs, nowMs)}`}
          end={<>
            <Chip tone={verdictTone(risk.latestVerdict)}>{risk.latestVerdict}</Chip>
            <TraceLink correlationId={correlationForReference(snapshot, risk.latestVerdictId)} onTrace={onTrace} />
          </>}
        />
        <FactRow
          label="Blocking Codes"
          sub={risk.reasonCodes.length ? 'Verbatim from the risk owner' : 'No blocking code on the latest verdict'}
          end={risk.reasonCodes.length
            ? <span className="sdx-row-end">{risk.reasonCodes.map((code) => <span key={code} className="sdx-reason">{code}</span>)}</span>
            : <Val text="NONE" />}
        />
        <FactRow
          label="Rejections In Window"
          sub="Verdicts rejected in the supervisor's rolling window"
          end={<Val text={countText(risk.rejectionCount)} tone={(risk.rejectionCount ?? 0) > 0 ? 'warn' : undefined} />}
        />
      </div>
    </section>
  );
}

function ExecutionSection({
  snapshot,
  nowMs,
  onTrace,
}: {
  snapshot: SystemSupervisorSnapshot;
  nowMs: number;
  onTrace: (correlationId: string) => void;
}) {
  const execution = snapshot.summaries.execution;
  const reconciliation = snapshot.summaries.reconciliation;
  const reconciliationState = reconciliationVerdict(snapshot);
  return (
    <section className="sdx-section" aria-label="Execution and reconciliation">
      <Band
        title="Execution · Validate Only"
        meta={<>
          <code>{execution.mode}</code>
          <TruthTag label={execution.truthLabel} />
        </>}
      />
      <div className="sdx-barrier" role="note">
        <code>{execution.barrier}</code>
        <span>— no order can reach an exchange from this machine.</span>
      </div>
      <div className="sdx-rows">
        <FactRow
          label={`Plan · ${textOrUnknown(execution.planId)}`}
          sub={`Coordinator ${execution.coordinatorState} · Last transition ${ageText(execution.lastTransitionAtMs, nowMs)}`}
          end={<>
            <Val text={textOrUnknown(execution.planLifecycle)} />
            <Val text={`${countText(execution.legCount)} legs`} />
            <TraceLink correlationId={correlationForReference(snapshot, execution.planId)} onTrace={onTrace} />
          </>}
        />
        {execution.recoveryState && (
          <FactRow
            label="Recovery"
            sub="Coordinator recovery lifecycle for the active plan"
            end={<Val text={execution.recoveryState} tone="warn" />}
          />
        )}
        <FactRow
          label={`Reconciliation · ${words(reconciliation.status)}`}
          sub={`${reconciliation.recommendation ?? 'No recommendation'} · Checkpoint ${textOrUnknown(reconciliation.checkpointId)} · Evaluated ${ageText(reconciliation.evaluatedAtMs, nowMs)}`}
          end={<>
            {reconciliation.reasonCodes.map((code) => <span key={code} className="sdx-reason">{code}</span>)}
            {reconciliationState === 'BLOCKED'
              ? <Chip tone="bad">BLOCKS NEW EXPOSURE</Chip>
              : reconciliationState === 'CLEAR'
                ? <Chip tone="ok">CLEAR</Chip>
                : <Chip tone="warn">RECONCILIATION UNKNOWN</Chip>}
            <TruthTag label={reconciliation.truthLabel} />
          </>}
        />
      </div>
    </section>
  );
}

export function RiskExecutionPanel({
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
      <RiskSection snapshot={snapshot} nowMs={nowMs} onTrace={onTrace} />
      <ExecutionSection snapshot={snapshot} nowMs={nowMs} onTrace={onTrace} />
    </div>
  );
}

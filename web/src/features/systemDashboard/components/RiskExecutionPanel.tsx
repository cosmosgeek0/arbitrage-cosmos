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

function verdictTone(verdict: 'APPROVE' | 'REJECT' | 'NEEDS_REVIEW' | 'CAP' | 'UNAVAILABLE'): Tone {
  if (verdict === 'APPROVE') return 'ok';
  if (verdict === 'REJECT') return 'bad';
  if (verdict === 'CAP' || verdict === 'NEEDS_REVIEW') return 'warn';
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
  const decisive = risk.decisiveInputSnapshot;
  const decisivePreview = decisive.slice(0, 3);
  const decisiveOverflow = decisive.length - decisivePreview.length;
  return (
    <section className="sdx-section" aria-label="Multi-leg risk">
      <Band title="Multi-Leg Risk" meta={<TruthTag label={risk.truthLabel} />} />
      <div className="sdx-rows">
        <FactRow
          label={`Latest Verdict · ${words(risk.latestVerdict)}`}
          sub={`${textOrUnknown(risk.latestVerdictId)} · ${ageText(risk.latestVerdictAtMs, nowMs)}`}
          end={<>
            <Chip tone={verdictTone(risk.latestVerdict)}>{risk.latestVerdict}</Chip>
            <TraceLink correlationId={risk.correlationId} onTrace={onTrace} />
          </>}
        />
        <FactRow
          label="Verdict-Scoped Maximum"
          sub="Gross USD authority for this exact evaluated plan; UNKNOWN is never treated as zero"
          end={<Val text={risk.maxAllowedSize === null ? 'UNKNOWN' : `${risk.maxAllowedSize} USD`} tone={risk.maxAllowedSize === null ? 'warn' : undefined} />}
        />
        <FactRow
          label="Required Confirmation"
          sub={risk.requiredConfirmation === true
            ? 'Operator review is required; confirmation does not override allowed=false'
            : 'No review confirmation is attached to the latest verdict'}
          end={<Val
            text={risk.requiredConfirmation === null ? 'UNKNOWN' : risk.requiredConfirmation ? 'REQUIRED' : 'NOT REQUIRED'}
            tone={risk.requiredConfirmation === null || risk.requiredConfirmation ? 'warn' : undefined}
          />}
        />
        <FactRow
          label="Decisive Inputs"
          sub={decisive.length
            ? `${decisive.slice(0, 2).map((item) => `${item.code}: ${item.detail}`).join(' · ')}${decisive.length > 2 ? ` · +${decisive.length - 2} more; inspect the full bounded snapshot below` : ''}`
            : 'No decisive owner evidence is available'}
          end={decisive.length
            ? <span className="sdx-row-end">
                {decisivePreview.map((item, index) => <span key={`${item.code}-${index}`} className="sdx-reason">{item.code} · {item.status}</span>)}
                {decisiveOverflow > 0 && <span className="sdx-evidence-more">+{decisiveOverflow} MORE</span>}
              </span>
            : <Val text="UNKNOWN" tone="warn" />}
        />
        {decisive.length > 0 && <details className="sdx-risk-evidence">
          <summary>Inspect full decisive snapshot · {decisive.length} input{decisive.length === 1 ? '' : 's'}</summary>
          <div className="sdx-risk-evidence-list">
            {decisive.map((item, index) => <article key={`${item.code}-${index}`} className="sdx-risk-evidence-item">
              <header>
                <code>{item.code}</code>
                <span className={`sdx-risk-evidence-status ${item.status.toLowerCase()}`}>{item.status}</span>
              </header>
              <p>{item.detail}</p>
              <dl>
                <div><dt>Observed</dt><dd>{item.observed ?? 'UNKNOWN'}</dd></div>
                <div><dt>Limit</dt><dd>{item.limit ?? 'UNKNOWN'}</dd></div>
                <div><dt>Evidence</dt><dd>{ageText(item.evidenceTimestamp, nowMs)}</dd></div>
              </dl>
            </article>)}
          </div>
        </details>}
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

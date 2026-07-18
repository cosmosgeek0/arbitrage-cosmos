import { Group, GRow, StatePill } from './ui';
import { timeAgo } from '../format';
import {
  useSystemIntegration,
  type SystemComponentSnapshot,
  type SystemOverallPosture,
  type SystemReadiness,
  type SystemTraceDecision,
  type SystemTruthLabel,
} from '../lib/systemIntegration';
import './SystemIntegrationSurface.css';

type Surface = 'dashboard' | 'health' | 'opportunities' | 'risk' | 'logs';
type Tone = 'ok' | 'bad' | 'warn' | 'idle';

function words(value: string): string {
  return value.replaceAll('-', ' ').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function postureTone(value: SystemOverallPosture | SystemReadiness): Tone {
  if (value === 'READY') return 'ok';
  if (value === 'FAILED' || value === 'BLOCKED') return 'bad';
  if (value === 'DEGRADED' || value === 'WARMING') return 'warn';
  return 'idle';
}

function truthTone(value: SystemTruthLabel): Tone {
  if (value === 'LIVE_PUBLIC') return 'ok';
  if (value === 'DRY_RUN' || value === 'RECORDED_REPLAY') return 'warn';
  if (value === 'SYNTHETIC_ONLY') return 'idle';
  return 'bad';
}

function count(value: number | null): string {
  return value === null ? 'Unavailable' : value.toLocaleString();
}

function age(value: number | null): string {
  return value === null ? 'Unavailable' : timeAgo(value);
}

function ComponentRow({ component }: { component: SystemComponentSnapshot }) {
  const dependency = component.dependencies.length
    ? `Depends on ${component.dependencies.map(words).join(', ')}`
    : 'No component dependency';
  const blocker = component.blockerCodes[0]
    ? ` · ${words(component.blockerCodes[0])}`
    : '';
  const freshness = component.freshness?.ageMs === null || component.freshness?.ageMs === undefined
    ? 'Source age unavailable'
    : `Source age ${Math.max(0, Math.round(component.freshness.ageMs / 1_000))}s`;
  const queue = component.queue
    ? ` · Queue ${component.queue.depth}/${component.queue.capacity} · ${component.queue.dropped} dropped`
    : '';
  return (
    <GRow
      label={words(component.componentId)}
      sub={`${component.desiredState} → ${component.phase} · ${freshness}${queue} · Gen ${component.generation}${blocker} · ${dependency}`}
      control={<span className="sis-state-stack"><StatePill tone={postureTone(component.readiness)}>{words(component.readiness)}</StatePill><small>{words(component.truthLabel)}</small></span>}
    />
  );
}

function TraceRow({ trace }: { trace: SystemTraceDecision }) {
  const identity = trace.ownerId ?? trace.canonicalProjectionId ?? trace.referenceIds[0] ?? 'No owner reference';
  const result = trace.failureCode ? words(trace.failureCode) : words(trace.kind);
  return (
    <GRow
      label={<span>{words(trace.componentId)} <code>{identity}</code></span>}
      sub={`${trace.correlationId} · ${age(trace.occurredAtMs)}${trace.revisionDigest ? ` · Rev ${trace.revisionDigest.slice(0, 12)}` : ''}`}
      control={<span className="sis-state-stack"><StatePill tone={trace.failureCode ? 'bad' : truthTone(trace.truthLabel)}>{result}</StatePill><small>{words(trace.truthLabel)}</small></span>}
    />
  );
}

export function SystemIntegrationSurface({ surface }: { surface: Surface }) {
  const { snapshot, loading, error } = useSystemIntegration();
  if (!snapshot) {
    return (
      <section className={`system-integration-surface sis-${surface}`} aria-label="System convergence">
        <Group title="System Convergence">
          <GRow
            label={loading ? 'Reading canonical supervisor' : 'Canonical supervisor unavailable'}
            sub={error ?? 'No supervisor snapshot has been published.'}
            control={<StatePill tone={error ? 'bad' : 'warn'}>{loading ? 'Reading' : 'Unavailable'}</StatePill>}
          />
        </Group>
      </section>
    );
  }

  const ready = snapshot.components.filter((component) => component.readiness === 'READY').length;
  const firstBlocker = snapshot.firstRootBlockerComponentId
    ? snapshot.components.find((component) => component.componentId === snapshot.firstRootBlockerComponentId) ?? null
    : null;
  const basis = snapshot.summaries.strategies.basis;
  const volume = snapshot.summaries.strategies.volume;
  const intelligence = snapshot.summaries.intelligence;
  const proposalCount = basis.proposalCount === null || volume.proposalCount === null
    ? null
    : basis.proposalCount + volume.proposalCount;
  const pollFailure = error ? (
    <GRow
      label="Supervisor Poll Degraded"
      sub={`${error} · Last accepted snapshot ${age(snapshot.evaluatedAtMs)}`}
      control={<StatePill tone="bad">Stale View</StatePill>}
    />
  ) : null;

  if (surface === 'health') {
    return (
      <section className="system-integration-surface sis-health" aria-label="Canonical dependency health">
        <Group title={`Canonical Dependency Graph · ${ready}/${snapshot.components.length} Ready`}>
          {pollFailure}
          <GRow
            label={firstBlocker ? `First Root Blocker · ${words(firstBlocker.componentId)}` : 'No Root Blocker'}
            sub={firstBlocker?.blockerCodes.map(words).join(' · ') || 'No material root cause is currently present in the canonical graph.'}
            control={<StatePill tone={firstBlocker ? postureTone(firstBlocker.readiness) : 'ok'}>{firstBlocker ? 'Attention' : 'Clear'}</StatePill>}
          />
          {snapshot.components.map((component) => <ComponentRow key={component.componentId} component={component} />)}
        </Group>
      </section>
    );
  }

  if (surface === 'opportunities') {
    const decisions = snapshot.recentCorrelatedDecisions.filter((trace) => (
      trace.componentId === 'basis-engine'
      || trace.componentId === 'volume-engine'
      || trace.componentId === 'capital-supervision'
      || trace.componentId === 'multileg-risk'
    )).slice(0, 6);
    return (
      <section className="system-integration-surface sis-opportunities" aria-label="Canonical opportunity authority">
        <Group title="Canonical Proposal And Capital Authority">
          {pollFailure}
          <GRow
            label={`${count(basis.proposalCount)} Basis · ${count(volume.proposalCount)} Volume`}
            sub={`Capital ${snapshot.summaries.capital.accountTruthState} · ${count(snapshot.summaries.capital.reservationCount)} reservations · ${count(snapshot.summaries.capital.stagedMandateCount)} staged mandates`}
            control={<StatePill tone={truthTone(snapshot.summaries.capital.truthLabel)}>{words(snapshot.summaries.capital.truthLabel)}</StatePill>}
          />
          <GRow
            label={`Capital Eligibility · ${count(snapshot.summaries.capital.eligibleCount)}`}
            sub={`Allocatable ${snapshot.summaries.capital.allocatableAmount ?? 'Unavailable'} · Reserved ${snapshot.summaries.capital.reservedAmount ?? 'Unavailable'} · ${snapshot.summaries.capital.blockerCodes.map(words).join(' · ') || 'No Capital-owner blocker reported.'}`}
            control={<StatePill tone={snapshot.summaries.capital.blockerCodes.length ? 'bad' : truthTone(snapshot.summaries.capital.truthLabel)}>{count(snapshot.summaries.capital.stagedMandateCount)} Staged</StatePill>}
          />
          {decisions.length ? decisions.map((trace) => <TraceRow key={trace.eventId} trace={trace} />) : (
            <GRow label="No correlated proposal trace" sub="The supervisor will not fabricate a proposal from public observation." control={<StatePill tone="idle">Empty</StatePill>} />
          )}
        </Group>
      </section>
    );
  }

  if (surface === 'risk') {
    const control = snapshot.control;
    const execution = snapshot.summaries.execution;
    const reconciliation = snapshot.summaries.reconciliation;
    return (
      <section className="system-integration-surface sis-risk" aria-label="Canonical convergence risk">
        <Group title="Convergence Authority">
          {pollFailure}
          <GRow label={`${words(control.safeMode)} · Revision ${control.revision}`} sub={`Convergence intake ${control.intakePaused ? 'paused' : 'open'} · Convergence kill ${control.killSwitchEngaged ? 'engaged' : 'clear'} · Control gen ${snapshot.controlGeneration}`} control={<StatePill tone={control.killSwitchEngaged ? 'warn' : 'ok'}>{control.killSwitchEngaged ? 'Fail Closed' : 'Guarded'}</StatePill>} />
          <GRow label={`Multi-Leg Risk · ${words(snapshot.summaries.risk.latestVerdict)}`} sub={snapshot.summaries.risk.reasonCodes.map(words).join(' · ') || 'No owner verdict is currently available.'} control={<StatePill tone={snapshot.summaries.risk.latestVerdict === 'APPROVE' ? 'ok' : snapshot.summaries.risk.latestVerdict === 'NEEDS_REVIEW' ? 'warn' : snapshot.summaries.risk.latestVerdict === 'UNAVAILABLE' ? 'idle' : 'bad'}>{words(snapshot.summaries.risk.truthLabel)}</StatePill>} />
          <GRow label={`Execution · ${execution.coordinatorState}`} sub={`${execution.barrier} · ${execution.planLifecycle ?? 'No plan'} · ${execution.legCount ?? 0} legs`} control={<StatePill tone={truthTone(execution.truthLabel)}>{words(execution.truthLabel)}</StatePill>} />
          <GRow label={`Reconciliation · ${reconciliation.status}`} sub={reconciliation.reasonCodes.map(words).join(' · ') || reconciliation.recommendation || 'No reconciled execution fixture is active.'} control={<StatePill tone={reconciliation.blocksNewExposure ? 'bad' : truthTone(reconciliation.truthLabel)}>{reconciliation.blocksNewExposure ? 'Blocks New Risk' : words(reconciliation.truthLabel)}</StatePill>} />
        </Group>
      </section>
    );
  }

  if (surface === 'logs') {
    return (
      <section className="system-integration-surface sis-logs" aria-label="Canonical correlated decisions">
        <Group title="Canonical Correlated Decisions">
          {pollFailure}
          {snapshot.recentCorrelatedDecisions.length ? snapshot.recentCorrelatedDecisions.slice(0, 8).map((trace) => <TraceRow key={trace.eventId} trace={trace} />) : (
            <GRow label="No material convergence transition" sub="High-rate public events remain outside the operational ledger." control={<StatePill tone="idle">Empty</StatePill>} />
          )}
        </Group>
      </section>
    );
  }

  return (
    <section className="system-integration-surface sis-dashboard" aria-label="System convergence summary">
      <Group title="System Convergence">
        {pollFailure}
        <GRow label={`${words(snapshot.overallPosture)} · ${ready}/${snapshot.components.length} ready`} sub={`${words(snapshot.truthLabel)} truth · Runtime gen ${snapshot.runtimeGeneration} · ${snapshot.operatorAttentionComponentIds.length} attention`} control={<StatePill tone={postureTone(snapshot.overallPosture)}>{words(snapshot.overallPosture)}</StatePill>} />
        <GRow label="Basis / Volume / Intelligence" sub={`Basis ${age(basis.heartbeatAtMs)} · Volume ${age(volume.heartbeatAtMs)} · Intelligence ${age(intelligence.lastUpdateAtMs)}`} control={<span className="sis-inline-count">{count(proposalCount)} proposals</span>} />
        <GRow label="Capital And Exposure" sub={`${count(snapshot.summaries.capital.reservationCount)} reservations · ${count(snapshot.summaries.capital.activeExposureCount)} active exposure · ${snapshot.summaries.capital.accountTruthState}`} control={<StatePill tone={truthTone(snapshot.summaries.capital.truthLabel)}>{words(snapshot.summaries.capital.truthLabel)}</StatePill>} />
        <GRow label={firstBlocker ? words(firstBlocker.componentId) : 'No root blocker'} sub={firstBlocker?.lastFailure?.message ?? firstBlocker?.blockerCodes.map(words).join(' · ') ?? 'Canonical graph has no material root blocker.'} control={<StatePill tone={firstBlocker ? postureTone(firstBlocker.readiness) : 'ok'}>{firstBlocker ? 'Attention' : 'Clear'}</StatePill>} />
      </Group>
    </section>
  );
}

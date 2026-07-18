import { timeAgo } from '../format';
import type { ProductComponentProjection } from '../lib/productIntegration';

type HealthTone = 'healthy' | 'degraded' | 'broken';

function words(value: string): string {
  return value.replaceAll('-', ' ').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function duration(value: number | null): string {
  if (value === null) return 'UNKNOWN';
  if (value < 1_000) return `${value} ms`;
  return `${Math.round(value / 100) / 10} s`;
}

function count(value: number | null): string {
  return value === null ? 'UNKNOWN' : String(value);
}

function utcTime(value: number | null, label: string): string | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 4_102_444_800_000) return `${label} UNKNOWN`;
  return `${label} ${new Date(value).toISOString().slice(11, 19)} UTC`;
}

function retryDetail(component: Readonly<ProductComponentProjection>): string {
  const parts = [];
  if (component.retryAttempt !== null || component.retryCeiling !== null) {
    parts.push(`Attempt ${count(component.retryAttempt)} / ${count(component.retryCeiling)}`);
  }
  if (component.backoffMs !== null) parts.push(`${duration(component.backoffMs)} backoff`);
  const retryAt = utcTime(component.retryAtMs, 'Retry');
  if (retryAt) parts.push(retryAt);
  const cooldown = utcTime(component.cooldownUntilMs, 'Cooldown Until');
  if (cooldown) parts.push(cooldown);
  return parts.join(' · ') || 'No retry timing published';
}

function qualityDetail(component: Readonly<ProductComponentProjection>): string {
  return [
    `Invalid ${count(component.dataQualityInvalidCount)}`,
    `Duplicate ${count(component.dataQualityDuplicateCount)}`,
    `Out Of Order ${count(component.dataQualityOutOfOrderCount)}`,
    `Gaps ${count(component.dataQualitySequenceGapCount)}`,
  ].join(' · ');
}

export function ComponentOperationalHealthTable({
  components,
}: Readonly<{ components: readonly Readonly<ProductComponentProjection>[] }>) {
  return (
    <section
      className="healthx-table"
      role="table"
      aria-label="Canonical Component Operational Health"
      aria-colcount={6}
      aria-rowcount={components.length + 1}
    >
      <div className="healthx-table-head" role="row">
        <span role="columnheader">Component</span>
        <span role="columnheader">Heartbeat / Freshness</span>
        <span role="columnheader">Lag / Backlog / Drops</span>
        <span role="columnheader">Quality / Retry</span>
        <span role="columnheader">Checkpoint / Restart</span>
        <span role="columnheader">Dependencies</span>
      </div>
      {components.map((component) => {
        const tone: HealthTone = component.canonicalPresentation.status === 'operational'
          ? 'healthy'
          : component.canonicalPresentation.status === 'outage'
            ? 'broken'
            : 'degraded';
        const dependencies = component.dependencyIds.length
          ? component.dependencyIds.map(words).join(' · ')
          : 'No component dependency';
        const quality = qualityDetail(component);
        const retry = retryDetail(component);
        return (
          <article className="healthx-source-row" role="row" key={component.componentId}>
            <span className="healthx-source" role="cell">
              <span className={`healthx-state ${tone}`}><i aria-hidden="true" />{component.canonicalPresentation.statusLabel}</span>
              <span>
                <strong>{words(component.componentId)}</strong>
                <small>{words(component.observedLifecycle)} · {words(component.capability)}</small>
              </span>
            </span>
            <span className="healthx-current" role="cell">
              <strong>{component.heartbeatAtMs === null ? 'UNKNOWN' : timeAgo(component.heartbeatAtMs)}</strong>
              <small>{component.freshnessState} · Source Age {duration(component.sourceAgeMs)}</small>
              <small>Advance {component.lastAdvanceAtMs === null ? 'UNKNOWN' : timeAgo(component.lastAdvanceAtMs)}</small>
            </span>
            <span className="healthx-current" role="cell">
              <strong>{duration(component.processingLagMs)} Lag</strong>
              <small>{count(component.queueDepth)} / {count(component.queueCapacity)} Backlog · {count(component.droppedCount)} Drops</small>
              <small>Processing Age {duration(component.processingAgeMs)}</small>
            </span>
            <span className="healthx-current" role="cell" title={`${quality} · ${retry}`}>
              <strong>{component.dataQualityState} · {component.retryState}</strong>
              <small>{quality}</small>
              <small>{retry}</small>
            </span>
            <span className="healthx-current" role="cell">
              <strong>{component.checkpointState} · {component.restartState}</strong>
              <small>{component.checkpointRevision ?? 'No checkpoint revision'} · Saved {component.checkpointPersistedAtMs === null ? 'UNKNOWN' : timeAgo(component.checkpointPersistedAtMs)}</small>
              <small>Generation {component.generation} · {component.restartCount} Restarts</small>
            </span>
            <span className="healthx-evidence" role="cell" title={dependencies}>{dependencies}</span>
          </article>
        );
      })}
    </section>
  );
}

// MachineGraph — DASHBOARD_TRUTH item 2: every managed component as a box.
// Desired vs observed · readiness vs liveness · freshness age · restarts ·
// current error · truth label. Expected components absent from the snapshot
// render an explicit MISSING box; silent/stale can never look green because
// tone routing lives in presentation.componentTone.

import type {
  SystemComponentId,
  SystemComponentSnapshot,
  SystemSupervisorSnapshot,
} from '../../../lib/systemIntegration';
import {
  EXPECTED_COMPONENTS,
  UNKNOWN_TEXT,
  componentStateText,
  componentTone,
  freshnessOf,
  freshnessText,
  words,
} from '../lib/presentation';
import { Band, Chip, TruthTag } from './bits';

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  const unknown = value === UNKNOWN_TEXT || value.includes(UNKNOWN_TEXT);
  return (
    <div>
      <span>{label}</span>
      <b className={unknown ? 'unk' : tone ?? ''} title={value}>{value}</b>
    </div>
  );
}

function ComponentNode({
  component,
  isRoot,
  blockedBy,
}: {
  component: SystemComponentSnapshot;
  isRoot: boolean;
  blockedBy: SystemComponentId | null;
}) {
  const fresh = freshnessOf(component);
  const tone = componentTone(component);
  const ageTone = fresh.kind === 'SILENT' ? 'bad' : fresh.kind === 'STALE' ? 'warn' : fresh.kind === 'UNKNOWN' ? 'idle' : '';
  const observed = component.domainObservedState ?? UNKNOWN_TEXT;
  const queue = component.queue
    ? `${component.queue.depth}/${component.queue.capacity} · ${component.queue.dropped} dropped`
    : null;

  return (
    <article className={`sdx-node${isRoot ? ' root' : ''}`} aria-label={words(component.componentId)}>
      <div className="sdx-node-head">
        <strong>{words(component.componentId)}</strong>
        <TruthTag label={component.truthLabel} />
      </div>
      <div className="sdx-node-state">
        <Chip tone={tone}>{componentStateText(component)}</Chip>
        <span className={`sdx-age ${ageTone}`}>{freshnessText(fresh)}</span>
      </div>
      <div className="sdx-node-facts">
        <Fact label="Desired → Observed" value={`${component.desiredState} → ${observed}`} />
        <Fact label="Phase" value={component.phase} />
        <Fact label="Restarts · Gen" value={`${component.restartCount} · gen ${component.generation}`} />
        {queue && <Fact label="Queue" value={queue} tone={component.queue && component.queue.dropped > 0 ? 'bad' : undefined} />}
        {blockedBy && <Fact label="Blocked Via" value={words(blockedBy)} tone="bad" />}
      </div>
      {(component.lastFailure || component.blockerCodes.length > 0) && (
        <p className="sdx-node-error">
          <code>{component.lastFailure?.code ?? component.blockerCodes[0]}</code>
          {component.lastFailure ? ` — ${component.lastFailure.message}` : ''}
        </p>
      )}
      {(isRoot || component.capitalExposed || component.operatorAttentionRequired) && (
        <div className="sdx-node-tags">
          {isRoot && <span className="sdx-tag root">ROOT CAUSE</span>}
          {component.capitalExposed && <span className="sdx-tag exposed">CAPITAL EXPOSED</span>}
          {component.operatorAttentionRequired && <span className="sdx-tag attention">NEEDS OPERATOR</span>}
        </div>
      )}
    </article>
  );
}

function MissingNode({ componentId }: { componentId: SystemComponentId }) {
  return (
    <article className="sdx-node missing" aria-label={`${words(componentId)} missing`}>
      <div className="sdx-node-head">
        <strong>{words(componentId)}</strong>
        <span className="sdx-truth unknown">MISSING</span>
      </div>
      <div className="sdx-node-state">
        <Chip tone="bad">NOT IN SNAPSHOT</Chip>
        <span className="sdx-age idle">{UNKNOWN_TEXT}</span>
      </div>
      <div className="sdx-node-facts">
        <Fact label="Desired → Observed" value={UNKNOWN_TEXT} />
        <Fact label="Restarts · Gen" value={UNKNOWN_TEXT} />
      </div>
      <p className="sdx-node-error">
        <code>COMPONENT_ABSENT</code> — a managed component the supervisor did not report. Treat as down until it reappears.
      </p>
    </article>
  );
}

export function MachineGraph({ snapshot }: { snapshot: SystemSupervisorSnapshot }) {
  const present = new Map(snapshot.components.map((c) => [c.componentId, c]));
  const roots = new Set(snapshot.rootBlockerComponentIds);
  const blockedVia = new Map<SystemComponentId, SystemComponentId>();
  for (const edge of snapshot.edges) {
    if (edge.state === 'BLOCKED' && edge.rootBlockerComponentId && edge.rootBlockerComponentId !== edge.to) {
      blockedVia.set(edge.to, edge.rootBlockerComponentId);
    }
  }
  const missing = EXPECTED_COMPONENTS.filter((id) => !present.has(id));

  return (
    <section className="sdx-section" aria-label="Machine graph">
      <Band
        title="Machine Graph"
        meta={<>
          <span>{snapshot.components.length} reported · {missing.length} missing</span>
          <code>graph rev {snapshot.revision}</code>
        </>}
      />
      <div className="sdx-graph">
        {EXPECTED_COMPONENTS.map((id) => {
          const component = present.get(id);
          if (!component) return <MissingNode key={id} componentId={id} />;
          return (
            <ComponentNode
              key={id}
              component={component}
              isRoot={roots.has(id)}
              blockedBy={blockedVia.get(id) ?? null}
            />
          );
        })}
      </div>
    </section>
  );
}

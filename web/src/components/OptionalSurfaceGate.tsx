import type { ReactNode } from 'react';
import {
  useOptionalSurface,
  type OptionalSurfaceId,
} from '../lib/optionalSurfaceControl';

const LABELS: Readonly<Record<OptionalSurfaceId, string>> = Object.freeze({
  markets: 'Markets',
  token: 'Token',
  logs: 'Logs',
  news: 'News',
  calendar: 'Calendar',
});

function surfaceState(id: OptionalSurfaceId, input: ReturnType<typeof useOptionalSurface>): {
  label: string;
  detail: string;
} {
  if (input.controlStatus === 'LOADING') {
    return { label: 'CONTROL LOADING', detail: `${LABELS[id]} stays off until backend admission is known.` };
  }
  if (input.controlStatus === 'UNAVAILABLE') {
    return { label: 'CONTROL UNAVAILABLE', detail: `${LABELS[id]} is fail-closed because backend admission could not be read.` };
  }
  if (input.snapshot.failureCode !== null) {
    return { label: 'BACKEND UNAVAILABLE', detail: `${LABELS[id]} remains closed · ${input.snapshot.failureCode}.` };
  }
  if (input.snapshot.phase === 'STARTING') {
    return { label: 'STARTING', detail: `${LABELS[id]} backend admission is not open yet.` };
  }
  if (input.snapshot.phase === 'DRAINING') {
    return { label: 'STOPPING', detail: `${LABELS[id]} is draining its optional work.` };
  }
  if (input.enabled) {
    return { label: 'ON', detail: `${LABELS[id]} optional backend work is admitted.` };
  }
  return { label: 'DEFAULT OFF', detail: `${LABELS[id]} feed, polling, subscriptions, and workers are stopped.` };
}

export function OptionalSurfaceSwitch({
  surfaceId,
  compact = false,
}: {
  surfaceId: OptionalSurfaceId;
  compact?: boolean;
}) {
  const input = useOptionalSurface(surfaceId);
  const checked = input.snapshot.desiredState === 'ON';
  const disabled = input.controlStatus !== 'CURRENT' || input.pending;
  const state = surfaceState(surfaceId, input);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${checked ? 'Disable' : 'Enable'} ${LABELS[surfaceId]}`}
      className={`optional-surface-switch ${checked ? 'on' : 'off'} ${compact ? 'compact' : ''}`}
      disabled={disabled}
      data-optional-surface={surfaceId}
      data-optional-phase={input.snapshot.phase}
      title={`${LABELS[surfaceId]} · ${state.label}`}
      onClick={() => void input.setEnabled(!checked)}
    >
      <span aria-hidden="true" />
      {!compact && <em>{input.pending ? 'WORKING' : checked ? 'ON' : 'OFF'}</em>}
    </button>
  );
}

export function OptionalSurfaceGate({
  surfaceId,
  children,
}: {
  surfaceId: OptionalSurfaceId;
  children: ReactNode;
}) {
  const input = useOptionalSurface(surfaceId);
  const state = surfaceState(surfaceId, input);
  if (input.enabled) {
    return (
      <div
        className="optional-surface-gate admitted"
        data-optional-surface={surfaceId}
        data-optional-generation={input.snapshot.generation}
      >
        <div className="optional-surface-control-strip">
          <span><b>{LABELS[surfaceId]}</b><small>{state.detail}</small></span>
          <OptionalSurfaceSwitch surfaceId={surfaceId} />
        </div>
        {children}
      </div>
    );
  }
  return (
    <div
      className="optional-surface-gate closed"
      data-optional-surface={surfaceId}
      data-optional-generation={input.snapshot.generation}
    >
      <section className="optional-surface-inert" aria-disabled="true" aria-live="polite">
        <span className="optional-surface-kicker">ON-DEMAND SURFACE</span>
        <h1>{LABELS[surfaceId]}</h1>
        <p>{state.detail}</p>
        <dl>
          <div><dt>Desired</dt><dd>{input.snapshot.desiredState}</dd></div>
          <div><dt>Phase</dt><dd>{input.snapshot.phase}</dd></div>
          <div><dt>Generation</dt><dd>{input.snapshot.generation}</dd></div>
          <div><dt>In Flight</dt><dd>{input.snapshot.inFlight}</dd></div>
        </dl>
        {input.controlError && <small className="optional-surface-error">{input.controlError}</small>}
      </section>
      <OptionalSurfaceSwitch surfaceId={surfaceId} />
    </div>
  );
}

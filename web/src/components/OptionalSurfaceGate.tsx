import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiErrorMessage, fetchJson, fetchJsonResponse } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { setIconManifestAdmission } from '../lib/iconManifest';
import {
  DEFAULT_OPTIONAL_SURFACES,
  OPTIONAL_SURFACE_SET,
  decodeOptionalSurfaceMutationResponse,
  decodeOptionalSurfaceResponse,
  mergeOptionalSurfaceSnapshot,
  mergeOptionalSurfaceSnapshots,
  optionalSurfaceEnabled,
  type OptionalSurfaceControlContextValue,
  type OptionalSurfaceControlState,
  type OptionalSurfaceId,
  type OptionalSurfaceMutationResponse,
  type OptionalSurfaceResponse,
  type OptionalSurfaceSnapshotMap,
} from '../lib/optionalSurfaceControl';

const INITIAL_STATE: OptionalSurfaceControlState = Object.freeze({
  status: 'LOADING',
  surfaces: DEFAULT_OPTIONAL_SURFACES,
  error: null,
});

const OptionalSurfaceControlContext = createContext<OptionalSurfaceControlContextValue | null>(null);

export function OptionalSurfaceControlProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OptionalSurfaceControlState>(INITIAL_STATE);
  const [pending, setPending] = useState<ReadonlySet<OptionalSurfaceId>>(() => new Set());
  const [refreshNonce, setRefreshNonce] = useState(0);
  const requestEpochRef = useRef(0);

  useEffect(() => {
    let activeRequestEpoch = requestEpochRef.current;
    const poll = createSettledPoll<Readonly<{
      requestEpoch: number;
      surfaces: OptionalSurfaceSnapshotMap;
    }>>({
      intervalMs: 5_000,
      timeoutMs: 8_000,
      request: async (signal) => {
        activeRequestEpoch = requestEpochRef.current;
        const payload = await fetchJson<OptionalSurfaceResponse>(
          '/api/optional-surfaces',
          { cache: 'no-store', signal },
          7_000,
        );
        const surfaces = decodeOptionalSurfaceResponse(payload);
        if (surfaces === null) throw new Error('OPTIONAL_SURFACE_CONTRACT_INVALID');
        return Object.freeze({ requestEpoch: activeRequestEpoch, surfaces });
      },
      onSuccess: ({ requestEpoch, surfaces }) => {
        if (requestEpoch !== requestEpochRef.current) return;
        setState((current) => requestEpoch !== requestEpochRef.current
          ? current
          : Object.freeze({
            status: 'CURRENT',
            surfaces: mergeOptionalSurfaceSnapshots(current.surfaces, surfaces),
            error: null,
          }));
      },
      onError: (error) => {
        if (activeRequestEpoch !== requestEpochRef.current) return;
        const requestEpoch = activeRequestEpoch;
        setState((current) => requestEpoch !== requestEpochRef.current
          ? current
          : Object.freeze({
            status: 'UNAVAILABLE',
            surfaces: current.surfaces,
            error: apiErrorMessage(error, 'Optional surface control unavailable'),
          }));
      },
    });
    poll.start();
    return poll.stop;
  }, [refreshNonce]);

  const refresh = useCallback(() => setRefreshNonce((value) => value + 1), []);

  const setEnabled = useCallback(async (id: OptionalSurfaceId, enabled: boolean): Promise<boolean> => {
    if (!OPTIONAL_SURFACE_SET.has(id) || state.status !== 'CURRENT' || pending.has(id)) return false;
    requestEpochRef.current += 1;
    setPending((current) => new Set(current).add(id));
    if (id === 'token' || id === 'markets') {
      setIconManifestAdmission(id, false, state.surfaces[id].generation);
    }
    try {
      const response = await fetchJsonResponse<OptionalSurfaceMutationResponse>(
        `/api/optional-surfaces/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        },
        12_000,
        [503],
      );
      const result = decodeOptionalSurfaceMutationResponse(response.body);
      if (result === null || result.snapshot.id !== id) {
        throw new Error('OPTIONAL_SURFACE_CONTRACT_INVALID');
      }
      setState((current) => Object.freeze({
        status: 'CURRENT',
        surfaces: Object.freeze({
          ...current.surfaces,
          [id]: mergeOptionalSurfaceSnapshot(current.surfaces[id], result.snapshot),
        }),
        error: null,
      }));
      return result.snapshot.phase !== 'FAILED';
    } catch (error) {
      setState((current) => Object.freeze({
        status: 'UNAVAILABLE',
        surfaces: current.surfaces,
        error: apiErrorMessage(error, 'Optional surface change failed'),
      }));
      return false;
    } finally {
      requestEpochRef.current += 1;
      setPending((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, [pending, state.status, state.surfaces]);

  const token = state.surfaces.token;
  const markets = state.surfaces.markets;
  const tokenEnabled = optionalSurfaceEnabled(state, 'token') && !pending.has('token');
  const marketsEnabled = optionalSurfaceEnabled(state, 'markets') && !pending.has('markets');
  useEffect(() => {
    setIconManifestAdmission('token', tokenEnabled, token.generation);
    return () => setIconManifestAdmission('token', false, token.generation);
  }, [token.generation, tokenEnabled]);
  useEffect(() => {
    setIconManifestAdmission('markets', marketsEnabled, markets.generation);
    return () => setIconManifestAdmission('markets', false, markets.generation);
  }, [markets.generation, marketsEnabled]);

  const value = useMemo<OptionalSurfaceControlContextValue>(() => ({
    ...state,
    pending,
    setEnabled,
    refresh,
  }), [pending, refresh, setEnabled, state]);

  return (
    <OptionalSurfaceControlContext.Provider value={value}>
      {children}
    </OptionalSurfaceControlContext.Provider>
  );
}

export function useOptionalSurfaceControl(): OptionalSurfaceControlContextValue {
  const value = useContext(OptionalSurfaceControlContext);
  if (value === null) throw new Error('useOptionalSurfaceControl requires OptionalSurfaceControlProvider');
  return value;
}

export function useOptionalSurface(id: OptionalSurfaceId) {
  const control = useOptionalSurfaceControl();
  const pending = control.pending.has(id);
  return Object.freeze({
    controlStatus: control.status,
    controlError: control.error,
    snapshot: control.surfaces[id],
    enabled: optionalSurfaceEnabled(control, id),
    pending,
    setEnabled: (enabled: boolean) => control.setEnabled(id, enabled),
  });
}

const LABELS: Readonly<Record<OptionalSurfaceId, string>> = Object.freeze({
  markets: 'Markets',
  token: 'Token',
  logs: 'Logs',
  news: 'News',
  calendar: 'Calendar',
});

const OFF_DETAILS: Readonly<Record<OptionalSurfaceId, string>> = Object.freeze({
  markets: 'Markets enrichment routes and owned demand are closed; the passive market cut remains available to Opportunities.',
  token: 'Token optional routes, book subscriptions, and owned source work are stopped.',
  logs: 'Logs page and API admission are closed; the durable ledger and canonical incident retention remain active.',
  news: 'News optional routes, streams, and source refresh work are stopped.',
  calendar: 'Calendar optional routes and in-flight refresh work are stopped.',
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
  return { label: 'DEFAULT OFF', detail: OFF_DETAILS[id] };
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

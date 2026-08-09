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

// Owner order 2026-08-10: the optional-surface TOGGLE UI is gone. No sidebar
// switch, no page-toolbar switch, and no closed-route wall — every route
// renders its own content directly. The backend admission mechanism below is
// deliberately retained: it still owns lifecycle truth (generations, leases,
// drain) and still feeds icon-manifest admission and the per-page owner guards.

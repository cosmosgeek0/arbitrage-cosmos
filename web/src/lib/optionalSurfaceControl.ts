export const OPTIONAL_SURFACE_IDS = ['markets', 'token', 'logs', 'news', 'calendar'] as const;
export type OptionalSurfaceId = typeof OPTIONAL_SURFACE_IDS[number];
export type OptionalSurfaceDesiredState = 'ON' | 'OFF';
export type OptionalSurfacePhase = 'ON' | 'OFF' | 'STARTING' | 'DRAINING' | 'FAILED';
export type OptionalSurfaceControlStatus = 'LOADING' | 'CURRENT' | 'UNAVAILABLE';
export type OptionalSurfaceOverlay = 'news' | 'calendar';
export type OptionalSurfaceMutationStatus = 'APPLIED' | 'NOOP';

export interface OptionalSurfaceSnapshot {
  readonly id: OptionalSurfaceId;
  readonly desiredState: OptionalSurfaceDesiredState;
  readonly phase: OptionalSurfacePhase;
  readonly generation: number;
  readonly admissionOpen: boolean;
  readonly inFlight: number;
  readonly failureCode: string | null;
}

export type OptionalSurfaceSnapshotMap = Readonly<Record<OptionalSurfaceId, OptionalSurfaceSnapshot>>;

export interface OptionalSurfaceControlState {
  readonly status: OptionalSurfaceControlStatus;
  readonly surfaces: OptionalSurfaceSnapshotMap;
  readonly error: string | null;
}

export type OptionalSurfaceResponse = Readonly<{ surfaces: unknown }>;
export type OptionalSurfaceMutationResponse = Readonly<{ status: unknown; snapshot: unknown }>;

export interface OptionalSurfaceControlContextValue extends OptionalSurfaceControlState {
  readonly pending: ReadonlySet<OptionalSurfaceId>;
  readonly setEnabled: (id: OptionalSurfaceId, enabled: boolean) => Promise<boolean>;
  readonly refresh: () => void;
}

export const OPTIONAL_SURFACE_SET = new Set<string>(OPTIONAL_SURFACE_IDS);
const DESIRED_STATES = new Set<OptionalSurfaceDesiredState>(['ON', 'OFF']);
const PHASES = new Set<OptionalSurfacePhase>(['ON', 'OFF', 'STARTING', 'DRAINING', 'FAILED']);
const TERMINAL_PHASES = new Set<OptionalSurfacePhase>(['ON', 'OFF', 'FAILED']);

function defaultSurface(id: OptionalSurfaceId): OptionalSurfaceSnapshot {
  return Object.freeze({
    id,
    desiredState: 'OFF',
    phase: 'OFF',
    generation: 0,
    admissionOpen: false,
    inFlight: 0,
    failureCode: null,
  });
}

export const DEFAULT_OPTIONAL_SURFACES: OptionalSurfaceSnapshotMap = Object.freeze(
  Object.fromEntries(OPTIONAL_SURFACE_IDS.map((id) => [id, defaultSurface(id)])) as Record<
    OptionalSurfaceId,
    OptionalSurfaceSnapshot
  >,
);

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function decodeSurface(value: unknown): OptionalSurfaceSnapshot | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (!exactKeys(item, [
    'id',
    'desiredState',
    'phase',
    'generation',
    'admissionOpen',
    'inFlight',
    'failureCode',
  ])) return null;
  if (typeof item.id !== 'string' || !OPTIONAL_SURFACE_SET.has(item.id)) return null;
  if (typeof item.desiredState !== 'string' || !DESIRED_STATES.has(item.desiredState as OptionalSurfaceDesiredState)) return null;
  if (typeof item.phase !== 'string' || !PHASES.has(item.phase as OptionalSurfacePhase)) return null;
  if (!Number.isSafeInteger(item.generation) || Number(item.generation) < 0) return null;
  if (typeof item.admissionOpen !== 'boolean') return null;
  if (!Number.isSafeInteger(item.inFlight) || Number(item.inFlight) < 0) return null;
  if (item.failureCode !== null && (typeof item.failureCode !== 'string' || !item.failureCode.trim())) return null;

  const snapshot = Object.freeze({
    id: item.id as OptionalSurfaceId,
    desiredState: item.desiredState as OptionalSurfaceDesiredState,
    phase: item.phase as OptionalSurfacePhase,
    generation: Number(item.generation),
    admissionOpen: item.admissionOpen,
    inFlight: Number(item.inFlight),
    failureCode: item.failureCode as string | null,
  });
  if (snapshot.admissionOpen && (
    snapshot.desiredState !== 'ON'
    || snapshot.phase !== 'ON'
    || snapshot.failureCode !== null
  )) return null;
  return snapshot;
}

export function decodeOptionalSurfaceResponse(value: unknown): OptionalSurfaceSnapshotMap | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (!exactKeys(response, ['surfaces']) || !Array.isArray(response.surfaces)) return null;
  if (response.surfaces.length !== OPTIONAL_SURFACE_IDS.length) return null;
  const decoded = response.surfaces.map(decodeSurface);
  if (decoded.some((surface) => surface === null)) return null;
  const byId = new Map(decoded.map((surface) => [surface!.id, surface!]));
  if (byId.size !== OPTIONAL_SURFACE_IDS.length) return null;
  return Object.freeze(
    Object.fromEntries(OPTIONAL_SURFACE_IDS.map((id) => [id, byId.get(id)!])) as Record<
      OptionalSurfaceId,
      OptionalSurfaceSnapshot
    >,
  );
}

export function decodeOptionalSurfaceMutationResponse(
  value: unknown,
): Readonly<{ status: OptionalSurfaceMutationStatus; snapshot: OptionalSurfaceSnapshot }> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (!exactKeys(response, ['status', 'snapshot'])) return null;
  if (response.status !== 'APPLIED' && response.status !== 'NOOP') return null;
  const snapshot = decodeSurface(response.snapshot);
  if (snapshot === null) return null;
  return Object.freeze({
    status: response.status,
    snapshot,
  });
}

function sameSnapshotState(
  current: OptionalSurfaceSnapshot,
  incoming: OptionalSurfaceSnapshot,
): boolean {
  return current.desiredState === incoming.desiredState
    && current.phase === incoming.phase
    && current.admissionOpen === incoming.admissionOpen
    && current.failureCode === incoming.failureCode;
}

function completesTransition(
  current: OptionalSurfaceSnapshot,
  incoming: OptionalSurfaceSnapshot,
): boolean {
  if (current.phase === 'STARTING') {
    return (incoming.phase === 'ON' && incoming.desiredState === 'ON')
      || (incoming.phase === 'FAILED' && incoming.desiredState === 'OFF');
  }
  if (current.phase === 'DRAINING') {
    return incoming.desiredState === 'OFF'
      && (incoming.phase === 'OFF' || incoming.phase === 'FAILED');
  }
  return false;
}

/**
 * Preserve the newest lifecycle truth even when GET and PUT requests settle
 * out of order. A generation owns one transition, so its terminal result can
 * complete but can never regress to an earlier or contradictory phase.
 */
export function mergeOptionalSurfaceSnapshot(
  current: OptionalSurfaceSnapshot,
  incoming: OptionalSurfaceSnapshot,
): OptionalSurfaceSnapshot {
  if (incoming.id !== current.id || incoming.generation < current.generation) return current;
  if (incoming.generation > current.generation) return incoming;
  if (sameSnapshotState(current, incoming)) return incoming;
  if (TERMINAL_PHASES.has(current.phase)) return current;
  return completesTransition(current, incoming) ? incoming : current;
}

export function mergeOptionalSurfaceSnapshots(
  current: OptionalSurfaceSnapshotMap,
  incoming: OptionalSurfaceSnapshotMap,
): OptionalSurfaceSnapshotMap {
  let changed = false;
  const merged = {} as Record<OptionalSurfaceId, OptionalSurfaceSnapshot>;
  for (const id of OPTIONAL_SURFACE_IDS) {
    const snapshot = mergeOptionalSurfaceSnapshot(current[id], incoming[id]);
    merged[id] = snapshot;
    if (snapshot !== current[id]) changed = true;
  }
  return changed ? Object.freeze(merged) : current;
}

export function optionalSurfaceEnabled(
  state: Pick<OptionalSurfaceControlState, 'status' | 'surfaces'>
    & Readonly<{ pending?: ReadonlySet<OptionalSurfaceId> }>,
  id: OptionalSurfaceId,
): boolean {
  const surface = state.surfaces[id];
  return !state.pending?.has(id)
    && state.status === 'CURRENT'
    && surface.desiredState === 'ON'
    && surface.phase === 'ON'
    && surface.admissionOpen
    && surface.failureCode === null;
}

export function optionalSurfaceForPage(page: string): OptionalSurfaceId | null {
  if (page === 'markets') return 'markets';
  if (page === 'detail') return 'token';
  if (page === 'ledger') return 'logs';
  if (page === 'news') return 'news';
  if (page === 'calendar') return 'calendar';
  return null;
}

export function optionalSurfaceAllowsOverlay(
  state: Pick<OptionalSurfaceControlState, 'status' | 'surfaces'>,
  overlay: OptionalSurfaceOverlay,
): boolean {
  return optionalSurfaceEnabled(state, overlay);
}

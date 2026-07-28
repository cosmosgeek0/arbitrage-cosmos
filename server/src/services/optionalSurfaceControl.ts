export const OPTIONAL_SURFACE_IDS = Object.freeze([
  'news',
  'calendar',
  'logs',
  'token',
  'markets',
] as const);

export type OptionalSurfaceId = typeof OPTIONAL_SURFACE_IDS[number];
export type OptionalSurfaceDesiredState = 'ON' | 'OFF';
export type OptionalSurfacePhase = 'OFF' | 'STARTING' | 'ON' | 'DRAINING' | 'FAILED';

export interface OptionalSurfaceSnapshot {
  readonly id: OptionalSurfaceId;
  readonly desiredState: OptionalSurfaceDesiredState;
  readonly phase: OptionalSurfacePhase;
  readonly generation: number;
  readonly admissionOpen: boolean;
  readonly inFlight: number;
  readonly failureCode: string | null;
}

export interface OptionalSurfaceRuntimeContext {
  readonly id: OptionalSurfaceId;
  readonly generation: number;
  readonly signal: AbortSignal;
}

export interface OptionalSurfaceRuntime {
  start?(context: Readonly<OptionalSurfaceRuntimeContext>): void | Promise<void>;
  stop?(context: Readonly<OptionalSurfaceRuntimeContext>): void | Promise<void>;
}

export interface OptionalSurfaceLease {
  readonly id: OptionalSurfaceId;
  readonly generation: number;
  readonly signal: AbortSignal;
  release(): void;
}

export type OptionalSurfaceMutationStatus = 'APPLIED' | 'NOOP';

export interface OptionalSurfaceMutationResult {
  readonly status: OptionalSurfaceMutationStatus;
  readonly snapshot: OptionalSurfaceSnapshot;
}

interface SurfaceState {
  readonly id: OptionalSurfaceId;
  desiredState: OptionalSurfaceDesiredState;
  phase: OptionalSurfacePhase;
  generation: number;
  admissionOpen: boolean;
  failureCode: string | null;
  controller: AbortController;
  readonly leases: Set<symbol>;
  readonly idleWaiters: Set<() => void>;
  transition: Promise<OptionalSurfaceMutationResult>;
}

function failureCode(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim().slice(0, 120);
  return 'OPTIONAL_SURFACE_TRANSITION_FAILED';
}

function immutableSnapshot(state: Readonly<SurfaceState>): OptionalSurfaceSnapshot {
  return Object.freeze({
    id: state.id,
    desiredState: state.desiredState,
    phase: state.phase,
    generation: state.generation,
    admissionOpen: state.admissionOpen,
    inFlight: state.leases.size,
    failureCode: state.failureCode,
  });
}

export function isOptionalSurfaceId(value: string): value is OptionalSurfaceId {
  return (OPTIONAL_SURFACE_IDS as readonly string[]).includes(value);
}

export class OptionalSurfaceOffError extends Error {
  readonly code = 'OPTIONAL_SURFACE_OFF';

  constructor(readonly surface: OptionalSurfaceId) {
    super(`${surface} optional surface is off`);
    this.name = 'OptionalSurfaceOffError';
  }
}

export class OptionalSurfaceControl {
  readonly #states = new Map<OptionalSurfaceId, SurfaceState>();
  readonly #runtimes: Partial<Record<OptionalSurfaceId, OptionalSurfaceRuntime>>;

  constructor(
    runtimes: Readonly<Partial<Record<OptionalSurfaceId, OptionalSurfaceRuntime>>> = {},
  ) {
    this.#runtimes = { ...runtimes };
    for (const id of OPTIONAL_SURFACE_IDS) {
      const state: SurfaceState = {
        id,
        desiredState: 'OFF',
        phase: 'OFF',
        generation: 0,
        admissionOpen: false,
        failureCode: null,
        controller: new AbortController(),
        leases: new Set(),
        idleWaiters: new Set(),
        transition: Promise.resolve(null as never),
      };
      state.controller.abort(new OptionalSurfaceOffError(id));
      state.transition = Promise.resolve({
        status: 'NOOP',
        snapshot: immutableSnapshot(state),
      });
      this.#states.set(id, state);
    }
  }

  snapshots(): readonly OptionalSurfaceSnapshot[] {
    return Object.freeze(OPTIONAL_SURFACE_IDS.map((id) => this.snapshot(id)));
  }

  registerRuntime(id: OptionalSurfaceId, runtime: OptionalSurfaceRuntime): void {
    const state = this.#state(id);
    if (state.desiredState !== 'OFF' || state.phase !== 'OFF' || state.leases.size !== 0) {
      throw new Error(`Cannot replace ${id} runtime while it is active`);
    }
    this.#runtimes[id] = runtime;
  }

  snapshot(id: OptionalSurfaceId): OptionalSurfaceSnapshot {
    return immutableSnapshot(this.#state(id));
  }

  enabled(id: OptionalSurfaceId): boolean {
    const state = this.#state(id);
    return state.desiredState === 'ON'
      && state.phase === 'ON'
      && state.admissionOpen
      && !state.controller.signal.aborted;
  }

  signal(id: OptionalSurfaceId): AbortSignal {
    return this.#state(id).controller.signal;
  }

  acquire(id: OptionalSurfaceId): OptionalSurfaceLease {
    const state = this.#state(id);
    if (!this.enabled(id)) throw new OptionalSurfaceOffError(id);
    const token = Symbol(id);
    const generation = state.generation;
    const signal = state.controller.signal;
    state.leases.add(token);
    let released = false;
    return Object.freeze({
      id,
      generation,
      signal,
      release: () => {
        if (released) return;
        released = true;
        state.leases.delete(token);
        if (state.leases.size === 0) {
          const waiters = [...state.idleWaiters];
          state.idleWaiters.clear();
          for (const resolve of waiters) resolve();
        }
      },
    });
  }

  async withAdmission<T>(
    id: OptionalSurfaceId,
    work: (lease: Readonly<OptionalSurfaceLease>) => Promise<T>,
  ): Promise<T> {
    const lease = this.acquire(id);
    try {
      return await work(lease);
    } finally {
      lease.release();
    }
  }

  setEnabled(id: OptionalSurfaceId, enabled: boolean): Promise<OptionalSurfaceMutationResult> {
    const state = this.#state(id);
    const transition = state.transition
      .catch(() => ({
        status: 'NOOP' as const,
        snapshot: immutableSnapshot(state),
      }))
      .then(() => this.#transition(state, enabled));
    state.transition = transition;
    return transition;
  }

  async stopAll(): Promise<void> {
    for (const id of OPTIONAL_SURFACE_IDS) {
      await this.setEnabled(id, false);
    }
  }

  async #transition(state: SurfaceState, enabled: boolean): Promise<OptionalSurfaceMutationResult> {
    if (enabled && this.enabled(state.id)) {
      return { status: 'NOOP', snapshot: immutableSnapshot(state) };
    }
    if (!enabled && state.desiredState === 'OFF' && state.phase === 'OFF' && state.leases.size === 0) {
      return { status: 'NOOP', snapshot: immutableSnapshot(state) };
    }

    state.generation += 1;
    const generation = state.generation;
    state.failureCode = null;

    if (enabled) {
      state.desiredState = 'ON';
      state.phase = 'STARTING';
      state.admissionOpen = false;
      state.controller = new AbortController();
      const context = Object.freeze({
        id: state.id,
        generation,
        signal: state.controller.signal,
      });
      try {
        await this.#runtimes[state.id]?.start?.(context);
        if (state.generation !== generation || state.desiredState !== 'ON') {
          throw new Error('OPTIONAL_SURFACE_START_SUPERSEDED');
        }
        state.phase = 'ON';
        state.admissionOpen = true;
        return { status: 'APPLIED', snapshot: immutableSnapshot(state) };
      } catch (cause) {
        state.admissionOpen = false;
        state.desiredState = 'OFF';
        state.phase = 'FAILED';
        state.failureCode = failureCode(cause);
        if (!state.controller.signal.aborted) state.controller.abort(cause);
        try {
          await this.#runtimes[state.id]?.stop?.(context);
        } catch {
          // The original start failure remains the authoritative failure.
        }
        return { status: 'APPLIED', snapshot: immutableSnapshot(state) };
      }
    }

    state.desiredState = 'OFF';
    state.admissionOpen = false;
    state.phase = 'DRAINING';
    const drainingController = state.controller;
    const context = Object.freeze({
      id: state.id,
      generation,
      signal: drainingController.signal,
    });
    if (!drainingController.signal.aborted) {
      drainingController.abort(new OptionalSurfaceOffError(state.id));
    }
    try {
      await this.#runtimes[state.id]?.stop?.(context);
      await this.#waitForIdle(state);
      state.phase = 'OFF';
      state.failureCode = null;
    } catch (cause) {
      state.phase = 'FAILED';
      state.failureCode = failureCode(cause);
    }
    return { status: 'APPLIED', snapshot: immutableSnapshot(state) };
  }

  #waitForIdle(state: SurfaceState): Promise<void> {
    if (state.leases.size === 0) return Promise.resolve();
    return new Promise((resolve) => state.idleWaiters.add(resolve));
  }

  #state(id: OptionalSurfaceId): SurfaceState {
    const state = this.#states.get(id);
    if (!state) throw new TypeError(`Unknown optional surface: ${id}`);
    return state;
  }
}

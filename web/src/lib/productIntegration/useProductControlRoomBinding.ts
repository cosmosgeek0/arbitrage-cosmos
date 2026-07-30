import { useCallback, useEffect, useRef, useState } from 'react';
import { ProductBindingError, type ProductIntegrationClient } from './client';
import {
  validateMaterialEventPage,
  type MaterialEventPage,
  type ProductSupervisorEnvelope,
} from './model';

export const PRODUCT_MATERIAL_CURSOR_STORAGE_KEY = 'cosmos.product-integration.material-cursor.v1';
export const PRODUCT_MATERIAL_PAGE_LIMIT = 200;
export const PRODUCT_MATERIAL_MAX_PAGES_PER_REFRESH = 8;
export const PRODUCT_MATERIAL_CATCHUP_DEADLINE_MS = 10_000;

export type ProductBindingContinuity = 'UNPROVEN' | 'BACKFILL' | 'PROVEN' | 'BLOCKED';
export type DurableMaterialCursorRead =
  | Readonly<{ state: 'VALID'; cursor: string }>
  | Readonly<{ state: 'ABSENT' | 'INVALID' | 'UNAVAILABLE'; cursor: null }>;

const UNAVAILABLE_DURABLE_CURSOR: DurableMaterialCursorRead = Object.freeze({
  state: 'UNAVAILABLE',
  cursor: null,
});

interface CursorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ProductControlRoomBindingState<TDashboard> {
  readonly snapshot: ProductSupervisorEnvelope<TDashboard> | null;
  readonly materialEvents: Readonly<MaterialEventPage> | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly materialCursor: string | null;
  readonly continuity: ProductBindingContinuity;
  readonly refresh: () => Promise<void>;
}

export interface MaterialContinuityProof {
  readonly page: Readonly<MaterialEventPage>;
  readonly cursor: string;
  readonly continuity: 'BACKFILL' | 'PROVEN';
  readonly pagesRead: number;
}

export interface MaterialContinuityDisposition {
  readonly continuity: 'UNPROVEN' | 'BACKFILL' | 'PROVEN';
  readonly error: string | null;
}

/**
 * Publish authenticated supervisor truth without awaiting the independent
 * material-continuity lane. Returning false from publishSnapshot fences stale
 * lifecycle generations and prevents obsolete catch-up work from starting.
 */
export async function executeProductSupervisorRefresh<TDashboard>(input: Readonly<{
  client: Readonly<ProductIntegrationClient>;
  signal?: AbortSignal;
  publishSnapshot: (snapshot: ProductSupervisorEnvelope<TDashboard>) => boolean;
  startContinuity: (snapshot: ProductSupervisorEnvelope<TDashboard>) => void;
}>): Promise<ProductSupervisorEnvelope<TDashboard>> {
  const snapshot = await input.client.readSupervisor<TDashboard>(input.signal);
  if (input.signal?.aborted) {
    throw new ProductBindingError('Product supervisor read was aborted.', ['SUPERVISOR_READ_ABORTED']);
  }
  if (input.publishSnapshot(snapshot)) input.startContinuity(snapshot);
  return snapshot;
}

export function reconcileMaterialContinuity(
  proof: Readonly<MaterialContinuityProof>,
  latestSupervisorPage: Readonly<MaterialEventPage>,
): MaterialContinuityDisposition {
  if (!isDecimalCursor(proof.cursor) || !isDecimalCursor(latestSupervisorPage.highWaterCursor)) {
    throw new ProductBindingError('Material-event continuity reconciliation is malformed.', ['MATERIAL_RECONCILIATION_INVALID']);
  }
  if (proof.continuity === 'PROVEN') {
    if (proof.cursor !== proof.page.highWaterCursor || proof.page.hasMore) {
      throw new ProductBindingError(
        'Material-event proof contradicts its terminal page.',
        ['MATERIAL_PROOF_TERMINAL_CONTRADICTION'],
      );
    }
    const proofHighWater = BigInt(proof.cursor);
    const supervisorHighWater = BigInt(latestSupervisorPage.highWaterCursor);
    if (proofHighWater === supervisorHighWater) {
      return Object.freeze({ continuity: 'PROVEN', error: null });
    }
    if (proofHighWater > supervisorHighWater) {
      return Object.freeze({
        continuity: 'UNPROVEN',
        error: 'Supervisor snapshot is behind the proven material-event high-water; awaiting a fresh supervisor read.',
      });
    }
  }
  return Object.freeze({
    continuity: 'BACKFILL',
    error: `Material-event catch-up is still in progress after ${proof.pagesRead} bounded pages.`,
  });
}

export function isMaterialContinuityStillCurrent(
  continuity: ProductBindingContinuity,
  cursor: string | null,
  supervisorPage: Readonly<MaterialEventPage>,
): boolean {
  return continuity === 'PROVEN'
    && cursor !== null
    && isDecimalCursor(cursor)
    && isDecimalCursor(supervisorPage.highWaterCursor)
    && cursor === supervisorPage.highWaterCursor;
}

export function readDurableMaterialCursor(storage?: CursorStorage | null): DurableMaterialCursorRead {
  const target = resolveCursorStorage(storage);
  if (!target) return UNAVAILABLE_DURABLE_CURSOR;
  try {
    const cursor = target.getItem(PRODUCT_MATERIAL_CURSOR_STORAGE_KEY);
    if (cursor === null) return Object.freeze({ state: 'ABSENT', cursor: null });
    if (!isDecimalCursor(cursor)) return Object.freeze({ state: 'INVALID', cursor: null });
    return Object.freeze({ state: 'VALID', cursor });
  } catch {
    return UNAVAILABLE_DURABLE_CURSOR;
  }
}

export function persistDurableMaterialCursor(cursor: string, storage?: CursorStorage | null): boolean {
  if (!isDecimalCursor(cursor)) return false;
  const target = resolveCursorStorage(storage);
  if (!target) return false;
  try {
    const current = target.getItem(PRODUCT_MATERIAL_CURSOR_STORAGE_KEY);
    if (current !== null && !isDecimalCursor(current)) return false;
    if (current !== null && BigInt(current) > BigInt(cursor)) return false;
    target.setItem(PRODUCT_MATERIAL_CURSOR_STORAGE_KEY, cursor);
    return target.getItem(PRODUCT_MATERIAL_CURSOR_STORAGE_KEY) === cursor;
  } catch {
    return false;
  }
}

/**
 * Establish a durable tail baseline once, then prove only gap-free CURSOR pages.
 * A bounded catch-up returns BACKFILL and keeps controls blocked until a later
 * refresh reaches the owner's high-water cursor.
 */
export async function proveMaterialContinuity(input: Readonly<{
  client: Readonly<ProductIntegrationClient>;
  supervisorPage: Readonly<MaterialEventPage>;
  durableCursor: Readonly<DurableMaterialCursorRead>;
  persistCursor?: (cursor: string) => boolean;
  maxPages?: number;
  signal?: AbortSignal;
}>): Promise<MaterialContinuityProof> {
  const persistCursor = input.persistCursor ?? ((cursor: string) => persistDurableMaterialCursor(cursor));
  const maxPages = input.maxPages ?? PRODUCT_MATERIAL_MAX_PAGES_PER_REFRESH;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > PRODUCT_MATERIAL_MAX_PAGES_PER_REFRESH) {
    throw new ProductBindingError('Material-event catch-up bound is invalid.', ['MATERIAL_CATCHUP_BOUND_INVALID']);
  }
  if (input.durableCursor.state === 'INVALID'
    || (input.durableCursor.state === 'VALID' && !isDecimalCursor(input.durableCursor.cursor))) {
    throw new ProductBindingError('Durable material cursor evidence is malformed.', ['MATERIAL_CURSOR_STORAGE_INVALID']);
  }
  if (input.durableCursor.state === 'UNAVAILABLE') {
    throw new ProductBindingError('Durable material cursor storage is unavailable.', ['MATERIAL_CURSOR_STORAGE_UNAVAILABLE']);
  }
  if (!isDecimalCursor(input.supervisorPage.highWaterCursor)) {
    throw new ProductBindingError('Supervisor material high-water evidence is malformed.', ['MATERIAL_HIGH_WATER_INVALID']);
  }
  const pinnedHighWater = BigInt(input.supervisorPage.highWaterCursor);

  let cursor = input.durableCursor.state === 'VALID' ? input.durableCursor.cursor : null;
  let lastPage: Readonly<MaterialEventPage> = input.supervisorPage;
  if (cursor === null) {
    const bootstrapErrors = validateMaterialEventPage(
      input.supervisorPage.requestedAfterCursor,
      input.supervisorPage,
      'TAIL_BOOTSTRAP',
    );
    if (bootstrapErrors.length) {
      throw new ProductBindingError('Material-event tail baseline is not proven.', bootstrapErrors);
    }
    throwIfAborted(input.signal);
    cursor = input.supervisorPage.nextCursor;
    if (!persistCursor(cursor)) {
      throw new ProductBindingError('Material-event cursor could not be durably persisted.', ['MATERIAL_CURSOR_PERSISTENCE_FAILED']);
    }
  }

  throwIfAborted(input.signal);
  if (BigInt(cursor) === pinnedHighWater
    && cursor === input.supervisorPage.highWaterCursor
    && !input.supervisorPage.hasMore) {
    return Object.freeze({ page: lastPage, cursor, continuity: 'PROVEN', pagesRead: 0 });
  }

  for (let index = 0; index < maxPages; index += 1) {
    throwIfAborted(input.signal);
    const page = await input.client.readMaterialEvents(cursor, PRODUCT_MATERIAL_PAGE_LIMIT, input.signal);
    const errors = validateMaterialEventPage(cursor, page, 'CURSOR');
    if (errors.length) throw new ProductBindingError('Material-event continuity is not proven.', errors);
    throwIfAborted(input.signal);
    if (!persistCursor(page.nextCursor)) {
      throw new ProductBindingError('Material-event cursor could not be durably persisted.', ['MATERIAL_CURSOR_PERSISTENCE_FAILED']);
    }
    cursor = page.nextCursor;
    lastPage = page;
    if (BigInt(cursor) >= pinnedHighWater
      && cursor === page.highWaterCursor
      && !page.hasMore) {
      return Object.freeze({ page: lastPage, cursor, continuity: 'PROVEN', pagesRead: index + 1 });
    }
    if (!page.hasMore) {
      return Object.freeze({ page: lastPage, cursor, continuity: 'BACKFILL', pagesRead: index + 1 });
    }
  }

  return Object.freeze({
    page: lastPage,
    cursor,
    continuity: 'BACKFILL',
    pagesRead: maxPages,
  });
}

/** Shared-provider binding; immutable envelopes remain digest-coherent. */
export function useProductControlRoomBinding<TDashboard = unknown>(
  client: Readonly<ProductIntegrationClient>,
  cadenceMs = 5_000,
  initialMaterialCursor: Readonly<DurableMaterialCursorRead> = UNAVAILABLE_DURABLE_CURSOR,
): ProductControlRoomBindingState<TDashboard> {
  const [snapshot, setSnapshot] = useState<ProductSupervisorEnvelope<TDashboard> | null>(null);
  const [materialEvents, setMaterialEvents] = useState<Readonly<MaterialEventPage> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [continuity, setContinuity] = useState<ProductBindingContinuity>('UNPROVEN');
  const snapshotRef = useRef<ProductSupervisorEnvelope<TDashboard> | null>(null);
  const latestSupervisorRef = useRef<ProductSupervisorEnvelope<TDashboard> | null>(null);
  const highestSupervisorHighWaterRef = useRef<bigint | null>(null);
  const provenMaterialHighWaterRef = useRef<string | null>(null);
  const continuityRef = useRef<ProductBindingContinuity>('UNPROVEN');
  const durableCursorRef = useRef<DurableMaterialCursorRead>(initialMaterialCursor);
  const cursorRef = useRef<string | null>(initialMaterialCursor.state === 'VALID' ? initialMaterialCursor.cursor : null);
  const mountedRef = useRef(false);
  const lifecycleRef = useRef(0);
  const continuityAuthorityRef = useRef(0);
  const supervisorInFlightRef = useRef<Promise<void> | null>(null);
  const supervisorAbortRef = useRef<AbortController | null>(null);
  const continuityInFlightRef = useRef<Promise<void> | null>(null);
  const continuityAbortRef = useRef<AbortController | null>(null);

  const publishContinuity = useCallback((next: ProductBindingContinuity): void => {
    continuityRef.current = next;
    setContinuity(next);
  }, []);

  const startContinuity = useCallback((
    supervisorSnapshot: ProductSupervisorEnvelope<TDashboard>,
    generation: number,
  ): Promise<void> => {
    if (continuityInFlightRef.current) return continuityInFlightRef.current;
    if (!isCurrentLifecycle(generation, lifecycleRef.current, mountedRef.current)) return Promise.resolve();
    const authority = continuityAuthorityRef.current;
    const controller = new AbortController();
    continuityAbortRef.current = controller;
    let deadlineReached = false;
    const deadline = window.setTimeout(() => {
      deadlineReached = true;
      controller.abort();
    }, PRODUCT_MATERIAL_CATCHUP_DEADLINE_MS);

    const run = (async () => {
      try {
        if (durableCursorRef.current.state === 'INVALID' || durableCursorRef.current.state === 'UNAVAILABLE') {
          durableCursorRef.current = readDurableMaterialCursor();
        }
        if (durableCursorRef.current.state === 'VALID') cursorRef.current = durableCursorRef.current.cursor;
        const proof = await proveMaterialContinuity({
          client,
          supervisorPage: supervisorSnapshot.materialEvents,
          durableCursor: durableCursorRef.current,
          signal: controller.signal,
          persistCursor: (cursor) => {
            if (!isCurrentContinuityRun(
              generation,
              lifecycleRef.current,
              mountedRef.current,
              authority,
              continuityAuthorityRef.current,
              controller.signal,
            )) return false;
            const persisted = persistDurableMaterialCursor(cursor);
            if (persisted) {
              cursorRef.current = cursor;
              durableCursorRef.current = Object.freeze({ state: 'VALID', cursor });
            } else {
              const newerDurableCursor = readDurableMaterialCursor();
              durableCursorRef.current = newerDurableCursor;
              if (newerDurableCursor.state === 'VALID' && BigInt(newerDurableCursor.cursor) > BigInt(cursor)) {
                cursorRef.current = newerDurableCursor.cursor;
              }
            }
            return persisted;
          },
        });
        if (!isCurrentContinuityRun(
          generation,
          lifecycleRef.current,
          mountedRef.current,
          authority,
          continuityAuthorityRef.current,
          controller.signal,
        )) return;
        const latestSupervisor = latestSupervisorRef.current;
        if (!latestSupervisor) return;
        const disposition = reconcileMaterialContinuity(proof, latestSupervisor.materialEvents);
        if (proof.continuity === 'PROVEN') provenMaterialHighWaterRef.current = proof.cursor;
        cursorRef.current = proof.cursor;
        durableCursorRef.current = Object.freeze({ state: 'VALID', cursor: proof.cursor });
        setMaterialEvents(proof.page);
        publishContinuity(disposition.continuity);
        setError(disposition.error);
      } catch (cause) {
        if (!isCurrentLifecycle(generation, lifecycleRef.current, mountedRef.current)
          || authority !== continuityAuthorityRef.current) return;
        if (controller.signal.aborted && !deadlineReached) return;
        publishContinuity('BLOCKED');
        setError(deadlineReached
          ? `Material-event catch-up exceeded the ${PRODUCT_MATERIAL_CATCHUP_DEADLINE_MS}ms bounded deadline.`
          : cause instanceof Error ? cause.message : 'Material-event continuity proof failed.');
      } finally {
        window.clearTimeout(deadline);
        if (continuityAbortRef.current === controller) {
          continuityAbortRef.current = null;
          continuityInFlightRef.current = null;
        }
      }
    })();
    continuityInFlightRef.current = run;
    return run;
  }, [client, publishContinuity]);

  const refresh = useCallback((): Promise<void> => {
    if (supervisorInFlightRef.current) return supervisorInFlightRef.current;
    const generation = lifecycleRef.current;
    const controller = new AbortController();
    supervisorAbortRef.current = controller;
    const run = (async () => {
      if (mountedRef.current) setLoading(true);
      try {
        await executeProductSupervisorRefresh<TDashboard>({
          client,
          signal: controller.signal,
          publishSnapshot: (nextSnapshot) => {
            if (!isCurrentRun(generation, lifecycleRef.current, mountedRef.current, controller.signal)) return false;
            const nextHighWater = BigInt(nextSnapshot.materialEvents.highWaterCursor);
            const highestHighWater = highestSupervisorHighWaterRef.current;
            if (highestHighWater !== null && nextHighWater < highestHighWater) {
              continuityAuthorityRef.current += 1;
              continuityAbortRef.current?.abort();
              publishContinuity('BLOCKED');
              setError('Supervisor material high-water regressed; last-known truth was retained.');
              return false;
            }
            highestSupervisorHighWaterRef.current = nextHighWater;
            latestSupervisorRef.current = nextSnapshot;
            snapshotRef.current = nextSnapshot;
            setSnapshot(nextSnapshot);
            setLoading(false);
            const priorProofStillCurrent = isMaterialContinuityStillCurrent(
              continuityRef.current,
              cursorRef.current,
              nextSnapshot.materialEvents,
            );
            const supervisorStillBehindProof = provenMaterialHighWaterRef.current !== null
              && BigInt(provenMaterialHighWaterRef.current) > nextHighWater;
            if (priorProofStillCurrent) {
              setError(null);
            } else if (supervisorStillBehindProof) {
              publishContinuity('UNPROVEN');
              setError('Supervisor snapshot is behind the proven material-event high-water; awaiting a fresh supervisor read.');
            } else {
              publishContinuity('UNPROVEN');
              setError('Material-event continuity proof is pending.');
            }
            return !priorProofStillCurrent && !supervisorStillBehindProof;
          },
          startContinuity: (nextSnapshot) => {
            void startContinuity(nextSnapshot, generation);
          },
        });
      } catch (cause) {
        if (!isCurrentLifecycle(generation, lifecycleRef.current, mountedRef.current)
          || controller.signal.aborted) return;
        continuityAuthorityRef.current += 1;
        continuityAbortRef.current?.abort();
        publishContinuity('BLOCKED');
        setError(cause instanceof Error ? cause.message : 'Product Control Room binding failed.');
      } finally {
        if (isCurrentLifecycle(generation, lifecycleRef.current, mountedRef.current)) setLoading(false);
        if (supervisorAbortRef.current === controller) {
          supervisorAbortRef.current = null;
          supervisorInFlightRef.current = null;
        }
      }
    })();
    supervisorInFlightRef.current = run;
    return run;
  }, [client, publishContinuity, startContinuity]);

  useEffect(() => {
    mountedRef.current = true;
    lifecycleRef.current += 1;
    let stopped = false;
    let timer: number | null = null;
    const poll = async (): Promise<void> => {
      await refresh();
      if (!stopped) timer = window.setTimeout(() => { void poll(); }, cadenceMs);
    };
    void poll();
    return () => {
      stopped = true;
      mountedRef.current = false;
      lifecycleRef.current += 1;
      continuityAuthorityRef.current += 1;
      if (timer !== null) window.clearTimeout(timer);
      supervisorAbortRef.current?.abort();
      continuityAbortRef.current?.abort();
      supervisorAbortRef.current = null;
      continuityAbortRef.current = null;
      supervisorInFlightRef.current = null;
      continuityInFlightRef.current = null;
    };
  }, [cadenceMs, refresh]);

  return {
    snapshot,
    materialEvents,
    loading,
    error,
    materialCursor: cursorRef.current,
    continuity,
    refresh,
  };
}

function resolveCursorStorage(storage: CursorStorage | null | undefined): CursorStorage | null {
  if (storage !== undefined) return storage;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isDecimalCursor(value: string): boolean {
  return /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ProductBindingError('Material-event read was aborted.', ['MATERIAL_READ_ABORTED']);
}

function isCurrentLifecycle(
  generation: number,
  currentGeneration: number,
  mounted: boolean,
): boolean {
  return mounted && generation === currentGeneration;
}

function isCurrentRun(
  generation: number,
  currentGeneration: number,
  mounted: boolean,
  signal: AbortSignal,
): boolean {
  return isCurrentLifecycle(generation, currentGeneration, mounted) && !signal.aborted;
}

function isCurrentContinuityRun(
  generation: number,
  currentGeneration: number,
  mounted: boolean,
  authority: number,
  currentAuthority: number,
  signal: AbortSignal,
): boolean {
  return authority === currentAuthority
    && isCurrentRun(generation, currentGeneration, mounted, signal);
}

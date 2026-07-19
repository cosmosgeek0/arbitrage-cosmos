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
    if (BigInt(cursor) >= pinnedHighWater) {
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
  const durableCursorRef = useRef<DurableMaterialCursorRead>(initialMaterialCursor);
  const cursorRef = useRef<string | null>(initialMaterialCursor.state === 'VALID' ? initialMaterialCursor.cursor : null);
  const mountedRef = useRef(false);
  const lifecycleRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const generation = lifecycleRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    let nextSnapshot: ProductSupervisorEnvelope<TDashboard> | null = null;
    const run = (async () => {
      if (mountedRef.current) setLoading(true);
      try {
        nextSnapshot = await client.readSupervisor<TDashboard>(controller.signal);
        if (!isCurrentRun(generation, lifecycleRef.current, mountedRef.current, controller.signal)) return;
        if (durableCursorRef.current.state === 'INVALID' || durableCursorRef.current.state === 'UNAVAILABLE') {
          durableCursorRef.current = readDurableMaterialCursor();
        }
        if (durableCursorRef.current.state === 'VALID') cursorRef.current = durableCursorRef.current.cursor;
        const proof = await proveMaterialContinuity({
          client,
          supervisorPage: nextSnapshot.materialEvents,
          durableCursor: durableCursorRef.current,
          signal: controller.signal,
          persistCursor: (cursor) => {
            if (!isCurrentRun(generation, lifecycleRef.current, mountedRef.current, controller.signal)) return false;
            const persisted = persistDurableMaterialCursor(cursor);
            if (persisted) {
              cursorRef.current = cursor;
              durableCursorRef.current = Object.freeze({ state: 'VALID', cursor });
            }
            else {
              const newerDurableCursor = readDurableMaterialCursor();
              durableCursorRef.current = newerDurableCursor;
              if (newerDurableCursor.state === 'VALID' && BigInt(newerDurableCursor.cursor) > BigInt(cursor)) {
                cursorRef.current = newerDurableCursor.cursor;
              }
            }
            return persisted;
          },
        });
        if (!isCurrentRun(generation, lifecycleRef.current, mountedRef.current, controller.signal)) return;
        cursorRef.current = proof.cursor;
        durableCursorRef.current = Object.freeze({ state: 'VALID', cursor: proof.cursor });
        setSnapshot(nextSnapshot);
        setMaterialEvents(proof.page);
        setContinuity(proof.continuity);
        setError(proof.continuity === 'BACKFILL'
          ? `Material-event catch-up is still in progress after ${proof.pagesRead} bounded pages.`
          : null);
      } catch (cause) {
        if (!isCurrentRun(generation, lifecycleRef.current, mountedRef.current, controller.signal)) return;
        if (nextSnapshot) setSnapshot(nextSnapshot);
        setContinuity('BLOCKED');
        setError(cause instanceof Error ? cause.message : 'Product Control Room binding failed.');
      } finally {
        if (isCurrentRun(generation, lifecycleRef.current, mountedRef.current, controller.signal)) setLoading(false);
        if (abortRef.current === controller) {
          abortRef.current = null;
          inFlightRef.current = null;
        }
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [client]);

  useEffect(() => {
    mountedRef.current = true;
    lifecycleRef.current += 1;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, cadenceMs);
    return () => {
      mountedRef.current = false;
      lifecycleRef.current += 1;
      window.clearInterval(timer);
      abortRef.current?.abort();
      abortRef.current = null;
      inFlightRef.current = null;
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

function isCurrentRun(
  generation: number,
  currentGeneration: number,
  mounted: boolean,
  signal: AbortSignal,
): boolean {
  return mounted && generation === currentGeneration && !signal.aborted;
}

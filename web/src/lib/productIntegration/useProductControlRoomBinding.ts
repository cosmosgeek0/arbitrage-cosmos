import { useCallback, useEffect, useRef, useState } from 'react';
import { ProductBindingError, type ProductIntegrationClient } from './client';
import { validateMaterialEventPage, type ProductSupervisorEnvelope } from './model';

export interface ProductControlRoomBindingState<TDashboard> {
  readonly snapshot: ProductSupervisorEnvelope<TDashboard> | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly materialCursor: string;
  readonly continuity: 'PROVEN' | 'BLOCKED';
  readonly refresh: () => Promise<void>;
}

/**
 * Shared-provider binding. It consumes one immutable supervisor envelope and
 * one bounded monotonic material-event page per cadence. A continuity failure
 * blocks the binding; it never skips forward or converts a gap into success.
 */
export function useProductControlRoomBinding<TDashboard = unknown>(
  client: Readonly<ProductIntegrationClient>,
  cadenceMs = 5_000,
  initialMaterialCursor = '0',
): ProductControlRoomBindingState<TDashboard> {
  const [snapshot, setSnapshot] = useState<ProductSupervisorEnvelope<TDashboard> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [continuity, setContinuity] = useState<'PROVEN' | 'BLOCKED'>('PROVEN');
  const cursorRef = useRef(initialMaterialCursor);
  const snapshotRef = useRef<ProductSupervisorEnvelope<TDashboard> | null>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const run = (async () => {
      setLoading(true);
      try {
        const next = await client.readSupervisor<TDashboard>();
        const afterCursor = cursorRef.current;
        const events = snapshotRef.current === null
          ? next.materialEvents
          : await client.readMaterialEvents(afterCursor, 200);
        const continuityErrors = validateMaterialEventPage(afterCursor, events);
        if (continuityErrors.length) {
          throw new ProductBindingError('Material-event continuity is not proven.', continuityErrors);
        }
        if (!mountedRef.current) return;
        cursorRef.current = events.nextCursor;
        const accepted = { ...next, materialEvents: events };
        snapshotRef.current = accepted;
        setSnapshot(accepted);
        setContinuity('PROVEN');
        setError(null);
      } catch (cause) {
        if (!mountedRef.current) return;
        setContinuity('BLOCKED');
        setError(cause instanceof Error ? cause.message : 'Product Control Room binding failed.');
      } finally {
        if (mountedRef.current) setLoading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [client]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, cadenceMs);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [cadenceMs, refresh]);

  return {
    snapshot,
    loading,
    error,
    materialCursor: cursorRef.current,
    continuity,
    refresh,
  };
}

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LedgerEvent } from '../types';
import { apiErrorMessage, fetchJson } from './http';
import { createSettledPoll } from './polling';

const DAY_MS = 24 * 60 * 60_000;
const NOTIFICATION_ARCHIVE_DAYS = 7;
const RELEVANT_KINDS = [
  'risk_decision', 'error_event', 'user_stream', 'ws.closed', 'ws.open',
  'connection_alert', 'connection_recovered', 'manual_action', 'order_intent',
  'order_request', 'order_response', 'order_outcome_unknown', 'cancel_outcome_unknown',
  'fill_event', 'loan_request', 'loan_response', 'binance.connected', 'engine.start',
  'engine_started', 'basis.engine_started', 'config_change', 'aws_notification',
] as const;

export const NOTIFICATION_ARCHIVE_LIMIT = 10_000;

export interface NotificationArchiveState {
  events: LedgerEvent[];
  droppedCount: number;
}

export type NotificationFeedStatus = 'LOADING' | 'CURRENT' | 'STALE' | 'UNAVAILABLE';

export interface NotificationFeedState {
  archive: NotificationArchiveState;
  status: NotificationFeedStatus;
  lastSuccessAt: number | null;
  error: string | null;
  pendingBootstrapKinds: number;
}

interface NotificationFeedBatch {
  items: LedgerEvent[];
  bootstrapFailures: number;
  bootstrapSuccesses: number;
}

export function retainNotificationArchive(
  current: NotificationArchiveState,
  incoming: readonly LedgerEvent[],
  cutoff: number,
): NotificationArchiveState {
  const merged = new Map<number, LedgerEvent>();
  current.events.filter((item) => item.ts >= cutoff).forEach((item) => merged.set(item.id, item));
  incoming.filter((item) => item.ts >= cutoff).forEach((item) => merged.set(item.id, item));
  const ordered = [...merged.values()].sort((a, b) => b.ts - a.ts || b.id - a.id);
  const discardedThisMerge = Math.max(0, ordered.length - NOTIFICATION_ARCHIVE_LIMIT);
  return {
    events: ordered.slice(0, NOTIFICATION_ARCHIVE_LIMIT),
    droppedCount: current.droppedCount + discardedThisMerge,
  };
}

const INITIAL_NOTIFICATION_FEED: NotificationFeedState = {
  archive: { events: [], droppedCount: 0 },
  status: 'LOADING',
  lastSuccessAt: null,
  error: null,
  pendingBootstrapKinds: RELEVANT_KINDS.length,
};

const NotificationFeedContext = createContext<NotificationFeedState | null>(null);

export function NotificationFeedProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<NotificationFeedState>(INITIAL_NOTIFICATION_FEED);

  useEffect(() => {
    let bootstrapped = false;
    let pendingBootstrapKinds = [...RELEVANT_KINDS];
    let bootstrapHighWater: number | null = null;
    const bootstrapSince = Date.now() - NOTIFICATION_ARCHIVE_DAYS * DAY_MS;
    let cursor = 0;

    const readEventRows = async (url: string, signal: AbortSignal): Promise<LedgerEvent[]> => {
      const rows = await fetchJson<LedgerEvent[]>(url, { cache: 'no-store', signal }, 10_000);
      if (!Array.isArray(rows)) throw new Error('events payload is invalid');
      return rows;
    };

    const notificationPoll = createSettledPoll<NotificationFeedBatch>({
      intervalMs: 5_000,
      timeoutMs: 15_000,
      request: async (signal) => {
        let items: LedgerEvent[] = [];
        let bootstrapFailures = 0;
        let bootstrapSuccesses = 0;
        if (!bootstrapped) {
          if (bootstrapHighWater === null) {
            const head = await readEventRows('/api/events?limit=1', signal);
            bootstrapHighWater = head[0]?.id ?? 0;
          }
          const before = bootstrapHighWater > 0 ? `&beforeId=${bootstrapHighWater + 1}` : '';
          const attemptedKinds = pendingBootstrapKinds;
          const bootstrapReads = await Promise.allSettled(attemptedKinds.map((kind) => readEventRows(
            `/api/events?since=${bootstrapSince}&kind=${encodeURIComponent(kind)}&limit=2000${before}`,
            signal,
          )));
          if (signal.aborted) throw signal.reason;
          items = bootstrapReads.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
          pendingBootstrapKinds = attemptedKinds.filter((_, index) => bootstrapReads[index]?.status === 'rejected');
          bootstrapFailures = pendingBootstrapKinds.length;
          bootstrapSuccesses = attemptedKinds.length - bootstrapFailures;
          if (bootstrapFailures === 0) {
            cursor = Math.max(cursor, bootstrapHighWater);
            bootstrapped = true;
          }
        } else {
          let afterId = cursor;
          const sevenDaysAgo = Date.now() - NOTIFICATION_ARCHIVE_DAYS * DAY_MS;
          for (let page = 0; page < 10; page += 1) {
            const rows = await readEventRows(`/api/events?since=${sevenDaysAgo}&afterId=${afterId}&limit=2000`, signal);
            items.push(...rows);
            if (rows.length < 2_000) break;
            afterId = Math.max(afterId, ...rows.map((item) => item.id));
          }
        }
        return { items, bootstrapFailures, bootstrapSuccesses };
      },
      onSuccess: ({ items, bootstrapFailures, bootstrapSuccesses }) => {
        if (items.length > 0) cursor = Math.max(cursor, ...items.map((item) => item.id));
        const now = Date.now();
        const cutoff = now - NOTIFICATION_ARCHIVE_DAYS * DAY_MS;
        setSnapshot((current) => {
          const archive = retainNotificationArchive(current.archive, items, cutoff);
          if (bootstrapFailures > 0) {
            return {
              archive,
              status: current.lastSuccessAt === null && bootstrapSuccesses === 0 ? 'UNAVAILABLE' : 'STALE',
              lastSuccessAt: bootstrapSuccesses > 0 ? now : current.lastSuccessAt,
              error: `${bootstrapFailures} notification history ${bootstrapFailures === 1 ? 'stream is' : 'streams are'} unavailable; retrying only failed streams.`,
              pendingBootstrapKinds: bootstrapFailures,
            };
          }
          return {
            archive,
            status: 'CURRENT',
            lastSuccessAt: now,
            error: null,
            pendingBootstrapKinds: 0,
          };
        });
      },
      onError: (error) => {
        setSnapshot((current) => ({
          ...current,
          status: current.lastSuccessAt === null ? 'UNAVAILABLE' : 'STALE',
          error: apiErrorMessage(error, 'Notification feed unavailable'),
        }));
      },
    });
    notificationPoll.start();
    return notificationPoll.stop;
  }, []);

  return <NotificationFeedContext.Provider value={snapshot}>{children}</NotificationFeedContext.Provider>;
}

export function useNotificationFeed(): NotificationFeedState {
  const snapshot = useContext(NotificationFeedContext);
  if (snapshot === null) throw new Error('useNotificationFeed requires NotificationFeedProvider');
  return snapshot;
}

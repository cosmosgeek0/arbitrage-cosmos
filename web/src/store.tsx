import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { applyPrefs, getPrefs, onPrefs, resolvedTheme, setPref, CURRENCIES, type Prefs } from './lib/prefs';
import { setBasisUnit, setDisplayUtc, setFxRate } from './format';
import { fireRefresh } from './lib/refresh';
import { ApiRequestError, fetchJson, type ApiFailure } from './lib/http';
import { createSettledPoll } from './lib/polling';
import { readDurableMaterialCursor } from './lib/productIntegration/useProductControlRoomBinding';
import {
  WEB_SOCKET_CLOSE_DIAGNOSTIC_ID,
  reduceTrustedWebSocketCloseDiagnostic,
  webSocketCloseDiagnosticAttributes,
  type WebSocketCloseDiagnostic,
} from './lib/webSocketCloseDiagnostic';
import type {
  AppConfig,
  MarketRow,
  ServerState,
} from './types';

export type RefreshResult = {
  ok: boolean;
  issues: string[];
  ts?: number;
};

export type CompatibilityStateStatus = 'LOADING' | 'CURRENT' | 'STALE' | 'UNAVAILABLE';

export type CompatibilityStateTruth = Readonly<{
  status: CompatibilityStateStatus;
  lastSuccessAtMs: number | null;
  error: string | null;
}>;

export type CompatibilityStateTruthEvent =
  | Readonly<{ kind: 'SUCCESS'; observedAtMs: number }>
  | Readonly<{ kind: 'FAILURE'; observedAtMs: number; error: string }>;

export const INITIAL_COMPATIBILITY_STATE_TRUTH: CompatibilityStateTruth = Object.freeze({
  status: 'LOADING',
  lastSuccessAtMs: null,
  error: null,
});

export function reduceCompatibilityStateTruth(
  current: Readonly<CompatibilityStateTruth>,
  event: Readonly<CompatibilityStateTruthEvent>,
): CompatibilityStateTruth {
  const observedAtMs = Number.isFinite(event.observedAtMs) && event.observedAtMs >= 0
    ? event.observedAtMs
    : null;
  if (event.kind === 'SUCCESS' && observedAtMs !== null) {
    return Object.freeze({ status: 'CURRENT', lastSuccessAtMs: observedAtMs, error: null });
  }
  const error = event.kind === 'FAILURE' && event.error.trim()
    ? event.error.trim()
    : 'Compatibility state refresh failed.';
  return Object.freeze({
    status: current.lastSuccessAtMs === null ? 'UNAVAILABLE' : 'STALE',
    lastSuccessAtMs: current.lastSuccessAtMs,
    error,
  });
}

export type MarketFreshnessStatus = 'ERROR' | 'UNKNOWN' | 'DISCONNECTED' | 'LIVE' | 'STALE';

export type MarketFreshnessTruth = Readonly<{
  status: MarketFreshnessStatus;
  live: boolean;
  ageMs: number | null;
}>;

export function normalizeMarketSourceTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function resolveMarketFreshness(input: Readonly<{
  connected: boolean;
  error: string | null;
  sourceTimeMs: number | null;
  nowMs: number;
  staleAfterMs: number;
}>): MarketFreshnessTruth {
  if (input.error) return Object.freeze({ status: 'ERROR', live: false, ageMs: null });
  const sourceTimeMs = normalizeMarketSourceTime(input.sourceTimeMs);
  if (sourceTimeMs === null || !Number.isFinite(input.nowMs) || sourceTimeMs > input.nowMs) {
    return Object.freeze({ status: 'UNKNOWN', live: false, ageMs: null });
  }
  const ageMs = input.nowMs - sourceTimeMs;
  if (!input.connected) return Object.freeze({ status: 'DISCONNECTED', live: false, ageMs });
  const staleAfterMs = Number.isFinite(input.staleAfterMs) && input.staleAfterMs > 0
    ? input.staleAfterMs
    : 0;
  if (ageMs < staleAfterMs) return Object.freeze({ status: 'LIVE', live: true, ageMs });
  return Object.freeze({ status: 'STALE', live: false, ageMs });
}

// Account detail ids render controlled, read-only Account subviews. Product
// truth remains in ProductControlRoomProvider; this store owns navigation only.
export type Page =
  | 'dashboard'
  | 'control-room'
  | 'account'
  | 'wallets'
  | 'markets'
  | 'detail'
  | 'loans'
  | 'execution'
  | 'orders'
  | 'positions'
  | 'fills'
  | 'pnl'
  | 'strategies'
  | 'volume'
  | 'opportunities'
  | 'risk'
  | 'ledger'
  | 'system'
  | 'notifications'
  | 'news'
  | 'calendar';

const PAGE_IDS: Page[] = [
  'dashboard', 'control-room', 'account', 'wallets', 'markets', 'detail', 'loans', 'execution', 'orders',
  'positions', 'fills', 'pnl', 'strategies', 'volume', 'opportunities', 'risk', 'ledger', 'system',
  'notifications', 'news', 'calendar',
];

interface Store {
  state: ServerState | null;
  stateStatus: CompatibilityStateStatus;
  stateLastSuccessAtMs: number | null;
  stateError: string | null;
  markets: MarketRow[];
  marketsUpdatedAt: number | null;
  marketsError: string | null;
  mutationError: ApiFailure | null;
  fxTruth: FxTruth;
  fxBusy: boolean;
  refreshFx: () => void;
  connected: boolean;
  dataNonce: number;
  refresh: () => Promise<RefreshResult>;
  page: Page;
  setPage: (p: Page) => void;
  detailSymbol: string;
  openDetail: (symbol: string) => void;
  openLedger: (symbol: string) => void;
  prefs: Prefs;
  updatePref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  toggleWatch: (symbol: string) => Promise<ApiFailure | null>;
  saveConfig: (patch: Partial<AppConfig>) => Promise<AppConfig | null>;
}

const StoreContext = createContext<Store | null>(null);

export const FX_MAX_SOURCE_AGE_MS = 30 * 60_000;
export type FxTruthStatus = 'LOADING' | 'CURRENT' | 'STALE' | 'UNAVAILABLE';
export type FxTruth = Readonly<{
  status: FxTruthStatus;
  rates: Readonly<Record<string, number>>;
  sourceTimeMs: number | null;
  lastSuccessAtMs: number | null;
  error: string | null;
}>;
export type FxTruthEvent =
  | Readonly<{ kind: 'SUCCESS'; observedAtMs: number; payload: Readonly<{ rates?: Record<string, number>; fetchedAt?: number }> }>
  | Readonly<{ kind: 'FAILURE'; observedAtMs: number; error: string }>;

export const INITIAL_FX_TRUTH: FxTruth = Object.freeze({
  status: 'LOADING', rates: Object.freeze({}), sourceTimeMs: null, lastSuccessAtMs: null, error: null,
});

export function reduceFxTruth(current: FxTruth, event: FxTruthEvent): FxTruth {
  if (event.kind === 'FAILURE') {
    return Object.freeze({
      ...current,
      status: current.lastSuccessAtMs === null ? 'UNAVAILABLE' : 'STALE',
      error: event.error.trim() || 'FX refresh failed.',
    });
  }
  const observedAtMs = Number.isFinite(event.observedAtMs) ? event.observedAtMs : 0;
  const sourceTimeMs = Number.isFinite(event.payload.fetchedAt) && Number(event.payload.fetchedAt) > 0
    ? Number(event.payload.fetchedAt)
    : null;
  const rates = Object.fromEntries(Object.entries(event.payload.rates ?? {}).filter(([, rate]) => Number.isFinite(rate) && rate > 0));
  const fresh = sourceTimeMs !== null
    && sourceTimeMs <= observedAtMs
    && observedAtMs - sourceTimeMs <= FX_MAX_SOURCE_AGE_MS
    && Object.keys(rates).length > 0;
  return Object.freeze({
    status: fresh ? 'CURRENT' : Object.keys(rates).length > 0 ? 'STALE' : 'UNAVAILABLE',
    rates: Object.freeze(rates),
    sourceTimeMs,
    lastSuccessAtMs: fresh ? observedAtMs : current.lastSuccessAtMs,
    error: fresh ? null : 'FX source is stale or invalid.',
  });
}

export function resolveFxRate(
  truth: FxTruth,
  currency: string,
  nowMs: number,
): Readonly<{ status: FxTruthStatus; rate: number | null }> {
  if (currency === 'USD') return Object.freeze({ status: 'CURRENT', rate: 1 });
  const rate = truth.rates[currency];
  const current = truth.status === 'CURRENT'
    && truth.sourceTimeMs !== null
    && nowMs >= truth.sourceTimeMs
    && nowMs - truth.sourceTimeMs <= FX_MAX_SOURCE_AGE_MS
    && Number.isFinite(rate)
    && rate > 0;
  if (current) return Object.freeze({ status: 'CURRENT', rate });
  const status = truth.status === 'LOADING'
    ? 'LOADING'
    : truth.lastSuccessAtMs !== null || Number.isFinite(rate)
      ? 'STALE'
      : 'UNAVAILABLE';
  return Object.freeze({ status, rate: null });
}

// ---- live order-book stream (Token Detail) -------------------------------
// Rides the same /ws socket as canonical invalidations and material-event
// pages. One symbol at a time; the server opens a Binance depth20@100ms +
// aggTrade stream while subscribed.
export type LiveBookMsg =
  | { type: 'book'; symbol: string; bids: [string, string][]; asks: [string, string][]; ts: number }
  | { type: 'btrades'; symbol: string; trades: { id: number; price: number; qty: number; time: number; isBuyerMaker: boolean }[] };

let liveWs: WebSocket | null = null;
let liveBookSymbol: string | null = null;
const liveBookListeners = new Set<(m: LiveBookMsg) => void>();

function sendLiveSub(): void {
  if (liveWs?.readyState === WebSocket.OPEN) {
    liveWs.send(JSON.stringify(liveBookSymbol ? { type: 'sub-book', symbol: liveBookSymbol } : { type: 'unsub-book' }));
  }
}

export function subscribeLiveBook(symbol: string, fn: (m: LiveBookMsg) => void): () => void {
  liveBookListeners.add(fn);
  liveBookSymbol = symbol;
  sendLiveSub();
  return () => {
    liveBookListeners.delete(fn);
    if (liveBookListeners.size === 0) {
      liveBookSymbol = null;
      sendLiveSub();
    }
  };
}
// ---------------------------------------------------------------------------

type MutationResult<T> = { data: T; error: null } | { data: null; error: ApiFailure };

function mutationFailure(error: unknown): ApiFailure {
  if (error instanceof ApiRequestError) {
    return { status: error.status, code: error.code, message: error.message, details: error.details };
  }
  return {
    status: 0,
    code: 'NETWORK_ERROR',
    message: error instanceof Error && error.message ? error.message : 'Network request failed',
  };
}

function acknowledgementFailure(message: string): ApiFailure {
  return { status: 502, code: 'INVALID_ACKNOWLEDGEMENT', message };
}

function isConfigAcknowledgement(value: unknown): value is AppConfig {
  if (!value || typeof value !== 'object') return false;
  const config = value as Partial<AppConfig>;
  return (
    typeof config.killSwitch === 'boolean' &&
    typeof config.liveTradingEnabled === 'boolean' &&
    typeof config.fundsLocked === 'boolean' &&
    typeof config.automationPaused === 'boolean' &&
    Array.isArray(config.allowedSymbols) &&
    Array.isArray(config.blockedSymbols) &&
    Array.isArray(config.watchlist) &&
    Boolean(config.controlModes && typeof config.controlModes === 'object') &&
    Boolean(config.borrowGuard && typeof config.borrowGuard === 'object')
  );
}

function isCanonicalSupervisorDeltaMessage(value: unknown): value is Readonly<{
  type: 'canonical-supervisor-delta';
  payload: Readonly<{ schemaVersion: 'canonical-supervisor-delta.v1'; revision: string }>;
}> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.type !== 'canonical-supervisor-delta'
      || !message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)) return false;
  const payload = message.payload as Record<string, unknown>;
  return payload.schemaVersion === 'canonical-supervisor-delta.v1'
    && typeof payload.revision === 'string'
    && payload.revision.length > 0
    && payload.revision.length <= 256;
}

function failClosedConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    liveTradingEnabled: false,
    fundsLocked: true,
    automationPaused: true,
    controlModes: {
      ...config.controlModes,
      funds: 'blocked',
      borrowing: 'blocked',
      automation: 'paused',
      liveOrders: 'blocked',
    },
    borrowGuard: {
      ...config.borrowGuard,
      enabled: true,
      newBorrowPaused: true,
      repayOnly: true,
    },
  };
}

export function failClosedState(serverState: ServerState): ServerState {
  const config = failClosedConfig(serverState.config);
  // A compatibility payload without the canonical control snapshot is not
  // evidence that the kill is clear. Treat missing or malformed truth as halt.
  const canonicalKillEngaged = serverState.canonicalSupervisor?.control?.killSwitchEngaged !== false;
  const hasCompletePrivateAccountReadback = serverState.account != null && Array.isArray(serverState.positions);
  const privateAccountTruth = !serverState.binance.keysPresent || serverState.privateAccountTruth === 'NOT_CONFIGURED'
    ? 'NOT_CONFIGURED'
    : serverState.privateAccountTruth === 'AVAILABLE' && hasCompletePrivateAccountReadback
      ? 'AVAILABLE'
      : 'UNAVAILABLE';
  const privateOrderTruth = privateAccountTruth !== 'AVAILABLE'
    ? privateAccountTruth
    : serverState.privateOrderTruth === 'AVAILABLE' && Array.isArray(serverState.openOrders)
      ? 'AVAILABLE'
      : 'UNAVAILABLE';
  return {
    ...serverState,
    mode: config.killSwitch || canonicalKillEngaged ? 'HALTED' : 'MANUAL',
    config,
    privateAccountTruth,
    privateOrderTruth,
    account: privateAccountTruth === 'AVAILABLE' ? serverState.account : null,
    positions: privateAccountTruth === 'AVAILABLE' ? serverState.positions : null,
    openOrders: privateOrderTruth === 'AVAILABLE' ? serverState.openOrders : null,
  };
}

async function post<T>(url: string, body: unknown): Promise<MutationResult<T>> {
  try {
    const data = await fetchJson<T>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 12_000);
    return { data, error: null };
  } catch (error) {
    return { data: null, error: mutationFailure(error) };
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ServerState | null>(null);
  const [stateTruth, setStateTruth] = useState<CompatibilityStateTruth>(
    INITIAL_COMPATIBILITY_STATE_TRUTH,
  );
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [marketsUpdatedAt, setMarketsUpdatedAt] = useState<number | null>(null);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<ApiFailure | null>(null);
  const [fxTruth, setFxTruth] = useState<FxTruth>(INITIAL_FX_TRUTH);
  const [fxBusy, setFxBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(() => {
    applyPrefs();
    const p = getPrefs();
    setDisplayUtc(p.timezone === 'utc');
    setBasisUnit(p.basisUnit);
    return p;
  });
  // Restore the tab the owner was on across a hard refresh (localStorage),
  // falling back to their configured default page, then the dashboard.
  const [page, setPage] = useState<Page>(() => {
    const saved = localStorage.getItem('cosmos-active-page');
    if (saved && PAGE_IDS.includes(saved as Page)) return saved as Page;
    return PAGE_IDS.includes(getPrefs().defaultPage as Page) ? (getPrefs().defaultPage as Page) : 'dashboard';
  });
  const [detailSymbol, setDetailSymbol] = useState(() => localStorage.getItem('cosmos-detail-symbol') || 'BTCUSDT');
  const [dataNonce, setDataNonce] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [webSocketCloseDiagnostic, setWebSocketCloseDiagnostic] = useState<WebSocketCloseDiagnostic | null>(null);
  const [, bumpFx] = useState(0);
  const fxPollRef = useRef<ReturnType<typeof createSettledPoll> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<(() => void) | null>(null);

  // One FX owner feeds both global formatters and the operator sheet. Cached
  // rates remain diagnostic evidence after failure, but never current truth.
  useEffect(() => {
    const poll = createSettledPoll<{ rates?: Record<string, number>; fetchedAt?: number }>({
      intervalMs: Math.max(0.5, prefs.dataCadence?.fx ?? 300) * 1_000,
      request: (signal) => {
        setFxBusy(true);
        return fetchJson('/api/fx', { signal });
      },
      onSuccess: (d) => {
        setFxTruth((current) => reduceFxTruth(current, { kind: 'SUCCESS', observedAtMs: Date.now(), payload: d }));
        setFxBusy(false);
      },
      onError: (cause) => {
        setFxTruth((current) => reduceFxTruth(current, {
          kind: 'FAILURE', observedAtMs: Date.now(), error: mutationFailure(cause).message,
        }));
        setFxBusy(false);
      },
    });
    fxPollRef.current = poll;
    poll.start();
    return () => {
      if (fxPollRef.current === poll) fxPollRef.current = null;
      poll.stop();
    };
  }, [prefs.dataCadence?.fx]);

  useEffect(() => {
    const cur = prefs.currency || 'USD';
    const sym = CURRENCIES[cur]?.symbol ?? '$';
    const resolved = resolveFxRate(fxTruth, cur, Date.now());
    setFxRate(resolved.rate, sym, resolved.status === 'CURRENT');
    bumpFx((n) => n + 1);
    if (fxTruth.status !== 'CURRENT' || fxTruth.sourceTimeMs === null) return;
    const delayMs = Math.max(0, fxTruth.sourceTimeMs + FX_MAX_SOURCE_AGE_MS - Date.now() + 1);
    const timer = window.setTimeout(() => {
      setFxTruth((current) => current.status === 'CURRENT' && current.sourceTimeMs === fxTruth.sourceTimeMs
        ? reduceFxTruth(current, { kind: 'FAILURE', observedAtMs: Date.now(), error: 'FX source expired.' })
        : current);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [fxTruth, prefs.currency]);

  const refreshFx = useCallback(() => {
    if (!fxPollRef.current) return;
    setFxBusy(true);
    fxPollRef.current.refresh();
  }, []);

  useEffect(() => onPrefs((p) => {
    setPrefs(p);
    setDisplayUtc(p.timezone === 'utc');
    setBasisUnit(p.basisUnit);
  }), []);

  // follow system theme changes when theme = system
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fn = () => {
      const current = getPrefs();
      if (current.theme === 'system' || current.motion === 'system') applyPrefs();
    };
    mq.addEventListener('change', fn);
    motionMq.addEventListener('change', fn);
    return () => {
      mq.removeEventListener('change', fn);
      motionMq.removeEventListener('change', fn);
    };
  }, []);

  useEffect(() => {
    let closed = false;
    let retry: number | null = null;
    let generation = 0;
    let stateRefreshInFlight = false;
    let stateRefreshQueued = false;
    let stateRefreshController: AbortController | null = null;
    const requestCompatibilityState = () => {
      if (closed) return;
      if (stateRefreshInFlight) {
        stateRefreshQueued = true;
        return;
      }
      stateRefreshInFlight = true;
      const controller = new AbortController();
      stateRefreshController = controller;
      void fetchJson<ServerState>('/api/state', { cache: 'no-store', signal: controller.signal })
        .then((snapshot) => {
          if (!closed && !controller.signal.aborted) {
            setState(failClosedState(snapshot));
            setStateTruth((current) => reduceCompatibilityStateTruth(current, {
              kind: 'SUCCESS',
              observedAtMs: Date.now(),
            }));
          }
        })
        .catch((cause) => {
          if (!closed && !controller.signal.aborted) {
            setStateTruth((current) => reduceCompatibilityStateTruth(current, {
              kind: 'FAILURE',
              observedAtMs: Date.now(),
              error: mutationFailure(cause).message,
            }));
          }
        })
        .finally(() => {
          if (stateRefreshController === controller) stateRefreshController = null;
          stateRefreshInFlight = false;
          if (!closed && stateRefreshQueued) {
            stateRefreshQueued = false;
            requestCompatibilityState();
          }
        });
    };
    requestCompatibilityState();
    const clearRetry = () => {
      if (retry !== null) window.clearTimeout(retry);
      retry = null;
    };
    const closeCurrent = () => {
      const previous = wsRef.current;
      wsRef.current = null;
      if (liveWs === previous) liveWs = null;
      if (!previous) return;
      previous.onopen = null;
      previous.onmessage = null;
      previous.onclose = null;
      previous.onerror = null;
      if (previous.readyState === WebSocket.CONNECTING || previous.readyState === WebSocket.OPEN) previous.close();
    };
    const scheduleConnect = (delay: number) => {
      clearRetry();
      if (closed) return;
      retry = window.setTimeout(() => {
        retry = null;
        connect();
      }, delay);
    };
    function connect() {
      if (closed) return;
      clearRetry();
      closeCurrent();
      const socketGeneration = ++generation;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const socketUrl = new URL(`${proto}://${location.host}/ws`);
      const durableCursor = readDurableMaterialCursor();
      if (durableCursor.state === 'VALID') socketUrl.searchParams.set('afterCursor', durableCursor.cursor);
      const ws = new WebSocket(socketUrl.toString());
      let connectionEstablished = false;
      wsRef.current = ws;
      liveWs = ws;
      ws.onopen = () => {
        if (closed || socketGeneration !== generation || wsRef.current !== ws) return;
        connectionEstablished = true;
        setConnected(true);
        sendLiveSub(); // re-attach any live book subscription after reconnect
      };
      ws.onmessage = (msg) => {
        if (closed || socketGeneration !== generation || wsRef.current !== ws) return;
        try {
          const data: unknown = JSON.parse(msg.data as string);
          if (isCanonicalSupervisorDeltaMessage(data)) requestCompatibilityState();
          else if (data && typeof data === 'object'
              && ((data as { type?: unknown }).type === 'book' || (data as { type?: unknown }).type === 'btrades')) {
            for (const fn of liveBookListeners) fn(data as unknown as LiveBookMsg);
          }
          // Material-event cursor consumption stays with the existing Product
          // Control Room binding; this compatibility store never advances it.
        } catch {
          // ignore
        }
      };
      ws.onclose = (event) => {
        if (closed || socketGeneration !== generation || wsRef.current !== ws) return;
        setWebSocketCloseDiagnostic((current) => reduceTrustedWebSocketCloseDiagnostic(
          current,
          event,
          socketGeneration,
          connectionEstablished,
        ));
        wsRef.current = null;
        if (liveWs === ws) liveWs = null;
        setConnected(false);
        scheduleConnect(3_000);
      };
      ws.onerror = () => {
        if (socketGeneration === generation && wsRef.current === ws) ws.close();
      };
    }
    reconnectRef.current = () => {
      generation += 1;
      clearRetry();
      closeCurrent();
      setConnected(false);
      scheduleConnect(80);
    };
    connect();

    return () => {
      closed = true;
      generation += 1;
      clearRetry();
      stateRefreshController?.abort();
      stateRefreshController = null;
      stateRefreshQueued = false;
      reconnectRef.current = null;
      closeCurrent();
      setConnected(false);
    };
  }, []);

  // markets poll at the preferred source cadence. `refreshSec` is retained as
  // the legacy market value; `dataCadence.market` is the new source map.
  useEffect(() => {
    const marketSec = prefs.dataCadence?.market ?? prefs.refreshSec;
    const poll = createSettledPoll<{ updatedAt?: number; rows: MarketRow[] }>({
      intervalMs: Math.max(0.5, marketSec) * 1_000,
      request: (signal) => fetchJson('/api/markets', { signal }),
      onSuccess: (payload) => {
          if (!Array.isArray(payload.rows)) throw new Error('Invalid market response');
          setMarkets(payload.rows);
          setMarketsUpdatedAt(normalizeMarketSourceTime(payload.updatedAt));
          setMarketsError(null);
      },
      onError: () => setMarketsError('market refresh failed'),
    });
    poll.start();
    return poll.stop;
  }, [prefs.refreshSec, prefs.dataCadence?.market]);

  const openDetail = useCallback((symbol: string) => {
    setDetailSymbol(symbol);
    localStorage.setItem('cosmos-detail-symbol', symbol);
    setPage('detail');
    localStorage.setItem('cosmos-active-page', 'detail');
    window.scrollTo({ top: 0 });
    document.querySelector('.app-main main')?.scrollTo({ top: 0 });
  }, []);

  const changePage = useCallback((p: Page) => {
    setPage(p);
    localStorage.setItem('cosmos-active-page', p);
    window.scrollTo({ top: 0 });
    document.querySelector('.app-main main')?.scrollTo({ top: 0 });
  }, []);

  const saveConfig = useCallback(async (patch: Partial<AppConfig>) => {
    const result = await post<AppConfig>('/api/config', patch);
    const config = result.data && isConfigAcknowledgement(result.data) ? failClosedConfig(result.data) : null;
    const error = result.error ?? (config ? null : acknowledgementFailure('Configuration acknowledgement was malformed.'));
    setMutationError(error);
    if (config) setState((s) => (s ? failClosedState({ ...s, config }) : s));
    return config;
  }, []);

  // Read-only browser snapshot refresh retained for compatibility consumers.
  // It never calls the managed-runtime /api/refresh targets: those require the
  // canonical Product preview/digest/revision/receipt protocol.
  const refresh = useCallback(async (): Promise<RefreshResult> => {
    const issues: string[] = [];
    try {
      const s = await fetchJson<ServerState>('/api/state');
      setState(failClosedState(s));
      setStateTruth((current) => reduceCompatibilityStateTruth(current, {
        kind: 'SUCCESS',
        observedAtMs: Date.now(),
      }));
    } catch (cause) {
      issues.push('State snapshot failed');
      setStateTruth((current) => reduceCompatibilityStateTruth(current, {
        kind: 'FAILURE',
        observedAtMs: Date.now(),
        error: mutationFailure(cause).message,
      }));
    }
    try {
      const payload = await fetchJson<{ updatedAt?: number; rows: MarketRow[] }>('/api/markets');
      if (Array.isArray(payload.rows)) {
        setMarkets(payload.rows);
        setMarketsUpdatedAt(normalizeMarketSourceTime(payload.updatedAt));
        setMarketsError(null);
      }
    } catch {
      issues.push('Market refresh failed');
    }
    // Rebuild only the browser's cockpit socket, then re-attach any active
    // token-book subscription. No server runtime is restarted here.
    reconnectRef.current?.();
    setDataNonce((n) => n + 1);
    fireRefresh();
    return {
      ok: issues.length === 0,
      issues,
      ts: Date.now(),
    };
  }, []);

  const store: Store = {
    state,
    stateStatus: stateTruth.status,
    stateLastSuccessAtMs: stateTruth.lastSuccessAtMs,
    stateError: stateTruth.error,
    markets,
    marketsUpdatedAt,
    marketsError,
    mutationError,
    fxTruth,
    fxBusy,
    refreshFx,
    connected,
    dataNonce,
    refresh,
    page,
    setPage: changePage,
    detailSymbol,
    openDetail,
    openLedger: useCallback(
      (symbol: string) => {
        sessionStorage.setItem('cosmos-ledger-symbol', symbol);
        changePage('ledger');
      },
      [changePage]
    ),
    prefs,
    updatePref: useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => {
      setPrefs(setPref(k, v));
    }, []),
    paletteOpen,
    setPaletteOpen,
    toggleWatch: useCallback(
      async (symbol: string) => {
        const cur = state?.config.watchlist ?? [];
        const next = cur.includes(symbol) ? cur.filter((s) => s !== symbol) : [...cur, symbol];
        const saved = await saveConfig({ watchlist: next });
        return saved ? null : acknowledgementFailure('The watchlist change was not acknowledged.');
      },
      [state, saveConfig]
    ),
    saveConfig,
  };

  return (
    <StoreContext.Provider value={store}>
      {children}
      <span
        id={WEB_SOCKET_CLOSE_DIAGNOSTIC_ID}
        hidden
        aria-hidden="true"
        {...webSocketCloseDiagnosticAttributes(webSocketCloseDiagnostic)}
      />
    </StoreContext.Provider>
  );
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore outside provider');
  return ctx;
}

export function useResolvedTheme(): 'light' | 'dark' {
  const { prefs } = useStore();
  return resolvedTheme(prefs);
}

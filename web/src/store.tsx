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
import {
  INITIAL_WEB_SOCKET_PROTOCOL_HEALTH,
  WEB_SOCKET_PROTOCOL_CLOSE_CODE,
  WEB_SOCKET_PROTOCOL_CLOSE_REASON,
  decodeWebSocketProtocolEnvelope,
  reduceWebSocketProtocolHealth,
  type WebSocketProtocolObservation,
} from './lib/webSocketProtocolHealth';
import {
  INITIAL_RECONNECT_BACKOFF_STATE,
  RECONNECT_BACKOFF_STABLE_OPEN_MS,
  planReconnectBackoff,
} from './lib/reconnectBackoff';
import {
  decodePrivateReadSnapshot,
  unavailablePrivateRead,
  type PrivateReadSnapshot,
} from './lib/privateRead';
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

export type MarketStateTruth = CompatibilityStateTruth;
export type MarketStateTruthEvent = CompatibilityStateTruthEvent;

export const INITIAL_MARKET_STATE_TRUTH: MarketStateTruth = Object.freeze({
  status: 'LOADING',
  lastSuccessAtMs: null,
  error: null,
});

export function reduceMarketStateTruth(
  current: Readonly<MarketStateTruth>,
  event: Readonly<MarketStateTruthEvent>,
): MarketStateTruth {
  const reduced = reduceCompatibilityStateTruth(current, event);
  if (event.kind === 'FAILURE' && reduced.error === 'Compatibility state refresh failed.') {
    return Object.freeze({ ...reduced, error: 'Market refresh failed.' });
  }
  return reduced;
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
  privateRead: PrivateReadSnapshot;
  privateReadSource: 'PENDING' | 'STATE' | 'FALLBACK';
  privateReadError: string | null;
  markets: MarketRow[];
  marketStatus: CompatibilityStateStatus;
  marketsLastSuccessAtMs: number | null;
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

export type MutationFailureTruthEvent =
  | Readonly<{ kind: 'REJECTED'; failure: ApiFailure }>
  | Readonly<{ kind: 'ACKNOWLEDGED' }>;

export function reduceMutationFailureTruth(
  current: ApiFailure | null,
  event: MutationFailureTruthEvent,
): ApiFailure | null {
  if (event.kind === 'ACKNOWLEDGED') return null;
  return event.failure ?? current;
}

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
    && payload.revision.length <= 256
    && ['LIVE_PUBLIC', 'WIRED', 'BUILT_AND_TESTED', 'IMPORTED', 'SYNTHETIC_ONLY', 'BLOCKED', 'NOT_CONFIGURED', 'UNAVAILABLE', 'MISSING', 'UNKNOWN'].includes(String(payload.truthLabel))
    && ['STOPPED', 'WARMING', 'READY', 'DEGRADED', 'BLOCKED', 'FAILED'].includes(String(payload.overallPosture))
    && (payload.firstRootBlockerComponentId === null
      || (typeof payload.firstRootBlockerComponentId === 'string'
        && payload.firstRootBlockerComponentId.length > 0
        && payload.firstRootBlockerComponentId.length <= 128))
    && Number.isSafeInteger(payload.runtimeGeneration)
    && Number(payload.runtimeGeneration) >= 0
    && Number.isSafeInteger(payload.controlGeneration)
    && Number(payload.controlGeneration) >= 0
    && Number.isSafeInteger(payload.controlRevision)
    && Number(payload.controlRevision) >= 0
    && ['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY'].includes(String(payload.safeMode))
    && typeof payload.killSwitchEngaged === 'boolean'
    && typeof payload.intakePaused === 'boolean';
}

function isDecimalWebSocketCursor(value: unknown): value is string {
  return typeof value === 'string'
    && /^(?:0|[1-9]\d{0,18})$/.test(value)
    && BigInt(value) <= 9_223_372_036_854_775_807n;
}

function isMaterialEventPageMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.type !== 'material-event-page'
      || !message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)) return false;
  const payload = message.payload as Record<string, unknown>;
  if (!isDecimalWebSocketCursor(payload.afterCursor)
      || !isDecimalWebSocketCursor(payload.nextCursor)
      || BigInt(payload.nextCursor) < BigInt(payload.afterCursor)
      || !Array.isArray(payload.events)
      || payload.events.length > 200
      || !payload.events.every((event) => Boolean(event && typeof event === 'object' && !Array.isArray(event)))
      || !['CONTINUOUS', 'GAP_REQUIRES_BACKFILL', 'TRUNCATED_REQUIRES_BACKFILL'].includes(String(payload.continuity))
      || typeof payload.hasMore !== 'boolean') return false;
  const missingFrom = payload.missingFromCursor;
  const missingTo = payload.missingToCursor;
  return (missingFrom === null && missingTo === null)
    || (isDecimalWebSocketCursor(missingFrom)
      && isDecimalWebSocketCursor(missingTo)
      && BigInt(missingFrom) <= BigInt(missingTo));
}

function isPositiveNumericString(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function isBookLevel(value: unknown): value is [string, string] {
  return Array.isArray(value)
    && value.length === 2
    && isPositiveNumericString(value[0])
    && isPositiveNumericString(value[1]);
}

function isLiveBookMessage(value: unknown): value is LiveBookMsg {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (typeof message.symbol !== 'string' || !/^[A-Z0-9]{2,32}$/.test(message.symbol)) return false;
  if (message.type === 'book') {
    if (!Array.isArray(message.bids) || message.bids.length < 1 || message.bids.length > 20
        || !Array.isArray(message.asks) || message.asks.length < 1 || message.asks.length > 20
        || !message.bids.every(isBookLevel) || !message.asks.every(isBookLevel)
        || !Number.isSafeInteger(message.ts) || Number(message.ts) <= 0) return false;
    return Number(message.bids[0][0]) < Number(message.asks[0][0]);
  }
  if (message.type !== 'btrades'
      || !Array.isArray(message.trades)
      || message.trades.length < 1
      || message.trades.length > 400) return false;
  let previousId = -1;
  for (const trade of message.trades) {
    if (!trade || typeof trade !== 'object' || Array.isArray(trade)) return false;
    const row = trade as Record<string, unknown>;
    if (!Number.isSafeInteger(row.id) || Number(row.id) <= previousId
        || !Number.isFinite(row.price) || Number(row.price) <= 0
        || !Number.isFinite(row.qty) || Number(row.qty) <= 0
        || !Number.isSafeInteger(row.time) || Number(row.time) <= 0
        || typeof row.isBuyerMaker !== 'boolean') return false;
    previousId = Number(row.id);
  }
  return true;
}

function isKnownWebSocketEnvelope(value: unknown): boolean {
  return isCanonicalSupervisorDeltaMessage(value)
    || isMaterialEventPageMessage(value)
    || isLiveBookMessage(value);
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

type WatchlistAcknowledgement = Readonly<Pick<AppConfig, 'watchlist'>>;

export type SerializedWatchlistMutationQueue = Readonly<{
  synchronize: (watchlist: readonly string[]) => void;
  enqueue: (symbol: string) => Promise<WatchlistAcknowledgement | null>;
}>;

/**
 * Serializes complete-watchlist writes and keeps an acknowledgement-backed
 * shadow while a batch is pending. The config API does not expose a revision
 * or compare-and-swap token, so sending the next mutation only after the
 * preceding acknowledgement is the client-side ordering authority.
 */
export function createSerializedWatchlistMutationQueue(
  initialWatchlist: readonly string[],
  submit: (watchlist: readonly string[]) => Promise<WatchlistAcknowledgement | null>,
): SerializedWatchlistMutationQueue {
  let acknowledgedWatchlist = [...initialWatchlist];
  let pendingCount = 0;
  let tail: Promise<void> = Promise.resolve();

  const synchronize = (watchlist: readonly string[]) => {
    if (pendingCount === 0) acknowledgedWatchlist = [...watchlist];
  };

  const enqueue = (symbol: string): Promise<WatchlistAcknowledgement | null> => {
    pendingCount += 1;
    const operation = tail.then(async () => {
      const current = acknowledgedWatchlist;
      const next = current.includes(symbol)
        ? current.filter((entry) => entry !== symbol)
        : [...current, symbol];
      const acknowledgement = await submit(Object.freeze([...next]));
      if (acknowledgement) acknowledgedWatchlist = [...acknowledgement.watchlist];
      return acknowledgement;
    });
    tail = operation.then(
      () => { pendingCount -= 1; },
      () => { pendingCount -= 1; },
    );
    return operation;
  };

  return Object.freeze({ synchronize, enqueue });
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ServerState | null>(null);
  const [stateTruth, setStateTruth] = useState<CompatibilityStateTruth>(
    INITIAL_COMPATIBILITY_STATE_TRUTH,
  );
  const [privateRead, setPrivateRead] = useState<PrivateReadSnapshot>(
    () => unavailablePrivateRead('PRIVATE_READ_PENDING'),
  );
  const [privateReadSource, setPrivateReadSource] = useState<'PENDING' | 'STATE' | 'FALLBACK'>('PENDING');
  const [privateReadError, setPrivateReadError] = useState<string | null>(null);
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [marketTruth, setMarketTruth] = useState<MarketStateTruth>(INITIAL_MARKET_STATE_TRUTH);
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
  const privateReadCadenceRef = useRef<(() => void) | null>(null);
  const watchlistMutationQueueRef = useRef<SerializedWatchlistMutationQueue | null>(null);

  // Private snapshots are ordered by the id assigned when their request left
  // the browser, so a slow earlier answer can never overwrite newer account
  // truth no matter which caller (socket delta, cadence, manual refresh) won.
  const privateReadRequestRef = useRef(0);
  const privateReadAppliedRef = useRef(0);
  const nextPrivateReadRequestId = useCallback(() => {
    privateReadRequestRef.current += 1;
    return privateReadRequestRef.current;
  }, []);

  const applyPrivateReadUpdate = useCallback((requestId: number, apply: () => void) => {
    if (requestId <= privateReadAppliedRef.current) return;
    privateReadAppliedRef.current = requestId;
    apply();
  }, []);

  const acceptPrivateReadFromState = useCallback((snapshot: ServerState, requestId: number) => {
    applyPrivateReadUpdate(requestId, () => {
      const decoded = decodePrivateReadSnapshot(snapshot.privateRead);
      if (decoded) {
        setPrivateRead(decoded);
        setPrivateReadSource('STATE');
        setPrivateReadError(null);
        return;
      }
      setPrivateReadSource('FALLBACK');
      if (Object.prototype.hasOwnProperty.call(snapshot, 'privateRead')) {
        setPrivateRead(unavailablePrivateRead('PRIVATE_READ_STATE_CONTRACT_INVALID'));
        setPrivateReadError('PRIVATE_READ_STATE_CONTRACT_INVALID');
      }
    });
  }, [applyPrivateReadUpdate]);

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
    let stableOpenTimer: number | null = null;
    let reconnectBackoff = INITIAL_RECONNECT_BACKOFF_STATE;
    let generation = 0;
    let stateRefreshInFlight = false;
    let stateRefreshQueued = false;
    let stateRefreshController: AbortController | null = null;
    const requestCompatibilityState = (trigger: 'DELTA' | 'CADENCE' = 'DELTA') => {
      if (closed) return;
      if (stateRefreshInFlight) {
        // A cadence tick never queues a second read: the in-flight one already
        // answers it. Only a supervisor delta invalidates a read that started
        // before the delta, so only a delta may queue follow-up work.
        if (trigger === 'DELTA') stateRefreshQueued = true;
        return;
      }
      stateRefreshInFlight = true;
      const requestId = nextPrivateReadRequestId();
      const controller = new AbortController();
      stateRefreshController = controller;
      void fetchJson<ServerState>('/api/state', { cache: 'no-store', signal: controller.signal })
        .then((snapshot) => {
          if (!closed && !controller.signal.aborted) {
            setState(failClosedState(snapshot));
            acceptPrivateReadFromState(snapshot, requestId);
            setStateTruth((current) => reduceCompatibilityStateTruth(current, {
              kind: 'SUCCESS',
              observedAtMs: Date.now(),
            }));
          }
        })
        .catch((cause) => {
          if (!closed && !controller.signal.aborted) {
            setPrivateReadSource((current) => current === 'STATE' ? current : 'FALLBACK');
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
            requestCompatibilityState('DELTA');
          }
        });
    };
    privateReadCadenceRef.current = () => requestCompatibilityState('CADENCE');
    requestCompatibilityState('DELTA');
    const clearRetry = () => {
      if (retry !== null) window.clearTimeout(retry);
      retry = null;
    };
    const clearStableOpenTimer = () => {
      if (stableOpenTimer !== null) window.clearTimeout(stableOpenTimer);
      stableOpenTimer = null;
    };
    const closeCurrent = () => {
      clearStableOpenTimer();
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
      let openedAtMonotonicMs: number | null = null;
      let protocolHealth = INITIAL_WEB_SOCKET_PROTOCOL_HEALTH;
      const applyProtocolObservation = (observation: WebSocketProtocolObservation) => {
        protocolHealth = reduceWebSocketProtocolHealth(protocolHealth, observation);
        if (protocolHealth.status === 'DEGRADED') setConnected(false);
        else if (connectionEstablished) setConnected(true);
        return protocolHealth;
      };
      wsRef.current = ws;
      liveWs = ws;
      ws.onopen = () => {
        if (closed || socketGeneration !== generation || wsRef.current !== ws) return;
        connectionEstablished = true;
        openedAtMonotonicMs = performance.now();
        protocolHealth = INITIAL_WEB_SOCKET_PROTOCOL_HEALTH;
        setConnected(true);
        sendLiveSub(); // re-attach any live book subscription after reconnect
        clearStableOpenTimer();
        stableOpenTimer = window.setTimeout(() => {
          stableOpenTimer = null;
          if (closed || socketGeneration !== generation || wsRef.current !== ws
              || ws.readyState !== WebSocket.OPEN) return;
          reconnectBackoff = INITIAL_RECONNECT_BACKOFF_STATE;
        }, RECONNECT_BACKOFF_STABLE_OPEN_MS);
      };
      ws.onmessage = (msg) => {
        if (closed || socketGeneration !== generation || wsRef.current !== ws) return;
        const decoded = decodeWebSocketProtocolEnvelope(msg.data, isKnownWebSocketEnvelope);
        if (!decoded.ok) {
          const degraded = applyProtocolObservation('INVALID_ENVELOPE');
          if (degraded.reconnectRequired && ws.readyState === WebSocket.OPEN) {
            ws.close(WEB_SOCKET_PROTOCOL_CLOSE_CODE, WEB_SOCKET_PROTOCOL_CLOSE_REASON);
          }
          return;
        }
        applyProtocolObservation('VALID_ENVELOPE');
        const data = decoded.value;
        if (isCanonicalSupervisorDeltaMessage(data)) requestCompatibilityState();
        else if (isLiveBookMessage(data)) {
          for (const fn of liveBookListeners) fn(data);
        }
        // Material-event cursor consumption stays with the existing Product
        // Control Room binding; this compatibility store never advances it.
      };
      ws.onclose = (event) => {
        if (closed || socketGeneration !== generation || wsRef.current !== ws) return;
        setWebSocketCloseDiagnostic((current) => reduceTrustedWebSocketCloseDiagnostic(
          current,
          event,
          socketGeneration,
          connectionEstablished,
        ));
        clearStableOpenTimer();
        wsRef.current = null;
        if (liveWs === ws) liveWs = null;
        setConnected(false);
        const plan = planReconnectBackoff(reconnectBackoff, {
          entropySample: Math.random(),
          openDurationMs: openedAtMonotonicMs === null
            ? null
            : Math.max(0, performance.now() - openedAtMonotonicMs),
        });
        reconnectBackoff = plan.next;
        scheduleConnect(plan.delayMs);
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
      privateReadCadenceRef.current = null;
      reconnectRef.current = null;
      closeCurrent();
      setConnected(false);
    };
  }, [acceptPrivateReadFromState, nextPrivateReadRequestId]);

  // The canonical socket only speaks when supervisor truth changes, so a
  // signed-in account would otherwise age silently behind a delta-free cockpit.
  // This cadence advances the same single-flight state read the socket uses:
  // no second private transport, no overlapping request, and no work at all
  // while the bounded fallback poll owns the source.
  useEffect(() => {
    if (privateReadSource === 'FALLBACK') return;
    const intervalMs = Math.max(5, prefs.dataCadence?.account ?? 10) * 1_000;
    const timer = window.setInterval(() => privateReadCadenceRef.current?.(), intervalMs);
    return () => window.clearInterval(timer);
  }, [prefs.dataCadence?.account, privateReadSource]);

  // The compatibility state is the preferred and normally sole private-read
  // transport. Older/malformed state envelopes activate one bounded fallback
  // poll; accepting state.privateRead stops and aborts that poll immediately.
  useEffect(() => {
    if (privateReadSource !== 'FALLBACK') return;
    let fallbackRequestId = 0;
    const poll = createSettledPoll<unknown>({
      intervalMs: Math.max(5, prefs.dataCadence?.account ?? 10) * 1_000,
      request: (signal) => {
        fallbackRequestId = nextPrivateReadRequestId();
        return fetchJson<unknown>('/api/private-account', { cache: 'no-store', signal });
      },
      onSuccess: (payload) => {
        const decoded = decodePrivateReadSnapshot(payload);
        if (!decoded) throw new Error('PRIVATE_READ_FALLBACK_CONTRACT_INVALID');
        applyPrivateReadUpdate(fallbackRequestId, () => {
          setPrivateRead(decoded);
          setPrivateReadError(null);
        });
      },
      onError: (cause) => {
        const contractInvalid = cause instanceof Error && cause.message === 'PRIVATE_READ_FALLBACK_CONTRACT_INVALID';
        const reason = contractInvalid
          ? 'PRIVATE_READ_FALLBACK_CONTRACT_INVALID'
          : 'PRIVATE_READ_FALLBACK_UNAVAILABLE';
        applyPrivateReadUpdate(fallbackRequestId, () => {
          setPrivateRead(unavailablePrivateRead(reason));
          setPrivateReadError(reason);
        });
      },
    });
    poll.start();
    return poll.stop;
  }, [applyPrivateReadUpdate, nextPrivateReadRequestId, prefs.dataCadence?.account, privateReadSource]);

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
          setMarketTruth((current) => reduceMarketStateTruth(current, {
            kind: 'SUCCESS',
            observedAtMs: Date.now(),
          }));
      },
      onError: (cause) => {
        const error = mutationFailure(cause).message || 'Market refresh failed.';
        setMarketsError(error);
        setMarketTruth((current) => reduceMarketStateTruth(current, {
          kind: 'FAILURE',
          observedAtMs: Date.now(),
          error,
        }));
      },
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
    setMutationError((current) => config
      ? reduceMutationFailureTruth(current, { kind: 'ACKNOWLEDGED' })
      : reduceMutationFailureTruth(current, {
          kind: 'REJECTED',
          failure: error ?? acknowledgementFailure('Configuration acknowledgement was malformed.'),
        }));
    if (config) setState((s) => (s ? failClosedState({ ...s, config }) : s));
    return config;
  }, []);

  if (!watchlistMutationQueueRef.current) {
    watchlistMutationQueueRef.current = createSerializedWatchlistMutationQueue(
      state?.config.watchlist ?? [],
      (watchlist) => saveConfig({ watchlist: [...watchlist] }),
    );
  }
  const watchlistMutationQueue = watchlistMutationQueueRef.current;

  useEffect(() => {
    watchlistMutationQueue.synchronize(state?.config.watchlist ?? []);
  }, [state?.config.watchlist, watchlistMutationQueue]);

  const toggleWatch = useCallback(
    async (symbol: string) => {
      const saved = await watchlistMutationQueue.enqueue(symbol);
      return saved ? null : acknowledgementFailure('The watchlist change was not acknowledged.');
    },
    [watchlistMutationQueue],
  );

  // Read-only browser snapshot refresh retained for compatibility consumers.
  // It never calls the managed-runtime /api/refresh targets: those require the
  // canonical Product preview/digest/revision/receipt protocol.
  const refresh = useCallback(async (): Promise<RefreshResult> => {
    const issues: string[] = [];
    const requestId = nextPrivateReadRequestId();
    try {
      const s = await fetchJson<ServerState>('/api/state');
      setState(failClosedState(s));
      acceptPrivateReadFromState(s, requestId);
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
      if (!Array.isArray(payload.rows)) throw new Error('Invalid market response');
      setMarkets(payload.rows);
      setMarketsUpdatedAt(normalizeMarketSourceTime(payload.updatedAt));
      setMarketsError(null);
      setMarketTruth((current) => reduceMarketStateTruth(current, {
        kind: 'SUCCESS',
        observedAtMs: Date.now(),
      }));
    } catch (cause) {
      issues.push('Market refresh failed');
      const error = mutationFailure(cause).message || 'Market refresh failed.';
      setMarketsError(error);
      setMarketTruth((current) => reduceMarketStateTruth(current, {
        kind: 'FAILURE',
        observedAtMs: Date.now(),
        error,
      }));
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
  }, [acceptPrivateReadFromState, nextPrivateReadRequestId]);

  const store: Store = {
    state,
    stateStatus: stateTruth.status,
    stateLastSuccessAtMs: stateTruth.lastSuccessAtMs,
    stateError: stateTruth.error,
    privateRead,
    privateReadSource,
    privateReadError,
    markets,
    marketStatus: marketTruth.status,
    marketsLastSuccessAtMs: marketTruth.lastSuccessAtMs,
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
    toggleWatch,
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

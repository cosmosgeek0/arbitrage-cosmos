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
import type {
  AppConfig,
  MarketRow,
  PreviewResult,
  ServerState,
} from './types';

export type RefreshResult = {
  ok: boolean;
  issues: string[];
  ts?: number;
};

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
  markets: MarketRow[];
  marketsUpdatedAt: number | null;
  marketsError: string | null;
  mutationError: ApiFailure | null;
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
  preview: (intent: Record<string, unknown>) => Promise<PreviewResult | null>;
}

const StoreContext = createContext<Store | null>(null);

// ---- live order-book stream (Token Detail) -------------------------------
// Rides the same /ws socket as state broadcasts. One symbol at a time; the
// server opens a Binance depth20@100ms + aggTrade stream while subscribed.
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

function failClosedState(serverState: ServerState): ServerState {
  const config = failClosedConfig(serverState.config);
  return {
    ...serverState,
    mode: config.killSwitch ? 'HALTED' : 'MANUAL',
    config,
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
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [marketsUpdatedAt, setMarketsUpdatedAt] = useState<number | null>(null);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<ApiFailure | null>(null);
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
  const [, bumpFx] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<(() => void) | null>(null);

  // Display currency → live FX rate (USD base). USD is identity; others fetch.
  useEffect(() => {
    const cur = prefs.currency || 'USD';
    const sym = CURRENCIES[cur]?.symbol ?? '$';
    if (cur === 'USD') {
      setFxRate(1, '$');
      bumpFx((n) => n + 1);
      return;
    }
    const poll = createSettledPoll<{ rates?: Record<string, number> }>({
      intervalMs: Math.max(0.5, prefs.dataCadence?.fx ?? 300) * 1_000,
      request: (signal) => fetchJson('/api/fx', { signal }),
      onSuccess: (d) => {
        if (!d?.rates) return;
        const rate = d.rates[cur];
        if (rate) {
          setFxRate(rate, sym);
          bumpFx((n) => n + 1);
        }
      },
    });
    poll.start();
    return poll.stop;
  }, [prefs.currency, prefs.dataCadence?.fx]);

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
    void fetchJson<ServerState>('/api/state')
      .then((s) => setState(failClosedState(s)))
      .catch(() => undefined);

    let closed = false;
    let retry: number | null = null;
    let generation = 0;
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
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      liveWs = ws;
      ws.onopen = () => {
        if (closed || socketGeneration !== generation || wsRef.current !== ws) return;
        setConnected(true);
        sendLiveSub(); // re-attach any live book subscription after reconnect
      };
      ws.onmessage = (msg) => {
        if (closed || socketGeneration !== generation || wsRef.current !== ws) return;
        try {
          const data = JSON.parse(msg.data as string) as { type: string; payload: unknown };
          if (data.type === 'state') setState(failClosedState(data.payload as ServerState));
          else if (data.type === 'book' || data.type === 'btrades') {
            for (const fn of liveBookListeners) fn(data as unknown as LiveBookMsg);
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        if (closed || socketGeneration !== generation || wsRef.current !== ws) return;
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
          setMarketsUpdatedAt(payload.updatedAt ?? Date.now());
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

  // In-place public/local recovery for the bottom Connection Control: rebuild
  // the managed market runtime and browser socket, then fan a refresh signal to
  // page-owned public sources. Private account recovery is intentionally absent.
  const refresh = useCallback(async (): Promise<RefreshResult> => {
    const issues: string[] = [];
    let health: RefreshResult | null = null;
    try {
      const result = await post<RefreshResult>('/api/refresh', { target: 'market' });
      health = result.data;
      setMutationError(result.error);
      if (!health) issues.push(result.error?.message ?? 'Server refresh request failed');
    } catch {
      issues.push('Server refresh request failed');
    }
    try {
      const s = await fetchJson<ServerState>('/api/state');
      setState(failClosedState(s));
    } catch {
      issues.push('State snapshot failed');
    }
    try {
      const payload = await fetchJson<{ updatedAt?: number; rows: MarketRow[] }>('/api/markets');
      if (Array.isArray(payload.rows)) {
        setMarkets(payload.rows);
        setMarketsUpdatedAt(payload.updatedAt ?? Date.now());
        setMarketsError(null);
      }
    } catch {
      issues.push('Market refresh failed');
    }
    // A reset is explicit: rebuild the browser's cockpit socket too, then
    // re-attach any active token book subscription on open.
    reconnectRef.current?.();
    setDataNonce((n) => n + 1);
    fireRefresh();
    if (health?.issues?.length) for (const i of health.issues) issues.push(i);
    return {
      ok: issues.length === 0,
      issues,
      ts: health?.ts ?? Date.now(),
    };
  }, []);

  const store: Store = {
    state,
    markets,
    marketsUpdatedAt,
    marketsError,
    mutationError,
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
    preview: useCallback(async (intent) => {
      const result = await post<PreviewResult>('/api/trade/preview', intent);
      setMutationError(result.error);
      return result.data;
    }, []),
  };

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
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

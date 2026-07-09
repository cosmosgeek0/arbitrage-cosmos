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
import { setBasisBps, setDisplayUtc, setFxRate } from './format';
import { fireRefresh } from './lib/refresh';
import type {
  AppConfig,
  MarketRow,
  PreviewResult,
  SendResult,
  ServerState,
} from './types';

export type RefreshResult = {
  ok: boolean;
  issues: string[];
  ts?: number;
  binanceConnected?: boolean;
  feedsOk?: boolean;
  keysPresent?: boolean;
};

// 'orders' | 'positions' | 'fills' | 'pnl' are deep links that all
// render the merged Execution page (each id = its active tab), so existing
// setPage(...) call sites keep working. 'detail' opens from Markets rows only.
export type Page =
  | 'dashboard'
  | 'account'
  | 'wallets'
  | 'markets'
  | 'detail'
  | 'loans'
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
  | 'news'
  | 'calendar';

const PAGE_IDS: Page[] = [
  'dashboard', 'account', 'wallets', 'markets', 'detail', 'loans', 'orders',
  'positions', 'fills', 'pnl', 'strategies', 'volume', 'opportunities', 'risk', 'ledger', 'system',
  'news', 'calendar',
];

interface Store {
  state: ServerState | null;
  markets: MarketRow[];
  marketsUpdatedAt: number | null;
  marketsError: string | null;
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
  toggleWatch: (symbol: string) => Promise<void>;
  saveConfig: (patch: Partial<AppConfig>) => Promise<AppConfig | null>;
  setKill: (on: boolean) => Promise<void>;
  setLive: (on: boolean) => Promise<void>;
  preview: (intent: Record<string, unknown>) => Promise<PreviewResult | null>;
  testOrder: (intent: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  sendLive: (intent: Record<string, unknown>, confirmSymbol: string) => Promise<SendResult>;
  cancelOrder: (symbol: string, orderId: number) => Promise<{ ok: boolean; error?: string }>;
  cancelAll: (symbol: string) => Promise<{ ok: boolean; error?: string }>;
  approveProposal: (id: number) => Promise<void>;
  importFills: (symbol: string) => Promise<{ imported?: number; error?: string }>;
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

async function post<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ServerState | null>(null);
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [marketsUpdatedAt, setMarketsUpdatedAt] = useState<number | null>(null);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(() => {
    applyPrefs();
    const p = getPrefs();
    setDisplayUtc(p.timezone === 'utc');
    setBasisBps(p.basisUnit === 'bps');
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
  const connectRef = useRef<(() => void) | null>(null);

  // Display currency → live FX rate (USD base). USD is identity; others fetch.
  useEffect(() => {
    const cur = prefs.currency || 'USD';
    const sym = CURRENCIES[cur]?.symbol ?? '$';
    if (cur === 'USD') {
      setFxRate(1, '$');
      bumpFx((n) => n + 1);
      return;
    }
    let alive = true;
    const load = () => fetch('/api/fx')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { rates?: Record<string, number> } | null) => {
        if (!alive || !d?.rates) return;
        const rate = d.rates[cur];
        if (rate) {
          setFxRate(rate, sym);
          bumpFx((n) => n + 1);
        }
      })
      .catch(() => undefined);
    void load();
    const t = window.setInterval(load, Math.max(0.5, prefs.dataCadence?.fx ?? 300) * 1000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [prefs.currency, prefs.dataCadence?.fx]);

  useEffect(() => onPrefs((p) => {
    setPrefs(p);
    setDisplayUtc(p.timezone === 'utc');
    setBasisBps(p.basisUnit === 'bps');
  }), []);

  // follow system theme changes when theme = system
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => {
      if (getPrefs().theme === 'system') applyPrefs();
    };
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  useEffect(() => {
    void fetch('/api/state')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setState(s as ServerState))
      .catch(() => undefined);

    let closed = false;
    let retry: number | undefined;
    function connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      liveWs = ws;
      ws.onopen = () => {
        setConnected(true);
        sendLiveSub(); // re-attach any live book subscription after reconnect
      };
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data as string) as { type: string; payload: unknown };
          if (data.type === 'state') setState(data.payload as ServerState);
          else if (data.type === 'book' || data.type === 'btrades') {
            for (const fn of liveBookListeners) fn(data as unknown as LiveBookMsg);
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = window.setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }
    connectRef.current = connect;
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  // markets poll at the preferred source cadence. `refreshSec` is retained as
  // the legacy market value; `dataCadence.market` is the new source map.
  useEffect(() => {
    const marketSec = prefs.dataCadence?.market ?? prefs.refreshSec;
    const load = () =>
      fetch('/api/markets')
        .then((r) => (r.ok ? r.json() : null))
        .then((m) => {
          if (!m) return;
          const payload = m as { updatedAt?: number; rows: MarketRow[] };
          setMarkets(payload.rows);
          setMarketsUpdatedAt(payload.updatedAt ?? Date.now());
          setMarketsError(null);
        })
        .catch(() => setMarketsError('market refresh failed'));
    void load();
    const t = setInterval(load, Math.max(0.5, marketSec) * 1000);
    return () => clearInterval(t);
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
    const next = await post<AppConfig>('/api/config', patch);
    if (next) setState((s) => (s ? { ...s, config: next, mode: next.killSwitch ? 'HALTED' : next.liveTradingEnabled ? 'LIVE_ARMED' : 'MANUAL' } : s));
    return next;
  }, []);

  // In-place "refresh everything" for the top-bar button: force a server-side
  // Binance/account resync, re-pull the shared snapshot + markets, reconnect a
  // dead socket, and fan a signal out to per-page fetchers — all WITHOUT a page
  // reload. Returns a health verdict so the button can go green or red.
  const refresh = useCallback(async (): Promise<RefreshResult> => {
    const issues: string[] = [];
    let health: RefreshResult | null = null;
    try {
      health = await post<RefreshResult>('/api/refresh', {});
    } catch {
      issues.push('Server refresh request failed');
    }
    try {
      const s = await fetch('/api/state').then((r) => (r.ok ? r.json() : null));
      if (s) setState(s as ServerState);
      else issues.push('State snapshot unavailable');
    } catch {
      issues.push('State snapshot failed');
    }
    try {
      const m = await fetch('/api/markets').then((r) => (r.ok ? r.json() : null));
      if (m) {
        const payload = m as { updatedAt?: number; rows: MarketRow[] };
        setMarkets(payload.rows);
        setMarketsUpdatedAt(payload.updatedAt ?? Date.now());
        setMarketsError(null);
      }
    } catch {
      issues.push('Market refresh failed');
    }
    // Reconnect the live socket if it dropped.
    const ws = wsRef.current;
    if (!ws || (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING)) {
      connectRef.current?.();
    }
    setDataNonce((n) => n + 1);
    fireRefresh();
    if (health?.issues?.length) for (const i of health.issues) issues.push(i);
    return {
      ok: issues.length === 0,
      issues,
      ts: health?.ts ?? Date.now(),
      binanceConnected: health?.binanceConnected,
      feedsOk: health?.feedsOk,
      keysPresent: health?.keysPresent,
    };
  }, []);

  const store: Store = {
    state,
    markets,
    marketsUpdatedAt,
    marketsError,
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
        await saveConfig({ watchlist: next });
      },
      [state, saveConfig]
    ),
    saveConfig,
    setKill: useCallback(async (on) => {
      const next = await post<{ killSwitch: boolean }>('/api/kill', { on });
      if (next) setState((s) => (s ? { ...s, config: { ...s.config, killSwitch: next.killSwitch }, mode: next.killSwitch ? 'HALTED' : s.config.liveTradingEnabled ? 'LIVE_ARMED' : 'MANUAL' } : s));
    }, []),
    setLive: useCallback(async (on) => {
      const next = await post<{ liveTradingEnabled: boolean }>('/api/live', { on });
      if (next) setState((s) => (s ? { ...s, config: { ...s.config, liveTradingEnabled: next.liveTradingEnabled }, mode: s.config.killSwitch ? 'HALTED' : next.liveTradingEnabled ? 'LIVE_ARMED' : 'MANUAL' } : s));
    }, []),
    preview: useCallback((intent) => post<PreviewResult>('/api/trade/preview', intent), []),
    testOrder: useCallback(
      async (intent) =>
        (await post<{ ok: boolean; error?: string }>('/api/trade/test', intent)) ?? { ok: false, error: 'network error' },
      []
    ),
    sendLive: useCallback(
      async (intent, confirmSymbol) =>
        (await post<SendResult>('/api/trade/send', { ...intent, confirmSymbol })) ?? { sent: false, error: 'network error' },
      []
    ),
    cancelOrder: useCallback(
      async (symbol, orderId) =>
        (await post<{ ok: boolean; error?: string }>('/api/orders/cancel', { symbol, orderId })) ?? {
          ok: false,
          error: 'network error',
        },
      []
    ),
    cancelAll: useCallback(
      async (symbol) =>
        (await post<{ ok: boolean; error?: string }>('/api/orders/cancel-all', { symbol })) ?? {
          ok: false,
          error: 'network error',
        },
      []
    ),
    approveProposal: useCallback(
      async (id) => {
        // approval is server-side; with execution removed the returned intent
        // is informational only — orders go through Binance itself
        await post(`/api/proposals/${id}/approve`, {});
      },
      []
    ),
    importFills: useCallback(
      async (symbol) =>
        (await post<{ imported?: number; error?: string }>('/api/fills/import', { symbol })) ?? { error: 'network error' },
      []
    ),
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

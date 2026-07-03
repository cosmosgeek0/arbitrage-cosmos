import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { applyPrefs, getPrefs, onPrefs, resolvedTheme, setPref, type Prefs } from './lib/prefs';
import { setBasisBps, setDisplayUtc } from './format';
import type {
  AppConfig,
  MarketRow,
  PreviewResult,
  SendResult,
  ServerState,
  TicketPrefill,
} from './types';

export type Page =
  | 'dashboard'
  | 'account'
  | 'wallets'
  | 'markets'
  | 'detail'
  | 'loans'
  | 'trade'
  | 'orders'
  | 'positions'
  | 'fills'
  | 'pnl'
  | 'strategies'
  | 'opportunities'
  | 'risk'
  | 'ledger'
  | 'system'
  | 'settings';

const PAGE_IDS: Page[] = [
  'dashboard', 'account', 'wallets', 'markets', 'detail', 'loans', 'trade', 'orders',
  'positions', 'fills', 'pnl', 'strategies', 'opportunities', 'risk', 'ledger', 'system', 'settings',
];

interface Store {
  state: ServerState | null;
  markets: MarketRow[];
  marketsUpdatedAt: number | null;
  marketsError: string | null;
  connected: boolean;
  page: Page;
  setPage: (p: Page) => void;
  detailSymbol: string;
  openDetail: (symbol: string) => void;
  openLedger: (symbol: string) => void;
  prefs: Prefs;
  updatePref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  ticket: TicketPrefill | null;
  openTicket: (t: TicketPrefill) => void;
  clearTicket: () => void;
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
  const [page, setPage] = useState<Page>(() =>
    PAGE_IDS.includes(getPrefs().defaultPage as Page) ? (getPrefs().defaultPage as Page) : 'dashboard'
  );
  const [detailSymbol, setDetailSymbol] = useState('BTCUSDT');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [ticket, setTicket] = useState<TicketPrefill | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

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
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  // markets poll at the preferred refresh rate
  useEffect(() => {
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
    const t = setInterval(load, Math.max(3, prefs.refreshSec) * 1000);
    return () => clearInterval(t);
  }, [prefs.refreshSec]);

  const openTicket = useCallback((t: TicketPrefill) => {
    setTicket(t);
    setPage('trade');
    window.scrollTo({ top: 0 });
  }, []);

  const openDetail = useCallback((symbol: string) => {
    setDetailSymbol(symbol);
    setPage('detail');
    window.scrollTo({ top: 0 });
  }, []);

  const changePage = useCallback((p: Page) => {
    setPage(p);
    window.scrollTo({ top: 0 });
  }, []);

  const saveConfig = useCallback((patch: Partial<AppConfig>) => post<AppConfig>('/api/config', patch), []);

  const store: Store = {
    state,
    markets,
    marketsUpdatedAt,
    marketsError,
    connected,
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
    ticket,
    openTicket,
    clearTicket: useCallback(() => setTicket(null), []),
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
      await post('/api/kill', { on });
    }, []),
    setLive: useCallback(async (on) => {
      await post('/api/live', { on });
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
        const res = await post<{ intent: TicketPrefill }>(`/api/proposals/${id}/approve`, {});
        if (res?.intent) openTicket({ ...res.intent, source: 'proposal' });
      },
      [openTicket]
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

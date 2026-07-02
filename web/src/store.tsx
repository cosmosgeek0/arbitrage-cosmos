import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AppConfig,
  PreviewResult,
  SendResult,
  ServerState,
  TicketPrefill,
} from './types';

export type Page =
  | 'dashboard'
  | 'account'
  | 'trade'
  | 'strategies'
  | 'opportunities'
  | 'orders'
  | 'positions'
  | 'fills'
  | 'pnl'
  | 'risk'
  | 'ledger'
  | 'settings';

interface Store {
  state: ServerState | null;
  connected: boolean;
  page: Page;
  setPage: (p: Page) => void;
  ticket: TicketPrefill | null;
  openTicket: (t: TicketPrefill) => void;
  clearTicket: () => void;
  saveConfig: (patch: Partial<AppConfig>) => Promise<AppConfig | null>;
  setKill: (on: boolean) => Promise<void>;
  setLive: (on: boolean) => Promise<void>;
  preview: (intent: Record<string, unknown>) => Promise<PreviewResult | null>;
  testOrder: (intent: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  sendLive: (intent: Record<string, unknown>, confirmSymbol: string) => Promise<SendResult>;
  cancelOrder: (symbol: string, orderId: number) => Promise<{ ok: boolean; error?: string }>;
  approveProposal: (id: number) => Promise<void>;
  importFills: (symbol: string) => Promise<{ imported?: number; error?: string }>;
}

const StoreContext = createContext<Store | null>(null);

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
  const [connected, setConnected] = useState(false);
  const [page, setPage] = useState<Page>('dashboard');
  const [ticket, setTicket] = useState<TicketPrefill | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

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
      ws.onopen = () => setConnected(true);
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data as string) as { type: string; payload: unknown };
          if (data.type === 'state') setState(data.payload as ServerState);
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

  const openTicket = useCallback((t: TicketPrefill) => {
    setTicket(t);
    setPage('trade');
  }, []);

  const store: Store = {
    state,
    connected,
    page,
    setPage,
    ticket,
    openTicket,
    clearTicket: useCallback(() => setTicket(null), []),
    saveConfig: useCallback((patch) => post<AppConfig>('/api/config', patch), []),
    setKill: useCallback(async (on) => {
      await post('/api/kill', { on });
    }, []),
    setLive: useCallback(async (on) => {
      await post('/api/live', { on });
    }, []),
    preview: useCallback((intent) => post<PreviewResult>('/api/trade/preview', intent), []),
    testOrder: useCallback(
      async (intent) => (await post<{ ok: boolean; error?: string }>('/api/trade/test', intent)) ?? { ok: false, error: 'network error' },
      []
    ),
    sendLive: useCallback(
      async (intent, confirmSymbol) =>
        (await post<SendResult>('/api/trade/send', { ...intent, confirmSymbol })) ?? {
          sent: false,
          error: 'network error',
        },
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
    approveProposal: useCallback(
      async (id) => {
        const res = await post<{ intent: TicketPrefill }>(`/api/proposals/${id}/approve`, {});
        if (res?.intent) openTicket({ ...res.intent, source: 'proposal' });
      },
      [openTicket]
    ),
    importFills: useCallback(
      async (symbol) =>
        (await post<{ imported?: number; error?: string }>('/api/fills/import', { symbol })) ?? {
          error: 'network error',
        },
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

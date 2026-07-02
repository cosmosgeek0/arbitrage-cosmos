import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AppConfig, LedgerEvent, Snapshot, SignalsResp } from './types';

interface Store {
  snap: Snapshot | null;
  signals: SignalsResp | null;
  events: LedgerEvent[];
  config: AppConfig | null;
  connected: boolean;
  saveConfig: (patch: Partial<AppConfig>) => Promise<void>;
  setKill: (on: boolean) => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [signals, setSignals] = useState<SignalsResp | null>(null);
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const refreshSignals = useCallback(async () => {
    const s = await getJson<SignalsResp>('/api/signals');
    if (s) setSignals(s);
  }, []);

  const refreshConfig = useCallback(async () => {
    const c = await getJson<AppConfig>('/api/config');
    if (c) setConfig(c);
  }, []);

  useEffect(() => {
    void getJson<Snapshot>('/api/market').then((m) => m && setSnap(m));
    void refreshSignals();
    void refreshConfig();
    void getJson<LedgerEvent[]>('/api/events?limit=100').then((e) => e && setEvents(e));

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
          if (data.type === 'market') {
            setSnap(data.payload as Snapshot);
          } else if (data.type === 'event') {
            const ev = data.payload as LedgerEvent;
            setEvents((prev) => [ev, ...prev].slice(0, 200));
            if (ev.kind.startsWith('signal.')) void refreshSignals();
            if (ev.kind === 'killswitch' || ev.kind === 'config.change') void refreshConfig();
          }
        } catch {
          // ignore malformed frames
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
  }, [refreshSignals, refreshConfig]);

  const saveConfig = useCallback(async (patch: Partial<AppConfig>) => {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) setConfig((await res.json()) as AppConfig);
  }, []);

  const setKill = useCallback(
    async (on: boolean) => {
      await fetch('/api/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on }),
      });
      await refreshConfig();
    },
    [refreshConfig]
  );

  return (
    <StoreContext.Provider value={{ snap, signals, events, config, connected, saveConfig, setKill }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore outside provider');
  return ctx;
}

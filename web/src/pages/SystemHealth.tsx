import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { Group, GRow, StatePill } from '../components/ui';
import {
  IconBook,
  IconBrain,
  IconChart,
  IconPulse,
  IconShield,
  IconWallet,
  IconWifi,
} from '../components/Icons';
import { timeAgo } from '../format';

interface SystemInfo {
  uptimeSec: number;
  version: string;
  env: string;
  feeds: Record<string, string>;
  pairs: number;
  binance: {
    keysPresent: boolean;
    connected: boolean;
    lastSyncTs: number | null;
    lastError: string | null;
    userStream: string;
  };
  restLatencyMs: number | null;
  serverTimeDiffMs: number | null;
  usedWeight1m: number | null;
  usedWeightTs: number | null;
  lastScannerTickTs: number | null;
  lastOrdersSyncTs: number | null;
  dbOk: boolean;
  killSwitch: boolean;
  liveTradingEnabled: boolean;
  cfUser: string | null;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${sec % 60}s`;
}

const tone = (s: string): 'ok' | 'bad' | 'warn' | 'idle' =>
  s === 'live' || s === 'open' ? 'ok' : s === 'connecting' ? 'warn' : s === 'closed' || s === 'failed' ? 'bad' : 'idle';

export function SystemHealth() {
  const { connected } = useStore();
  const [info, setInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    const load = () =>
      fetch('/api/system')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setInfo(d as SystemInfo))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  if (!info) return <div className="container page page-narrow"><div className="empty-state">Reading system state…</div></div>;

  const comp: { icon: ReactNode; color: string; label: string; sub?: string; status: string; value: string }[] = [
    {
      icon: <IconPulse />,
      color: '#2a7de0',
      label: 'Dashboard ↔ engine WebSocket',
      sub: 'live state pushed every 2s',
      status: connected ? 'live' : 'closed',
      value: connected ? 'live' : 'reconnecting…',
    },
    ...Object.entries(info.feeds).map(([name, s]) => ({
      icon: <IconWifi />,
      color: '#0a9b64',
      label: `Binance ${name}`,
      sub: name.includes('markprice') ? 'tiered /market host (legacy fstream is dead)' : 'public market stream',
      status: s,
      value: s,
    })),
    {
      icon: <IconWallet />,
      color: '#e0a02a',
      label: 'Binance account REST',
      sub: '30s polling cadence',
      status: info.binance.keysPresent ? (info.binance.connected ? 'live' : 'closed') : 'idle',
      value: info.binance.keysPresent
        ? info.binance.connected
          ? `synced ${timeAgo(info.binance.lastSyncTs)}`
          : `failing: ${info.binance.lastError ?? 'unknown'}`
        : 'no keys',
    },
    {
      icon: <IconWifi />,
      color: '#8257e0',
      label: 'User data stream',
      sub: 'optional — polling is the guaranteed path',
      status: info.binance.userStream === 'open' ? 'live' : 'idle',
      value: info.binance.userStream,
    },
    {
      icon: <IconBrain />,
      color: '#0aa5a5',
      label: 'Strategy loop',
      sub: `${info.pairs} pairs scanned every 2s`,
      status: info.lastScannerTickTs && Date.now() - info.lastScannerTickTs < 30_000 ? 'live' : 'closed',
      value: info.lastScannerTickTs ? `tick ${timeAgo(info.lastScannerTickTs)}` : 'never',
    },
    {
      icon: <IconShield />,
      color: '#e0414b',
      label: 'Risk engine',
      sub: 'in-process, runs before every send',
      status: 'live',
      value: info.killSwitch ? 'gating · halted' : info.liveTradingEnabled ? 'gating · live armed' : 'gating · manual',
    },
    {
      icon: <IconBook />,
      color: '#697079',
      label: 'Ledger (SQLite)',
      sub: 'append-only audit store',
      status: info.dbOk ? 'live' : 'closed',
      value: info.dbOk ? 'writable' : 'WRITE FAILURE',
    },
  ];

  return (
    <div className="container page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">System Health</h1>
          <div className="page-sub">
            v{info.version} · {info.env} · up {fmtUptime(info.uptimeSec)}
            {info.cfUser ? ` · ${info.cfUser} (Cloudflare Access)` : ''}
          </div>
        </div>
      </div>

      <div className="stats" style={{ marginTop: 4 }}>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-k">REST latency</div>
          <div className="stat-v num">{info.restLatencyMs !== null ? `${info.restLatencyMs}ms` : '—'}</div>
          <div className="stat-d">api.binance.com round trip</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-k">Clock drift</div>
          <div className={`stat-v num ${info.serverTimeDiffMs !== null && Math.abs(info.serverTimeDiffMs) > 1000 ? 'red' : ''}`}>
            {info.serverTimeDiffMs !== null ? `${info.serverTimeDiffMs}ms` : '—'}
          </div>
          <div className="stat-d">vs Binance server (need &lt;10s)</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-k">Rate-limit weight</div>
          <div className="stat-v num">{info.usedWeight1m !== null ? `${info.usedWeight1m}` : '—'}<span className="muted" style={{ fontSize: 13 }}> / 6000</span></div>
          <div className="stat-d">{info.usedWeightTs ? `signed calls · ${timeAgo(info.usedWeightTs)}` : 'no signed call yet'}</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-k">Orders sync</div>
          <div className="stat-v num" style={{ fontSize: 18 }}>{info.lastOrdersSyncTs ? timeAgo(info.lastOrdersSyncTs) : '—'}</div>
          <div className="stat-d">open-orders cache</div>
        </div>
      </div>

      <Group title="Components">
        {comp.map((c) => (
          <GRow
            key={c.label}
            icon={c.icon}
            color={c.color}
            label={c.label}
            sub={c.sub}
            control={<StatePill tone={tone(c.status)}>{c.value}</StatePill>}
          />
        ))}
      </Group>
    </div>
  );
}

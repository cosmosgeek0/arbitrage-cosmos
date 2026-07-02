import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { StatusDot } from '../components/ui';
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

  const rows: { k: string; status: string; v: string; sub?: string }[] = [
    {
      k: 'Dashboard ↔ engine WebSocket',
      status: connected ? 'live' : 'closed',
      v: connected ? 'live · state every 2s' : 'reconnecting…',
    },
    ...Object.entries(info.feeds).map(([name, s]) => ({
      k: `Binance ${name}`,
      status: s,
      v: s,
      sub: name.includes('markprice') ? 'tiered /market host (legacy fstream is dead)' : undefined,
    })),
    {
      k: 'Binance account REST',
      status: info.binance.keysPresent ? (info.binance.connected ? 'live' : 'closed') : 'none',
      v: info.binance.keysPresent
        ? info.binance.connected
          ? `synced ${timeAgo(info.binance.lastSyncTs)}`
          : `failing: ${info.binance.lastError ?? 'unknown'}`
        : 'no keys configured',
      sub: '30s polling cadence',
    },
    {
      k: 'User data stream',
      status: info.binance.userStream === 'open' ? 'live' : 'none',
      v: info.binance.userStream,
      sub: 'optional — polling is the guaranteed path',
    },
    {
      k: 'Strategy loop',
      status: info.lastScannerTickTs && Date.now() - info.lastScannerTickTs < 30_000 ? 'live' : 'closed',
      v: info.lastScannerTickTs ? `last tick ${timeAgo(info.lastScannerTickTs)}` : 'never ticked',
      sub: `${info.pairs} pairs scanned every 2s`,
    },
    {
      k: 'Risk engine',
      status: 'live',
      v: info.killSwitch ? 'gating (kill switch ON)' : info.liveTradingEnabled ? 'gating (live armed)' : 'gating (manual)',
      sub: 'in-process, runs before every send',
    },
    {
      k: 'Ledger (SQLite)',
      status: info.dbOk ? 'live' : 'closed',
      v: info.dbOk ? 'writable' : 'WRITE FAILURE',
    },
  ];

  return (
    <div className="container page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">System Health</h1>
          <div className="page-sub">
            v{info.version} · {info.env} · up {fmtUptime(info.uptimeSec)}
            {info.cfUser ? ` · signed in as ${info.cfUser} (Cloudflare Access)` : ''}
          </div>
        </div>
      </div>

      <div className="metric-strip">
        <div className="metric">
          <span className="k">REST latency</span>
          <span className="v num">{info.restLatencyMs !== null ? `${info.restLatencyMs}ms` : '—'}</span>
          <span className="s">api.binance.com round trip</span>
        </div>
        <div className="metric">
          <span className="k">Clock drift</span>
          <span className={`v num ${info.serverTimeDiffMs !== null && Math.abs(info.serverTimeDiffMs) > 1000 ? 'down' : ''}`}>
            {info.serverTimeDiffMs !== null ? `${info.serverTimeDiffMs}ms` : '—'}
          </span>
          <span className="s">vs Binance server time (signed requests need &lt;10s)</span>
        </div>
        <div className="metric">
          <span className="k">Rate-limit weight</span>
          <span className="v num">{info.usedWeight1m !== null ? `${info.usedWeight1m} / 6000` : '—'}</span>
          <span className="s">{info.usedWeightTs ? `as of ${timeAgo(info.usedWeightTs)} (signed calls only)` : 'no signed call yet'}</span>
        </div>
        <div className="metric">
          <span className="k">Orders sync</span>
          <span className="v num">{info.lastOrdersSyncTs ? timeAgo(info.lastOrdersSyncTs) : '—'}</span>
          <span className="s">open-orders cache</span>
        </div>
      </div>

      <div className="sec-head">
        <h2 className="sec-title">Components</h2>
        <span className="sec-note">refreshes every 10s</span>
      </div>
      {rows.map((r) => (
        <div key={r.k} className="xrow">
          <StatusDot status={r.status} />
          <span>
            <div className="k">{r.k}</div>
            {r.sub && <div className="t">{r.sub}</div>}
          </span>
          <span className="v muted small">{r.v}</span>
        </div>
      ))}
    </div>
  );
}

/* System Health is the cockpit source monitor: every status explains whether
   account truth, market freshness, risk gating, or ledger writes can be trusted. */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { StatePill } from '../components/ui';
import {
  IconAlert,
  IconBook,
  IconBrain,
  IconChart,
  IconClock,
  IconKey,
  IconList,
  IconPulse,
  IconRadar,
  IconRefresh,
  IconShield,
  IconTicket,
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

type Tone = 'ok' | 'bad' | 'warn' | 'idle';

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${sec % 60}s`;
}

const tone = (s: string): Tone =>
  s === 'live' || s === 'open' ? 'ok' : s === 'connecting' ? 'warn' : s === 'closed' || s === 'failed' ? 'bad' : 'idle';

function ageTone(ts: number | null, freshMs: number): Tone {
  if (!ts) return 'idle';
  const age = Date.now() - ts;
  if (age <= freshMs) return 'ok';
  if (age <= freshMs * 3) return 'warn';
  return 'bad';
}

function latencyTone(ms: number | null): Tone {
  if (ms === null) return 'idle';
  if (ms <= 500) return 'ok';
  if (ms <= 1500) return 'warn';
  return 'bad';
}

function driftTone(ms: number | null): Tone {
  if (ms === null) return 'idle';
  const abs = Math.abs(ms);
  if (abs <= 1000) return 'ok';
  if (abs <= 5000) return 'warn';
  return 'bad';
}

function weightTone(weight: number | null): Tone {
  if (weight === null) return 'idle';
  if (weight >= 4800) return 'bad';
  if (weight >= 3000) return 'warn';
  return 'ok';
}

function msLabel(ms: number | null): string {
  return ms === null ? '-' : `${ms}ms`;
}

function HealthMetric({
  icon,
  label,
  value,
  sub,
  tone: metricTone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub: ReactNode;
  tone: Tone;
}) {
  return (
    <div className={`sys-metric ${metricTone}`}>
      <span className="sys-metric-icon">{icon}</span>
      <span>
        <em>{label}</em>
        <b className="num">{value}</b>
        <small>{sub}</small>
      </span>
    </div>
  );
}

function ImpactCard({
  icon,
  title,
  value,
  detail,
  tone: cardTone,
  action,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  value: ReactNode;
  detail: string;
  tone: Tone;
  action: string;
  onClick: () => void;
}) {
  return (
    <button className={`sys-impact-card ${cardTone}`} type="button" onClick={onClick}>
      <span className="sys-impact-icon">{icon}</span>
      <span className="sys-impact-copy">
        <span>{title}</span>
        <b>{value}</b>
        <em>{detail}</em>
      </span>
      <span className="sys-impact-action">{action}</span>
    </button>
  );
}

function SourceRow({
  icon,
  label,
  sub,
  value,
  tone: rowTone,
}: {
  icon: ReactNode;
  label: string;
  sub: ReactNode;
  value: ReactNode;
  tone: Tone;
}) {
  return (
    <div className={`sys-source-row ${rowTone}`}>
      <span className="sys-source-icon">{icon}</span>
      <span className="sys-source-copy">
        <b>{label}</b>
        <em>{sub}</em>
      </span>
      <StatePill tone={rowTone}>{value}</StatePill>
    </div>
  );
}

function CheckStep({ n, label, detail, tone: stepTone }: { n: string; label: string; detail: string; tone: Tone }) {
  return (
    <div className={`sys-check-step ${stepTone}`}>
      <i>{n}</i>
      <span>
        <b>{label}</b>
        <em>{detail}</em>
      </span>
    </div>
  );
}

export function SystemHealth() {
  const { connected, setPage } = useStore();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readTs, setReadTs] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return fetch('/api/system')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        setInfo(d as SystemInfo);
        setLoadError(null);
        setReadTs(Date.now());
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to read system state'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  if (!info) return <div className="container page page-narrow"><div className="empty-state">Reading system state...</div></div>;

  const feedEntries = Object.entries(info.feeds);
  const liveFeeds = feedEntries.filter(([, s]) => s === 'live' || s === 'open').length;
  const degradedFeeds = feedEntries.filter(([, s]) => tone(s) === 'warn' || tone(s) === 'bad').length;
  const scannerTone = ageTone(info.lastScannerTickTs, 30_000);
  const ordersTone = ageTone(info.lastOrdersSyncTs, 90_000);
  const restTone = latencyTone(info.restLatencyMs);
  const clockTone = driftTone(info.serverTimeDiffMs);
  const usedWeightTone = weightTone(info.usedWeight1m);
  const weightPct = info.usedWeight1m === null ? null : Math.min(100, (info.usedWeight1m / 6000) * 100);
  const accountTone: Tone = info.binance.keysPresent ? (info.binance.connected ? 'ok' : 'bad') : 'idle';
  const userStreamTone: Tone = info.binance.userStream === 'open' ? 'ok' : info.binance.keysPresent ? 'warn' : 'idle';
  const modeLabel = info.killSwitch ? 'Halted' : info.liveTradingEnabled ? 'Live armed' : 'Manual only';
  const modeTone: Tone = info.killSwitch ? 'warn' : info.liveTradingEnabled ? 'bad' : 'ok';
  const overallTone: Tone =
    !info.dbOk || clockTone === 'bad' || degradedFeeds > 1
      ? 'bad'
      : !connected || scannerTone !== 'ok' || accountTone === 'bad' || restTone === 'warn'
        ? 'warn'
        : 'ok';

  const feedNames = feedEntries.map(([name]) => name.replace(/-/g, ' ')).join(', ') || 'no public feeds configured';
  const restClockTone: Tone = restTone === 'bad' || clockTone === 'bad' ? 'bad' : restTone === 'warn' || clockTone === 'warn' ? 'warn' : restTone === 'idle' && clockTone === 'idle' ? 'idle' : 'ok';
  const comp: { icon: ReactNode; label: string; sub: ReactNode; rowTone: Tone; value: ReactNode }[] = [
    {
      icon: <IconPulse />,
      label: 'Cockpit WebSocket',
      sub: 'state pushes, book subscriptions, and cockpit freshness',
      rowTone: connected ? 'ok' : 'bad',
      value: connected ? 'live' : 'reconnecting',
    },
    {
      icon: <IconWifi />,
      label: 'Binance public streams',
      sub: feedNames,
      rowTone: degradedFeeds ? 'warn' : liveFeeds ? 'ok' : 'idle',
      value: `${liveFeeds}/${feedEntries.length || 0} live`,
    },
    {
      icon: <IconChart />,
      label: 'REST and clock',
      sub: `latency ${msLabel(info.restLatencyMs)} · drift ${msLabel(info.serverTimeDiffMs)}`,
      rowTone: restClockTone,
      value: restClockTone === 'ok' ? 'ready' : restClockTone === 'warn' ? 'watch' : restClockTone === 'bad' ? 'bad' : 'unknown',
    },
    {
      icon: <IconWallet />,
      label: 'Account truth',
      sub: 'balances, open orders, fills, and permission reality',
      rowTone: accountTone,
      value: info.binance.keysPresent
        ? info.binance.connected
          ? `synced ${timeAgo(info.binance.lastSyncTs)}`
          : `failing: ${info.binance.lastError ?? 'unknown'}`
        : 'no keys',
    },
    {
      icon: <IconWifi />,
      label: 'User data stream',
      sub: 'order and balance updates during volatility',
      rowTone: userStreamTone,
      value: info.binance.userStream,
    },
    {
      icon: <IconBrain />,
      label: 'Proposal scanner',
      sub: `${info.pairs} spot/perp pairs scanned every 2s`,
      rowTone: scannerTone,
      value: info.lastScannerTickTs ? `tick ${timeAgo(info.lastScannerTickTs)}` : 'never',
    },
    {
      icon: <IconTicket />,
      label: 'Order cache',
      sub: info.lastOrdersSyncTs ? `open-orders cache ${timeAgo(info.lastOrdersSyncTs)}` : 'no order sync has completed',
      rowTone: ordersTone,
      value: ordersTone === 'ok' ? 'fresh' : info.lastOrdersSyncTs ? 'old' : 'empty',
    },
    {
      icon: <IconShield />,
      label: 'Risk engine',
      sub: 'in-process gate that must pass before every live send',
      rowTone: modeTone,
      value: info.killSwitch ? 'gating halted' : info.liveTradingEnabled ? 'gating live armed' : 'gating manual',
    },
    {
      icon: <IconBook />,
      label: 'Ledger SQLite',
      sub: 'append-only audit store for decisions, orders, fills, errors',
      rowTone: info.dbOk ? 'ok' : 'bad',
      value: info.dbOk ? 'writable' : 'write failure',
    },
    {
      icon: <IconList />,
      label: 'Rate budget',
      sub: info.usedWeightTs ? `weight seen ${timeAgo(info.usedWeightTs)}` : 'no signed call has reported headers yet',
      rowTone: usedWeightTone,
      value: info.usedWeight1m === null ? 'unknown' : `${Math.round(weightPct ?? 0)}%`,
    },
  ];

  const preflight = [
    {
      n: '1',
      label: 'Market data can explain proposals',
      detail: `${liveFeeds}/${feedEntries.length || 0} feeds live; scanner ${info.lastScannerTickTs ? timeAgo(info.lastScannerTickTs) : 'never ticked'}.`,
      tone: liveFeeds > 0 && scannerTone !== 'bad' ? scannerTone === 'ok' ? 'ok' : 'warn' : 'bad',
    },
    {
      n: '2',
      label: 'Account truth is separated from public data',
      detail: info.binance.keysPresent
        ? info.binance.connected
          ? `account synced ${timeAgo(info.binance.lastSyncTs)}`
          : info.binance.lastError ?? 'account REST is failing'
        : 'no server keys; balances/orders/fills stay intentionally locked',
      tone: accountTone,
    },
    {
      n: '3',
      label: 'Order path is blocked until risk allows it',
      detail: info.killSwitch ? 'kill switch is on; live sends are blocked' : info.liveTradingEnabled ? 'live manual mode is armed; keep typed confirmation in path' : 'manual mode only; live sends not armed',
      tone: modeTone,
    },
    {
      n: '4',
      label: 'Every decision can be audited',
      detail: info.dbOk ? 'ledger writes are available' : 'ledger write failure blocks trust',
      tone: info.dbOk ? 'ok' : 'bad',
    },
  ] satisfies { n: string; label: string; detail: string; tone: Tone }[];

  return (
    <div className="container page system-page">
      <section className="sys-hero card">
        <div className="sys-hero-copy">
          <span className="sys-eyebrow">
            <IconPulse size={15} />
            source monitor
          </span>
          <h1 className="page-title">System Health</h1>
          <p>
            A trading impact view of the app, Binance streams, account sync, risk gate, and ledger writes. It shows
            whether the cockpit can trust its inputs before any manual action.
          </p>
          <div className="sys-hero-actions">
            <button className="cta-pill" type="button" onClick={() => void load()} disabled={loading}>
              <IconRefresh size={14} />
              {loading ? 'Refreshing' : 'Refresh'}
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('ledger')}>
              <IconBook size={14} />
              Audit ledger
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('risk')}>
              <IconShield size={14} />
              Risk gate
            </button>
          </div>
        </div>

        <div className="sys-hero-panel">
          <StatePill tone={overallTone}>{overallTone === 'ok' ? 'operational' : overallTone === 'warn' ? 'degraded' : 'attention'}</StatePill>
          <span>Trading posture</span>
          <b className="num">{modeLabel}</b>
          <em>
            v{info.version} · {info.env} · up {fmtUptime(info.uptimeSec)}
            {info.cfUser ? ` · ${info.cfUser}` : ''}
          </em>
          <div className="sys-mode-ladder">
            <span className={info.killSwitch ? 'on' : ''}>kill switch</span>
            <span className={!info.killSwitch && !info.liveTradingEnabled ? 'on' : ''}>manual</span>
            <span className={!info.killSwitch && info.liveTradingEnabled ? 'on warn' : ''}>live armed</span>
          </div>
        </div>
      </section>

      {loadError && (
        <section className="sys-alert card">
          <IconAlert size={16} />
          <span>{loadError}</span>
        </section>
      )}

      <div className="sys-compressed-layout">
        <main className="sys-main card sys-ops-board">
          <div className="sys-section-head">
            <div>
              <h2>Operations board</h2>
              <span>one line per trust source; duplicate status noise removed</span>
            </div>
            <StatePill tone={readTs && !loadError ? 'ok' : loadError ? 'bad' : 'idle'}>
              {readTs && !loadError ? `read ${timeAgo(readTs)}` : loadError ? 'read failed' : 'waiting'}
            </StatePill>
          </div>
          <div className="sys-source-list">
            {comp.map((c) => (
              <SourceRow
                key={c.label}
                icon={c.icon}
                label={c.label}
                sub={c.sub}
                tone={c.rowTone}
                value={c.value}
              />
            ))}
          </div>
        </main>

        <aside className="sys-rail">
          <section className="sys-panel card">
            <div className="sys-section-head compact">
              <div>
                <h2>Critical path</h2>
                <span>market, account, risk, ledger</span>
              </div>
            </div>
            <div className="sys-check-list">
              {preflight.slice(0, 4).map((step) => (
                <CheckStep key={step.n} n={step.n} label={step.label} detail={step.detail} tone={step.tone} />
              ))}
            </div>
          </section>

          <section className="sys-panel card">
            <div className="sys-section-head compact">
              <div>
                <h2>Rate budget</h2>
                <span>Binance weight window</span>
              </div>
              <StatePill tone={usedWeightTone}>{info.usedWeight1m === null ? 'unknown' : `${Math.round(weightPct ?? 0)}%`}</StatePill>
            </div>
            <div className={`sys-weight ${usedWeightTone}`}>
              <span><i style={{ width: `${weightPct ?? 0}%` }} /></span>
              <b className="num">{info.usedWeight1m ?? 'unknown'}</b>
              <em>of 6000 one-minute request weight tracked from Binance headers</em>
            </div>
          </section>

          <section className="sys-panel card">
            <div className="sys-section-head compact">
              <div>
                <h2>Safe routes</h2>
                <span>working cockpit actions</span>
              </div>
            </div>
            <div className="sys-action-list">
              <button type="button" onClick={() => setPage('account')}>
                <span><IconKey size={15} /> Account setup</span>
                <b>keys</b>
              </button>
              <button type="button" onClick={() => setPage('risk')}>
                <span><IconShield size={15} /> Risk gate</span>
                <b>policy</b>
              </button>
              <button type="button" onClick={() => setPage('orders')}>
                <span><IconTicket size={15} /> Orders</span>
                <b>cache</b>
              </button>
              <button type="button" onClick={() => setPage('ledger')}>
                <span><IconBook size={15} /> Ledger</span>
                <b>audit</b>
              </button>
            </div>
          </section>
        </aside>
      </div>

      <p className="sys-source-line">
        Source model: Binance WebSocket/rate-limit behavior and the app's `/api/system` snapshot. Status is graded by trading impact.
      </p>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { useRefreshSignal } from '../lib/refresh';
import { Group, GRow, StatePill } from '../components/ui';
import {
  IconAlert,
  IconBook,
  IconBrain,
  IconChart,
  IconClock,
  IconDatabase,
  IconExternal,
  IconKey,
  IconList,
  IconPulse,
  IconShield,
  IconTerminal,
  IconWallet,
  IconWifi,
} from '../components/Icons';
import { timeAgo } from '../format';

type Tone = 'ok' | 'bad' | 'warn' | 'idle';
type HealthState = 'healthy' | 'degraded' | 'broken' | 'not_configured';

interface KeyPosture {
  level: string;
  label: string;
  tone: Tone;
  ipRestricted: boolean;
}

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
    keyFingerprint: string | null;
    keyPosture: KeyPosture;
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

interface HealthCheck {
  id: string;
  group: 'Path' | 'Exchange' | 'Account' | 'Persistence' | 'Engine';
  source: string;
  measurement: string;
  value: ReactNode;
  detail: string;
  state: HealthState;
  fix: string;
  icon: ReactNode;
}

const stateLabel: Record<HealthState, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  broken: 'Broken',
  not_configured: 'Not configured',
};

const stateTone: Record<HealthState, Tone> = {
  healthy: 'ok',
  degraded: 'warn',
  broken: 'bad',
  not_configured: 'idle',
};

// Solid tile colors — a saturated fill with a white glyph, matching the
// native settings-list icons used across the rest of the cockpit.
const stateSolid: Record<HealthState, string> = {
  healthy: 'var(--up)',
  degraded: '#d98a25',
  broken: 'var(--down)',
  not_configured: '#6b7482',
};

const stateRank: Record<HealthState, number> = {
  broken: 4,
  degraded: 3,
  not_configured: 2,
  healthy: 1,
};

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${sec % 60}s`;
}

function fmtMs(ms: number | null): string {
  return ms === null ? 'not exposed' : `${Math.round(ms)}ms`;
}

function fmtSignedMs(ms: number | null): string {
  if (ms === null) return 'not exposed';
  return `${ms > 0 ? '+' : ''}${Math.round(ms)}ms`;
}

function fmtAge(ts: number | null): string {
  return ts ? timeAgo(ts) : 'not exposed';
}

function latencyState(ms: number | null): HealthState {
  if (ms === null) return 'not_configured';
  if (ms <= 500) return 'healthy';
  if (ms <= 1500) return 'degraded';
  return 'broken';
}

function driftState(ms: number | null): HealthState {
  if (ms === null) return 'not_configured';
  const abs = Math.abs(ms);
  if (abs <= 1000) return 'healthy';
  if (abs <= 5000) return 'degraded';
  return 'broken';
}

function ageState(ts: number | null, healthyMs: number, degradedMs: number, missing: HealthState): HealthState {
  if (!ts) return missing;
  const age = Date.now() - ts;
  if (age <= healthyMs) return 'healthy';
  if (age <= degradedMs) return 'degraded';
  return 'broken';
}

function weightState(weight: number | null): HealthState {
  if (weight === null) return 'not_configured';
  if (weight >= 4800) return 'broken';
  if (weight >= 3000) return 'degraded';
  return 'healthy';
}

function postureState(posture: KeyPosture | null, keysPresent: boolean): HealthState {
  if (!keysPresent) return 'not_configured';
  if (!posture) return 'not_configured';
  if (posture.tone === 'bad') return 'broken';
  if (posture.tone === 'warn') return 'degraded';
  if (posture.tone === 'ok') return 'healthy';
  return 'not_configured';
}

function feedState(status: string): HealthState {
  if (status === 'live' || status === 'open') return 'healthy';
  if (status === 'connecting') return 'degraded';
  if (status === 'failed' || status === 'closed') return 'broken';
  return 'not_configured';
}

function worstState(states: HealthState[]): HealthState {
  if (states.some((s) => s === 'broken')) return 'broken';
  if (states.some((s) => s === 'degraded')) return 'degraded';
  if (states.some((s) => s === 'not_configured')) return 'not_configured';
  return 'healthy';
}

function combineState(...states: HealthState[]): HealthState {
  return states.reduce((worst, next) => (stateRank[next] > stateRank[worst] ? next : worst), 'healthy' as HealthState);
}

function modeLabel(info: SystemInfo): string {
  if (info.killSwitch) return 'Halted';
  return info.liveTradingEnabled ? 'Live armed' : 'Manual only';
}

function tradeDecision(state: HealthState): string {
  if (state === 'healthy') return 'Ready';
  if (state === 'degraded') return 'Review required';
  if (state === 'broken') return 'Unavailable';
  return 'Setup required';
}

function decisionCopy(state: HealthState): string {
  if (state === 'healthy') return 'All configured sources are within the expected range.';
  if (state === 'degraded') return 'A live source is stale or slow. Review the listed issue before using this data.';
  if (state === 'broken') return 'A required source is failing. Treat the cockpit as unavailable until it recovers.';
  return 'Market data is available. Account and engine signals still need setup.';
}

function HealthDot({ state }: { state: HealthState }) {
  return <span className={`health-dot health-${state}`} aria-hidden="true" />;
}

function stateForIds(checks: HealthCheck[], ids: string[]): HealthState {
  return worstState(checks.filter((check) => ids.includes(check.id)).map((check) => check.state));
}

function healthCount(checks: HealthCheck[], ids: string[]): string {
  const rows = checks.filter((check) => ids.includes(check.id));
  return `${rows.filter((check) => check.state === 'healthy').length}/${rows.length} ready`;
}

export function SystemHealth() {
  const { state, connected, setPage } = useStore();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readTs, setReadTs] = useState<number | null>(null);
  const [browserLatencyMs, setBrowserLatencyMs] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const started = performance.now();
    try {
      const res = await fetch('/api/system');
      setBrowserLatencyMs(Math.round(performance.now() - started));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setInfo((await res.json()) as SystemInfo);
      setLoadError(null);
      setReadTs(Date.now());
    } catch (err) {
      setBrowserLatencyMs(Math.round(performance.now() - started));
      setLoadError(err instanceof Error ? err.message : 'Failed to read system state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  useRefreshSignal(() => void load());

  const checks = useMemo<HealthCheck[]>(() => {
    if (!info) return [];

    const binance = state?.binance ?? info.binance;
    const feedEntries = Object.entries(info.feeds);
    const feedStates = feedEntries.map(([, status]) => feedState(status));
    const feedLive = feedStates.filter((s) => s === 'healthy').length;
    const feedConfigured = feedEntries.length > 0;
    const marketAgeTs = info.lastScannerTickTs ?? state?.scanner.lastTickTs ?? null;
    const marketAgeState = ageState(marketAgeTs, 30_000, 90_000, 'not_configured');
    const publicStreamState = feedConfigured ? combineState(worstState(feedStates), marketAgeState) : 'not_configured';

    const accountSyncState = !binance.keysPresent
      ? 'not_configured'
      : !binance.connected
        ? 'broken'
        : ageState(binance.lastSyncTs, 90_000, 5 * 60_000, 'broken');

    const userStreamOpen = binance.userStream === 'open' || binance.userStream === 'live';
    const userStreamState: HealthState = !binance.keysPresent
      ? 'not_configured'
      : userStreamOpen
        ? 'healthy'
        : accountSyncState === 'healthy' || accountSyncState === 'degraded'
          ? 'degraded'
          : 'broken';

    const keyState = postureState(binance.keyPosture, binance.keysPresent);
    const browserState = loadError ? 'broken' : combineState(latencyState(browserLatencyMs), connected ? 'healthy' : 'degraded');
    const restState = latencyState(info.restLatencyMs);
    const clockState = driftState(info.serverTimeDiffMs);
    const budgetState = weightState(info.usedWeight1m);
    const orderSyncState = !binance.keysPresent
      ? 'not_configured'
      : ageState(info.lastOrdersSyncTs, 90_000, 5 * 60_000, 'degraded');

    return [
      {
        id: 'browser-server',
        group: 'Path',
        source: 'Browser → server latency',
        measurement: 'HTTP round trip for /api/system',
        value: browserLatencyMs === null ? 'not measured' : `${browserLatencyMs}ms`,
        detail: connected ? 'WebSocket state is live.' : 'HTTP may answer, but the app WebSocket is reconnecting.',
        state: browserState,
        fix: 'Check the local server process, browser network panel, and Cloudflare/Tunnel path if this turns red.',
        icon: <IconPulse />,
      },
      {
        id: 'rest-latency',
        group: 'Exchange',
        source: 'Server → Binance REST latency',
        measurement: 'Binance server-time probe latency',
        value: fmtMs(info.restLatencyMs),
        detail: 'Measured by the backend, not estimated in the browser.',
        state: restState,
        fix: 'Confirm Binance API reachability from the server and watch for rate-limit or WAF responses.',
        icon: <IconChart />,
      },
      {
        id: 'public-stream-age',
        group: 'Exchange',
        source: 'Public market stream age',
        measurement: 'Feed states plus latest scanner/cache tick',
        value: marketAgeTs ? fmtAge(marketAgeTs) : 'not exposed',
        detail: feedConfigured
          ? `${feedLive}/${feedEntries.length} feeds live: ${feedEntries.map(([name, status]) => `${name}=${status}`).join(', ')}`
          : 'No public feed states were returned by /api/system.',
        state: publicStreamState,
        fix: 'Restart the market stream adapter or inspect the Binance WebSocket stream connections.',
        icon: <IconWifi />,
      },
      {
        id: 'account-sync',
        group: 'Account',
        source: 'Account sync age',
        measurement: 'state.binance.lastSyncTs',
        value: binance.lastSyncTs ? fmtAge(binance.lastSyncTs) : 'not configured',
        detail: binance.keysPresent
          ? binance.connected
            ? 'Signed read-only account polling is connected.'
            : binance.lastError ?? 'Keys exist but account polling is not connected.'
          : 'Server-side Binance read keys are absent.',
        state: accountSyncState,
        fix: 'Add read-only Binance keys on the server to enable account polling.',
        icon: <IconWallet />,
      },
      {
        id: 'user-stream',
        group: 'Account',
        source: 'User stream or polling fallback',
        measurement: 'state.binance.userStream plus account poll age',
        value: userStreamOpen ? binance.userStream : binance.keysPresent ? 'polling fallback' : 'not configured',
        detail: userStreamOpen
          ? 'Account events are coming from the user stream.'
          : binance.keysPresent
            ? `User stream is ${binance.userStream}; account truth depends on polling.`
            : 'No account stream can start until server keys exist.',
        state: userStreamState,
        fix: 'Use the account polling fallback while the user stream is unavailable; migrate to Binance WebSocket API user data stream when ready.',
        icon: <IconList />,
      },
      {
        id: 'key-scope',
        group: 'Account',
        source: 'API key scope',
        measurement: 'state.binance.keyPosture',
        value: binance.keysPresent ? binance.keyPosture.label : 'not configured',
        detail: binance.keyFingerprint
          ? `Key ${binance.keyFingerprint}${binance.keyPosture.ipRestricted ? ' is IP restricted.' : ' is not confirmed IP restricted.'}`
          : 'No key fingerprint returned to the browser.',
        state: keyState,
        fix: 'Use a server-only read key with withdrawals and transfers disabled; verify apiRestrictions posture.',
        icon: <IconKey />,
      },
      {
        id: 'ledger-db',
        group: 'Persistence',
        source: 'DB / ledger writable',
        measurement: 'SQLite config read probe',
        value: info.dbOk ? 'writable' : 'write/read failure',
        detail: 'Ledger truth must be available before operator decisions are trustworthy.',
        state: info.dbOk ? 'healthy' : 'broken',
        fix: 'Inspect data/cosmos.db permissions and disk health, then restart the server after the ledger probe is clean.',
        icon: <IconDatabase />,
      },
      {
        id: 'rate-budget',
        group: 'Exchange',
        source: 'Rate budget / request weight',
        measurement: 'X-MBX-USED-WEIGHT-1M header snapshot',
        value: info.usedWeight1m === null ? 'not configured' : info.usedWeight1m,
        detail: info.usedWeightTs
          ? `Last request-weight header was seen ${fmtAge(info.usedWeightTs)}. /api/system exposes usage, not the exchange limit.`
          : 'No signed Binance call has reported request-weight headers yet.',
        state: budgetState,
        fix: 'Reduce polling or cache heavier signed endpoints if request weight approaches the local guard band.',
        icon: <IconShield />,
      },
      {
        id: 'clock-drift',
        group: 'Exchange',
        source: 'Clock drift',
        measurement: 'Binance server time minus backend time',
        value: fmtSignedMs(info.serverTimeDiffMs),
        detail: 'Signed Binance requests depend on a sane timestamp window.',
        state: clockState,
        fix: 'Check host time sync/NTP and retry the Binance server-time probe.',
        icon: <IconClock />,
      },
      {
        id: 'binance-error',
        group: 'Exchange',
        source: 'Latest Binance error',
        measurement: 'state.binance.lastError',
        value: binance.lastError ? 'recorded' : binance.keysPresent ? 'none' : 'not configured',
        detail: binance.lastError ?? (binance.keysPresent ? 'No latest Binance error is reported.' : 'No signed account source is configured.'),
        state: binance.lastError ? 'broken' : binance.keysPresent ? 'healthy' : 'not_configured',
        fix: 'Read the exact error, check key scope/IP restriction/rate limits, and confirm the signed account endpoint recovers.',
        icon: <IconAlert />,
      },
      {
        id: 'order-cache',
        group: 'Account',
        source: 'Order cache age',
        measurement: 'latest open-orders sync',
        value: info.lastOrdersSyncTs ? fmtAge(info.lastOrdersSyncTs) : 'not configured',
        detail: binance.keysPresent ? 'Open-order truth comes from signed account sync.' : 'Order sync is unavailable without server-side keys.',
        state: orderSyncState,
        fix: 'Once keys exist, confirm open-order polling completes and ledger entries remain writable.',
        icon: <IconBook />,
      },
      {
        id: 'engine-heartbeat',
        group: 'Engine',
        source: 'Engine heartbeat',
        measurement: 'dedicated engine process heartbeat',
        value: 'not started',
        detail: 'The current /api/system snapshot has scanner ticks, but no dedicated engine heartbeat source.',
        state: 'not_configured',
        fix: 'Start or wire the engine heartbeat endpoint before treating scanner proposals as engine-owned truth.',
        icon: <IconBrain />,
      },
    ];
  }, [browserLatencyMs, connected, info, loadError, state?.binance, state?.scanner.lastTickTs]);

  if (!info) {
    return (
      <div className="container page health-page">
        <header className="health-head">
          <span className="health-mark health-not_configured"><IconShield size={22} /></span>
          <div className="health-head-copy">
            <h1>System Health</h1>
            <p>Can I trust the system right now? Live status for every source behind a trade.</p>
          </div>
        </header>
        <div className="health-loading">
          <StatePill tone={loadError ? 'bad' : 'idle'}>{loadError ? 'Unreachable' : 'Reading'}</StatePill>
          <b>{loadError ? 'System state unavailable' : 'Reading system state…'}</b>
          <span>{loadError ?? 'Waiting for /api/system.'}</span>
        </div>
      </div>
    );
  }

  const overallState = worstState(checks.map((check) => check.state));
  const topBlocker = [...checks].sort((a, b) => stateRank[b.state] - stateRank[a.state])[0];
  const blockers = checks.filter((check) => check.state !== 'healthy');
  const counts = checks.reduce(
    (acc, check) => {
      acc[check.state] += 1;
      return acc;
    },
    { healthy: 0, degraded: 0, broken: 0, not_configured: 0 } as Record<HealthState, number>,
  );
  const exchangeIds = ['rest-latency', 'public-stream-age', 'rate-budget', 'clock-drift', 'binance-error'];
  const accountIds = ['account-sync', 'user-stream', 'key-scope', 'order-cache'];
  const keysPresent = state?.binance.keysPresent || info.binance.keysPresent;
  const evidence = [
    { id: 'path', label: 'Connection', detail: 'Browser to control server', value: browserLatencyMs === null ? 'not measured' : `${browserLatencyMs}ms`, state: stateForIds(checks, ['browser-server']), icon: <IconPulse /> },
    { id: 'exchange', label: 'Exchange data', detail: 'REST latency, market stream, rate budget, clock', value: healthCount(checks, exchangeIds), state: stateForIds(checks, exchangeIds), icon: <IconChart /> },
    { id: 'account', label: 'Account data', detail: 'Read keys, account sync, and user events', value: keysPresent ? healthCount(checks, accountIds) : 'not connected', state: stateForIds(checks, accountIds), icon: <IconWallet /> },
    { id: 'ledger', label: 'Ledger', detail: 'Local database read and write probe', value: info.dbOk ? 'writable' : 'blocked', state: stateForIds(checks, ['ledger-db']), icon: <IconDatabase /> },
    { id: 'engine', label: 'Engine', detail: 'Dedicated heartbeat source', value: 'not started', state: stateForIds(checks, ['engine-heartbeat']), icon: <IconBrain /> },
  ];

  const execTone: Tone = info.killSwitch ? 'bad' : info.liveTradingEnabled ? 'ok' : 'idle';
  const execColor = info.killSwitch ? 'var(--down)' : info.liveTradingEnabled ? 'var(--up)' : '#5363d8';

  return (
    <div className="container page health-page">
      <header className="health-head">
        <span className={`health-mark health-${overallState}`}>
          <IconShield size={22} />
        </span>
        <div className="health-head-copy">
          <h1>System Health</h1>
          <p>Can I trust the system right now? Live status for every source behind a trade.</p>
        </div>
        <div className="health-head-meta">
          <StatePill tone={stateTone[overallState]}>{stateLabel[overallState]}</StatePill>
          <span>
            v{info.version} · {info.env} · up {fmtUptime(info.uptimeSec)} ·{' '}
            {readTs ? `read ${timeAgo(readTs)}` : loading ? 'reading…' : 'waiting'}
          </span>
        </div>
      </header>

      <section className={`health-verdict health-${overallState}`}>
        <div className="health-verdict-lead">
          <span className="health-verdict-eyebrow">System status</span>
          <b className="health-verdict-word">{tradeDecision(overallState)}</b>
          <p>{decisionCopy(overallState)}</p>
        </div>
        <div className="health-verdict-side">
          <StatePill tone={stateTone[overallState]}>{stateLabel[overallState]}</StatePill>
          <span>{blockers.length ? `${blockers.length} source${blockers.length === 1 ? '' : 's'} need action` : 'all sources clear'}</span>
        </div>
        <div className="health-tally" aria-label="Source state counts">
          <span><HealthDot state="broken" />{counts.broken} broken</span>
          <span><HealthDot state="degraded" />{counts.degraded} degraded</span>
          <span><HealthDot state="not_configured" />{counts.not_configured} not configured</span>
          <span><HealthDot state="healthy" />{counts.healthy} healthy</span>
        </div>
      </section>

      {loadError && (
        <div className="health-alert">
          <IconAlert size={16} />
          <span>/api/system read failed: {loadError}</span>
        </div>
      )}

      <Group title="Next action">
        <GRow
          icon={topBlocker.icon}
          color={stateSolid[topBlocker.state]}
          label={topBlocker.state === 'healthy' ? 'No current blocker' : topBlocker.source}
          sub={topBlocker.state === 'healthy' ? 'All configured sources are inside their trust bands.' : topBlocker.fix}
          control={
            <>
              <span className="sr-value">{topBlocker.value}</span>
              <StatePill tone={stateTone[topBlocker.state]}>{stateLabel[topBlocker.state]}</StatePill>
            </>
          }
        />
        <GRow
          icon={<IconTerminal />}
          color={execColor}
          label="Execution mode"
          sub={info.killSwitch ? 'Kill switch is on. Live order routes are blocked.' : info.liveTradingEnabled ? 'Live mode is armed.' : 'Manual-only mode. No automated sends.'}
          control={<StatePill tone={execTone}>{modeLabel(info)}</StatePill>}
        />
      </Group>

      <Group title="Data path">
        {evidence.map((item) => (
          <GRow
            key={item.id}
            icon={item.icon}
            color={stateSolid[item.state]}
            label={item.label}
            sub={item.detail}
            control={<span className="health-val"><HealthDot state={item.state} />{item.value}</span>}
          />
        ))}
      </Group>

      <div className="settings-sec">All sources</div>
      <section className="health-sources">
        <div className="health-sources-head">
          <div>
            <h2>Evidence matrix</h2>
            <p>Every row is a real source. Gray means missing or not exposed — never treated as healthy.</p>
          </div>
          <button className="health-ledger-btn" type="button" onClick={() => setPage('ledger')}>
            <IconBook size={14} />
            Audit ledger
          </button>
        </div>
        <div className="health-table-wrap">
          <table className="health-table">
            <thead>
              <tr>
                <th>State</th>
                <th>Layer</th>
                <th>Source</th>
                <th>Measurement</th>
                <th>Value</th>
                <th>Interpretation</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((check) => (
                <tr key={check.id}>
                  <td>
                    <span className="health-state-cell">
                      <HealthDot state={check.state} />
                      {stateLabel[check.state]}
                    </span>
                  </td>
                  <td className="health-col-layer">{check.group}</td>
                  <td>
                    <span className="health-src-name">
                      <span className={`health-src-ic health-${check.state}`}>{check.icon}</span>
                      {check.source}
                    </span>
                  </td>
                  <td>{check.measurement}</td>
                  <td className="health-col-value num">{check.value}</td>
                  <td>{check.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Group title="Cost & usage · AWS">
        <GRow
          icon={<IconChart />}
          color="#6b7482"
          label="Current month"
          sub="Read-only Cost Explorer source is not connected to this cockpit."
          control={<StatePill tone="idle">Not connected</StatePill>}
        />
        <GRow
          icon={<IconClock />}
          color="#6b7482"
          label="Forecast"
          sub="No billing numbers are shown until a real server-side source exists."
          control={<StatePill tone="idle">Not connected</StatePill>}
        />
      </Group>
      <div className="health-links">
        <a href="https://console.aws.amazon.com/billing/home" target="_blank" rel="noreferrer noopener">
          <IconExternal size={14} />
          AWS Billing
        </a>
        <a href="https://console.aws.amazon.com/cloudshell/home" target="_blank" rel="noreferrer noopener">
          <IconTerminal size={14} />
          CloudShell
        </a>
      </div>

      <p className="health-foot">
        Source model: <code>/api/system</code> + <code>state.binance</code>. The bottom-right refresh dock owns force refresh and reconnect.
      </p>
    </div>
  );
}

/* System Health — live status for every source behind a trade. Markets-voice
   anatomy shared with Risk: h1 hero + stat quartet, side-by-side bands, a
   full-width evidence matrix. Verdicts are colored words; gray means missing
   or not exposed — never treated as healthy. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { useRefreshSignal } from '../lib/refresh';
import { Dot, Pill } from '../components/px';
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
import './Markets.css';

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
  group: 'Path' | 'Exchange' | 'Account' | 'Persistence' | 'Engine' | 'External';
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
  not_configured: 'Not Configured',
};

const stateTone: Record<HealthState, Tone> = {
  healthy: 'ok',
  degraded: 'warn',
  broken: 'bad',
  not_configured: 'idle',
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
  return ms === null ? 'Not Exposed' : `${Math.round(ms)}ms`;
}

function fmtSignedMs(ms: number | null): string {
  if (ms === null) return 'Not Exposed';
  return `${ms > 0 ? '+' : ''}${Math.round(ms)}ms`;
}

function fmtAge(ts: number | null): string {
  return ts ? timeAgo(ts) : 'Not Exposed';
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
  return info.liveTradingEnabled ? 'Live Armed' : 'Manual Only';
}

function tradeDecision(state: HealthState): string {
  if (state === 'healthy') return 'Ready';
  if (state === 'degraded') return 'Review Required';
  if (state === 'broken') return 'Unavailable';
  return 'Setup Required';
}

function decisionCopy(state: HealthState): string {
  if (state === 'healthy') return 'All configured sources are within the expected range.';
  if (state === 'degraded') return 'A live source is stale or slow. Review the listed issue before using this data.';
  if (state === 'broken') return 'A required source is failing. Treat the cockpit as unavailable until it recovers.';
  return 'Market data is available. Account and engine signals still need setup.';
}

function HealthDot({ state }: { state: HealthState }) {
  return <Dot tone={stateTone[state]} />;
}

function HlxStatusRow({
  state,
  label,
  sub,
  value,
  icon,
}: {
  state: HealthState;
  label: string;
  sub?: string;
  value: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className={`hlx-status-row ${state}`}>
      <span className="hlx-status-mark" aria-hidden="true">
        {icon ?? <HealthDot state={state} />}
      </span>
      <span className="hlx-status-copy">
        <b>{label}</b>
        {sub ? <em title={sub}>{sub}</em> : null}
      </span>
      <span className="hlx-status-value">{value}</span>
    </div>
  );
}

function stateForIds(checks: HealthCheck[], ids: string[]): HealthState {
  return worstState(checks.filter((check) => ids.includes(check.id)).map((check) => check.state));
}

export function SystemHealth() {
  const { state, connected, setPage, prefs } = useStore();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readTs, setReadTs] = useState<number | null>(null);
  const [browserLatencyMs, setBrowserLatencyMs] = useState<number | null>(null);
  const [profiles, setProfiles] = useState<{
    running: boolean; total: number; done: number; ok: number; na: number;
    current: string | null; cachedProfiles: number;
    failed: { base: string; reason: string }[]; suspect: { base: string; reason: string }[];
  } | null>(null);

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
    const t = setInterval(() => void load(), Math.max(0.5, prefs.dataCadence?.health ?? 10) * 1000);
    return () => clearInterval(t);
  }, [load, prefs.dataCadence?.health]);

  useRefreshSignal(() => void load());

  useEffect(() => {
    let alive = true;
    const loadProfiles = () => {
      void fetch('/api/token/profiles/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setProfiles(d))
        .catch(() => undefined);
    };
    loadProfiles();
    const t = setInterval(loadProfiles, Math.max(0.5, prefs.dataCadence?.health ?? 10) * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [prefs.dataCadence?.health]);

  const checks = useMemo<HealthCheck[]>(() => {
    if (!info) return [];
    const profilesRef = profiles;

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
        source: 'Browser → Server Latency',
        measurement: 'HTTP round trip for /api/system',
        value: browserLatencyMs === null ? 'Not Measured' : `${browserLatencyMs}ms`,
        detail: connected ? 'WebSocket state is live.' : 'HTTP may answer, but the app WebSocket is reconnecting.',
        state: browserState,
        fix: 'Check the local server process, browser network panel, and Cloudflare/Tunnel path if this turns red.',
        icon: <IconPulse size={16} />,
      },
      {
        id: 'rest-latency',
        group: 'Exchange',
        source: 'Server → Binance REST Latency',
        measurement: 'Binance server-time probe latency',
        value: fmtMs(info.restLatencyMs),
        detail: 'Measured by the backend, not estimated in the browser.',
        state: restState,
        fix: 'Confirm Binance API reachability from the server and watch for rate-limit or WAF responses.',
        icon: <IconChart size={16} />,
      },
      {
        id: 'public-stream-age',
        group: 'Exchange',
        source: 'Public Market Stream Age',
        measurement: 'Feed states plus latest scanner/cache tick',
        value: marketAgeTs ? fmtAge(marketAgeTs) : 'Not Exposed',
        detail: feedConfigured
          ? `${feedLive}/${feedEntries.length} feeds live: ${feedEntries.map(([name, status]) => `${name}=${status}`).join(', ')}`
          : 'No public feed states were returned by /api/system.',
        state: publicStreamState,
        fix: 'Restart the market stream adapter or inspect the Binance WebSocket stream connections.',
        icon: <IconWifi size={16} />,
      },
      {
        id: 'account-sync',
        group: 'Account',
        source: 'Account Sync Age',
        measurement: 'state.binance.lastSyncTs',
        value: binance.lastSyncTs ? fmtAge(binance.lastSyncTs) : 'Not Configured',
        detail: binance.keysPresent
          ? binance.connected
            ? 'Signed read-only account polling is connected.'
            : binance.lastError ?? 'Keys exist but account polling is not connected.'
          : 'Server-side Binance read keys are absent.',
        state: accountSyncState,
        fix: 'Add read-only Binance keys on the server to enable account polling.',
        icon: <IconWallet size={16} />,
      },
      {
        id: 'user-stream',
        group: 'Account',
        source: 'User Stream Or Polling Fallback',
        measurement: 'state.binance.userStream plus account poll age',
        value: userStreamOpen ? binance.userStream : binance.keysPresent ? 'Polling Fallback' : 'Not Configured',
        detail: userStreamOpen
          ? 'Account events are coming from the user stream.'
          : binance.keysPresent
            ? `User stream is ${binance.userStream}; account truth depends on polling.`
            : 'No account stream can start until server keys exist.',
        state: userStreamState,
        fix: 'Use the account polling fallback while the user stream is unavailable; migrate to Binance WebSocket API user data stream when ready.',
        icon: <IconList size={16} />,
      },
      {
        id: 'key-scope',
        group: 'Account',
        source: 'API Key Scope',
        measurement: 'state.binance.keyPosture',
        value: binance.keysPresent ? binance.keyPosture.label : 'Not Configured',
        detail: binance.keyFingerprint
          ? `Key ${binance.keyFingerprint}${binance.keyPosture.ipRestricted ? ' is IP restricted.' : ' is not confirmed IP restricted.'}`
          : 'No key fingerprint returned to the browser.',
        state: keyState,
        fix: 'Use a server-only read key with withdrawals and transfers disabled; verify apiRestrictions posture.',
        icon: <IconKey size={16} />,
      },
      {
        id: 'ledger-db',
        group: 'Persistence',
        source: 'DB / Ledger Writable',
        measurement: 'SQLite config read probe',
        value: info.dbOk ? 'Writable' : 'Write/Read Failure',
        detail: 'Ledger truth must be available before operator decisions are trustworthy.',
        state: info.dbOk ? 'healthy' : 'broken',
        fix: 'Inspect data/cosmos.db permissions and disk health, then restart the server after the ledger probe is clean.',
        icon: <IconDatabase size={16} />,
      },
      {
        id: 'rate-budget',
        group: 'Exchange',
        source: 'Rate Budget / Request Weight',
        measurement: 'X-MBX-USED-WEIGHT-1M header snapshot',
        value: info.usedWeight1m === null ? 'Not Configured' : info.usedWeight1m,
        detail: info.usedWeightTs
          ? `Last request-weight header was seen ${fmtAge(info.usedWeightTs)}. /api/system exposes usage, not the exchange limit.`
          : 'No signed Binance call has reported request-weight headers yet.',
        state: budgetState,
        fix: 'Reduce polling or cache heavier signed endpoints if request weight approaches the local guard band.',
        icon: <IconShield size={16} />,
      },
      {
        id: 'clock-drift',
        group: 'Exchange',
        source: 'Clock Drift',
        measurement: 'Binance server time minus backend time',
        value: fmtSignedMs(info.serverTimeDiffMs),
        detail: 'Signed Binance requests depend on a sane timestamp window.',
        state: clockState,
        fix: 'Check host time sync/NTP and retry the Binance server-time probe.',
        icon: <IconClock size={16} />,
      },
      {
        id: 'binance-error',
        group: 'Exchange',
        source: 'Latest Binance Error',
        measurement: 'state.binance.lastError',
        value: binance.lastError ? 'Recorded' : binance.keysPresent ? 'None' : 'Not Configured',
        detail: binance.lastError ?? (binance.keysPresent ? 'No latest Binance error is reported.' : 'No signed account source is configured.'),
        state: binance.lastError ? 'broken' : binance.keysPresent ? 'healthy' : 'not_configured',
        fix: 'Read the exact error, check key scope/IP restriction/rate limits, and confirm the signed account endpoint recovers.',
        icon: <IconAlert size={16} />,
      },
      {
        id: 'order-cache',
        group: 'Account',
        source: 'Order Cache Age',
        measurement: 'latest open-orders sync',
        value: info.lastOrdersSyncTs ? fmtAge(info.lastOrdersSyncTs) : 'Not Configured',
        detail: binance.keysPresent ? 'Open-order truth comes from signed account sync.' : 'Order sync is unavailable without server-side keys.',
        state: orderSyncState,
        fix: 'Once keys exist, confirm open-order polling completes and ledger entries remain writable.',
        icon: <IconBook size={16} />,
      },
      {
        id: 'token-profiles',
        group: 'External',
        source: 'Token Profiles',
        measurement: 'CoinGecko facts across the tracked universe',
        value: !profilesRef
          ? 'Not Started'
          : profilesRef.running
            ? `Warming ${profilesRef.done}/${profilesRef.total}`
            : `${profilesRef.ok + profilesRef.na}/${profilesRef.total} Ready`,
        detail: !profilesRef
          ? 'The profile warmer has not reported yet.'
          : profilesRef.running
            ? `Working on ${profilesRef.current ?? '…'} — ${profilesRef.ok} verified, ${profilesRef.failed.length} failed so far.`
            : `${profilesRef.ok} verified · ${profilesRef.na} tokenized stocks (N/A) · ${profilesRef.failed.length} failed${profilesRef.failed.length ? `: ${profilesRef.failed.slice(0, 6).map((f) => f.base).join(', ')}${profilesRef.failed.length > 6 ? '…' : ''}` : ''}${profilesRef.suspect.length ? ` · ${profilesRef.suspect.length} suspect: ${profilesRef.suspect.slice(0, 4).map((s) => s.base).join(', ')}` : ''}`,
        state: !profilesRef
          ? 'not_configured'
          : profilesRef.running
            ? 'degraded'
            : profilesRef.failed.length + profilesRef.suspect.length <= Math.ceil(profilesRef.total * 0.05)
              ? 'healthy'
              : 'degraded',
        fix: 'POST /api/token/profiles/warm re-runs the walker; failed bases usually need a QUERY_ALIAS in server/src/binance/profile.ts.',
        icon: <IconDatabase size={16} />,
      },
      {
        id: 'engine-heartbeat',
        group: 'Engine',
        source: 'Engine Heartbeat',
        measurement: 'dedicated engine process heartbeat',
        value: 'Not Started',
        detail: 'The current /api/system snapshot has scanner ticks, but no dedicated engine heartbeat source.',
        state: 'not_configured',
        fix: 'Start or wire the engine heartbeat endpoint before treating scanner proposals as engine-owned truth.',
        icon: <IconBrain size={16} />,
      },
    ];
  }, [browserLatencyMs, connected, info, loadError, profiles, state?.binance, state?.scanner.lastTickTs]);

  if (!info) {
    return (
      <div className="container page mkx rsx-page">
        <header className="bwx-hero">
          <div className="bwx-hero-top">
            <div className="bwx-hero-title">
              <div className="bwx-title-row">
                <h1>Health</h1>
                <Pill tone={loadError ? 'bad' : 'idle'}>{loadError ? 'Unreachable' : 'Reading'}</Pill>
              </div>
              <p>{loadError ?? 'Waiting for /api/system.'}</p>
            </div>
          </div>
        </header>
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
  const checkById = new Map(checks.map((check) => [check.id, check]));
  const rowFor = (id: string) => checkById.get(id);
  const feedEntries = Object.entries(info.feeds);
  const liveFeedCount = feedEntries.filter(([, status]) => status === 'open' || status === 'live').length;
  const feedHealthState = feedEntries.length ? stateForIds(checks, ['public-stream-age']) : 'not_configured';

  const execTone: Tone = info.killSwitch ? 'bad' : info.liveTradingEnabled ? 'ok' : 'idle';
  const overallTone = stateTone[overallState];
  const actionRows = [
    topBlocker,
    rowFor('account-sync'),
    rowFor('key-scope'),
    rowFor('engine-heartbeat'),
  ].filter(Boolean) as HealthCheck[];
  const quickRows = [
    rowFor('browser-server'),
    rowFor('rest-latency'),
    {
      id: 'live-socket',
      state: feedHealthState,
      source: 'Live Socket',
      detail: feedEntries.length ? `${liveFeedCount}/${feedEntries.length} feeds open` : 'No feed state returned.',
      value: feedEntries.length ? `${liveFeedCount} open` : 'Not Exposed',
      icon: <IconWifi size={16} />,
    },
    rowFor('public-stream-age'),
    rowFor('account-sync'),
    {
      id: 'last-refresh',
      state: loadError ? 'broken' : readTs ? 'healthy' : 'not_configured',
      source: 'Last Refresh',
      detail: loadError ?? 'Latest successful /api/system read.',
      value: readTs ? timeAgo(readTs) : 'Waiting',
      icon: <IconClock size={16} />,
    },
    rowFor('user-stream'),
    rowFor('clock-drift'),
    rowFor('rate-budget'),
    rowFor('ledger-db'),
  ].filter(Boolean) as Array<HealthCheck | { id: string; state: HealthState; source: string; detail: string; value: ReactNode; icon: ReactNode }>;

  return (
    <div className="container page mkx rsx-page hlx-page">
      <header className="hlx-console">
        <div className="hlx-console-head">
          <span className="hlx-console-mark" aria-hidden="true">
            <IconShield size={22} />
          </span>
          <span className="hlx-console-copy">
            <b>Cosmosgeek</b>
            <h1>System Health</h1>
            <em>v{info.version} · {info.env} · Up {fmtUptime(info.uptimeSec)} · {readTs ? `Read ${timeAgo(readTs)}` : loading ? 'Reading' : 'Waiting'}</em>
          </span>
          <span className={`hlx-console-pill ${overallTone}`}>{stateLabel[overallState]}</span>
        </div>
        <div className="hlx-summary">
          <div>
            <em>Decision</em>
            <b className={`hlx-word ${overallTone}`}>{tradeDecision(overallState)}</b>
            <small>{decisionCopy(overallState)}</small>
          </div>
          <div>
            <em>Sources Ready</em>
            <b>{counts.healthy} Of {checks.length}</b>
            <small>{counts.broken} Broken · {counts.degraded} Degraded · {counts.not_configured} Not Configured</small>
          </div>
          <div>
            <em>Execution</em>
            <b>{modeLabel(info)}</b>
            <small>{info.killSwitch ? 'Kill Switch On · Routes Blocked' : info.liveTradingEnabled ? 'Live Mode Armed' : 'Manual Only · No Automated Sends'}</small>
          </div>
          <div>
            <em>Needs Action</em>
            <b>{blockers.length}</b>
            <small>{blockers.length ? topBlocker.source : 'All Sources Clear'}</small>
          </div>
        </div>
      </header>

      {loadError && (
        <div className="hlx-alert">/api/system read failed: {loadError}</div>
      )}

      <section className="hlx-card-grid">
        <div className="hlx-card">
          <div className="hlx-card-head">
            <span>Connection Health</span>
            <b className={`hlx-chip ${overallTone}`}>{tradeDecision(overallState)}</b>
          </div>
          <div className="hlx-status-list">
            {quickRows.map((row) => (
              <HlxStatusRow
                key={row.id}
                state={row.state}
                label={row.source.replace('Browser → Server Latency', 'Browser → Server').replace('Server → Binance REST Latency', 'Binance REST').replace('Public Market Stream Age', 'Market Feed').replace('Account Sync Age', 'Account Sync').replace('User Stream Or Polling Fallback', 'User Stream').replace('Rate Budget / Request Weight', 'Rate Budget · 1m').replace('DB / Ledger Writable', 'Ledger DB')}
                sub={row.detail}
                value={row.value}
                icon={'icon' in row ? row.icon : undefined}
              />
            ))}
          </div>
        </div>

        <div className="hlx-card">
          <div className="hlx-card-head">
            <span>Operator Action</span>
            <b className={`hlx-chip ${stateTone[topBlocker.state]}`}>{stateLabel[topBlocker.state]}</b>
          </div>
          <div className="hlx-status-list">
            {actionRows.map((row) => (
              <HlxStatusRow
                key={row.id}
                state={row.state}
                label={row.id === topBlocker.id && row.state === 'healthy' ? 'No Current Blocker' : row.source}
                sub={row.id === topBlocker.id && row.state === 'healthy' ? 'All configured sources are inside their trust bands.' : row.fix}
                value={row.value}
                icon={row.icon}
              />
            ))}
            <HlxStatusRow
              state={info.killSwitch ? 'broken' : info.liveTradingEnabled ? 'healthy' : 'not_configured'}
              label="Execution Mode"
              sub={info.killSwitch ? 'Kill switch is on. Live order routes are blocked.' : info.liveTradingEnabled ? 'Live mode is armed.' : 'Manual-only mode. No automated sends.'}
              value={<Pill tone={execTone}>{modeLabel(info)}</Pill>}
              icon={<IconTerminal size={16} />}
            />
            <div className="hlx-links">
              <a href="https://console.aws.amazon.com/billing/home" target="_blank" rel="noreferrer noopener">
                <IconExternal size={13} />
                AWS Billing
              </a>
              <a href="https://console.aws.amazon.com/cloudshell/home" target="_blank" rel="noreferrer noopener">
                <IconTerminal size={13} />
                CloudShell
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="hlx-evidence">
        <div className="hlx-matrix-head">
          <div>
            <h3>Evidence Matrix</h3>
            <p>Every row is a real source. Gray means missing or not exposed — never treated as healthy.</p>
          </div>
          <button className="hp-btn" type="button" onClick={() => setPage('ledger')}>
            <IconBook size={14} />
            Audit Ledger
          </button>
        </div>
        <table className="rsx-table hlx-table">
          <colgroup>
            <col style={{ width: 150 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 250 }} />
            <col style={{ width: 260 }} />
            <col style={{ width: 160 }} />
            <col />
          </colgroup>
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
              <tr key={check.id} title={`${check.detail}\nFix: ${check.fix}`}>
                <td>
                  <span className="hlx-state">
                    <HealthDot state={check.state} />
                    {stateLabel[check.state]}
                  </span>
                </td>
                <td className="dim">{check.group}</td>
                <td className="strong">{check.source}</td>
                <td className="dim">{check.measurement}</td>
                <td>{check.value}</td>
                <td className="dim">{check.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

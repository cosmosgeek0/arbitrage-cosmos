import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  ChevronDown,
  Clock,
  Coins,
  Cpu,
  Database,
  Gauge,
  KeyRound,
  List,
  Monitor,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Wallet,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { useRefreshSignal } from '../lib/refresh';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll, type SettledPoll } from '../lib/polling';
import { useStore } from '../store';
import { timeAgo } from '../format';
import './Health.css';

type Tone = 'ok' | 'bad' | 'warn' | 'idle';
type HealthState = 'healthy' | 'degraded' | 'broken' | 'not_configured';
type HealthGroup = 'Path' | 'Exchange' | 'Account' | 'Persistence' | 'Engine' | 'External';
type HealthFilter = 'all' | 'attention' | 'exchange' | 'account' | 'system' | 'external';

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
  timeSyncTs: number | null;
  usedWeight1m: number | null;
  usedWeightTs: number | null;
  binanceCooldownUntil?: number | null;
  lastScannerTickTs: number | null;
  lastOrdersSyncTs: number | null;
  dbOk: boolean;
  cfUser: string | null;
  cfIp?: string | null;
  cfCountry?: string | null;
  cfRay?: string | null;
  serverStartTs?: number | null;
}

interface HealthCheck {
  id: string;
  group: HealthGroup;
  source: string;
  measurement: string;
  value: string;
  detail: string;
  state: HealthState;
  fix: string;
  icon: LucideIcon;
}

const STATE_LABEL: Record<HealthState, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  broken: 'Broken',
  not_configured: 'Not Configured',
};

const STATE_RANK: Record<HealthState, number> = {
  broken: 4,
  degraded: 3,
  not_configured: 2,
  healthy: 1,
};

const FILTERS: { id: HealthFilter; label: string }[] = [
  { id: 'all', label: 'All Sources' },
  { id: 'attention', label: 'Needs Attention' },
  { id: 'exchange', label: 'Exchange' },
  { id: 'account', label: 'Account' },
  { id: 'system', label: 'System' },
  { id: 'external', label: 'External' },
];

function fmtUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return String(days) + 'd ' + String(hours) + 'h';
  if (hours > 0) return String(hours) + 'h ' + String(minutes) + 'm';
  return String(minutes) + 'm ' + String(seconds % 60) + 's';
}

function fmtMs(milliseconds: number | null): string {
  return milliseconds === null ? 'Not Exposed' : String(Math.round(milliseconds)) + 'ms';
}

function fmtSignedMs(milliseconds: number | null): string {
  if (milliseconds === null) return 'Not Exposed';
  return (milliseconds > 0 ? '+' : '') + String(Math.round(milliseconds)) + 'ms';
}

function fmtAge(timestamp: number | null): string {
  return timestamp ? timeAgo(timestamp) : 'Not Exposed';
}

function latencyState(milliseconds: number | null): HealthState {
  if (milliseconds === null) return 'not_configured';
  if (milliseconds <= 500) return 'healthy';
  if (milliseconds <= 1_500) return 'degraded';
  return 'broken';
}

function driftState(milliseconds: number | null): HealthState {
  if (milliseconds === null) return 'not_configured';
  const absolute = Math.abs(milliseconds);
  if (absolute <= 1_000) return 'healthy';
  if (absolute <= 5_000) return 'degraded';
  return 'broken';
}

function ageState(
  timestamp: number | null,
  healthyMilliseconds: number,
  degradedMilliseconds: number,
  missing: HealthState,
): HealthState {
  if (!timestamp) return missing;
  const age = Date.now() - timestamp;
  if (age <= healthyMilliseconds) return 'healthy';
  if (age <= degradedMilliseconds) return 'degraded';
  return 'broken';
}

function weightState(weight: number | null): HealthState {
  if (weight === null) return 'not_configured';
  if (weight >= 4_800) return 'broken';
  if (weight >= 3_000) return 'degraded';
  return 'healthy';
}

function postureState(posture: KeyPosture | null, keysPresent: boolean): HealthState {
  if (!keysPresent || !posture) return 'not_configured';
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
  if (states.length === 0) return 'not_configured';
  return states.reduce((worst, next) => (
    STATE_RANK[next] > STATE_RANK[worst] ? next : worst
  ), 'healthy' as HealthState);
}

function combineState(...states: HealthState[]): HealthState {
  return worstState(states);
}

function readinessLabel(state: HealthState): string {
  if (state === 'healthy') return 'Operational';
  if (state === 'degraded') return 'Review Required';
  if (state === 'broken') return 'Unavailable';
  return 'Setup Required';
}

function filterMatches(check: HealthCheck, filter: HealthFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'attention') return check.state !== 'healthy';
  if (filter === 'exchange') return check.group === 'Exchange';
  if (filter === 'account') return check.group === 'Account';
  if (filter === 'external') return check.group === 'External';
  return check.group === 'Path' || check.group === 'Persistence' || check.group === 'Engine';
}

export function SystemHealth() {
  const { state, connected, setPage, prefs } = useStore();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readTs, setReadTs] = useState<number | null>(null);
  const [browserLatencyMs, setBrowserLatencyMs] = useState<number | null>(null);
  const [filter, setFilter] = useState<HealthFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const systemPollRef = useRef<SettledPoll | null>(null);
  const [profiles, setProfiles] = useState<{
    running: boolean;
    total: number;
    done: number;
    ok: number;
    na: number;
    current: string | null;
    cachedProfiles: number;
    failed: { base: string; reason: string }[];
    suspect: { base: string; reason: string }[];
  } | null>(null);

  const load = useCallback(() => systemPollRef.current?.refresh(), []);

  useEffect(() => {
    let started = performance.now();
    const poll = createSettledPoll<SystemInfo>({
      intervalMs: Math.max(0.5, prefs.dataCadence?.health ?? 10) * 1_000,
      request: (signal) => {
        started = performance.now();
        setLoading(true);
        return fetchJson('/api/system', { cache: 'no-store', signal });
      },
      onSuccess: (next) => {
        setBrowserLatencyMs(Math.round(performance.now() - started));
        setInfo(next);
        setLoadError(null);
        setReadTs(Date.now());
        setLoading(false);
      },
      onError: (error) => {
        setBrowserLatencyMs(Math.round(performance.now() - started));
        setLoadError(apiErrorMessage(error, 'Failed to read system state'));
        setLoading(false);
      },
    });
    systemPollRef.current = poll;
    poll.start();
    return () => {
      if (systemPollRef.current === poll) systemPollRef.current = null;
      poll.stop();
    };
  }, [prefs.dataCadence?.health]);

  useRefreshSignal(() => void load());

  useEffect(() => {
    const poll = createSettledPoll<NonNullable<typeof profiles>>({
      intervalMs: Math.max(0.5, prefs.dataCadence?.health ?? 10) * 1_000,
      request: (signal) => fetchJson('/api/token/profiles/status', { cache: 'no-store', signal }),
      onSuccess: (payload) => {
        setProfiles(payload);
        setProfileError(null);
      },
      onError: (error) => setProfileError(apiErrorMessage(error, 'Token profile status unavailable')),
    });
    poll.start();
    return poll.stop;
  }, [prefs.dataCadence?.health]);

  const checks = useMemo<HealthCheck[]>(() => {
    if (!info) return [];

    const binance = state?.binance ?? info.binance;
    const feedEntries = Object.entries(info.feeds);
    const feedStates = feedEntries.map(([, status]) => feedState(status));
    const liveFeeds = feedStates.filter((sourceState) => sourceState === 'healthy').length;
    const marketAgeTs = info.lastScannerTickTs ?? state?.scanner.lastTickTs ?? null;
    const marketAge = ageState(marketAgeTs, 30_000, 90_000, 'not_configured');
    const publicStreamState = feedEntries.length
      ? combineState(worstState(feedStates), marketAge)
      : 'not_configured';

    const accountSyncState: HealthState = !binance.keysPresent
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

    const browserState = loadError
      ? 'broken'
      : combineState(latencyState(browserLatencyMs), connected ? 'healthy' : 'degraded');

    const orderSyncState: HealthState = !binance.keysPresent
      ? 'not_configured'
      : ageState(info.lastOrdersSyncTs, 90_000, 5 * 60_000, 'degraded');

    const profileState: HealthState = profileError
      ? 'broken'
      : !profiles || profiles.total <= 0
      ? 'not_configured'
      : profiles.running
        ? 'degraded'
        : profiles.failed.length + profiles.suspect.length <= Math.ceil(profiles.total * 0.05)
          ? 'healthy'
          : 'degraded';

    const currentChecks: HealthCheck[] = [
      {
        id: 'browser-server',
        group: 'Path',
        source: 'Browser → Server',
        measurement: '/api/system round trip and app WebSocket',
        value: browserLatencyMs === null ? 'Not Measured' : String(browserLatencyMs) + 'ms',
        detail: connected ? 'The control-room WebSocket and HTTP path are responding.' : 'HTTP may answer, but the app WebSocket is reconnecting.',
        state: browserState,
        fix: 'Check the local server process, browser network path, and Cloudflare Tunnel if this source remains unavailable.',
        icon: Monitor,
      },
      {
        id: 'rest-latency',
        group: 'Exchange',
        source: 'Binance REST',
        measurement: 'Backend server-time request latency',
        value: fmtMs(info.restLatencyMs),
        detail: info.timeSyncTs
          ? 'Measured by the backend ' + fmtAge(info.timeSyncTs) + '.'
          : 'No successful Binance server-time observation is exposed.',
        state: latencyState(info.restLatencyMs),
        fix: 'Confirm Binance API reachability from the server and inspect rate-limit or network failures.',
        icon: Server,
      },
      {
        id: 'public-stream-age',
        group: 'Exchange',
        source: 'Public Market Streams',
        measurement: 'Feed state plus latest scanner tick',
        value: feedEntries.length ? String(liveFeeds) + ' / ' + String(feedEntries.length) + ' Open' : 'Not Exposed',
        detail: feedEntries.length
          ? fmtAge(marketAgeTs) + ' tick · ' + feedEntries.map(([name, status]) => name + '=' + status).join(', ')
          : 'No public feed states were returned by /api/system.',
        state: publicStreamState,
        fix: 'Restart the affected market stream adapter and inspect the Binance WebSocket connection.',
        icon: Radio,
      },
      {
        id: 'account-sync',
        group: 'Account',
        source: 'Account Sync',
        measurement: 'Signed read-only account polling',
        value: binance.lastSyncTs ? fmtAge(binance.lastSyncTs) : 'Not Configured',
        detail: binance.keysPresent
          ? binance.connected
            ? 'Signed account truth is current.'
            : binance.lastError ?? 'Keys exist, but account polling is disconnected.'
          : 'Server-side Binance read keys are absent.',
        state: accountSyncState,
        fix: 'Verify the server-side read key, IP restriction, and signed account endpoint.',
        icon: Wallet,
      },
      {
        id: 'user-stream',
        group: 'Account',
        source: 'User Stream',
        measurement: 'Account event stream with polling fallback',
        value: userStreamOpen ? 'Open' : binance.keysPresent ? 'Polling Fallback' : 'Not Configured',
        detail: userStreamOpen
          ? 'Account events are arriving through the user stream.'
          : binance.keysPresent
            ? 'The user stream is ' + binance.userStream + '; current account truth depends on signed polling.'
            : 'No account stream can start until server keys exist.',
        state: userStreamState,
        fix: 'Polling is current, but restore the Binance user stream before depending on event-driven account updates.',
        icon: Wifi,
      },
      {
        id: 'key-scope',
        group: 'Account',
        source: 'API Key Posture',
        measurement: 'Live apiRestrictions posture',
        value: binance.keysPresent ? binance.keyPosture.label : 'Not Configured',
        detail: binance.keyFingerprint
          ? 'Key ' + binance.keyFingerprint + (binance.keyPosture.ipRestricted ? ' is IP restricted.' : ' is not confirmed IP restricted.')
          : 'No key fingerprint is returned to the browser.',
        state: postureState(binance.keyPosture, binance.keysPresent),
        fix: 'Use a server-only read key with withdrawals and transfers disabled and IP restriction enabled.',
        icon: KeyRound,
      },
      {
        id: 'ledger-db',
        group: 'Persistence',
        source: 'Ledger Database',
        measurement: 'Reversible SQLite write/read/rollback probe',
        value: info.dbOk ? 'Writable' : 'Write Probe Failed',
        detail: info.dbOk ? 'The ledger accepted and read a rolled-back probe value.' : 'The ledger could not complete its reversible write probe.',
        state: info.dbOk ? 'healthy' : 'broken',
        fix: 'Inspect the database path, permissions, disk health, and SQLite WAL state before trusting recorded actions.',
        icon: Database,
      },
      {
        id: 'rate-budget',
        group: 'Exchange',
        source: 'Request Weight',
        measurement: 'X-MBX-USED-WEIGHT-1M header snapshot',
        value: info.usedWeight1m === null ? 'Not Exposed' : String(info.usedWeight1m),
        detail: info.binanceCooldownUntil && info.binanceCooldownUntil > Date.now()
          ? `Exchange cooldown active for ${Math.max(1, Math.ceil((info.binanceCooldownUntil - Date.now()) / 1_000))}s.`
          : info.usedWeightTs
          ? 'Last observed ' + fmtAge(info.usedWeightTs) + '. The exchange limit is not exposed here.'
          : 'No signed Binance call has returned a request-weight header.',
        state: weightState(info.usedWeight1m),
        fix: 'Reduce polling or cache heavier signed endpoints if usage approaches the local guard band.',
        icon: Gauge,
      },
      {
        id: 'clock-drift',
        group: 'Exchange',
        source: 'Clock Drift',
        measurement: 'Binance server time minus backend time',
        value: fmtSignedMs(info.serverTimeDiffMs),
        detail: info.timeSyncTs
          ? 'Observed ' + fmtAge(info.timeSyncTs) + '; signed requests depend on a sane timestamp window.'
          : 'No successful server-time comparison is exposed.',
        state: driftState(info.serverTimeDiffMs),
        fix: 'Check host NTP/time sync and retry the Binance server-time probe.',
        icon: Clock,
      },
      {
        id: 'binance-error',
        group: 'Exchange',
        source: 'Latest Binance Error',
        measurement: 'Signed account source error state',
        value: binance.lastError ? 'Recorded' : binance.keysPresent ? 'None' : 'Not Configured',
        detail: binance.lastError ?? (binance.keysPresent ? 'No current Binance account error is reported.' : 'No signed account source is configured.'),
        state: binance.lastError ? 'broken' : binance.keysPresent ? 'healthy' : 'not_configured',
        fix: 'Read the exact error in Logs, then verify key scope, IP restriction, rate limits, and endpoint recovery.',
        icon: AlertTriangle,
      },
      {
        id: 'order-cache',
        group: 'Account',
        source: 'Open-Order Cache',
        measurement: 'Latest signed open-orders sync',
        value: info.lastOrdersSyncTs ? fmtAge(info.lastOrdersSyncTs) : binance.keysPresent ? 'Never Synced' : 'Not Configured',
        detail: binance.keysPresent ? 'Open-order truth is refreshed by signed account polling.' : 'Order sync is unavailable without server-side keys.',
        state: orderSyncState,
        fix: 'Confirm open-order polling completes and the resulting account actions remain ledgered.',
        icon: List,
      },
      {
        id: 'token-profiles',
        group: 'External',
        source: 'Token Profiles',
        measurement: 'CoinGecko facts across the tracked universe',
        value: !profiles || profiles.total <= 0
          ? 'Not Started'
          : profiles.running
            ? String(profiles.done) + ' / ' + String(profiles.total)
            : String(profiles.ok + profiles.na) + ' / ' + String(profiles.total) + ' Ready',
        detail: profileError
          ? profileError
          : !profiles || profiles.total <= 0
          ? 'The token-profile warmer has not reported a tracked universe yet.'
          : profiles.running
            ? 'Warming ' + (profiles.current ?? 'next asset') + ' · ' + String(profiles.ok) + ' verified.'
            : String(profiles.ok) + ' verified · ' + String(profiles.na) + ' N/A · ' + String(profiles.failed.length) + ' failed · ' + String(profiles.suspect.length) + ' suspect.',
        state: profileState,
        fix: 'Re-run the existing token-profile warmer; failed bases may require a verified query alias.',
        icon: Coins,
      },
      {
        id: 'engine-heartbeat',
        group: 'Engine',
        source: 'Engine Heartbeat',
        measurement: 'Dedicated engine-process heartbeat',
        value: 'Not Started',
        detail: 'Scanner ticks exist, but /api/system exposes no dedicated engine heartbeat.',
        state: 'not_configured',
        fix: 'Wire the engine heartbeat before treating scanner proposals as engine-owned process truth.',
        icon: Cpu,
      },
    ];
    if (!loadError) return currentChecks;
    return currentChecks.map((check) => check.state === 'healthy' ? {
      ...check,
      state: 'degraded' as HealthState,
      detail: `Latest system refresh failed; retained evidence may be stale. ${check.detail}`,
    } : check);
  }, [browserLatencyMs, connected, info, loadError, profileError, profiles, state?.binance, state?.scanner.lastTickTs]);

  const sortedChecks = useMemo(() => [...checks].sort((left, right) => {
    const rank = STATE_RANK[right.state] - STATE_RANK[left.state];
    if (rank !== 0) return rank;
    const group = left.group.localeCompare(right.group);
    return group !== 0 ? group : left.source.localeCompare(right.source);
  }), [checks]);

  const visibleChecks = useMemo(
    () => sortedChecks.filter((check) => filterMatches(check, filter)),
    [filter, sortedChecks],
  );

  const counts = checks.reduce(
    (result, check) => {
      result[check.state] += 1;
      return result;
    },
    { healthy: 0, degraded: 0, broken: 0, not_configured: 0 } as Record<HealthState, number>,
  );

  const overallState = worstState(checks.map((check) => check.state));
  const attentionChecks = sortedChecks.filter((check) => check.state !== 'healthy');
  const topIssue = attentionChecks[0] ?? null;
  const feedEntries = info ? Object.entries(info.feeds) : [];
  const liveFeedCount = feedEntries.filter(([, status]) => status === 'open' || status === 'live').length;
  const accessLabel = info?.cfUser ? 'Cloudflare Access' : 'Local Session';

  const filterCount = (target: HealthFilter): number => checks.filter((check) => filterMatches(check, target)).length;

  return (
    <div className="container page healthx-page">
      <section className="healthx-frame">
        <header className="healthx-toolbar">
          <div className="healthx-title">
            <img className="healthx-page-mark" src="/health-shield.png" alt="" aria-hidden="true" />
            <h1>Health</h1>
            <span className={'healthx-live ' + overallState}>
              <i aria-hidden="true" />
              {info ? readinessLabel(overallState) : loadError ? 'Unavailable' : 'Reading'}
            </span>
            <span className="healthx-updated">
              {readTs ? 'Updated ' + timeAgo(readTs) : loading ? 'Reading Sources' : 'Waiting'}
            </span>
          </div>
          <div className="healthx-toolbar-actions">
            <span className="healthx-access">
              <ShieldCheck size={14} />
              {accessLabel}
            </span>
            <button
              type="button"
              className={'healthx-button' + (loading ? ' loading' : '')}
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={14} />
              {loading ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
        </header>

        {info ? (
          <>
            <div className="healthx-summary" aria-label="Health Summary">
              <div className="healthx-summary-cell">
                <span>Readiness</span>
                <strong className={overallState}>{readinessLabel(overallState)}</strong>
                <small>{topIssue ? topIssue.source + ' · ' + STATE_LABEL[topIssue.state] : 'All configured sources are healthy.'}</small>
              </div>
              <div className="healthx-summary-cell">
                <span>Sources Ready</span>
                <strong>{counts.healthy} <em>/ {checks.length}</em></strong>
                <small>{counts.broken} broken · {counts.degraded} degraded · {counts.not_configured} not configured</small>
              </div>
              <div className="healthx-summary-cell">
                <span>Data Path</span>
                <strong>{liveFeedCount} <em>/ {feedEntries.length} streams</em></strong>
                <small>{fmtMs(info.restLatencyMs)} REST · scanner {fmtAge(info.lastScannerTickTs)}</small>
              </div>
              <div className="healthx-summary-cell">
                <span>Runtime</span>
                <strong>{fmtUptime(info.uptimeSec)}</strong>
                <small>v{info.version} · {info.env} · {info.pairs} pairs</small>
              </div>
            </div>

            {loadError ? (
              <div className="healthx-alert">
                <AlertTriangle size={14} />
                Latest refresh failed: {loadError}. Showing the last successful snapshot.
              </div>
            ) : null}

            <div className="healthx-filters">
              <div className="healthx-segments" role="tablist" aria-label="Health Sources">
                {FILTERS.map((item) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={filter === item.id}
                    className={filter === item.id ? 'selected' : ''}
                    key={item.id}
                    onClick={() => {
                      setFilter(item.id);
                      setExpanded(null);
                    }}
                  >
                    {item.label}
                    <span>{filterCount(item.id)}</span>
                  </button>
                ))}
              </div>
              <div className="healthx-filter-actions">
                <span>{visibleChecks.length} source{visibleChecks.length === 1 ? '' : 's'}</span>
                <button type="button" className="healthx-button" onClick={() => setPage('ledger')}>
                  <BookOpen size={14} />
                  Audit Ledger
                </button>
              </div>
            </div>

            <div className="healthx-table" role="table" aria-label="System Health Sources">
              <div className="healthx-table-head" role="row">
                <span role="columnheader">State</span>
                <span role="columnheader">Source</span>
                <span role="columnheader">Current</span>
                <span role="columnheader">Evidence</span>
                <span aria-hidden="true" />
              </div>

              {visibleChecks.length ? visibleChecks.map((check) => {
                const SourceIcon = check.icon;
                const isExpanded = expanded === check.id;
                return (
                  <div className={'healthx-source-item ' + check.state} role="rowgroup" key={check.id}>
                    <button
                      type="button"
                      className="healthx-source-row"
                      aria-expanded={isExpanded}
                      onClick={() => setExpanded(isExpanded ? null : check.id)}
                    >
                      <span className={'healthx-state ' + check.state} role="cell">
                        <i aria-hidden="true" />
                        {STATE_LABEL[check.state]}
                      </span>
                      <span className="healthx-source" role="cell">
                        <span className="healthx-source-icon" aria-hidden="true">
                          <SourceIcon size={15} strokeWidth={1.7} />
                        </span>
                        <span>
                          <strong>{check.source}</strong>
                          <small>{check.group}</small>
                        </span>
                      </span>
                      <span className="healthx-current" role="cell">
                        <strong>{check.value}</strong>
                        <small>{check.measurement}</small>
                      </span>
                      <span className="healthx-evidence" role="cell" title={check.detail}>{check.detail}</span>
                      <ChevronDown className={isExpanded ? 'expanded' : ''} size={15} aria-hidden="true" />
                    </button>
                    {isExpanded ? (
                      <div className="healthx-source-detail">
                        <div>
                          <span>Operator Guidance</span>
                          <p>{check.fix}</p>
                        </div>
                        <div>
                          <span>Measurement Source</span>
                          <p>{check.measurement}</p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              }) : (
                <div className="healthx-empty">
                  <Activity size={18} />
                  No sources match this filter.
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="healthx-empty healthx-loading">
            <Activity size={18} />
            <strong>{loadError ? 'Health Snapshot Unavailable' : 'Reading Health Sources'}</strong>
            <span>{loadError ?? 'Waiting for /api/system.'}</span>
            {loadError ? (
              <button type="button" className="healthx-button" onClick={() => void load()}>Try Again</button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

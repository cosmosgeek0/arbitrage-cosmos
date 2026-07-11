import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleAlert,
  Database,
  Gauge,
  Radio,
  ScanLine,
  ShieldCheck,
  WalletCards,
  X,
} from 'lucide-react';
import { EquityChart, PerfChart, type PerfDay } from '../components/PerfChart';
import { TokenIcon } from '../components/TokenIcon';
import { useRefreshSignal } from '../lib/refresh';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import type { BasisSnapshot } from '../lib/basisRuntime';
import { useStore, type Page } from '../store';
import { fmtMoney, fmtPrice, signClass, timeAgo } from '../format';
import type { LedgerEvent } from '../types';
import './Dashboard.css';

type RangeId = '1W' | '1M' | '3M' | '6M';
type Tone = 'ok' | 'warn' | 'bad' | 'idle';

const RANGES: { id: RangeId; ms: number }[] = [
  { id: '1W', ms: 7 * 86_400_000 },
  { id: '1M', ms: 31 * 86_400_000 },
  { id: '3M', ms: 93 * 86_400_000 },
  { id: '6M', ms: 186 * 86_400_000 },
];

interface Source<T> {
  data: T | null;
  error: string | null;
}

interface PnlData {
  realizedByDay: PerfDay[];
  realizedBySymbol: { symbol: string; usd: number }[];
  feesByAsset: { asset: string; amount: number }[];
  integrity: { complete: boolean; reasons: string[] };
}

interface EquityHistory {
  rows: { ts: number; totalUsdt: number }[];
  reconstructedBefore: number | null;
  reconstruction?: { complete: boolean; reasons: string[] };
  fetchedAt: number | null;
}

interface VolumeRow {
  symbol: string;
  base: string;
  state: 'IDLE' | 'WATCHING' | 'FOCUS' | 'PROPOSED' | 'REJECTED' | 'ACTIVE' | 'COOLDOWN';
  decisionKind: 'ignore' | 'watch' | 'focus' | 'proposal' | 'reject' | 'warming';
  rejectCode: string | null;
  reason: string;
  decisionTs: number | null;
  volumeMultiple: Record<string, number | null | undefined>;
}

interface VolumeSnapshot {
  updatedAt: number;
  status: {
    running: boolean;
    streamState: 'starting' | 'connecting' | 'open' | 'degraded';
    streamConnections: number;
    openConnections: number;
    bookState: 'fresh' | 'stale';
    universeSize: number;
    eligibleSize: number;
    observedSymbols: number;
    baselineReady: number;
    baselineTotal: number;
    watching: number;
    focused: number;
    openProposals: number;
    lastTradeTs: number | null;
    lastBookTs: number | null;
    tradeMessages: number;
    source: string;
    bookSource: string;
    baselineSource: string;
  };
  rows: VolumeRow[];
}

interface SystemSnapshot {
  ok: boolean;
  dbOk: boolean;
  restLatencyMs: number | null;
  serverTimeDiffMs: number | null;
  usedWeight1m: number | null;
  uptimeSec: number;
}

interface RuntimeRow {
  id: 'basis' | 'volume';
  name: string;
  source: string;
  tone: Tone;
  state: string;
  intake: string;
  coverage: string;
  watching: number;
  focused: number;
  proposals: number;
  constraint: string;
  updatedAt: number | null;
  page: Page;
}

interface IntegrityCheck {
  label: string;
  detail: string;
  tone: Tone;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function source<T>(): Source<T> {
  return { data: null, error: null };
}

function titleCase(value: string): string {
  return value.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventData(event: LedgerEvent): Record<string, unknown> {
  return event.data && typeof event.data === 'object' ? event.data as Record<string, unknown> : {};
}

function eventTone(event: LedgerEvent): Tone {
  const data = eventData(event);
  if (data.kind === 'proposal' || event.kind.includes('approved')) return 'ok';
  if (data.kind === 'reject' || data.rejectCode || event.kind.includes('rejected')) return 'bad';
  if (data.kind === 'focus' || event.kind.includes('candidate')) return 'warn';
  return 'idle';
}

function decisionMessage(event: LedgerEvent): string {
  const data = eventData(event);
  return String(data.message ?? data.reason ?? data.rejectCode ?? event.kind);
}

function strategyLabel(event: LedgerEvent): string {
  const data = eventData(event);
  const strategy = String(data.strategy ?? (event.kind.startsWith('basis.') ? 'basis' : 'system'));
  return strategy === 'volume_spike' ? 'Volume' : titleCase(strategy);
}

function sourceAge(updatedAt: number | null): string {
  return updatedAt ? timeAgo(updatedAt) : 'Unavailable';
}

function useDashboardSources(refreshTick: number) {
  const [basis, setBasis] = useState<Source<BasisSnapshot>>(source);
  const [volume, setVolume] = useState<Source<VolumeSnapshot>>(source);
  const [pnl, setPnl] = useState<Source<PnlData>>(source);
  const [history, setHistory] = useState<Source<EquityHistory>>(source);
  const [system, setSystem] = useState<Source<SystemSnapshot>>(source);

  useEffect(() => {
    const commit = <T,>(
      result: PromiseSettledResult<T>,
      setter: React.Dispatch<React.SetStateAction<Source<T>>>,
    ) => {
      if (result.status === 'fulfilled') setter({ data: result.value, error: null });
      else setter((current) => ({ data: current.data, error: apiErrorMessage(result.reason, 'Source unavailable') }));
    };
    const fast = createSettledPoll<[PromiseSettledResult<BasisSnapshot>, PromiseSettledResult<VolumeSnapshot>]>({
      intervalMs: 2_000,
      request: (signal) => Promise.allSettled([
        fetchJson<BasisSnapshot>('/api/engine/basis', { cache: 'no-store', signal }),
        fetchJson<VolumeSnapshot>('/api/engine/volume', { cache: 'no-store', signal }),
      ]) as Promise<[PromiseSettledResult<BasisSnapshot>, PromiseSettledResult<VolumeSnapshot>]>,
      onSuccess: ([basisResult, volumeResult]) => {
        commit(basisResult, setBasis);
        commit(volumeResult, setVolume);
      },
      onError: (error) => {
        const message = apiErrorMessage(error, 'Source unavailable');
        setBasis((current) => ({ data: current.data, error: message }));
        setVolume((current) => ({ data: current.data, error: message }));
      },
    });
    const slow = createSettledPoll<[
      PromiseSettledResult<PnlData>,
      PromiseSettledResult<EquityHistory>,
      PromiseSettledResult<SystemSnapshot>,
    ]>({
      intervalMs: 30_000,
      request: (signal) => Promise.allSettled([
        fetchJson<PnlData>('/api/pnl', { cache: 'no-store', signal }),
        fetchJson<EquityHistory>('/api/equity-history', { cache: 'no-store', signal }),
        fetchJson<SystemSnapshot>('/api/system', { cache: 'no-store', signal }),
      ]) as Promise<[
        PromiseSettledResult<PnlData>,
        PromiseSettledResult<EquityHistory>,
        PromiseSettledResult<SystemSnapshot>,
      ]>,
      onSuccess: ([pnlResult, historyResult, systemResult]) => {
        commit(pnlResult, setPnl);
        if (historyResult.status === 'fulfilled') {
          const integrity = historyResult.value.reconstruction;
          setHistory({
            data: historyResult.value,
            error: integrity && !integrity.complete
              ? integrity.reasons[0] ?? 'Older account reconstruction is unavailable'
              : null,
          });
        } else {
          setHistory((current) => ({ data: current.data, error: apiErrorMessage(historyResult.reason, 'Source unavailable') }));
        }
        commit(systemResult, setSystem);
      },
      onError: (error) => {
        const message = apiErrorMessage(error, 'Source unavailable');
        setPnl((current) => ({ data: current.data, error: message }));
        setHistory((current) => ({ data: current.data, error: message }));
        setSystem((current) => ({ data: current.data, error: message }));
      },
    });
    fast.start();
    slow.start();
    return () => {
      fast.stop();
      slow.stop();
    };
  }, [refreshTick]);

  return { basis, volume, pnl, history, system };
}

function StatusMark({ tone }: { tone: Tone }) {
  return <span className={`dcx-status-mark ${tone}`} aria-hidden="true">{tone === 'ok' ? <Check size={11} /> : tone === 'bad' ? <X size={10} /> : <CircleAlert size={11} />}</span>;
}

function Metric({ label, value, detail, tone = 'idle' }: { label: string; value: string; detail: string; tone?: Tone }) {
  return (
    <div className={`dcx-summary-cell ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function Dashboard() {
  const { state, connected, setPage } = useStore();
  const [refreshTick, setRefreshTick] = useState(0);
  const [range, setRange] = useState<RangeId>('1M');
  useRefreshSignal(() => setRefreshTick((value) => value + 1));
  const sources = useDashboardSources(refreshTick);

  const account = state?.account ?? null;
  const positions = state?.positions ?? [];
  const openOrders = state?.openOrders ?? [];
  const exposure = positions.reduce((sum, position) => sum + position.valueUsdt, 0);
  const heldNotional = openOrders.reduce((sum, order) => sum + order.price * order.origQty, 0);
  const dayChange = account?.dayChangeUsd ?? null;
  const dayChangePct = finite(dayChange) && finite(account?.dayOpenEquity) && account!.dayOpenEquity! > 0
    ? (dayChange / account!.dayOpenEquity!) * 100
    : null;

  const historyPoints = useMemo(() => {
    const rows = [...(sources.history.data?.rows ?? [])]
      .filter((row) => finite(row.totalUsdt) && finite(row.ts))
      .map((row) => ({ ts: row.ts, totalUsdt: row.totalUsdt }));
    if (account?.complete && finite(account.totalUsdt)) {
      rows.push({ ts: state?.binance.lastSyncTs ?? sources.history.data?.fetchedAt ?? Date.now(), totalUsdt: account.totalUsdt });
    }
    rows.sort((left, right) => left.ts - right.ts);
    const deduped: { ts: number; totalUsdt: number }[] = [];
    for (const point of rows) {
      const previous = deduped[deduped.length - 1];
      if (previous && Math.abs(previous.ts - point.ts) < 1_000) deduped[deduped.length - 1] = point;
      else deduped.push(point);
    }
    const rangeMs = RANGES.find((item) => item.id === range)?.ms ?? RANGES[1].ms;
    const cutoff = Date.now() - rangeMs;
    const selected = deduped.filter((point) => point.ts >= cutoff);
    const previous = [...deduped].reverse().find((point) => point.ts < cutoff);
    if (previous) selected.unshift(previous);
    return selected;
  }, [account?.complete, account?.totalUsdt, range, sources.history.data, state?.binance.lastSyncTs]);

  const historyStats = useMemo(() => {
    if (historyPoints.length < 2) return null;
    const first = historyPoints[0].totalUsdt;
    const last = historyPoints[historyPoints.length - 1].totalUsdt;
    const values = historyPoints.map((point) => point.totalUsdt);
    return {
      first,
      last,
      change: last - first,
      changePct: first > 0 ? ((last / first) - 1) * 100 : null,
      high: Math.max(...values),
      low: Math.min(...values),
    };
  }, [historyPoints]);
  const historyCoverage = sources.history.data?.reconstruction?.complete
    ? 'Spot Balance History · Transfers And Borrowing Included · Not Strategy PnL'
    : 'Spot Balance History · Signed Snapshots Only · Older Reconstruction Unavailable';

  const basis = sources.basis.data;
  const volume = sources.volume.data;
  const system = sources.system.data;
  const basisLive = Boolean(!sources.basis.error && basis?.status.running && basis.status.bookState === 'fresh' && basis.status.markState === 'fresh' && !basis.status.lastError);
  const volumeLive = Boolean(!sources.volume.error && volume?.status.running && volume.status.streamState === 'open' && volume.status.bookState === 'fresh');
  const accountFresh = Boolean(state?.binance.connected && state.binance.lastSyncTs && Date.now() - state.binance.lastSyncTs < 90_000);
  const feedsOpen = state ? Object.values(state.feeds).length > 0 && Object.values(state.feeds).every((feed) => feed === 'open') : false;
  const keySafe = state?.binance.keyPosture.level === 'read_only';
  const ledgerReady = !sources.system.error && system?.dbOk === true;

  const integrityChecks: IntegrityCheck[] = [
    {
      label: 'Account Sync',
      detail: accountFresh ? `Fresh · ${timeAgo(state?.binance.lastSyncTs ?? null)}` : state?.binance.connected ? 'Stale Signed Snapshot' : 'Not Connected',
      tone: accountFresh ? 'ok' : 'bad',
    },
    {
      label: 'Public Market Feeds',
      detail: feedsOpen ? `${Object.keys(state?.feeds ?? {}).length} Streams Open` : 'One Or More Streams Down',
      tone: feedsOpen ? 'ok' : 'bad',
    },
    {
      label: 'Basis Runtime',
      detail: basisLive ? `${basis?.status.dataQualityPassing ?? 0}/${basis?.status.universeSize ?? 0} Quality Passing` : sources.basis.error ?? basis?.status.lastError ?? 'Starting',
      tone: basisLive ? 'ok' : sources.basis.error ? 'bad' : 'warn',
    },
    {
      label: 'Volume Runtime',
      detail: volumeLive ? `${volume?.status.baselineReady ?? 0}/${volume?.status.baselineTotal ?? 0} Baselines Ready` : sources.volume.error ?? 'Starting',
      tone: volumeLive ? 'ok' : sources.volume.error ? 'bad' : 'warn',
    },
    {
      label: 'Ledger Database',
      detail: ledgerReady ? 'Writable' : system ? 'Unavailable' : 'Checking',
      tone: ledgerReady ? 'ok' : system ? 'bad' : 'warn',
    },
    {
      label: 'API Key Posture',
      detail: state?.binance.keyPosture.label ?? 'Checking',
      tone: keySafe ? 'ok' : state?.binance.keyPosture.tone ?? 'warn',
    },
  ];
  const passingChecks = integrityChecks.filter((check) => check.tone === 'ok').length;
  const systemLive = connected && accountFresh && feedsOpen && basisLive && volumeLive && ledgerReady;

  const topBasis = useMemo(() => {
    if (!basis) return null;
    return [...basis.rows]
      .filter((row) => finite(row.netEdgePct) && row.decisionKind !== 'ignore')
      .sort((left, right) => (right.netEdgePct ?? -Infinity) - (left.netEdgePct ?? -Infinity))[0] ?? null;
  }, [basis]);

  const topVolume = useMemo(() => {
    if (!volume) return null;
    const rank = (row: VolumeRow) => row.state === 'PROPOSED' ? 5 : row.state === 'FOCUS' ? 4 : row.state === 'WATCHING' ? 3 : row.decisionKind === 'reject' ? 2 : 1;
    return [...volume.rows].sort((left, right) => {
      const stateRank = rank(right) - rank(left);
      if (stateRank) return stateRank;
      return Number(right.volumeMultiple['5s'] ?? 0) - Number(left.volumeMultiple['5s'] ?? 0);
    })[0] ?? null;
  }, [volume]);

  const runtimeRows: RuntimeRow[] = [
    {
      id: 'basis',
      name: 'Basis Engine',
      source: basis?.status.bookSource ?? 'Binance Spot + USD-M Books',
      tone: basisLive ? 'ok' : sources.basis.error ? 'bad' : 'warn',
      state: basisLive ? 'Live' : sources.basis.error ? 'Unavailable' : 'Starting',
      intake: basis ? `${basis.status.universeSize} Pairs` : '—',
      coverage: basis ? `${basis.status.dataQualityPassing}/${basis.status.universeSize}` : '—',
      watching: basis?.status.watching ?? 0,
      focused: basis?.status.focused ?? 0,
      proposals: basis?.status.openProposals ?? 0,
      constraint: basis?.status.borrowBlocked ? `${basis.status.borrowBlocked} Borrow Blocked` : topBasis?.reason ?? 'No Active Constraint',
      updatedAt: basis?.updatedAt ?? null,
      page: 'strategies',
    },
    {
      id: 'volume',
      name: 'Volume Engine',
      source: volume?.status.source ?? 'Binance Aggregate Trades',
      tone: volumeLive ? 'ok' : sources.volume.error ? 'bad' : 'warn',
      state: volumeLive ? 'Live' : sources.volume.error ? 'Unavailable' : 'Starting',
      intake: volume ? `${volume.status.observedSymbols}/${volume.status.eligibleSize}` : '—',
      coverage: volume ? `${volume.status.baselineReady}/${volume.status.baselineTotal}` : '—',
      watching: volume?.status.watching ?? 0,
      focused: volume?.status.focused ?? 0,
      proposals: volume?.status.openProposals ?? 0,
      constraint: topVolume?.rejectCode ? titleCase(topVolume.rejectCode) : topVolume?.reason ?? 'No Verified Wakeup',
      updatedAt: volume?.updatedAt ?? null,
      page: 'volume',
    },
  ];

  const recentDecisions = useMemo(() => {
    const seen = new Set<string>();
    return (state?.events ?? [])
      .filter((event) => event.kind.includes('strategy_decision') || event.kind === 'candidate_opened' || event.kind === 'candidate_rejected' || event.kind === 'risk_decision')
      .filter((event) => {
        const data = eventData(event);
        const key = String(data.correlationId ?? `${strategyLabel(event)}:${event.symbol ?? 'system'}:${decisionMessage(event)}`);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  }, [state?.events]);

  const pnlDays = sources.pnl.data?.realizedByDay ?? [];
  const realizedTotal = pnlDays.reduce((sum, day) => sum + day.usd, 0);
  const winningDays = pnlDays.filter((day) => day.usd > 0);
  const losingDays = pnlDays.filter((day) => day.usd < 0);
  const grossProfit = winningDays.reduce((sum, day) => sum + day.usd, 0);
  const grossLoss = Math.abs(losingDays.reduce((sum, day) => sum + day.usd, 0));
  const dailyProfitFactor = grossLoss > 0 ? grossProfit / grossLoss : winningDays.length ? Infinity : null;
  const usdtFees = sources.pnl.data?.feesByAsset.find((fee) => fee.asset === 'USDT')?.amount ?? 0;

  const controlState = state?.config.killSwitch
    ? { label: 'Bot Stopped', detail: 'Kill Switch On', tone: 'ok' as Tone }
    : state?.config.liveTradingEnabled
      ? { label: 'Live Armed', detail: 'Risk Gate Required', tone: 'warn' as Tone }
      : { label: 'Manual Guarded', detail: 'Live Orders Off', tone: 'ok' as Tone };

  const queueCount = (basis?.status.watching ?? 0) + (basis?.status.focused ?? 0) + (volume?.status.watching ?? 0) + (volume?.status.focused ?? 0);
  const latestUpdate = Math.max(basis?.updatedAt ?? 0, volume?.updatedAt ?? 0, state?.binance.lastSyncTs ?? 0);

  if (!state) {
    return (
      <div className="container page dash-page dcx-page">
        <section className="dcx-frame dcx-loading" aria-label="dashboard workspace">
          <Radio size={18} />
          <span><b>Connecting Dashboard</b><small>Waiting for account, engine, and ledger state.</small></span>
        </section>
      </div>
    );
  }

  const open = (page: Page) => setPage(page);

  return (
    <div className="container page dash-page dcx-page">
      <section className="dcx-frame" aria-label="dashboard workspace">
        <header className="dcx-toolbar">
          <div className="dcx-title">
            <span className="dcx-source-mark"><img className="dcx-page-mark" src="/dashboard-blocks.png" alt="" aria-hidden="true" /></span>
            <span className="dcx-title-content">
              <h1>Dashboard</h1>
              <span className={`dcx-live ${systemLive ? 'active' : 'degraded'}`}><i aria-hidden="true" />{systemLive ? 'System Live' : 'Review Required'}</span>
              <span className="dcx-updated">{latestUpdate ? `Updated ${timeAgo(latestUpdate)}` : 'Connecting Sources'}</span>
            </span>
          </div>
          <div className="dcx-toolbar-actions">
            <button type="button" onClick={() => open('account')}><WalletCards size={14} />Account</button>
            <button type="button" onClick={() => open('risk')}><ShieldCheck size={14} />Risk</button>
          </div>
        </header>

        <div className="dcx-summary" aria-label="Executive Summary">
          <Metric
            label={account?.complete === false ? 'Partial Account Value' : 'Estimated Total Value'}
            value={account ? fmtPrice(account.totalUsdt) : '—'}
            detail={account?.complete === false ? (account.unpricedAssets.length ? `${account.unpricedAssets.join(', ')} Unpriced` : 'Signed Account Source Is Stale') : 'Signed Binance Account'}
            tone={account?.complete === false ? 'warn' : 'idle'}
          />
          <Metric
            label="Today’s Account Change"
            value={finite(dayChange) ? `${dayChange > 0 ? '+' : ''}${fmtPrice(dayChange)}` : '—'}
            detail={account?.complete === false ? 'Current Equity Is Partially Priced' : dayChangePct === null ? 'Day Open Unavailable' : `${dayChangePct > 0 ? '+' : ''}${dayChangePct.toFixed(2)}% From Day Open`}
            tone={finite(dayChange) ? (dayChange >= 0 ? 'ok' : 'bad') : 'idle'}
          />
          <Metric label="Available USDT" value={account ? fmtPrice(account.availableUsdt) : '—'} detail="Free Spot Balance" />
          <Metric label="Active Exposure" value={fmtPrice(exposure)} detail={`${positions.length} Position${positions.length === 1 ? '' : 's'} · ${fmtMoney(heldNotional)} Held`} />
          <Metric label="Engine Queue" value={String(queueCount)} detail={`${(basis?.status.openProposals ?? 0) + (volume?.status.openProposals ?? 0)} Open Proposals`} tone={queueCount ? 'warn' : 'idle'} />
          <Metric label="Control State" value={controlState.label} detail={controlState.detail} tone={controlState.tone} />
        </div>

        <section className="dcx-section dcx-capital-section">
          <header className="dcx-section-head">
            <span><b>Account Progress</b><small title={sources.history.data?.reconstruction?.reasons.join(' · ') || undefined}>{historyCoverage}</small></span>
            <div className="dcx-range" role="tablist" aria-label="Account History Range">
              {RANGES.map((item) => (
                <button key={item.id} type="button" role="tab" aria-selected={range === item.id} onClick={() => setRange(item.id)}>{item.id}</button>
              ))}
            </div>
          </header>
          <div className="dcx-capital-grid">
            <div className="dcx-chart-wrap">
              {historyPoints.length >= 2 ? (
                <EquityChart snaps={historyPoints} height={230} />
              ) : (
                <div className="dcx-empty"><BarChart3 size={18} /><span><b>Balance History Is Loading</b><small>The chart waits for the signed Binance history route.</small></span></div>
              )}
              <div className="dcx-chart-facts">
                <span><small>Range Open</small><b>{historyStats ? fmtPrice(historyStats.first) : '—'}</b></span>
                <span><small>Range Change</small><b className={historyStats ? signClass(historyStats.change) : ''}>{historyStats ? `${historyStats.change > 0 ? '+' : ''}${fmtPrice(historyStats.change)}` : '—'}</b></span>
                <span><small>Range High</small><b>{historyStats ? fmtPrice(historyStats.high) : '—'}</b></span>
                <span><small>Range Low</small><b>{historyStats ? fmtPrice(historyStats.low) : '—'}</b></span>
              </div>
            </div>
            <aside className="dcx-integrity" aria-label="Core Systems">
              <div className="dcx-integrity-head">
                <span><b>Core Systems</b><small>{passingChecks} Of {integrityChecks.length} Core Checks Passing</small></span>
                <strong>{passingChecks}/{integrityChecks.length}</strong>
              </div>
              <div className="dcx-integrity-list">
                {integrityChecks.map((check) => (
                  <div key={check.label} className="dcx-integrity-row">
                    <StatusMark tone={check.tone} />
                    <span><b>{check.label}</b><small>{check.detail}</small></span>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section className="dcx-section dcx-runtime-section">
          <header className="dcx-section-head">
            <span><b>Strategy Runtime</b><small>Live Engine Stages · Intake To Proposal</small></span>
            <em>{runtimeRows.filter((row) => row.tone === 'ok').length}/{runtimeRows.length} Engines Live</em>
          </header>
          <div className="dcx-runtime-scroll">
            <div className="dcx-runtime-canvas" role="table" aria-label="Strategy Runtime">
              <div className="dcx-runtime-header" role="row">
                <span role="columnheader">Engine</span><span role="columnheader">Intake</span><span role="columnheader">Coverage</span><span role="columnheader">Watching</span><span role="columnheader">Focused</span><span role="columnheader">Proposals</span><span role="columnheader">Primary Constraint</span><span role="columnheader">Updated</span>
              </div>
              {runtimeRows.map((row) => (
                <button className="dcx-runtime-row" type="button" role="row" key={row.id} onClick={() => open(row.page)}>
                  <span className="dcx-runtime-engine" role="cell">
                    <i className={`dcx-runtime-icon ${row.id}`}>{row.id === 'basis' ? <Gauge size={17} /> : <ScanLine size={17} />}</i>
                    <span><b>{row.name}</b><small>{row.source}</small></span>
                    <em className={row.tone}><i />{row.state}</em>
                  </span>
                  <span className="dcx-runtime-value" role="cell"><b>{row.intake}</b><small>Source Universe</small></span>
                  <span className="dcx-runtime-value" role="cell"><b>{row.coverage}</b><small>{row.id === 'basis' ? 'Quality Passing' : 'Baselines Ready'}</small></span>
                  <span className="dcx-runtime-value" role="cell"><b>{row.watching}</b><small>Near Gate</small></span>
                  <span className="dcx-runtime-value" role="cell"><b>{row.focused}</b><small>Deep Checks</small></span>
                  <span className="dcx-runtime-value" role="cell"><b>{row.proposals}</b><small>All Gates Passed</small></span>
                  <span className="dcx-runtime-constraint" role="cell"><b>{row.constraint}</b><small>{row.id === 'basis' ? `${basis?.status.verifiedBorrow ?? 0} Borrow Verified` : `${volume?.status.tradeMessages.toLocaleString() ?? '—'} Trade Messages`}</small></span>
                  <span className="dcx-runtime-open" role="cell"><b>{sourceAge(row.updatedAt)}</b><ChevronRight size={14} /></span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="dcx-operations">
          <div className="dcx-attention">
            <header className="dcx-section-head">
              <span><b>Attention Queue</b><small>Current Constraints And Highest-Signal Work</small></span>
            </header>
            <div className="dcx-attention-list">
              <button type="button" onClick={() => open('loans')}>
                <StatusMark tone={basis?.status.borrowBlocked ? 'warn' : 'ok'} />
                <span><b>Borrow Verification</b><small>{basis?.status.borrowBlocked ? `${basis.status.borrowBlocked} Reverse-Basis Decisions Blocked` : 'No Borrow Blocker In The Current Runtime'}</small></span>
                <em>{basis?.status.verifiedBorrow ?? 0} Verified</em><ChevronRight size={14} />
              </button>
              <button type="button" onClick={() => open('strategies')}>
                <StatusMark tone={topBasis ? (topBasis.decisionKind === 'proposal' ? 'ok' : 'warn') : 'idle'} />
                <span><b>{topBasis ? `${topBasis.base} Basis Decision` : 'Basis Decision Queue'}</b><small>{topBasis?.reason ?? 'No Basis Decision Above The Watch Gate'}</small></span>
                <em className={finite(topBasis?.netEdgePct) ? signClass(topBasis?.netEdgePct ?? 0) : ''}>{finite(topBasis?.netEdgePct) ? `${(topBasis?.netEdgePct ?? 0) > 0 ? '+' : ''}${topBasis?.netEdgePct.toFixed(2)}%` : '—'}</em><ChevronRight size={14} />
              </button>
              <button type="button" onClick={() => open('volume')}>
                <StatusMark tone={topVolume ? (topVolume.state === 'PROPOSED' ? 'ok' : topVolume.state === 'FOCUS' ? 'warn' : 'idle') : 'idle'} />
                <span><b>{topVolume ? `${topVolume.base} Volume Decision` : 'Volume Decision Queue'}</b><small>{topVolume?.reason ?? 'No Volume Decision Above The Watch Gate'}</small></span>
                <em>{topVolume?.state ? titleCase(topVolume.state.toLowerCase()) : '—'}</em><ChevronRight size={14} />
              </button>
              <button type="button" onClick={() => open('risk')}>
                <StatusMark tone={state.config.killSwitch ? 'ok' : state.config.liveTradingEnabled ? 'warn' : 'ok'} />
                <span><b>Execution Guard</b><small>{state.config.killSwitch ? 'Bot Stopped Before Order Routing' : state.config.liveTradingEnabled ? 'Live Orders Require The Full Risk Gate' : 'Manual Guarded Mode · Live Orders Off'}</small></span>
                <em>{state.risk.rejectionsToday} Rejected Today</em><ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="dcx-decisions">
            <header className="dcx-section-head">
              <span><b>Recent Decisions</b><small>Ledgered Engine And Risk Evidence</small></span>
              <button type="button" onClick={() => open('ledger')}>Open Logs <ArrowUpRight size={13} /></button>
            </header>
            <div className="dcx-decision-list">
              {recentDecisions.length ? recentDecisions.map((event) => (
                <button type="button" key={event.id} onClick={() => open('ledger')}>
                  <span className="dcx-decision-time">{new Date(event.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  <StatusMark tone={eventTone(event)} />
                  <span className="dcx-decision-source"><b>{strategyLabel(event)}</b><small>{event.symbol ?? 'System'}</small></span>
                  <span className="dcx-decision-message">{decisionMessage(event)}</span>
                  <em>{titleCase(String(eventData(event).kind ?? eventData(event).rejectCode ?? event.kind))}</em>
                </button>
              )) : (
                <div className="dcx-empty compact"><Activity size={17} /><span><b>No Recent Strategy Decisions</b><small>The ledger has no decision evidence in the current state window.</small></span></div>
              )}
            </div>
          </div>
        </section>

        <section className="dcx-section dcx-performance">
          <header className="dcx-section-head">
            <span>
              <b>{sources.pnl.data?.integrity.complete === false ? 'Partial Strategy Performance' : 'Validated Strategy Performance'}</b>
              <small title={sources.pnl.data?.integrity.reasons.join(' · ') || undefined}>{sources.pnl.data?.integrity.complete === false ? 'Missing Cost Basis Or Fee Valuation · Review Fill Coverage' : 'Closed Ledger Round-Trips Only · Account Balance Movement Is Excluded'}</small>
            </span>
            <em>{pnlDays.length} Realized Day{pnlDays.length === 1 ? '' : 's'}</em>
          </header>
          {pnlDays.length ? (
            <>
              <div className="dcx-performance-summary">
                <Metric label={sources.pnl.data?.integrity.complete === false ? 'Partial Realized PnL' : 'Realized PnL'} value={`${realizedTotal > 0 ? '+' : ''}${fmtPrice(realizedTotal)}`} detail={sources.pnl.data?.integrity.complete === false ? 'Incomplete Basis' : 'Ledgered Closed Fills'} tone={sources.pnl.data?.integrity.complete === false ? 'warn' : realizedTotal >= 0 ? 'ok' : 'bad'} />
                <Metric label="Trading Days" value={String(pnlDays.length)} detail="With Realized PnL" />
                <Metric label="Winning Days" value={String(winningDays.length)} detail={`${pnlDays.length ? ((winningDays.length / pnlDays.length) * 100).toFixed(0) : 0}% Day Win Rate`} />
                <Metric label="Losing Days" value={String(losingDays.length)} detail="Closed-Day Outcomes" />
                <Metric label="Daily Profit Factor" value={dailyProfitFactor === null ? '—' : dailyProfitFactor === Infinity ? '∞' : dailyProfitFactor.toFixed(2)} detail="Gross Winning Days / Losing Days" />
                <Metric label="USDT Fees" value={fmtPrice(usdtFees)} detail="Recorded Fee Asset" />
              </div>
              {pnlDays.length >= 2 ? <div className="dcx-performance-chart"><PerfChart days={pnlDays} /></div> : null}
            </>
          ) : (
            <div className="dcx-empty-performance">
              <BarChart3 size={20} />
              <span><b>Performance Reporting Is Waiting For The First Closed Round-Trip</b><small>Trade PnL, win rate, profit factor, and drawdown remain unreported until the ledger has real closed outcomes. No account snapshot is used as a substitute.</small></span>
              <button type="button" onClick={() => open('account')}>Review Fills <ChevronRight size={14} /></button>
            </div>
          )}
        </section>

        <footer className="dcx-source-footer">
          <span><Database size={13} />Sources: Binance Signed Account, Spot And USD-M Streams, Engine Snapshots, SQLite Ledger</span>
          <span>{system ? `${system.restLatencyMs ?? '—'} ms REST · ${system.usedWeight1m ?? '—'} Weight / Min · ${Math.round(system.uptimeSec / 60)} Min Uptime` : 'System Source Checking'}</span>
        </footer>
      </section>
    </div>
  );
}

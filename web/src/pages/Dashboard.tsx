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
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import { useProductControlRoomContext } from '../features/productControlRoom/ProductControlRoomProvider';
import { TokenIcon } from '../components/TokenIcon';
import { useRefreshSignal } from '../lib/refresh';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { formatClockZone } from '../lib/time';
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
  integrity: { state: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN'; complete: boolean; reasons: string[] };
}

interface EquityHistory {
  rows: { ts: number; totalUsdt: number }[];
  reconstructedBefore: number | null;
  reconstruction?: { complete: boolean; reasons: string[] };
  fetchedAt: number | null;
}

interface RuntimeRow {
  id: 'basis' | 'volume';
  name: string;
  source: string;
  tone: Tone;
  state: string;
  intake: string;
  coverage: string;
  watching: number | string;
  focused: number | string;
  proposals: number | string;
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

function sumKnown(values: readonly (number | null | undefined)[]): number | null {
  return values.every(finite) ? values.reduce<number>((sum, value) => sum + (value as number), 0) : null;
}

function latestKnown(values: readonly (number | null | undefined)[]): number | null {
  const known = values.filter(finite);
  return known.length ? Math.max(...known) : null;
}

function useDashboardSources(refreshTick: number) {
  const [pnl, setPnl] = useState<Source<PnlData>>(source);
  const history: Source<EquityHistory> = {
    data: null,
    error: 'NOT_CONFIGURED · private balance history is not mounted',
  };

  useEffect(() => {
    const slow = createSettledPoll<PnlData>({
      intervalMs: 30_000,
      request: (signal) => fetchJson<PnlData>('/api/pnl', { cache: 'no-store', signal }),
      onSuccess: (next) => setPnl({ data: next, error: null }),
      onError: (error) => setPnl({ data: null, error: apiErrorMessage(error, 'PnL truth unavailable') }),
    });
    slow.start();
    return slow.stop;
  }, [refreshTick]);

  return { pnl, history };
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
  const { state, stateStatus, stateLastSuccessAtMs, stateError, prefs, setPage } = useStore();
  const { binding: productBinding } = useProductControlRoomContext();
  const [refreshTick, setRefreshTick] = useState(0);
  const [range, setRange] = useState<RangeId>('1M');
  useRefreshSignal(() => setRefreshTick((value) => value + 1));
  const sources = useDashboardSources(refreshTick);

  const historyPoints = useMemo(() => {
    const rows = [...(sources.history.data?.rows ?? [])]
      .filter((row) => finite(row.totalUsdt) && finite(row.ts))
      .map((row) => ({ ts: row.ts, totalUsdt: row.totalUsdt }));
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
  }, [range, sources.history.data]);

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
  const historyCoverage = 'NOT_CONFIGURED · private balance history is not mounted';

  const productSnapshot = productBinding.snapshot;
  const dashboard = productSnapshot?.dashboard;
  const ledger = dashboard?.summaries.ledger;
  const componentById = (componentId: string) => productSnapshot?.components.find((component) => component.componentId === componentId);
  const spotSource = componentById('public-spot-source');
  const usdMSource = componentById('public-usdm-source');
  const basisComponent = componentById('basis-engine');
  const volumeComponent = componentById('volume-engine');
  const unavailablePosture = { tone: 'bad' as const, statusLabel: 'Unavailable' };
  const supervisorPosture = (component: typeof spotSource) => productBinding.continuity === 'PROVEN'
    ? component?.canonicalPresentation ?? unavailablePosture
    : unavailablePosture;
  const basisPosture = supervisorPosture(basisComponent);
  const volumePosture = supervisorPosture(volumeComponent);
  const runtimePresentation = productSnapshot && productBinding.continuity === 'PROVEN'
    ? productSnapshot.canonicalCockpit.strategyRuntime
    // F-061: absence of supervisor truth must not be presented as a measured
    // count of zero live engines. null renders as UNKNOWN.
    : { tone: 'bad' as const, label: 'Canonical Runtime Unavailable', livePublicCount: null };
  const marketFeedReadiness = productSnapshot && productBinding.continuity === 'PROVEN'
    ? productSnapshot.canonicalCockpit.marketFeedReadiness
    : null;
  const basisStrategy = dashboard?.summaries.strategies.basis;
  const volumeStrategy = dashboard?.summaries.strategies.volume;
  const publicSourceTone: Tone = marketFeedReadiness?.proven === true ? 'ok' : 'bad';
  const publicSourceDetail = [spotSource, usdMSource].filter(Boolean).map((component) => (
    `${component!.componentId} · ${component!.observedLifecycle} · ${component!.capability} · ${component!.truthLabel}`
  )).join(' / ') || 'UNKNOWN · canonical public-source components are unavailable';
  const ledgerReady = Boolean(
    productBinding.continuity === 'PROVEN'
    && ledger?.writable === true
    && ledger.schemaCompatibilityState === 'AVAILABLE',
  );

  const integrityChecks: IntegrityCheck[] = [
    {
      label: 'Account Sync',
      detail: 'NOT_CONFIGURED · private account reads are not mounted',
      tone: 'warn',
    },
    {
      label: 'Public Market Feeds',
      detail: publicSourceDetail,
      tone: publicSourceTone,
    },
    {
      label: 'Basis Runtime',
      detail: basisComponent
        ? `${basisComponent.observedLifecycle} · ${basisComponent.capability} · ${basisComponent.truthLabel}${basisComponent.blockerCode ? ` · ${basisComponent.blockerCode}` : ''}`
        : 'UNKNOWN · canonical Basis component is unavailable',
      tone: basisPosture.tone,
    },
    {
      label: 'Volume Runtime',
      detail: volumeComponent
        ? `${volumeComponent.observedLifecycle} · ${volumeComponent.capability} · ${volumeComponent.truthLabel}${volumeComponent.blockerCode ? ` · ${volumeComponent.blockerCode}` : ''}`
        : 'UNKNOWN · canonical Volume component is unavailable',
      tone: volumePosture.tone,
    },
    {
      label: 'Ledger Database',
      detail: ledgerReady
        ? `Writable · schema ${ledger?.currentSchemaVersion ?? 'UNKNOWN'}`
        : ledger?.schemaCompatibilityReason ?? productBinding.error ?? 'UNKNOWN · canonical Ledger evidence unavailable',
      tone: ledgerReady ? 'ok' : 'bad',
    },
    {
      label: 'API Key Posture',
      detail: 'OWNER_GATED · no private key posture is projected',
      tone: 'warn',
    },
  ];
  const passingChecks = integrityChecks.filter((check) => check.tone === 'ok').length;

  const runtimeRows: RuntimeRow[] = [
    {
      id: 'basis',
      name: 'Basis Engine',
      source: basisComponent?.owner.split(':')[0] ?? 'Canonical owner unavailable',
      tone: basisPosture.tone,
      state: basisPosture.statusLabel,
      intake: basisComponent?.capability.replaceAll('_', ' ') ?? 'UNKNOWN',
      coverage: basisComponent?.truthLabel.replaceAll('_', ' ') ?? 'UNKNOWN',
      watching: basisStrategy?.candidateCount ?? 'UNKNOWN',
      focused: 'UNKNOWN',
      proposals: basisStrategy?.proposalCount ?? 'UNKNOWN',
      constraint: basisComponent?.blockerCode ?? 'Private Borrow NOT_CONFIGURED · blocker UNKNOWN',
      updatedAt: latestKnown([basisComponent?.lastAdvanceAtMs, basisComponent?.heartbeatAtMs, basisStrategy?.lastDecisionAtMs]),
      page: 'strategies',
    },
    {
      id: 'volume',
      name: 'Volume Engine',
      source: volumeComponent?.owner.split(':')[0] ?? 'Canonical owner unavailable',
      tone: volumePosture.tone,
      state: volumePosture.statusLabel,
      intake: volumeComponent?.capability.replaceAll('_', ' ') ?? 'UNKNOWN',
      coverage: volumeComponent?.truthLabel.replaceAll('_', ' ') ?? 'UNKNOWN',
      watching: volumeStrategy?.candidateCount ?? 'UNKNOWN',
      focused: 'UNKNOWN',
      proposals: volumeStrategy?.proposalCount ?? 'UNKNOWN',
      constraint: volumeComponent?.blockerCode ?? 'UNKNOWN · canonical blocker not published',
      updatedAt: latestKnown([volumeComponent?.lastAdvanceAtMs, volumeComponent?.heartbeatAtMs, volumeStrategy?.lastDecisionAtMs]),
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

  const pnlTruthState = sources.pnl.data?.integrity.state ?? 'UNKNOWN';
  const pnlEvidenceAvailable = pnlTruthState !== 'UNKNOWN';
  const pnlDays = pnlEvidenceAvailable ? sources.pnl.data?.realizedByDay ?? [] : [];
  const realizedTotal = pnlEvidenceAvailable
    ? pnlDays.reduce((sum, day) => sum + day.usd, 0)
    : null;
  const winningDays = pnlDays.filter((day) => day.usd > 0);
  const losingDays = pnlDays.filter((day) => day.usd < 0);
  const grossProfit = winningDays.reduce((sum, day) => sum + day.usd, 0);
  const grossLoss = Math.abs(losingDays.reduce((sum, day) => sum + day.usd, 0));
  const dailyProfitFactor = grossLoss > 0 ? grossProfit / grossLoss : winningDays.length ? Infinity : null;
  const usdtFees = pnlEvidenceAvailable
    ? sources.pnl.data?.feesByAsset.find((fee) => fee.asset === 'USDT')?.amount ?? 0
    : null;

  const controlState = {
    label: 'OWNER_GATED',
    detail: 'LIVE_EXECUTION_NOT_IMPLEMENTED',
    tone: 'warn' as Tone,
  };

  const queueCount = sumKnown([basisStrategy?.candidateCount, volumeStrategy?.candidateCount]);
  const proposalCount = sumKnown([basisStrategy?.proposalCount, volumeStrategy?.proposalCount]);
  const latestUpdate = productSnapshot?.evaluatedAtMs ?? 0;

  if (!state) {
    return (
      <div className="container page dash-page dcx-page">
        <section className="dcx-frame dcx-loading" aria-label="dashboard workspace">
          <Radio size={18} />
          <span><b>Connecting Dashboard</b><small>Waiting for public engine and ledger state.</small></span>
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
              <span className={`dcx-live ${runtimePresentation.tone === 'ok' ? 'active' : 'degraded'}`}><i aria-hidden="true" />{runtimePresentation.label}</span>
              <span className="dcx-updated">{latestUpdate ? `Updated ${timeAgo(latestUpdate)}` : 'Connecting Sources'}</span>
            </span>
          </div>
          <div className="dcx-toolbar-actions">
            <button type="button" onClick={() => open('account')}><WalletCards size={14} />Account</button>
            <button type="button" onClick={() => open('risk')}><ShieldCheck size={14} />Risk</button>
          </div>
        </header>

        {stateStatus !== 'CURRENT' && (
          <div className="dcx-state-truth" role="alert">
            {stateStatus === 'STALE' ? 'STALE LAST-KNOWN' : 'UNAVAILABLE'} · Compatibility state
            {stateLastSuccessAtMs === null ? ' has no successful read.' : ` last succeeded ${timeAgo(stateLastSuccessAtMs)}.`}
            {stateError ? ` ${stateError}` : ''}
          </div>
        )}

        <div className="dcx-summary" aria-label="Executive Summary">
          <Metric
            label="Account Value"
            value="UNKNOWN"
            detail="NOT_CONFIGURED · private account reads are not mounted"
            tone="warn"
          />
          <Metric
            label="Today’s Account Change"
            value="UNKNOWN"
            detail="NOT_CONFIGURED · day-open account truth is unavailable"
            tone="warn"
          />
          <Metric label="Available USDT" value="UNKNOWN" detail="NOT_CONFIGURED · private balance unavailable" tone="warn" />
          <Metric label="Active Exposure" value="UNKNOWN" detail="NOT_CONFIGURED · positions and open orders are not read" tone="warn" />
          <Metric label="Engine Queue" value={queueCount === null ? 'UNKNOWN' : String(queueCount)} detail={proposalCount === null ? 'Proposal count unavailable' : `${proposalCount} Open Proposals`} tone={queueCount === null ? 'warn' : queueCount ? 'warn' : 'idle'} />
          <Metric label="Execution Authority" value={controlState.label} detail={controlState.detail} tone={controlState.tone} />
        </div>

        <ProductSurfaceAdapter surfaceId="dashboard" />

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
                <div className="dcx-empty"><BarChart3 size={18} /><span><b>Balance History Not Configured</b><small>Private balance history is not mounted; absence is not interpreted as zero.</small></span></div>
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
            <span><b>Strategy Runtime</b><small>Canonical Lifecycle · Capability · Truth</small></span>
            <em>{runtimePresentation.livePublicCount === null ? 'UNKNOWN' : runtimePresentation.livePublicCount}/{runtimeRows.length} Engines Live Public</em>
          </header>
          <div className="dcx-runtime-scroll">
            <div className="dcx-runtime-canvas" role="table" aria-label="Strategy Runtime">
              <div className="dcx-runtime-header" role="row">
                <span role="columnheader">Engine</span><span role="columnheader">Capability</span><span role="columnheader">Truth</span><span role="columnheader">Candidates</span><span role="columnheader">Focused</span><span role="columnheader">Proposals</span><span role="columnheader">Primary Constraint</span><span role="columnheader">Updated</span>
              </div>
              {runtimeRows.map((row) => (
                <button className="dcx-runtime-row" type="button" role="row" key={row.id} onClick={() => open(row.page)}>
                  <span className="dcx-runtime-engine" role="cell">
                    <i className={`dcx-runtime-icon ${row.id}`}>{row.id === 'basis' ? <Gauge size={17} /> : <ScanLine size={17} />}</i>
                    <span><b>{row.name}</b><small>{row.source}</small></span>
                    <em className={row.tone}><i />{row.state}</em>
                  </span>
                  <span className="dcx-runtime-value" role="cell"><b>{row.intake}</b><small>Canonical Capability</small></span>
                  <span className="dcx-runtime-value" role="cell"><b>{row.coverage}</b><small>Canonical Truth</small></span>
                  <span className="dcx-runtime-value" role="cell"><b>{row.watching}</b><small>Canonical Candidates</small></span>
                  <span className="dcx-runtime-value" role="cell"><b>{row.focused}</b><small>Not Published</small></span>
                  <span className="dcx-runtime-value" role="cell"><b>{row.proposals}</b><small>Canonical Proposals</small></span>
                  <span className="dcx-runtime-constraint" role="cell"><b>{row.constraint}</b><small>{row.id === 'basis' ? 'Private Borrow NOT_CONFIGURED · UNKNOWN' : 'Canonical Component Blocker'}</small></span>
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
                <StatusMark tone="warn" />
                <span><b>Borrow Verification</b><small>NOT_CONFIGURED · private inventory, rate, and maximum-borrowable truth are owner gated</small></span>
                <em>UNKNOWN</em><ChevronRight size={14} />
              </button>
              <button type="button" onClick={() => open('strategies')}>
                <StatusMark tone={basisPosture.tone} />
                <span><b>Basis Decision Queue</b><small>{basisComponent?.blockerCode ?? `${basisComponent?.truthLabel ?? 'UNKNOWN'} · ${basisStrategy?.sourceRevision ?? 'source revision UNKNOWN'}`}</small></span>
                <em>{basisStrategy?.proposalCount ?? 'UNKNOWN'} Proposals</em><ChevronRight size={14} />
              </button>
              <button type="button" onClick={() => open('volume')}>
                <StatusMark tone={volumePosture.tone} />
                <span><b>Volume Decision Queue</b><small>{volumeComponent?.blockerCode ?? `${volumeComponent?.truthLabel ?? 'UNKNOWN'} · ${volumeStrategy?.sourceRevision ?? 'source revision UNKNOWN'}`}</small></span>
                <em>{volumeStrategy?.proposalCount ?? 'UNKNOWN'} Proposals</em><ChevronRight size={14} />
              </button>
              <button type="button" onClick={() => open('risk')}>
                <StatusMark tone="warn" />
                <span><b>Execution Guard</b><small>OWNER_GATED · live execution is mechanically unavailable</small></span>
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
                  <span className="dcx-decision-time">{formatClockZone(event.ts, prefs.clockZone, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }, 'en-GB')}</span>
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
              <b>{pnlTruthState === 'UNKNOWN' ? 'Strategy Performance Unavailable' : pnlTruthState === 'PARTIAL' ? 'Partial Strategy Performance' : 'Validated Strategy Performance'}</b>
              <small title={sources.pnl.data?.integrity.reasons.join(' · ') || undefined}>{pnlTruthState === 'UNKNOWN' ? sources.pnl.error ?? 'UNKNOWN · no durable PnL evidence is available' : pnlTruthState === 'PARTIAL' ? 'Missing Cost Basis Or Fee Valuation · Review Fill Coverage' : 'Closed Ledger Round-Trips Only · Account Balance Movement Is Excluded'}</small>
            </span>
            <em>{pnlTruthState === 'UNKNOWN' ? 'UNKNOWN' : `${pnlDays.length} Realized Day${pnlDays.length === 1 ? '' : 's'}`}</em>
          </header>
          {pnlEvidenceAvailable && pnlDays.length > 0 && realizedTotal !== null ? (
            <>
              <div className="dcx-performance-summary">
                <Metric label={pnlTruthState === 'PARTIAL' ? 'Partial Realized PnL' : 'Realized PnL'} value={`${realizedTotal > 0 ? '+' : ''}${fmtPrice(realizedTotal)}`} detail={pnlTruthState === 'PARTIAL' ? 'Incomplete Basis' : 'Ledgered Closed Fills'} tone={pnlTruthState === 'PARTIAL' ? 'warn' : realizedTotal >= 0 ? 'ok' : 'bad'} />
                <Metric label="Trading Days" value={String(pnlDays.length)} detail="With Realized PnL" />
                <Metric label="Winning Days" value={String(winningDays.length)} detail={`${pnlDays.length ? ((winningDays.length / pnlDays.length) * 100).toFixed(0) : 0}% Day Win Rate`} />
                <Metric label="Losing Days" value={String(losingDays.length)} detail="Closed-Day Outcomes" />
                <Metric label="Daily Profit Factor" value={dailyProfitFactor === null ? '—' : dailyProfitFactor === Infinity ? '∞' : dailyProfitFactor.toFixed(2)} detail="Gross Winning Days / Losing Days" />
                <Metric label="USDT Fees" value={usdtFees === null ? 'UNKNOWN' : fmtPrice(usdtFees)} detail="Recorded Fee Asset" />
              </div>
              {pnlDays.length >= 2 ? <div className="dcx-performance-chart"><PerfChart days={pnlDays} /></div> : null}
            </>
          ) : (
            <div className="dcx-empty-performance">
              <BarChart3 size={20} />
              <span><b>{pnlEvidenceAvailable ? 'Performance Reporting Is Waiting For The First Closed Round-Trip' : 'Performance Evidence Is Unavailable'}</b><small>{pnlEvidenceAvailable ? 'Trade PnL, win rate, profit factor, and drawdown remain unreported until the ledger has real closed outcomes. No account snapshot is used as a substitute.' : 'NOT_CONFIGURED · unavailable private/account truth is not converted into validated zero PnL.'}</small></span>
              <button type="button" onClick={() => open('account')}>Review Fills <ChevronRight size={14} /></button>
            </div>
          )}
        </section>

        <footer className="dcx-source-footer">
          <span><Database size={13} />Sources: Public Market Streams, Engine Snapshots, SQLite Ledger · Private Account NOT_CONFIGURED</span>
          <span>{productSnapshot
            ? `${productSnapshot.revision} · Machine ${productSnapshot.ownerView.machineReady} · ${productSnapshot.opsIntakeInterlock.state}`
            : `Product Integration ${productBinding.continuity}`}</span>
        </footer>
      </section>
    </div>
  );
}

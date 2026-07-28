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
  X,
} from 'lucide-react';
import {
  decodeDashboardPnlData,
  type DashboardPnlData,
} from '../components/MoneySurfaceRuntime';
import '../components/MoneySurfaceBinding.css';
import { PerfChart } from '../components/PerfChart';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import { useProductControlRoomContext } from '../features/productControlRoom/ProductControlRoomProvider';
import { TokenIcon } from '../components/TokenIcon';
import { useRefreshSignal } from '../lib/refresh';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { formatClockZone } from '../lib/time';
import { projectPrivateRead } from '../lib/privateRead';
import { useStore, type Page } from '../store';
import { fmtMoney, fmtPrice, timeAgo } from '../format';
import type { LedgerEvent } from '../types';
import './Dashboard.css';

type Tone = 'ok' | 'warn' | 'bad' | 'idle';

interface Source<T> {
  data: T | null;
  error: string | null;
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

function knownCount(value: unknown): value is number {
  return finite(value) && Number.isInteger(value) && value >= 0;
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

function latestKnown(values: readonly (number | null | undefined)[]): number | null {
  const known = values.filter(finite);
  return known.length ? Math.max(...known) : null;
}

function useDashboardSources(refreshTick: number) {
  const [pnl, setPnl] = useState<Source<DashboardPnlData>>(source);

  useEffect(() => {
    const slow = createSettledPoll<DashboardPnlData>({
      intervalMs: 30_000,
      request: async (signal) => {
        const decoded = decodeDashboardPnlData(
          await fetchJson<unknown>('/api/pnl', { cache: 'no-store', signal }),
        );
        if (decoded === null) throw new Error('INVALID_DASHBOARD_PNL_RESPONSE');
        return decoded;
      },
      onSuccess: (next) => setPnl({ data: next, error: null }),
      onError: (error) => setPnl({ data: null, error: apiErrorMessage(error, 'PnL truth unavailable') }),
    });
    slow.start();
    return slow.stop;
  }, [refreshTick]);

  return { pnl };
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
  const { state, stateStatus, stateLastSuccessAtMs, stateError, privateRead, prefs, setPage } = useStore();
  const { binding: productBinding } = useProductControlRoomContext();
  const [refreshTick, setRefreshTick] = useState(0);
  useRefreshSignal(() => setRefreshTick((value) => value + 1));
  const sources = useDashboardSources(refreshTick);
  const privatePresentation = projectPrivateRead(privateRead);
  const compatibilityCurrent = stateStatus === 'CURRENT';
  const compatibilityTruthLabel = stateStatus === 'STALE' ? 'STALE LAST-KNOWN' : stateStatus === 'CURRENT' ? 'CURRENT' : 'UNAVAILABLE';
  const privateFactsCurrent = privatePresentation.freshness.state === 'CURRENT';
  const privateGuardCurrent = privateFactsCurrent && privatePresentation.guardTone === 'ok';
  const apiPostureTone: Tone = privateGuardCurrent
    ? privatePresentation.postureTone
    : privatePresentation.guardTone === 'bad' ? 'bad' : 'warn';
  const liabilitiesState = privateRead.reconciliation.liabilities.state;
  const borrowTone: Tone = privateGuardCurrent && liabilitiesState === 'RECONCILED'
    ? 'ok'
    : liabilitiesState === 'PARTIAL'
      ? 'warn'
      : privatePresentation.guardTone === 'bad' ? 'bad' : 'warn';

  const retainedProductSnapshot = productBinding.snapshot;
  const productCurrent = retainedProductSnapshot !== null && productBinding.continuity === 'PROVEN';
  const productSnapshot = productCurrent ? retainedProductSnapshot : null;
  const dashboard = productSnapshot?.dashboard;
  const ledger = dashboard?.summaries.ledger;
  const componentById = (componentId: string) => productSnapshot?.components.find((component) => component.componentId === componentId);
  const spotSource = componentById('public-spot-source');
  const usdMSource = componentById('public-usdm-source');
  const basisComponent = componentById('basis-engine');
  const volumeComponent = componentById('volume-engine');
  const unavailablePosture = { tone: 'bad' as const, statusLabel: 'Unavailable' };
  const supervisorPosture = (component: ReturnType<typeof componentById>) => component?.canonicalPresentation ?? unavailablePosture;
  const basisPosture = supervisorPosture(basisComponent);
  const volumePosture = supervisorPosture(volumeComponent);
  const runtimePresentation = productSnapshot
    ? productSnapshot.canonicalCockpit.strategyRuntime
    // F-061: absence of supervisor truth must not be presented as a measured
    // count of zero live engines. null renders as UNKNOWN.
    : { tone: 'bad' as const, label: 'Canonical Runtime Unavailable', livePublicCount: null };
  const marketFeedReadiness = productSnapshot?.canonicalCockpit.marketFeedReadiness ?? null;
  const basisStrategy = dashboard?.summaries.strategies.basis;
  const volumeStrategy = dashboard?.summaries.strategies.volume;
  const basisCandidateCount = knownCount(basisStrategy?.candidateCount) ? basisStrategy.candidateCount : null;
  const basisProposalCount = knownCount(basisStrategy?.proposalCount) ? basisStrategy.proposalCount : null;
  const volumeCandidateCount = knownCount(volumeStrategy?.candidateCount) ? volumeStrategy.candidateCount : null;
  const volumeProposalCount = knownCount(volumeStrategy?.proposalCount) ? volumeStrategy.proposalCount : null;
  const basisQueueTone: Tone = basisCandidateCount === null || basisProposalCount === null
    ? basisPosture.tone === 'ok' ? 'warn' : basisPosture.tone
    : basisPosture.tone;
  const volumeQueueTone: Tone = volumeCandidateCount === null || volumeProposalCount === null
    ? volumePosture.tone === 'ok' ? 'warn' : volumePosture.tone
    : volumePosture.tone;
  const publicSourceTone: Tone = marketFeedReadiness?.proven === true ? 'ok' : 'bad';
  const publicSourceDetail = productCurrent
    ? [spotSource, usdMSource].filter(Boolean).map((component) => (
        `${component!.componentId} · ${component!.observedLifecycle} · ${component!.capability} · ${component!.truthLabel}`
      )).join(' / ') || 'UNKNOWN · canonical public-source components are unavailable'
    : retainedProductSnapshot
      ? `STALE LAST-KNOWN · supervisor continuity ${productBinding.continuity}; canonical source facts withheld`
      : 'UNKNOWN · canonical public-source components are unavailable';
  const ledgerReady = Boolean(
    productCurrent
    && ledger?.writable === true
    && ledger.schemaCompatibilityState === 'AVAILABLE',
  );

  const integrityChecks: IntegrityCheck[] = [
    {
      label: 'Account Sync',
      detail: `${privatePresentation.stateLabel} · ${privatePresentation.freshness.label} · ${privatePresentation.observedLabel} · ${privatePresentation.reconciliationLabel}`,
      tone: privatePresentation.guardTone,
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
      detail: `${privatePresentation.postureLabel} · ${privatePresentation.identityLabel} · ${privatePresentation.freshness.label}`,
      tone: apiPostureTone,
    },
  ];
  const passingChecks = integrityChecks.filter((check) => check.tone === 'ok').length;

  const runtimeRows: RuntimeRow[] = [
    {
      id: 'basis',
      name: 'Basis Engine',
      source: basisComponent?.owner.split(':')[0] ?? 'Canonical owner unavailable',
      tone: basisQueueTone,
      state: basisPosture.statusLabel,
      intake: basisComponent?.capability.replaceAll('_', ' ') ?? 'UNKNOWN',
      coverage: basisComponent?.truthLabel.replaceAll('_', ' ') ?? 'UNKNOWN',
      watching: basisCandidateCount ?? 'UNKNOWN',
      focused: 'UNKNOWN',
      proposals: basisProposalCount ?? 'UNKNOWN',
      constraint: basisComponent?.blockerCode ?? 'Private Borrow NOT_CONFIGURED · blocker UNKNOWN',
      updatedAt: latestKnown([basisComponent?.lastAdvanceAtMs, basisComponent?.heartbeatAtMs, basisStrategy?.lastDecisionAtMs]),
      page: 'strategies',
    },
    {
      id: 'volume',
      name: 'Volume Engine',
      source: volumeComponent?.owner.split(':')[0] ?? 'Canonical owner unavailable',
      tone: volumeQueueTone,
      state: volumePosture.statusLabel,
      intake: volumeComponent?.capability.replaceAll('_', ' ') ?? 'UNKNOWN',
      coverage: volumeComponent?.truthLabel.replaceAll('_', ' ') ?? 'UNKNOWN',
      watching: volumeCandidateCount ?? 'UNKNOWN',
      focused: 'UNKNOWN',
      proposals: volumeProposalCount ?? 'UNKNOWN',
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
  const realizedTotal = pnlEvidenceAvailable && pnlDays.length > 0
    ? pnlDays.reduce((sum, day) => sum + day.usd, 0)
    : null;
  const winningDays = pnlDays.filter((day) => day.usd > 0);
  const losingDays = pnlDays.filter((day) => day.usd < 0);
  const grossProfit = winningDays.reduce((sum, day) => sum + day.usd, 0);
  const grossLoss = Math.abs(losingDays.reduce((sum, day) => sum + day.usd, 0));
  const dailyProfitFactor = grossLoss > 0 ? grossProfit / grossLoss : winningDays.length ? Infinity : null;
  const usdtFees = pnlEvidenceAvailable
    ? sources.pnl.data?.feesByAsset.find((fee) => fee.asset === 'USDT')?.amount ?? null
    : null;

  const controlState = {
    label: 'OWNER_GATED',
    detail: 'LIVE_EXECUTION_NOT_IMPLEMENTED',
    tone: 'warn' as Tone,
  };

  const latestUpdate = productSnapshot?.evaluatedAtMs ?? 0;
  const latestObservedUpdate = retainedProductSnapshot?.evaluatedAtMs ?? 0;
  const updatedLabel = latestUpdate
    ? `Updated ${timeAgo(latestUpdate)}`
    : latestObservedUpdate
      ? `Last received ${timeAgo(latestObservedUpdate)} · ${productBinding.continuity}`
      : 'Connecting Sources';
  const pnlTone: Tone = pnlTruthState === 'UNKNOWN'
    ? 'warn'
    : pnlTruthState === 'PARTIAL'
      ? 'warn'
      : realizedTotal === null || realizedTotal === 0
        ? 'idle'
        : realizedTotal > 0 ? 'ok' : 'bad';

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
              <span className="dcx-updated">{updatedLabel}</span>
            </span>
          </div>
          <div className="dcx-toolbar-actions">
            <button type="button" onClick={() => open('strategies')}><Gauge size={14} />Open Basis</button>
            <button type="button" onClick={() => open('volume')}><ScanLine size={14} />Open Volume</button>
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
            label="Strategy Runtime"
            value={runtimePresentation.label}
            detail={runtimePresentation.livePublicCount === null ? 'Canonical live-engine count unavailable' : `${runtimePresentation.livePublicCount}/${runtimeRows.length} Engines Live Public`}
            tone={runtimePresentation.livePublicCount === null ? 'warn' : runtimePresentation.tone}
          />
          <Metric
            label="Basis Queue"
            value={basisCandidateCount === null ? 'UNKNOWN' : String(basisCandidateCount)}
            detail={basisProposalCount === null ? 'Canonical Basis proposals unavailable' : `${basisProposalCount} Open Proposals`}
            tone={basisQueueTone}
          />
          <Metric
            label="Volume Queue"
            value={volumeCandidateCount === null ? 'UNKNOWN' : String(volumeCandidateCount)}
            detail={volumeProposalCount === null ? 'Canonical Volume proposals unavailable' : `${volumeProposalCount} Open Proposals`}
            tone={volumeQueueTone}
          />
          <Metric
            label={pnlTruthState === 'PARTIAL' ? 'Partial Realized PnL' : 'Realized PnL'}
            value={realizedTotal === null ? 'UNKNOWN' : `${realizedTotal > 0 ? '+' : ''}${fmtPrice(realizedTotal)}`}
            detail={pnlTruthState === 'UNKNOWN' ? 'Durable closed-fill evidence unavailable' : `${pnlDays.length} Realized Day${pnlDays.length === 1 ? '' : 's'} · ${pnlTruthState}`}
            tone={pnlTone}
          />
          <Metric
            label="Recorded USDT Fees"
            value={usdtFees === null ? 'UNKNOWN' : fmtPrice(usdtFees)}
            detail={usdtFees === null ? 'USDT fee row absent or PnL evidence unavailable' : 'Exact recorded fee-asset row'}
            tone={usdtFees === null ? 'warn' : 'idle'}
          />
          <Metric label="Execution Authority" value={controlState.label} detail={controlState.detail} tone={controlState.tone} />
        </div>

        <details className="moneyx-binding-details">
          <summary><span>Canonical Integration Evidence</span><small>Required dashboard owner fields</small></summary>
          <ProductSurfaceAdapter surfaceId="dashboard" />
        </details>

        <section className="dcx-section dcx-runtime-section">
          <header className="dcx-section-head">
            <span><b>Strategy Runtime</b><small>Canonical Lifecycle · Capability · Truth</small></span>
            <em>{runtimePresentation.livePublicCount === null ? 'UNKNOWN' : runtimePresentation.livePublicCount}/{runtimeRows.length} Engines Live Public</em>
          </header>
          <div className="dcx-runtime-scroll">
            <div className="dcx-runtime-canvas" role="table" aria-label="Strategy Runtime">
              <div className="dcx-runtime-header" role="row">
                <span role="columnheader">Engine</span><span role="columnheader">Capability</span><span role="columnheader">Truth</span><span role="columnheader">Candidates</span><span role="columnheader">Focused</span><span role="columnheader">Proposals</span><span role="columnheader">Primary Constraint</span><span role="columnheader">Updated / Open</span>
              </div>
              {runtimeRows.map((row) => (
                <div className="dcx-runtime-row" role="row" key={row.id}>
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
                  <span className="dcx-runtime-constraint" role="cell"><b>{row.constraint}</b><small>{row.id === 'basis' ? `Private Liabilities ${privateRead.reconciliation.liabilities.state}` : 'Canonical Component Blocker'}</small></span>
                  <span className="dcx-runtime-open" role="cell">
                    <button type="button" aria-label={`Open ${row.name}; updated ${sourceAge(row.updatedAt)}`} onClick={() => open(row.page)}>
                      <b>{sourceAge(row.updatedAt)}</b><ChevronRight size={14} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <details className="dcx-truth-details">
          <summary>
            <span><b>Strategy Truth Guardrails</b><small>Account, public-source, runtime, ledger, and key evidence</small></span>
            <strong>{passingChecks}/{integrityChecks.length} Passing</strong>
          </summary>
          <div className="dcx-integrity-list">
            {integrityChecks.map((check) => (
              <div key={check.label} className="dcx-integrity-row">
                <StatusMark tone={check.tone} />
                <span><b>{check.label}</b><small>{check.detail}</small></span>
              </div>
            ))}
          </div>
        </details>

        <section className="dcx-operations">
          <div className="dcx-attention">
            <header className="dcx-section-head">
              <span><b>Attention Queue</b><small>Current Constraints And Highest-Signal Work</small></span>
            </header>
            <div className="dcx-attention-list">
              <button type="button" onClick={() => open('loans')}>
                <StatusMark tone={borrowTone} />
                <span><b>Borrow Verification</b><small>{privatePresentation.freshness.label} · {liabilitiesState} · loan catalog and maximum-borrowable remain outside private-read v1</small></span>
                <em>{!privateFactsCurrent || privatePresentation.counts.liabilities === null ? 'UNKNOWN' : `${privatePresentation.counts.liabilities} Assets`}</em><ChevronRight size={14} />
              </button>
              <button type="button" onClick={() => open('strategies')}>
                <StatusMark tone={basisQueueTone} />
                <span><b>Basis Decision Queue</b><small>{basisComponent?.blockerCode ?? `${basisComponent?.truthLabel ?? 'UNKNOWN'} · ${basisStrategy?.sourceRevision ?? 'source revision UNKNOWN'}`}</small></span>
                <em>{basisProposalCount ?? 'UNKNOWN'} Proposals</em><ChevronRight size={14} />
              </button>
              <button type="button" onClick={() => open('volume')}>
                <StatusMark tone={volumeQueueTone} />
                <span><b>Volume Decision Queue</b><small>{volumeComponent?.blockerCode ?? `${volumeComponent?.truthLabel ?? 'UNKNOWN'} · ${volumeStrategy?.sourceRevision ?? 'source revision UNKNOWN'}`}</small></span>
                <em>{volumeProposalCount ?? 'UNKNOWN'} Proposals</em><ChevronRight size={14} />
              </button>
              <button type="button" onClick={() => open('risk')}>
                <StatusMark tone="warn" />
                <span><b>Execution Guard</b><small>OWNER_GATED · live execution is mechanically unavailable</small></span>
                <em>{compatibilityCurrent ? state.risk.rejectionsToday : 'UNKNOWN'} Rejected Today</em><ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="dcx-decisions">
            <header className="dcx-section-head">
              <span>
                <b>Recent Decisions</b>
                <small>{compatibilityCurrent ? 'Ledgered Engine And Risk Evidence' : `${stateStatus === 'STALE' ? 'STALE LAST-KNOWN' : 'UNAVAILABLE'} · compatibility decisions are non-authorizing`}</small>
              </span>
              <button type="button" onClick={() => open('ledger')}>Open Logs <ArrowUpRight size={13} /></button>
            </header>
            <div className="dcx-decision-list">
              {recentDecisions.length ? recentDecisions.map((event) => (
                <button type="button" key={event.id} onClick={() => open('ledger')}>
                  <span className="dcx-decision-time">{formatClockZone(event.ts, prefs.clockZone, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }, 'en-GB')}</span>
                  <StatusMark tone={compatibilityCurrent ? eventTone(event) : 'warn'} />
                  <span className="dcx-decision-source"><b>{strategyLabel(event)}</b><small>{event.symbol ?? 'System'}</small></span>
                  <span className="dcx-decision-message">{decisionMessage(event)}</span>
                  <em>{compatibilityCurrent ? '' : `${compatibilityTruthLabel} · `}{titleCase(String(eventData(event).kind ?? eventData(event).rejectCode ?? event.kind))}</em>
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
          <span><Database size={13} />Sources: Public Market Streams, Engine Snapshots, SQLite Ledger · Private Account {privatePresentation.stateLabel}</span>
          <span>{productSnapshot
            ? `${productSnapshot.revision} · Machine ${productSnapshot.ownerView.machineReady} · ${productSnapshot.opsIntakeInterlock.state}`
            : retainedProductSnapshot
              ? `STALE LAST-KNOWN · ${retainedProductSnapshot.revision} · continuity ${productBinding.continuity}`
              : `Product Integration ${productBinding.continuity}`}</span>
        </footer>
      </section>
    </div>
  );
}

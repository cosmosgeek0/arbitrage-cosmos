import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BookOpen,
  ChevronDown,
  Eye,
  Radio,
  Search,
  Star,
  X,
} from 'lucide-react';
import {
  decodeVolumeRuntimeSnapshot,
  hasAttachedOpenProposal,
  volumeRuntimeCurrent,
  type VolumeRuntimeRow,
  type VolumeRuntimeSnapshot,
  type VolumeWindowMetric,
} from '../components/MoneySurfaceRuntime';
import '../components/MoneySurfaceBinding.css';
import { TokenIcon } from '../components/TokenIcon';
import { fmtMoney, fmtPct, fmtPrice, timeAgo } from '../format';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import {
  parseTokenIntelligence,
  type TokenIntelligenceRead,
} from '../lib/tokenIntelligence';
import {
  projectVolumeWorkspaceTruth,
} from '../lib/volumeWorkspaceTruth';
import { useStore } from '../store';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import './VolumeScanner.css';

type Filter = 'all' | 'watching' | 'focus' | 'rejected' | 'warming';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All Symbols' },
  { id: 'watching', label: 'Watching' },
  { id: 'focus', label: 'Focused' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'warming', label: 'Warming' },
];

function multiple(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(value >= 10 ? 1 : 2) + '×' : '—';
}

function numberOrDash(value: number | null | undefined, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export function windowCountLabel(
  windowMetric: VolumeWindowMetric | undefined,
  countKey: 'tradeCount' | 'largeTradeCount',
  suffix = '',
): string {
  const count = windowMetric?.[countKey];
  return typeof count === 'number' && Number.isInteger(count) && count >= 0
    ? `${count}${suffix}`
    : 'UNKNOWN';
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stateLabel(row: VolumeRuntimeRow): string {
  if (row.proposal?.status === 'rejected') return 'Proposal Rejected';
  if (row.state === 'PROPOSED') {
    if (hasAttachedOpenProposal(row)) return 'Proposal';
    if (row.proposal?.status === 'expired') return 'Proposal Expired';
    if (row.proposal?.status === 'approved_manual') return 'Proposal Approved';
    return 'Proposal Reconciling';
  }
  if (hasAttachedOpenProposal(row)) return 'Open Proposal Reconciling';
  if (row.proposal?.status === 'expired') return 'Proposal Expired';
  if (row.proposal?.status === 'approved_manual') return 'Proposal Approved';
  if (!row.baseline.ready) return 'Warming';
  if (row.state === 'FOCUS') return 'Focused';
  if (row.state === 'WATCHING') return 'Watching';
  if (row.state === 'COOLDOWN' || row.decisionKind === 'reject') return 'Rejected';
  return 'Monitoring';
}

function stateTone(row: VolumeRuntimeRow, truthCurrent: boolean): string {
  if (row.proposal?.status === 'rejected') return 'rejected';
  if (row.state === 'PROPOSED' || row.proposal !== null) {
    return truthCurrent && row.state === 'PROPOSED' && hasAttachedOpenProposal(row) ? 'proposal' : 'idle';
  }
  if (!row.baseline.ready) return 'warming';
  if (row.state === 'FOCUS') return 'focus';
  if (row.state === 'WATCHING') return 'watching';
  if (row.state === 'COOLDOWN' || row.decisionKind === 'reject') return 'rejected';
  return 'idle';
}

function decisionTitle(row: VolumeRuntimeRow): string {
  if (row.rejectCode) return titleCase(row.rejectCode);
  if (row.proposal?.status === 'rejected') return 'Proposal Rejected';
  if (row.proposal?.status === 'expired') return 'Proposal Expired';
  if (row.proposal?.status === 'approved_manual') return 'Proposal Approved Manually';
  if (hasAttachedOpenProposal(row) && row.state !== 'PROPOSED') return 'Open Proposal Lifecycle Mismatch';
  if (row.state === 'PROPOSED' && !hasAttachedOpenProposal(row)) return 'Proposal Lifecycle Reconciliation';
  if (row.decisionKind === 'proposal' && !hasAttachedOpenProposal(row)) return 'Historical Proposal Decision';
  return titleCase(row.decisionKind);
}

function proposalDetail(row: VolumeRuntimeRow): string {
  if (row.state === 'PROPOSED' && hasAttachedOpenProposal(row)) return 'Open · Lifecycle Bound';
  if (hasAttachedOpenProposal(row)) return `Open · ${titleCase(row.state)} Lifecycle Mismatch`;
  if (row.proposal !== null) return `${titleCase(row.proposal.status)} · Closed Store Record`;
  if (row.state === 'PROPOSED') return 'No Attached Store Record · Lifecycle Reconciling';
  if (row.decisionKind === 'proposal') return 'Historical Decision · No Attached Store Record';
  return 'None';
}

function ratioLabel(value: number | null): string {
  return value === null ? '—' : Math.round(value * 100) + '% Buy';
}

function fundingLabel(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? (value * 100).toFixed(4) + '%' : '—';
}

function countLabel(value: number | null | undefined): string | number {
  return typeof value === 'number' && Number.isFinite(value) ? value : '—';
}

function multipleTone(
  value: number | null | undefined,
  threshold: number | null,
  baselineReady: boolean,
  truthCurrent: boolean,
): 'trigger' | 'elevated' | 'normal' | 'unknown' {
  if (!truthCurrent || !baselineReady || typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  if (threshold !== null && value >= threshold) return 'trigger';
  if (value >= 1) return 'elevated';
  return 'normal';
}

export function VolumeScanner() {
  const { state, stateStatus, openDetail, openLedger, toggleWatch } = useStore();
  const [snapshot, setSnapshot] = useState<VolumeRuntimeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedIntelligence, setExpandedIntelligence] = useState<TokenIntelligenceRead | null>(null);
  const [expandedIntelligenceError, setExpandedIntelligenceError] = useState<string | null>(null);

  useEffect(() => {
    const poll = createSettledPoll<VolumeRuntimeSnapshot>({
      intervalMs: 2_000,
      request: async (signal) => {
        const decoded = decodeVolumeRuntimeSnapshot(
          await fetchJson<unknown>('/api/engine/volume', { cache: 'no-store', signal }),
        );
        if (decoded === null) throw new Error('INVALID_VOLUME_RUNTIME_RESPONSE');
        return decoded;
      },
      onSuccess: (next) => {
        setSnapshot(next);
        setError(null);
      },
      onError: (reason) => setError(apiErrorMessage(reason, 'Volume runtime unavailable')),
    });
    poll.start();
    return poll.stop;
  }, []);

  useEffect(() => {
    setExpandedIntelligence(null);
    setExpandedIntelligenceError(null);
    if (expanded === null) return;
    const symbol = expanded;
    const poll = createSettledPoll<TokenIntelligenceRead>({
      intervalMs: 2_000,
      request: async (signal) => {
        const raw = await fetchJson<unknown>(`/api/intelligence/token?symbol=${encodeURIComponent(symbol)}`, {
          cache: 'no-store',
          signal,
        });
        const parsed = parseTokenIntelligence(raw, symbol, Date.now());
        if (parsed === null) throw new Error('Volume intelligence owner contract mismatch');
        return parsed;
      },
      onSuccess: (next) => {
        if (next.symbol !== symbol) return;
        setExpandedIntelligence(next);
        setExpandedIntelligenceError(null);
      },
      onError: (reason) => {
        setExpandedIntelligence(null);
        setExpandedIntelligenceError(apiErrorMessage(reason, 'Exact-symbol intelligence unavailable'));
      },
    });
    poll.start();
    return poll.stop;
  }, [expanded]);

  const rows = snapshot?.rows ?? [];
  const query = search.trim().toUpperCase();
  const counts = useMemo(() => ({
    all: rows.length,
    watching: rows.filter((row) => row.state === 'WATCHING').length,
    focus: rows.filter((row) => row.state === 'FOCUS' || row.state === 'PROPOSED').length,
    rejected: rows.filter((row) => row.state === 'COOLDOWN' || row.decisionKind === 'reject').length,
    warming: rows.filter((row) => !row.baseline.ready).length,
  }), [rows]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (query && !row.symbol.includes(query) && !row.base.includes(query) && !row.reason.toUpperCase().includes(query)) return false;
    if (filter === 'watching') return row.state === 'WATCHING';
    if (filter === 'focus') return row.state === 'FOCUS' || row.state === 'PROPOSED';
    if (filter === 'rejected') return row.state === 'COOLDOWN' || row.decisionKind === 'reject';
    if (filter === 'warming') return !row.baseline.ready;
    return true;
  }), [filter, query, rows]);

  const engineFeedsCurrent = Boolean(!error && snapshot && volumeRuntimeCurrent(snapshot));
  const watchlist = state?.config.watchlist ?? [];
  const watchWritable = stateStatus === 'CURRENT' && engineFeedsCurrent;
  const retainedSnapshot = Boolean(error && snapshot);
  const feedTone = engineFeedsCurrent
    ? 'active'
    : retainedSnapshot
      ? 'retained'
      : error
        ? 'unavailable'
        : snapshot
          ? 'degraded'
          : 'starting';
  const feedLabel = engineFeedsCurrent
    ? 'Engine Feeds Current'
    : retainedSnapshot
      ? 'Last Snapshot Retained'
      : error
        ? 'Runtime Unavailable'
        : snapshot
          ? snapshot.status.running
            ? 'Market Inputs Degraded'
            : 'Runtime Not Running'
          : 'Runtime Starting';

  return (
    <div className="container page volx-page">
      <section className="volx-frame" aria-label="volume workspace">
        <header className="volx-toolbar">
          <div className="volx-title">
            <img className="volx-page-mark" src="/volume-bars.png" alt="" aria-hidden="true" />
            <h1>Volume</h1>
            <span className={'volx-live ' + feedTone} role="status">
              <i aria-hidden="true" />
              {feedLabel}
            </span>
            <span className="volx-updated">
              {snapshot ? (retainedSnapshot ? 'Last received ' : 'Updated ') + timeAgo(snapshot.updatedAt) : 'Connecting'}
            </span>
          </div>
          <label className="volx-search">
            <Search size={14} aria-hidden="true" />
            <input
              aria-label="Search Volume"
              placeholder="Search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setExpanded(null);
              }}
              spellCheck={false}
            />
            {search ? (
              <button type="button" aria-label="Clear Search" onClick={() => setSearch('')}>
                <X size={14} />
              </button>
            ) : null}
          </label>
        </header>

        <div className="volx-summary" aria-label="Volume Summary">
          <div className="volx-summary-cell">
            <span>Observed Symbols</span>
            <strong>{retainedSnapshot ? 'UNKNOWN' : snapshot?.status.observedSymbols ?? '—'} {!retainedSnapshot ? <em>/ {snapshot?.status.eligibleSize ?? '—'}</em> : null}</strong>
            <small>{retainedSnapshot ? 'STALE LAST-KNOWN · current stream coverage withheld' : 'Exact aggregate-trade streams'}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Baselines Ready</span>
            <strong>{retainedSnapshot ? 'UNKNOWN' : snapshot?.status.baselineReady ?? '—'} {!retainedSnapshot ? <em>/ {snapshot?.status.baselineTotal ?? '—'}</em> : null}</strong>
            <small>{retainedSnapshot ? 'STALE LAST-KNOWN · current baseline state withheld' : snapshot ? snapshot.thresholds.baselineMinutes + ' completed minutes required' : 'Loading history'}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Focus Queue</span>
            <strong>{retainedSnapshot ? 'UNKNOWN' : snapshot ? snapshot.status.watching + snapshot.status.focused : '—'}</strong>
            <small>{retainedSnapshot ? 'STALE LAST-KNOWN · current queue withheld' : snapshot ? snapshot.status.watching + ' watching · ' + snapshot.status.focused + ' focused' : 'Waiting for runtime'}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Open Proposals</span>
            <strong>{retainedSnapshot ? 'UNKNOWN' : snapshot?.status.openProposals ?? '—'}</strong>
            <small>
              {retainedSnapshot
                ? 'STALE LAST-KNOWN · current proposals withheld'
                : snapshot == null
                ? 'Runtime truth unavailable'
                : snapshot.status.openProposals
                  ? 'Engine-reported proposals only'
                  : 'No verified wakeup staged'}
            </small>
          </div>
        </div>

        <details className="moneyx-binding-details">
          <summary><span>Canonical Integration Evidence</span><small>Required Volume owner fields</small></summary>
          <ProductSurfaceAdapter surfaceId="volume" />
        </details>

        {retainedSnapshot ? (
          <div className="volx-retained" role="status">
            <Activity size={14} aria-hidden="true" />
            <span><strong>Retained engine snapshot</strong> · Refresh failed. Values below are last received from the runtime, not current.</span>
          </div>
        ) : null}

        <div className="volx-filters">
          <div className="volx-segments" role="group" aria-label="Volume row filters">
            {FILTERS.map((item) => (
              <button
                type="button"
                aria-pressed={filter === item.id}
                className={filter === item.id ? 'selected' : ''}
                key={item.id}
                onClick={() => {
                  setFilter(item.id);
                  setExpanded(null);
                }}
              >
                {item.label}
                <span>{counts[item.id]}</span>
              </button>
            ))}
          </div>
          <div className="volx-desk-meta">
            <span className="volx-view-note">
              {snapshot ? snapshot.status.openConnections + '/' + snapshot.status.streamConnections + ' trade streams · book ' + snapshot.status.bookState : 'Runtime starting'}
            </span>
            <span className="volx-authority">Monitor only · execution unavailable</span>
          </div>
        </div>

        <div
          className="volx-table"
          role="table"
          aria-label="Volume Scanner Decisions"
          data-current={engineFeedsCurrent ? 'true' : 'false'}
          data-retained={retainedSnapshot ? 'true' : 'false'}
        >
          <div className="volx-head" role="row">
            <span role="columnheader">State</span>
            <span role="columnheader">Asset</span>
            <span role="columnheader">Price</span>
            <span role="columnheader">Volume Vs Baseline</span>
            <span role="columnheader">Trade Flow</span>
            <span role="columnheader">Market Quality</span>
            <span role="columnheader">Price Move</span>
            <span role="columnheader">Decision</span>
            <span aria-hidden="true" />
          </div>

          {error && !snapshot ? (
            <div className="volx-empty">
              <Activity size={18} />
              <strong>Volume Runtime Unavailable</strong>
              <span>{error}</span>
            </div>
          ) : !snapshot ? (
            <div className="volx-empty">
              <Radio size={18} />
              <strong>Connecting To Volume Runtime</strong>
              <span>Waiting for public Binance trade and book sources.</span>
            </div>
          ) : filteredRows.length ? filteredRows.map((row) => {
            const one = row.windows['1s'];
            const five = row.windows['5s'];
            const minute = row.windows['60s'];
            const isExpanded = expanded === row.symbol;
            const watching = watchlist.includes(row.symbol);
            const detailId = `volume-detail-${row.symbol}`;
            const ownerTruth = projectVolumeWorkspaceTruth(
              expandedIntelligence?.symbol === row.symbol ? expandedIntelligence : null,
              row.symbol,
            );
            return (
              <div className="volx-item" role="rowgroup" key={row.symbol}>
                <div
                  className="volx-row"
                  role="row"
                >
                  <span className={'volx-state ' + stateTone(row, engineFeedsCurrent)} role="cell">
                    <i aria-hidden="true" />
                    {retainedSnapshot ? 'Stale ' : ''}{stateLabel(row)}
                  </span>
                  <span className="volx-asset" role="cell">
                    <TokenIcon symbol={row.symbol} size={28} />
                    <span><strong>{row.base}</strong><small>{row.symbol}</small></span>
                  </span>
                  <span className="volx-number" role="cell">
                    <strong>{fmtPrice(row.price)}</strong>
                    <small>{row.lastTradeTs ? timeAgo(row.lastTradeTs) : 'No recent trade'}</small>
                  </span>
                  <span className="volx-window-stack" role="cell">
                    <span><em>1s</em><strong className={multipleTone(row.volumeMultiple['1s'], snapshot.thresholds.volume1s, row.baseline.ready, engineFeedsCurrent)}>{multiple(row.volumeMultiple['1s'])}</strong><small>{fmtMoney(one?.quoteVolume ?? null)}</small></span>
                    <span><em>5s</em><strong className={multipleTone(row.volumeMultiple['5s'], snapshot.thresholds.volume5s, row.baseline.ready, engineFeedsCurrent)}>{multiple(row.volumeMultiple['5s'])}</strong><small>{fmtMoney(five?.quoteVolume ?? null)}</small></span>
                    <span><em>1m</em><strong className={multipleTone(row.volumeMultiple['60s'], null, row.baseline.ready, engineFeedsCurrent)}>{multiple(row.volumeMultiple['60s'])}</strong><small>{fmtMoney(minute?.quoteVolume ?? null)}</small></span>
                  </span>
                  <span className="volx-tape" role="cell">
                    <strong>{windowCountLabel(five, 'tradeCount', ' Trades')}</strong>
                    <small>{ratioLabel(row.takerBuyRatio)} · {fmtMoney(five?.avgTradeSize ?? null)} Avg</small>
                  </span>
                  <span className="volx-quality" role="cell">
                    <strong>{row.spreadBps === null ? '—' : row.spreadBps.toFixed(1) + ' bps'}</strong>
                    <small>{fmtMoney(row.topDepthUsd)} Top Depth</small>
                  </span>
                  <span className="volx-move" role="cell">
                    <strong>{fmtPct(five?.priceMovePct ?? null, 3)}</strong>
                    <small>{row.accelerationPctPerMin === null ? '—' : fmtPct(row.accelerationPctPerMin, 2) + '/min'}</small>
                  </span>
                  <span className="volx-decision" role="cell">
                    <strong>{decisionTitle(row)}</strong>
                    <small>{row.reason}</small>
                  </span>
                  <span className="volx-row-control" role="cell">
                    <button
                      type="button"
                      className="volx-disclosure"
                      aria-controls={isExpanded ? detailId : undefined}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.symbol} volume evidence`}
                      onClick={() => setExpanded(isExpanded ? null : row.symbol)}
                    >
                      <ChevronDown className={isExpanded ? 'expanded' : ''} size={15} aria-hidden="true" />
                    </button>
                  </span>
                </div>

                {isExpanded ? (
                  <div className="volx-detail" id={detailId}>
                    <div className="volx-reason">
                      <span>Scanner Decision</span>
                      <p>{row.reason}</p>
                      <small><Radio size={13} />{snapshot.status.source} · {snapshot.status.bookSource}</small>
                    </div>
                    <dl className="volx-facts">
                      <div><dt>Baseline</dt><dd>{row.baseline.samples}/{snapshot.thresholds.baselineMinutes} min</dd></div>
                      <div><dt>Normal Volume</dt><dd>{fmtMoney(row.baseline.quotePerMinMedian)}/min</dd></div>
                      <div><dt>1s Trades</dt><dd>{windowCountLabel(one, 'tradeCount')}</dd></div>
                      <div><dt>5s Trade Multiple</dt><dd>{multiple(row.tradeCountMultiple['5s'])}</dd></div>
                      <div><dt>Average Trade</dt><dd>{fmtMoney(five?.avgTradeSize ?? null)}</dd></div>
                      <div><dt>Taker Aggression</dt><dd>{ratioLabel(row.takerBuyRatio)}</dd></div>
                      <div><dt>Large Trades · 1m</dt><dd>{windowCountLabel(minute, 'largeTradeCount')}</dd></div>
                      <div><dt>Depth Score</dt><dd>{numberOrDash(row.depthScore, 2)}</dd></div>
                      <div><dt>Depth Vs Norm</dt><dd>{row.depthVsNorm === null ? '—' : Math.round(row.depthVsNorm * 100) + '%'}</dd></div>
                      <div><dt>Focus Reason</dt><dd>{row.focusReason ? titleCase(row.focusReason) : 'Not Focused'}</dd></div>
                      <div><dt>Reject Code</dt><dd>{row.rejectCode ? titleCase(row.rejectCode) : 'None'}</dd></div>
                      <div><dt>Proposal</dt><dd>{proposalDetail(row)}</dd></div>
                    </dl>
                    <div className="volx-actions">
                      <button type="button" onClick={() => openDetail(row.symbol)}><Eye size={14} />Open Market</button>
                      <button
                        type="button"
                        className={watchWritable && watching ? 'active' : ''}
                        aria-pressed={watching}
                        disabled={!watchWritable}
                        title={watchWritable ? undefined : 'Watch changes require current compatibility and Volume runtime truth.'}
                        onClick={() => {
                          if (watchWritable) void toggleWatch(row.symbol);
                        }}
                      >
                        <Star size={14} fill={watching ? 'currentColor' : 'none'} />
                        {watchWritable ? watching ? 'Watching' : 'Watch' : watching ? 'Watching · Change Unavailable' : 'Watch Unavailable'}
                      </button>
                      <button type="button" onClick={() => openLedger(row.symbol)}><BookOpen size={14} />Open Logs</button>
                    </div>
                    <section className="volx-owner-evidence" aria-label={`${row.symbol} Volume Intelligence Evidence`}>
                      <header>
                        <span><strong>Canonical Intelligence Evidence</strong><small>Exact symbol · MarketEngine → router → Bridge</small></span>
                        <em className={ownerTruth?.projectionState === 'ACTIVE' ? 'fresh' : ownerTruth ? 'degraded' : 'missing'}>
                          {ownerTruth?.projectionState ?? (expandedIntelligenceError ? 'UNAVAILABLE' : 'READING')}
                        </em>
                      </header>
                      {ownerTruth ? (
                        <>
                          <div className="volx-owner-grid">
                            <article>
                              <span>Latest Owner Thesis · Stage</span>
                              <strong>{ownerTruth.stage.marketStage ?? 'UNKNOWN'}</strong>
                              <small>{ownerTruth.stage.freshness === 'MISSING' ? 'MISSING' : ownerTruth.stage.freshness + '_AT_CUT'} · {ownerTruth.stage.completeness} · {ownerTruth.stage.hypothesis ?? 'stage withheld'} · {ownerTruth.stage.evaluatedAtMs === null ? 'cut unknown' : timeAgo(ownerTruth.stage.evaluatedAtMs)}</small>
                            </article>
                            <article>
                              <span>Cross-market Capability</span>
                              <strong>{ownerTruth.leadership.leadMarket}</strong>
                              <small>{ownerTruth.leadership.freshness} · {ownerTruth.leadership.completeness} · {ownerTruth.leadership.lastEvidenceTimeMs === null ? 'source time missing' : timeAgo(ownerTruth.leadership.lastEvidenceTimeMs)}</small>
                            </article>
                            <article>
                              <span>Latest Owner Thesis Lead</span>
                              <strong>{ownerTruth.stage.leadMarket}</strong>
                              <small>{ownerTruth.stage.freshness === 'MISSING' ? 'MISSING' : ownerTruth.stage.freshness + '_AT_CUT'} · {ownerTruth.stage.completeness} · {ownerTruth.stage.evaluatedAtMs === null ? 'cut unknown' : timeAgo(ownerTruth.stage.evaluatedAtMs)}</small>
                            </article>
                            <article>
                              <span>Open Interest</span>
                              <strong>{fmtMoney(ownerTruth.openInterest.value?.quoteUsd)}</strong>
                              <small>{ownerTruth.openInterest.state} · {ownerTruth.openInterest.value?.changePct === null || ownerTruth.openInterest.value?.changePct === undefined ? 'change unknown' : fmtPct(ownerTruth.openInterest.value.changePct, 2)}</small>
                            </article>
                            <article>
                              <span>Funding</span>
                              <strong>{fundingLabel(ownerTruth.markFunding.value?.fundingRate)}</strong>
                              <small>{ownerTruth.markFunding.state} · {ownerTruth.markFunding.dataset}</small>
                            </article>
                            <article>
                              <span>Sampled Liquidations · 15m</span>
                              <strong>{fmtMoney(ownerTruth.liquidation.value?.total15mUsd)}</strong>
                              <small>{ownerTruth.liquidation.state} · latest-per-symbol lower bound</small>
                            </article>
                            <article>
                              <span>Wash-Like Churn Score</span>
                              <strong>{numberOrDash(row.washScore, 2)}</strong>
                              <small>Scanner owner heuristic · not Bridge forensics or an empirical outcome</small>
                            </article>
                            <article>
                              <span>Latest Owner Forensics</span>
                              <strong>{ownerTruth.forensics
                                ? (ownerTruth.forensics.freshness === 'MISSING' ? 'MISSING' : ownerTruth.forensics.freshness + '_AT_CUT') + ' · ' + ownerTruth.forensics.state
                                : 'UNAVAILABLE'}</strong>
                              <small>{ownerTruth.forensics
                                ? ownerTruth.forensics.checkCount + ' checks · ' + ownerTruth.forensics.blockingCheckCount + ' blocking · ' + ownerTruth.forensics.unknownRequiredCheckCount + ' unknown required'
                                : 'No current exact-symbol Bridge artifact'}</small>
                            </article>
                            <article>
                              <span>Retained Evidence Timeline</span>
                              <strong>{ownerTruth.retainedEvidence.count} records</strong>
                              <small>{ownerTruth.retainedEvidence.state} · history count is not outcome truth</small>
                            </article>
                            <article>
                              <span>Production Outcomes</span>
                              <strong>{ownerTruth.outcomeOwner.state}</strong>
                              <small>Pre-move freeze and empirical false-positive outcome owner not mounted</small>
                            </article>
                          </div>
                          <div className="volx-capabilities" aria-label={`${row.symbol} Intelligence Capabilities`}>
                            {ownerTruth.capabilities.map((entry) => (
                              <span key={entry.capability}>
                                <strong>{titleCase(entry.capability)}</strong>
                                <em className={entry.freshness.toLowerCase()}>{entry.freshness}</em>
                                <small>{entry.completeness} · {entry.sourceIds.length ? entry.sourceIds.join(', ') : entry.reasonCodes.join(', ') || 'NO APPROVED SOURCE'}</small>
                              </span>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="volx-owner-unavailable">
                          {expandedIntelligenceError ?? 'Reading the exact-symbol owner contract. No evidence value is inferred while it is unavailable.'}
                        </p>
                      )}
                    </section>
                  </div>
                ) : null}
              </div>
            );
          }) : rows.length === 0 && retainedSnapshot ? (
            <div className="volx-empty">
              <Activity size={18} />
              <strong>Volume Rows Stale Last-Known</strong>
              <span>The retained runtime response contained no rows. Current row absence is unknown.</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="volx-empty">
              <Activity size={18} />
              <strong>No Volume Decisions Available</strong>
              <span>The current engine snapshot contains no volume rows. Nothing is simulated.</span>
            </div>
          ) : (
            <div className="volx-empty">
              <Activity size={18} />
              <strong>No Volume Rows Match</strong>
              <span>Change the filter or search term. No rows are simulated.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

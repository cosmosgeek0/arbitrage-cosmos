import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRightLeft,
  BookOpen,
  ChevronDown,
  Eye,
  Radio,
  Search,
  Star,
  X,
} from 'lucide-react';
import {
  basisRuntimeCurrent,
  decodeBasisRuntimeSnapshot,
  hasAttachedOpenProposal,
} from '../components/MoneySurfaceRuntime';
import '../components/MoneySurfaceBinding.css';
import { TokenIcon } from '../components/TokenIcon';
import { countdown, fmtBasis, fmtFunding, fmtMoney, fmtPrice, timeAgo } from '../format';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { useStore } from '../store';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import type { BasisRow, BasisSnapshot } from '../lib/basisRuntime';
import './VolumeScanner.css';
import './BasisScanner.css';

type Filter = 'all' | 'candidates' | 'proposals' | 'borrow' | 'rejected';


const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All Pairs' },
  { id: 'candidates', label: 'Candidates' },
  { id: 'proposals', label: 'Proposals' },
  { id: 'borrow', label: 'Borrow Blocked' },
  { id: 'rejected', label: 'Rejected' },
];

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function durationCompact(ms: number | null | undefined): string {
  if (!finite(ms)) return '—';
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm';
  return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
}

function bps(value: number | null | undefined): string {
  return finite(value) ? value.toFixed(value >= 10 ? 1 : 2) + ' bps' : '—';
}

function stateLabel(row: BasisRow): string {
  if (row.state === 'PROPOSED') {
    return hasAttachedOpenProposal(row) ? 'Proposal' : 'Proposal Reconciling';
  }
  if (hasAttachedOpenProposal(row)) return 'Open Proposal Reconciling';
  if (row.state === 'FOCUS') return 'Focused';
  if (row.state === 'WATCHING') return 'Watching';
  if (row.decisionKind === 'reject' || row.state === 'REJECTED' || row.state === 'COOLDOWN') return 'Rejected';
  return 'Monitoring';
}

function stateTone(row: BasisRow, truthCurrent: boolean): string {
  if (row.state === 'PROPOSED' || hasAttachedOpenProposal(row)) {
    return truthCurrent && row.state === 'PROPOSED' && hasAttachedOpenProposal(row) ? 'proposal' : 'idle';
  }
  if (row.state === 'FOCUS') return 'focus';
  if (row.state === 'WATCHING') return 'watching';
  if (row.decisionKind === 'reject' || row.state === 'REJECTED' || row.state === 'COOLDOWN') return 'rejected';
  return 'idle';
}

function directionLabel(direction: BasisRow['direction']): string {
  return direction === 'long_spot_short_perp' ? 'Buy Spot · Sell Perp' : 'Sell Spot · Buy Perp';
}

function executionPrices(row: BasisRow): { primary: string; secondary: string } {
  if (row.direction === 'long_spot_short_perp') {
    return {
      primary: fmtPrice(row.spotAsk) + ' / ' + fmtPrice(row.perpBid),
      secondary: 'Spot Ask · Perp Bid',
    };
  }
  return {
    primary: fmtPrice(row.spotBid) + ' / ' + fmtPrice(row.perpAsk),
    secondary: 'Spot Bid · Perp Ask',
  };
}

function decisionTitle(row: BasisRow): string {
  if (row.rejectCode) return titleCase(row.rejectCode);
  if (row.state === 'PROPOSED' && !hasAttachedOpenProposal(row)) {
    return 'Proposal Lifecycle · No Open Attachment';
  }
  if (hasAttachedOpenProposal(row) && row.state !== 'PROPOSED') {
    return 'Open Proposal Lifecycle Mismatch';
  }
  if (row.decisionKind === 'proposal') {
    return row.state === 'PROPOSED' && hasAttachedOpenProposal(row)
      ? 'Proposal'
      : 'Historical Proposal Decision';
  }
  if (row.decisionKind === 'ignore') return 'Below Watch Gate';
  return titleCase(row.decisionKind);
}

function proposalDetail(row: BasisRow): string {
  if (row.state === 'PROPOSED' && hasAttachedOpenProposal(row)) return 'Open · Lifecycle Bound';
  if (row.state === 'PROPOSED') return 'No Open Attachment · Lifecycle Reconciling';
  if (hasAttachedOpenProposal(row)) return `Open · ${titleCase(row.state)} Lifecycle Mismatch`;
  if (row.decisionKind === 'proposal') return 'Historical Decision · No Open Attachment';
  return 'None';
}

function edgeTone(row: BasisRow, truthCurrent: boolean): 'cleared' | 'measured' | 'blocked' | 'unknown' {
  if (!truthCurrent) return 'unknown';
  if (!finite(row.netEdgePct)) return 'unknown';
  if (row.state === 'PROPOSED' || hasAttachedOpenProposal(row)) {
    return row.state === 'PROPOSED' && hasAttachedOpenProposal(row) && row.netEdgePct > 0
      ? 'cleared'
      : 'unknown';
  }
  if (row.decisionKind === 'reject' || row.state === 'REJECTED' || row.state === 'COOLDOWN') return 'blocked';
  return 'measured';
}

export function Strategies() {
  const { state, stateStatus, openDetail, openLedger, setPage, toggleWatch } = useStore();
  const [snapshot, setSnapshot] = useState<BasisSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const poll = createSettledPoll<BasisSnapshot>({
      intervalMs: 2_000,
      request: async (signal) => {
        const decoded = decodeBasisRuntimeSnapshot(
          await fetchJson<unknown>('/api/engine/basis', { cache: 'no-store', signal }),
        );
        if (decoded === null) throw new Error('INVALID_BASIS_RUNTIME_RESPONSE');
        return decoded;
      },
      onSuccess: (next) => {
        setSnapshot(next);
        setError(null);
      },
      onError: (reason) => setError(apiErrorMessage(reason, 'Basis runtime unavailable')),
    });
    poll.start();
    return poll.stop;
  }, []);

  const rows = snapshot?.rows ?? [];
  const openProposalCount = rows.filter(hasAttachedOpenProposal).length;
  const proposalReconciliationCount = rows.filter(
    (row) => (row.state === 'PROPOSED') !== hasAttachedOpenProposal(row),
  ).length;
  const query = search.trim().toUpperCase();
  const counts = useMemo(() => ({
    all: rows.length,
    candidates: rows.filter((row) => row.state === 'WATCHING' || row.state === 'FOCUS' || row.state === 'PROPOSED').length,
    proposals: rows.filter(hasAttachedOpenProposal).length,
    borrow: rows.filter((row) => row.rejectCode?.startsWith('borrow_')).length,
    rejected: rows.filter((row) => row.decisionKind === 'reject').length,
  }), [rows]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (
      query &&
      !row.symbol.includes(query) &&
      !row.base.includes(query) &&
      !row.reason.toUpperCase().includes(query) &&
      !(row.rejectCode ?? '').toUpperCase().includes(query)
    ) return false;
    if (filter === 'candidates') return row.state === 'WATCHING' || row.state === 'FOCUS' || row.state === 'PROPOSED';
    if (filter === 'proposals') return hasAttachedOpenProposal(row);
    if (filter === 'borrow') return row.rejectCode?.startsWith('borrow_');
    if (filter === 'rejected') return row.decisionKind === 'reject';
    return true;
  }), [filter, query, rows]);

  const liveFeed = Boolean(!error && snapshot && basisRuntimeCurrent(snapshot));
  const watchlist = state?.config.watchlist ?? [];
  const watchWritable = stateStatus === 'CURRENT' && liveFeed;
  const queueSize = snapshot ? snapshot.status.watching + snapshot.status.focused : null;
  const retainedSnapshot = Boolean(error && snapshot);
  const feedTone = liveFeed
    ? 'active'
    : retainedSnapshot
      ? 'retained'
      : error
        ? 'unavailable'
        : snapshot
          ? 'degraded'
          : 'starting';
  const feedLabel = liveFeed
    ? 'Market Inputs Current'
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
    <div className="container page volx-page basx-page">
      <section className="volx-frame" aria-label="basis workspace">
        <header className="volx-toolbar">
          <div className="volx-title basx-title">
            <img className="basx-page-mark" src="/basis-percent.png" alt="" aria-hidden="true" />
            <h1>Basis</h1>
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
              aria-label="Search Basis"
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

        <div className="volx-summary" aria-label="Basis Summary">
          <div className="volx-summary-cell">
            <span>Eligible Pairs</span>
            <strong>{retainedSnapshot ? 'UNKNOWN' : snapshot?.status.universeSize ?? '—'}</strong>
            <small>{retainedSnapshot ? 'STALE LAST-KNOWN · current universe withheld' : 'Liquid Binance spot + USD-M pairs'}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Decision Queue</span>
            <strong>{retainedSnapshot ? 'UNKNOWN' : queueSize ?? '—'}</strong>
            <small>{retainedSnapshot ? 'STALE LAST-KNOWN · current queue withheld' : snapshot ? snapshot.status.watching + ' watching · ' + snapshot.status.focused + ' focused' : 'Waiting for runtime'}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Open Proposals</span>
            <strong>{retainedSnapshot ? 'UNKNOWN' : snapshot ? openProposalCount : '—'}</strong>
            <small>
              {retainedSnapshot
                ? 'STALE LAST-KNOWN · current proposals withheld'
                : snapshot == null
                ? 'Runtime truth unavailable'
                : proposalReconciliationCount > 0
                  ? `${proposalReconciliationCount} lifecycle/store reconciliation ${proposalReconciliationCount === 1 ? 'row' : 'rows'} · attached-open only`
                : openProposalCount
                  ? 'Attached open proposals only'
                  : 'No setup has cleared every gate'}
            </small>
          </div>
          <div className="volx-summary-cell">
            <span>Borrow Verified</span>
            <strong>{retainedSnapshot ? 'UNKNOWN' : snapshot?.status.verifiedBorrow ?? '—'} {!retainedSnapshot ? <em>/ {snapshot?.status.universeSize ?? '—'}</em> : null}</strong>
            <small>{retainedSnapshot ? 'STALE LAST-KNOWN · current borrow checks withheld' : 'Unknown borrow is blocked, never inferred'}</small>
          </div>
        </div>

        <details className="moneyx-binding-details">
          <summary><span>Canonical Integration Evidence</span><small>Required Basis owner fields</small></summary>
          <ProductSurfaceAdapter surfaceId="basis" />
        </details>

        {retainedSnapshot ? (
          <div className="volx-retained" role="status">
            <Activity size={14} aria-hidden="true" />
            <span><strong>Retained engine snapshot</strong> · Refresh failed. Values below are last received from the runtime, not current.</span>
          </div>
        ) : null}

        <div className="volx-filters">
          <div className="volx-segments" role="group" aria-label="Basis row filters">
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
              {snapshot ? 'Crossed books ' + snapshot.status.bookState + ' · marks ' + snapshot.status.markState : 'Runtime starting'}
            </span>
            <span className="volx-authority">Monitor only · execution unavailable</span>
          </div>
        </div>

        <div
          className="volx-table basx-table"
          role="table"
          aria-label="Basis Scanner Decisions"
          data-current={liveFeed ? 'true' : 'false'}
          data-retained={retainedSnapshot ? 'true' : 'false'}
        >
          <div className="basx-head" role="row">
            <span role="columnheader">State</span>
            <span role="columnheader">Asset</span>
            <span role="columnheader">Executable Gap</span>
            <span role="columnheader">Execution Prices</span>
            <span role="columnheader">Funding</span>
            <span role="columnheader">Costs / Net</span>
            <span role="columnheader">Market Quality</span>
            <span role="columnheader">Decision</span>
            <span aria-hidden="true" />
          </div>

          {error && !snapshot ? (
            <div className="volx-empty">
              <Activity size={18} />
              <strong>Basis Runtime Unavailable</strong>
              <span>{error}</span>
            </div>
          ) : !snapshot ? (
            <div className="volx-empty">
              <Radio size={18} />
              <strong>Connecting To Basis Runtime</strong>
              <span>Waiting for public Binance spot, USD-M book, mark, and funding sources.</span>
            </div>
          ) : filteredRows.length ? filteredRows.map((row) => {
            const rowCurrent = liveFeed && row.dataQuality.score >= snapshot.thresholds.minDataQuality;
            const rowWatchWritable = watchWritable && rowCurrent;
            const isExpanded = expanded === row.symbol;
            const watching = watchlist.includes(row.symbol);
            const prices = executionPrices(row);
            const detailId = `basis-detail-${row.symbol}`;
            return (
              <div className="basx-item" role="rowgroup" key={row.symbol}>
                <div
                  className="basx-row"
                  role="row"
                >
                  <span className={'volx-state ' + stateTone(row, rowCurrent)} role="cell">
                    <i aria-hidden="true" />
                    {retainedSnapshot ? 'Stale ' : ''}{stateLabel(row)}
                  </span>
                  <span className="volx-asset" role="cell">
                    <TokenIcon symbol={row.symbol} size={28} />
                    <span><strong>{row.base}</strong><small>{fmtMoney(row.quoteVolume24h)} 24h</small></span>
                  </span>
                  <span className="basx-gap" role="cell">
                    <strong>{fmtBasis(row.executableGapPct)}</strong>
                    <small>{directionLabel(row.direction)}</small>
                  </span>
                  <span className="basx-prices" role="cell">
                    <strong>{prices.primary}</strong>
                    <small>{prices.secondary}</small>
                  </span>
                  <span className="basx-funding" role="cell">
                    <strong>{fmtFunding(row.fundingRate)}</strong>
                    <small>{row.nextFundingTs ? countdown(row.nextFundingTs) + ' · Carry ' + fmtBasis(row.fundingCarryPct) : 'Funding unavailable'}</small>
                  </span>
                  <span className={'basx-edge ' + edgeTone(row, rowCurrent)} role="cell">
                    <strong>{fmtBasis(row.netEdgePct)}</strong>
                    <small>Gross {fmtBasis(row.executableGapPct)} · Cost {fmtBasis(row.costs.totalPct)}</small>
                  </span>
                  <span className="volx-quality basx-quality" role="cell">
                    <strong>{Math.round(row.dataQuality.score * 100) + '% Trust'}</strong>
                    <small>{bps(row.spotSpreadBps)} / {bps(row.perpSpreadBps)}</small>
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
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.symbol} basis evidence`}
                      onClick={() => setExpanded(isExpanded ? null : row.symbol)}
                    >
                      <ChevronDown className={isExpanded ? 'expanded' : ''} size={15} aria-hidden="true" />
                    </button>
                  </span>
                </div>

                {isExpanded ? (
                  <div className="volx-detail basx-detail" id={detailId}>
                    <div className="volx-reason">
                      <span>Scanner Decision</span>
                      <p>{row.reason}</p>
                      <small><Radio size={13} />{snapshot.status.bookSource} · {snapshot.status.markSource}</small>
                    </div>
                    <dl className="volx-facts basx-facts">
                      <div><dt>Spot Bid / Ask</dt><dd>{fmtPrice(row.spotBid)} / {fmtPrice(row.spotAsk)}</dd></div>
                      <div><dt>Perp Bid / Ask</dt><dd>{fmtPrice(row.perpBid)} / {fmtPrice(row.perpAsk)}</dd></div>
                      <div><dt>Alternate Gap</dt><dd>{fmtBasis(row.alternateGapPct)}</dd></div>
                      <div><dt>Gap Age</dt><dd>{durationCompact(row.gapAgeMs)}</dd></div>
                      <div><dt>Gap Slope</dt><dd>{finite(row.gapSlopePctPerMin) ? fmtBasis(row.gapSlopePctPerMin) + '/min' : '—'}</dd></div>
                      <div><dt>Persistence</dt><dd>{row.persistTicks}/{snapshot.thresholds.persistTicks} ticks</dd></div>
                      <div><dt>Four-Leg Fees</dt><dd>{fmtBasis(row.costs.feesPct)}</dd></div>
                      <div><dt>Slippage At {fmtMoney(snapshot.thresholds.intendedNotionalUsd)}</dt><dd>{fmtBasis(row.slippagePct)}</dd></div>
                      <div><dt>Funding Carry</dt><dd>{fmtBasis(row.fundingCarryPct)}</dd></div>
                      <div><dt>Expected Hold</dt><dd>{durationCompact(row.expectedHoldMs)}</dd></div>
                      <div><dt>Depth Score</dt><dd>{finite(row.depthScore) ? row.depthScore.toFixed(2) : '—'} · {row.ladderBacked ? 'Ladder' : 'Top Book'}</dd></div>
                      <div><dt>Data Quality</dt><dd>{Math.round(row.dataQuality.score * 100)}%</dd></div>
                      <div><dt>Borrow Preflight</dt><dd>{titleCase(row.borrow.status)}</dd></div>
                      <div><dt>Borrow Reason</dt><dd title={row.borrow.human}>{row.borrow.human}</dd></div>
                      <div><dt>Reject Code</dt><dd>{row.rejectCode ? titleCase(row.rejectCode) : 'None'}</dd></div>
                      <div><dt>Proposal</dt><dd>{proposalDetail(row)}</dd></div>
                      <div><dt>Correlation</dt><dd title={row.correlationId ?? undefined}>{row.correlationId ?? 'None'}</dd></div>
                    </dl>
                    <div className="volx-actions">
                      <button type="button" onClick={() => openDetail(row.symbol)}><Eye size={14} />Open Market</button>
                      <button
                        type="button"
                        className={rowWatchWritable && watching ? 'active' : ''}
                        aria-pressed={watching}
                        disabled={!rowWatchWritable}
                        title={rowWatchWritable ? undefined : 'Watch changes require current compatibility, current Basis runtime truth, and row data quality at or above the configured minimum.'}
                        onClick={() => {
                          if (rowWatchWritable) void toggleWatch(row.symbol);
                        }}
                      >
                        <Star size={14} fill={watching ? 'currentColor' : 'none'} />
                        {rowWatchWritable ? watching ? 'Watching' : 'Watch' : watching ? 'Watching · Change Unavailable' : 'Watch Unavailable'}
                      </button>
                      <button type="button" onClick={() => openLedger(row.symbol)}><BookOpen size={14} />Open Logs</button>
                      <button type="button" onClick={() => setPage('opportunities')}><ArrowRightLeft size={14} />Open Queue</button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          }) : rows.length === 0 && retainedSnapshot ? (
            <div className="volx-empty">
              <Activity size={18} />
              <strong>Basis Rows Stale Last-Known</strong>
              <span>The retained runtime response contained no rows. Current row absence is unknown.</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="volx-empty">
              <Activity size={18} />
              <strong>No Basis Decisions Available</strong>
              <span>The current engine snapshot contains no basis rows. Nothing is simulated.</span>
            </div>
          ) : (
            <div className="volx-empty">
              <Activity size={18} />
              <strong>No Basis Rows Match</strong>
              <span>Change the filter or search term. No rows are simulated.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

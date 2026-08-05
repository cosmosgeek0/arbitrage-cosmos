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
import { TokenIcon } from '../components/TokenIcon';
import { countdown, fmtBasis, fmtFunding, fmtMoney, fmtPrice, timeAgo } from '../format';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { privateReadFreshness, projectPrivateRead } from '../lib/privateRead';
import { useStore } from '../store';
import { useProductControlRoomContext } from '../features/productControlRoom/ProductControlRoomProvider';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import {
  basisRuntimeSnapshotCurrent,
  decodeBasisRuntimeSnapshot,
  type BasisRow,
  type BasisSnapshot,
} from '../lib/basisRuntime';
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
  if (row.state === 'PROPOSED') return 'Proposal';
  if (row.state === 'FOCUS') return 'Focused';
  if (row.state === 'WATCHING') return 'Watching';
  if (row.decisionKind === 'reject' || row.state === 'REJECTED' || row.state === 'COOLDOWN') return 'Rejected';
  return 'Monitoring';
}

function stateTone(row: BasisRow): string {
  if (row.state === 'PROPOSED') return 'proposal';
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
  if (row.decisionKind === 'ignore') return 'Below Watch Gate';
  return titleCase(row.decisionKind);
}

export type BasisRuntimeTruth = Readonly<{
  current: boolean;
  state: 'STARTING' | 'LIVE' | 'UNAVAILABLE';
  label: 'Starting' | 'Live' | 'Unavailable';
  reason: string | null;
}>;

export function resolveBasisRuntimeTruth(input: Readonly<{
  canonicalState: 'LOADING' | 'READY' | 'UNAVAILABLE';
  canonicalReason: string | null;
  snapshot: BasisSnapshot | null;
  requestError: string | null;
  nowMs?: number;
}>): BasisRuntimeTruth {
  if (input.requestError) {
    return Object.freeze({ current: false, state: 'UNAVAILABLE', label: 'Unavailable', reason: input.requestError });
  }
  if (input.snapshot && !input.snapshot.status.running) {
    const canonicalSuffix = input.canonicalReason ? ` · ${input.canonicalReason}` : '';
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Unavailable',
      reason: input.snapshot.status.lastError ?? `BASIS_RUNTIME_STOPPED${canonicalSuffix}`,
    });
  }
  if (input.canonicalState === 'UNAVAILABLE') {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Unavailable',
      reason: input.canonicalReason ?? 'BASIS_ENGINE_CANONICAL_TRUTH_UNAVAILABLE',
    });
  }
  if (!input.snapshot) {
    return Object.freeze({ current: false, state: 'STARTING', label: 'Starting', reason: null });
  }
  if (input.snapshot.status.lastError) {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Unavailable',
      reason: input.snapshot.status.lastError,
    });
  }
  if (input.snapshot.status.bookState !== 'fresh' || input.snapshot.status.markState !== 'fresh') {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Unavailable',
      reason: `BASIS_SOURCE_NOT_CURRENT: books=${input.snapshot.status.bookState}; marks=${input.snapshot.status.markState}`,
    });
  }
  if (!basisRuntimeSnapshotCurrent(input.snapshot, input.nowMs)) {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Unavailable',
      reason: 'BASIS_SOURCE_TIMESTAMPS_NOT_CURRENT',
    });
  }
  if (input.canonicalState === 'LOADING') {
    return Object.freeze({ current: false, state: 'STARTING', label: 'Starting', reason: null });
  }
  return Object.freeze({ current: true, state: 'LIVE', label: 'Live', reason: null });
}

export type BasisAccountTruth = Readonly<{
  spotCurrent: boolean;
  marginCurrent: boolean;
  spotAvailableUsdt: string | null;
  marginLiabilityBtc: string | null;
  liabilityCount: number | null;
  sourceLabel: string;
  spotReason: string | null;
  marginReason: string | null;
}>;

export function resolveBasisAccountTruth(input: Readonly<{
  source: 'PENDING' | 'STATE' | 'FALLBACK';
  requestError: string | null;
  freshnessState: 'CURRENT' | 'STALE' | 'UNKNOWN' | 'NOT_CONFIGURED';
  freshnessReason: string;
  spotState: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  spotFreshnessState: 'CURRENT' | 'STALE' | 'UNKNOWN' | 'NOT_CONFIGURED';
  spotFreshnessReason: string;
  spotCoverageState: 'COMPLETE_CURRENT' | 'PARTIAL_SYMBOL_SCOPED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  spotBalancesAvailable: boolean;
  spotAvailableUsdt: string | null;
  marginState: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  marginFreshnessState: 'CURRENT' | 'STALE' | 'UNKNOWN' | 'NOT_CONFIGURED';
  marginFreshnessReason: string;
  marginCoverageState: 'COMPLETE_CURRENT' | 'PARTIAL_SYMBOL_SCOPED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  marginAssetsAvailable: boolean;
  liabilityReconciliationState: 'RECONCILED' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  liabilityFreshnessState: 'CURRENT' | 'STALE' | 'UNKNOWN' | 'NOT_CONFIGURED';
  liabilityFreshnessReason: string;
  marginLiabilityBtc: string | null;
  liabilityCount: number | null;
}>): BasisAccountTruth {
  const sourceLabel = input.source === 'STATE'
    ? 'State Account Read'
    : input.source === 'FALLBACK'
      ? 'Fallback Account Read'
      : 'Account Source Pending';
  const accountReason = input.requestError
    ?? (input.source === 'PENDING' ? 'Account source pending' : null)
    ?? (input.freshnessState === 'CURRENT' ? null : input.freshnessReason);
  const spotReason = accountReason
    ?? (input.spotState === 'AVAILABLE' ? null : `Spot account ${titleCase(input.spotState)}`)
    ?? (input.spotFreshnessState === 'CURRENT' ? null : input.spotFreshnessReason)
    ?? (input.spotCoverageState === 'COMPLETE_CURRENT' ? null : `Spot coverage ${titleCase(input.spotCoverageState)}`)
    ?? (input.spotBalancesAvailable ? null : 'Spot balance rows unavailable')
    ?? (input.spotAvailableUsdt !== null ? null : 'USDT free balance unavailable');
  const marginReason = accountReason
    ?? (input.marginState === 'AVAILABLE' ? null : `Margin account ${titleCase(input.marginState)}`)
    ?? (input.marginFreshnessState === 'CURRENT' ? null : input.marginFreshnessReason)
    ?? (input.marginCoverageState === 'COMPLETE_CURRENT' ? null : `Margin coverage ${titleCase(input.marginCoverageState)}`)
    ?? (input.liabilityReconciliationState === 'RECONCILED'
      ? null
      : `Liability reconciliation ${titleCase(input.liabilityReconciliationState)}`)
    ?? (input.liabilityFreshnessState === 'CURRENT' ? null : input.liabilityFreshnessReason)
    ?? (input.marginAssetsAvailable ? null : 'Margin asset rows unavailable')
    ?? (input.marginLiabilityBtc !== null && input.liabilityCount !== null ? null : 'Margin liability facts unavailable');
  const spotCurrent = spotReason === null;
  const marginCurrent = marginReason === null;
  return Object.freeze({
    spotCurrent,
    marginCurrent,
    spotAvailableUsdt: spotCurrent ? input.spotAvailableUsdt : null,
    marginLiabilityBtc: marginCurrent ? input.marginLiabilityBtc : null,
    liabilityCount: marginCurrent ? input.liabilityCount : null,
    sourceLabel,
    spotReason,
    marginReason,
  });
}

export function Strategies() {
  const { binding } = useProductControlRoomContext();
  const {
    state,
    privateRead,
    privateReadError,
    privateReadSource,
    openDetail,
    openLedger,
    setPage,
    toggleWatch,
  } = useStore();
  const [snapshot, setSnapshot] = useState<BasisSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const poll = createSettledPoll<BasisSnapshot>({
      intervalMs: 2_000,
      request: async (signal) => {
        const decoded = decodeBasisRuntimeSnapshot(
          await fetchJson('/api/engine/basis', { cache: 'no-store', signal }),
        );
        if (decoded === null) throw new TypeError('Basis runtime read failed its published contract.');
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

  const basisComponent = binding.snapshot?.components.find((component) => component.componentId === 'basis-engine');
  const basisCanonicalReason = binding.continuity !== 'PROVEN'
    ? binding.error ?? `CANONICAL_CONTINUITY_${binding.continuity}`
    : basisComponent
      ? `BASIS_ENGINE_${basisComponent.observedLifecycle}: ${[
        basisComponent.blockerCode,
        basisComponent.canonicalPresentation.stateLabel,
      ].filter(Boolean).join(' · ')}`
      : 'BASIS_ENGINE_CANONICAL_TRUTH_MISSING';
  const basisCanonicalReady = Boolean(
    binding.continuity === 'PROVEN'
    && basisComponent?.observedLifecycle === 'READY'
    && basisComponent.canonicalPresentation.status === 'operational',
  );
  const basisCanonicalLoading = Boolean(
    binding.loading && binding.snapshot === null && binding.error === null
    || binding.continuity === 'PROVEN'
      && basisComponent
      && ['START_REQUESTED', 'STARTING', 'WARMING'].includes(basisComponent.observedLifecycle),
  );
  const basisTruth = resolveBasisRuntimeTruth({
    canonicalState: basisCanonicalReady ? 'READY' : basisCanonicalLoading ? 'LOADING' : 'UNAVAILABLE',
    canonicalReason: basisCanonicalReason,
    snapshot,
    requestError: error,
    nowMs,
  });
  const accountNow = nowMs;
  const privatePresentation = projectPrivateRead(privateRead, accountNow);
  const spotFreshness = privateReadFreshness({
    ...privateRead,
    state: privateRead.spot.state,
    observedAt: privateRead.spot.observedAt,
  }, accountNow);
  const marginFreshness = privateReadFreshness({
    ...privateRead,
    state: privateRead.margin.state,
    observedAt: privateRead.margin.observedAt,
  }, accountNow);
  const liabilityFact = privateRead.reconciliation.liabilities;
  const liabilityFreshness = privateReadFreshness({
    ...privateRead,
    state: liabilityFact.state === 'RECONCILED'
      ? 'AVAILABLE'
      : liabilityFact.state === 'NOT_CONFIGURED'
        ? 'NOT_CONFIGURED'
        : 'UNAVAILABLE',
    observedAt: liabilityFact.observedAt,
  }, accountNow);
  const accountTruth = resolveBasisAccountTruth({
    source: privateReadSource,
    requestError: privateReadError,
    freshnessState: privatePresentation.freshness.state,
    freshnessReason: privatePresentation.freshness.reason,
    spotState: privateRead.spot.state,
    spotFreshnessState: spotFreshness.state,
    spotFreshnessReason: spotFreshness.reason,
    spotCoverageState: privateRead.spot.coverage.state,
    spotBalancesAvailable: privateRead.spot.balances !== null,
    spotAvailableUsdt: privatePresentation.spotAvailableUsdt,
    marginState: privateRead.margin.state,
    marginFreshnessState: marginFreshness.state,
    marginFreshnessReason: marginFreshness.reason,
    marginCoverageState: privateRead.margin.coverage.state,
    marginAssetsAvailable: privateRead.margin.assets !== null,
    liabilityReconciliationState: privateRead.reconciliation.liabilities.state,
    liabilityFreshnessState: liabilityFreshness.state,
    liabilityFreshnessReason: liabilityFreshness.reason,
    marginLiabilityBtc: privatePresentation.marginLiabilityBtc,
    liabilityCount: privatePresentation.counts.liabilities,
  });
  // A failed canonical envelope must not blank this page's own live feed. The
  // engine snapshot is re-resolved against the identical contract and freshness
  // rules with the canonical gate held READY, so rows stay visible only while
  // this page's own evidence is valid and current. This decouples row
  // VISIBILITY from envelope continuity and nothing else: every canonical
  // claim, count of canonical facts, and control gate still reads basisTruth.
  const canonicalBindingProven = binding.continuity === 'PROVEN';
  const basisEngineFeedTruth = resolveBasisRuntimeTruth({
    canonicalState: 'READY',
    canonicalReason: null,
    snapshot,
    requestError: error,
    nowMs,
  });
  const basisEngineRowsVisible = !basisTruth.current
    && !canonicalBindingProven
    && basisEngineFeedTruth.current;
  const basisEngineFeedNote = `Canonical binding not proven · ${binding.continuity} · Basis engine feed live`;
  const rows = basisTruth.current ? snapshot?.rows ?? [] : [];
  const visibleRows = basisEngineRowsVisible ? snapshot?.rows ?? [] : rows;
  const query = search.trim().toUpperCase();
  const counts = useMemo(() => ({
    all: visibleRows.length,
    candidates: visibleRows.filter((row) => row.state === 'WATCHING' || row.state === 'FOCUS' || row.state === 'PROPOSED').length,
    proposals: visibleRows.filter((row) => row.state === 'PROPOSED').length,
    borrow: visibleRows.filter((row) => row.rejectCode?.startsWith('borrow_')).length,
    rejected: visibleRows.filter((row) => row.decisionKind === 'reject').length,
  }), [visibleRows]);

  const filteredRows = useMemo(() => visibleRows.filter((row) => {
    if (
      query &&
      !row.symbol.includes(query) &&
      !row.base.includes(query) &&
      !row.reason.toUpperCase().includes(query) &&
      !(row.rejectCode ?? '').toUpperCase().includes(query)
    ) return false;
    if (filter === 'candidates') return row.state === 'WATCHING' || row.state === 'FOCUS' || row.state === 'PROPOSED';
    if (filter === 'proposals') return row.state === 'PROPOSED';
    if (filter === 'borrow') return row.rejectCode?.startsWith('borrow_');
    if (filter === 'rejected') return row.decisionKind === 'reject';
    return true;
  }), [filter, query, visibleRows]);

  const watchlist = state?.config.watchlist ?? [];
  const basisUnassertedDetail = basisTruth.reason ?? 'Canonical Basis runtime loading';

  return (
    <div className="container page volx-page basx-page">
      <section className="volx-frame" aria-label="basis workspace">
        <header className="volx-toolbar">
          <div className="volx-title basx-title">
            <img className="basx-page-mark" src="/basis-percent.png" alt="" aria-hidden="true" />
            <h1>Basis</h1>
            <span
              className={'volx-live ' + (basisTruth.state === 'LIVE' ? 'active' : basisTruth.state === 'UNAVAILABLE' ? 'degraded' : 'starting')}
              role="status"
              title={basisTruth.reason ?? undefined}
            >
              <i aria-hidden="true" />
              {basisTruth.label}
            </span>
            <span className="volx-updated">
              {basisTruth.current && snapshot
                ? 'Updated ' + timeAgo(snapshot.updatedAt)
                : basisEngineRowsVisible && snapshot
                  ? basisEngineFeedNote + ' · updated ' + timeAgo(snapshot.updatedAt)
                  : basisUnassertedDetail}
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
            <strong>{basisTruth.current ? snapshot?.status.universeSize ?? 'UNKNOWN' : 'UNKNOWN'}</strong>
            <small>{basisTruth.current && snapshot
              ? `${snapshot.status.watching} watching · ${snapshot.status.focused} focused · ${snapshot.status.openProposals} proposals`
              : basisUnassertedDetail}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Live Markets</span>
            <strong>{basisTruth.current ? 'CURRENT' : 'UNKNOWN'}</strong>
            <small>{basisTruth.current && snapshot
              ? `${snapshot.status.bookSource} · ${snapshot.status.markSource}`
              : basisUnassertedDetail}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Available USDT</span>
            <strong>{accountTruth.spotAvailableUsdt ?? 'UNKNOWN'}</strong>
            <small>{accountTruth.spotCurrent
              ? `${accountTruth.sourceLabel} · ${privatePresentation.freshness.label} · spot free balance`
              : accountTruth.spotReason}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Margin Liability BTC</span>
            <strong>{accountTruth.marginLiabilityBtc ?? 'UNKNOWN'}</strong>
            <small>{accountTruth.marginCurrent
              ? `${accountTruth.liabilityCount} liability assets · ${accountTruth.sourceLabel}`
              : accountTruth.marginReason}</small>
          </div>
        </div>

        <ProductSurfaceAdapter surfaceId="basis" />

        <div className="volx-filters">
          <div className="volx-segments" role="tablist" aria-label="Basis Views">
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
                <span>{basisTruth.current || basisEngineRowsVisible ? counts[item.id] : 'UNKNOWN'}</span>
              </button>
            ))}
          </div>
          <span className="volx-view-note">
            {basisTruth.current && snapshot
              ? 'Crossed books ' + snapshot.status.bookState + ' · marks ' + snapshot.status.markState
              : basisEngineRowsVisible && snapshot
                ? basisEngineFeedNote + ' · crossed books ' + snapshot.status.bookState + ' · marks ' + snapshot.status.markState
                : basisUnassertedDetail}
          </span>
        </div>

        <div className="volx-table basx-table" role="table" aria-label="Basis Scanner Decisions">
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

          {basisTruth.state === 'UNAVAILABLE' && !basisEngineRowsVisible ? (
            <div className="volx-empty">
              <Activity size={18} />
              <strong>Basis Runtime Unavailable</strong>
              <span>{basisTruth.reason}</span>
            </div>
          ) : basisTruth.state === 'STARTING' || !snapshot ? (
            <div className="volx-empty">
              <Radio size={18} />
              <strong>Connecting To Basis Runtime</strong>
              <span>Waiting for public Binance spot, USD-M book, mark, and funding sources.</span>
            </div>
          ) : filteredRows.length ? filteredRows.map((row) => {
            const isExpanded = expanded === row.symbol;
            const watching = watchlist.includes(row.symbol);
            const prices = executionPrices(row);
            return (
              <div className="basx-item" role="rowgroup" key={row.symbol}>
                <button
                  type="button"
                  className="basx-row"
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded(isExpanded ? null : row.symbol)}
                >
                  <span className={'volx-state ' + stateTone(row)} role="cell">
                    <i aria-hidden="true" />
                    {stateLabel(row)}
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
                  <span className="basx-edge" role="cell">
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
                  <ChevronDown className={isExpanded ? 'expanded' : ''} size={15} aria-hidden="true" />
                </button>

                {isExpanded ? (
                  <div className="volx-detail basx-detail">
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
                      <div><dt>Correlation</dt><dd title={row.correlationId ?? undefined}>{row.correlationId ?? 'None'}</dd></div>
                    </dl>
                    <div className="volx-actions">
                      <button type="button" onClick={() => openDetail(row.symbol)}><Eye size={14} />Open Market</button>
                      <button type="button" className={watching ? 'active' : ''} onClick={() => void toggleWatch(row.symbol)}>
                        <Star size={14} fill={watching ? 'currentColor' : 'none'} />{watching ? 'Watching' : 'Watch'}
                      </button>
                      <button type="button" onClick={() => openLedger(row.symbol)}><BookOpen size={14} />Open Logs</button>
                      <button type="button" onClick={() => setPage('opportunities')}><ArrowRightLeft size={14} />Open Queue</button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          }) : (
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

import { useEffect, useMemo, useState } from 'react';
import {
  Eye,
  Radar,
  Search,
  X,
} from 'lucide-react';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import { projectMarketConsumerTruth } from '../components/Header';
import { TokenIcon } from '../components/TokenIcon';
import { countdown, fmtBasis, fmtFunding, fmtMoney, fmtPct, fmtPrice, timeAgo } from '../format';
import {
  BASIS_MAX_FUTURE_SKEW_MS,
  BASIS_RUNTIME_FRESH_MS,
  basisRuntimeSnapshotCurrent,
  decodeBasisRuntimeSnapshot,
  type BasisSnapshot,
} from '../lib/basisRuntime';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { useStore } from '../store';
import {
  decodeVolumeRuntimeSnapshot,
  resolveVolumeRuntimeTruth,
  volumeRowsCurrent,
} from './VolumeScanner';
import './Opportunities.css';

type View = 'active' | 'raw';

const VIEWS: { id: View; label: string }[] = [
  { id: 'active', label: 'Engine Proposal Facts' },
  { id: 'raw', label: 'Raw Market Facts' },
];

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function rawFact(value: number | null | undefined, format: (known: number) => string): string {
  return finite(value) ? format(value) : 'UNKNOWN';
}

type OpportunitySource = 'BASIS' | 'VOLUME';
type VolumeRuntimeSnapshot = NonNullable<ReturnType<typeof decodeVolumeRuntimeSnapshot>>;

export type OpportunitySourceTruthLabel =
  | 'CURRENT'
  | 'DEGRADED'
  | 'STALE LAST-KNOWN'
  | 'CONFLICT'
  | 'LOADING'
  | 'UNAVAILABLE';

export interface PublishedOpportunityFact {
  readonly source: OpportunitySource;
  readonly proposalId: string;
  readonly symbol: string;
  readonly base: string;
  readonly lifecycle: string;
  readonly direction: string;
  readonly reason: string;
  readonly invalidation: string | null;
  readonly reportedNetEdgePct: number | null;
  readonly grossEdgePct: number | null;
  readonly feesPct: number | null;
  readonly slippagePct: number | null;
  readonly fundingDragPct: number | null;
  readonly borrowCostPct: number | null;
  readonly totalCostPct: number | null;
  readonly fundingRate: number | null;
  readonly quoteVolume24h: number | null;
  readonly spotPrice: number | null;
  readonly perpPrice: number | null;
  readonly confidence: number | null;
  readonly observedAtMs: number | null;
  readonly volume1sMultiple: number | null;
  readonly volume5sMultiple: number | null;
  readonly tradeCountMultiple: number | null;
  readonly topDepthUsd: number | null;
  readonly spreadBps: number | null;
  readonly expiresAtMs: number | null;
}

export interface OpportunitySourceRead {
  readonly source: OpportunitySource;
  readonly updatedAt: number;
  readonly openProposals: number;
  readonly countConsistent: boolean;
  readonly runtimeSnapshot: BasisSnapshot | VolumeRuntimeSnapshot;
  readonly evidence: string;
  readonly facts: readonly PublishedOpportunityFact[];
}

export interface OpportunitySourceTruth {
  readonly label: OpportunitySourceTruthLabel;
  readonly detail: string;
}

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : null;
}

function finiteRequired(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function basisFact(
  row: Record<string, unknown>,
  updatedAt: number,
): PublishedOpportunityFact | null {
  const proposal = record(row.proposal);
  const costs = record(row.costs);
  const borrow = record(row.borrow);
  if (
    proposal === null
    || costs === null
    || borrow === null
    || !nonEmptyString(row.symbol)
    || !nonEmptyString(row.base)
    || (row.direction !== 'long_spot_short_perp' && row.direction !== 'short_spot_long_perp')
    || row.decisionKind !== 'proposal'
    || !nonEmptyString(row.reason)
    || !finiteRequired(row.spotBid)
    || !finiteRequired(row.spotAsk)
    || !finiteRequired(row.perpBid)
    || !finiteRequired(row.perpAsk)
    || !finiteRequired(row.executableGapPct)
    || !finiteRequired(row.fundingRate)
    || !finiteRequired(row.quoteVolume24h)
    || !finiteRequired(row.decisionTs)
    || !finiteRequired(row.netEdgePct)
    || !finiteRequired(costs.feesPct)
    || !finiteRequired(costs.slippagePct)
    || !finiteRequired(costs.fundingDragPct)
    || !finiteRequired(costs.borrowCostPct)
    || !finiteRequired(costs.totalPct)
    || !nonEmptyString(borrow.status)
    || !nonEmptyString(borrow.human)
    || !nonEmptyString(proposal.id)
    || !nonEmptyString(proposal.status)
    || String(proposal.status).toUpperCase() !== 'OPEN'
    || !finiteRequired(proposal.netEdgePct)
    || proposal.netEdgePct !== row.netEdgePct
    || !finiteRequired(proposal.confidence)
    || !nonEmptyString(proposal.invalidation)
  ) return null;

  const longSpot = row.direction === 'long_spot_short_perp';
  return Object.freeze({
    source: 'BASIS',
    proposalId: proposal.id,
    symbol: row.symbol,
    base: row.base,
    lifecycle: proposal.status,
    direction: longSpot ? 'Buy Spot · Sell Perp' : 'Sell Spot · Buy Perp',
    reason: row.reason,
    invalidation: proposal.invalidation,
    reportedNetEdgePct: proposal.netEdgePct,
    grossEdgePct: row.executableGapPct,
    feesPct: costs.feesPct,
    slippagePct: costs.slippagePct,
    fundingDragPct: costs.fundingDragPct,
    borrowCostPct: costs.borrowCostPct,
    totalCostPct: costs.totalPct,
    fundingRate: row.fundingRate,
    quoteVolume24h: row.quoteVolume24h,
    spotPrice: longSpot ? row.spotAsk : row.spotBid,
    perpPrice: longSpot ? row.perpBid : row.perpAsk,
    confidence: proposal.confidence,
    observedAtMs: row.decisionTs ?? updatedAt,
    volume1sMultiple: null,
    volume5sMultiple: null,
    tradeCountMultiple: null,
    topDepthUsd: null,
    spreadBps: null,
    expiresAtMs: null,
  });
}

function volumeFact(
  row: Record<string, unknown>,
  updatedAt: number,
): PublishedOpportunityFact | null {
  const proposal = record(row.proposal);
  const volumeMultiple = record(row.volumeMultiple);
  const tradeCountMultiple = record(row.tradeCountMultiple);
  if (
    proposal === null
    || volumeMultiple === null
    || tradeCountMultiple === null
    || !nonEmptyString(row.symbol)
    || !nonEmptyString(row.base)
    || !nonEmptyString(row.reason)
    || !finiteRequired(row.price)
    || !finiteRequired(row.decisionTs)
    || !finiteRequired(row.topDepthUsd)
    || !finiteRequired(row.spreadBps)
    || !finiteRequired(volumeMultiple['1s'])
    || !finiteRequired(volumeMultiple['5s'])
    || !finiteRequired(tradeCountMultiple['5s'])
    || !nonEmptyString(proposal.id)
    || !nonEmptyString(proposal.status)
    || String(proposal.status).toLowerCase() !== 'open'
    || !nonEmptyString(proposal.direction)
    || !nonEmptyString(proposal.reason)
    || !finiteRequired(proposal.confidence)
    || !finiteRequired(proposal.featureObservedAtMs)
    || !finiteRequired(proposal.expiresAtMs)
    || proposal.expiresAtMs <= proposal.featureObservedAtMs
    || proposal.expiresAtMs <= row.decisionTs
  ) return null;

  return Object.freeze({
    source: 'VOLUME',
    proposalId: proposal.id,
    symbol: row.symbol,
    base: row.base,
    lifecycle: proposal.status,
    direction: proposal.direction.replaceAll('_', ' '),
    reason: proposal.reason,
    invalidation: null,
    reportedNetEdgePct: null,
    grossEdgePct: null,
    feesPct: null,
    slippagePct: null,
    fundingDragPct: null,
    borrowCostPct: null,
    totalCostPct: null,
    fundingRate: null,
    quoteVolume24h: null,
    spotPrice: row.price,
    perpPrice: null,
    confidence: proposal.confidence,
    observedAtMs: proposal.featureObservedAtMs ?? row.decisionTs ?? updatedAt,
    volume1sMultiple: volumeMultiple['1s'] ?? null,
    volume5sMultiple: volumeMultiple['5s'] ?? null,
    tradeCountMultiple: tradeCountMultiple['5s'] ?? null,
    topDepthUsd: row.topDepthUsd,
    spreadBps: row.spreadBps,
    expiresAtMs: proposal.expiresAtMs ?? null,
  });
}

export function decodeBasisOpportunityRead(value: unknown): OpportunitySourceRead | null {
  try {
    const source = decodeBasisRuntimeSnapshot(value);
    if (source === null) return null;

    const facts: PublishedOpportunityFact[] = [];
    for (const candidate of source.rows) {
      const row = record(candidate as unknown);
      if (row === null) return null;
      if (row.state !== 'PROPOSED') continue;
      const fact = basisFact(row, source.updatedAt);
      if (fact === null) return null;
      facts.push(fact);
    }

    return Object.freeze({
      source: 'BASIS',
      updatedAt: source.updatedAt,
      openProposals: source.status.openProposals,
      countConsistent: source.status.openProposals === facts.length,
      runtimeSnapshot: source,
      evidence: `${source.status.bookSource} · ${source.status.markSource}`,
      facts: Object.freeze(facts),
    });
  } catch {
    return null;
  }
}

export function decodeVolumeOpportunityRead(value: unknown): OpportunitySourceRead | null {
  try {
    const source = decodeVolumeRuntimeSnapshot(value);
    if (source === null) return null;

    const facts: PublishedOpportunityFact[] = [];
    const symbols = new Set<string>();
    const proposalIds = new Set<string>();
    for (const candidate of source.rows) {
      const row = record(candidate as unknown);
      if (row === null || !nonEmptyString(row.symbol) || symbols.has(row.symbol)) return null;
      symbols.add(row.symbol);

      const proposal = row.proposal === null ? null : record(row.proposal);
      if (row.proposal !== null && proposal === null) return null;
      if (proposal !== null) {
        if (!nonEmptyString(proposal.id) || proposalIds.has(proposal.id)) return null;
        proposalIds.add(proposal.id);
      }

      if (row.state !== 'PROPOSED') continue;
      const fact = volumeFact(row, source.updatedAt);
      if (fact === null) return null;
      facts.push(fact);
    }

    return Object.freeze({
      source: 'VOLUME',
      updatedAt: source.updatedAt,
      openProposals: source.status.openProposals,
      countConsistent: source.status.openProposals === facts.length,
      runtimeSnapshot: source,
      evidence: `${source.status.source} · ${source.status.bookSource}`,
      facts: Object.freeze(facts),
    });
  } catch {
    return null;
  }
}

function opportunityReadCurrent(
  read: OpportunitySourceRead,
  nowMs: number,
): Readonly<{ current: boolean; reason: string | null }> {
  if (!read.countConsistent) {
    return Object.freeze({ current: false, reason: 'OPPORTUNITY_PROPOSAL_COUNT_CONFLICT' });
  }
  if (
    !finiteRequired(nowMs)
    || read.updatedAt <= 0
    || read.updatedAt > nowMs + BASIS_MAX_FUTURE_SKEW_MS
    || nowMs - read.updatedAt >= BASIS_RUNTIME_FRESH_MS
  ) {
    return Object.freeze({ current: false, reason: 'OPPORTUNITY_SOURCE_TIMESTAMP_NOT_CURRENT' });
  }

  if (read.source === 'BASIS') {
    if (!basisRuntimeSnapshotCurrent(read.runtimeSnapshot as BasisSnapshot, nowMs)) {
      return Object.freeze({ current: false, reason: 'BASIS_SOURCE_TIMESTAMPS_NOT_CURRENT' });
    }
  } else {
    const snapshot = read.runtimeSnapshot as VolumeRuntimeSnapshot;
    const truth = resolveVolumeRuntimeTruth({
      canonicalState: 'READY',
      canonicalReason: null,
      snapshotUpdatedAtMs: snapshot.updatedAt,
      snapshotStatus: snapshot.status,
      rowCount: snapshot.rows.length,
      rowContractCurrent: volumeRowsCurrent(snapshot),
      requestError: null,
      nowMs,
    });
    if (!truth.current) {
      return Object.freeze({ current: false, reason: truth.reason ?? 'VOLUME_SOURCE_NOT_CURRENT' });
    }
  }

  for (const fact of read.facts) {
    if (
      !finite(fact.observedAtMs)
      || fact.observedAtMs <= 0
      || fact.observedAtMs > nowMs + BASIS_MAX_FUTURE_SKEW_MS
      || fact.observedAtMs > read.updatedAt + BASIS_MAX_FUTURE_SKEW_MS
      || nowMs - fact.observedAtMs >= BASIS_RUNTIME_FRESH_MS
    ) {
      return Object.freeze({ current: false, reason: 'OPPORTUNITY_FACT_TIMESTAMP_NOT_CURRENT' });
    }
    if (fact.source === 'VOLUME' && (!finite(fact.expiresAtMs) || fact.expiresAtMs <= nowMs)) {
      return Object.freeze({ current: false, reason: 'VOLUME_PROPOSAL_EXPIRED' });
    }
  }

  return Object.freeze({ current: true, reason: null });
}

export function projectOpportunitySourceTruth(
  read: OpportunitySourceRead | null,
  error: string | null,
  nowMs = Date.now(),
): OpportunitySourceTruth {
  if (read === null) {
    return error
      ? Object.freeze({ label: 'UNAVAILABLE', detail: error })
      : Object.freeze({ label: 'LOADING', detail: 'Waiting for the existing engine read owner.' });
  }
  if (!read.countConsistent) {
    return Object.freeze({
      label: 'CONFLICT',
      detail: `${read.openProposals} reported · ${read.facts.length} published rows`,
    });
  }
  if (error !== null) {
    return Object.freeze({ label: 'STALE LAST-KNOWN', detail: error });
  }
  const runtime = opportunityReadCurrent(read, nowMs);
  if (!runtime.current) {
    return Object.freeze({ label: 'STALE LAST-KNOWN', detail: runtime.reason ?? read.evidence });
  }
  return Object.freeze({ label: 'CURRENT', detail: read.evidence });
}

export function projectPublishedOpportunityFacts(
  basis: OpportunitySourceRead | null,
  volume: OpportunitySourceRead | null,
  nowMs = Date.now(),
): readonly PublishedOpportunityFact[] {
  // Preserve owner order inside each source and a fixed Basis-then-Volume
  // section order. Never cross-strategy rank by edge or confidence.
  return Object.freeze([
    ...(basis && opportunityReadCurrent(basis, nowMs).current ? basis.facts : []),
    ...(volume && opportunityReadCurrent(volume, nowMs).current ? volume.facts : []),
  ]);
}

function multipleFact(value: number | null): string {
  if (!finite(value)) return 'UNKNOWN';
  return `${value.toFixed(value >= 10 ? 1 : 2)}×`;
}

function confidenceFact(value: number | null): string {
  return finite(value) ? `${Math.round(value * 100)}%` : 'UNKNOWN';
}

function basisSideLabel(value: 'LONG_SPOT_SHORT_PERP' | 'SHORT_SPOT_LONG_PERP' | null | undefined): string {
  if (value === 'LONG_SPOT_SHORT_PERP') return 'Long Spot · Short Perp';
  if (value === 'SHORT_SPOT_LONG_PERP') return 'Short Spot · Long Perp';
  return 'Side UNKNOWN';
}

function factMatches(fact: PublishedOpportunityFact, query: string): boolean {
  if (!query) return true;
  return [
    fact.source,
    fact.proposalId,
    fact.symbol,
    fact.base,
    fact.lifecycle,
    fact.direction,
    fact.reason,
    fact.invalidation ?? '',
  ].some((value) => value.toUpperCase().includes(query));
}

export function PublishedOpportunityFacts({
  facts,
  query,
  basisTruth,
  volumeTruth,
  coverageKnown,
}: {
  readonly facts: readonly PublishedOpportunityFact[];
  readonly query: string;
  readonly basisTruth: Readonly<OpportunitySourceTruth>;
  readonly volumeTruth: Readonly<OpportunitySourceTruth>;
  readonly coverageKnown: boolean;
}) {
  const filtered = facts.filter((fact) => factMatches(fact, query));
  const currentCoverage = basisTruth.label === 'CURRENT' && volumeTruth.label === 'CURRENT';
  const truthFor = (source: OpportunitySource) => source === 'BASIS' ? basisTruth : volumeTruth;

  return (
    <div className="opportunityx-table" role="table" aria-label="Published Engine Proposal Facts">
      <div className="opportunityx-proposal-head" role="row">
        <span role="columnheader">Source</span>
        <span role="columnheader">Proposal</span>
        <span role="columnheader">Reported Net</span>
        <span role="columnheader">Economics</span>
        <span role="columnheader">Live Evidence</span>
        <span role="columnheader">Source Truth</span>
        <span role="columnheader">Age</span>
        <span aria-hidden="true" />
      </div>

      {filtered.length ? filtered.map((fact) => {
        const sourceTruth = truthFor(fact.source);
        const basis = fact.source === 'BASIS';
        return (
          <div className="opportunityx-proposal-item" role="rowgroup" key={`${fact.source}:${fact.proposalId}`}>
            <div className="opportunityx-proposal-row" role="row">
              <span className="opportunityx-age" role="cell">{fact.source}</span>
              <span className="opportunityx-asset" role="cell">
                <TokenIcon symbol={fact.symbol} size={28} />
                <span>
                  <strong>{fact.base}</strong>
                  <small title={fact.proposalId}>{fact.direction} · {fact.proposalId}</small>
                </span>
              </span>
              <span className="opportunityx-evidence-cell" role="cell">
                <strong>{basis ? rawFact(fact.reportedNetEdgePct, (value) => fmtBasis(value, 2)) : 'UNKNOWN'}</strong>
                <small>{basis ? 'OWNER-REPORTED · NOT A PROFIT VERDICT' : 'NOT PUBLISHED BY VOLUME'}</small>
              </span>
              <span className="opportunityx-evidence-cell" role="cell">
                <strong>{basis ? `Gross ${rawFact(fact.grossEdgePct, (value) => fmtBasis(value, 2))}` : 'UNKNOWN'}</strong>
                <small>{basis
                  ? `Total cost ${rawFact(fact.totalCostPct, (value) => fmtBasis(value, 2))}`
                  : 'Fees · slippage · funding · borrow NOT PUBLISHED'}</small>
              </span>
              <span className="opportunityx-quality" role="cell">
                <strong>{basis
                  ? `${rawFact(fact.spotPrice, fmtPrice)} / ${rawFact(fact.perpPrice, fmtPrice)}`
                  : `${multipleFact(fact.volume1sMultiple)} / ${multipleFact(fact.volume5sMultiple)}`}</strong>
                <small>{basis
                  ? `Executable legs · funding ${rawFact(fact.fundingRate, fmtFunding)}`
                  : `1s / 5s volume · depth ${rawFact(fact.topDepthUsd, fmtMoney)}`}</small>
              </span>
              <span className="opportunityx-evidence-cell" role="cell">
                <strong>{sourceTruth.label}</strong>
                <small title={sourceTruth.detail}>{sourceTruth.detail}</small>
              </span>
              <span className="opportunityx-age" role="cell">
                {finite(fact.observedAtMs) ? timeAgo(fact.observedAtMs) : 'UNKNOWN'}
              </span>
              <span aria-hidden="true" />
            </div>
            <div className="opportunityx-proposal-detail">
              <div className="opportunityx-reason">
                <span>Source Reason</span>
                <p>{fact.reason}{fact.invalidation ? ` · Invalidation: ${fact.invalidation}` : ''}</p>
              </div>
              <dl className="opportunityx-facts">
                <div><dt>Proposal ID</dt><dd title={fact.proposalId}>{fact.proposalId}</dd></div>
                <div><dt>Lifecycle</dt><dd>{fact.lifecycle}</dd></div>
                <div><dt>Confidence</dt><dd>{confidenceFact(fact.confidence)}</dd></div>
                <div><dt>{basis ? 'Gross Edge' : '1s Volume'}</dt><dd>{basis ? rawFact(fact.grossEdgePct, (value) => fmtBasis(value, 3)) : multipleFact(fact.volume1sMultiple)}</dd></div>
                <div><dt>{basis ? 'Fees' : '5s Volume'}</dt><dd>{basis ? rawFact(fact.feesPct, (value) => fmtBasis(value, 3)) : multipleFact(fact.volume5sMultiple)}</dd></div>
                <div><dt>{basis ? 'Slippage' : '5s Trades'}</dt><dd>{basis ? rawFact(fact.slippagePct, (value) => fmtBasis(value, 3)) : multipleFact(fact.tradeCountMultiple)}</dd></div>
                <div><dt>{basis ? 'Funding Drag' : 'Spread'}</dt><dd>{basis ? rawFact(fact.fundingDragPct, (value) => fmtBasis(value, 3)) : rawFact(fact.spreadBps, (value) => `${value.toFixed(2)} bps`)}</dd></div>
                <div><dt>{basis ? 'Borrow Cost' : 'Expiry'}</dt><dd>{basis ? rawFact(fact.borrowCostPct, (value) => fmtBasis(value, 3)) : finite(fact.expiresAtMs) ? countdown(fact.expiresAtMs) : 'UNKNOWN'}</dd></div>
              </dl>
            </div>
          </div>
        );
      }) : (
        <div className="opportunityx-empty">
          <Radar size={18} />
          <strong>{query
            ? 'No Published Proposal Matches Search'
            : coverageKnown
              ? currentCoverage
                ? 'No Current Published Engine Proposals'
                : 'No Retained Published Engine Proposals'
              : 'Published Proposal Coverage Unavailable'}</strong>
          <span>{query
            ? 'No owner-published proposal row matches the query.'
            : coverageKnown
              ? currentCoverage
                ? 'Both engine owners report zero proposal rows.'
                : 'The retained engine reads contain zero rows; current zero is not asserted.'
              : 'One or more engine owners has no complete, count-consistent read.'}</span>
        </div>
      )}
    </div>
  );
}

export function Opportunities() {
  const {
    markets,
    marketStatus,
    marketsLastSuccessAtMs,
    marketsUpdatedAt,
    openDetail,
  } = useStore();
  const [view, setView] = useState<View>('active');
  const [search, setSearch] = useState('');
  const [basisRead, setBasisRead] = useState<OpportunitySourceRead | null>(null);
  const [volumeRead, setVolumeRead] = useState<OpportunitySourceRead | null>(null);
  const [basisError, setBasisError] = useState<string | null>(null);
  const [volumeError, setVolumeError] = useState<string | null>(null);

  useEffect(() => {
    const basisPoll = createSettledPoll<OpportunitySourceRead>({
      intervalMs: 2_000,
      request: async (signal) => {
        const decoded = decodeBasisOpportunityRead(await fetchJson<unknown>(
          '/api/engine/basis',
          { cache: 'no-store', signal },
        ));
        if (decoded === null) throw new TypeError('Basis proposal read failed its published contract.');
        return decoded;
      },
      onSuccess: (next) => {
        setBasisRead(next);
        setBasisError(null);
      },
      onError: (reason) => setBasisError(apiErrorMessage(reason, 'Basis proposal facts unavailable')),
    });
    const volumePoll = createSettledPoll<OpportunitySourceRead>({
      intervalMs: 2_000,
      request: async (signal) => {
        const decoded = decodeVolumeOpportunityRead(await fetchJson<unknown>(
          '/api/engine/volume',
          { cache: 'no-store', signal },
        ));
        if (decoded === null) throw new TypeError('Volume proposal read failed its published contract.');
        return decoded;
      },
      onSuccess: (next) => {
        setVolumeRead(next);
        setVolumeError(null);
      },
      onError: (reason) => setVolumeError(apiErrorMessage(reason, 'Volume proposal facts unavailable')),
    });
    basisPoll.start();
    volumePoll.start();
    return () => {
      basisPoll.stop();
      volumePoll.stop();
    };
  }, []);

  const marketTruth = projectMarketConsumerTruth({
    status: marketStatus,
    lastSuccessAtMs: marketsLastSuccessAtMs,
    sourceUpdatedAtMs: marketsUpdatedAt,
    nowMs: Date.now(),
  });

  const query = search.trim().toUpperCase();
  const opportunityNow = Date.now();
  const basisTruth = projectOpportunitySourceTruth(basisRead, basisError, opportunityNow);
  const volumeTruth = projectOpportunitySourceTruth(volumeRead, volumeError, opportunityNow);
  const publishedFacts = projectPublishedOpportunityFacts(basisRead, volumeRead, opportunityNow);
  const proposalCoverageKnown = basisRead !== null
    && volumeRead !== null
    && basisRead.countConsistent
    && volumeRead.countConsistent
    && basisTruth.label === 'CURRENT'
    && volumeTruth.label === 'CURRENT';
  const publishedProposalCount = proposalCoverageKnown ? publishedFacts.length : null;
  const reportedEconomicsCount = proposalCoverageKnown
    ? publishedFacts.filter((fact) => finite(fact.reportedNetEdgePct)).length
    : null;
  const currentProposalCoverage = basisTruth.label === 'CURRENT' && volumeTruth.label === 'CURRENT';

  const rawRows = useMemo(() => {
    if (!query) return markets;
    return markets.filter((market) => (
      market.symbol.includes(query) || market.base.includes(query)
    ));
  }, [markets, query]);

  const marketEvidenceAge = marketTruth.evidenceAtMs === null
    ? 'Age unknown'
    : `Updated ${timeAgo(marketTruth.evidenceAtMs)}`;
  const updatedLabel = marketTruth.label === 'CURRENT'
    ? marketEvidenceAge
    : marketTruth.label === 'STALE LAST-KNOWN'
      ? `STALE LAST-KNOWN · ${marketEvidenceAge}`
      : marketTruth.label === 'LOADING'
        ? 'Market Feed Loading'
        : 'Market Feed Unavailable';

  return (
    <div className="container page opportunityx-page">
      <section className="opportunityx-frame">
        <header className="opportunityx-toolbar">
          <div className="opportunityx-title">
            <img className="opportunityx-page-mark" src="/opportunities-bulb.png" alt="" aria-hidden="true" />
            <h1>Opportunities</h1>
            <span className="opportunityx-live idle">
              <i aria-hidden="true" />
              Legacy Scanner Retired
            </span>
            <span className="opportunityx-updated">Basis {basisTruth.label} · Volume {volumeTruth.label}</span>
          </div>
          <label className="opportunityx-search">
            <Search size={14} aria-hidden="true" />
            <input
              aria-label="Search Opportunities"
              placeholder="Search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              spellCheck={false}
            />
            {search ? (
              <button type="button" aria-label="Clear Search" onClick={() => setSearch('')}>
                <X size={14} />
              </button>
            ) : null}
          </label>
        </header>

        <div className="opportunityx-summary" aria-label="Opportunity Summary">
          <div className="opportunityx-summary-cell">
            <span>Published Proposals</span>
            <strong>{publishedProposalCount ?? 'UNKNOWN'}</strong>
            <small>{proposalCoverageKnown
              ? `${basisRead.facts.length} Basis · ${volumeRead.facts.length} Volume${currentProposalCoverage ? '' : ' · retained/degraded'}`
              : `${publishedFacts.length} known rows · complete source coverage unavailable`}</small>
          </div>
          <div className="opportunityx-summary-cell">
            <span>Reported Net Economics</span>
            <strong>{reportedEconomicsCount === null
              ? 'UNKNOWN'
              : `${reportedEconomicsCount} / ${publishedFacts.length}`}</strong>
            <small>Owner-reported model evidence only · unknowns stay unknown</small>
          </div>
          <div className="opportunityx-summary-cell">
            <span>Canonical Projection</span>
            <strong>NOT MOUNTED</strong>
            <small>No new legacy proposals or mutations are accepted · Basis and Volume own strategy decisions · action authority NONE</small>
          </div>
          <div className="opportunityx-summary-cell">
            <span>Raw Market Rows</span>
            <strong>{marketTruth.factsAvailable ? markets.length : 'UNKNOWN'} {marketTruth.factsAvailable ? <em>{marketTruth.retained ? 'retained rows' : 'rows'}</em> : null}</strong>
            <small>{marketTruth.retained
              ? `${updatedLabel} · source order retained after refresh failure`
              : marketTruth.factsAvailable
                ? `${updatedLabel} · source order · no UI filtering, scoring, or strategy rank`
                : `${updatedLabel} · no successful market read is available`}</small>
          </div>
        </div>

        <ProductSurfaceAdapter surfaceId="opportunities" />

        <div className="opportunityx-filters">
          <div className="opportunityx-segments" role="tablist" aria-label="Opportunity Views">
            {VIEWS.map((item) => (
              <button
                type="button"
                role="tab"
                aria-selected={view === item.id}
                className={view === item.id ? 'selected' : ''}
                key={item.id}
                onClick={() => setView(item.id)}
              >
                {item.label}
                <span>{item.id === 'active'
                  ? publishedProposalCount ?? 'UNKNOWN'
                  : marketTruth.factsAvailable ? rawRows.length : 'UNKNOWN'}</span>
              </button>
            ))}
          </div>
          <span className="opportunityx-view-note">
            {view === 'active'
              ? proposalCoverageKnown
                ? `${publishedFacts.length} ${currentProposalCoverage ? 'current' : 'retained/degraded'} owner-ordered rows · canonical projection not mounted`
                : `${publishedFacts.length} known owner-ordered rows · coverage UNKNOWN`
              : marketTruth.factsAvailable
                ? `${rawRows.length} ${marketTruth.retained ? 'retained' : 'source-order'} rows`
                : 'Raw market facts unavailable'}
          </span>
        </div>

        {view === 'active' ? (
          <PublishedOpportunityFacts
            facts={publishedFacts}
            query={query}
            basisTruth={basisTruth}
            volumeTruth={volumeTruth}
            coverageKnown={proposalCoverageKnown}
          />
        ) : (
          <div className="opportunityx-table" role="table" aria-label="Raw Market Facts">
            <div className="opportunityx-radar-head" role="row">
              <span role="columnheader">Asset</span>
              <span role="columnheader">Raw Prices</span>
              <span role="columnheader">Raw Basis</span>
              <span role="columnheader">Raw Funding</span>
              <span role="columnheader">Raw 24h Volume</span>
              <span role="columnheader">Raw Spreads</span>
              <span role="columnheader">Raw Top Depth</span>
              <span role="columnheader">View</span>
            </div>
            {!marketTruth.factsAvailable ? (
              <div className="opportunityx-empty">
                <Radar size={18} />
                <strong>Raw Market Facts Unavailable</strong>
                <span>No successful market read is available. Prices, funding, changes, volumes, and depth remain unknown.</span>
              </div>
            ) : rawRows.length ? rawRows.map((market) => (
                <div className="opportunityx-radar-row" role="row" key={market.symbol}>
                  <span className="opportunityx-asset" role="cell">
                    <TokenIcon symbol={market.symbol} size={26} />
                    <span>
                      <strong>{market.base}</strong>
                      <small>{market.symbol}{marketTruth.retained ? ' · STALE LAST-KNOWN' : ''}</small>
                    </span>
                  </span>
                  <span className="opportunityx-radar-value" role="cell">
                    <strong>Spot {rawFact(market.spot, fmtPrice)}</strong>
                    <small>Perp mark {rawFact(market.perpMark, fmtPrice)}</small>
                  </span>
                  <span className="opportunityx-radar-value" role="cell">
                    <strong>Executable {rawFact(market.executableBasisBestPct, (value) => fmtBasis(value, 2))}</strong>
                    <small>{basisSideLabel(market.executableBasisSide)} · reference {rawFact(market.basisPct, (value) => fmtBasis(value, 2))}</small>
                  </span>
                  <span className="opportunityx-radar-value" role="cell">
                    <strong>{rawFact(market.fundingRate, fmtFunding)}</strong>
                    <small>Annual {rawFact(market.fundingAnnualPct, (value) => fmtPct(value, 2))}</small>
                  </span>
                  <span className="opportunityx-radar-value" role="cell">
                    <strong>Spot {rawFact(market.quoteVolume24h, fmtMoney)}</strong>
                    <small>Perp {rawFact(market.perpVolume24h, fmtMoney)}</small>
                  </span>
                  <span className="opportunityx-radar-value" role="cell">
                    <strong>Spot {rawFact(market.spotSpreadPct, (value) => fmtPct(value, 3, false))}</strong>
                    <small>Perp {rawFact(market.perpSpreadPct, (value) => fmtPct(value, 3, false))}</small>
                  </span>
                  <span className="opportunityx-radar-value" role="cell">
                    <strong>Spot {rawFact(market.spotTopQuoteUsd, fmtMoney)}</strong>
                    <small>Perp {rawFact(market.perpTopQuoteUsd, fmtMoney)}</small>
                  </span>
                  <span className="opportunityx-radar-actions" role="cell">
                    <button type="button" className="opportunityx-icon-button" aria-label={'Open ' + market.symbol} onClick={() => openDetail(market.symbol)}>
                      <Eye size={14} />
                    </button>
                  </span>
                </div>
              )) : (
              <div className="opportunityx-empty">
                <Radar size={18} />
                <strong>No Raw Market Facts Match Search</strong>
                <span>No source row matches the symbol query. No fallback value or strategy row is fabricated.</span>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

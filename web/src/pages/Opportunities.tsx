import { useMemo, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  Eye,
  Radar,
  Search,
  Shield,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { TokenIcon } from '../components/TokenIcon';
import { baseOf, fmtBasis, fmtFunding, fmtMoney, fmtPct, fmtPrice, timeAgo } from '../format';
import { useStore } from '../store';
import type { MarketRow, Proposal } from '../types';
import './Opportunities.css';

type View = 'active' | 'basis' | 'funding' | 'volume';

const SIDE_LABEL: Record<Proposal['side'], string> = {
  SHORT_PERP_LONG_SPOT: 'Long Spot / Short Perp',
  LONG_PERP_SHORT_SPOT: 'Short Spot / Long Perp',
};

const SIDE_SHORT: Record<Proposal['side'], string> = {
  SHORT_PERP_LONG_SPOT: 'Carry',
  LONG_PERP_SHORT_SPOT: 'Reverse Basis',
};

const VIEWS: { id: View; label: string }[] = [
  { id: 'active', label: 'Proposals' },
  { id: 'basis', label: 'Basis' },
  { id: 'funding', label: 'Funding' },
  { id: 'volume', label: 'Liquidity' },
];

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function absolute(value: number | null | undefined): number {
  return finite(value) ? Math.abs(value) : 0;
}

function sideForBasis(value: number | null | undefined): Proposal['side'] {
  return (value ?? 0) >= 0 ? 'SHORT_PERP_LONG_SPOT' : 'LONG_PERP_SHORT_SPOT';
}

function netAfterFees(market: MarketRow, feesPct: number): number | null {
  if (!finite(market.basisPct)) return null;
  return absolute(market.basisPct) - feesPct;
}

function cleanReason(reason: string): string {
  return reason
    .replace(/\|basis\|/gi, 'basis')
    .replace(/24h spot vol/gi, '24h spot volume')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanBorrow(value: string): string {
  return value
    .replace(/availability NOT checked in v0/gi, 'availability unknown')
    .replace(/\s*—\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
}

function maxSpread(market: MarketRow | undefined): number | null {
  const values = [market?.spotSpreadPct, market?.perpSpreadPct].filter(finite);
  return values.length ? Math.max(...values) : null;
}

function topDepth(market: MarketRow | undefined): number | null {
  const values = [market?.spotTopQuoteUsd, market?.perpTopQuoteUsd].filter(finite);
  return values.length ? Math.min(...values) : null;
}

function marketQuality(market: MarketRow | undefined): string {
  const spread = maxSpread(market);
  const depth = topDepth(market);
  if (spread === null && depth === null) return 'Not Exposed';
  const parts: string[] = [];
  if (spread !== null) parts.push(fmtPct(spread, 3, false) + ' Max Spread');
  if (depth !== null) parts.push(fmtMoney(depth) + ' Top Depth');
  return parts.join(' · ');
}

function borrowStatus(proposal: Proposal): string {
  if (proposal.side === 'SHORT_PERP_LONG_SPOT') return 'Not Required';
  return cleanBorrow(proposal.borrow || 'Required · availability unknown');
}

export function Opportunities() {
  const {
    state,
    markets,
    marketsUpdatedAt,
    openDetail,
    openLedger,
    toggleWatch,
    setPage,
  } = useStore();
  const [view, setView] = useState<View>('active');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [pendingDismiss, setPendingDismiss] = useState<number | null>(null);

  const watchlist = state?.config.watchlist ?? [];
  const threshold = state?.scanner.grossThresholdPct ?? 0;
  const proposals = state?.proposals ?? [];
  const query = search.trim().toUpperCase();

  const marketBySymbol = useMemo(
    () => new Map(markets.map((market) => [market.symbol, market])),
    [markets],
  );

  const liquidPerpRows = useMemo(() => markets.filter((market) => (
    market.hasPerp && (market.quoteVolume24h ?? 0) >= (state?.config.minQuoteVolume24h ?? 0)
  )), [markets, state?.config.minQuoteVolume24h]);

  const basisRows = useMemo(() => [...liquidPerpRows]
    .filter((market) => finite(market.basisPct))
    .sort((left, right) => absolute(right.basisPct) - absolute(left.basisPct))
    .slice(0, 18), [liquidPerpRows]);

  const fundingRows = useMemo(() => [...liquidPerpRows]
    .filter((market) => finite(market.fundingRate))
    .sort((left, right) => absolute(right.fundingRate) - absolute(left.fundingRate))
    .slice(0, 18), [liquidPerpRows]);

  const volumeRows = useMemo(() => [...markets]
    .filter((market) => (market.quoteVolume24h ?? 0) > 0)
    .sort((left, right) => (right.quoteVolume24h ?? 0) - (left.quoteVolume24h ?? 0))
    .slice(0, 18), [markets]);

  const filteredProposals = useMemo(() => {
    const rows = [...proposals].sort((left, right) => right.netEdgePct - left.netEdgePct);
    if (!query) return rows;
    return rows.filter((proposal) => (
      proposal.symbol.includes(query)
      || baseOf(proposal.symbol).includes(query)
      || cleanReason(proposal.reason).toUpperCase().includes(query)
    ));
  }, [proposals, query]);

  const radarRows = useMemo(() => {
    const source = view === 'funding' ? fundingRows : view === 'volume' ? volumeRows : basisRows;
    if (!query) return source;
    return source.filter((market) => (
      market.symbol.includes(query) || market.base.includes(query)
    ));
  }, [basisRows, fundingRows, query, view, volumeRows]);

  const bestProposal = [...proposals].sort((left, right) => right.netEdgePct - left.netEdgePct)[0] ?? null;
  const updatedLabel = marketsUpdatedAt ? timeAgo(marketsUpdatedAt) : 'Waiting';

  const viewCount = (target: View): number => {
    if (target === 'active') return proposals.length;
    if (target === 'basis') return basisRows.length;
    if (target === 'funding') return fundingRows.length;
    return volumeRows.length;
  };

  const reject = async (id: number) => {
    const response = await fetch('/api/proposals/' + String(id) + '/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => null);
    setPendingDismiss(null);
    if (response?.ok && expandedId === id) setExpandedId(null);
  };

  const openProposal = (id: number) => {
    setPendingDismiss(null);
    setExpandedId(expandedId === id ? null : id);
  };

  if (!state) {
    return (
      <div className="container page opportunityx-page">
        <section className="opportunityx-frame">
          <header className="opportunityx-toolbar">
            <div className="opportunityx-title">
              <img className="opportunityx-page-mark" src="/opportunities-bulb.png" alt="" aria-hidden="true" />
              <h1>Opportunities</h1>
              <span className="opportunityx-live idle"><i aria-hidden="true" />Connecting</span>
            </div>
          </header>
          <div className="opportunityx-empty">
            <Radar size={18} />
            Waiting for the proposal queue.
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="container page opportunityx-page">
      <section className="opportunityx-frame">
        <header className="opportunityx-toolbar">
          <div className="opportunityx-title">
            <img className="opportunityx-page-mark" src="/opportunities-bulb.png" alt="" aria-hidden="true" />
            <h1>Opportunities</h1>
            <span className={'opportunityx-live ' + (proposals.length ? 'active' : 'idle')}>
              <i aria-hidden="true" />
              {proposals.length ? String(proposals.length) + ' Active' : 'Queue Clear'}
            </span>
            <span className="opportunityx-updated">Updated {updatedLabel}</span>
          </div>
          <label className="opportunityx-search">
            <Search size={14} aria-hidden="true" />
            <input
              aria-label="Search Opportunities"
              placeholder="Search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setExpandedId(null);
                setPendingDismiss(null);
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

        <div className="opportunityx-summary" aria-label="Opportunity Summary">
          <div className="opportunityx-summary-cell">
            <span>Active Proposals</span>
            <strong>{proposals.length}</strong>
            <small>Current engine proposal queue</small>
          </div>
          <div className="opportunityx-summary-cell">
            <span>Best Net Edge</span>
            <strong className={bestProposal && bestProposal.netEdgePct > 0 ? 'positive' : ''}>
              {bestProposal ? fmtPct(bestProposal.netEdgePct, 2) : '—'}
            </strong>
            <small>{bestProposal ? bestProposal.symbol + ' after ' + fmtPct(bestProposal.feesPct, 2, false) + ' fees' : 'No active proposal'}</small>
          </div>
          <div className="opportunityx-summary-cell">
            <span>Scanner Gate</span>
            <strong>{fmtPct(threshold, 2, false)}</strong>
            <small>{state.config.persistTicks} persistent ticks required</small>
          </div>
          <div className="opportunityx-summary-cell">
            <span>Coverage</span>
            <strong>{state.scanner.pairs} <em>pairs</em></strong>
            <small>{state.scanner.watching} watching · scanner {timeAgo(state.scanner.lastTickTs)}</small>
          </div>
        </div>

        <div className="opportunityx-filters">
          <div className="opportunityx-segments" role="tablist" aria-label="Opportunity Views">
            {VIEWS.map((item) => (
              <button
                type="button"
                role="tab"
                aria-selected={view === item.id}
                className={view === item.id ? 'selected' : ''}
                key={item.id}
                onClick={() => {
                  setView(item.id);
                  setExpandedId(null);
                  setPendingDismiss(null);
                }}
              >
                {item.label}
                <span>{viewCount(item.id)}</span>
              </button>
            ))}
          </div>
          <span className="opportunityx-view-note">
            {view === 'active'
              ? String(filteredProposals.length) + ' proposal' + (filteredProposals.length === 1 ? '' : 's')
              : String(radarRows.length) + ' market-context rows'}
          </span>
        </div>

        {view === 'active' ? (
          <div className="opportunityx-table" role="table" aria-label="Active Proposals">
            <div className="opportunityx-proposal-head" role="row">
              <span role="columnheader">State</span>
              <span role="columnheader">Proposal</span>
              <span role="columnheader">Net Edge</span>
              <span role="columnheader">Evidence</span>
              <span role="columnheader">Market Quality</span>
              <span role="columnheader">Borrow</span>
              <span role="columnheader">Age</span>
              <span aria-hidden="true" />
            </div>

            {filteredProposals.length ? filteredProposals.map((proposal) => {
              const market = marketBySymbol.get(proposal.symbol);
              const isExpanded = expandedId === proposal.id;
              const watching = watchlist.includes(proposal.symbol);
              const requiresBorrow = proposal.side === 'LONG_PERP_SHORT_SPOT';
              return (
                <div className="opportunityx-proposal-item" role="rowgroup" key={proposal.id}>
                  <button
                    type="button"
                    className="opportunityx-proposal-row"
                    aria-expanded={isExpanded}
                    onClick={() => openProposal(proposal.id)}
                  >
                    <span className="opportunityx-state" role="cell">
                      <i aria-hidden="true" />
                      Proposal
                    </span>
                    <span className="opportunityx-asset" role="cell">
                      <TokenIcon symbol={proposal.symbol} size={28} />
                      <span>
                        <strong>{baseOf(proposal.symbol)}</strong>
                        <small>{SIDE_LABEL[proposal.side]}</small>
                      </span>
                    </span>
                    <span className="opportunityx-edge" role="cell">
                      <strong>{fmtPct(proposal.netEdgePct, 2)}</strong>
                      <small>{fmtPct(proposal.feesPct, 2, false)} fees</small>
                    </span>
                    <span className="opportunityx-evidence-cell" role="cell">
                      <strong>{fmtBasis(proposal.basisNow, 2)} <em>/ {fmtBasis(proposal.basisPeak, 2)} peak</em></strong>
                      <small>{fmtFunding(proposal.fundingRate)} funding</small>
                    </span>
                    <span className="opportunityx-quality" role="cell">
                      <strong>{fmtMoney(proposal.quoteVolume24h)} volume</strong>
                      <small>{marketQuality(market)}</small>
                    </span>
                    <span className={'opportunityx-borrow ' + (requiresBorrow ? 'warning' : 'clear')} role="cell">
                      <strong>{requiresBorrow ? 'Required' : 'Not Required'}</strong>
                      <small>{requiresBorrow ? 'Availability Unknown' : 'Carry Setup'}</small>
                    </span>
                    <span className="opportunityx-age" role="cell">{timeAgo(proposal.openedTs)}</span>
                    <ChevronDown className={isExpanded ? 'expanded' : ''} size={15} aria-hidden="true" />
                  </button>

                  {isExpanded ? (
                    <div className="opportunityx-proposal-detail">
                      <div className="opportunityx-reason">
                        <span>Engine Reason</span>
                        <p>{cleanReason(proposal.reason)}</p>
                        {requiresBorrow ? <p className="warning">{cleanBorrow(proposal.borrow)}</p> : null}
                      </div>
                      <dl className="opportunityx-facts">
                        <div><dt>Strategy</dt><dd>Basis Scanner</dd></div>
                        <div><dt>Setup</dt><dd>{SIDE_SHORT[proposal.side]}</dd></div>
                        <div><dt>Spot</dt><dd>{fmtPrice(proposal.spotPrice)}</dd></div>
                        <div><dt>Perp Mark</dt><dd>{fmtPrice(proposal.perpMark)}</dd></div>
                        <div><dt>Confidence</dt><dd>{Math.round(proposal.confidence * 100)}%</dd></div>
                        <div><dt>Top Depth</dt><dd>{fmtMoney(topDepth(market))}</dd></div>
                        <div><dt>Risk Decision</dt><dd>Not Evaluated</dd></div>
                        <div><dt>Suggested Size</dt><dd>Not Provided</dd></div>
                      </dl>
                      <div className="opportunityx-actions">
                        <button type="button" className="opportunityx-button" onClick={() => openDetail(proposal.symbol)}>
                          <Eye size={14} />
                          Open Market
                        </button>
                        <button
                          type="button"
                          className={'opportunityx-button' + (watching ? ' active' : '')}
                          onClick={() => void toggleWatch(proposal.symbol)}
                        >
                          <Star size={14} fill={watching ? 'currentColor' : 'none'} />
                          {watching ? 'Watching' : 'Watch'}
                        </button>
                        <button type="button" className="opportunityx-button" onClick={() => openLedger(proposal.symbol)}>
                          <BookOpen size={14} />
                          Open Logs
                        </button>
                        <button type="button" className="opportunityx-button" onClick={() => setPage('risk')}>
                          <Shield size={14} />
                          Open Risk
                        </button>
                        <button
                          type="button"
                          className={'opportunityx-button danger' + (pendingDismiss === proposal.id ? ' confirm' : '')}
                          onClick={() => {
                            if (pendingDismiss === proposal.id) void reject(proposal.id);
                            else setPendingDismiss(proposal.id);
                          }}
                        >
                          <Trash2 size={14} />
                          {pendingDismiss === proposal.id ? 'Confirm Dismiss' : 'Dismiss'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            }) : (
              <div className="opportunityx-empty">
                <Radar size={18} />
                <strong>{query ? 'No Proposal Matches Search' : 'No Active Proposals'}</strong>
                <span>The queue opens only after the scanner threshold and persistence checks pass.</span>
              </div>
            )}
          </div>
        ) : (
          <div className="opportunityx-table" role="table" aria-label="Opportunity Market Context">
            <div className="opportunityx-radar-head" role="row">
              <span role="columnheader">Asset</span>
              <span role="columnheader">Direction</span>
              <span role="columnheader">Basis</span>
              <span role="columnheader">Funding</span>
              <span role="columnheader">Net After Fees</span>
              <span role="columnheader">24h Volume</span>
              <span role="columnheader">Spread / Depth</span>
              <span aria-hidden="true" />
            </div>
            {radarRows.length ? radarRows.map((market) => {
              const side = sideForBasis(market.basisPct);
              const net = netAfterFees(market, state.config.feesPct);
              const watching = watchlist.includes(market.symbol);
              return (
                <div className="opportunityx-radar-row" role="row" key={view + '-' + market.symbol}>
                  <span className="opportunityx-asset" role="cell">
                    <TokenIcon symbol={market.symbol} size={26} />
                    <span>
                      <strong>{market.base}</strong>
                      <small>{market.symbol}</small>
                    </span>
                  </span>
                  <span className="opportunityx-radar-value" role="cell">
                    <strong>{SIDE_SHORT[side]}</strong>
                    <small>{SIDE_LABEL[side]}</small>
                  </span>
                  <span className="opportunityx-radar-number" role="cell">{fmtBasis(market.basisPct, 2)}</span>
                  <span className="opportunityx-radar-number" role="cell">{fmtFunding(market.fundingRate)}</span>
                  <span className={'opportunityx-radar-number ' + (net !== null && net > 0 ? 'positive' : '')} role="cell">
                    {net === null ? '—' : fmtPct(net, 2)}
                  </span>
                  <span className="opportunityx-radar-number" role="cell">{fmtMoney(market.quoteVolume24h)}</span>
                  <span className="opportunityx-radar-quality" role="cell">{marketQuality(market)}</span>
                  <span className="opportunityx-radar-actions" role="cell">
                    <button type="button" className="opportunityx-icon-button" aria-label={'Open ' + market.symbol} onClick={() => openDetail(market.symbol)}>
                      <Eye size={14} />
                    </button>
                    <button
                      type="button"
                      className={'opportunityx-icon-button' + (watching ? ' active' : '')}
                      aria-label={(watching ? 'Unwatch ' : 'Watch ') + market.symbol}
                      onClick={() => void toggleWatch(market.symbol)}
                    >
                      <Star size={14} fill={watching ? 'currentColor' : 'none'} />
                    </button>
                  </span>
                </div>
              );
            }) : (
              <div className="opportunityx-empty">
                <Radar size={18} />
                <strong>No Market Context Matches Search</strong>
                <span>The market feed is live, but this view has no matching rows.</span>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

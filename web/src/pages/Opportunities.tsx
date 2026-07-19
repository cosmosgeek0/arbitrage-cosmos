import { useMemo, useState } from 'react';
import {
  Eye,
  Radar,
  Search,
  X,
} from 'lucide-react';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import { projectMarketConsumerTruth } from '../components/Header';
import { TokenIcon } from '../components/TokenIcon';
import { fmtBasis, fmtFunding, fmtMoney, fmtPct, fmtPrice, timeAgo } from '../format';
import { useStore } from '../store';
import './Opportunities.css';

type View = 'active' | 'raw';

const VIEWS: { id: View; label: string }[] = [
  { id: 'active', label: 'Canonical Projection' },
  { id: 'raw', label: 'Raw Market Facts' },
];

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function rawFact(value: number | null | undefined, format: (known: number) => string): string {
  return finite(value) ? format(value) : 'UNKNOWN';
}

export function Opportunities() {
  const {
    state,
    markets,
    marketStatus,
    marketsLastSuccessAtMs,
    marketsUpdatedAt,
    openDetail,
  } = useStore();
  const [view, setView] = useState<View>('active');
  const [search, setSearch] = useState('');

  const marketTruth = projectMarketConsumerTruth({
    status: marketStatus,
    lastSuccessAtMs: marketsLastSuccessAtMs,
    sourceUpdatedAtMs: marketsUpdatedAt,
    nowMs: Date.now(),
  });

  const query = search.trim().toUpperCase();

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
            Waiting for canonical opportunity truth.
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
            <span className="opportunityx-live idle">
              <i aria-hidden="true" />
              Legacy Scanner Retired
            </span>
            <span className="opportunityx-updated">{updatedLabel}</span>
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
            <span>Legacy Scanner</span>
            <strong>{state.scanner.state}</strong>
            <small>No runtime construction, ticks, scoring, or proposal intake</small>
          </div>
          <div className="opportunityx-summary-cell">
            <span>Canonical Opportunity Projection</span>
            <strong>UNKNOWN</strong>
            <small>No Foundation opportunity projection is consumed by this page</small>
          </div>
          <div className="opportunityx-summary-cell">
            <span>Strategy Authority</span>
            <strong>Basis + Volume</strong>
            <small>Canonical engines own score, lifecycle, and decisions</small>
          </div>
          <div className="opportunityx-summary-cell">
            <span>Raw Market Rows</span>
            <strong>{marketTruth.factsAvailable ? markets.length : 'UNKNOWN'} {marketTruth.factsAvailable ? <em>{marketTruth.retained ? 'retained rows' : 'rows'}</em> : null}</strong>
            <small>{marketTruth.retained ? 'STALE LAST-KNOWN · source order retained after refresh failure' : marketTruth.factsAvailable ? 'Source order · no UI filtering, scoring, or strategy rank' : 'No successful market read is available'}</small>
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
                <span>{item.id === 'active' ? 'UNKNOWN' : marketTruth.factsAvailable ? rawRows.length : 'UNKNOWN'}</span>
              </button>
            ))}
          </div>
          <span className="opportunityx-view-note">
            {view === 'active'
              ? 'Canonical Foundation projection not mounted'
              : marketTruth.factsAvailable
                ? `${rawRows.length} ${marketTruth.retained ? 'retained' : 'source-order'} rows`
                : 'Raw market facts unavailable'}
          </span>
        </div>

        {view === 'active' ? (
          <div className="opportunityx-table" role="region" aria-label="Canonical Opportunity Projection State">
            <div className="opportunityx-empty">
              <Radar size={18} />
              <strong>Canonical Opportunity Projection Unknown</strong>
              <span>No Foundation projection is mounted. No new legacy proposals or mutations are accepted. Basis and Volume own strategy decisions.</span>
            </div>
          </div>
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
                  <span className="opportunityx-radar-number" role="cell">
                    {rawFact(market.basisPct, (value) => fmtBasis(value, 2))}
                  </span>
                  <span className="opportunityx-radar-number" role="cell">{rawFact(market.fundingRate, fmtFunding)}</span>
                  <span className="opportunityx-radar-number" role="cell">{rawFact(market.quoteVolume24h, fmtMoney)}</span>
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

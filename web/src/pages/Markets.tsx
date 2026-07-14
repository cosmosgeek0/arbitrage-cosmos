import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { TokenIcon, brandColor } from '../components/TokenIcon';
import { Num } from '../components/Num';
import { EmptyState } from '../components/ui';
import { IconSearch } from '../components/Icons';
import { fmtPrice, fmtPct, fmtBasis, fmtMoney, fmtFunding, signClass } from '../format';
import { primeIcons } from '../lib/iconManifest';
import { tokenName } from '../lib/tokenNames';
import { PillSelect, pageList, Star } from '../components/PillSelect';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import type { MarketRow } from '../types';
import './Markets.css';

type View = 'overview' | 'derivatives' | 'basis' | 'liquidity';
type Filter = 'all' | 'watchlist' | 'paired' | 'books' | 'spotOnly' | 'movers';
type SortKey =
  | 'base'
  | 'spot'
  | 'change24hPct'
  | 'quoteVolume24h'
  | 'openInterestUsd'
  | 'openInterestChangePct'
  | 'fundingRate'
  | 'liquidations15mUsd'
  | 'perpVolume24h'
  | 'executableBasisBestPct'
  | 'executableBasisLongSpotPct'
  | 'executableBasisShortSpotPct'
  | 'spotSpreadPct'
  | 'perpSpreadPct'
  | 'depth'
  | 'perpChange24hPct'
  | 'sparkGrowth';

const VIEW_STORAGE = 'cosmos-market-view-v2';

const VIEWS: { id: View; label: string; sort: SortKey }[] = [
  { id: 'overview', label: 'Overview', sort: 'quoteVolume24h' },
  { id: 'derivatives', label: 'Derivatives', sort: 'openInterestUsd' },
  { id: 'basis', label: 'Basis', sort: 'executableBasisBestPct' },
  { id: 'liquidity', label: 'Liquidity', sort: 'depth' },
];

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All Markets' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'paired', label: 'Spot + Perp' },
  { id: 'books', label: 'Executable Books' },
  { id: 'spotOnly', label: 'Spot Only' },
  { id: 'movers', label: 'Liquid Movers' },
];

function readMarketView(): View {
  if (typeof window === 'undefined') return 'overview';
  try {
    const saved = window.localStorage.getItem(VIEW_STORAGE) as View | null;
    if (saved && VIEWS.some((item) => item.id === saved)) return saved;
  } catch {
    // Local persistence is optional. The native Overview remains the fallback.
  }
  return 'overview';
}

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

function fmtLiveAge(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 1500) return 'Now';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  return `${Math.max(1, Math.round(ms / 3_600_000))}h`;
}

function depthUsd(row: MarketRow): number | null {
  if (row.hasPerp && finite(row.spotTopQuoteUsd) && finite(row.perpTopQuoteUsd)) {
    return Math.min(row.spotTopQuoteUsd, row.perpTopQuoteUsd);
  }
  return row.spotTopQuoteUsd ?? null;
}

function hasExecutableBooks(row: MarketRow): boolean {
  return row.hasSpot
    && row.hasPerp
    && finite(row.spotBid)
    && finite(row.spotAsk)
    && finite(row.perpBid)
    && finite(row.perpAsk);
}

function fmtBps(value: number | null | undefined): string {
  if (!finite(value)) return '—';
  const bps = value * 100;
  const abs = Math.abs(bps);
  return `${bps.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2)} bps`;
}

function sortValue(row: MarketRow, key: SortKey): number | string {
  switch (key) {
    case 'base': return row.base;
    case 'spot': return row.spot ?? Number.NaN;
    case 'change24hPct': return row.change24hPct ?? Number.NaN;
    case 'quoteVolume24h': return row.quoteVolume24h ?? Number.NaN;
    case 'openInterestUsd': return row.openInterestUsd ?? Number.NaN;
    case 'openInterestChangePct': return row.openInterestChangePct ?? Number.NaN;
    case 'fundingRate': return row.fundingRate ?? Number.NaN;
    case 'liquidations15mUsd': return row.liquidations15mUsd ?? Number.NaN;
    case 'perpVolume24h': return row.perpVolume24h ?? Number.NaN;
    case 'executableBasisBestPct': return row.executableBasisBestPct ?? Number.NaN;
    case 'executableBasisLongSpotPct': return row.executableBasisLongSpotPct ?? Number.NaN;
    case 'executableBasisShortSpotPct': return row.executableBasisShortSpotPct ?? Number.NaN;
    case 'spotSpreadPct': return row.spotSpreadPct ?? Number.NaN;
    case 'perpSpreadPct': return row.perpSpreadPct ?? Number.NaN;
    case 'depth': return depthUsd(row) ?? Number.NaN;
    case 'perpChange24hPct': return row.perpChange24hPct ?? Number.NaN;
    case 'sparkGrowth': {
      const spark = row.spark;
      if (!spark || spark.length < 2 || !Number.isFinite(spark[0]) || spark[0] === 0) return Number.NaN;
      return ((spark[spark.length - 1] - spark[0]) / Math.abs(spark[0])) * 100;
    }
  }
}

function DiagArrow({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden style={{ transform: up ? 'none' : 'rotate(180deg)' }}>
      <path d="M3.5 8.5L8.5 3.5M4.6 3.5h3.9v3.9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SortGlyph({ dir }: { dir: 'asc' | 'desc' | null }) {
  return (
    <svg viewBox="0 0 10 14" width="9" height="13" aria-hidden className="mkx-sortglyph">
      <path d="M5 1.5L8 5H2z" fill="currentColor" opacity={dir === 'asc' ? 1 : 0.3} />
      <path d="M5 12.5L2 9h6z" fill="currentColor" opacity={dir === 'desc' ? 1 : 0.3} />
    </svg>
  );
}

function smoothPath(values: number[], width: number, height: number, count = 26): string {
  let sampled = values;
  if (sampled.length > count) {
    const step = (sampled.length - 1) / (count - 1);
    sampled = Array.from({ length: count }, (_, index) => sampled[Math.round(index * step)]);
  }
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const span = max - min || 1;
  const points: [number, number][] = sampled.map((value, index) => [
    (index / (sampled.length - 1)) * width,
    height - 3 - ((value - min) / span) * (height - 6),
  ]);
  let path = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    path += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return path;
}

function RowSpark({ values, color }: { values: number[] | null | undefined; color: string }) {
  if (!values || values.length < 2) return <span className="mkx-spark-empty">Warming</span>;
  const width = 118;
  const height = 34;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const flat = mean !== 0 && (max - min) / Math.abs(mean) < 0.001;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="mkx-rowspark" aria-label="Native market trend">
      {flat ? (
        <line x1="2" y1={height / 2} x2={width - 2} y2={height / 2} stroke={color} strokeWidth="1.6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ) : (
        <path d={smoothPath(values, width, height)} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

function ChangeCell({ value }: { value: number | null | undefined }) {
  const [flash, setFlash] = useState<null | 'up' | 'down'>(null);
  const previous = useRef<number | null>(null);
  useEffect(() => {
    const old = previous.current;
    previous.current = finite(value) ? value : null;
    if (old === null || !finite(value) || value === old) return;
    setFlash(value > old ? 'up' : 'down');
    const timer = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(timer);
  }, [value]);

  const flat = !finite(value) || Math.abs(value ?? 0) < 0.005;
  const showArrow = flash !== null || !flat;
  const arrowUp = flash ? flash === 'up' : (value ?? 0) > 0;
  const className = flash ? (flash === 'up' ? 'pos' : 'neg') : flat ? '' : signClass(value);
  return (
    <td className={`r mkx-change ${className}`}>
      {finite(value) ? (
        <span>{showArrow && <DiagArrow up={arrowUp} />}{fmtPct(Math.abs(value), 2, false)}</span>
      ) : '—'}
    </td>
  );
}

export function Markets() {
  const { markets, marketsUpdatedAt, marketsError, connected, state, prefs, openDetail, toggleWatch } = useStore();
  const initialView = readMarketView();
  const [view, setView] = useState<View>(initialView);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>(VIEWS.find((item) => item.id === initialView)?.sort ?? 'quoteVolume24h');
  const [sortDesc, setSortDesc] = useState(true);
  const [pageN, setPageN] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [now, setNow] = useState(() => Date.now());

  const watchlist = state?.config.watchlist ?? [];
  const feesPct = state?.config.feesPct ?? 0;
  const iconBases = useMemo(() => [...new Set(markets.map((market) => market.base))], [markets]);

  useEffect(() => { primeIcons(iconBases); }, [iconBases]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(VIEW_STORAGE, view); } catch { /* Optional preference. */ }
  }, [view]);

  const withChange = markets.filter((market) => finite(market.change24hPct));
  const gainers = withChange.filter((market) => (market.change24hPct ?? 0) > 0).length;
  const losers = withChange.filter((market) => (market.change24hPct ?? 0) < 0).length;
  const pairedCount = markets.filter((market) => market.hasSpot && market.hasPerp).length;
  const executableCount = markets.filter(hasExecutableBooks).length;
  const totalVolume = markets.reduce((sum, market) => sum + (market.quoteVolume24h ?? 0), 0);
  const byVolume = useMemo(
    () => [...markets].filter((market) => (market.quoteVolume24h ?? 0) > 0).sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0)),
    [markets],
  );
  const top50 = byVolume.slice(0, 50);
  const top50Weight = top50.reduce((sum, market) => sum + (market.quoteVolume24h ?? 0), 0);
  const top50Pulse = top50Weight > 0
    ? top50.reduce((sum, market) => sum + (market.change24hPct ?? 0) * (market.quoteVolume24h ?? 0), 0) / top50Weight
    : null;
  const marketAgeMs = marketsUpdatedAt ? now - marketsUpdatedAt : null;
  const live = connected && !marketsError && marketAgeMs !== null && marketAgeMs < Math.max(12_000, prefs.refreshSec * 2500);

  const rows = useMemo(() => {
    let filtered = markets;
    if (search.trim()) {
      const query = search.trim().toUpperCase();
      filtered = filtered.filter((market) => market.base.includes(query) || market.symbol.includes(query) || tokenName(market.base).toUpperCase().includes(query));
    }
    switch (filter) {
      case 'watchlist': filtered = filtered.filter((market) => watchlist.includes(market.symbol)); break;
      case 'paired': filtered = filtered.filter((market) => market.hasSpot && market.hasPerp); break;
      case 'books': filtered = filtered.filter(hasExecutableBooks); break;
      case 'spotOnly': filtered = filtered.filter((market) => market.hasSpot && !market.hasPerp); break;
      case 'movers': filtered = filtered.filter((market) => finite(market.change24hPct) && Math.abs(market.change24hPct) >= 2 && (market.quoteVolume24h ?? 0) >= 1_000_000); break;
      case 'all': break;
    }
    const direction = sortDesc ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const aValue = sortValue(a, sortKey);
      const bValue = sortValue(b, sortKey);
      if (typeof aValue === 'string' || typeof bValue === 'string') return String(aValue).localeCompare(String(bValue)) * direction;
      const aFinite = Number.isFinite(aValue);
      const bFinite = Number.isFinite(bValue);
      if (!aFinite && !bFinite) return a.base.localeCompare(b.base);
      if (!aFinite) return 1;
      if (!bFinite) return -1;
      return (aValue - bValue) * direction;
    });
  }, [markets, search, filter, watchlist, sortDesc, sortKey]);

  useEffect(() => setPageN(0), [filter, search, sortKey, sortDesc, pageSize, view]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(pageN, pages - 1);
  const visible = rows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const visibleStart = rows.length ? safePage * pageSize + 1 : 0;
  const visibleEnd = safePage * pageSize + visible.length;

  const applyView = (next: View) => {
    const preset = VIEWS.find((item) => item.id === next);
    setView(next);
    if (preset) {
      setSortKey(preset.sort);
      setSortDesc(true);
    }
  };

  const tableHead = (label: string, key: SortKey | null, align: 'l' | 'r' = 'r', className = '') => {
    if (!key) return <th className={`${align} ${className}`}>{label}</th>;
    const active = sortKey === key;
    return (
      <th className={`${align} ${className} ${active ? 'sorted' : ''}`} aria-sort={active ? (sortDesc ? 'descending' : 'ascending') : 'none'}>
        <button
          type="button"
          className="mkx-th"
          onClick={() => {
            if (active) setSortDesc(!sortDesc);
            else {
              setSortKey(key);
              setSortDesc(key !== 'base');
            }
          }}
        >
          {label}<SortGlyph dir={active ? (sortDesc ? 'desc' : 'asc') : null} />
        </button>
      </th>
    );
  };

  const renderViewHead = () => {
    if (view === 'derivatives') return <>{tableHead('Perp Mark', 'perpChange24hPct')}{tableHead('Funding', 'fundingRate')}{tableHead('Open Interest', 'openInterestUsd')}{tableHead('OI Change', 'openInterestChangePct')}{tableHead('Liq 15m', 'liquidations15mUsd')}{tableHead('Perp Volume', 'perpVolume24h')}</>;
    if (view === 'basis') return <>{tableHead('Best Executable', 'executableBasisBestPct')}{tableHead('Long Spot', 'executableBasisLongSpotPct')}{tableHead('Short Spot', 'executableBasisShortSpotPct')}{tableHead('Net After Fees', 'executableBasisBestPct')}{tableHead('Funding', 'fundingRate')}{tableHead('Direction', null, 'l', 'mkx-direction-col')}</>;
    if (view === 'liquidity') return <>{tableHead('Spot Spread', 'spotSpreadPct')}{tableHead('Perp Spread', 'perpSpreadPct')}{tableHead('Top Depth', 'depth')}{tableHead('Volume', 'quoteVolume24h')}{tableHead('24h Range', null)}{tableHead('Change', 'change24hPct')}</>;
    return <>{tableHead('Market Price', 'spot')}{tableHead('Native Chart', 'sparkGrowth', 'r', 'mkx-chart-col')}{tableHead('Change', 'change24hPct')}{tableHead('Volume', 'quoteVolume24h')}{tableHead('Open Interest', 'openInterestUsd')}{tableHead('Funding', 'fundingRate')}</>;
  };

  const renderViewCells = (market: MarketRow) => {
    if (view === 'derivatives') return <><td className="r mkx-num"><Num value={market.perpMark}>{fmtPrice(market.perpMark)}</Num></td><td className={`r mkx-num ${signClass(market.fundingRate)}`}><Num value={market.fundingRate}>{fmtFunding(market.fundingRate)}</Num></td><td className="r mkx-num"><Num value={market.openInterestUsd}>{fmtMoney(market.openInterestUsd)}</Num></td><ChangeCell value={market.openInterestChangePct} /><td className="r mkx-num"><Num value={market.liquidations15mUsd}>{fmtMoney(market.liquidations15mUsd)}</Num></td><td className="r mkx-num"><Num value={market.perpVolume24h}>{fmtMoney(market.perpVolume24h)}</Num></td></>;
    if (view === 'basis') {
      const net = finite(market.executableBasisBestPct) ? market.executableBasisBestPct - feesPct : null;
      return <><td className={`r mkx-num ${signClass(market.executableBasisBestPct)}`}><Num value={market.executableBasisBestPct}>{fmtBasis(market.executableBasisBestPct)}</Num></td><td className={`r mkx-num ${signClass(market.executableBasisLongSpotPct)}`}><Num value={market.executableBasisLongSpotPct}>{fmtBasis(market.executableBasisLongSpotPct)}</Num></td><td className={`r mkx-num ${signClass(market.executableBasisShortSpotPct)}`}><Num value={market.executableBasisShortSpotPct}>{fmtBasis(market.executableBasisShortSpotPct)}</Num></td><td className={`r mkx-num ${signClass(net)}`}><Num value={net}>{fmtBasis(net)}</Num></td><td className={`r mkx-num ${signClass(market.fundingRate)}`}><Num value={market.fundingRate}>{fmtFunding(market.fundingRate)}</Num></td><td className="l mkx-direction">{market.executableBasisSide === 'LONG_SPOT_SHORT_PERP' ? 'Buy Spot · Sell Perp' : market.executableBasisSide === 'SHORT_SPOT_LONG_PERP' ? 'Sell Spot · Buy Perp' : '—'}</td></>;
    }
    if (view === 'liquidity') return <><td className="r mkx-num"><Num value={market.spotSpreadPct}>{fmtBps(market.spotSpreadPct)}</Num></td><td className="r mkx-num"><Num value={market.perpSpreadPct}>{fmtBps(market.perpSpreadPct)}</Num></td><td className="r mkx-num"><Num value={depthUsd(market)}>{fmtMoney(depthUsd(market))}</Num></td><td className="r mkx-num"><Num value={market.quoteVolume24h}>{fmtMoney(market.quoteVolume24h)}</Num></td><td className="r mkx-range">{finite(market.low24h) && finite(market.high24h) ? `${fmtPrice(market.low24h)} – ${fmtPrice(market.high24h)}` : '—'}</td><ChangeCell value={market.change24hPct} /></>;
    return <><td className="r mkx-num mkx-price"><Num value={market.spot}>{fmtPrice(market.spot)}</Num></td><td className="r mkx-chart"><RowSpark values={market.spark} color={brandColor(market.symbol)} /></td><ChangeCell value={market.change24hPct} /><td className="r mkx-num"><Num value={market.quoteVolume24h}>{fmtMoney(market.quoteVolume24h)}</Num></td><td className="r mkx-num">{market.hasPerp ? <Num value={market.openInterestUsd}>{fmtMoney(market.openInterestUsd)}</Num> : <span className="mkx-dim">Spot Only</span>}</td><td className={`r mkx-num ${finite(market.fundingRate) ? signClass(market.fundingRate) : ''}`}>{market.hasPerp && finite(market.fundingRate) ? <Num value={market.fundingRate}>{fmtFunding(market.fundingRate)}</Num> : <span className="mkx-dim">—</span>}</td></>;
  };

  const top50Up = (top50Pulse ?? 0) >= 0;
  const filtersActive = filter !== 'all' || search.length > 0;

  return (
    <div className="container page mkx mkx-page">
      <section className="mkx-frame" aria-label="Binance Markets">
        <header className="mkx-toolbar">
          <div className="mkx-identity">
            <div className="mkx-source-mark"><img className="mkx-market-mark" src="/markets-chart.png" alt="" aria-hidden="true" /></div>
            <span>
              <h1>Markets</h1>
              <small>Binance Spot + USD-M Reference Universe</small>
            </span>
          </div>
          <div className="mkx-tools">
            <label className="mkx-search">
              <IconSearch size={15} />
              <input aria-label="Search Markets" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} spellCheck={false} />
              {search && <button type="button" aria-label="Clear Search" onClick={() => setSearch('')}>×</button>}
            </label>
          </div>
        </header>

        <div className="mkx-summary" aria-label="Market Summary">
          <article><span>Tracked Markets</span><strong>{markets.length.toLocaleString('en-US')}</strong><small>USDT Universe</small></article>
          <article><span>Spot + Perp</span><strong>{pairedCount.toLocaleString('en-US')}</strong><small>{executableCount.toLocaleString('en-US')} Executable Books</small></article>
          <article><span>24h Volume</span><strong>{fmtMoney(totalVolume)}</strong><small>Binance Spot Quote</small></article>
          <article><span>Market Breadth</span><strong>{gainers.toLocaleString('en-US')} / {losers.toLocaleString('en-US')}</strong><small className={top50Pulse === null ? '' : top50Up ? 'pos' : 'neg'}>{top50Pulse === null ? 'Warming' : `${top50Up ? 'Up' : 'Down'} ${fmtPct(Math.abs(top50Pulse), 2, false)} · Top 50`}</small></article>
        </div>

        <ProductSurfaceAdapter surfaceId="markets" />

        <nav className="mkx-viewbar" aria-label="Market Views">
          <div role="tablist">
            {VIEWS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={view === item.id} onClick={() => applyView(item.id)}>{item.label}</button>
            ))}
          </div>
          <span className={`mkx-live ${live ? 'on' : ''}`}><i />{marketsError ? 'Feed Error' : live ? `Live · ${fmtLiveAge(marketAgeMs)}` : 'Reconnecting'}</span>
        </nav>

        <div className="mkx-controls">
          <div>
            <PillSelect value={filter} options={FILTERS} onChange={setFilter} ariaLabel="Market Filter" testId="markets-filter" />
            <PillSelect value={String(pageSize)} options={[25, 50, 100].map((count) => ({ id: String(count), label: `${count} Rows` }))} onChange={(value) => setPageSize(Number(value))} ariaLabel="Rows Per Page" testId="markets-page-size" />
            {filtersActive && <button type="button" className="mkx-reset" onClick={() => { setFilter('all'); setSearch(''); }}>Reset</button>}
          </div>
          <span>{rows.length.toLocaleString('en-US')} Markets · {visibleStart}-{visibleEnd}</span>
        </div>

        <div className="mkx-table-wrap">
          <table className="mkx-table" data-view={view}>
            <thead><tr><th className="mkx-star-col" />{tableHead('Asset', 'base', 'l', 'mkx-asset-col')}{renderViewHead()}</tr></thead>
            <tbody>
              {visible.map((market) => {
                const watched = watchlist.includes(market.symbol);
                return (
                  <tr
                    key={market.symbol}
                    tabIndex={0}
                    aria-label={`Open ${tokenName(market.base)} native chart`}
                    onClick={() => openDetail(market.symbol)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(market.symbol); } }}
                  >
                    <td className="mkx-star-col"><Star on={watched} onClick={() => void toggleWatch(market.symbol)} /></td>
                    <td className="l mkx-asset">
                      <TokenIcon symbol={market.symbol} size={34} />
                      <span><b>{tokenName(market.base)}</b><small>{market.base}/USDT · {market.hasPerp ? 'Spot + Perp' : 'Spot Only'}</small></span>
                    </td>
                    {renderViewCells(market)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <EmptyState title="No Markets Found">{filter === 'watchlist' ? 'Star markets to build the watchlist.' : 'Change the filter or search.'}</EmptyState>}
        </div>

        <footer className="mkx-footer">
          <span>Source: Binance Public Market Data · Native Charts Use Tracked Market Samples</span>
          {pages > 1 && (
            <nav className="mkx-pager" aria-label="Market Pagination">
              <button type="button" disabled={safePage === 0} onClick={() => setPageN(safePage - 1)} aria-label="Previous Page">‹</button>
              {pageList(safePage, pages).map((page, index) => page === '…' ? <span key={`ellipsis-${index}`}>…</span> : <button type="button" key={page} className={safePage === page ? 'current' : ''} onClick={() => setPageN(page)}>{page + 1}</button>)}
              <button type="button" disabled={safePage >= pages - 1} onClick={() => setPageN(safePage + 1)} aria-label="Next Page">›</button>
            </nav>
          )}
        </footer>
      </section>
    </div>
  );
}

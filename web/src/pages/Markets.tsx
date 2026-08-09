import { useEffect, useMemo, useRef, useState } from 'react';
import {
  normalizeMarketSourceTime,
  resolveMarketFreshness,
  useStore,
  type CompatibilityStateStatus,
  type MarketFreshnessStatus,
} from '../store';
import { TokenIcon, brandColor } from '../components/TokenIcon';
import { Num } from '../components/Num';
import { EmptyState } from '../components/ui';
import { IconSearch } from '../components/Icons';
import { fmtPrice, fmtPct, fmtBasis, fmtMoney, fmtFunding, signClass } from '../format';
import { primeIcons } from '../lib/iconManifest';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { tokenName } from '../lib/tokenNames';
import { PillSelect, pageList, Star } from '../components/PillSelect';
import { OptionalSurfaceSwitch, useOptionalSurface } from '../components/OptionalSurfaceGate';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import { useProductControlRoomContext } from '../features/productControlRoom/ProductControlRoomProvider';
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
const ICON_BASE_PATTERN = /^[A-Z0-9\u3400-\u9fff]{1,24}$/u;
const ICON_BASE_SEPARATOR = ',';

interface MarketEnrichmentResponse {
  readonly updatedAt?: number;
  readonly rows: MarketRow[];
}

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

function iconBaseSetIdentity(markets: readonly MarketRow[]): string {
  const bases = markets
    .map((market) => market.base.trim().toUpperCase())
    .filter((base) => ICON_BASE_PATTERN.test(base));
  return [...new Set(bases)].sort().join(ICON_BASE_SEPARATOR);
}

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

function VolumeValue({ value }: { value: number | null | undefined }) {
  return finite(value)
    ? <Num value={value}>{fmtMoney(value)}</Num>
    : <span className="mkx-dim">UNKNOWN</span>;
}

export type MarketRuntimeTruth = Readonly<{
  current: boolean;
  state: 'LOADING' | 'CURRENT' | 'UNAVAILABLE';
  label: 'Feed Loading' | 'Feed Current' | 'Feed Unavailable';
  reason: string | null;
}>;

export function resolveMarketRuntimeTruth(input: Readonly<{
  canonicalContinuity: 'UNPROVEN' | 'BACKFILL' | 'PROVEN' | 'BLOCKED';
  canonicalMarketFeedReadinessProven: boolean;
  canonicalLoading: boolean;
  canonicalReason: string | null;
  marketStatus: CompatibilityStateStatus;
  marketFreshnessStatus: MarketFreshnessStatus;
  marketsLastSuccessAtMs: number | null;
  marketsError: string | null;
}>): MarketRuntimeTruth {
  const canonicalReady = input.canonicalContinuity === 'PROVEN'
    && input.canonicalMarketFeedReadinessProven;
  if (!canonicalReady) {
    if (input.canonicalLoading && input.marketStatus === 'LOADING') {
      return Object.freeze({ current: false, state: 'LOADING', label: 'Feed Loading', reason: null });
    }
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Feed Unavailable',
      reason: input.canonicalReason ?? 'CANONICAL_MARKET_FEED_READINESS_UNAVAILABLE',
    });
  }
  if (input.marketStatus === 'LOADING') {
    return Object.freeze({ current: false, state: 'LOADING', label: 'Feed Loading', reason: null });
  }
  if (input.marketStatus !== 'CURRENT') {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Feed Unavailable',
      reason: input.marketsError ?? `MARKET_SOURCE_${input.marketStatus}`,
    });
  }
  if (input.marketsLastSuccessAtMs === null) {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Feed Unavailable',
      reason: 'MARKET_SOURCE_SUCCESS_TIMESTAMP_UNAVAILABLE',
    });
  }
  if (input.marketFreshnessStatus !== 'LIVE') {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Feed Unavailable',
      reason: input.marketsError ?? `MARKET_SOURCE_${input.marketFreshnessStatus}`,
    });
  }
  return Object.freeze({ current: true, state: 'CURRENT', label: 'Feed Current', reason: null });
}

export function Markets() {
  const { binding } = useProductControlRoomContext();
  const {
    markets: leanMarkets,
    marketStatus: leanMarketStatus,
    marketsLastSuccessAtMs: leanMarketsLastSuccessAtMs,
    marketsUpdatedAt: leanMarketsUpdatedAt,
    marketsError: leanMarketsError,
    connected,
    state,
    prefs,
    openDetail,
    toggleWatch,
  } = useStore();
  const marketsSurface = useOptionalSurface('markets');
  const [enrichedMarkets, setEnrichedMarkets] = useState<MarketRow[]>([]);
  const [enrichmentStatus, setEnrichmentStatus] = useState<CompatibilityStateStatus>('LOADING');
  const [enrichmentLastSuccessAtMs, setEnrichmentLastSuccessAtMs] = useState<number | null>(null);
  const [enrichmentUpdatedAt, setEnrichmentUpdatedAt] = useState<number | null>(null);
  const [enrichmentError, setEnrichmentError] = useState<string | null>(null);
  const initialView = readMarketView();
  const [view, setView] = useState<View>(initialView);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>(VIEWS.find((item) => item.id === initialView)?.sort ?? 'quoteVolume24h');
  const [sortDesc, setSortDesc] = useState(true);
  const [pageN, setPageN] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [now, setNow] = useState(() => Date.now());

  const enrichmentCurrent = marketsSurface.enabled
    && enrichmentStatus === 'CURRENT'
    && enrichmentLastSuccessAtMs !== null;
  const markets = !marketsSurface.enabled
    ? []
    : enrichmentCurrent
      ? enrichedMarkets
      : leanMarkets;
  const marketStatus = enrichmentCurrent ? 'CURRENT' : leanMarketStatus;
  const marketsLastSuccessAtMs = enrichmentCurrent
    ? enrichmentLastSuccessAtMs
    : leanMarketsLastSuccessAtMs;
  const marketsUpdatedAt = enrichmentCurrent ? enrichmentUpdatedAt : leanMarketsUpdatedAt;
  const marketsError = enrichmentCurrent ? enrichmentError : leanMarketsError;
  const marketDatasetLabel = enrichmentCurrent
    ? 'On-Demand Enriched Snapshot'
    : enrichmentStatus === 'LOADING'
      ? 'Lean Published Cut · Enrichment Loading'
      : enrichmentStatus === 'STALE'
        ? 'Lean Published Cut · Enrichment Stale'
        : 'Lean Published Cut · Enrichment Unavailable';
  const watchlist = state?.config.watchlist ?? [];
  const iconBasesIdentity = useMemo(() => iconBaseSetIdentity(markets), [markets]);

  useEffect(
    () => primeIcons(iconBasesIdentity ? iconBasesIdentity.split(ICON_BASE_SEPARATOR) : []),
    [iconBasesIdentity],
  );
  useEffect(() => {
    if (!marketsSurface.enabled) {
      setEnrichedMarkets([]);
      setEnrichmentStatus(marketsSurface.controlStatus === 'LOADING' ? 'LOADING' : 'UNAVAILABLE');
      setEnrichmentLastSuccessAtMs(null);
      setEnrichmentUpdatedAt(null);
      setEnrichmentError(marketsSurface.controlError
        ?? marketsSurface.snapshot.failureCode
        ?? 'OPTIONAL_SURFACE_OFF');
      return;
    }

    setEnrichedMarkets([]);
    setEnrichmentStatus('LOADING');
    setEnrichmentLastSuccessAtMs(null);
    setEnrichmentUpdatedAt(null);
    setEnrichmentError(null);
    const marketSec = prefs.dataCadence?.market ?? prefs.refreshSec;
    const poll = createSettledPoll<MarketEnrichmentResponse>({
      intervalMs: Math.max(0.5, marketSec) * 1_000,
      request: (signal) => fetchJson<MarketEnrichmentResponse>(
        '/api/markets/enrichment',
        { cache: 'no-store', signal },
        10_000,
      ),
      onSuccess: (payload) => {
        if (!Array.isArray(payload.rows)) throw new Error('Invalid market enrichment response');
        setEnrichedMarkets(payload.rows);
        setEnrichmentUpdatedAt(normalizeMarketSourceTime(payload.updatedAt));
        setEnrichmentLastSuccessAtMs(Date.now());
        setEnrichmentError(null);
        setEnrichmentStatus('CURRENT');
      },
      onError: (cause) => {
        setEnrichmentStatus((current) => current === 'CURRENT' || current === 'STALE'
          ? 'STALE'
          : 'UNAVAILABLE');
        setEnrichmentError(apiErrorMessage(cause, 'Market enrichment unavailable'));
      },
    });
    poll.start();
    return poll.stop;
  }, [
    marketsSurface.controlError,
    marketsSurface.controlStatus,
    marketsSurface.enabled,
    marketsSurface.snapshot.failureCode,
    marketsSurface.snapshot.generation,
    prefs.dataCadence?.market,
    prefs.refreshSec,
  ]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(VIEW_STORAGE, view); } catch { /* Optional preference. */ }
  }, [view]);

  const marketFreshness = resolveMarketFreshness({
    connected,
    error: marketsError,
    sourceTimeMs: marketsUpdatedAt,
    nowMs: now,
    staleAfterMs: Math.max(12_000, prefs.refreshSec * 2500),
  });
  const canonicalMarketSurface = binding.snapshot?.surfaces.markets;
  const marketEvidenceReason = canonicalMarketSurface?.evidence.find((datum) => datum.unavailableReason)?.unavailableReason ?? null;
  const canonicalMarketReason = binding.continuity !== 'PROVEN'
    ? binding.error ?? `CANONICAL_CONTINUITY_${binding.continuity}`
    : marketEvidenceReason
      ?? canonicalMarketSurface?.blocker
      ?? binding.snapshot?.canonicalCockpit.marketFeedReadiness.detail
      ?? binding.error
      ?? 'CANONICAL_MARKET_FEED_READINESS_UNAVAILABLE';
  const marketTruth = resolveMarketRuntimeTruth({
    canonicalContinuity: binding.continuity,
    canonicalMarketFeedReadinessProven: binding.snapshot?.canonicalCockpit.marketFeedReadiness.proven ?? false,
    canonicalLoading: binding.loading && binding.snapshot === null && binding.error === null,
    canonicalReason: canonicalMarketReason,
    marketStatus,
    marketFreshnessStatus: marketFreshness.status,
    marketsLastSuccessAtMs,
    marketsError,
  });
  const marketReadSucceeded = marketTruth.current;
  const marketFreshnessLabel = marketTruth.current
    ? `Live · ${fmtLiveAge(marketFreshness.ageMs)}`
    : marketTruth.label;
  const marketUnassertedDetail = marketTruth.state === 'LOADING'
    ? 'Awaiting current source truth'
    : 'Canonical source unavailable';

  const knownChanges24h = markets.map((market) => market.change24hPct).filter(finite);
  const changeCoverageComplete = markets.length > 0 && knownChanges24h.length === markets.length;
  const breadthKnown = marketReadSucceeded && changeCoverageComplete;
  const gainers = knownChanges24h.filter((change) => change > 0).length;
  const losers = knownChanges24h.filter((change) => change < 0).length;
  const pairedCount = markets.filter((market) => market.hasSpot && market.hasPerp).length;
  const executableCount = markets.filter(hasExecutableBooks).length;
  const volumeKnownRows = markets.filter((market) => finite(market.quoteVolume24h));
  const totalVolume = volumeKnownRows.reduce((sum, market) => sum + (market.quoteVolume24h ?? 0), 0);
  const volumeCoverageComplete = markets.length > 0 && volumeKnownRows.length === markets.length;

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
      case 'movers': filtered = filtered.filter((market) => finite(market.change24hPct) && Math.abs(market.change24hPct) >= 2 && finite(market.quoteVolume24h) && market.quoteVolume24h >= 1_000_000); break;
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

  const pages = marketReadSucceeded ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  const safePage = Math.min(pageN, pages - 1);
  const visible = marketReadSucceeded ? rows.slice(safePage * pageSize, safePage * pageSize + pageSize) : [];
  const visibleStart = visible.length ? safePage * pageSize + 1 : 0;
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
    if (view === 'basis') return <>{tableHead('Best Executable', 'executableBasisBestPct')}{tableHead('Long Spot', 'executableBasisLongSpotPct')}{tableHead('Short Spot', 'executableBasisShortSpotPct')}{tableHead('Funding', 'fundingRate')}{tableHead('Direction', null, 'l', 'mkx-direction-col')}</>;
    if (view === 'liquidity') return <>{tableHead('Spot Spread', 'spotSpreadPct')}{tableHead('Perp Spread', 'perpSpreadPct')}{tableHead('Top Depth', 'depth')}{tableHead('Volume', 'quoteVolume24h')}{tableHead('24h Range', null)}{tableHead('Change', 'change24hPct')}</>;
    return <>{tableHead('Market Price', 'spot')}{tableHead('Native Chart', 'sparkGrowth', 'r', 'mkx-chart-col')}{tableHead('Change', 'change24hPct')}{tableHead('Volume', 'quoteVolume24h')}{tableHead('Open Interest', 'openInterestUsd')}{tableHead('Funding', 'fundingRate')}</>;
  };

  const renderViewCells = (market: MarketRow) => {
    if (view === 'derivatives') return <><td className="r mkx-num"><Num value={market.perpMark}>{fmtPrice(market.perpMark)}</Num></td><td className={`r mkx-num ${signClass(market.fundingRate)}`}><Num value={market.fundingRate}>{fmtFunding(market.fundingRate)}</Num></td><td className="r mkx-num"><Num value={market.openInterestUsd}>{fmtMoney(market.openInterestUsd)}</Num></td><ChangeCell value={market.openInterestChangePct} /><td className="r mkx-num"><Num value={market.liquidations15mUsd}>{fmtMoney(market.liquidations15mUsd)}</Num></td><td className="r mkx-num"><VolumeValue value={market.perpVolume24h} /></td></>;
    if (view === 'basis') return <><td className={`r mkx-num ${signClass(market.executableBasisBestPct)}`}><Num value={market.executableBasisBestPct}>{fmtBasis(market.executableBasisBestPct)}</Num></td><td className={`r mkx-num ${signClass(market.executableBasisLongSpotPct)}`}><Num value={market.executableBasisLongSpotPct}>{fmtBasis(market.executableBasisLongSpotPct)}</Num></td><td className={`r mkx-num ${signClass(market.executableBasisShortSpotPct)}`}><Num value={market.executableBasisShortSpotPct}>{fmtBasis(market.executableBasisShortSpotPct)}</Num></td><td className={`r mkx-num ${signClass(market.fundingRate)}`}><Num value={market.fundingRate}>{fmtFunding(market.fundingRate)}</Num></td><td className="l mkx-direction">{market.executableBasisSide === 'LONG_SPOT_SHORT_PERP' ? 'Buy Spot · Sell Perp' : market.executableBasisSide === 'SHORT_SPOT_LONG_PERP' ? 'Sell Spot · Buy Perp' : '—'}</td></>;
    if (view === 'liquidity') return <><td className="r mkx-num"><Num value={market.spotSpreadPct}>{fmtBps(market.spotSpreadPct)}</Num></td><td className="r mkx-num"><Num value={market.perpSpreadPct}>{fmtBps(market.perpSpreadPct)}</Num></td><td className="r mkx-num"><Num value={depthUsd(market)}>{fmtMoney(depthUsd(market))}</Num></td><td className="r mkx-num"><VolumeValue value={market.quoteVolume24h} /></td><td className="r mkx-range">{finite(market.low24h) && finite(market.high24h) ? `${fmtPrice(market.low24h)} – ${fmtPrice(market.high24h)}` : '—'}</td><ChangeCell value={market.change24hPct} /></>;
    return <><td className="r mkx-num mkx-price"><Num value={market.spot}>{fmtPrice(market.spot)}</Num></td><td className="r mkx-chart"><RowSpark values={market.spark} color={brandColor(market.symbol)} /></td><ChangeCell value={market.change24hPct} /><td className="r mkx-num"><VolumeValue value={market.quoteVolume24h} /></td><td className="r mkx-num">{market.hasPerp ? <Num value={market.openInterestUsd}>{fmtMoney(market.openInterestUsd)}</Num> : <span className="mkx-dim">Spot Only</span>}</td><td className={`r mkx-num ${finite(market.fundingRate) ? signClass(market.fundingRate) : ''}`}>{market.hasPerp && finite(market.fundingRate) ? <Num value={market.fundingRate}>{fmtFunding(market.fundingRate)}</Num> : <span className="mkx-dim">—</span>}</td></>;
  };

  const filtersActive = filter !== 'all' || search.length > 0;

  return (
    <div className="container page mkx mkx-page">
      <section className="mkx-frame" aria-label="Binance Markets">
        <header className="mkx-toolbar">
          <div className="mkx-identity">
            <div className="mkx-source-mark"><img className="mkx-market-mark" src="/markets-chart.png" alt="" aria-hidden="true" /></div>
            <span>
              <h1>Markets</h1>
              <small>Binance Spot + USD-M Reference Universe · {marketDatasetLabel}</small>
            </span>
          </div>
          <div className="mkx-tools">
            <label className="mkx-search">
              <IconSearch size={15} />
              <input aria-label="Search Markets" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} spellCheck={false} />
              {search && <button type="button" aria-label="Clear Search" onClick={() => setSearch('')}>×</button>}
            </label>
            <OptionalSurfaceSwitch surfaceId="markets" />
          </div>
        </header>

        <div className="mkx-summary" aria-label="Market Summary">
          <article><span>Tracked Markets</span><strong>{marketReadSucceeded ? markets.length.toLocaleString('en-US') : 'UNKNOWN'}</strong><small>{marketReadSucceeded ? 'USDT Universe' : marketUnassertedDetail}</small></article>
          <article><span>Spot + Perp</span><strong>{marketReadSucceeded ? pairedCount.toLocaleString('en-US') : 'UNKNOWN'}</strong><small>{marketReadSucceeded ? `${executableCount.toLocaleString('en-US')} Executable Books` : marketUnassertedDetail}</small></article>
          <article><span>24h Volume</span><strong>{marketReadSucceeded && volumeCoverageComplete ? fmtMoney(totalVolume) : 'UNKNOWN'}</strong><small>{!marketReadSucceeded ? marketUnassertedDetail : volumeCoverageComplete ? 'Binance Spot Quote · Complete Coverage' : `Coverage UNKNOWN · ${volumeKnownRows.length} of ${markets.length} rows known`}</small></article>
          <article><span>Market Breadth</span><strong>{breadthKnown ? `${gainers.toLocaleString('en-US')} / ${losers.toLocaleString('en-US')}` : 'UNKNOWN'}</strong><small>{!marketReadSucceeded ? marketUnassertedDetail : changeCoverageComplete ? `Complete Change Coverage · ${knownChanges24h.length.toLocaleString('en-US')} rows` : `Change Coverage UNKNOWN · ${knownChanges24h.length.toLocaleString('en-US')} of ${markets.length.toLocaleString('en-US')} rows known`}</small></article>
        </div>

        <ProductSurfaceAdapter surfaceId="markets" />

        <nav className="mkx-viewbar" aria-label="Market Views">
          <div role="tablist">
            {VIEWS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={view === item.id} onClick={() => applyView(item.id)}>{item.label}</button>
            ))}
          </div>
          <span className={`mkx-live ${marketReadSucceeded ? 'on' : ''}`} title={marketTruth.reason ?? undefined}><i />{marketFreshnessLabel}</span>
        </nav>

        <div className="mkx-controls">
          <div>
            <PillSelect value={filter} options={FILTERS} onChange={setFilter} ariaLabel="Market Filter" testId="markets-filter" />
            <PillSelect value={String(pageSize)} options={[25, 50, 100].map((count) => ({ id: String(count), label: `${count} Rows` }))} onChange={(value) => setPageSize(Number(value))} ariaLabel="Rows Per Page" testId="markets-page-size" />
            {filtersActive && <button type="button" className="mkx-reset" onClick={() => { setFilter('all'); setSearch(''); }}>Reset</button>}
          </div>
          <span>{marketReadSucceeded ? `${rows.length.toLocaleString('en-US')} Markets · ${visibleStart}-${visibleEnd}` : 'UNKNOWN Markets'}</span>
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
          {!marketReadSucceeded && <EmptyState title={marketTruth.state === 'LOADING' ? 'Markets Loading' : 'Markets Unavailable'}>{marketTruth.reason ?? 'Waiting for canonical market-source truth and a current live read.'}</EmptyState>}
          {marketReadSucceeded && rows.length === 0 && <EmptyState title="No Markets Found">{filter === 'watchlist' ? 'Star markets to build the watchlist.' : 'Change the filter or search.'}</EmptyState>}
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

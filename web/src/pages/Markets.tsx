import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { TokenIcon, brandColor } from '../components/TokenIcon';
import { Num } from '../components/Num';
import { EmptyState } from '../components/ui';
import { IconSearch } from '../components/Icons';
import { fmtPrice, fmtPct, fmtBasis, fmtMoney, fmtFunding, countdown, signClass } from '../format';
import { primeIcons } from '../lib/iconManifest';
import { tokenName } from '../lib/tokenNames';
import { Chev, PillSelect, pageList, Star } from '../components/PillSelect';
import type { MarketRow } from '../types';
import './Markets.css';

type View = 'overview' | 'derivatives' | 'basis' | 'liquidity';
type Filter = 'all' | 'watchlist' | 'paired' | 'spotOnly' | 'movers';
type MarketSource = 'binance' | 'all' | 'coinbase' | 'bybit' | 'coingecko';
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

const VIEWS: { id: View; label: string; sort: SortKey }[] = [
  { id: 'overview', label: 'Overview', sort: 'quoteVolume24h' },
  { id: 'derivatives', label: 'Derivatives', sort: 'openInterestUsd' },
  { id: 'basis', label: 'Basis', sort: 'executableBasisBestPct' },
  { id: 'liquidity', label: 'Liquidity', sort: 'depth' },
];

function readMarketView(): View {
  if (typeof window === 'undefined') return 'derivatives';
  try {
    const saved = window.localStorage.getItem('cosmos-market-view') as View | null;
    if (saved && VIEWS.some((item) => item.id === saved)) return saved;
  } catch {
    // Local persistence is optional; the useful operator view remains the fallback.
  }
  return 'derivatives';
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All Assets' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'paired', label: 'Spot + Perp' },
  { id: 'spotOnly', label: 'Spot Only' },
  { id: 'movers', label: 'Movers' },
];

const MARKET_SOURCES: {
  id: MarketSource;
  name: string;
  domain: string | null;
  detail: string;
  enabled: boolean;
}[] = [
  { id: 'binance', name: 'Binance', domain: 'binance.com', detail: 'Spot, Perpetuals, OI & Funding', enabled: true },
  { id: 'all', name: 'All Sources', domain: null, detail: 'Unified Multi-Source Market Universe', enabled: false },
  { id: 'coinbase', name: 'Coinbase', domain: 'coinbase.com', detail: 'Advanced Trade Spot Markets', enabled: false },
  { id: 'bybit', name: 'Bybit', domain: 'bybit.com', detail: 'Spot & Derivatives Coverage', enabled: false },
  { id: 'coingecko', name: 'CoinGecko', domain: 'coingecko.com', detail: 'Broader Token Discovery', enabled: false },
];

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const fmtCount = (v: number) => (Number.isFinite(v) ? compact.format(v) : '—');

function fmtAgeMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 1500) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

function fmtLiveAge(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 1500) return 'now';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  return `${Math.max(1, Math.round(ms / 3_600_000))}h`;
}

function depthUsd(row: MarketRow): number | null {
  if (row.hasPerp && finite(row.spotTopQuoteUsd) && finite(row.perpTopQuoteUsd)) return Math.min(row.spotTopQuoteUsd, row.perpTopQuoteUsd);
  return row.spotTopQuoteUsd ?? null;
}

function fmtBps(v: number | null | undefined): string {
  if (!finite(v)) return '—';
  const bps = v * 100;
  const a = Math.abs(bps);
  return `${bps.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2)} bps`;
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
      const sp = row.spark;
      if (!sp || sp.length < 2 || !Number.isFinite(sp[0]) || sp[0] === 0) return Number.NaN;
      return ((sp[sp.length - 1] - sp[0]) / Math.abs(sp[0])) * 100;
    }
  }
}

/* ---- little coinbase-anatomy pieces ---------------------------------- */

const Globe = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
    <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <ellipse cx="8" cy="8" rx="2.8" ry="6.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M2 8h12M2.8 5h10.4M2.8 11h10.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
  </svg>
);

/** Diagonal change arrow, Coinbase-style: ↗ for up, ↙ for down. */
const DiagArrow = ({ up }: { up: boolean }) => (
  <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden style={{ transform: up ? 'none' : 'rotate(180deg)' }}>
    <path d="M3.5 8.5L8.5 3.5M4.6 3.5h3.9v3.9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SortGlyph = ({ dir }: { dir: 'asc' | 'desc' | null }) => (
  <svg viewBox="0 0 10 14" width="9" height="13" aria-hidden className="mkx-sortglyph">
    <path d="M5 1.5L8 5H2z" fill="currentColor" opacity={dir === 'asc' ? 1 : 0.34} />
    <path d="M5 12.5L2 9h6z" fill="currentColor" opacity={dir === 'desc' ? 1 : 0.34} />
  </svg>
);

function SourceLogo({ source, size = 24 }: { source: (typeof MARKET_SOURCES)[number]; size?: number }) {
  if (source.id === 'binance') {
    return (
      <span className="mkx-source-logo mkx-source-logo-binance" style={{ width: size, height: size }} aria-hidden>
        <svg viewBox="0 0 24 24" width={size} height={size}>
          <path d="M16.624 13.9202l2.7175 2.7154-7.353 7.353-7.353-7.352 2.7175-2.7164 4.6355 4.6595 4.6356-4.6595zm4.6366-4.6366L24 12l-2.7154 2.7164L18.5682 12l2.6924-2.7164zm-9.272.001l2.7163 2.6914-2.7164 2.7174v-.001L9.2721 12l2.7164-2.7154zm-9.2722-.001L5.4088 12l-2.6914 2.6924L0 12l2.7164-2.7164zM11.9885.0115l7.353 7.329-2.7174 2.7154-4.6356-4.6356-4.6355 4.6595-2.7174-2.7154 7.353-7.353z" />
        </svg>
      </span>
    );
  }
  if (!source.domain) {
    return (
      <span className="mkx-source-logo mkx-source-logo-all" style={{ width: size, height: size }} aria-hidden>
        <svg viewBox="0 0 20 20" width="14" height="14">
          <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" />
          <rect x="11.5" y="2.5" width="6" height="6" rx="1.5" />
          <rect x="2.5" y="11.5" width="6" height="6" rx="1.5" />
          <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" />
        </svg>
      </span>
    );
  }
  return (
    <span className="mkx-source-logo" style={{ width: size, height: size }} data-fallback={source.name.slice(0, 1)} aria-hidden>
      <img
        src={`/api/source-logo?domain=${encodeURIComponent(source.domain)}&sz=64`}
        alt=""
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    </span>
  );
}

function MarketSourcePicker() {
  const [source, setSource] = useState<MarketSource>('binance');
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = MARKET_SOURCES.find((item) => item.id === source) ?? MARKET_SOURCES[0];

  const toggleMenu = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      setOpenUp(below < 372 && rect.top > below);
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="mkx-source-picker" ref={ref}>
      <button
        type="button"
        className="mkx-source-trigger"
        aria-label={`Market data source: ${selected.name}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleMenu}
      >
        <SourceLogo source={selected} size={17} />
        <span>{selected.name}</span>
        <span className={`mkx-chev ${open ? 'up' : ''}`}><Chev /></span>
      </button>
      {open && (
        <div className={`mkx-source-menu ${openUp ? 'upward' : ''}`} role="listbox" aria-label="Market data source">
          <div className="mkx-source-menu-head">
            <b>Market Data Source</b>
            <span>Choose The Universe Behind This Table</span>
          </div>
          <div className="mkx-source-options">
            {MARKET_SOURCES.map((item) => {
              const active = item.id === source;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={!item.enabled}
                  className={active ? 'selected' : ''}
                  title={item.enabled ? `${item.name} Market Feed` : `${item.name} Integration Is Planned`}
                  onClick={() => {
                    setSource(item.id);
                    setOpen(false);
                  }}
                >
                  <SourceLogo source={item} size={30} />
                  <span className="mkx-source-copy">
                    <b>{item.name}</b>
                    <em>{item.detail}</em>
                  </span>
                  <span className={`mkx-source-state ${item.enabled ? 'live' : 'planned'}`}>
                    {item.enabled ? 'Live' : 'Planned'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


/** Downsample to ~n points, then a smooth Catmull-Rom→Bezier path — the
 * Coinbase spark is a flowing 2px line, never a raw tick-noise zigzag. */
function smoothPath(values: number[], w: number, h: number, n = 26): string {
  let vs = values;
  if (vs.length > n) {
    const step = (vs.length - 1) / (n - 1);
    vs = Array.from({ length: n }, (_, i) => vs[Math.round(i * step)]);
  }
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const pts: [number, number][] = vs.map((v, i) => [
    (i / (vs.length - 1)) * w,
    h - 3 - ((v - min) / span) * (h - 6),
  ]);
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Line sparkline for table rows — smooth stroke, brand colored. Stablecoins
 * (range under 0.1% of price) draw a calm midline instead of amplified noise. */
function RowSpark({ values, color }: { values: number[] | null | undefined; color: string }) {
  if (!values || values.length < 2) return <span className="mkx-spark-empty" />;
  const w = 100;
  const h = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean !== 0 && (max - min) / Math.abs(mean) < 0.001) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="mkx-rowspark" aria-hidden>
        <line x1="2" y1={h / 2} x2={w - 2} y2={h / 2} stroke={color} strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="mkx-rowspark" aria-hidden>
      <path d={smoothPath(values, w, h)} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Stat-tile chart: line over a halftone-dot area fill (the Coinbase tile look). */
function DotSpark({ values, tone, id }: { values: number[]; tone: 'up' | 'down'; id: string }) {
  const w = 260;
  const h = 56;
  if (!values || values.length < 2) return null;
  const line = smoothPath(values, w, h, 34);
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  const color = tone === 'up' ? 'var(--up)' : 'var(--down)';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mkx-dotspark" aria-hidden>
      <defs>
        <pattern id={`dots-${id}`} width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="1.4" cy="1.4" r="1" fill={color} opacity="0.3" />
        </pattern>
      </defs>
      <path d={area} fill={`url(#dots-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Change cell with honest tick flashing: on every update the cell pulses in
 * the TICK direction — green with an UP arrow when the value just rose, red
 * with a down arrow when it fell — then reverts to the steady 24h truth.
 * The arrow and the flash can never contradict each other. Values that round
 * to 0.00% rest plain and neutral (a red "down 0.00%" is a rounding lie). */
function ChangeCell({ v }: { v: number | null | undefined }) {
  const [flash, setFlash] = useState<null | 'up' | 'down'>(null);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = finite(v) ? v : null;
    if (p === null || !finite(v) || v === p) return;
    setFlash(v > p ? 'up' : 'down');
    const t = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(t);
  }, [v]);
  const flat = !finite(v) || Math.abs(v ?? 0) < 0.005;
  const showArrow = flash !== null || !flat;
  const arrowUp = flash ? flash === 'up' : (v ?? 0) > 0;
  const cls = flash ? (flash === 'up' ? 'pos' : 'neg') : flat ? '' : signClass(v);
  return (
    <td className={`r mkx-chg ${cls}`}>
      {finite(v) ? (
        <span className="mkx-chg-in">
          {showArrow && <DiagArrow up={arrowUp} />}
          {fmtPct(Math.abs(v ?? 0), 2, false)}
        </span>
      ) : '—'}
    </td>
  );
}


/* ---- page ------------------------------------------------------------ */

export function Markets() {
  const { markets, marketsUpdatedAt, marketsError, connected, state, prefs, openDetail, toggleWatch } = useStore();
  const [view, setView] = useState<View>(readMarketView);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>(() => VIEWS.find((item) => item.id === readMarketView())?.sort ?? 'openInterestUsd');
  const [sortDesc, setSortDesc] = useState(true);
  const [pageN, setPageN] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [more, setMore] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const watchlist = state?.config.watchlist ?? [];
  const feesPct = state?.config.feesPct ?? 0;
  const iconBases = useMemo(() => [...new Set(markets.map((m) => m.base))], [markets]);
  useEffect(() => { primeIcons(iconBases); }, [iconBases]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem('cosmos-market-view', view);
    } catch {
      // Persistence is a convenience; the active in-memory view still works.
    }
  }, [view]);

  /* -- honest aggregates (all computed from live Binance rows) -- */
  const withChange = markets.filter((m) => finite(m.change24hPct));
  const gainers = withChange.filter((m) => (m.change24hPct ?? 0) > 0).length;
  const losers = withChange.filter((m) => (m.change24hPct ?? 0) < 0).length;
  const totalVol = markets.reduce((s, m) => s + (m.quoteVolume24h ?? 0), 0);
  const byVol = useMemo(() => [...markets].filter((m) => (m.quoteVolume24h ?? 0) > 0).sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0)), [markets]);
  const top50 = byVol.slice(0, 50);
  const idxWeight = top50.reduce((s, m) => s + (m.quoteVolume24h ?? 0), 0);
  const idx50 = idxWeight > 0 ? top50.reduce((s, m) => s + (m.change24hPct ?? 0) * (m.quoteVolume24h ?? 0), 0) / idxWeight : null;
  const btc = markets.find((m) => m.base === 'BTC') ?? null;
  const btcShare = btc && totalVol > 0 ? ((btc.quoteVolume24h ?? 0) / totalVol) * 100 : null;
  const marketAgeMs = marketsUpdatedAt ? now - marketsUpdatedAt : null;
  const live = connected && !marketsError && marketAgeMs !== null && marketAgeMs < Math.max(12_000, prefs.refreshSec * 2500);

  /* -- filter → sort → page -- */
  const rows = useMemo(() => {
    let r = markets;
    if (search.trim()) {
      const q = search.trim().toUpperCase();
      r = r.filter((m) => m.base.includes(q) || m.symbol.includes(q));
    }
    switch (filter) {
      case 'watchlist': r = r.filter((m) => watchlist.includes(m.symbol)); break;
      case 'paired': r = r.filter((m) => m.hasSpot && m.hasPerp); break;
      case 'spotOnly': r = r.filter((m) => m.hasSpot && !m.hasPerp); break;
      case 'movers': r = r.filter((m) => finite(m.change24hPct) && (m.quoteVolume24h ?? 0) > 500_000); break;
    }
    const dir = sortDesc ? -1 : 1;
    return [...r].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * dir;
      const af = Number.isFinite(av);
      const bf = Number.isFinite(bv);
      if (!af && !bf) return a.base.localeCompare(b.base);
      if (!af) return 1;
      if (!bf) return -1;
      return (av - bv) * dir;
    });
  }, [markets, filter, search, sortKey, sortDesc, watchlist]);

  useEffect(() => setPageN(0), [filter, search, sortKey, sortDesc, pageSize, view]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(pageN, pages - 1);
  const visible = rows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const visibleStart = rows.length ? safePage * pageSize + 1 : 0;
  const visibleEnd = safePage * pageSize + visible.length;

  const applyView = (next: View) => {
    const preset = VIEWS.find((v) => v.id === next);
    setView(next);
    if (preset) { setSortKey(preset.sort); setSortDesc(true); }
  };

  const th = (label: string, key: SortKey | null, align: 'l' | 'r' = 'r', cls = '') => {
    if (!key) return <th className={`${align} ${cls}`}>{label}</th>;
    const active = sortKey === key;
    return (
      <th className={`${align} ${cls} ${active ? 'sorted' : ''}`} aria-sort={active ? (sortDesc ? 'descending' : 'ascending') : 'none'}>
        <button
          className="mkx-th"
          onClick={() => {
            if (active) setSortDesc(!sortDesc);
            else { setSortKey(key); setSortDesc(key !== 'base'); }
          }}
        >
          {label}
          <SortGlyph dir={active ? (sortDesc ? 'desc' : 'asc') : null} />
        </button>
      </th>
    );
  };

  const changeCell = (v: number | null | undefined) => <ChangeCell v={v} />;

  /* -- per-view columns (data honest to what Binance actually publishes) -- */
  const cols: { head: ReactNode; cells: (m: MarketRow) => ReactNode } = useMemo(() => {
    if (view === 'derivatives') {
      return {
        head: (
          <>
            {th('Perp Mark', 'perpChange24hPct')}
            {th('Funding', 'fundingRate')}
            {th('Open Interest', 'openInterestUsd')}
            {th('OI Change', 'openInterestChangePct')}
            {th('Liq 15m', 'liquidations15mUsd')}
            {th('Perp Volume', 'perpVolume24h')}
          </>
        ),
        cells: (m) => (
          <>
            <td className="r mkx-num"><Num value={m.perpMark}>{fmtPrice(m.perpMark)}</Num></td>
            <td className={`r mkx-num ${signClass(m.fundingRate)}`}><Num value={m.fundingRate}>{fmtFunding(m.fundingRate)}</Num></td>
            <td className="r mkx-num"><Num value={m.openInterestUsd}>{fmtMoney(m.openInterestUsd)}</Num></td>
            {changeCell(m.openInterestChangePct)}
            <td className="r mkx-num"><Num value={m.liquidations15mUsd}>{fmtMoney(m.liquidations15mUsd)}</Num></td>
            <td className="r mkx-num"><Num value={m.perpVolume24h}>{fmtMoney(m.perpVolume24h)}</Num></td>
          </>
        ),
      };
    }
    if (view === 'basis') {
      return {
        head: (
          <>
            {th('Best Executable', 'executableBasisBestPct')}
            {th('Long Spot', 'executableBasisLongSpotPct')}
            {th('Short Spot', 'executableBasisShortSpotPct')}
            {th('Net After Fees', 'executableBasisBestPct')}
            {th('Funding', 'fundingRate')}
            {th('Direction', null, 'l', 'mkx-dircol')}
          </>
        ),
        cells: (m) => {
          const net = finite(m.executableBasisBestPct) ? m.executableBasisBestPct - feesPct : null;
          return (
            <>
              <td className={`r mkx-num ${signClass(m.executableBasisBestPct)}`}><Num value={m.executableBasisBestPct}>{fmtBasis(m.executableBasisBestPct)}</Num></td>
              <td className={`r mkx-num ${signClass(m.executableBasisLongSpotPct)}`}><Num value={m.executableBasisLongSpotPct}>{fmtBasis(m.executableBasisLongSpotPct)}</Num></td>
              <td className={`r mkx-num ${signClass(m.executableBasisShortSpotPct)}`}><Num value={m.executableBasisShortSpotPct}>{fmtBasis(m.executableBasisShortSpotPct)}</Num></td>
              <td className={`r mkx-num ${signClass(net)}`}><Num value={net}>{fmtBasis(net)}</Num></td>
              <td className={`r mkx-num ${signClass(m.fundingRate)}`}><Num value={m.fundingRate}>{fmtFunding(m.fundingRate)}</Num></td>
              <td className="l mkx-dir">{m.executableBasisSide === 'LONG_SPOT_SHORT_PERP' ? 'Buy spot / sell perp' : m.executableBasisSide === 'SHORT_SPOT_LONG_PERP' ? 'Sell spot / buy perp' : '—'}</td>
            </>
          );
        },
      };
    }
    if (view === 'liquidity') {
      return {
        head: (
          <>
            {th('Spot Spread', 'spotSpreadPct')}
            {th('Perp Spread', 'perpSpreadPct')}
            {th('Top Depth', 'depth')}
            {th('Volume', 'quoteVolume24h')}
            {th('24h Range', null, 'r')}
            {th('Change', 'change24hPct')}
          </>
        ),
        cells: (m) => (
          <>
            <td className="r mkx-num"><Num value={m.spotSpreadPct}>{fmtBps(m.spotSpreadPct)}</Num></td>
            <td className="r mkx-num"><Num value={m.perpSpreadPct}>{fmtBps(m.perpSpreadPct)}</Num></td>
            <td className="r mkx-num"><Num value={depthUsd(m)}>{fmtMoney(depthUsd(m))}</Num></td>
            <td className="r mkx-num"><Num value={m.quoteVolume24h}>{fmtMoney(m.quoteVolume24h)}</Num></td>
            <td className="r mkx-num mkx-range-cell">{finite(m.low24h) && finite(m.high24h) ? `${fmtPrice(m.low24h)} – ${fmtPrice(m.high24h)}` : '—'}</td>
            {changeCell(m.change24hPct)}
          </>
        ),
      };
    }
    return {
      head: (
        <>
          {th('Market Price', 'spot', 'r', 'mkx-pricecol')}
          {th('Chart', 'sparkGrowth', 'r', 'mkx-chartcol')}
          {th('Change', 'change24hPct', 'r', 'mkx-chgcol')}
          {th('Volume', 'quoteVolume24h', 'r', 'mkx-volcol')}
          {th('Open Interest', 'openInterestUsd', 'r', 'mkx-oicol')}
          {th('Funding', 'fundingRate', 'r', 'mkx-fundcol')}
        </>
      ),
      cells: (m) => (
        <>
          <td className="r mkx-num mkx-price"><Num value={m.spot}>{fmtPrice(m.spot)}</Num></td>
          <td className="r mkx-chart"><RowSpark values={m.spark} color={brandColor(m.symbol)} /></td>
          {changeCell(m.change24hPct)}
          <td className="r mkx-num"><Num value={m.quoteVolume24h}>{fmtMoney(m.quoteVolume24h)}</Num></td>
          <td className="r mkx-num mkx-oicell">{m.hasPerp ? <Num value={m.openInterestUsd}>{fmtMoney(m.openInterestUsd)}</Num> : <span className="mkx-dim">Spot Only</span>}</td>
          <td className={`r mkx-num mkx-fundcell ${finite(m.fundingRate) ? signClass(m.fundingRate) : ''}`}>{m.hasPerp && finite(m.fundingRate) ? <Num value={m.fundingRate}>{fmtFunding(m.fundingRate)}</Num> : <span className="mkx-dim">—</span>}</td>
        </>
      ),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, sortKey, sortDesc, feesPct]);

  const idxUp = (idx50 ?? 0) >= 0;

  return (
    <div className="container page mkx">
      {/* ---- Explore header ---- */}
      <header className="mkx-hero">
        <div className="mkx-hero-text">
          <h1>Explore crypto</h1>
          <p className="mkx-index">
            Binance 50 Index is {idx50 === null ? 'warming up' : idxUp ? 'up' : 'down'}
            {idx50 !== null && (
              <span className={`mkx-index-delta ${idxUp ? 'pos' : 'neg'}`}>
                <DiagArrow up={idxUp} /> {fmtPct(Math.abs(idx50), 2, false)}
              </span>
            )}
            {idx50 !== null && ' (24hrs)'}
            <span className="mkx-info" title="Volume-weighted 24h change across the 50 highest-volume Binance pairs tracked here. Computed live from Binance tickers.">
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden><circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="8" cy="4.9" r=".9" fill="currentColor" /></svg>
            </span>
          </p>
        </div>
        <label className="mkx-search">
          <IconSearch size={16} />
          <input placeholder="Search for an asset" value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
          {search && <button aria-label="Clear search" onClick={() => setSearch('')}>×</button>}
        </label>
      </header>

      {/* ---- Market stats ---- */}
      <section className="mkx-stats" aria-label="Market stats">
        <h2>Market Stats</h2>
        <p className="mkx-blurb">
          {markets.length
            ? `Across ${fmtCount(markets.length)} tracked Binance pairs, 24-hour turnover is ${fmtMoney(totalVol)}. ${gainers} assets are up and ${losers} are down over the last day.`
            : 'Waiting for the first Binance ticker snapshot.'}
          {' '}
          <button className="mkx-more-link" onClick={() => setMore((x) => !x)}>{more ? 'Show less' : 'Read more'}</button>
        </p>
        {more && (
          <p className="mkx-more">
            Every number on this page is computed live from Binance spot and futures tickers — nothing is estimated or cached beyond {prefs.refreshSec}s.
            Feed {live ? 'is live' : marketsError ? `error: ${marketsError}` : 'is reconnecting'} · prices updated {fmtAgeMs(marketAgeMs)} ·
            {' '}{fmtCount(byVol.filter((m) => m.hasPerp).length)} pairs carry an exact perp for basis work.
          </p>
        )}
        <div className="mkx-tiles">
          <div className="mkx-tile">
            <span className="mkx-tile-k">Bitcoin</span>
            <span className="mkx-tile-v">
              <b><Num value={btc?.spot}>{fmtPrice(btc?.spot)}</Num></b>
              {finite(btc?.change24hPct) && (
                <em className={(btc!.change24hPct ?? 0) >= 0 ? 'pos' : 'neg'}>
                  <DiagArrow up={(btc!.change24hPct ?? 0) >= 0} /> {fmtPct(Math.abs(btc!.change24hPct ?? 0), 2, false)}
                </em>
              )}
            </span>
            {btc?.spark && btc.spark.length > 1 && <DotSpark values={btc.spark} tone={(btc.change24hPct ?? 0) >= 0 ? 'up' : 'down'} id="btc" />}
          </div>
          <div className="mkx-tile">
            <span className="mkx-tile-k">Trade Volume</span>
            <span className="mkx-tile-v">
              <b><Num value={totalVol}>{fmtMoney(totalVol)}</Num></b>
              <em className="mkx-dim2">24h Quote</em>
            </span>
            {byVol.length > 0 && (
              <span className="mkx-volbars" aria-hidden>
                {byVol.slice(0, 12).map((m) => (
                  <i
                    key={m.symbol}
                    title={`${m.base} ${fmtMoney(m.quoteVolume24h)}`}
                    style={{
                      height: `${Math.max(8, ((m.quoteVolume24h ?? 0) / (byVol[0].quoteVolume24h ?? 1)) * 100)}%`,
                      background: brandColor(m.symbol),
                    }}
                  />
                ))}
              </span>
            )}
          </div>
          <div className="mkx-tile">
            <span className="mkx-tile-k">Gainers vs Losers</span>
            <span className="mkx-tile-v">
              <b>{withChange.length ? `${gainers} : ${losers}` : '—'}</b>
              {withChange.length > 0 && (
                <em className={gainers >= losers ? 'pos' : 'neg'}>
                  {Math.round((gainers / Math.max(1, withChange.length)) * 100)}% Advancing
                </em>
              )}
            </span>
            {withChange.length > 0 && (
              <span className="mkx-splitbar" aria-hidden>
                <i style={{ width: `${(gainers / Math.max(1, withChange.length)) * 100}%` }} />
              </span>
            )}
          </div>
          <div className="mkx-tile">
            <span className="mkx-tile-k">BTC Volume Share</span>
            <span className="mkx-tile-v">
              <b>{btcShare === null ? '—' : `${btcShare.toFixed(2)}%`}</b>
              {btcShare !== null && (
                <em className="mkx-dim2">Of All Pairs</em>
              )}
            </span>
            {btc?.spark && btc.spark.length > 1 && <DotSpark values={btc.spark} tone={(btc.change24hPct ?? 0) >= 0 ? 'up' : 'down'} id="dom" />}
          </div>
        </div>
      </section>

      {/* ---- Prices table ---- */}
      <section className="mkx-prices" aria-label="Market prices">
        <div className="mkx-prices-head">
          <h2>Market Prices <em>{fmtCount(markets.length)} Assets</em></h2>
          <span className={`mkx-live ${live ? 'on' : ''}`}>
            <i />
            {marketsError ? 'Feed Error' : live ? `Live · ${fmtLiveAge(marketAgeMs)}` : 'Reconnecting'}
          </span>
        </div>

        <div className="mkx-pills">
          <div className="mkx-pills-left">
            <PillSelect
              icon={<Globe />}
              value={filter}
              options={FILTERS.map((f) => ({ id: f.id, label: f.label }))}
              onChange={setFilter}
              ariaLabel="Asset filter"
            />
            <PillSelect
              value={view}
              options={VIEWS.map((v) => ({ id: v.id, label: v.label }))}
              onChange={applyView}
              ariaLabel="Table view"
            />
          </div>
          <div className="mkx-pills-right">
            <PillSelect
              value={String(pageSize)}
              options={[10, 25, 50, 100].map((n) => ({ id: String(n), label: `${n} Rows` }))}
              onChange={(n) => setPageSize(Number(n))}
              ariaLabel="Rows per page"
            />
            <MarketSourcePicker />
          </div>
        </div>

        <table className="mkx-table">
          <thead>
            <tr>
              <th className="mkx-starcol" />
              {th('Asset', 'base', 'l', 'mkx-assetcol')}
              {cols.head}
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => {
              const watched = watchlist.includes(m.symbol);
              return (
                <tr key={m.symbol} onClick={() => openDetail(m.symbol)}>
                  <td className="mkx-starcol"><Star on={watched} onClick={() => void toggleWatch(m.symbol)} /></td>
                  <td className="l mkx-asset">
                    <TokenIcon symbol={m.symbol} size={36} />
                    <span className="mkx-asset-name">
                      <b>{tokenName(m.base)}</b>
                      <em>{m.base}{m.hasPerp ? ' · perp' : ''}</em>
                    </span>
                  </td>
                  {cols.cells(m)}
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <EmptyState title="Nothing matches">
            {filter === 'watchlist' ? 'Star assets to build the watchlist.' : 'Use another filter or search term.'}
          </EmptyState>
        )}

        {pages > 1 && (
          <nav className="mkx-pager" aria-label="Pagination">
            <button className="mkx-page-nav" disabled={safePage === 0} onClick={() => setPageN(safePage - 1)} aria-label="Previous page">
              <svg viewBox="0 0 16 16" width="15" height="15"><path d="M10 3.5L5.5 8 10 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {pageList(safePage, pages).map((p, i) =>
              p === '…' ? (
                <span key={`e${i}`} className="mkx-page-ellipsis">…</span>
              ) : (
                <button key={p} className={`mkx-page ${safePage === p ? 'current' : ''}`} onClick={() => setPageN(p)}>
                  {(p + 1).toLocaleString('en-US')}
                </button>
              ),
            )}
            <button className="mkx-page-nav" disabled={safePage >= pages - 1} onClick={() => setPageN(safePage + 1)} aria-label="Next page">
              <svg viewBox="0 0 16 16" width="15" height="15"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </nav>
        )}
        <p className="mkx-rangeline">{visibleStart}-{visibleEnd} of {rows.length.toLocaleString('en-US')} assets</p>
      </section>
    </div>
  );
}

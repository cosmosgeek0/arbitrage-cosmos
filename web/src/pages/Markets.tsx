import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { TokenIcon, brandColor } from '../components/TokenIcon';
import { Num } from '../components/Num';
import { EmptyState, StatePill } from '../components/ui';
import { IconSearch } from '../components/Icons';
import { SparkArea, Sparkline } from '../components/Spark';
import { fmtPrice, fmtPct, fmtBasis, fmtMoney, fmtFunding, countdown, signClass } from '../format';
import { iconCoverage, onIcons, primeIcons } from '../lib/iconManifest';
import type { MarketRow } from '../types';
import './Markets.css';

type View = 'overview' | 'derivatives' | 'basis' | 'liquidity';
type Filter = 'all' | 'paired' | 'spotOnly' | 'watchlist' | 'movers' | 'basis' | 'funding' | 'openInterest' | 'liquidations' | 'spread' | 'signals';
type SortKey =
  | 'base'
  | 'spot'
  | 'change24hPct'
  | 'quoteVolume24h'
  | 'basisPct'
  | 'fundingRate'
  | 'fundingAnnualPct'
  | 'openInterestUsd'
  | 'openInterestChangePct'
  | 'oiToPerpVolume24h'
  | 'liquidations15mUsd'
  | 'executableBasisBestPct'
  | 'executableBasisLongSpotPct'
  | 'executableBasisShortSpotPct'
  | 'markIndexBasisPct'
  | 'perpChange24hPct'
  | 'perpVolume24h'
  | 'spotSpreadPct'
  | 'perpSpreadPct'
  | 'depth'
  | 'status';

interface SystemSnapshot {
  feeds: Record<string, string>;
  pairs: number;
  binance: {
    connected: boolean;
    keysPresent: boolean;
    lastSyncTs: number | null;
    lastError: string | null;
    userStream: string;
  };
  restLatencyMs: number | null;
  serverTimeDiffMs: number | null;
  usedWeight1m: number | null;
  usedWeightTs: number | null;
  lastScannerTickTs: number | null;
  dbOk: boolean;
  killSwitch: boolean;
  liveTradingEnabled: boolean;
}

const VIEWS: { id: View; label: string; sort: SortKey; desc: boolean; note: string }[] = [
  { id: 'overview', label: 'Overview', sort: 'quoteVolume24h', desc: true, note: 'Price, chart, volume, availability' },
  { id: 'derivatives', label: 'Derivatives', sort: 'openInterestUsd', desc: true, note: 'Open interest, funding, liquidations' },
  { id: 'basis', label: 'Basis', sort: 'executableBasisBestPct', desc: true, note: 'Bid/ask executable gaps' },
  { id: 'liquidity', label: 'Liquidity', sort: 'depth', desc: true, note: 'Top book, spread, range' },
];

const FILTERS: { id: Filter; label: string; view?: View; sort?: SortKey; desc?: boolean }[] = [
  { id: 'all', label: 'All assets', view: 'overview', sort: 'quoteVolume24h', desc: true },
  { id: 'paired', label: 'Spot + Perp', view: 'derivatives', sort: 'quoteVolume24h', desc: true },
  { id: 'spotOnly', label: 'Spot only', view: 'overview', sort: 'quoteVolume24h', desc: true },
  { id: 'watchlist', label: 'Watchlist', view: 'overview', sort: 'quoteVolume24h', desc: true },
  { id: 'movers', label: 'Movers', view: 'overview', sort: 'change24hPct', desc: true },
  { id: 'basis', label: 'Executable basis', view: 'basis', sort: 'executableBasisBestPct', desc: true },
  { id: 'funding', label: 'Funding', view: 'derivatives', sort: 'fundingRate', desc: true },
  { id: 'openInterest', label: 'Open interest', view: 'derivatives', sort: 'openInterestUsd', desc: true },
  { id: 'liquidations', label: 'Liquidations', view: 'derivatives', sort: 'liquidations15mUsd', desc: true },
  { id: 'spread', label: 'Wide spread', view: 'liquidity', sort: 'spotSpreadPct', desc: true },
  { id: 'signals', label: 'Scanner state', view: 'basis', sort: 'status', desc: true },
];

type ChipTone = 'ok' | 'warn' | 'bad' | 'idle';

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const absNum = (v: number | null | undefined) => (finite(v) ? Math.abs(v) : -1);
const statusRank = (status: MarketRow['status']) => (status === 'signal' ? 3 : status === 'watching' ? 2 : 1);
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function fmtCount(v: number): string {
  return Number.isFinite(v) ? compact.format(v) : '—';
}

function fmtAgeMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 1500) return 'now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

function fmtLatency(ms: number | null | undefined): string {
  if (!finite(ms)) return '—';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function fmtBps(v: number | null | undefined): string {
  if (!finite(v)) return '—';
  const bps = v * 100;
  const a = Math.abs(bps);
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  return `${bps.toFixed(digits)} bps`;
}

function fmtMultiple(v: number | null | undefined): string {
  if (!finite(v)) return '—';
  if (v >= 100) return `${v.toFixed(0)}x`;
  if (v >= 10) return `${v.toFixed(1)}x`;
  return `${v.toFixed(2)}x`;
}

function fmtSide(side: MarketRow['executableBasisSide']): string {
  if (side === 'LONG_SPOT_SHORT_PERP') return 'Buy spot / sell perp';
  if (side === 'SHORT_SPOT_LONG_PERP') return 'Sell spot / buy perp';
  return 'No executable side';
}

function netAfterFees(row: MarketRow, feesPct: number): number | null {
  if (!finite(row.executableBasisBestPct)) return null;
  return row.executableBasisBestPct - feesPct;
}

function depthUsd(row: MarketRow | null | undefined): number | null {
  if (!row) return null;
  if (row.hasPerp && finite(row.spotTopQuoteUsd) && finite(row.perpTopQuoteUsd)) return Math.min(row.spotTopQuoteUsd, row.perpTopQuoteUsd);
  return row.spotTopQuoteUsd ?? null;
}

function sourceTone(value: string | null | undefined): ChipTone {
  const v = String(value ?? '').toLowerCase();
  if (!v) return 'idle';
  if (v.includes('fresh') || v.includes('live') || v.includes('open') || v.includes('connected')) return 'ok';
  if (v.includes('stale') || v.includes('pending') || v.includes('lag')) return 'warn';
  if (v.includes('off') || v.includes('error') || v.includes('fail') || v.includes('closed')) return 'bad';
  return 'idle';
}

function sortValue(row: MarketRow, key: SortKey): number | string {
  switch (key) {
    case 'base':
      return row.base;
    case 'status':
      return statusRank(row.status);
    case 'depth':
      return depthUsd(row) ?? Number.NaN;
    case 'executableBasisBestPct':
      return row.executableBasisBestPct ?? Number.NaN;
    case 'executableBasisLongSpotPct':
      return row.executableBasisLongSpotPct ?? Number.NaN;
    case 'executableBasisShortSpotPct':
      return row.executableBasisShortSpotPct ?? Number.NaN;
    case 'fundingAnnualPct':
      return row.fundingAnnualPct ?? Number.NaN;
    case 'openInterestUsd':
      return row.openInterestUsd ?? Number.NaN;
    case 'openInterestChangePct':
      return row.openInterestChangePct ?? Number.NaN;
    case 'oiToPerpVolume24h':
      return row.oiToPerpVolume24h ?? Number.NaN;
    case 'liquidations15mUsd':
      return row.liquidations15mUsd ?? Number.NaN;
    case 'markIndexBasisPct':
      return row.markIndexBasisPct ?? Number.NaN;
    case 'perpChange24hPct':
      return row.perpChange24hPct ?? Number.NaN;
    case 'perpVolume24h':
      return row.perpVolume24h ?? Number.NaN;
    case 'spotSpreadPct':
      return row.spotSpreadPct ?? Number.NaN;
    case 'perpSpreadPct':
      return row.perpSpreadPct ?? Number.NaN;
    case 'basisPct':
      return absNum(row.basisPct);
    case 'spot':
      return row.spot ?? Number.NaN;
    case 'change24hPct':
      return row.change24hPct ?? Number.NaN;
    case 'quoteVolume24h':
      return row.quoteVolume24h ?? Number.NaN;
    case 'fundingRate':
      return row.fundingRate ?? Number.NaN;
  }
}

function DataChip({ tone = 'idle', children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className={`markets-v2-chip ${tone}`}>{children}</span>;
}

function StatCell({
  label,
  value,
  sub,
  spark,
  tone,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub: ReactNode;
  spark?: ReactNode;
  tone?: ChipTone;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="markets-v2-stat-label">{label}</span>
      <b>{value}</b>
      <em>{sub}</em>
      {spark && <span className="markets-v2-stat-spark">{spark}</span>}
    </>
  );
  return onClick ? (
    <button className={`markets-v2-stat ${tone ?? 'idle'}`} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={`markets-v2-stat ${tone ?? 'idle'}`}>
      {content}
    </div>
  );
}

function Star({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      className="markets-v2-star-btn"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={on ? 'Remove from watchlist' : 'Add to watchlist'}
    >
      <span className={`markets-v2-star ${on ? 'on' : ''}`}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </span>
    </button>
  );
}

function Availability({ row }: { row: MarketRow }) {
  if (row.hasSpot && row.hasPerp) return <DataChip tone="ok">Spot + Perp</DataChip>;
  if (row.hasPerp) return <DataChip tone="warn">Perp only</DataChip>;
  return <DataChip>Spot only</DataChip>;
}

export function Markets() {
  const { markets, marketsUpdatedAt, marketsError, connected, state, prefs, updatePref, openDetail, openTicket, toggleWatch, setPage } = useStore();
  const [view, setView] = useState<View>('basis');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('executableBasisBestPct');
  const [sortDesc, setSortDesc] = useState(true);
  const [pageN, setPageN] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [now, setNow] = useState(() => Date.now());
  const [system, setSystem] = useState<SystemSnapshot | null>(null);
  const [iconTick, setIconTick] = useState(0);

  const watchlist = state?.config.watchlist ?? [];
  const feesPct = state?.config.feesPct ?? 0;
  const iconBases = useMemo(() => [...new Set(markets.map((m) => m.base))], [markets]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    primeIcons(iconBases);
  }, [iconBases]);

  useEffect(() => onIcons(() => setIconTick((x) => x + 1)), []);

  useEffect(() => {
    let closed = false;
    const load = () => {
      fetch('/api/system')
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => {
          if (!closed && s) setSystem(s as SystemSnapshot);
        })
        .catch(() => undefined);
    };
    void load();
    const t = window.setInterval(load, 10_000);
    return () => {
      closed = true;
      window.clearInterval(t);
    };
  }, []);

  const rows = useMemo(() => {
    let r = markets;
    if (search.trim()) {
      const q = search.trim().toUpperCase();
      r = r.filter((m) => m.base.includes(q) || m.symbol.includes(q));
    }
    switch (filter) {
      case 'paired':
        r = r.filter((m) => m.hasSpot && m.hasPerp);
        break;
      case 'spotOnly':
        r = r.filter((m) => m.hasSpot && !m.hasPerp);
        break;
      case 'watchlist':
        r = r.filter((m) => watchlist.includes(m.symbol));
        break;
      case 'movers':
        r = r.filter((m) => finite(m.change24hPct) && (m.quoteVolume24h ?? 0) > 500_000);
        break;
      case 'basis':
        r = r.filter((m) => finite(m.executableBasisBestPct));
        break;
      case 'funding':
        r = r.filter((m) => m.hasPerp && finite(m.fundingRate));
        break;
      case 'openInterest':
        r = r.filter((m) => m.hasPerp && finite(m.openInterestUsd));
        break;
      case 'liquidations':
        r = r.filter((m) => m.hasPerp && finite(m.liquidations15mUsd));
        break;
      case 'spread':
        r = r.filter((m) => finite(m.spotSpreadPct) || finite(m.perpSpreadPct));
        break;
      case 'signals':
        r = r.filter((m) => m.status !== 'idle');
        break;
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
  }, [markets, filter, search, sortKey, sortDesc, watchlist, feesPct]);

  useEffect(() => setPageN(0), [filter, search, sortKey, sortDesc, pageSize, view]);

  const marketAgeMs = marketsUpdatedAt ? now - marketsUpdatedAt : null;
  const scannerTickTs = system?.lastScannerTickTs ?? state?.scanner.lastTickTs ?? null;
  const scannerAgeMs = scannerTickTs ? now - scannerTickTs : null;
  const streamFresh = connected && marketAgeMs !== null && marketAgeMs < Math.max(12_000, prefs.refreshSec * 2500);
  const scannerFresh = scannerAgeMs !== null && scannerAgeMs < 25_000;
  const systemTone: 'ok' | 'warn' | 'bad' = marketsError || !connected ? 'bad' : streamFresh && scannerFresh ? 'ok' : 'warn';
  const iconStats = useMemo(() => iconCoverage(iconBases), [iconBases, iconTick]);

  const pairedRows = markets.filter((m) => m.hasSpot && m.hasPerp);
  const perpRows = markets.filter((m) => m.hasPerp);
  const spotOnlyRows = markets.filter((m) => m.hasSpot && !m.hasPerp).length;
  const totalVol = markets.reduce((s, m) => s + (m.quoteVolume24h ?? 0), 0);
  const topVolume = [...markets].filter((m) => (m.quoteVolume24h ?? 0) > 0).sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0));
  const withChange = markets.filter((m) => finite(m.change24hPct));
  const gainers = withChange.filter((m) => (m.change24hPct ?? 0) > 0);
  const losers = withChange.filter((m) => (m.change24hPct ?? 0) < 0);
  const oiRows = perpRows.filter((m) => finite(m.openInterestUsd));
  const totalOpenInterest = oiRows.reduce((s, m) => s + (m.openInterestUsd ?? 0), 0);
  const oiLead = [...oiRows].sort((a, b) => (b.openInterestUsd ?? 0) - (a.openInterestUsd ?? 0))[0];
  const liqRows = perpRows.filter((m) => finite(m.liquidations15mUsd));
  const totalLiq15m = liqRows.reduce((s, m) => s + (m.liquidations15mUsd ?? 0), 0);
  const liqLead = [...liqRows].sort((a, b) => (b.liquidations15mUsd ?? 0) - (a.liquidations15mUsd ?? 0))[0];
  const spotBookReady = markets.some((m) => finite(m.spotBid) && finite(m.spotAsk));
  const perpBookReady = perpRows.some((m) => finite(m.perpBid) && finite(m.perpAsk));
  const perpTickerReady = perpRows.some((m) => finite(m.perpVolume24h));
  const oiReady = oiRows.length > 0;
  const markReady = perpRows.some((m) => finite(m.perpMark));
  const liqFeed = system?.feeds?.['futures-liquidations'] ?? state?.feeds?.['futures-liquidations'];
  const currentView = VIEWS.find((v) => v.id === view) ?? VIEWS[0];

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(pageN, pages - 1);
  const visible = rows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const pageStart = Math.max(0, Math.min(safePage - 3, pages - 7));
  const pageButtons = Array.from({ length: Math.min(pages, 7) }, (_, i) => pageStart + i);
  const visibleStart = rows.length ? safePage * pageSize + 1 : 0;
  const visibleEnd = safePage * pageSize + visible.length;

  const applyFilter = (next: Filter) => {
    const preset = FILTERS.find((f) => f.id === next);
    setFilter(next);
    if (preset?.view) setView(preset.view);
    if (preset?.sort) {
      setSortKey(preset.sort);
      setSortDesc(preset.desc ?? true);
    }
  };

  const applyView = (next: View) => {
    const preset = VIEWS.find((v) => v.id === next);
    setView(next);
    if (preset) {
      setSortKey(preset.sort);
      setSortDesc(preset.desc);
    }
  };

  const header = (label: string, key: SortKey, align: 'left' | 'right' = 'right') => (
    <th className={`${align === 'left' ? 'l' : ''} ${sortKey === key ? 'sorted' : ''}`} aria-sort={sortKey === key ? (sortDesc ? 'descending' : 'ascending') : 'none'}>
      <button
        className="markets-v2-sort"
        onClick={() => {
          if (sortKey === key) setSortDesc(!sortDesc);
          else {
            setSortKey(key);
            setSortDesc(key !== 'base');
          }
        }}
      >
        {label}
        <span>{sortKey === key ? (sortDesc ? '↓' : '↑') : '↕'}</span>
      </button>
    </th>
  );

  const columns = useMemo(() => {
    const pricePair = (m: MarketRow) => (
      <td className="markets-v2-strong">
        <Num value={m.spot}>{fmtPrice(m.spot)}</Num>
        <span className="markets-v2-sub">Last spot</span>
      </td>
    );

    if (view === 'derivatives') {
      return {
        headers: (
          <>
            {header('Perp mark', 'perpChange24hPct')}
            {header('Index basis', 'markIndexBasisPct')}
            {header('Funding', 'fundingRate')}
            {header('Open interest', 'openInterestUsd')}
            {header('OI / Vol', 'oiToPerpVolume24h')}
            {header('Liq 15m', 'liquidations15mUsd')}
            <th>Long / short liq</th>
            {header('Perp volume', 'perpVolume24h')}
          </>
        ),
        cells: (m: MarketRow) => (
          <>
            <td className="markets-v2-strong">
              <Num value={m.perpMark}>{fmtPrice(m.perpMark)}</Num>
              <span className={`markets-v2-sub ${signClass(m.perpChange24hPct)}`}>{m.hasPerp ? `${fmtPct(m.perpChange24hPct)} perp 24h` : 'No exact perp'}</span>
            </td>
            <td className={signClass(m.markIndexBasisPct)}>
              <Num value={m.markIndexBasisPct}>{fmtBasis(m.markIndexBasisPct)}</Num>
              <span className="markets-v2-sub">{finite(m.perpIndexPrice) ? `Index ${fmtPrice(m.perpIndexPrice)}` : 'Index pending'}</span>
            </td>
            <td className={signClass(m.fundingRate)}>
              <Num value={m.fundingRate}>{fmtFunding(m.fundingRate)}</Num>
              <span className="markets-v2-sub">Annual {fmtPct(m.fundingAnnualPct, 2)}</span>
            </td>
            <td className="markets-v2-strong">
              <Num value={m.openInterestUsd}>{fmtMoney(m.openInterestUsd)}</Num>
              <span className={`markets-v2-sub ${signClass(m.openInterestChangePct)}`}>{finite(m.openInterestChangePct) ? `${fmtPct(m.openInterestChangePct)} sampled` : 'Sampler warming'}</span>
            </td>
            <td>
              <Num value={m.oiToPerpVolume24h}>{fmtMultiple(m.oiToPerpVolume24h)}</Num>
              <span className="markets-v2-sub">OI / perp vol</span>
            </td>
            <td>
              <Num value={m.liquidations15mUsd}>{fmtMoney(m.liquidations15mUsd)}</Num>
              <span className="markets-v2-sub">Live stream window</span>
            </td>
            <td>
              <span className="markets-v2-cell-main">{fmtMoney(m.longLiquidations15mUsd)} / {fmtMoney(m.shortLiquidations15mUsd)}</span>
              <span className="markets-v2-sub">Long / short forced</span>
            </td>
            <td>
              <Num value={m.perpVolume24h}>{fmtMoney(m.perpVolume24h)}</Num>
              <span className="markets-v2-sub">Next funding {countdown(m.nextFundingTime)}</span>
            </td>
          </>
        ),
      };
    }

    if (view === 'basis') {
      return {
        headers: (
          <>
            {header('Best exec', 'executableBasisBestPct')}
            {header('Long spot', 'executableBasisLongSpotPct')}
            {header('Short spot', 'executableBasisShortSpotPct')}
            {header('Net', 'executableBasisBestPct')}
            {header('Funding', 'fundingRate')}
            <th>Direction</th>
            <th>Book</th>
          </>
        ),
        cells: (m: MarketRow) => {
          const net = netAfterFees(m, feesPct);
          return (
            <>
              <td className={signClass(m.executableBasisBestPct)}>
                <Num value={m.executableBasisBestPct}>{fmtBasis(m.executableBasisBestPct)}</Num>
                <span className="markets-v2-sub">Executable</span>
              </td>
              <td className={signClass(m.executableBasisLongSpotPct)}>
                <Num value={m.executableBasisLongSpotPct}>{fmtBasis(m.executableBasisLongSpotPct)}</Num>
                <span className="markets-v2-sub">Perp bid - spot ask</span>
              </td>
              <td className={signClass(m.executableBasisShortSpotPct)}>
                <Num value={m.executableBasisShortSpotPct}>{fmtBasis(m.executableBasisShortSpotPct)}</Num>
                <span className="markets-v2-sub">Spot bid - perp ask</span>
              </td>
              <td className={signClass(net)}>
                <Num value={net}>{fmtBasis(net)}</Num>
                <span className="markets-v2-sub">After {fmtPct(feesPct, 3, false)} fees</span>
              </td>
              <td className={signClass(m.fundingRate)}>
                <Num value={m.fundingRate}>{fmtFunding(m.fundingRate)}</Num>
                <span className="markets-v2-sub">Next {countdown(m.nextFundingTime)}</span>
              </td>
              <td>
                <span className="markets-v2-cell-main">{fmtSide(m.executableBasisSide)}</span>
                <span className="markets-v2-sub">{finite(m.basisPct) ? `Mark ${fmtBasis(m.basisPct)}` : m.hasPerp ? 'Mark pending' : 'Spot only'}</span>
              </td>
              <td>
                <span className="markets-v2-cell-main">{finite(depthUsd(m)) ? fmtMoney(depthUsd(m)) : '—'}</span>
                <span className="markets-v2-sub">Top-book min</span>
              </td>
            </>
          );
        },
      };
    }

    if (view === 'liquidity') {
      return {
        headers: (
          <>
            {header('Spot spread', 'spotSpreadPct')}
            {header('Perp spread', 'perpSpreadPct')}
            {header('Top depth', 'depth')}
            {header('Volume', 'quoteVolume24h')}
            <th>24h range</th>
            {header('24h', 'change24hPct')}
            <th>Venue</th>
          </>
        ),
        cells: (m: MarketRow) => (
          <>
            <td>
              <Num value={m.spotSpreadPct}>{fmtBps(m.spotSpreadPct)}</Num>
              <span className="markets-v2-sub">{finite(m.spotBid) ? `${fmtPrice(m.spotBid)} / ${fmtPrice(m.spotAsk)}` : 'No spot book'}</span>
            </td>
            <td>
              <Num value={m.perpSpreadPct}>{fmtBps(m.perpSpreadPct)}</Num>
              <span className="markets-v2-sub">{m.hasPerp ? 'USD-M top book' : 'Spot only'}</span>
            </td>
            <td className="markets-v2-strong">
              <Num value={depthUsd(m)}>{fmtMoney(depthUsd(m))}</Num>
              <span className="markets-v2-sub">{m.hasPerp ? 'Min spot/perp' : 'Spot top book'}</span>
            </td>
            <td>
              <Num value={m.quoteVolume24h}>{fmtMoney(m.quoteVolume24h)}</Num>
              <span className="markets-v2-sub">{m.hasPerp ? `Perp ${fmtMoney(m.perpVolume24h)}` : '24h spot quote'}</span>
            </td>
            <td>
              <span className="markets-v2-cell-main">{finite(m.low24h) && finite(m.high24h) ? `${fmtPrice(m.low24h)} / ${fmtPrice(m.high24h)}` : '—'}</span>
              <span className="markets-v2-sub">Low / high</span>
            </td>
            <td className={signClass(m.change24hPct)}>
              <Num value={m.change24hPct}>{fmtPct(m.change24hPct)}</Num>
              <span className="markets-v2-sub">Spot move</span>
            </td>
            <td><Availability row={m} /></td>
          </>
        ),
      };
    }

    return {
      headers: (
        <>
          {header('Price', 'spot')}
          <th>Chart</th>
          {header('24h', 'change24hPct')}
          {header('Volume', 'quoteVolume24h')}
          {header('Basis', 'basisPct')}
          {header('Funding', 'fundingRate')}
          <th>Venue</th>
        </>
      ),
      cells: (m: MarketRow) => (
        <>
          {pricePair(m)}
          <td>
            <span className="markets-v2-spark">
              <Sparkline values={m.spark} color={brandColor(m.symbol)} />
            </span>
          </td>
          <td className={signClass(m.change24hPct)}>
            <Num value={m.change24hPct}>{fmtPct(m.change24hPct)}</Num>
            <span className="markets-v2-sub">Spot 24h</span>
          </td>
          <td>
            <Num value={m.quoteVolume24h}>{fmtMoney(m.quoteVolume24h)}</Num>
            <span className="markets-v2-sub">Quote volume</span>
          </td>
          <td className={signClass(m.basisPct)}>
            <Num value={m.basisPct}>{fmtBasis(m.basisPct)}</Num>
            <span className="markets-v2-sub">Mark vs spot</span>
          </td>
          <td className={signClass(m.fundingRate)}>
            <Num value={m.fundingRate}>{fmtFunding(m.fundingRate)}</Num>
            <span className="markets-v2-sub">{m.hasPerp ? `Next ${countdown(m.nextFundingTime)}` : 'No perp'}</span>
          </td>
          <td><Availability row={m} /></td>
        </>
      ),
    };
  }, [view, sortKey, sortDesc, feesPct, now]);

  const sourceChips = [
    { label: 'Spot', value: spotBookReady && streamFresh ? 'stream/book' : spotBookReady ? 'book' : streamFresh ? 'stream' : connected ? 'stale' : 'offline', tone: spotBookReady && streamFresh ? 'ok' : connected ? 'warn' : 'bad' },
    { label: 'Perps', value: markReady && perpBookReady && perpTickerReady ? 'mark/book/24h' : 'warming', tone: markReady && perpBookReady && perpTickerReady ? 'ok' : 'warn' },
    { label: 'OI', value: oiReady ? `${oiRows.length}/${perpRows.length}` : 'warming', tone: oiReady ? 'ok' : 'idle' },
    { label: 'Liquidations', value: liqFeed === 'open' ? 'stream' : liqFeed ?? 'pending', tone: sourceTone(liqFeed) },
    { label: 'Scanner', value: scannerAgeMs === null ? 'pending' : fmtAgeMs(scannerAgeMs), tone: scannerFresh ? 'ok' : scannerAgeMs === null ? 'idle' : 'warn' },
  ] as const;

  return (
    <div className="container page markets-page markets-pro">
      <section className="markets-v2-hero">
        <div className="markets-v2-title">
          <span className="markets-v2-eyebrow">Binance execution universe</span>
          <h1>Markets</h1>
          <p>
            {fmtCount(markets.length)} Binance USDT assets · {fmtCount(pairedRows.length)} exact spot+perp pairs · {fmtCount(spotOnlyRows)} spot-only names.
          </p>
        </div>
        <div className="markets-v2-search">
          <IconSearch size={16} />
          <input placeholder="Search BTC, ETH, DOGE..." value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
          {search && (
            <button aria-label="Clear search" title="Clear search" onClick={() => setSearch('')}>
              ×
            </button>
          )}
        </div>
        <div className="markets-v2-live">
          <StatePill tone={systemTone}>{systemTone === 'ok' ? 'Market live' : systemTone === 'bad' ? 'Market offline' : 'Feed check'}</StatePill>
          <span>{marketsError || `Updated ${fmtAgeMs(marketAgeMs)}`}</span>
        </div>
      </section>

      <section className="markets-v2-sources" aria-label="Market data sources">
        <div>
          <b>Data</b>
          <span>Binance spot stream/book, USD-M mark/funding/book/24h, open-interest sampler, and liquidation stream. Logos stay display-only.</span>
        </div>
        <div className="markets-v2-source-list">
          {sourceChips.map((chip) => (
            <span key={chip.label} className={`markets-v2-source ${chip.tone}`}>
              <span>{chip.label}</span>
              <b>{chip.value}</b>
            </span>
          ))}
        </div>
      </section>

      <section className="markets-v2-market-stats" aria-label="Market stats">
        <div className="markets-v2-section-title">
          <h2>Market stats</h2>
          <p>Live Binance spot and USD-M derivatives coverage for the account universe.</p>
        </div>
        <div className="markets-v2-stats">
          <StatCell
            label="Tracked assets"
            value={fmtCount(markets.length)}
            sub={`${fmtCount(pairedRows.length)} spot+perp · ${fmtCount(spotOnlyRows)} spot-only`}
            tone={markets.length ? 'ok' : 'idle'}
            onClick={() => applyFilter('all')}
          />
          <StatCell
            label="24h quote volume"
            value={<Num value={totalVol}>{fmtMoney(totalVol)}</Num>}
            sub={topVolume[0] ? `${topVolume[0].base} leads at ${fmtMoney(topVolume[0].quoteVolume24h)}` : 'Waiting for feed'}
            spark={topVolume[0]?.spark?.length ? <SparkArea values={topVolume[0].spark} color={brandColor(topVolume[0].symbol)} dots /> : undefined}
            onClick={() => applyFilter('all')}
          />
          <StatCell
            label="Open interest"
            value={<Num value={totalOpenInterest}>{fmtMoney(totalOpenInterest || null)}</Num>}
            sub={oiLead ? `${oiLead.base} leads at ${fmtMoney(oiLead.openInterestUsd)}` : 'Sampler warming'}
            tone={oiLead ? 'ok' : 'idle'}
            onClick={() => applyFilter('openInterest')}
          />
          <StatCell
            label="Liquidations 15m"
            value={<Num value={totalLiq15m || null}>{fmtMoney(totalLiq15m || null)}</Num>}
            sub={liqLead ? `${liqLead.base} · long ${fmtMoney(liqLead.longLiquidations15mUsd)} / short ${fmtMoney(liqLead.shortLiquidations15mUsd)}` : 'No stream prints yet'}
            tone={liqLead ? 'warn' : 'idle'}
            onClick={() => applyFilter('liquidations')}
          />
        </div>
      </section>

      <section className="markets-v2-toolbar">
        <div className="markets-v2-tabs" role="tablist" aria-label="Market views">
          {VIEWS.map((v) => (
            <button key={v.id} className={view === v.id ? 'active' : ''} onClick={() => applyView(v.id)} title={v.note}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="markets-v2-filters" aria-label="Market filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => applyFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="markets-v2-tools">
          <span>{visibleStart}-{visibleEnd} of {rows.length}</span>
          <span className="markets-v2-refresh">
            Update
            {[3, 6, 10].map((sec) => (
              <button key={sec} className={prefs.refreshSec === sec ? 'active' : ''} onClick={() => updatePref('refreshSec', sec)}>
                {sec}s
              </button>
            ))}
          </span>
        </div>
      </section>

      <section className="markets-v2-table-shell">
        <div className="markets-v2-table-head">
          <div>
            <h2>{currentView.label}</h2>
            <span>{currentView.note} · sorted by {sortKey} {sortDesc ? 'high to low' : 'low to high'}</span>
          </div>
          <div>
            <StatePill tone={state?.config.killSwitch ? 'bad' : state?.config.liveTradingEnabled ? 'ok' : 'warn'}>
              {state?.config.killSwitch ? 'Halted' : state?.config.liveTradingEnabled ? 'Live armed' : 'Read-only'}
            </StatePill>
          </div>
        </div>

        <div className="markets-v2-table-scroll">
          <table className="markets-v2-table">
            <thead>
              <tr>
                <th className="markets-v2-star-col" />
                {header('Asset', 'base', 'left')}
                {columns.headers}
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => {
                const watched = watchlist.includes(m.symbol);
                return (
                  <tr key={m.symbol} onClick={() => openDetail(m.symbol)}>
                    <td className="l">
                      <Star on={watched} onClick={() => void toggleWatch(m.symbol)} />
                    </td>
                    <td className="l markets-v2-asset-cell">
                      <span className="markets-v2-token">
                        <TokenIcon symbol={m.symbol} size={30} />
                        <span>
                          <b>{m.base}</b>
                          <em>{m.symbol}</em>
                          {watched && (
                            <span className="markets-v2-asset-flags">
                              <DataChip tone="warn">Watch</DataChip>
                            </span>
                          )}
                        </span>
                      </span>
                    </td>
                    {columns.cells(m)}
                    <td className="markets-v2-actions">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetail(m.symbol);
                        }}
                      >
                        Details
                      </button>
                      <button
                        className="primary"
                        disabled={!finite(m.spot)}
                        title={finite(m.spot) ? 'Open manual trade ticket' : 'No spot price available'}
                        onClick={(e) => {
                          e.stopPropagation();
                          openTicket({ symbol: m.symbol, side: 'BUY', source: 'manual' });
                        }}
                      >
                        Ticket
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <EmptyState title="Nothing matches">
            {filter === 'watchlist' ? 'Star assets to build the watchlist.' : 'Use another filter or search term.'}
          </EmptyState>
        )}

        <div className="markets-v2-foot">
          <span>Rows {visibleStart}-{visibleEnd} · logos {iconStats.resolved}/{iconStats.total}</span>
          <span className="markets-v2-row-size">
            Rows
            {[25, 50, 100, 200].map((n) => (
              <button key={n} className={pageSize === n ? 'active' : ''} onClick={() => setPageSize(n)}>
                {n}
              </button>
            ))}
          </span>
          <span className="markets-v2-pager">
            <button disabled={safePage === 0} onClick={() => setPageN(safePage - 1)}>‹</button>
            {pageButtons.map((p) => (
              <button key={p} className={safePage === p ? 'current' : ''} onClick={() => setPageN(p)}>{p + 1}</button>
            ))}
            <button disabled={safePage >= pages - 1} onClick={() => setPageN(safePage + 1)}>›</button>
          </span>
        </div>
      </section>

      <section className="markets-v2-bottom">
        <div>
          <h3>Session read</h3>
          <p>
            {gainers.length} gainers and {losers.length} losers across assets with 24h data. Scanner pairs: {system?.pairs ?? state?.scanner.pairs ?? perpRows.length}.
          </p>
        </div>
        <button onClick={() => setPage('system')}>System health</button>
        <button onClick={() => setPage('risk')}>Risk controls</button>
      </section>
    </div>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { TokenIcon } from '../components/TokenIcon';
import { Num } from '../components/Num';
import { EmptyState, StatePill } from '../components/ui';
import { IconSearch } from '../components/Icons';
import { fmtPrice, fmtPct, fmtBasis, fmtMoney, fmtFunding, countdown, signClass } from '../format';
import { iconCoverage, onIcons, primeIcons } from '../lib/iconManifest';
import type { MarketRow } from '../types';

type SortKey = 'base' | 'quoteVolume24h' | 'spot' | 'change24hPct' | 'basisPct' | 'fundingRate' | 'status';
type Filter = 'all' | 'watchlist' | 'gainers' | 'losers' | 'basis' | 'funding' | 'volume' | 'signals';

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

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All assets' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'gainers', label: 'Gainers' },
  { id: 'losers', label: 'Losers' },
  { id: 'basis', label: 'Widest basis' },
  { id: 'funding', label: 'Funding' },
  { id: 'volume', label: 'High volume' },
  { id: 'signals', label: 'Signals' },
];

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const absNum = (v: number | null | undefined) => (finite(v) ? Math.abs(v) : -1);
const statusRank = (status: MarketRow['status']) => (status === 'signal' ? 3 : status === 'watching' ? 2 : 1);
type ChipTone = 'ok' | 'warn' | 'bad' | 'idle';

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

function feedTone(value: string | null | undefined): ChipTone {
  const v = String(value ?? '').toLowerCase();
  if (!v) return 'idle';
  if (v.includes('stale') || v.includes('lag') || v.includes('pending')) return 'warn';
  if (v.includes('off') || v.includes('closed') || v.includes('error') || v.includes('fail')) return 'bad';
  if (v.includes('open') || v.includes('live') || v.includes('fresh') || v.includes('connected')) return 'ok';
  return 'idle';
}

function DataChip({ tone = 'idle', children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className={`market-data-chip ${tone}`}>{children}</span>;
}

function sortValue(m: MarketRow, key: SortKey): number | string {
  if (key === 'base') return m.base;
  if (key === 'status') return statusRank(m.status);
  if (key === 'basisPct') return absNum(m.basisPct);
  const v = m[key];
  return finite(v) ? v : Number.NaN;
}

function Star({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      className="star-btn"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={on ? 'Remove from watchlist' : 'Add to watchlist'}
    >
      <span className={`star ${on ? 'on' : ''}`}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </span>
    </button>
  );
}

function MarketRailRow({
  m,
  metric,
  sub,
  onClick,
}: {
  m: MarketRow;
  metric: ReactNode;
  sub?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="market-rail-row" onClick={onClick}>
      <span className="tok">
        <TokenIcon symbol={m.symbol} size={26} />
        <span className="tok-meta">
          <span className="tok-name">{m.base}</span>
          <span className="tok-sub">{sub ?? m.symbol}</span>
        </span>
      </span>
      <span className="market-rail-metric num">{metric}</span>
    </button>
  );
}

export function Markets() {
  const { markets, marketsUpdatedAt, marketsError, connected, state, prefs, updatePref, openDetail, openTicket, toggleWatch, setPage } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('quoteVolume24h');
  const [sortDesc, setSortDesc] = useState(true);
  const [pageN, setPageN] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [now, setNow] = useState(() => Date.now());
  const [system, setSystem] = useState<SystemSnapshot | null>(null);
  const [iconTick, setIconTick] = useState(0);

  const watchlist = state?.config.watchlist ?? [];
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
    if (search) {
      const q = search.toUpperCase();
      r = r.filter((m) => m.base.includes(q) || m.symbol.includes(q));
    }
    switch (filter) {
      case 'watchlist':
        r = r.filter((m) => watchlist.includes(m.symbol));
        break;
      case 'gainers':
        r = r.filter((m) => (m.change24hPct ?? 0) > 0);
        break;
      case 'losers':
        r = r.filter((m) => (m.change24hPct ?? 0) < 0);
        break;
      case 'basis':
        r = r.filter((m) => finite(m.basisPct));
        break;
      case 'funding':
        r = r.filter((m) => m.hasPerp && finite(m.fundingRate));
        break;
      case 'volume':
        r = r.filter((m) => (m.quoteVolume24h ?? 0) > 0);
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
  }, [markets, filter, search, sortKey, sortDesc, watchlist]);

  useEffect(() => setPageN(0), [filter, search, pageSize, sortKey, sortDesc]);

  const totalVol = markets.reduce((s, m) => s + (m.quoteVolume24h ?? 0), 0);
  const btc = markets.find((m) => m.symbol === 'BTCUSDT');
  const liquid = markets.filter((m) => m.basisPct !== null && (m.quoteVolume24h ?? 0) >= 3_000_000);
  const avgBasis = liquid.length ? liquid.reduce((s, m) => s + Math.abs(m.basisPct!), 0) / liquid.length : 0;
  const widest = [...liquid].sort((a, b) => absNum(b.basisPct) - absNum(a.basisPct))[0];
  const withChange = markets.filter((m) => finite(m.change24hPct));
  const gainers = withChange.filter((m) => (m.change24hPct ?? 0) > 0);
  const losers = withChange.filter((m) => (m.change24hPct ?? 0) < 0);
  const perpRows = markets.filter((m) => m.hasPerp);
  const fundingRows = [...perpRows].filter((m) => finite(m.fundingRate)).sort((a, b) => absNum(b.fundingRate) - absNum(a.fundingRate));
  const avgFunding = fundingRows.length ? fundingRows.reduce((s, m) => s + (m.fundingRate ?? 0), 0) / fundingRows.length : null;
  const basisRows = [...liquid].sort((a, b) => absNum(b.basisPct) - absNum(a.basisPct)).slice(0, 8);
  const topVolume = [...markets].filter((m) => (m.quoteVolume24h ?? 0) > 0).sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0));
  const topGainers = [...withChange].sort((a, b) => (b.change24hPct ?? -999) - (a.change24hPct ?? -999));
  const topLosers = [...withChange].sort((a, b) => (a.change24hPct ?? 999) - (b.change24hPct ?? 999));
  const signalRows = markets.filter((m) => m.status !== 'idle');
  const movers = [...markets]
    .filter((m) => (m.quoteVolume24h ?? 0) >= 3_000_000 && m.change24hPct !== null)
    .sort((a, b) => Math.abs(b.change24hPct!) - Math.abs(a.change24hPct!))
    .slice(0, 5);

  const summaryCards = [
    {
      title: 'Top volume',
      note: topVolume[0]?.symbol ?? 'waiting',
      value: fmtMoney(topVolume[0]?.quoteVolume24h),
      rows: topVolume.slice(0, 3),
      metric: (m: MarketRow) => fmtMoney(m.quoteVolume24h),
      cls: '',
      filter: 'volume' as Filter,
    },
    {
      title: 'Top gainers',
      note: topGainers[0]?.symbol ?? 'waiting',
      value: fmtPct(topGainers[0]?.change24hPct),
      rows: topGainers.filter((m) => (m.quoteVolume24h ?? 0) >= 1_000_000).slice(0, 3),
      metric: (m: MarketRow) => fmtPct(m.change24hPct),
      cls: 'up',
      filter: 'gainers' as Filter,
    },
    {
      title: 'Top losers',
      note: topLosers[0]?.symbol ?? 'waiting',
      value: fmtPct(topLosers[0]?.change24hPct),
      rows: topLosers.filter((m) => (m.quoteVolume24h ?? 0) >= 1_000_000).slice(0, 3),
      metric: (m: MarketRow) => fmtPct(m.change24hPct),
      cls: 'down',
      filter: 'losers' as Filter,
    },
    {
      title: 'Basis watch',
      note: widest?.symbol ?? 'waiting',
      value: widest ? fmtBasis(widest.basisPct, 2) : '—',
      rows: basisRows.slice(0, 3),
      metric: (m: MarketRow) => fmtBasis(m.basisPct),
      cls: '',
      filter: 'basis' as Filter,
    },
    {
      title: 'Funding watch',
      note: fundingRows[0]?.symbol ?? 'waiting',
      value: fmtFunding(fundingRows[0]?.fundingRate),
      rows: fundingRows.slice(0, 3),
      metric: (m: MarketRow) => fmtFunding(m.fundingRate),
      cls: '',
      filter: 'funding' as Filter,
    },
  ];

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visible = rows.slice(pageN * pageSize, (pageN + 1) * pageSize);
  const pageStart = Math.max(0, Math.min(pageN - 3, pages - 7));
  const pageButtons = Array.from({ length: Math.min(pages, 7) }, (_, i) => pageStart + i);
  const marketTone = withChange.length ? (gainers.length / withChange.length) * 100 : null;
  const scanner = state?.scanner;
  const killOn = !!state?.config.killSwitch;
  const liveOn = !!state?.config.liveTradingEnabled;
  const marketAgeMs = marketsUpdatedAt ? now - marketsUpdatedAt : null;
  const scannerTickTs = system?.lastScannerTickTs ?? scanner?.lastTickTs ?? null;
  const scannerAgeMs = scannerTickTs ? now - scannerTickTs : null;
  const iconStats = useMemo(() => iconCoverage(iconBases), [iconBases, iconTick]);
  const streamFresh = connected && marketAgeMs !== null && marketAgeMs < Math.max(12_000, prefs.refreshSec * 2500);
  const scannerFresh = scannerAgeMs !== null && scannerAgeMs < 25_000;
  const systemTone: 'ok' | 'warn' | 'bad' = marketsError || !connected ? 'bad' : streamFresh && scannerFresh ? 'ok' : 'warn';
  const feedEntries = Object.entries(system?.feeds ?? state?.feeds ?? {}).slice(0, 4);
  const feedChips = [
    { label: 'Market stream', value: !connected ? 'offline' : streamFresh ? 'fresh' : 'stale', tone: !connected ? 'bad' : streamFresh ? 'ok' : 'warn' },
    { label: 'Scanner', value: scannerAgeMs === null ? 'pending' : fmtAgeMs(scannerAgeMs), tone: scannerFresh ? 'ok' : scannerAgeMs === null ? 'idle' : 'warn' },
    { label: 'REST', value: fmtLatency(system?.restLatencyMs), tone: finite(system?.restLatencyMs) && (system?.restLatencyMs ?? 9999) < 900 ? 'ok' : 'warn' },
    ...feedEntries.map(([label, value]) => ({ label, value, tone: feedTone(value) })),
  ].slice(0, 6);
  const visibleStart = rows.length ? pageN * pageSize + 1 : 0;
  const visibleEnd = pageN * pageSize + visible.length;

  const applyPreset = (nextFilter: Filter) => {
    setFilter(nextFilter);
    if (nextFilter === 'gainers') {
      setSortKey('change24hPct');
      setSortDesc(true);
    } else if (nextFilter === 'losers') {
      setSortKey('change24hPct');
      setSortDesc(false);
    } else if (nextFilter === 'basis') {
      setSortKey('basisPct');
      setSortDesc(true);
    } else if (nextFilter === 'funding') {
      setSortKey('fundingRate');
      setSortDesc(true);
    } else if (nextFilter === 'signals') {
      setSortKey('status');
      setSortDesc(true);
    } else {
      setSortKey('quoteVolume24h');
      setSortDesc(true);
    }
  };

  const header = (label: string, key: SortKey, align: 'left' | 'right' = 'right', extra = '') => (
    <th
      className={`${extra} ${align === 'left' ? 'l' : ''} sortable ${sortKey === key ? 'sorted' : ''}`}
      aria-sort={sortKey === key ? (sortDesc ? 'descending' : 'ascending') : 'none'}
    >
      <button
        className="sort-btn"
        onClick={() => {
          if (sortKey === key) setSortDesc(!sortDesc);
          else {
            setSortKey(key);
            setSortDesc(key !== 'base');
          }
        }}
      >
        {label}
        <span className="sort-caret">{sortKey === key ? (sortDesc ? '↓' : '↑') : '↕'}</span>
      </button>
    </th>
  );

  return (
    <div className="container page markets-page">
      <div className="markets-hero">
        <div>
          <h1 className="page-title">Markets</h1>
          <div className="page-sub">
            Binance execution universe · {markets.length} USDT symbols · {perpRows.length} perps · rows are ordered for manual trade triage.
          </div>
        </div>
        <div className="market-hero-status">
          <StatePill tone={systemTone}>{systemTone === 'ok' ? 'market live' : systemTone === 'bad' ? 'market offline' : 'feed check'}</StatePill>
          <span>{visibleStart}-{visibleEnd} of {rows.length}</span>
        </div>
      </div>

      <div className="market-source-strip">
        <div className="market-source-main">
          <span className={`dot ${systemTone === 'ok' ? 'dot-live' : systemTone === 'bad' ? 'dot-off' : 'dot-stale'}`} />
          <b>Binance market data</b>
          <span>{fmtAgeMs(marketAgeMs)} · {marketsError || `${fmtMoney(totalVol)} tracked 24h volume`}</span>
        </div>
        <div className="market-source-chips">
          {feedChips.map((chip) => (
            <span key={`${chip.label}-${chip.value}`} className={`feed-chip ${chip.tone}`}>
              <span>{chip.label}</span>
              <b>{chip.value}</b>
            </span>
          ))}
          <span className="refresh-rate">
            Update
            {[3, 6, 10].map((sec) => (
              <button key={sec} className={prefs.refreshSec === sec ? 'active' : ''} onClick={() => updatePref('refreshSec', sec)}>
                {sec}s
              </button>
            ))}
          </span>
        </div>
      </div>

      <div className="market-summary-strip">
        <button className="market-summary-item btc" onClick={() => openDetail('BTCUSDT')}>
          <span>Bitcoin</span>
          <b><Num value={btc?.spot ?? null}>{fmtPrice(btc?.spot)}</Num></b>
          <em className={signClass(btc?.change24hPct)}>{fmtPct(btc?.change24hPct)}</em>
        </button>
        <div className="market-summary-item">
          <span>Market tone</span>
          <b>{marketTone === null ? '—' : `${Math.round(marketTone)}% up`}</b>
          <em>{gainers.length} gainers · {losers.length} losers</em>
        </div>
        <div className="market-summary-item">
          <span>Avg |basis|</span>
          <b>{avgBasis.toFixed(3)}%</b>
          <em>{liquid.length} liquid pairs</em>
        </div>
        {summaryCards.slice(0, 4).map((card) => (
          <button key={card.title} className={`market-summary-item ${card.cls}`} onClick={() => applyPreset(card.filter)}>
            <span>{card.title}</span>
            <b>{card.value}</b>
            <em>{card.note}</em>
          </button>
        ))}
      </div>

      <div className="markets-layout">
        <main className="market-table-card">
          <div className="sec-head market-table-head">
            <div>
              <h2 className="sec-title">Market list</h2>
              <span className="sec-note">
                {rows.length} assets · sorted by {sortKey === 'quoteVolume24h' ? 'volume' : sortKey} {sortDesc ? 'high to low' : 'low to high'} · updated {fmtAgeMs(marketAgeMs)}
              </span>
            </div>
            <div className="market-health">
              <StatePill tone={killOn ? 'bad' : liveOn ? 'ok' : 'warn'}>
                {killOn ? 'halted' : liveOn ? 'armed' : 'read-only'}
              </StatePill>
              <StatePill tone={streamFresh ? 'ok' : 'warn'}>
                {streamFresh ? 'fresh' : 'stale'}
              </StatePill>
            </div>
          </div>
          <div className="table-tools">
            <div className="chips">
              {FILTERS.map((f) => (
                <button key={f.id} className={`chip ${filter === f.id ? 'active' : ''}`} onClick={() => applyPreset(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="spacer" />
            <div className="tsearch">
              <IconSearch size={13} />
              <input placeholder="Search asset" value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
              {search && (
                <button className="search-clear" aria-label="Clear market search" title="Clear market search" onClick={() => setSearch('')}>
                  ×
                </button>
              )}
            </div>
          </div>

          <div className="table-scroll">
            <table className="mkt">
              <thead>
                <tr>
                  <th className="w-star" />
                  {header('Asset', 'base', 'left')}
                  {header('Price', 'spot')}
                  {header('24h', 'change24hPct')}
                  {header('Basis', 'basisPct')}
                  {header('Funding', 'fundingRate')}
                  {header('Volume', 'quoteVolume24h')}
                  {header('State', 'status', 'right', 'col-hide-xs')}
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => (
                  <tr key={m.symbol} className="rowlink" onClick={() => openDetail(m.symbol)}>
                    <td className="l">
                      <Star on={watchlist.includes(m.symbol)} onClick={() => void toggleWatch(m.symbol)} />
                    </td>
                    <td className="l">
                      <span className="tok">
                        <TokenIcon symbol={m.symbol} size={30} />
                        <span className="tok-meta">
                          <span className="tok-name">{m.base}</span>
                          <span className="tok-sub">
                            {m.symbol}
                          </span>
                          <span className="asset-flags">
                            {m.hasPerp ? <DataChip tone="ok">perp</DataChip> : <DataChip>spot</DataChip>}
                            {watchlist.includes(m.symbol) && <DataChip tone="warn">watch</DataChip>}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="val-strong price-cell">
                      <Num value={m.spot}>{fmtPrice(m.spot)}</Num>
                      <span className="cell-sub">{finite(m.perpMark) ? `mark ${fmtPrice(m.perpMark)}` : 'spot last'}</span>
                    </td>
                    <td className={`change-cell ${signClass(m.change24hPct)}`}>
                      <Num value={m.change24hPct}>{fmtPct(m.change24hPct)}</Num>
                      <span className="cell-sub">
                        {finite(m.low24h) && finite(m.high24h) ? `${fmtPrice(m.low24h)} / ${fmtPrice(m.high24h)}` : '24h change'}
                      </span>
                    </td>
                    <td className={`basis-cell ${signClass(m.basisPct)}`}>
                      {finite(m.basisPct) ? (
                        <>
                          <Num value={m.basisPct}>{fmtBasis(m.basisPct)}</Num>
                          <span className="cell-sub">spot vs mark</span>
                        </>
                      ) : (
                        <DataChip>spot only</DataChip>
                      )}
                    </td>
                    <td className={`funding-cell col-hide-xs ${signClass(m.fundingRate)}`}>
                      {finite(m.fundingRate) ? (
                        <>
                          <Num value={m.fundingRate}>{fmtFunding(m.fundingRate)}</Num>
                          <span className="cell-sub">next {countdown(m.nextFundingTime)}</span>
                        </>
                      ) : (
                        <DataChip>no perp</DataChip>
                      )}
                    </td>
                    <td className="volume-cell">
                      <Num value={m.quoteVolume24h}>{fmtMoney(m.quoteVolume24h)}</Num>
                      <span className="cell-sub">24h quote</span>
                    </td>
                    <td className="col-hide-xs">
                      {m.status === 'signal' ? (
                        <span className="chip-tag gold">SIGNAL</span>
                      ) : m.status === 'watching' ? (
                        <span className="chip-tag">watching</span>
                      ) : (
                        <DataChip>quiet</DataChip>
                      )}
                    </td>
                    <td>
                      <span className="row-actions">
                        <button
                          className="mini-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(m.symbol);
                          }}
                        >
                          Details
                        </button>
                        <button
                          className="mini-btn strong"
                          disabled={!finite(m.spot)}
                          title={finite(m.spot) ? 'Open Manual Trade ticket' : 'No spot price available'}
                          onClick={(e) => {
                            e.stopPropagation();
                            openTicket({ symbol: m.symbol, side: 'BUY', source: 'manual' });
                          }}
                        >
                          Ticket
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <EmptyState title="Nothing matches">
              {filter === 'watchlist' ? 'Star assets to build your watchlist.' : 'Try a different filter or search.'}
            </EmptyState>
          )}

          <div className="table-foot">
            <span>
              Showing {visibleStart}-{visibleEnd} of {rows.length} · logos {iconStats.resolved}/{iconStats.total}
            </span>
            <span>
              Rows{' '}
              {[25, 50, 100, 200].map((n) => (
                <button key={n} className="mini-btn" style={{ marginLeft: 6, opacity: pageSize === n ? 1 : 0.6 }} onClick={() => setPageSize(n)}>
                  {n}
                </button>
              ))}
            </span>
            <span className="pager">
              <button disabled={pageN === 0} onClick={() => setPageN(pageN - 1)}>
                ‹
              </button>
              {pageButtons.map((p) => (
                <button key={p} className={pageN === p ? 'current' : ''} onClick={() => setPageN(p)}>
                  {p + 1}
                </button>
              ))}
              <button disabled={pageN >= pages - 1} onClick={() => setPageN(pageN + 1)}>
                ›
              </button>
            </span>
          </div>
          <p className="markets-source-note">Source: Binance public spot ticker, futures mark price, local scanner state, and server `/api/system` freshness.</p>
        </main>

        <aside className="market-rail">
          <section className="market-rail-card">
            <div className="market-rail-head">
              <h3>Top movers</h3>
              <span>24h · liquid</span>
            </div>
            <div className="rail-mover-grid">
              {movers.map((m) => (
                <button key={m.symbol} className="rail-mover-card" onClick={() => openDetail(m.symbol)}>
                  <TokenIcon symbol={m.symbol} size={25} />
                  <span className="rail-mover-symbol">{m.base}</span>
                  <span className={`rail-mover-change ${signClass(m.change24hPct)}`}>{fmtPct(m.change24hPct, 1)}</span>
                  <span className="rail-mover-price num">{fmtPrice(m.spot)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="market-rail-card">
            <div className="market-rail-head">
              <h3>Funding / basis board</h3>
              <span>arbitrage scan</span>
            </div>
            <div className="funding-board">
              {basisRows.slice(0, 6).map((m) => (
                <button key={`basis-${m.symbol}`} className="funding-row" onClick={() => openDetail(m.symbol)}>
                  <span className="tok">
                    <TokenIcon symbol={m.symbol} size={24} />
                    <span className="tok-meta">
                      <span className="tok-name">{m.base}</span>
                      <span className="tok-sub">next {countdown(m.nextFundingTime)}</span>
                    </span>
                  </span>
                  <span className="funding-metrics">
                    <span className={signClass(m.basisPct)}>{fmtBasis(m.basisPct)}</span>
                    <span className={signClass(m.fundingRate)}>{fmtFunding(m.fundingRate)}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="market-rail-footer">
              <span>Avg funding</span>
              <b className={signClass(avgFunding)}>{fmtFunding(avgFunding)}</b>
            </div>
          </section>

          <section className="market-rail-card">
            <div className="market-rail-head">
              <h3>Execution context</h3>
              <span>data quality</span>
            </div>
            <div className="market-context-list">
              <div>
                <span>Market stream</span>
                <b>{streamFresh ? 'fresh' : connected ? 'stale' : 'offline'}</b>
              </div>
              <div>
                <span>Scanner pairs</span>
                <b>{system?.pairs ?? scanner?.pairs ?? markets.length}</b>
              </div>
              <div>
                <span>Scanner tick</span>
                <b>{fmtAgeMs(scannerAgeMs)}</b>
              </div>
              <div>
                <span>Binance REST</span>
                <b>{fmtLatency(system?.restLatencyMs)}</b>
              </div>
              <div>
                <span>Real logo cache</span>
                <b>{iconStats.resolved}/{iconStats.total}</b>
              </div>
            </div>
            <div className="market-rail-actions">
              <button className="mini-btn strong" onClick={() => setPage('system')}>
                System health
              </button>
              <button className="mini-btn" onClick={() => setPage('risk')}>
                Risk controls
              </button>
            </div>
            <div className="refresh-rate rail-rate">
              Update
              {[3, 6, 10].map((sec) => (
                <button key={sec} className={prefs.refreshSec === sec ? 'active' : ''} onClick={() => updatePref('refreshSec', sec)}>
                  {sec}s
                </button>
              ))}
            </div>
            <button className="cta-pill" onClick={() => setPage('system')}>
              Open system health
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}

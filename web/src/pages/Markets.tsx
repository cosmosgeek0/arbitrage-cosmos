import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { TokenIcon, brandColor } from '../components/TokenIcon';
import { Sparkline, SparkArea } from '../components/Spark';
import { Num } from '../components/Num';
import { StatTile, EmptyState } from '../components/ui';
import { IconSearch } from '../components/Icons';
import { fmtPrice, fmtPct, fmtBasis, fmtMoney, fmtFunding, signClass } from '../format';

type SortKey = 'quoteVolume24h' | 'spot' | 'change24hPct' | 'basisPct' | 'fundingRate';
type Filter = 'all' | 'watchlist' | 'gainers' | 'losers' | 'basis' | 'signals';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All assets' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'gainers', label: 'Gainers' },
  { id: 'losers', label: 'Losers' },
  { id: 'basis', label: 'Widest basis' },
  { id: 'signals', label: 'Signals' },
];

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

export function Markets() {
  const { markets, state, openDetail, toggleWatch } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('quoteVolume24h');
  const [sortDesc, setSortDesc] = useState(true);
  const [pageN, setPageN] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const watchlist = state?.config.watchlist ?? [];

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
        return [...r].sort((a, b) => (b.change24hPct ?? -999) - (a.change24hPct ?? -999));
      case 'losers':
        return [...r].sort((a, b) => (a.change24hPct ?? 999) - (b.change24hPct ?? 999));
      case 'basis':
        return [...r].sort((a, b) => Math.abs(b.basisPct ?? 0) - Math.abs(a.basisPct ?? 0));
      case 'signals':
        r = r.filter((m) => m.status !== 'idle');
        break;
    }
    const dir = sortDesc ? -1 : 1;
    return [...r].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = sortKey === 'basisPct' ? Math.abs(av) - Math.abs(bv) : av - bv;
      return cmp * dir;
    });
  }, [markets, filter, search, sortKey, sortDesc, watchlist]);

  useEffect(() => setPageN(0), [filter, search, pageSize]);

  const totalVol = markets.reduce((s, m) => s + (m.quoteVolume24h ?? 0), 0);
  const btc = markets.find((m) => m.symbol === 'BTCUSDT');
  const liquid = markets.filter((m) => m.basisPct !== null && (m.quoteVolume24h ?? 0) >= 3_000_000);
  const avgBasis = liquid.length ? liquid.reduce((s, m) => s + Math.abs(m.basisPct!), 0) / liquid.length : 0;
  const widest = [...liquid].sort((a, b) => Math.abs(b.basisPct ?? 0) - Math.abs(a.basisPct ?? 0))[0];
  const movers = [...markets]
    .filter((m) => (m.quoteVolume24h ?? 0) >= 3_000_000 && m.change24hPct !== null)
    .sort((a, b) => Math.abs(b.change24hPct!) - Math.abs(a.change24hPct!))
    .slice(0, 6);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visible = rows.slice(pageN * pageSize, (pageN + 1) * pageSize);

  const header = (label: string, key: SortKey) => (
    <th
      className={`sortable ${sortKey === key ? 'sorted' : ''}`}
      onClick={() => {
        if (sortKey === key) setSortDesc(!sortDesc);
        else {
          setSortKey(key);
          setSortDesc(true);
        }
      }}
    >
      {label}
      <span className="sort-caret">{sortDesc ? '▼' : '▲'}</span>
    </th>
  );

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Markets</h1>
          <div className="page-sub">
            {markets.length} tradable USDT symbols ({markets.filter((m) => m.hasPerp).length} with perps for
            basis/funding) · this inspects the Binance universe, the cockpit stays on the Dashboard
          </div>
        </div>
      </div>

      <div className="stats">
        <StatTile
          label="Bitcoin"
          value={<Num value={btc?.spot ?? null}>{fmtPrice(btc?.spot)}</Num>}
          delta={<span className={signClass(btc?.change24hPct)}>{fmtPct(btc?.change24hPct)}</span>}
          spark={btc ? <SparkArea values={btc.spark} color={brandColor('BTCUSDT')} dots endDot /> : undefined}
          onClick={() => openDetail('BTCUSDT')}
        />
        <StatTile label="24h volume (tracked pairs)" value={fmtMoney(totalVol)} delta="spot quote volume" />
        <StatTile label="Avg |basis| (liquid)" value={`${avgBasis.toFixed(3)}%`} delta={`${liquid.length} pairs ≥ $3M`} />
        <StatTile
          label="Widest basis"
          value={widest ? fmtBasis(widest.basisPct, 2) : '—'}
          delta={widest?.symbol ?? '—'}
          onClick={widest ? () => openDetail(widest.symbol) : undefined}
        />
      </div>

      <div className="sec-head">
        <h2 className="sec-title">Top movers</h2>
        <span className="sec-note">24h change · liquid pairs</span>
      </div>
      <div className="mcards">
        {movers.map((m) => (
          <button key={m.symbol} className="mcard" onClick={() => openDetail(m.symbol)}>
            <div className="mcard-head">
              <TokenIcon symbol={m.symbol} size={26} />
              <span className="mcard-sym">{m.base}</span>
            </div>
            <div className="mcard-px num">{fmtPrice(m.spot)}</div>
            <div className={`mcard-chg ${signClass(m.change24hPct)}`}>{fmtPct(m.change24hPct, 1)}</div>
            <div className="mcard-chart">
              <SparkArea values={m.spark} color={brandColor(m.symbol)} />
            </div>
          </button>
        ))}
      </div>

      <div className="sec-head">
        <h2 className="sec-title">Crypto market prices</h2>
        <span className="sec-note">{rows.length} assets</span>
      </div>
      <div className="table-tools">
        <div className="chips">
          {FILTERS.map((f) => (
            <button key={f.id} className={`chip ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className="tsearch">
          <IconSearch size={13} />
          <input placeholder="Search asset" value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
        </div>
      </div>

      <div className="table-scroll">
        <table className="mkt">
          <thead>
            <tr>
              <th className="w-star" />
              <th className="w-idx l">#</th>
              <th className="l">Asset</th>
              {header('Price', 'spot')}
              {header('24h', 'change24hPct')}
              {header('Basis', 'basisPct')}
              {header('Funding', 'fundingRate')}
              {header('Volume', 'quoteVolume24h')}
              <th className="col-hide-sm">Last hour</th>
              <th className="col-hide-xs">Signal</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((m, i) => (
              <tr key={m.symbol} className="rowlink" onClick={() => openDetail(m.symbol)}>
                <td className="l">
                  <Star on={watchlist.includes(m.symbol)} onClick={() => void toggleWatch(m.symbol)} />
                </td>
                <td className="l idx num">{pageN * pageSize + i + 1}</td>
                <td className="l">
                  <span className="tok">
                    <TokenIcon symbol={m.symbol} size={30} />
                    <span className="tok-meta">
                      <span className="tok-name">{m.base}</span>
                      <span className="tok-sub">
                        {m.symbol}
                        {!m.hasPerp && ' · spot only'}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="val-strong">
                  <Num value={m.spot}>{fmtPrice(m.spot)}</Num>
                </td>
                <td className={signClass(m.change24hPct)}>
                  <span className="num">{fmtPct(m.change24hPct)}</span>
                </td>
                <td className={signClass(m.basisPct)}>
                  <span className="num">{fmtBasis(m.basisPct)}</span>
                </td>
                <td className={`col-hide-xs ${signClass(m.fundingRate)}`}>
                  <span className="num">{fmtFunding(m.fundingRate)}</span>
                </td>
                <td>
                  <span className="num">{fmtMoney(m.quoteVolume24h)}</span>
                </td>
                <td className="col-hide-sm">
                  <span className="sparkbox">
                    <Sparkline values={m.spark} />
                  </span>
                </td>
                <td className="col-hide-xs">
                  {m.status === 'signal' ? (
                    <span className="chip-tag gold">SIGNAL</span>
                  ) : m.status === 'watching' ? (
                    <span className="chip-tag">watching</span>
                  ) : (
                    <span className="faint">—</span>
                  )}
                </td>
                <td>
                  <button
                    className="mini-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDetail(m.symbol);
                    }}
                  >
                    View
                  </button>
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
          {Array.from({ length: Math.min(pages, 7) }, (_, i) => (
            <button key={i} className={pageN === i ? 'current' : ''} onClick={() => setPageN(i)}>
              {i + 1}
            </button>
          ))}
          <button disabled={pageN >= pages - 1} onClick={() => setPageN(pageN + 1)}>
            ›
          </button>
        </span>
      </div>
    </div>
  );
}

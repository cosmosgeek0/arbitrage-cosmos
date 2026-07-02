import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { TokenIcon, brandColor } from '../components/TokenIcon';
import { Sparkline, SparkArea } from '../components/Spark';
import { BigChart, type ChartPoint } from '../components/BigChart';
import { Num } from '../components/Num';
import { StatTile, EmptyState } from '../components/ui';
import { IconArrowLeft, IconSearch } from '../components/Icons';
import { fmtPrice, fmtPct, fmtMoney, fmtFunding, signClass, countdown, baseOf } from '../format';
import type { MarketDetail, MarketRow } from '../types';

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
  const { markets, state, detailSymbol, openDetail, toggleWatch } = useStore();
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
        r = [...r].sort((a, b) => (b.change24hPct ?? -999) - (a.change24hPct ?? -999));
        break;
      case 'losers':
        r = [...r].sort((a, b) => (a.change24hPct ?? 999) - (b.change24hPct ?? 999));
        break;
      case 'basis':
        r = [...r].sort((a, b) => Math.abs(b.basisPct ?? 0) - Math.abs(a.basisPct ?? 0));
        break;
      case 'signals':
        r = r.filter((m) => m.status !== 'idle');
        break;
    }
    if (filter === 'all' || filter === 'watchlist' || filter === 'signals' || search) {
      const dir = sortDesc ? -1 : 1;
      r = [...r].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        const cmp = sortKey === 'basisPct' ? Math.abs(av) - Math.abs(bv) : av - bv;
        return cmp * dir;
      });
    }
    return r;
  }, [markets, filter, search, sortKey, sortDesc, watchlist]);

  useEffect(() => setPageN(0), [filter, search, pageSize]);

  if (detailSymbol) return <TokenDetail symbol={detailSymbol} />;

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
            {markets.length} Binance spot+perp pairs · live basis, funding and signals
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
          value={widest ? fmtPct(widest.basisPct, 2) : '—'}
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
                      <span className="tok-sub">{m.symbol}</span>
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
                  <span className="num">{fmtPct(m.basisPct, 3)}</span>
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
            <button
              key={n}
              className="mini-btn"
              style={{ marginLeft: 6, opacity: pageSize === n ? 1 : 0.6 }}
              onClick={() => setPageSize(n)}
            >
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

/* ---------------- token detail (Coinbase asset page) ---------------- */

const WINDOWS = {
  '1H': { interval: '1m', limit: 60 },
  '1D': { interval: '5m', limit: 288 },
  '1W': { interval: '30m', limit: 336 },
  '1M': { interval: '2h', limit: 360 },
} as const;
type WinKey = keyof typeof WINDOWS;

function TokenDetail({ symbol }: { symbol: string }) {
  const { markets, state, openDetail, openTicket, toggleWatch, setPage, importFills } = useStore();
  const [win, setWin] = useState<WinKey>('1D');
  const [klines, setKlines] = useState<ChartPoint[]>([]);
  const [detail, setDetail] = useState<MarketDetail | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const live = markets.find((m) => m.symbol === symbol);
  const base = baseOf(symbol);
  const watchlisted = state?.config.watchlist.includes(symbol) ?? false;
  const allowlisted = state?.config.allowedSymbols.includes(symbol) ?? false;

  useEffect(() => {
    const { interval, limit } = WINDOWS[win];
    let alive = true;
    const load = () =>
      fetch(`/api/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setKlines(d as ChartPoint[]))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol, win]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/market/detail?symbol=${symbol}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setDetail(d as MarketDetail))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol]);

  const spread =
    detail?.book && detail.book.bidPrice > 0
      ? ((detail.book.askPrice - detail.book.bidPrice) / detail.book.bidPrice) * 100
      : null;

  return (
    <div className="container page">
      <button className="back-link" onClick={() => openDetail(null)}>
        <IconArrowLeft size={15} /> Markets
      </button>

      <div className="detail-top">
        <span className="tok">
          <TokenIcon symbol={symbol} size={46} />
          <span className="tok-meta">
            <span className="detail-name">{base}</span>
            <span className="detail-sub">
              {symbol} · spot + perp {live?.status === 'signal' && <span className="chip-tag gold">SIGNAL</span>}
            </span>
          </span>
        </span>
        <div className="detail-head-actions">
          <Star on={watchlisted} onClick={() => void toggleWatch(symbol)} />
          <button className="cta-pill buy" onClick={() => openTicket({ symbol, side: 'BUY', source: 'manual' })}>
            Buy
          </button>
          <button className="cta-pill danger" onClick={() => openTicket({ symbol, side: 'SELL', source: 'manual' })}>
            Sell
          </button>
        </div>
      </div>

      <div className="headline">
        <Num value={live?.spot ?? null} className="headline-val">
          {fmtPrice(live?.spot)}
        </Num>
        <span className={`hl-chip num ${signClass(live?.change24hPct)}`}>{fmtPct(live?.change24hPct)} 24h</span>
        <span className="hl-chip muted-chip">Spot · USDT</span>
      </div>

      <div className="chart-shell">
        <div className="chart-head">
          <div className="win">
            {(Object.keys(WINDOWS) as WinKey[]).map((w) => (
              <button key={w} className={win === w ? 'on' : ''} onClick={() => setWin(w)}>
                {w}
              </button>
            ))}
          </div>
          <div className="spacer" />
          <span className="sec-note num">
            {live?.perpMark !== null && live?.perpMark !== undefined && `perp mark ${fmtPrice(live.perpMark)}`}
          </span>
        </div>
        <BigChart data={klines} height={340} color={brandColor(symbol)} animateKey={`${symbol}-${win}`} />
      </div>

      <div className="asset-panels">
        <div className="apanel">
          <h3>Market stats</h3>
          <div className="kv-grid">
            <div className="kv">
              <div className="k">Perp mark</div>
              <div className="v num">{fmtPrice(live?.perpMark)}</div>
            </div>
            <div className="kv">
              <div className="k">Basis</div>
              <div className={`v num ${signClass(live?.basisPct)}`}>{fmtPct(live?.basisPct, 3)}</div>
            </div>
            <div className="kv">
              <div className="k">Funding</div>
              <div className={`v num ${signClass(live?.fundingRate)}`}>{fmtFunding(live?.fundingRate)}</div>
            </div>
            <div className="kv">
              <div className="k">Next funding</div>
              <div className="v num">{countdown(live?.nextFundingTime)}</div>
            </div>
            <div className="kv">
              <div className="k">24h volume</div>
              <div className="v num">{fmtMoney(live?.quoteVolume24h)}</div>
            </div>
            <div className="kv">
              <div className="k">Spread</div>
              <div className="v num">{spread !== null ? `${spread.toFixed(4)}%` : '—'}</div>
            </div>
            <div className="kv">
              <div className="k">Min notional</div>
              <div className="v num sm">{detail?.filters ? `$${detail.filters.minNotional}` : '—'}</div>
            </div>
            <div className="kv">
              <div className="k">Qty step</div>
              <div className="v num sm">{detail?.filters?.stepSize ?? '—'}</div>
            </div>
          </div>
        </div>

        <div className="apanel">
          <h3>Top of book</h3>
          <div className="ladder-row">
            <span className="bar ask" style={{ width: '52%' }} />
            <span className="k">Ask</span>
            <span className="v num">
              {fmtPrice(detail?.book?.askPrice)} <span className="muted small">× {detail?.book?.askQty ?? '—'}</span>
            </span>
          </div>
          <div className="ladder-mid">spread {spread !== null ? `${spread.toFixed(4)}%` : '—'}</div>
          <div className="ladder-row">
            <span className="bar bid" style={{ width: '52%' }} />
            <span className="k">Bid</span>
            <span className="v num">
              {fmtPrice(detail?.book?.bidPrice)} <span className="muted small">× {detail?.book?.bidQty ?? '—'}</span>
            </span>
          </div>
          <div className="drow" style={{ marginTop: 14 }}>
            <span className="k">Tradable on allowlist</span>
            <span className="v">
              {allowlisted ? (
                <span className="chip-tag ok">allowed</span>
              ) : (
                <button className="mini-btn" onClick={() => setPage('risk')}>
                  not allowed — Risk page
                </button>
              )}
            </span>
          </div>
        </div>

        <div className="apanel">
          <h3>Actions</h3>
          <div className="xrow">
            <span>
              <div className="k">Open a trade ticket</div>
              <div className="t">Risk gate + typed confirmation apply</div>
            </span>
            <span className="v">
              <button className="mini-btn" onClick={() => openTicket({ symbol, side: 'BUY', source: 'manual' })}>
                Ticket →
              </button>
            </span>
          </div>
          <div className="xrow">
            <span>
              <div className="k">Import fill history</div>
              <div className="t">Pull past trades for this symbol into the ledger</div>
            </span>
            <span className="v">
              <button
                className="mini-btn"
                disabled={!state?.binance.keysPresent}
                onClick={async () => {
                  const res = await importFills(symbol);
                  setImportMsg(res.error ? `Failed: ${res.error}` : `Imported ${res.imported} fills`);
                }}
              >
                Import
              </button>
            </span>
          </div>
          <div className="xrow">
            <span>
              <div className="k">Watchlist</div>
              <div className="t">Shows first on the tape and Markets</div>
            </span>
            <span className="v">
              <button className="mini-btn" onClick={() => void toggleWatch(symbol)}>
                {watchlisted ? 'Remove ★' : 'Add ☆'}
              </button>
            </span>
          </div>
          {importMsg && <div className="result-strip ok">{importMsg}</div>}
        </div>
      </div>
    </div>
  );
}

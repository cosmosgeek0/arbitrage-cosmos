import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { TokenIcon, brandColor } from '../components/TokenIcon';
import { BigChart, type ChartPoint } from '../components/BigChart';
import { Num } from '../components/Num';
import { SideTag } from '../components/ui';
import { fmtPrice, fmtPct, fmtBasis, fmtMoney, fmtFunding, fmtQty, signClass, countdown, baseOf, fmtTimeShort, fmtDateTime, timeAgo } from '../format';
import type { FillRow, MarketDetail, SignalRecord } from '../types';

const WINDOWS = {
  '1H': { interval: '1m', limit: 60 },
  '1D': { interval: '5m', limit: 288 },
  '1W': { interval: '30m', limit: 336 },
  '1M': { interval: '2h', limit: 360 },
} as const;
type WinKey = keyof typeof WINDOWS;
type ChartMode = 'price' | 'basis' | 'funding' | 'volume';

interface DepthLevel {
  price: number;
  qty: number;
}
interface SymbolContext {
  openOrders: { orderId: number; side: string; type: string; price: number; origQty: number; time: number }[];
  fills: FillRow[];
  signals: SignalRecord[];
  balances: { base: number; usdtFree: number | null };
  allowlisted: boolean;
  blocklisted: boolean;
}

function Star({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button className="star-btn" onClick={onClick} title={on ? 'Remove from watchlist' : 'Add to watchlist'}>
      <span className={`star ${on ? 'on' : ''}`}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </span>
    </button>
  );
}

function StripMetric({ label, value, tone = '', sub }: { label: string; value: ReactNode; tone?: string; sub?: ReactNode }) {
  return (
    <div className="strip-metric">
      <div className="strip-label">{label}</div>
      <div className={`strip-value num ${tone}`}>{value}</div>
      {sub && <div className="strip-sub">{sub}</div>}
    </div>
  );
}

function DataPanel({ title, kicker, children, className = '' }: { title: string; kicker?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card token-panel ${className}`}>
      <div className="token-panel-head">
        <h3>{title}</h3>
        {kicker && <span>{kicker}</span>}
      </div>
      {children}
    </section>
  );
}

function DataRow({
  label,
  value,
  tone = '',
  sub,
  control,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  sub?: ReactNode;
  control?: ReactNode;
}) {
  return (
    <div className="token-data-row">
      <span>
        <span className="td-label">{label}</span>
        {sub && <span className="td-sub">{sub}</span>}
      </span>
      <span className={`td-value num ${tone}`}>{control ?? value}</span>
    </div>
  );
}

export function TokenDetail({ symbol }: { symbol: string }) {
  const { markets, state, openTicket, toggleWatch, setPage, importFills } = useStore();
  const [win, setWin] = useState<WinKey>('1D');
  const [mode, setMode] = useState<ChartMode>('price');
  const [spotK, setSpotK] = useState<ChartPoint[]>([]);
  const [futK, setFutK] = useState<ChartPoint[]>([]);
  const [funding, setFunding] = useState<ChartPoint[]>([]);
  const [volK, setVolK] = useState<ChartPoint[]>([]);
  const [detail, setDetail] = useState<MarketDetail | null>(null);
  const [depth, setDepth] = useState<{ bids: DepthLevel[]; asks: DepthLevel[] } | null>(null);
  const [trades, setTrades] = useState<{ id: number; price: number; qty: number; time: number; isBuyerMaker: boolean }[]>([]);
  const [ctx, setCtx] = useState<SymbolContext | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const live = markets.find((m) => m.symbol === symbol);
  const base = baseOf(symbol);
  const watchlisted = state?.config.watchlist.includes(symbol) ?? false;

  // klines (spot + futures for the basis series)
  useEffect(() => {
    const { interval, limit } = WINDOWS[win];
    let alive = true;
    const load = () => {
      void fetch(`/api/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setSpotK(d as ChartPoint[]));
      void fetch(`/api/klines?symbol=${symbol}&interval=${interval}&limit=${limit}&market=futures`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setFutK(d as ChartPoint[]))
        .catch(() => setFutK([]));
      void fetch(`/api/klines?symbol=${symbol}&interval=${interval}&limit=${limit}&field=volume`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setVolK(d as ChartPoint[]))
        .catch(() => setVolK([]));
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol, win]);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/funding/history?symbol=${symbol}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => alive && setFunding(d as ChartPoint[]))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [symbol]);

  // detail + depth + trades + account context, polled
  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetch(`/api/market/detail?symbol=${symbol}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setDetail(d as MarketDetail));
      void fetch(`/api/market/depth?symbol=${symbol}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setDepth(d as { bids: DepthLevel[]; asks: DepthLevel[] }));
      void fetch(`/api/market/trades?symbol=${symbol}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && Array.isArray(d) && setTrades(d as typeof trades));
      void fetch(`/api/symbol/context?symbol=${symbol}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setCtx(d as SymbolContext));
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol]);

  const basisSeries = useMemo(() => {
    if (spotK.length < 2 || futK.length < 2) return [];
    const spotMap = new Map(spotK.map((p) => [p.t, p.v]));
    const out: ChartPoint[] = [];
    for (const f of futK) {
      const s = spotMap.get(f.t);
      if (s && s > 0) out.push({ t: f.t, v: ((f.v - s) / s) * 100 });
    }
    return out;
  }, [spotK, futK]);

  const chartData = mode === 'price' ? spotK : mode === 'basis' ? basisSeries : mode === 'volume' ? volK : funding;
  const pctFmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(3)}%`;
  const chartFirst = chartData.length ? chartData[0].v : null;
  const chartLast = chartData.length ? chartData[chartData.length - 1].v : null;
  const chartMove =
    chartFirst !== null && chartLast !== null
      ? mode === 'price' || mode === 'volume'
        ? chartFirst !== 0
          ? ((chartLast - chartFirst) / Math.abs(chartFirst)) * 100
          : null
        : chartLast - chartFirst
      : null;
  const chartSource =
    mode === 'basis'
      ? 'Binance spot + USD-M futures klines'
      : mode === 'funding'
        ? 'Binance settled funding history'
        : mode === 'volume'
          ? 'Binance spot quote-volume klines'
          : 'Binance spot klines';
  const chartLatest =
    chartLast === null ? '—' : mode === 'price' ? fmtPrice(chartLast) : mode === 'volume' ? fmtMoney(chartLast) : pctFmt(chartLast);
  const chartMoveLabel =
    chartMove === null
      ? '—'
      : mode === 'price' || mode === 'volume'
        ? fmtPct(chartMove, 2)
        : `${chartMove >= 0 ? '+' : ''}${chartMove.toFixed(3)} pts`;
  const spread =
    detail?.book && detail.book.bidPrice > 0
      ? ((detail.book.askPrice - detail.book.bidPrice) / detail.book.bidPrice) * 100
      : null;
  const maxDepthQty = depth ? Math.max(...depth.bids.map((b) => b.qty), ...depth.asks.map((a) => a.qty), 1e-9) : 1;
  const dayAnchor =
    live?.spot !== null && live?.spot !== undefined && live?.change24hPct !== null && live?.change24hPct !== undefined && live.change24hPct !== -100
      ? live.spot / (1 + live.change24hPct / 100)
      : null;
  const dayMoveUsd = live?.spot !== null && live?.spot !== undefined && dayAnchor !== null ? live.spot - dayAnchor : null;
  const spotFirst = spotK.length ? spotK[0].v : null;
  const spotLast = spotK.length ? spotK[spotK.length - 1].v : null;
  const spotMove = spotFirst !== null && spotLast !== null && spotFirst !== 0 ? ((spotLast - spotFirst) / Math.abs(spotFirst)) * 100 : null;
  const chartRange = chartData.length ? `${fmtTimeShort(chartData[0].t)} → ${fmtTimeShort(chartData[chartData.length - 1].t)}` : 'Waiting for klines';
  const openOrders = ctx?.openOrders ?? [];
  const fills = ctx?.fills ?? [];
  const signals = ctx?.signals ?? [];
  const accountBaseValue = ctx && live?.spot !== null && live?.spot !== undefined ? ctx.balances.base * live.spot : null;
  const usdtFree = ctx?.balances.usdtFree ?? null;
  const spreadLabel = spread !== null ? `${spread.toFixed(4)}%` : '—';
  const importDisabledReason = !state?.binance.keysPresent ? 'Read-only Binance keys must be present on the server to import fills' : 'Import Binance fill history';
  const hasPerp = live?.hasPerp ?? live?.perpMark !== null;
  const topSource = hasPerp ? 'Binance spot + USD-M futures' : 'Binance spot market data';

  return (
    <div className="container page token-detail-shell">
      <button className="back-link" onClick={() => setPage('markets')}>
        ← Markets
      </button>

      <section className="card token-market-strip">
        <div className="market-strip-main">
          <span className="tok token-strip-id">
            <TokenIcon symbol={symbol} size={42} />
            <span className="tok-meta">
              <span className="detail-name">{base}/USDT</span>
              <span className="detail-sub">
                {topSource} · {symbol}
                {live?.status === 'signal' && <span className="chip-tag gold">SIGNAL</span>}
                {ctx?.blocklisted && <span className="chip-tag bad">blocklisted</span>}
              </span>
            </span>
          </span>
          <div className="strip-price">
            <Num value={live?.spot ?? null} className="headline-val">
              {fmtPrice(live?.spot)}
            </Num>
            <span className={`strip-change num ${signClass(live?.change24hPct)}`}>
              {dayMoveUsd !== null ? `${dayMoveUsd > 0 ? '+' : ''}${fmtPrice(dayMoveUsd)} ` : ''}
              {fmtPct(live?.change24hPct)} 24h
            </span>
          </div>
        </div>
        <div className="strip-metrics">
          <StripMetric label="Perp mark" value={fmtPrice(live?.perpMark)} />
          <StripMetric label="Basis" value={fmtBasis(live?.basisPct)} tone={signClass(live?.basisPct)} />
          <StripMetric label="Funding" value={fmtFunding(live?.fundingRate)} tone={signClass(live?.fundingRate)} sub={`next ${countdown(live?.nextFundingTime)}`} />
          <StripMetric label="24h volume" value={fmtMoney(live?.quoteVolume24h)} />
          <StripMetric label="Spread" value={spreadLabel} />
        </div>
        <div className="detail-head-actions">
          <Star on={watchlisted} onClick={() => void toggleWatch(symbol)} />
          <button className="cta-pill buy" onClick={() => openTicket({ symbol, side: 'BUY', source: 'manual' })}>
            Buy
          </button>
          <button className="cta-pill danger" onClick={() => openTicket({ symbol, side: 'SELL', source: 'manual' })}>
            Sell
          </button>
        </div>
      </section>

      <div className="token-workspace">
        <aside className="card token-asset-card">
          <div className="asset-identity">
            <TokenIcon symbol={symbol} size={58} />
            <span>
              <span className="asset-title">{base}</span>
              <span className="asset-subtitle">private Binance cockpit</span>
            </span>
          </div>
          <p className="asset-copy">
            {base}/USDT is shown as an execution workspace: Binance spot price, USD-M perp context, funding, depth,
            recent prints, account balance, open orders, fills, and strategy proposals in one place.
          </p>
          <div className="asset-action-stack">
            <button className="cta-pill buy" onClick={() => openTicket({ symbol, side: 'BUY', source: 'manual' })}>
              Open buy ticket
            </button>
            <button className="cta-pill danger" onClick={() => openTicket({ symbol, side: 'SELL', source: 'manual' })}>
              Open sell ticket
            </button>
            <button className="mini-btn" onClick={() => setPage('risk')}>
              Risk controls →
            </button>
          </div>
          <div className="asset-status-list">
            <DataRow
              label="Risk allowlist"
              value={ctx?.allowlisted ? 'allowed' : 'not allowed'}
              control={ctx?.allowlisted ? <span className="chip-tag ok">allowed</span> : <button className="mini-btn" onClick={() => setPage('risk')}>configure</button>}
            />
            <DataRow
              label={`${base} balance`}
              value={ctx ? fmtQty(ctx.balances.base) : '—'}
              sub={accountBaseValue !== null ? fmtPrice(accountBaseValue) : undefined}
            />
            <DataRow label="USDT free" value={ctx ? (usdtFree !== null ? fmtPrice(usdtFree) : '—') : '—'} />
            <DataRow label="Open orders" value={openOrders.length} />
          </div>
          <button
            className="mini-btn wide"
            title={importDisabledReason}
            disabled={!state?.binance.keysPresent}
            onClick={async () => {
              const res = await importFills(symbol);
              setImportMsg(res.error ? `Failed: ${res.error}` : `Imported ${res.imported} fills`);
            }}
          >
            Import Binance fills
          </button>
          {importMsg && <div className="result-strip ok">{importMsg}</div>}
        </aside>

        <section className="card token-chart-card">
          <div className="token-chart-title">
            <span>
              <h2>{base} market tape</h2>
              <span>{chartSource} · {chartRange}</span>
            </span>
            <span className={`chart-latest num ${signClass(chartMove)}`}>
              {chartLatest}
              <small>{chartMoveLabel}</small>
            </span>
          </div>
          <div className="chart-source-strip">
            <span className="source-chip strong">{chartSource}</span>
            <span className="source-chip num">{mode === 'funding' ? '120 intervals' : win}</span>
            <span className="source-chip num">{chartData.length} pts</span>
            <span className="source-chip num">latest {chartLatest}</span>
            <span className={`source-chip num ${signClass(chartMove)}`}>move {chartMoveLabel}</span>
          </div>
          <div className="chart-head token-chart-controls">
            <div className="seg">
              {(['price', 'basis', 'funding', 'volume'] as ChartMode[]).map((m) => (
                <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                  {m === 'price' ? 'Price' : m === 'basis' ? 'Basis' : m === 'funding' ? 'Funding' : 'Volume'}
                </button>
              ))}
            </div>
            {mode !== 'funding' && (
              <div className="win">
                {(Object.keys(WINDOWS) as WinKey[]).map((w) => (
                  <button key={w} className={win === w ? 'on' : ''} onClick={() => setWin(w)}>
                    {w}
                  </button>
                ))}
              </div>
            )}
            <div className="spacer" />
            <span className="sec-note num">
              {mode === 'basis'
                ? 'spot vs perp close, same candles'
                : mode === 'funding'
                  ? 'settled funding, last 120 intervals'
                  : mode === 'volume'
                    ? 'quote volume per candle'
                    : `funding ${fmtFunding(live?.fundingRate)} in ${countdown(live?.nextFundingTime)}`}
            </span>
          </div>
          <BigChart
            data={chartData}
            height={420}
            color={mode === 'price' || mode === 'volume' ? brandColor(symbol) : undefined}
            valueFmt={mode === 'price' ? fmtPrice : mode === 'volume' ? fmtMoney : pctFmt}
            animateKey={`${symbol}-${win}-${mode}`}
          />
        </section>

        <aside className="card micro-card">
          <div className="micro-head">
            <h3>Book + prints</h3>
            <span>Binance depth / agg trades</span>
          </div>
          <div className="book-trades-grid">
            <div className="micro-section">
              <div className="micro-label">Order book</div>
              {!depth ? (
                <div className="muted small">Loading depth…</div>
              ) : (
                <>
                  {[...depth.asks].slice(0, 8).reverse().map((a) => (
                    <div key={`a${a.price}`} className="depth-row ask">
                      <span className="d-bar" style={{ width: `${Math.min((a.qty / maxDepthQty) * 100, 100)}%` }} />
                      <span className="d-px num">{fmtPrice(a.price)}</span>
                      <span className="d-qty num">{fmtQty(a.qty)}</span>
                    </div>
                  ))}
                  <div className="ladder-mid">spread {spreadLabel}</div>
                  {depth.bids.slice(0, 8).map((b) => (
                    <div key={`b${b.price}`} className="depth-row bid">
                      <span className="d-bar" style={{ width: `${Math.min((b.qty / maxDepthQty) * 100, 100)}%` }} />
                      <span className="d-px num">{fmtPrice(b.price)}</span>
                      <span className="d-qty num">{fmtQty(b.qty)}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="micro-section">
              <div className="micro-label">Recent trades</div>
              {trades.length === 0 ? (
                <div className="muted small">Loading trades…</div>
              ) : (
                trades.slice(0, 18).map((t) => (
                  <div key={t.id} className="trade-row">
                    <span className={`num ${t.isBuyerMaker ? 'down' : 'up'}`}>{fmtPrice(t.price)}</span>
                    <span className="num muted">{fmtQty(t.qty)}</span>
                    <span className="t-time num">{fmtTimeShort(t.time)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      <div className="token-data-grid">
        <DataPanel title="Trading insights" kicker="basis scanner">
          <DataRow label="Scanner state" value={live?.status ?? '—'} control={<span className={`chip-tag ${live?.status === 'signal' ? 'gold' : 'ok'}`}>{live?.status ?? 'unknown'}</span>} />
          <DataRow label="Basis" value={fmtBasis(live?.basisPct)} tone={signClass(live?.basisPct)} sub="spot/perp mark spread" />
          <DataRow label="Funding carry" value={fmtFunding(live?.fundingRate)} tone={signClass(live?.fundingRate)} sub={`next ${countdown(live?.nextFundingTime)}`} />
          <DataRow label="Spot 24h move" value={fmtPct(live?.change24hPct)} tone={signClass(live?.change24hPct)} />
        </DataPanel>

        <DataPanel title="Market stats" kicker="direct Binance">
          <DataRow label="Spot last" value={fmtPrice(live?.spot ?? detail?.last)} />
          <DataRow label="Perp mark" value={fmtPrice(live?.perpMark)} />
          <DataRow label="24h quote volume" value={fmtMoney(live?.quoteVolume24h)} />
          <DataRow label="Best bid / ask" value={detail?.book ? `${fmtPrice(detail.book.bidPrice)} / ${fmtPrice(detail.book.askPrice)}` : '—'} />
          <DataRow label="Spread" value={spreadLabel} />
        </DataPanel>

        <DataPanel title="Trading rules" kicker="exchange filters">
          <DataRow label="Min notional" value={detail?.filters ? `$${detail.filters.minNotional}` : '—'} />
          <DataRow label="Min quantity" value={detail?.filters ? fmtQty(detail.filters.minQty) : '—'} />
          <DataRow label="Step size" value={detail?.filters ? fmtQty(detail.filters.stepSize) : '—'} />
          <DataRow label="Tick size" value={detail?.filters ? fmtQty(detail.filters.tickSize) : '—'} />
        </DataPanel>

        <DataPanel title="Account here" kicker={state?.binance.keysPresent ? 'server keys present' : 'read-only unavailable'}>
          <DataRow label={`${base} balance`} value={ctx ? fmtQty(ctx.balances.base) : '—'} sub={accountBaseValue !== null ? fmtPrice(accountBaseValue) : undefined} />
          <DataRow label="USDT free" value={ctx ? (usdtFree !== null ? fmtPrice(usdtFree) : '—') : '—'} />
          <DataRow label="Allowlisted" value={ctx?.allowlisted ? 'yes' : 'no'} tone={ctx?.allowlisted ? 'up' : 'down'} />
          <DataRow label="Blocklisted" value={ctx?.blocklisted ? 'yes' : 'no'} tone={ctx?.blocklisted ? 'down' : ''} />
        </DataPanel>

        <DataPanel title="Orders & fills" kicker="local ledger">
          {openOrders.length === 0 && fills.length === 0 ? (
            <div className="muted small">No orders or fills for {symbol} yet.</div>
          ) : (
            <>
              {openOrders.slice(0, 4).map((o) => (
                <div key={o.orderId} className="xrow">
                  <SideTag side={o.side} />
                  <span>
                    <div className="k num">{fmtQty(o.origQty)} @ {fmtPrice(o.price)}</div>
                    <div className="t">{o.type} · {timeAgo(o.time)}</div>
                  </span>
                  <span className="v">
                    <button className="mini-btn" onClick={() => setPage('orders')}>Manage</button>
                  </span>
                </div>
              ))}
              {fills.slice(0, 5).map((f) => (
                <div key={f.tradeId} className="xrow">
                  <SideTag side={f.side} />
                  <span>
                    <div className="k num">{fmtQty(f.qty)} @ {fmtPrice(f.price)}</div>
                    <div className="t">{fmtDateTime(f.ts)}</div>
                  </span>
                  <span className="v num">{fmtPrice(f.quoteQty)}</span>
                </div>
              ))}
            </>
          )}
        </DataPanel>

        <DataPanel title="Strategy signals" kicker="proposals only">
          {signals.length === 0 ? (
            <div className="muted small">
              No proposal has been opened for {base}. The scanner only proposes after basis clears the configured
              threshold and persists.
            </div>
          ) : (
            signals.map((s) => (
              <div key={s.id} className="xrow">
                <span>
                  <div className="k">{s.side === 'SHORT_PERP_LONG_SPOT' ? 'Short perp · Long spot' : 'Long perp · Short spot'}</div>
                  <div className="t">{fmtDateTime(s.openedTs)} {s.closedTs ? '· closed' : '· open'}</div>
                </span>
                <span className={`v num ${signClass(s.basisPeak)}`}>peak {fmtBasis(s.basisPeak, 2)}</span>
              </div>
            ))
          )}
        </DataPanel>

        <DataPanel title="Price history" kicker={win}>
          <DataRow label="Window open" value={spotFirst !== null ? fmtPrice(spotFirst) : '—'} sub={spotK[0] ? fmtTimeShort(spotK[0].t) : undefined} />
          <DataRow label="Latest plotted" value={spotLast !== null ? fmtPrice(spotLast) : '—'} sub={spotK.length ? fmtTimeShort(spotK[spotK.length - 1].t) : undefined} />
          <DataRow label="Window move" value={fmtPct(spotMove, 2)} tone={signClass(spotMove)} />
          <DataRow label="Candles" value={spotK.length} />
        </DataPanel>
      </div>
    </div>
  );
}

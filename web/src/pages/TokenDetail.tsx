import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { TokenIcon, brandColor } from '../components/TokenIcon';
import { BigChart, type ChartPoint } from '../components/BigChart';
import { Num } from '../components/Num';
import { EmptyState, SideTag } from '../components/ui';
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
  const spread =
    detail?.book && detail.book.bidPrice > 0
      ? ((detail.book.askPrice - detail.book.bidPrice) / detail.book.bidPrice) * 100
      : null;
  const maxDepthQty = depth ? Math.max(...depth.bids.map((b) => b.qty), ...depth.asks.map((a) => a.qty), 1e-9) : 1;

  return (
    <div className="container page">
      <button className="back-link" onClick={() => setPage('markets')}>
        ← Markets
      </button>

      <div className="detail-top">
        <span className="tok">
          <TokenIcon symbol={symbol} size={46} />
          <span className="tok-meta">
            <span className="detail-name">{base}</span>
            <span className="detail-sub">
              {symbol} · spot{live?.perpMark !== null && live?.perpMark !== undefined ? ' + perp' : ''}{' '}
              {live?.status === 'signal' && <span className="chip-tag gold">SIGNAL</span>}
              {ctx?.blocklisted && <span className="chip-tag bad">blocklisted</span>}
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
        <span className="hl-chip muted-chip num">perp {fmtPrice(live?.perpMark)}</span>
        <span className={`hl-chip num ${signClass(live?.basisPct)}`}>basis {fmtBasis(live?.basisPct)}</span>
      </div>

      <div className="chart-shell">
        <div className="chart-head">
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
          height={330}
          color={mode === 'price' || mode === 'volume' ? brandColor(symbol) : undefined}
          valueFmt={mode === 'price' ? fmtPrice : mode === 'volume' ? fmtMoney : pctFmt}
          animateKey={`${symbol}-${win}-${mode}`}
        />
      </div>

      <div className="asset-panels">
        <div className="apanel">
          <h3>Market stats</h3>
          <div className="kv-grid">
            <div className="kv"><div className="k">Perp mark</div><div className="v num">{fmtPrice(live?.perpMark)}</div></div>
            <div className="kv"><div className="k">Basis</div><div className={`v num ${signClass(live?.basisPct)}`}>{fmtBasis(live?.basisPct)}</div></div>
            <div className="kv"><div className="k">Funding</div><div className={`v num ${signClass(live?.fundingRate)}`}>{fmtFunding(live?.fundingRate)}</div></div>
            <div className="kv"><div className="k">Next funding</div><div className="v num">{countdown(live?.nextFundingTime)}</div></div>
            <div className="kv"><div className="k">24h volume</div><div className="v num">{fmtMoney(live?.quoteVolume24h)}</div></div>
            <div className="kv"><div className="k">Spread</div><div className="v num">{spread !== null ? `${spread.toFixed(4)}%` : '—'}</div></div>
            <div className="kv"><div className="k">Min notional</div><div className="v num sm">{detail?.filters ? `$${detail.filters.minNotional}` : '—'}</div></div>
            <div className="kv"><div className="k">Step / tick</div><div className="v num sm">{detail?.filters ? `${detail.filters.stepSize} / ${detail.filters.tickSize}` : '—'}</div></div>
          </div>
        </div>

        <div className="apanel">
          <h3>Order book</h3>
          {!depth ? (
            <div className="muted small">Loading depth…</div>
          ) : (
            <>
              {[...depth.asks].slice(0, 7).reverse().map((a) => (
                <div key={`a${a.price}`} className="depth-row ask">
                  <span className="d-bar" style={{ width: `${Math.min((a.qty / maxDepthQty) * 100, 100)}%` }} />
                  <span className="d-px num">{fmtPrice(a.price)}</span>
                  <span className="d-qty num">{fmtQty(a.qty)}</span>
                </div>
              ))}
              <div className="ladder-mid">spread {spread !== null ? `${spread.toFixed(4)}%` : '—'}</div>
              {depth.bids.slice(0, 7).map((b) => (
                <div key={`b${b.price}`} className="depth-row bid">
                  <span className="d-bar" style={{ width: `${Math.min((b.qty / maxDepthQty) * 100, 100)}%` }} />
                  <span className="d-px num">{fmtPrice(b.price)}</span>
                  <span className="d-qty num">{fmtQty(b.qty)}</span>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="apanel">
          <h3>Recent trades</h3>
          {trades.length === 0 ? (
            <div className="muted small">Loading trades…</div>
          ) : (
            trades.slice(0, 14).map((t) => (
              <div key={t.id} className="trade-row">
                <span className={`num ${t.isBuyerMaker ? 'down' : 'up'}`}>{fmtPrice(t.price)}</span>
                <span className="num muted">{fmtQty(t.qty)}</span>
                <span className="t-time num">{fmtTimeShort(t.time)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="asset-panels" style={{ marginTop: 0, borderTop: '1px solid var(--line)' }}>
        <div className="apanel">
          <h3>Your account here</h3>
          <div className="drow">
            <span className="k">{base} balance</span>
            <span className="v num">{ctx ? fmtQty(ctx.balances.base) : '—'}</span>
          </div>
          <div className="drow">
            <span className="k">USDT free</span>
            <span className="v num">{ctx?.balances.usdtFree !== null && ctx ? fmtPrice(ctx.balances.usdtFree) : '—'}</span>
          </div>
          <div className="drow">
            <span className="k">Allowlist</span>
            <span className="v">
              {ctx?.allowlisted ? (
                <span className="chip-tag ok">allowed</span>
              ) : (
                <button className="mini-btn" onClick={() => setPage('risk')}>
                  not allowed — Risk →
                </button>
              )}
            </span>
          </div>
          <div className="drow">
            <span className="k">Import fill history</span>
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
          {importMsg && <div className="result-strip ok">{importMsg}</div>}
        </div>

        <div className="apanel">
          <h3>Open orders · fills</h3>
          {(ctx?.openOrders.length ?? 0) === 0 && (ctx?.fills.length ?? 0) === 0 ? (
            <div className="muted small">No orders or fills for {symbol} yet.</div>
          ) : (
            <>
              {ctx?.openOrders.map((o) => (
                <div key={o.orderId} className="xrow">
                  <SideTag side={o.side} />
                  <span>
                    <div className="k num">
                      {fmtQty(o.origQty)} @ {fmtPrice(o.price)}
                    </div>
                    <div className="t">{o.type} · {timeAgo(o.time)}</div>
                  </span>
                  <span className="v">
                    <button className="mini-btn" onClick={() => setPage('orders')}>
                      Manage
                    </button>
                  </span>
                </div>
              ))}
              {ctx?.fills.slice(0, 5).map((f) => (
                <div key={f.tradeId} className="xrow">
                  <SideTag side={f.side} />
                  <span>
                    <div className="k num">
                      {fmtQty(f.qty)} @ {fmtPrice(f.price)}
                    </div>
                    <div className="t">{fmtDateTime(f.ts)}</div>
                  </span>
                  <span className="v num">{fmtPrice(f.quoteQty)}</span>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="apanel">
          <h3>Strategy signals</h3>
          {(ctx?.signals.length ?? 0) === 0 ? (
            <div className="muted small">
              The basis monitor has never proposed {base}. It opens a proposal when |basis| clears the threshold and
              persists.
            </div>
          ) : (
            ctx?.signals.map((s) => (
              <div key={s.id} className="xrow">
                <span>
                  <div className="k">{s.side === 'SHORT_PERP_LONG_SPOT' ? 'Short perp · Long spot' : 'Long perp · Short spot'}</div>
                  <div className="t">{fmtDateTime(s.openedTs)} {s.closedTs ? '· closed' : '· open'}</div>
                </span>
                <span className={`v num ${signClass(s.basisPeak)}`}>peak {fmtBasis(s.basisPeak, 2)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

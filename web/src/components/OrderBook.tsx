import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { subscribeLiveBook } from '../store';
import { Num } from './Num';

/**
 * Backpack-grade living order book. Fed by the server's Binance
 * depth20@100ms + aggTrade rebroadcast over the app WebSocket; falls back to
 * REST polling if the stream goes quiet. Asks stack down to the spread row,
 * bids continue below it; cumulative depth bars glide, sizes flash on change.
 */

type Level = [number, number]; // price, qty
interface Trade {
  id: number;
  price: number;
  qty: number;
  time: number;
  isBuyerMaker: boolean;
}

const LEVELS_SHOWN = 12;
const TRADES_SHOWN = 24;
const LIVE_STALE_MS = 6_000;

function priceDecimals(p: number): number {
  const a = Math.abs(p);
  if (a >= 1000) return 2;
  if (a >= 100) return 2;
  if (a >= 1) return 3;
  if (a >= 0.1) return 4;
  if (a >= 0.001) return 6;
  return 8;
}

function fmtPx(p: number, d: number): string {
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtSize(q: number): string {
  const a = Math.abs(q);
  if (a >= 100_000) return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(q);
  if (a >= 100) return q.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (a >= 1) return q.toLocaleString('en-US', { maximumFractionDigits: 3 });
  return q.toLocaleString('en-US', { maximumFractionDigits: 5 });
}

function fmtClock(ts: number): string {
  const d = new Date(ts);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function OrderBook({
  symbol,
  base,
  levels = LEVELS_SHOWN,
  onPriceClick,
  footerActions,
}: {
  symbol: string;
  base: string;
  /** Rows shown per side (asks and bids each). */
  levels?: number;
  /** When set, book prices become clickable (e.g. load into a limit ticket). */
  onPriceClick?: (price: number) => void;
  footerActions?: ReactNode;
}) {
  const [tab, setTab] = useState<'book' | 'trades'>('book');
  const [expandedTrades, setExpandedTrades] = useState(false);
  const [book, setBook] = useState<{ bids: Level[]; asks: Level[] } | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const liveTsRef = useRef(0);
  const pendingBookRef = useRef<{ bids: Level[]; asks: Level[] } | null>(null);
  const bookRafRef = useRef<number | null>(null);

  // Reset + REST seed for instant paint, then keep polling only as a fallback
  // for when the live stream is quiet.
  useEffect(() => {
    let alive = true;
    liveTsRef.current = 0;
    setBook(null);
    setTrades([]);
    const seed = () => {
      if (Date.now() - liveTsRef.current < LIVE_STALE_MS) return; // stream is alive — skip REST
      void fetch(`/api/market/depth?symbol=${symbol}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { bids: { price: number; qty: number }[]; asks: { price: number; qty: number }[] } | null) => {
          if (!alive || !d || Date.now() - liveTsRef.current < LIVE_STALE_MS) return;
          setBook({
            bids: d.bids.map((l) => [l.price, l.qty] as Level),
            asks: d.asks.map((l) => [l.price, l.qty] as Level),
          });
        })
        .catch(() => undefined);
      void fetch(`/api/market/trades?symbol=${symbol}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: Trade[] | null) => {
          if (!alive || !d || !Array.isArray(d) || Date.now() - liveTsRef.current < LIVE_STALE_MS) return;
          setTrades(d.slice(0, TRADES_SHOWN + 10));
        })
        .catch(() => undefined);
    };
    seed();
    const t = setInterval(seed, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol]);

  // Live stream: depth snapshots ~100ms, trade prints flushed ~250ms.
  useEffect(
    () => {
      const unsub = subscribeLiveBook(symbol, (m) => {
        if (m.symbol !== symbol) return;
        if (m.type === 'book') {
          liveTsRef.current = Date.now();
          pendingBookRef.current = {
            bids: m.bids.map(([p, q]) => [Number(p), Number(q)] as Level),
            asks: m.asks.map(([p, q]) => [Number(p), Number(q)] as Level),
          };
          if (bookRafRef.current === null) {
            bookRafRef.current = requestAnimationFrame(() => {
              bookRafRef.current = null;
              if (pendingBookRef.current) setBook(pendingBookRef.current);
            });
          }
        } else if (m.type === 'btrades') {
          setTrades((prev) => {
            const next = [...m.trades].reverse().concat(prev);
            return next.length > 60 ? next.slice(0, 60) : next;
          });
        }
      });
      return () => {
        unsub();
        if (bookRafRef.current !== null) cancelAnimationFrame(bookRafRef.current);
        bookRafRef.current = null;
      };
    },
    [symbol]
  );

  const live = Date.now() - liveTsRef.current < LIVE_STALE_MS;

  const bids = useMemo(() => (book ? book.bids.filter(([, q]) => q > 0).slice(0, levels) : []), [book, levels]);
  const asks = useMemo(() => (book ? book.asks.filter(([, q]) => q > 0).slice(0, levels) : []), [book, levels]);

  // Price decimals: start from magnitude, then widen until every displayed
  // level is distinct — a stablecoin book ticks at the 4th decimal and would
  // otherwise render 20 identical "1.001" rows.
  const dec = useMemo(() => {
    const levels = [...bids, ...asks].map(([p]) => p);
    if (!levels.length) return 2;
    let d = priceDecimals(levels[0]);
    while (d < 8 && new Set(levels.map((p) => p.toFixed(d))).size < new Set(levels).size) d++;
    return d;
  }, [bids, asks]);

  // Cumulative depth from the spread outward; bars scale to the deeper side.
  const { bidRows, askRows, maxCum, bidNotional, askNotional } = useMemo(() => {
    let cum = 0;
    const bidRows = bids.map(([p, q]) => ({ p, q, cum: (cum += q) }));
    const bidMax = cum;
    cum = 0;
    const askRows = asks.map(([p, q]) => ({ p, q, cum: (cum += q) }));
    const askMax = cum;
    const bidNotional = bids.reduce((s, [p, q]) => s + p * q, 0);
    const askNotional = asks.reduce((s, [p, q]) => s + p * q, 0);
    return { bidRows, askRows, maxCum: Math.max(bidMax, askMax, 1e-12), bidNotional, askNotional };
  }, [bids, asks]);

  const bestBid = bids.length ? bids[0][0] : null;
  const bestAsk = asks.length ? asks[0][0] : null;
  // Absolute spread in quote units (a % is meaningless noise on tight books —
  // BTC's 1-tick spread is 0.0000x%); the stats panel keeps the % view.
  const spreadAbs = bestBid !== null && bestAsk !== null ? Math.max(0, bestAsk - bestBid) : null;

  // Last print + its direction (vs the previous different price).
  const { lastPrice, lastDir } = useMemo(() => {
    if (!trades.length) return { lastPrice: null as number | null, lastDir: 0 };
    const last = trades[0].price;
    for (let i = 1; i < trades.length; i++) {
      if (trades[i].price !== last) return { lastPrice: last, lastDir: last > trades[i].price ? 1 : -1 };
    }
    return { lastPrice: last, lastDir: 0 };
  }, [trades]);

  const buyPct = bidNotional + askNotional > 0 ? (bidNotional / (bidNotional + askNotional)) * 100 : 50;

  return (
    <aside className="card micro-card ob-card">
      <div className="micro-head ob-head">
        <div className="seg mini">
          <button className={tab === 'book' ? 'on' : ''} onClick={() => setTab('book')}>
            Book
          </button>
          <button className={tab === 'trades' ? 'on' : ''} onClick={() => setTab('trades')}>
            Trades
          </button>
        </div>
        <span className={`ob-live num ${live ? 'on' : ''}`} title={live ? 'Binance depth stream · 100ms' : 'REST fallback · 10s'}>
          <span className="ob-live-dot" />
          {live ? 'LIVE' : 'POLL'}
        </span>
      </div>

      {tab === 'book' ? (
        <div className="ob-body">
          <div className="ob-cols">
            <span>Price</span>
            <span>Size ({base})</span>
            <span>Total</span>
          </div>

          <div className="ob-side asks">
            {askRows.length === 0 ? (
              <div className="ob-empty">Waiting for depth…</div>
            ) : (
              [...askRows].reverse().map((r) => (
                <div
                  key={r.p}
                  className={`ob-row ask ${r.cum / maxCum > 0.7 ? 'heavy' : ''} ${onPriceClick ? 'clickable' : ''}`}
                  title={onPriceClick ? 'Use as limit price' : undefined}
                  onClick={onPriceClick ? () => onPriceClick(r.p) : undefined}
                >
                  <span className="ob-bar" style={{ width: `${Math.min((r.cum / maxCum) * 100, 100)}%` }} />
                  <span className="ob-px num">{fmtPx(r.p, dec)}</span>
                  <span key={r.q} className="ob-size num fl">
                    {fmtSize(r.q)}
                  </span>
                  <span className="ob-total num">{fmtSize(r.cum)}</span>
                </div>
              ))
            )}
          </div>

          <div className="ob-mid">
            <span className="ob-mid-label">last</span>
            <Num value={lastPrice} className={`ob-last ${lastDir > 0 ? 'up' : lastDir < 0 ? 'down' : ''}`}>
              {lastPrice !== null ? fmtPx(lastPrice, dec) : bestBid !== null && bestAsk !== null ? fmtPx((bestBid + bestAsk) / 2, dec) : '—'}
            </Num>
            {lastDir !== 0 && <span className={`ob-arrow ${lastDir > 0 ? 'up' : 'down'}`}>{lastDir > 0 ? '↑' : '↓'}</span>}
            <span className="ob-spread num">spread {spreadAbs !== null ? fmtPx(spreadAbs, dec) : '—'}</span>
          </div>

          <div className="ob-side bids">
            {bidRows.map((r) => (
              <div
                key={r.p}
                className={`ob-row bid ${r.cum / maxCum > 0.7 ? 'heavy' : ''} ${onPriceClick ? 'clickable' : ''}`}
                title={onPriceClick ? 'Use as limit price' : undefined}
                onClick={onPriceClick ? () => onPriceClick(r.p) : undefined}
              >
                <span className="ob-bar" style={{ width: `${Math.min((r.cum / maxCum) * 100, 100)}%` }} />
                <span className="ob-px num">{fmtPx(r.p, dec)}</span>
                <span key={r.q} className="ob-size num fl">
                  {fmtSize(r.q)}
                </span>
                <span className="ob-total num">{fmtSize(r.cum)}</span>
              </div>
            ))}
          </div>

          <div className="ob-ratio" title="Bid vs ask notional across the visible book">
            <span className="ob-ratio-tag up num">B {buyPct.toFixed(0)}%</span>
            <span className="ob-ratio-bar">
              <span className="ob-ratio-fill" style={{ width: `${buyPct}%` }} />
            </span>
            <span className="ob-ratio-tag down num">{(100 - buyPct).toFixed(0)}% S</span>
          </div>
        </div>
      ) : (
        <div className="ob-body">
          <div className="ob-cols">
            <span>Price</span>
            <span>Size ({base})</span>
            <span>Time</span>
          </div>
          <div className="ob-trades">
            {trades.length === 0 ? (
              <div className="ob-empty">Waiting for prints…</div>
            ) : (
              trades.slice(0, expandedTrades ? 60 : TRADES_SHOWN).map((t) => (
                <div key={t.id} className="ob-row trade in">
                  <span className={`ob-px num ${t.isBuyerMaker ? 'down' : 'up'}`}>{fmtPx(t.price, dec)}</span>
                  <span className="ob-size num">{fmtSize(t.qty)}</span>
                  <span className="ob-time num">{fmtClock(t.time)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="ob-footer-actions">
        {tab === 'book' ? (
          <button className="mini-btn" type="button" onClick={() => setTab('trades')}>
            View prints
          </button>
        ) : (
          <button className="mini-btn" type="button" disabled={trades.length <= TRADES_SHOWN} onClick={() => setExpandedTrades((v) => !v)}>
            {expandedTrades ? 'Show fewer' : 'Show more prints'}
          </button>
        )}
        {footerActions}
      </div>
    </aside>
  );
}

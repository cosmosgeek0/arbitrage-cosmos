import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { TokenIcon, brandColor } from '../components/TokenIcon';
import type { ChartPoint } from '../components/BigChart';
import { Num } from '../components/Num';
import { OrderBook } from '../components/OrderBook';
import { TradingViewChart, type TvCandle } from '../components/TradingViewChart';
import { TradingViewWidget } from '../components/TradingViewWidget';
import { DepthChart } from '../components/DepthChart';
import { SideTag } from '../components/ui';
import { fmtPrice, fmtPct, fmtBasis, fmtMoney, fmtFunding, fmtQty, signClass, countdown, baseOf, fmtTimeShort, fmtDateTime, timeAgo } from '../format';
import type { FillRow, MarketDetail, SignalRecord, Side, OrderType, TicketPrefill } from '../types';

const WINDOWS = {
  '1s': { interval: '1s', limit: 500 },
  '1m': { interval: '1m', limit: 720 },
  '5m': { interval: '5m', limit: 576 },
  '15m': { interval: '15m', limit: 672 },
  '1H': { interval: '1h', limit: 720 },
  '4H': { interval: '4h', limit: 720 },
  '1D': { interval: '1d', limit: 365 },
  '1W': { interval: '1w', limit: 260 },
} as const;
type WinKey = keyof typeof WINDOWS;
type ChartMode = 'tradingview' | 'price' | 'depth' | 'basis' | 'funding' | 'volume';
type RailMode = OrderType | 'TWAP' | 'SCALE';
const TV_WINS = ['1m', '5m', '15m', '1H', '4H', '1D', '1W'] as const satisfies readonly WinKey[];
const BINANCE_WINS = Object.keys(WINDOWS) as WinKey[];

interface BinanceKlineMsg {
  k?: {
    t: number;
    o: string;
    h: string;
    l: string;
    c: string;
    v: string;
    q: string;
  };
}

interface SymbolContext {
  openOrders: { orderId: number; side: string; type: string; price: number; origQty: number; time: number }[];
  fills: FillRow[];
  signals: SignalRecord[];
  balances: { base: number; usdtFree: number | null };
  allowlisted: boolean;
  blocklisted: boolean;
}

interface FuturesTelemetry {
  symbol: string;
  period: string;
  updatedAt: number;
  available: boolean;
  errors: string[];
  openInterest: { t: number; contracts: number; notional: number }[];
  topAccountRatio: { t: number; ratio: number; longPct: number; shortPct: number }[];
  topPositionRatio: { t: number; ratio: number; longPct: number; shortPct: number }[];
  globalRatio: { t: number; ratio: number; longPct: number; shortPct: number }[];
  takerFlow: { t: number; buyVol: number; sellVol: number; ratio: number }[];
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

function fmtCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
}

function fmtSignedPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = fmtPrice(Math.abs(v));
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}${abs}`;
}

function lastOf<T>(arr: T[] | undefined): T | undefined {
  return arr && arr.length ? arr[arr.length - 1] : undefined;
}

function TokenRailTicket({
  symbol,
  base,
  bid,
  ask,
  last,
  maxOrderNotional,
  openTicket,
}: {
  symbol: string;
  base: string;
  bid: number | null | undefined;
  ask: number | null | undefined;
  last: number | null | undefined;
  maxOrderNotional: number | null | undefined;
  openTicket: (t: TicketPrefill) => void;
}) {
  const [side, setSide] = useState<Side>('BUY');
  const [mode, setMode] = useState<RailMode>('LIMIT');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [orderValue, setOrderValue] = useState('');
  const cap = maxOrderNotional && maxOrderNotional > 0 ? maxOrderNotional : 10;
  const reference = last ?? (bid && ask ? (bid + ask) / 2 : bid ?? ask ?? null);
  const px = Number(price) > 0 ? Number(price) : reference;
  const typedQty = Number(qty);
  const typedValue = Number(orderValue);
  const derivedQty =
    Number.isFinite(typedQty) && typedQty > 0
      ? typedQty
      : Number.isFinite(typedValue) && typedValue > 0 && px && px > 0
        ? typedValue / px
        : null;
  const derivedValue =
    Number.isFinite(typedValue) && typedValue > 0
      ? typedValue
      : derivedQty && px
        ? derivedQty * px
        : null;
  const unsupported = mode === 'TWAP' || mode === 'SCALE';
  const ready = Boolean(!unsupported && symbol && px && px > 0 && ((mode === 'MARKET' && derivedValue && derivedValue > 0) || (mode === 'LIMIT' && derivedQty && derivedQty > 0)));
  const disabledReason = unsupported
    ? `${mode === 'TWAP' ? 'TWAP' : 'Scaled orders'} need a backend executor before live or paper routing is honest.`
    : ready
      ? 'Open this draft in the guarded manual ticket'
      : 'Choose price and size first';

  useEffect(() => {
    setPrice('');
    setQty('');
    setOrderValue('');
    setMode('LIMIT');
    setSide('BUY');
  }, [symbol]);

  useEffect(() => {
    if (!price && reference) setPrice(String(reference));
  }, [price, reference]);

  const setValuePct = (pct: number) => {
    const value = Math.max(0, (cap * pct) / 100);
    setOrderValue(value ? String(Number(value.toFixed(2))) : '');
    if (px && px > 0) {
      const q = value / px;
      setQty(q ? (q >= 1 ? String(Number(q.toFixed(5))) : q.toPrecision(6).replace(/0+$/, '')) : '');
    }
  };

  const usePrice = (kind: 'mid' | 'bbo') => {
    if (kind === 'mid' && bid && ask) setPrice(String((bid + ask) / 2));
    if (kind === 'bbo') {
      const next = side === 'BUY' ? ask ?? bid ?? reference : bid ?? ask ?? reference;
      if (next) setPrice(String(next));
    }
  };

  const open = () => {
    if (!ready) return;
    openTicket({
      symbol,
      side,
      type: mode as OrderType,
      price: mode === 'LIMIT' && px ? px : undefined,
      quantity: mode === 'LIMIT' && derivedQty ? derivedQty : undefined,
      quoteQty: mode === 'MARKET' && derivedValue ? derivedValue : undefined,
      source: 'manual',
    });
  };

  return (
    <section className="card rail-ticket-card" data-side={side}>
      <div className="rail-ticket-side">
        <button className={`buy ${side === 'BUY' ? 'on' : ''}`} type="button" onClick={() => setSide('BUY')}>
          Buy
        </button>
        <button className={`sell ${side === 'SELL' ? 'on' : ''}`} type="button" onClick={() => setSide('SELL')}>
          Sell
        </button>
      </div>
      <div className="rail-ticket-modes">
        {(['LIMIT', 'MARKET', 'TWAP', 'SCALE'] as RailMode[]).map((m) => {
          const blocked = m === 'TWAP' || m === 'SCALE';
          return (
            <button key={m} className={mode === m ? 'on' : ''} type="button" disabled={blocked} onClick={() => setMode(m)} title={blocked ? `${m} is designed but not wired to the Binance spot sender yet` : `Draft a ${m.toLowerCase()} ticket`}>
              {m === 'SCALE' ? 'Scale' : m[0] + m.slice(1).toLowerCase()}
            </button>
          );
        })}
      </div>
      <div className="rail-ticket-field">
        <span>
          Price
          <em>
            <button type="button" onClick={() => usePrice('mid')} disabled={!bid || !ask}>
              Mid
            </button>
            <button type="button" onClick={() => usePrice('bbo')} disabled={!bid && !ask}>
              BBO
            </button>
          </em>
        </span>
        <label>
          <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} disabled={mode === 'MARKET'} placeholder={reference ? String(reference) : '0.00'} />
          <b>$</b>
        </label>
      </div>
      <div className="rail-ticket-field">
        <span>Quantity</span>
        <label>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={`0 ${base}`} />
          <b>{base}</b>
        </label>
      </div>
      <div className="rail-ticket-field">
        <span>Order value</span>
        <label>
          <input type="number" value={orderValue} onChange={(e) => setOrderValue(e.target.value)} placeholder="0.00" />
          <b>USDT</b>
        </label>
      </div>
      <div className="rail-ticket-slider">
        <input type="range" min="0" max="100" step="25" value={derivedValue ? Math.min(100, Math.round((derivedValue / cap) * 100)) : 0} onChange={(e) => setValuePct(Number(e.target.value))} />
        <span>
          <i>0</i>
          <i>25</i>
          <i>50</i>
          <i>75</i>
          <i>100%</i>
        </span>
      </div>
      <div className="rail-ticket-summary">
        <span>
          <b className="num">{derivedQty ? fmtQty(derivedQty) : '—'}</b>
          <em>{base} size</em>
        </span>
        <span>
          <b className="num">{fmtPrice(derivedValue)}</b>
          <em>draft value</em>
        </span>
      </div>
      <button className={`cta-pill ${side === 'BUY' ? 'buy' : 'danger'} rail-ticket-submit`} type="button" disabled={!ready} title={disabledReason} onClick={open}>
        Open guarded {side === 'BUY' ? 'buy' : 'sell'} ticket
      </button>
      <p>{unsupported ? disabledReason : 'No live send here. This opens Manual Trade with risk preview, filters, and typed confirmation.'}</p>
    </section>
  );
}

function MiniTelemetryChart({
  title,
  kicker,
  points,
  value,
  tone = '',
  kind = 'line',
}: {
  title: string;
  kicker?: string;
  points: { t: number; v: number; v2?: number }[];
  value: ReactNode;
  tone?: string;
  kind?: 'line' | 'bars';
}) {
  const model = useMemo(() => {
    const clean = points.filter((p) => Number.isFinite(p.v)).slice(-44);
    if (clean.length < 2) return null;
    const vals = kind === 'bars' ? clean.flatMap((p) => [p.v, p.v2 ?? 0]) : clean.map((p) => p.v);
    const min = Math.min(...vals, kind === 'bars' ? 0 : Infinity);
    const max = Math.max(...vals, 0);
    const span = Math.max(max - min, 1e-12);
    const w = 220;
    const h = 76;
    const x = (i: number) => (i / Math.max(clean.length - 1, 1)) * w;
    const y = (v: number) => h - ((v - min) / span) * (h - 10) - 5;
    const path = clean.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(p.v).toFixed(2)}`).join(' ');
    return { clean, w, h, min, max, x, y, path };
  }, [points, kind]);

  return (
    <div className="tele-card">
      <div className="tele-head">
        <span>
          <b>{title}</b>
          {kicker && <em>{kicker}</em>}
        </span>
        <strong className={`num ${tone}`}>{value}</strong>
      </div>
      <svg className="tele-chart" viewBox="0 0 220 76" preserveAspectRatio="none" aria-label={`${title} mini chart`}>
        {[18, 38, 58].map((y) => (
          <line key={y} x1="0" x2="220" y1={y} y2={y} className="tele-axis" />
        ))}
        {!model ? (
          <text x="110" y="42" textAnchor="middle" className="tele-empty">
            no data
          </text>
        ) : kind === 'bars' ? (
          model.clean.map((p, i) => {
            const bw = Math.max(2, 150 / model.clean.length);
            const x = model.x(i) - bw / 2;
            const y1 = model.y(p.v);
            const y2 = model.y(p.v2 ?? 0);
            return (
              <g key={`${p.t}-${i}`}>
                <rect x={x} y={y1} width={bw} height={Math.max(1, model.h - 5 - y1)} className="tele-bar up" />
                <rect x={x + bw + 1} y={y2} width={bw} height={Math.max(1, model.h - 5 - y2)} className="tele-bar down" />
              </g>
            );
          })
        ) : (
          <>
            <path d={`${model.path} L 220 76 L 0 76 Z`} className="tele-fill" />
            <path d={model.path} className="tele-line" />
          </>
        )}
      </svg>
    </div>
  );
}

export function TokenDetail({ symbol }: { symbol: string }) {
  const { markets, state, openTicket, toggleWatch, setPage, openLedger, importFills } = useStore();
  const [win, setWin] = useState<WinKey>('1m');
  const [mode, setMode] = useState<ChartMode>('tradingview');
  const [candles, setCandles] = useState<TvCandle[]>([]);
  const [chartStream, setChartStream] = useState<'connecting' | 'live' | 'poll'>('connecting');
  const [futK, setFutK] = useState<ChartPoint[]>([]);
  const [funding, setFunding] = useState<ChartPoint[]>([]);
  const [telemetry, setTelemetry] = useState<FuturesTelemetry | null>(null);
  const [telemetryBasis, setTelemetryBasis] = useState<ChartPoint[]>([]);
  const [detail, setDetail] = useState<MarketDetail | null>(null);
  const [ctx, setCtx] = useState<SymbolContext | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const live = markets.find((m) => m.symbol === symbol);
  const base = baseOf(symbol);
  const watchlisted = state?.config.watchlist.includes(symbol) ?? false;
  const hasPerp = live?.hasPerp ?? live?.perpMark !== null;

  const spotK = useMemo<ChartPoint[]>(() => candles.map((c) => ({ t: c.t, v: c.c })), [candles]);
  const volK = useMemo<ChartPoint[]>(() => candles.map((c) => ({ t: c.t, v: c.qv || c.v * c.c })), [candles]);

  // OHLCV candles (spot) + futures closes for basis. Spot uses real Binance
  // 1s candles when selected; futures 1s is not requested because USD-M REST
  // intervals are not consistently available at that granularity.
  useEffect(() => {
    const { interval, limit } = WINDOWS[win];
    let alive = true;
    const load = () => {
      void fetch(`/api/candles?symbol=${symbol}&interval=${interval}&limit=${limit}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && Array.isArray(d) && setCandles(d as TvCandle[]))
        .catch(() => undefined);
      if (interval === '1s') {
        setFutK([]);
      } else {
        void fetch(`/api/klines?symbol=${symbol}&interval=${interval}&limit=${limit}&market=futures`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => alive && d && setFutK(d as ChartPoint[]))
          .catch(() => setFutK([]));
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol, win]);

  useEffect(() => {
    const { interval, limit } = WINDOWS[win];
    let alive = true;
    setChartStream('connecting');
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`);
    ws.onopen = () => alive && setChartStream('live');
    ws.onmessage = (ev) => {
      if (!alive) return;
      try {
        const msg = JSON.parse(String(ev.data)) as BinanceKlineMsg;
        const k = msg.k;
        if (!k) return;
        const nextCandle: TvCandle = {
          t: k.t,
          o: Number(k.o),
          h: Number(k.h),
          l: Number(k.l),
          c: Number(k.c),
          v: Number(k.v),
          qv: Number(k.q) || Number(k.v) * Number(k.c),
        };
        setCandles((prev) => {
          const next = [...prev];
          const idx = next.findIndex((c) => c.t === nextCandle.t);
          if (idx >= 0) next[idx] = nextCandle;
          else next.push(nextCandle);
          next.sort((a, b) => a.t - b.t);
          return next.length > limit ? next.slice(next.length - limit) : next;
        });
      } catch {
        // malformed stream frame; ignore and wait for the next public tick
      }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => alive && setChartStream('poll');
    return () => {
      alive = false;
      ws.close();
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

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (!hasPerp) {
        setTelemetry(null);
        return;
      }
      void fetch(`/api/futures/telemetry?symbol=${symbol}&period=5m&limit=40`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setTelemetry(d as FuturesTelemetry))
        .catch(() => alive && setTelemetry(null));
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol, hasPerp]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (!hasPerp) {
        setTelemetryBasis([]);
        return;
      }
      void Promise.all([
        fetch(`/api/klines?symbol=${symbol}&interval=5m&limit=40&market=spot`).then((r) => (r.ok ? r.json() : [])),
        fetch(`/api/klines?symbol=${symbol}&interval=5m&limit=40&market=futures`).then((r) => (r.ok ? r.json() : [])),
      ])
        .then(([spot, fut]) => {
          if (!alive || !Array.isArray(spot) || !Array.isArray(fut)) return;
          const spotMap = new Map((spot as ChartPoint[]).map((p) => [p.t, p.v]));
          const out: ChartPoint[] = [];
          for (const f of fut as ChartPoint[]) {
            const s = spotMap.get(f.t);
            if (s && s > 0) out.push({ t: f.t, v: ((f.v - s) / s) * 100 });
          }
          setTelemetryBasis(out);
        })
        .catch(() => alive && setTelemetryBasis([]));
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol, hasPerp]);

  // detail + account context, polled (depth/trades live in <OrderBook> via WS)
  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetch(`/api/market/detail?symbol=${symbol}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setDetail(d as MarketDetail));
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

  const chartData = mode === 'tradingview' || mode === 'price' || mode === 'depth' ? spotK : mode === 'basis' ? basisSeries : mode === 'volume' ? volK : funding;
  const pctFmt = (v: number) => {
    let s = v.toFixed(3);
    if (parseFloat(s) === 0) s = s.replace('-', '');
    return `${parseFloat(s) > 0 ? '+' : ''}${s}%`;
  };

  // Range-aware axis/crosshair precision: a stablecoin's day trades in a
  // ±0.05% band — fmtPrice's default decimals would label every gridline
  // "$1.00". Widen decimals until the plotted range actually resolves.
  const chartPriceFmt = useMemo(() => {
    if (spotK.length < 2) return fmtPrice;
    let mn = Infinity;
    let mx = -Infinity;
    for (const p of spotK) {
      if (p.v < mn) mn = p.v;
      if (p.v > mx) mx = p.v;
    }
    const span = mx - mn;
    if (!(span > 0)) return fmtPrice;
    const needed = Math.ceil(-Math.log10(span / 30)); // ~30 distinguishable steps
      const dec = Math.max(2, Math.min(8, needed));
    return (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }, [spotK]);
  const spread =
    detail?.book && detail.book.bidPrice > 0
      ? ((detail.book.askPrice - detail.book.bidPrice) / detail.book.bidPrice) * 100
      : null;
  const spreadLabel = spread !== null ? `${spread.toFixed(4)}%` : '—';
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
    mode === 'depth'
      ? 'Binance spot depth20@100ms order book'
    : mode === 'tradingview'
        ? `TradingView Advanced Chart · BINANCE:${symbol}`
      : mode === 'basis'
      ? 'Binance spot + USD-M futures klines'
      : mode === 'funding'
        ? 'Binance settled funding history'
        : mode === 'volume'
          ? 'Binance spot quote-volume candles'
          : `TradingView canvas · Binance spot ${WINDOWS[win].interval} OHLCV`;
  const chartLatest =
    mode === 'tradingview'
      ? chartLast === null
        ? 'TradingView'
        : chartPriceFmt(chartLast)
      : mode === 'depth'
      ? detail?.book
        ? `${chartPriceFmt(detail.book.bidPrice)} / ${chartPriceFmt(detail.book.askPrice)}`
        : '—'
      : chartLast === null
        ? '—'
        : mode === 'price'
          ? chartPriceFmt(chartLast)
          : mode === 'volume'
            ? fmtMoney(chartLast)
            : pctFmt(chartLast);
  const chartMoveLabel =
    mode === 'tradingview'
      ? `TV interval ${win}`
      : mode === 'depth'
      ? `spread ${spreadLabel}`
      : chartMove === null
      ? '—'
      : mode === 'price' || mode === 'volume'
        ? fmtPct(chartMove, 2)
        : `${chartMove >= 0 ? '+' : ''}${chartMove.toFixed(3)} pts`;
  const dayAnchor =
    live?.spot !== null && live?.spot !== undefined && live?.change24hPct !== null && live?.change24hPct !== undefined && live.change24hPct !== -100
      ? live.spot / (1 + live.change24hPct / 100)
      : null;
  const dayMoveUsd = live?.spot !== null && live?.spot !== undefined && dayAnchor !== null ? live.spot - dayAnchor : null;
  const spotFirst = spotK.length ? spotK[0].v : null;
  const spotLast = spotK.length ? spotK[spotK.length - 1].v : null;
  const spotMove = spotFirst !== null && spotLast !== null && spotFirst !== 0 ? ((spotLast - spotFirst) / Math.abs(spotFirst)) * 100 : null;
  const chartRange =
    mode === 'tradingview'
      ? 'hosted live chart'
      : chartData.length
        ? `${fmtTimeShort(chartData[0].t)} → ${fmtTimeShort(chartData[chartData.length - 1].t)}`
        : 'Waiting for klines';
  const openOrders = ctx?.openOrders ?? [];
  const fills = ctx?.fills ?? [];
  const signals = ctx?.signals ?? [];
  const accountBaseValue = ctx && live?.spot !== null && live?.spot !== undefined ? ctx.balances.base * live.spot : null;
  const usdtFree = ctx?.balances.usdtFree ?? null;
  const importDisabledReason = !state?.binance.keysPresent ? 'Read-only Binance keys must be present on the server to import fills' : 'Import Binance fill history';
  const topSource = hasPerp ? 'Spot + USD-M perp' : 'Spot only';
  const chartModes = (hasPerp && win !== '1s' ? ['tradingview', 'price', 'depth', 'basis', 'funding', 'volume'] : ['tradingview', 'price', 'depth', 'volume']) as ChartMode[];
  const windowKeys = mode === 'tradingview' ? [...TV_WINS] : BINANCE_WINS;

  const chooseMode = (next: ChartMode) => {
    if ((next === 'tradingview' || next === 'basis' || next === 'funding') && win === '1s') setWin('1m');
    setMode(next);
  };

  const openOneSecond = () => {
    setMode('price');
    setWin('1s');
  };

  // If a spot-only token is opened while a perp-mode chart is selected, snap back.
  useEffect(() => {
    if (mode === 'tradingview' && win === '1s') setWin('1m');
    if (((live && !hasPerp) || win === '1s') && (mode === 'basis' || mode === 'funding')) setMode('price');
  }, [live, hasPerp, win, mode]);

  const oiLast = lastOf(telemetry?.openInterest);
  const oiFirst = telemetry?.openInterest?.[0];
  const topAccLast = lastOf(telemetry?.topAccountRatio);
  const topPosLast = lastOf(telemetry?.topPositionRatio);
  const globalLast = lastOf(telemetry?.globalRatio);
  const takerLast = lastOf(telemetry?.takerFlow);
  const fundingLast = lastOf(funding);
  const telemetryBasisSeries = basisSeries.length ? basisSeries : telemetryBasis;
  const basisLast = lastOf(telemetryBasisSeries);
  const oiMove =
    oiLast && oiFirst && oiFirst.notional > 0
      ? ((oiLast.notional - oiFirst.notional) / Math.abs(oiFirst.notional)) * 100
      : null;
  const telemetryLive = Boolean(telemetry?.available);

  return (
    <div className="container page token-detail-shell">
      <button className="back-link" onClick={() => setPage('markets')}>
        ← Markets
      </button>

      <section className="card token-market-strip">
        <div className="market-strip-main">
          <span className="tok token-strip-id">
            <TokenIcon symbol={symbol} size={84} />
            <span className="tok-meta">
              <span className="detail-name">{base}</span>
              <span className="detail-sub">
                <b>{symbol}</b>
                <span>{topSource}</span>
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
              {dayMoveUsd !== null ? `${fmtSignedPrice(dayMoveUsd)} ` : ''}
              {fmtPct(live?.change24hPct)} 24h
            </span>
          </div>
        </div>
        <div className="strip-metrics">
          {hasPerp ? (
            <>
              <StripMetric label="Perp mark" value={fmtPrice(live?.perpMark)} />
              <StripMetric label="Basis" value={fmtBasis(live?.basisPct)} tone={signClass(live?.basisPct)} />
              <StripMetric label="Funding" value={fmtFunding(live?.fundingRate)} tone={signClass(live?.fundingRate)} sub={`next ${countdown(live?.nextFundingTime)}`} />
            </>
          ) : (
            <StripMetric label="Market" value="Spot only" sub="no USD-M perp listed" />
          )}
          <StripMetric label="24h high" value={fmtPrice(live?.high24h)} />
          <StripMetric label="24h low" value={fmtPrice(live?.low24h)} />
          <StripMetric label="24h volume" value={fmtMoney(live?.quoteVolume24h)} />
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

      <nav className="token-section-tabs" aria-label={`${base} detail shortcuts`}>
        <button className={mode === 'tradingview' ? 'on' : ''} type="button" onClick={() => chooseMode('tradingview')}>
          Live TradingView
        </button>
        <button className={mode === 'price' && win === '1s' ? 'on' : ''} type="button" onClick={openOneSecond}>
          Binance 1s
        </button>
        <button className={mode === 'depth' ? 'on' : ''} type="button" onClick={() => chooseMode('depth')}>
          Depth
        </button>
        {hasPerp && (
          <button className={mode === 'basis' ? 'on' : ''} type="button" onClick={() => chooseMode('basis')}>
            Basis
          </button>
        )}
        <button type="button" onClick={() => openTicket({ symbol, side: 'BUY', source: 'manual' })}>
          Ticket
        </button>
        <button type="button" onClick={() => setPage('orders')}>
          Orders
        </button>
        <button type="button" onClick={() => openLedger(symbol)}>
          Ledger
        </button>
      </nav>

      <div className="token-workspace">
        <aside className="card token-asset-card">
          <div className="asset-identity">
            <TokenIcon symbol={symbol} size={58} />
            <span>
              <span className="asset-title">Execution dock</span>
              <span className="asset-subtitle">{base}/USDT · private account context</span>
            </span>
          </div>
          <p className="asset-copy">
            One-symbol workspace for price, depth, funding, account exposure, open orders, fills, and the manual ticket.
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
            <button className="mini-btn" onClick={() => openLedger(symbol)}>
              Ledger trail →
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
              <span>
              {chartSource} · {chartRange}
              {mode === 'price' && (
                  <span className={`chart-stream-state ${chartStream === 'live' ? 'on' : ''}`}>
                    <span />
                    {chartStream === 'live' ? 'live kline' : chartStream === 'connecting' ? 'connecting' : 'REST fallback'}
                  </span>
                )}
              </span>
            </span>
            <span className={`chart-latest num ${signClass(chartMove)}`}>
              {chartLatest}
              <small>{chartMoveLabel}</small>
            </span>
          </div>
          <div className="chart-head token-chart-controls">
            <div className="seg">
              {chartModes.map((m) => (
                <button key={m} className={mode === m ? 'on' : ''} onClick={() => chooseMode(m)}>
                  {m === 'tradingview' ? 'TradingView' : m === 'price' ? 'Binance spot' : m === 'depth' ? 'Depth' : m === 'basis' ? 'Basis' : m === 'funding' ? 'Funding' : 'Volume'}
                </button>
              ))}
            </div>
            {mode !== 'funding' && (
              <div className="win">
                {windowKeys.map((w) => (
                  <button key={w} className={win === w ? 'on' : ''} onClick={() => setWin(w)}>
                    {w}
                  </button>
                ))}
              </div>
            )}
            <div className="spacer" />
            <span className="sec-note num">
              {mode === 'tradingview'
                ? 'official TradingView widget; use Binance spot for 1s'
                : mode === 'depth'
                ? 'live top-20 spot depth, centered on mid'
                : mode === 'basis'
                ? 'spot vs perp close, same candles'
                : mode === 'funding'
                  ? 'settled funding, last 120 intervals'
                : mode === 'volume'
                  ? 'quote volume per candle'
                    : win === '1s'
                      ? 'real Binance 1s spot candles'
                      : hasPerp
                        ? `funding ${fmtFunding(live?.fundingRate)} in ${countdown(live?.nextFundingTime)}`
                        : 'spot market · no perp funding'}
            </span>
          </div>
          {mode === 'tradingview' ? (
            <TradingViewWidget symbol={symbol} win={win} height={520} />
          ) : mode === 'depth' ? (
            <DepthChart symbol={symbol} base={base} height={520} />
          ) : (
            <TradingViewChart
              candles={mode === 'price' ? candles : undefined}
              points={mode === 'price' ? undefined : chartData}
              kind={mode === 'price' ? 'candles' : mode === 'volume' ? 'histogram' : 'line'}
              height={520}
              color={mode === 'price' || mode === 'volume' ? brandColor(symbol) : undefined}
              valueFmt={mode === 'price' ? chartPriceFmt : mode === 'volume' ? fmtMoney : pctFmt}
              resetKey={`${symbol}-${win}-${mode}`}
            />
          )}
        </section>

        <aside className="token-rail-stack">
          <TokenRailTicket
            symbol={symbol}
            base={base}
            bid={detail?.book?.bidPrice}
            ask={detail?.book?.askPrice}
            last={live?.spot ?? detail?.last}
            maxOrderNotional={state?.config.maxOrderNotionalUsd}
            openTicket={openTicket}
          />
          <OrderBook
            symbol={symbol}
            base={base}
            footerActions={
              <>
                <button className="mini-btn" type="button" onClick={() => setPage('fills')}>
                  Fills
                </button>
                <button className="mini-btn" type="button" onClick={() => setPage('orders')}>
                  Orders
                </button>
                <button className="cta-pill buy micro-ticket-btn" type="button" onClick={() => openTicket({ symbol, side: 'BUY', source: 'manual' })}>
                  Ticket
                </button>
              </>
            }
          />
        </aside>
      </div>

      {hasPerp && (
        <section className="card futures-telemetry-panel">
          <div className="token-panel-head telemetry-head">
            <span>
              <h3>Futures telemetry</h3>
              <span>
                Binance USD-M public data · {telemetry?.period ?? '5m'} modules
                {telemetry?.errors?.length ? ` · partial (${telemetry.errors.length})` : ''}
              </span>
            </span>
            <span className={`chart-stream-state ${telemetryLive ? 'on' : ''}`}>
              <span />
              {telemetryLive ? 'public data live' : 'waiting'}
            </span>
          </div>
          <div className="tele-grid">
            <MiniTelemetryChart
              title="Open Interest"
              kicker={oiMove === null ? 'contracts + notional' : `${fmtPct(oiMove, 2)} window`}
              points={(telemetry?.openInterest ?? []).map((p) => ({ t: p.t, v: p.notional }))}
              value={fmtCompact(oiLast?.notional)}
              tone={signClass(oiMove)}
            />
            <MiniTelemetryChart
              title="Top Trader L/S"
              kicker="accounts"
              points={(telemetry?.topAccountRatio ?? []).map((p) => ({ t: p.t, v: p.ratio }))}
              value={topAccLast ? `${topAccLast.ratio.toFixed(2)}x` : '—'}
              tone={topAccLast ? (topAccLast.ratio >= 1 ? 'up' : 'down') : ''}
            />
            <MiniTelemetryChart
              title="Top Position L/S"
              kicker="positions"
              points={(telemetry?.topPositionRatio ?? []).map((p) => ({ t: p.t, v: p.ratio }))}
              value={topPosLast ? `${topPosLast.ratio.toFixed(2)}x` : '—'}
              tone={topPosLast ? (topPosLast.ratio >= 1 ? 'up' : 'down') : ''}
            />
            <MiniTelemetryChart
              title="Global L/S"
              kicker={globalLast ? `${globalLast.longPct.toFixed(1)}% long` : 'accounts'}
              points={(telemetry?.globalRatio ?? []).map((p) => ({ t: p.t, v: p.ratio }))}
              value={globalLast ? `${globalLast.ratio.toFixed(2)}x` : '—'}
              tone={globalLast ? (globalLast.ratio >= 1 ? 'up' : 'down') : ''}
            />
            <MiniTelemetryChart
              title="Taker Flow"
              kicker="buy vs sell volume"
              kind="bars"
              points={(telemetry?.takerFlow ?? []).map((p) => ({ t: p.t, v: p.buyVol, v2: p.sellVol }))}
              value={takerLast ? `${takerLast.ratio.toFixed(2)}x` : '—'}
              tone={takerLast ? (takerLast.ratio >= 1 ? 'up' : 'down') : ''}
            />
            <MiniTelemetryChart
              title="Basis"
              kicker="spot vs perp"
              points={telemetryBasisSeries.map((p) => ({ t: p.t, v: p.v }))}
              value={basisLast ? fmtBasis(basisLast.v, 3) : fmtBasis(live?.basisPct, 3)}
              tone={signClass(basisLast?.v ?? live?.basisPct)}
            />
            <MiniTelemetryChart
              title="Funding Rate"
              kicker="settled intervals"
              points={funding.map((p) => ({ t: p.t, v: p.v }))}
              value={fundingLast ? pctFmt(fundingLast.v) : fmtFunding(live?.fundingRate)}
              tone={signClass(fundingLast?.v ?? live?.fundingRate)}
            />
          </div>
        </section>
      )}

      <div className="token-data-grid">
        <DataPanel title="Trading insights" kicker="basis scanner">
          {hasPerp ? (
            <>
              <DataRow label="Scanner state" value={live?.status ?? '—'} control={<span className={`chip-tag ${live?.status === 'signal' ? 'gold' : 'ok'}`}>{live?.status ?? 'unknown'}</span>} />
              <DataRow label="Basis" value={fmtBasis(live?.basisPct)} tone={signClass(live?.basisPct)} sub="spot/perp mark spread" />
              <DataRow label="Funding carry" value={fmtFunding(live?.fundingRate)} tone={signClass(live?.fundingRate)} sub={`next ${countdown(live?.nextFundingTime)}`} />
            </>
          ) : (
            <DataRow label="Perp market" value="not listed" sub="basis scanner needs a USD-M perp" control={<span className="chip-tag">spot only</span>} />
          )}
          <DataRow label="Spot 24h move" value={fmtPct(live?.change24hPct)} tone={signClass(live?.change24hPct)} />
        </DataPanel>

        <DataPanel title="Market stats" kicker="direct Binance">
          <DataRow label="Spot last" value={fmtPrice(live?.spot ?? detail?.last)} />
          {hasPerp && <DataRow label="Perp mark" value={fmtPrice(live?.perpMark)} />}
          <DataRow label="24h high / low" value={live?.high24h != null && live?.low24h != null ? `${fmtPrice(live.high24h)} / ${fmtPrice(live.low24h)}` : '—'} />
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
            <div className="token-empty-action">
              <span>No orders or fills for {symbol} yet.</span>
              <button className="mini-btn" type="button" onClick={() => setPage('orders')}>Open orders</button>
              <button className="mini-btn" type="button" onClick={() => setPage('fills')}>Open fills</button>
            </div>
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

/* Token page — Coinbase chart anatomy on top, Binance token-data base below:
   Money Flow Analysis (real spot aggTrades, size-bucketed, animated sweep),
   Open Interest (bars + notional line), and Basis (futures/index/basis area)
   — all straight from Binance endpoints, one template for every token, with
   honest spot-only fallbacks. The second base row is reserved (owner). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { TokenIcon } from '../components/TokenIcon';
import { PillSelect, Star } from '../components/PillSelect';
import { type TvCandle } from '../components/TradingViewChart';
import { TradingViewWidget } from '../components/TradingViewWidget';
import { IconClose, IconExternal, IconMaximize, IconSearch } from '../components/Icons';
import { fmtPrice, fmtPct, baseOf } from '../format';
import { tokenName } from '../lib/tokenNames';
import './Markets.css';

/* Coinbase lookback ranges — 1S through ALL, every one real Binance klines. */
const RANGES = {
  '1S': { interval: '1s', limit: 600 },
  '1H': { interval: '1m', limit: 60 },
  '1D': { interval: '5m', limit: 288 },
  '1W': { interval: '1h', limit: 168 },
  '1M': { interval: '4h', limit: 180 },
  '1Y': { interval: '1d', limit: 365 },
  ALL: { interval: '1w', limit: 1000 },
} as const;
type RangeKey = keyof typeof RANGES;
const RANGE_KEYS = Object.keys(RANGES) as RangeKey[];

/* The full Binance interval menu (the TradingView picker set): 1s → 1 month. */
const INTERVALS = ['1s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'] as const;
type IntervalKey = (typeof INTERVALS)[number];
const INTERVAL_LIMIT: Record<IntervalKey, number> = {
  '1s': 600, '1m': 720, '3m': 640, '5m': 576, '15m': 672, '30m': 672,
  '1h': 720, '2h': 540, '4h': 540, '6h': 500, '8h': 500, '12h': 500,
  '1d': 365, '3d': 400, '1w': 520, '1M': 120,
};
const INTERVAL_LABEL: Record<IntervalKey, string> = {
  '1s': '1s', '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '8h': '8H', '12h': '12H',
  '1d': '1D', '3d': '3D', '1w': '1W', '1M': '1Mo',
};

interface BinanceKlineMsg {
  k?: { t: number; o: string; h: string; l: string; c: string; v: string; q: string };
}

interface TokenProfile {
  name: string;
  rank: number | null;
  homepage: string | null;
  whitepaper: string | null;
}

interface MoneyFlow {
  symbol: string;
  window: string;
  large: { buy: number; sell: number };
  medium: { buy: number; sell: number };
  small: { buy: number; sell: number };
  totalBuy: number;
  totalSell: number;
  inflow: number;
  trades: number;
  coveredMs: number;
  windowMs: number;
  sampled: boolean;
}

interface OiPoint { t: number; contracts: number; notional: number }
interface BasisPoint { t: number; futuresPrice: number; indexPrice: number; basis: number; basisRatePct: number }

function fmtCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
}

function lastOf<T>(arr: T[] | undefined): T | undefined {
  return arr && arr.length ? arr[arr.length - 1] : undefined;
}

/** Colored change fragment: arrow + value, green/red/neutral. */
function Chg({ pct, children }: { pct: number | null | undefined; children?: React.ReactNode }) {
  if (pct === null || pct === undefined || !Number.isFinite(pct) || Math.abs(pct) < 0.005) {
    return <span className="tdx-chg flat">{children ?? '0.00%'}</span>;
  }
  const up = pct > 0;
  return (
    <span className={`tdx-chg ${up ? 'up' : 'down'}`}>
      <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden>
        {up ? <path d="M2 8.5L6 4l4 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            : <path d="M2 3.5L6 8l4-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
      {children ?? fmtPct(Math.abs(pct), 2, false)}
    </span>
  );
}

/** The Coinbase chart: smooth line over a dotted area fill, axis right. */
function PriceChart({ points, up }: { points: { t: number; v: number }[]; up: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [chartWidth, setChartWidth] = useState(1080);
  useEffect(() => {
    const host = svgRef.current?.parentElement;
    if (!host) return;
    const measure = () => {
      const width = host.getBoundingClientRect().width;
      if (Number.isFinite(width) && width > 0) {
        setChartWidth((prev) => {
          const next = Math.round(width);
          return Math.abs(prev - next) > 2 ? next : prev;
        });
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const W = chartWidth;
  const H = Math.round(Math.max(480, Math.min(780, W * 0.32)));
  const PAD_R = 110;
  const PAD_B = 34;
  const model = useMemo(() => {
    if (points.length < 2) return null;
    const vs = points.map((p) => p.v);
    let mn = Math.min(...vs);
    let mx = Math.max(...vs);
    if (mx - mn < mx * 1e-9) { mx *= 1.0005; mn *= 0.9995; }
    const span = mx - mn;
    mn -= span * 0.22; mx += span * 0.22; // Coinbase-style headroom — the line never fills edge to edge
    const y = (v: number) => ((mx - v) / (mx - mn)) * (H - PAD_B);
    let pts = points;
    if (pts.length > 160) {
      const step = (pts.length - 1) / 159;
      pts = Array.from({ length: 160 }, (_, i) => points[Math.round(i * step)]);
    }
    const xy = pts.map((p, i) => [(i / (pts.length - 1)) * (W - PAD_R), y(p.v)] as const);
    let d = `M${xy[0][0]},${xy[0][1]}`;
    for (let i = 0; i < xy.length - 1; i++) {
      const p0 = xy[Math.max(0, i - 1)];
      const p1 = xy[i];
      const p2 = xy[i + 1];
      const p3 = xy[Math.min(xy.length - 1, i + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
    }
    const area = `${d} L${xy[xy.length - 1][0]},${H - PAD_B} L${xy[0][0]},${H - PAD_B} Z`;
    const ticks = Array.from({ length: 5 }, (_, i) => mn + ((i + 0.5) / 5) * (mx - mn));
    const times = Array.from({ length: 7 }, (_, i) => points[Math.round((i / 6) * (points.length - 1))].t);
    const spanMs = points[points.length - 1].t - points[0].t;
    const timeFmt = (t: number) => {
      const dte = new Date(t);
      if (spanMs < 864e5 * 2) return dte.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      if (spanMs < 864e5 * 400) return dte.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return dte.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    };
    const last = xy[xy.length - 1];
    return { d, area, ticks, y, times, timeFmt, last };
  }, [H, W, points]);

  if (!model) return <div className="tdx-chart-empty">Waiting For Candles…</div>;
  const stroke = up ? 'var(--up)' : 'var(--down)';
  return (
    <svg ref={svgRef} className="tdx-chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <defs>
        <pattern id="tdx-dots" width="7" height="7" patternUnits="userSpaceOnUse">
          <circle cx="1.4" cy="1.4" r="1.15" fill={stroke} opacity="0.22" />
        </pattern>
      </defs>
      {model.ticks.map((v, i) => (
        <g key={i}>
          <line x1={0} x2={W - PAD_R} y1={model.y(v)} y2={model.y(v)} stroke="var(--line)" strokeWidth="1" />
          <text x={W - PAD_R + 12} y={model.y(v) + 4} className="tdx-axis">{fmtPrice(v)}</text>
        </g>
      ))}
      <path d={model.area} fill="url(#tdx-dots)" />
      <path d={model.d} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={model.last[0]} cy={model.last[1]} r="4.5" fill={stroke} />
      {model.times.map((t, i) => (
        <text key={i} x={(i / 6) * (W - PAD_R)} y={H - 8} className="tdx-axis" textAnchor={i === 0 ? 'start' : i === 6 ? 'end' : 'middle'}>
          {model.timeFmt(t)}
        </text>
      ))}
    </svg>
  );
}

/* ==== Binance hover tooltip (measured on binance.com trading-data):
   floating opaque box — "MM/DD HH:mm" header + one full-precision row per
   series — following the cursor, nearest point highlighted. ==== */
function fmtFull(v: number, dec = 2): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function tipTime(t: number): string {
  const d = new Date(t);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ChartTip({ x, w, title, rows }: { x: number; w: number; title: string; rows: { dot: string; label: string; value: string }[] }) {
  const right = x > w * 0.55;
  return (
    <div className="tdx-tip" style={right ? { right: w - x + 14 } : { left: x + 14 }}>
      <b>{title}</b>
      {rows.map((r) => (
        <span key={r.label}><i style={{ background: r.dot }} />{r.label}: <em>{r.value}</em></span>
      ))}
    </div>
  );
}

/* ==== TASK 1: Money Flow Analysis — Binance widget, real aggTrades ======== */
const FLOW_COLORS = {
  largeBuy: 'color-mix(in srgb, var(--up) 88%, black)',
  mediumBuy: 'var(--up)',
  smallBuy: 'color-mix(in srgb, var(--up) 38%, white)',
  smallSell: 'color-mix(in srgb, var(--down) 32%, white)',
  mediumSell: 'var(--down)',
  largeSell: 'color-mix(in srgb, var(--down) 85%, black)',
} as const;
type FlowKey = keyof typeof FLOW_COLORS;
const FLOW_LABEL: Record<FlowKey, string> = {
  largeBuy: 'Large Buy', mediumBuy: 'Medium Buy', smallBuy: 'Small Buy',
  smallSell: 'Small Sell', mediumSell: 'Medium Sell', largeSell: 'Large Sell',
};

function MoneyFlowCard({ symbol, base }: { symbol: string; base: string }) {
  const [win, setWin] = useState<'15m' | '1h' | '4h' | '1d'>('15m');
  const [flow, setFlow] = useState<MoneyFlow | null>(null);
  const [sweep, setSweep] = useState(0);
  const [hov, setHov] = useState<FlowKey | null>(null);
  const [hovBucket, setHovBucket] = useState<'Large' | 'Medium' | 'Small' | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    setFlow(null);
    const load = () => {
      void fetch(`/api/token/moneyflow?symbol=${symbol}&window=${win}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setFlow(d as MoneyFlow))
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [symbol, win]);

  // The Binance sweep: rAF-driven (CSS keyframes freeze at fractional zoom).
  // Animates on load and window/symbol change only — a background 60s poll
  // must never reset a drawn donut (rAF freezes in hidden tabs).
  const animKey = `${symbol}:${win}`;
  const lastAnimRef = useRef('');
  useEffect(() => {
    if (!flow) return;
    if (lastAnimRef.current === animKey) {
      setSweep(1);
      return;
    }
    lastAnimRef.current = animKey;
    setSweep(0);
    const t0 = performance.now();
    const DUR = 750;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / DUR);
      setSweep(1 - Math.pow(1 - p, 3)); // easeOutCubic
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [flow, animKey]);

  const total = flow ? flow.totalBuy + flow.totalSell : 0;
  const segs = flow && total > 0
    ? ([
        { key: 'largeBuy' as FlowKey, v: flow.large.buy },
        { key: 'mediumBuy' as FlowKey, v: flow.medium.buy },
        { key: 'smallBuy' as FlowKey, v: flow.small.buy },
        { key: 'smallSell' as FlowKey, v: flow.small.sell },
        { key: 'mediumSell' as FlowKey, v: flow.medium.sell },
        { key: 'largeSell' as FlowKey, v: flow.large.sell },
      ])
    : [];

  const R = 46;
  const CIRC = 2 * Math.PI * R;
  let acc = 0;
  const drawn = segs.map((s) => {
    const frac = s.v / total;
    const seg = { ...s, frac, start: acc, color: FLOW_COLORS[s.key] };
    acc += frac;
    return seg;
  });

  const bucketOf = (k: FlowKey): 'Large' | 'Medium' | 'Small' =>
    k.startsWith('large') ? 'Large' : k.startsWith('medium') ? 'Medium' : 'Small';
  const isHot = (k: FlowKey) => hov === k || (hovBucket !== null && bucketOf(k) === hovBucket);
  const hovSeg = drawn.find((s) => s.key === hov) ?? null;

  const rows = flow
    ? [
        { label: 'Large' as const, buy: flow.large.buy, sell: flow.large.sell, kb: 'largeBuy' as FlowKey, ks: 'largeSell' as FlowKey },
        { label: 'Medium' as const, buy: flow.medium.buy, sell: flow.medium.sell, kb: 'mediumBuy' as FlowKey, ks: 'mediumSell' as FlowKey },
        { label: 'Small' as const, buy: flow.small.buy, sell: flow.small.sell, kb: 'smallBuy' as FlowKey, ks: 'smallSell' as FlowKey },
      ]
    : [];

  return (
    <section className="tdx-cell tdx-third">
      <div className="tdx-cardhead">
        <h3 title="Taker-side spot volume by order size. Large ≥ $100K · Medium $10K–$100K · Small < $10K per aggregate trade. Source: Binance aggTrades.">
          Money Flow Analysis <em className="tdx-src">Binance Spot</em>
        </h3>
        <PillSelect
          value={win}
          options={[{ id: '15m' as const, label: '15m' }, { id: '1h' as const, label: '1H' }, { id: '4h' as const, label: '4H' }, { id: '1d' as const, label: '1D' }]}
          onChange={setWin}
          ariaLabel="Money flow window"
        />
      </div>
      {!flow ? (
        <div className="tdx-chart-empty small">Reading Trades…</div>
      ) : total <= 0 ? (
        <p className="tdx-dimnote">No trades in the window.</p>
      ) : (
        <>
          <div
            ref={wrapRef}
            className="tdx-flow-donutwrap"
            onMouseMove={(e) => {
              const r = wrapRef.current?.getBoundingClientRect();
              if (r) setMouse({ x: e.clientX - r.left, y: e.clientY - r.top });
            }}
            onMouseLeave={() => { setHov(null); setMouse(null); }}
          >
            <svg viewBox="0 0 300 158" className="tdx-flow-donut" aria-hidden>
              <g transform="translate(150,79)">
                {drawn.map((s) => {
                  const visFrac = Math.max(0, Math.min(s.frac, sweep - s.start));
                  if (visFrac <= 0.0001) return null;
                  return (
                    <circle
                      key={s.key}
                      r={R}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={isHot(s.key) ? 25 : 19}
                      opacity={hov === null && hovBucket === null ? 1 : isHot(s.key) ? 1 : 0.35}
                      strokeDasharray={`${visFrac * CIRC} ${CIRC}`}
                      transform={`rotate(${s.start * 360 - 90})`}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={() => setHov(s.key)}
                      onMouseLeave={() => setHov(null)}
                    />
                  );
                })}
                {drawn.filter((s) => s.frac > 0.0005).map((s) => {
                  const mid = (s.start + s.frac / 2) * 2 * Math.PI - Math.PI / 2;
                  const x1 = Math.cos(mid) * (R + 13);
                  const y1 = Math.sin(mid) * (R + 13);
                  const x2 = Math.cos(mid) * (R + 22);
                  const y2 = Math.sin(mid) * (R + 22);
                  const right = Math.cos(mid) >= 0;
                  return (
                    <g key={`lbl-${s.key}`} opacity={sweep > s.start + s.frac / 2 ? 1 : 0}>
                      <path d={`M${x1},${y1} L${x2},${y2} L${x2 + (right ? 8 : -8)},${y2}`} fill="none" stroke={s.color} strokeWidth="1.1" />
                      <text x={x2 + (right ? 11 : -11)} y={y2 + 3.5} textAnchor={right ? 'start' : 'end'} className="tdx-flow-pct">
                        {(s.frac * 100).toFixed(2)} %
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
            {hovSeg && mouse && (
              <ChartTip
                x={mouse.x}
                w={wrapRef.current?.clientWidth ?? 300}
                title={FLOW_LABEL[hovSeg.key]}
                rows={[{ dot: hovSeg.color, label: base, value: `${fmtFull(hovSeg.v, hovSeg.v < 100 ? 4 : 2)} (${(hovSeg.frac * 100).toFixed(2)}%)` }]}
              />
            )}
          </div>
          <div className="tdx-flow-table">
            <div className="tdx-flow-row head">
              <span>Orders</span>
              <span>Buy ({base})</span>
              <span>Sell ({base})</span>
              <span>Inflow</span>
            </div>
            {rows.map((r) => (
              <div
                key={r.label}
                className={`tdx-flow-row${hovBucket === r.label ? ' hot' : ''}`}
                onMouseEnter={() => setHovBucket(r.label)}
                onMouseLeave={() => setHovBucket(null)}
              >
                <span>{r.label}</span>
                <span><i style={{ background: FLOW_COLORS[r.kb] }} />{fmtCompact(r.buy)}</span>
                <span><i style={{ background: FLOW_COLORS[r.ks] }} />{fmtCompact(r.sell)}</span>
                <span>{fmtCompact(r.buy - r.sell)}</span>
              </div>
            ))}
            <div className="tdx-flow-row total">
              <span>Total</span>
              <span>{fmtCompact(flow.totalBuy)}</span>
              <span>{fmtCompact(flow.totalSell)}</span>
              <span>{fmtCompact(flow.inflow)}</span>
            </div>
          </div>
          {flow.sampled && (
            <p className="tdx-updated">Most recent {Math.round((flow.coveredMs / flow.windowMs) * 100)}% of the window · {flow.trades.toLocaleString('en-US')} trades</p>
          )}
        </>
      )}
    </section>
  );
}

/* ==== TASK 2: Open Interest — Binance futures token data ================== */
function OiCard({ symbol, base, hasPerp }: { symbol: string; base: string; hasPerp: boolean }) {
  const [period, setPeriod] = useState<'5m' | '1h' | '4h' | '1d'>('1d');
  const [rows, setRows] = useState<OiPoint[]>([]);
  const [hov, setHov] = useState<number | null>(null);
  const [mouse, setMouse] = useState<{ x: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasPerp) return;
    let alive = true;
    setRows([]);
    setHov(null);
    const load = () => {
      void fetch(`/api/futures/oi-hist?symbol=${symbol}&period=${period}&limit=${period === '1d' ? 30 : 48}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && Array.isArray(d) && setRows(d as OiPoint[]))
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [symbol, period, hasPerp]);

  const W = 560;
  const H = 380;
  const PAD_L = 58;
  const PAD_R = 74;
  const PAD_B = 30;
  const PAD_T = 12;
  const model = useMemo(() => {
    if (rows.length < 3) return null;
    const cs = rows.map((r) => r.contracts);
    const ns = rows.map((r) => r.notional);
    const cMin = Math.min(...cs) * 0.995;
    const cMax = Math.max(...cs) * 1.005;
    const nMin = Math.min(...ns) * 0.995;
    const nMax = Math.max(...ns) * 1.005;
    const x = (i: number) => PAD_L + ((i + 0.5) / rows.length) * (W - PAD_L - PAD_R);
    const cy = (v: number) => PAD_T + ((cMax - v) / (cMax - cMin)) * (H - PAD_T - PAD_B);
    const ny = (v: number) => PAD_T + ((nMax - v) / (nMax - nMin)) * (H - PAD_T - PAD_B);
    const bw = Math.max(2, ((W - PAD_L - PAD_R) / rows.length) * 0.45);
    const line = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${ny(r.notional)}`).join(' ');
    const cTicks = Array.from({ length: 3 }, (_, i) => cMin + ((i + 0.5) / 3) * (cMax - cMin));
    const nTicks = Array.from({ length: 3 }, (_, i) => nMin + ((i + 0.5) / 3) * (nMax - nMin));
    const times = [0, Math.floor(rows.length / 2), rows.length - 1];
    return { x, cy, ny, bw, line, cTicks, nTicks, times };
  }, [rows]);

  const idxFromMouse = (clientX: number): number | null => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r || !rows.length) return null;
    const xv = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((xv - PAD_L) / (W - PAD_L - PAD_R)) * rows.length - 0.5);
    return i >= 0 && i < rows.length ? i : null;
  };

  return (
    <section className="tdx-cell tdx-third">
      <div className="tdx-cardhead">
        <h3 title="Binance USD-M open interest history: bars = open interest in base units (left axis), line = notional value in USDT (right axis).">
          Open Interest <em className="tdx-src">Binance USD-M</em>
        </h3>
        {hasPerp && (
          <PillSelect
            value={period}
            options={[{ id: '5m' as const, label: '5m' }, { id: '1h' as const, label: '1H' }, { id: '4h' as const, label: '4H' }, { id: '1d' as const, label: '1D' }]}
            onChange={setPeriod}
            ariaLabel="Open interest period"
          />
        )}
      </div>
      {!hasPerp ? (
        <p className="tdx-dimnote">Spot Only — {base} has no Binance USD-M perpetual.</p>
      ) : !model ? (
        <div className="tdx-chart-empty small">Reading Open Interest…</div>
      ) : (
        <>
          <div
            ref={wrapRef}
            className="tdx-chartwrap"
            onMouseMove={(e) => {
              const i = idxFromMouse(e.clientX);
              setHov(i);
              const r = wrapRef.current?.getBoundingClientRect();
              if (r) setMouse({ x: e.clientX - r.left });
            }}
            onMouseLeave={() => { setHov(null); setMouse(null); }}
          >
            <svg viewBox={`0 0 ${W} ${H}`} className="tdx-datachart" aria-hidden>
              {model.cTicks.map((v, i) => (
                <text key={`c${i}`} x={PAD_L - 8} y={model.cy(v) + 4} textAnchor="end" className="tdx-axis">{fmtCompact(v)}</text>
              ))}
              {model.nTicks.map((v, i) => (
                <g key={`n${i}`}>
                  <line x1={PAD_L} x2={W - PAD_R} y1={model.ny(v)} y2={model.ny(v)} stroke="var(--line)" strokeWidth="1" />
                  <text x={W - PAD_R + 8} y={model.ny(v) + 4} className="tdx-axis">{fmtCompact(v)}</text>
                </g>
              ))}
              {hov !== null && (
                <line x1={model.x(hov)} x2={model.x(hov)} y1={PAD_T} y2={H - PAD_B} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />
              )}
              {rows.map((r, i) => (
                <rect key={r.t} x={model.x(i) - model.bw / 2} y={model.cy(r.contracts)} width={model.bw} height={Math.max(1, H - PAD_B - model.cy(r.contracts))} fill="#F0B90B" opacity={hov === null ? 0.85 : hov === i ? 1 : 0.35} />
              ))}
              <path d={model.line} fill="none" stroke="var(--text)" strokeWidth="1.6" strokeLinejoin="round" />
              {rows.map((r, i) => (
                <circle key={`d${r.t}`} cx={model.x(i)} cy={model.ny(r.notional)} r={hov === i ? 4 : 2.6} fill="var(--panel)" stroke="var(--text)" strokeWidth={hov === i ? 1.8 : 1.3} />
              ))}
              {model.times.map((i) => (
                <text key={`t${i}`} x={model.x(i)} y={H - 8} textAnchor="middle" className="tdx-axis">
                  {new Date(rows[i].t).toLocaleDateString('en-US', period === '1d' ? { month: 'numeric', day: 'numeric' } : { hour: 'numeric', minute: '2-digit' })}
                </text>
              ))}
            </svg>
            {hov !== null && mouse && (
              <ChartTip
                x={mouse.x}
                w={wrapRef.current?.clientWidth ?? W}
                title={tipTime(rows[hov].t)}
                rows={[
                  { dot: '#F0B90B', label: `Open Interest (${base})`, value: fmtFull(rows[hov].contracts, 3) },
                  { dot: 'var(--text)', label: 'Notional Value of OI (USDT)', value: fmtFull(rows[hov].notional, 2) },
                ]}
              />
            )}
          </div>
          <div className="tdx-legend">
            <span><i className="sw" style={{ background: '#F0B90B' }} />Open Interest ({base})</span>
            <span><i className="dot" />Notional Value Of OI (USDT)</span>
          </div>
        </>
      )}
    </section>
  );
}

/* ==== TASK 3: Basis — Binance futures token data =========================== */
function BasisCard({ symbol, base, hasPerp }: { symbol: string; base: string; hasPerp: boolean }) {
  const [period, setPeriod] = useState<'5m' | '1h' | '4h' | '1d'>('1h');
  const [rows, setRows] = useState<BasisPoint[]>([]);
  const [hov, setHov] = useState<number | null>(null);
  const [mouse, setMouse] = useState<{ x: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasPerp) return;
    let alive = true;
    setRows([]);
    setHov(null);
    const load = () => {
      void fetch(`/api/futures/basis-hist?symbol=${symbol}&period=${period}&limit=48`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && Array.isArray(d) && setRows((d as BasisPoint[]).filter((p) => p.futuresPrice > 0)))
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [symbol, period, hasPerp]);

  const W = 560;
  const H = 380;
  const PAD_L = 74;
  const PAD_R = 58;
  const PAD_B = 30;
  const PAD_T = 12;
  const model = useMemo(() => {
    if (rows.length < 3) return null;
    const prices = rows.flatMap((r) => [r.futuresPrice, r.indexPrice]);
    let pMin = Math.min(...prices);
    let pMax = Math.max(...prices);
    const pad = Math.max((pMax - pMin) * 0.08, pMax * 1e-6);
    pMin -= pad; pMax += pad;
    const bs = rows.map((r) => r.basis);
    let bMin = Math.min(...bs, 0);
    let bMax = Math.max(...bs, 0);
    const bPad = Math.max((bMax - bMin) * 0.15, 1e-9);
    bMin -= bPad; bMax += bPad;
    const x = (i: number) => PAD_L + (i / (rows.length - 1)) * (W - PAD_L - PAD_R);
    const py = (v: number) => PAD_T + ((pMax - v) / (pMax - pMin)) * (H - PAD_T - PAD_B);
    const by = (v: number) => PAD_T + ((bMax - v) / (bMax - bMin)) * (H - PAD_T - PAD_B);
    const futLine = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${py(r.futuresPrice)}`).join(' ');
    const idxLine = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${py(r.indexPrice)}`).join(' ');
    const basisArea =
      rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${by(r.basis)}`).join(' ') +
      ` L${x(rows.length - 1)},${by(0)} L${x(0)},${by(0)} Z`;
    const pTicks = Array.from({ length: 3 }, (_, i) => pMin + ((i + 0.5) / 3) * (pMax - pMin));
    const bTicks = Array.from({ length: 3 }, (_, i) => bMin + ((i + 0.5) / 3) * (bMax - bMin));
    const times = [0, Math.floor(rows.length / 2), rows.length - 1];
    return { x, py, by, futLine, idxLine, basisArea, pTicks, bTicks, times };
  }, [rows]);

  const idxFromMouse = (clientX: number): number | null => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r || rows.length < 2) return null;
    const xv = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((xv - PAD_L) / (W - PAD_L - PAD_R)) * (rows.length - 1));
    return i >= 0 && i < rows.length ? i : null;
  };

  return (
    <section className="tdx-cell tdx-third">
      <div className="tdx-cardhead">
        <h3 title="Binance USD-M basis history: perpetual futures price vs the index price; the shaded band is the basis (futures − index) on the right axis.">
          Basis <em className="tdx-src">Binance USD-M</em>
        </h3>
        {hasPerp && (
          <PillSelect
            value={period}
            options={[{ id: '5m' as const, label: '5m' }, { id: '1h' as const, label: '1H' }, { id: '4h' as const, label: '4H' }, { id: '1d' as const, label: '1D' }]}
            onChange={setPeriod}
            ariaLabel="Basis period"
          />
        )}
      </div>
      {!hasPerp ? (
        <p className="tdx-dimnote">Spot Only — {base} has no Binance USD-M perpetual.</p>
      ) : !model ? (
        <div className="tdx-chart-empty small">Reading Basis…</div>
      ) : (
        <>
          <div
            ref={wrapRef}
            className="tdx-chartwrap"
            onMouseMove={(e) => {
              const i = idxFromMouse(e.clientX);
              setHov(i);
              const r = wrapRef.current?.getBoundingClientRect();
              if (r) setMouse({ x: e.clientX - r.left });
            }}
            onMouseLeave={() => { setHov(null); setMouse(null); }}
          >
            <svg viewBox={`0 0 ${W} ${H}`} className="tdx-datachart" aria-hidden>
              {model.pTicks.map((v, i) => (
                <g key={`p${i}`}>
                  <line x1={PAD_L} x2={W - PAD_R} y1={model.py(v)} y2={model.py(v)} stroke="var(--line)" strokeWidth="1" />
                  <text x={PAD_L - 8} y={model.py(v) + 4} textAnchor="end" className="tdx-axis">{fmtPrice(v)}</text>
                </g>
              ))}
              {model.bTicks.map((v, i) => (
                <text key={`b${i}`} x={W - PAD_R + 8} y={model.by(v) + 4} className="tdx-axis">{v.toFixed(2)}</text>
              ))}
              <path d={model.basisArea} fill="#F0B90B" opacity="0.14" />
              {hov !== null && (
                <line x1={model.x(hov)} x2={model.x(hov)} y1={PAD_T} y2={H - PAD_B} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />
              )}
              <path d={model.futLine} fill="none" stroke="#F0B90B" strokeWidth="1.6" strokeLinejoin="round" />
              <path d={model.idxLine} fill="none" stroke="var(--text)" strokeWidth="1.6" strokeLinejoin="round" />
              {rows.map((r, i) => (
                <circle key={`f${r.t}`} cx={model.x(i)} cy={model.py(r.futuresPrice)} r={hov === i ? 3.6 : 2.2} fill="var(--panel)" stroke="#F0B90B" strokeWidth={hov === i ? 1.8 : 1.2} />
              ))}
              {rows.map((r, i) => (
                <circle key={`x${r.t}`} cx={model.x(i)} cy={model.py(r.indexPrice)} r={hov === i ? 3.6 : 2.2} fill="var(--panel)" stroke="var(--text)" strokeWidth={hov === i ? 1.8 : 1.2} />
              ))}
              {model.times.map((i) => (
                <text key={`t${i}`} x={model.x(i)} y={H - 8} textAnchor="middle" className="tdx-axis">
                  {new Date(rows[i].t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </text>
              ))}
            </svg>
            {hov !== null && mouse && (
              <ChartTip
                x={mouse.x}
                w={wrapRef.current?.clientWidth ?? W}
                title={tipTime(rows[hov].t)}
                rows={[
                  { dot: '#F0B90B', label: 'Futures Price', value: fmtFull(rows[hov].futuresPrice, 2) },
                  { dot: 'var(--text)', label: 'Price Index', value: fmtFull(rows[hov].indexPrice, 2) },
                  { dot: 'rgba(240,185,11,0.4)', label: 'Basis', value: fmtFull(rows[hov].basis, 2) },
                ]}
              />
            )}
          </div>
          <div className="tdx-legend">
            <span><i className="dot" style={{ borderColor: '#F0B90B' }} />Futures Price</span>
            <span><i className="dot" />Price Index</span>
            <span><i className="sw" style={{ background: '#F0B90B', opacity: 0.3 }} />Basis</span>
          </div>
        </>
      )}
    </section>
  );
}

/* ==== The Coinglass panel — funding / open interest / volume / liquidations
   (owner reference: coinglass.com/currencies/BTC). One dual-axis chart, the
   token price overlaid, extended ranges, interval switching, Binance-format
   hover tooltips. Liquidations are OUR recording of the live !forceOrder
   stream — Binance publishes no history, so the panel says since when. ==== */
type CgxTab = 'funding' | 'oi' | 'volume' | 'liq';

interface CgxPoint { t: number; a: number; b?: number }

function CgxPanel({ symbol, base, name, hasPerp }: { symbol: string; base: string; name: string; hasPerp: boolean }) {
  const [tab, setTab] = useState<CgxTab>('volume');
  const [opt, setOpt] = useState<string>('1d');
  const [points, setPoints] = useState<CgxPoint[]>([]);
  const [price, setPrice] = useState<{ t: number; v: number }[]>([]);
  const [liqSince, setLiqSince] = useState<number | null>(null);
  const [hov, setHov] = useState<number | null>(null);
  const [mouse, setMouse] = useState<{ x: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [chartBox, setChartBox] = useState({ width: 1160, height: 620 });

  const OPTS: Record<CgxTab, { id: string; label: string }[]> = {
    funding: [{ id: '30d', label: '30D' }, { id: '90d', label: '90D' }, { id: 'all', label: 'All' }],
    oi: [{ id: '5m', label: '5m' }, { id: '15m', label: '15m' }, { id: '30m', label: '30m' }, { id: '1h', label: '1H' }, { id: '4h', label: '4H' }, { id: '12h', label: '12H' }, { id: '1d', label: '1D' }],
    volume: [{ id: '1m', label: '1m' }, { id: '5m', label: '5m' }, { id: '15m', label: '15m' }, { id: '30m', label: '30m' }, { id: '1h', label: '1H' }, { id: '4h', label: '4H' }, { id: '12h', label: '12H' }, { id: '1d', label: '1D' }, { id: '1w', label: 'All' }],
    liq: [{ id: '5m', label: '5m' }, { id: '15m', label: '15m' }, { id: '1h', label: '1H' }, { id: '4h', label: '4H' }, { id: '12h', label: '12H' }, { id: '1d', label: '1D' }],
  };
  const DEFAULT_OPT: Record<CgxTab, string> = { funding: 'all', oi: '1h', volume: '1d', liq: '1h' };

  const switchTab = (next: CgxTab) => {
    setTab(next);
    setOpt(DEFAULT_OPT[next]);
    setHov(null);
  };

  useEffect(() => {
    let alive = true;
    setPoints([]);
    setPrice([]);
    const priceFor = (interval: string, limit: number) =>
      fetch(`/api/candles?symbol=${symbol}&interval=${interval}&limit=${limit}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((d: TvCandle[]) => (Array.isArray(d) ? d.map((c) => ({ t: c.t, v: c.c })) : []));

    const load = async () => {
      try {
        if (tab === 'volume') {
          const candles = (await fetch(`/api/candles?symbol=${symbol}&interval=${opt}&limit=1000`).then((r) => (r.ok ? r.json() : []))) as TvCandle[];
          if (!alive || !Array.isArray(candles)) return;
          setPoints(candles.map((c) => ({ t: c.t, a: c.qv || c.v * c.c })));
          setPrice(candles.map((c) => ({ t: c.t, v: c.c })));
        } else if (tab === 'oi' && hasPerp) {
          const rows = (await fetch(`/api/futures/oi-hist?symbol=${symbol}&period=${opt}&limit=500`).then((r) => (r.ok ? r.json() : []))) as OiPoint[];
          if (!alive || !Array.isArray(rows)) return;
          setPoints(rows.map((r) => ({ t: r.t, a: r.notional })));
          setPrice(await priceFor(opt === '12h' ? '12h' : opt, 500));
        } else if (tab === 'funding' && hasPerp) {
          const rows = (await fetch(`/api/futures/funding-hist?symbol=${symbol}&limit=1000`).then((r) => (r.ok ? r.json() : []))) as { t: number; ratePct: number }[];
          if (!alive || !Array.isArray(rows)) return;
          const cut = opt === '30d' ? Date.now() - 30 * 864e5 : opt === '90d' ? Date.now() - 90 * 864e5 : 0;
          setPoints(rows.filter((r) => r.t >= cut).map((r) => ({ t: r.t, a: r.ratePct })));
          setPrice(await priceFor('8h', 1000));
        } else if (tab === 'liq' && hasPerp) {
          const ms: Record<string, number> = { '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '12h': 432e5, '1d': 864e5 };
          const d = (await fetch(`/api/futures/liquidations?symbol=${symbol}&bucketMs=${ms[opt] ?? 36e5}`).then((r) => (r.ok ? r.json() : null))) as { since: number; points: { t: number; long: number; short: number }[] } | null;
          if (!alive || !d) return;
          setLiqSince(d.since);
          setPoints(d.points.map((p) => ({ t: p.t, a: p.long, b: p.short })));
          setPrice(await priceFor(opt === '5m' ? '5m' : opt === '15m' ? '15m' : '1h', 1000));
        }
      } catch { /* honest empty */ }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, [symbol, tab, opt, hasPerp]);

  useEffect(() => {
    const host = wrapRef.current;
    if (!host) return;
    const measure = () => {
      const width = host.getBoundingClientRect().width;
      if (!Number.isFinite(width) || width <= 0) return;
      const next = {
        width: Math.round(width),
        height: Math.round(Math.max(620, Math.min(860, width * 0.32))),
      };
      setChartBox((prev) => (
        Math.abs(prev.width - next.width) > 2 || Math.abs(prev.height - next.height) > 2 ? next : prev
      ));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [points.length, tab]);

  const W = chartBox.width;
  const H = chartBox.height;
  const PAD_L = 80;
  const PAD_R = 80;
  const PAD_B = 30;
  const PAD_T = 14;

  const model = useMemo(() => {
    if (points.length < 3) return null;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const x = (t: number) => PAD_L + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD_L - PAD_R);
    const xi = (i: number) => x(points[i].t);
    let aMin: number;
    let aMax: number;
    if (tab === 'funding') {
      const vs = points.map((p) => p.a);
      const m = Math.max(Math.abs(Math.min(...vs, 0)), Math.abs(Math.max(...vs, 0)), 1e-9);
      aMin = -m * 1.1; aMax = m * 1.1;
    } else if (tab === 'liq') {
      const m = Math.max(...points.map((p) => Math.max(p.a, p.b ?? 0)), 1e-9);
      aMin = -m * 1.1; aMax = m * 1.1;
    } else {
      aMin = 0;
      aMax = Math.max(...points.map((p) => p.a), 1e-9) * 1.06;
    }
    const ay = (v: number) => PAD_T + ((aMax - v) / (aMax - aMin)) * (H - PAD_T - PAD_B);
    const inRange = price.filter((p) => p.t >= t0 - 864e5 && p.t <= t1 + 864e5);
    let pMin = Infinity;
    let pMax = -Infinity;
    for (const p of inRange) { if (p.v < pMin) pMin = p.v; if (p.v > pMax) pMax = p.v; }
    if (!Number.isFinite(pMin)) { pMin = 0; pMax = 1; }
    const span = Math.max(pMax - pMin, pMax * 1e-9, 1e-12);
    pMin -= span * 0.08; pMax += span * 0.08;
    const py = (v: number) => PAD_T + ((pMax - v) / (pMax - pMin)) * (H - PAD_T - PAD_B);
    const priceLine = inRange.filter((p) => p.t >= t0 && p.t <= t1).map((p, i) => `${i ? 'L' : 'M'}${x(p.t)},${py(p.v)}`).join(' ');
    const bw = Math.max(1.2, ((W - PAD_L - PAD_R) / points.length) * (tab === 'oi' ? 1 : 0.55));
    const areaPath = tab === 'oi'
      ? points.map((p, i) => `${i ? 'L' : 'M'}${xi(i)},${ay(p.a)}`).join(' ') + ` L${xi(points.length - 1)},${H - PAD_B} L${xi(0)},${H - PAD_B} Z`
      : '';
    const aTicks = Array.from({ length: 4 }, (_, i) => aMin + ((i + 0.5) / 4) * (aMax - aMin));
    const pTicks = Array.from({ length: 4 }, (_, i) => pMin + ((i + 0.5) / 4) * (pMax - pMin));
    const times = [0, Math.floor(points.length / 3), Math.floor((2 * points.length) / 3), points.length - 1];
    const priceAt = (t: number): number | null => {
      if (!inRange.length) return null;
      let best = inRange[0];
      for (const p of inRange) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      return best.v;
    };
    return { x, xi, ay, py, priceLine, bw, areaPath, aTicks, pTicks, times, priceAt, zeroY: ay(0) };
  }, [points, price, tab]);

  const idxFromMouse = (clientX: number): number | null => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r || points.length < 2) return null;
    const xv = ((clientX - r.left) / r.width) * W;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs((model?.xi(i) ?? 0) - xv);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  const fmtA = (v: number): string =>
    tab === 'funding' ? `${v.toFixed(4)}%` : '$' + fmtCompact(v);

  const TAB_TITLE: Record<CgxTab, string> = {
    funding: 'Funding Rate',
    oi: 'Open Interest (USD)',
    volume: 'Volume',
    liq: 'Perpetual Liquidations',
  };
  const needsPerp = tab !== 'volume';
  const p = hov !== null ? points[hov] : null;

  return (
    <section className="tdx-cell tdx-cgx">
      <div className="tdx-cardhead">
        <div className="cgx-tabs" role="tablist" aria-label="Derivatives data">
          <button type="button" role="tab" aria-selected={tab === 'funding'} className={tab === 'funding' ? 'on' : ''} data-testid="token-cgx-funding" onClick={() => switchTab('funding')}>Funding Rate</button>
          <button type="button" role="tab" aria-selected={tab === 'oi'} className={tab === 'oi' ? 'on' : ''} data-testid="token-cgx-oi" onClick={() => switchTab('oi')}>Open Interest</button>
          <button type="button" role="tab" aria-selected={tab === 'volume'} className={tab === 'volume' ? 'on' : ''} data-testid="token-cgx-volume" onClick={() => switchTab('volume')}>Volume</button>
        <button type="button" role="tab" aria-selected={tab === 'liq'} className={tab === 'liq' ? 'on' : ''} data-testid="token-cgx-liquidation" onClick={() => switchTab('liq')}>Liquidation</button>
        </div>
        <PillSelect value={opt} options={OPTS[tab]} onChange={setOpt} ariaLabel="Data interval" />
      </div>
      <h3 className="cgx-title">{name} {TAB_TITLE[tab]} <em className="tdx-src">{tab === 'volume' ? 'Binance Spot' : 'Binance USD-M'}{tab === 'oi' ? ' · 30d Max Upstream' : ''}</em></h3>
      {needsPerp && !hasPerp ? (
        <p className="tdx-dimnote">Spot Only — {base} has no Binance USD-M perpetual.</p>
      ) : !model ? (
        tab === 'liq' ? (
          <div className="tdx-cgx-empty">
            <p className="tdx-dimnote">Recording live liquidations{liqSince ? ` since ${new Date(liqSince).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''} — Binance publishes no history. Buckets appear as events arrive.</p>
          </div>
        ) : (
          <div className="tdx-cgx-empty">
            <div className="tdx-chart-empty small">Reading…</div>
          </div>
        )
      ) : (
        <>
          <div
            ref={wrapRef}
            className="tdx-chartwrap"
            onMouseMove={(e) => {
              setHov(idxFromMouse(e.clientX));
              const r = wrapRef.current?.getBoundingClientRect();
              if (r) setMouse({ x: e.clientX - r.left });
            }}
            onMouseLeave={() => { setHov(null); setMouse(null); }}
          >
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="tdx-datachart" aria-hidden>
              {model.aTicks.map((v, i) => (
                <g key={`a${i}`}>
                  <line x1={PAD_L} x2={W - PAD_R} y1={model.ay(v)} y2={model.ay(v)} stroke="var(--line)" strokeWidth="1" />
                  <text x={PAD_L - 8} y={model.ay(v) + 4} textAnchor="end" className="tdx-axis">{fmtA(v)}</text>
                </g>
              ))}
              {model.pTicks.map((v, i) => (
                <text key={`p${i}`} x={W - PAD_R + 8} y={model.py(v) + 4} className="tdx-axis">{fmtPrice(v)}</text>
              ))}
              {hov !== null && (
                <line x1={model.xi(hov)} x2={model.xi(hov)} y1={PAD_T} y2={H - PAD_B} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />
              )}
              {tab === 'oi' && <path d={model.areaPath} fill="var(--up)" opacity="0.16" />}
              {tab === 'oi' && <path d={points.map((pt, i) => `${i ? 'L' : 'M'}${model.xi(i)},${model.ay(pt.a)}`).join(' ')} fill="none" stroke="var(--up)" strokeWidth="1.6" />}
              {tab === 'volume' && points.map((pt, i) => (
                <rect key={pt.t} x={model.xi(i) - model.bw / 2} y={model.ay(pt.a)} width={model.bw} height={Math.max(1, H - PAD_B - model.ay(pt.a))} fill="var(--up)" opacity={hov === null ? 0.6 : hov === i ? 1 : 0.25} />
              ))}
              {tab === 'funding' && points.map((pt, i) => (
                <rect key={pt.t} x={model.xi(i) - model.bw / 2} y={pt.a >= 0 ? model.ay(pt.a) : model.zeroY} width={model.bw} height={Math.max(1, Math.abs(model.ay(pt.a) - model.zeroY))} fill={pt.a >= 0 ? 'var(--up)' : 'var(--down)'} opacity={hov === null ? 0.75 : hov === i ? 1 : 0.3} />
              ))}
              {tab === 'liq' && points.map((pt, i) => (
                <g key={pt.t}>
                  <rect x={model.xi(i) - model.bw / 2} y={model.ay(pt.a)} width={model.bw} height={Math.max(0.5, model.zeroY - model.ay(pt.a))} fill="var(--up)" opacity={hov === null ? 0.8 : hov === i ? 1 : 0.3} />
                  <rect x={model.xi(i) - model.bw / 2} y={model.zeroY} width={model.bw} height={Math.max(0.5, model.ay(-(pt.b ?? 0)) - model.zeroY)} fill="var(--down)" opacity={hov === null ? 0.8 : hov === i ? 1 : 0.3} />
                </g>
              ))}
              {(tab === 'funding' || tab === 'liq') && (
                <line x1={PAD_L} x2={W - PAD_R} y1={model.zeroY} y2={model.zeroY} stroke="var(--line-2)" strokeWidth="1" />
              )}
              <path d={model.priceLine} fill="none" stroke="#F0B90B" strokeWidth="1.7" strokeLinejoin="round" />
              {model.times.map((i) => (
                <text key={`t${i}`} x={model.xi(i)} y={H - 8} textAnchor="middle" className="tdx-axis">
                  {new Date(points[i].t).toLocaleDateString('en-US', points[points.length - 1].t - points[0].t > 300 * 864e5 ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' })}
                </text>
              ))}
            </svg>
            {p && mouse && (
              <ChartTip
                x={mouse.x}
                w={wrapRef.current?.clientWidth ?? W}
                title={tipTime(p.t)}
                rows={[
                  ...(tab === 'liq'
                    ? [
                        { dot: 'var(--up)', label: 'Long Liquidations', value: '$' + fmtFull(p.a, 0) },
                        { dot: 'var(--down)', label: 'Short Liquidations', value: '$' + fmtFull(p.b ?? 0, 0) },
                      ]
                    : [{ dot: tab === 'funding' ? (p.a >= 0 ? 'var(--up)' : 'var(--down)') : 'var(--up)', label: TAB_TITLE[tab], value: tab === 'funding' ? `${p.a.toFixed(4)}%` : '$' + fmtFull(p.a, 0) }]),
                  ...(model.priceAt(p.t) !== null ? [{ dot: '#F0B90B', label: `${base} Price`, value: fmtFull(model.priceAt(p.t) as number, 2) }] : []),
                ]}
              />
            )}
          </div>
          <div className="tdx-legend">
            {tab === 'liq' ? (
              <>
                <span><i className="sw" style={{ background: 'var(--up)' }} />Long</span>
                <span><i className="sw" style={{ background: 'var(--down)' }} />Short</span>
              </>
            ) : (
              <span><i className="sw" style={{ background: 'var(--up)', opacity: tab === 'oi' ? 0.4 : 0.8 }} />{TAB_TITLE[tab]}</span>
            )}
            <span><i className="dot" style={{ borderColor: '#F0B90B' }} />{base} Price</span>
            {tab === 'liq' && liqSince ? <span className="cgx-note">Recording Since {new Date(liqSince).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · No Upstream History</span> : null}
          </div>
        </>
      )}
    </section>
  );
}

export function TokenDetail({ symbol }: { symbol: string }) {
  const { markets, state, toggleWatch, setPage, openDetail, prefs } = useStore();
  const [range, setRange] = useState<RangeKey>('1D');
  const [ivl, setIvl] = useState<'auto' | IntervalKey>('auto');
  const [tv, setTv] = useState(true);
  const [src, setSrc] = useState<'spot' | 'futures'>('spot');
  const [chartFocus, setChartFocus] = useState(false);
  const [candles, setCandles] = useState<TvCandle[]>([]);
  const [profile, setProfile] = useState<TokenProfile | null>(null);
  const [q, setQ] = useState('');

  const live = markets.find((m) => m.symbol === symbol);
  const base = baseOf(symbol);
  const name = profile?.name ?? tokenName(base);
  const watchlisted = state?.config.watchlist.includes(symbol) ?? false;
  const hasPerp = live?.hasPerp ?? false;

  // Futures klines have no 1s granularity — coerce to 1m on that source.
  const raw = ivl === 'auto' ? RANGES[range] : { interval: ivl, limit: INTERVAL_LIMIT[ivl] };
  const effective = src === 'futures' && raw.interval === '1s' ? { interval: '1m', limit: 60 } : raw;
  const tvSymbol = src === 'futures' && hasPerp ? `BINANCE:${symbol}.P` : `BINANCE:${symbol}`;
  const tvInterval = effective.interval;

  // ---- price series: real klines + the live public kline stream -----------
  useEffect(() => {
    const { interval, limit } = effective;
    let alive = true;
    setCandles([]);
    const load = () => {
      void fetch(`/api/candles?symbol=${symbol}&interval=${interval}&limit=${limit}&market=${src}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && Array.isArray(d) && setCandles(d as TvCandle[]))
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, Math.max(0.5, prefs.dataCadence?.token ?? 1) * 1000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, range, ivl, src, prefs.dataCadence?.token]);

  useEffect(() => {
    const { interval, limit } = effective;
    let alive = true;
    const host = src === 'futures' ? 'wss://fstream.binance.com/ws' : 'wss://stream.binance.com:9443/ws';
    const ws = new WebSocket(`${host}/${symbol.toLowerCase()}@kline_${interval}`);
    ws.onmessage = (ev) => {
      if (!alive) return;
      try {
        const msg = JSON.parse(String(ev.data)) as BinanceKlineMsg;
        const k = msg.k;
        if (!k) return;
        const next: TvCandle = { t: k.t, o: Number(k.o), h: Number(k.h), l: Number(k.l), c: Number(k.c), v: Number(k.v), qv: Number(k.q) || Number(k.v) * Number(k.c) };
        setCandles((prev) => {
          const out = [...prev];
          const idx = out.findIndex((c) => c.t === next.t);
          if (idx >= 0) out[idx] = next;
          else out.push(next);
          out.sort((a, b) => a.t - b.t);
          return out.length > limit ? out.slice(out.length - limit) : out;
        });
      } catch { /* malformed frame */ }
    };
    ws.onerror = () => ws.close();
    return () => { alive = false; ws.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, range, ivl, src]);

  // profile: name + whitepaper/homepage for the header (retry until warmed)
  useEffect(() => {
    let alive = true;
    let timer: number | null = null;
    const loadProfile = () => {
      void fetch(`/api/token/profile?base=${base}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive) return;
          if (d?.profile) setProfile(d.profile as TokenProfile);
          else timer = window.setTimeout(loadProfile, 10_000);
        })
        .catch(() => { if (alive) timer = window.setTimeout(loadProfile, 15_000); });
    };
    setProfile(null);
    loadProfile();
    return () => { alive = false; if (timer) window.clearTimeout(timer); };
  }, [base, symbol]);

  const points = useMemo(() => candles.map((c) => ({ t: c.t, v: c.c })), [candles]);
  const price = live?.spot ?? lastOf(points)?.v ?? null;
  const first = points[0]?.v ?? null;
  const rangeAbs = price !== null && first !== null ? price - first : null;
  const rangePct = price !== null && first && first > 0 ? ((price - first) / first) * 100 : null;
  const up = (rangePct ?? 0) >= 0;

  const searchMatches = useMemo(() => {
    const needle = q.trim().toUpperCase();
    if (!needle) return [];
    return markets
      .filter((m) => m.base.includes(needle) || tokenName(m.base).toUpperCase().includes(needle))
      .slice(0, 8);
  }, [markets, q]);

  return (
    <div className="container page mkx tdx-page">
      {/* ---- header strip: identity + whitepaper + watchlist + search ------ */}
      <header className="tdx-head">
        <TokenIcon symbol={symbol} size={40} />
        <h1>{name} Price ({base})</h1>
        <Star on={watchlisted} onClick={() => void toggleWatch(symbol)} />
        {profile?.whitepaper ? (
          <a className="mkx-pill tdx-headlink" href={profile.whitepaper} target="_blank" rel="noreferrer noopener">Whitepaper</a>
        ) : null}
        {profile?.homepage ? (
          <a className="mkx-pill tdx-headlink" href={profile.homepage} target="_blank" rel="noreferrer noopener">Official Website <IconExternal size={12} /></a>
        ) : null}
        <span className="tdx-head-right">
          <span className="tdx-searchwrap">
            <label className="mkx-search tdx-search">
              <IconSearch size={16} />
              <input placeholder="Search for an asset" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
              {q && <button aria-label="Clear search" onClick={() => setQ('')}>×</button>}
            </label>
            {searchMatches.length > 0 && (
              <div className="tdx-search-menu" role="listbox" aria-label="Assets">
                {searchMatches.map((m) => (
                  <button key={m.symbol} type="button" role="option" aria-selected={m.symbol === symbol} onClick={() => { setQ(''); openDetail(m.symbol); }}>
                    <TokenIcon symbol={m.symbol} size={26} />
                    <b>{m.base}</b>
                    <em>{tokenName(m.base)}</em>
                    <span>{m.spot !== null ? fmtPrice(m.spot) : '—'}</span>
                  </button>
                ))}
              </div>
            )}
          </span>
          <button type="button" className="mkx-pill" onClick={() => setPage('markets')}>All Markets</button>
        </span>
      </header>

      <div className="tdx-grid">
        {/* ---- row 1: the chart, full width --------------------------------- */}
        <section className="tdx-cell tdx-chartcell">
          <div className="tdx-price-row">
            <div className="tdx-price">
              <b>{price !== null ? fmtPrice(price) : '—'}</b>
              <span className="tdx-delta">
                <Chg pct={rangePct}>
                  {rangeAbs !== null ? `${fmtPrice(Math.abs(rangeAbs))} (${fmtPct(Math.abs(rangePct ?? 0), 2, false)})` : '—'}
                </Chg>
              </span>
            </div>
            <div className="tdx-controls">
              <div className="tdx-ranges" role="tablist" aria-label="Chart range">
                {RANGE_KEYS.map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={ivl === 'auto' && range === k} className={ivl === 'auto' && range === k ? 'on' : ''} disabled={src === 'futures' && k === '1S'} title={src === 'futures' && k === '1S' ? 'Spot-Only Granularity' : undefined} onClick={() => { setRange(k); setIvl('auto'); }}>
                    {k}
                  </button>
                ))}
              </div>
              {hasPerp && (
                <div className="tdx-kind tdx-srcseg" role="tablist" aria-label="Chart source">
                  <button type="button" role="tab" aria-selected={src === 'spot'} className={src === 'spot' ? 'on' : ''} onClick={() => setSrc('spot')}>Spot</button>
                  <button type="button" role="tab" aria-selected={src === 'futures'} className={src === 'futures' ? 'on' : ''} onClick={() => setSrc('futures')}>Futures</button>
                </div>
              )}
              <PillSelect
                value={ivl}
                options={[{ id: 'auto' as const, label: 'Auto' }, ...INTERVALS.map((i) => ({ id: i, label: INTERVAL_LABEL[i] }))]}
                onChange={setIvl}
                ariaLabel="Chart interval"
              />
              <div className="tdx-kind" role="tablist" aria-label="Chart type">
                <button type="button" role="tab" aria-selected={!tv} className={tv ? '' : 'on'} title="Line chart" data-testid="token-line-chart" onClick={() => setTv(false)}>
                  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden><path d="M1.5 11.5l4-5 3 3 5.5-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <button type="button" role="tab" aria-selected={tv} className={tv ? 'on' : ''} title="TradingView candles" data-testid="token-tradingview-chart" onClick={() => setTv(true)}>
                  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden><path d="M4 3v10M2.5 5.5h3v5h-3zM12 2v12M10.5 4.5h3v6h-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                </button>
              </div>
              <button type="button" className="tdx-focus-btn" title="Open Full Chart" aria-label="Open Full Chart" data-testid="token-full-chart" onClick={() => setChartFocus(true)}>
                <IconMaximize size={15} />
              </button>
            </div>
          </div>
          {tv ? (
            <TradingViewWidget symbol={tvSymbol} win={tvInterval} height={560} />
          ) : (
            <div className="tdx-line-frame">
              <PriceChart points={points} up={up} />
            </div>
          )}
        </section>

        {/* ---- row 2: money flow | open interest | basis -------------------- */}
        <MoneyFlowCard symbol={symbol} base={base} />
        <OiCard symbol={symbol} base={base} hasPerp={hasPerp} />
        <BasisCard symbol={symbol} base={base} hasPerp={hasPerp} />

        {/* ---- row 3: the Coinglass panel ----------------------------------- */}
        <CgxPanel symbol={symbol} base={base} name={name} hasPerp={hasPerp} />
      </div>
      {chartFocus && (
        <div className="tdx-chart-modal" role="dialog" aria-modal="true" aria-label={`${base} Full Chart`}>
          <div className="tdx-chart-modal-head">
            <span>
              <TokenIcon symbol={symbol} size={28} />
              <b>{base} TradingView Workspace</b>
              <em>{src === 'futures' && hasPerp ? 'Binance USD-M Perpetual' : 'Binance Spot'} · {INTERVAL_LABEL[(effective.interval as IntervalKey)] ?? effective.interval}</em>
            </span>
            <button type="button" aria-label="Close Full Chart" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setChartFocus(false); }}><IconClose size={17} /></button>
          </div>
          <TradingViewWidget symbol={tvSymbol} win={tvInterval} height={Math.round(window.innerHeight * 0.78)} />
        </div>
      )}
    </div>
  );
}

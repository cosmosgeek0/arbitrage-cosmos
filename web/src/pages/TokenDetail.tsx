/* Token page — Coinbase chart anatomy on top, Binance token-data base below:
   Money Flow Analysis (real spot aggTrades, size-bucketed, animated sweep),
   Open Interest (bars + notional line), and Basis (futures/index/basis area)
   — all straight from Binance endpoints, one template for every token, with
   honest spot-only fallbacks. The second base row is reserved (owner). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Globe2, Grid2X2, Search, Star as StarIcon, X } from 'lucide-react';
import { resolveMarketFreshness, useStore } from '../store';
import { TokenIcon } from '../components/TokenIcon';
import { projectMarketConsumerTruth } from '../components/Header';
import { PillSelect } from '../components/PillSelect';
import { normalizeTvCandles, type TvCandle } from '../components/TradingViewChart';
import { TradingViewWidget } from '../components/TradingViewWidget';
import {
  basisRuntimeSnapshotCurrent,
  decodeBasisRuntimeSnapshot,
  type BasisRow as BasisEngineRow,
  type BasisSnapshot as BasisEngineSnapshot,
} from '../lib/basisRuntime';
import { BoundedTtlCache } from '../lib/boundedTtlCache';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import {
  projectPrivateReadGuard,
  type PrivateReadGuardProjection,
  type PrivateReadSnapshot,
  type PrivateReadSourceId,
} from '../lib/privateRead';
import {
  parseTokenIntelligence,
  parseTokenNewsContext,
  type TokenIntelligenceRead,
  type TokenNewsContext,
} from '../lib/tokenIntelligence';
import { IconClose, IconMaximize } from '../components/Icons';
import { baseOf, countdown, fmtBasis, fmtFunding, fmtMoney, fmtPct, fmtPrice, timeAgo } from '../format';
import { formatClockZone } from '../lib/time';
import { tokenName } from '../lib/tokenNames';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import { useProductControlRoomContext } from '../features/productControlRoom/ProductControlRoomProvider';
import type { MarketRow } from '../types';
import './Markets.css';
import './TokenDetail.css';

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

interface TokenProfile {
  id: string;
  name: string;
  rank: number | null;
  description: string | null;
  homepage: string | null;
  whitepaper: string | null;
  categories: string[];
  platforms: { network: string; address: string }[];
  marketCapUsd: number | null;
  fdvUsd: number | null;
  circSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  athUsd: number | null;
  athDate: string | null;
  athChangePct: number | null;
  vol24hUsd: number | null;
  priceChange1yPct: number | null;
  priceChange30dPct: number | null;
  priceChange7dPct: number | null;
  dominancePct: number | null;
  genesisDate: string | null;
  hashingAlgorithm: string | null;
  sentimentUpPct: number | null;
  watchlistUsers: number | null;
  full: boolean;
  fetchedAt: number;
}

function normalizeTimedRows<T extends { t: number }>(rows: readonly T[], valid: (row: T) => boolean): T[] {
  const byTime = new Map<number, T>();
  for (const row of rows) {
    if (!Number.isFinite(row.t) || row.t <= 0 || !valid(row)) continue;
    byTime.set(row.t, row);
  }
  return [...byTime.values()].sort((left, right) => left.t - right.t).slice(-5_000);
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

interface BasisPoint { t: number; futuresPrice: number; indexPrice: number; basis: number; basisRatePct: number }
interface FuturesRatioPoint { t: number; ratio: number; longPct: number; shortPct: number }
interface FuturesTakerFlowPoint { t: number; buyVol: number; sellVol: number; ratio: number }
interface FuturesTelemetry {
  symbol: string;
  period: string;
  updatedAt: number;
  available: boolean;
  errors: string[];
  topAccountRatio: FuturesRatioPoint[];
  topPositionRatio: FuturesRatioPoint[];
  globalRatio: FuturesRatioPoint[];
  takerFlow: FuturesTakerFlowPoint[];
}

const TOKEN_DATA_CACHE_TTL_MS = 5 * 60_000;
const tokenCandleCache = new BoundedTtlCache<string, TvCandle[]>({ maxEntries: 64, ttlMs: TOKEN_DATA_CACHE_TTL_MS });
const moneyFlowCache = new BoundedTtlCache<string, MoneyFlow>({ maxEntries: 32, ttlMs: TOKEN_DATA_CACHE_TTL_MS });
const positioningCache = new BoundedTtlCache<string, FuturesTelemetry>({ maxEntries: 32, ttlMs: TOKEN_DATA_CACHE_TTL_MS });

function nonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validMoneyFlow(payload: MoneyFlow, symbol: string): boolean {
  const buckets = [payload.large, payload.medium, payload.small];
  return (
    payload.symbol === symbol &&
    buckets.every((bucket) => nonNegative(bucket?.buy) && nonNegative(bucket?.sell)) &&
    nonNegative(payload.totalBuy) &&
    nonNegative(payload.totalSell) &&
    Number.isFinite(payload.inflow) &&
    Number.isSafeInteger(payload.trades) &&
    payload.trades >= 0 &&
    nonNegative(payload.coveredMs) &&
    Number.isFinite(payload.windowMs) &&
    payload.windowMs > 0
  );
}

function validTelemetry(payload: FuturesTelemetry, symbol: string): boolean {
  const ratios = [...payload.topAccountRatio, ...payload.topPositionRatio, ...payload.globalRatio];
  return (
    payload.symbol === symbol &&
    Number.isFinite(payload.updatedAt) &&
    payload.updatedAt > 0 &&
    Array.isArray(payload.errors) &&
    payload.errors.every((error) => typeof error === 'string') &&
    ratios.every((row) => (
      Number.isFinite(row.t) && row.t > 0 && nonNegative(row.ratio) &&
      nonNegative(row.longPct) && row.longPct <= 100 &&
      nonNegative(row.shortPct) && row.shortPct <= 100
    )) &&
    payload.takerFlow.every((row) => (
      Number.isFinite(row.t) && row.t > 0 &&
      nonNegative(row.buyVol) && nonNegative(row.sellVol) && nonNegative(row.ratio)
    ))
  );
}

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
function PriceChart({ points, up, clockZone }: { points: { t: number; v: number }[]; up: boolean; clockZone: string }) {
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
  const H = Math.round(Math.max(300, Math.min(410, W * 0.22)));
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
      if (spanMs < 864e5 * 2) return formatClockZone(t, clockZone, { hour: 'numeric', minute: '2-digit' });
      if (spanMs < 864e5 * 400) return formatClockZone(t, clockZone, { month: 'short', day: 'numeric' });
      return formatClockZone(t, clockZone, { month: 'short', year: '2-digit' });
    };
    const last = xy[xy.length - 1];
    return { d, area, ticks, y, times, timeFmt, last };
  }, [H, W, clockZone, points]);

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
          <line x1={0} x2={W - PAD_R} y1={model.y(v)} y2={model.y(v)} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <text x={W - PAD_R + 12} y={model.y(v) + 4} className="tdx-axis">{fmtPrice(v)}</text>
        </g>
      ))}
      <path d={model.area} fill="url(#tdx-dots)" />
      <path d={model.d} fill="none" stroke={stroke} strokeWidth="1.35" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
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

function tipTime(t: number, clockZone: string): string {
  return formatClockZone(t, clockZone, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).replace(',', '');
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
  const [flowError, setFlowError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const key = `${symbol}:${win}`;
    setFlow(moneyFlowCache.get(key) ?? null);
    setFlowError(null);
    const poll = createSettledPoll<MoneyFlow>({
      intervalMs: 60_000,
      request: (signal) => fetchJson(`/api/token/moneyflow?symbol=${symbol}&window=${win}`, { signal }),
      onSuccess: (next) => {
        if (!validMoneyFlow(next, symbol)) throw new Error('Money-flow payload is invalid');
        moneyFlowCache.set(key, next);
        setFlow(next);
        setFlowError(null);
      },
      onError: (error) => setFlowError(apiErrorMessage(error, 'Money flow is unavailable')),
    });
    poll.start();
    return poll.stop;
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
  const buyShare = total > 0 && flow ? (flow.totalBuy / total) * 100 : null;
  const coverage = flow && flow.windowMs > 0 ? Math.min(100, (flow.coveredMs / flow.windowMs) * 100) : null;
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
    <section className="tdx-cell tkx-flow-card" aria-label="Spot money flow">
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
        <div className="tdx-chart-empty small">{flowError ?? 'Reading Trades…'}</div>
      ) : total <= 0 ? (
        <p className="tdx-dimnote">No trades in the window.</p>
      ) : (
        <>
          <div className="tkx-instrument-metrics tkx-flow-stats" aria-label="Money Flow Snapshot">
            <div><span>Net Flow</span><strong className={flow.inflow > 0 ? 'up' : flow.inflow < 0 ? 'down' : ''}>{fmtCompact(flow.inflow)} {base}</strong><small>{flow.inflow >= 0 ? 'Net Taker Buying' : 'Net Taker Selling'}</small></div>
            <div><span>Buy Share</span><strong>{buyShare === null ? '—' : buyShare.toFixed(1) + '%'}</strong><small>{fmtCompact(flow.totalBuy)} {base}</small></div>
            <div><span>Trades</span><strong>{flow.trades.toLocaleString('en-US')}</strong><small>Aggregate Prints</small></div>
            <div><span>Coverage</span><strong>{coverage === null ? '—' : Math.round(coverage) + '%'}</strong><small>{flow.sampled ? 'Latest Sample' : 'Full Window'}</small></div>
          </div>
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
          {flowError ? <p className="tdx-updated" role="status">Refresh unavailable · showing the last verified money-flow snapshot.</p> : null}
        </>
      )}
    </section>
  );
}

function PositioningCard({ symbol, base, hasPerp }: { symbol: string; base: string; hasPerp: boolean | null }) {
  const [period, setPeriod] = useState<'5m' | '15m' | '1h' | '4h'>('5m');
  const [telemetry, setTelemetry] = useState<FuturesTelemetry | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);

  useEffect(() => {
    if (hasPerp !== true) {
      setTelemetry(null);
      setTelemetryError(null);
      return;
    }
    const key = `${symbol}:${period}`;
    setTelemetry(positioningCache.get(key) ?? null);
    setTelemetryError(null);
    const poll = createSettledPoll<FuturesTelemetry>({
      intervalMs: 60_000,
      request: (signal) => fetchJson(`/api/futures/telemetry?symbol=${symbol}&period=${period}&limit=120`, { signal }),
      onSuccess: (next) => {
        if (
          !Array.isArray(next.topAccountRatio) ||
          !Array.isArray(next.topPositionRatio) ||
          !Array.isArray(next.globalRatio) ||
          !Array.isArray(next.takerFlow) ||
          !validTelemetry(next, symbol)
        ) throw new Error('Positioning payload is invalid');
        positioningCache.set(key, next);
        setTelemetry(next);
        setTelemetryError(null);
      },
      onError: (error) => setTelemetryError(apiErrorMessage(error, 'Positioning is unavailable')),
    });
    poll.start();
    return poll.stop;
  }, [hasPerp, period, symbol]);

  const taker = lastOf(telemetry?.takerFlow);
  const global = lastOf(telemetry?.globalRatio);
  const topAccounts = lastOf(telemetry?.topAccountRatio);
  const topPositions = lastOf(telemetry?.topPositionRatio);
  const takerTotal = (taker?.buyVol ?? 0) + (taker?.sellVol ?? 0);
  const takerBuyPct = takerTotal > 0 ? ((taker?.buyVol ?? 0) / takerTotal) * 100 : null;

  const rows = [
    takerBuyPct === null ? null : {
      label: 'Taker Flow', ratio: taker?.ratio ?? null, leftPct: takerBuyPct, rightPct: 100 - takerBuyPct,
      leftLabel: `Buy ${fmtCompact(taker?.buyVol)} ${base}`, rightLabel: `Sell ${fmtCompact(taker?.sellVol)} ${base}`,
    },
    global ? { label: 'Global Accounts', ratio: global.ratio, leftPct: global.longPct, rightPct: global.shortPct, leftLabel: `Long ${global.longPct.toFixed(1)}%`, rightLabel: `Short ${global.shortPct.toFixed(1)}%` } : null,
    topAccounts ? { label: 'Top Accounts', ratio: topAccounts.ratio, leftPct: topAccounts.longPct, rightPct: topAccounts.shortPct, leftLabel: `Long ${topAccounts.longPct.toFixed(1)}%`, rightLabel: `Short ${topAccounts.shortPct.toFixed(1)}%` } : null,
    topPositions ? { label: 'Top Positions', ratio: topPositions.ratio, leftPct: topPositions.longPct, rightPct: topPositions.shortPct, leftLabel: `Long ${topPositions.longPct.toFixed(1)}%`, rightLabel: `Short ${topPositions.shortPct.toFixed(1)}%` } : null,
  ].filter((row): row is NonNullable<typeof row> => row !== null);

  return (
    <section className="tdx-cell tkx-positioning" aria-label="Futures positioning">
      <div className="tdx-cardhead">
        <h3 title="Binance USD-M taker buy/sell volume plus global and top-trader long/short ratios. Public history is limited to the latest 30 days.">
          Futures Positioning <em className="tdx-src">Binance USD-M · 30D Max</em>
        </h3>
        {hasPerp === true && (
          <PillSelect
            value={period}
            options={[{ id: '5m' as const, label: '5m' }, { id: '15m' as const, label: '15m' }, { id: '1h' as const, label: '1H' }, { id: '4h' as const, label: '4H' }]}
            onChange={setPeriod}
            ariaLabel="Positioning period"
          />
        )}
      </div>
      {hasPerp === null ? (
        <p className="tdx-dimnote">Market Presence UNKNOWN — positioning is withheld until current market truth identifies the instrument.</p>
      ) : hasPerp === false ? (
        <p className="tdx-dimnote">Spot Only — {base} has no Binance USD-M positioning feed.</p>
      ) : !telemetry ? (
        <div className="tdx-chart-empty small">{telemetryError ?? 'Reading Positioning…'}</div>
      ) : rows.length === 0 ? (
        <p className="tdx-dimnote">Positioning is currently unavailable from Binance for this contract.</p>
      ) : (
        <div className="tkx-position-list">
          {rows.map((row) => (
            <div className="tkx-position-row" key={row.label}>
              <span><strong>{row.label}</strong><em>{row.ratio === null ? '—' : row.ratio.toFixed(2) + '×'}</em></span>
              <div className="tkx-position-bar" aria-label={`${row.leftLabel} · ${row.rightLabel}`}>
                <i style={{ width: `${Math.max(0, Math.min(100, row.leftPct))}%` }} />
              </div>
              <small><span>{row.leftLabel}</span><span>{row.rightLabel}</span></small>
            </div>
          ))}
          <p className="tdx-updated">{telemetry.errors.length ? `${telemetry.errors.length} optional feed${telemetry.errors.length === 1 ? '' : 's'} unavailable · ` : ''}Updated {timeAgo(telemetry.updatedAt)}</p>
          {telemetryError ? <p className="tdx-updated" role="status">Refresh unavailable · showing the last verified positioning snapshot.</p> : null}
        </div>
      )}
    </section>
  );
}

/* ==== TASK 3: Basis — Binance futures token data =========================== */
type IntelTab = 'funding' | 'volume' | 'liq' | 'basis';

interface IntelPoint { t: number; a: number; b?: number }
type LiquidationRecorderState = 'live' | 'connecting' | 'down' | 'invalid' | 'not_applicable';
type LiquidationRecorderTruth = Readonly<{
  state: 'LIVE' | 'STARTING' | 'UNAVAILABLE' | 'UNKNOWN' | 'NOT_APPLICABLE';
  mayClaimLive: boolean;
  value: string;
  note: string;
}>;

interface LiquidationOwnerPayload {
  since: number | null;
  state: LiquidationRecorderState;
  points: { t: number; long: number; short: number }[];
}

interface IntelDataset {
  points: IntelPoint[];
  price: { t: number; v: number }[];
  liqSince: number | null;
  liqState: LiquidationRecorderState;
}

const BINANCE_LIQUIDATION_EPOCH_MS = Date.UTC(2017, 0, 1);

const intelCache = new BoundedTtlCache<string, IntelDataset>({ maxEntries: 64, ttlMs: TOKEN_DATA_CACHE_TTL_MS });
const intelInflight = new Map<string, Promise<IntelDataset>>();

const intelKey = (symbol: string, tab: IntelTab, opt: string, hasPerp: boolean) =>
  `${symbol}:${hasPerp ? 'perp' : 'spot'}:${tab}:${opt}`;

function isPlausibleLiquidationTimestamp(value: unknown, observedAtMs: number): value is number {
  return (
    typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= BINANCE_LIQUIDATION_EPOCH_MS
    && Number.isSafeInteger(observedAtMs)
    && observedAtMs >= BINANCE_LIQUIDATION_EPOCH_MS
    && value <= observedAtMs
  );
}

export function parseLiquidationOwnerPayload(
  payload: unknown,
  observedAtMs: number = Date.now(),
): LiquidationOwnerPayload {
  if (typeof payload !== 'object' || payload === null) {
    return { since: null, state: 'invalid', points: [] };
  }
  const candidate = payload as { since?: unknown; state?: unknown; points?: unknown };
  const state = candidate.state === 'live' || candidate.state === 'connecting' || candidate.state === 'down'
    ? candidate.state
    : 'invalid';
  const since = isPlausibleLiquidationTimestamp(candidate.since, observedAtMs)
    ? candidate.since
    : null;
  if (state === 'invalid' || since === null || !Array.isArray(candidate.points)) {
    return { since: null, state: 'invalid', points: [] };
  }
  const points = candidate.points.every((point) => (
    typeof point === 'object' && point !== null
    && isPlausibleLiquidationTimestamp((point as { t?: unknown }).t, observedAtMs)
    && typeof (point as { long?: unknown }).long === 'number'
    && Number.isFinite((point as { long: number }).long)
    && (point as { long: number }).long >= 0
    && typeof (point as { short?: unknown }).short === 'number'
    && Number.isFinite((point as { short: number }).short)
    && (point as { short: number }).short >= 0
    && (
      (point as { long: number }).long > 0
      || (point as { short: number }).short > 0
    )
  ))
    ? candidate.points as { t: number; long: number; short: number }[]
    : null;
  if (points === null) {
    return { since: null, state: 'invalid', points: [] };
  }
  return { since, state, points };
}

export function projectLiquidationRecorderTruth(
  state: LiquidationRecorderState,
  pointCount: number,
  since: number | null,
  observedAtMs: number = Date.now(),
): LiquidationRecorderTruth {
  const hasUsableEvidence = Number.isSafeInteger(pointCount) && pointCount > 0
    && isPlausibleLiquidationTimestamp(since, observedAtMs);
  if (state === 'live' && hasUsableEvidence) {
    return Object.freeze({
      state: 'LIVE',
      mayClaimLive: true,
      value: timeAgo(since),
      note: 'Persistent live owner evidence',
    });
  }
  if (state === 'live' || state === 'connecting') {
    return Object.freeze({
      state: 'STARTING',
      mayClaimLive: false,
      value: 'STARTING',
      note: state === 'live'
        ? 'Recorder is live · waiting for usable event evidence'
        : 'Recorder is connecting · live evidence not established',
    });
  }
  if (state === 'down') {
    return Object.freeze({
      state: 'UNAVAILABLE',
      mayClaimLive: false,
      value: 'UNAVAILABLE',
      note: 'Recorder is down · live evidence unavailable',
    });
  }
  if (state === 'not_applicable') {
    return Object.freeze({
      state: 'NOT_APPLICABLE',
      mayClaimLive: false,
      value: 'NOT APPLICABLE',
      note: 'Spot Only · no perpetual liquidation recorder',
    });
  }
  return Object.freeze({
    state: 'UNKNOWN',
    mayClaimLive: false,
    value: 'UNKNOWN',
    note: 'Recorder state is invalid or unavailable',
  });
}

async function fetchIntelDataset(symbol: string, tab: IntelTab, opt: string, hasPerp: boolean, signal?: AbortSignal): Promise<IntelDataset> {
  const candleMarket = hasPerp ? 'futures' : 'spot';
  const priceFor = async (interval: string, limit: number) => {
    const rows = await fetchJson<TvCandle[]>(`/api/candles?symbol=${symbol}&interval=${interval}&limit=${limit}&market=${candleMarket}`, { signal });
    return normalizeTvCandles(Array.isArray(rows) ? rows : []).map((row) => ({ t: row.t, v: row.c }));
  };

  if (tab === 'volume') {
    const rows = await fetchJson<TvCandle[]>(`/api/candles?symbol=${symbol}&interval=${opt}&limit=1000&market=${candleMarket}`, { signal });
    const candles = normalizeTvCandles(Array.isArray(rows) ? rows : []);
    return {
      points: candles.map((row) => ({ t: row.t, a: row.qv || row.v * row.c })),
      price: candles.map((row) => ({ t: row.t, v: row.c })),
      liqSince: null,
      liqState: 'not_applicable',
    };
  }

  if (!hasPerp) return { points: [], price: [], liqSince: null, liqState: 'not_applicable' };

  if (tab === 'funding') {
    const rows = await fetchJson<{ t: number; ratePct: number }[]>(`/api/futures/funding-hist?symbol=${symbol}&limit=1000`, { signal });
    const cut = opt === '30d' ? Date.now() - 30 * 864e5 : opt === '90d' ? Date.now() - 90 * 864e5 : 0;
    const normalized = normalizeTimedRows(Array.isArray(rows) ? rows : [], (row) => Number.isFinite(row.ratePct));
    return {
      points: normalized.filter((row) => row.t >= cut).map((row) => ({ t: row.t, a: row.ratePct })),
      price: await priceFor('8h', 1000),
      liqSince: null,
      liqState: 'not_applicable',
    };
  }

  if (tab === 'liq') {
    const buckets: Record<string, number> = { '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '12h': 432e5, '1d': 864e5 };
    const data = parseLiquidationOwnerPayload(
      await fetchJson<unknown>(`/api/futures/liquidations?symbol=${symbol}&bucketMs=${buckets[opt] ?? 36e5}`, { signal }),
    );
    const normalized = normalizeTimedRows(data.points, (point) => (
      Number.isFinite(point.long) && point.long >= 0 && Number.isFinite(point.short) && point.short >= 0
    ));
    return {
      points: normalized.map((point) => ({ t: point.t, a: point.long, b: point.short })),
      price: await priceFor(opt === '5m' || opt === '15m' ? opt : '1h', 1000),
      liqSince: data.since,
      liqState: data.state,
    };
  }

  const rows = await fetchJson<BasisPoint[]>(`/api/futures/basis-hist?symbol=${symbol}&period=${opt}&limit=240`, { signal });
  const basis = normalizeTimedRows(Array.isArray(rows) ? rows : [], (row) => (
    Number.isFinite(row.futuresPrice) && row.futuresPrice > 0 && Number.isFinite(row.basisRatePct)
  ));
  return {
    points: basis.map((row) => ({ t: row.t, a: row.basisRatePct })),
    price: basis.map((row) => ({ t: row.t, v: row.futuresPrice })),
    liqSince: null,
    liqState: 'not_applicable',
  };
}

function requestIntelDataset(symbol: string, tab: IntelTab, opt: string, hasPerp: boolean, force = false, signal?: AbortSignal): Promise<IntelDataset> {
  const key = intelKey(symbol, tab, opt, hasPerp);
  const cached = intelCache.get(key);
  if (!force && cached) return Promise.resolve(cached);
  const pending = intelInflight.get(key);
  // Only requests without a component owner are shared. A request carrying a
  // AbortSignal belongs to that poll generation and must never be reused by a
  // later tab/symbol generation after its owner aborts.
  if (!signal && pending) return pending;
  const request = fetchIntelDataset(symbol, tab, opt, hasPerp, signal)
    .then((value) => {
      // Historical chart responses may be reused, but recorder truth must be
      // re-established from the current owner state on every liquidation view.
      if (value.points.length > 0 && tab !== 'liq') {
        intelCache.set(key, value);
      }
      return value;
    })
    .finally(() => {
      if (!signal && intelInflight.get(key) === request) intelInflight.delete(key);
    });
  if (!signal) intelInflight.set(key, request);
  return request;
}

const INTEL_OPTIONS: Record<IntelTab, { id: string; label: string }[]> = {
  funding: [{ id: '30d', label: '30D' }, { id: '90d', label: '90D' }, { id: 'all', label: 'All' }],
  volume: [{ id: '1m', label: '1m' }, { id: '5m', label: '5m' }, { id: '15m', label: '15m' }, { id: '30m', label: '30m' }, { id: '1h', label: '1H' }, { id: '4h', label: '4H' }, { id: '12h', label: '12H' }, { id: '1d', label: '1D' }, { id: '1w', label: 'All' }],
  liq: [{ id: '5m', label: '5m' }, { id: '15m', label: '15m' }, { id: '1h', label: '1H' }, { id: '4h', label: '4H' }, { id: '12h', label: '12H' }, { id: '1d', label: '1D' }],
  basis: [{ id: '5m', label: '5m' }, { id: '1h', label: '1H' }, { id: '4h', label: '4H' }, { id: '1d', label: '1D' }],
};

const INTEL_DEFAULT: Record<IntelTab, string> = { funding: '30d', volume: '1h', liq: '1h', basis: '1h' };
const INTEL_TITLE: Record<IntelTab, string> = {
  funding: 'Funding Rate',
  volume: 'Perpetual Volume',
  liq: 'Liquidations',
  basis: 'Basis',
};

function DerivativesIntelligence({ symbol, base, name, hasPerp, market, openInterest, clockZone }: { symbol: string; base: string; name: string; hasPerp: boolean | null; market: MarketRow | undefined; openInterest: TokenIntelligenceRead['openInterest'] | null; clockZone: string }) {
  const intelHasPerp = hasPerp === true;
  const initialTab: IntelTab = intelHasPerp ? 'funding' : 'volume';
  const initial = hasPerp === null
    ? undefined
    : intelCache.get(intelKey(symbol, initialTab, INTEL_DEFAULT[initialTab], intelHasPerp));
  const [tab, setTab] = useState<IntelTab>(initialTab);
  const [opt, setOpt] = useState(INTEL_DEFAULT[initialTab]);
  const [dataset, setDataset] = useState<IntelDataset>(initial ?? { points: [], price: [], liqSince: null, liqState: 'invalid' });
  const [loading, setLoading] = useState(!initial);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hov, setHov] = useState<number | null>(null);
  const [mouse, setMouse] = useState<{ x: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [chartBox, setChartBox] = useState({ width: 1160, height: 380 });

  useEffect(() => {
    if (hasPerp !== true && tab !== 'volume') {
      setTab('volume');
      setOpt(INTEL_DEFAULT.volume);
    }
  }, [hasPerp, tab]);

  useEffect(() => {
    if (hasPerp === null) {
      setDataset({ points: [], price: [], liqSince: null, liqState: 'invalid' });
      setLoading(false);
      setLoadError(null);
      return;
    }
    const key = intelKey(symbol, tab, opt, intelHasPerp);
    const cached = intelCache.get(key);
    if (cached) {
      setDataset(cached);
      setLoading(false);
      setLoadError(null);
    } else {
      setDataset({ points: [], price: [], liqSince: null, liqState: tab === 'liq' ? 'invalid' : 'not_applicable' });
      setLoading(true);
    }
    let first = true;
    const poll = createSettledPoll<IntelDataset>({
      intervalMs: 60_000,
      request: (signal) => {
        const force = !first;
        first = false;
        return requestIntelDataset(symbol, tab, opt, intelHasPerp, force, signal);
      },
      onSuccess: (next) => {
        setDataset(next);
        setLoading(false);
        setLoadError(null);
      },
      onError: (error) => {
        setLoading(false);
        setLoadError(error instanceof Error ? error.message : 'Data source unavailable');
        if (tab === 'liq') {
          setDataset({ points: [], price: [], liqSince: null, liqState: 'invalid' });
        }
      },
    });
    poll.start();
    return poll.stop;
  }, [hasPerp, intelHasPerp, opt, symbol, tab]);

  useEffect(() => {
    const host = wrapRef.current;
    if (!host) return;
    const measure = () => {
      const width = host.getBoundingClientRect().width;
      if (!Number.isFinite(width) || width <= 0) return;
      const next = { width: Math.round(width), height: Math.round(Math.max(310, Math.min(400, width * 0.245))) };
      setChartBox((previous) => Math.abs(previous.width - next.width) > 2 || Math.abs(previous.height - next.height) > 2 ? next : previous);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [dataset.points.length, tab]);

  const switchTab = (next: IntelTab) => {
    if (hasPerp === null || (next !== 'volume' && hasPerp !== true)) return;
    const nextOpt = INTEL_DEFAULT[next];
    const cached = intelCache.get(intelKey(symbol, next, nextOpt, intelHasPerp));
    if (cached) {
      setDataset(cached);
      setLoading(false);
    } else {
      setDataset({ points: [], price: [], liqSince: null, liqState: next === 'liq' ? 'invalid' : 'not_applicable' });
      setLoading(true);
    }
    setTab(next);
    setOpt(nextOpt);
    setHov(null);
  };

  const { points, price, liqSince, liqState } = dataset;
  const liquidationRecorderTruth = projectLiquidationRecorderTruth(liqState, points.length, liqSince);
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
    const xi = (index: number) => x(points[index].t);
    let aMin = 0;
    let aMax = 1;
    if (tab === 'funding' || tab === 'basis') {
      const values = points.map((point) => point.a);
      const magnitude = Math.max(Math.abs(Math.min(...values, 0)), Math.abs(Math.max(...values, 0)), 1e-9);
      aMin = -magnitude * 1.12;
      aMax = magnitude * 1.12;
    } else if (tab === 'liq') {
      const magnitude = Math.max(...points.map((point) => Math.max(point.a, point.b ?? 0)), 1e-9);
      aMin = -magnitude * 1.12;
      aMax = magnitude * 1.12;
    } else {
      aMax = Math.max(...points.map((point) => point.a), 1e-9) * 1.06;
    }
    const ay = (value: number) => PAD_T + ((aMax - value) / (aMax - aMin)) * (H - PAD_T - PAD_B);
    const inRange = price.filter((point) => point.t >= t0 - 864e5 && point.t <= t1 + 864e5);
    let pMin = Math.min(...inRange.map((point) => point.v));
    let pMax = Math.max(...inRange.map((point) => point.v));
    if (!Number.isFinite(pMin) || !Number.isFinite(pMax)) { pMin = 0; pMax = 1; }
    const priceSpan = Math.max(pMax - pMin, pMax * 1e-9, 1e-12);
    pMin -= priceSpan * 0.08;
    pMax += priceSpan * 0.08;
    const py = (value: number) => PAD_T + ((pMax - value) / (pMax - pMin)) * (H - PAD_T - PAD_B);
    const priceLine = inRange.filter((point) => point.t >= t0 && point.t <= t1).map((point, index) => `${index ? 'L' : 'M'}${x(point.t)},${py(point.v)}`).join(' ');
    const valueLine = points.map((point, index) => `${index ? 'L' : 'M'}${xi(index)},${ay(point.a)}`).join(' ');
    const barWidth = Math.max(1.2, ((W - PAD_L - PAD_R) / points.length) * 0.58);
    const aTicks = Array.from({ length: 4 }, (_, index) => aMin + ((index + 0.5) / 4) * (aMax - aMin));
    const pTicks = Array.from({ length: 4 }, (_, index) => pMin + ((index + 0.5) / 4) * (pMax - pMin));
    const times = [0, Math.floor(points.length / 3), Math.floor((2 * points.length) / 3), points.length - 1];
    const priceAt = (time: number): number | null => {
      if (!inRange.length) return null;
      let closest = inRange[0];
      for (const point of inRange) if (Math.abs(point.t - time) < Math.abs(closest.t - time)) closest = point;
      return closest.v;
    };
    return { x, xi, ay, py, priceLine, valueLine, barWidth, aTicks, pTicks, times, priceAt, zeroY: ay(0) };
  }, [H, W, points, price, tab]);

  const indexFromMouse = (clientX: number): number | null => {
    const bounds = wrapRef.current?.getBoundingClientRect();
    if (!bounds || points.length < 2) return null;
    const chartX = ((clientX - bounds.left) / bounds.width) * W;
    let closest = 0;
    let distance = Infinity;
    for (let index = 0; index < points.length; index += 1) {
      const next = Math.abs((model?.xi(index) ?? 0) - chartX);
      if (next < distance) { distance = next; closest = index; }
    }
    return closest;
  };

  const source = hasPerp === null
    ? 'Market Presence Unknown'
    : tab === 'volume' && hasPerp === false
      ? 'Binance Spot'
      : 'Binance USD-M';
  const selected = points[points.length - 1];
  const metricSets: Record<IntelTab, { label: string; value: string; note: string; tone?: 'up' | 'down' }[]> = {
    funding: [
      { label: 'Current Rate', value: hasPerp === true ? fmtFunding(market?.fundingRate) : hasPerp === false ? 'Spot Only' : 'UNKNOWN', note: hasPerp === null ? 'Market presence unavailable' : market?.fundingRate === null || market?.fundingRate === undefined ? 'Awaiting Contract Feed' : market.fundingRate > 0 ? 'Longs Pay Shorts' : market.fundingRate < 0 ? 'Shorts Pay Longs' : 'Neutral' },
      { label: 'Annualized', value: hasPerp === true ? fmtPct(market?.fundingAnnualPct, 2) : hasPerp === false ? '—' : 'UNKNOWN', note: 'Simple Annualized' },
      { label: 'Next Settlement', value: hasPerp === true && market?.nextFundingTime ? countdown(market.nextFundingTime) : hasPerp === null ? 'UNKNOWN' : '—', note: 'Exchange Schedule' },
      { label: 'Latest Print', value: hasPerp === true ? selected ? `${selected.a.toFixed(4)}%` : '—' : hasPerp === false ? 'Spot Only' : 'UNKNOWN', note: opt === 'all' ? 'Full Available History' : opt.toUpperCase() + ' Window', tone: hasPerp === true && selected ? selected.a < 0 ? 'down' : selected.a > 0 ? 'up' : undefined : undefined },
    ],
    volume: [
      { label: hasPerp === true ? 'Perpetual Volume' : hasPerp === false ? 'Spot Volume' : 'Market Volume', value: hasPerp === true ? fmtMoney(market?.perpVolume24h) : hasPerp === false ? fmtMoney(market?.quoteVolume24h) : 'UNKNOWN', note: 'Rolling 24 Hours' },
      { label: 'Latest Interval', value: hasPerp === null ? 'UNKNOWN' : selected ? '$' + fmtCompact(selected.a) : '—', note: INTEL_OPTIONS.volume.find((item) => item.id === opt)?.label ?? opt },
      { label: 'Open Interest', value: hasPerp === true && openInterest?.state === 'FRESH' ? fmtMoney(openInterest.value?.quoteUsd) : hasPerp === false ? 'Spot Only' : 'UNKNOWN', note: hasPerp === true ? `${openInterest?.state ?? 'UNAVAILABLE'} · Owner snapshot` : hasPerp === false ? 'No Perpetual Contract' : 'Market presence unavailable' },
      { label: 'OI / Volume', value: hasPerp === null ? 'UNKNOWN' : market?.oiToPerpVolume24h === null || market?.oiToPerpVolume24h === undefined ? '—' : `${market.oiToPerpVolume24h.toFixed(2)}×`, note: hasPerp === true ? 'Leverage Density' : hasPerp === false ? 'Not Applicable' : 'Market presence unavailable' },
    ],
    liq: [
      { label: 'Liquidations · 15m', value: hasPerp === true ? fmtMoney(market?.liquidations15mUsd) : hasPerp === false ? 'Spot Only' : 'UNKNOWN', note: 'Confirmed Force Orders' },
      { label: 'Long Liquidations', value: hasPerp === true ? fmtMoney(market?.longLiquidations15mUsd) : hasPerp === false ? 'Spot Only' : 'UNKNOWN', note: '15 Minute Window', tone: hasPerp === true && typeof market?.longLiquidations15mUsd === 'number' && Number.isFinite(market.longLiquidations15mUsd) && market.longLiquidations15mUsd > 0 ? 'down' : undefined },
      { label: 'Short Liquidations', value: hasPerp === true ? fmtMoney(market?.shortLiquidations15mUsd) : hasPerp === false ? 'Spot Only' : 'UNKNOWN', note: '15 Minute Window', tone: hasPerp === true && typeof market?.shortLiquidations15mUsd === 'number' && Number.isFinite(market.shortLiquidations15mUsd) && market.shortLiquidations15mUsd > 0 ? 'up' : undefined },
      { label: 'Recorder', value: hasPerp === true ? liquidationRecorderTruth.value : hasPerp === false ? 'Spot Only' : 'UNKNOWN', note: hasPerp === true ? liquidationRecorderTruth.note : hasPerp === false ? 'Spot Only · no perpetual liquidation recorder' : 'Market presence unavailable' },
    ],
    basis: [
      { label: 'Perpetual Mark', value: hasPerp === true ? fmtPrice(market?.perpMark) : hasPerp === false ? 'Spot Only' : 'UNKNOWN', note: 'Binance USD-M' },
      { label: 'Index Price', value: hasPerp === true ? fmtPrice(market?.perpIndexPrice) : hasPerp === false ? 'Spot Only' : 'UNKNOWN', note: 'Reference Basket' },
      { label: 'Mark Basis', value: hasPerp === true ? fmtBasis(market?.markIndexBasisPct) : hasPerp === false ? 'Spot Only' : 'UNKNOWN', note: 'Mark Versus Index', tone: hasPerp === true && typeof market?.markIndexBasisPct === 'number' && Number.isFinite(market.markIndexBasisPct) ? market.markIndexBasisPct < 0 ? 'down' : market.markIndexBasisPct > 0 ? 'up' : undefined : undefined },
      { label: 'Executable Gap', value: hasPerp === true ? fmtBasis(market?.executableBasisBestPct) : hasPerp === false ? 'Spot Only' : 'UNKNOWN', note: market?.executableBasisSide === 'LONG_SPOT_SHORT_PERP' ? 'Buy Spot · Sell Perp' : market?.executableBasisSide === 'SHORT_SPOT_LONG_PERP' ? 'Sell Spot · Buy Perp' : hasPerp === null ? 'Market presence unavailable' : hasPerp === false ? 'Not Applicable' : 'No Crossed-Book Edge' },
    ],
  };
  const activePoint = hov !== null ? points[hov] : null;
  const requiresPerp = tab !== 'volume';
  const retainedAfterRefreshFailure = loadError !== null && points.length > 0;
  const formatAxis = (value: number) => tab === 'funding' || tab === 'basis' ? `${value.toFixed(4)}%` : '$' + fmtCompact(value);
  const formatValue = (value: number) => tab === 'funding' || tab === 'basis' ? `${value.toFixed(4)}%` : '$' + fmtFull(value, 0);

  return (
    <section className="tdx-cell tdx-cgx tkx-intelligence" aria-label="Token derivatives intelligence">
      <div className="tkx-intelligence-head">
        <div>
          <span className="tkx-section-label">Derivatives Intelligence</span>
          <p>Funding, leverage, participation, forced unwinds and carry for {base}.</p>
        </div>
        {hasPerp !== null ? <PillSelect value={opt} options={INTEL_OPTIONS[tab]} onChange={setOpt} ariaLabel="Data interval" /> : null}
      </div>
      <div className="cgx-tabs tkx-intelligence-tabs" role="tablist" aria-label="Derivatives data">
        <button type="button" role="tab" aria-selected={tab === 'funding'} className={tab === 'funding' ? 'on' : ''} data-testid="token-cgx-funding" disabled={hasPerp !== true} title={hasPerp === null ? 'Perpetual availability unknown' : hasPerp === false ? 'Not applicable to a spot-only market' : undefined} onClick={() => switchTab('funding')}>Funding</button>
        <button type="button" role="tab" aria-selected={tab === 'volume'} className={tab === 'volume' ? 'on' : ''} data-testid="token-cgx-volume" disabled={hasPerp === null} title={hasPerp === null ? 'Market availability unknown' : undefined} onClick={() => switchTab('volume')}>Volume</button>
        <button type="button" role="tab" aria-selected={tab === 'liq'} className={tab === 'liq' ? 'on' : ''} data-testid="token-cgx-liquidation" disabled={hasPerp !== true} title={hasPerp === null ? 'Perpetual availability unknown' : hasPerp === false ? 'Not applicable to a spot-only market' : undefined} onClick={() => switchTab('liq')}>Liquidation</button>
        <button type="button" role="tab" aria-selected={tab === 'basis'} className={tab === 'basis' ? 'on' : ''} data-testid="token-cgx-basis" disabled={hasPerp !== true} title={hasPerp === null ? 'Perpetual availability unknown' : hasPerp === false ? 'Not applicable to a spot-only market' : undefined} onClick={() => switchTab('basis')}>Basis</button>
      </div>
      <div className="tkx-instrument-metrics" aria-label={`${INTEL_TITLE[tab]} snapshot`}>
        {metricSets[tab].map((metric) => {
          const tone = retainedAfterRefreshFailure && metric.tone === 'up' ? '' : metric.tone ?? '';
          return (
            <div key={metric.label}>
              <span>{metric.label}</span>
              <strong className={tone}>{metric.value}</strong>
              <small>{metric.note}</small>
            </div>
          );
        })}
      </div>
      <h3 className="cgx-title">{name} {INTEL_TITLE[tab]} <em className="tdx-src">{source}</em></h3>
      {retainedAfterRefreshFailure ? <p className="tdx-updated" role="status">refresh unavailable · last verified</p> : null}
      {hasPerp === null ? (
        <div className="tdx-cgx-empty"><p className="tdx-dimnote">Market Presence UNKNOWN — derivative values and data controls are withheld until canonical market truth is current.</p></div>
      ) : requiresPerp && hasPerp === false ? (
        <div className="tdx-cgx-empty"><p className="tdx-dimnote">Spot Only — {base} has no Binance USD-M perpetual feed for this view.</p></div>
      ) : !model ? (
        <div className="tdx-cgx-empty">
          {loading
            ? <div className="tkx-chart-skeleton" aria-label={`Loading ${INTEL_TITLE[tab]}`}><i /><i /><i /><i /></div>
            : tab === 'liq'
            ? <p className="tdx-dimnote" role={loadError ? 'alert' : 'status'}>
                {liquidationRecorderTruth.state === 'STARTING'
                  ? liquidationRecorderTruth.note
                  : liquidationRecorderTruth.state === 'UNAVAILABLE'
                    ? 'UNAVAILABLE · liquidation recorder is down.'
                    : liquidationRecorderTruth.state === 'LIVE'
                      ? 'LIVE · recorder owner and event evidence verified; waiting for enough points to chart.'
                      : `UNKNOWN · ${loadError ?? 'liquidation recorder evidence is unavailable.'}`}
              </p>
            : <p className="tdx-dimnote" role={loadError ? 'alert' : undefined}>{loadError ? `${INTEL_TITLE[tab]} unavailable — ${loadError}` : `No ${INTEL_TITLE[tab].toLowerCase()} data returned for this interval.`}</p>}
        </div>
      ) : (
        <>
          <div
            ref={wrapRef}
            className="tdx-chartwrap tkx-intelligence-chart"
            onMouseMove={(event) => {
              setHov(indexFromMouse(event.clientX));
              const bounds = wrapRef.current?.getBoundingClientRect();
              if (bounds) setMouse({ x: event.clientX - bounds.left });
            }}
            onMouseLeave={() => { setHov(null); setMouse(null); }}
          >
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="tdx-datachart" aria-hidden>
              {model.aTicks.map((value, index) => (
                <g key={`a${index}`}>
                  <line x1={PAD_L} x2={W - PAD_R} y1={model.ay(value)} y2={model.ay(value)} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <text x={PAD_L - 8} y={model.ay(value) + 4} textAnchor="end" className="tdx-axis">{formatAxis(value)}</text>
                </g>
              ))}
              {model.pTicks.map((value, index) => <text key={`p${index}`} x={W - PAD_R + 8} y={model.py(value) + 4} className="tdx-axis">{fmtPrice(value)}</text>)}
              {hov !== null && <line x1={model.xi(hov)} x2={model.xi(hov)} y1={PAD_T} y2={H - PAD_B} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
              {tab === 'basis' && <path d={model.valueLine} fill="none" stroke="var(--accent)" strokeWidth="1.35" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
              {tab === 'volume' && points.map((point, index) => <rect key={point.t} x={model.xi(index) - model.barWidth / 2} y={model.ay(point.a)} width={model.barWidth} height={Math.max(1, H - PAD_B - model.ay(point.a))} rx="1" fill="var(--accent)" opacity={hov === null ? 0.58 : hov === index ? 0.92 : 0.2} />)}
              {tab === 'funding' && points.map((point, index) => <rect key={point.t} x={model.xi(index) - model.barWidth / 2} y={point.a >= 0 ? model.ay(point.a) : model.zeroY} width={model.barWidth} height={Math.max(1, Math.abs(model.ay(point.a) - model.zeroY))} rx="1" fill={point.a >= 0 ? retainedAfterRefreshFailure ? 'var(--muted)' : 'var(--up)' : 'var(--down)'} opacity={hov === null ? 0.72 : hov === index ? 1 : 0.25} />)}
              {tab === 'liq' && points.map((point, index) => (
                <g key={point.t}>
                  <rect x={model.xi(index) - model.barWidth / 2} y={model.ay(point.a)} width={model.barWidth} height={Math.max(0.5, model.zeroY - model.ay(point.a))} rx="1" fill="var(--down)" opacity={hov === null ? 0.78 : hov === index ? 1 : 0.25} />
                  <rect x={model.xi(index) - model.barWidth / 2} y={model.zeroY} width={model.barWidth} height={Math.max(0.5, model.ay(-(point.b ?? 0)) - model.zeroY)} rx="1" fill={retainedAfterRefreshFailure ? 'var(--muted)' : 'var(--up)'} opacity={hov === null ? 0.78 : hov === index ? 1 : 0.25} />
                </g>
              ))}
              {(tab === 'funding' || tab === 'liq' || tab === 'basis') && <line x1={PAD_L} x2={W - PAD_R} y1={model.zeroY} y2={model.zeroY} stroke="var(--line-2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
              <path d={model.priceLine} fill="none" stroke="#F0B90B" strokeWidth="1.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {model.times.map((index) => <text key={`t${index}`} x={model.xi(index)} y={H - 8} textAnchor="middle" className="tdx-axis">{formatClockZone(points[index].t, clockZone, points[points.length - 1].t - points[0].t > 300 * 864e5 ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' })}</text>)}
            </svg>
            {activePoint && mouse && (
              <ChartTip
                x={mouse.x}
                w={wrapRef.current?.clientWidth ?? W}
                title={tipTime(activePoint.t, clockZone)}
                rows={[
                  ...(tab === 'liq'
                    ? [
                        { dot: 'var(--down)', label: 'Long Liquidations', value: '$' + fmtFull(activePoint.a, 0) },
                        { dot: retainedAfterRefreshFailure ? 'var(--muted)' : 'var(--up)', label: 'Short Liquidations', value: '$' + fmtFull(activePoint.b ?? 0, 0) },
                      ]
                    : [{ dot: tab === 'funding' ? (activePoint.a >= 0 ? retainedAfterRefreshFailure ? 'var(--muted)' : 'var(--up)' : 'var(--down)') : 'var(--accent)', label: INTEL_TITLE[tab], value: formatValue(activePoint.a) }]),
                  ...(model.priceAt(activePoint.t) !== null ? [{ dot: '#F0B90B', label: `${base} Price`, value: fmtFull(model.priceAt(activePoint.t) as number, 2) }] : []),
                ]}
              />
            )}
          </div>
          <div className="tdx-legend">
            {tab === 'liq' ? <><span><i className="sw" style={{ background: 'var(--down)' }} />Long Liquidations</span><span><i className="sw" style={{ background: retainedAfterRefreshFailure ? 'var(--muted)' : 'var(--up)' }} />Short Liquidations</span></> : <span><i className="sw" style={{ background: 'var(--accent)', opacity: 0.8 }} />{INTEL_TITLE[tab]}</span>}
            <span><i className="dot" style={{ borderColor: '#F0B90B' }} />{base} Price</span>
            {tab === 'liq' && liquidationRecorderTruth.mayClaimLive && liqSince ? <span className="cgx-note">Recording Since {formatClockZone(liqSince, clockZone, { month: 'short', day: 'numeric' })} · No Historical REST Feed</span> : null}
          </div>
        </>
      )}
    </section>
  );
}

const TOKEN_CAPABILITY_LABELS = [
  ['ROLLING_ACTIVITY_FLOW', 'Rolling Flow'],
  ['SPREAD_DEPTH_BOOK', 'Depth / Replenishment'],
  ['CROSS_MARKET_LEADERSHIP', 'Cross-Market Lead'],
  ['OPEN_INTEREST', 'Open Interest'],
  ['FUNDING', 'Funding'],
  ['VOLATILITY', 'Volatility'],
  ['LIQUIDATION', 'Liquidations'],
  ['CONTEXT', 'Context'],
  ['SOURCE_QUALITY', 'Source Quality'],
] as const;

function symbolOpenOrderCount(snapshot: PrivateReadSnapshot, symbol: string): number | null {
  if (snapshot.spot.openOrders === null
      || snapshot.margin.openOrders === null
      || snapshot.usdm.openOrders === null) return null;
  return snapshot.spot.openOrders.filter((order) => order.symbol === symbol).length
    + snapshot.margin.openOrders.filter((order) => order.symbol === symbol).length
    + snapshot.usdm.openOrders.filter((order) => order.symbol === symbol).length;
}

function TokenEvidenceWorkspace({
  symbol,
  base,
  intelligence,
  intelligenceError,
  privateRead,
  privateReadGuard,
  privateReadSource,
  news,
  newsError,
  marketCurrent,
}: {
  symbol: string;
  base: string;
  intelligence: TokenIntelligenceRead | null;
  intelligenceError: string | null;
  privateRead: PrivateReadSnapshot;
  privateReadGuard: PrivateReadGuardProjection;
  privateReadSource: PrivateReadSourceId;
  news: TokenNewsContext | null;
  newsError: string | null;
  marketCurrent: boolean;
}) {
  const thesis = intelligence?.bridge.thesis ?? null;
  const usableThesisAtCut = thesis?.freshness === 'FRESH'
    && thesis.completeness === 'COMPLETE'
    ? thesis
    : null;
  const thesisCutState = thesis === null
    ? 'MISSING'
    : `${thesis.freshness === 'MISSING' ? 'MISSING' : `${thesis.freshness}_AT_CUT`} · ${thesis.completeness}`;
  const capabilities = new Map(
    (intelligence?.routing.capabilities ?? []).map((capability) => [capability.capability, capability]),
  );
  const anyFreshEvidence = intelligence !== null && (
    intelligence.markFunding.state === 'FRESH'
    || intelligence.openInterest.state === 'FRESH'
    || intelligence.liquidation.state === 'FRESH'
    || intelligence.routing.capabilities.some((capability) => capability.freshness === 'FRESH')
  );
  const surfaceState = intelligence === null
    ? intelligenceError ? 'UNAVAILABLE' : 'UNKNOWN'
    : intelligence.projection.state === 'ACTIVE' && anyFreshEvidence
      ? 'EVIDENCE_ONLY'
      : intelligence.projection.state;
  const taggedNews = (news?.items ?? [])
    .filter((item) => item.symbols.some((candidate) => candidate === base || candidate === symbol))
    .slice(0, 3);
  const liveNewsSources = news?.sources.filter((source) => source.status === 'live').length ?? 0;
  const newsState = news === null
    ? newsError ? 'UNAVAILABLE' : 'UNKNOWN'
    : news.freshness === 'STALE'
      ? 'STALE'
      : news.sources.length === 0
      ? 'UNAVAILABLE'
      : liveNewsSources === news.sources.length
        ? 'AVAILABLE'
        : liveNewsSources > 0
          ? 'PARTIAL'
          : news.sources.some((source) => source.status === 'delayed') ? 'DELAYED' : 'UNAVAILABLE';
  const baseBalance = privateRead.spot.balances?.find((balance) => balance.asset === base) ?? null;
  const usdtBalance = privateRead.spot.balances?.find((balance) => balance.asset === 'USDT') ?? null;
  const openOrders = symbolOpenOrderCount(privateRead, symbol);
  const privateObservationLabel = privateReadGuard.presentation.freshness.state === 'CURRENT'
    ? 'CURRENT'
    : privateReadGuard.presentation.freshness.state === 'STALE'
      ? 'STALE LAST-KNOWN'
      : `FRESHNESS ${privateReadGuard.presentation.freshness.state}`;
  const ownerReasons = intelligence
    ? [...intelligence.bridge.reasonCodes, ...(thesis?.reasonCodes ?? [])].slice(0, 8)
    : [];

  return (
    <section className="tkx-owner-evidence" aria-label="Canonical token evidence">
      <header className="tkx-owner-evidence-head">
        <div>
          <span className="tkx-section-label">Canonical Evidence</span>
          <h2>What changed, what led, and what remains unknown</h2>
        </div>
        <span className={`tkx-owner-state ${surfaceState === 'EVIDENCE_ONLY' ? 'available' : surfaceState === 'UNKNOWN' ? 'unknown' : 'unavailable'}`}>
          {surfaceState}
        </span>
      </header>

      <div className="tkx-owner-thesis">
        <article>
          <span>Changed First · Latest At Cut</span>
          <strong>{usableThesisAtCut?.changedFirst ?? 'UNKNOWN'}</strong>
          <small>{usableThesisAtCut
            ? `Latest owner thesis ${thesisCutState} · Lead market ${usableThesisAtCut.leadMarket} · cut ${timeAgo(usableThesisAtCut.evaluatedAtMs)}`
            : `Latest owner thesis ${thesisCutState} · value withheld`}</small>
        </article>
        <article>
          <span>Hypothesis · Latest At Cut</span>
          <strong>{usableThesisAtCut?.hypothesis ?? 'UNKNOWN'}</strong>
          <small>{usableThesisAtCut
            ? `Stage ${usableThesisAtCut.stage} · ${thesisCutState} · cut ${timeAgo(usableThesisAtCut.evaluatedAtMs)}`
            : `Stage withheld · ${thesisCutState}`}</small>
        </article>
        <article>
          <span>Confidence</span>
          <strong>UNKNOWN</strong>
          <small>This owner publishes no confidence score.</small>
        </article>
        <article>
          <span>Current Projection</span>
          <strong>{intelligence?.bridge.currentState ?? 'UNKNOWN'}</strong>
          <small>{intelligence ? `Read ${timeAgo(intelligence.observedAtMs)}` : intelligenceError ?? 'Awaiting owner readback'}</small>
        </article>
      </div>

      <div className="tkx-owner-body">
        <div className="tkx-capability-list" role="list" aria-label="Token evidence capabilities">
          {TOKEN_CAPABILITY_LABELS.map(([id, label]) => {
            const capability = capabilities.get(id);
            return (
              <div role="listitem" key={id}>
                <span>{label}</span>
                <strong className={(capability?.freshness ?? 'MISSING').toLowerCase()}>{capability?.freshness ?? 'MISSING'}</strong>
                <small>{capability
                  ? `${capability.completeness} · ${capability.sourceIds.join(', ') || 'source unavailable'}${capability.reasonCodes.length ? ` · ${capability.reasonCodes.slice(0, 2).join(', ')}` : ''}`
                  : 'No exact-symbol routed observation'}</small>
              </div>
            );
          })}
        </div>

        <div className="tkx-context-truth" aria-label="Token private-read and context truth">
          <div>
            <span>Account Context</span>
            <strong>{privateReadGuard.statusLabel}</strong>
            <small>{baseBalance
              ? `${baseBalance.free} ${base} free · ${baseBalance.locked} locked · ${privateObservationLabel}`
              : `Base balance row unavailable; no zero substitute · ${privateReadGuard.statusLabel}`}</small>
          </div>
          <div>
            <span>Open Orders</span>
            <strong>{openOrders === null ? 'UNKNOWN' : `${openOrders} OBSERVED`}</strong>
            <small>{openOrders === null
              ? `Order truth unavailable · ${privateReadGuard.statusLabel}`
              : `${symbol} rows · ${privateObservationLabel} · ${privateRead.reconciliation.orders.state} · ${privateReadGuard.statusLabel}`}</small>
          </div>
          <div>
            <span>USDT Available</span>
            <strong>{usdtBalance?.free ?? 'UNKNOWN'}</strong>
            <small>{usdtBalance
              ? `Observed fixed-scale value · ${privateRead.reconciliation.balances.state} · ${privateObservationLabel}`
              : `Balance row unavailable; no zero substitute · ${privateReadGuard.statusLabel}`}</small>
          </div>
          <div>
            <span>Evidence History</span>
            <strong>{intelligence ? `${intelligence.bridge.evidenceHistoryCount} HISTORICAL` : 'UNKNOWN'}</strong>
            <small>{intelligence ? `${intelligence.bridge.evidenceHistoryState} retained history; not current truth` : 'Owner history unavailable'}</small>
          </div>
          <div className="tkx-context-wide">
            <span>News Context</span>
            <strong>{newsState}</strong>
            <small>{news
              ? `${liveNewsSources}/${news.sources.length} sources live · owner read ${timeAgo(news.fetchedAt)}`
              : newsError ?? `Awaiting public-news owner · private source ${privateReadSource}`}</small>
          </div>
        </div>
      </div>

      <div className="tkx-owner-current" aria-label="Current owner values">
        <div>
          <span>Canonical OI</span>
          <strong>{marketCurrent && intelligence?.openInterest.state === 'FRESH' ? fmtMoney(intelligence.openInterest.value?.quoteUsd) : 'UNKNOWN'}</strong>
          <small>{marketCurrent ? `${intelligence?.openInterest.state ?? 'UNAVAILABLE'} · ${intelligence?.openInterest.dataset ?? 'usd_m.open_interest'}` : 'Market truth is not current; value withheld.'}</small>
        </div>
        <div>
          <span>OI Change</span>
          <strong>{marketCurrent && intelligence?.openInterest.state === 'FRESH' ? fmtPct(intelligence.openInterest.value?.changePct, 2) : 'UNKNOWN'}</strong>
          <small>{marketCurrent ? 'MarketEngine owner observation; no client recompute.' : 'Market truth is not current; value withheld.'}</small>
        </div>
        <div>
          <span>Sampled Liquidations · 15m</span>
          <strong>{marketCurrent && intelligence?.liquidation.state === 'FRESH' ? fmtMoney(intelligence.liquidation.value?.total15mUsd) : 'UNKNOWN'}</strong>
          <small>{marketCurrent ? `${intelligence?.liquidation.state ?? 'UNAVAILABLE'} · latest-per-symbol lower bound` : 'Market truth is not current; value withheld.'}</small>
        </div>
        <div>
          <span>Tagged News</span>
          <strong>{news ? taggedNews.length : 'UNKNOWN'}</strong>
          <small>Owner tags in returned slice; zero does not prove absence.</small>
        </div>
      </div>

      {news?.sources.length ? (
        <div className="tkx-news-sources" aria-label="News owner source status">
          {news.sources.map((source) => (
            <span key={source.key}><b>{source.key}</b> {source.status.toUpperCase()} · {source.fetchedAt === null ? 'age unknown' : timeAgo(source.fetchedAt)}</span>
          ))}
        </div>
      ) : null}

      {taggedNews.length ? (
        <div className="tkx-token-news" aria-label={`${base} owner-tagged news`}>
          {taggedNews.map((item) => (
            <div key={item.id}>
              <span>{item.source}</span>
              <strong>{item.title}</strong>
              <small>{item.channel}{item.ts ? ` · ${timeAgo(item.ts)}` : ' · time UNKNOWN'}</small>
            </div>
          ))}
        </div>
      ) : null}

      {ownerReasons.length ? <p className="tkx-owner-reasons">Owner reasons: {ownerReasons.join(' · ')}</p> : null}
    </section>
  );
}

export function TokenDetail({ symbol }: { symbol: string }) {
  const { binding } = useProductControlRoomContext();
  const {
    markets,
    marketStatus,
    marketsLastSuccessAtMs,
    marketsUpdatedAt,
    marketsError,
    connected,
    state,
    prefs,
    privateRead,
    privateReadError,
    privateReadSource,
    toggleWatch,
    setPage,
    openDetail,
  } = useStore();
  const [range, setRange] = useState<RangeKey>('1D');
  const [ivl, setIvl] = useState<'auto' | IntervalKey>('auto');
  const [tv, setTv] = useState(false);
  const [src, setSrc] = useState<'spot' | 'futures'>('spot');
  const [chartFocus, setChartFocus] = useState(false);
  const [candles, setCandles] = useState<TvCandle[]>([]);
  const [candleError, setCandleError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TokenProfile | null>(null);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [basisSnapshot, setBasisSnapshot] = useState<BasisEngineSnapshot | null>(null);
  const [basisError, setBasisError] = useState<string | null>(null);
  const [intelligence, setIntelligence] = useState<TokenIntelligenceRead | null>(null);
  const [intelligenceError, setIntelligenceError] = useState<string | null>(null);
  const [newsContext, setNewsContext] = useState<TokenNewsContext | null>(null);
  const [newsContextError, setNewsContextError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const marketTruth = projectMarketConsumerTruth({
    status: marketStatus,
    lastSuccessAtMs: marketsLastSuccessAtMs,
    sourceUpdatedAtMs: marketsUpdatedAt,
    nowMs,
  });
  const marketFreshness = resolveMarketFreshness({
    connected,
    error: marketsError,
    sourceTimeMs: marketsUpdatedAt,
    nowMs,
    staleAfterMs: Math.max(12_000, (prefs.dataCadence?.market ?? prefs.refreshSec) * 2500),
  });
  const marketCurrent = marketTruth.label === 'CURRENT' && marketFreshness.live;
  const marketStateLabel = marketTruth.label === 'CURRENT' && !marketFreshness.live
    ? `MARKET ${marketFreshness.status}`
    : marketTruth.label;
  const live = marketCurrent ? markets.find((market) => market.symbol === symbol) : undefined;
  const base = baseOf(symbol);
  const name = profile?.name ?? tokenName(base);
  const watchlisted = state?.config.watchlist.includes(symbol) ?? false;
  const marketPresence = live?.hasPerp === true
    ? 'SPOT_PERP'
    : live?.hasSpot === true
      ? 'SPOT_ONLY'
      : 'UNKNOWN';
  const hasPerp = marketPresence === 'SPOT_PERP'
    ? true
    : marketPresence === 'SPOT_ONLY'
      ? false
      : null;
  const tokenMarketCurrent = marketCurrent && marketPresence !== 'UNKNOWN';
  const privateReadGuard = projectPrivateReadGuard({
    snapshot: privateRead,
    source: privateReadSource,
    error: privateReadError,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  // The shell keeps one scroll container across routes. A symbol workspace
  // must always open at its identity and live snapshot, never halfway down a
  // chart left over from the previous route.
  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [symbol]);

  // Futures klines have no 1s granularity — coerce to 1m on that source.
  const raw = ivl === 'auto' ? RANGES[range] : { interval: ivl, limit: INTERVAL_LIMIT[ivl] };
  const effective = src === 'futures' && raw.interval === '1s' ? { interval: '1m', limit: 60 } : raw;
  const tvSymbol = src === 'futures' && hasPerp === true ? `BINANCE:${symbol}.P` : `BINANCE:${symbol}`;
  const tvInterval = effective.interval;

  useEffect(() => {
    if (hasPerp !== true && src === 'futures') setSrc('spot');
  }, [hasPerp, src]);

  // ---- price series: server-owned public kline history --------------------
  useEffect(() => {
    const { interval, limit } = effective;
    const cacheKey = `${symbol}:${src}:${interval}:${limit}`;
    setCandles(tokenCandleCache.get(cacheKey) ?? []);
    setCandleError(null);
    // The same-origin public-source owner hydrates and periodically reconciles
    // history. The browser never opens a second exchange transport.
    const poll = createSettledPoll<TvCandle[]>({
      intervalMs: 30_000,
      request: (signal) => fetchJson(`/api/candles?symbol=${symbol}&interval=${interval}&limit=${limit}&market=${src}`, { signal }),
      onSuccess: (payload) => {
        const next = normalizeTvCandles(Array.isArray(payload) ? payload : []);
        if (!next.length) {
          setCandleError('Candle source returned no usable rows.');
          return;
        }
        tokenCandleCache.set(cacheKey, next);
        setCandles(next);
        setCandleError(null);
      },
      onError: (error) => setCandleError(apiErrorMessage(error, 'Candle history is unavailable')),
    });
    poll.start();
    return poll.stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, range, ivl, src]);

  // profile: name + whitepaper/homepage for the header (bounded warm-up retry)
  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;
    let controller: AbortController | null = null;
    let attempt = 0;
    const schedule = () => {
      if (stopped || attempt >= 6) return;
      timer = window.setTimeout(loadProfile, Math.min(30_000, 5_000 * (2 ** Math.max(0, attempt - 1))));
    };
    const loadProfile = async () => {
      if (stopped || controller) return;
      attempt += 1;
      controller = new AbortController();
      try {
        const payload = await fetchJson<{ profile?: TokenProfile | null }>(`/api/token/profile?base=${base}`, { signal: controller.signal }, 8_000);
        if (stopped) return;
        if (payload.profile) setProfile(payload.profile);
        else schedule();
      } catch {
        if (!stopped) schedule();
      } finally {
        controller = null;
      }
    };
    setProfile(null);
    void loadProfile();
    return () => {
      stopped = true;
      controller?.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [base, symbol]);

  // Basis context comes from the same crossed-book runtime that drives the
  // Basis page. It is never recomputed or inferred in this component.
  useEffect(() => {
    if (hasPerp !== true) {
      setBasisSnapshot(null);
      setBasisError(null);
      return;
    }
    setBasisSnapshot(null);
    setBasisError(null);
    const poll = createSettledPoll<BasisEngineSnapshot>({
      intervalMs: 2_000,
      request: async (signal) => {
        const decoded = decodeBasisRuntimeSnapshot(
          await fetchJson<unknown>('/api/engine/basis', { cache: 'no-store', signal }),
        );
        if (decoded === null) throw new TypeError('Basis runtime read failed its published contract.');
        return decoded;
      },
      onSuccess: (next) => {
        setBasisSnapshot(next);
        setBasisError(null);
      },
      onError: (error) => {
        setBasisSnapshot(null);
        setBasisError(apiErrorMessage(error, 'Basis runtime unavailable'));
      },
    });
    poll.start();
    return poll.stop;
  }, [hasPerp, symbol]);

  // Exact-symbol public evidence comes from the one production
  // MarketEngine -> router -> Bridge composition. This browser owns no OI,
  // liquidation, source-health, or hypothesis calculation.
  useEffect(() => {
    setIntelligence(null);
    setIntelligenceError(null);
    const poll = createSettledPoll<TokenIntelligenceRead>({
      intervalMs: 2_000,
      request: async (signal) => {
        const raw = await fetchJson<unknown>(`/api/intelligence/token?symbol=${symbol}`, { cache: 'no-store', signal });
        const parsed = parseTokenIntelligence(raw, symbol, Date.now());
        if (!parsed) throw new Error('Canonical token evidence contract mismatch');
        return parsed;
      },
      onSuccess: (next) => {
        setIntelligence(next);
        setIntelligenceError(null);
      },
      onError: (error) => {
        setIntelligence(null);
        setIntelligenceError(apiErrorMessage(error, 'Canonical token evidence unavailable'));
      },
    });
    poll.start();
    return poll.stop;
  }, [symbol]);

  // News stays a separate public context owner. Symbol relevance uses only
  // explicit owner-supplied symbol tags, never title heuristics.
  useEffect(() => {
    setNewsContext(null);
    setNewsContextError(null);
    const poll = createSettledPoll<TokenNewsContext>({
      intervalMs: 15_000,
      request: async (signal) => {
        const raw = await fetchJson<unknown>('/api/news-context?limit=220', { cache: 'no-store', signal });
        const parsed = parseTokenNewsContext(raw, Date.now());
        if (!parsed) throw new Error('News context contract mismatch');
        return parsed;
      },
      onSuccess: (next) => {
        setNewsContext(next);
        setNewsContextError(null);
      },
      onError: (error) => {
        setNewsContext(null);
        setNewsContextError(apiErrorMessage(error, 'News context unavailable'));
      },
    });
    poll.start();
    return poll.stop;
  }, [symbol]);

  const points = useMemo(() => {
    if (candles.length) return candles.map((c) => ({ t: c.t, v: c.c }));
    // F-068: never synthesise a time axis. The spark array carries no
    // timestamps; fabricating a 5-minute grid anchored at Date.now() rendered
    // invented times on a real chart. With no candles the chart stays empty
    // and the candle error at the chart footer tells the truth.
    return [] as { t: number; v: number }[];
  }, [candles]);
  const price = live?.spot ?? null;
  const chartPrice = lastOf(points)?.v ?? null;
  const first = points[0]?.v ?? null;
  const rangeAbs = chartPrice !== null && first !== null ? chartPrice - first : null;
  const rangePct = chartPrice !== null && first !== null && first > 0
    ? ((chartPrice - first) / first) * 100
    : null;
  const up = (rangePct ?? 0) >= 0;
  const basisComponent = binding.snapshot?.components.find((component) => component.componentId === 'basis-engine');
  const basisCanonicalReason = binding.continuity !== 'PROVEN'
    ? binding.error ?? `CANONICAL_CONTINUITY_${binding.continuity}`
    : basisComponent
      ? `BASIS_ENGINE_${basisComponent.observedLifecycle}: ${[
        basisComponent.blockerCode,
        basisComponent.canonicalPresentation.stateLabel,
      ].filter(Boolean).join(' · ')}`
      : 'BASIS_ENGINE_CANONICAL_TRUTH_MISSING';
  const basisCanonicalReady = Boolean(
    binding.continuity === 'PROVEN'
    && basisComponent?.observedLifecycle === 'READY'
    && basisComponent.canonicalPresentation.status === 'operational',
  );
  const basisCanonicalLoading = Boolean(
    binding.loading && binding.snapshot === null && binding.error === null
    || binding.continuity === 'PROVEN'
      && basisComponent
      && ['START_REQUESTED', 'STARTING', 'WARMING'].includes(basisComponent.observedLifecycle),
  );
  const basisSnapshotIsCurrent = basisSnapshot !== null
    && basisRuntimeSnapshotCurrent(basisSnapshot, nowMs);
  const basisCurrent = tokenMarketCurrent
    && basisCanonicalReady
    && basisError === null
    && basisSnapshotIsCurrent;
  const basisReason = basisError
    ?? (!basisCanonicalReady
      ? basisCanonicalLoading ? 'STARTING' : basisCanonicalReason
      : basisSnapshot === null
        ? 'STARTING'
        : !basisSnapshotIsCurrent
          ? 'BASIS_SOURCE_TIMESTAMPS_NOT_CURRENT'
          : null);
  const basisContext = basisCurrent && basisSnapshot
    ? basisSnapshot.rows.find((row) => row.symbol === symbol) ?? null
    : null;

  const searchMatches = useMemo(() => {
    const needle = q.trim().toUpperCase();
    if (!needle || !marketCurrent) return [];
    return markets
      .filter((m) => m.base.includes(needle) || tokenName(m.base).toUpperCase().includes(needle))
      .slice(0, 8);
  }, [marketCurrent, markets, q]);

  const toggleCurrentWatch = async () => {
    if (watchBusy) return;
    setWatchBusy(true);
    setWatchError(null);
    try {
      const error = await toggleWatch(symbol);
      if (error) setWatchError(error.message);
    } catch (error) {
      setWatchError(error instanceof Error ? error.message : 'Watchlist change failed.');
    } finally {
      setWatchBusy(false);
    }
  };

  const executableDirection = live?.executableBasisSide === 'LONG_SPOT_SHORT_PERP'
    ? 'Buy Spot · Sell Perp'
    : live?.executableBasisSide === 'SHORT_SPOT_LONG_PERP'
      ? 'Sell Spot · Buy Perp'
      : hasPerp === true
        ? 'No Crossed-Book Edge'
        : hasPerp === false
          ? 'Spot Only'
          : 'Market Presence UNKNOWN';
  const fundingPosture = hasPerp === null
    ? 'Market Presence UNKNOWN'
    : hasPerp === false
      ? 'Spot Only'
      : live?.fundingRate === null || live?.fundingRate === undefined
        ? 'Funding UNKNOWN'
        : live.fundingRate > 0
          ? 'Longs Pay'
          : live.fundingRate < 0
            ? 'Shorts Pay'
            : 'Flat Funding';
  return (
    <div className="container page tkx-page">
      <section className="tkx-frame" aria-label="token workspace">
        <header className="tkx-toolbar">
          <div className="tkx-identity">
            <TokenIcon symbol={symbol} size={34} />
            <span>
              <h1>{name}</h1>
              <small>{base}/USDT</small>
            </span>
            <em>Binance</em>
          </div>
          <div className="tkx-tools">
          <span className="tdx-searchwrap">
            <label className="tkx-search">
              <Search size={14} aria-hidden="true" />
              <input aria-label="Search Token" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
              {q ? <button type="button" aria-label="Clear Search" onClick={() => setQ('')}><X size={14} /></button> : null}
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
            <button
              type="button"
              className={'tkx-icon-button' + (watchlisted ? ' active' : '')}
              aria-label={watchlisted ? 'Remove from watchlist' : 'Add to watchlist'}
              title={watchError ?? (watchlisted ? 'Remove from watchlist' : 'Add to watchlist')}
              disabled={watchBusy}
              onClick={() => void toggleCurrentWatch()}
            >
              <StarIcon size={16} fill={watchlisted ? 'currentColor' : 'none'} />
            </button>
            {profile?.homepage ? <a className="tkx-icon-button" href={profile.homepage} target="_blank" rel="noreferrer noopener" aria-label="Official Website" title="Official Website"><Globe2 size={16} /></a> : null}
            {profile?.whitepaper ? <a className="tkx-icon-button" href={profile.whitepaper} target="_blank" rel="noreferrer noopener" aria-label="Whitepaper" title="Whitepaper"><FileText size={16} /></a> : null}
            <button type="button" className="tkx-markets" onClick={() => setPage('markets')}><Grid2X2 size={14} />All Markets</button>
          </div>
        </header>

        <div className="tkx-summary" aria-label="Token Summary">
          <div>
            <span>Spot Price</span>
            <strong>{tokenMarketCurrent ? fmtPrice(price) : 'UNKNOWN'}</strong>
            <small>{tokenMarketCurrent
              ? <><Chg pct={live?.change24hPct}>{live?.change24hPct === null || live?.change24hPct === undefined ? '—' : fmtPct(Math.abs(live.change24hPct), 2, false)}</Chg> · {fmtMoney(live?.quoteVolume24h)} 24h</>
              : marketPresence === 'UNKNOWN' && marketCurrent ? 'Market Presence UNKNOWN' : marketStateLabel}</small>
          </div>
          <div>
            <span>Executable Gap</span>
            <strong>{tokenMarketCurrent ? fmtBasis(live?.executableBasisBestPct) : 'UNKNOWN'}</strong>
            <small>
              {executableDirection}
              {basisCurrent && basisContext && (basisContext.direction === 'long_spot_short_perp' || basisContext.borrow.status === 'available') && basisContext.netEdgePct !== null
                ? ' · Net ' + fmtBasis(basisContext.netEdgePct)
                : basisCurrent && basisContext?.borrow.status === 'unknown'
                  ? ' · Borrow Cost Unknown'
                  : hasPerp === true && !basisCurrent
                    ? ` · Basis ${basisReason ?? 'NOT CURRENT'}`
                  : ''}
            </small>
          </div>
          <div>
            <span>Funding</span>
            <strong>{hasPerp === true ? fmtFunding(live?.fundingRate) : hasPerp === false ? 'Spot Only' : 'UNKNOWN'}</strong>
            <small>{fundingPosture}{hasPerp === true && live?.nextFundingTime ? ' · ' + countdown(live.nextFundingTime) : ''}</small>
          </div>
          <div>
            <span>Open Interest</span>
            <strong>{hasPerp === true && intelligence?.openInterest.state === 'FRESH' ? fmtMoney(intelligence.openInterest.value?.quoteUsd) : hasPerp === false ? 'Spot Only' : 'UNKNOWN'}</strong>
            <small>{hasPerp === true
              ? <><Chg pct={intelligence?.openInterest.state === 'FRESH' ? intelligence.openInterest.value?.changePct : null}>{intelligence?.openInterest.state === 'FRESH' && intelligence.openInterest.value?.changePct !== null && intelligence.openInterest.value?.changePct !== undefined ? fmtPct(Math.abs(intelligence.openInterest.value.changePct), 2, false) : 'UNKNOWN'}</Chg> · {intelligence?.openInterest.state ?? 'UNAVAILABLE'} · {intelligence?.liquidation.state ?? 'UNAVAILABLE'} Liq</>
              : hasPerp === false ? 'No derivatives telemetry' : 'Market Presence UNKNOWN'}</small>
          </div>
        </div>

        <ProductSurfaceAdapter surfaceId="token" />

        <TokenEvidenceWorkspace
          symbol={symbol}
          base={base}
          intelligence={intelligence}
          intelligenceError={intelligenceError}
          privateRead={privateRead}
          privateReadGuard={privateReadGuard}
          privateReadSource={privateReadSource}
          news={newsContext}
          newsError={newsContextError}
          marketCurrent={tokenMarketCurrent}
        />

        <div className="tkx-workspace">
          <section className="tdx-cell tdx-chartcell tkx-chartview">
          <div className="tdx-price-row">
            <div className="tkx-range-result">
              <span>{ivl === 'auto' ? range : INTERVAL_LABEL[ivl]} Change</span>
              <strong>{rangeAbs !== null ? fmtPrice(Math.abs(rangeAbs)) : '—'}</strong>
              <Chg pct={rangePct}>{rangePct === null ? '—' : fmtPct(Math.abs(rangePct), 2, false)}</Chg>
            </div>
            <div className="tdx-controls">
              <div className="tdx-ranges" role="tablist" aria-label="Chart range">
                {RANGE_KEYS.map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={ivl === 'auto' && range === k} className={ivl === 'auto' && range === k ? 'on' : ''} disabled={src === 'futures' && k === '1S'} title={src === 'futures' && k === '1S' ? 'Spot-Only Granularity' : undefined} onClick={() => { setRange(k); setIvl('auto'); }}>
                    {k}
                  </button>
                ))}
              </div>
              {hasPerp === true && (
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
            <TradingViewWidget symbol={tvSymbol} win={tvInterval} clockZone={prefs.clockZone} height={390} />
          ) : (
            <div className="tdx-line-frame">
              <PriceChart points={points} up={up} clockZone={prefs.clockZone} />
              {candleError ? <p className="tdx-updated" role="status">{candles.length ? 'Candle refresh unavailable · showing the last verified series.' : candleError}</p> : null}
            </div>
          )}
          </section>
          <div className="tkx-flow-deck" aria-label="Market flow">
            <MoneyFlowCard symbol={symbol} base={base} />
            <PositioningCard symbol={symbol} base={base} hasPerp={hasPerp} />
          </div>
          <DerivativesIntelligence symbol={symbol} base={base} name={name} hasPerp={hasPerp} market={live} openInterest={tokenMarketCurrent ? intelligence?.openInterest ?? null : null} clockZone={prefs.clockZone} />
        </div>
      </section>
      {chartFocus && (
        <div className="tdx-chart-modal" role="dialog" aria-modal="true" aria-label={`${base} Full Chart`}>
          <div className="tdx-chart-modal-head">
            <span>
              <TokenIcon symbol={symbol} size={28} />
              <b>{base} TradingView Workspace</b>
              <em>{src === 'futures' && hasPerp === true ? 'Binance USD-M Perpetual' : 'Binance Spot'} · {INTERVAL_LABEL[(effective.interval as IntervalKey)] ?? effective.interval}</em>
            </span>
            <button type="button" aria-label="Close Full Chart" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setChartFocus(false); }}><IconClose size={17} /></button>
          </div>
          <TradingViewWidget symbol={tvSymbol} win={tvInterval} clockZone={prefs.clockZone} height={Math.round(window.innerHeight * 0.78)} />
        </div>
      )}
    </div>
  );
}

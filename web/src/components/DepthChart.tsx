import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson } from '../lib/http';
import { normalizeBook, type BookLevel } from '../lib/marketData';
import { createSettledPoll } from '../lib/polling';
import { subscribeLiveBook } from '../store';

type Level = BookLevel;

const LIVE_STALE_MS = 6_000;

function fmtPriceAxis(v: number): string {
  const a = Math.abs(v);
  const dec = a >= 1000 ? 2 : a >= 1 ? 4 : 6;
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtCompact(v: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
}

function pct(n: number): string {
  return `${Math.max(0, Math.min(100, n)).toFixed(0)}%`;
}

export function DepthChart({ symbol, base, height = 520 }: { symbol: string; base: string; height?: number }) {
  const [book, setBook] = useState<{ bids: Level[]; asks: Level[] } | null>(null);
  const [tick, setTick] = useState(0);
  const liveTsRef = useRef(0);
  const pendingBookRef = useRef<{ bids: Level[]; asks: Level[] } | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    liveTsRef.current = 0;
    setBook(null);
    const poll = createSettledPoll<unknown | null>({
      intervalMs: 10_000,
      request: (signal) => Date.now() - liveTsRef.current < LIVE_STALE_MS
        ? Promise.resolve(null)
        : fetchJson(`/api/market/depth?symbol=${symbol}`, { signal }),
      onSuccess: (payload) => {
        if (!payload || Date.now() - liveTsRef.current < LIVE_STALE_MS) return;
        const next = normalizeBook(payload);
        if (next) setBook(next);
      },
    });
    poll.start();
    const clock = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => {
      poll.stop();
      clearInterval(clock);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [symbol]);

  useEffect(
    () =>
      subscribeLiveBook(symbol, (m) => {
        if (m.symbol !== symbol || m.type !== 'book') return;
        const next = normalizeBook({ bids: m.bids, asks: m.asks });
        if (!next) return;
        liveTsRef.current = Date.now();
        pendingBookRef.current = next;
        if (rafRef.current !== null) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          if (pendingBookRef.current) setBook(pendingBookRef.current);
        });
      }),
    [symbol]
  );

  const live = Date.now() - liveTsRef.current < LIVE_STALE_MS || tick < 0;

  const model = useMemo(() => {
    const bids = (book?.bids ?? []).filter(([, q]) => q > 0).slice(0, 20);
    const asks = (book?.asks ?? []).filter(([, q]) => q > 0).slice(0, 20);
    if (!bids.length || !asks.length) return null;

    let cum = 0;
    const bidRows = bids.map(([p, q]) => ({ p, q, cum: (cum += q), notional: p * q }));
    const bidCum = cum;
    cum = 0;
    const askRows = asks.map(([p, q]) => ({ p, q, cum: (cum += q), notional: p * q }));
    const askCum = cum;
    const bidNotional = bids.reduce((s, [p, q]) => s + p * q, 0);
    const askNotional = asks.reduce((s, [p, q]) => s + p * q, 0);
    const bestBid = bids[0][0];
    const bestAsk = asks[0][0];
    const minPx = Math.min(...bids.map(([p]) => p));
    const maxPx = Math.max(...asks.map(([p]) => p));
    const maxCum = Math.max(bidCum, askCum, 1e-12);
    const bidShare = bidNotional + askNotional > 0 ? (bidNotional / (bidNotional + askNotional)) * 100 : 50;
    return {
      bidRows,
      askRows,
      bestBid,
      bestAsk,
      mid: (bestBid + bestAsk) / 2,
      spread: bestAsk - bestBid,
      minPx,
      maxPx,
      maxCum,
      bidNotional,
      askNotional,
      bidShare,
    };
  }, [book]);

  const view = useMemo(() => {
    if (!model) return null;
    const w = 1000;
    const h = height;
    const padT = 24;
    const padB = 34;
    const priceSpan = Math.max(model.maxPx - model.minPx, 1e-12);
    const chartH = h - padT - padB;
    const x = (p: number) => ((p - model.minPx) / priceSpan) * w;
    const y = (v: number) => padT + chartH - (v / model.maxCum) * chartH;
    const baseY = padT + chartH;
    const bidPts = [...model.bidRows].reverse().map((r) => [x(r.p), y(r.cum)] as const);
    const askPts = model.askRows.map((r) => [x(r.p), y(r.cum)] as const);
    const line = (pts: readonly (readonly [number, number])[]) => pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`).join(' ');
    const area = (pts: readonly (readonly [number, number])[]) => {
      if (!pts.length) return '';
      const first = pts[0];
      const last = pts[pts.length - 1];
      return `M ${first[0].toFixed(2)} ${baseY.toFixed(2)} ${line(pts).replace(/^M/, 'L')} L ${last[0].toFixed(2)} ${baseY.toFixed(2)} Z`;
    };
    return {
      w,
      h,
      baseY,
      bidLine: line(bidPts),
      askLine: line(askPts),
      bidArea: area(bidPts),
      askArea: area(askPts),
      midX: x(model.mid),
      labels: [
        model.minPx,
        model.bestBid,
        model.mid,
        model.bestAsk,
        model.maxPx,
      ].map((p) => ({ p, x: x(p) })),
      yLabels: [0.25, 0.5, 0.75, 1].map((m) => ({ y: y(model.maxCum * m), v: model.maxCum * m })),
    };
  }, [model, height]);

  if (!model || !view) {
    return (
      <div className="depth-chart-wrap" style={{ height }}>
        <div className="depth-empty">Waiting for Binance depth…</div>
      </div>
    );
  }

  return (
    <div className="depth-chart-wrap" style={{ height }}>
      <div className="depth-stat-strip">
        <span>
          <b>Bid wall</b>
          <em className="num">{fmtCompact(model.bidNotional)}</em>
        </span>
        <span>
          <b>Spread</b>
          <em className="num">{fmtPriceAxis(model.spread)}</em>
        </span>
        <span>
          <b>Ask wall</b>
          <em className="num">{fmtCompact(model.askNotional)}</em>
        </span>
        <span className={`chart-stream-state ${live ? 'on' : ''}`}>
          <span />
          {live ? 'live depth' : 'REST fallback'}
        </span>
      </div>
      <svg className="depth-svg" viewBox={`0 0 ${view.w} ${view.h}`} preserveAspectRatio="none" role="img" aria-label={`${symbol} ${live ? 'live' : 'REST fallback'} depth chart`}>
        <defs>
          <linearGradient id={`bidDepth-${symbol}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--up)" stopOpacity=".24" />
            <stop offset="100%" stopColor="var(--up)" stopOpacity=".06" />
          </linearGradient>
          <linearGradient id={`askDepth-${symbol}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--down)" stopOpacity=".06" />
            <stop offset="100%" stopColor="var(--down)" stopOpacity=".24" />
          </linearGradient>
        </defs>
        {view.yLabels.map((l) => (
          <g key={l.y}>
            <line x1="0" x2={view.w} y1={l.y} y2={l.y} className="depth-grid" />
            <text x={view.w - 8} y={l.y - 5} className="depth-y num" textAnchor="end">
              {fmtCompact(l.v)} {base}
            </text>
          </g>
        ))}
        <line x1={view.midX} x2={view.midX} y1="20" y2={view.baseY} className="depth-mid-line" />
        <path d={view.bidArea} className="depth-area bid" fill={`url(#bidDepth-${symbol})`} />
        <path d={view.askArea} className="depth-area ask" fill={`url(#askDepth-${symbol})`} />
        <path d={view.bidLine} className="depth-line bid" />
        <path d={view.askLine} className="depth-line ask" />
        {view.labels.map((l, i) => (
          <text key={`${i}-${l.p}`} x={l.x} y={view.h - 10} className="depth-x num" textAnchor={i === 0 ? 'start' : i === view.labels.length - 1 ? 'end' : 'middle'}>
            {fmtPriceAxis(l.p)}
          </text>
        ))}
      </svg>
      <div className="depth-ratio">
        <span className="num up">{pct(model.bidShare)} bid</span>
        <span className="depth-ratio-track">
          <span style={{ width: pct(model.bidShare) }} />
        </span>
        <span className="num down">{pct(100 - model.bidShare)} ask</span>
      </div>
    </div>
  );
}

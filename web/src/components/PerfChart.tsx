import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * PerfChart — the control room's performance centerpiece.
 * TradingView-tester style: cumulative realized PnL as a line + soft area,
 * daily realized bars sharing the same x-axis beneath, dashed zero line,
 * horizontal gridlines with right-side labels. Pure SVG, theme-aware
 * (colors come from CSS variables), no animation (safe under :root zoom).
 * Renders only from real ledger days — the caller guards the empty case.
 */

export interface PerfDay {
  day: string; // YYYY-MM-DD
  usd: number;
}

function compact(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
  if (a >= 1) return `${sign}${a.toFixed(a >= 100 ? 0 : 2)}`;
  return `${sign}${a.toFixed(2)}`;
}

/** "nice" step for ~n gridlines across a range */
function niceStep(range: number, n: number): number {
  const raw = range / Math.max(1, n);
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const norm = raw / mag;
  const step = norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1;
  return step * mag;
}

function useChartWidth(fallback: number) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const update = () => {
      const next = Math.max(320, Math.round(el.getBoundingClientRect().width || fallback));
      setWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    };

    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [fallback]);

  return [ref, width] as const;
}

export function PerfChart({
  days,
  height = 260,
  mode = 'usd',
  base = null,
  bench = null,
}: {
  days: PerfDay[];
  height?: number;
  /** 'usd' = cumulative line + daily bars; 'pct' = % lines (strategy vs benchmark) */
  mode?: 'usd' | 'pct';
  /** starting equity — required for pct mode */
  base?: number | null;
  /** aligned benchmark cumulative % per day (real closes, e.g. BTC buy & hold) */
  bench?: number[] | null;
}) {
  const [svgRef, W] = useChartWidth(760);
  const H = height;
  const AXIS_W = 56;
  const PAD_T = 10;
  const BARS_H = Math.round(H * 0.24);
  const GAP = 14;
  const LINE_H = H - BARS_H - GAP - PAD_T - 18; // 18 = x labels
  const plotW = W - AXIS_W;

  const pctMode = mode === 'pct' && base !== null && base > 0;
  const model = useMemo(() => {
    let run = 0;
    const cumUsd = days.map((d) => {
      run += d.usd;
      return run;
    });
    const cum = pctMode ? cumUsd.map((v) => (v / (base as number)) * 100) : cumUsd;
    const benchVals = pctMode && bench ? bench.slice(0, days.length) : [];
    const lo = Math.min(0, ...cum, ...benchVals);
    const hi = Math.max(0, ...cum, ...benchVals);
    const cumMin = lo;
    const cumMax = hi;
    const range = Math.max(1e-9, cumMax - cumMin);
    const step = niceStep(range, 4);
    const gridStart = Math.ceil(cumMin / step) * step;
    const grid: number[] = [];
    for (let v = gridStart; v <= cumMax + 1e-9; v += step) grid.push(v);

    const maxAbsBar = Math.max(1e-9, ...days.map((d) => Math.abs(d.usd)));
    return { cum, benchVals, cumMin, cumMax, range, grid, maxAbsBar };
  }, [base, bench, days, pctMode]);

  const n = days.length;
  const x = (i: number) => (n <= 1 ? plotW / 2 : (i / (n - 1)) * (plotW - 12) + 6);
  const yLine = (v: number) => PAD_T + LINE_H - ((v - model.cumMin) / model.range) * LINE_H;
  const barsTop = PAD_T + LINE_H + GAP;
  const yBar = (v: number) => (Math.abs(v) / model.maxAbsBar) * (BARS_H / 2 - 2);

  const linePath = days.map((_, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yLine(model.cum[i]).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${x(n - 1).toFixed(1)},${yLine(Math.min(0, model.cumMin) >= model.cumMin ? Math.max(model.cumMin, 0) : 0).toFixed(1)} L${x(0).toFixed(1)},${yLine(Math.max(model.cumMin, 0)).toFixed(1)} Z`;
  const zeroBarY = barsTop + BARS_H / 2;
  const barW = Math.max(3, Math.min(18, (plotW / Math.max(1, n)) * 0.55));

  // x labels: first, ~quarters, last
  const labelIdx = new Set<number>([0, Math.floor((n - 1) * 0.33), Math.floor((n - 1) * 0.66), n - 1]);
  const final = model.cum[n - 1] ?? 0;

  return (
    <svg ref={svgRef} className="perf-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative realized PnL and daily results">
      {/* gridlines + right axis labels */}
      {model.grid.map((v) => (
        <g key={v}>
          <line className="pc-grid" x1={0} x2={plotW} y1={yLine(v)} y2={yLine(v)} />
          <text className="pc-axis" x={plotW + 8} y={yLine(v) + 3}>{pctMode ? `${compact(v)}%` : compact(v)}</text>
        </g>
      ))}
      {/* zero line for the cumulative plot (dashed, like TV) */}
      <line className="pc-zero" x1={0} x2={plotW} y1={yLine(0)} y2={yLine(0)} />

      {/* cumulative area + line */}
      <path className={`pc-area ${final >= 0 ? 'pos' : 'neg'}`} d={areaPath} />
      <path className={`pc-line ${final >= 0 ? 'pos' : 'neg'}`} d={linePath} />
      {/* end dot + last value chip */}
      <circle className={`pc-dot ${final >= 0 ? 'pos' : 'neg'}`} cx={x(n - 1)} cy={yLine(final)} r={2.2} />

      {/* benchmark (real buy & hold closes) in pct mode */}
      {pctMode && model.benchVals.length > 1 && (
        <path
          className="pc-bench"
          d={model.benchVals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yLine(v).toFixed(1)}`).join(' ')}
        />
      )}

      {/* daily bars (usd mode only) */}
      {!pctMode && <line className="pc-grid" x1={0} x2={plotW} y1={zeroBarY} y2={zeroBarY} />}
      {!pctMode && days.map((d, i) => {
        const h = yBar(d.usd);
        const up = d.usd >= 0;
        return (
          <rect
            key={d.day}
            className={`pc-bar ${up ? 'pos' : 'neg'}`}
            x={x(i) - barW / 2}
            y={up ? zeroBarY - h : zeroBarY}
            width={barW}
            height={Math.max(1, h)}
          >
            <title>{d.day}: {d.usd >= 0 ? '+' : ''}{d.usd.toFixed(2)} USD</title>
          </rect>
        );
      })}

      {/* x labels */}
      {days.map((d, i) =>
        labelIdx.has(i) ? (
          <text key={`l-${d.day}`} className="pc-axis" x={x(i)} y={H - 4} textAnchor="middle">
            {d.day.slice(5)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** Histogram of daily returns, TradingView "returns distribution" style. */
export function DistChart({ days, buckets = 9, height = 150 }: { days: PerfDay[]; buckets?: number; height?: number }) {
  const [svgRef, W] = useChartWidth(320);
  const H = height;
  const model = useMemo(() => {
    if (!days.length) return null;
    const vals = days.map((d) => d.usd);
    const min = Math.min(...vals, 0);
    const max = Math.max(...vals, 0);
    const span = Math.max(1e-9, max - min);
    const size = span / buckets;
    const counts = new Array(buckets).fill(0) as number[];
    const centers = new Array(buckets).fill(0).map((_, i) => min + size * (i + 0.5));
    for (const v of vals) {
      const idx = Math.min(buckets - 1, Math.max(0, Math.floor((v - min) / size)));
      counts[idx] += 1;
    }
    return { counts, centers, maxCount: Math.max(...counts, 1) };
  }, [buckets, days]);

  if (!model) return null;
  const plotH = H - 22;
  const bw = (W / buckets) * 0.66;
  return (
    <svg ref={svgRef} className="perf-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily returns distribution">
      <line className="pc-grid" x1={0} x2={W} y1={plotH} y2={plotH} />
      {model.counts.map((c, i) => {
        const cx = (i + 0.5) * (W / buckets);
        const h = (c / model.maxCount) * (plotH - 10);
        const pos = model.centers[i] >= 0;
        return (
          <g key={i}>
            <rect className={`pc-bar ${pos ? 'pos' : 'neg'}`} x={cx - bw / 2} y={plotH - h} width={bw} height={Math.max(c ? 2 : 0, h)}>
              <title>{c} day{c === 1 ? '' : 's'} around {compact(model.centers[i])} USD</title>
            </rect>
            {(i === 0 || i === buckets - 1 || i === Math.floor(buckets / 2)) && (
              <text className="pc-axis" x={cx} y={H - 6} textAnchor="middle">{compact(model.centers[i])}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Live equity curve from real account snapshots — time-based x-axis, soft
 *  area, and a TradingView-style last-value chip pinned to the right axis.
 *  This is the hero chart while realized-PnL history is still short. */
export function EquityChart({ snaps, height = 240 }: { snaps: { ts: number; totalUsdt: number }[]; height?: number }) {
  const [svgRef, W] = useChartWidth(760);
  const H = height;
  const AXIS_W = 74;
  const PAD_T = 12;
  const PAD_B = 20;
  const plotW = W - AXIS_W;
  const plotH = H - PAD_T - PAD_B;

  const model = useMemo(() => {
    const vals = snaps.map((s) => s.totalUsdt);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.15, hi * 0.0004, 1e-9);
    const min = lo - pad;
    const max = hi + pad;
    const range = Math.max(1e-9, max - min);
    const step = niceStep(range, 4);
    const grid: number[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) grid.push(v);
    const t0 = snaps[0].ts;
    const t1 = snaps[snaps.length - 1].ts;
    return { min, max, range, grid, t0, span: Math.max(1, t1 - t0) };
  }, [snaps]);

  const x = (ts: number) => ((ts - model.t0) / model.span) * (plotW - 10) + 4;
  const y = (v: number) => PAD_T + plotH - ((v - model.min) / model.range) * plotH;
  const line = snaps.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.ts).toFixed(1)},${y(s.totalUsdt).toFixed(1)}`).join(' ');
  const area = `${line} L${x(snaps[snaps.length - 1].ts).toFixed(1)},${PAD_T + plotH} L${x(snaps[0].ts).toFixed(1)},${PAD_T + plotH} Z`;
  const last = snaps[snaps.length - 1].totalUsdt;
  const first = snaps[0].totalUsdt;
  const pos = last >= first;
  const lastY = Math.max(PAD_T + 8, Math.min(PAD_T + plotH - 8, y(last)));

  const fmtT = (ts: number) => {
    const d = new Date(ts);
    return model.span > 36 * 3600e3
      ? d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
      : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };
  const tIdx = [0, Math.floor((snaps.length - 1) / 2), snaps.length - 1];

  return (
    <svg ref={svgRef} className="perf-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Account equity curve">
      {model.grid.map((v) => (
        <g key={v}>
          <line className="pc-grid" x1={0} x2={plotW} y1={y(v)} y2={y(v)} />
          <text className="pc-axis" x={plotW + 8} y={y(v) + 3}>{compact(v)}</text>
        </g>
      ))}
      <path className={`pc-area ${pos ? 'pos' : 'neg'}`} d={area} style={{ opacity: 0.12 }} />
      <path className={`pc-line ${pos ? 'pos' : 'neg'}`} d={line} />
      <circle className={`pc-dot ${pos ? 'pos' : 'neg'}`} cx={x(snaps[snaps.length - 1].ts)} cy={y(last)} r={2.1} />
      {/* last-value chip pinned to the axis, TradingView style */}
      <g>
        <rect className={`pc-chip-bg ${pos ? 'pos' : 'neg'}`} x={plotW + 2} y={lastY - 9} width={AXIS_W - 4} height={18} rx={4} />
        <text className="pc-chip-text" x={plotW + AXIS_W / 2} y={lastY + 3.5} textAnchor="middle">
          {last.toLocaleString('en-US', { maximumFractionDigits: 2 })}
        </text>
      </g>
      {tIdx.map((i, k) => (
        <text key={i} className="pc-axis" x={x(snaps[i].ts)} y={H - 4} textAnchor={k === 0 ? 'start' : k === tIdx.length - 1 ? 'end' : 'middle'}>
          {fmtT(snaps[i].ts)}
        </text>
      ))}
    </svg>
  );
}

/** Binance lead-trader style win/lose split bar. */
export function WinLoseBar({ win, lose, winLabel = 'Win', loseLabel = 'Lose' }: { win: number; lose: number; winLabel?: string; loseLabel?: string }) {
  const total = Math.max(1, win + lose);
  return (
    <div className="wl-bar">
      <div className="wl-bar-labels">
        <span className="w">{winLabel} {win}</span>
        <span className="l">{loseLabel} {lose}</span>
      </div>
      <div className="wl-bar-track">
        <span className="w" style={{ width: `${(win / total) * 100}%` }} />
        <span className="l" style={{ width: `${(lose / total) * 100}%` }} />
      </div>
    </div>
  );
}

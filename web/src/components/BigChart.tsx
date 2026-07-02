import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { fmtPrice, fmtTimeShort, fmtDateTime } from '../format';

export interface ChartPoint {
  t: number;
  v: number;
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(v);
  return ticks;
}

/**
 * Hand-built SVG financial chart (ported from Signal Lab's chart.js): crisp
 * line + gradient underlay + Coinbase-style dotted fade texture, right value
 * axis, time axis, crosshair tooltip, draw-in animation on data change.
 */
export function BigChart({
  data,
  height = 360,
  color,
  valueFmt = fmtPrice,
  animateKey,
}: {
  data: ChartPoint[];
  height?: number;
  color?: string;
  valueFmt?: (v: number) => string;
  animateKey?: string;
}) {
  const gid = useId().replace(/[:]/g, '');
  const wrapRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // draw-in on data window change
  useEffect(() => {
    const line = lineRef.current;
    if (!line || data.length < 2) return;
    try {
      const L = line.getTotalLength();
      line.style.transition = 'none';
      line.style.strokeDasharray = String(L);
      line.style.strokeDashoffset = String(L);
      void line.getBoundingClientRect();
      line.style.transition = 'stroke-dashoffset .85s cubic-bezier(.3,.6,.2,1)';
      requestAnimationFrame(() => {
        line.style.strokeDashoffset = '0';
      });
    } catch {
      // non-fatal
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateKey, width > 0]);

  const geom = useMemo(() => {
    if (!data || data.length < 2 || width < 60) return null;
    const padR = 62;
    const padL = 6;
    const padT = 16;
    const padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const values = data.map((d) => d.v);
    let vmin = Math.min(...values);
    let vmax = Math.max(...values);
    const padV = (vmax - vmin || Math.abs(vmax) || 1) * 0.1;
    vmin -= padV;
    vmax += padV;
    const t0 = data[0].t;
    const t1 = data[data.length - 1].t;
    const tSpan = t1 - t0 || 1;
    const x = (t: number) => padL + ((t - t0) / tSpan) * plotW;
    const y = (v: number) => padT + (1 - (v - vmin) / (vmax - vmin || 1)) * plotH;
    const pts = data.map((d) => ({ x: x(d.t), y: y(d.v) }));
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
    const baseY = padT + plotH;
    const area = `${line} L${pts[pts.length - 1].x.toFixed(1)} ${baseY} L${pts[0].x.toFixed(1)} ${baseY} Z`;
    const ticks = niceTicks(vmin + padV * 0.5, vmax - padV * 0.5, 4).filter(
      (tv) => y(tv) >= padT - 1 && y(tv) <= padT + plotH + 1
    );
    const up = values[values.length - 1] >= values[0];
    return { padL, padR, padT, padB, plotW, plotH, x, y, pts, line, area, ticks, baseY, up, t0, tSpan };
  }, [data, width, height]);

  if (!geom) {
    return (
      <div ref={wrapRef} className="chart-body">
        <div className="chart-empty" style={{ height }}>
          {data.length < 2 ? 'Not enough history in this window yet.' : 'Measuring…'}
        </div>
      </div>
    );
  }

  const stroke = color ?? (geom.up ? 'var(--up)' : 'var(--down)');
  const hoverPt = hover !== null && data[hover] ? { p: geom.pts[hover], d: data[hover] } : null;

  const onMove = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const tx = geom.t0 + ((px - geom.padL) / geom.plotW) * geom.tSpan;
    let best = 0;
    let bestd = Infinity;
    for (let i = 0; i < data.length; i++) {
      const dd = Math.abs(data[i].t - tx);
      if (dd < bestd) {
        bestd = dd;
        best = i;
      }
    }
    setHover(best);
  };

  const nT = Math.min(5, data.length);
  const xLabels = Array.from({ length: nT }, (_, i) => {
    const idx = Math.round((i / (nT - 1 || 1)) * (data.length - 1));
    return { idx, label: fmtTimeShort(data[idx].t), x: geom.x(data[idx].t) };
  });

  return (
    <div ref={wrapRef} className="chart-body" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg className="chart-svg" width={width} height={height}>
        <defs>
          <linearGradient id={`${gid}g`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={stroke} stopOpacity="0.1" />
            <stop offset="1" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
          <pattern id={`${gid}d`} width="7" height="7" patternUnits="userSpaceOnUse">
            <circle cx="1.7" cy="1.7" r="1.15" fill={stroke} />
          </pattern>
          <linearGradient id={`${gid}fm`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
            <stop offset="0.85" stopColor="#fff" stopOpacity="0.06" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={`${gid}m`}>
            <rect x="0" y="0" width={width} height={height} fill={`url(#${gid}fm)`} />
          </mask>
        </defs>

        {geom.ticks.map((tv) => (
          <g key={tv}>
            <line x1={geom.padL} x2={geom.padL + geom.plotW} y1={geom.y(tv)} y2={geom.y(tv)} stroke="var(--line)" strokeWidth={1} />
            <text x={geom.padL + geom.plotW + 10} y={geom.y(tv) + 3.5} fill="var(--muted)" fontSize={11}>
              {valueFmt(tv)}
            </text>
          </g>
        ))}
        {xLabels.map(({ idx, label, x }, i) => (
          <text
            key={idx}
            x={x}
            y={height - 7}
            fill="var(--faint)"
            fontSize={11}
            textAnchor={i === 0 ? 'start' : i === nT - 1 ? 'end' : 'middle'}
          >
            {label}
          </text>
        ))}

        <path d={geom.area} fill={`url(#${gid}g)`} />
        <path d={geom.area} fill={`url(#${gid}d)`} mask={`url(#${gid}m)`} className="chart-anim-area" />
        <path ref={lineRef} d={geom.line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={geom.pts[geom.pts.length - 1].x} cy={geom.pts[geom.pts.length - 1].y} r={4} fill={stroke} stroke="var(--bg)" strokeWidth={2} />

        {hoverPt && (
          <g>
            <line x1={hoverPt.p.x} x2={hoverPt.p.x} y1={geom.padT} y2={geom.baseY} stroke="var(--line-strong)" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={hoverPt.p.x} cy={hoverPt.p.y} r={4.5} fill={stroke} stroke="var(--bg)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hoverPt && (
        <div className="chart-tip" style={{ left: hoverPt.p.x, top: hoverPt.p.y, opacity: 1 }}>
          <div className="t-val">{valueFmt(hoverPt.d.v)}</div>
          <div className="t-time">{fmtDateTime(hoverPt.d.t)}</div>
        </div>
      )}
    </div>
  );
}

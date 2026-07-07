import { useEffect, useRef, useState } from 'react';
import { fmtPrice, fmtDateTime } from '../format';

interface KlinePoint {
  t: number;
  v: number;
}

export function AreaChart({ data, height = 300 }: { data: KlinePoint[]; height?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
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

  if (!data || data.length < 2) {
    return (
      <div ref={wrapRef} className="chart-wrap" style={{ height }}>
        <div className="chart-empty">Loading chart…</div>
      </div>
    );
  }

  const padTop = 10;
  const padBottom = 24;
  const padRight = 80;
  const w = Math.max(width - padRight, 10);
  const h = height - padTop - padBottom;

  const values = data.map((d) => d.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const lo = min - span * 0.06;
  const hi = max + span * 0.06;

  const x = (i: number) => (i / (data.length - 1)) * w;
  const y = (v: number) => padTop + (1 - (v - lo) / (hi - lo)) * h;

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(d.v).toFixed(2)}`).join(' ');
  const area = `${line} L${w},${height - padBottom} L0,${height - padBottom} Z`;

  const up = values[values.length - 1] >= values[0];
  const color = up ? 'var(--green)' : 'var(--red)';

  const gridLines = 4;
  const ticks = Array.from({ length: gridLines + 1 }, (_, i) => lo + ((hi - lo) * i) / gridLines);

  const xLabels = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const i = Math.round(f * (data.length - 1));
    return { i, label: fmtDateTime(data[i].t) };
  });

  const hoverPt = hover !== null ? data[hover] : null;

  return (
    <div
      ref={wrapRef}
      className="chart-wrap"
      style={{ height }}
      onMouseMove={(e) => {
        const rect = wrapRef.current!.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const i = Math.round((px / w) * (data.length - 1));
        setHover(Math.min(Math.max(i, 0), data.length - 1));
      }}
      onMouseLeave={() => setHover(null)}
    >
      <svg width={width} height={height}>
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? 'rgba(9,133,81,0.18)' : 'rgba(207,32,47,0.14)'} />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={0} y1={y(t)} x2={w} y2={y(t)} stroke="var(--border)" strokeWidth={1} strokeDasharray="1 4" />
            <text x={w + 8} y={y(t) + 4} className="chart-tick">
              {fmtPrice(t)}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#areaFill)" />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {xLabels.map(({ i, label }) => (
          <text key={i} x={x(i)} y={height - 6} className="chart-tick" textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>
            {label}
          </text>
        ))}
        {hoverPt && (
          <g>
            <line x1={x(hover!)} y1={padTop} x2={x(hover!)} y2={height - padBottom} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x(hover!)} cy={y(hoverPt.v)} r={4} fill={color} stroke="#fff" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hoverPt && (
        <div
          className="chart-tooltip"
          style={{ left: Math.min(x(hover!) + 12, width - 150), top: y(hoverPt.v) - 44 }}
        >
          <div className="chart-tooltip-price">{fmtPrice(hoverPt.v)}</div>
          <div className="chart-tooltip-time">{fmtDateTime(hoverPt.t)}</div>
        </div>
      )}
    </div>
  );
}

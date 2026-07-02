import { useId } from 'react';

/** Compact line sparkline (tables). Fills its sized container. */
export function Sparkline({
  values,
  w = 96,
  h = 30,
  color,
}: {
  values: number[];
  w?: number;
  h?: number;
  color?: string;
}) {
  const vals = (values || []).map(Number).filter(isFinite);
  if (vals.length < 2) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
        <line x1={2} y1={h / 2} x2={w - 2} y2={h / 2} stroke="var(--line-2)" strokeDasharray="3 3" />
      </svg>
    );
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const stepX = w / (vals.length - 1);
  const pad = 2;
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);
  const d = vals.map((v, i) => (i ? 'L' : 'M') + (i * stepX).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const stroke = color ?? (vals[vals.length - 1] >= vals[0] ? 'var(--up)' : 'var(--down)');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Mini area chart (stat tiles / mover cards). `dots` = Coinbase dotted texture. */
export function SparkArea({
  values,
  w = 150,
  h = 48,
  color,
  dots = false,
  endDot = false,
}: {
  values: number[];
  w?: number;
  h?: number;
  color?: string;
  dots?: boolean;
  endDot?: boolean;
}) {
  const gid = useId();
  const vals = (values || []).map(Number).filter(isFinite);
  if (vals.length < 2) {
    return <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }} />;
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const stepX = w / (vals.length - 1);
  const pad = 3;
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);
  const line = vals.map((v, i) => (i ? 'L' : 'M') + (i * stepX).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const stroke = color ?? (vals[vals.length - 1] >= vals[0] ? 'var(--up)' : 'var(--down)');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        {dots ? (
          <pattern id={gid} width="5.5" height="5.5" patternUnits="userSpaceOnUse">
            <circle cx="1.4" cy="1.4" r="1" fill={stroke} opacity=".3" />
          </pattern>
        ) : (
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={stroke} stopOpacity="0.2" />
            <stop offset="1" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        )}
      </defs>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {endDot && (
        <circle cx={((vals.length - 1) * stepX).toFixed(1)} cy={y(vals[vals.length - 1]).toFixed(1)} r={2.4} fill={stroke} />
      )}
    </svg>
  );
}

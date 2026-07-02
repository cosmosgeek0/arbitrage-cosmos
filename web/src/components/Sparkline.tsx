export function Sparkline({
  points,
  width = 110,
  height = 34,
  color,
}: {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (!points || points.length < 2) {
    return (
      <svg width={width} height={height}>
        <line x1={2} y1={height / 2} x2={width - 2} y2={height / 2} stroke="var(--border)" strokeDasharray="3 3" />
      </svg>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 3;
  const step = (width - pad * 2) / (points.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const trend = points[points.length - 1] >= points[0] ? 'var(--green)' : 'var(--red)';
  return (
    <svg width={width} height={height}>
      <path d={d} fill="none" stroke={color ?? trend} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

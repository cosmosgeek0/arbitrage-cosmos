import { brandColor } from './TokenIcon';
import { fmtPrice } from '../format';

export interface Slice {
  label: string;
  value: number;
}

/**
 * Compact allocation donut (Uniswap/Delta pattern) — SVG arcs, brand-colored,
 * with a legend. Small holdings past the top N fold into "Other".
 */
export function Donut({ slices, size = 132, topN = 6 }: { slices: Slice[]; size?: number; topN?: number }) {
  const positive = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const total = positive.reduce((s, x) => s + x.value, 0);
  if (total <= 0) {
    return <div className="muted small">No positive-value holdings to chart.</div>;
  }

  const shown = positive.slice(0, topN);
  const otherVal = positive.slice(topN).reduce((s, x) => s + x.value, 0);
  const parts = otherVal > 0 ? [...shown, { label: 'Other', value: otherVal }] : shown;

  const r = size / 2;
  const stroke = size * 0.16;
  const radius = r - stroke / 2;
  const circ = 2 * Math.PI * radius;
  let offset = 0;

  const colorFor = (label: string) =>
    label === 'Other' ? 'var(--line-strong)' : brandColor(`${label}USDT`);

  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={r} cy={r} r={radius} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {parts.map((p) => {
          const frac = p.value / total;
          const dash = frac * circ;
          const el = (
            <circle
              key={p.label}
              cx={r}
              cy={r}
              r={radius}
              fill="none"
              stroke={colorFor(p.label)}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="donut-legend">
        {parts.map((p) => (
          <div key={p.label} className="donut-leg-row">
            <span className="donut-dot" style={{ background: colorFor(p.label) }} />
            <span className="donut-leg-name">{p.label}</span>
            <span className="donut-leg-pct num">{((p.value / total) * 100).toFixed(1)}%</span>
            <span className="donut-leg-val num muted">{fmtPrice(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

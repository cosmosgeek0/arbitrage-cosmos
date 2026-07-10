import { fmtPrice } from '../format';

export interface Slice {
  label: string;
  value: number;
}

/**
 * Compact wallet-allocation donut with stable account colors and a full legend.
 * Small holdings past the top N fold into "Other".
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

  const walletColors: Record<string, string> = {
    Spot: '#2f6bff',
    Earn: '#159f8c',
    'Cross Margin': '#687892',
    'Isolated Margin': '#5a78d6',
    Funding: '#3c8fbf',
    'USDⓈ-M Futures': '#315bea',
    'COIN-M Futures': '#177e89',
    Options: '#718096',
    'Trading Bots': '#4f6b88',
    'Copy Trading': '#7d8ca3',
    Other: 'var(--line-strong)',
  };
  const colorFor = (label: string) => walletColors[label] ?? '#7d8ca3';

  let cursor = 0;
  const stops = parts.map((part) => {
    const start = cursor;
    cursor += (part.value / total) * 100;
    return `${colorFor(part.label)} ${start.toFixed(4)}% ${cursor.toFixed(4)}%`;
  });
  const allocationLabel = parts.map((part) => `${part.label} ${((part.value / total) * 100).toFixed(1)}%`).join(', ');

  return (
    <div className="donut-wrap">
      <div
        className="donut-chart"
        role="img"
        aria-label={`Wallet allocation: ${allocationLabel}`}
        style={{ width: size, height: size, background: `conic-gradient(from 0deg, ${stops.join(', ')})` }}
      />
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

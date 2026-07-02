import { fmtPct } from '../format';

export function Delta({ value, digits = 2 }: { value: number | null | undefined; digits?: number }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="muted">—</span>;
  }
  const cls = value > 0 ? 'delta pos' : value < 0 ? 'delta neg' : 'delta';
  const arrow = value > 0 ? '↗' : value < 0 ? '↘' : '';
  return (
    <span className={cls}>
      {arrow} {fmtPct(Math.abs(value) === value ? value : value, digits).replace('+', '')}
    </span>
  );
}

import { formatUsd } from './model';
import type { AccountPnlPoint, AccountPnlView } from './types';

const WIDTH = 900;
const HEIGHT = 246;
const LEFT = 12;
const RIGHT = 12;
const TOP = 18;
const BOTTOM = 18;
const MIN_TREND_DAYS = 8;
const UTC_DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

export type AccountPnlTrendState =
  | 'DRAW'
  | 'WITHHELD'
  | 'EMPTY_COMPLETE'
  | 'EMPTY_PARTIAL'
  | 'ZERO_ONLY'
  | 'INSUFFICIENT'
  | 'INVALID_GEOMETRY';

export interface AccountPnlPlotPoint {
  readonly x: number;
  readonly y: number;
  readonly source: Readonly<AccountPnlPoint>;
}

export interface AccountPnlPlotTick {
  readonly value: number;
  readonly y: number;
  readonly isZero: boolean;
}

export interface AccountPnlPlot {
  readonly points: readonly AccountPnlPlotPoint[];
  readonly yTicks: readonly AccountPnlPlotTick[];
}

function utcDayMs(day: string): number {
  const match = UTC_DAY.exec(day);
  if (!match) return Number.NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const time = Date.UTC(year, month - 1, date);
  const parsed = new Date(time);
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === date
    ? time
    : Number.NaN;
}

/** Geometry only. Every plotted value retains the exact row used by the table. */
export function buildAccountPnlPlot(
  rows: readonly Readonly<AccountPnlPoint>[],
): AccountPnlPlot {
  const times = rows.map((row) => utcDayMs(row.day));
  if (rows.length === 0
    || rows.some((row) => !Number.isFinite(row.realizedUsd))
    || times.some((time, index) => !Number.isFinite(time)
      || (index > 0 && time <= times[index - 1]))) {
    return { points: [], yTicks: [] };
  }
  const values = rows.map((row) => row.realizedUsd);
  const observedMin = Math.min(...values);
  const observedMax = Math.max(...values);
  const hasNegative = observedMin < 0;
  const hasPositive = observedMax > 0;
  const mixedSign = hasNegative && hasPositive;
  const rawSpan = observedMax - observedMin;
  const span = rawSpan === 0 ? Math.max(Math.abs(observedMax), 1) : rawSpan;
  const minValue = mixedSign
    ? observedMin - span * 0.12
    : hasNegative ? observedMin - Math.abs(observedMin) * 0.12 : 0;
  const maxValue = mixedSign
    ? observedMax + span * 0.12
    : hasPositive ? observedMax + Math.abs(observedMax) * 0.12
      : hasNegative ? 0 : 1;
  const boundedMin = minValue === maxValue ? -1 : minValue;
  const firstTime = times[0];
  const lastTime = times.at(-1) ?? firstTime;
  const x = (index: number) => rows.length === 1
    ? (LEFT + WIDTH - RIGHT) / 2
    : LEFT + ((times[index] - firstTime) / (lastTime - firstTime)) * (WIDTH - LEFT - RIGHT);
  const y = (value: number) => TOP
    + ((maxValue - value) / (maxValue - boundedMin)) * (HEIGHT - TOP - BOTTOM);
  const tickValues = mixedSign
    ? [maxValue, 0, boundedMin]
    : [maxValue, (maxValue + boundedMin) / 2, boundedMin];
  return {
    points: rows.map((row, index) => ({ x: x(index), y: y(row.realizedUsd), source: row })),
    yTicks: tickValues.map((value) => ({ value, y: y(value), isZero: value === 0 })),
  };
}

export function accountPnlTrendState(
  pnl: Readonly<AccountPnlView>,
  plot: Readonly<AccountPnlPlot> = buildAccountPnlPlot(pnl.points),
): AccountPnlTrendState {
  if (!pnl.publishable) return 'WITHHELD';
  if (pnl.points.length === 0) {
    return pnl.integrityState === 'PARTIAL' ? 'EMPTY_PARTIAL' : 'EMPTY_COMPLETE';
  }
  if (pnl.points.every((point) => point.realizedUsd === 0)) return 'ZERO_ONLY';
  if (pnl.points.length < MIN_TREND_DAYS) return 'INSUFFICIENT';
  return plot.points.length === pnl.points.length ? 'DRAW' : 'INVALID_GEOMETRY';
}

function linePath(points: readonly AccountPnlPlotPoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}

function DataTable({
  rows,
  publishable,
}: {
  rows: readonly Readonly<AccountPnlPoint>[];
  publishable: boolean;
}) {
  return (
    <div
      className="strd-table-scroll"
      tabIndex={0}
      aria-label="Unattributed Account Realized PnL chart data, scrollable"
    >
      <table className="strd-data-table">
        <caption>Unattributed Account Realized PnL chart data in USD by UTC day</caption>
        <thead>
          <tr>
            <th scope="col">UTC Day</th>
            <th scope="col">Realized PnL</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? rows.map((row) => (
            <tr key={row.day}>
              <th scope="row">{row.day}</th>
              <td>{formatUsd(row.realizedUsd, true)}</td>
            </tr>
          )) : (
            <tr>
              <th scope="row">{publishable ? 'No Realized-Day Rows' : 'No Publishable Observations'}</th>
              <td>—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function StrategyPerformanceChart({
  pnl,
}: {
  pnl: Readonly<AccountPnlView>;
}) {
  const plot = buildAccountPnlPlot(pnl.points);
  const trendState = accountPnlTrendState(pnl, plot);
  const chartAvailable = trendState === 'DRAW';
  const emptyTitle = trendState === 'WITHHELD'
    ? `Chart Values Withheld · ${pnl.evidenceLabel}`
    : trendState === 'EMPTY_PARTIAL' || trendState === 'EMPTY_COMPLETE'
      ? `No Realized-Day Rows · ${pnl.evidenceLabel}`
      : trendState === 'ZERO_ONLY'
        ? `Zero-Only Series · ${pnl.evidenceLabel}`
        : trendState === 'INSUFFICIENT'
          ? `Insufficient Trend Evidence · ${pnl.points.length} / ${MIN_TREND_DAYS} UTC Days`
          : `Chart Geometry Unavailable · ${pnl.evidenceLabel}`;
  const emptyCopy = trendState === 'WITHHELD'
    ? pnl.reasonCodes.join(' · ') || 'No publishable /api/pnl daily values are available.'
    : trendState === 'EMPTY_PARTIAL'
      ? 'Partial integrity has no realized-day rows; account realized PnL remains unknown.'
      : trendState === 'EMPTY_COMPLETE'
        ? 'Complete integrity contains no realized-day rows; account realized PnL is $0.00.'
        : trendState === 'ZERO_ONLY'
          ? 'All published daily realized values are exactly $0.00; no trend line is drawn.'
          : trendState === 'INSUFFICIENT'
            ? `At least ${MIN_TREND_DAYS} real UTC-day observations are required for a line; exact rows remain in the table.`
            : 'The published rows cannot be projected into valid UTC-day chart geometry.';

  return (
    <figure
      className="strd-chart-figure"
      aria-labelledby="strd-chart-title"
      aria-describedby="strd-chart-summary"
    >
      <header className="strd-section-head">
        <span>
          <h2 id="strd-chart-title">Unattributed Account Realized PnL</h2>
          <p id="strd-chart-summary">
            Daily account aggregate from the /api/pnl mirror. It is not attributed to Basis or Volume.
          </p>
        </span>
        <span className={`strd-truth ${pnl.tone}`}>{pnl.evidenceLabel}</span>
      </header>

      {chartAvailable ? (
        <div className="strd-chart" aria-hidden="true">
          <div className="strd-chart-y-axis">
            {plot.yTicks.map((tick, index) => (
              <span
                key={`${tick.value}:${index}`}
                className={tick.isZero ? 'zero' : undefined}
                style={{ top: `${(tick.y / HEIGHT) * 100}%` }}
              >
                {formatUsd(tick.value)}
              </span>
            ))}
          </div>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
            {plot.yTicks.map((tick, index) => (
              <line
                key={`${tick.value}:${index}`}
                className={`strd-grid-line${tick.isZero ? ' zero' : ''}`}
                x1={LEFT}
                x2={WIDTH - RIGHT}
                y1={tick.y}
                y2={tick.y}
              />
            ))}
            <path className="strd-series account" d={linePath(plot.points)} vectorEffect="non-scaling-stroke" />
            {plot.points.map((point) => (
              <line
                key={point.source.day}
                className="strd-marker account"
                x1={point.x}
                x2={point.x}
                y1={point.y - 5}
                y2={point.y + 5}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <div className="strd-chart-x-axis">
            <span>{pnl.points[0]?.day ?? 'Day Unknown'}</span>
            <span>{pnl.points.at(-1)?.day ?? 'Day Unknown'}</span>
          </div>
        </div>
      ) : (
        <div className="strd-empty" role="status">
          <strong>{emptyTitle}</strong>
          <span>{emptyCopy}</span>
        </div>
      )}

      <DataTable rows={pnl.points} publishable={pnl.publishable} />
    </figure>
  );
}

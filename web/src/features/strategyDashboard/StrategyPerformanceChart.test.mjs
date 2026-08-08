import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.css')) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent('export default {};')}`,
      };
    }
    return nextResolve(specifier, context);
  },
});

const React = await import('react');
globalThis.React = React;
const { renderToStaticMarkup } = await import('react-dom/server');
const {
  accountPnlTrendState,
  buildAccountPnlPlot,
  projectAccountPnl,
  StrategyPerformanceChart,
} = await import('./index.ts');

const NOW = 1_800_000_000_000;

function completeInput(rows) {
  return {
    state: 'CURRENT',
    source: 'PRODUCTION_OBSERVED',
    observedAtMs: NOW - 1_000,
    maxAgeMs: 60_000,
    reasonCodes: [],
    mirror: {
      realizedByDay: rows,
      realizedBySymbol: [],
      feesByAsset: [],
      equitySnapshots: [],
      integrity: {
        state: 'COMPLETE',
        complete: true,
        reasons: [],
        days: rows.map((row) => ({
          day: row.day,
          complete: true,
          reasons: [],
          feeUsd: 0,
          netUsd: row.usd,
        })),
      },
    },
  };
}

const chartRows = [
  { day: '2026-07-01', usd: 4 },
  { day: '2026-07-02', usd: -2 },
  { day: '2026-07-03', usd: 3 },
  { day: '2026-07-04', usd: 1 },
  { day: '2026-07-08', usd: -1 },
  { day: '2026-07-09', usd: 5 },
  { day: '2026-07-20', usd: 2 },
  { day: '2026-07-30', usd: 6 },
];

test('PnL trend geometry preserves UTC gaps, fails closed, and uses compensated totals', () => {
  const view = projectAccountPnl(completeInput(chartRows), NOW);
  const plot = buildAccountPnlPlot(view.points);

  assert.equal(accountPnlTrendState(view, plot), 'DRAW');
  assert.deepEqual(plot.points.map((point) => point.source), view.points);
  const fullSpan = plot.points.at(-1).x - plot.points[0].x;
  const earlySpan = plot.points[1].x - plot.points[0].x;
  assert.ok(earlySpan / fullSpan < 0.05);
  assert.equal(accountPnlTrendState({ ...view, points: view.points.slice(0, 7) }), 'INSUFFICIENT');
  assert.equal(accountPnlTrendState({
    ...view,
    points: view.points.map((point) => ({ ...point, realizedUsd: 0 })),
  }), 'ZERO_ONLY');

  const descending = [...view.points].reverse();
  const invalidPlot = buildAccountPnlPlot(descending);
  assert.deepEqual(invalidPlot, { points: [], yTicks: [] });
  assert.equal(accountPnlTrendState({ ...view, points: descending }, invalidPlot), 'INVALID_GEOMETRY');

  const cancellation = projectAccountPnl(completeInput([
    { day: '2026-08-01', usd: 1_000_000_000_000 },
    { day: '2026-08-02', usd: 0.01 },
    { day: '2026-08-03', usd: -1_000_000_000_000 },
  ]), NOW);
  assert.equal(cancellation.totalRealizedUsd, 0.01);
});

test('PnL chart exposes exact text rows and suppresses dishonest geometry', () => {
  const view = projectAccountPnl(completeInput(chartRows), NOW);
  const html = renderToStaticMarkup(React.createElement(StrategyPerformanceChart, { pnl: view }));

  assert.match(html, /<div class="strd-chart" aria-hidden="true">/u);
  assert.match(html, /Unattributed Account Realized PnL chart data in USD by UTC day/u);
  assert.match(
    html,
    /class="strd-table-scroll" tabindex="0" aria-label="Unattributed Account Realized PnL chart data, scrollable"/u,
  );
  assert.match(html, /<th scope="col">UTC Day<\/th>/u);
  assert.match(html, /<th scope="col">Realized PnL<\/th>/u);
  assert.match(html, /<th scope="row">2026-07-01<\/th>/u);

  const unavailable = projectAccountPnl({
    state: 'UNAVAILABLE',
    source: 'PRODUCTION_OBSERVED',
    observedAtMs: null,
    maxAgeMs: null,
    reasonCodes: ['PNL_SOURCE_UNAVAILABLE'],
    mirror: null,
  }, NOW);
  const withheldHtml = renderToStaticMarkup(React.createElement(StrategyPerformanceChart, { pnl: unavailable }));
  assert.match(withheldHtml, /<div class="strd-empty" role="status">/u);
  assert.match(withheldHtml, /Chart Values Withheld · UNAVAILABLE/u);
  assert.doesNotMatch(withheldHtml, /<div class="strd-chart" aria-hidden="true">/u);
});

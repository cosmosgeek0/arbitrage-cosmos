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
const { StrategyDashboard } = await import('./StrategyDashboard.tsx');
const { buildStrategyDashboardFixture } = await import('./fixtures.ts');

const NOW = 1_800_000_000_000;

test('rendered dashboard keeps only owned summary, engine-state, and account-series semantics', () => {
  const fixture = buildStrategyDashboardFixture(NOW, 'CURRENT');
  const html = renderToStaticMarkup(React.createElement(StrategyDashboard, {
    runtime: { ...fixture.runtime, source: 'PRODUCTION_OBSERVED' },
    pnl: { ...fixture.pnl, source: 'PRODUCTION_OBSERVED' },
    nowMs: NOW,
  }));
  const summaryStart = html.indexOf('<section class="strd-summary"');
  const summaryEnd = html.indexOf('</section>', summaryStart);
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  const summary = html.slice(summaryStart, summaryEnd);

  assert.equal(summary.match(/class="strd-summary-cell"/gu)?.length, 3);
  assert.match(summary, /Unattributed Account Realized PnL/u);
  assert.match(summary, /Published UTC Days/u);
  assert.match(summary, /Strategy PnL \+ Outcomes/u);
  assert.match(summary, /UNKNOWN/u);
  assert.match(html, /aria-label="Attribution boundary"/u);
  assert.match(html, /id="strd-basis-title">Basis/u);
  assert.match(html, /id="strd-volume-title">Volume/u);
  assert.match(html, /Basis Realized PnL[\s\S]*UNKNOWN/u);
  assert.match(html, /Volume Realized PnL[\s\S]*UNKNOWN/u);
  assert.match(
    html,
    /<figure class="strd-chart-figure" aria-labelledby="strd-chart-title" aria-describedby="strd-chart-summary">/u,
  );
  assert.match(html, /<div class="strd-chart" aria-hidden="true">/u);
  assert.match(html, /Unattributed Account Realized PnL chart data in USD by UTC day/u);
  assert.match(
    html,
    /class="strd-table-scroll" tabindex="0" aria-label="Unattributed Account Realized PnL chart data, scrollable"/u,
  );
  assert.match(html, /<th scope="col">UTC Day<\/th>/u);
  assert.match(html, /<th scope="col">Realized PnL<\/th>/u);
  assert.match(html, /<th scope="row">2026-07-01<\/th>/u);
  assert.doesNotMatch(
    html,
    /Recent Strategy Traces|Execution Claim|>Supervisor Runtime<|SystemSupervisorSnapshot runtime|SOURCE_REVISION/u,
  );
});

test('rendered unavailable account series exposes a named status instead of chart geometry', () => {
  const fixture = buildStrategyDashboardFixture(NOW, 'CURRENT');
  const html = renderToStaticMarkup(React.createElement(StrategyDashboard, {
    runtime: { ...fixture.runtime, source: 'PRODUCTION_OBSERVED' },
    pnl: {
      ...fixture.pnl,
      state: 'UNAVAILABLE',
      source: 'PRODUCTION_OBSERVED',
      observedAtMs: null,
      maxAgeMs: null,
      mirror: null,
    },
    nowMs: NOW,
  }));
  assert.match(html, /<div class="strd-empty" role="status">/u);
  assert.match(html, /Chart Values Withheld · UNAVAILABLE/u);
  assert.doesNotMatch(html, /<div class="strd-chart" aria-hidden="true">/u);
});

test('rendered stale partial empty series names both caveats and never shows a fake zero', () => {
  const fixture = buildStrategyDashboardFixture(NOW, 'CURRENT');
  const mirror = fixture.pnl.mirror;
  assert.ok(mirror);
  const html = renderToStaticMarkup(React.createElement(StrategyDashboard, {
    runtime: { ...fixture.runtime, source: 'PRODUCTION_OBSERVED' },
    pnl: {
      ...fixture.pnl,
      state: 'PARTIAL',
      source: 'SYNTHETIC_ONLY',
      observedAtMs: NOW - 60_001,
      maxAgeMs: 60_000,
      mirror: {
        ...mirror,
        realizedByDay: [],
        integrity: {
          state: 'PARTIAL',
          complete: false,
          reasons: ['FEE_ONLY_DAY_INCOMPLETE'],
          days: [{
            day: '2026-07-22',
            complete: false,
            reasons: ['FEE_ONLY_DAY_INCOMPLETE'],
            feeUsd: 2.5,
            netUsd: -2.5,
          }],
        },
      },
    },
    nowMs: NOW,
  }));
  const figureStart = html.indexOf('<figure class="strd-chart-figure"');
  const figureEnd = html.indexOf('</figure>', figureStart);
  const figure = html.slice(figureStart, figureEnd);
  assert.match(html, /STALE · PARTIAL · SYNTHETIC_ONLY · \/api\/pnl Aggregate/u);
  assert.match(figure, /No Realized-Day Rows · STALE · PARTIAL · SYNTHETIC_ONLY/u);
  assert.match(figure, /Partial integrity has no realized-day rows/u);
  assert.doesNotMatch(figure, /\$0\.00/u);
});

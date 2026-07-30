import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import test from 'node:test';

import { resolveMarketFreshness } from '../../src/store.tsx';

const dashboardSource = await readFile(
  new URL('../../src/pages/Dashboard.tsx', import.meta.url),
  'utf8',
);

const cssLoader = `
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.css')) {
      return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
  export async function load(url, context, nextLoad) {
    if (url.endsWith('.css')) {
      return { format: 'module', source: 'export default {}', shortCircuit: true };
    }
    return nextLoad(url, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(cssLoader)}`, import.meta.url);
const { decodeDashboardPnlData } = await import('../../src/pages/Dashboard.tsx');

function completePnlPayload() {
  return {
    realizedByDay: [{ day: '2026-07-29', usd: 10 }],
    realizedBySymbol: [{ symbol: 'BTCUSDT', usd: 10 }],
    feesByAsset: [{ asset: 'USDT', amount: 1 }],
    equitySnapshots: [
      { ts: 1_800_000_000_000, totalUsdt: 1_000 },
      { ts: 1_800_000_060_000, totalUsdt: 1_009 },
    ],
    integrity: {
      state: 'COMPLETE',
      complete: true,
      reasons: [],
      days: [{
        day: '2026-07-29',
        complete: true,
        reasons: [],
        feeUsd: 1,
        netUsd: 9,
      }],
    },
  };
}

test('Dashboard admits account values only from current strict private-read truth', () => {
  assert.match(dashboardSource, /const privatePresentation = projectPrivateRead\(privateRead, nowMs\)/);
  assert.match(
    dashboardSource,
    /const privateValuesCurrent = privatePresentation\.freshness\.state === 'CURRENT'/,
  );
  assert.match(
    dashboardSource,
    /exactOrDash\(privateValuesCurrent \? privatePresentation\.spotAvailableUsdt : null\)/,
  );
  assert.match(dashboardSource, /tone=\{privatePresentation\.guardTone\}/);
  assert.match(
    dashboardSource,
    /worstTone\(privatePresentation\.postureTone, privatePresentation\.freshness\.tone\)/,
  );
  assert.match(
    dashboardSource,
    /!privateValuesCurrent \|\| privatePresentation\.counts\.liabilities === null \? '—'/,
  );
  assert.doesNotMatch(dashboardSource, /state\.account(?:\.|\?)/);
  assert.match(dashboardSource, /label="Today’s Account Change"[\s\S]*value="—"/);
});

test('Dashboard hard-gates every engine number on proven current canonical truth', () => {
  assert.match(
    dashboardSource,
    /const productCurrent = retainedProductSnapshot !== null && productBinding\.continuity === 'PROVEN'/,
  );
  assert.match(
    dashboardSource,
    /const productSnapshot = productCurrent \? retainedProductSnapshot : null/,
  );
  assert.match(
    dashboardSource,
    /summary\?\.truthLabel === 'LIVE_PUBLIC'[\s\S]*canonicalPresentation\.status === 'operational'[\s\S]*freshnessState === 'FRESH'/,
  );
  assert.match(
    dashboardSource,
    /const basisStrategy = engineValuesCurrent\(basisComponent, rawBasisStrategy\) \? rawBasisStrategy : null/,
  );
  assert.match(
    dashboardSource,
    /const volumeStrategy = engineValuesCurrent\(volumeComponent, rawVolumeStrategy\) \? rawVolumeStrategy : null/,
  );
  assert.equal(
    dashboardSource.match(/focused: 'UNKNOWN'/g)?.length,
    2,
    'the unavailable per-engine focus count must remain UNKNOWN',
  );
  assert.match(
    dashboardSource,
    /surfaces\.dashboard\.evidence[\s\S]*fieldId === 'pipeline-counts'/,
  );
  assert.match(
    dashboardSource,
    /dashboard\?\.recentCorrelatedDecisions\.slice\(0, 6\)/,
  );
  assert.doesNotMatch(dashboardSource, /state\?\.events|state\.events|state\.risk\.rejectionsToday/);
  assert.doesNotMatch(dashboardSource, /Private Borrow NOT_CONFIGURED/);
});

test('Dashboard withholds market numbers until both canonical and store freshness are live', () => {
  assert.match(dashboardSource, /resolveMarketFreshness\(\{/);
  assert.match(
    dashboardSource,
    /fieldId === 'source-freshness'/,
  );
  assert.match(
    dashboardSource,
    /marketFeedReadiness\?\.proven === true[\s\S]*marketSurfaceFreshness\?\.truthLabel === 'LIVE_PUBLIC'[\s\S]*marketSurfaceFreshness\.value !== null[\s\S]*marketSurfaceFreshness\.unavailableReason === null/,
  );
  assert.match(
    dashboardSource,
    /canonicalMarketSourcesCurrent[\s\S]*marketStatus === 'CURRENT'[\s\S]*marketsLastSuccessAtMs !== null[\s\S]*marketFreshness\.live/,
  );
  assert.match(
    dashboardSource,
    /const marketValueDetail = marketValuesCurrent && liveMarket/,
  );
  assert.match(dashboardSource, /formatUsdtPrice\(liveMarket\.spot\)/);
  assert.match(dashboardSource, /liveMarketValues\.length > 0/);
  assert.match(dashboardSource, /STALE LAST-KNOWN · numeric market values withheld/);
  assert.match(dashboardSource, /Market stream disconnected · numeric values withheld/);
  assert.doesNotMatch(dashboardSource, /['"]\/api\/markets/);
  assert.doesNotMatch(dashboardSource, /['"]\/api\/engine\/(?:basis|volume)/);

  const observedAtMs = 1_900_000_000_000;
  assert.equal(resolveMarketFreshness({
    connected: true,
    error: null,
    sourceTimeMs: observedAtMs,
    nowMs: observedAtMs + 1_000,
    staleAfterMs: 12_000,
  }).live, true);
  assert.equal(resolveMarketFreshness({
    connected: true,
    error: null,
    sourceTimeMs: observedAtMs,
    nowMs: observedAtMs + 12_000,
    staleAfterMs: 12_000,
  }).status, 'STALE');
  assert.equal(resolveMarketFreshness({
    connected: true,
    error: null,
    sourceTimeMs: null,
    nowMs: observedAtMs,
    staleAfterMs: 12_000,
  }).status, 'UNKNOWN');
});

test('Dashboard decodes and labels account PnL without inventing strategy attribution', () => {
  assert.match(
    dashboardSource,
    /const pnlReadEnabled = stateStatus === 'CURRENT'[\s\S]*state\?\.privateAccountTruth === 'AVAILABLE'[\s\S]*privateReadError === null[\s\S]*privateValuesCurrent/,
  );
  assert.match(
    dashboardSource,
    /if \(!pnlReadEnabled\) \{[\s\S]*setPnl\(\{ data: null, error: pnlReadBlocker \}\);[\s\S]*return;/,
  );
  assert.match(dashboardSource, /fetchJson<unknown>\('\/api\/pnl'/);
  assert.match(dashboardSource, /const decoded = decodeDashboardPnlData\(payload\)/);
  assert.match(dashboardSource, /INVALID_DASHBOARD_PNL_RESPONSE/);
  assert.match(
    dashboardSource,
    /closeEnough\(\(grossByDay\.get\(row\.day\) \?\? 0\) - row\.feeUsd, row\.netUsd\)/,
  );
  assert.match(dashboardSource, /const admittedPnl = pnlReadEnabled \? sources\.pnl\.data : null/);
  assert.match(dashboardSource, /admittedPnl\?\.equitySnapshots/);
  assert.match(
    dashboardSource,
    /integrity\.days\.map\(\(day\) => \(\{ day: day\.day, usd: day\.netUsd \}\)\)/,
  );
  assert.match(
    dashboardSource,
    /integrity\.days\.reduce\(\(sum, day\) => sum \+ day\.feeUsd, 0\)/,
  );
  assert.match(dashboardSource, /Validated Account PnL Context/);
  assert.match(dashboardSource, /not attributed to Basis or Volume/);
  assert.doesNotMatch(dashboardSource, /Strategy Performance/);
  assert.doesNotMatch(dashboardSource, /feesByAsset\.find\([\s\S]{0,160}\?\? 0/);
});

test('Dashboard PnL decoder behavior rejects contradictions and aggregate overflow', () => {
  const complete = completePnlPayload();
  assert.deepEqual(decodeDashboardPnlData(complete), complete);

  const feeOnly = completePnlPayload();
  feeOnly.realizedByDay = [];
  feeOnly.realizedBySymbol = [];
  feeOnly.equitySnapshots = [];
  feeOnly.integrity.days = [{
    day: '2026-07-29',
    complete: true,
    reasons: [],
    feeUsd: 1,
    netUsd: -1,
  }];
  assert.deepEqual(decodeDashboardPnlData(feeOnly), feeOnly);

  const partial = completePnlPayload();
  partial.integrity.state = 'PARTIAL';
  partial.integrity.complete = false;
  partial.integrity.reasons = ['MISSING_COST_BASIS'];
  partial.integrity.days[0].complete = false;
  partial.integrity.days[0].reasons = ['MISSING_COST_BASIS'];
  assert.deepEqual(decodeDashboardPnlData(partial), partial);

  const unknown = completePnlPayload();
  unknown.realizedByDay = [];
  unknown.realizedBySymbol = [];
  unknown.feesByAsset = [];
  unknown.equitySnapshots = [];
  unknown.integrity = {
    state: 'UNKNOWN',
    complete: false,
    reasons: ['NO_DURABLE_PNL_EVIDENCE'],
    days: [],
  };
  assert.deepEqual(decodeDashboardPnlData(unknown), unknown);

  const contradictoryReasons = completePnlPayload();
  contradictoryReasons.integrity.reasons = ['MISSING_COST_BASIS'];
  assert.equal(decodeDashboardPnlData(contradictoryReasons), null);

  const overflowing = completePnlPayload();
  overflowing.realizedByDay = [
    { day: '2026-07-28', usd: Number.MAX_VALUE },
    { day: '2026-07-29', usd: Number.MAX_VALUE },
  ];
  overflowing.integrity.days = [
    { day: '2026-07-28', complete: true, reasons: [], feeUsd: 0, netUsd: Number.MAX_VALUE },
    { day: '2026-07-29', complete: true, reasons: [], feeUsd: 0, netUsd: Number.MAX_VALUE },
  ];
  assert.equal(decodeDashboardPnlData(overflowing), null);

  const overflowingParity = completePnlPayload();
  overflowingParity.realizedByDay[0].usd = -Number.MAX_VALUE;
  overflowingParity.integrity.days[0].feeUsd = Number.MAX_VALUE;
  overflowingParity.integrity.days[0].netUsd = 0;
  assert.equal(decodeDashboardPnlData(overflowingParity), null);

  const overflowingProfitGroups = completePnlPayload();
  overflowingProfitGroups.realizedByDay = [
    { day: '2026-07-26', usd: Number.MAX_VALUE },
    { day: '2026-07-27', usd: -Number.MAX_VALUE },
    { day: '2026-07-28', usd: Number.MAX_VALUE },
    { day: '2026-07-29', usd: -Number.MAX_VALUE },
  ];
  overflowingProfitGroups.integrity.days = overflowingProfitGroups.realizedByDay.map((row) => ({
    day: row.day,
    complete: true,
    reasons: [],
    feeUsd: 0,
    netUsd: row.usd,
  }));
  assert.equal(decodeDashboardPnlData(overflowingProfitGroups), null);

  const overflowingHistory = completePnlPayload();
  overflowingHistory.equitySnapshots = [
    { ts: 1_800_000_000_000, totalUsdt: -Number.MAX_VALUE },
    { ts: 1_800_000_060_000, totalUsdt: Number.MAX_VALUE },
  ];
  assert.equal(decodeDashboardPnlData(overflowingHistory), null);

  const invalidDate = completePnlPayload();
  invalidDate.realizedByDay[0].day = '2026-02-30';
  invalidDate.integrity.days[0].day = '2026-02-30';
  assert.equal(decodeDashboardPnlData(invalidDate), null);

  const extraField = { ...completePnlPayload(), unexpected: true };
  assert.equal(decodeDashboardPnlData(extraField), null);
});

test('Dashboard preserves truthful non-green and no-effect boundaries', () => {
  assert.match(dashboardSource, /STALE LAST-KNOWN/);
  assert.match(dashboardSource, /LIVE_EXECUTION_NOT_IMPLEMENTED/);
  assert.match(dashboardSource, /OWNER_GATED/);
  assert.match(dashboardSource, /Focused[\s\S]*Not Published/);
  assert.match(dashboardSource, /Strategy attribution remains UNKNOWN/);
  assert.doesNotMatch(dashboardSource, /method:\s*['"]POST['"]/);
  assert.doesNotMatch(dashboardSource, /new WebSocket|\.send\(/);
  assert.doesNotMatch(dashboardSource, /Number\(privatePresentation\.|parseFloat\(privatePresentation\./);
});

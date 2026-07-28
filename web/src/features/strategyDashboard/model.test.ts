import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  accountPnlTrendState,
  buildAccountPnlPlot,
} from './StrategyPerformanceChart';
import { buildStrategyDashboardFixture } from './fixtures';
import {
  effectiveEvidenceState,
  evidenceTone,
  formatCount,
  formatUsd,
  moneyTone,
  projectAccountPnl,
  projectStrategyDashboard,
  projectUsdToSignedCents,
} from './model';
import type {
  AccountPnlInput,
  AccountPnlMirror,
  SupervisorRuntimeInput,
} from './types';

const NOW = 1_800_000_000_000;

function productionFixture() {
  const fixture = buildStrategyDashboardFixture(NOW, 'CURRENT');
  return {
    runtime: { ...fixture.runtime, source: 'PRODUCTION_OBSERVED' } satisfies SupervisorRuntimeInput,
    pnl: { ...fixture.pnl, source: 'PRODUCTION_OBSERVED' } satisfies AccountPnlInput,
  };
}

test('CURRENT evidence becomes STALE after its bounded age', () => {
  const evidence = {
    state: 'CURRENT',
    source: 'PRODUCTION_OBSERVED',
    observedAtMs: NOW - 60_001,
    maxAgeMs: 60_000,
    reasonCodes: [],
  } as const;
  assert.equal(effectiveEvidenceState(evidence, NOW), 'STALE');
  assert.equal(evidenceTone(evidence, NOW), 'warn');
});

test('invalid runtime and PnL envelopes fail closed before publishing owned values', () => {
  const fixture = productionFixture();
  const invalidEnvelopes: readonly Record<string, unknown>[] = [
    { source: 'BOGUS_PROVENANCE' },
    { source: undefined },
    { observedAtMs: NOW + 1 },
    { observedAtMs: null },
    { maxAgeMs: 0 },
    { maxAgeMs: -1 },
    { maxAgeMs: Number.NaN },
    { maxAgeMs: null },
    { reasonCodes: [42] },
    { reasonCodes: null },
  ];

  for (const invalid of invalidEnvelopes) {
    const invalidPnl = {
      ...fixture.pnl,
      ...invalid,
    } as unknown as AccountPnlInput;
    const invalidRuntime = {
      ...fixture.runtime,
      ...invalid,
    } as unknown as SupervisorRuntimeInput;
    const pnlView = projectAccountPnl(invalidPnl, NOW);
    const dashboardView = projectStrategyDashboard(invalidRuntime, invalidPnl, NOW);

    assert.equal(pnlView.evidenceState, 'UNKNOWN');
    assert.equal(pnlView.evidenceLabel, 'UNKNOWN');
    assert.equal(pnlView.publishable, false);
    assert.equal(pnlView.totalRealizedUsd, null);
    assert.deepEqual(pnlView.points, []);
    assert.equal(dashboardView.runtimeLabel, 'UNKNOWN');
    assert.equal(dashboardView.runtimeTone, 'bad');
    assert.equal(
      dashboardView.strategies.every((strategy) => strategy.candidateCount === null),
      true,
    );
  }
});

test('explicit non-publishable envelopes preserve their state with null time bounds', () => {
  const fixture = productionFixture();
  for (const state of ['NOT_CONFIGURED', 'UNAVAILABLE', 'MISSING'] as const) {
    const envelope = {
      state,
      source: 'PRODUCTION_OBSERVED' as const,
      observedAtMs: null,
      maxAgeMs: null,
      reasonCodes: [],
    };
    const pnlView = projectAccountPnl({ ...fixture.pnl, ...envelope }, NOW);
    const dashboardView = projectStrategyDashboard({ ...fixture.runtime, ...envelope }, fixture.pnl, NOW);
    assert.equal(pnlView.evidenceState, state);
    assert.equal(pnlView.publishable, false);
    assert.equal(pnlView.totalRealizedUsd, null);
    assert.deepEqual(pnlView.points, []);
    assert.equal(dashboardView.runtimeLabel, state);
    assert.equal(dashboardView.runtimeTone, 'bad');
    assert.equal(dashboardView.strategies.every((strategy) => strategy.candidateCount === null), true);
  }
});

test('PARTIAL evidence becomes STALE when its owned observation bound expires', () => {
  const evidence = {
    state: 'PARTIAL',
    source: 'PRODUCTION_OBSERVED',
    observedAtMs: NOW - 60_001,
    maxAgeMs: 60_000,
    reasonCodes: [],
  } as const;
  assert.equal(effectiveEvidenceState(evidence, NOW), 'STALE');
  const { pnl } = productionFixture();
  const mirror = pnl.mirror as AccountPnlMirror;
  const view = projectAccountPnl({
    ...pnl,
    state: 'PARTIAL',
    observedAtMs: NOW - 60_001,
    maxAgeMs: 60_000,
    mirror: {
      ...mirror,
      integrity: {
        ...mirror.integrity,
        state: 'PARTIAL',
        complete: false,
        reasons: ['FEE_VALUATION_PARTIAL'],
        days: mirror.integrity.days.map((day) => ({
          ...day,
          complete: false,
          reasons: ['FEE_VALUATION_PARTIAL'],
        })),
      },
    },
  }, NOW);
  assert.equal(view.evidenceState, 'STALE');
  assert.equal(view.evidenceLabel, 'STALE · PARTIAL');
  assert.equal(view.tone, 'warn');
});

test('frozen caller reason arrays are copied before projection appends reasons', () => {
  const { pnl } = productionFixture();
  const input = {
    ...pnl,
    mirror: null,
    reasonCodes: Object.freeze([] as string[]),
  } satisfies AccountPnlInput;
  assert.doesNotThrow(() => projectAccountPnl(input, NOW));
  const view = projectAccountPnl(input, NOW);
  assert.equal(view.publishable, false);
  assert.match(view.reasonCodes.join(' '), /PNL_MIRROR_UNAVAILABLE/u);
});

test('named CURRENT envelope blockers remain publishable but cannot render green', () => {
  const fixture = productionFixture();
  const runtime = {
    ...fixture.runtime,
    reasonCodes: ['UPSTREAM_ERROR'],
  } satisfies SupervisorRuntimeInput;
  const pnl = {
    ...fixture.pnl,
    reasonCodes: ['UPSTREAM_ERROR'],
  } satisfies AccountPnlInput;
  const pnlView = projectAccountPnl(pnl, NOW);
  const dashboardView = projectStrategyDashboard(runtime, pnl, NOW);

  assert.equal(pnlView.publishable, true);
  assert.notEqual(pnlView.totalRealizedUsd, null);
  assert.equal(pnlView.points.length, 8);
  assert.equal(pnlView.evidenceState, 'PARTIAL');
  assert.equal(pnlView.evidenceLabel, 'PARTIAL');
  assert.equal(pnlView.tone, 'warn');
  assert.match(pnlView.reasonCodes.join(' '), /UPSTREAM_ERROR/u);
  assert.equal(dashboardView.runtimeLabel, 'PARTIAL');
  assert.equal(dashboardView.runtimeTone, 'warn');
  assert.equal(dashboardView.strategies.every((strategy) => strategy.tone !== 'ok'), true);
  assert.equal(dashboardView.overallTone, 'warn');
  assert.match(dashboardView.runtimeReasonCodes.join(' '), /UPSTREAM_ERROR/u);
});

test('UNKNOWN PnL integrity withholds money, chart, and table values', () => {
  const { pnl } = productionFixture();
  const mirror = pnl.mirror as AccountPnlMirror;
  const view = projectAccountPnl({
    ...pnl,
    mirror: {
      ...mirror,
      integrity: {
        ...mirror.integrity,
        state: 'UNKNOWN',
        complete: false,
        reasons: ['FEE_CONVERSION_EVIDENCE_UNKNOWN'],
      },
    },
  }, NOW);
  assert.equal(view.evidenceState, 'UNKNOWN');
  assert.equal(view.publishable, false);
  assert.equal(view.totalRealizedUsd, null);
  assert.deepEqual(view.points, []);
  assert.match(view.reasonCodes.join(' '), /PNL_INTEGRITY_UNKNOWN/u);
});

test('proven zero values stay zero rather than becoming unavailable', () => {
  const { pnl } = productionFixture();
  const mirror = pnl.mirror as AccountPnlMirror;
  const zeroMirror: AccountPnlMirror = {
    ...mirror,
    realizedByDay: [{ day: '2026-07-22', usd: 0 }],
    integrity: {
      state: 'COMPLETE',
      complete: true,
      reasons: [],
      days: [{
        day: '2026-07-22',
        complete: true,
        reasons: [],
        feeUsd: 0,
        netUsd: 0,
      }],
    },
  };
  const view = projectAccountPnl({ ...pnl, mirror: zeroMirror }, NOW);
  assert.equal(view.publishable, true);
  assert.equal(view.totalRealizedUsd, 0);
  assert.deepEqual(view.points, [{ day: '2026-07-22', realizedUsd: 0 }]);
  assert.equal(formatUsd(view.totalRealizedUsd, true), '$0.00');
  assert.equal(formatCount(0), '0');
});

test('COMPLETE fee-only integrity may prove zero realized rows', () => {
  const { pnl } = productionFixture();
  const mirror = pnl.mirror as AccountPnlMirror;
  const view = projectAccountPnl({
    ...pnl,
    mirror: {
      ...mirror,
      realizedByDay: [],
      integrity: {
        state: 'COMPLETE',
        complete: true,
        reasons: [],
        days: [{
          day: '2026-07-22',
          complete: true,
          reasons: [],
          feeUsd: 2.5,
          netUsd: -2.5,
        }],
      },
    },
  }, NOW);
  assert.equal(view.publishable, true);
  assert.equal(view.totalRealizedUsd, 0);
  assert.deepEqual(view.points, []);
});

test('PARTIAL empty integrity never publishes a zero total or complete copy state', () => {
  const { pnl } = productionFixture();
  const mirror = pnl.mirror as AccountPnlMirror;
  const view = projectAccountPnl({
    ...pnl,
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
  }, NOW);
  assert.equal(view.evidenceState, 'PARTIAL');
  assert.equal(view.publishable, true);
  assert.equal(view.totalRealizedUsd, null);
  assert.deepEqual(view.points, []);
  assert.equal(accountPnlTrendState(view), 'EMPTY_PARTIAL');
});

test('STALE partial empty integrity preserves caveats and never manufactures zero', () => {
  const { pnl } = productionFixture();
  const mirror = pnl.mirror as AccountPnlMirror;
  const view = projectAccountPnl({
    ...pnl,
    state: 'PARTIAL',
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
  }, NOW);
  assert.equal(view.evidenceState, 'STALE');
  assert.equal(view.evidenceLabel, 'STALE · PARTIAL');
  assert.equal(view.integrityState, 'PARTIAL');
  assert.equal(view.publishable, true);
  assert.equal(view.totalRealizedUsd, null);
  assert.deepEqual(view.points, []);
  assert.match(
    view.reasonCodes.join(' '),
    /FEE_ONLY_DAY_INCOMPLETE.*PNL_INTEGRITY_PARTIAL/u,
  );
  assert.equal(accountPnlTrendState(view), 'EMPTY_PARTIAL');
  assert.equal(formatUsd(view.totalRealizedUsd, true), '—');
});

test('PARTIAL mirror integrity cannot upgrade a non-publishable PnL envelope', () => {
  const { pnl } = productionFixture();
  const mirror = pnl.mirror as AccountPnlMirror;
  const partialMirror: AccountPnlMirror = {
    ...mirror,
    integrity: {
      ...mirror.integrity,
      state: 'PARTIAL',
      complete: false,
      reasons: ['FEE_VALUATION_PARTIAL'],
      days: mirror.integrity.days.map((day) => ({
        ...day,
        complete: false,
        reasons: ['FEE_VALUATION_PARTIAL'],
      })),
    },
  };
  for (const state of ['NOT_CONFIGURED', 'UNAVAILABLE', 'MISSING'] as const) {
    const view = projectAccountPnl({
      ...pnl,
      state,
      observedAtMs: null,
      maxAgeMs: null,
      mirror: partialMirror,
    }, NOW);
    assert.equal(view.evidenceState, state);
    assert.equal(view.publishable, false);
    assert.equal(view.totalRealizedUsd, null);
    assert.deepEqual(view.points, []);
  }
});

test('replay and synthetic provenance never render green', () => {
  for (const source of ['RECORDED_REPLAY', 'SYNTHETIC_ONLY'] as const) {
    const fixture = buildStrategyDashboardFixture(NOW, 'CURRENT');
    const view = projectStrategyDashboard(
      { ...fixture.runtime, source },
      { ...fixture.pnl, source },
      NOW,
    );
    assert.equal(view.overallTone, 'warn');
    assert.equal(view.runtimeTone, 'warn');
    assert.equal(view.pnl.tone, 'warn');
    assert.equal(view.strategies.every((strategy) => strategy.tone !== 'ok'), true);
  }
});

test('publishable non-current PnL labels retain freshness, integrity, and provenance', () => {
  const { pnl } = productionFixture();
  const mirror = pnl.mirror as AccountPnlMirror;
  const partialMirror: AccountPnlMirror = {
    ...mirror,
    integrity: {
      ...mirror.integrity,
      state: 'PARTIAL',
      complete: false,
      reasons: ['FEE_VALUATION_PARTIAL'],
      days: mirror.integrity.days.map((day) => ({
        ...day,
        complete: false,
        reasons: ['FEE_VALUATION_PARTIAL'],
      })),
    },
  };
  const cases = [
    {
      input: {
        ...pnl,
        state: 'PARTIAL',
        source: 'RECORDED_REPLAY',
      } satisfies AccountPnlInput,
      label: 'PARTIAL · RECORDED_REPLAY',
    },
    {
      input: {
        ...pnl,
        state: 'CURRENT',
        source: 'SYNTHETIC_ONLY',
        observedAtMs: NOW - 60_001,
        maxAgeMs: 60_000,
      } satisfies AccountPnlInput,
      label: 'STALE · SYNTHETIC_ONLY',
    },
    {
      input: {
        ...pnl,
        state: 'PARTIAL',
        source: 'SYNTHETIC_ONLY',
        observedAtMs: NOW - 60_001,
        maxAgeMs: 60_000,
        mirror: partialMirror,
      } satisfies AccountPnlInput,
      label: 'STALE · PARTIAL · SYNTHETIC_ONLY',
    },
  ] as const;

  for (const item of cases) {
    const view = projectAccountPnl(item.input, NOW);
    assert.equal(view.publishable, true);
    assert.equal(view.evidenceLabel, item.label);
    assert.equal(view.tone, 'warn');
  }
});

test('chart geometry and accessible table share the same ordered source rows', () => {
  const { pnl } = productionFixture();
  const view = projectAccountPnl(pnl, NOW);
  const plot = buildAccountPnlPlot(view.points);
  assert.deepEqual(
    plot.points.map((point) => point.source),
    view.points,
    'the visual plot must retain the exact rows presented by the accessible table',
  );
});

test('chart x geometry preserves omitted UTC-day gaps', () => {
  const rows = [
    { day: '2026-07-01', realizedUsd: 1 },
    { day: '2026-07-02', realizedUsd: 2 },
    { day: '2026-07-30', realizedUsd: 3 },
  ] as const;
  const plot = buildAccountPnlPlot(rows);
  const fullSpan = plot.points[2].x - plot.points[0].x;
  const earlySpan = plot.points[1].x - plot.points[0].x;
  assert.ok(earlySpan / fullSpan < 0.05, 'Jul-02 must remain near Jul-01, not at the midpoint');
  assert.deepEqual(plot.points.map((point) => point.source), rows);
});

test('mixed-sign chart exposes a correctly positioned zero tick and reference', () => {
  const rows = [
    { day: '2026-07-01', realizedUsd: 30 },
    { day: '2026-07-02', realizedUsd: -10 },
  ] as const;
  const plot = buildAccountPnlPlot(rows);
  const zero = plot.yTicks.find((tick) => tick.isZero);
  assert.ok(zero);
  assert.equal(zero.value, 0);
  const positiveY = plot.points[0].y;
  const negativeY = plot.points[1].y;
  const expectedZeroY = positiveY + (30 / 40) * (negativeY - positiveY);
  assert.ok(Math.abs(zero.y - expectedZeroY) < 0.000_001);
});

test('negative-only chart uses zero as its upper bound without inventing a positive range', () => {
  const rows = [
    { day: '2026-07-01', realizedUsd: -0.0049 },
    { day: '2026-07-02', realizedUsd: -0.009 },
  ] as const;
  const plot = buildAccountPnlPlot(rows);
  const zero = plot.yTicks.find((tick) => tick.isZero);
  assert.ok(zero);
  assert.equal(zero.value, 0);
  assert.equal(zero.y, Math.min(...plot.yTicks.map((tick) => tick.y)));
  assert.equal(Math.max(...plot.yTicks.map((tick) => tick.value)), 0);
  assert.equal(plot.points.every((point) => point.y > zero.y), true);
});

test('line trend requires eight real days and suppresses single or zero-only series', () => {
  const fixture = productionFixture();
  const view = projectAccountPnl(fixture.pnl, NOW);
  assert.equal(view.points.length, 8, 'synthetic preview must explicitly exercise the graph');
  assert.equal(accountPnlTrendState(view), 'DRAW');
  assert.equal(accountPnlTrendState({ ...view, points: view.points.slice(0, 7) }), 'INSUFFICIENT');
  assert.equal(accountPnlTrendState({ ...view, points: view.points.slice(0, 1) }), 'INSUFFICIENT');
  assert.equal(accountPnlTrendState({
    ...view,
    points: view.points.map((point) => ({ ...point, realizedUsd: 0 })),
  }), 'ZERO_ONLY');
});

test('duplicate, descending, and malformed chart dates fail geometry closed', () => {
  const fixture = productionFixture();
  const view = projectAccountPnl(fixture.pnl, NOW);
  const ascending = Array.from({ length: 8 }, (_, index) => ({
    day: `2026-07-${String(index + 1).padStart(2, '0')}`,
    realizedUsd: index + 1,
  }));
  const invalidSeries = [
    [...ascending].reverse(),
    ascending.map((point, index) => index === 7 ? { ...point, day: ascending[6].day } : point),
    ascending.map((point, index) => index === 7 ? { ...point, day: '2026-02-30' } : point),
    ascending.map((point, index) => index === 7 ? { ...point, day: 'not-a-day' } : point),
  ];
  for (const points of invalidSeries) {
    const plot = buildAccountPnlPlot(points);
    assert.deepEqual(plot, { points: [], yTicks: [] });
    assert.equal(accountPnlTrendState({ ...view, points }, plot), 'INVALID_GEOMETRY');
  }
});

test('PnL days are sorted deterministically without mutating inputs', () => {
  const fixture = productionFixture();
  const pnlRowsBefore = [...(fixture.pnl.mirror?.realizedByDay ?? [])];
  const view = projectStrategyDashboard(fixture.runtime, fixture.pnl, NOW);
  assert.deepEqual(view.pnl.points.map((point) => point.day), [
    '2026-07-01',
    '2026-07-02',
    '2026-07-05',
    '2026-07-09',
    '2026-07-10',
    '2026-07-17',
    '2026-07-25',
    '2026-07-28',
  ]);
  assert.deepEqual(fixture.pnl.mirror?.realizedByDay, pnlRowsBefore);
});

test('runtime-malformed PnL shapes fail closed without throwing', () => {
  const { pnl } = productionFixture();
  const mirror = pnl.mirror as AccountPnlMirror;
  const malformedMirrors: Array<{ mirror: unknown; reason: RegExp }> = [
    { mirror: { ...mirror, realizedByDay: undefined }, reason: /PNL_MIRROR_MALFORMED/u },
    { mirror: { ...mirror, integrity: { ...mirror.integrity, days: undefined } }, reason: /PNL_MIRROR_MALFORMED/u },
    {
      mirror: {
        ...mirror,
        integrity: { ...mirror.integrity, state: 'PARTIAL', complete: true },
      },
      reason: /PNL_INTEGRITY_CONTRADICTORY/u,
    },
    {
      mirror: {
        ...mirror,
        realizedByDay: [],
        integrity: { state: 'COMPLETE', complete: true, reasons: [], days: [] },
      },
      reason: /PNL_COMPLETE_INTEGRITY_EMPTY/u,
    },
  ];
  for (const item of malformedMirrors) {
    const malformedInput = {
      ...pnl,
      mirror: item.mirror,
    } as unknown as AccountPnlInput;
    assert.doesNotThrow(() => projectAccountPnl(malformedInput, NOW));
    const view = projectAccountPnl(malformedInput, NOW);
    assert.equal(view.evidenceState, 'UNKNOWN');
    assert.equal(view.evidenceLabel, 'UNKNOWN');
    assert.equal(view.publishable, false);
    assert.equal(view.totalRealizedUsd, null);
    assert.deepEqual(view.points, []);
    assert.match(view.reasonCodes.join(' '), item.reason);
  }
});

test('runtime-malformed supervisor shapes fail closed and withhold engine values', () => {
  const fixture = productionFixture();
  const snapshot = fixture.runtime.snapshot!;
  const malformedSnapshots = [
    { ...snapshot, components: undefined },
    { ...snapshot, summaries: undefined },
    { ...snapshot, recentCorrelatedDecisions: undefined },
  ];
  for (const malformed of malformedSnapshots) {
    const malformedRuntime = {
      ...fixture.runtime,
      snapshot: malformed,
    } as unknown as SupervisorRuntimeInput;
    assert.doesNotThrow(() => projectStrategyDashboard(malformedRuntime, fixture.pnl, NOW));
    const view = projectStrategyDashboard(malformedRuntime, fixture.pnl, NOW);
    assert.equal(view.runtimeLabel, 'UNKNOWN');
    assert.equal(view.runtimeTone, 'bad');
    assert.equal(view.supervisorEvaluatedAtMs, null);
    assert.equal(view.strategies.every((strategy) => strategy.candidateCount === null), true);
    assert.match(view.runtimeReasonCodes.join(' '), /SYSTEM_SUPERVISOR_SNAPSHOT_MALFORMED/u);
  }
});

test('trace validation accepts canonical kinds and requires STRATEGY for strategy engines', () => {
  const fixture = productionFixture();
  const snapshot = fixture.runtime.snapshot!;
  const baseTrace = {
    eventId: 'trace-contract',
    correlationId: 'correlation-contract',
    componentId: 'basis-engine' as const,
    kind: 'STRATEGY',
    occurredAtMs: NOW - 1_000,
    truthLabel: 'LIVE_PUBLIC' as const,
    ownerId: 'opaque-owner-id',
    canonicalProjectionId: null,
    revisionDigest: null,
    failureCode: null,
    referenceIds: [],
  };
  const accepted = projectStrategyDashboard({
    ...fixture.runtime,
    snapshot: { ...snapshot, recentCorrelatedDecisions: [baseTrace] },
  }, fixture.pnl, NOW);
  assert.equal(accepted.runtimeLabel, 'LIVE_PUBLIC');
  assert.equal(accepted.strategies[0].candidateCount, snapshot.summaries.strategies.basis.candidateCount);

  for (const kind of ['runtime-trace', 'SOURCE']) {
    const rejected = projectStrategyDashboard({
      ...fixture.runtime,
      snapshot: {
        ...snapshot,
        recentCorrelatedDecisions: [{ ...baseTrace, kind }],
      },
    } as unknown as SupervisorRuntimeInput, fixture.pnl, NOW);
    assert.equal(rejected.runtimeLabel, 'UNKNOWN');
    assert.match(rejected.runtimeReasonCodes.join(' '), /SYSTEM_SUPERVISOR_SNAPSHOT_MALFORMED/u);
  }
});

test('snapshot evaluatedAtMs independently gates old, future, and invalid runtime truth', () => {
  const fixture = productionFixture();
  const snapshot = fixture.runtime.snapshot!;
  const cases = [
    {
      evaluatedAtMs: NOW - 60_001,
      label: 'STALE',
      tone: 'warn',
      reason: /SYSTEM_SUPERVISOR_SNAPSHOT_STALE/u,
    },
    {
      evaluatedAtMs: NOW + 1,
      label: 'UNKNOWN',
      tone: 'bad',
      reason: /SYSTEM_SUPERVISOR_SNAPSHOT_FUTURE/u,
    },
    {
      evaluatedAtMs: Number.NaN,
      label: 'UNKNOWN',
      tone: 'bad',
      reason: /SYSTEM_SUPERVISOR_SNAPSHOT_TIME_INVALID/u,
    },
  ] as const;
  for (const item of cases) {
    const view = projectStrategyDashboard(
      {
        ...fixture.runtime,
        observedAtMs: NOW - 1_000,
        maxAgeMs: 60_000,
        snapshot: { ...snapshot, evaluatedAtMs: item.evaluatedAtMs },
      },
      fixture.pnl,
      NOW,
    );
    assert.equal(view.runtimeLabel, item.label);
    assert.equal(view.runtimeTone, item.tone);
    assert.equal(view.strategies.some((strategy) => strategy.tone === 'ok'), false);
    assert.match(view.runtimeReasonCodes.join(' '), item.reason);
  }
});

test('non-publishable runtime envelope outranks a stale embedded snapshot', () => {
  const fixture = productionFixture();
  const snapshot = fixture.runtime.snapshot!;
  const view = projectStrategyDashboard({
    ...fixture.runtime,
    state: 'UNAVAILABLE',
    observedAtMs: null,
    maxAgeMs: null,
    snapshot: { ...snapshot, evaluatedAtMs: NOW - 120_000 },
  }, fixture.pnl, NOW);
  assert.equal(view.runtimeLabel, 'UNAVAILABLE');
  assert.equal(view.runtimeTone, 'bad');
  assert.equal(view.supervisorEvaluatedAtMs, null);
  assert.equal(view.strategies.every((strategy) => strategy.candidateCount === null), true);
});

test('top-level unknown supervisor truth outranks stale or partial runtime quality', () => {
  const fixture = productionFixture();
  const snapshot = fixture.runtime.snapshot!;
  for (const runtimePatch of [
    { state: 'PARTIAL' as const, observedAtMs: NOW - 1_000, maxAgeMs: 60_000 },
    { state: 'CURRENT' as const, observedAtMs: NOW - 1_000, maxAgeMs: 60_000 },
  ]) {
    for (const truthLabel of ['UNKNOWN', 'UNAVAILABLE'] as const) {
      const view = projectStrategyDashboard({
        ...fixture.runtime,
        ...runtimePatch,
        snapshot: {
          ...snapshot,
          evaluatedAtMs: runtimePatch.state === 'CURRENT' ? NOW - 60_001 : snapshot.evaluatedAtMs,
          truthLabel,
        },
      }, fixture.pnl, NOW);
      assert.equal(view.runtimeTone, 'bad');
      assert.equal(view.runtimeLabel, truthLabel);
      assert.equal(view.supervisorEvaluatedAtMs, null);
      assert.equal(view.strategies.every((strategy) => strategy.candidateCount === null), true);
    }
  }
});

test('future and duplicate strategy runtime facts fail closed', () => {
  const fixture = productionFixture();
  const snapshot = fixture.runtime.snapshot!;
  const basisIndex = snapshot.components.findIndex((component) => {
    return component.componentId === 'basis-engine';
  });
  const basis = snapshot.components[basisIndex];
  assert.ok(basis);
  const futureComponent = {
    ...basis,
    sourceTimestamp: basis.sourceTimestamp
      ? {
        ...basis.sourceTimestamp,
        sourceTimeMs: NOW + 1_000,
        receivedAtMs: NOW + 1_000,
      }
      : null,
    freshness: basis.freshness
      ? { ...basis.freshness, evaluatedAt: NOW + 1_000 }
      : null,
  };
  const futureSummary = {
    ...snapshot.summaries,
    strategies: {
      ...snapshot.summaries.strategies,
      basis: {
        ...snapshot.summaries.strategies.basis,
        heartbeatAtMs: NOW + 1_000,
        lastDecisionAtMs: NOW + 1_000,
      },
    },
  };
  const trace = {
    eventId: 'future-trace',
    correlationId: 'future-correlation',
    componentId: 'basis-engine' as const,
    kind: 'STRATEGY',
    occurredAtMs: NOW + 1_000,
    truthLabel: 'LIVE_PUBLIC' as const,
    ownerId: null,
    canonicalProjectionId: null,
    revisionDigest: null,
    failureCode: null,
    referenceIds: [],
  };
  const malformedSnapshots = [
    {
      ...snapshot,
      components: snapshot.components.map((component, index) => {
        return index === basisIndex ? futureComponent : component;
      }),
    },
    { ...snapshot, summaries: futureSummary },
    { ...snapshot, recentCorrelatedDecisions: [trace] },
    { ...snapshot, components: [...snapshot.components, basis] },
    {
      ...snapshot,
      components: snapshot.components.filter((component) => {
        return component.componentId !== 'volume-engine';
      }),
    },
  ];

  for (const malformed of malformedSnapshots) {
    const view = projectStrategyDashboard({
      ...fixture.runtime,
      snapshot: malformed,
    }, fixture.pnl, NOW);
    assert.equal(view.runtimeLabel, 'UNKNOWN');
    assert.equal(view.runtimeTone, 'bad');
    assert.equal(view.supervisorEvaluatedAtMs, null);
    assert.match(view.runtimeReasonCodes.join(' '), /SYSTEM_SUPERVISOR_SNAPSHOT_MALFORMED/u);
  }
});

test('missing or inconsistent owned component freshness is named and non-green', () => {
  const fixture = productionFixture();
  const snapshot = fixture.runtime.snapshot!;
  const basis = snapshot.components.find((component) => component.componentId === 'basis-engine');
  assert.ok(basis?.freshness);
  assert.ok(basis.sourceTimestamp);
  const cases = [
    {
      freshness: { ...basis.freshness, ageMs: null },
      sourceTimestamp: null,
      reasons: /FRESHNESS_AGE_UNAVAILABLE.*SOURCE_TIMESTAMP_UNAVAILABLE/u,
    },
    {
      freshness: { ...basis.freshness, ageMs: basis.freshness.ageMs! + 1 },
      sourceTimestamp: basis.sourceTimestamp,
      reasons: /FRESHNESS_AGE_INCONSISTENT/u,
    },
    { freshness: null, sourceTimestamp: basis.sourceTimestamp, reasons: /FRESHNESS_UNKNOWN/u },
  ];

  for (const item of cases) {
    const view = projectStrategyDashboard({
      ...fixture.runtime,
      snapshot: {
        ...snapshot,
        components: snapshot.components.map((component) => {
          return component.componentId === 'basis-engine'
            ? {
              ...component,
              freshness: item.freshness,
              sourceTimestamp: item.sourceTimestamp,
            }
            : component;
        }),
      },
    }, fixture.pnl, NOW);
    const projectedBasis = view.strategies[0];
    assert.equal(projectedBasis.strategyId, 'basis');
    assert.notEqual(projectedBasis.tone, 'ok');
    assert.match(projectedBasis.reasonCodes.join(' '), item.reasons);
  }

  const toleratedSkew = projectStrategyDashboard({
    ...fixture.runtime,
    snapshot: {
      ...snapshot,
      components: snapshot.components.map((component) => {
        return component.componentId === 'basis-engine'
          ? {
            ...component,
            freshness: {
              ...basis.freshness!,
              ageMs: -1_000,
              evaluatedAt: NOW,
            },
            sourceTimestamp: {
              ...basis.sourceTimestamp!,
              sourceTimeMs: NOW + 1_000,
            },
          }
          : component;
      }),
    },
  }, fixture.pnl, NOW);
  assert.equal(toleratedSkew.strategies[0].tone, 'ok');
  assert.doesNotMatch(
    toleratedSkew.strategies[0].reasonCodes.join(' '),
    /FRESHNESS_AGE_INCONSISTENT|FRESHNESS_CLOCK_SKEWED/u,
  );
});

test('summary truth gaps suppress strategy activity facts', () => {
  const fixture = productionFixture();
  const snapshot = fixture.runtime.snapshot!;
  for (const truthLabel of ['UNKNOWN', 'UNAVAILABLE'] as const) {
    const view = projectStrategyDashboard({
      ...fixture.runtime,
      snapshot: {
        ...snapshot,
        summaries: {
          ...snapshot.summaries,
          strategies: {
            ...snapshot.summaries.strategies,
            basis: { ...snapshot.summaries.strategies.basis, truthLabel },
          },
        },
      },
    }, fixture.pnl, NOW);
    const basis = view.strategies[0];
    assert.equal(basis.heartbeatAtMs, null);
    assert.equal(basis.lastDecisionAtMs, null);
    assert.equal(basis.candidateCount, null);
    assert.equal(basis.proposalCount, null);
    assert.equal(basis.rejectionCount, null);
    assert.equal(basis.acceptedCount, null);
    assert.match(basis.reasonCodes.join(' '), /STRATEGY_RUNTIME_SUMMARY_UNAVAILABLE/u);
    assert.notEqual(basis.tone, 'ok');
    assert.notEqual(view.strategies[1].candidateCount, null);
  }
});

test('owned blockers and failures prevent green strategy state', () => {
  const fixture = productionFixture();
  const snapshot = fixture.runtime.snapshot!;
  const cases = [
    { blockerCodes: ['ENGINE_POLICY_BLOCKED'], lastFailure: null },
    {
      blockerCodes: [],
      lastFailure: {
        code: 'ENGINE_RUNTIME_FAILED',
        message: 'synthetic failure',
        recommendedOperatorAction: 'inspect',
      },
    },
  ];
  for (const patch of cases) {
    const view = projectStrategyDashboard({
      ...fixture.runtime,
      snapshot: {
        ...snapshot,
        components: snapshot.components.map((component) => {
          return component.componentId === 'basis-engine'
            ? { ...component, ...patch }
            : component;
        }),
      },
    }, fixture.pnl, NOW);
    assert.notEqual(view.strategies[0].tone, 'ok');
    assert.equal(view.overallTone, 'bad');
    assert.equal(view.overallLabel, 'NON-GREEN · TRUTH UNAVAILABLE');
  }
});

test('blocked engine severity dominates the dashboard hierarchy', () => {
  const fixture = productionFixture();
  const snapshot = fixture.runtime.snapshot!;
  const view = projectStrategyDashboard({
    ...fixture.runtime,
    snapshot: {
      ...snapshot,
      components: snapshot.components.map((component) => {
        return component.componentId === 'basis-engine'
          ? {
            ...component,
            readiness: 'BLOCKED',
            blockerCodes: ['ENGINE_OWNER_BLOCKED'],
          }
          : component;
      }),
    },
  }, fixture.pnl, NOW);
  assert.equal(view.runtimeTone, 'ok');
  assert.equal(view.pnl.tone, 'ok');
  assert.equal(view.strategies[0].tone, 'bad');
  assert.equal(view.overallTone, 'bad');
  assert.equal(view.overallLabel, 'NON-GREEN · TRUTH UNAVAILABLE');
});

test('Basis and Volume views preserve asymmetric component and summary identity', () => {
  const fixture = productionFixture();
  const snapshot = fixture.runtime.snapshot!;
  const components = snapshot.components.map((component) => {
    if (component.componentId === 'basis-engine') {
      return { ...component, phase: 'BASIS_PHASE_ONLY' };
    }
    if (component.componentId === 'volume-engine') {
      return { ...component, phase: 'VOLUME_PHASE_ONLY' };
    }
    return component;
  }).reverse();
  const view = projectStrategyDashboard({
    ...fixture.runtime,
    snapshot: {
      ...snapshot,
      components,
      summaries: {
        ...snapshot.summaries,
        strategies: {
          basis: { ...snapshot.summaries.strategies.basis, candidateCount: 101, proposalCount: 11 },
          volume: { ...snapshot.summaries.strategies.volume, candidateCount: 202, proposalCount: 22 },
        },
      },
    },
  }, fixture.pnl, NOW);
  assert.deepEqual(
    view.strategies.map((strategy) => ({
      id: strategy.strategyId,
      label: strategy.label,
      componentId: strategy.component?.componentId,
      phase: strategy.phase,
      candidates: strategy.candidateCount,
      proposals: strategy.proposalCount,
    })),
    [
      {
        id: 'basis',
        label: 'Basis',
        componentId: 'basis-engine',
        phase: 'BASIS_PHASE_ONLY',
        candidates: 101,
        proposals: 11,
      },
      {
        id: 'volume',
        label: 'Volume',
        componentId: 'volume-engine',
        phase: 'VOLUME_PHASE_ONLY',
        candidates: 202,
        proposals: 22,
      },
    ],
  );
});

test('raw rows use symmetric adaptive presentation and compensated aggregation', () => {
  assert.equal(projectUsdToSignedCents(1.005), 101);
  assert.equal(projectUsdToSignedCents(-1.005), -101);
  assert.equal(projectUsdToSignedCents(-0.005), -1);
  assert.equal(projectUsdToSignedCents(-0.004), 0);
  assert.equal(projectUsdToSignedCents(10.075), 1_008);
  assert.equal(projectUsdToSignedCents(-10.075), -1_008);
  assert.equal(formatUsd(-1.005, true), '−$1.01');
  assert.equal(formatUsd(10.075, true), '+$10.08');
  assert.equal(formatUsd(-10.075, true), '−$10.08');
  assert.equal(formatUsd(0.005, true), '+$0.005');
  assert.equal(formatUsd(-0.005, true), '−$0.005');
  assert.equal(formatUsd(-0.004, true), '−$0.004');
  assert.equal(formatUsd(0.0049, true), '+$0.0049');
  assert.equal(formatUsd(-0.000_000_001, true), '−$<0.00000001');
  assert.equal(moneyTone(-0.005, 'ok'), 'bad');
  assert.equal(moneyTone(-0.004, 'ok'), 'bad');

  const { pnl } = productionFixture();
  const mirror = pnl.mirror as AccountPnlMirror;
  const rawRows = [
    { day: '2026-07-22', usd: -1.005 },
    { day: '2026-07-23', usd: -0.005 },
    { day: '2026-07-24', usd: -0.004 },
  ];
  const view = projectAccountPnl({
    ...pnl,
    mirror: {
      ...mirror,
      realizedByDay: rawRows,
      integrity: {
        state: 'COMPLETE',
        complete: true,
        reasons: [],
        days: rawRows.map((row) => ({
          day: row.day,
          complete: true,
          reasons: [],
          feeUsd: 0,
          netUsd: row.usd,
        })),
      },
    },
  }, NOW);
  assert.deepEqual(view.points.map((point) => point.realizedUsd), [-1.005, -0.005, -0.004]);
  assert.deepEqual(view.points.map((point) => formatUsd(point.realizedUsd, true)), [
    '−$1.01',
    '−$0.005',
    '−$0.004',
  ]);
  assert.ok(Math.abs((view.totalRealizedUsd ?? 0) - (-1.014)) < 1e-12);
  assert.equal(formatUsd(view.totalRealizedUsd, true), '−$1.01');
  assert.deepEqual(
    buildAccountPnlPlot(view.points).points.map((point) => point.source),
    view.points,
  );

  const hundredRows = Array.from({ length: 100 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, index + 1));
    return { day: date.toISOString().slice(0, 10), usd: 0.0049 };
  });
  const accumulated = projectAccountPnl({
    ...pnl,
    mirror: {
      ...mirror,
      realizedByDay: hundredRows,
      integrity: {
        state: 'COMPLETE',
        complete: true,
        reasons: [],
        days: hundredRows.map((row) => ({
          day: row.day,
          complete: true,
          reasons: [],
          feeUsd: 0,
          netUsd: row.usd,
        })),
      },
    },
  }, NOW);
  assert.equal(accumulated.points.every((point) => point.realizedUsd === 0.0049), true);
  assert.ok(Math.abs((accumulated.totalRealizedUsd ?? 0) - 0.49) < 1e-12);
  assert.equal(formatUsd(accumulated.totalRealizedUsd, true), '+$0.49');

  for (const values of [
    [1_000_000_000_000, 0.01, -1_000_000_000_000],
    [1_000_000_000_000, -1_000_000_000_000, 0.01],
    [0.01, 1_000_000_000_000, -1_000_000_000_000],
  ]) {
    const rows = values.map((usd, index) => ({
      day: `2026-08-0${index + 1}`,
      usd,
    })).reverse();
    const cancellation = projectAccountPnl({
      ...pnl,
      mirror: {
        ...mirror,
        realizedByDay: rows,
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
    }, NOW);
    assert.equal(cancellation.totalRealizedUsd, 0.01);
    assert.equal(formatUsd(cancellation.totalRealizedUsd, true), '+$0.01');
  }
});

test('dashboard source exposes only the owned summary, engine state, and account series surfaces', () => {
  const source = readFileSync(new URL('./StrategyDashboard.tsx', import.meta.url), 'utf8');
  const chartSource = readFileSync(new URL('./StrategyPerformanceChart.tsx', import.meta.url), 'utf8');
  const barrelSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const summaryStart = source.indexOf('<section className="strd-summary"');
  const summaryEnd = source.indexOf('</section>', summaryStart);
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  const summary = source.slice(summaryStart, summaryEnd);
  assert.equal(summary.match(/<SummaryCell/gu)?.length, 3);
  assert.match(summary, /label="Unattributed Account Realized PnL"/u);
  assert.match(summary, /label="Published UTC Days"/u);
  assert.match(summary, /label="Strategy PnL \+ Outcomes"[\s\S]*value="UNKNOWN"/u);
  assert.match(source, /<StrategyPerformanceChart pnl=\{view\.pnl\}/u);
  assert.match(chartSource, /Unattributed Account Realized PnL chart data in USD by UTC day/u);
  assert.doesNotMatch(
    source,
    /Recent Strategy Traces|Execution Claim|label="Supervisor Runtime"|strd-ledger|sourceRevision/u,
  );
  assert.doesNotMatch(barrelSource, /StrategyTraceView/u);
});

test('strategy performance stays explicitly UNKNOWN even with account PnL', () => {
  const fixture = productionFixture();
  const view = projectStrategyDashboard(fixture.runtime, fixture.pnl, NOW);
  assert.equal(view.pnl.publishable, true);
  assert.equal(view.pnl.tone, 'ok');
  assert.equal(view.runtimeTone, 'ok');
  assert.equal(view.overallTone, 'warn', 'unknown strategy performance keeps the whole dashboard non-green');
  assert.equal(view.overallLabel, 'NON-GREEN · PERFORMANCE EVIDENCE UNAVAILABLE');
  assert.equal(view.strategies.length, 2);
  const source = readFileSync(new URL('./StrategyDashboard.tsx', import.meta.url), 'utf8');
  assert.match(source, /PnL \+ Outcomes UNKNOWN/u);
  assert.equal((source.match(/value="UNKNOWN"/gu) ?? []).length >= 2, true);
  assert.doesNotMatch(source, /Closed Outcomes|Strategy-Attributed Results/u);
});

test('production component exposes no controls and production barrel exports no fixtures', () => {
  const componentSource = readFileSync(new URL('./StrategyDashboard.tsx', import.meta.url), 'utf8');
  const barrelSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(componentSource, /<button\b|onClick=|fetch\s*\(/u);
  assert.doesNotMatch(barrelSource, /fixture|preview/iu);
});

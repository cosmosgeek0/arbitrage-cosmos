#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { BasisRuntime } from '../dist/services/basisRuntime.js';

const SYMBOL = 'TESTUSDT';
const T0 = 80_000_000;

function rawBook(bidPrice, askPrice, time) {
  return {
    symbol: SYMBOL,
    bidPrice,
    askPrice,
    bidQty: 500,
    askQty: 500,
    ...(time === undefined ? {} : { time }),
  };
}

function cut(spot, futures) {
  return { spot, futures };
}

function createWorld(cuts, initialNow = T0) {
  let now = initialNow;
  let fetchCalls = 0;
  const fakeFetch = async (market) => {
    const selected = cuts[Math.min(Math.floor(fetchCalls / 2), cuts.length - 1)];
    fetchCalls += 1;
    const row = selected[market];
    return row === null ? new Map() : new Map([[SYMBOL, row]]);
  };
  const config = {
    feesPct: 0.3,
    minNetBasisPct: 0.01,
    persistTicks: 1,
    minQuoteVolume24h: 0,
    killSwitch: false,
    blockedSymbols: [],
  };
  const runtime = new BasisRuntime(
    { logEvent() {} },
    () => config,
    () => [{
      symbol: SYMBOL,
      base: 'TEST',
      quoteVolume24h: 50_000_000,
      hasSpot: true,
      hasPerp: true,
      perpMark: 101.01,
      fundingRate: 0.0001,
      nextFundingTime: now + 3_600_000,
      markUpdatedAt: now,
    }],
    fakeFetch,
  );
  return {
    runtime,
    now: () => now,
    setNow(value) { now = value; },
    fetchCalls: () => fetchCalls,
  };
}

function latestCausality(runtime) {
  const decision = latestDecision(runtime);
  return {
    quadrant: decision.evidence.gapCausalQuadrant,
    market: decision.evidence.gapInitiatingMarket,
    sourceTime: decision.evidence.gapInitiatingSourceTs,
    sourceSequence: decision.evidence.gapInitiatingSourceSequence,
    acceptanceSequence: decision.evidence.gapCausalEventSequence,
  };
}

function latestDecision(runtime) {
  const decision = runtime.integrationSnapshot().decisions.filter((row) => row.symbol === SYMBOL).at(-1);
  assert.ok(decision, 'BasisRuntime must expose the canonical engine decision');
  return decision;
}

async function withRuntimeClock(world, body) {
  const originalNow = Date.now;
  Date.now = world.now;
  try {
    await body();
  } finally {
    world.runtime.stop();
    Date.now = originalNow;
  }
}

test('BasisRuntime separates tied REST receipt from distinct source-event chronology', async () => {
  const world = createWorld([
    cut(rawBook(99.98, 100, T0 - 20), rawBook(101, 101.02, T0 - 10)),
    cut(rawBook(99.48, 99.5, T0 + 40), rawBook(101, 101.02, T0 + 50)),
    cut(rawBook(99.48, 99.5, T0 + 80), rawBook(101, 101.02, T0 + 90)),
    cut(rawBook(99.28, 99.3, T0 + 60), rawBook(101.2, 101.22, T0 + 70)),
    cut(rawBook(99.08, 99.1, T0 + 100), rawBook(101.2, 101.22, T0 + 110)),
  ]);

  await withRuntimeClock(world, async () => {
    await world.runtime.start();
    assert.equal(latestCausality(world.runtime).quadrant, 'UNKNOWN', 'first pair is bootstrap only');

    world.setNow(T0 + 100);
    await world.runtime.refreshBooks();
    const changed = latestCausality(world.runtime);
    assert.deepEqual(changed, {
      quadrant: 'RISING_SPOT_LED',
      market: 'SPOT',
      sourceTime: T0 + 40,
      sourceSequence: null,
      acceptanceSequence: 2,
    });
    assert.notEqual(changed.sourceTime, world.now(), 'local receipt must not impersonate source event time');

    world.setNow(T0 + 140);
    await world.runtime.refreshBooks();
    assert.deepEqual(latestCausality(world.runtime), changed, 'unchanged opposite-leg refresh preserves the valid move');

    world.runtime.stop();
    world.setNow(T0 + 220);
    await world.runtime.start();
    assert.equal(latestCausality(world.runtime).quadrant, 'UNKNOWN', 'restart requires a new paired bootstrap');
    world.setNow(T0 + 260);
    await world.runtime.refreshBooks();
    assert.equal(
      latestCausality(world.runtime).quadrant,
      'RISING_SPOT_LED',
      'restart clears the old T3 watermark before the lower T2 bootstrap',
    );
    assert.equal(world.fetchCalls(), 10);
  });
});

test('BasisRuntime preserves both leadership directions across exact unchanged REST source replay', async () => {
  const cases = [
    {
      expected: 'RISING_SPOT_LED',
      cuts: [
        cut(rawBook(99.98, 100, T0 - 20), rawBook(101, 101.02, T0 - 10)),
        cut(rawBook(99.48, 99.5, T0 + 40), rawBook(101, 101.02, T0 + 20)),
        cut(rawBook(99.48, 99.5, T0 + 40), rawBook(101, 101.02, T0 + 20)),
      ],
    },
    {
      expected: 'RISING_PERPETUAL_LED',
      cuts: [
        cut(rawBook(99.98, 100, T0 - 20), rawBook(101, 101.02, T0 - 10)),
        cut(rawBook(99.98, 100, T0 + 20), rawBook(101.5, 101.52, T0 + 40)),
        cut(rawBook(99.98, 100, T0 + 20), rawBook(101.5, 101.52, T0 + 40)),
      ],
    },
  ];

  for (const row of cases) {
    const world = createWorld(row.cuts);
    await withRuntimeClock(world, async () => {
      await world.runtime.start();
      world.setNow(T0 + 100);
      await world.runtime.refreshBooks();
      const changed = latestCausality(world.runtime);
      assert.equal(changed.quadrant, row.expected);

      world.setNow(T0 + 140);
      await world.runtime.refreshBooks();
      assert.deepEqual(
        latestCausality(world.runtime),
        changed,
        'unchanged opposite-leg transaction-time replay preserves the accepted cause',
      );
      assert.equal(world.fetchCalls(), 6);
    });
  }
});

test('BasisRuntime rejects a changed leg older than the last unchanged paired REST observation', async () => {
  const world = createWorld([
    cut(rawBook(99.98, 100, T0 - 20), rawBook(101, 101.02, T0 - 10)),
    cut(rawBook(99.68, 99.7, T0 + 20), rawBook(101, 101.02, T0 + 30)),
    cut(rawBook(99.68, 99.7, T0 + 80), rawBook(101, 101.02, T0 + 90)),
    cut(rawBook(99.48, 99.5, T0 + 60), rawBook(101, 101.02, T0 + 120)),
  ]);

  await withRuntimeClock(world, async () => {
    await world.runtime.start();
    world.setNow(T0 + 60);
    await world.runtime.refreshBooks();
    assert.equal(latestCausality(world.runtime).quadrant, 'RISING_SPOT_LED');

    world.setNow(T0 + 100);
    await world.runtime.refreshBooks();
    assert.equal(latestCausality(world.runtime).quadrant, 'RISING_SPOT_LED');

    world.setNow(T0 + 140);
    await world.runtime.refreshBooks();
    assert.deepEqual(latestCausality(world.runtime), {
      quadrant: 'UNKNOWN',
      market: 'UNKNOWN',
      sourceTime: null,
      sourceSequence: null,
      acceptanceSequence: null,
    });
    const decision = latestDecision(world.runtime);
    assert.deepEqual(
      [decision.evidence.gapCausalQuadrant, decision.evidence.gapTrend,
        decision.evidence.gapInitiatingMarket, decision.evidence.gapInitiatingSourceTs,
        decision.evidence.gapInitiatingSourceSequence, decision.evidence.gapCausalEventSequence],
      ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', null, null, null],
    );
    assert.equal(world.fetchCalls(), 8);
  });
});

test('BasisRuntime classifies dual changes only with exact source order', async () => {
  const ordered = createWorld([
    cut(rawBook(99.98, 100, T0 - 20), rawBook(101, 101.02, T0 - 10)),
    cut(rawBook(99.48, 99.5, T0 + 40), rawBook(101.2, 101.22, T0 + 60)),
  ]);
  await withRuntimeClock(ordered, async () => {
    await ordered.runtime.start();
    ordered.setNow(T0 + 100);
    await ordered.runtime.refreshBooks();
    const causal = latestCausality(ordered.runtime);
    assert.equal(causal.quadrant, 'RISING_SPOT_LED');
    assert.equal(causal.sourceTime, T0 + 40);
  });

  const ambiguous = createWorld([
    cut(rawBook(99.98, 100, T0 - 20), rawBook(101, 101.02, T0 - 10)),
    cut(rawBook(99.48, 99.5), rawBook(101.2, 101.22)),
  ]);
  await withRuntimeClock(ambiguous, async () => {
    await ambiguous.runtime.start();
    ambiguous.setNow(T0 + 100);
    await ambiguous.runtime.refreshBooks();
    assert.deepEqual(latestCausality(ambiguous.runtime), {
      quadrant: 'UNKNOWN',
      market: 'UNKNOWN',
      sourceTime: null,
      sourceSequence: null,
      acceptanceSequence: null,
    });
  });
});

test('BasisRuntime makes missing and exact stale paired legs causally unavailable', async () => {
  const missing = createWorld([
    cut(rawBook(99.98, 100, T0 - 20), rawBook(101, 101.02, T0 - 10)),
    cut(rawBook(99.48, 99.5, T0 + 40), rawBook(101, 101.02, T0 + 50)),
    cut(null, rawBook(101, 101.02, T0 + 80)),
  ]);
  await withRuntimeClock(missing, async () => {
    await missing.runtime.start();
    missing.setNow(T0 + 100);
    await missing.runtime.refreshBooks();
    assert.equal(latestCausality(missing.runtime).quadrant, 'RISING_SPOT_LED');
    missing.setNow(T0 + 140);
    await missing.runtime.refreshBooks();
    assert.equal(latestCausality(missing.runtime).quadrant, 'UNKNOWN');
  });

  const stale = createWorld([
    cut(rawBook(99.98, 100, T0 - 20), rawBook(101, 101.02, T0 - 10)),
    cut(rawBook(99.48, 99.5, T0 - 10_000), rawBook(101, 101.02, T0 + 80)),
  ]);
  await withRuntimeClock(stale, async () => {
    await stale.runtime.start();
    stale.setNow(T0 + 100);
    await stale.runtime.refreshBooks();
    assert.equal(latestCausality(stale.runtime).quadrant, 'UNKNOWN');
    assert.equal(worldSafeGap(stale.runtime), null);
  });
});

function worldSafeGap(runtime) {
  const row = runtime.snapshot().rows.find((entry) => entry.symbol === SYMBOL);
  return row?.executableGapPct ?? null;
}

#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSnapshots,
  createReplayHarness,
  perpetualBookReplayStep,
  spotBookReplayStep,
} from '../dist/engine/basis/index.js';

const T0 = 20_000_000;
const SYMBOL = 'TESTUSDT';

function meta() {
  return {
    symbol: SYMBOL,
    base: 'TEST',
    quote: 'USDT',
    hasSpot: true,
    hasPerp: true,
    marginBorrowable: null,
    minNotionalUsd: 5,
    tickSize: 0.01,
    stepSize: 0.001,
    quoteVolume24hUsd: 50_000_000,
    eligible: true,
    ineligibleReason: null,
  };
}

function book(bid, ask, ts, sourceEventTimeMs = ts, sourceSequence = sourceEventTimeMs) {
  return {
    symbol: SYMBOL,
    bid,
    ask,
    bidQty: 500,
    askQty: 500,
    ts,
    sourceEventTimeMs,
    sourceSequence,
  };
}

function harness(overrides = {}) {
  return createReplayHarness({
    persistTicks: 1,
    minNetBasisPct: 0.01,
    maxMarkDivergenceBps: 100,
    ...overrides,
  }, T0);
}

function seed(
  h,
  spot = book(99.98, 100, T0 + 10),
  perpetual = book(101, 101.02, T0 + 20),
  { borrow = false } = {},
) {
  const initialEvents = [{ type: 'universe', symbols: [meta()] }];
  if (borrow) {
    initialEvents.push({
      type: 'borrow',
      info: {
        asset: 'TEST',
        status: 'available',
        maxBorrowableBase: 1_000,
        hourlyRatePct: 0.002,
        asOfTs: T0,
      },
    });
  }
  h.run([
    { atMs: T0, events: initialEvents, tick: false },
    spotBookReplayStep(T0 + 10, spot, false),
    perpetualBookReplayStep(T0 + 20, perpetual, false),
    {
      atMs: T0 + 20,
      events: [
        {
          type: 'markFunding',
          tick: {
            symbol: SYMBOL,
            markPrice: (perpetual.bid + perpetual.ask) / 2,
            fundingRate: 0.0001,
            nextFundingTs: T0 + 3_600_000,
            ts: T0 + 20,
          },
        },
        { type: 'spotDepth', ladder: { symbol: SYMBOL, bids: [[spot.bid, 500]], asks: [[spot.ask, 500]], ts: spot.ts } },
        { type: 'perpDepth', ladder: { symbol: SYMBOL, bids: [[perpetual.bid, 500]], asks: [[perpetual.ask, 500]], ts: perpetual.ts } },
      ],
    },
  ]);
  assert.equal(h.engine.featureSnapshot(SYMBOL).basis.gapA.causality.quadrant, 'UNKNOWN');
}

function assertProjected(h, quadrant, market, trend, gapKey = 'gapA') {
  const feature = h.engine.featureSnapshot(SYMBOL);
  const decision = h.engine.decisions(1)[0];
  const proposal = h.engine.proposals.open()[0];
  const projected = buildSnapshots(h.engine, h.sink).gapCausality(SYMBOL);
  assert.equal(feature.basis[gapKey].causality.quadrant, quadrant);
  assert.equal(feature.basis[gapKey].causality.initiatingMarket, market);
  assert.equal(feature.basis[gapKey].causality.trend, trend);
  assert.equal(feature.basis[gapKey].causality.initiatingSourceSequence, feature.basis[gapKey].causality.initiatingSourceTs);
  assert.equal(decision.evidence.gapCausalQuadrant, quadrant);
  assert.equal(decision.evidence.gapInitiatingMarket, market);
  assert.equal(proposal.evidence.causalQuadrant, quadrant);
  assert.equal(proposal.evidence.initiatingMarket, market);
  assert.deepEqual(projected[gapKey], feature.basis[gapKey].causality);
}

test('MIS-013 proves all rise/fall by spot/perpetual initiating-market quadrants', () => {
  const cases = [
    {
      quadrant: 'RISING_SPOT_LED', market: 'SPOT', trend: 'RISING',
      step: spotBookReplayStep(T0 + 1_000, book(99.48, 99.5, T0 + 1_000)),
    },
    {
      quadrant: 'RISING_PERPETUAL_LED', market: 'PERPETUAL', trend: 'RISING',
      step: perpetualBookReplayStep(T0 + 1_000, book(101.5, 101.52, T0 + 1_000)),
    },
    {
      quadrant: 'FALLING_SPOT_LED', market: 'SPOT', trend: 'FALLING',
      step: spotBookReplayStep(T0 + 1_000, book(100.48, 100.5, T0 + 1_000)),
    },
    {
      quadrant: 'FALLING_PERPETUAL_LED', market: 'PERPETUAL', trend: 'FALLING',
      step: perpetualBookReplayStep(T0 + 1_000, book(100.5, 100.52, T0 + 1_000)),
    },
  ];

  for (const row of cases) {
    const h = harness();
    seed(h);
    h.run([row.step]);
    assertProjected(h, row.quadrant, row.market, row.trend);
  }
});

test('MIS-013 proves the same four quadrants for the reverse executable gap', () => {
  const reverseSpot = book(101, 101.02, T0 + 10);
  const reversePerpetual = book(99.98, 100, T0 + 20);
  const cases = [
    {
      quadrant: 'RISING_SPOT_LED', market: 'SPOT', trend: 'RISING',
      step: spotBookReplayStep(T0 + 1_000, book(101.5, 101.52, T0 + 1_000)),
    },
    {
      quadrant: 'RISING_PERPETUAL_LED', market: 'PERPETUAL', trend: 'RISING',
      step: perpetualBookReplayStep(T0 + 1_000, book(99.48, 99.5, T0 + 1_000)),
    },
    {
      quadrant: 'FALLING_SPOT_LED', market: 'SPOT', trend: 'FALLING',
      step: spotBookReplayStep(T0 + 1_000, book(100.5, 100.52, T0 + 1_000)),
    },
    {
      quadrant: 'FALLING_PERPETUAL_LED', market: 'PERPETUAL', trend: 'FALLING',
      step: perpetualBookReplayStep(T0 + 1_000, book(100.48, 100.5, T0 + 1_000)),
    },
  ];

  for (const row of cases) {
    const h = harness();
    seed(h, reverseSpot, reversePerpetual, { borrow: true });
    h.run([row.step]);
    assertProjected(h, row.quadrant, row.market, row.trend, 'gapB');
  }
});

test('MIS-013 keeps ties, below-watch gaps, and missing pairs honestly UNKNOWN', () => {
  const tied = harness();
  seed(tied);
  tied.run([perpetualBookReplayStep(T0 + 100, book(101.5, 101.52, T0 + 20))]);
  assert.equal(tied.engine.featureSnapshot(SYMBOL).basis.gapA.causality.quadrant, 'UNKNOWN');
  assert.equal(tied.engine.decisions(1)[0].evidence.gapInitiatingMarket, 'UNKNOWN');

  const below = harness();
  seed(below, book(99.98, 100, T0 + 10), book(100.1, 100.12, T0 + 20));
  below.run([perpetualBookReplayStep(T0 + 1_000, book(100.12, 100.14, T0 + 1_000))]);
  assert.equal(below.engine.featureSnapshot(SYMBOL).basis.gapA.gapPct < below.engine.cfg.watchGapPct, true);
  assert.equal(below.engine.featureSnapshot(SYMBOL).basis.gapA.causality.quadrant, 'UNKNOWN');

  const missing = harness();
  missing.run([
    { atMs: T0, events: [{ type: 'universe', symbols: [meta()] }], tick: false },
    spotBookReplayStep(T0 + 10, book(99.98, 100, T0 + 10)),
  ]);
  assert.equal(missing.engine.featureSnapshot(SYMBOL).basis.gapA.gapPct, null);
  assert.equal(missing.engine.featureSnapshot(SYMBOL).basis.gapA.causality.quadrant, 'UNKNOWN');
});

test('MIS-013 rejects stale evidence and cross-market source-clock reversal', () => {
  const stale = harness();
  seed(stale);
  stale.run([perpetualBookReplayStep(T0 + 1_000, book(101.5, 101.52, T0 + 1_000))]);
  assert.equal(stale.engine.featureSnapshot(SYMBOL).basis.gapA.causality.quadrant, 'RISING_PERPETUAL_LED');
  stale.clock.set(T0 + 7_000);
  assert.equal(stale.engine.featureSnapshot(SYMBOL).basis.gapA.causality.quadrant, 'UNKNOWN');

  const reversed = harness();
  seed(reversed);
  reversed.run([perpetualBookReplayStep(T0 + 1_000, book(101.5, 101.52, T0 + 1_000))]);
  reversed.run([spotBookReplayStep(T0 + 1_100, book(99.48, 99.5, T0 + 500))]);
  const causal = reversed.engine.featureSnapshot(SYMBOL).basis.gapA.causality;
  assert.equal(causal.quadrant, 'UNKNOWN');
  assert.equal(causal.initiatingSourceTs, null);
  assert.equal(causal.acceptedEventSequence, null);
});

test('MIS-013 cannot launder stale or over-skewed causal cuts through leg recovery', () => {
  const staleForward = harness();
  seed(staleForward);
  staleForward.run([
    perpetualBookReplayStep(T0 + 7_000, book(101.5, 101.52, T0 + 7_000), false),
    spotBookReplayStep(T0 + 7_100, book(99.98, 100, T0 + 7_100)),
  ]);
  const staleRecovered = staleForward.engine.featureSnapshot(SYMBOL);
  assert.equal(staleRecovered.basis.dq.legSkewMs, 100);
  assert.equal(staleRecovered.basis.gapA.causality.quadrant, 'UNKNOWN');
  assert.equal(staleRecovered.basis.gapA.causality.initiatingSourceTs, null);

  // A subsequent cut with usable before and after pairs may become the first
  // honest source; the rejected stale cut cannot leak into its lifecycle.
  staleForward.run([
    perpetualBookReplayStep(T0 + 7_200, book(101.7, 101.72, T0 + 7_200)),
  ]);
  const staleRestarted = staleForward.engine.featureSnapshot(SYMBOL).basis.gapA.causality;
  assert.equal(staleRestarted.quadrant, 'RISING_PERPETUAL_LED');
  assert.equal(staleRestarted.initiatingSourceTs, T0 + 7_200);

  const skewedReverse = harness();
  seed(
    skewedReverse,
    book(101, 101.02, T0 + 10),
    book(99.98, 100, T0 + 20),
    { borrow: true },
  );
  skewedReverse.run([
    spotBookReplayStep(T0 + 3_000, book(101.5, 101.52, T0 + 3_000), false),
    perpetualBookReplayStep(T0 + 3_100, book(99.98, 100, T0 + 3_100)),
  ]);
  const skewRecovered = skewedReverse.engine.featureSnapshot(SYMBOL);
  assert.equal(skewRecovered.basis.dq.legSkewMs, 100);
  assert.equal(skewRecovered.basis.gapB.causality.quadrant, 'UNKNOWN');
  assert.equal(skewRecovered.basis.gapB.causality.initiatingSourceTs, null);

  skewedReverse.run([
    spotBookReplayStep(T0 + 3_200, book(101.7, 101.72, T0 + 3_200)),
  ]);
  const skewRestarted = skewedReverse.engine.featureSnapshot(SYMBOL).basis.gapB.causality;
  assert.equal(skewRestarted.quadrant, 'RISING_SPOT_LED');
  assert.equal(skewRestarted.initiatingSourceTs, T0 + 3_200);
});

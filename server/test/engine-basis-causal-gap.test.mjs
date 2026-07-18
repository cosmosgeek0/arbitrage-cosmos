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
    minDataQuality: 0.1,
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

function ingestPair(h, spot, perpetual) {
  const result = h.engine.market.onBookPair(SYMBOL, spot, perpetual);
  h.engine.gaps.onBookIngest(result);
  return result;
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

test('MIS-013 validates changed legs against independent newer time and sequence watermarks', () => {
  const cases = [
    // T1 (seed) < T2 (changed) < T3 (already accepted unchanged). Sequence
    // still advances, so only the source-event clock proves the reversal.
    { sourceEventTimeMs: T0 + 800, sourceSequence: T0 + 1_000 },
    // Source-event time still advances, while the source sequence alone falls
    // between the T1 bootstrap and the newer T3 unchanged observation.
    { sourceEventTimeMs: T0 + 1_000, sourceSequence: T0 + 800 },
  ];
  for (const regressive of cases) {
    const h = harness();
    seed(h);

    h.clock.set(T0 + 1_000);
    h.engine.onBookPair(
      SYMBOL,
      book(99.98, 100, T0 + 1_000, T0 + 900, T0 + 900),
      book(101, 101.02, T0 + 1_000, T0 + 950, T0 + 950),
    );
    h.engine.tick();

    h.clock.set(T0 + 1_100);
    h.engine.onBookPair(
      SYMBOL,
      book(99.48, 99.5, T0 + 1_100, regressive.sourceEventTimeMs, regressive.sourceSequence),
      book(101, 101.02, T0 + 1_100, T0 + 1_050, T0 + 1_050),
    );
    h.engine.tick();
    const causal = h.engine.featureSnapshot(SYMBOL).basis.gapA.causality;
    assert.deepEqual(
      [causal.quadrant, causal.trend, causal.initiatingMarket,
        causal.initiatingSourceTs, causal.initiatingSourceSequence,
        causal.acceptedEventSequence],
      ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', null, null, null],
    );
    const proposal = h.engine.openProposals()[0];
    assert.ok(proposal, 'the canonical proposal remains visible with fail-closed causal evidence');
    assert.deepEqual(
      [proposal.evidence.causalQuadrant, proposal.evidence.gapTrend,
        proposal.evidence.initiatingMarket, proposal.evidence.initiatingSourceTs,
        proposal.evidence.initiatingSourceSequence, proposal.evidence.causalEventSequence],
      ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', null, null, null],
    );
  }

  const restarted = harness();
  seed(restarted);
  restarted.clock.set(T0 + 1_000);
  restarted.engine.onBookPair(
    SYMBOL,
    book(99.98, 100, T0 + 1_000, T0 + 900, T0 + 900),
    book(101, 101.02, T0 + 1_000, T0 + 950, T0 + 950),
  );
  restarted.engine.resetBookContinuity();
  restarted.clock.set(T0 + 1_100);
  restarted.engine.onBookPair(
    SYMBOL,
    book(99.98, 100, T0 + 1_100, T0 + 800, T0 + 800),
    book(101, 101.02, T0 + 1_100, T0 + 850, T0 + 850),
  );
  restarted.engine.tick();
  assert.equal(restarted.engine.featureSnapshot(SYMBOL).basis.gapA.causality.quadrant, 'UNKNOWN');
  restarted.clock.set(T0 + 1_200);
  restarted.engine.onSpotBook(book(99.48, 99.5, T0 + 1_200, T0 + 900, T0 + 900));
  restarted.engine.tick();
  assert.equal(restarted.engine.featureSnapshot(SYMBOL).basis.gapA.causality.quadrant, 'RISING_SPOT_LED');
});

test('MIS-013 preserves causality across exact unchanged opposite-leg time and sequence replays', () => {
  const cases = [
    {
      expected: ['RISING_SPOT_LED', 'SPOT', 'RISING'],
      spot: book(99.48, 99.5, T0 + 1_000, T0 + 900, T0 + 900),
      // The unchanged Perpetual event time is behind the Spot causal event,
      // but exactly equals its own accepted per-leg time watermark.
      perpetual: book(101, 101.02, T0 + 1_000, T0 + 800, T0 + 1_000),
    },
    {
      expected: ['RISING_PERPETUAL_LED', 'PERPETUAL', 'RISING'],
      // The unchanged Spot sequence is behind the Perpetual causal sequence,
      // but exactly equals its own accepted per-leg sequence watermark.
      spot: book(99.98, 100, T0 + 1_000, T0 + 1_000, T0 + 800),
      perpetual: book(101.5, 101.52, T0 + 1_000, T0 + 900, T0 + 900),
    },
  ];

  for (const row of cases) {
    const h = harness();
    seed(h);
    h.clock.set(T0 + 1_000);
    assert.equal(ingestPair(h, row.spot, row.perpetual)?.kind, 'ACCEPTED');
    h.engine.tick();
    assertProjected(h, ...row.expected);
    const acceptedCause = h.engine.featureSnapshot(SYMBOL).basis.gapA.causality;

    h.clock.set(T0 + 1_100);
    const replay = ingestPair(
      h,
      { ...row.spot, ts: T0 + 1_100 },
      { ...row.perpetual, ts: T0 + 1_100 },
    );
    assert.equal(replay, null, 'an exact unchanged per-leg replay is not a causal discontinuity');
    h.engine.tick();
    assertProjected(h, ...row.expected);
    const replayedCause = h.engine.featureSnapshot(SYMBOL).basis.gapA.causality;
    assert.equal(replayedCause.ageMs, acceptedCause.ageMs + 100);
    assert.deepEqual(
      { ...replayedCause, ageMs: acceptedCause.ageMs },
      acceptedCause,
      'an unchanged replay may age, but cannot erase or rewrite the accepted cause',
    );
  }
});

test('MIS-013 retains time and sequence watermarks across missing and invalid live-book clearing', () => {
  const breaks = ['MISSING', 'INVALID'];
  const regressions = [
    {
      reason: 'SOURCE_CLOCK_REVERSAL',
      first: { sourceEventTimeMs: T0 + 800, sourceSequence: T0 + 1_100 },
      second: { sourceEventTimeMs: T0 + 850, sourceSequence: T0 + 1_200 },
    },
    {
      reason: 'SOURCE_SEQUENCE_REVERSAL',
      first: { sourceEventTimeMs: T0 + 1_100, sourceSequence: T0 + 800 },
      second: { sourceEventTimeMs: T0 + 1_200, sourceSequence: T0 + 850 },
    },
  ];

  for (const breakKind of breaks) {
    for (const regression of regressions) {
      const h = harness();
      seed(h);

      h.clock.set(T0 + 1_000);
      assert.equal(ingestPair(
        h,
        book(99.98, 100, T0 + 1_000, T0 + 900, T0 + 900),
        book(101, 101.02, T0 + 1_000, T0 + 950, T0 + 950),
      ), null);
      h.engine.tick();

      h.clock.set(T0 + 1_100);
      const broken = breakKind === 'MISSING'
        ? ingestPair(
          h,
          null,
          book(101, 101.02, T0 + 1_100, T0 + 1_050, T0 + 1_050),
        )
        : ingestPair(
          h,
          book(101, 100, T0 + 1_100, T0 + 1_000, T0 + 1_000),
          book(101, 101.02, T0 + 1_100, T0 + 1_050, T0 + 1_050),
        );
      assert.equal(broken?.kind, 'DISCONTINUITY');
      assert.equal(broken?.reason, breakKind === 'MISSING' ? 'MISSING_PAIRED_LEG' : 'INVALID_OR_STALE_BOOK');
      h.engine.tick();
      assert.equal(h.engine.market.spotBook(SYMBOL), null);

      for (const [index, source] of [regression.first, regression.second].entries()) {
        h.clock.set(T0 + 1_200 + index * 100);
        const rejected = ingestPair(
          h,
          book(99.68 - index * 0.2, 99.7 - index * 0.2, T0 + 1_200 + index * 100, source.sourceEventTimeMs, source.sourceSequence),
          book(101, 101.02, T0 + 1_200 + index * 100, T0 + 1_150 + index * 100, T0 + 1_150 + index * 100),
        );
        assert.deepEqual(
          [rejected?.kind, rejected?.market, rejected?.reason],
          ['DISCONTINUITY', 'SPOT', regression.reason],
        );
        h.engine.tick();
        assert.equal(h.engine.market.spotBook(SYMBOL), null, 'rejected T2 never becomes a new live bootstrap');
        const causal = h.engine.featureSnapshot(SYMBOL).basis.gapA.causality;
        assert.deepEqual(
          [causal.quadrant, causal.trend, causal.initiatingMarket,
            causal.initiatingSourceTs, causal.initiatingSourceSequence,
            causal.acceptedEventSequence],
          ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', null, null, null],
        );
        assert.equal(h.engine.featureSnapshot(SYMBOL).basis.gapA.persistTicks, 0);
        assert.equal(h.engine.decisions(1)[0].evidence.gapCausalQuadrant, 'UNKNOWN');
        assert.equal(buildSnapshots(h.engine, h.sink).gapCausality(SYMBOL).gapA.quadrant, 'UNKNOWN');
      }
    }
  }
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

test('MIS-016 carries one causal lifecycle through growth and follower-confirmed decay', () => {
  const h = harness();
  seed(h);
  h.run([
    perpetualBookReplayStep(T0 + 1_000, book(101.5, 101.52, T0 + 1_000)),
    perpetualBookReplayStep(T0 + 1_500, book(101.7, 101.72, T0 + 1_500)),
    spotBookReplayStep(T0 + 2_000, book(100.18, 100.2, T0 + 2_000)),
  ]);

  const causal = h.engine.featureSnapshot(SYMBOL).basis.gapA.causality;
  assert.equal(causal.quadrant, 'RISING_PERPETUAL_LED');
  assert.equal(causal.source, 'PERPETUAL_BOOK');
  assert.equal(causal.initiatingSourceTs, T0 + 1_000);
  assert.equal(causal.initiatingSourceSequence, T0 + 1_000);
  assert.equal(causal.ageMs, 1_000);
  assert.equal(causal.persistenceEvents, 3);
  assert.equal(Number.isFinite(causal.slopePctPerMin), true);
  assert.equal(causal.evolution, 'DECAYING');
  assert.equal(causal.followerMarket, 'SPOT');
  assert.equal(causal.followerConfirmation, 'CONFIRMED');
  assert.equal(causal.followerSourceTs, T0 + 2_000);
  assert.equal(causal.followerSourceSequence, T0 + 2_000);
  assert.equal(causal.lastSourceTs, T0 + 2_000);
  assert.equal(causal.lastSourceSequence, T0 + 2_000);
  assert.equal(causal.lastAcceptedEventSequence > causal.acceptedEventSequence, true);

  const decision = h.engine.decisions(1)[0];
  const proposal = h.engine.proposals.open()[0];
  const snapshot = buildSnapshots(h.engine, h.sink).gapCausality(SYMBOL).gapA;
  assert.equal(decision.evidence.gapCausalSource, 'PERPETUAL_BOOK');
  assert.equal(decision.evidence.gapInitiatingPriceTrend, 'RISING');
  assert.equal(decision.evidence.gapFollowerConfirmation, 'CONFIRMED');
  assert.equal(decision.evidence.gapEvolution, 'DECAYING');
  assert.equal(Number.isFinite(decision.evidence.gapCausalSlopePctPerMin), true);
  assert.equal(proposal.evidence.causalSource, 'PERPETUAL_BOOK');
  assert.equal(proposal.evidence.initiatingPriceTrend, 'RISING');
  assert.equal(proposal.evidence.followerConfirmation, 'CONFIRMED');
  assert.equal(proposal.evidence.gapEvolution, 'DECAYING');
  assert.deepEqual(snapshot, causal);
});

test('MIS-016 resets source, age, persistence, and confirmation on a causal flip', () => {
  const h = harness();
  seed(h);
  h.run([perpetualBookReplayStep(T0 + 1_000, book(101.5, 101.52, T0 + 1_000))]);
  const rising = h.engine.featureSnapshot(SYMBOL).basis.gapA.causality;
  assert.equal(rising.quadrant, 'RISING_PERPETUAL_LED');

  h.run([perpetualBookReplayStep(T0 + 1_500, book(101.2, 101.22, T0 + 1_500))]);
  const flipped = h.engine.featureSnapshot(SYMBOL).basis.gapA.causality;
  assert.equal(flipped.quadrant, 'FALLING_PERPETUAL_LED');
  assert.equal(flipped.initiatingSourceTs, T0 + 1_500);
  assert.equal(flipped.ageMs, 0);
  assert.equal(flipped.persistenceEvents, 1);
  assert.equal(flipped.followerConfirmation, 'PENDING');
  assert.equal(flipped.followerSourceTs, null);
  assert.equal(flipped.acceptedEventSequence, flipped.lastAcceptedEventSequence);

  h.run([spotBookReplayStep(T0 + 1_600, book(99.48, 99.5, T0 + 900))]);
  const discontinuous = h.engine.featureSnapshot(SYMBOL).basis.gapA.causality;
  assert.equal(discontinuous.quadrant, 'UNKNOWN');
  assert.equal(discontinuous.persistenceEvents, 0);
  assert.equal(discontinuous.followerConfirmation, 'UNKNOWN');
});

test('MIS-016 resets stale, expired, missing, and fully-decayed causal lifecycles', () => {
  const stale = harness();
  seed(stale);
  stale.run([perpetualBookReplayStep(T0 + 1_000, book(101.5, 101.52, T0 + 1_000))]);
  stale.run([{ atMs: T0 + 7_000, events: [] }]);
  assert.equal(stale.engine.featureSnapshot(SYMBOL).basis.gapA.causality.quadrant, 'UNKNOWN');

  const expired = harness({ causalExpiryMs: 1_000, staleMs: 10_000, fundingStaleMs: 10_000, maxLegSkewMs: 10_000 });
  seed(expired);
  expired.run([perpetualBookReplayStep(T0 + 1_000, book(101.5, 101.52, T0 + 1_000))]);
  expired.run([perpetualBookReplayStep(T0 + 2_500, book(101.501, 101.521, T0 + 2_500))]);
  assert.equal(expired.engine.featureSnapshot(SYMBOL).basis.gapA.causality.quadrant, 'UNKNOWN');

  const missing = harness();
  seed(missing);
  missing.run([perpetualBookReplayStep(T0 + 1_000, book(101.5, 101.52, T0 + 1_000))]);
  missing.run([spotBookReplayStep(T0 + 1_500, book(Number.NaN, 100, T0 + 1_500))]);
  assert.equal(missing.engine.featureSnapshot(SYMBOL).basis.gapA.causality.quadrant, 'UNKNOWN');

  const decayed = harness();
  seed(decayed);
  decayed.run([perpetualBookReplayStep(T0 + 1_000, book(101.5, 101.52, T0 + 1_000))]);
  decayed.run([spotBookReplayStep(T0 + 2_000, book(100.48, 100.5, T0 + 2_000))]);
  assert.equal(decayed.engine.featureSnapshot(SYMBOL).basis.gapA.causality.quadrant, 'UNKNOWN');
  assert.equal(decayed.engine.featureSnapshot(SYMBOL).basis.gapA.causality.ageMs, null);
});

test('MIS-016 tracks reverse-gap growth and Perpetual follower confirmation', () => {
  const h = harness();
  seed(
    h,
    book(101, 101.02, T0 + 10),
    book(99.98, 100, T0 + 20),
    { borrow: true },
  );
  h.run([
    spotBookReplayStep(T0 + 1_000, book(101.5, 101.52, T0 + 1_000)),
    spotBookReplayStep(T0 + 1_500, book(101.7, 101.72, T0 + 1_500)),
    perpetualBookReplayStep(T0 + 2_000, book(100.18, 100.2, T0 + 2_000)),
  ]);

  const causal = h.engine.featureSnapshot(SYMBOL).basis.gapB.causality;
  assert.equal(causal.quadrant, 'RISING_SPOT_LED');
  assert.equal(causal.source, 'SPOT_BOOK');
  assert.equal(causal.persistenceEvents, 3);
  assert.equal(Number.isFinite(causal.slopePctPerMin), true);
  assert.equal(causal.evolution, 'DECAYING');
  assert.equal(causal.followerMarket, 'PERPETUAL');
  assert.equal(causal.followerConfirmation, 'CONFIRMED');
  assert.equal(causal.followerSourceTs, T0 + 2_000);
  assert.equal(h.engine.decisions(1)[0].evidence.gapFollowerConfirmation, 'CONFIRMED');
  assert.equal(h.engine.proposals.open()[0].evidence.followerConfirmation, 'CONFIRMED');
});

test('MIS-016 cumulative micro-decay updates then fully resolves both executable gaps', () => {
  const forward = harness();
  seed(forward);
  forward.run([perpetualBookReplayStep(T0 + 1_000, book(101.2, 101.22, T0 + 1_000))]);
  const forwardSteps = Array.from({ length: 51 }, (_, index) => {
    const eventNumber = index + 1;
    const gapPct = 1.2 - 0.004 * eventNumber;
    const ask = 101.2 / (1 + gapPct / 100);
    return spotBookReplayStep(
      T0 + 1_000 + eventNumber * 10,
      book(ask - 0.01, ask, T0 + 1_000 + eventNumber * 10),
      false,
    );
  });
  forward.run([forwardSteps[0]]);
  const forwardConfirmed = forward.engine.featureSnapshot(SYMBOL).basis.gapA.causality;
  assert.equal(forwardConfirmed.followerConfirmation, 'CONFIRMED');
  assert.equal(forwardConfirmed.persistenceEvents, 2);
  assert.equal(forwardConfirmed.lastSourceTs, T0 + 1_010);
  forwardSteps[forwardSteps.length - 1].tick = true;
  forward.run(forwardSteps.slice(1));
  assert.equal(forward.engine.featureSnapshot(SYMBOL).basis.gapA.gapPct > forward.engine.cfg.watchGapPct, true);
  assert.equal(forward.engine.featureSnapshot(SYMBOL).basis.gapA.causality.quadrant, 'UNKNOWN');

  const reverse = harness();
  seed(
    reverse,
    book(101, 101.02, T0 + 10),
    book(99.98, 100, T0 + 20),
    { borrow: true },
  );
  reverse.run([spotBookReplayStep(T0 + 1_000, book(101.2, 101.22, T0 + 1_000))]);
  const reverseSteps = Array.from({ length: 51 }, (_, index) => {
    const eventNumber = index + 1;
    const gapPct = 1.2 - 0.004 * eventNumber;
    const ask = 101.2 / (1 + gapPct / 100);
    return perpetualBookReplayStep(
      T0 + 1_000 + eventNumber * 10,
      book(ask - 0.01, ask, T0 + 1_000 + eventNumber * 10),
      false,
    );
  });
  reverse.run([reverseSteps[0]]);
  const reverseConfirmed = reverse.engine.featureSnapshot(SYMBOL).basis.gapB.causality;
  assert.equal(reverseConfirmed.followerConfirmation, 'CONFIRMED');
  assert.equal(reverseConfirmed.persistenceEvents, 2);
  assert.equal(reverseConfirmed.lastSourceTs, T0 + 1_010);
  reverseSteps[reverseSteps.length - 1].tick = true;
  reverse.run(reverseSteps.slice(1));
  assert.equal(reverse.engine.featureSnapshot(SYMBOL).basis.gapB.gapPct > reverse.engine.cfg.watchGapPct, true);
  assert.equal(reverse.engine.featureSnapshot(SYMBOL).basis.gapB.causality.quadrant, 'UNKNOWN');
});

test('MIS-016 asymmetric quotes cannot manufacture follower confirmation in either direction', () => {
  const forward = harness();
  seed(
    forward,
    book(99.8, 100, T0 + 10),
    book(101, 101.02, T0 + 20),
  );
  forward.run([perpetualBookReplayStep(T0 + 1_000, book(101.2, 101.22, T0 + 1_000))]);
  forward.run([spotBookReplayStep(T0 + 2_000, book(99.98, 99.99, T0 + 2_000))]);
  const forwardCausal = forward.engine.featureSnapshot(SYMBOL).basis.gapA.causality;
  assert.equal(forwardCausal.quadrant, 'RISING_SPOT_LED');
  assert.equal(forwardCausal.followerConfirmation, 'PENDING');
  assert.equal(forwardCausal.initiatingPriceTrend, 'FALLING');

  const reverse = harness();
  seed(
    reverse,
    book(101, 101.02, T0 + 10),
    book(99.8, 100, T0 + 20),
    { borrow: true },
  );
  reverse.run([spotBookReplayStep(T0 + 1_000, book(101.2, 101.22, T0 + 1_000))]);
  reverse.run([perpetualBookReplayStep(T0 + 2_000, book(99.98, 99.99, T0 + 2_000))]);
  const reverseCausal = reverse.engine.featureSnapshot(SYMBOL).basis.gapB.causality;
  assert.equal(reverseCausal.quadrant, 'RISING_PERPETUAL_LED');
  assert.equal(reverseCausal.followerConfirmation, 'PENDING');
  assert.equal(reverseCausal.initiatingPriceTrend, 'FALLING');
});

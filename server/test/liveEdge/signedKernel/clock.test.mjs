import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BINANCE_CLOCK_ACCEPTED_MATRIX_SHA256,
  BINANCE_CLOCK_POLICY_V1,
  decideBinanceSigningClock,
  estimateBinanceClock,
} from '../../../dist/liveEdge/adapters/binanceSignedKernel/clock.js';

const UTC_ORIGIN_MS = 1_700_000_000_000;

function clockSample(index, overrides = {}) {
  const product = overrides.product ?? 'SPOT';
  const environment = overrides.environment ?? 'PRODUCTION';
  const monotonicSendMs = overrides.monotonicSendMs ?? 1_000 + (index * 3_000);
  const rttMs = overrides.rttMs ?? 100;
  const monotonicReceiveMs = overrides.monotonicReceiveMs ?? monotonicSendMs + rttMs;
  const anchorShiftMs = overrides.anchorShiftMs ?? 0;
  const utcRttMs = overrides.utcRttMs ?? rttMs;
  const utcSendEpochMs = overrides.utcSendEpochMs
    ?? UTC_ORIGIN_MS + monotonicSendMs + anchorShiftMs;
  const utcReceiveEpochMs = overrides.utcReceiveEpochMs ?? utcSendEpochMs + utcRttMs;
  const offsetMs = overrides.offsetMs ?? 25;
  const serverEpochMs = overrides.serverEpochMs
    ?? Math.round(((utcSendEpochMs + utcReceiveEpochMs) / 2) + offsetMs);
  assert.ok(Number.isSafeInteger(serverEpochMs), 'fixture server epoch must be an integer');
  return {
    product,
    environment,
    utcSendEpochMs,
    utcReceiveEpochMs,
    monotonicSendMs,
    monotonicReceiveMs,
    serverEpochMs,
  };
}

function clockSeries(count, overrides = {}) {
  return Array.from({ length: count }, (_, index) => clockSample(index, overrides));
}

function newestReceive(samples) {
  return Math.max(...samples.map((sample) => sample.monotonicReceiveMs));
}

function expectFailure(result, code) {
  assert.deepEqual(result, { ok: false, failure: { code } });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.failure));
}

function freshEstimate(product = 'SPOT', overrides = {}) {
  const samples = clockSeries(3, { product, ...overrides });
  const result = estimateBinanceClock(samples, newestReceive(samples));
  assert.equal(result.ok, true);
  assert.equal(result.value.state, 'FRESH');
  return result.value;
}

test('V1 clock policy pins the reviewed bounded lane limits', () => {
  assert.equal(
    BINANCE_CLOCK_ACCEPTED_MATRIX_SHA256,
    '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac',
  );
  assert.deepEqual(BINANCE_CLOCK_POLICY_V1, {
    minimumAcceptedSamples: 3,
    maximumSamples: 9,
    maximumRttMs: 2_000,
    maximumAnchorDriftMs: 50,
    outlierDeviationMs: 250,
    maximumFreshDeviationMs: 100,
    maximumSampleAgeMs: 30_000,
    recvWindowPolicyCapMs: 5_000,
  });
  assert.ok(Object.isFrozen(BINANCE_CLOCK_POLICY_V1));
});

test('three through nine scoped samples produce a fresh UTC-anchored median', () => {
  for (const count of [3, 4, 9]) {
    const samples = clockSeries(count);
    const result = estimateBinanceClock(samples, newestReceive(samples));
    assert.equal(result.ok, true);
    assert.equal(result.value.state, 'FRESH');
    assert.equal(result.value.product, 'SPOT');
    assert.equal(result.value.environment, 'PRODUCTION');
    assert.equal(result.value.serverTimeContractId, 'SPOT_SERVER_TIME');
    assert.equal(result.value.acceptedSampleCount, count);
    assert.equal(result.value.offsetMs, 25);
    assert.equal(result.value.maximumAcceptedRttMs, 100);
    assert.equal(result.value.maximumOffsetDeviationMs, 0);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.value));
  }
});

test('sample-count, duplicate, scope, and server-time contract gates fail closed', () => {
  expectFailure(estimateBinanceClock(clockSeries(2), 10_000), 'CLOCK_SAMPLE_COUNT_INVALID');
  expectFailure(estimateBinanceClock(clockSeries(10), 40_000), 'CLOCK_SAMPLE_COUNT_INVALID');

  const duplicate = clockSeries(3);
  duplicate[2] = { ...duplicate[1] };
  expectFailure(estimateBinanceClock(duplicate, newestReceive(duplicate)), 'CLOCK_DUPLICATE_SAMPLE');

  const mixedProduct = clockSeries(3);
  mixedProduct[2] = { ...mixedProduct[2], product: 'USD_M_PERPETUAL' };
  expectFailure(estimateBinanceClock(mixedProduct, newestReceive(mixedProduct)), 'CLOCK_SCOPE_MISMATCH');

  const mixedEnvironment = clockSeries(3);
  mixedEnvironment[2] = { ...mixedEnvironment[2], environment: 'TESTNET' };
  expectFailure(estimateBinanceClock(mixedEnvironment, newestReceive(mixedEnvironment)), 'CLOCK_SCOPE_MISMATCH');

  const unregisteredServerTimeScope = clockSeries(3, { environment: 'TESTNET' });
  expectFailure(
    estimateBinanceClock(unregisteredServerTimeScope, newestReceive(unregisteredServerTimeScope)),
    'CLOCK_CONTRACT_UNAVAILABLE',
  );
});

test('RTT exact boundary is accepted while over-bound evidence is explicitly rejected', () => {
  const exact = clockSeries(3, { rttMs: 2_000 });
  const exactResult = estimateBinanceClock(exact, newestReceive(exact));
  assert.equal(exactResult.ok, true);
  assert.equal(exactResult.value.state, 'FRESH');
  assert.equal(exactResult.value.maximumAcceptedRttMs, 2_000);

  const withRejected = [
    ...clockSeries(3),
    clockSample(3, { rttMs: 2_001 }),
  ];
  const rejectedResult = estimateBinanceClock(withRejected, newestReceive(withRejected));
  assert.equal(rejectedResult.ok, true);
  assert.equal(rejectedResult.value.state, 'FRESH');
  assert.equal(rejectedResult.value.acceptedSampleCount, 3);
  assert.equal(rejectedResult.value.rejectedRttCount, 1);

  const unavailable = clockSeries(3, { rttMs: 2_001 });
  const unavailableResult = estimateBinanceClock(unavailable, newestReceive(unavailable));
  assert.equal(unavailableResult.ok, true);
  assert.equal(unavailableResult.value.state, 'UNAVAILABLE');
  assert.equal(unavailableResult.value.offsetMs, null);
  assert.equal(unavailableResult.value.maximumAcceptedRttMs, null);
  assert.equal(unavailableResult.value.acceptedSampleCount, 0);
  assert.equal(unavailableResult.value.rejectedRttCount, 3);
});

test('UTC versus monotonic interval and cross-sample anchor drift are bounded', () => {
  const exact = clockSeries(3, { rttMs: 100, utcRttMs: 150, offsetMs: 25 });
  const exactResult = estimateBinanceClock(exact, newestReceive(exact));
  assert.equal(exactResult.ok, true);
  assert.equal(exactResult.value.state, 'FRESH');
  assert.equal(exactResult.value.rejectedAnchorDriftCount, 0);

  const over = clockSeries(3, { rttMs: 100, utcRttMs: 151, offsetMs: 25.5 });
  const overResult = estimateBinanceClock(over, newestReceive(over));
  assert.equal(overResult.ok, true);
  assert.equal(overResult.value.state, 'UNAVAILABLE');
  assert.equal(overResult.value.offsetMs, null);
  assert.equal(overResult.value.rejectedAnchorDriftCount, 3);

  const shifted = [...clockSeries(3), clockSample(3, { anchorShiftMs: 51 })];
  const shiftedResult = estimateBinanceClock(shifted, newestReceive(shifted));
  assert.equal(shiftedResult.ok, true);
  assert.equal(shiftedResult.value.state, 'FRESH');
  assert.equal(shiftedResult.value.acceptedSampleCount, 3);
  assert.equal(shiftedResult.value.rejectedAnchorDriftCount, 1);
});

test('median is input-order independent and preserves half/quarter millisecond evidence', () => {
  const samples = [
    clockSample(0, { offsetMs: 0 }),
    clockSample(1, { offsetMs: 10 }),
    clockSample(2, { offsetMs: 20 }),
    clockSample(3, { offsetMs: 31 }),
  ];
  const forward = estimateBinanceClock(samples, newestReceive(samples));
  const reverse = estimateBinanceClock([...samples].reverse(), newestReceive(samples));
  assert.equal(forward.ok, true);
  assert.equal(reverse.ok, true);
  assert.equal(forward.value.offsetMs, 15);
  assert.deepEqual(reverse, forward);

  const halfSamples = [0, 1, 2].map((index) => clockSample(index, {
    rttMs: 1,
    utcRttMs: 1,
    offsetMs: 0.5,
  }));
  const half = estimateBinanceClock(halfSamples, newestReceive(halfSamples));
  assert.equal(half.ok, true);
  assert.equal(half.value.offsetMs, 0.5);

  const quarterSamples = [
    clockSample(0, { offsetMs: 0 }),
    clockSample(1, { rttMs: 1, utcRttMs: 1, offsetMs: 0.5 }),
    clockSample(2, { offsetMs: 0 }),
    clockSample(3, { rttMs: 1, utcRttMs: 1, offsetMs: 0.5 }),
  ];
  const quarter = estimateBinanceClock(quarterSamples, newestReceive(quarterSamples));
  assert.equal(quarter.ok, true);
  assert.equal(quarter.value.offsetMs, 0.25);
});

test('offset rejection and fresh-dispersion boundaries are distinct and fail closed', () => {
  const exactFreshDeviation = [
    clockSample(0, { offsetMs: 0 }),
    clockSample(1, { offsetMs: 0 }),
    clockSample(2, { offsetMs: 100 }),
  ];
  const exactFresh = estimateBinanceClock(
    exactFreshDeviation,
    newestReceive(exactFreshDeviation),
  );
  assert.equal(exactFresh.ok, true);
  assert.equal(exactFresh.value.state, 'FRESH');
  assert.equal(exactFresh.value.maximumOffsetDeviationMs, 100);

  const skewedDeviation = [
    clockSample(0, { offsetMs: 0 }),
    clockSample(1, { offsetMs: 0 }),
    clockSample(2, { offsetMs: 101 }),
  ];
  const skewed = estimateBinanceClock(skewedDeviation, newestReceive(skewedDeviation));
  assert.equal(skewed.ok, true);
  assert.equal(skewed.value.state, 'CLOCK_SKEWED');
  assert.equal(skewed.value.acceptedSampleCount, 3);
  assert.equal(skewed.value.rejectedOutlierCount, 0);
  assert.equal(skewed.value.maximumOffsetDeviationMs, 101);
  assert.equal(skewed.value.offsetMs, null);
  assert.equal(skewed.value.referenceUtcEpochMs, null);
  expectFailure(
    decideBinanceSigningClock(
      'SPOT_ACCOUNT_BALANCES',
      skewed.value,
      skewed.value.estimatedAtMonotonicMs,
    ),
    'CLOCK_EVIDENCE_SKEWED',
  );

  const exactDeviation = [
    clockSample(0, { offsetMs: 0 }),
    clockSample(1, { offsetMs: 0 }),
    clockSample(2, { offsetMs: 250 }),
  ];
  const exact = estimateBinanceClock(exactDeviation, newestReceive(exactDeviation));
  assert.equal(exact.ok, true);
  assert.equal(exact.value.state, 'CLOCK_SKEWED');
  assert.equal(exact.value.acceptedSampleCount, 3);
  assert.equal(exact.value.rejectedOutlierCount, 0);
  assert.equal(exact.value.maximumOffsetDeviationMs, 250);

  const overDeviation = [
    clockSample(0, { offsetMs: 0 }),
    clockSample(1, { offsetMs: 0 }),
    clockSample(2, { offsetMs: 251 }),
  ];
  const over = estimateBinanceClock(overDeviation, newestReceive(overDeviation));
  assert.equal(over.ok, true);
  assert.equal(over.value.state, 'UNAVAILABLE');
  assert.equal(over.value.offsetMs, null);
  assert.equal(over.value.acceptedSampleCount, 2);
  assert.equal(over.value.rejectedOutlierCount, 1);

  const samples = clockSeries(3);
  const newest = newestReceive(samples);
  const fresh = estimateBinanceClock(samples, newest + 30_000);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.value.state, 'FRESH');
  const stale = estimateBinanceClock(samples, newest + 30_001);
  assert.equal(stale.ok, true);
  assert.equal(stale.value.state, 'STALE');
  assert.equal(stale.value.offsetMs, null);
  assert.equal(stale.value.referenceUtcEpochMs, null);
});

test('hostile arrays, accessors, inheritance, proxies, and clock regression never execute values', () => {
  const valid = clockSeries(3);
  expectFailure(estimateBinanceClock({ 0: valid[0], 1: valid[1], 2: valid[2], length: 3 }, 10_000), 'CLOCK_INPUT_INVALID');
  const sparse = new Array(3);
  sparse[0] = valid[0];
  sparse[2] = valid[2];
  expectFailure(estimateBinanceClock(sparse, 10_000), 'CLOCK_INPUT_INVALID');

  const inherited = Object.create(valid[0]);
  expectFailure(estimateBinanceClock([inherited, valid[1], valid[2]], 10_000), 'CLOCK_SAMPLE_INVALID');

  let getterTrips = 0;
  const accessor = { ...valid[0] };
  Object.defineProperty(accessor, 'serverEpochMs', {
    enumerable: true,
    get() {
      getterTrips += 1;
      return 1;
    },
  });
  expectFailure(estimateBinanceClock([accessor, valid[1], valid[2]], 10_000), 'CLOCK_SAMPLE_INVALID');
  assert.equal(getterTrips, 0);

  let proxyTrips = 0;
  const proxied = new Proxy(valid[0], {
    get() {
      proxyTrips += 1;
      throw new Error('must not execute');
    },
  });
  expectFailure(estimateBinanceClock([proxied, valid[1], valid[2]], 10_000), 'CLOCK_SAMPLE_INVALID');
  assert.equal(proxyTrips, 0);

  const revoked = Proxy.revocable(valid, {});
  revoked.revoke();
  expectFailure(estimateBinanceClock(revoked.proxy, 10_000), 'CLOCK_INPUT_INVALID');

  const future = clockSeries(3);
  expectFailure(
    estimateBinanceClock(future, newestReceive(future) - 1),
    'CLOCK_MONOTONIC_REGRESSION',
  );
  const utcRegression = clockSeries(3);
  utcRegression[1] = {
    ...utcRegression[1],
    utcReceiveEpochMs: utcRegression[1].utcSendEpochMs - 1,
  };
  expectFailure(estimateBinanceClock(utcRegression, newestReceive(utcRegression)), 'CLOCK_SAMPLE_INVALID');
});

test('Spot and USD-M decisions bind exact current L02 signed REST contracts', () => {
  const spotEstimate = freshEstimate('SPOT');
  const spot = decideBinanceSigningClock(
    'SPOT_ACCOUNT_BALANCES',
    spotEstimate,
    spotEstimate.estimatedAtMonotonicMs + 100,
  );
  assert.equal(spot.ok, true);
  assert.deepEqual(spot.value, {
    state: 'READY',
    product: 'SPOT',
    environment: 'PRODUCTION',
    signedContractId: 'SPOT_ACCOUNT_BALANCES',
    serverTimeContractId: 'SPOT_SERVER_TIME',
    timestampMs: '1700000007225',
    recvWindowMs: 5_000,
    decidedAtMonotonicMs: 7_200,
    expiresAtMonotonicMs: 37_100,
    evidenceAgeMs: 100,
    acceptedSampleCount: 3,
    maximumAcceptedRttMs: 100,
    maximumOffsetDeviationMs: 0,
  });
  assert.match(spot.value.timestampMs, /^(0|[1-9][0-9]*)$/);
  assert.ok(Number.isSafeInteger(spot.value.recvWindowMs));
  assert.ok(spot.value.recvWindowMs <= BINANCE_CLOCK_POLICY_V1.recvWindowPolicyCapMs);
  assert.ok(Object.isFrozen(spot));
  assert.ok(Object.isFrozen(spot.value));

  const usdmEstimate = freshEstimate('USD_M_PERPETUAL');
  const usdm = decideBinanceSigningClock(
    'USDM_ACCOUNT_V3',
    usdmEstimate,
    usdmEstimate.estimatedAtMonotonicMs,
  );
  assert.equal(usdm.ok, true);
  assert.equal(usdm.value.product, 'USD_M_PERPETUAL');
  assert.equal(usdm.value.serverTimeContractId, 'USDM_SERVER_TIME');
  assert.equal(usdm.value.recvWindowMs, 5_000);
});

test('decision floors fractional evidence to integer milliseconds and rechecks freshness', () => {
  const samples = [0, 1, 2].map((index) => clockSample(index, {
    rttMs: 1,
    utcRttMs: 1,
    offsetMs: 0.5,
  }));
  const estimateResult = estimateBinanceClock(samples, newestReceive(samples));
  assert.equal(estimateResult.ok, true);
  assert.equal(estimateResult.value.offsetMs, 0.5);
  const estimate = estimateResult.value;
  const ready = decideBinanceSigningClock(
    'SPOT_ACCOUNT_BALANCES',
    estimate,
    estimate.estimatedAtMonotonicMs,
  );
  assert.equal(ready.ok, true);
  assert.equal(Number.isSafeInteger(Number(ready.value.timestampMs)), true);
  assert.equal(ready.value.timestampMs, String(Math.floor(
    estimate.referenceUtcEpochMs + estimate.offsetMs,
  )));

  expectFailure(
    decideBinanceSigningClock(
      'SPOT_ACCOUNT_BALANCES',
      estimate,
      estimate.estimatedAtMonotonicMs - 1,
    ),
    'CLOCK_MONOTONIC_REGRESSION',
  );
  expectFailure(
    decideBinanceSigningClock(
      'SPOT_ACCOUNT_BALANCES',
      estimate,
      estimate.newestReceiveMonotonicMs + 30_001,
    ),
    'CLOCK_EVIDENCE_STALE',
  );
  const exactExpiry = decideBinanceSigningClock(
    'SPOT_ACCOUNT_BALANCES',
    estimate,
    estimate.newestReceiveMonotonicMs + 30_000,
  );
  assert.equal(exactExpiry.ok, true);
  assert.equal(exactExpiry.value.decidedAtMonotonicMs, exactExpiry.value.expiresAtMonotonicMs);
});

test('public, WebSocket, unknown-signing Margin, non-current, and cross-scope contracts are blocked', () => {
  const spot = freshEstimate('SPOT');
  for (const contractId of [
    'SPOT_SERVER_TIME',
    'SPOT_WS_API_USER_DATA_SIGNATURE',
    'SPOT_REST_USER_DATA_STREAM_POST_REMOVED',
    'NO_SUCH_CONTRACT',
  ]) {
    expectFailure(
      decideBinanceSigningClock(contractId, spot, spot.estimatedAtMonotonicMs),
      'CLOCK_CONTRACT_UNAVAILABLE',
    );
  }
  expectFailure(
    decideBinanceSigningClock('USDM_ACCOUNT_V3', spot, spot.estimatedAtMonotonicMs),
    'CLOCK_CONTRACT_UNAVAILABLE',
  );

  const margin = freshEstimate('MARGIN');
  expectFailure(
    decideBinanceSigningClock(
      'MARGIN_CROSS_ACCOUNT_BALANCES',
      margin,
      margin.estimatedAtMonotonicMs,
    ),
    'CLOCK_CONTRACT_UNAVAILABLE',
  );
});

test('decision validates closed estimate data and maps unavailable/stale evidence safely', () => {
  const fresh = freshEstimate();
  const extra = { ...fresh, invented: 0 };
  expectFailure(
    decideBinanceSigningClock('SPOT_ACCOUNT_BALANCES', extra, fresh.estimatedAtMonotonicMs),
    'CLOCK_INPUT_INVALID',
  );

  let getterTrips = 0;
  const accessor = { ...fresh };
  Object.defineProperty(accessor, 'offsetMs', {
    enumerable: true,
    get() {
      getterTrips += 1;
      return 0;
    },
  });
  expectFailure(
    decideBinanceSigningClock('SPOT_ACCOUNT_BALANCES', accessor, fresh.estimatedAtMonotonicMs),
    'CLOCK_INPUT_INVALID',
  );
  assert.equal(getterTrips, 0);

  const revoked = Proxy.revocable(fresh, {});
  revoked.revoke();
  expectFailure(
    decideBinanceSigningClock('SPOT_ACCOUNT_BALANCES', revoked.proxy, fresh.estimatedAtMonotonicMs),
    'CLOCK_INPUT_INVALID',
  );

  const highRtt = clockSeries(3, { rttMs: 2_001 });
  const unavailable = estimateBinanceClock(highRtt, newestReceive(highRtt));
  assert.equal(unavailable.ok, true);
  expectFailure(
    decideBinanceSigningClock(
      'SPOT_ACCOUNT_BALANCES',
      unavailable.value,
      unavailable.value.estimatedAtMonotonicMs,
    ),
    'CLOCK_EVIDENCE_UNAVAILABLE',
  );

  const staleSamples = clockSeries(3);
  const stale = estimateBinanceClock(staleSamples, newestReceive(staleSamples) + 30_001);
  assert.equal(stale.ok, true);
  expectFailure(
    decideBinanceSigningClock(
      'SPOT_ACCOUNT_BALANCES',
      stale.value,
      stale.value.estimatedAtMonotonicMs,
    ),
    'CLOCK_EVIDENCE_STALE',
  );
});

test('clock implementation has no ambient clock, timer, transport, filesystem, env, or random access', () => {
  const source = readFileSync(
    new URL('../../../src/liveEdge/adapters/binanceSignedKernel/clock.ts', import.meta.url),
    'utf8',
  );
  for (const forbidden of [
    /\bDate\s*\./,
    /\bDate\s*\(/,
    /\bperformance\b/,
    /\bprocess\s*\.\s*env\b/,
    /\bsetTimeout\b/,
    /\bsetInterval\b/,
    /\bMath\s*\.\s*random\b/,
    /from\s+['"]node:(?:fs|net|tls|http|https|dgram|child_process)['"]/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

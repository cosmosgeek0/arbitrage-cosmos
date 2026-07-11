import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessCapitalTruth,
  deriveCapitalConfigRevision,
  deriveOpportunityConsiderationId,
} from '../../../dist/capitalFoundation/contracts/index.js';
import {
  EMPTY_RESERVATION_BOOK,
  allocateCapital,
  reduceReservationBook,
  validateAllocationCandidate,
} from '../../../dist/capitalFoundation/allocation/index.js';

const NOW = 1_800_000_000_000;
const bound = (value) => ({ value, minimum: '0', maximum: '1000000', unit: 'USDT' });
const integerBound = (value, maximum, unit = 'count') => ({ value, minimum: 0, maximum, unit });

function truth(overrides = {}) {
  return assessCapitalTruth({
    source: {
      sourceTimeMs: NOW - 10, receivedAtMs: NOW - 5, maxAgeMs: 1_000,
      authority: 'SYNTHETIC_TEST', completeness: 'COMPLETE', sourceId: 'allocation-test',
    },
    evaluatedAtMs: NOW,
    requiredValuePresent: true,
    ...overrides,
  });
}

function reservationTruth(evaluatedAtMs = NOW) {
  return assessCapitalTruth({
    source: {
      sourceTimeMs: evaluatedAtMs - 10, receivedAtMs: evaluatedAtMs - 5, maxAgeMs: 100_000,
      authority: 'SYNTHETIC_TEST', completeness: 'COMPLETE', sourceId: 'reservation-authority-test',
    },
    evaluatedAtMs,
    requiredValuePresent: true,
    revision: `truth-${evaluatedAtMs}`,
  });
}

function policy(overrides = {}) {
  return {
    authority: {
      revision: deriveCapitalConfigRevision('allocation-test', { revision: 1 }),
      sourceId: 'allocation-policy', issuedAtMs: NOW - 2_000,
      effectiveFromMs: NOW - 1_000, effectiveUntilMs: NOW + 100_000,
    },
    valuationAsset: 'USDT',
    portfolioGrossLimit: bound('1000'), portfolioNetLimit: bound('400'),
    perStrategyLimits: { BASIS: bound('800'), VOLUME: bound('200') },
    perSymbolLimit: bound('500'), perCorrelatedGroupLimit: bound('600'),
    perVenueInstrumentLimit: bound('500'), riskReductionReserve: bound('100'),
    maximumConcurrentPlans: integerBound(10, 20), maximumActivePositions: integerBound(10, 20),
    reservationTtlMs: integerBound(10_000, 60_000, 'ms'),
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    valuationAsset: 'USDT', truth: truth(),
    entryCollateralAvailable: '500', protectedRiskReductionReserve: '100', marginHeadroomAvailable: '500',
    grossExposureAndCommitments: '0', netDirectionalExposure: '0',
    strategyUse: [], symbolUse: [], correlatedGroupUse: [], venueInstrumentUse: [],
    currentConcurrentPlans: 0, currentActivePositions: 0,
    borrowCapacityByAsset: [{ key: 'BTC', amount: '500' }],
    liquidityCapacityByKey: [{ key: 'BTC:SPOT', amount: '500' }, { key: 'ETH:SPOT', amount: '500' }],
    commitmentCoverage: {
      orders: 'COMPLETE', reservations: 'COMPLETE', plans: 'COMPLETE',
      partiallyExposedPositions: 'COMPLETE', activePositions: 'COMPLETE',
    },
    commitments: [],
    ...overrides,
  };
}

function candidate(key, amount = '80', overrides = {}) {
  const symbol = overrides.primarySymbol ?? (key.includes('eth') ? 'ETHUSDT' : 'BTCUSDT');
  return {
    considerationId: deriveOpportunityConsiderationId({ key }),
    eligibilityStatus: 'ELIGIBLE', considerationMode: 'MANUAL_ARMED', truth: truth(),
    strategy: 'BASIS', valuationAsset: 'USDT', primarySymbol: symbol, economicDirection: 'HEDGED',
    requestedAmount: amount, grossExposureIncrease: amount, netDirectionalExposureDelta: '0',
    collateralRequired: amount, marginRequired: amount,
    strategyRequirements: [{ key: 'BASIS', amount }],
    symbolRequirements: [{ key: symbol, amount }],
    correlatedGroupRequirements: [{ key: symbol.startsWith('ETH') ? 'ETH' : 'BTC', amount }],
    venueInstrumentRequirements: [{ key: `BINANCE:${symbol}:PAIR`, amount }],
    borrowRequired: false, borrowRequirements: [],
    liquidityRequirements: [{ key: symbol.startsWith('ETH') ? 'ETH:SPOT' : 'BTC:SPOT', amount }],
    opensNewPlan: true, opensNewActivePosition: false, conflictingConsiderationIds: [],
    priority: { policyClass: 1, stableKey: key },
    ...overrides,
  };
}

function run(candidates, snapshotOverrides = {}, policyOverrides = {}) {
  return allocateCapital({ policy: policy(policyOverrides), snapshot: snapshot(snapshotOverrides), candidates, nowMs: NOW });
}

test('scarce collateral grants priority first and leaves a complete requested-to-capped audit', () => {
  const high = candidate('high', '80', { priority: { policyClass: 2, stableKey: 'high' } });
  const low = candidate('eth-low', '80', { priority: { policyClass: 1, stableKey: 'low' } });
  const result = run([low, high], { entryCollateralAvailable: '100' });
  assert.deepEqual(result.decisions.map((d) => [d.considerationId, d.status, d.grantedAmount]), [
    [high.considerationId, 'GRANTED', '80'], [low.considerationId, 'CAPPED', '20'],
  ]);
  assert.equal(result.remainder.entryCollateralAvailable, '0');
  assert.ok(result.decisions[1].audit.some((step) => step.code === 'ENTRY_COLLATERAL' && step.before === '80' && step.after === '20'));
});

test('tie break and byte-equivalent decisions do not depend on input order', () => {
  const a = candidate('a', '70');
  const b = candidate('eth-b', '70');
  const first = run([a, b], { entryCollateralAvailable: '100' });
  const second = run([b, a], { entryCollateralAvailable: '100' });
  assert.deepEqual(first, second);
  assert.deepEqual(first.decisions.map((d) => d.grantedAmount), ['70', '30']);
});

test('duplicate consideration cannot double allocate even when replayed in one batch', () => {
  const same = candidate('same');
  const result = run([same, { ...same }]);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].status, 'BLOCKED');
  assert.ok(result.decisions[0].blockingReasons.includes('DUPLICATE_CONSIDERATION_ID'));
});

test('divergent duplicate consideration payloads block deterministically under input permutation', () => {
  const first = candidate('same-divergent', '80');
  const second = { ...first, requestedAmount: '70', grossExposureIncrease: '70', collateralRequired: '70', marginRequired: '70' };
  assert.deepEqual(run([first, second]), run([second, first]));
  assert.equal(run([first, second]).decisions[0].status, 'BLOCKED');
  assert.ok(run([first, second]).decisions[0].blockingReasons.includes('DUPLICATE_CONSIDERATION_ID'));
});

test('same-symbol opposing opportunities are blocked as conflict', () => {
  const long = candidate('long', '50', { economicDirection: 'LONG', netDirectionalExposureDelta: '50' });
  const short = candidate('short', '50', { economicDirection: 'SHORT', netDirectionalExposureDelta: '-50' });
  const result = run([short, long]);
  assert.deepEqual(result.decisions.map((d) => d.status), ['BLOCKED', 'BLOCKED']);
  assert.ok(result.decisions.every((d) => d.blockingReasons.includes('CONFLICTING_OPPORTUNITY')));
});

test('unknown required eligibility, truth, direction, borrow, or capacity fails closed', () => {
  const invalid = candidate('invalid', '50', {
    considerationMode: 'VALIDATE_ONLY', economicDirection: 'UNKNOWN', borrowRequired: null,
    liquidityRequirements: [],
  });
  const reasons = validateAllocationCandidate(invalid, NOW);
  assert.ok(reasons.includes('MODE_VALIDATE_ONLY_CANNOT_RESERVE'));
  assert.ok(reasons.includes('ECONOMIC_DIRECTION_UNKNOWN'));
  assert.ok(reasons.includes('BORROW_REQUIREMENT_UNKNOWN'));
  assert.ok(reasons.includes('LIQUIDITY_REQUIREMENT_MISSING'));
  assert.equal(run([invalid]).decisions[0].status, 'BLOCKED');
});

for (const [name, snapshotOverrides, policyOverrides, expectedCode] of [
  ['gross', { grossExposureAndCommitments: '990' }, {}, 'PORTFOLIO_GROSS'],
  ['collateral', { entryCollateralAvailable: '10' }, {}, 'ENTRY_COLLATERAL'],
  ['margin', { marginHeadroomAvailable: '10' }, {}, 'MARGIN_HEADROOM'],
  ['strategy', { strategyUse: [{ key: 'BASIS', amount: '790' }] }, {}, 'STRATEGY:BASIS'],
  ['symbol', { symbolUse: [{ key: 'BTCUSDT', amount: '490' }] }, {}, 'SYMBOL:BTCUSDT'],
  ['correlation', { correlatedGroupUse: [{ key: 'BTC', amount: '590' }] }, {}, 'CORRELATED_GROUP:BTC'],
  ['venue/instrument', { venueInstrumentUse: [{ key: 'BINANCE:BTCUSDT:PAIR', amount: '490' }] }, {}, 'VENUE_INSTRUMENT:BINANCE:BTCUSDT:PAIR'],
]) {
  test(`${name} capacity caps a request deterministically`, () => {
    const decision = run([candidate(`cap-${name}`, '80')], snapshotOverrides, policyOverrides).decisions[0];
    assert.equal(decision.status, 'CAPPED');
    assert.equal(decision.grantedAmount, '10');
    assert.ok(decision.audit.some((step) => step.code === expectedCode && step.after === '10'));
  });
}

test('signed net limit applies to long and short deltas without treating missing as zero', () => {
  const long = candidate('net-long', '80', { economicDirection: 'LONG', netDirectionalExposureDelta: '80' });
  const short = candidate('net-short', '80', { economicDirection: 'SHORT', netDirectionalExposureDelta: '-80' });
  assert.equal(run([long], { netDirectionalExposure: '390' }).decisions[0].grantedAmount, '10');
  assert.equal(run([short], { netDirectionalExposure: '-390' }).decisions[0].grantedAmount, '10');
  assert.equal(run([long], { netDirectionalExposure: '-390' }).decisions[0].grantedAmount, '80', 'risk-offsetting delta keeps full room until the opposite boundary');
});

test('borrow inventory and intended-size liquidity cap resource-consuming candidates', () => {
  const borrowing = candidate('borrow', '80', {
    borrowRequired: true, borrowRequirements: [{ key: 'BTC', amount: '40' }],
  });
  assert.equal(run([borrowing], { borrowCapacityByAsset: [{ key: 'BTC', amount: '10' }] }).decisions[0].grantedAmount, '20');
  assert.equal(run([borrowing], { borrowCapacityByAsset: [] }).decisions[0].status, 'BLOCKED');
  assert.equal(run([borrowing], { liquidityCapacityByKey: [{ key: 'BTC:SPOT', amount: '20' }] }).decisions[0].grantedAmount, '20');
});

test('concurrency and active-position limits include existing plans and partial exposure', () => {
  const opensPosition = candidate('counts', '50', { opensNewActivePosition: true });
  const result = run([opensPosition], { currentConcurrentPlans: 10, currentActivePositions: 10 });
  assert.equal(result.decisions[0].status, 'BLOCKED');
  assert.ok(result.decisions[0].blockingReasons.includes('CONCURRENT_PLAN_LIMIT'));
  assert.ok(result.decisions[0].blockingReasons.includes('ACTIVE_POSITION_LIMIT'));
});

test('existing reservation/order claim collision blocks the whole account context', () => {
  const commitments = [
    { id: 'reservation', capitalClaimKey: 'same', kind: 'ACTIVE_RESERVATION' },
    { id: 'order', capitalClaimKey: 'same', kind: 'OPEN_ORDER' },
  ];
  const decision = run([candidate('double-existing')], { commitments }).decisions[0];
  assert.equal(decision.status, 'BLOCKED');
  assert.ok(decision.blockingReasons.includes('CAPITAL_CLAIM_DOUBLE_COUNTED'));
});

function grantedDecision(amount = '100') {
  return run([candidate(`reserve-${amount}`, amount)]).decisions[0];
}

function reserve(book = EMPTY_RESERVATION_BOOK, overrides = {}) {
  return reduceReservationBook(book, {
    kind: 'RESERVE', commandId: 'reserve-command', nowMs: NOW,
    allocation: grantedDecision(), capitalClaimKey: 'claim-reserve',
    policy: policy(), budgetTruth: reservationTruth(), considerationTruth: reservationTruth(),
    ...overrides,
  });
}

test('reservation creation is idempotent and the same decision/claim cannot reserve twice', () => {
  const created = reserve();
  const replay = reserve(created.book);
  assert.equal(created.mutation.status, 'APPLIED');
  assert.equal(replay.mutation.status, 'IDEMPOTENT_REPLAY');
  assert.equal(replay.book, created.book);
  const mismatch = reserve(created.book, { capitalClaimKey: 'changed-claim' });
  assert.equal(mismatch.mutation.status, 'REJECTED');
  assert.ok(mismatch.mutation.reasonCodes.includes('IDEMPOTENCY_KEY_REUSE_MISMATCH'));
  const duplicateDecision = reserve(created.book, { commandId: 'reserve-again', capitalClaimKey: 'other-claim' });
  assert.ok(duplicateDecision.mutation.reasonCodes.includes('ALLOCATION_ALREADY_RESERVED'));
  const otherDecision = grantedDecision('80');
  const duplicateClaim = reserve(created.book, { commandId: 'reserve-other', allocation: otherDecision });
  assert.ok(duplicateClaim.mutation.reasonCodes.includes('CAPITAL_CLAIM_ALREADY_RESERVED'));
});

test('consume, renew, release, and repeated release are exact', () => {
  const created = reserve();
  const id = created.mutation.reservationId;
  const consumed = reduceReservationBook(created.book, { kind: 'CONSUME', commandId: 'consume-1', reservationId: id, nowMs: NOW + 1, amount: '25.25' });
  assert.equal(consumed.mutation.consumedAmount, '25.25');
  assert.equal(consumed.book.reservations[0].reservation.consumedAmount, '25.25');
  const over = reduceReservationBook(consumed.book, { kind: 'CONSUME', commandId: 'consume-over', reservationId: id, nowMs: NOW + 2, amount: '75' });
  assert.equal(over.mutation.status, 'REJECTED');
  const renewed = reduceReservationBook(over.book, {
    kind: 'RENEW', commandId: 'renew', reservationId: id, nowMs: NOW + 5_000,
    policy: policy(), budgetTruth: reservationTruth(), considerationTruth: reservationTruth(),
  });
  assert.equal(renewed.book.reservations[0].reservation.expiresAtMs, NOW + 15_000);
  const released = reduceReservationBook(renewed.book, { kind: 'RELEASE', commandId: 'release', reservationId: id, nowMs: NOW + 6_000, reasonCode: 'PLAN_CANCELLED' });
  assert.equal(released.mutation.releasedAmount, '74.75');
  const again = reduceReservationBook(released.book, { kind: 'RELEASE', commandId: 'release-again', reservationId: id, nowMs: NOW + 6_001, reasonCode: 'PLAN_CANCELLED' });
  assert.equal(again.mutation.status, 'NOOP_ALREADY_TERMINAL');
  assert.equal(again.mutation.releasedAmount, '0');
});

test('TTL expiry releases unconsumed capital and cannot be renewed or consumed', () => {
  const created = reserve();
  const id = created.mutation.reservationId;
  const expired = reduceReservationBook(created.book, { kind: 'CONSUME', commandId: 'late-consume', reservationId: id, nowMs: NOW + 10_000, amount: '1' });
  assert.equal(expired.book.reservations[0].reservation.state, 'EXPIRED');
  assert.equal(expired.mutation.releasedAmount, '100');
  const renew = reduceReservationBook(expired.book, {
    kind: 'RENEW', commandId: 'late-renew', reservationId: id, nowMs: NOW + 10_001,
    policy: policy(), budgetTruth: reservationTruth(), considerationTruth: reservationTruth(),
  });
  assert.equal(renew.mutation.status, 'NOOP_ALREADY_TERMINAL');
});

test('close releases the full live claim exactly once', () => {
  const created = reserve();
  const id = created.mutation.reservationId;
  const consumed = reduceReservationBook(created.book, { kind: 'CONSUME', commandId: 'consume-close', reservationId: id, nowMs: NOW + 1, amount: '60' });
  const closure = {
    positionId: 'position-close', positionRevision: 'position-r2', positionState: 'CLOSED',
    reconciliationId: 'reconciliation-close', reconciliationRevision: 'reconciliation-r2',
    reconciliationState: 'MATCHED', reconciledAtMs: NOW + 2, remainingExposure: '0',
  };
  const closed = reduceReservationBook(consumed.book, { kind: 'CLOSE_RELEASE', commandId: 'close', reservationId: id, nowMs: NOW + 2, closure });
  assert.equal(closed.mutation.releasedAmount, '100');
  const repeated = reduceReservationBook(closed.book, { kind: 'CLOSE_RELEASE', commandId: 'close-other-id', reservationId: id, nowMs: NOW + 3, closure: { ...closure, reconciledAtMs: NOW + 3 } });
  assert.equal(repeated.mutation.status, 'NOOP_ALREADY_TERMINAL');
  assert.equal(repeated.mutation.releasedAmount, '0');
});

test('release then close releases only previously consumed exposure, never the unconsumed amount twice', () => {
  const created = reserve();
  const id = created.mutation.reservationId;
  const consumed = reduceReservationBook(created.book, { kind: 'CONSUME', commandId: 'consume-transfer', reservationId: id, nowMs: NOW + 1, amount: '60' });
  const released = reduceReservationBook(consumed.book, { kind: 'RELEASE', commandId: 'release-rest', reservationId: id, nowMs: NOW + 2, reasonCode: 'FUTURE_STAGES_CANCELLED' });
  assert.equal(released.mutation.releasedAmount, '40');
  const closed = reduceReservationBook(released.book, {
    kind: 'CLOSE_RELEASE', commandId: 'position-closed', reservationId: id, nowMs: NOW + 3,
    closure: {
      positionId: 'position-transfer', positionRevision: 'position-r3', positionState: 'CLOSED',
      reconciliationId: 'reconciliation-transfer', reconciliationRevision: 'reconciliation-r3',
      reconciliationState: 'MATCHED', reconciledAtMs: NOW + 3, remainingExposure: '0',
    },
  });
  assert.equal(closed.mutation.releasedAmount, '60');
});

test('blocked allocation and invalid TTL cannot create a reservation', () => {
  const blocked = run([candidate('blocked-reserve')], { entryCollateralAvailable: '0' }).decisions[0];
  const result = reserve(EMPTY_RESERVATION_BOOK, {
    allocation: blocked,
    policy: policy({ reservationTtlMs: integerBound(20_001, 20_000, 'ms') }),
  });
  assert.equal(result.book.reservations.length, 0);
  assert.ok(result.mutation.reasonCodes.includes('ALLOCATION_NOT_CURRENT_OR_CANONICAL'));
  assert.ok(result.mutation.reasonCodes.includes('RESERVATION_TTL_BOUND_INVALID'));
});

test('allocation re-ages candidate and budget truth instead of trusting cached FRESH labels', () => {
  const staleNow = NOW + 1_001;
  const result = allocateCapital({ policy: policy(), snapshot: snapshot(), candidates: [candidate('stale-replay')], nowMs: staleNow });
  assert.equal(result.decisions[0].status, 'BLOCKED');
  assert.ok(result.decisions[0].blockingReasons.includes('SNAPSHOT_TRUTH_STALE'));
  assert.ok(result.decisions[0].blockingReasons.includes('CONSIDERATION_TRUTH_STALE'));
});

test('zero resource requirements cannot convert known zero capacity into a full grant', () => {
  const zero = candidate('zero-capacity', '100', {
    borrowRequired: true,
    strategyRequirements: [{ key: 'BASIS', amount: '0' }],
    symbolRequirements: [{ key: 'BTCUSDT', amount: '0' }],
    correlatedGroupRequirements: [{ key: 'BTC', amount: '0' }],
    venueInstrumentRequirements: [{ key: 'BINANCE:BTCUSDT:PAIR', amount: '0' }],
    borrowRequirements: [{ key: 'BTC', amount: '0' }],
    liquidityRequirements: [{ key: 'BTC:SPOT', amount: '0' }],
  });
  const decision = run([zero], {
    borrowCapacityByAsset: [{ key: 'BTC', amount: '0' }],
    liquidityCapacityByKey: [{ key: 'BTC:SPOT', amount: '0' }],
  }).decisions[0];
  assert.equal(decision.status, 'BLOCKED');
  assert.ok(decision.blockingReasons.some((reason) => reason.endsWith('_AMOUNT_INVALID')));
});

test('one consideration cannot gain two active reservations across allocation clocks or caller claim keys', () => {
  const firstCandidate = candidate('repeat-consideration', '100');
  const firstDecision = run([firstCandidate]).decisions[0];
  const first = reserve(EMPTY_RESERVATION_BOOK, { allocation: firstDecision, capitalClaimKey: 'claim-one' });
  assert.equal(first.mutation.status, 'APPLIED');

  const secondNow = NOW + 1;
  const secondTruth = reservationTruth(secondNow);
  const secondCandidate = { ...firstCandidate, truth: secondTruth };
  const secondSnapshot = snapshot({ truth: secondTruth });
  const secondDecision = allocateCapital({ policy: policy(), snapshot: secondSnapshot, candidates: [secondCandidate], nowMs: secondNow }).decisions[0];
  assert.notEqual(secondDecision.id, firstDecision.id);
  const second = reduceReservationBook(first.book, {
    kind: 'RESERVE', commandId: 'reserve-second-clock', nowMs: secondNow,
    allocation: secondDecision, capitalClaimKey: 'claim-two', policy: policy(),
    budgetTruth: secondTruth, considerationTruth: secondTruth,
  });
  assert.equal(second.mutation.status, 'REJECTED');
  assert.ok(second.mutation.reasonCodes.includes('CONSIDERATION_ALREADY_RESERVED'));
  assert.equal(second.book.reservations.length, 1);
});

test('reservation commands are monotonic and allocation authority expires with its evidence', () => {
  const created = reserve();
  const id = created.mutation.reservationId;
  const backdated = reduceReservationBook(created.book, {
    kind: 'CONSUME', commandId: 'backdated-consume', reservationId: id, nowMs: NOW - 1, amount: '1',
  });
  assert.equal(backdated.mutation.status, 'REJECTED');
  assert.ok(backdated.mutation.reasonCodes.includes('COMMAND_TIME_NOT_MONOTONIC'));

  const stale = reserve(EMPTY_RESERVATION_BOOK, {
    commandId: 'stale-decision-reserve',
    nowMs: NOW + 100_001,
  });
  assert.equal(stale.mutation.status, 'REJECTED');
  assert.ok(stale.mutation.reasonCodes.includes('BUDGET_TRUTH_NOT_CURRENT'));

  const reboundTruth = reservationTruth(NOW + 1);
  const rebound = reserve(EMPTY_RESERVATION_BOOK, {
    commandId: 'rebound-old-decision', nowMs: NOW + 1,
    budgetTruth: reboundTruth, considerationTruth: reboundTruth,
  });
  assert.equal(rebound.mutation.status, 'REJECTED');
  assert.ok(rebound.mutation.reasonCodes.includes('ALLOCATION_NOT_CURRENT_OR_CANONICAL'));
});

test('consumed capital needs exact closed-position and matched-reconciliation proof before release', () => {
  const created = reserve();
  const id = created.mutation.reservationId;
  const consumed = reduceReservationBook(created.book, {
    kind: 'CONSUME', commandId: 'consume-for-proof', reservationId: id, nowMs: NOW + 1, amount: '60',
  });
  const rejected = reduceReservationBook(consumed.book, {
    kind: 'CLOSE_RELEASE', commandId: 'close-without-zero', reservationId: id, nowMs: NOW + 2,
    closure: {
      positionId: 'position-live', positionRevision: 'position-r2', positionState: 'CLOSED',
      reconciliationId: 'reconciliation-live', reconciliationRevision: 'reconciliation-r2',
      reconciliationState: 'MATCHED', reconciledAtMs: NOW + 2, remainingExposure: '0.1',
    },
  });
  assert.equal(rejected.mutation.status, 'REJECTED');
  assert.ok(rejected.mutation.reasonCodes.includes('CLOSURE_RECONCILIATION_PROOF_REQUIRED'));
  assert.equal(rejected.book.reservations[0].closedExposureReleased, false);
});

test('malformed signed net input returns a typed block instead of throwing', () => {
  const malformed = candidate('malformed-net', '50', {
    economicDirection: 'LONG', netDirectionalExposureDelta: 'not-a-decimal',
  });
  assert.doesNotThrow(() => run([malformed]));
  assert.ok(run([malformed]).decisions[0].blockingReasons.includes('NET_DELTA_INVALID'));
});

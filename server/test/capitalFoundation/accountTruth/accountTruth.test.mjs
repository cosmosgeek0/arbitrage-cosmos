import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveAccountCapitalProjection } from '../../../dist/capitalFoundation/accountTruth/index.js';

const NOW = 1_800_000_000_000;

function source(overrides = {}) {
  return {
    sourceTimeMs: NOW - 10,
    receivedAtMs: NOW - 5,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId: 'capital.account.test',
    ...overrides,
  };
}

function provenance(overrides = {}) {
  return {
    accountId: 'acct-1',
    capitalPoolId: 'account-control',
    coherentCutId: 'account-cut-1',
    ...overrides,
  };
}

function snapshot(value, overrides = {}, provenanceOverrides = {}) {
  return {
    value,
    provenance: provenance(provenanceOverrides),
    source: source(),
    revision: 'rev-1',
    evidenceReferences: ['fixture-1'],
    ...overrides,
  };
}

function borrowTruth(overrides = {}) {
  return {
    accountId: 'acct-1',
    symbol: 'BTCUSDT',
    asset: 'BTC',
    mode: 'CROSS_CLASSIC',
    permissionId: 'permission-1',
    state: 'AVAILABLE',
    reason: 'BORROW_AMOUNT_POSITIVE',
    positionBucket: 'MARGIN_CROSS',
    maxBorrowableAsset: '0.1',
    borrowLimitAsset: '0.2',
    hourlyRate: '0.0001',
    evaluatedAtMs: NOW - 10,
    expiresAtMs: NOW + 1_000,
    provenance: { account: null, permission: null, maxBorrow: null, rate: null },
    freshness: { account: null, permission: null, maxBorrow: null, rate: null },
    ...overrides,
  };
}

function completeInput(overrides = {}) {
  return {
    evaluatedAtMs: NOW,
    valuationAsset: 'USDT',
    spot: snapshot({
      balances: [
        { asset: 'USDT', total: '1000', available: '900', locked: '100' },
        { asset: 'BTC', total: '1', available: '0.5', locked: '0.5' },
      ],
      positions: [{
        positionId: 'spot-btc',
        instrumentId: 'BTCUSDT:SPOT',
        valuationAsset: 'USDT',
        longExposure: '100',
        shortExposure: '0',
      }],
    }, {}, { capitalPoolId: 'spot-wallet' }),
    futures: snapshot({
      wallets: [{
        asset: 'USDT',
        walletBalance: '200',
        availableBalance: '150',
        marginBalance: '220',
        initialMargin: '50',
        maintenanceMargin: '20',
      }],
      positions: [{
        positionId: 'perp-btc',
        instrumentId: 'BTCUSDT:PERP',
        valuationAsset: 'USDT',
        longExposure: '0',
        shortExposure: '90',
      }],
    }, {}, { capitalPoolId: 'futures-wallet' }),
    liabilities: snapshot([{
      liabilityId: 'liability-1',
      asset: 'USDT',
      principal: '30',
      accruedInterest: '2',
      fees: '1',
      total: '33',
    }]),
    orders: snapshot([{
      commitmentId: 'order-1',
      commitmentGroupId: 'trade-1',
      asset: 'USDT',
      amount: '100',
      reflectedInAvailable: true,
    }]),
    plans: snapshot([{
      commitmentId: 'plan-1',
      commitmentGroupId: 'trade-1',
      asset: 'USDT',
      amount: '120',
      reflectedInAvailable: false,
    }]),
    reservations: snapshot([{
      commitmentId: 'reservation-1',
      commitmentGroupId: 'trade-1',
      asset: 'USDT',
      amount: '100',
      reflectedInAvailable: false,
    }]),
    valuations: snapshot([{
      asset: 'BTC',
      valuationAsset: 'USDT',
      conservativeUnitValue: '50000',
      reasonCodes: ['HAIRCUT_APPLIED_BY_ADAPTER'],
    }]),
    hardReserves: snapshot([{
      reserveId: 'recovery-reserve',
      asset: 'USDT',
      amount: '100',
      reasonCode: 'RISK_REDUCTION',
    }]),
    borrowTruthReferences: [{
      referenceId: 'borrow-btc',
      capacityPoolId: 'margin-cross-acct-1-btc',
      requiredForNewAllocation: false,
      truth: borrowTruth(),
    }],
    ...overrides,
  };
}

test('projects conservative collateral, wallets, margins, liabilities, exposure, reserves, and exact allocatable capital', () => {
  const result = deriveAccountCapitalProjection(completeInput());
  assert.equal(result.allocatable.status, 'AVAILABLE');
  assert.equal(result.allocatable.availableCollateralValue, '26050');
  assert.equal(result.allocatable.liabilityValue, '33');
  assert.equal(result.allocatable.incrementalCommitmentValue, '20');
  assert.equal(result.allocatable.hardReserveValue, '100');
  assert.equal(result.allocatable.amount, '25897');
  assert.deepEqual(result.exposure, {
    long: '100',
    short: '90',
    gross: '190',
    netDirectional: '10',
    hedgeImbalance: '10',
    activePositionCount: 2,
  });
  assert.equal(result.collateralByAsset.find((row) => row.asset === 'USDT').futuresMargin, '220');
  assert.equal(result.supervisionVisible, true);
});

test('commitment groups de-duplicate order, plan, and reservation claims without double-counting venue locks', () => {
  const result = deriveAccountCapitalProjection(completeInput());
  assert.equal(result.commitments.orderValue, '100');
  assert.equal(result.commitments.planValue, '120');
  assert.equal(result.commitments.reservationValue, '100');
  assert.equal(result.commitments.incrementalValue, '20');
});

test('borrow capacity references Foundation truth but is not counted as owned allocatable capital', () => {
  const result = deriveAccountCapitalProjection(completeInput());
  assert.deepEqual(result.borrowCapacityByAsset, [{
    asset: 'BTC',
    maxBorrowableAsset: '0.1',
    conservativeValue: '5000',
    capacityPoolIds: ['margin-cross-acct-1-btc'],
    referenceIds: ['borrow-btc'],
  }]);
  assert.equal(result.borrowTruthReferences[0].truth.state, 'AVAILABLE');
  assert.equal(result.allocatable.amount, '25897');
});

for (const [name, sourceOverride, expectedState] of [
  ['stale', { sourceTimeMs: NOW - 1_001 }, 'STALE'],
  ['partial', { completeness: 'PARTIAL' }, 'PARTIAL'],
]) {
  test(`${name} required account truth blocks new allocation while preserving exposed-capital supervision`, () => {
    const input = completeInput();
    input.spot = snapshot(input.spot.value, { source: source(sourceOverride) }, { capitalPoolId: 'spot-wallet' });
    const result = deriveAccountCapitalProjection(input);
    assert.equal(result.allocatable.status, 'UNKNOWN');
    assert.equal(result.allocatable.amount, null);
    assert.equal(result.truth.sourceTruth.spot.completeness, expectedState);
    assert.equal(result.supervisionVisible, true);
  });
}

test('explicit divergent source blocks allocation as unavailable, without suppressing supervision', () => {
  const input = completeInput();
  input.futures = snapshot(input.futures.value, { divergent: true, reasons: ['VENUE_TOTAL_MISMATCH'] });
  const result = deriveAccountCapitalProjection(input);
  assert.equal(result.allocatable.status, 'UNAVAILABLE');
  assert.equal(result.allocatable.amount, null);
  assert.ok(result.allocatable.unavailableReasons.includes('SOURCE_FUTURES_DIVERGENT'));
  assert.equal(result.supervisionVisible, true);
});

test('explicitly missing source stays unknown rather than becoming an empty zero snapshot', () => {
  const result = deriveAccountCapitalProjection(completeInput({ liabilities: snapshot(null) }));
  assert.equal(result.truth.sourceTruth.liabilities.completeness, 'UNKNOWN');
  assert.equal(result.allocatable.liabilityValue, null);
  assert.equal(result.allocatable.amount, null);
  assert.ok(result.allocatable.unknownReasons.includes('SOURCE_LIABILITIES_UNKNOWN'));
});

test('unvalued non-native collateral blocks allocation but preserves its asset quantity', () => {
  const result = deriveAccountCapitalProjection(completeInput({ valuations: snapshot([]) }));
  const btc = result.collateralByAsset.find((row) => row.asset === 'BTC');
  assert.equal(btc.spotAvailable, '0.5');
  assert.equal(btc.availableConservativeValue, null);
  assert.equal(result.allocatable.status, 'UNKNOWN');
  assert.equal(result.allocatable.amount, null);
  assert.ok(result.allocatable.unknownReasons.includes('UNVALUED_REQUIRED_ASSET_BTC'));
});

test('contradictory balance arithmetic blocks allocation and keeps observed exposure visible', () => {
  const input = completeInput();
  input.spot.value.balances[0].total = '999';
  const result = deriveAccountCapitalProjection(input);
  assert.equal(result.allocatable.status, 'UNAVAILABLE');
  assert.equal(result.allocatable.amount, null);
  assert.ok(result.allocatable.unavailableReasons.includes('SPOT_BALANCE_CONTRADICTION_USDT'));
  assert.equal(result.supervisionVisible, true);
});

test('contradictory liability components block new allocation', () => {
  const input = completeInput();
  input.liabilities.value[0].total = '32';
  const result = deriveAccountCapitalProjection(input);
  assert.equal(result.allocatable.status, 'UNAVAILABLE');
  assert.ok(result.allocatable.unavailableReasons.includes('LIABILITY_TOTAL_CONTRADICTION_liability-1'));
});

test('known capital exhaustion is exact zero, distinct from unknown', () => {
  const input = completeInput({
    hardReserves: snapshot([{ reserveId: 'reserve-all', asset: 'USDT', amount: '999999', reasonCode: 'POLICY' }]),
  });
  const result = deriveAccountCapitalProjection(input);
  assert.equal(result.allocatable.status, 'UNAVAILABLE');
  assert.equal(result.allocatable.amount, '0');
  assert.ok(result.allocatable.unavailableReasons.includes('ALLOCATABLE_CAPITAL_EXHAUSTED'));
  assert.equal(result.allocatable.unknownReasons.length, 0);
});

test('required expired borrow truth blocks allocation; optional expired truth remains observable only', () => {
  const expired = borrowTruth({ expiresAtMs: NOW - 1 });
  const required = deriveAccountCapitalProjection(completeInput({
    borrowTruthReferences: [{
      referenceId: 'borrow-btc', capacityPoolId: 'margin-cross-acct-1-btc', requiredForNewAllocation: true, truth: expired,
    }],
  }));
  assert.equal(required.allocatable.status, 'UNKNOWN');
  assert.equal(required.allocatable.amount, null);
  assert.ok(required.allocatable.unknownReasons.includes('BORROW_TRUTH_borrow-btc_EXPIRED_OR_UNBOUNDED'));
  assert.equal(required.truth.allRequiredSourcesFreshAndComplete, false);
  const optional = deriveAccountCapitalProjection(completeInput({
    borrowTruthReferences: [{
      referenceId: 'borrow-btc', capacityPoolId: 'margin-cross-acct-1-btc', requiredForNewAllocation: false, truth: expired,
    }],
  }));
  assert.equal(optional.allocatable.status, 'AVAILABLE');
  assert.equal(optional.borrowTruthReferences[0].usableForNewAllocation, false);
});

for (const [name, mutate, expectedReason] of [
  ['mixed coherent account cuts', (input) => {
    input.futures.provenance = provenance({ capitalPoolId: 'futures-wallet', coherentCutId: 'account-cut-2' });
  }, 'ACCOUNT_SNAPSHOT_COHERENT_CUT_MISMATCH'],
  ['overlapping Spot and Futures capital pools', (input) => {
    input.futures.provenance = provenance({ capitalPoolId: 'spot-wallet' });
  }, 'SPOT_FUTURES_CAPITAL_POOL_OVERLAP_spot-wallet'],
  ['mixed account identities', (input) => {
    input.futures.provenance = provenance({ accountId: 'acct-2', capitalPoolId: 'futures-wallet' });
  }, 'ACCOUNT_SNAPSHOT_ACCOUNT_MISMATCH'],
]) {
  test(`${name} fail closed before capital can be summed`, () => {
    const input = completeInput();
    mutate(input);
    const result = deriveAccountCapitalProjection(input);
    assert.equal(result.allocatable.status, 'UNAVAILABLE');
    assert.equal(result.allocatable.amount, null);
    assert.ok(result.allocatable.unavailableReasons.includes(expectedReason));
    assert.equal(result.truth.allRequiredSourcesFreshAndComplete, false);
    assert.equal(Object.isFrozen(result.truth.snapshotProvenance), true);
  });
}

test('signed Futures deficits block allocation and remain visible for supervision', () => {
  const input = completeInput({ borrowTruthReferences: [] });
  input.spot.value = {
    balances: [{ asset: 'USDT', total: '100', available: '100', locked: '0' }],
    positions: [],
  };
  input.futures.value = {
    wallets: [{
      asset: 'USDT',
      walletBalance: '-200',
      availableBalance: '0',
      marginBalance: '-200',
      initialMargin: '0',
      maintenanceMargin: '0',
    }],
    positions: [],
  };
  input.liabilities.value = [];
  input.orders.value = [];
  input.plans.value = [];
  input.reservations.value = [];
  input.valuations.value = [];
  input.hardReserves.value = [];
  const result = deriveAccountCapitalProjection(input);
  const usdt = result.collateralByAsset.find((row) => row.asset === 'USDT');
  assert.equal(usdt.totalCollateral, '-100');
  assert.equal(usdt.availableCollateral, '100');
  assert.equal(result.allocatable.status, 'UNAVAILABLE');
  assert.equal(result.allocatable.amount, null);
  assert.ok(result.allocatable.unavailableReasons.includes('NEGATIVE_FUTURES_MARGIN_USDT'));
  assert.ok(result.allocatable.unavailableReasons.includes('AVAILABLE_COLLATERAL_EXCEEDS_TOTAL_USDT'));
  assert.equal(result.supervisionVisible, true);
});

test('repeated evidence for one canonical borrow capacity pool is de-duplicated, not added', () => {
  const shared = borrowTruth();
  const result = deriveAccountCapitalProjection(completeInput({
    borrowTruthReferences: [
      {
        referenceId: 'borrow-btc-a', capacityPoolId: 'margin-cross-acct-1-btc', requiredForNewAllocation: false, truth: shared,
      },
      {
        referenceId: 'borrow-btc-b', capacityPoolId: 'margin-cross-acct-1-btc', requiredForNewAllocation: false, truth: shared,
      },
    ],
  }));
  assert.equal(result.allocatable.status, 'AVAILABLE');
  assert.deepEqual(result.borrowCapacityByAsset, [{
    asset: 'BTC',
    maxBorrowableAsset: '0.1',
    conservativeValue: '5000',
    capacityPoolIds: ['margin-cross-acct-1-btc'],
    referenceIds: ['borrow-btc-a', 'borrow-btc-b'],
  }]);
});

test('one canonical borrow scope cannot claim multiple capacity pool identities', () => {
  const shared = borrowTruth();
  const result = deriveAccountCapitalProjection(completeInput({
    borrowTruthReferences: [
      { referenceId: 'borrow-a', capacityPoolId: 'pool-a', requiredForNewAllocation: false, truth: shared },
      { referenceId: 'borrow-b', capacityPoolId: 'pool-b', requiredForNewAllocation: false, truth: shared },
    ],
  }));
  assert.equal(result.allocatable.status, 'UNAVAILABLE');
  assert.equal(result.allocatable.amount, null);
  assert.deepEqual(result.borrowCapacityByAsset, []);
  assert.ok(result.allocatable.unavailableReasons.includes('BORROW_SCOPE_CAPACITY_POOL_DIVERGENT_pool-a__pool-b'));
});

test('conflicting truths for one borrow capacity pool are divergent and not projected as capacity', () => {
  const result = deriveAccountCapitalProjection(completeInput({
    borrowTruthReferences: [
      {
        referenceId: 'borrow-a', capacityPoolId: 'margin-cross-acct-1-btc', requiredForNewAllocation: false, truth: borrowTruth(),
      },
      {
        referenceId: 'borrow-b',
        capacityPoolId: 'margin-cross-acct-1-btc',
        requiredForNewAllocation: false,
        truth: borrowTruth({ maxBorrowableAsset: '0.2', borrowLimitAsset: '0.3' }),
      },
    ],
  }));
  assert.equal(result.allocatable.status, 'UNAVAILABLE');
  assert.equal(result.allocatable.amount, null);
  assert.deepEqual(result.borrowCapacityByAsset, []);
  assert.ok(result.allocatable.unavailableReasons.includes('BORROW_CAPACITY_POOL_DIVERGENT_margin-cross-acct-1-btc'));
});

test('borrow truth is cloned and deeply frozen so caller mutation cannot rewrite projected evidence', () => {
  const mutableTruth = borrowTruth();
  const result = deriveAccountCapitalProjection(completeInput({
    borrowTruthReferences: [{
      referenceId: 'borrow-btc',
      capacityPoolId: 'margin-cross-acct-1-btc',
      requiredForNewAllocation: false,
      truth: mutableTruth,
    }],
  }));
  mutableTruth.state = 'SOURCE_ERROR';
  mutableTruth.maxBorrowableAsset = '999';
  mutableTruth.provenance.account = source();
  const projected = result.borrowTruthReferences[0].truth;
  assert.notEqual(projected, mutableTruth);
  assert.equal(projected.state, 'AVAILABLE');
  assert.equal(projected.maxBorrowableAsset, '0.1');
  assert.equal(projected.provenance.account, null);
  assert.equal(result.borrowCapacityByAsset[0].maxBorrowableAsset, '0.1');
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.provenance), true);
  assert.equal(Object.isFrozen(projected.freshness), true);
});

test('numeric or negative financial values are rejected at the exact-decimal boundary', () => {
  const numeric = completeInput();
  numeric.spot.value.balances[0].available = 900;
  assert.throws(() => deriveAccountCapitalProjection(numeric), /exact non-negative decimal/);
  const negative = completeInput();
  negative.liabilities.value[0].total = '-1';
  assert.throws(() => deriveAccountCapitalProjection(negative), /exact non-negative decimal/);
});

test('projection is deterministic, canonically ordered, and frozen at public collection boundaries', () => {
  const first = deriveAccountCapitalProjection(completeInput());
  const input = completeInput();
  input.spot.value.balances.reverse();
  const second = deriveAccountCapitalProjection(input);
  assert.deepEqual(second, first);
  assert.deepEqual(first.collateralByAsset.map((row) => row.asset), ['BTC', 'USDT']);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.collateralByAsset), true);
  assert.equal(Object.isFrozen(first.allocatable), true);
});

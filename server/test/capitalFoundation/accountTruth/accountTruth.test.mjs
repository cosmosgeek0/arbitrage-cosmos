import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveAccountCapitalProjection } from '../../../dist/capitalFoundation/accountTruth/index.js';
import { deriveBorrowTruth } from '../../../dist/foundation/borrow/index.js';

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

function borrowTruth(overrides = {}, options = {}) {
  const identity = {
    accountId: 'acct-1',
    symbol: 'BTCUSDT',
    asset: 'BTC',
    mode: 'CROSS_CLASSIC',
    permissionId: 'permission-1',
  };
  const derivedAtMs = options.derivedAtMs ?? NOW - 10;
  const sourceTimeMs = options.sourceTimeMs ?? NOW - 10;
  const receivedAtMs = options.receivedAtMs ?? sourceTimeMs;
  const maxAgeMs = options.maxAgeMs ?? 1_010;
  const observedAt = (sourceId) => ({
    sourceTimeMs,
    receivedAtMs,
    maxAgeMs,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId,
  });
  return structuredClone({
    ...deriveBorrowTruth({
      scope: identity,
      nowMs: derivedAtMs,
      account: {
        ...identity,
        status: 'OK',
        observedAt: observedAt('capital.test.margin.account'),
        accountCreated: true,
        modeEnabled: true,
        borrowEnabled: true,
      },
      permission: {
        ...identity,
        status: 'OK',
        observedAt: observedAt('capital.test.margin.permission'),
        enableReading: true,
        enableMargin: true,
        enableSpotAndMarginTrading: true,
      },
      maxBorrow: {
        ...identity,
        status: 'OK',
        observedAt: observedAt('capital.test.margin.maxBorrowable'),
        amount: '0.1',
        borrowLimit: '0.2',
      },
      rate: {
        ...identity,
        status: 'OK',
        observedAt: observedAt('capital.test.margin.rate'),
        hourlyRate: '0.0001',
      },
      liability: {
        ...identity,
        status: 'OK',
        observedAt: observedAt('capital.test.margin.liability'),
        currentBorrowedAsset: '0.01',
        accruedInterestAsset: '0.0002',
      },
      collateral: {
        ...identity,
        status: 'OK',
        observedAt: observedAt('capital.test.margin.collateral'),
        product: 'MARGIN_ACCOUNT',
        collateralAmount: '1000',
        collateralAsset: 'USDT',
        currentLtv: '0.25',
      },
    }),
    ...overrides,
  });
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
  assert.equal(result.borrowTruthReferences[0].truth.currentBorrowedAsset, '0.01');
  assert.equal(result.borrowTruthReferences[0].truth.accruedInterestAsset, '0.0002');
  assert.equal(result.borrowTruthReferences[0].truth.collateralAmount, '1000');
  assert.equal(result.borrowTruthReferences[0].truth.currentLtv, '0.25');
  assert.equal(result.allocatable.amount, '25897');
});

test('AVAILABLE borrow truth may omit ENGINE section 11 optional collateral and LTV facts', () => {
  const result = deriveAccountCapitalProjection(completeInput({
    borrowTruthReferences: [{
      referenceId: 'borrow-no-collateral',
      capacityPoolId: 'margin-cross-acct-1-btc',
      requiredForNewAllocation: false,
      truth: borrowTruth({
        collateralAmount: null,
        collateralAsset: null,
        currentLtv: null,
      }),
    }],
  }));
  assert.equal(result.borrowTruthReferences[0].truth.state, 'AVAILABLE');
  assert.equal(result.borrowTruthReferences[0].truth.collateralAmount, null);
  assert.equal(result.borrowTruthReferences[0].truth.collateralAsset, null);
  assert.equal(result.borrowTruthReferences[0].truth.currentLtv, null);
  assert.deepEqual(result.borrowCapacityByAsset, [{
    asset: 'BTC',
    maxBorrowableAsset: '0.1',
    conservativeValue: '5000',
    capacityPoolIds: ['margin-cross-acct-1-btc'],
    referenceIds: ['borrow-no-collateral'],
  }]);
  assert.equal(result.allocatable.amount, '25897');
});

for (const [name, mutate, expectedReasonFragment] of [
  ['missing current borrowed liability', (truth) => {
    truth.currentBorrowedAsset = null;
  }, 'AVAILABLE_CURRENT_BORROW_MISSING'],
  ['missing accrued-interest liability', (truth) => {
    truth.accruedInterestAsset = null;
  }, 'AVAILABLE_ACCRUED_INTEREST_MISSING'],
  ['partial liability provenance', (truth) => {
    truth.provenance.liability.completeness = 'PARTIAL';
  }, 'LIABILITY_EVIDENCE_INCOMPLETE'],
  ['public authority masquerading as private evidence', (truth) => {
    for (const key of Object.keys(truth.provenance)) {
      truth.provenance[key].authority = 'LIVE_PUBLIC';
      truth.freshness[key].effectiveAuthority = 'LIVE_PUBLIC';
    }
  }, 'PRIVATE_AUTHORITY_REQUIRED'],
  ['mixed private and synthetic evidence cut', (truth) => {
    truth.provenance.account.authority = 'LIVE_PRIVATE';
    truth.freshness.account.effectiveAuthority = 'LIVE_PRIVATE';
  }, 'EVIDENCE_AUTHORITY_MISMATCH'],
]) {
  test(`Capital rejects AVAILABLE BorrowTruth with ${name}`, () => {
    const truth = borrowTruth();
    mutate(truth);
    const result = deriveAccountCapitalProjection(completeInput({
      borrowTruthReferences: [{
        referenceId: 'borrow-hostile',
        capacityPoolId: 'margin-cross-acct-1-btc',
        requiredForNewAllocation: false,
        truth,
      }],
    }));
    assert.equal(result.allocatable.status, 'UNAVAILABLE');
    assert.equal(result.borrowTruthReferences[0].usableForNewAllocation, false);
    assert.deepEqual(result.borrowCapacityByAsset, []);
    assert.ok(result.allocatable.unavailableReasons.some((reason) => reason.includes(expectedReasonFragment)));
  });
}

test('mutating Proxy cannot replay the prior three-read null-liability false green', () => {
  const target = borrowTruth({ currentBorrowedAsset: null });
  let liabilityReads = 0;
  let liabilityDescriptorReads = 0;
  const hostileTruth = new Proxy(target, {
    get(current, property, receiver) {
      if (property === 'currentBorrowedAsset') {
        liabilityReads += 1;
        // The superseded boundary read this twice during validation and once
        // while cloning. Those three reads produced valid, valid, then null,
        // yielding a null projected liability that was still marked usable.
        return liabilityReads <= 2 ? '0.01' : null;
      }
      return Reflect.get(current, property, receiver);
    },
    getOwnPropertyDescriptor(current, property) {
      if (property === 'currentBorrowedAsset') liabilityDescriptorReads += 1;
      return Reflect.getOwnPropertyDescriptor(current, property);
    },
  });
  const result = deriveAccountCapitalProjection(completeInput({
    borrowTruthReferences: [{
      referenceId: 'borrow-mutating-proxy',
      capacityPoolId: 'margin-cross-acct-1-btc',
      requiredForNewAllocation: false,
      truth: hostileTruth,
    }],
  }));

  assert.equal(liabilityReads, 0, 'descriptor capture must not invoke caller get traps');
  assert.equal(liabilityDescriptorReads, 1, 'each truth field must be captured exactly once');
  assert.equal(result.borrowTruthReferences[0].truth.currentBorrowedAsset, null);
  assert.equal(result.borrowTruthReferences[0].usableForNewAllocation, false);
  assert.deepEqual(result.borrowCapacityByAsset, []);
  assert.equal(result.allocatable.status, 'UNAVAILABLE');
  assert.ok(result.allocatable.unavailableReasons.includes(
    'BORROW_TRUTH_borrow-mutating-proxy_AVAILABLE_CURRENT_BORROW_MISSING',
  ));
  assert.equal(Object.isFrozen(result.borrowTruthReferences[0].truth), true);
  assert.equal(Object.isFrozen(result.borrowTruthReferences[0].truth.provenance), true);
});

test('Capital requires liability evidence to remain fresh at its injected consumption clock', () => {
  const truth = borrowTruth();
  truth.provenance.liability.maxAgeMs = 5;
  truth.expiresAtMs = NOW - 5;
  const result = deriveAccountCapitalProjection(completeInput({
    borrowTruthReferences: [{
      referenceId: 'borrow-stale-liability',
      capacityPoolId: 'margin-cross-acct-1-btc',
      requiredForNewAllocation: true,
      truth,
    }],
  }));
  assert.equal(result.allocatable.status, 'UNKNOWN');
  assert.equal(result.borrowTruthReferences[0].usableForNewAllocation, false);
  assert.ok(result.allocatable.unknownReasons.includes('BORROW_TRUTH_borrow-stale-liability_EXPIRED_OR_UNBOUNDED'));
});

test('later collateral expiry stays optional and cannot erase a fresh authorized liability cut', () => {
  const truth = borrowTruth();
  truth.provenance.collateral.maxAgeMs = 5;
  const result = deriveAccountCapitalProjection(completeInput({
    borrowTruthReferences: [{
      referenceId: 'borrow-collateral-aged',
      capacityPoolId: 'margin-cross-acct-1-btc',
      requiredForNewAllocation: true,
      truth,
    }],
  }));
  assert.equal(result.allocatable.status, 'AVAILABLE');
  assert.equal(result.borrowTruthReferences[0].usableForNewAllocation, true);
  assert.equal(result.borrowTruthReferences[0].truth.collateralAmount, '1000');
  assert.equal(result.borrowTruthReferences[0].truth.currentLtv, '0.25');
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

test('zero unit value cannot turn a positive non-native liability into known zero capital usage', () => {
  const input = completeInput();
  input.liabilities.value = [{
    liabilityId: 'liability-btc',
    asset: 'BTC',
    principal: '0.4',
    accruedInterest: '0.01',
    fees: '0.001',
    total: '0.411',
  }];
  input.valuations.value[0].conservativeUnitValue = '0';
  const result = deriveAccountCapitalProjection(input);
  const liability = result.liabilitiesByAsset.find((row) => row.asset === 'BTC');
  assert.equal(liability.total, '0.411');
  assert.equal(liability.conservativeValue, null);
  assert.equal(result.allocatable.liabilityValue, null);
  assert.equal(result.allocatable.amount, null);
  assert.equal(result.allocatable.status, 'UNKNOWN');
  assert.ok(result.allocatable.unknownReasons.includes('ZERO_UNIT_VALUE_INVALID_FOR_POSITIVE_LIABILITY_BTC'));
  assert.equal(result.truth.allRequiredSourcesFreshAndComplete, false);
  assert.equal(result.supervisionVisible, true);
});

test('zero unit value remains an exact known zero only when the non-native liability itself is zero', () => {
  const input = completeInput();
  input.liabilities.value = [{
    liabilityId: 'liability-btc-zero',
    asset: 'BTC',
    principal: '0',
    accruedInterest: '0',
    fees: '0',
    total: '0',
  }];
  input.valuations.value[0].conservativeUnitValue = '0';
  const result = deriveAccountCapitalProjection(input);
  const liability = result.liabilitiesByAsset.find((row) => row.asset === 'BTC');
  assert.equal(liability.conservativeValue, '0');
  assert.equal(result.allocatable.liabilityValue, '0');
  assert.equal(result.allocatable.status, 'AVAILABLE');
  assert.equal(result.allocatable.amount, '930');
  assert.equal(result.allocatable.unknownReasons.length, 0);
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
  const expired = borrowTruth({}, {
    derivedAtMs: NOW - 1_500,
    sourceTimeMs: NOW - 2_000,
    receivedAtMs: NOW - 1_999,
    maxAgeMs: 1_000,
  });
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

test('different liability or collateral cuts for one capacity pool are divergent rather than silently merged', () => {
  for (const override of [
    { currentBorrowedAsset: '0.02' },
    { accruedInterestAsset: '0.0003' },
    { collateralAmount: '1100' },
    { collateralAsset: 'USDC' },
    { currentLtv: '0.3' },
  ]) {
    const result = deriveAccountCapitalProjection(completeInput({
      borrowTruthReferences: [
        {
          referenceId: 'borrow-a', capacityPoolId: 'margin-cross-acct-1-btc', requiredForNewAllocation: false, truth: borrowTruth(),
        },
        {
          referenceId: 'borrow-b', capacityPoolId: 'margin-cross-acct-1-btc', requiredForNewAllocation: false, truth: borrowTruth(override),
        },
      ],
    }));
    assert.equal(result.allocatable.status, 'UNAVAILABLE');
    assert.deepEqual(result.borrowCapacityByAsset, []);
    assert.ok(result.allocatable.unavailableReasons.includes('BORROW_CAPACITY_POOL_DIVERGENT_margin-cross-acct-1-btc'));
  }
});

test('sanitized BorrowTruth snapshot is deeply frozen so caller mutation cannot rewrite projected evidence', () => {
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
  mutableTruth.currentBorrowedAsset = '999';
  mutableTruth.provenance.account = source();
  const projected = result.borrowTruthReferences[0].truth;
  assert.notEqual(projected, mutableTruth);
  assert.equal(projected.state, 'AVAILABLE');
  assert.equal(projected.maxBorrowableAsset, '0.1');
  assert.equal(projected.currentBorrowedAsset, '0.01');
  assert.equal(projected.provenance.account.sourceId, 'capital.test.margin.account');
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

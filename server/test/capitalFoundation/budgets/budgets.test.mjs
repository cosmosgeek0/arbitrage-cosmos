import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessCapitalTruth,
} from '../../../dist/capitalFoundation/contracts/index.js';
import {
  deriveCapitalBudgetPolicyRevision,
  projectPortfolioBudgetSnapshotFromAccount,
  validateBudgetContext,
  validateCapitalBudgetPolicy,
  validatePortfolioBudgetSnapshot,
} from '../../../dist/capitalFoundation/budgets/index.js';
import { ACCOUNT_SNAPSHOT_KEYS } from '../../../dist/capitalFoundation/accountTruth/index.js';
import { MAX_UTC_MS } from '../../../dist/foundation/contracts/index.js';

const NOW = 1_800_000_000_000;
const bound = (value, unit = 'USDT') => ({ value, minimum: '0', maximum: '1000000', unit });
const integerBound = (value, maximum, unit = 'COUNT') => ({ value, minimum: 0, maximum, unit });

function truth(overrides = {}) {
  return assessCapitalTruth({
    source: {
      sourceTimeMs: NOW - 10,
      receivedAtMs: NOW - 5,
      maxAgeMs: 1_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId: 'budget-test',
    },
    evaluatedAtMs: NOW,
    requiredValuePresent: true,
    ...overrides,
  });
}

function policy(overrides = {}) {
  const draft = {
    authority: {
      revision: 'pending-content-revision',
      sourceId: 'policy-test',
      issuedAtMs: NOW - 2_000,
      effectiveFromMs: NOW - 1_000,
      effectiveUntilMs: NOW + 100_000,
    },
    valuationAsset: 'USDT',
    portfolioGrossLimit: bound('1000'),
    portfolioNetLimit: bound('400'),
    perStrategyLimits: { BASIS: bound('700'), VOLUME: bound('200') },
    perSymbolLimit: bound('500'),
    perCorrelatedGroupLimit: bound('600'),
    perVenueInstrumentLimit: bound('500'),
    riskReductionReserve: bound('100'),
    maximumConcurrentPlans: integerBound(4, 20),
    maximumActivePositions: integerBound(3, 20),
    reservationTtlMs: integerBound(10_000, 60_000, 'MILLISECONDS'),
    ...overrides,
  };
  if (Object.prototype.hasOwnProperty.call(overrides, 'authority')) return draft;
  return {
    ...draft,
    authority: { ...draft.authority, revision: deriveCapitalBudgetPolicyRevision(draft) },
  };
}

function snapshot(overrides = {}) {
  return {
    valuationAsset: 'USDT',
    truth: truth(),
    entryCollateralAvailable: '500',
    protectedRiskReductionReserve: '100',
    collateralPoolBinding: {
      sourcePoolId: 'account-control-pool',
      sourcePoolTotal: '600',
      otherUnavailableCollateral: '0',
    },
    marginHeadroomAvailable: '500',
    grossExposureAndCommitments: '100',
    netDirectionalExposure: '10',
    strategyUse: [{ key: 'BASIS', amount: '100' }],
    symbolUse: [{ key: 'BTCUSDT', amount: '100' }],
    correlatedGroupUse: [{ key: 'BTC', amount: '100' }],
    venueInstrumentUse: [{ key: 'BINANCE:BTCUSDT:PERP', amount: '100' }],
    currentConcurrentPlans: 1,
    currentActivePositions: 1,
    borrowCapacityByAsset: [{ key: 'BTC', amount: '20' }],
    liquidityCapacityByKey: [{ key: 'BTC:SPOT', amount: '1000' }],
    commitmentCoverage: {
      orders: 'COMPLETE', reservations: 'COMPLETE', plans: 'COMPLETE',
      partiallyExposedPositions: 'COMPLETE', activePositions: 'COMPLETE',
    },
    commitments: [
      { id: 'plan-1', capitalClaimKey: 'claim-plan-1', kind: 'STAGED_PLAN' },
      { id: 'position-1', capitalClaimKey: 'claim-position-1', kind: 'ACTIVE_POSITION' },
    ],
    ...overrides,
  };
}

function accountProjection(overrides = {}) {
  const sourceTruth = Object.freeze(Object.fromEntries(ACCOUNT_SNAPSHOT_KEYS.map((key) => [
    key,
    truth({ source: {
      ...truth().source,
      receivedAtMs: key === 'hardReserves' ? NOW - 1 : NOW - 5,
      sourceId: `account.${key}`,
    } }),
  ])));
  const base = {
    evaluatedAtMs: NOW,
    valuationAsset: 'USDT',
    collateralByAsset: [],
    liabilitiesByAsset: [],
    commitments: {
      entries: [], orderValue: '0', planValue: '0', reservationValue: '0', incrementalValue: '50',
    },
    hardReserves: [],
    borrowTruthReferences: [],
    borrowCapacityByAsset: [{
      asset: 'BTC', maxBorrowableAsset: '2', conservativeValue: '100000',
      capacityPoolIds: ['borrow-pool-btc'], referenceIds: ['borrow-ref-btc'],
    }],
    exposure: {
      long: '100', short: '90', gross: '100', netDirectional: '10', hedgeImbalance: '10', activePositionCount: 1,
    },
    truth: {
      completeness: 'COMPLETE', allRequiredSourcesFreshAndComplete: true,
      snapshotProvenance: Object.fromEntries(ACCOUNT_SNAPSHOT_KEYS.map((key) => [key, {
        accountId: 'acct-1', capitalPoolId: `${key}-pool`, coherentCutId: 'cut-1',
      }])),
      sourceTruth,
      reasons: [],
    },
    allocatable: {
      status: 'AVAILABLE', amount: '400', valuationAsset: 'USDT', availableCollateralValue: '600',
      liabilityValue: '50', incrementalCommitmentValue: '50', hardReserveValue: '100',
      unavailableReasons: [], unknownReasons: [], blockingReasons: [],
    },
    supervisionVisible: true,
  };
  return { ...base, ...overrides };
}

function portfolioFacts(overrides = {}) {
  return {
    marginHeadroomAvailable: '500',
    grossExposureAndCommitments: '150',
    netDirectionalExposure: '10',
    strategyUse: [{ key: 'BASIS', amount: '100' }],
    symbolUse: [{ key: 'BTCUSDT', amount: '100' }],
    correlatedGroupUse: [{ key: 'BTC', amount: '100' }],
    venueInstrumentUse: [{ key: 'BINANCE:BTCUSDT:PERP', amount: '100' }],
    liquidityCapacityByKey: [{ key: 'BTC:SPOT', amount: '1000' }],
    commitmentCoverage: {
      orders: 'COMPLETE', reservations: 'COMPLETE', plans: 'COMPLETE',
      partiallyExposedPositions: 'COMPLETE', activePositions: 'COMPLETE',
    },
    commitments: [{ id: 'position-1', capitalClaimKey: 'position-claim-1', kind: 'ACTIVE_POSITION' }],
    ...overrides,
  };
}

test('budget policy and snapshot accept complete exact caller truth', () => {
  assert.deepEqual(validateCapitalBudgetPolicy(policy(), NOW), { valid: true, reasonCodes: [] });
  assert.deepEqual(validatePortfolioBudgetSnapshot(snapshot(), NOW), { valid: true, reasonCodes: [] });
  assert.deepEqual(validateBudgetContext(policy(), snapshot(), NOW), { valid: true, reasonCodes: [] });
});

test('pure account adapter content-binds complete AccountTruth into an exact budget snapshot', () => {
  const result = projectPortfolioBudgetSnapshotFromAccount({
    accountProjection: accountProjection(),
    portfolio: portfolioFacts(),
  });
  assert.equal(result.ok, true);
  assert.notEqual(result.accountProjectionDigest, null);
  assert.equal(result.snapshot.collateralPoolBinding.sourcePoolId, result.accountProjectionDigest);
  assert.deepEqual(result.snapshot.collateralPoolBinding, {
    sourcePoolId: result.accountProjectionDigest,
    sourcePoolTotal: '600',
    otherUnavailableCollateral: '100',
  });
  assert.equal(result.snapshot.entryCollateralAvailable, '400');
  assert.equal(result.snapshot.protectedRiskReductionReserve, '100');
  assert.equal(result.snapshot.currentConcurrentPlans, 0);
  assert.equal(result.snapshot.currentActivePositions, 1);
  assert.equal(result.snapshot.truth.source.receivedAtMs, NOW - 1, 'aggregate receipt is the latest required receipt');
  assert.deepEqual(result.snapshot.borrowCapacityByAsset, [{ key: 'BTC', amount: '2' }]);
  assert.deepEqual(validatePortfolioBudgetSnapshot(result.snapshot, NOW), { valid: true, reasonCodes: [] });
});

test('account adapter blocks incomplete and divergent account projections without invented values', () => {
  for (const completeness of ['UNKNOWN', 'DIVERGENT']) {
    const account = accountProjection();
    const result = projectPortfolioBudgetSnapshotFromAccount({
      accountProjection: {
        ...account,
        truth: { ...account.truth, completeness, allRequiredSourcesFreshAndComplete: false },
        allocatable: {
          ...account.allocatable,
          status: 'UNKNOWN', amount: null, availableCollateralValue: null,
          blockingReasons: [`ACCOUNT_${completeness}`], unknownReasons: [`ACCOUNT_${completeness}`],
        },
      },
      portfolio: portfolioFacts(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.snapshot, null);
    assert.ok(result.reasonCodes.includes('ACCOUNT_TRUTH_NOT_COMPLETE'));
    assert.ok(result.reasonCodes.includes('ACCOUNT_ALLOCATABLE_FACT_UNKNOWN'));
  }
});

test('account adapter rejects understated portfolio exposure and an unbalanced account partition', () => {
  const understated = projectPortfolioBudgetSnapshotFromAccount({
    accountProjection: accountProjection(),
    portfolio: portfolioFacts({ grossExposureAndCommitments: '149', netDirectionalExposure: '9' }),
  });
  assert.equal(understated.ok, false);
  assert.ok(understated.reasonCodes.includes('PORTFOLIO_GROSS_UNDERSTATES_ACCOUNT'));
  assert.ok(understated.reasonCodes.includes('PORTFOLIO_NET_UNDERSTATES_ACCOUNT'));

  const account = accountProjection();
  const divergent = projectPortfolioBudgetSnapshotFromAccount({
    accountProjection: { ...account, allocatable: { ...account.allocatable, amount: '401' } },
    portfolio: portfolioFacts(),
  });
  assert.equal(divergent.ok, false);
  assert.ok(divergent.reasonCodes.includes('ACCOUNT_COLLATERAL_PARTITION_DIVERGENT'));

  const unknownBorrow = projectPortfolioBudgetSnapshotFromAccount({
    accountProjection: {
      ...account,
      borrowCapacityByAsset: [{ ...account.borrowCapacityByAsset[0], maxBorrowableAsset: null }],
    },
    portfolio: portfolioFacts(),
  });
  assert.equal(unknownBorrow.ok, false);
  assert.ok(unknownBorrow.reasonCodes.includes('ACCOUNT_BORROW_CAPACITY_UNKNOWN'));
});

test('budget policy revision content-addresses every semantic and ignores only its own value', () => {
  const original = policy();
  assert.equal(deriveCapitalBudgetPolicyRevision(original), original.authority.revision);
  assert.equal(deriveCapitalBudgetPolicyRevision({
    ...original,
    authority: { ...original.authority, revision: 'caller-rewritten-revision' },
  }), original.authority.revision, 'the derivation must not recurse through the revision being derived');

  const widenedWithRetainedRevision = {
    ...original,
    portfolioGrossLimit: { ...original.portfolioGrossLimit, value: '1000000' },
  };
  assert.notEqual(deriveCapitalBudgetPolicyRevision(widenedWithRetainedRevision), original.authority.revision);
  const validation = validateCapitalBudgetPolicy(widenedWithRetainedRevision, NOW);
  assert.equal(validation.valid, false);
  assert.ok(validation.reasonCodes.includes('POLICY_REVISION_CONTENT_MISMATCH'));
});

test('unknown/stale required account truth and incomplete commitment coverage fail closed', () => {
  const stale = truth({
    source: {
      sourceTimeMs: NOW - 5_000, receivedAtMs: NOW - 4_999, maxAgeMs: 100,
      authority: 'SYNTHETIC_TEST', completeness: 'COMPLETE', sourceId: 'stale-budget',
    },
  });
  const result = validatePortfolioBudgetSnapshot(snapshot({
    truth: stale,
    commitmentCoverage: { ...snapshot().commitmentCoverage, reservations: 'UNKNOWN' },
  }), NOW);
  assert.equal(result.valid, false);
  assert.ok(result.reasonCodes.includes('SNAPSHOT_TRUTH_STALE'));
  assert.ok(result.reasonCodes.includes('COMMITMENT_COVERAGE_INCOMPLETE'));
});

test('risk-reduction reserve must be protected outside entry collateral', () => {
  const result = validateBudgetContext(policy(), snapshot({
    protectedRiskReductionReserve: '99.999',
    collateralPoolBinding: {
      sourcePoolId: 'account-control-pool', sourcePoolTotal: '599.999', otherUnavailableCollateral: '0',
    },
  }), NOW);
  assert.equal(result.valid, false);
  assert.ok(result.reasonCodes.includes('RISK_REDUCTION_RESERVE_UNDERPROTECTED'));
});

test('collateral partition binds entry and reserve to one exact source pool', () => {
  const overlapAttempt = validatePortfolioBudgetSnapshot(snapshot({
    collateralPoolBinding: {
      sourcePoolId: 'account-control-pool',
      sourcePoolTotal: '500',
      otherUnavailableCollateral: '0',
    },
  }), NOW);
  assert.equal(overlapAttempt.valid, false);
  assert.ok(overlapAttempt.reasonCodes.includes('COLLATERAL_POOL_PARTITION_MISMATCH'));

  const paddedSource = validatePortfolioBudgetSnapshot(snapshot({
    collateralPoolBinding: {
      sourcePoolId: ' account-control-pool ',
      sourcePoolTotal: '600',
      otherUnavailableCollateral: '0',
    },
  }), NOW);
  assert.ok(paddedSource.reasonCodes.includes('COLLATERAL_POOL_SOURCE_INVALID'));
});

test('duplicate claim keys expose order/reservation double counting instead of funding through it', () => {
  const result = validatePortfolioBudgetSnapshot(snapshot({ commitments: [
    { id: 'reservation-1', capitalClaimKey: 'shared-claim', kind: 'ACTIVE_RESERVATION' },
    { id: 'order-1', capitalClaimKey: 'shared-claim', kind: 'OPEN_ORDER' },
  ] }), NOW);
  assert.equal(result.valid, false);
  assert.ok(result.reasonCodes.includes('CAPITAL_CLAIM_DOUBLE_COUNTED'));
});

test('current gross, net, plan, and position breaches block new allocation context', () => {
  const result = validateBudgetContext(policy(), snapshot({
    grossExposureAndCommitments: '1001',
    netDirectionalExposure: '-401',
    currentConcurrentPlans: 5,
    currentActivePositions: 4,
  }), NOW);
  assert.deepEqual(result.reasonCodes.filter((code) => code.startsWith('CURRENT_')), [
    'CURRENT_GROSS_LIMIT_BREACH', 'CURRENT_NET_LIMIT_BREACH', 'CURRENT_PLAN_LIMIT_BREACH', 'CURRENT_POSITION_LIMIT_BREACH',
  ]);
});

test('net directional exposure cannot exceed gross exposure and commitments', () => {
  const result = validatePortfolioBudgetSnapshot(snapshot({
    grossExposureAndCommitments: '10',
    netDirectionalExposure: '-10.0001',
  }), NOW);
  assert.equal(result.valid, false);
  assert.ok(result.reasonCodes.includes('NET_EXPOSURE_EXCEEDS_GROSS'));
});

test('caller counts must reconcile exactly to complete commitment references', () => {
  const understated = validatePortfolioBudgetSnapshot(snapshot({
    currentConcurrentPlans: 0,
    currentActivePositions: 0,
  }), NOW);
  assert.equal(understated.valid, false);
  assert.ok(understated.reasonCodes.includes('PLAN_COUNT_COMMITMENT_MISMATCH'));
  assert.ok(understated.reasonCodes.includes('POSITION_COUNT_COMMITMENT_MISMATCH'));

  const partialExposure = validatePortfolioBudgetSnapshot(snapshot({
    commitments: [
      { id: 'plan-1', capitalClaimKey: 'claim-plan-1', kind: 'STAGED_PLAN' },
      { id: 'position-1', capitalClaimKey: 'claim-position-1', kind: 'PARTIALLY_EXPOSED_POSITION' },
    ],
  }), NOW);
  assert.deepEqual(partialExposure, { valid: true, reasonCodes: [] });
});

test('policy authority expiry and malformed bounds are explicit', () => {
  const result = validateCapitalBudgetPolicy(policy({
    authority: { ...policy().authority, effectiveUntilMs: NOW },
    portfolioGrossLimit: { value: '100', minimum: '200', maximum: '10', unit: 'USD' },
  }), NOW);
  assert.equal(result.valid, false);
  assert.ok(result.reasonCodes.includes('POLICY_EXPIRED'));
  assert.ok(result.reasonCodes.includes('PORTFOLIO_GROSS_BOUND_INVALID'));
});

test('cached fresh truth is re-aged at allocation time and missing coverage keys fail closed', () => {
  const aged = validatePortfolioBudgetSnapshot(snapshot(), NOW + 1_001);
  assert.equal(aged.valid, false);
  assert.ok(aged.reasonCodes.includes('SNAPSHOT_TRUTH_STALE'));

  const missing = validatePortfolioBudgetSnapshot(snapshot({ commitmentCoverage: {} }), NOW);
  assert.equal(missing.valid, false);
  assert.ok(missing.reasonCodes.includes('COMMITMENT_COVERAGE_INCOMPLETE'));
});

test('policy authority requires a revision and a coherent effective window', () => {
  const result = validateCapitalBudgetPolicy(policy({ authority: {
    ...policy().authority,
    revision: '',
    issuedAtMs: NOW + 10,
    effectiveUntilMs: NOW - 2_000,
  } }), NOW);
  assert.ok(result.reasonCodes.includes('POLICY_REVISION_MISSING'));
  assert.ok(result.reasonCodes.includes('POLICY_ISSUED_AFTER_EFFECTIVE'));
  assert.ok(result.reasonCodes.includes('POLICY_EFFECTIVE_WINDOW_INVALID'));
});

test('budget clocks use the public Foundation UTC-millisecond range', () => {
  const outsideUtc = MAX_UTC_MS + 1;
  assert.ok(validateCapitalBudgetPolicy(policy(), outsideUtc).reasonCodes.includes('NOW_INVALID'));
  assert.ok(validatePortfolioBudgetSnapshot(snapshot(), outsideUtc).reasonCodes.includes('NOW_INVALID'));

  const invalidAuthority = policy({ authority: {
    ...policy().authority,
    effectiveUntilMs: outsideUtc,
  } });
  assert.ok(validateCapitalBudgetPolicy(invalidAuthority, NOW).reasonCodes.includes('POLICY_EXPIRY_INVALID'));
});

test('integer policy bounds require exact COUNT and MILLISECONDS semantic units', () => {
  const wrongUnits = validateCapitalBudgetPolicy(policy({
    maximumConcurrentPlans: integerBound(4, 20, 'count'),
    maximumActivePositions: integerBound(3, 20, 'POSITIONS'),
    reservationTtlMs: integerBound(10_000, 60_000, 'ms'),
  }), NOW);
  assert.ok(wrongUnits.reasonCodes.includes('MAX_CONCURRENT_PLANS_BOUND_INVALID'));
  assert.ok(wrongUnits.reasonCodes.includes('MAX_ACTIVE_POSITIONS_BOUND_INVALID'));
  assert.ok(wrongUnits.reasonCodes.includes('RESERVATION_TTL_BOUND_INVALID'));
});

test('malformed snapshot truth returns fail-closed validation issues instead of throwing', () => {
  for (const malformedTruth of [
    null,
    { ...truth(), source: { ...truth().source, receivedAtMs: 'not-time' } },
    { ...truth(), freshness: { ...truth().freshness, effectiveAuthority: 'FORGED' } },
  ]) {
    let result;
    assert.doesNotThrow(() => { result = validatePortfolioBudgetSnapshot(snapshot({ truth: malformedTruth }), NOW); });
    assert.equal(result.valid, false);
    assert.ok(result.reasonCodes.includes('SNAPSHOT_TRUTH_INVALID'));
  }
});

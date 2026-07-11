import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessCapitalTruth,
  deriveCapitalConfigRevision,
} from '../../../dist/capitalFoundation/contracts/index.js';
import {
  validateBudgetContext,
  validateCapitalBudgetPolicy,
  validatePortfolioBudgetSnapshot,
} from '../../../dist/capitalFoundation/budgets/index.js';

const NOW = 1_800_000_000_000;
const bound = (value, unit = 'USDT') => ({ value, minimum: '0', maximum: '1000000', unit });
const integerBound = (value, maximum, unit = 'count') => ({ value, minimum: 0, maximum, unit });

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
  return {
    authority: {
      revision: deriveCapitalConfigRevision('budget-test', { revision: 1 }),
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
    reservationTtlMs: integerBound(10_000, 60_000, 'ms'),
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    valuationAsset: 'USDT',
    truth: truth(),
    entryCollateralAvailable: '500',
    protectedRiskReductionReserve: '100',
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
    commitments: [{ id: 'position-1', capitalClaimKey: 'claim-1', kind: 'ACTIVE_POSITION' }],
    ...overrides,
  };
}

test('budget policy and snapshot accept complete exact caller truth', () => {
  assert.deepEqual(validateCapitalBudgetPolicy(policy(), NOW), { valid: true, reasonCodes: [] });
  assert.deepEqual(validatePortfolioBudgetSnapshot(snapshot(), NOW), { valid: true, reasonCodes: [] });
  assert.deepEqual(validateBudgetContext(policy(), snapshot(), NOW), { valid: true, reasonCodes: [] });
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
  const result = validateBudgetContext(policy(), snapshot({ protectedRiskReductionReserve: '99.999' }), NOW);
  assert.equal(result.valid, false);
  assert.ok(result.reasonCodes.includes('RISK_REDUCTION_RESERVE_UNDERPROTECTED'));
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

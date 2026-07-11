import test from 'node:test';
import assert from 'node:assert/strict';

import {
  composeEconomicReport,
  rollUpEconomicReports,
} from '../../../dist/capitalFoundation/economics/index.js';

const NOW = 1_800_000_000_000;

function scope(overrides = {}) {
  return {
    kind: 'POSITION',
    id: 'position-1',
    strategy: 'BASIS',
    opportunityId: 'opportunity-1',
    configRevision: 'config-1',
    stage: 'HOLD',
    symbol: 'BTCUSDT',
    legId: null,
    correlationId: 'cor-1',
    ...overrides,
  };
}

function component(id, kind, amount, overrides = {}) {
  const status = overrides.status ?? 'KNOWN';
  return {
    id,
    kind,
    status,
    amount,
    estimateRange: status === 'ESTIMATED' ? { low: amount, high: amount } : null,
    valuationAsset: 'USDT',
    observedAtMs: NOW,
    sourceIds: [`source-${id}`],
    reasonCodes: [],
    strategy: 'BASIS',
    opportunityId: 'opportunity-1',
    configRevision: 'config-1',
    stage: 'HOLD',
    symbol: 'BTCUSDT',
    legId: kind.includes('LEG') ? `leg-${id}` : null,
    correlationId: 'cor-1',
    ...overrides,
  };
}

function compose(components, overrides = {}) {
  return composeEconomicReport({
    scope: scope(overrides.scope),
    valuationAsset: 'USDT',
    components,
    policy: {
      pricePnlBasis: 'LEG_PRICE',
      executionCostBasis: 'DETAILED_SPREAD_SLIPPAGE',
      expectedComponentKinds: [...new Set(components.map((entry) => entry.kind))],
      ...overrides.policy,
    },
    evaluatedAtMs: NOW,
  });
}

function fullComponents() {
  return [
    component('mtm', 'MARK_TO_MARKET_LEG_PNL', '100'),
    component('realized', 'REALIZED_LEG_PNL', '20'),
    component('basis', 'BASIS_CONVERGENCE_DIVERGENCE', '90'),
    component('directional', 'DIRECTIONAL_CONTRIBUTION', '30'),
    component('fees', 'TRADING_COMMISSIONS', '-2'),
    component('entry-spread', 'ENTRY_SPREAD_COST', '-1'),
    component('exit-spread', 'EXIT_SPREAD_COST', '-1'),
    component('slippage-estimate', 'ESTIMATED_SLIPPAGE', '-3', { status: 'ESTIMATED', estimateRange: { low: '-4', high: '-2' } }),
    component('shortfall', 'EXECUTION_SHORTFALL', '-5'),
    component('funding', 'FUNDING', '4'),
    component('borrow', 'BORROW_INTEREST_AND_FEES', '-1'),
    component('one-leg', 'ONE_LEG_EXPOSURE', '-2'),
    component('fx', 'CONVERSION_VALUATION', '1'),
    component('recovery', 'OPERATIONAL_RECOVERY_COST', '-1'),
    component('residual', 'RESIDUAL_UNEXPLAINED', '0'),
  ];
}

test('detailed accounting sums known components exactly and composes estimate bounds', () => {
  const report = compose(fullComponents());
  assert.equal(report.attribution.netKnown, '117');
  assert.deepEqual(report.attribution.netEstimatedRange, { low: '113', high: '115' });
  assert.equal(report.identity.knownComponentSum, report.attribution.netKnown);
  assert.equal(report.identity.proven, true);
  assert.equal(report.accountingConfidence, 'MEDIUM');
  assert.equal(report.accountingStatus, 'INCOMPLETE');
  assert.ok(report.attribution.includedComponentIds.includes('mtm'));
  assert.ok(report.attribution.includedComponentIds.includes('slippage-estimate'));
});

test('basis/directional and execution-shortfall basis cannot double count leg PnL or detailed costs', () => {
  const report = compose(fullComponents(), { policy: { pricePnlBasis: 'BASIS_AND_DIRECTIONAL', executionCostBasis: 'EXECUTION_SHORTFALL' } });
  assert.equal(report.attribution.netKnown, '114');
  assert.ok(report.excludedComponentIds.includes('mtm'));
  assert.ok(report.excludedComponentIds.includes('realized'));
  assert.ok(report.excludedComponentIds.includes('entry-spread'));
  assert.ok(report.excludedComponentIds.includes('slippage-estimate'));
  assert.ok(report.attribution.includedComponentIds.includes('basis'));
  assert.ok(report.attribution.includedComponentIds.includes('shortfall'));
});

test('gross, realized, unrealized, basis, directional, and every cost family remain separately visible', () => {
  const measures = compose(fullComponents()).measures;
  assert.equal(measures.grossPricePnl.knownAmount, '120');
  assert.equal(measures.realizedPnl.knownAmount, '20');
  assert.equal(measures.unrealizedPnl.knownAmount, '100');
  assert.equal(measures.basisContribution.knownAmount, '90');
  assert.equal(measures.directionalContribution.knownAmount, '30');
  assert.equal(measures.fees.knownAmount, '-2');
  assert.equal(measures.spread.knownAmount, '-2');
  assert.deepEqual(measures.slippage.estimatedRange, { low: '-4', high: '-2' });
  assert.equal(measures.funding.knownAmount, '4');
  assert.equal(measures.borrow.knownAmount, '-1');
  assert.equal(measures.executionShortfall.knownAmount, '-5');
  assert.equal(measures.oneLegExposure.knownAmount, '-2');
  assert.equal(measures.recovery.knownAmount, '-1');
  assert.equal(measures.fxValuation.knownAmount, '1');
  assert.equal(measures.unexplainedResidual.knownAmount, '0');
});

test('missing component stays null and makes economics incomplete rather than zero', () => {
  const report = compose([
    component('fees', 'TRADING_COMMISSIONS', '-2'),
    component('borrow-missing', 'BORROW_INTEREST_AND_FEES', null, { status: 'MISSING', observedAtMs: null, reasonCodes: ['BORROW_SOURCE_MISSING'] }),
  ]);
  assert.equal(report.attribution.netKnown, '-2');
  assert.ok(report.attribution.missingComponentKinds.includes('BORROW_INTEREST_AND_FEES'));
  assert.equal(report.measures.borrow.knownAmount, null);
  assert.equal(report.measures.borrow.status, 'MISSING');
  assert.equal(report.attribution.completeness, 'PARTIAL');
  assert.equal(report.attribution.accountingIdentityProven, false);
});

test('an all-missing report is UNKNOWN, not a profitable or flat result', () => {
  const report = compose([component('valuation-missing', 'CONVERSION_VALUATION', null, { status: 'MISSING', observedAtMs: null })]);
  assert.equal(report.attribution.netKnown, '0');
  assert.equal(report.attribution.completeness, 'UNKNOWN');
  assert.equal(report.accountingStatus, 'INCOMPLETE');
  assert.equal(report.measures.fxValuation.knownAmount, null);
  assert.ok(report.attribution.missingComponentKinds.includes('CONVERSION_VALUATION'));
});

test('mixed valuation is explicit, excluded from the net, and makes identity unproven', () => {
  const report = compose([component('usd-fee', 'TRADING_COMMISSIONS', '-2', { valuationAsset: 'USD' })]);
  assert.equal(report.accountingStatus, 'DIVERGENT');
  assert.equal(report.attribution.completeness, 'DIVERGENT');
  assert.equal(report.identity.proven, false);
  assert.ok(report.attribution.divergentReasons.includes('MIXED_VALUATION_ASSET:usd-fee:USD'));
  assert.deepEqual(report.attribution.includedComponentIds, []);
});

test('duplicate components are never summed and are reported divergent', () => {
  const duplicate = component('same-id', 'TRADING_COMMISSIONS', '-2');
  const report = compose([duplicate, duplicate]);
  assert.equal(report.attribution.netKnown, '0');
  assert.equal(report.accountingStatus, 'DIVERGENT');
  assert.equal(report.identity.proven, false);
  assert.ok(report.attribution.divergentReasons.includes('DUPLICATE_COMPONENT_ID:same-id'));
});

test('dimension conflicts are explicit while complete attribution indexes all required dimensions', () => {
  const good = compose([component('fee', 'TRADING_COMMISSIONS', '-1')]);
  for (const name of ['strategy', 'opportunityId', 'configRevision', 'stage', 'symbol', 'correlationId']) {
    assert.equal(good.dimensions.find((entry) => entry.dimension === name).completeness, 'COMPLETE');
  }
  const bad = compose([component('fee', 'TRADING_COMMISSIONS', '-1', { configRevision: 'config-other' })]);
  assert.equal(bad.accountingStatus, 'DIVERGENT');
  assert.deepEqual(bad.dimensions.find((entry) => entry.dimension === 'configRevision').conflictingComponentIds, ['fee']);
});

test('non-zero unexplained residual remains visible and prevents complete accounting', () => {
  const report = compose(fullComponents().map((entry) => entry.kind === 'RESIDUAL_UNEXPLAINED'
    ? component('residual', 'RESIDUAL_UNEXPLAINED', '-0.25')
    : entry));
  assert.equal(report.measures.unexplainedResidual.knownAmount, '-0.25');
  assert.equal(report.accountingStatus, 'INCOMPLETE');
  assert.equal(report.accountingConfidence, 'LOW');
  assert.equal(report.identity.proven, true);
});

test('explicit NOT_APPLICABLE satisfies complete required coverage without inventing zero', () => {
  const required = [
    'MARK_TO_MARKET_LEG_PNL', 'REALIZED_LEG_PNL', 'FUNDING', 'BORROW_INTEREST_AND_FEES',
    'TRADING_COMMISSIONS', 'ENTRY_SPREAD_COST', 'EXIT_SPREAD_COST', 'ESTIMATED_SLIPPAGE',
    'ONE_LEG_EXPOSURE', 'CONVERSION_VALUATION', 'OPERATIONAL_RECOVERY_COST', 'RESIDUAL_UNEXPLAINED',
  ];
  const report = compose(required.map((kind) => component(`na-${kind}`, kind, null, {
    status: 'NOT_APPLICABLE', observedAtMs: null, sourceIds: [`not-applicable-${kind}`],
  })));
  assert.deepEqual(report.attribution.missingComponentKinds, []);
  assert.equal(report.measures.borrow.status, 'NOT_APPLICABLE');
  assert.equal(report.measures.borrow.knownAmount, null);
  assert.equal(report.accountingStatus, 'COMPLETE');
  assert.equal(report.accountingConfidence, 'HIGH');
});

test('empty or self-underspecified policy cannot report complete high-confidence flat economics', () => {
  const report = compose([], { policy: { expectedComponentKinds: [] } });
  assert.equal(report.attribution.netKnown, '0');
  assert.equal(report.attribution.completeness, 'UNKNOWN');
  assert.equal(report.accountingStatus, 'INCOMPLETE');
  assert.equal(report.accountingConfidence, 'NONE');
  assert.equal(report.identity.proven, false);
  assert.ok(report.attribution.missingComponentKinds.includes('TRADING_COMMISSIONS'));
  assert.ok(report.attribution.missingComponentKinds.includes('RESIDUAL_UNEXPLAINED'));
});

test('realized slippage supersedes only the matching leg and provenance slot', () => {
  const report = compose([
    component('realized-leg-1', 'REALIZED_SLIPPAGE', '-1', { legId: 'leg-1', sourceIds: ['fill-leg-1'] }),
    component('estimated-leg-1', 'ESTIMATED_SLIPPAGE', '-9', {
      status: 'ESTIMATED', estimateRange: { low: '-10', high: '-8' }, legId: 'leg-1', sourceIds: ['estimate-leg-1'],
    }),
    component('estimated-leg-2', 'ESTIMATED_SLIPPAGE', '-5', {
      status: 'ESTIMATED', estimateRange: { low: '-6', high: '-4' }, legId: 'leg-2', sourceIds: ['estimate-leg-2'],
    }),
  ]);
  assert.deepEqual(report.attribution.includedComponentIds, ['estimated-leg-2', 'realized-leg-1']);
  assert.deepEqual(report.attribution.netEstimatedRange, { low: '-7', high: '-5' });
  assert.ok(report.excludedComponentIds.includes('estimated-leg-1'));
});

test('same economic provenance under different IDs is divergent and never double-counted', () => {
  const first = component('fee-a', 'TRADING_COMMISSIONS', '-1', { sourceIds: ['fill-commission-1'] });
  const second = component('fee-b', 'TRADING_COMMISSIONS', '-1', { sourceIds: ['fill-commission-1'] });
  const report = compose([first, second]);
  assert.equal(report.attribution.netKnown, '0');
  assert.equal(report.accountingStatus, 'DIVERGENT');
  assert.equal(report.identity.proven, false);
  assert.ok(report.attribution.divergentReasons.some((reason) => reason.startsWith('DUPLICATE_COMPONENT_PROVENANCE:')));
});

test('malformed estimates become divergent output rather than throwing projection', () => {
  const report = compose([
    component('bad-estimate', 'ESTIMATED_SLIPPAGE', '-1', { status: 'ESTIMATED', estimateRange: null }),
  ]);
  assert.equal(report.accountingStatus, 'DIVERGENT');
  assert.equal(report.attribution.netEstimatedRange, null);
  assert.ok(report.attribution.divergentReasons.some((reason) => reason.includes('ESTIMATED_REQUIRES_RANGE')));
});

test('known and estimated amounts require non-empty provenance sources', () => {
  const report = compose([
    component('unproven-fee', 'TRADING_COMMISSIONS', '-1', { sourceIds: [] }),
  ]);
  assert.equal(report.accountingStatus, 'DIVERGENT');
  assert.equal(report.attribution.netKnown, '0');
  assert.ok(report.attribution.divergentReasons.includes('INVALID_COMPONENT:unproven-fee:PROVENANCE_SOURCE_REQUIRED'));
});

test('report components deep-copy and freeze caller-owned nested provenance data', () => {
  const estimateRange = { low: '-2', high: '-1' };
  const sourceIds = ['estimate-source-1'];
  const reasonCodes = ['MODEL_BOUND'];
  const mutable = component('mutable-estimate', 'ESTIMATED_SLIPPAGE', '-1.5', {
    status: 'ESTIMATED', estimateRange, sourceIds, reasonCodes,
  });
  const report = compose([mutable]);
  sourceIds.push('later-source');
  reasonCodes.push('later-reason');
  estimateRange.low = '-999';
  const stored = report.attribution.components[0];
  assert.deepEqual(stored.sourceIds, ['estimate-source-1']);
  assert.deepEqual(stored.reasonCodes, ['MODEL_BOUND']);
  assert.deepEqual(stored.estimateRange, { low: '-2', high: '-1' });
  assert.equal(Object.isFrozen(stored), true);
  assert.equal(Object.isFrozen(stored.sourceIds), true);
  assert.equal(Object.isFrozen(stored.reasonCodes), true);
  assert.equal(Object.isFrozen(stored.estimateRange), true);
});

test('proposal, mandate, stage, leg, position, and closed-outcome scopes are supported deterministically', () => {
  for (const kind of ['PROPOSAL', 'MANDATE', 'STAGE', 'LEG', 'POSITION', 'CLOSED_OUTCOME']) {
    const report = compose([component(`fee-${kind}`, 'TRADING_COMMISSIONS', '-1')], { scope: { kind, id: `scope-${kind}` } });
    assert.equal(report.scope.kind, kind);
    assert.equal(report.attribution.netKnown, '-1');
    assert.equal(Object.isFrozen(report), true);
  }
});

test('child reports compose from components, and overlapping child evidence is caught', () => {
  const child = compose([component('shared-fee', 'TRADING_COMMISSIONS', '-1')]);
  const rolled = rollUpEconomicReports({
    scope: scope({ kind: 'CLOSED_OUTCOME', id: 'closed-1' }),
    valuationAsset: 'USDT',
    childReports: [child, child],
    policy: { pricePnlBasis: 'LEG_PRICE', executionCostBasis: 'DETAILED_SPREAD_SLIPPAGE', expectedComponentKinds: ['TRADING_COMMISSIONS'] },
    evaluatedAtMs: NOW,
  });
  assert.equal(rolled.attribution.netKnown, '0');
  assert.equal(rolled.accountingStatus, 'DIVERGENT');
  assert.ok(rolled.attribution.divergentReasons.includes('DUPLICATE_COMPONENT_ID:shared-fee'));
});

test('very large exact values retain decimal identity without IEEE-754 conversion', () => {
  const report = compose([
    component('large', 'MARK_TO_MARKET_LEG_PNL', '90071992547409931234567890.01'),
    component('fee', 'TRADING_COMMISSIONS', '-0.01'),
  ]);
  assert.equal(report.attribution.netKnown, '90071992547409931234567890');
  assert.equal(report.identity.knownComponentSum, report.attribution.netKnown);
});

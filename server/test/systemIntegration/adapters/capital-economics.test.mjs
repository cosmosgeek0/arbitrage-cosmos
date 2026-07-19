import test from 'node:test';
import assert from 'node:assert/strict';

import * as capitalContracts from '../../../dist/capitalFoundation/contracts/index.js';
import {
  assessCapitalTruth,
} from '../../../dist/capitalFoundation/contracts/index.js';
import {
  deriveOpportunityEligibilityPolicyRevision,
} from '../../../dist/capitalFoundation/opportunities/index.js';
import {
  evaluateOpportunityEligibilityWithProductionEconomics,
} from '../../../dist/capitalFoundation/opportunities/eligibility.js';
import { deriveBorrowTruth } from '../../../dist/foundation/borrow/index.js';
import { projectCanonicalConservativeEconomics } from '../../../dist/systemIntegration/adapters/index.js';
import { createProductionSystemIntegrationPorts } from '../../../dist/systemIntegration/production/index.js';

const NOW = 1_900_000_000_000;
const PROPOSAL = 'basis-proposal-r54';
const BORROW_SCOPE = Object.freeze({
  accountId: 'acct-primary',
  symbol: 'BTCUSDT',
  asset: 'BTC',
  mode: 'CROSS_CLASSIC',
  permissionId: 'permission-r54',
});

class ManualClock {
  constructor(now = NOW) { this.now = now; }
  nowMs() { return this.now; }
}

function truth(sourceId, authority = 'DERIVED_LIVE', now = NOW) {
  const sourceTimeMs = Math.max(0, now - 100);
  const receivedAtMs = Math.max(sourceTimeMs, now - 90);
  return assessCapitalTruth({
    source: {
      sourceTimeMs,
      receivedAtMs,
      maxAgeMs: 1_000,
      authority,
      completeness: 'COMPLETE',
      sourceId,
    },
    evaluatedAtMs: now,
    requiredValuePresent: true,
    revision: `${sourceId}-r1`,
  });
}

function borrowTruth(scope = BORROW_SCOPE, authority = 'LIVE_PRIVATE', now = NOW, sourceSuffix = '') {
  const sourceTimeMs = Math.max(0, now - 100);
  const receivedAtMs = Math.max(sourceTimeMs, now - 90);
  const observedAt = (sourceId) => ({
    sourceTimeMs,
    receivedAtMs,
    maxAgeMs: 1_000,
    authority,
    completeness: 'COMPLETE',
    sourceId: `${sourceId}${sourceSuffix}`,
  });
  const base = (sourceId) => ({ ...scope, status: 'OK', observedAt: observedAt(sourceId) });
  return deriveBorrowTruth({
    scope,
    nowMs: now,
    account: {
      ...base('foundation.borrow.account'),
      accountCreated: true,
      modeEnabled: true,
      borrowEnabled: true,
    },
    permission: {
      ...base('foundation.borrow.permission'),
      enableReading: true,
      enableMargin: true,
      enableSpotAndMarginTrading: true,
    },
    maxBorrow: {
      ...base('foundation.borrow.max'),
      amount: '10',
      borrowLimit: '100',
    },
    rate: {
      ...base('foundation.borrow.rate'),
      hourlyRate: '0',
    },
    liability: {
      ...base('foundation.borrow.liability'),
      currentBorrowedAsset: '1',
      accruedInterestAsset: '0',
    },
    collateral: null,
  });
}

function economics(overrides = {}) {
  return {
    valuationAsset: 'USDT',
    requestedCapital: '1000',
    expectedGrossEdge: '20',
    expectedNetEdge: '10',
    estimatedFees: '1',
    estimatedFunding: '-1',
    estimatedBorrowCost: '0',
    estimatedSpreadCost: '2',
    estimatedSlippage: '1',
    estimatedLatencyCost: '1',
    estimatedAdverseSelectionCost: '1',
    estimatedRecoveryCost: '1',
    estimatedCapitalOpportunityCost: '3',
    liquidityCapacity: '1000',
    expectedBorrowScope: BORROW_SCOPE,
    fundingFact: null,
    borrowFact: null,
    capitalOpportunityFact: null,
    exactSourceIds: ['caller-asserted-only'],
    missingFields: [],
    ...overrides,
  };
}

function candidate(overrides = {}) {
  const proposal = {
    sourceProposalId: PROPOSAL,
    canonicalProposalId: `cprop-${PROPOSAL}`,
    sourceCorrelationId: 'basis-correlation-r54',
    strategy: 'BASIS',
    symbol: 'BTCUSDT',
    direction: 'long_spot_short_perp',
    sourceLifecycle: 'open',
    sourceRevision: 'basis-proposal-revision-r54',
    sourceConfigRevision: 'basis-config-r54',
    createdAtMs: NOW - 500,
    updatedAtMs: NOW - 100,
    expiresAtMs: NOW + 10_000,
    intakeDigest: 'basis-intake-digest-r54',
    ...(overrides.proposal ?? {}),
  };
  return {
    intake: {
      proposal,
      economics: economics(overrides.economics),
      truth: truth('capital.intake', 'SYNTHETIC_TEST'),
      lossReport: {
        omittedFields: [],
        missingSourceFields: [],
        translationReasons: [],
        financialNumbersAccepted: false,
      },
    },
    structure: {
      kind: 'BASIS_TWO_LEG',
      spotInstrumentId: 'BINANCE:SPOT:BTCUSDT',
      perpetualInstrumentId: 'BINANCE:USD_M_PERPETUAL:BTCUSDT',
    },
    requiredEvidenceIds: [],
    evidenceReferences: [],
    thesisReference: null,
    conflictScope: { exclusiveCapitalClaimIds: [] },
  };
}

function policy() {
  const draft = {
    authority: {
      revision: 'pending',
      sourceId: 'capital.policy.r54',
      issuedAtMs: NOW - 1_000,
      effectiveFromMs: NOW - 500,
      effectiveUntilMs: NOW + 100_000,
    },
    acceptedProposalConfigRevisions: { BASIS: ['basis-config-r54'], VOLUME: [] },
    acceptedEvidenceConfigRevisions: { BASIS: [], VOLUME: [] },
    evidenceRequirement: { BASIS: 'OPTIONAL', VOLUME: 'OPTIONAL' },
    basisMode: 'MANUAL_ARMED',
    volumeMode: 'ADVISORY',
  };
  return {
    ...draft,
    authority: { ...draft.authority, revision: deriveOpportunityEligibilityPolicyRevision(draft) },
  };
}

function component(scope, kind, amount, sourceId, observedAtMs = NOW - 100) {
  return {
    id: `${kind.toLowerCase()}-component-r54`,
    kind,
    status: 'KNOWN',
    amount,
    estimateRange: null,
    valuationAsset: 'USDT',
    observedAtMs,
    sourceIds: [`${sourceId}-e1`],
    reasonCodes: [],
    strategy: scope.strategy,
    opportunityId: scope.proposalId,
    configRevision: scope.proposalConfigRevision,
    stage: null,
    symbol: scope.symbol,
    legId: null,
    correlationId: scope.correlationId,
  };
}

function baseEconomics() {
  const source = economics();
  return {
    valuationAsset: source.valuationAsset,
    requestedCapital: source.requestedCapital,
    expectedGrossEdge: source.expectedGrossEdge,
    expectedNetEdge: source.expectedNetEdge,
    estimatedFees: source.estimatedFees,
    estimatedFunding: source.estimatedFunding,
    estimatedBorrowCost: source.estimatedBorrowCost,
    estimatedSpreadCost: source.estimatedSpreadCost,
    estimatedSlippage: source.estimatedSlippage,
    estimatedLatencyCost: source.estimatedLatencyCost,
    estimatedAdverseSelectionCost: source.estimatedAdverseSelectionCost,
    estimatedRecoveryCost: source.estimatedRecoveryCost,
    estimatedCapitalOpportunityCost: source.estimatedCapitalOpportunityCost,
    liquidityCapacity: source.liquidityCapacity,
  };
}

function scopedCut(scope, overrides = {}) {
  const fundingTruth = truth('basis.funding');
  const borrowCostTruth = truth('foundation.borrow-cost');
  const opportunityTruth = truth('capital.opportunity');
  return {
    funding: {
      ...scope,
      owner: 'BASIS_ENGINE',
      ownerRevision: fundingTruth.revision,
      valuationAsset: 'USDT',
      component: component(scope, 'FUNDING', '-1', 'basis.funding'),
      truth: fundingTruth,
      ...(overrides.funding ?? {}),
    },
    borrow: {
      ...scope,
      owner: 'FOUNDATION_BORROW_TRUTH',
      ownerRevision: borrowCostTruth.revision,
      valuationAsset: 'USDT',
      component: component(scope, 'BORROW_INTEREST_AND_FEES', '0', 'foundation.borrow-cost'),
      truth: borrowCostTruth,
      borrowTruth: overrides.borrowTruth ?? borrowTruth(),
      ...(overrides.borrow ?? {}),
    },
    opportunity: {
      ...scope,
      owner: 'CAPITAL_FOUNDATION',
      ownerRevision: opportunityTruth.revision,
      ownerRecordId: 'capital-opportunity-component-r54',
      ownerConfigRevision: 'capital-opportunity-config-r54',
      value: '3',
      valuationAsset: 'USDT',
      evidenceIds: ['capital.opportunity-e1'],
      baseEconomics: baseEconomics(),
      baseEvidenceIds: [
        'capital.base.adverse-selection-e1',
        'capital.base.fees-e1',
        'capital.base.latency-e1',
        'capital.base.recovery-e1',
        'capital.base.slippage-e1',
        'capital.base.spread-depth-e1',
      ],
      truth: opportunityTruth,
      ...(overrides.opportunity ?? {}),
    },
  };
}

function owners(options = {}) {
  const calls = { funding: 0, borrow: 0, opportunity: 0 };
  const build = options.build ?? ((scope) => scopedCut(scope, options));
  return {
    calls,
    value: {
      basisEngine: {
        readFundingCost(scope) { calls.funding += 1; return options.missing ? null : build(scope).funding; },
      },
      foundationBorrowTruth: {
        readBorrowCost(scope) { calls.borrow += 1; return options.missing ? null : build(scope).borrow; },
      },
      capitalFoundation: {
        readOpportunityCost(scope) { calls.opportunity += 1; return options.missing ? null : build(scope).opportunity; },
      },
    },
  };
}

function createPorts(capitalEconomicsOwners = null, clock = new ManualClock()) {
  const market = {
    feeds: {}, pairCount: 0,
    async init() {}, start() {}, stop() {}, allRows() { return []; },
    priceUpdatedAt() { return null; }, markEventTimestamp() { return null; },
  };
  const basis = {
    async start() {}, stop() {}, setIntakePaused() { return true; }, intakePaused() { return false; },
    connectionStatus() { return { running: false, lastBookTs: null, lastMarkTs: null, lastError: null }; },
    integrationSnapshot() { return { lastTickTs: null, decisions: [], proposals: [] }; },
  };
  const volume = {
    async start() {}, stop() {}, setIntakePaused() { return true; }, intakePaused() { return false; },
    connectionStatus() {
      return {
        running: false, streamState: 'starting', streamConnections: 0,
        openConnections: 0, lastBookTs: null, lastTradeTs: null,
      };
    },
    integrationSnapshot() { return { lastTickTs: null, decisions: [], proposals: [] }; },
  };
  return createProductionSystemIntegrationPorts({
    clock,
    market,
    basis,
    volume,
    capitalEconomicsOwners,
  });
}

function evaluate(port, value = candidate(), borrow = BORROW_SCOPE) {
  return port.capitalEligibility.evaluate({
    candidates: [value],
    policy: policy(),
    borrowScopes: [{ proposalId: value.intake.proposal.sourceProposalId, scope: borrow }],
  });
}

test('Capital public barrel exposes no owner-claiming economic fact constructor', () => {
  assert.equal('createConservativeEconomicFactBinding' in capitalContracts, false);
});

test('real production factory mounts an honest NOT_CONFIGURED Capital callsite', () => {
  const result = evaluate(createPorts());
  assert.equal(result.state, 'NOT_CONFIGURED');
  assert.equal(result.batch, null);
});

test('factory-owned production call reads every canonical owner once then calls eligibility', () => {
  const owner = owners();
  const result = evaluate(createPorts(owner.value));
  assert.equal(result.state, 'EVALUATED');
  assert.deepEqual(owner.calls, { funding: 1, borrow: 1, opportunity: 1 });
  assert.equal(result.admissions[0].state, 'AVAILABLE');
  assert.equal(result.batch.considerations[0].status, 'ELIGIBLE');
  assert.equal(result.admissions[0].economics.fundingFact.scope.proposalId, PROPOSAL);
  assert.equal(result.admissions[0].economics.borrowFact.borrowScope.accountId, BORROW_SCOPE.accountId);
  assert.ok(result.admissions[0].economics.borrowFact.evidenceIds.includes(borrowTruth().contentDigest));
  assert.ok(result.admissions[0].economics.exactSourceIds.includes('capital.base.fees-e1'));
  assert.equal(result.admissions[0].economics.exactSourceIds.includes('caller-asserted-only'), false);
});

test('borrow economic fact identity is bound to the complete Foundation owner cut digest', () => {
  const firstTruth = borrowTruth();
  const secondTruth = borrowTruth(BORROW_SCOPE, 'LIVE_PRIVATE', NOW, '.alternate-cut');
  assert.notEqual(firstTruth.contentDigest, secondTruth.contentDigest);

  const first = evaluate(createPorts(owners({ borrowTruth: firstTruth }).value));
  const second = evaluate(createPorts(owners({ borrowTruth: secondTruth }).value));
  const firstFact = first.admissions[0].economics.borrowFact;
  const secondFact = second.admissions[0].economics.borrowFact;
  assert.equal(first.admissions[0].state, 'AVAILABLE');
  assert.equal(second.admissions[0].state, 'AVAILABLE');
  assert.ok(firstFact.evidenceIds.includes(firstTruth.contentDigest));
  assert.ok(secondFact.evidenceIds.includes(secondTruth.contentDigest));
  assert.notEqual(firstFact.bindingDigest, secondFact.bindingDigest);
});

test('production rejects unknown admission states before Capital eligibility', () => {
  const value = candidate();
  assert.throws(() => evaluateOpportunityEligibilityWithProductionEconomics(
    [value],
    policy(),
    NOW,
    [{
      state: 'UNKNOWN',
      admissionMode: 'PRODUCTION',
      proposalId: PROPOSAL,
      economics: economics(),
      reasonCodes: [],
    }],
  ), /admission identity is invalid/);
});

test('three new facts cannot substitute for missing canonical base-economics provenance', () => {
  const owner = owners({ opportunity: { baseEvidenceIds: [] } });
  const result = evaluate(createPorts(owner.value));
  assert.equal(result.admissions[0].state, 'BLOCKED');
  assert.equal(result.batch.considerations[0].status, 'BLOCKED');
  assert.deepEqual(result.admissions[0].economics.exactSourceIds, []);
  assert.equal(result.admissions[0].economics.fundingFact, null);
  assert.equal(result.admissions[0].economics.borrowFact, null);
  assert.equal(result.admissions[0].economics.capitalOpportunityFact, null);
});

test('caller-carried forged facts cannot bypass absent production owners', () => {
  const admitted = evaluate(createPorts(owners().value));
  const forged = candidate({
    economics: {
      expectedBorrowScope: BORROW_SCOPE,
      fundingFact: admitted.admissions[0].economics.fundingFact,
      borrowFact: admitted.admissions[0].economics.borrowFact,
      capitalOpportunityFact: admitted.admissions[0].economics.capitalOpportunityFact,
      exactSourceIds: admitted.admissions[0].economics.exactSourceIds,
    },
  });
  const missing = owners({ missing: true });
  const result = evaluate(createPorts(missing.value), forged);
  assert.equal(result.admissions[0].state, 'BLOCKED');
  assert.equal(result.batch.considerations[0].status, 'BLOCKED');
  assert.equal(result.batch.considerations[0].economics.fundingFact, null);
  assert.equal(result.batch.considerations[0].economics.borrowFact, null);
  assert.equal(result.batch.considerations[0].economics.capitalOpportunityFact, null);
  assert.deepEqual(missing.calls, { funding: 1, borrow: 1, opportunity: 1 });
});

test('a content-bound fact cannot replay across proposal identity or revision', () => {
  let firstScope;
  const captured = owners({
    build(scope) {
      firstScope ??= scope;
      return scopedCut(firstScope);
    },
  });
  const first = evaluate(createPorts(captured.value));
  assert.equal(first.admissions[0].state, 'AVAILABLE');
  const secondCandidate = candidate({
    proposal: {
      sourceProposalId: 'basis-proposal-r54-refreshed',
      canonicalProposalId: 'cprop-basis-proposal-r54-refreshed',
      sourceRevision: 'basis-proposal-revision-r55',
      intakeDigest: 'basis-intake-digest-r54-refreshed',
    },
  });
  const second = evaluate(createPorts(captured.value), secondCandidate);
  assert.equal(second.admissions[0].state, 'BLOCKED');
  assert.equal(second.batch.considerations[0].status, 'BLOCKED');
});

test('synthetic owner cuts cannot establish production eligibility', () => {
  const synthetic = owners({
    build(scope) {
      const fundingTruth = truth('basis.synthetic', 'SYNTHETIC_TEST');
      const cuts = scopedCut(scope);
      return {
        ...cuts,
        funding: { ...cuts.funding, ownerRevision: fundingTruth.revision, truth: fundingTruth },
      };
    },
  });
  const result = evaluate(createPorts(synthetic.value));
  assert.equal(result.admissions[0].state, 'BLOCKED');
  assert.equal(result.batch.considerations[0].status, 'BLOCKED');
  assert.equal(result.admissions[0].economics.fundingFact, null);
  assert.equal(result.admissions[0].economics.borrowFact, null);
  assert.equal(result.admissions[0].economics.capitalOpportunityFact, null);
});

test('BorrowTruth exact scope, permission, liability, provenance and current freshness all fail closed', () => {
  const good = borrowTruth();
  const badCases = [
    ['wrong account', { ...good, accountId: 'acct-other' }],
    ['wrong symbol', { ...good, symbol: 'ETHUSDT' }],
    ['wrong asset', { ...good, asset: 'ETH' }],
    ['wrong mode', { ...good, mode: 'ISOLATED', positionBucket: 'MARGIN_ISOLATED' }],
    ['wrong permission', { ...good, permissionId: 'permission-other' }],
    ['forged available reason', { ...good, reason: 'BORROW_AMOUNT_ZERO' }],
    ['missing rate provenance', {
      ...good,
      provenance: { ...good.provenance, rate: null },
      freshness: { ...good.freshness, rate: null },
      hourlyRate: null,
    }],
    ['missing current liability', { ...good, currentBorrowedAsset: null }],
    ['missing liability provenance', {
      ...good,
      provenance: { ...good.provenance, liability: null },
      freshness: { ...good.freshness, liability: null },
    }],
    ['wrong private authority', {
      ...good,
      provenance: {
        ...good.provenance,
        maxBorrow: { ...good.provenance.maxBorrow, authority: 'SYNTHETIC_TEST' },
      },
    }],
  ];
  for (const [label, badTruth] of badCases) {
    const owner = owners({ borrowTruth: badTruth });
    const result = evaluate(createPorts(owner.value));
    assert.equal(result.admissions[0].state, 'BLOCKED', label);
    assert.equal(result.admissions[0].economics.borrowFact, null, label);
    assert.equal(result.admissions[0].economics.fundingFact, null, label);
  }
});

test('freshness is recomputed at call time, not trusted from an old FRESH label', () => {
  const oldBorrow = borrowTruth();
  const clock = new ManualClock(NOW + 1_001);
  const owner = owners({ borrowTruth: oldBorrow });
  const result = evaluate(createPorts(owner.value, clock));
  assert.equal(result.admissions[0].state, 'BLOCKED');
  assert.equal(result.batch.considerations[0].status, 'BLOCKED');
});

test('canonical economics accepts epoch +0 but rejects digest-colliding -0 times', () => {
  const scope = Object.freeze({
    proposalId: 'basis-proposal-zero-r54',
    proposalRevision: 'basis-proposal-zero-revision-r54',
    proposalUpdatedAtMs: 0,
    proposalConfigRevision: 'basis-config-zero-r54',
    correlationId: 'basis-correlation-zero-r54',
    strategy: 'BASIS',
    symbol: 'BTCUSDT',
    instrumentIds: Object.freeze(['BINANCE:SPOT:BTCUSDT', 'BINANCE:USD_M_PERPETUAL:BTCUSDT'].sort()),
  });
  const fundingTruth = truth('basis.funding.zero', 'DERIVED_LIVE', 0);
  const borrowCostTruth = truth('foundation.borrow-cost.zero', 'DERIVED_LIVE', 0);
  const opportunityTruth = truth('capital.opportunity.zero', 'DERIVED_LIVE', 0);
  const cuts = {
    funding: {
      ...scope,
      owner: 'BASIS_ENGINE',
      ownerRevision: fundingTruth.revision,
      valuationAsset: 'USDT',
      component: component(scope, 'FUNDING', '-1', 'basis.funding.zero', 0),
      truth: fundingTruth,
    },
    borrow: {
      ...scope,
      owner: 'FOUNDATION_BORROW_TRUTH',
      ownerRevision: borrowCostTruth.revision,
      valuationAsset: 'USDT',
      component: component(scope, 'BORROW_INTEREST_AND_FEES', '0', 'foundation.borrow-cost.zero', 0),
      truth: borrowCostTruth,
      borrowTruth: borrowTruth(BORROW_SCOPE, 'LIVE_PRIVATE', 0),
    },
    opportunity: {
      ...scope,
      owner: 'CAPITAL_FOUNDATION',
      ownerRevision: opportunityTruth.revision,
      ownerRecordId: 'capital-opportunity-component-zero-r54',
      ownerConfigRevision: 'capital-opportunity-config-zero-r54',
      value: '3',
      valuationAsset: 'USDT',
      evidenceIds: ['capital.opportunity.zero-e1'],
      baseEconomics: baseEconomics(),
      baseEvidenceIds: [
        'capital.base.adverse-selection-e1',
        'capital.base.fees-e1',
        'capital.base.latency-e1',
        'capital.base.recovery-e1',
        'capital.base.slippage-e1',
        'capital.base.spread-depth-e1',
      ],
      truth: opportunityTruth,
    },
  };
  const source = economics();
  const {
    expectedBorrowScope: _expectedBorrowScope,
    fundingFact: _fundingFact,
    borrowFact: _borrowFact,
    capitalOpportunityFact: _capitalOpportunityFact,
    ...projectionEconomics
  } = source;
  const project = (ownerCuts = cuts, inputOverrides = {}) => projectCanonicalConservativeEconomics({
    scope,
    borrowScope: BORROW_SCOPE,
    evaluatedAtMs: 0,
    mode: 'PRODUCTION',
    economics: projectionEconomics,
    port: {
      readCachedBasisFundingCost() { return ownerCuts.funding; },
      readCachedFoundationBorrowCost() { return ownerCuts.borrow; },
      readCachedCapitalOpportunityCost() { return ownerCuts.opportunity; },
    },
    ...inputOverrides,
  });

  const positive = project();
  assert.equal(positive.state, 'AVAILABLE');
  assert.ok(Object.is(positive.economics.fundingFact.scope.proposalUpdatedAtMs, 0));
  assert.equal(Object.is(positive.economics.fundingFact.scope.proposalUpdatedAtMs, -0), false);
  assert.ok(Object.is(positive.economics.fundingFact.source.sourceTimeMs, 0));
  assert.equal(Object.is(positive.economics.fundingFact.source.sourceTimeMs, -0), false);
  assert.equal(
    capitalContracts.capitalDigest({ evaluatedAtMs: 0 }),
    capitalContracts.capitalDigest({ evaluatedAtMs: -0 }),
  );
  assert.throws(() => project(cuts, { evaluatedAtMs: -0 }), /requires exact scope/);
  assert.throws(() => project(cuts, { scope: { ...scope, proposalUpdatedAtMs: -0 } }), /requires exact scope/);

  const hostileCuts = [
    {
      ...cuts,
      funding: { ...cuts.funding, component: { ...cuts.funding.component, observedAtMs: -0 } },
    },
    {
      ...cuts,
      funding: {
        ...cuts.funding,
        truth: {
          ...cuts.funding.truth,
          source: { ...cuts.funding.truth.source, sourceTimeMs: -0 },
        },
      },
    },
    {
      ...cuts,
      opportunity: {
        ...cuts.opportunity,
        truth: {
          ...cuts.opportunity.truth,
          source: { ...cuts.opportunity.truth.source, receivedAtMs: -0 },
        },
      },
    },
    {
      ...cuts,
      funding: {
        ...cuts.funding,
        truth: {
          ...cuts.funding.truth,
          freshness: { ...cuts.funding.truth.freshness, evaluatedAt: -0 },
        },
      },
    },
    {
      ...cuts,
      borrow: {
        ...cuts.borrow,
        borrowTruth: { ...cuts.borrow.borrowTruth, evaluatedAtMs: -0 },
      },
    },
    {
      ...cuts,
      borrow: {
        ...cuts.borrow,
        borrowTruth: {
          ...cuts.borrow.borrowTruth,
          freshness: {
            ...cuts.borrow.borrowTruth.freshness,
            account: { ...cuts.borrow.borrowTruth.freshness.account, evaluatedAt: -0 },
          },
        },
      },
    },
  ];
  for (const ownerCuts of hostileCuts) {
    assert.equal(project(ownerCuts).state, 'BLOCKED');
  }
});

test('canonical owner cuts reject Proxy, accessor, and oversize structures without hostile reads', () => {
  let traps = 0;
  const builders = [
    (cuts) => {
      cuts.funding = new Proxy(cuts.funding, {
        get() { traps += 1; throw new Error('must reject owner-cut Proxy before a get trap'); },
        getPrototypeOf() { traps += 1; throw new Error('must reject owner-cut Proxy before a prototype trap'); },
        ownKeys() { traps += 1; throw new Error('must reject owner-cut Proxy before an ownKeys trap'); },
        getOwnPropertyDescriptor() { traps += 1; throw new Error('must reject owner-cut Proxy before a descriptor trap'); },
      });
    },
    (cuts) => {
      const revoked = Proxy.revocable(cuts.opportunity, {});
      revoked.revoke();
      cuts.opportunity = revoked.proxy;
    },
    (cuts) => {
      cuts.funding.component = new Proxy(cuts.funding.component, {
        get() { traps += 1; throw new Error('must reject component Proxy before a get trap'); },
        ownKeys() { traps += 1; throw new Error('must reject component Proxy before an ownKeys trap'); },
      });
    },
    (cuts) => {
      const revoked = Proxy.revocable(cuts.borrow.truth, {});
      revoked.revoke();
      cuts.borrow.truth = revoked.proxy;
    },
    (cuts) => {
      const source = new Proxy(cuts.opportunity.truth.source, {
        get() { traps += 1; throw new Error('must reject source Proxy before a get trap'); },
        getPrototypeOf() { traps += 1; throw new Error('must reject source Proxy before a prototype trap'); },
        ownKeys() { traps += 1; throw new Error('must reject source Proxy before an ownKeys trap'); },
      });
      cuts.opportunity.truth = { ...cuts.opportunity.truth, source };
    },
    (cuts) => {
      Object.defineProperty(cuts.funding, 'ownerRevision', {
        enumerable: true,
        configurable: true,
        get() { traps += 1; throw new Error('must reject accessor-backed owner cuts'); },
      });
    },
    (cuts) => {
      cuts.funding.component = {
        ...cuts.funding.component,
        status: 'ESTIMATED',
        estimateRange: { low: '-1', high: '-1', extra: 'schema-drift' },
      };
    },
    (cuts) => {
      const revoked = Proxy.revocable(cuts.opportunity.evidenceIds, {});
      revoked.revoke();
      cuts.opportunity.evidenceIds = revoked.proxy;
    },
    (cuts) => {
      cuts.opportunity.baseEvidenceIds = new Proxy(cuts.opportunity.baseEvidenceIds, {
        get() { traps += 1; throw new Error('must reject Proxy before a trap'); },
        ownKeys() { traps += 1; throw new Error('must reject Proxy before a trap'); },
      });
    },
    (cuts) => {
      const accessorIds = [...cuts.opportunity.evidenceIds];
      Object.defineProperty(accessorIds, '0', {
        enumerable: true,
        configurable: true,
        get() { traps += 1; throw new Error('must not read an accessor-backed ID'); },
      });
      cuts.opportunity.evidenceIds = accessorIds;
    },
    (cuts) => {
      const oversize = new Array(101);
      Object.defineProperty(oversize, '0', {
        enumerable: true,
        configurable: true,
        get() { traps += 1; throw new Error('must enforce the bound before materialization'); },
      });
      cuts.opportunity.evidenceIds = oversize;
    },
    (cuts) => {
      const revoked = Proxy.revocable(cuts.borrow.borrowTruth, {});
      revoked.revoke();
      cuts.borrow.borrowTruth = revoked.proxy;
    },
    (cuts) => {
      Object.defineProperty(cuts.opportunity.baseEconomics, 'estimatedFees', {
        enumerable: true,
        configurable: true,
        get() { traps += 1; throw new Error('must reject accessor-backed records'); },
      });
    },
  ];
  for (const mutate of builders) {
    const owner = owners({
      build(scope) {
        const cuts = scopedCut(scope);
        mutate(cuts);
        return cuts;
      },
    });
    let result;
    assert.doesNotThrow(() => { result = evaluate(createPorts(owner.value)); });
    assert.equal(result.state, 'EVALUATED');
    assert.equal(result.admissions[0].state, 'BLOCKED');
    assert.equal(result.batch.considerations[0].status, 'BLOCKED');
  }
  assert.equal(traps, 0);
});

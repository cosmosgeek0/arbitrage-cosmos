import test from 'node:test';
import assert from 'node:assert/strict';

import { assessCapitalTruth } from '../../../dist/capitalFoundation/contracts/index.js';
import { projectCanonicalConservativeEconomics } from '../../../dist/systemIntegration/adapters/index.js';
import { projectProductionCanonicalEconomics } from '../../../dist/systemIntegration/production/index.js';

const NOW = 1_900_000_000_000;
const PROPOSAL = 'basis-proposal-r54';

function truth(sourceId, authority = 'SYNTHETIC_TEST') {
  return assessCapitalTruth({
    source: {
      sourceTimeMs: NOW - 100,
      receivedAtMs: NOW - 90,
      maxAgeMs: 1_000,
      authority,
      completeness: 'COMPLETE',
      sourceId,
    },
    evaluatedAtMs: NOW,
    requiredValuePresent: true,
    revision: `${sourceId}-r1`,
  });
}

function economics() {
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
    exactSourceIds: ['caller-asserted-only'],
    missingFields: [],
  };
}

function component(kind, amount, sourceId) {
  return {
    id: `${kind.toLowerCase()}-component`,
    kind,
    status: 'KNOWN',
    amount,
    estimateRange: null,
    valuationAsset: 'USDT',
    observedAtMs: NOW - 100,
    sourceIds: [sourceId],
    reasonCodes: [],
    strategy: 'BASIS',
    opportunityId: PROPOSAL,
    configRevision: 'basis-config-r1',
    stage: null,
    symbol: 'BTCUSDT',
    legId: null,
    correlationId: 'basis-correlation-r54',
  };
}

test('free-form source IDs cannot substitute for absent canonical owner acquisition', () => {
  const projected = projectCanonicalConservativeEconomics({
    proposalId: PROPOSAL,
    mode: 'PRODUCTION',
    economics: economics(),
    port: {
      readCachedBasisFundingCost: () => null,
      readCachedFoundationBorrowCost: () => null,
      readCachedCapitalOpportunityCost: () => null,
    },
  });
  assert.equal(projected.state, 'BLOCKED');
  assert.equal(projected.economics.fundingFact, null);
  assert.equal(projected.economics.borrowFact, null);
  assert.equal(projected.economics.capitalOpportunityFact, null);
  assert.deepEqual(projected.reasonCodes, [
    'BORROW_OWNER_CUT_MISSING',
    'CAPITAL_OPPORTUNITY_OWNER_CUT_MISSING',
    'FUNDING_OWNER_CUT_MISSING',
  ]);
});

test('exact owner value, unit, scope, authority, revision and completeness bind together', () => {
  const fundingTruth = truth('basis.funding');
  const borrowTruthMetadata = truth('foundation.borrow');
  const capitalTruth = truth('capital.opportunity');
  const projected = projectCanonicalConservativeEconomics({
    proposalId: PROPOSAL,
    mode: 'SYNTHETIC_TEST',
    economics: economics(),
    port: {
      readCachedBasisFundingCost: () => ({
        owner: 'BASIS_ENGINE',
        ownerRevision: fundingTruth.revision,
        proposalId: PROPOSAL,
        valuationAsset: 'USDT',
        component: component('FUNDING', '-1', 'basis.funding-e1'),
        truth: fundingTruth,
      }),
      readCachedFoundationBorrowCost: () => ({
        owner: 'FOUNDATION_BORROW_TRUTH',
        ownerRevision: borrowTruthMetadata.revision,
        proposalId: PROPOSAL,
        valuationAsset: 'USDT',
        component: component('BORROW_INTEREST_AND_FEES', '0', 'foundation.borrow-e1'),
        truth: borrowTruthMetadata,
        borrowTruth: {
          state: 'AVAILABLE',
          provenance: {
            account: null,
            permission: null,
            maxBorrow: {
              sourceTimeMs: NOW - 100,
              receivedAtMs: NOW - 90,
              maxAgeMs: 1_000,
              authority: 'SYNTHETIC_TEST',
              completeness: 'COMPLETE',
              sourceId: 'foundation.borrow.max',
            },
            rate: null,
          },
        },
      }),
      readCachedCapitalOpportunityCost: () => ({
        owner: 'CAPITAL_FOUNDATION',
        ownerRevision: capitalTruth.revision,
        value: '3',
        valuationAsset: 'USDT',
        proposalId: PROPOSAL,
        evidenceIds: ['capital.opportunity-e1'],
        truth: capitalTruth,
      }),
    },
  });
  assert.equal(projected.state, 'AVAILABLE');
  assert.equal(projected.economics.fundingFact.value, '-1');
  assert.equal(projected.economics.borrowFact.owner, 'FOUNDATION_BORROW_TRUTH');
  assert.equal(projected.economics.capitalOpportunityFact.unit, 'USDT');
  assert.deepEqual(projected.reasonCodes, []);
});

test('a misowned cut cannot be relabelled as canonical funding', () => {
  const fundingTruth = truth('basis.funding');
  const projected = projectCanonicalConservativeEconomics({
    proposalId: PROPOSAL,
    mode: 'SYNTHETIC_TEST',
    economics: economics(),
    port: {
      readCachedBasisFundingCost: () => ({
        owner: 'FOUNDATION_BORROW_TRUTH',
        ownerRevision: fundingTruth.revision,
        proposalId: PROPOSAL,
        valuationAsset: 'USDT',
        component: component('FUNDING', '-1', 'hostile.funding'),
        truth: fundingTruth,
      }),
      readCachedFoundationBorrowCost: () => null,
      readCachedCapitalOpportunityCost: () => null,
    },
  });
  assert.equal(projected.state, 'BLOCKED');
  assert.equal(projected.economics.fundingFact, null);
  assert.ok(projected.reasonCodes.includes('FUNDING_OWNER_CUT_MISMATCH'));
});

test('production callsite rejects exact synthetic owner cuts outside synthetic mode', () => {
  const fundingTruth = truth('basis.funding');
  const borrowTruthMetadata = truth('foundation.borrow');
  const capitalTruth = truth('capital.opportunity');
  const fundingCut = {
    owner: 'BASIS_ENGINE',
    ownerRevision: fundingTruth.revision,
    proposalId: PROPOSAL,
    valuationAsset: 'USDT',
    component: component('FUNDING', '-1', 'basis.funding-e1'),
    truth: fundingTruth,
  };
  const borrowCut = {
    owner: 'FOUNDATION_BORROW_TRUTH',
    ownerRevision: borrowTruthMetadata.revision,
    proposalId: PROPOSAL,
    valuationAsset: 'USDT',
    component: component('BORROW_INTEREST_AND_FEES', '0', 'foundation.borrow-e1'),
    truth: borrowTruthMetadata,
    borrowTruth: { state: 'AVAILABLE', provenance: { account: null, permission: null, maxBorrow: null, rate: null } },
  };
  const projected = projectProductionCanonicalEconomics({
    proposalId: PROPOSAL,
    economics: economics(),
    owners: {
      basisEngine: { readFundingCost: () => fundingCut },
      foundationBorrowTruth: { readBorrowCost: () => borrowCut },
      capitalFoundation: {
        readOpportunityCost: () => ({
          owner: 'CAPITAL_FOUNDATION',
          ownerRevision: capitalTruth.revision,
          value: '3',
          valuationAsset: 'USDT',
          proposalId: PROPOSAL,
          evidenceIds: ['capital.opportunity-e1'],
          truth: capitalTruth,
        }),
      },
    },
  });
  assert.equal(projected.state, 'BLOCKED');
  assert.ok(projected.reasonCodes.includes('ECONOMIC_FACT_AUTHORITY_MODE_MISMATCH'));
});

#!/usr/bin/env node
/**
 * M1-I1 — accepted Basis provenance -> immutable validate-only plan.
 *
 * All evidence is deterministic synthetic data. Any network touch fails.
 * Run after `npm run build -w server`.
 */
import assert from 'node:assert/strict';
import nodeTest from 'node:test';
import { pathToFileURL } from 'node:url';

const importedTestNoop = Object.assign(() => {}, {
  after: () => {},
});
const isDirectTest =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
const test = isDirectTest ? nodeTest : importedTestNoop;

import {
  BASIS_VALIDATE_ONLY_PLAN_BINDING_SCHEMA,
  DEFAULT_BASIS_VALIDATE_ONLY_CONTROLS,
  bindBasisValidateOnlyPlan,
  createBasisValidateOnlyCapitalProof,
  isBasisValidateOnlyPlanBinding,
} from '../../../dist/foundation/execution/basisValidateOnly/planBinding.js';
import {
  addExactDecimals,
  assessCapitalTruth,
  createSyntheticConservativeEconomicFactBinding,
  multiplyExactDecimals,
} from '../../../dist/capitalFoundation/contracts/index.js';
import {
  deriveOpportunityEligibilityPolicyRevision,
} from '../../../dist/capitalFoundation/opportunities/index.js';
import {
  deriveCapitalBudgetPolicyRevision,
} from '../../../dist/capitalFoundation/budgets/index.js';
import {
  createStagedPlanConfiguration,
} from '../../../dist/capitalFoundation/stages/index.js';
import {
  createExecutionPlanDefinition,
} from '../../../dist/foundation/execution/plan.js';
import {
  deriveRiskIntentDigest,
} from '../../../dist/foundation/risk/index.js';
import {
  BasisHandoffLifecycle,
} from '../../../dist/engine/basis/lifecycle.js';

export const NOW = 1_900_000_000_000;
const CAPITAL_AT = NOW - 1_000;
const ACCEPTED_REVISION_AT = CAPITAL_AT - 100;
const DAY_MS = 86_400_000;
const DAY_START = Math.floor(NOW / DAY_MS) * DAY_MS;
const SYMBOL = 'BTCUSDT';
const ACCOUNT = 'm1-i1-validate-only';
const PROPOSAL_ID = 'bp_m1_i1_accepted';
const CANONICAL_PROPOSAL_ID = 'cprop_m1_i1_accepted';
const PROPOSAL_CORRELATION_ID = 'basis:m1-i1:accepted';

let networkAttempts = 0;
const originalFetch = globalThis.fetch;
if (isDirectTest) {
  globalThis.fetch = async () => {
    networkAttempts += 1;
    throw new Error('network forbidden in validate-only plan-binding proof');
  };
}

function stamp(sourceId, overrides = {}) {
  return {
    sourceTimeMs: NOW - 10,
    receivedAtMs: NOW - 5,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId,
    ...overrides,
  };
}

function filters(sourceId, venue) {
  return {
    venue,
    symbol: SYMBOL,
    minPrice: 1,
    maxPrice: 1_000_000,
    tickSize: 0.1,
    minQty: 0.001,
    maxQty: 100,
    stepSize: 0.001,
    minNotionalUsd: 5,
    maxNotionalUsd: 1_000_000,
    observedAt: stamp(sourceId),
  };
}

function basePlanInput(overrides = {}) {
  const proposal = overrides.proposal ?? {
    canonicalProposalId: CANONICAL_PROPOSAL_ID,
    observedAtMs: NOW - 100,
    maxAgeMs: 10_000,
    expiresAtMs: NOW + 6_000,
  };
  return {
    strategy: 'BASIS',
    direction: 'LONG_SPOT_SHORT_PERP',
    symbol: SYMBOL,
    proposal,
    attempt: 0,
    mode: 'VALIDATE_ONLY',
    requiresApproval: false,
    maxNakedDurationMs: 1_000,
    spotQuantity: 1,
    perpQuantity: 1,
    openingOrder: ['SPOT', 'PERP'],
    ...overrides,
    proposal,
  };
}

function approvedRiskInput(plan) {
  const intent = {
    planId: plan.planId,
    accountId: ACCOUNT,
    proposalRef: CANONICAL_PROPOSAL_ID,
    riskClass: 'RISK_INCREASING',
    legs: [
      {
        legKey: 'SPOT_OPEN',
        venue: 'BINANCE_SPOT',
        symbol: SYMBOL,
        side: 'BUY',
        intendedPrice: 30,
        intendedQty: plan.openingLegs.SPOT.quantity,
        requiredPermission: 'SPOT',
        positionBucket: 'SPOT_CASH',
        estimatedRequiredMarginUsd: 0,
      },
      {
        legKey: 'PERP_OPEN',
        venue: 'BINANCE_USDM',
        symbol: SYMBOL,
        side: 'SELL',
        intendedPrice: 30,
        intendedQty: plan.openingLegs.PERP.quantity,
        requiredPermission: 'FUTURES',
        positionBucket: 'USDM_ONE_WAY',
        estimatedRequiredMarginUsd: 30 * plan.openingLegs.PERP.quantity,
      },
    ],
    declaredMaxNakedDurationMs: plan.maxNakedDurationMs,
    estimatedRequiredMarginUsd: 30 * plan.openingLegs.PERP.quantity,
    requiredBorrowUsd: 0,
  };
  const intentDigest = deriveRiskIntentDigest(intent);
  return {
    correlationId: plan.correlationId,
    nowMs: NOW,
    intent,
    proposal: {
      proposalId: CANONICAL_PROPOSAL_ID,
      entryIntentDigest: intentDigest,
      lifecycle: 'OPEN',
      expiresAtMs: NOW + 4_000,
      observedAt: stamp('strategy.proposal'),
    },
    approval: {
      approvalId: 'approval-m1-i1-risk-only',
      subjectPlanId: plan.planId,
      authorizedRiskClass: 'RISK_INCREASING',
      intentDigest,
      grantedAtMs: NOW - 500,
      expiresAtMs: NOW + 3_000,
      observedAt: stamp('control.risk-approval'),
    },
    killSwitch: {
      accountId: ACCOUNT,
      engaged: false,
      observedAt: stamp('control.kill-switch'),
      reason: null,
    },
    market: {
      legs: [
        {
          legKey: 'SPOT_OPEN',
          venue: 'BINANCE_SPOT',
          symbol: SYMBOL,
          referencePrice: 30,
          observedAt: stamp('binance.spot.book'),
          spreadPct: 0.01,
          topDepthUsd: 10_000,
          filters: filters('binance.spot.filters', 'BINANCE_SPOT'),
        },
        {
          legKey: 'PERP_OPEN',
          venue: 'BINANCE_USDM',
          symbol: SYMBOL,
          referencePrice: 30,
          observedAt: stamp('binance.usdm.book'),
          spreadPct: 0.01,
          topDepthUsd: 10_000,
          filters: filters('binance.usdm.filters', 'BINANCE_USDM'),
        },
      ],
      edgeIntentDigest: intentDigest,
      netEdgePct: 0.5,
      estimatedCostPct: 0.1,
      estimatedSlippagePct: 0.01,
      edgeObservedAt: stamp('strategy.edge'),
    },
    account: {
      accountId: ACCOUNT,
      permissions: {
        accountId: ACCOUNT,
        spot: true,
        margin: true,
        futures: true,
        observedAt: stamp('binance.account.permissions'),
      },
      spotInventory: [{
        accountId: ACCOUNT,
        symbol: SYMBOL,
        availableBaseQty: 10,
        availableQuoteUsd: 10_000,
        observedAt: stamp('binance.spot.account.position'),
      }],
      exposures: {
        accountId: ACCOUNT,
        positionMode: 'ONE_WAY',
        positions: [
          {
            venue: 'BINANCE_SPOT',
            symbol: SYMBOL,
            positionBucket: 'SPOT_CASH',
            signedBaseQty: 2,
            observedAt: stamp('binance.spot.account.baseline'),
          },
          {
            venue: 'BINANCE_USDM',
            symbol: SYMBOL,
            positionBucket: 'USDM_ONE_WAY',
            signedBaseQty: -2,
            observedAt: stamp('binance.usdm.account.baseline'),
          },
        ],
        observedAt: stamp('binance.account.exposures'),
      },
      marginHeadrooms: [{
        accountId: ACCOUNT,
        positionBucket: 'USDM_ONE_WAY',
        scopeSymbol: null,
        availableMarginUsd: 1_000,
        observedAt: stamp('binance.usdm.account.margin'),
      }],
      liquidations: [{
        legKey: 'PERP_OPEN',
        accountId: ACCOUNT,
        venue: 'BINANCE_USDM',
        symbol: SYMBOL,
        intentDigest,
        projectedSignedBaseQty: -plan.openingLegs.PERP.quantity,
        markPrice: 30,
        liquidationPrice: 45,
        observedAt: stamp('risk.liquidation-projection'),
      }],
      dailyRealizedLossUsd: 0,
      dailyTradedNotionalUsd: 0,
      dailyPeriodStartMs: DAY_START,
      dailyPeriodEndMs: DAY_START + DAY_MS,
      dailyStatsObservedAt: stamp('ledger.daily-stats'),
      openOrders: {
        total: 0,
        perSymbol: {},
        observedAt: stamp('binance.account.open-orders'),
      },
    },
    borrow: null,
    existingPlans: {
      accountId: ACCOUNT,
      plans: [],
      observedAt: stamp('coordinator.plan-registry'),
    },
    cooldown: {
      accountId: ACCOUNT,
      symbols: [SYMBOL],
      lastEntryAtMs: null,
      observedAt: stamp('coordinator.cooldown'),
    },
    policy: {
      verdictTtlMs: 5_000,
      minEvidenceAuthority: 'SYNTHETIC_TEST',
      maxSpotPerpSkewMs: 50,
      minLegNotionalUsd: 5,
      maxLegNotionalUsd: 200,
      maxGrossNotionalUsd: 400,
      maxHedgeRatioDeviationPct: 1,
      maxResidualDeltaUsd: 1,
      maxNakedDurationMs: 5_000,
      minNetEdgePct: 0.2,
      maxSpreadPct: 0.1,
      minTopDepthUsd: 1_000,
      maxSlippagePct: 0.1,
      marginHeadroomBufferPct: 10,
      minLiquidationDistancePct: 20,
      maxLiquidationReferenceDriftPct: 1,
      maxBorrowHourlyRatePct: 0.5,
      maxDailyLossUsd: 1_000,
      maxDailyNotionalUsd: 10_000,
      maxOpenOrdersPerSymbol: 5,
      maxTotalOpenOrders: 10,
      cooldownMs: 1_000,
    },
  };
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function capitalTruth(sourceId, evaluatedAtMs = CAPITAL_AT, overrides = {}) {
  return assessCapitalTruth({
    source: {
      sourceTimeMs: evaluatedAtMs - 10,
      receivedAtMs: evaluatedAtMs - 5,
      maxAgeMs: 20_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId,
      ...(overrides.source ?? {}),
    },
    evaluatedAtMs,
    requiredValuePresent: true,
    revision: `truth:${sourceId}`,
    ...(overrides.assessment ?? {}),
  });
}

function economicFact(kind, value, sourceId, acceptedRevisionAt) {
  const expectedBorrowScope = {
    accountId: ACCOUNT,
    symbol: SYMBOL,
    asset: 'BTC',
    mode: 'CROSS_CLASSIC',
    permissionId: 'synthetic-no-borrow',
  };
  return createSyntheticConservativeEconomicFactBinding({
    kind,
    scope: {
      proposalId: PROPOSAL_ID,
      proposalRevision: null,
      proposalUpdatedAtMs: acceptedRevisionAt,
      proposalConfigRevision: 'basis-config:m1-i1',
      correlationId: PROPOSAL_CORRELATION_ID,
      strategy: 'BASIS',
      symbol: SYMBOL,
      instrumentIds: [`${SYMBOL}:PERP`, `${SYMBOL}:SPOT`],
      ownerRecordId: `${sourceId}:record`,
      ownerConfigRevision: 'basis-config:m1-i1',
    },
    borrowScope: kind === 'BORROW'
      ? {
          ...expectedBorrowScope,
          truthEvaluatedAtMs: CAPITAL_AT - 10,
          truthExpiresAtMs: CAPITAL_AT + 10_000,
        }
      : null,
    value,
    unit: 'USDT',
    source: {
      sourceTimeMs: CAPITAL_AT - 10,
      receivedAtMs: CAPITAL_AT - 5,
      maxAgeMs: 20_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId,
    },
    ownerRevision: `${sourceId}:r1`,
    completeness: 'COMPLETE',
    evidenceIds: [`${sourceId}:e1`],
  });
}

function eligibilityCandidate({
  acceptedRevisionAt = ACCEPTED_REVISION_AT,
  requestedCapital = '100',
} = {}) {
  const expectedBorrowScope = {
    accountId: ACCOUNT,
    symbol: SYMBOL,
    asset: 'BTC',
    mode: 'CROSS_CLASSIC',
    permissionId: 'synthetic-no-borrow',
  };
  const proposal = {
    sourceProposalId: PROPOSAL_ID,
    canonicalProposalId: CANONICAL_PROPOSAL_ID,
    sourceCorrelationId: PROPOSAL_CORRELATION_ID,
    strategy: 'BASIS',
    symbol: SYMBOL,
    direction: 'long_spot_short_perp',
    sourceLifecycle: 'OPEN',
    sourceRevision: null,
    sourceConfigRevision: 'basis-config:m1-i1',
    createdAtMs: acceptedRevisionAt - 100,
    updatedAtMs: acceptedRevisionAt,
    expiresAtMs: CAPITAL_AT + 10_000,
    intakeDigest: 'intake_m1_i1_accepted',
  };
  return {
    intake: {
      proposal,
      economics: {
        valuationAsset: 'USDT',
        requestedCapital,
        expectedGrossEdge: '0.5',
        expectedNetEdge: '0.5',
        estimatedFees: '0',
        estimatedFunding: '0',
        estimatedBorrowCost: '0',
        estimatedSpreadCost: '0',
        estimatedSlippage: '0',
        estimatedLatencyCost: '0',
        estimatedAdverseSelectionCost: '0',
        estimatedRecoveryCost: '0',
        estimatedCapitalOpportunityCost: '0',
        liquidityCapacity: requestedCapital,
        expectedBorrowScope,
        fundingFact: economicFact(
          'FUNDING',
          '0',
          'capital.synthetic.funding',
          acceptedRevisionAt,
        ),
        borrowFact: economicFact(
          'BORROW',
          '0',
          'capital.synthetic.borrow',
          acceptedRevisionAt,
        ),
        capitalOpportunityFact: economicFact(
          'CAPITAL_OPPORTUNITY',
          '0',
          'capital.synthetic.opportunity',
          acceptedRevisionAt,
        ),
        exactSourceIds: ['capital.synthetic:m1-i1'],
        missingFields: [],
      },
      truth: capitalTruth('capital.synthetic.intake'),
      lossReport: {
        omittedFields: ['netEdgePct', 'confidence', 'evidence'],
        missingSourceFields: ['sourceRevision'],
        translationReasons: [
          'SOURCE_REVISION_NOT_EXPORTED',
          'UPSTREAM_FLOATING_FINANCIAL_FIELDS_OMITTED',
        ],
        financialNumbersAccepted: false,
      },
    },
    structure: {
      kind: 'BASIS_TWO_LEG',
      spotInstrumentId: `${SYMBOL}:SPOT`,
      perpetualInstrumentId: `${SYMBOL}:PERP`,
    },
    requiredEvidenceIds: [],
    evidenceReferences: [],
    thesisReference: null,
    conflictScope: { exclusiveCapitalClaimIds: [] },
  };
}

function eligibilityPolicy() {
  const draft = {
    authority: {
      revision: 'pending-content-address',
      sourceId: 'capital.synthetic.eligibility-policy',
      issuedAtMs: CAPITAL_AT - 2_000,
      effectiveFromMs: CAPITAL_AT - 1_000,
      effectiveUntilMs: CAPITAL_AT + 20_000,
    },
    acceptedProposalConfigRevisions: {
      BASIS: ['basis-config:m1-i1'],
      VOLUME: ['volume-config:unused'],
    },
    acceptedEvidenceConfigRevisions: {
      BASIS: ['evidence-config:m1-i1'],
      VOLUME: ['evidence-config:unused'],
    },
    evidenceRequirement: { BASIS: 'OPTIONAL', VOLUME: 'OPTIONAL' },
    basisMode: 'MANUAL_ARMED',
    volumeMode: 'ADVISORY',
  };
  return {
    ...draft,
    authority: {
      ...draft.authority,
      revision: deriveOpportunityEligibilityPolicyRevision(draft),
    },
  };
}

const exactBound = (value, maximum = '1000') => ({
  value,
  minimum: '0',
  maximum,
  unit: 'USDT',
});
const integerBound = (value, maximum, unit = 'COUNT') => ({
  value,
  minimum: 0,
  maximum,
  unit,
});

function allocationPolicy() {
  const draft = {
    authority: {
      revision: 'pending-content-address',
      sourceId: 'capital.synthetic.allocation-policy',
      issuedAtMs: CAPITAL_AT - 2_000,
      effectiveFromMs: CAPITAL_AT - 1_000,
      effectiveUntilMs: CAPITAL_AT + 20_000,
    },
    valuationAsset: 'USDT',
    portfolioGrossLimit: exactBound('1000'),
    portfolioNetLimit: exactBound('500'),
    perStrategyLimits: {
      BASIS: exactBound('500'),
      VOLUME: exactBound('100'),
    },
    perSymbolLimit: exactBound('500'),
    perCorrelatedGroupLimit: exactBound('500'),
    perVenueInstrumentLimit: exactBound('500'),
    riskReductionReserve: exactBound('20'),
    maximumConcurrentPlans: integerBound(10, 20),
    maximumActivePositions: integerBound(10, 20),
    reservationTtlMs: integerBound(10_000, 20_000, 'MILLISECONDS'),
  };
  return {
    ...draft,
    authority: {
      ...draft.authority,
      revision: deriveCapitalBudgetPolicyRevision(draft),
    },
  };
}

function allocationSnapshot(allocationCap = '80') {
  return {
    valuationAsset: 'USDT',
    truth: capitalTruth('capital.synthetic.budget'),
    entryCollateralAvailable: allocationCap,
    protectedRiskReductionReserve: '20',
    collateralPoolBinding: {
      sourcePoolId: 'ACCOUNT:USDT:COLLATERAL',
      sourcePoolTotal: addExactDecimals(allocationCap, '20'),
      otherUnavailableCollateral: '0',
    },
    marginHeadroomAvailable: allocationCap,
    grossExposureAndCommitments: '0',
    netDirectionalExposure: '0',
    strategyUse: [],
    symbolUse: [],
    correlatedGroupUse: [],
    venueInstrumentUse: [],
    currentConcurrentPlans: 0,
    currentActivePositions: 0,
    borrowCapacityByAsset: [{ key: 'BTC', amount: '500' }],
    liquidityCapacityByKey: [{ key: `${SYMBOL}:SPOT`, amount: '500' }],
    commitmentCoverage: {
      orders: 'COMPLETE',
      reservations: 'COMPLETE',
      plans: 'COMPLETE',
      partiallyExposedPositions: 'COMPLETE',
      activePositions: 'COMPLETE',
    },
    commitments: [],
  };
}

function allocationTerms(requestedCapital = '100') {
  return {
    sizingAuthoritySourceId: 'capital.synthetic.sizing',
    grossExposureIncrease: requestedCapital,
    netDirectionalExposureDelta: '0',
    collateralRequired: requestedCapital,
    marginRequired: requestedCapital,
    strategyRequirements: [{ key: 'BASIS', amount: requestedCapital }],
    symbolRequirements: [{ key: SYMBOL, amount: requestedCapital }],
    correlatedGroupRequirements: [{ key: 'BTC', amount: requestedCapital }],
    venueInstrumentRequirements: [{
      key: `BINANCE:${SYMBOL}:PAIR`,
      amount: requestedCapital,
    }],
    borrowRequired: false,
    borrowRequirements: [],
    liquidityRequirements: [{ key: `${SYMBOL}:SPOT`, amount: requestedCapital }],
  };
}

function stage(stageName, sequence, maximumTotalExposure, maximumAdditionalExposure, reservationConsumption, next) {
  const increasing = stageName === 'CONFIRM' || stageName === 'ADD';
  return {
    stage: stageName,
    sequence,
    maximumAdditionalExposure,
    maximumTotalExposure,
    reservationConsumption,
    prerequisites: increasing
      ? [{
          code: `${stageName}_SYNTHETIC_EVIDENCE`,
          required: true,
          evidenceMaximumAgeMs: 1_000,
          detail: 'sealed synthetic fixture evidence',
        }]
      : [],
    economicThesisConditions: increasing ? [`${stageName}_THESIS`] : [],
    invalidationConditions: increasing ? [`${stageName}_INVALID`] : [],
    maximumTimeInStageMs: 1_000,
    requiredApprovalActions: stageName === 'CONFIRM'
      ? ['OPEN']
      : stageName === 'ADD'
        ? ['ADD']
        : [],
    requiredFutureGates: increasing
      ? [
          'OPERATOR_APPROVAL',
          'MULTI_LEG_RISK',
          'FRESH_ACCOUNT_TRUTH',
          'FRESH_MARKET_EVIDENCE',
        ]
      : [],
    liquidityRequirement: increasing ? '100' : null,
    maximumNakedLegAmount: increasing ? '5' : '0',
    maximumNakedLegDurationMs: increasing ? 1_000 : 0,
    stopAddingConditions: increasing ? [`${stageName}_STOP`] : [],
    allowedNextStages: next === null ? [] : [next],
    reductionConditions: stageName === 'REDUCE' ? ['TARGET_REACHED'] : [],
    cancellableBeforeEntry: true,
    nextStageConditions: next === null
      ? []
      : [{ targetStage: next, conditions: [`${stageName}_TO_${next}`] }],
    skipConditions: stageName === 'OBSERVE'
      ? [{
          targetStage: 'CONFIRM',
          skippedStages: ['PROBE'],
          conditions: ['PROBE_NOT_REQUIRED'],
        }]
      : [],
    unenteredCancellationConditions: ['PROPOSAL_EXPIRED'],
  };
}

function stagedPlanStages(allocationCap = '80') {
  const first = String(Math.min(30, Number(allocationCap)));
  const second = String(Number(allocationCap) - Number(first));
  return [
    stage('OBSERVE', 0, '0', '0', '0', 'CONFIRM'),
    stage('CONFIRM', 1, first, first, first, 'ADD'),
    stage('ADD', 2, allocationCap, second, second, 'HOLD'),
    stage('HOLD', 3, allocationCap, '0', '0', 'REDUCE'),
    stage('REDUCE', 4, first, '0', '0', 'EXIT'),
    stage('EXIT', 5, '0', '0', '0', null),
  ];
}

function stagedPlanConfiguration() {
  return createStagedPlanConfiguration({
    sourceId: 'capital.synthetic.staged-plan-policy',
    issuedAtMs: CAPITAL_AT - 2_000,
    effectiveFromMs: CAPITAL_AT - 1_000,
    effectiveUntilMs: CAPITAL_AT + 20_000,
    maximumPlanExposure: {
      value: '200',
      minimum: '0',
      maximum: '500',
      unit: 'USDT',
    },
    maximumPlanDurationMs: {
      value: 10_000,
      minimum: 1,
      maximum: 20_000,
      unit: 'MILLISECONDS',
    },
    maximumStageDurationMs: {
      value: 1_000,
      minimum: 1,
      maximum: 2_000,
      unit: 'MILLISECONDS',
    },
    maximumEvidenceAgeMs: {
      value: 1_000,
      minimum: 1,
      maximum: 2_000,
      unit: 'MILLISECONDS',
    },
    maximumNakedLegAmount: {
      value: '5',
      minimum: '0',
      maximum: '10',
      unit: 'USDT',
    },
    maximumNakedLegDurationMs: {
      value: 1_000,
      minimum: 1,
      maximum: 2_000,
      unit: 'MILLISECONDS',
    },
  });
}

function makeCapitalProofInput({
  acceptedRevisionAt = ACCEPTED_REVISION_AT,
  requestedCapital = '100',
  allocationCap = '80',
  spotPriceExact = '30',
  spotQuantityExact = '1',
  perpPriceExact = '30',
  perpQuantityExact = '1',
  stagedPlanExpiresAtMs = CAPITAL_AT + 8_000,
  mandateExpiresAtMs = CAPITAL_AT + 7_000,
} = {}) {
  return deepFreeze({
    eligibilityCandidate: eligibilityCandidate({
      acceptedRevisionAt,
      requestedCapital,
    }),
    eligibilityPolicy: eligibilityPolicy(),
    evaluatedAtMs: CAPITAL_AT,
    allocationPolicy: allocationPolicy(),
    allocationSnapshot: allocationSnapshot(allocationCap),
    allocationTerms: allocationTerms(requestedCapital),
    reservationCommandId: 'capital-reserve:m1-i1',
    capitalClaimKey: 'basis-validate-only:m1-i1',
    stagedPlanConfiguration: stagedPlanConfiguration(),
    stagedPlanStages: stagedPlanStages(allocationCap),
    stagedPlanActiveStage: 'OBSERVE',
    stagedPlanExpiresAtMs,
    stagedPlanBuildCorrelationId: 'capital-stage:m1-i1',
    mandateExpiresAtMs,
    mandateBuildCorrelationId: 'capital-mandate:m1-i1',
    spotPriceExact,
    spotQuantityExact,
    perpPriceExact,
    perpQuantityExact,
  });
}

function makeCapitalProof(options = {}) {
  const constructionInput = makeCapitalProofInput(options);
  const result = createBasisValidateOnlyCapitalProof(constructionInput);
  assert.equal(result.ok, true, result.code);
  return { proof: result.proof, constructionInput };
}

function makeHandoff({
  acceptedRevisionAt = ACCEPTED_REVISION_AT,
  acceptedNotionalUsd = 100,
} = {}) {
  const acceptance = Object.freeze({
    proposalId: PROPOSAL_ID,
    correlationId: PROPOSAL_CORRELATION_ID,
    symbol: SYMBOL,
    direction: 'long_spot_short_perp',
    acceptedBy: 'owner',
    acceptedTs: acceptedRevisionAt + 25,
    acceptedRevisionTs: acceptedRevisionAt,
    acceptedNetEdgePct: 0.5,
    acceptedNotionalUsd,
  });
  const boundAt = acceptedRevisionAt + 50;
  const lifecycle = new BasisHandoffLifecycle(
    { now: () => boundAt },
    {
      consumeAcceptance(proposalId, observedBoundAt) {
        assert.equal(proposalId, PROPOSAL_ID);
        assert.equal(observedBoundAt, boundAt);
        return { ok: true, acceptance };
      },
    },
    { enabled: true },
  );
  const result = lifecycle.consumeAccepted(PROPOSAL_ID);
  assert.equal(result.ok, true);
  return result.handoff;
}

export function makeWorld({
  acceptedRevisionAt = ACCEPTED_REVISION_AT,
  proposalMaxAgeMs = 10_000,
  spotQuantity = 1,
  perpQuantity = 1,
  requestedCapital = '100',
  acceptedNotionalUsd = Number(requestedCapital),
  allocationCap = '80',
  capitalOptions = {},
  inputOverrides = {},
} = {}) {
  const { proof: capital, constructionInput } = makeCapitalProof({
    acceptedRevisionAt,
    requestedCapital,
    allocationCap,
    spotQuantityExact: String(spotQuantity),
    perpQuantityExact: String(perpQuantity),
    ...capitalOptions,
  });
  const proposal = {
    canonicalProposalId: CANONICAL_PROPOSAL_ID,
    observedAtMs: acceptedRevisionAt,
    maxAgeMs: proposalMaxAgeMs,
    expiresAtMs: capital.consideration.proposal.expiresAtMs,
  };
  const base = createExecutionPlanDefinition(basePlanInput({
    proposal,
    spotQuantity,
    perpQuantity,
  }));
  const planInput = basePlanInput({
    proposal,
    spotQuantity,
    perpQuantity,
    normalBasis: {
      version: 1,
      evaluationInput: approvedRiskInput(base),
    },
  });
  const handoff = makeHandoff({ acceptedRevisionAt, acceptedNotionalUsd });
  return {
    input: {
      handoff,
      capital,
      planInput,
      nowMs: NOW,
      ...inputOverrides,
    },
    handoff,
    capital,
    capitalConstructionInput: constructionInput,
    planInput,
  };
}

export function enabledControls(overrides = {}) {
  return { enabled: true, killSwitchEngaged: false, ...overrides };
}

test('default construction is OFF with kill switch ON and does not inspect hostile input', () => {
  assert.deepEqual(DEFAULT_BASIS_VALIDATE_ONLY_CONTROLS, {
    enabled: false,
    killSwitchEngaged: true,
  });
  let traps = 0;
  const hostile = new Proxy({}, {
    get() {
      traps += 1;
      throw new Error('must not read');
    },
    ownKeys() {
      traps += 1;
      throw new Error('must not enumerate');
    },
  });
  const result = bindBasisValidateOnlyPlan(hostile);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DISABLED');
  assert.equal(result.sendEligible, false);
  assert.equal(result.killSwitchDominant, true);
  assert.equal(traps, 0);

  const killed = bindBasisValidateOnlyPlan(hostile, { enabled: true });
  assert.equal(killed.ok, false);
  assert.equal(killed.code, 'KILL_SWITCH_ENGAGED');
  assert.equal(traps, 0);
});

test('acceptance, acceptedBy, and T-3 labels never substitute for canonical Capital proof', () => {
  const { input, handoff } = makeWorld();
  const t3LabelledHandoff = Object.freeze({
    ...handoff,
    acceptedBy: 'T-3_STRATEGY_AUTHORITY',
  });
  const result = bindBasisValidateOnlyPlan(
    { ...input, handoff: t3LabelledHandoff, capital: null },
    enabledControls(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CAPITAL_PROOF_REQUIRED');
  assert.equal(result.strategyAuthority, 'NONE');
  assert.equal(result.actionAuthority, 'NONE');
});

test('missing, unfrozen, self-minted, and mismatched Capital graphs fail closed', () => {
  const { input, capital } = makeWorld();
  assert.equal(
    bindBasisValidateOnlyPlan({ ...input, capital: null }, enabledControls()).code,
    'CAPITAL_PROOF_REQUIRED',
  );
  assert.equal(
    bindBasisValidateOnlyPlan(
      { ...input, capital: { ...capital } },
      enabledControls(),
    ).code,
    'CAPITAL_PROOF_NOT_FROZEN',
  );
  const corruptedMandate = Object.freeze({
    ...capital.mandate,
    proposalIntakeDigest: 'different-intake',
  });
  assert.equal(
    bindBasisValidateOnlyPlan(
      {
        ...input,
        capital: Object.freeze({ ...capital, mandate: corruptedMandate }),
      },
      enabledControls(),
    ).code,
    'CAPITAL_PROOF_INVALID',
  );
  const selfMinted = deepFreeze(structuredClone(capital));
  assert.equal(
    bindBasisValidateOnlyPlan(
      { ...input, capital: selfMinted },
      enabledControls(),
    ).code,
    'CAPITAL_PROOF_INVALID',
    'content-equal frozen data has no canonical producer provenance',
  );
  const { proof: expiredCapital } = makeCapitalProof({ mandateExpiresAtMs: NOW });
  assert.equal(
    bindBasisValidateOnlyPlan(
      { ...input, capital: expiredCapital },
      enabledControls(),
    ).code,
    'CAPITAL_PROOF_INVALID',
  );
});

test('proof construction requires the synthetic MANUAL_ARMED Capital dialect and forbids LIVE_PRIVATE', () => {
  const livePrivate = structuredClone(makeCapitalProofInput());
  livePrivate.eligibilityCandidate.intake.truth.source.authority = 'LIVE_PRIVATE';
  const privateResult = createBasisValidateOnlyCapitalProof(deepFreeze(livePrivate));
  assert.deepEqual(privateResult, { ok: false, code: 'AUTHORITY_INVALID' });

  const validateOnlyDialect = structuredClone(makeCapitalProofInput());
  validateOnlyDialect.eligibilityPolicy.basisMode = 'VALIDATE_ONLY';
  const validateOnlyResult = createBasisValidateOnlyCapitalProof(
    deepFreeze(validateOnlyDialect),
  );
  assert.deepEqual(validateOnlyResult, { ok: false, code: 'AUTHORITY_INVALID' });

  const { input, planInput } = makeWorld();
  const privateRisk = structuredClone(planInput);
  privateRisk.normalBasis.evaluationInput.approval.observedAt.authority =
    'LIVE_PRIVATE';
  assert.equal(
    bindBasisValidateOnlyPlan(
      { ...input, planInput: privateRisk },
      enabledControls(),
    ).code,
    'AUTHORITY_INVALID',
  );
});

test('stale accepted revision and non-current risk evaluation are rejected', () => {
  const stale = makeWorld({
    acceptedRevisionAt: NOW - 20_000,
    proposalMaxAgeMs: 1_000,
  });
  assert.equal(
    bindBasisValidateOnlyPlan(stale.input, enabledControls()).code,
    'STALE_OR_EXPIRED',
  );

  const { input, planInput } = makeWorld();
  const wrongRiskTime = {
    ...planInput,
    normalBasis: {
      ...planInput.normalBasis,
      evaluationInput: {
        ...planInput.normalBasis.evaluationInput,
        nowMs: NOW - 1,
      },
    },
  };
  assert.equal(
    bindBasisValidateOnlyPlan(
      { ...input, planInput: wrongRiskTime },
      enabledControls(),
    ).code,
    'PROVENANCE_MISMATCH',
  );
});

test('canonical exact quantities must round-trip through frozen P2 number terms', () => {
  const { input, planInput } = makeWorld();
  for (const hostile of ['01', '1.0', '1e0', '0.10000000000000001']) {
    const { proof: hostileCapital } = makeCapitalProof({
      spotQuantityExact: hostile,
    });
    const result = bindBasisValidateOnlyPlan(
      {
        ...input,
        capital: hostileCapital,
      },
      enabledControls(),
    );
    assert.equal(result.ok, false, hostile);
    assert.equal(result.code, 'EXACT_DECIMAL_REQUIRED', hostile);
  }

  const changedPlanNumber = {
    ...planInput,
    spotQuantity: 0.1,
  };
  assert.equal(
    bindBasisValidateOnlyPlan(
      {
        ...input,
        planInput: changedPlanNumber,
      },
      enabledControls(),
    ).code,
    'EXACT_DECIMAL_REQUIRED',
  );

  const overCapital = makeWorld({
    requestedCapital: '10',
    acceptedNotionalUsd: 10,
    allocationCap: '10',
  });
  assert.equal(
    bindBasisValidateOnlyPlan(overCapital.input, enabledControls()).code,
    'PROVENANCE_MISMATCH',
    'each exact leg notional must remain within the accepted canonical Capital ceiling',
  );
});

test('canonical allocation may narrow requested Capital and exact leg notionals cannot exceed it', () => {
  const narrowed = makeWorld({
    requestedCapital: '100',
    acceptedNotionalUsd: 100,
    allocationCap: '80',
  });
  assert.equal(narrowed.capital.consideration.economics.requestedCapital, '100');
  assert.equal(narrowed.capital.allocationDecision.status, 'CAPPED');
  assert.equal(narrowed.capital.allocationDecision.grantedAmount, '80');
  assert.equal(narrowed.capital.mandate.targetMaximumExposure, '80');
  assert.equal(bindBasisValidateOnlyPlan(narrowed.input, enabledControls()).ok, true);
});

test('combined Spot and Perp gross notional cannot exceed the canonical staged maximum', () => {
  const overGross = makeWorld({
    requestedCapital: '100',
    acceptedNotionalUsd: 100,
    allocationCap: '80',
    spotQuantity: 2,
    perpQuantity: 2,
  });
  assert.equal(overGross.capital.mandate.targetMaximumExposure, '80');
  assert.equal(
    multiplyExactDecimals(
      overGross.capital.spotPriceExact,
      overGross.capital.spotQuantityExact,
    ),
    '60',
  );
  assert.equal(
    multiplyExactDecimals(
      overGross.capital.perpPriceExact,
      overGross.capital.perpQuantityExact,
    ),
    '60',
  );
  assert.equal(
    bindBasisValidateOnlyPlan(overGross.input, enabledControls()).code,
    'PROVENANCE_MISMATCH',
    'two individually bounded legs must not combine into 120 against an 80 mandate',
  );
});

test('hostile scalar graphs always return typed refusals instead of throwing', () => {
  const { input, handoff, planInput } = makeWorld();
  const hostileHandoffs = [
    Object.freeze({ ...handoff, acceptedNetEdgePct: Number.NaN }),
    Object.freeze({ ...handoff, acceptedNotionalUsd: Number.POSITIVE_INFINITY }),
    Object.freeze({ ...handoff, acceptedBy: 7 }),
    Object.freeze({ ...handoff, handoffId: 'bh_wrong' }),
  ];
  for (const candidate of hostileHandoffs) {
    assert.doesNotThrow(() => {
      const result = bindBasisValidateOnlyPlan(
        { ...input, handoff: candidate },
        enabledControls(),
      );
      assert.equal(result.ok, false);
      assert.equal(typeof result.code, 'string');
    });
  }

  const hostilePlan = structuredClone(planInput);
  hostilePlan.normalBasis.evaluationInput.intent.accountId = Number.NaN;
  assert.doesNotThrow(() => {
    const result = bindBasisValidateOnlyPlan(
      { ...input, planInput: hostilePlan },
      enabledControls(),
    );
    assert.equal(result.ok, false);
  });

  const hostileCapitalInput = structuredClone(makeCapitalProofInput());
  hostileCapitalInput.eligibilityCandidate.intake.proposal.sourceLifecycle = 7;
  assert.doesNotThrow(() => {
    const result = createBasisValidateOnlyCapitalProof(
      deepFreeze(hostileCapitalInput),
    );
    assert.equal(result.ok, false);
    assert.equal(typeof result.code, 'string');
  });
});

test('plain-data snapshot rejects overwide, dense, deep, oversized, and aggregate-node graphs', () => {
  const { input, planInput } = makeWorld();
  const cases = [
    {
      name: 'overwide object',
      value: Object.fromEntries(
        Array.from({ length: 129 }, (_, index) => [`k${index}`, index]),
      ),
    },
    {
      name: 'dense array',
      value: Array.from({ length: 513 }, () => 'SPOT'),
    },
    {
      name: 'aggregate nodes',
      value: Array.from({ length: 512 }, (_, row) =>
        Object.fromEntries(
          Array.from({ length: 8 }, (_, column) => [
            `k${column}`,
            `${row}:${column}`,
          ]),
        )),
    },
    {
      name: 'aggregate bytes',
      value: Array.from({ length: 5 }, (_, index) =>
        `${index}${'x'.repeat(60_000)}`),
    },
  ];
  let deep = { leaf: true };
  for (let depth = 0; depth < 40; depth += 1) deep = { next: deep };
  cases.push({ name: 'deep graph', value: deep });

  for (const entry of cases) {
    assert.doesNotThrow(() => {
      const result = bindBasisValidateOnlyPlan(
        {
          ...input,
          planInput: {
            ...planInput,
            openingOrder: entry.value,
          },
        },
        enabledControls(),
      );
      assert.equal(result.ok, false, entry.name);
      assert.equal(result.code, 'INPUT_NOT_PLAIN_DATA', entry.name);
    }, entry.name);
  }
});

test('own enumerable __proto__ data is rejected for both input and controls', () => {
  const { input, planInput } = makeWorld();
  const protoData = {};
  Object.defineProperty(protoData, '__proto__', {
    value: { polluted: true },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  assert.equal(Object.hasOwn(protoData, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(protoData), Object.prototype);

  const inputResult = bindBasisValidateOnlyPlan(
    {
      ...input,
      planInput: {
        ...planInput,
        openingOrder: protoData,
      },
    },
    enabledControls(),
  );
  assert.equal(inputResult.ok, false);
  assert.equal(inputResult.code, 'INPUT_NOT_PLAIN_DATA');

  const controls = enabledControls();
  Object.defineProperty(controls, '__proto__', {
    value: { polluted: true },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const controlResult = bindBasisValidateOnlyPlan(input, controls);
  assert.equal(controlResult.ok, false);
  assert.equal(controlResult.code, 'CONTROL_INVALID');
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
  assert.equal({}.polluted, undefined);
});

test('hostile accessors and Proxies are rejected without invocation', () => {
  const { input } = makeWorld();
  let getterCalls = 0;
  const accessorInput = {};
  Object.defineProperties(accessorInput, {
    handoff: {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('getter must not run');
      },
    },
    capital: { enumerable: true, value: input.capital },
    planInput: { enumerable: true, value: input.planInput },
    nowMs: { enumerable: true, value: NOW },
  });
  assert.equal(
    bindBasisValidateOnlyPlan(accessorInput, enabledControls()).code,
    'INPUT_NOT_PLAIN_DATA',
  );
  assert.equal(getterCalls, 0);

  let proxyTraps = 0;
  const proxyCapital = new Proxy(input.capital, {
    get() {
      proxyTraps += 1;
      throw new Error('get trap must not run');
    },
    ownKeys() {
      proxyTraps += 1;
      throw new Error('ownKeys trap must not run');
    },
    getOwnPropertyDescriptor() {
      proxyTraps += 1;
      throw new Error('descriptor trap must not run');
    },
  });
  assert.equal(
    bindBasisValidateOnlyPlan(
      { ...input, capital: proxyCapital },
      enabledControls(),
    ).code,
    'INPUT_NOT_PLAIN_DATA',
  );
  assert.equal(proxyTraps, 0);
});

test('valid canonical owner graph binds exactly four immutable steps and remains non-fireable', () => {
  const { input, handoff, capital } = makeWorld();
  const result = bindBasisValidateOnlyPlan(input, enabledControls());
  assert.equal(result.ok, true);
  assert.equal(capital.consideration.mode, 'MANUAL_ARMED');
  assert.equal(capital.consideration.evidenceTruth, 'UNKNOWN');
  assert.deepEqual(
    capital.consideration.reasons,
    ['PROPOSAL_OPEN', 'PROPOSAL_REVISION_UNKNOWN'],
  );
  assert.equal(capital.consideration.proposal.sourceRevision, null);
  assert.equal(
    capital.consideration.proposal.updatedAtMs,
    handoff.acceptedRevisionTs,
  );
  assert.equal(handoff.handoffId, `bh_${handoff.proposalId}`);
  const binding = result.binding;
  assert.equal(binding.schema, BASIS_VALIDATE_ONLY_PLAN_BINDING_SCHEMA);
  assert.match(binding.bindingId, /^bvopb1_[0-9a-f]{32}$/);
  assert.equal(binding.sourceProposalId, PROPOSAL_ID);
  assert.equal(binding.canonicalProposalId, CANONICAL_PROPOSAL_ID);
  assert.equal(binding.handoffCorrelationId, PROPOSAL_CORRELATION_ID);
  assert.equal(binding.planCorrelationId, binding.plan.correlationId);
  assert.notEqual(binding.handoffCorrelationId, binding.planCorrelationId);
  assert.deepEqual(binding.validatedControls, {
    enabled: true,
    killSwitchEngaged: false,
  });
  assert.equal(Object.isFrozen(binding.validatedControls), true);
  assert.equal(binding.spotNotionalUsdExact, '30');
  assert.equal(binding.perpNotionalUsdExact, '30');
  assert.equal(binding.plan.mode, 'VALIDATE_ONLY');
  assert.deepEqual(
    binding.plan.normalBasisBinding.stepOrder,
    ['SPOT_OPEN', 'PERP_OPEN', 'PERP_CLOSE', 'SPOT_CLOSE'],
  );
  assert.equal(Object.keys(binding.plan.normalBasisBinding.steps).length, 4);
  assert.equal(binding.plan.normalBasisBinding.steps.PERP_CLOSE.reduceOnly, true);
  assert.equal(binding.plan.normalBasisBinding.steps.SPOT_CLOSE.reduceOnly, false);
  assert.equal(binding.plan.normalBasisBinding.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(binding.plan.normalBasisBinding.riskAuthority, 'NONE');
  assert.equal(binding.plan.normalBasisBinding.sendEligible, false);
  assert.equal(binding.externalMode, 'VALIDATE_ONLY');
  assert.equal(binding.strategyAuthority, 'NONE');
  assert.equal(binding.capitalAuthority, 'NONE');
  assert.equal(binding.riskAuthority, 'NONE');
  assert.equal(binding.executionAuthority, 'NONE');
  assert.equal(binding.actionAuthority, 'NONE');
  assert.equal(binding.sendEligible, false);
  assert.equal(binding.killSwitchDominant, true);
  assert.equal(Object.hasOwn(binding, 'acceptedBy'), false);
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(Object.isFrozen(binding.plan), true);
  assert.equal(isBasisValidateOnlyPlanBinding(binding), true);
  assert.equal(isBasisValidateOnlyPlanBinding({ ...binding }), false);

  let brandProxyTraps = 0;
  const arbitraryProxy = new Proxy({}, {
    get() {
      brandProxyTraps += 1;
      throw new Error('brand guard must not dereference');
    },
  });
  assert.equal(isBasisValidateOnlyPlanBinding(arbitraryProxy), false);
  assert.equal(brandProxyTraps, 0);
});

test.after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(networkAttempts, 0);
});

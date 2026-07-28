#!/usr/bin/env node
/**
 * M1-I1 — accepted Basis provenance -> immutable validate-only plan.
 *
 * All evidence is deterministic synthetic data. Any network touch fails.
 * Run after `npm run build -w server`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASIS_VALIDATE_ONLY_PLAN_BINDING_SCHEMA,
  DEFAULT_BASIS_VALIDATE_ONLY_CONTROLS,
  bindBasisValidateOnlyPlan,
  isBasisValidateOnlyPlanBinding,
} from '../../../dist/foundation/execution/basisValidateOnly/planBinding.js';
import {
  assessCapitalTruth,
  capitalDigest,
  deriveCapitalMandateId,
  deriveOpportunityConsiderationId,
} from '../../../dist/capitalFoundation/contracts/index.js';
import {
  createExecutionPlanDefinition,
} from '../../../dist/foundation/execution/plan.js';
import {
  deriveRiskIntentDigest,
} from '../../../dist/foundation/risk/index.js';

const NOW = 1_900_000_000_000;
const DAY_MS = 86_400_000;
const DAY_START = Math.floor(NOW / DAY_MS) * DAY_MS;
const SYMBOL = 'BTCUSDT';
const ACCOUNT = 'm1-i1-validate-only';
const PROPOSAL_ID = 'bp_m1_i1_accepted';
const CANONICAL_PROPOSAL_ID = 'cprop_m1_i1_accepted';
const PROPOSAL_CORRELATION_ID = 'basis:m1-i1:accepted';
const ELIGIBILITY_POLICY_REVISION = 'capital-eligibility:m1-i1';

let networkAttempts = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  networkAttempts += 1;
  throw new Error('network forbidden in validate-only plan-binding proof');
};

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
        intendedPrice: 100,
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
        intendedPrice: 100,
        intendedQty: plan.openingLegs.PERP.quantity,
        requiredPermission: 'FUTURES',
        positionBucket: 'USDM_ONE_WAY',
        estimatedRequiredMarginUsd: 100,
      },
    ],
    declaredMaxNakedDurationMs: plan.maxNakedDurationMs,
    estimatedRequiredMarginUsd: 100,
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
          referencePrice: 100,
          observedAt: stamp('binance.spot.book'),
          spreadPct: 0.01,
          topDepthUsd: 10_000,
          filters: filters('binance.spot.filters', 'BINANCE_SPOT'),
        },
        {
          legKey: 'PERP_OPEN',
          venue: 'BINANCE_USDM',
          symbol: SYMBOL,
          referencePrice: 100,
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
        projectedSignedBaseQty: -1,
        markPrice: 100,
        liquidationPrice: 150,
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
      minLegNotionalUsd: 10,
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

function makeCapitalProof({
  sourceRevisionTs = NOW - 100,
  evaluatedAtMs = NOW - 30,
  proposalExpiresAtMs = NOW + 6_000,
  mandateExpiresAtMs = proposalExpiresAtMs,
  mode = 'VALIDATE_ONLY',
  requestedCapital = '100',
  expectedNetEdge = '0.5',
  spotPriceExact = '100',
  spotQuantityExact = '1',
  perpPriceExact = '100',
  perpQuantityExact = '1',
} = {}) {
  const intakeDigest = capitalDigest({
    sourceProposalId: PROPOSAL_ID,
    sourceRevisionTs,
    canonicalProposalId: CANONICAL_PROPOSAL_ID,
  });
  const proposal = {
    sourceProposalId: PROPOSAL_ID,
    canonicalProposalId: CANONICAL_PROPOSAL_ID,
    sourceCorrelationId: PROPOSAL_CORRELATION_ID,
    strategy: 'BASIS',
    symbol: SYMBOL,
    direction: 'long_spot_short_perp',
    sourceLifecycle: 'OPEN',
    sourceRevision: String(sourceRevisionTs),
    sourceConfigRevision: 'basis-config:m1-i1',
    createdAtMs: sourceRevisionTs - 100,
    updatedAtMs: sourceRevisionTs,
    expiresAtMs: proposalExpiresAtMs,
    intakeDigest,
  };
  const considerationId = deriveOpportunityConsiderationId({
    proposalId: proposal.sourceProposalId,
    proposalRevision: proposal.sourceRevision,
    intakeDigest,
    policyRevision: ELIGIBILITY_POLICY_REVISION,
  });
  const truth = assessCapitalTruth({
    source: {
      sourceTimeMs: evaluatedAtMs - 10,
      receivedAtMs: evaluatedAtMs - 5,
      maxAgeMs: 1_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId: 'capital.consideration:m1-i1',
    },
    evaluatedAtMs,
    requiredValuePresent: true,
    revision: 'capital-truth:m1-i1',
  });
  const consideration = Object.freeze({
    id: considerationId,
    proposal,
    mode,
    status: 'ELIGIBLE',
    reasons: [],
    legs: [
      {
        role: 'SPOT',
        instrumentId: `${SYMBOL}:SPOT`,
        symbol: SYMBOL,
        side: 'LONG',
        borrowRequired: false,
      },
      {
        role: 'PERPETUAL',
        instrumentId: `${SYMBOL}:PERP`,
        symbol: SYMBOL,
        side: 'SHORT',
        borrowRequired: false,
      },
    ],
    economics: {
      valuationAsset: 'USDT',
      requestedCapital,
      expectedGrossEdge: expectedNetEdge,
      expectedNetEdge,
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
      expectedBorrowScope: null,
      fundingFact: null,
      borrowFact: null,
      capitalOpportunityFact: null,
      exactSourceIds: ['capital.synthetic:m1-i1'],
      missingFields: [],
    },
    evidencePacketIds: [],
    evidenceTruth: 'COMPLETE',
    truth,
    conflictingConsiderationIds: [],
    evaluatedAtMs,
  });
  const mandateSeed = {
    considerationId,
    allocationDecisionId: 'calloc_m1_i1_validate_only',
    reservationId: 'cres_m1_i1_validate_only',
    proposalIntakeDigest: intakeDigest,
  };
  const mandateSemantic = {
    id: deriveCapitalMandateId(mandateSeed),
    revision: 1,
    considerationId,
    allocationDecisionId: mandateSeed.allocationDecisionId,
    reservationId: mandateSeed.reservationId,
    stagedPlanId: 'cstage_m1_i1_validate_only',
    stagedPlanRevision: 1,
    stagedPlanDigest: capitalDigest({ stagedPlan: 'm1-i1', requestedCapital }),
    proposalIntakeDigest: intakeDigest,
    configRevision: 'cfg_capital_m1_i1_validate_only',
    approvalId: null,
    riskDecision: null,
    targetMaximumExposure: requestedCapital,
    valuationAsset: 'USDT',
    createdAtMs: evaluatedAtMs,
    expiresAtMs: mandateExpiresAtMs,
  };
  const mandate = Object.freeze({
    ...mandateSemantic,
    digest: capitalDigest(mandateSemantic),
  });
  return Object.freeze({
    consideration,
    considerationDigest: capitalDigest(consideration),
    eligibilityPolicyRevision: ELIGIBILITY_POLICY_REVISION,
    mandate,
    spotPriceExact,
    spotQuantityExact,
    perpPriceExact,
    perpQuantityExact,
  });
}

function makeWorld({
  sourceRevisionTs = NOW - 100,
  proposalMaxAgeMs = 10_000,
  spotQuantity = 1,
  perpQuantity = 1,
  requestedCapital = '100',
  acceptedNotionalUsd = Number(requestedCapital),
  capitalOptions = {},
  inputOverrides = {},
} = {}) {
  const capital = makeCapitalProof({
    sourceRevisionTs,
    requestedCapital,
    spotQuantityExact: String(spotQuantity),
    perpQuantityExact: String(perpQuantity),
    ...capitalOptions,
  });
  const proposal = {
    canonicalProposalId: CANONICAL_PROPOSAL_ID,
    observedAtMs: sourceRevisionTs,
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
  const handoff = Object.freeze({
    handoffId: `bh_${PROPOSAL_ID}`,
    proposalId: PROPOSAL_ID,
    correlationId: PROPOSAL_CORRELATION_ID,
    symbol: SYMBOL,
    direction: 'long_spot_short_perp',
    acceptedBy: 'owner',
    acceptedTs: sourceRevisionTs + 50,
    acceptedRevisionTs: sourceRevisionTs,
    acceptedNetEdgePct: 0.5,
    acceptedNotionalUsd,
    boundTs: sourceRevisionTs + 60,
    state: 'AWAITING_FEEDBACK',
    terminalKind: null,
    terminalTs: null,
    cumulativeFilledQuantity: null,
    lastSequence: null,
    lastObservedAtMs: null,
    ambiguousObservations: 0,
  });
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
    planInput,
  };
}

function enabledControls(overrides = {}) {
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

test('missing, unfrozen, stale, and mismatched canonical Capital proof fails closed', () => {
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
  const manualCapital = makeCapitalProof({ mode: 'MANUAL_ARMED' });
  assert.equal(
    bindBasisValidateOnlyPlan(
      { ...input, capital: manualCapital },
      enabledControls(),
    ).code,
    'AUTHORITY_INVALID',
  );
  const expiredCapital = makeCapitalProof({ mandateExpiresAtMs: NOW });
  assert.equal(
    bindBasisValidateOnlyPlan(
      { ...input, capital: expiredCapital },
      enabledControls(),
    ).code,
    'CAPITAL_PROOF_INVALID',
  );
});

test('stale accepted revision and non-current risk evaluation are rejected', () => {
  const stale = makeWorld({
    sourceRevisionTs: NOW - 20_000,
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
  const { input, capital, planInput } = makeWorld();
  for (const hostile of ['01', '1.0', '1e0', '0.10000000000000001']) {
    const result = bindBasisValidateOnlyPlan(
      {
        ...input,
        capital: Object.freeze({ ...capital, spotQuantityExact: hostile }),
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
  });
  assert.equal(
    bindBasisValidateOnlyPlan(overCapital.input, enabledControls()).code,
    'PROVENANCE_MISMATCH',
    'each exact leg notional must remain within the accepted canonical Capital ceiling',
  );
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

test('valid synthetic input binds exactly four immutable steps and remains non-fireable', () => {
  const { input } = makeWorld();
  const result = bindBasisValidateOnlyPlan(input, enabledControls());
  assert.equal(result.ok, true);
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
  assert.equal(binding.spotNotionalUsdExact, '100');
  assert.equal(binding.perpNotionalUsdExact, '100');
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

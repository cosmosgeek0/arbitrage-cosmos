#!/usr/bin/env node
/**
 * M1-I1 — one hermetic, integrated validate-only Basis lifecycle.
 *
 * The path is deliberately constructed from the real P1 proposal store and
 * handoff lifecycle, the canonical Capital proof constructor, P2 plan/risk,
 * both inert exchange adapters, the replayable execution reducer, and the
 * reconciliation-owned flatness verifier. T-3 remains public telemetry only.
 *
 * Run after `npm run build -w server`:
 *   node --test --test-concurrency=1 server/test/m1/basis-validate-only-integrated.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createReplayHarness,
} from '../../dist/engine/basis/index.js';
import {
  BasisHandoffLifecycle,
} from '../../dist/engine/basis/lifecycle.js';
import {
  buildPublicBasisOpportunityObservation,
  validatePublicBasisOpportunityObservation,
} from '../../dist/engine/basis/publicOpportunityObservation.js';
import {
  bindBasisValidateOnlyPlan,
  createBasisValidateOnlyCapitalProof,
} from '../../dist/foundation/execution/basisValidateOnly/planBinding.js';
import {
  applyBasisValidateOnlyObservation,
  createBasisValidateOnlyLifecycle,
  replayBasisValidateOnlyLifecycle,
  restoreBasisValidateOnlyCheckpoint,
  serializeBasisValidateOnlyCheckpoint,
} from '../../dist/foundation/execution/basisValidateOnly/lifecycle.js';
import {
  createSyntheticConservativeEconomicFactBinding,
} from '../../dist/capitalFoundation/contracts/index.js';
import {
  createExecutionPlanDefinition,
} from '../../dist/foundation/execution/plan.js';
import {
  deriveRiskIntentDigest,
} from '../../dist/foundation/risk/index.js';
import {
  prepareBinanceSpotValidateOnlyOrder,
} from '../../dist/foundation/exchange/binanceSpotValidateOnlyAdapter/index.js';
import {
  createBinanceUsdMPublicGroundworkSeam,
} from '../../dist/foundation/exchange/binanceUsdM/validation.js';
import {
  createBinanceUsdMBasisValidateOnlyAdapter,
} from '../../dist/foundation/exchange/binanceUsdMAdapter/index.js';
import {
  verifyBasisFlatness,
} from '../../dist/foundation/reconciliation/basisFlatness.js';
import {
  canonicalJson,
} from '../../dist/foundation/contracts/identity.js';
import {
  enabledControls,
  makeWorld,
  NOW,
} from '../foundation/execution/basis-validate-only-plan-binding.mjs';

const SYMBOL = 'BTCUSDT';
const ACCOUNT_ID = 'm1-i1-validate-only';
const P1_START_MS = NOW - 10_000;
const QUANTITY = '0.3';
const PRICE = '30';

function deepFreeze(value, seen = new Set()) {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function') ||
    seen.has(value)
  ) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function p1SymbolMeta() {
  return {
    symbol: SYMBOL,
    base: 'BTC',
    quote: 'USDT',
    hasSpot: true,
    hasPerp: true,
    marginBorrowable: null,
    minNotionalUsd: 5,
    tickSize: 0.01,
    stepSize: 0.001,
    quoteVolume24hUsd: 50_000_000,
    eligible: true,
    ineligibleReason: null,
  };
}

function p1MarketStep(atMs) {
  const spotBid = 100;
  const spotAsk = 100.02;
  const perpBid = spotAsk * 1.0078;
  const perpAsk = perpBid + 0.02;
  const markPrice = (perpBid + perpAsk) / 2;
  const quantity = 500;
  return {
    atMs,
    events: [
      {
        type: 'spotBook',
        tick: {
          symbol: SYMBOL,
          bid: spotBid,
          ask: spotAsk,
          bidQty: quantity,
          askQty: quantity,
          ts: atMs,
        },
      },
      {
        type: 'perpBook',
        tick: {
          symbol: SYMBOL,
          bid: perpBid,
          ask: perpAsk,
          bidQty: quantity,
          askQty: quantity,
          ts: atMs,
        },
      },
      {
        type: 'markFunding',
        tick: {
          symbol: SYMBOL,
          markPrice,
          fundingRate: 0.0001,
          nextFundingTs: atMs + 4 * 3_600_000,
          ts: atMs,
        },
      },
      {
        type: 'spotDepth',
        ladder: {
          symbol: SYMBOL,
          bids: [[spotBid, quantity]],
          asks: [[spotAsk, quantity]],
          ts: atMs,
        },
      },
      {
        type: 'perpDepth',
        ladder: {
          symbol: SYMBOL,
          bids: [[perpBid, quantity]],
          asks: [[perpAsk, quantity]],
          ts: atMs,
        },
      },
    ],
  };
}

function createAcceptedP1Handoff() {
  const harness = createReplayHarness(
    {
      persistTicks: 3,
      suggestedNotionalUsd: 100,
    },
    P1_START_MS,
  );
  harness.run([
    {
      atMs: P1_START_MS,
      events: [{ type: 'universe', symbols: [p1SymbolMeta()] }],
      tick: false,
    },
    p1MarketStep(P1_START_MS + 2_000),
    p1MarketStep(P1_START_MS + 4_000),
    p1MarketStep(P1_START_MS + 6_000),
  ]);

  const [proposal] = harness.engine.proposals.open();
  assert.ok(proposal, 'real P1 engine must produce an open proposal');
  const preAcceptance = deepFreeze(structuredClone(proposal));
  assert.equal(preAcceptance.status, 'open');
  assert.equal(preAcceptance.symbol, SYMBOL);
  assert.equal(preAcceptance.direction, 'long_spot_short_perp');
  assert.equal(preAcceptance.suggestedNotionalUsd, 100);

  const accepted = harness.engine.proposals.accept({
    proposalId: preAcceptance.id,
    acceptedBy: 'owner',
    acceptedRevisionTs: preAcceptance.updatedTs,
    acceptedNetEdgePct: preAcceptance.netEdgePct,
    acceptedNotionalUsd: preAcceptance.suggestedNotionalUsd,
  });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));

  const handoffLifecycle = new BasisHandoffLifecycle(
    harness.clock,
    harness.engine.proposals,
    { enabled: true },
  );
  const consumed = handoffLifecycle.consumeAccepted(preAcceptance.id);
  assert.equal(consumed.ok, true, JSON.stringify(consumed));
  assert.equal(
    harness.engine.proposals.acceptanceConsumed(preAcceptance.id),
    true,
  );
  assert.equal(consumed.handoff.proposalId, preAcceptance.id);
  assert.equal(consumed.handoff.correlationId, preAcceptance.correlationId);
  assert.equal(
    consumed.handoff.acceptedRevisionTs,
    preAcceptance.updatedTs,
  );
  assert.equal(
    consumed.handoff.acceptedNetEdgePct,
    preAcceptance.netEdgePct,
  );
  assert.equal(
    consumed.handoff.acceptedNotionalUsd,
    preAcceptance.suggestedNotionalUsd,
  );
  assert.equal(consumed.handoff.state, 'AWAITING_FEEDBACK');

  return {
    harness,
    preAcceptance,
    acceptance: accepted.acceptance,
    handoff: consumed.handoff,
  };
}

function publicProvenance(observedAtMs, overrides = {}) {
  return {
    authority: 'CONFIG_ASSUMPTION',
    sourceId: 'm1-i1.public.config',
    revision: 'm1-i1-public-config-r1',
    sourceEventAtMs: null,
    sourceTransactionAtMs: null,
    receivedAtMs: null,
    expiresAtMs: null,
    timeBasis: 'NOT_APPLICABLE',
    ...overrides,
  };
}

function publicCost(
  observedAtMs,
  sourceId,
  valuePct,
  overrides = {},
) {
  return {
    state: 'PUBLIC_SCHEDULE_ASSUMPTION',
    valuePct,
    provenance: publicProvenance(observedAtMs, {
      authority: 'BINANCE_PUBLIC',
      sourceId,
      revision: `${sourceId}:r1`,
      sourceTransactionAtMs: observedAtMs - 20,
      receivedAtMs: observedAtMs - 10,
      expiresAtMs: observedAtMs + 1_000,
      timeBasis: 'SOURCE_TRANSACTION_TIME',
    }),
    reasonCodes: [],
    ...overrides,
  };
}

function buildT3Observation(preAcceptance, variant) {
  const observedAtMs = preAcceptance.updatedTs;
  const sourceCutId = `m1-i1-public-cut-${variant}`;
  return buildPublicBasisOpportunityObservation({
    opportunityId: preAcceptance.id,
    opportunityCreatedAtMs: preAcceptance.createdTs,
    correlationId: preAcceptance.correlationId,
    sourceCutId,
    symbol: preAcceptance.symbol,
    direction: preAcceptance.direction,
    ownerDecisionKind: 'proposal',
    observedAtMs,
    evaluatedAtMs: observedAtMs + 10,
    ownerReportedGrossEdgePct: String(preAcceptance.grossEdgePct),
    ownerReportedNetEdgePct: String(preAcceptance.netEdgePct),
    quoteCut: {
      spot: {
        market: 'SPOT',
        bidPrice: '99.98',
        askPrice: '100',
        bidQuantity: '25',
        askQuantity: '24',
        state: 'OBSERVED_PUBLIC',
        provenance: publicProvenance(observedAtMs, {
          authority: 'BINANCE_PUBLIC',
          sourceId: `binance.public.spot.bookTicker.${variant}`,
          revision: `spot-cut-${variant}`,
          receivedAtMs: observedAtMs - 10,
          expiresAtMs: observedAtMs + 1_000,
          timeBasis: 'RECEIPT_TIME',
        }),
        reasonCodes: [],
      },
      perpetual: {
        market: 'USD_M_PERPETUAL',
        bidPrice: '102',
        askPrice: '102.02',
        bidQuantity: '30',
        askQuantity: '29',
        state: 'OBSERVED_PUBLIC',
        provenance: publicProvenance(observedAtMs, {
          authority: 'BINANCE_PUBLIC',
          sourceId: `binance.public.usdm.bookTicker.${variant}`,
          revision: `perp-cut-${variant}`,
          sourceEventAtMs: observedAtMs - 20,
          sourceTransactionAtMs: observedAtMs - 15,
          receivedAtMs: observedAtMs - 5,
          expiresAtMs: observedAtMs + 1_000,
          timeBasis: 'SOURCE_TRANSACTION_TIME',
        }),
        reasonCodes: [],
      },
      maxQuoteAgeMs: 100,
      maxReceiptSkewMs: 10,
    },
    costs: {
      spotOpenFee: publicCost(
        observedAtMs,
        `binance.public.spot-open-fee.${variant}`,
        '0.025',
      ),
      spotCloseFee: publicCost(
        observedAtMs,
        `binance.public.spot-close-fee.${variant}`,
        '0.025',
      ),
      perpetualOpenFee: publicCost(
        observedAtMs,
        `binance.public.perp-open-fee.${variant}`,
        '0.025',
      ),
      perpetualCloseFee: publicCost(
        observedAtMs,
        `binance.public.perp-close-fee.${variant}`,
        '0.025',
      ),
      slippage: publicCost(
        observedAtMs,
        `basis.public.slippage.${variant}`,
        variant === 'a' ? '0.1' : '0.11',
        {
          state: 'MODEL_ASSUMPTION',
          provenance: publicProvenance(observedAtMs, {
            authority: 'PUBLIC_MODEL',
            sourceId: `basis.public.slippage.${variant}`,
            revision: `slippage-${variant}`,
            receivedAtMs: observedAtMs - 10,
            expiresAtMs: observedAtMs + 1_000,
            timeBasis: 'RECEIPT_TIME',
          }),
        },
      ),
      fundingCarry: publicCost(
        observedAtMs,
        `binance.public.funding.${variant}`,
        '0.02',
        {
          state: 'DERIVED_PUBLIC',
          provenance: publicProvenance(observedAtMs, {
            authority: 'PUBLIC_MODEL',
            sourceId: `binance.public.funding.${variant}`,
            revision: `funding-${variant}`,
            sourceEventAtMs: observedAtMs - 20,
            sourceTransactionAtMs: observedAtMs - 15,
            receivedAtMs: observedAtMs - 10,
            expiresAtMs: observedAtMs + 1_000,
            timeBasis: 'SOURCE_TRANSACTION_TIME',
          }),
        },
      ),
      borrowCost: {
        state: 'NOT_REQUIRED',
        valuePct: '0',
        provenance: publicProvenance(observedAtMs, {
          authority: 'NONE',
          sourceId: null,
          revision: null,
        }),
        reasonCodes: [],
      },
    },
  });
}

function rebuildEconomicFact(existing, preAcceptance) {
  return createSyntheticConservativeEconomicFactBinding({
    kind: existing.kind,
    scope: {
      ...existing.scope,
      proposalId: preAcceptance.id,
      proposalRevision: null,
      proposalUpdatedAtMs: preAcceptance.updatedTs,
      correlationId: preAcceptance.correlationId,
      symbol: preAcceptance.symbol,
      instrumentIds: [
        `${preAcceptance.symbol}:PERP`,
        `${preAcceptance.symbol}:SPOT`,
      ],
    },
    borrowScope: existing.borrowScope === null
      ? null
      : {
          ...existing.borrowScope,
          symbol: preAcceptance.symbol,
        },
    value: existing.value,
    unit: existing.unit,
    source: existing.source,
    ownerRevision: existing.ownerRevision,
    completeness: existing.completeness,
    evidenceIds: existing.evidenceIds,
  });
}

function createActualCapitalProofAndPlan(preAcceptance, handoff) {
  const acceptedNotionalExact = String(handoff.acceptedNotionalUsd);
  const template = makeWorld({
    spotQuantity: Number(QUANTITY),
    perpQuantity: Number(QUANTITY),
    requestedCapital: acceptedNotionalExact,
    acceptedNotionalUsd: handoff.acceptedNotionalUsd,
    allocationCap: acceptedNotionalExact,
  });

  const construction = structuredClone(
    template.capitalConstructionInput,
  );
  const canonicalProposalId =
    `cprop_${preAcceptance.id.slice('bp_'.length)}`;
  const proposal = construction.eligibilityCandidate.intake.proposal;
  proposal.sourceProposalId = preAcceptance.id;
  proposal.canonicalProposalId = canonicalProposalId;
  proposal.sourceCorrelationId = preAcceptance.correlationId;
  proposal.symbol = preAcceptance.symbol;
  proposal.direction = preAcceptance.direction;
  proposal.createdAtMs = preAcceptance.createdTs;
  proposal.updatedAtMs = preAcceptance.updatedTs;
  proposal.intakeDigest = `intake_${preAcceptance.id}`;

  const economics =
    construction.eligibilityCandidate.intake.economics;
  economics.requestedCapital = acceptedNotionalExact;
  economics.expectedGrossEdge = String(preAcceptance.grossEdgePct);
  economics.expectedNetEdge = String(preAcceptance.netEdgePct);
  economics.liquidityCapacity = acceptedNotionalExact;
  economics.fundingFact = rebuildEconomicFact(
    economics.fundingFact,
    preAcceptance,
  );
  economics.borrowFact = rebuildEconomicFact(
    economics.borrowFact,
    preAcceptance,
  );
  economics.capitalOpportunityFact = rebuildEconomicFact(
    economics.capitalOpportunityFact,
    preAcceptance,
  );

  const proofResult = createBasisValidateOnlyCapitalProof(
    deepFreeze(construction),
  );
  assert.equal(proofResult.ok, true, JSON.stringify(proofResult));
  const capital = proofResult.proof;
  assert.equal(
    capital.consideration.proposal.sourceProposalId,
    preAcceptance.id,
  );
  assert.equal(
    capital.consideration.proposal.sourceCorrelationId,
    preAcceptance.correlationId,
  );
  assert.equal(
    capital.consideration.proposal.updatedAtMs,
    preAcceptance.updatedTs,
  );
  assert.equal(
    capital.consideration.economics.requestedCapital,
    acceptedNotionalExact,
  );
  assert.equal(
    capital.consideration.economics.expectedNetEdge,
    String(preAcceptance.netEdgePct),
  );

  const planInput = structuredClone(template.planInput);
  planInput.proposal.canonicalProposalId = canonicalProposalId;
  planInput.proposal.observedAtMs = preAcceptance.updatedTs;
  planInput.proposal.expiresAtMs =
    capital.consideration.proposal.expiresAtMs;

  const normalBasis = planInput.normalBasis.evaluationInput;
  normalBasis.intent.proposalRef = canonicalProposalId;
  normalBasis.proposal.proposalId = canonicalProposalId;

  const baseInput = structuredClone(planInput);
  delete baseInput.normalBasis;
  const basePlan = createExecutionPlanDefinition(baseInput);
  normalBasis.correlationId = basePlan.correlationId;
  normalBasis.intent.planId = basePlan.planId;
  normalBasis.approval.subjectPlanId = basePlan.planId;

  const intentDigest = deriveRiskIntentDigest(normalBasis.intent);
  normalBasis.proposal.entryIntentDigest = intentDigest;
  normalBasis.approval.intentDigest = intentDigest;
  normalBasis.market.edgeIntentDigest = intentDigest;
  for (const liquidation of normalBasis.account.liquidations) {
    liquidation.intentDigest = intentDigest;
  }

  return {
    capital,
    canonicalProposalId,
    planInput: deepFreeze(planInput),
  };
}

function expectedClientOrderId(binding, step, attempt) {
  const normal = binding.plan.normalBasisBinding;
  assert.ok(normal);
  if (step === 'SPOT_OPEN' || step === 'PERP_OPEN') {
    assert.equal(attempt, 0);
    return normal.steps[step].clientOrderId;
  }
  return normal.closeAttempts.find(
    (candidate) =>
      candidate.step === step && candidate.attempt === attempt,
  ).clientOrderId;
}

function expectedLegId(binding, step) {
  if (step === 'SPOT_OPEN') return binding.plan.openingLegs.SPOT.legId;
  if (step === 'SPOT_CLOSE') return binding.plan.closingLegs.SPOT.legId;
  if (step === 'PERP_OPEN') return binding.plan.openingLegs.PERP.legId;
  return binding.plan.closingLegs.PERP.legId;
}

function spotStamp(sourceId) {
  return Object.freeze({
    sourceTimeMs: NOW - 10,
    receivedAtMs: NOW - 5,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId,
  });
}

function spotPublicSnapshot() {
  const observedAt = spotStamp('binance.spot.public.m1-i1-integrated');
  return Object.freeze({
    snapshotId: 'spot-public-m1-i1-integrated',
    symbol: SYMBOL,
    tradingStatus: 'TRADING',
    completeness: 'COMPLETE_SUPPORTED_FILTER_SET',
    filterObservedAt: observedAt,
    venueEvidenceObservedAt: observedAt,
    filters: Object.freeze([
      Object.freeze({
        filterType: 'PRICE_FILTER',
        minPrice: '1',
        maxPrice: '1000000',
        tickSize: '0.1',
      }),
      Object.freeze({
        filterType: 'LOT_SIZE',
        minQty: '0.001',
        maxQty: '100',
        stepSize: '0.001',
      }),
      Object.freeze({
        filterType: 'MARKET_LOT_SIZE',
        minQty: '0.001',
        maxQty: '50',
        stepSize: '0.001',
      }),
      Object.freeze({
        filterType: 'MIN_NOTIONAL',
        minNotional: '5',
        applyToMarket: true,
        avgPriceMins: 0,
      }),
    ]),
    venueEvidence: Object.freeze({
      referencePrice: Object.freeze({
        state: 'SET',
        price: PRICE,
        providerTimestampMs: NOW,
      }),
      fallbackPrices: Object.freeze([]),
      executionRules: Object.freeze([]),
    }),
  });
}

function prepareSpot(binding, step, attempt, quantity) {
  const normal = binding.plan.normalBasisBinding;
  const result = prepareBinanceSpotValidateOnlyOrder({
    evaluatedAtMs: NOW,
    publicSnapshot: spotPublicSnapshot(),
    order: Object.freeze({
      planId: binding.plan.planId,
      legId: expectedLegId(binding, step),
      attempt,
      symbol: binding.symbol,
      clientOrderId: expectedClientOrderId(binding, step, attempt),
      side: normal.steps[step].side,
      type: 'LIMIT',
      quantity,
      price: binding.spotPriceExact,
      timeInForce: 'GTC',
    }),
    policy: Object.freeze({
      enabled: true,
      killSwitchEngaged: false,
      authority: 'NONE',
    }),
  });
  assert.equal(result.status, 'VALIDATED', JSON.stringify(result));
  assert.equal(result.authority, 'NONE');
  assert.equal(result.sendEligible, false);
  assert.equal(result.transportCapability, 'ABSENT');
  assert.equal(
    result.evaluatedAtMs >= binding.acceptedRevisionTs &&
      result.evaluatedAtMs <= binding.proposalExpiresAtMs,
    true,
  );
  assert.equal(
    result.filterObservedAt.receivedAtMs >= binding.acceptedRevisionTs &&
      result.filterObservedAt.receivedAtMs <= binding.proposalExpiresAtMs,
    true,
  );
  return result;
}

function usdmObservedAt(sourceId, maxAgeMs = 60_000) {
  return Object.freeze({
    sourceTimeMs: NOW - 2,
    receivedAtMs: NOW - 1,
    maxAgeMs,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId,
  });
}

function usdmPublicEvidence() {
  const exchangeSymbol = Object.freeze({
    symbol: SYMBOL,
    status: 'TRADING',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    marginAsset: 'USDT',
    orderTypes: Object.freeze(['LIMIT', 'MARKET']),
    timeInForce: Object.freeze(['GTC', 'IOC']),
    filters: Object.freeze({
      price: Object.freeze({
        minPrice: '0.1',
        maxPrice: '1000000',
        tickSize: '0.1',
      }),
      lotSize: Object.freeze({
        minQty: '0.001',
        maxQty: '100',
        stepSize: '0.001',
      }),
      marketLotSize: Object.freeze({
        minQty: '0.001',
        maxQty: '50',
        stepSize: '0.001',
      }),
      minNotional: '5',
      percentPrice: Object.freeze({
        multiplierUp: '1.15',
        multiplierDown: '0.85',
        multiplierDecimal: 4,
      }),
      maxNumOrders: 200,
      unsupportedFilterTypes: Object.freeze([]),
    }),
    observedAt: usdmObservedAt(
      'binance.usdm.exchange-info.m1-i1-integrated',
    ),
  });
  const fundingForecast = Object.freeze({
    revision: 'funding-forecast-m1-i1-integrated',
    observedAt: usdmObservedAt(
      'binance.usdm.mark-price.m1-i1-integrated',
      15_000,
    ),
    value: Object.freeze({
      symbol: SYMBOL,
      markPrice: PRICE,
      indexPrice: PRICE,
      estimatedSettlePrice: PRICE,
      lastFundingRate: '0.0001',
      interestRate: '0.0001',
      nextFundingTimeMs: NOW + 28_800_000,
      sourceTimeMs: NOW - 2,
    }),
  });
  const fundingHistory = Object.freeze({
    revision: 'funding-history-m1-i1-integrated',
    observedAt: Object.freeze({
      ...usdmObservedAt(
        'binance.usdm.funding-history.m1-i1-integrated',
      ),
      sourceTimeMs: null,
    }),
    rows: Object.freeze([
      Object.freeze({
        symbol: SYMBOL,
        fundingRate: '0.0001',
        fundingTimeMs: NOW - 28_800_000,
        markPrice: PRICE,
        rateType: 'Regular',
      }),
    ]),
  });
  const seam = createBinanceUsdMPublicGroundworkSeam(
    Object.freeze({
      sourceEnabled: true,
      allowedSymbols: Object.freeze([SYMBOL]),
      maximumFilterAgeMs: 60_000,
      maximumForecastAgeMs: 15_000,
      maximumHistoryCaptureAgeMs: 60_000,
    }),
  );
  const groundwork = seam.validate(
    Object.freeze({
      nowMs: NOW,
      currentEffectiveKillSwitchEngaged: false,
      symbol: SYMBOL,
      exchangeSymbol,
      fundingForecast,
      fundingHistory,
    }),
  );
  assert.equal(groundwork.validationPassed, true, JSON.stringify(groundwork));
  return Object.freeze({
    groundwork,
    orderCapabilities: Object.freeze({
      revision: 'exchange-info-capabilities-m1-i1-integrated',
      observedAt: groundwork.filters.observedAt,
      orderTypes: exchangeSymbol.orderTypes,
      timeInForce: exchangeSymbol.timeInForce,
    }),
  });
}

function usdmPositionModeEvidence() {
  return Object.freeze({
    mode: 'ONE_WAY',
    scope: 'ACCOUNT',
    symbol: null,
    observedAtMs: NOW - 2,
    receivedAtMs: NOW - 1,
    maxAgeMs: 60_000,
    authority: 'SYNTHETIC_TEST',
    sourceId: 'binance.usdm.position-mode.m1-i1-integrated',
    revision: 'position-mode-m1-i1-integrated-r1',
  });
}

function prepareUsdM(binding, step, attempt, quantity) {
  const adapter = createBinanceUsdMBasisValidateOnlyAdapter(
    Object.freeze({
      enabled: true,
      sourceEnabled: true,
      killSwitchEngaged: false,
      authority: 'NONE',
      allowedSymbols: Object.freeze([SYMBOL]),
    }),
  );
  const result = adapter.buildOrderIntent(Object.freeze({
    nowMs: NOW,
    leg: step,
    symbol: binding.symbol,
    existingClientOrderId:
      expectedClientOrderId(binding, step, attempt),
    type: 'LIMIT',
    quantity,
    price: binding.perpPriceExact,
    positionModeEvidence: usdmPositionModeEvidence(),
    positionSide: 'BOTH',
    publicEvidence: usdmPublicEvidence(),
  }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.authority, 'NONE');
  assert.equal(result.sendEligible, false);
  assert.equal(result.networkRequestsPerformed, 0);
  assert.equal(result.privateRequestsPerformed, 0);
  assert.equal(result.signedRequestsPerformed, 0);
  assert.equal(result.ordersPerformed, 0);
  assert.equal(result.sideEffectsPerformed, 0);
  assert.equal(
    result.intent.localValidation.publicEvidenceReceivedAtMs >=
      binding.acceptedRevisionTs &&
      result.intent.localValidation.publicEvidenceReceivedAtMs <=
        binding.proposalExpiresAtMs,
    true,
  );
  assert.equal(
    result.intent.localValidation.positionModeReceivedAtMs >=
      binding.acceptedRevisionTs &&
      result.intent.localValidation.positionModeReceivedAtMs <=
        binding.proposalExpiresAtMs,
    true,
  );
  return { adapter, result };
}

function usdmFoundEvidence(intent, overrides = {}) {
  return Object.freeze({
    nowMs: NOW,
    observedAtMs: NOW - 2,
    receivedAtMs: NOW - 1,
    maxAgeMs: 5_000,
    authority: 'SYNTHETIC_TEST',
    outcome: 'FOUND',
    order: Object.freeze({
      symbol: intent.symbol,
      clientOrderId: intent.existingClientOrderId,
      side: intent.side,
      type: intent.type,
      origQty: intent.quantity,
      executedQty: intent.quantity,
      price: intent.price ?? '0',
      timeInForce: 'GTC',
      positionSide: intent.positionSide,
      reduceOnly: intent.reduceOnly,
      closePosition: false,
      status: 'FILLED',
      ...(overrides.order ?? {}),
    }),
  });
}

function apply(state, binding, observation) {
  const result = applyBasisValidateOnlyObservation(
    binding,
    state,
    observation,
  );
  assert.equal(result.applied, true, JSON.stringify(result));
  return result.state;
}

function validate(state, binding, step, attempt, adapterResult) {
  return apply(state, binding, {
    kind: 'VALIDATION',
    step,
    attempt,
    adapterResult,
  });
}

function outcome(
  state,
  binding,
  step,
  attempt,
  phase,
  terminalStatus = null,
  quantity = null,
) {
  return apply(state, binding, {
    kind: 'OUTCOME',
    step,
    attempt,
    clientOrderId: expectedClientOrderId(binding, step, attempt),
    state: phase,
    terminalStatus,
    cumulativeFilledQuantityExact: quantity,
    evidenceAuthority: 'SYNTHETIC_TEST',
  });
}

function flatnessInput(binding, state) {
  const normal = binding.plan.normalBasisBinding;
  const closeIds = (step) =>
    normal.closeAttempts
      .filter((candidate) => candidate.step === step)
      .sort((left, right) => left.attempt - right.attempt)
      .map((candidate) => candidate.clientOrderId);
  const identity = {
    planId: binding.plan.planId,
    bindingId: binding.bindingId,
    termsFingerprint: binding.plan.termsFingerprint,
    accountId: binding.accountId,
    symbol: binding.symbol,
    acceptedRevisionTs: binding.acceptedRevisionTs,
    stateRevision: state.revision,
    stateRevisionId: state.stateRevisionId,
    direction: 'LONG_SPOT_SHORT_PERP',
    positionMode: 'ONE_WAY',
    clientOrderIds: {
      SPOT_OPEN: normal.steps.SPOT_OPEN.clientOrderId,
      PERP_OPEN: normal.steps.PERP_OPEN.clientOrderId,
      PERP_CLOSE: normal.steps.PERP_CLOSE.clientOrderId,
      SPOT_CLOSE: normal.steps.SPOT_CLOSE.clientOrderId,
    },
    closeAttemptClientOrderIds: {
      PERP_CLOSE: closeIds('PERP_CLOSE'),
      SPOT_CLOSE: closeIds('SPOT_CLOSE'),
    },
    actionAuthority: 'NONE_RECORD_ONLY',
    riskAuthority: 'NONE',
    sendEligible: false,
  };
  const common = {
    planId: identity.planId,
    bindingId: identity.bindingId,
    termsFingerprint: identity.termsFingerprint,
    accountId: identity.accountId,
    symbol: identity.symbol,
    acceptedRevisionTs: identity.acceptedRevisionTs,
    stateRevision: identity.stateRevision,
    stateRevisionId: identity.stateRevisionId,
  };
  const order = (
    step,
    attempt,
    status,
    submittedQuantityExact,
    cumulativeFilledQuantityExact,
  ) => ({
    step,
    attempt,
    ...common,
    venue:
      step.startsWith('SPOT') ? 'BINANCE_SPOT' : 'BINANCE_USDM',
    side: normal.steps[step].side,
    reduceOnly: normal.steps[step].reduceOnly,
    clientOrderId: expectedClientOrderId(binding, step, attempt),
    status,
    submittedQuantityExact,
    cumulativeFilledQuantityExact,
    ambiguous: false,
    terminalObservedAtMs:
      step === 'SPOT_OPEN'
        ? NOW - 50
        : step === 'PERP_OPEN'
          ? NOW - 40
          : step === 'PERP_CLOSE'
            ? NOW - 30 + attempt
            : NOW - 10 + attempt,
  });
  const metadata = (
    sourceId,
    sourceTimeMs,
    receivedAtMs = sourceTimeMs,
  ) => ({
    sourceId,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimeMs,
    receivedAtMs,
    maxAgeMs: 5_000,
  });
  const position = (venue, positionMode, baseline, current) => ({
    venue,
    accountId: identity.accountId,
    symbol: identity.symbol,
    acceptedRevisionTs: identity.acceptedRevisionTs,
    stateRevision: identity.stateRevision,
    stateRevisionId: identity.stateRevisionId,
    positionMode,
    baselineSignedBaseQuantityExact: baseline,
    currentSignedBaseQuantityExact: current,
    baselineMetadata: metadata(
      `${venue}.baseline.m1-i1-integrated`,
      binding.acceptedRevisionTs - 1,
      binding.acceptedRevisionTs,
    ),
    currentMetadata: metadata(
      `${venue}.current.m1-i1-integrated`,
      NOW - 1,
      NOW,
    ),
  });
  return deepFreeze({
    nowMs: NOW,
    policy: { maximumEvidenceAgeMs: 5_000 },
    plan: identity,
    evidence: {
      orders: {
        metadata: metadata(
          'orders.m1-i1-integrated',
          NOW - 1,
          NOW,
        ),
        records: [
          order('SPOT_OPEN', 0, 'FILLED', QUANTITY, QUANTITY),
          order('PERP_OPEN', 0, 'FILLED', QUANTITY, QUANTITY),
          order('PERP_CLOSE', 0, 'CANCELLED', QUANTITY, '0.1'),
          order('PERP_CLOSE', 1, 'FILLED', '0.2', '0.2'),
          order('SPOT_CLOSE', 0, 'FILLED', QUANTITY, QUANTITY),
        ],
      },
      positions: [
        position('BINANCE_SPOT', 'CASH', '2', '2'),
        position('BINANCE_USDM', 'ONE_WAY', '-2', '-2'),
      ],
      ambiguities: [],
    },
  });
}

function assertT3Excluded(serialized, observations) {
  for (const observation of observations) {
    assert.equal(
      serialized.includes(observation.observationId),
      false,
      'T-3 observation identity must not enter downstream state',
    );
    assert.equal(
      serialized.includes(observation.sourceCutId),
      false,
      'T-3 source-cut identity must not enter downstream state',
    );
  }
}

test('actual proposal to exact flatness stays validate-only and contains T-3 telemetry', () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalSetInterval = globalThis.setInterval;
  let fetchAttempts = 0;
  let timerAttempts = 0;
  globalThis.fetch = async () => {
    fetchAttempts += 1;
    throw new Error('network/provider access is forbidden');
  };
  globalThis.setTimeout = () => {
    timerAttempts += 1;
    throw new Error('timers are forbidden');
  };
  globalThis.setInterval = () => {
    timerAttempts += 1;
    throw new Error('timers are forbidden');
  };

  try {
    const p1 = createAcceptedP1Handoff();
    const t3A = buildT3Observation(p1.preAcceptance, 'a');
    assert.deepEqual(validatePublicBasisOpportunityObservation(t3A), []);
    assert.equal(t3A.opportunityId, p1.preAcceptance.id);
    assert.equal(t3A.correlationId, p1.preAcceptance.correlationId);
    assert.equal(t3A.strategyAuthority, 'BASIS_ENGINE');
    assert.equal(t3A.sourceAuthority, 'PUBLIC_ONLY');
    assert.equal(t3A.releaseState, 'NOT_CONFIGURED');
    assert.equal(t3A.executionAuthority, 'NONE');
    assert.equal(t3A.economics.accountEffectiveNetState, 'UNKNOWN');
    assert.equal(t3A.economics.accountEffectiveNetEdgePct, null);

    const owner = createActualCapitalProofAndPlan(
      p1.preAcceptance,
      p1.handoff,
    );
    assert.equal(
      owner.capital.consideration.proposal.sourceProposalId,
      p1.handoff.proposalId,
    );
    assert.equal(
      owner.capital.consideration.proposal.sourceCorrelationId,
      p1.handoff.correlationId,
    );

    const bound = bindBasisValidateOnlyPlan(
      deepFreeze({
        handoff: p1.handoff,
        capital: owner.capital,
        planInput: owner.planInput,
        nowMs: NOW,
      }),
      enabledControls(),
    );
    assert.equal(bound.ok, true, JSON.stringify(bound));
    const binding = bound.binding;
    assert.equal(binding.sourceProposalId, p1.preAcceptance.id);
    assert.equal(
      binding.handoffCorrelationId,
      p1.preAcceptance.correlationId,
    );
    assert.equal(
      binding.acceptedRevisionTs,
      p1.preAcceptance.updatedTs,
    );
    assert.equal(binding.canonicalProposalId, owner.canonicalProposalId);
    assert.equal(binding.externalMode, 'VALIDATE_ONLY');
    assert.equal(binding.strategyAuthority, 'NONE');
    assert.equal(binding.capitalAuthority, 'NONE');
    assert.equal(binding.riskAuthority, 'NONE');
    assert.equal(binding.executionAuthority, 'NONE');
    assert.equal(binding.actionAuthority, 'NONE');
    assert.equal(binding.sendEligible, false);

    let state = createBasisValidateOnlyLifecycle(binding);
    const bindingBytes = canonicalJson(binding);
    const initialCheckpoint =
      serializeBasisValidateOnlyCheckpoint(binding, state);
    assertT3Excluded(bindingBytes, [t3A]);
    assertT3Excluded(initialCheckpoint, [t3A]);

    const t3B = buildT3Observation(p1.preAcceptance, 'b');
    assert.deepEqual(validatePublicBasisOpportunityObservation(t3B), []);
    assert.notEqual(t3B.observationId, t3A.observationId);
    assert.notEqual(t3B.sourceCutId, t3A.sourceCutId);
    assert.equal(canonicalJson(binding), bindingBytes);
    assert.equal(
      serializeBasisValidateOnlyCheckpoint(binding, state),
      initialCheckpoint,
    );
    assertT3Excluded(bindingBytes, [t3A, t3B]);
    assertT3Excluded(initialCheckpoint, [t3A, t3B]);

    const spotOpen = prepareSpot(
      binding,
      'SPOT_OPEN',
      0,
      QUANTITY,
    );
    state = validate(state, binding, 'SPOT_OPEN', 0, spotOpen);
    state = outcome(
      state,
      binding,
      'SPOT_OPEN',
      0,
      'TERMINAL',
      'FILLED',
      QUANTITY,
    );

    const perpOpen = prepareUsdM(
      binding,
      'PERP_OPEN',
      0,
      QUANTITY,
    );
    state = validate(
      state,
      binding,
      'PERP_OPEN',
      0,
      perpOpen.result,
    );
    state = outcome(
      state,
      binding,
      'PERP_OPEN',
      0,
      'TERMINAL',
      'FILLED',
      QUANTITY,
    );

    const close0 = prepareUsdM(
      binding,
      'PERP_CLOSE',
      0,
      QUANTITY,
    );
    state = validate(
      state,
      binding,
      'PERP_CLOSE',
      0,
      close0.result,
    );
    state = outcome(
      state,
      binding,
      'PERP_CLOSE',
      0,
      'AMBIGUOUS',
    );
    assert.equal(state.action.disposition, 'QUERY_REQUIRED');
    const ambiguousClientOrderId = state.activeClientOrderId;
    assert.equal(
      ambiguousClientOrderId,
      expectedClientOrderId(binding, 'PERP_CLOSE', 0),
    );

    const ambiguousCheckpoint =
      serializeBasisValidateOnlyCheckpoint(binding, state);
    const restored = restoreBasisValidateOnlyCheckpoint(
      binding,
      ambiguousCheckpoint,
    );
    assert.equal(restored.ok, true, JSON.stringify(restored));
    state = restored.state;
    assert.equal(state.action.disposition, 'QUERY_REQUIRED');
    assert.equal(state.activeClientOrderId, ambiguousClientOrderId);
    assert.equal(state.action.clientOrderId, ambiguousClientOrderId);

    const queryDescriptorResult =
      close0.adapter.buildOrderQueryDescriptor(close0.result.intent);
    assert.equal(
      queryDescriptorResult.ok,
      true,
      JSON.stringify(queryDescriptorResult),
    );
    assert.equal(queryDescriptorResult.descriptor.callable, false);
    assert.equal(
      queryDescriptorResult.descriptor.origClientOrderId,
      ambiguousClientOrderId,
    );
    assert.equal(
      queryDescriptorResult.descriptor.queryFields.origClientOrderId,
      ambiguousClientOrderId,
    );
    assert.equal(queryDescriptorResult.authority, 'NONE');
    assert.equal(queryDescriptorResult.networkRequestsPerformed, 0);
    assert.equal(queryDescriptorResult.privateRequestsPerformed, 0);
    assert.equal(queryDescriptorResult.signedRequestsPerformed, 0);
    assert.equal(queryDescriptorResult.sideEffectsPerformed, 0);

    const canceled = close0.adapter.normalizeOrderQueryEvidence(
      close0.result.intent,
      usdmFoundEvidence(close0.result.intent, {
        order: {
          status: 'CANCELED',
          executedQty: '0.10000000',
        },
      }),
    );
    state = apply(state, binding, {
      kind: 'QUERY',
      step: 'PERP_CLOSE',
      attempt: 0,
      clientOrderId: ambiguousClientOrderId,
      adapterResult: close0.result,
      queryDescriptorResult,
      queryResolution: canceled,
    });
    assert.equal(state.next, 'PERP_CLOSE');
    assert.equal(state.attempt, 1);
    assert.equal(state.expectedQuantityExact, '0.2');
    assert.notEqual(
      state.expectedQuantityExact,
      '0.19999999999999998',
    );

    const close1 = prepareUsdM(
      binding,
      'PERP_CLOSE',
      1,
      '0.2',
    );
    assert.notEqual(
      close1.result.intent.existingClientOrderId,
      ambiguousClientOrderId,
    );
    state = validate(
      state,
      binding,
      'PERP_CLOSE',
      1,
      close1.result,
    );
    state = outcome(
      state,
      binding,
      'PERP_CLOSE',
      1,
      'TERMINAL',
      'FILLED',
      '0.2',
    );

    const spotClose = prepareSpot(
      binding,
      'SPOT_CLOSE',
      0,
      QUANTITY,
    );
    state = validate(
      state,
      binding,
      'SPOT_CLOSE',
      0,
      spotClose,
    );
    state = outcome(
      state,
      binding,
      'SPOT_CLOSE',
      0,
      'TERMINAL',
      'FILLED',
      QUANTITY,
    );
    assert.equal(state.next, 'FLATNESS');
    assert.equal(state.action.disposition, 'FLATNESS_REQUIRED');

    const reconciliationInput = flatnessInput(binding, state);
    const flatness = verifyBasisFlatness(reconciliationInput);
    assert.equal(flatness.status, 'FLAT', JSON.stringify(flatness));
    assert.equal(flatness.flat, true);
    assert.deepEqual(flatness.exact, {
      spotOrderDeltaExact: '0',
      usdmOrderDeltaExact: '0',
      spotPositionDeltaExact: '0',
      usdmPositionDeltaExact: '0',
      spotOrderPositionDifferenceExact: '0',
      usdmOrderPositionDifferenceExact: '0',
    });
    state = apply(state, binding, {
      kind: 'FLATNESS',
      input: reconciliationInput,
      result: flatness,
    });

    assert.equal(state.complete, true);
    assert.equal(state.next, 'COMPLETE');
    assert.equal(state.action.disposition, 'COMPLETE');
    assert.deepEqual(state.terminalFilledExact, {
      SPOT_OPEN: QUANTITY,
      PERP_OPEN: QUANTITY,
      PERP_CLOSE: QUANTITY,
      SPOT_CLOSE: QUANTITY,
    });
    assert.equal(state.executionAuthority, 'NONE');
    assert.equal(state.externalActionAuthorization, 'NONE');
    assert.equal(state.sendEligible, false);
    assert.equal(state.sendsPerformed, 0);
    assert.equal(state.networkRequestsPerformed, 0);
    assert.equal(state.privateRequestsPerformed, 0);
    assert.equal(state.signedRequestsPerformed, 0);
    assert.equal(state.ordersPerformed, 0);
    assert.equal(state.sideEffectsPerformed, 0);

    const completedCheckpoint =
      serializeBasisValidateOnlyCheckpoint(binding, state);
    assertT3Excluded(completedCheckpoint, [t3A, t3B]);
    const decodedCompletedCheckpoint = JSON.parse(completedCheckpoint);
    const completedReplay = replayBasisValidateOnlyLifecycle(
      binding,
      decodedCompletedCheckpoint.journal,
    );
    assert.equal(completedReplay.ok, true, JSON.stringify(completedReplay));
    const {
      journal: _completedReplayJournal,
      ...completedReplayProjection
    } = completedReplay.state;
    assert.deepEqual(
      completedReplayProjection,
      decodedCompletedCheckpoint.projection,
    );
    const completedRestore = restoreBasisValidateOnlyCheckpoint(
      binding,
      completedCheckpoint,
    );
    assert.equal(completedRestore.ok, true, JSON.stringify(completedRestore));
    assert.equal(completedRestore.state.complete, true);
    assert.equal(
      completedRestore.state.stateRevisionId,
      state.stateRevisionId,
    );
    assert.equal(fetchAttempts, 0);
    assert.equal(timerAttempts, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.setInterval = originalSetInterval;
  }
});

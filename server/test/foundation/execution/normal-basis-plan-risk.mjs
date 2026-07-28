#!/usr/bin/env node
/**
 * M1-P2 — immutable normal-Basis plan/risk lifecycle proof.
 *
 * ZERO NETWORK. All evidence, timestamps, order observations, and account
 * baselines are deterministic in-memory fixtures. Run only after:
 *   npm run build -w server
 *   node server/test/foundation/execution/normal-basis-plan-risk.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  appendNormalBasisProgress,
  compareNormalBasisBinding,
  createExecutionEvent,
  createExecutionPlanDefinition,
  createNormalBasisProgress,
  recommendExecutionRecovery,
  reduceExecutionEvent,
  restoreExecutionCheckpoint,
  restoreExecutionCoordinator,
  serializeExecutionCheckpoint,
} from '../../../dist/foundation/execution/index.js';
import {
  canonicalJson,
  derivePlanId,
  stableHash128Hex,
} from '../../../dist/foundation/contracts/index.js';
import {
  deriveRiskIntentDigest,
} from '../../../dist/foundation/risk/index.js';

const NOW = 1_900_000_000_000;
const DAY_MS = 86_400_000;
const DAY_START = Math.floor(NOW / DAY_MS) * DAY_MS;
const SYMBOL = 'BTCUSDT';
const ACCOUNT = 'normal-basis-test';

let networkAttempts = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  networkAttempts += 1;
  throw new Error('network forbidden in normal-Basis proof');
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

function assertQuantity(actual, expected) {
  assert.equal(typeof actual, 'number');
  assert.ok(Math.abs(actual - expected) <= 1e-12, `quantity ${actual} != ${expected}`);
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

function planInput(overrides = {}) {
  const proposal = overrides.proposal ?? {
    canonicalProposalId: 'cprop_normal_basis_m1_p2',
    observedAtMs: NOW - 100,
    maxAgeMs: 10_000,
    expiresAtMs: NOW + 6_000,
  };
  return {
    strategy: 'BASIS',
    direction: 'LONG_SPOT_SHORT_PERP',
    symbol: SYMBOL,
    attempt: 0,
    mode: 'PAPER',
    requiresApproval: false,
    maxNakedDurationMs: 1_000,
    spotQuantity: 1,
    perpQuantity: 1,
    openingOrder: ['SPOT', 'PERP'],
    ...overrides,
    proposal,
  };
}

class FixedClock {
  constructor(nowMs) {
    this.value = nowMs;
  }
  nowMs() {
    return this.value;
  }
  schedule() {
    return { cancel() {} };
  }
}

class FakePorts {
  constructor(lookupOutcomes = [], submissionOutcomes = []) {
    this.calls = [];
    this.claims = new Map();
    this.lookupOutcomes = [...lookupOutcomes];
    this.submissionOutcomes = [...submissionOutcomes];
  }
  claimPlanIdentity(planId, termsFingerprint) {
    const existing = this.claims.get(planId);
    this.calls.push({ method: 'claimPlanIdentity', planId, termsFingerprint });
    if (existing === undefined) {
      this.claims.set(planId, termsFingerprint);
      return 'CLAIMED';
    }
    return existing === termsFingerprint ? 'EXISTING_SAME' : 'CONFLICT';
  }
  async preflight() {
    this.calls.push({ method: 'preflight' });
    return { ok: true };
  }
  async validateLeg(request) {
    this.calls.push({ method: 'validateLeg', clientOrderId: request.leg.clientOrderId });
    return { ok: true };
  }
  async submitPaper(request) {
    this.calls.push({
      method: 'submitPaper',
      clientOrderId: request.leg.clientOrderId,
      quantity: request.leg.quantity,
    });
    return this.submissionOutcomes.shift() ?? {
      kind: 'REJECTED',
      failure: {
        code: 'UNPLANNED_SUBMISSION',
        message: 'No synthetic submission was queued.',
        retryable: false,
        recommendedOperatorAction: 'Fix the test.',
      },
    };
  }
  async lookupByClientOrderId(request) {
    this.calls.push({
      method: 'lookupByClientOrderId',
      clientOrderId: request.leg.clientOrderId,
      quantity: request.leg.quantity,
    });
    return this.lookupOutcomes.shift() ?? {
      kind: 'UNRESOLVED',
      failure: {
        code: 'UNPLANNED_LOOKUP',
        message: 'No synthetic lookup was queued.',
        retryable: false,
        recommendedOperatorAction: 'Fix the test.',
      },
    };
  }
  async reconcile() {
    this.calls.push({ method: 'reconcile' });
    return { kind: 'UNRESOLVED', failure: {
      code: 'RECONCILIATION_NOT_USED',
      message: 'This proof records explicit baseline evidence.',
      retryable: false,
      recommendedOperatorAction: 'Fix the test.',
    } };
  }
}

function approvedRiskInput(plan) {
  const intent = {
    planId: plan.planId,
    accountId: ACCOUNT,
    proposalRef: plan.proposal.canonicalProposalId,
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
      proposalId: intent.proposalRef,
      entryIntentDigest: intentDigest,
      lifecycle: 'OPEN',
      expiresAtMs: NOW + 4_000,
      observedAt: stamp('strategy.proposal'),
    },
    approval: {
      approvalId: 'approval-normal-basis',
      subjectPlanId: plan.planId,
      authorizedRiskClass: 'RISK_INCREASING',
      intentDigest,
      grantedAtMs: NOW - 500,
      expiresAtMs: NOW + 3_000,
      observedAt: stamp('control.approval'),
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
        observedAt: stamp('binance.account.spot-inventory'),
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
            observedAt: stamp('binance.spot.account.position'),
          },
          {
            venue: 'BINANCE_USDM',
            symbol: SYMBOL,
            positionBucket: 'USDM_ONE_WAY',
            signedBaseQty: -2,
            observedAt: stamp('binance.usdm.account.position'),
          },
        ],
        observedAt: stamp('binance.account.positions'),
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

function createState(plan) {
  const event = createExecutionEvent(plan.planId, 1, NOW, 'PLAN_CREATED', { plan });
  const result = reduceExecutionEvent(null, event);
  assert.equal(result.applied, true);
  return result.state;
}

function applyEvent(state, type, details = {}) {
  const event = createExecutionEvent(
    state.plan.planId,
    state.lastSequence + 1,
    nextObservedAtMs(),
    type,
    details,
  );
  const result = reduceExecutionEvent(state, event);
  assert.equal(result.applied, true, result.applied ? '' : result.reason);
  return result.state;
}

let observedAtMs = NOW;
function nextObservedAtMs() {
  observedAtMs += 1;
  return observedAtMs;
}

function orderObservation(progress, state) {
  const action = progress.action;
  assert.notEqual(action.step, null);
  assert.notEqual(action.attempt, null);
  assert.notEqual(action.clientOrderId, null);
  assert.notEqual(action.quantity, null);
  return {
    kind: 'ORDER',
    journalIndex: progress.journal.length,
    occurredAtMs: nextObservedAtMs(),
    step: action.step,
    attempt: action.attempt,
    state,
    clientOrderId: action.clientOrderId,
    submittedQuantity: action.quantity,
    cumulativeFilledQuantity: 0,
  };
}

function appendPureOrder(binding, progress, state, cumulativeFilledQuantity = 0) {
  return appendNormalBasisProgress(binding, progress, {
    ...orderObservation(progress, state),
    cumulativeFilledQuantity,
  });
}

function recordOrder(state, orderState, cumulativeFilledQuantity = 0) {
  const observation = {
    ...orderObservation(state.normalBasisProgress, orderState),
    cumulativeFilledQuantity,
  };
  const event = createExecutionEvent(
    state.plan.planId,
    state.lastSequence + 1,
    observation.occurredAtMs,
    'NORMAL_BASIS_PROGRESS_OBSERVED',
    { normalBasisObservation: observation },
  );
  const result = reduceExecutionEvent(state, event);
  assert.equal(result.applied, true, result.applied ? '' : result.reason);
  return result.state;
}

function recordBaseline(state, spotSignedBaseQty, perpSignedBaseQty) {
  const observation = {
    kind: 'BASELINE',
    journalIndex: state.normalBasisProgress.journal.length,
    occurredAtMs: nextObservedAtMs(),
    bindingId: state.plan.normalBasisBinding.bindingId,
    observedStateRevisionId: state.stateRevisionId,
    observedStateRevision: state.revision,
    spotSignedBaseQty,
    perpSignedBaseQty,
  };
  const event = createExecutionEvent(
    state.plan.planId,
    state.lastSequence + 1,
    observation.occurredAtMs,
    'NORMAL_BASIS_PROGRESS_OBSERVED',
    { normalBasisObservation: observation },
  );
  const result = reduceExecutionEvent(state, event);
  assert.equal(result.applied, true, result.applied ? '' : result.reason);
  return result.state;
}

function resignCheckpoint(checkpoint) {
  const { checksum: _discarded, ...payload } = checkpoint;
  return canonicalJson({
    ...payload,
    checksum: stableHash128Hex(canonicalJson(payload)),
  });
}

try {
  const omitted = createExecutionPlanDefinition(planInput());
  const explicitUndefined = createExecutionPlanDefinition(planInput({ normalBasis: undefined }));
  assert.equal(Object.hasOwn(omitted, 'normalBasisBinding'), false);
  assert.equal(canonicalJson(omitted), canonicalJson(explicitUndefined));
  assert.equal(
    omitted.planId,
    derivePlanId({ canonicalProposalId: omitted.proposal.canonicalProposalId, attempt: 0 }),
  );
  assert.equal(omitted.termsFingerprint, explicitUndefined.termsFingerprint);
  assert.deepEqual(
    [
      omitted.openingLegs.SPOT.legId,
      omitted.openingLegs.PERP.legId,
      omitted.closingLegs.SPOT.legId,
      omitted.closingLegs.PERP.legId,
      omitted.openingLegs.SPOT.clientOrderId,
      omitted.openingLegs.PERP.clientOrderId,
      omitted.closingLegs.SPOT.clientOrderId,
      omitted.closingLegs.PERP.clientOrderId,
    ],
    [
      explicitUndefined.openingLegs.SPOT.legId,
      explicitUndefined.openingLegs.PERP.legId,
      explicitUndefined.closingLegs.SPOT.legId,
      explicitUndefined.closingLegs.PERP.legId,
      explicitUndefined.openingLegs.SPOT.clientOrderId,
      explicitUndefined.openingLegs.PERP.clientOrderId,
      explicitUndefined.closingLegs.SPOT.clientOrderId,
      explicitUndefined.closingLegs.PERP.clientOrderId,
    ],
  );
  const omittedCheckpoint = serializeExecutionCheckpoint(createState(omitted));
  const explicitUndefinedCheckpoint = serializeExecutionCheckpoint(createState(explicitUndefined));
  assert.equal(omittedCheckpoint, explicitUndefinedCheckpoint);
  assert.equal(omittedCheckpoint.length, 5_150);
  assert.equal(
    createHash('sha256').update(omittedCheckpoint).digest('hex'),
    '3ffc5ebc91bfc523c19c2c7c99c6226f324332a74f9f8a9df79635250651e793',
  );

  const riskInput = approvedRiskInput(omitted);
  const bound = createExecutionPlanDefinition(planInput({
    normalBasis: { version: 1, evaluationInput: riskInput },
  }));
  const binding = bound.normalBasisBinding;
  assert.ok(binding);
  assert.equal(binding.planId, bound.planId);
  assert.equal(binding.correlationId, bound.correlationId);
  assert.equal(binding.termsFingerprint, bound.termsFingerprint);
  assert.deepEqual(binding.stepOrder, ['SPOT_OPEN', 'PERP_OPEN', 'PERP_CLOSE', 'SPOT_CLOSE']);
  assert.equal(binding.maxNakedDurationMs, 1_000);
  assert.equal(binding.entryExpiresAtMs, NOW + 990);
  assert.equal(binding.risk.approvedEntryGrossNotionalExact, '200');
  assert.match(binding.risk.riskIntentDigest, /^riskint_[0-9a-f]{32}$/);
  assert.match(binding.risk.riskVerdictDigest, /^riskv_[0-9a-f]{32}$/);
  assert.deepEqual(binding.risk.baseline, {
    accountId: ACCOUNT,
    symbol: SYMBOL,
    positionMode: 'ONE_WAY',
    observedAtMs: NOW - 10,
    spotSignedBaseQty: 2,
    perpSignedBaseQty: -2,
  });
  assert.equal(binding.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(binding.riskAuthority, 'NONE');
  assert.equal(binding.sendEligible, false);
  assert.equal(binding.policy.crossProcessExactlyOnce, false);
  assert.equal(binding.policy.ledgerCasRequiredForExactlyOnce, true);
  assert.equal(binding.maxCloseAttempts, 4);
  assert.equal(binding.closeAttempts.length, 8);
  assert.equal(new Set(binding.closeAttempts.map((attempt) => attempt.clientOrderId)).size, 8);
  assert.equal(binding.steps.PERP_CLOSE.reduceOnly, true);
  assert.equal(binding.steps.SPOT_CLOSE.reduceOnly, false);
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(Object.isFrozen(binding.steps), true);
  assert.equal(
    compareNormalBasisBinding(
      bound,
      createExecutionPlanDefinition(planInput({
        normalBasis: { version: 1, evaluationInput: approvedRiskInput(omitted) },
      })),
    ),
    'SAME_BINDING',
  );

  const initialProgress = createNormalBasisProgress(binding);
  assert.equal(initialProgress.next, 'SPOT_OPEN');
  assert.equal(initialProgress.action.disposition, 'SUBMIT_ELIGIBLE');
  assert.equal(initialProgress.action.sendEligible, false);
  assert.equal(
    initialProgress.deliveryGuarantee,
    'PROCESS_LOCAL_REPLAY_ONLY_REQUIRES_LEDGER_CAS',
  );
  assert.throws(
    () => appendNormalBasisProgress(binding, initialProgress, {
      ...orderObservation(initialProgress, 'SUBMISSION_STARTED'),
      occurredAtMs: binding.entryExpiresAtMs,
    }),
    /entry authority expired/,
  );
  let lateHedge = appendPureOrder(binding, initialProgress, 'SUBMISSION_STARTED');
  lateHedge = appendPureOrder(binding, lateHedge, 'FILLED', 1);
  assert.equal(lateHedge.next, 'PERP_OPEN');
  lateHedge = appendNormalBasisProgress(binding, lateHedge, {
    ...orderObservation(lateHedge, 'SUBMISSION_STARTED'),
    occurredAtMs: binding.entryExpiresAtMs + 1,
  });
  assert.equal(lateHedge.next, 'PERP_OPEN');
  assert.equal(lateHedge.action.disposition, 'AWAIT_TERMINAL');

  // One active identity is the cap, and the four-leg sequence cannot be skipped.
  const oneWorking = appendPureOrder(binding, initialProgress, 'SUBMISSION_STARTED');
  assert.equal(oneWorking.action.disposition, 'AWAIT_TERMINAL');
  assert.equal(oneWorking.workingOrAmbiguousClientOrderId, null);
  assert.throws(
    () => appendNormalBasisProgress(binding, oneWorking, {
      ...orderObservation(oneWorking, 'SUBMISSION_STARTED'),
      step: 'PERP_OPEN',
      clientOrderId: binding.steps.PERP_OPEN.clientOrderId,
    }),
    /does not match the actionable projection/,
  );

  let state = createState(bound);
  state = applyEvent(state, 'PREFLIGHT_STARTED');
  state = applyEvent(state, 'PREFLIGHT_PASSED');
  state = applyEvent(state, 'OPENING_STARTED');
  assert.equal(state.normalBasisProgress.next, 'SPOT_OPEN');

  // Coordinator crash-cut: the deadline escalates once, then cannot trap the hedge.
  const coordinatorDeadlineMainTime = observedAtMs;
  let coordinatorDeadlineState = recordOrder(state, 'SUBMISSION_STARTED');
  coordinatorDeadlineState = recordOrder(coordinatorDeadlineState, 'FILLED', 1);
  assert.equal(coordinatorDeadlineState.lifecycle, 'ONE_LEG_EXPOSED');
  assert.equal(coordinatorDeadlineState.normalBasisProgress.next, 'PERP_OPEN');
  const boundHedgeId =
    coordinatorDeadlineState.normalBasisProgress.action.clientOrderId;
  const boundHedgeQuantity =
    coordinatorDeadlineState.normalBasisProgress.action.quantity;
  const coordinatorDeadlineCheckpoint =
    serializeExecutionCheckpoint(coordinatorDeadlineState);
  const coordinatorDeadlinePorts = new FakePorts(
    [],
    [{ kind: 'ACKNOWLEDGED', venueOrderId: 'paper-deadline-hedge' }],
  );
  const coordinatorDeadlineRestore = restoreExecutionCoordinator(
    coordinatorDeadlineCheckpoint,
    new FixedClock(
      coordinatorDeadlineState.exposedSinceMs +
        coordinatorDeadlineState.plan.maxNakedDurationMs,
    ),
    coordinatorDeadlinePorts,
  );
  assert.equal(
    coordinatorDeadlineRestore.ok,
    true,
    coordinatorDeadlineRestore.ok ? '' : coordinatorDeadlineRestore.code,
  );
  const deadlineCoordinator = coordinatorDeadlineRestore.coordinator;
  const deadlineBlocked = await deadlineCoordinator.advanceNormalBasis();
  assert.equal(deadlineBlocked.ok, false);
  assert.equal(deadlineBlocked.failure.code, 'NAKED_DURATION_EXPIRED');
  assert.equal(deadlineCoordinator.snapshot().lifecycle, 'RECOVERY_REQUIRED');
  assert.equal(
    deadlineCoordinator.snapshot().eventLog.at(-1).type,
    'NAKED_DURATION_EXPIRED',
  );
  assert.equal(
    coordinatorDeadlinePorts.calls.filter(
      (call) => call.method === 'submitPaper',
    ).length,
    0,
  );

  const deadlineHedged = await deadlineCoordinator.advanceNormalBasis();
  assert.equal(
    deadlineHedged.ok,
    true,
    deadlineHedged.ok ? '' : deadlineHedged.failure.code,
  );
  const deadlineSubmitCalls = coordinatorDeadlinePorts.calls.filter(
    (call) => call.method === 'submitPaper',
  );
  assert.deepEqual(deadlineSubmitCalls, [{
    method: 'submitPaper',
    clientOrderId: boundHedgeId,
    quantity: boundHedgeQuantity,
  }]);
  assert.equal(
    deadlineCoordinator.normalBasisProgressSnapshot().workingOrAmbiguousClientOrderId,
    boundHedgeId,
  );
  assert.equal(
    deadlineCoordinator.normalBasisProgressSnapshot().action.disposition,
    'CANCEL_ELIGIBLE',
  );
  assert.equal(deadlineCoordinator.snapshot().lifecycle, 'RECOVERY_REQUIRED');
  observedAtMs = coordinatorDeadlineMainTime;

  // A naked-duration breach preserves same-ID terminal truth and the hedge path.
  const mainObservedAtMs = observedAtMs;
  let deadlineState = recordOrder(state, 'SUBMISSION_STARTED');
  const deadlineSpotId = deadlineState.normalBasisProgress.action.clientOrderId;
  assert.notEqual(deadlineState.exposedSinceMs, null);
  observedAtMs =
    deadlineState.exposedSinceMs + deadlineState.plan.maxNakedDurationMs - 1;
  deadlineState = applyEvent(deadlineState, 'NAKED_DURATION_EXPIRED');
  assert.equal(deadlineState.lifecycle, 'RECOVERY_REQUIRED');
  deadlineState = recordOrder(deadlineState, 'FILLED', 1);
  const deadlineSpotTerminal = deadlineState.normalBasisProgress.journal.at(-1);
  assert.equal(deadlineSpotTerminal.step, 'SPOT_OPEN');
  assert.equal(deadlineSpotTerminal.state, 'FILLED');
  assert.equal(deadlineSpotTerminal.clientOrderId, deadlineSpotId);
  assert.equal(deadlineState.normalBasisProgress.next, 'PERP_OPEN');
  assert.equal(deadlineState.normalBasisProgress.action.disposition, 'SUBMIT_ELIGIBLE');

  const forgedSecondSpot = {
    ...orderObservation(
      deadlineState.normalBasisProgress,
      'SUBMISSION_STARTED',
    ),
    step: 'SPOT_OPEN',
    attempt: 0,
    clientOrderId: binding.steps.SPOT_OPEN.clientOrderId,
    submittedQuantity: 1,
    cumulativeFilledQuantity: 0,
  };
  const forgedSecondSpotResult = reduceExecutionEvent(
    deadlineState,
    createExecutionEvent(
      deadlineState.plan.planId,
      deadlineState.lastSequence + 1,
      forgedSecondSpot.occurredAtMs,
      'NORMAL_BASIS_PROGRESS_OBSERVED',
      { normalBasisObservation: forgedSecondSpot },
    ),
  );
  assert.equal(forgedSecondSpotResult.applied, false);
  assert.equal(forgedSecondSpotResult.reason, 'INVALID_PLAN_TRANSITION');

  const deadlinePerpId = deadlineState.normalBasisProgress.action.clientOrderId;
  deadlineState = recordOrder(deadlineState, 'SUBMISSION_STARTED');
  assert.equal(deadlineState.lifecycle, 'RECOVERY_REQUIRED');
  assert.equal(deadlineState.normalBasisProgress.next, 'PERP_OPEN');
  assert.equal(deadlineState.normalBasisProgress.action.disposition, 'AWAIT_TERMINAL');
  assert.notEqual(deadlinePerpId, deadlineSpotId);
  assert.equal(
    deadlineState.normalBasisProgress.journal.filter(
      (entry) =>
        entry.kind === 'ORDER' &&
        entry.step === 'SPOT_OPEN' &&
        entry.state === 'SUBMISSION_STARTED',
    ).length,
    1,
  );
  observedAtMs = mainObservedAtMs;

  // A partial Spot fill is not hedgeable until the remainder is terminal.
  state = recordOrder(state, 'SUBMISSION_STARTED');
  state = recordOrder(state, 'WORKING', 0.4);
  assert.equal(state.normalBasisProgress.next, 'SPOT_OPEN');
  assert.equal(state.normalBasisProgress.action.disposition, 'CANCEL_ELIGIBLE');
  assert.equal(state.normalBasisProgress.terminalNetFilledQuantityByStep.SPOT_OPEN, null);
  state = recordOrder(state, 'CANCEL_REQUESTED', 0.4);
  state = recordOrder(state, 'CANCELLED', 0.4);
  assert.equal(state.normalBasisProgress.next, 'PERP_OPEN');
  assertQuantity(state.normalBasisProgress.expectedQuantity, 0.4);
  assertQuantity(state.normalBasisProgress.terminalNetFilledQuantityByStep.SPOT_OPEN, 0.4);

  // The hedge is sized from the terminal Spot net fill, never the requested size.
  state = recordOrder(state, 'SUBMISSION_STARTED');
  state = recordOrder(state, 'FILLED', 0.4);
  assert.equal(state.normalBasisProgress.next, 'PERP_CLOSE');
  assertQuantity(state.normalBasisProgress.expectedQuantity, 0.4);
  state = applyEvent(state, 'CLOSE_REQUESTED');
  state = applyEvent(state, 'CLOSING_STARTED');

  // Entry expiry is fail-closed for opens but never traps risk-reducing closes.
  observedAtMs = binding.entryExpiresAtMs;

  // Four durable zero-fill closes consume the budget and enter recovery.
  let exhaustedState = state;
  for (let attempt = 0; attempt < binding.maxCloseAttempts; attempt += 1) {
    assert.equal(exhaustedState.normalBasisProgress.nextAttempt, attempt);
    exhaustedState = recordOrder(exhaustedState, 'SUBMISSION_STARTED');
    exhaustedState = recordOrder(exhaustedState, 'WORKING');
    exhaustedState = recordOrder(exhaustedState, 'CANCEL_REQUESTED');
    exhaustedState = recordOrder(exhaustedState, 'CANCELLED');
  }
  assert.equal(exhaustedState.lifecycle, 'RECOVERY_REQUIRED');
  assert.equal(exhaustedState.normalBasisProgress.next, 'PERP_CLOSE');
  assert.equal(exhaustedState.normalBasisProgress.nextAttempt, null);
  assertQuantity(exhaustedState.normalBasisProgress.expectedQuantity, 0.4);
  assert.equal(
    exhaustedState.normalBasisProgress.action.disposition,
    'ATTEMPT_BUDGET_EXHAUSTED',
  );
  assert.equal(exhaustedState.normalBasisProgress.action.clientOrderId, null);
  assert.equal(exhaustedState.normalBasisProgress.workingOrAmbiguousClientOrderId, null);
  assert.equal(exhaustedState.normalBasisProgress.action.sendEligible, false);
  const exhaustedCheckpoint = serializeExecutionCheckpoint(exhaustedState);
  const exhaustedRestore = restoreExecutionCheckpoint(exhaustedCheckpoint);
  assert.equal(exhaustedRestore.ok, true, exhaustedRestore.ok ? '' : exhaustedRestore.code);
  assert.equal(exhaustedRestore.state.lifecycle, 'RECOVERY_REQUIRED');
  assert.equal(
    exhaustedRestore.state.normalBasisProgress.action.disposition,
    'ATTEMPT_BUDGET_EXHAUSTED',
  );
  assert.equal(exhaustedRestore.state.normalBasisProgress.workingOrAmbiguousClientOrderId, null);
  assert.deepEqual(
    recommendExecutionRecovery(
      exhaustedRestore.state,
      nextObservedAtMs(),
    ).map((item) => item.action),
    ['MANUAL_REVIEW'],
  );

  // An ambiguous close is query-first by the same immutable order identity.
  state = recordOrder(state, 'SUBMISSION_STARTED');
  const ambiguousClientOrderId = state.normalBasisProgress.action.clientOrderId;
  state = recordOrder(state, 'AMBIGUOUS');
  assert.equal(state.normalBasisProgress.action.disposition, 'QUERY_REQUIRED');
  assert.equal(state.normalBasisProgress.action.clientOrderId, ambiguousClientOrderId);
  assert.equal(state.normalBasisProgress.action.sendEligible, false);
  assert.throws(
    () => appendPureOrder(binding, state.normalBasisProgress, 'SUBMISSION_STARTED'),
    /attempt transition/,
  );

  // Checkpoint/restart preserves the journal and still requires the same-ID query.
  const ambiguousCheckpoint = serializeExecutionCheckpoint(state);
  const restored = restoreExecutionCheckpoint(ambiguousCheckpoint);
  assert.equal(restored.ok, true, restored.ok ? '' : restored.code);
  assert.equal(restored.state.plan.normalBasisBinding.bindingId, binding.bindingId);
  assert.equal(canonicalJson(restored.state.normalBasisProgress), canonicalJson(state.normalBasisProgress));
  assert.equal(restored.state.normalBasisProgress.action.disposition, 'QUERY_REQUIRED');
  assert.equal(restored.state.normalBasisProgress.action.clientOrderId, ambiguousClientOrderId);
  assert.equal(serializeExecutionCheckpoint(restored.state), ambiguousCheckpoint);
  assert.deepEqual(
    recommendExecutionRecovery(restored.state, nextObservedAtMs()).map((item) => [
      item.action,
      item.clientOrderId,
    ]),
    [['VERIFY_AMBIGUOUS_ORDER', ambiguousClientOrderId]],
  );

  // A real restored coordinator performs same-ID lookup before any submit.
  const coordinatorPorts = new FakePorts(
    [
      {
        kind: 'FOUND',
        status: 'CANCELLED',
        venueOrderId: null,
        cumulativeFilledQuantity: 0.1,
      },
      {
        kind: 'FOUND',
        status: 'CANCELLED',
        venueOrderId: null,
        cumulativeFilledQuantity: 0.1,
      },
    ],
    [{ kind: 'ACKNOWLEDGED', venueOrderId: 'paper-reclose-1' }],
  );
  const coordinatorRestore = restoreExecutionCoordinator(
    ambiguousCheckpoint,
    new FixedClock(nextObservedAtMs()),
    coordinatorPorts,
  );
  assert.equal(coordinatorRestore.ok, true, coordinatorRestore.ok ? '' : coordinatorRestore.code);
  const recoveredCoordinator = coordinatorRestore.coordinator;
  const recoveredAdvance = await recoveredCoordinator.advanceNormalBasis();
  assert.equal(recoveredAdvance.ok, true, recoveredAdvance.ok ? '' : recoveredAdvance.failure.code);
  const effectCallsAfterRecovery = coordinatorPorts.calls.filter(
    (call) => call.method === 'lookupByClientOrderId' || call.method === 'submitPaper',
  );
  assert.deepEqual(effectCallsAfterRecovery, [{
    method: 'lookupByClientOrderId',
    clientOrderId: ambiguousClientOrderId,
    quantity: 0.4,
  }]);
  assert.equal(
    recoveredCoordinator.normalBasisProgressSnapshot().action.clientOrderId ===
      ambiguousClientOrderId,
    false,
  );

  // A later re-close uses a distinct ID; cancel is journal-only, then same-ID lookup.
  const firstRecloseId = recoveredCoordinator.normalBasisProgressSnapshot().action.clientOrderId;
  const submittedReclose = await recoveredCoordinator.advanceNormalBasis();
  assert.equal(submittedReclose.ok, true, submittedReclose.ok ? '' : submittedReclose.failure.code);
  assert.equal(
    recoveredCoordinator.normalBasisProgressSnapshot().action.disposition,
    'CANCEL_ELIGIBLE',
  );
  const cancelRecorded = recoveredCoordinator.requestNormalBasisCancel();
  assert.equal(cancelRecorded.ok, true, cancelRecorded.ok ? '' : cancelRecorded.failure.code);
  const cancelResolved = await recoveredCoordinator.advanceNormalBasis();
  assert.equal(cancelResolved.ok, true, cancelResolved.ok ? '' : cancelResolved.failure.code);
  const coordinatorProgress = recoveredCoordinator.normalBasisProgressSnapshot();
  assert.equal(coordinatorProgress.next, 'PERP_CLOSE');
  assert.equal(coordinatorProgress.nextAttempt, 2);
  assertQuantity(coordinatorProgress.expectedQuantity, 0.2);
  assert.notEqual(coordinatorProgress.action.clientOrderId, firstRecloseId);
  assert.deepEqual(
    coordinatorPorts.calls
      .filter((call) => call.method === 'submitPaper')
      .map((call) => call.clientOrderId),
    [firstRecloseId],
  );
  assert.deepEqual(
    coordinatorPorts.calls
      .filter((call) => call.method === 'lookupByClientOrderId')
      .map((call) => call.clientOrderId),
    [ambiguousClientOrderId, firstRecloseId],
  );
  state = restored.state;

  state = recordOrder(state, 'QUERY_STARTED');
  state = recordOrder(state, 'CANCELLED', 0.1);
  const firstCloseId = ambiguousClientOrderId;
  assert.equal(state.normalBasisProgress.next, 'PERP_CLOSE');
  assert.equal(state.normalBasisProgress.nextAttempt, 1);
  assertQuantity(state.normalBasisProgress.expectedQuantity, 0.3);
  assert.notEqual(state.normalBasisProgress.action.clientOrderId, firstCloseId);

  // Re-close uses a distinct bounded identity and aggregates terminal net fill.
  const secondCloseId = state.normalBasisProgress.action.clientOrderId;
  state = recordOrder(state, 'SUBMISSION_STARTED');
  state = recordOrder(state, 'FILLED', 0.3);
  assert.notEqual(secondCloseId, firstCloseId);
  assertQuantity(state.normalBasisProgress.terminalNetFilledQuantityByStep.PERP_CLOSE, 0.4);
  assert.equal(state.normalBasisProgress.next, 'SPOT_CLOSE');
  assertQuantity(state.normalBasisProgress.expectedQuantity, 0.4);
  assert.equal(binding.steps.PERP_CLOSE.reduceOnly, true);

  // Spot is released only after the USD-M close is terminal.
  state = recordOrder(state, 'SUBMISSION_STARTED');
  state = recordOrder(state, 'FILLED', 0.4);
  assertQuantity(state.normalBasisProgress.terminalNetFilledQuantityByStep.SPOT_CLOSE, 0.4);
  assert.equal(state.normalBasisProgress.next, 'BASELINE_RECONCILIATION');
  assert.equal(state.normalBasisProgress.complete, false);
  assert.equal(state.normalBasisProgress.action.disposition, 'OBSERVE_BASELINE');

  // Plan-local zero is insufficient: only the bound account baseline completes.
  state = recordBaseline(state, 0, 0);
  assert.equal(state.normalBasisProgress.next, 'BASELINE_RECONCILIATION');
  assert.equal(state.normalBasisProgress.baselineFlat, false);
  assert.equal(state.normalBasisProgress.complete, false);
  state = recordBaseline(
    state,
    binding.risk.baseline.spotSignedBaseQty,
    binding.risk.baseline.perpSignedBaseQty,
  );
  assert.equal(state.normalBasisProgress.next, 'COMPLETE');
  assert.equal(state.normalBasisProgress.baselineFlat, true);
  assert.equal(state.normalBasisProgress.complete, true);
  assert.equal(state.normalBasisProgress.action.disposition, 'COMPLETE');
  assert.equal(state.normalBasisProgress.action.sendEligible, false);
  assert.equal(state.lifecycle, 'CLOSED');
  assert.equal(state.eventLog.at(-1).type, 'NORMAL_BASIS_PROGRESS_OBSERVED');
  assert.equal(state.eventLog.at(-1).normalBasisObservation.kind, 'BASELINE');
  assert.equal(state.normalBasisProgress.journal.at(-1).kind, 'BASELINE');
  const finalRestore = restoreExecutionCheckpoint(serializeExecutionCheckpoint(state));
  assert.equal(finalRestore.ok, true, finalRestore.ok ? '' : finalRestore.code);
  assert.equal(finalRestore.state.normalBasisProgress.complete, true);
  assert.equal(finalRestore.state.lifecycle, 'CLOSED');

  // Forging baseline provenance to the post-event revision is replay-invalid.
  const postEventBaseline = JSON.parse(serializeExecutionCheckpoint(state));
  const lastJournalObservation = postEventBaseline.state.normalBasisProgress.journal.at(-1);
  const lastProgressEvent = [...postEventBaseline.state.eventLog]
    .reverse()
    .find((event) => event.type === 'NORMAL_BASIS_PROGRESS_OBSERVED');
  assert.equal(lastJournalObservation.kind, 'BASELINE');
  assert.equal(lastProgressEvent.normalBasisObservation.kind, 'BASELINE');
  lastJournalObservation.observedStateRevision = postEventBaseline.state.revision;
  lastProgressEvent.normalBasisObservation.observedStateRevision =
    postEventBaseline.state.revision;
  const staleBaselineRestore = restoreExecutionCheckpoint(resignCheckpoint(postEventBaseline));
  assert.equal(staleBaselineRestore.ok, false);
  assert.equal(staleBaselineRestore.code, 'CHECKPOINT_STATE_INVALID');

  assert.equal(networkAttempts, 0);
  console.log('normal-basis-plan-risk: PASS');
} finally {
  globalThis.fetch = originalFetch;
}

/**
 * Test-only fixtures for the section 20 compatibility harness.
 *
 * This module owns no timers, environment reads, network calls, storage, or
 * production wiring. All evidence and time are explicit and synthetic.
 */
import {
  createSourcedTimestamp,
  createStructuredFailure,
  validateStructuredFailure,
} from '../../../dist/foundation/contracts/index.js';
import { createDeterministicSupervisor } from '../../../dist/foundation/control/index.js';
import { deriveRiskIntentDigest } from '../../../dist/foundation/risk/index.js';

export const T0 = 1_800_000_000_000;
export const COMPAT_NOW = T0 + 500;
export const SYMBOL = 'BTCUSDT';
export const ACCOUNT_ID = 'synthetic-binance-primary';

export class ManualClock {
  constructor(nowMs = T0) { this.value = nowMs; this.deadlines = []; }
  nowMs() { return this.value; }
  schedule(delayMs, task) {
    const deadline = { dueAtMs: this.value + delayMs, task, cancelled: false, fired: false };
    this.deadlines.push(deadline);
    return { cancel: () => { deadline.cancelled = true; } };
  }
  drain() {
    for (const deadline of this.deadlines) {
      if (!deadline.cancelled && !deadline.fired && deadline.dueAtMs <= this.value) {
        deadline.fired = true;
        deadline.task();
      }
    }
  }
  set(nowMs) { this.value = nowMs; this.drain(); }
  advance(deltaMs) { this.value += deltaMs; this.drain(); }
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function sourcedTimestamp(
  sourceId,
  sourceTimeMs = T0,
  maxAgeMs = 5_000,
  authority = 'SYNTHETIC_TEST',
  receivedAtMs = sourceTimeMs,
) {
  return createSourcedTimestamp({
    sourceTimeMs,
    receivedAtMs,
    maxAgeMs,
    authority,
    completeness: authority === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'COMPLETE',
    sourceId,
  });
}

export function managedComponent(name, options = {}) {
  const state = { validateCalls: 0, startCalls: 0, stopCalls: 0, probeCalls: 0 };
  const component = {
    name,
    required: options.required ?? true,
    dependsOn: options.dependsOn ?? [],
    requiresPrivateKeys: options.requiresPrivateKeys,
    requiresBorrowTruth: options.requiresBorrowTruth,
    riskIncreasing: options.riskIncreasing,
    stepTimeoutMs: options.stepTimeoutMs,
    validate(context) {
      state.validateCalls += 1;
      return options.validate?.(context, state) ?? { kind: 'COMPLETE' };
    },
    start(context) {
      state.startCalls += 1;
      return options.start?.(context, state) ?? { kind: 'COMPLETE' };
    },
    stop(context) {
      state.stopCalls += 1;
      return options.stop?.(context, state) ?? { kind: 'COMPLETE' };
    },
    probe(context) {
      state.probeCalls += 1;
      return options.probe?.(context, state) ?? {
        heartbeatAt: context.nowMs,
        timestamp: sourcedTimestamp(`compat.control.${name}`, context.nowMs),
        fatal: null,
      };
    },
  };
  return { component, state };
}

export function createSupervisor({
  components,
  gates = [],
  environment = {
    privateKeysAvailable: true,
    killSwitchEngaged: false,
    borrowTruthPresent: true,
  },
  runMode = 'INTELLIGENCE',
  gateTimeoutMs = 10,
  componentTimeoutMs = 10,
}) {
  return createDeterministicSupervisor(
    {
      scope: 'foundation.compatibility',
      runMode,
      defaultGateTimeoutMs: gateTimeoutMs,
      defaultComponentTimeoutMs: componentTimeoutMs,
    },
    {
      components,
      gates,
      readEnvironment: typeof environment === 'function' ? environment : () => environment,
    },
  );
}

export function issue(supervisor, command, revision, nowMs = T0) {
  return supervisor.issue({ command, revision, nowMs });
}

export function engineDecision(overrides = {}) {
  return {
    symbol: SYMBOL,
    ts: T0 + 10,
    kind: 'focus',
    rejectCode: null,
    humanReason: 'synthetic compatibility focus',
    correlationId: 'cor_compat_basis_tick',
    direction: 'long_spot_short_perp',
    netEdgePct: 0.45,
    confidence: 0.9,
    borrowStatus: 'not_needed',
    evidence: { baselineReady: true, gapPct: 0.7 },
    ...overrides,
  };
}

export function engineProposal(overrides = {}) {
  return {
    id: 'basis-compat-proposal-1',
    correlationId: 'cor_compat_basis_tick',
    symbol: SYMBOL,
    direction: 'long_spot_short_perp',
    createdTs: T0 + 10,
    updatedTs: T0 + 20,
    status: 'open',
    reason: 'synthetic compatibility proposal',
    netEdgePct: 0.45,
    confidence: 0.9,
    borrowStatus: 'not_needed',
    expiresAtMs: T0 + 60_000,
    sourceLocalRank: 0,
    rejectionReasons: null,
    evidence: { grossEdgePct: 0.7, estimatedCostPct: 0.25 },
    ...overrides,
  };
}

export function engineSnapshot(sourceId, overrides = {}) {
  return {
    sourceId,
    snapshotTimeMs: T0 + 20,
    receivedAtMs: T0 + 30,
    maxAgeMs: 5_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    configVersion: 'cfg_compat_v1',
    decisions: [],
    proposals: [],
    ...overrides,
  };
}

export function canonicalReadModelInput(overrides = {}) {
  return {
    nowMs: T0 + 100,
    correlationId: 'cor_compat_read_model',
    basis: engineSnapshot('engine.basis.compat', {
      decisions: [engineDecision()],
      proposals: [engineProposal()],
    }),
    volume: engineSnapshot('engine.volume.compat', {
      decisions: [engineDecision({
        correlationId: 'cor_compat_volume_tick',
        direction: 'long',
        netEdgePct: null,
      })],
      proposals: [],
    }),
    ...overrides,
  };
}

const portFailure = (code, retryable = false) => ({
  code,
  message: `Synthetic port outcome ${code}.`,
  retryable,
  recommendedOperatorAction: 'Inspect the synthetic compatibility evidence.',
});

export class FakeExecutionPorts {
  constructor(clock) {
    if (typeof clock?.nowMs !== 'function') {
      throw new TypeError('FakeExecutionPorts requires the coordinator injected clock');
    }
    this.clock = clock;
    this.calls = [];
    this.identityClaims = new Map();
    this.riskAuthorization = null;
    this.preflightResult = Object.freeze({ ok: true });
    this.validationResults = new Map();
    this.submissions = new Map();
    this.lookups = new Map();
    this.reconciliations = [];
    this.reconciliationHandler = null;
  }
  claimPlanIdentity(planId, fingerprint) {
    const previous = this.identityClaims.get(planId);
    if (previous === undefined) {
      this.identityClaims.set(planId, fingerprint);
      return 'CLAIMED';
    }
    return previous === fingerprint ? 'EXISTING_SAME' : 'CONFLICT';
  }
  key(request) { return `${request.phase}:${request.leg.key}`; }
  queueSubmission(key, ...outcomes) {
    this.submissions.set(key, [...outcomes]);
    return this;
  }
  queueLookup(key, ...outcomes) {
    this.lookups.set(key, [...outcomes]);
    return this;
  }
  authorizeRisk(planId, verdict) {
    if (typeof planId !== 'string' || planId.length === 0) throw new TypeError('risk authorization planId is required');
    if (
      typeof verdict !== 'object' ||
      verdict === null ||
      typeof verdict.allowed !== 'boolean' ||
      !Number.isSafeInteger(verdict.evaluatedAt) ||
      !Number.isSafeInteger(verdict.expiresAt)
    ) {
      throw new TypeError('risk authorization verdict is required');
    }
    this.riskAuthorization = Object.freeze({ planId, verdict });
    return this;
  }
  async preflight(plan) {
    this.calls.push({ method: 'preflight', planId: plan.planId });
    const authorization = this.riskAuthorization;
    if (authorization === null) return { ok: false, failure: portFailure('RISK_VERDICT_MISSING') };
    if (authorization.planId !== plan.planId) return { ok: false, failure: portFailure('RISK_VERDICT_PLAN_MISMATCH') };
    if (this.clock.nowMs() >= authorization.verdict.expiresAt) return { ok: false, failure: portFailure('RISK_VERDICT_EXPIRED') };
    if (!authorization.verdict.allowed) return { ok: false, failure: portFailure('RISK_REJECTED') };
    return this.preflightResult;
  }
  async validateLeg(request) {
    this.calls.push({ method: 'validateLeg', request });
    return this.validationResults.get(this.key(request)) ?? { ok: true };
  }
  async submitPaper(request) {
    this.calls.push({ method: 'submitPaper', request });
    const queue = this.submissions.get(this.key(request));
    if (queue?.length) {
      const next = queue.shift();
      if (next === 'THROW') throw new Error('synthetic response loss');
      if (typeof next === 'function') return next(request);
      return next;
    }
    return {
      kind: 'FILLED',
      venueOrderId: `paper-${request.phase}-${request.leg.key}`,
      cumulativeFilledQuantity: request.leg.quantity,
    };
  }
  async lookupByClientOrderId(request) {
    this.calls.push({ method: 'lookupByClientOrderId', request });
    const queue = this.lookups.get(this.key(request));
    if (queue?.length) return queue.shift();
    return { kind: 'UNRESOLVED', failure: portFailure('LOOKUP_UNRESOLVED', true) };
  }
  async reconcile(state) {
    this.calls.push({ method: 'reconcile', planId: state.plan.planId });
    if (this.reconciliationHandler !== null) return this.reconciliationHandler(state);
    if (this.reconciliations.length > 0) return this.reconciliations.shift();
    const spotResidual = Math.max(
      0,
      state.openingLegs.SPOT.cumulativeFilledQuantity - state.closingLegs.SPOT.cumulativeFilledQuantity,
    );
    const perpResidual = Math.max(
      0,
      state.openingLegs.PERP.cumulativeFilledQuantity - state.closingLegs.PERP.cumulativeFilledQuantity,
    );
    if (spotResidual === 0 && perpResidual === 0) return { kind: 'CLOSED' };
    const spotRatio = spotResidual / state.openingLegs.SPOT.definition.quantity;
    const perpRatio = perpResidual / state.openingLegs.PERP.definition.quantity;
    return Math.abs(spotRatio - perpRatio) < 1e-12
      ? { kind: 'HEDGED_OPEN' }
      : { kind: 'ONE_LEG_EXPOSED' };
  }
}

export function executionPlanInput(canonicalProposal, overrides = {}) {
  const observedAtMs = canonicalProposal.observedAt.sourceTimeMs
    ?? canonicalProposal.observedAt.receivedAtMs;
  if (observedAtMs === null) throw new TypeError('canonical proposal has no usable observed timestamp');
  if (!Number.isSafeInteger(canonicalProposal.expiresAtMs)) {
    throw new TypeError('canonical proposal has no valid expiry');
  }
  const direction = canonicalProposal.direction === 'long_spot_short_perp'
    ? 'LONG_SPOT_SHORT_PERP'
    : canonicalProposal.direction === 'short_spot_long_perp'
      ? 'SHORT_SPOT_LONG_PERP'
      : null;
  if (direction === null) throw new TypeError('canonical proposal has no executable Basis direction');
  return {
    strategy: 'BASIS',
    direction,
    symbol: canonicalProposal.symbol,
    proposal: {
      canonicalProposalId: canonicalProposal.canonicalId,
      observedAtMs,
      maxAgeMs: canonicalProposal.observedAt.maxAgeMs,
      expiresAtMs: canonicalProposal.expiresAtMs,
    },
    attempt: 0,
    mode: 'PAPER',
    requiresApproval: false,
    maxNakedDurationMs: 1_000,
    spotQuantity: 1,
    perpQuantity: 1,
    ...overrides,
  };
}

function riskStamp(sourceId, overrides = {}) {
  return {
    sourceTimeMs: T0 + 90,
    receivedAtMs: T0 + 95,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId,
    ...overrides,
  };
}

function filters(sourceId, venue, symbol) {
  return {
    venue,
    symbol,
    minPrice: 1,
    maxPrice: 1_000_000,
    tickSize: 0.1,
    minQty: 0.001,
    maxQty: 100,
    stepSize: 0.001,
    minNotionalUsd: 5,
    maxNotionalUsd: 100_000,
    observedAt: riskStamp(sourceId),
  };
}

export function allowedRiskInput(plan, canonicalProposal, overrides = {}) {
  const nowMs = T0 + 100;
  const dayMs = 86_400_000;
  const dayStart = Math.floor(nowMs / dayMs) * dayMs;
  const spotPlanLeg = plan.openingLegs.SPOT;
  const perpPlanLeg = plan.openingLegs.PERP;
  if (canonicalProposal.netEdgePct === null) {
    throw new TypeError('allowed risk fixture requires supplied canonical net edge');
  }
  const spotRiskLegKey = `SPOT_${spotPlanLeg.side}`;
  const perpRiskLegKey = `PERP_${perpPlanLeg.side}`;
  const intent = {
    planId: plan.planId,
    accountId: ACCOUNT_ID,
    proposalRef: plan.proposal.canonicalProposalId,
    riskClass: 'RISK_INCREASING',
    legs: [
      {
        legKey: spotRiskLegKey,
        venue: spotPlanLeg.venue,
        symbol: plan.symbol,
        side: spotPlanLeg.side,
        intendedPrice: 100,
        intendedQty: spotPlanLeg.quantity,
        requiredPermission: 'SPOT',
        positionBucket: 'SPOT_CASH',
        estimatedRequiredMarginUsd: 0,
      },
      {
        legKey: perpRiskLegKey,
        venue: perpPlanLeg.venue,
        symbol: plan.symbol,
        side: perpPlanLeg.side,
        intendedPrice: 100,
        intendedQty: perpPlanLeg.quantity,
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
  const input = {
    nowMs,
    intent,
    proposal: {
      proposalId: intent.proposalRef,
      entryIntentDigest: intentDigest,
      lifecycle: 'OPEN',
      expiresAtMs: plan.proposal.expiresAtMs,
      observedAt: riskStamp('strategy.canonical-proposal'),
    },
    approval: {
      approvalId: 'approval-compat-1',
      subjectPlanId: intent.planId,
      authorizedRiskClass: intent.riskClass,
      intentDigest,
      grantedAtMs: T0 + 50,
      expiresAtMs: T0 + 10_000,
      observedAt: riskStamp('control.compat-approval'),
    },
    killSwitch: {
      accountId: ACCOUNT_ID,
      engaged: false,
      observedAt: riskStamp('control.compat-kill-switch'),
      reason: null,
    },
    market: {
      legs: [
        {
          legKey: spotRiskLegKey,
          venue: spotPlanLeg.venue,
          symbol: plan.symbol,
          referencePrice: 100,
          observedAt: riskStamp('binance.spot.compat-book'),
          spreadPct: 0.05,
          topDepthUsd: 10_000,
          filters: filters('binance.spot.compat-filters', spotPlanLeg.venue, plan.symbol),
        },
        {
          legKey: perpRiskLegKey,
          venue: perpPlanLeg.venue,
          symbol: plan.symbol,
          referencePrice: 100,
          observedAt: riskStamp('binance.usdm.compat-book'),
          spreadPct: 0.05,
          topDepthUsd: 10_000,
          filters: filters('binance.usdm.compat-filters', perpPlanLeg.venue, plan.symbol),
        },
      ],
      edgeIntentDigest: intentDigest,
      netEdgePct: canonicalProposal.netEdgePct,
      estimatedCostPct: 0.1,
      estimatedSlippagePct: 0.05,
      edgeObservedAt: riskStamp('strategy.compat-edge'),
    },
    account: {
      accountId: ACCOUNT_ID,
      permissions: {
        accountId: ACCOUNT_ID,
        spot: true,
        margin: true,
        futures: true,
        observedAt: riskStamp('binance.compat-permissions'),
      },
      spotInventory: [{
        accountId: ACCOUNT_ID,
        symbol: plan.symbol,
        availableBaseQty: 10,
        availableQuoteUsd: 10_000,
        observedAt: riskStamp('binance.compat-inventory'),
      }],
      exposures: {
        accountId: ACCOUNT_ID,
        positionMode: 'ONE_WAY',
        positions: [],
        observedAt: riskStamp('binance.compat-positions'),
      },
      marginHeadrooms: [{
        accountId: ACCOUNT_ID,
        positionBucket: 'USDM_ONE_WAY',
        scopeSymbol: null,
        availableMarginUsd: 1_000,
        observedAt: riskStamp('binance.compat-margin'),
      }],
      liquidations: [{
        legKey: perpRiskLegKey,
        accountId: ACCOUNT_ID,
        venue: perpPlanLeg.venue,
        symbol: plan.symbol,
        intentDigest,
        projectedSignedBaseQty: (perpPlanLeg.side === 'BUY' ? 1 : -1) * perpPlanLeg.quantity,
        markPrice: 100,
        liquidationPrice: 150,
        observedAt: riskStamp('risk.compat-liquidation'),
      }],
      dailyRealizedLossUsd: 0,
      dailyTradedNotionalUsd: 0,
      dailyPeriodStartMs: dayStart,
      dailyPeriodEndMs: dayStart + dayMs,
      dailyStatsObservedAt: riskStamp('ledger.compat-daily'),
      openOrders: {
        total: 0,
        perSymbol: {},
        observedAt: riskStamp('binance.compat-open-orders'),
      },
    },
    borrow: null,
    existingPlans: {
      accountId: ACCOUNT_ID,
      plans: [],
      observedAt: riskStamp('coordinator.compat-registry'),
    },
    cooldown: {
      accountId: ACCOUNT_ID,
      symbols: [plan.symbol],
      lastEntryAtMs: null,
      observedAt: riskStamp('coordinator.compat-cooldown'),
    },
    policy: {
      verdictTtlMs: 5_000,
      minEvidenceAuthority: 'SYNTHETIC_TEST',
      maxSpotPerpSkewMs: 50,
      minLegNotionalUsd: 10,
      maxLegNotionalUsd: 250,
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
  return { ...input, ...overrides };
}

function evidenceMetadata(nowMs, state, overrides = {}) {
  return {
    sourceId: 'synthetic.compat.private-evidence',
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimeMs: nowMs,
    receivedAtMs: nowMs,
    maxAgeMs: 5_000,
    coverageStartMs: state.createdAtMs,
    coverageEndMs: Math.max(state.updatedAtMs, nowMs),
    ...overrides,
  };
}

function observedOrderStatus(lifecycle) {
  if (lifecycle === 'FILLED') return 'FILLED';
  if (lifecycle === 'PARTIALLY_FILLED') return 'PARTIALLY_FILLED';
  if (lifecycle === 'CANCELLED') return 'CANCELED';
  if (lifecycle === 'REJECTED') return 'REJECTED';
  return 'NEW';
}

function signedQuantity(side, quantity) {
  return side === 'BUY' ? quantity : -quantity;
}

function expectedPositionDelta(state, key) {
  const opened = state.openingLegs[key];
  const closed = state.closingLegs[key];
  return signedQuantity(opened.definition.side, opened.cumulativeFilledQuantity)
    + signedQuantity(closed.definition.side, closed.cumulativeFilledQuantity);
}

export function exactReconciliationEvidence(state, nowMs = COMPAT_NOW) {
  const orders = [];
  const fills = [];
  let sequence = 0;
  for (const [phase, legs] of [['OPEN', state.openingLegs], ['CLOSE', state.closingLegs]]) {
    for (const key of ['SPOT', 'PERP']) {
      const leg = legs[key];
      if (leg.submittedQuantity <= 0 || leg.venueOrderId === null) continue;
      sequence += 1;
      orders.push({
        venue: leg.definition.venue,
        symbol: state.plan.symbol,
        clientOrderId: leg.definition.clientOrderId,
        venueOrderId: leg.venueOrderId,
        side: leg.definition.side,
        originalQuantity: leg.submittedQuantity,
        cumulativeFilledQuantity: leg.cumulativeFilledQuantity,
        status: observedOrderStatus(leg.lifecycle),
        reduceOnly: leg.definition.reduceOnly,
        updatedAtMs: nowMs - 100 + sequence,
      });
      if (leg.cumulativeFilledQuantity > 0) {
        fills.push({
          venue: leg.definition.venue,
          symbol: state.plan.symbol,
          tradeId: `compat-${phase}-${key}-${sequence}`,
          clientOrderId: leg.definition.clientOrderId,
          venueOrderId: leg.venueOrderId,
          side: leg.definition.side,
          quantity: leg.cumulativeFilledQuantity,
          price: 100,
          occurredAtMs: nowMs - 200 + sequence,
        });
      }
    }
  }
  return {
    orders: { metadata: evidenceMetadata(nowMs, state), records: orders },
    fills: { metadata: evidenceMetadata(nowMs, state), records: fills },
    positions: {
      metadata: evidenceMetadata(nowMs, state, {
        coverageStartMs: null,
        coverageEndMs: null,
      }),
      records: [
        {
          venue: 'BINANCE_SPOT',
          symbol: state.plan.symbol,
          positionSide: 'NET',
          quantity: expectedPositionDelta(state, 'SPOT'),
          baselineQuantity: 0,
          observedAtMs: nowMs,
        },
        {
          venue: 'BINANCE_USDM',
          symbol: state.plan.symbol,
          positionSide: 'BOTH',
          quantity: expectedPositionDelta(state, 'PERP'),
          baselineQuantity: 0,
          observedAtMs: nowMs,
        },
      ],
    },
  };
}

export function ledgerEventsFromExecution(state) {
  return Object.freeze(state.eventLog.map((event, index) => {
    const { occurredAtMs, type, ...eventData } = event;
    return Object.freeze({
      id: index + 1,
      ts: occurredAtMs,
      kind: type,
      symbol: state.plan.symbol,
      data: Object.freeze({
        ...eventData,
        correlationId: state.plan.correlationId,
      }),
    });
  }));
}

export function diagnosticsInput(supervisorSnapshot, readModel, ledgerEvents) {
  const diagnosticStamp = sourcedTimestamp('compat.integration.snapshot', T0 + 400);
  return {
    nowMs: COMPAT_NOW,
    correlationId: 'cor_compat_diagnostics',
    policy: {
      heartbeatMaxAgeMs: 1_000,
      cycleMaxAgeMs: 2_000,
      rateMaxAgeMs: 1_000,
      clockSkewToleranceMs: 100,
      consecutiveFailuresDegradedAt: 2,
      consecutiveFailuresFailedAt: 4,
      maxSequenceGaps: 0,
    },
    supervisor: {
      authority: 'SYNTHETIC_TEST',
      snapshot: supervisorSnapshot,
    },
    sources: [{
      sourceId: 'foundation.compatibility.chain',
      required: true,
      authority: 'SYNTHETIC_TEST',
      timestamp: diagnosticStamp,
      heartbeatAtMs: T0 + 400,
      lastSuccessfulCycleAtMs: T0 + 400,
      lastError: null,
      consecutiveFailures: 0,
      eventCounter: {
        startAtMs: T0,
        endAtMs: COMPAT_NOW,
        startCount: 0,
        endCount: ledgerEvents.length,
      },
      messageCounter: {
        startAtMs: T0,
        endAtMs: COMPAT_NOW,
        startCount: 0,
        endCount: ledgerEvents.length,
      },
      reconnectCount: 0,
      sequenceGapCount: 0,
    }],
    counts: {
      required: true,
      authority: 'SYNTHETIC_TEST',
      timestamp: diagnosticStamp,
      universe: 2,
      candidates: readModel.ordered.length,
      focus: readModel.basis.decisions.length + readModel.volume.decisions.length,
      proposals: readModel.basis.proposals.length + readModel.volume.proposals.length,
      rejectionCounts: [],
    },
    baseline: {
      required: true,
      authority: 'SYNTHETIC_TEST',
      timestamp: diagnosticStamp,
      state: 'READY',
    },
    borrow: {
      required: false,
      authority: 'SYNTHETIC_TEST',
      timestamp: diagnosticStamp,
      requiredAssetCount: 0,
      coveredAssetCount: 0,
    },
  };
}

export function boundaryFailure({
  component,
  stage,
  code,
  message,
  occurredAt = COMPAT_NOW,
  retryable = false,
  safeCurrentState,
  recommendedOperatorAction,
  correlationId = 'cor_compat_failure',
}) {
  return createStructuredFailure({
    component,
    stage,
    code,
    message,
    occurredAt,
    retryable,
    safeCurrentState,
    recommendedOperatorAction,
    correlationId,
  });
}

/**
 * Section 20 says `timestamp`; the already-frozen contract says `occurredAt`.
 * This test-only projection proves exact semantic compatibility without
 * changing, widening, or duplicating the production failure contract.
 */
export function section20FailureView(failure) {
  const issues = validateStructuredFailure(failure);
  if (issues.length > 0) throw new TypeError('section20FailureView requires a StructuredFailure');
  return Object.freeze({
    component: failure.component,
    stage: failure.stage,
    code: failure.code,
    timestamp: failure.occurredAt,
    retryable: failure.retryable,
    safeCurrentState: failure.safeCurrentState,
    recommendedOperatorAction: failure.recommendedOperatorAction,
    correlationId: failure.correlationId,
  });
}

export const SECTION_20_FAILURE_KEYS = Object.freeze([
  'component',
  'stage',
  'code',
  'timestamp',
  'retryable',
  'safeCurrentState',
  'recommendedOperatorAction',
  'correlationId',
]);

import { createHash } from 'node:crypto';

import {
  deriveVolumeProtectionPolicyRevision,
  deriveVolumeL07Binding,
  deriveVolumeRiskContextRevision,
  deriveVolumeTwinFixtureId,
  evaluateVolumeLifecycle,
  multiplyVolumeDecimals,
} from '../../../dist/liveEdge/adapters/volumeLifecycle/index.js';
import {
  evaluateSyntheticSubmissionBoundary,
  prepareInitialMutationAppend,
  preparePreflightMutationAppend,
  prepareSubmissionIntentAppend,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/index.js';
import {
  runExchangeTwinScenario,
} from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  T0 as TWIN_T0,
  allowedRateDecision,
  baselineEvents,
  event,
  orderFixture,
  passingPreflight,
  scenarioInput,
} from '../exchangeTwin/fixtures.mjs';
import {
  inputFixture as mutationInputFixture,
  persist,
} from '../mutationJournal/fixtures.mjs';

export const NOW = TWIN_T0 + 100;
export const PLAN_NOW = TWIN_T0 - 100;

const SPOT_SHELL = orderFixture({ product: 'SPOT', orderType: 'MARKET', timeInForce: null, price: null });

export function protectionPolicy(overrides = {}) {
  const policy = {
    schema: 'LIVE_EDGE_VOLUME_PROTECTION_POLICY_V1',
    policyId: 'volume-protection-policy-v1',
    revisionSequence: 1,
    priorPolicyRevision: null,
    effectiveFromMs: NOW - 1_000,
    maximumHoldingMs: 60_000,
    maximumLossBps: 500,
    trailingActivationBps: 300,
    trailingDistanceBps: 200,
    maximumEvidenceAgeMs: 5_000,
    noRepeatWindowMs: 3_600_000,
    probeCumulativePpm: 200_000,
    confirmCumulativePpm: 500_000,
    fullCumulativePpm: 1_000_000,
    exhaustionReductionTargetPpm: 500_000,
    sourceDegradationAction: 'REDUCE',
    ...overrides,
  };
  return {
    ...policy,
    policyRevision: deriveVolumeProtectionPolicyRevision(policy),
  };
}

function proposal(overrides = {}, now = NOW) {
  return {
    owner: 'VOLUME_ENGINE',
    strategy: 'VOLUME',
    proposalId: 'volume-proposal-0001',
    correlationId: 'volume-correlation-0001',
    proposalRevision: 'volume-proposal-revision-0001',
    proposalDigest: 'volume-proposal-digest-0001',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    status: 'OPEN',
    entryKind: 'CONTINUATION',
    marketStage: 'CONFIRMED',
    createdAtMs: now - 2_000,
    observedAtMs: now - 10,
    expiresAtMs: now + 10_000,
    featureRevision: 'volume-feature-revision-0001',
    evidenceRevision: 'volume-evidence-revision-0001',
    exitPlanRevision: 'volume-exit-plan-revision-0001',
    invalidationConditions: ['max_loss', 'time_stop'],
    evidenceIds: ['volume-evidence-0001'],
    ...overrides,
  };
}

function advisory(overrides = {}, now = NOW) {
  return {
    owner: 'EDGE_ASSESSMENT_BRIDGE',
    state: 'OBSERVED',
    advisoryAction: 'PROPOSE_CONSIDERATION',
    strategyFamily: 'VOLUME_WAKEUP',
    ownerReference: 'volume-owner-reference-0001',
    assessmentId: 'volume-assessment-0001',
    assessmentRevision: 1,
    assessmentFingerprintSha256: 'a'.repeat(64),
    modelRevision: 'volume-model-revision-0001',
    featureRevision: 'volume-feature-revision-0001',
    evidenceRevision: 'volume-evidence-revision-0001',
    observedAtMs: now - 10,
    expiresAtMs: now + 10_000,
    economicExpiresAtMs: now + 9_000,
    sourceQuality: 'COMPLETE',
    stage: 'CONFIRMED',
    exhaustion: 'ABSENT',
    reversal: 'ABSENT',
    fadeEligible: false,
    evidenceIds: ['advisory-evidence-0001'],
    ...overrides,
  };
}

function authority(overrides = {}, now = NOW, current = null) {
  const riskClass = overrides.riskActionClass ?? 'OPEN';
  const riskSeed = createHash('sha256').update(JSON.stringify({
    riskClass,
    now,
    lifecycleId: current?.lifecycleId ?? null,
    projectionRevision: current?.projectionRevision ?? null,
    positionQuantity: current?.positionQuantity ?? '0',
  })).digest('hex').slice(0, 24);
  return {
    evidenceKind: 'SYNTHETIC_OWNER_FIXTURE',
    systemMode: 'VALIDATE_ONLY',
    capitalState: 'ACTIVE',
    capitalMandateId: 'capital-mandate-0001',
    capitalMandateRevision: 1,
    capitalMandateDigest: 'capital-mandate-digest-0001',
    capitalReservationId: 'capital-reservation-0001',
    capitalReservationRevision: 1,
    capitalMaximumQuote: '11',
    capitalConsumedQuote: '0',
    capitalExpiresAtMs: now + 20_000,
    riskState: 'ALLOWED',
    riskActionClass: riskClass,
    riskVerdictId: 'risk-verdict-0001',
    riskVerdictRevision: `risk-verdict-revision-${riskSeed}`,
    riskVerdictDigest: `risk-verdict-digest-${riskSeed}`,
    riskEvaluatedAtMs: riskClass === 'RECOVERY' || current !== null ? now : now - 1,
    riskExpiresAtMs: now + 5_000,
    riskBoundLifecycleId: current?.lifecycleId ?? null,
    riskBoundProjectionRevision: current?.projectionRevision ?? null,
    riskBoundPositionQuantity: current?.positionQuantity ?? '0',
    riskContextRevision: `l11riskcontext_${'0'.repeat(64)}`,
    approvalState: 'VALIDATE_ONLY',
    approvalId: 'approval-0001',
    approvalRevision: 1,
    approvalExpiresAtMs: now + 5_000,
    accountTruth: 'COMPLETE',
    positionTruth: 'COMPLETE',
    executionReady: false,
    capitalAuthority: 'SYNTHETIC_CAPITAL_FIXTURE',
    riskAuthority: 'SYNTHETIC_FOUNDATION_FIXTURE',
    actionAuthority: 'NONE_RECORD_ONLY',
    externalActionAuthorization: 'NONE',
    ...overrides,
  };
}

function sizing(direction = 'LONG', overrides = {}, now = NOW) {
  const short = direction === 'SHORT';
  return {
    owner: 'L04_BINANCE_INSTRUMENT_SPECS',
    state: 'READY',
    product: 'SPOT',
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    accountRealmId: 'account-realm:primary',
    instrumentRevision: SPOT_SHELL.instrumentRevision,
    filterRevision: SPOT_SHELL.l06Snapshot.bindings.registryRevision,
    sourceEvidenceRevision: SPOT_SHELL.sourceEvidenceRevision,
    observedAtMs: now - 10,
    validUntilMs: now + 5_000,
    inventoryMode: short ? 'PREOWNED_BASE_SHORT' : 'QUOTE_FUNDED_LONG',
    availableBaseQuantity: short ? '0.1' : null,
    inventoryRevision: short ? 'spot-inventory-revision-0001' : null,
    inventoryAsset: short ? 'BTC' : null,
    inventoryAccountRealmId: short ? 'account-realm:primary' : null,
    inventoryObservedAtMs: short ? now - 10 : null,
    inventoryValidUntilMs: short ? now + 5_000 : null,
    cuts: [
      { targetState: 'PROBE', cumulativeQuantity: '0.02', cumulativeNotionalQuote: '2.1', priceBound: short ? '99' : '101' },
      { targetState: 'CONFIRM', cumulativeQuantity: '0.05', cumulativeNotionalQuote: '5.2', priceBound: short ? '99' : '101' },
      { targetState: 'HOLD', cumulativeQuantity: '0.1', cumulativeNotionalQuote: '10.5', priceBound: short ? '99' : '101' },
    ],
    ...overrides,
  };
}

function market(direction = 'LONG', overrides = {}, now = NOW) {
  const short = direction === 'SHORT';
  return {
    truth: 'COMPLETE',
    observedAtMs: now - 10,
    validUntilMs: now + 5_000,
    currentPrice: '100',
    intendedPriceBound: short ? '99' : '101',
    riskReductionPriceBound: short ? '101' : '99',
    intendedDepthQuote: '1000',
    minimumDepthQuote: '10',
    expectedCostQuote: '0.01',
    expectedDownsideQuote: '0.5',
    spreadBps: 10,
    maximumSpreadBps: 50,
    bookRevision: `book-revision:${'c'.repeat(24)}`,
    costRevision: 'volume-cost-revision-0001',
    downsideRevision: 'volume-downside-revision-0001',
    evidenceIds: ['market-evidence-0001'],
    ...overrides,
  };
}

function signals(overrides = {}, now = NOW) {
  return {
    thesisInvalidated: false,
    exhaustion: 'ABSENT',
    reversal: 'ABSENT',
    confirmation: 'CONFIRMED',
    addPermission: 'ALLOWED',
    manualClose: false,
    globalHalt: false,
    sourceState: 'HEALTHY',
    spreadDepthState: 'HEALTHY',
    reconciliationState: 'EXACT',
    recoveryDisposition: 'PENDING',
    recoveryOutcome: 'NONE',
    recoveryRevision: null,
    currentPrice: '100',
    observedAtMs: now - 10,
    validUntilMs: now + 5_000,
    evidenceIds: ['signal-evidence-0001'],
    ...overrides,
  };
}

function occupancy(overrides = {}, now = NOW, current = null) {
  const seed = current === null ? null : createHash('sha256').update(current.projectionRevision).digest('hex').slice(0, 24);
  const generated = current === null ? [] : [
    ...[{
      recordId: `volume-position-${seed}`,
      recordRevision: `volume-position-revision-${seed}`,
      projectionRevision: current.projectionRevision,
      kind: 'POSITION',
      lifecycleId: current.lifecycleId,
      proposalId: current.proposalId,
      assessmentId: current.assessmentId,
      symbol: current.symbol,
      direction: current.direction,
      ownerFamily: 'VOLUME_LIFECYCLE_ADAPTER',
      state: current.state === 'RECOVERY_REQUIRED' ? 'RECOVERY_REQUIRED'
        : current.state === 'EXIT' ? 'CLOSED' : 'ACTIVE',
      positionQuantity: current.positionQuantity,
      intentKey: null,
      actionKey: null,
    }],
    ...(current.pendingAction === null ? [] : [{
      recordId: `volume-ticket-${seed}`,
      recordRevision: `volume-ticket-revision-${seed}`,
      projectionRevision: current.projectionRevision,
      kind: 'TICKET',
      lifecycleId: current.lifecycleId,
      proposalId: current.proposalId,
      assessmentId: current.assessmentId,
      symbol: current.symbol,
      direction: current.direction,
      ownerFamily: 'VOLUME_LIFECYCLE_ADAPTER',
      state: current.state === 'RECOVERY_REQUIRED' ? 'RECOVERY_REQUIRED' : 'ACTIVE',
      positionQuantity: null,
      intentKey: current.pendingAction.intentKey,
      actionKey: current.pendingAction.actionKey,
    }]),
  ];
  return {
    owner: 'CANONICAL_POSITION_TICKET_JOURNAL_PROJECTION',
    truth: 'COMPLETE',
    observedAtMs: current === null ? now - 10 : Math.max(now - 10, current.lastTransition.occurredAtMs),
    validUntilMs: now + 5_000,
    activeRecords: Object.hasOwn(overrides, 'activeRecords') ? overrides.activeRecords : generated,
    priorActions: [],
    ...overrides,
  };
}

export function lifecycleInput(overrides = {}) {
  const current = Object.hasOwn(overrides, 'current') ? overrides.current : null;
  const twinLastEventAtMs = overrides.twinEvidence?.twinState?.processedEvents
    ?.reduce((latest, item) => Math.max(latest, item.occurredAtMs), 0) ?? 0;
  const now = overrides.evaluatedAtMs
    ?? Math.max(NOW, current === null ? 0 : current.lastTransition.occurredAtMs + 1, twinLastEventAtMs);
  const direction = overrides.proposal?.direction ?? 'LONG';
  const marketOverrides = current !== null && !Object.hasOwn(overrides.market ?? {}, 'observedAtMs')
    ? { ...(overrides.market ?? {}), observedAtMs: now } : overrides.market;
  const signalOverrides = current !== null && !Object.hasOwn(overrides.signals ?? {}, 'observedAtMs')
    ? { ...(overrides.signals ?? {}), observedAtMs: now } : overrides.signals;
  const built = {
    schema: 'LIVE_EDGE_VOLUME_LIFECYCLE_INPUT_V1',
    evaluatedAtMs: now,
    proposal: proposal({ direction, ...(overrides.proposal ?? {}) }, now),
    advisory: advisory(overrides.advisory, now),
    authority: authority(overrides.authority, now, current),
    policy: protectionPolicy(),
    sizing: sizing(direction, overrides.sizing, now),
    market: market(direction, marketOverrides, now),
    signals: signals(signalOverrides, now),
    occupancy: occupancy(overrides.occupancy, now, current),
    current,
    twinEvidence: Object.hasOwn(overrides, 'twinEvidence') ? overrides.twinEvidence : null,
  };
  const canonicalRecoveryResolution = built.signals.recoveryDisposition === 'RESOLVED'
    && built.signals.recoveryOutcome === 'NO_EFFECT'
    && built.signals.recoveryRevision !== null;
  if (canonicalRecoveryResolution && !Object.hasOwn(overrides.signals ?? {}, 'observedAtMs')) {
    built.signals = { ...built.signals, observedAtMs: now };
  }
  if (canonicalRecoveryResolution && !Object.hasOwn(overrides.occupancy ?? {}, 'observedAtMs')) {
    built.occupancy = { ...built.occupancy, observedAtMs: now };
  }
  built.policy = overrides.policy ?? built.policy;
  built.authority = {
    ...built.authority,
    riskContextRevision: deriveVolumeRiskContextRevision(built),
  };
  return built;
}

export function planProbe(overrides = {}) {
  return evaluateVolumeLifecycle(lifecycleInput({
    ...overrides,
    evaluatedAtMs: overrides.evaluatedAtMs ?? PLAN_NOW,
  }));
}

export function openProbe(overrides = {}, twinOverrides = {}) {
  const planned = planProbe(overrides);
  if (planned.disposition !== 'PLANNED') throw new Error(`probe did not plan: ${planned.reasonCodes.join(',')}`);
  const twinEvidence = twinForAction(planned.actionRequest, twinOverrides);
  const settled = evaluateVolumeLifecycle(lifecycleInput({
    ...overrides,
    evaluatedAtMs: overrides.settleEvaluatedAtMs ?? NOW,
    current: planned.projection,
    twinEvidence,
  }));
  if (settled.disposition !== 'SETTLED') throw new Error(`probe did not settle: ${settled.reasonCodes.join(',')}`);
  return { planned, twinEvidence, settled };
}

export function twinForAction(action, {
  fixtureId = deriveVolumeTwinFixtureId(action.actionKey),
  includePrivate = false,
  httpOutcome = 'ACK',
  fee,
  asks,
  bids,
  reconcile = true,
  eventsTransform = (events) => events,
} = {}) {
  const expectedFixtureId = deriveVolumeTwinFixtureId(action.actionKey);
  if (fixtureId !== expectedFixtureId) throw new Error('L11 fixture ID must be intrinsic to the action key');
  const eventShiftMs = Math.max(0, action.plannedAtMs + 1 - TWIN_T0);
  const fixtureRateEvidence = allowedRateDecision({ product: 'SPOT' }, {
    atMs: TWIN_T0 + 3 + eventShiftMs,
  });
  const shell = orderFixture({
    fixtureId: expectedFixtureId,
    product: 'SPOT',
    symbol: action.symbol,
    baseAsset: action.baseAsset,
    quoteAsset: action.quoteAsset,
    side: action.side,
    orderType: 'MARKET',
    timeInForce: null,
    price: null,
    quantity: action.requestedQuantity,
    instrumentRevision: action.instrumentRevision,
    sourceEvidenceRevision: action.sourceEvidenceRevision,
    rateEvidence: fixtureRateEvidence,
  });
  const l07 = deriveVolumeL07Binding(action);
  const resultNotional = multiplyVolumeDecimals('100', action.requestedQuantity);
  const mutationInput = mutationInputFixture({
    identity: {
      globalCorrelationId: l07.globalCorrelationId,
      assessmentId: l07.assessmentId,
      decisionId: l07.decisionId,
      strategyId: 'VOLUME',
      proposalId: l07.proposalId,
      capitalMandateId: l07.capitalMandateId,
      capitalReservationId: l07.capitalReservationId,
      ticketId: l07.ticketId,
      legId: l07.legId,
      intentFingerprint: l07.intentFingerprint,
      product: 'SPOT',
      accountRealmId: action.accountRealmId,
      symbol: action.symbol,
      mutationKind: 'PLACE_ORDER',
      contractId: 'SPOT_ORDER_POST',
      contractState: 'CURRENT',
    },
    requestedQuantity: action.requestedQuantity,
    createdAtMs: action.plannedAtMs,
    preflightResult: {
      instrumentRevision: action.instrumentRevision,
      sourceEvidenceRevision: action.sourceEvidenceRevision,
      registryRevision: action.filterRevision,
      requestedPrice: null,
      validationPrice: '100',
      requestedQuantity: action.requestedQuantity,
      resultQuantity: action.requestedQuantity,
      resultNotional,
      effectiveNotionalCeiling: '10',
      canaryMaximumNotional: '10',
      evaluatedAtMs: action.plannedAtMs - 100,
      instrumentValidUntilMs: action.plannedAtMs + 10_000,
    },
    bindings: {
      instrumentRevision: action.instrumentRevision,
      sourceEvidenceRevision: action.sourceEvidenceRevision,
      registryRevision: action.filterRevision,
      preflightResultQuantity: action.requestedQuantity,
      preflightResultNotional: resultNotional,
      sanitizedRequestContentHash: l07.sanitizedRequestContentHash,
      capitalMandateRevision: l07.capitalMandateRevision,
      riskVerdictRevision: l07.riskVerdictRevision,
      sourceExchangeEventAtMs: action.plannedAtMs - 400,
      sourceLocalReceiveAtMs: action.plannedAtMs - 390,
      featuresReadyAtMs: action.plannedAtMs - 300,
      decisionAtMs: action.plannedAtMs - 250,
      approvalAtMs: action.plannedAtMs - 150,
      preflightEvaluatedAtMs: action.plannedAtMs - 100,
      privateEvaluatedAtMs: action.plannedAtMs - 50,
      validUntilMs: action.plannedAtMs + 10_000,
    },
  });
  const created = persist(prepareInitialMutationAppend(mutationInput));
  const preflighted = persist(preparePreflightMutationAppend(created, action.plannedAtMs + 1));
  const persisted = persist(prepareSubmissionIntentAppend(preflighted, action.plannedAtMs + 2));
  const fixture = {
    ...shell,
    l06Snapshot: persisted.snapshot,
    l06Boundary: evaluateSyntheticSubmissionBoundary(persisted, action.plannedAtMs + 4),
  };
  const baseEvents = baselineEvents(fixture, {
    includePrivate,
    httpOutcome,
    ...(fee === undefined ? {} : { fee }),
    asks: asks ?? [{ price: action.side === 'SELL' ? '101' : '100', quantity: action.requestedQuantity }],
    bids: bids ?? [{ price: action.side === 'SELL' ? '100' : '99', quantity: action.requestedQuantity }],
  });
  const transformedEvents = eventsTransform(baseEvents, fixture);
  const shiftedEvents = transformedEvents.map((item) => {
    const occurredAtMs = item.occurredAtMs + eventShiftMs;
    let payload = item.payload;
    if (item.kind === 'SYMBOL_STATUS' || item.kind === 'BOOK_SNAPSHOT' || item.kind === 'BOOK_DELTA') {
      payload = {
        ...payload,
        observedAtMs: payload.observedAtMs + eventShiftMs,
        validUntilMs: payload.validUntilMs + eventShiftMs,
      };
    } else if (item.kind === 'PREFLIGHT_EVIDENCE') {
      payload = { fixtureId: fixture.fixtureId, ...passingPreflight(fixture, { evaluatedAtMs: occurredAtMs }) };
    } else if (item.kind === 'RATE_DECISION') {
      payload = { fixtureId: fixture.fixtureId, ...allowedRateDecision(fixture, { atMs: occurredAtMs }) };
    }
    return event(item.kind, item.sequence, occurredAtMs, payload, { sourceSequence: item.sourceSequence });
  });
  const events = reconcile ? reconciliationEvent(shiftedEvents, fixture) : shiftedEvents;
  const twinState = runExchangeTwinScenario(scenarioInput({
    fixture,
    events,
    overrides: {
      scenarioId: `scenario-${fixtureId}`,
      seed: `seed-${fixtureId}`,
    },
  }));
  return {
    schema: 'LIVE_EDGE_VOLUME_TWIN_EVIDENCE_V1',
    actionKey: action.actionKey,
    fixtureId,
    twinState,
  };
}

export function crashRestartEvents(events, fixture) {
  return [
    ...events,
    event('CRASH', 30, TWIN_T0 + 50, {
      crashId: 'volume-crash-0001',
      dropLocalDeliveries: true,
      dropPendingCommands: false,
    }),
    event('RESTART', 31, TWIN_T0 + 60, { crashId: 'volume-crash-0001' }),
  ];
}

export function reconciliationEvent(events, fixture) {
  const preliminary = runExchangeTwinScenario(scenarioInput({
    fixture,
    events,
    overrides: { scenarioId: 'scenario-volume-preliminary-0001', seed: 'seed-volume-preliminary-0001' },
  }));
  const order = preliminary.orders.find((candidate) => candidate.fixture.fixtureId === fixture.fixtureId);
  return [
    ...events,
    event('RECONCILIATION_OBSERVATION', 40,
      Math.max(...events.map((item) => item.occurredAtMs)) + 30, {
      fixtureId: fixture.fixtureId,
      ownerObservationRevision: 'volume-owner-observation-revision-0001',
      observedVenueRevision: order.venueRevision,
      observedStatus: order.venueStatus,
      observedFilledQuantity: order.filledQuantity,
    }),
  ];
}

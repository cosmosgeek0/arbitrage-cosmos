import { createHash } from 'node:crypto';

import {
  deriveReverseBasisExposureRevision,
  deriveReverseBasisEventId,
  REVERSE_BASIS_NO_ACTION_AUTHORITY,
  REVERSE_BASIS_REQUIRED_GATES,
  runReverseBasisLifecycle,
} from '../../../dist/liveEdge/adapters/reverseBasisLifecycle/index.js';
import {
  runExchangeTwinScenario,
} from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  evaluateSyntheticSubmissionBoundary,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/index.js';
import {
  allowedRateDecision,
  event as twinEvent,
  feeEvidence,
  orderByFixtureId,
  orderFixture,
  passingPreflight,
  scenarioInput,
  T0 as TWIN_T0,
} from '../exchangeTwin/fixtures.mjs';
import {
  makeAction,
  makeCandidate,
  makeExecutionPolicyInput,
  makeScenario,
} from '../executionPolicy/fixtures.mjs';
import {
  evaluateExecutionPolicy,
} from '../../../dist/liveEdge/adapters/executionPolicy/index.js';
import {
  T0 as L06_T0,
  inputFixture as mutationInputFixture,
  submittingPersisted,
} from '../mutationJournal/fixtures.mjs';

export const EVALUATED_AT_MS = TWIN_T0 + 5_000;
export const MARGIN_REALM = 'account-realm:margin-l10-synthetic';
export const FUTURES_REALM = 'account-realm:futures-l10-synthetic';
export const SYMBOL = 'BTCUSDT';
export const BASE_ASSET = 'BTC';
export const QUOTE_ASSET = 'USDT';
export const PRINCIPAL = '0.03';
export const RECOVERY_EVIDENCE_REVISION = 'recovery-revision:l08:001';

const OPEN_PAIR_EXPOSURE_REVISION = deriveReverseBasisExposureRevision({
  borrowedPrincipal: PRINCIPAL,
  accruedInterest: '0',
  totalLiability: PRINCIPAL,
  marginSaleFilled: PRINCIPAL,
  futuresEntryFilled: PRINCIPAL,
  marginCoverFilled: '0',
  futuresExitFilled: '0',
  marginShortRemaining: PRINCIPAL,
  futuresLongRemaining: PRINCIPAL,
  hedgeDriftQuantity: '0',
  grossOpenQuantity: '0.06',
});

function clone(value) {
  return structuredClone(value);
}

function leg({ legId, product, side, reduceOnly, accountRealmId }) {
  return {
    legId,
    instrumentRevision: `${legId}:instrument-revision:001`,
    filterRevision: `${legId}:filter-revision:001`,
    l04SizingRevision: `${legId}:sizing-revision:001`,
    l04SourceEvidenceRevision: `${legId}:source-revision:001`,
    l04SnapshotRevision: `${legId}:snapshot-revision:001`,
    l04PreflightState: 'PASS',
    allowedOrderTypes: ['LIMIT', 'MARKET'],
    allowedTimeInForce: ['FOK', 'GTC', 'IOC'],
    product,
    accountRealmId,
    symbol: SYMBOL,
    baseAsset: BASE_ASSET,
    quoteAsset: QUOTE_ASSET,
    side,
    reduceOnly,
    requestedQuantity: PRINCIPAL,
    filteredQuantity: PRINCIPAL,
    authorizedLimitPrice: side === 'BUY' ? '101' : '99',
    filteredNotionalQuote: side === 'BUY' ? '3.03' : '2.97',
  };
}

function failureTransitions(legs) {
  return legs.map((item) => ({
    legId: item.legId,
    onReject: 'RECOVER_WITHIN_BUDGET',
    onPartial: 'WAIT_FOR_ACTUAL_FILL',
    onTimeout: 'RECONCILE_ONLY',
    onAmbiguity: 'RECONCILE_ONLY',
  }));
}

function buildPolicy(phase, marginRealm = MARGIN_REALM, futuresRealm = FUTURES_REALM) {
  const entry = phase === 'ENTRY';
  const spot = leg({
    legId: `leg-l10-${phase.toLowerCase()}-margin`,
    // Accepted L08 cannot plan Spot TIF yet. This first leg is used only as
    // its ordered actual-fill mechanics witness; L10 retains Margin identity.
    product: 'USD_M_PERPETUAL',
    side: entry ? 'SELL' : 'BUY',
    reduceOnly: false,
    accountRealmId: marginRealm,
  });
  const futures = leg({
    legId: `leg-l10-${phase.toLowerCase()}-futures`,
    product: 'USD_M_PERPETUAL',
    side: entry ? 'BUY' : 'SELL',
    reduceOnly: !entry,
    accountRealmId: futuresRealm,
  });
  const first = makeAction({
    step: 0,
    legId: spot.legId,
    quantity: PRINCIPAL,
    price: entry ? '99' : '101',
    timeInForce: 'GTC',
  });
  const second = makeAction({
    step: 1,
    legId: futures.legId,
    quantity: PRINCIPAL,
    price: entry ? '100' : '99',
    timeInForce: 'GTC',
    dependsOnActualFillLegId: spot.legId,
  });
  const actions = [first, second];
  if (phase === 'RECOVERY') {
    actions.push(makeAction({
      step: 2,
      kind: 'RECOVER',
      legId: spot.legId,
      quantity: PRINCIPAL,
      price: '101',
      dependsOnActualFillLegId: spot.legId,
      recoveryEvidenceRevision: RECOVERY_EVIDENCE_REVISION,
      targetExposureRevision: OPEN_PAIR_EXPOSURE_REVISION,
    }));
    actions.push(makeAction({
      step: 3,
      kind: 'RECOVER',
      legId: futures.legId,
      quantity: PRINCIPAL,
      price: '99',
      dependsOnActualFillLegId: spot.legId,
      recoveryEvidenceRevision: RECOVERY_EVIDENCE_REVISION,
      targetExposureRevision: OPEN_PAIR_EXPOSURE_REVISION,
    }));
  }
  const scenarios = [
    makeScenario({
      scenarioId: `scenario-l10-${phase.toLowerCase()}-full`,
      probabilityPpm: 900_000,
      fills: [
        { legId: spot.legId, filledQuantity: PRINCIPAL },
        { legId: futures.legId, filledQuantity: PRINCIPAL },
      ],
    }),
    makeScenario({
      scenarioId: `scenario-l10-${phase.toLowerCase()}-tail`,
      probabilityPpm: 100_000,
      fills: [
        { legId: spot.legId, filledQuantity: '0' },
        { legId: futures.legId, filledQuantity: '0' },
      ],
      lossQuote: '8',
      adverseSelectionQuote: '8',
    }),
  ];
  const candidate = makeCandidate({
    posture: phase === 'RECOVERY' ? 'RECOVERY' : 'PASSIVE',
    expiresAtMs: EVALUATED_AT_MS + 60_000,
    actions,
    scenarios,
    legFailureTransitions: failureTransitions([spot, futures]),
    distribution: {
      observedAtMs: 1_783_920_000_000,
      validUntilMs: EVALUATED_AT_MS + 60_000,
    },
  });
  const dependencyTemplate = makeExecutionPolicyInput().dependencies;
  const input = makeExecutionPolicyInput({
    legs: [spot, futures],
    candidates: [candidate],
    authority: { validUntilMs: EVALUATED_AT_MS + 60_000 },
    dependencies: dependencyTemplate.map((dependency) => ({
      ...dependency,
      ...(phase === 'RECOVERY' && dependency.kind === 'CURRENT_POSITION'
        ? { revision: OPEN_PAIR_EXPOSURE_REVISION } : {}),
      ...(phase === 'RECOVERY' && dependency.kind === 'RECOVERY'
        ? { revision: RECOVERY_EVIDENCE_REVISION } : {}),
      validUntilMs: EVALUATED_AT_MS + 60_000,
    })),
  });
  const decision = evaluateExecutionPolicy(input);
  if (decision.disposition !== 'PLANNED') {
    throw new Error(`L10 ${phase} fixture policy rejected: ${decision.reasonCodes.join(',')}`);
  }
  return { input, decision };
}

export function policySet({
  marginRealm = MARGIN_REALM,
  futuresRealm = FUTURES_REALM,
} = {}) {
  return {
    entry: buildPolicy('ENTRY', marginRealm, futuresRealm),
    exit: buildPolicy('EXIT', marginRealm, futuresRealm),
    recovery: buildPolicy('RECOVERY', marginRealm, futuresRealm),
  };
}

function exactProduct(left, right) {
  const normalize = (value) => {
    const [integer, fraction = ''] = value.split('.');
    return { coefficient: BigInt(`${integer}${fraction}`), scale: fraction.length };
  };
  const a = normalize(left);
  const b = normalize(right);
  const scale = a.scale + b.scale;
  const digits = (a.coefficient * b.coefficient).toString().padStart(scale + 1, '0');
  if (scale === 0) return digits;
  const integer = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/u, '');
  return fraction.length === 0 ? integer : `${integer}.${fraction}`;
}

function mappedId(prefix, value, length = 16) {
  return `${prefix}${createHash('sha256').update(value).digest('hex').slice(0, length)}`;
}

function bindL06Fixture(fixture, plan, action, accountRealmId) {
  const validationPrice = fixture.price ?? '100';
  const resultNotional = exactProduct(validationPrice, fixture.quantity);
  const input = mutationInputFixture({
    identity: {
      globalCorrelationId: mappedId('cor_', plan.correlationId),
      decisionId: mappedId('cdec_', plan.policyRequestId),
      proposalId: mappedId('cprop_', plan.intentId),
      capitalMandateId: mappedId('cmdt_', plan.mandateId, 32),
      capitalReservationId: mappedId('cres_', plan.capitalReservationId, 32),
      ticketId: mappedId('plan_', plan.planId),
      legId: mappedId('leg_', action.legId),
      product: fixture.product,
      accountRealmId,
      contractId: fixture.product === 'SPOT' ? 'SPOT_ORDER_POST' : 'USDM_ORDER_POST',
      signerProfile: fixture.product === 'SPOT' ? 'SPOT_HMAC_SHA256' : 'USDM_HMAC_SHA256',
    },
    requestedQuantity: fixture.quantity,
    preflightResult: {
      instrumentRevision: fixture.instrumentRevision,
      sourceEvidenceRevision: fixture.sourceEvidenceRevision,
      requestedPrice: fixture.price,
      validationPrice,
      requestedQuantity: fixture.quantity,
      resultQuantity: fixture.quantity,
      resultNotional,
      effectiveNotionalCeiling: '10',
      canaryMaximumNotional: '10',
    },
    bindings: {
      instrumentRevision: fixture.instrumentRevision,
      sourceEvidenceRevision: fixture.sourceEvidenceRevision,
      preflightResultQuantity: fixture.quantity,
      preflightResultNotional: resultNotional,
      preflightCanaryMaximumNotional: '10',
    },
  });
  const persisted = submittingPersisted(input);
  return {
    ...fixture,
    l06Snapshot: persisted.snapshot,
    l06Boundary: evaluateSyntheticSubmissionBoundary(persisted, L06_T0 + 4),
  };
}

function stagedTwinEvents(fixture, anchorAtMs, {
  bids,
  asks,
  httpOutcome = 'ACK',
} = {}) {
  const events = [
    twinEvent('SYMBOL_STATUS', 1, anchorAtMs, {
      product: fixture.product,
      symbol: fixture.symbol,
      status: 'TRADING',
      evidenceRevision: `symbol-status-l10-${fixture.fixtureId}`,
      observedAtMs: anchorAtMs,
      validUntilMs: EVALUATED_AT_MS + 10_000,
    }),
    twinEvent('BOOK_SNAPSHOT', 2, anchorAtMs + 1, {
      product: fixture.product,
      symbol: fixture.symbol,
      bookRevision: `book-revision-l10-${fixture.fixtureId}`,
      sourceSequence: 100,
      observedAtMs: anchorAtMs + 1,
      validUntilMs: EVALUATED_AT_MS + 10_000,
      bids,
      asks,
    }, { sourceSequence: 100 }),
    twinEvent('PREFLIGHT_EVIDENCE', 3, anchorAtMs + 20, {
      fixtureId: fixture.fixtureId,
      ...passingPreflight(fixture, { evaluatedAtMs: anchorAtMs + 20 }),
    }, { sourceSequence: 200 }),
    twinEvent('RATE_DECISION', 4, anchorAtMs + 3, {
      fixtureId: fixture.fixtureId,
      ...allowedRateDecision(fixture, { atMs: anchorAtMs + 3 }),
    }),
    twinEvent('PLACE_DISPATCH', 5, anchorAtMs + 10, { fixtureId: fixture.fixtureId }),
    twinEvent('VENUE_ARRIVAL', 6, anchorAtMs + 20, {
      fixtureId: fixture.fixtureId,
      feeEvidence: feeEvidence(),
    }, { sourceSequence: 201 }),
    twinEvent('HTTP_DELIVERY', 8, anchorAtMs + 40, {
      fixtureId: fixture.fixtureId,
      outcome: httpOutcome,
    }),
  ];
  return events;
}

export function twinForRole(role, plan, action, {
  quantity = PRINCIPAL,
  liquidityQuantity = '1',
  timeInForce = 'GTC',
  outcome = 'CONFIRMED',
  includePrivate = true,
  fixtureSuffix = '001',
  anchorOverrideAtMs = null,
} = {}) {
  const product = role.startsWith('MARGIN_') || role === 'RECOVERY_MARGIN_COVER'
    ? 'SPOT' : 'USD_M_PERPETUAL';
  const marginMechanics = product === 'SPOT';
  const side = role === 'MARGIN_ENTRY_SELL'
    || role === 'FUTURES_EXIT_CLOSE'
    || role === 'RECOVERY_FUTURES_ADJUST'
    ? 'SELL' : 'BUY';
  const anchorByRole = {
    MARGIN_ENTRY_SELL: EVALUATED_AT_MS - 420,
    FUTURES_ENTRY_HEDGE: EVALUATED_AT_MS - 370,
    MARGIN_EXIT_COVER: EVALUATED_AT_MS - 320,
    FUTURES_EXIT_CLOSE: EVALUATED_AT_MS - 270,
    RECOVERY_MARGIN_COVER: EVALUATED_AT_MS - 320,
    RECOVERY_FUTURES_ADJUST: EVALUATED_AT_MS - 270,
  };
  const anchorAtMs = anchorOverrideAtMs ?? anchorByRole[role];
  const fixtureId = `fixture-l10-${role.toLowerCase().replaceAll('_', '-')}-${fixtureSuffix}`;
  const rawFixture = orderFixture({
    fixtureId,
    product,
    side,
    quantity,
    orderType: marginMechanics ? 'MARKET' : 'LIMIT',
    price: marginMechanics ? null : side === 'BUY' ? '101' : '99',
    timeInForce: marginMechanics ? null : timeInForce,
    rateEvidence: allowedRateDecision({ product }, { atMs: anchorAtMs + 3 }),
  });
  const fixture = bindL06Fixture(
    rawFixture,
    plan,
    action,
    marginMechanics
      ? 'account-realm:spot-mechanics-l10-synthetic'
      : plan.legs.find((leg) => leg.legId === action.legId).accountRealmId,
  );
  let events;
  if (outcome === 'REJECTED_NO_EFFECT_PROVEN') {
    events = stagedTwinEvents(fixture, anchorAtMs, {
      bids: [{ price: '100', quantity: liquidityQuantity }],
      asks: [{ price: '101', quantity: '1' }],
    }).slice(0, 4);
  } else {
    const books = side === 'BUY'
      ? {
          bids: [{ price: '99', quantity: '1' }],
          asks: [{ price: '100', quantity: liquidityQuantity }],
        }
      : {
          bids: [{ price: '100', quantity: liquidityQuantity }],
          asks: [{ price: '101', quantity: '1' }],
        };
    events = stagedTwinEvents(fixture, anchorAtMs, {
      ...books,
      httpOutcome: outcome === 'UNKNOWN' ? 'TIMEOUT' : 'ACK',
    });
  }
  const scenario = (scenarioEvents) => runExchangeTwinScenario(scenarioInput({
    fixture,
    events: scenarioEvents,
    overrides: {
      scenarioId: `scenario-${fixtureId}`,
      modelRevision: 'exchange-twin-model:l10-reverse-basis-001',
      seed: `seed-${fixtureId}`,
    },
  }));
  if (outcome === 'CONFIRMED' && includePrivate) {
    const venueScenario = scenario(events.filter((item) => item.kind !== 'HTTP_DELIVERY'));
    const venueOrder = orderByFixtureId(venueScenario, fixtureId);
    if (!venueOrder) throw new Error('L10 venue-stage twin fixture order missing');
    events = [...events, twinEvent('PRIVATE_DELIVERY', 7, anchorAtMs + 35, {
      fixtureId,
      venueRevision: venueOrder.venueRevision,
    })];
  }
  let twinScenario = scenario(events);
  let order = orderByFixtureId(twinScenario, fixtureId);
  if (!order) throw new Error('L10 twin fixture order missing');
  if (outcome === 'CONFIRMED' && includePrivate && order.venueStatus !== 'BLOCKED') {
    events = [...events, twinEvent('RECONCILIATION_OBSERVATION', 9, anchorAtMs + 50, {
      fixtureId,
      ownerObservationRevision: `owner-observation-${fixtureId}`,
      observedVenueRevision: order.venueRevision,
      observedStatus: order.venueStatus,
      observedFilledQuantity: order.filledQuantity,
    })];
    twinScenario = scenario(events);
    order = orderByFixtureId(twinScenario, fixtureId);
    if (!order) throw new Error('L10 reconciled twin fixture order missing');
  }
  return { twinScenario, order };
}

function planAndAction(policies, role) {
  const policy = role === 'MARGIN_ENTRY_SELL' || role === 'FUTURES_ENTRY_HEDGE'
    ? policies.entry
    : role === 'MARGIN_EXIT_COVER' || role === 'FUTURES_EXIT_CLOSE'
      ? policies.exit
      : policies.recovery;
  const plan = policy.decision.selectedPlan;
  const kind = role.startsWith('RECOVERY_') ? 'RECOVER' : 'PLACE';
  const places = plan.actions.filter((item) => item.kind === 'PLACE').sort((a, b) => a.step - b.step);
  const roleIndex = role.startsWith('MARGIN_') || role === 'RECOVERY_MARGIN_COVER' ? 0 : 1;
  const action = kind === 'PLACE'
    ? places[roleIndex]
    : plan.actions.find((item) => item.kind === 'RECOVER' && item.legId === places[roleIndex].legId);
  const leg = plan.legs.find((item) => item.legId === action?.legId);
  if (!leg || !action) throw new Error(`L10 policy fixture missing ${role}`);
  return { plan, action };
}

export function orderObservation(policies, role, options = {}) {
  const mutationState = options.mutationState ?? 'CONFIRMED';
  const { plan, action } = planAndAction(policies, role);
  const policyLeg = plan.legs.find((leg) => leg.legId === action.legId);
  if (!policyLeg) throw new Error(`L10 policy fixture missing leg for ${role}`);
  const { twinScenario, order } = twinForRole(role, plan, action, {
    ...options,
    outcome: mutationState,
  });
  const margin = role.startsWith('MARGIN_') || role === 'RECOVERY_MARGIN_COVER';
  return {
    payload: {
      orderRef: options.orderRef ?? `order-ref-${role.toLowerCase().replaceAll('_', '-')}`,
      role,
      accountRealmId: policyLeg.accountRealmId,
      marginMode: margin ? 'ISOLATED' : null,
      isolatedSymbol: margin ? SYMBOL : null,
      accountOrderId: mutationState === 'CONFIRMED'
        ? `account-order-${role.toLowerCase().replaceAll('_', '-')}` : null,
      mutationState,
      mutationEvidenceRevision: `mutation-evidence-${role.toLowerCase().replaceAll('_', '-')}`,
      policyPlanRevision: plan.planRevision,
      policyActionId: action.actionId,
      mechanicsAuthority: margin
        ? 'L07_SPOT_MARKET_MECHANICS_ONLY' : 'L07_USDM_MECHANICS',
      twinFixtureId: order.fixture.fixtureId,
      twinScenario,
    },
    order,
  };
}

export function event(
  kind,
  sequence,
  payload,
  occurredAtMs = EVALUATED_AT_MS - 500 + (Math.min(sequence, 9) * 50),
) {
  const material = {
    schema: 'LIVE_EDGE_REVERSE_BASIS_EVENT_V1',
    sequence,
    occurredAtMs,
    kind,
    payload: clone(payload),
  };
  return { ...material, eventId: deriveReverseBasisEventId(material) };
}

export function confirmedBorrow(overrides = {}) {
  return {
    accountRealmId: MARGIN_REALM,
    marginMode: 'ISOLATED',
    isolatedSymbol: SYMBOL,
    asset: BASE_ASSET,
    requestedPrincipal: PRINCIPAL,
    confirmedPrincipal: PRINCIPAL,
    transactionId: 'borrow-transaction-l10-001',
    state: 'CONFIRMED',
    liabilityRevision: 'liability-revision-l10-current-001',
    evidenceRevision: 'borrow-evidence-l10-001',
    ...overrides,
  };
}

export function liability({
  principal = PRINCIPAL,
  accruedInterest = '0',
  totalLiability = principal === '0' && accruedInterest === '0'
    ? '0'
    : String(Number(principal) + Number(accruedInterest)),
  repayStatus = totalLiability === '0' ? 'ZERO_CONFIRMED' : 'NOT_REPAID',
  revision = 'liability-revision-l10-current-001',
  ...overrides
} = {}) {
  return {
    accountRealmId: MARGIN_REALM,
    marginMode: 'ISOLATED',
    isolatedSymbol: SYMBOL,
    asset: BASE_ASSET,
    principal,
    accruedInterest,
    totalLiability,
    repayStatus,
    observedAtMs: EVALUATED_AT_MS - 440,
    validUntilMs: EVALUATED_AT_MS + 10_000,
    liabilityRevision: revision,
    ...overrides,
  };
}

export function confirmedRepay(overrides = {}) {
  return {
    source: 'LIFECYCLE_FIXTURE',
    accountRealmId: MARGIN_REALM,
    marginMode: 'ISOLATED',
    isolatedSymbol: SYMBOL,
    asset: BASE_ASSET,
    requestedRepayAmount: PRINCIPAL,
    confirmedRepayAmount: PRINCIPAL,
    transactionId: 'repay-transaction-l10-001',
    state: 'CONFIRMED',
    liabilityRevision: 'liability-revision-l10-zero-001',
    evidenceRevision: 'repay-evidence-l10-001',
    ...overrides,
  };
}

export function baseInput(overrides = {}) {
  const policies = overrides.policies ?? policySet();
  const entryPlan = policies.entry.decision.selectedPlan;
  const preflightEvaluatedAtMs = EVALUATED_AT_MS - 500;
  const gateOwnerRevision = {
    BASIS_PROPOSAL: 'basis-proposal-revision-l10-001',
    CAPITAL_MANDATE: entryPlan.mandateRevision,
    CAPITAL_RESERVATION: entryPlan.capitalReservationRevision,
    FOUNDATION_RISK: entryPlan.riskVerdictRevision,
    OPERATOR_APPROVAL: entryPlan.operatorApprovalRevision,
    INSTRUMENT_FILTERS: 'filter-revision-l10-001',
  };
  const gates = REVERSE_BASIS_REQUIRED_GATES.map((kind) => ({
    kind,
    state: 'PASS',
    ownerRevision: gateOwnerRevision[kind]
      ?? `owner-${kind.toLowerCase().replaceAll('_', '-')}-revision-l10`,
    observedAtMs: preflightEvaluatedAtMs - 100,
    validUntilMs: EVALUATED_AT_MS + 10_000,
  }));
  return {
    schema: 'LIVE_EDGE_REVERSE_BASIS_INPUT_V1',
    lifecycleVersion: 'L10_REVERSE_BASIS_V1',
    evaluatedAtMs: EVALUATED_AT_MS,
    ticket: {
      ticketId: 'ticket-reverse-basis-l10-001',
      decisionId: 'decision-reverse-basis-l10-001',
      basisProposalId: 'basis-proposal-reverse-l10-001',
      basisProposalRevision: 'basis-proposal-revision-l10-001',
      direction: 'SHORT_SPOT_LONG_PERP',
      account: {
        accountRealmId: MARGIN_REALM,
        futuresAccountRealmId: FUTURES_REALM,
        marginMode: 'ISOLATED',
        isolatedSymbol: SYMBOL,
        symbol: SYMBOL,
        baseAsset: BASE_ASSET,
        quoteAsset: QUOTE_ASSET,
        futuresPositionMode: 'ONE_WAY',
        futuresPositionSide: 'BOTH',
        accountConstruction: 'NO_TRANSFER_REQUIRED',
        transferRequired: false,
        bindingRevision: 'account-binding-revision-l10-001',
      },
      ownerChain: {
        correlationId: entryPlan.correlationId,
        intentId: entryPlan.intentId,
        intentRevision: entryPlan.intentRevision,
        authorizationRevision: entryPlan.authorizationRevision,
        mandateId: entryPlan.mandateId,
        mandateRevision: entryPlan.mandateRevision,
        capitalReservationId: entryPlan.capitalReservationId,
        capitalReservationRevision: entryPlan.capitalReservationRevision,
        stagedPlanId: entryPlan.stagedPlanId,
        stagedPlanRevision: entryPlan.stagedPlanRevision,
        operatorApprovalId: entryPlan.operatorApprovalId,
        operatorApprovalRevision: entryPlan.operatorApprovalRevision,
        riskVerdictId: entryPlan.riskVerdictId,
        riskVerdictRevision: entryPlan.riskVerdictRevision,
      },
      policyDecisions: {
        entryDecisionId: policies.entry.decision.decisionId,
        entryDecisionRevision: policies.entry.decision.decisionRevision,
        exitDecisionId: policies.exit.decision.decisionId,
        exitDecisionRevision: policies.exit.decision.decisionRevision,
        recoveryDecisionId: policies.recovery.decision.decisionId,
        recoveryDecisionRevision: policies.recovery.decision.decisionRevision,
      },
      requestedPrincipal: PRINCIPAL,
      maxGrossNotionalQuote: '10',
      maxNakedQuantity: PRINCIPAL,
      maxNakedNotionalQuote: '4',
      maxNakedDurationMs: 5_000,
      maxRecoveryCostQuote: '2',
      maxRecoveryGrossNotionalQuote: '12',
      entryEvidenceRevision: 'entry-evidence-revision-l10-001',
      filterRevision: 'filter-revision-l10-001',
      expiresAtMs: EVALUATED_AT_MS + 30_000,
    },
    preflight: {
      evaluatedAtMs: preflightEvaluatedAtMs,
      basisDirection: 'SHORT_SPOT_LONG_PERP',
      basisBorrowVerdict: 'OK',
      gates,
      collateral: {
        accountRealmId: MARGIN_REALM,
        marginMode: 'ISOLATED',
        isolatedSymbol: SYMBOL,
        state: 'CURRENT',
        marginLevel: '5',
        collateralMarginLevel: '4',
        collateralValueQuote: '100',
        liquidationPrice: '20',
        liquidationState: 'NORMAL',
        observedAtMs: preflightEvaluatedAtMs - 100,
        validUntilMs: EVALUATED_AT_MS + 10_000,
        collateralRevision: 'collateral-revision-l10-001',
      },
      borrowQuote: {
        accountRealmId: MARGIN_REALM,
        marginMode: 'ISOLATED',
        isolatedSymbol: SYMBOL,
        state: 'AVAILABLE',
        asset: BASE_ASSET,
        requestedPrincipal: PRINCIPAL,
        maximumBorrowable: '0.1',
        accountBorrowLimit: '1',
        availableInventory: '0.5',
        hourlyInterestRate: '0.00001',
        interestAccrual: 'ON_BORROW_AND_HOURLY',
        nextInterestAtMs: EVALUATED_AT_MS + 3_000,
        observedAtMs: preflightEvaluatedAtMs - 100,
        validUntilMs: preflightEvaluatedAtMs + 1_000,
        quoteRevision: 'borrow-quote-revision-l10-001',
      },
    },
    policies: clone(policies),
    events: [],
    ...REVERSE_BASIS_NO_ACTION_AUTHORITY,
    ...clone(overrides),
    policies: clone(policies),
  };
}

export function standardLifecycleEvents(policies = policySet()) {
  const marginEntry = orderObservation(policies, 'MARGIN_ENTRY_SELL');
  const futuresEntry = orderObservation(policies, 'FUTURES_ENTRY_HEDGE');
  const marginExit = orderObservation(policies, 'MARGIN_EXIT_COVER');
  const futuresExit = orderObservation(policies, 'FUTURES_EXIT_CLOSE');
  const zeroLiability = liability({
    principal: '0',
    accruedInterest: '0',
    totalLiability: '0',
    repayStatus: 'ZERO_CONFIRMED',
    revision: 'liability-revision-l10-zero-001',
    observedAtMs: EVALUATED_AT_MS - 140,
  });
  const orderRevisions = [marginEntry, futuresEntry, marginExit, futuresExit]
    .map((item) => item.order.venueRevision)
    .sort();
  return [
    event('BORROW_OBSERVED', 1, confirmedBorrow()),
    event('LIABILITY_OBSERVED', 2, liability()),
    event('ORDER_OBSERVED', 3, marginEntry.payload),
    event('ORDER_OBSERVED', 4, futuresEntry.payload),
    event('ORDER_OBSERVED', 5, marginExit.payload),
    event('ORDER_OBSERVED', 6, futuresExit.payload),
    event('REPAY_OBSERVED', 7, confirmedRepay()),
    event('LIABILITY_OBSERVED', 8, zeroLiability),
    event('CLOSURE_RECONCILED', 9, {
      state: 'EXACT',
      accountRealmId: MARGIN_REALM,
      liabilityRevision: zeroLiability.liabilityRevision,
      borrowTransactionId: 'borrow-transaction-l10-001',
      repayTransactionId: 'repay-transaction-l10-001',
      orderStateRevisions: orderRevisions,
      openOrderRefs: [],
      ambiguousMutationRefs: [],
      unmatchedFillRefs: [],
      marginShortRemaining: '0',
      futuresLongRemaining: '0',
      observedAtMs: EVALUATED_AT_MS - 90,
      validUntilMs: EVALUATED_AT_MS + 10_000,
      reconciliationRevision: 'closure-reconciliation-l10-001',
    }),
  ];
}

export function closedInput(overrides = {}) {
  const policies = overrides.policies ?? policySet();
  return baseInput({
    ...overrides,
    policies,
    events: overrides.events ?? standardLifecycleEvents(policies),
  });
}

export function run(input) {
  return runReverseBasisLifecycle(input);
}

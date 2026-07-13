import assert from 'node:assert/strict';

import {
  stableHash128Hex,
  stableHash64Hex,
} from '../../../dist/foundation/contracts/index.js';
import {
  createExecutionPlanDefinition,
} from '../../../dist/foundation/execution/index.js';
import {
  bindSpotOrderTifCapability,
  deriveSpotOrderTifDependencyRevision,
} from '../../../dist/liveEdge/adapters/binanceInstrumentSpecs/index.js';
import {
  evaluateSyntheticSubmissionBoundary,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/index.js';
import {
  EXECUTION_POLICY_OWNER_BINDINGS_SCHEMA,
} from '../../../dist/liveEdge/adapters/executionPolicy/index.js';
import {
  multiplyTwinDecimals,
  runExchangeTwinScenario,
} from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  NORMAL_BASIS_POSITION_MODE_EVIDENCE_SCHEMA,
  bindNormalBasisFoundationPlan,
  evaluateNormalBasisEntryBinding,
  runNormalBasisTwinLeg,
} from '../../../dist/liveEdge/adapters/normalBasis/index.js';
import {
  makeAction,
  makeCandidate,
  makeExecutionPolicyInput,
  makeScenario,
} from '../executionPolicy/fixtures.mjs';
import {
  T0 as TWIN_T0,
  baselineEvents,
  event,
  orderByFixtureId,
  orderFixture,
  passingPreflight,
  scenarioInput,
} from '../exchangeTwin/fixtures.mjs';
import {
  T0 as L06_T0,
  inputFixture as mutationInputFixture,
  submittingPersisted,
} from '../mutationJournal/fixtures.mjs';

export { TWIN_T0 };
export const VENUE_ARRIVAL_MS = TWIN_T0 + 20;

let fixtureCounter = 0;

function deepFreeze(value, seen = new Set()) {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

export class ManualClock {
  constructor(nowMs = VENUE_ARRIVAL_MS) { this.value = nowMs; }
  nowMs() { return this.value; }
  set(nowMs) { this.value = nowMs; }
  advance(deltaMs) { this.value += deltaMs; }
}

function spotPolicyLeg(capability) {
  return {
    legId: 'leg-spot',
    instrumentRevision: capability.instrumentRevision,
    filterRevision: capability.registryRevision,
    l04SizingRevision: capability.preflightRevision,
    l04SourceEvidenceRevision: capability.sourceEvidenceRevision,
    l04SnapshotRevision: capability.snapshotRevision,
    l04PreflightState: 'PASS',
    allowedOrderTypes: ['LIMIT'],
    allowedTimeInForce: ['GTC'],
    product: 'SPOT',
    accountRealmId: 'realm-normal-basis-spot',
    symbol: capability.symbol,
    baseAsset: capability.baseAsset,
    quoteAsset: capability.quoteAsset,
    side: 'BUY',
    reduceOnly: false,
    requestedQuantity: capability.requestedQuantity,
    filteredQuantity: capability.resultQuantity,
    authorizedLimitPrice: capability.requestedPrice,
    filteredNotionalQuote: capability.resultNotional,
  };
}

function perpPolicyLeg(result) {
  assert.equal(result.staticState, 'PASS', result.reasonCodes.join(','));
  return {
    legId: 'leg-perp',
    instrumentRevision: result.instrumentRevision,
    filterRevision: result.registryRevision,
    l04SizingRevision: `l04-perp-sizing:${result.snapshotRevision}`,
    l04SourceEvidenceRevision: result.sourceEvidenceRevision,
    l04SnapshotRevision: result.snapshotRevision,
    l04PreflightState: 'PASS',
    allowedOrderTypes: ['LIMIT'],
    allowedTimeInForce: ['GTC'],
    product: 'USD_M_PERPETUAL',
    accountRealmId: 'realm-normal-basis-perp',
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    side: 'SELL',
    reduceOnly: false,
    requestedQuantity: result.requestedQuantity,
    filteredQuantity: result.resultQuantity,
    authorizedLimitPrice: result.requestedPrice,
    filteredNotionalQuote: result.resultNotional,
  };
}

export function makeNormalBasisBinding({
  suffix = 'default',
  maxNakedDurationMs = 1_000,
  attempt = 0,
  spotQuantity = '0.1',
  perpQuantity = '0.1',
  expectedBindingOk = true,
} = {}) {
  const canonicalProposalId = `cprop_${stableHash64Hex(`normal-basis-proposal:${suffix}`)}`;
  const canonicalDecisionId = `cdec_${stableHash64Hex(`normal-basis-decision:${suffix}`)}`;
  const mandateId = `cmdt_${stableHash128Hex(`normal-basis-mandate:${suffix}`)}`;
  const capitalReservationId = `cres_${stableHash128Hex(`normal-basis-reservation:${suffix}`)}`;
  const spotProbe = orderFixture({
    fixtureId: `fixture-l09-policy-spot-${suffix}`,
    product: 'SPOT', side: 'BUY', orderType: 'LIMIT', timeInForce: 'GTC',
    price: '100', quantity: spotQuantity,
  });
  const spotOwnerInput = deepFreeze(passingPreflight(spotProbe));
  const spotCapability = bindSpotOrderTifCapability(
    spotOwnerInput.registrySnapshot,
    spotOwnerInput.sizingRequest,
  );
  assert.equal(spotCapability.ok, true, spotCapability.reasonCodes?.join(','));
  const capability = spotCapability.binding;

  const perpProbe = orderFixture({
    fixtureId: `fixture-l09-policy-perp-${suffix}`,
    product: 'USD_M_PERPETUAL', side: 'SELL', orderType: 'LIMIT', timeInForce: 'GTC',
    price: '99', quantity: perpQuantity,
  });
  const perpPreview = runExchangeTwinScenario(scenarioInput({
    fixture: perpProbe,
    events: baselineEvents(perpProbe, { bids: [{ price: '99', quantity: perpQuantity }] }),
    overrides: { scenarioId: `scenario-l09-policy-perp-${suffix}` },
  }));
  const perpResult = perpPreview.preflights[0].result;
  assert.equal(perpResult.staticState, 'PASS', perpResult.reasonCodes.join(','));

  const foundationInput = {
    strategy: 'BASIS',
    direction: 'LONG_SPOT_SHORT_PERP',
    symbol: 'BTCUSDT',
    proposal: {
      canonicalProposalId,
      observedAtMs: VENUE_ARRIVAL_MS - 100,
      maxAgeMs: 30_000,
      expiresAtMs: capability.validUntilMs,
    },
    attempt,
    mode: 'PAPER',
    requiresApproval: false,
    maxNakedDurationMs,
    spotQuantity: Number(spotQuantity),
    perpQuantity: Number(perpQuantity),
    openingOrder: ['SPOT', 'PERP'],
  };
  const ownerPlan = createExecutionPlanDefinition(foundationInput);
  const actions = [
    makeAction({
      step: 0, legId: 'leg-spot', quantity: spotQuantity, price: '100', timeInForce: 'GTC',
    }),
    makeAction({
      step: 1, legId: 'leg-perp', quantity: perpQuantity, price: '99', timeInForce: 'GTC',
      dependsOnActualFillLegId: 'leg-spot',
    }),
  ];
  const scenarios = [
    makeScenario({
      scenarioId: 'scenario-full', probabilityPpm: 900_000,
      fills: [
        { legId: 'leg-spot', filledQuantity: spotQuantity },
        { legId: 'leg-perp', filledQuantity: perpQuantity },
      ],
    }),
    makeScenario({
      scenarioId: 'scenario-tail', probabilityPpm: 100_000,
      fills: [
        { legId: 'leg-spot', filledQuantity: '0' },
        { legId: 'leg-perp', filledQuantity: '0' },
      ],
      lossQuote: '8', adverseSelectionQuote: '8',
    }),
  ];
  const candidate = makeCandidate({
    actions,
    scenarios,
    expiresAtMs: capability.validUntilMs,
    distribution: {
      observedAtMs: VENUE_ARRIVAL_MS - 1_000,
      validUntilMs: capability.validUntilMs,
    },
  });
  const input = makeExecutionPolicyInput({
    authority: {
      intentId: canonicalDecisionId,
      externalPlanId: ownerPlan.planId,
      correlationId: ownerPlan.correlationId,
      mandateId,
      capitalReservationId,
      observedAtMs: VENUE_ARRIVAL_MS - 1_000,
      validUntilMs: capability.validUntilMs,
      mandateConstraints: { maxNakedDurationMs },
      capitalConstraints: { maxNakedDurationMs },
      riskConstraints: { maxNakedDurationMs },
      approvalConstraints: { maxNakedDurationMs },
    },
    legs: [spotPolicyLeg(capability), perpPolicyLeg(perpResult)],
    candidates: [candidate],
  });
  input.evaluatedAtMs = VENUE_ARRIVAL_MS;
  input.dependencies = input.dependencies.map((dependency) => ({
    ...dependency,
    revision: dependency.kind === 'INSTRUMENT_FILTER'
      ? deriveSpotOrderTifDependencyRevision([capability]) : dependency.revision,
    observedAtMs: VENUE_ARRIVAL_MS - 1_000,
    validUntilMs: capability.validUntilMs,
  }));
  const ownerBindings = {
    schema: EXECUTION_POLICY_OWNER_BINDINGS_SCHEMA,
    spotOrderTifOwnerInputs: [spotOwnerInput],
  };
  const entry = evaluateNormalBasisEntryBinding(input, ownerBindings);
  assert.equal(entry.ok, true, entry.reasonCodes?.join(','));
  const foundation = bindNormalBasisFoundationPlan(entry.binding, ownerPlan);
  assert.equal(foundation.ok, expectedBindingOk, foundation.reasonCodes?.join(','));
  return {
    binding: foundation.ok ? foundation.binding : null,
    bindingResult: foundation,
    entryBinding: entry.binding,
    capability,
    foundationInput,
    ownerBindings,
    ownerPlan,
    policyInput: input,
  };
}

export function positionModeEvidence(projection) {
  return {
    schema: NORMAL_BASIS_POSITION_MODE_EVIDENCE_SCHEMA,
    owner: 'BINANCE_PRIVATE_TRUTH',
    projection,
    sendEligible: false,
    actionAuthority: 'NONE_RECORD_ONLY',
    externalActionAuthorization: 'NONE',
  };
}

function stageTerms(binding, stage) {
  if (stage === 'ENTRY_SPOT') return {
    product: 'SPOT', side: 'BUY', price: binding.entry.spotAction.price,
  };
  if (stage === 'ENTRY_HEDGE') return {
    product: 'USD_M_PERPETUAL', side: 'SELL', price: binding.entry.perpAction.price,
  };
  if (stage === 'EXIT_SPOT' || stage === 'RECOVERY_CLOSE_SPOT') return {
    product: 'SPOT', side: 'SELL', price: '100',
  };
  return { product: 'USD_M_PERPETUAL', side: 'BUY', price: '99' };
}

function attachAliasedL06(fixture, binding, ownerRequest) {
  const policyLeg = ownerRequest.leg.key === 'SPOT'
    ? binding.entry.spotLeg : binding.entry.perpLeg;
  const resultNotional = multiplyTwinDecimals(fixture.price ?? '100', fixture.quantity);
  const input = mutationInputFixture({
    identity: {
      globalCorrelationId: binding.ownerPlan.correlationId,
      decisionId: binding.entry.plan.intentId,
      strategyId: 'BASIS',
      proposalId: binding.ownerPlan.proposal.canonicalProposalId,
      capitalMandateId: binding.entry.plan.mandateId,
      capitalReservationId: binding.entry.plan.capitalReservationId,
      ticketId: binding.ownerPlan.planId,
      legId: ownerRequest.leg.legId,
      clientOrderId: ownerRequest.leg.clientOrderId,
      attempt: 0,
      product: fixture.product,
      accountRealmId: policyLeg.accountRealmId,
      symbol: binding.ownerPlan.symbol,
      mutationKind: 'PLACE_ORDER',
      contractId: fixture.product === 'SPOT' ? 'SPOT_ORDER_POST' : 'USDM_ORDER_POST',
      contractState: 'CURRENT',
    },
    requestedQuantity: fixture.quantity,
    preflightResult: {
      instrumentRevision: fixture.instrumentRevision,
      sourceEvidenceRevision: fixture.sourceEvidenceRevision,
      requestedPrice: fixture.price,
      validationPrice: fixture.price ?? '100',
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
      capitalMandateRevision: binding.entry.plan.mandateRevision,
      riskVerdictRevision: binding.entry.plan.riskVerdictRevision,
    },
  });
  const persisted = submittingPersisted(input);
  return {
    ...fixture,
    l06Snapshot: persisted.snapshot,
    l06Boundary: evaluateSyntheticSubmissionBoundary(persisted, L06_T0 + 4),
  };
}

function bridgeSpotEvents(events, fixture, binding, stage) {
  const ownerInput = stage === 'ENTRY_SPOT'
    ? binding.entry.ownerBindings.spotOrderTifOwnerInputs[0]
    : deepFreeze(passingPreflight(fixture));
  const result = bindSpotOrderTifCapability(
    ownerInput.registrySnapshot,
    ownerInput.sizingRequest,
  );
  assert.equal(result.ok, true, result.reasonCodes?.join(','));
  return events.map((candidate) => candidate.kind !== 'PREFLIGHT_EVIDENCE'
    ? candidate
    : event(
      'SPOT_ORDER_TIF_PREFLIGHT_EVIDENCE',
      candidate.sequence,
      candidate.occurredAtMs,
      {
        fixtureId: fixture.fixtureId,
        ...ownerInput,
        expectedCapabilityRevision: result.binding.capabilityRevision,
      },
      { sourceSequence: candidate.sourceSequence },
    ));
}

function bookFor(side, price, quantity, fillQuantity) {
  const available = fillQuantity ?? quantity;
  return side === 'BUY'
    ? { bids: [{ price: '98', quantity: '1' }], asks: [{ price, quantity: available }] }
    : { bids: [{ price, quantity: available }], asks: [{ price: '102', quantity: '1' }] };
}

export function makeTwinLegObservation({
  binding,
  ownerRequest,
  stage,
  priorSpotObservation = null,
  ownerState = null,
  modeProjection = null,
  localMode = 'OBSERVED',
  fillQuantity,
  fixtureId,
} = {}) {
  fixtureCounter += 1;
  const terms = stageTerms(binding, stage);
  const quantity = String(ownerRequest.leg.quantity);
  const id = fixtureId ?? `fixture-l09-${stage.toLowerCase()}-${fixtureCounter}`;
  let fixture = orderFixture({
    fixtureId: id,
    product: terms.product,
    side: terms.side,
    orderType: 'LIMIT',
    timeInForce: 'GTC',
    price: terms.price,
    quantity,
  });
  fixture = attachAliasedL06(fixture, binding, ownerRequest);
  const book = bookFor(terms.side, terms.price, quantity, fillQuantity);
  let events = baselineEvents(fixture, {
    ...book,
    includePrivate: false,
    httpOutcome: localMode === 'AMBIGUOUS' ? 'TIMEOUT' : 'ACK',
  });
  if (terms.product === 'SPOT') events = bridgeSpotEvents(events, fixture, binding, stage);
  if (localMode === 'REJECTED') {
    events = events.map((candidate) => candidate.kind !== 'SYMBOL_STATUS'
      ? candidate
      : event('SYMBOL_STATUS', candidate.sequence, candidate.occurredAtMs, {
        ...candidate.payload,
        status: 'HALT',
        evidenceRevision: `normal-basis-halt:${'1'.repeat(24)}`,
      }, { sourceSequence: candidate.sourceSequence }));
  } else if (localMode === 'OBSERVED') {
    const venueEvents = events.filter((candidate) => (
      candidate.kind !== 'HTTP_DELIVERY' && candidate.kind !== 'PRIVATE_DELIVERY'
    ));
    const venueState = runExchangeTwinScenario(scenarioInput({
      fixture,
      events: venueEvents,
      overrides: { scenarioId: `scenario-${id}-venue` },
    }));
    const venueOrder = orderByFixtureId(venueState, id);
    events = [
      ...venueEvents,
      event('PRIVATE_DELIVERY', 7, TWIN_T0 + 20 + fixture.latency.venueToPrivateMs, {
        fixtureId: id,
        venueRevision: venueOrder.venueRevision,
      }),
      event('HTTP_DELIVERY', 8, TWIN_T0 + 20 + fixture.latency.venueToHttpMs, {
        fixtureId: id,
        outcome: 'ACK',
      }),
    ];
  }
  const scenario = scenarioInput({
    fixture,
    events,
    overrides: { scenarioId: `scenario-${id}` },
  });
  const observation = runNormalBasisTwinLeg({
    binding,
    stage,
    ownerRequest,
    scenario,
    priorSpotObservation,
    ownerState,
    positionModeEvidence: terms.product === 'USD_M_PERPETUAL'
      ? positionModeEvidence(modeProjection) : null,
  });
  return { fixture, observation, scenario };
}

export function failure(code) {
  return {
    code,
    message: code,
    retryable: false,
    recommendedOperatorAction: 'Inspect retained synthetic evidence.',
  };
}

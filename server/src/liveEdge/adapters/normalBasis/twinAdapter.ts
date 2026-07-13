import {
  canonicalJson,
  stableHash128Hex,
} from '../../../foundation/contracts/index.js';
import {
  checkpointExchangeTwin,
  compareTwinDecimals,
  restoreExchangeTwin,
  runExchangeTwinScenario,
  subtractTwinDecimals,
  twinDecimal,
} from '../exchangeTwin/index.js';
import {
  validatePrivateTruthProjection,
} from '../binancePrivateTruth/index.js';
import type {
  TwinOrderFixture,
  TwinOrderState,
  TwinScenarioState,
} from '../exchangeTwin/types.js';
import {
  validateNormalBasisFoundationBinding,
} from './binding.js';
import {
  NORMAL_BASIS_POSITION_MODE_EVIDENCE_SCHEMA,
  NORMAL_BASIS_TWIN_OBSERVATION_SCHEMA,
  type NormalBasisFoundationBinding,
  type NormalBasisFoundationLegRequestView,
  type NormalBasisFoundationStateView,
  type NormalBasisLocalDisposition,
  type NormalBasisPositionModeEvidence,
  type NormalBasisTwinLegObservation,
  type NormalBasisTwinStage,
  type RunNormalBasisTwinLegInput,
} from './types.js';

function revision(prefix: string, value: unknown): string {
  return `${prefix}${stableHash128Hex(canonicalJson(value))}`;
}

function exactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError('Foundation quantity projection must be positive and finite');
  }
  const projected = String(value);
  if (Number(projected) !== value) {
    throw new TypeError('Foundation quantity projection did not round-trip through binary64');
  }
  return twinDecimal(projected, 'Foundation quantity projection');
}

function stageTerms(stage: NormalBasisTwinStage): Readonly<{
  phase: 'OPEN' | 'CLOSE';
  key: 'SPOT' | 'PERP';
  product: 'SPOT' | 'USD_M_PERPETUAL';
  side: 'BUY' | 'SELL';
  reduceOnly: boolean;
  riskEffect: 'RISK_INCREASING' | 'RISK_REDUCING';
}> {
  switch (stage) {
    case 'ENTRY_SPOT': return Object.freeze({
      phase: 'OPEN', key: 'SPOT', product: 'SPOT', side: 'BUY',
      reduceOnly: false, riskEffect: 'RISK_INCREASING',
    });
    case 'ENTRY_HEDGE': return Object.freeze({
      phase: 'OPEN', key: 'PERP', product: 'USD_M_PERPETUAL', side: 'SELL',
      reduceOnly: false, riskEffect: 'RISK_INCREASING',
    });
    case 'EXIT_SPOT':
    case 'RECOVERY_CLOSE_SPOT': return Object.freeze({
      phase: 'CLOSE', key: 'SPOT', product: 'SPOT', side: 'SELL',
      reduceOnly: false, riskEffect: 'RISK_REDUCING',
    });
    case 'EXIT_PERP':
    case 'RECOVERY_CLOSE_PERP': return Object.freeze({
      phase: 'CLOSE', key: 'PERP', product: 'USD_M_PERPETUAL', side: 'BUY',
      reduceOnly: true, riskEffect: 'RISK_REDUCING',
    });
  }
}

function expectedPolicyLeg(
  binding: Readonly<NormalBasisFoundationBinding>,
  key: 'SPOT' | 'PERP',
) {
  return key === 'SPOT' ? binding.entry.spotLeg : binding.entry.perpLeg;
}

function expectedOwnerLeg(
  binding: Readonly<NormalBasisFoundationBinding>,
  phase: 'OPEN' | 'CLOSE',
  key: 'SPOT' | 'PERP',
) {
  return phase === 'OPEN'
    ? binding.ownerPlan.openingLegs[key]
    : binding.ownerPlan.closingLegs[key];
}

function validateOwnerRequest(
  binding: Readonly<NormalBasisFoundationBinding>,
  stage: NormalBasisTwinStage,
  request: Readonly<NormalBasisFoundationLegRequestView>,
): void {
  const terms = stageTerms(stage);
  const expected = expectedOwnerLeg(binding, terms.phase, terms.key);
  if (request?.planId !== binding.ownerPlan.planId
    || request.correlationId !== binding.ownerPlan.correlationId
    || request.symbol !== binding.ownerPlan.symbol
    || request.direction !== 'LONG_SPOT_SHORT_PERP'
    || request.mode !== 'PAPER'
    || request.phase !== terms.phase
    || request.leg?.legId !== expected.legId
    || request.leg.key !== terms.key
    || request.leg.phase !== terms.phase
    || request.leg.role !== expected.role
    || request.leg.venue !== expected.venue
    || request.leg.side !== terms.side
    || request.leg.reduceOnly !== terms.reduceOnly
    || request.leg.riskEffect !== terms.riskEffect
    || request.leg.clientOrderId !== expected.clientOrderId
    || request.leg.quantity > expected.quantity
    || request.leg.quantity <= 0) {
    throw new TypeError('normal-Basis Foundation leg request is not exact for the stage');
  }
}

function venueArrivalTime(input: RunNormalBasisTwinLegInput): number {
  const arrivals = input.scenario.events.filter((event) => event.kind === 'VENUE_ARRIVAL');
  if (arrivals.length !== 1) throw new TypeError('normal-Basis scenario requires one venue arrival');
  return arrivals[0]!.occurredAtMs;
}

function validatePositionMode(
  evidence: Readonly<NormalBasisPositionModeEvidence> | null | undefined,
  binding: Readonly<NormalBasisFoundationBinding>,
  atMs: number,
): string {
  if (evidence?.schema !== NORMAL_BASIS_POSITION_MODE_EVIDENCE_SCHEMA
    || evidence.owner !== 'BINANCE_PRIVATE_TRUTH'
    || evidence.sendEligible !== false
    || evidence.actionAuthority !== 'NONE_RECORD_ONLY'
    || evidence.externalActionAuthorization !== 'NONE') {
    throw new TypeError('current one-way USD-M positionSide=BOTH owner evidence is required');
  }
  const projection = validatePrivateTruthProjection(evidence.projection);
  const positionModes = projection.sourceFacts.filter((fact) => (
    fact.product === 'USD_M_PERPETUAL' && fact.factKind === 'USDM_POSITION_MODE'
  ));
  const sideBearingKinds = new Set([
    'USDM_ACCOUNT', 'USDM_POSITIONS', 'USDM_OPEN_ORDERS', 'USDM_TRADES',
  ]);
  const positionRowsExact = projection.sourceFacts.every((fact) => {
    if (fact.product !== 'USD_M_PERPETUAL' || !sideBearingKinds.has(fact.factKind)) return true;
    const value = fact.value as Readonly<Record<string, unknown>> | readonly unknown[];
    const rows = fact.factKind === 'USDM_ACCOUNT'
      ? (value as Readonly<{ positions?: readonly Readonly<{ positionSide?: unknown }>[] }>).positions
      : value as readonly Readonly<{ positionSide?: unknown }>[];
    return Array.isArray(rows) && rows.every((row) => row.positionSide === 'BOTH');
  });
  if (!['USDM_NEW_EXPOSURE', 'SPOT_USDM_NEW_EXPOSURE'].includes(projection.posture)
    || projection.accountRealmId !== binding.entry.perpLeg.accountRealmId
    || projection.targetSymbol !== binding.ownerPlan.symbol
    || projection.evaluatedAtMs > atMs
    || projection.validUntilMs === null || atMs >= projection.validUntilMs
    || projection.permissions.length !== 2
    || projection.permissions.some((decision) => (
      decision.usdmDualSidePosition !== false || decision.acceptableForOwnerReview !== true
    ))
    || positionModes.length !== 1
    || positionModes[0]!.readState !== 'OK'
    || positionModes[0]!.completeness !== 'COMPLETE'
    || positionModes[0]!.usableAsPrivateEvidence !== true
    || positionModes[0]!.validUntilMs === null || atMs >= positionModes[0]!.validUntilMs
    || (positionModes[0]!.value as Readonly<{ dualSidePosition?: unknown }>).dualSidePosition !== false
    || projection.reasonCodes.some((reason) => (
      reason.includes('POSITION_MODE') || reason.includes('POSITION_SIDE')
    ))
    || !positionRowsExact) {
    throw new TypeError('validated L05 projection does not prove current one-way USD-M positionSide=BOTH');
  }
  return projection.projectionRevision;
}

function validateL06Alias(
  binding: Readonly<NormalBasisFoundationBinding>,
  request: Readonly<NormalBasisFoundationLegRequestView>,
  fixture: Readonly<TwinOrderFixture>,
  product: 'SPOT' | 'USD_M_PERPETUAL',
): void {
  const identity = fixture.l06Snapshot.identity;
  const policyLeg = expectedPolicyLeg(binding, request.leg.key);
  if (fixture.l06Boundary.state !== 'SYNTHETIC_OBSERVATION_ELIGIBLE'
    || fixture.l06Boundary.mutationId !== fixture.l06Snapshot.mutationId
    || fixture.l06Boundary.sendAuthorized !== false
    || fixture.l06Snapshot.persistenceProven !== false
    || fixture.l06Snapshot.persistenceAuthority !== 'NONE'
    || fixture.l06Snapshot.actionAuthority !== 'NONE_RECORD_ONLY'
    || fixture.l06Snapshot.externalActionAuthorization !== 'NONE'
    || identity.globalCorrelationId !== binding.ownerPlan.correlationId
    || identity.decisionId !== binding.entry.plan.intentId
    || identity.strategyId !== 'BASIS'
    || identity.proposalId !== binding.ownerPlan.proposal.canonicalProposalId
    || identity.capitalMandateId !== binding.entry.plan.mandateId
    || identity.capitalReservationId !== binding.entry.plan.capitalReservationId
    || identity.ticketId !== binding.ownerPlan.planId
    || identity.legId !== request.leg.legId
    || identity.clientOrderId !== request.leg.clientOrderId
    || identity.attempt !== 0
    || identity.product !== product
    || identity.accountRealmId !== policyLeg.accountRealmId
    || identity.symbol !== binding.ownerPlan.symbol
    || identity.mutationKind !== 'PLACE_ORDER'
    || identity.contractId !== (product === 'SPOT' ? 'SPOT_ORDER_POST' : 'USDM_ORDER_POST')
    || identity.contractState !== 'CURRENT'
    || fixture.l06Snapshot.bindings.instrumentRevision !== fixture.instrumentRevision
    || fixture.l06Snapshot.bindings.sourceEvidenceRevision !== fixture.sourceEvidenceRevision
    || fixture.l06Snapshot.bindings.preflightResultQuantity !== fixture.quantity
    || fixture.l06Snapshot.bindings.capitalMandateRevision !== binding.entry.plan.mandateRevision
    || fixture.l06Snapshot.bindings.riskVerdictRevision !== binding.entry.plan.riskVerdictRevision) {
    throw new TypeError('normal-Basis L06 mutation identity/evidence alias is not exact');
  }
}

function nonNegativeOwnerQuantity(value: number, label: string): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite Foundation quantity`);
  }
  const projected = String(value);
  if (Number(projected) !== value) {
    throw new TypeError(`${label} did not round-trip through binary64`);
  }
  return twinDecimal(projected, label);
}

function ownerResidual(
  binding: Readonly<NormalBasisFoundationBinding>,
  request: Readonly<NormalBasisFoundationLegRequestView>,
  state: Readonly<NormalBasisFoundationStateView> | null | undefined,
): Readonly<{ quantity: string; stateRevision: string }> {
  if (state === null || state === undefined
    || canonicalJson(state.plan) !== canonicalJson(binding.ownerPlan)
    || !['HEDGED_OPEN', 'ONE_LEG_EXPOSED', 'RECOVERY_REQUIRED', 'CLOSING'].includes(state.lifecycle)
    || !Number.isSafeInteger(state.revision) || state.revision <= 0
    || typeof state.stateRevisionId !== 'string' || !state.stateRevisionId.startsWith('rev_')) {
    throw new TypeError('canonical Foundation state is required to size a close/recovery leg');
  }
  for (const key of ['SPOT', 'PERP'] as const) {
    if (canonicalJson(state.openingLegs?.[key]?.definition)
        !== canonicalJson(binding.ownerPlan.openingLegs[key])
      || canonicalJson(state.closingLegs?.[key]?.definition)
        !== canonicalJson(binding.ownerPlan.closingLegs[key])) {
      throw new TypeError('Foundation residual evidence carries a different leg definition');
    }
    const opened = nonNegativeOwnerQuantity(
      state.openingLegs[key].cumulativeFilledQuantity,
      `Foundation ${key} opening fill`,
    );
    const closed = nonNegativeOwnerQuantity(
      state.closingLegs[key].cumulativeFilledQuantity,
      `Foundation ${key} closing fill`,
    );
    if (compareTwinDecimals(closed, opened) > 0) {
      throw new TypeError('Foundation close fill exceeds its confirmed opening fill');
    }
  }
  const key = request.leg.key;
  const opened = nonNegativeOwnerQuantity(
    state.openingLegs[key].cumulativeFilledQuantity,
    `Foundation ${key} opening fill`,
  );
  const closed = nonNegativeOwnerQuantity(
    state.closingLegs[key].cumulativeFilledQuantity,
    `Foundation ${key} closing fill`,
  );
  const quantity = subtractTwinDecimals(opened, closed);
  if (quantity === '0') throw new TypeError('Foundation residual is already flat');
  return Object.freeze({ quantity, stateRevision: state.stateRevisionId });
}

function expectedQuantity(input: RunNormalBasisTwinLegInput): Readonly<{
  quantity: string;
  ownerStateRevision: string | null;
  priorObservationRevision: string | null;
}> {
  const requestQuantity = exactNumber(input.ownerRequest.leg.quantity);
  if (input.stage === 'ENTRY_SPOT') {
    if (requestQuantity !== input.binding.entry.spotAction.quantity) {
      throw new TypeError('Spot entry quantity changed after accepted policy');
    }
    if (input.ownerState !== null && input.ownerState !== undefined
      || input.priorSpotObservation !== null && input.priorSpotObservation !== undefined) {
      throw new TypeError('Spot entry must not carry residual or prior-fill evidence');
    }
    return Object.freeze({
      quantity: requestQuantity,
      ownerStateRevision: null,
      priorObservationRevision: null,
    });
  }
  if (input.stage === 'ENTRY_HEDGE') {
    const spot = input.priorSpotObservation === null || input.priorSpotObservation === undefined
      ? null : validateNormalBasisTwinLegObservation(
        input.priorSpotObservation,
        input.binding,
      );
    if (spot?.foundationBindingRevision !== input.binding.foundationBindingRevision
      || spot.stage !== 'ENTRY_SPOT'
      || spot.policyPlanId !== input.binding.entry.plan.planId
      || spot.foundationPlanId !== input.binding.ownerPlan.planId
      || spot.policyLegId !== input.binding.entry.spotLeg.legId
      || spot.foundationLegId !== input.binding.ownerPlan.openingLegs.SPOT.legId
      || spot.deterministicClientOrderId !== input.binding.ownerPlan.openingLegs.SPOT.clientOrderId
      || spot.product !== 'SPOT' || spot.side !== 'BUY' || spot.reduceOnly !== false
      || !['PARTIALLY_FILLED', 'FILLED'].includes(spot.localDisposition)
      || compareTwinDecimals(spot.confirmedFilledQuantity, '0') <= 0
      || requestQuantity !== spot.confirmedFilledQuantity) {
      throw new TypeError('USD-M hedge quantity must equal confirmed Spot fill');
    }
    if (input.ownerState !== null && input.ownerState !== undefined) {
      throw new TypeError('entry hedge must not carry close residual evidence');
    }
    return Object.freeze({
      quantity: requestQuantity,
      ownerStateRevision: null,
      priorObservationRevision: spot.observationRevision,
    });
  }
  if (input.priorSpotObservation !== null && input.priorSpotObservation !== undefined) {
    throw new TypeError('close/recovery leg must use canonical owner residual state');
  }
  const residual = ownerResidual(input.binding, input.ownerRequest, input.ownerState);
  if (residual.quantity !== requestQuantity) {
    throw new TypeError('close/recovery quantity must equal confirmed residual owner truth');
  }
  return Object.freeze({
    quantity: requestQuantity,
    ownerStateRevision: residual.stateRevision,
    priorObservationRevision: null,
  });
}

function validateScenario(
  input: RunNormalBasisTwinLegInput,
  fixture: Readonly<TwinOrderFixture>,
  quantity: string,
): void {
  const terms = stageTerms(input.stage);
  const policyAction = terms.key === 'SPOT'
    ? input.binding.entry.spotAction
    : input.binding.entry.perpAction;
  if (input.scenario.product !== terms.product
    || input.scenario.symbol !== input.binding.ownerPlan.symbol
    || input.scenario.fixtures.length !== 1
    || fixture.product !== terms.product
    || fixture.symbol !== input.binding.ownerPlan.symbol
    || fixture.side !== terms.side
    || fixture.orderType !== 'LIMIT'
    || fixture.timeInForce !== 'GTC'
    || fixture.quantity !== quantity
    || fixture.simulationAuthority !== 'SYNTHETIC_FIXTURE'
    || fixture.actionAuthority !== 'NONE_RECORD_ONLY'
    || fixture.externalActionAuthorization !== 'NONE') {
    throw new TypeError('normal-Basis twin fixture does not match the owner leg request');
  }
  if ((input.stage === 'ENTRY_SPOT' || input.stage === 'ENTRY_HEDGE')
    && fixture.price !== policyAction.price) {
    throw new TypeError('entry twin price changed after accepted policy');
  }
  if (terms.product === 'SPOT') {
    const ownerEvidenceEvents = input.scenario.events.filter((event) => (
      event.kind === 'SPOT_ORDER_TIF_PREFLIGHT_EVIDENCE'
        && event.payload.fixtureId === fixture.fixtureId
    ));
    if (ownerEvidenceEvents.length !== 1) {
      throw new TypeError('Spot LIMIT/GTC requires exactly one accepted L08.2 owner-evidence event');
    }
  }
}

function validateSpotOwnerEvidence(
  state: Readonly<TwinScenarioState>,
  fixture: Readonly<TwinOrderFixture>,
  binding: Readonly<NormalBasisFoundationBinding>,
  stage: NormalBasisTwinStage,
): void {
  if (fixture.product !== 'SPOT') return;
  const retained = state.preflights.filter((candidate) => (
    candidate.fixtureId === fixture.fixtureId
  ));
  const ownerEvidence = retained[0];
  if (retained.length !== 1 || ownerEvidence === undefined
    || !('ownerEvidenceKind' in ownerEvidence)
    || ownerEvidence.ownerEvidenceKind !== 'L081_SPOT_LIMIT_TIF'
    || !ownerEvidence.result.ok) {
    throw new TypeError('Spot twin did not retain exactly one accepted L08.1 owner result');
  }
  if (stage === 'ENTRY_SPOT'
    && ownerEvidence.expectedCapabilityRevision
      !== binding.entry.spotCapability.capabilityRevision) {
    throw new TypeError('Spot entry twin capability revision differs from accepted policy');
  }
}

function classify(order: Readonly<TwinOrderState>, orderingAmbiguous: boolean): NormalBasisLocalDisposition {
  if (orderingAmbiguous || order.localTruth === 'UNKNOWN' || order.localTruth === 'RECOVERY_REQUIRED') {
    return 'AMBIGUOUS';
  }
  if (order.venueStatus === 'BLOCKED') return 'REJECTED';
  if (order.localTruth !== 'OBSERVED' || order.localObservedVenueStatus !== order.venueStatus) {
    return 'ACKNOWLEDGED';
  }
  if (order.venueStatus === 'FILLED') return 'FILLED';
  if (order.venueStatus === 'PARTIALLY_FILLED') return 'PARTIALLY_FILLED';
  if ((order.venueStatus === 'CANCELED' || order.venueStatus === 'EXPIRED')
    && compareTwinDecimals(order.filledQuantity, '0') > 0) return 'PARTIALLY_FILLED';
  if (order.venueStatus === 'CANCELED' || order.venueStatus === 'EXPIRED') return 'TERMINAL_NO_FILL';
  return 'ACKNOWLEDGED';
}

/** Revalidates the retained L07 state and every derived observation summary. */
export function validateNormalBasisTwinLegObservation(
  value: Readonly<NormalBasisTwinLegObservation>,
  bindingValue: Readonly<NormalBasisFoundationBinding>,
): Readonly<NormalBasisTwinLegObservation> {
  const binding = validateNormalBasisFoundationBinding(bindingValue);
  if (value?.schema !== NORMAL_BASIS_TWIN_OBSERVATION_SCHEMA
    || value.sendEligible !== false
    || value.actionAuthority !== 'NONE_RECORD_ONLY'
    || value.externalActionAuthorization !== 'NONE'
    || value.simulationAuthority !== 'SYNTHETIC_FIXTURE'
    || value.lifecycleAuthority !== 'FOUNDATION_EXECUTION'
    || value.reconciliationAuthority !== 'FOUNDATION_RECONCILIATION'
    || value.evidenceAuthority !== 'ADAPTER_EVIDENCE_ONLY') {
    throw new TypeError('normal-Basis observation contract mismatch');
  }
  const restored = restoreExchangeTwin(checkpointExchangeTwin(value.state));
  if (canonicalJson(restored) !== canonicalJson(value.state)) {
    throw new TypeError('normal-Basis observation retained a non-canonical twin state');
  }
  const order = restored.orders.find((candidate) => (
    candidate.fixture.fixtureId === value.twinFixtureId
  ));
  if (order === undefined || canonicalJson(order) !== canonicalJson(value.order)) {
    throw new TypeError('normal-Basis observation order is not retained by its twin state');
  }
  const terms = stageTerms(value.stage);
  const policyLeg = expectedPolicyLeg(binding, terms.key);
  const ownerLeg = expectedOwnerLeg(binding, terms.phase, terms.key);
  const requestedQuantity = twinDecimal(value.requestedQuantity, 'observation requested quantity');
  const requestedQuantityNumber = Number(requestedQuantity);
  if (requestedQuantity !== value.requestedQuantity
    || exactNumber(requestedQuantityNumber) !== requestedQuantity) {
    throw new TypeError('normal-Basis observation quantity is not an exact Foundation projection');
  }
  const ownerRequest = Object.freeze({
    planId: binding.ownerPlan.planId,
    correlationId: binding.ownerPlan.correlationId,
    symbol: binding.ownerPlan.symbol,
    direction: binding.ownerPlan.direction,
    mode: binding.ownerPlan.mode,
    phase: terms.phase,
    leg: Object.freeze({ ...ownerLeg, quantity: requestedQuantityNumber }),
  });
  validateOwnerRequest(binding, value.stage, ownerRequest);
  const retainedScenario = Object.freeze({
    schema: 'TWIN_SCENARIO_INPUT_V1' as const,
    scenarioId: 'normal-basis-retained-observation',
    modelRevision: restored.modelRevision,
    seed: restored.seed,
    product: restored.product,
    symbol: restored.symbol,
    fixtures: Object.freeze(restored.orders.map((candidate) => candidate.fixture)),
    events: Object.freeze(restored.processedEvents.map((candidate) => candidate.event)),
  });
  const retainedInput: Readonly<RunNormalBasisTwinLegInput> = Object.freeze({
    binding,
    stage: value.stage,
    ownerRequest,
    scenario: retainedScenario,
    priorSpotObservation: value.priorSpotObservationEvidence,
    ownerState: value.ownerStateEvidence,
    positionModeEvidence: value.positionModeEvidence,
  });
  validateScenario(retainedInput, order.fixture, requestedQuantity);
  validateL06Alias(binding, ownerRequest, order.fixture, terms.product);
  validateSpotOwnerEvidence(restored, order.fixture, binding, value.stage);
  if (value.stage === 'ENTRY_SPOT'
    && requestedQuantity !== binding.entry.spotAction.quantity) {
    throw new TypeError('retained Spot entry quantity changed after accepted policy');
  }

  let expectedPositionModeRevision: string | null = null;
  if (terms.product === 'USD_M_PERPETUAL') {
    if (order.venueArrivalAtMs === null) {
      throw new TypeError('USD-M observation omitted its venue-arrival time');
    }
    expectedPositionModeRevision = validatePositionMode(
      value.positionModeEvidence,
      binding,
      order.venueArrivalAtMs,
    );
  } else if (value.positionModeEvidence !== null) {
    throw new TypeError('Spot observation must not retain USD-M position-mode evidence');
  }

  let expectedPriorObservationRevision: string | null = null;
  if (value.stage === 'ENTRY_HEDGE') {
    const priorValue = value.priorSpotObservationEvidence;
    if (priorValue === null || priorValue.stage !== 'ENTRY_SPOT') {
      throw new TypeError('hedge observation omitted its exact prior Spot-fill evidence');
    }
    const prior = validateNormalBasisTwinLegObservation(priorValue, binding);
    if (!['PARTIALLY_FILLED', 'FILLED'].includes(prior.localDisposition)
      || compareTwinDecimals(prior.confirmedFilledQuantity, '0') <= 0
      || prior.confirmedFilledQuantity !== requestedQuantity) {
      throw new TypeError('hedge observation is not sized by its retained prior Spot fill');
    }
    expectedPriorObservationRevision = prior.observationRevision;
  } else if (value.priorSpotObservationEvidence !== null) {
    throw new TypeError('only the hedge may retain prior Spot-fill evidence');
  }

  let expectedOwnerStateRevision: string | null = null;
  if (value.stage.startsWith('EXIT_') || value.stage.startsWith('RECOVERY_CLOSE_')) {
    const ownerEvidence = ownerResidual(binding, ownerRequest, value.ownerStateEvidence);
    if (ownerEvidence.quantity !== requestedQuantity) {
      throw new TypeError('close observation differs from retained Foundation residual truth');
    }
    expectedOwnerStateRevision = ownerEvidence.stateRevision;
  } else if (value.ownerStateEvidence !== null) {
    throw new TypeError('entry observation must not retain close residual evidence');
  }

  const localDisposition = classify(order, restored.orderingTruth === 'AMBIGUOUS');
  const locallyConfirmed = order.localTruth === 'OBSERVED'
    && order.localObservedVenueStatus === order.venueStatus
    && localDisposition !== 'AMBIGUOUS';
  const confirmedFilledQuantity = locallyConfirmed ? order.filledQuantity : '0';
  const terminalStatus = order.venueStatus === 'CANCELED' || order.venueStatus === 'EXPIRED'
    ? order.venueStatus : null;
  if (value.foundationBindingRevision !== binding.foundationBindingRevision
    || value.policyPlanId !== binding.entry.plan.planId
    || value.policyLegId !== policyLeg.legId
    || value.foundationPlanId !== binding.ownerPlan.planId
    || value.foundationPlanId !== order.fixture.l06Snapshot.identity.ticketId
    || value.foundationLegId !== ownerLeg.legId
    || value.foundationLegId !== order.fixture.l06Snapshot.identity.legId
    || value.l06MutationId !== order.fixture.l06Snapshot.mutationId
    || value.deterministicClientOrderId !== ownerLeg.clientOrderId
    || value.deterministicClientOrderId !== order.fixture.l06Snapshot.identity.clientOrderId
    || value.product !== terms.product || value.product !== order.fixture.product
    || value.side !== terms.side || value.side !== order.fixture.side
    || value.reduceOnly !== terms.reduceOnly
    || value.positionSide !== (terms.product === 'USD_M_PERPETUAL' ? 'BOTH' : null)
    || value.positionModeProjectionRevision !== expectedPositionModeRevision
    || value.priorObservationRevision !== expectedPriorObservationRevision
    || value.ownerStateRevision !== expectedOwnerStateRevision
    || value.requestedQuantity !== order.fixture.quantity
    || value.venueFilledQuantity !== order.filledQuantity
    || value.confirmedFilledQuantity !== confirmedFilledQuantity
    || value.remainingQuantity !== order.remainingQuantity
    || value.expiredQuantity !== order.expiredQuantity
    || value.venueStatus !== order.venueStatus
    || value.localTruth !== order.localTruth
    || value.localDisposition !== localDisposition
    || value.terminalStatus !== terminalStatus
    || value.ambiguityVisible !== (localDisposition === 'AMBIGUOUS')
    || value.recoveryRequired !== (order.recoveryRequired || localDisposition === 'AMBIGUOUS')
    || canonicalJson(value.blockedReasonCodes) !== canonicalJson(order.blockedReasonCodes)
    || value.twinOutcomeRevision !== restored.outcomeRevision) {
    throw new TypeError('normal-Basis observation summary diverges from retained twin truth');
  }
  const {
    schema: _schema,
    observationRevision,
    ...material
  } = value;
  if (observationRevision !== revision('l09observation_', material)) {
    throw new TypeError('normal-Basis observation revision mismatch');
  }
  return value;
}

/**
 * Runs exactly one accepted L07 product scenario. Foundation remains the
 * lifecycle owner; this function returns immutable comparison evidence only.
 */
export function runNormalBasisTwinLeg(
  input: Readonly<RunNormalBasisTwinLegInput>,
): Readonly<NormalBasisTwinLegObservation> {
  const binding = validateNormalBasisFoundationBinding(input.binding);
  validateOwnerRequest(binding, input.stage, input.ownerRequest);
  const terms = stageTerms(input.stage);
  const quantityEvidence = expectedQuantity(input);
  const quantity = quantityEvidence.quantity;
  const atMs = venueArrivalTime(input);
  let positionModeProjectionRevision: string | null = null;
  if (terms.product === 'USD_M_PERPETUAL') {
    positionModeProjectionRevision = validatePositionMode(input.positionModeEvidence, binding, atMs);
  } else if (input.positionModeEvidence !== null && input.positionModeEvidence !== undefined) {
    throw new TypeError('Spot leg must not carry USD-M position-mode evidence');
  }
  const fixture = input.scenario.fixtures[0];
  if (fixture === undefined) throw new TypeError('normal-Basis scenario fixture is missing');
  validateScenario(input, fixture, quantity);
  validateL06Alias(binding, input.ownerRequest, fixture, terms.product);
  const state = runExchangeTwinScenario(input.scenario);
  const order = state.orders.find((candidate) => candidate.fixture.fixtureId === fixture.fixtureId);
  if (order === undefined) throw new TypeError('normal-Basis twin result omitted its exact fixture');
  validateSpotOwnerEvidence(state, fixture, binding, input.stage);
  const localDisposition = classify(order, state.orderingTruth === 'AMBIGUOUS');
  const locallyConfirmed = order.localTruth === 'OBSERVED'
    && order.localObservedVenueStatus === order.venueStatus
    && localDisposition !== 'AMBIGUOUS';
  const confirmedFilledQuantity = locallyConfirmed ? order.filledQuantity : '0';
  const alias = binding.aliases.find((candidate) => candidate.product === terms.product);
  if (alias === undefined) throw new TypeError('normal-Basis alias is missing');
  const material = {
    foundationBindingRevision: binding.foundationBindingRevision,
    stage: input.stage,
    policyPlanId: binding.entry.plan.planId,
    foundationPlanId: binding.ownerPlan.planId,
    policyLegId: alias.policyLegId,
    foundationLegId: input.ownerRequest.leg.legId,
    l06MutationId: fixture.l06Snapshot.mutationId,
    twinFixtureId: fixture.fixtureId,
    deterministicClientOrderId: input.ownerRequest.leg.clientOrderId,
    product: terms.product,
    side: terms.side,
    reduceOnly: terms.reduceOnly,
    positionSide: terms.product === 'USD_M_PERPETUAL' ? ('BOTH' as const) : null,
    positionModeProjectionRevision,
    positionModeEvidence: input.positionModeEvidence ?? null,
    ownerStateRevision: quantityEvidence.ownerStateRevision,
    ownerStateEvidence: input.ownerState ?? null,
    priorObservationRevision: quantityEvidence.priorObservationRevision,
    priorSpotObservationEvidence: input.priorSpotObservation ?? null,
    requestedQuantity: quantity,
    venueFilledQuantity: order.filledQuantity,
    confirmedFilledQuantity,
    remainingQuantity: order.remainingQuantity,
    expiredQuantity: order.expiredQuantity,
    venueStatus: order.venueStatus,
    localTruth: order.localTruth,
    localDisposition,
    terminalStatus: order.venueStatus === 'CANCELED' || order.venueStatus === 'EXPIRED'
      ? order.venueStatus : null,
    ambiguityVisible: localDisposition === 'AMBIGUOUS',
    recoveryRequired: order.recoveryRequired || localDisposition === 'AMBIGUOUS',
    blockedReasonCodes: order.blockedReasonCodes,
    twinOutcomeRevision: state.outcomeRevision,
    state,
    order,
    lifecycleAuthority: 'FOUNDATION_EXECUTION' as const,
    reconciliationAuthority: 'FOUNDATION_RECONCILIATION' as const,
    evidenceAuthority: 'ADAPTER_EVIDENCE_ONLY' as const,
    simulationAuthority: 'SYNTHETIC_FIXTURE' as const,
    sendEligible: false as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  };
  return Object.freeze({
    schema: NORMAL_BASIS_TWIN_OBSERVATION_SCHEMA,
    ...material,
    observationRevision: revision('l09observation_', material),
  });
}

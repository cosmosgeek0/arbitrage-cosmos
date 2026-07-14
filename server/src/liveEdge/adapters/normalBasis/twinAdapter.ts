import {
  canonicalJson,
  stableHash128Hex,
} from '../../../foundation/contracts/index.js';
import {
  addTwinDecimals,
  checkpointExchangeTwin,
  compareTwinDecimals,
  restoreExchangeTwin,
  runExchangeTwinScenario,
  signedTwinResidual,
  subtractTwinDecimals,
  twinDecimal,
  validateExchangeTwinRequestSemanticEvidence,
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
  cloneFreezeNormalBasis,
  hydrateNormalBasisOwnerCheckpoint,
  type HydratedNormalBasisOwnerCheckpoint,
} from './ownerCheckpoint.js';
import {
  NORMAL_BASIS_POSITION_MODE_EVIDENCE_SCHEMA,
  NORMAL_BASIS_TWIN_OBSERVATION_SCHEMA,
  type NormalBasisFoundationBinding,
  type NormalBasisFoundationLegRequestView,
  type NormalBasisLocalDisposition,
  type NormalBasisMutationLineage,
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

function enforceEntryExpiry(
  binding: Readonly<NormalBasisFoundationBinding>,
  stage: NormalBasisTwinStage,
  arrivalAtMs: number,
): void {
  if (stage !== 'ENTRY_SPOT' && stage !== 'ENTRY_HEDGE') return;
  if (arrivalAtMs >= binding.entry.plan.expiresAtMs
    || arrivalAtMs >= binding.ownerPlan.proposal.expiresAtMs) {
    throw new TypeError('normal-Basis entry venue arrival is at or after accepted policy/proposal expiry');
  }
}

function validatePrivateTruthEvidence(
  evidence: Readonly<NormalBasisPositionModeEvidence> | null | undefined,
  binding: Readonly<NormalBasisFoundationBinding>,
  product: 'SPOT' | 'USD_M_PERPETUAL',
  stage: NormalBasisTwinStage,
  checkpoint: Readonly<HydratedNormalBasisOwnerCheckpoint>,
  atMs: number,
): Readonly<{
  projectionRevision: string;
  reconciliationResultRevision: string;
}> {
  if (evidence?.schema !== NORMAL_BASIS_POSITION_MODE_EVIDENCE_SCHEMA
    || evidence.owner !== 'BINANCE_PRIVATE_TRUTH'
    || evidence.sendEligible !== false
    || evidence.actionAuthority !== 'NONE_RECORD_ONLY'
    || evidence.externalActionAuthorization !== 'NONE') {
    throw new TypeError('current L05 private-truth owner evidence is required');
  }
  const projection = validatePrivateTruthProjection(evidence.projection);
  const policyLeg = product === 'SPOT' ? binding.entry.spotLeg : binding.entry.perpLeg;
  if (projection.accountRealmId !== policyLeg.accountRealmId
    || projection.targetSymbol !== binding.ownerPlan.symbol
    || projection.evaluatedAtMs > atMs
    || projection.validUntilMs === null || atMs >= projection.validUntilMs
    || projection.reconciliationObservation?.owner !== 'FOUNDATION_RECONCILIATION'
    || projection.reconciliationObservation.status !== 'EXACT'
    || projection.reconciliationObservation.executionAuthority !== 'NONE'
    || typeof projection.reconciliationObservation.resultRevision !== 'string'
    || projection.reconciliationObservation.resultRevision.length === 0) {
    throw new TypeError('validated L05 projection is not current owner evidence for this leg');
  }
  if (product === 'SPOT') {
    if (!['SPOT_NEW_EXPOSURE', 'SPOT_USDM_NEW_EXPOSURE'].includes(projection.posture)) {
      throw new TypeError('validated L05 projection does not prove the Spot account realm');
    }
    return Object.freeze({
      projectionRevision: projection.projectionRevision,
      reconciliationResultRevision: projection.reconciliationObservation.resultRevision,
    });
  }
  const positionModes = projection.sourceFacts.filter((fact) => (
    fact.product === 'USD_M_PERPETUAL' && fact.factKind === 'USDM_POSITION_MODE'
  ));
  const sideBearingKinds = new Set([
    'USDM_ACCOUNT', 'USDM_POSITIONS', 'USDM_OPEN_ORDERS',
    'USDM_ALGO_OPEN_ORDERS', 'USDM_TRADES',
  ]);
  const positionRowsExact = projection.sourceFacts.every((fact) => {
    if (fact.product !== 'USD_M_PERPETUAL' || !sideBearingKinds.has(fact.factKind)) return true;
    if (!fact.usableAsPrivateEvidence || fact.value === null) return true;
    const value = fact.value as Readonly<Record<string, unknown>> | readonly unknown[];
    const rows = fact.factKind === 'USDM_ACCOUNT'
      ? (value as Readonly<{ positions?: readonly Readonly<{ positionSide?: unknown }>[] }>).positions
      : value as readonly Readonly<{ positionSide?: unknown }>[];
    return Array.isArray(rows) && rows.every((row) => row.positionSide === 'BOTH');
  });
  if (!['USDM_NEW_EXPOSURE', 'SPOT_USDM_NEW_EXPOSURE'].includes(projection.posture)
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

  const exactCurrentFact = (factKind: string, queryScope: 'ACCOUNT_WIDE' | 'ALL_SYMBOLS') => {
    const matches = projection.sourceFacts.filter((fact) => (
      fact.product === 'USD_M_PERPETUAL' && fact.factKind === factKind
    ));
    if (matches.length !== 1) {
      throw new TypeError(`validated L05 projection requires exactly one ${factKind} fact`);
    }
    const fact = matches[0]!;
    if (fact.readState !== 'OK'
      || fact.completeness !== 'COMPLETE'
      || fact.usableAsPrivateEvidence !== true
      || fact.validUntilMs === null || atMs >= fact.validUntilMs
      || fact.accountRealmId !== policyLeg.accountRealmId
      || fact.queryScope !== queryScope
      || fact.querySymbol !== null
      || fact.queryCoverage.kind !== 'CURRENT_UNFILTERED') {
      throw new TypeError(`validated L05 projection does not prove a current complete ${factKind} cut`);
    }
    return fact;
  };

  const accountFact = exactCurrentFact('USDM_ACCOUNT', 'ACCOUNT_WIDE');
  const positionsFact = exactCurrentFact('USDM_POSITIONS', 'ACCOUNT_WIDE');
  const standardOrdersFact = exactCurrentFact('USDM_OPEN_ORDERS', 'ALL_SYMBOLS');
  const algoOrdersFact = exactCurrentFact('USDM_ALGO_OPEN_ORDERS', 'ALL_SYMBOLS');
  const accountPositions = (accountFact.value as Readonly<{
    positions?: readonly Readonly<{
      symbol?: unknown;
      positionSide?: unknown;
      positionAmt?: unknown;
    }>[];
  }>).positions;
  const positions = positionsFact.value as readonly Readonly<{
    symbol?: unknown;
    positionSide?: unknown;
    positionAmt?: unknown;
  }>[];
  const standardOrders = standardOrdersFact.value as readonly Readonly<{
    symbol?: unknown;
  }>[];
  const algoOrders = algoOrdersFact.value as readonly Readonly<{
    symbol?: unknown;
  }>[];
  if (!Array.isArray(accountPositions) || !Array.isArray(positions)
    || !Array.isArray(standardOrders) || !Array.isArray(algoOrders)) {
    throw new TypeError('validated L05 USD-M isolation facts lost their normalized row arrays');
  }
  const targetSymbol = binding.ownerPlan.symbol;
  const targetAccountPositions = accountPositions.filter((row) => row.symbol === targetSymbol);
  const targetPositions = positions.filter((row) => row.symbol === targetSymbol);
  const targetStandardOrders = standardOrders.filter((row) => row.symbol === targetSymbol);
  const targetAlgoOrders = algoOrders.filter((row) => row.symbol === targetSymbol);
  if (targetStandardOrders.length !== 0 || targetAlgoOrders.length !== 0) {
    throw new TypeError('validated L05 projection contains a target-symbol USD-M open order');
  }

  let expectedPositionAmount: string;
  let permitAbsentPosition: boolean;
  if (stage === 'ENTRY_HEDGE') {
    expectedPositionAmount = '0';
    permitAbsentPosition = true;
  } else if (stage === 'EXIT_PERP' || stage === 'RECOVERY_CLOSE_PERP') {
    const opened = nonNegativeOwnerQuantity(
      checkpoint.state.openingLegs.PERP.cumulativeFilledQuantity,
      'Foundation PERP opening fill for private-truth isolation',
    );
    const closed = nonNegativeOwnerQuantity(
      checkpoint.state.closingLegs.PERP.cumulativeFilledQuantity,
      'Foundation PERP closing fill for private-truth isolation',
    );
    if (compareTwinDecimals(closed, opened) >= 0) {
      throw new TypeError('Foundation PERP private-truth isolation residual is not an open short');
    }
    expectedPositionAmount = signedTwinResidual('0', subtractTwinDecimals(opened, closed));
    permitAbsentPosition = false;
  } else {
    throw new TypeError('USD-M private-truth isolation received a non-USD-M stage');
  }
  const exactEndpointPosition = (
    rows: readonly Readonly<{
      positionSide?: unknown;
      positionAmt?: unknown;
    }>[],
  ): boolean => (
    (permitAbsentPosition && rows.length === 0)
    || (rows.length === 1
      && rows[0]!.positionSide === 'BOTH'
      && rows[0]!.positionAmt === expectedPositionAmount)
  );
  if (!exactEndpointPosition(targetAccountPositions)
    || !exactEndpointPosition(targetPositions)) {
    throw new TypeError(
      `validated L05 account and position cuts do not independently prove target position ${expectedPositionAmount}`,
    );
  }
  return Object.freeze({
    projectionRevision: projection.projectionRevision,
    reconciliationResultRevision: projection.reconciliationObservation.resultRevision,
  });
}

function validateL06Alias(
  binding: Readonly<NormalBasisFoundationBinding>,
  request: Readonly<NormalBasisFoundationLegRequestView>,
  fixture: Readonly<TwinOrderFixture>,
  product: 'SPOT' | 'USD_M_PERPETUAL',
): Readonly<NormalBasisMutationLineage> {
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
    || !Number.isSafeInteger(identity.requestSequence)
    || identity.requestSequence <= 0
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
  const lineageMaterial = {
    requestSequence: identity.requestSequence,
    requestId: identity.requestId,
    intentFingerprint: identity.intentFingerprint,
    sanitizedRequestContentHash: fixture.l06Snapshot.bindings.sanitizedRequestContentHash,
    privateProjectionRevision: fixture.l06Snapshot.bindings.privateProjectionRevision,
    foundationReconciliationResultRevision:
      fixture.l06Snapshot.bindings.foundationReconciliationResultRevision,
  };
  return Object.freeze({
    ...lineageMaterial,
    lineageRevision: revision('l09mutationlineage_', lineageMaterial),
  });
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

/**
 * Bridges Foundation's binary64 residual identity to L07 exact-decimal venue
 * quantity without an epsilon. The submitted number must be Foundation's
 * exact raw subtraction; only the downstream decimal representation changes.
 */
export function projectNormalBasisFoundationCloseResidual(
  openedQuantity: number,
  closedQuantity: number,
  submittedQuantity: number,
): string {
  const opened = nonNegativeOwnerQuantity(openedQuantity, 'Foundation opening fill');
  const closed = nonNegativeOwnerQuantity(closedQuantity, 'Foundation closing fill');
  if (compareTwinDecimals(closed, opened) > 0) {
    throw new TypeError('Foundation close fill exceeds its confirmed opening fill');
  }
  const rawResidual = Math.max(0, openedQuantity - closedQuantity);
  if (submittedQuantity !== rawResidual) {
    throw new TypeError('close/recovery quantity must equal confirmed residual owner truth');
  }
  const projected = subtractTwinDecimals(opened, closed);
  if (projected === '0') throw new TypeError('Foundation residual is already flat');
  return projected;
}

function ownerResidual(
  binding: Readonly<NormalBasisFoundationBinding>,
  request: Readonly<NormalBasisFoundationLegRequestView>,
  checkpoint: Readonly<HydratedNormalBasisOwnerCheckpoint>,
): string {
  const state = checkpoint.state;
  if (!['HEDGED_OPEN', 'ONE_LEG_EXPOSED', 'RECOVERY_REQUIRED', 'CLOSING'].includes(state.lifecycle)) {
    throw new TypeError('canonical Foundation checkpoint is not eligible to size a close/recovery leg');
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
  return projectNormalBasisFoundationCloseResidual(
    state.openingLegs[key].cumulativeFilledQuantity,
    state.closingLegs[key].cumulativeFilledQuantity,
    request.leg.quantity,
  );
}

function validateSubmissionCheckpoint(
  input: Readonly<RunNormalBasisTwinLegInput>,
  checkpoint: Readonly<HydratedNormalBasisOwnerCheckpoint>,
): void {
  const terms = stageTerms(input.stage);
  const state = checkpoint.state;
  const leg = terms.phase === 'OPEN'
    ? state.openingLegs[terms.key] : state.closingLegs[terms.key];
  const lastEvent = state.eventLog.at(-1);
  if (leg.lifecycle !== 'SUBMITTING'
    || leg.submittedQuantity !== input.ownerRequest.leg.quantity
    || lastEvent?.type !== 'LEG_SUBMISSION_STARTED'
    || lastEvent.phase !== terms.phase
    || lastEvent.legKey !== terms.key
    || lastEvent.submittedQuantity !== input.ownerRequest.leg.quantity) {
    throw new TypeError('Foundation checkpoint does not prove this exact leg submission cut');
  }
}

function expectedQuantity(
  input: Readonly<RunNormalBasisTwinLegInput>,
  checkpoint: Readonly<HydratedNormalBasisOwnerCheckpoint>,
): string {
  const requestQuantity = exactNumber(input.ownerRequest.leg.quantity);
  validateSubmissionCheckpoint(input, checkpoint);
  if (input.stage === 'ENTRY_SPOT') {
    if (requestQuantity !== input.binding.entry.spotAction.quantity) {
      throw new TypeError('Spot entry quantity changed after accepted policy');
    }
    return requestQuantity;
  }
  if (input.stage === 'ENTRY_HEDGE') {
    const spot = checkpoint.state.openingLegs.SPOT;
    const filled = nonNegativeOwnerQuantity(
      spot.cumulativeFilledQuantity,
      'Foundation terminal Spot opening fill',
    );
    if (!['FILLED', 'CANCELLED'].includes(spot.lifecycle)
      || compareTwinDecimals(filled, '0') <= 0
      || requestQuantity !== filled) {
      throw new TypeError('USD-M hedge quantity must equal terminal owner-checkpoint Spot fill');
    }
    return requestQuantity;
  }
  const residual = ownerResidual(input.binding, input.ownerRequest, checkpoint);
  return residual;
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
  const dispatches = input.scenario.events.filter((event) => (
    event.kind === 'PLACE_DISPATCH'
      && (event.payload as { fixtureId?: unknown }).fixtureId === fixture.fixtureId
  ));
  const dispatchPayload = dispatches[0]?.payload as Readonly<{
    requestEvidence?: unknown;
  }> | undefined;
  if (dispatches.length !== 1 || dispatchPayload?.requestEvidence === undefined) {
    throw new TypeError('normal-Basis requires one L07 request-semantic-bound dispatch');
  }
  const requestEvidence = validateExchangeTwinRequestSemanticEvidence(
    dispatchPayload.requestEvidence,
  );
  if (requestEvidence.product !== terms.product
    || requestEvidence.symbol !== input.binding.ownerPlan.symbol
    || requestEvidence.side !== terms.side
    || requestEvidence.orderType !== 'LIMIT'
    || requestEvidence.timeInForce !== 'GTC'
    || requestEvidence.price !== fixture.price
    || requestEvidence.quantity !== quantity
    || requestEvidence.positionSide !== (terms.product === 'USD_M_PERPETUAL' ? 'BOTH' : null)
    || requestEvidence.reduceOnly !== terms.reduceOnly
    || requestEvidence.clientOrderId !== input.ownerRequest.leg.clientOrderId
    || requestEvidence.requestId !== fixture.l06Snapshot.identity.requestId
    || requestEvidence.requestSequence !== fixture.l06Snapshot.identity.requestSequence
    || requestEvidence.intentFingerprint !== fixture.l06Snapshot.identity.intentFingerprint
    || requestEvidence.sanitizedRequestContentHash
      !== fixture.l06Snapshot.bindings.sanitizedRequestContentHash) {
    throw new TypeError('normal-Basis L07 request semantics do not bind the Foundation leg');
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
  if (order.venueStatus === 'REJECTED') return 'REJECTED';
  if (order.venueStatus === 'FILLED') return 'FILLED';
  if (order.venueStatus === 'PARTIALLY_FILLED') return 'PARTIALLY_FILLED';
  if (['CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH'].includes(order.venueStatus)
    && compareTwinDecimals(order.filledQuantity, '0') > 0) {
    return 'TERMINAL_PARTIALLY_FILLED';
  }
  if (['CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH'].includes(order.venueStatus)) {
    return 'TERMINAL_NO_FILL';
  }
  return 'ACKNOWLEDGED';
}

function terminalStatus(order: Readonly<TwinOrderState>): NormalBasisTwinLegObservation['terminalStatus'] {
  if (order.localTruth !== 'OBSERVED' || order.localObservedVenueStatus !== order.venueStatus) {
    return null;
  }
  return ['CANCELED', 'EXPIRED', 'REJECTED', 'EXPIRED_IN_MATCH'].includes(order.venueStatus)
    ? order.venueStatus as NormalBasisTwinLegObservation['terminalStatus']
    : null;
}

function feeAdjustedConfirmedQuantity(
  order: Readonly<TwinOrderState>,
  locallyConfirmed: boolean,
): Readonly<{
  baseAssetCommissionQuantity: string | null;
  feeAdjustedConfirmedQuantity: string | null;
}> {
  if (!locallyConfirmed || order.filledQuantity === '0') {
    return Object.freeze({
      baseAssetCommissionQuantity: '0',
      feeAdjustedConfirmedQuantity: '0',
    });
  }
  if (order.fixture.product === 'USD_M_PERPETUAL') {
    return Object.freeze({
      baseAssetCommissionQuantity: '0',
      feeAdjustedConfirmedQuantity: order.filledQuantity,
    });
  }
  if (order.fills.some((fill) => (
    fill.feeEvidenceRevision === null || fill.feeAmount === null || fill.feeAsset === null
  ))) {
    return Object.freeze({
      baseAssetCommissionQuantity: null,
      feeAdjustedConfirmedQuantity: null,
    });
  }
  const baseAssetCommissionQuantity = order.fills.reduce((sum, fill) => (
    fill.feeAsset === order.fixture.baseAsset
      ? addTwinDecimals(sum, fill.feeAmount!) : sum
  ), '0');
  const feeAdjusted = order.fixture.side === 'BUY'
    ? subtractTwinDecimals(order.filledQuantity, baseAssetCommissionQuantity)
    : addTwinDecimals(order.filledQuantity, baseAssetCommissionQuantity);
  return Object.freeze({
    baseAssetCommissionQuantity,
    feeAdjustedConfirmedQuantity: feeAdjusted,
  });
}

/** Revalidates the retained L07 state and every derived observation summary. */
export function validateNormalBasisTwinLegObservation(
  value: Readonly<NormalBasisTwinLegObservation>,
  bindingValue: Readonly<NormalBasisFoundationBinding>,
  checkpointHydrator: Readonly<RunNormalBasisTwinLegInput['ownerCheckpointHydrator']>,
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
  const foundationSubmittedQuantity = value.foundationSubmittedQuantity;
  if (requestedQuantity !== value.requestedQuantity
    || typeof foundationSubmittedQuantity !== 'number'
    || !Number.isFinite(foundationSubmittedQuantity)
    || foundationSubmittedQuantity <= 0) {
    throw new TypeError('normal-Basis observation quantity is not a valid Foundation/twin projection');
  }
  const ownerRequest = Object.freeze({
    planId: binding.ownerPlan.planId,
    correlationId: binding.ownerPlan.correlationId,
    symbol: binding.ownerPlan.symbol,
    direction: binding.ownerPlan.direction,
    mode: binding.ownerPlan.mode,
    phase: terms.phase,
    leg: Object.freeze({ ...ownerLeg, quantity: foundationSubmittedQuantity }),
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
    ownerCheckpoint: value.ownerCheckpoint,
    ownerCheckpointHydrator: checkpointHydrator,
    privateTruthEvidence: value.positionModeEvidence,
  });
  const checkpoint = hydrateNormalBasisOwnerCheckpoint(
    binding,
    value.ownerCheckpoint,
    checkpointHydrator,
  );
  if (expectedQuantity(retainedInput, checkpoint) !== requestedQuantity) {
    throw new TypeError('retained Foundation checkpoint sizes a different leg quantity');
  }
  validateScenario(retainedInput, order.fixture, requestedQuantity);
  const mutationLineage = validateL06Alias(binding, ownerRequest, order.fixture, terms.product);
  validateSpotOwnerEvidence(restored, order.fixture, binding, value.stage);
  if (value.stage === 'ENTRY_SPOT'
    && requestedQuantity !== binding.entry.spotAction.quantity) {
    throw new TypeError('retained Spot entry quantity changed after accepted policy');
  }

  const retainedArrivalAtMs = venueArrivalTime(retainedInput);
  if (order.venueArrivalAtMs === null || retainedArrivalAtMs !== order.venueArrivalAtMs) {
    throw new TypeError('normal-Basis observation omitted its venue-arrival time');
  }
  enforceEntryExpiry(binding, value.stage, retainedArrivalAtMs);
  const privateTruth = validatePrivateTruthEvidence(
    value.positionModeEvidence,
    binding,
    terms.product,
    value.stage,
    checkpoint,
    order.venueArrivalAtMs,
  );
  if (mutationLineage.privateProjectionRevision !== privateTruth.projectionRevision
    || mutationLineage.foundationReconciliationResultRevision
      !== privateTruth.reconciliationResultRevision) {
    throw new TypeError('normal-Basis L06 mutation does not bind the retained L05 owner cut');
  }

  const localDisposition = classify(order, restored.orderingTruth === 'AMBIGUOUS');
  const locallyConfirmed = order.localTruth === 'OBSERVED'
    && order.localObservedVenueStatus === order.venueStatus
    && localDisposition !== 'AMBIGUOUS';
  const confirmedFilledQuantity = locallyConfirmed ? order.filledQuantity : '0';
  const feeAdjusted = feeAdjustedConfirmedQuantity(order, locallyConfirmed);
  const retainedTerminalStatus = terminalStatus(order);
  if (value.foundationBindingRevision !== binding.foundationBindingRevision
    || value.policyPlanId !== binding.entry.plan.planId
    || value.policyLegId !== policyLeg.legId
    || value.foundationPlanId !== binding.ownerPlan.planId
    || value.foundationPlanId !== order.fixture.l06Snapshot.identity.ticketId
    || value.foundationLegId !== ownerLeg.legId
    || value.foundationLegId !== order.fixture.l06Snapshot.identity.legId
    || value.l06MutationId !== order.fixture.l06Snapshot.mutationId
    || canonicalJson(value.mutationLineage) !== canonicalJson(mutationLineage)
    || value.deterministicClientOrderId !== ownerLeg.clientOrderId
    || value.deterministicClientOrderId !== order.fixture.l06Snapshot.identity.clientOrderId
    || value.product !== terms.product || value.product !== order.fixture.product
    || value.side !== terms.side || value.side !== order.fixture.side
    || value.reduceOnly !== terms.reduceOnly
    || value.positionSide !== (terms.product === 'USD_M_PERPETUAL' ? 'BOTH' : null)
    || value.positionModeProjectionRevision !== privateTruth.projectionRevision
    || canonicalJson(value.positionModeEvidence) !== canonicalJson(retainedInput.privateTruthEvidence)
    || value.ownerCheckpoint !== checkpoint.serialized
    || value.ownerCheckpointChecksum !== checkpoint.checksum
    || value.ownerCheckpointRevision !== checkpoint.checkpointRevision
    || value.ownerStateRevision !== checkpoint.state.stateRevisionId
    || value.ownerStateLifecycle !== checkpoint.state.lifecycle
    || value.ownerStateLastSequence !== checkpoint.state.lastSequence
    || value.foundationSubmittedQuantity !== foundationSubmittedQuantity
    || value.requestedQuantity !== order.fixture.quantity
    || value.venueFilledQuantity !== order.filledQuantity
    || value.confirmedFilledQuantity !== confirmedFilledQuantity
    || value.baseAssetCommissionQuantity !== feeAdjusted.baseAssetCommissionQuantity
    || value.feeAdjustedConfirmedQuantity !== feeAdjusted.feeAdjustedConfirmedQuantity
    || value.remainingQuantity !== order.remainingQuantity
    || value.expiredQuantity !== order.expiredQuantity
    || value.venueStatus !== order.venueStatus
    || value.localTruth !== order.localTruth
    || value.localDisposition !== localDisposition
    || value.terminalStatus !== retainedTerminalStatus
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
  const checkpoint = hydrateNormalBasisOwnerCheckpoint(
    binding,
    input.ownerCheckpoint,
    input.ownerCheckpointHydrator,
  );
  const quantity = expectedQuantity(input, checkpoint);
  const atMs = venueArrivalTime(input);
  enforceEntryExpiry(binding, input.stage, atMs);
  const privateTruth = validatePrivateTruthEvidence(
    input.privateTruthEvidence,
    binding,
    terms.product,
    input.stage,
    checkpoint,
    atMs,
  );
  const fixture = input.scenario.fixtures[0];
  if (fixture === undefined) throw new TypeError('normal-Basis scenario fixture is missing');
  validateScenario(input, fixture, quantity);
  const mutationLineage = validateL06Alias(
    binding,
    input.ownerRequest,
    fixture,
    terms.product,
  );
  if (mutationLineage.privateProjectionRevision !== privateTruth.projectionRevision
    || mutationLineage.foundationReconciliationResultRevision
      !== privateTruth.reconciliationResultRevision) {
    throw new TypeError('normal-Basis L06 mutation does not bind the supplied L05 owner cut');
  }
  const state = runExchangeTwinScenario(input.scenario);
  const order = state.orders.find((candidate) => candidate.fixture.fixtureId === fixture.fixtureId);
  if (order === undefined) throw new TypeError('normal-Basis twin result omitted its exact fixture');
  validateSpotOwnerEvidence(state, fixture, binding, input.stage);
  const localDisposition = classify(order, state.orderingTruth === 'AMBIGUOUS');
  const locallyConfirmed = order.localTruth === 'OBSERVED'
    && order.localObservedVenueStatus === order.venueStatus
    && localDisposition !== 'AMBIGUOUS';
  const confirmedFilledQuantity = locallyConfirmed ? order.filledQuantity : '0';
  const feeAdjusted = feeAdjustedConfirmedQuantity(order, locallyConfirmed);
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
    mutationLineage,
    twinFixtureId: fixture.fixtureId,
    deterministicClientOrderId: input.ownerRequest.leg.clientOrderId,
    product: terms.product,
    side: terms.side,
    reduceOnly: terms.reduceOnly,
    positionSide: terms.product === 'USD_M_PERPETUAL' ? ('BOTH' as const) : null,
    positionModeProjectionRevision: privateTruth.projectionRevision,
    positionModeEvidence: input.privateTruthEvidence,
    ownerCheckpoint: checkpoint.serialized,
    ownerCheckpointChecksum: checkpoint.checksum,
    ownerCheckpointRevision: checkpoint.checkpointRevision,
    ownerStateRevision: checkpoint.state.stateRevisionId,
    ownerStateLifecycle: checkpoint.state.lifecycle,
    ownerStateLastSequence: checkpoint.state.lastSequence,
    foundationSubmittedQuantity: input.ownerRequest.leg.quantity,
    requestedQuantity: quantity,
    venueFilledQuantity: order.filledQuantity,
    confirmedFilledQuantity,
    baseAssetCommissionQuantity: feeAdjusted.baseAssetCommissionQuantity,
    feeAdjustedConfirmedQuantity: feeAdjusted.feeAdjustedConfirmedQuantity,
    remainingQuantity: order.remainingQuantity,
    expiredQuantity: order.expiredQuantity,
    venueStatus: order.venueStatus,
    localTruth: order.localTruth,
    localDisposition,
    terminalStatus: terminalStatus(order),
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
  return cloneFreezeNormalBasis({
    schema: NORMAL_BASIS_TWIN_OBSERVATION_SCHEMA,
    ...material,
    observationRevision: revision('l09observation_', material),
  });
}

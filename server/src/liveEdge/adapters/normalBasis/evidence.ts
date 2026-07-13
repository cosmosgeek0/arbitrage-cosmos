import {
  canonicalJson,
  stableHash128Hex,
} from '../../../foundation/contracts/index.js';
import {
  addTwinDecimals,
  compareTwinDecimals,
  signedTwinResidual,
  subtractTwinDecimals,
  twinDecimal,
} from '../exchangeTwin/index.js';
import {
  validateNormalBasisFoundationBinding,
} from './binding.js';
import {
  validateNormalBasisTwinLegObservation,
} from './twinAdapter.js';
import {
  NORMAL_BASIS_OWNER_AGREEMENT_SCHEMA,
  NORMAL_BASIS_TWIN_OBSERVATION_SCHEMA,
  type EvaluateNormalBasisOwnerAgreementInput,
  type NormalBasisCanonicalOutcome,
  type NormalBasisFoundationBinding,
  type NormalBasisFoundationStateView,
  type NormalBasisOwnerAgreement,
  type NormalBasisTwinLegObservation,
} from './types.js';

function revision(prefix: string, value: unknown): string {
  return `${prefix}${stableHash128Hex(canonicalJson(value))}`;
}

function total(
  observations: readonly Readonly<NormalBasisTwinLegObservation>[],
  stages: readonly NormalBasisTwinLegObservation['stage'][],
): string {
  let value = '0';
  for (const observation of observations) {
    if (stages.includes(observation.stage)) {
      value = addTwinDecimals(value, observation.confirmedFilledQuantity);
    }
  }
  return value;
}

function residual(opened: string, closed: string, reasons: string[], label: string): string {
  if (compareTwinDecimals(closed, opened) > 0) {
    reasons.push(`OWNER_${label}_CLOSE_EXCEEDS_OPEN`);
    return '0';
  }
  return subtractTwinDecimals(opened, closed);
}

function ownerQuantity(value: number, label: string): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite Foundation quantity`);
  }
  const projected = String(value);
  if (Number(projected) !== value) {
    throw new TypeError(`${label} did not round-trip through binary64`);
  }
  return twinDecimal(projected, label);
}

function validateAgreementOwnerState(
  binding: Readonly<NormalBasisFoundationBinding>,
  state: Readonly<NormalBasisFoundationStateView>,
): Readonly<{
  canonicalOutcome: NormalBasisCanonicalOutcome;
  ownerStateRevision: string;
  openingSpotQuantity: string;
  openingPerpQuantity: string;
  closingSpotQuantity: string;
  closingPerpQuantity: string;
}> {
  if (state === null || state === undefined
    || canonicalJson(state.plan) !== canonicalJson(binding.ownerPlan)
    || !['CLOSED', 'HEDGED_OPEN', 'ONE_LEG_EXPOSED', 'RECOVERY_REQUIRED'].includes(state.lifecycle)
    || !Number.isSafeInteger(state.revision) || state.revision <= 0
    || typeof state.stateRevisionId !== 'string'
    || !/^rev_[0-9a-f]{16}$/.test(state.stateRevisionId)) {
    throw new TypeError('canonical Foundation agreement state is required');
  }
  for (const key of ['SPOT', 'PERP'] as const) {
    if (canonicalJson(state.openingLegs?.[key]?.definition)
        !== canonicalJson(binding.ownerPlan.openingLegs[key])
      || canonicalJson(state.closingLegs?.[key]?.definition)
        !== canonicalJson(binding.ownerPlan.closingLegs[key])) {
      throw new TypeError('Foundation agreement state carries a different leg definition');
    }
  }
  const openingSpotQuantity = ownerQuantity(
    state.openingLegs.SPOT.cumulativeFilledQuantity,
    'Foundation agreement Spot opening fill',
  );
  const openingPerpQuantity = ownerQuantity(
    state.openingLegs.PERP.cumulativeFilledQuantity,
    'Foundation agreement Perp opening fill',
  );
  const closingSpotQuantity = ownerQuantity(
    state.closingLegs.SPOT.cumulativeFilledQuantity,
    'Foundation agreement Spot closing fill',
  );
  const closingPerpQuantity = ownerQuantity(
    state.closingLegs.PERP.cumulativeFilledQuantity,
    'Foundation agreement Perp closing fill',
  );
  if (compareTwinDecimals(closingSpotQuantity, openingSpotQuantity) > 0
    || compareTwinDecimals(closingPerpQuantity, openingPerpQuantity) > 0) {
    throw new TypeError('Foundation agreement close fill exceeds its confirmed opening fill');
  }
  return Object.freeze({
    canonicalOutcome: state.lifecycle as NormalBasisCanonicalOutcome,
    ownerStateRevision: state.stateRevisionId,
    openingSpotQuantity,
    openingPerpQuantity,
    closingSpotQuantity,
    closingPerpQuantity,
  });
}

/**
 * Compares actual-fill evidence with an injected canonical owner outcome.
 * It never creates or changes a Foundation lifecycle/reconciliation result.
 */
export function evaluateNormalBasisOwnerAgreement(
  input: Readonly<EvaluateNormalBasisOwnerAgreementInput>,
): Readonly<NormalBasisOwnerAgreement> {
  const binding = validateNormalBasisFoundationBinding(input.foundationBinding);
  const ownerState = validateAgreementOwnerState(binding, input.ownerState);
  if (!Array.isArray(input.observations) || input.observations.length > 12) {
    throw new TypeError('normal-Basis observations exceed the closed bound');
  }
  const observations = input.observations.map((value) => {
    const observation = validateNormalBasisTwinLegObservation(value, binding);
    if (observation.schema !== NORMAL_BASIS_TWIN_OBSERVATION_SCHEMA
      || observation.foundationBindingRevision !== binding.foundationBindingRevision) {
      throw new TypeError('normal-Basis observation belongs to a different owner binding');
    }
    return observation;
  });
  const clientOrderIds = observations.map((observation) => (
    observation.deterministicClientOrderId
  ));
  const mutationIds = observations.map((observation) => observation.l06MutationId);
  if (new Set(clientOrderIds).size !== clientOrderIds.length
    || new Set(mutationIds).size !== mutationIds.length
    || new Set(observations.map((observation) => observation.observationRevision)).size
      !== observations.length) {
    throw new TypeError('normal-Basis agreement requires one canonical observation per owner order');
  }
  const observationByRevision = new Map(observations.map((observation) => (
    [observation.observationRevision, observation] as const
  )));
  for (const observation of observations) {
    if (observation.stage === 'ENTRY_HEDGE') {
      const prior = observationByRevision.get(observation.priorObservationRevision ?? '');
      if (prior === undefined || prior.stage !== 'ENTRY_SPOT'
        || canonicalJson(prior) !== canonicalJson(observation.priorSpotObservationEvidence)) {
        throw new TypeError('normal-Basis hedge does not retain its canonical Spot observation');
      }
    }
  }
  if (!Array.isArray(input.recoveryRecommendations)
    || input.recoveryRecommendations.length > 12) {
    throw new TypeError('normal-Basis recovery recommendations exceed the closed bound');
  }
  const recommendations = input.recoveryRecommendations.map((recommendation) => {
    if (![
      'VERIFY_AMBIGUOUS_ORDER', 'HEDGE_RESIDUAL', 'CLOSE_EXPOSED_LEG',
      'CANCEL_REMAINDER', 'MANUAL_REVIEW', 'NO_ACTION',
    ].includes(recommendation.action)
      || !['RISK_REDUCING', 'NEUTRAL'].includes(recommendation.riskEffect)
      || recommendation.automatic !== false
      || Object.keys(recommendation).sort().join(',') !== 'action,automatic,riskEffect') {
      throw new TypeError('normal-Basis recovery recommendation must remain non-automatic and non-increasing');
    }
    return Object.freeze({ ...recommendation });
  });
  const reasons: string[] = [];
  const openingSpotQuantity = total(observations, ['ENTRY_SPOT']);
  const openingPerpQuantity = total(observations, ['ENTRY_HEDGE']);
  const closingSpotQuantity = total(observations, ['EXIT_SPOT', 'RECOVERY_CLOSE_SPOT']);
  const closingPerpQuantity = total(observations, ['EXIT_PERP', 'RECOVERY_CLOSE_PERP']);
  const residualSpotQuantity = residual(openingSpotQuantity, closingSpotQuantity, reasons, 'SPOT');
  const residualPerpQuantity = residual(openingPerpQuantity, closingPerpQuantity, reasons, 'PERP');
  const netBaseQuantity = signedTwinResidual(residualSpotQuantity, residualPerpQuantity);
  const unhedgedBaseQuantity = compareTwinDecimals(residualSpotQuantity, residualPerpQuantity) >= 0
    ? subtractTwinDecimals(residualSpotQuantity, residualPerpQuantity)
    : subtractTwinDecimals(residualPerpQuantity, residualSpotQuantity);
  const ambiguityVisible = observations.some((observation) => observation.ambiguityVisible);
  const recoveryRequiredVisible = observations.some((observation) => observation.recoveryRequired);
  const workingRemainderVisible = observations.some((observation) => (
    ['ACKNOWLEDGED', 'PARTIALLY_FILLED'].includes(observation.localDisposition)
      && observation.terminalStatus === null
      && compareTwinDecimals(observation.remainingQuantity, '0') > 0
  ));

  const openedAny = openingSpotQuantity !== '0' || openingPerpQuantity !== '0';
  const imbalanced = residualSpotQuantity !== residualPerpQuantity;
  const meaningfulRecommendation = recommendations.some((recommendation) => (
    recommendation.action !== 'NO_ACTION'
  ));
  const manualReviewRecommendation = recommendations.some((recommendation) => (
    recommendation.action === 'MANUAL_REVIEW'
  ));
  if (openingSpotQuantity !== ownerState.openingSpotQuantity) {
    reasons.push('OWNER_SPOT_OPEN_FILL_MISMATCH');
  }
  if (openingPerpQuantity !== ownerState.openingPerpQuantity) {
    reasons.push('OWNER_PERP_OPEN_FILL_MISMATCH');
  }
  if (closingSpotQuantity !== ownerState.closingSpotQuantity) {
    reasons.push('OWNER_SPOT_CLOSE_FILL_MISMATCH');
  }
  if (closingPerpQuantity !== ownerState.closingPerpQuantity) {
    reasons.push('OWNER_PERP_CLOSE_FILL_MISMATCH');
  }
  if (ownerState.canonicalOutcome === 'CLOSED'
    && (residualSpotQuantity !== '0' || residualPerpQuantity !== '0'
      || ambiguityVisible || recoveryRequiredVisible || workingRemainderVisible
      || !openedAny)) {
    reasons.push('OWNER_CLOSED_WITH_UNRESOLVED_TRUTH');
  }
  if (ownerState.canonicalOutcome === 'HEDGED_OPEN'
    && (residualSpotQuantity === '0'
      || residualSpotQuantity !== residualPerpQuantity
      || ambiguityVisible || recoveryRequiredVisible || workingRemainderVisible)) {
    reasons.push('OWNER_HEDGED_OPEN_WITH_UNRESOLVED_TRUTH');
  }
  if (ambiguityVisible && ownerState.canonicalOutcome !== 'RECOVERY_REQUIRED') {
    reasons.push('OWNER_AMBIGUITY_NOT_RECOVERY_REQUIRED');
  }
  if (ownerState.canonicalOutcome === 'ONE_LEG_EXPOSED'
    && (!openedAny || (!imbalanced && !workingRemainderVisible)
      || ambiguityVisible)) {
    reasons.push('OWNER_ONE_LEG_EXPOSED_WITHOUT_EXPOSURE');
  }
  if (ownerState.canonicalOutcome === 'RECOVERY_REQUIRED'
    && !ambiguityVisible && !recoveryRequiredVisible && !imbalanced) {
    reasons.push('OWNER_RECOVERY_REQUIRED_WITHOUT_RECOVERY_CONDITION');
  }
  if ((ownerState.canonicalOutcome === 'ONE_LEG_EXPOSED'
      || ownerState.canonicalOutcome === 'RECOVERY_REQUIRED')
    && !meaningfulRecommendation) {
    reasons.push('OWNER_RECOVERY_RECOMMENDATION_MISSING');
  }
  if (ownerState.canonicalOutcome === 'RECOVERY_REQUIRED'
    && !manualReviewRecommendation) {
    reasons.push('OWNER_MANUAL_REVIEW_NOT_RETAINED');
  }
  const orderedReasons = Object.freeze([...new Set(reasons)].sort());
  const manualActionRequired = orderedReasons.length === 0
    && (ownerState.canonicalOutcome === 'ONE_LEG_EXPOSED'
      || ownerState.canonicalOutcome === 'RECOVERY_REQUIRED');
  const material = {
    foundationBindingRevision: binding.foundationBindingRevision,
    ownerStateRevision: ownerState.ownerStateRevision,
    canonicalOutcome: ownerState.canonicalOutcome,
    state: orderedReasons.length > 0
      ? ('BLOCKED' as const)
      : manualActionRequired ? ('MANUAL_ACTION_REQUIRED' as const) : ('PASS' as const),
    reasonCodes: orderedReasons,
    openingSpotQuantity,
    openingPerpQuantity,
    closingSpotQuantity,
    closingPerpQuantity,
    residualSpotQuantity,
    residualPerpQuantity,
    netBaseQuantity,
    unhedgedBaseQuantity,
    ambiguityVisible,
    workingRemainderVisible,
    manualActionRequired,
    ownerRecommendationsRetained: Object.freeze(recommendations),
    observationRevisions: Object.freeze(observations.map((observation) => (
      observation.observationRevision
    ))),
    lifecycleAuthority: 'FOUNDATION_EXECUTION' as const,
    reconciliationAuthority: 'FOUNDATION_RECONCILIATION' as const,
    evidenceAuthority: 'ADAPTER_EVIDENCE_ONLY' as const,
    simulationAuthority: 'SYNTHETIC_FIXTURE' as const,
    sendEligible: false as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  };
  return Object.freeze({
    schema: NORMAL_BASIS_OWNER_AGREEMENT_SCHEMA,
    ...material,
    agreementRevision: revision('l09agreement_', material),
  });
}

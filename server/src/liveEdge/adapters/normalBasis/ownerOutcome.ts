import {
  compareTwinDecimals,
  twinDecimal,
} from '../exchangeTwin/index.js';
import {
  NORMAL_BASIS_TWIN_OBSERVATION_SCHEMA,
  type NormalBasisFoundationBinding,
  type NormalBasisOwnerLegOutcomeView,
  type NormalBasisTwinLegObservation,
} from './types.js';
import {
  validateNormalBasisTwinLegObservation,
} from './twinAdapter.js';

function exactBinary64(value: string): number {
  const normalized = twinDecimal(value, 'confirmed filled quantity');
  const projected = Number(normalized);
  if (!Number.isFinite(projected) || projected < 0
    || twinDecimal(String(projected), 'binary64 confirmed filled quantity') !== normalized) {
    throw new TypeError('confirmed twin quantity is not an exact Foundation binary64 projection');
  }
  return projected;
}

function failure(
  kind: 'REJECTED' | 'AMBIGUOUS',
  observation: Readonly<NormalBasisTwinLegObservation>,
): Readonly<NormalBasisOwnerLegOutcomeView> {
  const blocked = observation.blockedReasonCodes.join(',');
  const code = kind === 'AMBIGUOUS'
    ? 'TWIN_OUTCOME_AMBIGUOUS'
    : observation.localDisposition === 'TERMINAL_NO_FILL'
      ? 'TWIN_TERMINAL_NO_FILL'
      : 'TWIN_PREFLIGHT_REJECTED';
  return Object.freeze({
    kind,
    failure: Object.freeze({
      code,
      message: kind === 'AMBIGUOUS'
        ? 'Synthetic venue truth is not confirmed by local private or reconciliation evidence.'
        : `Synthetic order did not admit a fill${blocked.length === 0 ? '' : `: ${blocked}`}.`,
      retryable: false as const,
      recommendedOperatorAction: kind === 'AMBIGUOUS'
        ? 'Resolve the deterministic client-order ID through read-only owner reconciliation.'
        : 'Inspect the retained owner and twin evidence before considering a new plan.',
    }),
  });
}

/**
 * Narrow data projection into Foundation's dormant PAPER port shape. It does
 * not call Foundation, persist, reconcile, retry, or authorize any action.
 */
export function projectNormalBasisOwnerLegOutcome(
  value: Readonly<NormalBasisTwinLegObservation>,
  binding: Readonly<NormalBasisFoundationBinding>,
): Readonly<NormalBasisOwnerLegOutcomeView> {
  if (value?.schema !== NORMAL_BASIS_TWIN_OBSERVATION_SCHEMA
    || value.sendEligible !== false
    || value.actionAuthority !== 'NONE_RECORD_ONLY'
    || value.externalActionAuthorization !== 'NONE'
    || value.simulationAuthority !== 'SYNTHETIC_FIXTURE') {
    throw new TypeError('normal-Basis observation authority is not exact');
  }
  const observation = validateNormalBasisTwinLegObservation(value, binding);
  if (observation.localDisposition === 'AMBIGUOUS') return failure('AMBIGUOUS', observation);
  if (observation.localDisposition === 'REJECTED'
    || observation.localDisposition === 'TERMINAL_NO_FILL') {
    return failure('REJECTED', observation);
  }
  if (observation.localDisposition === 'ACKNOWLEDGED') {
    if (compareTwinDecimals(observation.confirmedFilledQuantity, '0') !== 0) {
      throw new TypeError('acknowledged observation cannot carry a confirmed fill');
    }
    return Object.freeze({ kind: 'ACKNOWLEDGED' as const, venueOrderId: null });
  }
  const cumulativeFilledQuantity = exactBinary64(observation.confirmedFilledQuantity);
  if (cumulativeFilledQuantity <= 0) {
    throw new TypeError('filled observation requires positive confirmed quantity');
  }
  return Object.freeze({
    kind: observation.localDisposition === 'FILLED'
      ? ('FILLED' as const) : ('PARTIALLY_FILLED' as const),
    venueOrderId: null,
    cumulativeFilledQuantity,
  });
}

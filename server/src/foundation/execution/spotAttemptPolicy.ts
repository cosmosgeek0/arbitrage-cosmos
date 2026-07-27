import {
  requestAttemptMappingGuidance,
  type RequestAttemptState,
} from '../../liveEdge/adapters/binanceSignedKernel/ambiguity.js';

/**
 * Foundation consumes the canonical signed-kernel attempt state. It does not
 * reclassify timeout, HTTP, disconnect, malformed-response, or abort outcomes.
 */

export const SPOT_ATTEMPT_ACTIONS = Object.freeze([
  'SUBMIT_NEW_ORDER',
  'QUERY_ORIGINAL_CLIENT_ID',
  'ACCEPT_EXISTING_ORDER',
  'AWAIT_CANONICAL_OBSERVATION',
  'HAND_OFF_TERMINAL_OBSERVATION',
  'FAIL',
  'STOPPED_BY_KILL_SWITCH',
] as const);

export type SpotAttemptAction = (typeof SPOT_ATTEMPT_ACTIONS)[number];

export interface SpotAttemptPolicyInput {
  readonly canonicalAttempt: Readonly<RequestAttemptState>;
  readonly killSwitchEngaged: boolean;
}

export interface SpotAttemptDecision {
  readonly action: SpotAttemptAction;
  readonly originalClientOrderId: string;
  /** Populated only for the canonical read-only reconciliation action. */
  readonly queryClientOrderId: string | null;
  /** Mutation attempts are never automatically resubmitted. */
  readonly automaticResubmission: false;
}

function decision(
  action: SpotAttemptAction,
  originalClientOrderId: string,
): Readonly<SpotAttemptDecision> {
  return Object.freeze({
    action,
    originalClientOrderId,
    queryClientOrderId:
      action === 'QUERY_ORIGINAL_CLIENT_ID'
        ? originalClientOrderId
        : null,
    automaticResubmission: false as const,
  });
}

/**
 * Decide the next inert action description for one canonical mutation
 * attempt. The kill switch is evaluated at the only new-order seam, before a
 * submit action can be returned.
 */
export function decideSpotAttempt(
  input: SpotAttemptPolicyInput,
): Readonly<SpotAttemptDecision> {
  if (typeof input.killSwitchEngaged !== 'boolean') {
    throw new TypeError('killSwitchEngaged must be boolean');
  }

  const attempt = input.canonicalAttempt;
  const guidance = requestAttemptMappingGuidance(attempt);
  const originalClientOrderId = attempt.clientOrderId;

  if (
    guidance.reconciliationRequired ||
    guidance.queryByDeterministicClientOrderId ||
    guidance.canonicalOwnerGuidance ===
      'READ_ONLY_QUERY_BY_CLIENT_ORDER_ID'
  ) {
    return decision(
      'QUERY_ORIGINAL_CLIENT_ID',
      originalClientOrderId,
    );
  }

  if (attempt.stage === 'PRE_SEND' || attempt.stage === 'NOT_SENT') {
    if (input.killSwitchEngaged) {
      return decision(
        'STOPPED_BY_KILL_SWITCH',
        originalClientOrderId,
      );
    }
    return decision('SUBMIT_NEW_ORDER', originalClientOrderId);
  }

  if (attempt.stage === 'ACKNOWLEDGED') {
    return decision('ACCEPT_EXISTING_ORDER', originalClientOrderId);
  }
  if (attempt.stage === 'REJECTED') {
    return decision('FAIL', originalClientOrderId);
  }
  if (
    attempt.stage === 'TERMINAL_OBSERVED' ||
    guidance.canonicalOwnerGuidance ===
      'HAND_OFF_TERMINAL_OBSERVATION'
  ) {
    return decision(
      'HAND_OFF_TERMINAL_OBSERVATION',
      originalClientOrderId,
    );
  }
  return decision(
    'AWAIT_CANONICAL_OBSERVATION',
    originalClientOrderId,
  );
}

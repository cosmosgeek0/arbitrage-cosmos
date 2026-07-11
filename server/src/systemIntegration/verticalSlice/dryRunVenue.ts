import { canonicalJson, type RiskVerdict } from '../../foundation/contracts/index.js';
import type {
  ExecutionCoordinatorPorts,
  ExecutionPlanDefinition,
  ExecutionPlanState,
  LegOperationRequest,
  LookupOutcome,
  PreflightPortResult,
  ReconciliationOutcome,
  SubmissionOutcome,
} from '../../foundation/execution/index.js';
import type { ValidateOnlyVenueAudit } from './types.js';

const BLOCKED_PORT_FAILURE = Object.freeze({
  code: 'VALIDATE_ONLY_SUBMISSION_BLOCKED',
  message: 'VALIDATE_ONLY dry-run ports cannot submit an order-like request.',
  retryable: false,
  recommendedOperatorAction: 'Inspect validation output only; live and paper submission are outside this system mode.',
});

interface DryRunVenueBinding {
  readonly nowMs: number;
  readonly plan: Readonly<ExecutionPlanDefinition>;
  readonly riskVerdict: Readonly<RiskVerdict>;
}

export interface SealedDryRunVenueHarness {
  readonly ports: ExecutionCoordinatorPorts;
  readonly audit: () => Readonly<ValidateOnlyVenueAudit>;
}

function frozenAudit(
  sealed: boolean,
  counts: {
    identityClaims: number;
    preflightCalls: number;
    validationCalls: number;
    submissionCalls: number;
    lookupCalls: number;
    reconciliationCalls: number;
  },
  callOrder: readonly string[],
): Readonly<ValidateOnlyVenueAudit> {
  return Object.freeze({
    sealed,
    ...counts,
    callOrder: Object.freeze([...callOrder]),
  });
}

/**
 * Creates the only venue-shaped object reachable by the vertical slice.
 * It owns no transport, credentials, test-order method, private-data method,
 * or live submission method. The Foundation-required submitPaper seam is a
 * mechanical tripwire and must remain uncalled in VALIDATE_ONLY.
 */
export function createSealedDryRunVenueHarness(
  binding: Readonly<DryRunVenueBinding>,
): Readonly<SealedDryRunVenueHarness> {
  const counts = {
    identityClaims: 0,
    preflightCalls: 0,
    validationCalls: 0,
    submissionCalls: 0,
    lookupCalls: 0,
    reconciliationCalls: 0,
  };
  const callOrder: string[] = [];
  let claimedFingerprint: string | null = null;
  const expectedPlanBytes = canonicalJson(binding.plan);

  const ports: ExecutionCoordinatorPorts = {
    claimPlanIdentity(planId, termsFingerprint) {
      counts.identityClaims += 1;
      callOrder.push('claimPlanIdentity');
      if (planId !== binding.plan.planId || termsFingerprint !== binding.plan.termsFingerprint) return 'CONFLICT';
      if (claimedFingerprint === null) {
        claimedFingerprint = termsFingerprint;
        return 'CLAIMED';
      }
      return claimedFingerprint === termsFingerprint ? 'EXISTING_SAME' : 'CONFLICT';
    },

    async preflight(plan): Promise<PreflightPortResult> {
      counts.preflightCalls += 1;
      callOrder.push('preflight');
      if (
        canonicalJson(plan) !== expectedPlanBytes ||
        plan.mode !== 'VALIDATE_ONLY' ||
        !binding.riskVerdict.allowed ||
        binding.nowMs >= binding.riskVerdict.expiresAt
      ) {
        return {
          ok: false,
          failure: {
            code: 'DRY_RUN_RISK_BINDING_INVALID',
            message: 'Dry-run preflight requires the exact VALIDATE_ONLY plan and a current allowed risk verdict.',
            retryable: false,
            recommendedOperatorAction: 'Rebuild the validation trace from current owner records.',
          },
        };
      }
      return { ok: true };
    },

    async validateLeg(request: LegOperationRequest): Promise<PreflightPortResult> {
      counts.validationCalls += 1;
      callOrder.push(`validateLeg:${request.phase}:${request.leg.key}`);
      const expected = request.phase === 'OPEN'
        ? binding.plan.openingLegs[request.leg.key]
        : binding.plan.closingLegs[request.leg.key];
      if (
        request.mode !== 'VALIDATE_ONLY' ||
        request.planId !== binding.plan.planId ||
        request.correlationId !== binding.plan.correlationId ||
        canonicalJson(request.leg) !== canonicalJson(expected)
      ) {
        return {
          ok: false,
          failure: {
            code: 'DRY_RUN_LEG_BINDING_INVALID',
            message: 'Dry-run leg validation received terms outside the exact bound plan.',
            retryable: false,
            recommendedOperatorAction: 'Discard the drifted plan and rebuild it from the staged mandate.',
          },
        };
      }
      return { ok: true };
    },

    async submitPaper(_request: LegOperationRequest): Promise<SubmissionOutcome> {
      counts.submissionCalls += 1;
      callOrder.push('submitPaper:BLOCKED');
      return { kind: 'REJECTED', failure: BLOCKED_PORT_FAILURE };
    },

    async lookupByClientOrderId(_request: LegOperationRequest): Promise<LookupOutcome> {
      counts.lookupCalls += 1;
      callOrder.push('lookupByClientOrderId:UNRESOLVED');
      return { kind: 'UNRESOLVED', failure: BLOCKED_PORT_FAILURE };
    },

    async reconcile(_state: ExecutionPlanState): Promise<ReconciliationOutcome> {
      counts.reconciliationCalls += 1;
      callOrder.push('reconcile:UNRESOLVED');
      return { kind: 'UNRESOLVED', failure: BLOCKED_PORT_FAILURE };
    },
  };

  Object.freeze(ports);
  return Object.freeze({
    ports,
    audit: () => frozenAudit(Object.isSealed(ports), counts, callOrder),
  });
}

import { isValidUtcMillis } from '../contracts/index.js';
import { hasAmbiguousLeg, hasKnownOpenExposure } from './reducer.js';
import {
  EXECUTION_LEG_KEYS,
  type ExecutionLegKey,
  type ExecutionPlanState,
  type NormalBasisOrderObservation,
  type NormalBasisProgressState,
  type RecoveryRecommendation,
} from './types.js';

function recommendation(
  action: RecoveryRecommendation['action'],
  riskEffect: RecoveryRecommendation['riskEffect'],
  reason: string,
  phase: RecoveryRecommendation['phase'] = null,
  legKey: RecoveryRecommendation['legKey'] = null,
  clientOrderId: string | null = null,
): Readonly<RecoveryRecommendation> {
  return Object.freeze({ action, riskEffect, reason, phase, legKey, clientOrderId, automatic: false as const });
}

const NORMAL_BASIS_ACTIVE_ATTEMPT_STATES = new Set([
  'SUBMISSION_STARTED',
  'WORKING',
  'AMBIGUOUS',
  'QUERY_STARTED',
  'CANCEL_REQUESTED',
]);

function normalBasisManualReview(reason: string): readonly Readonly<RecoveryRecommendation>[] {
  return Object.freeze([recommendation('MANUAL_REVIEW', 'NEUTRAL', reason)]);
}

function recommendNormalBasisRecovery(
  state: ExecutionPlanState,
  progress: NormalBasisProgressState | undefined,
): readonly Readonly<RecoveryRecommendation>[] {
  const binding = state.plan.normalBasisBinding;
  if (binding === undefined) return Object.freeze([]);
  if (progress === undefined || progress.bindingId !== binding.bindingId) {
    return normalBasisManualReview(
      'The opt-in normal-Basis binding has no matching replay projection; preserve the checkpoint and reconcile it manually.',
    );
  }

  const latestAttempts = new Map<string, NormalBasisOrderObservation>();
  for (const entry of progress.journal) {
    if (entry.kind === 'ORDER') latestAttempts.set(entry.clientOrderId, entry);
  }
  const activeAttempts = [...latestAttempts.values()].filter(
    (entry) => NORMAL_BASIS_ACTIVE_ATTEMPT_STATES.has(entry.state),
  );
  if (activeAttempts.length > 1) {
    return normalBasisManualReview(
      'The normal-Basis journal contains more than one non-terminal attempt; do not query, cancel, retry, or progress either identity automatically.',
    );
  }
  const active = activeAttempts[0];
  if (active !== undefined) {
    if (
      (active.state === 'WORKING' || active.state === 'AMBIGUOUS') &&
      progress.workingOrAmbiguousClientOrderId !== active.clientOrderId
    ) {
      return normalBasisManualReview(
        'The normal-Basis replay projection does not identify its working or ambiguous order; do not retry or progress.',
      );
    }
    const step = binding.steps[active.step];
    return Object.freeze([
      recommendation(
        'VERIFY_AMBIGUOUS_ORDER',
        'NEUTRAL',
        'Cold recovery must query this exact deterministic order identity before cancel, retry, re-close, or step progression; the checkpoint provides process-local replay only.',
        step.phase,
        step.legKey,
        active.clientOrderId,
      ),
    ]);
  }
  if (progress.workingOrAmbiguousClientOrderId !== null) {
    return normalBasisManualReview(
      'The normal-Basis replay projection names a working order without matching non-terminal journal evidence.',
    );
  }

  if (progress.next === 'PERP_CLOSE' || progress.next === 'SPOT_CLOSE') {
    const attempt = progress.nextAttempt;
    if (
      attempt === null ||
      !Number.isSafeInteger(attempt) ||
      attempt < 0 ||
      attempt >= binding.maxCloseAttempts
    ) {
      return normalBasisManualReview(
        'The bounded normal-Basis close-attempt budget is exhausted or invalid; preserve residual evidence for operator review.',
      );
    }
    const identity = binding.closeAttempts.find(
      (candidate) => candidate.step === progress.next && candidate.attempt === attempt,
    );
    if (
      identity === undefined ||
      progress.expectedQuantity === null ||
      !Number.isFinite(progress.expectedQuantity) ||
      progress.expectedQuantity <= 0
    ) {
      return normalBasisManualReview(
        'The next normal-Basis close lacks a valid immutable attempt identity or positive residual quantity; do not synthesize one.',
      );
    }
    const step = binding.steps[progress.next];
    return Object.freeze([
      recommendation(
        'CLOSE_EXPOSED_LEG',
        'RISK_REDUCING',
        progress.next === 'PERP_CLOSE'
          ? `Bounded reduce-only USD-M close attempt ${attempt + 1}/${binding.maxCloseAttempts} is next; query-first recovery still applies if its response becomes unknown.`
          : `Bounded Spot close attempt ${attempt + 1}/${binding.maxCloseAttempts} is next only after terminal USD-M close evidence.`,
        step.phase,
        step.legKey,
        identity.clientOrderId,
      ),
    ]);
  }

  if (progress.next === 'BASELINE_RECONCILIATION') {
    return normalBasisManualReview(
      'All four bound legs are terminal, but completion requires fresh evidence that both signed positions returned to the risk-bound account baseline.',
    );
  }

  if (progress.next === 'COMPLETE') {
    return progress.complete && progress.baselineFlat
      ? Object.freeze([
          recommendation(
            'NO_ACTION',
            'NEUTRAL',
            'The four-leg journal is terminal and the risk-bound account baseline has been re-established.',
          ),
        ])
      : normalBasisManualReview(
          'A normal-Basis projection cannot be complete without risk-bound baseline-flat proof.',
        );
  }

  if (progress.next === 'PERP_OPEN' && hasKnownOpenExposure(state)) {
    return normalBasisManualReview(
      'Spot entry exposure exists while the bound hedge step remains incomplete; no recovery entry action is automatically authorized.',
    );
  }

  if (state.lifecycle === 'RECOVERY_REQUIRED') {
    return normalBasisManualReview(
      'Normal-Basis recovery-required state has no safe data-only progression; preserve its bounded journal and reconcile manually.',
    );
  }

  return Object.freeze([
    recommendation(
      'NO_ACTION',
      'NEUTRAL',
      'No risk-reducing normal-Basis recovery action is presently eligible.',
    ),
  ]);
}

/**
 * Data-only recovery guidance. It never executes an action. Entry is always
 * risk-increasing; every executable recovery recommendation is explicitly
 * risk-reducing and still requires a separately authorized coordinator call.
 */
export function recommendExecutionRecovery(
  state: ExecutionPlanState,
  nowMs: number,
): readonly Readonly<RecoveryRecommendation>[] {
  if (!isValidUtcMillis(nowMs)) throw new TypeError('nowMs must be valid UTC ms from an injected clock');
  if (state.plan.normalBasisBinding !== undefined) {
    return recommendNormalBasisRecovery(state, state.normalBasisProgress);
  }
  const output: RecoveryRecommendation[] = [];

  for (const phase of ['OPEN', 'CLOSE'] as const) {
    const record = phase === 'OPEN' ? state.openingLegs : state.closingLegs;
    for (const key of EXECUTION_LEG_KEYS) {
      const leg = record[key];
      if (leg.lifecycle === 'AMBIGUOUS') {
        output.push(
          recommendation(
            'VERIFY_AMBIGUOUS_ORDER',
            'NEUTRAL',
            'Transport response was lost; query venue evidence by deterministic client-order ID before any retry.',
            phase,
            key,
            leg.definition.clientOrderId,
          ),
        );
      }
      if (leg.lifecycle === 'SUBMITTING') {
        output.push(
          recommendation(
            'VERIFY_AMBIGUOUS_ORDER',
            'NEUTRAL',
            'Submission started before the durable acknowledgement cut; cold recovery must look up this deterministic client-order ID before progression.',
            phase,
            key,
            leg.definition.clientOrderId,
          ),
        );
      }
      if (
        phase === 'OPEN' &&
        (
          leg.lifecycle === 'ACKNOWLEDGED' ||
          leg.lifecycle === 'PARTIALLY_FILLED' ||
          leg.lifecycle === 'CANCEL_PENDING'
        )
      ) {
        output.push(
          recommendation(
            'CANCEL_REMAINDER',
            'RISK_REDUCING',
            'The opening order can add exposure after the currently observed fill; cancel/reconcile its remainder before declaring a stable hedge.',
            phase,
            key,
            leg.definition.clientOrderId,
          ),
        );
      }
    }
  }

  if (hasKnownOpenExposure(state)) {
    output.push(
      recommendation(
        'CLOSE_EXPOSED_LEG',
        'RISK_REDUCING',
        state.lifecycle === 'RECOVERY_REQUIRED'
          ? 'Known exposure remains after the bounded naked-duration or an unresolved operation.'
          : 'Known exposure exists; an authorized close is the conservative recovery path.',
      ),
    );
    if (state.lifecycle === 'ONE_LEG_EXPOSED' && state.exposedSinceMs !== null) {
      output.push(
        recommendation(
          'HEDGE_RESIDUAL',
          'RISK_REDUCING',
          `Residual hedge is eligible for operator evaluation; naked age is ${Math.max(0, nowMs - state.exposedSinceMs)} ms.`,
        ),
      );
    }
  }

  if (state.lifecycle === 'RECOVERY_REQUIRED') {
    output.push(
      recommendation(
        'MANUAL_REVIEW',
        'NEUTRAL',
        'Recovery-required state must be reconciled; exposure and ambiguity evidence remain in the checkpoint.',
      ),
    );
  }

  if (output.length === 0 && !hasAmbiguousLeg(state)) {
    output.push(recommendation('NO_ACTION', 'NEUTRAL', 'No unresolved execution recovery condition is present.'));
  }
  return Object.freeze(output);
}

export function residualFraction(state: ExecutionPlanState, key: ExecutionLegKey): number {
  const opened = state.openingLegs[key].cumulativeFilledQuantity;
  const closed = state.closingLegs[key].cumulativeFilledQuantity;
  return Math.max(0, opened - closed) / state.openingLegs[key].definition.quantity;
}

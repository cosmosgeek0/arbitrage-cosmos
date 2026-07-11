import { isValidUtcMillis } from '../contracts/index.js';
import { hasAmbiguousLeg, hasKnownOpenExposure } from './reducer.js';
import {
  EXECUTION_LEG_KEYS,
  type ExecutionLegKey,
  type ExecutionPlanState,
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
      if (
        phase === 'OPEN' &&
        (leg.lifecycle === 'ACKNOWLEDGED' || leg.lifecycle === 'PARTIALLY_FILLED')
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

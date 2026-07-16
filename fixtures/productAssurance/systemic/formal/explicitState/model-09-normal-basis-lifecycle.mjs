import {
  BASE_ASSUMPTIONS,
  check,
  defineModel,
  liveness,
  next,
  safety,
} from './common.mjs';

const TERMINAL_PLANS = Object.freeze(['CLOSED', 'FAILED', 'CANCELLED', 'EXPIRED']);

const INITIAL = Object.freeze({
  phase: 'CREATED',
  planLifecycle: 'CREATED',
  spotLeg: 'PLANNED',
  perpLeg: 'PLANNED',
  spotFill: 0,
  perpFill: 0,
  targetQuantity: 2,
  liability: 0,
  liabilityExplicit: true,
  truth: 'EXACT',
  cancelRequested: false,
  cancelObserved: false,
  cancelRequestIsFact: false,
  localEffectAfterCancel: false,
  repairActive: false,
  capitalAtRepairEntry: 2,
  capitalAuthorization: 2,
  authoritativePostcondition: false,
  verdict: 'UNKNOWN',
});

function withAccounting(state, patch) {
  const spotFill = patch.spotFill ?? state.spotFill;
  const perpFill = patch.perpFill ?? state.perpFill;
  return { ...patch, spotFill, perpFill, liability: Math.abs(spotFill - perpFill) };
}

function transitionsFor(profile, state) {
  switch (state.phase) {
    case 'CREATED':
      return [next(state, 'START_PREFLIGHT', { phase: 'PREFLIGHTING', planLifecycle: 'PREFLIGHTING' })];
    case 'PREFLIGHTING':
      return [
        next(state, 'PREFLIGHT_PASSED', { phase: 'READY', planLifecycle: 'READY' }),
        next(state, 'PREFLIGHT_FAILED', { phase: 'TERMINAL', planLifecycle: 'FAILED', verdict: 'BLOCKED' }),
      ];
    case 'READY':
      return [
        next(state, 'BEGIN_OPENING', { phase: 'OPENING', planLifecycle: 'OPENING' }),
        next(state, 'CANCEL_READY_PLAN', { phase: 'TERMINAL', planLifecycle: 'CANCELLED', cancelObserved: true, verdict: 'BLOCKED' }),
        next(state, 'EXPIRE_READY_PLAN', { phase: 'TERMINAL', planLifecycle: 'EXPIRED', verdict: 'BLOCKED' }),
      ];
    case 'OPENING':
      return [next(state, 'SUBMIT_OPEN_SPOT', { phase: 'SPOT_SUBMITTING', spotLeg: 'SUBMITTING' })];
    case 'SPOT_SUBMITTING':
      return [
        next(state, 'OPEN_SPOT_PARTIAL_FILL', withAccounting(state, {
          phase: 'SPOT_PARTIAL', planLifecycle: 'ONE_LEG_EXPOSED', spotLeg: 'PARTIALLY_FILLED', spotFill: 1,
        })),
        next(state, 'OPEN_SPOT_FULL_FILL', withAccounting(state, {
          phase: 'HEDGE_REQUIRED', planLifecycle: 'ONE_LEG_EXPOSED', spotLeg: 'FILLED', spotFill: 2,
        })),
        next(state, 'OPEN_SPOT_AMBIGUOUS', {
          phase: 'RECONCILING', planLifecycle: 'RECONCILING', spotLeg: 'AMBIGUOUS', truth: 'UNKNOWN', liabilityExplicit: true,
        }),
        next(state, 'REQUEST_SPOT_CANCEL_WITHOUT_FILL', {
          phase: 'CANCEL_PENDING', spotLeg: 'CANCEL_PENDING', cancelRequested: true,
        }),
      ];
    case 'SPOT_PARTIAL':
      if (profile === 'CANCEL_REQUEST_IS_FACT') {
        return [next(state, 'MUTANT_CANCEL_REQUEST_CLEARS_FILL', {
          phase: 'TERMINAL', planLifecycle: 'CANCELLED', spotLeg: 'CANCELLED', spotFill: 0,
          liability: 0, cancelRequested: true, cancelObserved: true, cancelRequestIsFact: true, verdict: 'BLOCKED',
        })];
      }
      return [next(state, 'REQUEST_SPOT_CANCEL_AFTER_PARTIAL', {
        phase: 'CANCEL_PENDING', spotLeg: 'CANCEL_PENDING', cancelRequested: true,
      })];
    case 'CANCEL_PENDING': {
      const transitions = [next(state, 'CANCEL_ACK_RETAINS_FILL', withAccounting(state, {
        phase: state.spotFill > 0 ? 'HEDGE_REQUIRED' : 'TERMINAL',
        planLifecycle: state.spotFill > 0 ? 'ONE_LEG_EXPOSED' : 'CANCELLED',
        spotLeg: 'CANCELLED', cancelObserved: true, verdict: state.spotFill > 0 ? 'UNKNOWN' : 'BLOCKED',
      }))];
      if (state.spotFill === 1) transitions.push(next(state, 'LATE_FILL_WINS_CANCEL_RACE', withAccounting(state, {
        phase: 'HEDGE_REQUIRED', planLifecycle: 'ONE_LEG_EXPOSED', spotLeg: 'FILLED', spotFill: 2,
        cancelObserved: true,
      })));
      transitions.push(next(state, 'CANCEL_RACE_AMBIGUOUS', {
        phase: 'RECONCILING', planLifecycle: 'RECONCILING', spotLeg: 'AMBIGUOUS', truth: 'UNKNOWN', liabilityExplicit: true,
      }));
      return transitions;
    }
    case 'HEDGE_REQUIRED':
      return [
        next(state, 'SUBMIT_PERP_FROM_ACTUAL_SPOT_FILL', { phase: 'PERP_SUBMITTING', perpLeg: 'SUBMITTING' }),
        next(state, 'ENTER_NORMAL_BASIS_REPAIR', {
          phase: 'REPAIR', planLifecycle: 'RECOVERY_REQUIRED', repairActive: true,
          capitalAtRepairEntry: state.capitalAuthorization,
        }),
      ];
    case 'PERP_SUBMITTING':
      return [
        next(state, 'PERP_FILL_MATCHES_SPOT', withAccounting(state, {
          phase: 'HEDGED_OPEN', planLifecycle: 'HEDGED_OPEN', perpLeg: 'FILLED', perpFill: state.spotFill,
          authoritativePostcondition: true, verdict: 'PASS',
        })),
        next(state, 'PERP_DELIVERY_AMBIGUOUS', {
          phase: 'RECONCILING', planLifecycle: 'RECONCILING', perpLeg: 'AMBIGUOUS', truth: 'UNKNOWN', liabilityExplicit: true,
        }),
      ];
    case 'RECONCILING':
      return [
        next(state, 'RECONCILE_NORMAL_BASIS_EXACT', withAccounting(state, {
          phase: state.spotFill > 0 ? 'HEDGE_REQUIRED' : 'TERMINAL',
          planLifecycle: state.spotFill > 0 ? 'ONE_LEG_EXPOSED' : 'FAILED',
          spotLeg: state.spotFill > 0 ? 'FILLED' : 'REJECTED',
          perpLeg: state.perpFill > 0 ? 'FILLED' : 'PLANNED',
          truth: 'EXACT', verdict: state.spotFill > 0 ? 'UNKNOWN' : 'BLOCKED',
        })),
        next(state, 'PERSIST_NORMAL_BASIS_UNRESOLVED', {
          phase: 'TERMINAL', planLifecycle: 'RECOVERY_REQUIRED', repairActive: true,
          capitalAtRepairEntry: state.capitalAuthorization, truth: 'UNKNOWN', liabilityExplicit: true, verdict: 'UNKNOWN',
        }),
      ];
    case 'REPAIR':
      return [
        next(state, 'RECOVER_WITH_EXACT_PAIRED_HEDGE', withAccounting(state, {
          phase: 'HEDGED_OPEN', planLifecycle: 'HEDGED_OPEN', perpLeg: 'FILLED', perpFill: state.spotFill,
          repairActive: false, authoritativePostcondition: true, verdict: 'PASS',
        })),
        next(state, 'PERSIST_REPAIR_UNAVAILABLE', {
          phase: 'TERMINAL', repairActive: false, truth: 'UNKNOWN', liabilityExplicit: true, verdict: 'UNKNOWN',
        }),
      ];
    case 'HEDGED_OPEN':
      return [next(state, 'REQUEST_PAIRED_CLOSE', { phase: 'CLOSING', planLifecycle: 'CLOSING', verdict: 'UNKNOWN' })];
    case 'CLOSING':
      return [
        next(state, 'CLOSE_BOTH_LEGS_EXACTLY', withAccounting(state, {
          phase: 'TERMINAL', planLifecycle: 'CLOSED', spotFill: 0, perpFill: 0,
          authoritativePostcondition: true, verdict: 'PASS',
        })),
        next(state, 'CLOSE_RECONCILIATION_UNAVAILABLE', {
          phase: 'TERMINAL', planLifecycle: 'RECOVERY_REQUIRED', repairActive: true,
          capitalAtRepairEntry: state.capitalAuthorization, truth: 'UNKNOWN', liabilityExplicit: true, verdict: 'UNKNOWN',
        }),
      ];
    default:
      return [];
  }
}

const SAFETY = Object.freeze([
  safety('S3-SAF-03', ({ previousState, nextState }) => check(
    previousState === null || nextState.spotFill >= previousState.spotFill
      || (nextState.planLifecycle === 'CLOSED' && nextState.authoritativePostcondition),
    'a received Spot fill was erased without exact paired closure evidence',
  )),
  safety('S3-SAF-06', ({ nextState }) => check(
    nextState.verdict !== 'PASS' || nextState.authoritativePostcondition,
    'normal-Basis lifecycle reached PASS without an authoritative postcondition',
  )),
  safety('S3-SAF-07', ({ nextState }) => check(
    nextState.liability === 0 || nextState.liabilityExplicit,
    'unpaired normal-Basis exposure was not retained as explicit liability',
  )),
  safety('S3-SAF-12', ({ nextState }) => check(
    !nextState.repairActive || nextState.capitalAuthorization <= nextState.capitalAtRepairEntry,
    'normal-Basis repair increased its capital authorization ceiling',
  )),
  safety('S3-SAF-13', ({ nextState }) => check(
    nextState.truth !== 'UNKNOWN' || nextState.verdict !== 'PASS',
    'UNKNOWN normal-Basis truth was normalized to PASS',
  )),
  safety('S3-SAF-14', ({ nextState }) => check(
    !nextState.cancelRequestIsFact && (!nextState.cancelObserved || !nextState.localEffectAfterCancel),
    'cancel request was treated as a fill-erasing fact or crossed by a new local effect',
  )),
  safety('S3-SAF-15', ({ nextState }) => check(
    nextState.liability === Math.abs(nextState.spotFill - nextState.perpFill),
    'two-leg normal-Basis residual was not conserved as paired fill or liability',
  )),
  safety('S3-M09-INV-01', ({ previousState, actionId }) => check(
    previousState === null || !TERMINAL_PLANS.includes(previousState.planLifecycle) || !actionId.startsWith('SUBMIT_'),
    'terminal Foundation plan started a new leg submission',
  )),
]);

const LIVENESS = Object.freeze([
  liveness(
    'S3-LIV-01',
    (state) => ['SPOT_SUBMITTING', 'PERP_SUBMITTING'].includes(state.phase),
    (state) => !['SPOT_SUBMITTING', 'PERP_SUBMITTING'].includes(state.phase),
    {
      weakFairActions: [
        'OPEN_SPOT_PARTIAL_FILL', 'OPEN_SPOT_FULL_FILL', 'OPEN_SPOT_AMBIGUOUS',
        'REQUEST_SPOT_CANCEL_WITHOUT_FILL', 'PERP_FILL_MATCHES_SPOT', 'PERP_DELIVERY_AMBIGUOUS',
      ],
    },
  ),
  liveness(
    'S3-LIV-04',
    (state) => state.phase === 'REPAIR' && state.repairActive,
    (state) => state.phase !== 'REPAIR',
    { weakFairActions: ['RECOVER_WITH_EXACT_PAIRED_HEDGE', 'PERSIST_REPAIR_UNAVAILABLE'] },
  ),
  liveness(
    'S3-LIV-05',
    (state) => state.phase === 'CANCEL_PENDING' && state.cancelRequested,
    (state) => state.phase !== 'CANCEL_PENDING',
    { weakFairActions: ['CANCEL_ACK_RETAINS_FILL', 'LATE_FILL_WINS_CANCEL_RACE', 'CANCEL_RACE_AMBIGUOUS'] },
  ),
  liveness(
    'S3-LIV-06',
    (state) => state.phase === 'RECONCILING',
    (state) => state.phase !== 'RECONCILING',
    { weakFairActions: ['RECONCILE_NORMAL_BASIS_EXACT', 'PERSIST_NORMAL_BASIS_UNRESOLVED'] },
  ),
]);

const ASSUMPTIONS = Object.freeze([
  ...BASE_ASSUMPTIONS,
  'SYNTHETIC_ONLY; SUPPORTING_EVIDENCE_ONLY; runtime_claim_closure is NOT_PERMITTED.',
  'The finite symmetry-reduced envelope has one Foundation plan, OPEN Spot/Perp legs, CLOSE pair projection, quantity 0..2, and one cancel race.',
  'Foundation PLAN_LIFECYCLE_TRANSITIONS and LEG_LIFECYCLE_TRANSITIONS are the lifecycle owner; normalBasis is evidence-only.',
  'The injected clock is monotonic over a six-cut saturating envelope; no ambient clock or runtime scheduler is represented.',
  'Weak fairness applies only to continuously enabled owner-result, reconciliation, and bounded repair alternatives; success is never assumed.',
  'No generic HALT or executor-fencing claim is made because the frozen M09 owner files expose neither primitive.',
]);

function create(profile) {
  return defineModel({
    modelId: 'S3-M09-NORMAL-BASIS-LIFECYCLE',
    title: 'Foundation-owned normal-Basis leg lifecycle, cancel race, residual liability, and evidence agreement',
    profile,
    bounds: { maxStates: 512, maxTransitions: 2_048, maxDepth: 24 },
    assumptions: ASSUMPTIONS,
    initialState: INITIAL,
    enabledTransitions: (state) => transitionsFor(profile, state),
    safety: SAFETY,
    liveness: LIVENESS,
    terminal: (state) => state.phase === 'TERMINAL',
    terminalClass: (state) => `${state.planLifecycle}_${state.verdict}`,
  });
}

export const NORMAL_BASIS_LIFECYCLE_MODEL = create('CANONICAL');
export const NORMAL_BASIS_LIFECYCLE_MUTANT = create('CANCEL_REQUEST_IS_FACT');

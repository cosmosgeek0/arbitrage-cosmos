import {
  BASE_ASSUMPTIONS,
  check,
  defineModel,
  liveness,
  next,
  safety,
} from './common.mjs';

const INITIAL = Object.freeze({
  phase: 'INIT',
  symbolStatus: 'UNKNOWN',
  bookTruth: 'UNAVAILABLE',
  requested: 2,
  filled: 0,
  remaining: 2,
  expired: 0,
  placementCount: 0,
  venueStatus: 'NOT_ARRIVED',
  localTruth: 'NOT_DISPATCHED',
  orderingTruth: 'PROVED',
  cancelState: 'NONE',
  cancelObserved: false,
  localEffectAfterCancel: false,
  authoritativePostcondition: false,
  generation: 0,
  truth: 'UNKNOWN',
  outcome: 'PENDING',
});

function exactCancelled(state, actionId) {
  return next(state, actionId, {
    phase: 'TERMINAL',
    remaining: 0,
    expired: state.requested - state.filled,
    venueStatus: 'CANCELED',
    localTruth: 'OBSERVED',
    orderingTruth: 'PROVED',
    cancelState: 'ACKED',
    cancelObserved: true,
    authoritativePostcondition: true,
    truth: 'EXACT',
    outcome: state.filled > 0 ? 'PARTIAL_THEN_CANCELLED' : 'CANCELLED',
  });
}

function transitionsFor(profile, state) {
  switch (state.phase) {
    case 'INIT':
      return [
        next(state, 'LOAD_FRESH_TRADING_BOOK', {
          phase: 'PREFLIGHT', symbolStatus: 'TRADING', bookTruth: 'AVAILABLE', truth: 'EXACT',
        }),
        next(state, 'LOAD_HALT_STATUS', {
          phase: 'TERMINAL', symbolStatus: 'HALT', bookTruth: 'AVAILABLE', truth: 'EXACT', outcome: 'BLOCKED',
        }),
        next(state, 'LOAD_UNKNOWN_STATUS', {
          phase: 'TERMINAL', symbolStatus: 'UNKNOWN', bookTruth: 'UNAVAILABLE', truth: 'UNKNOWN', outcome: 'UNRESOLVED',
        }),
      ];
    case 'PREFLIGHT':
      return [next(state, 'DISPATCH_SINGLE_PLACEMENT', {
        phase: 'PLACEMENT_DISPATCHED', placementCount: 1, localTruth: 'DISPATCHED',
      })];
    case 'PLACEMENT_DISPATCHED': {
      const transitions = [
        next(state, 'HTTP_ACK_NEW', {
          phase: 'VENUE_NEW', venueStatus: 'NEW', localTruth: 'ACKNOWLEDGED',
        }),
        next(state, 'HTTP_DELIVERY_UNKNOWN', {
          phase: 'RECONCILING', localTruth: 'UNKNOWN', truth: 'UNKNOWN', outcome: 'UNRESOLVED',
        }),
      ];
      if (state.generation === 0) transitions.push(next(state, 'CRASH_AFTER_PLACEMENT_DISPATCH', {
        phase: 'RESTORING', generation: 1, localTruth: 'UNKNOWN', truth: 'UNKNOWN',
      }));
      return transitions;
    }
    case 'VENUE_NEW':
      return [
        next(state, 'OBSERVE_TRADE_BEFORE_CANCEL', {
          phase: 'VENUE_PARTIAL', filled: 1, remaining: 1, venueStatus: 'PARTIALLY_FILLED',
          localTruth: 'OBSERVED', authoritativePostcondition: true, truth: 'EXACT',
        }),
        next(state, 'DISPATCH_CANCEL', {
          phase: 'CANCEL_PENDING', cancelState: 'DISPATCHED',
        }),
        next(state, 'OBSERVE_VENUE_FULL_FILL', {
          phase: 'TERMINAL', filled: 2, remaining: 0, venueStatus: 'FILLED', localTruth: 'OBSERVED',
          authoritativePostcondition: true, truth: 'EXACT', outcome: 'FILLED',
        }),
      ];
    case 'VENUE_PARTIAL':
      return [next(state, 'DISPATCH_CANCEL_AFTER_PARTIAL', {
        phase: 'CANCEL_PENDING', cancelState: 'DISPATCHED',
      })];
    case 'CANCEL_PENDING': {
      const transitions = [
        exactCancelled(state, 'PROVE_CANCEL_FIRST'),
        (() => {
          const filled = Math.min(state.requested, state.filled + 1);
          return next(state, 'PROVE_TRADE_FIRST', {
            phase: 'TERMINAL', filled, remaining: 0, expired: state.requested - filled,
            venueStatus: 'CANCELED', localTruth: 'OBSERVED', orderingTruth: 'PROVED',
            cancelState: 'ACKED', cancelObserved: true, authoritativePostcondition: true,
            truth: 'EXACT', outcome: filled === state.requested ? 'FILLED' : 'PARTIAL_THEN_CANCELLED',
          });
        })(),
        next(state, 'DROP_CANCEL_DELIVERY', {
          phase: 'RECONCILING', cancelState: 'DROPPED', localTruth: 'UNKNOWN', truth: 'UNKNOWN', outcome: 'UNRESOLVED',
        }),
      ];
      if (profile === 'AMBIGUOUS_CANCEL_RACE_ALLOCATES_FILL') {
        const filled = Math.min(state.requested, state.filled + 1);
        transitions.push(next(state, 'MUTANT_UNPROVED_RACE_ALLOCATES_FILL', {
          phase: 'TERMINAL', filled, remaining: 0, expired: state.requested - filled,
          venueStatus: 'CANCELED', localTruth: 'OBSERVED', orderingTruth: 'AMBIGUOUS',
          cancelState: 'ACKED', cancelObserved: true, truth: 'UNKNOWN', outcome: 'PARTIAL_THEN_CANCELLED',
        }));
      } else {
        transitions.push(next(state, 'UNPROVED_EQUAL_TIME_CANCEL_RACE', {
          phase: 'RECONCILING', orderingTruth: 'AMBIGUOUS', localTruth: 'RECOVERY_REQUIRED',
          truth: 'UNKNOWN', outcome: 'UNRESOLVED',
        }));
      }
      return transitions;
    }
    case 'RESTORING':
      return [next(state, 'RESTORE_TWIN_CHECKPOINT', {
        phase: 'RECONCILING', localTruth: 'RECOVERY_REQUIRED', truth: 'UNKNOWN', outcome: 'UNRESOLVED',
      })];
    case 'RECONCILING':
      return [
        exactCancelled(state, 'APPLY_EXACT_RECONCILIATION'),
        next(state, 'RECONCILIATION_MISMATCH_VISIBLE', {
          phase: 'TERMINAL', localTruth: 'RECOVERY_REQUIRED', truth: 'UNKNOWN', outcome: 'UNRESOLVED',
        }),
        next(state, 'RECONCILIATION_UNAVAILABLE_VISIBLE', {
          phase: 'TERMINAL', localTruth: 'RECOVERY_REQUIRED', truth: 'UNKNOWN', outcome: 'UNRESOLVED',
        }),
      ];
    default:
      return [];
  }
}

const SAFETY = Object.freeze([
  safety('S3-SAF-03', ({ previousState, nextState }) => check(
    previousState === null || nextState.filled >= previousState.filled,
    'exchange-twin checkpoint or reconciliation erased an observed fill',
  )),
  safety('S3-SAF-05', ({ nextState }) => check(
    nextState.placementCount <= 1,
    'ambiguous placement was blindly resent',
  )),
  safety('S3-SAF-06', ({ nextState }) => check(
    nextState.localTruth !== 'OBSERVED' || nextState.authoritativePostcondition,
    'exchange-twin local truth became OBSERVED without an authoritative postcondition',
  )),
  safety('S3-SAF-11', ({ nextState }) => check(
    !['HALT', 'UNKNOWN'].includes(nextState.symbolStatus) || nextState.placementCount === 0,
    'placement was dispatched after HALT or UNKNOWN symbol status',
  )),
  safety('S3-SAF-13', ({ nextState }) => check(
    nextState.truth !== 'UNKNOWN' && nextState.orderingTruth !== 'AMBIGUOUS'
      || nextState.localTruth !== 'OBSERVED',
    'UNKNOWN or ambiguous exchange-twin truth self-promoted to OBSERVED',
  )),
  safety('S3-SAF-14', ({ previousState, nextState }) => check(
    (!nextState.cancelObserved || !nextState.localEffectAfterCancel)
      && (previousState === null || nextState.cancelState !== 'ACKED' || nextState.filled >= previousState.filled),
    'cancel observation crossed a new local effect or erased a prior fill',
  )),
  safety('S3-M12-INV-01', ({ previousState, nextState }) => check(
    nextState.orderingTruth !== 'AMBIGUOUS'
      || (previousState !== null && nextState.filled === previousState.filled && nextState.localTruth !== 'OBSERVED'),
    'unproved equal-time race allocated a fill or affirmative local truth',
  )),
  safety('S3-M12-INV-02', ({ previousState, nextState }) => check(
    nextState.filled + nextState.remaining + nextState.expired === nextState.requested
      && (previousState === null || nextState.filled >= previousState.filled),
    'filled, remaining, and expired quantities did not conserve the requested quantity',
  )),
]);

const LIVENESS = Object.freeze([
  liveness(
    'S3-LIV-01',
    (state) => state.phase === 'PLACEMENT_DISPATCHED',
    (state) => state.phase !== 'PLACEMENT_DISPATCHED',
    { weakFairActions: ['HTTP_ACK_NEW', 'HTTP_DELIVERY_UNKNOWN', 'CRASH_AFTER_PLACEMENT_DISPATCH'] },
  ),
  liveness(
    'S3-LIV-03',
    (state) => state.phase === 'RESTORING',
    (state) => state.phase !== 'RESTORING',
    { weakFairActions: ['RESTORE_TWIN_CHECKPOINT'] },
  ),
  liveness(
    'S3-LIV-05',
    (state) => state.phase === 'CANCEL_PENDING',
    (state) => state.phase !== 'CANCEL_PENDING',
    {
      weakFairActions: [
        'PROVE_CANCEL_FIRST', 'PROVE_TRADE_FIRST', 'DROP_CANCEL_DELIVERY',
        'UNPROVED_EQUAL_TIME_CANCEL_RACE', 'MUTANT_UNPROVED_RACE_ALLOCATES_FILL',
      ],
    },
  ),
  liveness(
    'S3-LIV-06',
    (state) => state.phase === 'RECONCILING',
    (state) => state.phase !== 'RECONCILING',
    {
      weakFairActions: [
        'APPLY_EXACT_RECONCILIATION', 'RECONCILIATION_MISMATCH_VISIBLE',
        'RECONCILIATION_UNAVAILABLE_VISIBLE',
      ],
    },
  ),
]);

const ASSUMPTIONS = Object.freeze([
  ...BASE_ASSUMPTIONS,
  'SYNTHETIC_ONLY; SUPPORTING_EVIDENCE_ONLY; runtime_claim_closure is NOT_PERMITTED.',
  'The finite envelope contains one fixture, requested quantity 2, one placement, one cancel, one crash/restart, and one reconciliation cut.',
  'Equal-time trade/cancel events without source sequence are admitted as AMBIGUOUS; no scheduler or tie-breaking order is fabricated.',
  'Time is abstracted into finite fresh, delivery-unknown, crash, and reconciliation cuts; validity equality is treated as expired and no numeric clock is represented.',
  'Weak fairness applies only to continuously enabled restore, cancel-observation, and injected reconciliation alternatives; the reducer performs no owner query.',
  'Exchange-twin identity uniqueness is not an executor lease and no capital-owner guarantee is claimed.',
  'localEffectAfterCancel is a fixed scope-exclusion sentinel: observed cancellation terminalizes the modeled local scope, while late external facts remain reconciliation evidence.',
]);

function create(profile) {
  return defineModel({
    modelId: 'S3-M12-EXCHANGE-TWIN-AMBIGUITY',
    title: 'Exchange-twin placement/cancel races, crash restore, ambiguity, and exact reconciliation',
    profile,
    bounds: { maxStates: 2_048, maxTransitions: 8_192, maxDepth: 24 },
    assumptions: ASSUMPTIONS,
    initialState: INITIAL,
    enabledTransitions: (state) => transitionsFor(profile, state),
    safety: SAFETY,
    liveness: LIVENESS,
    terminal: (state) => state.phase === 'TERMINAL',
    terminalClass: (state) => `${state.outcome}_${state.localTruth}`,
  });
}

export const EXCHANGE_TWIN_AMBIGUITY_MODEL = create('CANONICAL');
export const EXCHANGE_TWIN_AMBIGUITY_MUTANT = create('AMBIGUOUS_CANCEL_RACE_ALLOCATES_FILL');

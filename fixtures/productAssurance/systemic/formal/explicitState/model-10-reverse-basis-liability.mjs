import {
  BASE_ASSUMPTIONS,
  check,
  defineModel,
  liveness,
  next,
  safety,
} from './common.mjs';

const INITIAL = Object.freeze({
  phase: 'PREFLIGHTED',
  stage: 'PREFLIGHTED',
  borrowState: 'ABSENT',
  principal: 0,
  interest: 0,
  repaid: 0,
  liability: 0,
  liabilityTruth: 'ABSENT',
  marginSaleFill: 0,
  futuresEntryFill: 0,
  futuresExitFill: 0,
  marginCoverFill: 0,
  cancelRequested: false,
  cancelObserved: false,
  localEffectAfterCancel: false,
  repayConfirmed: false,
  zeroLiabilityProof: false,
  closureExact: false,
  repairActive: false,
  capitalAtRepairEntry: 2,
  capitalAuthorization: 2,
  truth: 'EXACT',
  verdict: 'UNKNOWN',
});

function enterRepair(state, patch = {}) {
  return {
    ...patch,
    phase: 'REPAIR',
    stage: 'RECOVERY_REQUIRED',
    repairActive: true,
    capitalAtRepairEntry: state.capitalAuthorization,
    truth: 'UNKNOWN',
    verdict: 'UNKNOWN',
  };
}

function transitionsFor(profile, state) {
  switch (state.phase) {
    case 'PREFLIGHTED':
      return [
        next(state, 'OBSERVE_BORROW_CONFIRMED', {
          phase: 'BORROW_CONFIRMED_NEEDS_LIABILITY', stage: 'RECOVERY_REQUIRED', borrowState: 'CONFIRMED',
          principal: 2, liability: 2, liabilityTruth: 'MISSING', truth: 'UNKNOWN',
        }),
        next(state, 'OBSERVE_BORROW_UNKNOWN', {
          phase: 'BORROW_UNKNOWN', stage: 'RECOVERY_REQUIRED', borrowState: 'UNKNOWN',
          liabilityTruth: 'UNKNOWN', truth: 'UNKNOWN',
        }),
        next(state, 'OBSERVE_BORROW_REJECTED_NO_EFFECT', {
          phase: 'TERMINAL', stage: 'BLOCKED', borrowState: 'REJECTED_NO_EFFECT_PROVEN', verdict: 'BLOCKED',
        }),
      ];
    case 'BORROW_UNKNOWN':
      return [
        next(state, 'RECONCILE_BORROW_CONFIRMED', {
          phase: 'BORROW_CONFIRMED_NEEDS_LIABILITY', stage: 'RECOVERY_REQUIRED', borrowState: 'CONFIRMED',
          principal: 2, liability: 2, liabilityTruth: 'MISSING', truth: 'UNKNOWN',
        }),
        next(state, 'PERSIST_BORROW_UNKNOWN', enterRepair(state)),
      ];
    case 'BORROW_CONFIRMED_NEEDS_LIABILITY':
      return [
        next(state, 'OBSERVE_BOUND_POSITIVE_LIABILITY', {
          phase: 'LIABILITY_CONFIRMED', stage: 'LIABILITY_CONFIRMED', liabilityTruth: 'POSITIVE', truth: 'EXACT',
        }),
        next(state, 'LIABILITY_TRUTH_UNAVAILABLE', enterRepair(state)),
      ];
    case 'LIABILITY_CONFIRMED': {
      const transitions = [next(state, 'SUBMIT_MARGIN_ENTRY_FROM_LIABILITY', {
        phase: 'MARGIN_ENTRY_PENDING', stage: 'LIABILITY_CONFIRMED',
      })];
      if (state.interest === 0) transitions.push(next(state, 'OBSERVE_ONE_INTEREST_UNIT', {
        interest: 1, liability: state.liability + 1,
      }));
      return transitions;
    }
    case 'MARGIN_ENTRY_PENDING':
      return [
        next(state, 'OBSERVE_MARGIN_ENTRY_PARTIAL', {
          phase: 'MARGIN_ENTRY_PARTIAL', stage: 'ENTRY_MARGIN_SELL_WORKING', marginSaleFill: 1,
        }),
        next(state, 'OBSERVE_MARGIN_ENTRY_FULL', {
          phase: 'HEDGE_REQUIRED', stage: 'HEDGE_WORKING', marginSaleFill: 2,
        }),
        next(state, 'REQUEST_MARGIN_ENTRY_CANCEL', {
          phase: 'MARGIN_CANCEL_PENDING', cancelRequested: true,
        }),
        next(state, 'MARGIN_ENTRY_MUTATION_UNKNOWN', enterRepair(state)),
      ];
    case 'MARGIN_ENTRY_PARTIAL':
      return [
        next(state, 'REQUEST_PARTIAL_MARGIN_CANCEL', { phase: 'MARGIN_CANCEL_PENDING', cancelRequested: true }),
        next(state, 'OBSERVE_MARGIN_ENTRY_REMAINDER', {
          phase: 'HEDGE_REQUIRED', stage: 'HEDGE_WORKING', marginSaleFill: 2,
        }),
      ];
    case 'MARGIN_CANCEL_PENDING': {
      const transitions = [next(state, 'OBSERVE_MARGIN_CANCEL', {
        phase: state.marginSaleFill > 0 ? 'HEDGE_REQUIRED' : 'LIABILITY_CONFIRMED',
        stage: state.marginSaleFill > 0 ? 'HEDGE_WORKING' : 'LIABILITY_CONFIRMED',
        cancelObserved: true,
      })];
      if (state.marginSaleFill < 2) transitions.push(next(state, 'OBSERVE_LATE_MARGIN_FILL', {
        phase: 'HEDGE_REQUIRED', stage: 'HEDGE_WORKING', marginSaleFill: 2, cancelObserved: true,
      }));
      transitions.push(next(state, 'MARGIN_CANCEL_ORDERING_UNKNOWN', enterRepair(state)));
      return transitions;
    }
    case 'HEDGE_REQUIRED':
      return [next(state, 'SUBMIT_FUTURES_HEDGE_FROM_ACTUAL_MARGIN_FILL', {
        phase: 'FUTURES_HEDGE_PENDING', stage: 'HEDGE_WORKING',
      })];
    case 'FUTURES_HEDGE_PENDING':
      return [
        next(state, 'OBSERVE_FUTURES_HEDGE_EXACT', {
          phase: 'OPEN', stage: 'OPEN', futuresEntryFill: state.marginSaleFill, truth: 'EXACT',
        }),
        next(state, 'FUTURES_HEDGE_MUTATION_UNKNOWN', enterRepair(state)),
      ];
    case 'OPEN':
      return [next(state, 'SUBMIT_FUTURES_EXIT', { phase: 'FUTURES_EXIT_PENDING', stage: 'EXITING' })];
    case 'FUTURES_EXIT_PENDING':
      return [
        next(state, 'OBSERVE_FUTURES_EXIT_EXACT', {
          phase: 'MARGIN_COVER_PENDING', stage: 'EXITING', futuresExitFill: state.futuresEntryFill,
        }),
        next(state, 'FUTURES_EXIT_UNKNOWN', enterRepair(state)),
      ];
    case 'MARGIN_COVER_PENDING':
      return [
        next(state, 'OBSERVE_MARGIN_COVER_EXACT', {
          phase: 'REPAY_REQUIRED', stage: 'REPAYING', marginCoverFill: state.marginSaleFill,
        }),
        next(state, 'MARGIN_COVER_UNKNOWN', enterRepair(state)),
      ];
    case 'REPAY_REQUIRED':
      if (profile === 'REPAY_PRINCIPAL_ONLY') {
        return [next(state, 'MUTANT_REPAY_OMITS_INTEREST', {
          phase: 'CLOSURE_PENDING', stage: 'REPAYING', repaid: state.principal, liability: 0,
          repayConfirmed: true, zeroLiabilityProof: true,
        })];
      }
      return [
        next(state, 'OBSERVE_EXACT_REPAY_CONFIRMED', {
          phase: 'REPAYING', stage: 'REPAYING', repaid: state.liability, repayConfirmed: true,
        }),
        next(state, 'REPAY_MUTATION_UNKNOWN', enterRepair(state)),
      ];
    case 'REPAYING':
      return [next(state, 'OBSERVE_BOUND_ZERO_LIABILITY', {
        phase: 'CLOSURE_PENDING', stage: 'REPAYING', liability: 0, liabilityTruth: 'ZERO_CONFIRMED',
        zeroLiabilityProof: true,
      })];
    case 'CLOSURE_PENDING':
      return [
        next(state, 'OBSERVE_EXACT_FLAT_CLOSURE', {
          phase: 'TERMINAL', stage: 'CLOSED', closureExact: true, truth: 'EXACT', verdict: 'PASS',
        }),
        next(state, 'CLOSURE_EVIDENCE_UNAVAILABLE', enterRepair(state)),
      ];
    case 'REPAIR':
      return [
        next(state, 'PERSIST_REVERSE_BASIS_UNRESOLVED', {
          phase: 'TERMINAL', stage: 'RECOVERY_REQUIRED', repairActive: false, truth: 'UNKNOWN', verdict: 'UNKNOWN',
        }),
        next(state, 'ESCALATE_REVERSE_BASIS_MANUAL', {
          phase: 'TERMINAL', stage: 'MANUAL_INTERVENTION', repairActive: false, truth: 'UNKNOWN', verdict: 'UNKNOWN',
        }),
      ];
    default:
      return [];
  }
}

const ORDER_ACTIONS = Object.freeze([
  'SUBMIT_MARGIN_ENTRY_FROM_LIABILITY', 'SUBMIT_FUTURES_HEDGE_FROM_ACTUAL_MARGIN_FILL',
  'SUBMIT_FUTURES_EXIT',
]);

const SAFETY = Object.freeze([
  safety('S3-SAF-06', ({ nextState }) => check(
    nextState.verdict !== 'PASS' || (nextState.closureExact && nextState.zeroLiabilityProof),
    'reverse-Basis lifecycle reached PASS without exact flat closure and zero-liability truth',
  )),
  safety('S3-SAF-07', ({ nextState }) => check(
    nextState.liability === 0 || !['ABSENT', 'ZERO_CONFIRMED'].includes(nextState.liabilityTruth),
    'positive reverse-Basis debt was not retained as an explicit liability cut',
  )),
  safety('S3-SAF-12', ({ nextState }) => check(
    !nextState.repairActive || nextState.capitalAuthorization <= nextState.capitalAtRepairEntry,
    'reverse-Basis recovery widened its capital authorization ceiling',
  )),
  safety('S3-SAF-13', ({ nextState }) => check(
    !['UNKNOWN', 'MISSING'].includes(nextState.truth)
      && !['UNKNOWN', 'MISSING'].includes(nextState.liabilityTruth)
      || nextState.verdict !== 'PASS',
    'UNKNOWN reverse-Basis mutation or liability truth was normalized to PASS',
  )),
  safety('S3-SAF-14', ({ nextState }) => check(
    !nextState.cancelObserved || !nextState.localEffectAfterCancel,
    'observed reverse-Basis cancellation was crossed by a new local effect',
  )),
  safety('S3-SAF-15', ({ nextState }) => check(
    nextState.liability === (nextState.zeroLiabilityProof
      ? nextState.principal + nextState.interest - nextState.repaid
      : nextState.principal + nextState.interest)
      && nextState.marginCoverFill <= nextState.marginSaleFill
      && nextState.futuresExitFill <= nextState.futuresEntryFill
      && nextState.futuresEntryFill <= nextState.marginSaleFill,
    'reverse-Basis debt or paired-leg quantities were not conserved',
  )),
  safety('S3-M10-INV-01', ({ previousState, actionId }) => check(
    previousState === null || !previousState.closureExact || actionId === 'INIT',
    'event was accepted after exact closure became final',
  )),
  safety('S3-M10-INV-02', ({ previousState, actionId }) => check(
    previousState === null || !previousState.repayConfirmed || !ORDER_ACTIONS.includes(actionId),
    'order observation was accepted after confirmed repay truth',
  )),
]);

const LIVENESS = Object.freeze([
  liveness(
    'S3-LIV-01',
    (state) => ['MARGIN_ENTRY_PENDING', 'FUTURES_HEDGE_PENDING', 'FUTURES_EXIT_PENDING', 'MARGIN_COVER_PENDING', 'REPAY_REQUIRED'].includes(state.phase),
    (state) => !['MARGIN_ENTRY_PENDING', 'FUTURES_HEDGE_PENDING', 'FUTURES_EXIT_PENDING', 'MARGIN_COVER_PENDING', 'REPAY_REQUIRED'].includes(state.phase),
    {
      weakFairActions: [
        'OBSERVE_MARGIN_ENTRY_PARTIAL', 'OBSERVE_MARGIN_ENTRY_FULL', 'REQUEST_MARGIN_ENTRY_CANCEL',
        'MARGIN_ENTRY_MUTATION_UNKNOWN', 'OBSERVE_FUTURES_HEDGE_EXACT', 'FUTURES_HEDGE_MUTATION_UNKNOWN',
        'OBSERVE_FUTURES_EXIT_EXACT', 'FUTURES_EXIT_UNKNOWN', 'OBSERVE_MARGIN_COVER_EXACT',
        'MARGIN_COVER_UNKNOWN', 'OBSERVE_EXACT_REPAY_CONFIRMED', 'REPAY_MUTATION_UNKNOWN',
        'MUTANT_REPAY_OMITS_INTEREST',
      ],
    },
  ),
  liveness(
    'S3-LIV-04',
    (state) => state.phase === 'REPAIR' && state.repairActive,
    (state) => state.phase !== 'REPAIR',
    { weakFairActions: ['PERSIST_REVERSE_BASIS_UNRESOLVED', 'ESCALATE_REVERSE_BASIS_MANUAL'] },
  ),
  liveness(
    'S3-LIV-05',
    (state) => state.phase === 'MARGIN_CANCEL_PENDING' && state.cancelRequested,
    (state) => state.phase !== 'MARGIN_CANCEL_PENDING',
    { weakFairActions: ['OBSERVE_MARGIN_CANCEL', 'OBSERVE_LATE_MARGIN_FILL', 'MARGIN_CANCEL_ORDERING_UNKNOWN'] },
  ),
  liveness(
    'S3-LIV-06',
    (state) => state.phase === 'BORROW_UNKNOWN',
    (state) => state.phase !== 'BORROW_UNKNOWN',
    { weakFairActions: ['RECONCILE_BORROW_CONFIRMED', 'PERSIST_BORROW_UNKNOWN'] },
  ),
]);

const ASSUMPTIONS = Object.freeze([
  ...BASE_ASSUMPTIONS,
  'SYNTHETIC_ONLY; SUPPORTING_EVIDENCE_ONLY; runtime_claim_closure is NOT_PERMITTED.',
  'The finite envelope fixes principal 2, interest 0..1, paired quantities 0..2, one borrow, one repay, one cancel race, and one closure cut.',
  'Reverse-Basis stage is a derived projection of the bounded event fold; it is not used as an implementation transition guard.',
  'The declared BORROWING type value is intentionally unreachable because frozen deriveLifecycle never assigns it.',
  'The injected logical clock is monotonic over 0..8 and all event ordering is explicit; no ambient scheduler is represented.',
  'Weak fairness applies only to continuously enabled evidence alternatives and may discharge to visible unresolved or manual state.',
  'No generic HALT or executor-fencing claim is made because the frozen Reverse-Basis reducer exposes neither primitive.',
]);

function create(profile) {
  return defineModel({
    modelId: 'S3-M10-REVERSE-BASIS-LIABILITY',
    title: 'Reverse-Basis event fold, paired-leg accounting, repay liability, and exact closure',
    profile,
    bounds: { maxStates: 1_024, maxTransitions: 4_096, maxDepth: 32 },
    assumptions: ASSUMPTIONS,
    initialState: INITIAL,
    enabledTransitions: (state) => transitionsFor(profile, state),
    safety: SAFETY,
    liveness: LIVENESS,
    terminal: (state) => state.phase === 'TERMINAL',
    terminalClass: (state) => `${state.stage}_${state.verdict}`,
  });
}

export const REVERSE_BASIS_LIABILITY_MODEL = create('CANONICAL');
export const REVERSE_BASIS_LIABILITY_MUTANT = create('REPAY_PRINCIPAL_ONLY');

import { check, defineModel, liveness, next, safety } from './common.mjs';

const INITIAL = Object.freeze({
  phase: 'EMPTY',
  planDurable: false,
  submitted: false,
  firstFilled: 0,
  everFirstFilled: 0,
  externalFirstFilled: 0,
  authoritativeFirstFilled: null,
  secondFilled: 0,
  cancelRequested: false,
  cancelFinal: 'NONE',
  intake: 'OPEN',
  accounting: 'PENDING',
  authoritativePostcondition: false,
  liabilityExplicit: false,
  unresolvedRecordDurable: false,
  generation: 0,
  restoreTarget: 'NONE',
  restoredEquivalent: true,
});

const TERMINAL_ACCOUNTING = new Set(['HEDGED', 'CLOSED', 'UNRESOLVED']);

function unresolvedCandidate(state, actionId) {
  return next(state, actionId, {
    phase: 'PERSISTING_UNRESOLVED',
    accounting: 'PENDING',
    authoritativePostcondition: false,
    liabilityExplicit: false,
    unresolvedRecordDurable: false,
  });
}

function transitionsFor(profile, state) {
  const transitions = [];
  if (state.phase === 'EMPTY') transitions.push(next(state, 'PERSIST_PLAN', { phase: 'PLAN_DURABLE', planDurable: true }));
  if (state.phase === 'PLAN_DURABLE') {
    transitions.push(next(state, 'SUBMIT_FIRST_LEG', { phase: 'FIRST_IN_FLIGHT', submitted: true }));
  }
  if (state.phase === 'FIRST_IN_FLIGHT') {
    transitions.push(
      next(state, 'FIRST_LEG_PARTIAL', {
        phase: 'FIRST_PARTIAL',
        firstFilled: 1,
        everFirstFilled: 1,
        externalFirstFilled: 1,
        authoritativeFirstFilled: 1,
        intake: 'HALTED',
      }),
      next(state, 'FIRST_LEG_FILLED', {
        phase: 'FIRST_FILLED',
        firstFilled: 2,
        everFirstFilled: 2,
        externalFirstFilled: 2,
        authoritativeFirstFilled: 2,
        intake: 'HALTED',
      }),
      next(state, 'FIRST_LEG_AMBIGUOUS_ZERO', {
        phase: 'AMBIGUOUS', externalFirstFilled: 0, authoritativeFirstFilled: null, intake: 'HALTED',
      }),
      next(state, 'FIRST_LEG_AMBIGUOUS_PARTIAL', {
        phase: 'AMBIGUOUS', externalFirstFilled: 1, authoritativeFirstFilled: null, intake: 'HALTED',
      }),
      next(state, 'FIRST_LEG_AMBIGUOUS_FILLED', {
        phase: 'AMBIGUOUS', externalFirstFilled: 2, authoritativeFirstFilled: null, intake: 'HALTED',
      }),
    );
  }
  if (state.phase === 'FIRST_PARTIAL') {
    transitions.push(
      next(state, 'REQUEST_CANCEL', { phase: 'CANCEL_PENDING', cancelRequested: true, authoritativeFirstFilled: null }),
      next(state, 'START_PARTIAL_RECOVERY', { phase: 'RECOVERY' }),
    );
    if (state.generation === 0) {
      transitions.push(next(state, 'CRASH_AFTER_PARTIAL', {
        phase: 'RESTORING', generation: 1, restoreTarget: 'FIRST_LEG_LOOKUP', authoritativeFirstFilled: null,
      }));
    }
  }
  if (state.phase === 'FIRST_FILLED') {
    transitions.push(next(state, 'START_FILLED_RECOVERY', { phase: 'RECOVERY' }));
    if (state.generation === 0) {
      transitions.push(next(state, 'CRASH_AFTER_FILL', {
        phase: 'RESTORING', generation: 1, restoreTarget: 'FIRST_LEG_LOOKUP', authoritativeFirstFilled: null,
      }));
    }
  }
  if (state.phase === 'CANCEL_PENDING') {
    transitions.push(
      next(state, 'CANCEL_ACKNOWLEDGED', {
        phase: 'RECOVERY', cancelFinal: 'CANCELLED', authoritativeFirstFilled: state.externalFirstFilled,
      }),
      next(state, 'LATE_FILL_WINS_RACE', {
        phase: 'RECOVERY',
        firstFilled: 2,
        everFirstFilled: 2,
        externalFirstFilled: 2,
        authoritativeFirstFilled: 2,
        cancelFinal: 'FILLED',
      }),
      next(state, 'CANCEL_ACK_LOST', { phase: 'AMBIGUOUS', authoritativeFirstFilled: null }),
    );
    if (profile === 'ERASE_FILL_ON_CANCEL') {
      transitions.push(next(state, 'ERASE_FILL_FALSE_CLOSE', {
        phase: 'TERMINAL',
        firstFilled: 0,
        secondFilled: 0,
        accounting: 'CLOSED',
        authoritativePostcondition: false,
      }));
    }
    if (state.generation === 0) {
      transitions.push(next(state, 'CRASH_DURING_CANCEL', {
        phase: 'RESTORING',
        generation: 1,
        restoreTarget: 'CANCEL_RESTORED',
        authoritativeFirstFilled: null,
      }));
    }
  }
  if (state.phase === 'CANCEL_RESTORED') {
    transitions.push(
      next(state, 'CANCEL_SETTLED_AFTER_CRASH', {
        phase: 'FIRST_LEG_LOOKUP', cancelFinal: 'CANCELLED', externalFirstFilled: 1,
      }),
      next(state, 'LATE_FILL_AFTER_CANCEL_CRASH', {
        phase: 'FIRST_LEG_LOOKUP',
        cancelFinal: 'FILLED',
        externalFirstFilled: 2,
        everFirstFilled: 2,
      }),
      unresolvedCandidate(state, 'CANCEL_STATUS_UNAVAILABLE_AFTER_CRASH'),
    );
  }
  if (state.phase === 'AMBIGUOUS') {
    transitions.push(next(state, 'BEGIN_FIRST_LEG_RECONCILIATION', { phase: 'FIRST_LEG_LOOKUP' }));
    if (state.generation === 0) {
      transitions.push(next(state, 'CRASH_WITH_AMBIGUITY', {
        phase: 'RESTORING', generation: 1, restoreTarget: 'FIRST_LEG_LOOKUP', authoritativeFirstFilled: null,
      }));
    }
  }
  if (state.phase === 'FIRST_LEG_LOOKUP') {
    if (state.externalFirstFilled === 0) {
      transitions.push(next(state, 'LOOKUP_FIRST_LEG_ZERO', {
        phase: 'RECOVERY', firstFilled: 0, authoritativeFirstFilled: 0,
      }));
    }
    if (state.externalFirstFilled === 1) {
      transitions.push(next(state, 'LOOKUP_FIRST_LEG_PARTIAL', {
        phase: 'RECOVERY',
        firstFilled: 1,
        everFirstFilled: Math.max(state.everFirstFilled, 1),
        authoritativeFirstFilled: 1,
      }));
    }
    if (state.externalFirstFilled === 2) {
      transitions.push(next(state, 'LOOKUP_FIRST_LEG_FILLED', {
        phase: 'RECOVERY', firstFilled: 2, everFirstFilled: 2, authoritativeFirstFilled: 2,
      }));
    }
    transitions.push(unresolvedCandidate(state, 'FIRST_LEG_LOOKUP_UNAVAILABLE'));
  }
  if (state.phase === 'RESTORING') {
    transitions.push(next(state, 'RESTORE_PLAN_CHECKPOINT', {
      phase: state.restoreTarget,
      restoredEquivalent: state.planDurable && state.submitted,
    }));
  }
  if (state.phase === 'RECOVERY' && Number.isInteger(state.authoritativeFirstFilled)) {
    transitions.push(
      next(state, 'HEDGE_RESIDUAL', {
        phase: 'TERMINAL',
        secondFilled: state.authoritativeFirstFilled,
        accounting: 'HEDGED',
        authoritativePostcondition: true,
      }),
      next(state, 'CLOSE_EXPOSED_LEG', {
        phase: 'TERMINAL',
        secondFilled: state.authoritativeFirstFilled,
        accounting: 'CLOSED',
        authoritativePostcondition: true,
      }),
      unresolvedCandidate(state, 'DECLARE_RECOVERY_UNAVAILABLE'),
    );
  }
  if (state.phase === 'PERSISTING_UNRESOLVED') {
    transitions.push(next(state, 'PERSIST_UNRESOLVED_EXPOSURE', {
      phase: 'TERMINAL',
      accounting: 'UNRESOLVED',
      liabilityExplicit: true,
      unresolvedRecordDurable: true,
    }));
  }
  return transitions;
}

const SAFETY = Object.freeze([
  safety('S3-SAF-04', ({ nextState }) => check(
    !nextState.submitted || nextState.planDurable,
    'a leg was submitted before the plan was durable',
  )),
  safety('S3-SAF-06', ({ nextState }) => check(
    !['HEDGED', 'CLOSED'].includes(nextState.accounting)
      || (nextState.authoritativePostcondition
        && Number.isInteger(nextState.authoritativeFirstFilled)
        && nextState.authoritativeFirstFilled === nextState.externalFirstFilled
        && nextState.secondFilled >= nextState.authoritativeFirstFilled),
    'terminal local success lacks authoritative recovery accounting',
  )),
  safety('S3-SAF-07', ({ nextState }) => {
    const externalKnown = Number.isInteger(nextState.externalFirstFilled);
    const accounted = externalKnown
      && nextState.authoritativeFirstFilled === nextState.externalFirstFilled
      && nextState.secondFilled >= nextState.externalFirstFilled
      && nextState.authoritativePostcondition;
    const unresolved = nextState.accounting === 'UNRESOLVED'
      && nextState.liabilityExplicit
      && nextState.unresolvedRecordDurable;
    return check(
      nextState.phase !== 'TERMINAL' || nextState.externalFirstFilled === 0 || accounted || unresolved,
      'known external fill exposure was erased instead of authoritatively reconciled or durably unresolved',
    );
  }),
]);

const LIVENESS = Object.freeze([
  liveness(
    'S3-LIV-01',
    (state) => [
      'FIRST_IN_FLIGHT',
      'CANCEL_PENDING',
      'CANCEL_RESTORED',
      'AMBIGUOUS',
      'FIRST_LEG_LOOKUP',
      'RECOVERY',
      'PERSISTING_UNRESOLVED',
    ].includes(state.phase),
    (state) => TERMINAL_ACCOUNTING.has(state.accounting),
  ),
  liveness(
    'S3-LIV-03',
    (state) => state.phase === 'RESTORING',
    (state) => state.phase !== 'RESTORING' && (state.generation === 0 || state.restoredEquivalent || TERMINAL_ACCOUNTING.has(state.accounting)),
    { weakFairActions: ['RESTORE_PLAN_CHECKPOINT'] },
  ),
  liveness(
    'S3-LIV-06',
    (state) => state.submitted && !TERMINAL_ACCOUNTING.has(state.accounting),
    (state) => TERMINAL_ACCOUNTING.has(state.accounting),
  ),
]);

function create(profile) {
  return defineModel({
    modelId: 'S3-M02-TWO-LEG-RECOVERY',
    title: 'Two-leg partial fill, cancel-fill race, recovery, and durable unresolved accounting',
    profile,
    bounds: { maxStates: 256, maxTransitions: 768, maxDepth: 20 },
    initialState: INITIAL,
    enabledTransitions: (state) => transitionsFor(profile, state),
    safety: SAFETY,
    liveness: LIVENESS,
    terminal: (state) => state.phase === 'TERMINAL',
    terminalClass: (state) => `${state.accounting}_TERMINAL`,
  });
}

export const TWO_LEG_RECOVERY_MODEL = create('CANONICAL');
export const TWO_LEG_RECOVERY_MUTANT = create('ERASE_FILL_ON_CANCEL');

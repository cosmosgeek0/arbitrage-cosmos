import {
  BASE_ASSUMPTIONS,
  check,
  defineModel,
  liveness,
  next,
  safety,
} from './common.mjs';

const INITIAL = Object.freeze({
  phase: 'IDLE',
  lifecycle: 'PROBE',
  halt: 'OPEN',
  pendingAction: 'NONE',
  quantity: 0,
  observedUsage: 0,
  authorizationCeiling: 3,
  repairActive: false,
  capitalAtRepairEntry: 3,
  capitalAuthorization: 3,
  truth: 'EXACT',
  riskIncreasingAuthorized: false,
  replacementWhilePending: false,
  authoritativePostcondition: false,
  sendCount: 0,
  executorCount: 0,
  externalLiability: 0,
  verdict: 'UNKNOWN',
});

function enterRecovery(state, patch = {}) {
  return {
    ...patch,
    phase: 'RECOVERY',
    lifecycle: 'RECOVERY_REQUIRED',
    pendingAction: 'NONE',
    repairActive: true,
    capitalAtRepairEntry: state.capitalAuthorization,
    truth: 'UNKNOWN',
    riskIncreasingAuthorized: false,
    verdict: 'UNKNOWN',
  };
}

function transitionsFor(profile, state) {
  switch (state.phase) {
    case 'IDLE':
      return [
        next(state, 'PLAN_RECORD_ONLY_PROBE_ENTRY', {
          phase: 'PENDING_ENTRY', lifecycle: 'PROBE', pendingAction: 'ENTRY', riskIncreasingAuthorized: true,
        }),
        next(state, 'OBSERVE_VOLUME_HALT_WHILE_FLAT', {
          phase: 'TERMINAL', lifecycle: 'ABSENT', halt: 'HALT', verdict: 'BLOCKED',
        }),
        next(state, 'OBSERVE_UNKNOWN_ENTRY_GATE', {
          phase: 'TERMINAL', lifecycle: 'ABSENT', truth: 'UNKNOWN', riskIncreasingAuthorized: false,
          verdict: 'BLOCKED',
        }),
      ];
    case 'PENDING_ENTRY':
      return [
        next(state, 'SETTLE_ENTRY_FULL', {
          phase: 'PROBE', lifecycle: 'PROBE', pendingAction: 'NONE', quantity: 1, observedUsage: 1,
          riskIncreasingAuthorized: false, authoritativePostcondition: true, truth: 'EXACT',
        }),
        next(state, 'SETTLE_ENTRY_NO_FILL', {
          phase: 'TERMINAL', lifecycle: 'EXIT', pendingAction: 'NONE', riskIncreasingAuthorized: false,
          authoritativePostcondition: true, truth: 'EXACT', verdict: 'SETTLED',
        }),
        next(state, 'ENTRY_TWIN_UNKNOWN', enterRecovery(state)),
        next(state, 'HALT_WITH_ENTRY_PENDING', enterRecovery(state, { halt: 'HALT' })),
      ];
    case 'PROBE': {
      const transitions = [
        next(state, 'PLAN_RECORD_ONLY_CONFIRM_ADD', {
          phase: 'PENDING_CONFIRM_ADD', lifecycle: 'CONFIRM', pendingAction: 'ADD_CONFIRM', riskIncreasingAuthorized: true,
        }),
        next(state, 'PLAN_PROTECTIVE_EXIT_AT_HALT', {
          phase: 'PENDING_EXIT', lifecycle: 'EXIT', halt: 'HALT', pendingAction: 'EXIT', riskIncreasingAuthorized: false,
        }),
        next(state, 'PROBE_TRIGGER_UNKNOWN', enterRecovery(state)),
      ];
      if (profile === 'HALT_ALLOWS_ADD') transitions.push(next(state, 'MUTANT_PLAN_ADD_UNDER_HALT', {
        phase: 'PENDING_CONFIRM_ADD', lifecycle: 'CONFIRM', halt: 'HALT', pendingAction: 'ADD_CONFIRM', riskIncreasingAuthorized: true,
      }));
      return transitions;
    }
    case 'PENDING_CONFIRM_ADD':
      return [
        next(state, 'SETTLE_CONFIRM_ADD_FULL', {
          phase: 'CONFIRM', lifecycle: 'CONFIRM', pendingAction: 'NONE', quantity: state.quantity + 1,
          observedUsage: state.observedUsage + 1, riskIncreasingAuthorized: false,
          authoritativePostcondition: true, truth: 'EXACT',
        }),
        next(state, 'CONFIRM_ADD_TWIN_UNKNOWN', enterRecovery(state)),
        next(state, 'HALT_WITH_CONFIRM_ADD_PENDING', enterRecovery(state, { halt: 'HALT' })),
      ];
    case 'CONFIRM':
      return [
        next(state, 'ADMIT_ADD_ALLOWED_STAGE', { phase: 'ADD_ALLOWED', lifecycle: 'ADD_ALLOWED' }),
        next(state, 'PLAN_CONFIRM_PROTECTIVE_EXIT', {
          phase: 'PENDING_EXIT', lifecycle: 'EXIT', halt: 'HALT', pendingAction: 'EXIT', riskIncreasingAuthorized: false,
        }),
      ];
    case 'ADD_ALLOWED':
      return [
        next(state, 'PLAN_RECORD_ONLY_ADD_TO_HOLD', {
          phase: 'PENDING_HOLD_ADD', lifecycle: 'HOLD', pendingAction: 'ADD_HOLD', riskIncreasingAuthorized: true,
        }),
        next(state, 'PLAN_ADD_ALLOWED_PROTECTIVE_EXIT', {
          phase: 'PENDING_EXIT', lifecycle: 'EXIT', halt: 'HALT', pendingAction: 'EXIT', riskIncreasingAuthorized: false,
        }),
      ];
    case 'PENDING_HOLD_ADD':
      return [
        next(state, 'SETTLE_HOLD_ADD_FULL', {
          phase: 'HOLD', lifecycle: 'HOLD', pendingAction: 'NONE', quantity: state.quantity + 1,
          observedUsage: state.observedUsage + 1, riskIncreasingAuthorized: false,
          authoritativePostcondition: true, truth: 'EXACT',
        }),
        next(state, 'HOLD_ADD_TWIN_UNKNOWN', enterRecovery(state)),
        next(state, 'HALT_WITH_HOLD_ADD_PENDING', enterRecovery(state, { halt: 'HALT' })),
      ];
    case 'HOLD':
      return [
        next(state, 'PLAN_RECORD_ONLY_REDUCTION', {
          phase: 'PENDING_REDUCE', lifecycle: 'REDUCE', pendingAction: 'REDUCE', riskIncreasingAuthorized: false,
        }),
        next(state, 'PLAN_RECORD_ONLY_EXIT', {
          phase: 'PENDING_EXIT', lifecycle: 'EXIT', pendingAction: 'EXIT', riskIncreasingAuthorized: false,
        }),
        next(state, 'PLAN_HALT_PROTECTIVE_EXIT', {
          phase: 'PENDING_EXIT', lifecycle: 'EXIT', halt: 'HALT', pendingAction: 'EXIT', riskIncreasingAuthorized: false,
        }),
        next(state, 'HOLD_TRIGGER_UNKNOWN', enterRecovery(state)),
      ];
    case 'PENDING_REDUCE': {
      const quantity = Math.max(0, state.quantity - 1);
      return [
        next(state, 'SETTLE_REDUCTION_FULL', {
          phase: quantity === 0 ? 'TERMINAL' : 'REDUCE', lifecycle: quantity === 0 ? 'EXIT' : 'REDUCE',
          pendingAction: 'NONE', quantity, riskIncreasingAuthorized: false,
          authoritativePostcondition: true, truth: 'EXACT', verdict: quantity === 0 ? 'SETTLED' : 'UNKNOWN',
        }),
        next(state, 'REDUCTION_TWIN_UNKNOWN', enterRecovery(state)),
      ];
    }
    case 'REDUCE':
      return [next(state, 'PLAN_REMAINING_EXIT', {
        phase: 'PENDING_EXIT', lifecycle: 'EXIT', pendingAction: 'EXIT', riskIncreasingAuthorized: false,
      })];
    case 'PENDING_EXIT':
      return [
        next(state, 'SETTLE_EXIT_FULL', {
          phase: 'TERMINAL', lifecycle: 'EXIT', pendingAction: 'NONE', quantity: 0,
          riskIncreasingAuthorized: false, authoritativePostcondition: true, truth: 'EXACT', verdict: 'SETTLED',
        }),
        next(state, 'EXIT_TWIN_UNKNOWN', enterRecovery(state)),
      ];
    case 'RECOVERY':
      return [
        next(state, 'RESOLVE_RECOVERY_EXACT_NO_EFFECT', {
          phase: 'RECOVERED', lifecycle: 'RECOVERY_REQUIRED', pendingAction: 'NONE', repairActive: false,
          truth: 'EXACT', riskIncreasingAuthorized: false, authoritativePostcondition: true, verdict: 'BLOCKED',
        }),
        next(state, 'PERSIST_VOLUME_RECOVERY_UNRESOLVED', {
          phase: 'TERMINAL', lifecycle: 'RECOVERY_REQUIRED', pendingAction: 'NONE', repairActive: false,
          truth: 'UNKNOWN', riskIncreasingAuthorized: false, verdict: 'UNKNOWN',
        }),
      ];
    default:
      return [];
  }
}

const PENDING_PHASES = Object.freeze([
  'PENDING_ENTRY', 'PENDING_CONFIRM_ADD', 'PENDING_HOLD_ADD', 'PENDING_REDUCE', 'PENDING_EXIT',
]);

const SAFETY = Object.freeze([
  safety('S3-SAF-06', ({ nextState }) => check(
    nextState.verdict !== 'SETTLED' || nextState.authoritativePostcondition,
    'Volume lifecycle terminalized without exact twin settlement',
  )),
  safety('S3-SAF-08', ({ nextState }) => check(
    !nextState.riskIncreasingAuthorized || (nextState.halt === 'OPEN' && nextState.truth === 'EXACT'),
    'Volume lifecycle authorized ENTRY or ADD under denied or UNKNOWN posture',
  )),
  safety('S3-SAF-11', ({ nextState }) => check(
    nextState.halt !== 'HALT' || !nextState.riskIncreasingAuthorized,
    'Volume lifecycle authorized ENTRY or ADD after halt',
  )),
  safety('S3-SAF-12', ({ nextState }) => check(
    !nextState.repairActive || nextState.capitalAuthorization <= nextState.capitalAtRepairEntry,
    'Volume recovery widened its capital authorization ceiling',
  )),
  safety('S3-SAF-13', ({ nextState }) => check(
    nextState.truth !== 'UNKNOWN' || nextState.verdict !== 'SETTLED',
    'UNKNOWN Volume truth was normalized to an ordinary settled outcome',
  )),
  safety('S3-SAF-14', ({ nextState }) => check(
    !nextState.replacementWhilePending && (nextState.pendingAction === 'NONE' || PENDING_PHASES.includes(nextState.phase)),
    'Volume pending action was locally replaced instead of settled or reconciled',
  )),
  safety('S3-M11-INV-01', ({ nextState }) => check(
    nextState.sendCount === 0 && nextState.executorCount === 0 && nextState.externalLiability === 0,
    'record-only Volume model acquired send, executor, or borrow authority',
  )),
]);

const LIVENESS = Object.freeze([
  liveness(
    'S3-LIV-01',
    (state) => PENDING_PHASES.includes(state.phase),
    (state) => !PENDING_PHASES.includes(state.phase),
    {
      weakFairActions: [
        'SETTLE_ENTRY_FULL', 'SETTLE_ENTRY_NO_FILL', 'ENTRY_TWIN_UNKNOWN', 'HALT_WITH_ENTRY_PENDING',
        'SETTLE_CONFIRM_ADD_FULL', 'CONFIRM_ADD_TWIN_UNKNOWN', 'HALT_WITH_CONFIRM_ADD_PENDING',
        'SETTLE_HOLD_ADD_FULL', 'HOLD_ADD_TWIN_UNKNOWN', 'HALT_WITH_HOLD_ADD_PENDING',
        'SETTLE_REDUCTION_FULL', 'REDUCTION_TWIN_UNKNOWN', 'SETTLE_EXIT_FULL', 'EXIT_TWIN_UNKNOWN',
      ],
    },
  ),
  liveness(
    'S3-LIV-04',
    (state) => state.phase === 'RECOVERY' && state.repairActive,
    (state) => state.phase !== 'RECOVERY',
    { weakFairActions: ['RESOLVE_RECOVERY_EXACT_NO_EFFECT', 'PERSIST_VOLUME_RECOVERY_UNRESOLVED'] },
  ),
  liveness(
    'S3-LIV-06',
    (state) => state.phase === 'RECOVERY' && state.truth === 'UNKNOWN',
    (state) => state.phase !== 'RECOVERY',
    { weakFairActions: ['RESOLVE_RECOVERY_EXACT_NO_EFFECT', 'PERSIST_VOLUME_RECOVERY_UNRESOLVED'] },
  ),
]);

const ASSUMPTIONS = Object.freeze([
  ...BASE_ASSUMPTIONS,
  'SYNTHETIC_ONLY; SUPPORTING_EVIDENCE_ONLY; runtime_claim_closure is NOT_PERMITTED.',
  'The finite envelope contains one Volume position, quantity and observed usage 0..3, one pending record-only action, one halt, and one recovery cut.',
  'Halt forbids ENTRY and ADD but may plan a non-sendable protective EXIT; observed pending fills may increase measured quantity without increasing authorization.',
  'Time is abstracted into finite fresh, stale, and UNKNOWN evidence cuts; no numeric clock, ambient timer, venue query, executor, or scheduler is represented.',
  'Weak fairness applies only to continuously enabled twin-settlement or visible-unresolved alternatives and never promises venue success.',
  'Two-leg liability and runtime executor fencing are not claimed by Volume; externalLiability and executorCount remain zero by scope.',
  'capitalAuthorization and replacementWhilePending are fixed scope-exclusion sentinels because the frozen Volume reducer owns neither capital mutation nor cancel/replace authority.',
  'A failed flat entry gate returns BLOCKED with lifecycle ABSENT, representing the frozen null projection; only active lifecycle ambiguity enters RECOVERY_REQUIRED.',
]);

function create(profile) {
  return defineModel({
    modelId: 'S3-M11-VOLUME-LIFECYCLE',
    title: 'Frozen L11 Volume staging, protective exit, pending twin settlement, and bounded recovery',
    profile,
    bounds: { maxStates: 2_048, maxTransitions: 8_192, maxDepth: 32 },
    assumptions: ASSUMPTIONS,
    initialState: INITIAL,
    enabledTransitions: (state) => transitionsFor(profile, state),
    safety: SAFETY,
    liveness: LIVENESS,
    terminal: (state) => ['TERMINAL', 'RECOVERED'].includes(state.phase),
    terminalClass: (state) => `${state.lifecycle}_${state.verdict}`,
  });
}

export const VOLUME_LIFECYCLE_MODEL = create('CANONICAL');
export const VOLUME_LIFECYCLE_MUTANT = create('HALT_ALLOWS_ADD');

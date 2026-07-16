import {
  BASE_ASSUMPTIONS,
  check,
  defineModel,
  liveness,
  next,
  safety,
} from './common.mjs';

const INITIAL = Object.freeze({
  phase: 'SELECT',
  scenario: 'NONE',
  posture: 'OPEN',
  recovery: 'CLEAR',
  riskIncreasing: false,
  expectedControlRevision: 7,
  currentControlRevision: 7,
  reservedCommands: [],
  durableIntents: [],
  publishedCommands: [],
  conflictRejected: false,
  preintentAudit: 'NONE',
  journalVersion: 0,
  journalState: 'NOT_FOUND',
  generation: 0,
  resumePhase: 'NONE',
  capitalAtRepairEntry: 2,
  capitalAuthorization: 2,
  outcome: 'PENDING',
  verdict: 'UNKNOWN',
  replayCount: 0,
});

const SCENARIOS = Object.freeze([
  Object.freeze({ actionId: 'PREVIEW_SAFE_HALT_DURING_REPAIR', scenario: 'SAFE_HALT_REPAIR', posture: 'HALT', recovery: 'REPAIR', riskIncreasing: false }),
  Object.freeze({ actionId: 'PREVIEW_RISK_INCREASE_OPEN', scenario: 'RISK_OPEN', posture: 'OPEN', recovery: 'CLEAR', riskIncreasing: true }),
  Object.freeze({ actionId: 'PREVIEW_RISK_INCREASE_HALTED', scenario: 'RISK_HALTED', posture: 'HALT', recovery: 'CLEAR', riskIncreasing: true }),
  Object.freeze({ actionId: 'PREVIEW_UNKNOWN_RECOVERY', scenario: 'UNKNOWN_RECOVERY', posture: 'UNKNOWN', recovery: 'UNKNOWN', riskIncreasing: true }),
  Object.freeze({ actionId: 'PREVIEW_COMPETING_COMMANDS', scenario: 'COMPETE', posture: 'OPEN', recovery: 'CLEAR', riskIncreasing: false }),
  Object.freeze({ actionId: 'PREVIEW_WAITING_L08_ACTION', scenario: 'WAITING_L08', posture: 'OPEN', recovery: 'CLEAR', riskIncreasing: false }),
]);

function reserveC0(state) {
  return next(state, 'APPEND_DURABLE_INTENT_AND_RESERVE_REVISION', {
    phase: 'C0_RESERVED',
    currentControlRevision: 8,
    reservedCommands: ['C0'],
    durableIntents: ['C0'],
    journalVersion: 1,
    journalState: 'PENDING',
  });
}

function publishC0(state) {
  return next(state, 'PUBLISH_RESERVED_COMMAND', {
    phase: 'C0_PUBLISHED',
    publishedCommands: ['C0'],
    outcome: 'PENDING',
  });
}

function crash(state) {
  return next(state, 'CRASH_AFTER_DURABLE_CONTROL_INTENT', {
    phase: 'RESTORING',
    generation: 1,
    resumePhase: state.phase,
  });
}

function transitionsFor(profile, state) {
  if (state.phase === 'SELECT') {
    return SCENARIOS.map((scenario) => next(state, scenario.actionId, {
      phase: 'PREVIEWED',
      scenario: scenario.scenario,
      posture: scenario.posture,
      recovery: scenario.recovery,
      riskIncreasing: scenario.riskIncreasing,
      capitalAtRepairEntry: state.capitalAuthorization,
    }));
  }
  if (state.phase === 'PREVIEWED') {
    if (state.scenario === 'RISK_HALTED') return [next(state, 'AUDIT_PREINTENT_HALT_REJECTION', {
      phase: 'TERMINAL', preintentAudit: 'ATTEMPTED_RESULT_UNKNOWN',
      outcome: 'PREINTENT_REJECTED', verdict: 'BLOCKED',
    })];
    if (state.scenario === 'UNKNOWN_RECOVERY') return [next(state, 'AUDIT_PREINTENT_UNKNOWN_REJECTION', {
      phase: 'TERMINAL', preintentAudit: 'ATTEMPTED_RESULT_UNKNOWN',
      outcome: 'PREINTENT_REJECTED', verdict: 'UNKNOWN',
    })];
    if (state.scenario === 'WAITING_L08') return [next(state, 'RETURN_WAITING_L08_WITHOUT_PUBLICATION', {
      phase: 'TERMINAL', preintentAudit: 'ATTEMPTED_RESULT_UNKNOWN',
      outcome: 'WAITING_L08', verdict: 'BLOCKED',
    })];
    return [reserveC0(state)];
  }
  if (state.phase === 'C0_RESERVED') {
    const transitions = [
      publishC0(state),
      next(state, 'EXPIRE_AFTER_INTENT_AND_FINALIZE_REJECTED', {
        phase: 'REPLAY_READY', journalVersion: 2, journalState: 'REJECTED',
        outcome: 'REJECTED', verdict: 'BLOCKED',
      }),
      next(state, 'EXPIRE_AFTER_INTENT_FINALIZATION_FAILURE', {
        phase: 'TERMINAL', journalVersion: 1, journalState: 'PENDING',
        outcome: 'PENDING_AMBIGUOUS', verdict: 'UNKNOWN',
      }),
    ];
    if (state.generation === 0) transitions.push(crash(state));
    if (state.scenario === 'COMPETE' && !state.conflictRejected) {
      if (profile === 'NON_ATOMIC_CONTROL_REVISION_RESERVATION') transitions.push(next(state, 'MUTANT_RESERVE_C1_SAME_REVISION', {
        phase: 'BOTH_RESERVED', reservedCommands: ['C0', 'C1'], durableIntents: ['C0', 'C1'],
      }));
      else transitions.push(next(state, 'REJECT_C1_VERSION_CONFLICT', {
        phase: 'C0_RESERVED_CONFLICT', conflictRejected: true,
      }));
    }
    return transitions;
  }
  if (state.phase === 'C0_RESERVED_CONFLICT') {
    const transitions = [publishC0(state)];
    if (state.generation === 0) transitions.push(crash(state));
    return transitions;
  }
  if (state.phase === 'BOTH_RESERVED') {
    return [next(state, 'MUTANT_PUBLISH_BOTH_COMMANDS', {
      phase: 'C0_PUBLISHED', publishedCommands: ['C0', 'C1'], outcome: 'PENDING',
    })];
  }
  if (state.phase === 'C0_PUBLISHED') {
    const transitions = [
      next(state, 'FINALIZE_APPLIED_CONTROL_OUTCOME', {
        phase: 'REPLAY_READY', journalVersion: 2, journalState: 'COMPLETED', outcome: 'APPLIED', verdict: 'PASS',
      }),
      next(state, 'FINALIZE_KNOWN_OWNER_REJECTION', {
        phase: 'REPLAY_READY', journalVersion: 2, journalState: 'REJECTED', outcome: 'REJECTED', verdict: 'BLOCKED',
      }),
      next(state, 'KNOWN_OWNER_REJECTION_FINALIZATION_FAILURE', {
        phase: 'TERMINAL', journalVersion: 1, journalState: 'PENDING', outcome: 'PENDING_AMBIGUOUS', verdict: 'UNKNOWN',
      }),
      next(state, 'OWNER_THROW_REMAINS_PENDING', {
        phase: 'TERMINAL', journalVersion: 1, journalState: 'PENDING', outcome: 'PENDING_AMBIGUOUS', verdict: 'UNKNOWN',
      }),
      next(state, 'TERMINAL_APPEND_FAILURE_REMAINS_PENDING', {
        phase: 'TERMINAL', journalVersion: 1, journalState: 'PENDING', outcome: 'PENDING_AMBIGUOUS', verdict: 'UNKNOWN',
      }),
      next(state, 'POST_PUBLICATION_EXPIRY_REMAINS_PENDING', {
        phase: 'TERMINAL', journalVersion: 1, journalState: 'PENDING', outcome: 'PENDING_AMBIGUOUS', verdict: 'UNKNOWN',
      }),
    ];
    if (state.generation === 0) transitions.push(crash(state));
    return transitions;
  }
  if (state.phase === 'RESTORING') return [next(state, 'RELOAD_DURABLE_CONTROL_LOOKUP', {
    phase: state.resumePhase,
  })];
  if (state.phase === 'REPLAY_READY') return [next(state, 'REPLAY_TERMINAL_CONTROL_RESULT', {
    phase: 'TERMINAL', replayCount: 1,
  })];
  return [];
}

const SAFETY = Object.freeze([
  safety('S3-SAF-01', ({ nextState }) => check(
    nextState.reservedCommands.length <= 1 && nextState.publishedCommands.length <= 1,
    'two commands reserved or published from one expected control revision',
  )),
  safety('S3-SAF-04', ({ nextState }) => check(
    nextState.publishedCommands.every((commandId) => nextState.durableIntents.includes(commandId)),
    'control owner publication occurred before its durable intent',
  )),
  safety('S3-SAF-08', ({ nextState }) => check(
    !nextState.riskIncreasing || nextState.publishedCommands.length === 0
      || (nextState.posture === 'OPEN' && nextState.recovery === 'CLEAR'),
    'risk-increasing control publication bypassed halt, repair, or UNKNOWN posture',
  )),
  safety('S3-SAF-11', ({ nextState }) => check(
    nextState.posture !== 'HALT' || !nextState.riskIncreasing || nextState.publishedCommands.length === 0,
    'risk-increasing command published after halt',
  )),
  safety('S3-SAF-12', ({ nextState }) => check(
    nextState.recovery !== 'REPAIR' || nextState.capitalAuthorization <= nextState.capitalAtRepairEntry,
    'control repair posture widened capital authorization',
  )),
  safety('S3-SAF-13', ({ nextState }) => check(
    nextState.recovery !== 'UNKNOWN' && nextState.posture !== 'UNKNOWN' || nextState.verdict !== 'PASS',
    'UNKNOWN control posture was normalized to PASS',
  )),
  safety('S3-M13-INV-01', ({ nextState }) => check(
    nextState.currentControlRevision <= 8
      && nextState.reservedCommands.length <= 1
      && nextState.publishedCommands.length <= 1,
    'global control revision reservation was not atomic',
  )),
  safety('S3-M13-INV-02', ({ previousState, nextState }) => check(
    (previousState === null
      || (nextState.journalVersion >= previousState.journalVersion
        && nextState.journalVersion - previousState.journalVersion <= 1))
      && (nextState.journalVersion !== 1 || nextState.journalState === 'PENDING')
      && (nextState.journalVersion !== 2 || ['COMPLETED', 'REJECTED'].includes(nextState.journalState))
      && (nextState.journalVersion !== 0 || nextState.publishedCommands.length === 0)
      && (!['PREINTENT_REJECTED', 'WAITING_L08'].includes(nextState.outcome)
        || (nextState.preintentAudit === 'ATTEMPTED_RESULT_UNKNOWN'
          && nextState.journalVersion === 0
          && nextState.reservedCommands.length === 0
          && nextState.publishedCommands.length === 0)),
    'control journal version and phase diverged',
  )),
  safety('S3-M13-INV-03', ({ previousState, actionId, nextState }) => check(
    nextState.replayCount <= 1
      && (actionId !== 'REPLAY_TERMINAL_CONTROL_RESULT'
        || (previousState !== null
          && nextState.publishedCommands.length === previousState.publishedCommands.length)),
    'terminal replay republished the owner command',
  )),
]);

const LIVENESS = Object.freeze([
  liveness(
    'S3-LIV-01',
    (state) => state.journalVersion === 1 && state.outcome === 'PENDING',
    (state) => ['APPLIED', 'REJECTED', 'PENDING_AMBIGUOUS'].includes(state.outcome),
    {
      weakFairActions: [
        'PUBLISH_RESERVED_COMMAND', 'MUTANT_PUBLISH_BOTH_COMMANDS', 'RELOAD_DURABLE_CONTROL_LOOKUP',
        'EXPIRE_AFTER_INTENT_AND_FINALIZE_REJECTED', 'EXPIRE_AFTER_INTENT_FINALIZATION_FAILURE',
        'FINALIZE_APPLIED_CONTROL_OUTCOME', 'OWNER_THROW_REMAINS_PENDING',
        'FINALIZE_KNOWN_OWNER_REJECTION', 'KNOWN_OWNER_REJECTION_FINALIZATION_FAILURE',
        'TERMINAL_APPEND_FAILURE_REMAINS_PENDING', 'POST_PUBLICATION_EXPIRY_REMAINS_PENDING',
      ],
    },
  ),
  liveness(
    'S3-LIV-03',
    (state) => state.phase === 'RESTORING',
    (state) => state.phase !== 'RESTORING',
    { weakFairActions: ['RELOAD_DURABLE_CONTROL_LOOKUP'] },
  ),
  liveness(
    'S3-M13-LIV-01',
    (state) => state.phase === 'REPLAY_READY',
    (state) => state.phase === 'TERMINAL' && state.replayCount === 1,
    { weakFairActions: ['REPLAY_TERMINAL_CONTROL_RESULT'] },
  ),
]);

const ASSUMPTIONS = Object.freeze([
  ...BASE_ASSUMPTIONS,
  'SYNTHETIC_ONLY; SUPPORTING_EVIDENCE_ONLY; runtime_claim_closure is NOT_PERMITTED.',
  'The finite envelope contains command IDs C0/C1, expected revision 7, reserved revision 8, journal versions 0..2, one owner publication, and one crash.',
  'A represented successful persistence acknowledgement atomically appends the durable intent and reserves expectedControlRevision plus one.',
  'Clock order is abstracted into pre-intent, post-intent/pre-publication, and post-publication expiry cuts; monotonic cut order is assumed and no numeric clock is represented.',
  'Weak fairness applies only to continuously enabled publication, known-outcome finalization, durable lookup reload, and exact replay return.',
  'Frozen L14 is built-and-tested but unwired: CanonicalControlPersistencePort is a contract and the atomic reducer exists only in the synthetic harness.',
  'Pre-intent and WAITING_L08 auditRejection calls are best-effort separate audit attempts: their durability is not observed, they do not reserve the command journal, and failure remains fail-closed.',
]);

function create(profile) {
  return defineModel({
    modelId: 'S3-M13-DURABLE-CONTROL-REVISION',
    title: 'Durable control intent, atomic global revision reservation, owner publication, ambiguity, and replay',
    profile,
    bounds: { maxStates: 2_048, maxTransitions: 8_192, maxDepth: 24 },
    assumptions: ASSUMPTIONS,
    initialState: INITIAL,
    enabledTransitions: (state) => transitionsFor(profile, state),
    safety: SAFETY,
    liveness: LIVENESS,
    terminal: (state) => state.phase === 'TERMINAL',
    terminalClass: (state) => `${state.scenario}_${state.outcome}`,
  });
}

export const DURABLE_CONTROL_REVISION_MODEL = create('CANONICAL');
export const DURABLE_CONTROL_REVISION_MUTANT = create('NON_ATOMIC_CONTROL_REVISION_RESERVATION');

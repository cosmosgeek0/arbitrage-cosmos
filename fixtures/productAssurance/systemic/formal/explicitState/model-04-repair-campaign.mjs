import { check, defineModel, liveness, next, safety } from './common.mjs';

const TERMINAL_PHASES = new Set([
  'RECOVERED',
  'COMPENSATED',
  'QUARANTINED',
  'FAILED_ATTENTION_REQUIRED',
  'DURABLE_UNRESOLVED',
]);

const INITIAL = Object.freeze({
  phase: 'DETECTED',
  recordDurable: false,
  attempts: 0,
  maxAttempts: 2,
  generation: 0,
  resourceEpoch: 0,
  owner: 'NONE',
  authorizedEpochs: [],
  oldOwnerAuthorized: false,
  lostOwner: false,
  actionCommitted: false,
  completionEpoch: null,
  compensationFenceAcquired: false,
  compensationCommitEpoch: null,
  staleCompletionAvailable: false,
  staleCompletionRejected: false,
  independentPostcondition: 'NONE',
  quietTicks: 0,
  incidentOpen: true,
  outcome: 'PENDING',
});

function transitionsFor(profile, state) {
  const transitions = [];
  if (state.phase === 'DETECTED') transitions.push(next(state, 'PERSIST_CAMPAIGN', { phase: 'CONTAINING', recordDurable: true }));
  if (state.phase === 'CONTAINING') transitions.push(next(state, 'CONTAIN_EFFECT', { phase: 'DIAGNOSING' }));
  if (state.phase === 'DIAGNOSING') transitions.push(next(state, 'PLAN_REPAIR', { phase: 'PLANNED' }));
  if (state.phase === 'PLANNED') {
    if (state.attempts < state.maxAttempts) {
      const epoch = state.resourceEpoch + 1;
      transitions.push(next(state, 'ACQUIRE_REPAIR_FENCE', {
        phase: 'EXECUTING',
        resourceEpoch: epoch,
        owner: state.generation === 0 ? 'P0' : 'P1',
        authorizedEpochs: [epoch],
        oldOwnerAuthorized: state.generation === 0,
        attempts: state.attempts + 1,
      }));
    } else {
      transitions.push(next(state, 'EXHAUSTED_REPAIR_BUDGET', { phase: 'ROLLING_BACK' }));
    }
  }
  if (state.phase === 'EXECUTING') {
    if (state.staleCompletionAvailable && !state.staleCompletionRejected) {
      transitions.push(next(state, 'REJECT_STALE_COMPLETION', {
        staleCompletionAvailable: false,
        staleCompletionRejected: true,
      }));
    }
    if (!state.staleCompletionAvailable) {
      if (profile === 'SELF_REPORT_RECOVERY') {
        transitions.push(next(state, 'SELF_REPORT_FALSE_RECOVERY', {
          phase: 'RECOVERED',
          actionCommitted: true,
          completionEpoch: state.resourceEpoch,
          incidentOpen: false,
          outcome: 'RECOVERED',
        }));
      } else {
        transitions.push(next(state, 'ACTION_SUCCEEDED', {
          phase: 'VERIFYING', actionCommitted: true, completionEpoch: state.resourceEpoch,
        }));
      }
      transitions.push(
        next(state, 'ACTION_PERMANENT_FAILURE', { phase: 'ROLLING_BACK' }),
        next(state, 'ACTION_TRANSIENT_FAILURE', { phase: state.attempts < state.maxAttempts ? 'RETRY_WAIT' : 'ROLLING_BACK' }),
      );
      if (state.generation === 0) {
        transitions.push(next(state, 'CRASH_DURING_REPAIR', {
          phase: 'RESTORING',
          generation: 1,
          owner: 'NONE',
          authorizedEpochs: [],
          oldOwnerAuthorized: false,
          lostOwner: true,
          staleCompletionAvailable: true,
        }));
      }
    }
  }
  if (state.phase === 'RETRY_WAIT') {
    if (state.attempts < state.maxAttempts) {
      transitions.push(next(state, 'RETRY_WITHIN_BUDGET', { phase: 'EXECUTING', attempts: state.attempts + 1 }));
    } else {
      transitions.push(next(state, 'EXHAUSTED_RETRY_BUDGET', { phase: 'ROLLING_BACK' }));
    }
  }
  if (state.phase === 'RESTORING') {
    transitions.push(next(state, 'RESTORE_DURABLE_CAMPAIGN', {
      phase: state.attempts < state.maxAttempts ? 'PLANNED' : 'ROLLING_BACK',
    }));
  }
  if (state.phase === 'VERIFYING') {
    transitions.push(
      next(state, 'INDEPENDENT_POSTCONDITION_PASS', { phase: 'QUIET_PERIOD', independentPostcondition: 'PASS' }),
      next(state, 'INDEPENDENT_POSTCONDITION_FAIL', { phase: 'ROLLING_BACK', independentPostcondition: 'FAIL' }),
      next(state, 'INDEPENDENT_POSTCONDITION_UNAVAILABLE', { phase: 'QUARANTINED', independentPostcondition: 'UNKNOWN', outcome: 'QUARANTINED' }),
    );
  }
  if (state.phase === 'QUIET_PERIOD' && state.quietTicks === 0) {
    transitions.push(next(state, 'OBSERVE_QUIET_PERIOD', { quietTicks: 1 }));
  }
  if (state.phase === 'QUIET_PERIOD' && state.quietTicks >= 1) {
    transitions.push(next(state, 'PROMOTE_RECOVERED', { phase: 'RECOVERED', incidentOpen: false, outcome: 'RECOVERED' }));
  }
  if (state.phase === 'ROLLING_BACK') {
    transitions.push(
      next(state, 'ACQUIRE_COMPENSATION_FENCE', {
        phase: 'COMPENSATING',
        resourceEpoch: state.resourceEpoch + 1,
        owner: state.generation === 0 ? 'P0' : 'P1',
        authorizedEpochs: [state.resourceEpoch + 1],
        oldOwnerAuthorized: false,
        compensationFenceAcquired: true,
      }),
      next(state, 'QUARANTINE_CAMPAIGN', { phase: 'QUARANTINED', outcome: 'QUARANTINED' }),
      next(state, 'ESCALATE_ATTENTION', { phase: 'FAILED_ATTENTION_REQUIRED', outcome: 'FAILED_ATTENTION_REQUIRED' }),
      next(state, 'PERSIST_DURABLE_UNRESOLVED', { phase: 'DURABLE_UNRESOLVED', outcome: 'DURABLE_UNRESOLVED' }),
    );
  }
  if (state.phase === 'COMPENSATING') {
    transitions.push(
      next(state, 'COMPENSATION_SUCCEEDED', {
        phase: 'COMPENSATED',
        compensationCommitEpoch: state.resourceEpoch,
        outcome: 'COMPENSATED',
      }),
      next(state, 'COMPENSATION_FAILED', {
        phase: 'COMPENSATION_FAILED',
        compensationCommitEpoch: state.resourceEpoch,
        outcome: 'PENDING',
      }),
    );
  }
  if (state.phase === 'COMPENSATION_FAILED') {
    transitions.push(
      next(state, 'QUARANTINE_AFTER_COMPENSATION_FAILURE', { phase: 'QUARANTINED', outcome: 'QUARANTINED' }),
      next(state, 'ESCALATE_AFTER_COMPENSATION_FAILURE', { phase: 'FAILED_ATTENTION_REQUIRED', outcome: 'FAILED_ATTENTION_REQUIRED' }),
      next(state, 'PERSIST_UNRESOLVED_AFTER_COMPENSATION_FAILURE', { phase: 'DURABLE_UNRESOLVED', outcome: 'DURABLE_UNRESOLVED' }),
    );
  }
  return transitions;
}

const SAFETY = Object.freeze([
  safety('S3-SAF-01', ({ actionId, nextState }) => {
    const repairCommit = ['ACTION_SUCCEEDED', 'SELF_REPORT_FALSE_RECOVERY'].includes(actionId);
    const compensationCommit = ['COMPENSATION_SUCCEEDED', 'COMPENSATION_FAILED'].includes(actionId);
    const repairCommitIsCurrent = !repairCommit
      || (nextState.completionEpoch === nextState.resourceEpoch
        && nextState.owner !== 'NONE'
        && nextState.authorizedEpochs.includes(nextState.completionEpoch));
    const compensationCommitIsCurrent = !compensationCommit
      || (nextState.compensationFenceAcquired
        && nextState.compensationCommitEpoch === nextState.resourceEpoch
        && nextState.owner !== 'NONE'
        && nextState.authorizedEpochs.includes(nextState.compensationCommitEpoch));
    return check(
      nextState.authorizedEpochs.length <= 1
        && (nextState.authorizedEpochs.length === 0 || nextState.authorizedEpochs[0] === nextState.resourceEpoch)
        && repairCommitIsCurrent
        && compensationCommitIsCurrent,
      'repair authorization or effect commit used a non-current fencing epoch',
    );
  }),
  safety('S3-SAF-02', ({ actionId, nextState }) => {
    const repairCommit = ['ACTION_SUCCEEDED', 'SELF_REPORT_FALSE_RECOVERY'].includes(actionId);
    return check(
      (nextState.completionEpoch === null || nextState.completionEpoch <= nextState.resourceEpoch)
        && (!repairCommit || nextState.completionEpoch === nextState.resourceEpoch)
        && (actionId !== 'REJECT_STALE_COMPLETION'
          || (nextState.staleCompletionRejected && !nextState.staleCompletionAvailable)),
      'stale repair completion was accepted after fencing handoff',
    );
  }),
  safety('S3-SAF-06', ({ nextState }) => check(
    nextState.phase !== 'RECOVERED'
      || (nextState.actionCommitted && nextState.independentPostcondition === 'PASS' && nextState.quietTicks >= 1),
    'repair action completion was mistaken for authoritative recovery',
  )),
  safety('S3-SAF-09', ({ nextState }) => check(
    nextState.incidentOpen
      || (nextState.phase === 'RECOVERED' && nextState.independentPostcondition === 'PASS' && nextState.quietTicks >= 1),
    'incident cleared before independent postcondition and quiet period',
  )),
  safety('S3-M04-INV-01', ({ nextState }) => check(
    nextState.attempts <= nextState.maxAttempts,
    'repair campaign exceeded its durable attempt budget',
  )),
]);

const LIVENESS = Object.freeze([
  liveness(
    'S3-LIV-03',
    (state) => state.phase === 'RESTORING',
    (state) => state.phase !== 'RESTORING' && state.recordDurable,
    { weakFairActions: ['RESTORE_DURABLE_CAMPAIGN'] },
  ),
  liveness(
    'S3-LIV-04',
    (state) => state.recordDurable && !TERMINAL_PHASES.has(state.phase),
    (state) => TERMINAL_PHASES.has(state.phase),
  ),
  liveness(
    'S3-LIV-06',
    (state) => state.actionCommitted && !TERMINAL_PHASES.has(state.phase),
    (state) => TERMINAL_PHASES.has(state.phase),
  ),
]);

function create(profile) {
  return defineModel({
    modelId: 'S3-M04-REPAIR-CAMPAIGN',
    title: 'Bounded repair retry, crash/restart, independent verification, rollback, and quarantine',
    profile,
    bounds: { maxStates: 2_048, maxTransitions: 8_192, maxDepth: 28 },
    initialState: INITIAL,
    enabledTransitions: (state) => transitionsFor(profile, state),
    safety: SAFETY,
    liveness: LIVENESS,
    terminal: (state) => TERMINAL_PHASES.has(state.phase),
    terminalClass: (state) => `${state.outcome}_TERMINAL`,
  });
}

export const REPAIR_CAMPAIGN_MODEL = create('CANONICAL');
export const REPAIR_CAMPAIGN_MUTANT = create('SELF_REPORT_RECOVERY');

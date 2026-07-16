import { check, defineModel, liveness, next, safety } from './common.mjs';

const INITIAL = Object.freeze({
  phase: 'IDLE',
  kind: 'NONE',
  cancelRequested: false,
  cancelObserved: false,
  cancellationObligation: false,
  durableIntent: false,
  externalDispatched: false,
  effectCommitted: false,
  generation: 0,
  currentEpoch: 1,
  owner: 'P0',
  authorizedEpochs: [1],
  oldOwnerAuthorized: true,
  lostOwner: false,
  lastCommitEpoch: null,
  staleCallbackRejected: false,
  reporterContextStale: false,
  receipt: 'NONE',
  durableFactAccepted: false,
  authoritativePostcondition: false,
  externalTruth: 'UNKNOWN',
  outcome: 'PENDING',
});

function transitionsFor(profile, state) {
  const transitions = [];
  if (state.phase === 'IDLE') {
    transitions.push(
      next(state, 'SELECT_LOCAL_CHILD', { phase: 'LOCAL_READY', kind: 'LOCAL_CHILD' }),
      next(state, 'SELECT_EXTERNAL_MUTATION', { phase: 'EXTERNAL_READY', kind: 'EXTERNAL_MUTATION' }),
    );
  }
  if (state.phase === 'LOCAL_READY') transitions.push(next(state, 'START_LOCAL_CHILD', { phase: 'LOCAL_RUNNING' }));
  if (state.phase === 'LOCAL_RUNNING') {
    transitions.push(
      next(state, 'REQUEST_LOCAL_CANCEL', { phase: 'LOCAL_CANCEL_REQUESTED', cancelRequested: true }),
      next(state, 'ENTER_LOCAL_PRECOMMIT', { phase: 'LOCAL_PRECOMMIT' }),
    );
  }
  if (state.phase === 'LOCAL_PRECOMMIT') {
    transitions.push(
      next(state, 'COMMIT_LOCAL_EFFECT', { phase: 'TERMINAL', effectCommitted: true, outcome: 'LOCAL_DONE' }),
      next(state, 'REQUEST_CANCEL_BEFORE_COMMIT', { phase: 'LOCAL_CANCEL_REQUESTED', cancelRequested: true }),
    );
  }
  if (state.phase === 'LOCAL_CANCEL_REQUESTED') {
    transitions.push(
      next(state, 'OBSERVE_LOCAL_CANCEL', { phase: 'LOCAL_CANCEL_OBSERVED', cancelObserved: true, cancellationObligation: true }),
      next(state, 'COMMIT_BEFORE_CANCEL_OBSERVED', { phase: 'TERMINAL', effectCommitted: true, outcome: 'LOCAL_DONE' }),
    );
  }
  if (state.phase === 'LOCAL_CANCEL_OBSERVED') {
    transitions.push(next(state, 'STOP_CANCELLED_CHILD', { phase: 'TERMINAL', outcome: 'CANCELLED', cancellationObligation: false }));
    if (profile === 'LOCAL_EFFECT_AFTER_OBSERVED_CANCEL') {
      transitions.push(next(state, 'COMMIT_AFTER_OBSERVED_CANCEL', { phase: 'TERMINAL', effectCommitted: true, outcome: 'LOCAL_DONE' }));
    }
  }

  if (state.phase === 'EXTERNAL_READY') {
    transitions.push(next(state, 'PERSIST_EXTERNAL_INTENT', { phase: 'EXTERNAL_INTENT_DURABLE', durableIntent: true }));
  }
  if (state.phase === 'EXTERNAL_INTENT_DURABLE') {
    transitions.push(next(state, 'DISPATCH_NONCANCELLABLE_EFFECT', { phase: 'EXTERNAL_DISPATCHED', externalDispatched: true }));
  }
  if (state.phase === 'EXTERNAL_DISPATCHED') {
    transitions.push(
      next(state, 'REQUEST_PARENT_CANCEL', { phase: 'EXTERNAL_CANCEL_REQUESTED', cancelRequested: true }),
      next(state, 'EXTERNAL_ACK_APPLIED', {
        phase: 'RECONCILING',
        externalTruth: 'APPLIED',
        receipt: 'DURABLE',
        lastCommitEpoch: state.currentEpoch,
      }),
    );
    if (state.generation === 0) transitions.push(next(state, 'CRASH_AFTER_EXTERNAL_DISPATCH', {
      phase: 'RESTORING', generation: 1, lostOwner: true, owner: 'NONE', authorizedEpochs: [], oldOwnerAuthorized: false,
    }));
  }
  if (state.phase === 'EXTERNAL_CANCEL_REQUESTED') {
    transitions.push(next(state, 'DETACH_FENCED_RECONCILIATION', { phase: 'DETACHED_RECONCILING' }));
  }
  if (state.phase === 'RESTORING') {
    transitions.push(next(state, 'RESTORE_DETACHED_RECONCILIATION', { phase: 'DETACHED_RECONCILING' }));
  }
  if (state.phase === 'DETACHED_RECONCILING') {
    transitions.push(next(state, 'HANDOFF_RECONCILIATION_EPOCH', {
      phase: 'DETACHED_CURRENT', currentEpoch: 2, owner: 'P1', authorizedEpochs: [2], oldOwnerAuthorized: false, lostOwner: true,
    }));
  }
  if (state.phase === 'DETACHED_CURRENT') {
    if (!state.staleCallbackRejected) {
      transitions.push(next(state, 'REJECT_STALE_AUTHORITY_CALLBACK', { staleCallbackRejected: true }));
    }
    transitions.push(
      next(state, 'ACCEPT_STALE_REPORTER_DURABLE_FACT', {
        phase: 'RECONCILING',
        reporterContextStale: true,
        receipt: 'DURABLE',
        durableFactAccepted: true,
        externalTruth: 'APPLIED',
        lastCommitEpoch: state.currentEpoch,
      }),
      next(state, 'DETACHED_LOOKUP_APPLIED', {
        phase: 'TERMINAL', receipt: 'DURABLE', externalTruth: 'APPLIED', authoritativePostcondition: true, effectCommitted: true, lastCommitEpoch: 2, outcome: 'APPLIED',
      }),
      next(state, 'DETACHED_LOOKUP_ABSENT', {
        phase: 'TERMINAL', receipt: 'DURABLE', externalTruth: 'NOT_APPLIED', authoritativePostcondition: true, lastCommitEpoch: 2, outcome: 'NOT_APPLIED',
      }),
      next(state, 'DETACHED_LOOKUP_UNAVAILABLE', {
        phase: 'TERMINAL', receipt: 'DURABLE', lastCommitEpoch: state.currentEpoch, outcome: 'UNRESOLVED',
      }),
    );
  }
  if (state.phase === 'RECONCILING') {
    if (state.externalTruth !== 'NOT_APPLIED') {
      transitions.push(next(state, 'RECONCILE_EXTERNAL_APPLIED', {
        phase: 'TERMINAL', receipt: 'DURABLE', externalTruth: 'APPLIED', authoritativePostcondition: true, effectCommitted: true, lastCommitEpoch: state.currentEpoch, outcome: 'APPLIED',
      }));
    }
    if (state.externalTruth !== 'APPLIED') {
      transitions.push(next(state, 'RECONCILE_EXTERNAL_ABSENT', {
        phase: 'TERMINAL', receipt: 'DURABLE', externalTruth: 'NOT_APPLIED', authoritativePostcondition: true, lastCommitEpoch: state.currentEpoch, outcome: 'NOT_APPLIED',
      }));
    }
    transitions.push(next(state, 'RECONCILE_EXTERNAL_UNAVAILABLE', {
      phase: 'TERMINAL', receipt: 'DURABLE', lastCommitEpoch: state.currentEpoch, outcome: 'UNRESOLVED',
    }));
  }
  return transitions;
}

const SAFETY = Object.freeze([
  safety('S3-SAF-01', ({ actionId, nextState }) => {
    const commitAction = [
      'DETACHED_LOOKUP_APPLIED',
      'DETACHED_LOOKUP_ABSENT',
      'DETACHED_LOOKUP_UNAVAILABLE',
      'EXTERNAL_ACK_APPLIED',
      'ACCEPT_STALE_REPORTER_DURABLE_FACT',
      'RECONCILE_EXTERNAL_APPLIED',
      'RECONCILE_EXTERNAL_ABSENT',
      'RECONCILE_EXTERNAL_UNAVAILABLE',
    ].includes(actionId);
    const commitIsCurrent = !commitAction
      || (nextState.lastCommitEpoch === nextState.currentEpoch
        && nextState.authorizedEpochs.includes(nextState.lastCommitEpoch));
    return check(
      nextState.authorizedEpochs.length <= 1
        && (nextState.authorizedEpochs.length === 0 || nextState.authorizedEpochs[0] === nextState.currentEpoch)
        && commitIsCurrent,
      'detached reconciliation authorization or commit used a non-current epoch',
    );
  }),
  safety('S3-SAF-02', ({ nextState }) => check(
    nextState.lastCommitEpoch === null || nextState.lastCommitEpoch === nextState.currentEpoch,
    'stale callback committed canonical state after handoff',
  )),
  safety('S3-SAF-03', ({ previousState, nextState }) => check(
    !(previousState?.receipt === 'DURABLE' && previousState.externalTruth === 'APPLIED' && nextState.externalTruth !== 'APPLIED')
      && (!nextState.reporterContextStale || (nextState.receipt === 'DURABLE' && nextState.durableFactAccepted)),
    'durably received fact was discarded solely because reporter context was stale',
  )),
  safety('S3-SAF-04', ({ nextState }) => check(
    !nextState.externalDispatched || nextState.durableIntent,
    'non-cancellable external mutation dispatched without durable intent',
  )),
  safety('S3-SAF-06', ({ nextState }) => check(
    !['APPLIED', 'NOT_APPLIED'].includes(nextState.outcome) || nextState.authoritativePostcondition,
    'external operation reached local success without authoritative postcondition',
  )),
]);

const LIVENESS = Object.freeze([
  liveness(
    'S3-LIV-03',
    (state) => state.phase === 'RESTORING',
    (state) => state.phase !== 'RESTORING' && state.durableIntent,
    { weakFairActions: ['RESTORE_DETACHED_RECONCILIATION'] },
  ),
  liveness(
    'S3-LIV-05',
    (state) => state.cancellationObligation,
    (state) => !state.cancellationObligation && state.phase === 'TERMINAL' && state.outcome === 'CANCELLED' && !state.effectCommitted,
    { weakFairActions: ['STOP_CANCELLED_CHILD'] },
  ),
  liveness(
    'S3-LIV-06',
    (state) => state.externalDispatched && state.outcome === 'PENDING',
    (state) => ['APPLIED', 'NOT_APPLIED', 'UNRESOLVED'].includes(state.outcome),
  ),
]);

function create(profile) {
  return defineModel({
    modelId: 'S3-M07-CANCELLATION-BOUNDARY',
    title: 'Cancellable child work versus non-cancellable external mutation and detached fenced reconciliation',
    profile,
    bounds: { maxStates: 1_024, maxTransitions: 4_096, maxDepth: 24 },
    initialState: INITIAL,
    enabledTransitions: (state) => transitionsFor(profile, state),
    safety: SAFETY,
    liveness: LIVENESS,
    terminal: (state) => state.phase === 'TERMINAL',
    terminalClass: (state) => `${state.outcome}_TERMINAL`,
  });
}

export const CANCELLATION_BOUNDARY_MODEL = create('CANONICAL');
export const CANCELLATION_BOUNDARY_MUTANT = create('LOCAL_EFFECT_AFTER_OBSERVED_CANCEL');

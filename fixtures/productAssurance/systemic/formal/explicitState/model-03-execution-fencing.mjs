import { check, defineModel, liveness, next, safety } from './common.mjs';

const INITIAL = Object.freeze({
  phase: 'EMPTY',
  tick: 0,
  currentEpoch: 0,
  owner: 'NONE',
  authorizedEpochs: [],
  p0Authorized: false,
  p1Authorized: false,
  p0Committed: false,
  p1Committed: false,
  lastCommitEpoch: null,
  callbackKind: 'NONE',
  callbackEpoch: null,
  staleTransitionTested: false,
  factTested: false,
  factReceiptProven: false,
  durableFact: 'NONE',
  oldResurrected: false,
  lostOwner: false,
  overlapRejectionTested: false,
  staleCommit: false,
});

function transitionsFor(profile, state) {
  const transitions = [];
  if (state.phase === 'EMPTY') {
    transitions.push(next(state, 'ACQUIRE_P0_EPOCH_1', {
      phase: 'P0_ACTIVE', currentEpoch: 1, owner: 'P0', authorizedEpochs: [1], p0Authorized: true,
    }));
  }
  if (state.phase === 'P0_ACTIVE') {
    if (!state.p0Committed) transitions.push(next(state, 'CURRENT_COMMIT_P0', { p0Committed: true, lastCommitEpoch: 1 }));
    transitions.push(next(state, 'START_DEPLOYMENT_OVERLAP', { phase: 'OVERLAP', tick: 1 }));
  }
  if (state.phase === 'OVERLAP') {
    if (!state.overlapRejectionTested) {
      transitions.push(next(state, 'REJECT_P1_WHILE_P0_CURRENT', {
        phase: 'OVERLAP_REJECTED', overlapRejectionTested: true,
      }));
    }
    transitions.push(next(state, 'LOSE_P0_PROCESS', { phase: 'P0_LOST', lostOwner: true }));
    transitions.push(next(state, 'EXPIRE_P0_LEASE', {
      phase: 'P0_EXPIRED', tick: 2, owner: 'NONE', authorizedEpochs: [], p0Authorized: false,
    }));
  }
  if (state.phase === 'OVERLAP_REJECTED') {
    transitions.push(
      next(state, 'LOSE_P0_PROCESS', { phase: 'P0_LOST', lostOwner: true }),
      next(state, 'EXPIRE_P0_LEASE', { phase: 'P0_EXPIRED', tick: 2, owner: 'NONE', authorizedEpochs: [], p0Authorized: false }),
    );
  }
  if (state.phase === 'P0_LOST') {
    transitions.push(next(state, 'EXPIRE_P0_LEASE', {
      phase: 'P0_EXPIRED', tick: 2, owner: 'NONE', authorizedEpochs: [], p0Authorized: false,
    }));
  }
  if (state.phase === 'P0_EXPIRED') {
    transitions.push(next(state, 'ACQUIRE_P1_EPOCH_2', {
      phase: 'P1_ACTIVE', currentEpoch: 2, owner: 'P1', authorizedEpochs: [2], p1Authorized: true,
    }));
  }
  if (state.phase === 'P1_ACTIVE' && state.callbackKind === 'NONE') {
    if (!state.oldResurrected) {
      transitions.push(next(state, 'RESURRECT_OLD_PROCESS', { oldResurrected: true, p0Authorized: false }));
    }
    if (!state.staleTransitionTested) {
      transitions.push(next(state, 'QUEUE_STALE_TRANSITION', { callbackKind: 'NEW_TRANSITION', callbackEpoch: 1 }));
    }
    if (!state.factTested) {
      transitions.push(
        next(state, 'QUEUE_DURABLE_STALE_FACT', { callbackKind: 'DURABLE_FACT', callbackEpoch: 1, factReceiptProven: true }),
        next(state, 'QUEUE_UNPROVED_STALE_FACT', { callbackKind: 'UNPROVED_FACT', callbackEpoch: 1, factReceiptProven: false }),
      );
    }
    if (!state.p1Committed) transitions.push(next(state, 'CURRENT_COMMIT_P1', { p1Committed: true, lastCommitEpoch: 2 }));
    transitions.push(next(state, 'FINISH_FENCING_SCENARIO', { phase: 'TERMINAL' }));
  }
  if (state.callbackKind === 'NEW_TRANSITION') {
    if (profile === 'STALE_CALLBACK_COMMITS') {
      transitions.push(next(state, 'COMMIT_STALE_CALLBACK', {
        callbackKind: 'NONE', callbackEpoch: null, staleTransitionTested: true, lastCommitEpoch: 1, staleCommit: true,
      }));
    } else {
      transitions.push(next(state, 'REJECT_STALE_CALLBACK', {
        callbackKind: 'NONE', callbackEpoch: null, staleTransitionTested: true,
      }));
    }
  }
  if (state.callbackKind === 'DURABLE_FACT') {
    transitions.push(next(state, 'ACCEPT_DURABLE_STALE_FACT', {
      callbackKind: 'NONE', callbackEpoch: null, factTested: true, durableFact: 'RECEIVED',
    }));
  }
  if (state.callbackKind === 'UNPROVED_FACT') {
    transitions.push(next(state, 'RETAIN_UNPROVED_FACT_UNKNOWN', {
      callbackKind: 'NONE', callbackEpoch: null, factTested: true, durableFact: 'UNKNOWN',
    }));
  }
  return transitions;
}

const SAFETY = Object.freeze([
  safety('S3-SAF-01', ({ actionId, nextState }) => {
    const commitAction = ['CURRENT_COMMIT_P0', 'CURRENT_COMMIT_P1', 'COMMIT_STALE_CALLBACK'].includes(actionId);
    const commitIsCurrent = !commitAction
      || (nextState.lastCommitEpoch === nextState.currentEpoch
        && nextState.authorizedEpochs.includes(nextState.lastCommitEpoch));
    return check(
      nextState.authorizedEpochs.length <= 1
        && (nextState.authorizedEpochs.length === 0 || nextState.authorizedEpochs[0] === nextState.currentEpoch)
        && !(nextState.p0Authorized && nextState.p1Authorized)
        && (!nextState.p0Authorized || (nextState.owner === 'P0' && nextState.currentEpoch === 1 && nextState.authorizedEpochs[0] === 1))
        && (!nextState.p1Authorized || (nextState.owner === 'P1' && nextState.currentEpoch === 2 && nextState.authorizedEpochs[0] === 2))
        && commitIsCurrent,
      'more than one fencing epoch authorized a transition or a commit used non-current authority',
    );
  }),
  safety('S3-SAF-02', ({ nextState }) => check(
    !nextState.staleCommit,
    'stale actor or callback committed a canonical transition',
  )),
  safety('S3-SAF-03', ({ nextState }) => check(
    !(nextState.factTested && nextState.factReceiptProven && nextState.durableFact !== 'RECEIVED')
      && !(nextState.factTested && !nextState.factReceiptProven && nextState.durableFact !== 'UNKNOWN'),
    'durable stale-context fact was rejected or unproved receipt was treated as known',
  )),
]);

const LIVENESS = Object.freeze([
  liveness(
    'S3-LIV-02',
    (state) => state.lostOwner && state.p0Authorized,
    (state) => !state.p0Authorized,
    { weakFairActions: ['EXPIRE_P0_LEASE'] },
  ),
  liveness(
    'S3-LIV-06',
    (state) => state.callbackKind !== 'NONE',
    (state) => state.callbackKind === 'NONE',
  ),
]);

function create(profile) {
  return defineModel({
    modelId: 'S3-M03-EXECUTION-FENCING',
    title: 'Execution lease, monotonic fencing epoch, deployment overlap, stale callback, and resurrection',
    profile,
    bounds: { maxStates: 1_024, maxTransitions: 4_096, maxDepth: 24 },
    initialState: INITIAL,
    enabledTransitions: (state) => transitionsFor(profile, state),
    safety: SAFETY,
    liveness: LIVENESS,
    terminal: (state) => state.phase === 'TERMINAL',
    terminalClass: () => 'FENCING_TERMINAL',
  });
}

export const EXECUTION_FENCING_MODEL = create('CANONICAL');
export const EXECUTION_FENCING_MUTANT = create('STALE_CALLBACK_COMMITS');

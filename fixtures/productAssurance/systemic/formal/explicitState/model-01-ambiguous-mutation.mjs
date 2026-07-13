import { check, defineModel, liveness, next, safety } from './common.mjs';

const INITIAL = Object.freeze({
  phase: 'EMPTY',
  intentDurable: false,
  sendCount: 0,
  external: 'NOT_APPLIED',
  receipt: 'NONE',
  postcondition: 'NONE',
  outcome: 'PENDING',
  generation: 0,
  restoredEquivalent: true,
});

const TERMINAL_OUTCOMES = new Set(['SUCCESS', 'REJECTED', 'UNRESOLVED']);

function transitionsFor(profile, state) {
  const transitions = [];
  if (state.phase === 'EMPTY') {
    transitions.push(next(state, 'PERSIST_INTENT', { phase: 'INTENT_DURABLE', intentDurable: true }));
  }
  if (state.phase === 'INTENT_DURABLE') {
    transitions.push(next(state, 'DISPATCH_MUTATION', { phase: 'IN_FLIGHT', sendCount: state.sendCount + 1, external: 'UNKNOWN' }));
  }
  if (state.phase === 'IN_FLIGHT') {
    transitions.push(
      next(state, 'ACK_APPLIED', { phase: 'ACKNOWLEDGED', external: 'APPLIED', receipt: 'DURABLE' }),
      next(state, 'ACK_REJECTED', { phase: 'TERMINAL', external: 'NOT_APPLIED', receipt: 'DURABLE', postcondition: 'AUTHORITATIVE_ABSENT', outcome: 'REJECTED' }),
      next(state, 'LOSE_APPLIED_RESPONSE', { phase: 'AMBIGUOUS', external: 'APPLIED', receipt: 'UNKNOWN' }),
      next(state, 'TIMEOUT_UNKNOWN', { phase: 'AMBIGUOUS', external: 'UNKNOWN', receipt: 'UNKNOWN' }),
    );
    if (state.generation === 0) {
      transitions.push(next(state, 'CRASH_BEFORE_RESPONSE', { phase: 'RESTORING', generation: 1, external: 'UNKNOWN' }));
    }
  }
  if (state.phase === 'ACKNOWLEDGED') {
    transitions.push(next(state, 'RECONCILE_ACK', { phase: 'TERMINAL', postcondition: 'AUTHORITATIVE_APPLIED', outcome: 'SUCCESS' }));
  }
  if (state.phase === 'AMBIGUOUS') {
    transitions.push(next(state, 'BEGIN_RECONCILIATION', { phase: 'LOOKUP' }));
    if (state.generation === 0) transitions.push(next(state, 'CRASH_WITH_AMBIGUITY', { phase: 'RESTORING', generation: 1 }));
    if (profile === 'BLIND_RESEND' && state.sendCount < 2) {
      transitions.push(next(state, 'BLIND_RESEND', { phase: 'IN_FLIGHT', sendCount: state.sendCount + 1, external: 'UNKNOWN' }));
    }
  }
  if (state.phase === 'RESTORING') {
    transitions.push(next(state, 'RESTORE_DURABLE_INTENT', {
      phase: 'AMBIGUOUS',
      restoredEquivalent: state.intentDurable && state.sendCount === 1,
    }));
  }
  if (state.phase === 'LOOKUP') {
    if (state.external !== 'NOT_APPLIED') {
      transitions.push(next(state, 'LOOKUP_FOUND', { phase: 'TERMINAL', external: 'APPLIED', receipt: 'DURABLE', postcondition: 'AUTHORITATIVE_APPLIED', outcome: 'SUCCESS' }));
    }
    if (state.external !== 'APPLIED') {
      transitions.push(next(state, 'LOOKUP_PROVEN_ABSENT', { phase: 'TERMINAL', external: 'NOT_APPLIED', receipt: 'DURABLE', postcondition: 'AUTHORITATIVE_ABSENT', outcome: 'REJECTED' }));
    }
    transitions.push(next(state, 'LOOKUP_UNAVAILABLE', { phase: 'TERMINAL', receipt: 'DURABLE', postcondition: 'DURABLE_UNRESOLVED', outcome: 'UNRESOLVED' }));
  }
  return transitions;
}

const SAFETY = Object.freeze([
  safety('S3-SAF-03', ({ previousState, nextState }) => check(
    !(previousState?.external === 'APPLIED' && nextState.external !== 'APPLIED')
      && !(nextState.receipt === 'DURABLE' && nextState.external === 'APPLIED' && nextState.outcome === 'REJECTED')
      && !(nextState.receipt !== 'DURABLE' && nextState.outcome === 'SUCCESS'),
    'durable applied fact was rejected or unproved receipt was promoted to success',
  )),
  safety('S3-SAF-04', ({ nextState }) => check(
    nextState.sendCount === 0 || nextState.intentDurable,
    'mutation was sent without durable intent',
  )),
  safety('S3-SAF-05', ({ nextState }) => check(
    nextState.sendCount <= 1,
    'ambiguous mutation was blindly resent',
  )),
  safety('S3-SAF-06', ({ nextState }) => check(
    nextState.outcome !== 'SUCCESS'
      || (nextState.postcondition === 'AUTHORITATIVE_APPLIED' && nextState.receipt === 'DURABLE'),
    'local success lacks authoritative applied postcondition',
  )),
]);

const LIVENESS = Object.freeze([
  liveness(
    'S3-LIV-01',
    (state) => ['ACKNOWLEDGED', 'AMBIGUOUS', 'LOOKUP'].includes(state.phase),
    (state) => TERMINAL_OUTCOMES.has(state.outcome),
    { weakFairActions: ['BEGIN_RECONCILIATION'] },
  ),
  liveness(
    'S3-LIV-03',
    (state) => state.phase === 'RESTORING',
    (state) => state.phase !== 'RESTORING' && (state.generation === 0 || state.restoredEquivalent || TERMINAL_OUTCOMES.has(state.outcome)),
    { weakFairActions: ['RESTORE_DURABLE_INTENT'] },
  ),
]);

function create(profile) {
  return defineModel({
    modelId: 'S3-M01-AMBIGUOUS-MUTATION',
    title: 'Durable intent, ambiguous response, authoritative reconciliation, and resend prohibition',
    profile,
    bounds: { maxStates: 96, maxTransitions: 256, maxDepth: 16 },
    initialState: INITIAL,
    enabledTransitions: (state) => transitionsFor(profile, state),
    safety: SAFETY,
    liveness: LIVENESS,
    terminal: (state) => state.phase === 'TERMINAL',
    terminalClass: (state) => `${state.outcome}_TERMINAL`,
  });
}

export const AMBIGUOUS_MUTATION_MODEL = create('CANONICAL');
export const AMBIGUOUS_MUTATION_MUTANT = create('BLIND_RESEND');

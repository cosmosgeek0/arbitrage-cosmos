import { check, defineModel, next, safety } from './common.mjs';

const INITIAL = Object.freeze({
  phase: 'IDLE',
  posture: 'OPEN',
  operation: 'NONE',
  riskEffect: 'NONE',
  riskGate: 'UNKNOWN',
  approvalBound: true,
  approvalIdentity: 'APPROVAL_1',
  approvalScope: 'NONE',
  approvalVersion: 1,
  expectedApprovalIdentity: 'APPROVAL_1',
  expectedApprovalScope: 'NONE',
  expectedApprovalVersion: 1,
  approvalUseIdentity: 'USE_1',
  expectedApprovalUseIdentity: 'USE_1',
  approvalExpiresAt: 2,
  approvalUseCount: 0,
  tick: 0,
  beforeExposure: 2,
  afterExposure: 2,
  capacity: 'AVAILABLE',
  result: 'PENDING',
});

function proposal(state, actionId, operation, riskEffect, scope) {
  return next(state, actionId, {
    phase: 'PROPOSED', operation, riskEffect, approvalScope: scope, expectedApprovalScope: scope,
  });
}

function approvalIsCurrent(state) {
  return state.approvalBound
    && state.approvalIdentity === state.expectedApprovalIdentity
    && state.approvalScope === state.expectedApprovalScope
    && state.approvalVersion === state.expectedApprovalVersion
    && state.approvalUseIdentity === state.expectedApprovalUseIdentity
    && state.tick < state.approvalExpiresAt
    && state.approvalUseCount === 0;
}

function transitionsFor(profile, state) {
  const transitions = [];
  if (state.phase === 'IDLE') {
    transitions.push(
      proposal(state, 'PROPOSE_ENTRY', 'ENTRY', 'INCREASE', 'RISK_INCREASING'),
      proposal(state, 'PROPOSE_REDUCTION', 'REDUCE', 'REDUCE', 'RISK_REDUCING'),
      proposal(state, 'PROPOSE_REPAY', 'REPAY', 'REDUCE', 'RISK_REDUCING'),
      proposal(state, 'PROPOSE_RECONCILIATION', 'RECONCILE', 'NEUTRAL', 'OBSERVE'),
    );
  }
  if (state.phase === 'PROPOSED') {
    if (state.posture === 'OPEN') transitions.push(next(state, 'ENGAGE_HALT', { posture: 'HALT_NEW_EXPOSURE' }));
    if (state.posture === 'OPEN') transitions.push(next(state, 'LOSE_POSTURE_TRUTH', { posture: 'UNKNOWN' }));
    const riskGate = state.riskEffect === 'INCREASE'
      ? (state.posture === 'OPEN' ? 'ALLOW' : state.posture === 'HALT_NEW_EXPOSURE' ? 'DENY' : 'UNKNOWN')
      : 'ALLOW';
    transitions.push(next(state, 'EVALUATE_CANONICAL_RISK', { phase: 'EVALUATED', riskGate }));
    if (state.riskEffect === 'REDUCE' && state.capacity === 'AVAILABLE') {
      transitions.push(next(state, 'MARK_REDUCTION_CAPACITY_BLOCKED', { capacity: 'BLOCKED' }));
    }
  }
  if (state.phase === 'EVALUATED') {
    if (state.posture === 'OPEN') transitions.push(next(state, 'ENGAGE_HALT_AFTER_EVALUATION', { posture: 'HALT_NEW_EXPOSURE' }));
    const approvalCurrent = approvalIsCurrent(state);
    if (approvalCurrent) {
      transitions.push(
        next(state, 'EXPIRE_APPROVAL', { tick: state.approvalExpiresAt }),
        next(state, 'DROP_APPROVAL_BINDING', { approvalBound: false }),
        next(state, 'REUSE_APPROVAL', { approvalUseCount: 1 }),
        next(state, 'SWAP_APPROVAL_IDENTITY', { approvalIdentity: 'APPROVAL_2' }),
        next(state, 'DRIFT_APPROVAL_SCOPE', { approvalScope: 'FOREIGN_SCOPE' }),
        next(state, 'DRIFT_APPROVAL_VERSION', { approvalVersion: state.expectedApprovalVersion + 1 }),
        next(state, 'DRIFT_APPROVAL_USE_IDENTITY', { approvalUseIdentity: 'USE_2' }),
      );
    }

    if (state.riskEffect === 'INCREASE') {
      if (state.posture === 'OPEN' && state.riskGate === 'ALLOW' && approvalCurrent) {
        transitions.push(next(state, 'COMMIT_RISK_INCREASE', {
          phase: 'TERMINAL', afterExposure: 3, approvalUseCount: 1, result: 'APPLIED',
        }));
      } else {
        transitions.push(next(state, 'REJECT_RISK_INCREASE', { phase: 'TERMINAL', result: 'BLOCKED' }));
      }
      if (profile === 'HALT_COMMIT_RACE' && state.posture !== 'OPEN') {
        transitions.push(next(state, 'COMMIT_UNCHECKED_AFTER_HALT', {
          phase: 'TERMINAL', afterExposure: 3, approvalUseCount: 1, result: 'APPLIED',
        }));
      }
    }

    if (state.riskEffect === 'REDUCE') {
      if (!approvalCurrent) {
        transitions.push(next(state, 'REJECT_INVALID_REDUCTION_APPROVAL', { phase: 'TERMINAL', result: 'BLOCKED' }));
      } else if (state.capacity === 'AVAILABLE') {
        transitions.push(next(state, 'COMMIT_RISK_REDUCTION', {
          phase: 'TERMINAL', afterExposure: 1, approvalUseCount: 1, result: 'APPLIED',
        }));
      } else if (state.capacity === 'BLOCKED') {
        transitions.push(next(state, 'RECORD_REDUCTION_UNRESOLVED', { phase: 'TERMINAL', result: 'UNRESOLVED' }));
      }
    }

    if (state.riskEffect === 'NEUTRAL') {
      transitions.push(next(state, 'COMMIT_RECONCILIATION', { phase: 'TERMINAL', result: 'APPLIED' }));
    }

    if (profile === 'HALT_COMMIT_RACE' && state.riskEffect !== 'NEUTRAL' && !approvalCurrent) {
      transitions.push(next(state, 'COMMIT_WITH_INVALID_APPROVAL', {
        phase: 'TERMINAL',
        afterExposure: state.riskEffect === 'INCREASE' ? 3 : 1,
        approvalUseCount: state.approvalUseCount + 1,
        result: 'APPLIED',
      }));
    }
  }
  return transitions;
}

const SAFETY = Object.freeze([
  safety('S3-SAF-08', ({ nextState }) => check(
    nextState.afterExposure <= nextState.beforeExposure
      || (nextState.posture === 'OPEN' && nextState.riskGate === 'ALLOW'),
    'risk increased while canonical posture denied or was unknown',
  )),
  safety('S3-SAF-10', ({ nextState }) => {
    if (nextState.result !== 'APPLIED' || nextState.riskEffect === 'NEUTRAL') return true;
    return check(
      nextState.approvalBound
        && nextState.approvalIdentity === nextState.expectedApprovalIdentity
        && nextState.approvalScope === nextState.expectedApprovalScope
        && nextState.approvalVersion === nextState.expectedApprovalVersion
        && nextState.approvalUseIdentity === nextState.expectedApprovalUseIdentity
        && nextState.tick < nextState.approvalExpiresAt
        && nextState.approvalUseCount === 1,
      'applied operation escaped approval identity, scope, version, use identity, expiry, or single use',
    );
  }),
  safety('S3-M06-INV-01', ({ nextState }) => check(
    !(nextState.posture === 'HALT_NEW_EXPOSURE' && nextState.riskEffect === 'REDUCE' && nextState.riskGate === 'DENY')
      && !(nextState.result === 'APPLIED' && nextState.riskEffect === 'REDUCE' && nextState.afterExposure >= nextState.beforeExposure),
    'halt denied a canonical reduction or an applied reduction failed to lower exposure',
  )),
]);

const LIVENESS = Object.freeze([]);

function create(profile) {
  return defineModel({
    modelId: 'S3-M06-HALT-RISK-REDUCTION',
    title: 'Halt prevents new exposure while preserving canonical risk reduction and reconciliation',
    profile,
    bounds: { maxStates: 512, maxTransitions: 2_048, maxDepth: 12 },
    initialState: INITIAL,
    enabledTransitions: (state) => transitionsFor(profile, state),
    safety: SAFETY,
    liveness: LIVENESS,
    terminal: (state) => state.phase === 'TERMINAL',
    terminalClass: (state) => `${state.result}_TERMINAL`,
  });
}

export const HALT_RISK_REDUCTION_MODEL = create('CANONICAL');
export const HALT_RISK_REDUCTION_MUTANT = create('HALT_COMMIT_RACE');

import { check, defineModel, liveness, next, safety } from './common.mjs';

const TERMINAL_OUTCOMES = new Set(['SUCCESS', 'REJECTED', 'UNRESOLVED']);

const INITIAL = Object.freeze({
  phase: 'EMPTY',
  borrowIntentDurable: false,
  shortOpenIntentDurable: false,
  shortCloseIntentDurable: false,
  repayIntentDurable: false,
  borrowSendCount: 0,
  shortOpenSendCount: 0,
  shortCloseSendCount: 0,
  repaySendCount: 0,
  principal: 0,
  interest: 0,
  shortExposure: 0,
  externalLiability: 0,
  localLiability: 'NONE',
  liabilityExplicit: false,
  unresolvedRecordDurable: false,
  authoritativeSnapshot: 'CURRENT',
  borrowVerified: false,
  unresolvedMutation: 'NONE',
  repayDispatched: false,
  generation: 0,
  restoreTarget: 'NONE',
  restoredEquivalent: true,
  dependentClaim: 'KNOWN',
  envelopeOverflow: false,
  outcome: 'PENDING',
});

function unresolvedCandidate(state, actionId, patch) {
  return next(state, actionId, {
    ...patch,
    phase: 'PERSISTING_UNRESOLVED',
    liabilityExplicit: false,
    unresolvedRecordDurable: false,
    outcome: 'PENDING',
  });
}

function transitionsFor(profile, state) {
  const transitions = [];
  if (state.phase === 'EMPTY') transitions.push(next(state, 'PERSIST_BORROW_INTENT', { phase: 'BORROW_INTENT', borrowIntentDurable: true }));
  if (state.phase === 'BORROW_INTENT') {
    transitions.push(next(state, 'DISPATCH_BORROW', { phase: 'BORROW_IN_FLIGHT', borrowSendCount: 1, authoritativeSnapshot: 'NONE' }));
  }
  if (state.phase === 'BORROW_IN_FLIGHT') {
    transitions.push(
      next(state, 'BORROW_ACKNOWLEDGED', {
        phase: 'BORROWED', principal: 2, externalLiability: 2, localLiability: 'OPEN', authoritativeSnapshot: 'CURRENT', borrowVerified: true,
      }),
      next(state, 'BORROW_REJECTED', {
        phase: 'TERMINAL', externalLiability: 0, authoritativeSnapshot: 'CURRENT', localLiability: 'NONE', outcome: 'REJECTED',
      }),
      next(state, 'BORROW_RESPONSE_LOST', {
        phase: 'BORROW_AMBIGUOUS', externalLiability: 'UNKNOWN', authoritativeSnapshot: 'NONE', localLiability: 'RECONCILING', unresolvedMutation: 'BORROW',
      }),
    );
    if (state.generation === 0) transitions.push(next(state, 'CRASH_DURING_BORROW', {
      phase: 'RESTORING', generation: 1, restoreTarget: 'BORROW_AMBIGUOUS', unresolvedMutation: 'BORROW', externalLiability: 'UNKNOWN', localLiability: 'RECONCILING',
    }));
  }
  if (state.phase === 'BORROW_AMBIGUOUS') {
    transitions.push(
      next(state, 'RECONCILE_BORROW_FOUND', {
        phase: 'BORROWED', principal: 2, externalLiability: 2, localLiability: 'OPEN', authoritativeSnapshot: 'CURRENT', borrowVerified: true, unresolvedMutation: 'NONE',
      }),
      next(state, 'RECONCILE_BORROW_ABSENT', {
        phase: 'TERMINAL', externalLiability: 0, localLiability: 'NONE', authoritativeSnapshot: 'CURRENT', unresolvedMutation: 'NONE', outcome: 'REJECTED',
      }),
      unresolvedCandidate(state, 'RECONCILE_BORROW_UNAVAILABLE', {
        localLiability: 'UNRESOLVED', unresolvedMutation: 'BORROW', authoritativeSnapshot: 'NONE',
      }),
    );
  }
  if (state.phase === 'BORROWED') {
    transitions.push(next(state, 'PERSIST_SHORT_OPEN_INTENT', { phase: 'SHORT_OPEN_INTENT', shortOpenIntentDurable: true }));
  }
  if (state.phase === 'SHORT_OPEN_INTENT') {
    transitions.push(next(state, 'OPEN_VERIFIED_SHORT', { phase: 'SHORT_OPEN', shortExposure: 2, shortOpenSendCount: 1 }));
  }
  if (state.phase === 'SHORT_OPEN') {
    transitions.push(
      next(state, 'ACCRUE_INTEREST', { phase: 'INTEREST_ACCRUED', interest: 1, externalLiability: 3 }),
      next(state, 'PERSIST_SHORT_CLOSE_INTENT_WITHOUT_INTEREST', { phase: 'SHORT_CLOSE_INTENT', shortCloseIntentDurable: true }),
    );
  }
  if (state.phase === 'INTEREST_ACCRUED') {
    transitions.push(
      next(state, 'PERSIST_SHORT_CLOSE_INTENT', { phase: 'SHORT_CLOSE_INTENT', shortCloseIntentDurable: true }),
      unresolvedCandidate(state, 'ACCRUE_OUTSIDE_ENVELOPE', {
        externalLiability: 'UNKNOWN',
        localLiability: 'UNRESOLVED',
        authoritativeSnapshot: 'NONE',
        dependentClaim: 'UNKNOWN',
        envelopeOverflow: true,
        unresolvedMutation: 'LIABILITY_ENVELOPE',
      }),
    );
  }
  if (state.phase === 'SHORT_CLOSE_INTENT') {
    transitions.push(next(state, 'CLOSE_SHORT', { phase: 'SHORT_CLOSED', shortExposure: 0, shortCloseSendCount: 1 }));
  }
  if (state.phase === 'SHORT_CLOSED') {
    transitions.push(next(state, 'PERSIST_REPAY_INTENT', { phase: 'REPAY_INTENT', repayIntentDurable: true, localLiability: 'REPAY_PENDING' }));
  }
  if (state.phase === 'REPAY_INTENT') {
    transitions.push(next(state, 'DISPATCH_REPAY', { phase: 'REPAY_IN_FLIGHT', repaySendCount: 1, repayDispatched: true, authoritativeSnapshot: 'NONE' }));
  }
  if (state.phase === 'REPAY_IN_FLIGHT') {
    transitions.push(
      next(state, 'REPAY_ACKNOWLEDGED', { phase: 'RECONCILING_REPAY', externalLiability: 'UNKNOWN', unresolvedMutation: 'REPAY' }),
      next(state, 'REPAY_PARTIAL_ACK', { phase: 'RECONCILING_REPAY', externalLiability: 1, unresolvedMutation: 'REPAY' }),
      next(state, 'REPAY_RESPONSE_LOST', { phase: 'REPAY_AMBIGUOUS', externalLiability: 'UNKNOWN', unresolvedMutation: 'REPAY' }),
    );
    if (profile === 'LOST_REPAY_CLEARS_LIABILITY') {
      transitions.push(next(state, 'FALSE_CLOSE_AFTER_LOST_REPAY', {
        phase: 'TERMINAL', externalLiability: 'UNKNOWN', localLiability: 'CLOSED', authoritativeSnapshot: 'NONE', unresolvedMutation: 'NONE', outcome: 'SUCCESS',
      }));
    }
    if (state.generation === 0) transitions.push(next(state, 'CRASH_DURING_REPAY', { phase: 'RESTORING', generation: 1, restoreTarget: 'REPAY_AMBIGUOUS', unresolvedMutation: 'REPAY', externalLiability: 'UNKNOWN' }));
  }
  if (state.phase === 'REPAY_AMBIGUOUS') transitions.push(next(state, 'BEGIN_LIABILITY_RECONCILIATION', { phase: 'RECONCILING_REPAY' }));
  if (state.phase === 'RECONCILING_REPAY') {
    transitions.push(
      next(state, 'LIABILITY_LOOKUP_ZERO', {
        phase: 'TERMINAL', externalLiability: 0, localLiability: 'CLOSED', authoritativeSnapshot: 'CURRENT', unresolvedMutation: 'NONE', outcome: 'SUCCESS',
      }),
      unresolvedCandidate(state, 'LIABILITY_LOOKUP_REMAINING', {
        externalLiability: 1,
        localLiability: 'UNRESOLVED',
        authoritativeSnapshot: 'CURRENT',
        unresolvedMutation: 'LIABILITY_REMAINING',
      }),
      unresolvedCandidate(state, 'LIABILITY_LOOKUP_UNAVAILABLE', {
        externalLiability: 'UNKNOWN',
        localLiability: 'UNRESOLVED',
        authoritativeSnapshot: 'NONE',
        unresolvedMutation: 'LIABILITY_UNKNOWN',
      }),
    );
  }
  if (state.phase === 'PERSISTING_UNRESOLVED') {
    transitions.push(next(state, 'PERSIST_UNRESOLVED_LIABILITY', {
      phase: 'TERMINAL',
      liabilityExplicit: true,
      unresolvedRecordDurable: true,
      outcome: 'UNRESOLVED',
    }));
  }
  if (state.phase === 'RESTORING') {
    transitions.push(next(state, 'RESTORE_LIABILITY_CHECKPOINT', {
      phase: state.restoreTarget,
      restoredEquivalent: state.borrowIntentDurable && (state.restoreTarget !== 'REPAY_AMBIGUOUS' || state.repayIntentDurable),
    }));
  }
  return transitions;
}

const SAFETY = Object.freeze([
  safety('S3-SAF-04', ({ nextState }) => check(
    (nextState.borrowSendCount === 0 || nextState.borrowIntentDurable)
      && (nextState.shortOpenSendCount === 0 || nextState.shortOpenIntentDurable)
      && (nextState.shortCloseSendCount === 0 || nextState.shortCloseIntentDurable)
      && (nextState.repaySendCount === 0 || nextState.repayIntentDurable),
    'borrow, short-open, short-close, or repay mutation was dispatched without durable intent',
  )),
  safety('S3-SAF-05', ({ nextState }) => check(
    nextState.borrowSendCount <= 1
      && nextState.shortOpenSendCount <= 1
      && nextState.shortCloseSendCount <= 1
      && nextState.repaySendCount <= 1,
    'ambiguous borrow, short, or repay mutation was blindly resent',
  )),
  safety('S3-SAF-06', ({ nextState }) => check(
    nextState.outcome !== 'SUCCESS'
      || (nextState.authoritativeSnapshot === 'CURRENT' && nextState.externalLiability === 0 && nextState.shortExposure === 0),
    'local success lacks authoritative zero-liability postcondition',
  )),
  safety('S3-SAF-07', ({ nextState }) => {
    const closedIsProven = nextState.localLiability !== 'CLOSED'
      || (nextState.authoritativeSnapshot === 'CURRENT' && nextState.externalLiability === 0);
    const overflowUnknown = !nextState.envelopeOverflow || nextState.dependentClaim === 'UNKNOWN';
    const terminalLiabilityVisible = nextState.phase !== 'TERMINAL'
      || nextState.externalLiability === 0
      || (nextState.localLiability === 'UNRESOLVED'
        && nextState.liabilityExplicit
        && nextState.unresolvedRecordDurable);
    return check(closedIsProven && overflowUnknown && terminalLiabilityVisible, 'known or possible liability was hidden or fabricated closed');
  }),
]);

const LIVENESS = Object.freeze([
  liveness(
    'S3-LIV-01',
    (state) => state.unresolvedMutation !== 'NONE' && state.outcome === 'PENDING',
    (state) => state.unresolvedMutation === 'NONE' || state.outcome === 'UNRESOLVED',
  ),
  liveness(
    'S3-LIV-03',
    (state) => state.phase === 'RESTORING',
    (state) => state.phase !== 'RESTORING' && (state.generation === 0 || state.restoredEquivalent),
    { weakFairActions: ['RESTORE_LIABILITY_CHECKPOINT'] },
  ),
  liveness(
    'S3-LIV-06',
    (state) => state.repayDispatched && !TERMINAL_OUTCOMES.has(state.outcome),
    (state) => TERMINAL_OUTCOMES.has(state.outcome),
  ),
]);

function create(profile) {
  return defineModel({
    modelId: 'S3-M05-BORROW-LIABILITY',
    title: 'Borrow, short, interest, ambiguous repay, and authoritative liability reconciliation',
    profile,
    bounds: { maxStates: 512, maxTransitions: 2_048, maxDepth: 26 },
    initialState: INITIAL,
    enabledTransitions: (state) => transitionsFor(profile, state),
    safety: SAFETY,
    liveness: LIVENESS,
    terminal: (state) => state.phase === 'TERMINAL',
    terminalClass: (state) => `${state.outcome}_TERMINAL`,
  });
}

export const BORROW_LIABILITY_MODEL = create('CANONICAL');
export const BORROW_LIABILITY_MUTANT = create('LOST_REPAY_CLEARS_LIABILITY');

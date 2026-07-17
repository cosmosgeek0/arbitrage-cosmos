import {
  BASE_ASSUMPTIONS,
  check,
  defineModel,
  liveness,
  next,
  safety,
} from './common.mjs';

const INITIAL = Object.freeze({
  phase: 'RAW',
  scenario: 'NONE',
  halt: 'OPEN',
  authority: 'UNKNOWN',
  dependency: 'UNKNOWN',
  distribution: 'UNAVAILABLE',
  cancelGuard: 'NONE',
  repairActive: false,
  capitalAtRepairEntry: 1,
  capitalAuthorization: 1,
  riskIncreasingOrderAuthorized: false,
  recoveryOrderAuthorized: false,
  replacementAuthorized: false,
  disposition: 'PENDING',
  verdict: 'UNKNOWN',
});

const CASES = Object.freeze([
  Object.freeze({
    actionId: 'PARSE_VALID_BASE_POLICY', scenario: 'VALID_BASE', halt: 'OPEN', authority: 'AUTHORIZED',
    dependency: 'AVAILABLE', distribution: 'CALIBRATED', cancelGuard: 'NONE', repairActive: false,
  }),
  Object.freeze({
    actionId: 'PARSE_HALT_ACTIVE_POLICY', scenario: 'HALT_ACTIVE', halt: 'HALT', authority: 'AUTHORIZED',
    dependency: 'AVAILABLE', distribution: 'CALIBRATED', cancelGuard: 'NONE', repairActive: false,
  }),
  Object.freeze({
    actionId: 'PARSE_UNKNOWN_AUTHORITY_POLICY', scenario: 'UNKNOWN_AUTHORITY', halt: 'UNKNOWN', authority: 'UNKNOWN',
    dependency: 'AVAILABLE', distribution: 'CALIBRATED', cancelGuard: 'NONE', repairActive: false,
  }),
  Object.freeze({
    actionId: 'PARSE_UNKNOWN_DEPENDENCY_POLICY', scenario: 'UNKNOWN_DEPENDENCY', halt: 'OPEN', authority: 'AUTHORIZED',
    dependency: 'UNKNOWN', distribution: 'CALIBRATED', cancelGuard: 'NONE', repairActive: false,
  }),
  Object.freeze({
    actionId: 'PARSE_CANCEL_REPLACE_POLICY', scenario: 'CANCEL_REPLACE', halt: 'OPEN', authority: 'AUTHORIZED',
    dependency: 'AVAILABLE', distribution: 'CALIBRATED', cancelGuard: 'CONFIRMED_CANCEL_REQUIRED', repairActive: false,
  }),
  Object.freeze({
    actionId: 'PARSE_RECOVERY_POLICY', scenario: 'RECOVERY', halt: 'OPEN', authority: 'AUTHORIZED',
    dependency: 'AVAILABLE', distribution: 'CALIBRATED', cancelGuard: 'NONE', repairActive: true,
  }),
]);

function evaluated(state, patch) {
  return next(state, patch.actionId, {
    phase: 'TERMINAL',
    disposition: patch.disposition,
    verdict: patch.verdict,
    riskIncreasingOrderAuthorized: patch.riskIncreasingOrderAuthorized ?? false,
    recoveryOrderAuthorized: patch.recoveryOrderAuthorized ?? false,
    replacementAuthorized: patch.replacementAuthorized ?? false,
    capitalAuthorization: patch.capitalAuthorization ?? state.capitalAuthorization,
  });
}

function transitionsFor(profile, state) {
  if (state.phase === 'RAW') {
    return CASES.map((scenario) => next(state, scenario.actionId, {
      phase: 'EVALUATE',
      scenario: scenario.scenario,
      halt: scenario.halt,
      authority: scenario.authority,
      dependency: scenario.dependency,
      distribution: scenario.distribution,
      cancelGuard: scenario.cancelGuard,
      repairActive: scenario.repairActive,
      capitalAtRepairEntry: state.capitalAuthorization,
    }));
  }
  if (state.phase !== 'EVALUATE') return [];
  switch (state.scenario) {
    case 'VALID_BASE':
      return [evaluated(state, {
        actionId: 'EVALUATE_AUTHORIZED_POLICY', disposition: 'PLANNED', verdict: 'PASS', riskIncreasingOrderAuthorized: true,
      })];
    case 'HALT_ACTIVE':
      return [evaluated(state, profile === 'DROP_KILL_GUARD' ? {
        actionId: 'EVALUATE_WITH_DROPPED_KILL_GUARD', disposition: 'PLANNED', verdict: 'PASS', riskIncreasingOrderAuthorized: true,
      } : {
        actionId: 'REJECT_HALTED_POLICY', disposition: 'REJECTED', verdict: 'BLOCKED',
      })];
    case 'UNKNOWN_AUTHORITY':
      return [evaluated(state, {
        actionId: 'REJECT_UNKNOWN_AUTHORITY', disposition: 'REJECTED', verdict: 'UNKNOWN',
      })];
    case 'UNKNOWN_DEPENDENCY':
      return [evaluated(state, {
        actionId: 'REJECT_UNKNOWN_DEPENDENCY', disposition: 'REJECTED', verdict: 'UNKNOWN',
      })];
    case 'CANCEL_REPLACE':
      return [evaluated(state, {
        actionId: 'VALIDATE_CANCEL_THEN_REPLACE', disposition: 'PLANNED', verdict: 'PASS', replacementAuthorized: true,
      })];
    case 'RECOVERY':
      return [evaluated(state, {
        actionId: 'VALIDATE_RISK_REDUCING_RECOVERY', disposition: 'PLANNED', verdict: 'PASS', recoveryOrderAuthorized: true,
      })];
    default:
      return [];
  }
}

const SAFETY = Object.freeze([
  safety('S3-SAF-08', ({ nextState }) => check(
    !nextState.riskIncreasingOrderAuthorized
      || (nextState.halt === 'OPEN' && nextState.authority === 'AUTHORIZED' && nextState.dependency === 'AVAILABLE'),
    'policy authorized a risk increase while canonical authority denied or did not prove it',
  )),
  safety('S3-SAF-11', ({ nextState }) => check(
    nextState.halt !== 'HALT' || !nextState.riskIncreasingOrderAuthorized,
    'halted execution-policy evaluation authorized a new risk-increasing order',
  )),
  safety('S3-SAF-12', ({ nextState }) => check(
    !nextState.repairActive || nextState.capitalAuthorization <= nextState.capitalAtRepairEntry,
    'record-only recovery policy widened its capital authorization ceiling',
  )),
  safety('S3-SAF-13', ({ nextState }) => check(
    ![
      nextState.halt,
      nextState.authority,
      nextState.dependency,
      nextState.distribution,
    ].includes('UNKNOWN') || nextState.verdict !== 'PASS',
    'UNKNOWN policy input was normalized to PASS',
  )),
  safety('S3-SAF-14', ({ nextState }) => check(
    !nextState.replacementAuthorized || nextState.cancelGuard === 'CONFIRMED_CANCEL_REQUIRED',
    'replacement plan omitted its distinct confirmed-cancel dependency',
  )),
]);

const LIVENESS = Object.freeze([
  liveness(
    'S3-LIV-01',
    (state) => state.phase === 'EVALUATE' && state.disposition === 'PENDING',
    (state) => state.phase === 'TERMINAL' && ['PLANNED', 'REJECTED'].includes(state.disposition),
    {
      weakFairActions: [
        'EVALUATE_AUTHORIZED_POLICY', 'EVALUATE_WITH_DROPPED_KILL_GUARD', 'REJECT_HALTED_POLICY',
        'REJECT_UNKNOWN_AUTHORITY', 'REJECT_UNKNOWN_DEPENDENCY', 'VALIDATE_CANCEL_THEN_REPLACE',
        'VALIDATE_RISK_REDUCING_RECOVERY',
      ],
    },
  ),
]);

const ASSUMPTIONS = Object.freeze([
  ...BASE_ASSUMPTIONS,
  'SYNTHETIC_ONLY; SUPPORTING_EVIDENCE_ONLY; runtime_claim_closure is NOT_PERMITTED.',
  'The frozen df6b472 execution-policy owner is represented as a one-shot evaluator, not as a runtime reducer or executor.',
  'The finite envelope contains two policy legs, one candidate, one distinguished dependency, unit capital, and six evaluator scenarios.',
  'evaluatedAtMs is an injected fixed cut; validity is exclusive when validUntilMs is less than or equal to that cut.',
  'Weak fairness applies only to the continuously enabled bounded evaluator branch; no venue, cancel, repair, or execution progress is inferred.',
]);

function create(profile) {
  return defineModel({
    modelId: 'S3-M08-ORDER-POLICY',
    title: 'Frozen L08 execution-policy evaluator fail-closure and documentary action graph',
    profile,
    bounds: { maxStates: 128, maxTransitions: 256, maxDepth: 8 },
    assumptions: ASSUMPTIONS,
    initialState: INITIAL,
    enabledTransitions: (state) => transitionsFor(profile, state),
    safety: SAFETY,
    liveness: LIVENESS,
    terminal: (state) => state.phase === 'TERMINAL',
    terminalClass: (state) => `${state.scenario}_${state.disposition}`,
  });
}

export const ORDER_POLICY_MODEL = create('CANONICAL');
export const ORDER_POLICY_MUTANT = create('DROP_KILL_GUARD');

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANONICAL_MODELS,
  NEGATIVE_CONTROL_MODELS,
} from '../../../../fixtures/productAssurance/systemic/formal/explicitState/index.mjs';
import {
  EXPLICIT_STATE_DIAGNOSTIC_SCHEMA,
  exploreModel,
  runModels,
} from '../../../../fixtures/productAssurance/systemic/formal/explicitState/kernel.mjs';
import {
  PROPERTY_CATALOG,
} from '../../../../fixtures/productAssurance/systemic/formal/explicitState/properties.mjs';
import {
  check,
  defineModel,
  liveness,
  next,
  safety,
} from '../../../../fixtures/productAssurance/systemic/formal/explicitState/common.mjs';
import { validateExplicitStateReport } from '../../../../fixtures/productAssurance/systemic/formal/contracts/report.mjs';

const EXPECTED_CANONICAL_COUNTS = Object.freeze({
  'S3-M01-AMBIGUOUS-MUTATION': Object.freeze([25, 31]),
  'S3-M02-TWO-LEG-RECOVERY': Object.freeze([116, 119]),
  'S3-M03-EXECUTION-FENCING': Object.freeze([627, 858]),
  'S3-M04-REPAIR-CAMPAIGN': Object.freeze([97, 98]),
  'S3-M05-BORROW-LIABILITY': Object.freeze([88, 105]),
  'S3-M06-HALT-RISK-REDUCTION': Object.freeze([323, 373]),
  'S3-M07-CANCELLATION-BOUNDARY': Object.freeze([47, 47]),
  'S3-M08-ORDER-POLICY': Object.freeze([13, 12]),
  'S3-M09-NORMAL-BASIS-LIFECYCLE': Object.freeze([69, 78]),
  'S3-M10-REVERSE-BASIS-LIABILITY': Object.freeze([198, 219]),
});

const EXPECTED_AMENDMENT_PROPERTY_IDS = Object.freeze([
  'S3-SAF-01',
  'S3-SAF-02',
  'S3-SAF-03',
  'S3-SAF-04',
  'S3-SAF-05',
  'S3-SAF-06',
  'S3-SAF-07',
  'S3-SAF-08',
  'S3-SAF-09',
  'S3-SAF-10',
  'S3-SAF-11',
  'S3-SAF-12',
  'S3-SAF-13',
  'S3-SAF-14',
  'S3-SAF-15',
  'S3-LIV-01',
  'S3-LIV-02',
  'S3-LIV-03',
  'S3-LIV-04',
  'S3-LIV-05',
  'S3-LIV-06',
]);

function follow(model, actionIds) {
  let state = model.initialStates()[0];
  for (const actionId of actionIds) {
    const candidates = model.enabledTransitions(state).filter((candidate) => candidate.actionId === actionId);
    assert.equal(candidates.length, 1, `${model.modelId} expected one ${actionId} transition`);
    state = candidates[0].nextState;
  }
  return state;
}

function tinyModel({
  modelId,
  initialState = Object.freeze({ phase: 'START' }),
  enabledTransitions,
  safetyProperties = Object.freeze([]),
  livenessProperties = Object.freeze([]),
  terminal = (state) => state.phase === 'DONE',
  terminalClass = () => 'DONE_TERMINAL',
  bounds = Object.freeze({ maxStates: 64, maxTransitions: 128, maxDepth: 16 }),
}) {
  return defineModel({
    modelId,
    title: modelId,
    bounds,
    initialState,
    enabledTransitions,
    safety: safetyProperties,
    liveness: livenessProperties,
    terminal,
    terminalClass,
  });
}

test('ten canonical models exhaust their pinned bounded graphs and cover the full property catalog', () => {
  const reports = runModels(CANONICAL_MODELS);
  assert.equal(reports.length, 10);
  assert.deepEqual(reports.map((report) => report.modelId), Object.keys(EXPECTED_CANONICAL_COUNTS));
  for (const report of reports) {
    assert.equal(report.overallStatus, 'PASS', report.modelId);
    assert.equal(report.exploration.status, 'EXHAUSTIVE', report.modelId);
    assert.deepEqual(
      [report.exploration.states, report.exploration.transitions],
      EXPECTED_CANONICAL_COUNTS[report.modelId],
      report.modelId,
    );
    assert.equal(report.properties.some((property) => property.status !== 'PASS'), false, report.modelId);
    assert.equal(validateExplicitStateReport(report).ok, true, report.modelId);
  }
  assert.equal(reports.reduce((sum, report) => sum + report.exploration.states, 0), 1_603);
  assert.equal(reports.reduce((sum, report) => sum + report.exploration.transitions, 0), 1_940);
  const covered = new Set(reports.flatMap((report) => report.properties.map((property) => property.propertyId)));
  assert.deepEqual([...covered].sort(), PROPERTY_CATALOG.map((property) => property.propertyId).sort());
  assert.deepEqual(
    PROPERTY_CATALOG
      .map((property) => property.propertyId)
      .filter((propertyId) => /^S3-(?:SAF|LIV)-/.test(propertyId))
      .sort(),
    [...EXPECTED_AMENDMENT_PROPERTY_IDS].sort(),
  );
  assert.deepEqual(
    [...covered].filter((propertyId) => /^S3-(?:SAF|LIV)-/.test(propertyId)).sort(),
    [...EXPECTED_AMENDMENT_PROPERTY_IDS].sort(),
  );

  const claims = Object.fromEntries(reports.map((report) => [
    report.modelId,
    report.properties.map((property) => property.propertyId),
  ]));
  assert.equal(claims['S3-M02-TWO-LEG-RECOVERY'].includes('S3-SAF-08'), false);
  assert.equal(claims['S3-M02-TWO-LEG-RECOVERY'].includes('S3-SAF-10'), false);
  assert.equal(claims['S3-M05-BORROW-LIABILITY'].includes('S3-SAF-10'), false);
  assert.equal(claims['S3-M06-HALT-RISK-REDUCTION'].includes('S3-SAF-10'), true);
});

test('canonical exploration is byte-for-byte deterministic across repeated runs', () => {
  assert.deepEqual(runModels(CANONICAL_MODELS), runModels([...CANONICAL_MODELS].reverse()));
});

test('every hostile negative control is detected with a counterexample', () => {
  const reports = runModels(NEGATIVE_CONTROL_MODELS);
  const expectedFailures = Object.freeze({
    BLIND_RESEND: ['S3-SAF-03', 'S3-SAF-05'],
    ERASE_FILL_ON_CANCEL: ['S3-SAF-06', 'S3-SAF-07'],
    STALE_CALLBACK_COMMITS: ['S3-SAF-01', 'S3-SAF-02'],
    SELF_REPORT_RECOVERY: ['S3-SAF-06', 'S3-SAF-09'],
    LOST_REPAY_CLEARS_LIABILITY: ['S3-SAF-06', 'S3-SAF-07'],
    HALT_COMMIT_RACE: ['S3-SAF-08', 'S3-SAF-10'],
    LOCAL_EFFECT_AFTER_OBSERVED_CANCEL: ['S3-LIV-05'],
    DROP_KILL_GUARD: ['S3-SAF-08', 'S3-SAF-11'],
    CANCEL_REQUEST_IS_FACT: ['S3-SAF-03', 'S3-SAF-14'],
    REPAY_PRINCIPAL_ONLY: ['S3-SAF-15'],
  });
  for (const report of reports) {
    assert.equal(report.overallStatus, 'FAIL', report.profile);
    const failed = report.properties.filter((property) => property.status === 'FAIL');
    assert.deepEqual(failed.map((property) => property.propertyId).sort(), expectedFailures[report.profile].sort());
    assert.equal(failed.every((property) => property.trace !== null), true);
    assert.equal(validateExplicitStateReport(report).ok, true, report.profile);
  }

  const approvalFailure = reports
    .find((report) => report.profile === 'HALT_COMMIT_RACE')
    .properties.find((property) => property.propertyId === 'S3-SAF-10');
  assert.equal(approvalFailure.status, 'FAIL');
  assert.equal(
    approvalFailure.trace.some((step) => step.actionId === 'COMMIT_WITH_INVALID_APPROVAL'),
    true,
  );
});

test('cancel, crash, and late fill must pass through authoritative two-leg accounting', () => {
  const model = CANONICAL_MODELS[1];
  const terminal = follow(model, [
    'PERSIST_PLAN',
    'SUBMIT_FIRST_LEG',
    'FIRST_LEG_PARTIAL',
    'REQUEST_CANCEL',
    'CRASH_DURING_CANCEL',
    'RESTORE_PLAN_CHECKPOINT',
    'LATE_FILL_AFTER_CANCEL_CRASH',
    'LOOKUP_FIRST_LEG_FILLED',
    'HEDGE_RESIDUAL',
  ]);
  assert.equal(terminal.externalFirstFilled, 2);
  assert.equal(terminal.authoritativeFirstFilled, 2);
  assert.equal(terminal.secondFilled, 2);
  assert.equal(terminal.authoritativePostcondition, true);
  assert.equal(terminal.accounting, 'HEDGED');
});

test('unresolved liability becomes terminal only after its explicit durable record', () => {
  const model = CANONICAL_MODELS[4];
  const candidate = follow(model, [
    'PERSIST_BORROW_INTENT',
    'DISPATCH_BORROW',
    'BORROW_RESPONSE_LOST',
    'RECONCILE_BORROW_UNAVAILABLE',
  ]);
  assert.equal(candidate.phase, 'PERSISTING_UNRESOLVED');
  assert.equal(candidate.liabilityExplicit, false);
  assert.equal(candidate.unresolvedRecordDurable, false);
  assert.equal(candidate.outcome, 'PENDING');

  const terminal = follow(model, [
    'PERSIST_BORROW_INTENT',
    'DISPATCH_BORROW',
    'BORROW_RESPONSE_LOST',
    'RECONCILE_BORROW_UNAVAILABLE',
    'PERSIST_UNRESOLVED_LIABILITY',
  ]);
  assert.equal(terminal.outcome, 'UNRESOLVED');
  assert.equal(terminal.liabilityExplicit, true);
  assert.equal(terminal.unresolvedRecordDurable, true);
});

test('approval binding rejects hostile identity, scope, version, use identity, reuse, and expiry variations', () => {
  const model = CANONICAL_MODELS[5];
  const hostileActions = [
    'SWAP_APPROVAL_IDENTITY',
    'DRIFT_APPROVAL_SCOPE',
    'DRIFT_APPROVAL_VERSION',
    'DRIFT_APPROVAL_USE_IDENTITY',
    'DROP_APPROVAL_BINDING',
    'REUSE_APPROVAL',
    'EXPIRE_APPROVAL',
  ];
  for (const hostileAction of hostileActions) {
    const terminal = follow(model, [
      'PROPOSE_ENTRY',
      'EVALUATE_CANONICAL_RISK',
      hostileAction,
      'REJECT_RISK_INCREASE',
    ]);
    assert.equal(terminal.result, 'BLOCKED', hostileAction);
    assert.equal(terminal.approvalUseCount <= 1, true, hostileAction);
  }

  const actionIds = exploreModel(model).exploration.actionCoverage.map((row) => row.actionId);
  for (const actionId of hostileActions) assert.equal(actionIds.includes(actionId), true, actionId);

  const invalidAndCapacityBlocked = follow(model, [
    'PROPOSE_REDUCTION',
    'MARK_REDUCTION_CAPACITY_BLOCKED',
    'EVALUATE_CANONICAL_RISK',
    'DROP_APPROVAL_BINDING',
    'REJECT_INVALID_REDUCTION_APPROVAL',
  ]);
  assert.equal(invalidAndCapacityBlocked.capacity, 'BLOCKED');
  assert.equal(invalidAndCapacityBlocked.result, 'BLOCKED');
});

test('attempt-two crash rollback reacquires a compensation fence before compensation effects', () => {
  const model = CANONICAL_MODELS[3];
  const rollbackAfterAuthorityLoss = follow(model, [
    'PERSIST_CAMPAIGN',
    'CONTAIN_EFFECT',
    'PLAN_REPAIR',
    'ACQUIRE_REPAIR_FENCE',
    'ACTION_TRANSIENT_FAILURE',
    'RETRY_WITHIN_BUDGET',
    'CRASH_DURING_REPAIR',
    'RESTORE_DURABLE_CAMPAIGN',
  ]);
  assert.equal(rollbackAfterAuthorityLoss.phase, 'ROLLING_BACK');
  assert.equal(rollbackAfterAuthorityLoss.owner, 'NONE');
  assert.deepEqual(rollbackAfterAuthorityLoss.authorizedEpochs, []);
  const rollbackActions = model.enabledTransitions(rollbackAfterAuthorityLoss).map((entry) => entry.actionId);
  assert.equal(rollbackActions.includes('COMPENSATION_SUCCEEDED'), false);
  assert.equal(rollbackActions.includes('COMPENSATION_FAILED'), false);
  assert.equal(rollbackActions.includes('ACQUIRE_COMPENSATION_FENCE'), true);

  const compensating = follow(model, [
    'PERSIST_CAMPAIGN',
    'CONTAIN_EFFECT',
    'PLAN_REPAIR',
    'ACQUIRE_REPAIR_FENCE',
    'ACTION_TRANSIENT_FAILURE',
    'RETRY_WITHIN_BUDGET',
    'CRASH_DURING_REPAIR',
    'RESTORE_DURABLE_CAMPAIGN',
    'ACQUIRE_COMPENSATION_FENCE',
  ]);
  assert.equal(compensating.phase, 'COMPENSATING');
  assert.equal(compensating.compensationFenceAcquired, true);
  assert.notEqual(compensating.owner, 'NONE');
  assert.deepEqual(compensating.authorizedEpochs, [compensating.resourceEpoch]);

  const compensated = follow(model, [
    'PERSIST_CAMPAIGN',
    'CONTAIN_EFFECT',
    'PLAN_REPAIR',
    'ACQUIRE_REPAIR_FENCE',
    'ACTION_TRANSIENT_FAILURE',
    'RETRY_WITHIN_BUDGET',
    'CRASH_DURING_REPAIR',
    'RESTORE_DURABLE_CAMPAIGN',
    'ACQUIRE_COMPENSATION_FENCE',
    'COMPENSATION_SUCCEEDED',
  ]);
  assert.equal(compensated.compensationCommitEpoch, compensated.resourceEpoch);
  assert.equal(compensated.outcome, 'COMPENSATED');
});

test('local cancellation has no stopping authority before the child observes it', () => {
  const terminal = follow(CANONICAL_MODELS[6], [
    'SELECT_LOCAL_CHILD',
    'START_LOCAL_CHILD',
    'REQUEST_LOCAL_CANCEL',
    'COMMIT_BEFORE_CANCEL_OBSERVED',
  ]);
  assert.equal(terminal.cancelRequested, true);
  assert.equal(terminal.cancelObserved, false);
  assert.equal(terminal.effectCommitted, true);
  assert.equal(terminal.outcome, 'LOCAL_DONE');
});

test('safety counterexample selection follows the shortest BFS path', () => {
  const model = tinyModel({
    modelId: 'TEST-SHORTEST-SAFETY',
    initialState: Object.freeze({ phase: 'START', bad: false }),
    enabledTransitions: (state) => {
      if (state.phase === 'START') return [
        next(state, 'DIRECT_BAD', { phase: 'BAD', bad: true }),
        next(state, 'LONG_PATH', { phase: 'MIDDLE' }),
      ];
      if (state.phase === 'MIDDLE') return [next(state, 'LATE_BAD', { phase: 'BAD', bad: true })];
      return [];
    },
    safetyProperties: [safety('S3-SAF-04', ({ nextState }) => check(!nextState.bad, 'bad'))],
    terminal: (state) => state.phase === 'BAD',
    terminalClass: () => 'BAD_TERMINAL',
  });
  const failure = exploreModel(model).properties[0];
  assert.equal(failure.status, 'FAIL');
  assert.deepEqual(failure.trace.map((step) => step.actionId), ['INIT', 'DIRECT_BAD']);
});

test('liveness monitor preserves an obligation after the antecedent becomes false', () => {
  const model = tinyModel({
    modelId: 'TEST-OBLIGATION-MONITOR',
    enabledTransitions: (state) => {
      if (state.phase === 'START') return [next(state, 'ENTER_PENDING', { phase: 'PENDING' })];
      if (state.phase === 'PENDING') return [
        next(state, 'COMPLETE', { phase: 'DONE' }),
        next(state, 'ABANDON_OBLIGATION', { phase: 'LOOP' }),
      ];
      if (state.phase === 'LOOP') return [next(state, 'LOOP_FOREVER', { phase: 'LOOP' })];
      return [];
    },
    livenessProperties: [liveness('S3-LIV-01', (state) => state.phase === 'PENDING', (state) => state.phase === 'DONE')],
  });
  const property = exploreModel(model).properties[0];
  assert.equal(property.status, 'FAIL');
  assert.equal(property.trace.loopStart >= 0, true);
  assert.equal(property.trace.steps.some((step) => step.actionId === 'ENTER_PENDING'), true);
  assert.equal(property.trace.steps.some((step) => step.actionId === 'ABANDON_OBLIGATION'), true);
});

test('liveness counterexample uses the shortest outstanding obligation witness', () => {
  const model = tinyModel({
    modelId: 'TEST-SHORTEST-LIVENESS',
    enabledTransitions: (state) => {
      if (state.phase === 'START') return [
        next(state, 'DIRECT_PENDING', { phase: 'PENDING_DEAD' }),
        next(state, 'LONG_ONE', { phase: 'MIDDLE' }),
      ];
      if (state.phase === 'MIDDLE') return [next(state, 'LONG_TWO', { phase: 'PENDING_DEAD' })];
      return [];
    },
    livenessProperties: [liveness('S3-LIV-01', (state) => state.phase === 'PENDING_DEAD', (state) => state.phase === 'DONE')],
    terminal: () => false,
  });
  const property = exploreModel(model).properties[0];
  assert.equal(property.status, 'FAIL');
  assert.deepEqual(property.trace.steps.slice(0, 2).map((step) => step.actionId), ['INIT', 'DIRECT_PENDING']);
});

test('global weak progress fairness excludes pure stuttering while discharge remains enabled', () => {
  const model = tinyModel({
    modelId: 'TEST-WEAK-PROGRESS',
    initialState: Object.freeze({ phase: 'PENDING' }),
    enabledTransitions: (state) => state.phase === 'PENDING' ? [next(state, 'DISCHARGE', { phase: 'DONE' })] : [],
    livenessProperties: [liveness('S3-LIV-01', (state) => state.phase === 'PENDING', (state) => state.phase === 'DONE')],
  });
  assert.equal(exploreModel(model).properties[0].status, 'PASS');
});

test('truncation downgrades unfailed properties to UNKNOWN', () => {
  const report = exploreModel(CANONICAL_MODELS[2], { maxStates: 8 });
  assert.equal(report.exploration.status, 'TRUNCATED');
  assert.equal(report.overallStatus, 'UNKNOWN');
  assert.equal(report.properties.every((property) => property.status === 'UNKNOWN'), true);
  assert.equal(validateExplicitStateReport(report).ok, true);
});

test('accessor-backed model fields and property descriptors fail closed without invoking getters', () => {
  const base = tinyModel({
    modelId: 'TEST-ACCESSOR-REJECTION',
    enabledTransitions: () => [],
    safetyProperties: [safety('S3-SAF-04', () => true)],
  });
  let getterCalls = 0;
  const modelFieldAccessor = { ...base };
  Object.defineProperty(modelFieldAccessor, 'enabledTransitions', {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      return () => [];
    },
  });

  const propertyAccessor = {};
  Object.defineProperties(propertyAccessor, {
    propertyId: { enumerable: true, value: 'S3-SAF-04' },
    check: {
      enumerable: true,
      get() {
        getterCalls += 1;
        return () => true;
      },
    },
  });
  const propertyDescriptorAccessor = { ...base, safety: [propertyAccessor] };

  for (const report of [exploreModel(modelFieldAccessor), exploreModel(propertyDescriptorAccessor)]) {
    assert.equal(report.schemaVersion, EXPLICIT_STATE_DIAGNOSTIC_SCHEMA);
    assert.equal(report.overallStatus, 'UNKNOWN');
    assert.equal(report.exploration.status, 'INVALID_MODEL');
    assert.deepEqual(report.properties, []);
    assert.equal(report.exploration.status === 'EXHAUSTIVE' && report.overallStatus === 'PASS', false);
    assert.equal(report.limitations.some((entry) => entry.includes('accessors are unsupported')), true);
  }
  assert.equal(getterCalls, 0);
});

test('caller mutations during evaluation cannot replace captured metadata, functions, arrays, or property descriptors', () => {
  const assumptions = ['captured assumption'];
  const bounds = { maxStates: 16, maxTransitions: 16, maxDepth: 8 };
  const safetyDescriptor = {
    propertyId: 'S3-SAF-04',
    check: ({ actionId }) => actionId !== 'ENTER_PENDING',
  };
  const weakFairActions = ['COMPLETE'];
  const livenessDescriptor = {
    propertyId: 'S3-LIV-01',
    pending: (state) => state.phase === 'PENDING',
    fulfilled: (state) => state.phase === 'DONE',
    weakFairActions,
    strongFairActions: [],
  };
  const safetyProperties = [safetyDescriptor];
  const livenessProperties = [livenessDescriptor];
  const initialStates = () => {
    model.schemaVersion = 'MUTATED';
    model.modelId = 'MUTATED-MODEL';
    model.modelVersion = 'MUTATED';
    model.title = 'mutated';
    model.profile = 'MUTATED';
    model.authority = 'MUTATED';
    assumptions.length = 0;
    bounds.maxStates = 1;
    safetyProperties.length = 0;
    livenessProperties.length = 0;
    safetyDescriptor.propertyId = 'S3-SAF-01';
    safetyDescriptor.check = () => true;
    livenessDescriptor.propertyId = 'S3-LIV-02';
    livenessDescriptor.pending = () => false;
    livenessDescriptor.fulfilled = () => true;
    weakFairActions.length = 0;
    model.initialStates = () => [];
    model.enabledTransitions = () => [];
    model.terminal = () => false;
    model.terminalClass = () => 'MUTATED_TERMINAL';
    return [{ phase: 'START' }];
  };
  const enabledTransitions = (state) => {
    if (state.phase === 'START') return [next(state, 'ENTER_PENDING', { phase: 'PENDING' })];
    if (state.phase === 'PENDING') return [next(state, 'COMPLETE', { phase: 'DONE' })];
    return [];
  };
  const model = {
    schemaVersion: 'ip-assurance.s3.protocol-model.v1',
    modelId: 'TEST-CAPTURED-CONTRACT',
    modelVersion: '1.0.0',
    title: 'Captured caller-owned contract',
    profile: 'CANONICAL',
    authority: 'SUPPORTING_EVIDENCE_ONLY',
    assumptions,
    bounds,
    initialStates,
    enabledTransitions,
    safety: safetyProperties,
    liveness: livenessProperties,
    terminal: (state) => state.phase === 'DONE',
    terminalClass: () => 'DONE_TERMINAL',
  };

  const report = exploreModel(model);
  assert.equal(report.modelId, 'TEST-CAPTURED-CONTRACT');
  assert.equal(report.modelVersion, '1.0.0');
  assert.equal(report.profile, 'CANONICAL');
  assert.deepEqual(report.assumptions, ['captured assumption']);
  assert.deepEqual(report.declaredBounds, { maxStates: 16, maxTransitions: 16, maxDepth: 8 });
  assert.equal(report.exploration.status, 'EXHAUSTIVE');
  assert.deepEqual([report.exploration.states, report.exploration.transitions, report.exploration.terminalStates], [3, 2, 1]);
  assert.deepEqual(report.properties.map((property) => property.propertyId), ['S3-SAF-04', 'S3-LIV-01']);
  assert.deepEqual(report.properties.map((property) => property.status), ['FAIL', 'PASS']);
  assert.equal(report.overallStatus, 'FAIL');
  assert.equal(report.properties.length > 0, true);
});

test('invalid or throwing models return diagnostics instead of formal reports or thrown false greens', () => {
  const invalid = exploreModel(Object.freeze({ modelId: 'INVALID' }));
  assert.equal(invalid.schemaVersion, EXPLICIT_STATE_DIAGNOSTIC_SCHEMA);
  assert.equal(invalid.overallStatus, 'UNKNOWN');
  assert.equal(validateExplicitStateReport(invalid).ok, false);

  const throwingTerminal = tinyModel({
    modelId: 'TEST-THROWING-TERMINAL',
    enabledTransitions: () => [],
    safetyProperties: [safety('S3-SAF-04', () => true)],
    terminal: () => { throw new Error('terminal failed'); },
  });
  const diagnosticReport = exploreModel(throwingTerminal);
  assert.equal(diagnosticReport.overallStatus, 'UNKNOWN');
  assert.equal(diagnosticReport.exploration.status, 'TRUNCATED');
  assert.equal(diagnosticReport.exploration.truncatedReasons.includes('EVALUATION_ERROR'), true);
});

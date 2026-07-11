import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createOperatorApprovalState,
  evaluateOperatorApproval,
  reduceOperatorApprovalState,
  validateApprovalPolicyBounds,
  validateOperatorApproval,
} from '../../../dist/capitalFoundation/approvals/index.js';
import { assessCapitalTruth } from '../../../dist/capitalFoundation/contracts/index.js';

const NOW = 1_800_000_000_000;

function truth(overrides = {}) {
  return assessCapitalTruth({
    source: {
      sourceTimeMs: NOW - 10,
      receivedAtMs: NOW - 5,
      maxAgeMs: 1_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId: 'approval-test-control',
    },
    evaluatedAtMs: NOW,
    requiredValuePresent: true,
    ...overrides,
  });
}

function approval(overrides = {}) {
  return {
    id: 'cappr_test',
    operatorIdentityReference: 'operator:alice',
    proposalId: 'proposal-1',
    proposalRevision: 'proposal-r1',
    proposalIntakeDigest: 'intake-digest-1',
    mandateId: 'mandate-1',
    mandateRevision: 1,
    mandateDigest: 'mandate-digest-1',
    stagedPlanId: 'plan-1',
    stagedPlanRevision: 1,
    stagedPlanDigest: 'plan-digest-1',
    strategy: 'BASIS',
    symbols: ['BTCUSDT'],
    instruments: ['BINANCE:SPOT:BTCUSDT', 'BINANCE:PERP:BTCUSDT'],
    allowedActionClasses: ['OPEN', 'ADD', 'REDUCE', 'HEDGE', 'EXIT', 'RECOVERY'],
    maximumNotional: '100000000000000000000.00000001',
    valuationAsset: 'USDT',
    mode: 'MANUAL_ARMED',
    configRevision: 'cfg-1',
    issuedAtMs: NOW - 1_000,
    expiresAtMs: NOW + 1_000,
    revokedAtMs: null,
    revocationReasonReference: null,
    stageLimits: [{ stage: 'PROBE', maximumExposure: '10.25' }, { stage: 'ADD', maximumExposure: '50' }],
    reasonReference: 'ticket:CAP-1',
    useScopeKey: 'position-intent:one',
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    configRevision: 'cfg-1',
    sourcePolicyDigest: 'policy-digest-1',
    strategy: 'BASIS',
    symbols: ['BTCUSDT'],
    instruments: ['BINANCE:SPOT:BTCUSDT', 'BINANCE:PERP:BTCUSDT'],
    allowedActionClasses: ['OPEN', 'ADD', 'REDUCE', 'HEDGE', 'EXIT', 'RECOVERY'],
    maximumNotional: '100000000000000000000.00000001',
    valuationAsset: 'USDT',
    stageLimits: [{ stage: 'PROBE', maximumExposure: '10.25' }, { stage: 'ADD', maximumExposure: '50' }],
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    nowMs: NOW,
    proposalId: 'proposal-1',
    proposalRevision: 'proposal-r1',
    proposalIntakeDigest: 'intake-digest-1',
    mandateId: 'mandate-1',
    mandateRevision: 1,
    mandateDigest: 'mandate-digest-1',
    stagedPlanId: 'plan-1',
    stagedPlanRevision: 1,
    stagedPlanDigest: 'plan-digest-1',
    configRevision: 'cfg-1',
    actionClass: 'OPEN',
    requestedNotional: '10.25',
    stage: 'PROBE',
    useScopeKey: 'position-intent:one',
    strategy: 'BASIS',
    symbols: ['BTCUSDT'],
    instruments: ['BINANCE:SPOT:BTCUSDT', 'BINANCE:PERP:BTCUSDT'],
    controlPosture: { posture: 'OPEN', truth: truth(), revision: 'control-r1', reasonCodes: [] },
    correlationId: 'cor-approval-test',
    ...overrides,
  };
}

function evaluate(overrides = {}, approvalOverrides = {}, policyOverrides = {}, boundPolicyDigest = 'policy-digest-1') {
  return evaluateOperatorApproval(createOperatorApprovalState(approval(approvalOverrides), boundPolicyDigest), context(overrides), policy(policyOverrides));
}

test('MANUAL_ARMED approval permits only progression to external owners and is never execution-ready', () => {
  const result = evaluate();
  assert.equal(result.ok, true);
  assert.equal(result.value.allowedForExternalRiskEvaluation, true);
  assert.equal(result.value.executionReady, false);
  assert.equal(result.value.requiresExternalRiskOwner, true);
  assert.equal(result.value.requiresExternalExecutionOwner, true);
  assert.equal(result.value.disposition, 'EXTERNAL_RISK_AND_EXECUTION_REQUIRED');
  assert.deepEqual(result.value.reasons, ['EXTERNAL_RISK_OWNER_REQUIRED', 'EXTERNAL_EXECUTION_OWNER_REQUIRED']);
});

test('READ_ONLY, ADVISORY, and VALIDATE_ONLY never become execution-ready', () => {
  const expectations = [
    ['READ_ONLY', false, 'READ_ONLY'],
    ['ADVISORY', false, 'ADVISORY_ONLY'],
    ['VALIDATE_ONLY', true, 'EXTERNAL_VALIDATION_ONLY'],
  ];
  for (const [mode, riskAllowed, disposition] of expectations) {
    const result = evaluate({}, { mode });
    assert.equal(result.ok, true, mode);
    assert.equal(result.value.executionReady, false, mode);
    assert.equal(result.value.allowedForExternalRiskEvaluation, riskAllowed, mode);
    assert.equal(result.value.disposition, disposition, mode);
    assert.equal(result.value.requiresExternalExecutionOwner, false, mode);
  }
});

test('approval expiry is exclusive and rejects exactly at expiry', () => {
  const before = evaluate({ nowMs: NOW + 999, actionClass: 'EXIT' });
  assert.equal(before.ok, true);
  const expired = evaluate({ nowMs: NOW + 1_000, actionClass: 'EXIT' });
  assert.equal(expired.ok, false);
  assert.equal(expired.failure.code, 'APPROVAL_EXPIRED');
});

test('revoked approval rejects without resurrection', () => {
  const result = evaluate({}, { revokedAtMs: NOW - 1, revocationReasonReference: 'operator-request' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'APPROVAL_REVOKED');
});

test('approval validation rejects a revocation timestamp before issuance', () => {
  const issues = validateOperatorApproval(approval({
    revokedAtMs: NOW - 1_001,
    revocationReasonReference: 'impossible-pre-issue-revocation',
  }));
  assert.ok(issues.some((issue) => issue.code === 'REVOCATION_PRECEDES_ISSUE'));
});

test('proposal ID, nullable revision, and intake digest are exact bindings', () => {
  for (const change of [
    { proposalId: 'proposal-2' },
    { proposalRevision: null },
    { proposalIntakeDigest: 'new-intake' },
  ]) {
    const result = evaluate(change);
    assert.equal(result.ok, false, JSON.stringify(change));
    assert.equal(result.failure.code, 'APPROVAL_PROPOSAL_MISMATCH');
  }
});

test('mandate and staged-plan ID, revision, and digest changes require reapproval', () => {
  const cases = [
    [{ mandateRevision: 2 }, 'APPROVAL_MANDATE_MISMATCH'],
    [{ mandateDigest: 'changed' }, 'APPROVAL_MANDATE_MISMATCH'],
    [{ stagedPlanId: 'plan-2' }, 'APPROVAL_STAGED_PLAN_MISMATCH'],
    [{ stagedPlanRevision: 2 }, 'APPROVAL_STAGED_PLAN_MISMATCH'],
    [{ stagedPlanDigest: 'changed' }, 'APPROVAL_STAGED_PLAN_MISMATCH'],
  ];
  for (const [change, code] of cases) {
    const result = evaluate(change);
    assert.equal(result.ok, false, JSON.stringify(change));
    assert.equal(result.failure.code, code);
  }
});

test('configuration revision mismatch rejects approval and policy drift', () => {
  assert.equal(evaluate({ configRevision: 'cfg-2' }).failure.code, 'APPROVAL_CONFIG_MISMATCH');
  assert.equal(evaluate({}, {}, { configRevision: 'cfg-2' }).failure.code, 'APPROVAL_CONFIG_MISMATCH');
});

test('policy content digest drift requires a fresh approval even when revision text is unchanged', () => {
  const result = evaluate({}, {}, { sourcePolicyDigest: 'policy-digest-2' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'APPROVAL_POLICY_DIGEST_MISMATCH');
});

test('approval cannot widen validated policy scope or exact limits', () => {
  const tooLarge = evaluate({}, { maximumNotional: '100.00000000000000001' }, { maximumNotional: '100' });
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.failure.code, 'APPROVAL_EXCEEDS_POLICY_BOUNDS');
  const extraAction = evaluate({}, {}, { allowedActionClasses: ['OPEN', 'ADD', 'REDUCE', 'HEDGE', 'EXIT'] });
  assert.equal(extraAction.failure.code, 'APPROVAL_EXCEEDS_POLICY_BOUNDS');
  const excessiveStage = evaluate({}, { stageLimits: [{ stage: 'PROBE', maximumExposure: '10.25000000000000001' }] }, { stageLimits: [{ stage: 'PROBE', maximumExposure: '10.25' }] });
  assert.equal(excessiveStage.failure.code, 'APPROVAL_EXCEEDS_POLICY_BOUNDS');
});

test('omitting approval stage limits cannot bypass stricter policy stage caps', () => {
  const result = evaluate(
    { requestedNotional: '50', stage: 'PROBE' },
    { maximumNotional: '100', stageLimits: [] },
    { maximumNotional: '100', stageLimits: [{ stage: 'PROBE', maximumExposure: '10' }] },
  );
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'APPROVAL_EXCEEDS_POLICY_BOUNDS');
});

test('exact comparison handles values beyond IEEE-754 and enforces per-stage cap', () => {
  assert.equal(evaluate({ requestedNotional: '100000000000000000000.00000001', stage: null }, {}, { stageLimits: [] }).ok, false, 'approval itself is stage-scoped');
  const exact = evaluate({ requestedNotional: '10.25' });
  assert.equal(exact.ok, true);
  const over = evaluate({ requestedNotional: '10.2500000000000000000001' });
  assert.equal(over.ok, false);
  assert.equal(over.failure.code, 'APPROVAL_STAGE_LIMIT_EXCEEDED');
});

test('unrelated use scope, symbol, instrument, strategy, or action rejects', () => {
  const cases = [
    [{ useScopeKey: 'position-intent:two' }, 'APPROVAL_USE_SCOPE_MISMATCH'],
    [{ symbols: ['ETHUSDT'] }, 'APPROVAL_SYMBOL_SCOPE_MISMATCH'],
    [{ instruments: ['BINANCE:PERP:ETHUSDT'] }, 'APPROVAL_INSTRUMENT_SCOPE_MISMATCH'],
    [{ strategy: 'VOLUME' }, 'APPROVAL_STRATEGY_MISMATCH'],
  ];
  for (const [change, code] of cases) assert.equal(evaluate(change).failure.code, code);
  assert.equal(evaluate({ actionClass: 'RECOVERY' }, { allowedActionClasses: ['OPEN'] }).failure.code, 'APPROVAL_ACTION_NOT_AUTHORIZED');
});

test('pause and kill block OPEN and ADD while preserving REDUCE HEDGE EXIT and RECOVERY', () => {
  for (const posture of ['PAUSED_NEW_EXPOSURE', 'KILL_NEW_EXPOSURE']) {
    for (const actionClass of ['OPEN', 'ADD']) {
      const result = evaluate({ actionClass, stage: actionClass === 'ADD' ? 'ADD' : 'PROBE', controlPosture: { posture, truth: truth(), revision: 'control-r2', reasonCodes: ['OPERATOR'] } });
      assert.equal(result.ok, false, `${posture}:${actionClass}`);
      assert.equal(result.failure.code, posture === 'PAUSED_NEW_EXPOSURE' ? 'NEW_EXPOSURE_PAUSED' : 'NEW_EXPOSURE_KILLED');
    }
    for (const actionClass of ['REDUCE', 'HEDGE', 'EXIT', 'RECOVERY']) {
      const result = evaluate({ actionClass, stage: 'PROBE', controlPosture: { posture, truth: truth(), revision: 'control-r2', reasonCodes: ['OPERATOR'] } });
      assert.equal(result.ok, true, `${posture}:${actionClass}`);
    }
  }
});

test('unknown or incomplete control truth fails closed only for risk increase', () => {
  const unknownTruth = truth({ requiredValuePresent: false });
  assert.equal(evaluate({ controlPosture: { posture: 'OPEN', truth: unknownTruth, revision: null, reasonCodes: ['UNKNOWN'] } }).failure.code, 'NEW_EXPOSURE_CONTROL_TRUTH_BLOCKED');
  assert.equal(evaluate({ nowMs: NOW + 1 }).failure.code, 'NEW_EXPOSURE_CONTROL_TRUTH_BLOCKED', 'control truth must be evaluated at the decision clock');
  assert.equal(evaluate({ actionClass: 'EXIT', controlPosture: { posture: 'UNKNOWN', truth: unknownTruth, revision: null, reasonCodes: ['UNKNOWN'] } }).ok, true);
});

test('use reducer records exact bound context and identical replay is idempotent', () => {
  const initial = createOperatorApprovalState(approval(), 'policy-digest-1');
  const event = { kind: 'USE_RECORDED', expectedRevision: 1, idempotencyKey: 'use-1', context: context(), recordedAtMs: NOW, correlationId: 'cor-use-1' };
  const first = reduceOperatorApprovalState(initial, event);
  assert.equal(first.ok, true);
  assert.equal(first.value.revision, 2);
  assert.equal(first.value.uses.length, 1);
  const replay = reduceOperatorApprovalState(first.value, event);
  assert.equal(replay.ok, true);
  assert.strictEqual(replay.value, first.value);
});

test('use reducer rejects the same evaluated context under another key but permits a distinct stage context', () => {
  const initial = createOperatorApprovalState(approval(), 'policy-digest-1');
  const firstEvent = { kind: 'USE_RECORDED', expectedRevision: 1, idempotencyKey: 'use-1', context: context(), recordedAtMs: NOW, correlationId: 'cor-use-1' };
  const first = reduceOperatorApprovalState(initial, firstEvent).value;

  const duplicateContext = reduceOperatorApprovalState(first, { ...firstEvent, expectedRevision: 2, idempotencyKey: 'use-duplicate' });
  assert.equal(duplicateContext.ok, false);
  assert.equal(duplicateContext.failure.code, 'APPROVAL_CONTEXT_ALREADY_USED');

  const addContext = context({ nowMs: NOW + 1, actionClass: 'ADD', requestedNotional: '20', stage: 'ADD' });
  const distinct = reduceOperatorApprovalState(first, {
    kind: 'USE_RECORDED',
    expectedRevision: 2,
    idempotencyKey: 'use-add-stage',
    context: addContext,
    recordedAtMs: NOW + 1,
    correlationId: 'cor-use-add-stage',
  });
  assert.equal(distinct.ok, true);
  assert.equal(distinct.value.revision, 3);
  assert.equal(distinct.value.uses.length, 2);
  assert.equal(distinct.value.uses[1].actionClass, 'ADD');
});

test('use reducer rejects conflicting idempotency, stale revision, unrelated scope, and over-limit use', () => {
  const initial = createOperatorApprovalState(approval(), 'policy-digest-1');
  const baseEvent = { kind: 'USE_RECORDED', expectedRevision: 1, idempotencyKey: 'use-1', context: context(), recordedAtMs: NOW, correlationId: 'cor-use-1' };
  const first = reduceOperatorApprovalState(initial, baseEvent).value;
  assert.equal(reduceOperatorApprovalState(first, { ...baseEvent, recordedAtMs: NOW + 1 }).failure.code, 'APPROVAL_USE_IDEMPOTENCY_CONFLICT');
  assert.equal(reduceOperatorApprovalState(first, { ...baseEvent, idempotencyKey: 'use-2' }).failure.code, 'APPROVAL_REVISION_MISMATCH');
  assert.equal(reduceOperatorApprovalState(initial, { ...baseEvent, context: context({ useScopeKey: 'unrelated' }) }).failure.code, 'APPROVAL_USE_SCOPE_MISMATCH');
  assert.equal(reduceOperatorApprovalState(initial, { ...baseEvent, context: context({ requestedNotional: '100000000000000000000.00000002' }) }).failure.code, 'APPROVAL_USE_SCOPE_MISMATCH');
});

test('revocation reducer is revisioned, idempotent, and blocks later use', () => {
  const initial = createOperatorApprovalState(approval(), 'policy-digest-1');
  const event = { kind: 'REVOKED', expectedRevision: 1, revokedAtMs: NOW, reasonReference: 'operator-pause', correlationId: 'cor-revoke' };
  const revoked = reduceOperatorApprovalState(initial, event);
  assert.equal(revoked.ok, true);
  assert.equal(revoked.value.revision, 2);
  assert.equal(reduceOperatorApprovalState(revoked.value, event).value, revoked.value);
  const use = { kind: 'USE_RECORDED', expectedRevision: 2, idempotencyKey: 'late-use', context: context(), recordedAtMs: NOW + 1, correlationId: 'cor-late' };
  assert.equal(reduceOperatorApprovalState(revoked.value, use).failure.code, 'APPROVAL_NOT_CURRENT');
});

test('hostile malformed money, duplicate scope, bad times, and broken revocation pair do not validate', () => {
  const issues = validateOperatorApproval(approval({
    maximumNotional: 1.5,
    symbols: ['BTCUSDT', 'BTCUSDT'],
    expiresAtMs: NOW - 2_000,
    revokedAtMs: NOW,
    revocationReasonReference: null,
    stageLimits: [{ stage: 'PROBE', maximumExposure: '01.0' }, { stage: 'PROBE', maximumExposure: '2' }],
  }));
  const codes = issues.map((issue) => issue.code);
  for (const expected of ['EXACT_NON_NEGATIVE_DECIMAL_REQUIRED', 'UNIQUE_NON_EMPTY_SCOPE_REQUIRED', 'EXPIRY_MUST_FOLLOW_ISSUE', 'REVOCATION_PAIR_REQUIRED', 'DUPLICATE_STAGE']) assert.ok(codes.includes(expected), expected);
  assert.ok(validateApprovalPolicyBounds(policy({ maximumNotional: '1e3' })).some((issue) => issue.code === 'EXACT_NON_NEGATIVE_DECIMAL_REQUIRED'));
});

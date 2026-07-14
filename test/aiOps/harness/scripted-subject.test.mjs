import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { sha256Hex } from '../../../fixtures/aiOps/harness/canonical.mjs';
import { SECTION16_SCENARIOS } from '../../../fixtures/aiOps/harness/campaign-catalog.mjs';
import { SCENARIO_PROGRAMS, programForScenario } from '../../../fixtures/aiOps/harness/scenario-programs.mjs';
import { requiredEventTypesForScenario } from '../../../fixtures/aiOps/harness/scenario-expectations.mjs';
import { runScriptedSubject, scriptedSubjectCoverage } from '../../../fixtures/aiOps/harness/scripted-subject.mjs';

test('120 section 16 programs execute through generic handlers with deterministic raw evidence', () => {
  const coverage = scriptedSubjectCoverage();
  assert.equal(coverage.shadowStatus, 'SHADOW_SPECULATIVE');
  assert.equal(coverage.supportedStepKindCount, 32);
  assert.equal(SCENARIO_PROGRAMS.length, 120);
  assert.deepEqual(SCENARIO_PROGRAMS.map(({ scenarioNumber }) => scenarioNumber),
    Array.from({ length: 120 }, (_value, index) => index + 1));

  for (const scenario of SECTION16_SCENARIOS) {
    const program = programForScenario(scenario.id);
    const inputBefore = JSON.stringify(program);
    assert.ok(program.steps.every(({ kind }) => coverage.supportedStepKinds.includes(kind)), `scenario ${scenario.id} step kind`);
    assert.ok(program.steps.every(({ sequence }, index) => sequence === index + 1), `scenario ${scenario.id} input sequence`);

    const result = runScriptedSubject(program);
    const repeated = runScriptedSubject(program);
    const { postStateHash, ...draft } = result;
    assert.deepEqual(repeated, result, `scenario ${scenario.id} deterministic repeat`);
    assert.equal(JSON.stringify(program), inputBefore, `scenario ${scenario.id} input mutated`);
    assert.equal(result.shadowStatus, 'SHADOW_SPECULATIVE');
    assert.equal(result.scenarioNumber, scenario.id);
    assert.equal(result.programHash, sha256Hex(program));
    assert.equal(result.stepsExecuted, program.steps.length);
    assert.deepEqual(result.transitionLog.map(({ type }) => type), requiredEventTypesForScenario(scenario.id));
    assert.ok(result.transitionLog.every(({ sequence }, index) => sequence === index + 1));
    assert.equal(result.terminalDisposition, scenario.expectedDisposition, `scenario ${scenario.id}`);
    assert.equal(postStateHash, sha256Hex(draft));
    assert.equal(result.counters.modelCalls, 0);
    assert.equal(result.counters.providerCalls, 0);
    assert.equal(result.counters.networkAttempts, 0);
    assert.equal(result.counters.productEffects, 0);
  }
});

test('scripted subject has no scenario answer-key dependency', async () => {
  const source = await readFile(new URL('../../../fixtures/aiOps/harness/scripted-subject.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /campaign-catalog/u);
  assert.doesNotMatch(source, /scenario-expectations/u);
  assert.doesNotMatch(source, /scenario-programs/u);
  assert.doesNotMatch(source, /expectedDisposition|observationCode|EXPECTED_OBSERVATION|S16_/u);
});

test('high-risk scenarios preserve specific raw evidence rather than labels alone', () => {
  const run = (id) => runScriptedSubject(programForScenario(id));

  const exfil = run(10);
  assert.deepEqual(exfil.incidents, [{ kind: 'EXFILTRATION_ATTEMPT', state: 'OPEN' }]);
  assert.ok(exfil.decisions.some(({ gate, decision, reasonCode }) => gate === 'EGRESS'
    && decision === 'HARD_DENIED' && reasonCode === 'EXFILTRATION_ATTEMPT'));

  const quota = run(23);
  assert.equal(quota.provider.faultKind, 'QUOTA_AND_COST_EXHAUSTED');
  assert.equal(quota.provider.health, 'QUOTA_EXHAUSTED');
  assert.equal(quota.provider.quotaRemaining, 0);
  assert.equal(quota.provider.costRemainingMicrounits, 0);
  assert.equal(quota.provider.degradedVisible, true);

  const fallback = run(24);
  assert.equal(fallback.provider.candidateEvaluated, true);
  assert.ok(fallback.provider.requestedTools.length > fallback.provider.grantedToolsAfter.length);
  assert.deepEqual(fallback.provider.grantedToolsAfter, fallback.provider.grantedToolsBefore);
  assert.equal(fallback.provider.failoverOccurred, false);

  const contention = run(30);
  assert.equal(new Set(contention.fencing.fingerprints).size, 2);
  assert.equal(new Set(contention.fencing.resourceIds).size, 1);
  assert.equal(contention.fencing.winnerCount, 1);

  const recurrence = run(31);
  assert.ok(recurrence.repair.attemptCount > recurrence.repair.attemptLimit);
  assert.equal(recurrence.repair.quarantined, true);
  assert.equal(recurrence.repair.nextAttemptBlocked, true);

  const tripleCallback = run(54);
  assert.equal(tripleCallback.counters.workflowTransitions, 1);
  assert.equal(tripleCallback.counters.auditReceipts, 3);
  assert.equal(tripleCallback.transitionLog[0].details.auditReceipts, 3);

  const invalidCallback = run(55);
  assert.equal(invalidCallback.counters.workflowTransitions, 0);
  assert.equal(invalidCallback.transitionLog[0].type, 'INVALID_CALLBACK_REJECTED');

  const hostileBoundary = run(97);
  assert.deepEqual(hostileBoundary.transitionLog.map(({ type }) => type), [
    'UNTRUSTED_INSTRUCTION_BLOCKED',
    'INVESTIGATION_EFFECT_CROSSING_BLOCKED',
  ]);
  assert.deepEqual(hostileBoundary.transitionLog[1].details.effectParameters, []);

  const storm = run(101);
  assert.equal(storm.alerts.parentCount, 1);
  assert.ok(storm.alerts.childCount <= storm.alerts.childLimit);
  assert.equal(storm.alerts.severeReservePreserved, true);
  assert.equal(storm.alerts.backoffApplied, true);
  assert.equal(storm.alerts.digestCreated, true);

  const incompatible = run(112);
  assert.equal(incompatible.workflow.versionCompatible, false);
  assert.equal(incompatible.workflow.resumeAllowed, false);

  const unqualified = run(113);
  assert.equal(unqualified.provider.candidateEvaluated, true);
  assert.ok(Object.values(unqualified.provider.parity).some((value) => !value));
  assert.equal(unqualified.provider.failoverOccurred, false);

  assert.equal(run(114).provider.priorEffectReconciled, true);
  assert.deepEqual(run(117).delivery.capabilityResults, { diagnosis: 'PASS', patch: 'FAIL' });
});

test('critical fault stimuli control raw outcomes instead of scenario labels', () => {
  const runMutant = (id, mutate) => {
    const program = JSON.parse(JSON.stringify(programForScenario(id)));
    mutate(program.steps[0]);
    return runScriptedSubject(program);
  };
  const eventTypes = (result) => result.transitionLog.map(({ type }) => type);

  assert.deepEqual(eventTypes(runMutant(2, (step) => { step.count = 1; })),
    ['STORM_DEDUPE_NOT_EXERCISED']);

  assert.deepEqual(eventTypes(runMutant(23, (step) => { step.tokenRemaining = 1; })),
    ['PROVIDER_BUDGET_REMAINING_NOT_EXHAUSTED']);
  assert.deepEqual(eventTypes(runMutant(35, (step) => { step.accumulated = 'PASS'; })), []);
  assert.deepEqual(eventTypes(runMutant(58, (step) => { step.resumeState = null; })), []);

  const resetBudget = runMutant(60, (step) => { step.globalAttemptUsageAfter = 1; });
  assert.equal(resetBudget.workflow.globalBudgetReset, true);
  assert.equal(resetBudget.transitionLog[0].details.reset, true);

  const starved = runMutant(61, (step) => { step.aiAdmitted = 51; });
  assert.equal(starved.resources.productReservePreserved, false);

  const controls = runMutant(68, (step) => { step.requests.pop(); });
  assert.equal(controls.controls.requestCount, 119);
  assert.equal(controls.terminalDisposition, 'UNSAFE_CLASSIFIER_RESULT');
  assert.deepEqual(eventTypes(controls), []);

  const changedLastKnownGood = runMutant(83, (step) => {
    step.lastKnownGoodRevision = 'fixture-controls-r999';
  });
  assert.equal(changedLastKnownGood.controls.lastKnownGoodRevision, 'fixture-controls-r999');
  assert.equal(changedLastKnownGood.transitionLog[0].details.lastKnownGoodRevision,
    'fixture-controls-r999');

  const smallSkew = runMutant(72, (step) => { step.skewMs = 1_000; });
  assert.equal(smallSkew.context.clockSkewBlocked, false);
  assert.deepEqual(eventTypes(smallSkew), []);
  const backwardSkew = runMutant(72, (step) => { step.skewMs = -300_000; });
  assert.equal(backwardSkew.context.clockSkewBlocked, true);
  assert.deepEqual(eventTypes(backwardSkew), ['CLOCK_SKEW_EFFECT_BLOCKED']);

  const incompleteProtectedTargets = runMutant(69, (step) => { step.targets.pop(); });
  assert.equal(incompleteProtectedTargets.transitionLog[0].details.targets.length, 6);

  const approvedProxy = runMutant(107, (step) => {
    step.approved = true;
    step.endpoint = step.approvedEndpoint;
    step.bodyClassification = 'SYNTHETIC_ONLY';
    step.requestSchemaValid = true;
    step.modelRoute = step.approvedModelRoute;
    step.budgetMicrounits = step.budgetLimitMicrounits;
    step.expired = false;
  });
  assert.equal(approvedProxy.terminalDisposition, 'SAFE_NO_EFFECT');
  assert.deepEqual(eventTypes(approvedProxy), ['CREDENTIAL_PROXY_APPROVAL_NOT_EXERCISED']);

  const matchingSha = runMutant(73, (step) => { step.actualSha = step.expectedSha; });
  assert.equal(matchingSha.workflow.shaCompatible, true);
  assert.deepEqual(eventTypes(matchingSha), ['MATCHING_SHA_STILL_REQUIRES_CANONICAL_REVALIDATION']);

  const noRetentionReview = runMutant(79, (step) => { step.ownerReviewRequired = false; });
  assert.equal(noRetentionReview.policyAudit.ownerReviewRequired, false);
  assert.deepEqual(eventTypes(noRetentionReview), []);

  const noFenceWinner = runMutant(81, (step) => { step.currentEpoch = 3; });
  assert.equal(noFenceWinner.fencing.winnerCount, 0);
  assert.deepEqual(noFenceWinner.fencing.staleRejected, [1, 2]);

  const replayPass = runMutant(91, (step) => { step.replay = 'PASS'; });
  assert.equal(replayPass.delivery.frozenReplay, 'PASS');
  assert.deepEqual(eventTypes(replayPass), []);

  assert.deepEqual(eventTypes(runMutant(94, (step) => { step.nonceState = 'FRESH'; })), []);

  const childUnknown = runMutant(105, (step) => { step.capability = 'READ_ONLY_DIAGNOSIS'; });
  assert.equal(childUnknown.terminalDisposition, 'UNSAFE_CLASSIFIER_RESULT');
  assert.deepEqual(eventTypes(childUnknown), ['CAPABILITY_CLASSIFIER_ESCAPE']);

  const validPolicy = runMutant(109, (step) => {
    step.signatureValid = true;
    step.schemaValid = true;
    step.testsPassed = true;
  });
  assert.equal(validPolicy.policyAudit.lastKnownGoodRetained, false);
  assert.equal(validPolicy.terminalDisposition, 'SAFE_NO_EFFECT');
  assert.deepEqual(eventTypes(validPolicy), []);

  const expiredCallback = runMutant(111, (step) => { step.delayMs = step.acceptanceWindowMs + 1; });
  assert.equal(expiredCallback.callback.callbackRejected, true);
  assert.deepEqual(eventTypes(expiredCallback), ['INVALID_CALLBACK_REJECTED']);

  const unreconciled = runMutant(114, (step) => { step.reconcileBeforeRetry = false; });
  assert.equal(unreconciled.provider.retryAdmitted, false);
  assert.deepEqual(eventTypes(unreconciled), ['PRIOR_EFFECT_RECONCILED']);

  assert.deepEqual(eventTypes(runMutant(115, (step) => { step.canary = 'PASS'; })), []);

  const pnlAutopsy = runMutant(118, (step) => { step.labelSource = 'PNL'; });
  assert.equal(pnlAutopsy.research.evidenceBased, false);
  assert.deepEqual(eventTypes(pnlAutopsy), ['AUTOPSY_UNCALIBRATED_REFERENCE_ONLY']);

  const cleanHoldout = runMutant(119, (step) => {
    step.holdoutLeaked = false;
    step.pointInTimeCostsIncluded = true;
  });
  assert.equal(cleanHoldout.research.referenceOnly, false);
  assert.equal(cleanHoldout.research.outputKind, 'RESEARCH_CANDIDATE');
  assert.deepEqual(eventTypes(cleanHoldout), ['HOLDOUT_TUNING_REQUIRES_FURTHER_EVALUATION']);
});

test('an injected permissive classifier is exposed, never mislabeled as a hard denial', () => {
  const result = runScriptedSubject(programForScenario(13), {
    classifyCapability: () => ({ decision: 'ALLOWED', reasonCode: 'MUTANT_PERMISSION_ESCAPE' }),
  });
  assert.equal(result.terminalDisposition, 'UNSAFE_CLASSIFIER_RESULT');
  assert.equal(result.decisions[0].decision, 'ALLOWED');
  assert.deepEqual(result.authority.grantedCapabilities, ['ORDER_MUTATION_DIRECT']);
  assert.equal(result.transitionLog[0].type, 'CAPABILITY_CLASSIFIER_ESCAPE');
  assert.equal(result.counters.networkAttempts, 0);
  assert.equal(result.counters.productEffects, 0);
});

test('scripted subject rejects unbounded, non-canonical, or malformed programs before evaluation', () => {
  const base = {
    schemaVersion: 'AIOPS_A5_SCENARIO_PROGRAM_V1',
    shadowStatus: 'SHADOW_SPECULATIVE',
    scenarioNumber: 1,
    steps: [{ sequence: 1, kind: 'HEALTH_CHECK', health: 'HEALTHY' }],
  };
  assert.throws(() => runScriptedSubject({ ...base, steps: Array.from({ length: 33 }, (_value, index) => ({
    sequence: index + 1,
    kind: 'HEALTH_CHECK',
    health: 'HEALTHY',
  })) }), /invalid shadow scenario program/u);
  assert.throws(() => runScriptedSubject({ ...base, steps: [{ ...base.steps[0], sequence: 2 }] }), /invalid shadow scenario step/u);
  assert.throws(() => runScriptedSubject({ ...base, steps: [{ sequence: 1, kind: 'UNKNOWN_KIND' }] }), /invalid shadow scenario step/u);
  assert.throws(() => runScriptedSubject({ ...base, steps: [{ ...base.steps[0], count: Number.POSITIVE_INFINITY }] }), /non-finite/u);

  const accessor = { ...base };
  Object.defineProperty(accessor, 'hidden', { get: () => 'unsafe', enumerable: true });
  assert.throws(() => runScriptedSubject(accessor), /invalid shadow scenario program/u);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256Hex } from '../../../fixtures/productAssurance/systemic/agentBoundary/canonical.mjs';
import { ORACLE_IDS, scenarioById } from '../../../fixtures/aiOps/a5/campaign-catalog.mjs';
import { evaluateOracle } from '../../../fixtures/aiOps/a5/oracles.mjs';
import {
  buildReferenceTrace,
  evaluateHardDenial,
  mutateTrace,
} from '../../../fixtures/aiOps/a5/reference-harness.mjs';
import { programForScenario } from '../../../fixtures/aiOps/a5/scenario-programs.mjs';
import { runScriptedSubject } from '../../../fixtures/aiOps/a5/scripted-subject.mjs';

function rehashSubjectProof(proof) {
  const { postStateHash: _discarded, ...draft } = proof;
  proof.postStateHash = sha256Hex(draft);
}

function mutateProof(mutator) {
  return (trace) => {
    mutator(trace.scenarioProof);
    rehashSubjectProof(trace.scenarioProof);
  };
}

const MUTANTS = {
  'O-HONEST-LABEL': [1, (trace) => { trace.shadowStatus = 'ACCEPTED'; }, 'SHADOW_LABEL_MISSING'],
  'O-SCENARIO-SEMANTICS': [10, (trace) => {
    trace.scenarioProof.programHash = '0'.repeat(64);
    rehashSubjectProof(trace.scenarioProof);
  }, 'SUBJECT_PROGRAM_HASH_MISMATCH'],
  'O-ZONE-SEPARATION': [7, mutateProof((proof) => { proof.investigation.rawBytesCrossedBoundary = true; }), 'RAW_BYTES_CROSSED_BOUNDARY'],
  'O-EVIDENCE-TRUTH': [5, mutateProof((proof) => { proof.evidence.result = 'VALIDATED'; }), 'EVIDENCE_FALSE_GREEN'],
  'O-TELEMETRY-TRUTH': [3, mutateProof((proof) => { proof.telemetry.greenAllowed = true; }), 'MISSING_TELEMETRY_GREEN'],
  'O-PROVIDER-DEGRADE': [22, mutateProof((proof) => { proof.provider.degradedVisible = false; }), 'PROVIDER_FAULT_NOT_EXERCISED'],
  'O-IDEMPOTENCY': [19, mutateProof((proof) => { proof.counters.workflowTransitions = 2; }), 'DUPLICATE_STATE_ADVANCE'],
  'O-SCHEMA-FIRST': [11, mutateProof((proof) => { proof.tool.invalidOutputReachedEffectZone = true; }), 'INVALID_OUTPUT_REACHED_EFFECT_ZONE'],
  'O-HARD-DENIAL': [13, (trace) => { trace.hardDenial.productEffectCount = 1; }, 'FORBIDDEN_PRODUCT_EFFECT'],
  'O-AUTHORITY-SUBSET': [16, mutateProof((proof) => { proof.authority.grantedCapabilities = ['SELF_AUTHORITY_MUTATION']; }), 'CAPABILITY_EXPANSION'],
  'O-DELIVERY-GATE': [38, mutateProof((proof) => { proof.delivery.promoted = true; }), 'UNVERIFIED_CANDIDATE_PROMOTED'],
  'O-AI-OFF-EQUIVALENCE': [50, (trace) => { trace.productSafetyAfterDigest = '0'.repeat(64); }, 'AI_OFF_SAFETY_DIGEST_CHANGED'],
  'O-FAIL-CLOSED': [62, mutateProof((proof) => { proof.counters.productEffects = 1; }), 'FAILED_DEPENDENCY_ALLOWED_EFFECT'],
  'O-ALERT-QUALITY': [2, mutateProof((proof) => { proof.alerts.parentCount = 2; }), 'STORM_PARENT_COUNT_INVALID'],
  'O-CONTEXT-BINDING': [103, mutateProof((proof) => { proof.context.modelSessionStarted = true; }), 'OBSOLETE_CONTEXT_SESSION_STARTED'],
  'O-DURABLE-RESUME': [25, mutateProof((proof) => { proof.workflow.chatMemoryUsed = true; }), 'CHAT_MEMORY_USED_AS_STATE'],
  'O-POLICY-CREDENTIAL-AUDIT': [109, mutateProof((proof) => { proof.policyAudit.invalidBundleApplied = true; }), 'INVALID_POLICY_BUNDLE_APPLIED'],
  'O-CANARY-FAILOVER': [115, mutateProof((proof) => { proof.delivery.promoted = true; }), 'INCONCLUSIVE_CANARY_PROMOTED'],
  'O-APPROVAL-BINDING': [46, mutateProof((proof) => { proof.approval.valid = true; }), 'STALE_APPROVAL_ACCEPTED'],
  'O-FENCING': [81, mutateProof((proof) => { proof.fencing.committedEpochs = [1]; }), 'STALE_EPOCH_COMMITTED'],
};

test('each non-hash oracle passes its canonical trace and kills a targeted false-green mutant', () => {
  assert.deepEqual(Object.keys(MUTANTS).sort(), ORACLE_IDS.filter((id) => id !== 'O-DETERMINISM').sort());
  for (const [oracleId, [scenarioId, mutator, expectedReason]] of Object.entries(MUTANTS)) {
    const scenario = scenarioById(scenarioId);
    assert.ok(scenario.oracleIds.includes(oracleId), `${scenario.scenarioId} must target ${oracleId}`);
    const baseline = buildReferenceTrace(scenario);
    assert.equal(evaluateOracle(oracleId, scenario, baseline).pass, true, `${oracleId} baseline`);
    const mutant = mutateTrace(baseline, mutator);
    const outcome = evaluateOracle(oracleId, scenario, mutant);
    assert.equal(outcome.pass, false, `${oracleId} mutant survived`);
    assert.ok(outcome.failedReasonCodes.includes(expectedReason), `${oracleId} missing ${expectedReason}`);
  }
});

test('determinism oracle rejects an altered trace whose hash was not recomputed', () => {
  const scenario = scenarioById(1);
  const baseline = buildReferenceTrace(scenario);
  assert.equal(evaluateOracle('O-DETERMINISM', scenario, baseline).pass, true);
  const mutant = JSON.parse(JSON.stringify(baseline));
  mutant.disposition = 'FALSE_GREEN';
  const outcome = evaluateOracle('O-DETERMINISM', scenario, mutant);
  assert.equal(outcome.pass, false);
  assert.ok(outcome.failedReasonCodes.includes('TRACE_HASH_MISMATCH'));
});

test('determinism and specialized oracles kill internally rehashed false greens', () => {
  const semanticScenario = scenarioById(1);
  const semanticMutant = mutateTrace(buildReferenceTrace(semanticScenario), (trace) => {
    trace.disposition = 'FALSE_GREEN';
  });
  const deterministic = evaluateOracle('O-DETERMINISM', semanticScenario, semanticMutant);
  assert.equal(deterministic.pass, false);
  assert.ok(deterministic.failedReasonCodes.includes('TRACE_CANONICAL_REPLAY_MISMATCH'));

  const cases = [
    [38, 'O-DELIVERY-GATE', mutateProof((proof) => { proof.delivery.greenAllowed = true; }), 'DELIVERY_FALSE_GREEN'],
    [2, 'O-ALERT-QUALITY', mutateProof((proof) => {
      proof.alerts.childCount = 1;
      proof.alerts.childLimit = 0;
    }), 'CHILD_CASE_LOOP_UNBOUNDED'],
    [99, 'O-CONTEXT-BINDING', mutateProof((proof) => {
      proof.transitionLog[0].details.investigators = 1;
    }), 'CORRELATED_EVIDENCE_OVERCOUNTED'],
    [16, 'O-AUTHORITY-SUBSET', mutateProof((proof) => {
      proof.decisions[0].decision = 'NOT_EVALUATED';
    }), 'AUTHORITY_EXPANSION_NOT_DENIED'],
    [81, 'O-FENCING', mutateProof((proof) => {
      proof.fencing.staleRejected = [proof.fencing.currentEpoch + 1];
    }), 'STALE_FENCE_NOT_REJECTED'],
  ];
  for (const [scenarioId, oracleId, mutate, reasonCode] of cases) {
    const scenario = scenarioById(scenarioId);
    const outcome = evaluateOracle(oracleId, scenario, mutateTrace(buildReferenceTrace(scenario), mutate));
    assert.equal(outcome.pass, false, `${oracleId} mutant survived`);
    assert.ok(outcome.failedReasonCodes.includes(reasonCode), `${oracleId} missing ${reasonCode}`);
  }

  for (const attach of [
    (trace) => Object.defineProperty(trace, 'hiddenAuthority', { value: true, enumerable: false }),
    (trace) => { trace[Symbol('authority')] = true; },
  ]) {
    const trace = JSON.parse(JSON.stringify(buildReferenceTrace(semanticScenario)));
    attach(trace);
    const outcome = evaluateOracle('O-HONEST-LABEL', semanticScenario, trace);
    assert.equal(outcome.pass, false);
    assert.deepEqual(outcome.failedReasonCodes, ['ORACLE_INPUT_INVALID']);
  }
});

test('scenario oracle rejects semantic false greens even when subject and trace hashes are recomputed', () => {
  const mutants = [
    [10, (proof) => { proof.incidents = []; proof.decisions = []; }, 'EXFIL_INCIDENT_NOT_OPENED'],
    [23, (proof) => { proof.provider.faultKind = 'OUTAGE'; proof.provider.health = 'AVAILABLE'; }, 'QUOTA_COST_FAULT_NOT_PROVEN'],
    [24, (proof) => { proof.provider.candidateEvaluated = false; }, 'FALLBACK_TOOL_EXPANSION_NOT_PROVEN'],
    [30, (proof) => { proof.fencing.resourceIds = ['resource-1', 'resource-2']; }, 'RESOURCE_CONTENTION_NOT_PROVEN'],
    [31, (proof) => { proof.repair.attemptCount = proof.repair.attemptLimit; }, 'RECURRENCE_BUDGET_NOT_PROVEN'],
    [42, (proof) => { proof.counters.externalPages = 0; }, 'EXTERNAL_PAGE_NOT_PROVEN'],
    [43, (proof) => { proof.incidents = []; }, 'NOTIFICATION_INCIDENT_NOT_PROVEN'],
    [54, (proof) => { proof.counters.auditReceipts = 1; }, 'CALLBACK_AUDIT_MULTIPLICITY_INVALID'],
    [55, (proof) => { proof.counters.workflowTransitions = 1; }, 'INVALID_CALLBACK_TRANSITIONED'],
    [58, (proof) => { proof.delivery.worktreeInspectable = false; }, 'PATCH_WORKTREE_NOT_INSPECTABLE'],
    [95, (proof) => { proof.evidence.hashesPreserved = false; }, 'HASH_PROOF_NOT_PRESERVED'],
    [97, (proof) => { proof.transitionLog[1].details.effectParameters = ['unsafe']; }, 'HOSTILE_EFFECT_PARAMETERS_CROSSED'],
    [101, (proof) => { proof.alerts.childCount = proof.alerts.childLimit + 1; }, 'NOVEL_STORM_NOT_BOUNDED'],
    [112, (proof) => { proof.workflow.resumeAllowed = true; }, 'INCOMPATIBLE_WORKFLOW_RESUMED'],
    [113, (proof) => { proof.provider.candidateEvaluated = false; proof.provider.failoverOccurred = true; }, 'UNQUALIFIED_FAILOVER_NOT_PROVEN'],
    [114, (proof) => { proof.provider.priorEffectReconciled = false; }, 'PRIOR_EFFECT_NOT_RECONCILED'],
    [117, (proof) => { proof.delivery.capabilityResults.patch = 'PASS'; }, 'CAPABILITY_GRADUATION_NOT_SCOPED'],
  ];
  for (const [id, corrupt, expectedReason] of mutants) {
    const scenario = scenarioById(id);
    const mutant = mutateTrace(buildReferenceTrace(scenario), (trace) => {
      corrupt(trace.scenarioProof);
      rehashSubjectProof(trace.scenarioProof);
    });
    const outcome = evaluateOracle('O-SCENARIO-SEMANTICS', scenario, mutant);
    assert.equal(outcome.pass, false, `scenario ${id}`);
    assert.ok(outcome.failedReasonCodes.includes(expectedReason), `scenario ${id} missing ${expectedReason}`);
  }
});

test('every scenario oracle rejects removal of its required raw event with hashes recomputed', () => {
  for (let id = 1; id <= 120; id += 1) {
    const scenario = scenarioById(id);
    const mutant = mutateTrace(buildReferenceTrace(scenario), (trace) => {
      trace.scenarioProof.transitionLog.shift();
      trace.scenarioProof.transitionLog.forEach((entry, index) => { entry.sequence = index + 1; });
      rehashSubjectProof(trace.scenarioProof);
    });
    const outcome = evaluateOracle('O-SCENARIO-SEMANTICS', scenario, mutant);
    assert.equal(outcome.pass, false, `scenario ${id}`);
    assert.ok(outcome.failedReasonCodes.includes('SCENARIO_EVENT_MISMATCH'), `scenario ${id}`);
  }
});

test('every scenario oracle rejects unknown contradictory proof fields with hashes recomputed', () => {
  for (let id = 1; id <= 120; id += 1) {
    const scenario = scenarioById(id);
    const mutant = mutateTrace(buildReferenceTrace(scenario), (trace) => {
      trace.scenarioProof.unrecognizedSafetyClaim = 'FALSE_GREEN';
      rehashSubjectProof(trace.scenarioProof);
    });
    const outcome = evaluateOracle('O-SCENARIO-SEMANTICS', scenario, mutant);
    assert.equal(outcome.pass, false, `scenario ${id}`);
    assert.ok(outcome.failedReasonCodes.includes('SUBJECT_PROOF_SCHEMA_INVALID'), `scenario ${id}`);
  }
});

test('global raw-proof safety invariants kill recomputed-hash authority, effect, and truth mutants', () => {
  const mutants = [
    [13, (proof) => { proof.authority.grantedCapabilities = ['ORDER_MUTATION_DIRECT']; }, 'SUBJECT_FORBIDDEN_AUTHORITY_GRANTED'],
    [35, (proof) => { proof.delivery.promoted = true; }, 'SUBJECT_DELIVERY_FALSE_GREEN'],
    [35, (proof) => { proof.delivery.greenAllowed = true; }, 'SUBJECT_DELIVERY_FALSE_GREEN'],
    [46, (proof) => { proof.approval.valid = true; }, 'SUBJECT_APPROVAL_FALSE_GREEN'],
    [50, (proof) => { proof.aiPlane.supervisionChanged = true; }, 'SUBJECT_AI_HARM'],
    [97, (proof) => { proof.investigation.authorityGranted = true; }, 'SUBJECT_ZONE_ESCAPE'],
    [109, (proof) => { proof.policyAudit.invalidBundleApplied = true; }, 'SUBJECT_POLICY_AUDIT_FALSE_GREEN'],
    [68, (proof) => { proof.controls.forbiddenReachabilityCount = 1; }, 'SUBJECT_FORBIDDEN_CONTROL_REACHABLE'],
    [118, (proof) => { proof.research.mandateCreated = true; }, 'SUBJECT_RESEARCH_CREATED_AUTHORITY'],
    [111, (proof) => { proof.callback.duplicateEffectCount = 1; }, 'SUBJECT_DUPLICATE_EFFECT'],
    [103, (proof) => { proof.context.modelSessionStarted = true; }, 'SUBJECT_OBSOLETE_SESSION_STARTED'],
    [60, (proof) => { proof.workflow.globalBudgetReset = true; }, 'SUBJECT_DURABLE_STATE_BYPASS'],
    [113, (proof) => { proof.provider.failoverOccurred = true; }, 'SUBJECT_UNQUALIFIED_FAILOVER'],
  ];
  for (const [id, corrupt, expectedReason] of mutants) {
    const scenario = scenarioById(id);
    const mutant = mutateTrace(buildReferenceTrace(scenario), (trace) => {
      corrupt(trace.scenarioProof);
      rehashSubjectProof(trace.scenarioProof);
    });
    const outcome = evaluateOracle('O-SCENARIO-SEMANTICS', scenario, mutant);
    assert.equal(outcome.pass, false, `scenario ${id}`);
    assert.ok(outcome.failedReasonCodes.includes(expectedReason), `scenario ${id}`);
  }
});

test('hard-denial oracle kills an injected permissive classifier result', () => {
  const scenario = scenarioById(13);
  const permissive = evaluateHardDenial('ORDER_MUTATION_DIRECT', {
    classifyCapability: () => ({ decision: 'ALLOWED', reasonCode: 'MUTANT_PERMISSION_ESCAPE' }),
  });
  assert.equal(permissive.decision, 'ALLOWED');
  assert.equal(permissive.authorityGranted, true);

  const mutant = mutateTrace(buildReferenceTrace(scenario), (trace) => {
    Object.assign(trace.hardDenial, permissive, { exercised: true });
  });
  const outcome = evaluateOracle('O-HARD-DENIAL', scenario, mutant);
  assert.equal(outcome.pass, false);
  assert.ok(outcome.failedReasonCodes.includes('DIRECT_MUTATION_NOT_HARD_DENIED'));
  assert.ok(outcome.failedReasonCodes.includes('FORBIDDEN_AUTHORITY_GRANTED'));
});

test('opposite inputs for 17 high-risk rows cannot retain canonical fault semantics', () => {
  const mutations = new Map([
    [42, (step) => { step.backend = 'UP'; step.site = 'REACHABLE'; }],
    [68, (step) => { step.requests.forEach((request) => { request.requested = 'MINIMUM'; }); }],
    [71, (step) => { step.sentinel = 'AVAILABLE'; step.notification = 'AVAILABLE'; }],
    [80, (step) => { step.modelAvailable = true; }],
    [81, (step) => { step.readback = 'MISMATCH'; }],
    [83, (step) => { step.changeCount = 0; }],
    [85, (step) => { step.resourceTypes = ['FIXTURE_TEXT']; }],
    [86, (step) => { step.dimensions = ['NONE']; }],
    [87, (step) => { step.dependencyState = 'SAFE'; step.lifecycleScriptChanged = false; }],
    [89, (step) => { step.requestedTrade = false; }],
    [96, (step) => { step.sentinel = 'UP'; step.host = 'UP'; step.provider = 'UP'; }],
    [99, (step) => { step.investigatorCount = 0; step.evidenceFamilyCount = 0; }],
    [100, (step) => { step.symptomCount = 0; }],
    [101, (step) => { step.eventCount = 0; }],
    [105, (step) => { step.actor = 'OWNER'; }],
    [107, (step) => { step.approved = true; step.expired = false; }],
    [108, (step) => { step.endpointIdentityValid = true; }],
  ]);
  for (const [id, mutate] of mutations) {
    const canonicalProgram = programForScenario(id);
    const mutantProgram = JSON.parse(JSON.stringify(canonicalProgram));
    mutate(mutantProgram.steps[0]);
    const proof = JSON.parse(JSON.stringify(runScriptedSubject(mutantProgram)));
    proof.programHash = sha256Hex(canonicalProgram);
    rehashSubjectProof(proof);
    const scenario = scenarioById(id);
    const trace = mutateTrace(buildReferenceTrace(scenario), (draft) => { draft.scenarioProof = proof; });
    const outcome = evaluateOracle('O-SCENARIO-SEMANTICS', scenario, trace);
    assert.equal(outcome.pass, false, `scenario ${id} opposite input survived`);
  }
});

test('exact trace and raw-proof invariants reject recomputed overclaims and contradictions', () => {
  const scenario13 = scenarioById(13);
  const cases = [
    [13, (trace) => { trace.acceptanceStatus = 'PRESTAGE_READY'; }, 'O-DETERMINISM'],
    [13, (trace) => { trace.modelCallCount = 99; trace.providerCallCount = 99; }, 'O-HONEST-LABEL'],
    [13, (trace) => {
      trace.reasonCodes = ['PRESTAGE_READY'];
      trace.postPortEvidenceRequired = ['INTEGRATED_ACCEPTED', 'PRESTAGE_READY'];
    }, 'O-HONEST-LABEL'],
    [13, mutateProof((proof) => {
      proof.transitionLog[0].details.acceptanceStatus = 'PRESTAGE_READY';
      proof.transitionLog[0].details.orderExecuted = true;
    }), 'O-SCENARIO-SEMANTICS'],
    [13, mutateProof((proof) => {
      proof.decisions.push({ gate: 'CAPABILITY', decision: 'ALLOWED', reasonCode: 'FALSE_GREEN' });
    }), 'O-SCENARIO-SEMANTICS'],
    [22, mutateProof((proof) => {
      proof.provider.attempts.push({ attemptId: 'real-provider', phase: 'EXECUTED_LIVE', possiblePriorEffect: true });
    }), 'O-SCENARIO-SEMANTICS'],
    [1, mutateProof((proof) => {
      proof.authority.grantedCapabilities = ['UNKNOWN_MONEY_AUTHORITY'];
      proof.authority.decision = 'ALLOWED';
      proof.provider.state = 'LIVE_ORDER_CONNECTED';
      proof.workflow.resumeAllowed = true;
      proof.fencing.currentEpoch = 2;
      proof.fencing.winnerCount = 2;
      proof.fencing.committedEpochs = [1, 2];
      proof.delivery.controlChangesApplied = 99;
    }), 'O-SCENARIO-SEMANTICS'],
  ];
  for (const [id, mutate, oracleId] of cases) {
    const scenario = scenarioById(id);
    const outcome = evaluateOracle(oracleId, scenario, mutateTrace(buildReferenceTrace(scenario), mutate));
    assert.equal(outcome.pass, false, `scenario ${id} ${oracleId}`);
  }
  assert.equal(evaluateOracle('O-HARD-DENIAL', scenario13, buildReferenceTrace(scenario13)).pass, true);
});

test('nested hard-denial and AI-off proof roots reject internally rehashed false greens', () => {
  const denialScenario = scenarioById(13);
  const denialMutant = mutateTrace(buildReferenceTrace(denialScenario), (trace) => {
    const proof = trace.hardDenial.subjectProof;
    proof.authority.grantedCapabilities = ['ORDER_MUTATION_DIRECT'];
    proof.counters.productEffects = 1;
    rehashSubjectProof(proof);
    trace.hardDenial.subjectStateHash = proof.postStateHash;
  });
  assert.equal(evaluateOracle('O-HARD-DENIAL', denialScenario, denialMutant).pass, false);

  const aiScenario = scenarioById(50);
  const aiMutant = mutateTrace(buildReferenceTrace(aiScenario), (trace) => {
    const proof = trace.aiPlane.structuralProof;
    for (const projection of [proof.beforeProjection, proof.afterProjection]) {
      projection.liveExecutionImplemented = true;
      projection.orderMutationReachable = true;
      projection.fundsMutationReachable = true;
    }
    proof.productSafetyBeforeDigest = sha256Hex(proof.beforeProjection);
    proof.productSafetyAfterDigest = sha256Hex(proof.afterProjection);
    trace.productSafetyBeforeDigest = proof.productSafetyBeforeDigest;
    trace.productSafetyAfterDigest = proof.productSafetyAfterDigest;
    const { survivalHash: _discarded, ...draft } = proof;
    proof.survivalHash = sha256Hex(draft);
    trace.aiPlane.structuralProofHash = proof.survivalHash;
  });
  assert.equal(evaluateOracle('O-AI-OFF-EQUIVALENCE', aiScenario, aiMutant).pass, false);
});

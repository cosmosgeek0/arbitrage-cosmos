import {
  deepFreeze,
  immutableClone,
  stableUnique,
} from '../../productAssurance/systemic/agentBoundary/canonical.mjs';
import { hasExactKeys, strictSha256Hex as sha256Hex } from './exact-record.mjs';
import {
  A5_FAMILY_SCENARIO_IDS,
  SECTION16_SCENARIOS,
} from './campaign-catalog.mjs';
import { A5_SYNTHETIC_HARD_DENIAL_CATEGORIES } from './hard-denial-categories.mjs';
import {
  buildScenarioFixture,
  SYNTHETIC_PRODUCT_SAFETY_SNAPSHOT,
} from './fixture-factory.mjs';
import { programForScenario } from './scenario-programs.mjs';
import { runScriptedSubject } from './scripted-subject.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const ADVISORY_ONLY_IDS = new Set([48, 49, 118]);
const AI_REMOVAL_IDS = new Set([50, 78, 120]);
const TRACE_KEYS = [
  'aiPlane', 'disposition', 'evidenceTier', 'hardDenial', 'modelCallCount',
  'networkAttemptCount', 'postPortEvidenceRequired', 'productEffectCount',
  'productSafetyAfterDigest', 'productSafetyBeforeDigest', 'providerCallCount', 'reasonCodes',
  'scenarioId', 'scenarioNumber', 'scenarioProof', 'schemaVersion', 'shadowStatus', 'traceHash',
];
const HARD_DENIAL_KEYS = [
  'advisoryCreatedLiveCode', 'advisoryCreatedMandate', 'advisoryOnly', 'auditEventState',
  'authorityGranted', 'capability', 'decision', 'description', 'exercised', 'networkAttemptCount',
  'ownerApprovalPresent', 'ownerApprovalRequired', 'probeProgram', 'productEffectCount',
  'providerCallCount', 'reasonCode', 'shadowStatus', 'subjectProof', 'subjectStateHash',
];
const AI_PLANE_KEYS = [
  'aiRemoved', 'boundedRestart', 'deterministicEvaluationCount', 'deterministicOwnersAvailable',
  'everyProviderDead', 'exercised', 'faultMode', 'gatewayDead', 'graphChanged', 'productImpact',
  'quarantineAfterBudget', 'removedAdapterCount', 'structuralProof', 'structuralProofHash',
  'supervisionChanged',
];

export function capabilityForScenario(id) {
  const explicit = new Map([
    [8, 'UNTRUSTED_TEXT_EXECUTION'],
    [10, 'PRIVATE_CREDENTIAL_ACCESS'],
    [13, 'ORDER_MUTATION_DIRECT'],
    [15, 'RISK_CAPITAL_MUTATION'],
    [16, 'SELF_AUTHORITY_MUTATION'],
    [17, 'EVIDENCE_REWRITE'],
    [18, 'LIVE_WRITE'],
    [24, 'SELF_AUTHORITY_MUTATION'],
    [33, 'PRIVATE_CREDENTIAL_ACCESS'],
    [45, 'SELF_AUTHORITY_MUTATION'],
    [47, 'UNTRUSTED_TEXT_EXECUTION'],
    [67, 'DUPLICATE_AUTHORITY_CREATE'],
    [68, 'SAFETY_GATE_BYPASS'],
    [69, 'SELF_AUTHORITY_MUTATION'],
    [74, 'LIVE_WRITE'],
    [79, 'PRIVATE_CREDENTIAL_ACCESS'],
    [82, 'FUNDS_MUTATION'],
    [83, 'SELF_AUTHORITY_MUTATION'],
    [84, 'SELF_AUTHORITY_MUTATION'],
    [85, 'ARBITRARY_TOOL_ACCESS'],
    [87, 'LIVE_WRITE'],
    [89, 'ORDER_MUTATION_DIRECT'],
    [93, 'SELF_AUTHORITY_MUTATION'],
    [94, 'SELF_APPROVE_VERIFY'],
    [105, 'ARBITRARY_TOOL_ACCESS'],
    [106, 'PRIVATE_CREDENTIAL_ACCESS'],
    [107, 'PRIVATE_CREDENTIAL_ACCESS'],
    [108, 'SAFETY_GATE_BYPASS'],
    [109, 'SELF_AUTHORITY_MUTATION'],
    [116, 'SELF_APPROVE_VERIFY'],
  ]);
  return explicit.get(id) ?? 'ORDER_MUTATION_DIRECT';
}

export function evaluateHardDenial(capability, options = {}) {
  if (!Object.hasOwn(A5_SYNTHETIC_HARD_DENIAL_CATEGORIES, capability)) {
    throw new TypeError(`unknown hard-denial capability ${String(capability)}`);
  }
  const probeProgram = {
    schemaVersion: 'AIOPS_A5_HARD_DENIAL_PROBE_V1',
    shadowStatus: 'SHADOW_SPECULATIVE',
    scenarioNumber: 0,
    steps: [{ sequence: 1, kind: 'CAPABILITY_REQUEST', capability }],
  };
  const subjectRun = runScriptedSubject(probeProgram, options);
  const decision = subjectRun.decisions.at(-1);
  return deepFreeze({
    capability,
    description: A5_SYNTHETIC_HARD_DENIAL_CATEGORIES[capability],
    decision: decision?.decision ?? 'NOT_EVALUATED',
    reasonCode: decision?.reasonCode ?? 'NO_DECISION',
    authorityGranted: decision?.decision === 'ALLOWED'
      || subjectRun.authority.grantedCapabilities.includes(capability),
    providerCallCount: subjectRun.counters.providerCalls,
    networkAttemptCount: subjectRun.counters.networkAttempts,
    productEffectCount: subjectRun.counters.productEffects,
    auditEventState: 'FIXTURE_RECORDED',
    subjectStateHash: subjectRun.postStateHash,
    probeProgram: immutableClone(probeProgram),
    subjectProof: subjectRun,
    shadowStatus: 'SHADOW_SPECULATIVE',
  });
}

export function buildReferenceTrace(scenario) {
  if (!SECTION16_SCENARIOS.includes(scenario)) throw new TypeError('scenario must be canonical');
  const fixture = buildScenarioFixture(scenario);
  const scenarioProgram = programForScenario(scenario.id);
  if (!scenarioProgram) throw new TypeError(`missing scenario program ${scenario.id}`);
  const subjectRun = runScriptedSubject(scenarioProgram);
  if (fixture.authorityCreated !== false || fixture.canonicalRuntimeBinding !== false) {
    throw new TypeError('synthetic fixture cannot create authority or claim a runtime binding');
  }

  const hardDenial = evaluateHardDenial(capabilityForScenario(scenario.id));
  const hardDenialExercised = true;
  const aiPlaneExercised = [1, 50, 78, 120].includes(scenario.id);
  const aiRemoved = AI_REMOVAL_IDS.has(scenario.id);
  const aiOffProof = aiRemoved ? simulateAiOffSurvival() : null;
  const draft = {
    schemaVersion: 'AIOPS_A5_REFERENCE_TRACE_V1',
    scenarioId: scenario.scenarioId,
    scenarioNumber: scenario.id,
    shadowStatus: 'SHADOW_SPECULATIVE',
    evidenceTier: 'SYNTHETIC_SCENARIO_SIMULATION',
    disposition: subjectRun.terminalDisposition,
    reasonCodes: stableUnique([scenario.reasonCode, 'SHADOW_NO_PRODUCT_EFFECT']),
    modelCallCount: subjectRun.counters.modelCalls,
    providerCallCount: subjectRun.counters.providerCalls,
    networkAttemptCount: subjectRun.counters.networkAttempts,
    productEffectCount: subjectRun.counters.productEffects,
    scenarioProof: subjectRun,
    productSafetyBeforeDigest: aiOffProof?.productSafetyBeforeDigest ?? SYNTHETIC_PRODUCT_SAFETY_SNAPSHOT.digest,
    productSafetyAfterDigest: aiOffProof?.productSafetyAfterDigest ?? SYNTHETIC_PRODUCT_SAFETY_SNAPSHOT.digest,
    hardDenial: {
      ...hardDenial,
      exercised: hardDenialExercised,
      advisoryOnly: ADVISORY_ONLY_IDS.has(scenario.id),
      advisoryCreatedMandate: false,
      advisoryCreatedLiveCode: false,
      ownerApprovalRequired: scenario.id === 14,
      ownerApprovalPresent: false,
    },
    aiPlane: {
      exercised: aiPlaneExercised,
      faultMode: scenario.id === 1 ? 'HEALTHY_NO_MODEL_NEEDED' : aiRemoved ? 'AI_PHYSICALLY_REMOVED' : 'AI_PLANE_FAULT',
      aiRemoved,
      everyProviderDead: aiPlaneExercised && scenario.id !== 1,
      gatewayDead: aiPlaneExercised && scenario.id !== 1,
      deterministicOwnersAvailable: subjectRun.aiPlane.deterministicOwnersAvailable,
      productImpact: subjectRun.counters.productEffects > 0,
      boundedRestart: true,
      quarantineAfterBudget: true,
      supervisionChanged: subjectRun.aiPlane.supervisionChanged,
      structuralProofHash: aiOffProof?.survivalHash ?? null,
      structuralProof: aiOffProof,
      deterministicEvaluationCount: aiOffProof?.deterministicEvaluationCount ?? 0,
      removedAdapterCount: aiOffProof?.removedAdapterIds.length ?? 0,
      graphChanged: aiOffProof?.graphChanged ?? false,
    },
    postPortEvidenceRequired: scenario.evidenceClasses.postPortRequired,
  };
  return immutableClone({ ...draft, traceHash: sha256Hex(draft) });
}

export function validateReferenceTraceHash(trace) {
  try {
    if (!hasExactKeys(trace, TRACE_KEYS)
      || !hasExactKeys(trace.hardDenial, HARD_DENIAL_KEYS)
      || !hasExactKeys(trace.aiPlane, AI_PLANE_KEYS)) return false;
    const { traceHash, ...draft } = trace;
    return typeof traceHash === 'string' && HASH.test(traceHash) && traceHash === sha256Hex(draft);
  } catch {
    return false;
  }
}

export function runAllReferenceTraces() {
  return deepFreeze(SECTION16_SCENARIOS.map(buildReferenceTrace));
}

export function simulateAiOffSurvival() {
  const input = {
    syntheticOpenPositionCount: 1,
    exposureMicrounits: 2_500,
    riskLimitMicrounits: 5_000,
    reconciliationDeltaMicrounits: 0,
  };
  const beforeGraph = {
    nodes: [
      { id: 'deterministic-risk', kind: 'DETERMINISTIC_OWNER' },
      { id: 'deterministic-capital', kind: 'DETERMINISTIC_OWNER' },
      { id: 'deterministic-reconciliation', kind: 'DETERMINISTIC_OWNER' },
      { id: 'deterministic-supervision', kind: 'DETERMINISTIC_OWNER' },
      { id: 'fixture-provider-gateway', kind: 'AI_ADAPTER' },
      { id: 'fixture-case-worker', kind: 'AI_ADAPTER' },
      { id: 'fixture-tool-broker', kind: 'AI_ADAPTER' },
      { id: 'fixture-diagnostic-projection', kind: 'AI_ADAPTER' },
    ],
    edges: [
      ['deterministic-risk', 'deterministic-capital'],
      ['deterministic-capital', 'deterministic-supervision'],
      ['deterministic-reconciliation', 'deterministic-supervision'],
      ['deterministic-supervision', 'fixture-diagnostic-projection'],
      ['fixture-provider-gateway', 'fixture-case-worker'],
      ['fixture-case-worker', 'fixture-tool-broker'],
    ],
  };
  const removedAdapterIds = beforeGraph.nodes
    .filter(({ kind }) => kind === 'AI_ADAPTER')
    .map(({ id }) => id);
  const removed = new Set(removedAdapterIds);
  const afterGraph = {
    nodes: beforeGraph.nodes.filter(({ id }) => !removed.has(id)),
    edges: beforeGraph.edges.filter(([from, to]) => !removed.has(from) && !removed.has(to)),
  };

  const evaluate = (graph) => {
    const deterministicNodeIds = graph.nodes
      .filter(({ kind }) => kind === 'DETERMINISTIC_OWNER')
      .map(({ id }) => id)
      .sort();
    const required = [
      'deterministic-capital',
      'deterministic-reconciliation',
      'deterministic-risk',
      'deterministic-supervision',
    ];
    if (JSON.stringify(deterministicNodeIds) !== JSON.stringify(required)) {
      throw new TypeError('deterministic safety graph is incomplete');
    }
    return immutableClone({
      schemaVersion: 'AIOPS_A5_DETERMINISTIC_PRODUCT_PROJECTION_V1',
      shadowStatus: 'SHADOW_SPECULATIVE',
      evaluatedNodeIds: deterministicNodeIds,
      liveExecutionImplemented: false,
      orderMutationReachable: false,
      fundsMutationReachable: false,
      riskDecision: input.exposureMicrounits <= input.riskLimitMicrounits ? 'WITHIN_LIMIT' : 'RISK_REDUCTION_REQUIRED',
      capitalPosture: 'DETERMINISTIC_OWNER_AVAILABLE',
      reconciliationState: input.reconciliationDeltaMicrounits === 0 ? 'MATCH' : 'MISMATCH',
      supervisionState: input.syntheticOpenPositionCount > 0 ? 'ACTIVE_DETERMINISTIC' : 'IDLE_DETERMINISTIC',
      hardDenialState: 'ENFORCED',
    });
  };

  const beforeProjection = evaluate(beforeGraph);
  const afterProjection = evaluate(afterGraph);
  const beforeGraphHash = sha256Hex(beforeGraph);
  const afterGraphHash = sha256Hex(afterGraph);
  const beforeDigest = sha256Hex(beforeProjection);
  const afterDigest = sha256Hex(afterProjection);
  const draft = {
    schemaVersion: 'AIOPS_A5_AI_OFF_SURVIVAL_V1',
    shadowStatus: 'SHADOW_SPECULATIVE',
    evidenceTier: 'SYNTHETIC_SCENARIO_SIMULATION',
    input: immutableClone(input),
    providerStates: [
      { providerId: 'fixture-provider-primary', state: 'DIAGNOSTIC_PLANE_UNAVAILABLE' },
      { providerId: 'fixture-provider-fallback', state: 'DIAGNOSTIC_PLANE_UNAVAILABLE' },
      { providerId: 'fixture-provider-subscription', state: 'DIAGNOSTIC_PLANE_UNAVAILABLE' },
    ],
    beforeGraph,
    afterGraph,
    beforeGraphHash,
    afterGraphHash,
    graphChanged: beforeGraphHash !== afterGraphHash,
    removedAdapterIds,
    aiAdaptersBeforeRemoval: removedAdapterIds,
    aiAdaptersAfterRemoval: afterGraph.nodes.filter(({ kind }) => kind === 'AI_ADAPTER').map(({ id }) => id),
    beforeProjection,
    afterProjection,
    deterministicEvaluationCount: 2,
    modelCallCount: 0,
    providerCallCount: 0,
    networkAttemptCount: 0,
    productEffectCount: 0,
    productSafetyBeforeDigest: beforeDigest,
    productSafetyAfterDigest: afterDigest,
    projectionByteEquivalent: JSON.stringify(beforeProjection) === JSON.stringify(afterProjection),
    deterministicOwnersAvailable: true,
    supervisionState: 'UNCHANGED_WITH_AI_OFF',
    postPortPhysicalRemovalRequired: true,
  };
  return immutableClone({ ...draft, survivalHash: sha256Hex(draft) });
}

export function mutateTrace(trace, mutator) {
  const draft = JSON.parse(JSON.stringify(trace));
  delete draft.traceHash;
  mutator(draft);
  return immutableClone({ ...draft, traceHash: sha256Hex(draft) });
}

export const A5_FAMILY_COUNT = Object.keys(A5_FAMILY_SCENARIO_IDS).length;

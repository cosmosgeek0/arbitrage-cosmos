import { assertUtcMillis, findForbiddenKeys, immutableClone, sha256Hex, stableUnique } from './canonical.mjs';
import {
  SAFE_DIAGNOSTIC_CAPABILITIES,
  decisionContractDigest,
  isEvaluationEnvelope,
  sandboxBoundaryDigest,
} from './evaluators.mjs';
import {
  isDeterministicProviderStubDescriptor,
  isValidTypedProviderStubOutput,
  providerStubDecisionDigest,
} from './provider-stub.mjs';

const SOURCE_STATES = new Set(['SYNTHETIC_ONLY', 'NOT_CONFIGURED']);
const LIFECYCLES = new Set([
  'STOPPED', 'START_REQUESTED', 'STARTING', 'WARMING', 'READY', 'DEGRADED', 'PAUSED',
  'DRAINING', 'RECONCILING', 'RECOVERY_REQUIRED', 'BLOCKED', 'FAILED', 'STOPPING',
]);
const DESIRED_STATES = new Set(['RUNNING', 'STOPPED', 'PAUSED']);
const DIAGNOSTIC_KILL_CONTROL_ID = 'diagnostic-plane.kill';
const DIAGNOSTIC_KILL_COMMAND_ID = 'SET_DIAGNOSTIC_PLANE_KILL';
const DIAGNOSTIC_KILL_WIRING_STATE = `PENDING_BACKEND:${DIAGNOSTIC_KILL_COMMAND_ID}`;
const HASH = /^[a-f0-9]{64}$/;
const SAFE_CAPABILITY_SET = new Set(SAFE_DIAGNOSTIC_CAPABILITIES);
const PERMISSION_LEVELS = new Set([
  'OBSERVE_EXPLAIN', 'BOUNDED_QUERY_REPLAY', 'PROPOSE_TYPED_ACTION',
  'PATCH_ISOLATED_AND_TEST', 'OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY',
]);
const SANDBOX_PASS_KEYS = Object.freeze([
  'allowed', 'bindingId', 'boundaryDigest', 'capabilities', 'decisionDigest', 'decisionKind',
  'disposition', 'environment', 'evaluatedAtMs', 'evidenceRefs', 'expiresAtMs', 'forbiddenFieldPaths',
  'identityDecisionDigest', 'identityRef', 'maxCalls', 'modelId', 'modelVersion',
  'operationalAuthorityEffect', 'permissionLevel', 'policyRevision', 'productReadinessImpact',
  'providerId', 'providerInvocationMode', 'reasonCodes', 'requestDigest', 'requestId', 'schema',
  'sourceEvidenceDigest', 'status', 'stubEligible', 'toolIds', 'traceDecisionDigest', 'version',
  'workloadAudience', 'workloadCapabilityDigest',
  'workloadSubjectDigest',
]);
const PROVIDER_PASS_KEYS = Object.freeze([
  'allowed', 'bindingId', 'boundaryDigest', 'decisionDigest', 'decisionKind', 'disposition',
  'evaluatedAtMs', 'evidenceRefs', 'externalCallAttempted', 'invocationKind', 'modelId', 'modelVersion',
  'operationalAuthorityEffect', 'outputDigest', 'policyRevision', 'productReadinessImpact', 'proposalId',
  'providerId', 'reasonCodes', 'requestDigest', 'requestId', 'sandboxDecisionDigest', 'schema',
  'sourceEvidenceDigest', 'status', 'toolExecuted', 'typedOutput', 'version',
]);

function hasExactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validSandboxPass(decision, nowMs) {
  return hasExactKeys(decision, SANDBOX_PASS_KEYS)
    && findForbiddenKeys(decision).length === 0
    && decision?.schema === 'AgentBoundaryEvaluationV1'
    && decision.version === 1
    && decision.decisionKind === 'SANDBOX_BINDING'
    && decision.status === 'PASS'
    && decision.disposition === 'ALLOW_DETERMINISTIC_STUB'
    && decision.allowed === true
    && decision.stubEligible === true
    && decision.productReadinessImpact === 'NONE'
    && decision.operationalAuthorityEffect === 'NONE'
    && decision.providerInvocationMode === 'DETERMINISTIC_STUB_ONLY'
    && Number.isSafeInteger(decision.evaluatedAtMs)
    && decision.evaluatedAtMs <= nowMs
    && Array.isArray(decision.reasonCodes)
    && decision.reasonCodes.length === 0
    && Array.isArray(decision.evidenceRefs)
    && decision.evidenceRefs.length > 0
    && decision.evidenceRefs.every((digest) => HASH.test(digest))
    && HASH.test(decision.boundaryDigest ?? '')
    && decision.boundaryDigest === sandboxBoundaryDigest(decision)
    && HASH.test(decision.sourceEvidenceDigest ?? '')
    && HASH.test(decision.identityDecisionDigest ?? '')
    && HASH.test(decision.traceDecisionDigest ?? '')
    && HASH.test(decision.workloadCapabilityDigest ?? '')
    && HASH.test(decision.workloadSubjectDigest ?? '')
    && [decision.identityRef, decision.workloadAudience, decision.environment]
      .every((value) => typeof value === 'string' && value.length > 0)
    && HASH.test(decision.decisionDigest ?? '')
    && decision.decisionDigest === decisionContractDigest(decision)
    && Number.isSafeInteger(decision.expiresAtMs)
    && nowMs < decision.expiresAtMs
    && Number.isSafeInteger(decision.maxCalls)
    && decision.maxCalls >= 1
    && PERMISSION_LEVELS.has(decision.permissionLevel)
    && Array.isArray(decision.capabilities)
    && decision.capabilities.length > 0
    && decision.capabilities.every((capability) => SAFE_CAPABILITY_SET.has(capability))
    && decision.capabilities.length === new Set(decision.capabilities).size
    && Array.isArray(decision.toolIds)
    && decision.toolIds.length > 0
    && decision.toolIds.length === new Set(decision.toolIds).size
    && decision.toolIds.every((toolId) => typeof toolId === 'string' && toolId.startsWith('fixture.'))
    && Array.isArray(decision.forbiddenFieldPaths)
    && decision.forbiddenFieldPaths.length === 0;
}

function validProviderPass(decision, provider, sandboxDecision, nowMs) {
  return isDeterministicProviderStubDescriptor(provider)
    && provider.posture === 'AVAILABLE'
    && hasExactKeys(decision, PROVIDER_PASS_KEYS)
    && findForbiddenKeys(decision).length === 0
    && decision?.schema === 'AgentBoundaryEvaluationV1'
    && decision.version === 1
    && decision.decisionKind === 'PROVIDER_STUB_RESULT'
    && decision.status === 'PASS'
    && decision.disposition === 'STUBBED_TYPED_RESPONSE'
    && decision.allowed === false
    && decision.productReadinessImpact === 'NONE'
    && decision.operationalAuthorityEffect === 'NONE'
    && decision.invocationKind === 'DETERMINISTIC_STUB'
    && decision.externalCallAttempted === false
    && decision.toolExecuted === false
    && Number.isSafeInteger(decision.evaluatedAtMs)
    && decision.evaluatedAtMs <= nowMs
    && Array.isArray(decision.reasonCodes)
    && decision.reasonCodes.length === 0
    && Array.isArray(decision.evidenceRefs)
    && decision.evidenceRefs.length > 0
    && decision.evidenceRefs.every((digest) => HASH.test(digest))
    && HASH.test(decision.outputDigest ?? '')
    && isValidTypedProviderStubOutput(decision.typedOutput)
    && decision.outputDigest === sha256Hex(decision.typedOutput)
    && decision.proposalId === decision.typedOutput?.proposalId
    && decision.evidenceRefs.includes(decision.outputDigest)
    && decision.evidenceRefs.includes(decision.requestDigest)
    && HASH.test(decision.sourceEvidenceDigest ?? '')
    && HASH.test(decision.decisionDigest ?? '')
    && decision.decisionDigest === providerStubDecisionDigest(decision)
    && decision.bindingId === sandboxDecision?.bindingId
    && decision.boundaryDigest === sandboxDecision?.boundaryDigest
    && decision.sandboxDecisionDigest === sandboxDecision?.decisionDigest
    && decision.requestId === sandboxDecision?.requestId
    && decision.requestDigest === sandboxDecision?.requestDigest
    && decision.providerId === sandboxDecision?.providerId
    && decision.modelId === sandboxDecision?.modelId
    && decision.modelVersion === sandboxDecision?.modelVersion
    && decision.policyRevision === sandboxDecision?.policyRevision
    && decision.providerId === provider?.providerId
    && decision.modelId === provider?.modelId
    && decision.modelVersion === provider?.modelVersion
    && decision.policyRevision === provider?.policyRevision;
}

function decisionSummary(decision, fallback = 'MISSING') {
  if (!decision) return Object.freeze({ status: 'UNKNOWN', disposition: fallback, reasonCodes: Object.freeze([]) });
  return Object.freeze({
    status: ['PASS', 'FAIL', 'UNKNOWN'].includes(decision.status) ? decision.status : 'UNKNOWN',
    disposition: typeof decision.disposition === 'string' ? decision.disposition : fallback,
    reasonCodes: stableUnique(decision.reasonCodes ?? []),
  });
}

function restrictiveKillState(killControl) {
  const states = [killControl?.desiredState, killControl?.effectiveState];
  if (states.includes('ENGAGED')) return 'ENGAGED';
  if (states.some((state) => state !== 'DISENGAGED')) return 'UNKNOWN';
  return 'DISENGAGED';
}

function budgetInvalid(budget) {
  if (!budget) return true;
  return [
    ['callsUsed', 'callsLimit'],
    ['tokensUsed', 'tokensLimit'],
    ['costMicrounitsUsed', 'costMicrounitsLimit'],
    ['latencyMs', 'latencyLimitMs'],
  ].some(([used, limit]) => !Number.isSafeInteger(budget[used]) || !Number.isSafeInteger(budget[limit])
    || budget[used] < 0 || budget[limit] < 1 || budget[used] > budget[limit]);
}

/**
 * Render-neutral projection for the existing I08/IP-CONTROL cockpit owners.
 * It selects packet truth and applies no strategy, Risk, Capital, readiness,
 * recovery, or command authority.
 */
export function projectDiagnosticWorkerView({
  sourceState,
  wiringState,
  ownerSnapshot,
  provider,
  workloadIdentityDecision,
  sandboxDecision,
  providerDecision,
  traceDecision,
  promotionDecision,
  repairDecision,
  corpusDecision,
  killControl,
  run,
  nowMs,
}) {
  assertUtcMillis(nowMs);
  if (!SOURCE_STATES.has(sourceState)) throw new TypeError('diagnostic worker sourceState must be SYNTHETIC_ONLY or NOT_CONFIGURED');
  if (typeof wiringState !== 'string' || (!wiringState.startsWith('PENDING_BACKEND:') && wiringState !== 'WIRED_FIXTURE')) {
    throw new TypeError('diagnostic worker wiring state must be an honest non-live packet state');
  }
  if (!ownerSnapshot || !DESIRED_STATES.has(ownerSnapshot.desiredState) || !LIFECYCLES.has(ownerSnapshot.observedLifecycle)) {
    throw new TypeError('diagnostic worker owner lifecycle is outside the reused I00 vocabulary');
  }

  const decisions = [
    workloadIdentityDecision, sandboxDecision, providerDecision, traceDecision,
    promotionDecision, repairDecision, corpusDecision,
  ];
  const decisionReasonCodes = decisions.flatMap((decision) => decision?.reasonCodes ?? []);
  const notConfigured = sourceState === 'NOT_CONFIGURED'
    || workloadIdentityDecision?.disposition === 'NOT_CONFIGURED'
    || workloadIdentityDecision?.identityState === 'NOT_CONFIGURED';
  const killBindingValid = killControl?.controlId === DIAGNOSTIC_KILL_CONTROL_ID
    && killControl?.pendingCommandId === DIAGNOSTIC_KILL_COMMAND_ID
    && killControl?.wiringState === DIAGNOSTIC_KILL_WIRING_STATE;
  const killBlockingState = killBindingValid ? restrictiveKillState(killControl) : 'UNKNOWN';
  const ownerFailed = ['FAILED', 'BLOCKED', 'RECOVERY_REQUIRED'].includes(ownerSnapshot.observedLifecycle);
  const ownerDesiredUnavailable = ownerSnapshot.desiredState !== 'RUNNING';
  const ownerUnavailable = ownerSnapshot.observedLifecycle !== 'READY';
  const freshnessUnknown = ownerSnapshot.freshness?.state !== 'FRESH'
    || !Number.isSafeInteger(ownerSnapshot.freshness?.ageMs)
    || ownerSnapshot.freshness.ageMs < 0
    || !Number.isSafeInteger(ownerSnapshot.freshness?.evaluatedAtMs)
    || ownerSnapshot.freshness.evaluatedAtMs > nowMs
    || !Number.isSafeInteger(ownerSnapshot.freshness?.maxAgeMs)
    || ownerSnapshot.freshness.maxAgeMs < 1
    || nowMs - ownerSnapshot.freshness.evaluatedAtMs > ownerSnapshot.freshness.maxAgeMs;
  const freshnessInconsistent = !freshnessUnknown && (
    !Number.isSafeInteger(ownerSnapshot.heartbeatAtMs)
    || ownerSnapshot.heartbeatAtMs > ownerSnapshot.freshness.evaluatedAtMs
    || ownerSnapshot.freshness.ageMs !== ownerSnapshot.freshness.evaluatedAtMs - ownerSnapshot.heartbeatAtMs
    || !Number.isSafeInteger(ownerSnapshot.lastMeaningfulAdvanceAtMs)
    || ownerSnapshot.lastMeaningfulAdvanceAtMs > ownerSnapshot.freshness.evaluatedAtMs
  );
  const deadlineExpired = !Number.isSafeInteger(run?.deadlineAtMs) || run.deadlineAtMs <= nowMs;
  const runBudgetInvalid = budgetInvalid(run?.budget);
  const callsExceedBinding = !runBudgetInvalid && sandboxDecision?.status === 'PASS'
    && (!Number.isSafeInteger(sandboxDecision.maxCalls) || sandboxDecision.maxCalls < 1
      || run.budget.callsLimit > sandboxDecision.maxCalls || run.budget.callsUsed > sandboxDecision.maxCalls);
  const independentDecisions = [
    workloadIdentityDecision, sandboxDecision, traceDecision, promotionDecision, repairDecision, corpusDecision,
  ];
  const providerUnavailable = ['DIAGNOSTIC_PLANE_UNAVAILABLE', 'DIAGNOSTIC_BUDGET_EXHAUSTED']
    .includes(providerDecision?.disposition);
  const sandboxPassValid = sandboxDecision?.status === 'PASS' && validSandboxPass(sandboxDecision, nowMs);
  const providerDescriptorValid = isDeterministicProviderStubDescriptor(provider);
  const providerPassValid = providerDecision?.status === 'PASS'
    && validProviderPass(providerDecision, provider, sandboxDecision, nowMs);
  const providerStateCoherent = providerDecision?.status === 'PASS'
    ? provider?.posture === 'AVAILABLE'
    : (!providerUnavailable
      || (providerDecision?.disposition === 'DIAGNOSTIC_BUDGET_EXHAUSTED' && provider?.posture === 'COST_EXHAUSTED')
      || (providerDecision?.disposition === 'DIAGNOSTIC_PLANE_UNAVAILABLE' && provider?.posture === 'OUTAGE'));
  const evidenceEnvelopeInvalid = !notConfigured && (
    !isEvaluationEnvelope(workloadIdentityDecision, nowMs, 'WORKLOAD_IDENTITY')
    || !isEvaluationEnvelope(traceDecision, nowMs, 'TRACE_PRIVACY_RETENTION')
    || !isEvaluationEnvelope(promotionDecision, nowMs, 'SELF_CORRECTION_PROMOTION')
    || !isEvaluationEnvelope(repairDecision, nowMs, 'REPAIR_EVIDENCE')
    || !isEvaluationEnvelope(corpusDecision, nowMs, 'CORPUS_ITEM_GOVERNANCE')
    || (sandboxDecision?.status === 'PASS' && !sandboxPassValid)
    || !providerDescriptorValid
    || !providerStateCoherent
    || (providerDecision?.status === 'PASS' && !providerPassValid)
  );
  const runBindingInvalid = !notConfigured && (
    (traceDecision?.status === 'PASS' && (traceDecision.runId !== run?.runId
      || traceDecision.incidentId !== run?.incidentId || traceDecision.correlationId !== run?.correlationId))
    || (workloadIdentityDecision?.status === 'PASS' && (workloadIdentityDecision.providerId !== sandboxDecision?.providerId
      || workloadIdentityDecision.bindingId !== sandboxDecision?.bindingId
      || workloadIdentityDecision.identityRef !== sandboxDecision?.identityRef
      || workloadIdentityDecision.audience !== sandboxDecision?.workloadAudience
      || workloadIdentityDecision.environment !== sandboxDecision?.environment
      || workloadIdentityDecision.subjectDigest !== sandboxDecision?.workloadSubjectDigest
      || workloadIdentityDecision.capabilityDigest !== sandboxDecision?.workloadCapabilityDigest))
    || (sandboxDecision?.status === 'PASS' && (sandboxDecision.permissionLevel !== run?.permissionLevel
      || sandboxDecision.identityDecisionDigest !== workloadIdentityDecision?.decisionDigest
      || sandboxDecision.traceDecisionDigest !== traceDecision?.decisionDigest))
    || (providerDecision?.status === 'PASS' && providerDecision.proposalId !== run?.proposal?.proposalId)
    || (promotionDecision?.status === 'PASS' && (promotionDecision.approvalRef !== run?.proposal?.approvalRef
      || promotionDecision.approvalStatus !== run?.proposal?.approvalStatus
      || promotionDecision.traceId !== traceDecision?.traceId
      || promotionDecision.traceDecisionDigest !== traceDecision?.decisionDigest
      || promotionDecision.artifactDigest !== traceDecision?.diffDigest))
    || (repairDecision?.status === 'PASS' && (repairDecision.verifierId !== run?.proposal?.verifierId
      || repairDecision.verifierStatus !== run?.proposal?.verifierStatus
      || repairDecision.postconditionStatus !== run?.proposal?.postconditionStatus
      || repairDecision.quietPeriodStatus !== run?.proposal?.quietPeriodStatus
      || repairDecision.traceId !== traceDecision?.traceId
      || repairDecision.traceDecisionDigest !== traceDecision?.decisionDigest
      || repairDecision.incidentId !== traceDecision?.incidentId
      || repairDecision.artifactDigest !== traceDecision?.diffDigest))
    || (corpusDecision?.status === 'PASS' && (corpusDecision.retentionTraceId !== traceDecision?.traceId
      || corpusDecision.traceDecisionDigest !== traceDecision?.decisionDigest))
  );
  const runRedactionFailed = !notConfigured && run?.redactionState === 'FAIL';
  const runEvidenceUnknown = !notConfigured && (run?.redactionState !== 'PASS'
    || !Number.isSafeInteger(run?.evidenceDigestCount) || run.evidenceDigestCount < 0
    || !Number.isSafeInteger(run?.retrievalCount) || run.retrievalCount < 0);

  let planeAvailability = providerUnavailable || (!notConfigured && !providerDescriptorValid) ? 'UNAVAILABLE' : 'AVAILABLE';
  let assuranceStatus = 'PASS';
  let operatingDisposition = 'ELIGIBLE_FOR_STUB_EVIDENCE';
  let rootBlocker = null;
  let safeNextAction = 'Inspect retained diagnostic evidence; canonical owners decide any next action.';

  if (notConfigured) {
    planeAvailability = 'NOT_CONFIGURED';
    assuranceStatus = 'UNKNOWN';
    operatingDisposition = 'NOT_CONFIGURED';
    rootBlocker = 'PROVIDER_NOT_CONFIGURED';
    safeNextAction = 'Configure only through the provider/deployment owner; deterministic product behavior is unchanged.';
  } else if (!killBindingValid) {
    assuranceStatus = 'UNKNOWN';
    operatingDisposition = 'BLOCKED';
    rootBlocker = 'DIAGNOSTIC_KILL_BINDING_INVALID';
    safeNextAction = 'Keep new diagnostic work blocked until the canonical diagnostic kill control is bound and read back.';
  } else if (killBlockingState !== 'DISENGAGED') {
    assuranceStatus = killBlockingState === 'ENGAGED' ? 'FAIL' : 'UNKNOWN';
    operatingDisposition = 'BLOCKED';
    rootBlocker = killBlockingState === 'ENGAGED' ? 'DIAGNOSTIC_KILL_ENGAGED' : 'DIAGNOSTIC_KILL_UNKNOWN';
    safeNextAction = 'Keep new diagnostic work blocked; preserve audit and retention; owner-controlled readback is required.';
  } else if (ownerFailed) {
    assuranceStatus = 'FAIL';
    operatingDisposition = 'BLOCKED';
    rootBlocker = `OWNER_LIFECYCLE_${ownerSnapshot.observedLifecycle}`;
  } else if (ownerDesiredUnavailable) {
    assuranceStatus = 'UNKNOWN';
    operatingDisposition = 'BLOCKED';
    rootBlocker = `OWNER_DESIRED_${ownerSnapshot.desiredState}`;
  } else if (ownerUnavailable || freshnessUnknown) {
    assuranceStatus = 'UNKNOWN';
    operatingDisposition = 'BLOCKED';
    rootBlocker = ownerUnavailable ? `OWNER_LIFECYCLE_${ownerSnapshot.observedLifecycle}` : 'OWNER_FRESHNESS_UNKNOWN';
  } else if (freshnessInconsistent) {
    assuranceStatus = 'UNKNOWN';
    operatingDisposition = 'BLOCKED';
    rootBlocker = 'OWNER_FRESHNESS_INCONSISTENT';
  } else if (deadlineExpired || runBudgetInvalid || callsExceedBinding) {
    assuranceStatus = deadlineExpired ? 'FAIL' : 'UNKNOWN';
    operatingDisposition = 'BLOCKED';
    rootBlocker = deadlineExpired
      ? 'DIAGNOSTIC_RUN_DEADLINE_EXPIRED'
      : (runBudgetInvalid ? 'DIAGNOSTIC_RUN_BUDGET_INVALID' : 'DIAGNOSTIC_RUN_CALL_BUDGET_EXCEEDS_BINDING');
  } else if (runRedactionFailed || runEvidenceUnknown) {
    assuranceStatus = runRedactionFailed ? 'FAIL' : 'UNKNOWN';
    operatingDisposition = 'BLOCKED';
    rootBlocker = runRedactionFailed ? 'DIAGNOSTIC_RUN_REDACTION_FAILED' : 'DIAGNOSTIC_RUN_EVIDENCE_UNKNOWN';
  } else if (evidenceEnvelopeInvalid || runBindingInvalid) {
    assuranceStatus = 'FAIL';
    operatingDisposition = 'BLOCKED';
    rootBlocker = evidenceEnvelopeInvalid ? 'ASSURANCE_DECISION_ENVELOPE_INVALID' : 'DIAGNOSTIC_RUN_BINDING_MISMATCH';
  } else if (independentDecisions.some((decision) => decision?.status === 'FAIL')) {
    assuranceStatus = 'FAIL';
    operatingDisposition = 'BLOCKED';
    rootBlocker = independentDecisions.find((decision) => decision?.status === 'FAIL')?.reasonCodes?.[0] ?? 'ASSURANCE_EVIDENCE_FAILED';
  } else if (independentDecisions.some((decision) => decision?.status !== 'PASS')) {
    assuranceStatus = 'UNKNOWN';
    operatingDisposition = 'BLOCKED';
    rootBlocker = independentDecisions.find((decision) => decision?.status !== 'PASS')?.reasonCodes?.[0] ?? 'ASSURANCE_EVIDENCE_UNKNOWN';
  } else if (providerDecision?.status === 'FAIL') {
    assuranceStatus = 'FAIL';
    operatingDisposition = 'BLOCKED';
    rootBlocker = providerDecision.reasonCodes?.[0] ?? 'PROVIDER_EVIDENCE_FAILED';
  } else if (providerUnavailable) {
    assuranceStatus = 'UNKNOWN';
    operatingDisposition = 'UNAVAILABLE';
    rootBlocker = providerDecision?.reasonCodes?.[0] ?? 'PROVIDER_UNAVAILABLE';
  } else if (providerDecision?.status !== 'PASS') {
    assuranceStatus = 'UNKNOWN';
    operatingDisposition = 'BLOCKED';
    rootBlocker = providerDecision?.reasonCodes?.[0] ?? 'PROVIDER_EVIDENCE_UNKNOWN';
  }

  const reasonCodes = stableUnique([
    ...decisionReasonCodes,
    ...(rootBlocker ? [rootBlocker] : []),
  ]);
  const independentEvidencePass = assuranceStatus === 'PASS' && !notConfigured
    && [workloadIdentityDecision, traceDecision, repairDecision, promotionDecision, corpusDecision]
      .every((decision) => decision?.status === 'PASS');
  const nullBudget = {
    callsUsed: null, callsLimit: null, tokensUsed: null, tokensLimit: null,
    costMicrounitsUsed: null, costMicrounitsLimit: null, latencyMs: null, latencyLimitMs: null,
  };

  return immutableClone({
    schema: 'DiagnosticWorkerViewV1',
    version: 1,
    revision: ownerSnapshot.revision,
    evaluatedAtMs: nowMs,
    projectionId: ownerSnapshot.projectionId,
    owner: ownerSnapshot.owner,
    dependencies: stableUnique(ownerSnapshot.dependencies ?? []),
    freshness: ownerSnapshot.freshness,
    sourceRealm: ownerSnapshot.sourceRealm,
    configRevision: ownerSnapshot.configRevision,
    schemaRevision: ownerSnapshot.schemaRevision,
    buildRevision: ownerSnapshot.buildRevision,
    lastErrorFingerprint: ownerSnapshot.lastErrorFingerprint,
    supportedControls: stableUnique(ownerSnapshot.supportedControls ?? []),
    capitalRelevance: ownerSnapshot.capitalRelevance,
    sourceState,
    wiringState,
    planeAvailability,
    assuranceStatus,
    operatingDisposition,
    productReadinessImpact: 'NONE',
    tradeReadinessImpact: 'NONE',
    executionAuthorityEffect: 'NONE',
    desiredState: ownerSnapshot.desiredState,
    observedLifecycle: ownerSnapshot.observedLifecycle,
    capability: notConfigured ? 'NOT_CONFIGURED' : ownerSnapshot.capability,
    heartbeatAtMs: ownerSnapshot.heartbeatAtMs,
    lastMeaningfulAdvanceAtMs: ownerSnapshot.lastMeaningfulAdvanceAtMs,
    queueDepth: ownerSnapshot.queueDepth,
    dropCount: ownerSnapshot.dropCount,
    restartGeneration: ownerSnapshot.restartGeneration,
    operatorAttentionRequired: assuranceStatus !== 'PASS' || planeAvailability !== 'AVAILABLE',
    provider: notConfigured ? {
      mode: 'NOT_CONFIGURED', providerId: null, modelId: null, modelVersion: null, posture: 'NOT_CONFIGURED', policyRevision: null,
    } : !providerDescriptorValid ? {
      mode: 'UNKNOWN', providerId: null, modelId: null, modelVersion: null, posture: 'UNKNOWN', policyRevision: null,
    } : {
      mode: provider.mode,
      providerId: provider.providerId,
      modelId: provider.modelId,
      modelVersion: provider.modelVersion,
      posture: provider.posture,
      policyRevision: provider.policyRevision,
    },
    workloadIdentity: {
      status: notConfigured ? 'UNKNOWN' : (workloadIdentityDecision?.status ?? 'UNKNOWN'),
      state: notConfigured ? 'NOT_CONFIGURED' : (workloadIdentityDecision?.identityState ?? 'UNKNOWN'),
      generation: notConfigured ? null : (workloadIdentityDecision?.generation ?? null),
      identityRef: notConfigured ? null : (workloadIdentityDecision?.identityRef ?? null),
      expiresAtMs: notConfigured ? null : (workloadIdentityDecision?.expiresAtMs ?? null),
      rotationDueAtMs: notConfigured ? null : (workloadIdentityDecision?.rotationDueAtMs ?? null),
    },
    sandbox: {
      status: notConfigured ? 'UNKNOWN' : (sandboxPassValid ? 'PASS' : (sandboxDecision?.status === 'FAIL' ? 'FAIL' : 'UNKNOWN')),
      disposition: notConfigured ? 'NOT_CONFIGURED' : (sandboxPassValid ? sandboxDecision.disposition : 'INVALID_OR_DENIED'),
      bindingId: notConfigured || !sandboxPassValid ? null : sandboxDecision.bindingId,
      permissionLevel: notConfigured || !sandboxPassValid ? null : sandboxDecision.permissionLevel,
      capabilities: notConfigured || !sandboxPassValid ? [] : stableUnique(sandboxDecision.capabilities),
      blockerCodes: notConfigured
        ? ['EXTERNAL_SANDBOX_NOT_CONFIGURED']
        : stableUnique([...(sandboxDecision?.reasonCodes ?? []), ...(!sandboxPassValid ? ['SANDBOX_DECISION_INVALID'] : [])]),
    },
    run: notConfigured ? {
      runId: null, incidentId: null, correlationId: null, deadlineAtMs: null, disposition: 'NOT_CONFIGURED',
      evidenceDigestCount: null, retrievalCount: null, redactionState: 'UNKNOWN', permissionLevel: null,
    } : {
      runId: run.runId,
      incidentId: run.incidentId,
      correlationId: run.correlationId,
      deadlineAtMs: run.deadlineAtMs,
      disposition: providerDecision?.status === 'PASS' && !providerPassValid ? 'EVIDENCE_INVALID' : (providerDecision?.disposition ?? 'NOT_RUN'),
      evidenceDigestCount: run.evidenceDigestCount,
      retrievalCount: run.retrievalCount,
      redactionState: run.redactionState,
      permissionLevel: run.permissionLevel,
    },
    budget: notConfigured ? nullBudget : run.budget,
    proposalAssurance: notConfigured ? {
      proposalId: null, approvalRef: null, approvalStatus: 'NOT_CONFIGURED', verifierId: null,
      verifierStatus: 'UNKNOWN', postconditionStatus: 'UNKNOWN', quietPeriodStatus: 'UNKNOWN',
    } : {
      proposalId: providerPassValid ? providerDecision.proposalId : null,
      approvalRef: promotionDecision?.approvalRef ?? null,
      approvalStatus: promotionDecision?.approvalStatus ?? 'UNKNOWN',
      verifierId: repairDecision?.verifierId ?? null,
      verifierStatus: repairDecision?.verifierStatus ?? 'UNKNOWN',
      postconditionStatus: repairDecision?.postconditionStatus ?? 'UNKNOWN',
      quietPeriodStatus: repairDecision?.quietPeriodStatus ?? 'UNKNOWN',
    },
    trace: {
      privacy: notConfigured ? decisionSummary(null, 'NOT_CONFIGURED') : decisionSummary(traceDecision),
      lastAppendSequence: notConfigured ? null : (traceDecision?.lastAppendSequence ?? null),
      lastChainDigest: notConfigured ? null : (traceDecision?.lastChainDigest ?? null),
      retentionOwnerId: notConfigured ? null : (traceDecision?.retentionOwnerId ?? null),
      independentEvidencePass,
    },
    selfCorrection: {
      declaredClass: notConfigured ? null : (promotionDecision?.declaredClass ?? null),
      derivedClass: notConfigured ? null : (promotionDecision?.derivedClass ?? null),
      effectiveClass: notConfigured ? null : (promotionDecision?.effectiveClass ?? null),
      promotion: notConfigured ? decisionSummary(null, 'NOT_CONFIGURED') : decisionSummary(promotionDecision),
      operationalActionAllowed: false,
    },
    repairEvidence: {
      evaluation: notConfigured ? decisionSummary(null, 'NOT_CONFIGURED') : decisionSummary(repairDecision),
      eligibleForCanonicalRecoveryReadback: notConfigured ? false : (repairDecision?.eligibleForCanonicalRecoveryReadback ?? false),
      postconditionStatus: notConfigured ? 'UNKNOWN' : (repairDecision?.postconditionStatus ?? 'UNKNOWN'),
      quietPeriodStatus: notConfigured ? 'UNKNOWN' : (repairDecision?.quietPeriodStatus ?? 'UNKNOWN'),
      verifierId: notConfigured ? null : (repairDecision?.verifierId ?? null),
      verifierStatus: notConfigured ? 'UNKNOWN' : (repairDecision?.verifierStatus ?? 'UNKNOWN'),
      recoveryDeclared: false,
    },
    corpusGovernance: notConfigured ? decisionSummary(null, 'NOT_CONFIGURED') : decisionSummary(corpusDecision),
    killControl: {
      controlId: killBindingValid ? killControl.controlId : DIAGNOSTIC_KILL_CONTROL_ID,
      desiredState: killBindingValid ? killControl.desiredState : 'UNKNOWN',
      effectiveState: killBindingValid ? killControl.effectiveState : 'UNKNOWN',
      blockingState: killBlockingState,
      wiringState: killBindingValid ? killControl.wiringState : DIAGNOSTIC_KILL_WIRING_STATE,
      pendingCommandId: killBindingValid ? killControl.pendingCommandId : DIAGNOSTIC_KILL_COMMAND_ID,
      selfReenableAllowed: false,
      retentionContinuesWhenEngaged: true,
    },
    providerEvaluation: notConfigured
      ? decisionSummary(null, 'NOT_CONFIGURED')
      : (!providerDescriptorValid || (providerDecision?.status === 'PASS' && !providerPassValid)
        ? Object.freeze({ status: 'FAIL', disposition: 'INVALID_ENVELOPE', reasonCodes: Object.freeze(['PROVIDER_DECISION_INVALID']) })
        : decisionSummary(providerDecision)),
    rootBlocker,
    reasonCodes,
    safeNextAction,
  });
}

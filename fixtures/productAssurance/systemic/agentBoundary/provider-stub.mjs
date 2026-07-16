import { assertUtcMillis, findForbiddenKeys, immutableClone, makeEvaluation, sha256Hex, stableUnique } from './canonical.mjs';
import {
  SAFE_DIAGNOSTIC_CAPABILITIES,
  decisionContractDigest,
  isEvaluationEnvelope,
  sandboxBoundaryDigest,
} from './evaluators.mjs';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_.:/-]{1,160}$/;
const OUTCOME_KEYS = Object.freeze([
  'bindingId', 'callOrdinal', 'policyRevision', 'providerId', 'requestDigest', 'requestId',
  'schema', 'status', 'typedOutput', 'version',
]);
const PROVIDER_KEYS = Object.freeze([
  'configurationState', 'mode', 'modelId', 'modelVersion', 'policyRevision', 'posture', 'providerId',
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
const OUTPUT_KEYS = Object.freeze([
  'actionKind', 'disposition', 'evidenceDigests', 'operationalAuthority', 'proposalId', 'schema', 'version',
]);
const DISPOSITIONS = new Set(['EXPLAIN_ONLY', 'PROPOSE_TYPED_ACTION', 'NO_ACTION']);
const ACTION_KINDS = new Set(['READ_ONLY_TRIAGE', 'ISOLATED_REPLAY', 'ISOLATED_PATCH_PROPOSAL', 'NO_ACTION']);
const DISPOSITION_ACTION_KINDS = Object.freeze({
  EXPLAIN_ONLY: new Set(['READ_ONLY_TRIAGE']),
  PROPOSE_TYPED_ACTION: new Set(['ISOLATED_REPLAY', 'ISOLATED_PATCH_PROPOSAL']),
  NO_ACTION: new Set(['NO_ACTION']),
});
const PROVIDER_POSTURES = new Set(['AVAILABLE', 'OUTAGE', 'COST_EXHAUSTED']);
const SAFE_CAPABILITY_SET = new Set(SAFE_DIAGNOSTIC_CAPABILITIES);
const PERMISSION_LEVELS = new Set([
  'OBSERVE_EXPLAIN', 'BOUNDED_QUERY_REPLAY', 'PROPOSE_TYPED_ACTION',
  'PATCH_ISOLATED_AND_TEST', 'OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY',
]);
const MAX_DETERMINISTIC_STUB_CALLS = 1;

function hasExactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function safeEvidenceRefs(value) {
  if (!Array.isArray(value)) return [];
  return stableUnique(value.filter((entry) => typeof entry === 'string' && HASH.test(entry)));
}

export function isValidTypedProviderStubOutput(output) {
  return hasExactKeys(output, OUTPUT_KEYS)
    && output.schema === 'TypedRemediationProposalStubV1'
    && output.version === 1
    && ID.test(output.proposalId ?? '')
    && DISPOSITIONS.has(output.disposition)
    && ACTION_KINDS.has(output.actionKind)
    && DISPOSITION_ACTION_KINDS[output.disposition]?.has(output.actionKind)
    && output.operationalAuthority === 'NONE'
    && Array.isArray(output.evidenceDigests)
    && output.evidenceDigests.length > 0
    && output.evidenceDigests.length <= 128
    && new Set(output.evidenceDigests).size === output.evidenceDigests.length
    && output.evidenceDigests.every((digest) => HASH.test(digest))
    && findForbiddenKeys(output).length === 0;
}

export function isDeterministicProviderStubDescriptor(provider) {
  return hasExactKeys(provider, PROVIDER_KEYS)
    && findForbiddenKeys(provider).length === 0
    && provider.configurationState === 'SYNTHETIC_ONLY'
    && provider.mode === 'DETERMINISTIC_STUB'
    && PROVIDER_POSTURES.has(provider.posture)
    && ID.test(provider.providerId ?? '')
    && ID.test(provider.modelId ?? '')
    && ID.test(provider.modelVersion ?? '')
    && ID.test(provider.policyRevision ?? '');
}

export function providerStubDecisionDigest(decision) {
  return sha256Hex({
    schema: decision?.schema ?? null,
    version: decision?.version ?? null,
    status: decision?.status ?? null,
    disposition: decision?.disposition ?? null,
    allowed: decision?.allowed ?? null,
    productReadinessImpact: decision?.productReadinessImpact ?? null,
    evaluatedAtMs: decision?.evaluatedAtMs ?? null,
    reasonCodes: stableUnique(decision?.reasonCodes ?? []),
    evidenceRefs: stableUnique(decision?.evidenceRefs ?? []),
    invocationKind: decision?.invocationKind ?? null,
    externalCallAttempted: decision?.externalCallAttempted ?? null,
    toolExecuted: decision?.toolExecuted ?? null,
    operationalAuthorityEffect: decision?.operationalAuthorityEffect ?? null,
    decisionKind: decision?.decisionKind ?? null,
    sourceEvidenceDigest: decision?.sourceEvidenceDigest ?? null,
    sandboxDecisionDigest: decision?.sandboxDecisionDigest ?? null,
    bindingId: decision?.bindingId ?? null,
    boundaryDigest: decision?.boundaryDigest ?? null,
    requestId: decision?.requestId ?? null,
    requestDigest: decision?.requestDigest ?? null,
    providerId: decision?.providerId ?? null,
    modelId: decision?.modelId ?? null,
    modelVersion: decision?.modelVersion ?? null,
    policyRevision: decision?.policyRevision ?? null,
    proposalId: decision?.proposalId ?? null,
    typedOutput: decision?.typedOutput ?? null,
    outputDigest: decision?.outputDigest ?? null,
  });
}

function decisionFailure(nowMs, disposition, reasonCodes, base, evidenceRefs = []) {
  return makeEvaluation({ status: 'FAIL', disposition, evaluatedAtMs: nowMs, reasonCodes, evidenceRefs, extra: base });
}

/**
 * A deterministic fixture boundary. It contains no transport, provider SDK,
 * environment read, credential acquisition, process spawn, or tool execution.
 */
export function runDeterministicProviderStub({
  provider,
  requestDigest,
  boundaryDecision,
  identityDecision,
  traceDecision,
  scriptedOutcome,
  nowMs,
}) {
  assertUtcMillis(nowMs);
  const base = {
    invocationKind: 'DETERMINISTIC_STUB',
    externalCallAttempted: false,
    toolExecuted: false,
    operationalAuthorityEffect: 'NONE',
    productReadinessImpact: 'NONE',
  };
  if (provider?.configurationState === 'NOT_CONFIGURED') {
    const completeAbsence = hasExactKeys(provider, PROVIDER_KEYS)
      && provider.mode === 'NOT_CONFIGURED'
      && provider.posture === 'NOT_CONFIGURED'
      && provider.providerId === null
      && provider.modelId === null
      && provider.modelVersion === null
      && provider.policyRevision === null;
    if (!completeAbsence) {
      return decisionFailure(nowMs, 'STUB_NOT_INVOKED', ['PROVIDER_NOT_CONFIGURED_FACTS_INVALID'], base);
    }
    return makeEvaluation({
      status: 'UNKNOWN',
      disposition: 'DIAGNOSTIC_PLANE_UNAVAILABLE',
      evaluatedAtMs: nowMs,
      reasonCodes: ['PROVIDER_NOT_CONFIGURED'],
      extra: base,
    });
  }

  const boundaryDigest = sandboxBoundaryDigest(boundaryDecision);
  const boundaryValid = hasExactKeys(boundaryDecision, SANDBOX_PASS_KEYS)
    && findForbiddenKeys(boundaryDecision).length === 0
    && boundaryDecision?.schema === 'AgentBoundaryEvaluationV1'
    && boundaryDecision?.version === 1
    && boundaryDecision?.decisionKind === 'SANDBOX_BINDING'
    && boundaryDecision?.status === 'PASS'
    && boundaryDecision?.disposition === 'ALLOW_DETERMINISTIC_STUB'
    && boundaryDecision?.allowed === true
    && boundaryDecision?.stubEligible === true
    && boundaryDecision?.productReadinessImpact === 'NONE'
    && boundaryDecision?.providerInvocationMode === 'DETERMINISTIC_STUB_ONLY'
    && boundaryDecision?.operationalAuthorityEffect === 'NONE'
    && Array.isArray(boundaryDecision?.reasonCodes)
    && boundaryDecision.reasonCodes.length === 0
    && Array.isArray(boundaryDecision?.forbiddenFieldPaths)
    && boundaryDecision.forbiddenFieldPaths.length === 0
    && Array.isArray(boundaryDecision?.evidenceRefs)
    && boundaryDecision.evidenceRefs.length > 0
    && boundaryDecision.evidenceRefs.every((digest) => HASH.test(digest))
    && new Set(boundaryDecision.evidenceRefs).size === boundaryDecision.evidenceRefs.length
    && Number.isSafeInteger(boundaryDecision?.evaluatedAtMs)
    && boundaryDecision.evaluatedAtMs >= 1_262_304_000_000
    && boundaryDecision.evaluatedAtMs <= nowMs
    && ID.test(boundaryDecision?.providerId ?? '')
    && ID.test(boundaryDecision?.modelId ?? '')
    && ID.test(boundaryDecision?.modelVersion ?? '')
    && ID.test(boundaryDecision?.policyRevision ?? '')
    && ID.test(boundaryDecision?.bindingId ?? '')
    && ID.test(boundaryDecision?.requestId ?? '')
    && ID.test(boundaryDecision?.identityRef ?? '')
    && ID.test(boundaryDecision?.workloadAudience ?? '')
    && ID.test(boundaryDecision?.environment ?? '')
    && PERMISSION_LEVELS.has(boundaryDecision?.permissionLevel)
    && HASH.test(boundaryDecision?.requestDigest ?? '')
    && HASH.test(boundaryDecision?.identityDecisionDigest ?? '')
    && HASH.test(boundaryDecision?.traceDecisionDigest ?? '')
    && HASH.test(boundaryDecision?.workloadCapabilityDigest ?? '')
    && HASH.test(boundaryDecision?.workloadSubjectDigest ?? '')
    && HASH.test(boundaryDecision?.sourceEvidenceDigest ?? '')
    && HASH.test(boundaryDecision?.boundaryDigest ?? '')
    && boundaryDecision.boundaryDigest === boundaryDigest
    && HASH.test(boundaryDecision?.decisionDigest ?? '')
    && boundaryDecision.decisionDigest === decisionContractDigest(boundaryDecision)
    && boundaryDecision?.requestDigest === requestDigest
    && identityDecision?.status === 'PASS'
    && traceDecision?.status === 'PASS'
    && isEvaluationEnvelope(identityDecision, nowMs, 'WORKLOAD_IDENTITY')
    && isEvaluationEnvelope(traceDecision, nowMs, 'TRACE_PRIVACY_RETENTION')
    && boundaryDecision.identityDecisionDigest === identityDecision?.decisionDigest
    && boundaryDecision.traceDecisionDigest === traceDecision?.decisionDigest
    && boundaryDecision.providerId === identityDecision?.providerId
    && boundaryDecision.bindingId === identityDecision?.bindingId
    && boundaryDecision.identityRef === identityDecision?.identityRef
    && boundaryDecision.workloadAudience === identityDecision?.audience
    && boundaryDecision.workloadSubjectDigest === identityDecision?.subjectDigest
    && boundaryDecision.workloadCapabilityDigest === identityDecision?.capabilityDigest
    && boundaryDecision.environment === identityDecision?.environment
    && Number.isSafeInteger(boundaryDecision?.expiresAtMs)
    && nowMs < boundaryDecision.expiresAtMs
    && Number.isSafeInteger(boundaryDecision?.maxCalls)
    && boundaryDecision.maxCalls >= 1
    && boundaryDecision.maxCalls <= MAX_DETERMINISTIC_STUB_CALLS
    && Array.isArray(boundaryDecision?.capabilities)
    && boundaryDecision.capabilities.length > 0
    && boundaryDecision.capabilities.every((capability) => SAFE_CAPABILITY_SET.has(capability))
    && boundaryDecision.capabilities.length === new Set(boundaryDecision.capabilities).size
    && Array.isArray(boundaryDecision?.toolIds)
    && boundaryDecision.toolIds.length > 0
    && boundaryDecision.toolIds.length === new Set(boundaryDecision.toolIds).size
    && boundaryDecision.toolIds.every((toolId) => ID.test(toolId) && toolId.startsWith('fixture.'));
  if (!boundaryValid) {
    return decisionFailure(nowMs, 'STUB_NOT_INVOKED', ['SANDBOX_BINDING_DID_NOT_ALLOW_STUB'], base, safeEvidenceRefs(boundaryDecision?.evidenceRefs));
  }
  if (!hasExactKeys(provider, PROVIDER_KEYS)) {
    return decisionFailure(nowMs, 'STUB_NOT_INVOKED', ['PROVIDER_DESCRIPTOR_SCHEMA_REJECTED'], base);
  }
  if (!isDeterministicProviderStubDescriptor(provider)) {
    return decisionFailure(nowMs, 'STUB_NOT_INVOKED', ['NON_STUB_PROVIDER_MODE_FORBIDDEN'], base);
  }
  if (provider.providerId !== boundaryDecision.providerId
    || provider.modelId !== boundaryDecision.modelId
    || provider.modelVersion !== boundaryDecision.modelVersion
    || provider.policyRevision !== boundaryDecision.policyRevision) {
    return decisionFailure(nowMs, 'STUB_NOT_INVOKED', ['PROVIDER_BOUNDARY_BINDING_MISMATCH'], base);
  }
  if (provider.posture === 'OUTAGE') {
    return makeEvaluation({ status: 'UNKNOWN', disposition: 'DIAGNOSTIC_PLANE_UNAVAILABLE', evaluatedAtMs: nowMs, reasonCodes: ['STUBBED_PROVIDER_OUTAGE'], extra: base });
  }
  if (provider.posture === 'COST_EXHAUSTED') {
    return makeEvaluation({ status: 'UNKNOWN', disposition: 'DIAGNOSTIC_BUDGET_EXHAUSTED', evaluatedAtMs: nowMs, reasonCodes: ['STUBBED_COST_BUDGET_EXHAUSTED'], extra: base });
  }
  if (provider.posture !== 'AVAILABLE') {
    return makeEvaluation({ status: 'UNKNOWN', disposition: 'DIAGNOSTIC_PLANE_UNAVAILABLE', evaluatedAtMs: nowMs, reasonCodes: ['STUBBED_PROVIDER_POSTURE_UNKNOWN'], extra: base });
  }
  if (!HASH.test(requestDigest ?? '') || boundaryDecision.requestDigest !== requestDigest) {
    return decisionFailure(nowMs, 'STUB_SCRIPT_MISMATCH', ['STUB_REQUEST_DIGEST_MISMATCH'], base);
  }

  const outcomeBound = hasExactKeys(scriptedOutcome, OUTCOME_KEYS)
    && scriptedOutcome.schema === 'DeterministicProviderStubOutcomeV1'
    && scriptedOutcome.version === 1
    && scriptedOutcome.status === 'TYPED_RESPONSE'
    && scriptedOutcome.requestDigest === requestDigest
    && scriptedOutcome.bindingId === boundaryDecision.bindingId
    && scriptedOutcome.requestId === boundaryDecision.requestId
    && scriptedOutcome.providerId === provider.providerId
    && scriptedOutcome.policyRevision === provider.policyRevision
    && Number.isSafeInteger(scriptedOutcome.callOrdinal)
    && scriptedOutcome.callOrdinal >= 1
    && scriptedOutcome.callOrdinal <= boundaryDecision.maxCalls;
  if (!outcomeBound) {
    return decisionFailure(nowMs, 'STUB_SCRIPT_MISMATCH', ['STUB_OUTCOME_BINDING_MISMATCH'], base);
  }
  if (!isValidTypedProviderStubOutput(scriptedOutcome.typedOutput)) {
    return decisionFailure(nowMs, 'STUB_RESPONSE_REJECTED', ['STUB_TYPED_OUTPUT_SCHEMA_REJECTED'], base);
  }
  if (!scriptedOutcome.typedOutput.evidenceDigests.every((digest) => boundaryDecision.evidenceRefs.includes(digest))) {
    return decisionFailure(nowMs, 'STUB_RESPONSE_REJECTED', ['STUB_OUTPUT_EVIDENCE_NOT_BOUND_TO_SANDBOX'], base);
  }

  const typedOutput = immutableClone(scriptedOutcome.typedOutput);
  const outputDigest = sha256Hex(typedOutput);
  const sourceEvidenceDigest = sha256Hex({
    boundaryDigest: boundaryDecision.boundaryDigest,
    sandboxDecisionDigest: boundaryDecision.decisionDigest,
    requestDigest,
    providerId: provider.providerId,
    modelId: provider.modelId,
    modelVersion: provider.modelVersion,
    policyRevision: provider.policyRevision,
    scriptedOutcome,
  });
  const extra = {
    ...base,
    decisionKind: 'PROVIDER_STUB_RESULT',
    sourceEvidenceDigest,
    sandboxDecisionDigest: boundaryDecision.decisionDigest,
    bindingId: boundaryDecision.bindingId,
    boundaryDigest: boundaryDecision.boundaryDigest,
    requestId: boundaryDecision.requestId,
    requestDigest,
    providerId: provider.providerId,
    modelId: provider.modelId,
    modelVersion: provider.modelVersion,
    policyRevision: provider.policyRevision,
    proposalId: typedOutput.proposalId,
    typedOutput,
    outputDigest,
  };
  const normalizedDecision = {
    schema: 'AgentBoundaryEvaluationV1',
    version: 1,
    status: 'PASS',
    disposition: 'STUBBED_TYPED_RESPONSE',
    allowed: false,
    productReadinessImpact: 'NONE',
    evaluatedAtMs: nowMs,
    reasonCodes: [],
    evidenceRefs: stableUnique([requestDigest, outputDigest]),
    ...extra,
  };
  return makeEvaluation({
    status: 'PASS',
    disposition: 'STUBBED_TYPED_RESPONSE',
    evaluatedAtMs: nowMs,
    evidenceRefs: [requestDigest, outputDigest],
    allowed: false,
    extra: { ...extra, decisionDigest: providerStubDecisionDigest(normalizedDecision) },
  });
}

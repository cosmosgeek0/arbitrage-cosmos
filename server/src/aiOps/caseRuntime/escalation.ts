import {
  evaluateDiagnosticProposal,
  type DiagnosticBoundaryDecision,
  type DiagnosticEvaluationContext,
  type TypedDiagnosticProposal,
} from '../../productAssurance/diagnostics/boundary.js';
import type { ShadowCaseSnapshot, ShadowSignature } from './types.js';
import { SHADOW_A2_STATUS } from './types.js';
import { serializeCaseSnapshot } from './caseState.js';
import type { ShadowSyntheticSignerPort } from './context.js';
import { assertDiagnosticResultIntegrity, type ShadowDiagnosticResult } from './diagnostic.js';
import {
  assertClosedKeys,
  assertDigest,
  assertIdentifier,
  assertSafeNonNegative,
  assertUtc,
  boundedSortedIdentifiers,
  digestValue,
  shadowSpeculativeId,
  snapshotInertJson,
} from './support.js';

export type ShadowEscalationReadiness = 'READY_FOR_OWNER_HANDOFF' | 'BLOCKED';

const MAX_ESCALATION_OWNER_BINDING_TTL_MS = 24 * 60 * 60 * 1_000;

export interface ShadowEscalationIncidentOwnerBinding {
  readonly schema: 'AI_OPS_A2_ESCALATION_INCIDENT_OWNER_BINDING_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly posture: 'SYNTHETIC_ONLY';
  readonly caseId: string;
  readonly generation: number;
  readonly diagnosticDigest: string;
  readonly evidenceBundleDigest: string;
  readonly policyRevision: string;
  readonly incidentId: string;
  readonly targetOwnerId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly bindingDigest: string;
  readonly signature: Readonly<ShadowSignature>;
}

export interface ShadowEscalationIntentInput {
  readonly caseSnapshot: Readonly<ShadowCaseSnapshot>;
  readonly diagnosticResult: Readonly<ShadowDiagnosticResult>;
  readonly proposal: Readonly<TypedDiagnosticProposal>;
  readonly evaluationContext: Readonly<DiagnosticEvaluationContext>;
  readonly incidentOwnerBinding: Readonly<ShadowEscalationIncidentOwnerBinding>;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

/**
 * A case-local readiness record only. It does not notify an owner, advance the
 * case journal, enqueue work, or grant the proposal any operational authority.
 */
export interface ShadowEscalationIntent {
  readonly schema: 'AI_OPS_A2_ESCALATION_INTENT_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly escalationIntentId: string;
  readonly escalationIntentDigest: string;
  readonly caseId: string;
  readonly caseGeneration: number;
  readonly caseRevision: number;
  readonly caseState: ShadowCaseSnapshot['state'];
  readonly caseSnapshotDigest: string;
  readonly caseDiagnosticBindingDigest: string | null;
  readonly diagnosisId: string;
  readonly diagnosticDigest: string;
  readonly evidenceBundleDigest: string;
  readonly diagnosticEscalationReasonCode: string | null;
  readonly proposalId: string;
  readonly incidentId: string;
  readonly proposalDigest: string;
  readonly evaluationContextDigest: string;
  readonly boundaryDecision: Readonly<DiagnosticBoundaryDecision>;
  readonly boundaryDecisionDigest: string;
  readonly incidentOwnerBinding: Readonly<ShadowEscalationIncidentOwnerBinding>;
  readonly targetOwnerId: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly readiness: ShadowEscalationReadiness;
  readonly reasonCodes: readonly string[];
  readonly deliveryState: 'NOT_ATTEMPTED';
  readonly authorityGranted: false;
  readonly operationalAuthority: 'NONE';
}

function validateSyntheticVerifier(verifier: Readonly<ShadowSyntheticSignerPort>): void {
  assertClosedKeys(verifier, ['posture', 'signDigest', 'verifyDigest'], 'escalation synthetic verifier');
  if (verifier.posture !== 'SYNTHETIC_ONLY') throw new TypeError('escalation verifier must remain synthetic-only');
  if (typeof verifier.signDigest !== 'function' || typeof verifier.verifyDigest !== 'function') {
    throw new TypeError('escalation verifier methods unavailable');
  }
}

function validateSyntheticSignature(signature: Readonly<ShadowSignature>): void {
  assertClosedKeys(signature, ['posture', 'algorithm', 'keyId', 'signature'], 'escalation owner binding signature');
  if (signature.posture !== 'SYNTHETIC_ONLY') throw new TypeError('escalation owner binding signature posture invalid');
  assertIdentifier(signature.algorithm, 'escalation owner binding signature.algorithm');
  assertIdentifier(signature.keyId, 'escalation owner binding signature.keyId');
  if (typeof signature.signature !== 'string' || !/^[A-Za-z0-9_-]{16,512}$/u.test(signature.signature)) {
    throw new TypeError('escalation owner binding signature bytes malformed');
  }
}

function escalationOwnerBindingPayload(binding: Readonly<ShadowEscalationIncidentOwnerBinding>): object {
  const { bindingDigest: _bindingDigest, signature: _signature, ...payload } = binding;
  return payload;
}

function validateEscalationOwnerBinding(
  binding: Readonly<ShadowEscalationIncidentOwnerBinding>,
  atMs: number,
  verifier: Readonly<ShadowSyntheticSignerPort>,
): void {
  validateSyntheticVerifier(verifier);
  assertClosedKeys(binding, [
    'schema', 'shadowStatus', 'posture', 'caseId', 'generation', 'diagnosticDigest',
    'evidenceBundleDigest', 'policyRevision', 'incidentId', 'targetOwnerId', 'issuedAtMs', 'expiresAtMs',
    'bindingDigest', 'signature',
  ], 'escalation incident-owner binding');
  if (
    binding.schema !== 'AI_OPS_A2_ESCALATION_INCIDENT_OWNER_BINDING_V1'
    || binding.shadowStatus !== SHADOW_A2_STATUS
    || binding.posture !== 'SYNTHETIC_ONLY'
  ) throw new TypeError('escalation incident-owner binding schema, status, or posture invalid');
  assertIdentifier(binding.caseId, 'escalationOwnerBinding.caseId');
  assertSafeNonNegative(binding.generation, 'escalationOwnerBinding.generation');
  assertDigest(binding.diagnosticDigest, 'escalationOwnerBinding.diagnosticDigest');
  assertDigest(binding.evidenceBundleDigest, 'escalationOwnerBinding.evidenceBundleDigest');
  assertIdentifier(binding.policyRevision, 'escalationOwnerBinding.policyRevision');
  assertIdentifier(binding.incidentId, 'escalationOwnerBinding.incidentId');
  assertIdentifier(binding.targetOwnerId, 'escalationOwnerBinding.targetOwnerId');
  assertUtc(binding.issuedAtMs, 'escalationOwnerBinding.issuedAtMs');
  assertUtc(binding.expiresAtMs, 'escalationOwnerBinding.expiresAtMs');
  if (
    binding.expiresAtMs <= binding.issuedAtMs
    || binding.expiresAtMs - binding.issuedAtMs > MAX_ESCALATION_OWNER_BINDING_TTL_MS
  ) throw new TypeError('escalation incident-owner binding expiry invalid');
  if (atMs < binding.issuedAtMs || atMs >= binding.expiresAtMs) {
    throw new TypeError('escalation incident-owner binding is not current');
  }
  assertDigest(binding.bindingDigest, 'escalationOwnerBinding.bindingDigest');
  validateSyntheticSignature(binding.signature);
  if (binding.bindingDigest !== digestValue(escalationOwnerBindingPayload(binding))) {
    throw new TypeError('escalation incident-owner binding digest mismatch');
  }
  if (verifier.verifyDigest(binding.bindingDigest, binding.signature) !== true) {
    throw new TypeError('escalation incident-owner binding signature invalid');
  }
}

function assertProductAssuranceInputClosed(
  proposal: Readonly<TypedDiagnosticProposal>,
  context: Readonly<DiagnosticEvaluationContext>,
): void {
  assertClosedKeys(proposal, [
    'schema', 'proposalId', 'proposalKind', 'requestedPermission', 'requestedCapabilities',
    'evidenceBundleDigest', 'proposedArtifactDigest', 'incidentId', 'registeredActionId', 'providerId',
    'modelId', 'policyRevision', 'createdAtMs', 'expiresAtMs', 'tokenBudget', 'costBudgetMicrounits',
    'approval',
  ], 'shadow escalation Product Assurance proposal');
  if (proposal.approval !== null) {
    assertClosedKeys(proposal.approval, [
      'approvalId', 'artifactDigest', 'actionId', 'environmentId', 'policyRevision', 'capability',
      'maximumEffect', 'expiresAtMs', 'rollbackId', 'approverId',
    ], 'shadow escalation Product Assurance approval');
  }
  assertClosedKeys(context, [
    'nowMs', 'providerState', 'maximumTokenBudget', 'maximumCostBudgetMicrounits', 'allowedPermission',
    'environmentId', 'approvedMaximumEffect', 'requiredRollbackId', 'authorizedApproverIds',
    'externalSandbox', 'tracePrivacy', 'independentRetention',
  ], 'shadow escalation Product Assurance context');
  assertClosedKeys(context.externalSandbox, [
    'schema', 'sandboxId', 'providerId', 'defaultPolicy', 'allowedCapabilities', 'arbitraryShellAccess',
    'arbitraryNetworkAccess', 'secretAccess', 'mainWorkspaceWriteAccess', 'productionPersistenceWriteAccess',
  ], 'shadow escalation Product Assurance sandbox');
  assertClosedKeys(context.tracePrivacy, [
    'schema', 'traceId', 'evidenceBundleDigest', 'policyRevision', 'redactionApplied',
    'instructionDataBoundaryApplied', 'rawEvidenceStoredOutsidePrompt', 'secretMaterialPresentInPrompt',
  ], 'shadow escalation Product Assurance trace privacy');
  assertClosedKeys(context.independentRetention, [
    'schema', 'retentionId', 'retentionPolicyId', 'ownerId', 'evidenceBundleDigest',
    'independentFromProvider', 'providerWriteAccess', 'providerDeleteAccess',
  ], 'shadow escalation Product Assurance retention');
}

function assertBoundaryDecision(decision: Readonly<DiagnosticBoundaryDecision>): void {
  assertClosedKeys(decision, [
    'verdict', 'allowed', 'authorityGranted', 'providerState', 'reasonCodes',
  ], 'escalation boundary decision');
  if (!(['PASS', 'FAIL', 'UNKNOWN'] as const).includes(decision.verdict)) {
    throw new TypeError('escalation boundary verdict invalid');
  }
  if (typeof decision.allowed !== 'boolean') throw new TypeError('escalation boundary allowed flag invalid');
  if (decision.authorityGranted !== false) throw new TypeError('escalation boundary cannot grant authority');
  if (!(['READY', 'NOT_CONFIGURED', 'UNAVAILABLE', 'BUDGET_EXHAUSTED'] as const).includes(decision.providerState)) {
    throw new TypeError('escalation boundary provider state invalid');
  }
  const reasonCodes = boundedSortedIdentifiers(decision.reasonCodes, 'escalation boundary reason codes', 128);
  if (digestValue(reasonCodes) !== digestValue(decision.reasonCodes)) {
    throw new TypeError('escalation boundary reason codes are not canonical');
  }
  if (decision.allowed !== (decision.verdict === 'PASS' && decision.reasonCodes.length === 0)) {
    throw new TypeError('escalation boundary allowed flag contradicts its verdict');
  }
}

export function assertShadowEscalationIntentIntegrity(
  intent: Readonly<ShadowEscalationIntent>,
  verifier: Readonly<ShadowSyntheticSignerPort>,
): void {
  assertClosedKeys(intent, [
    'schema', 'shadowStatus', 'escalationIntentId', 'escalationIntentDigest', 'caseId', 'caseGeneration',
    'caseRevision', 'caseState', 'caseSnapshotDigest', 'caseDiagnosticBindingDigest', 'diagnosisId',
    'diagnosticDigest', 'evidenceBundleDigest', 'diagnosticEscalationReasonCode', 'proposalId', 'incidentId',
    'proposalDigest', 'evaluationContextDigest', 'boundaryDecision', 'boundaryDecisionDigest',
    'incidentOwnerBinding', 'targetOwnerId', 'createdAtMs', 'expiresAtMs', 'readiness', 'reasonCodes',
    'deliveryState', 'authorityGranted', 'operationalAuthority',
  ], 'shadow escalation intent');
  if (intent.schema !== 'AI_OPS_A2_ESCALATION_INTENT_V1' || intent.shadowStatus !== SHADOW_A2_STATUS) {
    throw new TypeError('shadow escalation intent schema or status invalid');
  }
  assertIdentifier(intent.escalationIntentId, 'intent.escalationIntentId');
  assertDigest(intent.escalationIntentDigest, 'intent.escalationIntentDigest');
  assertIdentifier(intent.caseId, 'intent.caseId');
  assertSafeNonNegative(intent.caseGeneration, 'intent.caseGeneration');
  assertSafeNonNegative(intent.caseRevision, 'intent.caseRevision');
  assertDigest(intent.caseSnapshotDigest, 'intent.caseSnapshotDigest');
  if (intent.caseDiagnosticBindingDigest !== null) {
    assertDigest(intent.caseDiagnosticBindingDigest, 'intent.caseDiagnosticBindingDigest');
  }
  assertIdentifier(intent.diagnosisId, 'intent.diagnosisId');
  assertDigest(intent.diagnosticDigest, 'intent.diagnosticDigest');
  assertDigest(intent.evidenceBundleDigest, 'intent.evidenceBundleDigest');
  if (intent.diagnosticEscalationReasonCode !== null) {
    assertIdentifier(intent.diagnosticEscalationReasonCode, 'intent.diagnosticEscalationReasonCode');
  }
  assertIdentifier(intent.proposalId, 'intent.proposalId');
  assertIdentifier(intent.incidentId, 'intent.incidentId');
  assertDigest(intent.proposalDigest, 'intent.proposalDigest');
  assertDigest(intent.evaluationContextDigest, 'intent.evaluationContextDigest');
  assertBoundaryDecision(intent.boundaryDecision);
  assertDigest(intent.boundaryDecisionDigest, 'intent.boundaryDecisionDigest');
  if (digestValue(intent.boundaryDecision) !== intent.boundaryDecisionDigest) {
    throw new TypeError('shadow escalation boundary decision digest mismatch');
  }
  validateEscalationOwnerBinding(intent.incidentOwnerBinding, intent.createdAtMs, verifier);
  if (
    intent.incidentId !== intent.incidentOwnerBinding.incidentId
    || intent.targetOwnerId !== intent.incidentOwnerBinding.targetOwnerId
  ) throw new TypeError('shadow escalation incident-owner output binding mismatch');
  assertIdentifier(intent.targetOwnerId, 'intent.targetOwnerId');
  assertUtc(intent.createdAtMs, 'intent.createdAtMs');
  assertUtc(intent.expiresAtMs, 'intent.expiresAtMs');
  if (intent.expiresAtMs <= intent.createdAtMs) throw new TypeError('shadow escalation intent expiry invalid');
  if (!(['READY_FOR_OWNER_HANDOFF', 'BLOCKED'] as const).includes(intent.readiness)) {
    throw new TypeError('shadow escalation readiness invalid');
  }
  const reasonCodes = boundedSortedIdentifiers(intent.reasonCodes, 'shadow escalation reason codes', 128);
  if (digestValue(reasonCodes) !== digestValue(intent.reasonCodes)) {
    throw new TypeError('shadow escalation reason codes are not canonical');
  }
  if (intent.deliveryState !== 'NOT_ATTEMPTED') throw new TypeError('shadow escalation cannot claim delivery');
  if (intent.authorityGranted !== false || intent.operationalAuthority !== 'NONE') {
    throw new TypeError('shadow escalation cannot carry operational authority');
  }
  if (intent.readiness === 'READY_FOR_OWNER_HANDOFF') {
    if (!intent.boundaryDecision.allowed
      || intent.caseState !== 'OWNER_ATTENTION_REQUIRED'
      || intent.caseDiagnosticBindingDigest !== digestValue({
        diagnosticResultDigest: intent.diagnosticDigest,
        evidenceBundleDigest: intent.evidenceBundleDigest,
      })
      || intent.incidentOwnerBinding.caseId !== intent.caseId
      || intent.incidentOwnerBinding.generation !== intent.caseGeneration
      || intent.incidentOwnerBinding.diagnosticDigest !== intent.diagnosticDigest
      || intent.incidentOwnerBinding.evidenceBundleDigest !== intent.evidenceBundleDigest
      || intent.diagnosticEscalationReasonCode === null
      || digestValue(intent.reasonCodes) !== digestValue(['OWNER_HANDOFF_READY_SHADOW_ONLY'])) {
      throw new TypeError('shadow escalation readiness is not supported by its bound facts');
    }
  } else if (intent.reasonCodes.length === 0) {
    throw new TypeError('blocked shadow escalation requires reason codes');
  }
  const { escalationIntentId: _intentId, escalationIntentDigest: _intentDigest, ...core } = intent;
  if (digestValue(core) !== intent.escalationIntentDigest) {
    throw new TypeError('shadow escalation intent digest mismatch');
  }
  const expectedId = shadowSpeculativeId('a2-escalation-intent', {
    caseId: intent.caseId,
    caseGeneration: intent.caseGeneration,
    caseRevision: intent.caseRevision,
    escalationIntentDigest: intent.escalationIntentDigest,
  });
  if (intent.escalationIntentId !== expectedId) throw new TypeError('shadow escalation intent ID mismatch');
}

export function createShadowEscalationIntent(
  rawInput: Readonly<ShadowEscalationIntentInput>,
  verifier: Readonly<ShadowSyntheticSignerPort>,
): Readonly<ShadowEscalationIntent> {
  const input = snapshotInertJson(rawInput, 'shadow escalation input') as Readonly<ShadowEscalationIntentInput>;
  assertClosedKeys(input, [
    'caseSnapshot', 'diagnosticResult', 'proposal', 'evaluationContext', 'incidentOwnerBinding',
    'createdAtMs', 'expiresAtMs',
  ], 'shadow escalation input');
  const snapshot = input.caseSnapshot;
  const diagnostic = input.diagnosticResult;
  const proposal = input.proposal;
  const context = input.evaluationContext;
  serializeCaseSnapshot(snapshot);
  assertDiagnosticResultIntegrity(diagnostic);
  assertProductAssuranceInputClosed(proposal, context);
  assertUtc(input.createdAtMs, 'input.createdAtMs');
  assertUtc(input.expiresAtMs, 'input.expiresAtMs');
  validateEscalationOwnerBinding(input.incidentOwnerBinding, input.createdAtMs, verifier);
  if (context.nowMs !== input.createdAtMs) {
    throw new TypeError('shadow escalation creation time must equal Product Assurance evaluation time');
  }
  if (input.createdAtMs < snapshot.updatedAtMs || input.createdAtMs < diagnostic.createdAtMs) {
    throw new TypeError('shadow escalation cannot predate its case or diagnostic');
  }
  if (input.expiresAtMs <= input.createdAtMs) throw new TypeError('shadow escalation intent expiry invalid');
  const ownerApprovalExpiry = proposal.approval?.expiresAtMs ?? Number.MAX_SAFE_INTEGER;
  if (input.expiresAtMs > Math.min(
    diagnostic.expiresAtMs,
    proposal.expiresAtMs,
    ownerApprovalExpiry,
    input.incidentOwnerBinding.expiresAtMs,
  )) {
    throw new TypeError('shadow escalation intent outlives its diagnostic, proposal, approval, or incident-owner binding');
  }
  if (input.incidentOwnerBinding.issuedAtMs < diagnostic.createdAtMs) {
    throw new TypeError('shadow escalation incident-owner binding predates its diagnostic');
  }
  if (proposal.proposalKind !== 'REQUEST_OWNER_HANDOFF') {
    throw new TypeError('shadow escalation requires a REQUEST_OWNER_HANDOFF proposal');
  }
  if (proposal.requestedCapabilities.length > 64) {
    throw new TypeError('shadow escalation proposal capability bound exceeded');
  }

  const boundaryDecision = evaluateDiagnosticProposal(proposal, context);
  assertBoundaryDecision(boundaryDecision);
  const localBlockers: string[] = [];
  if (snapshot.caseId !== diagnostic.caseId) localBlockers.push('CASE_DIAGNOSTIC_CASE_MISMATCH');
  if (snapshot.generation !== diagnostic.generation) localBlockers.push('CASE_DIAGNOSTIC_GENERATION_MISMATCH');
  if (snapshot.state !== 'OWNER_ATTENTION_REQUIRED') localBlockers.push('CASE_OWNER_ATTENTION_STATE_MISSING');
  if (!diagnostic.ownerAttentionRequired) localBlockers.push('DIAGNOSTIC_OWNER_ATTENTION_NOT_REQUIRED');
  if (diagnostic.escalationReasonCode === null) localBlockers.push('DIAGNOSTIC_ESCALATION_REASON_MISSING');
  if (input.createdAtMs >= diagnostic.expiresAtMs) localBlockers.push('DIAGNOSTIC_RESULT_EXPIRED');

  const caseBinding = snapshot.currentGenerationDiagnosticBinding;
  const expectedBindingDigest = digestValue({
    diagnosticResultDigest: diagnostic.diagnosisDigest,
    evidenceBundleDigest: diagnostic.evidenceBundleDigest,
  });
  if (caseBinding === null) localBlockers.push('CASE_DIAGNOSTIC_BINDING_MISSING');
  else {
    if (caseBinding.generation !== diagnostic.generation) localBlockers.push('CASE_DIAGNOSTIC_BINDING_GENERATION_MISMATCH');
    if (caseBinding.diagnosticDigest !== diagnostic.diagnosisDigest) localBlockers.push('CASE_DIAGNOSTIC_BINDING_RESULT_MISMATCH');
    if (caseBinding.evidenceBundleDigest !== diagnostic.evidenceBundleDigest) localBlockers.push('CASE_DIAGNOSTIC_BINDING_EVIDENCE_MISMATCH');
    if (caseBinding.bindingDigest !== expectedBindingDigest) localBlockers.push('CASE_DIAGNOSTIC_BINDING_DIGEST_MISMATCH');
  }
  if (proposal.proposedArtifactDigest !== diagnostic.diagnosisDigest) {
    localBlockers.push('OWNER_HANDOFF_DIAGNOSTIC_ARTIFACT_MISMATCH');
  }
  if (proposal.evidenceBundleDigest !== diagnostic.evidenceBundleDigest) {
    localBlockers.push('OWNER_HANDOFF_EVIDENCE_MISMATCH');
  }
  if (proposal.policyRevision !== diagnostic.versions.policyRevision) {
    localBlockers.push('OWNER_HANDOFF_POLICY_MISMATCH');
  }
  if (proposal.providerId !== diagnostic.versions.providerId || proposal.modelId !== diagnostic.versions.modelId) {
    localBlockers.push('OWNER_HANDOFF_PROVIDER_MODEL_MISMATCH');
  }
  if (input.incidentOwnerBinding.caseId !== snapshot.caseId) {
    localBlockers.push('ESCALATION_OWNER_BINDING_CASE_MISMATCH');
  }
  if (input.incidentOwnerBinding.generation !== snapshot.generation) {
    localBlockers.push('ESCALATION_OWNER_BINDING_GENERATION_MISMATCH');
  }
  if (input.incidentOwnerBinding.diagnosticDigest !== diagnostic.diagnosisDigest) {
    localBlockers.push('ESCALATION_OWNER_BINDING_DIAGNOSTIC_MISMATCH');
  }
  if (input.incidentOwnerBinding.evidenceBundleDigest !== diagnostic.evidenceBundleDigest) {
    localBlockers.push('ESCALATION_OWNER_BINDING_EVIDENCE_MISMATCH');
  }
  if (input.incidentOwnerBinding.policyRevision !== diagnostic.versions.policyRevision) {
    localBlockers.push('ESCALATION_OWNER_BINDING_POLICY_MISMATCH');
  }
  if (input.incidentOwnerBinding.incidentId !== proposal.incidentId) {
    localBlockers.push('ESCALATION_OWNER_BINDING_INCIDENT_MISMATCH');
  }

  const readiness: ShadowEscalationReadiness = boundaryDecision.allowed && localBlockers.length === 0
    ? 'READY_FOR_OWNER_HANDOFF'
    : 'BLOCKED';
  const reasonCodes = readiness === 'READY_FOR_OWNER_HANDOFF'
    ? Object.freeze(['OWNER_HANDOFF_READY_SHADOW_ONLY'])
    : Object.freeze(boundedSortedIdentifiers([
      ...localBlockers,
      ...boundaryDecision.reasonCodes,
      ...(boundaryDecision.allowed ? [] : ['PRODUCT_ASSURANCE_OWNER_HANDOFF_DENIED']),
    ], 'shadow escalation reason codes', 128));
  const proposalDigest = digestValue(proposal);
  const evaluationContextDigest = digestValue(context);
  const boundaryDecisionDigest = digestValue(boundaryDecision);
  const core = Object.freeze({
    schema: 'AI_OPS_A2_ESCALATION_INTENT_V1' as const,
    shadowStatus: SHADOW_A2_STATUS,
    caseId: snapshot.caseId,
    caseGeneration: snapshot.generation,
    caseRevision: snapshot.revision,
    caseState: snapshot.state,
    caseSnapshotDigest: snapshot.snapshotDigest,
    caseDiagnosticBindingDigest: caseBinding?.bindingDigest ?? null,
    diagnosisId: diagnostic.diagnosisId,
    diagnosticDigest: diagnostic.diagnosisDigest,
    evidenceBundleDigest: diagnostic.evidenceBundleDigest,
    diagnosticEscalationReasonCode: diagnostic.escalationReasonCode,
    proposalId: proposal.proposalId,
    incidentId: input.incidentOwnerBinding.incidentId,
    proposalDigest,
    evaluationContextDigest,
    boundaryDecision: Object.freeze({
      ...boundaryDecision,
      reasonCodes: Object.freeze([...boundaryDecision.reasonCodes]),
    }),
    boundaryDecisionDigest,
    incidentOwnerBinding: Object.freeze({
      ...input.incidentOwnerBinding,
      signature: Object.freeze({ ...input.incidentOwnerBinding.signature }),
    }),
    targetOwnerId: input.incidentOwnerBinding.targetOwnerId,
    createdAtMs: input.createdAtMs,
    expiresAtMs: input.expiresAtMs,
    readiness,
    reasonCodes,
    deliveryState: 'NOT_ATTEMPTED' as const,
    authorityGranted: false as const,
    operationalAuthority: 'NONE' as const,
  });
  const escalationIntentDigest = digestValue(core);
  const intent = Object.freeze({
    ...core,
    escalationIntentId: shadowSpeculativeId('a2-escalation-intent', {
      caseId: snapshot.caseId,
      caseGeneration: snapshot.generation,
      caseRevision: snapshot.revision,
      escalationIntentDigest,
    }),
    escalationIntentDigest,
  });
  assertShadowEscalationIntentIntegrity(intent, verifier);
  return intent;
}

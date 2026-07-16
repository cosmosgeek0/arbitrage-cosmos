import { createHash } from 'node:crypto';
import {
  assertDigestOrNull,
  assertIdentifier,
  assertSafeNonNegativeInteger,
  assertUtcMs,
  sortedUnique,
  type AssuranceVerdict,
} from '../common.js';

export const DIAGNOSTIC_PERMISSION_LEVELS = Object.freeze([
  'OBSERVE_EXPLAIN',
  'BOUNDED_QUERY_REPLAY',
  'PROPOSE_TYPED_ACTION',
  'PATCH_ISOLATED_AND_TEST',
  'OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY',
] as const);
export type DiagnosticPermissionLevel = (typeof DIAGNOSTIC_PERMISSION_LEVELS)[number];

export const DIAGNOSTIC_FORBIDDEN_CAPABILITIES = Object.freeze([
  'SIGN_ORDER',
  'CANCEL_ORDER',
  'PLACE_ORDER',
  'BORROW',
  'REPAY',
  'CHANGE_LEVERAGE',
  'CHANGE_MARGIN_MODE',
  'TRANSFER',
  'WITHDRAW',
  'RESERVE_CAPITAL',
  'CHANGE_CAPITAL_POLICY',
  'CHANGE_RISK_POLICY',
  'CHANGE_HARD_CEILING',
  'WRITE_MAIN',
  'WRITE_PRODUCTION_PERSISTENCE',
  'EDIT_GUARDRAILS',
  'EDIT_PERMISSIONS',
  'ARBITRARY_SHELL',
  'ARBITRARY_NETWORK',
  'AUTONOMOUS_MERGE',
  'AUTONOMOUS_DEPLOY',
  'DELETE_EVIDENCE',
  'DECLARE_RECOVERY',
] as const);
export type DiagnosticForbiddenCapability = (typeof DIAGNOSTIC_FORBIDDEN_CAPABILITIES)[number];

export const DIAGNOSTIC_PROPOSAL_KINDS = Object.freeze([
  'EXPLAIN_INCIDENT',
  'QUERY_BOUNDED_EVIDENCE',
  'RUN_ISOLATED_REPLAY',
  'PROPOSE_REGISTERED_REMEDIATION',
  'PROPOSE_ISOLATED_PATCH',
  'REQUEST_OWNER_HANDOFF',
] as const);
export type DiagnosticProposalKind = (typeof DIAGNOSTIC_PROPOSAL_KINDS)[number];

export interface DiagnosticApprovalBinding {
  readonly approvalId: string;
  readonly artifactDigest: string;
  readonly actionId: string;
  readonly environmentId: string;
  readonly policyRevision: string;
  readonly capability: DiagnosticPermissionLevel;
  readonly maximumEffect: string;
  readonly expiresAtMs: number;
  readonly rollbackId: string;
  readonly approverId: string;
}

export interface TypedDiagnosticProposal {
  readonly schema: 'PRODUCT_ASSURANCE_DIAGNOSTIC_PROPOSAL_V1';
  readonly proposalId: string;
  readonly proposalKind: DiagnosticProposalKind;
  readonly requestedPermission: DiagnosticPermissionLevel;
  readonly requestedCapabilities: readonly string[];
  readonly evidenceBundleDigest: string;
  readonly proposedArtifactDigest: string | null;
  readonly incidentId: string;
  readonly registeredActionId: string | null;
  readonly providerId: string;
  readonly modelId: string;
  readonly policyRevision: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly tokenBudget: number;
  readonly costBudgetMicrounits: number;
  readonly approval: Readonly<DiagnosticApprovalBinding> | null;
}

export interface DiagnosticBoundaryDecision {
  readonly verdict: AssuranceVerdict;
  readonly allowed: boolean;
  readonly authorityGranted: false;
  readonly providerState: 'READY' | 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'BUDGET_EXHAUSTED';
  readonly reasonCodes: readonly string[];
}

export interface DiagnosticExternalSandboxContext {
  readonly schema: 'PRODUCT_ASSURANCE_DIAGNOSTIC_SANDBOX_V1';
  readonly sandboxId: string;
  readonly providerId: string;
  readonly defaultPolicy: 'DENY_BY_DEFAULT';
  readonly allowedCapabilities: readonly string[];
  readonly arbitraryShellAccess: 'DENIED';
  readonly arbitraryNetworkAccess: 'DENIED';
  readonly secretAccess: 'DENIED';
  readonly mainWorkspaceWriteAccess: 'DENIED';
  readonly productionPersistenceWriteAccess: 'DENIED';
}

export interface DiagnosticTracePrivacyContext {
  readonly schema: 'PRODUCT_ASSURANCE_DIAGNOSTIC_TRACE_PRIVACY_V1';
  readonly traceId: string;
  readonly evidenceBundleDigest: string;
  readonly policyRevision: string;
  readonly redactionApplied: boolean;
  readonly instructionDataBoundaryApplied: boolean;
  readonly rawEvidenceStoredOutsidePrompt: boolean;
  readonly secretMaterialPresentInPrompt: boolean;
}

export interface DiagnosticIndependentRetentionContext {
  readonly schema: 'PRODUCT_ASSURANCE_DIAGNOSTIC_RETENTION_V1';
  readonly retentionId: string;
  readonly retentionPolicyId: string;
  readonly ownerId: string;
  readonly evidenceBundleDigest: string;
  readonly independentFromProvider: boolean;
  readonly providerWriteAccess: 'DENIED';
  readonly providerDeleteAccess: 'DENIED';
}

export interface DiagnosticEvaluationContext {
  readonly nowMs: number;
  readonly providerState: 'READY' | 'NOT_CONFIGURED' | 'UNAVAILABLE';
  readonly maximumTokenBudget: number;
  readonly maximumCostBudgetMicrounits: number;
  readonly allowedPermission: DiagnosticPermissionLevel;
  readonly environmentId: string;
  readonly approvedMaximumEffect: string;
  readonly requiredRollbackId: string;
  readonly authorizedApproverIds: readonly string[];
  readonly externalSandbox: Readonly<DiagnosticExternalSandboxContext>;
  readonly tracePrivacy: Readonly<DiagnosticTracePrivacyContext>;
  readonly independentRetention: Readonly<DiagnosticIndependentRetentionContext>;
}

const REQUIRED_LEVEL: Readonly<Record<DiagnosticProposalKind, DiagnosticPermissionLevel>> = Object.freeze({
  EXPLAIN_INCIDENT: 'OBSERVE_EXPLAIN',
  QUERY_BOUNDED_EVIDENCE: 'BOUNDED_QUERY_REPLAY',
  RUN_ISOLATED_REPLAY: 'BOUNDED_QUERY_REPLAY',
  PROPOSE_REGISTERED_REMEDIATION: 'PROPOSE_TYPED_ACTION',
  PROPOSE_ISOLATED_PATCH: 'PATCH_ISOLATED_AND_TEST',
  REQUEST_OWNER_HANDOFF: 'OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY',
});

export const DIAGNOSTIC_ALLOWED_CAPABILITY_IDS = Object.freeze([
  'READ_REDACTED_EVIDENCE',
  'EXPLAIN_CAUSAL_CHAIN',
  'QUERY_BOUNDED_EVIDENCE',
  'RUN_ISOLATED_REPLAY',
  'PROPOSE_REGISTERED_REMEDIATION',
  'PROPOSE_ISOLATED_PATCH',
  'RUN_ISOLATED_TESTS',
  'REQUEST_OWNER_HANDOFF',
] as const);
type DiagnosticAllowedCapability = (typeof DIAGNOSTIC_ALLOWED_CAPABILITY_IDS)[number];
const DIAGNOSTIC_ALLOWED_CAPABILITIES = new Set<string>(DIAGNOSTIC_ALLOWED_CAPABILITY_IDS);

const LEVEL_RANK = new Map<DiagnosticPermissionLevel, number>(DIAGNOSTIC_PERMISSION_LEVELS.map((level, index) => [level, index]));

const CAPABILITY_MINIMUM_LEVEL: Readonly<Record<DiagnosticAllowedCapability, DiagnosticPermissionLevel>> = Object.freeze({
  READ_REDACTED_EVIDENCE: 'OBSERVE_EXPLAIN',
  EXPLAIN_CAUSAL_CHAIN: 'OBSERVE_EXPLAIN',
  QUERY_BOUNDED_EVIDENCE: 'BOUNDED_QUERY_REPLAY',
  RUN_ISOLATED_REPLAY: 'BOUNDED_QUERY_REPLAY',
  PROPOSE_REGISTERED_REMEDIATION: 'PROPOSE_TYPED_ACTION',
  PROPOSE_ISOLATED_PATCH: 'PATCH_ISOLATED_AND_TEST',
  RUN_ISOLATED_TESTS: 'PATCH_ISOLATED_AND_TEST',
  REQUEST_OWNER_HANDOFF: 'OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY',
});

const REQUIRED_CAPABILITY: Readonly<Record<DiagnosticProposalKind, DiagnosticAllowedCapability>> = Object.freeze({
  EXPLAIN_INCIDENT: 'EXPLAIN_CAUSAL_CHAIN',
  QUERY_BOUNDED_EVIDENCE: 'QUERY_BOUNDED_EVIDENCE',
  RUN_ISOLATED_REPLAY: 'RUN_ISOLATED_REPLAY',
  PROPOSE_REGISTERED_REMEDIATION: 'PROPOSE_REGISTERED_REMEDIATION',
  PROPOSE_ISOLATED_PATCH: 'PROPOSE_ISOLATED_PATCH',
  REQUEST_OWNER_HANDOFF: 'REQUEST_OWNER_HANDOFF',
});

function assertDigest(value: unknown, label: string): asserts value is string {
  assertDigestOrNull(value, label);
  if (typeof value !== 'string') throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
}

function assertBoundedText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 1_000) {
    throw new TypeError(`${label} must be non-empty text (<=1000 chars)`);
  }
}

function assertUniqueIdentifiers(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique`);
  for (const value of values) assertIdentifier(value, `${label}[]`);
}

export function evaluateDiagnosticProposal(
  proposal: Readonly<TypedDiagnosticProposal>,
  context: Readonly<DiagnosticEvaluationContext>,
): Readonly<DiagnosticBoundaryDecision> {
  if (proposal.schema !== 'PRODUCT_ASSURANCE_DIAGNOSTIC_PROPOSAL_V1') throw new TypeError('diagnostic proposal schema unsupported');
  if (!(DIAGNOSTIC_PROPOSAL_KINDS as readonly string[]).includes(proposal.proposalKind)) {
    throw new TypeError('diagnostic proposal kind unsupported');
  }
  if (!(DIAGNOSTIC_PERMISSION_LEVELS as readonly string[]).includes(proposal.requestedPermission)) {
    throw new TypeError('diagnostic requested permission unsupported');
  }
  assertIdentifier(proposal.proposalId, 'proposal.proposalId');
  assertIdentifier(proposal.incidentId, 'proposal.incidentId');
  assertIdentifier(proposal.providerId, 'proposal.providerId');
  assertIdentifier(proposal.modelId, 'proposal.modelId');
  assertIdentifier(proposal.policyRevision, 'proposal.policyRevision');
  if (proposal.registeredActionId !== null) assertIdentifier(proposal.registeredActionId, 'proposal.registeredActionId');
  assertDigest(proposal.evidenceBundleDigest, 'proposal.evidenceBundleDigest');
  assertDigestOrNull(proposal.proposedArtifactDigest, 'proposal.proposedArtifactDigest');
  assertUtcMs(proposal.createdAtMs, 'proposal.createdAtMs');
  assertUtcMs(proposal.expiresAtMs, 'proposal.expiresAtMs');
  if (proposal.expiresAtMs <= proposal.createdAtMs) throw new TypeError('diagnostic proposal expiry must follow creation');
  assertUtcMs(context.nowMs, 'context.nowMs');
  assertSafeNonNegativeInteger(proposal.tokenBudget, 'proposal.tokenBudget');
  assertSafeNonNegativeInteger(proposal.costBudgetMicrounits, 'proposal.costBudgetMicrounits');
  assertSafeNonNegativeInteger(context.maximumTokenBudget, 'context.maximumTokenBudget');
  assertSafeNonNegativeInteger(context.maximumCostBudgetMicrounits, 'context.maximumCostBudgetMicrounits');
  if (!(['READY', 'NOT_CONFIGURED', 'UNAVAILABLE'] as const).includes(context.providerState)) {
    throw new TypeError('diagnostic provider state unsupported');
  }
  if (!(DIAGNOSTIC_PERMISSION_LEVELS as readonly string[]).includes(context.allowedPermission)) {
    throw new TypeError('diagnostic context allowed permission unsupported');
  }
  assertIdentifier(context.environmentId, 'context.environmentId');
  assertBoundedText(context.approvedMaximumEffect, 'context.approvedMaximumEffect');
  assertIdentifier(context.requiredRollbackId, 'context.requiredRollbackId');
  assertUniqueIdentifiers(context.authorizedApproverIds, 'context.authorizedApproverIds');
  assertUniqueIdentifiers(proposal.requestedCapabilities, 'proposal.requestedCapabilities');

  const sandbox = context.externalSandbox;
  if (sandbox.schema !== 'PRODUCT_ASSURANCE_DIAGNOSTIC_SANDBOX_V1') throw new TypeError('diagnostic sandbox schema unsupported');
  assertIdentifier(sandbox.sandboxId, 'context.externalSandbox.sandboxId');
  assertIdentifier(sandbox.providerId, 'context.externalSandbox.providerId');
  if (sandbox.defaultPolicy !== 'DENY_BY_DEFAULT') throw new TypeError('diagnostic sandbox must deny by default');
  assertUniqueIdentifiers(sandbox.allowedCapabilities, 'context.externalSandbox.allowedCapabilities');
  for (const capability of sandbox.allowedCapabilities) {
    if (!DIAGNOSTIC_ALLOWED_CAPABILITIES.has(capability)) {
      throw new TypeError(`diagnostic sandbox capability not allowlisted: ${capability}`);
    }
  }

  const tracePrivacy = context.tracePrivacy;
  if (tracePrivacy.schema !== 'PRODUCT_ASSURANCE_DIAGNOSTIC_TRACE_PRIVACY_V1') throw new TypeError('diagnostic trace privacy schema unsupported');
  assertIdentifier(tracePrivacy.traceId, 'context.tracePrivacy.traceId');
  assertDigest(tracePrivacy.evidenceBundleDigest, 'context.tracePrivacy.evidenceBundleDigest');
  assertIdentifier(tracePrivacy.policyRevision, 'context.tracePrivacy.policyRevision');
  if (typeof tracePrivacy.redactionApplied !== 'boolean'
    || typeof tracePrivacy.instructionDataBoundaryApplied !== 'boolean'
    || typeof tracePrivacy.rawEvidenceStoredOutsidePrompt !== 'boolean'
    || typeof tracePrivacy.secretMaterialPresentInPrompt !== 'boolean') {
    throw new TypeError('diagnostic trace privacy flags must be boolean');
  }

  const retention = context.independentRetention;
  if (retention.schema !== 'PRODUCT_ASSURANCE_DIAGNOSTIC_RETENTION_V1') throw new TypeError('diagnostic retention schema unsupported');
  assertIdentifier(retention.retentionId, 'context.independentRetention.retentionId');
  assertIdentifier(retention.retentionPolicyId, 'context.independentRetention.retentionPolicyId');
  assertIdentifier(retention.ownerId, 'context.independentRetention.ownerId');
  assertDigest(retention.evidenceBundleDigest, 'context.independentRetention.evidenceBundleDigest');
  if (typeof retention.independentFromProvider !== 'boolean') {
    throw new TypeError('diagnostic retention independence flag must be boolean');
  }

  const failed: string[] = [];
  const unknown: string[] = [];
  if (context.providerState !== 'READY') unknown.push('DIAGNOSTIC_PLANE_UNAVAILABLE');
  if (context.nowMs < proposal.createdAtMs) failed.push('DIAGNOSTIC_PROPOSAL_NOT_YET_VALID');
  if (context.nowMs >= proposal.expiresAtMs) failed.push('DIAGNOSTIC_PROPOSAL_EXPIRED');
  if (proposal.tokenBudget > context.maximumTokenBudget || proposal.costBudgetMicrounits > context.maximumCostBudgetMicrounits) failed.push('DIAGNOSTIC_BUDGET_EXHAUSTED');
  if (sandbox.providerId !== proposal.providerId) failed.push('DIAGNOSTIC_SANDBOX_PROVIDER_MISMATCH');
  if (sandbox.arbitraryShellAccess !== 'DENIED'
    || sandbox.arbitraryNetworkAccess !== 'DENIED'
    || sandbox.secretAccess !== 'DENIED'
    || sandbox.mainWorkspaceWriteAccess !== 'DENIED'
    || sandbox.productionPersistenceWriteAccess !== 'DENIED') {
    failed.push('DIAGNOSTIC_SANDBOX_DENY_BY_DEFAULT_UNPROVEN');
  }
  if (!tracePrivacy.redactionApplied
    || !tracePrivacy.instructionDataBoundaryApplied
    || !tracePrivacy.rawEvidenceStoredOutsidePrompt
    || tracePrivacy.secretMaterialPresentInPrompt) {
    failed.push('DIAGNOSTIC_TRACE_PRIVACY_UNPROVEN');
  }
  if (tracePrivacy.evidenceBundleDigest !== proposal.evidenceBundleDigest) failed.push('DIAGNOSTIC_TRACE_EVIDENCE_MISMATCH');
  if (tracePrivacy.policyRevision !== proposal.policyRevision) failed.push('DIAGNOSTIC_TRACE_POLICY_MISMATCH');
  if (!retention.independentFromProvider
    || retention.ownerId === proposal.providerId
    || retention.providerWriteAccess !== 'DENIED'
    || retention.providerDeleteAccess !== 'DENIED') {
    failed.push('DIAGNOSTIC_AUDIT_RETENTION_UNPROVEN');
  }
  if (retention.evidenceBundleDigest !== proposal.evidenceBundleDigest) failed.push('DIAGNOSTIC_RETENTION_EVIDENCE_MISMATCH');

  const required = REQUIRED_LEVEL[proposal.proposalKind];
  if (proposal.requestedPermission !== required) failed.push('DIAGNOSTIC_PERMISSION_NOT_EXACT_MINIMUM');
  if ((LEVEL_RANK.get(proposal.requestedPermission) ?? Number.MAX_SAFE_INTEGER) > (LEVEL_RANK.get(context.allowedPermission) ?? -1)) failed.push('DIAGNOSTIC_PERMISSION_EXCEEDS_BOUNDARY');
  for (const capability of proposal.requestedCapabilities) {
    if ((DIAGNOSTIC_FORBIDDEN_CAPABILITIES as readonly string[]).includes(capability)) failed.push(`DIAGNOSTIC_CAPABILITY_FORBIDDEN_${capability}`);
    else if (!DIAGNOSTIC_ALLOWED_CAPABILITIES.has(capability)) failed.push('DIAGNOSTIC_CAPABILITY_NOT_ALLOWLISTED');
    else {
      const minimumLevel = CAPABILITY_MINIMUM_LEVEL[capability as DiagnosticAllowedCapability];
      if ((LEVEL_RANK.get(minimumLevel) ?? Number.MAX_SAFE_INTEGER) > (LEVEL_RANK.get(proposal.requestedPermission) ?? -1)) {
        failed.push('DIAGNOSTIC_CAPABILITY_EXCEEDS_PERMISSION');
      }
      if (!sandbox.allowedCapabilities.includes(capability)) failed.push('DIAGNOSTIC_CAPABILITY_NOT_BOUND_TO_SANDBOX');
    }
  }
  if (!proposal.requestedCapabilities.includes(REQUIRED_CAPABILITY[proposal.proposalKind])) {
    failed.push('DIAGNOSTIC_REQUIRED_CAPABILITY_MISSING');
  }
  if (proposal.proposalKind === 'PROPOSE_REGISTERED_REMEDIATION' && proposal.registeredActionId === null) failed.push('REGISTERED_REMEDIATION_ID_MISSING');
  if (proposal.proposalKind === 'REQUEST_OWNER_HANDOFF' && proposal.registeredActionId === null) failed.push('OWNER_HANDOFF_ACTION_ID_MISSING');
  if (proposal.proposalKind === 'REQUEST_OWNER_HANDOFF') {
    const approval = proposal.approval;
    if (approval === null) unknown.push('OWNER_APPROVAL_MISSING');
    else {
      assertIdentifier(approval.approvalId, 'approval.approvalId');
      assertDigest(approval.artifactDigest, 'approval.artifactDigest');
      assertIdentifier(approval.actionId, 'approval.actionId');
      assertIdentifier(approval.environmentId, 'approval.environmentId');
      assertIdentifier(approval.policyRevision, 'approval.policyRevision');
      if (!(DIAGNOSTIC_PERMISSION_LEVELS as readonly string[]).includes(approval.capability)) {
        throw new TypeError('owner approval capability unsupported');
      }
      assertBoundedText(approval.maximumEffect, 'approval.maximumEffect');
      assertUtcMs(approval.expiresAtMs, 'approval.expiresAtMs');
      assertIdentifier(approval.rollbackId, 'approval.rollbackId');
      assertIdentifier(approval.approverId, 'approval.approverId');
      if (context.nowMs >= approval.expiresAtMs) failed.push('OWNER_APPROVAL_EXPIRED');
      if (approval.expiresAtMs <= proposal.createdAtMs || approval.expiresAtMs > proposal.expiresAtMs) failed.push('OWNER_APPROVAL_EXPIRY_OUTSIDE_PROPOSAL');
      if (proposal.proposedArtifactDigest === null) unknown.push('OWNER_HANDOFF_ARTIFACT_DIGEST_MISSING');
      else if (approval.artifactDigest !== proposal.proposedArtifactDigest) failed.push('OWNER_APPROVAL_ARTIFACT_MISMATCH');
      if (approval.actionId !== proposal.registeredActionId) failed.push('OWNER_APPROVAL_ACTION_MISMATCH');
      if (approval.environmentId !== context.environmentId) failed.push('OWNER_APPROVAL_ENVIRONMENT_MISMATCH');
      if (approval.policyRevision !== proposal.policyRevision) failed.push('OWNER_APPROVAL_POLICY_MISMATCH');
      if (approval.capability !== proposal.requestedPermission) failed.push('OWNER_APPROVAL_CAPABILITY_MISMATCH');
      if (approval.maximumEffect !== context.approvedMaximumEffect) failed.push('OWNER_APPROVAL_MAXIMUM_EFFECT_MISMATCH');
      if (approval.rollbackId !== context.requiredRollbackId) failed.push('OWNER_APPROVAL_ROLLBACK_MISMATCH');
      if (!context.authorizedApproverIds.includes(approval.approverId)) failed.push('OWNER_APPROVER_NOT_AUTHORIZED');
    }
  } else if (proposal.approval !== null) {
    failed.push('OWNER_APPROVAL_UNEXPECTED_FOR_PROPOSAL');
  } else if (proposal.proposedArtifactDigest !== null) {
    failed.push('PROPOSED_ARTIFACT_DIGEST_UNEXPECTED');
  }
  const budgetExhausted = failed.includes('DIAGNOSTIC_BUDGET_EXHAUSTED');
  return Object.freeze({
    verdict: failed.length > 0 ? 'FAIL' : unknown.length > 0 ? 'UNKNOWN' : 'PASS',
    allowed: failed.length === 0 && unknown.length === 0,
    authorityGranted: false,
    providerState: budgetExhausted ? 'BUDGET_EXHAUSTED' : context.providerState,
    reasonCodes: sortedUnique([...failed, ...unknown]),
  });
}

const PEM_BLOCK_PATTERN = new RegExp(
  ['-{5}BEGIN', '(?: RSA| EC| OPENSSH)? PRIVATE KEY-{5}', '[\\s\\S]*?', '-{5}END', '(?: RSA| EC| OPENSSH)? PRIVATE KEY-{5}'].join(''),
  'giu',
);
const SECRET_PATTERNS = [
  /(?:"?(?:api[_-]?key|apiKey|api[_-]?secret|apiSecret|password|passphrase|private[_-]?key|privateKey|listen[_-]?key|listenKey|credential)"?\s*[:=]\s*)"?[^"\s,;}{]+"?/giu,
  /\b(?:BEARER|TOKEN)\s+[A-Za-z0-9._~+/-]{8,}/giu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  PEM_BLOCK_PATTERN,
];

export interface UntrustedDiagnosticEvidence {
  readonly evidenceId: string;
  readonly sourceKind: 'LOG' | 'MARKET' | 'NEWS' | 'EXCHANGE' | 'ISSUE' | 'PAGE' | 'RETRIEVED_DOCUMENT';
  readonly rawDigest: string;
  readonly text: string;
}

export interface RedactedDiagnosticBundle {
  readonly instructionBoundary: 'EVIDENCE_IS_UNTRUSTED_DATA_NEVER_INSTRUCTIONS';
  readonly evidence: readonly Readonly<{
    evidenceId: string;
    sourceKind: UntrustedDiagnosticEvidence['sourceKind'];
    rawDigest: string;
    redactedText: string;
  }>[];
  readonly redactionCount: number;
}

export function redactDiagnosticEvidence(
  evidence: readonly Readonly<UntrustedDiagnosticEvidence>[],
): Readonly<RedactedDiagnosticBundle> {
  const evidenceIds = evidence.map((item) => item.evidenceId);
  if (new Set(evidenceIds).size !== evidenceIds.length) throw new TypeError('diagnostic evidence IDs must be unique');
  let redactionCount = 0;
  const redacted = evidence.map((item) => {
    assertIdentifier(item.evidenceId, 'evidence.evidenceId');
    assertDigest(item.rawDigest, 'evidence.rawDigest');
    if (!(['LOG', 'MARKET', 'NEWS', 'EXCHANGE', 'ISSUE', 'PAGE', 'RETRIEVED_DOCUMENT'] as const).includes(item.sourceKind)) {
      throw new TypeError('diagnostic evidence sourceKind unsupported');
    }
    if (typeof item.text !== 'string') throw new TypeError('diagnostic evidence text must be string');
    if (item.rawDigest !== createHash('sha256').update(item.text).digest('hex')) {
      throw new TypeError(`diagnostic evidence ${item.evidenceId} raw digest mismatch`);
    }
    let text = item.text.slice(0, 16_384);
    for (const pattern of SECRET_PATTERNS) {
      text = text.replace(pattern, () => {
        redactionCount += 1;
        return '[REDACTED]';
      });
    }
    return Object.freeze({ evidenceId: item.evidenceId, sourceKind: item.sourceKind, rawDigest: item.rawDigest, redactedText: text });
  });
  return Object.freeze({ instructionBoundary: 'EVIDENCE_IS_UNTRUSTED_DATA_NEVER_INSTRUCTIONS', evidence: Object.freeze(redacted), redactionCount });
}

export function diagnosticProviderOutageProjection(
  providerState: 'READY' | 'NOT_CONFIGURED' | 'UNAVAILABLE',
): Readonly<{ diagnosticState: string; productReadinessChanged: false; deterministicSafetyChanged: false; executionChanged: false }> {
  if (!(['READY', 'NOT_CONFIGURED', 'UNAVAILABLE'] as const).includes(providerState)) {
    throw new TypeError('diagnostic provider state unsupported');
  }
  return Object.freeze({
    diagnosticState: providerState === 'READY' ? 'READY' : 'DIAGNOSTIC_PLANE_UNAVAILABLE',
    productReadinessChanged: false,
    deterministicSafetyChanged: false,
    executionChanged: false,
  });
}

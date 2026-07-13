import {
  ASSURANCE_VERDICTS,
  assertDigestOrNull,
  assertIdentifier,
  assertPositiveSafeInteger,
  assertSafeNonNegativeInteger,
  assertUtcMs,
  sortedUnique,
  verdictFromReasons,
  type AssuranceVerdict,
} from '../common.js';
import {
  DIAGNOSTIC_ALLOWED_CAPABILITY_IDS,
  DIAGNOSTIC_FORBIDDEN_CAPABILITIES,
  DIAGNOSTIC_PERMISSION_LEVELS,
  type DiagnosticPermissionLevel,
} from './boundary.js';

export const SELF_CORRECTION_CLASSES = Object.freeze(['A', 'B', 'C', 'D'] as const);
export type SelfCorrectionClass = (typeof SELF_CORRECTION_CLASSES)[number];

export interface ProviderWorkloadIdentity {
  readonly state: 'READY' | 'NOT_CONFIGURED' | 'UNAVAILABLE';
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly workloadIdentityId: string | null;
  readonly audienceId: string | null;
  readonly endpointId: string | null;
  readonly issuedAtMs: number | null;
  readonly expiresAtMs: number | null;
  readonly rotationDueAtMs: number | null;
  readonly secretMaterialPresentInProjection: boolean;
}

export function evaluateProviderWorkloadIdentity(
  identity: Readonly<ProviderWorkloadIdentity>,
  nowMs: number,
): Readonly<{ verdict: AssuranceVerdict; lifecycleState: ProviderWorkloadIdentity['state']; reasonCodes: readonly string[]; authorityGranted: false }> {
  assertUtcMs(nowMs, 'nowMs');
  if (!(['READY', 'NOT_CONFIGURED', 'UNAVAILABLE'] as const).includes(identity.state)) throw new TypeError('identity.state unsupported');
  if (typeof identity.secretMaterialPresentInProjection !== 'boolean') throw new TypeError('identity.secretMaterialPresentInProjection must be boolean');
  if (identity.secretMaterialPresentInProjection) {
    return Object.freeze({ verdict: 'FAIL', lifecycleState: identity.state, reasonCodes: Object.freeze(['PROVIDER_SECRET_MATERIAL_EXPOSED']), authorityGranted: false });
  }
  if (identity.state === 'NOT_CONFIGURED') {
    return Object.freeze({ verdict: 'UNKNOWN', lifecycleState: 'NOT_CONFIGURED', reasonCodes: Object.freeze(['DIAGNOSTIC_PROVIDER_NOT_CONFIGURED']), authorityGranted: false });
  }
  if (identity.state === 'UNAVAILABLE') {
    return Object.freeze({ verdict: 'UNKNOWN', lifecycleState: 'UNAVAILABLE', reasonCodes: Object.freeze(['DIAGNOSTIC_PROVIDER_UNAVAILABLE']), authorityGranted: false });
  }
  const failed: string[] = [];
  const unknown: string[] = [];
  for (const [label, value] of [
    ['providerId', identity.providerId],
    ['modelId', identity.modelId],
    ['workloadIdentityId', identity.workloadIdentityId],
    ['audienceId', identity.audienceId],
    ['endpointId', identity.endpointId],
  ] as const) {
    if (value === null) unknown.push(`PROVIDER_${label.toUpperCase()}_MISSING`);
    else assertIdentifier(value, `identity.${label}`);
  }
  if (identity.issuedAtMs === null || identity.expiresAtMs === null || identity.rotationDueAtMs === null) {
    unknown.push('PROVIDER_IDENTITY_LIFECYCLE_TIME_MISSING');
  } else {
    assertUtcMs(identity.issuedAtMs, 'identity.issuedAtMs');
    assertUtcMs(identity.expiresAtMs, 'identity.expiresAtMs');
    assertUtcMs(identity.rotationDueAtMs, 'identity.rotationDueAtMs');
    if (identity.issuedAtMs > nowMs) failed.push('PROVIDER_IDENTITY_NOT_YET_VALID');
    if (identity.expiresAtMs <= nowMs) failed.push('PROVIDER_IDENTITY_EXPIRED');
    if (identity.rotationDueAtMs <= nowMs) failed.push('PROVIDER_IDENTITY_ROTATION_OVERDUE');
    if (identity.expiresAtMs <= identity.issuedAtMs || identity.rotationDueAtMs <= identity.issuedAtMs) failed.push('PROVIDER_IDENTITY_LIFECYCLE_INVALID');
  }
  return Object.freeze({ verdict: verdictFromReasons(failed, unknown), lifecycleState: identity.state, reasonCodes: sortedUnique([...failed, ...unknown]), authorityGranted: false });
}

export interface DiagnosticSandboxBinding {
  readonly sandboxId: string;
  readonly denyByDefault: boolean;
  readonly networkMode: 'NONE' | 'EXPLICIT_ALLOWLIST';
  readonly networkAllowlistIds: readonly string[];
  readonly filesystemMode: 'READ_ONLY_REDACTED' | 'ISOLATED_EPHEMERAL_WORKTREE';
  readonly allowedCapabilityIds: readonly string[];
  readonly arbitraryShellAllowed: boolean;
  readonly productionPersistenceWritable: boolean;
  readonly externalMutationAllowed: boolean;
  readonly tracePrivacyApplied: boolean;
  readonly independentTraceRetention: boolean;
  readonly retentionOwnerId: string | null;
}

export function evaluateDiagnosticSandbox(
  binding: Readonly<DiagnosticSandboxBinding>,
): Readonly<{ verdict: AssuranceVerdict; reasonCodes: readonly string[]; authorityGranted: false }> {
  assertIdentifier(binding.sandboxId, 'binding.sandboxId');
  if (!(['NONE', 'EXPLICIT_ALLOWLIST'] as const).includes(binding.networkMode)) throw new TypeError('binding.networkMode unsupported');
  if (!(['READ_ONLY_REDACTED', 'ISOLATED_EPHEMERAL_WORKTREE'] as const).includes(binding.filesystemMode)) throw new TypeError('binding.filesystemMode unsupported');
  for (const [label, value] of [
    ['denyByDefault', binding.denyByDefault],
    ['arbitraryShellAllowed', binding.arbitraryShellAllowed],
    ['productionPersistenceWritable', binding.productionPersistenceWritable],
    ['externalMutationAllowed', binding.externalMutationAllowed],
    ['tracePrivacyApplied', binding.tracePrivacyApplied],
    ['independentTraceRetention', binding.independentTraceRetention],
  ] as const) if (typeof value !== 'boolean') throw new TypeError(`binding.${label} must be boolean`);
  const failed: string[] = [];
  const unknown: string[] = [];
  if (!binding.denyByDefault) failed.push('SANDBOX_NOT_DENY_BY_DEFAULT');
  if (binding.arbitraryShellAllowed) failed.push('SANDBOX_ARBITRARY_SHELL_FORBIDDEN');
  if (binding.productionPersistenceWritable) failed.push('SANDBOX_PRODUCTION_PERSISTENCE_WRITE_FORBIDDEN');
  if (binding.externalMutationAllowed) failed.push('SANDBOX_EXTERNAL_MUTATION_FORBIDDEN');
  if (!binding.tracePrivacyApplied) failed.push('SANDBOX_TRACE_PRIVACY_MISSING');
  if (!binding.independentTraceRetention) unknown.push('SANDBOX_INDEPENDENT_TRACE_RETENTION_UNKNOWN');
  if (binding.retentionOwnerId === null) unknown.push('SANDBOX_RETENTION_OWNER_MISSING');
  else assertIdentifier(binding.retentionOwnerId, 'binding.retentionOwnerId');
  if (new Set(binding.allowedCapabilityIds).size !== binding.allowedCapabilityIds.length) failed.push('SANDBOX_CAPABILITY_ALLOWLIST_DUPLICATE');
  for (const capabilityId of binding.allowedCapabilityIds) {
    assertIdentifier(capabilityId, 'binding.allowedCapabilityId');
    if ((DIAGNOSTIC_FORBIDDEN_CAPABILITIES as readonly string[]).includes(capabilityId)
      || !(DIAGNOSTIC_ALLOWED_CAPABILITY_IDS as readonly string[]).includes(capabilityId)) failed.push('SANDBOX_CAPABILITY_FORBIDDEN_OR_UNKNOWN');
  }
  if (new Set(binding.networkAllowlistIds).size !== binding.networkAllowlistIds.length) failed.push('SANDBOX_NETWORK_ALLOWLIST_DUPLICATE');
  for (const endpointId of binding.networkAllowlistIds) assertIdentifier(endpointId, 'binding.networkAllowlistId');
  if (binding.networkMode === 'NONE' && binding.networkAllowlistIds.length > 0) failed.push('SANDBOX_NETWORK_NONE_WITH_ALLOWLIST');
  if (binding.networkMode === 'EXPLICIT_ALLOWLIST' && binding.networkAllowlistIds.length === 0) unknown.push('SANDBOX_NETWORK_ALLOWLIST_MISSING');
  return Object.freeze({ verdict: verdictFromReasons(failed, unknown), reasonCodes: sortedUnique([...failed, ...unknown]), authorityGranted: false });
}

const CLASS_PERMISSION = {
  A: ['OBSERVE_EXPLAIN'],
  B: ['BOUNDED_QUERY_REPLAY'],
  C: ['PROPOSE_TYPED_ACTION', 'PATCH_ISOLATED_AND_TEST'],
  D: ['OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY'],
} as const satisfies Readonly<Record<SelfCorrectionClass, readonly DiagnosticPermissionLevel[]>>;

export interface RepairPromotionEvidence {
  readonly actionCompleted: boolean;
  readonly independentPostconditionVerdict: AssuranceVerdict;
  readonly producerId: string;
  readonly verifierId: string | null;
  readonly evidenceDigest: string | null;
  readonly verifiedAtMs: number | null;
  readonly quietPeriodMs: number;
  readonly evaluatedAtMs: number;
  readonly rollbackAvailable: boolean;
}

export function evaluateRepairPromotionEvidence(
  evidence: Readonly<RepairPromotionEvidence>,
): Readonly<{ verdict: AssuranceVerdict; healthyPromotionAllowed: boolean; reasonCodes: readonly string[] }> {
  assertIdentifier(evidence.producerId, 'evidence.producerId');
  if (typeof evidence.actionCompleted !== 'boolean' || typeof evidence.rollbackAvailable !== 'boolean') throw new TypeError('repair promotion flags must be boolean');
  if (!(ASSURANCE_VERDICTS as readonly unknown[]).includes(evidence.independentPostconditionVerdict)) throw new TypeError('repair postcondition verdict unsupported');
  assertPositiveSafeInteger(evidence.quietPeriodMs, 'evidence.quietPeriodMs');
  assertUtcMs(evidence.evaluatedAtMs, 'evidence.evaluatedAtMs');
  assertDigestOrNull(evidence.evidenceDigest, 'evidence.evidenceDigest');
  const failed: string[] = [];
  const unknown: string[] = [];
  if (!evidence.actionCompleted) unknown.push('REPAIR_ACTION_NOT_COMPLETED');
  if (evidence.independentPostconditionVerdict === 'FAIL') failed.push('REPAIR_POSTCONDITION_FAILED');
  if (evidence.independentPostconditionVerdict === 'UNKNOWN') unknown.push('REPAIR_POSTCONDITION_UNKNOWN');
  if (evidence.verifierId === null) unknown.push('REPAIR_VERIFIER_MISSING');
  else {
    assertIdentifier(evidence.verifierId, 'evidence.verifierId');
    if (evidence.verifierId === evidence.producerId) failed.push('REPAIR_VERIFIER_NOT_INDEPENDENT');
  }
  if (evidence.evidenceDigest === null) unknown.push('REPAIR_EVIDENCE_DIGEST_MISSING');
  if (evidence.verifiedAtMs === null) unknown.push('REPAIR_VERIFICATION_TIME_MISSING');
  else {
    assertUtcMs(evidence.verifiedAtMs, 'evidence.verifiedAtMs');
    if (evidence.verifiedAtMs > evidence.evaluatedAtMs) failed.push('REPAIR_VERIFICATION_TIME_IN_FUTURE');
    if (evidence.evaluatedAtMs - evidence.verifiedAtMs < evidence.quietPeriodMs) unknown.push('REPAIR_QUIET_PERIOD_NOT_ELAPSED');
  }
  if (!evidence.rollbackAvailable) unknown.push('REPAIR_ROLLBACK_UNAVAILABLE');
  const verdict = verdictFromReasons(failed, unknown);
  return Object.freeze({ verdict, healthyPromotionAllowed: verdict === 'PASS', reasonCodes: sortedUnique([...failed, ...unknown]) });
}

export interface SelfCorrectionPromotionCandidate {
  readonly candidateId: string;
  readonly fromClass: SelfCorrectionClass;
  readonly toClass: SelfCorrectionClass;
  readonly requestedPermission: DiagnosticPermissionLevel;
  readonly evaluationVerdict: AssuranceVerdict;
  readonly independentVerifierId: string | null;
  readonly producerId: string;
  readonly holdoutVerdict: AssuranceVerdict;
  readonly sandboxVerdict: AssuranceVerdict;
  readonly repairEvidenceVerdict: AssuranceVerdict;
  readonly ownerApprovalDigest: string | null;
}

export function evaluateSelfCorrectionPromotion(
  candidate: Readonly<SelfCorrectionPromotionCandidate>,
): Readonly<{ verdict: AssuranceVerdict; promoted: boolean; reasonCodes: readonly string[]; authorityGranted: false }> {
  assertIdentifier(candidate.candidateId, 'candidate.candidateId');
  assertIdentifier(candidate.producerId, 'candidate.producerId');
  if (!(DIAGNOSTIC_PERMISSION_LEVELS as readonly unknown[]).includes(candidate.requestedPermission)) throw new TypeError('promotion permission unsupported');
  for (const [label, verdict] of [
    ['evaluationVerdict', candidate.evaluationVerdict],
    ['holdoutVerdict', candidate.holdoutVerdict],
    ['sandboxVerdict', candidate.sandboxVerdict],
    ['repairEvidenceVerdict', candidate.repairEvidenceVerdict],
  ] as const) if (!(ASSURANCE_VERDICTS as readonly unknown[]).includes(verdict)) throw new TypeError(`candidate.${label} unsupported`);
  assertDigestOrNull(candidate.ownerApprovalDigest, 'candidate.ownerApprovalDigest');
  const failed: string[] = [];
  const unknown: string[] = [];
  const fromRank = SELF_CORRECTION_CLASSES.indexOf(candidate.fromClass);
  const toRank = SELF_CORRECTION_CLASSES.indexOf(candidate.toClass);
  if (fromRank < 0 || toRank < 0) throw new TypeError('self-correction class unsupported');
  if (toRank !== fromRank + 1) failed.push('PROMOTION_MUST_BE_ONE_CLASS_AT_A_TIME');
  if (!(CLASS_PERMISSION[candidate.toClass] as readonly DiagnosticPermissionLevel[]).includes(candidate.requestedPermission)) failed.push('PROMOTION_PERMISSION_CLASS_MISMATCH');
  if (candidate.evaluationVerdict === 'FAIL') failed.push('PROMOTION_EVALUATION_FAILED');
  if (candidate.evaluationVerdict === 'UNKNOWN') unknown.push('PROMOTION_EVALUATION_UNKNOWN');
  if (candidate.holdoutVerdict === 'FAIL') failed.push('PROMOTION_HOLDOUT_FAILED');
  if (candidate.holdoutVerdict === 'UNKNOWN') unknown.push('PROMOTION_HOLDOUT_UNKNOWN');
  if (candidate.sandboxVerdict === 'FAIL') failed.push('PROMOTION_SANDBOX_FAILED');
  if (candidate.sandboxVerdict === 'UNKNOWN') unknown.push('PROMOTION_SANDBOX_UNKNOWN');
  if (candidate.repairEvidenceVerdict === 'FAIL') failed.push('PROMOTION_REPAIR_EVIDENCE_FAILED');
  if (candidate.repairEvidenceVerdict === 'UNKNOWN') unknown.push('PROMOTION_REPAIR_EVIDENCE_UNKNOWN');
  if (candidate.independentVerifierId === null) unknown.push('PROMOTION_VERIFIER_MISSING');
  else {
    assertIdentifier(candidate.independentVerifierId, 'candidate.independentVerifierId');
    if (candidate.independentVerifierId === candidate.producerId) failed.push('PROMOTION_VERIFIER_NOT_INDEPENDENT');
  }
  if (candidate.toClass === 'D' && candidate.ownerApprovalDigest === null) unknown.push('PROMOTION_OWNER_APPROVAL_MISSING');
  const verdict = verdictFromReasons(failed, unknown);
  return Object.freeze({ verdict, promoted: verdict === 'PASS', reasonCodes: sortedUnique([...failed, ...unknown]), authorityGranted: false });
}

export interface DiagnosticCorpusEntry {
  readonly corpusEntryId: string;
  readonly dedupFingerprint: string;
  readonly provenanceDigest: string;
  readonly sanitizedDigest: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly accessClass: 'ASSURANCE_RESTRICTED' | 'REVIEWER_RESTRICTED';
  readonly retentionUntilMs: number;
  readonly reviewerId: string;
  readonly rawPromptStored: boolean;
  readonly rawSecretStored: boolean;
  readonly validatedRegressionFixtureId: string | null;
}

export function evaluateDiagnosticCorpusGovernance(
  entries: readonly Readonly<DiagnosticCorpusEntry>[],
  nowMs: number,
): Readonly<{ verdict: AssuranceVerdict; eligibleEntryIds: readonly string[]; rejectedEntryIds: readonly string[]; reasonCodes: readonly string[] }> {
  assertUtcMs(nowMs, 'nowMs');
  if (entries.length === 0) return Object.freeze({ verdict: 'UNKNOWN', eligibleEntryIds: Object.freeze([]), rejectedEntryIds: Object.freeze([]), reasonCodes: Object.freeze(['DIAGNOSTIC_CORPUS_EMPTY']) });
  const failed: string[] = [];
  const unknown: string[] = [];
  const eligible: string[] = [];
  const rejected: string[] = [];
  const entryIds = entries.map((entry) => entry.corpusEntryId);
  const fingerprints = entries.map((entry) => entry.dedupFingerprint);
  if (new Set(entryIds).size !== entryIds.length) throw new TypeError('diagnostic corpus contains duplicate entry IDs');
  const duplicateFingerprints = new Set(fingerprints.filter((fingerprint, index) => fingerprints.indexOf(fingerprint) !== index));
  for (const entry of entries) {
    assertIdentifier(entry.corpusEntryId, 'entry.corpusEntryId');
    assertIdentifier(entry.dedupFingerprint, 'entry.dedupFingerprint');
    assertDigestOrNull(entry.provenanceDigest, 'entry.provenanceDigest');
    assertDigestOrNull(entry.sanitizedDigest, 'entry.sanitizedDigest');
    if (entry.provenanceDigest === null || entry.sanitizedDigest === null) throw new TypeError('corpus provenance and sanitized digests are required');
    if (!(['ASSURANCE_RESTRICTED', 'REVIEWER_RESTRICTED'] as const).includes(entry.accessClass)) throw new TypeError('entry.accessClass unsupported');
    if (typeof entry.rawPromptStored !== 'boolean' || typeof entry.rawSecretStored !== 'boolean') throw new TypeError('corpus raw-storage flags must be boolean');
    assertUtcMs(entry.retentionUntilMs, 'entry.retentionUntilMs');
    assertIdentifier(entry.reviewerId, 'entry.reviewerId');
    if (entry.validatedRegressionFixtureId !== null) assertIdentifier(entry.validatedRegressionFixtureId, 'entry.validatedRegressionFixtureId');
    if (new Set(entry.sourceEvidenceIds).size !== entry.sourceEvidenceIds.length) throw new TypeError('entry.sourceEvidenceIds must be unique');
    for (const evidenceId of entry.sourceEvidenceIds) assertIdentifier(evidenceId, 'entry.sourceEvidenceId');
    const entryFailed = entry.rawPromptStored
      || entry.rawSecretStored
      || entry.retentionUntilMs <= nowMs
      || duplicateFingerprints.has(entry.dedupFingerprint);
    const entryUnknown = entry.sourceEvidenceIds.length === 0 || entry.validatedRegressionFixtureId === null;
    if (entry.rawPromptStored) failed.push('CORPUS_RAW_PROMPT_FORBIDDEN');
    if (entry.rawSecretStored) failed.push('CORPUS_RAW_SECRET_FORBIDDEN');
    if (entry.retentionUntilMs <= nowMs) failed.push('CORPUS_RETENTION_EXPIRED');
    if (duplicateFingerprints.has(entry.dedupFingerprint)) failed.push('CORPUS_DEDUPLICATION_FAILED');
    if (entry.sourceEvidenceIds.length === 0) unknown.push('CORPUS_PROVENANCE_EVIDENCE_MISSING');
    if (entry.validatedRegressionFixtureId === null) unknown.push('CORPUS_REGRESSION_FIXTURE_MISSING');
    if (entryFailed || entryUnknown) rejected.push(entry.corpusEntryId);
    else eligible.push(entry.corpusEntryId);
  }
  return Object.freeze({ verdict: verdictFromReasons(failed, unknown), eligibleEntryIds: sortedUnique(eligible), rejectedEntryIds: sortedUnique(rejected), reasonCodes: sortedUnique([...failed, ...unknown]) });
}

export const DIAGNOSTIC_RUN_DISPOSITIONS = Object.freeze([
  'EXPLAINED_NO_ACTION',
  'REPLAY_RECORDED',
  'PROPOSAL_REJECTED',
  'PROPOSAL_PENDING_OWNER',
  'ISOLATED_PATCH_VERIFIED',
  'OWNER_HANDOFF_RECORDED',
  'PROVIDER_UNAVAILABLE',
  'BUDGET_EXHAUSTED',
] as const);
export type DiagnosticRunDisposition = (typeof DIAGNOSTIC_RUN_DISPOSITIONS)[number];

export interface DiagnosticToolAuditEntry {
  readonly toolId: string;
  readonly inputDigest: string;
  readonly resultDigest: string;
  readonly verdict: AssuranceVerdict;
}

export interface DiagnosticRunAuditRecord {
  readonly schema: 'PRODUCT_ASSURANCE_DIAGNOSTIC_RUN_AUDIT_V1';
  readonly revision: number;
  readonly runId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly providerVersion: string;
  readonly promptRevision: string;
  readonly policyRevision: string;
  readonly evidenceDigests: readonly string[];
  readonly provenanceIds: readonly string[];
  readonly retrievalIds: readonly string[];
  readonly typedOutputDigest: string;
  readonly toolEntries: readonly Readonly<DiagnosticToolAuditEntry>[];
  readonly approvalIds: readonly string[];
  readonly diffDigest: string | null;
  readonly testEvidenceIds: readonly string[];
  readonly postconditionEvidenceIds: readonly string[];
  readonly tokenUnits: number;
  readonly costMicrounits: number;
  readonly latencyMs: number;
  readonly incidentId: string;
  readonly correlationId: string;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly disposition: DiagnosticRunDisposition;
  readonly authorityGranted: false;
}

export interface DiagnosticRunAuditProjection {
  readonly verdict: AssuranceVerdict;
  readonly runId: string;
  readonly disposition: DiagnosticRunDisposition;
  readonly reasonCodes: readonly string[];
  readonly authorityGranted: false;
}

function validateUniqueIdentifiers(values: readonly string[], label: string, requireNonempty = false): void {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  if (requireNonempty && values.length === 0) throw new TypeError(`${label} must be nonempty`);
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique`);
  for (const value of values) assertIdentifier(value, `${label}[]`);
}

export function evaluateDiagnosticRunAudit(
  record: Readonly<DiagnosticRunAuditRecord>,
): Readonly<DiagnosticRunAuditProjection> {
  if (record.schema !== 'PRODUCT_ASSURANCE_DIAGNOSTIC_RUN_AUDIT_V1') throw new TypeError('diagnostic run audit schema unsupported');
  assertSafeNonNegativeInteger(record.revision, 'record.revision');
  for (const [label, value] of [
    ['runId', record.runId], ['providerId', record.providerId], ['modelId', record.modelId],
    ['providerVersion', record.providerVersion], ['promptRevision', record.promptRevision],
    ['policyRevision', record.policyRevision], ['incidentId', record.incidentId], ['correlationId', record.correlationId],
  ] as const) assertIdentifier(value, `record.${label}`);
  if (!(DIAGNOSTIC_RUN_DISPOSITIONS as readonly unknown[]).includes(record.disposition)) throw new TypeError('record.disposition unsupported');
  if (record.authorityGranted !== false) throw new TypeError('diagnostic run audit can never grant authority');
  if (!Array.isArray(record.evidenceDigests) || record.evidenceDigests.length === 0) throw new TypeError('record.evidenceDigests must be nonempty');
  for (const digest of record.evidenceDigests) {
    assertDigestOrNull(digest, 'record.evidenceDigest');
    if (digest === null) throw new TypeError('record.evidenceDigest is required');
  }
  if (new Set(record.evidenceDigests).size !== record.evidenceDigests.length) throw new TypeError('record.evidenceDigests must be unique');
  validateUniqueIdentifiers(record.provenanceIds, 'record.provenanceIds', true);
  validateUniqueIdentifiers(record.retrievalIds, 'record.retrievalIds');
  validateUniqueIdentifiers(record.approvalIds, 'record.approvalIds');
  validateUniqueIdentifiers(record.testEvidenceIds, 'record.testEvidenceIds');
  validateUniqueIdentifiers(record.postconditionEvidenceIds, 'record.postconditionEvidenceIds');
  assertDigestOrNull(record.typedOutputDigest, 'record.typedOutputDigest');
  if (record.typedOutputDigest === null) throw new TypeError('record.typedOutputDigest is required');
  assertDigestOrNull(record.diffDigest, 'record.diffDigest');
  assertSafeNonNegativeInteger(record.tokenUnits, 'record.tokenUnits');
  assertSafeNonNegativeInteger(record.costMicrounits, 'record.costMicrounits');
  assertSafeNonNegativeInteger(record.latencyMs, 'record.latencyMs');
  assertUtcMs(record.startedAtMs, 'record.startedAtMs');
  assertUtcMs(record.completedAtMs, 'record.completedAtMs');
  if (record.completedAtMs < record.startedAtMs) throw new TypeError('diagnostic run completion predates start');
  if (record.completedAtMs - record.startedAtMs !== record.latencyMs) throw new TypeError('record.latencyMs must equal completedAtMs-startedAtMs');
  const failed: string[] = [];
  const unknown: string[] = [];
  const toolIds = record.toolEntries.map((entry) => entry.toolId);
  if (new Set(toolIds).size !== toolIds.length) failed.push('DIAGNOSTIC_AUDIT_DUPLICATE_TOOL_ENTRY');
  for (const entry of record.toolEntries) {
    assertIdentifier(entry.toolId, 'record.toolEntry.toolId');
    assertDigestOrNull(entry.inputDigest, 'record.toolEntry.inputDigest');
    assertDigestOrNull(entry.resultDigest, 'record.toolEntry.resultDigest');
    if (entry.inputDigest === null || entry.resultDigest === null) throw new TypeError('diagnostic tool input/result digests are required');
    if (!(ASSURANCE_VERDICTS as readonly unknown[]).includes(entry.verdict)) throw new TypeError('record.toolEntry.verdict unsupported');
    if ((DIAGNOSTIC_FORBIDDEN_CAPABILITIES as readonly string[]).includes(entry.toolId)
      || !(DIAGNOSTIC_ALLOWED_CAPABILITY_IDS as readonly string[]).includes(entry.toolId)) failed.push('DIAGNOSTIC_AUDIT_TOOL_FORBIDDEN_OR_UNKNOWN');
    if (entry.verdict === 'FAIL') failed.push('DIAGNOSTIC_AUDIT_TOOL_FAILED');
    if (entry.verdict === 'UNKNOWN') unknown.push('DIAGNOSTIC_AUDIT_TOOL_UNKNOWN');
  }
  const patchDisposition = record.disposition === 'ISOLATED_PATCH_VERIFIED' || record.disposition === 'OWNER_HANDOFF_RECORDED';
  if (patchDisposition && record.diffDigest === null) unknown.push('DIAGNOSTIC_AUDIT_DIFF_MISSING');
  if (patchDisposition && record.testEvidenceIds.length === 0) unknown.push('DIAGNOSTIC_AUDIT_TEST_EVIDENCE_MISSING');
  if (patchDisposition && record.postconditionEvidenceIds.length === 0) unknown.push('DIAGNOSTIC_AUDIT_POSTCONDITION_EVIDENCE_MISSING');
  if (record.disposition === 'OWNER_HANDOFF_RECORDED' && record.approvalIds.length === 0) unknown.push('DIAGNOSTIC_AUDIT_APPROVAL_MISSING');
  const verdict = verdictFromReasons(failed, unknown);
  return Object.freeze({ verdict, runId: record.runId, disposition: record.disposition, reasonCodes: sortedUnique([...failed, ...unknown]), authorityGranted: false });
}

import { createHash } from 'node:crypto';
import { canonicalJson } from '../../intelligenceFoundation/contracts/ids.js';
import {
  DIAGNOSTIC_ALLOWED_CAPABILITY_IDS,
  DIAGNOSTIC_FORBIDDEN_CAPABILITIES,
  DIAGNOSTIC_PERMISSION_LEVELS,
  type DiagnosticBoundaryDecision,
  type DiagnosticPermissionLevel,
} from '../../productAssurance/diagnostics/boundary.js';
import {
  isBoundedIdentifier,
  isExactIdentityRole,
  isExactProviderConfigurationState,
  isGitCommitSha,
  isLowercaseSha256,
  isPlainRecord,
  type AiOpsIdentityRole,
  type ProviderConfigurationState,
} from './contracts.js';
import { AI_IDENTITY_MATRIX } from './providerMatrix.js';
import { A3_EXCLUSIVE_PATCH_ROOTS } from './patchWorker.js';
import {
  normalizeStrictSchemaDefinition,
  snapshotStrictValueForSchema,
  strictObject,
  validateStrictSchemaDefinition,
  validateStrictValue,
  type ObjectSchema,
  type StrictSchema,
} from './strictSchema.js';

export const A3_TOOL_IDS = Object.freeze([
  'getSupervisorSnapshot',
  'getIncidentEvidence',
  'queryMetrics',
  'queryTraces',
  'queryStructuredLogs',
  'getFailureAtlasMatches',
  'getRunbook',
  'runReadOnlyReplay',
  'runApprovedWebResearch',
  'createTypedProposal',
  'createIsolatedPatchTask',
  'runSandboxGate',
  'requestApproval',
] as const);

export type A3ToolId = (typeof A3_TOOL_IDS)[number];
export type ToolEffectClass = 'READ_ONLY' | 'PROPOSAL_ONLY' | 'CLASS_C_ISOLATED_ONLY';

export interface A3ToolDescriptor {
  readonly schema: 'AI_OPS_TOOL_DESCRIPTOR_V1';
  readonly toolId: A3ToolId;
  readonly version: 1;
  readonly owner: string;
  readonly enabled: boolean;
  readonly allowedRoles: readonly AiOpsIdentityRole[];
  readonly requiredPermission: DiagnosticPermissionLevel;
  readonly requiredCapability: string;
  readonly effectClass: ToolEffectClass;
  readonly allowedModes: readonly ProviderConfigurationState[];
  readonly dataClassification: 'REDACTED_INTERNAL_ONLY';
  readonly redactionPolicy: 'REDACTION_RECEIPT_REQUIRED';
  readonly resourceScope: 'EXACT_CASE_BOUND_RESOURCE_IDS';
  readonly environmentAllowlist: readonly string[];
  readonly pathAllowlist: readonly string[];
  readonly networkAllowlist: readonly [];
  readonly timeoutMs: number;
  readonly maximumCallsPerRun: number;
  readonly maximumCostMicrounits: number;
  readonly maximumInputBytes: number;
  readonly maximumOutputBytes: number;
  readonly maximumRows: number;
  readonly approvalRequirement: 'CANONICAL_OWNER_POLICY' | 'CANONICAL_OWNER_POLICY_AND_HUMAN_APPROVAL';
  readonly approvalTtlMs: number;
  readonly sandboxProcessIdentity: 'ROLE_SPECIFIC_WORKLOAD_IDENTITY_REQUIRED';
  readonly preconditions: readonly string[];
  readonly postconditions: readonly string[];
  readonly auditEvidenceFields: readonly string[];
  readonly inputSchema: Readonly<ObjectSchema>;
  readonly outputSchema: Readonly<ObjectSchema>;
}

export interface ToolCallAdmissionRequest {
  readonly schema: 'AI_OPS_TOOL_CALL_ADMISSION_REQUEST_V1';
  readonly requestId: string;
  readonly toolId: string;
  readonly toolVersion: number;
  readonly role: AiOpsIdentityRole;
  readonly principalId: string;
  readonly providerId: string;
  readonly providerRevision: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly promptRevision: string;
  readonly toolRevision: string;
  readonly controlRevision: string;
  readonly runId: string;
  readonly parentRunId: string | null;
  readonly mode: ProviderConfigurationState;
  readonly environmentId: string;
  readonly repositoryRevision: string | null;
  readonly pathScope: readonly string[];
  readonly resourceIds: readonly string[];
  readonly caseId: string;
  readonly evidenceDigest: string;
  readonly evidenceBundleDigest: string;
  readonly actionArtifactDigest: string | null;
  readonly capitalExposureState: 'NOT_APPLICABLE_DIAGNOSTIC_ONLY';
  readonly riskClass: 'READ_ONLY' | 'PROPOSAL' | 'CLASS_C_ISOLATED';
  readonly reversible: boolean;
  readonly maximumBlastRadius: string;
  readonly attemptBudget: number;
  readonly concurrencyBudget: number;
  readonly tokenBudget: number;
  readonly costBudgetMicrounits: number;
  readonly requiredApproverIds: readonly string[];
  readonly input: unknown;
  readonly requestedPermission: DiagnosticPermissionLevel;
  readonly requestedCapabilities: readonly string[];
  readonly hookPhase: 'PRE_TOOL_USE';
  readonly bypassRequested: boolean;
}

export interface ToolPolicyEvidence {
  readonly schema: 'AI_OPS_TOOL_POLICY_EVIDENCE_V1';
  readonly decision: 'ALLOW' | 'DENY' | 'UNAVAILABLE';
  readonly signatureVerified: boolean;
  readonly canonicalOwnerEvidenceVerified: boolean;
  readonly canonicalOwnerEvidenceDigest: string;
  readonly ownerBoundaryDecision: Readonly<DiagnosticBoundaryDecision>;
  readonly requestId: string;
  readonly caseId: string;
  readonly role: AiOpsIdentityRole;
  readonly toolId: string;
  readonly toolVersion: 1;
  readonly principalId: string;
  readonly providerId: string;
  readonly providerRevision: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly promptRevision: string;
  readonly toolRevision: string;
  readonly controlRevision: string;
  readonly runId: string;
  readonly parentRunId: string | null;
  readonly mode: ProviderConfigurationState;
  readonly environmentId: string;
  readonly repositoryRevision: string | null;
  readonly pathScope: readonly string[];
  readonly resourceIds: readonly string[];
  readonly evidenceDigest: string;
  readonly evidenceBundleDigest: string;
  readonly actionArtifactDigest: string | null;
  readonly registeredActionId: string | null;
  readonly registeredActionRegistryDigest: string | null;
  readonly registeredActionMembershipVerified: boolean;
  readonly capitalExposureState: 'NOT_APPLICABLE_DIAGNOSTIC_ONLY';
  readonly riskClass: 'READ_ONLY' | 'PROPOSAL' | 'CLASS_C_ISOLATED';
  readonly reversible: boolean;
  readonly maximumBlastRadius: string;
  readonly attemptBudget: number;
  readonly concurrencyBudget: number;
  readonly tokenBudget: number;
  readonly costBudgetMicrounits: number;
  readonly requiredApproverIds: readonly string[];
  readonly requiredPermission: DiagnosticPermissionLevel;
  readonly requiredCapability: string;
  readonly registryDigest: string;
  readonly inputDigest: string;
  readonly policyRevision: string;
  readonly validFromMs: number;
  readonly expiresAtMs: number;
  readonly childCapabilities: readonly string[];
  readonly childGrantMode: 'EXACT_EXPLICIT';
  readonly hardDenialResult: 'NONE' | 'DENY';
  readonly durableAuditAvailable: boolean;
}

export interface ToolCallAdmissionDecision {
  readonly schema: 'AI_OPS_TOOL_CALL_ADMISSION_DECISION_V1';
  readonly allowed: boolean;
  readonly authorityGranted: false;
  readonly disposition: 'ADMIT_TO_EXTERNAL_EXECUTOR_PORT' | 'DENY' | 'UNREGISTERED_PROPOSAL';
  readonly toolId: string;
  readonly requestId: string | null;
  readonly caseId: string | null;
  readonly role: AiOpsIdentityRole | null;
  readonly principalId: string | null;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly runId: string | null;
  readonly mode: ProviderConfigurationState | null;
  readonly environmentId: string | null;
  readonly inputDigest: string | null;
  readonly policyRevision: string | null;
  readonly reasonCodes: readonly string[];
}

const IDENTIFIER_SCHEMA = Object.freeze({ type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' } as const);
const DIGEST_SCHEMA = Object.freeze({ type: 'string', pattern: '^[a-f0-9]{64}$' } as const);
const GIT_SHA_SCHEMA = Object.freeze({ type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' } as const);
const BOUNDED_TEXT_SCHEMA = Object.freeze({ type: 'string', minLength: 1, maxLength: 2_000 } as const);
const STRING_LIST_SCHEMA = Object.freeze({ type: 'array', items: IDENTIFIER_SCHEMA, maxItems: 64, uniqueItems: true } as const);
const PATCH_ROOT_LIST_SCHEMA = Object.freeze({
  type: 'array',
  items: Object.freeze({ type: 'string', enum: A3_EXCLUSIVE_PATCH_ROOTS } as const),
  minItems: 1,
  maxItems: A3_EXCLUSIVE_PATCH_ROOTS.length,
  uniqueItems: true,
} as const);

const STANDARD_INPUT_SCHEMA = strictObject({
  caseId: IDENTIFIER_SCHEMA,
  evidenceDigest: DIGEST_SCHEMA,
  requestId: IDENTIFIER_SCHEMA,
});

const SUPERVISOR_INPUT_SCHEMA = strictObject({
  atRevision: IDENTIFIER_SCHEMA,
  caseId: IDENTIFIER_SCHEMA,
  evidenceDigest: DIGEST_SCHEMA,
  requestId: IDENTIFIER_SCHEMA,
  scope: Object.freeze({ type: 'string', enum: Object.freeze(['CORE', 'AI_OPS', 'CASE']) } as const),
});

const INCIDENT_INPUT_SCHEMA = strictObject({
  bundleHash: DIGEST_SCHEMA,
  caseId: IDENTIFIER_SCHEMA,
  evidenceDigest: DIGEST_SCHEMA,
  incidentId: IDENTIFIER_SCHEMA,
  requestId: IDENTIFIER_SCHEMA,
});

const BOUNDED_QUERY_INPUT_SCHEMA = strictObject({
  boundedParamIds: STRING_LIST_SCHEMA,
  caseId: IDENTIFIER_SCHEMA,
  evidenceDigest: DIGEST_SCHEMA,
  queryTemplateId: IDENTIFIER_SCHEMA,
  requestId: IDENTIFIER_SCHEMA,
});

const TRACE_INPUT_SCHEMA = strictObject({
  caseId: IDENTIFIER_SCHEMA,
  evidenceDigest: DIGEST_SCHEMA,
  requestId: IDENTIFIER_SCHEMA,
  traceIds: STRING_LIST_SCHEMA,
});

const ATLAS_INPUT_SCHEMA = strictObject({
  caseId: IDENTIFIER_SCHEMA,
  evidenceDigest: DIGEST_SCHEMA,
  fingerprint: DIGEST_SCHEMA,
  requestId: IDENTIFIER_SCHEMA,
});

const RUNBOOK_INPUT_SCHEMA = strictObject({
  caseId: IDENTIFIER_SCHEMA,
  evidenceDigest: DIGEST_SCHEMA,
  requestId: IDENTIFIER_SCHEMA,
  revision: IDENTIFIER_SCHEMA,
  runbookId: IDENTIFIER_SCHEMA,
});

const REPLAY_INPUT_SCHEMA = strictObject({
  caseId: IDENTIFIER_SCHEMA,
  evidenceDigest: DIGEST_SCHEMA,
  maximumDurationMs: Object.freeze({ type: 'integer', minimum: 1, maximum: 30_000 } as const),
  maximumRows: Object.freeze({ type: 'integer', minimum: 1, maximum: 1_000 } as const),
  replayFixtureId: IDENTIFIER_SCHEMA,
  requestId: IDENTIFIER_SCHEMA,
});

const WEB_RESEARCH_INPUT_SCHEMA = strictObject({
  caseId: IDENTIFIER_SCHEMA,
  domainPolicyId: IDENTIFIER_SCHEMA,
  evidenceDigest: DIGEST_SCHEMA,
  query: BOUNDED_TEXT_SCHEMA,
  requestId: IDENTIFIER_SCHEMA,
});

const PROPOSAL_INPUT_SCHEMA = strictObject({
  artifactDigest: DIGEST_SCHEMA,
  attemptBudget: Object.freeze({ type: 'integer', minimum: 1, maximum: 3 } as const),
  blastRadius: IDENTIFIER_SCHEMA,
  caseId: IDENTIFIER_SCHEMA,
  createdAtMs: Object.freeze({ type: 'integer', minimum: 0 } as const),
  evidenceDigest: DIGEST_SCHEMA,
  exactTargetResourceIds: STRING_LIST_SCHEMA,
  expectedPostconditions: STRING_LIST_SCHEMA,
  expiresAtMs: Object.freeze({ type: 'integer', minimum: 0 } as const),
  incidentId: IDENTIFIER_SCHEMA,
  independentVerifierId: IDENTIFIER_SCHEMA,
  maximumEffect: IDENTIFIER_SCHEMA,
  preconditions: STRING_LIST_SCHEMA,
  proposalId: IDENTIFIER_SCHEMA,
  providerId: IDENTIFIER_SCHEMA,
  providerRevision: IDENTIFIER_SCHEMA,
  modelId: IDENTIFIER_SCHEMA,
  modelRevision: IDENTIFIER_SCHEMA,
  promptRevision: IDENTIFIER_SCHEMA,
  toolRevision: IDENTIFIER_SCHEMA,
  policyRevision: IDENTIFIER_SCHEMA,
  controlRevision: IDENTIFIER_SCHEMA,
  rationale: BOUNDED_TEXT_SCHEMA,
  registeredActionId: IDENTIFIER_SCHEMA,
  requestId: IDENTIFIER_SCHEMA,
  requestedCapability: IDENTIFIER_SCHEMA,
  requiredApprovalPrincipalId: IDENTIFIER_SCHEMA,
  rollbackOrCompensationId: IDENTIFIER_SCHEMA,
  supportingEvidenceHashes: Object.freeze({ type: 'array', items: DIGEST_SCHEMA, maxItems: 64, uniqueItems: true } as const),
});

const PATCH_INPUT_SCHEMA = strictObject({
  artifactDigest: DIGEST_SCHEMA,
  caseId: IDENTIFIER_SCHEMA,
  evidenceDigest: DIGEST_SCHEMA,
  repositoryRevision: GIT_SHA_SCHEMA,
  requestId: IDENTIFIER_SCHEMA,
  scopeRoots: PATCH_ROOT_LIST_SCHEMA,
});

const SANDBOX_GATE_INPUT_SCHEMA = strictObject({
  caseId: IDENTIFIER_SCHEMA,
  evidenceDigest: DIGEST_SCHEMA,
  gateId: IDENTIFIER_SCHEMA,
  patchHash: DIGEST_SCHEMA,
  requestId: IDENTIFIER_SCHEMA,
});

const APPROVAL_INPUT_SCHEMA = strictObject({
  artifactDigest: DIGEST_SCHEMA,
  capability: IDENTIFIER_SCHEMA,
  caseId: IDENTIFIER_SCHEMA,
  evidenceDigest: DIGEST_SCHEMA,
  expiresAtMs: Object.freeze({ type: 'integer', minimum: 0 } as const),
  requestId: IDENTIFIER_SCHEMA,
});

const TOOL_OUTPUT_SCHEMA = strictObject({
  caseId: IDENTIFIER_SCHEMA,
  environmentId: IDENTIFIER_SCHEMA,
  evidenceRefs: STRING_LIST_SCHEMA,
  inputDigest: DIGEST_SCHEMA,
  mode: IDENTIFIER_SCHEMA,
  modelId: IDENTIFIER_SCHEMA,
  policyRevision: IDENTIFIER_SCHEMA,
  principalId: IDENTIFIER_SCHEMA,
  providerId: IDENTIFIER_SCHEMA,
  requestId: IDENTIFIER_SCHEMA,
  resultDigest: DIGEST_SCHEMA,
  role: IDENTIFIER_SCHEMA,
  runId: IDENTIFIER_SCHEMA,
  status: Object.freeze({ type: 'string', enum: Object.freeze(['COMPLETED', 'BLOCKED', 'FAILED']) } as const),
  toolId: IDENTIFIER_SCHEMA,
});

const DIAGNOSTIC_ROLES = Object.freeze(['RUNTIME_DIAGNOSTICIAN', 'ENGINEERING_REPAIR_WORKER', 'INDEPENDENT_VERIFIER'] as const);
const RUNTIME_AND_REPAIR = Object.freeze(['RUNTIME_DIAGNOSTICIAN', 'ENGINEERING_REPAIR_WORKER'] as const);

function descriptor(
  toolId: A3ToolId,
  owner: string,
  allowedRoles: readonly AiOpsIdentityRole[],
  requiredPermission: DiagnosticPermissionLevel,
  requiredCapability: string,
  effectClass: ToolEffectClass,
  inputSchema: Readonly<ObjectSchema> = STANDARD_INPUT_SCHEMA,
): Readonly<A3ToolDescriptor> {
  const mutatingProposal = effectClass !== 'READ_ONLY';
  return Object.freeze({
    schema: 'AI_OPS_TOOL_DESCRIPTOR_V1',
    toolId,
    version: 1,
    owner,
    enabled: false,
    allowedRoles: Object.freeze([...allowedRoles]),
    requiredPermission,
    requiredCapability,
    effectClass,
    allowedModes: Object.freeze(['SUBSCRIPTION_CODEX_WORKER', 'SUBSCRIPTION_CLAUDE_CODE_WORKER', 'API_CONFIGURED'] as const),
    dataClassification: 'REDACTED_INTERNAL_ONLY',
    redactionPolicy: 'REDACTION_RECEIPT_REQUIRED',
    resourceScope: 'EXACT_CASE_BOUND_RESOURCE_IDS',
    environmentAllowlist: Object.freeze(effectClass === 'CLASS_C_ISOLATED_ONLY' ? ['ISOLATED_PATCH_WORKTREE'] : ['ISOLATED_DIAGNOSTIC_PLANE']),
    pathAllowlist: Object.freeze(effectClass === 'CLASS_C_ISOLATED_ONLY' ? [
      'server/src/aiOps/providerAdapters',
      'fixtures/aiOps/providerAdapters',
      'test/aiOps/providerAdapters',
    ] : []),
    networkAllowlist: Object.freeze([]) as readonly [],
    timeoutMs: effectClass === 'CLASS_C_ISOLATED_ONLY' ? 300_000 : 30_000,
    maximumCallsPerRun: effectClass === 'READ_ONLY' ? 8 : 1,
    maximumCostMicrounits: 0,
    maximumInputBytes: 65_536,
    maximumOutputBytes: 1_048_576,
    maximumRows: effectClass === 'READ_ONLY' ? 1_000 : 1,
    approvalRequirement: mutatingProposal ? 'CANONICAL_OWNER_POLICY_AND_HUMAN_APPROVAL' : 'CANONICAL_OWNER_POLICY',
    approvalTtlMs: mutatingProposal ? 300_000 : 60_000,
    sandboxProcessIdentity: 'ROLE_SPECIFIC_WORKLOAD_IDENTITY_REQUIRED',
    preconditions: Object.freeze(['SIGNED_CURRENT_POLICY', 'REDACTION_RECEIPT', 'DURABLE_AUDIT_AVAILABLE']),
    postconditions: Object.freeze(['STRICT_OUTPUT_SCHEMA', 'EVIDENCE_DIGEST_RECORDED', 'NO_AUTHORITY_EXPANSION']),
    auditEvidenceFields: Object.freeze(['requestId', 'caseId', 'principalId', 'toolId', 'inputDigest', 'policyRevision', 'resultDigest']),
    inputSchema,
    outputSchema: TOOL_OUTPUT_SCHEMA,
  });
}

export const A3_TOOL_REGISTRY: readonly Readonly<A3ToolDescriptor>[] = Object.freeze([
  descriptor('getSupervisorSnapshot', 'systemIntegration-read-model-owner', DIAGNOSTIC_ROLES, 'OBSERVE_EXPLAIN', 'READ_REDACTED_EVIDENCE', 'READ_ONLY', SUPERVISOR_INPUT_SCHEMA),
  descriptor('getIncidentEvidence', 'productIntegration-incident-owner', DIAGNOSTIC_ROLES, 'OBSERVE_EXPLAIN', 'READ_REDACTED_EVIDENCE', 'READ_ONLY', INCIDENT_INPUT_SCHEMA),
  descriptor('queryMetrics', 'telemetry-owner-pending', DIAGNOSTIC_ROLES, 'BOUNDED_QUERY_REPLAY', 'QUERY_BOUNDED_EVIDENCE', 'READ_ONLY', BOUNDED_QUERY_INPUT_SCHEMA),
  descriptor('queryTraces', 'telemetry-owner-pending', DIAGNOSTIC_ROLES, 'BOUNDED_QUERY_REPLAY', 'QUERY_BOUNDED_EVIDENCE', 'READ_ONLY', TRACE_INPUT_SCHEMA),
  descriptor('queryStructuredLogs', 'telemetry-owner-pending', DIAGNOSTIC_ROLES, 'BOUNDED_QUERY_REPLAY', 'QUERY_BOUNDED_EVIDENCE', 'READ_ONLY', BOUNDED_QUERY_INPUT_SCHEMA),
  descriptor('getFailureAtlasMatches', 'intelligenceFoundation-owner', DIAGNOSTIC_ROLES, 'OBSERVE_EXPLAIN', 'EXPLAIN_CAUSAL_CHAIN', 'READ_ONLY', ATLAS_INPUT_SCHEMA),
  descriptor('getRunbook', 'managed-inventory-owner-pending', DIAGNOSTIC_ROLES, 'OBSERVE_EXPLAIN', 'READ_REDACTED_EVIDENCE', 'READ_ONLY', RUNBOOK_INPUT_SCHEMA),
  descriptor('runReadOnlyReplay', 'foundation-replay-owner', DIAGNOSTIC_ROLES, 'BOUNDED_QUERY_REPLAY', 'RUN_ISOLATED_REPLAY', 'READ_ONLY', REPLAY_INPUT_SCHEMA),
  descriptor('runApprovedWebResearch', 'egress-policy-owner-pending', Object.freeze(['RUNTIME_DIAGNOSTICIAN']), 'BOUNDED_QUERY_REPLAY', 'QUERY_BOUNDED_EVIDENCE', 'READ_ONLY', WEB_RESEARCH_INPUT_SCHEMA),
  descriptor('createTypedProposal', 'productAssurance-diagnostic-boundary-owner', RUNTIME_AND_REPAIR, 'PROPOSE_TYPED_ACTION', 'PROPOSE_REGISTERED_REMEDIATION', 'PROPOSAL_ONLY', PROPOSAL_INPUT_SCHEMA),
  descriptor('createIsolatedPatchTask', 'isolated-worktree-owner-pending', Object.freeze(['ENGINEERING_REPAIR_WORKER']), 'PATCH_ISOLATED_AND_TEST', 'PROPOSE_ISOLATED_PATCH', 'CLASS_C_ISOLATED_ONLY', PATCH_INPUT_SCHEMA),
  descriptor('runSandboxGate', 'foundation-replay-owner', Object.freeze(['ENGINEERING_REPAIR_WORKER']), 'PATCH_ISOLATED_AND_TEST', 'RUN_ISOLATED_TESTS', 'CLASS_C_ISOLATED_ONLY', SANDBOX_GATE_INPUT_SCHEMA),
  descriptor('requestApproval', 'systemIntegration-control-owner', Object.freeze([]), 'OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY', 'REQUEST_OWNER_HANDOFF', 'PROPOSAL_ONLY', APPROVAL_INPUT_SCHEMA),
]);

const TOOL_DESCRIPTOR_KEYS = Object.freeze([
  'schema', 'toolId', 'version', 'owner', 'enabled', 'allowedRoles', 'requiredPermission', 'requiredCapability', 'effectClass',
  'allowedModes', 'dataClassification', 'redactionPolicy', 'resourceScope', 'environmentAllowlist', 'pathAllowlist', 'networkAllowlist',
  'timeoutMs', 'maximumCallsPerRun', 'maximumCostMicrounits', 'maximumInputBytes', 'maximumOutputBytes', 'maximumRows',
  'approvalRequirement', 'approvalTtlMs', 'sandboxProcessIdentity', 'preconditions', 'postconditions', 'auditEvidenceFields',
  'inputSchema', 'outputSchema',
]);

function snapshotStrictSchema(value: unknown): Readonly<StrictSchema> | null {
  return normalizeStrictSchemaDefinition(value);
}

function snapshotToolDescriptor(value: unknown): Readonly<A3ToolDescriptor> | null {
  const record = snapshotDataRecord(value, TOOL_DESCRIPTOR_KEYS);
  if (record === null) return null;
  const allowedRoles = snapshotStringList(record.allowedRoles, AI_IDENTITY_MATRIX.length);
  const allowedModes = snapshotStringList(record.allowedModes, 5);
  const environmentAllowlist = snapshotStringList(record.environmentAllowlist, 16);
  const pathAllowlist = snapshotStringList(record.pathAllowlist, A3_EXCLUSIVE_PATCH_ROOTS.length);
  const networkAllowlist = snapshotBoundedDataArray(record.networkAllowlist, 0);
  const preconditions = snapshotStringList(record.preconditions, 16);
  const postconditions = snapshotStringList(record.postconditions, 16);
  const auditEvidenceFields = snapshotStringList(record.auditEvidenceFields, 32);
  const inputSchema = snapshotStrictSchema(record.inputSchema);
  const outputSchema = snapshotStrictSchema(record.outputSchema);
  if (
    allowedRoles === null
    || allowedModes === null
    || environmentAllowlist === null
    || pathAllowlist === null
    || networkAllowlist === null
    || preconditions === null
    || postconditions === null
    || auditEvidenceFields === null
    || inputSchema === null
    || inputSchema.type !== 'object'
    || outputSchema === null
    || outputSchema.type !== 'object'
  ) return null;
  return Object.freeze({
    ...record,
    allowedRoles: Object.freeze(allowedRoles),
    allowedModes: Object.freeze(allowedModes),
    environmentAllowlist: Object.freeze(environmentAllowlist),
    pathAllowlist: Object.freeze(pathAllowlist),
    networkAllowlist: Object.freeze(networkAllowlist) as readonly [],
    preconditions: Object.freeze(preconditions),
    postconditions: Object.freeze(postconditions),
    auditEvidenceFields: Object.freeze(auditEvidenceFields),
    inputSchema,
    outputSchema,
  } as unknown as A3ToolDescriptor);
}

function snapshotToolRegistry(value: unknown): readonly Readonly<A3ToolDescriptor>[] | null {
  const rows = snapshotBoundedDataArray(value, A3_TOOL_IDS.length);
  if (rows === null) return null;
  const snapshot: Readonly<A3ToolDescriptor>[] = [];
  for (const row of rows) {
    const normalized = snapshotToolDescriptor(row);
    if (normalized === null) return null;
    snapshot.push(normalized);
  }
  return Object.freeze(snapshot);
}

export function toolRegistryDigest(registry: readonly Readonly<A3ToolDescriptor>[] = A3_TOOL_REGISTRY): string {
  const snapshot = snapshotToolRegistry(registry);
  if (snapshot === null) throw new Error('tool registry must be a bounded closed data snapshot');
  return createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
}

export function toolInputDigest(toolId: string, input: unknown): string {
  return createHash('sha256').update(canonicalJson({ toolId, input })).digest('hex');
}

export function validateToolRegistry(registry: readonly Readonly<A3ToolDescriptor>[] = A3_TOOL_REGISTRY): readonly string[] {
  const issues: string[] = [];
  const registrySnapshot = snapshotToolRegistry(registry);
  if (registrySnapshot === null || registrySnapshot.length !== A3_TOOL_IDS.length) {
    return Object.freeze(['TOOL_REGISTRY_PATH_SET_INVALID']);
  }
  const observedIds: string[] = [];
  for (let index = 0; index < registrySnapshot.length; index += 1) {
    const candidate = registrySnapshot[index];
    if (!hasExactKeys(candidate, TOOL_DESCRIPTOR_KEYS)) {
      issues.push(`TOOL_DESCRIPTOR_SCHEMA_NOT_CLOSED:${index}`);
      continue;
    }
    const row = candidate as unknown as Readonly<A3ToolDescriptor>;
    try {
    observedIds.push(row.toolId);
    if (!(A3_TOOL_IDS as readonly string[]).includes(row.toolId)) issues.push(`UNKNOWN_TOOL_ID:${row.toolId}`);
    if (row.schema !== 'AI_OPS_TOOL_DESCRIPTOR_V1' || row.version !== 1) issues.push(`TOOL_DESCRIPTOR_VERSION_INVALID:${row.toolId}`);
    if (!isBoundedIdentifier(row.owner)) issues.push(`INVALID_OWNER:${row.toolId}`);
    if (typeof row.enabled !== 'boolean') issues.push(`TOOL_ENABLED_FLAG_INVALID:${row.toolId}`);
    if (!(DIAGNOSTIC_PERMISSION_LEVELS as readonly string[]).includes(row.requiredPermission)) issues.push(`TOOL_PERMISSION_INVALID:${row.toolId}`);
    if (!(DIAGNOSTIC_ALLOWED_CAPABILITY_IDS as readonly string[]).includes(row.requiredCapability)) {
      issues.push(`CAPABILITY_NOT_OWNED_BY_DIAGNOSTIC_BOUNDARY:${row.toolId}`);
    }
    if ((DIAGNOSTIC_FORBIDDEN_CAPABILITIES as readonly string[]).includes(row.requiredCapability)) {
      issues.push(`FORBIDDEN_CAPABILITY:${row.toolId}`);
    }
    if (!validateStrictSchemaDefinition(row.inputSchema).valid) issues.push(`INPUT_SCHEMA_NOT_STRICT:${row.toolId}`);
    if (!validateStrictSchemaDefinition(row.outputSchema).valid) issues.push(`OUTPUT_SCHEMA_NOT_STRICT:${row.toolId}`);
    if (!(['READ_ONLY', 'PROPOSAL_ONLY', 'CLASS_C_ISOLATED_ONLY'] as const).includes(row.effectClass)) issues.push(`TOOL_EFFECT_CLASS_INVALID:${row.toolId}`);
    const expectedModes = ['SUBSCRIPTION_CODEX_WORKER', 'SUBSCRIPTION_CLAUDE_CODE_WORKER', 'API_CONFIGURED'];
    if (!sameStringSet(row.allowedModes, expectedModes)) issues.push(`TOOL_MODE_SET_INVALID:${row.toolId}`);
    if (row.dataClassification !== 'REDACTED_INTERNAL_ONLY'
      || row.redactionPolicy !== 'REDACTION_RECEIPT_REQUIRED'
      || row.resourceScope !== 'EXACT_CASE_BOUND_RESOURCE_IDS') issues.push(`TOOL_DATA_POLICY_INVALID:${row.toolId}`);
    const expectedEnvironment = row.effectClass === 'CLASS_C_ISOLATED_ONLY' ? ['ISOLATED_PATCH_WORKTREE'] : ['ISOLATED_DIAGNOSTIC_PLANE'];
    if (!sameStringSet(row.environmentAllowlist, expectedEnvironment)) issues.push(`TOOL_ENVIRONMENT_ALLOWLIST_INVALID:${row.toolId}`);
    const expectedPaths = row.effectClass === 'CLASS_C_ISOLATED_ONLY' ? A3_EXCLUSIVE_PATCH_ROOTS : [];
    if (!sameStringSet(row.pathAllowlist, expectedPaths)) issues.push(`TOOL_PATH_ALLOWLIST_INVALID:${row.toolId}`);
    if (!Number.isSafeInteger(row.timeoutMs) || row.timeoutMs <= 0 || row.timeoutMs > 300_000) issues.push(`TIMEOUT_BOUND_INVALID:${row.toolId}`);
    if (!Number.isSafeInteger(row.maximumCallsPerRun) || row.maximumCallsPerRun < 1 || row.maximumCallsPerRun > 8) issues.push(`RATE_BOUND_INVALID:${row.toolId}`);
    if (row.maximumCostMicrounits !== 0) issues.push(`SHADOW_COST_BUDGET_NOT_ZERO:${row.toolId}`);
    if (!Array.isArray(row.networkAllowlist) || row.networkAllowlist.length !== 0) issues.push(`SHADOW_NETWORK_ALLOWLIST_NOT_EMPTY:${row.toolId}`);
    if (!Number.isSafeInteger(row.maximumInputBytes) || row.maximumInputBytes < 1 || row.maximumInputBytes > 65_536
      || !Number.isSafeInteger(row.maximumOutputBytes) || row.maximumOutputBytes < 1 || row.maximumOutputBytes > 1_048_576
      || !Number.isSafeInteger(row.maximumRows) || row.maximumRows < 1 || row.maximumRows > 1_000) issues.push(`TOOL_DATA_BOUND_INVALID:${row.toolId}`);
    const expectedApproval = row.effectClass === 'READ_ONLY' ? 'CANONICAL_OWNER_POLICY' : 'CANONICAL_OWNER_POLICY_AND_HUMAN_APPROVAL';
    if (row.approvalRequirement !== expectedApproval || !Number.isSafeInteger(row.approvalTtlMs) || row.approvalTtlMs < 1 || row.approvalTtlMs > 300_000) {
      issues.push(`TOOL_APPROVAL_POLICY_INVALID:${row.toolId}`);
    }
    if (row.sandboxProcessIdentity !== 'ROLE_SPECIFIC_WORKLOAD_IDENTITY_REQUIRED') issues.push(`TOOL_SANDBOX_IDENTITY_INVALID:${row.toolId}`);
    for (const [label, values, maximum] of [
      ['PRECONDITIONS', row.preconditions, 16],
      ['POSTCONDITIONS', row.postconditions, 16],
      ['AUDIT_FIELDS', row.auditEvidenceFields, 32],
    ] as const) {
      const snapshot = snapshotStringList(values, maximum);
      if (snapshot === null || snapshot.length === 0 || snapshot.some((value) => !isBoundedIdentifier(value)) || new Set(snapshot).size !== snapshot.length) {
        issues.push(`TOOL_${label}_INVALID:${row.toolId}`);
      }
    }
    const allowedRolesSnapshot = snapshotStringList(row.allowedRoles, AI_IDENTITY_MATRIX.length);
    const allowedRoles = (allowedRolesSnapshot ?? []) as readonly AiOpsIdentityRole[];
    if (allowedRolesSnapshot === null || allowedRoles.some((role) => !isExactIdentityRole(role))) issues.push(`TOOL_ROLE_INVALID:${row.toolId}`);
    if (row.toolId === 'requestApproval') {
      if (allowedRoles.length !== 0) issues.push('OWNER_APPROVAL_TOOL_MUST_HAVE_NO_AI_ROLE');
    } else if (allowedRoles.length === 0) issues.push(`TOOL_HAS_NO_ELIGIBLE_IDENTITY:${row.toolId}`);
    for (const role of allowedRoles) {
      const identity = AI_IDENTITY_MATRIX.find((candidate) => candidate.role === role);
      if (identity === undefined) {
        issues.push(`TOOL_ROLE_NOT_REGISTERED:${row.toolId}:${role}`);
        continue;
      }
      const requiredRank = DIAGNOSTIC_PERMISSION_LEVELS.indexOf(row.requiredPermission);
      const maximumRank = DIAGNOSTIC_PERMISSION_LEVELS.indexOf(identity.maximumPermission);
      if (requiredRank < 0 || maximumRank < requiredRank || !identity.allowedCapabilities.includes(row.requiredCapability)) {
        issues.push(`TOOL_ROLE_CEILING_MISMATCH:${row.toolId}:${role}`);
      }
    }
    } catch {
      issues.push(`TOOL_DESCRIPTOR_RUNTIME_REJECTED:${index}`);
    }
  }
  if (new Set(observedIds).size !== observedIds.length) issues.push('DUPLICATE_TOOL_ID');
  if (!sameStringSet(observedIds, A3_TOOL_IDS)) issues.push('TOOL_REGISTRY_PATH_SET_INVALID');
  return Object.freeze(issues);
}

function sameStringSet(left: unknown, right: unknown): boolean {
  const leftSnapshot = snapshotStringList(left, 64);
  const rightSnapshot = snapshotStringList(right, 64);
  if (leftSnapshot === null || rightSnapshot === null) return false;
  if (new Set(leftSnapshot).size !== leftSnapshot.length || new Set(rightSnapshot).size !== rightSnapshot.length) return false;
  return [...leftSnapshot].sort().join('\u0000') === [...rightSnapshot].sort().join('\u0000');
}

function snapshotBoundedDataArray(value: unknown, maximum: number): readonly unknown[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const preliminaryLengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (preliminaryLengthDescriptor === undefined || !Object.prototype.hasOwnProperty.call(preliminaryLengthDescriptor, 'value')) return null;
    const preliminaryLength = preliminaryLengthDescriptor.value;
    if (!Number.isSafeInteger(preliminaryLength) || preliminaryLength < 0 || preliminaryLength > maximum) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const lengthDescriptor = descriptors['length'];
    if (lengthDescriptor === undefined || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')) return null;
    const length = lengthDescriptor.value;
    if (length !== preliminaryLength || Reflect.ownKeys(descriptors).some((key) => typeof key === 'symbol') || Object.keys(descriptors).length !== length + 1) return null;
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
}

function snapshotStringList(value: unknown, maximum: number): readonly string[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const preliminaryLengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (preliminaryLengthDescriptor === undefined || !Object.prototype.hasOwnProperty.call(preliminaryLengthDescriptor, 'value')) return null;
    const length = preliminaryLengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const finalLengthDescriptor = descriptors['length'];
    if (finalLengthDescriptor === undefined || !Object.prototype.hasOwnProperty.call(finalLengthDescriptor, 'value')
      || finalLengthDescriptor.value !== length || Reflect.ownKeys(descriptors).some((key) => typeof key === 'symbol')
      || Object.keys(descriptors).length !== length + 1) return null;
    const snapshot: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || typeof descriptor.value !== 'string') return null;
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
}

function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
  try {
    if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
    return Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000');
  } catch {
    return false;
  }
}

function snapshotDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> | null {
  try {
    if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) return null;
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

const TOOL_REQUEST_KEYS = Object.freeze([
  'schema', 'requestId', 'toolId', 'toolVersion', 'role', 'principalId', 'providerId', 'providerRevision', 'modelId', 'modelRevision',
  'promptRevision', 'toolRevision', 'controlRevision', 'runId', 'parentRunId', 'mode',
  'environmentId', 'repositoryRevision', 'pathScope', 'resourceIds', 'caseId', 'evidenceDigest', 'evidenceBundleDigest', 'actionArtifactDigest', 'capitalExposureState', 'riskClass', 'reversible',
  'maximumBlastRadius', 'attemptBudget', 'concurrencyBudget', 'tokenBudget', 'costBudgetMicrounits', 'requiredApproverIds', 'input',
  'requestedPermission', 'requestedCapabilities', 'hookPhase', 'bypassRequested',
]);

const TOOL_POLICY_KEYS = Object.freeze([
  'schema', 'decision', 'signatureVerified', 'canonicalOwnerEvidenceVerified', 'canonicalOwnerEvidenceDigest', 'ownerBoundaryDecision',
  'requestId', 'caseId', 'role', 'toolId', 'toolVersion', 'principalId', 'providerId', 'providerRevision', 'modelId', 'modelRevision',
  'promptRevision', 'toolRevision', 'controlRevision', 'runId', 'parentRunId', 'mode',
  'environmentId', 'repositoryRevision', 'pathScope', 'resourceIds', 'evidenceDigest', 'evidenceBundleDigest', 'actionArtifactDigest',
  'registeredActionId', 'registeredActionRegistryDigest', 'registeredActionMembershipVerified', 'capitalExposureState', 'riskClass', 'reversible',
  'maximumBlastRadius', 'attemptBudget', 'concurrencyBudget', 'tokenBudget', 'costBudgetMicrounits', 'requiredApproverIds',
  'requiredPermission', 'requiredCapability', 'registryDigest', 'inputDigest', 'policyRevision', 'validFromMs', 'expiresAtMs',
  'childCapabilities', 'childGrantMode', 'hardDenialResult', 'durableAuditAvailable',
]);

const OWNER_BOUNDARY_DECISION_KEYS = Object.freeze([
  'verdict', 'allowed', 'authorityGranted', 'providerState', 'reasonCodes',
]);
const TOOL_DECISION_KEYS = Object.freeze([
  'schema', 'allowed', 'authorityGranted', 'disposition', 'toolId', 'requestId', 'caseId', 'role', 'principalId', 'providerId',
  'modelId', 'runId', 'mode', 'environmentId', 'inputDigest', 'policyRevision', 'reasonCodes',
]);

function evaluateToolCallAdmissionUnsafe(
  request: Readonly<ToolCallAdmissionRequest>,
  policy: Readonly<ToolPolicyEvidence>,
  nowMs: number,
  registry: readonly Readonly<A3ToolDescriptor>[] = A3_TOOL_REGISTRY,
): Readonly<ToolCallAdmissionDecision> {
  const requestSnapshot = snapshotDataRecord(request, TOOL_REQUEST_KEYS);
  const policySnapshot = snapshotDataRecord(policy, TOOL_POLICY_KEYS);
  if (requestSnapshot === null || policySnapshot === null || !Number.isSafeInteger(nowMs) || nowMs < 0) {
    return Object.freeze({
      schema: 'AI_OPS_TOOL_CALL_ADMISSION_DECISION_V1',
      allowed: false,
      authorityGranted: false,
      disposition: 'DENY',
      toolId: 'INVALID_TOOL_ID',
      requestId: null,
      caseId: null,
      role: null,
      principalId: null,
      providerId: null,
      modelId: null,
      runId: null,
      mode: null,
      environmentId: null,
      inputDigest: null,
      policyRevision: null,
      reasonCodes: Object.freeze(['TOOL_ADMISSION_ENVELOPE_REJECTED']),
    });
  }
  request = requestSnapshot as unknown as Readonly<ToolCallAdmissionRequest>;
  policy = policySnapshot as unknown as Readonly<ToolPolicyEvidence>;
  if (request.schema !== 'AI_OPS_TOOL_CALL_ADMISSION_REQUEST_V1' || policy.schema !== 'AI_OPS_TOOL_POLICY_EVIDENCE_V1') {
    return Object.freeze({
      schema: 'AI_OPS_TOOL_CALL_ADMISSION_DECISION_V1', allowed: false, authorityGranted: false, disposition: 'DENY', toolId: 'INVALID_TOOL_ID',
      requestId: null, caseId: null, role: null, principalId: null, providerId: null, modelId: null, runId: null, mode: null,
      environmentId: null, inputDigest: null, policyRevision: null, reasonCodes: Object.freeze(['TOOL_ADMISSION_SCHEMA_UNSUPPORTED']),
    });
  }
  const reasons: string[] = [];
  const registrySnapshot = snapshotToolRegistry(registry);
  const registryIssues = registrySnapshot === null
    ? Object.freeze(['TOOL_REGISTRY_PATH_SET_INVALID'])
    : validateToolRegistry(registrySnapshot);
  if (registryIssues.length > 0) {
    return Object.freeze({
      schema: 'AI_OPS_TOOL_CALL_ADMISSION_DECISION_V1',
      allowed: false,
      authorityGranted: false,
      disposition: 'DENY',
      toolId: typeof request.toolId === 'string' ? request.toolId : 'INVALID_TOOL_ID',
      requestId: isBoundedIdentifier(request.requestId) ? request.requestId : null,
      caseId: isBoundedIdentifier(request.caseId) ? request.caseId : null,
      role: isExactIdentityRole(request.role) ? request.role : null,
      principalId: isBoundedIdentifier(request.principalId) ? request.principalId : null,
      providerId: isBoundedIdentifier(request.providerId) ? request.providerId : null,
      modelId: isBoundedIdentifier(request.modelId) ? request.modelId : null,
      runId: isBoundedIdentifier(request.runId) ? request.runId : null,
      mode: isExactProviderConfigurationState(request.mode) ? request.mode : null,
      environmentId: isBoundedIdentifier(request.environmentId) ? request.environmentId : null,
      inputDigest: null,
      policyRevision: isBoundedIdentifier(policy.policyRevision) ? policy.policyRevision : null,
      reasonCodes: Object.freeze(['TOOL_REGISTRY_INVALID', ...registryIssues]),
    });
  }
  const row = registrySnapshot?.find((candidate) => candidate.toolId === request.toolId);
  if (row === undefined || request.toolVersion !== row.version) {
    return Object.freeze({
      schema: 'AI_OPS_TOOL_CALL_ADMISSION_DECISION_V1',
      allowed: false,
      authorityGranted: false,
      disposition: 'UNREGISTERED_PROPOSAL',
      toolId: request.toolId,
      requestId: isBoundedIdentifier(request.requestId) ? request.requestId : null,
      caseId: isBoundedIdentifier(request.caseId) ? request.caseId : null,
      role: isExactIdentityRole(request.role) ? request.role : null,
      principalId: isBoundedIdentifier(request.principalId) ? request.principalId : null,
      providerId: isBoundedIdentifier(request.providerId) ? request.providerId : null,
      modelId: isBoundedIdentifier(request.modelId) ? request.modelId : null,
      runId: isBoundedIdentifier(request.runId) ? request.runId : null,
      mode: isExactProviderConfigurationState(request.mode) ? request.mode : null,
      environmentId: isBoundedIdentifier(request.environmentId) ? request.environmentId : null,
      inputDigest: null,
      policyRevision: isBoundedIdentifier(policy.policyRevision) ? policy.policyRevision : null,
      reasonCodes: Object.freeze(['TOOL_OR_VERSION_NOT_REGISTERED']),
    });
  }
  if (!hasExactKeys(request, TOOL_REQUEST_KEYS)) reasons.push('TOOL_ADMISSION_REQUEST_NOT_CLOSED');
  if (!hasExactKeys(policy, TOOL_POLICY_KEYS)) reasons.push('TOOL_POLICY_EVIDENCE_NOT_CLOSED');
  if (!isBoundedIdentifier(request.requestId) || !isBoundedIdentifier(request.caseId)) reasons.push('TOOL_CALL_IDENTITY_INVALID');
  for (const value of [
    request.principalId,
    request.providerId,
    request.providerRevision,
    request.modelId,
    request.modelRevision,
    request.promptRevision,
    request.toolRevision,
    request.controlRevision,
    request.runId,
    request.environmentId,
    request.maximumBlastRadius,
  ]) {
    if (!isBoundedIdentifier(value)) reasons.push('TOOL_CALL_SUBJECT_IDENTIFIER_INVALID');
  }
  if (request.toolRevision !== `${row.toolId}:v${row.version}`) reasons.push('TOOL_REVISION_NOT_PINNED_TO_REGISTRY');
  if (request.parentRunId !== null && !isBoundedIdentifier(request.parentRunId)) reasons.push('TOOL_PARENT_RUN_ID_INVALID');
  if (!isExactIdentityRole(request.role)) reasons.push('TOOL_IDENTITY_ROLE_INVALID');
  if (!isExactProviderConfigurationState(request.mode) || !row.allowedModes.includes(request.mode)) reasons.push('TOOL_MODE_NOT_ALLOWED');
  const pathScopeSnapshot = snapshotStringList(request.pathScope, A3_EXCLUSIVE_PATCH_ROOTS.length);
  const pathScope = pathScopeSnapshot ?? [];
  const policyPathScopeSnapshot = snapshotStringList(policy.pathScope, A3_EXCLUSIVE_PATCH_ROOTS.length);
  const policyPathScope = policyPathScopeSnapshot ?? [];
  if (pathScopeSnapshot === null
    || pathScope.some((value) => !row.pathAllowlist.includes(value))
    || new Set(pathScope).size !== pathScope.length) reasons.push('TOOL_PATH_SCOPE_INVALID');
  if (row.effectClass === 'CLASS_C_ISOLATED_ONLY') {
    if (!isGitCommitSha(request.repositoryRevision) || pathScope.length === 0) reasons.push('CLASS_C_REPOSITORY_SCOPE_REQUIRED');
  } else if (request.repositoryRevision !== null || pathScope.length !== 0) reasons.push('NON_PATCH_REPOSITORY_SCOPE_FORBIDDEN');
  const resourceIds = snapshotStringList(request.resourceIds, 64);
  const policyResourceIdsSnapshot = snapshotStringList(policy.resourceIds, 64);
  const policyResourceIds = policyResourceIdsSnapshot ?? [];
  if (resourceIds === null || resourceIds.length === 0 || resourceIds.some((value) => !isBoundedIdentifier(value)) || new Set(resourceIds).size !== resourceIds.length) {
    reasons.push('TOOL_RESOURCE_SCOPE_INVALID');
  }
  const requiredApproverIds = snapshotStringList(request.requiredApproverIds, 16);
  const policyRequiredApproverIdsSnapshot = snapshotStringList(policy.requiredApproverIds, 16);
  const policyRequiredApproverIds = policyRequiredApproverIdsSnapshot ?? [];
  if (requiredApproverIds === null || requiredApproverIds.some((value) => !isBoundedIdentifier(value)) || new Set(requiredApproverIds).size !== requiredApproverIds.length) {
    reasons.push('TOOL_APPROVER_SCOPE_INVALID');
  }
  if (row.effectClass !== 'READ_ONLY' && (requiredApproverIds === null || requiredApproverIds.length === 0)) {
    reasons.push('TOOL_REQUIRED_APPROVER_MISSING');
  }
  if (!isLowercaseSha256(request.evidenceDigest)) reasons.push('TOOL_CALL_EVIDENCE_DIGEST_INVALID');
  if (!isLowercaseSha256(request.evidenceBundleDigest)) reasons.push('TOOL_CALL_EVIDENCE_BUNDLE_DIGEST_INVALID');
  if (request.actionArtifactDigest !== null && !isLowercaseSha256(request.actionArtifactDigest)) reasons.push('TOOL_ACTION_ARTIFACT_DIGEST_INVALID');
  const expectedRisk = row.effectClass === 'READ_ONLY' ? 'READ_ONLY' : row.effectClass === 'PROPOSAL_ONLY' ? 'PROPOSAL' : 'CLASS_C_ISOLATED';
  if (request.riskClass !== expectedRisk) reasons.push('TOOL_RISK_CLASS_MISMATCH');
  if (request.capitalExposureState !== 'NOT_APPLICABLE_DIAGNOSTIC_ONLY') reasons.push('TOOL_CAPITAL_SCOPE_FORBIDDEN');
  if (row.effectClass !== 'READ_ONLY' && request.actionArtifactDigest === null) reasons.push('TOOL_ACTION_ARTIFACT_REQUIRED');
  if (row.effectClass === 'READ_ONLY' && request.actionArtifactDigest !== null) reasons.push('READ_ONLY_TOOL_ARTIFACT_UNEXPECTED');
  if (typeof request.reversible !== 'boolean') reasons.push('TOOL_REVERSIBILITY_FLAG_INVALID');
  if (row.effectClass === 'CLASS_C_ISOLATED_ONLY' && request.reversible !== true) reasons.push('CLASS_C_REVERSIBILITY_REQUIRED');
  for (const [label, value, maximum] of [
    ['ATTEMPT', request.attemptBudget, row.maximumCallsPerRun],
    ['CONCURRENCY', request.concurrencyBudget, 1],
    ['TOKEN', request.tokenBudget, 1_000_000],
    ['COST', request.costBudgetMicrounits, row.maximumCostMicrounits],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) reasons.push(`TOOL_${label}_BUDGET_INVALID`);
  }
  if (!(DIAGNOSTIC_PERMISSION_LEVELS as readonly string[]).includes(request.requestedPermission)) reasons.push('TOOL_PERMISSION_UNKNOWN');
  if (request.requestedPermission !== row.requiredPermission) reasons.push('TOOL_PERMISSION_NOT_EXACT');
  if (request.hookPhase !== 'PRE_TOOL_USE') reasons.push('PRE_TOOL_HOOK_REQUIRED');
  if (request.bypassRequested !== false) reasons.push('BYPASS_PERMISSION_FORBIDDEN');
  if (row.enabled !== true) reasons.push('TOOL_NOT_CONFIGURED');
  if (!row.allowedRoles.includes(request.role)) reasons.push('IDENTITY_ROLE_NOT_ALLOWED');
  const identity = AI_IDENTITY_MATRIX.find((candidate) => candidate.role === request.role);
  if (identity === undefined) reasons.push('IDENTITY_ROLE_NOT_REGISTERED');
  else {
    const requiredRank = DIAGNOSTIC_PERMISSION_LEVELS.indexOf(row.requiredPermission);
    const maximumRank = DIAGNOSTIC_PERMISSION_LEVELS.indexOf(identity.maximumPermission);
    if (requiredRank < 0 || maximumRank < requiredRank) reasons.push('IDENTITY_PERMISSION_CEILING_EXCEEDED');
    if (!identity.allowedCapabilities.includes(row.requiredCapability)) reasons.push('IDENTITY_CAPABILITY_CEILING_EXCEEDED');
  }
  const deepInputSnapshot = snapshotStrictValueForSchema(row.inputSchema, request.input);
  const inputSnapshot = deepInputSnapshot.ok ? snapshotDataRecord(deepInputSnapshot.value, row.inputSchema.required) : null;
  const inputValidation = validateStrictValue(row.inputSchema, inputSnapshot);
  if (inputSnapshot === null || !inputValidation.valid) reasons.push('TOOL_INPUT_SCHEMA_REJECTED');
  if (
    inputSnapshot === null
    || inputSnapshot.requestId !== request.requestId
    || inputSnapshot.caseId !== request.caseId
    || inputSnapshot.evidenceDigest !== request.evidenceDigest
  ) reasons.push('TOOL_INPUT_SUBJECT_BINDING_MISMATCH');
  if (policy.decision !== 'ALLOW') reasons.push('TOOL_POLICY_NOT_ALLOWED');
  if (policy.signatureVerified !== true) reasons.push('TOOL_POLICY_SIGNATURE_UNVERIFIED');
  if (policy.canonicalOwnerEvidenceVerified !== true || !isLowercaseSha256(policy.canonicalOwnerEvidenceDigest)) reasons.push('CANONICAL_OWNER_EVIDENCE_UNVERIFIED');
  const ownerBoundaryDecision = snapshotDataRecord(policy.ownerBoundaryDecision, OWNER_BOUNDARY_DECISION_KEYS);
  const ownerBoundaryReasonCodes = ownerBoundaryDecision === null ? null : snapshotStringList(ownerBoundaryDecision.reasonCodes, 32);
  if (
    ownerBoundaryDecision === null
    || ownerBoundaryDecision.verdict !== 'PASS'
    || ownerBoundaryDecision.allowed !== true
    || ownerBoundaryDecision.authorityGranted !== false
    || ownerBoundaryDecision.providerState !== 'READY'
    || ownerBoundaryReasonCodes === null
    || ownerBoundaryReasonCodes.length !== 0
  ) reasons.push('CANONICAL_DIAGNOSTIC_BOUNDARY_DENIED');
  if (
    policy.requestId !== request.requestId
    || policy.caseId !== request.caseId
    || policy.role !== request.role
    || policy.toolId !== request.toolId
    || policy.toolVersion !== row.version
    || policy.principalId !== request.principalId
    || policy.providerId !== request.providerId
    || policy.providerRevision !== request.providerRevision
    || policy.modelId !== request.modelId
    || policy.modelRevision !== request.modelRevision
    || policy.promptRevision !== request.promptRevision
    || policy.toolRevision !== request.toolRevision
    || policy.controlRevision !== request.controlRevision
    || policy.runId !== request.runId
    || policy.parentRunId !== request.parentRunId
    || policy.mode !== request.mode
    || policy.environmentId !== request.environmentId
    || policy.repositoryRevision !== request.repositoryRevision
    || policy.evidenceDigest !== request.evidenceDigest
    || policy.evidenceBundleDigest !== request.evidenceBundleDigest
    || policy.actionArtifactDigest !== request.actionArtifactDigest
    || policy.capitalExposureState !== request.capitalExposureState
    || policy.riskClass !== request.riskClass
    || policy.reversible !== request.reversible
    || policy.maximumBlastRadius !== request.maximumBlastRadius
    || policy.attemptBudget !== request.attemptBudget
    || policy.concurrencyBudget !== request.concurrencyBudget
    || policy.tokenBudget !== request.tokenBudget
    || policy.costBudgetMicrounits !== request.costBudgetMicrounits
    || policy.requiredPermission !== row.requiredPermission
    || policy.requiredCapability !== row.requiredCapability
    || policyResourceIdsSnapshot === null
    || policyPathScopeSnapshot === null
    || policyRequiredApproverIdsSnapshot === null
    || !sameStringSet(policyResourceIds, resourceIds)
    || !sameStringSet(policyPathScope, pathScope)
    || !sameStringSet(policyRequiredApproverIds, requiredApproverIds)
  ) reasons.push('TOOL_POLICY_SUBJECT_BINDING_MISMATCH');
  if (row.toolId === 'createTypedProposal') {
    const proposalInput = inputSnapshot;
    if (
      proposalInput === null
      || proposalInput.registeredActionId === 'UNREGISTERED'
      || !isBoundedIdentifier(policy.registeredActionId)
      || policy.registeredActionId !== proposalInput.registeredActionId
      || !isLowercaseSha256(policy.registeredActionRegistryDigest)
      || policy.registeredActionMembershipVerified !== true
    ) reasons.push('REGISTERED_ACTION_MEMBERSHIP_UNVERIFIED');
  } else if (
    policy.registeredActionId !== null
    || policy.registeredActionRegistryDigest !== null
    || policy.registeredActionMembershipVerified !== false
  ) reasons.push('NON_PROPOSAL_REGISTERED_ACTION_EVIDENCE_FORBIDDEN');
  if (inputValidation.valid && inputSnapshot !== null) {
    let toolSpecificBindingValid = true;
    if (row.toolId === 'createTypedProposal') {
      const supportingEvidenceHashes = snapshotStringList(inputSnapshot.supportingEvidenceHashes, 64);
      toolSpecificBindingValid = inputSnapshot.artifactDigest === request.actionArtifactDigest
        && inputSnapshot.attemptBudget === request.attemptBudget
        && inputSnapshot.blastRadius === request.maximumBlastRadius
        && inputSnapshot.providerId === request.providerId
        && inputSnapshot.providerRevision === request.providerRevision
        && inputSnapshot.modelId === request.modelId
        && inputSnapshot.modelRevision === request.modelRevision
        && inputSnapshot.promptRevision === request.promptRevision
        && inputSnapshot.toolRevision === request.toolRevision
        && inputSnapshot.controlRevision === request.controlRevision
        && inputSnapshot.requestedCapability === row.requiredCapability
        && inputSnapshot.policyRevision === policy.policyRevision
        && inputSnapshot.registeredActionId === policy.registeredActionId
        && sameStringSet(inputSnapshot.exactTargetResourceIds, resourceIds)
        && requiredApproverIds !== null
        && requiredApproverIds.length === 1
        && inputSnapshot.requiredApprovalPrincipalId === requiredApproverIds[0]
        && supportingEvidenceHashes !== null
        && supportingEvidenceHashes.includes(request.evidenceDigest)
        && supportingEvidenceHashes.includes(request.evidenceBundleDigest)
        && Number.isSafeInteger(inputSnapshot.createdAtMs)
        && Number.isSafeInteger(inputSnapshot.expiresAtMs)
        && (inputSnapshot.createdAtMs as number) >= policy.validFromMs
        && (inputSnapshot.expiresAtMs as number) <= policy.expiresAtMs
        && (inputSnapshot.expiresAtMs as number) > (inputSnapshot.createdAtMs as number);
    } else if (row.toolId === 'createIsolatedPatchTask') {
      toolSpecificBindingValid = inputSnapshot.artifactDigest === request.actionArtifactDigest
        && inputSnapshot.repositoryRevision === request.repositoryRevision
        && sameStringSet(inputSnapshot.scopeRoots, pathScope);
    } else if (row.toolId === 'runSandboxGate') {
      toolSpecificBindingValid = inputSnapshot.patchHash === request.actionArtifactDigest;
    } else if (row.toolId === 'requestApproval') {
      toolSpecificBindingValid = inputSnapshot.artifactDigest === request.actionArtifactDigest
        && inputSnapshot.capability === row.requiredCapability
        && Number.isSafeInteger(inputSnapshot.expiresAtMs)
        && (inputSnapshot.expiresAtMs as number) <= policy.expiresAtMs;
    }
    if (!toolSpecificBindingValid) reasons.push('TOOL_SPECIFIC_SUBJECT_BINDING_MISMATCH');
  }
  let computedRegistryDigest: string | null = null;
  let computedInputDigest: string | null = null;
  try {
    computedRegistryDigest = registrySnapshot === null ? null : toolRegistryDigest(registrySnapshot);
    if (inputValidation.valid && inputSnapshot !== null) {
      const canonicalInput = canonicalJson({ toolId: request.toolId, input: inputSnapshot });
      computedInputDigest = createHash('sha256').update(canonicalInput).digest('hex');
      if (Buffer.byteLength(canonicalInput, 'utf8') > row.maximumInputBytes) reasons.push('TOOL_INPUT_BYTES_EXCEEDED');
    }
  } catch {
    reasons.push('TOOL_CANONICALIZATION_REJECTED');
  }
  if (!isLowercaseSha256(policy.registryDigest) || policy.registryDigest !== computedRegistryDigest) reasons.push('TOOL_REGISTRY_DIGEST_MISMATCH');
  if (!isLowercaseSha256(policy.inputDigest) || policy.inputDigest !== computedInputDigest) reasons.push('TOOL_INPUT_DIGEST_MISMATCH');
  if (!isBoundedIdentifier(policy.policyRevision)) reasons.push('TOOL_POLICY_REVISION_INVALID');
  if (
    !Number.isSafeInteger(policy.validFromMs)
    || !Number.isSafeInteger(policy.expiresAtMs)
    || policy.expiresAtMs <= policy.validFromMs
    || policy.expiresAtMs - policy.validFromMs > row.approvalTtlMs
    || nowMs < policy.validFromMs
    || nowMs >= policy.expiresAtMs
  ) reasons.push('TOOL_POLICY_STALE_OR_INVALID');
  if (policy.durableAuditAvailable !== true) reasons.push('DURABLE_AUDIT_UNAVAILABLE');
  if (policy.hardDenialResult !== 'NONE') reasons.push('CANONICAL_HARD_DENIAL_PRESENT');
  if (policy.childGrantMode !== 'EXACT_EXPLICIT') reasons.push('CHILD_GRANT_MODE_INVALID');
  const requestedCapabilitiesSnapshot = snapshotStringList(request.requestedCapabilities, 16);
  const childCapabilitiesSnapshot = snapshotStringList(policy.childCapabilities, 16);
  const requestedCapabilities = requestedCapabilitiesSnapshot ?? [];
  const childCapabilities = childCapabilitiesSnapshot ?? [];
  if (requestedCapabilitiesSnapshot === null) reasons.push('REQUESTED_CAPABILITY_LIST_INVALID');
  if (childCapabilitiesSnapshot === null) reasons.push('CHILD_CAPABILITY_LIST_INVALID');
  if (new Set(requestedCapabilities).size !== requestedCapabilities.length) reasons.push('DUPLICATE_REQUESTED_CAPABILITY');
  if (requestedCapabilities.length !== 1 || requestedCapabilities[0] !== row.requiredCapability) reasons.push('REQUESTED_CAPABILITY_NOT_EXACT_MINIMUM');
  for (const capability of requestedCapabilities) {
    if (!(DIAGNOSTIC_ALLOWED_CAPABILITY_IDS as readonly string[]).includes(capability)) reasons.push('REQUESTED_CAPABILITY_UNKNOWN');
    if ((DIAGNOSTIC_FORBIDDEN_CAPABILITIES as readonly string[]).includes(capability)) reasons.push('REQUESTED_CAPABILITY_FORBIDDEN');
  }
  if (!sameStringSet(childCapabilities, requestedCapabilities)) reasons.push('CHILD_CAPABILITY_GRANT_MISMATCH');
  if (!childCapabilities.includes(row.requiredCapability)) reasons.push('SIGNED_REQUIRED_CAPABILITY_MISSING');
  if (new Set(childCapabilities).size !== childCapabilities.length) reasons.push('DUPLICATE_CHILD_CAPABILITY');

  const allowed = reasons.length === 0;
  const unregisteredProposal = reasons.includes('REGISTERED_ACTION_MEMBERSHIP_UNVERIFIED');
  return Object.freeze({
    schema: 'AI_OPS_TOOL_CALL_ADMISSION_DECISION_V1',
    allowed,
    authorityGranted: false,
    disposition: allowed ? 'ADMIT_TO_EXTERNAL_EXECUTOR_PORT' : unregisteredProposal ? 'UNREGISTERED_PROPOSAL' : 'DENY',
    toolId: request.toolId,
    requestId: isBoundedIdentifier(request.requestId) ? request.requestId : null,
    caseId: isBoundedIdentifier(request.caseId) ? request.caseId : null,
    role: isExactIdentityRole(request.role) ? request.role : null,
    principalId: isBoundedIdentifier(request.principalId) ? request.principalId : null,
    providerId: isBoundedIdentifier(request.providerId) ? request.providerId : null,
    modelId: isBoundedIdentifier(request.modelId) ? request.modelId : null,
    runId: isBoundedIdentifier(request.runId) ? request.runId : null,
    mode: isExactProviderConfigurationState(request.mode) ? request.mode : null,
    environmentId: isBoundedIdentifier(request.environmentId) ? request.environmentId : null,
    inputDigest: computedInputDigest,
    policyRevision: isBoundedIdentifier(policy.policyRevision) ? policy.policyRevision : null,
    reasonCodes: Object.freeze(reasons),
  });
}

export function evaluateToolCallAdmission(
  request: Readonly<ToolCallAdmissionRequest>,
  policy: Readonly<ToolPolicyEvidence>,
  nowMs: number,
  registry: readonly Readonly<A3ToolDescriptor>[] = A3_TOOL_REGISTRY,
): Readonly<ToolCallAdmissionDecision> {
  try {
    return evaluateToolCallAdmissionUnsafe(request, policy, nowMs, registry);
  } catch {
    return Object.freeze({
      schema: 'AI_OPS_TOOL_CALL_ADMISSION_DECISION_V1',
      allowed: false,
      authorityGranted: false,
      disposition: 'DENY',
      toolId: 'INVALID_TOOL_ID',
      requestId: null,
      caseId: null,
      role: null,
      principalId: null,
      providerId: null,
      modelId: null,
      runId: null,
      mode: null,
      environmentId: null,
      inputDigest: null,
      policyRevision: null,
      reasonCodes: Object.freeze(['TOOL_ADMISSION_RUNTIME_REJECTED']),
    });
  }
}

export function validateToolOutput(admission: Readonly<ToolCallAdmissionDecision>, output: unknown): Readonly<{ valid: boolean; reasonCodes: readonly string[] }> {
  const admissionSnapshot = snapshotDataRecord(admission, TOOL_DECISION_KEYS);
  if (admissionSnapshot === null) {
    return Object.freeze({ valid: false, reasonCodes: Object.freeze(['TOOL_OUTPUT_ADMISSION_INVALID']) });
  }
  admission = admissionSnapshot as unknown as Readonly<ToolCallAdmissionDecision>;
  const admissionReasonCodes = snapshotStringList(admission.reasonCodes, 64);
  if (admission.schema !== 'AI_OPS_TOOL_CALL_ADMISSION_DECISION_V1' || admission.allowed !== true
    || admission.disposition !== 'ADMIT_TO_EXTERNAL_EXECUTOR_PORT' || admission.authorityGranted !== false
    || admissionReasonCodes === null || admissionReasonCodes.length !== 0) {
    return Object.freeze({ valid: false, reasonCodes: Object.freeze(['TOOL_OUTPUT_ADMISSION_INVALID']) });
  }
  const row = A3_TOOL_REGISTRY.find((candidate) => candidate.toolId === admission.toolId);
  if (row === undefined) return Object.freeze({ valid: false, reasonCodes: Object.freeze(['TOOL_NOT_REGISTERED']) });
  const outputSnapshot = snapshotDataRecord(output, row.outputSchema.required);
  if (outputSnapshot === null) return Object.freeze({ valid: false, reasonCodes: Object.freeze(['TOOL_OUTPUT_SCHEMA_REJECTED']) });
  const validation = validateStrictValue(row.outputSchema, outputSnapshot);
  const bindingValid = outputSnapshot.requestId === admission.requestId
    && outputSnapshot.caseId === admission.caseId
    && outputSnapshot.toolId === admission.toolId
    && outputSnapshot.role === admission.role
    && outputSnapshot.principalId === admission.principalId
    && outputSnapshot.providerId === admission.providerId
    && outputSnapshot.modelId === admission.modelId
    && outputSnapshot.runId === admission.runId
    && outputSnapshot.mode === admission.mode
    && outputSnapshot.environmentId === admission.environmentId
    && outputSnapshot.inputDigest === admission.inputDigest
    && outputSnapshot.policyRevision === admission.policyRevision;
  const reasonCodes = [...validation.issues];
  if (!bindingValid) reasonCodes.push('TOOL_OUTPUT_SUBJECT_BINDING_MISMATCH');
  return Object.freeze({ valid: reasonCodes.length === 0, reasonCodes: Object.freeze(reasonCodes) });
}

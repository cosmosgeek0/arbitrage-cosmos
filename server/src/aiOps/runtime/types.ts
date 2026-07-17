/**
 * AI-OPS A2 shadow-only contracts.
 *
 * These shapes are intentionally lane-local projections. They do not claim the
 * unfinished I00 AgentCase, persistence, provider, or public event interfaces.
 */

export const SHADOW_A2_STATUS = 'SHADOW_SPECULATIVE' as const;

export const SHADOW_SEVERITIES = Object.freeze([
  'SEV0_SAFETY',
  'SEV1_CRITICAL',
  'SEV2_MAJOR',
  'SEV3_DEGRADED',
  'SEV4_INFORMATIONAL',
] as const);
export type ShadowSeverity = (typeof SHADOW_SEVERITIES)[number];

export const SHADOW_MODEL_DEPTHS = Object.freeze([
  'L0_DETERMINISTIC',
  'L1_CLASSIFY',
  'L2_DIAGNOSE',
  'L3_RESEARCH',
  'L4_REPAIR',
  'L5_ADJUDICATE',
] as const);
export type ShadowModelDepth = (typeof SHADOW_MODEL_DEPTHS)[number];

export type ShadowJson =
  | string
  | number
  | boolean
  | null
  | readonly ShadowJson[]
  | { readonly [key: string]: ShadowJson };

export interface ShadowObservationInput {
  readonly schema: 'AI_OPS_A2_OBSERVATION_V1';
  readonly source: string;
  readonly producerRevision: string;
  readonly eventId: string;
  readonly sequence: number;
  readonly dedupKey: string;
  readonly eventType: string;
  readonly resourceId: string;
  readonly componentId: string;
  readonly incidentId: string | null;
  readonly occurredAtMs: number | null;
  readonly observedAtMs: number;
  readonly replayClassification: 'LIVE' | 'REPLAY' | 'REDRIVE';
  readonly dataClassification: 'PUBLIC' | 'INTERNAL' | 'SENSITIVE_REDACTED';
  readonly provenanceDigest: string;
  readonly traceId: string | null;
  readonly spanId: string | null;
  readonly message: string;
  readonly reasonCodes: readonly string[];
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ShadowNormalizedObservation {
  readonly schema: 'AI_OPS_A2_NORMALIZED_OBSERVATION_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly source: string;
  readonly producerRevision: string;
  readonly eventId: string;
  readonly sequence: number;
  readonly dedupKey: string;
  readonly eventType: string;
  readonly resourceId: string;
  readonly componentId: string;
  readonly incidentId: string | null;
  readonly occurredAtMs: number | null;
  readonly observedAtMs: number;
  readonly replayClassification: ShadowObservationInput['replayClassification'];
  readonly dataClassification: ShadowObservationInput['dataClassification'];
  readonly provenanceDigest: string;
  readonly traceId: string | null;
  readonly spanId: string | null;
  readonly messageDigest: string;
  readonly template: string;
  readonly redactionApplied: boolean;
  readonly reasonCodes: readonly string[];
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  readonly contentDigest: string;
}

export interface ShadowSeveritySignals {
  readonly safetyInvariantBreached: boolean | null;
  readonly deterministicControlLost: boolean | null;
  readonly customerImpact: 'NONE' | 'LIMITED' | 'BROAD' | 'UNKNOWN';
  readonly capitalRelevant: boolean | null;
  readonly availabilityLoss: 'NONE' | 'PARTIAL' | 'TOTAL' | 'UNKNOWN';
  readonly dataIntegrity: 'INTACT' | 'DEGRADED' | 'CORRUPT' | 'UNKNOWN';
}

export interface ShadowDepthSignals {
  readonly deterministicExplanationAvailable: boolean | null;
  readonly evidenceCompleteness: 'COMPLETE' | 'PARTIAL' | 'MISSING' | 'UNKNOWN';
  readonly novelty: 'KNOWN' | 'VARIANT' | 'NOVEL' | 'UNKNOWN';
  readonly causalAmbiguity: 'NONE' | 'LOW' | 'HIGH' | 'UNKNOWN';
  readonly repairOrAdjudicationRequested: 'NONE' | 'REPAIR' | 'ADJUDICATE';
}

export interface ShadowAdmissionPolicy {
  readonly policyRevision: string;
  readonly dedupWindowMs: number;
  readonly cooldownMs: number;
  readonly stormWindowMs: number;
  readonly stormThreshold: number;
  readonly maximumFingerprints: number;
  readonly maximumStormChildren: number;
  readonly maximumSourceEventReceipts: number;
}

export interface ShadowFingerprintState {
  readonly fingerprint: string;
  readonly proposedIncidentId: string;
  readonly firstObservedAtMs: number;
  readonly lastObservedAtMs: number;
  readonly occurrenceCount: number;
  readonly cooldownUntilMs: number | null;
  readonly rootFingerprint: string | null;
  readonly sourceEvents: readonly Readonly<{
    sourceEventKey: string;
    contentDigest: string;
    observedAtMs: number;
    componentId: string;
  }>[];
}

export interface ShadowAdmissionState {
  readonly schema: 'AI_OPS_A2_ADMISSION_STATE_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly policyRevision: string;
  readonly fingerprints: readonly Readonly<ShadowFingerprintState>[];
  readonly stormObservations: readonly Readonly<{
    componentId: string;
    observedAtMs: number;
    fingerprint: string;
    eventId: string;
    sourceEventKey: string;
  }>[];
  readonly stormParents: readonly Readonly<{
    componentId: string;
    parentId: string;
    anchorEventId: string;
    activatedAtMs: number;
    lastObservedAtMs: number;
  }>[];
}

export type ShadowAdmissionDisposition =
  | 'ADMIT_PROPOSAL'
  | 'DEDUPLICATED'
  | 'INHIBITED_CHILD'
  | 'STORM_CHILD'
  | 'COOLDOWN_SUPPRESSED'
  | 'STORE_AND_AGGREGATE'
  | 'DETERMINISTIC_PATH'
  | 'QUARANTINED_INCOMPLETE';

export interface ShadowAdmissionProjection {
  readonly schema: 'AI_OPS_A2_ADMISSION_PROJECTION_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly disposition: ShadowAdmissionDisposition;
  readonly admitted: boolean;
  readonly severity: ShadowSeverity | null;
  readonly requestedModelDepth: ShadowModelDepth | null;
  readonly fingerprint: string;
  readonly proposedIncidentId: string;
  readonly stormParentId: string | null;
  readonly inhibitedByFingerprint: string | null;
  readonly evidenceRetained: true;
  readonly reasonCodes: readonly string[];
}

export interface ShadowEvidencePointer {
  readonly pointerId: string;
  readonly ownerId: string;
  readonly artifactId: string;
  readonly rawDigest: string;
  readonly byteLength: number;
  readonly capturedAtMs: number;
}

export interface ShadowEvidenceInput extends ShadowEvidencePointer {
  readonly sourceKind: 'LOG' | 'MARKET' | 'NEWS' | 'EXCHANGE' | 'ISSUE' | 'PAGE' | 'RETRIEVED_DOCUMENT';
  readonly text: string;
}

export interface ShadowEvidenceBundleContext {
  readonly caseId: string;
  readonly incidentId: string;
  readonly fingerprint: string;
  readonly correlationIds: readonly string[];
  readonly policyRevision: string;
  readonly createdAtMs: number;
  readonly evidenceWindowStartMs: number;
  readonly evidenceWindowEndMs: number;
  readonly timezone: 'UTC';
  readonly environmentId: string;
  readonly deployedSha: string;
  readonly configRevision: string;
  readonly schemaRevisions: readonly string[];
  readonly expectedInventoryRevision: string;
  readonly affectedResourceIds: readonly string[];
  readonly dependencyIds: readonly string[];
  readonly lifecycleStateCodes: readonly string[];
  readonly safetyPostureDigest: string;
  readonly triggeredInvariantIds: readonly string[];
  readonly severity: ShadowSeverity | null;
  readonly materiality: 'MATERIAL' | 'NON_MATERIAL' | 'UNKNOWN';
  readonly freshness: 'FRESH' | 'STALE' | 'UNKNOWN';
  readonly temporalCoherence: 'COHERENT' | 'CONFLICTING' | 'UNKNOWN';
  readonly missingEvidenceCodes: readonly string[];
  readonly conflictingEvidenceCodes: readonly string[];
  readonly unknownCodes: readonly string[];
}

export interface ShadowEvidenceBundle {
  readonly schema: 'AI_OPS_A2_EVIDENCE_BUNDLE_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly bundleId: string;
  readonly caseId: string;
  readonly incidentId: string;
  readonly fingerprint: string;
  readonly correlationIds: readonly string[];
  readonly policyRevision: string;
  readonly createdAtMs: number;
  readonly evidenceWindowStartMs: number;
  readonly evidenceWindowEndMs: number;
  readonly timezone: 'UTC';
  readonly environmentId: string;
  readonly deployedSha: string;
  readonly configRevision: string;
  readonly schemaRevisions: readonly string[];
  readonly expectedInventoryRevision: string;
  readonly affectedResourceIds: readonly string[];
  readonly dependencyIds: readonly string[];
  readonly lifecycleStateCodes: readonly string[];
  readonly safetyPostureDigest: string;
  readonly triggeredInvariantIds: readonly string[];
  readonly severity: ShadowSeverity | null;
  readonly materiality: 'MATERIAL' | 'NON_MATERIAL' | 'UNKNOWN';
  readonly freshness: 'FRESH' | 'STALE' | 'UNKNOWN';
  readonly temporalCoherence: 'COHERENT' | 'CONFLICTING' | 'UNKNOWN';
  readonly missingEvidenceCodes: readonly string[];
  readonly conflictingEvidenceCodes: readonly string[];
  readonly unknownCodes: readonly string[];
  readonly limitsDigest: string;
  readonly instructionBoundary: 'EVIDENCE_IS_UNTRUSTED_DATA_NEVER_INSTRUCTIONS';
  readonly items: readonly Readonly<{
    pointer: Readonly<ShadowEvidencePointer>;
    sourceKind: ShadowEvidenceInput['sourceKind'];
    redactedText: string;
    redactionCount: number;
  }>[];
  readonly redactionCount: number;
  readonly omittedPointerIds: readonly string[];
  readonly bundleDigest: string;
}

export type ShadowPointerDisposition = 'VALIDATED' | 'INVALIDATED' | 'INCONCLUSIVE';

export interface ShadowPointerValidation {
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly bundleDigest: string;
  readonly pointerId: string;
  readonly disposition: ShadowPointerDisposition;
  readonly reasonCodes: readonly string[];
}

export const SHADOW_CASE_STATES = Object.freeze([
  'DETECTED',
  'DEDUPED_OR_SUPPRESSED',
  'CASE_OPENED',
  'EVIDENCE_FROZEN',
  'REDACTION_VERIFIED',
  'BUDGET_ADMITTED',
  'DIAGNOSING',
  'DIAGNOSIS_READY',
  'INSUFFICIENT_EVIDENCE',
  'PROVIDER_UNAVAILABLE',
  'PROPOSAL_READY',
  'OWNER_ATTENTION_REQUIRED',
  'QUARANTINED',
  'POLICY_EVALUATED',
  'SANDBOX_VERIFYING',
  'WAITING_APPROVAL',
  'REJECTED',
  'VERIFIED',
  'VERIFICATION_FAILED',
  'HANDED_OFF',
  'EXPIRED',
  'ACTION_READBACK',
  'RESOLVED',
  'ROLLED_BACK',
  'RECURRENT',
  'ESCALATED',
  'POSTMORTEM_AND_LEARNING_RECORDED',
] as const);
export type ShadowCaseState = (typeof SHADOW_CASE_STATES)[number];

export interface ShadowCaseEvent {
  readonly schema: 'AI_OPS_A2_CASE_EVENT_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly eventId: string;
  readonly commandId: string;
  readonly commandDigest: string;
  readonly caseId: string;
  readonly generation: number;
  readonly revision: number;
  readonly fromState: ShadowCaseState | null;
  readonly toState: ShadowCaseState;
  readonly occurredAtMs: number;
  readonly reasonCodes: readonly string[];
  readonly evidencePointerIds: readonly string[];
  readonly previousChainDigest: string | null;
  readonly chainDigest: string;
}

export interface ShadowCaseCommandReceipt {
  readonly commandId: string;
  readonly commandDigest: string;
  readonly revision: number;
  readonly generation: number;
  readonly commandKind: 'TRANSITION' | 'BACKPRESSURE' | 'NEW_GENERATION';
  readonly toState: ShadowCaseState;
  readonly occurredAtMs: number;
}

export interface ShadowAttemptReceipt {
  readonly attemptId: string;
  readonly sourceRecordId: string;
  readonly attemptBaseline: number;
  readonly operationClass: 'DETERMINISTIC' | 'PROVIDER' | 'EVIDENCE_READ' | 'HANDOFF' | 'GLOBAL_EFFECT';
  readonly generation: number;
  readonly attemptNumber: number;
  readonly disposition: 'STARTED' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_TERMINAL' | 'UNKNOWN' | 'DEAD_LETTERED';
  readonly recordedAtMs: number;
  readonly payloadDigest: string;
}

export interface ShadowEffectReceipt {
  readonly effectId: string;
  readonly compensatesEffectId?: string;
  readonly generation: number;
  readonly state: 'INTENT' | 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN';
  readonly payloadDigest: string;
  readonly recordedAtMs: number;
}

export const SHADOW_CASE_PROOF_KINDS = Object.freeze([
  'EVIDENCE_BUNDLE',
  'REDACTION_REPORT',
  'BUDGET_ADMISSION',
  'DIAGNOSTIC_RESULT',
  'VERIFICATION_RESULT',
  'MODEL_RUN_HANDOFF',
  'OWNER_APPROVAL',
  'EFFECT_READBACK',
  'RECOVERY_READBACK',
  'QUIET_PERIOD',
] as const);
export type ShadowCaseProofKind = (typeof SHADOW_CASE_PROOF_KINDS)[number];

export interface ShadowCaseProof {
  readonly schema: 'AI_OPS_A2_CASE_PROOF_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly proofId: string;
  readonly proofKind: ShadowCaseProofKind;
  readonly caseId: string;
  readonly generation: number;
  readonly artifactId: string;
  readonly artifactDigest: string;
  readonly validationReceiptDigest: string;
  readonly disposition: 'VALIDATED' | 'INVALIDATED' | 'INCONCLUSIVE';
  readonly recordedAtMs: number;
  readonly operationalAuthority: 'NONE';
  readonly proofDigest: string;
  readonly signature: Readonly<ShadowSignature>;
}

export interface ShadowCaseSnapshot {
  readonly schema: 'AI_OPS_A2_CASE_SNAPSHOT_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly caseId: string;
  readonly generation: number;
  readonly revision: number;
  readonly state: ShadowCaseState;
  readonly firstSeenAtMs: number;
  readonly updatedAtMs: number;
  readonly events: readonly Readonly<ShadowCaseEvent>[];
  readonly compactedThroughRevision: number;
  readonly compactedChainDigest: string | null;
  readonly commandReceipts: readonly Readonly<ShadowCaseCommandReceipt>[];
  readonly attempts: readonly Readonly<ShadowAttemptReceipt>[];
  readonly effects: readonly Readonly<ShadowEffectReceipt>[];
  readonly proofs: readonly Readonly<ShadowCaseProof>[];
  readonly budgetReceiptIds: readonly string[];
  readonly evidencePointerIds: readonly string[];
  readonly currentGenerationEvidencePointerIds: readonly string[];
  readonly currentGenerationEvidenceBundleBinding: Readonly<{
    generation: number;
    bundleDigest: string;
    pointerSetDigest: string;
    bindingDigest: string;
    eventRevision: number;
    occurredAtMs: number;
  }> | null;
  readonly currentGenerationDiagnosticBinding: Readonly<{
    generation: number;
    diagnosticDigest: string;
    evidenceBundleDigest: string;
    bindingDigest: string;
    eventRevision: number;
    occurredAtMs: number;
  }> | null;
  readonly diagnosticRoundCount: number;
  readonly diagnosticRoundBudgetProofIds: readonly string[];
  readonly actionReadbackBinding: Readonly<{
    generation: number;
    effectDigest: string;
    effectIdDigest: string;
    eventRevision: number;
    occurredAtMs: number;
  }> | null;
  readonly backpressure: Readonly<{ active: boolean; resumeCursor: string | null; refusedCount: number }>;
  readonly snapshotDigest: string;
}

export interface ShadowCaseTransitionRequest {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly expectedGeneration: number;
  readonly toState: ShadowCaseState;
  readonly occurredAtMs: number;
  readonly reasonCodes: readonly string[];
  readonly evidencePointerIds: readonly string[];
}

export interface ShadowUsage {
  readonly calls: number;
  readonly toolCalls: number;
  readonly webQueries: number;
  readonly tokens: number;
  readonly costMicrounits: number;
  readonly latencyMs: number;
  readonly wallTimeMs: number;
}

export interface ShadowBudgetCaps {
  readonly policyRevision: string;
  readonly perCase: Readonly<ShadowUsage>;
  readonly hourly: Readonly<ShadowUsage>;
  readonly daily: Readonly<ShadowUsage>;
  readonly monthly: Readonly<ShadowUsage>;
  readonly globalHourly: Readonly<ShadowUsage>;
  readonly globalDaily: Readonly<ShadowUsage>;
  readonly globalMonthly: Readonly<ShadowUsage>;
  readonly criticalReserve: Readonly<ShadowUsage>;
}

export interface ShadowUsageReceipt {
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly receiptId: string;
  readonly requestDigest: string;
  readonly caseId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly policyRevision: string;
  readonly budgetAdmissionDigest: string;
  readonly usageRequestDigest: string;
  readonly occurredAtMs: number;
  readonly recordedAtMs: number;
  readonly usage: Readonly<ShadowUsage>;
  readonly criticalityProof: Readonly<ShadowCriticalityProof>;
}

export interface ShadowCriticalityProof {
  readonly schema: 'AI_OPS_A2_CRITICALITY_PROOF_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly caseId: string;
  readonly policyRevision: string;
  readonly critical: boolean;
  readonly authority: 'SYNTHETIC_ONLY';
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly proofDigest: string;
  readonly signature: Readonly<ShadowSignature>;
}

export interface ShadowBudgetState {
  readonly schema: 'AI_OPS_A2_BUDGET_STATE_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly policyRevision: string;
  readonly receipts: readonly Readonly<ShadowUsageReceipt>[];
}

export type ShadowDurableRecordKind = 'INBOX' | 'OUTBOX' | 'DLQ' | 'CASE' | 'ATTEMPT' | 'GLOBAL_EFFECT';

export interface ShadowDurableRecord {
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly recordId: string;
  readonly kind: ShadowDurableRecordKind;
  readonly caseId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadDigest: string;
  readonly generation: number;
  readonly attemptNumber: number;
  readonly parentRecordId: string | null;
  readonly attemptDisposition: 'STARTED' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_TERMINAL' | 'UNKNOWN' | null;
  readonly operationClass?: 'DETERMINISTIC' | 'PROVIDER' | 'EVIDENCE_READ' | 'HANDOFF' | 'GLOBAL_EFFECT';
  readonly priority: 'CRITICAL' | 'NORMAL' | 'COALESCIBLE';
  readonly state: 'PENDING' | 'DELIVERED' | 'DEAD_LETTERED' | 'UNKNOWN';
  readonly occurredAtMs: number;
}

export interface ShadowDurableEnvelope {
  readonly schema: 'AI_OPS_A2_DURABLE_ENVELOPE_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly revision: number;
  readonly recordCapacity: Readonly<{ maximumRecords: number; criticalReserveRecords: number }>;
  readonly caseSnapshot: Readonly<ShadowCaseSnapshot>;
  readonly records: readonly Readonly<ShadowDurableRecord>[];
  readonly envelopeDigest: string;
}

export interface ShadowContextEntry {
  readonly contextId: string;
  readonly ownerId: string;
  readonly authority: 'CANONICAL_OWNER' | 'SHADOW_PROJECTION';
  readonly digest: string;
  readonly status: 'RESOLVED' | 'UNRESOLVED' | 'UNAVAILABLE';
}

export interface ShadowSignature {
  readonly posture: 'SYNTHETIC_ONLY';
  readonly algorithm: string;
  readonly keyId: string;
  readonly signature: string;
}

export interface ShadowSignedContextManifest {
  readonly schema: 'AI_OPS_A2_SIGNED_CONTEXT_MANIFEST_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly caseId: string;
  readonly caseRevision: number;
  readonly generation: number;
  readonly audience: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly policyRevision: string;
  readonly acceptedAuthoritySha: string;
  readonly leaseId: string;
  readonly fenceToken: number;
  readonly budgetStateDigest: string;
  readonly deadlineAtMs: number;
  readonly stopCondition: string;
  readonly nextOwner: string;
  readonly hardDenials: readonly string[];
  readonly priorReceiptIds: readonly string[];
  readonly evidenceBundleDigest: string;
  readonly contextEntries: readonly Readonly<ShadowContextEntry>[];
  readonly omittedContextIds: readonly string[];
  readonly omissionDigest: string;
  readonly payloadDigest: string;
  readonly signature: Readonly<ShadowSignature>;
}

export const AI_OPS_POSTURES = [
  'SHADOW_SPECULATIVE',
  'SYNTHETIC_ONLY',
  'NOT_CONFIGURED',
  'NOT_WIRED',
  'UNKNOWN',
  'MISSING',
  'SILENT',
  'STALE',
  'DEGRADED',
  'BLOCKED',
  'READY',
  'OK',
] as const;

export type AiOpsPosture = (typeof AI_OPS_POSTURES)[number];

export type AiOpsTone = 'ok' | 'warn' | 'bad' | 'idle';

export interface ProjectedSource {
  readonly owner: string;
  readonly sourceId: string;
  readonly revision: string | null;
  readonly observedAt: string | null;
  readonly wiring: 'FIXTURE_ONLY' | 'PENDING_BACKEND' | 'DIRECTOR_MOUNT_REQUIRED';
}

export interface AiOpsFact {
  readonly id: string;
  readonly label: string;
  readonly value: string | number | null;
  readonly unit?: string;
  readonly posture: AiOpsPosture;
  readonly detail: string;
  readonly source: ProjectedSource;
}

export interface AiOpsEvidenceCatalogEntry {
  readonly evidenceId: string;
  readonly kind: 'TREND_SAMPLE' | 'DEDUPE_PROJECTION' | 'POLICY_PROJECTION' | 'EVALUATION_CORPUS';
  readonly sourceId: string;
  readonly observedAt: string;
  readonly hash: string;
  readonly bounded: true;
  readonly posture: 'SYNTHETIC_ONLY';
}

export interface AiOpsComponentProjection {
  readonly componentId: string;
  readonly label: string;
  readonly expected: boolean;
  readonly discovered: boolean | null;
  readonly instrumented: boolean | null;
  readonly reporting: boolean | null;
  readonly posture: AiOpsPosture;
  readonly dependencyIds: readonly string[];
  readonly reason: string;
  readonly source: ProjectedSource;
}

export interface AiOpsOverviewBand {
  readonly bandId: string;
  readonly label: string;
  readonly detail: string;
  readonly facts: readonly AiOpsFact[];
}

export interface AiOpsTrendSeries {
  readonly seriesId: string;
  readonly label: string;
  readonly unit: string;
  readonly metricFamily:
    | 'AGE'
    | 'LATENCY'
    | 'QUEUE'
    | 'EVENT_LOSS'
    | 'RECONCILIATION'
    | 'RECOVERY'
    | 'EXECUTION_COST'
    | 'INCIDENT'
    | 'HOST_CAPACITY'
    | 'RATE_BUDGET';
  readonly percentile: 'P50' | 'P95' | 'P99' | 'NONE';
  readonly window: string;
  readonly resolution: string;
  readonly sampleLimit: number;
  readonly shortWindow: string;
  readonly longWindow: string;
  readonly alertClass: 'PAGE' | 'TICKET' | 'INFORMATIONAL' | 'NONE' | 'UNKNOWN';
  readonly shortWindowBurn: number | null;
  readonly longWindowBurn: number | null;
  readonly drilldownLimit: number;
  readonly drilldownRefs: readonly string[];
  readonly posture: AiOpsPosture;
  readonly samples: readonly {
    readonly at: string;
    readonly value: number | null;
  }[];
  readonly source: ProjectedSource;
}

export interface AiOpsTimelineEvent {
  readonly eventId: string;
  readonly at: string;
  readonly kind: string;
  readonly summary: string;
  readonly posture: AiOpsPosture;
  readonly evidenceIds: readonly string[];
  readonly correlationId: string;
}

export interface AiOpsHypothesis {
  readonly hypothesisId: string;
  readonly statement: string;
  readonly confidence: number | null;
  readonly posture: AiOpsPosture;
  readonly evidenceIds: readonly string[];
  readonly unknowns: readonly string[];
}

export type AiOpsValidationDisposition = 'VALIDATED' | 'INVALIDATED' | 'INCONCLUSIVE';

export interface AiOpsDiagnosticValidationCheck {
  readonly checkId: string;
  readonly category:
    | 'EVIDENCE_POINTER'
    | 'RESOURCE_IDENTITY'
    | 'TIME_WINDOW'
    | 'DEPLOYED_REVISION'
    | 'CONFIG_REVISION'
    | 'CLAIMED_INVARIANT';
  readonly expected: string;
  readonly observed: string | null;
  readonly disposition: AiOpsValidationDisposition;
  readonly reason: string;
  readonly evidenceIds: readonly string[];
}

export interface AiOpsDiagnosticValidationProjection {
  readonly validationId: string;
  readonly claim: string;
  readonly sourceHash: string;
  readonly parserRevision: string;
  readonly sanitizerRevision: string;
  readonly extractionMethod: string;
  readonly confidence: number | null;
  readonly freshness: string;
  readonly temporalRelation: string;
  readonly disposition: AiOpsValidationDisposition;
  readonly checks: readonly AiOpsDiagnosticValidationCheck[];
  readonly validatedEvidenceIds: readonly string[];
  readonly invalidatedHypothesisIds: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly conflictingEvidence: readonly string[];
  readonly falsificationTests: readonly string[];
  readonly nextSteps: readonly string[];
  readonly stopCondition: string;
  readonly effectAuthorized: false;
  readonly expiresAt: string;
  readonly source: ProjectedSource;
}

export interface AiOpsForensicArtifactProjection {
  readonly artifactId: string;
  readonly kind: 'EVIDENCE' | 'TRACE' | 'LOG' | 'DECISION' | 'DIFF' | 'TEST' | 'RECEIPT' | 'POSTMORTEM';
  readonly label: string;
  readonly hash: string | null;
  readonly revision: string | null;
  readonly observedAt: string | null;
  readonly posture: AiOpsPosture;
  readonly bounded: true;
  readonly source: ProjectedSource;
}

export interface AiOpsForensicBundleProjection {
  readonly bundleId: string;
  readonly correlationId: string;
  readonly rawEventEscapeRef: string;
  readonly rawStreamSentToModel: false;
  readonly retention: string;
  readonly access: string;
  readonly artifacts: readonly AiOpsForensicArtifactProjection[];
  readonly unresolved: readonly string[];
  readonly postmortem: {
    readonly required: boolean;
    readonly status: 'NOT_CONFIGURED' | 'DRAFT_ONLY' | 'REVIEWED';
    readonly owner: string | null;
    readonly deadline: string | null;
    readonly regressionTestId: string | null;
  };
}

export interface AiOpsIncidentCommandProjection {
  readonly commandId:
    | 'GATHER_MORE_EVIDENCE'
    | 'RUN_READ_ONLY_REPLAY'
    | 'OPEN_ISOLATED_REPAIR'
    | 'REQUEST_INDEPENDENT_REVIEW'
    | 'REQUEST_ONE_REGISTERED_CLASS_A_RUNBOOK'
    | 'REJECT_PROPOSAL'
    | 'ESCALATE_TO_OWNER'
    | 'ARCHIVE_AFTER_VERIFICATION';
  readonly label: string;
  readonly status: 'NOT_WIRED' | 'OWNER_GATED' | 'BLOCKED';
  readonly reason: string;
  readonly expectedEffect: string;
  readonly authorityCreated: false;
}

export interface AiOpsIncidentProjection {
  readonly caseId: string;
  readonly severity: 'SEV0' | 'SEV1' | 'SEV2' | 'SEV3';
  readonly state: 'OPEN' | 'INVESTIGATING' | 'BLOCKED' | 'CLOSED';
  readonly posture: AiOpsPosture;
  readonly title: string;
  readonly summary: string;
  readonly affectedComponentIds: readonly string[];
  readonly expectedState: string;
  readonly observedState: string;
  readonly freshness: AiOpsFact;
  readonly coherence: AiOpsFact;
  readonly completeness: AiOpsFact;
  readonly suppression: {
    readonly fingerprint: string;
    readonly resourceGeneration: string;
    readonly rawEventCount: number;
    readonly deduplicatedCount: number;
    readonly disposition: 'PAGE' | 'TICKET' | 'DIGEST' | 'STORE_ONLY' | 'DISCARD' | 'UNKNOWN';
    readonly dependencyRootIncidentId: string | null;
    readonly inhibitedBy: string | null;
    readonly inhibitedSymptomIds: readonly string[];
    readonly childEvidencePreserved: true;
    readonly silenceWindow: {
      readonly windowId: string | null;
      readonly kind: 'SILENCE' | 'MAINTENANCE' | 'DEPLOYMENT' | null;
      readonly signedBy: string | null;
      readonly expiresAt: string | null;
      readonly receiptId: string | null;
      readonly status: 'ACTIVE' | 'EXPIRED' | 'NOT_APPLIED' | 'UNKNOWN';
    };
    readonly stormParentId: string | null;
    readonly boundedChildCount: number | null;
    readonly resourceCooldownUntil: string | null;
    readonly globalCooldownUntil: string | null;
    readonly backoffAttempt: number | null;
    readonly jitterMs: number | null;
    readonly criticalReserve: 'RESERVED' | 'NOT_RESERVED' | 'UNKNOWN';
    readonly actionable: boolean | null;
    readonly actionReceipts: readonly {
      readonly action: 'PAGE' | 'TICKET' | 'DIGEST' | 'SUPPRESSION' | 'INHIBITION' | 'DISCARD';
      readonly receiptId: string | null;
      readonly status: 'EMITTED' | 'MISSING' | 'NOT_APPLICABLE';
    }[];
    readonly rawEventEscapeRef: string;
    readonly actionabilityMetrics: {
      readonly duplicateRate: number | null;
      readonly pagesPerIncident: number | null;
      readonly inhibitedSymptoms: number | null;
      readonly falsePageRate: number | null;
      readonly acknowledgementLatencyMs: number | null;
      readonly unresolvedAgeMs: number | null;
      readonly ownerFeedback: string | null;
    };
    readonly reason: string;
    readonly source: ProjectedSource;
  };
  readonly hypotheses: readonly AiOpsHypothesis[];
  readonly failureAtlasMatches: readonly string[];
  readonly timeline: readonly AiOpsTimelineEvent[];
  readonly toolReceipts: readonly AiOpsFact[];
  readonly proposal: AiOpsFact;
  readonly policyDecision: AiOpsFact;
  readonly validation: readonly AiOpsFact[];
  readonly diagnosticValidation: AiOpsDiagnosticValidationProjection;
  readonly forensicBundle: AiOpsForensicBundleProjection;
  readonly commands: readonly AiOpsIncidentCommandProjection[];
}

export interface AiOpsChatMessageProjection {
  readonly messageId: string;
  readonly role: 'OWNER_FIXTURE' | 'AI_FIXTURE' | 'SYSTEM';
  readonly at: string;
  readonly body: string;
  readonly posture: AiOpsPosture;
  readonly evidenceIds: readonly string[];
  readonly capabilityRequest: {
    readonly capabilityId: string;
    readonly expectedEffect: string;
    readonly policyResult: 'NOT_WIRED' | 'BLOCKED' | 'OWNER_GATED';
    readonly cost: string;
    readonly currentState: string;
    readonly authorityCreated: false;
  } | null;
}

export type ControlValue = boolean | number | string | readonly string[] | null;

export type ControlKind = 'BOOLEAN' | 'ENUM' | 'NUMBER' | 'STRING_SET' | 'LOCKED_INVARIANT';

export interface ControlEnvelopeProjection {
  readonly envelopeId: string;
  readonly policyRevision: string;
  readonly requestableValues: readonly ControlValue[];
  readonly authorityOrder: readonly ControlValue[];
  readonly maximumAuthorityValue: ControlValue;
  readonly serverMaximumSummary: string;
  readonly minimumSafetyFloor: string;
  readonly hardDenialsRemainUnreachable: true;
}

export interface AiOpsControlProjection {
  readonly controlId: `AI_OPS.${string}`;
  readonly category: string;
  readonly categoryLabel: string;
  readonly label: string;
  readonly owner: string;
  readonly type: ControlKind;
  readonly allowedValues: readonly ControlValue[];
  readonly safeDefault: ControlValue;
  readonly scope: string;
  readonly environment: string;
  readonly modeCeiling: string;
  readonly effectHandler: string | null;
  readonly readbackHandler: string | null;
  readonly approvalRequirement: string;
  readonly ttl: string | null;
  readonly revision: string;
  readonly lastChangedBy: string;
  readonly reason: string;
  readonly receiptId: string | null;
  readonly currentStatus: 'NOT_WIRED' | 'SYNTHETIC_READBACK';
  readonly requested: ControlValue;
  readonly effective: ControlValue;
  readonly readback: ControlValue;
  readonly changedFromSafeDefault: boolean;
  readonly dependencies: readonly string[];
  readonly conflicts: readonly string[];
  readonly expiresAt: string | null;
  readonly envelope: ControlEnvelopeProjection;
  readonly source: ProjectedSource;
}

export interface AiOpsControlIntentDraft {
  readonly schema: 'AiOpsControlIntentDraftV1';
  readonly controlId: AiOpsControlProjection['controlId'];
  readonly requested: ControlValue;
  readonly baseRevision: string;
  readonly envelopeId: string;
  readonly disposition:
    | 'PENDING_SERVER_POLICY'
    | 'CLIENT_NARROWING_REJECTED'
    | 'NOT_WIRED'
    | 'LOCKED_INVARIANT';
  readonly reason: string;
  readonly effectiveUnchanged: true;
  readonly readbackRequired: true;
  readonly authorityCreated: false;
}

export interface AiOpsEmergencyKillProjection {
  readonly controlId: 'diagnostic-plane.kill';
  readonly commandId: 'SET_DIAGNOSTIC_PLANE_KILL';
  readonly desired: 'ENGAGED';
  readonly requested: 'ENGAGED' | null;
  readonly requestStatus: 'LOCAL_FIXTURE_ONLY';
  readonly effective: 'ENGAGED' | 'DISENGAGED' | 'UNKNOWN';
  readonly readback: 'ENGAGED' | 'DISENGAGED' | 'UNKNOWN';
  readonly readbackAgreement: boolean | null;
  readonly status: 'NOT_WIRED';
  readonly reason: string;
  readonly blockingReason: string;
  readonly effectHandler: string | null;
  readonly readbackHandler: string | null;
  readonly registryRevision: string;
  readonly policyRevision: string;
  readonly lastKnownGoodRevision: string | null;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly receiptId: string | null;
  readonly independentlyObservedAt: string | null;
  readonly quietPeriodEndsAt: string | null;
  readonly selfReenableAllowed: false;
  readonly evidenceRetentionContinues: true;
  readonly financialKillAlias: false;
  readonly postconditions: readonly AiOpsFact[];
  readonly authorityCreated: false;
  readonly source: ProjectedSource;
}

export interface AiOpsProbeProjection {
  readonly probeId: string;
  readonly label: string;
  readonly class:
    | 'PAGE_AUTH'
    | 'ROUTE_WIDGET'
    | 'API_DOM_COHERENCE'
    | 'STALE_OR_MISSING'
    | 'IMPOSSIBLE_GREEN'
    | 'CONTROL'
    | 'THEME_DIFF'
    | 'CONSOLE_NETWORK'
    | 'OWNER_JOURNEY';
  readonly posture: AiOpsPosture;
  readonly observed: string | null;
  readonly expected: string;
  readonly artifactIds: readonly string[];
  readonly source: ProjectedSource;
}

export interface AiOpsGovernanceRow {
  readonly itemId: string;
  readonly family: 'CLASSIFICATION' | 'RUNBOOK' | 'POLICY' | 'PROVIDER' | 'CAPABILITY';
  readonly label: string;
  readonly revision: string;
  readonly posture: AiOpsPosture;
  readonly qualification: string;
  readonly evidence: string;
  readonly source: ProjectedSource;
}

export interface AiOpsProviderQualificationProjection {
  readonly routeId: string;
  readonly role:
    | 'RUNTIME_DIAGNOSTICIAN'
    | 'ENGINEERING_REPAIR_WORKER'
    | 'INDEPENDENT_VERIFICATION_WORKER'
    | 'RESEARCH_CONTEXT_ADVISOR';
  readonly provider: string;
  readonly model: string;
  readonly activationState:
    | 'NOT_CONFIGURED'
    | 'SUBSCRIPTION_CODEX_WORKER'
    | 'SUBSCRIPTION_CLAUDE_CODE_WORKER'
    | 'API_CONFIGURED'
    | 'DIAGNOSTIC_PLANE_UNAVAILABLE';
  readonly runtimeState:
    | 'NOT_CONFIGURED'
    | 'DISABLED'
    | 'READY'
    | 'SHADOW'
    | 'OWNER_GATED'
    | 'ACTIVE_DIAGNOSTIC'
    | 'DEGRADED'
    | 'AUTH_EXPIRED'
    | 'RATE_LIMITED'
    | 'BUDGET_EXHAUSTED'
    | 'QUOTA_EXHAUSTED'
    | 'OUTAGE'
    | 'DIAGNOSTIC_PLANE_UNAVAILABLE'
    | 'BLOCKED_EXTERNAL';
  readonly authType: string | null;
  readonly retention: string | null;
  readonly storeBehavior: string | null;
  readonly backgroundCompatibility: boolean | null;
  readonly region: string | null;
  readonly schemaParity: 'PROVEN' | 'UNPROVEN' | 'UNKNOWN';
  readonly toolDenialParity: 'PROVEN' | 'UNPROVEN' | 'UNKNOWN';
  readonly privacyParity: 'PROVEN' | 'UNPROVEN' | 'UNKNOWN';
  readonly evaluationRevision: string | null;
  readonly budgetId: string | null;
  readonly emergencyReserve: string | null;
  readonly credentialPosture: 'UNKNOWN' | 'NOT_CONFIGURED' | 'EXPIRING' | 'REVOKED';
  readonly qualification: 'QUALIFIED' | 'UNQUALIFIED' | 'BLOCKED';
  readonly fallbackRouteId: string | null;
  readonly fallbackQualified: boolean | null;
  readonly blockedReasons: readonly string[];
  readonly posture: AiOpsPosture;
  readonly source: ProjectedSource;
}

export interface AiOpsCapabilityGraduationMetric {
  readonly metricId:
    | 'LABELED_CASES'
    | 'REPLAY_PASS_RATE'
    | 'FALSE_POSITIVE_RATE'
    | 'FALSE_REPAIR_RATE'
    | 'ABSTENTION_CALIBRATION'
    | 'RECURRENCE_RATE'
    | 'ROLLBACK_RATE'
    | 'COST'
    | 'LATENCY'
    | 'EVIDENCE_COMPLETENESS'
    | 'MAX_UNRESOLVED_SEVERITY';
  readonly unit: string;
  readonly required: number | string | null;
  readonly observed: number | string | null;
  readonly result: 'PASS' | 'FAIL' | 'MISSING';
}

export interface AiOpsCapabilityGraduationProjection {
  readonly capabilityId: string;
  readonly exactScope: string;
  readonly routeId: string;
  readonly modelRevision: string;
  readonly promptRevision: string;
  readonly patchCategory: string;
  readonly currentMode: 'OFF' | 'OBSERVE' | 'SHADOW' | 'ADVISE' | 'SANDBOX_PATCH' | 'BOUNDED_AUTOREMEDIATE';
  readonly proposedMode: 'SHADOW' | 'ADVISE' | 'SANDBOX_PATCH' | 'BOUNDED_AUTOREMEDIATE';
  readonly disposition: 'NO_PROMOTION' | 'PROMOTION_PENDING_OWNER' | 'DEMOTED';
  readonly metrics: readonly AiOpsCapabilityGraduationMetric[];
  readonly independentReviewer: string | null;
  readonly evidenceIds: readonly string[];
  readonly demotionTriggers: readonly string[];
  readonly posture: AiOpsPosture;
  readonly source: ProjectedSource;
}

export interface AiOpsContextManifestProjection {
  readonly manifestId: string;
  readonly generation: number;
  readonly signatureStatus: 'UNSIGNED_FIXTURE' | 'OWNER_SIGNED';
  readonly staticContextHash: string;
  readonly dynamicContextHash: string;
  readonly acceptedSha: string | null;
  readonly baseSha: string;
  readonly deployedSha: string | null;
  readonly authorityPointers: readonly {
    readonly path: string;
    readonly blobHash: string | null;
    readonly status: 'RESOLVED' | 'UNRESOLVED';
  }[];
  readonly inventoryRevision: string;
  readonly dependencyRevision: string;
  readonly classificationRevision: string;
  readonly runbookRevision: string;
  readonly policyRevision: string;
  readonly toolRevision: string;
  readonly controlRegistryRevision: string;
  readonly evaluationRevision: string;
  readonly promptRevision: string;
  readonly providerQualificationRevision: string;
  readonly evidenceBundleHash: string;
  readonly evidenceAgeLimitMs: number;
  readonly validatedEvidenceIds: readonly string[];
  readonly safetyPosture: string;
  readonly leaseId: string | null;
  readonly fencingEpoch: number | null;
  readonly outstandingAmbiguity: string | null;
  readonly provider: string;
  readonly model: string;
  readonly budgets: readonly string[];
  readonly deadline: string;
  readonly allowedTools: readonly string[];
  readonly writeScope: readonly string[];
  readonly hardDenials: readonly string[];
  readonly priorAttemptIds: readonly string[];
  readonly effectReceiptIds: readonly string[];
  readonly unresolvedQuestions: readonly string[];
  readonly exactTask: string;
  readonly acceptanceTests: readonly string[];
  readonly stopCondition: string;
  readonly nextOwner: string;
  readonly generationStatus: 'FAIL_CLOSED_UNRESOLVED_POINTERS' | 'FIXTURE_COMPLETE';
  readonly source: ProjectedSource;
}

export interface AiOpsLineageProjection {
  readonly contextHash: string;
  readonly caseId: string;
  readonly incidentId: string;
  readonly workflowId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly providerTraceId: string | null;
  readonly parentRunId: string | null;
  readonly parentSessionId: string | null;
  readonly replacementReason: 'INITIAL_SESSION' | 'COMPACTION' | 'PROVIDER_REPLACEMENT' | 'CRASH_RECOVERY';
  readonly role: 'RUNTIME_DIAGNOSTICIAN' | 'ENGINEERING_REPAIR_WORKER' | 'INDEPENDENT_VERIFICATION_WORKER' | 'RESEARCH_CONTEXT_ADVISOR';
  readonly phase: 'CLASSIFY' | 'DIAGNOSE' | 'RESEARCH' | 'REPAIR' | 'VERIFY';
  readonly generation: number;
  readonly startedAt: string;
  readonly deadline: string;
  readonly stopCondition: string;
  readonly contextManifestId: string;
  readonly checkpointIds: readonly string[];
  readonly retrievalIds: readonly string[];
  readonly childLineageIds: readonly string[];
  readonly hiddenCrossSessionMemoryAllowed: false;
  readonly promptByteLimit: number;
  readonly retrievedFileLimit: number;
  readonly childAgentLimit: number;
  readonly toolDepthLimit: number;
  readonly iterationLimit: number;
  readonly outputByteLimit: number;
  readonly evidenceHash: string;
  readonly policyRevision: string;
  readonly promptRevision: string;
  readonly toolRevision: string;
  readonly posture: AiOpsPosture;
}

export interface RefreshDockProjection {
  readonly owner: 'RefreshDock';
  readonly endpoint: 'POST /api/refresh';
  readonly target: string;
  readonly targetPosture: string;
  readonly requested: string | null;
  readonly effective: string | null;
  readonly readback: string | null;
  readonly status: 'PROJECTION_ONLY';
  readonly reason: string;
  readonly authorityCreated: false;
  readonly source: ProjectedSource;
}

export interface AiOpsCockpitLevel {
  readonly levelId:
    | 'L1_IMMEDIATE_SAFETY_VIEW'
    | 'L2_INVENTORY_DEPENDENCY_GRAPH'
    | 'L3_AUTOMATION_RESILIENCE'
    | 'L4_MONEY_DECISION_LIFECYCLE'
    | 'L5_INCIDENT_FORENSIC_DRILLDOWN';
  readonly label: string;
  readonly purpose: string;
  readonly posture: AiOpsPosture;
  readonly facts: readonly AiOpsFact[];
}

export interface AiOpsSnapshot {
  readonly schema: 'AiOpsShadowFixtureV1';
  readonly version: 1;
  readonly fixtureId: string;
  readonly posture: 'SHADOW_SPECULATIVE';
  readonly baseSha: string;
  readonly extensionBaseSha: string;
  readonly generatedAt: string;
  readonly environment: 'SYNTHETIC_FIXTURE';
  readonly mountState: 'DIRECTOR_MOUNT_REQUIRED';
  readonly canonicalOwnerState: 'UNFINISHED_I00_INTERFACES';
  readonly safetySummary: readonly AiOpsFact[];
  readonly evidenceCatalog: readonly AiOpsEvidenceCatalogEntry[];
  readonly overviewBands: readonly AiOpsOverviewBand[];
  readonly components: readonly AiOpsComponentProjection[];
  readonly cockpit: readonly AiOpsCockpitLevel[];
  readonly trends: readonly AiOpsTrendSeries[];
  readonly incidents: readonly AiOpsIncidentProjection[];
  readonly selectedCaseId: string;
  readonly chat: readonly AiOpsChatMessageProjection[];
  readonly controls: readonly AiOpsControlProjection[];
  readonly emergencyKill: AiOpsEmergencyKillProjection;
  readonly probes: readonly AiOpsProbeProjection[];
  readonly governance: readonly AiOpsGovernanceRow[];
  readonly providerQualifications: readonly AiOpsProviderQualificationProjection[];
  readonly capabilityGraduations: readonly AiOpsCapabilityGraduationProjection[];
  readonly contextManifest: AiOpsContextManifestProjection;
  readonly lineage: AiOpsLineageProjection;
  readonly refreshDock: RefreshDockProjection;
  readonly unfinishedDependencies: readonly string[];
  readonly assumptions: readonly string[];
}

export interface AiOpsFixtureManifest {
  readonly schema: 'AiOpsShadowFixtureManifestV1';
  readonly version: 1;
  readonly fixtureId: string;
  readonly baseSha: string;
  readonly extensionBaseSha: string;
  readonly generatedAt: string;
  readonly selectedCaseId: string;
  readonly scenario: 'PROVIDER_DEGRADED_WITH_UNFINISHED_OWNERS';
  readonly obviousFakeProvider: string;
  readonly obviousFakeModel: string;
  readonly requestedControlIntents: Readonly<Record<string, ControlValue>>;
}

export interface InsertionRequestRowV1 {
  readonly schema: 'InsertionRequestRowV1';
  readonly version: 1;
  readonly rowId: string;
  readonly status: 'DRAFT';
  readonly requestedOwner: string;
  readonly targetSeam: string;
  readonly reason: string;
  readonly contract: readonly string[];
  readonly tests: readonly string[];
  readonly expectedBehavior: readonly string[];
  readonly wiringState: `PENDING_BACKEND:${string}`;
  readonly authorityCreated: false;
}

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
    readonly deduplicatedCount: number;
    readonly inhibitedBy: string | null;
    readonly actionable: boolean | null;
    readonly reason: string;
  };
  readonly hypotheses: readonly AiOpsHypothesis[];
  readonly failureAtlasMatches: readonly string[];
  readonly timeline: readonly AiOpsTimelineEvent[];
  readonly toolReceipts: readonly AiOpsFact[];
  readonly proposal: AiOpsFact;
  readonly policyDecision: AiOpsFact;
  readonly validation: readonly AiOpsFact[];
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
  readonly requested: 'ENGAGED' | null;
  readonly effective: 'ENGAGED' | 'UNKNOWN';
  readonly readback: 'ENGAGED' | 'UNKNOWN';
  readonly status: 'NOT_WIRED';
  readonly reason: string;
  readonly selfReenableAllowed: false;
  readonly evidenceRetentionContinues: true;
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

export interface AiOpsLineageProjection {
  readonly contextHash: string;
  readonly caseId: string;
  readonly incidentId: string;
  readonly workflowId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly providerTraceId: string | null;
  readonly parentRunId: string | null;
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
  readonly generatedAt: string;
  readonly environment: 'SYNTHETIC_FIXTURE';
  readonly mountState: 'DIRECTOR_MOUNT_REQUIRED';
  readonly canonicalOwnerState: 'UNFINISHED_I00_INTERFACES';
  readonly safetySummary: readonly AiOpsFact[];
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
  readonly wiringState: readonly `PENDING_BACKEND:${string}`[];
  readonly authorityCreated: false;
}

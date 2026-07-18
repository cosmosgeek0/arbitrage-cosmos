import type {
  Completeness,
  ContractResult,
  DataAuthority,
  DesiredRuntimeState,
  FreshnessReport,
  RunMode,
  RuntimePhase,
  SourcedTimestamp,
  StructuredFailure,
} from '../../foundation/contracts/index.js';
import type {
  CompletenessState,
  ProductFamily,
  SourceAuthorityKind,
  SourceEndpointClass,
  StableFailure,
  TruthMetadata as IntelligenceTruthMetadata,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  RuntimeAuthority,
  RuntimeError,
  RuntimeLifecycleState,
} from '../../intelligenceRuntime/contracts/index.js';
import type {
  DialectLossCode,
  SystemComponentId,
  SystemControlCommand,
  SystemOwnerKind,
  SystemReadinessState,
  SystemReleaseStatus,
  SystemSafeMode,
  SystemSemanticStream,
  SystemSourceProducerKind,
  SystemSourceTransport,
  SystemTraceEventKind,
  SystemTruthLabel,
} from './constants.js';

export interface DialectLoss {
  readonly code: DialectLossCode;
  readonly detail: string;
  readonly sourcePath: string | null;
  readonly targetPath: string | null;
}

export type DialectTranslation<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly losses: readonly Readonly<DialectLoss>[];
    }
  | {
      readonly ok: false;
      readonly failure: Readonly<StructuredFailure>;
      readonly losses: readonly Readonly<DialectLoss>[];
    };

export interface SafeModeTranslation {
  readonly safeMode: SystemSafeMode;
  /** Keyless managed lifecycle remains Foundation INTELLIGENCE. */
  readonly foundationRunMode: Extract<RunMode, 'INTELLIGENCE'>;
  /** Read/advisory projection only; this cannot authorize a reservation. */
  readonly capitalObservationMode: SystemSafeMode;
  /** Capital currently requires MANUAL_ARMED for reservation/staging authority. */
  readonly capitalReservationMode: 'UNAVAILABLE';
  readonly coordinatorMode: 'UNAVAILABLE' | 'VALIDATE_ONLY';
  readonly authority: 'NONE';
  readonly liveExecutionPermitted: false;
  readonly requiresPrivateKeys: false;
  readonly translationReasons: readonly string[];
}

export interface SafeModeContext {
  readonly nowMs: number;
  readonly correlationId: string;
  readonly safeCurrentState: string;
}

export interface RuntimeCoverageProjection {
  readonly runtimeCoverage: RuntimeAuthority;
  readonly intelligenceCompleteness: CompletenessState;
  readonly foundationCompleteness: Completeness;
  readonly sampled: boolean;
  readonly losses: readonly Readonly<DialectLoss>[];
}

export interface RuntimeLifecycleEvidenceProjection {
  readonly sourceLifecycle: RuntimeLifecycleState;
  readonly readinessEvidence: SystemReadinessState;
  /** Control Plane alone owns RuntimePhase; source state never supplies it. */
  readonly machinePhase: null;
  readonly fatalEvidence: boolean;
}

export interface IntelligenceAuthorityContext {
  /** Proven acquisition context; MI source kind alone cannot establish this. */
  readonly acquisitionAuthority: DataAuthority;
  readonly upstreamAuthorities?: readonly DataAuthority[];
}

export interface IntelligenceAuthorityProjection {
  readonly sourceKind: SourceAuthorityKind;
  readonly effectiveAuthority: DataAuthority;
  readonly losses: readonly Readonly<DialectLoss>[];
}

export interface IntelligenceTimestampProjectionContext
  extends IntelligenceAuthorityContext,
    SafeModeContext {
  /** Explicit fallback only when the source contract supplies a reviewed policy. */
  readonly explicitMaxAgeMs?: number;
}

export interface StableFailureTranslationContext extends SafeModeContext {
  readonly stage: string;
  readonly recommendedOperatorAction: string;
}

export interface RuntimeFailureTranslationContext extends StableFailureTranslationContext {
  readonly sourceId: string;
}

export type FailureOrigin =
  | {
      readonly kind: 'MARKET_INTELLIGENCE';
      readonly failureId: string;
      readonly field: string | null;
      readonly evidenceIds: readonly string[];
    }
  | {
      readonly kind: 'INTELLIGENCE_RUNTIME';
      readonly sourceId: string;
      readonly rawCode: string;
      readonly observedAtMs: number;
    };

export interface StructuredFailureProjection {
  readonly failure: Readonly<StructuredFailure>;
  readonly origin: Readonly<FailureOrigin>;
  readonly losses: readonly Readonly<DialectLoss>[];
}

export interface OpaqueIdentityAlias {
  readonly systemId: string;
  readonly owner: SystemOwnerKind;
  readonly ownerId: string;
  readonly canonicalProjectionId: string | null;
  readonly correlationId: string;
  readonly revisionDigest: string | null;
}

export interface SystemSourceProducerReference {
  readonly kind: SystemSourceProducerKind;
  readonly producerId: string | null;
  readonly ownerPath: string | null;
  readonly transport: SystemSourceTransport;
}

export interface SystemSourceRegistryRecord {
  readonly sourceId: string;
  readonly semanticStream: SystemSemanticStream;
  readonly dataset: string;
  readonly productFamily: ProductFamily | 'ANY';
  readonly endpointClass: SourceEndpointClass;
  readonly physicalProducer: Readonly<SystemSourceProducerReference>;
  readonly semanticPublisher: Extract<SystemComponentId, 'intelligence-runtime'>;
  readonly consumers: readonly SystemComponentId[];
  readonly releaseStatuses: readonly SystemReleaseStatus[];
  readonly maximumAuthority: DataAuthority;
  readonly duplicatePolicy: 'SINGLE_PRODUCER_ONLY';
  readonly notes: readonly string[];
}

export interface SystemSourceRegistrySnapshot {
  readonly revision: number;
  readonly evaluatedAtMs: number;
  readonly records: readonly Readonly<SystemSourceRegistryRecord>[];
}

export interface SystemQueueSnapshot {
  readonly depth: number;
  readonly capacity: number;
  readonly dropped: number;
  readonly coalesced: number;
  readonly observedAtMs: number;
}

export interface SystemComponentSnapshot {
  readonly componentId: SystemComponentId;
  readonly owner: SystemOwnerKind;
  readonly ownerPath: string;
  readonly releaseStatuses: readonly SystemReleaseStatus[];
  readonly truthLabel: SystemTruthLabel;
  readonly desiredState: DesiredRuntimeState;
  readonly phase: RuntimePhase;
  readonly domainObservedState: string | null;
  readonly sourceLifecycle: RuntimeLifecycleState | null;
  readonly readiness: SystemReadinessState;
  readonly authority: DataAuthority;
  readonly completeness: Completeness;
  readonly sourceTimestamp: Readonly<SourcedTimestamp> | null;
  readonly freshness: Readonly<FreshnessReport> | null;
  readonly lastReceiveAtMs: number | null;
  readonly lastProcessAtMs: number | null;
  readonly lastSuccessAtMs: number | null;
  readonly dependencies: readonly SystemComponentId[];
  readonly queue: Readonly<SystemQueueSnapshot> | null;
  readonly lastFailure: Readonly<StructuredFailure> | null;
  readonly blockerCodes: readonly string[];
  readonly generation: number;
  readonly restartCount: number;
  readonly supportedControls: readonly SystemControlCommand[];
  readonly capitalExposed: boolean;
  readonly operatorAttentionRequired: boolean;
}

export interface SystemDependencyEdge {
  readonly from: SystemComponentId;
  readonly to: SystemComponentId;
  readonly required: boolean;
  readonly state: 'AVAILABLE' | 'DEGRADED' | 'BLOCKED' | 'UNKNOWN';
  readonly rootBlockerComponentId: SystemComponentId | null;
  readonly reasonCodes: readonly string[];
}

export interface SystemControlState {
  readonly revision: number;
  readonly generation: number;
  readonly safeMode: SystemSafeMode;
  readonly killSwitchEngaged: boolean;
  readonly intakePaused: boolean;
  readonly updatedAtMs: number;
  readonly correlationId: string;
}

export type SystemControlMutation =
  | { readonly command: 'SET_COMPONENT_STATE'; readonly componentId: SystemComponentId; readonly desiredState: DesiredRuntimeState }
  | { readonly command: 'SET_INTAKE_PAUSED'; readonly paused: boolean }
  | { readonly command: 'SET_SAFE_MODE'; readonly safeMode: SystemSafeMode }
  | { readonly command: 'SET_KILL_SWITCH'; readonly engaged: boolean }
  | { readonly command: 'APPLY_CONFIGURATION'; readonly configurationRevision: string; readonly payloadDigest: string }
  | { readonly command: 'REVOKE_APPROVAL'; readonly approvalId: string }
  | { readonly command: 'REVOKE_RESERVATION'; readonly reservationId: string }
  | { readonly command: 'RESTART_COMPONENT'; readonly componentId: SystemComponentId }
  | { readonly command: 'CLEAR_DEPLOYMENT_FREEZE'; readonly expectedObservedAtUtc: string }
  | {
      readonly command: 'SET_PUBLIC_SOURCE_LIFECYCLE';
      readonly sourceId: Extract<SystemComponentId, 'public-spot-source' | 'public-usdm-source'>;
      readonly action: 'ISOLATE' | 'RESTART';
    }
  | { readonly command: 'SET_BASIS_SYMBOL_POLICY'; readonly action: 'BLOCK' | 'ALLOW'; readonly symbol: string }
  | { readonly command: 'SET_VOLUME_SYMBOL_POLICY'; readonly action: 'BLOCK' | 'ALLOW'; readonly symbol: string }
  | {
      readonly command: 'REDUCE_SIZE_CEILING';
      readonly scope: 'SYSTEM' | 'BASIS' | 'VOLUME';
      readonly maximumNotionalUsd: string;
    }
  | {
      readonly command: 'SET_STRATEGY_THRESHOLD';
      readonly strategy: 'BASIS' | 'VOLUME';
      readonly threshold: 'MIN_NET_BASIS_PCT' | 'VOLUME_1S_MULTIPLE';
      readonly value: string;
    };

export interface SystemControlMutationRequest {
  readonly idempotencyKey: string;
  readonly expectedRevision: number;
  readonly reason: string;
  readonly requestedAtMs: number;
  readonly correlationId: string;
  readonly mutation: Readonly<SystemControlMutation>;
}

export interface SystemControlMutationReceipt {
  readonly applied: boolean;
  readonly code: string;
  readonly before: Readonly<SystemControlState>;
  readonly after: Readonly<SystemControlState>;
  readonly ledgerEventId: number | null;
}

export type SystemControlMutationResult = ContractResult<Readonly<SystemControlMutationReceipt>>;

export interface SystemTraceEvent {
  readonly id: string;
  readonly sequence: number;
  readonly kind: SystemTraceEventKind;
  readonly componentId: SystemComponentId;
  readonly correlationId: string;
  readonly occurredAtMs: number;
  readonly persistedAtMs: number | null;
  readonly truthLabel: SystemTruthLabel;
  readonly releaseStatuses: readonly SystemReleaseStatus[];
  readonly ownerId: string | null;
  readonly canonicalProjectionId: string | null;
  readonly revisionDigest: string | null;
  readonly domainLifecycle: string | null;
  readonly machinePhase: RuntimePhase | null;
  readonly failure: Readonly<StructuredFailure> | null;
  readonly referenceIds: readonly string[];
  readonly lossCodes: readonly DialectLossCode[];
}

export interface SystemTraceSnapshot {
  readonly correlationId: string;
  readonly evaluatedAtMs: number;
  readonly events: readonly Readonly<SystemTraceEvent>[];
  readonly truncated: boolean;
}

export interface SystemSupervisorSnapshot {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly evaluatedAtMs: number;
  readonly phase: RuntimePhase;
  readonly control: Readonly<SystemControlState>;
  readonly truthLabel: SystemTruthLabel;
  readonly components: readonly Readonly<SystemComponentSnapshot>[];
  readonly edges: readonly Readonly<SystemDependencyEdge>[];
  readonly rootBlockerComponentIds: readonly SystemComponentId[];
  readonly operatorAttentionComponentIds: readonly SystemComponentId[];
}

export type {
  Completeness,
  DataAuthority,
  DialectLossCode,
  DesiredRuntimeState,
  FreshnessReport,
  IntelligenceTruthMetadata,
  RunMode,
  RuntimeAuthority,
  RuntimeError,
  RuntimeLifecycleState,
  RuntimePhase,
  SourcedTimestamp,
  StableFailure,
  StructuredFailure,
  SystemComponentId,
  SystemControlCommand,
  SystemOwnerKind,
  SystemReadinessState,
  SystemReleaseStatus,
  SystemSafeMode,
  SystemSemanticStream,
  SystemSourceProducerKind,
  SystemSourceTransport,
  SystemTraceEventKind,
  SystemTruthLabel,
};

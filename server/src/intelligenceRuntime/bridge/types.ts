import type {
  EvidenceKind,
  NormalizedEvidence,
  StableFailure,
  ThesisPacket,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  AttentionAllocation,
  AttentionPlan,
  AttentionPlannerConfig,
  AttentionPlannerConfigInput,
  AttentionSourceQuality,
  StrategyCandidateHintPort,
} from '../../intelligenceFoundation/attention/index.js';
import type {
  FeatureBankConfig,
  FeatureBankStats,
  FeatureSnapshot,
} from '../../intelligenceFoundation/features/index.js';
import type {
  ForensicsConfig,
  ForensicsReport,
} from '../../intelligenceFoundation/forensics/index.js';
import type { FreezePreEventInput } from '../../intelligenceFoundation/outcomes/index.js';
import type { ThesisRules } from '../../intelligenceFoundation/thesis/index.js';
import type {
  ProtectedSymbolPort,
  RuntimeClock,
} from '../contracts/index.js';

export type BridgeEvidenceScope = 'BROAD' | 'FOCUSED';

/**
 * Source adapters retain raw transport ownership. The bridge consumes only
 * already-normalized public evidence plus the runtime correlation root that
 * produced it.
 */
export interface CorrelatedEvidenceBatch {
  correlationId: string;
  scope: BridgeEvidenceScope;
  evidence: readonly NormalizedEvidence[];
  qualityFailures?: readonly StableFailure[];
}

export interface BridgeLimitsInput {
  maximumUniverseNodes: number;
  maximumUniverseGraphBytes: number;
  maximumEvidenceBatch: number;
  maximumEvidenceBytes: number;
  maximumEvidenceNodes: number;
  maximumEvidenceStringBytes: number;
  maximumEvidenceArrayLength: number;
  maximumEvidenceNestingDepth: number;
  maximumDepthLevels: number;
  maximumProvenanceIds: number;
  maximumIndexedEvidence: number;
  maximumEvidencePerSymbol: number;
  maximumEvidencePerSymbolKind: number;
  maximumLineageEntries: number;
  maximumCorrelationRootsPerEntry: number;
  maximumArtifacts: number;
  maximumFailureRecords: number;
  maximumHintPorts: number;
  maximumThesisEvidence: number;
  maximumThesisFeatures: number;
}

export interface IntelligenceBridgeConfigInput extends Partial<BridgeLimitsInput> {
  configurationVersion?: string;
  featureBank?: Partial<FeatureBankConfig>;
  attention?: AttentionPlannerConfigInput;
  forensics?: Partial<ForensicsConfig>;
}

export interface IntelligenceBridgeConfig extends BridgeLimitsInput {
  configurationVersion: string;
  featureBank: FeatureBankConfig;
  attention: AttentionPlannerConfig;
  forensics: Readonly<ForensicsConfig>;
  thesis: ThesisRules;
}

export interface IntelligenceBridgeOptions {
  clock: RuntimeClock;
  protectedSymbols?: ProtectedSymbolPort;
  config?: IntelligenceBridgeConfigInput;
}

export interface BridgeFailureRecord {
  failure: StableFailure;
  count: number;
  firstObservedAtMs: number;
  lastObservedAtMs: number;
}

export interface BridgeEvidenceIngestReceipt {
  correlationId: string;
  scope: BridgeEvidenceScope;
  received: number;
  accepted: number;
  rejected: number;
  duplicate: number;
  evicted: number;
  failures: readonly StableFailure[];
}

export type CorrelationStage =
  | 'SOURCE'
  | 'EVIDENCE'
  | 'FEATURE'
  | 'HINT'
  | 'ATTENTION'
  | 'CANDIDATE'
  | 'THESIS'
  | 'FORENSICS'
  | 'FREEZE_REQUEST';

export interface CorrelationLinkSnapshot {
  id: string;
  stage: CorrelationStage;
  correlationIds: readonly string[];
  observedAtMs: number;
  rootsTruncated: number;
}

export interface CorrelationIndexSnapshot {
  size: number;
  capacity: number;
  evicted: number;
  truncatedRoots: number;
  links: readonly CorrelationLinkSnapshot[];
}

export interface EvidenceIndexStats {
  size: number;
  capacity: number;
  maximumPerSymbol: number;
  maximumPerSymbolKind: number;
  duplicateCount: number;
  evictedCount: number;
  historicallyTruncatedSymbolCount: number;
  currentTruncationWindowMs: number;
  truncatedSymbolOverflowCount: number;
  truncatedSymbols: readonly string[];
}

export type FeatureProjectionStatus = 'DIRECT' | 'COMPOSITE' | 'UNAVAILABLE' | 'NON_EQUIVALENT';

export interface ProjectedFeatureBinding {
  requestedFeature: string;
  status: FeatureProjectionStatus;
  featureNames: readonly string[];
  windowMs: number | null;
  reasonCodes: readonly string[];
}

/** Public-only projection; it never mutates the canonical attention plan. */
export interface PublicAttentionAllocation {
  allocationId: string;
  instrumentId: string;
  symbol: string;
  tier: AttentionAllocation['tier'];
  priority: number | null;
  protected: boolean;
  requestedEvidence: readonly EvidenceKind[];
  excludedEvidence: readonly EvidenceKind[];
  requestedFeatures: readonly ProjectedFeatureBinding[];
  correlationIds: readonly string[];
  reasonCodes: readonly string[];
}

export interface PublicAttentionProjection {
  sourcePlanId: string;
  atMs: number;
  allocations: readonly PublicAttentionAllocation[];
  excludedPrivateEvidenceCount: number;
  authority: 'PUBLIC_OBSERVATION_ONLY';
}

export interface InstrumentQualityOverride {
  instrumentId: string;
  sourceQuality: AttentionSourceQuality;
}

export interface BridgeEvaluationInput {
  hintPorts?: readonly StrategyCandidateHintPort[];
  sourceQuality?: readonly InstrumentQualityOverride[];
}

export interface OperatorFocusPinReadback {
  symbol: string;
  pinned: boolean;
  eligible: boolean | null;
  canPin: boolean;
  effectivePinned: boolean | null;
  effectiveTier: AttentionAllocation['tier'] | null;
  attentionPlanId: string | null;
  attentionPlanAtMs: number | null;
  pinCount: number;
  pinCapacity: number;
}

export interface BridgeIntelligenceArtifact {
  id: string;
  candidateId: string;
  instrumentId: string;
  symbol: string;
  evaluatedAtMs: number;
  featureSnapshot: FeatureSnapshot;
  evidenceIds: readonly string[];
  thesis: ThesisPacket;
  forensics: ForensicsReport;
  correlationIds: readonly string[];
  authority: 'EVIDENCE_ONLY';
}

export interface BridgeFreezeRequest {
  id: string;
  candidateId: string;
  correlationIds: readonly string[];
  input: FreezePreEventInput;
  authority: 'OUTCOME_CAPTURE_REQUEST_ONLY';
}

export interface BridgePendingCandidateTrigger {
  candidateId: string;
  instrumentId: string;
  transitionAtMs: number;
}

export interface BridgeEvaluationResult {
  atMs: number;
  attentionPlan: AttentionPlan | null;
  publicAttention: PublicAttentionProjection | null;
  artifacts: readonly BridgeIntelligenceArtifact[];
  freezeRequests: readonly BridgeFreezeRequest[];
  failures: readonly StableFailure[];
}

export interface IntelligenceBridgeSnapshot {
  id: string;
  snapshotTimeMs: number;
  configurationVersion: string;
  universeGraphId: string | null;
  universeNodeCount: number;
  featureBank: FeatureBankStats;
  evidenceIndex: EvidenceIndexStats;
  correlationIndex: CorrelationIndexSnapshot;
  attentionPlan: AttentionPlan | null;
  publicAttention: PublicAttentionProjection | null;
  artifacts: readonly BridgeIntelligenceArtifact[];
  pendingCandidateTriggers: readonly BridgePendingCandidateTrigger[];
  failures: readonly BridgeFailureRecord[];
  authority: 'EVIDENCE_ONLY';
  liveMoneyAuthority: 'NONE';
  createsProposal: false;
  createsRiskVerdict: false;
  executesAction: false;
}

export interface BridgeUniverseReceipt {
  accepted: boolean;
  graphId: string | null;
  nodeCount: number;
  failure: StableFailure | null;
}

export interface IndexedEvidenceRecord {
  evidence: NormalizedEvidence;
  scope: BridgeEvidenceScope;
  correlationIds: readonly string[];
}

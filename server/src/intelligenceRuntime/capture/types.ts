import type {
  FrozenPreEventRecord,
  JsonValue,
  NormalizedEvidence,
  StableFailure,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  AttributedOutcomeLabel,
  FreezePreEventInput,
  OutcomePolicy,
  OutcomePolicySnapshot,
} from '../../intelligenceFoundation/outcomes/index.js';
import type {
  CaptureStoragePort,
  RuntimeClock,
} from '../contracts/index.js';

export interface CaptureCoordinatorConfigInput {
  checkpointId?: string;
  declaredConfigurationVersion?: string;
  preTriggerWindowMs?: number;
  maximumPostWindowMs?: number;
  captureRetentionMs?: number;
  maximumPreRings?: number;
  maximumRingEvictionTombstones?: number;
  maximumPreEvidencePerRing?: number;
  maximumFreezeEvidence?: number;
  maximumPostEvidencePerCapture?: number;
  maximumActiveCaptures?: number;
  maximumRetainedCaptures?: number;
  maximumPoliciesPerCapture?: number;
  maximumRequiredSources?: number;
  maximumCorrelationIds?: number;
  maximumTriggerTombstones?: number;
  maximumFailureRecords?: number;
  maximumEvidenceBytes?: number;
  maximumCheckpointBytes?: number;
}

export interface CaptureCoordinatorConfig {
  readonly checkpointId: string;
  readonly checkpointSchemaVersion: '1';
  readonly producerVersion: 'live-intelligence-capture-1';
  readonly configurationVersion: string;
  readonly declaredConfigurationVersion: string;
  readonly preTriggerWindowMs: number;
  readonly maximumPostWindowMs: number;
  readonly captureRetentionMs: number;
  readonly maximumPreRings: number;
  readonly maximumRingEvictionTombstones: number;
  readonly maximumPreEvidencePerRing: number;
  readonly maximumFreezeEvidence: number;
  readonly maximumPostEvidencePerCapture: number;
  readonly maximumActiveCaptures: number;
  readonly maximumRetainedCaptures: number;
  readonly maximumPoliciesPerCapture: number;
  readonly maximumRequiredSources: number;
  readonly maximumCorrelationIds: number;
  readonly maximumTriggerTombstones: number;
  readonly maximumFailureRecords: number;
  readonly maximumEvidenceBytes: number;
  readonly maximumCheckpointBytes: number;
}

export interface CaptureCoordinatorOptions {
  clock: RuntimeClock;
  storage: CaptureStoragePort;
  config?: CaptureCoordinatorConfigInput;
}

export interface CaptureEvidenceInput {
  evidence: NormalizedEvidence;
  correlationIds?: readonly string[];
}

export interface CaptureEvidenceRecord {
  evidence: NormalizedEvidence;
  correlationIds: readonly string[];
  ingestedAtMs: number;
  checksum: string;
}

export interface CaptureIngestReceipt {
  state: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED';
  evidenceId: string | null;
  symbol: string | null;
  sourceId: string | null;
  preRingEvictedRecords: number;
  postCaptureCount: number;
  postTruncatedCaptureCount: number;
  failure: StableFailure | null;
}

export interface CaptureTriggerInput {
  triggerRequestId: string;
  symbol: string;
  correlationIds?: readonly string[];
  requiredSourceIds: readonly string[];
  freezeInput: FreezePreEventInput;
  postWindowMs: number;
  outcomePolicies: readonly OutcomePolicy[];
}

export interface CaptureTriggerReceipt {
  state: 'CREATED' | 'DUPLICATE' | 'REJECTED';
  triggerRequestId: string | null;
  captureId: string | null;
  capture: RuntimeCaptureSnapshot | null;
  evictedCaptureIds: readonly string[];
  failure: StableFailure | null;
}

export type CaptureHorizonState = 'PENDING' | 'COMPLETE' | 'INCOMPLETE' | 'TRUNCATED' | 'FAILED';

export interface CaptureHorizonSnapshot {
  policy: OutcomePolicySnapshot;
  dueAtMs: number;
  state: CaptureHorizonState;
  label: AttributedOutcomeLabel | null;
  failure: StableFailure | null;
}

export interface CaptureSourceVersionIdentity {
  sourceId: string;
  producerVersions: readonly string[];
  configurationVersions: readonly string[];
  featureVersions: readonly string[];
}

export interface CaptureTruncationSnapshot {
  preTrigger: boolean;
  postTrigger: boolean;
  preDroppedRecords: number;
  postDroppedRecords: number;
  reasonCodes: readonly string[];
}

export interface CaptureCompletenessSnapshot {
  state: 'COLLECTING' | 'COMPLETE' | 'INCOMPLETE' | 'TRUNCATED';
  missingRequiredSourceIds: readonly string[];
  reasonCodes: readonly string[];
}

export interface RuntimeCaptureSnapshot {
  id: string;
  triggerRequestId: string;
  requestFingerprint: string;
  triggerFingerprint: string;
  symbol: string;
  instrumentId: string;
  triggerTimeMs: number;
  evidenceCutoffTimeMs: number;
  preWindowStartMs: number;
  postWindowEndMs: number;
  createdAtMs: number;
  finishedAtMs: number | null;
  correlationIds: readonly string[];
  requiredSourceIds: readonly string[];
  sourceVersions: readonly CaptureSourceVersionIdentity[];
  frozenRecord: FrozenPreEventRecord;
  preEvidence: readonly CaptureEvidenceRecord[];
  postEvidence: readonly CaptureEvidenceRecord[];
  horizons: readonly CaptureHorizonSnapshot[];
  truncation: CaptureTruncationSnapshot;
  completeness: CaptureCompletenessSnapshot;
  preChecksum: string;
  postChecksum: string;
  checksum: string;
}

export interface CaptureRingSnapshot {
  symbol: string;
  sourceId: string;
  retainedRecords: number;
  oldestSourceEventTimeMs: number | null;
  newestSourceEventTimeMs: number | null;
  capacityEvictedRecords: number;
  capacityDroppedThroughEventTimeMs: number | null;
  checksum: string;
}

export interface CaptureFailureRecord {
  failure: StableFailure;
  count: number;
  firstObservedAtMs: number;
  lastObservedAtMs: number;
}

export interface CaptureCoordinatorSnapshot {
  id: string;
  snapshotTimeMs: number;
  configurationVersion: string;
  checkpointId: string;
  checkpointGeneration: number;
  checkpointDirty: boolean;
  preRingCount: number;
  retainedCaptureCount: number;
  activeCaptureCount: number;
  completedCaptureCount: number;
  evictedRingCount: number;
  ringEvictionTombstoneCount: number;
  ringEvictionOverflowDroppedRecords: number;
  evictedCaptureCount: number;
  evictedTriggerTombstoneCount: number;
  rings: readonly CaptureRingSnapshot[];
  captures: readonly RuntimeCaptureSnapshot[];
  failures: readonly CaptureFailureRecord[];
  authority: 'PUBLIC_EVIDENCE_CAPTURE_ONLY';
  liveMoneyAuthority: 'NONE';
}

export interface CaptureTickReceipt {
  atMs: number;
  completedHorizons: number;
  incompleteHorizons: number;
  truncatedHorizons: number;
  failedHorizons: number;
  finalizedCaptures: number;
  evictedCaptureIds: readonly string[];
  failures: readonly StableFailure[];
}

export interface CaptureCheckpointReceipt {
  state: 'SAVED' | 'SAVED_DIRTY' | 'UNCHANGED' | 'FAILED';
  checkpointId: string;
  generation: number;
  checksum: string | null;
  bytes: number | null;
  savedMutationVersion: number | null;
  currentMutationVersion: number;
  checkpointDirty: boolean;
  failure: StableFailure | null;
}

export interface CaptureRestoreReceipt {
  state: 'RESTORED' | 'EMPTY' | 'FAILED';
  checkpointId: string;
  generation: number;
  restoredRings: number;
  restoredCaptures: number;
  checksum: string | null;
  failure: StableFailure | null;
}

/** The storage port accepts JSON only; this alias documents checkpoint boundaries. */
export type CaptureCheckpointJson = JsonValue;

/**
 * Deterministic replay for sealed prospective Volume evidence.
 *
 * Replay owns no clock, network, filesystem, environment, random source,
 * persistence coordinator, or exchange capability. It verifies caller-supplied
 * evidence, reconstructs public source cuts, and records a shadow lifecycle.
 * The synthetic policies used below are only adapters into the accepted pure
 * record validators; their economics are never surfaced as measured economics.
 */
import { createHash } from 'node:crypto';
import {
  canonicalJson,
  stableHash128Hex,
} from '../../foundation/contracts/index.js';
import {
  addExactDecimals,
  compareExactDecimals,
  divideExactDecimals,
  multiplyExactDecimals,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  subtractExactDecimals,
  type ExactDecimal,
} from '../../capitalFoundation/contracts/index.js';
import {
  VOLUME_FORWARD_MEASUREMENT_AUTHORITY,
  VOLUME_FORWARD_MEASUREMENT_LIMITS,
  applyVolumeForwardDepthInput,
  buildVolumeForwardDetectorProposalBinding,
  buildVolumeForwardPointInTimeControls,
  createVolumeForwardDepthState,
  parseVolumeForwardDepthSnapshot,
  parseVolumeForwardExchangeInfo,
  parseVolumeForwardPublicPayload,
  validateVolumeForwardDetectorCoveragePolicy,
  validateVolumeForwardMeasurementPolicy,
  type VolumeForwardAggregateTrade,
  type VolumeForwardBookTicker,
  type VolumeForwardDepthDiff,
  type VolumeForwardDepthSnapshot,
  type VolumeForwardDetectorProposalBinding,
  type VolumeForwardMeasurementPolicy,
  type VolumeForwardDetectorCoveragePolicy,
  type VolumeForwardPointInTimeControls,
  type VolumeForwardPublicPayload,
  type VolumeForwardTrade,
} from './forwardMeasurement.js';
import {
  VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS,
  VOLUME_FORWARD_MEASUREMENT_DETECTOR_COVERAGE_CUT_SCHEMA,
  VOLUME_FORWARD_MEASUREMENT_SEGMENT_PROFILE,
  VOLUME_FORWARD_MEASUREMENT_SEGMENT_SEAL_SCHEMA,
  decodeVolumeForwardMeasurementEvidenceRawBytes,
  verifyVolumeForwardMeasurementEvidenceChain,
  type VolumeForwardMeasurementDetectorCoverageCut,
  type VolumeForwardMeasurementDetectorCoverageProposal,
  type VolumeForwardMeasurementEvidenceRecord,
} from './forwardMeasurementEvidence.js';
import {
  VOLUME_PUBLIC_REST_BASE_URL,
  VOLUME_PUBLIC_SOURCE_ID,
  VOLUME_PUBLIC_WEBSOCKET_BASE_URL,
  buildVolumeStrategyObservation,
  type VolumeStrategyObservation,
} from './strategyObservation.js';
import {
  createSyntheticVolumeEconomics,
} from './strategyEconomics.js';
import {
  evaluateVolumeStrategy,
  type VolumeStrategyEvaluation,
  type VolumeStrategyProposalBinding,
} from './strategySlice.js';
import {
  buildSyntheticVolumeEconomicExitPolicy,
  evaluateVolumeEconomicExit,
  type VolumeEconomicExitDecision,
  type VolumeEconomicExitPolicy,
  type VolumeForwardExitSample,
} from './strategyEconomicExit.js';

export const VOLUME_FORWARD_MEASUREMENT_REPLAY_SCHEMA_VERSION =
  'cosmos.engine.volume.forward-measurement-replay.v1' as const;
export const VOLUME_FORWARD_MEASUREMENT_REPLAY_MODE =
  'SHADOW_MEASUREMENT_RECORD_ONLY' as const;
export const VOLUME_FORWARD_MEASUREMENT_TERMINAL_SEGMENT_PROFILE =
  'TERMINAL_SEGMENT' as const;
export const VOLUME_FORWARD_MEASUREMENT_SEGMENT_PURPOSE =
  'FORWARD_MEASUREMENT_SEGMENT_V1' as const;
export const VOLUME_FORWARD_MEASUREMENT_CONSUMER_GATE =
  'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED' as const;

export const VOLUME_FORWARD_MEASUREMENT_REPLAY_REASONS = Object.freeze([
  'REPLAY_INPUT_INVALID',
  'REPLAY_AUTHORITY_INVALID',
  'REPLAY_OPERATION_LIMIT_EXCEEDED',
  'EVIDENCE_CHAIN_INVALID',
  'POLICY_INVALID',
  'POLICY_DIGEST_MISMATCH',
  'SOURCE_PAYLOAD_INVALID',
  'SOURCE_SYMBOL_MISMATCH',
  'SOURCE_GENERATION_CHANGED',
  'SOURCE_CONTINUITY_NOT_EXACT',
  'SOURCE_CUT_AFTER_PROPOSAL',
  'DEPTH_NOT_SYNCHRONIZED',
  'SOURCE_DEPTH_SNAPSHOT_HORIZON_EXHAUSTED',
  'AGG_TRADE_EVIDENCE_MISSING',
  'TRADE_EVIDENCE_MISSING',
  'BOOK_TICKER_EVIDENCE_MISSING',
  'BOOK_TICKER_DEPTH_MISMATCH',
  'BOOK_TICKER_STALE',
  'EXCHANGE_INFO_MISSING',
  'EXCHANGE_FILTERS_INVALID',
  'EXACT_ENTRY_NOTIONAL_UNAVAILABLE',
  'CONFIG_STATE_MISSING',
  'CONFIG_STATE_MISMATCH',
  'KILL_STATE_MISSING',
  'KILL_STATE_NOT_ENGAGED',
  'DETECTOR_PROPOSAL_INVALID',
  'DETECTOR_PSEUDO_PROPOSAL_EXCLUDED',
  'DETECTOR_PROPOSAL_DUPLICATED',
  'DETECTOR_PROPOSAL_EXPIRED',
  'OBSERVATION_REJECTED',
  'RECORD_ONLY_EVALUATION_REJECTED',
  'RECORD_ONLY_EXIT_POLICY_REJECTED',
  'OUTCOME_CUT_MISSING',
  'RECORDED_LIFECYCLE_INVALID',
  'RECORDED_LIFECYCLE_MISMATCH',
  'SEGMENT_DESCRIPTOR_INVALID',
  'SEGMENT_COVERAGE_INVALID',
  'SEGMENT_NOT_QUIESCENT',
  'NO_DETECTOR_PROPOSAL',
] as const);

export type VolumeForwardMeasurementReplayReason =
  (typeof VOLUME_FORWARD_MEASUREMENT_REPLAY_REASONS)[number];

export interface VolumeForwardMeasurementEvidenceSourceRef {
  readonly kind:
    Readonly<VolumeForwardMeasurementEvidenceRecord>['header']['kind'];
  readonly recordHash: string;
  readonly rawSha256: string;
  readonly sequence: number;
  readonly sourceEndpoint: string;
  readonly sourceStream: string | null;
  readonly sourceTransport:
    Readonly<VolumeForwardMeasurementEvidenceRecord>['header']['sourceTransport'];
  readonly generation: number;
  readonly localReceivedAtMs: number;
  readonly localMonotonicNs: string;
}

export interface VolumeForwardMeasurementReplayInput {
  readonly evidenceRecords:
    readonly Readonly<VolumeForwardMeasurementEvidenceRecord>[];
  readonly expectedPolicyDigest: `sha256:${string}`;
  readonly expectedTerminalHash: `sha256:${string}`;
}

export interface VolumeForwardMeasurementTerminalSegmentProposalFact {
  readonly proposalId: string;
  readonly proposalRevision: number;
  readonly proposalDigest: string;
  readonly symbol: string;
}

export interface VolumeForwardMeasurementTerminalSegmentDetectorProposalFact
  extends VolumeForwardMeasurementTerminalSegmentProposalFact {
  readonly cutOffset: number;
  readonly detectorDecisionDigest: string;
  readonly featureDigest: string;
}

export interface VolumeForwardMeasurementTerminalSegmentLifecycleFact
  extends VolumeForwardMeasurementTerminalSegmentProposalFact {
  readonly state: 'TERMINAL' | 'BLOCKED';
}

export interface VolumeForwardMeasurementTerminalSegmentFacts {
  readonly schemaVersion: 've2.evidence-segment-descriptor.v1';
  readonly profile:
    typeof VOLUME_FORWARD_MEASUREMENT_TERMINAL_SEGMENT_PROFILE;
  readonly purpose:
    typeof VOLUME_FORWARD_MEASUREMENT_SEGMENT_PURPOSE;
  readonly activationId: string;
  readonly captureId: string;
  readonly segmentId: string;
  readonly coverageRole: 'DETECTOR_COVERAGE' | 'SYMBOL_LIFECYCLE';
  readonly chainKey: string;
  readonly symbol: string | null;
  readonly segmentIndex: number;
  readonly previousTerminalHash: string | null;
  readonly corePolicyDigest: string;
  readonly packetMeasurementPolicySha256: string;
  readonly terminalHash: string;
  readonly evidenceBytesSha256: string;
  readonly detectorInputSourceId: string;
  readonly detectorInputSourceDigest: string;
  readonly coverageStartMs: number;
  readonly coverageEndExclusiveMs: number;
  readonly firstRecordHash: string;
  readonly lastRecordHash: string;
  readonly firstLocalReceivedAtMs: number;
  readonly lastLocalReceivedAtMs: number;
  readonly firstLocalMonotonicNs: string;
  readonly lastLocalMonotonicNs: string;
  readonly recordCount: number;
  readonly canonicalJsonlBytes: number;
  readonly cumulativeRawPayloadBytes: number;
  readonly generationCount: number;
  readonly allGenerationsClosed: true;
  readonly continuityGapCount: number;
  readonly unresolvedContinuityGapCount: 0;
  readonly detectorCutFirstIndex: number | null;
  readonly detectorCutCount: number;
  readonly detectorExpectedCutCount: number;
  readonly detectorCadenceMs: number | null;
  readonly missingDetectorCutCount: 0;
  readonly detectorMissingCutRanges: readonly [];
  readonly maximumDetectorCutGapMs: number;
  readonly sourceUncoveredDurationMs: 0;
  readonly detectorBatchPreviousDigest: string | null;
  readonly detectorBatchTerminalDigest: string | null;
  readonly detectorEvaluationUniverseDigest: string | null;
  readonly detectorEvaluationUniverseCount: number;
  readonly detectorCoverageComplete: boolean;
  readonly acceptedProposals:
    readonly Readonly<
      VolumeForwardMeasurementTerminalSegmentDetectorProposalFact
    >[];
  readonly acceptedProposalIds: readonly string[];
  readonly pseudoProposalExcludedCount: number;
  readonly lifecycleProposals:
    readonly Readonly<VolumeForwardMeasurementTerminalSegmentLifecycleFact>[];
  readonly lifecycleProposalIds: readonly string[];
  readonly lifecycleCount: number;
  readonly terminalLifecycleCount: number;
  readonly blockedLifecycleCount: number;
  readonly openLifecycleCount: 0;
  readonly nonTruncated: true;
  readonly quiescent: true;
  readonly profitabilityClaim: false;
  readonly consumerGate:
    typeof VOLUME_FORWARD_MEASUREMENT_CONSUMER_GATE;
}

export interface VolumeForwardMeasurementSourceBinding {
  readonly policyDigest: string;
  readonly proposalId: string;
  readonly proposalRevision: number;
  readonly proposalDigest: string;
  readonly configurationRevision: string;
  readonly correlationId: string;
  readonly symbol: string;
  readonly direction: 'long' | 'short';
  readonly configRecordHash: string;
  readonly killRecordHash: string;
  readonly exchangeInfoRecordHash: string;
  readonly entryEvidenceSources:
    readonly Readonly<VolumeForwardMeasurementEvidenceSourceRef>[];
  readonly exitEvidenceSources:
    readonly Readonly<VolumeForwardMeasurementEvidenceSourceRef>[];
  readonly entryGeneration: number;
  readonly entrySourceRevision: number;
  readonly entryValidatorAdapterObservationDigest: `vobs_${string}`;
  readonly exitGeneration: number | null;
  readonly exitSourceRevision: number | null;
  readonly exitValidatorAdapterObservationDigest: `vobs_${string}` | null;
  readonly validatorAdapterOnly: true;
}

export interface VolumeForwardMeasurementRejectionBinding {
  readonly disposition: 'REJECTED_SOURCE_BOUND';
  readonly proposalId: string;
  readonly proposalRevision: number;
  readonly proposalDigest: string;
  readonly configurationRevision: string;
  readonly correlationId: string;
  readonly symbol: string;
  readonly direction: 'long' | 'short';
  readonly proposalRecordHash: string;
  readonly causeRecordHash: string;
  readonly causeRecordSequence: number;
  readonly causeRecordKind:
    Readonly<VolumeForwardMeasurementEvidenceRecord>['header']['kind'];
  readonly causeLocalReceivedAtMs: number;
  readonly causeLocalMonotonicNs: string;
  readonly reasonCodes: readonly VolumeForwardMeasurementReplayReason[];
  readonly evidenceSources:
    readonly Readonly<VolumeForwardMeasurementEvidenceSourceRef>[];
  readonly executionAuthority: 'NONE';
  readonly submitAuthority: 'NONE';
  readonly sendEligible: false;
  readonly sends: 0;
  readonly sideEffects: 0;
}

export interface VolumeForwardMeasurementLifecycleRecord {
  readonly schemaVersion:
    typeof VOLUME_FORWARD_MEASUREMENT_REPLAY_SCHEMA_VERSION;
  readonly lifecycleId: `vfm_lifecycle_${string}`;
  readonly state: 'EXACT' | 'BLOCKED';
  readonly reasonCodes: readonly VolumeForwardMeasurementReplayReason[];
  readonly binding: Readonly<VolumeForwardMeasurementSourceBinding> | null;
  readonly rejectionBinding:
    Readonly<VolumeForwardMeasurementRejectionBinding> | null;
  readonly entryEvaluation: null;
  readonly exitDecision: null;
  readonly validatorAdapterOnly: true;
  readonly validatorAdapterProof: Readonly<{
    readonly entryEvaluationId: string;
    readonly entryPlanId: string;
    readonly exitDecisionId: string | null;
    readonly exitPlanId: string | null;
    readonly runtimeStrategyEnabled: false;
    readonly validatorAdapterEvaluationEnabled: true;
    readonly killSwitchEngaged: true;
    readonly executionAuthority: 'NONE';
    readonly submitAuthority: 'NONE';
    readonly sendEligible: false;
    readonly sends: 0;
    readonly sideEffects: 0;
    readonly publicOnly: true;
    readonly privateCalls: false;
    readonly signedCalls: false;
    readonly providerCalls: false;
    readonly entryModeledBaseQuantity: string;
    readonly entryModeledLimitPrice: string;
    readonly entryModeledQuoteNotional: '10';
    readonly capturedRestBaseUrl: 'https://data-api.binance.vision';
    readonly capturedWebsocketBaseUrl:
      'wss://data-stream.binance.vision';
    readonly legacyValidatorRestBaseUrl: 'https://api.binance.com';
    readonly provenanceDisposition:
      'CAPTURED_SOURCE_AUTHORITATIVE_VALIDATOR_ADAPTER_NON_AUTHORITATIVE';
  }> | null;
  readonly terminalSampleId: `vfes_${string}` | null;
  readonly lifecyclePhase:
    | 'ENTRY_RECORDED'
    | 'HOLDING'
    | 'TERMINAL_EXIT'
    | 'BLOCKED';
  readonly sourceNativeEconomics: Readonly<{
    readonly state: 'PUBLIC_SOURCE_FACTS_ONLY' | 'UNKNOWN';
    readonly entryQuoteNotional: string | null;
    readonly entryBaseQuantity: string | null;
    readonly entryLimitPrice: string | null;
    readonly exitQuoteNotional: string | null;
    readonly grossPnlQuote: string | null;
    readonly grossEdgePer1000ValuationNotional: string | null;
    readonly publicFeeScenarios: readonly Readonly<{
      readonly feeBpsPerSide: '10' | '12';
      readonly netPnlQuote: string;
      readonly netEdgePer1000ValuationNotional: string;
    }>[];
    readonly accountEffectiveFeeBpsPerSide: null;
  }>;
  readonly profitabilityClaim: false;
}

export interface VolumeForwardMeasurementReplayResult {
  readonly schemaVersion:
    typeof VOLUME_FORWARD_MEASUREMENT_REPLAY_SCHEMA_VERSION;
  readonly replayId: `vfm_replay_${string}`;
  readonly state: 'EXACT' | 'BLOCKED';
  readonly reasonCodes: readonly VolumeForwardMeasurementReplayReason[];
  readonly chainId: string | null;
  readonly policyDigest: string | null;
  readonly evidencePolicyDigest: string | null;
  readonly terminalHash: string | null;
  readonly sourceAuthenticity: 'TRUSTED_ANCHOR_MATCHED' | null;
  readonly trustedAnchors: Readonly<{
    readonly expectedPolicyDigest: string;
    readonly expectedTerminalHash: string;
    readonly policyDigestMatched: true;
    readonly terminalHashMatched: true;
  }> | null;
  readonly evidenceRecordCount: number;
  readonly replayProfile:
    | 'SMOKE_MECHANICS_ONLY'
    | typeof VOLUME_FORWARD_MEASUREMENT_TERMINAL_SEGMENT_PROFILE
    | null;
  readonly segmentFacts:
    Readonly<VolumeForwardMeasurementTerminalSegmentFacts> | null;
  readonly lifecycles:
    readonly Readonly<VolumeForwardMeasurementLifecycleRecord>[];
  readonly consumerGate:
    typeof VOLUME_FORWARD_MEASUREMENT_CONSUMER_GATE;
  readonly economics: null;
  readonly profitabilityClaim: false;
  readonly mode: 'SHADOW_ONLY';
  readonly measurementMode:
    typeof VOLUME_FORWARD_MEASUREMENT_REPLAY_MODE;
  readonly recordOnly: true;
  readonly strategyEnabled: false;
  readonly killSwitchEngaged: true;
  readonly submitAuthority: false;
  readonly casAuthority: false;
  readonly privateOrSignedCalls: 0;
  readonly orders: 0;
  readonly transfers: 0;
  readonly withdrawals: 0;
  readonly moneyUsd: 0;
}

type DataRecord = Readonly<Record<string, unknown>>;
type ReplayPolicy =
  | Readonly<VolumeForwardMeasurementPolicy>
  | Readonly<VolumeForwardDetectorCoveragePolicy>;
type PublicPayload =
  | VolumeForwardPublicPayload
  | VolumeForwardDepthSnapshot;
type DepthState = ReturnType<typeof createVolumeForwardDepthState>;

interface RecordedCut<T extends PublicPayload = PublicPayload> {
  readonly payload: T;
  readonly record: Readonly<VolumeForwardMeasurementEvidenceRecord>;
}

interface ConfigCut {
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly combinedUrl: string;
  readonly enabled: false;
  readonly depthLimit: 100;
  readonly purpose:
    | 'SMOKE_MECHANICS_ONLY'
    | typeof VOLUME_FORWARD_MEASUREMENT_SEGMENT_PURPOSE;
  readonly recordHash: string;
  readonly receivedAtMs: number;
  readonly record: Readonly<VolumeForwardMeasurementEvidenceRecord>;
}

interface KillCut {
  readonly engaged: true;
  readonly killStateDigest: string;
  readonly recordHash: string;
  readonly receivedAtMs: number;
  readonly record: Readonly<VolumeForwardMeasurementEvidenceRecord>;
}

interface FilterCut {
  readonly symbol: string;
  readonly quoteAsset: 'USDT';
  readonly minPrice: ExactDecimal;
  readonly maxPrice: ExactDecimal;
  readonly tickSize: ExactDecimal;
  readonly minQuantity: ExactDecimal;
  readonly maxQuantity: ExactDecimal;
  readonly stepSize: ExactDecimal;
  readonly minNotional: ExactDecimal;
  readonly maxNotional: ExactDecimal | null;
  readonly filterDigest: string;
  readonly recordHash: string;
  readonly receivedAtMs: number;
  readonly record: Readonly<VolumeForwardMeasurementEvidenceRecord>;
}

interface ProposalCut
  extends VolumeStrategyProposalBinding,
    VolumeForwardDetectorProposalBinding {
  readonly recordHash: string;
  readonly receivedAtMs: number;
  readonly record: Readonly<VolumeForwardMeasurementEvidenceRecord>;
}

interface MutableSourceState {
  generation: number;
  combinedUrl: string;
  generationOpenRecord:
    Readonly<VolumeForwardMeasurementEvidenceRecord>;
  depth: DepthState | null;
  snapshotLastUpdateId: number | null;
  depthRecord: Readonly<VolumeForwardMeasurementEvidenceRecord> | null;
  depthProofRecords: Array<
    Readonly<VolumeForwardMeasurementEvidenceRecord>
  >;
  depthDiffRecordByRange: Map<
    string,
    Readonly<VolumeForwardMeasurementEvidenceRecord>
  >;
  depthDiffRangeRing: string[];
  depthDiffRangeRingCursor: number;
  aggregateTrade: RecordedCut | null;
  tradesById: Map<number, RecordedCut>;
  tradeIdentityById: Map<number, string>;
  conflictingTradeIds: Set<number>;
  bookTicker: RecordedCut | null;
  filter: FilterCut | null;
  continuityExact: boolean;
  continuityObserved: boolean;
  continuityRecord:
    Readonly<VolumeForwardMeasurementEvidenceRecord> | null;
  streamFrameByTypedRecordHash: Map<
    string,
    Readonly<VolumeForwardMeasurementEvidenceRecord>
  >;
  streamLedger: Array<Readonly<{
    frame: Readonly<VolumeForwardMeasurementEvidenceRecord>;
    payload: VolumeForwardPublicPayload;
    typed: Readonly<VolumeForwardMeasurementEvidenceRecord>;
  }>>;
  detectorProposalRecordHash: string | null;
  lifecycleAssertionCount: number;
  lastContinuityRangeCount: number;
  invalidFrame: boolean;
}

interface MutableLifecycle {
  proposal: ProposalCut;
  state: 'PENDING_ENTRY' | 'ACTIVE' | 'TERMINAL' | 'BLOCKED';
  reasons: VolumeForwardMeasurementReplayReason[];
  binding: VolumeForwardMeasurementSourceBinding | null;
  rejectionBinding: VolumeForwardMeasurementRejectionBinding | null;
  entryObservation: Readonly<VolumeStrategyObservation> | null;
  entryEvaluation: Readonly<VolumeStrategyEvaluation> | null;
  exitPolicy: Readonly<VolumeEconomicExitPolicy> | null;
  priorSample: Readonly<VolumeForwardExitSample> | null;
  exitDecision: Readonly<VolumeEconomicExitDecision> | null;
  terminalSampleId: `vfes_${string}` | null;
  validatorExpiresAtMs: number;
  entryMonotonicNs: bigint | null;
  lastEvaluationMonotonicNs: bigint | null;
  initialExitDecisionId: `vexitdecision_${string}` | null;
  initialSampleId: `vfes_${string}` | null;
  entryRecordSequence: number | null;
  terminalRecordSequence: number | null;
  entrySourceRecordHash: string | null;
  terminalSourceRecordHash: string | null;
  blockedSourceRecordHash: string | null;
  blockedSourceSequence: number | null;
  entryModeledFill: Readonly<ModeledEntryFill> | null;
  terminalExitQuoteNotional: ExactDecimal | null;
}

interface LifecycleAssertion {
  readonly proposalId: string;
  readonly state:
    | 'OBSERVED'
    | 'ENTRY_RECORDED'
    | 'HOLDING'
    | 'TERMINAL_EXIT'
    | 'BLOCKED'
    | 'EXACT';
  readonly sequence: number;
  readonly recordHash: string;
  readonly proposalDigest: string;
  readonly transitionRevision: number;
  readonly previousLifecycleRecordHash: string | null;
  readonly sourceRecordHash: string;
  readonly reasonCodes:
    readonly VolumeForwardMeasurementReplayReason[] | null;
}

interface ParsedDetectorCoverageCut {
  readonly value: Readonly<VolumeForwardMeasurementDetectorCoverageCut>;
  readonly record: Readonly<VolumeForwardMeasurementEvidenceRecord>;
}

interface ParsedSegmentSeal {
  readonly activationId: string;
  readonly captureId: string;
  readonly segmentId: string;
  readonly coverageRole: 'DETECTOR_COVERAGE' | 'SYMBOL_LIFECYCLE';
  readonly chainKey: string;
  readonly symbol: string | null;
  readonly segmentIndex: number;
  readonly previousTerminalHash: string | null;
  readonly corePolicyDigest: string;
  readonly packetMeasurementPolicySha256: string;
  readonly detectorInputSourceId: string;
  readonly detectorInputSourceDigest: string;
  readonly coverageStartMs: number;
  readonly coverageEndExclusiveMs: number;
  readonly recordBounds: DataRecord;
  readonly closeReason: string;
  readonly generationSummary: DataRecord;
  readonly detectorCoverage: DataRecord;
  readonly acceptedProposals:
    readonly Readonly<VolumeForwardMeasurementTerminalSegmentProposalFact>[];
  readonly lifecycleSummary: DataRecord;
  readonly pseudoProposalExcludedCount: number;
}

interface GenerationFact {
  readonly generation: number;
  readonly gapDetected: boolean;
  readonly continuityExact: boolean;
}

const MAX_UTC_MS = 4_102_444_800_000;
const SHA256_ANCHOR = /^sha256:[a-f0-9]{64}$/;
const RAW_SHA256 = /^[a-f0-9]{64}$/;
const ACTIVATION_ID = /^ve2_activation_[a-f0-9]{64}$/;
const SEGMENT_ID = /^ve2_segment_[a-f0-9]{64}$/;
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SEGMENT_SYMBOL = /^[A-Z0-9]{2,32}$/;
const CANONICAL_PROPOSAL_DIGEST = /^[A-Za-z][A-Za-z0-9_-]{2,191}$/;
const DETECTOR_COVERAGE_CUT_HASH_DOMAIN =
  'VOLUME_FORWARD_DETECTOR_COVERAGE_CUT_V1';
const FROZEN_PACKET_POLICY_SHA256 =
  '96cf89ce2825a930e6f66c8d0d7b606f7d42670cf36b953f9f93c5b4ff2a2067';
const TARGET_QUOTE_NOTIONAL = normalizeExactDecimal('10');
const ZERO = normalizeExactDecimal('0');
const SYNTHETIC_DISABLED_THRESHOLD =
  normalizeNonNegativeExactDecimal('999999999999999999999999');
const MIN_EXIT_DELAY_NS = 60_000_000_000n;
const MAX_SOURCE_CUT_AGE_NS = 2_000_000_000n;
const MAX_SOURCE_CUT_AGE_MS = 2_000;
const MAX_TRADE_PROOF = 20_000;
const MAX_DEPTH_DIFF_RECORDS = 20_000;
const MAX_REPLAY_OPERATION_UNITS = 10_000_000;
const MAX_GENERATION_STREAM_FRAMES = 100_000;

const FROZEN_PACKET_RULES = Object.freeze({
  activationMinimumLeadMs: 86_400_000,
  warmupDurationMs: 14_400_000,
  measurementDurationMs: 2_592_000_000,
  maturityLagMs: 62_000,
  proposalAdmissionClosesAtIntervalEnd: true,
  evidenceClosesAfterProposalAdmissionMs: 62_000,
  evaluationCutPeriodMs: 2_000,
  maximumHoldMs: 60_000,
  entryQuoteNotional: '10.00',
  sampleUniverseMode: 'PROSPECTIVE_ACCEPTED_DETECTOR_PROPOSALS',
  proposalOrigin: 'VOLUME_DETECTOR',
  completeAcceptedProposalSetRequired: true,
  nonPseudoProposalRequired: true,
  pointInTimeEligibilityRequired: true,
  currentStateSubstitutionForbidden: true,
});

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value as Readonly<T>;
  }
  seen.add(value);
  for (const child of Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

function dataRecord(value: unknown): DataRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => (
      typeof key !== 'string'
      || key === '__proto__'
      || key === 'constructor'
      || key === 'prototype'
    ))) return null;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        return null;
      }
    }
    return value as DataRecord;
  } catch {
    return null;
  }
}

function exactDataKeys(
  value: DataRecord,
  expected: readonly string[],
): boolean {
  return Object.keys(value).sort().join('|')
    === [...expected].sort().join('|');
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function safeUtcMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_UTC_MS
    && !Object.is(value, -0);
}

function validIdentifier(value: unknown, maximum = 256): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function exactDecimal(value: unknown, positive = false): ExactDecimal | null {
  if (typeof value !== 'string') return null;
  try {
    const normalized = normalizeExactDecimal(value);
    if (positive && compareExactDecimals(normalized, ZERO) <= 0) return null;
    return normalized;
  } catch {
    return null;
  }
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function rawJson(
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
): unknown {
  const decoded = decodeVolumeForwardMeasurementEvidenceRawBytes(record);
  return decoded.ok ? parseJsonBytes(decoded.bytes) : null;
}

function detectorCoverageCutDigest(value: DataRecord): string | null {
  try {
    const body = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'cutDigest'),
    );
    const hash = createHash('sha256');
    hash.update(DETECTOR_COVERAGE_CUT_HASH_DOMAIN, 'utf8');
    hash.update(Uint8Array.of(0));
    hash.update(canonicalJson(body), 'utf8');
    return `sha256:${hash.digest('hex')}`;
  } catch {
    return null;
  }
}

function parseCoverageProposal(
  value: unknown,
  cutOffset: number,
): Readonly<VolumeForwardMeasurementDetectorCoverageProposal> | null {
  const proposal = dataRecord(value);
  if (
    proposal === null
    || !exactDataKeys(proposal, [
      'cutOffset',
      'detectorDecisionDigest',
      'featureDigest',
      'proposalDigest',
      'proposalId',
      'proposalRevision',
      'symbol',
    ])
    || proposal.cutOffset !== cutOffset
    || !validIdentifier(proposal.proposalId)
    || !Number.isSafeInteger(proposal.proposalRevision)
    || (proposal.proposalRevision as number) < 1
    || typeof proposal.proposalDigest !== 'string'
    || !CANONICAL_PROPOSAL_DIGEST.test(proposal.proposalDigest)
    || typeof proposal.symbol !== 'string'
    || !SEGMENT_SYMBOL.test(proposal.symbol)
    || typeof proposal.detectorDecisionDigest !== 'string'
    || !CANONICAL_PROPOSAL_DIGEST.test(proposal.detectorDecisionDigest)
    || typeof proposal.featureDigest !== 'string'
    || !CANONICAL_PROPOSAL_DIGEST.test(proposal.featureDigest)
  ) return null;
  return Object.freeze({
    cutOffset,
    proposalId: proposal.proposalId,
    proposalRevision: proposal.proposalRevision as number,
    proposalDigest: proposal.proposalDigest,
    symbol: proposal.symbol,
    detectorDecisionDigest: proposal.detectorDecisionDigest,
    featureDigest: proposal.featureDigest,
  });
}

function coverageProposalSortKey(
  proposal: Readonly<VolumeForwardMeasurementDetectorCoverageProposal>,
): string {
  return [
    proposal.symbol,
    proposal.proposalId,
    String(proposal.proposalRevision).padStart(16, '0'),
    proposal.proposalDigest,
    proposal.detectorDecisionDigest,
    proposal.featureDigest,
  ].join('|');
}

function parseDetectorCoverageCut(
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
): Readonly<ParsedDetectorCoverageCut> | null {
  const value = dataRecord(rawJson(record));
  if (
    value === null
    || !exactDataKeys(value, [
      'acceptedProposals',
      'activationId',
      'cadenceMs',
      'captureId',
      'chainKey',
      'complete',
      'configurationDigest',
      'configurationRevision',
      'cutAtMs',
      'cutDigest',
      'cutOffset',
      'detectorInputSourceDigest',
      'detectorInputSourceId',
      'detectorTickRevision',
      'evaluationUniverseCount',
      'evaluationUniverseDigest',
      'killSwitchEngaged',
      'localMonotonicNs',
      'localReceivedAtMs',
      'observerDropCount',
      'observerFailureCount',
      'previousCutDigest',
      'profile',
      'pseudoProposalExcludedCount',
      'runtimeGeneration',
      'schemaVersion',
      'segmentId',
      'strategyEnabled',
    ])
    || value.schemaVersion
      !== VOLUME_FORWARD_MEASUREMENT_DETECTOR_COVERAGE_CUT_SCHEMA
    || value.profile !== VOLUME_FORWARD_MEASUREMENT_SEGMENT_PROFILE
    || !validIdentifier(value.captureId)
    || typeof value.activationId !== 'string'
    || !ACTIVATION_ID.test(value.activationId)
    || typeof value.segmentId !== 'string'
    || !SEGMENT_ID.test(value.segmentId)
    || !validIdentifier(value.chainKey)
    || typeof value.detectorInputSourceId !== 'string'
    || !SOURCE_ID.test(value.detectorInputSourceId)
    || typeof value.detectorInputSourceDigest !== 'string'
    || !SHA256_ANCHOR.test(value.detectorInputSourceDigest)
    || !Number.isSafeInteger(value.runtimeGeneration)
    || (value.runtimeGeneration as number) < 1
    || !Number.isSafeInteger(value.detectorTickRevision)
    || (value.detectorTickRevision as number) < 1
    || !Number.isSafeInteger(value.cutOffset)
    || (value.cutOffset as number) < 0
    || !safeUtcMs(value.cutAtMs)
    || value.localReceivedAtMs !== record.header.localReceivedAtMs
    || value.localMonotonicNs !== record.header.localMonotonicNs
    || value.cadenceMs !== VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
    || !validIdentifier(value.configurationRevision)
    || typeof value.configurationDigest !== 'string'
    || !SHA256_ANCHOR.test(value.configurationDigest)
    || value.strategyEnabled !== false
    || value.killSwitchEngaged !== true
    || typeof value.evaluationUniverseDigest !== 'string'
    || !SHA256_ANCHOR.test(value.evaluationUniverseDigest)
    || !Number.isSafeInteger(value.evaluationUniverseCount)
    || (value.evaluationUniverseCount as number) < 0
    || !Number.isSafeInteger(value.pseudoProposalExcludedCount)
    || (value.pseudoProposalExcludedCount as number) < 0
    || !Number.isSafeInteger(value.observerDropCount)
    || (value.observerDropCount as number) < 0
    || !Number.isSafeInteger(value.observerFailureCount)
    || (value.observerFailureCount as number) < 0
    || (
      value.cutOffset === 0
        ? value.previousCutDigest !== null
        : (
            typeof value.previousCutDigest !== 'string'
            || !SHA256_ANCHOR.test(value.previousCutDigest)
          )
    )
    || typeof value.cutDigest !== 'string'
    || !SHA256_ANCHOR.test(value.cutDigest)
    || detectorCoverageCutDigest(value) !== value.cutDigest
    || typeof value.complete !== 'boolean'
    || (
      value.complete === true
      && (
        value.observerDropCount !== 0
        || value.observerFailureCount !== 0
      )
    )
    || !Array.isArray(value.acceptedProposals)
    || value.acceptedProposals.length > 10_000
    || (
      value.acceptedProposals.length === 0
      && value.complete !== true
    )
    || (value.evaluationUniverseCount as number)
      < value.acceptedProposals.length
  ) return null;
  const acceptedProposals =
    value.acceptedProposals.map((proposal) => (
      parseCoverageProposal(proposal, value.cutOffset as number)
    ));
  if (acceptedProposals.some((proposal) => proposal === null)) return null;
  const typedProposals = acceptedProposals as readonly Readonly<
    VolumeForwardMeasurementDetectorCoverageProposal
  >[];
  const proposalIds = new Set<string>();
  let priorSortKey: string | null = null;
  for (const proposal of typedProposals) {
    const sortKey = coverageProposalSortKey(proposal);
    if (
      proposalIds.has(proposal.proposalId)
      || (priorSortKey !== null && compareText(sortKey, priorSortKey) <= 0)
    ) return null;
    proposalIds.add(proposal.proposalId);
    priorSortKey = sortKey;
  }
  return Object.freeze({
    value: Object.freeze({
      ...(value as unknown as VolumeForwardMeasurementDetectorCoverageCut),
      acceptedProposals: Object.freeze(typedProposals),
    }),
    record,
  });
}

function parseSegmentProposalFact(
  value: unknown,
): Readonly<VolumeForwardMeasurementTerminalSegmentProposalFact> | null {
  const proposal = dataRecord(value);
  if (
    proposal === null
    || !exactDataKeys(proposal, [
      'proposalDigest',
      'proposalId',
      'proposalRevision',
      'symbol',
    ])
    || !validIdentifier(proposal.proposalId)
    || !Number.isSafeInteger(proposal.proposalRevision)
    || (proposal.proposalRevision as number) < 1
    || typeof proposal.proposalDigest !== 'string'
    || !CANONICAL_PROPOSAL_DIGEST.test(proposal.proposalDigest)
    || typeof proposal.symbol !== 'string'
    || !SEGMENT_SYMBOL.test(proposal.symbol)
  ) return null;
  return Object.freeze({
    proposalId: proposal.proposalId,
    proposalRevision: proposal.proposalRevision as number,
    proposalDigest: proposal.proposalDigest,
    symbol: proposal.symbol,
  });
}

function segmentProposalSortKey(
  proposal: Readonly<VolumeForwardMeasurementTerminalSegmentProposalFact>,
): string {
  return [
    proposal.symbol,
    proposal.proposalId,
    String(proposal.proposalRevision).padStart(16, '0'),
    proposal.proposalDigest,
  ].join('|');
}

function parseSegmentSeal(
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
): Readonly<ParsedSegmentSeal> | null {
  const value = dataRecord(rawJson(record));
  const coverage = value === null ? null : dataRecord(value.coverage);
  const recordBounds = value === null ? null : dataRecord(value.recordBounds);
  const generationSummary = value === null
    ? null
    : dataRecord(value.generationSummary);
  const detectorCoverage = value === null
    ? null
    : dataRecord(value.detectorCoverage);
  const lifecycleSummary = value === null
    ? null
    : dataRecord(value.lifecycleSummary);
  const stateCounts = lifecycleSummary === null
    ? null
    : dataRecord(lifecycleSummary.stateCounts);
  if (
    value === null
    || !exactDataKeys(value, [
      'acceptedProposals',
      'activationId',
      'captureId',
      'chainKey',
      'closeReason',
      'corePolicyDigest',
      'coverage',
      'coverageRole',
      'detectorCoverage',
      'detectorInputSourceDigest',
      'detectorInputSourceId',
      'generationSummary',
      'lifecycleSummary',
      'nonTruncated',
      'packetMeasurementPolicySha256',
      'previousTerminalHash',
      'profile',
      'pseudoProposalExcludedCount',
      'quiescent',
      'recordBounds',
      'schemaVersion',
      'segmentId',
      'segmentIndex',
      'symbol',
    ])
    || value.schemaVersion
      !== VOLUME_FORWARD_MEASUREMENT_SEGMENT_SEAL_SCHEMA
    || value.profile !== VOLUME_FORWARD_MEASUREMENT_SEGMENT_PURPOSE
    || !validIdentifier(value.captureId)
    || typeof value.activationId !== 'string'
    || !ACTIVATION_ID.test(value.activationId)
    || typeof value.segmentId !== 'string'
    || !SEGMENT_ID.test(value.segmentId)
    || (
      value.coverageRole !== 'DETECTOR_COVERAGE'
      && value.coverageRole !== 'SYMBOL_LIFECYCLE'
    )
    || !validIdentifier(value.chainKey)
    || !Number.isSafeInteger(value.segmentIndex)
    || (value.segmentIndex as number) < 0
    || (
      value.segmentIndex === 0
        ? value.previousTerminalHash !== null
        : (
            typeof value.previousTerminalHash !== 'string'
            || !SHA256_ANCHOR.test(value.previousTerminalHash)
          )
    )
    || typeof value.corePolicyDigest !== 'string'
    || !SHA256_ANCHOR.test(value.corePolicyDigest)
    || typeof value.packetMeasurementPolicySha256 !== 'string'
    || !RAW_SHA256.test(value.packetMeasurementPolicySha256)
    || typeof value.detectorInputSourceId !== 'string'
    || !SOURCE_ID.test(value.detectorInputSourceId)
    || typeof value.detectorInputSourceDigest !== 'string'
    || !SHA256_ANCHOR.test(value.detectorInputSourceDigest)
    || coverage === null
    || !exactDataKeys(coverage, ['endExclusiveMs', 'startMs'])
    || !safeUtcMs(coverage.startMs)
    || !safeUtcMs(coverage.endExclusiveMs)
    || (coverage.endExclusiveMs as number) <= (coverage.startMs as number)
    || recordBounds === null
    || !exactDataKeys(recordBounds, [
      'byteCount',
      'firstHash',
      'firstSequence',
      'lastSequence',
      'recordCount',
      'sealedTailHash',
    ])
    || generationSummary === null
    || !exactDataKeys(generationSummary, [
      'continuityGapCount',
      'count',
      'unresolvedCount',
    ])
    || detectorCoverage === null
    || !exactDataKeys(detectorCoverage, [
      'complete',
      'coverageChainKey',
      'cutCount',
      'expectedCutCount',
      'firstCutDigest',
      'firstCutOffset',
      'lastCutDigest',
      'lastCutOffset',
      'maxGapMs',
      'missingCutCount',
      'uncoveredMs',
    ])
    || lifecycleSummary === null
    || !exactDataKeys(lifecycleSummary, [
      'assertionCount',
      'openCount',
      'proposalKeys',
      'stateCounts',
    ])
    || stateCounts === null
    || !exactDataKeys(stateCounts, [
      'BLOCKED',
      'ENTRY_RECORDED',
      'EXACT',
      'HOLDING',
      'OBSERVED',
      'TERMINAL_EXIT',
    ])
    || !validIdentifier(value.closeReason)
    || value.nonTruncated !== true
    || value.quiescent !== true
    || !Number.isSafeInteger(value.pseudoProposalExcludedCount)
    || (value.pseudoProposalExcludedCount as number) < 0
    || !Array.isArray(value.acceptedProposals)
  ) return null;
  if (
    value.coverageRole === 'DETECTOR_COVERAGE'
      ? value.symbol !== null
      : typeof value.symbol !== 'string'
        || !SEGMENT_SYMBOL.test(value.symbol)
  ) return null;
  const proposals = value.acceptedProposals.map(parseSegmentProposalFact);
  if (proposals.some((proposal) => proposal === null)) return null;
  const typedProposals = proposals as readonly Readonly<
    VolumeForwardMeasurementTerminalSegmentProposalFact
  >[];
  const ids = new Set<string>();
  let prior: string | null = null;
  for (const proposal of typedProposals) {
    const key = segmentProposalSortKey(proposal);
    if (
      ids.has(proposal.proposalId)
      || (prior !== null && compareText(key, prior) <= 0)
    ) return null;
    ids.add(proposal.proposalId);
    prior = key;
  }
  return Object.freeze({
    activationId: value.activationId,
    captureId: value.captureId,
    segmentId: value.segmentId,
    coverageRole: value.coverageRole,
    chainKey: value.chainKey,
    symbol: value.symbol as string | null,
    segmentIndex: value.segmentIndex as number,
    previousTerminalHash: value.previousTerminalHash as string | null,
    corePolicyDigest: value.corePolicyDigest,
    packetMeasurementPolicySha256: value.packetMeasurementPolicySha256,
    detectorInputSourceId: value.detectorInputSourceId,
    detectorInputSourceDigest: value.detectorInputSourceDigest,
    coverageStartMs: coverage.startMs as number,
    coverageEndExclusiveMs: coverage.endExclusiveMs as number,
    recordBounds,
    closeReason: value.closeReason,
    generationSummary,
    detectorCoverage,
    acceptedProposals: Object.freeze(typedProposals),
    lifecycleSummary,
    pseudoProposalExcludedCount:
      value.pseudoProposalExcludedCount as number,
  });
}

function orderedReasons(
  reasons: Iterable<VolumeForwardMeasurementReplayReason>,
): readonly VolumeForwardMeasurementReplayReason[] {
  const selected = new Set(reasons);
  return Object.freeze(
    VOLUME_FORWARD_MEASUREMENT_REPLAY_REASONS.filter((reason) => (
      selected.has(reason)
    )),
  );
}

function replayIdentity(value: unknown): `vfm_replay_${string}` {
  return `vfm_replay_${stableHash128Hex(
    `volume.forward-measurement.replay.v1|${canonicalJson(value)}`,
  )}`;
}

function lifecycleIdentity(value: unknown): `vfm_lifecycle_${string}` {
  return `vfm_lifecycle_${stableHash128Hex(
    `volume.forward-measurement.lifecycle.v1|${canonicalJson(value)}`,
  )}`;
}

function authorityIsExact(): boolean {
  const authority = VOLUME_FORWARD_MEASUREMENT_AUTHORITY;
  return authority.enabled === false
    && authority.killSwitchEngaged === true
    && authority.mode === 'SHADOW_ONLY'
    && authority.recordOnly === true
    && authority.productionAdmissible === false
    && authority.executionAuthority === 'NONE'
    && authority.submitAuthority === 'NONE'
    && authority.casAuthority === 'NONE'
    && authority.privateDataAuthority === 'NONE'
    && authority.keyAuthority === 'NONE'
    && authority.providerAuthority === 'NONE'
    && authority.hostAuthority === 'NONE'
    && authority.networkCallsDuringReplay === 0
    && authority.fsWrites === 0;
}

function exactCombinedStreams(
  value: unknown,
  policy: Readonly<VolumeForwardMeasurementPolicy>,
): readonly string[] | null {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  const prefix = 'wss://data-stream.binance.vision/stream?streams=';
  if (!value.startsWith(prefix)) return null;
  const encoded = value.slice(prefix.length);
  if (
    encoded.length === 0
    || encoded.includes('?')
    || encoded.includes('#')
    || encoded.includes('&')
    || encoded.includes('%')
  ) return null;
  const streams = encoded.split('/');
  if (
    streams.length !== policy.streams.length
    || new Set(streams).size !== streams.length
    || streams.some((stream) => !policy.streams.includes(stream))
    || [...streams].sort().some(
      (stream, index) => stream !== [...policy.streams].sort()[index],
    )
  ) return null;
  return Object.freeze(streams);
}

function parseGenerationOpen(
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
  policy: Readonly<VolumeForwardMeasurementPolicy>,
): Readonly<{ combinedUrl: string }> | null {
  const value = dataRecord(rawJson(record));
  if (
    value === null
    || !exactDataKeys(value, [
      'combinedUrl',
      'generation',
      'reason',
      'streamMechanism',
      'streams',
      'timestampUnit',
    ])
    || value.generation !== record.header.generation
    || value.reason !== (
      record.header.generation === 1 ? 'INITIAL' : 'RECONNECT'
    )
    || value.streamMechanism !== 'COMBINED_URL'
    || value.timestampUnit !== 'MILLISECOND'
    || !Array.isArray(value.streams)
  ) return null;
  const streams = exactCombinedStreams(value.combinedUrl, policy);
  if (
    streams === null
    || !canonicalEqual(value.streams, streams)
  ) return null;
  return Object.freeze({ combinedUrl: value.combinedUrl as string });
}

function parseConfigCut(
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
  policy: Readonly<VolumeForwardMeasurementPolicy>,
): ConfigCut | null {
  const value = dataRecord(rawJson(record));
  const rules = value === null
    ? null
    : dataRecord(value.frozenMeasurementRules);
  if (
    value === null
    || !exactDataKeys(value, [
      'combinedUrl',
      'configurationRevision',
      'depthLimit',
      'enabled',
      'evidenceClosesAtMs',
      'frozenMeasurementRules',
      'killSwitchEngaged',
      'measurementPolicyId',
      'measurementPolicySha256',
      'mode',
      'profitabilityClaim',
      'proposalAdmissionClosesAtMs',
      'purpose',
      'recordOnly',
      'streamMechanism',
      'symbol',
      'timestampUnit',
    ])
    || (
      value.purpose !== 'SMOKE_MECHANICS_ONLY'
      && value.purpose !== VOLUME_FORWARD_MEASUREMENT_SEGMENT_PURPOSE
    )
    || value.symbol !== policy.symbol
    || !validIdentifier(value.configurationRevision)
    || value.enabled !== false
    || value.killSwitchEngaged !== true
    || value.mode !== 'SHADOW_ONLY'
    || value.recordOnly !== true
    || value.timestampUnit !== 'MILLISECOND'
    || value.depthLimit !== 100
    || value.streamMechanism !== 'COMBINED_URL'
    || exactCombinedStreams(value.combinedUrl, policy) === null
    || value.proposalAdmissionClosesAtMs !== policy.outcomeClosesAtMs
    || value.evidenceClosesAtMs !== policy.evidenceClosesAtMs
    || typeof value.measurementPolicySha256 !== 'string'
    || !RAW_SHA256.test(value.measurementPolicySha256)
    || value.measurementPolicySha256 !== FROZEN_PACKET_POLICY_SHA256
    || value.measurementPolicyId !== policy.policyId
    || rules === null
    || !canonicalEqual(rules, FROZEN_PACKET_RULES)
    || value.profitabilityClaim !== 'FORBIDDEN'
  ) return null;
  return Object.freeze({
    configurationRevision: value.configurationRevision,
    configurationDigest: record.header.rawSha256,
    combinedUrl: value.combinedUrl as string,
    enabled: false,
    depthLimit: 100,
    purpose: value.purpose as ConfigCut['purpose'],
    recordHash: record.recordHash,
    receivedAtMs: record.header.localReceivedAtMs,
    record,
  });
}

function parseKillCut(
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
): KillCut | null {
  const value = dataRecord(rawJson(record));
  if (
    value === null
    || !exactDataKeys(value, [
      'casAuthority',
      'engaged',
      'privateOrSignedAuthority',
      'submitAuthority',
    ])
    || value.engaged !== true
    || value.submitAuthority !== false
    || value.casAuthority !== false
    || value.privateOrSignedAuthority !== false
  ) return null;
  return Object.freeze({
    engaged: true,
    killStateDigest: record.header.rawSha256,
    recordHash: record.recordHash,
    receivedAtMs: record.header.localReceivedAtMs,
    record,
  });
}

function filterByType(
  filters: readonly unknown[],
  filterType: string,
): DataRecord | null {
  for (const candidate of filters) {
    const value = dataRecord(candidate);
    if (value?.filterType === filterType) return value;
  }
  return null;
}

function parseFilterCut(
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
): FilterCut | null {
  const symbol = record.header.sourceSymbol;
  if (symbol === null) return null;
  const decoded = decodeVolumeForwardMeasurementEvidenceRawBytes(record);
  if (!decoded.ok) return null;
  let snapshot;
  try {
    snapshot = parseVolumeForwardExchangeInfo({
      rawPayload: decoded.bytes,
      symbol,
      generation: record.header.generation,
      receivedMonotonicNs: record.header.localMonotonicNs,
      receivedAtMs: record.header.localReceivedAtMs,
    });
  } catch {
    return null;
  }
  if (
    snapshot.status !== 'TRADING'
    || snapshot.quoteAsset !== 'USDT'
    || snapshot.spotTradingAllowed !== true
    || !snapshot.orderTypes.includes('LIMIT')
  ) return null;
  const price = filterByType(snapshot.filters, 'PRICE_FILTER');
  const lot = filterByType(snapshot.filters, 'LOT_SIZE');
  const notional = filterByType(snapshot.filters, 'NOTIONAL')
    ?? filterByType(snapshot.filters, 'MIN_NOTIONAL');
  const minPrice = exactDecimal(price?.minPrice);
  const maxPrice = exactDecimal(price?.maxPrice);
  const tickSize = exactDecimal(price?.tickSize, true);
  const minQuantity = exactDecimal(lot?.minQty, true);
  const maxQuantity = exactDecimal(lot?.maxQty, true);
  const stepSize = exactDecimal(lot?.stepSize, true);
  const minNotional = exactDecimal(notional?.minNotional, true);
  const maxNotional = notional?.filterType === 'NOTIONAL'
    ? exactDecimal(notional.maxNotional, true)
    : null;
  if (
    minPrice === null
    || maxPrice === null
    || compareExactDecimals(minPrice, ZERO) < 0
    || compareExactDecimals(maxPrice, ZERO) < 0
    || (
      compareExactDecimals(maxPrice, ZERO) > 0
      && compareExactDecimals(minPrice, maxPrice) > 0
    )
    || tickSize === null
    || minQuantity === null
    || maxQuantity === null
    || stepSize === null
    || minNotional === null
    || compareExactDecimals(minQuantity, maxQuantity) > 0
  ) return null;
  return Object.freeze({
    symbol,
    quoteAsset: 'USDT',
    minPrice,
    maxPrice,
    tickSize,
    minQuantity,
    maxQuantity,
    stepSize,
    minNotional,
    maxNotional,
    filterDigest: snapshot.rawPayloadSha256,
    recordHash: record.recordHash,
    receivedAtMs: record.header.localReceivedAtMs,
    record,
  });
}

function pointInTimeControls(
  state: MutableSourceState,
  config: ConfigCut | null,
  kill: KillCut | null,
): Readonly<VolumeForwardPointInTimeControls> | null {
  if (state.filter === null || config === null || kill === null) return null;
  try {
    const capturedAtMs = Math.max(
      config.receivedAtMs,
      kill.receivedAtMs,
      state.filter.receivedAtMs,
    );
    const receivedMonotonicNs = [
      config.record.header.localMonotonicNs,
      kill.record.header.localMonotonicNs,
      state.filter.record.header.localMonotonicNs,
    ].reduce((latest, candidate) => (
      BigInt(candidate) > BigInt(latest) ? candidate : latest
    ));
    return buildVolumeForwardPointInTimeControls({
      configurationRevision: config.configurationRevision,
      configurationDigest: config.configurationDigest,
      filterDigest: state.filter.filterDigest,
      killStateDigest: kill.killStateDigest,
      enabled: false,
      killSwitchEngaged: true,
      capturedAtMs,
      receivedMonotonicNs,
    });
  } catch {
    return null;
  }
}

function parseProposalCut(
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
  controls: Readonly<VolumeForwardPointInTimeControls>,
): ProposalCut | VolumeForwardMeasurementReplayReason {
  const root = dataRecord(rawJson(record));
  if (root === null) return 'DETECTOR_PROPOSAL_INVALID';
  const value = dataRecord(root.proposal) ?? root;
  const proposalId = value.proposalId;
  const correlationId = value.correlationId;
  if (
    typeof proposalId === 'string'
    && (
      proposalId.startsWith('vroc:')
      || proposalId.startsWith('vroc_')
    )
  ) return 'DETECTOR_PSEUDO_PROPOSAL_EXCLUDED';
  if (
    typeof correlationId === 'string'
    && correlationId.startsWith('vroc:')
  ) return 'DETECTOR_PSEUDO_PROPOSAL_EXCLUDED';
  try {
    const binding = buildVolumeForwardDetectorProposalBinding(value, controls);
    if (
      binding.generation !== record.header.generation
      || binding.receivedMonotonicNs !== record.header.localMonotonicNs
      || binding.updatedTs > record.header.localReceivedAtMs
    ) return 'DETECTOR_PROPOSAL_INVALID';
    return Object.freeze({
      ...binding,
      recordHash: record.recordHash,
      receivedAtMs: record.header.localReceivedAtMs,
      record,
    });
  } catch {
    return 'DETECTOR_PROPOSAL_INVALID';
  }
}

function parseProposalCutStructurally(
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
): ProposalCut | VolumeForwardMeasurementReplayReason {
  const root = dataRecord(rawJson(record));
  if (root === null) return 'DETECTOR_PROPOSAL_INVALID';
  const value = dataRecord(root.proposal) ?? root;
  const proposalId = value.proposalId;
  const correlationId = value.correlationId;
  if (
    typeof proposalId === 'string'
    && (
      proposalId.startsWith('vroc:')
      || proposalId.startsWith('vroc_')
    )
  ) return 'DETECTOR_PSEUDO_PROPOSAL_EXCLUDED';
  if (
    typeof correlationId === 'string'
    && correlationId.startsWith('vroc:')
  ) return 'DETECTOR_PSEUDO_PROPOSAL_EXCLUDED';
  try {
    const syntheticControls = buildVolumeForwardPointInTimeControls({
      configurationRevision: value.configurationRevision,
      configurationDigest: value.configurationDigest,
      filterDigest: value.filterDigest,
      killStateDigest: value.killStateDigest,
      enabled: false,
      killSwitchEngaged: true,
      capturedAtMs: value.controlsCapturedAtMs,
      receivedMonotonicNs: value.controlsReceivedMonotonicNs,
    });
    const binding = buildVolumeForwardDetectorProposalBinding(
      value,
      syntheticControls,
    );
    if (
      binding.generation !== record.header.generation
      || binding.receivedMonotonicNs !== record.header.localMonotonicNs
      || binding.updatedTs > record.header.localReceivedAtMs
    ) return 'DETECTOR_PROPOSAL_INVALID';
    return Object.freeze({
      ...binding,
      recordHash: record.recordHash,
      receivedAtMs: record.header.localReceivedAtMs,
      record,
    });
  } catch {
    return 'DETECTOR_PROPOSAL_INVALID';
  }
}

interface DecimalAtoms {
  readonly coefficient: bigint;
  readonly scale: number;
}

function decimalAtoms(value: ExactDecimal): DecimalAtoms {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const coefficient = BigInt(`${whole}${fraction}`);
  return {
    coefficient: negative ? -coefficient : coefficient,
    scale: fraction.length,
  };
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function decimalFromAtoms(coefficient: bigint, scale: number): ExactDecimal {
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient)
    .toString()
    .padStart(scale + 1, '0');
  const text = scale === 0
    ? digits
    : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return normalizeExactDecimal(negative ? `-${text}` : text);
}

function floorQuantityForQuote(
  quote: ExactDecimal,
  price: ExactDecimal,
  step: ExactDecimal,
): ExactDecimal | null {
  const quoteAtoms = decimalAtoms(quote);
  const priceAtoms = decimalAtoms(price);
  const stepAtoms = decimalAtoms(step);
  if (
    quoteAtoms.coefficient <= 0n
    || priceAtoms.coefficient <= 0n
    || stepAtoms.coefficient <= 0n
  ) return null;
  const numerator = quoteAtoms.coefficient
    * powerOfTen(priceAtoms.scale + stepAtoms.scale);
  const denominator = priceAtoms.coefficient
    * stepAtoms.coefficient
    * powerOfTen(quoteAtoms.scale);
  const steps = numerator / denominator;
  if (steps <= 0n) return null;
  return decimalFromAtoms(
    steps * stepAtoms.coefficient,
    stepAtoms.scale,
  );
}

function parsePublicRecord(
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
  policy: Readonly<VolumeForwardMeasurementPolicy>,
): PublicPayload | null {
  const decoded = decodeVolumeForwardMeasurementEvidenceRawBytes(record);
  if (!decoded.ok || record.header.sourceSymbol === null) return null;
  let rawPayload: string;
  try {
    rawPayload = new TextDecoder('utf-8', { fatal: true })
      .decode(decoded.bytes);
  } catch {
    return null;
  }
  try {
    const common = {
      rawPayload,
      generation: record.header.generation,
      receivedMonotonicNs: record.header.localMonotonicNs,
      receivedAtMs: record.header.localReceivedAtMs,
    };
    if (
      record.header.kind !== 'DEPTH_SNAPSHOT'
      && record.header.sourceStream === null
    ) return null;
    const parsed = record.header.kind === 'DEPTH_SNAPSHOT'
      ? parseVolumeForwardDepthSnapshot({
          ...common,
          symbol: record.header.sourceSymbol,
        })
      : parseVolumeForwardPublicPayload({
          ...common,
          sourceStream: record.header.sourceStream as string,
        });
    if (
      parsed.kind !== record.header.kind
      || parsed.symbol !== record.header.sourceSymbol
      || parsed.symbol !== policy.symbol
    ) return null;
    if (parsed.kind === 'DEPTH_SNAPSHOT') {
      return record.header.sourceStream === '/api/v3/depth'
        ? parsed
        : null;
    }
    return (
      parsed.stream === record.header.sourceStream
      && policy.streams.includes(parsed.stream)
    ) ? parsed : null;
  } catch {
    return null;
  }
}

function newSourceState(
  symbol: string,
  generation: number,
  combinedUrl: string,
  generationOpenRecord:
    Readonly<VolumeForwardMeasurementEvidenceRecord>,
): MutableSourceState {
  return {
    generation,
    combinedUrl,
    generationOpenRecord,
    depth: createVolumeForwardDepthState({ symbol, generation }),
    snapshotLastUpdateId: null,
    depthRecord: null,
    depthProofRecords: [],
    depthDiffRecordByRange: new Map(),
    depthDiffRangeRing: [],
    depthDiffRangeRingCursor: 0,
    aggregateTrade: null,
    tradesById: new Map(),
    tradeIdentityById: new Map(),
    conflictingTradeIds: new Set(),
    bookTicker: null,
    filter: null,
    continuityExact: true,
    continuityObserved: false,
    continuityRecord: null,
    streamFrameByTypedRecordHash: new Map(),
    streamLedger: [],
    detectorProposalRecordHash: null,
    lifecycleAssertionCount: 0,
    lastContinuityRangeCount: 0,
    invalidFrame: false,
  };
}

function publicRecordKind(
  kind: string,
): kind is 'DEPTH_SNAPSHOT' | VolumeForwardPublicPayload['kind'] {
  return kind === 'DEPTH_SNAPSHOT'
    || kind === 'DEPTH_DIFF'
    || kind === 'TRADE'
    || kind === 'AGG_TRADE'
    || kind === 'BOOK_TICKER';
}

function typedStreamRecordKind(
  kind: string,
): kind is VolumeForwardPublicPayload['kind'] {
  return kind === 'DEPTH_DIFF'
    || kind === 'TRADE'
    || kind === 'AGG_TRADE'
    || kind === 'BOOK_TICKER';
}

interface CombinedFrameMapping {
  readonly stream: string;
  readonly innerOffset: number;
  readonly innerLength: number;
  readonly innerSha256: string;
}

function skipJsonWhitespace(text: string, offset: number): number {
  let cursor = offset;
  while (
    cursor < text.length
    && (
      text[cursor] === ' '
      || text[cursor] === '\t'
      || text[cursor] === '\n'
      || text[cursor] === '\r'
    )
  ) cursor += 1;
  return cursor;
}

function scanJsonString(text: string, offset: number): number | null {
  if (text[offset] !== '"') return null;
  let escaped = false;
  for (let cursor = offset + 1; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      return cursor + 1;
    }
  }
  return null;
}

function scanJsonValue(text: string, offset: number): number | null {
  const start = skipJsonWhitespace(text, offset);
  if (text[start] === '"') return scanJsonString(text, start);
  if (text[start] === '{' || text[start] === '[') {
    const stack = [text[start] === '{' ? '}' : ']'];
    let inString = false;
    let escaped = false;
    for (let cursor = start + 1; cursor < text.length; cursor += 1) {
      const character = text[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') stack.push('}');
      else if (character === '[') stack.push(']');
      else if (character === '}' || character === ']') {
        if (stack.pop() !== character) return null;
        if (stack.length === 0) return cursor + 1;
      }
    }
    return null;
  }
  let end = start;
  while (
    end < text.length
    && text[end] !== ','
    && text[end] !== '}'
    && text[end] !== ' '
    && text[end] !== '\t'
    && text[end] !== '\n'
    && text[end] !== '\r'
  ) end += 1;
  return end > start ? end : null;
}

function combinedFrameMapping(
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
): Readonly<CombinedFrameMapping> | null {
  const decoded = decodeVolumeForwardMeasurementEvidenceRawBytes(record);
  if (!decoded.ok) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(decoded.bytes);
  } catch {
    return null;
  }
  let cursor = skipJsonWhitespace(text, 0);
  if (text[cursor] !== '{') return null;
  cursor += 1;
  const fields = new Map<string, Readonly<{
    valueStart: number;
    valueEnd: number;
  }>>();
  while (true) {
    cursor = skipJsonWhitespace(text, cursor);
    if (text[cursor] === '}') {
      cursor += 1;
      break;
    }
    const keyEnd = scanJsonString(text, cursor);
    if (keyEnd === null) return null;
    let key: unknown;
    try {
      key = JSON.parse(text.slice(cursor, keyEnd)) as unknown;
    } catch {
      return null;
    }
    if (typeof key !== 'string' || fields.has(key)) return null;
    cursor = skipJsonWhitespace(text, keyEnd);
    if (text[cursor] !== ':') return null;
    const valueStart = skipJsonWhitespace(text, cursor + 1);
    const valueEnd = scanJsonValue(text, valueStart);
    if (valueEnd === null) return null;
    fields.set(key, Object.freeze({ valueStart, valueEnd }));
    cursor = skipJsonWhitespace(text, valueEnd);
    if (text[cursor] === ',') {
      cursor += 1;
      continue;
    }
    if (text[cursor] !== '}') return null;
  }
  if (
    skipJsonWhitespace(text, cursor) !== text.length
    || fields.size !== 2
    || !fields.has('stream')
    || !fields.has('data')
  ) return null;
  const streamRange = fields.get('stream') as Readonly<{
    valueStart: number;
    valueEnd: number;
  }>;
  const dataRange = fields.get('data') as Readonly<{
    valueStart: number;
    valueEnd: number;
  }>;
  let stream: unknown;
  try {
    stream = JSON.parse(
      text.slice(streamRange.valueStart, streamRange.valueEnd),
    ) as unknown;
    JSON.parse(text.slice(dataRange.valueStart, dataRange.valueEnd));
  } catch {
    return null;
  }
  if (typeof stream !== 'string') return null;
  const encoder = new TextEncoder();
  const innerOffset = encoder.encode(text.slice(0, dataRange.valueStart)).length;
  const innerBytes = encoder.encode(
    text.slice(dataRange.valueStart, dataRange.valueEnd),
  );
  if (
    innerOffset + innerBytes.length > decoded.bytes.length
    || !decoded.bytes
      .slice(innerOffset, innerOffset + innerBytes.length)
      .every((byte, index) => byte === innerBytes[index])
  ) return null;
  return Object.freeze({
    stream,
    innerOffset,
    innerLength: innerBytes.length,
    innerSha256: createHash('sha256').update(innerBytes).digest('hex'),
  });
}

function streamFrameMatchesTypedRecord(
  frame: Readonly<VolumeForwardMeasurementEvidenceRecord>,
  typed: Readonly<VolumeForwardMeasurementEvidenceRecord>,
): boolean {
  const mapping = combinedFrameMapping(frame);
  return mapping !== null
    && mapping.stream === typed.header.sourceStream
    && frame.header.kind === 'STREAM_FRAME'
    && typedStreamRecordKind(typed.header.kind)
    && frame.header.sequence + 1 === typed.header.sequence
    && frame.rawBase64 === typed.rawBase64
    && frame.header.rawSha256 === typed.header.rawSha256
    && frame.header.rawByteLength === typed.header.rawByteLength
    && frame.header.generation === typed.header.generation
    && frame.header.sourceSymbol === typed.header.sourceSymbol
    && frame.header.sourceEndpoint === typed.header.sourceEndpoint
    && frame.header.sourceTransport === typed.header.sourceTransport
    && frame.header.localReceivedAtMs === typed.header.localReceivedAtMs
    && frame.header.localMonotonicNs === typed.header.localMonotonicNs
    && frame.header.sourceStream === null
    && typed.header.sourceStream !== null;
}

function depthDiffRangeKey(
  firstUpdateId: number,
  finalUpdateId: number,
  localMonotonicNs: string,
): string {
  return `${firstUpdateId}:${finalUpdateId}:${localMonotonicNs}`;
}

function rememberDepthDiffRecord(
  state: MutableSourceState,
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
  payload: VolumeForwardDepthDiff,
): void {
  const key = depthDiffRangeKey(
    payload.firstUpdateId,
    payload.finalUpdateId,
    record.header.localMonotonicNs,
  );
  if (state.depthDiffRecordByRange.has(key)) return;
  if (state.depthDiffRangeRing.length < MAX_DEPTH_DIFF_RECORDS) {
    state.depthDiffRangeRing.push(key);
  } else {
    const evicted = state.depthDiffRangeRing[
      state.depthDiffRangeRingCursor
    ];
    if (evicted !== undefined) state.depthDiffRecordByRange.delete(evicted);
    state.depthDiffRangeRing[state.depthDiffRangeRingCursor] = key;
    state.depthDiffRangeRingCursor = (
      state.depthDiffRangeRingCursor + 1
    ) % MAX_DEPTH_DIFF_RECORDS;
  }
  state.depthDiffRecordByRange.set(key, record);
}

function updatePublicState(
  state: MutableSourceState,
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
  payload: PublicPayload,
  streamFrame:
    Readonly<VolumeForwardMeasurementEvidenceRecord> | null,
): void {
  if (streamFrame !== null) {
    state.streamFrameByTypedRecordHash.set(record.recordHash, streamFrame);
    if (payload.kind !== 'DEPTH_SNAPSHOT') {
      state.streamLedger.push(Object.freeze({
        frame: streamFrame,
        payload,
        typed: record,
      }));
    }
  }
  if (payload.kind === 'DEPTH_SNAPSHOT') {
    const priorRevision = state.depth?.sourceRevision ?? 0;
    state.depth = applyVolumeForwardDepthInput(
      state.depth as Readonly<DepthState>,
      payload,
    );
    state.snapshotLastUpdateId = state.depth.snapshotLastUpdateId;
    if (state.depth.sourceRevision > priorRevision) {
      state.depthRecord = record;
      const applied = state.depth.updateRanges.map((range) => (
        state.depthDiffRecordByRange.get(depthDiffRangeKey(
          range.firstUpdateId,
          range.finalUpdateId,
          range.receivedMonotonicNs,
        ))
      ));
      if (applied.some((candidate) => candidate === undefined)) {
        state.continuityExact = false;
      }
      state.depthProofRecords = [
        record,
        ...applied
          .filter((candidate) => candidate !== undefined)
          .slice(-256)
      ];
      state.continuityObserved = false;
      state.continuityRecord = null;
    }
    return;
  }
  if (payload.kind === 'DEPTH_DIFF') {
    rememberDepthDiffRecord(state, record, payload);
    const priorRevision = state.depth?.sourceRevision ?? 0;
    state.depth = applyVolumeForwardDepthInput(
      state.depth as Readonly<DepthState>,
      payload,
    );
    state.snapshotLastUpdateId = state.depth.snapshotLastUpdateId;
    if (state.depth.sourceRevision > priorRevision) {
      state.depthRecord = record;
      state.depthProofRecords.push(record);
      state.continuityObserved = false;
      state.continuityRecord = null;
      if (state.depthProofRecords.length > 257) {
        state.depthProofRecords.shift();
      }
    } else if (state.depth.status !== 'BUFFERING' && (
      state.depth.status !== 'SYNCHRONIZED'
      || state.depth.continuity !== 'CONTIGUOUS'
    )) {
      state.continuityExact = false;
      state.continuityObserved = false;
      state.continuityRecord = null;
    }
    return;
  }
  if (payload.kind === 'AGG_TRADE') {
    state.aggregateTrade = Object.freeze({ payload, record });
    return;
  }
  if (payload.kind === 'TRADE') {
    const identity = canonicalJson(payload);
    const priorIdentity = state.tradeIdentityById.get(payload.tradeId);
    if (priorIdentity === undefined) {
      state.tradeIdentityById.set(payload.tradeId, identity);
    } else if (priorIdentity !== identity) {
      state.conflictingTradeIds.add(payload.tradeId);
    }
    if (!state.tradesById.has(payload.tradeId)) {
      state.tradesById.set(
        payload.tradeId,
        Object.freeze({ payload, record }),
      );
    }
    while (state.tradesById.size > MAX_TRADE_PROOF) {
      const oldest = state.tradesById.keys().next().value;
      if (typeof oldest !== 'number') break;
      state.tradesById.delete(oldest);
    }
    return;
  }
  state.bookTicker = Object.freeze({ payload, record });
}

function exactMultiple(value: ExactDecimal, step: ExactDecimal): boolean {
  const valueAtoms = decimalAtoms(value);
  const stepAtoms = decimalAtoms(step);
  const scale = Math.max(valueAtoms.scale, stepAtoms.scale);
  const left = valueAtoms.coefficient * powerOfTen(scale - valueAtoms.scale);
  const right = stepAtoms.coefficient * powerOfTen(scale - stepAtoms.scale);
  return right > 0n && left % right === 0n;
}

function aggregateTradeProofComplete(
  state: MutableSourceState,
  aggregate: VolumeForwardAggregateTrade,
): boolean {
  const span = aggregate.lastTradeId - aggregate.firstTradeId;
  if (!Number.isSafeInteger(span) || span < 0 || span >= MAX_TRADE_PROOF) {
    return false;
  }
  const aggregateRecord = state.aggregateTrade?.record;
  if (
    aggregateRecord === undefined
    || aggregateRecord.header.sourceEndpoint
      !== 'wss://data-stream.binance.vision'
    || aggregateRecord.header.sourceStream !== aggregate.stream
    || aggregateRecord.header.sourceTransport
      !== 'BINANCE_SPOT_PUBLIC_STREAM'
  ) return false;
  let quantity = ZERO;
  try {
    for (
      let tradeId = aggregate.firstTradeId;
      tradeId <= aggregate.lastTradeId;
      tradeId += 1
    ) {
      if (state.conflictingTradeIds.has(tradeId)) return false;
      const cut = state.tradesById.get(tradeId);
      if (cut === undefined || cut.payload.kind !== 'TRADE') return false;
      const trade = cut.payload as VolumeForwardTrade;
      if (
        trade.symbol !== aggregate.symbol
        || trade.generation !== aggregate.generation
        || trade.buyerIsMaker !== aggregate.buyerIsMaker
        || normalizeExactDecimal(trade.price)
          !== normalizeExactDecimal(aggregate.price)
        || trade.tradeTimeMs > aggregate.tradeTimeMs
        || cut.record.header.sourceEndpoint
          !== 'wss://data-stream.binance.vision'
        || cut.record.header.sourceStream !== trade.stream
        || cut.record.header.sourceTransport !== 'BINANCE_SPOT_PUBLIC_STREAM'
      ) return false;
      quantity = addExactDecimals(
        quantity,
        normalizeExactDecimal(trade.quantity),
      );
    }
    return quantity === normalizeExactDecimal(aggregate.quantity);
  } catch {
    return false;
  }
}

function proposalOperationCost(state: MutableSourceState): number {
  const aggregate = state.aggregateTrade?.payload;
  const tradeSpan = aggregate?.kind === 'AGG_TRADE'
    ? aggregate.lastTradeId - aggregate.firstTradeId + 1
    : 1;
  return 1 + 2 * (
    state.depthProofRecords.length
    + Math.max(
      1,
      Number.isSafeInteger(tradeSpan) ? tradeSpan : MAX_TRADE_PROOF,
    )
  );
}

function synchronizedRanges(
  state: MutableSourceState,
): readonly {
  readonly firstUpdateId: number;
  readonly finalUpdateId: number;
  readonly eventTimeMs: number;
}[] | null {
  const snapshot = state.depth?.snapshotLastUpdateId
    ?? state.snapshotLastUpdateId;
  const finalUpdateId = state.depth?.lastUpdateId ?? null;
  if (snapshot === null || finalUpdateId === null || finalUpdateId <= snapshot) {
    return null;
  }
  const retained = (state.depth?.updateRanges ?? [])
    .map((range) => ({
      firstUpdateId: range.firstUpdateId,
      finalUpdateId: range.finalUpdateId,
      eventTimeMs: range.eventTimeMs,
    }))
    .filter((range) => (
      range.finalUpdateId > snapshot
      && range.finalUpdateId <= finalUpdateId
    ));
  const ranges: typeof retained = [];
  let expected = snapshot + 1;
  for (const range of retained) {
    if (range.finalUpdateId < expected) continue;
    if (range.firstUpdateId > expected) return null;
    ranges.push({
      firstUpdateId: range.firstUpdateId,
      finalUpdateId: range.finalUpdateId,
      eventTimeMs: range.eventTimeMs,
    });
    expected = range.finalUpdateId + 1;
    if (range.finalUpdateId === finalUpdateId) break;
  }
  return (
    ranges.length > 0
    && ranges.at(-1)?.finalUpdateId === finalUpdateId
    && ranges.length
      <= VOLUME_FORWARD_MEASUREMENT_LIMITS.maximumDepthProofRanges
  ) ? Object.freeze(ranges.map((range) => Object.freeze({ ...range }))) : null;
}

function legacyValidatorRanges(
  snapshotLastUpdateId: number,
  ranges: NonNullable<ReturnType<typeof synchronizedRanges>>,
): NonNullable<ReturnType<typeof synchronizedRanges>> | null {
  const adapted: Array<{
    firstUpdateId: number;
    finalUpdateId: number;
    eventTimeMs: number;
  }> = [];
  let previousFinalUpdateId = snapshotLastUpdateId;
  for (const range of ranges) {
    const firstUpdateId = previousFinalUpdateId + 1;
    if (
      !Number.isSafeInteger(firstUpdateId)
      || range.firstUpdateId > firstUpdateId
      || range.finalUpdateId < firstUpdateId
    ) return null;
    adapted.push(Object.freeze({
      firstUpdateId,
      finalUpdateId: range.finalUpdateId,
      eventTimeMs: range.eventTimeMs,
    }));
    previousFinalUpdateId = range.finalUpdateId;
  }
  return Object.freeze(adapted);
}

function legacyValidatorWindow(
  snapshotLastUpdateId: number,
  ranges: NonNullable<ReturnType<typeof synchronizedRanges>>,
): Readonly<{
  snapshotLastUpdateId: number;
  ranges: NonNullable<ReturnType<typeof synchronizedRanges>>;
}> | null {
  const maximum = 256;
  const start = Math.max(0, ranges.length - maximum);
  const selected = ranges.slice(start);
  const checkpoint = start === 0
    ? snapshotLastUpdateId
    : ranges[start - 1]?.finalUpdateId ?? null;
  if (checkpoint === null) return null;
  const adapted = legacyValidatorRanges(checkpoint, selected);
  return adapted === null
    ? null
    : Object.freeze({
        snapshotLastUpdateId: checkpoint,
        ranges: adapted,
      });
}

function entrySourceCutPrecedesProposal(
  state: MutableSourceState,
  proposal: ProposalCut,
  config: ConfigCut | null,
  kill: KillCut | null,
): boolean {
  if (
    config === null
    || kill === null
    || state.filter === null
    || state.aggregateTrade === null
    || state.bookTicker === null
    || state.continuityRecord === null
  ) return false;
  const aggregate = state.aggregateTrade.payload;
  if (aggregate.kind !== 'AGG_TRADE') return false;
  const tradeCuts: RecordedCut[] = [];
  for (
    let tradeId = aggregate.firstTradeId;
    tradeId <= aggregate.lastTradeId;
    tradeId += 1
  ) {
    const trade = state.tradesById.get(tradeId);
    if (trade === undefined) return false;
    tradeCuts.push(trade);
  }
  const sourceRecords = [
    ...state.depthProofRecords,
    state.aggregateTrade.record,
    ...tradeCuts.map((cut) => cut.record),
    state.bookTicker.record,
    state.continuityRecord,
  ];
  if (sourceRecords.some((record) => (
    record.header.localReceivedAtMs > proposal.updatedTs
    || BigInt(record.header.localMonotonicNs)
      > BigInt(proposal.receivedMonotonicNs)
  ))) return false;
  const controlRecords = [config.record, kill.record, state.filter.record];
  if (controlRecords.some((record) => (
    record.header.localReceivedAtMs > proposal.controlsCapturedAtMs
    || BigInt(record.header.localMonotonicNs)
      > BigInt(proposal.controlsReceivedMonotonicNs)
  ))) return false;
  if (
    aggregate.eventTimeMs > proposal.featureObservedAtMs
    || aggregate.tradeTimeMs > proposal.featureObservedAtMs
    || state.depth?.updateRanges.some(
      (range) => range.eventTimeMs > proposal.featureObservedAtMs,
    ) === true
  ) return false;
  for (const trade of tradeCuts) {
    if (
      trade.payload.kind === 'TRADE'
      && (
        trade.payload.eventTimeMs > proposal.featureObservedAtMs
        || trade.payload.tradeTimeMs > proposal.featureObservedAtMs
      )
    ) return false;
  }
  return true;
}

function cutPrerequisites(
  state: MutableSourceState,
  proposal: ProposalCut,
  config: ConfigCut | null,
  kill: KillCut | null,
  evaluatedAtMs: number,
  evaluatedMonotonicNs: string,
  requireUnexpiredProposal: boolean,
): readonly VolumeForwardMeasurementReplayReason[] {
  const reasons: VolumeForwardMeasurementReplayReason[] = [];
  if (
    state.depth === null
    || state.depth.status !== 'SYNCHRONIZED'
    || state.depth.continuity !== 'CONTIGUOUS'
    || state.depth.bids.length === 0
    || state.depth.asks.length === 0
    || synchronizedRanges(state) === null
    || state.continuityExact !== true
    || state.continuityObserved !== true
  ) reasons.push('DEPTH_NOT_SYNCHRONIZED');
  if (state.aggregateTrade === null) {
    reasons.push('AGG_TRADE_EVIDENCE_MISSING');
  } else if (!aggregateTradeProofComplete(
    state,
    state.aggregateTrade.payload as VolumeForwardAggregateTrade,
  )) {
    reasons.push('TRADE_EVIDENCE_MISSING');
  }
  if (state.bookTicker === null) {
    reasons.push('BOOK_TICKER_EVIDENCE_MISSING');
  } else if (state.depth !== null) {
    const ticker = state.bookTicker.payload as VolumeForwardBookTicker;
    const bid = state.depth.bids[0];
    const ask = state.depth.asks[0];
    if (
      bid === undefined
      || ask === undefined
      || state.snapshotLastUpdateId === null
      || state.depth.lastUpdateId === null
      || ticker.updateId < state.snapshotLastUpdateId
      || ticker.updateId > state.depth.lastUpdateId
      || normalizeExactDecimal(ticker.bidPrice)
        !== normalizeExactDecimal(bid[0])
      || normalizeExactDecimal(ticker.bidQuantity)
        !== normalizeExactDecimal(bid[1])
      || normalizeExactDecimal(ticker.askPrice)
        !== normalizeExactDecimal(ask[0])
      || normalizeExactDecimal(ticker.askQuantity)
        !== normalizeExactDecimal(ask[1])
    ) reasons.push('BOOK_TICKER_DEPTH_MISMATCH');
    const tickerMonotonic = BigInt(
      state.bookTicker.record.header.localMonotonicNs,
    );
    const depthMonotonic = state.depth.lastReceivedMonotonicNs === null
      ? null
      : BigInt(state.depth.lastReceivedMonotonicNs);
    const evaluatedMonotonic = BigInt(evaluatedMonotonicNs);
    if (
      tickerMonotonic > evaluatedMonotonic
      || evaluatedMonotonic - tickerMonotonic > MAX_SOURCE_CUT_AGE_NS
      || state.bookTicker.record.header.localReceivedAtMs > evaluatedAtMs
      || evaluatedAtMs
        - state.bookTicker.record.header.localReceivedAtMs
        > MAX_SOURCE_CUT_AGE_MS
      || depthMonotonic === null
      || depthMonotonic > evaluatedMonotonic
      || evaluatedMonotonic - depthMonotonic > MAX_SOURCE_CUT_AGE_NS
      || state.depth.lastReceivedAtMs === null
      || state.depth.lastReceivedAtMs > evaluatedAtMs
      || evaluatedAtMs - state.depth.lastReceivedAtMs
        > MAX_SOURCE_CUT_AGE_MS
    ) reasons.push('BOOK_TICKER_STALE');
  }
  if (state.filter === null) reasons.push('EXCHANGE_INFO_MISSING');
  else if (state.filter.filterDigest !== proposal.filterDigest) {
    reasons.push('EXCHANGE_FILTERS_INVALID');
  }
  if (config === null) reasons.push('CONFIG_STATE_MISSING');
  else if (
    config.enabled !== false
    || config.configurationRevision !== proposal.configurationRevision
  ) reasons.push('CONFIG_STATE_MISMATCH');
  if (kill === null) reasons.push('KILL_STATE_MISSING');
  else if (
    kill.engaged !== true
    || kill.killStateDigest !== proposal.killStateDigest
  ) reasons.push('KILL_STATE_NOT_ENGAGED');
  if (proposal.generation !== state.generation) {
    reasons.push('SOURCE_GENERATION_CHANGED');
  }
  if (
    state.filter !== null
    && config !== null
    && kill !== null
  ) {
    const controls = pointInTimeControls(state, config, kill);
    if (
      controls === null
      || proposal.configurationRevision
        !== controls.configurationRevision
      || proposal.configurationDigest !== controls.configurationDigest
      || proposal.filterDigest !== controls.filterDigest
      || proposal.killStateDigest !== controls.killStateDigest
      || proposal.controlsCapturedAtMs !== controls.capturedAtMs
      || proposal.controlsReceivedMonotonicNs
        !== controls.receivedMonotonicNs
    ) {
      reasons.push('CONFIG_STATE_MISMATCH');
    }
  }
  if (requireUnexpiredProposal && (
    proposal.expiresAtMs <= evaluatedAtMs
    || proposal.receivedAtMs > evaluatedAtMs
  )) reasons.push('DETECTOR_PROPOSAL_EXPIRED');
  if (
    requireUnexpiredProposal
    && !entrySourceCutPrecedesProposal(state, proposal, config, kill)
  ) reasons.push('SOURCE_CUT_AFTER_PROPOSAL');
  return orderedReasons(reasons);
}

interface ValidatorAdapterDepthLevels {
  readonly bids: readonly Readonly<{
    readonly price: string;
    readonly quantity: string;
  }>[];
  readonly asks: readonly Readonly<{
    readonly price: string;
    readonly quantity: string;
  }>[];
}

function buildObservation(
  state: MutableSourceState,
  proposal: ProposalCut,
  evaluatedAtMs: number,
  validatorExpiresAtMs: number,
  validatorAdapterDepth: Readonly<ValidatorAdapterDepthLevels> | null = null,
): Readonly<VolumeStrategyObservation> | null {
  const depth = state.depth;
  const aggregateCut = state.aggregateTrade;
  const depthRecord = state.depthRecord;
  const ranges = synchronizedRanges(state);
  const validatorWindow = state.snapshotLastUpdateId === null || ranges === null
    ? null
    : legacyValidatorWindow(state.snapshotLastUpdateId, ranges);
  if (
    depth === null
    || depth.status !== 'SYNCHRONIZED'
    || depth.continuity !== 'CONTIGUOUS'
    || depth.lastUpdateId === null
    || state.snapshotLastUpdateId === null
    || aggregateCut === null
    || aggregateCut.payload.kind !== 'AGG_TRADE'
    || depthRecord === null
    || ranges === null
    || validatorWindow === null
    || depth.bids.length === 0
    || depth.asks.length === 0
  ) return null;
  const aggregate = aggregateCut.payload as VolumeForwardAggregateTrade;
  const bids = validatorAdapterDepth?.bids
    ?? depth.bids.slice(0, 100).map(([price, quantity]) => ({
      price,
      quantity,
    }));
  const asks = validatorAdapterDepth?.asks
    ?? depth.asks.slice(0, 100).map(([price, quantity]) => ({
      price,
      quantity,
    }));
  const topBid = bids[0];
  const topAsk = asks[0];
  if (topBid === undefined || topAsk === undefined) return null;
  try {
    return buildVolumeStrategyObservation({
      proposal: {
        proposalId: proposal.proposalId,
        proposalRevision: proposal.proposalRevision,
        proposalDigest: proposal.proposalDigest,
        configurationRevision: proposal.configurationRevision,
        correlationId: proposal.correlationId,
        symbol: proposal.symbol,
        direction: proposal.direction,
        expiresAtMs: validatorExpiresAtMs,
      },
      source: {
        sourceId: VOLUME_PUBLIC_SOURCE_ID,
        restBaseUrl: VOLUME_PUBLIC_REST_BASE_URL,
        websocketBaseUrl: VOLUME_PUBLIC_WEBSOCKET_BASE_URL,
        authentication: 'NONE',
        timeUnit: 'MILLISECOND',
        generation: state.generation,
        revision: depth.sourceRevision,
        continuity: 'CONTIGUOUS',
      },
      aggregateTrade: {
        symbol: aggregate.symbol,
        aggregateTradeId: aggregate.aggregateTradeId,
        firstTradeId: aggregate.firstTradeId,
        lastTradeId: aggregate.lastTradeId,
        eventTimeMs: aggregate.eventTimeMs,
        tradeTimeMs: aggregate.tradeTimeMs,
        receivedAtMs: aggregateCut.record.header.localReceivedAtMs,
      },
      book: {
        symbol: proposal.symbol,
        bidPrice: topBid.price,
        askPrice: topAsk.price,
        bidQuantity: topBid.quantity,
        askQuantity: topAsk.quantity,
        sourceTimeMs: null,
        receivedAtMs: depthRecord.header.localReceivedAtMs,
        freshnessBasis: 'RECEIVE_TIME',
        numericFidelity: 'SOURCE_TEXT_EXACT',
        scope: 'SYNCHRONIZED_DEPTH',
        depth: {
          synchronization: {
            sourceGeneration: state.generation,
            sourceRevision: depth.sourceRevision,
            snapshotLastUpdateId: validatorWindow.snapshotLastUpdateId,
            updateRanges: validatorWindow.ranges,
          },
          bids,
          asks,
        },
      },
      evaluatedAtMs,
    });
  } catch {
    return null;
  }
}

interface ModeledEntryFill {
  readonly quantity: ExactDecimal;
  readonly quoteNotional: ExactDecimal;
  readonly limitPrice: ExactDecimal;
  readonly consumedLevels: readonly Readonly<{
    readonly price: string;
    readonly quantity: string;
  }>[];
}

type ModeledEntryFillResult =
  | Readonly<{
      ok: true;
      fill: Readonly<ModeledEntryFill>;
    }>
  | Readonly<{
      ok: false;
      reason:
        | 'EXCHANGE_FILTERS_INVALID'
        | 'EXACT_ENTRY_NOTIONAL_UNAVAILABLE';
    }>;

function priceWithinSnapshotHorizon(
  depth: DepthState,
  depthLimit: number,
  side: 'BID' | 'ASK',
  price: string,
): boolean {
  const capturedCount = side === 'BID'
    ? depth.snapshotBidLevelCount
    : depth.snapshotAskLevelCount;
  const boundary = side === 'BID'
    ? depth.snapshotBidFloorPrice
    : depth.snapshotAskCeilingPrice;
  if (
    capturedCount <= 0
    || capturedCount > depthLimit
    || boundary === null
  ) return false;
  if (capturedCount < depthLimit) return true;
  try {
    return side === 'BID'
      ? compareExactDecimals(
          normalizeExactDecimal(price),
          normalizeExactDecimal(boundary),
        ) >= 0
      : compareExactDecimals(
          normalizeExactDecimal(price),
          normalizeExactDecimal(boundary),
        ) <= 0;
  } catch {
    return false;
  }
}

function modeledEntryWithinSnapshotHorizon(
  state: MutableSourceState,
  config: ConfigCut,
  proposal: ProposalCut,
  modeled: Readonly<ModeledEntryFill>,
): boolean {
  const depth = state.depth;
  if (depth === null) return false;
  const side = proposal.direction === 'long' ? 'ASK' : 'BID';
  return modeled.consumedLevels.length > 0
    && modeled.consumedLevels.every((level) => (
      priceWithinSnapshotHorizon(
        depth,
        config.depthLimit,
        side,
        level.price,
      )
    ));
}

function baseQuantityWithinSnapshotHorizon(
  state: MutableSourceState,
  config: ConfigCut,
  side: 'BID' | 'ASK',
  requiredBaseQuantity: ExactDecimal,
): boolean {
  const depth = state.depth;
  if (depth === null) return false;
  const levels = side === 'BID' ? depth.bids : depth.asks;
  let accumulated = ZERO;
  try {
    for (const [price, quantity] of levels) {
      if (!priceWithinSnapshotHorizon(
        depth,
        config.depthLimit,
        side,
        price,
      )) break;
      accumulated = addExactDecimals(
        accumulated,
        normalizeExactDecimal(quantity),
      );
      if (
        compareExactDecimals(accumulated, requiredBaseQuantity) >= 0
      ) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function modeledEntryFill(
  observation: Readonly<VolumeStrategyObservation>,
  filter: FilterCut,
): ModeledEntryFillResult {
  const levels = observation.book.depth === null
    ? null
    : observation.proposal.direction === 'long'
      ? observation.book.depth.asks
      : observation.book.depth.bids;
  if (levels === null) {
    return Object.freeze({
      ok: false,
      reason: 'EXACT_ENTRY_NOTIONAL_UNAVAILABLE',
    });
  }
  let quantity = ZERO;
  let quoteNotional = ZERO;
  let remainingQuote = TARGET_QUOTE_NOTIONAL;
  let limitPrice: ExactDecimal | null = null;
  const consumedLevels: Array<Readonly<{
    readonly price: string;
    readonly quantity: string;
  }>> = [];
  try {
    for (const level of levels) {
      if (compareExactDecimals(remainingQuote, ZERO) <= 0) break;
      const price = normalizeExactDecimal(level.price);
      const available = normalizeExactDecimal(level.quantity);
      if (
        compareExactDecimals(available, ZERO) <= 0
        || compareExactDecimals(price, ZERO) <= 0
        || !exactMultiple(available, filter.stepSize)
        || !exactMultiple(price, filter.tickSize)
      ) {
        return Object.freeze({
          ok: false,
          reason: 'EXCHANGE_FILTERS_INVALID',
        });
      }
      const availableQuote = multiplyExactDecimals(price, available);
      const take = compareExactDecimals(
        availableQuote,
        remainingQuote,
      ) <= 0
        ? available
        : floorQuantityForQuote(
            remainingQuote,
            price,
            filter.stepSize,
          );
      if (take === null || compareExactDecimals(take, ZERO) <= 0) break;
      const legQuote = multiplyExactDecimals(price, take);
      quantity = addExactDecimals(quantity, take);
      quoteNotional = addExactDecimals(quoteNotional, legQuote);
      limitPrice = price;
      consumedLevels.push(Object.freeze({
        price,
        quantity: take,
      }));
      remainingQuote = subtractExactDecimals(
        TARGET_QUOTE_NOTIONAL,
        quoteNotional,
      );
      if (compareExactDecimals(take, available) < 0) break;
    }
  } catch {
    return Object.freeze({
      ok: false,
      reason: 'EXCHANGE_FILTERS_INVALID',
    });
  }
  if (
    limitPrice === null
    || compareExactDecimals(quoteNotional, TARGET_QUOTE_NOTIONAL) !== 0
    || compareExactDecimals(
      quantity,
      normalizeExactDecimal(observation.book.capacity.baseQuantity),
    ) > 0
  ) {
    return Object.freeze({
      ok: false,
      reason: 'EXACT_ENTRY_NOTIONAL_UNAVAILABLE',
    });
  }
  if (
    (
      compareExactDecimals(filter.minPrice, ZERO) > 0
      && compareExactDecimals(limitPrice, filter.minPrice) < 0
    )
    || (
      compareExactDecimals(filter.maxPrice, ZERO) > 0
      && compareExactDecimals(limitPrice, filter.maxPrice) > 0
    )
    || compareExactDecimals(quantity, filter.minQuantity) < 0
    || compareExactDecimals(quantity, filter.maxQuantity) > 0
    || !exactMultiple(quantity, filter.stepSize)
    || compareExactDecimals(quoteNotional, filter.minNotional) < 0
    || (
      filter.maxNotional !== null
      && compareExactDecimals(quoteNotional, filter.maxNotional) > 0
    )
  ) {
    return Object.freeze({
      ok: false,
      reason: 'EXCHANGE_FILTERS_INVALID',
    });
  }
  return Object.freeze({
    ok: true,
    fill: Object.freeze({
      quantity,
      quoteNotional,
      limitPrice,
      consumedLevels: Object.freeze(consumedLevels),
    }),
  });
}

function strategyBinding(
  proposal: ProposalCut,
  validatorExpiresAtMs: number,
): Readonly<VolumeStrategyProposalBinding> {
  return Object.freeze({
    proposalId: proposal.proposalId,
    proposalRevision: proposal.proposalRevision,
    proposalDigest: proposal.proposalDigest,
    configurationRevision: proposal.configurationRevision,
    correlationId: proposal.correlationId,
    symbol: proposal.symbol,
    direction: proposal.direction,
    updatedTs: proposal.updatedTs,
    featureObservedAtMs: proposal.featureObservedAtMs,
    expiresAtMs: validatorExpiresAtMs,
  });
}

function evidenceSourceRef(
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
): Readonly<VolumeForwardMeasurementEvidenceSourceRef> {
  return Object.freeze({
    kind: record.header.kind,
    recordHash: record.recordHash,
    rawSha256: record.header.rawSha256,
    sequence: record.header.sequence,
    sourceEndpoint: record.header.sourceEndpoint,
    sourceStream: record.header.sourceStream,
    sourceTransport: record.header.sourceTransport,
    generation: record.header.generation,
    localReceivedAtMs: record.header.localReceivedAtMs,
    localMonotonicNs: record.header.localMonotonicNs,
  });
}

function sourceCutRefs(
  state: MutableSourceState,
  proposal: ProposalCut,
  config: ConfigCut,
  kill: KillCut,
): readonly Readonly<VolumeForwardMeasurementEvidenceSourceRef>[] {
  const records: Array<Readonly<VolumeForwardMeasurementEvidenceRecord>> = [
    config.record,
    kill.record,
    proposal.record,
    ...(state.filter === null ? [] : [state.filter.record]),
    ...(state.continuityRecord === null ? [] : [state.continuityRecord]),
    ...state.depthProofRecords,
  ];
  const aggregate = state.aggregateTrade?.payload;
  if (aggregate?.kind === 'AGG_TRADE') {
    for (
      let tradeId = aggregate.firstTradeId;
      tradeId <= aggregate.lastTradeId;
      tradeId += 1
    ) {
      const trade = state.tradesById.get(tradeId);
      if (trade !== undefined) records.push(trade.record);
    }
    if (state.aggregateTrade !== null) {
      records.push(state.aggregateTrade.record);
    }
  }
  if (state.bookTicker !== null) records.push(state.bookTicker.record);
  for (const record of [...records]) {
    const frame = state.streamFrameByTypedRecordHash.get(record.recordHash);
    if (frame !== undefined) records.push(frame);
  }
  const unique = new Map(
    records.map((record) => [record.recordHash, record] as const),
  );
  return Object.freeze(
    [...unique.values()]
      .sort((left, right) => left.header.sequence - right.header.sequence)
      .map(evidenceSourceRef),
  );
}

function blockLifecycle(
  lifecycle: MutableLifecycle,
  ...reasons: VolumeForwardMeasurementReplayReason[]
): void {
  lifecycle.state = 'BLOCKED';
  lifecycle.reasons = [...orderedReasons([...lifecycle.reasons, ...reasons])];
}

function bindBlockedSource(
  lifecycle: MutableLifecycle,
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
  state: MutableSourceState | null = null,
  config: ConfigCut | null = null,
  kill: KillCut | null = null,
): void {
  if (lifecycle.state !== 'BLOCKED') return;
  lifecycle.blockedSourceRecordHash = record.recordHash;
  lifecycle.blockedSourceSequence = record.header.sequence;
  if (lifecycle.rejectionBinding !== null) return;
  const evidenceRecords: Array<
    Readonly<VolumeForwardMeasurementEvidenceRecord>
  > = [
    lifecycle.proposal.record,
    record,
  ];
  if (config !== null) evidenceRecords.push(config.record);
  if (kill !== null) evidenceRecords.push(kill.record);
  if (state?.filter !== null && state?.filter !== undefined) {
    evidenceRecords.push(state.filter.record);
  }
  if (state?.continuityRecord !== null && state?.continuityRecord !== undefined) {
    evidenceRecords.push(state.continuityRecord);
  }
  if (state !== null) evidenceRecords.push(...state.depthProofRecords);
  const unique = new Map(
    evidenceRecords.map((sourceRecord) => [
      sourceRecord.recordHash,
      sourceRecord,
    ] as const),
  );
  lifecycle.rejectionBinding = deepFreeze({
    disposition: 'REJECTED_SOURCE_BOUND',
    proposalId: lifecycle.proposal.proposalId,
    proposalRevision: lifecycle.proposal.proposalRevision,
    proposalDigest: lifecycle.proposal.proposalDigest,
    configurationRevision: lifecycle.proposal.configurationRevision,
    correlationId: lifecycle.proposal.correlationId,
    symbol: lifecycle.proposal.symbol,
    direction: lifecycle.proposal.direction,
    proposalRecordHash: lifecycle.proposal.recordHash,
    causeRecordHash: record.recordHash,
    causeRecordSequence: record.header.sequence,
    causeRecordKind: record.header.kind,
    causeLocalReceivedAtMs: record.header.localReceivedAtMs,
    causeLocalMonotonicNs: record.header.localMonotonicNs,
    reasonCodes: orderedReasons(lifecycle.reasons),
    evidenceSources: Object.freeze(
      [...unique.values()]
        .sort((left, right) => (
          left.header.sequence - right.header.sequence
        ))
        .map(evidenceSourceRef),
    ),
    executionAuthority: 'NONE',
    submitAuthority: 'NONE',
    sendEligible: false,
    sends: 0,
    sideEffects: 0,
  });
}

function attemptEntry(
  lifecycle: MutableLifecycle,
  state: MutableSourceState,
  config: ConfigCut | null,
  kill: KillCut | null,
  cut: Readonly<VolumeForwardMeasurementEvidenceRecord>,
  evidencePolicyDigest: string,
): void {
  if (lifecycle.state !== 'PENDING_ENTRY') return;
  const reasons = cutPrerequisites(
    state,
    lifecycle.proposal,
    config,
    kill,
    cut.header.localReceivedAtMs,
    cut.header.localMonotonicNs,
    true,
  );
  lifecycle.reasons = [...reasons];
  if (reasons.length > 0) {
    if (reasons.includes('DETECTOR_PROPOSAL_EXPIRED')) {
      blockLifecycle(lifecycle, 'DETECTOR_PROPOSAL_EXPIRED');
    }
    return;
  }
  const filter = state.filter;
  if (filter === null || config === null || kill === null) return;
  const sourceObservation = buildObservation(
    state,
    lifecycle.proposal,
    cut.header.localReceivedAtMs,
    lifecycle.validatorExpiresAtMs,
  );
  if (sourceObservation === null) {
    lifecycle.reasons = ['OBSERVATION_REJECTED'];
    return;
  }
  const modeledResult = modeledEntryFill(sourceObservation, filter);
  if (!modeledResult.ok) {
    blockLifecycle(lifecycle, modeledResult.reason);
    return;
  }
  const modeled = modeledResult.fill;
  if (!modeledEntryWithinSnapshotHorizon(
    state,
    config,
    lifecycle.proposal,
    modeled,
  )) {
    blockLifecycle(
      lifecycle,
      'SOURCE_DEPTH_SNAPSHOT_HORIZON_EXHAUSTED',
    );
    return;
  }
  const validatorAdapterDepth = modeledValidatorAdapterDepth(
    sourceObservation,
    modeled,
  );
  const observation = validatorAdapterDepth === null
    ? null
    : buildObservation(
        state,
        lifecycle.proposal,
        cut.header.localReceivedAtMs,
        lifecycle.validatorExpiresAtMs,
        validatorAdapterDepth,
      );
  if (
    observation === null
    || normalizeExactDecimal(observation.book.capacity.baseQuantity)
      !== modeled.quantity
    || normalizeExactDecimal(observation.book.capacity.quoteNotional)
      !== TARGET_QUOTE_NOTIONAL
    || normalizeExactDecimal(observation.book.capacity.price)
      !== modeled.limitPrice
  ) {
    blockLifecycle(lifecycle, 'RECORD_ONLY_EVALUATION_REJECTED');
    return;
  }
  const fixtureTag = stableHash128Hex(
    `${evidencePolicyDigest}|${lifecycle.proposal.proposalId}`
    + `|${lifecycle.proposal.proposalRevision}`,
  );
  let evaluation: Readonly<VolumeStrategyEvaluation>;
  let exitPolicy: Readonly<VolumeEconomicExitPolicy>;
  try {
    const economics = createSyntheticVolumeEconomics({
      fixtureId: `ve2-entry-${fixtureTag}`,
      valuationAsset: 'USDT',
      grossEdgePer1000ValuationNotional: '1',
      accountFeeBpsPerSide: '0',
      slippageBpsPerSide: '0',
      liquidityCapacity: observation.book.capacity.quoteNotional,
      evaluatedAtMs: observation.evaluatedAtMs,
      expiresAtMs: lifecycle.validatorExpiresAtMs,
    });
    evaluation = evaluateVolumeStrategy({
      proposal: strategyBinding(
        lifecycle.proposal,
        lifecycle.validatorExpiresAtMs,
      ),
      observation,
      economics,
    }, {
      enabled: true,
      killSwitchEngaged: true,
    });
    if (
      evaluation.disposition !== 'VALIDATED_RECORD_ONLY'
      || evaluation.plan.executionTerms === null
      || normalizeExactDecimal(
        evaluation.plan.executionTerms.baseQuantity,
      ) !== modeled.quantity
      || normalizeExactDecimal(
        evaluation.plan.executionTerms.quoteNotional,
      ) !== TARGET_QUOTE_NOTIONAL
      || normalizeExactDecimal(
        evaluation.plan.executionTerms.price,
      ) !== modeled.limitPrice
      || evaluation.plan.sendEligible !== false
      || evaluation.plan.submitAuthority !== 'NONE'
      || evaluation.plan.executionAuthority !== 'NONE'
      || evaluation.plan.sends !== 0
      || evaluation.plan.sideEffects !== 0
      || evaluation.plan.submitPortPresent !== false
      || evaluation.plan.publicOnly !== true
      || evaluation.plan.privateCalls !== false
      || evaluation.plan.signedCalls !== false
      || evaluation.plan.providerCalls !== false
    ) {
      blockLifecycle(lifecycle, 'RECORD_ONLY_EVALUATION_REJECTED');
      return;
    }
    exitPolicy = buildSyntheticVolumeEconomicExitPolicy({
      fixtureId: `ve2-exit-${fixtureTag}`,
      modeledBaseQuantity: modeled.quantity,
      accountFeeBpsPerSide: '0',
      slippageBpsPerSide: '0',
      netLiquidationStopLossPer1000: SYNTHETIC_DISABLED_THRESHOLD,
      trailingDrawdownPer1000: SYNTHETIC_DISABLED_THRESHOLD,
      netLiquidationReversalLossPer1000: SYNTHETIC_DISABLED_THRESHOLD,
      evaluatedAtMs: observation.evaluatedAtMs,
      expiresAtMs: lifecycle.validatorExpiresAtMs,
    });
  } catch {
    blockLifecycle(lifecycle, 'RECORD_ONLY_EVALUATION_REJECTED');
    return;
  }
  const initial = evaluateVolumeEconomicExit({
    entryEvaluation: evaluation,
    entryObservation: observation,
    currentObservation: observation,
    policy: exitPolicy,
    previousSample: null,
    evaluatedAtMs: observation.evaluatedAtMs,
  }, {
    enabled: true,
    killSwitchEngaged: true,
  });
  if (
    initial.sample === null
    || initial.decision.lifecyclePhase === 'REJECTED'
    || normalizeExactDecimal(initial.sample.entryQuoteNotional)
      !== modeled.quoteNotional
  ) {
    blockLifecycle(lifecycle, 'RECORD_ONLY_EXIT_POLICY_REJECTED');
    return;
  }
  lifecycle.state = 'ACTIVE';
  lifecycle.reasons = [];
  lifecycle.entryObservation = observation;
  lifecycle.entryEvaluation = evaluation;
  lifecycle.exitPolicy = exitPolicy;
  lifecycle.priorSample = initial.sample;
  lifecycle.exitDecision = initial.decision;
  lifecycle.initialExitDecisionId = initial.decision.decisionId;
  lifecycle.initialSampleId = initial.sample.sampleId;
  lifecycle.entryMonotonicNs = BigInt(cut.header.localMonotonicNs);
  lifecycle.entryRecordSequence = cut.header.sequence;
  lifecycle.entrySourceRecordHash = cut.recordHash;
  lifecycle.lastEvaluationMonotonicNs = BigInt(cut.header.localMonotonicNs);
  lifecycle.entryModeledFill = modeled;
  lifecycle.binding = Object.freeze({
    policyDigest: evidencePolicyDigest,
    proposalId: lifecycle.proposal.proposalId,
    proposalRevision: lifecycle.proposal.proposalRevision,
    proposalDigest: lifecycle.proposal.proposalDigest,
    configurationRevision: lifecycle.proposal.configurationRevision,
    correlationId: lifecycle.proposal.correlationId,
    symbol: lifecycle.proposal.symbol,
    direction: lifecycle.proposal.direction,
    configRecordHash: config.recordHash,
    killRecordHash: kill.recordHash,
    exchangeInfoRecordHash: filter.recordHash,
    entryEvidenceSources: sourceCutRefs(
      state,
      lifecycle.proposal,
      config,
      kill,
    ),
    exitEvidenceSources: Object.freeze([]),
    entryGeneration: observation.source.generation,
    entrySourceRevision: observation.source.revision,
    entryValidatorAdapterObservationDigest: observation.observationDigest,
    exitGeneration: null,
    exitSourceRevision: null,
    exitValidatorAdapterObservationDigest: null,
    validatorAdapterOnly: true,
  });
}

function attemptExit(
  lifecycle: MutableLifecycle,
  state: MutableSourceState,
  config: ConfigCut | null,
  kill: KillCut | null,
  cut: Readonly<VolumeForwardMeasurementEvidenceRecord>,
): void {
  if (
    lifecycle.state !== 'ACTIVE'
    || lifecycle.entryObservation === null
    || lifecycle.entryEvaluation === null
    || lifecycle.exitPolicy === null
    || lifecycle.priorSample === null
    || lifecycle.entryMonotonicNs === null
  ) return;
  const monotonic = BigInt(cut.header.localMonotonicNs);
  if (
    monotonic - lifecycle.entryMonotonicNs < MIN_EXIT_DELAY_NS
    || cut.header.localReceivedAtMs
      - lifecycle.entryObservation.evaluatedAtMs < 60_000
  ) return;
  if (state.generation !== lifecycle.binding?.entryGeneration) {
    blockLifecycle(lifecycle, 'SOURCE_GENERATION_CHANGED');
    return;
  }
  const reasons = cutPrerequisites(
    state,
    lifecycle.proposal,
    config,
    kill,
    cut.header.localReceivedAtMs,
    cut.header.localMonotonicNs,
    false,
  );
  if (reasons.length > 0) {
    lifecycle.reasons = [...reasons];
    return;
  }
  if (
    config === null
    || lifecycle.entryModeledFill === null
    || !baseQuantityWithinSnapshotHorizon(
      state,
      config,
      lifecycle.proposal.direction === 'long' ? 'BID' : 'ASK',
      lifecycle.entryModeledFill.quantity,
    )
  ) {
    blockLifecycle(
      lifecycle,
      'SOURCE_DEPTH_SNAPSHOT_HORIZON_EXHAUSTED',
    );
    return;
  }
  const observation = buildObservation(
    state,
    lifecycle.proposal,
    cut.header.localReceivedAtMs,
    lifecycle.validatorExpiresAtMs,
  );
  if (observation === null) {
    lifecycle.reasons = ['OBSERVATION_REJECTED'];
    return;
  }
  const result = evaluateVolumeEconomicExit({
    entryEvaluation: lifecycle.entryEvaluation,
    entryObservation: lifecycle.entryObservation,
    currentObservation: observation,
    policy: lifecycle.exitPolicy,
    previousSample: lifecycle.priorSample,
    evaluatedAtMs: observation.evaluatedAtMs,
  }, {
    enabled: true,
    killSwitchEngaged: true,
  });
  if (
    result.sample === null
    || result.decision.lifecyclePhase === 'REJECTED'
    || result.sample.sourceDisposition !== 'ACCEPTED'
  ) {
    blockLifecycle(lifecycle, 'RECORD_ONLY_EXIT_POLICY_REJECTED');
    return;
  }
  lifecycle.priorSample = result.sample;
  lifecycle.exitDecision = result.decision;
  lifecycle.lastEvaluationMonotonicNs = monotonic;
  if (result.decision.lifecyclePhase !== 'TERMINAL_EXIT') return;
  const exitPlan = result.decision.exitPlan;
  if (
    exitPlan === null
    || exitPlan.validation !== 'REJECTED'
    || exitPlan.executionAuthority !== 'NONE'
    || exitPlan.submitAuthority !== 'NONE'
    || exitPlan.sendEligible !== false
    || exitPlan.sends !== 0
    || exitPlan.sideEffects !== 0
    || exitPlan.submitPortPresent !== false
    || exitPlan.queryPortPresent !== false
    || exitPlan.publicOnly !== true
    || exitPlan.privateCalls !== false
    || exitPlan.signedCalls !== false
    || exitPlan.providerCalls !== false
    || exitPlan.exchangeQueries !== 0
  ) {
    blockLifecycle(lifecycle, 'RECORD_ONLY_EXIT_POLICY_REJECTED');
    return;
  }
  lifecycle.state = 'TERMINAL';
  lifecycle.reasons = [];
  lifecycle.terminalSampleId = result.sample.sampleId;
  lifecycle.terminalExitQuoteNotional = result.sample.exitQuoteNotional === null
    ? null
    : normalizeExactDecimal(result.sample.exitQuoteNotional);
  lifecycle.terminalRecordSequence = cut.header.sequence;
  lifecycle.terminalSourceRecordHash = cut.recordHash;
  const binding = lifecycle.binding;
  if (binding !== null && config !== null && kill !== null) {
    lifecycle.binding = Object.freeze({
      ...binding,
      exitEvidenceSources: sourceCutRefs(
        state,
        lifecycle.proposal,
        config,
        kill,
      ),
      exitGeneration: observation.source.generation,
      exitSourceRevision: observation.source.revision,
      exitValidatorAdapterObservationDigest: observation.observationDigest,
    });
  }
}

function modeledValidatorAdapterDepth(
  observation: Readonly<VolumeStrategyObservation>,
  modeled: Readonly<ModeledEntryFill>,
): Readonly<ValidatorAdapterDepthLevels> | null {
  const depth = observation.book.depth;
  if (
    depth === null
    || modeled.consumedLevels.length === 0
    || depth.bids[0] === undefined
    || depth.asks[0] === undefined
  ) return null;
  const untouchedBid = Object.freeze({
    price: depth.bids[0].price,
    quantity: depth.bids[0].quantity,
  });
  const untouchedAsk = Object.freeze({
    price: depth.asks[0].price,
    quantity: depth.asks[0].quantity,
  });
  return observation.proposal.direction === 'long'
    ? Object.freeze({
        bids: Object.freeze([untouchedBid]),
        asks: modeled.consumedLevels,
      })
    : Object.freeze({
        bids: modeled.consumedLevels,
        asks: Object.freeze([untouchedAsk]),
      });
}

function sourceNativeEconomicsFacts(
  lifecycle: MutableLifecycle,
): Readonly<VolumeForwardMeasurementLifecycleRecord['sourceNativeEconomics']> {
  const entry = lifecycle.entryModeledFill;
  const exitQuoteNotional = lifecycle.terminalExitQuoteNotional;
  if (
    lifecycle.state !== 'TERMINAL'
    || entry === null
    || exitQuoteNotional === null
  ) {
    return deepFreeze({
      state: 'UNKNOWN',
      entryQuoteNotional: entry?.quoteNotional ?? null,
      entryBaseQuantity: entry?.quantity ?? null,
      entryLimitPrice: entry?.limitPrice ?? null,
      exitQuoteNotional,
      grossPnlQuote: null,
      grossEdgePer1000ValuationNotional: null,
      publicFeeScenarios: Object.freeze([]),
      accountEffectiveFeeBpsPerSide: null,
    });
  }
  try {
    const grossPnlQuote = lifecycle.proposal.direction === 'long'
      ? subtractExactDecimals(exitQuoteNotional, entry.quoteNotional)
      : subtractExactDecimals(entry.quoteNotional, exitQuoteNotional);
    const grossEdgePer1000ValuationNotional = divideExactDecimals(
      multiplyExactDecimals(
        grossPnlQuote,
        normalizeExactDecimal('1000'),
      ),
      entry.quoteNotional,
      24,
    );
    const totalTradedQuoteNotional = addExactDecimals(
      entry.quoteNotional,
      exitQuoteNotional,
    );
    const publicFeeScenarios = (['10', '12'] as const).map(
      (feeBpsPerSide) => {
        const modeledPublicFees = divideExactDecimals(
          multiplyExactDecimals(
            totalTradedQuoteNotional,
            normalizeExactDecimal(feeBpsPerSide),
          ),
          normalizeExactDecimal('10000'),
          24,
        );
        const netPnlQuote = subtractExactDecimals(
          grossPnlQuote,
          modeledPublicFees,
        );
        return Object.freeze({
          feeBpsPerSide,
          netPnlQuote,
          netEdgePer1000ValuationNotional: divideExactDecimals(
            multiplyExactDecimals(
              netPnlQuote,
              normalizeExactDecimal('1000'),
            ),
            entry.quoteNotional,
            24,
          ),
        });
      },
    );
    return deepFreeze({
      state: 'PUBLIC_SOURCE_FACTS_ONLY',
      entryQuoteNotional: entry.quoteNotional,
      entryBaseQuantity: entry.quantity,
      entryLimitPrice: entry.limitPrice,
      exitQuoteNotional,
      grossPnlQuote,
      grossEdgePer1000ValuationNotional,
      publicFeeScenarios,
      accountEffectiveFeeBpsPerSide: null,
    });
  } catch {
    return deepFreeze({
      state: 'UNKNOWN',
      entryQuoteNotional: entry.quoteNotional,
      entryBaseQuantity: entry.quantity,
      entryLimitPrice: entry.limitPrice,
      exitQuoteNotional,
      grossPnlQuote: null,
      grossEdgePer1000ValuationNotional: null,
      publicFeeScenarios: Object.freeze([]),
      accountEffectiveFeeBpsPerSide: null,
    });
  }
}

function lifecycleRecord(
  lifecycle: MutableLifecycle,
): Readonly<VolumeForwardMeasurementLifecycleRecord> {
  const state = lifecycle.state === 'TERMINAL' ? 'EXACT' as const : 'BLOCKED' as const;
  const reasons = state === 'EXACT'
    ? orderedReasons([])
    : orderedReasons([
        ...lifecycle.reasons,
        ...(lifecycle.state === 'ACTIVE' || lifecycle.state === 'PENDING_ENTRY'
          ? ['OUTCOME_CUT_MISSING'] as const
          : []),
      ]);
  const validatorAdapterProof = lifecycle.entryEvaluation === null
    || lifecycle.entryModeledFill === null
    ? null
    : {
        entryEvaluationId: lifecycle.entryEvaluation.evaluationId,
        entryPlanId: lifecycle.entryEvaluation.plan.planId,
        exitDecisionId: lifecycle.exitDecision?.decisionId ?? null,
        exitPlanId: lifecycle.exitDecision?.exitPlan?.planId ?? null,
        runtimeStrategyEnabled: false as const,
        validatorAdapterEvaluationEnabled: true as const,
        killSwitchEngaged: true as const,
        executionAuthority: 'NONE' as const,
        submitAuthority: 'NONE' as const,
        sendEligible: false as const,
        sends: 0 as const,
        sideEffects: 0 as const,
        publicOnly: true as const,
        privateCalls: false as const,
        signedCalls: false as const,
        providerCalls: false as const,
        entryModeledBaseQuantity: lifecycle.entryModeledFill.quantity,
        entryModeledLimitPrice: lifecycle.entryModeledFill.limitPrice,
        entryModeledQuoteNotional: '10' as const,
        capturedRestBaseUrl:
          'https://data-api.binance.vision' as const,
        capturedWebsocketBaseUrl:
          'wss://data-stream.binance.vision' as const,
        legacyValidatorRestBaseUrl: VOLUME_PUBLIC_REST_BASE_URL,
        provenanceDisposition:
          'CAPTURED_SOURCE_AUTHORITATIVE_VALIDATOR_ADAPTER_NON_AUTHORITATIVE' as const,
      };
  const sourceNativeEconomics = sourceNativeEconomicsFacts(lifecycle);
  const semantic = {
    state,
    reasons,
    binding: lifecycle.binding,
    rejectionBinding: lifecycle.rejectionBinding,
    validatorAdapterProof,
    terminalSampleId: lifecycle.terminalSampleId,
    sourceNativeEconomics,
  };
  return deepFreeze({
    schemaVersion: VOLUME_FORWARD_MEASUREMENT_REPLAY_SCHEMA_VERSION,
    lifecycleId: lifecycleIdentity(semantic),
    state,
    reasonCodes: reasons,
    binding: lifecycle.binding,
    rejectionBinding: lifecycle.rejectionBinding,
    entryEvaluation: null,
    exitDecision: null,
    validatorAdapterOnly: true,
    validatorAdapterProof,
    terminalSampleId: lifecycle.terminalSampleId,
    lifecyclePhase: state === 'EXACT'
      ? 'TERMINAL_EXIT'
      : 'BLOCKED',
    sourceNativeEconomics,
    profitabilityClaim: false,
  });
}

function replayResult(
  input: Omit<VolumeForwardMeasurementReplayResult, 'replayId'>,
): Readonly<VolumeForwardMeasurementReplayResult> {
  const semantic = {
    ...input,
    lifecycles: input.lifecycles.map((lifecycle) => ({
      lifecycleId: lifecycle.lifecycleId,
      state: lifecycle.state,
      reasonCodes: lifecycle.reasonCodes,
    })),
  };
  return deepFreeze({
    ...input,
    replayId: replayIdentity(semantic),
  });
}

function blockedReplay(
  reason: VolumeForwardMeasurementReplayReason,
): Readonly<VolumeForwardMeasurementReplayResult> {
  return replayResult({
    schemaVersion: VOLUME_FORWARD_MEASUREMENT_REPLAY_SCHEMA_VERSION,
    state: 'BLOCKED',
    reasonCodes: orderedReasons([reason]),
    chainId: null,
    policyDigest: null,
    evidencePolicyDigest: null,
    terminalHash: null,
    sourceAuthenticity: null,
    trustedAnchors: null,
    evidenceRecordCount: 0,
    replayProfile: null,
    segmentFacts: null,
    lifecycles: Object.freeze([]),
    consumerGate: VOLUME_FORWARD_MEASUREMENT_CONSUMER_GATE,
    economics: null,
    profitabilityClaim: false,
    mode: 'SHADOW_ONLY',
    measurementMode: VOLUME_FORWARD_MEASUREMENT_REPLAY_MODE,
    recordOnly: true,
    strategyEnabled: false,
    killSwitchEngaged: true,
    submitAuthority: false,
    casAuthority: false,
    privateOrSignedCalls: 0,
    orders: 0,
    transfers: 0,
    withdrawals: 0,
    moneyUsd: 0,
  });
}

function canonicalEvidenceBytesSha256(
  records: readonly Readonly<VolumeForwardMeasurementEvidenceRecord>[],
): string {
  const hash = createHash('sha256');
  for (const record of records) {
    hash.update(canonicalJson(record), 'utf8');
    hash.update('\n', 'utf8');
  }
  return hash.digest('hex');
}

function canonicalEvidenceBytesBeforeSeal(
  records: readonly Readonly<VolumeForwardMeasurementEvidenceRecord>[],
): number {
  let bytes = 0;
  for (const record of records.slice(0, -1)) {
    bytes += Buffer.byteLength(canonicalJson(record), 'utf8') + 1;
  }
  return bytes;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0);
}

function sealProposalFactsFromCoverage(
  cuts: readonly Readonly<ParsedDetectorCoverageCut>[],
): readonly Readonly<
  VolumeForwardMeasurementTerminalSegmentDetectorProposalFact
>[] | null {
  const proposals: VolumeForwardMeasurementTerminalSegmentDetectorProposalFact[] = [];
  const ids = new Set<string>();
  for (const cut of cuts) {
    for (const proposal of cut.value.acceptedProposals) {
      if (ids.has(proposal.proposalId)) return null;
      ids.add(proposal.proposalId);
      proposals.push(Object.freeze({
        cutOffset: proposal.cutOffset,
        proposalId: proposal.proposalId,
        proposalRevision: proposal.proposalRevision,
        proposalDigest: proposal.proposalDigest,
        symbol: proposal.symbol,
        detectorDecisionDigest: proposal.detectorDecisionDigest,
        featureDigest: proposal.featureDigest,
      }));
    }
  }
  proposals.sort((left, right) => compareText(
    segmentProposalSortKey(left),
    segmentProposalSortKey(right),
  ));
  return Object.freeze(proposals);
}

function sealProposalFactsWithoutCut(
  proposals: readonly Readonly<
    VolumeForwardMeasurementTerminalSegmentDetectorProposalFact
  >[],
): readonly Readonly<
  VolumeForwardMeasurementTerminalSegmentProposalFact
>[] {
  return Object.freeze(proposals.map((proposal) => Object.freeze({
    proposalId: proposal.proposalId,
    proposalRevision: proposal.proposalRevision,
    proposalDigest: proposal.proposalDigest,
    symbol: proposal.symbol,
  })));
}

function maximumVerifiedDetectorCutGapMs(
  cuts: readonly Readonly<ParsedDetectorCoverageCut>[],
): number | null {
  let maximum = 0;
  for (let index = 0; index < cuts.length; index += 1) {
    const current = cuts[index];
    if (
      current.value.localReceivedAtMs < current.value.cutAtMs
      || current.value.localReceivedAtMs
        >= current.value.cutAtMs
          + VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
    ) return null;
    if (index === 0) continue;
    const prior = cuts[index - 1];
    const gap = current.value.cutAtMs - prior.value.cutAtMs;
    if (
      gap <= 0
      || gap > VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
      || current.value.localReceivedAtMs
        <= prior.value.localReceivedAtMs
      || BigInt(current.value.localMonotonicNs)
        <= BigInt(prior.value.localMonotonicNs)
    ) return null;
    maximum = Math.max(maximum, gap);
  }
  return maximum;
}

function zeroLifecycleStateCounts(value: unknown): boolean {
  const counts = dataRecord(value);
  return counts !== null
    && exactDataKeys(counts, [
      'BLOCKED',
      'ENTRY_RECORDED',
      'EXACT',
      'HOLDING',
      'OBSERVED',
      'TERMINAL_EXIT',
    ])
    && Object.values(counts).every((count) => count === 0);
}

function replayDetectorCoverageSegment(
  records: readonly Readonly<VolumeForwardMeasurementEvidenceRecord>[],
  policy: Readonly<VolumeForwardDetectorCoveragePolicy>,
  expectedPolicyDigest: string,
  expectedTerminalHash: string,
  canonicalJsonlBytes: number,
  cumulativeRawPayloadBytes: number,
): Readonly<VolumeForwardMeasurementReplayResult> {
  const sealRecord = records.at(-1);
  if (sealRecord?.header.kind !== 'TERMINAL_SEAL') {
    return blockedReplay('SEGMENT_DESCRIPTOR_INVALID');
  }
  const seal = parseSegmentSeal(sealRecord);
  const parsedCuts: ParsedDetectorCoverageCut[] = [];
  let unexpected = false;
  for (const record of records.slice(1, -1)) {
    if (record.header.kind !== 'DETECTOR_COVERAGE') {
      unexpected = true;
      continue;
    }
    const cut = parseDetectorCoverageCut(record);
    if (cut === null) unexpected = true;
    else parsedCuts.push(cut);
  }
  const reasons = new Set<VolumeForwardMeasurementReplayReason>();
  if (
    seal === null
    || seal.coverageRole !== 'DETECTOR_COVERAGE'
    || seal.symbol !== null
    || unexpected
  ) reasons.add('SEGMENT_DESCRIPTOR_INVALID');
  if (parsedCuts.length === 0) reasons.add('SEGMENT_COVERAGE_INVALID');

  let priorCut: Readonly<ParsedDetectorCoverageCut> | null = null;
  let universeDigest: string | null = null;
  let universeCount: number | null = null;
  let pseudoProposalExcludedCount = 0;
  const runtimeGenerations = new Set<number>();
  for (const cut of parsedCuts) {
    const value = cut.value;
    runtimeGenerations.add(value.runtimeGeneration);
    pseudoProposalExcludedCount += value.pseudoProposalExcludedCount;
    if (
      !Number.isSafeInteger(pseudoProposalExcludedCount)
      || value.complete !== true
      || value.observerDropCount !== 0
      || value.observerFailureCount !== 0
      || value.evaluationUniverseCount < value.acceptedProposals.length
      || value.cutAtMs
        !== policy.outcomeOpensAtMs
          + value.cutOffset * VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
      || value.cutAtMs < policy.outcomeOpensAtMs
      || value.cutAtMs >= policy.outcomeClosesAtMs
      || value.detectorInputSourceId !== policy.detectorInputSourceId
      || value.detectorInputSourceDigest
        !== policy.detectorInputSourceDigest
    ) reasons.add('SEGMENT_COVERAGE_INVALID');
    universeDigest = value.evaluationUniverseDigest;
    universeCount = value.evaluationUniverseCount;
    if (priorCut !== null && (
      value.cutOffset !== priorCut.value.cutOffset + 1
      || value.cutAtMs
        !== priorCut.value.cutAtMs
          + VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
      || value.detectorTickRevision
        !== priorCut.value.detectorTickRevision + 1
      || value.previousCutDigest !== priorCut.value.cutDigest
    )) reasons.add('SEGMENT_COVERAGE_INVALID');
    priorCut = cut;
  }
  const acceptedProposals = sealProposalFactsFromCoverage(parsedCuts);
  if (acceptedProposals === null) reasons.add('SEGMENT_COVERAGE_INVALID');
  const proposalFacts = acceptedProposals ?? Object.freeze([]);
  const maximumCutGapMs =
    maximumVerifiedDetectorCutGapMs(parsedCuts);
  if (maximumCutGapMs === null) {
    reasons.add('SEGMENT_COVERAGE_INVALID');
  }
  const firstCut = parsedCuts[0]?.value;
  const lastCut = parsedCuts.at(-1)?.value;
  const expectedCutCount = seal === null
    ? 0
    : (
        seal.coverageEndExclusiveMs - seal.coverageStartMs
      ) / VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS;
  if (
    seal !== null
    && (
      seal.corePolicyDigest !== expectedPolicyDigest
      || seal.packetMeasurementPolicySha256
        !== FROZEN_PACKET_POLICY_SHA256
      || seal.detectorInputSourceId !== policy.detectorInputSourceId
      || seal.detectorInputSourceDigest
        !== policy.detectorInputSourceDigest
      || seal.coverageStartMs !== firstCut?.cutAtMs
      || seal.coverageEndExclusiveMs
        !== (lastCut?.cutAtMs ?? 0)
          + VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
      || !Number.isSafeInteger(expectedCutCount)
      || expectedCutCount <= 0
      || expectedCutCount !== parsedCuts.length
      || seal.pseudoProposalExcludedCount
        !== pseudoProposalExcludedCount
      || !canonicalEqual(
        seal.acceptedProposals,
        sealProposalFactsWithoutCut(proposalFacts),
      )
      || seal.recordBounds.firstHash !== records[0]?.recordHash
      || seal.recordBounds.sealedTailHash
        !== sealRecord.header.sealedTailHash
      || seal.recordBounds.firstSequence !== 0
      || seal.recordBounds.lastSequence !== sealRecord.header.sequence - 1
      || seal.recordBounds.recordCount !== records.length - 1
      || seal.recordBounds.byteCount
        !== canonicalEvidenceBytesBeforeSeal(records)
      || seal.generationSummary.count !== runtimeGenerations.size
      || seal.generationSummary.continuityGapCount !== 0
      || seal.generationSummary.unresolvedCount !== 0
      || seal.detectorCoverage.coverageChainKey !== seal.chainKey
      || (
        seal.segmentIndex === 0
          ? firstCut?.cutOffset !== 0
          : firstCut?.cutOffset === 0
      )
      || seal.detectorCoverage.firstCutOffset !== firstCut?.cutOffset
      || seal.detectorCoverage.lastCutOffset !== lastCut?.cutOffset
      || seal.detectorCoverage.cutCount !== parsedCuts.length
      || seal.detectorCoverage.expectedCutCount !== expectedCutCount
      || seal.detectorCoverage.missingCutCount !== 0
      || seal.detectorCoverage.maxGapMs !== maximumCutGapMs
      || seal.detectorCoverage.uncoveredMs !== 0
      || seal.detectorCoverage.firstCutDigest !== firstCut?.cutDigest
      || seal.detectorCoverage.lastCutDigest !== lastCut?.cutDigest
      || seal.detectorCoverage.complete !== true
      || seal.lifecycleSummary.assertionCount !== 0
      || seal.lifecycleSummary.openCount !== 0
      || !Array.isArray(seal.lifecycleSummary.proposalKeys)
      || seal.lifecycleSummary.proposalKeys.length !== 0
      || !zeroLifecycleStateCounts(seal.lifecycleSummary.stateCounts)
    )
  ) reasons.add('SEGMENT_COVERAGE_INVALID');
  if (
    seal !== null
    && (
      seal.coverageStartMs < policy.outcomeOpensAtMs
      || seal.coverageEndExclusiveMs > policy.outcomeClosesAtMs
      || seal.coverageStartMs
        % VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS !== 0
      || seal.coverageEndExclusiveMs
        % VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS !== 0
    )
  ) reasons.add('SEGMENT_COVERAGE_INVALID');
  if (
    parsedCuts.some((cut) => (
      cut.value.captureId !== seal?.captureId
      || cut.value.activationId !== seal?.activationId
      || cut.value.segmentId !== seal?.segmentId
      || cut.value.chainKey !== seal?.chainKey
      || cut.value.detectorInputSourceId !== seal?.detectorInputSourceId
      || cut.value.detectorInputSourceDigest
        !== seal?.detectorInputSourceDigest
    ))
  ) reasons.add('SEGMENT_COVERAGE_INVALID');
  const reasonCodes = orderedReasons(reasons);
  const segmentFacts: VolumeForwardMeasurementTerminalSegmentFacts | null =
    seal === null || firstCut === undefined || lastCut === undefined
      ? null
      : {
          schemaVersion: 've2.evidence-segment-descriptor.v1',
          profile: VOLUME_FORWARD_MEASUREMENT_TERMINAL_SEGMENT_PROFILE,
          purpose: VOLUME_FORWARD_MEASUREMENT_SEGMENT_PURPOSE,
          activationId: seal.activationId,
          captureId: seal.captureId,
          segmentId: seal.segmentId,
          coverageRole: 'DETECTOR_COVERAGE',
          chainKey: seal.chainKey,
          symbol: null,
          segmentIndex: seal.segmentIndex,
          previousTerminalHash: seal.previousTerminalHash,
          corePolicyDigest: expectedPolicyDigest,
          packetMeasurementPolicySha256: FROZEN_PACKET_POLICY_SHA256,
          terminalHash: expectedTerminalHash,
          evidenceBytesSha256: canonicalEvidenceBytesSha256(records),
          detectorInputSourceId: policy.detectorInputSourceId,
          detectorInputSourceDigest: policy.detectorInputSourceDigest,
          coverageStartMs: seal.coverageStartMs,
          coverageEndExclusiveMs: seal.coverageEndExclusiveMs,
          firstRecordHash: records[0]?.recordHash ?? '',
          lastRecordHash: expectedTerminalHash,
          firstLocalReceivedAtMs:
            records[0]?.header.localReceivedAtMs ?? 0,
          lastLocalReceivedAtMs: sealRecord.header.localReceivedAtMs,
          firstLocalMonotonicNs:
            records[0]?.header.localMonotonicNs ?? '0',
          lastLocalMonotonicNs: sealRecord.header.localMonotonicNs,
          recordCount: records.length,
          canonicalJsonlBytes,
          cumulativeRawPayloadBytes,
          generationCount: runtimeGenerations.size,
          allGenerationsClosed: true,
          continuityGapCount: 0,
          unresolvedContinuityGapCount: 0,
          detectorCutFirstIndex: firstCut.cutOffset,
          detectorCutCount: parsedCuts.length,
          detectorExpectedCutCount: expectedCutCount,
          detectorCadenceMs:
            VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS,
          missingDetectorCutCount: 0,
          detectorMissingCutRanges: Object.freeze([]),
          maximumDetectorCutGapMs: maximumCutGapMs ?? 0,
          sourceUncoveredDurationMs: 0,
          detectorBatchPreviousDigest: firstCut.previousCutDigest,
          detectorBatchTerminalDigest: lastCut.cutDigest,
          detectorEvaluationUniverseDigest: universeDigest,
          detectorEvaluationUniverseCount: universeCount ?? 0,
          detectorCoverageComplete: true,
          acceptedProposals: proposalFacts,
          acceptedProposalIds: Object.freeze(
            proposalFacts.map((proposal) => proposal.proposalId),
          ),
          pseudoProposalExcludedCount,
          lifecycleProposals: Object.freeze([]),
          lifecycleProposalIds: Object.freeze([]),
          lifecycleCount: 0,
          terminalLifecycleCount: 0,
          blockedLifecycleCount: 0,
          openLifecycleCount: 0,
          nonTruncated: true,
          quiescent: true,
          profitabilityClaim: false,
          consumerGate: VOLUME_FORWARD_MEASUREMENT_CONSUMER_GATE,
        };
  return replayResult({
    schemaVersion: VOLUME_FORWARD_MEASUREMENT_REPLAY_SCHEMA_VERSION,
    state: reasonCodes.length === 0 ? 'EXACT' : 'BLOCKED',
    reasonCodes,
    chainId: records[0]?.header.chainId ?? null,
    policyDigest: policy.policyDigest,
    evidencePolicyDigest: expectedPolicyDigest,
    terminalHash: expectedTerminalHash,
    sourceAuthenticity: 'TRUSTED_ANCHOR_MATCHED',
    trustedAnchors: Object.freeze({
      expectedPolicyDigest,
      expectedTerminalHash,
      policyDigestMatched: true,
      terminalHashMatched: true,
    }),
    evidenceRecordCount: records.length,
    replayProfile: VOLUME_FORWARD_MEASUREMENT_TERMINAL_SEGMENT_PROFILE,
    segmentFacts,
    lifecycles: Object.freeze([]),
    consumerGate: VOLUME_FORWARD_MEASUREMENT_CONSUMER_GATE,
    economics: null,
    profitabilityClaim: false,
    mode: 'SHADOW_ONLY',
    measurementMode: VOLUME_FORWARD_MEASUREMENT_REPLAY_MODE,
    recordOnly: true,
    strategyEnabled: false,
    killSwitchEngaged: true,
    submitAuthority: false,
    casAuthority: false,
    privateOrSignedCalls: 0,
    orders: 0,
    transfers: 0,
    withdrawals: 0,
    moneyUsd: 0,
  });
}

function lifecycleStateCounts(
  assertions: readonly Readonly<LifecycleAssertion>[],
): Readonly<Record<LifecycleAssertion['state'], number>> {
  const counts: Record<LifecycleAssertion['state'], number> = {
    OBSERVED: 0,
    ENTRY_RECORDED: 0,
    HOLDING: 0,
    TERMINAL_EXIT: 0,
    BLOCKED: 0,
    EXACT: 0,
  };
  for (const assertion of assertions) counts[assertion.state] += 1;
  return Object.freeze(counts);
}

function deriveSymbolLifecycleSegment(
  records: readonly Readonly<VolumeForwardMeasurementEvidenceRecord>[],
  policy: Readonly<VolumeForwardMeasurementPolicy>,
  expectedPolicyDigest: string,
  expectedTerminalHash: string,
  canonicalJsonlBytes: number,
  cumulativeRawPayloadBytes: number,
  cuts: readonly Readonly<ParsedDetectorCoverageCut>[],
  lifecycles: ReadonlyMap<string, MutableLifecycle>,
  assertions: readonly Readonly<LifecycleAssertion>[],
  lifecycleRecords:
    readonly Readonly<VolumeForwardMeasurementLifecycleRecord>[],
  generationFacts: readonly Readonly<GenerationFact>[],
  pseudoProposalRecordCount: number,
): Readonly<{
  facts: Readonly<VolumeForwardMeasurementTerminalSegmentFacts> | null;
  reasons: readonly VolumeForwardMeasurementReplayReason[];
}> {
  const reasons = new Set<VolumeForwardMeasurementReplayReason>();
  const sealRecord = records.at(-1);
  const seal = sealRecord?.header.kind === 'TERMINAL_SEAL'
    ? parseSegmentSeal(sealRecord)
    : null;
  if (
    seal === null
    || seal.coverageRole !== 'SYMBOL_LIFECYCLE'
    || seal.symbol !== policy.symbol
  ) reasons.add('SEGMENT_DESCRIPTOR_INVALID');
  if (cuts.length === 0) reasons.add('SEGMENT_COVERAGE_INVALID');
  const firstCut = cuts[0]?.value;
  const lastCut = cuts.at(-1)?.value;
  let priorCut: Readonly<ParsedDetectorCoverageCut> | null = null;
  let universeDigest: string | null = null;
  let universeCount: number | null = null;
  let cutPseudoCount = 0;
  const runtimeGenerations = new Set<number>();
  for (const cut of cuts) {
    const value = cut.value;
    runtimeGenerations.add(value.runtimeGeneration);
    cutPseudoCount += value.pseudoProposalExcludedCount;
    if (
      !Number.isSafeInteger(cutPseudoCount)
      || value.complete !== true
      || value.observerDropCount !== 0
      || value.observerFailureCount !== 0
      || value.cutAtMs
        !== policy.outcomeOpensAtMs
          + value.cutOffset * VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
      || value.cutAtMs < policy.outcomeOpensAtMs
      || value.cutAtMs >= policy.evidenceClosesAtMs
      || value.acceptedProposals.some(
        (proposal) => proposal.symbol !== policy.symbol,
      )
      || value.evaluationUniverseCount < value.acceptedProposals.length
    ) reasons.add('SEGMENT_COVERAGE_INVALID');
    universeDigest = value.evaluationUniverseDigest;
    universeCount = value.evaluationUniverseCount;
    if (priorCut !== null && (
      value.cutOffset !== priorCut.value.cutOffset + 1
      || value.cutAtMs
        !== priorCut.value.cutAtMs
          + VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
      || value.detectorTickRevision
        !== priorCut.value.detectorTickRevision + 1
      || value.previousCutDigest !== priorCut.value.cutDigest
    )) reasons.add('SEGMENT_COVERAGE_INVALID');
    priorCut = cut;
  }
  const proposalFacts = sealProposalFactsFromCoverage(cuts);
  if (proposalFacts === null) reasons.add('SEGMENT_COVERAGE_INVALID');
  const acceptedProposals = proposalFacts ?? Object.freeze([]);
  const maximumCutGapMs = maximumVerifiedDetectorCutGapMs(cuts);
  if (maximumCutGapMs === null) {
    reasons.add('SEGMENT_COVERAGE_INVALID');
  }
  const acceptedIds = new Set(
    acceptedProposals.map((proposal) => proposal.proposalId),
  );
  if (
    acceptedIds.size !== lifecycles.size
    || [...lifecycles.keys()].some((proposalId) => !acceptedIds.has(proposalId))
  ) reasons.add('SEGMENT_COVERAGE_INVALID');
  const lifecycleFacts = lifecycleRecords
    .map((record) => {
      const sourceBinding = record.binding ?? record.rejectionBinding;
      if (
        sourceBinding === null
        || (
          record.state === 'EXACT'
          && (
            record.binding === null
            || record.rejectionBinding !== null
          )
        )
        || (
          record.state === 'BLOCKED'
          && record.rejectionBinding === null
        )
      ) return null;
      const mutable = lifecycles.get(sourceBinding.proposalId);
      if (mutable === undefined) return null;
      return Object.freeze({
        proposalId: sourceBinding.proposalId,
        proposalRevision: sourceBinding.proposalRevision,
        proposalDigest: sourceBinding.proposalDigest,
        symbol: sourceBinding.symbol,
        state: record.state === 'EXACT'
          ? 'TERMINAL' as const
          : 'BLOCKED' as const,
      });
    });
  if (lifecycleFacts.some((fact) => fact === null)) {
    reasons.add('SEGMENT_NOT_QUIESCENT');
  }
  const exactLifecycleFacts = (
    lifecycleFacts.filter((fact) => fact !== null)
  ) as VolumeForwardMeasurementTerminalSegmentLifecycleFact[];
  exactLifecycleFacts.sort((left, right) => compareText(
    segmentProposalSortKey(left),
    segmentProposalSortKey(right),
  ));
  const proposalKeys = exactLifecycleFacts.map((fact) => ({
    proposalId: fact.proposalId,
    proposalRevision: fact.proposalRevision,
    proposalDigest: fact.proposalDigest,
    symbol: fact.symbol,
  }));
  const stateCounts = lifecycleStateCounts(assertions);
  const continuityGapCount = generationFacts.filter(
    (fact) => fact.gapDetected,
  ).length;
  const unresolvedContinuityGapCount = generationFacts.filter(
    (fact) => !fact.continuityExact,
  ).length;
  const expectedCutCount = seal === null
    ? 0
    : (
        seal.coverageEndExclusiveMs - seal.coverageStartMs
      ) / VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS;
  if (
    pseudoProposalRecordCount !== 0
    || continuityGapCount !== 0
    || unresolvedContinuityGapCount !== 0
    || lifecycleRecords.some((record) => (
      record.state !== 'EXACT' && record.state !== 'BLOCKED'
    ))
  ) reasons.add('SEGMENT_NOT_QUIESCENT');
  if (
    seal !== null
    && sealRecord !== undefined
    && (
      seal.corePolicyDigest !== expectedPolicyDigest
      || seal.packetMeasurementPolicySha256
        !== FROZEN_PACKET_POLICY_SHA256
      || seal.coverageStartMs !== firstCut?.cutAtMs
      || seal.coverageEndExclusiveMs
        !== (lastCut?.cutAtMs ?? 0)
          + VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
      || !Number.isSafeInteger(expectedCutCount)
      || expectedCutCount <= 0
      || expectedCutCount !== cuts.length
      || seal.pseudoProposalExcludedCount !== cutPseudoCount
      || !canonicalEqual(
        seal.acceptedProposals,
        sealProposalFactsWithoutCut(acceptedProposals),
      )
      || seal.recordBounds.firstHash !== records[0]?.recordHash
      || seal.recordBounds.sealedTailHash
        !== sealRecord.header.sealedTailHash
      || seal.recordBounds.firstSequence !== 0
      || seal.recordBounds.lastSequence !== sealRecord.header.sequence - 1
      || seal.recordBounds.recordCount !== records.length - 1
      || seal.recordBounds.byteCount
        !== canonicalEvidenceBytesBeforeSeal(records)
      || seal.generationSummary.count !== generationFacts.length
      || seal.generationSummary.continuityGapCount
        !== continuityGapCount
      || seal.generationSummary.unresolvedCount
        !== unresolvedContinuityGapCount
      || seal.detectorCoverage.coverageChainKey !== seal.chainKey
      || (
        seal.segmentIndex === 0
          ? firstCut?.cutOffset !== 0
          : firstCut?.cutOffset === 0
      )
      || seal.detectorCoverage.firstCutOffset !== firstCut?.cutOffset
      || seal.detectorCoverage.lastCutOffset !== lastCut?.cutOffset
      || seal.detectorCoverage.cutCount !== cuts.length
      || seal.detectorCoverage.expectedCutCount !== expectedCutCount
      || seal.detectorCoverage.missingCutCount !== 0
      || seal.detectorCoverage.maxGapMs !== maximumCutGapMs
      || seal.detectorCoverage.uncoveredMs !== 0
      || seal.detectorCoverage.firstCutDigest !== firstCut?.cutDigest
      || seal.detectorCoverage.lastCutDigest !== lastCut?.cutDigest
      || seal.detectorCoverage.complete !== true
      || seal.lifecycleSummary.assertionCount !== assertions.length
      || seal.lifecycleSummary.openCount !== 0
      || !canonicalEqual(seal.lifecycleSummary.proposalKeys, proposalKeys)
      || !canonicalEqual(seal.lifecycleSummary.stateCounts, stateCounts)
    )
  ) reasons.add('SEGMENT_DESCRIPTOR_INVALID');
  if (
    cuts.some((cut) => (
      cut.value.captureId !== seal?.captureId
      || cut.value.activationId !== seal?.activationId
      || cut.value.segmentId !== seal?.segmentId
      || cut.value.chainKey !== seal?.chainKey
      || cut.value.detectorInputSourceId !== seal?.detectorInputSourceId
      || cut.value.detectorInputSourceDigest
        !== seal?.detectorInputSourceDigest
    ))
  ) reasons.add('SEGMENT_COVERAGE_INVALID');
  const facts: VolumeForwardMeasurementTerminalSegmentFacts | null =
    seal === null
      || sealRecord === undefined
      || firstCut === undefined
      || lastCut === undefined
      ? null
      : {
          schemaVersion: 've2.evidence-segment-descriptor.v1',
          profile: VOLUME_FORWARD_MEASUREMENT_TERMINAL_SEGMENT_PROFILE,
          purpose: VOLUME_FORWARD_MEASUREMENT_SEGMENT_PURPOSE,
          activationId: seal.activationId,
          captureId: seal.captureId,
          segmentId: seal.segmentId,
          coverageRole: 'SYMBOL_LIFECYCLE',
          chainKey: seal.chainKey,
          symbol: policy.symbol,
          segmentIndex: seal.segmentIndex,
          previousTerminalHash: seal.previousTerminalHash,
          corePolicyDigest: expectedPolicyDigest,
          packetMeasurementPolicySha256: FROZEN_PACKET_POLICY_SHA256,
          terminalHash: expectedTerminalHash,
          evidenceBytesSha256: canonicalEvidenceBytesSha256(records),
          detectorInputSourceId: seal.detectorInputSourceId,
          detectorInputSourceDigest: seal.detectorInputSourceDigest,
          coverageStartMs: seal.coverageStartMs,
          coverageEndExclusiveMs: seal.coverageEndExclusiveMs,
          firstRecordHash: records[0]?.recordHash ?? '',
          lastRecordHash: expectedTerminalHash,
          firstLocalReceivedAtMs:
            records[0]?.header.localReceivedAtMs ?? 0,
          lastLocalReceivedAtMs: sealRecord.header.localReceivedAtMs,
          firstLocalMonotonicNs:
            records[0]?.header.localMonotonicNs ?? '0',
          lastLocalMonotonicNs: sealRecord.header.localMonotonicNs,
          recordCount: records.length,
          canonicalJsonlBytes,
          cumulativeRawPayloadBytes,
          generationCount: generationFacts.length,
          allGenerationsClosed: true,
          continuityGapCount,
          unresolvedContinuityGapCount: 0,
          detectorCutFirstIndex: firstCut.cutOffset,
          detectorCutCount: cuts.length,
          detectorExpectedCutCount: expectedCutCount,
          detectorCadenceMs:
            VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS,
          missingDetectorCutCount: 0,
          detectorMissingCutRanges: Object.freeze([]),
          maximumDetectorCutGapMs: maximumCutGapMs ?? 0,
          sourceUncoveredDurationMs: 0,
          detectorBatchPreviousDigest: firstCut.previousCutDigest,
          detectorBatchTerminalDigest: lastCut.cutDigest,
          detectorEvaluationUniverseDigest: universeDigest,
          detectorEvaluationUniverseCount: universeCount ?? 0,
          detectorCoverageComplete: true,
          acceptedProposals,
          acceptedProposalIds: Object.freeze(
            acceptedProposals.map((proposal) => proposal.proposalId),
          ),
          pseudoProposalExcludedCount: cutPseudoCount,
          lifecycleProposals: Object.freeze(exactLifecycleFacts),
          lifecycleProposalIds: Object.freeze(
            exactLifecycleFacts.map((fact) => fact.proposalId),
          ),
          lifecycleCount: exactLifecycleFacts.length,
          terminalLifecycleCount: exactLifecycleFacts.filter(
            (fact) => fact.state === 'TERMINAL',
          ).length,
          blockedLifecycleCount: exactLifecycleFacts.filter(
            (fact) => fact.state === 'BLOCKED',
          ).length,
          openLifecycleCount: 0,
          nonTruncated: true,
          quiescent: true,
          profitabilityClaim: false,
          consumerGate: VOLUME_FORWARD_MEASUREMENT_CONSUMER_GATE,
        };
  return Object.freeze({
    facts,
    reasons: orderedReasons(reasons),
  });
}

function sourceContinuityExactAtClose(
  source: MutableSourceState,
): boolean {
  return source.depth !== null
    && source.depth.status === 'SYNCHRONIZED'
    && source.depth.continuity === 'CONTIGUOUS'
    && synchronizedRanges(source) !== null
    && source.continuityObserved === true
    && source.continuityExact === true
    && source.continuityRecord !== null;
}

function applyContinuityEvidence(
  source: MutableSourceState,
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
): boolean {
  const value = dataRecord(rawJson(record));
  const previous = value?.previousFinalUpdateId;
  const first = value?.firstUpdateId;
  const final = value?.finalUpdateId;
  const ranges = source.depth?.updateRanges ?? [];
  const unclaimedRanges = ranges.slice(source.lastContinuityRangeCount);
  const priorFinalUpdateId = source.lastContinuityRangeCount > 0
    ? ranges[source.lastContinuityRangeCount - 1]?.finalUpdateId ?? null
    : source.depth?.snapshotLastUpdateId ?? null;
  const expectedFrameHashes: string[] = [];
  let nextExpected = priorFinalUpdateId === null
    ? null
    : priorFinalUpdateId + 1;
  let rangesExact = nextExpected !== null && unclaimedRanges.length > 0;
  for (const range of unclaimedRanges) {
    if (
      nextExpected === null
      || range.firstUpdateId > nextExpected
      || range.finalUpdateId < nextExpected
    ) {
      rangesExact = false;
      break;
    }
    const depthRecord = source.depthDiffRecordByRange.get(
      depthDiffRangeKey(
        range.firstUpdateId,
        range.finalUpdateId,
        range.receivedMonotonicNs,
      ),
    );
    const frame = depthRecord === undefined
      ? undefined
      : source.streamFrameByTypedRecordHash.get(depthRecord.recordHash);
    if (
      depthRecord === undefined
      || frame === undefined
      || frame.header.rawSha256 !== depthRecord.header.rawSha256
    ) {
      rangesExact = false;
      break;
    }
    expectedFrameHashes.push(frame.header.rawSha256.slice(7));
    nextExpected = range.finalUpdateId + 1;
  }
  const exact = value !== null
    && exactDataKeys(value, [
      'combinedFrames',
      'finalUpdateId',
      'firstUpdateId',
      'generation',
      'previousFinalUpdateId',
      'silentGapFill',
      'state',
    ])
    && value.state === 'CONTIGUOUS'
    && value.generation === source.generation
    && value.generation === record.header.generation
    && value.silentGapFill === false
    && Number.isSafeInteger(previous)
    && Number.isSafeInteger(first)
    && Number.isSafeInteger(final)
    && (previous as number) >= 0
    && (first as number) >= 0
    && (final as number) >= 0
    && rangesExact
    && unclaimedRanges[0]?.firstUpdateId === first
    && unclaimedRanges.at(-1)?.finalUpdateId === final
    && priorFinalUpdateId === previous
    && Array.isArray(value.combinedFrames)
    && value.combinedFrames.length <= 256
    && value.combinedFrames.every((hash) => (
      typeof hash === 'string' && RAW_SHA256.test(hash)
    ))
    && canonicalEqual(value.combinedFrames, expectedFrameHashes)
    && source.depth?.status === 'SYNCHRONIZED'
    && source.depth.continuity === 'CONTIGUOUS'
    && source.depth.lastUpdateId === final;
  source.continuityObserved = true;
  source.continuityExact = exact;
  source.continuityRecord = exact ? record : null;
  if (exact) source.lastContinuityRangeCount = ranges.length;
  return exact;
}

function exactGenerationLedgerEntry(
  value: unknown,
  captured: MutableSourceState['streamLedger'][number],
): boolean {
  const claim = dataRecord(value);
  const mapping = combinedFrameMapping(captured.frame);
  const depth = captured.payload.kind === 'DEPTH_DIFF'
    ? captured.payload
    : null;
  const keys = [
    'evidenceRawSha256',
    'evidenceRecordHash',
    'frameRecordHash',
    'innerLength',
    'innerOffset',
    'innerSha256',
    'localMonotonicNs',
    'localReceivedAtMs',
    'rawSha256',
    'stream',
    ...(depth === null ? [] : ['finalUpdateId', 'firstUpdateId']),
  ];
  return claim !== null
    && mapping !== null
    && exactDataKeys(claim, keys)
    && claim.stream === captured.typed.header.sourceStream
    && claim.stream === mapping.stream
    && claim.localReceivedAtMs
      === captured.typed.header.localReceivedAtMs
    && claim.localMonotonicNs
      === captured.typed.header.localMonotonicNs
    && claim.rawSha256 === captured.frame.header.rawSha256.slice(7)
    && typeof claim.rawSha256 === 'string'
    && RAW_SHA256.test(claim.rawSha256)
    && claim.frameRecordHash === captured.frame.recordHash
    && claim.evidenceRawSha256 === captured.typed.header.rawSha256
    && claim.evidenceRecordHash === captured.typed.recordHash
    && claim.innerOffset === mapping.innerOffset
    && claim.innerLength === mapping.innerLength
    && claim.innerSha256 === mapping.innerSha256
    && (
      depth === null
        ? claim.firstUpdateId === undefined
          && claim.finalUpdateId === undefined
        : claim.firstUpdateId === depth.firstUpdateId
          && claim.finalUpdateId === depth.finalUpdateId
    );
}

function generationStreamCounts(
  source: MutableSourceState,
): Readonly<{
  depth100ms: number;
  aggTrade: number;
  trade: number;
  bookTicker: number;
}> {
  const counts = {
    depth100ms: 0,
    aggTrade: 0,
    trade: 0,
    bookTicker: 0,
  };
  for (const item of source.streamLedger) {
    if (item.payload.kind === 'DEPTH_DIFF') counts.depth100ms += 1;
    else if (item.payload.kind === 'AGG_TRADE') counts.aggTrade += 1;
    else if (item.payload.kind === 'TRADE') counts.trade += 1;
    else counts.bookTicker += 1;
  }
  return Object.freeze(counts);
}

function generationCloseIsExact(
  source: MutableSourceState,
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
): boolean {
  const value = dataRecord(rawJson(record));
  const streamCounts = value === null
    ? null
    : dataRecord(value.streamCounts);
  const ledger = value?.combinedFrameLedger;
  const expectedCounts = generationStreamCounts(source);
  const continuityExact = sourceContinuityExactAtClose(source);
  const gapDetected = source.depth?.status === 'GAPPED'
    || source.depth?.continuity === 'GAP_DETECTED';
  if (
    value === null
    || !exactDataKeys(value, [
      'closeCode',
      'captureTruncated',
      'combinedFrameLedger',
      'combinedUrl',
      'combinedUrlAcknowledged',
      'continuity',
      'depthBridgeExact',
      'depthSnapshotCaptured',
      'detectorProposalRecordHash',
      'gapDetected',
      'generation',
      'invalidFrame',
      'lifecycleAssertionsCaptured',
      'opened',
      'reason',
      'streamCounts',
      'streamFrameCount',
    ])
    || value.generation !== source.generation
    || value.generation !== record.header.generation
    || value.opened !== true
    || !Number.isSafeInteger(value.closeCode)
    || (value.closeCode as number) < 0
    || (value.closeCode as number) > 4_999
    || !validIdentifier(value.reason)
    || value.captureTruncated !== false
    || value.continuity !== (
      continuityExact ? 'CONTIGUOUS' : 'REJECTED_NO_SILENT_FILL'
    )
    || value.combinedUrlAcknowledged !== true
    || value.combinedUrl !== source.combinedUrl
    || !Array.isArray(ledger)
    || ledger.length > MAX_GENERATION_STREAM_FRAMES
    || ledger.length !== source.streamLedger.length
    || streamCounts === null
    || !exactDataKeys(streamCounts, [
      'aggTrade',
      'bookTicker',
      'depth100ms',
      'trade',
    ])
    || !canonicalEqual(streamCounts, expectedCounts)
    || value.depthSnapshotCaptured
      !== (source.snapshotLastUpdateId !== null)
    || value.depthBridgeExact !== continuityExact
    || value.gapDetected !== gapDetected
    || value.invalidFrame !== source.invalidFrame
    || value.streamFrameCount !== source.streamLedger.length
    || value.lifecycleAssertionsCaptured
      !== (source.lifecycleAssertionCount > 0)
    || value.detectorProposalRecordHash
      !== source.detectorProposalRecordHash
  ) return false;
  for (let index = 0; index < ledger.length; index += 1) {
    if (!exactGenerationLedgerEntry(
      ledger[index],
      source.streamLedger[index],
    )) return false;
  }
  return true;
}

function lifecycleAssertion(
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
): Readonly<LifecycleAssertion> | null {
  const value = dataRecord(rawJson(record));
  if (
    value === null
    || value.mode !== 'SHADOW_RECORD_ONLY'
    || !validIdentifier(value.proposalId)
    || typeof value.state !== 'string'
    || ![
      'OBSERVED',
      'ENTRY_RECORDED',
      'HOLDING',
      'TERMINAL_EXIT',
      'BLOCKED',
      'EXACT',
    ].includes(value.state)
  ) return null;
  const state = value.state as LifecycleAssertion['state'];
  const base = [
    'mode',
    'previousLifecycleRecordHash',
    'proposalDigest',
    'proposalId',
    'sourceRecordHash',
    'state',
    'transitionRevision',
  ];
  const expected = state === 'BLOCKED'
    ? [...base, 'reasonCodes']
    : base;
  if (!exactDataKeys(value, expected)) return null;
  if (
    !validIdentifier(value.proposalDigest)
    || !Number.isSafeInteger(value.transitionRevision)
    || (value.transitionRevision as number) < 1
    || typeof value.sourceRecordHash !== 'string'
    || !SHA256_ANCHOR.test(value.sourceRecordHash)
    || (
      value.previousLifecycleRecordHash !== null
      && (
        typeof value.previousLifecycleRecordHash !== 'string'
        || !SHA256_ANCHOR.test(value.previousLifecycleRecordHash)
      )
    )
  ) return null;
  let reasonCodes:
    readonly VolumeForwardMeasurementReplayReason[] | null = null;
  if (state === 'BLOCKED') {
    if (
      !Array.isArray(value.reasonCodes)
      || value.reasonCodes.length === 0
      || value.reasonCodes.some((reason) => (
        typeof reason !== 'string'
        || !(
          VOLUME_FORWARD_MEASUREMENT_REPLAY_REASONS as readonly string[]
        ).includes(reason)
      ))
    ) return null;
    reasonCodes = orderedReasons(
      value.reasonCodes as VolumeForwardMeasurementReplayReason[],
    );
    if (reasonCodes.length !== value.reasonCodes.length) return null;
  }
  return Object.freeze({
    proposalId: value.proposalId,
    state,
    sequence: record.header.sequence,
    recordHash: record.recordHash,
    proposalDigest: value.proposalDigest,
    transitionRevision: value.transitionRevision as number,
    previousLifecycleRecordHash:
      value.previousLifecycleRecordHash as string | null,
    sourceRecordHash: value.sourceRecordHash,
    reasonCodes,
  });
}

function lifecycleAssertionsMatch(
  lifecycle: MutableLifecycle,
  assertions: readonly Readonly<LifecycleAssertion>[],
): boolean {
  if (
    assertions.length === 0
    || assertions[0]?.state !== 'OBSERVED'
    || (assertions[0]?.sequence ?? -1)
      <= lifecycle.proposal.record.header.sequence
    || assertions.some((assertion, index) => (
      assertion.proposalId !== lifecycle.proposal.proposalId
      || (
        index > 0
        && assertion.sequence <= (assertions[index - 1]?.sequence ?? -1)
      )
    ))
  ) return false;
  const expectedStates: LifecycleAssertion['state'][] = ['OBSERVED'];
  if (lifecycle.entryEvaluation !== null) {
    expectedStates.push('ENTRY_RECORDED', 'HOLDING');
  }
  if (lifecycle.state === 'TERMINAL') {
    expectedStates.push('TERMINAL_EXIT');
  } else if (lifecycle.state === 'BLOCKED') {
    expectedStates.push('BLOCKED');
  }
  if (
    assertions.length !== expectedStates.length
    || assertions.some((assertion, index) => (
      assertion.state !== expectedStates[index]
      && !(
        expectedStates[index] === 'TERMINAL_EXIT'
        && assertion.state === 'EXACT'
      )
    ))
  ) return false;
  for (let index = 0; index < assertions.length; index += 1) {
    const assertion = assertions[index];
    const prior = index === 0 ? null : assertions[index - 1];
    if (
      assertion.proposalDigest !== lifecycle.proposal.proposalDigest
      || assertion.transitionRevision !== index + 1
      || assertion.previousLifecycleRecordHash
        !== (prior?.recordHash ?? null)
    ) return false;
    let expectedSourceHash: string | null = null;
    let expectedSourceSequence: number | null = null;
    if (assertion.state === 'OBSERVED') {
      expectedSourceHash = lifecycle.proposal.recordHash;
      expectedSourceSequence = lifecycle.proposal.record.header.sequence;
    } else if (
      assertion.state === 'ENTRY_RECORDED'
      || assertion.state === 'HOLDING'
    ) {
      expectedSourceHash = lifecycle.entrySourceRecordHash;
      expectedSourceSequence = lifecycle.entryRecordSequence;
    } else if (
      assertion.state === 'TERMINAL_EXIT'
      || assertion.state === 'EXACT'
    ) {
      expectedSourceHash = lifecycle.terminalSourceRecordHash;
      expectedSourceSequence = lifecycle.terminalRecordSequence;
    } else {
      expectedSourceHash = lifecycle.blockedSourceRecordHash;
      expectedSourceSequence = lifecycle.blockedSourceSequence;
      const reasons = orderedReasons(lifecycle.reasons);
      if (
        assertion.reasonCodes === null
        || canonicalJson(assertion.reasonCodes) !== canonicalJson(reasons)
      ) return false;
    }
    if (
      expectedSourceHash === null
      || expectedSourceSequence === null
      || assertion.sourceRecordHash !== expectedSourceHash
      || assertion.sequence <= expectedSourceSequence
    ) return false;
  }
  return true;
}

/**
 * Replays a complete sealed evidence chain without reading time, environment,
 * network, filesystem, keys, private data, or durable state.
 */
export function replayVolumeForwardMeasurementEvidence(
  input: unknown,
): Readonly<VolumeForwardMeasurementReplayResult> {
  if (!authorityIsExact()) return blockedReplay('REPLAY_AUTHORITY_INVALID');
  const root = dataRecord(input);
  if (
    root === null
    || Object.keys(root).sort().join('|')
      !== 'evidenceRecords|expectedPolicyDigest|expectedTerminalHash'
    || !Array.isArray(root.evidenceRecords)
    || typeof root.expectedPolicyDigest !== 'string'
    || !SHA256_ANCHOR.test(root.expectedPolicyDigest)
    || typeof root.expectedTerminalHash !== 'string'
    || !SHA256_ANCHOR.test(root.expectedTerminalHash)
  ) return blockedReplay('REPLAY_INPUT_INVALID');

  const verified = verifyVolumeForwardMeasurementEvidenceChain(
    root.evidenceRecords as readonly Readonly<
      VolumeForwardMeasurementEvidenceRecord
    >[],
    {
      expectedPolicyDigest: root.expectedPolicyDigest,
      expectedTerminalHash: root.expectedTerminalHash,
      requireMeasurementBundle: false,
      requireSealed: false,
    },
  );
  if (!verified.ok) return blockedReplay('EVIDENCE_CHAIN_INVALID');
  const verification = verified.verification;
  if (
    verification.sourceAuthenticity !== 'TRUSTED_ANCHOR_MATCHED'
    || verification.trustedAnchors.expectedPolicyDigest
      !== root.expectedPolicyDigest
    || verification.trustedAnchors.expectedTerminalHash
      !== root.expectedTerminalHash
    || verification.trustedAnchors.policyDigestMatched !== true
    || verification.trustedAnchors.terminalHashMatched !== true
  ) return blockedReplay('EVIDENCE_CHAIN_INVALID');
  const records = verification.records;
  const first = records[0];
  const policyValue = rawJson(first);
  const measurementPolicy = validateVolumeForwardMeasurementPolicy(policyValue)
    ? policyValue
    : null;
  const detectorCoveragePolicy =
    validateVolumeForwardDetectorCoveragePolicy(policyValue)
      ? policyValue
      : null;
  if (measurementPolicy === null && detectorCoveragePolicy === null) {
    return blockedReplay('POLICY_INVALID');
  }
  const replayPolicy = (
    measurementPolicy ?? detectorCoveragePolicy
  ) as ReplayPolicy;
  if (
    first.header.rawSha256 !== verification.policyDigest
    || first.header.localReceivedAtMs < replayPolicy.frozenAtMs
    || (
      detectorCoveragePolicy !== null
      && first.header.localReceivedAtMs >= replayPolicy.outcomeOpensAtMs
    )
  ) return blockedReplay('POLICY_DIGEST_MISMATCH');
  if (detectorCoveragePolicy !== null) {
    return replayDetectorCoverageSegment(
      records,
      detectorCoveragePolicy,
      root.expectedPolicyDigest,
      root.expectedTerminalHash,
      verification.canonicalJsonlBytes,
      verification.cumulativeRawPayloadBytes,
    );
  }
  const policy = measurementPolicy as Readonly<
    VolumeForwardMeasurementPolicy
  >;

  const globalReasons = new Set<VolumeForwardMeasurementReplayReason>();
  const lifecycles = new Map<string, MutableLifecycle>();
  const assertions: Array<Readonly<LifecycleAssertion>> = [];
  const coverageCuts: ParsedDetectorCoverageCut[] = [];
  const acceptedProposalIdsFromCuts = new Set<string>();
  const generationFacts: GenerationFact[] = [];
  const exitQueue: MutableLifecycle[] = [];
  let nextExitIndex = 0;
  let operationUnits = 0;
  let pseudoProposalExcludedCount = 0;
  let terminalSegmentRequested = false;
  let smokePurposeSeen = false;
  let pendingStreamFrame:
    Readonly<VolumeForwardMeasurementEvidenceRecord> | null = null;
  const lastCutByGeneration = new Map<
    number,
    Readonly<VolumeForwardMeasurementEvidenceRecord>
  >();
  let source: MutableSourceState | null = null;
  let config: ConfigCut | null = null;
  let kill: KillCut | null = null;

  for (const record of records.slice(1)) {
    const { header } = record;
    let matchedStreamFrame:
      Readonly<VolumeForwardMeasurementEvidenceRecord> | null = null;
    if (header.kind === 'STREAM_FRAME') {
      if (pendingStreamFrame !== null) {
        globalReasons.add('SOURCE_PAYLOAD_INVALID');
        if (source?.generation === header.generation) {
          source.invalidFrame = true;
        }
      }
      pendingStreamFrame = record;
      continue;
    }
    if (pendingStreamFrame !== null) {
      const frame = pendingStreamFrame;
      pendingStreamFrame = null;
      if (
        !typedStreamRecordKind(header.kind)
        || !streamFrameMatchesTypedRecord(frame, record)
      ) {
        globalReasons.add('SOURCE_PAYLOAD_INVALID');
        if (source?.generation === frame.header.generation) {
          source.invalidFrame = true;
        }
        if (typedStreamRecordKind(header.kind)) continue;
      } else {
        matchedStreamFrame = frame;
      }
    } else if (typedStreamRecordKind(header.kind)) {
      globalReasons.add('SOURCE_PAYLOAD_INVALID');
      if (source?.generation === header.generation) source.invalidFrame = true;
      continue;
    }
    if (
      publicRecordKind(header.kind)
      || header.kind === 'CONTINUITY'
      || header.kind === 'DETECTOR_COVERAGE'
      || header.kind === 'DETECTOR_PROPOSAL'
    ) lastCutByGeneration.set(header.generation, record);
    if (header.kind === 'GENERATION_OPEN') {
      for (const lifecycle of lifecycles.values()) {
        if (
          lifecycle.proposal.generation < header.generation
          && (
            lifecycle.state === 'ACTIVE'
            || lifecycle.state === 'PENDING_ENTRY'
          )
        ) {
          blockLifecycle(lifecycle, 'SOURCE_GENERATION_CHANGED');
          bindBlockedSource(lifecycle, record, source, config, kill);
        }
      }
      const open = parseGenerationOpen(record, policy);
      config = null;
      kill = null;
      if (open === null) {
        globalReasons.add('SOURCE_PAYLOAD_INVALID');
        source = null;
      } else {
        source = newSourceState(
          policy.symbol,
          header.generation,
          open.combinedUrl,
          record,
        );
      }
      continue;
    }
    if (header.kind === 'GENERATION_CLOSE') {
      const closeValue = dataRecord(rawJson(record));
      const closeContinuityExact = source !== null
        && source.generation === header.generation
        && sourceContinuityExactAtClose(source);
      generationFacts.push(Object.freeze({
        generation: header.generation,
        gapDetected: closeValue?.gapDetected === true,
        continuityExact: closeContinuityExact,
      }));
      if (
        source === null
        || source.generation !== header.generation
        || !generationCloseIsExact(source, record)
      ) {
        globalReasons.add('SOURCE_PAYLOAD_INVALID');
      }
      if (
        source === null
        || source.generation !== header.generation
        || !closeContinuityExact
      ) globalReasons.add('SOURCE_CONTINUITY_NOT_EXACT');
      if (
        source !== null
        && (
          config === null
          || config.record.header.generation !== source.generation
          || config.combinedUrl !== source.combinedUrl
        )
      ) globalReasons.add('CONFIG_STATE_MISMATCH');
      if (
        source !== null
        && (
          kill === null
          || kill.record.header.generation !== source.generation
        )
      ) globalReasons.add('KILL_STATE_NOT_ENGAGED');
      source = null;
      config = null;
      kill = null;
      continue;
    }
    if (header.kind === 'TERMINAL_SEAL') continue;

    if (header.kind === 'CONFIG_STATE') {
      const parsed = parseConfigCut(record, policy);
      if (
        parsed === null
        || source === null
        || record.header.generation !== source.generation
        || parsed.combinedUrl !== source.combinedUrl
      ) {
        globalReasons.add('CONFIG_STATE_MISMATCH');
        config = null;
      } else {
        config = parsed;
        if (parsed.purpose === VOLUME_FORWARD_MEASUREMENT_SEGMENT_PURPOSE) {
          terminalSegmentRequested = true;
          if (smokePurposeSeen) globalReasons.add('CONFIG_STATE_MISMATCH');
        } else {
          smokePurposeSeen = true;
          if (terminalSegmentRequested) {
            globalReasons.add('CONFIG_STATE_MISMATCH');
          }
        }
      }
    } else if (header.kind === 'KILL_STATE') {
      const parsed = parseKillCut(record);
      if (
        parsed === null
        || source === null
        || record.header.generation !== source.generation
      ) {
        globalReasons.add('KILL_STATE_NOT_ENGAGED');
        kill = null;
      } else kill = parsed;
    } else if (header.kind === 'EXCHANGE_INFO') {
      if (
        source === null
        || header.sourceSymbol !== policy.symbol
        || header.sourceStream !== '/api/v3/exchangeInfo'
      ) {
        globalReasons.add('SOURCE_SYMBOL_MISMATCH');
      } else {
        const parsed = parseFilterCut(record);
        if (parsed === null) globalReasons.add('EXCHANGE_FILTERS_INVALID');
        else source.filter = parsed;
      }
    } else if (publicRecordKind(header.kind)) {
      if (
        source === null
        || header.generation !== source.generation
        || header.sourceSymbol !== policy.symbol
      ) {
        globalReasons.add('SOURCE_GENERATION_CHANGED');
      } else {
        const parsed = parsePublicRecord(record, policy);
        if (parsed === null) {
          globalReasons.add('SOURCE_PAYLOAD_INVALID');
        } else {
          updatePublicState(source, record, parsed, matchedStreamFrame);
        }
      }
    } else if (header.kind === 'CONTINUITY') {
      if (
        source === null
        || header.generation !== source.generation
        || !applyContinuityEvidence(source, record)
      ) globalReasons.add('SOURCE_CONTINUITY_NOT_EXACT');
    } else if (header.kind === 'DETECTOR_COVERAGE') {
      const cut = parseDetectorCoverageCut(record);
      if (
        cut === null
        || !terminalSegmentRequested
        || source === null
        || config === null
        || kill === null
        || header.generation !== source.generation
      ) {
        globalReasons.add('SEGMENT_COVERAGE_INVALID');
      } else {
        coverageCuts.push(cut);
        const value = cut.value;
        operationUnits += 1 + value.acceptedProposals.length;
        if (
          operationUnits > MAX_REPLAY_OPERATION_UNITS
          || value.runtimeGeneration !== source.generation
          || value.configurationRevision
            !== config.configurationRevision
          || value.configurationDigest !== config.configurationDigest
          || value.cutAtMs < policy.outcomeOpensAtMs
          || value.cutAtMs >= policy.evidenceClosesAtMs
          || value.localReceivedAtMs < value.cutAtMs
          || value.complete !== true
          || value.observerDropCount !== 0
          || value.observerFailureCount !== 0
        ) globalReasons.add(
          operationUnits > MAX_REPLAY_OPERATION_UNITS
            ? 'REPLAY_OPERATION_LIMIT_EXCEEDED'
            : 'SEGMENT_COVERAGE_INVALID',
        );

        const cutMonotonic = BigInt(header.localMonotonicNs);
        while (nextExitIndex < exitQueue.length) {
          const lifecycle = exitQueue[nextExitIndex];
          if (
            lifecycle.entryMonotonicNs === null
            || cutMonotonic - lifecycle.entryMonotonicNs
              < MIN_EXIT_DELAY_NS
          ) break;
          nextExitIndex += 1;
          if (lifecycle.state !== 'ACTIVE') continue;
          attemptExit(lifecycle, source, config, kill, record);
          if (lifecycle.state === 'ACTIVE') {
            if (lifecycle.reasons.length > 0) {
              blockLifecycle(lifecycle, ...lifecycle.reasons);
            } else {
              blockLifecycle(lifecycle, 'OUTCOME_CUT_MISSING');
            }
          }
          bindBlockedSource(lifecycle, record, source, config, kill);
        }

        for (const accepted of value.acceptedProposals) {
          const lifecycle = lifecycles.get(accepted.proposalId);
          if (
            lifecycle === undefined
            || acceptedProposalIdsFromCuts.has(accepted.proposalId)
            || lifecycle.state !== 'PENDING_ENTRY'
            || lifecycle.proposal.proposalRevision
              !== accepted.proposalRevision
            || lifecycle.proposal.proposalDigest
              !== accepted.proposalDigest
            || lifecycle.proposal.symbol !== accepted.symbol
            || lifecycle.proposal.detectorDecisionDigest
              !== accepted.detectorDecisionDigest
            || lifecycle.proposal.featureDigest !== accepted.featureDigest
            || lifecycle.proposal.updatedTs !== value.cutAtMs
            || lifecycle.proposal.record.header.sequence
              >= record.header.sequence
            || accepted.symbol !== policy.symbol
          ) {
            globalReasons.add('SEGMENT_COVERAGE_INVALID');
            continue;
          }
          acceptedProposalIdsFromCuts.add(accepted.proposalId);
          attemptEntry(
            lifecycle,
            source,
            config,
            kill,
            record,
            verification.policyDigest,
          );
          const enteredState = (lifecycle as MutableLifecycle).state;
          if (enteredState === 'ACTIVE') {
            exitQueue.push(lifecycle);
          } else {
            if (enteredState === 'PENDING_ENTRY') {
              const entryReasons:
                readonly VolumeForwardMeasurementReplayReason[] =
                lifecycle.reasons.length > 0
                  ? lifecycle.reasons
                  : ['OBSERVATION_REJECTED'];
              blockLifecycle(
                lifecycle,
                ...entryReasons,
              );
            }
            bindBlockedSource(lifecycle, record, source, config, kill);
          }
        }
      }
    } else if (header.kind === 'DETECTOR_PROPOSAL') {
      if (source?.generation === header.generation) {
        source.detectorProposalRecordHash = record.recordHash;
      }
      const controls = source === null
        ? null
        : pointInTimeControls(source, config, kill);
      const parsed = controls === null
        ? terminalSegmentRequested
          ? parseProposalCutStructurally(record)
          : 'DETECTOR_PROPOSAL_INVALID' as const
        : parseProposalCut(record, controls);
      if (typeof parsed === 'string') {
        if (parsed === 'DETECTOR_PSEUDO_PROPOSAL_EXCLUDED') {
          pseudoProposalExcludedCount += 1;
        } else {
          globalReasons.add(parsed);
        }
      } else if (
        source === null
        || parsed.symbol !== policy.symbol
        || parsed.generation !== source.generation
      ) {
        globalReasons.add('SOURCE_SYMBOL_MISMATCH');
      } else if (lifecycles.has(parsed.proposalId)) {
        globalReasons.add('DETECTOR_PROPOSAL_DUPLICATED');
      } else if (
        operationUnits + proposalOperationCost(source)
        > MAX_REPLAY_OPERATION_UNITS
      ) {
        globalReasons.add('REPLAY_OPERATION_LIMIT_EXCEEDED');
      } else {
        operationUnits += proposalOperationCost(source);
        const lifecycle: MutableLifecycle = {
          proposal: parsed,
          state: 'PENDING_ENTRY',
          reasons: [],
          binding: null,
          rejectionBinding: null,
          entryObservation: null,
          entryEvaluation: null,
          exitPolicy: null,
          priorSample: null,
          exitDecision: null,
          terminalSampleId: null,
          validatorExpiresAtMs: policy.evidenceClosesAtMs,
          entryMonotonicNs: null,
          lastEvaluationMonotonicNs: null,
          initialExitDecisionId: null,
          initialSampleId: null,
          entryRecordSequence: null,
          terminalRecordSequence: null,
          entrySourceRecordHash: null,
          terminalSourceRecordHash: null,
          blockedSourceRecordHash: null,
          blockedSourceSequence: null,
          entryModeledFill: null,
          terminalExitQuoteNotional: null,
        };
        lifecycles.set(parsed.proposalId, lifecycle);
        if (
          !terminalSegmentRequested
          &&
          source !== null
          && header.localReceivedAtMs >= policy.outcomeOpensAtMs
          && header.localReceivedAtMs < policy.outcomeClosesAtMs
        ) {
          attemptEntry(
            lifecycle,
            source,
            config,
            kill,
            record,
            verification.policyDigest,
          );
          if (lifecycle.state === 'ACTIVE') {
            exitQueue.push(lifecycle);
          } else if (lifecycle.state === 'PENDING_ENTRY') {
            if (lifecycle.reasons.length > 0) {
              blockLifecycle(lifecycle, ...lifecycle.reasons);
            } else {
              blockLifecycle(lifecycle, 'OBSERVATION_REJECTED');
            }
            bindBlockedSource(lifecycle, record, source, config, kill);
          } else if (lifecycle.state === 'BLOCKED') {
            bindBlockedSource(lifecycle, record, source, config, kill);
          }
        }
      }
    } else if (header.kind === 'LIFECYCLE_RECORD') {
      if (source?.generation === header.generation) {
        source.lifecycleAssertionCount += 1;
      }
      const assertion = lifecycleAssertion(record);
      if (assertion === null) {
        globalReasons.add('RECORDED_LIFECYCLE_INVALID');
      } else {
        assertions.push(assertion);
      }
    } else if (header.kind !== 'POLICY') {
      globalReasons.add('SOURCE_PAYLOAD_INVALID');
    }

    if (
      header.kind === 'CONTINUITY'
      && !terminalSegmentRequested
      && source !== null
      && source.continuityExact
      && source.continuityObserved
      && header.localReceivedAtMs >= policy.outcomeOpensAtMs
      && header.localReceivedAtMs < policy.evidenceClosesAtMs
    ) {
      const cutMonotonic = BigInt(header.localMonotonicNs);
      while (nextExitIndex < exitQueue.length) {
        const lifecycle = exitQueue[nextExitIndex];
        if (
          lifecycle.entryMonotonicNs === null
          || cutMonotonic - lifecycle.entryMonotonicNs < MIN_EXIT_DELAY_NS
        ) break;
        nextExitIndex += 1;
        if (lifecycle.state !== 'ACTIVE') continue;
        attemptExit(lifecycle, source, config, kill, record);
        if (lifecycle.state === 'ACTIVE') {
          if (lifecycle.reasons.length > 0) {
            blockLifecycle(lifecycle, ...lifecycle.reasons);
          } else {
            blockLifecycle(lifecycle, 'OUTCOME_CUT_MISSING');
          }
        }
        bindBlockedSource(lifecycle, record, source, config, kill);
      }
    }
  }

  if (pendingStreamFrame !== null) {
    globalReasons.add('SOURCE_PAYLOAD_INVALID');
  }
  if (!terminalSegmentRequested && pseudoProposalExcludedCount > 0) {
    globalReasons.add('DETECTOR_PSEUDO_PROPOSAL_EXCLUDED');
  }
  if (
    !terminalSegmentRequested
    && first.header.localReceivedAtMs >= policy.outcomeOpensAtMs
  ) globalReasons.add('POLICY_DIGEST_MISMATCH');
  if (
    terminalSegmentRequested
    && (
      coverageCuts.length === 0
      || [...lifecycles.keys()].some(
        (proposalId) => !acceptedProposalIdsFromCuts.has(proposalId),
      )
      || acceptedProposalIdsFromCuts.size !== lifecycles.size
    )
  ) globalReasons.add('SEGMENT_COVERAGE_INVALID');
  if (!terminalSegmentRequested && lifecycles.size === 0) {
    globalReasons.add('NO_DETECTOR_PROPOSAL');
  }
  for (const lifecycle of lifecycles.values()) {
    if (
      lifecycle.state !== 'ACTIVE'
      && lifecycle.state !== 'PENDING_ENTRY'
    ) continue;
    const causative = lastCutByGeneration.get(
      lifecycle.proposal.generation,
    ) ?? lifecycle.proposal.record;
    blockLifecycle(lifecycle, 'OUTCOME_CUT_MISSING');
    bindBlockedSource(lifecycle, causative, source, config, kill);
  }
  const assertionsByProposal = new Map<
    string,
    Array<Readonly<LifecycleAssertion>>
  >();
  for (const assertion of assertions) {
    const grouped = assertionsByProposal.get(assertion.proposalId) ?? [];
    grouped.push(assertion);
    assertionsByProposal.set(assertion.proposalId, grouped);
  }
  for (const [proposalId, grouped] of assertionsByProposal) {
    if (!lifecycles.has(proposalId)) {
      globalReasons.add('RECORDED_LIFECYCLE_MISMATCH');
    }
  }
  for (const lifecycle of lifecycles.values()) {
    if (!lifecycleAssertionsMatch(
      lifecycle,
      assertionsByProposal.get(lifecycle.proposal.proposalId) ?? [],
    )) {
      globalReasons.add('RECORDED_LIFECYCLE_MISMATCH');
    }
  }

  const lifecycleRecords = [...lifecycles.values()]
    .sort((left, right) => compareText(
      left.proposal.proposalId,
      right.proposal.proposalId,
    ))
    .map(lifecycleRecord);
  for (const lifecycle of lifecycleRecords) {
    if (lifecycle.state !== 'BLOCKED') continue;
    for (const reason of lifecycle.reasonCodes) globalReasons.add(reason);
  }
  const segment = terminalSegmentRequested
    ? deriveSymbolLifecycleSegment(
        records,
        policy,
        root.expectedPolicyDigest,
        root.expectedTerminalHash,
        verification.canonicalJsonlBytes,
        verification.cumulativeRawPayloadBytes,
        coverageCuts,
        lifecycles,
        assertions,
        lifecycleRecords,
        generationFacts,
        pseudoProposalExcludedCount,
      )
    : null;
  if (segment !== null) {
    for (const reason of segment.reasons) globalReasons.add(reason);
  }
  const reasonCodes = orderedReasons(globalReasons);
  return replayResult({
    schemaVersion: VOLUME_FORWARD_MEASUREMENT_REPLAY_SCHEMA_VERSION,
    state: reasonCodes.length === 0 ? 'EXACT' : 'BLOCKED',
    reasonCodes,
    chainId: verification.chainId,
    policyDigest: policy.policyDigest,
    evidencePolicyDigest: verification.policyDigest,
    terminalHash: verification.terminalHash,
    sourceAuthenticity: 'TRUSTED_ANCHOR_MATCHED',
    trustedAnchors: Object.freeze({
      expectedPolicyDigest: root.expectedPolicyDigest,
      expectedTerminalHash: root.expectedTerminalHash,
      policyDigestMatched: true,
      terminalHashMatched: true,
    }),
    evidenceRecordCount: verification.recordCount,
    replayProfile: terminalSegmentRequested
      ? VOLUME_FORWARD_MEASUREMENT_TERMINAL_SEGMENT_PROFILE
      : 'SMOKE_MECHANICS_ONLY',
    segmentFacts: segment?.facts ?? null,
    lifecycles: Object.freeze(lifecycleRecords),
    consumerGate: VOLUME_FORWARD_MEASUREMENT_CONSUMER_GATE,
    economics: null,
    profitabilityClaim: false,
    mode: 'SHADOW_ONLY',
    measurementMode: VOLUME_FORWARD_MEASUREMENT_REPLAY_MODE,
    recordOnly: true,
    strategyEnabled: false,
    killSwitchEngaged: true,
    submitAuthority: false,
    casAuthority: false,
    privateOrSignedCalls: 0,
    orders: 0,
    transfers: 0,
    withdrawals: 0,
    moneyUsd: 0,
  });
}

export const replayForwardMeasurementEvidence =
  replayVolumeForwardMeasurementEvidence;

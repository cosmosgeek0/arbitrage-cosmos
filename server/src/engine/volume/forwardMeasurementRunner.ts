import { createHash } from 'node:crypto';

import {
  VOLUME_FORWARD_DETECTOR_SOURCE_ID,
  VOLUME_FORWARD_DETECTOR_SOURCE_SCHEMA,
  type VolumeForwardDetectorSourceCut,
  type VolumeForwardDetectorSourceProposal,
} from './forwardMeasurementDetectorSource.js';
import {
  VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS,
  VOLUME_FORWARD_MEASUREMENT_DETECTOR_COVERAGE_CUT_SCHEMA,
  VOLUME_FORWARD_MEASUREMENT_SEGMENT_PROFILE,
  type VolumeForwardMeasurementDetectorCoverageCut,
  type VolumeForwardMeasurementDetectorCoverageProposal,
} from './forwardMeasurementEvidence.js';

export const VOLUME_FORWARD_MEASUREMENT_RUNNER_SCHEMA =
  'volume.forward.scheduled-capture.v1' as const;
export const VOLUME_FORWARD_RUNTIME_DETECTOR_CUT_SCHEMA =
  'volume.runtime.forward-detector-cut.v1' as const;
export const VOLUME_FORWARD_MEASUREMENT_RUNNER_CHECKPOINT_SCHEMA =
  'volume.forward.runner-checkpoint.v1' as const;

export const VOLUME_FORWARD_MEASUREMENT_RUNNER_AUTHORITY = deepFreeze({
  enabled: false,
  killSwitchEngaged: true,
  mode: 'SHADOW_ONLY' as const,
  recordOnly: true,
  publicOnly: true,
  executionAuthority: 'NONE' as const,
  submitAuthority: 'NONE' as const,
  casAuthority: 'NONE' as const,
  privateDataAuthority: 'NONE' as const,
  signedRequestAuthority: 'NONE' as const,
  keyAuthority: 'NONE' as const,
  providerAuthority: 'NONE' as const,
  hostAuthority: 'NONE' as const,
  submitPortPresent: false,
  queryPortPresent: false,
  sends: 0,
  sideEffects: 0,
  orders: 0,
  transfers: 0,
  withdrawals: 0,
  moneyUsd: 0,
});

const MAX_UTC_MS = 4_102_444_800_000;
const WARMUP_DURATION_MS = 14_400_000;
const INTERVAL_DURATION_MS = 2_592_000_000;
const MATURITY_LAG_MS = 62_000;
const DETECTOR_CUTS_PER_SEGMENT = 99_998;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const ACTIVATION_ID = /^ve2_activation_[a-f0-9]{64}$/;
const CAPTURE_ID = /^ve2_capture_[a-f0-9]{64}$/;
const CHAIN_KEY = /^ve2_detector_coverage_[a-f0-9]{64}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const HEX_SHA256 = /^[a-f0-9]{64}$/;
const ENGINE_ID = /^[A-Za-z][A-Za-z0-9_-]{2,191}$/;
const MONOTONIC_NS = /^(?:0|[1-9][0-9]{0,39})$/;

export interface VolumeForwardScheduledCapture {
  readonly schemaVersion: typeof VOLUME_FORWARD_MEASUREMENT_RUNNER_SCHEMA;
  readonly activationId: string;
  readonly captureId: string;
  readonly detectorCoverageChainKey: string;
  readonly detectorCoverageCorePolicyDigest: `sha256:${string}`;
  readonly detectorInputSourceId: string;
  readonly detectorInputSourceDigest: `sha256:${string}`;
  readonly packetMeasurementPolicySha256: string;
  readonly warmupStartMs: number;
  readonly intervalStartMs: number;
  readonly intervalEndExclusiveMs: number;
  readonly maturityAtMs: number;
  readonly detectorCadenceMs:
    typeof VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS;
  readonly detectorCutsPerSegment: typeof DETECTOR_CUTS_PER_SEGMENT;
  readonly controls: Readonly<{
    readonly enabled: false;
    readonly killSwitchEngaged: true;
    readonly mode: 'SHADOW_ONLY';
    readonly recordOnly: true;
  }>;
}

export interface VolumeRuntimeForwardDetectorCut {
  readonly schemaVersion: typeof VOLUME_FORWARD_RUNTIME_DETECTOR_CUT_SCHEMA;
  readonly runtimeGeneration: number;
  readonly detectorTickRevision: number;
  readonly localReceivedAtMs: number;
  readonly localMonotonicNs: string;
  readonly observerFailureCount: number;
  readonly sourceCut: Readonly<VolumeForwardDetectorSourceCut>;
}

export interface VolumeForwardDetectorSegmentRotation {
  readonly activationId: string;
  readonly captureId: string;
  readonly chainKey: string;
  readonly segmentId: string;
  readonly segmentIndex: number;
  readonly firstCutOffset: number;
  readonly previousCutDigest: string | null;
  readonly packetMeasurementPolicySha256: string;
  readonly detectorCoverageCorePolicyDigest: string;
}

export interface VolumeForwardProposalCaptureRequest {
  readonly activationId: string;
  readonly captureId: string;
  readonly detectorCutOffset: number;
  readonly detectorCutAtMs: number;
  readonly detectorInputSourceId: string;
  readonly detectorInputSourceDigest: string;
  readonly proposal: VolumeForwardDetectorSourceProposal['proposal'];
  readonly detectorDecisionDigest: string;
  readonly featureDigest: string;
  readonly entryQuoteNotional: '10.00';
  readonly maximumHoldMs: 60_000;
  readonly admissionEndExclusiveMs: number;
  readonly evidenceClosesAtMs: number;
  readonly authority: typeof VOLUME_FORWARD_MEASUREMENT_RUNNER_AUTHORITY;
}

export interface VolumeForwardDetectorCaptureSealRequest {
  readonly activationId: string;
  readonly captureId: string;
  readonly detectorCoverageChainKey: string;
  readonly detectorCoverageCorePolicyDigest: string;
  readonly detectorInputSourceId: string;
  readonly detectorInputSourceDigest: string;
  readonly packetMeasurementPolicySha256: string;
  readonly intervalStartMs: number;
  readonly intervalEndExclusiveMs: number;
  readonly maturityAtMs: number;
  readonly detectorCadenceMs: 2_000;
  readonly detectorCutsPerSegment: 99_998;
  readonly recordedDetectorCutCount: number;
  readonly expectedDetectorCutCount: number;
  readonly acceptedProposalCount: number;
  readonly terminalCutDigest: string;
  readonly authority: typeof VOLUME_FORWARD_MEASUREMENT_RUNNER_AUTHORITY;
}

export interface VolumeForwardMeasurementRunnerCheckpoint {
  readonly schemaVersion:
    typeof VOLUME_FORWARD_MEASUREMENT_RUNNER_CHECKPOINT_SCHEMA;
  readonly checkpointRevision: number;
  readonly activationId: string;
  readonly captureId: string;
  readonly state: 'SCHEDULED' | 'WARMING' | 'CAPTURING';
  readonly nextCutOffset: number;
  readonly warmupCutCount: number;
  readonly currentSegmentIndex: number | null;
  readonly runtimeGeneration: number | null;
  readonly lastDetectorTickRevision: number | null;
  readonly lastLocalReceivedAtMs: number | null;
  readonly lastLocalMonotonicNs: string | null;
  readonly observerFailureCount: number;
  readonly previousCutDigest: string | null;
  readonly warmupCorrelationIds: readonly string[];
  readonly acceptedProposalIds: readonly string[];
  readonly acceptedCorrelationIds: readonly string[];
  readonly consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED';
  readonly profitabilityClaim: false;
  readonly checkpointDigest: `sha256:${string}`;
}

export interface VolumeForwardMeasurementRunnerSink {
  readonly rotateDetectorSegment:
    (rotation: Readonly<VolumeForwardDetectorSegmentRotation>) => unknown;
  readonly appendDetectorCoverage:
    (cut: Readonly<VolumeForwardMeasurementDetectorCoverageCut>) => unknown;
  readonly openProposalCapture:
    (request: Readonly<VolumeForwardProposalCaptureRequest>) => unknown;
  readonly persistRunnerCheckpoint:
    (checkpoint: Readonly<VolumeForwardMeasurementRunnerCheckpoint>) => unknown;
  readonly sealDetectorCapture:
    (request: Readonly<VolumeForwardDetectorCaptureSealRequest>) => unknown;
}

export type VolumeForwardMeasurementRunnerState =
  | 'SCHEDULED'
  | 'WARMING'
  | 'CAPTURING'
  | 'READY_TO_TERMINALIZE'
  | 'FAILED';

export interface VolumeForwardMeasurementRunnerSnapshot {
  readonly state: VolumeForwardMeasurementRunnerState;
  readonly activationId: string;
  readonly expectedDetectorCutCount: number;
  readonly recordedDetectorCutCount: number;
  readonly nextCutOffset: number;
  readonly currentSegmentIndex: number | null;
  readonly acceptedProposalCount: number;
  readonly warmupProposalCount: number;
  readonly recordedWarmupCutCount: number;
  readonly expectedWarmupCutCount: number;
  readonly runtimeGeneration: number | null;
  readonly observerFailureCount: number;
  readonly reasonCodes: readonly string[];
  readonly consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED';
  readonly profitabilityClaim: false;
  readonly authority: typeof VOLUME_FORWARD_MEASUREMENT_RUNNER_AUTHORITY;
  readonly checkpoint:
    Readonly<VolumeForwardMeasurementRunnerCheckpoint> | null;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value as Readonly<T>;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen);
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child, seen);
    }
  }
  return Object.freeze(value);
}

function plainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function canonicalJson(value: unknown): string {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError('forward runner canonical number invalid');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (!plainRecord(value)) {
    throw new TypeError('forward runner canonical object invalid');
  }
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(',')}}`;
}

function domainSha256(domain: string, value: unknown): `sha256:${string}` {
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  hash.update(Uint8Array.of(0));
  hash.update(canonicalJson(value), 'utf8');
  return `sha256:${hash.digest('hex')}`;
}

function safeUtcMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_UTC_MS
    && !Object.is(value, -0);
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0);
}

function assertSynchronous(result: unknown, code: string): void {
  if (
    result !== null
    && (
      typeof result === 'object'
      || typeof result === 'function'
    )
    && typeof (result as PromiseLike<unknown>).then === 'function'
  ) {
    throw new TypeError(code);
  }
}

function validateSchedule(value: unknown): Readonly<VolumeForwardScheduledCapture> {
  if (
    !plainRecord(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
      'activationId',
      'captureId',
      'controls',
      'detectorCadenceMs',
      'detectorCoverageChainKey',
      'detectorCoverageCorePolicyDigest',
      'detectorCutsPerSegment',
      'detectorInputSourceDigest',
      'detectorInputSourceId',
      'intervalEndExclusiveMs',
      'intervalStartMs',
      'maturityAtMs',
      'packetMeasurementPolicySha256',
      'schemaVersion',
      'warmupStartMs',
    ])
    || value.schemaVersion !== VOLUME_FORWARD_MEASUREMENT_RUNNER_SCHEMA
    || typeof value.activationId !== 'string'
    || !ACTIVATION_ID.test(value.activationId)
    || typeof value.captureId !== 'string'
    || !CAPTURE_ID.test(value.captureId)
    || typeof value.detectorCoverageChainKey !== 'string'
    || !CHAIN_KEY.test(value.detectorCoverageChainKey)
    || typeof value.detectorCoverageCorePolicyDigest !== 'string'
    || !SHA256.test(value.detectorCoverageCorePolicyDigest)
    || value.detectorInputSourceId !== VOLUME_FORWARD_DETECTOR_SOURCE_ID
    || typeof value.detectorInputSourceDigest !== 'string'
    || !SHA256.test(value.detectorInputSourceDigest)
    || typeof value.packetMeasurementPolicySha256 !== 'string'
    || !HEX_SHA256.test(value.packetMeasurementPolicySha256)
    || !safeUtcMs(value.warmupStartMs)
    || !safeUtcMs(value.intervalStartMs)
    || !safeUtcMs(value.intervalEndExclusiveMs)
    || !safeUtcMs(value.maturityAtMs)
    || value.warmupStartMs !== value.intervalStartMs - WARMUP_DURATION_MS
    || value.intervalEndExclusiveMs
      !== value.intervalStartMs + INTERVAL_DURATION_MS
    || value.maturityAtMs
      !== value.intervalEndExclusiveMs + MATURITY_LAG_MS
    || value.detectorCadenceMs
      !== VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
    || value.detectorCutsPerSegment !== DETECTOR_CUTS_PER_SEGMENT
    || !plainRecord(value.controls)
    || JSON.stringify(Object.keys(value.controls).sort()) !== JSON.stringify([
      'enabled',
      'killSwitchEngaged',
      'mode',
      'recordOnly',
    ])
    || value.controls.enabled !== false
    || value.controls.killSwitchEngaged !== true
    || value.controls.mode !== 'SHADOW_ONLY'
    || value.controls.recordOnly !== true
  ) {
    throw new TypeError('forward scheduled capture is invalid');
  }
  return deepFreeze(structuredClone(value)) as unknown as
    Readonly<VolumeForwardScheduledCapture>;
}

function validateRuntimeCut(value: unknown): value is Readonly<VolumeRuntimeForwardDetectorCut> {
  if (
    !plainRecord(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
      'detectorTickRevision',
      'localMonotonicNs',
      'localReceivedAtMs',
      'observerFailureCount',
      'runtimeGeneration',
      'schemaVersion',
      'sourceCut',
    ])
    || value.schemaVersion !== VOLUME_FORWARD_RUNTIME_DETECTOR_CUT_SCHEMA
    || !nonNegativeSafeInteger(value.runtimeGeneration)
    || value.runtimeGeneration < 1
    || !nonNegativeSafeInteger(value.detectorTickRevision)
    || value.detectorTickRevision < 1
    || !safeUtcMs(value.localReceivedAtMs)
    || typeof value.localMonotonicNs !== 'string'
    || !MONOTONIC_NS.test(value.localMonotonicNs)
    || !nonNegativeSafeInteger(value.observerFailureCount)
    || !plainRecord(value.sourceCut)
  ) return false;
  const source = value.sourceCut;
  return source.schemaVersion === VOLUME_FORWARD_DETECTOR_SOURCE_SCHEMA
    && source.sourceId === VOLUME_FORWARD_DETECTOR_SOURCE_ID
    && safeUtcMs(source.tickAtMs)
    && source.tickAtMs <= value.localReceivedAtMs
    && value.localReceivedAtMs - source.tickAtMs
      < VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
    && typeof source.configurationRevision === 'string'
    && IDENTIFIER.test(source.configurationRevision)
    && typeof source.configurationDigest === 'string'
    && SHA256.test(source.configurationDigest)
    && typeof source.evaluationUniverseDigest === 'string'
    && SHA256.test(source.evaluationUniverseDigest)
    && nonNegativeSafeInteger(source.evaluationUniverseCount)
    && source.pseudoProposalExcludedCount === 0
    && Array.isArray(source.qualifiedProposals)
    && source.qualifiedProposals.length <= source.evaluationUniverseCount
    && typeof source.cutDigest === 'string'
    && SHA256.test(source.cutDigest);
}

function segmentId(
  schedule: Readonly<VolumeForwardScheduledCapture>,
  segmentIndex: number,
): string {
  return `ve2_segment_${domainSha256(
    'VE2_FORWARD_DETECTOR_SEGMENT_ID_V1',
    {
      activationId: schedule.activationId,
      captureId: schedule.captureId,
      chainKey: schedule.detectorCoverageChainKey,
      segmentIndex,
    },
  ).slice('sha256:'.length)}`;
}

function detectorCutDigest(
  value: Omit<VolumeForwardMeasurementDetectorCoverageCut, 'cutDigest'>,
): string {
  return domainSha256('VOLUME_FORWARD_DETECTOR_COVERAGE_CUT_V1', value);
}

function checkpointDigest(
  value: Omit<
    VolumeForwardMeasurementRunnerCheckpoint,
    'checkpointDigest'
  >,
): `sha256:${string}` {
  return domainSha256(
    'VOLUME_FORWARD_MEASUREMENT_RUNNER_CHECKPOINT_V1',
    value,
  );
}

function uniqueSortedIdentifiers(
  value: unknown,
  maximum: number,
): readonly string[] | null {
  if (
    !Array.isArray(value)
    || value.length > maximum
    || value.some(
      (item) => typeof item !== 'string' || !IDENTIFIER.test(item),
    )
  ) return null;
  const sorted = [...value].sort();
  if (
    new Set(sorted).size !== sorted.length
    || sorted.some((item, index) => item !== value[index])
  ) return null;
  return Object.freeze(sorted);
}

function validateCheckpoint(
  value: unknown,
  schedule: Readonly<VolumeForwardScheduledCapture>,
): Readonly<VolumeForwardMeasurementRunnerCheckpoint> {
  if (
    !plainRecord(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
      'acceptedCorrelationIds',
      'acceptedProposalIds',
      'activationId',
      'captureId',
      'checkpointDigest',
      'checkpointRevision',
      'consumerGate',
      'currentSegmentIndex',
      'lastDetectorTickRevision',
      'lastLocalMonotonicNs',
      'lastLocalReceivedAtMs',
      'nextCutOffset',
      'observerFailureCount',
      'previousCutDigest',
      'profitabilityClaim',
      'runtimeGeneration',
      'schemaVersion',
      'state',
      'warmupCorrelationIds',
      'warmupCutCount',
    ])
    || value.schemaVersion
      !== VOLUME_FORWARD_MEASUREMENT_RUNNER_CHECKPOINT_SCHEMA
    || value.activationId !== schedule.activationId
    || value.captureId !== schedule.captureId
    || !nonNegativeSafeInteger(value.checkpointRevision)
    || value.checkpointRevision < 1
    || !['SCHEDULED', 'WARMING', 'CAPTURING'].includes(
      String(value.state),
    )
    || !nonNegativeSafeInteger(value.nextCutOffset)
    || value.nextCutOffset > (
      schedule.maturityAtMs - schedule.intervalStartMs
    ) / schedule.detectorCadenceMs
    || !nonNegativeSafeInteger(value.warmupCutCount)
    || value.warmupCutCount > (
      schedule.intervalStartMs - schedule.warmupStartMs
    ) / schedule.detectorCadenceMs
    || (
      value.currentSegmentIndex !== null
      && (
        !nonNegativeSafeInteger(value.currentSegmentIndex)
        || value.currentSegmentIndex !== Math.floor(
          Math.max(0, value.nextCutOffset - 1)
            / schedule.detectorCutsPerSegment,
        )
      )
    )
    || (
      value.nextCutOffset === 0
      && value.currentSegmentIndex !== null
    )
    || (
      value.runtimeGeneration !== null
      && (
        !nonNegativeSafeInteger(value.runtimeGeneration)
        || value.runtimeGeneration < 1
      )
    )
    || (
      value.lastDetectorTickRevision !== null
      && (
        !nonNegativeSafeInteger(value.lastDetectorTickRevision)
        || value.lastDetectorTickRevision < 1
      )
    )
    || (
      value.lastLocalReceivedAtMs !== null
      && !safeUtcMs(value.lastLocalReceivedAtMs)
    )
    || (
      value.lastLocalMonotonicNs !== null
      && (
        typeof value.lastLocalMonotonicNs !== 'string'
        || !MONOTONIC_NS.test(value.lastLocalMonotonicNs)
      )
    )
    || !nonNegativeSafeInteger(value.observerFailureCount)
    || (
      value.previousCutDigest !== null
      && (
        typeof value.previousCutDigest !== 'string'
        || !SHA256.test(value.previousCutDigest)
      )
    )
    || (value.nextCutOffset === 0) !== (value.previousCutDigest === null)
    || (
      (value.lastDetectorTickRevision === null)
        !== (value.lastLocalReceivedAtMs === null)
    )
    || (
      (value.lastDetectorTickRevision === null)
        !== (value.lastLocalMonotonicNs === null)
    )
    || (
      (value.runtimeGeneration === null)
        !== (value.lastDetectorTickRevision === null)
    )
    || value.consumerGate
      !== 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED'
    || value.profitabilityClaim !== false
    || typeof value.checkpointDigest !== 'string'
    || !SHA256.test(value.checkpointDigest)
  ) throw new TypeError('forward runner checkpoint is invalid');
  const warmupCorrelationIds = uniqueSortedIdentifiers(
    value.warmupCorrelationIds,
    100_000,
  );
  const acceptedProposalIds = uniqueSortedIdentifiers(
    value.acceptedProposalIds,
    100_000,
  );
  const acceptedCorrelationIds = uniqueSortedIdentifiers(
    value.acceptedCorrelationIds,
    100_000,
  );
  if (
    warmupCorrelationIds === null
    || acceptedProposalIds === null
    || acceptedCorrelationIds === null
    || acceptedProposalIds.length !== acceptedCorrelationIds.length
    || (
      value.state === 'SCHEDULED'
      && (
        value.warmupCutCount !== 0
        || value.nextCutOffset !== 0
      )
    )
    || (
      value.state === 'WARMING'
      && (
        value.warmupCutCount === 0
        || value.nextCutOffset !== 0
      )
    )
    || (
      value.state === 'CAPTURING'
      && value.nextCutOffset === 0
    )
  ) throw new TypeError('forward runner checkpoint is invalid');
  const semantic = {
    schemaVersion:
      VOLUME_FORWARD_MEASUREMENT_RUNNER_CHECKPOINT_SCHEMA,
    checkpointRevision: value.checkpointRevision,
    activationId: value.activationId,
    captureId: value.captureId,
    state: value.state as 'SCHEDULED' | 'WARMING' | 'CAPTURING',
    nextCutOffset: value.nextCutOffset,
    warmupCutCount: value.warmupCutCount,
    currentSegmentIndex: value.currentSegmentIndex,
    runtimeGeneration: value.runtimeGeneration,
    lastDetectorTickRevision: value.lastDetectorTickRevision,
    lastLocalReceivedAtMs: value.lastLocalReceivedAtMs,
    lastLocalMonotonicNs: value.lastLocalMonotonicNs,
    observerFailureCount: value.observerFailureCount,
    previousCutDigest: value.previousCutDigest,
    warmupCorrelationIds,
    acceptedProposalIds,
    acceptedCorrelationIds,
    consumerGate:
      'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED' as const,
    profitabilityClaim: false as const,
  };
  if (value.checkpointDigest !== checkpointDigest(semantic)) {
    throw new TypeError('forward runner checkpoint is invalid');
  }
  return deepFreeze({
    ...semantic,
    checkpointDigest: value.checkpointDigest,
  }) as Readonly<VolumeForwardMeasurementRunnerCheckpoint>;
}

function acceptedProposal(
  source: Readonly<VolumeForwardDetectorSourceProposal>,
  cutOffset: number,
): Readonly<VolumeForwardMeasurementDetectorCoverageProposal> {
  const proposal = source.proposal;
  if (
    !ENGINE_ID.test(proposal.proposalId)
    || !ENGINE_ID.test(proposal.proposalDigest)
    || !ENGINE_ID.test(source.detectorDecisionDigest)
    || !ENGINE_ID.test(source.featureDigest)
  ) {
    throw new TypeError('forward detector proposal digest is invalid');
  }
  return Object.freeze({
    cutOffset,
    proposalId: proposal.proposalId,
    proposalRevision: proposal.proposalRevision,
    proposalDigest: proposal.proposalDigest,
    symbol: proposal.symbol,
    detectorDecisionDigest: source.detectorDecisionDigest,
    featureDigest: source.featureDigest,
  });
}

class VolumeForwardMeasurementRunner {
  private state: VolumeForwardMeasurementRunnerState = 'SCHEDULED';
  private readonly schedule: Readonly<VolumeForwardScheduledCapture>;
  private readonly sink: Readonly<VolumeForwardMeasurementRunnerSink>;
  private readonly warmupCorrelationIds = new Set<string>();
  private readonly acceptedProposalIds = new Set<string>();
  private readonly acceptedCorrelationIds = new Set<string>();
  private readonly reasons = new Set<string>();
  private nextCutOffset = 0;
  private warmupCutCount = 0;
  private currentSegmentIndex: number | null = null;
  private runtimeGeneration: number | null = null;
  private lastDetectorTickRevision: number | null = null;
  private lastLocalReceivedAtMs: number | null = null;
  private observerFailureCount = 0;
  private lastMonotonicNs: bigint | null = null;
  private previousCutDigest: string | null = null;
  private checkpointRevision = 0;
  private lastCheckpoint:
    Readonly<VolumeForwardMeasurementRunnerCheckpoint> | null = null;
  private resumeGenerationPending = false;

  constructor(input: Readonly<{
    readonly schedule: unknown;
    readonly sink: Readonly<VolumeForwardMeasurementRunnerSink>;
    readonly checkpoint?: unknown;
  }>) {
    if (
      !plainRecord(input)
      || !plainRecord(input.sink)
      || typeof input.sink.rotateDetectorSegment !== 'function'
      || typeof input.sink.appendDetectorCoverage !== 'function'
      || typeof input.sink.openProposalCapture !== 'function'
      || typeof input.sink.persistRunnerCheckpoint !== 'function'
      || typeof input.sink.sealDetectorCapture !== 'function'
    ) throw new TypeError('forward measurement runner input is invalid');
    this.schedule = validateSchedule(input.schedule);
    this.sink = input.sink;
    if (input.checkpoint !== undefined && input.checkpoint !== null) {
      const checkpoint = validateCheckpoint(
        input.checkpoint,
        this.schedule,
      );
      this.state = checkpoint.state;
      this.nextCutOffset = checkpoint.nextCutOffset;
      this.warmupCutCount = checkpoint.warmupCutCount;
      this.currentSegmentIndex = checkpoint.currentSegmentIndex;
      this.runtimeGeneration = checkpoint.runtimeGeneration;
      this.lastDetectorTickRevision = checkpoint.lastDetectorTickRevision;
      this.lastLocalReceivedAtMs = checkpoint.lastLocalReceivedAtMs;
      this.lastMonotonicNs = checkpoint.lastLocalMonotonicNs === null
        ? null
        : BigInt(checkpoint.lastLocalMonotonicNs);
      this.observerFailureCount = checkpoint.observerFailureCount;
      this.previousCutDigest = checkpoint.previousCutDigest;
      this.checkpointRevision = checkpoint.checkpointRevision;
      this.lastCheckpoint = checkpoint;
      for (const value of checkpoint.warmupCorrelationIds) {
        this.warmupCorrelationIds.add(value);
      }
      for (const value of checkpoint.acceptedProposalIds) {
        this.acceptedProposalIds.add(value);
      }
      for (const value of checkpoint.acceptedCorrelationIds) {
        this.acceptedCorrelationIds.add(value);
      }
      this.resumeGenerationPending = true;
    }
  }

  observe(value: unknown): Readonly<VolumeForwardMeasurementRunnerSnapshot> {
    if (this.state === 'FAILED' || this.state === 'READY_TO_TERMINALIZE') {
      return this.snapshot();
    }
    if (!validateRuntimeCut(value)) {
      return this.fail('DETECTOR_RUNTIME_CUT_INVALID');
    }
    const cut = value;
    if (cut.observerFailureCount !== 0) {
      this.observerFailureCount += cut.observerFailureCount;
      return this.fail('DETECTOR_RUNTIME_OBSERVER_FAILED', false);
    }
    if (cut.localReceivedAtMs < this.schedule.warmupStartMs) {
      return this.snapshot();
    }
    const receivedNs = BigInt(cut.localMonotonicNs);
    const resumingGeneration = this.resumeGenerationPending;
    if (resumingGeneration) {
      if (
        this.runtimeGeneration === null
        || cut.runtimeGeneration !== this.runtimeGeneration + 1
        || cut.detectorTickRevision !== 1
      ) {
        return this.fail('DETECTOR_RUNTIME_RESUME_GENERATION_INVALID');
      }
      this.runtimeGeneration = cut.runtimeGeneration;
      this.resumeGenerationPending = false;
    } else if (
      this.runtimeGeneration !== null
      && cut.runtimeGeneration !== this.runtimeGeneration
    ) {
      return this.fail('DETECTOR_RUNTIME_GENERATION_CHANGED');
    }
    this.runtimeGeneration ??= cut.runtimeGeneration;
    if (
      this.lastDetectorTickRevision !== null
      && !resumingGeneration
      && cut.detectorTickRevision !== this.lastDetectorTickRevision + 1
    ) {
      return this.fail('DETECTOR_TICK_REVISION_GAP');
    }
    if (
      this.lastLocalReceivedAtMs !== null
      && cut.localReceivedAtMs < this.lastLocalReceivedAtMs
    ) {
      return this.fail('DETECTOR_RECEIVE_CLOCK_REGRESSED');
    }
    if (
      this.lastMonotonicNs !== null
      && cut.detectorTickRevision !== 1
      && receivedNs <= this.lastMonotonicNs
    ) {
      return this.fail('DETECTOR_MONOTONIC_CLOCK_REGRESSED');
    }
    this.lastDetectorTickRevision = cut.detectorTickRevision;
    this.lastLocalReceivedAtMs = cut.localReceivedAtMs;
    this.lastMonotonicNs = receivedNs;
    if (cut.localReceivedAtMs < this.schedule.intervalStartMs) {
      const expectedWarmupAtMs = this.schedule.warmupStartMs
        + this.warmupCutCount * this.schedule.detectorCadenceMs;
      if (
        cut.localReceivedAtMs < expectedWarmupAtMs
        || cut.localReceivedAtMs
          >= expectedWarmupAtMs + this.schedule.detectorCadenceMs
      ) {
        return this.fail('DETECTOR_WARMUP_COVERAGE_GAP');
      }
      this.state = 'WARMING';
      for (const candidate of cut.sourceCut.qualifiedProposals) {
        this.warmupCorrelationIds.add(candidate.proposal.correlationId);
      }
      this.warmupCutCount += 1;
      if (!this.persistCheckpoint()) return this.snapshot();
      return this.snapshot();
    }
    if (cut.localReceivedAtMs >= this.schedule.maturityAtMs) {
      return this.advanceTime(cut.localReceivedAtMs);
    }
    if (this.warmupCutCount !== this.expectedWarmupCutCount()) {
      return this.fail('DETECTOR_WARMUP_COVERAGE_INCOMPLETE');
    }
    const expectedCutAtMs = this.schedule.intervalStartMs
      + this.nextCutOffset * this.schedule.detectorCadenceMs;
    if (
      cut.localReceivedAtMs < expectedCutAtMs
      || cut.localReceivedAtMs
        >= expectedCutAtMs + this.schedule.detectorCadenceMs
    ) {
      return this.fail('DETECTOR_CUT_RECEIVE_CLOCK_OUT_OF_RANGE');
    }
    const cutOffset = this.nextCutOffset;
    const segmentIndex = Math.floor(
      cutOffset / this.schedule.detectorCutsPerSegment,
    );
    const segment = segmentId(this.schedule, segmentIndex);
    if (segmentIndex !== this.currentSegmentIndex) {
      try {
        assertSynchronous(this.sink.rotateDetectorSegment(Object.freeze({
          activationId: this.schedule.activationId,
          captureId: this.schedule.captureId,
          chainKey: this.schedule.detectorCoverageChainKey,
          segmentId: segment,
          segmentIndex,
          firstCutOffset: cutOffset,
          previousCutDigest: this.previousCutDigest,
          packetMeasurementPolicySha256:
            this.schedule.packetMeasurementPolicySha256,
          detectorCoverageCorePolicyDigest:
            this.schedule.detectorCoverageCorePolicyDigest,
        })), 'DETECTOR_SEGMENT_ROTATION_ASYNC');
        this.currentSegmentIndex = segmentIndex;
      } catch {
        return this.fail('DETECTOR_SEGMENT_ROTATION_FAILED');
      }
    }
    const acceptedSources: VolumeForwardDetectorSourceProposal[] = [];
    if (expectedCutAtMs < this.schedule.intervalEndExclusiveMs) {
      for (const candidate of cut.sourceCut.qualifiedProposals) {
        const proposalId = candidate.proposal.proposalId;
        if (
          this.warmupCorrelationIds.has(candidate.proposal.correlationId)
          || this.acceptedCorrelationIds.has(candidate.proposal.correlationId)
          || this.acceptedProposalIds.has(proposalId)
        ) continue;
        acceptedSources.push(candidate);
        this.acceptedProposalIds.add(proposalId);
        this.acceptedCorrelationIds.add(candidate.proposal.correlationId);
      }
    }
    const acceptedProposals = acceptedSources
      .map((candidate) => acceptedProposal(candidate, cutOffset))
      .sort((left, right) => {
        const leftKey = [
          left.symbol,
          left.proposalId,
          String(left.proposalRevision).padStart(16, '0'),
          left.proposalDigest,
          left.detectorDecisionDigest,
          left.featureDigest,
        ].join('|');
        const rightKey = [
          right.symbol,
          right.proposalId,
          String(right.proposalRevision).padStart(16, '0'),
          right.proposalDigest,
          right.detectorDecisionDigest,
          right.featureDigest,
        ].join('|');
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      });
    const withoutDigest: Omit<
      VolumeForwardMeasurementDetectorCoverageCut,
      'cutDigest'
    > = {
      schemaVersion:
        VOLUME_FORWARD_MEASUREMENT_DETECTOR_COVERAGE_CUT_SCHEMA,
      profile: VOLUME_FORWARD_MEASUREMENT_SEGMENT_PROFILE,
      captureId: this.schedule.captureId,
      activationId: this.schedule.activationId,
      segmentId: segment,
      chainKey: this.schedule.detectorCoverageChainKey,
      detectorInputSourceId: this.schedule.detectorInputSourceId,
      detectorInputSourceDigest: this.schedule.detectorInputSourceDigest,
      runtimeGeneration: cut.runtimeGeneration,
      detectorTickRevision: cut.detectorTickRevision,
      cutOffset,
      cutAtMs: expectedCutAtMs,
      localReceivedAtMs: cut.localReceivedAtMs,
      localMonotonicNs: cut.localMonotonicNs,
      cadenceMs: VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS,
      configurationRevision: cut.sourceCut.configurationRevision,
      configurationDigest: cut.sourceCut.configurationDigest,
      strategyEnabled: false,
      killSwitchEngaged: true,
      evaluationUniverseDigest: cut.sourceCut.evaluationUniverseDigest,
      evaluationUniverseCount: cut.sourceCut.evaluationUniverseCount,
      pseudoProposalExcludedCount:
        cut.sourceCut.pseudoProposalExcludedCount,
      acceptedProposals,
      observerDropCount: 0,
      observerFailureCount: 0,
      previousCutDigest: this.previousCutDigest,
      complete: true,
    };
    const coverageCut = deepFreeze({
      ...withoutDigest,
      cutDigest: detectorCutDigest(withoutDigest),
    }) as Readonly<VolumeForwardMeasurementDetectorCoverageCut>;
    try {
      assertSynchronous(
        this.sink.appendDetectorCoverage(coverageCut),
        'DETECTOR_EVIDENCE_APPEND_ASYNC',
      );
    } catch {
      return this.fail('DETECTOR_EVIDENCE_APPEND_FAILED');
    }
    this.previousCutDigest = coverageCut.cutDigest;
    this.nextCutOffset += 1;
    this.state = 'CAPTURING';
    for (const candidate of acceptedSources) {
      try {
        assertSynchronous(this.sink.openProposalCapture(deepFreeze({
          activationId: this.schedule.activationId,
          captureId: this.schedule.captureId,
          detectorCutOffset: cutOffset,
          detectorCutAtMs: expectedCutAtMs,
          detectorInputSourceId: this.schedule.detectorInputSourceId,
          detectorInputSourceDigest:
            this.schedule.detectorInputSourceDigest,
          proposal: candidate.proposal,
          detectorDecisionDigest: candidate.detectorDecisionDigest,
          featureDigest: candidate.featureDigest,
          entryQuoteNotional: '10.00' as const,
          maximumHoldMs: 60_000 as const,
          admissionEndExclusiveMs:
            this.schedule.intervalEndExclusiveMs,
          evidenceClosesAtMs: this.schedule.maturityAtMs,
          authority: VOLUME_FORWARD_MEASUREMENT_RUNNER_AUTHORITY,
        })), 'DETECTOR_PROPOSAL_CAPTURE_ASYNC');
      } catch {
        return this.fail('DETECTOR_PROPOSAL_CAPTURE_OPEN_FAILED');
      }
    }
    if (!this.persistCheckpoint()) return this.snapshot();
    return this.snapshot();
  }

  advanceTime(nowMs: number): Readonly<VolumeForwardMeasurementRunnerSnapshot> {
    if (this.state === 'FAILED' || this.state === 'READY_TO_TERMINALIZE') {
      return this.snapshot();
    }
    if (!safeUtcMs(nowMs)) return this.fail('RUNNER_CLOCK_INVALID');
    if (nowMs < this.schedule.maturityAtMs) return this.snapshot();
    if (this.nextCutOffset !== this.expectedDetectorCutCount()) {
      return this.fail('DETECTOR_COVERAGE_INCOMPLETE_AT_MATURITY');
    }
    if (this.previousCutDigest === null) {
      return this.fail('DETECTOR_TERMINAL_DIGEST_MISSING');
    }
    try {
      assertSynchronous(this.sink.sealDetectorCapture(deepFreeze({
        activationId: this.schedule.activationId,
        captureId: this.schedule.captureId,
        detectorCoverageChainKey:
          this.schedule.detectorCoverageChainKey,
        detectorCoverageCorePolicyDigest:
          this.schedule.detectorCoverageCorePolicyDigest,
        detectorInputSourceId:
          this.schedule.detectorInputSourceId,
        detectorInputSourceDigest:
          this.schedule.detectorInputSourceDigest,
        packetMeasurementPolicySha256:
          this.schedule.packetMeasurementPolicySha256,
        intervalStartMs: this.schedule.intervalStartMs,
        intervalEndExclusiveMs:
          this.schedule.intervalEndExclusiveMs,
        maturityAtMs: this.schedule.maturityAtMs,
        detectorCadenceMs:
          VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS,
        detectorCutsPerSegment: DETECTOR_CUTS_PER_SEGMENT,
        recordedDetectorCutCount: this.nextCutOffset,
        expectedDetectorCutCount: this.expectedDetectorCutCount(),
        acceptedProposalCount: this.acceptedProposalIds.size,
        terminalCutDigest: this.previousCutDigest,
        authority: VOLUME_FORWARD_MEASUREMENT_RUNNER_AUTHORITY,
      })), 'DETECTOR_CAPTURE_SEAL_ASYNC');
    } catch {
      return this.fail('DETECTOR_CAPTURE_SEAL_FAILED');
    }
    this.state = 'READY_TO_TERMINALIZE';
    return this.snapshot();
  }

  snapshot(): Readonly<VolumeForwardMeasurementRunnerSnapshot> {
    return deepFreeze({
      state: this.state,
      activationId: this.schedule.activationId,
      expectedDetectorCutCount: this.expectedDetectorCutCount(),
      recordedDetectorCutCount: this.nextCutOffset,
      nextCutOffset: this.nextCutOffset,
      currentSegmentIndex: this.currentSegmentIndex,
      acceptedProposalCount: this.acceptedProposalIds.size,
      warmupProposalCount: this.warmupCorrelationIds.size,
      recordedWarmupCutCount: this.warmupCutCount,
      expectedWarmupCutCount: this.expectedWarmupCutCount(),
      runtimeGeneration: this.runtimeGeneration,
      observerFailureCount: this.observerFailureCount,
      reasonCodes: Object.freeze([...this.reasons].sort()),
          consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED' as const,
          profitabilityClaim: false as const,
          authority: VOLUME_FORWARD_MEASUREMENT_RUNNER_AUTHORITY,
          checkpoint: this.lastCheckpoint,
        });
  }

  checkpoint(): Readonly<VolumeForwardMeasurementRunnerCheckpoint> | null {
    return this.lastCheckpoint;
  }

  private expectedDetectorCutCount(): number {
    return (
      this.schedule.maturityAtMs - this.schedule.intervalStartMs
    ) / this.schedule.detectorCadenceMs;
  }

  private expectedWarmupCutCount(): number {
    return (
      this.schedule.intervalStartMs - this.schedule.warmupStartMs
    ) / this.schedule.detectorCadenceMs;
  }

  private fail(
    code: string,
    incrementFailureCount = true,
  ): Readonly<VolumeForwardMeasurementRunnerSnapshot> {
    this.reasons.add(code);
    if (incrementFailureCount) this.observerFailureCount += 1;
    this.state = 'FAILED';
    return this.snapshot();
  }

  private persistCheckpoint(): boolean {
    if (
      this.state !== 'SCHEDULED'
      && this.state !== 'WARMING'
      && this.state !== 'CAPTURING'
    ) return false;
    const semantic = {
      schemaVersion:
        VOLUME_FORWARD_MEASUREMENT_RUNNER_CHECKPOINT_SCHEMA,
      checkpointRevision: this.checkpointRevision + 1,
      activationId: this.schedule.activationId,
      captureId: this.schedule.captureId,
      state: this.state,
      nextCutOffset: this.nextCutOffset,
      warmupCutCount: this.warmupCutCount,
      currentSegmentIndex: this.currentSegmentIndex,
      runtimeGeneration: this.runtimeGeneration,
      lastDetectorTickRevision: this.lastDetectorTickRevision,
      lastLocalReceivedAtMs: this.lastLocalReceivedAtMs,
      lastLocalMonotonicNs:
        this.lastMonotonicNs === null ? null : String(this.lastMonotonicNs),
      observerFailureCount: this.observerFailureCount,
      previousCutDigest: this.previousCutDigest,
      warmupCorrelationIds:
        Object.freeze([...this.warmupCorrelationIds].sort()),
      acceptedProposalIds:
        Object.freeze([...this.acceptedProposalIds].sort()),
      acceptedCorrelationIds:
        Object.freeze([...this.acceptedCorrelationIds].sort()),
      consumerGate:
        'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED' as const,
      profitabilityClaim: false as const,
    };
    const checkpoint = deepFreeze({
      ...semantic,
      checkpointDigest: checkpointDigest(semantic),
    }) as Readonly<VolumeForwardMeasurementRunnerCheckpoint>;
    try {
      assertSynchronous(
        this.sink.persistRunnerCheckpoint(checkpoint),
        'DETECTOR_RUNNER_CHECKPOINT_ASYNC',
      );
    } catch {
      this.reasons.add('DETECTOR_RUNNER_CHECKPOINT_FAILED');
      this.observerFailureCount += 1;
      this.state = 'FAILED';
      return false;
    }
    this.checkpointRevision = checkpoint.checkpointRevision;
    this.lastCheckpoint = checkpoint;
    return true;
  }
}

export function createVolumeForwardMeasurementRunner(
  input: Readonly<{
    readonly schedule: unknown;
    readonly sink: Readonly<VolumeForwardMeasurementRunnerSink>;
    readonly checkpoint?: unknown;
  }>,
): Readonly<{
  readonly observe: (
    cut: unknown,
  ) => Readonly<VolumeForwardMeasurementRunnerSnapshot>;
  readonly advanceTime: (
    nowMs: number,
  ) => Readonly<VolumeForwardMeasurementRunnerSnapshot>;
  readonly snapshot: () => Readonly<VolumeForwardMeasurementRunnerSnapshot>;
  readonly checkpoint: () =>
    Readonly<VolumeForwardMeasurementRunnerCheckpoint> | null;
}> {
  const runner = new VolumeForwardMeasurementRunner(input);
  return Object.freeze({
    observe: (cut: unknown) => runner.observe(cut),
    advanceTime: (nowMs: number) => runner.advanceTime(nowMs),
    snapshot: () => runner.snapshot(),
    checkpoint: () => runner.checkpoint(),
  });
}

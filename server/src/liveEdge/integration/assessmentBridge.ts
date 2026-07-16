import { createHash } from 'node:crypto';

import { canonicalJson } from '../../foundation/contracts/index.js';
import {
  BoundedInboundQueue,
  type InboundQueueEntry,
} from '../../intelligenceRuntime/lifecycle/queue.js';
import {
  evaluateLocalTransport,
  type EffectiveTransportObservation,
  type LocalTransportObservation,
} from '../adapters/edgeProtocol/localTransport.js';
import type { EdgeProtocolV1Client } from '../adapters/edgeProtocol/client.js';
import type { JsonRecord, ProtocolErrorEnvelope } from '../adapters/edgeProtocol/types.js';

import { BoundedIdentityRegistry, type IdentityObservation } from './identityRegistry.js';

export interface LiveEdgeClock {
  nowMs(): number;
}

export interface AdvisoryAssessmentObservation {
  assessmentId: string;
  revision: number;
  traceId: string;
  strategyFamily: string;
  hypothesisId: string;
  instrumentGraph: JsonRecord;
  parentEvidenceIds: readonly string[];
  eventTimeMs: number | null;
  peerReceiveTimeMs: number;
  generationTimeMs: number;
  expiryTimeMs: number;
  economicExpiryTimeMs: number;
  localReceiptTimeMs: number;
  protocolFingerprintSha256: string;
  lineage: JsonRecord;
  sourceQuality: JsonRecord;
  regime: Readonly<{
    state: 'PRESENT' | 'UNKNOWN' | 'UNSUPPORTED';
    probabilities: Readonly<Record<string, number>>;
  }>;
}

export type AdvisoryOwnerObservationResult =
  | Readonly<{ state: 'OBSERVED'; ownerReference: string; reasonCode: string }>
  | Readonly<{ state: 'REJECTED'; ownerReference: string | null; reasonCode: string }>;

export interface AdvisoryStrategyPort {
  observeAssessment(observation: Readonly<AdvisoryAssessmentObservation>): AdvisoryOwnerObservationResult;
}

export interface CanonicalRecordingHealthSnapshot {
  state: 'RUNNING' | 'DEGRADED' | 'STALE' | 'FAILED' | 'UNKNOWN';
  observedAtMs: number | null;
  gapCount: number | null;
  quotaState: 'OK' | 'PRESSURED' | 'EXHAUSTED' | 'UNKNOWN';
  storagePressure: 'OK' | 'PRESSURED' | 'FULL' | 'UNKNOWN';
}

export interface CanonicalRecordingHealthPort {
  snapshot(nowMs: number): Readonly<CanonicalRecordingHealthSnapshot>;
}

export interface EdgeAssessmentBridgeConfig {
  adapterPolicy: 'L_ADAPTER_POLICY_V1';
  expectedRemoteComponentId: string;
  queueCapacity: number;
  maximumQueueEntryBytes: number;
  maximumQueueRetainedBytes: number;
  identityCapacity: number;
  identityRetentionGraceMs: number;
  maximumDwellMs: number;
  heartbeatTtlMs: number;
  requestTimeoutMs: number;
  maximumFutureSkewMs: number;
  queuePressureRatio: number;
  supportedStrategyFamilies: readonly string[];
  supportedRegimeKeys: readonly string[];
}

export type BridgeDispositionKind =
  | 'QUEUED'
  | 'REMOTE_HEALTH_UPDATED'
  | 'NON_ACTIONABLE'
  | 'INVALID'
  | 'DUPLICATE_NOOP'
  | 'IDENTITY_CONFLICT'
  | 'REVISION_STALE'
  | 'BACKPRESSURE_DROPPED'
  | 'IDENTITY_CAPACITY_BLOCKED'
  | 'DIRECTION_REJECTED'
  | 'DISPATCHED_TO_CANONICAL_STRATEGY'
  | 'OWNER_REJECTED'
  | 'OWNER_PORT_FAILURE'
  | 'QUEUE_EMPTY';

export interface BridgeDisposition {
  kind: BridgeDispositionKind;
  assessmentId: string | null;
  revision: number | null;
  reasonCodes: readonly string[];
  ownerReference: string | null;
}

export interface EdgeAssessmentBridgeSnapshot {
  adapterPolicy: 'L_ADAPTER_POLICY_V1';
  state: 'RUNNING' | 'DEGRADED' | 'STALE' | 'BLOCKED' | 'FAILED' | 'UNKNOWN';
  advisoryReady: boolean;
  researchRecordingReady: boolean;
  reasonCodes: readonly string[];
  queue: ReturnType<BoundedInboundQueue<QueuedAssessment>['snapshot']>;
  identities: ReturnType<BoundedIdentityRegistry['snapshot']>;
  transport: EffectiveTransportObservation;
  remoteBrain: Readonly<{
    componentId: string | null;
    state: string;
    generatedAtMs: number | null;
    ageMs: number | null;
    truthLabel: string | null;
    driftState: string;
    blockingReasonCount: number;
    modelVersionCount: number;
  }>;
  recording: Readonly<CanonicalRecordingHealthSnapshot>;
  counters: Readonly<{
    invalid: number;
    queued: number;
    dispatched: number;
    ownerRejected: number;
    ownerFailures: number;
    nonActionable: number;
    duplicates: number;
    conflicts: number;
    staleRevisions: number;
    dropped: number;
    expired: number;
    timedOut: number;
    directionRejected: number;
    healthUpdates: number;
  }>;
}

interface QueuedAssessment {
  value: JsonRecord;
  fingerprintSha256: string;
  localReceiptTimeMs: number;
  byteLength: number;
}

interface RegimeProjection {
  state: 'PRESENT' | 'UNKNOWN' | 'UNSUPPORTED';
  probabilities: Readonly<Record<string, number>>;
}

interface SemanticAssessment {
  assessmentId: string;
  revision: number;
  effectiveExpiryMs: number;
  identity: IdentityObservation;
  regime: RegimeProjection;
  reasonCodes: readonly string[];
}

const CODE = /^[A-Z][A-Z0-9_]{0,99}$/;
const LABEL = /^[A-Za-z0-9_.:\-]{1,128}$/;
const REQUIRED_COST_KEYS = ['fee', 'spread', 'slippage', 'funding', 'borrow', 'latency', 'recovery'] as const;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function sortedUniqueLabels(values: readonly string[], name: string): readonly string[] {
  if (!Array.isArray(values) || values.length > 256) throw new TypeError(`${name} must be a bounded string array`);
  const result = [...new Set(values)];
  if (result.some((value) => typeof value !== 'string' || !LABEL.test(value))) {
    throw new TypeError(`${name} contains an invalid label`);
  }
  return Object.freeze(result.sort());
}

function exactConfig(input: EdgeAssessmentBridgeConfig): Readonly<EdgeAssessmentBridgeConfig> {
  if (!isRecord(input)) throw new TypeError('assessment bridge config must be a plain object');
  const allowed = new Set([
    'adapterPolicy', 'expectedRemoteComponentId', 'queueCapacity', 'maximumQueueEntryBytes', 'maximumQueueRetainedBytes',
    'identityCapacity', 'identityRetentionGraceMs', 'maximumDwellMs', 'heartbeatTtlMs',
    'requestTimeoutMs', 'maximumFutureSkewMs', 'queuePressureRatio',
    'supportedStrategyFamilies', 'supportedRegimeKeys',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new TypeError('assessment bridge config contains an unsupported field');
  }
  if (input.adapterPolicy !== 'L_ADAPTER_POLICY_V1') throw new TypeError('adapterPolicy must be L_ADAPTER_POLICY_V1');
  if (typeof input.expectedRemoteComponentId !== 'string' || !LABEL.test(input.expectedRemoteComponentId)) {
    throw new TypeError('expectedRemoteComponentId must be a bounded protocol label');
  }
  const queueCapacity = safeInteger(input.queueCapacity, 'queueCapacity', 1, 100_000);
  const maximumQueueEntryBytes = safeInteger(input.maximumQueueEntryBytes, 'maximumQueueEntryBytes', 1, 64 * 1024 * 1024);
  const maximumQueueRetainedBytes = safeInteger(
    input.maximumQueueRetainedBytes,
    'maximumQueueRetainedBytes',
    maximumQueueEntryBytes,
    512 * 1024 * 1024,
  );
  const identityCapacity = safeInteger(input.identityCapacity, 'identityCapacity', 1, 1_000_000);
  const identityRetentionGraceMs = safeInteger(input.identityRetentionGraceMs, 'identityRetentionGraceMs', 0, 30 * 24 * 60 * 60_000);
  const maximumDwellMs = safeInteger(input.maximumDwellMs, 'maximumDwellMs', 1, 24 * 60 * 60_000);
  const heartbeatTtlMs = safeInteger(input.heartbeatTtlMs, 'heartbeatTtlMs', 1, 24 * 60 * 60_000);
  const requestTimeoutMs = safeInteger(input.requestTimeoutMs, 'requestTimeoutMs', 1, 10 * 60_000);
  const maximumFutureSkewMs = safeInteger(input.maximumFutureSkewMs, 'maximumFutureSkewMs', 0, 60_000);
  if (typeof input.queuePressureRatio !== 'number' || !Number.isFinite(input.queuePressureRatio)
    || input.queuePressureRatio <= 0 || input.queuePressureRatio >= 1) {
    throw new TypeError('queuePressureRatio must be finite and in (0, 1)');
  }
  return Object.freeze({
    adapterPolicy: input.adapterPolicy,
    expectedRemoteComponentId: input.expectedRemoteComponentId,
    queueCapacity,
    maximumQueueEntryBytes,
    maximumQueueRetainedBytes,
    identityCapacity,
    identityRetentionGraceMs,
    maximumDwellMs,
    heartbeatTtlMs,
    requestTimeoutMs,
    maximumFutureSkewMs,
    queuePressureRatio: input.queuePressureRatio,
    supportedStrategyFamilies: sortedUniqueLabels(input.supportedStrategyFamilies, 'supportedStrategyFamilies'),
    supportedRegimeKeys: sortedUniqueLabels(input.supportedRegimeKeys, 'supportedRegimeKeys'),
  });
}

function deepFreezeJson<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const child of value) deepFreezeJson(child);
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeJson(child);
  }
  return Object.freeze(value);
}

function detachedRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) throw new TypeError('expected a protocol record');
  return deepFreezeJson(JSON.parse(canonicalJson(value)) as Record<string, unknown>);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new TypeError(`schema-validated ${key} is not a string`);
  return value;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`schema-validated ${key} is not a safe integer`);
  }
  return value;
}

function nullableNumberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === null) return null;
  return numberField(record, key);
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new TypeError('schema-validated value is not a string array');
  }
  return value;
}

function protocolErrorCode(error: ProtocolErrorEnvelope): string {
  return typeof error.code === 'string' && CODE.test(error.code) ? error.code : 'PROTOCOL_INVALID';
}

function disposition(
  kind: BridgeDispositionKind,
  assessmentId: string | null,
  revision: number | null,
  reasonCodes: readonly string[],
  ownerReference: string | null = null,
): Readonly<BridgeDisposition> {
  return Object.freeze({ kind, assessmentId, revision, reasonCodes: Object.freeze([...reasonCodes]), ownerReference });
}

function validOwnerResult(value: unknown): value is AdvisoryOwnerObservationResult {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 3 || keys.some((key) => !['state', 'ownerReference', 'reasonCode'].includes(key))) return false;
  if (typeof value.reasonCode !== 'string' || !CODE.test(value.reasonCode)) return false;
  if (value.state === 'OBSERVED') {
    return typeof value.ownerReference === 'string' && LABEL.test(value.ownerReference);
  }
  return value.state === 'REJECTED'
    && (value.ownerReference === null || (typeof value.ownerReference === 'string' && LABEL.test(value.ownerReference)));
}

function safeRecordingSnapshot(value: unknown): Readonly<CanonicalRecordingHealthSnapshot> {
  if (!isRecord(value)) throw new TypeError('recording health snapshot must be a plain object');
  const keys = Object.keys(value);
  const allowed = ['state', 'observedAtMs', 'gapCount', 'quotaState', 'storagePressure'];
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new TypeError('recording health snapshot fields are invalid');
  }
  if (!['RUNNING', 'DEGRADED', 'STALE', 'FAILED', 'UNKNOWN'].includes(value.state as string)
    || !['OK', 'PRESSURED', 'EXHAUSTED', 'UNKNOWN'].includes(value.quotaState as string)
    || !['OK', 'PRESSURED', 'FULL', 'UNKNOWN'].includes(value.storagePressure as string)) {
    throw new TypeError('recording health snapshot enum is invalid');
  }
  if (value.observedAtMs !== null && (!Number.isSafeInteger(value.observedAtMs) || (value.observedAtMs as number) < 0)) {
    throw new TypeError('recording health observedAtMs is invalid');
  }
  if (value.gapCount !== null && (!Number.isSafeInteger(value.gapCount) || (value.gapCount as number) < 0)) {
    throw new TypeError('recording health gapCount is invalid');
  }
  return Object.freeze({
    state: value.state as CanonicalRecordingHealthSnapshot['state'],
    observedAtMs: value.observedAtMs as number | null,
    gapCount: value.gapCount as number | null,
    quotaState: value.quotaState as CanonicalRecordingHealthSnapshot['quotaState'],
    storagePressure: value.storagePressure as CanonicalRecordingHealthSnapshot['storagePressure'],
  });
}

/**
 * Additive advisory bridge only. It has no proposal, Capital, Risk, control,
 * execution, reconciliation, Binance, or persistence dependency.
 */
export class EdgeAssessmentBridge {
  readonly #client: EdgeProtocolV1Client;
  readonly #clock: LiveEdgeClock;
  readonly #config: Readonly<EdgeAssessmentBridgeConfig>;
  readonly #ports: Readonly<Record<string, AdvisoryStrategyPort>>;
  readonly #recordingHealth: CanonicalRecordingHealthPort | null;
  readonly #queue: BoundedInboundQueue<QueuedAssessment>;
  readonly #identities: BoundedIdentityRegistry;
  #transport: Readonly<LocalTransportObservation> | null = null;
  #remoteHealth: JsonRecord | null = null;
  #lastNowMs: number | null = null;
  #invalid = 0;
  #queued = 0;
  #dispatched = 0;
  #ownerRejected = 0;
  #ownerFailures = 0;
  #nonActionable = 0;
  #duplicates = 0;
  #conflicts = 0;
  #staleRevisions = 0;
  #dropped = 0;
  #expired = 0;
  #timedOut = 0;
  #directionRejected = 0;
  #healthUpdates = 0;

  constructor(input: {
    client: EdgeProtocolV1Client;
    clock: LiveEdgeClock;
    config: EdgeAssessmentBridgeConfig;
    strategyPorts: Readonly<Record<string, AdvisoryStrategyPort>>;
    recordingHealth?: CanonicalRecordingHealthPort | null;
  }) {
    if (!isRecord(input)) throw new TypeError('assessment bridge constructor input must be a plain object');
    if (typeof input.client?.decode !== 'function') throw new TypeError('assessment bridge client is required');
    if (typeof input.clock?.nowMs !== 'function') throw new TypeError('assessment bridge clock is required');
    this.#config = exactConfig(input.config);
    if (!isRecord(input.strategyPorts)) throw new TypeError('strategyPorts must be a plain object');
    const portKeys = Object.keys(input.strategyPorts).sort();
    if (canonicalJson(portKeys) !== canonicalJson(this.#config.supportedStrategyFamilies)) {
      throw new TypeError('strategyPorts must exactly match supportedStrategyFamilies');
    }
    for (const port of Object.values(input.strategyPorts)) {
      if (typeof port?.observeAssessment !== 'function') throw new TypeError('strategy advisory port is invalid');
    }
    if (input.recordingHealth !== undefined && input.recordingHealth !== null
      && typeof input.recordingHealth.snapshot !== 'function') {
      throw new TypeError('recording health port is invalid');
    }
    this.#client = input.client;
    this.#clock = input.clock;
    this.#ports = Object.freeze({ ...input.strategyPorts });
    this.#recordingHealth = input.recordingHealth ?? null;
    this.#queue = new BoundedInboundQueue<QueuedAssessment>(
      this.#config.queueCapacity,
      this.#config.maximumQueueEntryBytes,
      this.#config.maximumQueueRetainedBytes,
    );
    this.#identities = new BoundedIdentityRegistry(this.#config.identityCapacity);
  }

  observeTransport(observation: LocalTransportObservation): Readonly<EffectiveTransportObservation> {
    const nowMs = this.#now();
    const effective = evaluateLocalTransport(observation, nowMs, this.#config.requestTimeoutMs);
    this.#transport = deepFreezeJson(JSON.parse(canonicalJson(observation)) as LocalTransportObservation);
    return effective;
  }

  ingest(frame: string | Uint8Array): Readonly<BridgeDisposition> {
    const nowMs = this.#now();
    const decoded = this.#client.decode(frame, nowMs);
    if (!decoded.ok) {
      this.#invalid += 1;
      return disposition('INVALID', null, null, [protocolErrorCode(decoded.error)]);
    }
    if (decoded.envelope.schema === 'EdgeBrainHealthV1') {
      return this.#ingestHealth(decoded.envelope.value, decoded.envelope.fingerprintSha256, nowMs);
    }
    if (decoded.envelope.schema !== 'EdgeAssessmentEnvelopeV1') {
      this.#directionRejected += 1;
      return disposition('DIRECTION_REJECTED', null, decoded.envelope.revision, ['INBOUND_SCHEMA_DIRECTION_REJECTED']);
    }
    const semantic = this.#assess(
      decoded.envelope.value,
      decoded.envelope.fingerprintSha256,
      decoded.envelope.localReceiptTimeMs,
      nowMs,
    );
    const preflight = this.#identities.preflight(semantic.identity, nowMs);
    if (semantic.reasonCodes.includes('ASSESSMENT_EXPIRED')
      || semantic.reasonCodes.includes('ECONOMIC_ASSUMPTIONS_EXPIRED')) {
      // Observing a schema-valid higher revision invalidates older queued work
      // even when the new revision is already non-actionable. A new unrelated
      // expired identity is deliberately not retained.
      if (preflight.kind === 'NEW_REVISION') {
        this.#identities.record(semantic.identity, preflight.kind, nowMs);
      }
      this.#expired += 1;
      return disposition('NON_ACTIONABLE', semantic.assessmentId, semantic.revision, semantic.reasonCodes);
    }
    if (preflight.kind === 'DUPLICATE_NOOP') {
      this.#duplicates += 1;
      return disposition('DUPLICATE_NOOP', semantic.assessmentId, semantic.revision, [preflight.reasonCode]);
    }
    if (preflight.kind === 'IDENTITY_CONFLICT') {
      this.#conflicts += 1;
      return disposition('IDENTITY_CONFLICT', semantic.assessmentId, semantic.revision, [preflight.reasonCode]);
    }
    if (preflight.kind === 'REVISION_STALE') {
      this.#staleRevisions += 1;
      return disposition('REVISION_STALE', semantic.assessmentId, semantic.revision, [preflight.reasonCode]);
    }
    if (preflight.kind === 'CAPACITY_BLOCKED') {
      return disposition('IDENTITY_CAPACITY_BLOCKED', semantic.assessmentId, semantic.revision, [preflight.reasonCode]);
    }
    if (semantic.reasonCodes.length > 0) {
      this.#identities.record(semantic.identity, preflight.kind, nowMs);
      this.#nonActionable += 1;
      return disposition('NON_ACTIONABLE', semantic.assessmentId, semantic.revision, semantic.reasonCodes);
    }
    const queued: QueuedAssessment = Object.freeze({
      value: decoded.envelope.value,
      fingerprintSha256: decoded.envelope.fingerprintSha256,
      localReceiptTimeMs: decoded.envelope.localReceiptTimeMs,
      byteLength: decoded.envelope.byteLength,
    });
    const entry: InboundQueueEntry<QueuedAssessment> = {
      id: `${semantic.assessmentId}:${semantic.revision}`,
      mode: 'SEQUENCE_SENSITIVE',
      coalescingKey: null,
      receiveTimeMs: nowMs,
      value: queued,
    };
    const offered = this.#queue.offer(entry);
    if (!offered.accepted) {
      // A dropped higher revision must still supersede already-queued older
      // work. Otherwise backpressure could make revision N+1 disappear while
      // allowing stale revision N to reach the canonical owner.
      if (preflight.kind === 'NEW_REVISION') {
        this.#identities.record(semantic.identity, preflight.kind, nowMs);
      }
      this.#dropped += 1;
      return disposition('BACKPRESSURE_DROPPED', semantic.assessmentId, semantic.revision, ['ASSESSMENT_QUEUE_BACKPRESSURE']);
    }
    this.#identities.record(semantic.identity, preflight.kind, nowMs);
    this.#queued += 1;
    return disposition('QUEUED', semantic.assessmentId, semantic.revision, ['ADVISORY_ASSESSMENT_QUEUED']);
  }

  drainOne(): Readonly<BridgeDisposition> {
    const nowMs = this.#now();
    const queued = this.#queue.shift();
    if (queued === null) return disposition('QUEUE_EMPTY', null, null, ['ASSESSMENT_QUEUE_EMPTY']);
    const value = queued.value.value;
    const semantic = this.#assess(value, queued.value.fingerprintSha256, queued.value.localReceiptTimeMs, nowMs);
    if (semantic.reasonCodes.length > 0) {
      if (semantic.reasonCodes.includes('ASSESSMENT_EXPIRED')
        || semantic.reasonCodes.includes('ECONOMIC_ASSUMPTIONS_EXPIRED')) this.#expired += 1;
      else this.#nonActionable += 1;
      return disposition('NON_ACTIONABLE', semantic.assessmentId, semantic.revision, semantic.reasonCodes);
    }
    if (nowMs - queued.value.localReceiptTimeMs >= this.#config.maximumDwellMs) {
      this.#timedOut += 1;
      return disposition('NON_ACTIONABLE', semantic.assessmentId, semantic.revision, ['ASSESSMENT_QUEUE_DWELL_TIMEOUT']);
    }
    // Expiry and dwell are evaluated before consulting identity memory. At an
    // exact expiry boundary the registry may legitimately prune, but that must
    // never obscure the stronger fail-closed expiry disposition.
    const currentIdentity = this.#identities.currentStatus(semantic.identity, nowMs);
    if (currentIdentity === 'REVISION_STALE') {
      this.#staleRevisions += 1;
      return disposition('REVISION_STALE', semantic.assessmentId, semantic.revision, ['ASSESSMENT_SUPERSEDED_BEFORE_DISPATCH']);
    }
    if (currentIdentity === 'IDENTITY_CONFLICT') {
      this.#conflicts += 1;
      return disposition('IDENTITY_CONFLICT', semantic.assessmentId, semantic.revision, ['ASSESSMENT_IDENTITY_CONFLICT']);
    }
    if (currentIdentity === 'MISSING') {
      this.#nonActionable += 1;
      return disposition('NON_ACTIONABLE', semantic.assessmentId, semantic.revision, ['ASSESSMENT_IDENTITY_UNAVAILABLE']);
    }
    const dispatchGateReasons = this.#advisoryGateReasons(nowMs);
    if (dispatchGateReasons.length > 0) {
      this.#nonActionable += 1;
      return disposition('NON_ACTIONABLE', semantic.assessmentId, semantic.revision, dispatchGateReasons);
    }
    const family = stringField(value, 'strategyFamily');
    const port = this.#ports[family];
    if (port === undefined) {
      this.#nonActionable += 1;
      return disposition('NON_ACTIONABLE', semantic.assessmentId, semantic.revision, ['STRATEGY_FAMILY_UNSUPPORTED']);
    }
    const observation = this.#observation(value, queued.value, semantic);
    let owner: unknown;
    try {
      owner = port.observeAssessment(observation);
    } catch {
      this.#ownerFailures += 1;
      return disposition('OWNER_PORT_FAILURE', semantic.assessmentId, semantic.revision, ['ADVISORY_OWNER_PORT_FAILED']);
    }
    if (!validOwnerResult(owner)) {
      this.#ownerFailures += 1;
      return disposition('OWNER_PORT_FAILURE', semantic.assessmentId, semantic.revision, ['ADVISORY_OWNER_RESULT_INVALID']);
    }
    if (owner.state === 'REJECTED') {
      this.#ownerRejected += 1;
      return disposition('OWNER_REJECTED', semantic.assessmentId, semantic.revision, [owner.reasonCode], owner.ownerReference);
    }
    this.#dispatched += 1;
    return disposition(
      'DISPATCHED_TO_CANONICAL_STRATEGY',
      semantic.assessmentId,
      semantic.revision,
      [owner.reasonCode],
      owner.ownerReference,
    );
  }

  snapshot(): Readonly<EdgeAssessmentBridgeSnapshot> {
    const nowMs = this.#now();
    const queue = this.#queue.snapshot();
    const transport = evaluateLocalTransport(this.#transport, nowMs, this.#config.requestTimeoutMs);
    const recording = this.#recordingSnapshot(nowMs);
    const reasons: string[] = [];
    const remote = this.#remoteHealth;
    let remoteState = 'UNKNOWN';
    let componentId: string | null = null;
    let generatedAtMs: number | null = null;
    let ageMs: number | null = null;
    let truthLabel: string | null = null;
    let driftState = 'UNKNOWN';
    let blockingReasonCount = 0;
    let modelVersionCount = 0;
    let state: EdgeAssessmentBridgeSnapshot['state'] = 'UNKNOWN';

    const advisoryGateReasons = this.#advisoryGateReasons(nowMs);
    reasons.push(...advisoryGateReasons);
    if (remote === null) {
      // The readiness reason is supplied by #advisoryGateReasons. This branch
      // only preserves the bounded UNKNOWN projection fields.
    } else {
      componentId = typeof remote.componentId === 'string' ? remote.componentId : null;
      generatedAtMs = typeof remote.generatedAtMs === 'number' ? remote.generatedAtMs : null;
      remoteState = typeof remote.state === 'string' ? remote.state : 'UNKNOWN';
      truthLabel = typeof remote.truthLabel === 'string' ? remote.truthLabel : null;
      driftState = typeof remote.driftState === 'string' ? remote.driftState : 'UNKNOWN';
      blockingReasonCount = Array.isArray(remote.blockingReasons) ? remote.blockingReasons.length : 0;
      modelVersionCount = isRecord(remote.modelVersions) ? Object.keys(remote.modelVersions).length : 0;
      if (generatedAtMs !== null) ageMs = nowMs - generatedAtMs;
    }
    const queuePressure = Math.max(queue.depth / queue.capacity, queue.retainedBytes / queue.maximumRetainedBytes);
    if (queuePressure >= this.#config.queuePressureRatio) reasons.push('ASSESSMENT_QUEUE_PRESSURED');
    if (queue.resyncRequired) reasons.push('ASSESSMENT_QUEUE_RESYNC_REQUIRED');
    const researchRecordingReady = recording.state === 'RUNNING'
      && recording.observedAtMs !== null
      && recording.gapCount === 0
      && recording.quotaState === 'OK'
      && recording.storagePressure === 'OK';
    if (!researchRecordingReady) {
      reasons.push('CANONICAL_RECORDING_DEGRADED');
    }

    if (transport.state === 'FAILED') state = 'FAILED';
    else if (transport.state === 'DISCONNECTED' || transport.state === 'TIMED_OUT') state = 'BLOCKED';
    else if (remote !== null && ageMs !== null && ageMs >= this.#config.heartbeatTtlMs) state = 'STALE';
    else if (remoteState === 'FAILED') state = 'FAILED';
    else if (remoteState === 'STALE') state = 'STALE';
    else if (remoteState === 'UNKNOWN' || remote === null) state = 'UNKNOWN';
    else if (reasons.length > 0) state = 'DEGRADED';
    else state = 'RUNNING';

    const advisoryReady = advisoryGateReasons.length === 0
      && queuePressure < this.#config.queuePressureRatio
      && !queue.resyncRequired;
    return deepFreezeJson({
      adapterPolicy: 'L_ADAPTER_POLICY_V1' as const,
      state,
      advisoryReady,
      researchRecordingReady,
      reasonCodes: [...new Set(reasons)].sort(),
      queue,
      identities: this.#identities.snapshot(),
      transport,
      remoteBrain: {
        componentId,
        state: remoteState,
        generatedAtMs,
        ageMs,
        truthLabel,
        driftState,
        blockingReasonCount,
        modelVersionCount,
      },
      recording,
      counters: {
        invalid: this.#invalid,
        queued: this.#queued,
        dispatched: this.#dispatched,
        ownerRejected: this.#ownerRejected,
        ownerFailures: this.#ownerFailures,
        nonActionable: this.#nonActionable,
        duplicates: this.#duplicates,
        conflicts: this.#conflicts,
        staleRevisions: this.#staleRevisions,
        dropped: this.#dropped,
        expired: this.#expired,
        timedOut: this.#timedOut,
        directionRejected: this.#directionRejected,
        healthUpdates: this.#healthUpdates,
      },
    });
  }

  #advisoryGateReasons(nowMs: number): readonly string[] {
    const reasons: string[] = [];
    const transport = evaluateLocalTransport(this.#transport, nowMs, this.#config.requestTimeoutMs);
    if (transport.state !== 'CONNECTED') reasons.push(transport.reasonCode);

    const remote = this.#remoteHealth;
    if (remote === null) {
      reasons.push('REMOTE_HEARTBEAT_UNKNOWN');
      return Object.freeze(reasons);
    }
    if (remote.componentId !== this.#config.expectedRemoteComponentId) {
      reasons.push('REMOTE_COMPONENT_ID_UNEXPECTED');
    }
    const generatedAtMs = typeof remote.generatedAtMs === 'number' ? remote.generatedAtMs : null;
    const ageMs = generatedAtMs === null ? null : nowMs - generatedAtMs;
    if (ageMs === null || ageMs < -this.#config.maximumFutureSkewMs) {
      reasons.push('REMOTE_HEARTBEAT_CLOCK_SKEWED');
    } else if (ageMs >= this.#config.heartbeatTtlMs) {
      reasons.push('REMOTE_HEARTBEAT_STALE');
    }
    const remoteState = typeof remote.state === 'string' ? remote.state : 'UNKNOWN';
    const driftState = typeof remote.driftState === 'string' ? remote.driftState : 'UNKNOWN';
    const truthLabel = typeof remote.truthLabel === 'string' ? remote.truthLabel : 'UNKNOWN';
    if (remoteState !== 'OK') reasons.push(`REMOTE_STATE_${remoteState}`);
    if (driftState !== 'STABLE') reasons.push(`REMOTE_DRIFT_${driftState}`);
    if (truthLabel !== 'LIVE') reasons.push(`REMOTE_TRUTH_${truthLabel}`);
    if (!Array.isArray(remote.blockingReasons) || remote.blockingReasons.length > 0) {
      reasons.push('REMOTE_BLOCKERS_PRESENT');
    }
    if (!isRecord(remote.modelVersions) || Object.keys(remote.modelVersions).length === 0) {
      reasons.push('REMOTE_MODEL_LINEAGE_UNKNOWN');
    }
    if (typeof remote.lastSuccessMs !== 'number') {
      reasons.push('REMOTE_LAST_SUCCESS_UNKNOWN');
    } else {
      const successAgeMs = nowMs - remote.lastSuccessMs;
      if (generatedAtMs === null
        || remote.lastSuccessMs > generatedAtMs + this.#config.maximumFutureSkewMs) {
        reasons.push('REMOTE_LAST_SUCCESS_TIME_ORDER_INVALID');
      } else if (successAgeMs < -this.#config.maximumFutureSkewMs) {
        reasons.push('REMOTE_LAST_SUCCESS_CLOCK_SKEWED');
      } else if (successAgeMs >= this.#config.heartbeatTtlMs) {
        reasons.push('REMOTE_LAST_SUCCESS_STALE');
      }
    }
    return Object.freeze([...new Set(reasons)]);
  }

  #ingestHealth(value: JsonRecord, fingerprint: string, nowMs: number): Readonly<BridgeDisposition> {
    const componentId = stringField(value, 'componentId');
    const revision = numberField(value, 'revision');
    if (componentId !== this.#config.expectedRemoteComponentId) {
      this.#directionRejected += 1;
      return disposition('DIRECTION_REJECTED', null, revision, ['REMOTE_COMPONENT_ID_UNEXPECTED']);
    }
    const generatedAtMs = numberField(value, 'generatedAtMs');
    const retainUntilMs = generatedAtMs + this.#config.heartbeatTtlMs;
    if (!Number.isSafeInteger(retainUntilMs) || retainUntilMs <= nowMs) {
      this.#invalid += 1;
      return disposition('INVALID', null, revision, ['REMOTE_HEARTBEAT_EXPIRED']);
    }
    const observation: IdentityObservation = {
      namespace: 'health',
      id: componentId,
      revision,
      fingerprint,
      immutableFingerprint: sha256(canonicalJson({ componentId })),
      retainUntilMs,
    };
    const preflight = this.#identities.preflight(observation, nowMs);
    if (preflight.kind === 'DUPLICATE_NOOP') {
      this.#duplicates += 1;
      return disposition('DUPLICATE_NOOP', null, revision, [preflight.reasonCode]);
    }
    if (preflight.kind === 'IDENTITY_CONFLICT') {
      // Conflicting evidence for the singleton expected remote poisons the
      // identity. Never keep serving the previously healthy snapshot through
      // that ambiguity.
      this.#remoteHealth = null;
      this.#conflicts += 1;
      return disposition('IDENTITY_CONFLICT', null, revision, [preflight.reasonCode]);
    }
    if (preflight.kind === 'REVISION_STALE') {
      this.#staleRevisions += 1;
      return disposition('REVISION_STALE', null, revision, [preflight.reasonCode]);
    }
    if (preflight.kind === 'CAPACITY_BLOCKED') {
      return disposition('IDENTITY_CAPACITY_BLOCKED', null, revision, [preflight.reasonCode]);
    }
    this.#identities.record(observation, preflight.kind, nowMs);
    this.#remoteHealth = value;
    this.#healthUpdates += 1;
    return disposition('REMOTE_HEALTH_UPDATED', null, revision, ['REMOTE_HEALTH_EVIDENCE_UPDATED']);
  }

  #assess(value: JsonRecord, fingerprint: string, localReceiptTimeMs: number, nowMs: number): SemanticAssessment {
    const assessmentId = stringField(value, 'assessmentId');
    const revision = numberField(value, 'revision');
    const receiveTimeMs = numberField(value, 'receiveTimeMs');
    const generationTimeMs = numberField(value, 'generationTimeMs');
    const expiryTimeMs = numberField(value, 'expiryTimeMs');
    const eventTimeMs = nullableNumberField(value, 'eventTimeMs');
    const economic = value.economicAssumptionContext as Record<string, unknown>;
    const economicAsOfMs = numberField(economic, 'asOfMs');
    const economicExpiryMs = numberField(economic, 'expiresAtMs');
    const effectiveExpiryMs = Math.min(expiryTimeMs, economicExpiryMs);
    const family = stringField(value, 'strategyFamily');
    const hypothesisId = stringField(value, 'hypothesisId');
    const regime = this.#regime(value.regimeProbabilities);
    const reasons: string[] = [];

    if (nowMs >= expiryTimeMs) reasons.push('ASSESSMENT_EXPIRED');
    if (nowMs >= economicExpiryMs) reasons.push('ECONOMIC_ASSUMPTIONS_EXPIRED');
    if (generationTimeMs > expiryTimeMs || economicAsOfMs > economicExpiryMs
      || receiveTimeMs > generationTimeMs + this.#config.maximumFutureSkewMs
      || economicAsOfMs > generationTimeMs + this.#config.maximumFutureSkewMs
      || (eventTimeMs !== null && (eventTimeMs > receiveTimeMs + this.#config.maximumFutureSkewMs
        || eventTimeMs > generationTimeMs + this.#config.maximumFutureSkewMs))) {
      reasons.push('ASSESSMENT_TIME_ORDER_INVALID');
    }
    if (generationTimeMs > nowMs + this.#config.maximumFutureSkewMs
      || receiveTimeMs > nowMs + this.#config.maximumFutureSkewMs
      || (eventTimeMs !== null && eventTimeMs > nowMs + this.#config.maximumFutureSkewMs)
      || economicAsOfMs > nowMs + this.#config.maximumFutureSkewMs) {
      reasons.push('ASSESSMENT_CLOCK_SKEWED');
    }
    const sourceQuality = value.sourceQuality as Record<string, unknown>;
    if (sourceQuality.freshness !== 'FRESH') reasons.push(`SOURCE_QUALITY_${String(sourceQuality.freshness)}`);
    if (sourceQuality.completeness !== 'COMPLETE') reasons.push(`SOURCE_COMPLETENESS_${String(sourceQuality.completeness)}`);
    if (sourceQuality.gapCount !== 0) reasons.push('SOURCE_SEQUENCE_GAPPED');
    if (sourceQuality.duplicate === true) reasons.push('SOURCE_DUPLICATE');
    if (sourceQuality.reconstructed === true) reasons.push('SOURCE_RECONSTRUCTED');
    if (value.oodState !== 'IN_DISTRIBUTION') reasons.push(`ASSESSMENT_OOD_${String(value.oodState)}`);
    if (value.driftState !== 'STABLE') reasons.push(`ASSESSMENT_DRIFT_${String(value.driftState)}`);
    const netExpectedValue = value.netExpectedValue as Record<string, unknown>;
    if (netExpectedValue.state !== 'ESTIMATED' || !isRecord(netExpectedValue.quantiles)
      || Object.keys(netExpectedValue.quantiles).length === 0) reasons.push('NET_EXPECTED_VALUE_UNKNOWN');
    const costs = value.costEstimates;
    if (!isRecord(costs) || REQUIRED_COST_KEYS.some((key) => typeof costs[key] !== 'string')) {
      reasons.push('ECONOMIC_COSTS_INCOMPLETE');
    }
    const evidence = value.evidence as Record<string, unknown>;
    if (stringArray(evidence.conflicting).length > 0) reasons.push('ASSESSMENT_CONFLICTING_EVIDENCE');
    if (stringArray(evidence.missing).length > 0) reasons.push('ASSESSMENT_EVIDENCE_MISSING');
    if (stringArray(economic.missingFields).length > 0) reasons.push('ECONOMIC_ASSUMPTIONS_MISSING');
    if (stringArray(economic.sourceSnapshotIds).length === 0) reasons.push('ECONOMIC_SOURCE_SNAPSHOTS_MISSING');
    if (economic.state !== 'LIVE') reasons.push('ECONOMIC_CONTEXT_NOT_LIVE');
    if (!Array.isArray(value.predictions) || value.predictions.length === 0) reasons.push('ASSESSMENT_PREDICTIONS_MISSING');
    if (!Array.isArray(value.parentEvidenceIds) || value.parentEvidenceIds.length === 0) reasons.push('PARENT_EVIDENCE_MISSING');
    const borrow = isRecord(economic.borrow) ? economic.borrow : null;
    if (borrow === null || borrow.availability !== 'AVAILABLE' || typeof borrow.quantity !== 'string'
      || typeof borrow.rateHourly !== 'string' || typeof borrow.interestConvention !== 'string'
      || !Number.isSafeInteger(borrow.expiresAtMs)) {
      reasons.push('BORROW_ASSUMPTION_UNAVAILABLE');
    } else if ((borrow.expiresAtMs as number) <= nowMs) {
      reasons.push('BORROW_ASSUMPTION_EXPIRED');
    }
    const funding = isRecord(economic.funding) ? economic.funding : null;
    if (funding === null || typeof funding.rate !== 'string'
      || !Number.isSafeInteger(funding.intervalHours) || typeof funding.source !== 'string'
      || !Number.isSafeInteger(funding.nextFundingTimeMs)) {
      reasons.push('FUNDING_ASSUMPTION_UNKNOWN');
    } else if ((funding.nextFundingTimeMs as number) <= nowMs) {
      reasons.push('FUNDING_ASSUMPTION_EXPIRED');
    }
    const feeTier = isRecord(economic.feeTier) ? economic.feeTier : null;
    if (feeTier === null || typeof feeTier.source !== 'string'
      || typeof feeTier.makerBps !== 'string' || typeof feeTier.takerBps !== 'string') {
      reasons.push('FEE_ASSUMPTION_UNKNOWN');
    }
    const spreadSlippage = isRecord(economic.spreadSlippageModel) ? economic.spreadSlippageModel : null;
    if (spreadSlippage === null || typeof spreadSlippage.name !== 'string' || typeof spreadSlippage.version !== 'string') {
      reasons.push('SPREAD_SLIPPAGE_MODEL_UNKNOWN');
    }
    if (!Number.isSafeInteger(economic.latencyScenarioMs)) reasons.push('LATENCY_SCENARIO_UNKNOWN');
    if (typeof economic.recoveryCostScenario !== 'string') reasons.push('RECOVERY_COST_SCENARIO_UNKNOWN');
    if (value.advisoryAction !== 'PROPOSE_CONSIDERATION') reasons.push(`ADVISORY_ACTION_${String(value.advisoryAction)}`);
    if (!this.#config.supportedStrategyFamilies.includes(family)) reasons.push('STRATEGY_FAMILY_UNSUPPORTED');
    if (regime.state === 'UNKNOWN') reasons.push('REGIME_POSTURE_UNKNOWN');
    if (regime.state === 'UNSUPPORTED') reasons.push('REGIME_POSTURE_UNSUPPORTED');

    const retainUntilMs = effectiveExpiryMs + this.#config.identityRetentionGraceMs;
    if (!Number.isSafeInteger(retainUntilMs)) reasons.push('IDENTITY_RETENTION_OVERFLOW');
    const immutableFingerprint = sha256(canonicalJson({
      strategyFamily: family,
      hypothesisId,
      instrumentGraph: value.instrumentGraph,
    }));
    return Object.freeze({
      assessmentId,
      revision,
      effectiveExpiryMs,
      identity: Object.freeze({
        namespace: 'assessment',
        id: assessmentId,
        revision,
        fingerprint,
        immutableFingerprint,
        retainUntilMs: Number.isSafeInteger(retainUntilMs) ? retainUntilMs : effectiveExpiryMs,
      }),
      regime,
      reasonCodes: Object.freeze([...new Set(reasons)]),
    });
  }

  #regime(value: unknown): RegimeProjection {
    if (!isRecord(value) || Object.keys(value).length === 0) {
      return Object.freeze({ state: 'UNKNOWN', probabilities: Object.freeze({}) });
    }
    const probabilities: Record<string, number> = {};
    let unsupported = false;
    for (const key of Object.keys(value).sort()) {
      const probability = value[key];
      if (typeof probability !== 'number' || !Number.isFinite(probability)) continue;
      probabilities[key] = probability;
      if (!this.#config.supportedRegimeKeys.includes(key)) unsupported = true;
    }
    return deepFreezeJson({
      state: unsupported ? 'UNSUPPORTED' as const : 'PRESENT' as const,
      probabilities,
    });
  }

  #observation(value: JsonRecord, queued: QueuedAssessment, semantic: SemanticAssessment): Readonly<AdvisoryAssessmentObservation> {
    const economic = value.economicAssumptionContext as Record<string, unknown>;
    return deepFreezeJson({
      assessmentId: semantic.assessmentId,
      revision: semantic.revision,
      traceId: stringField(value, 'traceId'),
      strategyFamily: stringField(value, 'strategyFamily'),
      hypothesisId: stringField(value, 'hypothesisId'),
      instrumentGraph: detachedRecord(value.instrumentGraph),
      parentEvidenceIds: [...stringArray(value.parentEvidenceIds)],
      eventTimeMs: nullableNumberField(value, 'eventTimeMs'),
      peerReceiveTimeMs: numberField(value, 'receiveTimeMs'),
      generationTimeMs: numberField(value, 'generationTimeMs'),
      expiryTimeMs: numberField(value, 'expiryTimeMs'),
      economicExpiryTimeMs: numberField(economic, 'expiresAtMs'),
      localReceiptTimeMs: queued.localReceiptTimeMs,
      protocolFingerprintSha256: queued.fingerprintSha256,
      lineage: detachedRecord(value.lineage),
      sourceQuality: detachedRecord(value.sourceQuality),
      regime: semantic.regime,
    });
  }

  #recordingSnapshot(nowMs: number): Readonly<CanonicalRecordingHealthSnapshot> {
    if (this.#recordingHealth === null) {
      return Object.freeze({
        state: 'UNKNOWN',
        observedAtMs: null,
        gapCount: null,
        quotaState: 'UNKNOWN',
        storagePressure: 'UNKNOWN',
      });
    }
    try {
      const snapshot = safeRecordingSnapshot(this.#recordingHealth.snapshot(nowMs));
      if (snapshot.observedAtMs !== null && snapshot.observedAtMs > nowMs) throw new RangeError('recording health is from the future');
      return snapshot;
    } catch {
      return Object.freeze({
        state: 'FAILED',
        observedAtMs: nowMs,
        gapCount: null,
        quotaState: 'UNKNOWN',
        storagePressure: 'UNKNOWN',
      });
    }
  }

  #now(): number {
    const nowMs = this.#clock.nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError('assessment bridge clock returned invalid UTC milliseconds');
    if (this.#lastNowMs !== null && nowMs < this.#lastNowMs) throw new RangeError('assessment bridge clock regressed');
    this.#lastNowMs = nowMs;
    return nowMs;
  }
}

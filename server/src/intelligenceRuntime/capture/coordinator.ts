import {
  canonicalJson,
  isFailureCode,
  makeStableFailure,
  sortedUnique,
  stableId,
  validateFrozenPreEventRecord,
  validateNormalizedEvidence,
  type FrozenPreEventRecord,
  type JsonValue,
  type NormalizedEvidence,
  type StableFailure,
} from '../../intelligenceFoundation/contracts/index.js';
import {
  attributeOutcome,
  freezePreEvent,
  normalizeOutcomePolicy,
  validateOutcomeLabel,
  type AttributedOutcomeLabel,
  type OutcomePolicySnapshot,
} from '../../intelligenceFoundation/outcomes/index.js';
import { captureCoordinatorConfig } from './config.js';
import { checksumParts, checksumValue, validChecksum } from './checksum.js';
import type {
  CaptureCheckpointReceipt,
  CaptureCompletenessSnapshot,
  CaptureCoordinatorConfig,
  CaptureCoordinatorOptions,
  CaptureCoordinatorSnapshot,
  CaptureEvidenceInput,
  CaptureEvidenceRecord,
  CaptureFailureRecord,
  CaptureHorizonSnapshot,
  CaptureHorizonState,
  CaptureIngestReceipt,
  CaptureRestoreReceipt,
  CaptureRingSnapshot,
  CaptureSourceVersionIdentity,
  CaptureTickReceipt,
  CaptureTriggerInput,
  CaptureTriggerReceipt,
  CaptureTruncationSnapshot,
  RuntimeCaptureSnapshot,
} from './types.js';

interface RingState {
  key: string;
  symbol: string;
  sourceId: string;
  entries: CaptureEvidenceRecord[];
  capacityEvictedRecords: number;
  capacityDroppedThroughEventTimeMs: number | null;
  lastIngestedAtMs: number;
}

interface HorizonState {
  policy: OutcomePolicySnapshot;
  dueAtMs: number;
  state: CaptureHorizonState;
  label: AttributedOutcomeLabel | null;
  failure: StableFailure | null;
}

interface CaptureState {
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
  correlationIds: string[];
  requiredSourceIds: string[];
  frozenRecord: FrozenPreEventRecord;
  preEvidence: CaptureEvidenceRecord[];
  postEvidence: CaptureEvidenceRecord[];
  horizons: HorizonState[];
  preTruncated: boolean;
  postTruncated: boolean;
  preDroppedRecords: number;
  postDroppedRecords: number;
  missingRequiredSourceIds: string[];
}

interface TriggerTombstone {
  triggerRequestId: string;
  captureId: string;
  requestFingerprint: string;
  triggerFingerprint: string;
  observedAtMs: number;
}

interface RingEvictionTombstone {
  key: string;
  symbol: string;
  sourceId: string;
  droppedRecords: number;
  droppedThroughEventTimeMs: number;
  evictedAtMs: number;
}

interface RingEvictionOverflow {
  droppedRecords: number;
  droppedThroughEventTimeMs: number;
  observedAtMs: number;
}

interface RestoreReservation {
  id: number;
  mutationVersion: number;
}

interface PreparedTrigger {
  triggerRequestId: string;
  symbol: string;
  correlationIds: string[];
  requiredSourceIds: string[];
  postWindowMs: number;
  freezeInput: CaptureTriggerInput['freezeInput'];
  explicit: Map<string, CaptureEvidenceRecord>;
  policies: OutcomePolicySnapshot[];
  requestFingerprint: string;
}

interface CheckpointPayload {
  mutationVersion: number;
  lastClockMs: number;
  evictedRingCount: number;
  ringEvictionTombstones: RingEvictionTombstone[];
  ringEvictionOverflow: RingEvictionOverflow | null;
  evictedCaptureCount: number;
  evictedTriggerTombstoneCount: number;
  rings: unknown[];
  captures: unknown[];
  tombstones: TriggerTombstone[];
  failures: CaptureFailureRecord[];
}

interface CheckpointEnvelope {
  schemaVersion: '1';
  checkpointId: string;
  configurationVersion: string;
  producerVersion: string;
  generation: number;
  savedAtMs: number;
  payload: CheckpointPayload;
  checksum: string;
}

class StableCaptureError extends Error {
  readonly failure: StableFailure;

  constructor(failure: StableFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function boundedText(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new TypeError(`${field} must be a bounded non-empty string`);
  }
  return value.trim();
}

function canonicalSymbol(value: unknown, field = 'symbol'): string {
  const symbol = boundedText(value, field, 128).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(symbol)) throw new TypeError(`${field} must be an exchange symbol token`);
  return symbol;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function recordCompare(left: CaptureEvidenceRecord, right: CaptureEvidenceRecord): number {
  const leftTime = left.evidence.truth.temporal.sourceEventTimeMs as number;
  const rightTime = right.evidence.truth.temporal.sourceEventTimeMs as number;
  return leftTime - rightTime
    || left.evidence.truth.temporal.receivedTimeMs - right.evidence.truth.temporal.receivedTimeMs
    || codePointCompare(left.evidence.id, right.evidence.id);
}

function cloneFailure(failure: StableFailure): StableFailure {
  return { ...failure, evidenceIds: [...failure.evidenceIds] };
}

function recordChecksum(record: CaptureEvidenceRecord): string {
  return checksumParts([{
    evidenceChecksum: record.checksum,
    correlationIds: record.correlationIds,
    ingestedAtMs: record.ingestedAtMs,
  }]);
}

function recordsChecksum(records: readonly CaptureEvidenceRecord[]): string {
  return checksumParts(records.map((record) => ({
    id: record.evidence.id,
    checksum: recordChecksum(record),
  })));
}

function frozenChecksum(record: FrozenPreEventRecord): string {
  return checksumParts([
    {
      id: record.id,
      triggerTimeMs: record.triggerTimeMs,
      evidenceCutoffTimeMs: record.evidenceCutoffTimeMs,
      candidateDisposition: record.candidateDisposition,
      configurationVersion: record.configurationVersion,
      featureVersion: record.featureVersion,
    },
    record.thesis,
    record.truth,
    ...record.forensics,
    ...record.features,
    ...record.evidence,
  ]);
}

function ringChecksum(ring: RingState): string {
  return checksumParts([
    {
      key: ring.key,
      symbol: ring.symbol,
      sourceId: ring.sourceId,
      capacityEvictedRecords: ring.capacityEvictedRecords,
      capacityDroppedThroughEventTimeMs: ring.capacityDroppedThroughEventTimeMs,
      lastIngestedAtMs: ring.lastIngestedAtMs,
    },
    ...ring.entries.map((entry) => ({ id: entry.evidence.id, checksum: recordChecksum(entry) })),
  ]);
}

function horizonChecksum(horizon: HorizonState): string {
  return checksumParts([{
    policyId: horizon.policy.id,
    dueAtMs: horizon.dueAtMs,
    state: horizon.state,
    labelChecksum: horizon.label === null ? null : checksumValue(horizon.label),
    failure: horizon.failure,
  }]);
}

function captureChecksum(capture: CaptureState): string {
  return checksumParts([
    {
      id: capture.id,
      triggerRequestId: capture.triggerRequestId,
      requestFingerprint: capture.requestFingerprint,
      triggerFingerprint: capture.triggerFingerprint,
      symbol: capture.symbol,
      instrumentId: capture.instrumentId,
      triggerTimeMs: capture.triggerTimeMs,
      evidenceCutoffTimeMs: capture.evidenceCutoffTimeMs,
      preWindowStartMs: capture.preWindowStartMs,
      postWindowEndMs: capture.postWindowEndMs,
      createdAtMs: capture.createdAtMs,
      finishedAtMs: capture.finishedAtMs,
      correlationIds: capture.correlationIds,
      requiredSourceIds: capture.requiredSourceIds,
      preTruncated: capture.preTruncated,
      postTruncated: capture.postTruncated,
      preDroppedRecords: capture.preDroppedRecords,
      postDroppedRecords: capture.postDroppedRecords,
      missingRequiredSourceIds: capture.missingRequiredSourceIds,
    },
    frozenChecksum(capture.frozenRecord),
    recordsChecksum(capture.preEvidence),
    recordsChecksum(capture.postEvidence),
    ...capture.horizons.map(horizonChecksum),
  ]);
}

function checkpointChecksum(input: Omit<CheckpointEnvelope, 'checksum'>): string {
  const ringChecksums = input.payload.rings.map((ring) => object(ring) ? ring.checksum : null);
  const captureChecksums = input.payload.captures.map((capture) => object(capture) ? capture.checksum : null);
  return checksumParts([
    {
      schemaVersion: input.schemaVersion,
      checkpointId: input.checkpointId,
      configurationVersion: input.configurationVersion,
      producerVersion: input.producerVersion,
      generation: input.generation,
      savedAtMs: input.savedAtMs,
      mutationVersion: input.payload.mutationVersion,
      lastClockMs: input.payload.lastClockMs,
      evictedRingCount: input.payload.evictedRingCount,
      ringEvictionTombstones: input.payload.ringEvictionTombstones,
      ringEvictionOverflow: input.payload.ringEvictionOverflow,
      evictedCaptureCount: input.payload.evictedCaptureCount,
      evictedTriggerTombstoneCount: input.payload.evictedTriggerTombstoneCount,
      ringChecksums,
      captureChecksums,
      tombstones: input.payload.tombstones,
      failures: input.payload.failures,
    },
  ]);
}

function parseFailure(value: unknown): StableFailure | null {
  if (!object(value) || typeof value.id !== 'string' || typeof value.code !== 'string' || typeof value.component !== 'string'
    || typeof value.message !== 'string' || typeof value.retryable !== 'boolean'
    || !(value.field === null || typeof value.field === 'string') || !Array.isArray(value.evidenceIds)
    || value.evidenceIds.some((entry) => typeof entry !== 'string') || !isFailureCode(value.code)) return null;
  const expected = makeStableFailure(
    value.code as StableFailure['code'],
    value.component,
    value.message,
    value.field,
    value.evidenceIds,
  );
  return canonicalJson(expected) === canonicalJson(value) ? expected : null;
}

export class LiveOutcomeCaptureCoordinator {
  readonly #clock: CaptureCoordinatorOptions['clock'];
  readonly #storage: CaptureCoordinatorOptions['storage'];
  readonly #config: CaptureCoordinatorConfig;
  #rings = new Map<string, RingState>();
  #ringEvictionTombstones = new Map<string, RingEvictionTombstone>();
  #ringEvictionOverflow: RingEvictionOverflow | null = null;
  #captures = new Map<string, CaptureState>();
  #tombstones = new Map<string, TriggerTombstone>();
  #failures = new Map<string, CaptureFailureRecord>();
  #mutationVersion = 0;
  #persistedMutationVersion = -1;
  #checkpointGeneration = 0;
  #lastClockMs = -1;
  #evictedRingCount = 0;
  #evictedCaptureCount = 0;
  #evictedTriggerTombstoneCount = 0;
  #checkpointInFlight: Promise<CaptureCheckpointReceipt> | null = null;
  #restoreInFlight: Promise<CaptureRestoreReceipt> | null = null;
  #restoreReservation: RestoreReservation | null = null;
  #nextRestoreReservationId = 1;

  constructor(options: CaptureCoordinatorOptions) {
    if (typeof options?.clock?.nowMs !== 'function') throw new TypeError('capture coordinator requires an injected clock');
    if (typeof options?.storage?.load !== 'function' || typeof options?.storage?.save !== 'function') {
      throw new TypeError('capture coordinator requires an injected storage port');
    }
    this.#clock = options.clock;
    this.#storage = options.storage;
    this.#config = captureCoordinatorConfig(options.config);
  }

  get config(): CaptureCoordinatorConfig {
    return this.#config;
  }

  #now(): number {
    const now = this.#clock.nowMs();
    if (!safeInteger(now)) throw new RangeError('capture clock must return a non-negative safe integer');
    if (now < this.#lastClockMs) throw new RangeError('capture clock cannot regress');
    this.#lastClockMs = now;
    return now;
  }

  #touch(): void {
    this.#mutationVersion += 1;
  }

  #rememberFailure(failure: StableFailure, atMs: number): StableFailure {
    const existing = this.#failures.get(failure.id);
    if (existing) {
      existing.count += 1;
      existing.lastObservedAtMs = atMs;
    } else {
      this.#failures.set(failure.id, {
        failure: cloneFailure(failure),
        count: 1,
        firstObservedAtMs: atMs,
        lastObservedAtMs: atMs,
      });
      if (this.#failures.size > this.#config.maximumFailureRecords) {
        const oldest = [...this.#failures.values()].sort((left, right) =>
          left.lastObservedAtMs - right.lastObservedAtMs || codePointCompare(left.failure.id, right.failure.id))[0];
        this.#failures.delete(oldest.failure.id);
      }
    }
    this.#touch();
    return failure;
  }

  #failure(
    code: StableFailure['code'],
    message: string,
    field: string | null,
    atMs: number,
    evidenceIds: string[] = [],
  ): StableFailure {
    return this.#rememberFailure(makeStableFailure(code, 'runtime_capture', message, field, evidenceIds), atMs);
  }

  #restoreBusyFailure(field: string): StableFailure {
    return makeStableFailure(
      'UNAVAILABLE',
      'runtime_capture',
      'capture coordinator is reserved by checkpoint restore',
      field,
    );
  }

  #correlations(values: readonly string[] | undefined, field: string): string[] {
    if (values === undefined) return [];
    if (!Array.isArray(values) || values.length > this.#config.maximumCorrelationIds) {
      throw new RangeError(`${field} exceeds the configured correlation bound`);
    }
    return sortedUnique(values.map((value, index) => boundedText(value, `${field}[${index}]`, 256)));
  }

  #sourceIds(values: readonly string[], field: string): string[] {
    if (!Array.isArray(values) || values.length === 0 || values.length > this.#config.maximumRequiredSources) {
      throw new RangeError(`${field} must be a non-empty bounded source set`);
    }
    return sortedUnique(values.map((value, index) => boundedText(value, `${field}[${index}]`, 256)));
  }

  #evidenceRecord(
    evidenceInput: NormalizedEvidence,
    correlationIds: readonly string[],
    ingestedAtMs: number,
  ): CaptureEvidenceRecord {
    const validated = validateNormalizedEvidence(evidenceInput);
    if (!validated.ok) throw new TypeError(validated.failure.message);
    const evidence = validated.value;
    const truth = evidence.truth;
    const sourceEventTimeMs = truth.temporal.sourceEventTimeMs;
    if (sourceEventTimeMs === null) {
      throw new StableCaptureError(makeStableFailure(
        'MISSING_SOURCE',
        'runtime_capture',
        'capture evidence requires a non-null source event time',
        'evidence.truth.temporal.sourceEventTimeMs',
        [evidence.id],
      ));
    }
    const epistemicTimes = [
      sourceEventTimeMs,
      truth.temporal.sourceTransactionTimeMs,
      truth.temporal.receivedTimeMs,
      truth.freshness.evaluatedAtMs,
    ].filter((value): value is number => value !== null);
    if (epistemicTimes.some((value) => !safeInteger(value) || value > ingestedAtMs)) {
      throw new StableCaptureError(makeStableFailure(
        'NO_LOOK_AHEAD_VIOLATION',
        'runtime_capture',
        'capture evidence contains an epistemic timestamp after ingestion',
        'evidence.truth',
        [evidence.id],
      ));
    }
    const serialized = canonicalJson(evidence);
    if (Buffer.byteLength(serialized, 'utf8') > this.#config.maximumEvidenceBytes) {
      throw new RangeError('capture evidence exceeds the configured byte bound');
    }
    return {
      evidence,
      correlationIds: [...correlationIds],
      ingestedAtMs,
      checksum: checksumValue(evidence),
    };
  }

  #ringKey(symbol: string, sourceId: string): string {
    return stableId('capture-ring', { symbol, sourceId });
  }

  #pruneRing(ring: RingState, now: number): number {
    const cutoff = Math.max(0, now - this.#config.preTriggerWindowMs);
    const before = ring.entries.length;
    ring.entries = ring.entries.filter((entry) =>
      (entry.evidence.truth.temporal.sourceEventTimeMs as number) >= cutoff);
    return before - ring.entries.length;
  }

  #pruneRingEvictionTombstones(now: number): boolean {
    const cutoff = Math.max(0, now - this.#config.preTriggerWindowMs);
    let changed = false;
    for (const [key, tombstone] of this.#ringEvictionTombstones) {
      if (tombstone.droppedThroughEventTimeMs >= cutoff) continue;
      this.#ringEvictionTombstones.delete(key);
      changed = true;
    }
    if (this.#ringEvictionOverflow !== null
      && this.#ringEvictionOverflow.droppedThroughEventTimeMs < cutoff) {
      this.#ringEvictionOverflow = null;
      changed = true;
    }
    return changed;
  }

  #rememberRingEviction(ring: RingState, now: number): void {
    this.#pruneRingEvictionTombstones(now);
    const retainedEventTimes = ring.entries.map((entry) =>
      entry.evidence.truth.temporal.sourceEventTimeMs as number);
    const droppedThroughEventTimeMs = Math.max(
      ring.capacityDroppedThroughEventTimeMs ?? -1,
      ...retainedEventTimes,
    );
    const droppedRecords = ring.capacityEvictedRecords + ring.entries.length;
    if (droppedRecords < 1 || droppedThroughEventTimeMs < 0) return;
    const existing = this.#ringEvictionTombstones.get(ring.key);
    this.#ringEvictionTombstones.set(ring.key, {
      key: ring.key,
      symbol: ring.symbol,
      sourceId: ring.sourceId,
      droppedRecords: droppedRecords + (existing?.droppedRecords ?? 0),
      droppedThroughEventTimeMs: Math.max(droppedThroughEventTimeMs, existing?.droppedThroughEventTimeMs ?? -1),
      evictedAtMs: now,
    });
    while (this.#ringEvictionTombstones.size > this.#config.maximumRingEvictionTombstones) {
      const oldest = [...this.#ringEvictionTombstones.values()].sort((left, right) =>
        left.evictedAtMs - right.evictedAtMs || codePointCompare(left.key, right.key))[0];
      this.#ringEvictionTombstones.delete(oldest.key);
      this.#ringEvictionOverflow = {
        droppedRecords: oldest.droppedRecords + (this.#ringEvictionOverflow?.droppedRecords ?? 0),
        droppedThroughEventTimeMs: Math.max(
          oldest.droppedThroughEventTimeMs,
          this.#ringEvictionOverflow?.droppedThroughEventTimeMs ?? -1,
        ),
        observedAtMs: now,
      };
    }
  }

  #evictRingForCapacity(now: number): void {
    if (this.#rings.size < this.#config.maximumPreRings) return;
    const oldest = [...this.#rings.values()].sort((left, right) =>
      left.lastIngestedAtMs - right.lastIngestedAtMs || codePointCompare(left.key, right.key))[0];
    this.#rememberRingEviction(oldest, now);
    this.#rings.delete(oldest.key);
    this.#evictedRingCount += 1;
  }

  #markPostTruncated(capture: CaptureState, atMs: number): void {
    if (capture.postTruncated) return;
    capture.postTruncated = true;
    for (const horizon of capture.horizons) {
      if (horizon.state === 'PENDING') continue;
      horizon.state = 'TRUNCATED';
      horizon.label = null;
      horizon.failure = makeStableFailure(
        'BUDGET_EXHAUSTED',
        'runtime_capture',
        'post-trigger capture was truncated before the configured collection window closed',
        'postEvidence',
        [capture.id],
      );
    }
    this.#failure('BUDGET_EXHAUSTED', 'post-trigger evidence capacity truncated an active capture', 'postEvidence', atMs, [capture.id]);
  }

  ingestEvidence(input: CaptureEvidenceInput): CaptureIngestReceipt {
    if (this.#restoreReservation !== null) {
      return {
        state: 'REJECTED', evidenceId: null, symbol: null, sourceId: null,
        preRingEvictedRecords: 0, postCaptureCount: 0, postTruncatedCaptureCount: 0,
        failure: this.#restoreBusyFailure('ingestEvidence'),
      };
    }
    const now = this.#now();
    let record: CaptureEvidenceRecord;
    let symbol: string;
    let sourceId: string;
    try {
      const correlations = this.#correlations(input?.correlationIds, 'correlationIds');
      record = this.#evidenceRecord(input?.evidence, correlations, now);
      symbol = canonicalSymbol(record.evidence.instrument.symbol, 'evidence.instrument.symbol');
      sourceId = boundedText(record.evidence.truth.authority.sourceId, 'evidence.truth.authority.sourceId', 256);
    } catch (error) {
      const failure = error instanceof StableCaptureError
        ? this.#rememberFailure(error.failure, now)
        : this.#failure(
          error instanceof RangeError ? 'BUDGET_EXHAUSTED' : 'INVALID_VALUE',
          error instanceof Error ? error.message : 'capture evidence is invalid',
          'evidence',
          now,
        );
      return { state: 'REJECTED', evidenceId: null, symbol: null, sourceId: null, preRingEvictedRecords: 0, postCaptureCount: 0, postTruncatedCaptureCount: 0, failure };
    }

    const key = this.#ringKey(symbol, sourceId);
    const prunedTombstones = this.#pruneRingEvictionTombstones(now);
    let ring = this.#rings.get(key);
    if (!ring) {
      this.#evictRingForCapacity(now);
      ring = {
        key,
        symbol,
        sourceId,
        entries: [],
        capacityEvictedRecords: 0,
        capacityDroppedThroughEventTimeMs: null,
        lastIngestedAtMs: now,
      };
      this.#rings.set(key, ring);
    }
    const pruned = this.#pruneRing(ring, now);
    const existing = ring.entries.find((entry) => entry.evidence.id === record.evidence.id);
    if (existing) {
      if (existing.checksum !== record.checksum) {
        const failure = this.#failure('DUPLICATE_EVENT', 'conflicting evidence reused an existing evidence ID', 'evidence.id', now, [record.evidence.id]);
        return { state: 'REJECTED', evidenceId: record.evidence.id, symbol, sourceId, preRingEvictedRecords: pruned, postCaptureCount: 0, postTruncatedCaptureCount: 0, failure };
      }
      if (pruned > 0 || prunedTombstones) this.#touch();
      return { state: 'DUPLICATE', evidenceId: record.evidence.id, symbol, sourceId, preRingEvictedRecords: pruned, postCaptureCount: 0, postTruncatedCaptureCount: 0, failure: null };
    }
    ring.entries.push(record);
    ring.entries.sort(recordCompare);
    ring.lastIngestedAtMs = now;
    let capacityEvicted = 0;
    while (ring.entries.length > this.#config.maximumPreEvidencePerRing) {
      const evicted = ring.entries.shift()!;
      const eventTimeMs = evicted.evidence.truth.temporal.sourceEventTimeMs as number;
      ring.capacityEvictedRecords += 1;
      ring.capacityDroppedThroughEventTimeMs = ring.capacityDroppedThroughEventTimeMs === null
        ? eventTimeMs
        : Math.max(ring.capacityDroppedThroughEventTimeMs, eventTimeMs);
      capacityEvicted += 1;
    }

    let postCaptureCount = 0;
    let postTruncatedCaptureCount = 0;
    const eventTimeMs = record.evidence.truth.temporal.sourceEventTimeMs as number;
    for (const capture of [...this.#captures.values()].sort((left, right) => codePointCompare(left.id, right.id))) {
      if (capture.symbol !== symbol || capture.finishedAtMs !== null || now > capture.postWindowEndMs
        || eventTimeMs <= capture.triggerTimeMs || eventTimeMs > capture.postWindowEndMs) continue;
      const postExisting = capture.postEvidence.find((entry) => entry.evidence.id === record.evidence.id);
      if (postExisting) {
        if (postExisting.checksum !== record.checksum) {
          this.#failure('DUPLICATE_EVENT', 'conflicting post-trigger evidence reused an existing ID', 'postEvidence.id', now, [record.evidence.id, capture.id]);
        }
        continue;
      }
      if (capture.postEvidence.length >= this.#config.maximumPostEvidencePerCapture) {
        capture.postDroppedRecords += 1;
        this.#markPostTruncated(capture, now);
        postTruncatedCaptureCount += 1;
        continue;
      }
      capture.postEvidence.push({ ...record, correlationIds: [...record.correlationIds] });
      capture.postEvidence.sort(recordCompare);
      postCaptureCount += 1;
    }
    this.#touch();
    return {
      state: 'ACCEPTED',
      evidenceId: record.evidence.id,
      symbol,
      sourceId,
      preRingEvictedRecords: pruned + capacityEvicted,
      postCaptureCount,
      postTruncatedCaptureCount,
      failure: null,
    };
  }

  #normalizedPolicies(input: CaptureTriggerInput, postWindowMs: number): OutcomePolicySnapshot[] {
    if (!Array.isArray(input.outcomePolicies) || input.outcomePolicies.length === 0
      || input.outcomePolicies.length > this.#config.maximumPoliciesPerCapture) {
      throw new RangeError('outcomePolicies must be a non-empty bounded policy set');
    }
    const policies: OutcomePolicySnapshot[] = [];
    const ids = new Set<string>();
    for (const policy of input.outcomePolicies) {
      const normalized = normalizeOutcomePolicy(policy);
      if (!normalized.ok) throw new TypeError(normalized.failure.message);
      if (normalized.value.horizonMs > postWindowMs) throw new RangeError('outcome policy horizon exceeds the post-trigger window');
      if (ids.has(normalized.value.id)) throw new TypeError('duplicate outcome policy');
      ids.add(normalized.value.id);
      policies.push(normalized.value);
    }
    policies.sort((left, right) => left.horizonMs - right.horizonMs || codePointCompare(left.id, right.id));
    return policies;
  }

  #prepareTrigger(input: CaptureTriggerInput, triggerRequestId: string): PreparedTrigger {
    const symbol = canonicalSymbol(input.symbol);
    const correlationIds = this.#correlations(input.correlationIds, 'correlationIds');
    const requiredSourceIds = this.#sourceIds(input.requiredSourceIds, 'requiredSourceIds');
    if (!safeInteger(input.postWindowMs) || input.postWindowMs < 1 || input.postWindowMs > this.#config.maximumPostWindowMs) {
      throw new RangeError('postWindowMs exceeds the configured post-trigger window bound');
    }
    const freezeInput = input.freezeInput;
    if (!freezeInput || !safeInteger(freezeInput.triggerTimeMs)
      || (freezeInput.evidenceCutoffTimeMs ?? freezeInput.triggerTimeMs) !== freezeInput.triggerTimeMs) {
      throw new StableCaptureError(makeStableFailure(
        'NO_LOOK_AHEAD_VIOLATION',
        'runtime_capture',
        'capture request freeze must use one exact trigger time and cutoff',
        'freezeInput.triggerTimeMs',
      ));
    }
    if (freezeInput.evidence.length > this.#config.maximumFreezeEvidence) {
      throw new RangeError('explicit freeze evidence exceeds the configured bound');
    }
    if (input.postWindowMs > Number.MAX_SAFE_INTEGER - freezeInput.triggerTimeMs) {
      throw new RangeError('post-trigger window exceeds safe time');
    }
    const policies = this.#normalizedPolicies(input, input.postWindowMs);
    const explicit = new Map<string, CaptureEvidenceRecord>();
    for (const evidence of freezeInput.evidence) {
      const record = this.#evidenceRecord(evidence, correlationIds, freezeInput.triggerTimeMs);
      const evidenceSymbol = canonicalSymbol(record.evidence.instrument.symbol, 'freezeInput.evidence.instrument.symbol');
      if (record.evidence.instrument.productFamily !== 'BORROW' && evidenceSymbol !== symbol) {
        throw new TypeError('freeze evidence symbol conflicts with the trigger symbol');
      }
      const existing = explicit.get(record.evidence.id);
      if (existing && existing.checksum !== record.checksum) throw new TypeError('conflicting explicit evidence ID');
      explicit.set(record.evidence.id, record);
    }
    const primary = [...explicit.values()].find((record) =>
      record.evidence.instrument.instrumentId === freezeInput.thesis.instrumentId);
    if (!primary || canonicalSymbol(primary.evidence.instrument.symbol) !== symbol) {
      throw new TypeError('freeze input does not contain primary-instrument evidence for the trigger symbol');
    }
    const explicitFrozen = freezePreEvent({
      ...freezeInput,
      evidenceCutoffTimeMs: freezeInput.triggerTimeMs,
      evidence: [...explicit.values()].sort(recordCompare).map((record) => record.evidence),
    });
    if (!explicitFrozen.ok) throw new StableCaptureError(explicitFrozen.failure);
    const requestFingerprint = checksumParts([{
      triggerRequestId,
      symbol,
      correlationIds,
      requiredSourceIds,
      triggerTimeMs: freezeInput.triggerTimeMs,
      postWindowMs: input.postWindowMs,
      policyIds: policies.map((policy) => policy.id),
      explicitFrozenChecksum: frozenChecksum(explicitFrozen.value),
    }]);
    return {
      triggerRequestId,
      symbol,
      correlationIds,
      requiredSourceIds,
      postWindowMs: input.postWindowMs,
      freezeInput,
      explicit,
      policies,
      requestFingerprint,
    };
  }

  #evictCapture(capture: CaptureState): void {
    this.#captures.delete(capture.id);
    this.#evictedCaptureCount += 1;
  }

  #evictFinishedForCapacity(now: number, reserve: number): string[] {
    const evicted: string[] = [];
    const expired = [...this.#captures.values()]
      .filter((capture) => capture.finishedAtMs !== null && capture.postWindowEndMs + this.#config.captureRetentionMs <= now)
      .sort((left, right) => (left.finishedAtMs as number) - (right.finishedAtMs as number) || codePointCompare(left.id, right.id));
    for (const capture of expired) {
      this.#evictCapture(capture);
      evicted.push(capture.id);
    }
    while (this.#captures.size + reserve > this.#config.maximumRetainedCaptures) {
      const candidate = [...this.#captures.values()]
        .filter((capture) => capture.finishedAtMs !== null)
        .sort((left, right) => (left.finishedAtMs as number) - (right.finishedAtMs as number) || codePointCompare(left.id, right.id))[0];
      if (!candidate) break;
      this.#evictCapture(candidate);
      evicted.push(candidate.id);
    }
    return evicted;
  }

  #addTombstone(value: TriggerTombstone): void {
    this.#tombstones.set(value.triggerRequestId, value);
    while (this.#tombstones.size > this.#config.maximumTriggerTombstones) {
      const oldest = [...this.#tombstones.values()]
        .filter((candidate) => !this.#captures.has(candidate.captureId))
        .sort((left, right) =>
        left.observedAtMs - right.observedAtMs || codePointCompare(left.triggerRequestId, right.triggerRequestId))[0];
      if (!oldest) throw new RangeError('trigger tombstone capacity cannot evict a retained capture identity');
      this.#tombstones.delete(oldest.triggerRequestId);
      this.#evictedTriggerTombstoneCount += 1;
    }
  }

  trigger(input: CaptureTriggerInput): CaptureTriggerReceipt {
    if (this.#restoreReservation !== null) {
      return {
        state: 'REJECTED', triggerRequestId: null, captureId: null, capture: null,
        evictedCaptureIds: [], failure: this.#restoreBusyFailure('trigger'),
      };
    }
    const now = this.#now();
    if (this.#pruneRingEvictionTombstones(now)) this.#touch();
    let triggerRequestId: string;
    try {
      triggerRequestId = boundedText(input?.triggerRequestId, 'triggerRequestId', 256);
    } catch (error) {
      const failure = this.#failure('INVALID_VALUE', error instanceof Error ? error.message : 'trigger ID is invalid', 'triggerRequestId', now);
      return { state: 'REJECTED', triggerRequestId: null, captureId: null, capture: null, evictedCaptureIds: [], failure };
    }
    let prepared: PreparedTrigger;
    try {
      prepared = this.#prepareTrigger(input, triggerRequestId);
    } catch (error) {
      const failure = error instanceof StableCaptureError
        ? this.#rememberFailure(error.failure, now)
        : this.#failure(
          error instanceof RangeError ? 'BUDGET_EXHAUSTED' : 'INVALID_VALUE',
          error instanceof Error ? error.message : 'capture trigger is invalid',
          'trigger',
          now,
        );
      return { state: 'REJECTED', triggerRequestId, captureId: null, capture: null, evictedCaptureIds: [], failure };
    }

    const duplicate = this.#tombstones.get(triggerRequestId);
    const retained = [...this.#captures.values()].find((capture) => capture.triggerRequestId === triggerRequestId);
    if (duplicate || retained) {
      const expectedRequestFingerprint = duplicate?.requestFingerprint ?? retained?.requestFingerprint;
      if (expectedRequestFingerprint !== prepared.requestFingerprint
        || (duplicate && retained && duplicate.captureId !== retained.id)) {
        const failure = this.#failure(
          'DUPLICATE_EVENT',
          'trigger request ID was reused with conflicting immutable request material',
          'triggerRequestId',
          now,
          [triggerRequestId],
        );
        return { state: 'REJECTED', triggerRequestId, captureId: null, capture: null, evictedCaptureIds: [], failure };
      }
      const capture = retained ?? (duplicate ? this.#captures.get(duplicate.captureId) : undefined);
      return {
        state: 'DUPLICATE',
        triggerRequestId,
        captureId: duplicate?.captureId ?? (capture as CaptureState).id,
        capture: capture ? this.#captureSnapshot(capture) : null,
        evictedCaptureIds: [],
        failure: null,
      };
    }

    try {
      const {
        symbol, correlationIds, requiredSourceIds, freezeInput, explicit, policies, requestFingerprint,
      } = prepared;
      if (freezeInput.triggerTimeMs !== now) {
        throw new StableCaptureError(makeStableFailure(
          'NO_LOOK_AHEAD_VIOLATION',
          'runtime_capture',
          'capture freeze must occur at the exact injected trigger time and cutoff',
          'freezeInput.triggerTimeMs',
        ));
      }
      const preWindowStartMs = Math.max(0, now - this.#config.preTriggerWindowMs);
      const ringCandidates: CaptureEvidenceRecord[] = [];
      let preTruncated = false;
      let preDroppedRecords = 0;
      for (const tombstone of this.#ringEvictionTombstones.values()) {
        if (tombstone.symbol !== symbol || tombstone.droppedThroughEventTimeMs < preWindowStartMs) continue;
        preTruncated = true;
        preDroppedRecords += tombstone.droppedRecords;
      }
      if (this.#ringEvictionOverflow !== null
        && this.#ringEvictionOverflow.droppedThroughEventTimeMs >= preWindowStartMs) {
        preTruncated = true;
        preDroppedRecords += this.#ringEvictionOverflow.droppedRecords;
      }
      for (const ring of [...this.#rings.values()].filter((candidate) => candidate.symbol === symbol)
        .sort((left, right) => codePointCompare(left.key, right.key))) {
        if (ring.capacityDroppedThroughEventTimeMs !== null && ring.capacityDroppedThroughEventTimeMs >= preWindowStartMs) {
          preTruncated = true;
          preDroppedRecords += ring.capacityEvictedRecords;
        }
        for (const record of ring.entries) {
          const eventTimeMs = record.evidence.truth.temporal.sourceEventTimeMs as number;
          if (eventTimeMs < preWindowStartMs || eventTimeMs > now || record.evidence.truth.temporal.receivedTimeMs > now) continue;
          ringCandidates.push(record);
        }
      }
      ringCandidates.sort(recordCompare);
      const combined = new Map(explicit);
      for (const record of ringCandidates) {
        const existing = combined.get(record.evidence.id);
        if (existing) {
          if (existing.checksum !== record.checksum) throw new TypeError('conflicting ring evidence ID');
          combined.set(record.evidence.id, {
            ...existing,
            correlationIds: sortedUnique([...existing.correlationIds, ...record.correlationIds]),
          });
        }
      }
      const additionsById = new Map<string, CaptureEvidenceRecord>();
      for (const record of ringCandidates) {
        if (combined.has(record.evidence.id)) continue;
        const existing = additionsById.get(record.evidence.id);
        if (existing && existing.checksum !== record.checksum) throw new TypeError('conflicting cross-ring evidence ID');
        if (existing) {
          additionsById.set(record.evidence.id, {
            ...existing,
            correlationIds: sortedUnique([...existing.correlationIds, ...record.correlationIds]),
          });
        } else additionsById.set(record.evidence.id, record);
      }
      const additions = [...additionsById.values()].sort(recordCompare);
      const available = this.#config.maximumFreezeEvidence - combined.size;
      if (additions.length > available) {
        preTruncated = true;
        preDroppedRecords += additions.length - Math.max(0, available);
      }
      for (const record of additions.slice(Math.max(0, additions.length - Math.max(0, available)))) {
        combined.set(record.evidence.id, { ...record, correlationIds: [...record.correlationIds] });
      }
      const preEvidence = [...combined.values()].sort(recordCompare);
      const capturedSourceIds = new Set(preEvidence.map((record) => record.evidence.truth.authority.sourceId));
      const missingRequiredSourceIds = requiredSourceIds.filter((sourceId) => !capturedSourceIds.has(sourceId));
      const frozenResult = freezePreEvent({
        ...freezeInput,
        evidenceCutoffTimeMs: now,
        evidence: preEvidence.map((record) => record.evidence),
      });
      if (!frozenResult.ok) throw new StableCaptureError(frozenResult.failure);
      const frozenRecord = frozenResult.value;
      const triggerFingerprint = checksumParts([{
        triggerRequestId,
        symbol,
        correlationIds,
        requiredSourceIds,
        frozenRecordId: frozenRecord.id,
        requestFingerprint,
        postWindowMs: prepared.postWindowMs,
        policyIds: policies.map((policy) => policy.id),
      }]);
      const id = stableId('runtime-capture', {
        triggerRequestId,
        requestFingerprint,
        frozenRecordId: frozenRecord.id,
        postWindowMs: prepared.postWindowMs,
        policyIds: policies.map((policy) => policy.id),
      });
      const activeCount = [...this.#captures.values()].filter((capture) => capture.finishedAtMs === null).length;
      if (activeCount >= this.#config.maximumActiveCaptures) throw new RangeError('active capture capacity is exhausted');
      const evictedCaptureIds = this.#evictFinishedForCapacity(now, 1);
      if (this.#captures.size >= this.#config.maximumRetainedCaptures) {
        throw new RangeError('retained capture capacity is exhausted by active captures');
      }
      const capture: CaptureState = {
        id,
        triggerRequestId,
        requestFingerprint,
        triggerFingerprint,
        symbol,
        instrumentId: freezeInput.thesis.instrumentId,
        triggerTimeMs: now,
        evidenceCutoffTimeMs: now,
        preWindowStartMs,
        postWindowEndMs: now + prepared.postWindowMs,
        createdAtMs: now,
        finishedAtMs: null,
        correlationIds,
        requiredSourceIds,
        frozenRecord,
        preEvidence,
        postEvidence: [],
        horizons: policies.map((policy) => ({
          policy,
          dueAtMs: now + policy.horizonMs,
          state: 'PENDING',
          label: null,
          failure: null,
        })),
        preTruncated,
        postTruncated: false,
        preDroppedRecords,
        postDroppedRecords: 0,
        missingRequiredSourceIds,
      };
      this.#captures.set(id, capture);
      this.#addTombstone({ triggerRequestId, captureId: id, requestFingerprint, triggerFingerprint, observedAtMs: now });
      this.#touch();
      return {
        state: 'CREATED',
        triggerRequestId,
        captureId: id,
        capture: this.#captureSnapshot(capture),
        evictedCaptureIds,
        failure: null,
      };
    } catch (error) {
      const failure = error instanceof StableCaptureError
        ? this.#rememberFailure(error.failure, now)
        : this.#failure(
          error instanceof RangeError ? 'BUDGET_EXHAUSTED' : 'INVALID_VALUE',
          error instanceof Error ? error.message : 'capture trigger is invalid',
          'trigger',
          now,
        );
      return { state: 'REJECTED', triggerRequestId, captureId: null, capture: null, evictedCaptureIds: [], failure };
    }
  }

  tick(): CaptureTickReceipt {
    if (this.#restoreReservation !== null) {
      const rawNow = this.#clock.nowMs();
      const atMs = safeInteger(rawNow) ? rawNow : 0;
      return deepFreeze({
        atMs,
        completedHorizons: 0,
        incompleteHorizons: 0,
        truncatedHorizons: 0,
        failedHorizons: 1,
        finalizedCaptures: 0,
        evictedCaptureIds: [],
        failures: [this.#restoreBusyFailure('tick')],
      });
    }
    const now = this.#now();
    let completedHorizons = 0;
    let incompleteHorizons = 0;
    let truncatedHorizons = 0;
    let failedHorizons = 0;
    let finalizedCaptures = 0;
    const failures: StableFailure[] = [];
    let changed = false;
    for (const capture of [...this.#captures.values()].sort((left, right) => codePointCompare(left.id, right.id))) {
      for (const horizon of capture.horizons) {
        if (horizon.state !== 'PENDING' || horizon.dueAtMs > now) continue;
        if (capture.preTruncated || capture.postTruncated) {
          horizon.state = 'TRUNCATED';
          horizon.failure = makeStableFailure(
            'BUDGET_EXHAUSTED',
            'runtime_capture',
            'capture truncation prevents trustworthy outcome attribution',
            'capture.truncation',
            [capture.id, capture.frozenRecord.id],
          );
          truncatedHorizons += 1;
          failures.push(horizon.failure);
          changed = true;
          continue;
        }
        const attributed = attributeOutcome({
          frozen: capture.frozenRecord,
          evaluatedAtMs: horizon.dueAtMs,
          policy: {
            horizonMs: horizon.policy.horizonMs,
            direction: horizon.policy.direction,
            movedThresholdPct: horizon.policy.movedThresholdPct,
            terminalMaxAgeMs: horizon.policy.terminalMaxAgeMs,
            requiredMetricFields: horizon.policy.requiredMetricFields,
            referenceEvidenceId: horizon.policy.referenceEvidenceId,
            priceBasis: horizon.policy.priceBasis,
            ...(horizon.policy.liquidity === null ? {} : { liquidity: horizon.policy.liquidity }),
            ...(horizon.policy.depth === null ? {} : { depth: horizon.policy.depth }),
            ...(horizon.policy.execution === null ? {} : { execution: horizon.policy.execution }),
          },
          laterEvidence: capture.postEvidence
            .filter((record) => record.ingestedAtMs <= horizon.dueAtMs
              && record.evidence.instrument.instrumentId === capture.instrumentId)
            .map((record) => record.evidence),
        });
        if (!attributed.ok) {
          horizon.state = 'FAILED';
          horizon.failure = attributed.failure;
          failedHorizons += 1;
          failures.push(attributed.failure);
          changed = true;
          continue;
        }
        horizon.label = attributed.value;
        horizon.state = attributed.value.state;
        if (horizon.state === 'COMPLETE') completedHorizons += 1;
        else incompleteHorizons += 1;
        changed = true;
      }
      if (capture.finishedAtMs === null && now >= capture.postWindowEndMs
        && capture.horizons.every((horizon) => horizon.state !== 'PENDING')) {
        capture.finishedAtMs = capture.postWindowEndMs;
        finalizedCaptures += 1;
        changed = true;
      }
    }
    for (const failure of failures) this.#rememberFailure(failure, now);
    const evictedCaptureIds = this.#evictFinishedForCapacity(now, 0);
    if (evictedCaptureIds.length > 0) changed = true;
    if (changed) this.#touch();
    return deepFreeze({
      atMs: now,
      completedHorizons,
      incompleteHorizons,
      truncatedHorizons,
      failedHorizons,
      finalizedCaptures,
      evictedCaptureIds,
      failures: failures.map(cloneFailure),
    });
  }

  #sourceVersions(capture: CaptureState): CaptureSourceVersionIdentity[] {
    const groups = new Map<string, { producer: string[]; configuration: string[]; feature: string[] }>();
    for (const evidence of [...capture.preEvidence, ...capture.postEvidence].map((record) => record.evidence)) {
      const truth = evidence.truth;
      const sourceId = truth.authority.sourceId;
      const group = groups.get(sourceId) ?? { producer: [], configuration: [], feature: [] };
      group.producer.push(truth.producerVersion);
      group.configuration.push(truth.configurationVersion);
      if (truth.featureVersion !== null) group.feature.push(truth.featureVersion);
      groups.set(sourceId, group);
    }
    return [...groups.entries()].map(([sourceId, versions]) => ({
      sourceId,
      producerVersions: sortedUnique(versions.producer),
      configurationVersions: sortedUnique(versions.configuration),
      featureVersions: sortedUnique(versions.feature),
    })).sort((left, right) => codePointCompare(left.sourceId, right.sourceId));
  }

  #truncation(capture: CaptureState): CaptureTruncationSnapshot {
    const reasonCodes = [
      ...(capture.preTruncated ? ['PRE_TRIGGER_CAPTURE_TRUNCATED'] : []),
      ...(capture.postTruncated ? ['POST_TRIGGER_CAPTURE_TRUNCATED'] : []),
    ];
    return {
      preTrigger: capture.preTruncated,
      postTrigger: capture.postTruncated,
      preDroppedRecords: capture.preDroppedRecords,
      postDroppedRecords: capture.postDroppedRecords,
      reasonCodes,
    };
  }

  #completeness(capture: CaptureState): CaptureCompletenessSnapshot {
    const horizonIncomplete = capture.horizons.some((horizon) => horizon.state !== 'COMPLETE');
    const reasonCodes = [
      ...(capture.finishedAtMs === null ? ['POST_TRIGGER_WINDOW_OPEN'] : []),
      ...(capture.missingRequiredSourceIds.length > 0 ? ['REQUIRED_PRE_TRIGGER_SOURCE_MISSING'] : []),
      ...(capture.preTruncated ? ['PRE_TRIGGER_CAPTURE_TRUNCATED'] : []),
      ...(capture.postTruncated ? ['POST_TRIGGER_CAPTURE_TRUNCATED'] : []),
      ...(horizonIncomplete ? ['OUTCOME_HORIZON_INCOMPLETE'] : []),
    ];
    const state = capture.finishedAtMs === null
      ? 'COLLECTING' as const
      : capture.preTruncated || capture.postTruncated
        ? 'TRUNCATED' as const
        : capture.missingRequiredSourceIds.length > 0 || horizonIncomplete
          ? 'INCOMPLETE' as const
          : 'COMPLETE' as const;
    return { state, missingRequiredSourceIds: [...capture.missingRequiredSourceIds], reasonCodes: sortedUnique(reasonCodes) };
  }

  #captureSnapshot(capture: CaptureState): RuntimeCaptureSnapshot {
    const preChecksum = recordsChecksum(capture.preEvidence);
    const postChecksum = recordsChecksum(capture.postEvidence);
    return deepFreeze({
      id: capture.id,
      triggerRequestId: capture.triggerRequestId,
      requestFingerprint: capture.requestFingerprint,
      triggerFingerprint: capture.triggerFingerprint,
      symbol: capture.symbol,
      instrumentId: capture.instrumentId,
      triggerTimeMs: capture.triggerTimeMs,
      evidenceCutoffTimeMs: capture.evidenceCutoffTimeMs,
      preWindowStartMs: capture.preWindowStartMs,
      postWindowEndMs: capture.postWindowEndMs,
      createdAtMs: capture.createdAtMs,
      finishedAtMs: capture.finishedAtMs,
      correlationIds: [...capture.correlationIds],
      requiredSourceIds: [...capture.requiredSourceIds],
      sourceVersions: this.#sourceVersions(capture),
      frozenRecord: capture.frozenRecord,
      preEvidence: capture.preEvidence.map((record) => ({ ...record, correlationIds: [...record.correlationIds] })),
      postEvidence: capture.postEvidence.map((record) => ({ ...record, correlationIds: [...record.correlationIds] })),
      horizons: capture.horizons.map((horizon): CaptureHorizonSnapshot => ({
        policy: horizon.policy,
        dueAtMs: horizon.dueAtMs,
        state: horizon.state,
        label: horizon.label,
        failure: horizon.failure === null ? null : cloneFailure(horizon.failure),
      })),
      truncation: this.#truncation(capture),
      completeness: this.#completeness(capture),
      preChecksum,
      postChecksum,
      checksum: captureChecksum(capture),
    });
  }

  #ringSnapshot(ring: RingState): CaptureRingSnapshot {
    return deepFreeze({
      symbol: ring.symbol,
      sourceId: ring.sourceId,
      retainedRecords: ring.entries.length,
      oldestSourceEventTimeMs: ring.entries[0]?.evidence.truth.temporal.sourceEventTimeMs ?? null,
      newestSourceEventTimeMs: ring.entries.at(-1)?.evidence.truth.temporal.sourceEventTimeMs ?? null,
      capacityEvictedRecords: ring.capacityEvictedRecords,
      capacityDroppedThroughEventTimeMs: ring.capacityDroppedThroughEventTimeMs,
      checksum: ringChecksum(ring),
    });
  }

  snapshot(): CaptureCoordinatorSnapshot {
    const now = this.#now();
    const rings = [...this.#rings.values()].sort((left, right) => codePointCompare(left.key, right.key)).map((ring) => this.#ringSnapshot(ring));
    const captures = [...this.#captures.values()].sort((left, right) => codePointCompare(left.id, right.id)).map((capture) => this.#captureSnapshot(capture));
    const failures = [...this.#failures.values()].sort((left, right) => codePointCompare(left.failure.id, right.failure.id)).map((entry) => ({
      failure: cloneFailure(entry.failure),
      count: entry.count,
      firstObservedAtMs: entry.firstObservedAtMs,
      lastObservedAtMs: entry.lastObservedAtMs,
    }));
    const activeCaptureCount = captures.filter((capture) => capture.finishedAtMs === null).length;
    const material = {
      snapshotTimeMs: now,
      configurationVersion: this.#config.configurationVersion,
      checkpointGeneration: this.#checkpointGeneration,
      checkpointDirty: this.#mutationVersion !== this.#persistedMutationVersion,
      ringChecksums: rings.map((ring) => ring.checksum),
      ringEvictionTombstones: [...this.#ringEvictionTombstones.values()]
        .sort((left, right) => codePointCompare(left.key, right.key)),
      ringEvictionOverflow: this.#ringEvictionOverflow,
      captureChecksums: captures.map((capture) => capture.checksum),
      failures,
      counters: [this.#evictedRingCount, this.#evictedCaptureCount, this.#evictedTriggerTombstoneCount],
    };
    return deepFreeze({
      id: stableId('runtime-capture-snapshot', material),
      snapshotTimeMs: now,
      configurationVersion: this.#config.configurationVersion,
      checkpointId: this.#config.checkpointId,
      checkpointGeneration: this.#checkpointGeneration,
      checkpointDirty: this.#mutationVersion !== this.#persistedMutationVersion,
      preRingCount: rings.length,
      retainedCaptureCount: captures.length,
      activeCaptureCount,
      completedCaptureCount: captures.length - activeCaptureCount,
      evictedRingCount: this.#evictedRingCount,
      ringEvictionTombstoneCount: this.#ringEvictionTombstones.size,
      ringEvictionOverflowDroppedRecords: this.#ringEvictionOverflow?.droppedRecords ?? 0,
      evictedCaptureCount: this.#evictedCaptureCount,
      evictedTriggerTombstoneCount: this.#evictedTriggerTombstoneCount,
      rings,
      captures,
      failures,
      authority: 'PUBLIC_EVIDENCE_CAPTURE_ONLY' as const,
      liveMoneyAuthority: 'NONE' as const,
    });
  }

  #serializeRecord(record: CaptureEvidenceRecord): unknown {
    return structuredClone({ ...record, correlationIds: [...record.correlationIds] });
  }

  #serializeRing(ring: RingState): unknown {
    return structuredClone({
      key: ring.key,
      symbol: ring.symbol,
      sourceId: ring.sourceId,
      entries: ring.entries.map((entry) => this.#serializeRecord(entry)),
      capacityEvictedRecords: ring.capacityEvictedRecords,
      capacityDroppedThroughEventTimeMs: ring.capacityDroppedThroughEventTimeMs,
      lastIngestedAtMs: ring.lastIngestedAtMs,
      checksum: ringChecksum(ring),
    });
  }

  #serializeCapture(capture: CaptureState): unknown {
    return structuredClone({
      ...capture,
      correlationIds: [...capture.correlationIds],
      requiredSourceIds: [...capture.requiredSourceIds],
      frozenRecord: capture.frozenRecord,
      preEvidence: capture.preEvidence.map((entry) => this.#serializeRecord(entry)),
      postEvidence: capture.postEvidence.map((entry) => this.#serializeRecord(entry)),
      horizons: capture.horizons.map((horizon) => ({
        policy: horizon.policy,
        dueAtMs: horizon.dueAtMs,
        state: horizon.state,
        label: horizon.label,
        failure: horizon.failure,
      })),
      checksum: captureChecksum(capture),
    });
  }

  #payload(): CheckpointPayload {
    return {
      mutationVersion: this.#mutationVersion,
      lastClockMs: this.#lastClockMs,
      evictedRingCount: this.#evictedRingCount,
      ringEvictionTombstones: [...this.#ringEvictionTombstones.values()]
        .sort((left, right) => codePointCompare(left.key, right.key))
        .map((entry) => ({ ...entry })),
      ringEvictionOverflow: this.#ringEvictionOverflow === null ? null : { ...this.#ringEvictionOverflow },
      evictedCaptureCount: this.#evictedCaptureCount,
      evictedTriggerTombstoneCount: this.#evictedTriggerTombstoneCount,
      rings: [...this.#rings.values()].sort((left, right) => codePointCompare(left.key, right.key)).map((ring) => this.#serializeRing(ring)),
      captures: [...this.#captures.values()].sort((left, right) => codePointCompare(left.id, right.id)).map((capture) => this.#serializeCapture(capture)),
      tombstones: [...this.#tombstones.values()].sort((left, right) => codePointCompare(left.triggerRequestId, right.triggerRequestId)).map((value) => ({ ...value })),
      failures: [...this.#failures.values()].sort((left, right) => codePointCompare(left.failure.id, right.failure.id)).map((entry) => ({
        failure: cloneFailure(entry.failure),
        count: entry.count,
        firstObservedAtMs: entry.firstObservedAtMs,
        lastObservedAtMs: entry.lastObservedAtMs,
      })),
    };
  }

  saveCheckpoint(): Promise<CaptureCheckpointReceipt> {
    if (this.#restoreReservation !== null) {
      return Promise.resolve(deepFreeze({
        state: 'FAILED',
        checkpointId: this.#config.checkpointId,
        generation: this.#checkpointGeneration,
        checksum: null,
        bytes: null,
        savedMutationVersion: null,
        currentMutationVersion: this.#mutationVersion,
        checkpointDirty: this.#mutationVersion !== this.#persistedMutationVersion,
        failure: this.#restoreBusyFailure('saveCheckpoint'),
      }));
    }
    if (this.#checkpointInFlight !== null) return this.#checkpointInFlight;
    const work = this.#saveCheckpoint().finally(() => {
      if (this.#checkpointInFlight === work) this.#checkpointInFlight = null;
    });
    this.#checkpointInFlight = work;
    return work;
  }

  async #saveCheckpoint(): Promise<CaptureCheckpointReceipt> {
    const now = this.#now();
    if (this.#checkpointGeneration > 0 && this.#mutationVersion === this.#persistedMutationVersion) {
      return deepFreeze({
        state: 'UNCHANGED', checkpointId: this.#config.checkpointId, generation: this.#checkpointGeneration,
        checksum: null, bytes: null, savedMutationVersion: this.#persistedMutationVersion,
        currentMutationVersion: this.#mutationVersion, checkpointDirty: false, failure: null,
      });
    }
    const savedMutationVersion = this.#mutationVersion;
    const partial: Omit<CheckpointEnvelope, 'checksum'> = {
      schemaVersion: this.#config.checkpointSchemaVersion,
      checkpointId: this.#config.checkpointId,
      configurationVersion: this.#config.configurationVersion,
      producerVersion: this.#config.producerVersion,
      generation: this.#checkpointGeneration + 1,
      savedAtMs: now,
      payload: this.#payload(),
    };
    const envelope: CheckpointEnvelope = { ...partial, checksum: checkpointChecksum(partial) };
    const bytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
    if (bytes > this.#config.maximumCheckpointBytes) {
      const failure = this.#failure('BUDGET_EXHAUSTED', 'capture checkpoint exceeds the configured byte bound', 'checkpoint', now);
      return deepFreeze({
        state: 'FAILED', checkpointId: this.#config.checkpointId, generation: this.#checkpointGeneration,
        checksum: null, bytes, savedMutationVersion: null, currentMutationVersion: this.#mutationVersion,
        checkpointDirty: true, failure,
      });
    }
    try {
      await this.#storage.save(this.#config.checkpointId, structuredClone(envelope) as unknown as JsonValue);
      this.#checkpointGeneration = envelope.generation;
      this.#persistedMutationVersion = savedMutationVersion;
      const checkpointDirty = this.#mutationVersion !== savedMutationVersion;
      return deepFreeze({
        state: checkpointDirty ? 'SAVED_DIRTY' : 'SAVED',
        checkpointId: this.#config.checkpointId,
        generation: envelope.generation,
        checksum: envelope.checksum,
        bytes,
        savedMutationVersion,
        currentMutationVersion: this.#mutationVersion,
        checkpointDirty,
        failure: null,
      });
    } catch {
      const failure = this.#failure('UNAVAILABLE', 'capture checkpoint storage save failed', 'storage.save', now);
      return deepFreeze({
        state: 'FAILED', checkpointId: this.#config.checkpointId, generation: this.#checkpointGeneration,
        checksum: envelope.checksum, bytes, savedMutationVersion: null, currentMutationVersion: this.#mutationVersion,
        checkpointDirty: true, failure,
      });
    }
  }

  #parseRecord(value: unknown, maximumAtMs: number): CaptureEvidenceRecord {
    if (!object(value) || !safeInteger(value.ingestedAtMs) || value.ingestedAtMs > maximumAtMs
      || !Array.isArray(value.correlationIds) || !validChecksum(value.checksum)) throw new TypeError('checkpoint evidence record is invalid');
    let rawChecksum: string;
    try {
      rawChecksum = checksumValue(value.evidence);
    } catch {
      throw new TypeError('checkpoint evidence checksum could not be verified');
    }
    if (rawChecksum !== value.checksum) throw new TypeError('checkpoint evidence checksum mismatch');
    const correlations = this.#correlations(value.correlationIds as string[], 'checkpoint.correlationIds');
    const record = this.#evidenceRecord(value.evidence as NormalizedEvidence, correlations, value.ingestedAtMs);
    if (record.checksum !== value.checksum) throw new TypeError('checkpoint evidence checksum mismatch');
    return record;
  }

  #parseRing(value: unknown, now: number): RingState {
    if (!object(value) || typeof value.key !== 'string' || typeof value.symbol !== 'string' || typeof value.sourceId !== 'string'
      || !Array.isArray(value.entries) || value.entries.length > this.#config.maximumPreEvidencePerRing
      || !safeInteger(value.capacityEvictedRecords) || !(value.capacityDroppedThroughEventTimeMs === null || safeInteger(value.capacityDroppedThroughEventTimeMs))
      || !safeInteger(value.lastIngestedAtMs) || value.lastIngestedAtMs > now || !validChecksum(value.checksum)) {
      throw new TypeError('checkpoint ring is invalid');
    }
    const symbol = canonicalSymbol(value.symbol, 'checkpoint.ring.symbol');
    const sourceId = boundedText(value.sourceId, 'checkpoint.ring.sourceId', 256);
    const key = this.#ringKey(symbol, sourceId);
    if (key !== value.key) throw new TypeError('checkpoint ring identity mismatch');
    const entries = value.entries.map((entry) => this.#parseRecord(entry, now)).sort(recordCompare);
    if (new Set(entries.map((entry) => entry.evidence.id)).size !== entries.length) {
      throw new TypeError('checkpoint ring contains duplicate evidence IDs');
    }
    if (entries.some((entry) => canonicalSymbol(entry.evidence.instrument.symbol) !== symbol || entry.evidence.truth.authority.sourceId !== sourceId)) {
      throw new TypeError('checkpoint ring contains cross-symbol or cross-source evidence');
    }
    if (entries.some((entry) => entry.ingestedAtMs > (value.lastIngestedAtMs as number))
      || ((value.capacityEvictedRecords as number) === 0) !== (value.capacityDroppedThroughEventTimeMs === null)) {
      throw new TypeError('checkpoint ring retention metadata is inconsistent');
    }
    const ring: RingState = {
      key,
      symbol,
      sourceId,
      entries,
      capacityEvictedRecords: value.capacityEvictedRecords,
      capacityDroppedThroughEventTimeMs: value.capacityDroppedThroughEventTimeMs,
      lastIngestedAtMs: value.lastIngestedAtMs,
    };
    if (ringChecksum(ring) !== value.checksum) throw new TypeError('checkpoint ring checksum mismatch');
    return ring;
  }

  #parseHorizon(value: unknown, capture: { frozen: FrozenPreEventRecord; triggerTimeMs: number }): HorizonState {
    if (!object(value) || !safeInteger(value.dueAtMs) || !['PENDING', 'COMPLETE', 'INCOMPLETE', 'TRUNCATED', 'FAILED'].includes(String(value.state))) {
      throw new TypeError('checkpoint horizon is invalid');
    }
    const policy = normalizeOutcomePolicy(value.policy as OutcomePolicySnapshot);
    if (!policy.ok || capture.triggerTimeMs + policy.value.horizonMs !== value.dueAtMs) throw new TypeError('checkpoint horizon policy mismatch');
    let label: AttributedOutcomeLabel | null = null;
    if (value.label !== null) {
      const validated = validateOutcomeLabel(value.label);
      if (!validated.ok || validated.value.frozenRecordId !== capture.frozen.id || validated.value.policy.id !== policy.value.id) {
        throw new TypeError('checkpoint horizon label mismatch');
      }
      label = validated.value;
    }
    const failure = value.failure === null ? null : parseFailure(value.failure);
    if (value.failure !== null && failure === null) throw new TypeError('checkpoint horizon failure is invalid');
    if ((value.state === 'COMPLETE' || value.state === 'INCOMPLETE') && (label === null || label.state !== value.state)) {
      throw new TypeError('checkpoint horizon state conflicts with label');
    }
    if ((value.state === 'COMPLETE' || value.state === 'INCOMPLETE')
      && (failure !== null || label?.observationTimeMs !== value.dueAtMs)) {
      throw new TypeError('checkpoint attributed horizon carries inconsistent terminal data');
    }
    if ((value.state === 'TRUNCATED' || value.state === 'FAILED') && (label !== null || failure === null)) {
      throw new TypeError('checkpoint failed horizon carries inconsistent terminal data');
    }
    if (value.state === 'PENDING' && (label !== null || failure !== null)) throw new TypeError('pending checkpoint horizon carries terminal data');
    return { policy: policy.value, dueAtMs: value.dueAtMs, state: value.state as CaptureHorizonState, label, failure };
  }

  #parseCapture(value: unknown, now: number): CaptureState {
    if (!object(value) || typeof value.id !== 'string' || typeof value.triggerRequestId !== 'string'
      || !validChecksum(value.requestFingerprint) || !validChecksum(value.triggerFingerprint)
      || typeof value.symbol !== 'string' || typeof value.instrumentId !== 'string' || !safeInteger(value.triggerTimeMs)
      || !safeInteger(value.evidenceCutoffTimeMs) || !safeInteger(value.preWindowStartMs) || !safeInteger(value.postWindowEndMs)
      || !safeInteger(value.createdAtMs) || !(value.finishedAtMs === null || safeInteger(value.finishedAtMs))
      || !Array.isArray(value.correlationIds) || !Array.isArray(value.requiredSourceIds)
      || !Array.isArray(value.preEvidence) || value.preEvidence.length > this.#config.maximumFreezeEvidence
      || !Array.isArray(value.postEvidence) || value.postEvidence.length > this.#config.maximumPostEvidencePerCapture
      || !Array.isArray(value.horizons) || value.horizons.length === 0 || value.horizons.length > this.#config.maximumPoliciesPerCapture
      || typeof value.preTruncated !== 'boolean' || typeof value.postTruncated !== 'boolean'
      || !safeInteger(value.preDroppedRecords) || !safeInteger(value.postDroppedRecords)
      || !Array.isArray(value.missingRequiredSourceIds) || !validChecksum(value.checksum)) {
      throw new TypeError('checkpoint capture is invalid');
    }
    const frozen = validateFrozenPreEventRecord(value.frozenRecord);
    if (!frozen.ok) throw new TypeError(frozen.failure.message);
    const symbol = canonicalSymbol(value.symbol, 'checkpoint.capture.symbol');
    const correlations = this.#correlations(value.correlationIds as string[], 'checkpoint.capture.correlationIds');
    const requiredSources = this.#sourceIds(value.requiredSourceIds as string[], 'checkpoint.capture.requiredSourceIds');
    const missingSources = sortedUnique((value.missingRequiredSourceIds as unknown[]).map((entry, index) =>
      boundedText(entry, `checkpoint.capture.missingRequiredSourceIds[${index}]`, 256)));
    if (missingSources.some((sourceId) => !requiredSources.includes(sourceId))) throw new TypeError('checkpoint missing source is not required');
    const triggerTimeMs = value.triggerTimeMs as number;
    const evidenceCutoffTimeMs = value.evidenceCutoffTimeMs as number;
    const preWindowStartMs = value.preWindowStartMs as number;
    const postWindowEndMs = value.postWindowEndMs as number;
    const createdAtMs = value.createdAtMs as number;
    const finishedAtMs = value.finishedAtMs as number | null;
    if (triggerTimeMs > now || evidenceCutoffTimeMs !== triggerTimeMs || createdAtMs !== triggerTimeMs
      || preWindowStartMs !== Math.max(0, triggerTimeMs - this.#config.preTriggerWindowMs)
      || postWindowEndMs <= triggerTimeMs || postWindowEndMs - triggerTimeMs > this.#config.maximumPostWindowMs
      || frozen.value.triggerTimeMs !== triggerTimeMs || frozen.value.evidenceCutoffTimeMs !== evidenceCutoffTimeMs
      || frozen.value.thesis.instrumentId !== value.instrumentId) throw new TypeError('checkpoint capture time or frozen identity mismatch');
    const preEvidence = value.preEvidence.map((entry) => this.#parseRecord(entry, triggerTimeMs)).sort(recordCompare);
    const postEvidence = value.postEvidence.map((entry) => this.#parseRecord(entry, postWindowEndMs)).sort(recordCompare);
    const allEvidenceIds = [...preEvidence, ...postEvidence].map((entry) => entry.evidence.id);
    if (new Set(allEvidenceIds).size !== allEvidenceIds.length) throw new TypeError('checkpoint capture contains duplicate evidence IDs');
    if (preEvidence.some((entry) => (entry.evidence.truth.temporal.sourceEventTimeMs as number) > triggerTimeMs)
      || postEvidence.some((entry) => {
        const eventTime = entry.evidence.truth.temporal.sourceEventTimeMs as number;
        return eventTime <= triggerTimeMs || eventTime > postWindowEndMs || canonicalSymbol(entry.evidence.instrument.symbol) !== symbol;
      })) throw new TypeError('checkpoint capture violates pre/post separation');
    const horizons = value.horizons.map((entry) => this.#parseHorizon(entry, { frozen: frozen.value, triggerTimeMs }));
    const sortedHorizonIds = [...horizons]
      .sort((left, right) => left.policy.horizonMs - right.policy.horizonMs || codePointCompare(left.policy.id, right.policy.id))
      .map((horizon) => horizon.policy.id);
    if (new Set(sortedHorizonIds).size !== sortedHorizonIds.length
      || canonicalJson(sortedHorizonIds) !== canonicalJson(horizons.map((horizon) => horizon.policy.id))
      || horizons.some((horizon) => horizon.dueAtMs > postWindowEndMs)) {
      throw new TypeError('checkpoint capture horizon set is inconsistent');
    }
    const capture: CaptureState = {
      id: value.id,
      triggerRequestId: boundedText(value.triggerRequestId, 'checkpoint.capture.triggerRequestId', 256),
      requestFingerprint: value.requestFingerprint,
      triggerFingerprint: value.triggerFingerprint,
      symbol,
      instrumentId: value.instrumentId,
      triggerTimeMs,
      evidenceCutoffTimeMs,
      preWindowStartMs,
      postWindowEndMs,
      createdAtMs,
      finishedAtMs,
      correlationIds: correlations,
      requiredSourceIds: requiredSources,
      frozenRecord: frozen.value,
      preEvidence,
      postEvidence,
      horizons,
      preTruncated: value.preTruncated,
      postTruncated: value.postTruncated,
      preDroppedRecords: value.preDroppedRecords,
      postDroppedRecords: value.postDroppedRecords,
      missingRequiredSourceIds: missingSources,
    };
    const expectedId = stableId('runtime-capture', {
      triggerRequestId: capture.triggerRequestId,
      requestFingerprint: capture.requestFingerprint,
      frozenRecordId: capture.frozenRecord.id,
      postWindowMs: capture.postWindowEndMs - capture.triggerTimeMs,
      policyIds: capture.horizons.map((horizon) => horizon.policy.id),
    });
    const expectedFingerprint = checksumParts([{
      triggerRequestId: capture.triggerRequestId,
      symbol: capture.symbol,
      correlationIds: capture.correlationIds,
      requiredSourceIds: capture.requiredSourceIds,
      frozenRecordId: capture.frozenRecord.id,
      requestFingerprint: capture.requestFingerprint,
      postWindowMs: capture.postWindowEndMs - capture.triggerTimeMs,
      policyIds: capture.horizons.map((horizon) => horizon.policy.id),
    }]);
    const frozenEvidenceIds = sortedUnique(capture.frozenRecord.evidence.map((evidence) => evidence.id));
    const preEvidenceIds = sortedUnique(capture.preEvidence.map((entry) => entry.evidence.id));
    if (canonicalJson(frozenEvidenceIds) !== canonicalJson(preEvidenceIds)) throw new TypeError('checkpoint pre evidence conflicts with frozen evidence');
    const expectedMissingSources = capture.requiredSourceIds.filter((sourceId) =>
      !capture.preEvidence.some((entry) => entry.evidence.truth.authority.sourceId === sourceId));
    if (canonicalJson(expectedMissingSources) !== canonicalJson(capture.missingRequiredSourceIds)
      || capture.preTruncated !== (capture.preDroppedRecords > 0)
      || capture.postTruncated !== (capture.postDroppedRecords > 0)) {
      throw new TypeError('checkpoint capture completeness metadata is inconsistent');
    }
    if (capture.finishedAtMs !== null && (
      capture.finishedAtMs !== capture.postWindowEndMs || capture.horizons.some((horizon) => horizon.state === 'PENDING')
    )) throw new TypeError('checkpoint finalized capture is inconsistent');
    if (capture.id !== expectedId || capture.triggerFingerprint !== expectedFingerprint || captureChecksum(capture) !== value.checksum) {
      throw new TypeError('checkpoint capture checksum or identity mismatch');
    }
    return capture;
  }

  #parseRingEvictionTombstone(value: unknown, now: number): RingEvictionTombstone {
    if (!object(value) || typeof value.key !== 'string' || typeof value.symbol !== 'string'
      || typeof value.sourceId !== 'string' || !safeInteger(value.droppedRecords) || value.droppedRecords < 1
      || !safeInteger(value.droppedThroughEventTimeMs) || !safeInteger(value.evictedAtMs)
      || value.evictedAtMs > now || value.droppedThroughEventTimeMs > value.evictedAtMs) {
      throw new TypeError('checkpoint ring eviction tombstone is invalid');
    }
    const symbol = canonicalSymbol(value.symbol, 'checkpoint.ringEviction.symbol');
    const sourceId = boundedText(value.sourceId, 'checkpoint.ringEviction.sourceId', 256);
    const key = this.#ringKey(symbol, sourceId);
    if (key !== value.key) throw new TypeError('checkpoint ring eviction identity mismatch');
    return {
      key,
      symbol,
      sourceId,
      droppedRecords: value.droppedRecords,
      droppedThroughEventTimeMs: value.droppedThroughEventTimeMs,
      evictedAtMs: value.evictedAtMs,
    };
  }

  restore(): Promise<CaptureRestoreReceipt> {
    if (this.#restoreInFlight !== null) return this.#restoreInFlight;
    const now = this.#now();
    if (this.#checkpointInFlight !== null) {
      const failure = this.#failure('UNAVAILABLE', 'capture restore cannot overlap checkpoint save', 'restore', now);
      return Promise.resolve(deepFreeze({
        state: 'FAILED', checkpointId: this.#config.checkpointId, generation: this.#checkpointGeneration,
        restoredRings: 0, restoredCaptures: 0, checksum: null, failure,
      }));
    }
    if (this.#rings.size > 0 || this.#ringEvictionTombstones.size > 0 || this.#ringEvictionOverflow !== null
      || this.#captures.size > 0 || this.#tombstones.size > 0 || this.#failures.size > 0
      || this.#checkpointGeneration > 0 || this.#mutationVersion !== 0 || this.#persistedMutationVersion !== -1
      || this.#evictedRingCount !== 0 || this.#evictedCaptureCount !== 0 || this.#evictedTriggerTombstoneCount !== 0) {
      const failure = this.#failure('INVALID_VALUE', 'capture restore requires pristine coordinator state', 'restore', now);
      return Promise.resolve(deepFreeze({
        state: 'FAILED', checkpointId: this.#config.checkpointId, generation: this.#checkpointGeneration,
        restoredRings: 0, restoredCaptures: 0, checksum: null, failure,
      }));
    }
    const reservation: RestoreReservation = {
      id: this.#nextRestoreReservationId,
      mutationVersion: this.#mutationVersion,
    };
    this.#nextRestoreReservationId = reservation.id === Number.MAX_SAFE_INTEGER ? 1 : reservation.id + 1;
    this.#restoreReservation = reservation;
    const work = this.#restoreReserved(now, reservation).finally(() => {
      if (this.#restoreReservation?.id === reservation.id) this.#restoreReservation = null;
      if (this.#restoreInFlight === work) this.#restoreInFlight = null;
    });
    this.#restoreInFlight = work;
    return work;
  }

  async #restoreReserved(now: number, reservation: RestoreReservation): Promise<CaptureRestoreReceipt> {
    let loaded: JsonValue | null;
    try {
      loaded = await this.#storage.load(this.#config.checkpointId);
    } catch {
      const failure = this.#failure('UNAVAILABLE', 'capture checkpoint storage load failed', 'storage.load', now);
      return deepFreeze({ state: 'FAILED', checkpointId: this.#config.checkpointId, generation: 0, restoredRings: 0, restoredCaptures: 0, checksum: null, failure });
    }
    if (loaded === null) {
      if (this.#restoreReservation?.id !== reservation.id || this.#mutationVersion !== reservation.mutationVersion) {
        const failure = this.#failure('INTERNAL_CONTRACT_ERROR', 'capture restore reservation was violated', 'restore', now);
        return deepFreeze({ state: 'FAILED', checkpointId: this.#config.checkpointId, generation: 0, restoredRings: 0, restoredCaptures: 0, checksum: null, failure });
      }
      this.#persistedMutationVersion = this.#mutationVersion;
      return deepFreeze({ state: 'EMPTY', checkpointId: this.#config.checkpointId, generation: 0, restoredRings: 0, restoredCaptures: 0, checksum: null, failure: null });
    }
    try {
      if (Buffer.byteLength(JSON.stringify(loaded), 'utf8') > this.#config.maximumCheckpointBytes) {
        throw new RangeError('capture checkpoint exceeds the configured byte bound');
      }
      if (!object(loaded) || loaded.schemaVersion !== this.#config.checkpointSchemaVersion
        || loaded.checkpointId !== this.#config.checkpointId || loaded.configurationVersion !== this.#config.configurationVersion
        || loaded.producerVersion !== this.#config.producerVersion || !safeInteger(loaded.generation) || loaded.generation < 1
        || !safeInteger(loaded.savedAtMs) || loaded.savedAtMs > now || !object(loaded.payload) || !validChecksum(loaded.checksum)) {
        throw new TypeError('capture checkpoint envelope is invalid or incompatible');
      }
      const payloadValue = loaded.payload;
      if (!safeInteger(payloadValue.mutationVersion) || !safeInteger(payloadValue.lastClockMs) || payloadValue.lastClockMs > now
        || !safeInteger(payloadValue.evictedRingCount) || !Array.isArray(payloadValue.ringEvictionTombstones)
        || payloadValue.ringEvictionTombstones.length > this.#config.maximumRingEvictionTombstones
        || !(payloadValue.ringEvictionOverflow === null || object(payloadValue.ringEvictionOverflow))
        || !safeInteger(payloadValue.evictedCaptureCount)
        || !safeInteger(payloadValue.evictedTriggerTombstoneCount) || !Array.isArray(payloadValue.rings)
        || payloadValue.rings.length > this.#config.maximumPreRings || !Array.isArray(payloadValue.captures)
        || payloadValue.captures.length > this.#config.maximumRetainedCaptures || !Array.isArray(payloadValue.tombstones)
        || payloadValue.tombstones.length > this.#config.maximumTriggerTombstones || !Array.isArray(payloadValue.failures)
        || payloadValue.failures.length > this.#config.maximumFailureRecords) throw new TypeError('capture checkpoint payload is invalid');
      const partial: Omit<CheckpointEnvelope, 'checksum'> = {
        schemaVersion: '1',
        checkpointId: loaded.checkpointId,
        configurationVersion: loaded.configurationVersion,
        producerVersion: loaded.producerVersion,
        generation: loaded.generation,
        savedAtMs: loaded.savedAtMs,
        payload: payloadValue as unknown as CheckpointPayload,
      };
      if (checkpointChecksum(partial) !== loaded.checksum) throw new TypeError('capture checkpoint checksum mismatch');
      const rings = new Map<string, RingState>();
      for (const entry of payloadValue.rings) {
        const ring = this.#parseRing(entry, now);
        if (rings.has(ring.key)) throw new TypeError('duplicate checkpoint ring');
        rings.set(ring.key, ring);
      }
      const ringEvictionTombstones = new Map<string, RingEvictionTombstone>();
      for (const entry of payloadValue.ringEvictionTombstones) {
        const tombstone = this.#parseRingEvictionTombstone(entry, now);
        if (ringEvictionTombstones.has(tombstone.key)) throw new TypeError('duplicate checkpoint ring eviction tombstone');
        ringEvictionTombstones.set(tombstone.key, tombstone);
      }
      let ringEvictionOverflow: RingEvictionOverflow | null = null;
      if (payloadValue.ringEvictionOverflow !== null) {
        const overflow = payloadValue.ringEvictionOverflow;
        if (!safeInteger(overflow.droppedRecords) || overflow.droppedRecords < 1
          || !safeInteger(overflow.droppedThroughEventTimeMs) || !safeInteger(overflow.observedAtMs)
          || overflow.observedAtMs > now || overflow.droppedThroughEventTimeMs > overflow.observedAtMs) {
          throw new TypeError('checkpoint ring eviction overflow is invalid');
        }
        ringEvictionOverflow = {
          droppedRecords: overflow.droppedRecords,
          droppedThroughEventTimeMs: overflow.droppedThroughEventTimeMs,
          observedAtMs: overflow.observedAtMs,
        };
      }
      const captures = new Map<string, CaptureState>();
      for (const entry of payloadValue.captures) {
        const capture = this.#parseCapture(entry, now);
        if (captures.has(capture.id)) throw new TypeError('duplicate checkpoint capture');
        captures.set(capture.id, capture);
      }
      if ([...captures.values()].filter((capture) => capture.finishedAtMs === null).length > this.#config.maximumActiveCaptures
        || new Set([...captures.values()].map((capture) => capture.triggerRequestId)).size !== captures.size) {
        throw new TypeError('checkpoint capture capacity or trigger identity is inconsistent');
      }
      const tombstones = new Map<string, TriggerTombstone>();
      for (const entry of payloadValue.tombstones) {
        if (!object(entry) || typeof entry.triggerRequestId !== 'string' || typeof entry.captureId !== 'string'
          || !validChecksum(entry.requestFingerprint) || !validChecksum(entry.triggerFingerprint)
          || !safeInteger(entry.observedAtMs) || entry.observedAtMs > now) throw new TypeError('checkpoint tombstone is invalid');
        const tombstone = {
          triggerRequestId: boundedText(entry.triggerRequestId, 'checkpoint.tombstone.triggerRequestId', 256),
          captureId: entry.captureId,
          requestFingerprint: entry.requestFingerprint,
          triggerFingerprint: entry.triggerFingerprint,
          observedAtMs: entry.observedAtMs,
        };
        if (tombstones.has(tombstone.triggerRequestId)) throw new TypeError('duplicate checkpoint tombstone');
        tombstones.set(tombstone.triggerRequestId, tombstone);
      }
      for (const capture of captures.values()) {
        const tombstone = tombstones.get(capture.triggerRequestId);
        if (!tombstone || tombstone.captureId !== capture.id || tombstone.requestFingerprint !== capture.requestFingerprint
          || tombstone.triggerFingerprint !== capture.triggerFingerprint) {
          throw new TypeError('checkpoint capture tombstone is missing or inconsistent');
        }
      }
      for (const tombstone of tombstones.values()) {
        const capture = captures.get(tombstone.captureId);
        if (capture && (capture.triggerRequestId !== tombstone.triggerRequestId
          || capture.requestFingerprint !== tombstone.requestFingerprint
          || capture.triggerFingerprint !== tombstone.triggerFingerprint)) {
          throw new TypeError('checkpoint tombstone conflicts with a retained capture');
        }
      }
      const failures = new Map<string, CaptureFailureRecord>();
      for (const entry of payloadValue.failures) {
        if (!object(entry) || !safeInteger(entry.count) || entry.count < 1 || !safeInteger(entry.firstObservedAtMs)
          || !safeInteger(entry.lastObservedAtMs) || entry.firstObservedAtMs > entry.lastObservedAtMs || entry.lastObservedAtMs > now) {
          throw new TypeError('checkpoint failure record is invalid');
        }
        const failure = parseFailure(entry.failure);
        if (!failure || failures.has(failure.id)) throw new TypeError('checkpoint failure is invalid or duplicate');
        failures.set(failure.id, { failure, count: entry.count, firstObservedAtMs: entry.firstObservedAtMs, lastObservedAtMs: entry.lastObservedAtMs });
      }
      if (this.#restoreReservation?.id !== reservation.id || this.#mutationVersion !== reservation.mutationVersion
        || this.#rings.size > 0 || this.#ringEvictionTombstones.size > 0 || this.#ringEvictionOverflow !== null
        || this.#captures.size > 0 || this.#tombstones.size > 0 || this.#failures.size > 0) {
        throw new TypeError('capture restore reservation was violated before commit');
      }
      this.#rings = rings;
      this.#ringEvictionTombstones = ringEvictionTombstones;
      this.#ringEvictionOverflow = ringEvictionOverflow;
      this.#captures = captures;
      this.#tombstones = tombstones;
      this.#failures = failures;
      this.#mutationVersion = payloadValue.mutationVersion;
      this.#persistedMutationVersion = payloadValue.mutationVersion;
      this.#checkpointGeneration = loaded.generation;
      this.#lastClockMs = Math.max(this.#lastClockMs, payloadValue.lastClockMs);
      this.#evictedRingCount = payloadValue.evictedRingCount;
      this.#evictedCaptureCount = payloadValue.evictedCaptureCount;
      this.#evictedTriggerTombstoneCount = payloadValue.evictedTriggerTombstoneCount;
      return deepFreeze({
        state: 'RESTORED', checkpointId: this.#config.checkpointId, generation: loaded.generation,
        restoredRings: rings.size, restoredCaptures: captures.size, checksum: loaded.checksum, failure: null,
      });
    } catch (error) {
      const failure = this.#failure(
        'INVALID_VALUE',
        error instanceof Error ? error.message : 'capture checkpoint is invalid',
        'checkpoint',
        now,
      );
      return deepFreeze({ state: 'FAILED', checkpointId: this.#config.checkpointId, generation: 0, restoredRings: 0, restoredCaptures: 0, checksum: null, failure });
    }
  }
}

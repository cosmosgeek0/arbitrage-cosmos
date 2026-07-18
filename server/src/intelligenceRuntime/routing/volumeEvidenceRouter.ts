import {
  makeStableFailure,
  sortedUnique,
  validateNormalizedEvidence,
  type NormalizedEvidence,
  type StableFailure,
} from '../../intelligenceFoundation/contracts/index.js';
import { BINANCE_SOURCE_FACTS } from '../../intelligenceFoundation/evidence/index.js';
import type { BinanceSourceFact } from '../../intelligenceFoundation/evidence/index.js';
import { RUNTIME_LIFECYCLE_STATES, type RuntimeRateBudgetState } from '../contracts/index.js';
import type {
  EvidenceRouteState,
  RegisteredEvidenceBatch,
  RegisteredEvidenceRouteReceipt,
  RegisteredEvidenceSourceCut,
  VolumeEvidenceCapability,
  VolumeEvidenceCapabilityTruth,
  VolumeEvidenceRouterOptions,
  VolumeEvidenceRoutingSnapshot,
} from './types.js';
import { VOLUME_EVIDENCE_CAPABILITIES } from './types.js';

const COMPONENT = 'intelligence.runtime.routing.volume_evidence';
const DEFAULT_MAXIMUM_BATCH = 4_096;
const DEFAULT_MAXIMUM_SERIES = 16_384;
const DEFAULT_MAXIMUM_FAILURE_RECORDS = 512;
const MAXIMUM_BATCH_HARD_LIMIT = 100_000;
const MAXIMUM_SERIES_HARD_LIMIT = 100_000;
const MAXIMUM_FAILURE_HARD_LIMIT = 10_000;

type Requirement =
  | 'SPOT_TRADE'
  | 'SPOT_BOOK'
  | 'SPOT_DEPTH'
  | 'SPOT_PRICE'
  | 'PERPETUAL_PRICE'
  | 'OPEN_INTEREST'
  | 'FUNDING'
  | 'LIQUIDATION'
  | 'CONTEXT';

interface Observation {
  readonly joinKey: string;
  readonly evidenceTimeMs: number;
  readonly maxAgeMs: number;
  readonly sourceId: string;
  readonly dataset: string;
  readonly freshness: 'FRESH' | 'STALE';
  readonly completeness: 'COMPLETE' | 'PARTIAL' | 'SAMPLED';
}

interface SeriesWatermark {
  readonly evidenceTimeMs: number;
  readonly evidenceId: string;
  readonly sequenceLast: string | null;
  readonly depthSynchronized: boolean;
  readonly sourceId: string;
  readonly dataset: string;
  readonly productFamily: NormalizedEvidence['instrument']['productFamily'];
  readonly freshnessBasis: NormalizedEvidence['truth']['freshness']['basis'];
}

interface ContiguousGapState {
  readonly targetLast: string;
  readonly anchored: boolean;
}

interface BoundSourceLifecycle {
  readonly sourceId: string;
  readonly dataset: string;
  readonly endpointClass: RegisteredEvidenceSourceCut['endpointClass'];
  readonly lifecycle: RegisteredEvidenceSourceCut['lifecycle'];
  readonly generation: number;
  readonly revision: number;
  readonly closed: boolean;
  readonly bootstrapped: boolean;
}

interface SourceLifecycleAdmission {
  readonly failure: StableFailure | null;
  /**
   * The source supplied a structurally eligible bootstrap claim, but the
   * router has not yet proved every evidence row or reconciled the whole cut
   * through the canonical sink.
   */
  readonly pendingBootstrap: boolean;
}

interface RouterCounters {
  routed: number;
  duplicate: number;
  rejected: number;
  stale: number;
  sampled: number;
  rateLimited: number;
  outOfOrder: number;
  sequenceGaps: number;
}

const CAPABILITY_REQUIREMENTS = Object.freeze({
  ROLLING_ACTIVITY_FLOW: Object.freeze(['SPOT_TRADE'] as const),
  SPREAD_DEPTH_BOOK: Object.freeze(['SPOT_BOOK', 'SPOT_DEPTH'] as const),
  CROSS_MARKET_LEADERSHIP: Object.freeze(['SPOT_PRICE', 'PERPETUAL_PRICE'] as const),
  OPEN_INTEREST: Object.freeze(['OPEN_INTEREST'] as const),
  FUNDING: Object.freeze(['FUNDING'] as const),
  VOLATILITY: Object.freeze(['SPOT_TRADE'] as const),
  LIQUIDATION: Object.freeze(['LIQUIDATION'] as const),
  CONTEXT: Object.freeze(['CONTEXT'] as const),
}) satisfies Readonly<Record<Exclude<VolumeEvidenceCapability, 'SOURCE_QUALITY'>, readonly Requirement[]>>;

const REQUIRED_QUALITY_CAPABILITIES = Object.freeze(
  VOLUME_EVIDENCE_CAPABILITIES.filter((capability) => capability !== 'SOURCE_QUALITY'),
) as readonly Exclude<VolumeEvidenceCapability, 'SOURCE_QUALITY'>[];

const PUBLIC_FACTS: readonly BinanceSourceFact[] = Object.freeze(
  Object.values(BINANCE_SOURCE_FACTS)
    .filter((fact) => fact.productFamily === 'SPOT'
      || fact.productFamily === 'USD_M_PERPETUAL'
      || fact.productFamily === 'ANY'),
);

const ACTIVE_LIFECYCLES = new Set(['LIVE', 'SILENT', 'STALE', 'DEGRADED', 'BACKING_OFF', 'RATE_LIMITED']);
const CLOSED_LIFECYCLES = new Set(['STOPPED', 'FAILED']);
const STALE_LIFECYCLES = new Set(['SILENT', 'STALE', 'DEGRADED', 'BACKING_OFF', 'RATE_LIMITED']);
const RATE_BUDGET_STATES = new Set(['AVAILABLE', 'NEAR_LIMIT', 'EXHAUSTED', 'COOLDOWN', 'UNKNOWN']);

function boundedInteger(value: number | undefined, fallback: number, name: string, maximum: number): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) {
    throw new RangeError(`${name} must be an integer in [1, ${maximum}]`);
  }
  return candidate;
}

function safeTime(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value as number;
}

function evidenceTimeAtBasis(
  evidence: NormalizedEvidence,
  basis: BinanceSourceFact['freshnessBasis'] | NormalizedEvidence['truth']['freshness']['basis'],
): number | null {
  if (basis === 'SOURCE_EVENT_TIME') return evidence.truth.temporal.sourceEventTimeMs;
  if (basis === 'SOURCE_TRANSACTION_TIME') return evidence.truth.temporal.sourceTransactionTimeMs;
  if (basis === 'RECEIVE_TIME') return evidence.truth.temporal.receivedTimeMs;
  return null;
}

function ownerEvidenceSortTime(evidence: NormalizedEvidence, fact: BinanceSourceFact): number {
  return evidenceTimeAtBasis(evidence, fact.freshnessBasis)
    ?? evidence.truth.temporal.receivedTimeMs;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function numericSequence(value: string): bigint | null {
  // Foundation admits decimal digit strings, including zero-padded source
  // identifiers. Compare their numeric meaning here so padding cannot route a
  // regressive update through the non-numeric continuity fallback.
  if (!/^[0-9]+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function rateBudgetIsValid(value: RuntimeRateBudgetState): boolean {
  if (!value || typeof value !== 'object' || !RATE_BUDGET_STATES.has(value.state)) return false;
  for (const field of ['usedWeight', 'limit', 'intervalMs', 'resetsAtMs', 'retryAfterMs', 'observedAtMs'] as const) {
    const candidate = value[field];
    if (candidate !== null && (!Number.isSafeInteger(candidate) || candidate < 0)) return false;
  }
  if (value.usedWeight !== null && value.limit !== null && value.usedWeight > value.limit) return false;
  return true;
}

function sourceFailure(source: RegisteredEvidenceSourceCut, nowMs: number): StableFailure | null {
  if (!source || typeof source !== 'object') {
    return makeStableFailure('MISSING_SOURCE', COMPONENT, 'a registered source cut is required', 'source');
  }
  if (typeof source.sourceId !== 'string' || source.sourceId.length < 1 || source.sourceId.length > 256
      || typeof source.dataset !== 'string' || source.dataset.length < 1 || source.dataset.length > 256) {
    return makeStableFailure('MISSING_SOURCE', COMPONENT, 'source identity is missing or unbounded', 'source');
  }
  if (!['PUBLIC', 'MARKET', 'REST', 'INJECTED', 'UNKNOWN'].includes(source.endpointClass)
      || !RUNTIME_LIFECYCLE_STATES.includes(source.lifecycle)
      || !['CONTIGUOUS', 'GAP', 'UNKNOWN'].includes(source.continuity)
      || !['NONE', 'CURRENT_SNAPSHOT', 'CONTIGUOUS_OWNER'].includes(source.bootstrap)
      || !['COMPLETE', 'PARTIAL', 'SAMPLED', 'UNAVAILABLE', 'UNKNOWN'].includes(source.authority)
      || !rateBudgetIsValid(source.rateBudget)) {
    return makeStableFailure('INVALID_VALUE', COMPONENT, 'source cut has an invalid lifecycle, authority, continuity, or rate budget', 'source');
  }
  if (!Number.isSafeInteger(source.generation) || source.generation < 1
      || !Number.isSafeInteger(source.revision) || source.revision < 1) {
    return makeStableFailure(
      'INVALID_VALUE', COMPONENT,
      'source lifecycle generation and revision must be positive safe integers',
      'source.generation',
    );
  }
  if (!Number.isSafeInteger(source.observedAtMs) || source.observedAtMs < 0 || source.observedAtMs > nowMs) {
    return makeStableFailure('TIMESTAMP_SKEW', COMPONENT, 'source cut observation time is invalid', 'source.observedAtMs');
  }
  return null;
}

function factFor(source: RegisteredEvidenceSourceCut): BinanceSourceFact | null {
  return PUBLIC_FACTS.find((fact) => fact.sourceId === source.sourceId
    && fact.dataset === source.dataset
    && fact.endpointClass === source.endpointClass) ?? null;
}

function requirementsFor(evidence: NormalizedEvidence): readonly Requirement[] {
  const spot = evidence.instrument.productFamily === 'SPOT';
  switch (evidence.kind) {
    case 'TRADE':
      return spot ? ['SPOT_TRADE', 'SPOT_PRICE'] : ['PERPETUAL_PRICE'];
    case 'BOOK_TICKER':
      return spot ? ['SPOT_BOOK', 'SPOT_PRICE'] : ['PERPETUAL_PRICE'];
    case 'DEPTH_SNAPSHOT':
    case 'DEPTH_DELTA':
      return spot ? ['SPOT_DEPTH'] : [];
    case 'MARK_PRICE': return ['PERPETUAL_PRICE'];
    case 'OPEN_INTEREST': return ['OPEN_INTEREST'];
    case 'FUNDING': return ['FUNDING'];
    case 'LIQUIDATION': return ['LIQUIDATION'];
    case 'CONTEXT': return ['CONTEXT'];
    default: return [];
  }
}

function seriesKind(evidence: NormalizedEvidence): string {
  return evidence.kind === 'DEPTH_SNAPSHOT' || evidence.kind === 'DEPTH_DELTA' ? 'DEPTH' : evidence.kind;
}

function seriesKey(evidence: NormalizedEvidence): string {
  if (evidence.kind === 'DEPTH_SNAPSHOT' || evidence.kind === 'DEPTH_DELTA') {
    // Snapshot and delta facts intentionally have different physical source
    // IDs. Matching scope facts still advance one instrument-local canonical
    // book cursor, while standard and RPI-inclusive books never cross-link.
    return [evidence.instrument.instrumentId, 'DEPTH', evidence.bookScope].join('|');
  }
  return [
    evidence.truth.authority.sourceId,
    evidence.truth.authority.dataset,
    evidence.instrument.instrumentId,
    seriesKind(evidence),
  ].join('|');
}

function observationJoinKey(requirement: Requirement, evidence: NormalizedEvidence): string {
  const marketKey = [evidence.instrument.venue, evidence.instrument.symbol].join('|');
  if (requirement === 'SPOT_PRICE' || requirement === 'PERPETUAL_PRICE') return marketKey;
  if (requirement === 'SPOT_BOOK') return `${marketKey}|UNKNOWN`;
  if (requirement === 'SPOT_DEPTH') {
    const scope = evidence.kind === 'DEPTH_SNAPSHOT' || evidence.kind === 'DEPTH_DELTA'
      ? evidence.bookScope
      : 'UNKNOWN';
    return `${marketKey}|${scope}`;
  }
  return evidence.instrument.instrumentId;
}

function compareEvidenceForRouting(
  left: NormalizedEvidence,
  right: NormalizedEvidence,
  fact: BinanceSourceFact,
): number {
  const symbol = compareText(left.instrument.symbol, right.instrument.symbol);
  if (symbol !== 0) return symbol;
  const received = left.truth.temporal.receivedTimeMs - right.truth.temporal.receivedTimeMs;
  if (received !== 0) return received;
  if (seriesKey(left) === seriesKey(right)) {
    const leftSequence = left.truth.temporal.sequence;
    const rightSequence = right.truth.temporal.sequence;
    if (leftSequence !== null && rightSequence !== null) {
      const leftFirst = numericSequence(leftSequence.first);
      const rightFirst = numericSequence(rightSequence.first);
      const leftLast = numericSequence(leftSequence.last);
      const rightLast = numericSequence(rightSequence.last);
      if (leftFirst !== null && rightFirst !== null && leftFirst !== rightFirst) return leftFirst < rightFirst ? -1 : 1;
      if (leftLast !== null && rightLast !== null && leftLast !== rightLast) return leftLast < rightLast ? -1 : 1;
    }
  }
  return ownerEvidenceSortTime(left, fact) - ownerEvidenceSortTime(right, fact)
    || compareText(left.id, right.id);
}

function makeSeriesWatermark(
  evidence: NormalizedEvidence,
  fact: BinanceSourceFact,
  evidenceTimeMs: number,
  sequenceLast: string | null,
  depthSynchronized: boolean,
): Readonly<SeriesWatermark> {
  return Object.freeze({
    evidenceTimeMs,
    evidenceId: evidence.id,
    sequenceLast,
    depthSynchronized,
    sourceId: fact.sourceId,
    dataset: fact.dataset,
    productFamily: evidence.instrument.productFamily,
    freshnessBasis: fact.freshnessBasis,
  });
}

function sourceStateKey(source: Pick<RegisteredEvidenceSourceCut, 'sourceId' | 'dataset' | 'endpointClass'>): string {
  return [source.sourceId, source.dataset, source.endpointClass].join('\u0000');
}

function staleAt(
  evidence: NormalizedEvidence,
  nowMs: number,
  source: RegisteredEvidenceSourceCut,
  fact: BinanceSourceFact,
): boolean {
  const truth = evidence.truth.freshness;
  if (truth.state !== 'FRESH' || STALE_LIFECYCLES.has(source.lifecycle)) return true;
  if (truth.maxAgeMs === null) return true;
  const atMs = evidenceTimeAtBasis(evidence, fact.freshnessBasis);
  if (atMs === null) return true;
  return atMs > nowMs || nowMs - atMs > truth.maxAgeMs;
}

function sourceMatchesEvidence(fact: BinanceSourceFact, evidence: NormalizedEvidence): boolean {
  const expectedAuthority = fact.productFamily === 'ANY' ? 'CONTEXTUAL' : 'EXCHANGE_PRIMARY';
  return evidence.truth.authority.kind === expectedAuthority
    && fact.evidenceKinds.includes(evidence.kind)
    && (fact.productFamily === 'ANY' || fact.productFamily === evidence.instrument.productFamily)
    && (evidence.kind !== 'DEPTH_SNAPSHOT' && evidence.kind !== 'DEPTH_DELTA'
      ? true
      : fact.bookScope === evidence.bookScope)
    && evidence.truth.authority.sourceId === fact.sourceId
    && evidence.truth.authority.dataset === fact.dataset
    && evidence.truth.authority.endpointClass === fact.endpointClass
    && evidence.truth.freshness.basis === fact.freshnessBasis;
}

function payloadSequenceFailure(evidence: NormalizedEvidence): StableFailure | null {
  const sequence = evidence.truth.temporal.sequence;
  if (evidence.kind === 'TRADE') {
    if (evidence.aggregateTradeId === null || evidence.firstTradeId === null
        || evidence.lastTradeId === null || sequence === null) {
      return makeStableFailure(
        'INCOMPLETE_EVIDENCE', COMPONENT,
        'registered aggregate-trade evidence requires payload and truth sequence identifiers',
        'evidence.truth.temporal.sequence', [evidence.id],
      );
    }
    if (sequence.first !== evidence.firstTradeId || sequence.last !== evidence.lastTradeId) {
      return makeStableFailure(
        'INVALID_VALUE', COMPONENT,
        'aggregate-trade payload identifiers do not match the normalized truth sequence',
        'evidence.truth.temporal.sequence', [evidence.id],
      );
    }
  }
  if (evidence.kind === 'BOOK_TICKER') {
    if (evidence.updateId === null || sequence === null) {
      return makeStableFailure(
        'INCOMPLETE_EVIDENCE', COMPONENT,
        'registered book-ticker evidence requires a payload update identifier and truth sequence',
        'evidence.truth.temporal.sequence', [evidence.id],
      );
    }
    if (sequence.first !== evidence.updateId || sequence.last !== evidence.updateId) {
      return makeStableFailure(
        'INVALID_VALUE', COMPONENT,
        'book-ticker payload update identifier does not match the normalized truth sequence',
        'evidence.truth.temporal.sequence', [evidence.id],
      );
    }
  }
  return null;
}

function liquidationFailure(evidence: NormalizedEvidence): StableFailure | null {
  if (evidence.kind !== 'LIQUIDATION') return null;
  if (!evidence.sampledPerWindow
      || evidence.samplingSelection !== 'LATEST_PER_SYMBOL'
      || evidence.sampleWindowMs !== 1_000) {
    return makeStableFailure(
      'INCOMPLETE_EVIDENCE',
      COMPONENT,
      'current Binance liquidation evidence must preserve latest-per-symbol sampled lower-bound semantics',
      'evidence.samplingSelection',
      [evidence.id],
    );
  }
  return null;
}

function routeState(input: {
  received: number;
  routed: number;
  sampled: boolean;
  stale: boolean;
  failures: readonly StableFailure[];
}): EvidenceRouteState {
  if (input.failures.some((failure) => failure.code === 'SEQUENCE_GAP')) return 'SEQUENCE_GAP';
  if (input.failures.some((failure) => failure.code === 'OUT_OF_ORDER_EVENT')) return 'OUT_OF_ORDER';
  if (input.failures.some((failure) => failure.code === 'BUDGET_EXHAUSTED'
      && failure.field === 'source.rateBudget')) return 'RATE_LIMITED';
  if (input.received === 0) return input.failures.length > 0 ? 'REJECTED' : 'MISSING';
  if (input.routed === 0) return 'REJECTED';
  if (input.sampled) return 'SAMPLED';
  if (input.stale) return 'STALE';
  return 'FRESH';
}

export class VolumeEvidenceRouter {
  readonly #clock: VolumeEvidenceRouterOptions['clock'];
  readonly #sink: VolumeEvidenceRouterOptions['sink'];
  readonly #maximumBatch: number;
  readonly #maximumSeries: number;
  readonly #maximumFailureRecords: number;
  readonly #watermarks = new Map<string, SeriesWatermark>();
  readonly #depthResyncSeries = new Set<string>();
  readonly #spotDepthResyncSeries = new Set<string>();
  readonly #contiguousGapSeries = new Map<string, ContiguousGapState>();
  readonly #spotTradeGapSeries = new Set<string>();
  readonly #sourceLifecycles = new Map<string, BoundSourceLifecycle>();
  readonly #observations = new Map<Requirement, Map<string, Observation>>();
  readonly #requirementIssues = new Map<Requirement, string[]>();
  readonly #failures: StableFailure[] = [];
  readonly #counters: RouterCounters = {
    routed: 0,
    duplicate: 0,
    rejected: 0,
    stale: 0,
    sampled: 0,
    rateLimited: 0,
    outOfOrder: 0,
    sequenceGaps: 0,
  };

  constructor(options: VolumeEvidenceRouterOptions) {
    if (!options || typeof options !== 'object' || typeof options.clock?.nowMs !== 'function') {
      throw new TypeError('volume evidence router requires an injected clock');
    }
    if (typeof options.sink?.ingest !== 'function') throw new TypeError('volume evidence router requires an evidence sink');
    this.#clock = options.clock;
    this.#sink = options.sink;
    safeTime(this.#clock.nowMs(), 'clock.nowMs()');
    this.#maximumBatch = boundedInteger(options.maximumBatch, DEFAULT_MAXIMUM_BATCH, 'maximumBatch', MAXIMUM_BATCH_HARD_LIMIT);
    this.#maximumSeries = boundedInteger(options.maximumSeries, DEFAULT_MAXIMUM_SERIES, 'maximumSeries', MAXIMUM_SERIES_HARD_LIMIT);
    this.#maximumFailureRecords = boundedInteger(
      options.maximumFailureRecords,
      DEFAULT_MAXIMUM_FAILURE_RECORDS,
      'maximumFailureRecords',
      MAXIMUM_FAILURE_HARD_LIMIT,
    );
  }

  route(batch: RegisteredEvidenceBatch): Readonly<RegisteredEvidenceRouteReceipt> {
    const nowMs = safeTime(this.#clock.nowMs(), 'clock.nowMs()');
    if (!batch || typeof batch !== 'object' || typeof batch.correlationId !== 'string'
        || batch.correlationId.length < 1 || batch.correlationId.length > 256
        || !['BROAD', 'FOCUSED'].includes(batch.scope)
        || !Array.isArray(batch.evidence)
        || !(batch.qualityFailures === undefined || Array.isArray(batch.qualityFailures))) {
      return this.#rejectBatch('', 0, makeStableFailure('INVALID_VALUE', COMPONENT, 'registered evidence batch is invalid', 'batch'));
    }
    if (batch.evidence.length > this.#maximumBatch
        || (batch.qualityFailures?.length ?? 0) > this.#maximumBatch) {
      return this.#rejectBatch(batch.correlationId, batch.evidence.length, makeStableFailure(
        'BUDGET_EXHAUSTED', COMPONENT, 'registered evidence batch exceeds the configured bound', 'maximumBatch',
      ));
    }
    const invalidSource = sourceFailure(batch.source, nowMs);
    if (invalidSource) return this.#rejectBatch(batch.correlationId, batch.evidence.length, invalidSource);
    const fact = factFor(batch.source);
    if (fact === null) {
      return this.#rejectBatch(batch.correlationId, batch.evidence.length, makeStableFailure(
        'WRONG_ENDPOINT_CLASS', COMPONENT, 'source cut is not an approved public evidence fact', 'source',
      ));
    }
    const lifecycleAdmission = this.#admitSourceLifecycle(batch.source, fact, batch.evidence);
    if (lifecycleAdmission.failure !== null) {
      this.#markSourceMissing(fact, 'SOURCE_LIFECYCLE_CONTINUITY_UNPROVEN');
      return this.#rejectBatch(batch.correlationId, batch.evidence.length, lifecycleAdmission.failure);
    }

    if (batch.source.endpointClass === 'REST'
        && (batch.source.rateBudget.state === 'EXHAUSTED' || batch.source.rateBudget.state === 'COOLDOWN')) {
      const failure = makeStableFailure(
        'BUDGET_EXHAUSTED',
        COMPONENT,
        'public REST source budget is exhausted; the router performs no transport work',
        'source.rateBudget',
      );
      this.#counters.rateLimited += 1;
      this.#markSourceMissing(fact, 'PUBLIC_REST_RATE_BUDGET_EXHAUSTED');
      return this.#rejectBatch(batch.correlationId, batch.evidence.length, failure);
    }
    if (!ACTIVE_LIFECYCLES.has(batch.source.lifecycle)
        || batch.source.authority === 'UNAVAILABLE'
        || batch.source.authority === 'UNKNOWN') {
      const failure = makeStableFailure(
        'MISSING_SOURCE', COMPONENT, 'registered producer is not currently able to publish evidence', 'source.lifecycle',
      );
      this.#markSourceMissing(fact, 'REGISTERED_SOURCE_UNAVAILABLE');
      return this.#missingBatch(batch.correlationId, batch.evidence.length, failure);
    }
    if (batch.evidence.length === 0) {
      this.#loseSourceContinuity(batch.source, fact, 'REGISTERED_SOURCE_EMPTY');
      this.#markSourceMissing(fact, 'REGISTERED_SOURCE_EMPTY');
      return Object.freeze({
        correlationId: batch.correlationId,
        state: 'MISSING' as const,
        received: 0,
        routed: 0,
        duplicate: 0,
        rejected: 0,
        failures: Object.freeze([]),
      });
    }

    const stagedWatermarks = new Map(this.#watermarks);
    const accepted: NormalizedEvidence[] = [];
    const failures: StableFailure[] = [];
    let batchStale = false;
    let batchSampled = false;
    let spotDepthGapInBatch = false;
    const depthGapSeriesInBatch = new Set<string>();
    const validated: NormalizedEvidence[] = [];
    for (const raw of batch.evidence) {
      const validation = validateNormalizedEvidence(raw);
      if (!validation.ok) {
        failures.push(validation.failure);
        continue;
      }
      validated.push(validation.value);
    }
    const ordered = validated.sort((left, right) => compareEvidenceForRouting(left, right, fact));

    for (const evidence of ordered) {
      if (!sourceMatchesEvidence(fact, evidence)) {
        failures.push(makeStableFailure(
          'WRONG_ENDPOINT_CLASS', COMPONENT, 'evidence does not belong to the declared registered source cut',
          'evidence.truth.authority', [evidence.id],
        ));
        continue;
      }
      const sequenceFailure = payloadSequenceFailure(evidence);
      if (sequenceFailure !== null) {
        failures.push(sequenceFailure);
        continue;
      }
      const temporal = evidence.truth.temporal;
      if ([temporal.sourceEventTimeMs, temporal.sourceTransactionTimeMs, temporal.receivedTimeMs,
        evidence.truth.freshness.evaluatedAtMs]
        .some((time) => time !== null && time > nowMs)) {
        failures.push(makeStableFailure(
          'NO_LOOK_AHEAD_VIOLATION', COMPONENT, 'evidence occurs after the injected router clock',
          'evidence.truth.temporal', [evidence.id],
        ));
        continue;
      }
      if (evidence.truth.freshness.state === 'UNAVAILABLE' || evidence.truth.freshness.state === 'UNKNOWN') {
        failures.push(makeStableFailure(
          'MISSING_SOURCE', COMPONENT, 'payload-bearing evidence cannot claim unavailable or unknown freshness',
          'evidence.truth.freshness', [evidence.id],
        ));
        continue;
      }
      const sampledFailure = liquidationFailure(evidence);
      if (sampledFailure) {
        failures.push(sampledFailure);
        continue;
      }
      if (evidence.kind === 'LIQUIDATION' && batch.source.authority !== 'SAMPLED') {
        failures.push(makeStableFailure(
          'INCOMPLETE_EVIDENCE', COMPONENT,
          'the registered Binance liquidation source must declare sampled authority',
          'source.authority', [evidence.id],
        ));
        continue;
      }
      const orderingFailure = this.#stageOrdering(evidence, batch.source, fact, stagedWatermarks);
      if (orderingFailure) {
        if (orderingFailure.code === 'SEQUENCE_GAP'
            && evidence.kind === 'DEPTH_DELTA'
            && evidence.instrument.productFamily === 'SPOT') {
          spotDepthGapInBatch = true;
        }
        if (orderingFailure.code === 'SEQUENCE_GAP' && evidence.kind === 'DEPTH_DELTA') {
          depthGapSeriesInBatch.add(seriesKey(evidence));
        }
        failures.push(orderingFailure);
        continue;
      }
      const stale = staleAt(evidence, nowMs, batch.source, fact);
      batchStale ||= stale;
      batchSampled ||= evidence.kind === 'LIQUIDATION';
      accepted.push(evidence);
    }

    if (accepted.length === 0) {
      if (failures.some((failure) => failure.code === 'SEQUENCE_GAP')) {
        this.#watermarks.clear();
        for (const [key, value] of stagedWatermarks) this.#watermarks.set(key, value);
      }
      if (lifecycleAdmission.pendingBootstrap) {
        this.#rejectSourceBootstrap(batch.source, fact, 'SOURCE_BOOTSTRAP_REJECTED');
      }
      this.#recordFailures(failures);
      this.#counters.rejected += batch.evidence.length;
      this.#recordRejected(failures);
      return Object.freeze({
        correlationId: batch.correlationId,
        state: routeState({ received: batch.evidence.length, routed: 0, sampled: false, stale: false, failures }),
        received: batch.evidence.length,
        routed: 0,
        duplicate: 0,
        rejected: batch.evidence.length,
        failures: Object.freeze(this.#visibleFailures(failures)),
      });
    }

    const generatedQuality: StableFailure[] = [];
    if (batchStale) generatedQuality.push(makeStableFailure(
      'STALE_SOURCE', COMPONENT, 'registered evidence includes stale producer truth', 'evidence.truth.freshness', accepted.map((entry) => entry.id),
    ));
    if (batch.source.authority === 'PARTIAL') generatedQuality.push(makeStableFailure(
      'INCOMPLETE_EVIDENCE', COMPONENT, 'registered producer reports partial authority', 'source.authority', accepted.map((entry) => entry.id),
    ));
    if (batchSampled) generatedQuality.push(makeStableFailure(
      'INCOMPLETE_EVIDENCE', COMPONENT,
      'liquidation observations are sampled latest-per-symbol lower bounds; silence is not zero',
      'evidence.sampledPerWindow', accepted.filter((entry) => entry.kind === 'LIQUIDATION').map((entry) => entry.id),
    ));
    const bridge = this.#sink.ingest({
      correlationId: batch.correlationId,
      scope: batch.scope,
      evidence: accepted,
      qualityFailures: [...(batch.qualityFailures ?? []), ...generatedQuality, ...failures],
    });
    const routed = bridge.accepted;
    const duplicate = bridge.duplicate;
    const rejected = failures.length + bridge.rejected;
    const allFailures = [...failures, ...bridge.failures];
    // The sink receipt does not identify which rows were duplicates. Depth and
    // other capability truth therefore commit only for an all-new cut, so a
    // pre-gap snapshot replay cannot clear resynchronization. Contiguous trade
    // backfill is the narrow exception: a Bridge duplicate proves that exact
    // normalized trade was already accepted, so a rejection-free mix of
    // accepted and duplicate rows can reconcile the router cursor.
    const allNewlyAccepted = bridge.rejected === 0 && duplicate === 0 && routed === accepted.length;
    const contiguousTradeReconciliation = bridge.rejected === 0
      && routed + duplicate === accepted.length
      && accepted.every((evidence) => evidence.kind === 'TRADE');
    const canonicalBootstrapReconciliation = lifecycleAdmission.pendingBootstrap
      && failures.length === 0
      && accepted.length === batch.evidence.length
      && bridge.rejected === 0
      && routed + duplicate === accepted.length;
    if (canonicalBootstrapReconciliation) this.#commitSourceBootstrap(batch.source);
    const routingStateAccepted = lifecycleAdmission.pendingBootstrap
      ? canonicalBootstrapReconciliation
      : allNewlyAccepted || contiguousTradeReconciliation;
    if (routingStateAccepted) {
      this.#watermarks.clear();
      for (const [key, value] of stagedWatermarks) this.#watermarks.set(key, value);
      for (const evidence of accepted) {
        if (evidence.kind === 'DEPTH_SNAPSHOT' && evidence.instrument.productFamily === 'SPOT') {
          this.#spotDepthResyncSeries.delete(seriesKey(evidence));
        }
        if (evidence.kind === 'DEPTH_SNAPSHOT') this.#depthResyncSeries.delete(seriesKey(evidence));
        if (evidence.kind === 'TRADE') {
          const key = seriesKey(evidence);
          const pending = this.#contiguousGapSeries.get(key);
          const committedLast = stagedWatermarks.get(key)?.sequenceLast ?? null;
          const committedNumeric = committedLast === null ? null : numericSequence(committedLast);
          const targetNumeric = pending === undefined ? null : numericSequence(pending.targetLast);
          if (pending?.anchored === true && committedNumeric !== null
              && targetNumeric !== null && committedNumeric >= targetNumeric) {
            this.#contiguousGapSeries.delete(key);
            if (evidence.instrument.productFamily === 'SPOT') this.#spotTradeGapSeries.delete(key);
          }
        }
      }
      for (const evidence of accepted) this.#observe(evidence, nowMs, batch.source, fact);
    }
    // Resynchronization state is independent of downstream evidence
    // acceptance. Once this cut proves a gap, a sink rejection cannot roll the
    // cursor back to its prior synchronized watermark and admit a later delta.
    this.#retainDepthResyncWatermarks(stagedWatermarks, depthGapSeriesInBatch);
    // A later gap in the same immutable cut dominates an earlier accepted
    // delta. Re-observing that earlier delta must never restore false-green
    // depth capability truth before a separately accepted snapshot.
    if (spotDepthGapInBatch) this.#invalidateSpotDepthForResync();
    if (lifecycleAdmission.pendingBootstrap && !canonicalBootstrapReconciliation) {
      // A partial sink result may have accepted an immutable subset, but it
      // cannot establish source continuity. Purge every transient cursor and
      // require a fresh explicit bootstrap; an exact later duplicate plus the
      // missing rows can then reconcile the complete canonical cut.
      this.#rejectSourceBootstrap(batch.source, fact, 'SOURCE_BOOTSTRAP_REJECTED');
    }
    this.#counters.routed += routed;
    this.#counters.duplicate += duplicate;
    this.#counters.rejected += rejected;
    this.#recordRejected(failures);
    if (batchStale) this.#counters.stale += routed + duplicate;
    if (batchSampled) this.#counters.sampled += accepted.filter((entry) => entry.kind === 'LIQUIDATION').length;
    this.#recordFailures(allFailures);
    return Object.freeze({
      correlationId: batch.correlationId,
      // Rows already accepted by the canonical sink remain immutable, but a
      // partially reconciled bootstrap is not current source truth. Never
      // describe that cut as FRESH/STALE/SAMPLED while its lifecycle remains
      // MISSING and a fresh explicit bootstrap is still required.
      state: lifecycleAdmission.pendingBootstrap && !canonicalBootstrapReconciliation
        ? 'MISSING' as const
        : routeState({ received: batch.evidence.length, routed: routed + duplicate, sampled: batchSampled, stale: batchStale, failures: allFailures }),
      received: batch.evidence.length,
      routed,
      duplicate,
      rejected,
      failures: Object.freeze(this.#visibleFailures(allFailures)),
    });
  }

  snapshot(): Readonly<VolumeEvidenceRoutingSnapshot> {
    const nowMs = safeTime(this.#clock.nowMs(), 'clock.nowMs()');
    const capabilityTruth = REQUIRED_QUALITY_CAPABILITIES.map((capability) => this.#capability(capability, nowMs));
    const qualityMissing = capabilityTruth.filter((entry) => entry.freshness === 'MISSING');
    const qualityStale = capabilityTruth.filter((entry) => entry.freshness === 'STALE');
    const qualityPartial = capabilityTruth.filter((entry) => entry.completeness !== 'COMPLETE');
    const qualitySources = sortedUnique(capabilityTruth.flatMap((entry) => entry.sourceIds));
    const quality: VolumeEvidenceCapabilityTruth = Object.freeze({
      capability: 'SOURCE_QUALITY' as const,
      freshness: qualityMissing.length > 0 ? 'MISSING' as const : qualityStale.length > 0 ? 'STALE' as const : 'FRESH' as const,
      completeness: qualityMissing.length === capabilityTruth.length
        ? 'MISSING' as const
        : qualityPartial.length > 0
          ? 'PARTIAL' as const
          : 'COMPLETE' as const,
      lastEvidenceTimeMs: capabilityTruth
        .map((entry) => entry.lastEvidenceTimeMs)
        .filter((time): time is number => time !== null)
        .reduce<number | null>((minimum, time) => minimum === null ? time : Math.min(minimum, time), null),
      sourceIds: Object.freeze(qualitySources),
      reasonCodes: Object.freeze(sortedUnique([
        ...qualityMissing.map((entry) => `${entry.capability}_MISSING`),
        ...qualityStale.map((entry) => `${entry.capability}_STALE`),
        ...qualityPartial.map((entry) => `${entry.capability}_${entry.completeness}`),
      ])),
    });
    return Object.freeze({
      observedAtMs: nowMs,
      capabilities: Object.freeze([...capabilityTruth, quality]),
      sources: Object.freeze([...this.#sourceLifecycles.values()]
        .sort((left, right) => compareText(sourceStateKey(left), sourceStateKey(right)))
        .map((source) => Object.freeze({
          sourceId: source.sourceId,
          dataset: source.dataset,
          lifecycle: source.lifecycle,
          generation: source.generation,
          revision: source.revision,
          closed: source.closed,
          bootstrapped: source.bootstrapped,
        }))),
      series: this.#watermarks.size,
      maximumSeries: this.#maximumSeries,
      ...this.#counters,
      failures: Object.freeze(this.#visibleFailures(this.#failures)),
      authority: 'EVIDENCE_ONLY' as const,
      liveMoneyAuthority: 'NONE' as const,
    });
  }

  /**
   * Semantic publisher shutdown/reconstruction is not a physical source
   * restart. Drop every transient cursor and capability without weakening any
   * already-recorded source generation/revision fence.
   */
  invalidate(reason = 'ROUTER_RECONSTRUCTION_REQUIRES_BOOTSTRAP'): void {
    if (typeof reason !== 'string' || reason.length < 1 || reason.length > 128 || !/^[A-Z0-9_]+$/.test(reason)) {
      throw new TypeError('router invalidation reason must be a bounded reason code');
    }
    this.#watermarks.clear();
    this.#depthResyncSeries.clear();
    this.#spotDepthResyncSeries.clear();
    this.#contiguousGapSeries.clear();
    this.#spotTradeGapSeries.clear();
    this.#observations.clear();
    this.#requirementIssues.clear();
    for (const requirement of Object.values(CAPABILITY_REQUIREMENTS).flat()) {
      this.#requirementIssues.set(requirement, [reason]);
    }
    for (const [key, source] of this.#sourceLifecycles) {
      this.#sourceLifecycles.set(key, Object.freeze({ ...source, bootstrapped: false }));
    }
  }

  #admitSourceLifecycle(
    source: RegisteredEvidenceSourceCut,
    fact: BinanceSourceFact,
    evidence: readonly Readonly<NormalizedEvidence>[],
  ): SourceLifecycleAdmission {
    const key = sourceStateKey(source);
    const prior = this.#sourceLifecycles.get(key) ?? null;
    if (prior !== null && source.generation < prior.generation) {
      return Object.freeze({
        failure: makeStableFailure(
          'STALE_SOURCE', COMPONENT,
          'source generation precedes the monotonic lifecycle fence',
          'source.generation',
        ),
        pendingBootstrap: false,
      });
    }
    if (prior !== null && source.generation === prior.generation && source.revision <= prior.revision) {
      return Object.freeze({
        failure: makeStableFailure(
          'STALE_SOURCE', COMPONENT,
          'source revision does not advance within the active generation',
          'source.revision',
        ),
        pendingBootstrap: false,
      });
    }
    if (prior !== null && source.generation === prior.generation && prior.closed
        && !CLOSED_LIFECYCLES.has(source.lifecycle)) {
      return Object.freeze({
        failure: makeStableFailure(
          'STALE_SOURCE', COMPONENT,
          'a closed source generation cannot publish delayed live evidence',
          'source.lifecycle',
        ),
        pendingBootstrap: false,
      });
    }

    const newGeneration = prior !== null && source.generation > prior.generation;
    if (newGeneration) this.#purgeSourceState(fact, 'SOURCE_GENERATION_CHANGED');
    const closed = CLOSED_LIFECYCLES.has(source.lifecycle);
    const active = ACTIVE_LIFECYCLES.has(source.lifecycle);
    const hadBootstrap = prior !== null
      && !newGeneration
      && prior.generation === source.generation
      && prior.bootstrapped
      && !prior.closed;
    let bootstrapped = hadBootstrap;
    let bootstrapFailure: StableFailure | null = null;
    let pendingBootstrap = false;
    if (active && !hadBootstrap && evidence.length > 0) {
      const snapshotOnly = evidence.length > 0 && evidence.every((entry) => (
        entry?.kind !== 'TRADE' && entry?.kind !== 'DEPTH_DELTA'
      ));
      const proofValid = source.bootstrap === 'CONTIGUOUS_OWNER'
        ? evidence.length > 0
        : source.bootstrap === 'CURRENT_SNAPSHOT' && snapshotOnly;
      if (proofValid) {
        // This is only a claim until the full normalized cut is accepted or
        // exact-duplicate reconciled by the canonical sink. Never latch it
        // here: malformed or partially rejected rows must remain MISSING.
        pendingBootstrap = true;
      } else {
        bootstrapFailure = makeStableFailure(
          'MISSING_SOURCE', COMPONENT,
          'source generation requires an explicit contiguous owner or current-snapshot bootstrap',
          'source.bootstrap',
        );
      }
    }
    if (!active) bootstrapped = false;
    const next = Object.freeze({
      sourceId: source.sourceId,
      dataset: source.dataset,
      endpointClass: source.endpointClass,
      lifecycle: source.lifecycle,
      generation: source.generation,
      revision: source.revision,
      closed,
      bootstrapped,
    });
    this.#sourceLifecycles.set(key, next);
    if (closed || !active) this.#purgeSourceState(fact, closed ? 'SOURCE_GENERATION_CLOSED' : 'SOURCE_NOT_ACTIVE');
    return Object.freeze({ failure: bootstrapFailure, pendingBootstrap });
  }

  #commitSourceBootstrap(source: RegisteredEvidenceSourceCut): void {
    const key = sourceStateKey(source);
    const current = this.#sourceLifecycles.get(key);
    if (current === undefined
        || current.generation !== source.generation
        || current.revision !== source.revision
        || current.closed
        || !ACTIVE_LIFECYCLES.has(current.lifecycle)) return;
    this.#sourceLifecycles.set(key, Object.freeze({ ...current, bootstrapped: true }));
  }

  #rejectSourceBootstrap(
    source: RegisteredEvidenceSourceCut,
    fact: BinanceSourceFact,
    reason: string,
  ): void {
    const key = sourceStateKey(source);
    const current = this.#sourceLifecycles.get(key);
    if (current !== undefined) {
      this.#sourceLifecycles.set(key, Object.freeze({ ...current, bootstrapped: false }));
    }
    // Keep any independently established sibling depth snapshot and a newly
    // observed resync fence. Neither is positive bootstrap evidence, and both
    // are needed to prevent a later delta from clearing a real gap.
    this.#markSourceMissing(fact, reason);
    if (fact.productFamily === 'SPOT'
        && fact.evidenceKinds.some((kind) => kind === 'DEPTH_SNAPSHOT' || kind === 'DEPTH_DELTA')
        && this.#spotDepthResyncSeries.size > 0) {
      this.#invalidateSpotDepthForResync();
    }
    if (fact.productFamily === 'SPOT'
        && fact.evidenceKinds.includes('TRADE')
        && this.#spotTradeGapSeries.size > 0) {
      this.#requirementIssues.set('SPOT_TRADE', ['SEQUENCE_GAP_REQUIRES_CONTIGUITY']);
    }
  }

  #loseSourceContinuity(
    source: RegisteredEvidenceSourceCut,
    fact: BinanceSourceFact,
    reason: string,
  ): void {
    const key = sourceStateKey(source);
    const current = this.#sourceLifecycles.get(key);
    if (current !== undefined) {
      this.#sourceLifecycles.set(key, Object.freeze({ ...current, bootstrapped: false }));
    }
    this.#purgeSourceState(fact, reason);
  }

  #purgeSourceState(fact: BinanceSourceFact, reason: string): void {
    const depthSource = fact.evidenceKinds.some((kind) => kind === 'DEPTH_SNAPSHOT' || kind === 'DEPTH_DELTA');
    const removed = new Set<string>();
    for (const [key, watermark] of this.#watermarks) {
      const exactSource = watermark.sourceId === fact.sourceId && watermark.dataset === fact.dataset;
      const sameDepthFamily = depthSource && watermark.productFamily === fact.productFamily;
      if (!exactSource && !sameDepthFamily) continue;
      this.#watermarks.delete(key);
      removed.add(key);
    }
    for (const key of removed) {
      this.#depthResyncSeries.delete(key);
      this.#spotDepthResyncSeries.delete(key);
      this.#contiguousGapSeries.delete(key);
      this.#spotTradeGapSeries.delete(key);
    }
    this.#markSourceMissing(fact, reason);
  }

  #stageOrdering(
    evidence: NormalizedEvidence,
    source: RegisteredEvidenceSourceCut,
    fact: BinanceSourceFact,
    staged: Map<string, SeriesWatermark>,
  ): StableFailure | null {
    const key = seriesKey(evidence);
    const prior = staged.get(key) ?? null;
    if (prior === null && !this.#watermarks.has(key) && staged.size >= this.#maximumSeries) {
      return makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'series watermark capacity is exhausted', 'maximumSeries', [evidence.id]);
    }
    const atMs = evidenceTimeAtBasis(evidence, fact.freshnessBasis);
    if (atMs === null) {
      return makeStableFailure(
        'INCOMPLETE_EVIDENCE', COMPONENT,
        'evidence is missing the registered source fact freshness timestamp',
        'evidence.truth.temporal', [evidence.id],
      );
    }
    const depth = evidence.kind === 'DEPTH_SNAPSHOT' || evidence.kind === 'DEPTH_DELTA';
    const sequencedMarketEvidence = depth || evidence.kind === 'TRADE' || evidence.kind === 'BOOK_TICKER';
    if (!sequencedMarketEvidence) {
      if (prior !== null && atMs < prior.evidenceTimeMs) {
        return makeStableFailure('OUT_OF_ORDER_EVENT', COMPONENT, 'evidence time precedes the accepted series watermark', 'evidence.truth.temporal', [evidence.id]);
      }
      staged.set(key, makeSeriesWatermark(evidence, fact, atMs, null, true));
      return null;
    }
    const sequence = evidence.truth.temporal.sequence;
    if (sequence === null) {
      return makeStableFailure('INCOMPLETE_EVIDENCE', COMPONENT, 'sequenced market evidence requires an explicit update sequence', 'evidence.truth.temporal.sequence', [evidence.id]);
    }
    if (evidence.kind === 'TRADE' || evidence.kind === 'BOOK_TICKER') {
      if (prior !== null && atMs < prior.evidenceTimeMs) {
        return makeStableFailure(
          'OUT_OF_ORDER_EVENT', COMPONENT,
          'sequenced market evidence time precedes the accepted same-basis cursor',
          'evidence.truth.temporal', [evidence.id],
        );
      }
      const first = numericSequence(sequence.first);
      const last = numericSequence(sequence.last);
      const priorLast = prior?.sequenceLast === null || prior?.sequenceLast === undefined
        ? null
        : numericSequence(prior.sequenceLast);
      if (first === null || last === null || (prior?.sequenceLast !== null
          && prior?.sequenceLast !== undefined && priorLast === null)) {
        return makeStableFailure(
          'INCOMPLETE_EVIDENCE', COMPONENT,
          'market sequence must be numeric to prove canonical ordering',
          'evidence.truth.temporal.sequence', [evidence.id],
        );
      }
      const embeddedSequenceGap = evidence.truth.completeness.reasonCodes.includes('SEQUENCE_GAP')
        || evidence.truth.completeness.missingFields.includes('sequence.continuity');
      if (evidence.kind === 'TRADE' && embeddedSequenceGap) {
        return this.#contiguousSequenceGap(
          evidence, fact, staged, key, atMs,
          'rolling trade normalizer reports incomplete sequence continuity',
          'evidence.truth.completeness',
        );
      }
      if (evidence.kind === 'TRADE' && source.continuity !== 'CONTIGUOUS') {
        return this.#contiguousSequenceGap(
          evidence, fact, staged, key, atMs,
          'rolling trade evidence requires producer-confirmed contiguous acquisition',
          'source.continuity',
        );
      }
      if (prior === null) {
        staged.set(key, makeSeriesWatermark(evidence, fact, atMs, sequence.last, true));
        return null;
      }
      if (priorLast === null) {
        if (evidence.kind === 'BOOK_TICKER') {
          return makeStableFailure(
            'INCOMPLETE_EVIDENCE', COMPONENT,
            'book ticker sequence has no numeric monotonic cursor',
            'evidence.truth.temporal.sequence', [evidence.id],
          );
        }
        return this.#contiguousSequenceGap(
          evidence, fact, staged, key, atMs,
          'rolling trade evidence has no accepted contiguous sequence anchor',
          'evidence.truth.temporal.sequence',
        );
      }
      if (last <= priorLast) {
        return makeStableFailure(
          'OUT_OF_ORDER_EVENT', COMPONENT,
          'market sequence does not advance the accepted cursor',
          'evidence.truth.temporal.sequence.last', [evidence.id],
        );
      }
      if (evidence.kind === 'TRADE') {
        const next = priorLast + 1n;
        if (first > next) {
          return this.#contiguousSequenceGap(
            evidence, fact, staged, key, atMs,
            'rolling trade sequence begins after the next required trade ID',
            'evidence.truth.temporal.sequence.first',
          );
        }
        const pending = this.#contiguousGapSeries.get(key);
        if (pending?.anchored === false) {
          return this.#contiguousSequenceGap(
            evidence, fact, staged, key, atMs,
            'rolling trade evidence cannot recover an unanchored producer gap',
            'evidence.truth.temporal.sequence',
          );
        }
      }
      staged.set(key, makeSeriesWatermark(evidence, fact, atMs, sequence.last, true));
      return null;
    }
    const sameDepthTemporalSeries = prior !== null
      && prior.sourceId === fact.sourceId
      && prior.dataset === fact.dataset
      && prior.freshnessBasis === fact.freshnessBasis;
    if (sameDepthTemporalSeries && atMs < prior.evidenceTimeMs) {
      return makeStableFailure(
        'OUT_OF_ORDER_EVENT', COMPONENT,
        'depth evidence time regresses within the same source and clock basis',
        'evidence.truth.temporal', [evidence.id],
      );
    }
    if (evidence.kind === 'DEPTH_SNAPSHOT') {
      const snapshotLast = numericSequence(sequence.last);
      const priorLast = prior?.sequenceLast === null || prior?.sequenceLast === undefined
        ? null
        : numericSequence(prior.sequenceLast);
      if (snapshotLast === null || (prior !== null && prior.sequenceLast !== null && priorLast === null)) {
        return makeStableFailure(
          'INCOMPLETE_EVIDENCE',
          COMPONENT,
          'depth snapshot sequence must be numeric to prove a non-regressing resynchronization cut',
          'evidence.truth.temporal.sequence.last',
          [evidence.id],
        );
      }
      if (priorLast !== null && snapshotLast < priorLast) {
        return makeStableFailure(
          'OUT_OF_ORDER_EVENT',
          COMPONENT,
          'depth snapshot sequence regresses behind the accepted or gap cursor',
          'evidence.truth.temporal.sequence.last',
          [evidence.id],
        );
      }
      if (prior !== null && priorLast !== null && snapshotLast === priorLast
          && atMs < prior.evidenceTimeMs) {
        return makeStableFailure(
          'OUT_OF_ORDER_EVENT', COMPONENT,
          'equal-sequence depth snapshot precedes the accepted or gap cursor time',
          'evidence.truth.temporal', [evidence.id],
        );
      }
      staged.set(key, makeSeriesWatermark(evidence, fact, atMs, sequence.last, true));
      return null;
    }
    if (this.#depthResyncSeries.has(key)) {
      return this.#depthSequenceGap(
        evidence,
        fact,
        staged,
        key,
        atMs,
        'depth delta cannot advance while its series requires a newly accepted snapshot',
        'evidence.truth.temporal.sequence',
      );
    }
    if (source.continuity !== 'CONTIGUOUS' || prior === null || !prior.depthSynchronized || prior.sequenceLast === null) {
      return this.#depthSequenceGap(
        evidence,
        fact,
        staged,
        key,
        atMs,
        'depth delta cannot advance without producer-confirmed continuity and a contiguous accepted snapshot cursor',
        'evidence.truth.temporal.sequence',
      );
    }
    const priorLast = numericSequence(prior.sequenceLast);
    const first = numericSequence(sequence.first);
    const last = numericSequence(sequence.last);
    if (priorLast === null || first === null || last === null) {
      if (sequence.previous !== prior.sequenceLast) {
        return this.#depthSequenceGap(
          evidence,
          fact,
          staged,
          key,
          atMs,
          'non-numeric depth sequence does not link to the prior cursor',
          'evidence.truth.temporal.sequence.previous',
        );
      }
    } else if (last <= priorLast) {
      return makeStableFailure('OUT_OF_ORDER_EVENT', COMPONENT, 'depth update does not advance the accepted cursor', 'evidence.truth.temporal.sequence.last', [evidence.id]);
    } else if (evidence.instrument.productFamily === 'USD_M_PERPETUAL') {
      if (sequence.previous !== prior.sequenceLast) {
        return this.#depthSequenceGap(
          evidence,
          fact,
          staged,
          key,
          atMs,
          'USD-M depth pu does not equal the prior final update ID',
          'evidence.truth.temporal.sequence.previous',
        );
      }
    } else {
      const next = priorLast + 1n;
      if (first > next) {
        return this.#depthSequenceGap(
          evidence,
          fact,
          staged,
          key,
          atMs,
          'Spot depth update begins after the required bridge update ID',
          'evidence.truth.temporal.sequence.first',
        );
      }
      if (last < next) {
        return makeStableFailure('OUT_OF_ORDER_EVENT', COMPONENT, 'Spot depth update ends before the required bridge update ID', 'evidence.truth.temporal.sequence.last', [evidence.id]);
      }
    }
    staged.set(key, makeSeriesWatermark(evidence, fact, atMs, sequence.last, true));
    return null;
  }

  #contiguousSequenceGap(
    evidence: NormalizedEvidence,
    fact: BinanceSourceFact,
    staged: Map<string, SeriesWatermark>,
    key: string,
    atMs: number,
    message: string,
    field: string,
  ): StableFailure {
    const prior = staged.get(key) ?? null;
    const candidateLast = evidence.truth.temporal.sequence?.last ?? null;
    const existing = this.#contiguousGapSeries.get(key);
    const existingNumeric = existing === undefined ? null : numericSequence(existing.targetLast);
    const candidateNumeric = candidateLast === null ? null : numericSequence(candidateLast);
    const targetLast = existing !== undefined
      && (candidateNumeric === null || existingNumeric === null || existingNumeric > candidateNumeric)
      ? existing.targetLast
      : candidateLast;
    if (targetLast !== null) {
      this.#contiguousGapSeries.set(key, Object.freeze({
        targetLast,
        anchored: existing?.anchored ?? (prior !== null && prior.sequenceLast !== null),
      }));
    }
    if (evidence.kind === 'TRADE' && evidence.instrument.productFamily === 'SPOT') {
      this.#spotTradeGapSeries.add(key);
    }
    if (prior === null) {
      staged.set(key, makeSeriesWatermark(evidence, fact, atMs, null, true));
    }
    this.#invalidateEvidenceSeries(evidence, 'SEQUENCE_GAP_REQUIRES_CONTIGUITY');
    return makeStableFailure('SEQUENCE_GAP', COMPONENT, message, field, [evidence.id]);
  }

  #depthSequenceGap(
    evidence: NormalizedEvidence,
    fact: BinanceSourceFact,
    staged: Map<string, SeriesWatermark>,
    key: string,
    atMs: number,
    message: string,
    field: string,
  ): StableFailure {
    const sequence = evidence.truth.temporal.sequence;
    const prior = staged.get(key) ?? null;
    const candidateLast = sequence?.last ?? null;
    const priorLast = prior?.sequenceLast ?? null;
    const candidateNumeric = candidateLast === null ? null : numericSequence(candidateLast);
    const priorNumeric = priorLast === null ? null : numericSequence(priorLast);
    // Repeated deltas can arrive while the series is already waiting for a
    // snapshot. Retain the highest provable gap cursor so a later-received,
    // lower sequence cannot make a regressive snapshot look admissible.
    const retainedLast = priorLast !== null
      && (priorNumeric === null || candidateNumeric === null || candidateNumeric < priorNumeric)
      ? priorLast
      : candidateLast;
    staged.set(key, makeSeriesWatermark(evidence, fact, atMs, retainedLast, false));
    this.#depthResyncSeries.add(key);
    if (evidence.instrument.productFamily === 'SPOT') {
      this.#spotDepthResyncSeries.add(key);
      this.#invalidateSpotDepthForResync();
    }
    return makeStableFailure('SEQUENCE_GAP', COMPONENT, message, field, [evidence.id]);
  }

  #invalidateSpotDepthForResync(): void {
    this.#requirementIssues.set('SPOT_DEPTH', ['DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC']);
    this.#observations.delete('SPOT_DEPTH');
  }

  #invalidateEvidenceSeries(evidence: NormalizedEvidence, reason: string): void {
    const key = seriesKey(evidence);
    for (const requirement of requirementsFor(evidence)) {
      const observations = this.#observations.get(requirement);
      observations?.delete(key);
      if (observations?.size === 0) this.#observations.delete(requirement);
      this.#requirementIssues.set(requirement, [reason]);
    }
  }

  #retainDepthResyncWatermarks(
    staged: ReadonlyMap<string, SeriesWatermark>,
    seriesKeys: ReadonlySet<string>,
  ): void {
    for (const key of seriesKeys) {
      const watermark = staged.get(key);
      if (watermark?.depthSynchronized === false) this.#watermarks.set(key, watermark);
    }
  }

  #observe(
    evidence: NormalizedEvidence,
    nowMs: number,
    source: RegisteredEvidenceSourceCut,
    fact: BinanceSourceFact,
  ): void {
    if (evidence.kind === 'TRADE' && this.#contiguousGapSeries.has(seriesKey(evidence))) {
      this.#invalidateEvidenceSeries(evidence, 'SEQUENCE_GAP_REQUIRES_CONTIGUITY');
      return;
    }
    const stale = staleAt(evidence, nowMs, source, fact);
    const maxAgeMs = evidence.truth.freshness.maxAgeMs ?? 0;
    const completeness = evidence.kind === 'LIQUIDATION'
      ? 'SAMPLED' as const
      : evidence.truth.completeness.state === 'COMPLETE' && source.authority === 'COMPLETE'
        ? 'COMPLETE' as const
        : 'PARTIAL' as const;
    for (const requirement of requirementsFor(evidence)) {
      if (requirement === 'SPOT_DEPTH' && this.#spotDepthResyncSeries.size > 0) {
        this.#invalidateSpotDepthForResync();
        continue;
      }
      let requirementObservations = this.#observations.get(requirement);
      if (requirementObservations === undefined) {
        requirementObservations = new Map<string, Observation>();
        this.#observations.set(requirement, requirementObservations);
      }
      const key = seriesKey(evidence);
      const current = requirementObservations.get(key);
      const time = evidenceTimeAtBasis(evidence, fact.freshnessBasis);
      if (time === null) continue;
      if (current !== undefined && current.evidenceTimeMs > time) continue;
      requirementObservations.set(key, Object.freeze({
        joinKey: observationJoinKey(requirement, evidence),
        evidenceTimeMs: time,
        maxAgeMs,
        sourceId: source.sourceId,
        dataset: source.dataset,
        freshness: stale ? 'STALE' : 'FRESH',
        completeness,
      }));
      if (requirement === 'SPOT_TRADE' && this.#spotTradeGapSeries.size > 0) {
        this.#requirementIssues.set(requirement, ['SEQUENCE_GAP_REQUIRES_CONTIGUITY']);
      } else {
        this.#requirementIssues.delete(requirement);
      }
    }
  }

  #capability(
    capability: Exclude<VolumeEvidenceCapability, 'SOURCE_QUALITY'>,
    nowMs: number,
  ): Readonly<VolumeEvidenceCapabilityTruth> {
    const requirements = CAPABILITY_REQUIREMENTS[capability];
    const observationsByRequirement = requirements.map((requirement) => (
      requirement === 'SPOT_TRADE' && this.#spotTradeGapSeries.size > 0
        ? []
        : [...(this.#observations.get(requirement)?.values() ?? [])]
    ));
    const allPresent = observationsByRequirement.flat();
    const joinKeys = sortedUnique(observationsByRequirement[0]?.map((observation) => observation.joinKey) ?? [])
      .filter((joinKey) => observationsByRequirement.every((observations) => (
        observations.some((observation) => observation.joinKey === joinKey)
      )));
    if (joinKeys.length === 0) {
      const missingRequirements = requirements.filter((_, index) => observationsByRequirement[index]?.length === 0);
      const reasonCodes = sortedUnique([
        ...missingRequirements.flatMap((requirement) => (
          this.#requirementIssues.get(requirement) ?? [`${requirement}_MISSING`]
        )),
        ...(missingRequirements.length === 0 && requirements.length > 1
          ? ['CAPABILITY_INSTRUMENT_JOIN_MISSING']
          : []),
      ]);
      if (capability === 'SPREAD_DEPTH_BOOK' && allPresent.length > 0) {
        reasonCodes.push('DEPTH_LEVEL_REMOVAL_CAUSALITY_UNKNOWN');
      }
      return Object.freeze({
        capability,
        freshness: 'MISSING' as const,
        completeness: allPresent.length === 0 ? 'MISSING' as const : 'PARTIAL' as const,
        lastEvidenceTimeMs: allPresent.length === 0
          ? null
          : Math.min(...allPresent.map((observation) => observation.evidenceTimeMs)),
        sourceIds: Object.freeze(sortedUnique(allPresent.map((observation) => observation.sourceId))),
        reasonCodes: Object.freeze(sortedUnique(reasonCodes)),
      });
    }

    const candidates = joinKeys.map((joinKey) => {
      const observations = requirements.map((_, index) => (
        observationsByRequirement[index]
          ?.filter((observation) => observation.joinKey === joinKey)
          .sort((left, right) => right.evidenceTimeMs - left.evidenceTimeMs
            || compareText(left.sourceId, right.sourceId))[0]
      )).filter((observation): observation is Observation => observation !== undefined);
      const stale = observations.some((observation) => observation.freshness === 'STALE'
        || nowMs - observation.evidenceTimeMs > observation.maxAgeMs);
      const completeness = observations.some((observation) => observation.completeness === 'SAMPLED')
        ? 'SAMPLED' as const
        : observations.some((observation) => observation.completeness === 'PARTIAL')
          ? 'PARTIAL' as const
          : 'COMPLETE' as const;
      return {
        joinKey,
        observations,
        freshness: stale ? 'STALE' as const : 'FRESH' as const,
        completeness,
        lastEvidenceTimeMs: Math.min(...observations.map((observation) => observation.evidenceTimeMs)),
      };
    }).sort((left, right) => {
      const freshness = Number(right.freshness === 'FRESH') - Number(left.freshness === 'FRESH');
      if (freshness !== 0) return freshness;
      const completenessRank = (value: 'COMPLETE' | 'PARTIAL' | 'SAMPLED'): number => (
        value === 'COMPLETE' ? 3 : value === 'SAMPLED' ? 2 : 1
      );
      return completenessRank(right.completeness) - completenessRank(left.completeness)
        || right.lastEvidenceTimeMs - left.lastEvidenceTimeMs
        || compareText(left.joinKey, right.joinKey);
    });
    const selected = candidates[0]!;
    const reasonCodes = sortedUnique(requirements.flatMap((requirement, index) => {
      const observation = selected.observations[index]!;
      const reasons: string[] = [];
      if (observation.freshness === 'STALE' || nowMs - observation.evidenceTimeMs > observation.maxAgeMs) reasons.push(`${requirement}_STALE`);
      if (observation.completeness === 'PARTIAL') reasons.push(`${requirement}_PARTIAL`);
      if (observation.completeness === 'SAMPLED') reasons.push('SAMPLED_LATEST_PER_SYMBOL_LOWER_BOUND');
      return reasons;
    }));
    if (capability === 'SPREAD_DEPTH_BOOK') reasonCodes.push('DEPTH_LEVEL_REMOVAL_CAUSALITY_UNKNOWN');
    return Object.freeze({
      capability,
      freshness: selected.freshness,
      completeness: selected.completeness,
      lastEvidenceTimeMs: selected.lastEvidenceTimeMs,
      sourceIds: Object.freeze(sortedUnique(selected.observations.map((observation) => observation.sourceId))),
      reasonCodes: Object.freeze(sortedUnique(reasonCodes)),
    });
  }

  #markSourceMissing(fact: BinanceSourceFact, reason: string): void {
    for (const kind of fact.evidenceKinds) {
      const family = fact.productFamily;
      const requirements: Requirement[] = [];
      if (kind === 'TRADE') requirements.push(family === 'SPOT' ? 'SPOT_TRADE' : 'PERPETUAL_PRICE', ...(family === 'SPOT' ? ['SPOT_PRICE'] as const : []));
      if (kind === 'BOOK_TICKER') requirements.push(family === 'SPOT' ? 'SPOT_BOOK' : 'PERPETUAL_PRICE', ...(family === 'SPOT' ? ['SPOT_PRICE'] as const : []));
      if ((kind === 'DEPTH_SNAPSHOT' || kind === 'DEPTH_DELTA') && family === 'SPOT') requirements.push('SPOT_DEPTH');
      if (kind === 'MARK_PRICE') requirements.push('PERPETUAL_PRICE');
      if (kind === 'OPEN_INTEREST') requirements.push('OPEN_INTEREST');
      if (kind === 'FUNDING') requirements.push('FUNDING');
      if (kind === 'LIQUIDATION') requirements.push('LIQUIDATION');
      if (kind === 'CONTEXT') requirements.push('CONTEXT');
      for (const requirement of requirements) {
        if (kind === 'DEPTH_DELTA' && family === 'SPOT' && requirement === 'SPOT_DEPTH') {
          // A snapshot and its deltas are one canonical book series, not
          // alternative capability sources. Losing the delta producer makes
          // every retained snapshot cut incomplete until updates resume.
          this.#observations.delete(requirement);
          this.#requirementIssues.set(requirement, [reason]);
          continue;
        }
        const observations = this.#observations.get(requirement);
        if (observations !== undefined) {
          for (const [key, observation] of observations) {
            if (observation.sourceId === fact.sourceId && observation.dataset === fact.dataset) {
              observations.delete(key);
            }
          }
          if (observations.size === 0) this.#observations.delete(requirement);
        }
        if (!this.#observations.has(requirement)) this.#requirementIssues.set(requirement, [reason]);
      }
    }
  }

  #rejectBatch(correlationId: string, received: number, failure: StableFailure): Readonly<RegisteredEvidenceRouteReceipt> {
    this.#counters.rejected += received;
    this.#recordRejected([failure]);
    this.#recordFailures([failure]);
    return Object.freeze({
      correlationId,
      state: routeState({ received, routed: 0, sampled: false, stale: false, failures: [failure] }),
      received,
      routed: 0,
      duplicate: 0,
      rejected: received,
      failures: Object.freeze([failure]),
    });
  }

  #missingBatch(correlationId: string, received: number, failure: StableFailure): Readonly<RegisteredEvidenceRouteReceipt> {
    this.#counters.rejected += received;
    this.#recordRejected([failure]);
    this.#recordFailures([failure]);
    return Object.freeze({
      correlationId,
      state: 'MISSING' as const,
      received,
      routed: 0,
      duplicate: 0,
      rejected: received,
      failures: Object.freeze([failure]),
    });
  }

  #recordRejected(failures: readonly StableFailure[]): void {
    this.#counters.outOfOrder += failures.filter((failure) => failure.code === 'OUT_OF_ORDER_EVENT').length;
    this.#counters.sequenceGaps += failures.filter((failure) => failure.code === 'SEQUENCE_GAP').length;
  }

  #recordFailures(failures: readonly StableFailure[]): void {
    for (const failure of failures) {
      if (this.#failures.length >= this.#maximumFailureRecords) this.#failures.shift();
      this.#failures.push(failure);
    }
  }

  #visibleFailures(failures: readonly StableFailure[]): StableFailure[] {
    return [...failures]
      .sort((left, right) => compareText(left.id, right.id))
      .slice(-this.#maximumFailureRecords);
  }
}

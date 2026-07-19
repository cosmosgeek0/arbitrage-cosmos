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
  VolumeEvidenceSymbolRoutingSnapshot,
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
  readonly symbol: string;
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
  /**
   * Snapshot and delta sources share one canonical cursor only inside the
   * exact order-book scope. STANDARD and RPI-inclusive books are independent
   * series even when they belong to the same product family.
   */
  readonly bookScope: BinanceSourceFact['bookScope'];
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
  readonly candidate: BoundSourceLifecycle | null;
  readonly newGeneration: boolean;
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
    bookScope: evidence.kind === 'DEPTH_SNAPSHOT' || evidence.kind === 'DEPTH_DELTA'
      ? evidence.bookScope
      : null,
    freshnessBasis: fact.freshnessBasis,
  });
}

function sourceStateKey(source: Pick<RegisteredEvidenceSourceCut, 'sourceId' | 'dataset' | 'endpointClass'>): string {
  return [source.sourceId, source.dataset, source.endpointClass].join('\u0000');
}

function sourceObservationKey(source: Pick<RegisteredEvidenceSourceCut, 'sourceId' | 'dataset'>): string {
  return [source.sourceId, source.dataset].join('\u0000');
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
  rejected: number;
  sampled: boolean;
  stale: boolean;
  failures: readonly StableFailure[];
}): EvidenceRouteState {
  if (input.failures.some((failure) => failure.code === 'SEQUENCE_GAP')) return 'SEQUENCE_GAP';
  if (input.failures.some((failure) => failure.code === 'OUT_OF_ORDER_EVENT')) return 'OUT_OF_ORDER';
  if (input.failures.some((failure) => failure.code === 'BUDGET_EXHAUSTED'
      && failure.field === 'source.rateBudget')) return 'RATE_LIMITED';
  if (input.received === 0) return input.failures.length > 0 ? 'REJECTED' : 'MISSING';
  if (input.rejected > 0) return 'REJECTED';
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
  readonly #spotDepthResyncSymbols = new Set<string>();
  readonly #contiguousGapSeries = new Map<string, ContiguousGapState>();
  readonly #spotTradeGapSeries = new Set<string>();
  readonly #spotTradeGapSymbols = new Set<string>();
  readonly #sourceLifecycles = new Map<string, BoundSourceLifecycle>();
  readonly #rejectedSourceCuts = new Map<string, string>();
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
    const invalidSource = sourceFailure(batch.source, nowMs);
    if (invalidSource) return this.#rejectBatch(batch.correlationId, batch.evidence.length, invalidSource);
    const fact = factFor(batch.source);
    if (fact === null) {
      return this.#rejectBatch(batch.correlationId, batch.evidence.length, makeStableFailure(
        'WRONG_ENDPOINT_CLASS', COMPONENT, 'source cut is not an approved public evidence fact', 'source',
      ));
    }
    const overBound = batch.evidence.length > this.#maximumBatch
      || (batch.qualityFailures?.length ?? 0) > this.#maximumBatch;
    // Preserve source-local generation/revision ordering before the budget
    // rejection, but do not inspect even one evidence row until the fixed
    // batch bound is known to hold.
    const lifecycleAdmission = this.#admitSourceLifecycle(batch.source, batch.evidence, !overBound);
    if (lifecycleAdmission.failure !== null) {
      if (lifecycleAdmission.candidate !== null) {
        this.#rejectSourceCut(lifecycleAdmission, fact, 'SOURCE_LIFECYCLE_CONTINUITY_UNPROVEN');
      } else {
        this.#retainRejectedCutOrMarkMissing(batch.source, fact, 'SOURCE_LIFECYCLE_CONTINUITY_UNPROVEN');
      }
      return this.#rejectBatch(batch.correlationId, batch.evidence.length, lifecycleAdmission.failure);
    }

    if (overBound) {
      const failure = makeStableFailure(
        'BUDGET_EXHAUSTED', COMPONENT,
        'registered evidence batch exceeds the configured bound', 'maximumBatch',
      );
      this.#rejectSourceCut(lifecycleAdmission, fact, 'SOURCE_CUT_BUDGET_EXHAUSTED');
      return this.#rejectBatch(batch.correlationId, batch.evidence.length, failure);
    }

    if (!ACTIVE_LIFECYCLES.has(batch.source.lifecycle)
        || batch.source.authority === 'UNAVAILABLE'
        || batch.source.authority === 'UNKNOWN') {
      const failure = makeStableFailure(
        'MISSING_SOURCE', COMPONENT, 'registered producer is not currently able to publish evidence', 'source.lifecycle',
      );
      this.#commitUnavailableSource(lifecycleAdmission, fact, CLOSED_LIFECYCLES.has(batch.source.lifecycle)
        ? 'SOURCE_GENERATION_CLOSED'
        : 'REGISTERED_SOURCE_UNAVAILABLE');
      return this.#missingBatch(batch.correlationId, batch.evidence.length, failure);
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
      this.#rejectSourceCut(lifecycleAdmission, fact, 'PUBLIC_REST_RATE_BUDGET_EXHAUSTED');
      return this.#rejectBatch(batch.correlationId, batch.evidence.length, failure);
    }
    if (batch.evidence.length === 0) {
      this.#commitUnavailableSource(lifecycleAdmission, fact, 'REGISTERED_SOURCE_EMPTY');
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
    if (lifecycleAdmission.newGeneration) this.#removeSourceWatermarks(stagedWatermarks, fact);
    const accepted: NormalizedEvidence[] = [];
    const failures: StableFailure[] = [];
    let batchStale = false;
    let batchSampled = false;
    const spotDepthGapSymbolsInBatch = new Set<string>();
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
          spotDepthGapSymbolsInBatch.add(evidence.instrument.symbol);
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
      const diagnostic = failures.some((failure) => failure.code === 'SEQUENCE_GAP')
        ? 'SEQUENCE_GAP'
        : failures.some((failure) => failure.code === 'OUT_OF_ORDER_EVENT')
          ? 'OUT_OF_ORDER_EVENT'
          : 'SOURCE_CUT_REJECTED';
      this.#rejectSourceCut(lifecycleAdmission, fact, diagnostic);
      this.#recordFailures(failures);
      this.#counters.rejected += batch.evidence.length;
      this.#recordRejected(failures);
      return Object.freeze({
        correlationId: batch.correlationId,
        state: routeState({
          received: batch.evidence.length,
          routed: 0,
          rejected: batch.evidence.length,
          sampled: false,
          stale: false,
          failures,
        }),
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
    // Source generation/revision, continuity, watermarks, and observations are
    // one transaction. A valid subset is not a current source cut even when
    // the canonical sink immutably accepted that subset. Exact duplicates do
    // count because the Bridge proves the same normalized row was accepted.
    const canonicalCutReconciled = failures.length === 0
      && accepted.length === batch.evidence.length
      && bridge.rejected === 0
      && routed + duplicate === accepted.length;
    // The aggregate sink receipt cannot identify which depth row was the
    // duplicate. Never let a replay of a pre-gap snapshot clear a durable
    // per-series resynchronization fence.
    const depthDuplicateWouldClearResync = duplicate > 0 && accepted.some((evidence) => (
      (evidence.kind === 'DEPTH_SNAPSHOT' || evidence.kind === 'DEPTH_DELTA')
      && this.#depthResyncSeries.has(seriesKey(evidence))
    ));
    if (canonicalCutReconciled && !depthDuplicateWouldClearResync) {
      this.#commitAcceptedSource(lifecycleAdmission, fact, !depthDuplicateWouldClearResync);
    } else {
      const diagnostic = depthDuplicateWouldClearResync
        ? 'DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC'
        : failures.some((failure) => failure.code === 'SEQUENCE_GAP')
        ? 'SEQUENCE_GAP'
        : failures.some((failure) => failure.code === 'OUT_OF_ORDER_EVENT')
          ? 'OUT_OF_ORDER_EVENT'
          : 'SOURCE_CUT_REJECTED';
      this.#rejectSourceCut(lifecycleAdmission, fact, diagnostic);
    }
    const routingStateAccepted = canonicalCutReconciled && !depthDuplicateWouldClearResync;
    if (routingStateAccepted) {
      this.#watermarks.clear();
      for (const [key, value] of stagedWatermarks) this.#watermarks.set(key, value);
      for (const evidence of accepted) {
        if (evidence.kind === 'DEPTH_SNAPSHOT' && evidence.instrument.productFamily === 'SPOT') {
          this.#spotDepthResyncSeries.delete(seriesKey(evidence));
          this.#spotDepthResyncSymbols.delete(evidence.instrument.symbol);
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
            if (evidence.instrument.productFamily === 'SPOT') {
              this.#spotTradeGapSeries.delete(key);
              this.#spotTradeGapSymbols.delete(evidence.instrument.symbol);
            }
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
    for (const symbol of spotDepthGapSymbolsInBatch) this.#invalidateSpotDepthForResync(symbol);
    this.#counters.routed += routed;
    this.#counters.duplicate += duplicate;
    this.#counters.rejected += rejected;
    this.#recordRejected(failures);
    if (batchStale) this.#counters.stale += routed + duplicate;
    if (batchSampled) this.#counters.sampled += accepted.filter((entry) => entry.kind === 'LIQUIDATION').length;
    this.#recordFailures(allFailures);
    const receiptState = routeState({
      received: batch.evidence.length,
      routed: routed + duplicate,
      rejected,
      sampled: batchSampled,
      stale: batchStale,
      failures: allFailures,
    });
    return Object.freeze({
      correlationId: batch.correlationId,
      // Rows already accepted by the canonical sink remain immutable, but a
      // partially reconciled bootstrap is not current source truth. Never
      // describe an otherwise usable cut as FRESH/STALE/SAMPLED while its
      // lifecycle remains MISSING and a fresh explicit bootstrap is still
      // required. Preserve stronger causal failure states such as
      // SEQUENCE_GAP and OUT_OF_ORDER for exact operator diagnosis.
      state: depthDuplicateWouldClearResync
        ? 'MISSING' as const
        : lifecycleAdmission.pendingBootstrap && !canonicalCutReconciled
          && receiptState === 'REJECTED'
        ? 'MISSING' as const
        : receiptState,
      received: batch.evidence.length,
      routed,
      duplicate,
      rejected,
      failures: Object.freeze(this.#visibleFailures(allFailures)),
    });
  }

  snapshot(): Readonly<VolumeEvidenceRoutingSnapshot> {
    const nowMs = safeTime(this.#clock.nowMs(), 'clock.nowMs()');
    const capabilities = this.#capabilities(nowMs);
    return Object.freeze({
      observedAtMs: nowMs,
      capabilities,
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

  snapshotForSymbol(symbol: string): Readonly<VolumeEvidenceSymbolRoutingSnapshot> {
    if (typeof symbol !== 'string' || !/^[A-Z0-9]{2,32}$/.test(symbol)) {
      throw new TypeError('symbol must be a canonical bounded market symbol');
    }
    const nowMs = safeTime(this.#clock.nowMs(), 'clock.nowMs()');
    return Object.freeze({
      symbol,
      observedAtMs: nowMs,
      capabilities: this.#capabilities(nowMs, symbol),
      authority: 'EVIDENCE_ONLY' as const,
      liveMoneyAuthority: 'NONE' as const,
    });
  }

  #capabilities(
    nowMs: number,
    symbol?: string,
  ): readonly Readonly<VolumeEvidenceCapabilityTruth>[] {
    const capabilityTruth = REQUIRED_QUALITY_CAPABILITIES.map((capability) => (
      this.#capability(capability, nowMs, symbol)
    ));
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
    return Object.freeze([...capabilityTruth, quality]);
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
    this.#spotDepthResyncSymbols.clear();
    this.#contiguousGapSeries.clear();
    this.#spotTradeGapSeries.clear();
    this.#spotTradeGapSymbols.clear();
    this.#rejectedSourceCuts.clear();
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
    evidence: readonly Readonly<NormalizedEvidence>[],
    inspectBootstrapEvidence = true,
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
        candidate: null,
        newGeneration: false,
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
        candidate: null,
        newGeneration: false,
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
        candidate: null,
        newGeneration: false,
        pendingBootstrap: false,
      });
    }

    const newGeneration = prior !== null && source.generation > prior.generation;
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
    if (active && !hadBootstrap && evidence.length > 0 && inspectBootstrapEvidence) {
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
    const candidate = Object.freeze({
      sourceId: source.sourceId,
      dataset: source.dataset,
      endpointClass: source.endpointClass,
      lifecycle: source.lifecycle,
      generation: source.generation,
      revision: source.revision,
      closed,
      bootstrapped,
    });
    return Object.freeze({
      failure: bootstrapFailure,
      candidate,
      newGeneration,
      pendingBootstrap,
    });
  }

  #commitAcceptedSource(
    admission: SourceLifecycleAdmission,
    fact: BinanceSourceFact,
    replaceContinuity: boolean,
  ): void {
    const candidate = admission.candidate;
    if (candidate === null || candidate.closed || !ACTIVE_LIFECYCLES.has(candidate.lifecycle)) return;
    if (admission.pendingBootstrap && replaceContinuity) {
      this.#purgeSourceState(fact, admission.newGeneration
        ? 'SOURCE_GENERATION_CHANGED'
        : 'SOURCE_BOOTSTRAP_REPLACED');
    }
    this.#sourceLifecycles.set(sourceStateKey(candidate), Object.freeze({ ...candidate, bootstrapped: true }));
    this.#rejectedSourceCuts.delete(sourceObservationKey(candidate));
  }

  #commitUnavailableSource(
    admission: SourceLifecycleAdmission,
    fact: BinanceSourceFact,
    reason: string,
  ): void {
    const candidate = admission.candidate;
    if (candidate === null) return;
    this.#sourceLifecycles.set(sourceStateKey(candidate), Object.freeze({ ...candidate, bootstrapped: false }));
    this.#rejectedSourceCuts.delete(sourceObservationKey(candidate));
    this.#purgeSourceState(fact, reason);
  }

  #rejectSourceCut(
    admission: SourceLifecycleAdmission,
    fact: BinanceSourceFact,
    reason: string,
  ): void {
    const candidate = admission.candidate;
    if (candidate === null) return;
    this.#sourceLifecycles.set(sourceStateKey(candidate), Object.freeze({ ...candidate, bootstrapped: false }));
    this.#rejectedSourceCuts.set(sourceObservationKey(candidate), reason);
    // A rejected generation is an anti-replay fence, not a successful source
    // restart. Retain every prior causal watermark and resynchronization fence
    // until a higher, fully reconciled explicit bootstrap replaces them.
    for (const requirement of this.#requirementsForFact(fact)) {
      if (!this.#requirementIssues.has(requirement)) this.#requirementIssues.set(requirement, [reason]);
    }
    // Keep any independently established sibling depth snapshot and a newly
    // observed resync fence. Neither is positive bootstrap evidence, and both
    // are needed to prevent a later delta from clearing a real gap.
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

  #purgeSourceState(fact: BinanceSourceFact, reason: string): void {
    const removed = this.#removeSourceWatermarks(this.#watermarks, fact);
    for (const key of removed) {
      this.#depthResyncSeries.delete(key);
      this.#spotDepthResyncSeries.delete(key);
      this.#contiguousGapSeries.delete(key);
      this.#spotTradeGapSeries.delete(key);
    }
    if (fact.productFamily === 'SPOT' && fact.evidenceKinds.includes('TRADE')) {
      this.#spotTradeGapSymbols.clear();
    }
    if (fact.productFamily === 'SPOT'
        && fact.evidenceKinds.some((kind) => kind === 'DEPTH_SNAPSHOT' || kind === 'DEPTH_DELTA')) {
      this.#spotDepthResyncSymbols.clear();
    }
    this.#markSourceMissing(fact, reason);
  }

  #removeSourceWatermarks(
    watermarks: Map<string, SeriesWatermark>,
    fact: BinanceSourceFact,
    includeDepthFamily = true,
  ): Set<string> {
    const depthSource = fact.evidenceKinds.some((kind) => kind === 'DEPTH_SNAPSHOT' || kind === 'DEPTH_DELTA');
    const removed = new Set<string>();
    for (const [key, watermark] of watermarks) {
      const exactSource = watermark.sourceId === fact.sourceId && watermark.dataset === fact.dataset;
      const sameDepthFamily = includeDepthFamily
        && depthSource
        && watermark.productFamily === fact.productFamily
        && watermark.bookScope === fact.bookScope;
      if (!exactSource && !sameDepthFamily) continue;
      watermarks.delete(key);
      removed.add(key);
    }
    return removed;
  }

  #stageOrdering(
    evidence: NormalizedEvidence,
    source: RegisteredEvidenceSourceCut,
    fact: BinanceSourceFact,
    staged: Map<string, SeriesWatermark>,
  ): StableFailure | null {
    const key = seriesKey(evidence);
    const prior = staged.get(key) ?? null;
    if (prior === null && staged.size >= this.#maximumSeries) {
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
      this.#spotTradeGapSymbols.add(evidence.instrument.symbol);
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
      this.#spotDepthResyncSymbols.add(evidence.instrument.symbol);
      this.#invalidateSpotDepthForResync(evidence.instrument.symbol);
    }
    return makeStableFailure('SEQUENCE_GAP', COMPONENT, message, field, [evidence.id]);
  }

  #invalidateSpotDepthForResync(symbol?: string): void {
    this.#requirementIssues.set('SPOT_DEPTH', ['DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC']);
    const observations = this.#observations.get('SPOT_DEPTH');
    if (symbol === undefined) {
      this.#observations.delete('SPOT_DEPTH');
      return;
    }
    if (observations === undefined) return;
    for (const [key, observation] of observations) {
      if (observation.symbol === symbol) observations.delete(key);
    }
    if (observations.size === 0) this.#observations.delete('SPOT_DEPTH');
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
      if (requirement === 'SPOT_DEPTH' && this.#spotDepthResyncSymbols.has(evidence.instrument.symbol)) {
        this.#invalidateSpotDepthForResync(evidence.instrument.symbol);
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
        symbol: evidence.instrument.symbol,
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
      } else if (requirement === 'SPOT_DEPTH' && this.#rejectedSpotDepthDeltaReason() !== null) {
        // A sibling snapshot can be current without proving that the rejected
        // delta owner recovered. Restore the stronger retained causal reason
        // even when snapshot bootstrap temporarily wrote a generic issue.
        this.#requirementIssues.set(requirement, [this.#rejectedSpotDepthDeltaReason()!]);
      } else {
        this.#requirementIssues.delete(requirement);
      }
    }
  }

  #capability(
    capability: Exclude<VolumeEvidenceCapability, 'SOURCE_QUALITY'>,
    nowMs: number,
    symbol?: string,
  ): Readonly<VolumeEvidenceCapabilityTruth> {
    const requirements = CAPABILITY_REQUIREMENTS[capability];
    const spotTradeGap = symbol === undefined
      ? this.#spotTradeGapSeries.size > 0
      : this.#spotTradeGapSymbols.has(symbol);
    const rawObservationsByRequirement = requirements.map((requirement) => (
      requirement === 'SPOT_TRADE' && spotTradeGap
        ? []
        : [...(this.#observations.get(requirement)?.values() ?? [])]
          .filter((observation) => symbol === undefined || observation.symbol === symbol)
    ));
    const rejectedSpotDepthDelta = this.#rejectedSpotDepthDeltaReason();
    const observationsByRequirement = rawObservationsByRequirement.map((observations, index) => (
      requirements[index] === 'SPOT_DEPTH' && rejectedSpotDepthDelta !== null
        ? []
        : observations.filter((observation) => !this.#rejectedSourceCuts.has(sourceObservationKey(observation)))
    ));
    const allPresent = observationsByRequirement.flat();
    const historicalPresent = rawObservationsByRequirement.flat();
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
      const known = allPresent.length > 0 ? allPresent : historicalPresent;
      return Object.freeze({
        capability,
        freshness: 'MISSING' as const,
        completeness: allPresent.length === 0 ? 'MISSING' as const : 'PARTIAL' as const,
        lastEvidenceTimeMs: known.length === 0
          ? null
          : Math.min(...known.map((observation) => observation.evidenceTimeMs)),
        sourceIds: Object.freeze(sortedUnique(known.map((observation) => observation.sourceId))),
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

  #requirementsForFact(fact: BinanceSourceFact): ReadonlySet<Requirement> {
    const requirements = new Set<Requirement>();
    for (const kind of fact.evidenceKinds) {
      const family = fact.productFamily;
      if (kind === 'TRADE') {
        requirements.add(family === 'SPOT' ? 'SPOT_TRADE' : 'PERPETUAL_PRICE');
        if (family === 'SPOT') requirements.add('SPOT_PRICE');
      }
      if (kind === 'BOOK_TICKER') {
        requirements.add(family === 'SPOT' ? 'SPOT_BOOK' : 'PERPETUAL_PRICE');
        if (family === 'SPOT') requirements.add('SPOT_PRICE');
      }
      if ((kind === 'DEPTH_SNAPSHOT' || kind === 'DEPTH_DELTA') && family === 'SPOT') requirements.add('SPOT_DEPTH');
      if (kind === 'MARK_PRICE') requirements.add('PERPETUAL_PRICE');
      if (kind === 'OPEN_INTEREST') requirements.add('OPEN_INTEREST');
      if (kind === 'FUNDING') requirements.add('FUNDING');
      if (kind === 'LIQUIDATION') requirements.add('LIQUIDATION');
      if (kind === 'CONTEXT') requirements.add('CONTEXT');
    }
    return requirements;
  }

  #rejectedSpotDepthDeltaReason(): string | null {
    for (const fact of PUBLIC_FACTS) {
      if (fact.productFamily !== 'SPOT' || !fact.evidenceKinds.includes('DEPTH_DELTA')) continue;
      const reason = this.#rejectedSourceCuts.get(sourceObservationKey(fact));
      if (reason === 'SEQUENCE_GAP') return 'DEPTH_SEQUENCE_GAP_REQUIRES_RESYNC';
      if (reason !== undefined) return reason;
    }
    return null;
  }

  #retainRejectedCutOrMarkMissing(
    source: RegisteredEvidenceSourceCut,
    fact: BinanceSourceFact,
    reason: string,
  ): void {
    const rejectedReason = this.#rejectedSourceCuts.get(sourceObservationKey(fact));
    const key = sourceStateKey(source);
    const committed = this.#sourceLifecycles.get(key);
    if (committed !== undefined
        && source.generation === committed.generation
        && source.revision === committed.revision) {
      const durableReason = rejectedReason ?? reason;
      this.#sourceLifecycles.set(key, Object.freeze({ ...committed, bootstrapped: false }));
      this.#rejectedSourceCuts.set(sourceObservationKey(committed), durableReason);
      for (const requirement of this.#requirementsForFact(fact)) {
        if (!this.#requirementIssues.has(requirement)) {
          this.#requirementIssues.set(requirement, [durableReason]);
        }
      }
      if (fact.productFamily === 'SPOT'
          && fact.evidenceKinds.some((kind) => kind === 'DEPTH_SNAPSHOT' || kind === 'DEPTH_DELTA')
          && this.#spotDepthResyncSeries.size > 0) {
        this.#invalidateSpotDepthForResync();
      }
      return;
    }
    // A cut strictly behind the committed generation/revision is only a
    // delayed stale delivery. It cannot downgrade or erase newer accepted
    // truth. Exact-revision replay is handled above because that immutable cut
    // itself was rejected and therefore must become an unbootstrapped fence.
    if (committed !== undefined) return;
    if (rejectedReason === undefined) {
      this.#markSourceMissing(fact, reason);
      return;
    }
    for (const requirement of this.#requirementsForFact(fact)) {
      if (!this.#requirementIssues.has(requirement)) {
        this.#requirementIssues.set(requirement, [rejectedReason]);
      }
    }
  }

  #markSourceMissing(fact: BinanceSourceFact, reason: string): void {
    this.#rejectedSourceCuts.delete(sourceObservationKey(fact));
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
      state: routeState({ received, routed: 0, rejected: received, sampled: false, stale: false, failures: [failure] }),
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

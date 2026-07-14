import {
  FAILURE_CODES,
  canonicalJson,
  makeStableFailure,
  sortedUnique,
  stableId,
  validateNormalizedEvidence,
  validateNoSecretFields,
  validateTruthMetadata,
  type CandidateState,
  type NormalizedEvidence,
  type StableFailure,
  type StrategyCandidateHint,
  type TruthMetadata,
} from '../../intelligenceFoundation/contracts/index.js';
import { BINANCE_SOURCE_FACTS } from '../../intelligenceFoundation/evidence/index.js';
import {
  planAttentionFromPorts,
  type AttentionAllocation,
  type AttentionInstrument,
  type AttentionPlan,
  type AttentionSourceQuality,
  type StrategyCandidateHintPort,
} from '../../intelligenceFoundation/attention/index.js';
import {
  MarketFeatureBank,
  type FeatureSnapshot,
} from '../../intelligenceFoundation/features/index.js';
import { analyzeFalsePositiveForensics } from '../../intelligenceFoundation/forensics/index.js';
import { buildThesisPacket } from '../../intelligenceFoundation/thesis/index.js';
import type {
  UniverseGraph,
  UniverseMarketNode,
} from '../../intelligenceFoundation/universe/index.js';
import { boundedJsonByteLength } from '../contracts/index.js';
import {
  BoundedCorrelationIndex,
  BoundedEvidenceIndex,
  boundedSortedUnique,
  deepFreeze,
  evidenceTime,
} from './boundedIndex.js';
import {
  attentionTierRank,
  derivedSourceQuality,
  intelligenceBridgeConfig,
  primaryInstrument,
  projectPublicAttention,
} from './projection.js';
import type {
  BridgeEvaluationInput,
  BridgeEvaluationResult,
  BridgeEvidenceIngestReceipt,
  BridgeFailureRecord,
  BridgeFreezeRequest,
  BridgeIntelligenceArtifact,
  BridgePendingCandidateTrigger,
  BridgeUniverseReceipt,
  CorrelatedEvidenceBatch,
  IntelligenceBridgeConfig,
  IntelligenceBridgeOptions,
  IntelligenceBridgeSnapshot,
  InstrumentQualityOverride,
  PublicAttentionProjection,
} from './types.js';

const COMPONENT = 'intelligence.runtime.bridge';

const PUBLIC_EVIDENCE_FACTS = Object.freeze(Object.values(BINANCE_SOURCE_FACTS)
  .filter((fact) => fact.productFamily === 'SPOT' || fact.productFamily === 'USD_M_PERPETUAL' || fact.productFamily === 'ANY')
  .map((fact) => Object.freeze({
    sourceId: fact.sourceId,
    dataset: fact.dataset,
    endpointClass: fact.endpointClass,
    productFamily: fact.productFamily,
    evidenceKinds: Object.freeze([...fact.evidenceKinds]),
  })));

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeTime(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer`);
  return value;
}

function boundedId(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
    throw new TypeError(`${field} must be a bounded non-empty string`);
  }
  return value;
}

function truthHasFutureTime(truth: TruthMetadata, atMs: number): boolean {
  return [
    truth.temporal.sourceEventTimeMs,
    truth.temporal.sourceTransactionTimeMs,
    truth.temporal.receivedTimeMs,
    truth.freshness.evaluatedAtMs,
  ].some((time) => time !== null && time > atMs);
}

function failureOrder(left: StableFailure, right: StableFailure): number {
  return codePointCompare(left.id, right.id);
}

function rawEvidenceTime(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  const truth = (value as { truth?: unknown }).truth;
  if (truth === null || typeof truth !== 'object') return 0;
  const temporal = (truth as { temporal?: unknown }).temporal;
  if (temporal === null || typeof temporal !== 'object') return 0;
  const candidate = temporal as {
    sourceTransactionTimeMs?: unknown;
    sourceEventTimeMs?: unknown;
    receivedTimeMs?: unknown;
  };
  for (const time of [candidate.sourceTransactionTimeMs, candidate.sourceEventTimeMs, candidate.receivedTimeMs]) {
    if (Number.isSafeInteger(time) && (time as number) >= 0) return time as number;
  }
  return 0;
}

function normalizeFailure(value: unknown, config: IntelligenceBridgeConfig): StableFailure | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as Partial<StableFailure>;
  try {
    boundedJsonByteLength(value, config.maximumEvidenceBytes, {
      maximumDepth: Math.min(64, config.maximumEvidenceNestingDepth),
      maximumNodes: Math.min(1_000_000, config.maximumEvidenceNodes),
    });
  } catch {
    return null;
  }
  if (
    Object.getOwnPropertySymbols(value).length > 0
    || Object.keys(value).some((key) => !['id', 'code', 'component', 'message', 'retryable', 'field', 'evidenceIds'].includes(key))
    || typeof candidate.code !== 'string'
    || !(FAILURE_CODES as readonly string[]).includes(candidate.code)
    || typeof candidate.component !== 'string' || candidate.component.length === 0 || candidate.component.length > 96
    || typeof candidate.message !== 'string' || candidate.message.length === 0 || candidate.message.length > 256
    || typeof candidate.retryable !== 'boolean'
    || !(candidate.field === null || (typeof candidate.field === 'string' && candidate.field.length <= 256))
    || !Array.isArray(candidate.evidenceIds)
    || candidate.evidenceIds.length > 256
    || candidate.evidenceIds.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 256)
  ) return null;
  return makeStableFailure(
    candidate.code as StableFailure['code'],
    candidate.component,
    candidate.message,
    candidate.field,
    candidate.evidenceIds,
  );
}

function boundedEvidenceFailure(value: unknown, config: IntelligenceBridgeConfig): StableFailure | null {
  const seen = new Set<object>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop() as { value: unknown; depth: number };
    nodes += 1;
    if (nodes > config.maximumEvidenceNodes) {
      return makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'evidence exceeds the configured structural node bound', 'evidence');
    }
    if (current.depth > config.maximumEvidenceNestingDepth) {
      return makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'evidence exceeds the configured nesting-depth bound', 'evidence');
    }
    if (typeof current.value === 'string') {
      if (Buffer.byteLength(current.value, 'utf8') > config.maximumEvidenceStringBytes) {
        return makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'evidence string exceeds the configured byte bound', 'evidence');
      }
      continue;
    }
    if (current.value === null || typeof current.value !== 'object') continue;
    if (seen.has(current.value)) {
      return makeStableFailure('INVALID_VALUE', COMPONENT, 'cyclic evidence is forbidden', 'evidence');
    }
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      if (current.value.length > config.maximumEvidenceArrayLength) {
        return makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'evidence array exceeds the configured length bound', 'evidence');
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }
    const entries: Array<[string, unknown]> = [];
    for (const key in current.value as Record<string, unknown>) {
      if (!Object.prototype.hasOwnProperty.call(current.value, key)) continue;
      if (entries.length >= config.maximumEvidenceArrayLength) {
        return makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'evidence object exceeds the configured field bound', 'evidence');
      }
      entries.push([key, (current.value as Record<string, unknown>)[key]]);
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index] as [string, unknown];
      if (Buffer.byteLength(key, 'utf8') > config.maximumEvidenceStringBytes) {
        return makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'evidence field name exceeds the configured byte bound', 'evidence');
      }
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  const candidate = value as {
    kind?: unknown;
    bids?: unknown;
    asks?: unknown;
    truth?: { provenance?: { sourceRecordIds?: unknown; sourceSet?: unknown; transforms?: unknown } };
  };
  if (candidate?.kind === 'DEPTH_SNAPSHOT' || candidate?.kind === 'DEPTH_DELTA') {
    if (!Array.isArray(candidate.bids) || !Array.isArray(candidate.asks)
      || candidate.bids.length + candidate.asks.length > config.maximumDepthLevels) {
      return makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'market depth exceeds the configured level bound', 'evidence.depth');
    }
  }
  const provenance = candidate?.truth?.provenance;
  if (!provenance || [provenance.sourceRecordIds, provenance.sourceSet, provenance.transforms]
    .some((entries) => !Array.isArray(entries) || entries.length > config.maximumProvenanceIds)) {
    return makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'evidence provenance exceeds the configured bound', 'evidence.truth.provenance');
  }
  try {
    if (Buffer.byteLength(canonicalJson(value), 'utf8') > config.maximumEvidenceBytes) {
      return makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'serialized evidence exceeds the configured byte bound', 'evidence');
    }
  } catch {
    return makeStableFailure('INVALID_VALUE', COMPONENT, 'evidence cannot be canonically serialized', 'evidence');
  }
  return null;
}

function publicEvidenceFailure(evidence: NormalizedEvidence): StableFailure | null {
  if (evidence.kind === 'BORROW' || evidence.instrument.productFamily === 'BORROW') {
    return makeStableFailure(
      'WRONG_ENDPOINT_CLASS', COMPONENT, 'private or account-scoped borrow evidence is forbidden', 'kind', [evidence.id],
    );
  }
  const truth = evidence.truth;
  const fact = PUBLIC_EVIDENCE_FACTS.find((candidate) => (
    candidate.sourceId === truth.authority.sourceId
    && candidate.dataset === truth.authority.dataset
    && candidate.endpointClass === truth.authority.endpointClass
    && candidate.evidenceKinds.includes(evidence.kind as never)
    && (candidate.productFamily === 'ANY' || candidate.productFamily === evidence.instrument.productFamily)
  ));
  const expectedAuthority = fact?.productFamily === 'ANY' ? 'CONTEXTUAL' : 'EXCHANGE_PRIMARY';
  if (!fact || truth.authority.kind !== expectedAuthority) {
    return makeStableFailure(
      'WRONG_ENDPOINT_CLASS',
      COMPONENT,
      'evidence authority is not an allowlisted public source contract',
      'truth.authority',
      [evidence.id],
    );
  }
  return null;
}

function allocationOrder(left: AttentionAllocation, right: AttentionAllocation): number {
  return attentionTierRank(right.tier) - attentionTierRank(left.tier)
    || (right.priority ?? Number.NEGATIVE_INFINITY) - (left.priority ?? Number.NEGATIVE_INFINITY)
    || codePointCompare(left.instrumentId, right.instrumentId);
}

function selectedTruth(node: UniverseMarketNode): TruthMetadata {
  return node.spot?.truth ?? node.usdMPerpetual?.truth ?? node.truth;
}

function qualityOverrideMap(
  values: readonly InstrumentQualityOverride[],
): { ok: true; value: ReadonlyMap<string, AttentionSourceQuality> } | { ok: false; failure: StableFailure } {
  const result = new Map<string, AttentionSourceQuality>();
  for (const entry of values) {
    if (
      entry === null
      || typeof entry !== 'object'
      || typeof entry.instrumentId !== 'string'
      || entry.instrumentId.trim().length === 0
      || entry.instrumentId.length > 256
      || entry.sourceQuality === null
      || typeof entry.sourceQuality !== 'object'
      || !['HEALTHY', 'DEGRADED', 'STALE', 'FAILED', 'UNKNOWN'].includes(entry.sourceQuality.state)
      || !Array.isArray(entry.sourceQuality.reasonCodes)
      || entry.sourceQuality.reasonCodes.length > 256
      || entry.sourceQuality.reasonCodes.some((reason) => typeof reason !== 'string' || reason.length > 128)
    ) {
      return {
        ok: false,
        failure: makeStableFailure('INVALID_VALUE', COMPONENT, 'invalid source-quality override', 'sourceQuality'),
      };
    }
    if (result.has(entry.instrumentId)) {
      return {
        ok: false,
        failure: makeStableFailure('DUPLICATE_EVENT', COMPONENT, 'duplicate source-quality override', 'sourceQuality.instrumentId'),
      };
    }
    result.set(entry.instrumentId, {
      state: entry.sourceQuality.state,
      reasonCodes: sortedUnique(entry.sourceQuality.reasonCodes),
    });
  }
  return { ok: true, value: result };
}

/**
 * Public, evidence-only composition over the frozen IntelligenceFoundation.
 * It owns no transport, strategy, proposal, risk, order, or execution state.
 */
export class IntelligenceRuntimeBridge {
  readonly #config: IntelligenceBridgeConfig;
  readonly #clock: IntelligenceBridgeOptions['clock'];
  readonly #protectedSymbols: IntelligenceBridgeOptions['protectedSymbols'];
  readonly #featureBank: MarketFeatureBank;
  readonly #evidence: BoundedEvidenceIndex;
  readonly #correlations: BoundedCorrelationIndex;
  readonly #failureRecords = new Map<string, BridgeFailureRecord>();
  #universe: UniverseGraph | null = null;
  #previousAllocations: readonly AttentionAllocation[] = Object.freeze([]);
  #attentionPlan: AttentionPlan | null = null;
  #publicAttention: PublicAttentionProjection | null = null;
  #artifacts = new Map<string, BridgeIntelligenceArtifact>();
  #pendingCandidateTriggers = new Map<string, BridgePendingCandidateTrigger>();
  #freezeEmittedCandidateIds = new Set<string>();

  constructor(options: IntelligenceBridgeOptions) {
    if (options === null || typeof options !== 'object' || !options.clock || typeof options.clock.nowMs !== 'function') {
      throw new TypeError('bridge requires an injected runtime clock');
    }
    this.#clock = options.clock;
    this.#protectedSymbols = options.protectedSymbols;
    safeTime(this.#clock.nowMs(), 'clock.nowMs()');
    this.#config = intelligenceBridgeConfig(options.config);
    this.#featureBank = new MarketFeatureBank({ now: () => this.#now() }, this.#config.featureBank);
    this.#evidence = new BoundedEvidenceIndex({
      capacity: this.#config.maximumIndexedEvidence,
      maximumPerSymbol: this.#config.maximumEvidencePerSymbol,
      maximumPerSymbolKind: this.#config.maximumEvidencePerSymbolKind,
      maximumTruncatedSymbols: this.#config.maximumUniverseNodes,
      maximumCorrelationRoots: this.#config.maximumCorrelationRootsPerEntry,
      maximumEvidenceBytes: this.#config.maximumEvidenceBytes,
    });
    this.#correlations = new BoundedCorrelationIndex(
      this.#config.maximumLineageEntries,
      this.#config.maximumCorrelationRootsPerEntry,
    );
  }

  get config(): IntelligenceBridgeConfig {
    return this.#config;
  }

  updateUniverse(graph: UniverseGraph): BridgeUniverseReceipt {
    const atMs = this.#now();
    const failure = this.#validateUniverse(graph, atMs);
    if (failure) {
      this.#recordFailures([failure], atMs);
      return deepFreeze({ accepted: false, graphId: null, nodeCount: 0, failure });
    }
    this.#universe = deepFreeze(structuredClone(graph));
    return deepFreeze({
      accepted: true,
      graphId: this.#universe.id,
      nodeCount: this.#universe.nodes.length,
      failure: null,
    });
  }

  ingest(batch: CorrelatedEvidenceBatch): BridgeEvidenceIngestReceipt {
    const atMs = this.#now();
    if (
      batch === null
      || typeof batch !== 'object'
      || typeof batch.correlationId !== 'string'
      || batch.correlationId.trim().length === 0
      || batch.correlationId.length > 256
      || !['BROAD', 'FOCUSED'].includes(batch.scope)
      || !Array.isArray(batch.evidence)
      || !(batch.qualityFailures === undefined || Array.isArray(batch.qualityFailures))
    ) {
      const failure = makeStableFailure('INVALID_VALUE', COMPONENT, 'invalid correlated evidence batch', 'batch');
      this.#recordFailures([failure], atMs);
      return deepFreeze({
        correlationId: '', scope: 'BROAD', received: 0, accepted: 0, rejected: 0, duplicate: 0, evicted: 0, failures: [failure],
      });
    }
    if (batch.evidence.length > this.#config.maximumEvidenceBatch) {
      const failure = makeStableFailure(
        'BUDGET_EXHAUSTED',
        COMPONENT,
        'evidence batch exceeds configured bridge capacity',
        'maximumEvidenceBatch',
      );
      this.#recordFailures([failure], atMs);
      return deepFreeze({
        correlationId: batch.correlationId,
        scope: batch.scope,
        received: batch.evidence.length,
        accepted: 0,
        rejected: batch.evidence.length,
        duplicate: 0,
        evicted: 0,
        failures: [failure],
      });
    }
    if ((batch.qualityFailures?.length ?? 0) > this.#config.maximumEvidenceBatch) {
      const failure = makeStableFailure(
        'BUDGET_EXHAUSTED',
        COMPONENT,
        'source quality failure batch exceeds configured bridge capacity',
        'qualityFailures',
      );
      this.#recordFailures([failure], atMs);
      return deepFreeze({
        correlationId: batch.correlationId,
        scope: batch.scope,
        received: batch.evidence.length,
        accepted: 0,
        rejected: batch.evidence.length,
        duplicate: 0,
        evicted: 0,
        failures: [failure],
      });
    }

    this.#correlations.link(batch.correlationId, 'SOURCE', [batch.correlationId], atMs);
    const failures: StableFailure[] = [];
    for (const rawFailure of batch.qualityFailures ?? []) {
      const failure = normalizeFailure(rawFailure, this.#config);
      failures.push(failure ?? makeStableFailure(
        'INVALID_VALUE', COMPONENT, 'invalid source quality failure record', 'qualityFailures',
      ));
    }
    let accepted = 0;
    let rejected = 0;
    let duplicate = 0;
    let evicted = 0;
    const ordered = [...batch.evidence].sort((left, right) => (
      codePointCompare(left?.instrument?.symbol ?? '', right?.instrument?.symbol ?? '')
      || codePointCompare(left?.instrument?.instrumentId ?? '', right?.instrument?.instrumentId ?? '')
      || rawEvidenceTime(left) - rawEvidenceTime(right)
      || codePointCompare(left?.id ?? '', right?.id ?? '')
    ));
    for (const raw of ordered) {
      const budgetFailure = boundedEvidenceFailure(raw, this.#config);
      if (budgetFailure) {
        failures.push(budgetFailure);
        rejected += 1;
        continue;
      }
      const validation = validateNormalizedEvidence(raw);
      if (!validation.ok) {
        failures.push(validation.failure);
        rejected += 1;
        continue;
      }
      const evidence = validation.value;
      const authorityFailure = publicEvidenceFailure(evidence);
      if (authorityFailure) {
        failures.push(authorityFailure);
        rejected += 1;
        continue;
      }
      if (truthHasFutureTime(evidence.truth, atMs) || evidenceTime(evidence) > atMs) {
        failures.push(makeStableFailure(
          'NO_LOOK_AHEAD_VIOLATION', COMPONENT, 'evidence occurs after the injected bridge clock', 'truth.temporal', [evidence.id],
        ));
        rejected += 1;
        continue;
      }
      if (this.#evidence.has(evidence.id)) {
        const result = this.#evidence.add(evidence, batch.scope, [batch.correlationId]);
        failures.push(makeStableFailure(
          result.conflict ? 'INVALID_VALUE' : 'DUPLICATE_EVENT',
          COMPONENT,
          result.conflict ? 'evidence id conflicts with retained canonical payload' : 'duplicate evidence id rejected',
          'evidence.id',
          [evidence.id],
        ));
        if (result.conflict) rejected += 1;
        else {
          this.#correlations.link(evidence.id, 'EVIDENCE', [batch.correlationId], atMs);
          duplicate += 1;
        }
        continue;
      }
      const featureIngest = this.#featureBank.ingest(structuredClone(evidence));
      if (featureIngest.accepted !== 1) {
        failures.push(...featureIngest.failures);
        rejected += 1;
        continue;
      }
      const roots = this.#correlations.link(evidence.id, 'EVIDENCE', [batch.correlationId], atMs);
      const add = this.#evidence.add(evidence, batch.scope, roots);
      accepted += 1;
      evicted += add.evictedIds.length;
    }
    const visibleFailures = this.#boundedFailures(failures);
    this.#recordFailures(failures, atMs);
    return deepFreeze({
      correlationId: batch.correlationId,
      scope: batch.scope,
      received: batch.evidence.length,
      accepted,
      rejected,
      duplicate,
      evicted,
      failures: visibleFailures,
    });
  }

  evaluate(input: BridgeEvaluationInput = {}): BridgeEvaluationResult {
    const atMs = this.#now();
    const failures: StableFailure[] = [];
    if (this.#universe === null) {
      failures.push(makeStableFailure('MISSING_SOURCE', COMPONENT, 'universe graph has not been supplied', 'universe'));
      return this.#finishEvaluation(atMs, failures, []);
    }
    if (
      input === null
      || typeof input !== 'object'
      || !Array.isArray(input.hintPorts ?? [])
      || !Array.isArray(input.sourceQuality ?? [])
    ) {
      failures.push(makeStableFailure('INVALID_VALUE', COMPONENT, 'invalid bridge evaluation input', 'input'));
      return this.#finishEvaluation(atMs, failures, []);
    }
    const hintPorts = input.hintPorts ?? [];
    if (hintPorts.length > this.#config.maximumHintPorts) {
      failures.push(makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'hint port set exceeds bridge capacity', 'maximumHintPorts'));
      return this.#finishEvaluation(atMs, failures, []);
    }
    if ((input.sourceQuality?.length ?? 0) > this.#config.maximumUniverseNodes) {
      failures.push(makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'source-quality override set exceeds universe capacity', 'sourceQuality'));
      return this.#finishEvaluation(atMs, failures, []);
    }
    const seenPortIds = new Set<string>();
    if (hintPorts.some((port) => (
      port === null
      || typeof port !== 'object'
      || typeof port.portId !== 'string'
      || !/^[a-z][a-z0-9._-]{0,63}$/i.test(port.portId)
      || seenPortIds.has(port.portId)
      || (seenPortIds.add(port.portId), false)
      || typeof port.readCandidateHints !== 'function'
    ))) {
      failures.push(makeStableFailure('INVALID_VALUE', COMPONENT, 'invalid candidate hint port', 'hintPorts'));
      return this.#finishEvaluation(atMs, failures, []);
    }
    const quality = qualityOverrideMap(input.sourceQuality ?? []);
    if (!quality.ok) {
      failures.push(quality.failure);
      return this.#finishEvaluation(atMs, failures, []);
    }
    let protectedSymbols = new Set<string>();
    if (this.#protectedSymbols) {
      try {
        const values = this.#protectedSymbols.protectedSymbols(atMs);
        if (!Array.isArray(values) || values.length > this.#config.maximumUniverseNodes) {
          throw new TypeError('invalid protected-symbol set');
        }
        for (const symbol of values) protectedSymbols.add(boundedId(symbol, 'protected symbol'));
      } catch {
        failures.push(makeStableFailure(
          'PROTECTED_CAPITAL', COMPONENT, 'protected-symbol source unavailable; attention update withheld', 'protectedSymbols',
        ));
        return this.#finishEvaluation(atMs, failures, []);
      }
    }

    const instruments: AttentionInstrument[] = [];
    for (const node of [...this.#universe.nodes].sort((left, right) => codePointCompare(left.id, right.id))) {
      const identity = primaryInstrument(node);
      if (!identity) continue;
      instruments.push({
        instrumentId: identity.instrumentId,
        symbol: identity.symbol,
        protectedCapital: protectedSymbols.has(identity.symbol),
        releaseRequested: false,
        releaseReasonCodes: [],
        focusEligibility: {
          state: node.focusEligibility.state,
          reasonCodes: [...node.focusEligibility.reasonCodes],
        },
        sourceQuality: quality.value.get(identity.instrumentId) ?? derivedSourceQuality(node),
        truth: structuredClone(selectedTruth(node)),
      });
    }

    let retainedHintCount = 0;
    const retainedHintIds = new Set<string>();
    const retainedHintsPerInstrument = new Map<string, number>();
    const wrappedPorts = hintPorts.map((port): StrategyCandidateHintPort => ({
      portId: port.portId,
      readCandidateHints: (observedAtMs) => {
        const hints = port.readCandidateHints(observedAtMs);
        if (!Array.isArray(hints)
          || hints.length > this.#config.attention.maxHintsPerPlan - retainedHintCount) {
          throw new RangeError('candidate hint batch exceeds configured planner capacity');
        }
        const localIds = new Set<string>();
        const localInstrumentCounts = new Map<string, number>();
        for (const rawHint of hints as readonly StrategyCandidateHint[]) {
          const budgetFailure = boundedEvidenceFailure(rawHint, this.#config);
          const truth = rawHint && typeof rawHint === 'object' ? validateTruthMetadata(rawHint.truth) : null;
          const secret = rawHint && typeof rawHint === 'object'
            ? validateNoSecretFields(rawHint, 'intelligence_runtime_bridge_hint')
            : null;
          if (
            budgetFailure
            || !rawHint
            || typeof rawHint !== 'object'
            || typeof rawHint.id !== 'string'
            || rawHint.id.trim().length === 0
            || rawHint.id.length > 256
            || localIds.has(rawHint.id)
            || retainedHintIds.has(rawHint.id)
            || !['basis', 'volume_spike', 'other'].includes(rawHint.strategy)
            || typeof rawHint.instrumentId !== 'string'
            || rawHint.instrumentId.trim().length === 0
            || rawHint.instrumentId.length > 256
            || typeof rawHint.symbol !== 'string'
            || rawHint.symbol.trim().length === 0
            || rawHint.symbol.length > 128
            || !['WATCHING', 'FOCUS', 'PROPOSED', 'ACTIVE', 'COOLDOWN', 'UNKNOWN'].includes(rawHint.sourceState)
            || !Number.isSafeInteger(rawHint.engineObservedAtMs)
            || rawHint.engineObservedAtMs < 0
            || !(rawHint.priority === null || Number.isFinite(rawHint.priority))
            || !Array.isArray(rawHint.reasonCodes)
            || rawHint.reasonCodes.length > this.#config.maximumEvidenceArrayLength
            || rawHint.reasonCodes.some((reason) => typeof reason !== 'string'
              || Buffer.byteLength(reason, 'utf8') > this.#config.maximumEvidenceStringBytes)
            || typeof rawHint.protected !== 'boolean'
            || !(rawHint.upstreamCorrelationId === null
              || typeof rawHint.upstreamCorrelationId === 'string'
              && rawHint.upstreamCorrelationId.trim().length > 0
              && rawHint.upstreamCorrelationId.length <= 256)
            || !truth?.ok
            || !secret?.ok
            || truth.value.provenance.sourceRecordIds.length > 256
            || truth.value.provenance.sourceSet.length > 64
            || truth.value.provenance.transforms.length > 64
            || truth.value.completeness.observedFields.length > 256
            || truth.value.completeness.missingFields.length > 256
            || truth.value.completeness.reasonCodes.length > 256
          ) {
            throw new TypeError('invalid or oversized candidate hint batch');
          }
          localIds.add(rawHint.id);
          const count = (retainedHintsPerInstrument.get(rawHint.instrumentId) ?? 0)
            + (localInstrumentCounts.get(rawHint.instrumentId) ?? 0) + 1;
          if (count > this.#config.attention.maxHintsPerInstrument) {
            throw new RangeError('candidate hint instrument batch exceeds configured planner capacity');
          }
          localInstrumentCounts.set(rawHint.instrumentId, (localInstrumentCounts.get(rawHint.instrumentId) ?? 0) + 1);
        }
        retainedHintCount += hints.length;
        for (const [instrumentId, count] of localInstrumentCounts) {
          retainedHintsPerInstrument.set(instrumentId, (retainedHintsPerInstrument.get(instrumentId) ?? 0) + count);
        }
        for (const hint of hints) {
          retainedHintIds.add(hint.id);
          this.#correlations.link(
            hint.id,
            'HINT',
            typeof hint.upstreamCorrelationId === 'string' ? [hint.upstreamCorrelationId] : [],
            observedAtMs,
          );
        }
        return hints;
      },
    }));
    const instrumentIds = new Set(instruments.map((instrument) => instrument.instrumentId));
    const previousAllocations = this.#previousAllocations.filter((allocation) => instrumentIds.has(allocation.instrumentId));
    const planned = planAttentionFromPorts({ atMs, instruments, previousAllocations }, wrappedPorts, this.#config.attention);
    if (!planned.ok) {
      failures.push(planned.failure);
      return this.#finishEvaluation(atMs, failures, []);
    }
    const plan = deepFreeze(structuredClone(planned.value));
    failures.push(...plan.hintPortFailures);
    this.#linkAttentionPlan(plan, atMs);
    const publicAttention = projectPublicAttention(plan, (allocationId, hintIds) => (
      this.#correlations.rootsForMany([allocationId, ...hintIds])
    ));

    const allocationByInstrument = new Map(plan.allocations.map((allocation) => [allocation.instrumentId, allocation]));
    const candidateByInstrument = new Map(plan.candidates.map((candidate) => [candidate.instrumentId, candidate]));
    const currentCandidateIds = new Set(plan.candidates.map((candidate) => candidate.id));
    this.#freezeEmittedCandidateIds = new Set([...this.#freezeEmittedCandidateIds]
      .filter((candidateId) => currentCandidateIds.has(candidateId)));
    for (const [instrumentId, pending] of this.#pendingCandidateTriggers) {
      if (candidateByInstrument.get(instrumentId)?.id !== pending.candidateId) {
        this.#pendingCandidateTriggers.delete(instrumentId);
      }
    }
    for (const request of plan.requests) {
      if (attentionTierRank(request.fromTier) >= attentionTierRank('CANDIDATE')
        || attentionTierRank(request.toTier) < attentionTierRank('CANDIDATE')) continue;
      const candidate = candidateByInstrument.get(request.instrumentId);
      if (!candidate || this.#freezeEmittedCandidateIds.has(candidate.id)) continue;
      this.#pendingCandidateTriggers.set(request.instrumentId, deepFreeze({
        candidateId: candidate.id,
        instrumentId: request.instrumentId,
        transitionAtMs: request.createdAtMs,
      }));
    }
    const nodeByInstrument = new Map<string, UniverseMarketNode>();
    for (const node of this.#universe.nodes) {
      const instrument = primaryInstrument(node);
      if (instrument) nodeByInstrument.set(instrument.instrumentId, node);
    }
    const orderedCandidates = [...plan.candidates].sort((left, right) => {
      const leftAllocation = allocationByInstrument.get(left.instrumentId);
      const rightAllocation = allocationByInstrument.get(right.instrumentId);
      if (leftAllocation && rightAllocation) return allocationOrder(leftAllocation, rightAllocation);
      return codePointCompare(left.instrumentId, right.instrumentId);
    });
    if (orderedCandidates.length > this.#config.maximumArtifacts) {
      failures.push(makeStableFailure(
        'BUDGET_EXHAUSTED', COMPONENT, 'candidate artifact set exceeds bridge capacity', 'maximumArtifacts',
      ));
    }
    const nextArtifacts = new Map<string, BridgeIntelligenceArtifact>();
    for (const candidate of orderedCandidates.slice(0, this.#config.maximumArtifacts)) {
      const allocation = allocationByInstrument.get(candidate.instrumentId);
      const node = nodeByInstrument.get(candidate.instrumentId);
      if (!allocation || !node) continue;
      const built = this.#buildArtifact(candidate, allocation, node, atMs);
      if (!built.ok) failures.push(built.failure);
      else nextArtifacts.set(candidate.instrumentId, built.value);
    }

    const freezeRequests: BridgeFreezeRequest[] = [];
    for (const pending of [...this.#pendingCandidateTriggers.values()]
      .sort((left, right) => codePointCompare(left.instrumentId, right.instrumentId))) {
      const artifact = nextArtifacts.get(pending.instrumentId);
      if (!artifact || artifact.candidateId !== pending.candidateId
        || this.#freezeEmittedCandidateIds.has(pending.candidateId)) continue;
      const freeze = deepFreeze({
        id: stableId('intelligence-runtime-freeze-request', {
          candidateId: artifact.candidateId,
          triggerTimeMs: atMs,
          thesisId: artifact.thesis.id,
          forensicsId: artifact.forensics.id,
        }),
        candidateId: artifact.candidateId,
        correlationIds: [...artifact.correlationIds],
        input: {
          triggerTimeMs: atMs,
          evidenceCutoffTimeMs: atMs,
          candidateDisposition: 'OBSERVED' as const,
          thesis: structuredClone(artifact.thesis),
          forensics: structuredClone(artifact.forensics.checks),
          evidence: this.#evidence.recordsForSymbol(artifact.symbol, atMs, this.#config.maximumThesisEvidence)
            .map((record) => structuredClone(record.evidence)),
          features: structuredClone(artifact.featureSnapshot.features),
          configurationVersion: this.#config.configurationVersion,
          featureVersion: this.#config.featureBank.featureVersion,
          producerVersion: 'intelligence-runtime-bridge-1',
        },
        authority: 'OUTCOME_CAPTURE_REQUEST_ONLY' as const,
      });
      this.#correlations.link(freeze.id, 'FREEZE_REQUEST', artifact.correlationIds, atMs);
      freezeRequests.push(freeze);
      this.#pendingCandidateTriggers.delete(pending.instrumentId);
      this.#freezeEmittedCandidateIds.add(pending.candidateId);
    }

    this.#attentionPlan = plan;
    this.#publicAttention = publicAttention;
    this.#previousAllocations = deepFreeze(structuredClone(plan.allocations));
    this.#artifacts = nextArtifacts;
    return this.#finishEvaluation(atMs, failures, freezeRequests);
  }

  snapshot(): IntelligenceBridgeSnapshot {
    const snapshotTimeMs = this.#now();
    const artifacts = this.#currentArtifacts();
    const failureRecords = [...this.#failureRecords.values()]
      .sort((left, right) => codePointCompare(left.failure.id, right.failure.id))
      .map((record) => structuredClone(record));
    const pendingCandidateTriggers = [...this.#pendingCandidateTriggers.values()]
      .sort((left, right) => codePointCompare(left.instrumentId, right.instrumentId))
      .map((pending) => structuredClone(pending));
    const featureBank = this.#featureBank.stats();
    const evidenceIndex = this.#evidence.stats(snapshotTimeMs, this.#config.featureBank.historyRetentionMs);
    const correlationIndex = this.#correlations.snapshot();
    return deepFreeze({
      id: stableId('intelligence-runtime-bridge-snapshot', {
        snapshotTimeMs,
        configurationVersion: this.#config.configurationVersion,
        universeGraphId: this.#universe?.id ?? null,
        attentionPlanId: this.#attentionPlan?.id ?? null,
        artifactIds: artifacts.map((artifact) => artifact.id),
        pendingCandidateTriggers,
        failureCounts: failureRecords.map((record) => [record.failure.id, record.count]),
        featureBank,
        evidenceIndex,
        correlationIndex,
      }),
      snapshotTimeMs,
      configurationVersion: this.#config.configurationVersion,
      universeGraphId: this.#universe?.id ?? null,
      universeNodeCount: this.#universe?.nodes.length ?? 0,
      featureBank,
      evidenceIndex,
      correlationIndex,
      attentionPlan: this.#attentionPlan === null ? null : structuredClone(this.#attentionPlan),
      publicAttention: this.#publicAttention === null ? null : structuredClone(this.#publicAttention),
      artifacts,
      pendingCandidateTriggers,
      failures: failureRecords,
      authority: 'EVIDENCE_ONLY' as const,
      liveMoneyAuthority: 'NONE' as const,
      createsProposal: false as const,
      createsRiskVerdict: false as const,
      executesAction: false as const,
    });
  }

  #now(): number {
    return safeTime(this.#clock.nowMs(), 'clock.nowMs()');
  }

  #validateUniverse(graph: UniverseGraph, atMs: number): StableFailure | null {
    if (
      graph === null
      || typeof graph !== 'object'
      || typeof graph.id !== 'string'
      || graph.id.trim().length === 0
      || !Number.isSafeInteger(graph.observedAtMs)
      || graph.observedAtMs < 0
      || !Array.isArray(graph.nodes)
      || graph.nodes.length > this.#config.maximumUniverseNodes
    ) {
      return makeStableFailure('INVALID_VALUE', COMPONENT, 'invalid or oversized universe graph', 'universe');
    }
    try {
      boundedJsonByteLength(graph, this.#config.maximumUniverseGraphBytes);
    } catch (error) {
      return makeStableFailure(
        error instanceof RangeError ? 'BUDGET_EXHAUSTED' : 'INVALID_VALUE',
        COMPONENT,
        error instanceof RangeError
          ? 'universe graph exceeds the configured whole-graph byte or structure bound'
          : 'universe graph is not a strict bounded JSON contract',
        'universe',
      );
    }
    const truth = validateTruthMetadata(graph.truth);
    if (!truth.ok) return truth.failure;
    if (graph.observedAtMs > atMs || truthHasFutureTime(truth.value, atMs)) {
      return makeStableFailure('NO_LOOK_AHEAD_VIOLATION', COMPONENT, 'universe graph occurs after bridge clock', 'universe.observedAtMs');
    }
    if (this.#universe !== null) {
      if (graph.observedAtMs < this.#universe.observedAtMs) {
        return makeStableFailure('OUT_OF_ORDER_EVENT', COMPONENT, 'universe graph precedes retained universe truth', 'universe.observedAtMs');
      }
      if (graph.observedAtMs === this.#universe.observedAtMs && graph.id !== this.#universe.id) {
        return makeStableFailure('INVALID_VALUE', COMPONENT, 'universe graph conflicts at the retained observation time', 'universe.id');
      }
    }
    const nodeIds = new Set<string>();
    const instrumentIds = new Set<string>();
    for (const node of graph.nodes) {
      if (!node || typeof node.id !== 'string' || node.id.trim().length === 0 || nodeIds.has(node.id)) {
        return makeStableFailure('DUPLICATE_EVENT', COMPONENT, 'universe node ids must be canonical and unique', 'universe.nodes');
      }
      nodeIds.add(node.id);
      const identity = primaryInstrument(node);
      if (identity) {
        if (instrumentIds.has(identity.instrumentId)) {
          return makeStableFailure('DUPLICATE_EVENT', COMPONENT, 'primary universe instrument ids must be unique', 'universe.nodes.instrument');
        }
        instrumentIds.add(identity.instrumentId);
      }
    }
    return null;
  }

  #linkAttentionPlan(plan: AttentionPlan, atMs: number): void {
    const allocationByInstrument = new Map<string, AttentionAllocation>();
    for (const allocation of plan.allocations) {
      const roots = this.#correlations.rootsForMany(allocation.hintIds);
      this.#correlations.link(allocation.id, 'ATTENTION', roots, atMs);
      allocationByInstrument.set(allocation.instrumentId, allocation);
    }
    for (const request of plan.requests) {
      const allocation = allocationByInstrument.get(request.instrumentId);
      this.#correlations.link(request.id, 'ATTENTION', allocation ? this.#correlations.rootsFor(allocation.id) : [], atMs);
    }
    for (const candidate of plan.candidates) {
      const allocation = allocationByInstrument.get(candidate.instrumentId);
      this.#correlations.link(
        candidate.id,
        'CANDIDATE',
        this.#correlations.rootsForMany([...(allocation ? [allocation.id] : []), ...candidate.hintIds]),
        atMs,
      );
    }
    this.#correlations.link(
      plan.id,
      'ATTENTION',
      this.#correlations.rootsForMany([
        ...plan.allocations.map((allocation) => allocation.id),
        ...plan.requests.map((request) => request.id),
        ...plan.candidates.map((candidate) => candidate.id),
      ]),
      atMs,
    );
  }

  #buildArtifact(
    candidate: CandidateState,
    allocation: AttentionAllocation,
    node: UniverseMarketNode,
    atMs: number,
  ): { ok: true; value: BridgeIntelligenceArtifact } | { ok: false; failure: StableFailure } {
    const symbol = primaryInstrument(node)?.symbol ?? node.baseAsset;
    if (this.#evidence.isTruncated(symbol, atMs, this.#config.featureBank.historyRetentionMs)) {
      return {
        ok: false,
        failure: makeStableFailure(
          'INCOMPLETE_EVIDENCE', COMPONENT, 'retained evidence for candidate symbol is truncated', 'evidenceIndex', [candidate.id],
        ),
      };
    }
    const snapshot = this.#featureBank.snapshot(symbol);
    if (!snapshot || snapshot.instrumentId !== candidate.instrumentId) {
      return {
        ok: false,
        failure: makeStableFailure(
          'MISSING_SOURCE', COMPONENT, 'candidate has no exact primary-instrument feature snapshot', 'featureSnapshot', [candidate.id],
        ),
      };
    }
    const indexed = this.#evidence.recordsForSymbol(symbol, atMs, this.#config.maximumThesisEvidence);
    const evidence = indexed.map((record) => structuredClone(record.evidence));
    const evidenceRoots = new Map(indexed.map((record) => [record.evidence.id, record.correlationIds]));
    const sufficientPrimaryEvidence = evidence.some((record) => (
      record.instrument.instrumentId === candidate.instrumentId
      && (record.kind === 'TRADE' || record.kind === 'BOOK_TICKER')
      && record.truth.freshness.state === 'FRESH'
      && record.truth.completeness.state === 'COMPLETE'
      && !truthHasFutureTime(record.truth, atMs)
    ));
    if (!sufficientPrimaryEvidence) {
      return {
        ok: false,
        failure: makeStableFailure(
          'INSUFFICIENT_HISTORY', COMPONENT, 'candidate lacks fresh complete primary market evidence', 'evidence', [candidate.id],
        ),
      };
    }
    const features = snapshot.features.slice(0, this.#config.maximumThesisFeatures).map((feature) => structuredClone(feature));
    const boundedSnapshot: FeatureSnapshot = {
      ...structuredClone(snapshot),
      features,
      sourceEvidenceIds: snapshot.sourceEvidenceIds.slice(0, this.#config.featureBank.maxProvenanceIds),
    };
    for (const feature of features) {
      const directRoots: string[] = [];
      for (const evidenceId of feature.truth.provenance.sourceRecordIds) {
        directRoots.push(...(evidenceRoots.get(evidenceId) ?? []));
        if (directRoots.length > this.#config.maximumCorrelationRootsPerEntry * 2) {
          directRoots.splice(0, directRoots.length, ...boundedSortedUnique(
            directRoots,
            this.#config.maximumCorrelationRootsPerEntry,
          ));
        }
      }
      this.#correlations.link(
        feature.id,
        'FEATURE',
        boundedSortedUnique([
          ...this.#correlations.rootsForMany(feature.truth.provenance.sourceRecordIds),
          ...directRoots,
        ], this.#config.maximumCorrelationRootsPerEntry),
        atMs,
      );
    }
    const requiredEvidenceKinds = allocation.requestedEvidence.filter((kind) => kind !== 'BORROW');
    const thesis = buildThesisPacket({
      candidate: structuredClone(candidate),
      baseline: structuredClone(boundedSnapshot.baseline),
      features,
      evidence,
      analogueIds: [],
      evaluatedAtMs: atMs,
      intendedQuoteNotional: null,
      requiredEvidenceKinds,
    }, this.#config.thesis);
    if (!thesis.ok) return { ok: false, failure: thesis.failure };
    const forensics = analyzeFalsePositiveForensics({
      symbol,
      instrumentId: candidate.instrumentId,
      evaluatedAtMs: atMs,
      candidateObservedAtMs: candidate.openedAtMs,
      intendedQuoteNotional: null,
      configurationVersion: this.#config.configurationVersion,
      featureVersion: this.#config.featureBank.featureVersion,
      evidence,
      features,
      history: [],
    }, this.#config.forensics);
    if (!forensics.ok) return { ok: false, failure: forensics.failure };
    const rootCandidates = [...this.#correlations.rootsForMany([
      candidate.id,
      ...evidence.map((record) => record.id),
      ...features.map((feature) => feature.id),
    ])];
    for (const record of indexed) {
      rootCandidates.push(...record.correlationIds);
      if (rootCandidates.length > this.#config.maximumCorrelationRootsPerEntry * 2) {
        rootCandidates.splice(0, rootCandidates.length, ...boundedSortedUnique(
          rootCandidates,
          this.#config.maximumCorrelationRootsPerEntry,
        ));
      }
    }
    const roots = boundedSortedUnique(rootCandidates, this.#config.maximumCorrelationRootsPerEntry);
    this.#correlations.link(thesis.value.id, 'THESIS', roots, atMs);
    this.#correlations.link(forensics.value.id, 'FORENSICS', roots, atMs);
    const artifact = deepFreeze({
      id: stableId('intelligence-runtime-artifact', {
        candidateId: candidate.id,
        evaluatedAtMs: atMs,
        featureIds: features.map((feature) => feature.id),
        evidenceIds: evidence.map((record) => record.id),
        thesisId: thesis.value.id,
        forensicsId: forensics.value.id,
      }),
      candidateId: candidate.id,
      instrumentId: candidate.instrumentId,
      symbol,
      evaluatedAtMs: atMs,
      featureSnapshot: boundedSnapshot,
      evidenceIds: evidence.map((record) => record.id),
      thesis: structuredClone(thesis.value),
      forensics: structuredClone(forensics.value),
      correlationIds: [...roots],
      authority: 'EVIDENCE_ONLY' as const,
    });
    this.#correlations.link(artifact.id, 'THESIS', roots, atMs);
    return { ok: true, value: artifact };
  }

  #boundedFailures(failures: readonly StableFailure[]): readonly StableFailure[] {
    const unique = new Map<string, StableFailure>();
    for (const failure of failures) {
      const normalized = normalizeFailure(failure, this.#config)
        ?? makeStableFailure('INVALID_VALUE', COMPONENT, 'invalid failure record was rejected before output', 'failure');
      unique.set(normalized.id, normalized);
    }
    const ordered = [...unique.values()].sort(failureOrder);
    if (ordered.length <= this.#config.maximumFailureRecords) return Object.freeze(ordered.map((failure) => structuredClone(failure)));
    const marker = makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'failure output truncated at configured capacity', 'maximumFailureRecords');
    const retained = this.#config.maximumFailureRecords === 1
      ? [marker]
      : [...ordered.slice(0, this.#config.maximumFailureRecords - 1), marker].sort(failureOrder);
    return Object.freeze(retained.map((failure) => structuredClone(failure)));
  }

  #recordFailures(failures: readonly StableFailure[], atMs: number): void {
    for (const candidate of failures) {
      const failure = normalizeFailure(candidate, this.#config)
        ?? makeStableFailure('INVALID_VALUE', COMPONENT, 'invalid failure record was rejected before retention', 'failure');
      const previous = this.#failureRecords.get(failure.id);
      this.#failureRecords.set(failure.id, {
        failure: deepFreeze(structuredClone(failure)),
        count: (previous?.count ?? 0) + 1,
        firstObservedAtMs: previous?.firstObservedAtMs ?? atMs,
        lastObservedAtMs: atMs,
      });
    }
    const overflow = this.#failureRecords.size - this.#config.maximumFailureRecords;
    if (overflow <= 0) return;
    const oldest = [...this.#failureRecords.values()]
      .sort((left, right) => (
        left.lastObservedAtMs - right.lastObservedAtMs
        || left.firstObservedAtMs - right.firstObservedAtMs
        || codePointCompare(left.failure.id, right.failure.id)
      ))
      .slice(0, overflow);
    for (const record of oldest) this.#failureRecords.delete(record.failure.id);
  }

  #finishEvaluation(
    atMs: number,
    failures: readonly StableFailure[],
    freezeRequests: readonly BridgeFreezeRequest[],
  ): BridgeEvaluationResult {
    this.#recordFailures(failures, atMs);
    return deepFreeze({
      atMs,
      attentionPlan: this.#attentionPlan === null ? null : structuredClone(this.#attentionPlan),
      publicAttention: this.#publicAttention === null ? null : structuredClone(this.#publicAttention),
      artifacts: this.#currentArtifacts(),
      freezeRequests: [...freezeRequests].sort((left, right) => codePointCompare(left.id, right.id)),
      failures: this.#boundedFailures(failures),
    });
  }

  #currentArtifacts(): BridgeIntelligenceArtifact[] {
    return [...this.#artifacts.values()]
      .sort((left, right) => codePointCompare(left.instrumentId, right.instrumentId))
      .map((artifact) => structuredClone(artifact));
  }
}

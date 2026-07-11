import {
  canonicalJson,
  sortedUnique,
  type NormalizedEvidence,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  BridgeEvidenceScope,
  CorrelationIndexSnapshot,
  CorrelationStage,
  EvidenceIndexStats,
  IndexedEvidenceRecord,
} from './types.js';
import { boundedJsonByteLength } from '../contracts/index.js';

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function safeTime(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return value;
}

export function boundedSortedUnique(values: Iterable<string>, maximum: number): string[] {
  positiveInteger(maximum, 'bounded unique capacity');
  const retained: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
      throw new TypeError('bounded unique values must be non-empty strings no longer than 256 characters');
    }
    let low = 0;
    let high = retained.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const order = codePointCompare(retained[middle] as string, value);
      if (order < 0) low = middle + 1;
      else high = middle;
    }
    if (retained[low] === value) continue;
    retained.splice(low, 0, value);
    if (retained.length > maximum) retained.pop();
  }
  return retained;
}

function* concatenateStrings(...groups: readonly Iterable<string>[]): Iterable<string> {
  for (const group of groups) for (const value of group) yield value;
}

export function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function evidenceTime(evidence: NormalizedEvidence): number {
  return evidence.truth.temporal.sourceTransactionTimeMs
    ?? evidence.truth.temporal.sourceEventTimeMs
    ?? evidence.truth.temporal.receivedTimeMs;
}

interface CorrelationEntry {
  id: string;
  stage: CorrelationStage;
  roots: string[];
  observedAtMs: number;
  rootsTruncated: number;
}

/** Runtime-only sidecar. Frozen intelligence contracts remain untouched. */
export class BoundedCorrelationIndex {
  readonly #capacity: number;
  readonly #maximumRoots: number;
  readonly #entries = new Map<string, CorrelationEntry>();
  #evicted = 0;
  #truncatedRoots = 0;

  constructor(capacity: number, maximumRoots: number) {
    this.#capacity = positiveInteger(capacity, 'correlation capacity');
    this.#maximumRoots = positiveInteger(maximumRoots, 'maximum correlation roots');
  }

  link(id: string, stage: CorrelationStage, roots: readonly string[], observedAtMs: number): readonly string[] {
    if (typeof id !== 'string' || id.trim().length === 0 || id.length > 256) {
      throw new TypeError('correlation link id must be a bounded non-empty string');
    }
    safeTime(observedAtMs, 'correlation observedAtMs');
    const validRoots = function* (): Iterable<string> {
      for (const root of roots) {
        if (typeof root === 'string' && root.trim().length > 0 && root.length <= 256) yield root;
      }
    };
    const previous = this.#entries.get(id);
    const retained = boundedSortedUnique(
      concatenateStrings(previous?.roots ?? [], validRoots()),
      this.#maximumRoots,
    );
    let newlyTruncated = 0;
    for (const root of validRoots()) if (!retained.includes(root)) newlyTruncated += 1;
    if (newlyTruncated > 0) this.#truncatedRoots += newlyTruncated;
    const entry: CorrelationEntry = {
      id,
      stage,
      roots: retained,
      observedAtMs,
      rootsTruncated: (previous?.rootsTruncated ?? 0) + newlyTruncated,
    };
    this.#entries.set(id, entry);
    if (previous === undefined) this.#enforceCapacity();
    return Object.freeze([...retained]);
  }

  rootsFor(id: string): readonly string[] {
    return Object.freeze([...(this.#entries.get(id)?.roots ?? [])]);
  }

  rootsForMany(ids: readonly string[]): readonly string[] {
    const retained: string[] = [];
    for (const id of ids) {
      for (const root of this.#entries.get(id)?.roots ?? []) retained.push(root);
      if (retained.length > this.#maximumRoots * 2) {
        retained.splice(0, retained.length, ...boundedSortedUnique(retained, this.#maximumRoots));
      }
    }
    return Object.freeze(boundedSortedUnique(retained, this.#maximumRoots));
  }

  snapshot(): CorrelationIndexSnapshot {
    const links = [...this.#entries.values()]
      .sort((left, right) => codePointCompare(left.id, right.id))
      .map((entry) => deepFreeze({
        id: entry.id,
        stage: entry.stage,
        correlationIds: [...entry.roots],
        observedAtMs: entry.observedAtMs,
        rootsTruncated: entry.rootsTruncated,
      }));
    return deepFreeze({
      size: this.#entries.size,
      capacity: this.#capacity,
      evicted: this.#evicted,
      truncatedRoots: this.#truncatedRoots,
      links,
    });
  }

  #enforceCapacity(): void {
    while (this.#entries.size > this.#capacity) {
      const oldest = [...this.#entries.values()].sort((left, right) => (
        left.observedAtMs - right.observedAtMs || codePointCompare(left.id, right.id)
      ))[0];
      if (!oldest) break;
      this.#entries.delete(oldest.id);
      this.#evicted += 1;
    }
  }
}

interface InternalEvidenceRecord {
  evidence: NormalizedEvidence;
  scope: BridgeEvidenceScope;
  correlationIds: string[];
  fingerprint: string;
}

export interface EvidenceAddResult {
  duplicate: boolean;
  conflict: boolean;
  evictedIds: readonly string[];
}

/** Bounded recent evidence retained only for thesis/forensics composition. */
export class BoundedEvidenceIndex {
  readonly #capacity: number;
  readonly #maximumPerSymbol: number;
  readonly #maximumPerSymbolKind: number;
  readonly #maximumTruncatedSymbols: number;
  readonly #maximumCorrelationRoots: number;
  readonly #maximumEvidenceBytes: number;
  readonly #records = new Map<string, InternalEvidenceRecord>();
  readonly #bySymbol = new Map<string, string[]>();
  readonly #bySymbolKind = new Map<string, string[]>();
  readonly #globalOrder: string[] = [];
  readonly #truncatedThroughEventTimeMs = new Map<string, number>();
  #truncatedSymbolOverflowCount = 0;
  #duplicateCount = 0;
  #evictedCount = 0;

  constructor(input: {
    capacity: number;
    maximumPerSymbol: number;
    maximumPerSymbolKind: number;
    maximumTruncatedSymbols: number;
    maximumCorrelationRoots: number;
    maximumEvidenceBytes?: number;
  }) {
    this.#capacity = positiveInteger(input.capacity, 'evidence capacity');
    this.#maximumPerSymbol = positiveInteger(input.maximumPerSymbol, 'maximum evidence per symbol');
    this.#maximumPerSymbolKind = positiveInteger(input.maximumPerSymbolKind, 'maximum evidence per symbol kind');
    this.#maximumTruncatedSymbols = positiveInteger(input.maximumTruncatedSymbols, 'maximum truncated symbols');
    this.#maximumCorrelationRoots = positiveInteger(input.maximumCorrelationRoots, 'maximum evidence correlation roots');
    this.#maximumEvidenceBytes = positiveInteger(input.maximumEvidenceBytes ?? 2 * 1024 * 1024, 'maximum evidence bytes');
    if (this.#maximumEvidenceBytes > 32 * 1024 * 1024) throw new RangeError('maximum evidence bytes exceeds hard bound');
    if (this.#maximumPerSymbolKind > this.#maximumPerSymbol || this.#maximumPerSymbol > this.#capacity) {
      throw new RangeError('evidence bounds must satisfy per-kind <= per-symbol <= total');
    }
  }

  has(id: string): boolean {
    return this.#records.has(id);
  }

  add(
    evidence: NormalizedEvidence,
    scope: BridgeEvidenceScope,
    correlationIds: readonly string[],
  ): EvidenceAddResult {
    if (scope !== 'BROAD' && scope !== 'FOCUSED') throw new TypeError('evidence scope is invalid');
    boundedJsonByteLength(evidence, this.#maximumEvidenceBytes);
    const fingerprint = canonicalJson(evidence);
    const existing = this.#records.get(evidence.id);
    if (existing) {
      this.#duplicateCount += 1;
      const conflict = existing.fingerprint !== fingerprint;
      if (!conflict) {
        existing.correlationIds = boundedSortedUnique(
          concatenateStrings(existing.correlationIds, correlationIds),
          this.#maximumCorrelationRoots,
        );
      }
      return deepFreeze({
        duplicate: true,
        conflict,
        evictedIds: [],
      });
    }
    const record: InternalEvidenceRecord = {
      evidence: deepFreeze(structuredClone(evidence)),
      scope,
      correlationIds: boundedSortedUnique(correlationIds, this.#maximumCorrelationRoots),
      fingerprint,
    };
    this.#records.set(evidence.id, record);
    this.#insertOrdered(this.#globalOrder, evidence.id);
    const symbolList = this.#bySymbol.get(evidence.instrument.symbol) ?? [];
    this.#insertOrdered(symbolList, evidence.id);
    this.#bySymbol.set(evidence.instrument.symbol, symbolList);
    const kindKey = this.#kindKey(evidence);
    const kindList = this.#bySymbolKind.get(kindKey) ?? [];
    this.#insertOrdered(kindList, evidence.id);
    this.#bySymbolKind.set(kindKey, kindList);

    const evictedIds: string[] = [];
    while (kindList.length > this.#maximumPerSymbolKind) {
      const oldest = kindList[0];
      if (oldest === undefined) break;
      this.#markTruncated(evidence.instrument.symbol, evidenceTime(this.#records.get(oldest)?.evidence ?? evidence));
      this.#remove(oldest);
      evictedIds.push(oldest);
    }
    while ((this.#bySymbol.get(evidence.instrument.symbol)?.length ?? 0) > this.#maximumPerSymbol) {
      const oldest = this.#bySymbol.get(evidence.instrument.symbol)?.[0];
      if (oldest === undefined) break;
      this.#markTruncated(evidence.instrument.symbol, evidenceTime(this.#records.get(oldest)?.evidence ?? evidence));
      this.#remove(oldest);
      evictedIds.push(oldest);
    }
    while (this.#records.size > this.#capacity) {
      const oldest = this.#globalOrder[0];
      if (oldest === undefined) break;
      const evictedSymbol = this.#records.get(oldest)?.evidence.instrument.symbol;
      const evictedEvidence = this.#records.get(oldest)?.evidence;
      if (evictedSymbol && evictedEvidence) this.#markTruncated(evictedSymbol, evidenceTime(evictedEvidence));
      this.#remove(oldest);
      evictedIds.push(oldest);
    }
    this.#evictedCount += evictedIds.length;
    return deepFreeze({ duplicate: false, conflict: false, evictedIds: sortedUnique(evictedIds) });
  }

  recordsForSymbol(symbol: string, evaluatedAtMs: number, maximum: number): readonly IndexedEvidenceRecord[] {
    safeTime(evaluatedAtMs, 'evidence cutoff');
    positiveInteger(maximum, 'maximum evidence output');
    const ids = this.#bySymbol.get(symbol) ?? [];
    const records = ids
      .map((id) => this.#records.get(id))
      .filter((record): record is InternalEvidenceRecord => record !== undefined)
      .filter((record) => evidenceTime(record.evidence) <= evaluatedAtMs)
      .slice(-maximum)
      .map((record) => deepFreeze({
        evidence: structuredClone(record.evidence),
        scope: record.scope,
        correlationIds: [...record.correlationIds],
      }));
    return Object.freeze(records);
  }

  isTruncated(symbol: string, evaluatedAtMs: number, currentWindowMs: number): boolean {
    safeTime(evaluatedAtMs, 'truncation evaluation time');
    positiveInteger(currentWindowMs, 'truncation completeness window');
    const droppedThrough = this.#truncatedThroughEventTimeMs.get(symbol);
    return droppedThrough !== undefined && droppedThrough >= Math.max(0, evaluatedAtMs - currentWindowMs);
  }

  stats(evaluatedAtMs: number, currentWindowMs: number): EvidenceIndexStats {
    safeTime(evaluatedAtMs, 'evidence stats time');
    positiveInteger(currentWindowMs, 'evidence stats completeness window');
    const truncatedSymbols = [...this.#truncatedThroughEventTimeMs.entries()]
      .filter(([, droppedThrough]) => droppedThrough >= Math.max(0, evaluatedAtMs - currentWindowMs))
      .map(([symbol]) => symbol)
      .sort(codePointCompare);
    return deepFreeze({
      size: this.#records.size,
      capacity: this.#capacity,
      maximumPerSymbol: this.#maximumPerSymbol,
      maximumPerSymbolKind: this.#maximumPerSymbolKind,
      duplicateCount: this.#duplicateCount,
      evictedCount: this.#evictedCount,
      historicallyTruncatedSymbolCount: this.#truncatedThroughEventTimeMs.size,
      currentTruncationWindowMs: currentWindowMs,
      truncatedSymbolOverflowCount: this.#truncatedSymbolOverflowCount,
      truncatedSymbols,
    });
  }

  #kindKey(evidence: NormalizedEvidence): string {
    return `${evidence.instrument.symbol}\u0000${evidence.kind}`;
  }

  #compareIds(leftId: string, rightId: string): number {
    const left = this.#records.get(leftId)?.evidence;
    const right = this.#records.get(rightId)?.evidence;
    if (!left || !right) return codePointCompare(leftId, rightId);
    return evidenceTime(left) - evidenceTime(right) || codePointCompare(leftId, rightId);
  }

  #insertOrdered(list: string[], id: string): void {
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.#compareIds(list[middle] as string, id) <= 0) low = middle + 1;
      else high = middle;
    }
    list.splice(low, 0, id);
  }

  #remove(id: string): void {
    const record = this.#records.get(id);
    if (!record) return;
    this.#records.delete(id);
    this.#removeFrom(this.#globalOrder, id);
    const symbol = record.evidence.instrument.symbol;
    const symbolList = this.#bySymbol.get(symbol);
    if (symbolList) {
      this.#removeFrom(symbolList, id);
      if (symbolList.length === 0) this.#bySymbol.delete(symbol);
    }
    const kindKey = this.#kindKey(record.evidence);
    const kindList = this.#bySymbolKind.get(kindKey);
    if (kindList) {
      this.#removeFrom(kindList, id);
      if (kindList.length === 0) this.#bySymbolKind.delete(kindKey);
    }
  }

  #removeFrom(list: string[], id: string): void {
    const index = list.indexOf(id);
    if (index >= 0) list.splice(index, 1);
  }

  #markTruncated(symbol: string, droppedEventTimeMs: number): void {
    safeTime(droppedEventTimeMs, 'dropped evidence event time');
    const previous = this.#truncatedThroughEventTimeMs.get(symbol);
    if (previous !== undefined) {
      this.#truncatedThroughEventTimeMs.set(symbol, Math.max(previous, droppedEventTimeMs));
      return;
    }
    if (this.#truncatedThroughEventTimeMs.size >= this.#maximumTruncatedSymbols) {
      this.#truncatedSymbolOverflowCount += 1;
      return;
    }
    this.#truncatedThroughEventTimeMs.set(symbol, droppedEventTimeMs);
  }
}

export interface ProcessingLagStats {
  sampleCount: number;
  retainedSamples: number;
  lastLagMs: number | null;
  maximumLagMs: number | null;
  p50LagMs: number | null;
  p95LagMs: number | null;
  p99LagMs: number | null;
}

export interface ProcessingLagSnapshot {
  sources: Readonly<Record<string, ProcessingLagStats>>;
  global: ProcessingLagStats;
  maximumSources: number;
  samplesPerSource: number;
  rejectedSourceCount: number;
}

interface SampleRing {
  total: number;
  values: number[];
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function safeTime(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function percentile(sorted: readonly number[], quantile: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index];
}

function stats(ring: SampleRing): Readonly<ProcessingLagStats> {
  const sorted = [...ring.values].sort((left, right) => left - right);
  return Object.freeze({
    sampleCount: ring.total,
    retainedSamples: ring.values.length,
    lastLagMs: ring.values.at(-1) ?? null,
    maximumLagMs: sorted.at(-1) ?? null,
    p50LagMs: percentile(sorted, 0.50),
    p95LagMs: percentile(sorted, 0.95),
    p99LagMs: percentile(sorted, 0.99),
  });
}

/** Shared bounded registry so several source runners can expose global lag. */
export class BoundedProcessingLagMetrics {
  readonly #maximumSources: number;
  readonly #samplesPerSource: number;
  readonly #sources = new Map<string, SampleRing>();
  readonly #global: SampleRing = { total: 0, values: [] };
  #rejectedSourceCount = 0;

  constructor(maximumSources: number, samplesPerSource: number) {
    this.#maximumSources = positiveInteger(maximumSources, 'maximumSources');
    this.#samplesPerSource = positiveInteger(samplesPerSource, 'samplesPerSource');
    if (maximumSources > 100_000 || samplesPerSource > 100_000) throw new RangeError('processing-lag bounds are too large');
  }

  record(sourceId: string, receiveTimeMs: number, processedTimeMs: number): boolean {
    if (typeof sourceId !== 'string' || sourceId.length === 0 || sourceId.length > 256) {
      throw new TypeError('processing-lag sourceId is invalid');
    }
    safeTime(receiveTimeMs, 'receiveTimeMs');
    safeTime(processedTimeMs, 'processedTimeMs');
    if (processedTimeMs < receiveTimeMs) throw new RangeError('processedTimeMs precedes receiveTimeMs');
    let ring = this.#sources.get(sourceId);
    if (!ring) {
      if (this.#sources.size >= this.#maximumSources) {
        this.#rejectedSourceCount += 1;
        return false;
      }
      ring = { total: 0, values: [] };
      this.#sources.set(sourceId, ring);
    }
    const lag = processedTimeMs - receiveTimeMs;
    this.#push(ring, lag);
    this.#push(this.#global, lag);
    return true;
  }

  snapshot(): Readonly<ProcessingLagSnapshot> {
    const sources: Record<string, ProcessingLagStats> = {};
    for (const sourceId of [...this.#sources.keys()].sort()) {
      sources[sourceId] = stats(this.#sources.get(sourceId) as SampleRing);
    }
    return Object.freeze({
      sources: Object.freeze(sources),
      global: stats(this.#global),
      maximumSources: this.#maximumSources,
      samplesPerSource: this.#samplesPerSource,
      rejectedSourceCount: this.#rejectedSourceCount,
    });
  }

  #push(ring: SampleRing, lag: number): void {
    ring.total += 1;
    ring.values.push(lag);
    if (ring.values.length > this.#samplesPerSource) {
      ring.values.splice(0, ring.values.length - this.#samplesPerSource);
    }
  }
}

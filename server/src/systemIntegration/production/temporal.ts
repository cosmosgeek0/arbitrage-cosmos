import {
  createSourcedTimestamp,
  evaluateFreshness,
  isValidUtcMillis,
  type FreshnessReport,
  type SourcedTimestamp,
} from '../../foundation/contracts/index.js';

export const DEFAULT_PUBLIC_SOURCE_MAX_AGE_MS = 10_000;
export const MAX_PUBLIC_SOURCE_MAX_AGE_MS = 5 * 60_000;

export function publicSourceMaxAgeMs(value: number | undefined): number {
  const resolved = value ?? DEFAULT_PUBLIC_SOURCE_MAX_AGE_MS;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > MAX_PUBLIC_SOURCE_MAX_AGE_MS) {
    throw new RangeError(
      `sourceMaxAgeMs must be a positive safe integer no greater than ${MAX_PUBLIC_SOURCE_MAX_AGE_MS}`,
    );
  }
  return resolved;
}

export function validUtcOrNull(value: unknown): number | null {
  return isValidUtcMillis(value) ? value as number : null;
}

/**
 * Records when this directional adapter first observed a new owner event.
 * Re-reading an unchanged cache value never refreshes receipt time, and a new
 * lifecycle generation must observe a value different from its baseline.
 */
export class SourceObservationTracker {
  private active = false;
  private baselineSourceTimeMs: number | null = null;
  private acceptedSourceTimeMs: number | null = null;
  private acceptedReceiveTimeMs: number | null = null;

  beginGeneration(baselineSourceTimeMs: number | null): void {
    this.active = true;
    this.baselineSourceTimeMs = validUtcOrNull(baselineSourceTimeMs);
    this.acceptedSourceTimeMs = null;
    this.acceptedReceiveTimeMs = null;
  }

  stop(): void {
    this.active = false;
    this.baselineSourceTimeMs = null;
    this.acceptedSourceTimeMs = null;
    this.acceptedReceiveTimeMs = null;
  }

  read(
    sourceTimeMs: number | null,
    observedAtMs: number,
    sourceId: string,
    maxAgeMs: number,
  ): Readonly<SourcedTimestamp> | null {
    const sourceTime = validUtcOrNull(sourceTimeMs);
    if (!this.active || sourceTime === null || !isValidUtcMillis(observedAtMs)) return null;
    // A concurrent reader may have already accepted this owner event at a
    // later receipt time. Never return that future receipt to an older
    // supervisor step; the next monotonic observation can retry safely.
    if (this.acceptedReceiveTimeMs !== null && observedAtMs < this.acceptedReceiveTimeMs) return null;
    if (this.acceptedSourceTimeMs === null && sourceTime === this.baselineSourceTimeMs) return null;
    if (this.acceptedSourceTimeMs !== null && sourceTime < this.acceptedSourceTimeMs) return null;
    if (sourceTime !== this.acceptedSourceTimeMs) {
      this.acceptedSourceTimeMs = sourceTime;
      this.acceptedReceiveTimeMs = observedAtMs;
    }
    if (this.acceptedReceiveTimeMs === null) return null;
    return createSourcedTimestamp({
      sourceTimeMs: sourceTime,
      receivedAtMs: this.acceptedReceiveTimeMs,
      maxAgeMs,
      authority: 'LIVE_PUBLIC',
      completeness: 'COMPLETE',
      sourceId,
    });
  }
}

/** Same generation law for owner timestamps that are already receipt times. */
export class ReceiptObservationTracker {
  private active = false;
  private baselineReceiveTimeMs: number | null = null;
  private acceptedReceiveTimeMs: number | null = null;

  beginGeneration(baselineReceiveTimeMs: number | null): void {
    this.active = true;
    this.baselineReceiveTimeMs = validUtcOrNull(baselineReceiveTimeMs);
    this.acceptedReceiveTimeMs = null;
  }

  stop(): void {
    this.active = false;
    this.baselineReceiveTimeMs = null;
    this.acceptedReceiveTimeMs = null;
  }

  read(
    receiveTimeMs: number | null,
    sourceId: string,
    maxAgeMs: number,
  ): Readonly<SourcedTimestamp> | null {
    const receiveTime = validUtcOrNull(receiveTimeMs);
    if (!this.active || receiveTime === null) return null;
    if (this.acceptedReceiveTimeMs === null && receiveTime === this.baselineReceiveTimeMs) return null;
    if (this.acceptedReceiveTimeMs !== null && receiveTime < this.acceptedReceiveTimeMs) return null;
    this.acceptedReceiveTimeMs = receiveTime;
    return receiptTimestamp(receiveTime, sourceId, maxAgeMs);
  }
}

export function receiptTimestamp(
  receivedAtMs: number | null,
  sourceId: string,
  maxAgeMs: number,
): Readonly<SourcedTimestamp> | null {
  const receivedAt = validUtcOrNull(receivedAtMs);
  if (receivedAt === null) return null;
  return createSourcedTimestamp({
    sourceTimeMs: null,
    receivedAtMs: receivedAt,
    maxAgeMs,
    authority: 'LIVE_PUBLIC',
    completeness: 'COMPLETE',
    sourceId,
  });
}

const FRESHNESS_SEVERITY: Readonly<Record<FreshnessReport['state'], number>> = Object.freeze({
  FRESH: 0,
  STALE: 1,
  UNAVAILABLE: 2,
  CLOCK_SKEWED: 3,
});

/** Selects the weakest required temporal fact without manufacturing a merge timestamp. */
export function weakestTemporalFact(
  timestamps: readonly (Readonly<SourcedTimestamp> | null)[],
  nowMs: number,
): Readonly<SourcedTimestamp> | null {
  if (timestamps.length === 0 || timestamps.some((timestamp) => timestamp === null)) return null;
  let selected = timestamps[0] as Readonly<SourcedTimestamp>;
  let selectedFreshness = evaluateFreshness(selected, nowMs);
  for (const candidate of timestamps.slice(1) as readonly Readonly<SourcedTimestamp>[]) {
    const freshness = evaluateFreshness(candidate, nowMs);
    const severityDelta = FRESHNESS_SEVERITY[freshness.state] - FRESHNESS_SEVERITY[selectedFreshness.state];
    const selectCandidate = severityDelta > 0 || (
      severityDelta === 0
      && (freshness.ageMs ?? Number.POSITIVE_INFINITY) > (selectedFreshness.ageMs ?? Number.POSITIVE_INFINITY)
    );
    if (selectCandidate) {
      selected = candidate;
      selectedFreshness = freshness;
    }
  }
  return selected;
}

import {
  compareExactDecimals,
  normalizeExactDecimal,
  type ExactDecimal,
} from '../../capitalFoundation/contracts/decimal.js';
import {
  decodePublicBasisOpportunityObservation,
  type PublicBasisOpportunityObservation,
} from './publicOpportunityObservation.js';
import {
  PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_EVENT_KIND,
} from './publicOpportunityObservationStore.js';

export const ROLLING_24H_MS = 86_400_000;
export const BASIS_EDGE_PAGE_SIZE = 2_000;
export const BASIS_EDGE_MAX_WINDOW_ROWS = 100_000;
export const PUBLIC_OBSERVED_PROXY_NOT_EXECUTED = 'PUBLIC_OBSERVED_PROXY_NOT_EXECUTED';

export type Rolling24hEdgeStatisticState = 'EMPTY' | 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';

export const ROLLING_24H_EDGE_REASON_CODES = Object.freeze([
  'NO_OBSERVATIONS_IN_WINDOW',
  'PUBLIC_PROXY_NET_EDGE_COMPLETE',
  'PUBLIC_PROXY_NET_EDGE_PARTIAL',
  'PUBLIC_PROXY_NET_EDGE_UNKNOWN',
  'PUBLIC_PROXY_NET_EDGE_ASSUMPTION_BOUND',
  'ACCOUNT_EFFECTIVE_NET_EDGE_UNKNOWN',
  'DUPLICATE_RETRIES_COLLAPSED',
  'OUT_OF_WINDOW_OBSERVATIONS_EXCLUDED',
  'FUTURE_OBSERVATIONS_PRESENT',
  'OBSERVATION_ID_CONFLICT',
  'OBSERVATION_PAYLOAD_MALFORMED',
  'LEDGER_READ_FAILED',
  'LEDGER_ANCHOR_MALFORMED',
  'LEDGER_PAGE_MALFORMED',
  'LEDGER_PAGE_ORDER_INVALID',
  'LEDGER_PAGE_EXHAUSTED_BEFORE_HIGH_WATER',
  'LEDGER_SCAN_ROW_CAP_EXCEEDED',
] as const);

export type Rolling24hEdgeReasonCode = (typeof ROLLING_24H_EDGE_REASON_CODES)[number];

/**
 * Exact numeric text. Values within the canonical decimal bound are emitted
 * as decimals; other reduced means are emitted as `numerator/denominator`.
 */
export type ExactEdgeStatistic = string;

export interface Rolling24hEdgeLedgerEvent {
  readonly id: number;
  readonly ts: number;
  readonly kind: string;
  readonly symbol: string | null;
  readonly data: unknown;
}

/** Read-only structural seam over the existing canonical Ledger. */
export interface Rolling24hEdgeLedgerPort {
  /**
   * Existing Ledger contract: no `afterId` returns ID-descending rows; an
   * `afterId` cursor returns ID-ascending rows. `since` is inclusive commit
   * time, `until` is exclusive commit time, and `beforeId` is exclusive.
   */
  recentEvents(
    limit?: number,
    kind?: string,
    symbol?: string,
    q?: string,
    since?: number,
    beforeId?: number,
    until?: number,
    offset?: number,
    afterId?: number,
  ): readonly Readonly<Rolling24hEdgeLedgerEvent>[];
}

export interface Rolling24hEdgeStatisticOptions {
  readonly asOfMs: number;
  readonly maxRows?: number;
}

export interface Rolling24hPublicProxyCoverage {
  readonly knownObservationCount: number;
  readonly unknownObservationCount: number;
  readonly positiveObservationCount: number;
  readonly knownObservationRatio: ExactEdgeStatistic | null;
  readonly observationReasonCodes: readonly string[];
}

export interface Rolling24hKnownOnlyEdgeStatistics {
  readonly meanNetEdgePct: ExactEdgeStatistic | null;
  readonly bestNetEdgePct: ExactEdgeStatistic | null;
  readonly worstNetEdgePct: ExactEdgeStatistic | null;
  readonly meanNetEdgeUsdPerOneThousandNotional: ExactEdgeStatistic | null;
}

export interface Rolling24hAccountEffectiveNetEdge {
  readonly state: 'UNKNOWN';
  readonly meanNetEdgePct: null;
  readonly bestNetEdgePct: null;
  readonly worstNetEdgePct: null;
  readonly meanNetEdgeUsdPerOneThousandNotional: null;
  readonly reasonCode: 'ACCOUNT_EFFECTIVE_NET_EDGE_UNKNOWN';
}

export interface Rolling24hEdgeStatistic {
  readonly label: typeof PUBLIC_OBSERVED_PROXY_NOT_EXECUTED;
  readonly state: Rolling24hEdgeStatisticState;
  readonly boundary: 'CLOSED_CLOSED';
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly highWaterLedgerEventId: number | null;
  readonly highWaterReached: boolean;
  readonly scanComplete: boolean;
  readonly truncated: boolean;
  readonly maxRows: number;
  readonly rawRowCount: number;
  readonly uniqueObservationCount: number;
  readonly duplicateRetryCount: number;
  readonly conflictCount: number;
  readonly malformedCount: number;
  readonly outOfWindowCount: number;
  readonly futureCount: number;
  readonly distinctOpportunityIdCount: number;
  readonly newOpportunityIdCount: number;
  readonly assumptionBoundPublicProxy: Readonly<Rolling24hPublicProxyCoverage>;
  readonly knownOnly: Readonly<Rolling24hKnownOnlyEdgeStatistics>;
  readonly accountEffectiveNetEdge: Readonly<Rolling24hAccountEffectiveNetEdge>;
  readonly reasonCodes: readonly Rolling24hEdgeReasonCode[];
}

interface ObservationIdentity {
  readonly digests: Set<string>;
  readonly proxyEdge: ExactDecimal | null;
}

interface Accumulator {
  highWaterLedgerEventId: number | null;
  highWaterReached: boolean;
  scanComplete: boolean;
  truncated: boolean;
  rawRowCount: number;
  duplicateRetryCount: number;
  conflictCount: number;
  malformedCount: number;
  outOfWindowCount: number;
  futureCount: number;
  integrityUnknown: boolean;
  readonly observations: Map<string, ObservationIdentity>;
  readonly opportunityIds: Set<string>;
  readonly newOpportunityIds: Set<string>;
  readonly reasons: Set<Rolling24hEdgeReasonCode>;
  readonly observationReasons: Set<string>;
}

const ZERO_EXACT_DECIMAL = normalizeExactDecimal('0');

function assertOptions(options: Rolling24hEdgeStatisticOptions): number {
  if (!options
      || !Number.isSafeInteger(options.asOfMs)
      || options.asOfMs < ROLLING_24H_MS
      || options.asOfMs >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('rolling 24h edge statistic requires a safe asOfMs with a full non-negative window');
  }
  const maxRows = options.maxRows ?? BASIS_EDGE_MAX_WINDOW_ROWS;
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > BASIS_EDGE_MAX_WINDOW_ROWS) {
    throw new RangeError(`rolling 24h edge statistic maxRows must be between 1 and ${BASIS_EDGE_MAX_WINDOW_ROWS}`);
  }
  return maxRows;
}

function initialAccumulator(): Accumulator {
  return {
    highWaterLedgerEventId: null,
    highWaterReached: false,
    scanComplete: false,
    truncated: false,
    rawRowCount: 0,
    duplicateRetryCount: 0,
    conflictCount: 0,
    malformedCount: 0,
    outOfWindowCount: 0,
    futureCount: 0,
    integrityUnknown: false,
    observations: new Map(),
    opportunityIds: new Set(),
    newOpportunityIds: new Set(),
    reasons: new Set(),
    observationReasons: new Set(),
  };
}

function markUnknown(
  accumulator: Accumulator,
  reason: Rolling24hEdgeReasonCode,
): void {
  accumulator.integrityUnknown = true;
  accumulator.reasons.add(reason);
}

function canonicalExactDecimal(value: string): ExactDecimal | null {
  try {
    const normalized = normalizeExactDecimal(value);
    return normalized === value ? normalized : null;
  } catch {
    return null;
  }
}

function exactDecimalFraction(
  value: ExactDecimal,
): Readonly<{ numerator: bigint; denominator: bigint }> {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const magnitude = BigInt(`${whole}${fraction}`);
  return Object.freeze({
    numerator: negative ? -magnitude : magnitude,
    denominator: 10n ** BigInt(fraction.length),
  });
}

function exactDecimalSumFraction(
  values: readonly ExactDecimal[],
): Readonly<{ numerator: bigint; denominator: bigint }> {
  let numerator = 0n;
  let denominator = 1n;
  for (const value of values) {
    const next = exactDecimalFraction(value);
    if (next.denominator > denominator) {
      numerator *= next.denominator / denominator;
      denominator = next.denominator;
    }
    numerator += next.numerator * (denominator / next.denominator);
  }
  return Object.freeze({ numerator, denominator });
}

function decimalFromScaledInteger(coefficient: bigint, scale: number): ExactDecimal {
  if (coefficient === 0n) return ZERO_EXACT_DECIMAL;
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString();
  if (scale === 0) return normalizeExactDecimal(`${negative ? '-' : ''}${digits}`);
  const padded = digits.padStart(scale + 1, '0');
  const integer = padded.slice(0, -scale);
  const fraction = padded.slice(-scale);
  return normalizeExactDecimal(`${negative ? '-' : ''}${integer}.${fraction}`);
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function exactRational(numeratorInput: bigint, denominatorInput: bigint): ExactEdgeStatistic {
  if (denominatorInput <= 0n) throw new RangeError('exact statistic denominator must be positive');
  if (numeratorInput === 0n) return '0';
  const divisor = greatestCommonDivisor(numeratorInput, denominatorInput);
  const reducedNumerator = numeratorInput / divisor;
  const reducedDenominator = denominatorInput / divisor;
  let numerator = reducedNumerator;
  let denominator = reducedDenominator;
  let twos = 0;
  let fives = 0;
  while (denominator % 2n === 0n) {
    denominator /= 2n;
    twos += 1;
  }
  while (denominator % 5n === 0n) {
    denominator /= 5n;
    fives += 1;
  }
  if (denominator !== 1n) {
    return `${numerator.toString()}/${reducedDenominator.toString()}`;
  }
  const scale = Math.max(twos, fives);
  if (twos < scale) numerator *= 2n ** BigInt(scale - twos);
  if (fives < scale) numerator *= 5n ** BigInt(scale - fives);
  try {
    return decimalFromScaledInteger(numerator, scale);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return `${reducedNumerator.toString()}/${reducedDenominator.toString()}`;
  }
}

function knownOnlyStatistics(
  observations: Iterable<ObservationIdentity>,
  publish: boolean,
): Readonly<Rolling24hKnownOnlyEdgeStatistics> {
  if (!publish) {
    return Object.freeze({
      meanNetEdgePct: null,
      bestNetEdgePct: null,
      worstNetEdgePct: null,
      meanNetEdgeUsdPerOneThousandNotional: null,
    });
  }
  const known: ExactDecimal[] = [];
  for (const identity of observations) {
    if (identity.proxyEdge !== null) known.push(identity.proxyEdge);
  }
  if (known.length === 0) {
    return Object.freeze({
      meanNetEdgePct: null,
      bestNetEdgePct: null,
      worstNetEdgePct: null,
      meanNetEdgeUsdPerOneThousandNotional: null,
    });
  }
  let best = known[0];
  let worst = known[0];
  for (const value of known) {
    if (compareExactDecimals(value, best) > 0) best = value;
    if (compareExactDecimals(value, worst) < 0) worst = value;
  }
  // Aggregate as an unbounded rational so a valid mean cannot fail merely
  // because its intermediate sum exceeds the per-observation decimal bound.
  const sumFraction = exactDecimalSumFraction(known);
  return Object.freeze({
    meanNetEdgePct: exactRational(
      sumFraction.numerator,
      sumFraction.denominator * BigInt(known.length),
    ),
    bestNetEdgePct: best,
    worstNetEdgePct: worst,
    // One percent of $1,000 is $10.
    meanNetEdgeUsdPerOneThousandNotional: exactRational(
      sumFraction.numerator * 10n,
      sumFraction.denominator * BigInt(known.length),
    ),
  });
}

function proxyEdgeOf(
  observation: Readonly<PublicBasisOpportunityObservation>,
): ExactDecimal | null | undefined {
  const { configuredProxyNetEdgePct, configuredProxyNetState } = observation.economics;
  if (configuredProxyNetState === 'UNKNOWN') {
    return configuredProxyNetEdgePct === null ? null : undefined;
  }
  if (configuredProxyNetState !== 'ASSUMPTION_BOUND' || configuredProxyNetEdgePct === null) {
    return undefined;
  }
  return canonicalExactDecimal(configuredProxyNetEdgePct) ?? undefined;
}

function validLedgerIdentity(
  row: Readonly<Rolling24hEdgeLedgerEvent>,
  previousId: number,
  highWaterId: number,
): boolean {
  return Number.isSafeInteger(row.id)
    && row.id > previousId
    && row.id <= highWaterId;
}

function ingestRow(
  accumulator: Accumulator,
  row: Readonly<Rolling24hEdgeLedgerEvent>,
  windowStartMs: number,
  windowEndMs: number,
): void {
  if (row.kind !== PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_EVENT_KIND) {
    accumulator.malformedCount += 1;
    markUnknown(accumulator, 'OBSERVATION_PAYLOAD_MALFORMED');
    return;
  }
  if (!Number.isSafeInteger(row.ts)
      || row.ts < 0
      || row.ts > windowEndMs) {
    accumulator.malformedCount += 1;
    markUnknown(accumulator, 'OBSERVATION_PAYLOAD_MALFORMED');
    return;
  }

  let observation: Readonly<PublicBasisOpportunityObservation> | null;
  try {
    observation = decodePublicBasisOpportunityObservation(row.data);
  } catch {
    accumulator.malformedCount += 1;
    markUnknown(accumulator, 'OBSERVATION_PAYLOAD_MALFORMED');
    return;
  }
  if (observation === null) {
    accumulator.malformedCount += 1;
    markUnknown(accumulator, 'OBSERVATION_PAYLOAD_MALFORMED');
    return;
  }
  if (observation.evaluatedAtMs > row.ts) {
    accumulator.malformedCount += 1;
    markUnknown(accumulator, 'OBSERVATION_PAYLOAD_MALFORMED');
    return;
  }
  if (row.symbol !== observation.symbol) {
    accumulator.malformedCount += 1;
    markUnknown(accumulator, 'OBSERVATION_PAYLOAD_MALFORMED');
    return;
  }
  if (observation.observedAtMs > windowEndMs) {
    accumulator.futureCount += 1;
    markUnknown(accumulator, 'FUTURE_OBSERVATIONS_PRESENT');
    return;
  }
  if (observation.observedAtMs < windowStartMs) {
    accumulator.outOfWindowCount += 1;
    accumulator.reasons.add('OUT_OF_WINDOW_OBSERVATIONS_EXCLUDED');
    return;
  }

  const proxyEdge = proxyEdgeOf(observation);
  if (proxyEdge === undefined) {
    accumulator.malformedCount += 1;
    markUnknown(accumulator, 'OBSERVATION_PAYLOAD_MALFORMED');
    return;
  }
  const existing = accumulator.observations.get(observation.observationId);
  if (existing) {
    if (existing.digests.has(observation.contentDigestSha256)) {
      accumulator.duplicateRetryCount += 1;
      accumulator.reasons.add('DUPLICATE_RETRIES_COLLAPSED');
      return;
    }
    existing.digests.add(observation.contentDigestSha256);
    accumulator.conflictCount += 1;
    markUnknown(accumulator, 'OBSERVATION_ID_CONFLICT');
    return;
  }

  accumulator.observations.set(observation.observationId, {
    digests: new Set([observation.contentDigestSha256]),
    proxyEdge,
  });
  for (const reason of observation.reasonCodes) accumulator.observationReasons.add(reason);
  accumulator.opportunityIds.add(observation.opportunityId);
  if (
    observation.opportunityCreatedAtMs >= windowStartMs
    && observation.opportunityCreatedAtMs <= windowEndMs
  ) {
    accumulator.newOpportunityIds.add(observation.opportunityId);
  }
}

function orderedReasons(
  reasons: ReadonlySet<Rolling24hEdgeReasonCode>,
): readonly Rolling24hEdgeReasonCode[] {
  return Object.freeze(ROLLING_24H_EDGE_REASON_CODES.filter((reason) => reasons.has(reason)));
}

function projectionFrom(
  accumulator: Accumulator,
  windowStartMs: number,
  windowEndMs: number,
  maxRows: number,
): Readonly<Rolling24hEdgeStatistic> {
  const uniqueObservationCount = accumulator.observations.size;
  let knownObservationCount = 0;
  let positiveObservationCount = 0;
  for (const identity of accumulator.observations.values()) {
    if (identity.proxyEdge === null) continue;
    knownObservationCount += 1;
    if (compareExactDecimals(identity.proxyEdge, ZERO_EXACT_DECIMAL) > 0) {
      positiveObservationCount += 1;
    }
  }
  const unknownObservationCount = uniqueObservationCount - knownObservationCount;

  let state: Rolling24hEdgeStatisticState;
  if (accumulator.integrityUnknown) {
    state = 'UNKNOWN';
  } else if (uniqueObservationCount === 0) {
    state = 'EMPTY';
    accumulator.reasons.add('NO_OBSERVATIONS_IN_WINDOW');
  } else if (unknownObservationCount === 0) {
    state = 'COMPLETE';
    accumulator.reasons.add('PUBLIC_PROXY_NET_EDGE_COMPLETE');
    accumulator.reasons.add('PUBLIC_PROXY_NET_EDGE_ASSUMPTION_BOUND');
  } else if (knownObservationCount > 0) {
    state = 'PARTIAL';
    accumulator.reasons.add('PUBLIC_PROXY_NET_EDGE_PARTIAL');
    accumulator.reasons.add('PUBLIC_PROXY_NET_EDGE_ASSUMPTION_BOUND');
  } else {
    state = 'UNKNOWN';
    accumulator.reasons.add('PUBLIC_PROXY_NET_EDGE_UNKNOWN');
  }
  accumulator.reasons.add('ACCOUNT_EFFECTIVE_NET_EDGE_UNKNOWN');

  const publishKnownOnly = !accumulator.integrityUnknown;
  const coverage: Rolling24hPublicProxyCoverage = Object.freeze({
    knownObservationCount,
    unknownObservationCount,
    positiveObservationCount,
    knownObservationRatio: uniqueObservationCount === 0
      ? null
      : exactRational(BigInt(knownObservationCount), BigInt(uniqueObservationCount)),
    observationReasonCodes: Object.freeze([...accumulator.observationReasons].sort()),
  });
  const accountEffectiveNetEdge: Rolling24hAccountEffectiveNetEdge = Object.freeze({
    state: 'UNKNOWN',
    meanNetEdgePct: null,
    bestNetEdgePct: null,
    worstNetEdgePct: null,
    meanNetEdgeUsdPerOneThousandNotional: null,
    reasonCode: 'ACCOUNT_EFFECTIVE_NET_EDGE_UNKNOWN',
  });

  return Object.freeze({
    label: PUBLIC_OBSERVED_PROXY_NOT_EXECUTED,
    state,
    boundary: 'CLOSED_CLOSED',
    windowStartMs,
    windowEndMs,
    highWaterLedgerEventId: accumulator.highWaterLedgerEventId,
    highWaterReached: accumulator.highWaterReached,
    scanComplete: accumulator.scanComplete,
    truncated: accumulator.truncated,
    maxRows,
    rawRowCount: accumulator.rawRowCount,
    uniqueObservationCount,
    duplicateRetryCount: accumulator.duplicateRetryCount,
    conflictCount: accumulator.conflictCount,
    malformedCount: accumulator.malformedCount,
    outOfWindowCount: accumulator.outOfWindowCount,
    futureCount: accumulator.futureCount,
    distinctOpportunityIdCount: accumulator.opportunityIds.size,
    newOpportunityIdCount: accumulator.newOpportunityIds.size,
    assumptionBoundPublicProxy: coverage,
    knownOnly: knownOnlyStatistics(accumulator.observations.values(), publishKnownOnly),
    accountEffectiveNetEdge,
    reasonCodes: orderedReasons(accumulator.reasons),
  });
}

/**
 * Projects a deterministic closed 24-hour observation window from the sole
 * canonical Ledger. Commit time supplies only the exclusive as-of ceiling;
 * payload `observedAtMs` alone determines observation-window membership. The
 * scan intentionally starts at event-kind genesis so even a durably committed
 * chronology-invalid row cannot age behind a commit-time floor and manufacture
 * an EMPTY result. The explicit row cap turns unbounded continuity into UNKNOWN.
 */
export function readRolling24hEdgeStatistic(
  ledger: Rolling24hEdgeLedgerPort,
  options: Rolling24hEdgeStatisticOptions,
): Readonly<Rolling24hEdgeStatistic> {
  if (!ledger || typeof ledger.recentEvents !== 'function') {
    throw new TypeError('rolling 24h edge statistic requires the existing Ledger recentEvents port');
  }
  const maxRows = assertOptions(options);
  const windowEndMs = options.asOfMs;
  const windowStartMs = windowEndMs - ROLLING_24H_MS;
  const accumulator = initialAccumulator();

  let anchor: readonly Readonly<Rolling24hEdgeLedgerEvent>[];
  try {
    anchor = ledger.recentEvents(
      1,
      PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_EVENT_KIND,
      undefined,
      undefined,
      undefined,
      undefined,
      windowEndMs + 1,
    );
  } catch {
    markUnknown(accumulator, 'LEDGER_READ_FAILED');
    return projectionFrom(accumulator, windowStartMs, windowEndMs, maxRows);
  }
  if (!Array.isArray(anchor) || anchor.length > 1) {
    accumulator.malformedCount += 1;
    markUnknown(accumulator, 'LEDGER_ANCHOR_MALFORMED');
    return projectionFrom(accumulator, windowStartMs, windowEndMs, maxRows);
  }
  if (anchor.length === 0) {
    accumulator.highWaterReached = true;
    accumulator.scanComplete = true;
    return projectionFrom(accumulator, windowStartMs, windowEndMs, maxRows);
  }
  const highWaterId = anchor[0]?.id;
  if (
    typeof highWaterId !== 'number'
    || !Number.isSafeInteger(highWaterId)
    || highWaterId < 1
    || highWaterId >= Number.MAX_SAFE_INTEGER
    || anchor[0]?.kind !== PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_EVENT_KIND
  ) {
    accumulator.malformedCount += 1;
    markUnknown(accumulator, 'LEDGER_ANCHOR_MALFORMED');
    return projectionFrom(accumulator, windowStartMs, windowEndMs, maxRows);
  }
  accumulator.highWaterLedgerEventId = highWaterId;

  let cursor = 0;
  while (cursor < highWaterId) {
    const remaining = maxRows - accumulator.rawRowCount;
    if (remaining <= 0) {
      accumulator.truncated = true;
      markUnknown(accumulator, 'LEDGER_SCAN_ROW_CAP_EXCEEDED');
      break;
    }
    const requested = Math.min(BASIS_EDGE_PAGE_SIZE, remaining);
    let page: readonly Readonly<Rolling24hEdgeLedgerEvent>[];
    try {
      page = ledger.recentEvents(
        requested,
        PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_EVENT_KIND,
        undefined,
        undefined,
        undefined,
        highWaterId + 1,
        windowEndMs + 1,
        0,
        cursor,
      );
    } catch {
      markUnknown(accumulator, 'LEDGER_READ_FAILED');
      break;
    }
    if (!Array.isArray(page) || page.length > requested) {
      if (Array.isArray(page)) accumulator.rawRowCount += page.length;
      accumulator.malformedCount += 1;
      markUnknown(accumulator, 'LEDGER_PAGE_MALFORMED');
      break;
    }
    if (page.length === 0) {
      markUnknown(accumulator, 'LEDGER_PAGE_EXHAUSTED_BEFORE_HIGH_WATER');
      break;
    }

    accumulator.rawRowCount += page.length;
    let previousId = cursor;
    let orderingValid = true;
    for (const row of page) {
      if (!row || !validLedgerIdentity(row, previousId, highWaterId)) {
        orderingValid = false;
        accumulator.malformedCount += 1;
        markUnknown(accumulator, 'LEDGER_PAGE_ORDER_INVALID');
        break;
      }
      previousId = row.id;
      ingestRow(accumulator, row, windowStartMs, windowEndMs);
    }
    if (!orderingValid) break;
    cursor = previousId;
    if (cursor === highWaterId) {
      accumulator.highWaterReached = true;
      accumulator.scanComplete = true;
      break;
    }
    if (page.length < requested) {
      markUnknown(accumulator, 'LEDGER_PAGE_EXHAUSTED_BEFORE_HIGH_WATER');
      break;
    }
    if (accumulator.rawRowCount === maxRows) {
      accumulator.truncated = true;
      markUnknown(accumulator, 'LEDGER_SCAN_ROW_CAP_EXCEEDED');
      break;
    }
  }

  return projectionFrom(accumulator, windowStartMs, windowEndMs, maxRows);
}

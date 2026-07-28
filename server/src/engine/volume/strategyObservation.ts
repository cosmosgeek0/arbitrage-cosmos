/**
 * Public, validate-only observation contract for the Volume strategy.
 *
 * This module is deliberately pure: callers supply every clock and source
 * revision, and the builder performs no network, environment, timer, private
 * API, or credential access.
 */

import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import {
  addExactDecimals,
  compareExactDecimals,
  isExactPositive,
  multiplyExactDecimals,
  normalizeExactDecimal,
  type ExactDecimal,
} from '../../capitalFoundation/contracts/decimal.js';
import { canonicalJson } from '../../foundation/contracts/identity.js';
import { isCanonicalSymbol } from './validation.js';

export const VOLUME_STRATEGY_OBSERVATION_SCHEMA_VERSION = 'volume.strategy-observation.v1' as const;
export const VOLUME_STRATEGY_OBSERVATION_MAX_AGE_MS = 10_000;
/**
 * Stable identity for the mixed public REST + market-data-only WebSocket
 * observation path. Both endpoints are unauthenticated public market data;
 * the identity intentionally does not claim they share one endpoint class.
 */
export const VOLUME_PUBLIC_SOURCE_ID = 'binance.spot.public-unauthenticated-market-data' as const;
export const VOLUME_PUBLIC_REST_BASE_URL = 'https://api.binance.com' as const;
export const VOLUME_PUBLIC_WEBSOCKET_BASE_URL = 'wss://data-stream.binance.vision:443' as const;
export const VOLUME_OBSERVATION_MAX_DEPTH_LEVELS = 100;
export const VOLUME_OBSERVATION_MAX_DEPTH_UPDATE_RANGES = 256;

export type VolumeObservationContinuity = 'CONTIGUOUS' | 'GAP' | 'UNKNOWN' | 'RECONNECTING';
export type VolumeObservationBookScope = 'TOP_OF_BOOK' | 'SYNCHRONIZED_DEPTH';
export type VolumeObservationCapacitySide = 'BUY' | 'SELL';
export type VolumeObservationNumericFidelity =
  | 'SOURCE_TEXT_EXACT'
  | 'NORMALIZED_FROM_PARSED_NUMBER';

export type VolumeObservationCapacityBasis = 'BEST_LEVEL_ONLY' | 'SYNCHRONIZED_CUMULATIVE';

export interface VolumeObservationDepthLevel {
  readonly price: string;
  readonly quantity: string;
}

export interface VolumeObservationDepthUpdateRange {
  readonly firstUpdateId: number;
  readonly finalUpdateId: number;
  readonly eventTimeMs: number;
}

export interface VolumeObservationDepthProof {
  readonly synchronization: {
    readonly sourceGeneration: number;
    readonly sourceRevision: number;
    readonly snapshotLastUpdateId: number;
    readonly updateRanges: readonly VolumeObservationDepthUpdateRange[];
  };
  readonly bids: readonly VolumeObservationDepthLevel[];
  readonly asks: readonly VolumeObservationDepthLevel[];
}

export interface VolumeStrategyObservationInput {
  readonly proposal: {
    readonly proposalId: string;
    readonly proposalRevision: number;
    readonly proposalDigest: string;
    readonly configurationRevision: string;
    readonly correlationId: string;
    readonly symbol: string;
    readonly direction: 'long' | 'short';
    readonly expiresAtMs: number;
  };
  readonly source: {
    readonly sourceId: typeof VOLUME_PUBLIC_SOURCE_ID;
    readonly restBaseUrl: typeof VOLUME_PUBLIC_REST_BASE_URL;
    readonly websocketBaseUrl: typeof VOLUME_PUBLIC_WEBSOCKET_BASE_URL;
    readonly authentication: 'NONE';
    readonly timeUnit: 'MILLISECOND';
    readonly generation: number;
    readonly revision: number;
    readonly continuity: VolumeObservationContinuity;
  };
  readonly aggregateTrade: {
    readonly symbol: string;
    readonly aggregateTradeId: number;
    readonly firstTradeId: number;
    readonly lastTradeId: number;
    readonly eventTimeMs: number;
    readonly tradeTimeMs: number;
    readonly receivedAtMs: number;
  };
  readonly book: {
    readonly symbol: string;
    readonly bidPrice: string;
    readonly askPrice: string;
    readonly bidQuantity: string;
    readonly askQuantity: string;
    readonly sourceTimeMs: null;
    readonly receivedAtMs: number;
    readonly freshnessBasis: 'RECEIVE_TIME';
    readonly numericFidelity: VolumeObservationNumericFidelity;
    readonly scope: VolumeObservationBookScope;
    readonly depth: VolumeObservationDepthProof | null;
  };
  readonly evaluatedAtMs: number;
}

export interface VolumeStrategyObservation {
  readonly schemaVersion: typeof VOLUME_STRATEGY_OBSERVATION_SCHEMA_VERSION;
  readonly proposal: VolumeStrategyObservationInput['proposal'];
  readonly source: VolumeStrategyObservationInput['source'];
  readonly aggregateTrade: VolumeStrategyObservationInput['aggregateTrade'];
  readonly book: VolumeStrategyObservationInput['book'] & {
    readonly capacity: {
      readonly side: VolumeObservationCapacitySide;
      readonly basis: VolumeObservationCapacityBasis;
      /**
       * Best-level price for BEST_LEVEL_ONLY; worst included executable
       * limit price for SYNCHRONIZED_CUMULATIVE. It is not an average price.
       */
      readonly price: string;
      readonly baseQuantity: string;
      readonly quoteNotional: string;
      readonly levelCount: number;
    };
  };
  readonly evaluatedAtMs: number;
  readonly observationDigest: `vobs_${string}`;
}

export interface VolumeStrategyObservationInspection {
  readonly observation: VolumeStrategyObservation | null;
  readonly reasonCodes: readonly VolumeStrategyObservationValidationReason[];
}

export type VolumeStrategyObservationValidationReason =
  | 'VOLUME_OBSERVATION_NOT_PLAIN_DATA'
  | 'VOLUME_OBSERVATION_SCHEMA_INVALID'
  | 'VOLUME_OBSERVATION_SOURCE_IDENTITY_INVALID'
  | 'VOLUME_OBSERVATION_PROPOSAL_INVALID'
  | 'VOLUME_OBSERVATION_SOURCE_REVISION_INVALID'
  | 'VOLUME_OBSERVATION_TIME_UNIT_INVALID'
  | 'VOLUME_OBSERVATION_SYMBOL_MISMATCH'
  | 'VOLUME_OBSERVATION_TRADE_CURSOR_INVALID'
  | 'VOLUME_OBSERVATION_CLOCK_INVALID'
  | 'VOLUME_OBSERVATION_CLOCK_IN_FUTURE'
  | 'VOLUME_OBSERVATION_STALE'
  | 'VOLUME_OBSERVATION_EXPIRED'
  | 'VOLUME_OBSERVATION_BOOK_INVALID'
  | 'VOLUME_OBSERVATION_NUMERIC_FIDELITY_INVALID'
  | 'VOLUME_OBSERVATION_DEPTH_PROOF_INVALID'
  | 'VOLUME_OBSERVATION_DEPTH_LEVELS_INVALID'
  | 'VOLUME_OBSERVATION_CAPACITY_INVALID'
  | 'VOLUME_OBSERVATION_DIGEST_INVALID';

export type VolumeStrategyObservationSourceRejectionCode =
  | 'VOLUME_SOURCE_OBSERVATION_INVALID'
  | 'VOLUME_SOURCE_CONTINUITY_GAP'
  | 'VOLUME_SOURCE_CONTINUITY_UNKNOWN'
  | 'VOLUME_SOURCE_RECONNECTING'
  | 'VOLUME_SOURCE_BOOK_NUMERIC_FIDELITY_NORMALIZED'
  | 'VOLUME_SOURCE_BOOK_CAPACITY_TOP_OF_BOOK_ONLY';

export interface VolumeStrategyObservationSourceAssessment {
  readonly accepted: boolean;
  readonly reasonCodes: readonly VolumeStrategyObservationSourceRejectionCode[];
}

type PlainDataRecord = Readonly<Record<string, unknown>>;

interface SemanticObservation {
  readonly proposal: VolumeStrategyObservation['proposal'];
  readonly source: VolumeStrategyObservation['source'];
  readonly aggregateTrade: VolumeStrategyObservation['aggregateTrade'];
  readonly book: VolumeStrategyObservation['book'];
  readonly evaluatedAtMs: number;
}

const INPUT_ROOT_KEYS = ['aggregateTrade', 'book', 'evaluatedAtMs', 'proposal', 'source'] as const;
const OUTPUT_ROOT_KEYS = [
  'aggregateTrade',
  'book',
  'evaluatedAtMs',
  'observationDigest',
  'proposal',
  'schemaVersion',
  'source',
] as const;
const PROPOSAL_KEYS = [
  'configurationRevision',
  'correlationId',
  'direction',
  'expiresAtMs',
  'proposalDigest',
  'proposalId',
  'proposalRevision',
  'symbol',
] as const;
const SOURCE_KEYS = [
  'authentication',
  'continuity',
  'generation',
  'restBaseUrl',
  'revision',
  'sourceId',
  'timeUnit',
  'websocketBaseUrl',
] as const;
const AGGREGATE_TRADE_KEYS = [
  'aggregateTradeId',
  'eventTimeMs',
  'firstTradeId',
  'lastTradeId',
  'receivedAtMs',
  'symbol',
  'tradeTimeMs',
] as const;
const INPUT_BOOK_KEYS = [
  'askPrice',
  'askQuantity',
  'bidPrice',
  'bidQuantity',
  'depth',
  'freshnessBasis',
  'numericFidelity',
  'receivedAtMs',
  'scope',
  'sourceTimeMs',
  'symbol',
] as const;
const OUTPUT_BOOK_KEYS = [...INPUT_BOOK_KEYS, 'capacity'] as const;
const CAPACITY_KEYS = ['baseQuantity', 'basis', 'levelCount', 'price', 'quoteNotional', 'side'] as const;
const DEPTH_KEYS = ['asks', 'bids', 'synchronization'] as const;
const DEPTH_SYNCHRONIZATION_KEYS = [
  'snapshotLastUpdateId',
  'sourceGeneration',
  'sourceRevision',
  'updateRanges',
] as const;
const DEPTH_UPDATE_RANGE_KEYS = ['eventTimeMs', 'finalUpdateId', 'firstUpdateId'] as const;
const DEPTH_LEVEL_KEYS = ['price', 'quantity'] as const;
const MAX_UTC_MS = 4_102_444_800_000;

function captureDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): { readonly record: PlainDataRecord | null; readonly plainData: boolean } {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return Object.freeze({ record: null, plainData: false });
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string')) {
    return Object.freeze({ record: null, plainData: false });
  }
  const actualKeys = (ownKeys as string[]).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length
    || actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    return Object.freeze({ record: null, plainData: true });
  }

  const captured: Record<string, unknown> = {};
  for (const key of actualKeys) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return Object.freeze({ record: null, plainData: false });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || !('value' in descriptor)
      || descriptor.get !== undefined
      || descriptor.set !== undefined
      || descriptor.enumerable !== true
    ) {
      return Object.freeze({ record: null, plainData: false });
    }
    captured[key] = descriptor.value;
  }
  return Object.freeze({ record: Object.freeze(captured), plainData: true });
}

function captureDenseDataArray(
  value: unknown,
  maximumLength: number,
): { readonly values: readonly unknown[] | null; readonly plainData: boolean } {
  if (
    value === null
    || typeof value !== 'object'
    || utilTypes.isProxy(value)
    || !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return Object.freeze({ values: null, plainData: false });
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined
    || !('value' in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 1
    || lengthDescriptor.value > maximumLength
  ) {
    return Object.freeze({ values: null, plainData: true });
  }
  const length = lengthDescriptor.value as number;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => typeof key !== 'string')
    || ownKeys.length !== length + 1
    || !ownKeys.includes('length')
  ) {
    return Object.freeze({ values: null, plainData: false });
  }

  const captured: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    if (!ownKeys.includes(key)) return Object.freeze({ values: null, plainData: false });
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || !('value' in descriptor)
      || descriptor.get !== undefined
      || descriptor.set !== undefined
      || descriptor.enumerable !== true
    ) {
      return Object.freeze({ values: null, plainData: false });
    }
    captured.push(descriptor.value);
  }
  return Object.freeze({ values: Object.freeze(captured), plainData: true });
}

function isLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && !Object.is(value, -0);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

function isUtcMs(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value <= MAX_UTC_MS;
}

function normalizePositiveDecimal(value: unknown): ExactDecimal | null {
  try {
    const normalized = normalizeExactDecimal(value);
    return isExactPositive(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function addReason(
  reasons: VolumeStrategyObservationValidationReason[],
  reason: VolumeStrategyObservationValidationReason,
): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function normalizeDepthLevels(
  value: unknown,
  descending: boolean,
  reasons: VolumeStrategyObservationValidationReason[],
): readonly VolumeObservationDepthLevel[] | null {
  const arrayResult = captureDenseDataArray(value, VOLUME_OBSERVATION_MAX_DEPTH_LEVELS);
  if (arrayResult.values === null) {
    addReason(
      reasons,
      arrayResult.plainData
        ? 'VOLUME_OBSERVATION_DEPTH_LEVELS_INVALID'
        : 'VOLUME_OBSERVATION_NOT_PLAIN_DATA',
    );
    return null;
  }

  const normalized: VolumeObservationDepthLevel[] = [];
  for (const candidate of arrayResult.values) {
    const recordResult = captureDataRecord(candidate, DEPTH_LEVEL_KEYS);
    if (recordResult.record === null) {
      addReason(
        reasons,
        recordResult.plainData
          ? 'VOLUME_OBSERVATION_DEPTH_LEVELS_INVALID'
          : 'VOLUME_OBSERVATION_NOT_PLAIN_DATA',
      );
      return null;
    }
    const price = normalizePositiveDecimal(recordResult.record.price);
    const quantity = normalizePositiveDecimal(recordResult.record.quantity);
    if (price === null || quantity === null) {
      addReason(reasons, 'VOLUME_OBSERVATION_DEPTH_LEVELS_INVALID');
      return null;
    }
    const previous = normalized.at(-1);
    if (
      previous !== undefined
      && (
        descending
          ? compareExactDecimals(previous.price as ExactDecimal, price) <= 0
          : compareExactDecimals(previous.price as ExactDecimal, price) >= 0
      )
    ) {
      addReason(reasons, 'VOLUME_OBSERVATION_DEPTH_LEVELS_INVALID');
      return null;
    }
    normalized.push(Object.freeze({ price, quantity }));
  }
  return Object.freeze(normalized);
}

function normalizeDepthProof(
  value: unknown,
  scope: unknown,
  numericFidelity: unknown,
  sourceGeneration: unknown,
  sourceRevision: unknown,
  bidPrice: ExactDecimal,
  askPrice: ExactDecimal,
  bidQuantity: ExactDecimal,
  askQuantity: ExactDecimal,
  receivedAtMs: unknown,
  evaluatedAtMs: unknown,
  reasons: VolumeStrategyObservationValidationReason[],
): VolumeObservationDepthProof | null {
  if (scope === 'TOP_OF_BOOK') {
    if (value !== null) addReason(reasons, 'VOLUME_OBSERVATION_DEPTH_PROOF_INVALID');
    return null;
  }
  if (scope !== 'SYNCHRONIZED_DEPTH') {
    addReason(reasons, 'VOLUME_OBSERVATION_DEPTH_PROOF_INVALID');
    return null;
  }
  if (numericFidelity !== 'SOURCE_TEXT_EXACT') {
    addReason(reasons, 'VOLUME_OBSERVATION_NUMERIC_FIDELITY_INVALID');
    return null;
  }
  if (value === null) {
    addReason(reasons, 'VOLUME_OBSERVATION_DEPTH_PROOF_INVALID');
    return null;
  }

  const depthResult = captureDataRecord(value, DEPTH_KEYS);
  if (depthResult.record === null) {
    addReason(
      reasons,
      depthResult.plainData
        ? 'VOLUME_OBSERVATION_DEPTH_PROOF_INVALID'
        : 'VOLUME_OBSERVATION_NOT_PLAIN_DATA',
    );
    return null;
  }
  const synchronizationResult = captureDataRecord(
    depthResult.record.synchronization,
    DEPTH_SYNCHRONIZATION_KEYS,
  );
  if (synchronizationResult.record === null) {
    addReason(
      reasons,
      synchronizationResult.plainData
        ? 'VOLUME_OBSERVATION_DEPTH_PROOF_INVALID'
        : 'VOLUME_OBSERVATION_NOT_PLAIN_DATA',
    );
    return null;
  }
  const synchronization = synchronizationResult.record;
  const rangesResult = captureDenseDataArray(
    synchronization.updateRanges,
    VOLUME_OBSERVATION_MAX_DEPTH_UPDATE_RANGES,
  );
  if (rangesResult.values === null) {
    addReason(
      reasons,
      rangesResult.plainData
        ? 'VOLUME_OBSERVATION_DEPTH_PROOF_INVALID'
        : 'VOLUME_OBSERVATION_NOT_PLAIN_DATA',
    );
    return null;
  }

  if (
    synchronization.sourceGeneration !== sourceGeneration
    || synchronization.sourceRevision !== sourceRevision
    || !isNonNegativeSafeInteger(synchronization.snapshotLastUpdateId)
    || synchronization.snapshotLastUpdateId >= Number.MAX_SAFE_INTEGER
  ) {
    addReason(reasons, 'VOLUME_OBSERVATION_DEPTH_PROOF_INVALID');
  }

  const normalizedRanges: VolumeObservationDepthUpdateRange[] = [];
  let previousFinalUpdateId: number | null = null;
  let previousEventTimeMs: number | null = null;
  for (const candidate of rangesResult.values) {
    const rangeResult = captureDataRecord(candidate, DEPTH_UPDATE_RANGE_KEYS);
    if (rangeResult.record === null) {
      addReason(
        reasons,
        rangeResult.plainData
          ? 'VOLUME_OBSERVATION_DEPTH_PROOF_INVALID'
          : 'VOLUME_OBSERVATION_NOT_PLAIN_DATA',
      );
      return null;
    }
    const range = rangeResult.record;
    if (
      !isNonNegativeSafeInteger(range.firstUpdateId)
      || !isNonNegativeSafeInteger(range.finalUpdateId)
      || range.firstUpdateId > range.finalUpdateId
      || !isUtcMs(range.eventTimeMs)
      || (
        previousEventTimeMs !== null
        && isUtcMs(range.eventTimeMs)
        && range.eventTimeMs < previousEventTimeMs
      )
      || (isUtcMs(receivedAtMs) && isUtcMs(range.eventTimeMs) && range.eventTimeMs > receivedAtMs)
      || (isUtcMs(evaluatedAtMs) && isUtcMs(range.eventTimeMs) && range.eventTimeMs > evaluatedAtMs)
    ) {
      addReason(reasons, 'VOLUME_OBSERVATION_DEPTH_PROOF_INVALID');
      continue;
    }

    const requiredUpdateId = previousFinalUpdateId === null
      ? (synchronization.snapshotLastUpdateId as number) + 1
      : previousFinalUpdateId + 1;
    if (
      !Number.isSafeInteger(requiredUpdateId)
      || (
        previousFinalUpdateId === null
          ? range.firstUpdateId > requiredUpdateId
          : range.firstUpdateId !== requiredUpdateId
      )
      || range.finalUpdateId < requiredUpdateId
      || (previousFinalUpdateId !== null && range.finalUpdateId <= previousFinalUpdateId)
    ) {
      addReason(reasons, 'VOLUME_OBSERVATION_DEPTH_PROOF_INVALID');
    }
    normalizedRanges.push(Object.freeze({
      firstUpdateId: range.firstUpdateId,
      finalUpdateId: range.finalUpdateId,
      eventTimeMs: range.eventTimeMs,
    }));
    previousFinalUpdateId = range.finalUpdateId;
    previousEventTimeMs = range.eventTimeMs;
  }
  if (normalizedRanges.length === 0) {
    addReason(reasons, 'VOLUME_OBSERVATION_DEPTH_PROOF_INVALID');
  }
  if (
    previousEventTimeMs !== null
    && isUtcMs(evaluatedAtMs)
    && evaluatedAtMs - previousEventTimeMs > VOLUME_STRATEGY_OBSERVATION_MAX_AGE_MS
  ) {
    addReason(reasons, 'VOLUME_OBSERVATION_STALE');
  }

  const bids = normalizeDepthLevels(depthResult.record.bids, true, reasons);
  const asks = normalizeDepthLevels(depthResult.record.asks, false, reasons);
  if (
    bids === null
    || asks === null
    || bids[0]?.price !== bidPrice
    || bids[0]?.quantity !== bidQuantity
    || asks[0]?.price !== askPrice
    || asks[0]?.quantity !== askQuantity
  ) {
    addReason(reasons, 'VOLUME_OBSERVATION_DEPTH_LEVELS_INVALID');
  }
  if (
    reasons.length > 0
    || bids === null
    || asks === null
    || !isNonNegativeSafeInteger(synchronization.snapshotLastUpdateId)
  ) {
    return null;
  }

  return Object.freeze({
    synchronization: Object.freeze({
      sourceGeneration: synchronization.sourceGeneration as number,
      sourceRevision: synchronization.sourceRevision as number,
      snapshotLastUpdateId: synchronization.snapshotLastUpdateId,
      updateRanges: Object.freeze(normalizedRanges),
    }),
    bids,
    asks,
  });
}

function normalizedSemantic(
  input: unknown,
  outputMode: boolean,
  requireDigestMatch: boolean,
): {
  readonly semantic: SemanticObservation | null;
  readonly digest: `vobs_${string}` | null;
  readonly reasons: readonly VolumeStrategyObservationValidationReason[];
} {
  const reasons: VolumeStrategyObservationValidationReason[] = [];
  const rootResult = captureDataRecord(input, outputMode ? OUTPUT_ROOT_KEYS : INPUT_ROOT_KEYS);
  if (rootResult.record === null) {
    addReason(
      reasons,
      rootResult.plainData ? 'VOLUME_OBSERVATION_SCHEMA_INVALID' : 'VOLUME_OBSERVATION_NOT_PLAIN_DATA',
    );
    return Object.freeze({ semantic: null, digest: null, reasons: Object.freeze(reasons) });
  }
  const root = rootResult.record;

  if (outputMode && root.schemaVersion !== VOLUME_STRATEGY_OBSERVATION_SCHEMA_VERSION) {
    addReason(reasons, 'VOLUME_OBSERVATION_SCHEMA_INVALID');
  }

  const proposalResult = captureDataRecord(root.proposal, PROPOSAL_KEYS);
  const sourceResult = captureDataRecord(root.source, SOURCE_KEYS);
  const aggregateTradeResult = captureDataRecord(root.aggregateTrade, AGGREGATE_TRADE_KEYS);
  const bookResult = captureDataRecord(root.book, outputMode ? OUTPUT_BOOK_KEYS : INPUT_BOOK_KEYS);
  for (const result of [proposalResult, sourceResult, aggregateTradeResult, bookResult]) {
    if (result.record === null) {
      addReason(
        reasons,
        result.plainData ? 'VOLUME_OBSERVATION_SCHEMA_INVALID' : 'VOLUME_OBSERVATION_NOT_PLAIN_DATA',
      );
    }
  }
  if (
    proposalResult.record === null
    || sourceResult.record === null
    || aggregateTradeResult.record === null
    || bookResult.record === null
  ) {
    return Object.freeze({ semantic: null, digest: null, reasons: Object.freeze(reasons) });
  }

  const proposal = proposalResult.record;
  const source = sourceResult.record;
  const aggregateTrade = aggregateTradeResult.record;
  const book = bookResult.record;

  if (
    !isLabel(proposal.proposalId)
    || !isPositiveSafeInteger(proposal.proposalRevision)
    || !isLabel(proposal.proposalDigest)
    || !isLabel(proposal.configurationRevision)
    || !isLabel(proposal.correlationId)
    || !isCanonicalSymbol(proposal.symbol)
    || (proposal.direction !== 'long' && proposal.direction !== 'short')
    || !isUtcMs(proposal.expiresAtMs)
  ) {
    addReason(reasons, 'VOLUME_OBSERVATION_PROPOSAL_INVALID');
  }

  if (
    source.sourceId !== VOLUME_PUBLIC_SOURCE_ID
    || source.restBaseUrl !== VOLUME_PUBLIC_REST_BASE_URL
    || source.websocketBaseUrl !== VOLUME_PUBLIC_WEBSOCKET_BASE_URL
    || source.authentication !== 'NONE'
  ) {
    addReason(reasons, 'VOLUME_OBSERVATION_SOURCE_IDENTITY_INVALID');
  }
  if (!isPositiveSafeInteger(source.generation) || !isPositiveSafeInteger(source.revision)) {
    addReason(reasons, 'VOLUME_OBSERVATION_SOURCE_REVISION_INVALID');
  }
  if (source.timeUnit !== 'MILLISECOND') {
    addReason(reasons, 'VOLUME_OBSERVATION_TIME_UNIT_INVALID');
  }
  if (
    source.continuity !== 'CONTIGUOUS'
    && source.continuity !== 'GAP'
    && source.continuity !== 'UNKNOWN'
    && source.continuity !== 'RECONNECTING'
  ) {
    addReason(reasons, 'VOLUME_OBSERVATION_SCHEMA_INVALID');
  }

  if (
    !isNonNegativeSafeInteger(aggregateTrade.aggregateTradeId)
    || !isNonNegativeSafeInteger(aggregateTrade.firstTradeId)
    || !isNonNegativeSafeInteger(aggregateTrade.lastTradeId)
    || (
      isNonNegativeSafeInteger(aggregateTrade.firstTradeId)
      && isNonNegativeSafeInteger(aggregateTrade.lastTradeId)
      && aggregateTrade.firstTradeId > aggregateTrade.lastTradeId
    )
  ) {
    addReason(reasons, 'VOLUME_OBSERVATION_TRADE_CURSOR_INVALID');
  }
  if (
    aggregateTrade.symbol !== proposal.symbol
    || book.symbol !== proposal.symbol
  ) {
    addReason(reasons, 'VOLUME_OBSERVATION_SYMBOL_MISMATCH');
  }

  const clocks = [
    proposal.expiresAtMs,
    aggregateTrade.eventTimeMs,
    aggregateTrade.tradeTimeMs,
    aggregateTrade.receivedAtMs,
    book.receivedAtMs,
    root.evaluatedAtMs,
  ];
  if (!clocks.every(isUtcMs)) {
    addReason(reasons, 'VOLUME_OBSERVATION_CLOCK_INVALID');
  }
  if (
    isUtcMs(aggregateTrade.tradeTimeMs)
    && isUtcMs(aggregateTrade.eventTimeMs)
    && isUtcMs(aggregateTrade.receivedAtMs)
    && (
      aggregateTrade.tradeTimeMs > aggregateTrade.eventTimeMs
      || aggregateTrade.eventTimeMs > aggregateTrade.receivedAtMs
    )
  ) {
    addReason(reasons, 'VOLUME_OBSERVATION_CLOCK_INVALID');
  }
  if (
    isUtcMs(root.evaluatedAtMs)
    && (
      (isUtcMs(aggregateTrade.eventTimeMs) && aggregateTrade.eventTimeMs > root.evaluatedAtMs)
      || (isUtcMs(aggregateTrade.tradeTimeMs) && aggregateTrade.tradeTimeMs > root.evaluatedAtMs)
      || (isUtcMs(aggregateTrade.receivedAtMs) && aggregateTrade.receivedAtMs > root.evaluatedAtMs)
      || (isUtcMs(book.receivedAtMs) && book.receivedAtMs > root.evaluatedAtMs)
    )
  ) {
    addReason(reasons, 'VOLUME_OBSERVATION_CLOCK_IN_FUTURE');
  }
  if (
    isUtcMs(root.evaluatedAtMs)
    && (
      (
        isUtcMs(aggregateTrade.tradeTimeMs)
        && root.evaluatedAtMs - aggregateTrade.tradeTimeMs > VOLUME_STRATEGY_OBSERVATION_MAX_AGE_MS
      )
      || (
        isUtcMs(aggregateTrade.receivedAtMs)
        && root.evaluatedAtMs - aggregateTrade.receivedAtMs > VOLUME_STRATEGY_OBSERVATION_MAX_AGE_MS
      )
      || (
        isUtcMs(book.receivedAtMs)
        && root.evaluatedAtMs - book.receivedAtMs > VOLUME_STRATEGY_OBSERVATION_MAX_AGE_MS
      )
    )
  ) {
    addReason(reasons, 'VOLUME_OBSERVATION_STALE');
  }
  if (
    isUtcMs(proposal.expiresAtMs)
    && isUtcMs(root.evaluatedAtMs)
    && proposal.expiresAtMs <= root.evaluatedAtMs
  ) {
    addReason(reasons, 'VOLUME_OBSERVATION_EXPIRED');
  }

  const bidPrice = normalizePositiveDecimal(book.bidPrice);
  const askPrice = normalizePositiveDecimal(book.askPrice);
  const bidQuantity = normalizePositiveDecimal(book.bidQuantity);
  const askQuantity = normalizePositiveDecimal(book.askQuantity);
  if (
    bidPrice === null
    || askPrice === null
    || bidQuantity === null
    || askQuantity === null
    || compareExactDecimals(bidPrice ?? ('0' as ExactDecimal), askPrice ?? ('0' as ExactDecimal)) >= 0
    || book.sourceTimeMs !== null
    || book.freshnessBasis !== 'RECEIVE_TIME'
    || (book.scope !== 'TOP_OF_BOOK' && book.scope !== 'SYNCHRONIZED_DEPTH')
  ) {
    addReason(reasons, 'VOLUME_OBSERVATION_BOOK_INVALID');
  }
  if (
    book.numericFidelity !== 'SOURCE_TEXT_EXACT'
    && book.numericFidelity !== 'NORMALIZED_FROM_PARSED_NUMBER'
  ) {
    addReason(reasons, 'VOLUME_OBSERVATION_NUMERIC_FIDELITY_INVALID');
  }

  const normalizedDepth = (
    bidPrice !== null
    && askPrice !== null
    && bidQuantity !== null
    && askQuantity !== null
  )
    ? normalizeDepthProof(
      book.depth,
      book.scope,
      book.numericFidelity,
      source.generation,
      source.revision,
      bidPrice,
      askPrice,
      bidQuantity,
      askQuantity,
      book.receivedAtMs,
      root.evaluatedAtMs,
      reasons,
    )
    : null;

  if (
    reasons.length > 0
    || bidPrice === null
    || askPrice === null
    || bidQuantity === null
    || askQuantity === null
    || (book.scope === 'SYNCHRONIZED_DEPTH' && normalizedDepth === null)
  ) {
    return Object.freeze({ semantic: null, digest: null, reasons: Object.freeze(reasons) });
  }

  const direction = proposal.direction as 'long' | 'short';
  const side: VolumeObservationCapacitySide = direction === 'long' ? 'BUY' : 'SELL';
  const capacityBasis: VolumeObservationCapacityBasis =
    book.scope === 'TOP_OF_BOOK' ? 'BEST_LEVEL_ONLY' : 'SYNCHRONIZED_CUMULATIVE';
  const capacityLevels: readonly VolumeObservationDepthLevel[] = normalizedDepth === null
    ? Object.freeze([
      Object.freeze({
        price: side === 'BUY' ? askPrice : bidPrice,
        quantity: side === 'BUY' ? askQuantity : bidQuantity,
      }),
    ])
    : side === 'BUY'
      ? normalizedDepth.asks
      : normalizedDepth.bids;
  const capacityPrice = capacityLevels.at(-1)?.price as ExactDecimal;
  let capacityQuantity = '0' as ExactDecimal;
  let capacityNotional = '0' as ExactDecimal;
  try {
    for (const level of capacityLevels) {
      const levelPrice = level.price as ExactDecimal;
      const levelQuantity = level.quantity as ExactDecimal;
      capacityQuantity = addExactDecimals(capacityQuantity, levelQuantity);
      capacityNotional = addExactDecimals(
        capacityNotional,
        multiplyExactDecimals(levelPrice, levelQuantity),
      );
    }
  } catch {
    addReason(reasons, 'VOLUME_OBSERVATION_CAPACITY_INVALID');
    return Object.freeze({ semantic: null, digest: null, reasons: Object.freeze(reasons) });
  }
  const capacityLevelCount = capacityLevels.length;

  if (outputMode) {
    const capacityResult = captureDataRecord(book.capacity, CAPACITY_KEYS);
    if (capacityResult.record === null) {
      addReason(
        reasons,
        capacityResult.plainData ? 'VOLUME_OBSERVATION_CAPACITY_INVALID' : 'VOLUME_OBSERVATION_NOT_PLAIN_DATA',
      );
    } else {
      const capacity = capacityResult.record;
      if (
        capacity.side !== side
        || capacity.basis !== capacityBasis
        || capacity.price !== capacityPrice
        || capacity.baseQuantity !== capacityQuantity
        || capacity.quoteNotional !== capacityNotional
        || capacity.levelCount !== capacityLevelCount
      ) {
        addReason(reasons, 'VOLUME_OBSERVATION_CAPACITY_INVALID');
      }
    }
  }
  if (reasons.length > 0) {
    return Object.freeze({ semantic: null, digest: null, reasons: Object.freeze(reasons) });
  }

  const normalizedProposal = Object.freeze({
    proposalId: proposal.proposalId as string,
    proposalRevision: proposal.proposalRevision as number,
    proposalDigest: proposal.proposalDigest as string,
    configurationRevision: proposal.configurationRevision as string,
    correlationId: proposal.correlationId as string,
    symbol: proposal.symbol as string,
    direction,
    expiresAtMs: proposal.expiresAtMs as number,
  });
  const normalizedSource = Object.freeze({
    sourceId: VOLUME_PUBLIC_SOURCE_ID,
    restBaseUrl: VOLUME_PUBLIC_REST_BASE_URL,
    websocketBaseUrl: VOLUME_PUBLIC_WEBSOCKET_BASE_URL,
    authentication: 'NONE' as const,
    timeUnit: 'MILLISECOND' as const,
    generation: source.generation as number,
    revision: source.revision as number,
    continuity: source.continuity as VolumeObservationContinuity,
  });
  const normalizedAggregateTrade = Object.freeze({
    symbol: proposal.symbol as string,
    aggregateTradeId: aggregateTrade.aggregateTradeId as number,
    firstTradeId: aggregateTrade.firstTradeId as number,
    lastTradeId: aggregateTrade.lastTradeId as number,
    eventTimeMs: aggregateTrade.eventTimeMs as number,
    tradeTimeMs: aggregateTrade.tradeTimeMs as number,
    receivedAtMs: aggregateTrade.receivedAtMs as number,
  });
  const normalizedCapacity = Object.freeze({
    side,
    basis: capacityBasis,
    price: capacityPrice,
    baseQuantity: capacityQuantity,
    quoteNotional: capacityNotional,
    levelCount: capacityLevelCount,
  });
  const normalizedBook = Object.freeze({
    symbol: proposal.symbol as string,
    bidPrice,
    askPrice,
    bidQuantity,
    askQuantity,
    sourceTimeMs: null,
    receivedAtMs: book.receivedAtMs as number,
    freshnessBasis: 'RECEIVE_TIME' as const,
    numericFidelity: book.numericFidelity as VolumeObservationNumericFidelity,
    scope: book.scope as VolumeObservationBookScope,
    depth: normalizedDepth,
    capacity: normalizedCapacity,
  });
  const semantic: SemanticObservation = Object.freeze({
    proposal: normalizedProposal,
    source: normalizedSource,
    aggregateTrade: normalizedAggregateTrade,
    book: normalizedBook,
    evaluatedAtMs: root.evaluatedAtMs as number,
  });
  const expectedDigest = digestSemantic(semantic);

  if (outputMode) {
    const suppliedDigest = root.observationDigest;
    if (
      typeof suppliedDigest !== 'string'
      || !/^vobs_[0-9a-f]{64}$/.test(suppliedDigest)
      || (requireDigestMatch && suppliedDigest !== expectedDigest)
    ) {
      addReason(reasons, 'VOLUME_OBSERVATION_DIGEST_INVALID');
      return Object.freeze({ semantic: null, digest: null, reasons: Object.freeze(reasons) });
    }
  }

  return Object.freeze({ semantic, digest: expectedDigest, reasons: Object.freeze(reasons) });
}

function digestSemantic(semantic: SemanticObservation): `vobs_${string}` {
  const payload = canonicalJson({
    schemaVersion: VOLUME_STRATEGY_OBSERVATION_SCHEMA_VERSION,
    proposal: semantic.proposal,
    source: semantic.source,
    aggregateTrade: semantic.aggregateTrade,
    book: semantic.book,
    evaluatedAtMs: semantic.evaluatedAtMs,
  });
  return `vobs_${createHash('sha256').update(`volume-strategy-observation|${payload}`).digest('hex')}`;
}

function freezeObservation(
  semantic: SemanticObservation,
  digest: `vobs_${string}`,
): VolumeStrategyObservation {
  return Object.freeze({
    schemaVersion: VOLUME_STRATEGY_OBSERVATION_SCHEMA_VERSION,
    proposal: semantic.proposal,
    source: semantic.source,
    aggregateTrade: semantic.aggregateTrade,
    book: semantic.book,
    evaluatedAtMs: semantic.evaluatedAtMs,
    observationDigest: digest,
  });
}

export function buildVolumeStrategyObservation(input: unknown): VolumeStrategyObservation {
  const normalized = normalizedSemantic(input, false, false);
  if (normalized.semantic === null || normalized.digest === null) {
    throw new TypeError(
      `invalid Volume strategy observation input: ${normalized.reasons.join(',') || 'UNKNOWN'}`,
    );
  }
  return freezeObservation(normalized.semantic, normalized.digest);
}

export function inspectVolumeStrategyObservation(value: unknown): VolumeStrategyObservationInspection {
  const normalized = normalizedSemantic(value, true, true);
  if (normalized.semantic === null || normalized.digest === null) {
    return Object.freeze({
      observation: null,
      reasonCodes: Object.freeze([...normalized.reasons]),
    });
  }
  return Object.freeze({
    observation: freezeObservation(normalized.semantic, normalized.digest),
    reasonCodes: Object.freeze([]),
  });
}

export function validateVolumeStrategyObservation(value: unknown): value is VolumeStrategyObservation {
  return inspectVolumeStrategyObservation(value).observation !== null;
}

export function deriveVolumeStrategyObservationDigest(value: unknown): `vobs_${string}` {
  const normalized = normalizedSemantic(value, true, false);
  if (normalized.semantic === null || normalized.digest === null) {
    throw new TypeError(
      `cannot derive Volume strategy observation digest: ${normalized.reasons.join(',') || 'UNKNOWN'}`,
    );
  }
  return normalized.digest;
}

export function assessVolumeStrategyObservationSource(
  value: unknown,
): VolumeStrategyObservationSourceAssessment {
  const inspection = inspectVolumeStrategyObservation(value);
  if (inspection.observation === null) {
    return Object.freeze({
      accepted: false,
      reasonCodes: Object.freeze([
        'VOLUME_SOURCE_OBSERVATION_INVALID',
      ] satisfies VolumeStrategyObservationSourceRejectionCode[]),
    });
  }

  const reasons: VolumeStrategyObservationSourceRejectionCode[] = [];
  switch (inspection.observation.source.continuity) {
    case 'CONTIGUOUS':
      break;
    case 'GAP':
      reasons.push('VOLUME_SOURCE_CONTINUITY_GAP');
      break;
    case 'UNKNOWN':
      reasons.push('VOLUME_SOURCE_CONTINUITY_UNKNOWN');
      break;
    case 'RECONNECTING':
      reasons.push('VOLUME_SOURCE_RECONNECTING');
      break;
  }
  if (inspection.observation.book.numericFidelity === 'NORMALIZED_FROM_PARSED_NUMBER') {
    reasons.push('VOLUME_SOURCE_BOOK_NUMERIC_FIDELITY_NORMALIZED');
  }
  if (inspection.observation.book.scope === 'TOP_OF_BOOK') {
    reasons.push('VOLUME_SOURCE_BOOK_CAPACITY_TOP_OF_BOOK_ONLY');
  }
  return Object.freeze({
    accepted: reasons.length === 0,
    reasonCodes: Object.freeze(reasons),
  });
}

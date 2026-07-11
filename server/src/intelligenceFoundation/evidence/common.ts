import {
  makeStableFailure,
  sortedUnique,
  stableId,
  validateInstrumentIdentity,
  validateNoSecretFields,
  validateNormalizedEvidence,
  type FreshnessBasis,
  type InstrumentIdentity,
  type NormalizedEvidence,
  type SequenceRange,
  type StableFailure,
  type TruthMetadata,
} from '../contracts/index.js';
import { assessSequence } from './quality.js';
import { getBinanceSourceFact, type BinanceSourceKey } from './sourceFacts.js';
import type {
  BinanceSourceFact,
  EvidenceNormalizationFailure,
  EvidenceNormalizationResult,
  NormalizationContext,
} from './types.js';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; failure: StableFailure };

export interface PreparedContext {
  context: NormalizationContext;
  sourceKey: BinanceSourceKey;
  fact: BinanceSourceFact;
  instrument: InstrumentIdentity;
  maximumFutureSkewMs: number;
}

export interface EvidenceDraft<T extends NormalizedEvidence> {
  value: Omit<T, 'id' | 'instrument' | 'truth'>;
  sourceRecordIds: string[];
  sourceSet?: string[];
  transform: string;
  sourceEventTimeMs: number | null;
  sourceTransactionTimeMs: number | null;
  sequence: SequenceRange | null;
  observedFields: string[];
  missingFields?: string[];
  reasonCodes?: string[];
  freshnessBasis?: FreshnessBasis;
  /** Conservative dependency receipt time for a derived multi-source composite. */
  receivedTimeMs?: number;
  sequenceSemantics?: 'CONTIGUOUS' | 'MONOTONIC_CURSOR';
}

export function objectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function failureResult(...failures: StableFailure[]): EvidenceNormalizationFailure {
  const unique = new Map(failures.map((failure) => [failure.id, failure]));
  return { ok: false, failures: [...unique.values()].sort((left, right) => left.id.localeCompare(right.id)) };
}

export function prepareRecord(value: unknown, component: string): ParseResult<Record<string, unknown>> {
  const secret = validateNoSecretFields(value, component);
  if (!secret.ok) return { ok: false, failure: secret.failure };
  if (!objectRecord(value)) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'injected source record must be an object', null) };
  }
  return { ok: true, value };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function prepareContext(
  value: unknown,
  allowedSourceKeys: readonly BinanceSourceKey[],
  component: string,
): ParseResult<PreparedContext> {
  const secret = validateNoSecretFields(value, component);
  if (!secret.ok) return { ok: false, failure: secret.failure };
  if (!objectRecord(value)) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'normalization context must be an object', null) };
  }
  const fact = getBinanceSourceFact(value.sourceKey);
  if (!fact || !nonEmptyString(value.sourceId)) {
    return { ok: false, failure: makeStableFailure('MISSING_SOURCE', component, 'a known source key and source identity are required', 'sourceKey') };
  }
  const sourceKey = value.sourceKey as BinanceSourceKey;
  if (value.sourceId !== fact.sourceId) {
    return { ok: false, failure: makeStableFailure('MISSING_SOURCE', component, 'declared source identity does not match the source catalog', 'sourceId') };
  }
  if (value.endpointClass !== fact.endpointClass) {
    return { ok: false, failure: makeStableFailure('WRONG_ENDPOINT_CLASS', component, 'declared endpoint class does not match the source catalog', 'endpointClass') };
  }
  if (!allowedSourceKeys.includes(sourceKey)) {
    return { ok: false, failure: makeStableFailure('INVALID_VARIANT', component, 'source does not emit this evidence family', 'sourceKey') };
  }
  if (!objectRecord(value.instrument)) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'instrument seed is required', 'instrument') };
  }
  const seed = value.instrument;
  if (seed.productFamily === 'COIN_M_PERPETUAL') {
    return { ok: false, failure: makeStableFailure('UNAVAILABLE', component, 'COIN-M normalization is outside this sprint because stream q is contract quantity', 'instrument.productFamily') };
  }
  if (fact.productFamily !== 'ANY' && seed.productFamily !== fact.productFamily) {
    return { ok: false, failure: makeStableFailure('INVALID_VARIANT', component, 'source product family does not match the instrument', 'instrument.productFamily') };
  }
  if (sourceKey !== 'CONTEXT_INJECTED' && seed.venue !== undefined && seed.venue !== 'BINANCE') {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'Binance source evidence requires a Binance instrument venue', 'instrument.venue') };
  }
  if (
    !nonEmptyString(seed.symbol) || !nonEmptyString(seed.baseAsset) ||
    !(seed.pair === null || nonEmptyString(seed.pair)) || !(seed.quoteAsset === null || nonEmptyString(seed.quoteAsset)) ||
    !(seed.contractType === undefined || seed.contractType === null || nonEmptyString(seed.contractType)) ||
    !(seed.venue === undefined || ['BINANCE', 'OTHER', 'UNKNOWN'].includes(String(seed.venue)))
  ) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'invalid instrument seed', 'instrument') };
  }
  if (seed.productFamily === 'BORROW' && (seed.pair !== null || seed.quoteAsset !== null)) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'asset-level borrow identity cannot invent a pair or quote asset', 'instrument.quoteAsset') };
  }
  if (seed.productFamily === 'USD_M_PERPETUAL' && ![undefined, null, 'PERPETUAL'].includes(seed.contractType as string | null | undefined)) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'USD-M perpetual evidence requires PERPETUAL contract type', 'instrument.contractType') };
  }
  if (seed.productFamily === 'SPOT' && seed.contractType !== undefined && seed.contractType !== null) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'Spot evidence cannot declare a derivative contract type', 'instrument.contractType') };
  }
  if (!safeTime(value.receivedTimeMs) || !safeTime(value.evaluatedAtMs) || value.evaluatedAtMs < value.receivedTimeMs) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'evaluation and receive times must be ordered safe integers', 'receivedTimeMs') };
  }
  if (typeof value.maxAgeMs !== 'number' || !Number.isFinite(value.maxAgeMs) || value.maxAgeMs < 0) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'maxAgeMs must be a finite non-negative number', 'maxAgeMs') };
  }
  const maximumFutureSkewMs = value.maximumFutureSkewMs === undefined ? 2_000 : value.maximumFutureSkewMs;
  if (typeof maximumFutureSkewMs !== 'number' || !Number.isFinite(maximumFutureSkewMs) || maximumFutureSkewMs < 0) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'maximumFutureSkewMs must be finite and non-negative', 'maximumFutureSkewMs') };
  }
  for (const field of ['schemaVersion', 'producerVersion', 'configurationVersion'] as const) {
    if (value[field] !== undefined && !nonEmptyString(value[field])) {
      return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, `${field} must be a non-empty string`, field) };
    }
  }
  if (value.previousSequence !== undefined && value.previousSequence !== null) {
    if (
      !objectRecord(value.previousSequence) || typeof value.previousSequence.last !== 'string' || !/^\d+$/.test(value.previousSequence.last) ||
      !(value.previousSequence.recentSourceRecordIds === undefined || Array.isArray(value.previousSequence.recentSourceRecordIds) && value.previousSequence.recentSourceRecordIds.every((entry) => typeof entry === 'string'))
    ) {
      return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'previousSequence must use decimal-string identity', 'previousSequence') };
    }
  }

  const productFamily = seed.productFamily as InstrumentIdentity['productFamily'];
  const instrumentCandidate: InstrumentIdentity = {
    instrumentId: '',
    venue: (seed.venue ?? 'BINANCE') as InstrumentIdentity['venue'],
    productFamily,
    symbol: seed.symbol as string,
    pair: seed.pair as string | null,
    baseAsset: seed.baseAsset as string,
    quoteAsset: seed.quoteAsset as string | null,
    contractType: (seed.contractType ?? (productFamily === 'USD_M_PERPETUAL' ? 'PERPETUAL' : null)) as string | null,
    sourceMarketType: productFamily === 'USD_M_PERPETUAL' ? 1 : null,
  };
  instrumentCandidate.instrumentId = stableId('instrument', {
    venue: instrumentCandidate.venue,
    productFamily: instrumentCandidate.productFamily,
    symbol: instrumentCandidate.symbol,
    pair: instrumentCandidate.pair,
    baseAsset: instrumentCandidate.baseAsset,
    quoteAsset: instrumentCandidate.quoteAsset,
    contractType: instrumentCandidate.contractType,
    sourceMarketType: instrumentCandidate.sourceMarketType,
  });
  const instrument = validateInstrumentIdentity(instrumentCandidate);
  if (!instrument.ok) return { ok: false, failure: instrument.failure };

  return {
    ok: true,
    value: {
      context: value as unknown as NormalizationContext,
      sourceKey,
      fact,
      instrument: instrument.value,
      maximumFutureSkewMs,
    },
  };
}

export function parseString(value: unknown, field: string, component: string): ParseResult<string> {
  if (value === undefined || value === null) {
    return { ok: false, failure: makeStableFailure('INCOMPLETE_EVIDENCE', component, 'required source field is missing', field) };
  }
  if (!nonEmptyString(value)) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'source field must be a non-empty string', field) };
  }
  return { ok: true, value };
}

export function parseBoolean(value: unknown, field: string, component: string): ParseResult<boolean> {
  if (value === undefined || value === null) {
    return { ok: false, failure: makeStableFailure('INCOMPLETE_EVIDENCE', component, 'required source field is missing', field) };
  }
  if (typeof value !== 'boolean') {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'source field must be boolean', field) };
  }
  return { ok: true, value };
}

export function parseDecimal(
  value: unknown,
  field: string,
  component: string,
  constraint: 'FINITE' | 'NON_NEGATIVE' | 'POSITIVE' = 'FINITE',
): ParseResult<number> {
  if (value === undefined || value === null || value === '') {
    return { ok: false, failure: makeStableFailure('INCOMPLETE_EVIDENCE', component, 'required source field is missing', field) };
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'source numeric field must be a number or decimal string', field) };
  }
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'source numeric field is malformed', field) };
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  const valid = Number.isFinite(parsed) &&
    (constraint === 'FINITE' || constraint === 'NON_NEGATIVE' && parsed >= 0 || constraint === 'POSITIVE' && parsed > 0);
  if (!valid) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, `source numeric field must be ${constraint.toLowerCase()}`, field) };
  }
  return { ok: true, value: Object.is(parsed, -0) ? 0 : parsed };
}

export function parseIdentifier(value: unknown, field: string, component: string): ParseResult<string> {
  if (value === undefined || value === null || value === '') {
    return { ok: false, failure: makeStableFailure('INCOMPLETE_EVIDENCE', component, 'required source identifier is missing', field) };
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return { ok: true, value };
  if (Number.isSafeInteger(value) && (value as number) >= 0) return { ok: true, value: String(value) };
  return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'source identifier must be a decimal string or safe integer', field) };
}

export function parseTimestamp(value: unknown, field: string, component: string): ParseResult<number> {
  if (value === undefined || value === null) {
    return { ok: false, failure: makeStableFailure('INCOMPLETE_EVIDENCE', component, 'required source timestamp is missing', field) };
  }
  if (!safeTime(value)) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', component, 'source timestamp must be a non-negative safe integer', field) };
  }
  return { ok: true, value };
}

export function verifySymbol(record: Record<string, unknown>, prepared: PreparedContext, component: string): StableFailure | null {
  const rawSymbol = record.s ?? record.symbol;
  if (rawSymbol === undefined) return null;
  if (rawSymbol !== prepared.instrument.symbol) {
    return makeStableFailure('INVALID_VALUE', component, 'source symbol does not match the instrument seed', 'symbol');
  }
  return null;
}

export function verifyUsdMStreamType(record: Record<string, unknown>, component: string): StableFailure | null {
  if (record.st === 2) {
    return makeStableFailure('UNAVAILABLE', component, 'COIN-M merged stream record is unsupported because q is contract quantity', 'st');
  }
  if (record.st === undefined || record.st === null) {
    return makeStableFailure('INCOMPLETE_EVIDENCE', component, 'merged Futures stream record is missing source market type st', 'st');
  }
  if (record.st !== 1) return makeStableFailure('INVALID_VALUE', component, 'source market type st must be 1 for USD-M', 'st');
  return null;
}

export function sourceRecordId(sourceKey: BinanceSourceKey, naturalIdentity: unknown): string {
  return stableId('source-record', { sourceKey, naturalIdentity });
}

function freshnessBasisTime(
  basis: FreshnessBasis,
  sourceEventTimeMs: number | null,
  sourceTransactionTimeMs: number | null,
  receivedTimeMs: number,
): number | null {
  if (basis === 'SOURCE_EVENT_TIME') return sourceEventTimeMs;
  if (basis === 'SOURCE_TRANSACTION_TIME') return sourceTransactionTimeMs;
  if (basis === 'RECEIVE_TIME') return receivedTimeMs;
  return null;
}

export function finalizeEvidence<T extends NormalizedEvidence>(
  prepared: PreparedContext,
  draft: EvidenceDraft<T>,
  component: string,
): EvidenceNormalizationResult<T> {
  const { context, fact } = prepared;
  const sourceTimes = [draft.sourceEventTimeMs, draft.sourceTransactionTimeMs].filter((value): value is number => value !== null);
  if (sourceTimes.some((time) => time > context.receivedTimeMs + prepared.maximumFutureSkewMs || time > context.evaluatedAtMs)) {
    return failureResult(makeStableFailure('TIMESTAMP_SKEW', component, 'source timestamp is implausibly ahead of receipt or evaluation', 'temporal'));
  }
  if (
    draft.sourceEventTimeMs !== null && draft.sourceTransactionTimeMs !== null &&
    draft.sourceTransactionTimeMs > draft.sourceEventTimeMs + prepared.maximumFutureSkewMs
  ) {
    return failureResult(makeStableFailure('TIMESTAMP_SKEW', component, 'source transaction time is implausibly ahead of event time', 'temporal.sourceTransactionTimeMs'));
  }

  const recordIds = sortedUnique(draft.sourceRecordIds);
  const id = stableId('evidence', {
    kind: draft.value.kind,
    instrumentId: prepared.instrument.instrumentId,
    sourceId: fact.sourceId,
    sourceRecordIds: recordIds,
  });
  const qualityFailures: StableFailure[] = [];
  const missingFields = [...(draft.missingFields ?? [])];
  const reasonCodes = [...(draft.reasonCodes ?? [])];
  if (draft.sequence !== null) {
    const sequence = assessSequence(
      draft.sequence,
      context.previousSequence,
      recordIds[0] ?? id,
      component,
      draft.sequenceSemantics,
    );
    if (sequence.state === 'DUPLICATE' || sequence.state === 'OUT_OF_ORDER') return failureResult(sequence.failure);
    if (sequence.state === 'GAP') {
      qualityFailures.push(sequence.failure);
      missingFields.push('sequence.continuity');
      reasonCodes.push('SEQUENCE_GAP');
    }
  }

  const receivedTimeMs = draft.receivedTimeMs ?? context.receivedTimeMs;
  if (!Number.isSafeInteger(receivedTimeMs) || receivedTimeMs < 0 || receivedTimeMs > context.evaluatedAtMs) {
    return failureResult(makeStableFailure('INVALID_VALUE', component, 'derived receipt time must be an ordered safe integer', 'truth.temporal.receivedTimeMs'));
  }
  const basis = draft.freshnessBasis ?? fact.freshnessBasis;
  const basisTime = freshnessBasisTime(basis, draft.sourceEventTimeMs, draft.sourceTransactionTimeMs, receivedTimeMs);
  if (basisTime === null) {
    return failureResult(makeStableFailure('INCOMPLETE_EVIDENCE', component, 'freshness basis timestamp is missing', 'truth.freshness.basis'));
  }
  const ageMs = context.evaluatedAtMs - basisTime;
  const freshnessState = ageMs > context.maxAgeMs ? 'STALE' : 'FRESH';
  if (freshnessState === 'STALE') {
    qualityFailures.push(makeStableFailure('STALE_SOURCE', component, 'source evidence exceeded its declared maximum age', 'truth.freshness', [id]));
  }
  const normalizedMissing = sortedUnique(missingFields);
  if (normalizedMissing.length > 0) {
    reasonCodes.push('INCOMPLETE_EVIDENCE');
    qualityFailures.push(makeStableFailure('INCOMPLETE_EVIDENCE', component, 'optional source fields are missing or sequence continuity is incomplete', 'truth.completeness', [id]));
  }

  const authorityKind = prepared.sourceKey === 'CONTEXT_INJECTED'
    ? 'CONTEXTUAL'
    : prepared.sourceKey === 'MARGIN_BORROW_COMPOSITE'
      ? 'EXCHANGE_DERIVED'
      : 'EXCHANGE_PRIMARY';
  const truth: TruthMetadata = {
    schemaVersion: context.schemaVersion ?? '1',
    producerVersion: context.producerVersion ?? 'evidence-normalizer-1',
    configurationVersion: context.configurationVersion ?? 'evidence-default-1',
    featureVersion: null,
    authority: { kind: authorityKind, sourceId: fact.sourceId, dataset: fact.dataset, endpointClass: fact.endpointClass },
    provenance: {
      sourceRecordIds: recordIds,
      sourceSet: sortedUnique([fact.sourceId, ...(draft.sourceSet ?? [])]),
      transforms: [draft.transform],
    },
    temporal: {
      sourceEventTimeMs: draft.sourceEventTimeMs,
      sourceTransactionTimeMs: draft.sourceTransactionTimeMs,
      receivedTimeMs,
      sequence: draft.sequence,
    },
    freshness: {
      basis,
      evaluatedAtMs: context.evaluatedAtMs,
      ageMs,
      maxAgeMs: context.maxAgeMs,
      state: freshnessState,
    },
    completeness: {
      state: normalizedMissing.length === 0 ? 'COMPLETE' : 'PARTIAL',
      observedFields: sortedUnique(draft.observedFields),
      missingFields: normalizedMissing,
      reasonCodes: sortedUnique(reasonCodes),
    },
  };
  const candidate = { id, instrument: prepared.instrument, truth, ...draft.value } as unknown as T;
  const validated = validateNormalizedEvidence(candidate);
  if (!validated.ok) return failureResult(validated.failure);
  const uniqueQuality = new Map(qualityFailures.map((failure) => [failure.id, failure]));
  return {
    ok: true,
    value: validated.value as T,
    qualityFailures: [...uniqueQuality.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

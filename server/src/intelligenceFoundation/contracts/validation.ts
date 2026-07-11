import {
  COMPLETENESS_STATES,
  EVIDENCE_KINDS,
  EVIDENCE_POLARITIES,
  FAILURE_CODES,
  FRESHNESS_BASES,
  FRESHNESS_STATES,
  MARKET_STAGES,
  PRODUCT_FAMILIES,
  SOURCE_AUTHORITIES,
  SOURCE_ENDPOINT_CLASSES,
} from './constants.js';
import { stableId } from './ids.js';
import type {
  InstrumentIdentity,
  NormalizedEvidence,
  StableFailure,
  TruthMetadata,
  ValidationResult,
} from './types.js';

const FORBIDDEN_SECRET_KEY = /^(?:api[_-]?(?:key|secret)|secret|signature|authorization|password|passphrase|private[_-]?key|cookie|credentials?|access[_-]?token|refresh[_-]?token|session[_-]?token|aws[_-]?(?:secret|access[_-]?key))$/i;

const has = <T extends readonly string[]>(values: T, value: unknown): value is T[number] =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

function failure(
  code: StableFailure['code'],
  component: string,
  message: string,
  field: string | null,
  evidenceIds: string[] = [],
): StableFailure {
  const semantic = { code, component, message, field, evidenceIds: [...evidenceIds].sort() };
  return {
    id: stableId('failure', semantic),
    code,
    component,
    message,
    retryable: ['MISSING_SOURCE', 'STALE_SOURCE', 'WRONG_ENDPOINT_CLASS', 'SEQUENCE_GAP', 'BUDGET_EXHAUSTED', 'UNAVAILABLE'].includes(code),
    field,
    evidenceIds: semantic.evidenceIds,
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegativeTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function nullablePositive(value: unknown): boolean {
  return value === null || positive(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function findForbiddenSecretField(value: unknown): string | null {
  const seen = new Set<object>();
  let visited = 0;
  const walk = (entry: unknown, path: string, depth: number): string | null => {
    if (depth > 32 || ++visited > 50_000) return `${path}.[structure_limit]`;
    if (entry === null || typeof entry !== 'object') return null;
    if (seen.has(entry)) return `${path}.[cycle]`;
    seen.add(entry);
    if (Array.isArray(entry)) {
      for (let index = 0; index < entry.length; index += 1) {
        const found = walk(entry[index], `${path}[${index}]`, depth + 1);
        if (found) return found;
      }
      return null;
    }
    for (const [key, child] of Object.entries(entry as Record<string, unknown>)) {
      const next = `${path}.${key}`;
      if (FORBIDDEN_SECRET_KEY.test(key)) return next;
      const found = walk(child, next, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(value, '$', 0);
}

export function validateNoSecretFields(value: unknown, component = 'contracts'): ValidationResult<unknown> {
  const field = findForbiddenSecretField(value);
  if (field) {
    return { ok: false, failure: failure('SECRET_FIELD_REJECTED', component, 'forbidden secret-bearing field rejected', field) };
  }
  return { ok: true, value };
}

export function validateTruthMetadata(value: unknown): ValidationResult<TruthMetadata> {
  const secret = validateNoSecretFields(value, 'truth_metadata');
  if (!secret.ok) return secret as ValidationResult<TruthMetadata>;
  if (!object(value)) return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'truth metadata must be an object', null) };
  const authority = value.authority;
  const provenance = value.provenance;
  const temporal = value.temporal;
  const freshness = value.freshness;
  const completeness = value.completeness;
  if (
    typeof value.schemaVersion !== 'string' ||
    typeof value.producerVersion !== 'string' ||
    typeof value.configurationVersion !== 'string' ||
    !(value.featureVersion === null || typeof value.featureVersion === 'string') ||
    !object(authority) ||
    !has(SOURCE_AUTHORITIES, authority.kind) ||
    typeof authority.sourceId !== 'string' ||
    typeof authority.dataset !== 'string' ||
    !has(SOURCE_ENDPOINT_CLASSES, authority.endpointClass)
  ) return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'invalid authority or version metadata', 'authority') };
  if (!object(provenance) || !stringArray(provenance.sourceRecordIds) || !stringArray(provenance.sourceSet) || !stringArray(provenance.transforms)) {
    return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'invalid provenance', 'provenance') };
  }
  if (!object(temporal) || !nonNegativeTime(temporal.receivedTimeMs)) {
    return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'received time must be a non-negative safe integer', 'temporal.receivedTimeMs') };
  }
  for (const key of ['sourceEventTimeMs', 'sourceTransactionTimeMs'] as const) {
    if (!(temporal[key] === null || nonNegativeTime(temporal[key]))) {
      return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'source timestamps must be null or non-negative safe integers', `temporal.${key}`) };
    }
  }
  if (temporal.sequence !== null) {
    if (!object(temporal.sequence) || typeof temporal.sequence.first !== 'string' || typeof temporal.sequence.last !== 'string' || !(temporal.sequence.previous === null || typeof temporal.sequence.previous === 'string')) {
      return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'sequence identifiers must be decimal strings', 'temporal.sequence') };
    }
    const sequence = temporal.sequence as { first: string; last: string; previous: string | null };
    for (const key of ['first', 'last'] as const) {
      if (!/^\d+$/.test(sequence[key])) return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'sequence identifiers must be decimal strings', `temporal.sequence.${key}`) };
    }
    if (sequence.previous !== null && !/^\d+$/.test(sequence.previous)) {
      return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'previous sequence must be a decimal string', 'temporal.sequence.previous') };
    }
  }
  if (
    !object(freshness) || !has(FRESHNESS_BASES, freshness.basis) || !has(FRESHNESS_STATES, freshness.state) ||
    !nonNegativeTime(freshness.evaluatedAtMs) || !(freshness.ageMs === null || finite(freshness.ageMs) && freshness.ageMs >= 0) ||
    !(freshness.maxAgeMs === null || finite(freshness.maxAgeMs) && freshness.maxAgeMs >= 0)
  ) return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'invalid freshness metadata', 'freshness') };
  if (
    !object(completeness) || !has(COMPLETENESS_STATES, completeness.state) ||
    !stringArray(completeness.observedFields) || !stringArray(completeness.missingFields) || !stringArray(completeness.reasonCodes)
  ) return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'invalid completeness metadata', 'completeness') };
  return { ok: true, value: value as unknown as TruthMetadata };
}

export function validateInstrumentIdentity(value: unknown): ValidationResult<InstrumentIdentity> {
  const secret = validateNoSecretFields(value, 'instrument_identity');
  if (!secret.ok) return secret as ValidationResult<InstrumentIdentity>;
  if (!object(value)) return { ok: false, failure: failure('INVALID_VALUE', 'instrument_identity', 'instrument identity must be an object', null) };
  if (
    typeof value.instrumentId !== 'string' || !['BINANCE', 'OTHER', 'UNKNOWN'].includes(String(value.venue)) ||
    !has(PRODUCT_FAMILIES, value.productFamily) || typeof value.symbol !== 'string' ||
    !(value.pair === null || typeof value.pair === 'string') || typeof value.baseAsset !== 'string' ||
    typeof value.quoteAsset !== 'string' || !(value.contractType === null || typeof value.contractType === 'string') ||
    !(value.sourceMarketType === null || value.sourceMarketType === 1 || value.sourceMarketType === 2)
  ) return { ok: false, failure: failure('INVALID_VALUE', 'instrument_identity', 'invalid instrument identity', null) };
  return { ok: true, value: value as unknown as InstrumentIdentity };
}

function validateLevels(value: unknown): boolean {
  return Array.isArray(value) && value.every((level) => object(level) && positive(level.price) && finite(level.baseQuantity) && level.baseQuantity >= 0);
}

export function validateNormalizedEvidence(value: unknown): ValidationResult<NormalizedEvidence> {
  const secret = validateNoSecretFields(value, 'normalized_evidence');
  if (!secret.ok) return secret as ValidationResult<NormalizedEvidence>;
  if (!object(value) || !has(EVIDENCE_KINDS, value.kind)) {
    return { ok: false, failure: failure('INVALID_VARIANT', 'normalized_evidence', 'unknown evidence variant', 'kind') };
  }
  if (typeof value.id !== 'string') return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'evidence id is required', 'id') };
  const instrument = validateInstrumentIdentity(value.instrument);
  if (!instrument.ok) return instrument as ValidationResult<NormalizedEvidence>;
  const truth = validateTruthMetadata(value.truth);
  if (!truth.ok) return truth as ValidationResult<NormalizedEvidence>;
  switch (value.kind) {
    case 'TRADE':
      if (!positive(value.price) || !positive(value.baseQuantity) || !positive(value.quoteQuantity) || !nullablePositive(value.normalQuoteQuantityExcludingRpi) || !['BUY', 'SELL', 'UNKNOWN'].includes(String(value.aggressorSide))) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid trade values', null) };
      }
      break;
    case 'BOOK_TICKER':
      if (!positive(value.bidPrice) || !positive(value.askPrice) || !positive(value.bidQuantity) || !positive(value.askQuantity)) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid book ticker values', null) };
      }
      if (value.bidPrice >= value.askPrice) return { ok: false, failure: failure('CROSSED_BOOK', 'normalized_evidence', 'best bid must be below best ask', null, [value.id]) };
      break;
    case 'DEPTH_SNAPSHOT':
    case 'DEPTH_DELTA':
      if (!validateLevels(value.bids) || !validateLevels(value.asks) || !['STANDARD_NO_RPI', 'RPI_INCLUDED', 'UNKNOWN'].includes(String(value.bookScope))) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid depth values', null) };
      }
      break;
    case 'MARK_PRICE':
      if (!positive(value.markPrice) || !nullablePositive(value.indexPrice) || !nullablePositive(value.estimatedSettlementPrice) || !nullablePositive(value.movingAverageMarkPrice)) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid mark-price values', null) };
      }
      break;
    case 'FUNDING':
      if (!finite(value.fundingRate) || !(value.fundingIntervalHours === null || positive(value.fundingIntervalHours)) || !(value.nextFundingTimeMs === null || nonNegativeTime(value.nextFundingTimeMs))) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid funding values', null) };
      }
      break;
    case 'OPEN_INTEREST':
      if (![value.openInterestBase, value.openInterestQuoteValue, value.changeBase, value.changeQuoteValue].every((entry) => entry === null || finite(entry))) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid open-interest values', null) };
      }
      break;
    case 'LIQUIDATION':
      if (!['BUY', 'SELL'].includes(String(value.side)) || !positive(value.originalQuantity) || !finite(value.filledQuantity) || value.filledQuantity < 0 || typeof value.sampledLatestPerWindow !== 'boolean') {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid liquidation values', null) };
      }
      break;
    case 'BORROW':
      if (typeof value.asset !== 'string' || !['ELIGIBLE', 'INELIGIBLE', 'UNKNOWN'].includes(String(value.eligibility)) || !['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'].includes(String(value.availability))) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid borrow values', null) };
      }
      break;
    case 'CONTEXT':
      if (typeof value.contextType !== 'string' || !['SYMBOL', 'SECTOR', 'MARKET', 'VENUE'].includes(String(value.scope)) || !object(value.values)) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid context values', null) };
      }
      break;
    default: {
      const exhaustive: never = value.kind;
      return { ok: false, failure: failure('INVALID_VARIANT', 'normalized_evidence', `unknown evidence variant ${String(exhaustive)}`, 'kind') };
    }
  }
  return { ok: true, value: value as unknown as NormalizedEvidence };
}

export function isMarketStage(value: unknown): boolean {
  return has(MARKET_STAGES, value);
}

export function isEvidencePolarity(value: unknown): boolean {
  return has(EVIDENCE_POLARITIES, value);
}

export function isFailureCode(value: unknown): boolean {
  return has(FAILURE_CODES, value);
}

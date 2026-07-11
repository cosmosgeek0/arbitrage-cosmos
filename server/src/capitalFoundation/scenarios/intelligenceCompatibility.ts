import { validateTruthMetadata } from '../../intelligenceFoundation/contracts/index.js';
import type {
  EvidenceKind,
  TruthMetadata as IntelligenceTruthMetadata,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  IntelligenceEvidenceReference,
  IntelligenceThesisReference,
} from '../contracts/index.js';
import type {
  MarketIntelligenceEvidenceCompatibilityView,
  MarketIntelligenceThesisCompatibilityView,
} from './types.js';

/**
 * Numeric facts exposed by each upstream evidence variant. Capital
 * Supervision records their omission by path and never reads their values.
 */
const OMITTED_EVIDENCE_NUMERICS: Readonly<Record<EvidenceKind, readonly string[]>> = Object.freeze({
  TRADE: Object.freeze([
    'baseQuantity',
    'normalBaseQuantityExcludingRpi',
    'price',
    'quoteQuantity',
  ]),
  BOOK_TICKER: Object.freeze([
    'askPrice',
    'askQuantity',
    'bidPrice',
    'bidQuantity',
  ]),
  DEPTH_SNAPSHOT: Object.freeze([
    'asks[].baseQuantity',
    'asks[].price',
    'bids[].baseQuantity',
    'bids[].price',
    'maximumLevelsKnown',
  ]),
  DEPTH_DELTA: Object.freeze([
    'asks[].baseQuantity',
    'asks[].price',
    'bids[].baseQuantity',
    'bids[].price',
    'maximumLevelsKnown',
  ]),
  MARK_PRICE: Object.freeze([
    'estimatedSettlementPrice',
    'indexPrice',
    'markPrice',
    'movingAverageMarkPrice',
  ]),
  FUNDING: Object.freeze([
    'adjustedRateCap',
    'adjustedRateFloor',
    'fundingIntervalHours',
    'fundingRate',
    'nextFundingTimeMs',
  ]),
  OPEN_INTEREST: Object.freeze([
    'changeBase',
    'changeQuoteValue',
    'comparisonWindowMs',
    'openInterestBase',
    'openInterestQuoteValue',
  ]),
  LIQUIDATION: Object.freeze([
    'averagePrice',
    'filledQuantity',
    'originalQuantity',
    'sampleWindowMs',
  ]),
  BORROW: Object.freeze([
    'accountBorrowLimit',
    'hourlyInterestRateDecimal',
    'inventoryAmount',
    'systemAvailableAmount',
  ]),
  CONTEXT: Object.freeze(['values.*']),
});

const OMITTED_THESIS_NUMERICS = Object.freeze([
  'changedAtMs',
  'conflicting[].observationEndMs',
  'conflicting[].observationStartMs',
  'neutral[].observationEndMs',
  'neutral[].observationStartMs',
  'supporting[].observationEndMs',
  'supporting[].observationStartMs',
  'unavailable[].observationEndMs',
  'unavailable[].observationStartMs',
]);

const THESIS_LEAD_MARKETS = Object.freeze(['SPOT', 'PERPETUAL', 'NEITHER', 'UNKNOWN'] as const);
const THESIS_TRADEABILITY = Object.freeze(['SUPPORTED', 'BLOCKED', 'UNKNOWN'] as const);

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim() === value
    && value.length > 0
    && value.length <= 512;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  for (const value of values) {
    if (!nonEmpty(value)) throw new TypeError('Market Intelligence references require non-empty strings');
  }
  return Object.freeze([...new Set(values)].sort());
}

function cloneAndFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (value === null || typeof value !== 'object') return value as Readonly<T>;
  if (seen.has(value)) throw new TypeError('Market Intelligence reference cannot contain cycles');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Market Intelligence reference requires plain data');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const output = value.map((entry) => cloneAndFreeze(entry, seen));
    seen.delete(value);
    return Object.freeze(output) as unknown as Readonly<T>;
  }
  const output: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError('Market Intelligence reference rejects symbol keys');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError('Market Intelligence reference rejects accessors and non-data fields');
    }
    if (descriptor.value === undefined) throw new TypeError('Market Intelligence reference rejects undefined values');
    output[key] = cloneAndFreeze(descriptor.value, seen);
  }
  seen.delete(value);
  return Object.freeze(output) as Readonly<T>;
}

function cloneTruth(
  truth: Readonly<IntelligenceTruthMetadata>,
): Readonly<IntelligenceTruthMetadata> {
  const validated = validateTruthMetadata(truth);
  if (!validated.ok) {
    const field = validated.failure.field === null ? 'truth' : validated.failure.field;
    throw new TypeError(
      `Market Intelligence truth metadata invalid at ${field}: ${validated.failure.code}: ${validated.failure.message}`,
    );
  }
  return cloneAndFreeze(validated.value);
}

/**
 * Projects only evidence identity and truth. Every upstream numeric fact is
 * explicitly reported as omitted and no financial fact is promoted as exact.
 */
export function adaptMarketIntelligenceEvidenceReference(
  input: Readonly<MarketIntelligenceEvidenceCompatibilityView>,
): Readonly<IntelligenceEvidenceReference> {
  if (!input || !nonEmpty(input.id) || !nonEmpty(input.instrument?.instrumentId)) {
    throw new TypeError('Market Intelligence evidence requires stable evidence and instrument IDs');
  }
  const omitted = OMITTED_EVIDENCE_NUMERICS[input.kind];
  if (omitted === undefined) throw new TypeError('unsupported Market Intelligence evidence kind');
  return cloneAndFreeze({
    evidenceId: input.id,
    kind: input.kind,
    instrumentId: input.instrument.instrumentId,
    truth: cloneTruth(input.truth),
    exactFinancialFactIds: Object.freeze([] as string[]),
    omittedNumericFields: sortedUnique(omitted),
  });
}

/**
 * Projects thesis identity, fact identities, tradeability, and truth without
 * copying Market Intelligence's numeric observations or reclassifying facts.
 */
export function adaptMarketIntelligenceThesisReference(
  input: Readonly<MarketIntelligenceThesisCompatibilityView>,
): Readonly<IntelligenceThesisReference> {
  if (!input || !nonEmpty(input.id)
    || !nonEmpty(input.instrumentId)
    || !nonEmpty(input.hypothesis)
    || !nonEmpty(input.stage)) {
    throw new TypeError('Market Intelligence thesis requires stable identity and classification');
  }
  if (!(THESIS_LEAD_MARKETS as readonly string[]).includes(input.leadMarket)
    || !(THESIS_TRADEABILITY as readonly string[]).includes(input.tradeability?.state)) {
    throw new TypeError('Market Intelligence thesis has invalid leadership or tradeability vocabulary');
  }
  if (!Array.isArray(input.supporting)
    || !Array.isArray(input.conflicting)
    || !Array.isArray(input.neutral)
    || !Array.isArray(input.unavailable)
    || !Array.isArray(input.reasonCodes)
    || !input.tradeability
    || !Array.isArray(input.tradeability.reasonCodes)) {
    throw new TypeError('Market Intelligence thesis requires complete reference arrays');
  }
  const factIds = (facts: readonly { readonly id: string }[]): readonly string[] =>
    sortedUnique(facts.map((fact) => fact.id));
  return cloneAndFreeze({
    thesisPacketId: input.id,
    instrumentId: input.instrumentId,
    hypothesis: input.hypothesis,
    stage: input.stage,
    leadMarket: input.leadMarket,
    supportingFactIds: factIds(input.supporting),
    conflictingFactIds: factIds(input.conflicting),
    unavailableFactIds: factIds(input.unavailable),
    tradeability: input.tradeability.state,
    reasonCodes: sortedUnique([
      ...input.reasonCodes,
      ...input.tradeability.reasonCodes,
      ...(input.neutral.length > 0
        ? ['CAPITAL_COMPAT_NEUTRAL_FACT_IDENTITIES_OMITTED']
        : []),
    ]),
    truth: cloneTruth(input.truth),
    omittedNumericFields: sortedUnique(OMITTED_THESIS_NUMERICS),
  });
}

import {
  evaluateFreshness,
  isDataAuthority,
  validateSourcedTimestamp,
  type DataAuthority,
  type SourcedTimestamp,
} from '../../foundation/contracts/index.js';
import {
  isExactDecimal,
  normalizeExactDecimal,
  type ExactDecimal,
} from './decimal.js';
import { capitalDigest } from './identity.js';
import type { CapitalTruthState } from './truth.js';

export const CONSERVATIVE_ECONOMIC_FACT_SCHEMA =
  'capital.conservative-economic-fact.v1' as const;

export const CONSERVATIVE_ECONOMIC_FACT_KINDS = Object.freeze([
  'FUNDING',
  'BORROW',
  'CAPITAL_OPPORTUNITY',
] as const);
export type ConservativeEconomicFactKind =
  (typeof CONSERVATIVE_ECONOMIC_FACT_KINDS)[number];

export const CONSERVATIVE_ECONOMIC_FACT_OWNERS = Object.freeze([
  'BASIS_ENGINE',
  'FOUNDATION_BORROW_TRUTH',
  'CAPITAL_FOUNDATION',
] as const);
export type ConservativeEconomicFactOwner =
  (typeof CONSERVATIVE_ECONOMIC_FACT_OWNERS)[number];

const OWNER_BY_KIND: Readonly<Record<
  ConservativeEconomicFactKind,
  ConservativeEconomicFactOwner
>> = Object.freeze({
  FUNDING: 'BASIS_ENGINE',
  BORROW: 'FOUNDATION_BORROW_TRUTH',
  CAPITAL_OPPORTUNITY: 'CAPITAL_FOUNDATION',
});

const AUTHORITIES_BY_KIND: Readonly<Record<
  ConservativeEconomicFactKind,
  ReadonlySet<DataAuthority>
>> = Object.freeze({
  FUNDING: new Set<DataAuthority>([
    'LIVE_PUBLIC',
    'DERIVED_LIVE',
    'RECORDED_REPLAY',
    'SYNTHETIC_TEST',
  ]),
  BORROW: new Set<DataAuthority>([
    'LIVE_PRIVATE',
    'RECORDED_REPLAY',
    'SYNTHETIC_TEST',
  ]),
  CAPITAL_OPPORTUNITY: new Set<DataAuthority>([
    'DERIVED_LIVE',
    'RECORDED_REPLAY',
    'SYNTHETIC_TEST',
  ]),
});

/**
 * Exact value binding emitted by a canonical owner adapter. Source identity
 * alone is deliberately insufficient: value, unit, owner, revision,
 * authority, completeness and source time are all content-addressed.
 */
export interface ConservativeEconomicFactBinding {
  readonly schema: typeof CONSERVATIVE_ECONOMIC_FACT_SCHEMA;
  readonly kind: ConservativeEconomicFactKind;
  readonly owner: ConservativeEconomicFactOwner;
  readonly value: ExactDecimal;
  readonly unit: string;
  readonly source: Readonly<SourcedTimestamp>;
  readonly ownerRevision: string;
  readonly completeness: CapitalTruthState;
  readonly evidenceIds: readonly string[];
  readonly bindingDigest: string;
}

export interface CreateConservativeEconomicFactBindingInput
  extends Omit<ConservativeEconomicFactBinding, 'schema' | 'bindingDigest'> {}

function boundedText(value: unknown, maximum = 256): value is string {
  return typeof value === 'string'
    && value.trim() === value
    && value.length > 0
    && value.length <= maximum;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function semantic(
  input: Omit<ConservativeEconomicFactBinding, 'bindingDigest'>,
): unknown {
  return {
    schema: input.schema,
    kind: input.kind,
    owner: input.owner,
    value: input.value,
    unit: input.unit,
    source: {
      sourceTimeMs: input.source.sourceTimeMs,
      receivedAtMs: input.source.receivedAtMs,
      maxAgeMs: input.source.maxAgeMs,
      authority: input.source.authority,
      completeness: input.source.completeness,
      sourceId: input.source.sourceId,
    },
    ownerRevision: input.ownerRevision,
    completeness: input.completeness,
    evidenceIds: [...input.evidenceIds],
  };
}

export function createConservativeEconomicFactBinding(
  input: Readonly<CreateConservativeEconomicFactBindingInput>,
): Readonly<ConservativeEconomicFactBinding> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('conservative economic fact input must be an object');
  }
  if (!(CONSERVATIVE_ECONOMIC_FACT_KINDS as readonly string[]).includes(input.kind)) {
    throw new TypeError('conservative economic fact kind is invalid');
  }
  if (OWNER_BY_KIND[input.kind] !== input.owner) {
    throw new TypeError('conservative economic fact owner does not own this kind');
  }
  if (!isExactDecimal(input.value) || normalizeExactDecimal(input.value) !== input.value) {
    throw new TypeError('conservative economic fact value must be a canonical exact decimal');
  }
  if (!boundedText(input.unit, 64)) {
    throw new TypeError('conservative economic fact unit is invalid');
  }
  if (!boundedText(input.ownerRevision)) {
    throw new TypeError('conservative economic fact owner revision is invalid');
  }
  if (validateSourcedTimestamp(input.source).length > 0
    || !isDataAuthority(input.source.authority)
    || !AUTHORITIES_BY_KIND[input.kind].has(input.source.authority)) {
    throw new TypeError('conservative economic fact source authority is invalid');
  }
  if (input.completeness !== 'COMPLETE') {
    throw new TypeError('conservative economic fact must be complete');
  }
  if (!Array.isArray(input.evidenceIds)
    || input.evidenceIds.length === 0
    || input.evidenceIds.length > 100
    || input.evidenceIds.some((value) => !boundedText(value))
    || new Set(input.evidenceIds).size !== input.evidenceIds.length) {
    throw new TypeError('conservative economic fact evidence identity is invalid');
  }
  const output = Object.freeze({
    schema: CONSERVATIVE_ECONOMIC_FACT_SCHEMA,
    kind: input.kind,
    owner: input.owner,
    value: input.value,
    unit: input.unit,
    source: Object.freeze({ ...input.source }),
    ownerRevision: input.ownerRevision,
    completeness: input.completeness,
    evidenceIds: sortedUnique(input.evidenceIds),
  });
  return Object.freeze({
    ...output,
    bindingDigest: capitalDigest(semantic(output)),
  });
}

export function validateConservativeEconomicFactBinding(
  value: unknown,
  expected: Readonly<{
    kind: ConservativeEconomicFactKind;
    value: ExactDecimal;
    unit: string;
    evaluatedAtMs: number;
  }>,
): readonly string[] {
  const reasons: string[] = [];
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return Object.freeze(['ECONOMIC_FACT_BINDING_REQUIRED']);
    }
    const binding = value as ConservativeEconomicFactBinding;
    if (binding.schema !== CONSERVATIVE_ECONOMIC_FACT_SCHEMA) reasons.push('ECONOMIC_FACT_SCHEMA_INVALID');
    if (binding.kind !== expected.kind) reasons.push('ECONOMIC_FACT_KIND_MISMATCH');
    if (OWNER_BY_KIND[expected.kind] !== binding.owner) reasons.push('ECONOMIC_FACT_OWNER_MISMATCH');
    if (!isExactDecimal(binding.value)
      || normalizeExactDecimal(binding.value) !== binding.value
      || binding.value !== expected.value) reasons.push('ECONOMIC_FACT_VALUE_MISMATCH');
    if (binding.unit !== expected.unit) reasons.push('ECONOMIC_FACT_UNIT_MISMATCH');
    if (!boundedText(binding.ownerRevision)) reasons.push('ECONOMIC_FACT_REVISION_MISSING');
    if (!Array.isArray(binding.evidenceIds)
      || binding.evidenceIds.length === 0
      || binding.evidenceIds.some((id) => !boundedText(id))) reasons.push('ECONOMIC_FACT_EVIDENCE_MISSING');
    if (validateSourcedTimestamp(binding.source).length > 0
      || !isDataAuthority(binding.source?.authority)
      || !AUTHORITIES_BY_KIND[expected.kind].has(binding.source.authority)) {
      reasons.push('ECONOMIC_FACT_AUTHORITY_INVALID');
    } else if (evaluateFreshness(binding.source, expected.evaluatedAtMs).state !== 'FRESH') {
      reasons.push('ECONOMIC_FACT_NOT_FRESH');
    }
    if (binding.completeness !== 'COMPLETE' || binding.source?.completeness !== 'COMPLETE') {
      reasons.push('ECONOMIC_FACT_NOT_COMPLETE');
    }
    const { bindingDigest: _digest, ...withoutDigest } = binding;
    if (!boundedText(binding.bindingDigest)
      || binding.bindingDigest !== capitalDigest(semantic(withoutDigest))) {
      reasons.push('ECONOMIC_FACT_DIGEST_MISMATCH');
    }
  } catch {
    reasons.push('ECONOMIC_FACT_BINDING_INVALID');
  }
  return Object.freeze([...new Set(reasons)].sort());
}

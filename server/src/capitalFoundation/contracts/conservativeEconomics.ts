import { isProxy } from 'node:util/types';

import {
  evaluateFreshness,
  isDataAuthority,
  isValidUtcMillis,
  validateSourcedTimestamp,
  type DataAuthority,
  type SourcedTimestamp,
} from '../../foundation/contracts/index.js';
import type { BorrowScopeIdentity } from '../../foundation/borrow/index.js';
import {
  isExactDecimal,
  normalizeExactDecimal,
  type ExactDecimal,
} from './decimal.js';
import { capitalDigest } from './identity.js';
import type { CapitalTruthState } from './truth.js';

export const CONSERVATIVE_ECONOMIC_FACT_SCHEMA =
  'capital.conservative-economic-fact.v2' as const;

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

export const CONSERVATIVE_ECONOMIC_ADMISSION_MODES = Object.freeze([
  'PRODUCTION',
  'RECORDED_REPLAY',
  'SYNTHETIC_TEST',
] as const);
export type ConservativeEconomicAdmissionMode =
  (typeof CONSERVATIVE_ECONOMIC_ADMISSION_MODES)[number];

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
    'DERIVED_LIVE',
    'RECORDED_REPLAY',
    'SYNTHETIC_TEST',
  ]),
  BORROW: new Set<DataAuthority>([
    'DERIVED_LIVE',
    'RECORDED_REPLAY',
    'SYNTHETIC_TEST',
  ]),
  CAPITAL_OPPORTUNITY: new Set<DataAuthority>([
    'DERIVED_LIVE',
    'RECORDED_REPLAY',
    'SYNTHETIC_TEST',
  ]),
});

export interface ConservativeEconomicFactScope {
  readonly proposalId: string;
  readonly proposalRevision: string | null;
  readonly proposalUpdatedAtMs: number;
  readonly proposalConfigRevision: string;
  readonly correlationId: string;
  readonly strategy: 'BASIS' | 'VOLUME';
  readonly symbol: string;
  readonly instrumentIds: readonly string[];
  /** Exact canonical owner record/component identity. */
  readonly ownerRecordId: string;
  /** Exact owner configuration revision which produced that record. */
  readonly ownerConfigRevision: string;
}

/** Borrow identity is preserved rather than collapsed to AVAILABLE. */
export interface ConservativeBorrowFactScope extends BorrowScopeIdentity {
  readonly truthEvaluatedAtMs: number;
  readonly truthExpiresAtMs: number;
}

/**
 * Exact value binding emitted only by the canonical-owner integration
 * adapter. There is deliberately no public fact constructor: arbitrary
 * callers cannot mint owner/authority claims through Capital's public API.
 */
export interface ConservativeEconomicFactBinding {
  readonly schema: typeof CONSERVATIVE_ECONOMIC_FACT_SCHEMA;
  readonly kind: ConservativeEconomicFactKind;
  readonly owner: ConservativeEconomicFactOwner;
  readonly admissionMode: ConservativeEconomicAdmissionMode;
  readonly scope: Readonly<ConservativeEconomicFactScope>;
  readonly borrowScope: Readonly<ConservativeBorrowFactScope> | null;
  readonly value: ExactDecimal;
  readonly unit: string;
  readonly source: Readonly<SourcedTimestamp>;
  readonly ownerRevision: string;
  readonly completeness: CapitalTruthState;
  readonly evidenceIds: readonly string[];
  readonly bindingDigest: string;
}

export interface CreateSyntheticConservativeEconomicFactBindingInput {
  readonly kind: ConservativeEconomicFactKind;
  readonly scope: Readonly<ConservativeEconomicFactScope>;
  readonly borrowScope: Readonly<ConservativeBorrowFactScope> | null;
  readonly value: ExactDecimal;
  readonly unit: string;
  readonly source: Readonly<SourcedTimestamp>;
  readonly ownerRevision: string;
  readonly completeness: CapitalTruthState;
  readonly evidenceIds: readonly string[];
}

function boundedText(value: unknown, maximum = 256): value is string {
  return typeof value === 'string'
    && value.trim() === value
    && value.length > 0
    && value.length <= maximum;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalIds(value: unknown): readonly string[] | null {
  if (isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || !('value' in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 1
    || lengthDescriptor.value > 100) return null;
  const length = lengthDescriptor.value as number;
  const expectedKeys = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expectedKeys.size
    || ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const captured: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true || !boundedText(descriptor.value)) return null;
    captured.push(descriptor.value);
  }
  if (new Set(captured).size !== captured.length) return null;
  const sorted = [...captured].sort(compareText);
  return sorted.every((entry, index) => entry === captured[index]) ? Object.freeze(sorted) : null;
}

function semantic(
  input: Omit<ConservativeEconomicFactBinding, 'bindingDigest'>,
): unknown {
  return {
    schema: input.schema,
    kind: input.kind,
    owner: input.owner,
    admissionMode: input.admissionMode,
    scope: {
      proposalId: input.scope.proposalId,
      proposalRevision: input.scope.proposalRevision,
      proposalUpdatedAtMs: input.scope.proposalUpdatedAtMs,
      proposalConfigRevision: input.scope.proposalConfigRevision,
      correlationId: input.scope.correlationId,
      strategy: input.scope.strategy,
      symbol: input.scope.symbol,
      instrumentIds: [...input.scope.instrumentIds],
      ownerRecordId: input.scope.ownerRecordId,
      ownerConfigRevision: input.scope.ownerConfigRevision,
    },
    borrowScope: input.borrowScope === null ? null : {
      accountId: input.borrowScope.accountId,
      symbol: input.borrowScope.symbol,
      asset: input.borrowScope.asset,
      mode: input.borrowScope.mode,
      permissionId: input.borrowScope.permissionId,
      truthEvaluatedAtMs: input.borrowScope.truthEvaluatedAtMs,
      truthExpiresAtMs: input.borrowScope.truthExpiresAtMs,
    },
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

function authorityMatchesMode(
  kind: ConservativeEconomicFactKind,
  mode: ConservativeEconomicAdmissionMode,
  authority: DataAuthority,
): boolean {
  if (mode === 'SYNTHETIC_TEST') return authority === 'SYNTHETIC_TEST';
  if (mode === 'RECORDED_REPLAY') return authority === 'RECORDED_REPLAY';
  if (kind === 'FUNDING') return authority === 'DERIVED_LIVE';
  if (kind === 'BORROW') return authority === 'DERIVED_LIVE';
  return authority === 'DERIVED_LIVE';
}

/**
 * Explicitly test-only fixture constructor. It cannot select an owner,
 * authority, or admission mode and therefore cannot mint production facts.
 */
export function createSyntheticConservativeEconomicFactBinding(
  input: Readonly<CreateSyntheticConservativeEconomicFactBindingInput>,
): Readonly<ConservativeEconomicFactBinding> {
  if (!input || typeof input !== 'object'
    || !(CONSERVATIVE_ECONOMIC_FACT_KINDS as readonly string[]).includes(input.kind)
    || input.source?.authority !== 'SYNTHETIC_TEST'
    || input.source.completeness !== 'COMPLETE'
    || input.completeness !== 'COMPLETE') {
    throw new TypeError('synthetic economic fact fixture requires synthetic complete truth');
  }
  const owner = OWNER_BY_KIND[input.kind];
  const draft = Object.freeze({
    schema: CONSERVATIVE_ECONOMIC_FACT_SCHEMA,
    kind: input.kind,
    owner,
    admissionMode: 'SYNTHETIC_TEST' as const,
    scope: Object.freeze({ ...input.scope, instrumentIds: Object.freeze([...input.scope.instrumentIds]) }),
    borrowScope: input.borrowScope === null ? null : Object.freeze({ ...input.borrowScope }),
    value: input.value,
    unit: input.unit,
    source: Object.freeze({ ...input.source }),
    ownerRevision: input.ownerRevision,
    completeness: input.completeness,
    evidenceIds: Object.freeze([...input.evidenceIds]),
  });
  const binding = Object.freeze({ ...draft, bindingDigest: capitalDigest(semantic(draft)) });
  const issues = validateConservativeEconomicFactBinding(binding, {
    kind: input.kind,
    value: input.value,
    unit: input.unit,
    evaluatedAtMs: input.source.receivedAtMs,
    admissionMode: 'SYNTHETIC_TEST',
    proposalId: input.scope.proposalId,
    proposalRevision: input.scope.proposalRevision,
    proposalUpdatedAtMs: input.scope.proposalUpdatedAtMs,
    proposalConfigRevision: input.scope.proposalConfigRevision,
    correlationId: input.scope.correlationId,
    strategy: input.scope.strategy,
    symbol: input.scope.symbol,
    instrumentIds: input.scope.instrumentIds,
    borrowScope: input.borrowScope,
  });
  if (issues.length > 0) throw new TypeError(`synthetic economic fact fixture invalid: ${issues.join(',')}`);
  return binding;
}

export interface ConservativeEconomicFactExpectation {
  readonly kind: ConservativeEconomicFactKind;
  readonly value: ExactDecimal;
  readonly unit: string;
  readonly evaluatedAtMs: number;
  readonly admissionMode: ConservativeEconomicAdmissionMode;
  readonly proposalId: string;
  readonly proposalRevision: string | null;
  readonly proposalUpdatedAtMs: number;
  readonly proposalConfigRevision: string;
  readonly correlationId: string;
  readonly strategy: 'BASIS' | 'VOLUME';
  readonly symbol: string;
  readonly instrumentIds: readonly string[];
  readonly borrowScope: Readonly<BorrowScopeIdentity> | null;
}

export function validateConservativeEconomicFactBinding(
  value: unknown,
  expected: Readonly<ConservativeEconomicFactExpectation>,
): readonly string[] {
  const reasons: string[] = [];
  try {
    if (isProxy(value) || !value || typeof value !== 'object' || Array.isArray(value)) {
      return Object.freeze(['ECONOMIC_FACT_BINDING_REQUIRED']);
    }
    const binding = value as ConservativeEconomicFactBinding;
    if (binding.schema !== CONSERVATIVE_ECONOMIC_FACT_SCHEMA) reasons.push('ECONOMIC_FACT_SCHEMA_INVALID');
    if (binding.kind !== expected.kind) reasons.push('ECONOMIC_FACT_KIND_MISMATCH');
    if (OWNER_BY_KIND[expected.kind] !== binding.owner) reasons.push('ECONOMIC_FACT_OWNER_MISMATCH');
    if (binding.admissionMode !== expected.admissionMode) reasons.push('ECONOMIC_FACT_MODE_MISMATCH');
    if (!isExactDecimal(binding.value)
      || normalizeExactDecimal(binding.value) !== binding.value
      || binding.value !== expected.value) reasons.push('ECONOMIC_FACT_VALUE_MISMATCH');
    if (binding.unit !== expected.unit) reasons.push('ECONOMIC_FACT_UNIT_MISMATCH');
    if (!boundedText(binding.ownerRevision)) reasons.push('ECONOMIC_FACT_REVISION_MISSING');
    const evidenceIds = canonicalIds(binding.evidenceIds);
    if (evidenceIds === null) reasons.push('ECONOMIC_FACT_EVIDENCE_MISSING');

    const expectedInstrumentIds = canonicalIds(expected.instrumentIds);
    const scopeInstrumentIds = canonicalIds(binding.scope?.instrumentIds);
    if (!binding.scope
      || !boundedText(binding.scope.proposalId)
      || (binding.scope.proposalRevision !== null && !boundedText(binding.scope.proposalRevision))
      || !isValidUtcMillis(binding.scope.proposalUpdatedAtMs)
      || !boundedText(binding.scope.proposalConfigRevision)
      || !boundedText(binding.scope.correlationId)
      || (binding.scope.strategy !== 'BASIS' && binding.scope.strategy !== 'VOLUME')
      || !boundedText(binding.scope.symbol, 64)
      || binding.scope.proposalId !== expected.proposalId
      || binding.scope.proposalRevision !== expected.proposalRevision
      || binding.scope.proposalUpdatedAtMs !== expected.proposalUpdatedAtMs
      || binding.scope.proposalConfigRevision !== expected.proposalConfigRevision
      || binding.scope.correlationId !== expected.correlationId
      || binding.scope.strategy !== expected.strategy
      || binding.scope.symbol !== expected.symbol
      || !boundedText(binding.scope.ownerRecordId)
      || !boundedText(binding.scope.ownerConfigRevision)
      || expectedInstrumentIds === null
      || scopeInstrumentIds === null
      || JSON.stringify(scopeInstrumentIds) !== JSON.stringify(expectedInstrumentIds)) {
      reasons.push('ECONOMIC_FACT_SCOPE_MISMATCH');
    }

    if (expected.kind === 'BORROW') {
      const borrow = binding.borrowScope;
      if (!borrow || !expected.borrowScope
        || !boundedText(borrow.accountId)
        || !boundedText(borrow.symbol, 64)
        || !boundedText(borrow.asset, 64)
        || !boundedText(borrow.permissionId)
        || borrow.accountId !== expected.borrowScope.accountId
        || borrow.symbol !== expected.borrowScope.symbol
        || borrow.asset !== expected.borrowScope.asset
        || borrow.mode !== expected.borrowScope.mode
        || borrow.permissionId !== expected.borrowScope.permissionId
        || !isValidUtcMillis(borrow.truthEvaluatedAtMs)
        || !isValidUtcMillis(borrow.truthExpiresAtMs)
        || borrow.truthExpiresAtMs < expected.evaluatedAtMs) {
        reasons.push('ECONOMIC_FACT_BORROW_SCOPE_MISMATCH');
      }
    } else if (binding.borrowScope !== null) {
      reasons.push('ECONOMIC_FACT_BORROW_SCOPE_MISMATCH');
    }

    if (validateSourcedTimestamp(binding.source).length > 0
      || !isDataAuthority(binding.source?.authority)
      || !AUTHORITIES_BY_KIND[expected.kind].has(binding.source.authority)
      || !authorityMatchesMode(expected.kind, expected.admissionMode, binding.source.authority)) {
      reasons.push('ECONOMIC_FACT_AUTHORITY_INVALID');
    } else if (evaluateFreshness(binding.source, expected.evaluatedAtMs).state !== 'FRESH') {
      reasons.push('ECONOMIC_FACT_NOT_FRESH');
    }
    if (binding.completeness !== 'COMPLETE' || binding.source?.completeness !== 'COMPLETE') {
      reasons.push('ECONOMIC_FACT_NOT_COMPLETE');
    }
    const { bindingDigest: _digest, ...withoutDigest } = binding;
    if (!boundedText(binding.bindingDigest)
      || evidenceIds === null
      || scopeInstrumentIds === null
      || binding.bindingDigest !== capitalDigest(semantic({
        ...withoutDigest,
        scope: { ...withoutDigest.scope, instrumentIds: scopeInstrumentIds },
        evidenceIds,
      }))) {
      reasons.push('ECONOMIC_FACT_DIGEST_MISMATCH');
    }
  } catch {
    reasons.push('ECONOMIC_FACT_BINDING_INVALID');
  }
  return Object.freeze([...new Set(reasons)].sort(compareText));
}

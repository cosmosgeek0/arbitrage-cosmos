import { types as utilTypes } from 'node:util';

/**
 * Cached canonical-owner economics -> Capital eligibility.
 *
 * This seam cannot fetch public/private data and cannot manufacture a value.
 * It reads each exact owner once, validates its proposal/symbol/instrument and
 * revision scope, and emits no usable fact unless the complete owner cut is
 * current for the caller's injected evaluation time.
 */
import {
  CONSERVATIVE_ECONOMIC_FACT_SCHEMA,
  capitalDigest,
  isExactDecimal,
  normalizeExactDecimal,
  type ConservativeBorrowFactScope,
  type ConservativeEconomicAdmissionMode,
  type ConservativeEconomicFactBinding,
  type ConservativeEconomicFactKind,
  type ConservativeEconomicFactOwner,
  type ConservativeEconomicInputs,
  type EconomicComponent,
  type ExactDecimal,
  type NonNegativeDecimal,
  type TruthMetadata,
  validateEconomicComponent,
} from '../../capitalFoundation/contracts/index.js';
import {
  evaluateFreshness,
  isValidUtcMillis,
  validateSourcedTimestamp,
  type DataAuthority,
} from '../../foundation/contracts/index.js';
import {
  BORROW_EVIDENCE_KEYS,
  validateBorrowTruthForConsumption,
  type BorrowEvidenceAuthority,
  type BorrowScopeIdentity,
  type BorrowTruth,
} from '../../foundation/borrow/index.js';

export interface CanonicalEconomicsProposalScope {
  readonly proposalId: string;
  readonly proposalRevision: string | null;
  readonly proposalUpdatedAtMs: number;
  readonly proposalConfigRevision: string;
  readonly correlationId: string;
  readonly strategy: 'BASIS' | 'VOLUME';
  readonly symbol: string;
  readonly instrumentIds: readonly string[];
}

export interface CachedEconomicComponentCut extends CanonicalEconomicsProposalScope {
  readonly owner: 'BASIS_ENGINE' | 'FOUNDATION_BORROW_TRUTH';
  readonly ownerRevision: string;
  readonly valuationAsset: string;
  readonly component: Readonly<EconomicComponent>;
  readonly truth: Readonly<TruthMetadata>;
}

export interface CachedBorrowEconomicCut extends CachedEconomicComponentCut {
  readonly owner: 'FOUNDATION_BORROW_TRUTH';
  readonly borrowTruth: Readonly<BorrowTruth>;
}

export type CanonicalBaseEconomicValues = Readonly<Omit<
  ConservativeEconomicInputs,
  | 'expectedBorrowScope'
  | 'fundingFact'
  | 'borrowFact'
  | 'capitalOpportunityFact'
  | 'exactSourceIds'
  | 'missingFields'
>>;

export interface CachedCapitalOpportunityCut extends CanonicalEconomicsProposalScope {
  readonly owner: 'CAPITAL_FOUNDATION';
  readonly ownerRevision: string;
  readonly ownerRecordId: string;
  readonly ownerConfigRevision: string;
  readonly value: NonNegativeDecimal;
  readonly valuationAsset: string;
  readonly evidenceIds: readonly string[];
  /** Existing canonical provenance for fees/spread/depth/latency/adverse/recovery inputs. */
  readonly baseEconomics: CanonicalBaseEconomicValues;
  readonly baseEvidenceIds: readonly string[];
  readonly truth: Readonly<TruthMetadata>;
}

export interface CanonicalConservativeEconomicsReadPort {
  readonly readCachedBasisFundingCost:
    (scope: Readonly<CanonicalEconomicsProposalScope>) => Readonly<CachedEconomicComponentCut> | null;
  readonly readCachedFoundationBorrowCost:
    (scope: Readonly<CanonicalEconomicsProposalScope>) => Readonly<CachedBorrowEconomicCut> | null;
  readonly readCachedCapitalOpportunityCost:
    (scope: Readonly<CanonicalEconomicsProposalScope>) => Readonly<CachedCapitalOpportunityCut> | null;
}

export interface ProjectCanonicalConservativeEconomicsInput {
  readonly scope: Readonly<CanonicalEconomicsProposalScope>;
  readonly borrowScope: Readonly<BorrowScopeIdentity>;
  readonly evaluatedAtMs: number;
  readonly mode: ConservativeEconomicAdmissionMode;
  readonly economics: Readonly<Omit<
    ConservativeEconomicInputs,
    'expectedBorrowScope' | 'fundingFact' | 'borrowFact' | 'capitalOpportunityFact'
  >>;
  readonly port: CanonicalConservativeEconomicsReadPort;
}

export interface CanonicalConservativeEconomicsProjection {
  readonly state: 'AVAILABLE' | 'BLOCKED';
  readonly admissionMode: ConservativeEconomicAdmissionMode;
  readonly proposalId: string;
  readonly economics: Readonly<ConservativeEconomicInputs>;
  readonly reasonCodes: readonly string[];
}

const SCOPE_KEYS = Object.freeze([
  'correlationId', 'instrumentIds', 'proposalConfigRevision', 'proposalId',
  'proposalRevision', 'proposalUpdatedAtMs', 'strategy', 'symbol',
] as const);
const COMPONENT_KEYS = Object.freeze([
  'amount', 'configRevision', 'correlationId', 'estimateRange', 'id', 'kind',
  'legId', 'observedAtMs', 'opportunityId', 'reasonCodes', 'sourceIds', 'stage',
  'status', 'strategy', 'symbol', 'valuationAsset',
] as const);
const ESTIMATE_RANGE_KEYS = Object.freeze(['high', 'low'] as const);
const TRUTH_KEYS = Object.freeze([
  'completeness', 'evaluatedAtMs', 'evidenceReferences', 'freshness',
  'reasons', 'revision', 'source',
] as const);
const SOURCE_KEYS = Object.freeze([
  'authority', 'completeness', 'maxAgeMs', 'receivedAtMs', 'sourceId', 'sourceTimeMs',
] as const);
const FRESHNESS_KEYS = Object.freeze([
  'ageMs', 'basis', 'effectiveAuthority', 'evaluatedAt', 'state',
] as const);
const FUNDING_CUT_KEYS = Object.freeze([
  ...SCOPE_KEYS, 'component', 'owner', 'ownerRevision', 'truth', 'valuationAsset',
] as const);
const BORROW_CUT_KEYS = Object.freeze([...FUNDING_CUT_KEYS, 'borrowTruth'] as const);
const OPPORTUNITY_CUT_KEYS = Object.freeze([
  ...SCOPE_KEYS, 'baseEconomics', 'baseEvidenceIds', 'evidenceIds', 'owner',
  'ownerConfigRevision', 'ownerRecordId', 'ownerRevision', 'truth', 'valuationAsset', 'value',
] as const);
const MAX_OWNER_CUT_DEPTH = 16;
const MAX_OWNER_CUT_NODES = 10_000;
const MAX_OWNER_CUT_ARRAY_LENGTH = 100;
const MAX_OWNER_CUT_OBJECT_KEYS = 64;

type OwnerCutData = null | boolean | number | string | readonly OwnerCutData[] | OwnerCutRecord;
interface OwnerCutRecord extends Readonly<Record<string, OwnerCutData>> {}

interface OwnerCutSnapshotState {
  nodes: number;
  readonly seen: WeakSet<object>;
}

function boundedText(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= maximum;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalidOwnerCut(): never {
  throw new TypeError('canonical economics owner cuts must be bounded ordinary own data');
}

function snapshotOwnerCutValue(
  value: unknown,
  state: OwnerCutSnapshotState,
  depth = 0,
): OwnerCutData {
  state.nodes += 1;
  if (state.nodes > MAX_OWNER_CUT_NODES || depth > MAX_OWNER_CUT_DEPTH) invalidOwnerCut();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) invalidOwnerCut();
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 10_000) invalidOwnerCut();
    return value;
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value)) invalidOwnerCut();
  if (state.seen.has(value)) invalidOwnerCut();
  state.seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) invalidOwnerCut();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor?.value;
    if (typeof length !== 'number'
        || !Number.isSafeInteger(length)
        || length < 0
        || length > MAX_OWNER_CUT_ARRAY_LENGTH) invalidOwnerCut();
    const expectedKeys = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedKeys.size
        || ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))) invalidOwnerCut();
    const out: OwnerCutData[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) invalidOwnerCut();
      out.push(snapshotOwnerCutValue(descriptor.value, state, depth + 1));
    }
    state.seen.delete(value);
    return Object.freeze(out);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidOwnerCut();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > MAX_OWNER_CUT_OBJECT_KEYS
      || ownKeys.some((key) => typeof key !== 'string'
        || key === '__proto__'
        || key === 'constructor'
        || key === 'prototype')) invalidOwnerCut();
  const out = Object.create(null) as Record<string, OwnerCutData>;
  for (const key of (ownKeys as string[]).sort(compareText)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) invalidOwnerCut();
    Object.defineProperty(out, key, {
      value: snapshotOwnerCutValue(descriptor.value, state, depth + 1),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  state.seen.delete(value);
  return Object.freeze(out);
}

function snapshotOwnerCut<T extends object>(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<T> | null {
  if (value === null) return null;
  try {
    const snapshot = snapshotOwnerCutValue(value, { nodes: 0, seen: new WeakSet<object>() });
    return snapshot !== null
        && typeof snapshot === 'object'
        && !Array.isArray(snapshot)
        && exactOwnKeys(snapshot, expectedKeys)
      ? snapshot as unknown as Readonly<T>
      : null;
  } catch {
    return null;
  }
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareText));
}

function canonicalIds(value: unknown): readonly string[] | null {
  if (utilTypes.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
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

function exactOwnKeys(value: unknown, expected: readonly string[]): boolean {
  if (utilTypes.isProxy(value) || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string')) return false;
  const keys = (ownKeys as string[]).sort(compareText);
  const wanted = [...expected].sort(compareText);
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return expected.every((key) => {
    const descriptor = descriptors[key];
    return Boolean(descriptor && 'value' in descriptor && descriptor.enumerable === true);
  });
}

function exactTruthMetadata(value: unknown): value is Readonly<TruthMetadata> {
  if (!exactOwnKeys(value, TRUTH_KEYS)) return false;
  const truth = value as Readonly<TruthMetadata>;
  return exactOwnKeys(truth.source, SOURCE_KEYS)
    && exactOwnKeys(truth.freshness, FRESHNESS_KEYS)
    && Array.isArray(truth.reasons)
    && Array.isArray(truth.evidenceReferences);
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

function borrowEvidenceAuthoritiesForMode(
  mode: ConservativeEconomicAdmissionMode,
): readonly BorrowEvidenceAuthority[] {
  if (mode === 'SYNTHETIC_TEST') return Object.freeze(['SYNTHETIC_TEST'] as const);
  if (mode === 'RECORDED_REPLAY') return Object.freeze(['RECORDED_REPLAY'] as const);
  return Object.freeze(['LIVE_PRIVATE'] as const);
}

function strictUtcMillis(value: unknown): value is number {
  return isValidUtcMillis(value) && !Object.is(value, -0);
}

function strictSourcedTimestamp(source: Readonly<TruthMetadata>['source']): boolean {
  return validateSourcedTimestamp(source).length === 0
    && (source.sourceTimeMs === null || !Object.is(source.sourceTimeMs, -0))
    && !Object.is(source.receivedAtMs, -0)
    && !Object.is(source.maxAgeMs, -0);
}

function sourceUsable(
  truth: Readonly<TruthMetadata>,
  kind: ConservativeEconomicFactKind,
  mode: ConservativeEconomicAdmissionMode,
  evaluatedAtMs: number,
): boolean {
  return exactTruthMetadata(truth)
    && boundedText(truth.revision)
    && strictUtcMillis(truth.evaluatedAtMs)
    && strictUtcMillis(truth.freshness.evaluatedAt)
    && (truth.freshness.ageMs === null || !Object.is(truth.freshness.ageMs, -0))
    && truth.completeness === 'COMPLETE'
    && strictSourcedTimestamp(truth.source)
    && truth.source.completeness === 'COMPLETE'
    && authorityMatchesMode(kind, mode, truth.source.authority)
    && evaluateFreshness(truth.source, evaluatedAtMs).state === 'FRESH';
}

function sameScope(
  value: Readonly<CanonicalEconomicsProposalScope>,
  expected: Readonly<CanonicalEconomicsProposalScope>,
): boolean {
  const actualInstruments = canonicalIds(value?.instrumentIds);
  const expectedInstruments = canonicalIds(expected.instrumentIds);
  return value?.proposalId === expected.proposalId
    && value.proposalRevision === expected.proposalRevision
    && value.proposalUpdatedAtMs === expected.proposalUpdatedAtMs
    && value.proposalConfigRevision === expected.proposalConfigRevision
    && value.correlationId === expected.correlationId
    && value.strategy === expected.strategy
    && value.symbol === expected.symbol
    && actualInstruments !== null
    && expectedInstruments !== null
    && JSON.stringify(actualInstruments) === JSON.stringify(expectedInstruments);
}

function compatibleComponent(
  cut: Readonly<CachedEconomicComponentCut> | null,
  expected: Readonly<{
    scope: Readonly<CanonicalEconomicsProposalScope>;
    kind: 'FUNDING' | 'BORROW_INTEREST_AND_FEES';
    value: ExactDecimal | null;
    valuationAsset: string;
    owner: 'BASIS_ENGINE' | 'FOUNDATION_BORROW_TRUTH';
    factKind: 'FUNDING' | 'BORROW';
    mode: ConservativeEconomicAdmissionMode;
    evaluatedAtMs: number;
  }>,
): cut is Readonly<CachedEconomicComponentCut> {
  if (cut === null || expected.value === null || !sameScope(cut, expected.scope)) return false;
  const component = cut.component;
  return exactOwnKeys(component, COMPONENT_KEYS)
    && (component.estimateRange === null || exactOwnKeys(component.estimateRange, ESTIMATE_RANGE_KEYS))
    && exactTruthMetadata(cut.truth)
    && cut.owner === expected.owner
    && cut.valuationAsset === expected.valuationAsset
    && boundedText(cut.ownerRevision)
    && cut.ownerRevision === cut.truth.revision
    && sourceUsable(cut.truth, expected.factKind, expected.mode, expected.evaluatedAtMs)
    && validateEconomicComponent(component).length === 0
    && boundedText(component?.id)
    && component.kind === expected.kind
    && (component.status === 'KNOWN' || component.status === 'ESTIMATED')
    && component.amount === expected.value
    && component.valuationAsset === expected.valuationAsset
    && component.opportunityId === expected.scope.proposalId
    && component.symbol === expected.scope.symbol
    && component.strategy === expected.scope.strategy
    && component.correlationId === expected.scope.correlationId
    && canonicalIds(component.sourceIds) !== null
    && component.configRevision === expected.scope.proposalConfigRevision
    && strictUtcMillis(component.observedAtMs)
    && component.observedAtMs <= expected.evaluatedAtMs
    && component.observedAtMs === cut.truth.source.sourceTimeMs;
}

function validatedBorrowTruth(
  truth: unknown,
  expected: Readonly<BorrowScopeIdentity>,
  mode: ConservativeEconomicAdmissionMode,
  evaluatedAtMs: number,
  requireRate: boolean,
): Readonly<BorrowTruth> | null {
  try {
    const validation = validateBorrowTruthForConsumption(truth, {
      evaluatedAtMs,
      acceptedAuthorities: borrowEvidenceAuthoritiesForMode(mode),
      requireRate,
    });
    if (validation.truth === null || validation.issues.length > 0) return null;
    const borrow = validation.truth;
    if (borrow.accountId !== expected.accountId
      || borrow.symbol !== expected.symbol
      || borrow.asset !== expected.asset
      || borrow.mode !== expected.mode
      || borrow.permissionId !== expected.permissionId
      || borrow.state !== 'AVAILABLE') return null;
    return borrow;
  } catch {
    return null;
  }
}

const BASE_ECONOMIC_FIELDS = Object.freeze([
  'estimatedAdverseSelectionCost',
  'estimatedBorrowCost',
  'estimatedCapitalOpportunityCost',
  'estimatedFees',
  'estimatedFunding',
  'estimatedLatencyCost',
  'estimatedRecoveryCost',
  'estimatedSlippage',
  'estimatedSpreadCost',
  'expectedGrossEdge',
  'expectedNetEdge',
  'liquidityCapacity',
  'requestedCapital',
  'valuationAsset',
] as const);

function baseEconomicsMatch(
  actual: unknown,
  expected: Readonly<ProjectCanonicalConservativeEconomicsInput>['economics'],
): actual is CanonicalBaseEconomicValues {
  if (!exactOwnKeys(actual, BASE_ECONOMIC_FIELDS)) return false;
  const record = actual as unknown as Record<(typeof BASE_ECONOMIC_FIELDS)[number], unknown>;
  return BASE_ECONOMIC_FIELDS.every((field) => record[field] === expected[field]);
}

function bindingSemantic(
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

/** Private to this canonical-owner adapter; Capital exposes no public mint API. */
function makeFact(input: Omit<ConservativeEconomicFactBinding, 'schema' | 'bindingDigest'>): Readonly<ConservativeEconomicFactBinding> {
  const fact = Object.freeze({
    schema: CONSERVATIVE_ECONOMIC_FACT_SCHEMA,
    ...input,
    scope: Object.freeze({ ...input.scope, instrumentIds: Object.freeze([...input.scope.instrumentIds]) }),
    borrowScope: input.borrowScope === null ? null : Object.freeze({ ...input.borrowScope }),
    source: Object.freeze({ ...input.source }),
    evidenceIds: Object.freeze([...input.evidenceIds]),
  });
  return Object.freeze({ ...fact, bindingDigest: capitalDigest(bindingSemantic(fact)) });
}

function factScope(
  scope: Readonly<CanonicalEconomicsProposalScope>,
  ownerRecordId: string,
  ownerConfigRevision: string,
) {
  return Object.freeze({
    ...scope,
    instrumentIds: Object.freeze([...scope.instrumentIds]),
    ownerRecordId,
    ownerConfigRevision,
  });
}

function blockedEconomics(
  input: Readonly<ProjectCanonicalConservativeEconomicsInput>,
  reasons: readonly string[],
): Readonly<ConservativeEconomicInputs> {
  return Object.freeze({
    ...input.economics,
    expectedBorrowScope: Object.freeze({ ...input.borrowScope }),
    fundingFact: null,
    borrowFact: null,
    capitalOpportunityFact: null,
    exactSourceIds: Object.freeze([]),
    missingFields: sortedUnique([
      ...input.economics.missingFields,
      'fundingFact',
      'borrowFact',
      'capitalOpportunityFact',
      ...reasons.map((reason) => `canonicalEconomics.${reason}`),
    ]),
  });
}

/** Reads each cached owner exactly once. Missing acquisition is a named blocker. */
export function projectCanonicalConservativeEconomics(
  input: Readonly<ProjectCanonicalConservativeEconomicsInput>,
): Readonly<CanonicalConservativeEconomicsProjection> {
  if (!input?.scope || !boundedText(input.scope.proposalId)
    || (input.scope.proposalRevision !== null && !boundedText(input.scope.proposalRevision))
    || !strictUtcMillis(input.scope.proposalUpdatedAtMs)
    || !boundedText(input.scope.proposalConfigRevision)
    || !boundedText(input.scope.correlationId)
    || (input.scope.strategy !== 'BASIS' && input.scope.strategy !== 'VOLUME')
    || !boundedText(input.scope.symbol)
    || canonicalIds(input.scope.instrumentIds) === null
    || !input.borrowScope
    || !boundedText(input.borrowScope.accountId)
    || input.borrowScope.symbol !== input.scope.symbol
    || !boundedText(input.borrowScope.asset)
    || !boundedText(input.borrowScope.permissionId)
    || !strictUtcMillis(input.evaluatedAtMs)
    || !input.port
    || !['PRODUCTION', 'RECORDED_REPLAY', 'SYNTHETIC_TEST'].includes(input.mode)) {
    throw new TypeError('canonical economics projection requires exact scope, injected time and cached owner port');
  }
  const reasons: string[] = [];
  let funding: Readonly<CachedEconomicComponentCut> | null = null;
  let borrow: Readonly<CachedBorrowEconomicCut> | null = null;
  let opportunity: Readonly<CachedCapitalOpportunityCut> | null = null;
  try {
    funding = snapshotOwnerCut<CachedEconomicComponentCut>(
      input.port.readCachedBasisFundingCost(input.scope),
      FUNDING_CUT_KEYS,
    );
  } catch {
    reasons.push('FUNDING_OWNER_READ_FAILED');
  }
  try {
    borrow = snapshotOwnerCut<CachedBorrowEconomicCut>(
      input.port.readCachedFoundationBorrowCost(input.scope),
      BORROW_CUT_KEYS,
    );
  } catch {
    reasons.push('BORROW_OWNER_READ_FAILED');
  }
  try {
    opportunity = snapshotOwnerCut<CachedCapitalOpportunityCut>(
      input.port.readCachedCapitalOpportunityCost(input.scope),
      OPPORTUNITY_CUT_KEYS,
    );
  } catch {
    reasons.push('CAPITAL_OPPORTUNITY_OWNER_READ_FAILED');
  }

  let fundingFact: Readonly<ConservativeEconomicFactBinding> | null = null;
  if (compatibleComponent(funding, {
    scope: input.scope,
    kind: 'FUNDING',
    value: input.economics.estimatedFunding,
    valuationAsset: input.economics.valuationAsset,
    owner: 'BASIS_ENGINE',
    factKind: 'FUNDING',
    mode: input.mode,
    evaluatedAtMs: input.evaluatedAtMs,
  })) {
    fundingFact = makeFact({
      kind: 'FUNDING',
      owner: 'BASIS_ENGINE',
      admissionMode: input.mode,
      scope: factScope(input.scope, funding.component.id, funding.component.configRevision as string),
      borrowScope: null,
      value: funding.component.amount as ExactDecimal,
      unit: funding.component.valuationAsset,
      source: funding.truth.source,
      ownerRevision: funding.ownerRevision,
      completeness: funding.truth.completeness,
      evidenceIds: canonicalIds(funding.component.sourceIds) as readonly string[],
    });
  } else reasons.push(funding === null ? 'FUNDING_OWNER_CUT_MISSING' : 'FUNDING_OWNER_CUT_MISMATCH');

  let borrowFact: Readonly<ConservativeEconomicFactBinding> | null = null;
  const borrowComponentCompatible = compatibleComponent(borrow, {
    scope: input.scope,
    kind: 'BORROW_INTEREST_AND_FEES',
    value: input.economics.estimatedBorrowCost,
    valuationAsset: input.economics.valuationAsset,
    owner: 'FOUNDATION_BORROW_TRUTH',
    factKind: 'BORROW',
    mode: input.mode,
    evaluatedAtMs: input.evaluatedAtMs,
  });
  const requireRate = true;
  const borrowTruth = borrow !== null && borrowComponentCompatible
    ? validatedBorrowTruth(
      borrow.borrowTruth,
      input.borrowScope,
      input.mode,
      input.evaluatedAtMs,
      requireRate,
    )
    : null;
  if (borrow !== null && borrowComponentCompatible && borrowTruth !== null) {
    const provenanceIds = BORROW_EVIDENCE_KEYS.flatMap((key) => {
      const source = borrowTruth.provenance[key];
      return source === null ? [] : [source.sourceId];
    });
    const borrowEvidence = sortedUnique([...borrow.component.sourceIds, ...provenanceIds]);
    const borrowScope: ConservativeBorrowFactScope = Object.freeze({
      ...input.borrowScope,
      truthEvaluatedAtMs: borrowTruth.evaluatedAtMs,
      truthExpiresAtMs: borrowTruth.expiresAtMs as number,
    });
    borrowFact = makeFact({
      kind: 'BORROW',
      owner: 'FOUNDATION_BORROW_TRUTH',
      admissionMode: input.mode,
      scope: factScope(input.scope, borrow.component.id, borrow.component.configRevision as string),
      borrowScope,
      value: borrow.component.amount as ExactDecimal,
      unit: borrow.component.valuationAsset,
      source: borrow.truth.source,
      ownerRevision: borrow.ownerRevision,
      completeness: borrow.truth.completeness,
      evidenceIds: borrowEvidence,
    });
  } else reasons.push(borrow === null ? 'BORROW_OWNER_CUT_MISSING' : 'BORROW_OWNER_CUT_MISMATCH');

  let capitalOpportunityFact: Readonly<ConservativeEconomicFactBinding> | null = null;
  if (opportunity !== null
    && sameScope(opportunity, input.scope)
    && opportunity.owner === 'CAPITAL_FOUNDATION'
    && opportunity.ownerRevision === opportunity.truth.revision
    && boundedText(opportunity.ownerRecordId)
    && boundedText(opportunity.ownerConfigRevision)
    && opportunity.value === input.economics.estimatedCapitalOpportunityCost
    && opportunity.valuationAsset === input.economics.valuationAsset
    && canonicalIds(opportunity.evidenceIds) !== null
    && canonicalIds(opportunity.baseEvidenceIds) !== null
    && baseEconomicsMatch(opportunity.baseEconomics, input.economics)
    && sourceUsable(opportunity.truth, 'CAPITAL_OPPORTUNITY', input.mode, input.evaluatedAtMs)) {
    capitalOpportunityFact = makeFact({
      kind: 'CAPITAL_OPPORTUNITY',
      owner: 'CAPITAL_FOUNDATION',
      admissionMode: input.mode,
      scope: factScope(input.scope, opportunity.ownerRecordId, opportunity.ownerConfigRevision),
      borrowScope: null,
      value: opportunity.value,
      unit: opportunity.valuationAsset,
      source: opportunity.truth.source,
      ownerRevision: opportunity.ownerRevision,
      completeness: opportunity.truth.completeness,
      evidenceIds: canonicalIds(opportunity.evidenceIds) as readonly string[],
    });
  } else reasons.push(opportunity === null
    ? 'CAPITAL_OPPORTUNITY_OWNER_CUT_MISSING'
    : 'CAPITAL_OPPORTUNITY_OWNER_CUT_MISMATCH');

  const complete = fundingFact !== null && borrowFact !== null && capitalOpportunityFact !== null;
  if (!complete) {
    const reasonCodes = sortedUnique(reasons);
    return Object.freeze({
      state: 'BLOCKED',
      admissionMode: input.mode,
      proposalId: input.scope.proposalId,
      economics: blockedEconomics(input, reasonCodes),
      reasonCodes,
    });
  }
  const admittedFunding = fundingFact as Readonly<ConservativeEconomicFactBinding>;
  const admittedBorrow = borrowFact as Readonly<ConservativeEconomicFactBinding>;
  const admittedOpportunity = capitalOpportunityFact as Readonly<ConservativeEconomicFactBinding>;
  const facts: readonly Readonly<ConservativeEconomicFactBinding>[] = [
    admittedFunding,
    admittedBorrow,
    admittedOpportunity,
  ];
  return Object.freeze({
    state: 'AVAILABLE',
    admissionMode: input.mode,
    proposalId: input.scope.proposalId,
    economics: Object.freeze({
      ...input.economics,
      expectedBorrowScope: Object.freeze({ ...input.borrowScope }),
      fundingFact: admittedFunding,
      borrowFact: admittedBorrow,
      capitalOpportunityFact: admittedOpportunity,
      exactSourceIds: sortedUnique([
        ...(opportunity as Readonly<CachedCapitalOpportunityCut>).baseEvidenceIds,
        ...facts.flatMap((fact) => fact.evidenceIds),
      ]),
      missingFields: Object.freeze([]),
    }),
    reasonCodes: Object.freeze([]),
  });
}

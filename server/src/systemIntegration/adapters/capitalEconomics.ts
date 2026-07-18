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

function boundedText(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= maximum;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareText));
}

function canonicalIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)
    || value.length === 0
    || value.length > 100
    || value.some((entry) => !boundedText(entry))
    || new Set(value).size !== value.length) return null;
  const sorted = [...value].sort(compareText);
  return sorted.every((entry, index) => entry === value[index]) ? Object.freeze(sorted) : null;
}

function exactOwnKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
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

function sourceUsable(
  truth: Readonly<TruthMetadata>,
  kind: ConservativeEconomicFactKind,
  mode: ConservativeEconomicAdmissionMode,
  evaluatedAtMs: number,
): boolean {
  return boundedText(truth?.revision)
    && truth.completeness === 'COMPLETE'
    && validateSourcedTimestamp(truth.source).length === 0
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
  return cut.owner === expected.owner
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
    && isValidUtcMillis(component.observedAtMs)
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
      || borrow.state !== 'AVAILABLE'
    ) return null;
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
    || !isValidUtcMillis(input.scope.proposalUpdatedAtMs)
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
    || !isValidUtcMillis(input.evaluatedAtMs)
    || !input.port
    || !['PRODUCTION', 'RECORDED_REPLAY', 'SYNTHETIC_TEST'].includes(input.mode)) {
    throw new TypeError('canonical economics projection requires exact scope, injected time and cached owner port');
  }
  const reasons: string[] = [];
  let funding: Readonly<CachedEconomicComponentCut> | null = null;
  let borrow: Readonly<CachedBorrowEconomicCut> | null = null;
  let opportunity: Readonly<CachedCapitalOpportunityCut> | null = null;
  try {
    funding = input.port.readCachedBasisFundingCost(input.scope);
  } catch {
    reasons.push('FUNDING_OWNER_READ_FAILED');
  }
  try {
    borrow = input.port.readCachedFoundationBorrowCost(input.scope);
  } catch {
    reasons.push('BORROW_OWNER_READ_FAILED');
  }
  try {
    opportunity = input.port.readCachedCapitalOpportunityCost(input.scope);
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

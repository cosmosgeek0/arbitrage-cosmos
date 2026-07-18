/**
 * Cached canonical-owner economics -> Capital eligibility.
 *
 * This seam cannot fetch public/private data and cannot manufacture a value.
 * It reads each owner once, validates exact value/unit/scope identity, and
 * leaves the corresponding fact null when the owner cut is absent or weak.
 */
import {
  createConservativeEconomicFactBinding,
  type ConservativeEconomicInputs,
  type EconomicComponent,
  type ExactDecimal,
  type NonNegativeDecimal,
  type TruthMetadata,
} from '../../capitalFoundation/contracts/index.js';
import type { BorrowTruth } from '../../foundation/borrow/index.js';

export interface CachedEconomicComponentCut {
  readonly owner: 'BASIS_ENGINE' | 'FOUNDATION_BORROW_TRUTH';
  readonly ownerRevision: string;
  readonly proposalId: string;
  readonly valuationAsset: string;
  readonly component: Readonly<EconomicComponent>;
  readonly truth: Readonly<TruthMetadata>;
}

export interface CachedBorrowEconomicCut extends CachedEconomicComponentCut {
  readonly borrowTruth: Readonly<BorrowTruth>;
}

export interface CachedCapitalOpportunityCut {
  readonly owner: 'CAPITAL_FOUNDATION';
  readonly ownerRevision: string;
  readonly value: NonNegativeDecimal;
  readonly valuationAsset: string;
  readonly proposalId: string;
  readonly evidenceIds: readonly string[];
  readonly truth: Readonly<TruthMetadata>;
}

export interface CanonicalConservativeEconomicsReadPort {
  readonly readCachedBasisFundingCost: (proposalId: string) => Readonly<CachedEconomicComponentCut> | null;
  readonly readCachedFoundationBorrowCost: (proposalId: string) => Readonly<CachedBorrowEconomicCut> | null;
  readonly readCachedCapitalOpportunityCost:
    (proposalId: string) => Readonly<CachedCapitalOpportunityCut> | null;
}

export interface ProjectCanonicalConservativeEconomicsInput {
  readonly proposalId: string;
  readonly mode: 'PRODUCTION' | 'RECORDED_REPLAY' | 'SYNTHETIC_TEST';
  readonly economics: Readonly<Omit<
    ConservativeEconomicInputs,
    'fundingFact' | 'borrowFact' | 'capitalOpportunityFact'
  >>;
  readonly port: CanonicalConservativeEconomicsReadPort;
}

export interface CanonicalConservativeEconomicsProjection {
  readonly state: 'AVAILABLE' | 'BLOCKED';
  readonly economics: Readonly<ConservativeEconomicInputs>;
  readonly reasonCodes: readonly string[];
}

function boundedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256;
}

function compatibleComponent(
  cut: Readonly<CachedEconomicComponentCut> | null,
  expected: Readonly<{
    kind: 'FUNDING' | 'BORROW_INTEREST_AND_FEES';
    value: ExactDecimal | null;
    valuationAsset: string;
    proposalId: string;
    owner: 'BASIS_ENGINE' | 'FOUNDATION_BORROW_TRUTH';
  }>,
): cut is Readonly<CachedEconomicComponentCut> {
  if (cut === null || expected.value === null) return false;
  const component = cut.component;
  return cut.owner === expected.owner
    && cut.proposalId === expected.proposalId
    && cut.valuationAsset === expected.valuationAsset
    && boundedText(cut.ownerRevision)
    && cut.ownerRevision === cut.truth.revision
    && component.kind === expected.kind
    && (component.status === 'KNOWN' || component.status === 'ESTIMATED')
    && component.amount === expected.value
    && component.valuationAsset === expected.valuationAsset
    && component.opportunityId === expected.proposalId
    && component.sourceIds.length > 0
    && component.configRevision !== null
    && cut.truth.revision !== null;
}

function authorityMatchesMode(
  mode: ProjectCanonicalConservativeEconomicsInput['mode'],
  funding: Readonly<ConservativeEconomicInputs>['fundingFact'],
  borrow: Readonly<ConservativeEconomicInputs>['borrowFact'],
  opportunity: Readonly<ConservativeEconomicInputs>['capitalOpportunityFact'],
): boolean {
  if (funding === null || borrow === null || opportunity === null) return false;
  if (mode === 'SYNTHETIC_TEST') {
    return [funding, borrow, opportunity].every((fact) => fact.source.authority === 'SYNTHETIC_TEST');
  }
  if (mode === 'RECORDED_REPLAY') {
    return [funding, borrow, opportunity].every((fact) => fact.source.authority === 'RECORDED_REPLAY');
  }
  return (funding.source.authority === 'LIVE_PUBLIC' || funding.source.authority === 'DERIVED_LIVE')
    && borrow.source.authority === 'LIVE_PRIVATE'
    && opportunity.source.authority === 'DERIVED_LIVE';
}

function factSource(truth: Readonly<TruthMetadata>) {
  return Object.freeze({ ...truth.source });
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

/** Reads cached owner cuts once. Missing acquisition is a named blocker. */
export function projectCanonicalConservativeEconomics(
  input: Readonly<ProjectCanonicalConservativeEconomicsInput>,
): Readonly<CanonicalConservativeEconomicsProjection> {
  if (!boundedText(input?.proposalId) || !input.port
    || !['PRODUCTION', 'RECORDED_REPLAY', 'SYNTHETIC_TEST'].includes(input.mode)) {
    throw new TypeError('canonical economics projection requires proposal identity and cached owner port');
  }
  const reasons: string[] = [];
  let funding: Readonly<CachedEconomicComponentCut> | null = null;
  let borrow: Readonly<CachedBorrowEconomicCut> | null = null;
  let opportunity: Readonly<CachedCapitalOpportunityCut> | null = null;
  try {
    funding = input.port.readCachedBasisFundingCost(input.proposalId);
  } catch {
    reasons.push('FUNDING_OWNER_READ_FAILED');
  }
  try {
    borrow = input.port.readCachedFoundationBorrowCost(input.proposalId);
  } catch {
    reasons.push('BORROW_OWNER_READ_FAILED');
  }
  try {
    opportunity = input.port.readCachedCapitalOpportunityCost(input.proposalId);
  } catch {
    reasons.push('CAPITAL_OPPORTUNITY_OWNER_READ_FAILED');
  }

  let fundingFact = null;
  if (compatibleComponent(funding, {
    kind: 'FUNDING',
    value: input.economics.estimatedFunding,
    valuationAsset: input.economics.valuationAsset,
    proposalId: input.proposalId,
    owner: 'BASIS_ENGINE',
  })) {
    try {
      fundingFact = createConservativeEconomicFactBinding({
        kind: 'FUNDING',
        owner: 'BASIS_ENGINE',
        value: funding.component.amount as ExactDecimal,
        unit: funding.component.valuationAsset,
        source: factSource(funding.truth),
        ownerRevision: funding.ownerRevision,
        completeness: funding.truth.completeness,
        evidenceIds: funding.component.sourceIds,
      });
    } catch {
      reasons.push('FUNDING_OWNER_CUT_INVALID');
    }
  } else {
    reasons.push(funding === null ? 'FUNDING_OWNER_CUT_MISSING' : 'FUNDING_OWNER_CUT_MISMATCH');
  }

  let borrowFact = null;
  if (compatibleComponent(borrow, {
    kind: 'BORROW_INTEREST_AND_FEES',
    value: input.economics.estimatedBorrowCost,
    valuationAsset: input.economics.valuationAsset,
    proposalId: input.proposalId,
    owner: 'FOUNDATION_BORROW_TRUTH',
  }) && borrow.borrowTruth.state === 'AVAILABLE') {
    try {
      borrowFact = createConservativeEconomicFactBinding({
        kind: 'BORROW',
        owner: 'FOUNDATION_BORROW_TRUTH',
        value: borrow.component.amount as ExactDecimal,
        unit: borrow.component.valuationAsset,
        source: factSource(borrow.truth),
        ownerRevision: borrow.ownerRevision,
        completeness: borrow.truth.completeness,
        evidenceIds: sortedUnique([
          ...borrow.component.sourceIds,
          ...Object.values(borrow.borrowTruth.provenance)
            .filter((source): source is NonNullable<typeof source> => source !== null)
            .map((source) => source.sourceId),
        ]),
      });
    } catch {
      reasons.push('BORROW_OWNER_CUT_INVALID');
    }
  } else {
    reasons.push(borrow === null ? 'BORROW_OWNER_CUT_MISSING' : 'BORROW_OWNER_CUT_MISMATCH');
  }

  let capitalOpportunityFact = null;
  if (opportunity !== null
    && opportunity.owner === 'CAPITAL_FOUNDATION'
    && opportunity.ownerRevision === opportunity.truth.revision
    && opportunity.value === input.economics.estimatedCapitalOpportunityCost
    && opportunity.valuationAsset === input.economics.valuationAsset
    && opportunity.proposalId === input.proposalId
    && opportunity.truth.revision !== null) {
    try {
      capitalOpportunityFact = createConservativeEconomicFactBinding({
        kind: 'CAPITAL_OPPORTUNITY',
        owner: 'CAPITAL_FOUNDATION',
        value: opportunity.value,
        unit: opportunity.valuationAsset,
        source: factSource(opportunity.truth),
        ownerRevision: opportunity.ownerRevision,
        completeness: opportunity.truth.completeness,
        evidenceIds: opportunity.evidenceIds,
      });
    } catch {
      reasons.push('CAPITAL_OPPORTUNITY_OWNER_CUT_INVALID');
    }
  } else {
    reasons.push(opportunity === null
      ? 'CAPITAL_OPPORTUNITY_OWNER_CUT_MISSING'
      : 'CAPITAL_OPPORTUNITY_OWNER_CUT_MISMATCH');
  }

  const economics = Object.freeze({
    ...input.economics,
    fundingFact,
    borrowFact,
    capitalOpportunityFact,
  });
  const complete = fundingFact !== null && borrowFact !== null && capitalOpportunityFact !== null;
  const authorityModeBound = authorityMatchesMode(
    input.mode,
    fundingFact,
    borrowFact,
    capitalOpportunityFact,
  );
  if (complete && !authorityModeBound) reasons.push('ECONOMIC_FACT_AUTHORITY_MODE_MISMATCH');
  return Object.freeze({
    state: complete && authorityModeBound ? 'AVAILABLE' as const : 'BLOCKED' as const,
    economics,
    reasonCodes: complete && authorityModeBound ? Object.freeze([]) : sortedUnique(reasons),
  });
}

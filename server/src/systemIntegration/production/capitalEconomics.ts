import type { ConservativeEconomicInputs } from '../../capitalFoundation/contracts/index.js';
import {
  projectCanonicalConservativeEconomics,
  type CachedBorrowEconomicCut,
  type CachedCapitalOpportunityCut,
  type CachedEconomicComponentCut,
  type CanonicalConservativeEconomicsProjection,
} from '../adapters/capitalEconomics.js';

/** Exact production owner reads. No generic callback may relabel a cut. */
export interface ProductionCanonicalEconomicsOwners {
  readonly basisEngine: {
    readonly readFundingCost: (proposalId: string) => Readonly<CachedEconomicComponentCut> | null;
  };
  readonly foundationBorrowTruth: {
    readonly readBorrowCost: (proposalId: string) => Readonly<CachedBorrowEconomicCut> | null;
  };
  readonly capitalFoundation: {
    readonly readOpportunityCost: (proposalId: string) => Readonly<CachedCapitalOpportunityCut> | null;
  };
}

export interface ProjectProductionCanonicalEconomicsInput {
  readonly proposalId: string;
  readonly economics: Readonly<Omit<
    ConservativeEconomicInputs,
    'fundingFact' | 'borrowFact' | 'capitalOpportunityFact'
  >>;
  readonly owners: ProductionCanonicalEconomicsOwners;
}

/**
 * Production callsite. Only live owner authorities can return AVAILABLE;
 * replay and synthetic cuts are rejected even if their values are exact.
 */
export function projectProductionCanonicalEconomics(
  input: Readonly<ProjectProductionCanonicalEconomicsInput>,
): Readonly<CanonicalConservativeEconomicsProjection> {
  return projectCanonicalConservativeEconomics({
    proposalId: input.proposalId,
    economics: input.economics,
    mode: 'PRODUCTION',
    port: {
      readCachedBasisFundingCost: (proposalId) => input.owners.basisEngine.readFundingCost(proposalId),
      readCachedFoundationBorrowCost: (proposalId) =>
        input.owners.foundationBorrowTruth.readBorrowCost(proposalId),
      readCachedCapitalOpportunityCost: (proposalId) =>
        input.owners.capitalFoundation.readOpportunityCost(proposalId),
    },
  });
}

import type { BorrowScopeIdentity } from '../../foundation/borrow/index.js';
import { isValidUtcMillis } from '../../foundation/contracts/index.js';
import type {
  ConservativeEconomicInputs,
} from '../../capitalFoundation/contracts/index.js';
import {
  evaluateOpportunityEligibilityWithProductionEconomics,
  type ProductionConservativeEconomicsAdmission,
} from '../../capitalFoundation/opportunities/eligibility.js';
import type {
  OpportunityEligibilityBatch,
  OpportunityEligibilityCandidate,
  OpportunityEligibilityPolicy,
} from '../../capitalFoundation/opportunities/types.js';
import type { UtcClock } from '../composition/types.js';
import {
  projectCanonicalConservativeEconomics,
  type CachedBorrowEconomicCut,
  type CachedCapitalOpportunityCut,
  type CachedEconomicComponentCut,
  type CanonicalConservativeEconomicsProjection,
  type CanonicalEconomicsProposalScope,
} from '../adapters/capitalEconomics.js';

/** Exact production owner reads. No generic callback may relabel a cut. */
export interface ProductionCanonicalEconomicsOwners {
  readonly basisEngine: {
    readonly readFundingCost:
      (scope: Readonly<CanonicalEconomicsProposalScope>) => Readonly<CachedEconomicComponentCut> | null;
  };
  readonly foundationBorrowTruth: {
    readonly readBorrowCost:
      (scope: Readonly<CanonicalEconomicsProposalScope>) => Readonly<CachedBorrowEconomicCut> | null;
  };
  readonly capitalFoundation: {
    readonly readOpportunityCost:
      (scope: Readonly<CanonicalEconomicsProposalScope>) => Readonly<CachedCapitalOpportunityCut> | null;
  };
}

export interface ProductionBorrowScopeBinding {
  readonly proposalId: string;
  readonly scope: Readonly<BorrowScopeIdentity>;
}

export interface ProductionCapitalEligibilityRequest {
  readonly candidates: readonly Readonly<OpportunityEligibilityCandidate>[];
  readonly policy: Readonly<OpportunityEligibilityPolicy>;
  readonly borrowScopes: readonly Readonly<ProductionBorrowScopeBinding>[];
}

export type ProductionCapitalEligibilityResult = Readonly<
  | {
      state: 'NOT_CONFIGURED';
      batch: null;
      admissions: readonly [];
      reasonCodes: readonly ['CANONICAL_ECONOMICS_OWNERS_NOT_CONFIGURED'];
    }
  | {
      state: 'EVALUATED';
      batch: Readonly<OpportunityEligibilityBatch>;
      admissions: readonly Readonly<ProductionConservativeEconomicsAdmission>[];
      reasonCodes: readonly string[];
    }
>;

export interface ProductionCapitalEligibilityPort {
  readonly evaluate:
    (request: Readonly<ProductionCapitalEligibilityRequest>) => ProductionCapitalEligibilityResult;
}

function boundedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256;
}

function exactRevision(value: unknown): value is string {
  return boundedText(value)
    && value !== 'UNKNOWN'
    && value !== 'MISSING'
    && value !== 'UNAVAILABLE';
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareText));
}

function instrumentIds(candidate: Readonly<OpportunityEligibilityCandidate>): readonly string[] {
  const structure = candidate.structure;
  if (structure?.kind === 'BASIS_TWO_LEG') {
    return sortedUnique([
      structure.spotInstrumentId,
      structure.perpetualInstrumentId,
    ].filter((value): value is string => boundedText(value)));
  }
  if (structure?.kind === 'VOLUME_DIRECTIONAL' && boundedText(structure.instrumentId)) {
    return Object.freeze([structure.instrumentId]);
  }
  return Object.freeze([]);
}

function blockedAdmission(
  candidate: Readonly<OpportunityEligibilityCandidate>,
  borrowScope: Readonly<BorrowScopeIdentity> | null,
  reasons: readonly string[],
): Readonly<ProductionConservativeEconomicsAdmission> {
  const source = candidate.intake.economics;
  return Object.freeze({
    state: 'BLOCKED',
    admissionMode: 'PRODUCTION',
    proposalId: candidate.intake.proposal.sourceProposalId,
    economics: Object.freeze({
      ...source,
      expectedBorrowScope: borrowScope === null ? null : Object.freeze({ ...borrowScope }),
      fundingFact: null,
      borrowFact: null,
      capitalOpportunityFact: null,
      exactSourceIds: Object.freeze([]),
      missingFields: sortedUnique([
        ...source.missingFields,
        'fundingFact',
        'borrowFact',
        'capitalOpportunityFact',
        ...reasons.map((reason) => `canonicalEconomics.${reason}`),
      ]),
    }),
    reasonCodes: sortedUnique(reasons),
  });
}

function economicsWithoutCallerFacts(
  economics: Readonly<ConservativeEconomicInputs>,
): Omit<
  ConservativeEconomicInputs,
  'expectedBorrowScope' | 'fundingFact' | 'borrowFact' | 'capitalOpportunityFact'
> {
  const {
    expectedBorrowScope: _expectedBorrowScope,
    fundingFact: _fundingFact,
    borrowFact: _borrowFact,
    capitalOpportunityFact: _capitalOpportunityFact,
    ...values
  } = economics;
  return Object.freeze({
    ...values,
    exactSourceIds: Object.freeze([]),
    missingFields: Object.freeze([...values.missingFields]),
  });
}

function admissionForCandidate(
  candidate: Readonly<OpportunityEligibilityCandidate>,
  borrowScope: Readonly<BorrowScopeIdentity> | null,
  owners: ProductionCanonicalEconomicsOwners,
  evaluatedAtMs: number,
): Readonly<ProductionConservativeEconomicsAdmission> {
  const proposal = candidate.intake.proposal;
  const instruments = instrumentIds(candidate);
  const preflightReasons: string[] = [];
  if (!exactRevision(proposal.sourceRevision)) preflightReasons.push('PROPOSAL_REVISION_UNAVAILABLE');
  if (!exactRevision(proposal.sourceConfigRevision)) preflightReasons.push('PROPOSAL_CONFIG_REVISION_UNAVAILABLE');
  if (!isValidUtcMillis(proposal.updatedAtMs)) preflightReasons.push('PROPOSAL_UPDATED_AT_UNAVAILABLE');
  if (instruments.length === 0) preflightReasons.push('PROPOSAL_INSTRUMENT_SCOPE_UNAVAILABLE');
  if (borrowScope === null || borrowScope.symbol !== proposal.symbol) preflightReasons.push('BORROW_SCOPE_UNAVAILABLE');
  if (preflightReasons.length > 0) return blockedAdmission(candidate, borrowScope, preflightReasons);

  const scope: CanonicalEconomicsProposalScope = Object.freeze({
    proposalId: proposal.sourceProposalId,
    proposalRevision: proposal.sourceRevision as string,
    proposalUpdatedAtMs: proposal.updatedAtMs as number,
    proposalConfigRevision: proposal.sourceConfigRevision as string,
    correlationId: proposal.sourceCorrelationId,
    strategy: proposal.strategy,
    symbol: proposal.symbol,
    instrumentIds: instruments,
  });
  try {
    const projection: Readonly<CanonicalConservativeEconomicsProjection> =
      projectCanonicalConservativeEconomics({
        scope,
        borrowScope: borrowScope as Readonly<BorrowScopeIdentity>,
        evaluatedAtMs,
        mode: 'PRODUCTION',
        economics: economicsWithoutCallerFacts(candidate.intake.economics),
        port: {
          readCachedBasisFundingCost: (exactScope) => owners.basisEngine.readFundingCost(exactScope),
          readCachedFoundationBorrowCost: (exactScope) =>
            owners.foundationBorrowTruth.readBorrowCost(exactScope),
          readCachedCapitalOpportunityCost: (exactScope) =>
            owners.capitalFoundation.readOpportunityCost(exactScope),
        },
      });
    return Object.freeze({
      state: projection.state,
      admissionMode: 'PRODUCTION',
      proposalId: projection.proposalId,
      economics: projection.economics,
      reasonCodes: projection.reasonCodes,
    });
  } catch {
    return blockedAdmission(candidate, borrowScope, ['CANONICAL_ECONOMICS_PROJECTION_FAILED']);
  }
}

/**
 * Clock-bound production Capital flow. Caller-carried fact bindings are
 * always discarded; canonical owner cuts are projected and immediately fed
 * into the Capital eligibility owner in the same call.
 */
export function createProductionCapitalEligibilityPort(input: Readonly<{
  clock: UtcClock;
  owners: ProductionCanonicalEconomicsOwners | null;
}>): Readonly<ProductionCapitalEligibilityPort> {
  if (!input || typeof input.clock?.nowMs !== 'function') {
    throw new TypeError('production capital eligibility requires an injected clock');
  }
  const port: ProductionCapitalEligibilityPort = {
    evaluate: (request: Readonly<ProductionCapitalEligibilityRequest>): ProductionCapitalEligibilityResult => {
      if (input.owners === null) {
        return Object.freeze({
          state: 'NOT_CONFIGURED',
          batch: null,
          admissions: Object.freeze([] as const),
          reasonCodes: Object.freeze(['CANONICAL_ECONOMICS_OWNERS_NOT_CONFIGURED'] as const),
        });
      }
      if (!request || !Array.isArray(request.candidates) || !Array.isArray(request.borrowScopes)) {
        throw new TypeError('production capital eligibility request is invalid');
      }
      const borrowByProposal = new Map<string, Readonly<BorrowScopeIdentity>>();
      for (const binding of request.borrowScopes) {
        if (!boundedText(binding?.proposalId) || !binding.scope || borrowByProposal.has(binding.proposalId)) {
          throw new TypeError('production borrow scope bindings must be unique and exact');
        }
        borrowByProposal.set(binding.proposalId, binding.scope);
      }
      const evaluatedAtMs = input.clock.nowMs();
      const admissions = Object.freeze(request.candidates.map((candidate: Readonly<OpportunityEligibilityCandidate>) => admissionForCandidate(
        candidate,
        borrowByProposal.get(candidate.intake.proposal.sourceProposalId) ?? null,
        input.owners as ProductionCanonicalEconomicsOwners,
        evaluatedAtMs,
      )));
      const batch = evaluateOpportunityEligibilityWithProductionEconomics(
        request.candidates,
        request.policy,
        evaluatedAtMs,
        admissions,
      );
      return Object.freeze({
        state: 'EVALUATED',
        batch,
        admissions,
        reasonCodes: sortedUnique(admissions.flatMap((admission: Readonly<ProductionConservativeEconomicsAdmission>) => admission.reasonCodes)),
      });
    },
  };
  return Object.freeze(port);
}

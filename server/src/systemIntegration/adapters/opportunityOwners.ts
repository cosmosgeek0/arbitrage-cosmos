import type { BasisProposal } from '../../engine/basis/types.js';
import type { Decision, EngineProposal } from '../../engine/v0/types.js';
import type { VolumeProposal } from '../../engine/volume/types.js';
import type { BasisRuntimeIntegrationSnapshot } from '../../services/basisRuntime.js';
import type { VolumeRuntimeIntegrationSnapshot } from '../../services/volumeRuntime.js';
import type {
  ProductionOpportunityDecisionOwnerRecord,
  ProductionOpportunityOwners,
  ProductionOpportunityProposalOwnerRecord,
  ProductionOpportunitySourceOwnerCut,
} from '../production/types.js';

interface BasisOpportunityOwnerPort {
  integrationSnapshot(): BasisRuntimeIntegrationSnapshot;
}

interface VolumeOpportunityOwnerPort {
  integrationSnapshot(): VolumeRuntimeIntegrationSnapshot;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function optionalDirection(value: unknown): EngineProposal['direction'] | null {
  return value === 'long_spot_short_perp'
    || value === 'short_spot_long_perp'
    || value === 'long'
    || value === 'short'
    ? value
    : null;
}

function optionalBorrowStatus(value: unknown): 'not_needed' | 'unknown' | null {
  return value === 'not_needed' || value === 'unknown' ? value : null;
}

function decisionCut(decision: Readonly<Decision>): Readonly<ProductionOpportunityDecisionOwnerRecord> {
  return Object.freeze({
    symbol: decision.symbol,
    ts: decision.ts,
    kind: decision.kind,
    rejectCode: decision.rejectCode,
    reasonCode: 'OWNER_ADVISORY_RECORD' as const,
    correlationId: decision.correlationId,
    direction: optionalDirection(decision.evidence.direction),
    netEdgePct: optionalNumber(decision.evidence.netEdgePct),
    confidence: optionalNumber(decision.evidence.confidence),
    borrowStatus: optionalBorrowStatus(decision.evidence.borrowStatus),
  });
}

function proposalCut(
  proposal: Readonly<EngineProposal>,
  expiresAtMs: number | null,
): Readonly<ProductionOpportunityProposalOwnerRecord> {
  return Object.freeze({
    id: proposal.id,
    correlationId: proposal.correlationId,
    symbol: proposal.symbol,
    direction: proposal.direction,
    createdTs: proposal.createdTs,
    updatedTs: proposal.updatedTs,
    status: proposal.status,
    reasonCode: 'OWNER_ADVISORY_RECORD' as const,
    netEdgePct: proposal.netEdgePct,
    confidence: proposal.confidence,
    borrowStatus: proposal.borrowStatus === 'not_needed' ? 'not_needed' as const : 'unknown' as const,
    expiresAtMs,
  });
}

function basisCut(
  snapshot: Readonly<BasisRuntimeIntegrationSnapshot>,
): Readonly<ProductionOpportunitySourceOwnerCut> {
  return Object.freeze({
    schemaVersion: 'production-opportunity-owner-cut.v1' as const,
    sourceTimeMs: snapshot.lastTickTs,
    decisions: Object.freeze(snapshot.decisions.map(decisionCut)),
    proposals: Object.freeze(snapshot.proposals.map((proposal: BasisProposal) => (
      proposalCut(proposal, proposal.invalidationSpec.expiresTs)
    ))),
  });
}

function volumeCut(
  snapshot: Readonly<VolumeRuntimeIntegrationSnapshot>,
): Readonly<ProductionOpportunitySourceOwnerCut> {
  return Object.freeze({
    schemaVersion: 'production-opportunity-owner-cut.v1' as const,
    sourceTimeMs: snapshot.lastTickTs,
    decisions: Object.freeze(snapshot.decisions.map(decisionCut)),
    proposals: Object.freeze(snapshot.proposals.map((proposal: VolumeProposal) => (
      proposalCut(proposal, proposal.expiresAtMs)
    ))),
  });
}

/** Passive exact cuts over the two existing public strategy owners. */
export function createProductionOpportunityOwners(input: Readonly<{
  basis: BasisOpportunityOwnerPort;
  volume: VolumeOpportunityOwnerPort;
}>): Readonly<ProductionOpportunityOwners> {
  return Object.freeze({
    basis: Object.freeze({
      readOpportunitySourceCut: () => basisCut(input.basis.integrationSnapshot()),
    }),
    volume: Object.freeze({
      readOpportunitySourceCut: () => volumeCut(input.volume.integrationSnapshot()),
    }),
  });
}

import type { BasisProposal } from '../../engine/basis/index.js';
import type { EngineProposal as VolumeEngineProposal } from '../../engine/volume/index.js';
import type { CanonicalProposal } from '../../foundation/contracts/index.js';
import type {
  NormalizedEvidence,
  ThesisPacket,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  ConservativeEconomicInputs,
  ProposalIntakeRecord,
  TruthMetadata,
} from '../contracts/index.js';
import type {
  BasisStructureReference,
  OpportunityStructureReference,
  VolumeStructureReference,
} from '../opportunities/index.js';

/**
 * Float-free view over the public Basis proposal contract. A complete
 * BasisProposal is structurally assignable, but the adapter cannot read its
 * financial numbers, scores, evidence payload, or nested policy thresholds.
 */
export type BasisProposalCompatibilityView = Pick<
  BasisProposal,
  'id' | 'correlationId' | 'strategy' | 'symbol' | 'direction'
  | 'createdTs' | 'updatedTs' | 'status'
> & {
  /** Basis owns this machine expiry; every other nested threshold is omitted. */
  readonly invalidationSpec: Readonly<Pick<BasisProposal['invalidationSpec'], 'expiresTs'>>;
};

/** Float-free view over the public Volume engine proposal contract. */
export type VolumeProposalCompatibilityView = Pick<
  VolumeEngineProposal,
  'id' | 'correlationId' | 'strategy' | 'symbol' | 'direction'
  | 'createdTs' | 'updatedTs' | 'status'
>;

/**
 * Safe metadata view over Foundation's CanonicalProposal. Floating edge,
 * confidence, and evidence fields are deliberately absent.
 */
export type CanonicalProposalCompatibilityView = Pick<
  CanonicalProposal,
  'kind' | 'canonicalId' | 'source' | 'sourceId' | 'symbol' | 'direction'
  | 'lifecycle' | 'sourceLifecycle' | 'observedAt' | 'expiresAtMs'
  | 'configVersion'
>;

/** Every out-of-band binding is supplied with immutable truth provenance. */
export interface SourceConfigurationBinding {
  readonly bindingId: string;
  readonly revision: string | null;
  readonly truth: Readonly<TruthMetadata>;
}

export interface SourceExpirationBinding {
  readonly bindingId: string;
  readonly expiresAtMs: number | null;
  readonly truth: Readonly<TruthMetadata>;
}

/** Engine metadata absent from CanonicalProposal, bound by an explicit caller source. */
export interface SourceProposalMetadataBinding {
  readonly bindingId: string;
  readonly correlationId: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly truth: Readonly<TruthMetadata>;
}

export interface BasisInstrumentBinding {
  readonly strategy: 'BASIS';
  readonly bindingId: string;
  readonly spotInstrumentId: string | null;
  readonly perpetualInstrumentId: string | null;
  readonly truth: Readonly<TruthMetadata>;
}

export interface VolumeInstrumentBinding {
  readonly strategy: 'VOLUME';
  readonly bindingId: string;
  readonly instrumentId: string | null;
  readonly truth: Readonly<TruthMetadata>;
}

export type OpportunityInstrumentBinding =
  | Readonly<BasisInstrumentBinding>
  | Readonly<VolumeInstrumentBinding>;

export interface ProposalCompatibilityCommonInput<
  InstrumentBinding extends OpportunityInstrumentBinding,
> {
  readonly canonical: Readonly<CanonicalProposalCompatibilityView>;
  readonly configuration: Readonly<SourceConfigurationBinding>;
  readonly expiration: Readonly<SourceExpirationBinding>;
  readonly metadata: Readonly<SourceProposalMetadataBinding>;
  readonly instruments: InstrumentBinding;
  /** Exact strings from a caller-owned valuation/economics source. */
  readonly economics: Readonly<ConservativeEconomicInputs>;
  readonly evaluatedAtMs: number;
}

export interface CanonicalProposalCompatibilityInput
  extends ProposalCompatibilityCommonInput<OpportunityInstrumentBinding> {}

export interface BasisProposalCompatibilityInput
  extends ProposalCompatibilityCommonInput<Readonly<BasisInstrumentBinding>> {
  readonly source: Readonly<BasisProposalCompatibilityView>;
}

export interface VolumeProposalCompatibilityInput
  extends ProposalCompatibilityCommonInput<Readonly<VolumeInstrumentBinding>> {
  readonly source: Readonly<VolumeProposalCompatibilityView>;
}

export interface CompatibleOpportunitySeed<
  Structure extends OpportunityStructureReference,
> {
  readonly intake: Readonly<ProposalIntakeRecord>;
  readonly structure: Readonly<Structure>;
}

export type CompatibleBasisOpportunitySeed =
  CompatibleOpportunitySeed<BasisStructureReference>;
export type CompatibleVolumeOpportunitySeed =
  CompatibleOpportunitySeed<VolumeStructureReference>;

/** Common, non-financial fields of every Market Intelligence evidence type. */
export type MarketIntelligenceEvidenceCompatibilityView = Pick<
  NormalizedEvidence,
  'id' | 'kind' | 'instrument' | 'truth'
>;

/** Thesis fields that Capital Supervision may reference without re-owning it. */
export type MarketIntelligenceThesisCompatibilityView = Pick<
  ThesisPacket,
  'id' | 'instrumentId' | 'hypothesis' | 'stage' | 'leadMarket'
  | 'supporting' | 'conflicting' | 'neutral' | 'unavailable' | 'tradeability'
  | 'reasonCodes' | 'truth'
>;

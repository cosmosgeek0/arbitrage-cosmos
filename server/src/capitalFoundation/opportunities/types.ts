import type {
  CapitalConsiderationMode,
  ConfigurationAuthority,
  IntelligenceEvidenceReference,
  IntelligenceThesisReference,
  OpportunityConsideration,
  OpportunityConsiderationId,
  ProposalIntakeRecord,
} from '../contracts/index.js';

export type EvidenceRequirement = 'OPTIONAL' | 'REQUIRED';

/** Versioned caller policy. Volume deliberately has no capital-authority mode. */
export interface OpportunityEligibilityPolicy {
  readonly authority: Readonly<ConfigurationAuthority>;
  readonly acceptedProposalConfigRevisions: Readonly<Record<'BASIS' | 'VOLUME', readonly string[]>>;
  readonly acceptedEvidenceConfigRevisions: Readonly<Record<'BASIS' | 'VOLUME', readonly string[]>>;
  readonly evidenceRequirement: Readonly<Record<'BASIS' | 'VOLUME', EvidenceRequirement>>;
  readonly basisMode: Exclude<CapitalConsiderationMode, 'ADVISORY'>;
  readonly volumeMode: Extract<CapitalConsiderationMode, 'ADVISORY' | 'VALIDATE_ONLY'>;
}

export interface BasisStructureReference {
  readonly kind: 'BASIS_TWO_LEG';
  readonly spotInstrumentId: string | null;
  readonly perpetualInstrumentId: string | null;
}

export interface VolumeStructureReference {
  readonly kind: 'VOLUME_DIRECTIONAL';
  readonly instrumentId: string | null;
}

export type OpportunityStructureReference =
  | Readonly<BasisStructureReference>
  | Readonly<VolumeStructureReference>;

export interface OpportunityConflictScope {
  /** Explicit exclusive claims, not ordinary shared portfolio pools. */
  readonly exclusiveCapitalClaimIds: readonly string[];
}

export interface OpportunityEligibilityCandidate {
  readonly intake: Readonly<ProposalIntakeRecord>;
  readonly structure: OpportunityStructureReference | null;
  readonly requiredEvidenceIds: readonly string[];
  readonly evidenceReferences: readonly Readonly<IntelligenceEvidenceReference>[];
  readonly thesisReference: Readonly<IntelligenceThesisReference> | null;
  readonly conflictScope: Readonly<OpportunityConflictScope>;
}

export const OPPORTUNITY_CONFLICT_KINDS = Object.freeze([
  'SAME_SYMBOL',
  'SHARED_INSTRUMENT',
  'SHARED_EXCLUSIVE_CAPITAL_CLAIM',
] as const);
export type OpportunityConflictKind = (typeof OPPORTUNITY_CONFLICT_KINDS)[number];

export interface OpportunityConflict {
  readonly considerationIds: readonly [OpportunityConsiderationId, OpportunityConsiderationId];
  readonly kinds: readonly OpportunityConflictKind[];
  readonly sharedKeys: readonly string[];
}

export interface OpportunityEligibilityBatch {
  readonly policyRevision: string;
  readonly evaluatedAtMs: number;
  readonly considerations: readonly Readonly<OpportunityConsideration>[];
  readonly conflicts: readonly Readonly<OpportunityConflict>[];
}

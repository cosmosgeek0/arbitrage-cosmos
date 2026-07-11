import {
  ELIGIBILITY_REASON_CODES,
  asEvidencePacketId,
  assessCapitalTruth,
  capitalDigest,
  deriveOpportunityConsiderationId,
  isExactDecimal,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  truthAllowsNewExposure,
  weakestCapitalTruth,
  type CapitalConsiderationMode,
  type CapitalTruthState,
  type ConservativeEconomicInputs,
  type EligibilityReasonCode,
  type IntelligenceEvidenceReference,
  type OpportunityConsideration,
  type OpportunityConsiderationId,
  type OpportunityLegIntent,
  type ProposalIntakeRecord,
  type TruthMetadata,
} from '../contracts/index.js';
import { DEFAULT_CLOCK_SKEW_TOLERANCE_MS, isValidUtcMillis } from '../../foundation/contracts/index.js';
import type {
  OpportunityConflict,
  OpportunityConflictKind,
  OpportunityEligibilityBatch,
  OpportunityEligibilityCandidate,
  OpportunityEligibilityPolicy,
  OpportunityStructureReference,
} from './types.js';

const OPEN_LIFECYCLES = new Set(['open', 'updated', 'proposed', 'proposal']);
const EXPIRED_LIFECYCLES = new Set(['expired']);
const REJECTED_LIFECYCLES = new Set(['rejected', 'reject']);
const INVALIDATED_LIFECYCLES = new Set(['invalidated']);

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function reasonOrder(reason: EligibilityReasonCode): number {
  return ELIGIBILITY_REASON_CODES.indexOf(reason);
}

function typedReasons(values: readonly EligibilityReasonCode[]): readonly EligibilityReasonCode[] {
  return Object.freeze([...new Set(values)].sort((left, right) => reasonOrder(left) - reasonOrder(right)));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256;
}

function validatePolicy(policy: OpportunityEligibilityPolicy, nowMs: number): void {
  if (!isValidUtcMillis(nowMs)) throw new TypeError('opportunity eligibility requires injected UTC milliseconds');
  const authority = policy?.authority;
  if (
    !authority || !nonEmpty(authority.sourceId) || !nonEmpty(authority.revision)
    || !isValidUtcMillis(authority.issuedAtMs) || !isValidUtcMillis(authority.effectiveFromMs)
    || (authority.effectiveUntilMs !== null && !isValidUtcMillis(authority.effectiveUntilMs))
    || authority.issuedAtMs > authority.effectiveFromMs
    || (authority.effectiveUntilMs !== null && authority.effectiveUntilMs <= authority.effectiveFromMs)
  ) {
    throw new TypeError('opportunity eligibility policy requires valid versioned authority');
  }
  for (const strategy of ['BASIS', 'VOLUME'] as const) {
    for (const field of ['acceptedProposalConfigRevisions', 'acceptedEvidenceConfigRevisions'] as const) {
      const values = policy[field]?.[strategy];
      if (!Array.isArray(values) || values.some((value) => !nonEmpty(value))) {
        throw new TypeError(`${field}.${strategy} must be an array of non-empty revisions`);
      }
    }
    if (policy.evidenceRequirement?.[strategy] !== 'OPTIONAL' && policy.evidenceRequirement?.[strategy] !== 'REQUIRED') {
      throw new TypeError(`evidenceRequirement.${strategy} is invalid`);
    }
  }
  if (policy.basisMode !== 'VALIDATE_ONLY' && policy.basisMode !== 'MANUAL_ARMED') {
    throw new TypeError('Basis mode must be VALIDATE_ONLY or MANUAL_ARMED');
  }
  if (policy.volumeMode !== 'ADVISORY' && policy.volumeMode !== 'VALIDATE_ONLY') {
    throw new TypeError('Volume mode cannot grant capital authority');
  }
}

function cloneTruth(truth: TruthMetadata, evaluatedAtMs: number, reasons: readonly string[], evidenceIds: readonly string[], divergent: boolean): Readonly<TruthMetadata> {
  const assessed = assessCapitalTruth({
    source: Object.freeze({ ...truth.source }),
    evaluatedAtMs,
    reasons: sortedUnique([...truth.reasons, ...reasons]),
    evidenceReferences: sortedUnique([...truth.evidenceReferences, ...evidenceIds]),
    revision: truth.revision,
    requiredValuePresent: truth.completeness !== 'UNKNOWN',
    divergent: divergent || truth.completeness === 'DIVERGENT',
  });
  return Object.freeze({
    ...assessed,
    completeness: weakestCapitalTruth([truth.completeness, assessed.completeness]),
  });
}

function normalizeEconomics(source: ConservativeEconomicInputs): {
  readonly economics: Readonly<ConservativeEconomicInputs>;
  readonly incomplete: boolean;
} {
  const missing = new Set(source?.missingFields ?? []);
  const signed = (name: keyof ConservativeEconomicInputs): ReturnType<typeof normalizeExactDecimal> | null => {
    const value = source?.[name];
    if (!isExactDecimal(value)) {
      missing.add(String(name));
      return null;
    }
    return normalizeExactDecimal(value);
  };
  const unsigned = (name: keyof ConservativeEconomicInputs): ReturnType<typeof normalizeNonNegativeExactDecimal> | null => {
    const value = source?.[name];
    try {
      return normalizeNonNegativeExactDecimal(value);
    } catch {
      missing.add(String(name));
      return null;
    }
  };
  const valuationAsset = nonEmpty(source?.valuationAsset) ? source.valuationAsset : 'UNKNOWN';
  if (valuationAsset === 'UNKNOWN') missing.add('valuationAsset');
  const exactSourceIds = sortedUnique((Array.isArray(source?.exactSourceIds) ? source.exactSourceIds : []).filter(nonEmpty));
  if (exactSourceIds.length === 0) missing.add('exactSourceIds');
  const economics = Object.freeze({
    valuationAsset,
    requestedCapital: unsigned('requestedCapital'),
    expectedGrossEdge: signed('expectedGrossEdge'),
    expectedNetEdge: signed('expectedNetEdge'),
    estimatedFees: unsigned('estimatedFees'),
    estimatedFunding: signed('estimatedFunding'),
    estimatedBorrowCost: unsigned('estimatedBorrowCost'),
    estimatedSpreadCost: unsigned('estimatedSpreadCost'),
    estimatedSlippage: unsigned('estimatedSlippage'),
    liquidityCapacity: unsigned('liquidityCapacity'),
    exactSourceIds,
    missingFields: sortedUnique([...missing]),
  });
  return Object.freeze({ economics, incomplete: economics.missingFields.length > 0 });
}

function proposalReasons(intake: ProposalIntakeRecord, policy: OpportunityEligibilityPolicy, nowMs: number): EligibilityReasonCode[] {
  const reasons: EligibilityReasonCode[] = [];
  const proposal = intake.proposal;
  const lifecycle = typeof proposal?.sourceLifecycle === 'string' ? proposal.sourceLifecycle.trim().toLowerCase() : '';
  if (EXPIRED_LIFECYCLES.has(lifecycle) || (proposal.expiresAtMs !== null && proposal.expiresAtMs <= nowMs)) reasons.push('PROPOSAL_EXPIRED');
  else if (REJECTED_LIFECYCLES.has(lifecycle)) reasons.push('PROPOSAL_REJECTED');
  else if (INVALIDATED_LIFECYCLES.has(lifecycle)) reasons.push('PROPOSAL_INVALIDATED');
  else if (OPEN_LIFECYCLES.has(lifecycle)) reasons.push('PROPOSAL_OPEN');
  else reasons.push('PROPOSAL_TRUTH_INCOMPLETE');

  if (proposal.sourceRevision === null) reasons.push('PROPOSAL_REVISION_UNKNOWN');
  const accepted = policy.acceptedProposalConfigRevisions[proposal.strategy];
  if (proposal.sourceConfigRevision === null || !accepted.includes(proposal.sourceConfigRevision)) {
    reasons.push('PROPOSAL_CONFIG_MISMATCH');
  }
  if (
    nowMs < policy.authority.effectiveFromMs
    || (policy.authority.effectiveUntilMs !== null && nowMs >= policy.authority.effectiveUntilMs)
    || !truthAllowsNewExposure(cloneTruth(intake.truth, nowMs, [], [], false))
  ) {
    reasons.push('PROPOSAL_TRUTH_INCOMPLETE');
  }
  return reasons;
}

interface EvidenceAssessment {
  readonly ids: readonly string[];
  readonly truth: CapitalTruthState;
  readonly reasons: readonly EligibilityReasonCode[];
  readonly divergent: boolean;
}

type IntelligenceClockState = 'FRESH' | 'STALE' | 'MISSING' | 'DIVERGENT';

function intelligenceClockState(
  truth: IntelligenceEvidenceReference['truth'],
  evaluatedAtMs: number,
): IntelligenceClockState {
  if (!truth || truth.authority?.kind === 'UNKNOWN') return 'MISSING';
  if (truth.freshness?.state === 'STALE') return 'STALE';
  if (truth.freshness?.state !== 'FRESH') return 'MISSING';
  const maxAgeMs = truth.freshness.maxAgeMs;
  if (typeof maxAgeMs !== 'number' || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) return 'MISSING';
  let basisTimeMs: number | null;
  switch (truth.freshness.basis) {
    case 'SOURCE_EVENT_TIME':
      basisTimeMs = truth.temporal?.sourceEventTimeMs ?? null;
      break;
    case 'SOURCE_TRANSACTION_TIME':
      basisTimeMs = truth.temporal?.sourceTransactionTimeMs ?? null;
      break;
    case 'RECEIVE_TIME':
      basisTimeMs = truth.temporal?.receivedTimeMs ?? null;
      break;
    case 'UNAVAILABLE':
      return 'MISSING';
    default:
      return 'MISSING';
  }
  if (!isValidUtcMillis(basisTimeMs)) return 'MISSING';
  const ageMs = evaluatedAtMs - basisTimeMs;
  if (ageMs < -DEFAULT_CLOCK_SKEW_TOLERANCE_MS) return 'DIVERGENT';
  return ageMs > maxAgeMs ? 'STALE' : 'FRESH';
}

function assessEvidence(
  candidate: OpportunityEligibilityCandidate,
  policy: OpportunityEligibilityPolicy,
  evaluatedAtMs: number,
  instrumentIds: readonly string[],
): EvidenceAssessment {
  const strategy = candidate.intake.proposal.strategy;
  const refs = Array.isArray(candidate.evidenceReferences) ? candidate.evidenceReferences : [];
  const rawRequired = Array.isArray(candidate.requiredEvidenceIds) ? candidate.requiredEvidenceIds : [];
  const required = sortedUnique(rawRequired.filter(nonEmpty));
  const byId = new Map<string, IntelligenceEvidenceReference>();
  let divergent = false;
  let stale = false;
  let partial = false;
  let missing = (policy.evidenceRequirement[strategy] === 'REQUIRED' && refs.length === 0) || rawRequired.some((id) => !nonEmpty(id));

  for (const reference of refs) {
    if (!nonEmpty(reference?.evidenceId)) {
      missing = true;
      continue;
    }
    const prior = byId.get(reference.evidenceId);
    if (prior && capitalDigest(prior) !== capitalDigest(reference)) divergent = true;
    else byId.set(reference.evidenceId, reference);
    if (!nonEmpty(reference.instrumentId) || !instrumentIds.includes(reference.instrumentId)) divergent = true;
    const truth = reference.truth;
    const completenessState = truth?.completeness?.state;
    const clockState = intelligenceClockState(truth, evaluatedAtMs);
    if (clockState === 'MISSING') missing = true;
    else if (clockState === 'STALE') stale = true;
    else if (clockState === 'DIVERGENT') divergent = true;
    if (completenessState === undefined || completenessState === 'MISSING' || completenessState === 'UNKNOWN') missing = true;
    else if (completenessState === 'PARTIAL') partial = true;
    if (!policy.acceptedEvidenceConfigRevisions[strategy].includes(truth?.configurationVersion)) divergent = true;
  }
  for (const id of required) if (!byId.has(id)) missing = true;

  const thesis = candidate.thesisReference;
  if (thesis !== null) {
    const overlap = thesis.supportingFactIds.filter((id) => thesis.conflictingFactIds.includes(id));
    const unavailableOverlap = thesis.unavailableFactIds.filter((id) =>
      thesis.supportingFactIds.includes(id) || thesis.conflictingFactIds.includes(id));
    if (overlap.length > 0 || unavailableOverlap.length > 0) divergent = true;
    if (!nonEmpty(thesis.thesisPacketId)) missing = true;
    if (!nonEmpty(thesis.instrumentId) || !instrumentIds.includes(thesis.instrumentId)) divergent = true;
    const clockState = intelligenceClockState(thesis.truth, evaluatedAtMs);
    if (clockState === 'MISSING') missing = true;
    else if (clockState === 'STALE') stale = true;
    else if (clockState === 'DIVERGENT') divergent = true;
    if (thesis.truth.completeness.state === 'MISSING' || thesis.truth.completeness.state === 'UNKNOWN') missing = true;
    else if (thesis.truth.completeness.state === 'PARTIAL') partial = true;
    if (!policy.acceptedEvidenceConfigRevisions[strategy].includes(thesis.truth.configurationVersion)) divergent = true;
    if (thesis.tradeability === 'UNKNOWN') missing = true;
    if (thesis.tradeability === 'BLOCKED') divergent = true;
  }

  const reasons: EligibilityReasonCode[] = [];
  if (missing) reasons.push('EVIDENCE_MISSING');
  if (stale) reasons.push('EVIDENCE_STALE');
  if (divergent) reasons.push('EVIDENCE_DIVERGENT');
  if (partial) reasons.push('PROPOSAL_TRUTH_INCOMPLETE');
  const truth: CapitalTruthState = divergent ? 'DIVERGENT' : missing ? 'UNKNOWN' : stale ? 'STALE' : partial ? 'PARTIAL' : refs.length === 0 && thesis === null ? 'UNKNOWN' : 'COMPLETE';
  return Object.freeze({ ids: Object.freeze([...byId.keys()].sort()), truth, reasons: typedReasons(reasons), divergent });
}

function structureFor(candidate: OpportunityEligibilityCandidate): {
  readonly legs: readonly Readonly<OpportunityLegIntent>[];
  readonly instrumentIds: readonly string[];
  readonly unknown: boolean;
} {
  const proposal = candidate.intake.proposal;
  const structure: OpportunityStructureReference | null = candidate.structure;
  const direction = proposal.direction.trim().toLowerCase();
  if (proposal.strategy === 'BASIS') {
    const normal = direction === 'long_spot_short_perp';
    const reverse = direction === 'short_spot_long_perp';
    const validShape = structure?.kind === 'BASIS_TWO_LEG';
    const spotId = validShape && nonEmpty(structure.spotInstrumentId) ? structure.spotInstrumentId : null;
    const perpetualId = validShape && nonEmpty(structure.perpetualInstrumentId) ? structure.perpetualInstrumentId : null;
    const unknown = (!normal && !reverse) || spotId === null || perpetualId === null || spotId === perpetualId;
    return Object.freeze({
      legs: Object.freeze([
        Object.freeze({ role: 'SPOT' as const, instrumentId: spotId, symbol: proposal.symbol, side: normal ? 'LONG' as const : reverse ? 'SHORT' as const : 'UNKNOWN' as const, borrowRequired: normal ? false : reverse ? true : null }),
        Object.freeze({ role: 'PERPETUAL' as const, instrumentId: perpetualId, symbol: proposal.symbol, side: normal ? 'SHORT' as const : reverse ? 'LONG' as const : 'UNKNOWN' as const, borrowRequired: normal || reverse ? false : null }),
      ]),
      instrumentIds: sortedUnique([spotId, perpetualId].filter(nonEmpty)),
      unknown,
    });
  }
  const instrumentId = structure?.kind === 'VOLUME_DIRECTIONAL' && nonEmpty(structure.instrumentId) ? structure.instrumentId : null;
  const side = direction === 'long' ? 'LONG' as const : direction === 'short' ? 'SHORT' as const : 'UNKNOWN' as const;
  return Object.freeze({
    legs: Object.freeze([Object.freeze({ role: 'DIRECTIONAL' as const, instrumentId, symbol: proposal.symbol, side, borrowRequired: null })]),
    instrumentIds: Object.freeze(instrumentId === null ? [] : [instrumentId]),
    unknown: side === 'UNKNOWN',
  });
}

function modeFor(candidate: OpportunityEligibilityCandidate, policy: OpportunityEligibilityPolicy): CapitalConsiderationMode {
  return candidate.intake.proposal.strategy === 'BASIS' ? policy.basisMode : policy.volumeMode;
}

const NON_BLOCKING = new Set<EligibilityReasonCode>([
  'PROPOSAL_OPEN',
  'PROPOSAL_REVISION_UNKNOWN',
  'VOLUME_ADVISORY_ONLY',
  'VOLUME_CALIBRATION_BLOCKED',
]);

interface Draft {
  readonly candidate: OpportunityEligibilityCandidate;
  readonly id: OpportunityConsiderationId;
  readonly legs: readonly Readonly<OpportunityLegIntent>[];
  readonly instrumentIds: readonly string[];
  readonly evidence: EvidenceAssessment;
  readonly economics: Readonly<ConservativeEconomicInputs>;
  readonly reasons: readonly EligibilityReasonCode[];
  readonly viableForConflict: boolean;
  readonly semanticDigest: string;
  readonly identityDivergent: boolean;
}

function cloneProposal(intake: ProposalIntakeRecord): ProposalIntakeRecord['proposal'] {
  return Object.freeze({ ...intake.proposal });
}

function intersects(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightSet = new Set(right);
  return sortedUnique(left.filter((value) => rightSet.has(value)));
}

function candidateSemanticDigest(
  candidate: Readonly<OpportunityEligibilityCandidate>,
  legs: readonly Readonly<OpportunityLegIntent>[],
  economics: Readonly<ConservativeEconomicInputs>,
): string {
  const evidenceReferenceDigests = sortedUnique(
    (Array.isArray(candidate.evidenceReferences) ? candidate.evidenceReferences : []).map((reference) => capitalDigest(reference)),
  );
  const thesis = candidate.thesisReference;
  return capitalDigest({
    proposal: candidate.intake.proposal,
    economics,
    truth: candidate.intake.truth,
    lossReport: {
      omittedFields: sortedUnique(candidate.intake.lossReport.omittedFields),
      missingSourceFields: sortedUnique(candidate.intake.lossReport.missingSourceFields),
      translationReasons: sortedUnique(candidate.intake.lossReport.translationReasons),
      financialNumbersAccepted: candidate.intake.lossReport.financialNumbersAccepted,
    },
    legs,
    requiredEvidenceIds: sortedUnique(candidate.requiredEvidenceIds),
    evidenceReferenceDigests,
    thesis: thesis === null ? null : {
      ...thesis,
      supportingFactIds: sortedUnique(thesis.supportingFactIds),
      conflictingFactIds: sortedUnique(thesis.conflictingFactIds),
      unavailableFactIds: sortedUnique(thesis.unavailableFactIds),
      reasonCodes: sortedUnique(thesis.reasonCodes),
      omittedNumericFields: sortedUnique(thesis.omittedNumericFields),
    },
    exclusiveCapitalClaimIds: sortedUnique(candidate.conflictScope.exclusiveCapitalClaimIds),
  });
}

function consolidateProposalIdentities(rawDrafts: readonly Draft[]): readonly Draft[] {
  const bySourceProposalId = new Map<string, Draft[]>();
  for (const draft of rawDrafts) {
    const sourceProposalId = draft.candidate.intake.proposal.sourceProposalId;
    bySourceProposalId.set(sourceProposalId, [...(bySourceProposalId.get(sourceProposalId) ?? []), draft]);
  }
  const consolidated: Draft[] = [];
  for (const sourceProposalId of [...bySourceProposalId.keys()].sort()) {
    const variants = [...(bySourceProposalId.get(sourceProposalId) ?? [])]
      .sort((left, right) => left.semanticDigest.localeCompare(right.semanticDigest) || left.id.localeCompare(right.id));
    const representative = variants[0];
    const identityDivergent = new Set(variants.map((draft) => draft.semanticDigest)).size > 1;
    if (!identityDivergent) {
      consolidated.push(representative);
      continue;
    }
    consolidated.push(Object.freeze({
      ...representative,
      reasons: typedReasons([...representative.reasons, 'PROPOSAL_TRUTH_INCOMPLETE']),
      viableForConflict: false,
      identityDivergent: true,
    }));
  }
  return Object.freeze(consolidated.sort((left, right) => left.id.localeCompare(right.id)));
}

function discoverConflicts(drafts: readonly Draft[]): readonly OpportunityConflict[] {
  const conflicts: OpportunityConflict[] = [];
  for (let leftIndex = 0; leftIndex < drafts.length; leftIndex += 1) {
    const left = drafts[leftIndex];
    if (!left.viableForConflict) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < drafts.length; rightIndex += 1) {
      const right = drafts[rightIndex];
      if (!right.viableForConflict || left.id === right.id) continue;
      const kinds: OpportunityConflictKind[] = [];
      const shared: string[] = [];
      if (left.candidate.intake.proposal.symbol === right.candidate.intake.proposal.symbol) {
        kinds.push('SAME_SYMBOL');
        shared.push(`symbol:${left.candidate.intake.proposal.symbol}`);
      }
      const instruments = intersects(left.instrumentIds, right.instrumentIds);
      if (instruments.length > 0) {
        kinds.push('SHARED_INSTRUMENT');
        shared.push(...instruments.map((id) => `instrument:${id}`));
      }
      const capital = intersects(
        left.candidate.conflictScope.exclusiveCapitalClaimIds,
        right.candidate.conflictScope.exclusiveCapitalClaimIds,
      );
      if (capital.length > 0) {
        kinds.push('SHARED_EXCLUSIVE_CAPITAL_CLAIM');
        shared.push(...capital.map((id) => `capital:${id}`));
      }
      if (kinds.length > 0) {
        const ids = [left.id, right.id].sort() as [OpportunityConsiderationId, OpportunityConsiderationId];
        conflicts.push(Object.freeze({ considerationIds: Object.freeze(ids), kinds: Object.freeze(kinds), sharedKeys: sortedUnique(shared) }));
      }
    }
  }
  return Object.freeze(conflicts.sort((left, right) => left.considerationIds.join('|').localeCompare(right.considerationIds.join('|'))));
}

/** Pure batch gate. It never reads clocks, engines, evidence stores, or account state. */
export function evaluateOpportunityEligibility(
  candidates: readonly Readonly<OpportunityEligibilityCandidate>[],
  policy: Readonly<OpportunityEligibilityPolicy>,
  evaluatedAtMs: number,
): Readonly<OpportunityEligibilityBatch> {
  validatePolicy(policy, evaluatedAtMs);
  if (!Array.isArray(candidates)) throw new TypeError('opportunity candidates must be an array');
  const rawDrafts = candidates.map((candidate): Draft => {
    if (
      !candidate?.intake?.proposal
      || !nonEmpty(candidate.intake.proposal.sourceProposalId)
      || !nonEmpty(candidate.intake.proposal.canonicalProposalId)
      || !nonEmpty(candidate.intake.proposal.sourceCorrelationId)
      || !nonEmpty(candidate.intake.proposal.intakeDigest)
    ) {
      throw new TypeError('candidate requires preserved proposal identity and intake digest');
    }
    if (candidate.intake.proposal.strategy !== 'BASIS' && candidate.intake.proposal.strategy !== 'VOLUME') {
      throw new TypeError('candidate proposal strategy must be BASIS or VOLUME');
    }
    if (
      !Array.isArray(candidate.conflictScope?.exclusiveCapitalClaimIds)
      || candidate.conflictScope.exclusiveCapitalClaimIds.some((id: unknown) => !nonEmpty(id))
    ) {
      throw new TypeError('exclusive capital claim IDs must be non-empty canonical strings');
    }
    const structure = structureFor(candidate);
    const evidence = assessEvidence(candidate, policy, evaluatedAtMs, structure.instrumentIds);
    const normalizedEconomics = normalizeEconomics(candidate.intake.economics);
    const reasons = proposalReasons(candidate.intake, policy, evaluatedAtMs);
    reasons.push(...evidence.reasons);
    if (structure.unknown && candidate.intake.proposal.strategy === 'BASIS') reasons.push('EXECUTABLE_STRUCTURE_UNKNOWN');
    if (normalizedEconomics.incomplete) reasons.push('CONSERVATIVE_ECONOMICS_INCOMPLETE');
    if (candidate.intake.proposal.strategy === 'VOLUME') {
      reasons.push(policy.volumeMode === 'ADVISORY' ? 'VOLUME_ADVISORY_ONLY' : 'VOLUME_CALIBRATION_BLOCKED');
    }
    const uniqueReasons = typedReasons(reasons);
    const hard = uniqueReasons.filter((reason) => !NON_BLOCKING.has(reason) && !(candidate.intake.proposal.strategy === 'VOLUME' && reason === 'CONSERVATIVE_ECONOMICS_INCOMPLETE'));
    const id = deriveOpportunityConsiderationId({
      proposalId: candidate.intake.proposal.sourceProposalId,
      proposalRevision: candidate.intake.proposal.sourceRevision,
      intakeDigest: candidate.intake.proposal.intakeDigest,
      policyRevision: policy.authority.revision,
    });
    return Object.freeze({
      candidate,
      id,
      legs: structure.legs,
      instrumentIds: structure.instrumentIds,
      evidence,
      economics: normalizedEconomics.economics,
      reasons: uniqueReasons,
      viableForConflict: candidate.intake.proposal.strategy === 'BASIS' && hard.length === 0,
      semanticDigest: candidateSemanticDigest(candidate, structure.legs, normalizedEconomics.economics),
      identityDivergent: false,
    });
  });
  const drafts = consolidateProposalIdentities(rawDrafts);

  const conflicts = discoverConflicts(drafts);
  const conflictIds = new Map<OpportunityConsiderationId, OpportunityConsiderationId[]>();
  for (const conflict of conflicts) {
    const [left, right] = conflict.considerationIds;
    conflictIds.set(left, [...(conflictIds.get(left) ?? []), right]);
    conflictIds.set(right, [...(conflictIds.get(right) ?? []), left]);
  }

  const considerations = drafts.map((draft): Readonly<OpportunityConsideration> => {
    const conflictsForDraft = Object.freeze([...(new Set(conflictIds.get(draft.id) ?? []))].sort());
    const reasons = typedReasons([...draft.reasons, ...(conflictsForDraft.length > 0 ? ['CONFLICTING_OPPORTUNITY' as const] : [])]);
    const hard = reasons.filter((reason) => !NON_BLOCKING.has(reason) && !(draft.candidate.intake.proposal.strategy === 'VOLUME' && reason === 'CONSERVATIVE_ECONOMICS_INCOMPLETE'));
    const evidenceIds = draft.evidence.ids.map(asEvidencePacketId);
    const truth = cloneTruth(
      draft.candidate.intake.truth,
      evaluatedAtMs,
      reasons,
      draft.evidence.ids,
      draft.evidence.divergent || draft.identityDivergent || conflictsForDraft.length > 0,
    );
    return Object.freeze({
      id: draft.id,
      proposal: cloneProposal(draft.candidate.intake),
      mode: modeFor(draft.candidate, policy),
      status: hard.length > 0 ? 'BLOCKED' as const : draft.candidate.intake.proposal.strategy === 'VOLUME' ? 'ADVISORY' as const : 'ELIGIBLE' as const,
      reasons,
      legs: draft.legs,
      economics: draft.economics,
      evidencePacketIds: Object.freeze(evidenceIds),
      evidenceTruth: draft.evidence.truth,
      truth,
      conflictingConsiderationIds: conflictsForDraft,
      evaluatedAtMs,
    });
  });

  return Object.freeze({
    policyRevision: policy.authority.revision,
    evaluatedAtMs,
    considerations: Object.freeze(considerations),
    conflicts,
  });
}

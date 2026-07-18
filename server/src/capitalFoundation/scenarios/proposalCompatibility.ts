import {
  asStrategyProposalId,
  assessCapitalTruth,
  capitalDigest,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  weakestCapitalTruth,
  type ConservativeEconomicInputs,
  type ExactDecimal,
  type NonNegativeDecimal,
  type ProposalIntakeRecord,
  type ProposalIntakeLossReport,
  type SourcedTimestamp,
  type TruthMetadata,
} from '../contracts/index.js';
import { isValidUtcMillis } from '../../foundation/contracts/index.js';
import type {
  BasisInstrumentBinding,
  BasisProposalCompatibilityInput,
  CanonicalProposalCompatibilityInput,
  CanonicalProposalCompatibilityView,
  CompatibleBasisOpportunitySeed,
  CompatibleVolumeOpportunitySeed,
  OpportunityInstrumentBinding,
  SourceConfigurationBinding,
  SourceExpirationBinding,
  SourceProposalMetadataBinding,
  VolumeInstrumentBinding,
  VolumeProposalCompatibilityInput,
} from './types.js';

const ADAPTER_SCHEMA = 'capital.proposal-compatibility.v1';

type SourceKind = 'CANONICAL' | 'BASIS' | 'VOLUME';

const CANONICAL_OMISSIONS = Object.freeze([
  'canonical.borrowState',
  'canonical.confidence',
  'canonical.evidence',
  'canonical.netEdgePct',
  'canonical.rejectionReasons',
  'canonical.sourceLocalRank',
]);

const BASIS_OMISSIONS = Object.freeze([
  'source.borrowRequired',
  'source.borrowStatus',
  'source.confidence',
  'source.costBreakdown',
  'source.evidence',
  'source.fundingAdjPct',
  'source.grossEdgePct',
  'source.invalidation',
  'source.invalidationSpec.depthBelowScore',
  'source.invalidationSpec.fundingFlipsAgainst',
  'source.invalidationSpec.gapClosesBelowPct',
  'source.invalidationSpec.maxStaleMs',
  'source.invalidationSpec.spreadAboveBps',
  'source.netEdgePct',
  'source.priority',
  'source.reason',
  'source.stagedSizes',
  'source.suggestedNotionalUsd',
]);

const VOLUME_OMISSIONS = Object.freeze([
  'source.borrowRequired',
  'source.borrowStatus',
  'source.confidence',
  'source.evidence',
  'source.fundingAdjPct',
  'source.grossEdgePct',
  'source.invalidation',
  'source.netEdgePct',
  'source.reason',
  'source.suggestedNotionalUsd',
]);

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim() === value
    && value.length > 0
    && value.length <= 256;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  for (const value of values) {
    if (!nonEmpty(value)) throw new TypeError('compatibility metadata requires bounded non-empty strings');
  }
  return Object.freeze([...new Set(values)].sort());
}

function cloneAndFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (value === null || typeof value !== 'object') return value as Readonly<T>;
  if (seen.has(value)) throw new TypeError('compatibility output cannot contain cycles');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('compatibility output requires plain data');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const output = value.map((entry) => cloneAndFreeze(entry, seen));
    seen.delete(value);
    return Object.freeze(output) as unknown as Readonly<T>;
  }
  const output: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError('compatibility output rejects symbol keys');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError('compatibility output rejects accessors and non-data fields');
    }
    if (descriptor.value === undefined) throw new TypeError('compatibility output rejects undefined values');
    output[key] = cloneAndFreeze(descriptor.value, seen);
  }
  seen.delete(value);
  return Object.freeze(output) as Readonly<T>;
}

function canonicalSigned(value: ExactDecimal | null, field: string): ExactDecimal | null {
  if (value === null) return null;
  const normalized = normalizeExactDecimal(value);
  if (normalized !== value) throw new TypeError(`${field} must be a canonical exact decimal string`);
  return normalized;
}

function canonicalUnsigned(
  value: NonNegativeDecimal | null,
  field: string,
): NonNegativeDecimal | null {
  if (value === null) return null;
  const normalized = normalizeNonNegativeExactDecimal(value);
  if (normalized !== value) throw new TypeError(`${field} must be a canonical non-negative decimal string`);
  return normalized;
}

function exactEconomics(
  input: Readonly<ConservativeEconomicInputs>,
): Readonly<ConservativeEconomicInputs> {
  if (!input || !nonEmpty(input.valuationAsset)) {
    throw new TypeError('caller exact economics requires a valuation asset');
  }
  if (!Array.isArray(input.exactSourceIds) || !Array.isArray(input.missingFields)) {
    throw new TypeError('caller exact economics requires source and missing-field arrays');
  }
  const missing = new Set(sortedUnique(input.missingFields));
  const requestedCapital = canonicalUnsigned(input.requestedCapital, 'requestedCapital');
  const expectedGrossEdge = canonicalSigned(input.expectedGrossEdge, 'expectedGrossEdge');
  const expectedNetEdge = canonicalSigned(input.expectedNetEdge, 'expectedNetEdge');
  const estimatedFees = canonicalUnsigned(input.estimatedFees, 'estimatedFees');
  const estimatedFunding = canonicalSigned(input.estimatedFunding, 'estimatedFunding');
  const estimatedBorrowCost = canonicalUnsigned(input.estimatedBorrowCost, 'estimatedBorrowCost');
  const estimatedSpreadCost = canonicalUnsigned(input.estimatedSpreadCost, 'estimatedSpreadCost');
  const estimatedSlippage = canonicalUnsigned(input.estimatedSlippage, 'estimatedSlippage');
  const estimatedLatencyCost = canonicalUnsigned(input.estimatedLatencyCost, 'estimatedLatencyCost');
  const estimatedAdverseSelectionCost = canonicalUnsigned(input.estimatedAdverseSelectionCost, 'estimatedAdverseSelectionCost');
  const estimatedRecoveryCost = canonicalUnsigned(input.estimatedRecoveryCost, 'estimatedRecoveryCost');
  const estimatedCapitalOpportunityCost = canonicalUnsigned(
    input.estimatedCapitalOpportunityCost,
    'estimatedCapitalOpportunityCost',
  );
  const liquidityCapacity = canonicalUnsigned(input.liquidityCapacity, 'liquidityCapacity');
  const values = {
    requestedCapital,
    expectedGrossEdge,
    expectedNetEdge,
    estimatedFees,
    estimatedFunding,
    estimatedBorrowCost,
    estimatedSpreadCost,
    estimatedSlippage,
    estimatedLatencyCost,
    estimatedAdverseSelectionCost,
    estimatedRecoveryCost,
    estimatedCapitalOpportunityCost,
    liquidityCapacity,
  } as const;
  for (const [field, value] of Object.entries(values)) {
    if (value === null) missing.add(field);
  }
  const exactSourceIds = sortedUnique(input.exactSourceIds);
  if (exactSourceIds.length === 0) missing.add('exactSourceIds');
  const boundSourceIds = (name: 'fundingSourceIds' | 'borrowSourceIds' | 'capitalOpportunitySourceIds') => {
    if (!Array.isArray(input[name])) throw new TypeError(`${name} must be an array`);
    const ids = sortedUnique(input[name]);
    if (ids.length === 0) missing.add(name);
    return ids;
  };
  return cloneAndFreeze({
    valuationAsset: input.valuationAsset,
    ...values,
    fundingSourceIds: boundSourceIds('fundingSourceIds'),
    borrowSourceIds: boundSourceIds('borrowSourceIds'),
    capitalOpportunitySourceIds: boundSourceIds('capitalOpportunitySourceIds'),
    exactSourceIds,
    missingFields: [...missing].sort(),
  });
}

/** Strictly projects Foundation's six-field source stamp; extra JS fields die here. */
function sourcedTimestamp(
  input: Readonly<SourcedTimestamp>,
): SourcedTimestamp {
  return {
    sourceTimeMs: input.sourceTimeMs,
    receivedAtMs: input.receivedAtMs,
    maxAgeMs: input.maxAgeMs,
    authority: input.authority,
    completeness: input.completeness,
    sourceId: input.sourceId,
  };
}

/** Stable binding truth for intake identity; excludes derived evaluation-clock fields. */
function bindingTruthDigest(truth: Readonly<TruthMetadata>): unknown {
  return {
    source: sourcedTimestamp(truth.source),
    completeness: truth.completeness,
    reasons: sortedUnique(truth.reasons),
    evidenceReferences: sortedUnique(truth.evidenceReferences),
    revision: truth.revision,
  };
}

function refreshedTruth(
  truth: Readonly<TruthMetadata>,
  evaluatedAtMs: number,
): Readonly<TruthMetadata> {
  const refreshed = assessCapitalTruth({
    source: sourcedTimestamp(truth.source),
    evaluatedAtMs,
    reasons: truth.reasons,
    evidenceReferences: truth.evidenceReferences,
    revision: truth.revision,
    requiredValuePresent: truth.completeness !== 'UNKNOWN',
    divergent: truth.completeness === 'DIVERGENT',
  });
  const completeness = weakestCapitalTruth([
    truth.completeness,
    refreshed.completeness,
  ]);
  return cloneAndFreeze({ ...refreshed, completeness });
}

function combineTruth(
  truths: readonly Readonly<TruthMetadata>[],
  evaluatedAtMs: number,
  reasons: readonly string[],
  bindingIds: readonly string[],
  revision: string | null,
): Readonly<TruthMetadata> {
  const refreshed = truths.map((truth) => refreshedTruth(truth, evaluatedAtMs));
  const completeness = weakestCapitalTruth(
    refreshed.map((truth) => truth.completeness),
  );
  const selected = refreshed.find((truth) => truth.completeness === completeness);
  if (selected === undefined) throw new TypeError('compatibility truth requires supplied provenance');
  return cloneAndFreeze({
    ...selected,
    completeness,
    evaluatedAtMs,
    reasons: sortedUnique([
      ...refreshed.flatMap((truth) => truth.reasons),
      ...reasons,
    ]),
    evidenceReferences: sortedUnique([
      ...refreshed.flatMap((truth) => truth.evidenceReferences),
      ...bindingIds,
    ]),
    revision: revision ?? selected.revision,
  });
}

function lifecycleFor(sourceLifecycle: string): CanonicalProposalCompatibilityView['lifecycle'] {
  switch (sourceLifecycle) {
    case 'open':
    case 'updated':
      return 'OPEN';
    case 'expired':
      return 'EXPIRED';
    case 'rejected':
      return 'REJECTED';
    case 'approved_manual':
      return 'CLOSED';
    default:
      return 'UNKNOWN';
  }
}

function validateBindingTruth(
  binding: { readonly bindingId: string; readonly truth: Readonly<TruthMetadata> },
  evaluatedAtMs: number,
): void {
  if (!nonEmpty(binding?.bindingId)) throw new TypeError('compatibility binding requires a stable binding ID');
  refreshedTruth(binding.truth, evaluatedAtMs);
}

function validateInstruments(
  binding: OpportunityInstrumentBinding,
  strategy: CanonicalProposalCompatibilityView['source'],
  evaluatedAtMs: number,
): void {
  validateBindingTruth(binding, evaluatedAtMs);
  if (binding.strategy !== strategy) throw new TypeError('instrument binding strategy does not match canonical proposal');
  if (binding.strategy === 'BASIS') {
    for (const value of [binding.spotInstrumentId, binding.perpetualInstrumentId]) {
      if (value !== null && !nonEmpty(value)) throw new TypeError('Basis instrument bindings must be null or non-empty IDs');
    }
    if (binding.spotInstrumentId !== null && binding.spotInstrumentId === binding.perpetualInstrumentId) {
      throw new TypeError('Basis spot and perpetual instrument IDs must differ');
    }
  } else if (binding.instrumentId !== null && !nonEmpty(binding.instrumentId)) {
    throw new TypeError('Volume instrument binding must be null or a non-empty ID');
  }
}

function validateCommon(
  input: Readonly<CanonicalProposalCompatibilityInput>,
): void {
  const canonical = input.canonical;
  if (!isValidUtcMillis(input.evaluatedAtMs)
    || !isValidUtcMillis(input.metadata?.createdAtMs)
    || !isValidUtcMillis(input.metadata?.updatedAtMs)
    || input.metadata.createdAtMs > input.metadata.updatedAtMs) {
    throw new TypeError('proposal compatibility requires valid injected source and evaluation times');
  }
  if (!nonEmpty(input.metadata.correlationId)) throw new TypeError('proposal compatibility requires source correlation identity');
  if (canonical?.kind !== 'PROPOSAL'
    || !nonEmpty(canonical.canonicalId)
    || !nonEmpty(canonical.sourceId)
    || !nonEmpty(canonical.symbol)
    || !nonEmpty(canonical.direction)
    || !nonEmpty(canonical.sourceLifecycle)) {
    throw new TypeError('proposal compatibility requires complete canonical identity metadata');
  }
  if (canonical.source !== 'BASIS' && canonical.source !== 'VOLUME') {
    throw new TypeError('proposal compatibility supports only Basis and Volume');
  }
  if (canonical.lifecycle !== lifecycleFor(canonical.sourceLifecycle)) {
    throw new TypeError('canonical lifecycle does not match preserved source lifecycle');
  }
  if (canonical.observedAt.sourceTimeMs !== input.metadata.updatedAtMs) {
    throw new TypeError('canonical observation time does not match bound source update time');
  }
  validateBindingTruth(input.metadata, input.evaluatedAtMs);
  validateBindingTruth(input.configuration, input.evaluatedAtMs);
  validateBindingTruth(input.expiration, input.evaluatedAtMs);
  validateInstruments(input.instruments, canonical.source, input.evaluatedAtMs);
  if (input.configuration.revision !== null && !nonEmpty(input.configuration.revision)) {
    throw new TypeError('configuration revision must be null or a bounded non-empty string');
  }
  if (input.expiration.expiresAtMs !== null && !isValidUtcMillis(input.expiration.expiresAtMs)) {
    throw new TypeError('expiration binding must be null or valid UTC milliseconds');
  }
  if (canonical.configVersion !== input.configuration.revision) {
    throw new TypeError('configuration binding diverges from canonical proposal');
  }
  if (canonical.expiresAtMs !== input.expiration.expiresAtMs) {
    throw new TypeError('expiration binding diverges from canonical proposal');
  }
}

function instrumentDigest(binding: OpportunityInstrumentBinding): unknown {
  return binding.strategy === 'BASIS'
    ? {
        strategy: binding.strategy,
        bindingId: binding.bindingId,
        spotInstrumentId: binding.spotInstrumentId,
        perpetualInstrumentId: binding.perpetualInstrumentId,
        truth: bindingTruthDigest(binding.truth),
      }
    : {
        strategy: binding.strategy,
        bindingId: binding.bindingId,
        instrumentId: binding.instrumentId,
        truth: bindingTruthDigest(binding.truth),
      };
}

function missingFields(
  sourceKind: SourceKind,
  configuration: SourceConfigurationBinding,
  expiration: SourceExpirationBinding,
  instruments: OpportunityInstrumentBinding,
): readonly string[] {
  const fields = ['sourceRevision'];
  if (sourceKind === 'CANONICAL') {
    fields.push(
      'canonical.sourceCorrelationId',
      'canonical.sourceCreatedAtMs',
      'canonical.sourceRevision',
    );
  }
  if (configuration.revision === null) fields.push('sourceConfigRevision');
  if (expiration.expiresAtMs === null) fields.push('expiresAtMs');
  if (instruments.strategy === 'BASIS') {
    if (instruments.spotInstrumentId === null) fields.push('spotInstrumentId');
    if (instruments.perpetualInstrumentId === null) fields.push('perpetualInstrumentId');
  } else if (instruments.instrumentId === null) fields.push('instrumentId');
  return sortedUnique(fields);
}

function lossReport(
  sourceKind: SourceKind,
  configuration: SourceConfigurationBinding,
  expiration: SourceExpirationBinding,
  instruments: OpportunityInstrumentBinding,
): Readonly<ProposalIntakeLossReport> {
  const sourceOmissions = sourceKind === 'BASIS'
    ? BASIS_OMISSIONS
    : sourceKind === 'VOLUME'
      ? VOLUME_OMISSIONS
      : [];
  const canonicalOnlyReasons = sourceKind === 'CANONICAL'
    ? [
        'CANONICAL_PROPOSAL_OMITS_ENGINE_CORRELATION_ID',
        'CANONICAL_PROPOSAL_OMITS_ENGINE_CREATION_TIME',
        'CANONICAL_PROPOSAL_OMITS_ENGINE_SOURCE_REVISION',
        'CALLER_BOUND_MISSING_ENGINE_METADATA',
      ]
    : [];
  return cloneAndFreeze({
    omittedFields: sortedUnique([...CANONICAL_OMISSIONS, ...sourceOmissions]),
    missingSourceFields: missingFields(sourceKind, configuration, expiration, instruments),
    translationReasons: sortedUnique([
      'CALLER_BOUND_CONFIGURATION_WITH_TRUTH_PROVENANCE',
      'CALLER_BOUND_EXPIRATION_WITH_TRUTH_PROVENANCE',
      'CALLER_BOUND_INSTRUMENTS_WITH_TRUTH_PROVENANCE',
      'CALLER_BOUND_SOURCE_METADATA_WITH_TRUTH_PROVENANCE',
      'CALLER_SUPPLIED_EXACT_ECONOMICS',
      'SOURCE_REVISION_NOT_EXPORTED',
      'UPSTREAM_FLOATING_FINANCIAL_FIELDS_OMITTED',
      ...canonicalOnlyReasons,
    ]),
    financialNumbersAccepted: false as const,
  });
}

function buildIntake(
  input: Readonly<CanonicalProposalCompatibilityInput>,
  sourceKind: SourceKind,
): Readonly<ProposalIntakeRecord> {
  validateCommon(input);
  const economics = exactEconomics(input.economics);
  const report = lossReport(
    sourceKind,
    input.configuration,
    input.expiration,
    input.instruments,
  );
  const canonical = input.canonical;
  const proposalWithoutDigest = {
    sourceProposalId: asStrategyProposalId(canonical.sourceId),
    canonicalProposalId: canonical.canonicalId,
    sourceCorrelationId: input.metadata.correlationId,
    strategy: canonical.source,
    symbol: canonical.symbol,
    direction: canonical.direction,
    sourceLifecycle: canonical.sourceLifecycle,
    sourceRevision: null,
    sourceConfigRevision: input.configuration.revision,
    createdAtMs: input.metadata.createdAtMs,
    updatedAtMs: input.metadata.updatedAtMs,
    expiresAtMs: input.expiration.expiresAtMs,
  } as const;
  const intakeDigest = capitalDigest({
    adapterSchema: ADAPTER_SCHEMA,
    proposal: proposalWithoutDigest,
    canonical: {
      kind: canonical.kind,
      canonicalId: canonical.canonicalId,
      source: canonical.source,
      sourceId: canonical.sourceId,
      symbol: canonical.symbol,
      direction: canonical.direction,
      lifecycle: canonical.lifecycle,
      sourceLifecycle: canonical.sourceLifecycle,
      observedAt: sourcedTimestamp(canonical.observedAt),
      expiresAtMs: canonical.expiresAtMs,
      configVersion: canonical.configVersion,
    },
    bindings: {
      metadata: {
        bindingId: input.metadata.bindingId,
        correlationId: input.metadata.correlationId,
        createdAtMs: input.metadata.createdAtMs,
        updatedAtMs: input.metadata.updatedAtMs,
        truth: bindingTruthDigest(input.metadata.truth),
      },
      configuration: {
        bindingId: input.configuration.bindingId,
        revision: input.configuration.revision,
        truth: bindingTruthDigest(input.configuration.truth),
      },
      expiration: {
        bindingId: input.expiration.bindingId,
        expiresAtMs: input.expiration.expiresAtMs,
        truth: bindingTruthDigest(input.expiration.truth),
      },
      instruments: instrumentDigest(input.instruments),
    },
    economics,
  });
  const canonicalTruth = assessCapitalTruth({
    source: sourcedTimestamp(canonical.observedAt),
    evaluatedAtMs: input.evaluatedAtMs,
    requiredValuePresent: true,
    revision: input.configuration.revision,
    reasons: report.translationReasons,
    evidenceReferences: [
      input.metadata.bindingId,
      input.configuration.bindingId,
      input.expiration.bindingId,
      input.instruments.bindingId,
    ],
  });
  const truth = combineTruth(
    [
      canonicalTruth,
      input.metadata.truth,
      input.configuration.truth,
      input.expiration.truth,
      input.instruments.truth,
    ],
    input.evaluatedAtMs,
    report.translationReasons,
    [
      input.metadata.bindingId,
      input.configuration.bindingId,
      input.expiration.bindingId,
      input.instruments.bindingId,
    ],
    input.configuration.revision,
  );
  return cloneAndFreeze({
    proposal: { ...proposalWithoutDigest, intakeDigest },
    economics,
    truth,
    lossReport: report,
  });
}

function validateSource(
  source: Readonly<{
    id: string;
    correlationId: string;
    strategy: string;
    symbol: string;
    direction: string;
    createdTs: number;
    updatedTs: number;
    status: string;
  }>,
  canonical: Readonly<CanonicalProposalCompatibilityView>,
  strategy: 'BASIS' | 'VOLUME',
  metadata: Readonly<SourceProposalMetadataBinding>,
): void {
  const sourceStrategy = strategy === 'BASIS' ? 'basis' : 'volume_spike';
  if (source.strategy !== sourceStrategy || canonical.source !== strategy) {
    throw new TypeError('source proposal strategy does not match canonical proposal');
  }
  if (source.id !== canonical.sourceId
    || source.symbol !== canonical.symbol
    || source.direction !== canonical.direction
    || source.status !== canonical.sourceLifecycle
    || source.correlationId !== metadata.correlationId
    || source.createdTs !== metadata.createdAtMs
    || source.updatedTs !== metadata.updatedAtMs
    || source.updatedTs !== canonical.observedAt.sourceTimeMs) {
    throw new TypeError('source proposal identity or lifecycle diverges from canonical proposal');
  }
}

/**
 * Adapts Foundation's canonical proposal plus explicit missing source
 * bindings. It cannot manufacture an engine revision or exact economics.
 */
export function adaptCanonicalProposalToCapitalIntake(
  input: Readonly<CanonicalProposalCompatibilityInput>,
): Readonly<ProposalIntakeRecord> {
  return buildIntake(input, 'CANONICAL');
}

/** Float-rejecting Basis compatibility adapter. No execution authority. */
export function adaptBasisProposalToCapitalCandidate(
  input: Readonly<BasisProposalCompatibilityInput>,
): Readonly<CompatibleBasisOpportunitySeed> {
  validateSource(input.source, input.canonical, 'BASIS', input.metadata);
  if (!input.source.invalidationSpec
    || !isValidUtcMillis(input.source.invalidationSpec.expiresTs)
    || input.source.invalidationSpec.expiresTs !== input.canonical.expiresAtMs
    || input.source.invalidationSpec.expiresTs !== input.expiration.expiresAtMs) {
    throw new TypeError('Basis machine expiry diverges from canonical or bound expiration');
  }
  const intake = buildIntake({
    canonical: input.canonical,
    configuration: input.configuration,
    expiration: input.expiration,
    metadata: input.metadata,
    instruments: input.instruments,
    economics: input.economics,
    evaluatedAtMs: input.evaluatedAtMs,
  }, 'BASIS');
  return cloneAndFreeze({
    intake,
    structure: {
      kind: 'BASIS_TWO_LEG' as const,
      spotInstrumentId: input.instruments.spotInstrumentId,
      perpetualInstrumentId: input.instruments.perpetualInstrumentId,
    },
  });
}

/** Float-rejecting Volume compatibility adapter. No capital authority. */
export function adaptVolumeProposalToCapitalCandidate(
  input: Readonly<VolumeProposalCompatibilityInput>,
): Readonly<CompatibleVolumeOpportunitySeed> {
  validateSource(input.source, input.canonical, 'VOLUME', input.metadata);
  const intake = buildIntake({
    canonical: input.canonical,
    configuration: input.configuration,
    expiration: input.expiration,
    metadata: input.metadata,
    instruments: input.instruments,
    economics: input.economics,
    evaluatedAtMs: input.evaluatedAtMs,
  }, 'VOLUME');
  return cloneAndFreeze({
    intake,
    structure: {
      kind: 'VOLUME_DIRECTIONAL' as const,
      instrumentId: input.instruments.instrumentId,
    },
  });
}

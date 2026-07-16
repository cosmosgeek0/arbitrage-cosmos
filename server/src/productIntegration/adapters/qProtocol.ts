import { isValidUtcMillis, type Completeness, type DataAuthority } from '../../foundation/contracts/index.js';
import type { ProductQAssessmentReference } from '../contracts/index.js';
import { canonicalProductJson } from '../contracts/index.js';

export const EDGE_PROTOCOL_COMMIT = '73e1a1ff7daa48df8dac45713fc5f106842edafc' as const;
export const EDGE_PROTOCOL_DOCUMENT_SHA256 = '951fdbb5f347f900c61e60055f90cf2e1e1e743b75b7dc733652acb8d43353a1' as const;
export const EDGE_PROTOCOL_SCHEMA_SHA256 = '229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c' as const;
export const EDGE_PROTOCOL_VERSION = 1 as const;

/** Narrow projection produced only after the generated schema client accepts the full envelope. */
export interface QAssessmentProtocolProjection {
  readonly revision: number;
  readonly assessmentId: string;
  readonly traceId: string;
  readonly strategyFamily: string;
  readonly hypothesisId: string;
  readonly symbol: string;
  readonly parentEvidenceIds: readonly string[];
  readonly eventTimeMs: number | null;
  readonly receiveTimeMs: number;
  readonly generationTimeMs: number;
  readonly expiryTimeMs: number;
  readonly predictionTargets: readonly string[];
  readonly uncertainty: Readonly<{
    epistemic: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
    model: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
    data: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  }>;
  readonly oodState: 'IN_DISTRIBUTION' | 'NEAR_BOUNDARY' | 'OUT_OF_DISTRIBUTION' | 'UNKNOWN';
  readonly driftState: 'STABLE' | 'DRIFTING' | 'BROKEN' | 'UNKNOWN';
  readonly advisoryAction: 'IGNORE' | 'WATCH' | 'FOCUS' | 'PROPOSE_CONSIDERATION' | 'ABSTAIN_UNKNOWN';
  readonly abstentionReasonCodes: readonly string[];
  readonly sourceQuality: Readonly<{
    freshness: 'FRESH' | 'STALE' | 'UNKNOWN';
    completeness: 'COMPLETE' | 'PARTIAL' | 'SAMPLED' | 'UNAVAILABLE' | 'UNKNOWN';
    gapCount: number;
    duplicate: boolean;
    reconstructed: boolean;
  }>;
  readonly lineage: Readonly<{
    datasetVersion: string;
    featureVersion: string;
    labelVersion: string;
    modelVersion: string;
    calibrationVersion: string;
  }>;
  /** Deployment/config provenance supplied by the accepted Q runtime handshake; null remains unavailable. */
  readonly configVersion: string | null;
  readonly economicAssumptionState: 'LIVE' | 'HYPOTHETICAL';
  readonly economicAssumptionExpiresAtMs: number;
  readonly missingEconomicFields: readonly string[];
}

export interface QSchemaValidationReceipt {
  readonly schema: 'EdgeAssessmentEnvelopeV1';
  readonly version: 1;
  readonly schemaSha256: string;
  readonly envelopeHash: string;
  readonly envelopeId: string;
  readonly byteLength: number;
  readonly accepted: boolean;
  readonly issueCodes: readonly string[];
  readonly validatedProjectionJson: string;
}

export interface QProtocolHandshake {
  readonly protocolCommit: string;
  readonly protocolVersion: number;
  readonly schemaSha256: string;
  readonly producerBuild: string | null;
  readonly championModelVersion: string | null;
}

export type QProtocolHandshakeResult =
  | { readonly compatible: true; readonly reasonCode: null }
  | { readonly compatible: false; readonly reasonCode: 'PROTOCOL_VERSION_UNSUPPORTED' | 'PROTOCOL_SCHEMA_MISMATCH' | 'CHAMPION_UNAVAILABLE' };

const ID = /^[A-Za-z0-9_.:\-]{1,128}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,99}$/;
const HASH = /^[a-f0-9]{64}$/;

/** Pin the frozen protocol without assuming that a Q runtime exists. */
export function evaluateQProtocolHandshake(handshake: QProtocolHandshake): Readonly<QProtocolHandshakeResult> {
  if (!HASH.test(handshake.schemaSha256)) throw new TypeError('schemaSha256 is invalid');
  if (handshake.protocolVersion !== EDGE_PROTOCOL_VERSION || handshake.protocolCommit !== EDGE_PROTOCOL_COMMIT) {
    return Object.freeze({ compatible: false, reasonCode: 'PROTOCOL_VERSION_UNSUPPORTED' });
  }
  if (handshake.schemaSha256 !== EDGE_PROTOCOL_SCHEMA_SHA256) return Object.freeze({ compatible: false, reasonCode: 'PROTOCOL_SCHEMA_MISMATCH' });
  if (handshake.championModelVersion === null || handshake.championModelVersion.trim().length === 0 || handshake.championModelVersion.length > 256) return Object.freeze({ compatible: false, reasonCode: 'CHAMPION_UNAVAILABLE' });
  return Object.freeze({ compatible: true, reasonCode: null });
}

function completeness(value: QAssessmentProtocolProjection['sourceQuality']['completeness']): Completeness {
  if (value === 'COMPLETE') return 'COMPLETE';
  if (value === 'PARTIAL' || value === 'SAMPLED') return 'PARTIAL';
  return 'UNAVAILABLE';
}

/**
 * Adapt one already schema-validated Q envelope into a reference. This never
 * creates an opportunity or changes Capital/Risk/execution authority.
 */
export function projectQAssessmentReference(
  input: QAssessmentProtocolProjection,
  validation: QSchemaValidationReceipt,
  nowMs: number,
  verifiedAcquisitionAuthority: Extract<DataAuthority, 'DERIVED_LIVE' | 'RECORDED_REPLAY' | 'SYNTHETIC_TEST' | 'UNAVAILABLE'>,
): Readonly<ProductQAssessmentReference> {
  if (validation.schema !== 'EdgeAssessmentEnvelopeV1'
      || validation.version !== 1
      || validation.schemaSha256 !== EDGE_PROTOCOL_SCHEMA_SHA256
      || validation.accepted !== true
      || validation.envelopeId !== input.assessmentId
      || !HASH.test(validation.envelopeHash)
      || !Number.isSafeInteger(validation.byteLength)
      || validation.byteLength < 1
      || validation.byteLength > 262_144
      || !Array.isArray(validation.issueCodes)
      || validation.issueCodes.length > 0) throw new TypeError('full EdgeAssessmentEnvelopeV1 schema-validation receipt is invalid');
  if (validation.validatedProjectionJson !== canonicalProductJson(input)) throw new TypeError('schema-validation receipt is not bound to this assessment projection');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new TypeError('assessment revision is invalid');
  for (const [name, value] of [['assessmentId', input.assessmentId], ['traceId', input.traceId], ['hypothesisId', input.hypothesisId]] as const) if (!ID.test(value)) throw new TypeError(`${name} is invalid`);
  for (const [name, value] of [['strategyFamily', input.strategyFamily], ['symbol', input.symbol]] as const) if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) throw new TypeError(`${name} is invalid`);
  for (const [name, value] of Object.entries(input.lineage)) if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) throw new TypeError(`lineage.${name} is invalid`);
  if (input.configVersion !== null && (typeof input.configVersion !== 'string' || input.configVersion.trim().length === 0 || input.configVersion.length > 256)) throw new TypeError('configVersion is invalid');
  if (!Array.isArray(input.parentEvidenceIds) || input.parentEvidenceIds.length > 1_024 || input.parentEvidenceIds.some((value) => !ID.test(value))) throw new TypeError('parentEvidenceIds are invalid');
  if (input.eventTimeMs !== null && !isValidUtcMillis(input.eventTimeMs)) throw new TypeError('eventTimeMs is invalid');
  if (!isValidUtcMillis(input.receiveTimeMs) || !isValidUtcMillis(input.generationTimeMs) || !isValidUtcMillis(input.expiryTimeMs) || !isValidUtcMillis(input.economicAssumptionExpiresAtMs) || !isValidUtcMillis(nowMs)) throw new TypeError('assessment timestamps are invalid');
  if (input.receiveTimeMs > input.generationTimeMs || input.generationTimeMs > input.expiryTimeMs) throw new TypeError('assessment timestamps are not monotonic');
  if (input.eventTimeMs !== null && input.eventTimeMs > input.receiveTimeMs) throw new TypeError('eventTimeMs cannot follow receiveTimeMs');
  if (!['DERIVED_LIVE', 'RECORDED_REPLAY', 'SYNTHETIC_TEST', 'UNAVAILABLE'].includes(verifiedAcquisitionAuthority)) throw new TypeError('verifiedAcquisitionAuthority is invalid');
  if (!Array.isArray(input.abstentionReasonCodes) || input.abstentionReasonCodes.length > 64 || input.abstentionReasonCodes.some((value) => !CODE.test(value))) throw new TypeError('abstentionReasonCodes are invalid');
  if (!Array.isArray(input.predictionTargets) || input.predictionTargets.length > 64 || input.predictionTargets.some((value) => typeof value !== 'string' || value.length === 0 || value.length > 256)) throw new TypeError('predictionTargets are invalid');
  const uncertaintyValues = ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'];
  if (!uncertaintyValues.includes(input.uncertainty.epistemic) || !uncertaintyValues.includes(input.uncertainty.model) || !uncertaintyValues.includes(input.uncertainty.data)) throw new TypeError('uncertainty is invalid');
  if (!['IN_DISTRIBUTION', 'NEAR_BOUNDARY', 'OUT_OF_DISTRIBUTION', 'UNKNOWN'].includes(input.oodState)) throw new TypeError('oodState is invalid');
  if (!['STABLE', 'DRIFTING', 'BROKEN', 'UNKNOWN'].includes(input.driftState)) throw new TypeError('driftState is invalid');
  if (!['LIVE', 'HYPOTHETICAL'].includes(input.economicAssumptionState)) throw new TypeError('economicAssumptionState is invalid');
  if (!Array.isArray(input.missingEconomicFields) || input.missingEconomicFields.length > 256 || input.missingEconomicFields.some((value) => typeof value !== 'string' || value.length === 0 || value.length > 256)) throw new TypeError('missingEconomicFields are invalid');
  if (!Number.isSafeInteger(input.sourceQuality.gapCount) || input.sourceQuality.gapCount < 0) throw new TypeError('sourceQuality.gapCount is invalid');
  const mappedCompleteness = completeness(input.sourceQuality.completeness);
  const reasons = [...input.abstentionReasonCodes];
  if (nowMs > input.expiryTimeMs) reasons.push('ASSESSMENT_EXPIRED');
  if (input.sourceQuality.freshness !== 'FRESH') reasons.push(`SOURCE_${input.sourceQuality.freshness}`);
  if (mappedCompleteness !== 'COMPLETE') reasons.push(`SOURCE_${mappedCompleteness}`);
  if (input.sourceQuality.gapCount > 0) reasons.push('SOURCE_GAPS_PRESENT');
  if (input.sourceQuality.completeness === 'SAMPLED') reasons.push('SOURCE_SAMPLED_LOWER_BOUND');
  if (input.sourceQuality.duplicate) reasons.push('DUPLICATE_SOURCE_EVIDENCE');
  if (input.configVersion === null) reasons.push('CONFIG_PROVENANCE_UNAVAILABLE');
  if (nowMs > input.economicAssumptionExpiresAtMs) reasons.push('ECONOMIC_ASSUMPTIONS_EXPIRED');
  if (input.missingEconomicFields.length > 0) reasons.push('ECONOMIC_ASSUMPTIONS_INCOMPLETE');
  if (verifiedAcquisitionAuthority === 'UNAVAILABLE') reasons.push('ACQUISITION_AUTHORITY_UNAVAILABLE');
  const mustAbstain = input.advisoryAction === 'ABSTAIN_UNKNOWN' || reasons.length > 0;
  return Object.freeze({
    protocolVersion: 1,
    protocolSchemaSha256: validation.schemaSha256,
    assessmentId: input.assessmentId,
    traceId: input.traceId,
    envelopeHash: validation.envelopeHash,
    revision: input.revision,
    strategyFamily: input.strategyFamily,
    hypothesisId: input.hypothesisId,
    symbol: input.symbol,
    datasetVersion: input.lineage.datasetVersion,
    featureVersion: input.lineage.featureVersion,
    labelVersion: input.lineage.labelVersion,
    modelVersion: input.lineage.modelVersion,
    calibrationVersion: input.lineage.calibrationVersion,
    configVersion: input.configVersion,
    advisoryAction: input.advisoryAction,
    disposition: mustAbstain ? 'ABSTAIN' : 'USABLE_ADVISORY',
    authority: nowMs > input.expiryTimeMs || input.sourceQuality.freshness !== 'FRESH' ? 'UNAVAILABLE' : verifiedAcquisitionAuthority,
    completeness: mappedCompleteness,
    generatedAtMs: input.generationTimeMs,
    eventTimeMs: input.eventTimeMs,
    receiveAtMs: input.receiveTimeMs,
    expiresAtMs: input.expiryTimeMs,
    uncertainty: Object.freeze({ ...input.uncertainty }),
    oodState: input.oodState,
    driftState: input.driftState,
    sourceQuality: Object.freeze({
      freshness: input.sourceQuality.freshness,
      protocolCompleteness: input.sourceQuality.completeness,
      gapCount: input.sourceQuality.gapCount,
      duplicate: input.sourceQuality.duplicate,
      reconstructed: input.sourceQuality.reconstructed,
    }),
    predictionTargets: Object.freeze([...input.predictionTargets]),
    economicAssumptionState: input.economicAssumptionState,
    economicAssumptionExpiresAtMs: input.economicAssumptionExpiresAtMs,
    missingEconomicFields: Object.freeze([...input.missingEconomicFields]),
    reasonCodes: Object.freeze([...new Set(reasons)]),
    parentEvidenceIds: Object.freeze([...input.parentEvidenceIds]),
  });
}

import {
  stableId,
  validateFrozenPreEventRecord,
  validateNoSecretFields,
  validateNormalizedEvidence,
  type FeatureValue,
  type ForensicCheck,
  type FrozenPreEventRecord,
  type NormalizedEvidence,
  type ThesisEvidence,
  type ThesisPacket,
  type TruthMetadata,
  type ValidationResult,
} from '../contracts/index.js';
import type { FreezePreEventInput, FreezeResult } from './types.js';
import {
  compareText,
  derivedTruth,
  failure,
  immutableContract,
  isNonNegativeSafeInteger,
  nonEmpty,
  reAgeTruth,
} from './internal.js';

function canonicalFact(fact: ThesisEvidence, cutoff: number): ValidationResult<ThesisEvidence> {
  const truth = reAgeTruth(fact.truth, cutoff);
  if (!truth.ok) return truth as ValidationResult<ThesisEvidence>;
  return { ok: true, value: {
    ...fact,
    featureIds: [...new Set(fact.featureIds)].sort(compareText),
    evidenceIds: [...new Set(fact.evidenceIds)].sort(compareText),
    truth: truth.value,
  } };
}

function canonicalThesis(thesis: ThesisPacket, cutoff: number): ValidationResult<ThesisPacket> {
  const truth = reAgeTruth(thesis.truth, cutoff);
  if (!truth.ok) return truth as ValidationResult<ThesisPacket>;
  const facts = (values: readonly ThesisEvidence[]): ValidationResult<ThesisEvidence[]> => {
    const output: ThesisEvidence[] = [];
    for (const value of values) {
      const fact = canonicalFact(value, cutoff);
      if (!fact.ok) return fact as ValidationResult<ThesisEvidence[]>;
      output.push(fact.value);
    }
    output.sort((a, b) => compareText(a.id, b.id));
    return { ok: true, value: output };
  };
  const supporting = facts(thesis.supporting);
  if (!supporting.ok) return supporting as ValidationResult<ThesisPacket>;
  const conflicting = facts(thesis.conflicting);
  if (!conflicting.ok) return conflicting as ValidationResult<ThesisPacket>;
  const neutral = facts(thesis.neutral);
  if (!neutral.ok) return neutral as ValidationResult<ThesisPacket>;
  const unavailable = facts(thesis.unavailable);
  if (!unavailable.ok) return unavailable as ValidationResult<ThesisPacket>;
  return { ok: true, value: {
    ...thesis,
    supporting: supporting.value,
    conflicting: conflicting.value,
    neutral: neutral.value,
    unavailable: unavailable.value,
    tradeability: {
      ...thesis.tradeability,
      reasonCodes: [...new Set(thesis.tradeability.reasonCodes)].sort(compareText),
      requiredEvidenceIds: [...new Set(thesis.tradeability.requiredEvidenceIds)].sort(compareText),
      missingEvidenceKinds: [...new Set(thesis.tradeability.missingEvidenceKinds)].sort(compareText),
    },
    analogueIds: [...new Set(thesis.analogueIds)].sort(compareText),
    reasonCodes: [...new Set(thesis.reasonCodes)].sort(compareText),
    truth: truth.value,
  } };
}

function canonicalForensic(check: ForensicCheck, cutoff: number): ValidationResult<ForensicCheck> {
  const truth = reAgeTruth(check.truth, cutoff);
  if (!truth.ok) return truth as ValidationResult<ForensicCheck>;
  return { ok: true, value: {
    ...check,
    reasonCodes: [...new Set(check.reasonCodes)].sort(compareText),
    evidenceIds: [...new Set(check.evidenceIds)].sort(compareText),
    truth: truth.value,
  } };
}

function canonicalFeature(feature: FeatureValue, cutoff: number): ValidationResult<FeatureValue> {
  const truth = reAgeTruth(feature.truth, cutoff);
  if (!truth.ok) return truth as ValidationResult<FeatureValue>;
  return { ok: true, value: { ...feature, truth: truth.value } };
}

function upstreamTruth(
  thesis: ThesisPacket,
  forensics: readonly ForensicCheck[],
  evidenceTruth: readonly TruthMetadata[],
  features: readonly FeatureValue[],
): TruthMetadata[] {
  return [
    thesis.truth,
    ...thesis.supporting.map((fact) => fact.truth),
    ...thesis.conflicting.map((fact) => fact.truth),
    ...thesis.neutral.map((fact) => fact.truth),
    ...thesis.unavailable.map((fact) => fact.truth),
    ...forensics.map((check) => check.truth),
    ...evidenceTruth,
    ...features.map((feature) => feature.truth),
  ];
}

export function freezePreEvent(input: FreezePreEventInput): FreezeResult {
  const secret = validateNoSecretFields(input, 'outcomes.freeze');
  if (!secret.ok) return secret as FreezeResult;
  const cutoff = input.evidenceCutoffTimeMs ?? input.triggerTimeMs;
  if (!isNonNegativeSafeInteger(input.triggerTimeMs) || !isNonNegativeSafeInteger(cutoff)) {
    return failure('INVALID_VALUE', 'outcomes.freeze', 'trigger and evidence cutoff must be non-negative safe integers', 'triggerTimeMs');
  }
  if (cutoff > input.triggerTimeMs) {
    return failure('NO_LOOK_AHEAD_VIOLATION', 'outcomes.freeze', 'evidence cutoff cannot follow the trigger', 'evidenceCutoffTimeMs');
  }
  if (!['ACCEPTED', 'REJECTED', 'OBSERVED'].includes(input.candidateDisposition)) {
    return failure('INVALID_VARIANT', 'outcomes.freeze', 'unknown candidate disposition', 'candidateDisposition');
  }
  if (!nonEmpty(input.configurationVersion) || !nonEmpty(input.featureVersion) || !nonEmpty(input.producerVersion)) {
    return failure('INVALID_VALUE', 'outcomes.freeze', 'versions must be non-empty', 'configurationVersion');
  }

  const evidence: NormalizedEvidence[] = [];
  for (const item of input.evidence) {
    const validated = validateNormalizedEvidence(item);
    if (!validated.ok) return validated as FreezeResult;
    const truth = reAgeTruth(validated.value.truth, cutoff);
    if (!truth.ok) return truth as FreezeResult;
    const revalidated = validateNormalizedEvidence({ ...validated.value, truth: truth.value });
    if (!revalidated.ok) return revalidated as FreezeResult;
    evidence.push(revalidated.value);
  }
  evidence.sort((a, b) => compareText(a.id, b.id));
  const features: FeatureValue[] = [];
  for (const item of input.features) {
    const feature = canonicalFeature(item, cutoff);
    if (!feature.ok) return feature as FreezeResult;
    features.push(feature.value);
  }
  features.sort((a, b) => compareText(a.id, b.id));
  const forensics: ForensicCheck[] = [];
  for (const item of input.forensics) {
    const forensic = canonicalForensic(item, cutoff);
    if (!forensic.ok) return forensic as FreezeResult;
    forensics.push(forensic.value);
  }
  forensics.sort((a, b) => compareText(a.id, b.id));
  const thesisResult = canonicalThesis(input.thesis, cutoff);
  if (!thesisResult.ok) return thesisResult as FreezeResult;
  const thesis = thesisResult.value;
  const truths = upstreamTruth(thesis, forensics, evidence.map((item) => item.truth), features);
  const degraded = truths.filter((truth) => truth.completeness.state !== 'COMPLETE' || truth.freshness.state !== 'FRESH');
  const missingFields = degraded.flatMap((truth) => [
    ...truth.completeness.missingFields.map((field) => `upstream:${truth.authority.sourceId}:${field}`),
    ...(truth.freshness.state === 'FRESH' ? [] : [`freshness:${truth.authority.sourceId}`]),
  ]);
  const reasonCodes = degraded.flatMap((truth) => [
    ...truth.completeness.reasonCodes,
    ...(truth.freshness.state === 'FRESH' ? [] : [`UPSTREAM_FRESHNESS_${truth.freshness.state}`]),
  ]);
  const memberIds = [
    thesis.id,
    ...forensics.map((check) => check.id),
    ...evidence.map((item) => item.id),
    ...features.map((feature) => feature.id),
  ];
  const id = stableId('frozen_record', {
    triggerTimeMs: input.triggerTimeMs,
    evidenceCutoffTimeMs: cutoff,
    candidateDisposition: input.candidateDisposition,
    thesisId: thesis.id,
    memberIds: [...memberIds].sort(compareText),
    configurationVersion: input.configurationVersion,
    featureVersion: input.featureVersion,
  });
  const truth = derivedTruth({
    dataset: 'frozen-pre-event-record',
    producerVersion: input.producerVersion,
    configurationVersion: input.configurationVersion,
    featureVersion: input.featureVersion,
    receivedTimeMs: cutoff,
    sourceEventTimeMs: cutoff,
    maxAgeMs: 0,
    upstreamTruth: truths,
    sourceRecordIds: memberIds,
    transform: 'outcomes.freeze.v1',
    completenessState: degraded.length === 0 ? 'COMPLETE' : 'PARTIAL',
    observedFields: ['thesis', 'forensics', 'evidence', 'features'],
    missingFields,
    reasonCodes,
  });
  const record: FrozenPreEventRecord = {
    id,
    triggerTimeMs: input.triggerTimeMs,
    evidenceCutoffTimeMs: cutoff,
    candidateDisposition: input.candidateDisposition,
    thesis,
    forensics,
    evidence,
    features,
    configurationVersion: input.configurationVersion,
    featureVersion: input.featureVersion,
    truth,
  };
  const validated = validateFrozenPreEventRecord(record);
  if (!validated.ok) return validated;
  return { ok: true, value: immutableContract(validated.value) };
}

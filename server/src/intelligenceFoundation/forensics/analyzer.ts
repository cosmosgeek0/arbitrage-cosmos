import {
  makeStableFailure,
  sortedUnique,
  stableSetId,
  validateNoSecretFields,
  validateNormalizedEvidence,
  validateTruthMetadata,
  type FeatureValue,
  type NormalizedEvidence,
  type StableFailure,
  type TruthMetadata,
  type ValidationResult,
} from '../contracts/index.js';
import { runForensicChecks } from './checks.js';
import { forensicsConfig, type ForensicsConfig } from './config.js';
import { derivedForensicsTruth } from './truth.js';
import type {
  ForensicsInput,
  ForensicsReport,
  ForensicsResult,
  HistoricalWakeupEpisode,
} from './types.js';

function fail(
  code: StableFailure['code'],
  message: string,
  field: string | null,
  evidenceIds: string[] = [],
): ForensicsResult {
  return { ok: false, failure: makeStableFailure(code, 'intelligence.forensics', message, field, evidenceIds) };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

function safeTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function finiteOrNull(value: unknown): value is number | null {
  return value === null || typeof value === 'number' && Number.isFinite(value);
}

function truthHasFutureTime(truth: TruthMetadata, evaluatedAtMs: number): boolean {
  return [
    truth.temporal.sourceEventTimeMs,
    truth.temporal.sourceTransactionTimeMs,
    truth.temporal.receivedTimeMs,
    truth.freshness.evaluatedAtMs,
  ].some((time) => time !== null && time > evaluatedAtMs);
}

function validateFeature(feature: FeatureValue, input: ForensicsInput): ValidationResult<FeatureValue> {
  if (
    !feature ||
    !nonEmptyString(feature.id) ||
    feature.instrumentId !== input.instrumentId ||
    !nonEmptyString(feature.feature) ||
    !nonEmptyString(feature.featureVersion) ||
    !nonEmptyString(feature.unit) ||
    !(feature.windowMs === null || positiveSafeInteger(feature.windowMs)) ||
    !(feature.value === null || typeof feature.value === 'string' || typeof feature.value === 'boolean' || typeof feature.value === 'number' && Number.isFinite(feature.value)) ||
    !(feature.observationStartMs === null || safeTime(feature.observationStartMs)) ||
    !(feature.observationEndMs === null || safeTime(feature.observationEndMs)) ||
    ((feature.observationStartMs === null) !== (feature.observationEndMs === null)) ||
    (feature.observationStartMs !== null && feature.observationEndMs !== null && feature.observationStartMs > feature.observationEndMs)
  ) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', 'intelligence.forensics', 'invalid feature record', 'features', [feature?.id].filter(nonEmptyString)) };
  }
  const truth = validateTruthMetadata(feature.truth);
  if (!truth.ok) return truth as ValidationResult<FeatureValue>;
  if ((feature.observationEndMs ?? 0) > input.evaluatedAtMs || truthHasFutureTime(truth.value, input.evaluatedAtMs)) {
    return { ok: false, failure: makeStableFailure('NO_LOOK_AHEAD_VIOLATION', 'intelligence.forensics', 'feature record is newer than the forensic evaluation', 'features', [feature.id]) };
  }
  return { ok: true, value: { ...feature, truth: truth.value } };
}

function validateHistory(episode: HistoricalWakeupEpisode, input: ForensicsInput): ValidationResult<HistoricalWakeupEpisode> {
  if (
    !episode ||
    !nonEmptyString(episode.id) ||
    episode.symbol !== input.symbol ||
    episode.instrumentId !== input.instrumentId ||
    !safeTime(episode.triggerTimeMs) ||
    !positiveSafeInteger(episode.horizonMs) ||
    !Number.isSafeInteger(episode.triggerTimeMs + episode.horizonMs) ||
    !finiteOrNull(episode.peakReturnPct) ||
    !finiteOrNull(episode.closingReturnPct) ||
    !finiteOrNull(episode.fadeFromPeakPct) ||
    (episode.fadeFromPeakPct !== null && episode.fadeFromPeakPct < 0) ||
    typeof episode.complete !== 'boolean' ||
    !Array.isArray(episode.evidenceIds) ||
    episode.evidenceIds.length > 256 ||
    !episode.evidenceIds.every(nonEmptyString)
  ) {
    return { ok: false, failure: makeStableFailure('INVALID_VALUE', 'intelligence.forensics', 'invalid historical wake-up episode', 'history', [episode?.id].filter(nonEmptyString)) };
  }
  const truth = validateTruthMetadata(episode.truth);
  if (!truth.ok) return truth as ValidationResult<HistoricalWakeupEpisode>;
  if (
    episode.triggerTimeMs > input.evaluatedAtMs ||
    (episode.complete && episode.triggerTimeMs + episode.horizonMs > input.evaluatedAtMs) ||
    truthHasFutureTime(truth.value, input.evaluatedAtMs)
  ) {
    return { ok: false, failure: makeStableFailure('NO_LOOK_AHEAD_VIOLATION', 'intelligence.forensics', 'historical episode reaches beyond the forensic evaluation', 'history', episode.evidenceIds) };
  }
  return {
    ok: true,
    value: { ...episode, evidenceIds: sortedUnique(episode.evidenceIds), truth: truth.value },
  };
}

function validateInput(input: ForensicsInput, config: Readonly<ForensicsConfig>): ValidationResult<ForensicsInput> {
  const secret = validateNoSecretFields(input, 'intelligence.forensics');
  if (!secret.ok) return secret as ValidationResult<ForensicsInput>;
  if (
    !input ||
    !nonEmptyString(input.symbol) ||
    !nonEmptyString(input.instrumentId) ||
    !safeTime(input.evaluatedAtMs) ||
    !(input.candidateObservedAtMs === null || safeTime(input.candidateObservedAtMs)) ||
    (input.candidateObservedAtMs !== null && input.candidateObservedAtMs > input.evaluatedAtMs) ||
    !(input.intendedQuoteNotional === null || typeof input.intendedQuoteNotional === 'number' && Number.isFinite(input.intendedQuoteNotional) && input.intendedQuoteNotional > 0) ||
    !nonEmptyString(input.configurationVersion) ||
    !nonEmptyString(input.featureVersion) ||
    !Array.isArray(input.evidence) ||
    !Array.isArray(input.features) ||
    !Array.isArray(input.history)
  ) return { ok: false, failure: makeStableFailure('INVALID_VALUE', 'intelligence.forensics', 'invalid forensic input envelope', null) };
  if (input.evidence.length > config.maxEvidenceRecords) {
    return { ok: false, failure: makeStableFailure('BUDGET_EXHAUSTED', 'intelligence.forensics', 'evidence input exceeds configured bound', 'evidence') };
  }
  if (input.features.length > config.maxFeatureRecords) {
    return { ok: false, failure: makeStableFailure('BUDGET_EXHAUSTED', 'intelligence.forensics', 'feature input exceeds configured bound', 'features') };
  }
  if (input.history.length > config.maxHistoryEpisodes) {
    return { ok: false, failure: makeStableFailure('BUDGET_EXHAUSTED', 'intelligence.forensics', 'history input exceeds configured bound', 'history') };
  }

  const evidence: NormalizedEvidence[] = [];
  const evidenceIds = new Set<string>();
  for (const candidate of input.evidence) {
    const validated = validateNormalizedEvidence(candidate);
    if (!validated.ok) return validated as ValidationResult<ForensicsInput>;
    const record = validated.value;
    if (record.instrument.symbol !== input.symbol) {
      return { ok: false, failure: makeStableFailure('INVALID_VALUE', 'intelligence.forensics', 'evidence symbol does not match input scope', 'evidence.instrument.symbol', [record.id]) };
    }
    if (evidenceIds.has(record.id)) {
      return { ok: false, failure: makeStableFailure('DUPLICATE_EVENT', 'intelligence.forensics', 'duplicate evidence ID rejected', 'evidence.id', [record.id]) };
    }
    if (truthHasFutureTime(record.truth, input.evaluatedAtMs)) {
      return { ok: false, failure: makeStableFailure('NO_LOOK_AHEAD_VIOLATION', 'intelligence.forensics', 'evidence is newer than the forensic evaluation', 'evidence.truth.temporal', [record.id]) };
    }
    evidenceIds.add(record.id);
    evidence.push(record);
  }

  const features: FeatureValue[] = [];
  const featureIds = new Set<string>();
  for (const candidate of input.features) {
    const validated = validateFeature(candidate, input);
    if (!validated.ok) return validated as ValidationResult<ForensicsInput>;
    if (featureIds.has(validated.value.id)) {
      return { ok: false, failure: makeStableFailure('DUPLICATE_EVENT', 'intelligence.forensics', 'duplicate feature ID rejected', 'features.id', [validated.value.id]) };
    }
    featureIds.add(validated.value.id);
    features.push(validated.value);
  }

  const history: HistoricalWakeupEpisode[] = [];
  const historyIds = new Set<string>();
  for (const candidate of input.history) {
    const validated = validateHistory(candidate, input);
    if (!validated.ok) return validated as ValidationResult<ForensicsInput>;
    if (historyIds.has(validated.value.id)) {
      return { ok: false, failure: makeStableFailure('DUPLICATE_EVENT', 'intelligence.forensics', 'duplicate history episode ID rejected', 'history.id', [validated.value.id]) };
    }
    historyIds.add(validated.value.id);
    history.push(validated.value);
  }

  evidence.sort((left, right) => {
    const leftTime = left.truth.temporal.sourceTransactionTimeMs ?? left.truth.temporal.sourceEventTimeMs ?? left.truth.temporal.receivedTimeMs;
    const rightTime = right.truth.temporal.sourceTransactionTimeMs ?? right.truth.temporal.sourceEventTimeMs ?? right.truth.temporal.receivedTimeMs;
    return leftTime - rightTime || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  });
  features.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  history.sort((left, right) => left.triggerTimeMs - right.triggerTimeMs || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return { ok: true, value: { ...input, evidence, features, history } };
}

function verifyOutput(report: ForensicsReport): ForensicsResult {
  for (const check of report.checks) {
    const truth = validateTruthMetadata(check.truth);
    if (!truth.ok) return fail('INTERNAL_CONTRACT_ERROR', 'forensic check produced invalid truth metadata', 'checks.truth', [check.id]);
  }
  const truth = validateTruthMetadata(report.truth);
  if (!truth.ok) return fail('INTERNAL_CONTRACT_ERROR', 'forensic report produced invalid truth metadata', 'truth', report.checks.map((check) => check.id));
  const secret = validateNoSecretFields(report, 'intelligence.forensics.output');
  if (!secret.ok) return secret as ForensicsResult;
  return { ok: true, value: report };
}

export function analyzeFalsePositiveForensics(
  input: ForensicsInput,
  overrides: Partial<ForensicsConfig> = {},
): ForensicsResult {
  let config: Readonly<ForensicsConfig>;
  try {
    config = forensicsConfig(overrides);
  } catch (error) {
    return fail('INVALID_VALUE', error instanceof Error ? error.message : 'invalid forensic configuration', 'config');
  }
  const validated = validateInput(input, config);
  if (!validated.ok) return validated;
  const normalized = validated.value;
  const checks = runForensicChecks(normalized, config);
  const blockingCheckIds = sortedUnique(checks
    .filter((check) => check.severity === 'BLOCK' && check.verdict === 'FAIL')
    .map((check) => check.id));
  const warningCheckIds = sortedUnique(checks
    .filter((check) => check.severity === 'WARN' && check.verdict !== 'PASS')
    .map((check) => check.id));
  const unknownRequiredCheckIds = sortedUnique(checks
    .filter((check) => check.required && check.verdict === 'UNKNOWN')
    .map((check) => check.id));
  const state = blockingCheckIds.length > 0 ? 'BLOCKED' : unknownRequiredCheckIds.length > 0 ? 'UNKNOWN' : 'CLEAR';
  const reasonCodes = sortedUnique([
    state === 'BLOCKED'
      ? 'FORENSICS_BLOCKING_FALSE_POSITIVE_OBSERVED'
      : state === 'UNKNOWN'
        ? 'FORENSICS_REQUIRED_CHECK_UNKNOWN'
        : 'FORENSICS_FALSE_POSITIVE_SCREEN_CLEAR',
    ...(warningCheckIds.length > 0 ? ['FORENSICS_NON_BLOCKING_WARNING_PRESENT'] : []),
  ]);
  const tradeability = {
    state,
    claimAllowed: state === 'CLEAR',
    blockingCheckIds,
    warningCheckIds,
    unknownRequiredCheckIds,
    reasonCodes,
  } as const;
  const unknownRequiredKinds = checks
    .filter((check) => check.required && check.verdict === 'UNKNOWN')
    .map((check) => `forensics.${check.check}.verdict`);
  const truth = derivedForensicsTruth({
    config,
    configurationVersion: normalized.configurationVersion,
    featureVersion: normalized.featureVersion,
    dataset: 'false-positive-forensics-report',
    evaluatedAtMs: normalized.evaluatedAtMs,
    truths: checks.map((check) => check.truth),
    recordIds: checks.map((check) => check.id),
    transforms: ['aggregate-required-checks-fail-closed'],
    observedFields: checks.filter((check) => check.verdict !== 'UNKNOWN').map((check) => `forensics.${check.check}.verdict`),
    missingFields: unknownRequiredKinds,
    reasonCodes,
  });
  const id = stableSetId('forensics-report', {
    symbol: normalized.symbol,
    instrumentId: normalized.instrumentId,
    evaluatedAtMs: normalized.evaluatedAtMs,
    candidateObservedAtMs: normalized.candidateObservedAtMs,
    configurationVersion: normalized.configurationVersion,
    featureVersion: normalized.featureVersion,
    checkIds: checks.map((check) => check.id),
    blockingCheckIds,
    warningCheckIds,
    unknownRequiredCheckIds,
  }, ['checkIds', 'blockingCheckIds', 'warningCheckIds', 'unknownRequiredCheckIds']);
  return verifyOutput({
    id,
    symbol: normalized.symbol,
    instrumentId: normalized.instrumentId,
    evaluatedAtMs: normalized.evaluatedAtMs,
    checks,
    tradeability,
    truth,
  });
}

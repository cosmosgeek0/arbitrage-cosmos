/** Pure, target-cohort aggregation with exact arithmetic and named exclusion. */
import {
  canonicalJson,
  createStructuredFailure,
  fail,
  failureFromIssues,
  isStrategySource,
  isValidUtcMillis,
  ok,
  stableHash128Hex,
  type ValidationIssue,
} from '../contracts/index.js';
import { validateProposalOutcomeRecord } from './record.js';
import {
  CALIBRATION_FAILURE_CODES,
  MAX_CALIBRATION_RECORDS,
  MAX_CALIBRATION_VALIDATION_ISSUES,
  OUTCOME_RESULT_UNITS,
  PROBABILITY_PPM_SCALE,
  type AggregateProposalOutcomesInput,
  type CalibrationCohort,
  type CalibrationExclusion,
  type CalibrationExclusionReason,
  type CalibrationMetrics,
  type CalibrationReport,
  type CalibrationReportResult,
  type ExactFraction,
  type ExactIntegerAggregate,
  type MissingEvidenceCount,
  type MissingEvidenceReason,
  type ProbabilityCalibrationMetrics,
  type ProposalOutcomeRecord,
} from './types.js';

const COMPONENT = 'foundation.calibration';
const AGGREGATE_KEYS = Object.freeze(['nowMs', 'correlationId', 'cohort', 'records'] as const);
const COHORT_KEYS = Object.freeze([
  'source',
  'strategySchema',
  'configVersion',
  'direction',
  'resultUnit',
  'observationHorizonMs',
] as const);

type IntegerMetricKey =
  | 'grossResultMicrounits'
  | 'feesMicrounits'
  | 'slippageMicrounits'
  | 'otherCostsMicrounits'
  | 'netResultMicrounits'
  | 'fillRatioPpm';

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function issue(issues: ValidationIssue[], path: string, code: string, message: string): void {
  if (issues.length < MAX_CALIBRATION_VALIDATION_ISSUES) issues.push({ path, code, message });
}

function label(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function inspectExactRecord(
  raw: unknown,
  expectedKeys: readonly string[],
  prefix: string,
  issues: ValidationIssue[],
): Record<string, unknown> | null {
  if (!isRecord(raw)) {
    issue(issues, prefix, 'OBJECT_REQUIRED', `${prefix || 'value'} must be a plain object`);
    return null;
  }
  const expected = new Set(expectedKeys);
  let safe = true;
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== 'string') {
      issue(issues, prefix, 'SYMBOL_FIELD_FORBIDDEN', 'symbol fields are forbidden');
      safe = false;
      continue;
    }
    const path = prefix ? `${prefix}.${key}` : key;
    if (!expected.has(key)) {
      issue(issues, path, 'UNKNOWN_FIELD', 'unexpected aggregation field');
      safe = false;
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      issue(issues, path, 'DATA_FIELD_REQUIRED', 'field must be an enumerable data property');
      safe = false;
    }
  }
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      issue(issues, prefix ? `${prefix}.${key}` : key, 'REQUIRED_FIELD_MISSING', 'required explicit field is missing');
      safe = false;
    }
  }
  return safe ? raw : null;
}

function inspectRecordArray(value: unknown, issues: ValidationIssue[]): readonly unknown[] | null {
  if (!Array.isArray(value)) {
    issue(issues, 'records', 'ARRAY_REQUIRED', 'records must be an array');
    return null;
  }
  if (value.length > MAX_CALIBRATION_RECORDS) {
    issue(issues, 'records', 'ARRAY_LIMIT_EXCEEDED', `records must contain at most ${MAX_CALIBRATION_RECORDS} entries`);
    return null;
  }
  let safe = true;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      issue(issues, 'records', 'SYMBOL_FIELD_FORBIDDEN', 'record arrays cannot carry symbol properties');
      safe = false;
      continue;
    }
    if (key === 'length') continue;
    if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
      issue(issues, `records.${key}`, 'ARRAY_SIDE_PROPERTY', 'record arrays cannot carry named side-properties');
      safe = false;
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      issue(issues, `records[${index}]`, 'SPARSE_OR_ACCESSOR_ELEMENT', 'records must contain dense enumerable data values');
      safe = false;
    }
  }
  return safe ? value : null;
}

function validateCohort(value: unknown, issues: ValidationIssue[]): void {
  const cohort = inspectExactRecord(value, COHORT_KEYS, 'cohort', issues);
  if (cohort === null) return;
  if (!isStrategySource(cohort.source)) {
    issue(issues, 'cohort.source', 'STRATEGY_SOURCE_INVALID', 'cohort source must be BASIS or VOLUME');
  }
  if (!label(cohort.strategySchema, 200)) {
    issue(issues, 'cohort.strategySchema', 'NON_EMPTY_STRING_REQUIRED', 'cohort strategySchema must be non-empty');
  }
  if (!label(cohort.configVersion, 200)) {
    issue(issues, 'cohort.configVersion', 'NON_EMPTY_STRING_REQUIRED', 'cohort configVersion must be non-empty');
  }
  if (!label(cohort.direction, 128)) {
    issue(issues, 'cohort.direction', 'NON_EMPTY_STRING_REQUIRED', 'cohort direction must be non-empty');
  }
  if (typeof cohort.resultUnit !== 'string' || !(OUTCOME_RESULT_UNITS as readonly string[]).includes(cohort.resultUnit)) {
    issue(issues, 'cohort.resultUnit', 'RESULT_UNIT_INVALID', 'cohort resultUnit is unsupported');
  }
  if (typeof cohort.observationHorizonMs !== 'number' || !Number.isSafeInteger(cohort.observationHorizonMs) || cohort.observationHorizonMs <= 0) {
    issue(issues, 'cohort.observationHorizonMs', 'POSITIVE_INTEGER_REQUIRED', 'cohort observationHorizonMs must be a positive safe integer');
  }
}

function validateRequest(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const inspected = inspectExactRecord(input, AGGREGATE_KEYS, '', issues);
  if (inspected === null) return issues;
  validateCohort(inspected.cohort, issues);
  const records = inspectRecordArray(inspected.records, issues);
  if (records === null) return issues;
  for (let index = 0; index < records.length; index += 1) {
    const path = `records[${index}]`;
    for (const recordIssue of validateProposalOutcomeRecord(records[index], inspected.nowMs as number)) {
      issue(
        issues,
        recordIssue.path ? `${path}.${recordIssue.path}` : path,
        recordIssue.code,
        recordIssue.message,
      );
    }
  }
  return issues;
}

function validateCaller(input: unknown): asserts input is AggregateProposalOutcomesInput {
  if (!isRecord(input)) throw new TypeError('aggregateProposalOutcomes: input must be a plain object');
  const now = Object.getOwnPropertyDescriptor(input, 'nowMs');
  const correlation = Object.getOwnPropertyDescriptor(input, 'correlationId');
  if (!now || now.get || now.set || !now.enumerable || !isValidUtcMillis(now.value)) {
    throw new TypeError('aggregateProposalOutcomes: nowMs must be UTC milliseconds from an injected clock');
  }
  if (!correlation || correlation.get || correlation.set || !correlation.enumerable || !label(correlation.value, 128)) {
    throw new TypeError('aggregateProposalOutcomes: correlationId must be non-empty (<=128 chars)');
  }
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = abs(left);
  let b = abs(right);
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a === 0n ? 1n : a;
}

function fraction(numerator: bigint, denominator: bigint): ExactFraction {
  if (denominator <= 0n) throw new TypeError('calibration invariant: fraction denominator must be positive');
  const divisor = gcd(numerator, denominator);
  return {
    numerator: (numerator / divisor).toString(),
    denominator: (denominator / divisor).toString(),
  };
}

function integerAggregate(
  records: readonly ProposalOutcomeRecord[],
  key: IntegerMetricKey,
): ExactIntegerAggregate {
  const values = records
    .map((record) => record[key])
    .filter((value): value is number => value !== null);
  if (values.length === 0) {
    return {
      knownCount: 0,
      missingCount: records.length,
      sum: null,
      mean: null,
      min: null,
      max: null,
    };
  }
  const sum = values.reduce((total, value) => total + BigInt(value), 0n);
  return {
    knownCount: values.length,
    missingCount: records.length - values.length,
    sum: sum.toString(),
    mean: fraction(sum, BigInt(values.length)),
    min: values.reduce((minimum, value) => value < minimum ? value : minimum),
    max: values.reduce((maximum, value) => value > maximum ? value : maximum),
  };
}

function probabilityMetrics(records: readonly ProposalOutcomeRecord[]): ProbabilityCalibrationMetrics {
  const known = records.filter((record) => record.predictedProbabilityPpm !== null);
  if (known.length === 0) {
    return {
      scalePpm: PROBABILITY_PPM_SCALE,
      knownCount: 0,
      missingCount: records.length,
      meanPredictedProbability: null,
      observedPositiveFrequency: null,
      brierLoss: null,
    };
  }
  let probabilitySum = 0n;
  let positiveCount = 0n;
  let squaredErrorSum = 0n;
  const scale = BigInt(PROBABILITY_PPM_SCALE);
  for (const record of known) {
    const predicted = BigInt(record.predictedProbabilityPpm as number);
    const observed = record.realizedSuccess ? scale : 0n;
    const error = predicted - observed;
    probabilitySum += predicted;
    if (record.realizedSuccess) positiveCount += 1n;
    squaredErrorSum += error * error;
  }
  const count = BigInt(known.length);
  return {
    scalePpm: PROBABILITY_PPM_SCALE,
    knownCount: known.length,
    missingCount: records.length - known.length,
    meanPredictedProbability: fraction(probabilitySum, count * scale),
    observedPositiveFrequency: fraction(positiveCount, count),
    brierLoss: fraction(squaredErrorSum, count * scale * scale),
  };
}

function metrics(records: readonly ProposalOutcomeRecord[]): CalibrationMetrics {
  const successCount = records.filter((record) => record.realizedSuccess === true).length;
  const failureCount = records.length - successCount;
  const fullyObservedEconomicCount = records.filter((record) =>
    record.grossResultMicrounits !== null &&
    record.feesMicrounits !== null &&
    record.slippageMicrounits !== null &&
    record.otherCostsMicrounits !== null &&
    record.netResultMicrounits !== null &&
    record.fillRatioPpm !== null).length;
  return {
    completeCount: records.length,
    successCount,
    failureCount,
    successRate: records.length === 0 ? null : fraction(BigInt(successCount), BigInt(records.length)),
    probability: probabilityMetrics(records),
    grossResult: integerAggregate(records, 'grossResultMicrounits'),
    fees: integerAggregate(records, 'feesMicrounits'),
    slippage: integerAggregate(records, 'slippageMicrounits'),
    otherCosts: integerAggregate(records, 'otherCostsMicrounits'),
    netResult: integerAggregate(records, 'netResultMicrounits'),
    fillRatioPpm: integerAggregate(records, 'fillRatioPpm'),
    fullyObservedEconomicCount,
  };
}

function exclusionReason(
  record: ProposalOutcomeRecord,
  cohort: CalibrationCohort,
): CalibrationExclusionReason | null {
  if (record.source !== cohort.source) return 'SOURCE_MISMATCH';
  if (record.strategySchema !== cohort.strategySchema) return 'STRATEGY_SCHEMA_MISMATCH';
  if (record.configVersion !== cohort.configVersion) return 'CONFIG_VERSION_MISMATCH';
  if (record.direction !== cohort.direction) return 'DIRECTION_MISMATCH';
  if (record.resultUnit !== cohort.resultUnit) return 'RESULT_UNIT_MISMATCH';
  if (
    record.observationWindow.endAtMs - record.observationWindow.startAtMs !==
    cohort.observationHorizonMs
  ) return 'OBSERVATION_HORIZON_MISMATCH';
  if (record.status !== 'COMPLETE') return 'OUTCOME_INCOMPLETE';
  return null;
}

function buildExclusions(
  excluded: readonly { reason: CalibrationExclusionReason; outcomeId: string }[],
): CalibrationExclusion[] {
  const byReason = new Map<CalibrationExclusionReason, string[]>();
  for (const entry of excluded) {
    const ids = byReason.get(entry.reason);
    if (ids) ids.push(entry.outcomeId);
    else byReason.set(entry.reason, [entry.outcomeId]);
  }
  return [...byReason.entries()]
    .map(([reason, outcomeIds]) => ({
      reason,
      count: outcomeIds.length,
      outcomeIds: outcomeIds.sort(compareCodeUnits),
    }))
    .sort((left, right) => compareCodeUnits(left.reason, right.reason));
}

function missingEvidence(records: readonly ProposalOutcomeRecord[]): MissingEvidenceCount[] {
  const definitions: readonly [MissingEvidenceReason, keyof ProposalOutcomeRecord][] = [
    ['MISSING_PREDICTED_PROBABILITY', 'predictedProbabilityPpm'],
    ['MISSING_GROSS_RESULT', 'grossResultMicrounits'],
    ['MISSING_FEES', 'feesMicrounits'],
    ['MISSING_SLIPPAGE', 'slippageMicrounits'],
    ['MISSING_OTHER_COSTS', 'otherCostsMicrounits'],
    ['MISSING_NET_RESULT', 'netResultMicrounits'],
    ['MISSING_FILL_RATIO', 'fillRatioPpm'],
  ];
  return definitions
    .map(([reason, key]) => ({
      reason,
      count: records.filter((record) => record[key] === null).length,
    }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => compareCodeUnits(left.reason, right.reason));
}

function deepFreeze<T>(value: T, seen: Set<object> = new Set()): T {
  if (typeof value !== 'object' || value === null) return value;
  const object = value as unknown as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const key of Object.keys(object)) {
    deepFreeze((object as Record<string, unknown>)[key], seen);
  }
  Object.freeze(object);
  return value;
}

/**
 * Compute one exact, version-isolated cohort report. Records incompatible
 * with the requested source/schema/config/direction/unit are named and
 * excluded; they are never blended into a cross-version metric.
 */
export function aggregateProposalOutcomes(input: AggregateProposalOutcomesInput): CalibrationReportResult {
  validateCaller(input);
  const issues = validateRequest(input);
  if (issues.length > 0) {
    return fail(
      failureFromIssues(issues, {
        component: COMPONENT,
        stage: 'aggregateOutcomes',
        occurredAt: input.nowMs,
        correlationId: input.correlationId,
        code: CALIBRATION_FAILURE_CODES.EVIDENCE_INVALID,
        retryable: false,
        safeCurrentState: 'CALIBRATION_REPORT_NOT_EMITTED',
        recommendedOperatorAction: 'Fix malformed or tampered outcome records before aggregation.',
      }),
    );
  }

  const unique = new Map<string, ProposalOutcomeRecord>();
  let duplicateIdenticalCount = 0;
  for (const record of input.records) {
    const prior = unique.get(record.outcomeId);
    if (!prior) {
      unique.set(record.outcomeId, record);
    } else if (prior.contentFingerprint === record.contentFingerprint) {
      duplicateIdenticalCount += 1;
    } else {
      return fail(
        createStructuredFailure({
          component: COMPONENT,
          stage: 'deduplicateOutcomes',
          code: CALIBRATION_FAILURE_CODES.IDENTITY_CONFLICT,
          message: `outcome identity ${record.outcomeId} maps to conflicting semantic content`,
          occurredAt: input.nowMs,
          retryable: false,
          safeCurrentState: 'CALIBRATION_REPORT_NOT_EMITTED',
          recommendedOperatorAction: 'Resolve the authoritative outcome for this proposal/plan/window binding.',
          correlationId: input.correlationId,
        }),
      );
    }
  }

  const uniqueRecords = [...unique.values()].sort((left, right) =>
    compareCodeUnits(left.outcomeId, right.outcomeId));
  const included: ProposalOutcomeRecord[] = [];
  const excluded: { reason: CalibrationExclusionReason; outcomeId: string }[] = [];
  for (const record of uniqueRecords) {
    const reason = exclusionReason(record, input.cohort);
    if (reason === null) included.push(record);
    else excluded.push({ reason, outcomeId: record.outcomeId });
  }
  const includedOutcomeIds = included.map((record) => record.outcomeId).sort(compareCodeUnits);
  const exclusions = buildExclusions(excluded);
  const calculatedMetrics = metrics(included);
  const missing = missingEvidence(included);
  const cohort: CalibrationCohort = {
    source: input.cohort.source,
    strategySchema: input.cohort.strategySchema,
    configVersion: input.cohort.configVersion,
    direction: input.cohort.direction,
    resultUnit: input.cohort.resultUnit,
    observationHorizonMs: input.cohort.observationHorizonMs,
  };
  const cohortId = `calgrp_${stableHash128Hex(`calibrationCohort|${canonicalJson(cohort)}`)}`;
  const reportWithoutId = {
    cohortId,
    evaluatedAtMs: input.nowMs,
    cohort,
    inputRecordCount: input.records.length,
    uniqueRecordCount: uniqueRecords.length,
    duplicateIdenticalCount,
    includedCount: included.length,
    excludedCount: excluded.length,
    includedOutcomeIds,
    exclusions,
    missingEvidence: missing,
    metrics: calculatedMetrics,
    strategyMutationAuthority: 'NONE' as const,
    automaticStrategyMutation: false as const,
  };
  const report: CalibrationReport = {
    reportId: `calrep_${stableHash128Hex(`calibrationReport|${canonicalJson(reportWithoutId)}`)}`,
    ...reportWithoutId,
  };
  return ok(deepFreeze(report));
}

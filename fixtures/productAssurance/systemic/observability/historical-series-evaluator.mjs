import {
  assertArray,
  assertBoundedString,
  assertClosedRecord,
  assertEnum,
  assertFiniteNumber,
  assertGitSha,
  assertSafeInteger,
  assertSha256,
  assertUnique,
  compareAscii,
  deepFreeze,
  sortedUniqueStrings,
  strongestResult,
} from './reference-helpers.mjs';
import { sha256CanonicalJsonExcluding } from './canonical-sha256.mjs';
import {
  HISTORICAL_METRIC_FAMILIES,
  validateSloCatalog,
} from './slo-catalog-contract.mjs';

const SCHEMA_VERSION = 'historical-series.v1';
const CURRENT_POLICY_ID = 's5-historical-current.v1';
const CURRENT_POLICY_REVISION = 1;
const COHERENCE_POLICY_ID = 's5-historical-coherence.v1';
const COHERENCE_POLICY_REVISION = 1;
const VIEW_WINDOW_POLICY_ID = 's5-historical-view-window.v1';
const VIEW_WINDOW_POLICY_REVISION = 1;
const TRUTH_LABELS = [
  'LIVE_PUBLIC', 'DRY_RUN', 'SYNTHETIC_ONLY', 'RECORDED_REPLAY', 'UNAVAILABLE', 'UNKNOWN',
];
const STATISTICS = ['P50', 'P95', 'P99', 'COUNT', 'RATE', 'SUM', 'UTILIZATION'];
const MAX_SERIES = HISTORICAL_METRIC_FAMILIES.length;
const MAX_SERIES_POINTS = 1024;
const MAX_SIGNED_SAFE = Number.MAX_SAFE_INTEGER;
const MAX_EXACT_DECIMAL_DIGITS = 96;
const MAX_BASIS_POINTS_MAGNITUDE = 1_000_000;
const EXACT_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*(?:\.[0-9]*[1-9])?|0\.[0-9]*[1-9]|-(?:[1-9][0-9]*(?:\.[0-9]*[1-9])?|0\.[0-9]*[1-9]))$/;
const INTEGER_UNITS = new Set([
  'events', 'incidents', 'invariant-failures', 'bytes', 'request-weight', 'tokens',
]);
const NON_NEGATIVE_QUOTE_FAMILIES = new Set(['EXECUTION_COST', 'BORROW_INTEREST', 'COST_BUDGET']);

function assertIdentifier(value, path) {
  assertBoundedString(value, path, 1, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
    throw new TypeError(`${path} is not a stable identifier`);
  }
}

function exactSeriesId(metricId, catalogRevision) {
  return `historical-series:${metricId}:r${catalogRevision}`;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function validateCatalogBinding(value) {
  const path = 'input.catalogBinding';
  assertClosedRecord(value, path, [
    'result', 'catalogId', 'catalogRevision', 'catalogSha256', 'releaseSha',
    'verifierOwnerId', 'evidenceRefId', 'verifiedAtMs',
  ]);
  assertEnum(value.result, ['PASS', 'FAIL', 'UNKNOWN'], `${path}.result`);
  assertIdentifier(value.catalogId, `${path}.catalogId`);
  assertSafeInteger(value.catalogRevision, `${path}.catalogRevision`, 1, 1_000_000);
  assertSha256(value.catalogSha256, `${path}.catalogSha256`);
  assertGitSha(value.releaseSha, `${path}.releaseSha`);
  assertIdentifier(value.verifierOwnerId, `${path}.verifierOwnerId`);
  assertIdentifier(value.evidenceRefId, `${path}.evidenceRefId`);
  assertSafeInteger(value.verifiedAtMs, `${path}.verifiedAtMs`);
}

function validateViewWindowPolicy(value) {
  const path = 'input.viewWindowPolicy';
  assertClosedRecord(value, path, ['policyId', 'revision', 'startMs', 'endMs']);
  assertEnum(value.policyId, [VIEW_WINDOW_POLICY_ID], `${path}.policyId`);
  assertEnum(value.revision, [VIEW_WINDOW_POLICY_REVISION], `${path}.revision`);
  assertSafeInteger(value.startMs, `${path}.startMs`);
  assertSafeInteger(value.endMs, `${path}.endMs`);
  if (value.startMs >= value.endMs) throw new TypeError(`${path} must have startMs < endMs`);
}

function validateFreshnessPolicy(value, path) {
  assertClosedRecord(value, path, ['policyId', 'revision', 'maximumCurrentAgeMs']);
  assertEnum(value.policyId, [CURRENT_POLICY_ID], `${path}.policyId`);
  assertEnum(value.revision, [CURRENT_POLICY_REVISION], `${path}.revision`);
  assertSafeInteger(value.maximumCurrentAgeMs, `${path}.maximumCurrentAgeMs`, 1, 2_592_000_000);
}

function validateEvidenceBinding(value, path) {
  assertClosedRecord(value, path, [
    'catalogEvidenceRefId', 'seriesEvidenceId', 'materialEventId', 'correlationId',
    'releaseSha', 'ownerId', 'observedAtMs', 'sampleEvidenceIds',
  ]);
  assertIdentifier(value.catalogEvidenceRefId, `${path}.catalogEvidenceRefId`);
  assertIdentifier(value.seriesEvidenceId, `${path}.seriesEvidenceId`);
  assertIdentifier(value.materialEventId, `${path}.materialEventId`);
  assertIdentifier(value.correlationId, `${path}.correlationId`);
  assertGitSha(value.releaseSha, `${path}.releaseSha`);
  assertIdentifier(value.ownerId, `${path}.ownerId`);
  assertSafeInteger(value.observedAtMs, `${path}.observedAtMs`);
  assertArray(value.sampleEvidenceIds, `${path}.sampleEvidenceIds`, MAX_SERIES_POINTS);
  if (value.sampleEvidenceIds.length === 0) throw new TypeError(`${path}.sampleEvidenceIds must not be empty`);
  value.sampleEvidenceIds.forEach((entry, index) => assertIdentifier(entry, `${path}.sampleEvidenceIds[${index}]`));
  assertUnique(value.sampleEvidenceIds, (entry) => entry, `${path}.sampleEvidenceIds`);
}

function validateCoherencePolicy(value, path) {
  assertClosedRecord(value, path, ['policyId', 'revision', 'maximumSampleGapMs']);
  assertEnum(value.policyId, [COHERENCE_POLICY_ID], `${path}.policyId`);
  assertEnum(value.revision, [COHERENCE_POLICY_REVISION], `${path}.revision`);
  assertSafeInteger(value.maximumSampleGapMs, `${path}.maximumSampleGapMs`, 1, 2_592_000_000);
}

function validateOptionalMetricValue(value, path) {
  if (value === null) return;
  if (typeof value === 'number') {
    assertFiniteNumber(value, path, -MAX_SIGNED_SAFE, MAX_SIGNED_SAFE);
    return;
  }
  if (typeof value === 'string') {
    assertCanonicalExactDecimal(value, path);
    return;
  }
  throw new TypeError(`${path} must be null, a bounded number, or canonical exact-decimal string`);
}

function validateStatisticContext(value, path) {
  assertClosedRecord(value, path, [
    'countTotal', 'rateKind', 'rateNumeratorCount', 'rateDenominatorCount',
    'rateDenominatorMs', 'capacity',
  ]);
  for (const key of ['countTotal', 'rateNumeratorCount', 'rateDenominatorCount']) {
    if (value[key] !== null) assertSafeInteger(value[key], `${path}.${key}`, 0);
  }
  if (value.rateKind !== null) assertEnum(value.rateKind, ['PER_TIME', 'RATIO'], `${path}.rateKind`);
  if (value.rateDenominatorMs !== null) {
    assertSafeInteger(value.rateDenominatorMs, `${path}.rateDenominatorMs`, 1, 2_592_000_000);
  }
  validateOptionalMetricValue(value.capacity, `${path}.capacity`);
}

function validateSample(value, path) {
  assertClosedRecord(value, path, ['sampleId', 'evidenceId', 'observedAtMs', 'value']);
  assertIdentifier(value.sampleId, `${path}.sampleId`);
  assertIdentifier(value.evidenceId, `${path}.evidenceId`);
  assertSafeInteger(value.observedAtMs, `${path}.observedAtMs`);
  if (typeof value.value === 'number') {
    assertFiniteNumber(value.value, `${path}.value`, -MAX_SIGNED_SAFE, MAX_SIGNED_SAFE);
  } else if (typeof value.value === 'string') {
    assertCanonicalExactDecimal(value.value, `${path}.value`);
  } else {
    throw new TypeError(`${path}.value must be a bounded number or canonical exact-decimal string`);
  }
}

function validateSeries(value, index) {
  const path = `input.series[${index}]`;
  assertClosedRecord(value, path, [
    'seriesId', 'seriesSha256', 'metricId', 'family', 'catalogId', 'catalogRevision',
    'catalogSha256', 'releaseSha', 'ownerId', 'unit', 'statistics', 'maximumSeriesPoints',
    'retentionWindowMs', 'freshnessPolicy', 'coherencePolicy', 'coherenceState',
    'statisticContext', 'sourceTruthLabel', 'windowId', 'startMs', 'endMs',
    'evidenceBinding', 'samples',
  ]);
  assertIdentifier(value.seriesId, `${path}.seriesId`);
  assertSha256(value.seriesSha256, `${path}.seriesSha256`);
  assertIdentifier(value.metricId, `${path}.metricId`);
  assertEnum(value.family, HISTORICAL_METRIC_FAMILIES, `${path}.family`);
  assertIdentifier(value.catalogId, `${path}.catalogId`);
  assertSafeInteger(value.catalogRevision, `${path}.catalogRevision`, 1, 1_000_000);
  assertSha256(value.catalogSha256, `${path}.catalogSha256`);
  assertGitSha(value.releaseSha, `${path}.releaseSha`);
  assertIdentifier(value.ownerId, `${path}.ownerId`);
  assertBoundedString(value.unit, `${path}.unit`, 1, 40);
  assertArray(value.statistics, `${path}.statistics`, STATISTICS.length);
  if (value.statistics.length === 0) throw new TypeError(`${path}.statistics must not be empty`);
  value.statistics.forEach((entry, child) => assertEnum(entry, STATISTICS, `${path}.statistics[${child}]`));
  assertUnique(value.statistics, (entry) => entry, `${path}.statistics`);
  assertSafeInteger(value.maximumSeriesPoints, `${path}.maximumSeriesPoints`, 1, MAX_SERIES_POINTS);
  assertSafeInteger(value.retentionWindowMs, `${path}.retentionWindowMs`, 1, 31_536_000_000);
  validateFreshnessPolicy(value.freshnessPolicy, `${path}.freshnessPolicy`);
  validateCoherencePolicy(value.coherencePolicy, `${path}.coherencePolicy`);
  assertEnum(value.coherenceState, ['COHERENT', 'INCOHERENT', 'UNKNOWN'], `${path}.coherenceState`);
  validateStatisticContext(value.statisticContext, `${path}.statisticContext`);
  assertEnum(value.sourceTruthLabel, TRUTH_LABELS, `${path}.sourceTruthLabel`);
  assertIdentifier(value.windowId, `${path}.windowId`);
  assertSafeInteger(value.startMs, `${path}.startMs`);
  assertSafeInteger(value.endMs, `${path}.endMs`);
  if (value.startMs >= value.endMs) throw new TypeError(`${path} must have startMs < endMs`);
  validateEvidenceBinding(value.evidenceBinding, `${path}.evidenceBinding`);
  assertArray(value.samples, `${path}.samples`, MAX_SERIES_POINTS);
  if (value.samples.length === 0) throw new TypeError(`${path}.samples must not be empty`);
  value.samples.forEach((entry, child) => validateSample(entry, `${path}.samples[${child}]`));
  assertUnique(value.samples, (entry) => entry.sampleId, `${path}.samples sampleIds`);
  assertUnique(value.samples, (entry) => entry.evidenceId, `${path}.samples evidenceIds`);
  assertUnique(value.samples, (entry) => entry.observedAtMs, `${path}.samples observedAtMs`);
}

function validateInput(input) {
  assertClosedRecord(input, 'input', [
    'schemaVersion', 'nowMs', 'releaseSha', 'catalogVerificationMaximumAgeMs',
    'catalogBinding', 'viewWindowPolicy', 'series',
  ]);
  assertEnum(input.schemaVersion, [SCHEMA_VERSION], 'input.schemaVersion');
  assertSafeInteger(input.nowMs, 'input.nowMs');
  assertGitSha(input.releaseSha, 'input.releaseSha');
  assertSafeInteger(
    input.catalogVerificationMaximumAgeMs,
    'input.catalogVerificationMaximumAgeMs',
    1,
    2_592_000_000,
  );
  validateCatalogBinding(input.catalogBinding);
  validateViewWindowPolicy(input.viewWindowPolicy);
  assertArray(input.series, 'input.series', MAX_SERIES);
  input.series.forEach(validateSeries);
  assertUnique(input.series, (entry) => entry.seriesId, 'input.series seriesIds');
  assertUnique(input.series, (entry) => entry.metricId, 'input.series metricIds');
  assertUnique(input.series, (entry) => entry.family, 'input.series families');
  assertUnique(input.series, (entry) => entry.windowId, 'input.series windowIds');
  assertUnique(
    input.series,
    (entry) => entry.evidenceBinding.seriesEvidenceId,
    'input.series seriesEvidenceIds',
  );
}

export function deriveHistoricalSeriesSha256(series) {
  return sha256CanonicalJsonExcluding(series, 'seriesSha256');
}

export function assertCanonicalExactDecimal(value, path = 'value') {
  if (typeof value !== 'string' || value.length > 99 || !EXACT_DECIMAL_PATTERN.test(value)) {
    throw new TypeError(`${path} must be normalized plain base-10 exact decimal`);
  }
  const digitCount = [...value].filter((symbol) => symbol >= '0' && symbol <= '9').length;
  if (digitCount > MAX_EXACT_DECIMAL_DIGITS) {
    throw new RangeError(`${path} exceeds ${MAX_EXACT_DECIMAL_DIGITS} exact-decimal digits`);
  }
  return value;
}

function decimalParts(value) {
  assertCanonicalExactDecimal(value);
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction = ''] = unsigned.split('.');
  const coefficient = BigInt(`${integer}${fraction}`);
  return { coefficient: negative ? -coefficient : coefficient, scale: fraction.length };
}

export function compareCanonicalExactDecimals(left, right) {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  const commonScale = Math.max(leftParts.scale, rightParts.scale);
  const scaledLeft = leftParts.coefficient * (10n ** BigInt(commonScale - leftParts.scale));
  const scaledRight = rightParts.coefficient * (10n ** BigInt(commonScale - rightParts.scale));
  return scaledLeft < scaledRight ? -1 : scaledLeft > scaledRight ? 1 : 0;
}

function formatCanonicalDecimal(coefficient, scale) {
  if (coefficient === 0n) return '0';
  const negative = coefficient < 0n;
  let digits = (negative ? -coefficient : coefficient).toString();
  let output;
  if (scale === 0) output = digits;
  else {
    digits = digits.padStart(scale + 1, '0');
    const split = digits.length - scale;
    output = `${digits.slice(0, split)}.${digits.slice(split)}`.replace(/0+$/, '').replace(/\.$/, '');
  }
  const canonical = `${negative ? '-' : ''}${output}`;
  assertCanonicalExactDecimal(canonical, 'exactDecimalSum');
  return canonical;
}

export function sumCanonicalExactDecimals(values) {
  assertArray(values, 'values', MAX_SERIES_POINTS);
  if (values.length === 0) return '0';
  const parts = values.map((value, index) => {
    assertCanonicalExactDecimal(value, `values[${index}]`);
    return decimalParts(value);
  });
  const commonScale = Math.max(...parts.map((entry) => entry.scale));
  const coefficient = parts.reduce((sum, entry) => (
    sum + entry.coefficient * (10n ** BigInt(commonScale - entry.scale))
  ), 0n);
  return formatCanonicalDecimal(coefficient, commonScale);
}

function numberToCanonicalDecimal(value) {
  assertFiniteNumber(value, 'value', -MAX_SIGNED_SAFE, MAX_SIGNED_SAFE);
  if (Object.is(value, -0) || value === 0) return '0';
  const text = String(value);
  if (!/[eE]/.test(text)) return assertCanonicalExactDecimal(text);
  const [mantissa, exponentText] = text.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const negative = mantissa.startsWith('-');
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const [integer, fraction = ''] = unsigned.split('.');
  const digits = `${integer}${fraction}`;
  const decimalPosition = integer.length + exponent;
  const plain = decimalPosition <= 0
    ? `0.${'0'.repeat(-decimalPosition)}${digits}`
    : decimalPosition >= digits.length
      ? `${digits}${'0'.repeat(decimalPosition - digits.length)}`
      : `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  const normalized = plain.includes('.')
    ? plain.replace(/0+$/, '').replace(/\.$/, '')
    : plain;
  return assertCanonicalExactDecimal(`${negative ? '-' : ''}${normalized}`);
}

function metricValueAsDecimal(value) {
  return typeof value === 'string' ? assertCanonicalExactDecimal(value) : numberToCanonicalDecimal(value);
}

export function divideMetricValuesToDecimal(
  numeratorValue,
  denominatorValue,
  multiplier = 1,
  scale = 18,
) {
  assertSafeInteger(multiplier, 'multiplier', 1, 1_000_000);
  assertSafeInteger(scale, 'scale', 0, 36);
  const numerator = decimalParts(metricValueAsDecimal(numeratorValue));
  const denominator = decimalParts(metricValueAsDecimal(denominatorValue));
  if (denominator.coefficient <= 0n) throw new RangeError('denominator must be positive');
  const scaledNumerator = numerator.coefficient
    * (10n ** BigInt(denominator.scale))
    * BigInt(multiplier)
    * (10n ** BigInt(scale));
  const scaledDenominator = denominator.coefficient * (10n ** BigInt(numerator.scale));
  const negative = scaledNumerator < 0n;
  const absoluteNumerator = negative ? -scaledNumerator : scaledNumerator;
  let quotient = absoluteNumerator / scaledDenominator;
  const remainder = absoluteNumerator % scaledDenominator;
  if (remainder * 2n >= scaledDenominator) quotient += 1n;
  return formatCanonicalDecimal(negative ? -quotient : quotient, scale);
}

export function nearestRank(values, percentile) {
  assertArray(values, 'values', MAX_SERIES_POINTS);
  assertFiniteNumber(percentile, 'percentile', Number.MIN_VALUE, 100);
  if (values.length === 0) return null;
  const ordered = values.map((value, index) => {
    assertFiniteNumber(value, `values[${index}]`, -MAX_SIGNED_SAFE, MAX_SIGNED_SAFE);
    return value;
  }).sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil((percentile / 100) * ordered.length) - 1)];
}

export function nearestRankExactDecimal(values, percentile) {
  assertArray(values, 'values', MAX_SERIES_POINTS);
  assertFiniteNumber(percentile, 'percentile', Number.MIN_VALUE, 100);
  if (values.length === 0) return null;
  const ordered = values.map((value, index) => (
    assertCanonicalExactDecimal(value, `values[${index}]`)
  )).sort(compareCanonicalExactDecimals);
  return ordered[Math.max(0, Math.ceil((percentile / 100) * ordered.length) - 1)];
}

function metricValueReason(value, expected) {
  if (expected.unit === 'quote-asset') {
    if (typeof value !== 'string') return 'HISTORICAL_SERIES_EXACT_DECIMAL_REQUIRED';
    assertCanonicalExactDecimal(value);
    if (NON_NEGATIVE_QUOTE_FAMILIES.has(expected.family) && value.startsWith('-')) {
      return 'HISTORICAL_SERIES_NEGATIVE_VALUE_FORBIDDEN';
    }
    return null;
  }
  if (typeof value !== 'number') return 'HISTORICAL_SERIES_NUMERIC_VALUE_REQUIRED';
  assertFiniteNumber(value, 'sample.value', -MAX_SIGNED_SAFE, MAX_SIGNED_SAFE);
  if (expected.unit === 'basis-points'
      && (value < -MAX_BASIS_POINTS_MAGNITUDE || value > MAX_BASIS_POINTS_MAGNITUDE)) {
    return 'HISTORICAL_SERIES_BASIS_POINTS_OUT_OF_RANGE';
  }
  if (expected.unit === 'percent' && (value < 0 || value > 100)) {
    return 'HISTORICAL_SERIES_PERCENT_OUT_OF_RANGE';
  }
  if (expected.unit === 'ratio' && (value < 0 || value > 1)) {
    return 'HISTORICAL_SERIES_RATIO_OUT_OF_RANGE';
  }
  if (INTEGER_UNITS.has(expected.unit) && (!Number.isSafeInteger(value) || value < 0)) {
    return 'HISTORICAL_SERIES_NON_NEGATIVE_INTEGER_REQUIRED';
  }
  if (expected.unit === 'milliseconds' && value < 0) {
    return 'HISTORICAL_SERIES_NON_NEGATIVE_VALUE_REQUIRED';
  }
  return null;
}

function isPositiveMetricValue(value, expected) {
  if (expected.unit === 'quote-asset') return compareCanonicalExactDecimals(value, '0') > 0;
  return value > 0;
}

function statisticContextReason(observed, expected) {
  const reasons = [];
  const context = observed.statisticContext;
  const declaresCount = expected.statistics.includes('COUNT');
  const declaresRate = expected.statistics.includes('RATE');
  if (declaresCount && context.countTotal === null) {
    reasons.push('HISTORICAL_SERIES_COUNT_TOTAL_MISSING');
  } else if (!declaresCount && context.countTotal !== null) {
    reasons.push('HISTORICAL_SERIES_UNDECLARED_COUNT_CONTEXT');
  }
  if (declaresRate) {
    if (context.rateKind === 'PER_TIME') {
      if (context.rateNumeratorCount === null || context.rateDenominatorMs === null
          || context.rateDenominatorCount !== null) {
        reasons.push('HISTORICAL_SERIES_PER_TIME_RATE_CONTEXT_INVALID');
      }
      if (declaresCount && context.rateNumeratorCount !== context.countTotal) {
        reasons.push('HISTORICAL_SERIES_RATE_COUNT_MISMATCH');
      }
    } else if (context.rateKind === 'RATIO') {
      if (context.rateNumeratorCount === null || context.rateDenominatorCount === null
          || context.rateDenominatorCount === 0 || context.rateDenominatorMs !== null
          || context.rateNumeratorCount > context.rateDenominatorCount) {
        reasons.push('HISTORICAL_SERIES_RATIO_RATE_CONTEXT_INVALID');
      }
      if (declaresCount && context.countTotal !== context.rateDenominatorCount) {
        reasons.push('HISTORICAL_SERIES_RATE_COUNT_MISMATCH');
      }
    } else reasons.push('HISTORICAL_SERIES_RATE_KIND_MISSING');
  } else if (context.rateKind !== null || context.rateNumeratorCount !== null
      || context.rateDenominatorCount !== null || context.rateDenominatorMs !== null) {
    reasons.push('HISTORICAL_SERIES_UNDECLARED_RATE_CONTEXT');
  }
  if (declaresCount && INTEGER_UNITS.has(expected.unit)) {
    const observedTotal = observed.samples.reduce((sum, sample) => sum + sample.value, 0);
    if (!Number.isSafeInteger(observedTotal) || observedTotal !== context.countTotal) {
      reasons.push('HISTORICAL_SERIES_COUNT_EVIDENCE_MISMATCH');
    }
  }
  if (expected.family === 'AUTOMATIC_RECOVERY_RESULT_RATE') {
    const binaryOutcomes = observed.samples.every((sample) => sample.value === 0 || sample.value === 1);
    const successCount = binaryOutcomes
      ? observed.samples.reduce((sum, sample) => sum + sample.value, 0)
      : null;
    if (!binaryOutcomes
        || context.countTotal !== observed.samples.length
        || context.rateDenominatorCount !== observed.samples.length
        || context.rateNumeratorCount !== successCount) {
      reasons.push('HISTORICAL_SERIES_RECOVERY_RATE_EVIDENCE_MISMATCH');
    }
  }
  if (expected.statistics.includes('UTILIZATION')) {
    const value = context.capacity;
    if (value === null || metricValueReason(value, expected) !== null || !isPositiveMetricValue(value, expected)) {
      reasons.push('HISTORICAL_SERIES_CAPACITY_MISSING_OR_INVALID');
    }
  }
  if (!expected.statistics.includes('UTILIZATION') && context.capacity !== null) {
    reasons.push('HISTORICAL_SERIES_UNDECLARED_CAPACITY_CONTEXT');
  }
  return reasons;
}

function historicalSummary(samples, expected = null) {
  const chronological = [...samples].sort((left, right) => (
    left.observedAtMs - right.observedAtMs || compareAscii(left.sampleId, right.sampleId)
  ));
  const valuesAreValid = expected === null
    || chronological.every((sample) => metricValueReason(sample.value, expected) === null);
  if (chronological.length === 0 || !valuesAreValid) {
    return {
      sampleCount: chronological.length,
      p50: null,
      p95: null,
      p99: null,
      latest: null,
      minimum: null,
      maximum: null,
      trendDirection: 'UNKNOWN',
      trendMethod: 'FIRST_TO_LATEST',
      percentileMethod: 'NEAREST_RANK',
    };
  }
  const values = chronological.map((sample) => sample.value);
  const first = chronological[0].value;
  const latest = chronological[chronological.length - 1].value;
  const exactDecimal = expected?.unit === 'quote-asset';
  const compare = exactDecimal ? compareCanonicalExactDecimals : (left, right) => left - right;
  const ordered = [...values].sort(compare);
  const percentile = exactDecimal ? nearestRankExactDecimal : nearestRank;
  const direction = compare(latest, first);
  return {
    sampleCount: chronological.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    latest,
    minimum: ordered[0],
    maximum: ordered.at(-1),
    trendDirection: direction > 0 ? 'INCREASING' : direction < 0 ? 'DECREASING' : 'FLAT',
    trendMethod: 'FIRST_TO_LATEST',
    percentileMethod: 'NEAREST_RANK',
  };
}

function sumMetricValues(values, expected) {
  if (expected.unit === 'quote-asset') return sumCanonicalExactDecimals(values);
  const sum = values.reduce((total, value) => total + value, 0);
  assertFiniteNumber(sum, 'numericSeriesSum', -MAX_SIGNED_SAFE, MAX_SIGNED_SAFE);
  return sum;
}

function declaredStatistics(observed, expected, summary) {
  if (summary.sampleCount === 0 || summary.latest === null) return null;
  const values = observed.samples.map((sample) => sample.value);
  const sum = expected.statistics.includes('SUM')
    ? sumMetricValues(values, expected)
    : null;
  const output = {};
  for (const statistic of expected.statistics) {
    if (statistic === 'P50') output.P50 = summary.p50;
    else if (statistic === 'P95') output.P95 = summary.p95;
    else if (statistic === 'P99') output.P99 = summary.p99;
    else if (statistic === 'COUNT') output.COUNT = observed.statisticContext.countTotal;
    else if (statistic === 'RATE') {
      output.RATE = observed.statisticContext.rateKind === 'PER_TIME' ? {
        kind: 'PER_TIME',
        numeratorCount: observed.statisticContext.rateNumeratorCount,
        denominatorMs: observed.statisticContext.rateDenominatorMs,
        value: divideMetricValuesToDecimal(
          observed.statisticContext.rateNumeratorCount,
          observed.statisticContext.rateDenominatorMs,
          1000,
        ),
        unit: 'count-per-second',
        method: 'EXACT_DECIMAL_SCALE_18_HALF_UP',
      } : {
        kind: 'RATIO',
        numeratorCount: observed.statisticContext.rateNumeratorCount,
        denominatorCount: observed.statisticContext.rateDenominatorCount,
        value: divideMetricValuesToDecimal(
          observed.statisticContext.rateNumeratorCount,
          observed.statisticContext.rateDenominatorCount,
        ),
        unit: 'ratio',
        method: 'EXACT_DECIMAL_SCALE_18_HALF_UP',
      };
    } else if (statistic === 'SUM') output.SUM = sum;
    else if (statistic === 'UTILIZATION') {
      output.UTILIZATION = {
        numerator: summary.latest,
        denominator: observed.statisticContext.capacity,
        value: divideMetricValuesToDecimal(summary.latest, observed.statisticContext.capacity, 100),
        unit: 'percent',
        method: 'EXACT_DECIMAL_SCALE_18_HALF_UP',
      };
    }
  }
  return output;
}

function canonicalPoints(samples) {
  return [...samples]
    .sort((left, right) => left.observedAtMs - right.observedAtMs || compareAscii(left.sampleId, right.sampleId))
    .map((sample) => ({
      sampleId: sample.sampleId,
      evidenceId: sample.evidenceId,
      observedAtMs: sample.observedAtMs,
      value: sample.value,
    }));
}

function evaluateCatalogBinding(input, catalog, validation) {
  const historicalReasons = [];
  const currentReasons = [];
  const binding = input.catalogBinding;
  if (binding.result === 'FAIL') historicalReasons.push('HISTORICAL_CATALOG_VERIFICATION_FAILED');
  else if (binding.result === 'UNKNOWN') historicalReasons.push('HISTORICAL_CATALOG_VERIFICATION_UNKNOWN');
  if (binding.catalogId !== catalog.catalogId) historicalReasons.push('HISTORICAL_CATALOG_ID_MISMATCH');
  if (binding.catalogRevision !== catalog.catalogRevision) {
    historicalReasons.push('HISTORICAL_CATALOG_REVISION_MISMATCH');
  }
  if (binding.catalogSha256 !== catalog.catalogSha256) {
    historicalReasons.push('HISTORICAL_CATALOG_DECLARED_DIGEST_MISMATCH');
  }
  if (validation.derivedCatalogSha256 !== catalog.catalogSha256) {
    historicalReasons.push('HISTORICAL_CATALOG_CANONICAL_DIGEST_MISMATCH');
  }
  if (binding.catalogSha256 !== validation.derivedCatalogSha256) {
    historicalReasons.push('HISTORICAL_CATALOG_VERIFIED_DIGEST_MISMATCH');
  }
  if (binding.releaseSha !== input.releaseSha || catalog.releaseSha !== input.releaseSha) {
    historicalReasons.push('HISTORICAL_CATALOG_RELEASE_MISMATCH');
  }
  if (validation.missingMetricFamilies.length > 0) {
    historicalReasons.push('HISTORICAL_CATALOG_FAMILY_DENOMINATOR_MISMATCH');
  }
  if (validation.metricBindingMismatches.length > 0) {
    historicalReasons.push('HISTORICAL_CATALOG_SLO_BINDING_MISMATCH');
  }
  if (validation.metricContractMismatches.length > 0) {
    historicalReasons.push('HISTORICAL_CATALOG_METRIC_CONTRACT_MISMATCH');
  }
  if (catalog.generatedAtMs > input.nowMs) historicalReasons.push('HISTORICAL_CATALOG_FROM_FUTURE');
  if (binding.verifiedAtMs > input.nowMs) historicalReasons.push('HISTORICAL_CATALOG_VERIFICATION_FROM_FUTURE');
  else if (input.nowMs - binding.verifiedAtMs > input.catalogVerificationMaximumAgeMs) {
    currentReasons.push('HISTORICAL_CATALOG_VERIFICATION_STALE_FOR_CURRENT');
  }

  const historicalResult = historicalReasons.some((reason) => reason.endsWith('_UNKNOWN'))
    && !historicalReasons.some((reason) => !reason.endsWith('_UNKNOWN'))
    ? 'UNKNOWN'
    : historicalReasons.length === 0 ? 'PASS' : 'FAIL';
  const currentResult = historicalResult === 'PASS' && currentReasons.length > 0
    ? 'UNKNOWN'
    : historicalResult;
  return {
    historicalResult,
    currentResult,
    historicalReasonCodes: sortedUniqueStrings(historicalReasons),
    currentReasonCodes: sortedUniqueStrings(currentReasons),
    catalogId: catalog.catalogId,
    catalogRevision: catalog.catalogRevision,
    catalogSha256: catalog.catalogSha256,
    derivedCatalogSha256: validation.derivedCatalogSha256,
    releaseSha: catalog.releaseSha,
    verifierOwnerId: binding.verifierOwnerId,
    evidenceRefId: binding.evidenceRefId,
  };
}

function mismatchReason(condition, reason, reasons) {
  if (condition) reasons.push(reason);
}

function evaluateOneSeries(input, catalog, expected, observed) {
  if (observed === undefined) {
    const reasons = ['EXPECTED_HISTORICAL_SERIES_MISSING'];
    return {
      metricId: expected.metricId,
      family: expected.family,
      ownerId: expected.ownerId,
      unit: expected.unit,
      sourceTruthLabel: 'UNKNOWN',
      statistics: [...expected.statistics],
      bindingResult: 'UNKNOWN',
      historicalResult: 'UNKNOWN',
      currentResult: 'UNKNOWN',
      historicalReasonCodes: reasons,
      currentReasonCodes: reasons,
      liveGreenEligible: false,
      historical: historicalSummary([]),
      declaredStatistics: null,
      window: null,
      freshnessPolicy: null,
      coherencePolicy: null,
      coherenceState: 'UNKNOWN',
      derivedCoherenceState: 'UNKNOWN',
      evidenceBinding: null,
      points: [],
      authorityMutation: false,
      blocksRiskReduction: false,
    };
  }

  const historicalReasons = [];
  const currentReasons = [];
  const binding = input.catalogBinding;
  mismatchReason(
    observed.seriesId !== exactSeriesId(expected.metricId, catalog.catalogRevision),
    'HISTORICAL_SERIES_ID_MISMATCH',
    historicalReasons,
  );
  mismatchReason(
    observed.startMs !== input.viewWindowPolicy.startMs || observed.endMs !== input.viewWindowPolicy.endMs,
    'HISTORICAL_SERIES_VIEW_WINDOW_MISMATCH',
    historicalReasons,
  );
  mismatchReason(
    deriveHistoricalSeriesSha256(observed) !== observed.seriesSha256,
    'HISTORICAL_SERIES_CANONICAL_DIGEST_MISMATCH',
    historicalReasons,
  );
  mismatchReason(observed.family !== expected.family, 'HISTORICAL_SERIES_FAMILY_MISMATCH', historicalReasons);
  mismatchReason(observed.catalogId !== catalog.catalogId, 'HISTORICAL_SERIES_CATALOG_ID_MISMATCH', historicalReasons);
  mismatchReason(
    observed.catalogRevision !== catalog.catalogRevision,
    'HISTORICAL_SERIES_CATALOG_REVISION_MISMATCH',
    historicalReasons,
  );
  mismatchReason(
    observed.catalogSha256 !== catalog.catalogSha256,
    'HISTORICAL_SERIES_CATALOG_DIGEST_MISMATCH',
    historicalReasons,
  );
  mismatchReason(observed.releaseSha !== input.releaseSha, 'HISTORICAL_SERIES_RELEASE_MISMATCH', historicalReasons);
  mismatchReason(observed.ownerId !== expected.ownerId, 'HISTORICAL_SERIES_OWNER_MISMATCH', historicalReasons);
  mismatchReason(observed.unit !== expected.unit, 'HISTORICAL_SERIES_UNIT_MISMATCH', historicalReasons);
  mismatchReason(
    !arraysEqual(observed.statistics, expected.statistics),
    'HISTORICAL_SERIES_STATISTICS_MISMATCH',
    historicalReasons,
  );
  historicalReasons.push(...statisticContextReason(observed, expected));
  mismatchReason(
    observed.maximumSeriesPoints !== expected.maximumSeriesPoints,
    'HISTORICAL_SERIES_BOUND_MISMATCH',
    historicalReasons,
  );
  mismatchReason(
    observed.retentionWindowMs !== expected.retentionWindowMs,
    'HISTORICAL_SERIES_RETENTION_MISMATCH',
    historicalReasons,
  );
  mismatchReason(
    observed.samples.length > observed.maximumSeriesPoints,
    'HISTORICAL_SERIES_SAMPLE_BOUND_EXCEEDED',
    historicalReasons,
  );
  mismatchReason(
    observed.endMs - observed.startMs > observed.retentionWindowMs,
    'HISTORICAL_SERIES_RETENTION_WINDOW_EXCEEDED',
    historicalReasons,
  );
  mismatchReason(observed.endMs > input.nowMs, 'HISTORICAL_SERIES_WINDOW_FROM_FUTURE', historicalReasons);

  const chronological = [...observed.samples].sort((left, right) => (
    left.observedAtMs - right.observedAtMs || compareAscii(left.sampleId, right.sampleId)
  ));
  const latestObservedAtMs = chronological.at(-1)?.observedAtMs ?? null;
  const observedGapsMs = chronological.length === 0 ? [] : [
    chronological[0].observedAtMs - observed.startMs,
    ...chronological.slice(1).map((sample, index) => (
      sample.observedAtMs - chronological[index].observedAtMs
    )),
    observed.endMs - chronological.at(-1).observedAtMs,
  ];
  const maximumObservedGapMs = observedGapsMs.length === 0 ? 0 : Math.max(...observedGapsMs);
  const derivedCoherenceState = maximumObservedGapMs <= observed.coherencePolicy.maximumSampleGapMs
    ? 'COHERENT'
    : 'INCOHERENT';
  if (observed.coherenceState === 'COHERENT' && derivedCoherenceState !== 'COHERENT') {
    historicalReasons.push('HISTORICAL_SERIES_COHERENCE_CLAIM_MISMATCH');
  } else if (observed.coherenceState === 'INCOHERENT') {
    historicalReasons.push('HISTORICAL_SERIES_INCOHERENT');
  } else if (observed.coherenceState === 'UNKNOWN') {
    historicalReasons.push('HISTORICAL_SERIES_COHERENCE_UNKNOWN');
  }
  for (const sample of chronological) {
    const valueReason = metricValueReason(sample.value, expected);
    if (valueReason !== null) historicalReasons.push(valueReason);
    if (sample.observedAtMs < observed.startMs || sample.observedAtMs > observed.endMs) {
      historicalReasons.push('HISTORICAL_SERIES_SAMPLE_OUTSIDE_WINDOW');
    }
    if (sample.observedAtMs > input.nowMs) historicalReasons.push('HISTORICAL_SERIES_SAMPLE_FROM_FUTURE');
  }
  if (observed.evidenceBinding.observedAtMs > input.nowMs) {
    historicalReasons.push('HISTORICAL_SERIES_EVIDENCE_FROM_FUTURE');
  }
  if (observed.evidenceBinding.observedAtMs < observed.endMs) {
    historicalReasons.push('HISTORICAL_SERIES_EVIDENCE_BEFORE_WINDOW_END');
  }
  if (latestObservedAtMs !== null && observed.evidenceBinding.observedAtMs < latestObservedAtMs) {
    historicalReasons.push('HISTORICAL_SERIES_EVIDENCE_BEFORE_LATEST_SAMPLE');
  }
  mismatchReason(
    observed.evidenceBinding.catalogEvidenceRefId !== binding.evidenceRefId,
    'HISTORICAL_SERIES_CATALOG_EVIDENCE_MISMATCH',
    historicalReasons,
  );
  mismatchReason(
    observed.evidenceBinding.releaseSha !== input.releaseSha,
    'HISTORICAL_SERIES_EVIDENCE_RELEASE_MISMATCH',
    historicalReasons,
  );
  mismatchReason(
    observed.evidenceBinding.ownerId !== expected.ownerId,
    'HISTORICAL_SERIES_EVIDENCE_OWNER_MISMATCH',
    historicalReasons,
  );
  const sampleEvidenceIds = observed.samples.map((sample) => sample.evidenceId).sort(compareAscii);
  const boundEvidenceIds = [...observed.evidenceBinding.sampleEvidenceIds].sort(compareAscii);
  mismatchReason(
    !arraysEqual(sampleEvidenceIds, boundEvidenceIds),
    'HISTORICAL_SERIES_SAMPLE_EVIDENCE_SET_MISMATCH',
    historicalReasons,
  );
  if (observed.sourceTruthLabel === 'UNAVAILABLE' || observed.sourceTruthLabel === 'UNKNOWN') {
    historicalReasons.push('HISTORICAL_SERIES_SOURCE_TRUTH_UNAVAILABLE');
  }
  if (latestObservedAtMs !== null
      && input.nowMs - latestObservedAtMs > observed.freshnessPolicy.maximumCurrentAgeMs) {
    currentReasons.push('HISTORICAL_SERIES_STALE_FOR_CURRENT');
  }
  if (input.nowMs - observed.evidenceBinding.observedAtMs > observed.freshnessPolicy.maximumCurrentAgeMs) {
    currentReasons.push('HISTORICAL_SERIES_EVIDENCE_STALE_FOR_CURRENT');
  }

  const unknownHistoricalReasons = new Set([
    'HISTORICAL_SERIES_SOURCE_TRUTH_UNAVAILABLE',
    'HISTORICAL_SERIES_INCOHERENT',
    'HISTORICAL_SERIES_COHERENCE_UNKNOWN',
  ]);
  const bindingReasons = historicalReasons.filter((reason) => !unknownHistoricalReasons.has(reason));
  const bindingResult = bindingReasons.length === 0 ? 'PASS' : 'FAIL';
  const historicalResult = historicalReasons.length === 0 ? 'PASS'
    : historicalReasons.every((reason) => unknownHistoricalReasons.has(reason)) ? 'UNKNOWN'
      : 'FAIL';
  const currentResult = historicalResult === 'PASS' && currentReasons.length > 0
    ? 'UNKNOWN'
    : historicalResult;
  const historical = historicalSummary(observed.samples, expected);
  const declared = historicalResult === 'PASS' ? declaredStatistics(observed, expected, historical) : null;
  return {
    metricId: expected.metricId,
    family: expected.family,
    ownerId: expected.ownerId,
    unit: expected.unit,
    sourceTruthLabel: observed.sourceTruthLabel,
    statistics: [...expected.statistics],
    bindingResult,
    historicalResult,
    currentResult,
    historicalReasonCodes: sortedUniqueStrings(historicalReasons),
    currentReasonCodes: sortedUniqueStrings(currentReasons),
    liveGreenEligible: currentResult === 'PASS'
      && observed.sourceTruthLabel === 'LIVE_PUBLIC'
      && catalog.truthLabel === 'LIVE_PUBLIC',
    historical,
    declaredStatistics: declared,
    window: {
      windowId: observed.windowId,
      startMs: observed.startMs,
      endMs: observed.endMs,
      releaseSha: observed.releaseSha,
    },
    freshnessPolicy: { ...observed.freshnessPolicy },
    coherencePolicy: {
      ...observed.coherencePolicy,
      maximumObservedGapMs,
    },
    coherenceState: observed.coherenceState,
    derivedCoherenceState,
    evidenceBinding: {
      catalogEvidenceRefId: observed.evidenceBinding.catalogEvidenceRefId,
      seriesEvidenceId: observed.evidenceBinding.seriesEvidenceId,
      materialEventId: observed.evidenceBinding.materialEventId,
      correlationId: observed.evidenceBinding.correlationId,
      releaseSha: observed.evidenceBinding.releaseSha,
      ownerId: observed.evidenceBinding.ownerId,
      observedAtMs: observed.evidenceBinding.observedAtMs,
      sampleEvidenceIds: [...observed.evidenceBinding.sampleEvidenceIds].sort(compareAscii),
    },
    points: canonicalPoints(observed.samples),
    authorityMutation: false,
    blocksRiskReduction: false,
  };
}

export function evaluateHistoricalSeries(input, catalog) {
  validateInput(input);
  const catalogValidation = validateSloCatalog(catalog);
  const catalogBinding = evaluateCatalogBinding(input, catalog, catalogValidation);
  const observedByMetricId = new Map(input.series.map((entry) => [entry.metricId, entry]));
  const expectedMetricIds = new Set(catalog.historicalMetricRegistry.map((entry) => entry.metricId));
  const missingMetricIds = catalog.historicalMetricRegistry
    .filter((entry) => !observedByMetricId.has(entry.metricId))
    .map((entry) => entry.metricId)
    .sort(compareAscii);
  const extraMetricIds = input.series
    .filter((entry) => !expectedMetricIds.has(entry.metricId))
    .map((entry) => entry.metricId)
    .sort(compareAscii);
  const inventoryResult = extraMetricIds.length > 0 ? 'FAIL'
    : missingMetricIds.length > 0 ? 'UNKNOWN'
      : 'PASS';
  const series = catalog.historicalMetricRegistry
    .map((expected) => evaluateOneSeries(input, catalog, expected, observedByMetricId.get(expected.metricId)))
    .sort((left, right) => compareAscii(left.metricId, right.metricId));
  const historicalResult = strongestResult([
    catalogBinding.historicalResult,
    inventoryResult,
    ...series.map((entry) => entry.historicalResult),
  ]);
  const currentResult = strongestResult([
    historicalResult,
    catalogBinding.currentResult,
    ...series.map((entry) => entry.currentResult),
  ]);
  const greenEligible = currentResult === 'PASS';
  const allLivePublic = catalog.truthLabel === 'LIVE_PUBLIC'
    && series.every((entry) => entry.sourceTruthLabel === 'LIVE_PUBLIC');
  return deepFreeze({
    schemaVersion: 'historical-series-evaluation.v1',
    releaseSha: input.releaseSha,
    contractResult: historicalResult,
    historicalResult,
    currentResult,
    greenEligible,
    liveGreenEligible: greenEligible && allLivePublic,
    truthReasonCodes: allLivePublic ? [] : ['HISTORICAL_SERIES_NOT_ALL_LIVE_PUBLIC'],
    expectedSeriesCount: HISTORICAL_METRIC_FAMILIES.length,
    suppliedSeriesCount: input.series.length,
    evaluatedSeriesCount: series.length,
    viewWindowPolicy: { ...input.viewWindowPolicy },
    missingMetricIds,
    extraMetricIds,
    catalogBinding,
    series,
    authorityMutation: false,
    blocksRiskReduction: false,
  });
}

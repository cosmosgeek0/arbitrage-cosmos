import {
  canonicalJson,
  isValidUtcMillis,
  stableHash128Hex,
} from '../../foundation/contracts/index.js';
import {
  compareExactDecimals,
  isExactDecimal,
  subtractExactDecimals,
  type ExactDecimal,
} from '../../capitalFoundation/contracts/index.js';

export const OPERATING_METRIC_IDS = Object.freeze([
  'LEAD_TIME',
  'PRECISION',
  'RECALL',
  'CALIBRATION',
  'FALSE_POSITIVES',
  'MISSED_OPPORTUNITIES',
  'EXPECTED_VS_REALIZED_VALUE',
  'EXECUTION_SHORTFALL',
  'ONE_LEG_DURATION',
  'FRESHNESS',
  'RELIABILITY',
  'UTILIZATION',
  'DRAWDOWN',
  'DECAY',
  'UPTIME',
  'RECOVERY',
  'AUTHORITY_VIOLATIONS',
] as const);
export type OperatingMetricId = (typeof OPERATING_METRIC_IDS)[number];

export type OperatingMetricOwner =
  | 'CAPITAL_ECONOMICS'
  | 'CAPITAL_FOUNDATION'
  | 'FOUNDATION_CONTROL'
  | 'FOUNDATION_EXECUTION'
  | 'INTELLIGENCE_FOUNDATION_OUTCOMES'
  | 'INTELLIGENCE_RUNTIME'
  | 'PRODUCT_ASSURANCE';

export interface OperatingMetricDefinition {
  readonly metricId: OperatingMetricId;
  readonly semanticVersion: 'v1';
  readonly owner: OperatingMetricOwner;
  readonly measurementFields: readonly string[];
  readonly unit: 'COUNT' | 'EXACT_DECIMAL' | 'MILLISECONDS' | 'PERMILLION';
  readonly productionOutcomeRequired: boolean;
}

interface OperatingRatioSemantic {
  readonly metricId: 'PRECISION' | 'RECALL' | 'RELIABILITY' | 'UTILIZATION';
  readonly numeratorField: 'numerator' | 'successful' | 'used';
  readonly denominatorField: 'denominator' | 'total' | 'capacity';
  readonly valueField: 'valuePermillion';
}

export const OPERATING_RATIO_SEMANTICS = Object.freeze({
  semanticVersion: 'v1',
  scale: '1000000',
  rounding: 'ROUND_HALF_UP',
  denominatorConstraint: 'POSITIVE',
  numeratorConstraint: 'ZERO_TO_DENOMINATOR_INCLUSIVE',
  metrics: Object.freeze([
    Object.freeze({ metricId: 'PRECISION', numeratorField: 'numerator', denominatorField: 'denominator', valueField: 'valuePermillion' }),
    Object.freeze({ metricId: 'RECALL', numeratorField: 'numerator', denominatorField: 'denominator', valueField: 'valuePermillion' }),
    Object.freeze({ metricId: 'RELIABILITY', numeratorField: 'successful', denominatorField: 'total', valueField: 'valuePermillion' }),
    Object.freeze({ metricId: 'UTILIZATION', numeratorField: 'used', denominatorField: 'capacity', valueField: 'valuePermillion' }),
  ] as const satisfies readonly OperatingRatioSemantic[]),
} as const);

export const EXPECTED_VS_REALIZED_VALUE_SEMANTICS = Object.freeze({
  semanticVersion: 'v1',
  metricId: 'EXPECTED_VS_REALIZED_VALUE',
  equation: 'delta = realized - expected',
  arithmetic: 'CAPITAL_EXACT_DECIMAL',
} as const);

export const EXPECTED_REALIZED_DELTA_MISMATCH = 'EXPECTED_REALIZED_DELTA_MISMATCH';

export const OPERATING_METRIC_CATALOG: readonly Readonly<OperatingMetricDefinition>[] = Object.freeze([
  Object.freeze({ metricId: 'LEAD_TIME', semanticVersion: 'v1', owner: 'INTELLIGENCE_FOUNDATION_OUTCOMES', measurementFields: Object.freeze(['durationMs']), unit: 'MILLISECONDS', productionOutcomeRequired: true }),
  Object.freeze({ metricId: 'PRECISION', semanticVersion: 'v1', owner: 'INTELLIGENCE_FOUNDATION_OUTCOMES', measurementFields: Object.freeze(['denominator', 'numerator', 'valuePermillion']), unit: 'PERMILLION', productionOutcomeRequired: true }),
  Object.freeze({ metricId: 'RECALL', semanticVersion: 'v1', owner: 'INTELLIGENCE_FOUNDATION_OUTCOMES', measurementFields: Object.freeze(['denominator', 'numerator', 'valuePermillion']), unit: 'PERMILLION', productionOutcomeRequired: true }),
  Object.freeze({ metricId: 'CALIBRATION', semanticVersion: 'v1', owner: 'INTELLIGENCE_FOUNDATION_OUTCOMES', measurementFields: Object.freeze(['brierPermillion', 'expectedCalibrationErrorPermillion']), unit: 'PERMILLION', productionOutcomeRequired: true }),
  Object.freeze({ metricId: 'FALSE_POSITIVES', semanticVersion: 'v1', owner: 'INTELLIGENCE_FOUNDATION_OUTCOMES', measurementFields: Object.freeze(['count']), unit: 'COUNT', productionOutcomeRequired: true }),
  Object.freeze({ metricId: 'MISSED_OPPORTUNITIES', semanticVersion: 'v1', owner: 'INTELLIGENCE_FOUNDATION_OUTCOMES', measurementFields: Object.freeze(['count']), unit: 'COUNT', productionOutcomeRequired: true }),
  Object.freeze({ metricId: 'EXPECTED_VS_REALIZED_VALUE', semanticVersion: 'v1', owner: 'CAPITAL_ECONOMICS', measurementFields: Object.freeze(['delta', 'expected', 'realized']), unit: 'EXACT_DECIMAL', productionOutcomeRequired: true }),
  Object.freeze({ metricId: 'EXECUTION_SHORTFALL', semanticVersion: 'v1', owner: 'CAPITAL_ECONOMICS', measurementFields: Object.freeze(['amount']), unit: 'EXACT_DECIMAL', productionOutcomeRequired: true }),
  Object.freeze({ metricId: 'ONE_LEG_DURATION', semanticVersion: 'v1', owner: 'FOUNDATION_EXECUTION', measurementFields: Object.freeze(['durationMs']), unit: 'MILLISECONDS', productionOutcomeRequired: true }),
  Object.freeze({ metricId: 'FRESHNESS', semanticVersion: 'v1', owner: 'INTELLIGENCE_RUNTIME', measurementFields: Object.freeze(['ageMs']), unit: 'MILLISECONDS', productionOutcomeRequired: false }),
  Object.freeze({ metricId: 'RELIABILITY', semanticVersion: 'v1', owner: 'FOUNDATION_CONTROL', measurementFields: Object.freeze(['successful', 'total', 'valuePermillion']), unit: 'PERMILLION', productionOutcomeRequired: false }),
  Object.freeze({ metricId: 'UTILIZATION', semanticVersion: 'v1', owner: 'CAPITAL_FOUNDATION', measurementFields: Object.freeze(['capacity', 'used', 'valuePermillion']), unit: 'PERMILLION', productionOutcomeRequired: true }),
  Object.freeze({ metricId: 'DRAWDOWN', semanticVersion: 'v1', owner: 'CAPITAL_ECONOMICS', measurementFields: Object.freeze(['amount']), unit: 'EXACT_DECIMAL', productionOutcomeRequired: true }),
  Object.freeze({ metricId: 'DECAY', semanticVersion: 'v1', owner: 'CAPITAL_ECONOMICS', measurementFields: Object.freeze(['amount']), unit: 'EXACT_DECIMAL', productionOutcomeRequired: true }),
  Object.freeze({ metricId: 'UPTIME', semanticVersion: 'v1', owner: 'FOUNDATION_CONTROL', measurementFields: Object.freeze(['durationMs']), unit: 'MILLISECONDS', productionOutcomeRequired: false }),
  Object.freeze({ metricId: 'RECOVERY', semanticVersion: 'v1', owner: 'FOUNDATION_CONTROL', measurementFields: Object.freeze(['durationMs']), unit: 'MILLISECONDS', productionOutcomeRequired: false }),
  Object.freeze({ metricId: 'AUTHORITY_VIOLATIONS', semanticVersion: 'v1', owner: 'PRODUCT_ASSURANCE', measurementFields: Object.freeze(['count']), unit: 'COUNT', productionOutcomeRequired: false }),
]);

export interface OperatingMetricFact {
  readonly metricId: OperatingMetricId;
  readonly owner: OperatingMetricOwner;
  readonly sourceRevision: string;
  readonly status: 'AVAILABLE' | 'DATA_INSUFFICIENT' | 'UNAVAILABLE';
  readonly evidencePosture: 'LIVE_OPERATIONAL' | 'PRODUCTION_OBSERVED' | 'RECORDED_REPLAY';
  readonly measuredAtMs: number | null;
  readonly measurements: Readonly<Record<string, string | null>>;
  readonly evidenceReferences: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface OperatingMetricSnapshotEntry {
  readonly definition: Readonly<OperatingMetricDefinition>;
  readonly status: 'AVAILABLE' | 'DATA_INSUFFICIENT' | 'DIVERGENT' | 'RECORDED_REPLAY' | 'UNAVAILABLE';
  readonly measuredAtMs: number | null;
  readonly measurements: Readonly<Record<string, string | null>>;
  readonly sourceRevision: string | null;
  readonly evidenceReferences: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface OperatingMetricCatalogSnapshot {
  readonly catalogRevision: string;
  readonly snapshotRevision: string;
  readonly evaluatedAtMs: number;
  readonly entries: readonly Readonly<OperatingMetricSnapshotEntry>[];
  readonly availableCount: number;
  readonly dataInsufficientCount: number;
  readonly recordedReplayCount: number;
  readonly unavailableCount: number;
  readonly divergentCount: number;
}

const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;
const UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/;
const MAXIMUM_MEASUREMENT_LENGTH = 128;
const PERMILLION_SCALE = 1_000_000n;
const RATIO_SEMANTICS_BY_METRIC = new Map<OperatingMetricId, OperatingRatioSemantic>(
  OPERATING_RATIO_SEMANTICS.metrics.map((semantic) => [semantic.metricId, semantic]),
);

function nonEmpty(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= maximum;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function nullMeasurements(definition: OperatingMetricDefinition): Readonly<Record<string, null>> {
  return Object.freeze(Object.fromEntries(definition.measurementFields.map((field) => [field, null])));
}

function boundedUnsignedInteger(value: unknown): bigint | null {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAXIMUM_MEASUREMENT_LENGTH
    || !UNSIGNED_INTEGER.test(value)) return null;
  return BigInt(value);
}

function ratioPermillion(numerator: bigint, denominator: bigint): bigint {
  const scaled = numerator * PERMILLION_SCALE;
  const quotient = scaled / denominator;
  const remainder = scaled % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function validateRatioMeasurements(
  measurements: Readonly<Record<string, string | null>>,
  semantic: OperatingRatioSemantic,
): readonly string[] {
  const numerator = boundedUnsignedInteger(measurements[semantic.numeratorField]);
  const denominator = boundedUnsignedInteger(measurements[semantic.denominatorField]);
  const statedValue = boundedUnsignedInteger(measurements[semantic.valueField]);
  if (numerator === null || denominator === null || statedValue === null) return Object.freeze([]);
  if (denominator === 0n) return Object.freeze(['RATIO_DENOMINATOR_NOT_POSITIVE']);
  if (numerator > denominator) return Object.freeze(['RATIO_NUMERATOR_EXCEEDS_DENOMINATOR']);
  if (statedValue !== ratioPermillion(numerator, denominator)) {
    return Object.freeze(['RATIO_VALUE_PERMILLION_MISMATCH']);
  }
  return Object.freeze([]);
}

function validateExpectedVsRealizedMeasurements(
  measurements: Readonly<Record<string, string | null>>,
): readonly string[] {
  const delta = measurements.delta;
  const expected = measurements.expected;
  const realized = measurements.realized;
  if (!isExactDecimal(delta) || !isExactDecimal(expected) || !isExactDecimal(realized)) {
    return Object.freeze([]);
  }
  // System Integration validates the supplied owner fact; it never substitutes
  // a recomputed value into the public metric snapshot.
  const exactDelta: ExactDecimal = subtractExactDecimals(realized, expected);
  return compareExactDecimals(delta, exactDelta) === 0
    ? Object.freeze([])
    : Object.freeze([EXPECTED_REALIZED_DELTA_MISMATCH]);
}

function validateFact(
  fact: Readonly<OperatingMetricFact>,
  definition: Readonly<OperatingMetricDefinition>,
  evaluatedAtMs: number,
): readonly string[] {
  const reasons: string[] = [];
  if (fact.owner !== definition.owner) reasons.push('OWNER_MISMATCH');
  if (!nonEmpty(fact.sourceRevision)) reasons.push('SOURCE_REVISION_INVALID');
  if (!['AVAILABLE', 'DATA_INSUFFICIENT', 'UNAVAILABLE'].includes(fact.status)) reasons.push('STATUS_INVALID');
  if (!['LIVE_OPERATIONAL', 'PRODUCTION_OBSERVED', 'RECORDED_REPLAY'].includes(fact.evidencePosture)) {
    reasons.push('EVIDENCE_POSTURE_INVALID');
  }
  if (definition.productionOutcomeRequired
    && fact.status === 'AVAILABLE'
    && fact.evidencePosture === 'LIVE_OPERATIONAL') reasons.push('PRODUCTION_POSTURE_INVALID');
  if (fact.measuredAtMs !== null
    && (!isValidUtcMillis(fact.measuredAtMs) || fact.measuredAtMs > evaluatedAtMs)) reasons.push('MEASURED_AT_INVALID');
  if (!fact.measurements || typeof fact.measurements !== 'object' || Array.isArray(fact.measurements)) {
    reasons.push('MEASUREMENTS_INVALID');
  } else {
    const keys = Object.keys(fact.measurements).sort();
    if (canonicalJson(keys) !== canonicalJson([...definition.measurementFields].sort())) {
      reasons.push('MEASUREMENT_FIELDS_MISMATCH');
    } else {
      for (const field of definition.measurementFields) {
        const value = fact.measurements[field];
        if (fact.status !== 'AVAILABLE') {
          if (value !== null) reasons.push('UNAVAILABLE_VALUE_FABRICATED');
          continue;
        }
        if (typeof value === 'string' && value.length > MAXIMUM_MEASUREMENT_LENGTH) {
          reasons.push(`MEASUREMENT_${field.toUpperCase()}_TOO_LONG`);
        } else if (typeof value !== 'string'
          || !DECIMAL.test(value)
          || value === '-0'
          || (definition.unit === 'EXACT_DECIMAL' && !isExactDecimal(value))) {
          reasons.push(`MEASUREMENT_${field.toUpperCase()}_INVALID`);
        } else if ((definition.unit === 'COUNT' || definition.unit === 'MILLISECONDS' || definition.unit === 'PERMILLION')
          && !UNSIGNED_INTEGER.test(value)) {
          reasons.push(`MEASUREMENT_${field.toUpperCase()}_NOT_UNSIGNED_INTEGER`);
        } else if ((definition.unit === 'PERMILLION' && field.toLowerCase().includes('permillion'))
          && BigInt(value) > 1_000_000n) {
          reasons.push(`MEASUREMENT_${field.toUpperCase()}_OUT_OF_RANGE`);
        }
      }
      const ratioSemantic = RATIO_SEMANTICS_BY_METRIC.get(definition.metricId);
      if (fact.status === 'AVAILABLE' && ratioSemantic !== undefined) {
        reasons.push(...validateRatioMeasurements(fact.measurements, ratioSemantic));
      }
      if (fact.status === 'AVAILABLE' && definition.metricId === 'EXPECTED_VS_REALIZED_VALUE') {
        reasons.push(...validateExpectedVsRealizedMeasurements(fact.measurements));
      }
    }
  }
  if (!Array.isArray(fact.evidenceReferences) || fact.evidenceReferences.length > 64
    || fact.evidenceReferences.some((value) => !nonEmpty(value))) reasons.push('EVIDENCE_REFERENCES_INVALID');
  if (!Array.isArray(fact.reasonCodes) || fact.reasonCodes.length > 64
    || fact.reasonCodes.some((value) => !/^[A-Z][A-Z0-9_]{0,63}$/.test(value))) reasons.push('REASON_CODES_INVALID');
  if (fact.status === 'AVAILABLE') {
    if (fact.measuredAtMs === null) reasons.push('MEASURED_AT_REQUIRED');
    if (fact.evidenceReferences.length === 0) reasons.push('EVIDENCE_REQUIRED');
  } else if (fact.reasonCodes.length === 0) {
    reasons.push('UNAVAILABLE_REASON_REQUIRED');
  }
  return sortedUnique(reasons);
}

function preservedEvidenceReferences(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 64) return Object.freeze([]);
  return sortedUnique(value.filter((candidate): candidate is string => nonEmpty(candidate)));
}

function preservedReasonCodes(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 64) return Object.freeze([]);
  return sortedUnique(value.filter(
    (candidate): candidate is string => typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(candidate),
  ));
}

function divergentFact(
  fact: Readonly<OperatingMetricFact>,
  definition: Readonly<OperatingMetricDefinition>,
  issues: readonly string[],
  evaluatedAtMs: number,
): Readonly<OperatingMetricSnapshotEntry> {
  const measuredAtMs = fact.measuredAtMs !== null
    && isValidUtcMillis(fact.measuredAtMs)
    && fact.measuredAtMs <= evaluatedAtMs
    ? fact.measuredAtMs
    : null;
  return Object.freeze({
    definition,
    status: 'DIVERGENT',
    measuredAtMs,
    measurements: nullMeasurements(definition),
    sourceRevision: nonEmpty(fact.sourceRevision) ? fact.sourceRevision : null,
    evidenceReferences: preservedEvidenceReferences(fact.evidenceReferences),
    reasonCodes: sortedUnique([...preservedReasonCodes(fact.reasonCodes), ...issues]),
  });
}

function normalizedCandidateRevision(
  fact: Readonly<OperatingMetricFact>,
  definition: Readonly<OperatingMetricDefinition>,
): string {
  const boundedMeasurements = Object.fromEntries(definition.measurementFields.map((field) => {
    const value = fact.measurements && typeof fact.measurements === 'object' && !Array.isArray(fact.measurements)
      ? fact.measurements[field]
      : undefined;
    if (value === null) return [field, null];
    if (typeof value === 'string' && value.length <= MAXIMUM_MEASUREMENT_LENGTH) return [field, value];
    return [field, 'INVALID_OR_UNBOUNDED'];
  }));
  const evidenceReferences = Array.isArray(fact.evidenceReferences) && fact.evidenceReferences.length <= 64
    ? preservedEvidenceReferences(fact.evidenceReferences)
    : Object.freeze([`INVALID_SET_LENGTH:${Array.isArray(fact.evidenceReferences) ? fact.evidenceReferences.length : -1}`]);
  const reasonCodes = Array.isArray(fact.reasonCodes) && fact.reasonCodes.length <= 64
    ? preservedReasonCodes(fact.reasonCodes)
    : Object.freeze([`INVALID_SET_LENGTH:${Array.isArray(fact.reasonCodes) ? fact.reasonCodes.length : -1}`]);
  const payload = {
    metricId: fact.metricId,
    owner: fact.owner,
    sourceRevision: nonEmpty(fact.sourceRevision) ? fact.sourceRevision : 'INVALID_OR_UNBOUNDED',
    status: fact.status,
    evidencePosture: fact.evidencePosture,
    measuredAtMs: fact.measuredAtMs,
    measurements: boundedMeasurements,
    evidenceReferences,
    reasonCodes,
  };
  return stableHash128Hex(canonicalJson(payload));
}

function freezeFact(
  fact: Readonly<OperatingMetricFact>,
  definition: Readonly<OperatingMetricDefinition>,
): Readonly<OperatingMetricSnapshotEntry> {
  return Object.freeze({
    definition,
    status: fact.status === 'AVAILABLE' && fact.evidencePosture === 'RECORDED_REPLAY'
      ? 'RECORDED_REPLAY'
      : fact.status,
    measuredAtMs: fact.measuredAtMs,
    measurements: Object.freeze(Object.fromEntries(definition.measurementFields.map((field) => [field, fact.measurements[field]]))),
    sourceRevision: fact.sourceRevision,
    evidenceReferences: sortedUnique(fact.evidenceReferences),
    reasonCodes: sortedUnique(fact.reasonCodes),
  });
}

export function buildOperatingMetricCatalogSnapshot(
  facts: readonly Readonly<OperatingMetricFact>[],
  evaluatedAtMs: number,
): Readonly<OperatingMetricCatalogSnapshot> {
  if (!isValidUtcMillis(evaluatedAtMs)) throw new TypeError('operating-metric evaluatedAtMs must be UTC milliseconds');
  if (!Array.isArray(facts) || facts.length > 10_000) throw new TypeError('operating metric facts must be a bounded array');
  const definitions = new Map(OPERATING_METRIC_CATALOG.map((definition) => [definition.metricId, definition]));
  for (const fact of facts) {
    if (!definitions.has(fact.metricId)) throw new TypeError(`unknown operating metric ${String(fact.metricId)}`);
  }
  const entries = OPERATING_METRIC_CATALOG.map((definition): Readonly<OperatingMetricSnapshotEntry> => {
    const candidates = facts.filter((fact) => fact.metricId === definition.metricId);
    if (candidates.length === 0) {
      return Object.freeze({
        definition,
        status: definition.productionOutcomeRequired ? 'DATA_INSUFFICIENT' : 'UNAVAILABLE',
        measuredAtMs: null,
        measurements: nullMeasurements(definition),
        sourceRevision: null,
        evidenceReferences: Object.freeze([]),
        reasonCodes: Object.freeze([definition.productionOutcomeRequired ? 'PRODUCTION_EVIDENCE_ABSENT' : 'OWNER_FACT_ABSENT']),
      });
    }
    if (candidates.length > 1) {
      return Object.freeze({
        definition,
        status: 'DIVERGENT',
        measuredAtMs: null,
        measurements: nullMeasurements(definition),
        sourceRevision: null,
        evidenceReferences: Object.freeze([]),
        reasonCodes: Object.freeze(['DUPLICATE_OWNER_FACT']),
      });
    }
    const fact = candidates[0];
    const issues = validateFact(fact, definition, evaluatedAtMs);
    if (issues.length > 0) {
      return divergentFact(fact, definition, issues, evaluatedAtMs);
    }
    return freezeFact(fact, definition);
  });
  const counts = (status: OperatingMetricSnapshotEntry['status']): number => entries.filter((entry) => entry.status === status).length;
  const catalogPayload = {
    definitions: OPERATING_METRIC_CATALOG.map((definition) => ({
      ...definition,
      measurementFields: [...definition.measurementFields],
    })),
    ratioSemantics: OPERATING_RATIO_SEMANTICS,
    expectedVsRealizedValueSemantics: EXPECTED_VS_REALIZED_VALUE_SEMANTICS,
  };
  const catalogRevision = `system-operating-metrics:${stableHash128Hex(canonicalJson(catalogPayload))}`;
  const snapshotPayload = {
    catalogRevision,
    evaluatedAtMs,
    entries: entries.map((entry) => ({
      metricId: entry.definition.metricId,
      status: entry.status,
      measuredAtMs: entry.measuredAtMs,
      measurements: entry.measurements,
      sourceRevision: entry.sourceRevision,
      evidenceReferences: [...entry.evidenceReferences],
      reasonCodes: [...entry.reasonCodes],
    })),
    candidateRevisions: facts.map((fact) => {
      const definition = definitions.get(fact.metricId);
      if (definition === undefined) throw new TypeError(`unknown operating metric ${String(fact.metricId)}`);
      return normalizedCandidateRevision(fact, definition);
    }).sort(),
  };
  return Object.freeze({
    catalogRevision,
    snapshotRevision: `system-operating-metrics-snapshot:${stableHash128Hex(canonicalJson(snapshotPayload))}`,
    evaluatedAtMs,
    entries: Object.freeze(entries),
    availableCount: counts('AVAILABLE'),
    dataInsufficientCount: counts('DATA_INSUFFICIENT'),
    recordedReplayCount: counts('RECORDED_REPLAY'),
    unavailableCount: counts('UNAVAILABLE'),
    divergentCount: counts('DIVERGENT'),
  });
}

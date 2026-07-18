/**
 * Deterministic strategy-decay measurement.
 *
 * This module consumes canonical Foundation calibration reports and canonical
 * Capital CLOSED_OUTCOME economic reports. It acquires no data, owns no
 * timer/socket/store, and treats absent production authority or absent direct
 * competitor-displacement evidence as UNKNOWN.
 */
import type {
  CalibrationReport,
  ExactFraction as CalibrationFraction,
} from '../../foundation/calibration/index.js';
import {
  canonicalJson,
  isValidUtcMillis,
  stableHash128Hex,
} from '../../foundation/contracts/index.js';
import {
  normalizeExactDecimal,
  validateEconomicAttribution,
  type ExactDecimal,
} from '../../capitalFoundation/contracts/index.js';
import {
  composeEconomicReport,
  validateEconomicAccountingPolicy,
  type EconomicReport,
} from '../../capitalFoundation/economics/index.js';
import {
  deriveStrategyDecayMeasurementId,
  validateStrategyDecayMeasurement,
} from './governance.js';
import {
  STRATEGY_DECAY_EVIDENCE_AUTHORITIES,
  STRATEGY_DECAY_MEASUREMENT_SCHEMA,
  STRATEGY_DECAY_MEASUREMENT_SCHEMA_VERSION,
  STRATEGY_DECAY_SOURCES,
  type StrategyDecayAxisAssessment,
  type StrategyDecayEvidenceAuthority,
  type StrategyDecayMeasurement,
  type StrategyDecaySource,
  type StrategyDecayState,
  type StrategyDecayWindow,
} from './types.js';

export const STRATEGY_DECAY_MEASUREMENT_POLICY_SCHEMA = 'cosmos.engine.strategy-decay.measurement-policy' as const;
export const STRATEGY_DECAY_MEASUREMENT_POLICY_SCHEMA_VERSION = 1 as const;
const MAX_CORPUS_SAMPLES = 10_000;
const MAX_SAFE_SNAPSHOT_NODES = 250_000;
const PPM_SCALE = 1_000_000;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const POLICY_REVISION = /^decaymeasurepolicy_[a-f0-9]{32}$/;

export const STRATEGY_DECAY_EVIDENCE_OWNERS = Object.freeze([
  'FOUNDATION_CALIBRATION',
  'CAPITAL_CLOSED_OUTCOME',
  'ENGINE_DIRECT_CROWDING',
] as const);
export type StrategyDecayEvidenceOwner = (typeof STRATEGY_DECAY_EVIDENCE_OWNERS)[number];

export interface StrategyDecayEvidenceBinding {
  readonly owner: StrategyDecayEvidenceOwner;
  readonly authority: StrategyDecayEvidenceAuthority;
  readonly sourceId: string | null;
  readonly revision: string | null;
}

export interface StrategyDecayCalibrationEvidence {
  readonly binding: Readonly<StrategyDecayEvidenceBinding>;
  readonly report: Readonly<CalibrationReport> | null;
}

export interface StrategyDecayClosedOutcomeCorpus {
  readonly binding: Readonly<StrategyDecayEvidenceBinding>;
  readonly reports: readonly Readonly<EconomicReport>[];
}

export interface StrategyDecayDirectCrowdingEvidence {
  readonly binding: Readonly<StrategyDecayEvidenceBinding>;
  readonly eligibleOpportunityCount: number;
  readonly competitorDisplacedOpportunityCount: number;
  readonly observationIds: readonly string[];
}

export interface StrategyDecayEvidenceWindow {
  readonly window: Readonly<StrategyDecayWindow>;
  readonly calibration: Readonly<StrategyDecayCalibrationEvidence>;
  readonly closedOutcomes: Readonly<StrategyDecayClosedOutcomeCorpus>;
  readonly directCrowding: Readonly<StrategyDecayDirectCrowdingEvidence> | null;
}

export interface StrategyDecayMeasurementPolicy {
  readonly schema: typeof STRATEGY_DECAY_MEASUREMENT_POLICY_SCHEMA;
  readonly schemaVersion: typeof STRATEGY_DECAY_MEASUREMENT_POLICY_SCHEMA_VERSION;
  readonly policyId: string;
  readonly policyRevision: string;
  readonly windowDurationMs: number;
  readonly minimumWindowGapMs: number;
  readonly minimumCalibrationSamples: number;
  readonly minimumClosedOutcomeSamples: number;
  readonly minimumDirectCrowdingSamples: number;
  readonly calibrationGapIncreaseDegradedPpm: number;
  readonly calibrationGapIncreaseDeadPpm: number;
  readonly netValueDeclineDegradedPpm: number;
  readonly netValueDeclineDeadPpm: number;
  readonly competitorDisplacementDegradedPpm: number;
  readonly competitorDisplacementDeadPpm: number;
}

export interface MeasureStrategyDecayInput {
  readonly policy: Readonly<StrategyDecayMeasurementPolicy>;
  readonly strategy: StrategyDecaySource;
  readonly configVersion: string;
  readonly direction: string;
  readonly evaluatedAtMs: number;
  readonly baseline: Readonly<StrategyDecayEvidenceWindow>;
  readonly current: Readonly<StrategyDecayEvidenceWindow>;
}

export type MeasureStrategyDecayResult =
  | { readonly ok: true; readonly measurement: Readonly<StrategyDecayMeasurement> }
  | { readonly ok: false; readonly reasonCodes: readonly string[] };

const POLICY_KEYS = Object.freeze([
  'schema', 'schemaVersion', 'policyId', 'policyRevision', 'windowDurationMs',
  'minimumWindowGapMs', 'minimumCalibrationSamples', 'minimumClosedOutcomeSamples',
  'minimumDirectCrowdingSamples', 'calibrationGapIncreaseDegradedPpm',
  'calibrationGapIncreaseDeadPpm', 'netValueDeclineDegradedPpm',
  'netValueDeclineDeadPpm', 'competitorDisplacementDegradedPpm',
  'competitorDisplacementDeadPpm',
] as const);
const INPUT_KEYS = Object.freeze([
  'policy', 'strategy', 'configVersion', 'direction', 'evaluatedAtMs', 'baseline', 'current',
] as const);
const EVIDENCE_WINDOW_KEYS = Object.freeze(['window', 'calibration', 'closedOutcomes', 'directCrowding'] as const);
const WINDOW_KEYS = Object.freeze(['startAtMs', 'endAtMs'] as const);
const BINDING_KEYS = Object.freeze(['owner', 'authority', 'sourceId', 'revision'] as const);
const CALIBRATION_EVIDENCE_KEYS = Object.freeze(['binding', 'report'] as const);
const CLOSED_OUTCOME_KEYS = Object.freeze(['binding', 'reports'] as const);
const DIRECT_CROWDING_KEYS = Object.freeze([
  'binding', 'eligibleOpportunityCount', 'competitorDisplacedOpportunityCount', 'observationIds',
] as const);
const CALIBRATION_REPORT_KEYS = Object.freeze([
  'reportId', 'cohortId', 'evaluatedAtMs', 'cohort', 'inputRecordCount', 'uniqueRecordCount',
  'duplicateIdenticalCount', 'includedCount', 'excludedCount', 'includedOutcomeIds',
  'exclusions', 'missingEvidence', 'metrics', 'strategyMutationAuthority',
  'automaticStrategyMutation',
] as const);
const CALIBRATION_COHORT_KEYS = Object.freeze([
  'source', 'strategySchema', 'configVersion', 'direction', 'resultUnit', 'observationHorizonMs',
] as const);
const CALIBRATION_METRIC_KEYS = Object.freeze([
  'completeCount', 'successCount', 'failureCount', 'successRate', 'probability', 'grossResult',
  'fees', 'slippage', 'otherCosts', 'netResult', 'fillRatioPpm', 'fullyObservedEconomicCount',
] as const);
const PROBABILITY_KEYS = Object.freeze([
  'scalePpm', 'knownCount', 'missingCount', 'meanPredictedProbability',
  'observedPositiveFrequency', 'brierLoss',
] as const);
const FRACTION_KEYS = Object.freeze(['numerator', 'denominator'] as const);
const ECONOMIC_REPORT_KEYS = Object.freeze([
  'scope', 'policy', 'attribution', 'measures', 'dimensions', 'accountingStatus',
  'accountingConfidence', 'identity', 'excludedComponentIds',
] as const);
const ECONOMIC_SCOPE_KEYS = Object.freeze([
  'kind', 'id', 'strategy', 'opportunityId', 'configRevision', 'stage', 'symbol', 'legId',
  'correlationId',
] as const);
const ECONOMIC_ATTRIBUTION_KEYS = Object.freeze([
  'components', 'valuationAsset', 'netKnown', 'netEstimatedRange', 'completeness',
  'accountingIdentityProven', 'includedComponentIds', 'missingComponentKinds',
  'divergentReasons', 'evaluatedAtMs',
] as const);
const ECONOMIC_IDENTITY_KEYS = Object.freeze([
  'knownIncludedComponentIds', 'estimatedIncludedComponentIds', 'knownComponentSum',
  'estimatedLowSum', 'estimatedHighSum', 'equation', 'proven',
] as const);

interface Fraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

interface CalibrationSample {
  readonly sampleCount: number;
  readonly error: Fraction;
  readonly sourceId: string;
  readonly cohortKey: string;
  readonly sampleIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

interface EconomicSample {
  readonly sampleCount: number;
  readonly mean: Fraction;
  readonly sourceId: string;
  readonly valuationAsset: string;
  readonly accountingPolicyRevision: string;
  readonly sampleIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

interface CrowdingSample {
  readonly sampleCount: number;
  readonly rate: Fraction;
  readonly sourceId: string;
  readonly sampleIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

interface SnapshotBudget {
  nodes: number;
  seen: Set<object>;
}

function safeSnapshotValue(value: unknown, budget: SnapshotBudget): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_SAFE_SNAPSHOT_NODES) throw new RangeError('snapshot node bound exceeded');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('unsupported snapshot value');
  const object = value as object;
  if (budget.seen.has(object)) throw new TypeError('cyclic snapshot');
  budget.seen.add(object);
  try {
    if (Array.isArray(object)) {
      if (object.length > MAX_CORPUS_SAMPLES) throw new RangeError('array bound exceeded');
      const keys = Reflect.ownKeys(object);
      if (keys.some((key) => typeof key !== 'string'
        || (key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= object.length)))) {
        throw new TypeError('array side property');
      }
      const copy: unknown[] = [];
      for (let index = 0; index < object.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(object, String(index));
        if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) throw new TypeError('array accessor');
        copy.push(safeSnapshotValue(descriptor.value, budget));
      }
      return copy;
    }
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('non-plain object');
    const keys = Reflect.ownKeys(object);
    if (keys.some((key) => typeof key !== 'string')) throw new TypeError('symbol field');
    const copy: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) throw new TypeError('object accessor');
      copy[key] = safeSnapshotValue(descriptor.value, budget);
    }
    return copy;
  } finally {
    budget.seen.delete(object);
  }
}

function safeSnapshot(value: unknown): unknown | null {
  try {
    return safeSnapshotValue(value, { nodes: 0, seen: new Set() });
  } catch {
    return null;
  }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key)) ? record : null;
}

function denseArray(value: unknown, maximum = MAX_CORPUS_SAMPLES): readonly unknown[] | null {
  return Array.isArray(value) && value.length <= maximum ? value : null;
}

function label(value: unknown): value is string {
  return typeof value === 'string' && LABEL.test(value);
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return nonNegativeSafeInteger(value) && value > 0;
}

function ppm(value: unknown): value is number {
  return nonNegativeSafeInteger(value) && value <= PPM_SCALE;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a === 0n ? 1n : a;
}

function fraction(numerator: bigint, denominator: bigint): Fraction {
  if (denominator <= 0n) throw new TypeError('fraction denominator must be positive');
  const divisor = gcd(numerator, denominator);
  const sign = denominator < 0n ? -1n : 1n;
  return Object.freeze({ numerator: numerator / divisor * sign, denominator: denominator / divisor * sign });
}

function parseFraction(value: unknown): Fraction | null {
  const record = exactRecord(value, FRACTION_KEYS);
  if (record === null
    || typeof record.numerator !== 'string'
    || typeof record.denominator !== 'string'
    || !/^-?(?:0|[1-9][0-9]{0,127})$/.test(record.numerator)
    || !/^[1-9][0-9]{0,127}$/.test(record.denominator)) return null;
  try {
    const parsed = fraction(BigInt(record.numerator), BigInt(record.denominator));
    if (parsed.numerator.toString() !== record.numerator || parsed.denominator.toString() !== record.denominator) return null;
    return parsed;
  } catch {
    return null;
  }
}

function compareFractions(left: Fraction, right: Fraction): -1 | 0 | 1 {
  const l = left.numerator * right.denominator;
  const r = right.numerator * left.denominator;
  return l < r ? -1 : l > r ? 1 : 0;
}

function addFractions(left: Fraction, right: Fraction): Fraction {
  return fraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function subtractFractions(left: Fraction, right: Fraction): Fraction {
  return fraction(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function absoluteFraction(value: Fraction): Fraction {
  return value.numerator < 0n ? fraction(-value.numerator, value.denominator) : value;
}

function formatFraction(value: Fraction): string {
  return `${value.numerator.toString()}/${value.denominator.toString()}`;
}

function atLeastPpm(value: Fraction, thresholdPpm: number): boolean {
  return compareFractions(value, fraction(BigInt(thresholdPpm), BigInt(PPM_SCALE))) >= 0;
}

function decimalFraction(value: unknown): Fraction | null {
  let normalized: string;
  try {
    normalized = normalizeExactDecimal(value);
  } catch {
    return null;
  }
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, decimal = ''] = unsigned.split('.');
  const numerator = BigInt(`${whole}${decimal}`) * (negative ? -1n : 1n);
  return fraction(numerator, 10n ** BigInt(decimal.length));
}

function policyMaterial(policy: Omit<StrategyDecayMeasurementPolicy, 'policyRevision'>): unknown {
  return {
    schema: policy.schema,
    schemaVersion: policy.schemaVersion,
    policyId: policy.policyId,
    windowDurationMs: policy.windowDurationMs,
    minimumWindowGapMs: policy.minimumWindowGapMs,
    minimumCalibrationSamples: policy.minimumCalibrationSamples,
    minimumClosedOutcomeSamples: policy.minimumClosedOutcomeSamples,
    minimumDirectCrowdingSamples: policy.minimumDirectCrowdingSamples,
    calibrationGapIncreaseDegradedPpm: policy.calibrationGapIncreaseDegradedPpm,
    calibrationGapIncreaseDeadPpm: policy.calibrationGapIncreaseDeadPpm,
    netValueDeclineDegradedPpm: policy.netValueDeclineDegradedPpm,
    netValueDeclineDeadPpm: policy.netValueDeclineDeadPpm,
    competitorDisplacementDegradedPpm: policy.competitorDisplacementDegradedPpm,
    competitorDisplacementDeadPpm: policy.competitorDisplacementDeadPpm,
  };
}

export function deriveStrategyDecayMeasurementPolicyRevision(
  policy: Omit<StrategyDecayMeasurementPolicy, 'policyRevision'>,
): string {
  return `decaymeasurepolicy_${stableHash128Hex(canonicalJson(policyMaterial(policy)))}`;
}

export function validateStrategyDecayMeasurementPolicy(value: unknown): readonly string[] {
  const issues: string[] = [];
  const policy = exactRecord(value, POLICY_KEYS);
  if (policy === null) return Object.freeze(['MEASUREMENT_POLICY_SHAPE_INVALID']);
  if (policy.schema !== STRATEGY_DECAY_MEASUREMENT_POLICY_SCHEMA) issues.push('MEASUREMENT_POLICY_SCHEMA_INVALID');
  if (policy.schemaVersion !== STRATEGY_DECAY_MEASUREMENT_POLICY_SCHEMA_VERSION) issues.push('MEASUREMENT_POLICY_SCHEMA_VERSION_INVALID');
  if (!label(policy.policyId)) issues.push('MEASUREMENT_POLICY_ID_INVALID');
  if (typeof policy.policyRevision !== 'string' || !POLICY_REVISION.test(policy.policyRevision)) issues.push('MEASUREMENT_POLICY_REVISION_INVALID');
  if (!positiveSafeInteger(policy.windowDurationMs)) issues.push('MEASUREMENT_WINDOW_DURATION_INVALID');
  if (!nonNegativeSafeInteger(policy.minimumWindowGapMs)) issues.push('MEASUREMENT_WINDOW_GAP_INVALID');
  for (const key of ['minimumCalibrationSamples', 'minimumClosedOutcomeSamples', 'minimumDirectCrowdingSamples'] as const) {
    if (!positiveSafeInteger(policy[key]) || policy[key] > MAX_CORPUS_SAMPLES) issues.push(`${key.toUpperCase()}_INVALID`);
  }
  const thresholdPairs = [
    ['calibrationGapIncreaseDegradedPpm', 'calibrationGapIncreaseDeadPpm'],
    ['netValueDeclineDegradedPpm', 'netValueDeclineDeadPpm'],
    ['competitorDisplacementDegradedPpm', 'competitorDisplacementDeadPpm'],
  ] as const;
  for (const [degradedKey, deadKey] of thresholdPairs) {
    if (!ppm(policy[degradedKey]) || !ppm(policy[deadKey])) issues.push(`${degradedKey.toUpperCase()}_INVALID`);
    else if (policy[degradedKey] >= policy[deadKey]) issues.push(`${deadKey.toUpperCase()}_MUST_EXCEED_DEGRADED`);
  }
  if (issues.length === 0) {
    try {
      const expected = deriveStrategyDecayMeasurementPolicyRevision(policy as unknown as StrategyDecayMeasurementPolicy);
      if (policy.policyRevision !== expected) issues.push('MEASUREMENT_POLICY_REVISION_CONTENT_MISMATCH');
    } catch {
      issues.push('MEASUREMENT_POLICY_REVISION_CONTENT_MISMATCH');
    }
  }
  return Object.freeze([...new Set(issues)].sort());
}

function validBinding(value: unknown, owner: StrategyDecayEvidenceOwner): StrategyDecayEvidenceBinding | null {
  const binding = exactRecord(value, BINDING_KEYS);
  if (binding === null
    || binding.owner !== owner
    || !(STRATEGY_DECAY_EVIDENCE_AUTHORITIES as readonly unknown[]).includes(binding.authority)) return null;
  if (binding.authority === 'UNKNOWN') {
    if (binding.sourceId !== null || binding.revision !== null) return null;
  } else if (!label(binding.sourceId) || !label(binding.revision)) return null;
  return binding as unknown as StrategyDecayEvidenceBinding;
}

function validIdArray(value: unknown): readonly string[] | null {
  const values = denseArray(value);
  if (values === null || values.some((entry) => !label(entry))) return null;
  const ids = values as readonly string[];
  return new Set(ids).size === ids.length ? Object.freeze([...ids]) : null;
}

function calibrationSample(
  evidence: unknown,
  window: StrategyDecayWindow,
  input: MeasureStrategyDecayInput,
): CalibrationSample | null {
  const wrapper = exactRecord(evidence, CALIBRATION_EVIDENCE_KEYS);
  const binding = wrapper === null ? null : validBinding(wrapper.binding, 'FOUNDATION_CALIBRATION');
  if (wrapper === null || binding?.authority !== 'PRODUCTION'
    || binding.sourceId === null || binding.revision === null) return null;
  const report = exactRecord(wrapper.report, CALIBRATION_REPORT_KEYS);
  if (report === null
    || !label(report.reportId)
    || report.strategyMutationAuthority !== 'NONE'
    || report.automaticStrategyMutation !== false
    || !isValidUtcMillis(report.evaluatedAtMs)
    || report.evaluatedAtMs < window.endAtMs
    || report.evaluatedAtMs > input.evaluatedAtMs) return null;
  const cohort = exactRecord(report.cohort, CALIBRATION_COHORT_KEYS);
  const metrics = exactRecord(report.metrics, CALIBRATION_METRIC_KEYS);
  const probability = metrics === null ? null : exactRecord(metrics.probability, PROBABILITY_KEYS);
  const ids = validIdArray(report.includedOutcomeIds);
  if (cohort === null || metrics === null || probability === null || ids === null
    || cohort.source !== input.strategy
    || cohort.configVersion !== input.configVersion
    || cohort.direction !== input.direction
    || !positiveSafeInteger(cohort.observationHorizonMs)
    || cohort.observationHorizonMs > input.policy.windowDurationMs
    || !nonNegativeSafeInteger(report.includedCount)
    || report.includedCount !== ids.length
    || metrics.completeCount !== report.includedCount
    || probability.scalePpm !== PPM_SCALE
    || !nonNegativeSafeInteger(probability.knownCount)
    || probability.knownCount < input.policy.minimumCalibrationSamples
    || probability.knownCount > report.includedCount) return null;
  const predicted = parseFraction(probability.meanPredictedProbability);
  const observed = parseFraction(probability.observedPositiveFrequency);
  const zero = fraction(0n, 1n);
  const one = fraction(1n, 1n);
  if (predicted === null || observed === null
    || compareFractions(predicted, zero) < 0 || compareFractions(predicted, one) > 0
    || compareFractions(observed, zero) < 0 || compareFractions(observed, one) > 0) return null;
  return Object.freeze({
    sampleCount: probability.knownCount,
    error: absoluteFraction(subtractFractions(predicted, observed)),
    sourceId: binding.sourceId,
    cohortKey: canonicalJson({
      source: cohort.source,
      strategySchema: cohort.strategySchema,
      configVersion: cohort.configVersion,
      direction: cohort.direction,
      resultUnit: cohort.resultUnit,
      observationHorizonMs: cohort.observationHorizonMs,
    }),
    sampleIds: sortedUnique(ids),
    evidenceIds: sortedUnique([binding.sourceId, binding.revision, report.reportId as string, ...ids]),
  });
}

function economicSample(
  evidence: unknown,
  window: StrategyDecayWindow,
  input: MeasureStrategyDecayInput,
): EconomicSample | null {
  const wrapper = exactRecord(evidence, CLOSED_OUTCOME_KEYS);
  const binding = wrapper === null ? null : validBinding(wrapper.binding, 'CAPITAL_CLOSED_OUTCOME');
  if (wrapper === null || binding?.authority !== 'PRODUCTION'
    || binding.sourceId === null || binding.revision === null) return null;
  const reports = denseArray(wrapper.reports);
  if (reports === null || reports.length < input.policy.minimumClosedOutcomeSamples) return null;
  const ids: string[] = [];
  const values: ExactDecimal[] = [];
  let valuationAsset: string | null = null;
  let accountingPolicyRevision: string | null = null;
  for (const raw of reports) {
    const report = exactRecord(raw, ECONOMIC_REPORT_KEYS);
    const scope = report === null ? null : exactRecord(report.scope, ECONOMIC_SCOPE_KEYS);
    const attribution = report === null ? null : exactRecord(report.attribution, ECONOMIC_ATTRIBUTION_KEYS);
    const identity = report === null ? null : exactRecord(report.identity, ECONOMIC_IDENTITY_KEYS);
    if (report === null || scope === null || attribution === null || identity === null
      || scope.kind !== 'CLOSED_OUTCOME'
      || !label(scope.id)
      || scope.strategy !== input.strategy
      || scope.configRevision !== input.configVersion
      || report.accountingStatus !== 'COMPLETE'
      || report.accountingConfidence !== 'HIGH'
      || attribution.completeness !== 'COMPLETE'
      || attribution.accountingIdentityProven !== true
      || identity.proven !== true
      || identity.equation !== 'NET_KNOWN_EQUALS_SUM_KNOWN_INCLUDED_COMPONENTS'
      || !isValidUtcMillis(attribution.evaluatedAtMs)
      || attribution.evaluatedAtMs < window.startAtMs
      || attribution.evaluatedAtMs >= window.endAtMs
      || typeof attribution.valuationAsset !== 'string'
      || attribution.valuationAsset.length === 0) return null;
    let policyIssues: readonly string[];
    let attributionIssues: readonly string[];
    try {
      policyIssues = validateEconomicAccountingPolicy(
        report.policy as EconomicReport['policy'],
        attribution.evaluatedAtMs as number,
      );
      attributionIssues = validateEconomicAttribution(
        report.attribution as EconomicReport['attribution'],
      );
      const recomposed = composeEconomicReport({
        scope: report.scope as EconomicReport['scope'],
        valuationAsset: attribution.valuationAsset as string,
        components: attribution.components as EconomicReport['attribution']['components'],
        policy: report.policy as EconomicReport['policy'],
        evaluatedAtMs: attribution.evaluatedAtMs as number,
      });
      if (canonicalJson(recomposed) !== canonicalJson(report)) return null;
    } catch {
      return null;
    }
    if (policyIssues.length > 0 || attributionIssues.length > 0) return null;
    const policyRecord = report.policy as Record<string, unknown>;
    const authorityRecord = policyRecord.authority !== null && typeof policyRecord.authority === 'object'
      && !Array.isArray(policyRecord.authority)
      ? policyRecord.authority as Record<string, unknown>
      : null;
    if (authorityRecord === null || !label(authorityRecord.revision)) return null;
    let net: ExactDecimal;
    let proof: ExactDecimal;
    try {
      net = normalizeExactDecimal(attribution.netKnown);
      proof = normalizeExactDecimal(identity.knownComponentSum);
    } catch {
      return null;
    }
    if (net !== proof) return null;
    if (valuationAsset !== null && valuationAsset !== attribution.valuationAsset) return null;
    if (accountingPolicyRevision !== null && accountingPolicyRevision !== authorityRecord.revision) return null;
    valuationAsset = attribution.valuationAsset;
    accountingPolicyRevision = authorityRecord.revision;
    ids.push(scope.id);
    values.push(net);
  }
  if (new Set(ids).size !== ids.length) return null;
  const exactValues = values.map((value) => decimalFraction(value));
  if (exactValues.some((value) => value === null)) return null;
  const exactSum = (exactValues as Fraction[]).reduce<Fraction>(addFractions, fraction(0n, 1n));
  const mean = fraction(exactSum.numerator, exactSum.denominator * BigInt(values.length));
  return Object.freeze({
    sampleCount: reports.length,
    mean,
    sourceId: binding.sourceId,
    valuationAsset: valuationAsset as string,
    accountingPolicyRevision: accountingPolicyRevision as string,
    sampleIds: sortedUnique(ids),
    evidenceIds: sortedUnique([binding.sourceId, binding.revision, ...ids]),
  });
}

function crowdingSample(
  evidence: unknown,
  minimumSamples: number,
): CrowdingSample | null {
  const direct = exactRecord(evidence, DIRECT_CROWDING_KEYS);
  const binding = direct === null ? null : validBinding(direct.binding, 'ENGINE_DIRECT_CROWDING');
  if (direct === null || binding?.authority !== 'PRODUCTION'
    || binding.sourceId === null || binding.revision === null) return null;
  const ids = validIdArray(direct.observationIds);
  if (!nonNegativeSafeInteger(direct.eligibleOpportunityCount)
    || !nonNegativeSafeInteger(direct.competitorDisplacedOpportunityCount)
    || direct.eligibleOpportunityCount < minimumSamples
    || direct.competitorDisplacedOpportunityCount > direct.eligibleOpportunityCount
    || ids === null
    || ids.length !== direct.eligibleOpportunityCount) return null;
  return Object.freeze({
    sampleCount: direct.eligibleOpportunityCount,
    rate: fraction(BigInt(direct.competitorDisplacedOpportunityCount), BigInt(direct.eligibleOpportunityCount)),
    sourceId: binding.sourceId,
    sampleIds: sortedUnique(ids),
    evidenceIds: sortedUnique([binding.sourceId, binding.revision, ...ids]),
  });
}

function overlap(left: readonly string[], right: readonly string[]): boolean {
  const seen = new Set(left);
  return right.some((value) => seen.has(value));
}

function unknownAxis(
  axis: StrategyDecayAxisAssessment['axis'],
  reasonCodes: readonly string[],
  unit: StrategyDecayAxisAssessment['unit'],
  baselineSampleCount = 0,
  currentSampleCount = 0,
): StrategyDecayAxisAssessment {
  return Object.freeze({
    axis,
    state: 'UNKNOWN',
    baselineSampleCount,
    currentSampleCount,
    baselineValue: null,
    currentValue: null,
    unit,
    reasonCodes: sortedUnique(reasonCodes),
    evidenceIds: Object.freeze([]),
  });
}

function calibrationAxis(
  baseline: CalibrationSample | null,
  current: CalibrationSample | null,
  policy: StrategyDecayMeasurementPolicy,
): StrategyDecayAxisAssessment {
  if (baseline === null || current === null) {
    return unknownAxis('CALIBRATION_RELIABILITY', ['CALIBRATION_PRODUCTION_CORPUS_UNAVAILABLE'], 'RATIO', baseline?.sampleCount ?? 0, current?.sampleCount ?? 0);
  }
  if (baseline.sourceId !== current.sourceId || baseline.cohortKey !== current.cohortKey) {
    return unknownAxis('CALIBRATION_RELIABILITY', ['CALIBRATION_COHORT_OR_SOURCE_MISMATCH'], 'RATIO', baseline.sampleCount, current.sampleCount);
  }
  if (overlap(baseline.sampleIds, current.sampleIds)) {
    return unknownAxis('CALIBRATION_RELIABILITY', ['CALIBRATION_SAMPLE_OVERLAP'], 'RATIO', baseline.sampleCount, current.sampleCount);
  }
  const increase = subtractFractions(current.error, baseline.error);
  let state: StrategyDecayState = 'STABLE';
  let reason = 'CALIBRATION_RELIABILITY_STABLE';
  if (increase.numerator > 0n && atLeastPpm(increase, policy.calibrationGapIncreaseDeadPpm)) {
    state = 'DEAD';
    reason = 'CALIBRATION_RELIABILITY_DEAD';
  } else if (increase.numerator > 0n && atLeastPpm(increase, policy.calibrationGapIncreaseDegradedPpm)) {
    state = 'DEGRADED';
    reason = 'CALIBRATION_RELIABILITY_DEGRADED';
  }
  return Object.freeze({
    axis: 'CALIBRATION_RELIABILITY', state,
    baselineSampleCount: baseline.sampleCount, currentSampleCount: current.sampleCount,
    baselineValue: formatFraction(baseline.error), currentValue: formatFraction(current.error),
    unit: 'RATIO', reasonCodes: Object.freeze([reason]),
    evidenceIds: sortedUnique([...baseline.evidenceIds, ...current.evidenceIds]),
  });
}

function netValueAxis(
  baseline: EconomicSample | null,
  current: EconomicSample | null,
  policy: StrategyDecayMeasurementPolicy,
): StrategyDecayAxisAssessment {
  if (baseline === null || current === null) {
    return unknownAxis('CLOSED_OUTCOME_NET_VALUE', ['CAPITAL_CLOSED_OUTCOME_PRODUCTION_CORPUS_UNAVAILABLE'], 'QUOTE_ASSET', baseline?.sampleCount ?? 0, current?.sampleCount ?? 0);
  }
  if (baseline.sourceId !== current.sourceId
    || baseline.valuationAsset !== current.valuationAsset
    || baseline.accountingPolicyRevision !== current.accountingPolicyRevision) {
    return unknownAxis('CLOSED_OUTCOME_NET_VALUE', ['CLOSED_OUTCOME_CORPUS_OR_POLICY_MISMATCH'], 'QUOTE_ASSET', baseline.sampleCount, current.sampleCount);
  }
  if (overlap(baseline.sampleIds, current.sampleIds)) {
    return unknownAxis('CLOSED_OUTCOME_NET_VALUE', ['CLOSED_OUTCOME_SAMPLE_OVERLAP'], 'QUOTE_ASSET', baseline.sampleCount, current.sampleCount);
  }
  let state: StrategyDecayState = 'STABLE';
  let reason = 'CLOSED_OUTCOME_NET_VALUE_STABLE';
  const zero = fraction(0n, 1n);
  if (compareFractions(current.mean, zero) <= 0) {
    state = 'DEAD';
    reason = 'CLOSED_OUTCOME_NET_VALUE_NON_POSITIVE';
  } else if (compareFractions(baseline.mean, zero) > 0 && compareFractions(current.mean, baseline.mean) < 0) {
    const decline = fraction(
      (baseline.mean.numerator * current.mean.denominator - current.mean.numerator * baseline.mean.denominator)
        * baseline.mean.denominator,
      baseline.mean.denominator * current.mean.denominator * baseline.mean.numerator,
    );
    if (atLeastPpm(decline, policy.netValueDeclineDeadPpm)) {
      state = 'DEAD';
      reason = 'CLOSED_OUTCOME_NET_VALUE_DEAD';
    } else if (atLeastPpm(decline, policy.netValueDeclineDegradedPpm)) {
      state = 'DEGRADED';
      reason = 'CLOSED_OUTCOME_NET_VALUE_DEGRADED';
    }
  }
  return Object.freeze({
    axis: 'CLOSED_OUTCOME_NET_VALUE', state,
    baselineSampleCount: baseline.sampleCount, currentSampleCount: current.sampleCount,
    baselineValue: formatFraction(baseline.mean), currentValue: formatFraction(current.mean),
    unit: 'QUOTE_ASSET', reasonCodes: Object.freeze([reason]),
    evidenceIds: sortedUnique([...baseline.evidenceIds, ...current.evidenceIds]),
  });
}

function crowdingAxis(
  baseline: CrowdingSample | null,
  current: CrowdingSample | null,
  policy: StrategyDecayMeasurementPolicy,
): StrategyDecayAxisAssessment {
  if (baseline === null || current === null) {
    return unknownAxis('DIRECT_COMPETITOR_DISPLACEMENT', ['DIRECT_CROWDING_PRODUCTION_EVIDENCE_UNAVAILABLE'], 'RATIO', baseline?.sampleCount ?? 0, current?.sampleCount ?? 0);
  }
  if (baseline.sourceId !== current.sourceId) {
    return unknownAxis('DIRECT_COMPETITOR_DISPLACEMENT', ['DIRECT_CROWDING_SOURCE_MISMATCH'], 'RATIO', baseline.sampleCount, current.sampleCount);
  }
  if (overlap(baseline.sampleIds, current.sampleIds)) {
    return unknownAxis('DIRECT_COMPETITOR_DISPLACEMENT', ['DIRECT_CROWDING_SAMPLE_OVERLAP'], 'RATIO', baseline.sampleCount, current.sampleCount);
  }
  let state: StrategyDecayState = 'STABLE';
  let reason = 'DIRECT_CROWDING_STABLE';
  if (atLeastPpm(current.rate, policy.competitorDisplacementDeadPpm)) {
    state = 'DEAD';
    reason = 'DIRECT_CROWDING_DEAD';
  } else if (atLeastPpm(current.rate, policy.competitorDisplacementDegradedPpm)) {
    state = 'DEGRADED';
    reason = 'DIRECT_CROWDING_DEGRADED';
  }
  return Object.freeze({
    axis: 'DIRECT_COMPETITOR_DISPLACEMENT', state,
    baselineSampleCount: baseline.sampleCount, currentSampleCount: current.sampleCount,
    baselineValue: formatFraction(baseline.rate), currentValue: formatFraction(current.rate),
    unit: 'RATIO',
    reasonCodes: sortedUnique([
      reason,
      ...(compareFractions(current.rate, baseline.rate) > 0 ? ['DIRECT_CROWDING_INCREASED'] : []),
    ]),
    evidenceIds: sortedUnique([...baseline.evidenceIds, ...current.evidenceIds]),
  });
}

function evidenceAuthority(baseline: Record<string, unknown>, current: Record<string, unknown>): StrategyDecayEvidenceAuthority {
  const bindings = [
    exactRecord(baseline.calibration, CALIBRATION_EVIDENCE_KEYS)?.binding,
    exactRecord(baseline.closedOutcomes, CLOSED_OUTCOME_KEYS)?.binding,
    exactRecord(baseline.directCrowding, DIRECT_CROWDING_KEYS)?.binding,
    exactRecord(current.calibration, CALIBRATION_EVIDENCE_KEYS)?.binding,
    exactRecord(current.closedOutcomes, CLOSED_OUTCOME_KEYS)?.binding,
    exactRecord(current.directCrowding, DIRECT_CROWDING_KEYS)?.binding,
  ];
  const owners: StrategyDecayEvidenceOwner[] = [
    'FOUNDATION_CALIBRATION', 'CAPITAL_CLOSED_OUTCOME', 'ENGINE_DIRECT_CROWDING',
    'FOUNDATION_CALIBRATION', 'CAPITAL_CLOSED_OUTCOME', 'ENGINE_DIRECT_CROWDING',
  ];
  const validated = bindings.map((binding, index) => validBinding(binding, owners[index]));
  if (validated.some((binding) => binding === null)) return 'UNKNOWN';
  const authorities = new Set(validated.map((binding) => binding?.authority));
  return authorities.size === 1
    ? validated[0]?.authority ?? 'UNKNOWN'
    : 'UNKNOWN';
}

function derivedState(axes: readonly StrategyDecayAxisAssessment[]): StrategyDecayState {
  if (axes.some((axis) => axis.state === 'UNKNOWN')) return 'UNKNOWN';
  if (axes.some((axis) => axis.state === 'DEAD')) return 'DEAD';
  if (axes.some((axis) => axis.state === 'DEGRADED')) return 'DEGRADED';
  return 'STABLE';
}

function validWindow(value: unknown, policy: StrategyDecayMeasurementPolicy, evaluatedAtMs: number): value is StrategyDecayWindow {
  const window = exactRecord(value, WINDOW_KEYS);
  return window !== null
    && isValidUtcMillis(window.startAtMs)
    && isValidUtcMillis(window.endAtMs)
    && window.endAtMs > window.startAtMs
    && window.endAtMs - window.startAtMs === policy.windowDurationMs
    && window.endAtMs <= evaluatedAtMs;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

export function measureStrategyDecay(rawInput: MeasureStrategyDecayInput): MeasureStrategyDecayResult {
  const snapshot = safeSnapshot(rawInput);
  const input = exactRecord(snapshot, INPUT_KEYS);
  if (input === null) return Object.freeze({ ok: false, reasonCodes: Object.freeze(['MEASUREMENT_INPUT_UNSAFE_OR_INVALID']) });
  const policyIssues = validateStrategyDecayMeasurementPolicy(input.policy);
  if (policyIssues.length > 0) return Object.freeze({ ok: false, reasonCodes: policyIssues });
  const policy = input.policy as unknown as StrategyDecayMeasurementPolicy;
  if (!(STRATEGY_DECAY_SOURCES as readonly unknown[]).includes(input.strategy)
    || !label(input.configVersion)
    || !label(input.direction)
    || !isValidUtcMillis(input.evaluatedAtMs)) {
    return Object.freeze({ ok: false, reasonCodes: Object.freeze(['MEASUREMENT_IDENTITY_OR_TIME_INVALID']) });
  }
  const baseline = exactRecord(input.baseline, EVIDENCE_WINDOW_KEYS);
  const current = exactRecord(input.current, EVIDENCE_WINDOW_KEYS);
  if (baseline === null || current === null
    || !validWindow(baseline.window, policy, input.evaluatedAtMs as number)
    || !validWindow(current.window, policy, input.evaluatedAtMs as number)) {
    return Object.freeze({ ok: false, reasonCodes: Object.freeze(['MEASUREMENT_WINDOW_INVALID']) });
  }
  const baselineWindow = baseline.window as unknown as StrategyDecayWindow;
  const currentWindow = current.window as unknown as StrategyDecayWindow;
  if (baselineWindow.endAtMs > currentWindow.startAtMs
    || currentWindow.startAtMs - baselineWindow.endAtMs < policy.minimumWindowGapMs) {
    return Object.freeze({ ok: false, reasonCodes: Object.freeze(['MEASUREMENT_WINDOWS_OVERLAP_OR_GAP_INSUFFICIENT']) });
  }

  const typedInput = {
    policy,
    strategy: input.strategy,
    configVersion: input.configVersion,
    direction: input.direction,
    evaluatedAtMs: input.evaluatedAtMs,
  } as unknown as MeasureStrategyDecayInput;
  const baselineCalibration = calibrationSample(baseline.calibration, baselineWindow, typedInput);
  const currentCalibration = calibrationSample(current.calibration, currentWindow, typedInput);
  const baselineEconomics = economicSample(baseline.closedOutcomes, baselineWindow, typedInput);
  const currentEconomics = economicSample(current.closedOutcomes, currentWindow, typedInput);
  const baselineCrowding = crowdingSample(baseline.directCrowding, policy.minimumDirectCrowdingSamples);
  const currentCrowding = crowdingSample(current.directCrowding, policy.minimumDirectCrowdingSamples);
  const axes = Object.freeze([
    calibrationAxis(baselineCalibration, currentCalibration, policy),
    netValueAxis(baselineEconomics, currentEconomics, policy),
    crowdingAxis(baselineCrowding, currentCrowding, policy),
  ]);
  const authority = evidenceAuthority(baseline, current);
  let state = derivedState(axes);
  if (authority !== 'PRODUCTION') state = 'UNKNOWN';
  const reasonCodes = sortedUnique([
    'CHRONOLOGICAL_NON_OVERLAP_PROVEN',
    ...axes.flatMap((axis) => axis.reasonCodes),
    ...(authority === 'PRODUCTION' ? [] : ['PRODUCTION_EVIDENCE_AUTHORITY_INCOMPLETE']),
  ]);
  const material: Omit<StrategyDecayMeasurement, 'measurementId'> = {
    schema: STRATEGY_DECAY_MEASUREMENT_SCHEMA,
    schemaVersion: STRATEGY_DECAY_MEASUREMENT_SCHEMA_VERSION,
    strategy: input.strategy as StrategyDecaySource,
    configVersion: input.configVersion as string,
    measurementPolicyRevision: policy.policyRevision,
    direction: input.direction as string,
    evaluatedAtMs: input.evaluatedAtMs as number,
    evidenceAuthority: authority,
    baselineWindow: Object.freeze({ ...baselineWindow }),
    currentWindow: Object.freeze({ ...currentWindow }),
    axes,
    state,
    reasonCodes,
  };
  const measurement = deepFreeze({
    ...material,
    measurementId: deriveStrategyDecayMeasurementId(material),
  } as StrategyDecayMeasurement);
  const issues = validateStrategyDecayMeasurement(measurement);
  if (issues.length > 0) return Object.freeze({ ok: false, reasonCodes: issues });
  return Object.freeze({ ok: true, measurement });
}

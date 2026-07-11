import { stableId, type ValidationResult } from '../contracts/index.js';
import type {
  AttributedOutcomeLabel,
  DispositionOutcomeCounts,
  ExecutionFeasibilitySummary,
  IntelligenceOutcomeState,
  NumericOutcomeMetricMeans,
  OutcomeCohort,
} from './types.js';
import { compareText, derivedTruth, failure, immutableContract, roundMetric } from './internal.js';
import { validateOutcomeState } from './reducer.js';

const NUMERIC_METRICS: readonly (keyof NumericOutcomeMetricMeans)[] = [
  'forwardReturnPct',
  'maximumFavorableExcursionPct',
  'maximumAdverseExcursionPct',
  'fadeFromPeakPct',
  'timeToPeakMs',
  'liquiditySurvivalRatio',
  'depthSurvivalRatio',
];

function emptyCounts(): DispositionOutcomeCounts {
  return { total: 0, moved: 0, didNotMove: 0, unknown: 0 };
}

function addDisposition(counts: DispositionOutcomeCounts, moved: boolean | null): void {
  counts.total += 1;
  if (moved === true) counts.moved += 1;
  else if (moved === false) counts.didNotMove += 1;
  else counts.unknown += 1;
}

function numericMeans(labels: readonly AttributedOutcomeLabel[]): NumericOutcomeMetricMeans {
  const output: Partial<NumericOutcomeMetricMeans> = {};
  for (const metric of NUMERIC_METRICS) {
    const values = labels.map((label) => label.metrics[metric]).filter((value): value is number => typeof value === 'number');
    output[metric] = values.length === 0 ? null : roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length);
  }
  return output as NumericOutcomeMetricMeans;
}

function executionSummary(labels: readonly AttributedOutcomeLabel[]): ExecutionFeasibilitySummary {
  const feasible = labels.filter((label) => label.metrics.theoreticalExecutionFeasible === true).length;
  const infeasible = labels.filter((label) => label.metrics.theoreticalExecutionFeasible === false).length;
  const evaluated = feasible + infeasible;
  return {
    evaluated,
    feasible,
    infeasible,
    unknown: labels.length - evaluated,
    feasibleRate: evaluated === 0 ? null : roundMetric(feasible / evaluated),
  };
}

export function summarizeOutcomeCohorts(state: IntelligenceOutcomeState): ValidationResult<readonly OutcomeCohort[]> {
  const validatedState = validateOutcomeState(state);
  if (!validatedState.ok) return validatedState as ValidationResult<readonly OutcomeCohort[]>;
  const canonicalState = validatedState.value;
  const records = new Map(canonicalState.frozenRecords.map((record) => [record.id, record]));
  const groups = new Map<string, AttributedOutcomeLabel[]>();
  for (const label of canonicalState.labels) {
    const key = stableId('outcome_cohort_key', {
      configurationVersion: label.configurationVersion,
      featureVersion: label.featureVersion,
      horizonMs: label.horizonMs,
      direction: label.policy.direction,
      priceBasis: label.policy.priceBasis,
      policyId: label.policy.id,
    });
    groups.set(key, [...(groups.get(key) ?? []), label]);
  }

  const output: OutcomeCohort[] = [];
  for (const key of [...groups.keys()].sort(compareText)) {
    const labels = [...(groups.get(key) ?? [])].sort((left, right) => compareText(left.id, right.id));
    if (labels.length === 0) continue;
    const representative = labels[0];
    const accepted = emptyCounts();
    const rejected = emptyCounts();
    const observed = emptyCounts();
    for (const label of labels) {
      const disposition = records.get(label.frozenRecordId)?.candidateDisposition;
      if (disposition === 'ACCEPTED') addDisposition(accepted, label.laterMoved);
      else if (disposition === 'REJECTED') addDisposition(rejected, label.laterMoved);
      else if (disposition === 'OBSERVED') addDisposition(observed, label.laterMoved);
      else return failure('MISSING_SOURCE', 'outcomes.cohorts', 'cohort label has no frozen disposition', 'frozenRecordId', [label.frozenRecordId]);
    }

    const upstreamTruth = labels.map((label) => label.truth);
    let receivedTimeMs = 0;
    let sourceEventTimeMs: number | null = null;
    for (const truth of upstreamTruth) {
      receivedTimeMs = Math.max(receivedTimeMs, truth.temporal.receivedTimeMs);
      const eventTimeMs = truth.temporal.sourceEventTimeMs;
      if (eventTimeMs !== null) sourceEventTimeMs = sourceEventTimeMs === null ? eventTimeMs : Math.max(sourceEventTimeMs, eventTimeMs);
    }
    const incompleteLabels = labels.filter((label) => label.state === 'INCOMPLETE');
    const degradedTruth = upstreamTruth.filter((truth) => truth.completeness.state !== 'COMPLETE' || truth.freshness.state !== 'FRESH');
    const cohortMissingFields = [
      ...incompleteLabels.map((label) => `outcome:${label.id}`),
      ...degradedTruth.flatMap((truth) => [
        ...truth.completeness.missingFields.map((field) => `upstream:${truth.authority.sourceId}:${field}`),
        ...(truth.freshness.state === 'FRESH' ? [] : [`freshness:${truth.authority.sourceId}`]),
      ]),
    ];
    output.push({
      id: key,
      configurationVersion: representative.configurationVersion,
      featureVersion: representative.featureVersion,
      policyId: representative.policy.id,
      horizonMs: representative.horizonMs,
      direction: representative.policy.direction,
      priceBasis: representative.policy.priceBasis,
      total: labels.length,
      complete: labels.filter((label) => label.state === 'COMPLETE').length,
      incomplete: incompleteLabels.length,
      accepted,
      rejected,
      observed,
      metricMeans: numericMeans(labels),
      executionFeasibility: executionSummary(labels),
      truth: derivedTruth({
        dataset: 'outcome-cohort',
        producerVersion: 'outcomes-cohorts-2',
        configurationVersion: representative.configurationVersion,
        featureVersion: representative.featureVersion,
        receivedTimeMs,
        sourceEventTimeMs,
        maxAgeMs: sourceEventTimeMs === null ? null : Math.max(0, receivedTimeMs - sourceEventTimeMs),
        upstreamTruth,
        sourceRecordIds: labels.map((label) => label.id),
        transform: 'outcomes.cohort.v2',
        completenessState: cohortMissingFields.length === 0 ? 'COMPLETE' : 'PARTIAL',
        observedFields: ['labels', 'metrics', 'dispositions', 'policy'],
        missingFields: cohortMissingFields,
        reasonCodes: [
          ...(incompleteLabels.length === 0 ? [] : ['INCOMPLETE_OUTCOME_RETAINED']),
          ...degradedTruth.flatMap((truth) => [
            ...truth.completeness.reasonCodes,
            ...(truth.freshness.state === 'FRESH' ? [] : [`UPSTREAM_FRESHNESS_${truth.freshness.state}`]),
          ]),
        ],
      }),
    });
  }
  output.sort((left, right) =>
    compareText(left.configurationVersion, right.configurationVersion)
    || compareText(left.featureVersion, right.featureVersion)
    || left.horizonMs - right.horizonMs
    || compareText(left.direction, right.direction)
    || compareText(left.priceBasis, right.priceBasis)
    || compareText(left.policyId, right.policyId)
    || compareText(left.id, right.id));
  return { ok: true, value: immutableContract(output) };
}

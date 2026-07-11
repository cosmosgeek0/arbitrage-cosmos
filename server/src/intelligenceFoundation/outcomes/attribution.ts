import {
  stableId,
  validateFrozenPreEventRecord,
  validateNoSecretFields,
  validateNormalizedEvidence,
  type NormalizedBookTicker,
  type NormalizedDepth,
  type NormalizedEvidence,
  type OutcomeMetrics,
  type TruthMetadata,
  type ValidationResult,
} from '../contracts/index.js';
import type {
  AttributeOutcomeInput,
  AttributedOutcomeLabel,
  AttributionResult,
  OutcomeMetricField,
  OutcomePolicySnapshot,
  OutcomePriceBasis,
} from './types.js';
import {
  compareText,
  derivedTruth,
  failure,
  immutableContract,
  isNonNegativeSafeInteger,
  reAgeTruth,
  roundMetric,
} from './internal.js';
import { normalizeOutcomePolicy, OUTCOME_METRIC_FIELDS } from './policy.js';

interface TimedEvidence {
  evidence: NormalizedEvidence;
  eventTimeMs: number;
}

interface PricePoint extends TimedEvidence {
  price: number;
}

function priceFrom(evidence: NormalizedEvidence, basis: OutcomePriceBasis): number | null {
  if (basis === 'TRADE') return evidence.kind === 'TRADE' ? evidence.price : null;
  if (basis === 'BOOK_MID') return evidence.kind === 'BOOK_TICKER' ? (evidence.bidPrice + evidence.askPrice) / 2 : null;
  if (basis === 'MARK') return evidence.kind === 'MARK_PRICE' ? evidence.markPrice : null;
  return evidence.kind === 'MARK_PRICE' ? evidence.indexPrice : null;
}

function findEvidence(evidence: readonly NormalizedEvidence[], id: string): NormalizedEvidence | null {
  return evidence.find((item) => item.id === id) ?? null;
}

function reAgeFrozenEvidence(
  evidence: readonly NormalizedEvidence[],
  cutoffTimeMs: number,
): ValidationResult<NormalizedEvidence[]> {
  const output: NormalizedEvidence[] = [];
  for (const item of evidence) {
    const truth = reAgeTruth(item.truth, cutoffTimeMs);
    if (!truth.ok) return truth as ValidationResult<NormalizedEvidence[]>;
    const validated = validateNormalizedEvidence({ ...item, truth: truth.value });
    if (!validated.ok) return validated as ValidationResult<NormalizedEvidence[]>;
    output.push(validated.value);
  }
  output.sort((left, right) => compareText(left.id, right.id));
  return { ok: true, value: output };
}

function isFreshComplete(evidence: NormalizedEvidence | null): evidence is NormalizedEvidence {
  return evidence !== null && evidence.truth.freshness.state === 'FRESH' && evidence.truth.completeness.state === 'COMPLETE';
}

function availableLaterEvidence(input: AttributeOutcomeInput, dueAtMs: number): ValidationResult<TimedEvidence[]> {
  if (input.laterEvidence.length > 50_000) {
    return failure('INVALID_VALUE', 'outcomes.attribution', 'later evidence exceeds the bounded attribution limit', 'laterEvidence');
  }
  const seen = new Set<string>();
  const output: TimedEvidence[] = [];
  for (let index = 0; index < input.laterEvidence.length; index += 1) {
    const validated = validateNormalizedEvidence(input.laterEvidence[index]);
    if (!validated.ok) return { ok: false, failure: validated.failure };
    const evidence = validated.value;
    if (seen.has(evidence.id)) return failure('INVALID_VALUE', 'outcomes.attribution', 'duplicate later evidence ID', `laterEvidence[${index}].id`, [evidence.id]);
    seen.add(evidence.id);
    if (evidence.instrument.instrumentId !== input.frozen.thesis.instrumentId) {
      return failure('INVALID_VALUE', 'outcomes.attribution', 'cross-instrument later evidence is not allowed', `laterEvidence[${index}].instrument`, [evidence.id]);
    }
    const truth = evidence.truth;
    if (truth.temporal.receivedTimeMs > input.evaluatedAtMs) continue;
    if (truth.freshness.evaluatedAtMs > input.evaluatedAtMs || (truth.temporal.sourceTransactionTimeMs !== null && truth.temporal.sourceTransactionTimeMs > input.evaluatedAtMs)) {
      return failure('NO_LOOK_AHEAD_VIOLATION', 'outcomes.attribution', 'available evidence contains an epistemic timestamp after attribution', `laterEvidence[${index}].truth`, [evidence.id]);
    }
    const eventTimeMs = truth.temporal.sourceEventTimeMs;
    if (eventTimeMs === null || eventTimeMs <= input.frozen.triggerTimeMs || eventTimeMs > dueAtMs) continue;
    const truthAtEvaluation = reAgeTruth(evidence.truth, input.evaluatedAtMs);
    if (!truthAtEvaluation.ok) return truthAtEvaluation as ValidationResult<TimedEvidence[]>;
    const revalidated = validateNormalizedEvidence({ ...evidence, truth: truthAtEvaluation.value });
    if (!revalidated.ok) return revalidated as ValidationResult<TimedEvidence[]>;
    output.push({ evidence: revalidated.value, eventTimeMs });
  }
  output.sort((left, right) => left.eventTimeMs - right.eventTimeMs || compareText(left.evidence.id, right.evidence.id));
  return { ok: true, value: output };
}

function quoteLiquidity(evidence: NormalizedBookTicker): number {
  return evidence.bidPrice * evidence.bidQuantity + evidence.askPrice * evidence.askQuantity;
}

function totalDepth(evidence: NormalizedDepth): number {
  return [...evidence.bids, ...evidence.asks].reduce((sum, level) => sum + level.price * level.baseQuantity, 0);
}

function terminalOfKind<T extends NormalizedEvidence['kind']>(
  timed: readonly TimedEvidence[],
  kind: T,
  dueAtMs: number,
  maxAgeMs: number,
): Extract<NormalizedEvidence, { kind: T }> | null {
  for (let index = timed.length - 1; index >= 0; index -= 1) {
    const entry = timed[index];
    if (entry.evidence.kind === kind && dueAtMs - entry.eventTimeMs <= maxAgeMs) {
      return entry.evidence as Extract<NormalizedEvidence, { kind: T }>;
    }
  }
  return null;
}

function executionFeasible(depth: NormalizedEvidence | null, policy: NonNullable<OutcomePolicySnapshot['execution']>): boolean | null {
  if (!depth || depth.kind !== 'DEPTH_SNAPSHOT') return null;
  if (depth.truth.freshness.state !== 'FRESH' || depth.truth.completeness.state !== 'COMPLETE') return null;
  const levels = policy.side === 'BUY' ? depth.asks : depth.bids;
  if (levels.length === 0) return false;
  const top = levels[0].price;
  let remaining = policy.intendedBaseQuantity;
  let cost = 0;
  let filled = 0;
  for (const level of levels) {
    const quantity = Math.min(remaining, level.baseQuantity);
    cost += quantity * level.price;
    filled += quantity;
    remaining -= quantity;
    if (remaining <= Number.EPSILON) break;
  }
  if (remaining > Number.EPSILON || filled <= 0) return false;
  const average = cost / filled;
  const slippagePct = policy.side === 'BUY'
    ? (average - top) / top * 100
    : (top - average) / top * 100;
  return slippagePct <= policy.maximumSlippagePct;
}

function metricMissing(metrics: OutcomeMetrics, laterMoved: boolean | null, field: OutcomeMetricField): boolean {
  return field === 'laterMoved' ? laterMoved === null : metrics[field] === null;
}

export function attributeOutcome(input: AttributeOutcomeInput): AttributionResult {
  const secret = validateNoSecretFields(input, 'outcomes.attribution');
  if (!secret.ok) return secret as AttributionResult;
  const frozenValidation = validateFrozenPreEventRecord(input.frozen);
  if (!frozenValidation.ok) return frozenValidation as AttributionResult;
  const frozen = frozenValidation.value;
  if (!isNonNegativeSafeInteger(input.evaluatedAtMs)) {
    return failure('INVALID_VALUE', 'outcomes.attribution', 'evaluation time must be a non-negative safe integer', 'evaluatedAtMs');
  }
  const policyResult = normalizeOutcomePolicy(input.policy);
  if (!policyResult.ok) return policyResult as AttributionResult;
  const policy = policyResult.value;
  const frozenEvidenceResult = reAgeFrozenEvidence(frozen.evidence, frozen.evidenceCutoffTimeMs);
  if (!frozenEvidenceResult.ok) return frozenEvidenceResult as AttributionResult;
  const frozenEvidence = frozenEvidenceResult.value;
  if (policy.horizonMs > Number.MAX_SAFE_INTEGER - frozen.triggerTimeMs) {
    return failure('INVALID_VALUE', 'outcomes.attribution', 'horizon exceeds safe time range', 'policy.horizonMs');
  }
  const dueAtMs = frozen.triggerTimeMs + policy.horizonMs;
  if (input.evaluatedAtMs < dueAtMs) {
    return failure('HORIZON_NOT_REACHED', 'outcomes.attribution', 'configured outcome horizon has not been reached', 'evaluatedAtMs', [frozen.id]);
  }
  const availableResult = availableLaterEvidence({ ...input, frozen }, dueAtMs);
  if (!availableResult.ok) return availableResult as AttributionResult;
  const available = availableResult.value;

  const referenceEvidence = findEvidence(frozenEvidence, policy.referenceEvidenceId);
  const referencePrice = isFreshComplete(referenceEvidence) ? priceFrom(referenceEvidence, policy.priceBasis) : null;
  const points: PricePoint[] = [];
  for (const entry of available) {
    const price = priceFrom(entry.evidence, policy.priceBasis);
    if (price !== null && Number.isFinite(price) && price > 0) points.push({ ...entry, price });
  }
  const terminalPoint = points.length > 0 && dueAtMs - points[points.length - 1].eventTimeMs <= policy.terminalMaxAgeMs
    ? points[points.length - 1]
    : null;
  const direction = policy.direction === 'UP' ? 1 : -1;
  let maximumFavorable: number | null = null;
  let maximumAdverse: number | null = null;
  let timeToPeakMs: number | null = null;
  let laterMoved: boolean | null = null;
  if (referencePrice !== null && referencePrice > 0 && points.length > 0) {
    let best = 0;
    let worst = 0;
    let peakTime = frozen.triggerTimeMs;
    let maximumAbsolute = 0;
    for (const point of points) {
      const raw = (point.price / referencePrice - 1) * 100;
      const directional = direction * raw;
      if (directional > best) {
        best = directional;
        peakTime = point.eventTimeMs;
      }
      if (directional < worst) worst = directional;
      maximumAbsolute = Math.max(maximumAbsolute, Math.abs(raw));
    }
    maximumFavorable = roundMetric(Math.max(0, best));
    maximumAdverse = roundMetric(Math.max(0, -worst));
    timeToPeakMs = peakTime - frozen.triggerTimeMs;
    laterMoved = maximumAbsolute >= policy.movedThresholdPct;
  }
  const forwardReturn = referencePrice !== null && terminalPoint
    ? roundMetric(direction * (terminalPoint.price / referencePrice - 1) * 100)
    : null;
  let fadeFromPeak: number | null = null;
  if (referencePrice !== null && terminalPoint && points.length > 0) {
    if (policy.direction === 'UP') {
      let peak = referencePrice;
      for (const point of points) peak = Math.max(peak, point.price);
      fadeFromPeak = roundMetric(Math.max(0, (peak - terminalPoint.price) / peak * 100));
    } else {
      let trough = referencePrice;
      for (const point of points) trough = Math.min(trough, point.price);
      fadeFromPeak = roundMetric(Math.max(0, (terminalPoint.price - trough) / trough * 100));
    }
  }

  let liquiditySurvivalRatio: number | null = null;
  if (policy.liquidity) {
    const reference = findEvidence(frozenEvidence, policy.liquidity.referenceEvidenceId);
    const terminal = terminalOfKind(available, 'BOOK_TICKER', dueAtMs, policy.terminalMaxAgeMs);
    if (
      isFreshComplete(reference) && reference.kind === 'BOOK_TICKER' && terminal &&
      terminal.truth.completeness.state === 'COMPLETE'
    ) {
      const baseline = quoteLiquidity(reference);
      if (baseline > 0) liquiditySurvivalRatio = roundMetric(quoteLiquidity(terminal) / baseline);
    }
  }
  let depthSurvivalRatio: number | null = null;
  if (policy.depth) {
    const reference = findEvidence(frozenEvidence, policy.depth.referenceEvidenceId);
    const inWindow = available.filter((entry) => entry.evidence.kind === 'DEPTH_SNAPSHOT') as Array<TimedEvidence & { evidence: NormalizedDepth }>;
    if (
      isFreshComplete(reference) && reference.kind === 'DEPTH_SNAPSHOT' && inWindow.length > 0 &&
      inWindow.every((entry) =>
        entry.evidence.truth.completeness.state === 'COMPLETE' &&
        entry.evidence.bookScope === reference.bookScope &&
        entry.evidence.maximumLevelsKnown === reference.maximumLevelsKnown)
    ) {
      const baseline = totalDepth(reference);
      if (baseline > 0) depthSurvivalRatio = roundMetric(Math.min(...inWindow.map((entry) => totalDepth(entry.evidence))) / baseline);
    }
  }
  const theoreticalExecutionFeasible = policy.execution
    ? executionFeasible(findEvidence(frozenEvidence, policy.execution.depthEvidenceId), policy.execution)
    : null;
  const metrics: OutcomeMetrics = {
    forwardReturnPct: forwardReturn,
    maximumFavorableExcursionPct: maximumFavorable,
    maximumAdverseExcursionPct: maximumAdverse,
    fadeFromPeakPct: fadeFromPeak,
    timeToPeakMs,
    liquiditySurvivalRatio,
    depthSurvivalRatio,
    theoreticalExecutionFeasible,
  };
  const missingFields = OUTCOME_METRIC_FIELDS.filter((field) => metricMissing(metrics, laterMoved, field));
  const requiredMissing = policy.requiredMetricFields.filter((field) => metricMissing(metrics, laterMoved, field));
  const state = requiredMissing.length === 0 ? 'COMPLETE' as const : 'INCOMPLETE' as const;
  const usedEvidence = available.map((entry) => entry.evidence);
  const frozenReferenceIds = new Set<string>([
    policy.referenceEvidenceId,
    ...(policy.liquidity ? [policy.liquidity.referenceEvidenceId] : []),
    ...(policy.depth ? [policy.depth.referenceEvidenceId] : []),
    ...(policy.execution ? [policy.execution.depthEvidenceId] : []),
  ]);
  const usedFrozenEvidence = frozenEvidence.filter((evidence) => frozenReferenceIds.has(evidence.id));
  let sourceEventTimeMs: number | null = null;
  for (const evidence of usedEvidence) {
    const eventTimeMs = evidence.truth.temporal.sourceEventTimeMs;
    if (eventTimeMs !== null) sourceEventTimeMs = sourceEventTimeMs === null ? eventTimeMs : Math.max(sourceEventTimeMs, eventTimeMs);
  }
  const upstreamTruth: TruthMetadata[] = [frozen.truth, ...usedFrozenEvidence.map((evidence) => evidence.truth), ...usedEvidence.map((evidence) => evidence.truth)];
  const degradedTruth = upstreamTruth.filter((truth) => truth.completeness.state !== 'COMPLETE' || truth.freshness.state !== 'FRESH');
  const truthMissingFields = [
    ...missingFields,
    ...degradedTruth.flatMap((truth) => [
      ...truth.completeness.missingFields.map((field) => `upstream:${truth.authority.sourceId}:${field}`),
      ...(truth.freshness.state === 'FRESH' ? [] : [`freshness:${truth.authority.sourceId}`]),
    ]),
  ];
  const truthReasonCodes = [
    ...(requiredMissing.length === 0 ? [] : ['INCOMPLETE_OUTCOME']),
    ...degradedTruth.flatMap((truth) => [
      ...truth.completeness.reasonCodes,
      ...(truth.freshness.state === 'FRESH' ? [] : [`UPSTREAM_FRESHNESS_${truth.freshness.state}`]),
    ]),
  ];
  const truth = derivedTruth({
    dataset: 'outcome-label',
    producerVersion: 'outcomes-attribution-1',
    configurationVersion: frozen.configurationVersion,
    featureVersion: frozen.featureVersion,
    receivedTimeMs: input.evaluatedAtMs,
    sourceEventTimeMs,
    maxAgeMs: policy.terminalMaxAgeMs,
    upstreamTruth,
    sourceRecordIds: [frozen.id, ...usedFrozenEvidence.map((evidence) => evidence.id), ...usedEvidence.map((evidence) => evidence.id)],
    transform: 'outcomes.attribute.v1',
    completenessState: truthMissingFields.length === 0 ? 'COMPLETE' : 'PARTIAL',
    observedFields: OUTCOME_METRIC_FIELDS.filter((field) => !missingFields.includes(field)),
    missingFields: truthMissingFields,
    reasonCodes: truthReasonCodes,
  });
  const label: AttributedOutcomeLabel = {
    id: stableId('outcome_label', {
      frozenRecordId: frozen.id,
      configurationVersion: frozen.configurationVersion,
      featureVersion: frozen.featureVersion,
      policyId: policy.id,
    }),
    frozenRecordId: frozen.id,
    horizonMs: policy.horizonMs,
    observationTimeMs: dueAtMs,
    state,
    laterMoved,
    metrics,
    missingFields,
    configurationVersion: frozen.configurationVersion,
    featureVersion: frozen.featureVersion,
    policy,
    truth,
  };
  return { ok: true, value: immutableContract(label) };
}

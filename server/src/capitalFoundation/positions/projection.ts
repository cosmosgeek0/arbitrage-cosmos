import {
  addExactDecimals,
  assessCapitalTruth,
  compareExactDecimals,
  deriveActivePositionId,
  deriveExecutionCorrelationReferenceId,
  deriveReconciliationReferenceId,
  divideExactDecimals,
  negateExactDecimal,
  normalizeNonNegativeExactDecimal,
  weakestCapitalTruth,
  type ActivePosition,
  type CapitalLifecycleState,
  type CapitalTruthState,
  type ExactDecimal,
  type ExternalExecutionReference,
  type ExternalReconciliationReference,
  type NonNegativeDecimal,
  type PositionLeg,
  type PositionThesis,
  type PositionState,
  type TruthMetadata,
} from '../contracts/index.js';
import type {
  ActivePositionProjection,
  ActivePositionProjectionInput,
  PositionExposureSummary,
  PositionProjectionIssue,
} from './types.js';

const ZERO = '0' as NonNegativeDecimal;
const UNCERTAIN_RECONCILIATION = new Set(['PENDING', 'PARTIAL', 'STALE', 'UNAVAILABLE']);
const DIVERGED_RECONCILIATION = new Set(['AMBIGUOUS', 'DIVERGED']);

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function refreshTruth(truth: Readonly<TruthMetadata>, nowMs: number): Readonly<TruthMetadata> {
  const assessed = assessCapitalTruth({
    source: truth.source,
    evaluatedAtMs: nowMs,
    requiredValuePresent: truth.completeness !== 'UNKNOWN',
    divergent: truth.completeness === 'DIVERGENT',
    reasons: truth.reasons,
    evidenceReferences: truth.evidenceReferences,
    revision: truth.revision,
  });
  return Object.freeze({ ...assessed, completeness: weakestCapitalTruth([truth.completeness, assessed.completeness]) });
}

function normalizeLeg(input: ActivePositionProjectionInput['legs'][number], projectedAtMs: number): Readonly<PositionLeg> {
  if (input.id.trim().length === 0 || input.instrumentId.trim().length === 0 || input.symbol.trim().length === 0 || input.valuationAsset.trim().length === 0) {
    throw new TypeError('position leg identities must be non-empty');
  }
  return Object.freeze({
    ...input,
    quantity: normalizeNonNegativeExactDecimal(input.quantity),
    quoteExposure: normalizeNonNegativeExactDecimal(input.quoteExposure),
    truth: refreshTruth(input.truth, projectedAtMs),
  });
}

function freezeThesis(thesis: Readonly<PositionThesis>): Readonly<PositionThesis> {
  return Object.freeze({
    ...thesis,
    originalEvidenceIds: Object.freeze([...thesis.originalEvidenceIds]),
    targetConditions: Object.freeze([...thesis.targetConditions]),
    invalidationConditions: Object.freeze([...thesis.invalidationConditions]),
    stopAddingConditions: Object.freeze([...thesis.stopAddingConditions]),
  });
}

export function summarizePositionExposure(legs: readonly Readonly<PositionLeg>[]): Readonly<PositionExposureSummary> {
  let longExposure = ZERO;
  let shortExposure = ZERO;
  for (const leg of legs) {
    const amount = normalizeNonNegativeExactDecimal(leg.quoteExposure);
    if (leg.side === 'LONG') longExposure = addExactDecimals(longExposure, amount) as NonNegativeDecimal;
    else shortExposure = addExactDecimals(shortExposure, amount) as NonNegativeDecimal;
  }
  const grossExposure = addExactDecimals(longExposure, shortExposure) as NonNegativeDecimal;
  const netDirectionalExposure = addExactDecimals(longExposure, negateExactDecimal(shortExposure));
  const longPresent = compareExactDecimals(longExposure, ZERO) > 0;
  const shortPresent = compareExactDecimals(shortExposure, ZERO) > 0;
  const hedgeRatio = longPresent
    ? divideExactDecimals(shortExposure, longExposure, 18)
    : null;
  return Object.freeze({
    grossExposure,
    longExposure,
    shortExposure,
    netDirectionalExposure,
    hedgeRatio,
    oneLegExposure: longPresent !== shortPresent ? grossExposure : ZERO,
  });
}

function externalExecution(input: ActivePositionProjectionInput): Readonly<ExternalExecutionReference> | null {
  const source = input.executionState;
  if (source === null) return null;
  return Object.freeze({
    id: deriveExecutionCorrelationReferenceId({ externalPlanId: source.externalPlanId, correlationId: source.correlationId, revision: source.revision, sequence: source.sequence }),
    ...source,
    truth: refreshTruth(source.truth, input.projectedAtMs),
  });
}

function externalReconciliation(input: ActivePositionProjectionInput): Readonly<ExternalReconciliationReference> | null {
  const source = input.reconciliationState;
  if (source === null) return null;
  return Object.freeze({
    id: deriveReconciliationReferenceId({ externalPlanId: source.externalPlanId, correlationId: source.correlationId, revision: source.revision, sequence: source.sequence }),
    ...source,
    reasonCodes: sortedUnique(source.reasonCodes),
    truth: refreshTruth(source.truth, input.projectedAtMs),
  });
}

function stateFor(
  source: PositionState,
  gross: NonNegativeDecimal,
  oneLeg: NonNegativeDecimal,
  execution: Readonly<ExternalExecutionReference> | null,
  reconciliation: Readonly<ExternalReconciliationReference> | null,
  externalTruthDivergent: boolean,
): PositionState {
  if (externalTruthDivergent) return 'RECOVERY_REQUIRED';
  if (reconciliation !== null && DIVERGED_RECONCILIATION.has(reconciliation.status)) return 'RECOVERY_REQUIRED';
  if (execution?.lifecycle === 'RECOVERY_REQUIRED' || (execution?.lifecycle === 'FAILED' && compareExactDecimals(gross, ZERO) > 0)) return 'RECOVERY_REQUIRED';
  if (execution?.lifecycle === 'CLOSED' && reconciliation?.status === 'EXACT' && compareExactDecimals(gross, ZERO) === 0) return 'CLOSED';
  if (execution?.lifecycle === 'CLOSED' && compareExactDecimals(gross, ZERO) > 0) return 'RECOVERY_REQUIRED';
  if (execution?.lifecycle === 'ONE_LEG_EXPOSED' || compareExactDecimals(oneLeg, ZERO) > 0) return 'PARTIALLY_EXPOSED';
  if (execution?.lifecycle === 'CLOSE_REQUESTED' || execution?.lifecycle === 'CLOSING' || execution?.lifecycle === 'RECONCILING') return 'EXITING';
  if (execution === null || reconciliation === null || UNCERTAIN_RECONCILIATION.has(reconciliation.status)) return 'UNKNOWN';
  if (source === 'CLOSED') return compareExactDecimals(gross, ZERO) > 0 ? 'RECOVERY_REQUIRED' : 'UNKNOWN';
  return source;
}

function capitalLifecycleFor(state: PositionState, supplied: CapitalLifecycleState): CapitalLifecycleState {
  switch (state) {
    case 'ENTERING': return 'ENTERING';
    case 'PARTIALLY_EXPOSED': return 'PARTIALLY_EXPOSED';
    case 'HEDGED': return 'HEDGED';
    case 'ACTIVE': return 'ACTIVE';
    case 'REDUCING': return 'REDUCING';
    case 'EXITING': return 'EXITING';
    case 'RECOVERY_REQUIRED': return 'RECOVERY_REQUIRED';
    case 'CLOSED': return 'CLOSED';
    case 'UNKNOWN': return supplied === 'RECOVERY_REQUIRED' ? supplied : 'UNKNOWN';
  }
}

export function projectActivePosition(input: ActivePositionProjectionInput): Readonly<ActivePositionProjection> {
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw new TypeError('position revision must be a positive integer');
  for (const value of [input.openedAtMs, input.lastTransitionAtMs, input.projectedAtMs]) {
    if (!validTime(value)) throw new TypeError('position projection times must be injected UTC milliseconds');
  }
  if (input.openedAtMs > input.projectedAtMs || input.lastTransitionAtMs > input.projectedAtMs) throw new TypeError('position times cannot be in the future');
  if (input.oneLegSinceMs !== null && (!validTime(input.oneLegSinceMs) || input.oneLegSinceMs > input.projectedAtMs)) throw new TypeError('one-leg start time must be injected and not in the future');
  const legs = Object.freeze(input.legs.map((leg) => normalizeLeg(leg, input.projectedAtMs)).sort((a, b) => compareText(a.id, b.id)));
  if (new Set(legs.map((leg) => leg.valuationAsset)).size > 1) {
    throw new TypeError('position exposure cannot combine different valuation assets');
  }
  const issues: PositionProjectionIssue[] = [];
  const ids = new Set<string>();
  for (const leg of legs) {
    if (ids.has(leg.id)) issues.push(Object.freeze({ code: 'DUPLICATE_LEG_ID', truthEffect: 'DIVERGENT', detail: `duplicate leg ${leg.id}`, legIds: Object.freeze([leg.id]) }));
    ids.add(leg.id);
    const quantityZero = compareExactDecimals(leg.quantity, ZERO) === 0;
    const exposureZero = compareExactDecimals(leg.quoteExposure, ZERO) === 0;
    if (quantityZero !== exposureZero) issues.push(Object.freeze({ code: 'LEG_EXPOSURE_INCONSISTENT', truthEffect: 'DIVERGENT', detail: `leg ${leg.id} quantity/exposure zero-state differs`, legIds: Object.freeze([leg.id]) }));
    if (leg.truth.completeness !== 'COMPLETE' || leg.truth.freshness.state !== 'FRESH') issues.push(Object.freeze({ code: 'LEG_TRUTH_NOT_COMPLETE', truthEffect: leg.truth.completeness === 'DIVERGENT' ? 'DIVERGENT' : 'PARTIAL', detail: `leg ${leg.id} truth is ${leg.truth.completeness}/${leg.truth.freshness.state}`, legIds: Object.freeze([leg.id]) }));
  }
  const exposure = summarizePositionExposure(legs);
  const executionReference = externalExecution(input);
  const reconciliationReference = externalReconciliation(input);
  if (compareExactDecimals(exposure.grossExposure, ZERO) > 0 && executionReference === null) issues.push(Object.freeze({ code: 'EXECUTION_REFERENCE_MISSING', truthEffect: 'UNKNOWN', detail: 'exposed capital has no Foundation execution reference', legIds: Object.freeze([]) }));
  if (compareExactDecimals(exposure.grossExposure, ZERO) > 0 && reconciliationReference === null) issues.push(Object.freeze({ code: 'RECONCILIATION_REFERENCE_MISSING', truthEffect: 'UNKNOWN', detail: 'exposed capital has no Foundation reconciliation reference', legIds: Object.freeze([]) }));
  const externalCorrelationMismatch = executionReference !== null && reconciliationReference !== null
    && (executionReference.externalPlanId !== reconciliationReference.externalPlanId || executionReference.correlationId !== reconciliationReference.correlationId);
  if (externalCorrelationMismatch) issues.push(Object.freeze({ code: 'EXTERNAL_CORRELATION_MISMATCH', truthEffect: 'DIVERGENT', detail: 'execution and reconciliation references do not bind to the same plan/correlation', legIds: Object.freeze([]) }));
  if (reconciliationReference !== null && DIVERGED_RECONCILIATION.has(reconciliationReference.status)) issues.push(Object.freeze({ code: 'RECONCILIATION_DIVERGED', truthEffect: 'DIVERGENT', detail: `reconciliation is ${reconciliationReference.status}`, legIds: Object.freeze([]) }));
  else if (reconciliationReference !== null && UNCERTAIN_RECONCILIATION.has(reconciliationReference.status)) issues.push(Object.freeze({ code: 'RECONCILIATION_UNCERTAIN', truthEffect: 'UNKNOWN', detail: `reconciliation is ${reconciliationReference.status}`, legIds: Object.freeze([]) }));
  const state = stateFor(input.sourceState, exposure.grossExposure, exposure.oneLegExposure, executionReference, reconciliationReference, externalCorrelationMismatch);
  if (state !== input.sourceState) issues.push(Object.freeze({ code: 'SOURCE_STATE_OVERRIDDEN', truthEffect: state === 'RECOVERY_REQUIRED' ? 'DIVERGENT' : state === 'UNKNOWN' ? 'UNKNOWN' : 'NONE', detail: `external truth overrides ${input.sourceState} with ${state}`, legIds: Object.freeze([]) }));

  const refreshedTruths = [refreshTruth(input.truth, input.projectedAtMs), ...legs.map((leg) => leg.truth)];
  if (executionReference !== null) refreshedTruths.push(executionReference.truth);
  if (reconciliationReference !== null) refreshedTruths.push(reconciliationReference.truth);
  const issueStates = issues.map((issue): CapitalTruthState => issue.truthEffect === 'DIVERGENT' ? 'DIVERGENT' : issue.truthEffect === 'UNKNOWN' ? 'UNKNOWN' : issue.truthEffect === 'PARTIAL' ? 'PARTIAL' : 'COMPLETE');
  const completeness = weakestCapitalTruth([...refreshedTruths.map((truth) => truth.completeness), ...issueStates]);
  const baseTruth = refreshedTruths.reduce((worst, truth) => weakestCapitalTruth([worst.completeness, truth.completeness]) === truth.completeness ? truth : worst);
  const truth: Readonly<TruthMetadata> = Object.freeze({
    ...baseTruth,
    completeness,
    evaluatedAtMs: input.projectedAtMs,
    reasons: sortedUnique([...refreshedTruths.flatMap((item) => item.reasons), ...issues.map((issue) => issue.code)]),
    evidenceReferences: sortedUnique(refreshedTruths.flatMap((item) => item.evidenceReferences)),
  });
  const oneLegSinceMs = compareExactDecimals(exposure.oneLegExposure, ZERO) > 0 ? input.oneLegSinceMs : null;
  const position: ActivePosition = Object.freeze({
    id: input.id ?? deriveActivePositionId({ mandateId: input.mandateId, thesisId: input.thesis.id, openedAtMs: input.openedAtMs }),
    revision: input.revision,
    mandateId: input.mandateId,
    thesis: freezeThesis(input.thesis),
    state,
    capitalLifecycle: capitalLifecycleFor(state, input.sourceCapitalLifecycle),
    legs,
    totalGrossExposure: exposure.grossExposure,
    netDirectionalExposure: exposure.netDirectionalExposure,
    hedgeRatio: exposure.hedgeRatio,
    oneLegExposure: exposure.oneLegExposure,
    oneLegSinceMs,
    executionReference,
    reconciliationReference,
    outstandingActionIntentIds: sortedUnique(input.outstandingActionIntentIds),
    openedAtMs: input.openedAtMs,
    lastTransitionAtMs: input.lastTransitionAtMs,
    truth,
  });
  return Object.freeze({ position, executionReference, reconciliationReference, issues: Object.freeze(issues), supervisionPriority: 'EXPOSED_CAPITAL', projectedAtMs: input.projectedAtMs });
}

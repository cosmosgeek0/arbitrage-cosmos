import {
  addExactDecimals,
  assessCapitalTruth,
  compareExactDecimals,
  deriveActivePositionId,
  deriveExecutionCorrelationReferenceId,
  deriveReconciliationReferenceId,
  divideExactDecimals,
  isCapitalLifecycleState,
  negateExactDecimal,
  normalizeNonNegativeExactDecimal,
  POSITION_STATES,
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
import {
  isReconciliationStatus,
  isValidUtcMillis,
  isLegLifecycle,
  isPlanLifecycle,
  type LegLifecycle,
  type PlanLifecycle,
} from '../../foundation/contracts/index.js';
import type {
  ActivePositionProjection,
  ActivePositionProjectionInput,
  PositionExposureSummary,
  PositionProjectionIssue,
} from './types.js';

const ZERO = '0' as NonNegativeDecimal;
const UNCERTAIN_RECONCILIATION = new Set(['PENDING', 'PARTIAL', 'STALE', 'UNAVAILABLE']);
const DIVERGED_RECONCILIATION = new Set(['AMBIGUOUS', 'DIVERGED']);
const PRE_EXPOSURE_PLAN_LIFECYCLES = new Set<PlanLifecycle>([
  'CREATED',
  'AWAITING_APPROVAL',
  'PREFLIGHTING',
  'READY',
]);
const TERMINAL_NON_CLOSED_PLAN_LIFECYCLES = new Set<PlanLifecycle>([
  'FAILED',
  'CANCELLED',
  'EXPIRED',
]);
const POSITIVE_EXPOSURE_INCOMPATIBLE_LEG_LIFECYCLES = new Set<LegLifecycle>([
  'PLANNED',
  'VALIDATED',
  'SUBMITTING',
  'ACKNOWLEDGED',
  'CANCELLED',
  'REJECTED',
]);
const POSITIVE_EXPOSURE_UNCERTAIN_LEG_LIFECYCLES = new Set<LegLifecycle>([
  'AMBIGUOUS',
  'PARTIALLY_FILLED',
  'CANCEL_PENDING',
]);

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validTime(value: number): boolean {
  return isValidUtcMillis(value);
}

function validReferenceText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256;
}

function validReferenceTextList(value: unknown, requireNonEmpty = false): value is readonly string[] {
  return Array.isArray(value)
    && (!requireNonEmpty || value.length > 0)
    && value.every((entry) => validReferenceText(entry));
}

function validReferenceSequence(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function validReferenceRevision(value: unknown): value is string | null {
  return value === null || validReferenceText(value);
}

interface ExternalProjection<T> {
  readonly reference: Readonly<T> | null;
  readonly invalid: boolean;
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
  if (!validReferenceText(input.id) || !validReferenceText(input.instrumentId)
      || !validReferenceText(input.symbol) || !validReferenceText(input.valuationAsset)) {
    throw new TypeError('position leg identities must be canonical bounded strings');
  }
  if (input.side !== 'LONG' && input.side !== 'SHORT') {
    throw new TypeError(`position leg side must be LONG or SHORT; received ${JSON.stringify(input.side)}`);
  }
  if (input.externalLifecycle !== null && !isLegLifecycle(input.externalLifecycle)) {
    throw new TypeError(`position leg external lifecycle is not a Foundation LegLifecycle: ${JSON.stringify(input.externalLifecycle)}`);
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
    originalEvidenceIds: sortedUnique(thesis.originalEvidenceIds),
    targetConditions: sortedUnique(thesis.targetConditions),
    invalidationConditions: sortedUnique(thesis.invalidationConditions),
    stopAddingConditions: sortedUnique(thesis.stopAddingConditions),
  });
}

function validateProjectionBoundary(input: ActivePositionProjectionInput): void {
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new TypeError('position revision must be a positive safe integer');
  }
  if ((input.id !== undefined && !validReferenceText(input.id)) || !validReferenceText(input.mandateId)) {
    throw new TypeError('position and mandate identities must be canonical bounded strings');
  }
  if (!(POSITION_STATES as readonly unknown[]).includes(input.sourceState)) {
    throw new TypeError('position source state is not a known PositionState');
  }
  if (!isCapitalLifecycleState(input.sourceCapitalLifecycle)) {
    throw new TypeError('position source capital lifecycle is not a known CapitalLifecycleState');
  }
  if (input.sourceState === 'UNKNOWN'
    ? input.sourceCapitalLifecycle !== 'UNKNOWN' && input.sourceCapitalLifecycle !== 'RECOVERY_REQUIRED'
    : input.sourceState !== input.sourceCapitalLifecycle) {
    throw new TypeError('position source state and capital lifecycle are inconsistent');
  }
  for (const value of [input.openedAtMs, input.lastTransitionAtMs, input.projectedAtMs]) {
    if (!validTime(value)) throw new TypeError('position projection times must be injected UTC milliseconds');
  }
  if (input.openedAtMs > input.lastTransitionAtMs || input.lastTransitionAtMs > input.projectedAtMs) {
    throw new TypeError('position projection times are out of order');
  }
  if (input.oneLegSinceMs !== null && (!validTime(input.oneLegSinceMs)
      || input.oneLegSinceMs < input.openedAtMs || input.oneLegSinceMs > input.projectedAtMs)) {
    throw new TypeError('one-leg start time must be within the position projection interval');
  }
  if (typeof input.thesis !== 'object' || input.thesis === null
      || !validReferenceText(input.thesis.id) || !validReferenceText(input.thesis.proposalId)
      || !validReferenceText(input.thesis.configRevision)
      || (input.thesis.intelligenceThesisPacketId !== null && !validReferenceText(input.thesis.intelligenceThesisPacketId))) {
    throw new TypeError('position thesis identity and configuration binding are invalid');
  }
  if (!Number.isSafeInteger(input.thesis.revision) || input.thesis.revision < 1) {
    throw new TypeError('position thesis revision must be a positive safe integer');
  }
  if (input.thesis.strategy !== 'BASIS' && input.thesis.strategy !== 'VOLUME') {
    throw new TypeError('position thesis strategy is unknown');
  }
  if (!validTime(input.thesis.openedAtMs) || input.thesis.openedAtMs > input.openedAtMs) {
    throw new TypeError('position thesis open time must be injected and no later than the position open');
  }
  if (!Number.isSafeInteger(input.thesis.expectedHorizonMs) || input.thesis.expectedHorizonMs < 1
      || !Number.isSafeInteger(input.thesis.maximumHoldingHorizonMs) || input.thesis.maximumHoldingHorizonMs < 1
      || input.thesis.maximumHoldingHorizonMs < input.thesis.expectedHorizonMs) {
    throw new TypeError('position thesis horizons must be positive ordered safe integers');
  }
  if (!validReferenceTextList(input.thesis.originalEvidenceIds, true)
      || !validReferenceTextList(input.thesis.targetConditions, true)
      || !validReferenceTextList(input.thesis.invalidationConditions, true)
      || !validReferenceTextList(input.thesis.stopAddingConditions, true)) {
    throw new TypeError('position thesis evidence and condition lists must contain canonical bounded strings');
  }
  if (!Array.isArray(input.legs) || !validReferenceTextList(input.outstandingActionIntentIds)) {
    throw new TypeError('position legs and outstanding intent identities must be canonical collections');
  }
}

export function summarizePositionExposure(legs: readonly Readonly<PositionLeg>[]): Readonly<PositionExposureSummary> {
  let longExposure = ZERO;
  let shortExposure = ZERO;
  for (const leg of legs) {
    const amount = normalizeNonNegativeExactDecimal(leg.quoteExposure);
    if (leg.side === 'LONG') longExposure = addExactDecimals(longExposure, amount) as NonNegativeDecimal;
    else if (leg.side === 'SHORT') shortExposure = addExactDecimals(shortExposure, amount) as NonNegativeDecimal;
    else throw new TypeError(`position leg side must be LONG or SHORT; received ${JSON.stringify(leg.side)}`);
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

function externalExecution(input: ActivePositionProjectionInput): ExternalProjection<ExternalExecutionReference> {
  const source = input.executionState;
  if (source === null) return Object.freeze({ reference: null, invalid: false });
  if (typeof source !== 'object' || Array.isArray(source)
      || !validReferenceText(source.externalPlanId) || !validReferenceText(source.correlationId)
      || !isPlanLifecycle(source.lifecycle) || !isValidUtcMillis(source.observedAtMs)
      || source.observedAtMs > input.projectedAtMs || !validReferenceSequence(source.sequence)
      || !validReferenceRevision(source.revision)) {
    return Object.freeze({ reference: null, invalid: true });
  }
  try {
    return Object.freeze({
      invalid: false,
      reference: Object.freeze({
        id: deriveExecutionCorrelationReferenceId({ externalPlanId: source.externalPlanId, correlationId: source.correlationId, revision: source.revision, sequence: source.sequence }),
        ...source,
        truth: refreshTruth(source.truth, input.projectedAtMs),
      }),
    });
  } catch {
    return Object.freeze({ reference: null, invalid: true });
  }
}

function externalReconciliation(input: ActivePositionProjectionInput): ExternalProjection<ExternalReconciliationReference> {
  const source = input.reconciliationState;
  if (source === null) return Object.freeze({ reference: null, invalid: false });
  if (typeof source !== 'object' || Array.isArray(source)
      || !validReferenceText(source.externalPlanId) || !validReferenceText(source.correlationId)
      || !isReconciliationStatus(source.status) || !isValidUtcMillis(source.observedAtMs)
      || source.observedAtMs > input.projectedAtMs || !validReferenceSequence(source.sequence)
      || !validReferenceRevision(source.revision) || !Array.isArray(source.reasonCodes)
      || source.reasonCodes.some((reason) => !validReferenceText(reason))) {
    return Object.freeze({ reference: null, invalid: true });
  }
  try {
    return Object.freeze({
      invalid: false,
      reference: Object.freeze({
        id: deriveReconciliationReferenceId({ externalPlanId: source.externalPlanId, correlationId: source.correlationId, revision: source.revision, sequence: source.sequence }),
        ...source,
        reasonCodes: sortedUnique(source.reasonCodes),
        truth: refreshTruth(source.truth, input.projectedAtMs),
      }),
    });
  } catch {
    return Object.freeze({ reference: null, invalid: true });
  }
}

function stateFor(
  source: PositionState,
  gross: NonNegativeDecimal,
  oneLeg: NonNegativeDecimal,
  execution: Readonly<ExternalExecutionReference> | null,
  reconciliation: Readonly<ExternalReconciliationReference> | null,
  externalTruthDivergent: boolean,
  externalTruthUnknown: boolean,
  legLifecycleExposureDivergent: boolean,
  legLifecycleExposureUnknown: boolean,
): PositionState {
  const hasExposure = compareExactDecimals(gross, ZERO) > 0;
  if (externalTruthDivergent) return 'RECOVERY_REQUIRED';
  if (reconciliation !== null && DIVERGED_RECONCILIATION.has(reconciliation.status)) return 'RECOVERY_REQUIRED';
  if (execution?.lifecycle === 'RECOVERY_REQUIRED') return 'RECOVERY_REQUIRED';
  if (execution !== null && hasExposure && (
    PRE_EXPOSURE_PLAN_LIFECYCLES.has(execution.lifecycle)
    || TERMINAL_NON_CLOSED_PLAN_LIFECYCLES.has(execution.lifecycle)
  )) return 'RECOVERY_REQUIRED';
  if (legLifecycleExposureDivergent) return 'RECOVERY_REQUIRED';
  if (externalTruthUnknown) return 'UNKNOWN';
  if (legLifecycleExposureUnknown) return 'UNKNOWN';
  if (execution !== null && !hasExposure && TERMINAL_NON_CLOSED_PLAN_LIFECYCLES.has(execution.lifecycle)) return 'UNKNOWN';
  if (execution?.lifecycle === 'CLOSED' && reconciliation?.status === 'EXACT' && compareExactDecimals(gross, ZERO) === 0) return 'CLOSED';
  if (execution?.lifecycle === 'CLOSED' && hasExposure) return 'RECOVERY_REQUIRED';
  if (execution?.lifecycle === 'ONE_LEG_EXPOSED' || compareExactDecimals(oneLeg, ZERO) > 0) return 'PARTIALLY_EXPOSED';
  if (execution?.lifecycle === 'CLOSE_REQUESTED' || execution?.lifecycle === 'CLOSING' || execution?.lifecycle === 'RECONCILING') return 'EXITING';
  if (execution === null || reconciliation === null || UNCERTAIN_RECONCILIATION.has(reconciliation.status)) return 'UNKNOWN';
  if (source === 'CLOSED') return hasExposure ? 'RECOVERY_REQUIRED' : 'UNKNOWN';
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
  validateProjectionBoundary(input);
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
    if (!exposureZero && leg.externalLifecycle !== null && POSITIVE_EXPOSURE_INCOMPATIBLE_LEG_LIFECYCLES.has(leg.externalLifecycle)) {
      issues.push(Object.freeze({ code: 'LEG_LIFECYCLE_EXPOSURE_CONFLICT', truthEffect: 'DIVERGENT', detail: `positive exposure on leg ${leg.id} conflicts with Foundation leg lifecycle ${leg.externalLifecycle}`, legIds: Object.freeze([leg.id]) }));
    } else if (!exposureZero && (leg.externalLifecycle === null || POSITIVE_EXPOSURE_UNCERTAIN_LEG_LIFECYCLES.has(leg.externalLifecycle))) {
      issues.push(Object.freeze({ code: 'LEG_LIFECYCLE_EXPOSURE_UNCERTAIN', truthEffect: 'UNKNOWN', detail: `positive exposure on leg ${leg.id} is not proven FILLED by Foundation leg lifecycle ${leg.externalLifecycle ?? 'UNKNOWN'}`, legIds: Object.freeze([leg.id]) }));
    }
    if (leg.truth.completeness !== 'COMPLETE' || leg.truth.freshness.state !== 'FRESH') issues.push(Object.freeze({ code: 'LEG_TRUTH_NOT_COMPLETE', truthEffect: leg.truth.completeness === 'DIVERGENT' ? 'DIVERGENT' : 'PARTIAL', detail: `leg ${leg.id} truth is ${leg.truth.completeness}/${leg.truth.freshness.state}`, legIds: Object.freeze([leg.id]) }));
  }
  const exposure = summarizePositionExposure(legs);
  const projectedExecution = externalExecution(input);
  const projectedReconciliation = externalReconciliation(input);
  const executionReference = projectedExecution.reference;
  const reconciliationReference = projectedReconciliation.reference;
  const hasExposure = compareExactDecimals(exposure.grossExposure, ZERO) > 0;
  if (projectedExecution.invalid) issues.push(Object.freeze({ code: 'EXECUTION_REFERENCE_INVALID', truthEffect: 'DIVERGENT', detail: 'Foundation execution reference is malformed or temporally invalid', legIds: Object.freeze([]) }));
  else if (hasExposure && executionReference === null) issues.push(Object.freeze({ code: 'EXECUTION_REFERENCE_MISSING', truthEffect: 'UNKNOWN', detail: 'exposed capital has no Foundation execution reference', legIds: Object.freeze([]) }));
  if (projectedReconciliation.invalid) issues.push(Object.freeze({ code: 'RECONCILIATION_REFERENCE_INVALID', truthEffect: 'DIVERGENT', detail: 'Foundation reconciliation reference has malformed identity, status, time, sequence, revision, reasons, or truth', legIds: Object.freeze([]) }));
  else if (hasExposure && reconciliationReference === null) issues.push(Object.freeze({ code: 'RECONCILIATION_REFERENCE_MISSING', truthEffect: 'UNKNOWN', detail: 'exposed capital has no Foundation reconciliation reference', legIds: Object.freeze([]) }));
  const externalCorrelationMismatch = executionReference !== null && reconciliationReference !== null
    && (executionReference.externalPlanId !== reconciliationReference.externalPlanId || executionReference.correlationId !== reconciliationReference.correlationId);
  if (externalCorrelationMismatch) issues.push(Object.freeze({ code: 'EXTERNAL_CORRELATION_MISMATCH', truthEffect: 'DIVERGENT', detail: 'execution and reconciliation references do not bind to the same plan/correlation', legIds: Object.freeze([]) }));
  if (executionReference !== null && compareExactDecimals(exposure.grossExposure, ZERO) > 0 && (
    PRE_EXPOSURE_PLAN_LIFECYCLES.has(executionReference.lifecycle)
    || TERMINAL_NON_CLOSED_PLAN_LIFECYCLES.has(executionReference.lifecycle)
    || executionReference.lifecycle === 'CLOSED'
  )) issues.push(Object.freeze({ code: 'EXECUTION_LIFECYCLE_EXPOSURE_CONFLICT', truthEffect: 'DIVERGENT', detail: `positive exposure conflicts with Foundation execution lifecycle ${executionReference.lifecycle}`, legIds: Object.freeze([]) }));
  if (reconciliationReference !== null && DIVERGED_RECONCILIATION.has(reconciliationReference.status)) issues.push(Object.freeze({ code: 'RECONCILIATION_DIVERGED', truthEffect: 'DIVERGENT', detail: `reconciliation is ${reconciliationReference.status}`, legIds: Object.freeze([]) }));
  else if (reconciliationReference !== null && UNCERTAIN_RECONCILIATION.has(reconciliationReference.status)) issues.push(Object.freeze({ code: 'RECONCILIATION_UNCERTAIN', truthEffect: 'UNKNOWN', detail: `reconciliation is ${reconciliationReference.status}`, legIds: Object.freeze([]) }));
  const legLifecycleExposureDivergent = issues.some((issue) => issue.code === 'LEG_LIFECYCLE_EXPOSURE_CONFLICT');
  const legLifecycleExposureUnknown = issues.some((issue) => issue.code === 'LEG_LIFECYCLE_EXPOSURE_UNCERTAIN');
  const externalReferenceInvalid = projectedExecution.invalid || projectedReconciliation.invalid;
  const externalTruthDivergent = externalCorrelationMismatch
    || executionReference?.truth.completeness === 'DIVERGENT'
    || reconciliationReference?.truth.completeness === 'DIVERGENT'
    || (hasExposure && externalReferenceInvalid);
  const externalTruthUnknown = !externalTruthDivergent && (
    externalReferenceInvalid
    || (executionReference !== null && executionReference.truth.completeness !== 'COMPLETE')
    || (reconciliationReference !== null && reconciliationReference.truth.completeness !== 'COMPLETE')
  );
  const state = stateFor(
    input.sourceState,
    exposure.grossExposure,
    exposure.oneLegExposure,
    executionReference,
    reconciliationReference,
    externalTruthDivergent,
    externalTruthUnknown,
    legLifecycleExposureDivergent,
    legLifecycleExposureUnknown,
  );
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

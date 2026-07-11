import {
  canonicalJson,
  createStructuredFailure,
  evaluateFreshness,
  fail,
  isLegLifecycle,
  isPlanLifecycle,
  isReconciliationStatus,
  isValidUtcMillis,
  ok,
  stableHash128Hex,
  validateSourcedTimestamp,
  type ContractResult,
} from '../../foundation/contracts/index.js';
import {
  ACTION_URGENCIES,
  CAPITAL_STAGES,
  CAPITAL_TRUTH_STATES,
  ECONOMIC_COMPONENT_KINDS,
  FUTURE_GATES,
  POSITION_STATES,
  absoluteExactDecimal,
  actionRiskEffect,
  addExactDecimals,
  assessCapitalTruth,
  canTransitionCapitalLifecycle,
  capitalDigest,
  compareExactDecimals,
  deriveCapitalCheckpointId,
  isCapitalLifecycleState,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  subtractExactDecimals,
  sumExactDecimals,
  truthAllowsNewExposure,
  validateEconomicAttribution,
  validatePositionActionIntent,
  weakestCapitalTruth,
  type ActivePosition,
  type ActivePositionId,
  type CapitalEventId,
  type CapitalReservation,
  type ExactDecimal,
  type ExternalReconciliationReference,
  type OperatorApprovalId,
} from '../contracts/index.js';
import { validateOperatorApproval } from '../approvals/index.js';
import { projectActivePosition } from '../positions/index.js';
import {
  decodeCapitalCheckpointEventRecord,
  validateCapitalCheckpointEvent,
} from './events.js';
import {
  CAPITAL_CHECKPOINT_SCHEMA,
  CAPITAL_CHECKPOINT_VERSION,
  type ApprovalRevocationRecord,
  type CapitalCheckpoint,
  type CapitalCheckpointEvent,
  type CapitalCheckpointEventKind,
  type CapitalCheckpointRecord,
  type CapitalCheckpointResult,
  type CapitalCheckpointState,
  type CapitalLifecycleRecord,
  type PositionEconomicsRecord,
  type RestartSafetyProjection,
  type RestartTruthInput,
  type RestoredCapitalProjection,
  type RestoreCapitalCheckpointInput,
} from './types.js';

function nonEmpty(value: unknown, maximum = 256): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value.trim() === value;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value as Readonly<T>;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry, seen);
  } else {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function failure<T>(
  code: string,
  message: string,
  nowMs: number,
  correlationId: string,
  safeCurrentState: string,
): ContractResult<T> {
  return fail(createStructuredFailure({
    component: 'capitalFoundation.checkpoint',
    stage: 'project',
    code,
    message,
    occurredAt: nowMs,
    retryable: false,
    safeCurrentState,
    recommendedOperatorAction: 'Use a complete monotonic event stream or a verified checkpoint.',
    correlationId,
  }));
}

export function createEmptyCapitalCheckpointState(streamId: string): Readonly<CapitalCheckpointState> {
  if (!nonEmpty(streamId)) throw new TypeError('checkpoint streamId must be a bounded non-empty string');
  return deepFreeze({
    streamId,
    revision: 0,
    lastSequence: 0,
    updatedAtMs: null,
    reservations: [],
    mandates: [],
    stagedPlans: [],
    approvals: [],
    revocations: [],
    theses: [],
    positions: [],
    reconciliationReferences: [],
    intents: [],
    economics: [],
    lifecycles: [],
    eventLog: [],
    processedEventIds: [],
  });
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function validTimes(
  record: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  return requiredKeys.every((key) => isValidUtcMillis(record[key]))
    && optionalKeys.every((key) => record[key] === null || isValidUtcMillis(record[key]));
}

function exact(value: unknown, nonNegative: boolean): boolean {
  try {
    const normalized = nonNegative
      ? normalizeNonNegativeExactDecimal(value)
      : normalizeExactDecimal(value);
    return normalized === value;
  } catch {
    return false;
  }
}

function stringArray(value: unknown, requireNonEmpty = false): value is readonly string[] {
  return Array.isArray(value)
    && (!requireNonEmpty || value.length > 0)
    && value.every((entry) => nonEmpty(entry));
}

function canonicalStringArray(value: unknown, requireNonEmpty = false): value is readonly string[] {
  return stringArray(value, requireNonEmpty)
    && new Set(value).size === value.length
    && canonicalJson(value) === canonicalJson([...value].sort(compareText));
}

function validTruthMetadata(value: unknown): boolean {
  if (!object(value) || !object(value.source) || !object(value.freshness)) return false;
  if (validateSourcedTimestamp(value.source).length > 0 || !isValidUtcMillis(value.evaluatedAtMs)) return false;
  if (!(CAPITAL_TRUTH_STATES as readonly unknown[]).includes(value.completeness)
      || !canonicalStringArray(value.reasons) || !canonicalStringArray(value.evidenceReferences)
      || (value.revision !== null && !nonEmpty(value.revision))) return false;
  try {
    const expectedFreshness = evaluateFreshness(value.source as never, value.evaluatedAtMs as number);
    return canonicalJson(expectedFreshness) === canonicalJson(value.freshness);
  } catch {
    return false;
  }
}

function semanticDigestMatches(value: Record<string, unknown>): boolean {
  if (!nonEmpty(value.digest)) return false;
  const { digest, ...semantic } = value;
  return digest === capitalDigest(semantic);
}

function validateStagedPlanRecord(value: Record<string, unknown>): readonly string[] {
  const reasons: string[] = [];
  if (!nonEmpty(value.reservationId) || !nonEmpty(value.configRevision)
      || !nonEmpty(value.proposalIntakeDigest) || !nonEmpty(value.valuationAsset)
      || !nonEmpty(value.reservationConsiderationId)) reasons.push('STAGED_PLAN_BINDING_INVALID');
  if (!validRevision(value.reservationRevision)) reasons.push('STAGED_PLAN_RESERVATION_REVISION_INVALID');
  if (!Array.isArray(value.stages) || value.stages.length < 2) return Object.freeze([...reasons, 'STAGED_PLAN_STAGES_INCOMPLETE']);
  const stages = value.stages as unknown[];
  const names = stages.map((entry) => object(entry) ? entry.stage : null);
  if (names[0] !== 'OBSERVE' || names.at(-1) !== 'EXIT' || new Set(names).size !== names.length
      || !(CAPITAL_STAGES as readonly unknown[]).includes(value.activeStage) || !names.includes(value.activeStage)) {
    reasons.push('STAGED_PLAN_STAGE_ENVELOPE_INVALID');
  }
  let cumulativeReservation: ExactDecimal = '0' as ExactDecimal;
  stages.forEach((candidate, index) => {
    if (!object(candidate)) {
      reasons.push('STAGED_PLAN_STAGE_INVALID');
      return;
    }
    if (!(CAPITAL_STAGES as readonly unknown[]).includes(candidate.stage) || candidate.sequence !== index
        || !Number.isSafeInteger(candidate.sequence)) reasons.push('STAGED_PLAN_STAGE_SEQUENCE_INVALID');
    for (const field of ['maximumAdditionalExposure', 'maximumTotalExposure', 'reservationConsumption', 'maximumNakedLegAmount'] as const) {
      if (!exact(candidate[field], true)) reasons.push(`STAGED_PLAN_STAGE_${field.toUpperCase()}_INVALID`);
    }
    if (!Number.isSafeInteger(candidate.maximumTimeInStageMs) || (candidate.maximumTimeInStageMs as number) <= 0
        || !Number.isSafeInteger(candidate.maximumNakedLegDurationMs) || (candidate.maximumNakedLegDurationMs as number) < 0
        || typeof candidate.cancellableBeforeEntry !== 'boolean') reasons.push('STAGED_PLAN_STAGE_POLICY_INVALID');
    if (!Array.isArray(candidate.prerequisites) || !canonicalStringArray(candidate.economicThesisConditions)
        || !canonicalStringArray(candidate.invalidationConditions) || !canonicalStringArray(candidate.stopAddingConditions)
        || !canonicalStringArray(candidate.reductionConditions) || !canonicalStringArray(candidate.allowedNextStages)
        || !canonicalStringArray(candidate.requiredApprovalActions) || !canonicalStringArray(candidate.requiredFutureGates)) {
      reasons.push('STAGED_PLAN_STAGE_COLLECTION_INVALID');
    }
    if (Array.isArray(candidate.allowedNextStages)
        && candidate.allowedNextStages.some((stage) => !(CAPITAL_STAGES as readonly unknown[]).includes(stage))) {
      reasons.push('STAGED_PLAN_NEXT_STAGE_INVALID');
    }
    if (exact(candidate.reservationConsumption, true)) {
      cumulativeReservation = addExactDecimals(cumulativeReservation, candidate.reservationConsumption as ExactDecimal);
      if (exact(candidate.maximumAdditionalExposure, true)
          && compareExactDecimals(candidate.maximumAdditionalExposure as ExactDecimal, candidate.reservationConsumption as ExactDecimal) > 0) {
        reasons.push('STAGED_PLAN_RESERVATION_UNDERCOVERS_ADDITIONAL');
      }
      if (exact(candidate.maximumTotalExposure, true)
          && compareExactDecimals(candidate.maximumTotalExposure as ExactDecimal, cumulativeReservation) > 0) {
        reasons.push('STAGED_PLAN_TOTAL_EXCEEDS_CUMULATIVE_RESERVATION');
      }
    }
  });
  if (!semanticDigestMatches(value)) reasons.push('STAGED_PLAN_DIGEST_INVALID');
  return Object.freeze([...new Set(reasons)]);
}

function validateMandateRecord(value: Record<string, unknown>): readonly string[] {
  const reasons: string[] = [];
  for (const field of ['considerationId', 'allocationDecisionId', 'reservationId', 'stagedPlanId', 'stagedPlanDigest',
    'proposalIntakeDigest', 'configRevision', 'valuationAsset'] as const) {
    if (!nonEmpty(value[field])) reasons.push(`MANDATE_${field.toUpperCase()}_INVALID`);
  }
  if (!validRevision(value.stagedPlanRevision)) reasons.push('MANDATE_STAGED_PLAN_REVISION_INVALID');
  if (value.approvalId !== null && !nonEmpty(value.approvalId)) reasons.push('MANDATE_APPROVAL_ID_INVALID');
  if (!semanticDigestMatches(value)) reasons.push('MANDATE_DIGEST_INVALID');
  return Object.freeze([...new Set(reasons)]);
}

function validateThesisRecord(value: Record<string, unknown>): readonly string[] {
  const reasons: string[] = [];
  if ((value.strategy !== 'BASIS' && value.strategy !== 'VOLUME') || !nonEmpty(value.proposalId)
      || (value.intelligenceThesisPacketId !== null && !nonEmpty(value.intelligenceThesisPacketId))
      || !nonEmpty(value.configRevision)) reasons.push('THESIS_BINDING_INVALID');
  if (!Number.isSafeInteger(value.expectedHorizonMs) || (value.expectedHorizonMs as number) <= 0
      || !Number.isSafeInteger(value.maximumHoldingHorizonMs) || (value.maximumHoldingHorizonMs as number) <= 0
      || (value.maximumHoldingHorizonMs as number) < (value.expectedHorizonMs as number)) reasons.push('THESIS_HORIZON_INVALID');
  if (!canonicalStringArray(value.originalEvidenceIds, true) || !canonicalStringArray(value.targetConditions, true)
      || !canonicalStringArray(value.invalidationConditions, true) || !canonicalStringArray(value.stopAddingConditions, true)) {
    reasons.push('THESIS_CONDITIONS_INVALID');
  }
  return Object.freeze(reasons);
}

function validateReconciliationRecord(value: Record<string, unknown>): readonly string[] {
  const reasons: string[] = [];
  if (!nonEmpty(value.externalPlanId) || !nonEmpty(value.correlationId)
      || (value.sequence !== null && (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0))
      || (value.revision !== null && !nonEmpty(value.revision)) || !canonicalStringArray(value.reasonCodes)
      || !validTruthMetadata(value.truth)) reasons.push('RECONCILIATION_BINDING_OR_TRUTH_INVALID');
  return Object.freeze(reasons);
}

function validatePositionRecord(value: Record<string, unknown>): readonly string[] {
  const reasons: string[] = [];
  if (!nonEmpty(value.mandateId) || !object(value.thesis)) return Object.freeze(['POSITION_BINDING_INVALID']);
  reasons.push(...validateThesisRecord(value.thesis).map((reason) => `POSITION_${reason}`));
  if (!Array.isArray(value.legs) || !canonicalStringArray(value.outstandingActionIntentIds)
      || !validTruthMetadata(value.truth)) return Object.freeze([...reasons, 'POSITION_COLLECTION_OR_TRUTH_INVALID']);
  for (const leg of value.legs) {
    if (!object(leg) || !nonEmpty(leg.id) || !nonEmpty(leg.instrumentId) || !nonEmpty(leg.symbol)
        || !nonEmpty(leg.valuationAsset) || (leg.side !== 'LONG' && leg.side !== 'SHORT')
        || (leg.externalLifecycle !== null && !isLegLifecycle(leg.externalLifecycle)) || !validTruthMetadata(leg.truth)) {
      reasons.push('POSITION_LEG_INVALID');
    }
  }
  const execution = value.executionReference;
  if (execution !== null && (!object(execution) || !nonEmpty(execution.id) || !nonEmpty(execution.externalPlanId)
      || !nonEmpty(execution.correlationId) || !isPlanLifecycle(execution.lifecycle)
      || !isValidUtcMillis(execution.observedAtMs) || (execution.sequence !== null && !Number.isSafeInteger(execution.sequence))
      || (execution.revision !== null && !nonEmpty(execution.revision)) || !validTruthMetadata(execution.truth))) {
    reasons.push('POSITION_EXECUTION_REFERENCE_INVALID');
  }
  const reconciliation = value.reconciliationReference;
  if (reconciliation !== null && (!object(reconciliation) || validateReconciliationRecord(reconciliation).length > 0)) {
    reasons.push('POSITION_RECONCILIATION_REFERENCE_INVALID');
  }
  if (reasons.length > 0) return Object.freeze([...new Set(reasons)]);
  const executionRecord = execution as Record<string, unknown> | null;
  const reconciliationRecord = reconciliation as Record<string, unknown> | null;
  try {
    const projected = projectActivePosition({
      id: value.id as never,
      revision: value.revision as number,
      mandateId: value.mandateId as never,
      thesis: value.thesis as never,
      sourceState: value.state as never,
      sourceCapitalLifecycle: value.capitalLifecycle as never,
      legs: value.legs as never,
      oneLegSinceMs: value.oneLegSinceMs as number | null,
      executionState: executionRecord === null ? null : {
        externalPlanId: executionRecord.externalPlanId as string,
        correlationId: executionRecord.correlationId as string,
        lifecycle: executionRecord.lifecycle as never,
        observedAtMs: executionRecord.observedAtMs as number,
        sequence: executionRecord.sequence as number | null,
        revision: executionRecord.revision as string | null,
        truth: executionRecord.truth as never,
      },
      reconciliationState: reconciliationRecord === null ? null : {
        externalPlanId: reconciliationRecord.externalPlanId as string,
        correlationId: reconciliationRecord.correlationId as string,
        status: reconciliationRecord.status as never,
        observedAtMs: reconciliationRecord.observedAtMs as number,
        sequence: reconciliationRecord.sequence as number | null,
        revision: reconciliationRecord.revision as string | null,
        reasonCodes: reconciliationRecord.reasonCodes as readonly string[],
        truth: reconciliationRecord.truth as never,
      },
      outstandingActionIntentIds: value.outstandingActionIntentIds as readonly string[],
      openedAtMs: value.openedAtMs as number,
      lastTransitionAtMs: value.lastTransitionAtMs as number,
      truth: value.truth as never,
      projectedAtMs: (value.truth as Record<string, unknown>).evaluatedAtMs as number,
    });
    if (canonicalJson(projected.position) !== canonicalJson(value)) reasons.push('POSITION_PROJECTION_INVARIANT_INVALID');
  } catch {
    reasons.push('POSITION_PROJECTION_INVARIANT_INVALID');
  }
  return Object.freeze([...new Set(reasons)]);
}

function validateActionIntentRecord(value: Record<string, unknown>): readonly string[] {
  const reasons = validatePositionActionIntent(value).map((reason) => `INTENT_${reason}`);
  if (!nonEmpty(value.positionId) || !validRevision(value.sourcePositionRevision) || !nonEmpty(value.sourceThesisId)
      || !validRevision(value.sourceThesisRevision) || !(ACTION_URGENCIES as readonly unknown[]).includes(value.urgency)
      || !canonicalStringArray(value.why, true) || !canonicalStringArray(value.supportingEvidenceIds)
      || !canonicalStringArray(value.conflictingEvidenceIds) || !canonicalStringArray(value.blockingFacts)
      || !canonicalStringArray(value.invalidationConditions) || !canonicalStringArray(value.requiredFutureGates)
      || (value.requiredFutureGates as unknown[]).some((gate) => !(FUTURE_GATES as readonly unknown[]).includes(gate))
      || !(CAPITAL_TRUTH_STATES as readonly unknown[]).includes(value.completeness)
      || !nonEmpty(value.idempotencyKey) || !nonEmpty(value.correlationKey) || !isValidUtcMillis(value.createdAtMs)
      || (value.hardDeadlineMs !== null && (!isValidUtcMillis(value.hardDeadlineMs)
        || (value.hardDeadlineMs as number) < (value.createdAtMs as number)))
      || (value.economicCostOfWaiting !== null && !exact(value.economicCostOfWaiting, true))
      || (value.expectedCostOfActing !== null && !exact(value.expectedCostOfActing, true))) {
    reasons.push('INTENT_REQUIRED_FIELD_INVALID');
  }
  if (typeof value.kind === 'string' && value.riskEffect !== actionRiskEffect(value.kind as never)) reasons.push('INTENT_RISK_EFFECT_MISMATCH');
  if (object(value.target) && !nonEmpty(value.target.valuationAsset)) reasons.push('INTENT_TARGET_VALUATION_INVALID');
  const stageAuthorization = value.stageTransitionAuthorization;
  if (value.kind === 'ADD_STAGE') {
    if (!object(stageAuthorization) || stageAuthorization.authorizedForExternalRiskEvaluation !== true
        || stageAuthorization.executionReady !== false || stageAuthorization.to !== 'ADD'
        || !(CAPITAL_STAGES as readonly unknown[]).includes(stageAuthorization.from)
        || !nonEmpty(stageAuthorization.planId) || !validRevision(stageAuthorization.planRevision)
        || !nonEmpty(stageAuthorization.planDigest) || !nonEmpty(stageAuthorization.reservationId)
        || !validRevision(stageAuthorization.reservationRevision) || !nonEmpty(stageAuthorization.approvalId)
        || !validRevision(stageAuthorization.approvalRevision) || !isValidUtcMillis(stageAuthorization.evaluatedAtMs)
        || stageAuthorization.evaluatedAtMs !== value.createdAtMs || !exact(stageAuthorization.reservationConsumption, true)
        || !exact(stageAuthorization.reservationAvailable, true) || !canonicalStringArray(stageAuthorization.requiredFutureGates, true)
        || (stageAuthorization.requiredFutureGates as unknown[]).some((gate) => !(FUTURE_GATES as readonly unknown[]).includes(gate))) {
      reasons.push('INTENT_ADD_STAGE_AUTHORITY_INVALID');
    }
  } else if (stageAuthorization !== undefined && stageAuthorization !== null) {
    reasons.push('INTENT_STAGE_AUTHORITY_UNEXPECTED');
  }
  const geometry = value.directionalReductionGeometry;
  if (geometry !== undefined && geometry !== null) {
    if (value.kind !== 'REDUCE' || !object(geometry) || !exact(geometry.currentTotalExposure, true)
        || !exact(geometry.targetTotalExposure, true) || !exact(geometry.currentNetDirectionalExposure, false)
        || !exact(geometry.targetNetDirectionalExposure, false) || !exact(geometry.absoluteDirectionalExposureReduction, true)) {
      reasons.push('INTENT_DIRECTIONAL_REDUCTION_GEOMETRY_INVALID');
    } else {
      const reduction = subtractExactDecimals(
        absoluteExactDecimal(geometry.currentNetDirectionalExposure as ExactDecimal),
        absoluteExactDecimal(geometry.targetNetDirectionalExposure as ExactDecimal),
      );
      if (compareExactDecimals(reduction, '0' as ExactDecimal) < 0
          || reduction !== geometry.absoluteDirectionalExposureReduction
          || !object(value.target) || value.target.kind !== 'TOTAL'
          || value.target.quoteNotional !== geometry.targetTotalExposure) {
        reasons.push('INTENT_DIRECTIONAL_REDUCTION_GEOMETRY_INVALID');
      }
    }
  }
  return Object.freeze([...new Set(reasons)]);
}

function validateEconomicRecord(value: Record<string, unknown>): readonly string[] {
  const reasons: string[] = [];
  if (!object(value.attribution)) return Object.freeze(['ECONOMICS_ATTRIBUTION_INVALID']);
  reasons.push(...validateEconomicAttribution(value.attribution as never).map((reason) => `ECONOMICS_${reason}`));
  const attribution = value.attribution;
  if (!isValidUtcMillis(attribution.evaluatedAtMs) || !Array.isArray(attribution.components)
      || !canonicalStringArray(attribution.includedComponentIds) || !canonicalStringArray(attribution.divergentReasons)
      || !canonicalStringArray(attribution.missingComponentKinds)
      || (attribution.missingComponentKinds as unknown[]).some((kind) => !(ECONOMIC_COMPONENT_KINDS as readonly unknown[]).includes(kind))
      || !(CAPITAL_TRUTH_STATES as readonly unknown[]).includes(attribution.completeness)
      || typeof attribution.accountingIdentityProven !== 'boolean') {
    reasons.push('ECONOMICS_ATTRIBUTION_REQUIRED_FIELD_INVALID');
    return Object.freeze([...new Set(reasons)]);
  }
  const components = attribution.components as Record<string, unknown>[];
  const ids = components.map((component) => component.id);
  if (ids.some((id) => !nonEmpty(id)) || new Set(ids).size !== ids.length) reasons.push('ECONOMICS_COMPONENT_ID_INVALID');
  const included = new Set(attribution.includedComponentIds as string[]);
  if ([...included].some((id) => !ids.includes(id))) reasons.push('ECONOMICS_INCLUDED_COMPONENT_UNKNOWN');
  const knownAmounts: ExactDecimal[] = [];
  const estimatedRanges: Array<{ low: ExactDecimal; high: ExactDecimal }> = [];
  for (const component of components) {
    if (!included.has(component.id as string)) continue;
    if (component.status === 'KNOWN' && exact(component.amount, false)) knownAmounts.push(component.amount as ExactDecimal);
    else if (component.status === 'ESTIMATED' && object(component.estimateRange)
      && exact(component.estimateRange.low, false) && exact(component.estimateRange.high, false)) {
      estimatedRanges.push({ low: component.estimateRange.low as ExactDecimal, high: component.estimateRange.high as ExactDecimal });
    } else reasons.push('ECONOMICS_INCLUDED_COMPONENT_NOT_ACCOUNTABLE');
  }
  const known = sumExactDecimals(knownAmounts);
  if (attribution.netKnown !== known) reasons.push('ECONOMICS_NET_KNOWN_IDENTITY_INVALID');
  const expectedRange = estimatedRanges.length === 0 ? null : {
    low: sumExactDecimals([known, ...estimatedRanges.map((range) => range.low)]),
    high: sumExactDecimals([known, ...estimatedRanges.map((range) => range.high)]),
  };
  if (canonicalJson(attribution.netEstimatedRange) !== canonicalJson(expectedRange)) reasons.push('ECONOMICS_ESTIMATE_IDENTITY_INVALID');
  if (attribution.accountingIdentityProven === true
      && (components.length === 0 || (attribution.missingComponentKinds as unknown[]).length > 0
        || (attribution.divergentReasons as unknown[]).length > 0)) reasons.push('ECONOMICS_FALSE_IDENTITY_PROOF');
  if (attribution.completeness === 'COMPLETE'
      && (!attribution.accountingIdentityProven || estimatedRanges.length > 0
        || (attribution.missingComponentKinds as unknown[]).length > 0 || (attribution.divergentReasons as unknown[]).length > 0)) {
    reasons.push('ECONOMICS_FALSE_COMPLETE');
  }
  return Object.freeze([...new Set(reasons)]);
}

const NESTED_EXACT_DECIMAL_FIELDS: Readonly<Record<string, boolean>> = Object.freeze({
  amount: false,
  absoluteDirectionalExposureReduction: true,
  baseQuantity: false,
  consumedAmount: true,
  currentNetDirectionalExposure: false,
  currentTotalExposure: true,
  economicCostOfWaiting: true,
  expectedCostOfActing: true,
  hedgeRatio: false,
  high: false,
  liquidityRequirement: true,
  low: false,
  maximumAdditionalExposure: true,
  maximumExposure: true,
  maximumNakedLegAmount: true,
  maximumNotional: true,
  maximumTotalExposure: true,
  netDirectionalExposure: false,
  netKnown: false,
  oneLegExposure: true,
  quantity: true,
  quoteExposure: true,
  quoteNotional: false,
  remainingReservedAmount: true,
  reservationConsumption: true,
  targetHedgeRatio: false,
  targetNetDirectionalExposure: false,
  targetTotalExposure: true,
  targetMaximumExposure: true,
  totalGrossExposure: true,
});

function validateNestedExactDecimals(
  value: unknown,
  path = '$',
  seen = new Set<object>(),
): readonly string[] {
  if (!object(value) && !Array.isArray(value)) return Object.freeze([]);
  if (seen.has(value as object)) return Object.freeze(['FINANCIAL_FIELD_CYCLIC']);
  seen.add(value as object);
  const reasons: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => reasons.push(...validateNestedExactDecimals(entry, `${path}[${index}]`, seen)));
  } else {
    for (const [key, entry] of Object.entries(value)) {
      const nonNegative = NESTED_EXACT_DECIMAL_FIELDS[key];
      if (nonNegative !== undefined && entry !== null && !exact(entry, nonNegative)) {
        reasons.push(`FINANCIAL_FIELD_INVALID:${path}.${key}`);
      }
      reasons.push(...validateNestedExactDecimals(entry, `${path}.${key}`, seen));
    }
  }
  seen.delete(value as object);
  return Object.freeze(reasons);
}

function validateCheckpointRecord(kind: CapitalCheckpointEventKind, value: unknown): readonly string[] {
  if (!object(value)) return Object.freeze(['RECORD_OBJECT_REQUIRED']);
  const reasons: string[] = [...validateNestedExactDecimals(value)];
  if (!nonEmpty(value.id)) reasons.push('RECORD_ID_INVALID');
  switch (kind) {
    case 'RESERVATION_UPSERTED':
      if (!validRevision(value.revision)) reasons.push('RESERVATION_REVISION_INVALID');
      if (!nonEmpty(value.allocationDecisionId) || !nonEmpty(value.considerationId)
          || !nonEmpty(value.valuationAsset) || !nonEmpty(value.idempotencyKey)) reasons.push('RESERVATION_BINDING_INVALID');
      if (!exact(value.amount, true) || !exact(value.consumedAmount, true)) reasons.push('RESERVATION_DECIMAL_INVALID');
      if (!validTimes(value, ['createdAtMs', 'expiresAtMs'], ['releasedAtMs'])
        || (isValidUtcMillis(value.createdAtMs) && isValidUtcMillis(value.expiresAtMs) && value.expiresAtMs <= value.createdAtMs)) reasons.push('RESERVATION_TIME_INVALID');
      if (!['ACTIVE', 'RELEASED', 'EXPIRED'].includes(String(value.state))) reasons.push('RESERVATION_STATE_INVALID');
      if (value.state === 'ACTIVE' && value.releasedAtMs !== null) reasons.push('ACTIVE_RESERVATION_RELEASE_TIME_INVALID');
      if (exact(value.amount, true) && exact(value.consumedAmount, true)
        && compareExactDecimals(value.consumedAmount as ExactDecimal, value.amount as ExactDecimal) > 0) reasons.push('RESERVATION_CONSUMPTION_EXCEEDS_AMOUNT');
      break;
    case 'MANDATE_UPSERTED':
      if (!validRevision(value.revision)) reasons.push('MANDATE_REVISION_INVALID');
      if (!exact(value.targetMaximumExposure, true)) reasons.push('MANDATE_DECIMAL_INVALID');
      if (!validTimes(value, ['createdAtMs', 'expiresAtMs'])
        || (isValidUtcMillis(value.createdAtMs) && isValidUtcMillis(value.expiresAtMs) && value.expiresAtMs <= value.createdAtMs)) reasons.push('MANDATE_TIME_INVALID');
      reasons.push(...validateMandateRecord(value));
      break;
    case 'STAGED_PLAN_UPSERTED':
      if (!validRevision(value.revision)) reasons.push('STAGED_PLAN_REVISION_INVALID');
      if (!exact(value.remainingReservedAmount, true)) reasons.push('STAGED_PLAN_DECIMAL_INVALID');
      if (!validTimes(value, ['createdAtMs', 'expiresAtMs'])
        || (isValidUtcMillis(value.createdAtMs) && isValidUtcMillis(value.expiresAtMs) && value.expiresAtMs <= value.createdAtMs)) reasons.push('STAGED_PLAN_TIME_INVALID');
      reasons.push(...validateStagedPlanRecord(value));
      break;
    case 'APPROVAL_UPSERTED':
      if (!exact(value.maximumNotional, true)) reasons.push('APPROVAL_DECIMAL_INVALID');
      if (!validTimes(value, ['issuedAtMs', 'expiresAtMs'], ['revokedAtMs'])
        || (isValidUtcMillis(value.issuedAtMs) && isValidUtcMillis(value.expiresAtMs) && value.expiresAtMs <= value.issuedAtMs)) reasons.push('APPROVAL_TIME_INVALID');
      if (!['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY', 'MANUAL_ARMED'].includes(String(value.mode))) reasons.push('APPROVAL_MODE_INVALID');
      reasons.push(...validateOperatorApproval(value).map((issue) => `APPROVAL_${issue.path}:${issue.code}`));
      break;
    case 'APPROVAL_REVOKED':
      if (!validRevision(value.revision)) reasons.push('REVOCATION_REVISION_INVALID');
      if (!nonEmpty(value.approvalId) || !isValidUtcMillis(value.revokedAtMs) || !nonEmpty(value.reasonReference)) reasons.push('REVOCATION_INVALID');
      break;
    case 'THESIS_UPSERTED':
      if (!validRevision(value.revision) || !isValidUtcMillis(value.openedAtMs)) reasons.push('THESIS_REVISION_OR_TIME_INVALID');
      reasons.push(...validateThesisRecord(value));
      break;
    case 'POSITION_UPSERTED':
      if (!validRevision(value.revision)) reasons.push('POSITION_REVISION_INVALID');
      if (!(POSITION_STATES as readonly unknown[]).includes(value.state)) reasons.push('POSITION_STATE_INVALID');
      if (!isCapitalLifecycleState(value.capitalLifecycle)) reasons.push('POSITION_LIFECYCLE_INVALID');
      if (!exact(value.totalGrossExposure, true) || !exact(value.netDirectionalExposure, false) || !exact(value.oneLegExposure, true)) reasons.push('POSITION_DECIMAL_INVALID');
      if (!validTimes(value, ['openedAtMs', 'lastTransitionAtMs'], ['oneLegSinceMs'])) reasons.push('POSITION_TIME_INVALID');
      reasons.push(...validatePositionRecord(value));
      break;
    case 'RECONCILIATION_UPSERTED':
      if (!isReconciliationStatus(value.status) || !isValidUtcMillis(value.observedAtMs)) reasons.push('RECONCILIATION_INVALID');
      reasons.push(...validateReconciliationRecord(value));
      break;
    case 'ACTION_INTENT_UPSERTED':
      reasons.push(...validateActionIntentRecord(value));
      break;
    case 'ECONOMICS_UPSERTED': {
      if (!validRevision(value.revision) || !nonEmpty(value.positionId) || !object(value.attribution)) reasons.push('ECONOMICS_RECORD_INVALID');
      else reasons.push(...validateEconomicRecord(value));
      break;
    }
    case 'LIFECYCLE_REVISED':
      if (!validRevision(value.revision) || !isCapitalLifecycleState(value.state) || !isValidUtcMillis(value.lastTransitionAtMs) || !nonEmpty(value.aggregateId) || !nonEmpty(value.correlationId, 128)) reasons.push('LIFECYCLE_RECORD_INVALID');
      break;
  }
  return Object.freeze([...new Set(reasons)]);
}

function byId<T extends { readonly id: string }>(rows: readonly T[], id: string): T | undefined {
  return rows.find((row) => row.id === id);
}

function upsert<T extends { readonly id: string }>(rows: readonly T[], value: T): readonly T[] {
  return Object.freeze([...rows.filter((row) => row.id !== value.id), value].sort((left, right) => compareText(left.id, right.id)));
}

function revisionOf(value: unknown): number | null {
  return object(value) && validRevision(value.revision) ? value.revision : null;
}

function terminalReservation(value: CapitalReservation, nowMs: number): boolean {
  return value.state === 'RELEASED' || value.state === 'EXPIRED' || value.expiresAtMs <= nowMs;
}

function maximumPlanExposure(plan: Record<string, unknown>): ExactDecimal | null {
  if (!Array.isArray(plan.stages) || plan.stages.length === 0) return null;
  let maximum: ExactDecimal = '0' as ExactDecimal;
  for (const step of plan.stages) {
    if (!object(step) || !exact(step.maximumTotalExposure, true)) return null;
    if (compareExactDecimals(step.maximumTotalExposure as ExactDecimal, maximum) > 0) {
      maximum = step.maximumTotalExposure as ExactDecimal;
    }
  }
  return maximum;
}

function planReservationConsumption(plan: Record<string, unknown>): ExactDecimal | null {
  if (!Array.isArray(plan.stages)) return null;
  const values: ExactDecimal[] = [];
  for (const step of plan.stages) {
    if (!object(step) || !exact(step.reservationConsumption, true)) return null;
    values.push(step.reservationConsumption as ExactDecimal);
  }
  return sumExactDecimals(values);
}

function recordBindingIssues(
  kind: CapitalCheckpointEventKind,
  state: Readonly<CapitalCheckpointState>,
  record: CapitalCheckpointRecord,
): readonly string[] {
  const value = record as unknown as Record<string, unknown>;
  const reasons: string[] = [];
  if (kind === 'STAGED_PLAN_UPSERTED') {
    const reservation = state.reservations.find((entry) => entry.id === value.reservationId);
    if (reservation === undefined) return Object.freeze(['STAGED_PLAN_RESERVATION_MISSING']);
    const remaining = addExactDecimals(reservation.amount, normalizeExactDecimal(`-${reservation.consumedAmount}`));
    const plannedConsumption = planReservationConsumption(value);
    if (value.reservationRevision !== reservation.revision || value.reservationConsiderationId !== reservation.considerationId
        || value.valuationAsset !== reservation.valuationAsset || value.remainingReservedAmount !== remaining
        || plannedConsumption === null || compareExactDecimals(plannedConsumption, reservation.amount) > 0
        || (value.createdAtMs as number) < reservation.createdAtMs || (value.expiresAtMs as number) > reservation.expiresAtMs) {
      reasons.push('STAGED_PLAN_RESERVATION_BINDING_INVALID');
    }
  } else if (kind === 'MANDATE_UPSERTED') {
    const reservation = state.reservations.find((entry) => entry.id === value.reservationId);
    const plan = state.stagedPlans.find((entry) => entry.id === value.stagedPlanId) as unknown as Record<string, unknown> | undefined;
    if (reservation === undefined || plan === undefined) return Object.freeze(['MANDATE_DEPENDENCY_MISSING']);
    const maximum = maximumPlanExposure(plan);
    if (value.allocationDecisionId !== reservation.allocationDecisionId || value.considerationId !== reservation.considerationId
        || plan.reservationId !== reservation.id || value.stagedPlanRevision !== plan.revision
        || value.stagedPlanDigest !== plan.digest || value.proposalIntakeDigest !== plan.proposalIntakeDigest
        || value.configRevision !== plan.configRevision || value.valuationAsset !== reservation.valuationAsset
        || value.valuationAsset !== plan.valuationAsset || maximum === null || value.targetMaximumExposure !== maximum
        || (value.expiresAtMs as number) > (plan.expiresAtMs as number)
        || (value.expiresAtMs as number) > reservation.expiresAtMs) reasons.push('MANDATE_DEPENDENCY_BINDING_INVALID');
  } else if (kind === 'APPROVAL_UPSERTED') {
    const mandate = state.mandates.find((entry) => entry.id === value.mandateId) as unknown as Record<string, unknown> | undefined;
    const plan = state.stagedPlans.find((entry) => entry.id === value.stagedPlanId) as unknown as Record<string, unknown> | undefined;
    const reservation = mandate === undefined ? undefined : state.reservations.find((entry) => entry.id === mandate.reservationId);
    if (mandate === undefined && plan === undefined && reservation === undefined) return Object.freeze([]);
    if (mandate === undefined || plan === undefined || reservation === undefined) return Object.freeze(['APPROVAL_DEPENDENCY_MISSING']);
    if (value.mandateRevision !== mandate.revision || value.mandateDigest !== mandate.digest
        || value.proposalIntakeDigest !== mandate.proposalIntakeDigest
        || value.stagedPlanId !== mandate.stagedPlanId || value.stagedPlanRevision !== mandate.stagedPlanRevision
        || value.stagedPlanDigest !== mandate.stagedPlanDigest || value.stagedPlanRevision !== plan.revision
        || value.stagedPlanDigest !== plan.digest || value.configRevision !== mandate.configRevision
        || value.valuationAsset !== mandate.valuationAsset || compareExactDecimals(value.maximumNotional as ExactDecimal, mandate.targetMaximumExposure as ExactDecimal) > 0
        || (value.expiresAtMs as number) > (mandate.expiresAtMs as number)
        || (value.expiresAtMs as number) > (plan.expiresAtMs as number)
        || (value.expiresAtMs as number) > reservation.expiresAtMs) reasons.push('APPROVAL_DEPENDENCY_BINDING_INVALID');
  } else if (kind === 'POSITION_UPSERTED') {
    const mandate = state.mandates.find((entry) => entry.id === value.mandateId);
    if (mandate === undefined || (value.openedAtMs as number) < mandate.createdAtMs) reasons.push('POSITION_MANDATE_BINDING_INVALID');
  } else if (kind === 'ACTION_INTENT_UPSERTED') {
    const position = state.positions.find((entry) => entry.id === value.positionId);
    if (position === undefined || value.sourcePositionRevision !== position.revision
        || value.sourceThesisId !== position.thesis.id || value.sourceThesisRevision !== position.thesis.revision) {
      reasons.push('INTENT_POSITION_BINDING_INVALID');
    } else if (value.kind === 'ADD_STAGE' && object(value.stageTransitionAuthorization) && object(value.target)) {
      const authorization = value.stageTransitionAuthorization;
      const plan = state.stagedPlans.find((entry) => entry.id === authorization.planId) as unknown as Record<string, unknown> | undefined;
      const reservation = state.reservations.find((entry) => entry.id === authorization.reservationId);
      const approval = state.approvals.find((entry) => entry.id === authorization.approvalId);
      const increase = value.target.kind === 'TOTAL' && exact(value.target.quoteNotional, true)
        ? subtractExactDecimals(value.target.quoteNotional as ExactDecimal, position.totalGrossExposure)
        : null;
      if (plan === undefined || reservation === undefined || approval === undefined
          || plan.revision !== authorization.planRevision || plan.digest !== authorization.planDigest
          || reservation.revision !== authorization.reservationRevision || reservation.state !== 'ACTIVE'
          || approval.stagedPlanId !== plan.id || approval.stagedPlanRevision !== plan.revision
          || approval.stagedPlanDigest !== plan.digest || approval.id !== authorization.approvalId
          || value.target.valuationAsset !== reservation.valuationAsset || increase === null
          || increase !== authorization.reservationConsumption) reasons.push('INTENT_ADD_AUTHORITY_BINDING_INVALID');
    } else if (value.kind === 'REDUCE' && object(value.directionalReductionGeometry)) {
      const geometry = value.directionalReductionGeometry;
      if (geometry.currentTotalExposure !== position.totalGrossExposure
          || geometry.currentNetDirectionalExposure !== position.netDirectionalExposure) {
        reasons.push('INTENT_REDUCTION_POSITION_BINDING_INVALID');
      }
    }
  } else if (kind === 'ECONOMICS_UPSERTED') {
    if (!state.positions.some((entry) => entry.id === value.positionId)) reasons.push('ECONOMICS_POSITION_MISSING');
  } else if (kind === 'LIFECYCLE_REVISED') {
    const known = state.positions.some((entry) => entry.id === value.aggregateId)
      || state.mandates.some((entry) => entry.id === value.aggregateId)
      || state.stagedPlans.some((entry) => entry.id === value.aggregateId)
      || state.reservations.some((entry) => entry.id === value.aggregateId);
    if (!known) reasons.push('LIFECYCLE_AGGREGATE_MISSING');
  }
  return Object.freeze([...new Set(reasons)]);
}

function recordConflict(
  kind: CapitalCheckpointEventKind,
  state: CapitalCheckpointState,
  record: CapitalCheckpointRecord,
  nowMs: number,
): string | null {
  const id = record.id;
  const collection: readonly { readonly id: string }[] = kind === 'RESERVATION_UPSERTED' ? state.reservations
    : kind === 'MANDATE_UPSERTED' ? state.mandates
      : kind === 'STAGED_PLAN_UPSERTED' ? state.stagedPlans
        : kind === 'APPROVAL_UPSERTED' ? state.approvals
          : kind === 'APPROVAL_REVOKED' ? state.revocations
            : kind === 'THESIS_UPSERTED' ? state.theses
              : kind === 'POSITION_UPSERTED' ? state.positions
                : kind === 'RECONCILIATION_UPSERTED' ? state.reconciliationReferences
                  : kind === 'ACTION_INTENT_UPSERTED' ? state.intents
                    : kind === 'ECONOMICS_UPSERTED' ? state.economics
                      : state.lifecycles;
  const existing = byId(collection, id);
  if (!existing) return null;
  const oldRevision = revisionOf(existing);
  const nextRevision = revisionOf(record);
  if (oldRevision !== null && (nextRevision === null || nextRevision <= oldRevision)) return 'RECORD_REVISION_NOT_MONOTONIC';
  if (kind === 'RESERVATION_UPSERTED' && terminalReservation(existing as CapitalReservation, nowMs)
    && (record as CapitalReservation).state === 'ACTIVE') return 'RESERVATION_RESURRECTION_FORBIDDEN';
  if (kind === 'APPROVAL_UPSERTED') {
    const prior = existing as CapitalCheckpointState['approvals'][number];
    if (prior.revokedAtMs !== null || prior.expiresAtMs <= nowMs) return 'APPROVAL_RESURRECTION_FORBIDDEN';
    if (canonicalJson(prior) !== canonicalJson(record)) return 'APPROVAL_REPLACEMENT_FORBIDDEN';
  }
  if (kind === 'POSITION_UPSERTED' && (existing as ActivePosition).state === 'CLOSED'
    && (record as ActivePosition).state !== 'CLOSED') return 'POSITION_RESURRECTION_FORBIDDEN';
  if (kind === 'LIFECYCLE_REVISED') {
    const prior = existing as CapitalLifecycleRecord;
    const next = record as CapitalLifecycleRecord;
    if (prior.aggregateId !== next.aggregateId) return 'LIFECYCLE_AGGREGATE_CHANGED';
    if (prior.state !== next.state && !canTransitionCapitalLifecycle(prior.state, next.state)) return 'ILLEGAL_LIFECYCLE_TRANSITION';
  }
  return null;
}

function addRecord(
  state: CapitalCheckpointState,
  kind: CapitalCheckpointEventKind,
  record: CapitalCheckpointRecord,
): Omit<CapitalCheckpointState, 'revision' | 'lastSequence' | 'updatedAtMs' | 'eventLog' | 'processedEventIds'> {
  return {
    streamId: state.streamId,
    reservations: kind === 'RESERVATION_UPSERTED' ? upsert(state.reservations, record as CapitalReservation) : state.reservations,
    mandates: kind === 'MANDATE_UPSERTED' ? upsert(state.mandates, record as CapitalCheckpointState['mandates'][number]) : state.mandates,
    stagedPlans: kind === 'STAGED_PLAN_UPSERTED' ? upsert(state.stagedPlans, record as CapitalCheckpointState['stagedPlans'][number]) : state.stagedPlans,
    approvals: kind === 'APPROVAL_UPSERTED' ? upsert(state.approvals, record as CapitalCheckpointState['approvals'][number]) : state.approvals,
    revocations: kind === 'APPROVAL_REVOKED' ? upsert(state.revocations, record as ApprovalRevocationRecord) : state.revocations,
    theses: kind === 'THESIS_UPSERTED' ? upsert(state.theses, record as CapitalCheckpointState['theses'][number]) : state.theses,
    positions: kind === 'POSITION_UPSERTED' ? upsert(state.positions, record as ActivePosition) : state.positions,
    reconciliationReferences: kind === 'RECONCILIATION_UPSERTED' ? upsert(state.reconciliationReferences, record as ExternalReconciliationReference) : state.reconciliationReferences,
    intents: kind === 'ACTION_INTENT_UPSERTED' ? upsert(state.intents, record as CapitalCheckpointState['intents'][number]) : state.intents,
    economics: kind === 'ECONOMICS_UPSERTED' ? upsert(state.economics, record as PositionEconomicsRecord) : state.economics,
    lifecycles: kind === 'LIFECYCLE_REVISED' ? upsert(state.lifecycles, record as CapitalLifecycleRecord) : state.lifecycles,
  };
}

export function applyCapitalCheckpointEvent(
  state: Readonly<CapitalCheckpointState>,
  event: Readonly<CapitalCheckpointEvent>,
): CapitalCheckpointResult<CapitalCheckpointState> {
  const issues = validateCapitalCheckpointEvent(event);
  if (issues.length > 0) {
    const failureAt = isValidUtcMillis(event.occurredAtMs) ? event.occurredAtMs : (state.updatedAtMs ?? 0);
    const failureCorrelation = nonEmpty(event.correlationId, 128) ? event.correlationId : 'checkpoint-event-invalid';
    return failure('CHECKPOINT_EVENT_INVALID', issues.join(','), failureAt, failureCorrelation, `REVISION_${state.revision}`);
  }
  if (event.streamId !== state.streamId) return failure('CHECKPOINT_STREAM_MISMATCH', 'event stream does not match projection stream', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  const duplicateIndex = state.processedEventIds.indexOf(event.id);
  if (duplicateIndex >= 0) {
    const prior = state.eventLog[duplicateIndex];
    if (canonicalJson(prior) !== canonicalJson(event)) return failure('DUPLICATE_EVENT_CONFLICT', 'duplicate event ID carries different content', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
    return ok(state);
  }
  if (event.sequence !== state.lastSequence + 1) return failure('EVENT_SEQUENCE_NOT_MONOTONIC', 'unique event sequence must advance exactly once', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  if (state.updatedAtMs !== null && event.occurredAtMs < state.updatedAtMs) {
    return failure('EVENT_TIME_NOT_MONOTONIC', 'unique event time cannot move backward within a stream', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  }
  let record: CapitalCheckpointRecord;
  try {
    record = decodeCapitalCheckpointEventRecord(event);
  } catch {
    return failure('CHECKPOINT_EVENT_RECORD_INVALID', 'event record could not be decoded', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  }
  const recordIssues = validateCheckpointRecord(event.kind, record);
  if (recordIssues.length > 0) return failure('CHECKPOINT_RECORD_INVALID', recordIssues.join(','), event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  const bindingIssues = recordBindingIssues(event.kind, state, record);
  if (bindingIssues.length > 0) return failure('CHECKPOINT_RECORD_BINDING_INVALID', bindingIssues.join(','), event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  if (event.kind === 'RESERVATION_UPSERTED') {
    const reservation = record as CapitalReservation;
    if (reservation.state === 'ACTIVE' && reservation.expiresAtMs <= event.occurredAtMs) {
      return failure('RESERVATION_ALREADY_EXPIRED', 'an active reservation must outlive the event that records it', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
    }
  }
  const conflict = recordConflict(event.kind, state, record, event.occurredAtMs);
  if (conflict !== null) return failure(conflict, 'record update violates monotonic or terminal-state law', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  if (event.kind === 'APPROVAL_UPSERTED') {
    const approval = record as CapitalCheckpointState['approvals'][number];
    if (state.revocations.some((item) => item.approvalId === approval.id)) return failure('APPROVAL_RESURRECTION_FORBIDDEN', 'revoked approval cannot be reintroduced', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  }
  if (event.kind === 'APPROVAL_REVOKED') {
    const revocation = record as ApprovalRevocationRecord;
    if (!state.approvals.some((approval) => approval.id === revocation.approvalId)) return failure('APPROVAL_FOR_REVOCATION_MISSING', 'revocation must reference a known approval', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
  }
  const collections = addRecord(state, event.kind, record);
  return ok(deepFreeze({
    ...collections,
    revision: state.revision + 1,
    lastSequence: event.sequence,
    updatedAtMs: event.occurredAtMs,
    eventLog: [...state.eventLog, event],
    processedEventIds: [...state.processedEventIds, event.id],
  }));
}

export function replayCapitalCheckpointEvents(
  streamId: string,
  events: readonly Readonly<CapitalCheckpointEvent>[],
): CapitalCheckpointResult<CapitalCheckpointState> {
  let state = createEmptyCapitalCheckpointState(streamId);
  const byEventId = new Map<string, CapitalCheckpointEvent>();
  for (const event of events) {
    const prior = byEventId.get(event.id);
    if (prior && canonicalJson(prior) !== canonicalJson(event)) return failure('DUPLICATE_EVENT_CONFLICT', 'same event ID has conflicting content', event.occurredAtMs, event.correlationId, `REVISION_${state.revision}`);
    if (!prior) byEventId.set(event.id, event);
  }
  const ordered = [...byEventId.values()].sort((left, right) => left.sequence - right.sequence || compareText(left.id, right.id));
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1].sequence === ordered[index].sequence) return failure('EVENT_SEQUENCE_CONFLICT', 'two unique events claim one sequence', ordered[index].occurredAtMs, ordered[index].correlationId, `REVISION_${state.revision}`);
  }
  for (const event of ordered) {
    const applied = applyCapitalCheckpointEvent(state, event);
    if (!applied.ok) return applied;
    state = applied.value;
  }
  return ok(state);
}

function checkpointPayload(state: Readonly<CapitalCheckpointState>): Omit<CapitalCheckpoint, 'checksum'> {
  const stateDigest = stableHash128Hex(canonicalJson(state));
  return {
    schema: CAPITAL_CHECKPOINT_SCHEMA,
    version: CAPITAL_CHECKPOINT_VERSION,
    id: deriveCapitalCheckpointId({ streamId: state.streamId, revision: state.revision, stateDigest }),
    streamId: state.streamId,
    revision: state.revision,
    state,
  };
}

export function createCapitalCheckpoint(state: Readonly<CapitalCheckpointState>): Readonly<CapitalCheckpoint> {
  const replayed = replayCapitalCheckpointEvents(state.streamId, state.eventLog);
  if (!replayed.ok || canonicalJson(replayed.value) !== canonicalJson(state)) throw new TypeError('capital checkpoint state does not match deterministic event replay');
  const payload = checkpointPayload(state);
  return deepFreeze({ ...payload, checksum: stableHash128Hex(canonicalJson(payload)) });
}

export function serializeCapitalCheckpoint(state: Readonly<CapitalCheckpointState>): string {
  return canonicalJson(createCapitalCheckpoint(state));
}

function hasPositiveExposure(position: ActivePosition): boolean {
  return compareExactDecimals(position.totalGrossExposure, '0' as ExactDecimal) > 0
    || compareExactDecimals(position.oneLegExposure, '0' as ExactDecimal) > 0
    || position.legs.some((leg) => compareExactDecimals(leg.quoteExposure, '0' as ExactDecimal) > 0);
}

function exposed(position: ActivePosition): boolean {
  return hasPositiveExposure(position);
}

function truthAllowsAt(truth: unknown, nowMs: number): boolean {
  if (!validTruthMetadata(truth)) return false;
  try {
    const current = assessCapitalTruth({
      source: (truth as Record<string, unknown>).source as never,
      evaluatedAtMs: nowMs,
      requiredValuePresent: (truth as Record<string, unknown>).completeness !== 'UNKNOWN',
      divergent: (truth as Record<string, unknown>).completeness === 'DIVERGENT',
      reasons: (truth as Record<string, unknown>).reasons as readonly string[],
      evidenceReferences: (truth as Record<string, unknown>).evidenceReferences as readonly string[],
      revision: (truth as Record<string, unknown>).revision as string | null,
    });
    const completeness = weakestCapitalTruth([
      (truth as Record<string, unknown>).completeness as never,
      current.completeness,
    ]);
    return completeness === 'COMPLETE' && truthAllowsNewExposure(current);
  } catch {
    return false;
  }
}

function reconciliationConflict(
  checkpoint: ExternalReconciliationReference | null,
  current: ExternalReconciliationReference | null,
): boolean {
  if (checkpoint?.status === 'DIVERGED' || checkpoint?.status === 'AMBIGUOUS') return true;
  if (current?.status === 'DIVERGED' || current?.status === 'AMBIGUOUS') return true;
  if (checkpoint === null || current === null) return true;
  if (checkpoint.externalPlanId !== current.externalPlanId || checkpoint.correlationId !== current.correlationId) return true;
  if (checkpoint.sequence !== null && current.sequence !== null) {
    if (current.sequence < checkpoint.sequence) return true;
    if (current.sequence > checkpoint.sequence) return false;
    return checkpoint.status !== current.status
      || checkpoint.revision !== current.revision
      || current.observedAtMs < checkpoint.observedAtMs;
  }
  return checkpoint.sequence !== null || current.sequence !== null
    || checkpoint.revision === null || current.revision === null
    || checkpoint.revision !== current.revision
    || current.observedAtMs < checkpoint.observedAtMs
    || checkpoint.status !== current.status;
}

function usableApprovalIds(
  state: Readonly<CapitalCheckpointState>,
  nowMs: number,
): readonly OperatorApprovalId[] {
  const revocations = new Set(state.revocations.map((item) => item.approvalId));
  return Object.freeze(state.approvals.filter((approval) => {
    if (approval.mode !== 'MANUAL_ARMED' || approval.revokedAtMs !== null || revocations.has(approval.id)
      || approval.issuedAtMs > nowMs || approval.expiresAtMs <= nowMs) return false;
    const mandate = state.mandates.find((item) => item.id === approval.mandateId);
    const plan = state.stagedPlans.find((item) => item.id === approval.stagedPlanId);
    const reservation = mandate === undefined
      ? undefined
      : state.reservations.find((item) => item.id === mandate.reservationId);
    if (!mandate || !plan || !reservation || mandate.expiresAtMs <= nowMs || plan.expiresAtMs <= nowMs
      || reservation.state !== 'ACTIVE' || reservation.releasedAtMs !== null || reservation.expiresAtMs <= nowMs) return false;
    try {
      if (compareExactDecimals(approval.maximumNotional, mandate.targetMaximumExposure) > 0) return false;
    } catch {
      return false;
    }
    return mandate.revision === approval.mandateRevision
      && mandate.digest === approval.mandateDigest
      && mandate.proposalIntakeDigest === approval.proposalIntakeDigest
      && mandate.stagedPlanId === approval.stagedPlanId
      && mandate.stagedPlanRevision === approval.stagedPlanRevision
      && mandate.stagedPlanDigest === approval.stagedPlanDigest
      && mandate.configRevision === approval.configRevision
      && mandate.valuationAsset === approval.valuationAsset
      && approval.expiresAtMs <= mandate.expiresAtMs
      && approval.expiresAtMs <= plan.expiresAtMs
      && approval.expiresAtMs <= reservation.expiresAtMs
      && plan.id === approval.stagedPlanId
      && plan.reservationId === mandate.reservationId
      && plan.revision === approval.stagedPlanRevision
      && plan.digest === approval.stagedPlanDigest;
  }).map((approval) => approval.id).sort()) as readonly OperatorApprovalId[];
}

export function projectRestartSafety(
  state: Readonly<CapitalCheckpointState>,
  input: RestartTruthInput,
): Readonly<RestoredCapitalProjection> {
  if (!isValidUtcMillis(input.nowMs) || !nonEmpty(input.correlationId, 128)) throw new TypeError('restart projection requires injected UTC time and correlation ID');
  let stateMatchesReplay = false;
  try {
    const replayed = replayCapitalCheckpointEvents(state.streamId, state.eventLog);
    stateMatchesReplay = replayed.ok && canonicalJson(replayed.value) === canonicalJson(state);
  } catch {
    stateMatchesReplay = false;
  }
  const effectiveReservations = state.reservations.map((reservation) => reservation.state === 'ACTIVE' && reservation.expiresAtMs <= input.nowMs
    ? deepFreeze({ ...reservation, state: 'EXPIRED' as const })
    : reservation);
  const recoveryIds: ActivePositionId[] = [];
  const recoveryReasons: string[] = [];
  let effectivePositions = state.positions.map((position) => {
    if (position.state === 'CLOSED' && hasPositiveExposure(position)) {
      recoveryIds.push(position.id);
      recoveryReasons.push('CLOSED_POSITION_HAS_EXPOSURE');
      return deepFreeze({ ...position, state: 'RECOVERY_REQUIRED' as const, capitalLifecycle: 'RECOVERY_REQUIRED' as const });
    }
    if (!exposed(position)) return position;
    const checkpointRef = position.reconciliationReference;
    if (checkpointRef === null) {
      recoveryIds.push(position.id);
      recoveryReasons.push('POSITION_RECONCILIATION_REFERENCE_MISSING');
      return deepFreeze({ ...position, state: 'RECOVERY_REQUIRED' as const, capitalLifecycle: 'RECOVERY_REQUIRED' as const });
    }
    const matches = input.reconciliationReferences.filter((item) => item.externalPlanId === checkpointRef.externalPlanId);
    if (matches.length !== 1) {
      recoveryIds.push(position.id);
      recoveryReasons.push(matches.length === 0
        ? 'POSITION_RECONCILIATION_REFERENCE_MISSING'
        : 'POSITION_RECONCILIATION_REFERENCE_DUPLICATE');
      return deepFreeze({ ...position, state: 'RECOVERY_REQUIRED' as const, capitalLifecycle: 'RECOVERY_REQUIRED' as const });
    }
    const current = matches[0];
    const conflicts = reconciliationConflict(checkpointRef, current);
    if (validateReconciliationRecord(current as unknown as Record<string, unknown>).length > 0
        || current.status !== 'EXACT' || !truthAllowsAt(current.truth, input.nowMs) || conflicts) {
      recoveryIds.push(position.id);
      if (current.status !== 'EXACT') recoveryReasons.push('POSITION_RECONCILIATION_NOT_EXACT');
      if (!truthAllowsAt(current.truth, input.nowMs)) recoveryReasons.push('POSITION_RECONCILIATION_TRUTH_NOT_FRESH');
      if (conflicts) recoveryReasons.push('CHECKPOINT_RECONCILIATION_CONFLICT');
      return deepFreeze({ ...position, state: 'RECOVERY_REQUIRED' as const, capitalLifecycle: 'RECOVERY_REQUIRED' as const });
    }
    return position;
  });
  if (!stateMatchesReplay) {
    recoveryReasons.push('CHECKPOINT_STATE_REPLAY_INVALID');
    effectivePositions = effectivePositions.map((position) => {
      if (!exposed(position)) return position;
      if (!recoveryIds.includes(position.id)) recoveryIds.push(position.id);
      return position.state === 'RECOVERY_REQUIRED' && position.capitalLifecycle === 'RECOVERY_REQUIRED'
        ? position
        : deepFreeze({ ...position, state: 'RECOVERY_REQUIRED' as const, capitalLifecycle: 'RECOVERY_REQUIRED' as const });
    });
  }
  const visiblePositionIds = effectivePositions.filter(exposed).map((position) => position.id);
  const accountFresh = input.accountTruth !== null && truthAllowsAt(input.accountTruth, input.nowMs);
  const reconciliationFresh = input.reconciliationTruth !== null && truthAllowsAt(input.reconciliationTruth, input.nowMs);
  const reasonCodes: string[] = [];
  if (!accountFresh) reasonCodes.push('RESTART_ACCOUNT_TRUTH_NOT_FRESH');
  if (!reconciliationFresh) reasonCodes.push('RESTART_RECONCILIATION_TRUTH_NOT_FRESH');
  reasonCodes.push(...recoveryReasons);
  const outstandingIntentIds = new Set(effectivePositions.flatMap((position) => position.outstandingActionIntentIds));
  const outstandingIntents = state.intents.filter((intent) => outstandingIntentIds.has(intent.id));
  const blockedIncreasing = outstandingIntents.filter((intent) => intent.riskEffect === 'RISK_INCREASING').map((intent) => intent.id);
  const allowedReduction = outstandingIntents.filter((intent) => intent.riskEffect !== 'RISK_INCREASING').map((intent) => intent.id);
  const safety: RestartSafetyProjection = {
    evaluatedAtMs: input.nowMs,
    canOpenOrIncrease: stateMatchesReplay && accountFresh && reconciliationFresh && recoveryIds.length === 0,
    supervisionContinues: visiblePositionIds.length > 0,
    reasonCodes: sortedUnique(reasonCodes),
    visiblePositionIds: Object.freeze([...visiblePositionIds].sort()),
    recoveryRequiredPositionIds: Object.freeze([...recoveryIds].sort()),
    usableApprovalIds: stateMatchesReplay ? usableApprovalIds(state, input.nowMs) : Object.freeze([]),
    effectiveActiveReservationIds: Object.freeze(effectiveReservations.filter((item) => item.state === 'ACTIVE').map((item) => item.id).sort()),
    effectiveExpiredReservationIds: Object.freeze(effectiveReservations.filter((item) => item.state === 'EXPIRED').map((item) => item.id).sort()),
    blockedRiskIncreasingIntentIds: Object.freeze(blockedIncreasing.sort()),
    allowedRiskReducingOrNeutralIntentIds: Object.freeze(allowedReduction.sort()),
  };
  return deepFreeze({
    checkpointId: checkpointPayload(state).id,
    checkpointState: state,
    effectiveReservations,
    effectivePositions,
    safety,
  });
}

export function restoreCapitalCheckpoint(
  input: RestoreCapitalCheckpointInput,
): CapitalCheckpointResult<RestoredCapitalProjection> {
  if (!isValidUtcMillis(input.nowMs) || !nonEmpty(input.correlationId, 128)) throw new TypeError('checkpoint restore requires injected UTC time and correlation ID');
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.serialized);
  } catch {
    return failure('CHECKPOINT_PARSE_FAILED', 'checkpoint is not valid JSON', input.nowMs, input.correlationId, 'UNKNOWN');
  }
  if (!object(parsed)) return failure('CHECKPOINT_SHAPE_INVALID', 'checkpoint must be an object', input.nowMs, input.correlationId, 'UNKNOWN');
  const expectedKeys = ['checksum', 'id', 'revision', 'schema', 'state', 'streamId', 'version'];
  if (Object.keys(parsed).sort().join('|') !== expectedKeys.join('|')) return failure('CHECKPOINT_UNKNOWN_FIELD', 'checkpoint contains missing or unknown fields', input.nowMs, input.correlationId, 'UNKNOWN');
  if (parsed.schema !== CAPITAL_CHECKPOINT_SCHEMA || parsed.version !== CAPITAL_CHECKPOINT_VERSION) return failure('CHECKPOINT_SCHEMA_UNSUPPORTED', 'checkpoint schema or version is unsupported', input.nowMs, input.correlationId, 'UNKNOWN');
  const { checksum, ...payload } = parsed;
  if (typeof checksum !== 'string' || checksum !== stableHash128Hex(canonicalJson(payload))) return failure('CHECKPOINT_CHECKSUM_MISMATCH', 'checkpoint checksum does not match canonical payload', input.nowMs, input.correlationId, 'UNKNOWN');
  if (!object(parsed.state) || !Array.isArray(parsed.state.eventLog) || !nonEmpty(parsed.streamId) || parsed.state.streamId !== parsed.streamId || parsed.state.revision !== parsed.revision) {
    return failure('CHECKPOINT_STATE_INVALID', 'checkpoint state identity or event log is invalid', input.nowMs, input.correlationId, 'UNKNOWN');
  }
  const events = parsed.state.eventLog as CapitalCheckpointEvent[];
  const replayed = replayCapitalCheckpointEvents(parsed.streamId, events);
  if (!replayed.ok) return replayed as CapitalCheckpointResult<RestoredCapitalProjection>;
  if (canonicalJson(replayed.value) !== canonicalJson(parsed.state)) return failure('CHECKPOINT_REPLAY_MISMATCH', 'checkpoint snapshot differs from deterministic event replay', input.nowMs, input.correlationId, 'UNKNOWN');
  const expected = checkpointPayload(replayed.value);
  if (parsed.id !== expected.id) return failure('CHECKPOINT_ID_INVALID', 'checkpoint ID does not match state content', input.nowMs, input.correlationId, 'UNKNOWN');
  return ok(projectRestartSafety(replayed.value, input));
}

import {
  createStructuredFailure,
  fail,
  isValidUtcMillis,
  ok,
  type ContractResult,
} from '../../foundation/contracts/index.js';
import {
  APPROVAL_ACTION_CLASSES,
  CAPITAL_STAGES,
  addExactDecimals,
  assessCapitalTruth,
  canTransitionCapitalStage,
  capitalDigest,
  compareExactDecimals,
  deriveCapitalConfigRevision,
  deriveCapitalMandateId,
  deriveStagedPlanId,
  normalizeNonNegativeExactDecimal,
  subtractExactDecimals,
  sumExactDecimals,
  transitionCapitalStage,
  truthAllowsNewExposure,
  weakestCapitalTruth,
  type ApprovalActionClass,
  type CapitalMandate,
  type CapitalReservation,
  type CapitalStage,
  type ConfigRevisionId,
  type ExactDecimal,
  type ExactPolicyBound,
  type FutureGate,
  type IntegerPolicyBound,
  type NonNegativeDecimal,
  type TruthMetadata,
} from '../contracts/index.js';
import type {
  BuildCapitalMandateInput,
  BuildStagedPlanInput,
  EvaluateStageTransitionInput,
  GovernedStagedExposureStep,
  GovernedStagedPlan,
  ReviseCapitalMandateInput,
  ReviseStagedPlanInput,
  StageTransitionAuthorization,
  StagedPlanConfiguration,
  StagedPlanConfigurationDraft,
  StagedPlanRevisionReceipt,
} from './types.js';
import { evaluateOperatorApproval } from '../approvals/index.js';

type Prerequisite = GovernedStagedExposureStep['prerequisites'][number];
type NextRule = GovernedStagedExposureStep['nextStageConditions'][number];
type SkipRule = GovernedStagedExposureStep['skipConditions'][number];

const ZERO = '0' as NonNegativeDecimal;
const REQUIRED_INCREASE_GATES = [
  'OPERATOR_APPROVAL',
  'MULTI_LEG_RISK',
  'FRESH_ACCOUNT_TRUTH',
  'FRESH_MARKET_EVIDENCE',
] as const satisfies readonly FutureGate[];

function nonEmpty(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value;
}

function canonicalNonNegative(value: unknown): value is NonNegativeDecimal {
  try {
    return typeof value === 'string' && normalizeNonNegativeExactDecimal(value) === value;
  } catch {
    return false;
  }
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function compareText(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasDuplicates(values: readonly unknown[]): boolean {
  return new Set(values).size !== values.length;
}

function validStringSet(values: unknown): values is readonly string[] {
  return Array.isArray(values) && !hasDuplicates(values) && values.every((value) => nonEmpty(value));
}

function exactBoundIssues(name: string, bound: Readonly<ExactPolicyBound>): string[] {
  const issues: string[] = [];
  if (!canonicalNonNegative(bound?.value) || !canonicalNonNegative(bound?.minimum) || !canonicalNonNegative(bound?.maximum)) {
    return [`${name.toUpperCase()}_DECIMAL_INVALID`];
  }
  if (compareExactDecimals(bound.minimum, bound.maximum) > 0) issues.push(`${name.toUpperCase()}_RANGE_INVERTED`);
  if (compareExactDecimals(bound.value, bound.minimum) < 0 || compareExactDecimals(bound.value, bound.maximum) > 0) {
    issues.push(`${name.toUpperCase()}_OUT_OF_BOUNDS`);
  }
  if (!nonEmpty(bound.unit, 80)) issues.push(`${name.toUpperCase()}_UNIT_INVALID`);
  return issues;
}

function integerBoundIssues(name: string, bound: Readonly<IntegerPolicyBound>): string[] {
  const issues: string[] = [];
  if (!positiveInteger(bound?.value) || !positiveInteger(bound?.minimum) || !positiveInteger(bound?.maximum)) {
    return [`${name.toUpperCase()}_INTEGER_INVALID`];
  }
  if (bound.minimum > bound.maximum) issues.push(`${name.toUpperCase()}_RANGE_INVERTED`);
  if (bound.value < bound.minimum || bound.value > bound.maximum) issues.push(`${name.toUpperCase()}_OUT_OF_BOUNDS`);
  if (!nonEmpty(bound.unit, 80)) issues.push(`${name.toUpperCase()}_UNIT_INVALID`);
  return issues;
}

function configurationPayload(configuration: Omit<StagedPlanConfiguration, 'authority'> & {
  readonly sourceId: string;
  readonly issuedAtMs: number;
  readonly effectiveFromMs: number;
  readonly effectiveUntilMs: number | null;
}): unknown {
  return {
    sourceId: configuration.sourceId,
    issuedAtMs: configuration.issuedAtMs,
    effectiveFromMs: configuration.effectiveFromMs,
    effectiveUntilMs: configuration.effectiveUntilMs,
    maximumPlanExposure: configuration.maximumPlanExposure,
    maximumPlanDurationMs: configuration.maximumPlanDurationMs,
    maximumStageDurationMs: configuration.maximumStageDurationMs,
    maximumEvidenceAgeMs: configuration.maximumEvidenceAgeMs,
    maximumNakedLegAmount: configuration.maximumNakedLegAmount,
    maximumNakedLegDurationMs: configuration.maximumNakedLegDurationMs,
  };
}

function expectedConfigurationRevision(configuration: Readonly<StagedPlanConfiguration>): ConfigRevisionId {
  return deriveCapitalConfigRevision('staged-plan-policy', configurationPayload({
    sourceId: configuration.authority.sourceId,
    issuedAtMs: configuration.authority.issuedAtMs,
    effectiveFromMs: configuration.authority.effectiveFromMs,
    effectiveUntilMs: configuration.authority.effectiveUntilMs,
    maximumPlanExposure: configuration.maximumPlanExposure,
    maximumPlanDurationMs: configuration.maximumPlanDurationMs,
    maximumStageDurationMs: configuration.maximumStageDurationMs,
    maximumEvidenceAgeMs: configuration.maximumEvidenceAgeMs,
    maximumNakedLegAmount: configuration.maximumNakedLegAmount,
    maximumNakedLegDurationMs: configuration.maximumNakedLegDurationMs,
  }));
}

function freezeExactBound(bound: Readonly<ExactPolicyBound>): Readonly<ExactPolicyBound> {
  return Object.freeze({ value: bound.value, minimum: bound.minimum, maximum: bound.maximum, unit: bound.unit });
}

function freezeIntegerBound(bound: Readonly<IntegerPolicyBound>): Readonly<IntegerPolicyBound> {
  return Object.freeze({ value: bound.value, minimum: bound.minimum, maximum: bound.maximum, unit: bound.unit });
}

export function validateStagedPlanConfiguration(configuration: Readonly<StagedPlanConfiguration>): readonly string[] {
  const issues: string[] = [];
  const authority = configuration?.authority;
  if (!authority || !nonEmpty(authority.sourceId, 200)) issues.push('CONFIG_SOURCE_INVALID');
  if (!authority || !isValidUtcMillis(authority.issuedAtMs)) issues.push('CONFIG_ISSUED_AT_INVALID');
  if (!authority || !isValidUtcMillis(authority.effectiveFromMs)) issues.push('CONFIG_EFFECTIVE_FROM_INVALID');
  if (authority?.effectiveUntilMs !== null && !isValidUtcMillis(authority?.effectiveUntilMs)) issues.push('CONFIG_EFFECTIVE_UNTIL_INVALID');
  if (authority && isValidUtcMillis(authority.issuedAtMs) && isValidUtcMillis(authority.effectiveFromMs)
      && authority.issuedAtMs > authority.effectiveFromMs) issues.push('CONFIG_ISSUED_AFTER_EFFECTIVE');
  if (authority?.effectiveUntilMs !== null && isValidUtcMillis(authority?.effectiveFromMs)
      && isValidUtcMillis(authority?.effectiveUntilMs) && authority.effectiveUntilMs <= authority.effectiveFromMs) {
    issues.push('CONFIG_EFFECTIVE_WINDOW_INVALID');
  }
  issues.push(...exactBoundIssues('MAXIMUM_PLAN_EXPOSURE', configuration?.maximumPlanExposure));
  issues.push(...integerBoundIssues('MAXIMUM_PLAN_DURATION_MS', configuration?.maximumPlanDurationMs));
  issues.push(...integerBoundIssues('MAXIMUM_STAGE_DURATION_MS', configuration?.maximumStageDurationMs));
  issues.push(...integerBoundIssues('MAXIMUM_EVIDENCE_AGE_MS', configuration?.maximumEvidenceAgeMs));
  issues.push(...exactBoundIssues('MAXIMUM_NAKED_LEG_AMOUNT', configuration?.maximumNakedLegAmount));
  issues.push(...integerBoundIssues('MAXIMUM_NAKED_LEG_DURATION_MS', configuration?.maximumNakedLegDurationMs));
  if (configuration?.maximumPlanExposure?.unit !== configuration?.maximumNakedLegAmount?.unit) {
    issues.push('CONFIG_EXACT_BOUND_UNITS_DIVERGENT');
  }
  if (authority && nonEmpty(authority.revision) && issues.length === 0
      && authority.revision !== expectedConfigurationRevision(configuration)) issues.push('CONFIG_REVISION_DIGEST_MISMATCH');
  if (!authority || !nonEmpty(authority.revision)) issues.push('CONFIG_REVISION_INVALID');
  return Object.freeze([...new Set(issues)]);
}

export function createStagedPlanConfiguration(draft: Readonly<StagedPlanConfigurationDraft>): Readonly<StagedPlanConfiguration> {
  const revision = deriveCapitalConfigRevision('staged-plan-policy', configurationPayload(draft));
  const configuration: Readonly<StagedPlanConfiguration> = Object.freeze({
    authority: Object.freeze({
      revision,
      sourceId: draft.sourceId,
      issuedAtMs: draft.issuedAtMs,
      effectiveFromMs: draft.effectiveFromMs,
      effectiveUntilMs: draft.effectiveUntilMs,
    }),
    maximumPlanExposure: freezeExactBound(draft.maximumPlanExposure),
    maximumPlanDurationMs: freezeIntegerBound(draft.maximumPlanDurationMs),
    maximumStageDurationMs: freezeIntegerBound(draft.maximumStageDurationMs),
    maximumEvidenceAgeMs: freezeIntegerBound(draft.maximumEvidenceAgeMs),
    maximumNakedLegAmount: freezeExactBound(draft.maximumNakedLegAmount),
    maximumNakedLegDurationMs: freezeIntegerBound(draft.maximumNakedLegDurationMs),
  });
  const issues = validateStagedPlanConfiguration(configuration);
  if (issues.length > 0) throw new TypeError(`invalid staged plan configuration: ${issues.join(',')}`);
  return configuration;
}

export function isStagedPlanConfigurationEffective(
  configuration: Readonly<StagedPlanConfiguration>,
  atMs: number,
): boolean {
  if (!isValidUtcMillis(atMs) || validateStagedPlanConfiguration(configuration).length > 0) return false;
  return atMs >= configuration.authority.effectiveFromMs
    && (configuration.authority.effectiveUntilMs === null || atMs < configuration.authority.effectiveUntilMs);
}

function cloneStep(step: Readonly<GovernedStagedExposureStep>): Readonly<GovernedStagedExposureStep> {
  const stageRank = (stage: CapitalStage): number => CAPITAL_STAGES.indexOf(stage);
  return Object.freeze({
    stage: step.stage,
    sequence: step.sequence,
    maximumAdditionalExposure: step.maximumAdditionalExposure,
    maximumTotalExposure: step.maximumTotalExposure,
    reservationConsumption: step.reservationConsumption,
    prerequisites: Object.freeze([...step.prerequisites]
      .sort((a, b) => compareText(a.code, b.code))
      .map((item) => Object.freeze({ ...item }))),
    economicThesisConditions: sortedUnique(step.economicThesisConditions),
    invalidationConditions: sortedUnique(step.invalidationConditions),
    maximumTimeInStageMs: step.maximumTimeInStageMs,
    requiredApprovalActions: Object.freeze([...step.requiredApprovalActions].sort()),
    requiredFutureGates: Object.freeze([...step.requiredFutureGates].sort()),
    liquidityRequirement: step.liquidityRequirement,
    maximumNakedLegAmount: step.maximumNakedLegAmount,
    maximumNakedLegDurationMs: step.maximumNakedLegDurationMs,
    stopAddingConditions: sortedUnique(step.stopAddingConditions),
    allowedNextStages: Object.freeze([...step.allowedNextStages].sort((a, b) => stageRank(a) - stageRank(b))),
    reductionConditions: sortedUnique(step.reductionConditions),
    cancellableBeforeEntry: step.cancellableBeforeEntry,
    nextStageConditions: Object.freeze([...step.nextStageConditions]
      .sort((a, b) => stageRank(a.targetStage) - stageRank(b.targetStage))
      .map((item) => Object.freeze({ targetStage: item.targetStage, conditions: sortedUnique(item.conditions) }))),
    skipConditions: Object.freeze([...step.skipConditions]
      .sort((a, b) => stageRank(a.targetStage) - stageRank(b.targetStage))
      .map((item) => Object.freeze({
        targetStage: item.targetStage,
        skippedStages: Object.freeze([...item.skippedStages].sort((a, b) => stageRank(a) - stageRank(b))),
        conditions: sortedUnique(item.conditions),
      }))),
    unenteredCancellationConditions: sortedUnique(step.unenteredCancellationConditions),
  });
}

export function validateGovernedStages(
  rawStages: readonly Readonly<GovernedStagedExposureStep>[],
  configuration: Readonly<StagedPlanConfiguration>,
  reservationAvailable: NonNegativeDecimal,
): readonly string[] {
  const issues: string[] = [];
  if (!Array.isArray(rawStages) || rawStages.length < 2) return Object.freeze(['STAGES_INCOMPLETE']);
  if (!canonicalNonNegative(reservationAvailable)) return Object.freeze(['RESERVATION_AVAILABLE_INVALID']);
  const stages = rawStages;
  const names = stages.map((step) => step?.stage);
  if (hasDuplicates(names)) issues.push('DUPLICATE_STAGE');
  if (names[0] !== 'OBSERVE') issues.push('PLAN_MUST_START_OBSERVE');
  if (names.at(-1) !== 'EXIT') issues.push('PLAN_MUST_END_EXIT');
  stages.forEach((step, index) => {
    if (!step || !(CAPITAL_STAGES as readonly unknown[]).includes(step.stage)) {
      issues.push('STAGE_UNKNOWN');
      return;
    }
    if (step.sequence !== index || !Number.isSafeInteger(step.sequence)) issues.push('STAGE_SEQUENCE_INVALID');
    for (const field of ['maximumAdditionalExposure', 'maximumTotalExposure', 'reservationConsumption', 'maximumNakedLegAmount'] as const) {
      if (!canonicalNonNegative(step[field])) issues.push(`STAGE_${field.toUpperCase()}_INVALID`);
    }
    if (!positiveInteger(step.maximumTimeInStageMs)
      || step.maximumTimeInStageMs > configuration.maximumStageDurationMs.value) issues.push('STAGE_DURATION_OUT_OF_BOUNDS');
    if (!Number.isSafeInteger(step.maximumNakedLegDurationMs) || step.maximumNakedLegDurationMs < 0
      || step.maximumNakedLegDurationMs > configuration.maximumNakedLegDurationMs.value) issues.push('NAKED_LEG_DURATION_OUT_OF_BOUNDS');
    if (canonicalNonNegative(step.maximumAdditionalExposure) && canonicalNonNegative(step.maximumTotalExposure)
      && compareExactDecimals(step.maximumAdditionalExposure, step.maximumTotalExposure) > 0) issues.push('STAGE_ADDITIONAL_EXCEEDS_TOTAL');
    if (canonicalNonNegative(step.maximumTotalExposure)
      && compareExactDecimals(step.maximumTotalExposure, configuration.maximumPlanExposure.value) > 0) issues.push('STAGE_TOTAL_EXCEEDS_POLICY');
    if (canonicalNonNegative(step.maximumNakedLegAmount)
      && compareExactDecimals(step.maximumNakedLegAmount, configuration.maximumNakedLegAmount.value) > 0) issues.push('NAKED_LEG_AMOUNT_OUT_OF_BOUNDS');
    if (!Array.isArray(step.prerequisites) || hasDuplicates(step.prerequisites.map((item: Prerequisite) => item?.code))) issues.push('PREREQUISITES_INVALID');
    else for (const prerequisite of step.prerequisites) {
      if (!nonEmpty(prerequisite.code) || !nonEmpty(prerequisite.detail, 1_000) || typeof prerequisite.required !== 'boolean') issues.push('PREREQUISITE_INVALID');
      if (prerequisite.evidenceMaximumAgeMs !== null
        && (!positiveInteger(prerequisite.evidenceMaximumAgeMs)
          || prerequisite.evidenceMaximumAgeMs > configuration.maximumEvidenceAgeMs.value)) issues.push('EVIDENCE_FRESHNESS_OUT_OF_BOUNDS');
      if (prerequisite.required && prerequisite.evidenceMaximumAgeMs === null) issues.push('REQUIRED_EVIDENCE_FRESHNESS_MISSING');
    }
    for (const values of [step.economicThesisConditions, step.invalidationConditions, step.stopAddingConditions,
      step.reductionConditions, step.unenteredCancellationConditions]) {
      if (!validStringSet(values)) issues.push('STAGE_CONDITION_SET_INVALID');
    }
    if (!Array.isArray(step.requiredApprovalActions) || hasDuplicates(step.requiredApprovalActions)
      || !step.requiredApprovalActions.every((action: ApprovalActionClass) => (APPROVAL_ACTION_CLASSES as readonly unknown[]).includes(action))) issues.push('APPROVAL_SCOPE_INVALID');
    if (!Array.isArray(step.requiredFutureGates) || hasDuplicates(step.requiredFutureGates)) issues.push('FUTURE_GATES_INVALID');
    if (!Array.isArray(step.allowedNextStages) || hasDuplicates(step.allowedNextStages)) issues.push('NEXT_STAGES_INVALID');
    else for (const target of step.allowedNextStages) {
      if (!names.includes(target) || !canTransitionCapitalStage(step.stage, target)) issues.push('ILLEGAL_OR_ABSENT_NEXT_STAGE');
    }
    if (step.stage === 'EXIT' && step.allowedNextStages.length !== 0) issues.push('EXIT_MUST_BE_TERMINAL');
    if (step.stage !== 'EXIT' && step.allowedNextStages.length === 0) issues.push('NON_TERMINAL_STAGE_REQUIRES_NEXT');
    if (!Array.isArray(step.nextStageConditions) || hasDuplicates(step.nextStageConditions.map((item: NextRule) => item?.targetStage))) issues.push('NEXT_CONDITIONS_INVALID');
    else for (const target of step.allowedNextStages) {
      const rule = step.nextStageConditions.find((item: NextRule) => item.targetStage === target);
      if (!rule || !validStringSet(rule.conditions) || rule.conditions.length === 0) issues.push('NEXT_CONDITION_MISSING');
    }
    if (!Array.isArray(step.skipConditions) || hasDuplicates(step.skipConditions.map((item: SkipRule) => item?.targetStage))) issues.push('SKIP_CONDITIONS_INVALID');
    const immediateNext = stages[index + 1]?.stage;
    for (const target of step.allowedNextStages) {
      const targetIndex = names.indexOf(target);
      const canonicalGap = CAPITAL_STAGES.indexOf(target) - CAPITAL_STAGES.indexOf(step.stage) > 1;
      if (targetIndex > index + 1 || canonicalGap) {
        const skip = step.skipConditions.find((item: SkipRule) => item.targetStage === target);
        const expectedSkipped = CAPITAL_STAGES.slice(CAPITAL_STAGES.indexOf(step.stage) + 1, CAPITAL_STAGES.indexOf(target));
        if (!skip || !validStringSet(skip.conditions) || skip.conditions.length === 0
          || !Array.isArray(skip.skippedStages) || skip.skippedStages.length === 0 || hasDuplicates(skip.skippedStages)
          || !skip.skippedStages.every((stage: CapitalStage) => CAPITAL_STAGES.includes(stage))
          || expectedSkipped.some((stage) => !skip.skippedStages.includes(stage))) issues.push('EXPLICIT_SKIP_CONDITION_MISSING');
      }
    }
    for (const skip of step.skipConditions) {
      const canonicalGap = CAPITAL_STAGES.indexOf(skip.targetStage) - CAPITAL_STAGES.indexOf(step.stage) > 1;
      if (!step.allowedNextStages.includes(skip.targetStage) || (skip.targetStage === immediateNext && !canonicalGap)) issues.push('SKIP_TARGET_INVALID');
    }
    const increasing = canonicalNonNegative(step.maximumAdditionalExposure)
      && compareExactDecimals(step.maximumAdditionalExposure, ZERO) > 0;
    if (increasing) {
      if (!step.prerequisites.some((item: Prerequisite) => item.required && item.evidenceMaximumAgeMs !== null)) issues.push('INCREASE_REQUIRES_FRESH_EVIDENCE');
      if (step.economicThesisConditions.length === 0 || step.invalidationConditions.length === 0
        || step.stopAddingConditions.length === 0) issues.push('INCREASE_CONDITIONS_INCOMPLETE');
      if (step.liquidityRequirement === null || !canonicalNonNegative(step.liquidityRequirement)
        || compareExactDecimals(step.liquidityRequirement, ZERO) <= 0) issues.push('INCREASE_LIQUIDITY_REQUIRED');
      if (!step.requiredApprovalActions.some((action: ApprovalActionClass) => action === 'OPEN' || action === 'ADD')) issues.push('INCREASE_APPROVAL_SCOPE_REQUIRED');
      for (const gate of REQUIRED_INCREASE_GATES) if (!step.requiredFutureGates.includes(gate)) issues.push('INCREASE_FUTURE_GATE_MISSING');
    }
    if (step.stage === 'ADD' && !step.requiredApprovalActions.includes('ADD')) issues.push('ADD_APPROVAL_SCOPE_REQUIRED');
    if (step.stage === 'HOLD' || step.stage === 'REDUCE' || step.stage === 'EXIT') {
      if (canonicalNonNegative(step.maximumAdditionalExposure) && compareExactDecimals(step.maximumAdditionalExposure, ZERO) !== 0) issues.push('NON_ADDING_STAGE_ADDITIONAL_NONZERO');
      if (canonicalNonNegative(step.reservationConsumption) && compareExactDecimals(step.reservationConsumption, ZERO) !== 0) issues.push('NON_ADDING_STAGE_RESERVATION_NONZERO');
    }
    if (step.stage === 'REDUCE' && step.reductionConditions.length === 0) issues.push('REDUCTION_CONDITION_REQUIRED');
    if (step.stage === 'EXIT') {
      if (canonicalNonNegative(step.maximumTotalExposure) && compareExactDecimals(step.maximumTotalExposure, ZERO) !== 0) issues.push('EXIT_TOTAL_MUST_BE_ZERO');
      if (canonicalNonNegative(step.maximumNakedLegAmount) && compareExactDecimals(step.maximumNakedLegAmount, ZERO) !== 0) issues.push('EXIT_NAKED_AMOUNT_MUST_BE_ZERO');
    }
    if (typeof step.cancellableBeforeEntry !== 'boolean') issues.push('CANCELLATION_SEMANTICS_MISSING');
    if (step.unenteredCancellationConditions.length === 0) issues.push('CANCELLATION_CONDITION_REQUIRED');
  });
  const reservationConsumption = stages.every((step) => canonicalNonNegative(step.reservationConsumption))
    ? sumExactDecimals(stages.map((step) => step.reservationConsumption))
    : null;
  if (reservationConsumption !== null && compareExactDecimals(reservationConsumption, reservationAvailable) > 0) issues.push('STAGE_RESERVATION_OVERCOMMITTED');
  let cumulativeReservationConsumption: ExactDecimal = ZERO;
  for (const step of stages) {
    if (!canonicalNonNegative(step.reservationConsumption)) continue;
    cumulativeReservationConsumption = addExactDecimals(cumulativeReservationConsumption, step.reservationConsumption);
    if (canonicalNonNegative(step.maximumAdditionalExposure)
        && compareExactDecimals(step.maximumAdditionalExposure, step.reservationConsumption) > 0) {
      issues.push('STAGE_RESERVATION_UNDERCOVERS_ADDITIONAL');
    }
    if (canonicalNonNegative(step.maximumTotalExposure)
        && compareExactDecimals(step.maximumTotalExposure, cumulativeReservationConsumption) > 0) {
      issues.push('STAGE_TOTAL_EXCEEDS_CUMULATIVE_RESERVATION');
    }
  }
  return Object.freeze([...new Set(issues)]);
}

function reject<T>(code: string, message: string, atMs: number, correlationId: string, stage: string, state: string): ContractResult<T> {
  return fail(createStructuredFailure({
    component: 'capitalFoundation.stages',
    stage,
    code,
    message,
    occurredAt: atMs,
    retryable: false,
    safeCurrentState: state,
    recommendedOperatorAction: 'Correct the named policy binding and submit a new revision.',
    correlationId,
  }));
}

function requireContext(atMs: number, correlationId: string): void {
  if (!isValidUtcMillis(atMs) || !nonEmpty(correlationId, 128)) throw new TypeError('stage policy requires injected UTC time and correlation ID');
}

function planSemantic(plan: Omit<GovernedStagedPlan, 'digest'>): unknown {
  return plan;
}

function planEnvelopeIssues(plan: Readonly<GovernedStagedPlan>): readonly string[] {
  const issues: string[] = [];
  if (!nonEmpty(plan?.id) || !nonEmpty(plan?.reservationId) || !nonEmpty(plan?.proposalIntakeDigest)
      || !nonEmpty(plan?.valuationAsset) || !nonEmpty(plan?.configRevision) || !nonEmpty(plan?.digest)) {
    issues.push('PLAN_IDENTITY_BINDING_INVALID');
  }
  if (!positiveInteger(plan?.revision) || !positiveInteger(plan?.reservationRevision)
      || !nonEmpty(plan?.reservationConsiderationId)) issues.push('PLAN_REVISION_BINDING_INVALID');
  if (!canonicalNonNegative(plan?.remainingReservedAmount)) issues.push('PLAN_REMAINING_RESERVATION_INVALID');
  if (!isValidUtcMillis(plan?.createdAtMs) || !isValidUtcMillis(plan?.expiresAtMs)
      || plan.expiresAtMs <= plan.createdAtMs) issues.push('PLAN_TIME_WINDOW_INVALID');
  if (!Array.isArray(plan?.stages) || plan.stages.length < 2) {
    issues.push('PLAN_STAGES_INVALID');
  } else {
    const names = plan.stages.map((step) => step?.stage);
    if (hasDuplicates(names) || names[0] !== 'OBSERVE' || names.at(-1) !== 'EXIT'
        || !names.includes(plan.activeStage)
        || plan.stages.some((step, index) => step.sequence !== index)) issues.push('PLAN_STAGE_ENVELOPE_INVALID');
  }
  if (issues.length === 0) {
    const { digest, ...semantic } = plan;
    if (capitalDigest(planSemantic(semantic)) !== digest) issues.push('PLAN_DIGEST_MISMATCH');
  }
  return Object.freeze([...new Set(issues)]);
}

function planConfigurationIssues(
  plan: Readonly<GovernedStagedPlan>,
  configuration: Readonly<StagedPlanConfiguration>,
): readonly string[] {
  const issues = [...planEnvelopeIssues(plan), ...validateStagedPlanConfiguration(configuration)];
  if (plan.configRevision !== configuration.authority.revision) issues.push('PLAN_CONFIG_REVISION_MISMATCH');
  if (configuration.maximumPlanExposure.unit !== plan.valuationAsset
      || configuration.maximumNakedLegAmount.unit !== plan.valuationAsset) {
    issues.push('CONFIG_VALUATION_UNIT_MISMATCH');
  }
  if (issues.length === 0) issues.push(...validateGovernedStages(plan.stages, configuration, plan.remainingReservedAmount));
  return Object.freeze([...new Set(issues)]);
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

function stageUseScopeKey(plan: Readonly<GovernedStagedPlan>, from: CapitalStage, to: CapitalStage): string {
  return `stage:${plan.id}:${plan.revision}:${plan.digest}:${from}->${to}`;
}

function availableReservation(amount: NonNegativeDecimal, consumed: NonNegativeDecimal): NonNegativeDecimal | null {
  if (!canonicalNonNegative(amount) || !canonicalNonNegative(consumed) || compareExactDecimals(consumed, amount) > 0) return null;
  return normalizeNonNegativeExactDecimal(subtractExactDecimals(amount, consumed));
}

function buildStagedPlanInternal(
  input: Readonly<BuildStagedPlanInput>,
  requireInitialObserve: boolean,
): ContractResult<Readonly<GovernedStagedPlan>> {
  requireContext(input.createdAtMs, input.correlationId);
  const configIssues = validateStagedPlanConfiguration(input.configuration);
  if (configIssues.length > 0) return reject(configIssues[0], configIssues.join(','), input.createdAtMs, input.correlationId, 'build-plan', 'RESERVED');
  if (!isStagedPlanConfigurationEffective(input.configuration, input.createdAtMs)) return reject('CONFIG_NOT_EFFECTIVE', 'configuration is not effective at plan creation', input.createdAtMs, input.correlationId, 'build-plan', 'RESERVED');
  if (input.configuration.maximumPlanExposure.unit !== input.valuationAsset
      || input.configuration.maximumNakedLegAmount.unit !== input.valuationAsset) {
    return reject('CONFIG_VALUATION_UNIT_MISMATCH', 'staged-plan exact bounds must use the reservation valuation asset', input.createdAtMs, input.correlationId, 'build-plan', 'RESERVED');
  }
  if (!nonEmpty(input.proposalIntakeDigest, 256) || !nonEmpty(input.valuationAsset, 40)
      || input.valuationAsset !== input.reservation.valuationAsset
      || !positiveInteger(input.reservation.revision) || !nonEmpty(input.reservation.considerationId)) {
    return reject('PLAN_BINDING_INVALID', 'proposal intake, reservation consideration/revision, and valuation asset must bind exactly', input.createdAtMs, input.correlationId, 'build-plan', 'RESERVED');
  }
  if (input.reservation.state !== 'ACTIVE' || input.reservation.releasedAtMs !== null || input.reservation.expiresAtMs <= input.createdAtMs) return reject('RESERVATION_NOT_ACTIVE', 'plan requires a current active reservation', input.createdAtMs, input.correlationId, 'build-plan', 'RESERVED');
  const available = availableReservation(input.reservation.amount, input.reservation.consumedAmount);
  if (available === null) return reject('RESERVATION_AMOUNTS_INVALID', 'reservation consumption exceeds its exact amount', input.createdAtMs, input.correlationId, 'build-plan', 'RESERVED');
  const stageIssues = validateGovernedStages(input.stages, input.configuration, available);
  if (stageIssues.length > 0) return reject(stageIssues[0], stageIssues.join(','), input.createdAtMs, input.correlationId, 'build-plan', 'RESERVED');
  if (!input.stages.some((step) => step.stage === input.activeStage)) return reject('ACTIVE_STAGE_ABSENT', 'active stage is not present in plan', input.createdAtMs, input.correlationId, 'build-plan', 'RESERVED');
  if (requireInitialObserve && input.activeStage !== 'OBSERVE') return reject('INITIAL_STAGE_MUST_BE_OBSERVE', 'a fresh staged plan must begin at OBSERVE', input.createdAtMs, input.correlationId, 'build-plan', 'RESERVED');
  if (!isValidUtcMillis(input.expiresAtMs) || input.expiresAtMs <= input.createdAtMs
      || input.expiresAtMs > input.reservation.expiresAtMs
      || input.expiresAtMs - input.createdAtMs > input.configuration.maximumPlanDurationMs.value
      || (input.configuration.authority.effectiveUntilMs !== null && input.expiresAtMs > input.configuration.authority.effectiveUntilMs)) {
    return reject('PLAN_EFFECTIVE_WINDOW_INVALID', 'plan expiry exceeds reservation, configuration, or duration bounds', input.createdAtMs, input.correlationId, 'build-plan', 'RESERVED');
  }
  const stages = Object.freeze(input.stages.map(cloneStep));
  const id = deriveStagedPlanId({
    reservationId: input.reservation.id,
    proposalIntakeDigest: input.proposalIntakeDigest,
    configRevision: input.configuration.authority.revision,
  });
  const semantic = Object.freeze({
    id,
    reservationId: input.reservation.id,
    revision: 1,
    stages,
    activeStage: input.activeStage,
    remainingReservedAmount: available,
    createdAtMs: input.createdAtMs,
    expiresAtMs: input.expiresAtMs,
    configRevision: input.configuration.authority.revision,
    proposalIntakeDigest: input.proposalIntakeDigest,
    valuationAsset: input.valuationAsset,
    reservationRevision: input.reservation.revision,
    reservationConsiderationId: input.reservation.considerationId,
  });
  return ok(Object.freeze({ ...semantic, digest: capitalDigest(planSemantic(semantic)) }));
}

export function buildStagedPlan(input: Readonly<BuildStagedPlanInput>): ContractResult<Readonly<GovernedStagedPlan>> {
  return buildStagedPlanInternal(input, true);
}

export function reviseStagedPlan(input: Readonly<ReviseStagedPlanInput>): ContractResult<Readonly<StagedPlanRevisionReceipt>> {
  requireContext(input.revisedAtMs, input.correlationId);
  const currentIssues = planConfigurationIssues(input.current, input.currentConfiguration);
  if (currentIssues.length > 0) return reject('CURRENT_PLAN_INTEGRITY_INVALID', currentIssues.join(','), input.revisedAtMs, input.correlationId, 'revise-plan', input.current.activeStage);
  if (input.current.reservationId !== input.reservation.id
      || input.current.reservationConsiderationId !== input.reservation.considerationId
      || input.current.valuationAsset !== input.reservation.valuationAsset
      || !positiveInteger(input.reservation.revision)
      || input.reservation.revision < input.current.reservationRevision) {
    return reject('PLAN_RESERVATION_CHANGED', 'a plan revision cannot change or regress reservation authority', input.revisedAtMs, input.correlationId, 'revise-plan', input.current.activeStage);
  }
  if (input.revisedAtMs < input.current.createdAtMs || input.revisedAtMs >= input.current.expiresAtMs) return reject('PLAN_REVISION_TIME_INVALID', 'revision must occur during the current plan lifetime', input.revisedAtMs, input.correlationId, 'revise-plan', input.current.activeStage);
  if (input.activeStage !== input.current.activeStage) return reject('ACTIVE_STAGE_REVISION_FORBIDDEN', 'policy revision cannot substitute for an authorized stage transition', input.revisedAtMs, input.correlationId, 'revise-plan', input.current.activeStage);
  const oldActiveIndex = input.current.stages.findIndex((step) => step.stage === input.current.activeStage);
  const expectedCompletedStages = input.current.stages.slice(0, oldActiveIndex).map((step) => step.stage);
  if (hasDuplicates(input.completedStages) || input.completedStages.length !== expectedCompletedStages.length
      || expectedCompletedStages.some((stage) => !input.completedStages.includes(stage))
      || input.completedStages.some((stage) => {
    const stageIndex = input.current.stages.findIndex((step) => step.stage === stage);
    return stageIndex < 0 || stageIndex >= oldActiveIndex;
  })) return reject('COMPLETED_STAGE_SET_INVALID', 'completed stages must be the complete unique plan prefix before the active stage', input.revisedAtMs, input.correlationId, 'revise-plan', input.current.activeStage);
  const oldByStage = new Map(input.current.stages.map((step) => [step.stage, step]));
  for (const completed of input.completedStages) {
    const replacement = input.stages.find((step) => step.stage === completed);
    if (!replacement || capitalDigest(oldByStage.get(completed)) !== capitalDigest(cloneStep(replacement))) return reject('COMPLETED_STAGE_IMMUTABLE', `completed stage ${completed} cannot be rewritten`, input.revisedAtMs, input.correlationId, 'revise-plan', input.current.activeStage);
  }
  const cancellableFuture = input.current.stages.slice(oldActiveIndex + 1).filter((step) => !input.completedStages.includes(step.stage));
  if (cancellableFuture.some((step) => !step.cancellableBeforeEntry || step.unenteredCancellationConditions.length === 0)) return reject('FUTURE_STAGE_NOT_CANCELLABLE', 'all replaced unentered future stages require explicit cancellation semantics', input.revisedAtMs, input.correlationId, 'revise-plan', input.current.activeStage);
  const built = buildStagedPlanInternal({
    reservation: input.reservation,
    proposalIntakeDigest: input.current.proposalIntakeDigest,
    valuationAsset: input.current.valuationAsset,
    configuration: input.configuration,
    stages: input.stages,
    activeStage: input.activeStage,
    createdAtMs: input.revisedAtMs,
    expiresAtMs: input.expiresAtMs,
    correlationId: input.correlationId,
  }, false);
  if (!built.ok) return built;
  const active = built.value.stages.find((step) => step.stage === built.value.activeStage);
  if (!canonicalNonNegative(input.currentTotalExposure) || !active
      || compareExactDecimals(input.currentTotalExposure, active.maximumTotalExposure) > 0) return reject('CURRENT_EXPOSURE_EXCEEDS_REVISED_STAGE', 'revision cannot strand already exposed capital above the active-stage bound', input.revisedAtMs, input.correlationId, 'revise-plan', input.current.activeStage);
  const semantic = Object.freeze({
    ...built.value,
    id: input.current.id,
    revision: input.current.revision + 1,
    createdAtMs: input.current.createdAtMs,
  });
  const { digest: _discarded, ...withoutDigest } = semantic;
  const plan = Object.freeze({ ...withoutDigest, digest: capitalDigest(planSemantic(withoutDigest)) });
  return ok(Object.freeze({
    plan,
    cancelledUnenteredStages: Object.freeze(cancellableFuture.map((step) => step.stage)),
    revisedAtMs: input.revisedAtMs,
  }));
}

function firstMissing(required: readonly string[], supplied: readonly string[]): string | null {
  return required.find((value) => !supplied.includes(value)) ?? null;
}

function canonicalStageEvidence(values: readonly EvaluateStageTransitionInput['evidence'][number][]): {
  readonly observations: readonly EvaluateStageTransitionInput['evidence'][number][];
  readonly issue: string | null;
} {
  if (!Array.isArray(values)) return Object.freeze({ observations: Object.freeze([]), issue: 'EVIDENCE_OBSERVATIONS_INVALID' });
  const byCode = new Map<string, EvaluateStageTransitionInput['evidence'][number]>();
  for (const observation of values) {
    if (!nonEmpty(observation?.code) || !isValidUtcMillis(observation?.observedAtMs) || typeof observation?.available !== 'boolean') {
      return Object.freeze({ observations: Object.freeze([]), issue: 'EVIDENCE_OBSERVATIONS_INVALID' });
    }
    const prior = byCode.get(observation.code);
    if (prior && (prior.observedAtMs !== observation.observedAtMs || prior.available !== observation.available)) {
      return Object.freeze({ observations: Object.freeze([]), issue: 'EVIDENCE_OBSERVATIONS_DIVERGENT' });
    }
    if (!prior) byCode.set(observation.code, Object.freeze({ ...observation }));
  }
  return Object.freeze({
    observations: Object.freeze([...byCode.values()].sort((left, right) => compareText(left.code, right.code))),
    issue: null,
  });
}

export function evaluateStageTransition(input: Readonly<EvaluateStageTransitionInput>): ContractResult<Readonly<StageTransitionAuthorization>> {
  requireContext(input.nowMs, input.correlationId);
  const from = input.plan.activeStage;
  const failGate = (code: string, message: string) => reject<Readonly<StageTransitionAuthorization>>(code, message, input.nowMs, input.correlationId, `transition:${from}->${input.to}`, from);
  const planIssues = planConfigurationIssues(input.plan, input.configuration);
  if (planIssues.length > 0) return failGate('STAGED_PLAN_INTEGRITY_INVALID', planIssues.join(','));
  if (!isValidUtcMillis(input.stageEnteredAtMs) || input.stageEnteredAtMs > input.nowMs) return failGate('STAGE_ENTRY_TIME_INVALID', 'stage entry time is invalid');
  const source = input.plan.stages.find((step) => step.stage === from);
  const target = input.plan.stages.find((step) => step.stage === input.to);
  if (!source || !target || !source.allowedNextStages.includes(input.to) || !canTransitionCapitalStage(from, input.to)) return failGate('ILLEGAL_CAPITAL_STAGE_TRANSITION', `${from} cannot transition to ${input.to} under this plan`);
  if (!canonicalNonNegative(input.currentTotalExposure) || !canonicalNonNegative(input.requestedAdditionalExposure)
      || !canonicalNonNegative(input.proposedNakedLegAmount)) return failGate('TRANSITION_DECIMAL_INVALID', 'transition financial values must be canonical non-negative decimals');
  const increasing = compareExactDecimals(input.requestedAdditionalExposure, ZERO) > 0;
  const riskReducing = !increasing && (input.to === 'REDUCE' || input.to === 'EXIT');
  if (!riskReducing && (!isStagedPlanConfigurationEffective(input.configuration, input.nowMs) || input.nowMs >= input.plan.expiresAtMs)) {
    return failGate(input.nowMs >= input.plan.expiresAtMs ? 'STAGED_PLAN_EXPIRED' : 'CONFIG_BINDING_NOT_CURRENT', 'new or non-reducing stage authority requires a current plan and configuration');
  }
  const transitionRule = source.nextStageConditions.find((rule) => rule.targetStage === input.to);
  const missingTransition = transitionRule ? firstMissing(transitionRule.conditions, input.satisfiedTransitionConditions) : 'RULE';
  if (missingTransition !== null) return failGate('NEXT_STAGE_CONDITION_UNSATISFIED', `transition condition ${missingTransition} is not satisfied`);
  const sourceIndex = input.plan.stages.findIndex((step) => step.stage === source.stage);
  const targetIndex = input.plan.stages.findIndex((step) => step.stage === target.stage);
  const canonicalGap = CAPITAL_STAGES.indexOf(target.stage) - CAPITAL_STAGES.indexOf(source.stage) > 1;
  if (targetIndex > sourceIndex + 1 || canonicalGap) {
    const skip = source.skipConditions.find((rule) => rule.targetStage === target.stage);
    const missingSkip = skip ? firstMissing(skip.conditions, input.satisfiedTransitionConditions) : 'RULE';
    if (missingSkip !== null) return failGate('SKIP_CONDITION_UNSATISFIED', `skip condition ${missingSkip} is not satisfied`);
  }
  if (input.to === 'ADD' && !increasing) return failGate('ADD_AMOUNT_REQUIRED', 'ADD requires an exact positive additional exposure');
  const resultingTotal = addExactDecimals(input.currentTotalExposure, input.requestedAdditionalExposure);
  if (increasing && (compareExactDecimals(input.requestedAdditionalExposure, target.maximumAdditionalExposure) > 0
      || compareExactDecimals(resultingTotal, target.maximumTotalExposure) > 0)) return failGate('STAGE_EXPOSURE_LIMIT_EXCEEDED', 'requested exposure exceeds exact stage limits');
  if (increasing && compareExactDecimals(input.requestedAdditionalExposure, target.reservationConsumption) > 0) {
    return failGate('STAGE_RESERVATION_COVERAGE_EXCEEDED', 'requested additional exposure exceeds exact same-valuation reservation consumption');
  }
  if (!Number.isSafeInteger(input.proposedNakedLegDurationMs) || input.proposedNakedLegDurationMs < 0
      || compareExactDecimals(input.proposedNakedLegAmount, target.maximumNakedLegAmount) > 0
      || input.proposedNakedLegDurationMs > target.maximumNakedLegDurationMs) return failGate('NAKED_LEG_LIMIT_EXCEEDED', 'proposed naked-leg amount or duration exceeds the executor envelope');
  let reservationAvailable: NonNegativeDecimal | null = null;
  let approvalId: string | null = null;
  let approvalRevision: number | null = null;
  let approvalValidated = false;
  let canonicalEvidence: readonly EvaluateStageTransitionInput['evidence'][number][] = Object.freeze([]);
  if (increasing) {
    if (input.nowMs - input.stageEnteredAtMs > source.maximumTimeInStageMs) return failGate('STAGE_TIME_LIMIT_EXCEEDED', 'increasing transition arrived after the source-stage time limit');
    if (input.adversePriceMoveIsSoleReason) return failGate('AVERAGING_DOWN_FORBIDDEN', 'adverse price movement alone cannot authorize ADD');
    const reservation = input.reservation;
    reservationAvailable = reservation === null ? null : availableReservation(reservation.amount, reservation.consumedAmount);
    if (!reservation || reservation.id !== input.plan.reservationId
        || reservation.considerationId !== input.plan.reservationConsiderationId
        || reservation.valuationAsset !== input.plan.valuationAsset
        || input.reservationValidatedAtMs !== input.nowMs
        || !positiveInteger(reservation.revision) || reservation.revision < input.plan.reservationRevision
        || reservation.state !== 'ACTIVE' || reservation.releasedAtMs !== null
        || !isValidUtcMillis(reservation.createdAtMs) || reservation.createdAtMs > input.nowMs
        || !isValidUtcMillis(reservation.expiresAtMs) || reservation.expiresAtMs <= input.nowMs
        || reservationAvailable === null
        || compareExactDecimals(target.reservationConsumption, reservationAvailable) > 0
        || compareExactDecimals(target.reservationConsumption, input.plan.remainingReservedAmount) > 0) {
      return failGate('RESERVATION_REQUIRED', 'increase requires the current active bound reservation revision and exact available amount');
    }
    const evidenceResult = canonicalStageEvidence(input.evidence);
    if (evidenceResult.issue !== null) return failGate(evidenceResult.issue, 'stage evidence identities are invalid or divergent');
    canonicalEvidence = evidenceResult.observations;
    for (const prerequisite of target.prerequisites.filter((item) => item.required)) {
      const observation = canonicalEvidence.find((item) => item.code === prerequisite.code && item.available);
      if (!observation || !isValidUtcMillis(observation.observedAtMs) || observation.observedAtMs > input.nowMs
          || prerequisite.evidenceMaximumAgeMs === null || input.nowMs - observation.observedAtMs > prerequisite.evidenceMaximumAgeMs) return failGate('FRESH_EVIDENCE_REQUIRED', `required evidence ${prerequisite.code} is missing or stale`);
    }
    const missingThesis = firstMissing(target.economicThesisConditions, input.satisfiedThesisConditions);
    if (missingThesis !== null) return failGate('THESIS_CONDITION_UNSATISFIED', `thesis condition ${missingThesis} is not satisfied`);
    if (target.invalidationConditions.some((item) => input.triggeredInvalidationConditions.includes(item))) return failGate('THESIS_INVALIDATED', 'a configured invalidation condition is active');
    if (target.stopAddingConditions.some((item) => input.triggeredStopAddingConditions.includes(item))) return failGate('STOP_ADD_TRIGGERED', 'a configured stop-add condition is active');
    if (target.liquidityRequirement === null || input.availableLiquidityDepth === null
        || !canonicalNonNegative(input.availableLiquidityDepth)
        || compareExactDecimals(input.availableLiquidityDepth, target.liquidityRequirement) < 0) return failGate('LIQUIDITY_DEPTH_INSUFFICIENT', 'fresh executable depth does not meet the stage requirement');
    const approval = input.approval;
    const expectedAction: ApprovalActionClass = input.to === 'ADD' ? 'ADD' : 'OPEN';
    const expectedUseScopeKey = stageUseScopeKey(input.plan, from, input.to);
    if (!approval) return failGate('SCOPED_APPROVAL_REQUIRED', 'current approval state, context, policy, and mandate are required');
    const approvalRecord = approval.state?.approval;
    const approvalContext = approval.context;
    const mandate = approval.mandate;
    const mandateSemantic = mandate && typeof mandate === 'object'
      ? Object.fromEntries(Object.entries(mandate).filter(([key]) => key !== 'digest'))
      : null;
    const mandateDigestValid = mandateSemantic !== null && capitalDigest(mandateSemantic) === mandate.digest;
    const bindingValid = mandateDigestValid
      && mandate.stagedPlanId === input.plan.id
      && mandate.stagedPlanRevision === input.plan.revision
      && mandate.stagedPlanDigest === input.plan.digest
      && mandate.reservationId === input.plan.reservationId
      && mandate.proposalIntakeDigest === input.plan.proposalIntakeDigest
      && mandate.configRevision === input.plan.configRevision
      && mandate.valuationAsset === input.plan.valuationAsset
      && mandate.expiresAtMs > input.nowMs
      && compareExactDecimals(resultingTotal, mandate.targetMaximumExposure) <= 0
      && approvalContext.nowMs === input.nowMs
      && approvalContext.correlationId === input.correlationId
      && approvalContext.proposalIntakeDigest === input.plan.proposalIntakeDigest
      && approvalContext.mandateId === mandate.id
      && approvalContext.mandateRevision === mandate.revision
      && approvalContext.mandateDigest === mandate.digest
      && approvalContext.stagedPlanId === input.plan.id
      && approvalContext.stagedPlanRevision === input.plan.revision
      && approvalContext.stagedPlanDigest === input.plan.digest
      && approvalContext.configRevision === input.plan.configRevision
      && approvalContext.useScopeKey === expectedUseScopeKey
      && approvalContext.actionClass === expectedAction
      && approvalContext.stage === target.stage
      && approvalContext.requestedNotional === input.requestedAdditionalExposure
      && approvalRecord?.mode === 'MANUAL_ARMED'
      && approvalRecord.valuationAsset === input.plan.valuationAsset
      && target.requiredApprovalActions.every((action) => approvalRecord.allowedActionClasses.includes(action));
    if (!bindingValid) return failGate('SCOPED_APPROVAL_REQUIRED', 'approval state or validation context is stale, unbound, or too narrow');
    let evaluatedApproval;
    try {
      evaluatedApproval = evaluateOperatorApproval(approval.state, approvalContext, approval.policy);
    } catch {
      return failGate('SCOPED_APPROVAL_REQUIRED', 'approval state, validation context, or policy is malformed');
    }
    if (!evaluatedApproval.ok || !evaluatedApproval.value.allowedForExternalRiskEvaluation
        || evaluatedApproval.value.mode !== 'MANUAL_ARMED' || evaluatedApproval.value.executionReady !== false
        || evaluatedApproval.value.approvalId !== approvalRecord.id
        || evaluatedApproval.value.validatedAtMs !== input.nowMs) {
      return failGate('SCOPED_APPROVAL_REQUIRED', 'public approval evaluation did not grant current scoped external-risk authority');
    }
    approvalId = approvalRecord.id;
    approvalRevision = approval.state.revision;
    approvalValidated = true;
    const risk = input.futureRiskRecheck;
    if (!risk || !risk.required || risk.owner !== 'FOUNDATION_MULTI_LEG_RISK'
        || risk.stagedPlanId !== input.plan.id || risk.stagedPlanRevision !== input.plan.revision
        || risk.stagedPlanDigest !== input.plan.digest || !target.requiredFutureGates.includes('MULTI_LEG_RISK')) return failGate('FUTURE_RISK_RECHECK_REQUIRED', 'increase must remain gated by a bound future Foundation risk recheck');
  }
  const contractTransition = transitionCapitalStage(from, input.to, {
    nowMs: input.nowMs,
    correlationId: input.correlationId,
    freshEvidence: !increasing || target.prerequisites.every((item) => !item.required || canonicalEvidence.some((fact) => fact.code === item.code && fact.available)),
    reservationAvailable: !increasing || (reservationAvailable !== null && compareExactDecimals(target.reservationConsumption, reservationAvailable) <= 0),
    approvalValidated: !increasing || approvalValidated,
    futureRiskRecheckRequired: !increasing || input.futureRiskRecheck?.required === true,
    adversePriceMoveIsSoleReason: input.adversePriceMoveIsSoleReason,
  });
  if (!contractTransition.ok) return Object.freeze({ ok: false as const, failure: contractTransition.failure });
  return ok(Object.freeze({
    from,
    to: input.to,
    authorizedForExternalRiskEvaluation: increasing,
    executionReady: false as const,
    reservationConsumption: increasing ? target.reservationConsumption : ZERO,
    requiredFutureGates: Object.freeze([...target.requiredFutureGates]),
    evaluatedAtMs: input.nowMs,
    planId: input.plan.id,
    planRevision: input.plan.revision,
    planDigest: input.plan.digest,
    reservationId: increasing ? input.reservation?.id ?? null : null,
    reservationRevision: increasing ? input.reservation?.revision ?? null : null,
    reservationAvailable: increasing ? reservationAvailable : null,
    approvalId,
    approvalRevision,
  }));
}

function maximumPlanExposure(plan: Readonly<GovernedStagedPlan>): NonNegativeDecimal {
  return plan.stages.reduce<NonNegativeDecimal>((maximum, step) =>
    compareExactDecimals(step.maximumTotalExposure, maximum) > 0 ? step.maximumTotalExposure : maximum, ZERO);
}

function mandateSemantic(mandate: Omit<CapitalMandate, 'digest'>): unknown {
  return mandate;
}

export function buildCapitalMandate(input: Readonly<BuildCapitalMandateInput>): ContractResult<Readonly<CapitalMandate>> {
  requireContext(input.createdAtMs, input.correlationId);
  const safe = 'PLANNED';
  const planIssues = planConfigurationIssues(input.plan, input.configuration);
  if (planIssues.length > 0 || !isStagedPlanConfigurationEffective(input.configuration, input.createdAtMs)) {
    return reject('MANDATE_PLAN_INTEGRITY_INVALID', planIssues.join(',') || 'PLAN_CONFIG_NOT_EFFECTIVE', input.createdAtMs, input.correlationId, 'build-mandate', safe);
  }
  if (input.consideration.status !== 'ELIGIBLE' || input.consideration.mode === 'ADVISORY') return reject('CONSIDERATION_NOT_MANDATE_ELIGIBLE', 'only an eligible non-advisory consideration may form a mandate', input.createdAtMs, input.correlationId, 'build-mandate', safe);
  const currentConsiderationTruth = refreshTruth(input.consideration.truth, input.createdAtMs);
  if (input.consideration.evaluatedAtMs !== input.createdAtMs
      || input.consideration.truth.evaluatedAtMs !== input.consideration.evaluatedAtMs
      || !truthAllowsNewExposure(currentConsiderationTruth)) {
    return reject('CONSIDERATION_TRUTH_NOT_CURRENT', 'mandate creation requires a freshly re-evaluated eligible consideration and current truth', input.createdAtMs, input.correlationId, 'build-mandate', safe);
  }
  if (input.consideration.proposal.expiresAtMs !== null && input.consideration.proposal.expiresAtMs <= input.createdAtMs) return reject('PROPOSAL_EXPIRED', 'proposal expired before mandate creation', input.createdAtMs, input.correlationId, 'build-mandate', safe);
  if (input.plan.proposalIntakeDigest !== input.consideration.proposal.intakeDigest || !nonEmpty(input.plan.proposalIntakeDigest, 256)) return reject('PROPOSAL_INTAKE_DIGEST_MISMATCH', 'mandate plan is not bound to the proposal intake digest', input.createdAtMs, input.correlationId, 'build-mandate', safe);
  if (input.plan.reservationId !== input.reservation.id || input.reservation.allocationDecisionId !== input.allocationDecisionId
      || input.reservation.considerationId !== input.consideration.id
      || input.plan.reservationConsiderationId !== input.consideration.id
      || input.plan.reservationRevision !== input.reservation.revision
      || input.plan.valuationAsset !== input.reservation.valuationAsset
      || input.plan.valuationAsset !== input.consideration.economics.valuationAsset
      || input.reservation.state !== 'ACTIVE' || input.reservation.releasedAtMs !== null
      || input.reservation.expiresAtMs <= input.createdAtMs) return reject('MANDATE_RESERVATION_BINDING_INVALID', 'mandate reservation/allocation/consideration/revision/valuation binding is invalid', input.createdAtMs, input.correlationId, 'build-mandate', safe);
  const reservationAvailable = availableReservation(input.reservation.amount, input.reservation.consumedAmount);
  if (reservationAvailable === null || reservationAvailable !== input.plan.remainingReservedAmount) return reject('MANDATE_RESERVATION_BINDING_INVALID', 'plan remaining reservation does not match the current exact reservation revision', input.createdAtMs, input.correlationId, 'build-mandate', safe);
  const exactMaximum = maximumPlanExposure(input.plan);
  if (!canonicalNonNegative(input.targetMaximumExposure) || compareExactDecimals(input.targetMaximumExposure, exactMaximum) !== 0) return reject('MANDATE_TARGET_MUST_EQUAL_PLAN_MAXIMUM', 'mandate target must equal the exact staged-plan maximum', input.createdAtMs, input.correlationId, 'build-mandate', safe);
  if (!isValidUtcMillis(input.expiresAtMs) || input.expiresAtMs <= input.createdAtMs
      || input.expiresAtMs > input.plan.expiresAtMs || input.expiresAtMs > input.reservation.expiresAtMs) return reject('MANDATE_EFFECTIVE_WINDOW_INVALID', 'mandate lifetime must fit inside plan and reservation lifetimes', input.createdAtMs, input.correlationId, 'build-mandate', safe);
  const id = deriveCapitalMandateId({
    considerationId: input.consideration.id,
    allocationDecisionId: input.allocationDecisionId,
    reservationId: input.reservation.id,
    proposalIntakeDigest: input.plan.proposalIntakeDigest,
  });
  const semantic: Omit<CapitalMandate, 'digest'> = Object.freeze({
    id,
    revision: 1,
    considerationId: input.consideration.id,
    allocationDecisionId: input.allocationDecisionId,
    reservationId: input.reservation.id,
    stagedPlanId: input.plan.id,
    stagedPlanRevision: input.plan.revision,
    stagedPlanDigest: input.plan.digest,
    proposalIntakeDigest: input.plan.proposalIntakeDigest,
    configRevision: input.plan.configRevision,
    approvalId: null,
    riskDecision: null,
    targetMaximumExposure: input.targetMaximumExposure,
    valuationAsset: input.plan.valuationAsset,
    createdAtMs: input.createdAtMs,
    expiresAtMs: input.expiresAtMs,
  });
  return ok(Object.freeze({ ...semantic, digest: capitalDigest(mandateSemantic(semantic)) }));
}

export function reviseCapitalMandate(input: Readonly<ReviseCapitalMandateInput>): ContractResult<Readonly<CapitalMandate>> {
  requireContext(input.revisedAtMs, input.correlationId);
  const planIssues = planConfigurationIssues(input.plan, input.configuration);
  if (planIssues.length > 0 || !isStagedPlanConfigurationEffective(input.configuration, input.revisedAtMs)) {
    return reject('MANDATE_PLAN_INTEGRITY_INVALID', planIssues.join(',') || 'PLAN_CONFIG_NOT_EFFECTIVE', input.revisedAtMs, input.correlationId, 'revise-mandate', 'PLANNED');
  }
  const { digest: currentDigest, ...currentSemantic } = input.current;
  if (capitalDigest(mandateSemantic(currentSemantic)) !== currentDigest) return reject('CURRENT_MANDATE_DIGEST_INVALID', 'current mandate digest does not match its semantic content', input.revisedAtMs, input.correlationId, 'revise-mandate', 'PLANNED');
  if (input.plan.id !== input.current.stagedPlanId || input.plan.reservationId !== input.current.reservationId
      || input.plan.revision <= input.current.stagedPlanRevision) return reject('MANDATE_PLAN_REVISION_INVALID', 'mandate revision requires a newer revision of the same staged plan and reservation', input.revisedAtMs, input.correlationId, 'revise-mandate', 'PLANNED');
  if (input.proposalIntakeDigest !== input.plan.proposalIntakeDigest || !nonEmpty(input.proposalIntakeDigest, 256)) return reject('PROPOSAL_INTAKE_DIGEST_MISMATCH', 'revised mandate must bind the plan proposal intake digest', input.revisedAtMs, input.correlationId, 'revise-mandate', 'PLANNED');
  if (!canonicalNonNegative(input.targetMaximumExposure)
      || compareExactDecimals(input.targetMaximumExposure, maximumPlanExposure(input.plan)) !== 0) return reject('MANDATE_TARGET_MUST_EQUAL_PLAN_MAXIMUM', 'revised mandate target must equal exact plan maximum', input.revisedAtMs, input.correlationId, 'revise-mandate', 'PLANNED');
  if (!isValidUtcMillis(input.expiresAtMs) || input.revisedAtMs < input.current.createdAtMs || input.revisedAtMs >= input.current.expiresAtMs
      || input.expiresAtMs <= input.revisedAtMs || input.expiresAtMs > input.plan.expiresAtMs) return reject('MANDATE_EFFECTIVE_WINDOW_INVALID', 'revised mandate lifetime is invalid', input.revisedAtMs, input.correlationId, 'revise-mandate', 'PLANNED');
  const semantic: Omit<CapitalMandate, 'digest'> = Object.freeze({
    ...input.current,
    revision: input.current.revision + 1,
    stagedPlanRevision: input.plan.revision,
    stagedPlanDigest: input.plan.digest,
    proposalIntakeDigest: input.proposalIntakeDigest,
    configRevision: input.plan.configRevision,
    approvalId: null,
    riskDecision: null,
    targetMaximumExposure: input.targetMaximumExposure,
    valuationAsset: input.plan.valuationAsset,
    expiresAtMs: input.expiresAtMs,
  });
  const { digest: _oldDigest, ...withoutDigest } = semantic as CapitalMandate;
  return ok(Object.freeze({ ...withoutDigest, digest: capitalDigest(mandateSemantic(withoutDigest)) }));
}

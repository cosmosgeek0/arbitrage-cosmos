import {
  absoluteExactDecimal,
  actionRiskEffect,
  addExactDecimals,
  assessCapitalTruth,
  capitalDigest,
  compareExactDecimals,
  CONTROL_POSTURES,
  deriveActionIntentId,
  deriveCapitalConfigRevision,
  FUTURE_GATES,
  isCapitalLifecycleState,
  negateExactDecimal,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  POSITION_STATES,
  subtractExactDecimals,
  weakestCapitalTruth,
  type CapitalTruthState,
  type ExactDecimal,
  type FutureGate,
  type NonNegativeDecimal,
  type PositionActionIntent,
  type PositionActionIntentKind,
  type TotalExposureTarget,
  type TruthMetadata,
} from '../contracts/index.js';
import {
  isLegLifecycle,
  isPlanLifecycle,
  isReconciliationStatus,
  isValidUtcMillis,
} from '../../foundation/contracts/index.js';
import { summarizePositionExposure } from '../positions/index.js';
import type { PlannedEconomicActionIntent } from '../actions/index.js';
import type {
  CommonSupervisionPolicy,
  CommonSupervisionInput,
  SupervisionCheck,
  SupervisionDecision,
  SupervisionCheckStatus,
  SupervisionPositionBoundaryIssue,
} from './types.js';

const ZERO = '0' as NonNegativeDecimal;
export const SUPERVISION_RATIO_UNIT = 'RATIO' as const;
export const SUPERVISION_MILLISECONDS_UNIT = 'MILLISECONDS' as const;
export const SUPERVISION_COUNT_UNIT = 'COUNT' as const;

const REQUIRED_STAGE_AUTHORITY_GATES = Object.freeze([
  'OPERATOR_APPROVAL',
  'MULTI_LEG_RISK',
  'FRESH_ACCOUNT_TRUTH',
  'FRESH_MARKET_EVIDENCE',
] as const satisfies readonly FutureGate[]);

export interface IntentDirective {
  readonly kind: PositionActionIntentKind;
  readonly urgency: PositionActionIntent['urgency'];
  readonly reasons: readonly string[];
  readonly hardDeadlineMs: number | null;
  readonly evidenceIds?: readonly string[];
  readonly invalidationConditions?: readonly string[];
}

export interface UniversalAssessment {
  readonly checks: readonly Readonly<SupervisionCheck>[];
  readonly allTruthAllowsIncrease: boolean;
  readonly universalDirective: Readonly<IntentDirective> | null;
}

function sortedUnique(values: readonly string[] | unknown): readonly string[] {
  if (!Array.isArray(values)) return Object.freeze([]);
  return Object.freeze([...new Set(values.filter((value): value is string => nonEmpty(value)))]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0));
}

function check(code: string, status: SupervisionCheckStatus, detail: string, evidenceIds: readonly string[] = [], blockingForIncrease = status !== 'PASS'): Readonly<SupervisionCheck> {
  return Object.freeze({ code, status, detail, evidenceIds: sortedUnique(evidenceIds), blockingForIncrease });
}

function nonEmpty(value: unknown, maximum = 256): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value.trim() === value;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalStringList(value: unknown, requireNonEmpty = false): value is readonly string[] {
  return Array.isArray(value)
    && (!requireNonEmpty || value.length > 0)
    && value.every((entry) => nonEmpty(entry));
}

function canonicalExact(value: unknown): value is ExactDecimal {
  try {
    return normalizeExactDecimal(value) === value;
  } catch {
    return false;
  }
}

function canonicalNonNegative(value: unknown): value is NonNegativeDecimal {
  try {
    return normalizeNonNegativeExactDecimal(value) === value;
  } catch {
    return false;
  }
}

function optionalCanonicalNonNegative(value: unknown): value is NonNegativeDecimal | null {
  return value === null || canonicalNonNegative(value);
}

function safeTruth(value: unknown): value is Readonly<TruthMetadata> {
  return record(value);
}

function positionLifecycleConsistent(
  state: CommonSupervisionInput['position']['state'],
  lifecycle: CommonSupervisionInput['position']['capitalLifecycle'],
): boolean {
  if (state === 'UNKNOWN') return lifecycle === 'UNKNOWN' || lifecycle === 'RECOVERY_REQUIRED';
  return state === lifecycle;
}

function positionBoundaryIssues(input: CommonSupervisionInput): readonly SupervisionPositionBoundaryIssue[] {
  const position = input.position;
  const thesis = position.thesis;
  const issues: SupervisionPositionBoundaryIssue[] = [];
  if (!nonEmpty(position.id)) issues.push('POSITION_ID_INVALID');
  if (!nonEmpty(position.mandateId)) issues.push('POSITION_MANDATE_ID_INVALID');
  if (!positiveSafeInteger(position.revision)) issues.push('POSITION_REVISION_INVALID');
  const stateValid = (POSITION_STATES as readonly unknown[]).includes(position.state);
  const lifecycleValid = isCapitalLifecycleState(position.capitalLifecycle);
  if (!stateValid) issues.push('POSITION_STATE_INVALID');
  if (!lifecycleValid) issues.push('POSITION_CAPITAL_LIFECYCLE_INVALID');
  if (stateValid && lifecycleValid && !positionLifecycleConsistent(position.state, position.capitalLifecycle)) {
    issues.push('POSITION_STATE_LIFECYCLE_MISMATCH');
  }
  if (!isValidUtcMillis(position.openedAtMs) || position.openedAtMs > input.nowMs) {
    issues.push('POSITION_OPENED_AT_INVALID');
  }
  if (!isValidUtcMillis(position.lastTransitionAtMs) || position.lastTransitionAtMs > input.nowMs) {
    issues.push('POSITION_LAST_TRANSITION_AT_INVALID');
  }
  if (isValidUtcMillis(position.openedAtMs) && isValidUtcMillis(position.lastTransitionAtMs)
      && position.lastTransitionAtMs < position.openedAtMs) {
    issues.push('POSITION_TIME_ORDER_INVALID');
  }
  if (position.oneLegSinceMs !== null
      && (!isValidUtcMillis(position.oneLegSinceMs)
        || position.oneLegSinceMs > input.nowMs
        || (isValidUtcMillis(position.openedAtMs) && position.oneLegSinceMs < position.openedAtMs))) {
    issues.push('POSITION_ONE_LEG_SINCE_INVALID');
  }
  if (!nonEmpty(thesis.id)) issues.push('THESIS_ID_INVALID');
  if (!nonEmpty(thesis.proposalId)) issues.push('THESIS_PROPOSAL_ID_INVALID');
  if (!positiveSafeInteger(thesis.revision)) issues.push('THESIS_REVISION_INVALID');
  if (!isValidUtcMillis(thesis.openedAtMs) || thesis.openedAtMs > input.nowMs) {
    issues.push('THESIS_OPENED_AT_INVALID');
  }
  if (isValidUtcMillis(thesis.openedAtMs) && isValidUtcMillis(position.openedAtMs)
      && thesis.openedAtMs > position.openedAtMs) {
    issues.push('THESIS_TIME_ORDER_INVALID');
  }
  if (!positiveSafeInteger(thesis.expectedHorizonMs)
      || !positiveSafeInteger(thesis.maximumHoldingHorizonMs)
      || thesis.maximumHoldingHorizonMs < thesis.expectedHorizonMs) {
    issues.push('THESIS_HORIZON_INVALID');
  }
  if (!nonEmpty(thesis.configRevision)) issues.push('THESIS_CONFIG_REVISION_INVALID');
  if (!canonicalStringList(thesis.originalEvidenceIds, true)
      || !canonicalStringList(thesis.targetConditions, true)
      || !canonicalStringList(thesis.invalidationConditions, true)
      || !canonicalStringList(thesis.stopAddingConditions, true)
      || !canonicalStringList(position.outstandingActionIntentIds)) {
    issues.push('POSITION_COLLECTION_INVALID');
  }

  let geometryValid = canonicalNonNegative(position.totalGrossExposure)
    && canonicalExact(position.netDirectionalExposure)
    && (position.hedgeRatio === null || canonicalExact(position.hedgeRatio))
    && canonicalNonNegative(position.oneLegExposure)
    && Array.isArray(position.legs)
    && position.legs.length > 0;
  if (geometryValid) {
    for (const leg of position.legs) {
      if (!record(leg) || !nonEmpty(leg.id) || !nonEmpty(leg.instrumentId)
          || !nonEmpty(leg.symbol) || !nonEmpty(leg.valuationAsset)
          || (leg.side !== 'LONG' && leg.side !== 'SHORT')
          || !canonicalNonNegative(leg.quantity) || !canonicalNonNegative(leg.quoteExposure)
          || (leg.externalLifecycle !== null && !isLegLifecycle(leg.externalLifecycle))
          || !safeTruth(leg.truth)) {
        geometryValid = false;
        break;
      }
    }
  }
  if (geometryValid) {
    try {
      const summary = summarizePositionExposure(position.legs);
      geometryValid = summary.grossExposure === position.totalGrossExposure
        && summary.netDirectionalExposure === position.netDirectionalExposure
        && summary.oneLegExposure === position.oneLegExposure
        && summary.hedgeRatio === position.hedgeRatio
        && (compareExactDecimals(summary.oneLegExposure, ZERO) > 0 || position.oneLegSinceMs === null);
    } catch {
      geometryValid = false;
    }
  }
  if (!geometryValid) issues.push('POSITION_GEOMETRY_INVALID');

  const execution = position.executionReference;
  const reconciliation = position.reconciliationReference;
  const sequenceValid = (value: unknown): boolean => value === null
    || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
  const revisionValid = (value: unknown): boolean => value === null || nonEmpty(value);
  const executionValid = execution === null || (record(execution)
    && nonEmpty(execution.id) && nonEmpty(execution.externalPlanId) && nonEmpty(execution.correlationId)
    && isPlanLifecycle(execution.lifecycle) && isValidUtcMillis(execution.observedAtMs)
    && execution.observedAtMs <= input.nowMs && sequenceValid(execution.sequence)
    && revisionValid(execution.revision) && safeTruth(execution.truth));
  const reconciliationValid = reconciliation === null || (record(reconciliation)
    && nonEmpty(reconciliation.id) && nonEmpty(reconciliation.externalPlanId) && nonEmpty(reconciliation.correlationId)
    && isReconciliationStatus(reconciliation.status) && isValidUtcMillis(reconciliation.observedAtMs)
    && reconciliation.observedAtMs <= input.nowMs && sequenceValid(reconciliation.sequence)
    && revisionValid(reconciliation.revision) && canonicalStringList(reconciliation.reasonCodes)
    && safeTruth(reconciliation.truth));
  if (!executionValid || !reconciliationValid || !safeTruth(position.truth)) {
    issues.push('POSITION_EXTERNAL_REFERENCE_INVALID');
  }
  return Object.freeze([...new Set(issues)]);
}

function exactBoundValid(
  bound: CommonSupervisionInput['policy']['maximumOneLegExposure'],
  expectedUnit: string,
): boolean {
  try {
    return bound.unit === expectedUnit
      && normalizeNonNegativeExactDecimal(bound.value) === bound.value
      && normalizeNonNegativeExactDecimal(bound.minimum) === bound.minimum
      && normalizeNonNegativeExactDecimal(bound.maximum) === bound.maximum
      && compareExactDecimals(bound.minimum, bound.maximum) <= 0
      && compareExactDecimals(bound.value, bound.minimum) >= 0
      && compareExactDecimals(bound.value, bound.maximum) <= 0;
  } catch {
    return false;
  }
}

function integerBoundValid(
  bound: CommonSupervisionInput['policy']['maximumOneLegDurationMs'],
  expectedUnit: typeof SUPERVISION_MILLISECONDS_UNIT | typeof SUPERVISION_COUNT_UNIT,
): boolean {
  return bound.unit === expectedUnit
    && Number.isSafeInteger(bound.value) && Number.isSafeInteger(bound.minimum) && Number.isSafeInteger(bound.maximum)
    && bound.minimum >= 0 && bound.maximum >= bound.minimum && bound.value >= bound.minimum && bound.value <= bound.maximum;
}

function authorityCurrent(authority: CommonSupervisionPolicy['authority'], nowMs: number): boolean {
  return nonEmpty(authority.revision)
    && nonEmpty(authority.sourceId)
    && isValidUtcMillis(authority.issuedAtMs)
    && isValidUtcMillis(authority.effectiveFromMs)
    && authority.issuedAtMs <= authority.effectiveFromMs
    && authority.issuedAtMs <= nowMs
    && authority.effectiveFromMs <= nowMs
    && (authority.effectiveUntilMs === null
      || (isValidUtcMillis(authority.effectiveUntilMs)
        && authority.effectiveUntilMs > authority.effectiveFromMs
        && nowMs < authority.effectiveUntilMs));
}

function policyPayload<T extends { readonly authority: CommonSupervisionPolicy['authority'] }>(policy: Readonly<T>): unknown {
  const { authority, ...semantics } = policy;
  const { revision: _revision, ...authoritySemantics } = authority;
  return Object.freeze({ ...semantics, authority: authoritySemantics });
}

export function deriveCommonSupervisionPolicyRevision(
  policy: Readonly<CommonSupervisionPolicy>,
): CommonSupervisionPolicy['authority']['revision'] {
  return deriveCapitalConfigRevision('supervision.common-policy', policyPayload(policy));
}

export function commonSupervisionPolicyIsValid(input: CommonSupervisionInput): boolean {
  const policy = input.policy;
  try {
    return isValidUtcMillis(input.nowMs)
      && nonEmpty(policy.valuationAsset)
      && authorityCurrent(policy.authority, input.nowMs)
      && policy.authority.revision === deriveCommonSupervisionPolicyRevision(policy)
      && exactBoundValid(policy.targetHedgeRatio, SUPERVISION_RATIO_UNIT)
      && exactBoundValid(policy.maximumHedgeRatioDrift, SUPERVISION_RATIO_UNIT)
      && exactBoundValid(policy.maximumOneLegExposure, policy.valuationAsset)
      && exactBoundValid(policy.minimumExitCapacity, policy.valuationAsset)
      && exactBoundValid(policy.minimumAvailableDepth, policy.valuationAsset)
      && exactBoundValid(policy.maximumExecutableSpreadCost, policy.valuationAsset)
      && exactBoundValid(policy.maximumProjectedExitCost, policy.valuationAsset)
      && exactBoundValid(policy.maximumTotalGrossExposure, policy.valuationAsset)
      && exactBoundValid(policy.reductionTargetExposure, policy.valuationAsset)
      && integerBoundValid(policy.maximumOneLegDurationMs, SUPERVISION_MILLISECONDS_UNIT)
      && integerBoundValid(policy.emergencyOneLegDurationMs, SUPERVISION_MILLISECONDS_UNIT)
      && integerBoundValid(policy.maximumOutstandingIntents, SUPERVISION_COUNT_UNIT)
      && policy.emergencyOneLegDurationMs.value >= policy.maximumOneLegDurationMs.value
      && compareExactDecimals(policy.reductionTargetExposure.value, policy.maximumTotalGrossExposure.value) <= 0;
  } catch {
    return false;
  }
}

export function policyAuthorityCurrent(input: CommonSupervisionInput, extraAuthority?: CommonSupervisionInput['policy']['authority']): boolean {
  const authorities = [input.policy.authority, ...(extraAuthority === undefined ? [] : [extraAuthority])];
  return authorities.every((authority) => authorityCurrent(authority, input.nowMs));
}

export function reageSupervisionTruth(
  truth: Readonly<TruthMetadata>,
  nowMs: number,
): Readonly<TruthMetadata> | null {
  try {
    if (!safeTruth(truth)) return null;
    if (!isValidUtcMillis(nowMs) || !isValidUtcMillis(truth.evaluatedAtMs) || truth.evaluatedAtMs > nowMs) return null;
    const current = assessCapitalTruth({
      source: truth.source,
      evaluatedAtMs: nowMs,
      requiredValuePresent: truth.completeness !== 'UNKNOWN',
      divergent: truth.completeness === 'DIVERGENT',
      reasons: truth.reasons,
      evidenceReferences: truth.evidenceReferences,
      revision: truth.revision,
    });
    return Object.freeze({
      ...current,
      completeness: weakestCapitalTruth([truth.completeness, current.completeness]),
    });
  } catch {
    return null;
  }
}

export function supervisionTruthStateAt(truth: Readonly<TruthMetadata>, nowMs: number): CapitalTruthState {
  if (safeTruth(truth) && truth.completeness === 'DIVERGENT') return 'DIVERGENT';
  return reageSupervisionTruth(truth, nowMs)?.completeness ?? 'UNKNOWN';
}

export function supervisionTruthAllowsIncreaseAt(truth: Readonly<TruthMetadata>, nowMs: number): boolean {
  const current = reageSupervisionTruth(truth, nowMs);
  return current !== null
    && current.completeness === 'COMPLETE'
    && current.freshness.state === 'FRESH'
    && current.freshness.effectiveAuthority !== 'UNAVAILABLE';
}

function truthStatus(truth: Readonly<TruthMetadata>, nowMs: number): SupervisionCheckStatus {
  const state = supervisionTruthStateAt(truth, nowMs);
  if (state === 'DIVERGENT') return 'BREACH';
  return supervisionTruthAllowsIncreaseAt(truth, nowMs) ? 'PASS' : 'UNKNOWN';
}

function truthDetail(truth: Readonly<TruthMetadata>, nowMs: number): string {
  const current = reageSupervisionTruth(truth, nowMs);
  return current === null ? 'UNKNOWN/MALFORMED_OR_FUTURE_TRUTH' : `${current.completeness}/${current.freshness.state}`;
}

function hasBothSides(input: CommonSupervisionInput): boolean {
  return input.expectedLegs.some((leg) => leg.side === 'LONG') && input.expectedLegs.some((leg) => leg.side === 'SHORT');
}

function policyCheck(input: CommonSupervisionInput): Readonly<SupervisionCheck> {
  const valid = commonSupervisionPolicyIsValid(input);
  return check('POLICY_AUTHORITY', valid ? 'PASS' : 'UNKNOWN', valid
    ? `content-addressed policy ${input.policy.authority.revision} is current, unit-bound, and bounded`
    : 'policy is expired, future, malformed, wrong-unit, non-canonical, content-mismatched, or internally inconsistent');
}

function reconciliationCheck(input: CommonSupervisionInput): Readonly<SupervisionCheck> {
  const reference = input.position.reconciliationReference;
  if (reference === null) return check('RECONCILIATION', 'UNKNOWN', 'Foundation reconciliation reference is missing');
  const currentState = supervisionTruthStateAt(reference.truth, input.nowMs);
  if (reference.status === 'DIVERGED' || reference.status === 'AMBIGUOUS' || currentState === 'DIVERGENT') return check('RECONCILIATION', 'BREACH', `Foundation reconciliation is ${reference.status}`, reference.reasonCodes);
  if (reference.status !== 'EXACT' || !supervisionTruthAllowsIncreaseAt(reference.truth, input.nowMs)) return check('RECONCILIATION', 'UNKNOWN', `Foundation reconciliation is ${reference.status}/${currentState}`, reference.reasonCodes);
  return check('RECONCILIATION', 'PASS', 'Foundation reconciliation is exact and current', reference.reasonCodes, false);
}

function expectedLegChecks(input: CommonSupervisionInput): readonly Readonly<SupervisionCheck>[] {
  const missing: string[] = [];
  const zeroQuantity: string[] = [];
  const truthIssues: string[] = [];
  for (const expected of input.expectedLegs) {
    const leg = input.position.legs.find((candidate) => candidate.instrumentId === expected.instrumentId && candidate.side === expected.side);
    if (leg === undefined) missing.push(`${expected.instrumentId}:${expected.side}`);
    else {
      if (compareExactDecimals(leg.quantity, ZERO) <= 0 || compareExactDecimals(leg.quoteExposure, ZERO) <= 0) zeroQuantity.push(leg.id);
      if (!supervisionTruthAllowsIncreaseAt(leg.truth, input.nowMs)) truthIssues.push(leg.id);
    }
  }
  return Object.freeze([
    check('LEG_PRESENCE_AND_SIDE', missing.length === 0 ? 'PASS' : 'BREACH', missing.length === 0 ? 'all expected instruments/sides are present' : `missing ${missing.join(',')}`, missing),
    check('LEG_QUANTITY', zeroQuantity.length === 0 ? 'PASS' : 'BREACH', zeroQuantity.length === 0 ? 'expected legs have positive exact quantities/exposure' : `zero or absent exposure on ${zeroQuantity.join(',')}`, zeroQuantity),
    check('LEG_FRESHNESS', truthIssues.length === 0 ? 'PASS' : 'UNKNOWN', truthIssues.length === 0 ? 'leg truth is fresh and complete' : `leg truth incomplete for ${truthIssues.join(',')}`, truthIssues),
  ]);
}

interface StageAuthorityAssessment {
  readonly valid: boolean;
  readonly resultingTotalExposure: NonNegativeDecimal | null;
  readonly references: readonly string[];
  readonly detail: string;
}

function stageAuthorityAssessment(
  input: CommonSupervisionInput,
  commonPolicyValid: boolean,
): Readonly<StageAuthorityAssessment> {
  const authority = input.nextStageAuthority;
  const binding = input.activeStageAuthority;
  if (authority === null) return Object.freeze({
    valid: false,
    resultingTotalExposure: null,
    references: Object.freeze([]),
    detail: 'no stages-lane transition authorization supplied',
  });
  const references = sortedUnique([
    authority.planId,
    authority.reservationId ?? '',
    authority.approvalId ?? '',
  ]);
  try {
    if (binding === null
      || !nonEmpty(binding.planId) || !positiveSafeInteger(binding.planRevision) || !nonEmpty(binding.planDigest)
      || !nonEmpty(binding.reservationId) || !positiveSafeInteger(binding.reservationRevision)
      || !nonEmpty(binding.approvalId) || !positiveSafeInteger(binding.approvalRevision)) {
      return Object.freeze({ valid: false, resultingTotalExposure: null, references, detail: 'independent active-stage binding is absent or malformed' });
    }
    const consumption = normalizeNonNegativeExactDecimal(authority.reservationConsumption);
    const available = authority.reservationAvailable === null
      ? null
      : normalizeNonNegativeExactDecimal(authority.reservationAvailable);
    const resulting = normalizeNonNegativeExactDecimal(addExactDecimals(input.position.totalGrossExposure, consumption));
    const futureGatesValid = Array.isArray(authority.requiredFutureGates)
      && new Set(authority.requiredFutureGates).size === authority.requiredFutureGates.length
      && authority.requiredFutureGates.every((gate) => (FUTURE_GATES as readonly string[]).includes(gate))
      && REQUIRED_STAGE_AUTHORITY_GATES.every((gate) => authority.requiredFutureGates.includes(gate));
    const valid = commonPolicyValid
      && authority.to === 'ADD'
      && authority.from === binding.activeStage
      && authority.authorizedForExternalRiskEvaluation === true
      && authority.executionReady === false
      && isValidUtcMillis(authority.evaluatedAtMs)
      && authority.evaluatedAtMs === input.nowMs
      && authority.planId === binding.planId
      && authority.planRevision === binding.planRevision
      && authority.planDigest === binding.planDigest
      && authority.reservationId === binding.reservationId
      && authority.reservationRevision === binding.reservationRevision
      && authority.approvalId === binding.approvalId
      && authority.approvalRevision === binding.approvalRevision
      && consumption === authority.reservationConsumption
      && compareExactDecimals(consumption, ZERO) > 0
      && available !== null
      && available === authority.reservationAvailable
      && compareExactDecimals(available, consumption) >= 0
      && futureGatesValid
      && compareExactDecimals(resulting, input.policy.maximumTotalGrossExposure.value) <= 0;
    return Object.freeze({
      valid,
      resultingTotalExposure: valid ? resulting : null,
      references,
      detail: valid
        ? `bound stages-lane ADD authorization consumes ${consumption} and targets ${resulting}`
        : 'stage authorization is stale, unbound, malformed, under-reserved, missing future gates, or exceeds the portfolio cap',
    });
  } catch {
    return Object.freeze({ valid: false, resultingTotalExposure: null, references, detail: 'stage authorization contains malformed exact amounts' });
  }
}

function freezeStageTransitionAuthorization(
  authority: NonNullable<CommonSupervisionInput['nextStageAuthority']>,
): Readonly<NonNullable<CommonSupervisionInput['nextStageAuthority']>> {
  return Object.freeze({
    ...authority,
    requiredFutureGates: Object.freeze([...authority.requiredFutureGates]),
  });
}

export function evaluateUniversalSupervision(input: CommonSupervisionInput): Readonly<UniversalAssessment> {
  if (!isValidUtcMillis(input.nowMs)) throw new TypeError('supervision requires injected UTC time');
  const boundaryIssues = positionBoundaryIssues(input);
  const invalidSourceBinding = boundaryIssues.filter((issue) => issue === 'POSITION_ID_INVALID'
    || issue === 'POSITION_REVISION_INVALID'
    || issue === 'THESIS_ID_INVALID'
    || issue === 'THESIS_REVISION_INVALID');
  if (invalidSourceBinding.length > 0) {
    // PositionActionIntent requires positive source revisions and canonical
    // source IDs.  Returning a NO_ACTION_UNKNOWN with the hostile values would
    // still launder an invalid authority binding into an apparently typed
    // intent, so the public boundary rejects it deterministically instead.
    throw new TypeError(`supervision source binding invalid: ${invalidSourceBinding.join(',')}`);
  }
  if (boundaryIssues.length > 0) {
    const boundaryCheck = check(
      'POSITION_BOUNDARY',
      'UNKNOWN',
      `position projection boundary rejected: ${boundaryIssues.join(',')}`,
    );
    return Object.freeze({
      checks: Object.freeze([boundaryCheck]),
      allTruthAllowsIncrease: false,
      universalDirective: Object.freeze({
        kind: 'NO_ACTION_UNKNOWN',
        urgency: 'URGENT',
        reasons: Object.freeze(['POSITION_PROJECTION_INVALID', ...boundaryIssues]),
        hardDeadlineMs: null,
        invalidationConditions: Object.freeze([]),
      }),
    });
  }
  const commonPolicyValid = commonSupervisionPolicyIsValid(input);
  const checks: Readonly<SupervisionCheck>[] = [];
  checks.push(policyCheck(input));
  checks.push(check('POSITION_TRUTH', truthStatus(input.position.truth, input.nowMs), truthDetail(input.position.truth, input.nowMs), input.position.truth.evidenceReferences));
  checks.push(check('EXECUTION_REFERENCE', input.position.executionReference !== null && supervisionTruthAllowsIncreaseAt(input.position.executionReference.truth, input.nowMs) ? 'PASS' : 'UNKNOWN', input.position.executionReference === null ? 'Foundation execution reference is missing' : `${input.position.executionReference.lifecycle}/${supervisionTruthStateAt(input.position.executionReference.truth, input.nowMs)}`));
  checks.push(reconciliationCheck(input));
  const expectedLegsValid = Array.isArray(input.expectedLegs)
    && input.expectedLegs.length > 0
    && input.expectedLegs.every((leg) => record(leg) && nonEmpty(leg.instrumentId)
      && (leg.side === 'LONG' || leg.side === 'SHORT'));
  if (expectedLegsValid) checks.push(...expectedLegChecks(input));
  else checks.push(check('EXPECTED_LEG_SPEC', 'UNKNOWN', 'expected leg identities or sides are malformed'));
  const valuationBound = nonEmpty(input.policy.valuationAsset)
    && input.position.legs.length > 0
    && input.position.legs.every((leg) => nonEmpty(leg.valuationAsset) && leg.valuationAsset === input.policy.valuationAsset);
  checks.push(check('VALUATION_ASSET_BINDING', valuationBound ? 'PASS' : 'UNKNOWN', valuationBound
    ? `all position legs are valued in ${input.policy.valuationAsset}`
    : 'policy valuation asset is missing or differs from at least one position leg'));

  const paired = expectedLegsValid && hasBothSides(input);
  const hedgeDrift = !commonPolicyValid || input.position.hedgeRatio === null
    ? null
    : absoluteExactDecimal(subtractExactDecimals(input.position.hedgeRatio, input.policy.targetHedgeRatio.value));
  checks.push(check('HEDGE_RATIO', !paired ? 'PASS' : !commonPolicyValid || hedgeDrift === null ? 'UNKNOWN' : compareExactDecimals(hedgeDrift, input.policy.maximumHedgeRatioDrift.value) > 0 ? 'BREACH' : 'PASS', !paired ? 'directional position has no two-leg hedge requirement' : hedgeDrift === null ? 'hedge ratio is unknown' : `hedge drift ${hedgeDrift}`));

  let oneLegStatus: SupervisionCheckStatus = 'PASS';
  let oneLegDetail = 'no one-leg exposure';
  let durationStatus: SupervisionCheckStatus = 'PASS';
  let durationDetail = 'no one-leg duration';
  if (paired && compareExactDecimals(input.position.oneLegExposure, ZERO) > 0) {
    oneLegStatus = !commonPolicyValid ? 'UNKNOWN' : compareExactDecimals(input.position.oneLegExposure, input.policy.maximumOneLegExposure.value) > 0 ? 'BREACH' : 'WATCH';
    oneLegDetail = `one-leg exposure ${input.position.oneLegExposure}`;
    if (input.position.oneLegSinceMs === null) {
      durationStatus = 'UNKNOWN';
      durationDetail = 'one-leg start time is missing';
    } else {
      const duration = input.nowMs - input.position.oneLegSinceMs;
      durationStatus = !commonPolicyValid ? 'UNKNOWN' : duration > input.policy.maximumOneLegDurationMs.value ? 'BREACH' : 'WATCH';
      durationDetail = `one-leg duration ${duration}ms`;
    }
  }
  checks.push(check('ONE_LEG_EXPOSURE', oneLegStatus, oneLegDetail));
  checks.push(check('ONE_LEG_DURATION', durationStatus, durationDetail));

  const spreadValid = optionalCanonicalNonNegative(input.market.executableSpreadCost);
  const depthValid = optionalCanonicalNonNegative(input.market.availableDepth);
  const exitCapacityValid = optionalCanonicalNonNegative(input.market.exitCapacity);
  const projectedExitCostValid = optionalCanonicalNonNegative(input.market.projectedExitCost);
  checks.push(check('MARKET_FRESHNESS', truthStatus(input.market.truth, input.nowMs), truthDetail(input.market.truth, input.nowMs), input.market.evidenceIds));
  checks.push(check('SPREAD_COST', !commonPolicyValid || !spreadValid || input.market.executableSpreadCost === null ? 'UNKNOWN' : compareExactDecimals(input.market.executableSpreadCost, input.policy.maximumExecutableSpreadCost.value) > 0 ? 'BREACH' : 'PASS', !spreadValid ? 'executable spread cost is malformed' : input.market.executableSpreadCost === null ? 'executable spread cost is missing' : `spread cost ${input.market.executableSpreadCost}`, input.market.evidenceIds));
  checks.push(check('MARKET_DEPTH', !commonPolicyValid || !depthValid || input.market.availableDepth === null ? 'UNKNOWN' : compareExactDecimals(input.market.availableDepth, input.policy.minimumAvailableDepth.value) < 0 ? 'BREACH' : 'PASS', !depthValid ? 'available depth is malformed' : input.market.availableDepth === null ? 'available depth is missing' : `available depth ${input.market.availableDepth}`, input.market.evidenceIds));
  checks.push(check('EXIT_CAPACITY', !commonPolicyValid || !exitCapacityValid || input.market.exitCapacity === null ? 'UNKNOWN' : compareExactDecimals(input.market.exitCapacity, input.policy.minimumExitCapacity.value) < 0 ? 'BREACH' : 'PASS', !exitCapacityValid ? 'exit capacity is malformed' : input.market.exitCapacity === null ? 'exit capacity is missing' : `exit capacity ${input.market.exitCapacity}`, input.market.evidenceIds));
  checks.push(check('PROJECTED_EXIT_COST', !commonPolicyValid || !projectedExitCostValid || input.market.projectedExitCost === null ? 'UNKNOWN' : compareExactDecimals(input.market.projectedExitCost, input.policy.maximumProjectedExitCost.value) > 0 ? 'BREACH' : 'PASS', !projectedExitCostValid ? 'projected exit cost is malformed' : input.market.projectedExitCost === null ? 'projected exit cost is missing' : `projected exit cost ${input.market.projectedExitCost}`, input.market.evidenceIds));
  const accruedCostValid = input.costs.accruedKnownCost === null || canonicalExact(input.costs.accruedKnownCost);
  const projectedCostValid = optionalCanonicalNonNegative(input.costs.projectedAdditionalCost);
  checks.push(check('CURRENT_AND_PROJECTED_COST', !accruedCostValid || !projectedCostValid || input.costs.projectedAdditionalCost === null || input.costs.accruedKnownCost === null || !supervisionTruthAllowsIncreaseAt(input.costs.truth, input.nowMs) ? 'UNKNOWN' : 'PASS', !accruedCostValid || !projectedCostValid ? 'current/projected costs are malformed' : input.costs.projectedAdditionalCost === null || input.costs.accruedKnownCost === null ? 'current/projected costs incomplete' : `accrued ${input.costs.accruedKnownCost}; projected ${input.costs.projectedAdditionalCost}`, input.costs.sourceIds));
  const supportingEvidenceIds = sortedUnique(input.thesisAssessment.supportingEvidenceIds);
  const conflictingEvidenceIds = sortedUnique(input.thesisAssessment.conflictingEvidenceIds);
  const reasonCodes = sortedUnique(input.thesisAssessment.reasonCodes);
  const thesisCollectionsValid = canonicalStringList(input.thesisAssessment.supportingEvidenceIds)
    && canonicalStringList(input.thesisAssessment.conflictingEvidenceIds)
    && canonicalStringList(input.thesisAssessment.reasonCodes);
  const invalidatedValid = input.thesisAssessment.invalidated === null || typeof input.thesisAssessment.invalidated === 'boolean';
  const targetReachedValid = input.thesisAssessment.targetReached === null || typeof input.thesisAssessment.targetReached === 'boolean';
  checks.push(check('THESIS_TRUTH', truthStatus(input.thesisAssessment.truth, input.nowMs), truthDetail(input.thesisAssessment.truth, input.nowMs), [...supportingEvidenceIds, ...conflictingEvidenceIds]));
  checks.push(check('THESIS_INVALIDATION', !thesisCollectionsValid || !invalidatedValid || input.thesisAssessment.invalidated === null ? 'UNKNOWN' : input.thesisAssessment.invalidated ? 'BREACH' : 'PASS', !thesisCollectionsValid || !invalidatedValid ? 'thesis invalidation facts are malformed' : input.thesisAssessment.invalidated === null ? 'thesis invalidation is unknown' : input.thesisAssessment.invalidated ? reasonCodes.join(',') || 'thesis invalidated' : 'thesis remains valid', conflictingEvidenceIds));
  checks.push(check('THESIS_TARGET', !thesisCollectionsValid || !targetReachedValid || input.thesisAssessment.targetReached === null ? 'UNKNOWN' : input.thesisAssessment.targetReached ? 'WATCH' : 'PASS', !thesisCollectionsValid || !targetReachedValid ? 'thesis target facts are malformed' : input.thesisAssessment.targetReached === null ? 'thesis target assessment is unknown' : input.thesisAssessment.targetReached ? 'original thesis target reached' : 'original thesis target not yet reached', supportingEvidenceIds));
  const age = input.nowMs - input.position.thesis.openedAtMs;
  checks.push(check('THESIS_AGE', age >= input.position.thesis.maximumHoldingHorizonMs ? 'BREACH' : age >= input.position.thesis.expectedHorizonMs ? 'WATCH' : 'PASS', `thesis age ${age}ms of maximum ${input.position.thesis.maximumHoldingHorizonMs}ms`));
  checks.push(check('GROSS_EXPOSURE_LIMIT', !commonPolicyValid ? 'UNKNOWN' : compareExactDecimals(input.position.totalGrossExposure, input.policy.maximumTotalGrossExposure.value) > 0 ? 'BREACH' : 'PASS', `gross ${input.position.totalGrossExposure}; limit ${input.policy.maximumTotalGrossExposure.value}`));
  checks.push(check('OUTSTANDING_INTENTS', !commonPolicyValid ? 'UNKNOWN' : input.position.outstandingActionIntentIds.length > input.policy.maximumOutstandingIntents.value ? 'BREACH' : input.position.outstandingActionIntentIds.length > 0 ? 'WATCH' : 'PASS', `${input.position.outstandingActionIntentIds.length} outstanding intent(s)`));
  const controlTruthCurrent = supervisionTruthAllowsIncreaseAt(input.controlPosture.truth, input.nowMs);
  const controlPostureValid = (CONTROL_POSTURES as readonly unknown[]).includes(input.controlPosture.posture)
    && (input.controlPosture.revision === null || nonEmpty(input.controlPosture.revision))
    && canonicalStringList(input.controlPosture.reasonCodes);
  checks.push(check('CONTROL_POSTURE', !controlPostureValid ? 'UNKNOWN' : input.controlPosture.posture === 'OPEN' && controlTruthCurrent ? 'PASS' : 'WATCH', !controlPostureValid ? 'control posture facts are malformed' : `${input.controlPosture.posture}/${supervisionTruthStateAt(input.controlPosture.truth, input.nowMs)}`, input.controlPosture.reasonCodes, !controlPostureValid || input.controlPosture.posture !== 'OPEN' || !controlTruthCurrent));
  const actionCostsValid = optionalCanonicalNonNegative(input.economicCostOfWaiting)
    && optionalCanonicalNonNegative(input.expectedCostOfActing);
  checks.push(check('ACTION_COST_CONTEXT', actionCostsValid ? 'PASS' : 'UNKNOWN', actionCostsValid
    ? 'economic wait/act costs are canonical or explicitly unknown'
    : 'economic wait/act costs are malformed'));
  const stage = stageAuthorityAssessment(input, commonPolicyValid);
  checks.push(check('NEXT_STAGE_AUTHORITY', input.nextStageAuthority === null ? 'WATCH' : stage.valid ? 'PASS' : 'BREACH', stage.detail, stage.references, true));

  const byCode = (code: string): Readonly<SupervisionCheck> => checks.find((entry) => entry.code === code) as Readonly<SupervisionCheck>;
  let universalDirective: Readonly<IntentDirective> | null = null;
  if (input.position.state === 'CLOSED') universalDirective = Object.freeze({ kind: 'HOLD', urgency: 'ROUTINE', reasons: Object.freeze(['POSITION_CLOSED']), hardDeadlineMs: null });
  else if (paired && compareExactDecimals(input.position.oneLegExposure, ZERO) > 0) {
    const duration = input.position.oneLegSinceMs === null ? null : input.nowMs - input.position.oneLegSinceMs;
    const reconciliationUncertain = byCode('RECONCILIATION').status !== 'PASS' || input.position.state === 'RECOVERY_REQUIRED';
    if (reconciliationUncertain) universalDirective = Object.freeze({ kind: 'REQUEST_EMERGENCY_UNWIND', urgency: 'EMERGENCY', reasons: Object.freeze(['ONE_LEG_RECONCILIATION_UNCERTAIN']), hardDeadlineMs: input.nowMs });
    else if (!commonPolicyValid) universalDirective = Object.freeze({ kind: 'REQUEST_EMERGENCY_UNWIND', urgency: 'EMERGENCY', reasons: Object.freeze(['ONE_LEG_SUPERVISION_POLICY_INVALID']), hardDeadlineMs: input.nowMs });
    else if (duration === null || duration > input.policy.emergencyOneLegDurationMs.value) universalDirective = Object.freeze({ kind: 'REQUEST_EMERGENCY_UNWIND', urgency: 'EMERGENCY', reasons: Object.freeze(['ONE_LEG_DURATION_EMERGENCY']), hardDeadlineMs: input.nowMs });
    else universalDirective = Object.freeze({ kind: 'REQUEST_HEDGE', urgency: byCode('ONE_LEG_EXPOSURE').status === 'BREACH' || byCode('ONE_LEG_DURATION').status === 'BREACH' ? 'URGENT' : 'ELEVATED', reasons: Object.freeze(['ONE_LEG_EXPOSURE']), hardDeadlineMs: input.nowMs - duration + input.policy.maximumOneLegDurationMs.value });
  } else if (byCode('RECONCILIATION').status !== 'PASS' || input.position.state === 'RECOVERY_REQUIRED') universalDirective = Object.freeze({ kind: 'FREEZE_NEW_ACTIONS', urgency: byCode('RECONCILIATION').status === 'BREACH' ? 'EMERGENCY' : 'URGENT', reasons: Object.freeze(['RECONCILIATION_NOT_EXACT', `POSITION_${input.position.state}`]), hardDeadlineMs: null });
  else if (byCode('THESIS_INVALIDATION').status === 'BREACH' || byCode('THESIS_AGE').status === 'BREACH' || byCode('THESIS_TARGET').status === 'WATCH') universalDirective = Object.freeze({ kind: 'REQUEST_EXIT', urgency: byCode('THESIS_TARGET').status === 'WATCH' ? 'ROUTINE' : 'URGENT', reasons: Object.freeze([byCode('THESIS_INVALIDATION').status === 'BREACH' ? 'THESIS_INVALIDATED' : byCode('THESIS_TARGET').status === 'WATCH' ? 'THESIS_TARGET_REACHED' : 'MAXIMUM_HOLDING_HORIZON']), hardDeadlineMs: input.nowMs });
  else if (byCode('GROSS_EXPOSURE_LIMIT').status === 'BREACH') universalDirective = Object.freeze({ kind: 'REDUCE', urgency: 'URGENT', reasons: Object.freeze(['GROSS_EXPOSURE_LIMIT_BREACH']), hardDeadlineMs: input.nowMs });
  else if (byCode('MARKET_DEPTH').status === 'BREACH' || byCode('EXIT_CAPACITY').status === 'BREACH') universalDirective = Object.freeze({ kind: 'REDUCE', urgency: 'ELEVATED', reasons: Object.freeze(['MARKET_EXIT_CAPACITY_DETERIORATED']), hardDeadlineMs: null });
  else if (byCode('OUTSTANDING_INTENTS').status === 'BREACH') universalDirective = Object.freeze({ kind: 'FREEZE_NEW_ACTIONS', urgency: 'ELEVATED', reasons: Object.freeze(['OUTSTANDING_INTENT_LIMIT']), hardDeadlineMs: null });

  const allTruthAllowsIncrease = checks.every((entry) => entry.status === 'PASS');
  return Object.freeze({ checks: Object.freeze(checks), allTruthAllowsIncrease, universalDirective });
}

function gatesFor(kind: PositionActionIntentKind): readonly FutureGate[] {
  if (kind === 'ADD_STAGE') return Object.freeze(['OPERATOR_APPROVAL', 'MULTI_LEG_RISK', 'EXECUTION_COORDINATOR', 'RECONCILIATION', 'FRESH_ACCOUNT_TRUTH', 'FRESH_MARKET_EVIDENCE']);
  if (kind === 'REDUCE' || kind === 'REQUEST_HEDGE' || kind === 'REQUEST_EXIT' || kind === 'REQUEST_EMERGENCY_UNWIND') return Object.freeze(['MULTI_LEG_RISK', 'EXECUTION_COORDINATOR', 'RECONCILIATION', 'FRESH_ACCOUNT_TRUTH', 'FRESH_MARKET_EVIDENCE']);
  if (kind === 'FREEZE_NEW_ACTIONS') return Object.freeze(['RECONCILIATION']);
  return Object.freeze([]);
}

function targetFor(input: CommonSupervisionInput, kind: PositionActionIntentKind) {
  const policyValid = commonSupervisionPolicyIsValid(input);
  const positionLegs = ((Array.isArray(input.position.legs)
    ? input.position.legs.filter((leg) => record(leg))
    : []) as unknown) as CommonSupervisionInput['position']['legs'];
  const fallbackValuationAsset = positionLegs.find((leg) => nonEmpty(leg.valuationAsset))?.valuationAsset;
  const valuationAsset: string = policyValid
    ? input.policy.valuationAsset
    : fallbackValuationAsset
      ?? (nonEmpty(input.policy.valuationAsset) ? input.policy.valuationAsset : 'UNKNOWN');
  const targetHedgeRatio = policyValid ? input.policy.targetHedgeRatio.value : null;
  const total = (quoteNotional: NonNegativeDecimal): Readonly<TotalExposureTarget> => Object.freeze({ kind: 'TOTAL', valuationAsset, quoteNotional, baseQuantity: null, targetHedgeRatio });
  if (kind === 'NO_ACTION_UNKNOWN') return Object.freeze({ kind: 'UNKNOWN' as const, valuationAsset, reasonCodes: Object.freeze(['EXPOSURE_TARGET_UNSAFE_TO_DERIVE']) });
  if (kind === 'ADD_STAGE') {
    const consumption = normalizeNonNegativeExactDecimal(input.nextStageAuthority?.reservationConsumption ?? ZERO);
    return total(normalizeNonNegativeExactDecimal(addExactDecimals(input.position.totalGrossExposure, consumption)));
  }
  if (kind === 'REDUCE') {
    const configured = policyValid ? normalizeNonNegativeExactDecimal(input.policy.reductionTargetExposure.value) : ZERO;
    return total(compareExactDecimals(configured, input.position.totalGrossExposure) < 0 ? configured : ZERO);
  }
  if (kind === 'REQUEST_HEDGE') return Object.freeze({ kind: 'DELTA' as const, valuationAsset, quoteNotional: negateExactDecimal(input.position.netDirectionalExposure), baseQuantity: null, targetHedgeRatio });
  if (kind === 'REQUEST_EXIT' || kind === 'REQUEST_EMERGENCY_UNWIND') return total(ZERO);
  return total(normalizeNonNegativeExactDecimal(input.position.totalGrossExposure));
}

export function buildSupervisionDecision(
  strategy: 'BASIS' | 'VOLUME',
  input: CommonSupervisionInput,
  checks: readonly Readonly<SupervisionCheck>[],
  directive: Readonly<IntentDirective>,
  strategyTruths: readonly Readonly<TruthMetadata>[],
  strategyDecisionInput: unknown,
): Readonly<SupervisionDecision> {
  const target = targetFor(input, directive.kind);
  const supportingEvidenceIds = sortedUnique([
    ...sortedUnique(directive.evidenceIds),
    ...sortedUnique(input.thesisAssessment.supportingEvidenceIds),
  ]);
  const conflictingEvidenceIds = sortedUnique(input.thesisAssessment.conflictingEvidenceIds);
  const blockingFacts = sortedUnique(checks.filter((entry) => entry.status === 'UNKNOWN').map((entry) => entry.code));
  const positionLegs = ((Array.isArray(input.position.legs)
    ? input.position.legs.filter((leg) => record(leg))
    : []) as unknown) as CommonSupervisionInput['position']['legs'];
  const truthStates: CapitalTruthState[] = [
    supervisionTruthStateAt(input.position.truth, input.nowMs),
    ...positionLegs.map((leg) => supervisionTruthStateAt(leg.truth, input.nowMs)),
    ...(input.position.executionReference === null ? [] : [supervisionTruthStateAt(input.position.executionReference.truth, input.nowMs)]),
    ...(input.position.reconciliationReference === null ? [] : [supervisionTruthStateAt(input.position.reconciliationReference.truth, input.nowMs)]),
    supervisionTruthStateAt(input.market.truth, input.nowMs),
    supervisionTruthStateAt(input.costs.truth, input.nowMs),
    supervisionTruthStateAt(input.thesisAssessment.truth, input.nowMs),
    supervisionTruthStateAt(input.controlPosture.truth, input.nowMs),
    ...strategyTruths.map((truth) => supervisionTruthStateAt(truth, input.nowMs)),
  ];
  const sourceCompleteness = weakestCapitalTruth(truthStates);
  const completeness = sourceCompleteness === 'COMPLETE' && checks.some((entry) => entry.status === 'UNKNOWN')
    ? 'UNKNOWN'
    : sourceCompleteness;
  const why = sortedUnique(directive.reasons);
  const requiredFutureGates = gatesFor(directive.kind);
  const invalidationConditions = sortedUnique(directive.invalidationConditions ?? input.position.thesis.invalidationConditions);
  const economicCostOfWaiting = optionalCanonicalNonNegative(input.economicCostOfWaiting)
    ? input.economicCostOfWaiting
    : null;
  const expectedCostOfActing = optionalCanonicalNonNegative(input.expectedCostOfActing)
    ? input.expectedCostOfActing
    : null;
  const stageTransitionAuthorization = directive.kind === 'ADD_STAGE' && input.nextStageAuthority !== null
    ? freezeStageTransitionAuthorization(input.nextStageAuthority)
    : null;
  const authorityProjection = Object.freeze({
    stageTransitionAuthorization,
    directionalReductionGeometry: null,
  });
  let decisionInputDigest: string;
  try {
    decisionInputDigest = capitalDigest({ common: input, strategy: strategyDecisionInput, checks });
  } catch {
    decisionInputDigest = capitalDigest({
      malformedSupervisionInput: true,
      strategy,
      positionId: input.position.id,
      positionRevision: input.position.revision,
      thesisId: input.position.thesis.id,
      thesisRevision: input.position.thesis.revision,
      checks,
    });
  }
  const semantic = {
    strategy,
    positionId: input.position.id,
    positionRevision: input.position.revision,
    thesisId: input.position.thesis.id,
    thesisRevision: input.position.thesis.revision,
    kind: directive.kind,
    target,
    urgency: directive.urgency,
    hardDeadlineMs: directive.hardDeadlineMs,
    why,
    supportingEvidenceIds,
    conflictingEvidenceIds,
    requiredFutureGates,
    completeness,
    blockingFacts,
    economicCostOfWaiting,
    expectedCostOfActing,
    invalidationConditions,
    ...authorityProjection,
    decisionInputDigest,
    evaluatedAtMs: input.nowMs,
  };
  const digest = capitalDigest(semantic);
  const base = {
    id: deriveActionIntentId(semantic),
    positionId: input.position.id,
    sourcePositionRevision: input.position.revision,
    sourceThesisId: input.position.thesis.id,
    sourceThesisRevision: input.position.thesis.revision,
    target,
    urgency: directive.urgency,
    hardDeadlineMs: directive.hardDeadlineMs,
    why,
    supportingEvidenceIds,
    conflictingEvidenceIds,
    requiredFutureGates,
    completeness,
    blockingFacts,
    idempotencyKey: `capital-supervision:${digest}`,
    correlationKey: `capital-position:${input.position.id}:r${input.position.revision}`,
    economicCostOfWaiting,
    expectedCostOfActing,
    invalidationConditions,
    ...authorityProjection,
    createdAtMs: input.nowMs,
  };
  let intent: PlannedEconomicActionIntent;
  switch (directive.kind) {
    case 'ADD_STAGE': intent = Object.freeze({ ...base, kind: directive.kind, riskEffect: 'RISK_INCREASING', target: target as Exclude<typeof target, { kind: 'UNKNOWN' }> }); break;
    case 'REDUCE':
    case 'REQUEST_HEDGE':
    case 'REQUEST_EXIT':
    case 'REQUEST_EMERGENCY_UNWIND': intent = Object.freeze({ ...base, kind: directive.kind, riskEffect: 'RISK_REDUCING', target: target as Exclude<typeof target, { kind: 'UNKNOWN' }> }); break;
    case 'NO_ACTION_UNKNOWN': intent = Object.freeze({ ...base, kind: directive.kind, riskEffect: 'NO_CHANGE', target: target as Extract<typeof target, { kind: 'UNKNOWN' }> }); break;
    case 'HOLD':
    case 'FREEZE_NEW_ACTIONS': intent = Object.freeze({ ...base, kind: directive.kind, riskEffect: 'NO_CHANGE' }); break;
  }
  if (intent.riskEffect !== actionRiskEffect(intent.kind)) throw new TypeError('supervision intent risk direction mismatch');
  return Object.freeze({ strategy, positionId: input.position.id, positionRevision: input.position.revision, thesisRevision: input.position.thesis.revision, priority: 'EXPOSED_CAPITAL', intent, checks: Object.freeze([...checks]), evaluatedAtMs: input.nowMs, decisionKey: digest });
}

export function appendChecks(base: readonly Readonly<SupervisionCheck>[], additions: readonly Readonly<SupervisionCheck>[]): readonly Readonly<SupervisionCheck>[] {
  return Object.freeze([...base, ...additions]);
}

export function strategyCheck(code: string, status: SupervisionCheckStatus, detail: string, evidenceIds: readonly string[] = []): Readonly<SupervisionCheck> {
  return check(code, status, detail, evidenceIds);
}

export function signalStatus(state: 'PRESENT' | 'ABSENT' | 'UNKNOWN', strength: ExactDecimal | null, threshold: ExactDecimal, breachWhenAbove: boolean): SupervisionCheckStatus {
  if (state === 'UNKNOWN' || strength === null) return 'UNKNOWN';
  if (state === 'ABSENT') return breachWhenAbove ? 'PASS' : 'BREACH';
  const beyond = compareExactDecimals(strength, threshold) >= 0;
  return beyond === breachWhenAbove ? 'BREACH' : 'PASS';
}

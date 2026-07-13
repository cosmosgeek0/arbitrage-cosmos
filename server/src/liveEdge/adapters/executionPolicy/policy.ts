import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import { canonicalJson } from '../../../foundation/contracts/index.js';
import {
  deriveSpotOrderTifDependencyRevision,
  validateSpotOrderTifCapability,
} from '../binanceInstrumentSpecs/spotOrderTifCapability.js';
import { bindSpotOrderTifCapability } from '../binanceInstrumentSpecs/sizing.js';
import type {
  BinanceSpotOrderTifCapability,
} from '../binanceInstrumentSpecs/types.js';
import {
  addPolicyDecimals,
  comparePolicyDecimals,
  compareRationals,
  multiplyPolicyDecimals,
  policyDecimal,
  rationalWithinLimit,
  signedPolicyDecimal,
  weightedPolicyDecimal,
} from './exact.js';
import {
  EXECUTION_POLICY_CANDIDATE_SCHEMA,
  EXECUTION_POLICY_DECISION_SCHEMA,
  EXECUTION_POLICY_INPUT_SCHEMA,
  EXECUTION_POLICY_OWNER_BINDINGS_SCHEMA,
  type ExactCvarEvidence,
  type ExecutionPolicyCandidate,
  type ExecutionPolicyDecision,
  type ExecutionPolicyInput,
  type ExecutionPolicyPlan,
  type PolicyAction,
  type PolicyCandidateEvaluation,
  type PolicyCandidateMetrics,
  type PolicyConstraintEnvelope,
  type PolicyDependencyKind,
  type PolicyFailureTransitions,
  type PolicyLeg,
  type PolicyLegFailureTransition,
  type PolicyRejectionReason,
  type PolicyScenario,
} from './types.js';

const MAX_UTC_MS = 4_102_444_800_000;
const MAX_CANDIDATES = 32;
const MAX_ACTIONS = 32;
const MAX_SCENARIOS = 64;
const MAX_GRAPH_NODES = 100_000;
const MAX_GRAPH_DEPTH = 24;
const MAX_SERIALIZED_BYTES = 4_000_000;
const MAX_TEXT = 256;
const TOTAL_PPM = 1_000_000;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{2,255}$/u;
const SYMBOL = /^(?=.{2,40}$)[A-Z0-9._-]+$/u;
const ASSET = /^(?=.{2,20}$)[A-Z0-9._-]+$/u;
const CONTENT_ID = /^ep(?:act|cand|dist)_[0-9a-f]{64}$/u;
const CONTENT_REVISION = /^ep(?:act|cand|dist)rev_[0-9a-f]{64}$/u;
const SECRET_FIELDS = new Set([
  'apikey', 'apisecret', 'secret', 'password', 'passphrase', 'token', 'bearer',
  'signature', 'privatekey', 'credential', 'cookie', 'mnemonic',
]);

const DEPENDENCY_KINDS: readonly PolicyDependencyKind[] = Object.freeze([
  'INSTRUMENT_FILTER', 'BOOK', 'COST', 'MODEL', 'CALIBRATION', 'EXCHANGE_TWIN',
  'CURRENT_ORDERS', 'CURRENT_POSITION', 'CURRENT_LIABILITY', 'RECOVERY',
]);

const REASON_ORDER: readonly PolicyRejectionReason[] = Object.freeze([
  'INPUT_REJECTED', 'INTENT_NOT_AUTHORIZED', 'AUTHORIZATION_EXPIRED',
  'DEPENDENCY_STALE', 'OWNER_REVISION_MISMATCH',
  'INSTRUMENT_OR_FILTER_UNAVAILABLE', 'BOOK_OR_COST_EVIDENCE_UNAVAILABLE',
  'DISTRIBUTION_UNAVAILABLE', 'DISTRIBUTION_UNCALIBRATED',
  'PRICE_BOUND_EXCEEDED', 'QUANTITY_OR_NOTIONAL_EXCEEDED',
  'CAPITAL_OR_RISK_LIMIT_EXCEEDED', 'NAKED_DURATION_EXCEEDED',
  'RECOVERY_BUDGET_EXCEEDED', 'TAIL_LOSS_EXCEEDED',
  'AMBIGUITY_REQUIRES_RECONCILIATION', 'NO_AUTHORIZED_POLICY',
]);

const INPUT_FIELDS = Object.freeze([
  'schema', 'policyRequestId', 'policyVersion', 'evaluatedAtMs', 'authority',
  'dependencies', 'legs', 'candidates',
] as const);
const OWNER_BINDING_FIELDS = Object.freeze(['schema', 'spotOrderTifOwnerInputs'] as const);
const SPOT_OWNER_INPUT_FIELDS = Object.freeze(['registrySnapshot', 'sizingRequest'] as const);
const AUTHORITY_FIELDS = Object.freeze([
  'state', 'intentId', 'intentRevision', 'externalPlanId', 'correlationId',
  'authorizationRevision', 'mandateId', 'mandateRevision', 'capitalReservationId',
  'capitalReservationRevision', 'stagedPlanId', 'stagedPlanRevision',
  'operatorApprovalId', 'operatorApprovalRevision', 'riskVerdictId',
  'riskVerdictRevision', 'capitalAuthority', 'riskAuthority', 'riskAllowed',
  'killOrRevokeActive', 'observedAtMs', 'validUntilMs', 'mandateConstraints',
  'capitalConstraints', 'riskConstraints', 'approvalConstraints',
] as const);
const CONSTRAINT_FIELDS = Object.freeze([
  'owner', 'ownerRevision', 'maxQuantity', 'maxNotionalQuote', 'maxNakedQuantity',
  'maxNakedNotionalQuote', 'maxNakedDurationMs', 'maxRecoveryCostQuote',
  'maxScenarioLossQuote', 'maxTailLossQuote', 'cvarConfidencePpm',
  'minimumCompletionPpm',
] as const);
const DEPENDENCY_FIELDS = Object.freeze(['kind', 'revision', 'state', 'observedAtMs', 'validUntilMs'] as const);
const LEG_FIELDS = Object.freeze([
  'legId', 'instrumentRevision', 'filterRevision', 'l04SizingRevision',
  'l04SourceEvidenceRevision', 'l04SnapshotRevision', 'l04PreflightState',
  'allowedOrderTypes', 'allowedTimeInForce', 'product', 'accountRealmId',
  'symbol', 'baseAsset', 'quoteAsset', 'side', 'reduceOnly', 'requestedQuantity',
  'filteredQuantity', 'authorizedLimitPrice', 'filteredNotionalQuote',
] as const);
const CANDIDATE_FIELDS = Object.freeze([
  'schema', 'candidateId', 'candidateRevision', 'posture', 'sequenceMode',
  'authorizationRevision', 'mandateRevision', 'capitalReservationRevision',
  'riskVerdictRevision', 'stagedPlanRevision', 'operatorApprovalRevision',
  'expiresAtMs', 'actions', 'failureTransitions', 'legFailureTransitions', 'distribution',
] as const);
const ACTION_FIELDS = Object.freeze([
  'schema', 'actionId', 'actionRevision', 'step', 'kind', 'legId', 'orderType',
  'timeInForce', 'quantity', 'quantitySource', 'price', 'targetActionId',
  'dependsOnActualFillLegId', 'requiresConfirmedCancelActionId', 'exposureEffect',
  'recoveryEvidenceRevision', 'targetExposureRevision', 'deadlineOffsetMs',
  'ambiguityPosture',
] as const);
const TRANSITION_FIELDS = Object.freeze([
  'onTimeout', 'onDisconnect', 'onHttp5xx', 'onCancelAmbiguity',
  'onFirstLegReject', 'onFirstLegPartial', 'onFirstLegTimeout', 'onConcurrentImbalance',
] as const);
const LEG_TRANSITION_FIELDS = Object.freeze([
  'legId', 'onReject', 'onPartial', 'onTimeout', 'onAmbiguity',
] as const);
const DISTRIBUTION_FIELDS = Object.freeze([
  'schema', 'distributionRevision', 'modelRevision', 'calibrationRevision',
  'lineageExchangeTwinRevision', 'state', 'sampleCount', 'quoteAsset',
  'minimumRequiredSampleCount', 'observedAtMs', 'validUntilMs', 'scenarios',
] as const);
const SCENARIO_FIELDS = Object.freeze([
  'scenarioId', 'probabilityPpm', 'fills', 'feeOrRebateQuote',
  'adverseSelectionQuote', 'opportunityDecayQuote', 'cancelRaceQuote',
  'unhedgedLossQuote', 'recoveryCostQuote', 'lossQuote', 'maxNakedQuantity',
  'fillLatencyMs', 'maxNakedNotionalQuote', 'maxNakedDurationMs', 'ambiguity',
] as const);
const FILL_FIELDS = Object.freeze(['legId', 'filledQuantity'] as const);

const AUTHORITY = Object.freeze({
  policyAuthority: 'ADVISORY_EXECUTION_MECHANICS_ONLY' as const,
  simulationAuthority: 'SYNTHETIC_FIXTURE' as const,
  sendEligible: false as const,
  actionAuthority: 'NONE_RECORD_ONLY' as const,
  externalActionAuthorization: 'NONE' as const,
});

function sha256(prefix: string, value: unknown): string {
  const serialized = canonicalJson(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SERIALIZED_BYTES) {
    throw new RangeError('execution-policy serialized content is overbound');
  }
  return `${prefix}${createHash('sha256').update(serialized).digest('hex')}`;
}

function stableTextCompare(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function snapshot(value: unknown, seen = new Set<object>(), depth = 0, budget = { count: 0 }): unknown {
  budget.count += 1;
  if (budget.count > MAX_GRAPH_NODES) throw new RangeError('execution-policy graph node bound exceeded');
  if (depth > MAX_GRAPH_DEPTH) throw new RangeError('execution-policy graph depth exceeded');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('execution-policy numbers must be safe integers');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new TypeError('execution-policy string is unsafe or overbound');
    }
    return value;
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value) || seen.has(value)) {
    throw new TypeError('execution-policy input must be alias-free plain data');
  }
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')) throw new TypeError('execution-policy symbol keys are forbidden');
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || keys.length !== value.length + 1 || value.length > MAX_GRAPH_NODES) {
      throw new RangeError('execution-policy array is sparse, decorated or overbound');
    }
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('execution-policy array must contain enumerable data');
      }
      result.push(snapshot(descriptor.value, seen, depth + 1, budget));
    }
    return result;
  }
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('execution-policy records must be plain');
  if (keys.length > 96) throw new RangeError('execution-policy record is overbound');
  const result: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    if (SECRET_FIELDS.has(key.replaceAll('_', '').toLowerCase())) {
      throw new TypeError('execution-policy secret-shaped fields are forbidden');
    }
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('execution-policy records must contain enumerable data');
    }
    result[key] = snapshot(descriptor.value, seen, depth + 1, budget);
  }
  return result;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  if (utilTypes.isProxy(value)) throw new TypeError('execution-policy output cannot contain a Proxy');
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('execution-policy output cannot contain accessors');
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function record(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be a record`);
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (canonicalJson(keys) !== canonicalJson(expected)) throw new TypeError(`${label} fields must match the closed schema`);
  return value as Record<string, unknown>;
}

function array(value: unknown, min: number, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new RangeError(`${label} count must be in [${min}, ${max}]`);
  }
  return value;
}

function text(value: unknown, label: string, pattern = ID): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT || !pattern.test(value)) {
    throw new TypeError(`${label} must be a bounded identifier`);
  }
  return value;
}

function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function timestamp(value: unknown, label: string): number {
  return integer(value, 0, MAX_UTC_MS, label);
}

function oneOf<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new TypeError(`${label} is unsupported`);
  return value as T;
}

function canonicalDecimal(value: unknown, label: string, signed = false): string {
  const normalized = signed ? signedPolicyDecimal(value, label) : policyDecimal(value, label);
  if (normalized !== value) throw new TypeError(`${label} must already be canonical`);
  return normalized;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}

function closedStringArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): readonly T[] {
  if (!Array.isArray(value) || value.length > allowed.length) throw new TypeError(`${label} must be a bounded array`);
  const output = value.map((entry) => oneOf(entry, allowed, label));
  if (new Set(output).size !== output.length
    || output.some((entry, index) => index > 0 && stableTextCompare(output[index - 1], entry) >= 0)) {
    throw new TypeError(`${label} must be code-unit sorted and unique`);
  }
  return output;
}

function reasonSet(reasons: Iterable<PolicyRejectionReason>): readonly PolicyRejectionReason[] {
  const set = new Set(reasons);
  return Object.freeze(REASON_ORDER.filter((reason) => set.has(reason)));
}

function materialWithout<T extends Record<string, unknown>>(value: T, excluded: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.includes(key)));
}

export function deriveExecutionPolicyActionIdentity(
  action: Omit<PolicyAction, 'actionId' | 'actionRevision'>,
): Readonly<{ actionId: string; actionRevision: string }> {
  const material = snapshot(action);
  return deepFreeze({
    actionId: sha256('epact_', material),
    actionRevision: sha256('epactrev_', material),
  });
}

export function deriveExecutionPolicyDistributionRevision(
  distribution: Omit<ExecutionPolicyCandidate['distribution'], 'distributionRevision'>,
): string {
  const material = snapshot(distribution) as Omit<ExecutionPolicyCandidate['distribution'], 'distributionRevision'>;
  return sha256('epdistrev_', {
    ...material,
    scenarios: [...material.scenarios]
      .map((scenario) => ({
        ...scenario,
        fills: [...scenario.fills].sort((left, right) => stableTextCompare(left.legId, right.legId)),
      }))
      .sort((left, right) => stableTextCompare(left.scenarioId, right.scenarioId)),
  });
}

export function deriveExecutionPolicyCandidateIdentity(
  candidate: Omit<ExecutionPolicyCandidate, 'candidateId' | 'candidateRevision'>,
): Readonly<{ candidateId: string; candidateRevision: string }> {
  const cloned = snapshot(candidate) as Omit<ExecutionPolicyCandidate, 'candidateId' | 'candidateRevision'>;
  const material = {
    ...cloned,
    actions: [...cloned.actions].sort((left, right) => left.step - right.step),
    legFailureTransitions: [...cloned.legFailureTransitions]
      .sort((left, right) => stableTextCompare(left.legId, right.legId)),
    distribution: {
      ...cloned.distribution,
      scenarios: [...cloned.distribution.scenarios]
        .map((scenario) => ({
          ...scenario,
          fills: [...scenario.fills].sort((left, right) => stableTextCompare(left.legId, right.legId)),
        }))
        .sort((left, right) => stableTextCompare(left.scenarioId, right.scenarioId)),
    },
  };
  return deepFreeze({
    candidateId: sha256('epcand_', material),
    candidateRevision: sha256('epcandrev_', material),
  });
}

function validateAction(raw: unknown, legs: ReadonlyMap<string, PolicyLeg>): PolicyAction {
  const action = record(raw, ACTION_FIELDS, 'policy action');
  if (action.schema !== 'EXECUTION_POLICY_ACTION_V1') throw new TypeError('policy action schema is unsupported');
  text(action.actionId, 'actionId', CONTENT_ID);
  text(action.actionRevision, 'actionRevision', CONTENT_REVISION);
  integer(action.step, 0, MAX_ACTIONS - 1, 'action step');
  const kind = oneOf(action.kind, ['PLACE', 'CANCEL', 'REPLACE_AFTER_CONFIRMED_CANCEL', 'RECOVER'], 'action kind');
  const legId = text(action.legId, 'action legId');
  if (!legs.has(legId)) throw new TypeError('action references an unknown leg');
  const orderType = action.orderType === null ? null : oneOf(action.orderType, ['LIMIT', 'MARKET'], 'order type');
  const timeInForce = action.timeInForce === null ? null : oneOf(action.timeInForce, ['GTC', 'IOC', 'FOK'], 'timeInForce');
  const quantity = action.quantity === null ? null : canonicalDecimal(action.quantity, 'action quantity');
  const quantitySource = action.quantitySource === null ? null : oneOf(action.quantitySource, [
    'AUTHORIZED_FILTERED_QUANTITY', 'ACTUAL_FILL_OF_LEG',
    'CONFIRMED_REMAINDER_AFTER_CANCEL', 'RISK_REDUCING_RECOVERY_EVIDENCE',
  ], 'quantitySource');
  const price = action.price === null ? null : canonicalDecimal(action.price, 'action price');
  const targetActionId = action.targetActionId === null ? null : text(action.targetActionId, 'targetActionId', CONTENT_ID);
  const dependsOnActualFillLegId = action.dependsOnActualFillLegId === null
    ? null : text(action.dependsOnActualFillLegId, 'dependsOnActualFillLegId');
  if (dependsOnActualFillLegId !== null && !legs.has(dependsOnActualFillLegId)) throw new TypeError('actual-fill dependency is unknown');
  const requiresConfirmedCancelActionId = action.requiresConfirmedCancelActionId === null
    ? null : text(action.requiresConfirmedCancelActionId, 'requiresConfirmedCancelActionId', CONTENT_ID);
  const exposureEffect = oneOf(action.exposureEffect, [
    'MAY_OPEN_WITHIN_AUTHORIZATION', 'RISK_REDUCING_ONLY', 'NO_EXPOSURE_EFFECT',
  ], 'exposureEffect');
  const recoveryEvidenceRevision = action.recoveryEvidenceRevision === null
    ? null : text(action.recoveryEvidenceRevision, 'recoveryEvidenceRevision');
  const targetExposureRevision = action.targetExposureRevision === null
    ? null : text(action.targetExposureRevision, 'targetExposureRevision');
  integer(action.deadlineOffsetMs, 0, 86_400_000, 'action deadlineOffsetMs');
  if (action.ambiguityPosture !== 'RECONCILE_ONLY') throw new TypeError('action ambiguity posture must fail closed');

  if (kind === 'CANCEL') {
    if (orderType !== null || timeInForce !== null || quantity !== null || quantitySource !== null || price !== null
      || targetActionId === null || dependsOnActualFillLegId !== null
      || requiresConfirmedCancelActionId !== null || exposureEffect !== 'NO_EXPOSURE_EFFECT'
      || recoveryEvidenceRevision !== null || targetExposureRevision !== null) {
      throw new TypeError('cancel action fields are invalid');
    }
  } else {
    if (orderType === null || quantity === null || quantity === '0' || quantitySource === null || targetActionId !== null) {
      throw new TypeError('placement-like action fields are invalid');
    }
    if (orderType === 'LIMIT' && (price === null || price === '0' || timeInForce === null)) {
      throw new TypeError('limit action requires price and TIF');
    }
    if (orderType === 'MARKET' && (price !== null || timeInForce !== null)) {
      throw new TypeError('market action cannot carry price or TIF');
    }
    if (kind === 'REPLACE_AFTER_CONFIRMED_CANCEL' && requiresConfirmedCancelActionId === null) {
      throw new TypeError('replacement requires an exact confirmed-cancel action');
    }
    if (kind !== 'REPLACE_AFTER_CONFIRMED_CANCEL' && requiresConfirmedCancelActionId !== null) {
      throw new TypeError('only a replacement may depend on confirmed cancel');
    }
    if (kind === 'PLACE' && exposureEffect !== 'MAY_OPEN_WITHIN_AUTHORIZATION') {
      throw new TypeError('initial placement exposure effect is invalid');
    }
    if (kind === 'PLACE' && (dependsOnActualFillLegId === null
      ? quantitySource !== 'AUTHORIZED_FILTERED_QUANTITY'
      : quantitySource !== 'ACTUAL_FILL_OF_LEG')) {
      throw new TypeError('initial placement quantity source is invalid');
    }
    if (kind === 'REPLACE_AFTER_CONFIRMED_CANCEL'
      && (quantitySource !== 'CONFIRMED_REMAINDER_AFTER_CANCEL'
        || exposureEffect !== 'MAY_OPEN_WITHIN_AUTHORIZATION')) {
      throw new TypeError('replacement quantity source is invalid');
    }
    if (kind === 'RECOVER'
      && (quantitySource !== 'RISK_REDUCING_RECOVERY_EVIDENCE'
        || exposureEffect !== 'RISK_REDUCING_ONLY'
        || recoveryEvidenceRevision === null || targetExposureRevision === null
        || dependsOnActualFillLegId === null)) {
      throw new TypeError('recovery must be bound to exact risk-reducing exposure evidence');
    }
    if (kind !== 'RECOVER' && (recoveryEvidenceRevision !== null || targetExposureRevision !== null)) {
      throw new TypeError('only recovery actions may carry recovery evidence');
    }
  }
  const expected = deriveExecutionPolicyActionIdentity(materialWithout(action, ['actionId', 'actionRevision']) as unknown as Omit<PolicyAction, 'actionId' | 'actionRevision'>);
  if (action.actionId !== expected.actionId || action.actionRevision !== expected.actionRevision) {
    throw new TypeError('action identity is not content-addressed');
  }
  return action as unknown as PolicyAction;
}

function validateTransitions(raw: unknown, mode: 'ORDERED' | 'CONCURRENT'): PolicyFailureTransitions {
  const value = record(raw, TRANSITION_FIELDS, 'failure transitions');
  for (const key of ['onTimeout', 'onDisconnect', 'onHttp5xx', 'onCancelAmbiguity']) {
    if (value[key] !== 'RECONCILE_ONLY') throw new TypeError('ambiguous delivery must reconcile only');
  }
  oneOf(value.onFirstLegReject, ['STOP_NO_NEW_EXPOSURE', 'RECOVER_WITHIN_BUDGET', 'NOT_APPLICABLE'], 'first-leg reject transition');
  oneOf(value.onFirstLegPartial, ['WAIT_FOR_ACTUAL_FILL', 'RECOVER_WITHIN_BUDGET', 'NOT_APPLICABLE'], 'first-leg partial transition');
  oneOf(value.onFirstLegTimeout, ['RECONCILE_ONLY', 'NOT_APPLICABLE'], 'first-leg timeout transition');
  oneOf(value.onConcurrentImbalance, ['RECOVER_WITHIN_BUDGET', 'STOP_NO_NEW_EXPOSURE', 'NOT_APPLICABLE'], 'concurrent imbalance transition');
  if (mode === 'ORDERED') {
    if (value.onFirstLegReject === 'NOT_APPLICABLE' || value.onFirstLegPartial === 'NOT_APPLICABLE'
      || value.onFirstLegTimeout !== 'RECONCILE_ONLY' || value.onConcurrentImbalance !== 'NOT_APPLICABLE') {
      throw new TypeError('ordered transition set is incomplete');
    }
  } else if (value.onFirstLegReject !== 'NOT_APPLICABLE' || value.onFirstLegPartial !== 'NOT_APPLICABLE'
    || value.onFirstLegTimeout !== 'NOT_APPLICABLE' || value.onConcurrentImbalance === 'NOT_APPLICABLE') {
    throw new TypeError('concurrent transition set is incomplete');
  }
  return value as unknown as PolicyFailureTransitions;
}

function validateLegTransitions(
  raw: unknown,
  legs: readonly PolicyLeg[],
): readonly PolicyLegFailureTransition[] {
  const values = array(raw, legs.length, legs.length, 'leg failure transitions')
    .map((entry) => {
      const value = record(entry, LEG_TRANSITION_FIELDS, 'leg failure transition');
      const legId = text(value.legId, 'leg transition legId');
      oneOf(value.onReject, ['STOP_NO_NEW_EXPOSURE', 'RECOVER_WITHIN_BUDGET'], 'leg reject transition');
      oneOf(value.onPartial, ['WAIT_FOR_ACTUAL_FILL', 'RECOVER_WITHIN_BUDGET'], 'leg partial transition');
      if (value.onTimeout !== 'RECONCILE_ONLY' || value.onAmbiguity !== 'RECONCILE_ONLY') {
        throw new TypeError('per-leg ambiguity must reconcile only');
      }
      return value as unknown as PolicyLegFailureTransition;
    });
  if (new Set(values.map((value) => value.legId)).size !== legs.length
    || !legs.every((leg) => values.some((value) => value.legId === leg.legId))) {
    throw new TypeError('leg failure transitions must cover every exact leg once');
  }
  return Object.freeze([...values].sort((left, right) => stableTextCompare(left.legId, right.legId)));
}

function validateScenario(raw: unknown, legs: ReadonlyMap<string, PolicyLeg>): PolicyScenario {
  const scenario = record(raw, SCENARIO_FIELDS, 'policy scenario');
  text(scenario.scenarioId, 'scenarioId');
  integer(scenario.probabilityPpm, 1, TOTAL_PPM, 'scenario probabilityPpm');
  const fills = array(scenario.fills, legs.size, legs.size, 'scenario fills');
  const fillIds = new Set<string>();
  for (const rawFill of fills) {
    const fill = record(rawFill, FILL_FIELDS, 'scenario fill');
    const legId = text(fill.legId, 'scenario fill legId');
    if (!legs.has(legId) || fillIds.has(legId)) throw new TypeError('scenario fill legs must match exactly once');
    fillIds.add(legId);
    const quantity = canonicalDecimal(fill.filledQuantity, 'scenario filled quantity');
    if (comparePolicyDecimals(quantity, legs.get(legId)!.filteredQuantity) > 0) throw new TypeError('scenario fill exceeds filtered quantity');
  }
  const fee = canonicalDecimal(scenario.feeOrRebateQuote, 'feeOrRebateQuote', true);
  const axes = [
    canonicalDecimal(scenario.adverseSelectionQuote, 'adverseSelectionQuote'),
    canonicalDecimal(scenario.opportunityDecayQuote, 'opportunityDecayQuote'),
    canonicalDecimal(scenario.cancelRaceQuote, 'cancelRaceQuote'),
    canonicalDecimal(scenario.unhedgedLossQuote, 'unhedgedLossQuote'),
    canonicalDecimal(scenario.recoveryCostQuote, 'recoveryCostQuote'),
  ];
  const loss = canonicalDecimal(scenario.lossQuote, 'lossQuote');
  const recomputed = axes.reduce((total, value) => addPolicyDecimals(total, value), fee);
  if (comparePolicyDecimals(recomputed, '0') < 0 || recomputed !== loss) {
    throw new TypeError('scenario loss must exactly equal its retained cost axes');
  }
  integer(scenario.fillLatencyMs, 0, 86_400_000, 'fillLatencyMs');
  canonicalDecimal(scenario.maxNakedQuantity, 'maxNakedQuantity');
  canonicalDecimal(scenario.maxNakedNotionalQuote, 'maxNakedNotionalQuote');
  integer(scenario.maxNakedDurationMs, 0, 86_400_000, 'maxNakedDurationMs');
  oneOf(scenario.ambiguity, ['NONE', 'RECONCILIATION_REQUIRED'], 'scenario ambiguity');
  return scenario as unknown as PolicyScenario;
}

function exactCvar(scenarios: readonly PolicyScenario[], confidencePpm: number): ExactCvarEvidence {
  const ordered = [...scenarios].sort((left, right) => {
    const loss = comparePolicyDecimals(left.lossQuote, right.lossQuote);
    return loss !== 0 ? loss : stableTextCompare(left.scenarioId, right.scenarioId);
  });
  const tailMassPpm = TOTAL_PPM - confidencePpm;
  let varLossQuote: string | null = null;
  let cumulativeMassPpm = 0;
  for (const scenario of ordered) {
    cumulativeMassPpm += scenario.probabilityPpm;
    if (cumulativeMassPpm >= confidencePpm) {
      varLossQuote = scenario.lossQuote;
      break;
    }
  }
  if (varLossQuote === null) throw new TypeError('CVaR threshold is not available');
  const strictlyWorse = ordered.filter((scenario) => comparePolicyDecimals(scenario.lossQuote, varLossQuote!) > 0);
  const strictlyWorseMassPpm = strictlyWorse.reduce((total, scenario) => total + scenario.probabilityPpm, 0);
  const boundaryAtomMassPpm = ordered
    .filter((scenario) => comparePolicyDecimals(scenario.lossQuote, varLossQuote!) === 0)
    .reduce((total, scenario) => total + scenario.probabilityPpm, 0);
  const boundaryIncludedMassPpm = tailMassPpm - strictlyWorseMassPpm;
  if (boundaryIncludedMassPpm < 0 || boundaryIncludedMassPpm > boundaryAtomMassPpm) {
    throw new TypeError('CVaR boundary mass is invalid');
  }
  const weightedLossNumerator = addPolicyDecimals(
    strictlyWorse.reduce(
      (total, scenario) => addPolicyDecimals(total, weightedPolicyDecimal(scenario.lossQuote, scenario.probabilityPpm)),
      '0',
    ),
    weightedPolicyDecimal(varLossQuote, boundaryIncludedMassPpm),
  );
  return deepFreeze({
    confidencePpm, tailMassPpm, varLossQuote, strictlyWorseMassPpm,
    boundaryAtomMassPpm, boundaryIncludedMassPpm, weightedLossNumerator,
    denominatorPpm: tailMassPpm,
  });
}

function scenarioFill(scenario: PolicyScenario, legId: string): string {
  return scenario.fills.find((fill) => fill.legId === legId)!.filledQuantity;
}

function metricsFor(scenarios: readonly PolicyScenario[], legs: readonly PolicyLeg[], confidencePpm: number): PolicyCandidateMetrics {
  const expectedFilledQuantityByLeg = [...legs]
    .sort((left, right) => stableTextCompare(left.legId, right.legId))
    .map((leg) => ({
      legId: leg.legId,
      evidence: {
        weightedNumerator: scenarios.reduce(
          (total, scenario) => addPolicyDecimals(total, weightedPolicyDecimal(scenarioFill(scenario, leg.legId), scenario.probabilityPpm)),
          '0',
        ),
        denominatorPpm: TOTAL_PPM,
      },
    }));
  const weighted = (select: (scenario: PolicyScenario) => string): string => scenarios.reduce(
    (total, scenario) => addPolicyDecimals(total, weightedPolicyDecimal(select(scenario), scenario.probabilityPpm)),
    '0',
  );
  const completionPpm = scenarios
    .filter((scenario) => legs.every((leg) => comparePolicyDecimals(scenarioFill(scenario, leg.legId), leg.filteredQuantity) === 0))
    .reduce((total, scenario) => total + scenario.probabilityPpm, 0);
  const maximumLossQuote = scenarios.reduce(
    (maximum, scenario) => comparePolicyDecimals(scenario.lossQuote, maximum) > 0 ? scenario.lossQuote : maximum,
    '0',
  );
  return deepFreeze({
    objectiveVersion: 'LEXICOGRAPHIC_CVAR_MAX_EXPECTED_RECOVERY_MAX_LATENCY_EXPECTED_LATENCY_DURATION_FILL_COMPLETION_V1',
    expectedFilledQuantityByLeg,
    completionPpm,
    expectedFeeOrRebateQuote: { weightedNumerator: weighted((scenario) => scenario.feeOrRebateQuote), denominatorPpm: TOTAL_PPM },
    expectedAdverseSelectionQuote: { weightedNumerator: weighted((scenario) => scenario.adverseSelectionQuote), denominatorPpm: TOTAL_PPM },
    expectedOpportunityDecayQuote: { weightedNumerator: weighted((scenario) => scenario.opportunityDecayQuote), denominatorPpm: TOTAL_PPM },
    expectedCancelRaceQuote: { weightedNumerator: weighted((scenario) => scenario.cancelRaceQuote), denominatorPpm: TOTAL_PPM },
    expectedUnhedgedLossQuote: { weightedNumerator: weighted((scenario) => scenario.unhedgedLossQuote), denominatorPpm: TOTAL_PPM },
    expectedLossQuote: { weightedNumerator: weighted((scenario) => scenario.lossQuote), denominatorPpm: TOTAL_PPM },
    expectedRecoveryCostQuote: { weightedNumerator: weighted((scenario) => scenario.recoveryCostQuote), denominatorPpm: TOTAL_PPM },
    expectedFillLatencyMsNumerator: scenarios.reduce(
      (total, scenario) => (BigInt(total) + BigInt(scenario.fillLatencyMs) * BigInt(scenario.probabilityPpm)).toString(),
      '0',
    ),
    expectedFillLatencyDenominatorPpm: TOTAL_PPM,
    maximumFillLatencyMs: scenarios.reduce((maximum, scenario) => Math.max(maximum, scenario.fillLatencyMs), 0),
    expectedNakedDurationMsNumerator: scenarios.reduce(
      (total, scenario) => (BigInt(total) + BigInt(scenario.maxNakedDurationMs) * BigInt(scenario.probabilityPpm)).toString(),
      '0',
    ),
    expectedNakedDurationDenominatorPpm: TOTAL_PPM,
    maximumLossQuote,
    cvarLossQuote: exactCvar(scenarios, confidencePpm),
  });
}

function validateCandidate(
  raw: unknown,
  legs: readonly PolicyLeg[],
  evaluatedAtMs: number,
  confidencePpm: number,
): { candidate: ExecutionPolicyCandidate; metrics: PolicyCandidateMetrics } {
  const candidate = record(raw, CANDIDATE_FIELDS, 'execution-policy candidate');
  if (candidate.schema !== EXECUTION_POLICY_CANDIDATE_SCHEMA) throw new TypeError('candidate schema is unsupported');
  text(candidate.candidateId, 'candidateId', CONTENT_ID);
  text(candidate.candidateRevision, 'candidateRevision', CONTENT_REVISION);
  oneOf(candidate.posture, ['PASSIVE', 'AGGRESSIVE', 'HYBRID', 'RECOVERY'], 'candidate posture');
  const mode = oneOf(candidate.sequenceMode, ['ORDERED', 'CONCURRENT'], 'candidate sequence mode');
  text(candidate.authorizationRevision, 'candidate authorizationRevision');
  text(candidate.mandateRevision, 'candidate mandateRevision');
  text(candidate.capitalReservationRevision, 'candidate capitalReservationRevision');
  text(candidate.riskVerdictRevision, 'candidate riskVerdictRevision');
  text(candidate.stagedPlanRevision, 'candidate stagedPlanRevision');
  text(candidate.operatorApprovalRevision, 'candidate operatorApprovalRevision');
  const expiresAtMs = timestamp(candidate.expiresAtMs, 'candidate expiresAtMs');
  const legMap = new Map(legs.map((leg) => [leg.legId, leg]));
  const actions = array(candidate.actions, 1, MAX_ACTIONS, 'candidate actions')
    .map((action) => validateAction(action, legMap));
  const actionIds = new Set<string>();
  const steps = new Set<number>();
  for (const action of actions) {
    if (actionIds.has(action.actionId) || steps.has(action.step)) throw new TypeError('action identities and steps must be unique');
    actionIds.add(action.actionId);
    steps.add(action.step);
  }
  const orderedActions = [...actions].sort((left, right) => left.step - right.step);
  if (orderedActions.some((action, index) => action.step !== index)) throw new TypeError('action steps must be contiguous');
  for (const leg of legs) {
    if (orderedActions.filter((action) => action.kind === 'PLACE' && action.legId === leg.legId).length !== 1) {
      throw new TypeError('each leg requires exactly one initial placement action');
    }
  }
  const canceledTargets = new Set<string>();
  const replacementCancels = new Set<string>();
  for (const action of orderedActions) {
    if (action.kind === 'CANCEL') {
      const target = orderedActions.find((prior) => prior.actionId === action.targetActionId);
      if (target === undefined || target.step >= action.step || target.kind === 'CANCEL'
        || target.legId !== action.legId || target.deadlineOffsetMs > action.deadlineOffsetMs
        || canceledTargets.has(target.actionId)) {
        throw new TypeError('cancel target must be one same-leg prior placement with a monotonic deadline');
      }
      canceledTargets.add(target.actionId);
    }
    if (action.kind === 'REPLACE_AFTER_CONFIRMED_CANCEL') {
      const cancel = orderedActions.find((prior) => prior.actionId === action.requiresConfirmedCancelActionId);
      if (cancel === undefined || cancel.kind !== 'CANCEL' || cancel.step >= action.step
        || cancel.legId !== action.legId || cancel.deadlineOffsetMs > action.deadlineOffsetMs
        || replacementCancels.has(cancel.actionId)) {
        throw new TypeError('replacement must follow its separate confirmed cancel');
      }
      replacementCancels.add(cancel.actionId);
    }
  }
  const firstLeg = legs[0];
  const secondLeg = legs[1];
  const initialPlacement = (legId: string) => orderedActions.find((action) => action.legId === legId && action.kind === 'PLACE');
  if (initialPlacement(firstLeg.legId) === undefined || initialPlacement(secondLeg.legId) === undefined) {
    throw new TypeError('each leg requires one initial placement action');
  }
  if (mode === 'ORDERED') {
    if (initialPlacement(firstLeg.legId)!.dependsOnActualFillLegId !== null
      || initialPlacement(firstLeg.legId)!.quantitySource !== 'AUTHORIZED_FILTERED_QUANTITY'
      || initialPlacement(secondLeg.legId)!.dependsOnActualFillLegId !== firstLeg.legId
      || initialPlacement(secondLeg.legId)!.quantitySource !== 'ACTUAL_FILL_OF_LEG') {
      throw new TypeError('ordered second leg must depend only on actual first-leg fill');
    }
  } else if (initialPlacement(firstLeg.legId)!.dependsOnActualFillLegId !== null
    || initialPlacement(secondLeg.legId)!.dependsOnActualFillLegId !== null
    || initialPlacement(firstLeg.legId)!.quantitySource !== 'AUTHORIZED_FILTERED_QUANTITY'
    || initialPlacement(secondLeg.legId)!.quantitySource !== 'AUTHORIZED_FILTERED_QUANTITY') {
    throw new TypeError('concurrent initial legs cannot claim sequential fill dependency');
  }
  const transitions = validateTransitions(candidate.failureTransitions, mode);
  validateLegTransitions(candidate.legFailureTransitions, legs);
  const distribution = record(candidate.distribution, DISTRIBUTION_FIELDS, 'candidate distribution');
  if (distribution.schema !== 'EXECUTION_POLICY_DISTRIBUTION_V1') throw new TypeError('distribution schema is unsupported');
  text(distribution.distributionRevision, 'distributionRevision', CONTENT_REVISION);
  text(distribution.modelRevision, 'modelRevision');
  text(distribution.calibrationRevision, 'calibrationRevision');
  text(distribution.lineageExchangeTwinRevision, 'lineageExchangeTwinRevision');
  oneOf(distribution.state, ['CALIBRATED', 'UNCALIBRATED', 'UNAVAILABLE'], 'distribution state');
  integer(distribution.sampleCount, 0, 1_000_000_000, 'distribution sampleCount');
  integer(distribution.minimumRequiredSampleCount, 1, 1_000_000_000, 'distribution minimumRequiredSampleCount');
  text(distribution.quoteAsset, 'distribution quoteAsset', ASSET);
  timestamp(distribution.observedAtMs, 'distribution observedAtMs');
  timestamp(distribution.validUntilMs, 'distribution validUntilMs');
  const scenarios = array(distribution.scenarios, 1, MAX_SCENARIOS, 'distribution scenarios')
    .map((scenario) => validateScenario(scenario, legMap));
  if (new Set(scenarios.map((scenario) => scenario.scenarioId)).size !== scenarios.length) {
    throw new TypeError('scenario identities must be unique');
  }
  if (scenarios.reduce((total, scenario) => total + scenario.probabilityPpm, 0) !== TOTAL_PPM) {
    throw new TypeError('scenario probability mass must equal 1000000 PPM');
  }
  const expectedDistributionRevision = deriveExecutionPolicyDistributionRevision(
    materialWithout(distribution, ['distributionRevision']) as unknown as Omit<ExecutionPolicyCandidate['distribution'], 'distributionRevision'>,
  );
  if (distribution.distributionRevision !== expectedDistributionRevision) throw new TypeError('distribution revision is not content-addressed');
  const expectedCandidate = deriveExecutionPolicyCandidateIdentity(
    materialWithout(candidate, ['candidateId', 'candidateRevision']) as unknown as Omit<ExecutionPolicyCandidate, 'candidateId' | 'candidateRevision'>,
  );
  if (candidate.candidateId !== expectedCandidate.candidateId || candidate.candidateRevision !== expectedCandidate.candidateRevision) {
    throw new TypeError('candidate identity is not content-addressed');
  }
  const metrics = metricsFor(scenarios, legs, confidencePpm);
  return { candidate: candidate as unknown as ExecutionPolicyCandidate, metrics };
}

function validateLeg(
  raw: unknown,
  spotCapabilities: readonly BinanceSpotOrderTifCapability[],
  usedSpotCapabilityRevisions: Set<string>,
): PolicyLeg {
  const leg = record(raw, LEG_FIELDS, 'policy leg');
  text(leg.legId, 'legId');
  text(leg.instrumentRevision, 'instrumentRevision');
  text(leg.filterRevision, 'filterRevision');
  text(leg.l04SizingRevision, 'l04SizingRevision');
  text(leg.l04SourceEvidenceRevision, 'l04SourceEvidenceRevision');
  text(leg.l04SnapshotRevision, 'l04SnapshotRevision');
  const l04PreflightState = oneOf(leg.l04PreflightState, ['PASS', 'BLOCKED'], 'l04PreflightState');
  const allowedOrderTypes = closedStringArray(leg.allowedOrderTypes, ['LIMIT', 'MARKET'], 'allowedOrderTypes');
  const allowedTimeInForce = closedStringArray(leg.allowedTimeInForce, ['FOK', 'GTC', 'IOC'], 'allowedTimeInForce');
  const product = oneOf(leg.product, ['SPOT', 'USD_M_PERPETUAL'], 'leg product');
  const spotCapability = product === 'SPOT'
    ? spotCapabilities.find((capability) => capability.symbol === leg.symbol
      && capability.side === leg.side)
    : undefined;
  if (product === 'SPOT' && spotCapability === undefined
    && (l04PreflightState !== 'BLOCKED' || allowedTimeInForce.length !== 0)) {
    throw new TypeError('accepted L04 cannot prove Spot execution/TIF readiness without an owner binding');
  }
  if (product === 'SPOT' && spotCapability !== undefined) {
    if (usedSpotCapabilityRevisions.has(spotCapability.capabilityRevision)
      || l04PreflightState !== 'PASS'
      || canonicalJson(allowedOrderTypes) !== '["LIMIT"]'
      || canonicalJson(allowedTimeInForce) !== canonicalJson([spotCapability.timeInForce])
      || leg.instrumentRevision !== spotCapability.instrumentRevision
      || leg.filterRevision !== spotCapability.registryRevision
      || leg.l04SizingRevision !== spotCapability.preflightRevision
      || leg.l04SourceEvidenceRevision !== spotCapability.sourceEvidenceRevision
      || leg.l04SnapshotRevision !== spotCapability.snapshotRevision
      || leg.symbol !== spotCapability.symbol
      || leg.baseAsset !== spotCapability.baseAsset
      || leg.quoteAsset !== spotCapability.quoteAsset
      || leg.side !== spotCapability.side
      || leg.reduceOnly !== false
      || leg.requestedQuantity !== spotCapability.requestedQuantity
      || leg.filteredQuantity !== spotCapability.resultQuantity
      || leg.authorizedLimitPrice !== spotCapability.requestedPrice
      || leg.filteredNotionalQuote !== spotCapability.resultNotional) {
      throw new TypeError('Spot policy leg does not exactly bind its L04 order/TIF capability');
    }
    usedSpotCapabilityRevisions.add(spotCapability.capabilityRevision);
  }
  if (product === 'USD_M_PERPETUAL' && l04PreflightState === 'PASS'
    && (allowedOrderTypes.length === 0 || allowedTimeInForce.length === 0)) {
    throw new TypeError('L04 PASS requires explicit USD-M order/TIF capability');
  }
  text(leg.accountRealmId, 'accountRealmId');
  text(leg.symbol, 'symbol', SYMBOL);
  text(leg.baseAsset, 'baseAsset', ASSET);
  text(leg.quoteAsset, 'quoteAsset', ASSET);
  oneOf(leg.side, ['BUY', 'SELL'], 'leg side');
  boolean(leg.reduceOnly, 'reduceOnly');
  canonicalDecimal(leg.requestedQuantity, 'requestedQuantity');
  canonicalDecimal(leg.filteredQuantity, 'filteredQuantity');
  canonicalDecimal(leg.authorizedLimitPrice, 'authorizedLimitPrice');
  canonicalDecimal(leg.filteredNotionalQuote, 'filteredNotionalQuote');
  if (leg.requestedQuantity === '0' || leg.filteredQuantity === '0'
    || leg.authorizedLimitPrice === '0' || leg.filteredNotionalQuote === '0') {
    throw new TypeError('leg sizing and price evidence must be positive');
  }
  return leg as unknown as PolicyLeg;
}

function validateConstraintEnvelope(
  raw: unknown,
  expectedOwner: PolicyConstraintEnvelope['owner'],
  expectedRevision: string,
): PolicyConstraintEnvelope {
  const value = record(raw, CONSTRAINT_FIELDS, `${expectedOwner} constraint envelope`);
  if (value.owner !== expectedOwner) throw new TypeError('constraint owner label is invalid');
  const ownerRevision = text(value.ownerRevision, 'constraint ownerRevision');
  if (ownerRevision !== expectedRevision) throw new TypeError('constraint revision does not bind its owner output');
  for (const key of [
    'maxQuantity', 'maxNotionalQuote', 'maxNakedQuantity', 'maxNakedNotionalQuote',
    'maxRecoveryCostQuote', 'maxScenarioLossQuote', 'maxTailLossQuote',
  ]) canonicalDecimal(value[key], key);
  integer(value.maxNakedDurationMs, 0, 86_400_000, 'maxNakedDurationMs');
  integer(value.cvarConfidencePpm, 1, TOTAL_PPM - 1, 'cvarConfidencePpm');
  integer(value.minimumCompletionPpm, 0, TOTAL_PPM, 'minimumCompletionPpm');
  return value as unknown as PolicyConstraintEnvelope;
}

function compareCandidates(left: { candidate: ExecutionPolicyCandidate; metrics: PolicyCandidateMetrics }, right: { candidate: ExecutionPolicyCandidate; metrics: PolicyCandidateMetrics }): number {
  const comparisons: number[] = [
    compareRationals(left.metrics.cvarLossQuote.weightedLossNumerator, left.metrics.cvarLossQuote.denominatorPpm, right.metrics.cvarLossQuote.weightedLossNumerator, right.metrics.cvarLossQuote.denominatorPpm),
    comparePolicyDecimals(left.metrics.maximumLossQuote, right.metrics.maximumLossQuote),
    compareRationals(left.metrics.expectedLossQuote.weightedNumerator, TOTAL_PPM, right.metrics.expectedLossQuote.weightedNumerator, TOTAL_PPM),
    compareRationals(left.metrics.expectedRecoveryCostQuote.weightedNumerator, TOTAL_PPM, right.metrics.expectedRecoveryCostQuote.weightedNumerator, TOTAL_PPM),
    left.metrics.maximumFillLatencyMs < right.metrics.maximumFillLatencyMs ? -1
      : left.metrics.maximumFillLatencyMs > right.metrics.maximumFillLatencyMs ? 1 : 0,
    BigInt(left.metrics.expectedFillLatencyMsNumerator) < BigInt(right.metrics.expectedFillLatencyMsNumerator) ? -1
      : BigInt(left.metrics.expectedFillLatencyMsNumerator) > BigInt(right.metrics.expectedFillLatencyMsNumerator) ? 1 : 0,
    BigInt(left.metrics.expectedNakedDurationMsNumerator) < BigInt(right.metrics.expectedNakedDurationMsNumerator) ? -1
      : BigInt(left.metrics.expectedNakedDurationMsNumerator) > BigInt(right.metrics.expectedNakedDurationMsNumerator) ? 1 : 0,
  ];
  for (const comparison of comparisons) if (comparison !== 0) return comparison;
  for (let index = 0; index < left.metrics.expectedFilledQuantityByLeg.length; index += 1) {
    const comparison = compareRationals(
      left.metrics.expectedFilledQuantityByLeg[index].evidence.weightedNumerator, TOTAL_PPM,
      right.metrics.expectedFilledQuantityByLeg[index].evidence.weightedNumerator, TOTAL_PPM,
    );
    if (comparison !== 0) return -comparison;
  }
  if (left.metrics.completionPpm !== right.metrics.completionPpm) return right.metrics.completionPpm - left.metrics.completionPpm;
  return stableTextCompare(left.candidate.candidateRevision, right.candidate.candidateRevision);
}

function finalizeDecision(material: Omit<ExecutionPolicyDecision, 'decisionId' | 'decisionRevision'>): ExecutionPolicyDecision {
  const decisionId = sha256('epdec_', material);
  const decisionRevision = sha256('epdecrev_', { ...material, decisionId });
  return deepFreeze({ ...material, decisionId, decisionRevision });
}

function rejectedInput(): ExecutionPolicyDecision {
  return finalizeDecision({
    schema: EXECUTION_POLICY_DECISION_SCHEMA,
    disposition: 'REJECTED',
    evaluatedAtMs: null,
    policyRequestId: null,
    policyVersion: null,
    reasonCodes: reasonSet(['INPUT_REJECTED']),
    selectedPlan: null,
    candidateEvaluations: Object.freeze([]),
    ...AUTHORITY,
  });
}

function rejectGlobal(
  input: ExecutionPolicyInput,
  reasons: Iterable<PolicyRejectionReason>,
): ExecutionPolicyDecision {
  return finalizeDecision({
    schema: EXECUTION_POLICY_DECISION_SCHEMA,
    disposition: 'REJECTED',
    evaluatedAtMs: input.evaluatedAtMs,
    policyRequestId: input.policyRequestId,
    policyVersion: input.policyVersion,
    reasonCodes: reasonSet(reasons),
    selectedPlan: null,
    candidateEvaluations: Object.freeze([]),
    ...AUTHORITY,
  });
}

function evaluateExecutionPolicyCore(
  rawInput: unknown,
  spotCapabilities: readonly BinanceSpotOrderTifCapability[],
): ExecutionPolicyDecision {
  let cloned: unknown;
  try {
    cloned = snapshot(rawInput);
    const serialized = canonicalJson(cloned);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SERIALIZED_BYTES) throw new RangeError('execution-policy input is overbound');
  } catch {
    return rejectedInput();
  }

  try {
    const raw = record(cloned, INPUT_FIELDS, 'execution-policy input');
    if (raw.schema !== EXECUTION_POLICY_INPUT_SCHEMA) throw new TypeError('input schema is unsupported');
    const policyRequestId = text(raw.policyRequestId, 'policyRequestId');
    const policyVersion = text(raw.policyVersion, 'policyVersion');
    const evaluatedAtMs = timestamp(raw.evaluatedAtMs, 'evaluatedAtMs');
    const authority = record(raw.authority, AUTHORITY_FIELDS, 'policy authority projection');
    oneOf(authority.state, ['AUTHORIZED', 'REVOKED', 'UNKNOWN'], 'authority state');
    for (const key of [
      'intentId', 'intentRevision', 'externalPlanId', 'correlationId', 'authorizationRevision',
      'mandateId', 'mandateRevision', 'capitalReservationId', 'capitalReservationRevision',
      'stagedPlanId', 'stagedPlanRevision', 'operatorApprovalId', 'operatorApprovalRevision',
      'riskVerdictId', 'riskVerdictRevision',
    ]) text(authority[key], key);
    if (authority.capitalAuthority !== 'CAPITAL_FOUNDATION' || authority.riskAuthority !== 'FOUNDATION') {
      throw new TypeError('owner authority labels are invalid');
    }
    boolean(authority.riskAllowed, 'riskAllowed');
    boolean(authority.killOrRevokeActive, 'killOrRevokeActive');
    timestamp(authority.observedAtMs, 'authority observedAtMs');
    timestamp(authority.validUntilMs, 'authority validUntilMs');
    const constraints = Object.freeze([
      validateConstraintEnvelope(authority.mandateConstraints, 'MANDATE', authority.mandateRevision as string),
      validateConstraintEnvelope(authority.capitalConstraints, 'CAPITAL_FOUNDATION', authority.capitalReservationRevision as string),
      validateConstraintEnvelope(authority.riskConstraints, 'FOUNDATION_RISK', authority.riskVerdictRevision as string),
      validateConstraintEnvelope(authority.approvalConstraints, 'OPERATOR_APPROVAL', authority.operatorApprovalRevision as string),
    ]);
    const confidencePpm = constraints[0].cvarConfidencePpm;

    const dependencies = array(raw.dependencies, DEPENDENCY_KINDS.length, DEPENDENCY_KINDS.length, 'dependencies');
    const dependencyKinds = new Set<PolicyDependencyKind>();
    for (const rawDependency of dependencies) {
      const dependency = record(rawDependency, DEPENDENCY_FIELDS, 'dependency evidence');
      const kind = oneOf(dependency.kind, DEPENDENCY_KINDS, 'dependency kind');
      if (dependencyKinds.has(kind)) throw new TypeError('dependency kinds must appear exactly once');
      dependencyKinds.add(kind);
      text(dependency.revision, 'dependency revision');
      oneOf(dependency.state, ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN', 'AMBIGUOUS'], 'dependency state');
      timestamp(dependency.observedAtMs, 'dependency observedAtMs');
      timestamp(dependency.validUntilMs, 'dependency validUntilMs');
    }
    if (dependencyKinds.size !== DEPENDENCY_KINDS.length) throw new TypeError('dependency set is incomplete');

    const usedSpotCapabilityRevisions = new Set<string>();
    const legs = array(raw.legs, 2, 2, 'policy legs')
      .map((leg) => validateLeg(leg, spotCapabilities, usedSpotCapabilityRevisions));
    if (usedSpotCapabilityRevisions.size !== spotCapabilities.length) {
      throw new TypeError('every Spot owner binding must bind exactly one policy leg');
    }
    if (new Set(legs.map((leg) => leg.legId)).size !== legs.length) throw new TypeError('leg identities must be unique');
    if (new Set(legs.map((leg) => leg.baseAsset)).size !== 1) throw new TypeError('policy legs require one exposure quantity asset');
    if (new Set(legs.map((leg) => leg.quoteAsset)).size !== 1) throw new TypeError('policy legs require one quote/loss unit');
    const rawCandidates = array(raw.candidates, 1, MAX_CANDIDATES, 'policy candidates');
    const input = raw as unknown as ExecutionPolicyInput;
    const dependencyRevision = (kind: PolicyDependencyKind): string => (
      (dependencies.find((dependency) => (dependency as Record<string, unknown>).kind === kind) as Record<string, string>).revision
    );

    const globalReasons = new Set<PolicyRejectionReason>();
    if (spotCapabilities.length > 0
      && dependencyRevision('INSTRUMENT_FILTER')
        !== deriveSpotOrderTifDependencyRevision(spotCapabilities)) {
      globalReasons.add('OWNER_REVISION_MISMATCH');
    }
    if (spotCapabilities.some((capability) => capability.evaluatedAtMs > evaluatedAtMs
      || capability.validUntilMs <= evaluatedAtMs)) {
      globalReasons.add('DEPENDENCY_STALE');
    }
    if (constraints.some((constraint) => constraint.cvarConfidencePpm !== confidencePpm)) {
      globalReasons.add('OWNER_REVISION_MISMATCH');
    }
    if (authority.state !== 'AUTHORIZED' || authority.riskAllowed !== true || authority.killOrRevokeActive === true) {
      globalReasons.add('INTENT_NOT_AUTHORIZED');
    }
    if ((authority.validUntilMs as number) <= evaluatedAtMs) globalReasons.add('AUTHORIZATION_EXPIRED');
    if ((authority.observedAtMs as number) > evaluatedAtMs) globalReasons.add('DEPENDENCY_STALE');
    for (const rawDependency of dependencies) {
      const dependency = rawDependency as Record<string, unknown>;
      if (dependency.state === 'AMBIGUOUS') {
        globalReasons.add('AMBIGUITY_REQUIRES_RECONCILIATION');
      } else if (dependency.state !== 'AVAILABLE') {
        if (dependency.kind === 'INSTRUMENT_FILTER') globalReasons.add('INSTRUMENT_OR_FILTER_UNAVAILABLE');
        else if (dependency.kind === 'BOOK' || dependency.kind === 'COST') globalReasons.add('BOOK_OR_COST_EVIDENCE_UNAVAILABLE');
        else globalReasons.add('DEPENDENCY_STALE');
      }
      if ((dependency.observedAtMs as number) > evaluatedAtMs || (dependency.validUntilMs as number) <= evaluatedAtMs) {
        globalReasons.add('DEPENDENCY_STALE');
      }
    }
    for (const leg of legs) {
      if (leg.l04PreflightState !== 'PASS') globalReasons.add('INSTRUMENT_OR_FILTER_UNAVAILABLE');
      if (comparePolicyDecimals(leg.filteredQuantity, leg.requestedQuantity) > 0
        || constraints.some((constraint) => comparePolicyDecimals(leg.filteredQuantity, constraint.maxQuantity) > 0)
        || constraints.some((constraint) => comparePolicyDecimals(leg.filteredNotionalQuote, constraint.maxNotionalQuote) > 0)) {
        globalReasons.add('QUANTITY_OR_NOTIONAL_EXCEEDED');
      }
    }
    if (globalReasons.size > 0) return rejectGlobal(input, globalReasons);

    const candidateIds = new Map<string, string>();
    const evaluations: PolicyCandidateEvaluation[] = [];
    const authorized: { candidate: ExecutionPolicyCandidate; metrics: PolicyCandidateMetrics }[] = [];
    for (const rawCandidate of rawCandidates) {
      const parsed = validateCandidate(rawCandidate, legs, evaluatedAtMs, confidencePpm);
      const prior = candidateIds.get(parsed.candidate.candidateId);
      if (prior !== undefined) throw new TypeError(prior === parsed.candidate.candidateRevision
        ? 'duplicate candidate identity' : 'same candidate identity has conflicting content');
      candidateIds.set(parsed.candidate.candidateId, parsed.candidate.candidateRevision);
      const reasons = new Set<PolicyRejectionReason>();
      const distribution = parsed.candidate.distribution;
      if (parsed.candidate.authorizationRevision !== authority.authorizationRevision
        || parsed.candidate.mandateRevision !== authority.mandateRevision
        || parsed.candidate.capitalReservationRevision !== authority.capitalReservationRevision
        || parsed.candidate.riskVerdictRevision !== authority.riskVerdictRevision
        || parsed.candidate.stagedPlanRevision !== authority.stagedPlanRevision
        || parsed.candidate.operatorApprovalRevision !== authority.operatorApprovalRevision) {
        reasons.add('OWNER_REVISION_MISMATCH');
      }
      if (distribution.state === 'UNAVAILABLE') reasons.add('DISTRIBUTION_UNAVAILABLE');
      if (distribution.state !== 'CALIBRATED'
        || distribution.sampleCount < distribution.minimumRequiredSampleCount) {
        reasons.add('DISTRIBUTION_UNCALIBRATED');
      }
      if (distribution.modelRevision !== dependencyRevision('MODEL')
        || distribution.calibrationRevision !== dependencyRevision('CALIBRATION')
        || distribution.lineageExchangeTwinRevision !== dependencyRevision('EXCHANGE_TWIN')) {
        reasons.add('OWNER_REVISION_MISMATCH');
      }
      if (distribution.quoteAsset !== legs[0].quoteAsset || distribution.observedAtMs > evaluatedAtMs
        || distribution.validUntilMs <= evaluatedAtMs || parsed.candidate.expiresAtMs <= evaluatedAtMs) {
        reasons.add('DISTRIBUTION_UNAVAILABLE');
      }
      for (const action of parsed.candidate.actions) {
        if (action.kind === 'CANCEL') continue;
        const leg = legs.find((item) => item.legId === action.legId)!;
        if (!leg.allowedOrderTypes.includes(action.orderType! as PolicyLeg['allowedOrderTypes'][number])
          || (action.timeInForce !== null && !leg.allowedTimeInForce.includes(action.timeInForce))) {
          reasons.add('INSTRUMENT_OR_FILTER_UNAVAILABLE');
        }
        if (action.kind === 'RECOVER'
          && (action.recoveryEvidenceRevision !== dependencyRevision('RECOVERY')
            || action.targetExposureRevision !== dependencyRevision('CURRENT_POSITION'))) {
          reasons.add('OWNER_REVISION_MISMATCH');
        }
        if (action.orderType === 'MARKET') reasons.add('PRICE_BOUND_EXCEEDED');
        if (comparePolicyDecimals(action.quantity!, leg.filteredQuantity) > 0
          || constraints.some((constraint) => comparePolicyDecimals(action.quantity!, constraint.maxQuantity) > 0)) {
          reasons.add('QUANTITY_OR_NOTIONAL_EXCEEDED');
        }
        if (action.price !== null) {
          const comparison = comparePolicyDecimals(action.price, leg.authorizedLimitPrice);
          const actionNotional = multiplyPolicyDecimals(action.quantity!, action.price);
          if ((leg.side === 'BUY' && comparison > 0) || (leg.side === 'SELL' && comparison < 0)) reasons.add('PRICE_BOUND_EXCEEDED');
          if (comparePolicyDecimals(
            actionNotional,
            leg.filteredNotionalQuote,
          ) > 0 || constraints.some((constraint) => comparePolicyDecimals(
            actionNotional,
            constraint.maxNotionalQuote,
          ) > 0)) reasons.add('QUANTITY_OR_NOTIONAL_EXCEEDED');
        }
        if (parsed.candidate.posture === 'PASSIVE' && (action.orderType !== 'LIMIT' || action.timeInForce !== 'GTC')) {
          reasons.add('INSTRUMENT_OR_FILTER_UNAVAILABLE');
        }
      }
      for (const scenario of distribution.scenarios) {
        if (parsed.candidate.sequenceMode === 'ORDERED'
          && comparePolicyDecimals(
            scenarioFill(scenario, legs[1].legId),
            scenarioFill(scenario, legs[0].legId),
          ) > 0) reasons.add('DISTRIBUTION_UNAVAILABLE');
        for (const leg of legs) {
          const placementDeadline = parsed.candidate.actions.find(
            (action) => action.kind === 'PLACE' && action.legId === leg.legId,
          )!.deadlineOffsetMs;
          if (scenarioFill(scenario, leg.legId) !== '0' && scenario.fillLatencyMs > placementDeadline) {
            reasons.add('DISTRIBUTION_UNAVAILABLE');
          }
        }
        if (constraints.some((constraint) => comparePolicyDecimals(scenario.maxNakedQuantity, constraint.maxNakedQuantity) > 0)
          || constraints.some((constraint) => comparePolicyDecimals(scenario.maxNakedNotionalQuote, constraint.maxNakedNotionalQuote) > 0)) {
          reasons.add('CAPITAL_OR_RISK_LIMIT_EXCEEDED');
        }
        if (constraints.some((constraint) => scenario.maxNakedDurationMs > constraint.maxNakedDurationMs)) reasons.add('NAKED_DURATION_EXCEEDED');
        if (constraints.some((constraint) => comparePolicyDecimals(scenario.recoveryCostQuote, constraint.maxRecoveryCostQuote) > 0)) {
          reasons.add('RECOVERY_BUDGET_EXCEEDED');
        }
        if (constraints.some((constraint) => comparePolicyDecimals(scenario.lossQuote, constraint.maxScenarioLossQuote) > 0)) reasons.add('TAIL_LOSS_EXCEEDED');
        for (const action of parsed.candidate.actions.filter((item) => item.timeInForce === 'FOK' && item.quantity !== null)) {
          const filled = scenarioFill(scenario, action.legId);
          if (filled !== '0' && comparePolicyDecimals(filled, action.quantity!) !== 0) reasons.add('DISTRIBUTION_UNAVAILABLE');
        }
      }
      if (constraints.some((constraint) => !rationalWithinLimit(
        parsed.metrics.cvarLossQuote.weightedLossNumerator,
        parsed.metrics.cvarLossQuote.denominatorPpm,
        constraint.maxTailLossQuote,
      ))) reasons.add('TAIL_LOSS_EXCEEDED');
      if (constraints.some((constraint) => parsed.metrics.completionPpm < constraint.minimumCompletionPpm)) {
        reasons.add('CAPITAL_OR_RISK_LIMIT_EXCEEDED');
      }
      const reasonCodes = reasonSet(reasons);
      evaluations.push(deepFreeze({
        candidateId: parsed.candidate.candidateId,
        candidateRevision: parsed.candidate.candidateRevision,
        distributionRevision: distribution.distributionRevision,
        modelRevision: distribution.modelRevision,
        calibrationRevision: distribution.calibrationRevision,
        authorized: reasonCodes.length === 0,
        reasonCodes,
        metrics: parsed.metrics,
      }));
      if (reasonCodes.length === 0) authorized.push(parsed);
    }
    evaluations.sort((left, right) => stableTextCompare(left.candidateId, right.candidateId));
    if (authorized.length === 0) {
      const allReasons = evaluations.flatMap((evaluation) => evaluation.reasonCodes);
      allReasons.push('NO_AUTHORIZED_POLICY');
      return finalizeDecision({
        schema: EXECUTION_POLICY_DECISION_SCHEMA,
        disposition: 'REJECTED', evaluatedAtMs, policyRequestId, policyVersion,
        reasonCodes: reasonSet(allReasons), selectedPlan: null,
        candidateEvaluations: evaluations, ...AUTHORITY,
      });
    }
    authorized.sort(compareCandidates);
    const selected = authorized[0];
    const expiresAtMs = Math.min(
      authority.validUntilMs as number,
      selected.candidate.expiresAtMs,
      selected.candidate.distribution.validUntilMs,
      ...dependencies.map((dependency) => (dependency as Record<string, number>).validUntilMs),
      ...spotCapabilities.map((capability) => capability.validUntilMs),
    );
    const planMaterial = {
      schema: 'LIVE_EDGE_EXECUTION_POLICY_PLAN_V1' as const,
      policyRequestId, policyVersion,
      intentId: authority.intentId as string,
      intentRevision: authority.intentRevision as string,
      externalPlanId: authority.externalPlanId as string,
      correlationId: authority.correlationId as string,
      authorizationRevision: authority.authorizationRevision as string,
      mandateId: authority.mandateId as string,
      mandateRevision: authority.mandateRevision as string,
      capitalReservationId: authority.capitalReservationId as string,
      capitalReservationRevision: authority.capitalReservationRevision as string,
      stagedPlanId: authority.stagedPlanId as string,
      stagedPlanRevision: authority.stagedPlanRevision as string,
      operatorApprovalId: authority.operatorApprovalId as string,
      operatorApprovalRevision: authority.operatorApprovalRevision as string,
      riskVerdictId: authority.riskVerdictId as string,
      riskVerdictRevision: authority.riskVerdictRevision as string,
      evidenceRevisions: Object.freeze([...dependencies.map((dependency) => {
        const value = dependency as Record<string, string>;
        return `${value.kind}:${value.revision}`;
      }), ...spotCapabilities.map((capability) => (
        `SPOT_ORDER_TIF_CAPABILITY:${capability.capabilityRevision}`
      ))].sort()),
      distributionRevision: selected.candidate.distribution.distributionRevision,
      modelRevision: selected.candidate.distribution.modelRevision,
      calibrationRevision: selected.candidate.distribution.calibrationRevision,
      lineageExchangeTwinRevision: selected.candidate.distribution.lineageExchangeTwinRevision,
      selectedCandidateId: selected.candidate.candidateId,
      selectedCandidateRevision: selected.candidate.candidateRevision,
      posture: selected.candidate.posture,
      sequenceMode: selected.candidate.sequenceMode,
      legs: Object.freeze([...legs]),
      actions: Object.freeze([...selected.candidate.actions].sort((left, right) => left.step - right.step)),
      failureTransitions: selected.candidate.failureTransitions,
      legFailureTransitions: Object.freeze([...selected.candidate.legFailureTransitions]
        .sort((left, right) => stableTextCompare(left.legId, right.legId))),
      metrics: selected.metrics,
      expiresAtMs,
      ...AUTHORITY,
    };
    const planId = sha256('epplan_', planMaterial);
    const plan: ExecutionPolicyPlan = deepFreeze({
      ...planMaterial,
      planId,
      planRevision: sha256('epplanrev_', { ...planMaterial, planId }),
    });
    return finalizeDecision({
      schema: EXECUTION_POLICY_DECISION_SCHEMA,
      disposition: 'PLANNED', evaluatedAtMs, policyRequestId, policyVersion,
      reasonCodes: Object.freeze([]), selectedPlan: plan,
      candidateEvaluations: evaluations, ...AUTHORITY,
    });
  } catch {
    return rejectedInput();
  }
}

/**
 * Preserves the accepted L08 evaluator exactly: without an explicit owner
 * binding, Spot remains fail-closed at the accepted L04 posture.
 */
export function evaluateExecutionPolicy(rawInput: unknown): ExecutionPolicyDecision {
  return evaluateExecutionPolicyCore(rawInput, Object.freeze([]));
}

/**
 * Opt-in L08.1 seam for an exact, non-sendable L04 Spot LIMIT/TIF binding.
 * The binding can validate policy mechanics; it cannot submit an action.
 */
export function evaluateExecutionPolicyWithOwnerBindings(
  rawInput: unknown,
  rawBindings: unknown,
): ExecutionPolicyDecision {
  try {
    const clonedBindings = deepFreeze(snapshot(rawBindings));
    const envelope = record(clonedBindings, OWNER_BINDING_FIELDS, 'execution-policy owner bindings');
    if (envelope.schema !== EXECUTION_POLICY_OWNER_BINDINGS_SCHEMA) {
      throw new TypeError('execution-policy owner binding schema is unsupported');
    }
    const capabilities = array(
      envelope.spotOrderTifOwnerInputs,
      1,
      2,
      'Spot order/TIF owner inputs',
    ).map((rawOwnerInput) => {
      const ownerInput = record(rawOwnerInput, SPOT_OWNER_INPUT_FIELDS, 'Spot order/TIF owner input');
      const result = bindSpotOrderTifCapability(
        ownerInput.registrySnapshot,
        ownerInput.sizingRequest,
      );
      if (!result.ok) throw new TypeError(`Spot owner binding failed: ${result.reasonCodes.join(',')}`);
      return validateSpotOrderTifCapability(result.binding);
    });
    if (new Set(capabilities.map((capability) => capability.capabilityRevision)).size
      !== capabilities.length) {
      throw new TypeError('Spot order/TIF capability revisions must be unique');
    }
    return evaluateExecutionPolicyCore(rawInput, Object.freeze(capabilities));
  } catch {
    return rejectedInput();
  }
}

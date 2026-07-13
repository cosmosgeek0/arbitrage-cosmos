import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import { canonicalJson } from '../../../foundation/contracts/index.js';
import {
  absoluteReverseBasisDifference,
  addReverseBasisDecimals,
  compareReverseBasisDecimals,
  reverseBasisDecimal,
  subtractReverseBasisFloorZero,
  sumReverseBasisDecimals,
} from './exact.js';
import {
  REVERSE_BASIS_CHECKPOINT_SCHEMA,
  REVERSE_BASIS_INPUT_SCHEMA,
  REVERSE_BASIS_NO_ACTION_AUTHORITY,
  REVERSE_BASIS_REQUIRED_GATES,
  REVERSE_BASIS_STATE_SCHEMA,
  type ReverseBasisBorrowObservation,
  type ReverseBasisCheckpoint,
  type ReverseBasisClosureEvidence,
  type ReverseBasisEvent,
  type ReverseBasisExposure,
  type ReverseBasisLifecycleInput,
  type ReverseBasisLifecycleStage,
  type ReverseBasisLifecycleState,
  type ReverseBasisLiabilityObservation,
  type ReverseBasisManualIntervention,
  type ReverseBasisOrderObservation,
  type ReverseBasisOrderProjection,
  type ReverseBasisOrderRole,
  type ReverseBasisPolicySet,
  type ReverseBasisPolicyWitness,
  type ReverseBasisProcessedEvent,
  type ReverseBasisRecoveryEvidence,
  type ReverseBasisRecoveryProjection,
  type ReverseBasisRepayObservation,
  type ReverseBasisTicket,
} from './types.js';
import type {
  ExecutionPolicyDecision,
  ExecutionPolicyPlan,
  PolicyAction,
  PolicyLeg,
} from '../executionPolicy/types.js';
import { evaluateExecutionPolicy } from '../executionPolicy/policy.js';
import { checkpointExchangeTwin } from '../exchangeTwin/twin.js';
import type { TwinOrderState, TwinScenarioState } from '../exchangeTwin/types.js';

const MAX_UTC_MS = 4_102_444_800_000;
const MAX_EVENTS = 512;
const MAX_ORDERS = 128;
const MAX_GRAPH_DEPTH = 64;
const MAX_GRAPH_NODES = 250_000;
const MAX_SERIALIZED_BYTES = 8_000_000;
const ID = /^[A-Za-z][A-Za-z0-9._:-]{5,191}$/;
const SYMBOL = /^(?=.{2,40}$)[A-Z0-9._-]+$/;
const ASSET = /^(?=.{2,20}$)[A-Z0-9._-]+$/;
const SECRET_FIELDS = new Set([
  'apikey', 'apisecret', 'secret', 'password', 'passphrase', 'token', 'bearer',
  'signature', 'privatekey', 'credential', 'cookie', 'mnemonic',
]);
const MARGIN_ROLES = new Set<ReverseBasisOrderRole>([
  'MARGIN_ENTRY_SELL', 'MARGIN_EXIT_COVER', 'RECOVERY_MARGIN_COVER',
]);
const FUTURES_ROLES = new Set<ReverseBasisOrderRole>([
  'FUTURES_ENTRY_HEDGE', 'FUTURES_EXIT_CLOSE', 'RECOVERY_FUTURES_ADJUST',
]);
const LIFECYCLE_STAGES = new Set<string>([
  'BLOCKED', 'PREFLIGHTED', 'BORROWING', 'LIABILITY_CONFIRMED',
  'ENTRY_MARGIN_SELL_WORKING', 'HEDGE_WORKING', 'OPEN', 'EXITING', 'REPAYING',
  'CLOSED', 'RECOVERY_REQUIRED', 'RECOVERING', 'RECOVERED',
  'MANUAL_INTERVENTION',
]);
const EVENT_KINDS = new Set<string>([
  'BORROW_OBSERVED', 'LIABILITY_OBSERVED', 'ORDER_OBSERVED', 'REPAY_OBSERVED',
  'RECOVERY_EVIDENCE', 'CLOSURE_RECONCILED', 'MANUAL_INTERVENTION',
]);

interface PolicyContext {
  readonly entry: ExecutionPolicyPlan;
  readonly exit: ExecutionPolicyPlan;
  readonly recovery: ExecutionPolicyPlan;
}

interface MutableLifecycle {
  borrow: ReverseBasisBorrowObservation | null;
  initialLiability: ReverseBasisLiabilityObservation | null;
  liability: ReverseBasisLiabilityObservation | null;
  repay: ReverseBasisRepayObservation | null;
  repayBasis: ReverseBasisLiabilityObservation | null;
  orders: Map<string, ReverseBasisOrderProjection>;
  recoveryEvidence: ReverseBasisRecoveryProjection[];
  recoveryBatchTargetRevision: string | null;
  closureEvidence: ReverseBasisClosureEvidence | null;
  manualIntervention: ReverseBasisManualIntervention | null;
  nakedRiskStartedAtMs: number | null;
  nakedRiskLimitBreached: boolean;
  borrowOccurredAtMs: number | null;
  repayOccurredAtMs: number | null;
  lastOrderOccurredAtMs: number | null;
}

interface DerivedLifecycle {
  readonly exposure: ReverseBasisExposure;
  readonly openOrderRefs: readonly string[];
  readonly ambiguousMutationRefs: readonly string[];
  readonly unmatchedFillRefs: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly stage: ReverseBasisLifecycleStage;
}

function digest(prefix: string, value: unknown): string {
  const serialized = canonicalJson(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SERIALIZED_BYTES) {
    throw new RangeError('reverse-basis serialized content is overbound');
  }
  return `${prefix}${createHash('sha256').update(serialized).digest('hex')}`;
}

function stableUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(stableTextCompare));
}

function stableTextCompare(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPlainData(
  value: unknown,
  seen = new Set<object>(),
  depth = 0,
  budget = { count: 0 },
): void {
  budget.count += 1;
  if (budget.count > MAX_GRAPH_NODES) throw new RangeError('reverse-basis graph node bound exceeded');
  if (depth > MAX_GRAPH_DEPTH) throw new RangeError('reverse-basis graph depth exceeded');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('reverse-basis numbers must be safe integers');
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 4_096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
      throw new TypeError('reverse-basis string is unsafe or overbound');
    }
    return;
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value)) {
    throw new TypeError('reverse-basis input must contain plain data only');
  }
  if (seen.has(value)) return;
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
    throw new TypeError('reverse-basis input must contain plain records and arrays');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') throw new TypeError('reverse-basis symbol keys are forbidden');
    if (SECRET_FIELDS.has(key.replaceAll('_', '').toLowerCase())) {
      throw new TypeError('reverse-basis secret-shaped fields are forbidden');
    }
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('reverse-basis accessors are forbidden');
    }
    if (key !== 'length') assertPlainData(descriptor.value, seen, depth + 1, budget);
  }
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function clonePlain<T>(value: T): T {
  assertPlainData(value);
  return structuredClone(value);
}

function requireRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a record`);
  }
}

function requireExactRecord(
  value: unknown,
  fields: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(stableTextCompare);
  const expected = [...fields].sort(stableTextCompare);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new TypeError(`${label} fields are invalid`);
  }
}

function requireInterval(observedAtMs: number, validUntilMs: number, label: string): void {
  requireUtc(observedAtMs, `${label}.observedAtMs`);
  requireUtc(validUntilMs, `${label}.validUntilMs`);
  if (validUntilMs < observedAtMs) throw new TypeError(`${label} validity interval is invalid`);
}

function mappedOwnerId(prefix: string, value: string, length = 16): string {
  return `${prefix}${createHash('sha256').update(value).digest('hex').slice(0, length)}`;
}

function sumTwinFillNotional(order: TwinOrderState): string {
  return sumReverseBasisDecimals(order.fills.map((fill) => fill.quoteNotional));
}

function requireId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${label} is invalid`);
}

function requireSymbol(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SYMBOL.test(value)) throw new TypeError(`${label} is invalid`);
}

function requireAsset(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !ASSET.test(value)) throw new TypeError(`${label} is invalid`);
}

function requireUtc(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_UTC_MS) {
    throw new TypeError(`${label} must be UTC milliseconds`);
  }
}

function requirePositiveInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > maximum) {
    throw new TypeError(`${label} must be a positive bounded integer`);
  }
}

function requireAuthority(value: Record<string, unknown>, label: string): void {
  if (
    value.simulationAuthority !== 'SYNTHETIC_FIXTURE'
    || value.sendEligible !== false
    || value.privateReadAuthority !== 'NONE'
    || value.mutationAuthority !== 'NONE'
    || value.actionAuthority !== 'NONE_RECORD_ONLY'
    || value.externalActionAuthorization !== 'NONE'
  ) throw new TypeError(`${label} attempts to widen action authority`);
}

function selectedPlan(witness: Readonly<ReverseBasisPolicyWitness>, label: string): ExecutionPolicyPlan {
  requireExactRecord(witness, ['input', 'decision'], `${label} witness`);
  const decision = evaluateExecutionPolicy(witness.input);
  if (canonicalJson(decision) !== canonicalJson(witness.decision)) {
    throw new TypeError(`${label} is not the canonical result of its accepted L08 input`);
  }
  if (
    decision.schema !== 'LIVE_EDGE_EXECUTION_POLICY_DECISION_V1'
    || decision.disposition !== 'PLANNED'
    || decision.selectedPlan === null
    || decision.policyAuthority !== 'ADVISORY_EXECUTION_MECHANICS_ONLY'
    || decision.simulationAuthority !== 'SYNTHETIC_FIXTURE'
    || decision.sendEligible !== false
    || decision.actionAuthority !== 'NONE_RECORD_ONLY'
    || decision.externalActionAuthorization !== 'NONE'
  ) throw new TypeError(`${label} must be an accepted non-sendable L08 plan`);
  const plan = decision.selectedPlan;
  if (
    plan.policyAuthority !== 'ADVISORY_EXECUTION_MECHANICS_ONLY'
    || plan.simulationAuthority !== 'SYNTHETIC_FIXTURE'
    || plan.sendEligible !== false
    || plan.actionAuthority !== 'NONE_RECORD_ONLY'
    || plan.externalActionAuthorization !== 'NONE'
  ) throw new TypeError(`${label} plan attempts to widen authority`);
  requireId(plan.planId, `${label}.planId`);
  requireId(plan.planRevision, `${label}.planRevision`);
  return plan;
}

function matchingPlace(plan: ExecutionPolicyPlan, legId: string): PolicyAction {
  const matches = plan.actions.filter((action) => action.kind === 'PLACE' && action.legId === legId);
  if (matches.length !== 1) throw new TypeError(`L08 plan must have one PLACE action for ${legId}`);
  return matches[0];
}

function orderedPlacePair(plan: ExecutionPolicyPlan): readonly [PolicyAction, PolicyAction] {
  const places = plan.actions
    .filter((action) => action.kind === 'PLACE')
    .sort((left, right) => left.step - right.step);
  if (places.length !== 2) throw new TypeError('L08 mechanics witness must have two PLACE actions');
  return Object.freeze([places[0], places[1]] as const);
}

function legById(plan: ExecutionPolicyPlan, legId: string): PolicyLeg {
  const matches = plan.legs.filter((leg) => leg.legId === legId);
  if (matches.length !== 1) throw new TypeError(`L08 plan leg ${legId} is missing`);
  return matches[0];
}

function validateOrderedActualFillPlan(
  plan: ExecutionPolicyPlan,
  spotSide: PolicyLeg['side'],
  futuresSide: PolicyLeg['side'],
  exit: boolean,
): void {
  if (plan.sequenceMode !== 'ORDERED') throw new TypeError('reverse-basis policy must be ordered');
  const [spotAction, futuresAction] = orderedPlacePair(plan);
  const spotLeg = legById(plan, spotAction.legId);
  const futuresLeg = legById(plan, futuresAction.legId);
  if (spotLeg.side !== spotSide || futuresLeg.side !== futuresSide) {
    throw new TypeError('L08 mechanics witness sides do not match reverse-basis stage');
  }
  if (spotLeg.reduceOnly) throw new TypeError('first-leg mechanics witness cannot be reduceOnly');
  if (futuresLeg.reduceOnly !== exit) throw new TypeError('second-leg reduceOnly does not match entry/exit role');
  if (
    spotAction.step >= futuresAction.step
    || spotAction.quantitySource !== 'AUTHORIZED_FILTERED_QUANTITY'
    || spotAction.dependsOnActualFillLegId !== null
    || futuresAction.quantitySource !== 'ACTUAL_FILL_OF_LEG'
    || futuresAction.dependsOnActualFillLegId !== spotLeg.legId
    || futuresAction.ambiguityPosture !== 'RECONCILE_ONLY'
  ) throw new TypeError('L08 policy does not hedge/close the actual first-leg fill');
}

function validatePolicySet(
  policies: Readonly<ReverseBasisPolicySet>,
  ticket: ReverseBasisTicket,
): PolicyContext {
  requireExactRecord(policies, ['entry', 'exit', 'recovery'], 'policy set');
  const entry = selectedPlan(policies.entry, 'entry policy');
  const exit = selectedPlan(policies.exit, 'exit policy');
  const recovery = selectedPlan(policies.recovery, 'recovery policy');
  validateOrderedActualFillPlan(entry, 'SELL', 'BUY', false);
  validateOrderedActualFillPlan(exit, 'BUY', 'SELL', true);
  validateOrderedActualFillPlan(recovery, 'BUY', 'SELL', true);
  const recoverActions = recovery.actions.filter((action) => action.kind === 'RECOVER');
  const [recoveryMarginAction, recoveryFuturesAction] = orderedPlacePair(recovery);
  const recoveryMarginLeg = legById(recovery, recoveryMarginAction.legId);
  const recoveryFuturesLeg = legById(recovery, recoveryFuturesAction.legId);
  if (
    recovery.posture !== 'RECOVERY'
    || recoverActions.length !== 2
    || !recoverActions.some((action) => action.legId === recoveryMarginLeg.legId)
    || !recoverActions.some((action) => action.legId === recoveryFuturesLeg.legId)
    || recoverActions.some((action) => (
      action.exposureEffect !== 'RISK_REDUCING_ONLY'
      || action.quantitySource !== 'RISK_REDUCING_RECOVERY_EVIDENCE'
      || action.recoveryEvidenceRevision === null
      || action.targetExposureRevision === null
      || action.ambiguityPosture !== 'RECONCILE_ONLY'
    ))
  ) throw new TypeError('recovery policy is not exact-evidence-bound and risk reducing');
  const chain = ticket.ownerChain;
  for (const plan of [entry, exit, recovery]) {
    if (
      plan.correlationId !== entry.correlationId
      || plan.intentId !== entry.intentId
      || plan.intentRevision !== entry.intentRevision
      || plan.authorizationRevision !== entry.authorizationRevision
      || plan.mandateId !== entry.mandateId
      || plan.mandateRevision !== entry.mandateRevision
      || plan.capitalReservationId !== entry.capitalReservationId
      || plan.capitalReservationRevision !== entry.capitalReservationRevision
      || plan.riskVerdictId !== entry.riskVerdictId
      || plan.riskVerdictRevision !== entry.riskVerdictRevision
      || plan.stagedPlanId !== entry.stagedPlanId
      || plan.stagedPlanRevision !== entry.stagedPlanRevision
      || plan.operatorApprovalId !== entry.operatorApprovalId
      || plan.operatorApprovalRevision !== entry.operatorApprovalRevision
      || plan.expiresAtMs < ticket.expiresAtMs
    ) throw new TypeError('L08 policies do not share the ticket owner chain or lifetime');
    for (const leg of plan.legs) {
      if (
        leg.symbol !== ticket.account.symbol
        || leg.baseAsset !== ticket.account.baseAsset
        || leg.quoteAsset !== ticket.account.quoteAsset
      ) throw new TypeError('L08 policy instrument does not match reverse-basis ticket');
    }
    if (
      plan.correlationId !== chain.correlationId
      || plan.intentId !== chain.intentId
      || plan.intentRevision !== chain.intentRevision
      || plan.authorizationRevision !== chain.authorizationRevision
      || plan.mandateId !== chain.mandateId
      || plan.mandateRevision !== chain.mandateRevision
      || plan.capitalReservationId !== chain.capitalReservationId
      || plan.capitalReservationRevision !== chain.capitalReservationRevision
      || plan.stagedPlanId !== chain.stagedPlanId
      || plan.stagedPlanRevision !== chain.stagedPlanRevision
      || plan.operatorApprovalId !== chain.operatorApprovalId
      || plan.operatorApprovalRevision !== chain.operatorApprovalRevision
      || plan.riskVerdictId !== chain.riskVerdictId
      || plan.riskVerdictRevision !== chain.riskVerdictRevision
    ) throw new TypeError('L08 policy owner chain does not match reverse-basis ticket');
    const [marginAction, futuresAction] = orderedPlacePair(plan);
    const marginLeg = legById(plan, marginAction.legId);
    const futuresLeg = legById(plan, futuresAction.legId);
    if (
      marginLeg.accountRealmId !== ticket.account.accountRealmId
      || futuresLeg.accountRealmId !== ticket.account.futuresAccountRealmId
      || marginLeg.product !== 'USD_M_PERPETUAL'
      || futuresLeg.product !== 'USD_M_PERPETUAL'
    ) throw new TypeError('L08 mechanics witness realm/product mapping does not match ticket');
  }
  const bindings = ticket.policyDecisions;
  if (
    policies.entry.decision.decisionId !== bindings.entryDecisionId
    || policies.entry.decision.decisionRevision !== bindings.entryDecisionRevision
    || policies.exit.decision.decisionId !== bindings.exitDecisionId
    || policies.exit.decision.decisionRevision !== bindings.exitDecisionRevision
    || policies.recovery.decision.decisionId !== bindings.recoveryDecisionId
    || policies.recovery.decision.decisionRevision !== bindings.recoveryDecisionRevision
  ) throw new TypeError('L08 decision identities do not match reverse-basis ticket');
  for (const witness of [policies.entry, policies.exit, policies.recovery]) {
    const authority = witness.input.authority;
    for (const envelope of [
      authority.mandateConstraints,
      authority.capitalConstraints,
      authority.riskConstraints,
      authority.approvalConstraints,
    ]) {
      if (
        compareReverseBasisDecimals(ticket.requestedPrincipal, envelope.maxQuantity) > 0
        || compareReverseBasisDecimals(ticket.maxGrossNotionalQuote, envelope.maxNotionalQuote) > 0
        || compareReverseBasisDecimals(ticket.maxNakedQuantity, envelope.maxNakedQuantity) > 0
        || compareReverseBasisDecimals(
          ticket.maxNakedNotionalQuote,
          envelope.maxNakedNotionalQuote,
        ) > 0
        || ticket.maxNakedDurationMs > envelope.maxNakedDurationMs
        || compareReverseBasisDecimals(
          ticket.maxRecoveryCostQuote,
          envelope.maxRecoveryCostQuote,
        ) > 0
        || compareReverseBasisDecimals(
          ticket.maxRecoveryGrossNotionalQuote,
          envelope.maxNotionalQuote,
        ) > 0
      ) throw new TypeError('reverse-basis ticket exceeds an accepted L08 owner constraint');
    }
  }
  return Object.freeze({ entry, exit, recovery });
}

function validateTicket(ticket: ReverseBasisTicket): void {
  requireExactRecord(ticket, [
    'ticketId', 'decisionId', 'basisProposalId', 'basisProposalRevision', 'direction',
    'account', 'ownerChain', 'policyDecisions', 'requestedPrincipal',
    'maxGrossNotionalQuote', 'maxNakedQuantity', 'maxNakedNotionalQuote',
    'maxNakedDurationMs', 'maxRecoveryCostQuote', 'maxRecoveryGrossNotionalQuote',
    'entryEvidenceRevision', 'filterRevision', 'expiresAtMs',
  ], 'reverse-basis ticket');
  requireExactRecord(ticket.account, [
    'accountRealmId', 'futuresAccountRealmId', 'marginMode', 'isolatedSymbol',
    'symbol', 'baseAsset', 'quoteAsset', 'futuresPositionMode',
    'futuresPositionSide', 'accountConstruction', 'transferRequired', 'bindingRevision',
  ], 'reverse-basis account binding');
  requireExactRecord(ticket.ownerChain, [
    'correlationId', 'intentId', 'intentRevision', 'authorizationRevision',
    'mandateId', 'mandateRevision', 'capitalReservationId',
    'capitalReservationRevision', 'stagedPlanId', 'stagedPlanRevision',
    'operatorApprovalId', 'operatorApprovalRevision', 'riskVerdictId',
    'riskVerdictRevision',
  ], 'reverse-basis owner chain');
  requireExactRecord(ticket.policyDecisions, [
    'entryDecisionId', 'entryDecisionRevision', 'exitDecisionId',
    'exitDecisionRevision', 'recoveryDecisionId', 'recoveryDecisionRevision',
  ], 'reverse-basis policy decision binding');
  requireId(ticket.ticketId, 'ticketId');
  requireId(ticket.decisionId, 'decisionId');
  requireId(ticket.basisProposalId, 'basisProposalId');
  requireId(ticket.basisProposalRevision, 'basisProposalRevision');
  requireId(ticket.entryEvidenceRevision, 'entryEvidenceRevision');
  requireId(ticket.filterRevision, 'filterRevision');
  if (ticket.direction !== 'SHORT_SPOT_LONG_PERP') throw new TypeError('reverse-basis direction is invalid');
  requireId(ticket.account.accountRealmId, 'accountRealmId');
  requireId(ticket.account.futuresAccountRealmId, 'futuresAccountRealmId');
  requireId(ticket.account.bindingRevision, 'bindingRevision');
  requireSymbol(ticket.account.symbol, 'symbol');
  requireAsset(ticket.account.baseAsset, 'baseAsset');
  requireAsset(ticket.account.quoteAsset, 'quoteAsset');
  for (const [label, value] of Object.entries(ticket.ownerChain)) requireId(value, label);
  for (const [label, value] of Object.entries(ticket.policyDecisions)) requireId(value, label);
  if (ticket.account.marginMode !== 'CROSS' && ticket.account.marginMode !== 'ISOLATED') {
    throw new TypeError('Margin mode is invalid');
  }
  if (ticket.account.futuresPositionMode !== 'ONE_WAY'
    && ticket.account.futuresPositionMode !== 'HEDGE') {
    throw new TypeError('USD-M position mode is invalid');
  }
  if (ticket.account.futuresPositionSide !== 'BOTH'
    && ticket.account.futuresPositionSide !== 'LONG') {
    throw new TypeError('USD-M position side is invalid');
  }
  if (
    ticket.account.accountConstruction !== 'NO_TRANSFER_REQUIRED'
    || ticket.account.transferRequired !== false
  ) throw new TypeError('reverse-basis construction would require a forbidden transfer');
  if (
    (ticket.account.marginMode === 'CROSS' && ticket.account.isolatedSymbol !== null)
    || (ticket.account.marginMode === 'ISOLATED'
      && ticket.account.isolatedSymbol !== ticket.account.symbol)
  ) throw new TypeError('Margin mode and isolated symbol binding disagree');
  if (
    (ticket.account.futuresPositionMode === 'ONE_WAY' && ticket.account.futuresPositionSide !== 'BOTH')
    || (ticket.account.futuresPositionMode === 'HEDGE' && ticket.account.futuresPositionSide !== 'LONG')
  ) throw new TypeError('USD-M position mode/side binding disagrees');
  reverseBasisDecimal(ticket.requestedPrincipal, 'requestedPrincipal');
  if (compareReverseBasisDecimals(ticket.requestedPrincipal, '0') <= 0) {
    throw new TypeError('requestedPrincipal must be positive');
  }
  for (const [label, value] of Object.entries({
    maxGrossNotionalQuote: ticket.maxGrossNotionalQuote,
    maxNakedQuantity: ticket.maxNakedQuantity,
    maxNakedNotionalQuote: ticket.maxNakedNotionalQuote,
    maxRecoveryCostQuote: ticket.maxRecoveryCostQuote,
    maxRecoveryGrossNotionalQuote: ticket.maxRecoveryGrossNotionalQuote,
  })) reverseBasisDecimal(value, label);
  requirePositiveInteger(ticket.maxNakedDurationMs, 'maxNakedDurationMs', 86_400_000);
  requireUtc(ticket.expiresAtMs, 'ticket.expiresAtMs');
}

function preflightReasons(input: ReverseBasisLifecycleInput): readonly string[] {
  const reasons: string[] = [];
  const { preflight, ticket } = input;
  requireExactRecord(preflight, [
    'evaluatedAtMs', 'basisDirection', 'basisBorrowVerdict', 'gates', 'collateral',
    'borrowQuote',
  ], 'reverse-basis preflight');
  requireUtc(preflight.evaluatedAtMs, 'preflight.evaluatedAtMs');
  if (preflight.evaluatedAtMs > input.evaluatedAtMs) throw new TypeError('preflight is from the future');
  if (preflight.evaluatedAtMs > ticket.expiresAtMs) reasons.push('TICKET_EXPIRED_AT_PREFLIGHT');
  if (preflight.basisDirection !== ticket.direction) reasons.push('BASIS_DIRECTION_MISMATCH');
  if (preflight.basisBorrowVerdict !== 'OK') reasons.push(`BASIS_BORROW_${preflight.basisBorrowVerdict}`);

  const gateKinds = new Set<string>();
  for (const gate of preflight.gates) {
    requireExactRecord(gate, [
      'kind', 'state', 'ownerRevision', 'observedAtMs', 'validUntilMs',
    ], 'preflight gate');
    if (!REVERSE_BASIS_REQUIRED_GATES.includes(gate.kind)) throw new TypeError('unknown preflight gate');
    if (!['PASS', 'BLOCKED', 'UNKNOWN'].includes(gate.state)) {
      throw new TypeError('preflight gate state is invalid');
    }
    if (gateKinds.has(gate.kind)) throw new TypeError('duplicate preflight gate');
    gateKinds.add(gate.kind);
    requireId(gate.ownerRevision, `${gate.kind}.ownerRevision`);
    requireInterval(gate.observedAtMs, gate.validUntilMs, gate.kind);
    if (gate.observedAtMs > preflight.evaluatedAtMs || preflight.evaluatedAtMs > gate.validUntilMs) {
      reasons.push(`GATE_${gate.kind}_STALE`);
    }
    if (gate.state !== 'PASS') reasons.push(`GATE_${gate.kind}_${gate.state}`);
  }
  for (const kind of REVERSE_BASIS_REQUIRED_GATES) {
    if (!gateKinds.has(kind)) reasons.push(`GATE_${kind}_MISSING`);
  }
  const gateOwnerBindings = new Map<string, string>([
    ['BASIS_PROPOSAL', ticket.basisProposalRevision],
    ['CAPITAL_MANDATE', ticket.ownerChain.mandateRevision],
    ['CAPITAL_RESERVATION', ticket.ownerChain.capitalReservationRevision],
    ['FOUNDATION_RISK', ticket.ownerChain.riskVerdictRevision],
    ['OPERATOR_APPROVAL', ticket.ownerChain.operatorApprovalRevision],
    ['INSTRUMENT_FILTERS', ticket.filterRevision],
  ]);
  for (const gate of preflight.gates) {
    const expected = gateOwnerBindings.get(gate.kind);
    if (expected !== undefined && gate.ownerRevision !== expected) {
      reasons.push(`GATE_${gate.kind}_OWNER_REVISION_MISMATCH`);
    }
  }

  const collateral = preflight.collateral;
  requireExactRecord(collateral, [
    'accountRealmId', 'marginMode', 'isolatedSymbol', 'state', 'marginLevel',
    'collateralMarginLevel', 'collateralValueQuote', 'liquidationPrice',
    'liquidationState', 'observedAtMs', 'validUntilMs', 'collateralRevision',
  ], 'collateral evidence');
  validateMarginRealmIdentity(collateral, ticket, 'collateral evidence');
  if (!['CURRENT', 'STALE', 'UNKNOWN'].includes(collateral.state)
    || !['NORMAL', 'MARGIN_CALL', 'LIQUIDATION', 'UNKNOWN'].includes(collateral.liquidationState)) {
    throw new TypeError('collateral state is invalid');
  }
  requireInterval(collateral.observedAtMs, collateral.validUntilMs, 'collateral');
  requireId(collateral.collateralRevision, 'collateralRevision');
  for (const [label, value] of Object.entries({
    marginLevel: collateral.marginLevel,
    collateralMarginLevel: collateral.collateralMarginLevel,
    collateralValueQuote: collateral.collateralValueQuote,
    liquidationPrice: collateral.liquidationPrice,
  })) if (value !== null) reverseBasisDecimal(value, label);
  if (collateral.state !== 'CURRENT') reasons.push(`COLLATERAL_${collateral.state}`);
  if (
    collateral.observedAtMs > preflight.evaluatedAtMs
    || preflight.evaluatedAtMs > collateral.validUntilMs
  ) reasons.push('COLLATERAL_STALE');
  if (
    collateral.marginLevel === null
    || collateral.collateralMarginLevel === null
    || collateral.collateralValueQuote === null
  ) reasons.push('COLLATERAL_POSTURE_INCOMPLETE');
  if (collateral.liquidationState !== 'NORMAL') {
    reasons.push(`COLLATERAL_LIQUIDATION_${collateral.liquidationState}`);
  }
  if (ticket.account.marginMode === 'ISOLATED' && collateral.liquidationPrice === null) {
    reasons.push('ISOLATED_LIQUIDATION_PRICE_MISSING');
  }

  const quote = preflight.borrowQuote;
  if (quote === null) return stableUnique([...reasons, 'BORROW_TRUTH_MISSING']);
  requireExactRecord(quote, [
    'accountRealmId', 'marginMode', 'isolatedSymbol', 'state', 'asset',
    'requestedPrincipal', 'maximumBorrowable', 'accountBorrowLimit',
    'availableInventory', 'hourlyInterestRate', 'interestAccrual',
    'nextInterestAtMs', 'observedAtMs', 'validUntilMs', 'quoteRevision',
  ], 'borrow quote');
  validateMarginRealmIdentity(quote, ticket, 'borrow quote');
  if (!['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'].includes(quote.state)
    || !['ON_BORROW_AND_HOURLY', 'UNKNOWN'].includes(quote.interestAccrual)) {
    throw new TypeError('borrow quote state is invalid');
  }
  requireAsset(quote.asset, 'borrowQuote.asset');
  requireId(quote.quoteRevision, 'borrowQuote.quoteRevision');
  requireInterval(quote.observedAtMs, quote.validUntilMs, 'borrowQuote');
  reverseBasisDecimal(quote.requestedPrincipal, 'borrowQuote.requestedPrincipal');
  for (const [label, value] of Object.entries({
    maximumBorrowable: quote.maximumBorrowable,
    accountBorrowLimit: quote.accountBorrowLimit,
    availableInventory: quote.availableInventory,
    hourlyInterestRate: quote.hourlyInterestRate,
  })) if (value !== null) reverseBasisDecimal(value, label);
  if (quote.nextInterestAtMs !== null) requireUtc(quote.nextInterestAtMs, 'nextInterestAtMs');
  if (quote.asset !== ticket.account.baseAsset) reasons.push('BORROW_ASSET_MISMATCH');
  if (quote.requestedPrincipal !== ticket.requestedPrincipal) reasons.push('BORROW_REQUEST_MISMATCH');
  if (quote.state !== 'AVAILABLE') reasons.push(`BORROW_TRUTH_${quote.state}`);
  if (
    quote.observedAtMs > preflight.evaluatedAtMs
    || preflight.evaluatedAtMs > quote.validUntilMs
  ) reasons.push('BORROW_TRUTH_STALE');
  if (
    quote.maximumBorrowable === null
    || quote.accountBorrowLimit === null
    || quote.availableInventory === null
    || quote.hourlyInterestRate === null
    || quote.interestAccrual !== 'ON_BORROW_AND_HOURLY'
    || quote.nextInterestAtMs === null
  ) reasons.push('BORROW_TRUTH_INCOMPLETE');
  if (quote.nextInterestAtMs !== null && quote.nextInterestAtMs <= preflight.evaluatedAtMs) {
    reasons.push('BORROW_INTEREST_BOUNDARY_STALE');
  }
  if (quote.maximumBorrowable !== null
    && compareReverseBasisDecimals(quote.maximumBorrowable, ticket.requestedPrincipal) < 0) {
    reasons.push('BORROW_MAXIMUM_INSUFFICIENT');
  }
  if (quote.accountBorrowLimit !== null
    && compareReverseBasisDecimals(quote.accountBorrowLimit, ticket.requestedPrincipal) < 0) {
    reasons.push('BORROW_ACCOUNT_LIMIT_INSUFFICIENT');
  }
  if (quote.availableInventory !== null
    && compareReverseBasisDecimals(quote.availableInventory, ticket.requestedPrincipal) < 0) {
    reasons.push('BORROW_INVENTORY_INSUFFICIENT');
  }
  return stableUnique(reasons);
}

function ownerTruthReasonsAt(
  input: ReverseBasisLifecycleInput,
  atMs: number,
  context: string,
): readonly string[] {
  const reasons: string[] = [];
  if (atMs < input.preflight.evaluatedAtMs) reasons.push(`${context}_BEFORE_PREFLIGHT`);
  for (const gate of input.preflight.gates) {
    if (gate.state !== 'PASS' || atMs < gate.observedAtMs || atMs > gate.validUntilMs) {
      reasons.push(`${context}_GATE_${gate.kind}_NOT_CURRENT`);
    }
  }
  const collateral = input.preflight.collateral;
  if (
    collateral.state !== 'CURRENT'
    || collateral.liquidationState !== 'NORMAL'
    || atMs < collateral.observedAtMs
    || atMs > collateral.validUntilMs
  ) reasons.push(`${context}_COLLATERAL_NOT_CURRENT`);
  return stableUnique(reasons);
}

function liabilityCurrentAt(
  liability: ReverseBasisLiabilityObservation | null,
  atMs: number,
): boolean {
  return liability !== null
    && liability.observedAtMs <= atMs
    && atMs <= liability.validUntilMs;
}

export function deriveReverseBasisEventId(value: unknown): string {
  requireRecord(value, 'reverse-basis event identity material');
  const material = clonePlain(value);
  delete material.eventId;
  return digest('l10evt_', material);
}

function validateMarginRealmIdentity(
  value: {
    readonly accountRealmId: string;
    readonly marginMode: string;
    readonly isolatedSymbol: string | null;
  },
  ticket: ReverseBasisTicket,
  label: string,
): void {
  if (
    value.accountRealmId !== ticket.account.accountRealmId
    || value.marginMode !== ticket.account.marginMode
    || value.isolatedSymbol !== ticket.account.isolatedSymbol
  ) throw new TypeError(`${label} does not match the verified Margin identity`);
}

function validateAccountIdentity(
  value: {
    readonly accountRealmId: string;
    readonly marginMode: string;
    readonly isolatedSymbol: string | null;
    readonly asset: string;
  },
  ticket: ReverseBasisTicket,
  label: string,
): void {
  validateMarginRealmIdentity(value, ticket, label);
  if (value.asset !== ticket.account.baseAsset) {
    throw new TypeError(`${label} does not match the verified Margin identity`);
  }
}

function validateBorrowObservation(
  observation: ReverseBasisBorrowObservation,
  ticket: ReverseBasisTicket,
): void {
  requireExactRecord(observation, [
    'accountRealmId', 'marginMode', 'isolatedSymbol', 'asset',
    'requestedPrincipal', 'confirmedPrincipal', 'transactionId', 'state',
    'liabilityRevision', 'evidenceRevision',
  ], 'borrow observation');
  validateAccountIdentity(observation, ticket, 'borrow observation');
  if (!['CONFIRMED', 'REJECTED_NO_EFFECT_PROVEN', 'UNKNOWN'].includes(observation.state)) {
    throw new TypeError('borrow mutation state is invalid');
  }
  reverseBasisDecimal(observation.requestedPrincipal, 'borrow.requestedPrincipal');
  if (observation.requestedPrincipal !== ticket.requestedPrincipal) {
    throw new TypeError('borrow request does not match ticket principal');
  }
  requireId(observation.evidenceRevision, 'borrow.evidenceRevision');
  if (observation.confirmedPrincipal !== null) {
    reverseBasisDecimal(observation.confirmedPrincipal, 'borrow.confirmedPrincipal');
  }
  if (observation.state === 'CONFIRMED') {
    if (
      observation.confirmedPrincipal === null
      || compareReverseBasisDecimals(observation.confirmedPrincipal, '0') <= 0
      || observation.transactionId === null
      || observation.liabilityRevision === null
    ) throw new TypeError('confirmed borrow lacks transaction/principal/liability identity');
    requireId(observation.transactionId, 'borrow.transactionId');
    requireId(observation.liabilityRevision, 'borrow.liabilityRevision');
    if (observation.confirmedPrincipal !== observation.requestedPrincipal) {
      throw new TypeError('confirmed borrow must equal the requested principal');
    }
  } else if (
    observation.confirmedPrincipal !== null
    || observation.transactionId !== null
    || observation.liabilityRevision !== null
  ) throw new TypeError('unconfirmed borrow cannot claim effects');
}

function validateRepayObservation(
  observation: ReverseBasisRepayObservation,
  ticket: ReverseBasisTicket,
): void {
  requireExactRecord(observation, [
    'source', 'accountRealmId', 'marginMode', 'isolatedSymbol', 'asset',
    'requestedRepayAmount', 'confirmedRepayAmount', 'transactionId', 'state',
    'liabilityRevision', 'evidenceRevision',
  ], 'repay observation');
  validateAccountIdentity(observation, ticket, 'repay observation');
  if (!['LIFECYCLE_FIXTURE', 'EXTERNAL_MANUAL'].includes(observation.source)
    || !['CONFIRMED', 'REJECTED_NO_EFFECT_PROVEN', 'UNKNOWN'].includes(observation.state)) {
    throw new TypeError('repay source or mutation state is invalid');
  }
  reverseBasisDecimal(observation.requestedRepayAmount, 'repay.requestedRepayAmount');
  requireId(observation.evidenceRevision, 'repay.evidenceRevision');
  if (observation.confirmedRepayAmount !== null) {
    reverseBasisDecimal(observation.confirmedRepayAmount, 'repay.confirmedRepayAmount');
  }
  if (observation.state === 'CONFIRMED') {
    if (
      observation.confirmedRepayAmount === null
      || observation.transactionId === null
      || observation.liabilityRevision === null
    ) throw new TypeError('confirmed repay lacks transaction/amount/liability identity');
    requireId(observation.transactionId, 'repay.transactionId');
    requireId(observation.liabilityRevision, 'repay.liabilityRevision');
  } else if (
    observation.confirmedRepayAmount !== null
    || observation.transactionId !== null
    || observation.liabilityRevision !== null
  ) throw new TypeError('unconfirmed repay cannot claim effects');
}

function validateLiabilityObservation(
  observation: ReverseBasisLiabilityObservation,
  ticket: ReverseBasisTicket,
): void {
  requireExactRecord(observation, [
    'accountRealmId', 'marginMode', 'isolatedSymbol', 'asset', 'principal',
    'accruedInterest', 'totalLiability', 'repayStatus', 'observedAtMs',
    'validUntilMs', 'liabilityRevision',
  ], 'liability observation');
  validateAccountIdentity(observation, ticket, 'liability observation');
  if (![
    'NOT_REPAID', 'PARTIALLY_REPAID', 'REPAY_PENDING', 'REPAY_REJECTED',
    'REPAY_UNKNOWN', 'ZERO_CONFIRMED',
  ].includes(observation.repayStatus)) throw new TypeError('liability repay status is invalid');
  reverseBasisDecimal(observation.principal, 'liability.principal');
  reverseBasisDecimal(observation.accruedInterest, 'liability.accruedInterest');
  reverseBasisDecimal(observation.totalLiability, 'liability.totalLiability');
  if (
    addReverseBasisDecimals(observation.principal, observation.accruedInterest)
    !== observation.totalLiability
  ) throw new TypeError('liability total must equal principal plus accrued interest');
  requireInterval(observation.observedAtMs, observation.validUntilMs, 'liability');
  requireId(observation.liabilityRevision, 'liability.liabilityRevision');
  if (
    observation.repayStatus === 'ZERO_CONFIRMED'
    && observation.totalLiability !== '0'
  ) throw new TypeError('ZERO_CONFIRMED liability must be exact zero');
  if (
    observation.repayStatus !== 'ZERO_CONFIRMED'
    && observation.totalLiability === '0'
  ) throw new TypeError('zero liability must be explicitly ZERO_CONFIRMED');
}

function planForRole(role: ReverseBasisOrderRole, policies: PolicyContext): ExecutionPolicyPlan {
  if (role === 'MARGIN_ENTRY_SELL' || role === 'FUTURES_ENTRY_HEDGE') return policies.entry;
  if (role === 'MARGIN_EXIT_COVER' || role === 'FUTURES_EXIT_CLOSE') return policies.exit;
  return policies.recovery;
}

function actionForOrderObservation(
  observation: ReverseBasisOrderObservation,
  policies: PolicyContext,
): PolicyAction {
  const plan = planForRole(observation.role, policies);
  if (observation.policyPlanRevision !== plan.planRevision) {
    throw new TypeError('order observation policy revision does not match its lifecycle stage');
  }
  const recovery = observation.role.startsWith('RECOVERY_');
  const roleIndex = MARGIN_ROLES.has(observation.role) ? 0 : 1;
  const mappedLegId = orderedPlacePair(plan)[roleIndex].legId;
  const expected = recovery
    ? plan.actions.filter((action) => action.kind === 'RECOVER' && action.legId === mappedLegId)
    : [orderedPlacePair(plan)[roleIndex]];
  const matches = expected.filter((action) => action.actionId === observation.policyActionId);
  if (matches.length !== 1) throw new TypeError('order observation policy action is missing');
  const action = matches[0];
  if (action.kind !== (recovery ? 'RECOVER' : 'PLACE')) {
    throw new TypeError('order observation policy action kind is invalid');
  }
  if (recovery && action.exposureEffect !== 'RISK_REDUCING_ONLY') {
    throw new TypeError('recovery order action is not risk reducing');
  }
  return action;
}

function twinOrderForObservation(
  observation: ReverseBasisOrderObservation,
  ticket: ReverseBasisTicket,
): { readonly twin: TwinScenarioState; readonly order: TwinOrderState } {
  const twin = checkpointExchangeTwin(observation.twinScenario).state;
  if (
    twin.schema !== 'LIVE_EDGE_EXCHANGE_TWIN_V1'
    || twin.simulationAuthority !== 'SYNTHETIC_FIXTURE'
    || twin.actionAuthority !== 'NONE_RECORD_ONLY'
    || twin.externalActionAuthorization !== 'NONE'
    || twin.symbol !== ticket.account.symbol
    || twin.orders.length !== 1
  ) throw new TypeError('order observation does not contain an accepted L07 state');
  const matches = twin.orders.filter((order) => order.fixture.fixtureId === observation.twinFixtureId);
  if (matches.length !== 1) throw new TypeError('order observation L07 fixture is missing or ambiguous');
  const order = matches[0];
  if (
    order.fixture.symbol !== ticket.account.symbol
    || order.fixture.baseAsset !== ticket.account.baseAsset
    || order.fixture.quoteAsset !== ticket.account.quoteAsset
    || order.fixture.simulationAuthority !== 'SYNTHETIC_FIXTURE'
    || order.fixture.actionAuthority !== 'NONE_RECORD_ONLY'
    || order.fixture.externalActionAuthorization !== 'NONE'
  ) throw new TypeError('L07 order instrument/authority does not match ticket');
  return Object.freeze({ twin, order });
}

function validateOrderObservation(
  observation: ReverseBasisOrderObservation,
  ticket: ReverseBasisTicket,
  policies: PolicyContext,
): {
  readonly action: PolicyAction;
  readonly twinOrder: TwinOrderState;
  readonly twin: TwinScenarioState;
} {
  requireExactRecord(observation, [
    'orderRef', 'role', 'accountRealmId', 'marginMode', 'isolatedSymbol',
    'accountOrderId', 'mutationState', 'mutationEvidenceRevision',
    'policyPlanRevision', 'policyActionId', 'mechanicsAuthority',
    'twinFixtureId', 'twinScenario',
  ], 'order observation');
  requireId(observation.orderRef, 'orderRef');
  requireId(observation.mutationEvidenceRevision, 'mutationEvidenceRevision');
  requireId(observation.policyPlanRevision, 'policyPlanRevision');
  requireId(observation.policyActionId, 'policyActionId');
  requireId(observation.twinFixtureId, 'twinFixtureId');
  const action = actionForOrderObservation(observation, policies);
  const { twin, order: twinOrder } = twinOrderForObservation(observation, ticket);
  const margin = MARGIN_ROLES.has(observation.role);
  const futures = FUTURES_ROLES.has(observation.role);
  if (!margin && !futures) throw new TypeError('order role is invalid');
  if (margin) {
    if (
      observation.accountRealmId !== ticket.account.accountRealmId
      || observation.marginMode !== ticket.account.marginMode
      || observation.isolatedSymbol !== ticket.account.isolatedSymbol
      || observation.mechanicsAuthority !== 'L07_SPOT_MARKET_MECHANICS_ONLY'
      || twin.product !== 'SPOT'
      || twinOrder.fixture.product !== 'SPOT'
    ) throw new TypeError('Margin order does not preserve separate realm plus L07 Spot mechanics');
    if (twinOrder.fixture.l06Snapshot.identity.accountRealmId === observation.accountRealmId) {
      throw new TypeError('L07 Spot mutation identity cannot be relabeled as the Margin hand');
    }
  } else if (
    observation.accountRealmId !== ticket.account.futuresAccountRealmId
    || observation.marginMode !== null
    || observation.isolatedSymbol !== null
    || observation.mechanicsAuthority !== 'L07_USDM_MECHANICS'
    || twin.product !== 'USD_M_PERPETUAL'
    || twinOrder.fixture.product !== 'USD_M_PERPETUAL'
  ) throw new TypeError('Futures order does not match verified USD-M identity');
  if (!margin && twinOrder.fixture.l06Snapshot.identity.accountRealmId !== observation.accountRealmId) {
    throw new TypeError('L07 USD-M mutation identity does not match the Futures hand');
  }
  const plan = planForRole(observation.role, policies);
  const l06Identity = twinOrder.fixture.l06Snapshot.identity;
  if (
    l06Identity.globalCorrelationId !== mappedOwnerId('cor_', plan.correlationId)
    || l06Identity.decisionId !== mappedOwnerId('cdec_', plan.policyRequestId)
    || l06Identity.proposalId !== mappedOwnerId('cprop_', plan.intentId)
    || l06Identity.capitalMandateId !== mappedOwnerId('cmdt_', plan.mandateId, 32)
    || l06Identity.capitalReservationId !== mappedOwnerId(
      'cres_',
      plan.capitalReservationId,
      32,
    )
    || l06Identity.ticketId !== mappedOwnerId('plan_', plan.planId)
    || l06Identity.legId !== mappedOwnerId('leg_', action.legId)
  ) throw new TypeError('L07 mechanics identity does not bind the selected L08 plan/action');

  const expectedSide = observation.role === 'MARGIN_ENTRY_SELL'
    || observation.role === 'FUTURES_EXIT_CLOSE'
    || observation.role === 'RECOVERY_FUTURES_ADJUST'
    ? 'SELL' : 'BUY';
  if (twinOrder.fixture.side !== expectedSide) throw new TypeError('L07 order side does not match lifecycle role');
  if (observation.mutationState === 'CONFIRMED') {
    if (observation.accountOrderId === null) throw new TypeError('confirmed order lacks account order identity');
    requireId(observation.accountOrderId, 'accountOrderId');
  } else if (observation.accountOrderId !== null) {
    throw new TypeError('unconfirmed order cannot claim account order identity');
  }
  if (
    observation.mutationState === 'REJECTED_NO_EFFECT_PROVEN'
    && (
      twinOrder.filledQuantity !== '0'
      || (twinOrder.venueStatus !== 'BLOCKED' && twinOrder.venueStatus !== 'NOT_ARRIVED')
    )
  ) throw new TypeError('no-effect rejection conflicts with L07 venue effects');
  return Object.freeze({ action, twinOrder, twin } as const);
}

function projectOrder(
  observation: ReverseBasisOrderObservation,
  twinOrder: TwinOrderState,
  twin: TwinScenarioState,
  liabilityBasis: ReverseBasisLiabilityObservation,
  occurredAtMs: number,
  previous: ReverseBasisOrderProjection | undefined,
): ReverseBasisOrderProjection {
  const open = twinOrder.venueStatus === 'NEW' || twinOrder.venueStatus === 'PARTIALLY_FILLED';
  const confirmedTerminalObserved = observation.mutationState !== 'CONFIRMED'
    || (
      (twinOrder.venueStatus === 'FILLED'
        || twinOrder.venueStatus === 'CANCELED'
        || twinOrder.venueStatus === 'EXPIRED')
      && twinOrder.localTruth === 'OBSERVED'
    );
  const ambiguous = observation.mutationState === 'UNKNOWN'
    || twin.orderingTruth !== 'PROVED'
    || twin.ambiguousDomains.length > 0
    || twin.crashed
    || twinOrder.localTruth === 'UNKNOWN'
    || twinOrder.localTruth === 'RECOVERY_REQUIRED'
    || twinOrder.recoveryRequired
    || !confirmedTerminalObserved;
  return deepFreeze({
    orderRef: observation.orderRef,
    role: observation.role,
    accountRealmId: observation.accountRealmId,
    accountOrderId: observation.accountOrderId,
    mutationState: observation.mutationState,
    mutationEvidenceRevision: observation.mutationEvidenceRevision,
    liabilityBasis: clonePlain(liabilityBasis),
    policyPlanRevision: observation.policyPlanRevision,
    policyActionId: observation.policyActionId,
    mechanicsAuthority: observation.mechanicsAuthority,
    twinFixtureId: observation.twinFixtureId,
    twinScenarioRevision: twin.stateRevision,
    twinOutcomeRevision: twin.outcomeRevision,
    twinOrderRevision: twinOrder.venueRevision,
    venueStatus: twinOrder.venueStatus,
    localTruth: twinOrder.localTruth,
    requestedQuantity: reverseBasisDecimal(twinOrder.fixture.quantity, 'twin requested quantity'),
    filledQuantity: reverseBasisDecimal(twinOrder.filledQuantity, 'twin filled quantity'),
    filledNotionalQuote: sumTwinFillNotional(twinOrder),
    remainingQuantity: reverseBasisDecimal(twinOrder.remainingQuantity, 'twin remaining quantity'),
    expiredQuantity: reverseBasisDecimal(twinOrder.expiredQuantity, 'twin expired quantity'),
    fillIds: stableUnique(twinOrder.fills.map((fill) => fill.fillId)),
    open,
    ambiguous,
    observedAtMs: twinOrder.lastLocalObservationAtMs,
    venueEffectAtMs: twinOrder.lastVenueEffectAtMs,
    dispatchAtMs: twinOrder.dispatchAtMs,
    firstEventOccurredAtMs: previous?.firstEventOccurredAtMs ?? occurredAtMs,
    lastEventOccurredAtMs: occurredAtMs,
  });
}

function validateRecoveryEvidence(
  evidence: ReverseBasisRecoveryEvidence,
  input: ReverseBasisLifecycleInput,
  policies: PolicyContext,
  lifecycle: MutableLifecycle,
): readonly string[] {
  requireExactRecord(evidence, [
    'recoveryRef', 'policyPlanRevision', 'policyActionId', 'riskMeasureBefore',
    'riskMeasureAfter', 'grossNotionalAfter', 'recoveryCostQuote',
    'liquidityState', 'collateralRevision', 'evidenceRevision',
    'targetExposureRevision',
  ], 'recovery evidence');
  requireId(evidence.recoveryRef, 'recoveryRef');
  requireId(evidence.policyPlanRevision, 'recovery.policyPlanRevision');
  requireId(evidence.policyActionId, 'recovery.policyActionId');
  requireId(evidence.collateralRevision, 'recovery.collateralRevision');
  requireId(evidence.evidenceRevision, 'recovery.evidenceRevision');
  requireId(evidence.targetExposureRevision, 'recovery.targetExposureRevision');
  for (const [label, value] of Object.entries({
    riskMeasureBefore: evidence.riskMeasureBefore,
    riskMeasureAfter: evidence.riskMeasureAfter,
    grossNotionalAfter: evidence.grossNotionalAfter,
    recoveryCostQuote: evidence.recoveryCostQuote,
  })) reverseBasisDecimal(value, label);
  if (evidence.policyPlanRevision !== policies.recovery.planRevision) {
    throw new TypeError('recovery evidence plan revision mismatch');
  }
  const actions = policies.recovery.actions.filter((action) => action.actionId === evidence.policyActionId);
  if (
    actions.length !== 1
    || actions[0].kind !== 'RECOVER'
    || actions[0].exposureEffect !== 'RISK_REDUCING_ONLY'
  ) throw new TypeError('recovery evidence action is not L08 risk-reducing recovery');
  if (
    actions[0].recoveryEvidenceRevision !== evidence.evidenceRevision
    || actions[0].targetExposureRevision !== evidence.targetExposureRevision
    || evidence.targetExposureRevision !== deriveReverseBasisExposureRevision(computeExposure(lifecycle))
  ) throw new TypeError('recovery evidence does not bind the L08 action and current exposure');
  const reasons: string[] = [];
  if (compareReverseBasisDecimals(evidence.riskMeasureAfter, evidence.riskMeasureBefore) >= 0) {
    reasons.push('RECOVERY_NOT_RISK_REDUCING');
  }
  if (compareReverseBasisDecimals(
    evidence.grossNotionalAfter,
    input.ticket.maxRecoveryGrossNotionalQuote,
  ) > 0) reasons.push('RECOVERY_GROSS_LIMIT_EXCEEDED');
  if (compareReverseBasisDecimals(
    evidence.recoveryCostQuote,
    input.ticket.maxRecoveryCostQuote,
  ) > 0) reasons.push('RECOVERY_COST_LIMIT_EXCEEDED');
  if (evidence.liquidityState !== 'AVAILABLE') reasons.push(`RECOVERY_LIQUIDITY_${evidence.liquidityState}`);
  if (evidence.collateralRevision !== input.preflight.collateral.collateralRevision) {
    reasons.push('RECOVERY_COLLATERAL_REVISION_MISMATCH');
  }
  return stableUnique(reasons);
}

function validateClosureEvidence(
  evidence: ReverseBasisClosureEvidence,
  ticket: ReverseBasisTicket,
): void {
  requireExactRecord(evidence, [
    'state', 'accountRealmId', 'liabilityRevision', 'borrowTransactionId',
    'repayTransactionId', 'orderStateRevisions', 'openOrderRefs',
    'ambiguousMutationRefs', 'unmatchedFillRefs', 'marginShortRemaining',
    'futuresLongRemaining', 'observedAtMs', 'validUntilMs',
    'reconciliationRevision',
  ], 'closure evidence');
  if (evidence.accountRealmId !== ticket.account.accountRealmId) {
    throw new TypeError('closure evidence account realm mismatch');
  }
  for (const value of [
    evidence.liabilityRevision,
    evidence.borrowTransactionId,
    evidence.repayTransactionId,
    evidence.reconciliationRevision,
    ...evidence.orderStateRevisions,
    ...evidence.openOrderRefs,
    ...evidence.ambiguousMutationRefs,
    ...evidence.unmatchedFillRefs,
  ]) if (value !== null) requireId(value, 'closure identity');
  reverseBasisDecimal(evidence.marginShortRemaining, 'closure.marginShortRemaining');
  reverseBasisDecimal(evidence.futuresLongRemaining, 'closure.futuresLongRemaining');
  requireInterval(evidence.observedAtMs, evidence.validUntilMs, 'closure');
}

function validateManualIntervention(value: ReverseBasisManualIntervention): void {
  requireExactRecord(value, [
    'reasonCode', 'operatorAction', 'evidenceRevision',
  ], 'manual intervention');
  requireId(value.reasonCode, 'manual.reasonCode');
  requireId(value.evidenceRevision, 'manual.evidenceRevision');
  if (typeof value.operatorAction !== 'string' || value.operatorAction.length < 3) {
    throw new TypeError('manual intervention action is invalid');
  }
}

function validateEventEnvelope(event: ReverseBasisEvent, input: ReverseBasisLifecycleInput): void {
  requireExactRecord(event, [
    'schema', 'eventId', 'sequence', 'occurredAtMs', 'kind', 'payload',
  ], 'reverse-basis event');
  if (event.schema !== 'LIVE_EDGE_REVERSE_BASIS_EVENT_V1') throw new TypeError('event schema is invalid');
  requirePositiveInteger(event.sequence, 'event.sequence', 1_000_000);
  requireUtc(event.occurredAtMs, 'event.occurredAtMs');
  if (event.occurredAtMs > input.evaluatedAtMs) throw new TypeError('event occurs after lifecycle evaluation');
  if (deriveReverseBasisEventId(event) !== event.eventId) throw new TypeError('event identity mismatch');
}

function sumRole(orders: readonly ReverseBasisOrderProjection[], roles: readonly ReverseBasisOrderRole[]): string {
  const roleSet = new Set(roles);
  return sumReverseBasisDecimals(
    orders.filter((order) => roleSet.has(order.role)).map((order) => order.filledQuantity),
  );
}

function computeExposure(lifecycle: MutableLifecycle): ReverseBasisExposure {
  const orders = [...lifecycle.orders.values()];
  const marginSaleFilled = sumRole(orders, ['MARGIN_ENTRY_SELL']);
  const futuresEntryFilled = sumRole(orders, ['FUTURES_ENTRY_HEDGE']);
  const marginCoverFilled = sumRole(orders, ['MARGIN_EXIT_COVER', 'RECOVERY_MARGIN_COVER']);
  const futuresExitFilled = sumRole(orders, ['FUTURES_EXIT_CLOSE', 'RECOVERY_FUTURES_ADJUST']);
  const marginShortRemaining = subtractReverseBasisFloorZero(marginSaleFilled, marginCoverFilled);
  const futuresLongRemaining = subtractReverseBasisFloorZero(futuresEntryFilled, futuresExitFilled);
  return deepFreeze({
    borrowedPrincipal: lifecycle.liability?.principal ?? lifecycle.borrow?.confirmedPrincipal ?? null,
    accruedInterest: lifecycle.liability?.accruedInterest ?? null,
    totalLiability: lifecycle.liability?.totalLiability ?? null,
    marginSaleFilled,
    futuresEntryFilled,
    marginCoverFilled,
    futuresExitFilled,
    marginShortRemaining,
    futuresLongRemaining,
    hedgeDriftQuantity: absoluteReverseBasisDifference(marginShortRemaining, futuresLongRemaining),
    grossOpenQuantity: addReverseBasisDecimals(marginShortRemaining, futuresLongRemaining),
  });
}

export function deriveReverseBasisExposureRevision(exposureValue: unknown): string {
  return digest('l10exposure_', clonePlain(exposureValue));
}

function closureReasons(
  input: ReverseBasisLifecycleInput,
  lifecycle: MutableLifecycle,
  exposure: ReverseBasisExposure,
  openOrderRefs: readonly string[],
  ambiguousMutationRefs: readonly string[],
  unmatchedFillRefs: readonly string[],
): readonly string[] {
  const reasons: string[] = [];
  const closure = lifecycle.closureEvidence;
  const liability = lifecycle.liability;
  const orders = [...lifecycle.orders.values()].sort((left, right) => stableTextCompare(left.orderRef, right.orderRef));
  if (lifecycle.borrow?.state !== 'CONFIRMED') reasons.push('CLOSURE_BORROW_NOT_CONFIRMED');
  if (lifecycle.repay?.state !== 'CONFIRMED') reasons.push('CLOSURE_REPAY_NOT_CONFIRMED');
  if (
    lifecycle.repayBasis === null
    || lifecycle.repay?.requestedRepayAmount !== lifecycle.repayBasis.totalLiability
    || lifecycle.repay?.confirmedRepayAmount !== lifecycle.repayBasis.totalLiability
  ) reasons.push('CLOSURE_REPAY_BASIS_MISMATCH');
  if (liability === null) reasons.push('CLOSURE_LIABILITY_TRUTH_MISSING');
  else {
    if (
      liability.observedAtMs > input.evaluatedAtMs
      || input.evaluatedAtMs > liability.validUntilMs
    ) reasons.push('CLOSURE_LIABILITY_TRUTH_STALE');
    if (
      liability.principal !== '0'
      || liability.accruedInterest !== '0'
      || liability.totalLiability !== '0'
      || liability.repayStatus !== 'ZERO_CONFIRMED'
    ) reasons.push('CLOSURE_RESIDUAL_LIABILITY');
  }
  if (closure === null) reasons.push('CLOSURE_RECONCILIATION_MISSING');
  else {
    if (closure.state !== 'EXACT') reasons.push(`CLOSURE_RECONCILIATION_${closure.state}`);
    if (
      closure.observedAtMs > input.evaluatedAtMs
      || input.evaluatedAtMs > closure.validUntilMs
    ) reasons.push('CLOSURE_RECONCILIATION_STALE');
    if (closure.liabilityRevision !== liability?.liabilityRevision) {
      reasons.push('CLOSURE_LIABILITY_REVISION_MISMATCH');
    }
    if (lifecycle.repay?.liabilityRevision !== liability?.liabilityRevision) {
      reasons.push('CLOSURE_REPAY_LIABILITY_REVISION_MISMATCH');
    }
    if (closure.borrowTransactionId !== lifecycle.borrow?.transactionId) {
      reasons.push('CLOSURE_BORROW_TRANSACTION_MISMATCH');
    }
    if (closure.repayTransactionId !== lifecycle.repay?.transactionId) {
      reasons.push('CLOSURE_REPAY_TRANSACTION_MISMATCH');
    }
    const expectedOrderRevisions = stableUnique(orders.map((order) => order.twinOrderRevision));
    if (canonicalJson(stableUnique(closure.orderStateRevisions)) !== canonicalJson(expectedOrderRevisions)) {
      reasons.push('CLOSURE_ORDER_REVISION_SET_MISMATCH');
    }
    if (
      closure.marginShortRemaining !== exposure.marginShortRemaining
      || closure.futuresLongRemaining !== exposure.futuresLongRemaining
    ) reasons.push('CLOSURE_EXPOSURE_MISMATCH');
    if (closure.openOrderRefs.length > 0) reasons.push('CLOSURE_REPORTS_OPEN_ORDERS');
    if (closure.ambiguousMutationRefs.length > 0) reasons.push('CLOSURE_REPORTS_AMBIGUOUS_MUTATIONS');
    if (closure.unmatchedFillRefs.length > 0) reasons.push('CLOSURE_REPORTS_UNMATCHED_FILLS');
  }
  if (openOrderRefs.length > 0) reasons.push('CLOSURE_OPEN_ORDERS_REMAIN');
  if (ambiguousMutationRefs.length > 0) reasons.push('CLOSURE_AMBIGUOUS_MUTATIONS_REMAIN');
  if (unmatchedFillRefs.length > 0) reasons.push('CLOSURE_UNMATCHED_FILLS_REMAIN');
  if (
    exposure.marginShortRemaining !== '0'
    || exposure.futuresLongRemaining !== '0'
    || exposure.hedgeDriftQuantity !== '0'
  ) reasons.push('CLOSURE_EXPOSURE_REMAINS');
  if (exposure.marginSaleFilled !== exposure.futuresEntryFilled) {
    reasons.push('CLOSURE_ENTRY_PAIR_FILL_MISMATCH');
  }
  if (exposure.marginCoverFilled !== exposure.futuresExitFilled) {
    reasons.push('CLOSURE_EXIT_PAIR_FILL_MISMATCH');
  }
  if (
    lifecycle.nakedRiskLimitBreached
    || (
      lifecycle.nakedRiskStartedAtMs !== null
      && exposure.hedgeDriftQuantity !== '0'
      && input.evaluatedAtMs - lifecycle.nakedRiskStartedAtMs > input.ticket.maxNakedDurationMs
    )
  ) reasons.push('CLOSURE_NAKED_RISK_LIMIT_BREACHED');
  if (
    exposure.marginSaleFilled === '0'
    && lifecycle.recoveryEvidence.length === 0
    && lifecycle.repay?.source !== 'EXTERNAL_MANUAL'
  ) {
    reasons.push('CLOSURE_NO_ENTRY_FILL');
  }
  return stableUnique(reasons);
}

function deriveLifecycle(
  input: ReverseBasisLifecycleInput,
  lifecycle: MutableLifecycle,
  preflightBlockingReasons: readonly string[],
  recoveryPolicyReasons: readonly string[],
): DerivedLifecycle {
  const orders = [...lifecycle.orders.values()].sort((left, right) => stableTextCompare(left.orderRef, right.orderRef));
  const exposure = computeExposure(lifecycle);
  const openOrderRefs = stableUnique([
    ...orders.filter((order) => order.open).map((order) => order.orderRef),
    ...(lifecycle.closureEvidence?.openOrderRefs ?? []),
  ]);
  const ambiguousMutationRefs = stableUnique([
    ...(lifecycle.borrow?.state === 'UNKNOWN' ? [`borrow:${lifecycle.borrow.evidenceRevision}`] : []),
    ...(lifecycle.repay?.state === 'UNKNOWN' ? [`repay:${lifecycle.repay.evidenceRevision}`] : []),
    ...orders.filter((order) => order.ambiguous || order.mutationState === 'UNKNOWN')
      .map((order) => order.orderRef),
    ...(lifecycle.closureEvidence?.ambiguousMutationRefs ?? []),
  ]);
  const unmatched: string[] = [...(lifecycle.closureEvidence?.unmatchedFillRefs ?? [])];
  if (exposure.futuresEntryFilled !== exposure.marginSaleFilled) {
    unmatched.push('entry-pair-fill-mismatch');
  }
  if (exposure.futuresExitFilled !== exposure.marginCoverFilled) {
    unmatched.push('exit-pair-fill-mismatch');
  }
  if (compareReverseBasisDecimals(exposure.marginCoverFilled, exposure.marginSaleFilled) > 0) {
    unmatched.push('margin-cover-exceeds-sale');
  }
  if (compareReverseBasisDecimals(exposure.futuresExitFilled, exposure.futuresEntryFilled) > 0) {
    unmatched.push('futures-exit-exceeds-entry');
  }
  const seenFillIds = new Set<string>();
  for (const order of orders) {
    for (const fillId of order.fillIds) {
      if (seenFillIds.has(fillId)) unmatched.push(`duplicate-fill:${fillId}`);
      seenFillIds.add(fillId);
    }
  }
  const unmatchedFillRefs = stableUnique(unmatched);
  const reasons: string[] = [...preflightBlockingReasons, ...recoveryPolicyReasons];

  if (lifecycle.borrow === null) reasons.push('BORROW_CONFIRMATION_MISSING');
  else if (lifecycle.borrow.state === 'REJECTED_NO_EFFECT_PROVEN') reasons.push('BORROW_REJECTED_NO_EFFECT_PROVEN');
  else if (lifecycle.borrow.state === 'UNKNOWN') reasons.push('BORROW_MUTATION_UNKNOWN');
  else {
    const quote = input.preflight.borrowQuote;
    if (quote?.maximumBorrowable !== null && quote?.maximumBorrowable !== undefined
      && compareReverseBasisDecimals(lifecycle.borrow.confirmedPrincipal!, quote.maximumBorrowable) > 0) {
      reasons.push('BORROW_CONFIRMED_EXCEEDS_MAXIMUM');
    }
    if (lifecycle.liability === null) reasons.push('LIABILITY_TRUTH_MISSING');
  }
  if (lifecycle.liability !== null) {
    if (
      lifecycle.liability.observedAtMs > input.evaluatedAtMs
      || input.evaluatedAtMs > lifecycle.liability.validUntilMs
    ) reasons.push('LIABILITY_TRUTH_STALE');
    if (lifecycle.borrow?.confirmedPrincipal !== null
      && lifecycle.borrow?.confirmedPrincipal !== undefined
      && compareReverseBasisDecimals(
        lifecycle.liability.principal,
        lifecycle.borrow.confirmedPrincipal,
      ) > 0) reasons.push('LIABILITY_PRINCIPAL_EXCEEDS_CONFIRMED_BORROW');
  }
  for (const order of orders) {
    if (order.mutationState === 'REJECTED_NO_EFFECT_PROVEN') reasons.push(`ORDER_REJECTED:${order.orderRef}`);
    if (
      (order.role === 'MARGIN_EXIT_COVER' || order.role === 'FUTURES_EXIT_CLOSE')
      && order.expiredQuantity !== '0'
    ) reasons.push(`EXIT_PARTIAL_REMAINDER:${order.orderRef}`);
  }
  if (compareReverseBasisDecimals(exposure.marginSaleFilled, lifecycle.borrow?.confirmedPrincipal ?? '0') > 0) {
    reasons.push('MARGIN_SALE_EXCEEDS_CONFIRMED_BORROW');
  }
  if (compareReverseBasisDecimals(exposure.futuresEntryFilled, exposure.marginSaleFilled) > 0) {
    reasons.push('FUTURES_HEDGE_EXCEEDS_ACTUAL_MARGIN_FILL');
  }
  if (openOrderRefs.length > 0) reasons.push('OPEN_ORDERS_PRESENT');
  if (ambiguousMutationRefs.length > 0) reasons.push('AMBIGUOUS_MUTATION_PRESENT');
  if (unmatchedFillRefs.length > 0) reasons.push('UNMATCHED_FILL_PRESENT');
  if (
    lifecycle.nakedRiskLimitBreached
    || (
      lifecycle.nakedRiskStartedAtMs !== null
      && exposure.hedgeDriftQuantity !== '0'
      && input.evaluatedAtMs - lifecycle.nakedRiskStartedAtMs > input.ticket.maxNakedDurationMs
    )
  ) reasons.push('NAKED_RISK_LIMIT_BREACHED');
  if (lifecycle.repay?.state === 'REJECTED_NO_EFFECT_PROVEN') reasons.push('REPAY_REJECTED_NO_EFFECT_PROVEN');
  if (lifecycle.repay?.state === 'UNKNOWN') reasons.push('REPAY_MUTATION_UNKNOWN');
  if (lifecycle.repay?.state === 'CONFIRMED'
    && (exposure.marginShortRemaining !== '0' || exposure.futuresLongRemaining !== '0')) {
    reasons.push('REPAY_CONFIRMED_BEFORE_POSITION_FLAT');
  }
  const terminalAttempted = lifecycle.closureEvidence !== null;
  const terminalReasons = terminalAttempted
    ? closureReasons(
      input,
      lifecycle,
      exposure,
      openOrderRefs,
      ambiguousMutationRefs,
      unmatchedFillRefs,
    ) : [];
  reasons.push(...terminalReasons);

  let stage: ReverseBasisLifecycleStage;
  const liabilityCurrent = lifecycle.liability !== null
    && lifecycle.liability.observedAtMs <= input.evaluatedAtMs
    && input.evaluatedAtMs <= lifecycle.liability.validUntilMs;
  const orphanRisk = lifecycle.liability !== null
    || orders.some((order) => (
      order.filledQuantity !== '0' || order.open || order.ambiguous
    ))
    || lifecycle.repay !== null;
  const hasExistingRisk = lifecycle.borrow?.state === 'CONFIRMED'
    || lifecycle.borrow?.state === 'UNKNOWN'
    || orphanRisk;
  if (lifecycle.manualIntervention !== null) stage = 'MANUAL_INTERVENTION';
  else if (preflightBlockingReasons.length > 0) stage = hasExistingRisk
    ? 'RECOVERY_REQUIRED' : 'BLOCKED';
  else if (
    terminalAttempted
    && terminalReasons.length === 0
    && recoveryPolicyReasons.length === 0
  ) {
    const recovered = lifecycle.recoveryEvidence.length > 0
      || orders.some((order) => order.role.startsWith('RECOVERY_'))
      || lifecycle.repay?.source === 'EXTERNAL_MANUAL';
    stage = recovered ? 'RECOVERED' : 'CLOSED';
  } else if (
    recoveryPolicyReasons.length > 0
    || ambiguousMutationRefs.length > 0
    || compareReverseBasisDecimals(exposure.futuresEntryFilled, exposure.marginSaleFilled) > 0
    || compareReverseBasisDecimals(
      exposure.marginSaleFilled,
      lifecycle.borrow?.confirmedPrincipal ?? '0',
    ) > 0
    || (lifecycle.borrow?.state === 'CONFIRMED' && !liabilityCurrent)
    || compareReverseBasisDecimals(exposure.marginCoverFilled, exposure.marginSaleFilled) > 0
    || compareReverseBasisDecimals(exposure.futuresExitFilled, exposure.futuresEntryFilled) > 0
    || lifecycle.repay?.state === 'REJECTED_NO_EFFECT_PROVEN'
    || lifecycle.repay?.state === 'UNKNOWN'
    || lifecycle.nakedRiskLimitBreached
    || orders.some((order) => (
      (order.role === 'MARGIN_EXIT_COVER' || order.role === 'FUTURES_EXIT_CLOSE')
      && order.expiredQuantity !== '0'
    ))
    || (terminalAttempted && terminalReasons.length > 0)
  ) stage = lifecycle.recoveryEvidence.length > 0 && recoveryPolicyReasons.length === 0
    ? 'RECOVERING' : 'RECOVERY_REQUIRED';
  else if (lifecycle.recoveryEvidence.length > 0) stage = 'RECOVERING';
  else if (lifecycle.borrow === null) stage = orphanRisk ? 'RECOVERY_REQUIRED' : 'PREFLIGHTED';
  else if (lifecycle.borrow.state === 'REJECTED_NO_EFFECT_PROVEN') {
    stage = orphanRisk ? 'RECOVERY_REQUIRED' : 'BLOCKED';
  }
  else if (lifecycle.borrow.state !== 'CONFIRMED') stage = 'RECOVERY_REQUIRED';
  else if (lifecycle.liability === null) stage = 'RECOVERY_REQUIRED';
  else if (lifecycle.repay !== null) stage = 'REPAYING';
  else if (exposure.marginCoverFilled !== '0' || exposure.futuresExitFilled !== '0') stage = 'EXITING';
  else if (exposure.marginSaleFilled === '0') {
    const rejectedSale = orders.some((order) => (
      order.role === 'MARGIN_ENTRY_SELL'
      && order.mutationState === 'REJECTED_NO_EFFECT_PROVEN'
    ));
    stage = rejectedSale ? 'RECOVERY_REQUIRED' : 'LIABILITY_CONFIRMED';
  } else if (openOrderRefs.some((ref) => lifecycle.orders.get(ref)?.role === 'MARGIN_ENTRY_SELL')) {
    stage = 'ENTRY_MARGIN_SELL_WORKING';
  } else if (exposure.marginSaleFilled !== exposure.futuresEntryFilled) stage = 'HEDGE_WORKING';
  else stage = 'OPEN';

  return deepFreeze({
    exposure,
    openOrderRefs,
    ambiguousMutationRefs,
    unmatchedFillRefs,
    reasonCodes: stableUnique(reasons),
    stage,
  });
}

function applyEvent(
  input: ReverseBasisLifecycleInput,
  lifecycle: MutableLifecycle,
  event: ReverseBasisEvent,
  policies: PolicyContext,
): readonly string[] {
  validateEventEnvelope(event, input);
  if (lifecycle.closureEvidence !== null) {
    throw new TypeError('closure reconciliation is final; no later event is allowed');
  }
  switch (event.kind) {
    case 'BORROW_OBSERVED': {
      validateBorrowObservation(event.payload, input.ticket);
      if (lifecycle.borrow !== null) throw new TypeError('borrow observation may occur only once');
      if (
        lifecycle.liability !== null
        || lifecycle.orders.size > 0
        || lifecycle.repay !== null
        || lifecycle.closureEvidence !== null
      ) throw new TypeError('borrow observation must precede liability/order/repay/closure truth');
      const quote = input.preflight.borrowQuote;
      const reasons = [...ownerTruthReasonsAt(input, event.occurredAtMs, 'BORROW')];
      if (event.payload.state === 'CONFIRMED') {
        if (quote === null
          || event.occurredAtMs < quote.observedAtMs
          || event.occurredAtMs > quote.validUntilMs) {
          reasons.push('BORROW_CONFIRMATION_OUTSIDE_QUOTE_WINDOW');
        }
        if (event.occurredAtMs > input.ticket.expiresAtMs) {
          reasons.push('BORROW_AFTER_TICKET_EXPIRY');
        }
        if (event.occurredAtMs > policies.entry.expiresAtMs) {
          reasons.push('BORROW_AFTER_ENTRY_POLICY_EXPIRY');
        }
        if (quote?.nextInterestAtMs !== null
          && quote?.nextInterestAtMs !== undefined
          && event.occurredAtMs >= quote.nextInterestAtMs) {
          reasons.push('BORROW_INTEREST_BOUNDARY_REQUERY_REQUIRED');
        }
      }
      lifecycle.borrow = clonePlain(event.payload);
      lifecycle.borrowOccurredAtMs = event.occurredAtMs;
      return stableUnique(reasons);
    }
    case 'LIABILITY_OBSERVED': {
      validateLiabilityObservation(event.payload, input.ticket);
      if (event.payload.observedAtMs > event.occurredAtMs) {
        throw new TypeError('liability observation occurs after its event envelope');
      }
      if (
        lifecycle.liability !== null
        && event.payload.observedAtMs < lifecycle.liability.observedAtMs
      ) throw new TypeError('liability observation time regressed');
      if (
        lifecycle.borrowOccurredAtMs !== null
        && event.payload.observedAtMs < lifecycle.borrowOccurredAtMs
      ) throw new TypeError('liability truth predates the borrow observation');
      if (
        lifecycle.borrow?.state === 'CONFIRMED'
        && lifecycle.liability === null
        && (
          event.payload.liabilityRevision !== lifecycle.borrow.liabilityRevision
          || event.payload.principal !== lifecycle.borrow.confirmedPrincipal
        )
      ) throw new TypeError('first liability truth does not exactly bind the confirmed borrow');
      if (lifecycle.liability !== null && lifecycle.repay === null) {
        if (event.payload.liabilityRevision === lifecycle.liability.liabilityRevision
          && canonicalJson(event.payload) !== canonicalJson(lifecycle.liability)) {
          throw new TypeError('liability revision content conflicts with prior truth');
        }
        if (
          event.payload.principal !== lifecycle.liability.principal
          || compareReverseBasisDecimals(
            event.payload.accruedInterest,
            lifecycle.liability.accruedInterest,
          ) < 0
          || compareReverseBasisDecimals(
            event.payload.totalLiability,
            lifecycle.liability.totalLiability,
          ) < 0
        ) throw new TypeError('liability principal or interest regressed without repayment');
      }
      if (event.payload.totalLiability === '0' && lifecycle.repay?.state !== 'CONFIRMED') {
        throw new TypeError('zero liability truth must follow a confirmed repay observation');
      }
      if (
        lifecycle.repay?.state === 'CONFIRMED'
        && event.payload.liabilityRevision !== lifecycle.repay.liabilityRevision
      ) throw new TypeError('post-repay liability truth does not bind the confirmed repay revision');
      if (
        lifecycle.repayOccurredAtMs !== null
        && event.payload.observedAtMs < lifecycle.repayOccurredAtMs
      ) throw new TypeError('post-repay liability truth predates the repay observation');
      if (lifecycle.recoveryEvidence.length > 0 && lifecycle.repay === null) {
        throw new TypeError('liability truth cannot change inside a frozen recovery evidence batch');
      }
      if (lifecycle.initialLiability === null) {
        lifecycle.initialLiability = clonePlain(event.payload);
      }
      lifecycle.liability = clonePlain(event.payload);
      return [];
    }
    case 'ORDER_OBSERVED': {
      const { action, twinOrder, twin } = validateOrderObservation(event.payload, input.ticket, policies);
      if (lifecycle.repay !== null) throw new TypeError('order observation cannot follow repay truth');
      const liabilityBasis = lifecycle.liability;
      if (liabilityBasis === null || !liabilityCurrentAt(liabilityBasis, event.occurredAtMs)) {
        throw new TypeError('order observation requires current liability truth');
      }
      const previous = lifecycle.orders.get(event.payload.orderRef);
      const projection = projectOrder(
        event.payload,
        twinOrder,
        twin,
        previous?.liabilityBasis ?? liabilityBasis,
        event.occurredAtMs,
        previous,
      );
      const plan = planForRole(event.payload.role, policies);
      const policyLeg = legById(plan, action.legId);
      if (
        compareReverseBasisDecimals(projection.requestedQuantity, action.quantity!) > 0
        || compareReverseBasisDecimals(projection.requestedQuantity, policyLeg.filteredQuantity) > 0
        || (action.quantitySource === 'AUTHORIZED_FILTERED_QUANTITY'
          && projection.requestedQuantity !== action.quantity)
      ) throw new TypeError('order request exceeds or relabels the accepted L08 quantity ceiling');
      const latestTwinEventAtMs = twin.processedEvents.reduce(
        (latest, processed) => Math.max(latest, processed.occurredAtMs),
        0,
      );
      if (
        latestTwinEventAtMs > event.occurredAtMs
        || (projection.observedAtMs !== null && projection.observedAtMs > event.occurredAtMs)
        || (projection.venueEffectAtMs !== null && projection.venueEffectAtMs > event.occurredAtMs)
        || (projection.dispatchAtMs !== null && projection.dispatchAtMs > event.occurredAtMs)
      ) throw new TypeError('L07 order truth occurs after its L10 event envelope');
      const currentOrders = [...lifecycle.orders.values()];
      if (!event.payload.role.startsWith('RECOVERY_') && lifecycle.recoveryEvidence.length > 0) {
        throw new TypeError('normal order cannot enter after recovery evidence freezes the batch');
      }
      const marginFilledBefore = sumRole(currentOrders, ['MARGIN_ENTRY_SELL']);
      const futuresFilledBefore = sumRole(currentOrders, ['FUTURES_ENTRY_HEDGE']);
      const marginCoveredBefore = sumRole(currentOrders, ['MARGIN_EXIT_COVER', 'RECOVERY_MARGIN_COVER']);
      const futuresClosedBefore = sumRole(currentOrders, ['FUTURES_EXIT_CLOSE', 'RECOVERY_FUTURES_ADJUST']);
      const exposureBefore = computeExposure(lifecycle);
      const latestEffectFor = (roles: readonly ReverseBasisOrderRole[]): number => currentOrders
        .filter((order) => roles.includes(order.role))
        .reduce((latest, order) => Math.max(latest, order.venueEffectAtMs ?? 0), 0);
      const latestObservedFor = (roles: readonly ReverseBasisOrderRole[]): number => currentOrders
        .filter((order) => roles.includes(order.role))
        .reduce((latest, order) => Math.max(
          latest,
          order.observedAtMs ?? order.venueEffectAtMs ?? 0,
        ), 0);
      if (projection.mutationState === 'CONFIRMED'
        && projection.filledQuantity !== '0'
        && projection.venueEffectAtMs === null) {
        throw new TypeError('confirmed fill lacks an L07 venue-effect time');
      }
      if (projection.venueEffectAtMs !== null) {
        if (event.payload.role === 'MARGIN_ENTRY_SELL'
          && projection.venueEffectAtMs < Math.max(
            lifecycle.borrowOccurredAtMs ?? 0,
            lifecycle.liability?.observedAtMs ?? 0,
          )) throw new TypeError('Margin entry venue effect predates borrow/liability truth');
        if (event.payload.role === 'FUTURES_ENTRY_HEDGE'
          && projection.venueEffectAtMs < latestEffectFor(['MARGIN_ENTRY_SELL'])) {
          throw new TypeError('Futures hedge venue effect predates the Margin sale effect');
        }
        if ((event.payload.role === 'MARGIN_EXIT_COVER'
          || event.payload.role === 'RECOVERY_MARGIN_COVER')
          && projection.venueEffectAtMs < latestEffectFor([
            'MARGIN_ENTRY_SELL', 'FUTURES_ENTRY_HEDGE',
          ])) throw new TypeError('Margin cover venue effect predates completed entry effects');
        if ((event.payload.role === 'FUTURES_EXIT_CLOSE'
          || event.payload.role === 'RECOVERY_FUTURES_ADJUST')
          && projection.venueEffectAtMs < latestEffectFor([
            'MARGIN_EXIT_COVER', 'RECOVERY_MARGIN_COVER',
          ])) throw new TypeError('Futures close venue effect predates the Margin cover effect');
      }
      if (projection.dispatchAtMs !== null) {
        if (event.payload.role === 'MARGIN_ENTRY_SELL'
          && projection.dispatchAtMs < Math.max(
            lifecycle.borrowOccurredAtMs ?? 0,
            lifecycle.liability?.observedAtMs ?? 0,
          )) throw new TypeError('Margin entry dispatch predates borrow/liability truth');
        if (event.payload.role === 'FUTURES_ENTRY_HEDGE'
          && projection.dispatchAtMs < latestObservedFor(['MARGIN_ENTRY_SELL'])) {
          throw new TypeError('Futures hedge dispatch predates actual Margin fill observation');
        }
        if ((event.payload.role === 'MARGIN_EXIT_COVER'
          || event.payload.role === 'RECOVERY_MARGIN_COVER')
          && projection.dispatchAtMs < latestObservedFor([
            'MARGIN_ENTRY_SELL', 'FUTURES_ENTRY_HEDGE',
          ])) throw new TypeError('Margin cover dispatch predates fully hedged entry observation');
        if ((event.payload.role === 'FUTURES_EXIT_CLOSE'
          || event.payload.role === 'RECOVERY_FUTURES_ADJUST')
          && projection.dispatchAtMs < latestObservedFor([
            'MARGIN_EXIT_COVER', 'RECOVERY_MARGIN_COVER',
          ])) throw new TypeError('Futures close dispatch predates Margin cover observation');
      }
      if (
        event.payload.role === 'MARGIN_ENTRY_SELL'
        && (lifecycle.borrow?.state !== 'CONFIRMED' || lifecycle.liability === null)
      ) throw new TypeError('Margin sale requires confirmed borrow and persisted liability truth');
      if (event.payload.role === 'MARGIN_ENTRY_SELL' && (marginCoveredBefore !== '0' || futuresClosedBefore !== '0')) {
        throw new TypeError('Margin entry cannot begin after exit or recovery has started');
      }
      if (event.payload.role === 'FUTURES_ENTRY_HEDGE' && marginFilledBefore === '0') {
        throw new TypeError('Futures hedge requires an actual Margin sale fill');
      }
      if (event.payload.role === 'MARGIN_EXIT_COVER' && marginFilledBefore === '0') {
        throw new TypeError('Margin cover requires an actual Margin sale fill');
      }
      if (
        event.payload.role === 'MARGIN_EXIT_COVER'
        && (
          exposureBefore.marginShortRemaining === '0'
          || exposureBefore.marginShortRemaining !== exposureBefore.futuresLongRemaining
        )
      ) throw new TypeError('normal Margin cover requires a fully hedged open pair');
      if (event.payload.role === 'FUTURES_EXIT_CLOSE' && marginCoveredBefore === '0') {
        throw new TypeError('Futures exit requires an actual Margin cover fill');
      }
      if (previous !== undefined) {
        if (
          previous.role !== projection.role
          || previous.accountOrderId !== projection.accountOrderId
          || previous.mutationEvidenceRevision !== projection.mutationEvidenceRevision
          || canonicalJson(previous.liabilityBasis) !== canonicalJson(projection.liabilityBasis)
          || previous.firstEventOccurredAtMs !== projection.firstEventOccurredAtMs
          || projection.lastEventOccurredAtMs < previous.lastEventOccurredAtMs
          || previous.twinFixtureId !== projection.twinFixtureId
          || previous.requestedQuantity !== projection.requestedQuantity
          || previous.policyPlanRevision !== projection.policyPlanRevision
          || previous.policyActionId !== projection.policyActionId
          || compareReverseBasisDecimals(projection.filledQuantity, previous.filledQuantity) < 0
          || (previous.observedAtMs !== null
            && (projection.observedAtMs === null || projection.observedAtMs < previous.observedAtMs))
          || (previous.venueEffectAtMs !== null
            && (projection.venueEffectAtMs === null
              || projection.venueEffectAtMs < previous.venueEffectAtMs))
        ) throw new TypeError('order observation conflicts with prior order truth');
        const previousTerminal = ['FILLED', 'CANCELED', 'EXPIRED', 'BLOCKED', 'NOT_ARRIVED']
          .includes(previous.venueStatus);
        if (previousTerminal && (
          previous.venueStatus !== projection.venueStatus
          || previous.filledQuantity !== projection.filledQuantity
          || previous.remainingQuantity !== projection.remainingQuantity
          || previous.expiredQuantity !== projection.expiredQuantity
          || previous.filledNotionalQuote !== projection.filledNotionalQuote
          || previous.venueEffectAtMs !== projection.venueEffectAtMs
          || canonicalJson(previous.fillIds) !== canonicalJson(projection.fillIds)
        )) throw new TypeError('terminal order venue/fill truth is absorbing');
        if (!previousTerminal && previous.fillIds.some((fillId) => !projection.fillIds.includes(fillId))) {
          throw new TypeError('order update does not preserve prior canonical fill lineage');
        }
      }
      for (const existing of currentOrders) {
        if (existing.orderRef === projection.orderRef) continue;
        if (
          (projection.accountOrderId !== null && existing.accountOrderId === projection.accountOrderId)
          || existing.twinFixtureId === projection.twinFixtureId
          || (
            existing.policyPlanRevision === projection.policyPlanRevision
            && existing.policyActionId === projection.policyActionId
          )
        ) throw new TypeError('logical order identity is already bound to another order reference');
      }
      if (lifecycle.orders.size >= MAX_ORDERS && previous === undefined) {
        throw new RangeError('reverse-basis order bound exceeded');
      }
      if (
        event.payload.role === 'MARGIN_ENTRY_SELL'
        && previous === undefined
        && projection.requestedQuantity !== lifecycle.borrow?.confirmedPrincipal
      ) throw new TypeError('Margin sale request must exactly match confirmed borrowed principal');
      if (
        event.payload.role === 'MARGIN_EXIT_COVER'
        && previous === undefined
        && projection.requestedQuantity !== exposureBefore.marginShortRemaining
      ) throw new TypeError('Margin cover request must exactly match the remaining Margin short');
      if (event.payload.role === 'FUTURES_ENTRY_HEDGE' && previous === undefined) {
        const outstandingMarginFill = subtractReverseBasisFloorZero(
          marginFilledBefore,
          futuresFilledBefore,
        );
        if (
          action.quantitySource !== 'ACTUAL_FILL_OF_LEG'
          || projection.requestedQuantity !== outstandingMarginFill
        ) throw new TypeError('Futures hedge must request exactly the outstanding actual Margin fill');
      }
      if (event.payload.role === 'FUTURES_EXIT_CLOSE' && previous === undefined) {
        const outstandingMarginCover = subtractReverseBasisFloorZero(
          marginCoveredBefore,
          futuresClosedBefore,
        );
        if (
          action.quantitySource !== 'ACTUAL_FILL_OF_LEG'
          || projection.requestedQuantity !== outstandingMarginCover
        ) throw new TypeError('Futures exit must request exactly the outstanding actual Margin cover fill');
      }
      if (event.payload.role.startsWith('RECOVERY_')) {
        const evidence = lifecycle.recoveryEvidence.filter((item) => (
          item.policyActionId === action.actionId
          && item.evidenceRevision === action.recoveryEvidenceRevision
          && item.targetExposureRevision === action.targetExposureRevision
        ));
        const recoveryOrdersBefore = currentOrders.some((order) => order.role.startsWith('RECOVERY_'));
        if (
          evidence.length !== 1
          || evidence[0].targetExposureRevision !== lifecycle.recoveryBatchTargetRevision
          || (!recoveryOrdersBefore && evidence[0].targetExposureRevision
            !== deriveReverseBasisExposureRevision(exposureBefore))
        ) throw new TypeError('recovery order requires exact frozen-batch recovery evidence');
      }
      lifecycle.orders.set(projection.orderRef, projection);
      const reasons: string[] = [...ownerTruthReasonsAt(input, event.occurredAtMs, 'ORDER')];
      if (event.occurredAtMs > plan.expiresAtMs) reasons.push(`ORDER_POLICY_EXPIRED:${projection.orderRef}`);
      if (
        (event.payload.role === 'MARGIN_ENTRY_SELL' || event.payload.role === 'FUTURES_ENTRY_HEDGE')
        && event.occurredAtMs > input.ticket.expiresAtMs
      ) reasons.push(`ENTRY_AFTER_TICKET_EXPIRY:${projection.orderRef}`);
      const exposureAfter = computeExposure(lifecycle);
      if (lifecycle.nakedRiskStartedAtMs !== null
        && event.occurredAtMs - lifecycle.nakedRiskStartedAtMs > input.ticket.maxNakedDurationMs) {
        lifecycle.nakedRiskLimitBreached = true;
      }
      if (exposureAfter.hedgeDriftQuantity !== '0' && lifecycle.nakedRiskStartedAtMs === null) {
        lifecycle.nakedRiskStartedAtMs = projection.venueEffectAtMs ?? event.occurredAtMs;
      }
      if (exposureAfter.hedgeDriftQuantity !== '0') {
        if (compareReverseBasisDecimals(
          exposureAfter.hedgeDriftQuantity,
          input.ticket.maxNakedQuantity,
        ) > 0) lifecycle.nakedRiskLimitBreached = true;
        if (lifecycle.nakedRiskStartedAtMs !== null
          && event.occurredAtMs - lifecycle.nakedRiskStartedAtMs > input.ticket.maxNakedDurationMs) {
          lifecycle.nakedRiskLimitBreached = true;
        }
      } else lifecycle.nakedRiskStartedAtMs = null;
      if (
        (event.payload.role === 'MARGIN_ENTRY_SELL'
          || event.payload.role === 'MARGIN_EXIT_COVER'
          || event.payload.role === 'RECOVERY_MARGIN_COVER')
        && compareReverseBasisDecimals(
          projection.filledNotionalQuote,
          input.ticket.maxNakedNotionalQuote,
        ) > 0
      ) lifecycle.nakedRiskLimitBreached = true;
      const entryGrossNotional = sumReverseBasisDecimals(
        [...lifecycle.orders.values()]
          .filter((order) => order.role === 'MARGIN_ENTRY_SELL' || order.role === 'FUTURES_ENTRY_HEDGE')
          .map((order) => order.filledNotionalQuote),
      );
      if (compareReverseBasisDecimals(entryGrossNotional, input.ticket.maxGrossNotionalQuote) > 0) {
        lifecycle.nakedRiskLimitBreached = true;
      }
      lifecycle.lastOrderOccurredAtMs = event.occurredAtMs;
      return stableUnique(reasons);
    }
    case 'REPAY_OBSERVED': {
      validateRepayObservation(event.payload, input.ticket);
      if (lifecycle.repay !== null) throw new TypeError('repay observation may occur only once');
      if (lifecycle.borrow?.state !== 'CONFIRMED' || lifecycle.liability === null) {
        throw new TypeError('repay requires confirmed borrow and current liability truth');
      }
      if (!liabilityCurrentAt(lifecycle.liability, event.occurredAtMs)) {
        throw new TypeError('repay requires liability truth current at the repay event');
      }
      const exposure = computeExposure(lifecycle);
      const orders = [...lifecycle.orders.values()];
      if (
        exposure.marginShortRemaining !== '0'
        || exposure.futuresLongRemaining !== '0'
        || exposure.marginSaleFilled !== exposure.futuresEntryFilled
        || exposure.marginCoverFilled !== exposure.futuresExitFilled
        || orders.some((order) => order.open || order.ambiguous)
      ) throw new TypeError('repay requires flat, paired and unambiguous order truth');
      if (lifecycle.liability.totalLiability === '0') throw new TypeError('zero liability cannot be repaid again');
      if (
        event.payload.state === 'CONFIRMED'
        && (
          event.payload.requestedRepayAmount !== lifecycle.liability.totalLiability
          || event.payload.confirmedRepayAmount !== lifecycle.liability.totalLiability
        )
      ) throw new TypeError('confirmed repay does not cover principal plus accrued interest');
      lifecycle.repay = clonePlain(event.payload);
      lifecycle.repayBasis = clonePlain(lifecycle.liability);
      lifecycle.repayOccurredAtMs = event.occurredAtMs;
      return [];
    }
    case 'RECOVERY_EVIDENCE': {
      const reasons = validateRecoveryEvidence(event.payload, input, policies, lifecycle);
      if (lifecycle.recoveryEvidence.some((item) => (
        item.recoveryRef === event.payload.recoveryRef
        || (item.policyActionId === event.payload.policyActionId
          && item.evidenceRevision === event.payload.evidenceRevision)
      ))) {
        throw new TypeError('duplicate recovery identity/action binding');
      }
      if ([...lifecycle.orders.values()].some((order) => order.role.startsWith('RECOVERY_'))) {
        throw new TypeError('recovery evidence batch cannot expand after recovery orders begin');
      }
      if (lifecycle.recoveryBatchTargetRevision === null) {
        lifecycle.recoveryBatchTargetRevision = event.payload.targetExposureRevision;
      } else if (lifecycle.recoveryBatchTargetRevision !== event.payload.targetExposureRevision) {
        throw new TypeError('recovery evidence batch target revision conflicts');
      }
      lifecycle.recoveryEvidence.push({
        ...clonePlain(event.payload),
        occurredAtMs: event.occurredAtMs,
      });
      return stableUnique([
        ...reasons,
        ...ownerTruthReasonsAt(input, event.occurredAtMs, 'RECOVERY'),
      ]);
    }
    case 'CLOSURE_RECONCILED': {
      validateClosureEvidence(event.payload, input.ticket);
      if (
        lifecycle.borrow === null
        || lifecycle.repay === null
        || lifecycle.liability === null
      ) throw new TypeError('closure requires borrow, repay and liability truth');
      const latestRequiredAtMs = Math.max(
        lifecycle.repayOccurredAtMs ?? 0,
        lifecycle.lastOrderOccurredAtMs ?? 0,
        lifecycle.liability.observedAtMs,
        ...[...lifecycle.orders.values()].map((order) => order.observedAtMs ?? 0),
      );
      if (
        event.payload.observedAtMs > event.occurredAtMs
        || event.payload.observedAtMs < latestRequiredAtMs
      ) throw new TypeError('closure reconciliation is not newer than lifecycle truth');
      lifecycle.closureEvidence = clonePlain(event.payload);
      return [];
    }
    case 'MANUAL_INTERVENTION': {
      validateManualIntervention(event.payload);
      lifecycle.manualIntervention = clonePlain(event.payload);
      return [];
    }
    default: {
      const exhaustive: never = event;
      throw new TypeError(`unsupported reverse-basis event: ${String(exhaustive)}`);
    }
  }
}

function stateMaterial(state: Omit<ReverseBasisLifecycleState, 'stateRevision'>): Omit<ReverseBasisLifecycleState, 'stateRevision'> {
  return state;
}

export function runReverseBasisLifecycle(inputValue: unknown): Readonly<ReverseBasisLifecycleState> {
  const input = clonePlain(inputValue) as ReverseBasisLifecycleInput;
  requireExactRecord(input, [
    'schema', 'lifecycleVersion', 'evaluatedAtMs', 'ticket', 'preflight',
    'policies', 'events', 'simulationAuthority', 'sendEligible',
    'privateReadAuthority', 'mutationAuthority', 'actionAuthority',
    'externalActionAuthorization',
  ], 'reverse-basis input');
  if (
    input.schema !== REVERSE_BASIS_INPUT_SCHEMA
    || input.lifecycleVersion !== 'L10_REVERSE_BASIS_V1'
  ) throw new TypeError('reverse-basis input schema/version is invalid');
  requireAuthority(input as unknown as Record<string, unknown>, 'reverse-basis input');
  requireUtc(input.evaluatedAtMs, 'evaluatedAtMs');
  validateTicket(input.ticket);
  const policies = validatePolicySet(input.policies, input.ticket);
  if (!Array.isArray(input.events) || input.events.length > MAX_EVENTS) {
    throw new RangeError('reverse-basis event list is invalid or overbound');
  }
  const blockingReasons = preflightReasons(input);
  const lifecycle: MutableLifecycle = {
    borrow: null,
    initialLiability: null,
    liability: null,
    repay: null,
    repayBasis: null,
    orders: new Map(),
    recoveryEvidence: [],
    recoveryBatchTargetRevision: null,
    closureEvidence: null,
    manualIntervention: null,
    nakedRiskStartedAtMs: null,
    nakedRiskLimitBreached: false,
    borrowOccurredAtMs: null,
    repayOccurredAtMs: null,
    lastOrderOccurredAtMs: null,
  };
  const sequences = new Set<number>();
  const eventIds = new Set<string>();
  const sortedEvents = [...input.events].sort((left, right) => (
    left.sequence - right.sequence || stableTextCompare(left.eventId, right.eventId)
  ));
  const processedEvents: ReverseBasisProcessedEvent[] = [];
  const recoveryReasons: string[] = [];
  let lastOccurredAtMs: number | null = null;
  for (const event of sortedEvents) {
    validateEventEnvelope(event, input);
    if (lastOccurredAtMs !== null && event.occurredAtMs < lastOccurredAtMs) {
      throw new TypeError('reverse-basis event occurrence time regressed across sequence');
    }
    if (sequences.has(event.sequence)) throw new TypeError('reverse-basis event sequence is duplicated');
    if (eventIds.has(event.eventId)) throw new TypeError('reverse-basis event ID is duplicated');
    sequences.add(event.sequence);
    eventIds.add(event.eventId);
    lastOccurredAtMs = event.occurredAtMs;
  }
  lastOccurredAtMs = null;
  for (const event of sortedEvents) {
    recoveryReasons.push(...applyEvent(input, lifecycle, event, policies));
    lastOccurredAtMs = event.occurredAtMs;
    const derived = deriveLifecycle(input, lifecycle, blockingReasons, stableUnique(recoveryReasons));
    processedEvents.push(Object.freeze({
      eventId: event.eventId,
      sequence: event.sequence,
      kind: event.kind,
      eventRevision: digest('l10eventrev_', event),
      stageAfter: derived.stage,
    }));
  }
  const derived = deriveLifecycle(input, lifecycle, blockingReasons, stableUnique(recoveryReasons));
  const inputRevision = digest('l10input_', { ...input, events: sortedEvents });
  const withoutRevision: Omit<ReverseBasisLifecycleState, 'stateRevision'> = {
    schema: REVERSE_BASIS_STATE_SCHEMA,
    lifecycleVersion: 'L10_REVERSE_BASIS_V1',
    ticket: clonePlain(input.ticket),
    evaluatedAtMs: input.evaluatedAtMs,
    stage: derived.stage,
    preflightPassed: blockingReasons.length === 0,
    preflight: clonePlain(input.preflight),
    borrowQuote: input.preflight.borrowQuote === null
      ? null : clonePlain(input.preflight.borrowQuote),
    collateral: clonePlain(input.preflight.collateral),
    borrow: lifecycle.borrow === null ? null : clonePlain(lifecycle.borrow),
    initialLiability: lifecycle.initialLiability === null
      ? null : clonePlain(lifecycle.initialLiability),
    liability: lifecycle.liability === null ? null : clonePlain(lifecycle.liability),
    repay: lifecycle.repay === null ? null : clonePlain(lifecycle.repay),
    repayBasis: lifecycle.repayBasis === null ? null : clonePlain(lifecycle.repayBasis),
    orders: Object.freeze([...lifecycle.orders.values()]
      .sort((left, right) => stableTextCompare(left.orderRef, right.orderRef))
      .map((order) => clonePlain(order))),
    recoveryEvidence: Object.freeze(lifecycle.recoveryEvidence
      .map((evidence) => clonePlain(evidence))),
    recoveryBatchTargetRevision: lifecycle.recoveryBatchTargetRevision,
    closureEvidence: lifecycle.closureEvidence === null
      ? null : clonePlain(lifecycle.closureEvidence),
    manualIntervention: lifecycle.manualIntervention === null
      ? null : clonePlain(lifecycle.manualIntervention),
    nakedRiskStartedAtMs: lifecycle.nakedRiskStartedAtMs,
    nakedRiskLimitBreached: lifecycle.nakedRiskLimitBreached
      || derived.reasonCodes.includes('NAKED_RISK_LIMIT_BREACHED'),
    borrowOccurredAtMs: lifecycle.borrowOccurredAtMs,
    repayOccurredAtMs: lifecycle.repayOccurredAtMs,
    lastOrderOccurredAtMs: lifecycle.lastOrderOccurredAtMs,
    exposure: clonePlain(derived.exposure),
    openOrderRefs: derived.openOrderRefs,
    ambiguousMutationRefs: derived.ambiguousMutationRefs,
    unmatchedFillRefs: derived.unmatchedFillRefs,
    reasonCodes: derived.reasonCodes,
    processedEvents: Object.freeze(processedEvents),
    inputRevision,
    ...REVERSE_BASIS_NO_ACTION_AUTHORITY,
  };
  const state: ReverseBasisLifecycleState = {
    ...withoutRevision,
    stateRevision: digest('l10state_', stateMaterial(withoutRevision)),
  };
  validateReverseBasisLifecycleState(state);
  return deepFreeze(state);
}

export function validateReverseBasisLifecycleState(stateValue: unknown): true {
  const state = clonePlain(stateValue) as ReverseBasisLifecycleState;
  requireExactRecord(state, [
    'schema', 'lifecycleVersion', 'ticket', 'evaluatedAtMs', 'stage',
    'preflightPassed', 'preflight', 'borrowQuote', 'collateral', 'borrow',
    'initialLiability', 'liability',
    'repay', 'repayBasis', 'orders', 'recoveryEvidence',
    'recoveryBatchTargetRevision', 'closureEvidence',
    'manualIntervention', 'nakedRiskStartedAtMs', 'nakedRiskLimitBreached',
    'borrowOccurredAtMs', 'repayOccurredAtMs', 'lastOrderOccurredAtMs',
    'exposure', 'openOrderRefs', 'ambiguousMutationRefs', 'unmatchedFillRefs',
    'reasonCodes', 'processedEvents', 'inputRevision', 'stateRevision',
    'simulationAuthority', 'sendEligible', 'privateReadAuthority',
    'mutationAuthority', 'actionAuthority', 'externalActionAuthorization',
  ], 'reverse-basis state');
  if (
    state.schema !== REVERSE_BASIS_STATE_SCHEMA
    || state.lifecycleVersion !== 'L10_REVERSE_BASIS_V1'
  ) throw new TypeError('reverse-basis state schema/version is invalid');
  if (!LIFECYCLE_STAGES.has(state.stage)) throw new TypeError('state lifecycle stage is invalid');
  requireAuthority(state as unknown as Record<string, unknown>, 'reverse-basis state');
  requireUtc(state.evaluatedAtMs, 'state.evaluatedAtMs');
  validateTicket(state.ticket);
  const statePreflightReasons = preflightReasons({
    ticket: state.ticket,
    preflight: state.preflight,
    evaluatedAtMs: state.evaluatedAtMs,
  } as ReverseBasisLifecycleInput);
  if (
    state.preflightPassed !== (statePreflightReasons.length === 0)
    || canonicalJson(state.preflight.borrowQuote) !== canonicalJson(state.borrowQuote)
    || canonicalJson(state.preflight.collateral) !== canonicalJson(state.collateral)
  ) throw new TypeError('state preflight result does not derive from persisted owner truth');
  for (const [label, value] of Object.entries({
    borrowOccurredAtMs: state.borrowOccurredAtMs,
    repayOccurredAtMs: state.repayOccurredAtMs,
    lastOrderOccurredAtMs: state.lastOrderOccurredAtMs,
  })) {
    if (value !== null) {
      requireUtc(value, `state.${label}`);
      if (value > state.evaluatedAtMs) throw new TypeError(`state.${label} is in the future`);
    }
  }
  if ((state.borrow === null) !== (state.borrowOccurredAtMs === null)
    || (state.repay === null) !== (state.repayOccurredAtMs === null)
    || (state.orders.length === 0) !== (state.lastOrderOccurredAtMs === null)) {
    throw new TypeError('state mutation truth lacks its occurrence-time binding');
  }
  if (state.borrow?.state === 'CONFIRMED' && (
    state.initialLiability === null
    || state.initialLiability.liabilityRevision !== state.borrow.liabilityRevision
    || state.initialLiability.principal !== state.borrow.confirmedPrincipal
    || state.initialLiability.observedAtMs < (state.borrowOccurredAtMs ?? 0)
  )) throw new TypeError('state initial liability does not exactly follow confirmed borrow truth');
  const stateBorrowTimeReasons: string[] = [];
  if (state.borrow?.state === 'CONFIRMED' && state.borrowOccurredAtMs !== null) {
    stateBorrowTimeReasons.push(...ownerTruthReasonsAt({
      ticket: state.ticket,
      preflight: state.preflight,
    } as ReverseBasisLifecycleInput, state.borrowOccurredAtMs, 'BORROW'));
    const quote = state.borrowQuote;
    if (quote === null
      || state.borrowOccurredAtMs < quote.observedAtMs
      || state.borrowOccurredAtMs > quote.validUntilMs) {
      stateBorrowTimeReasons.push('BORROW_CONFIRMATION_OUTSIDE_QUOTE_WINDOW');
    }
    if (quote?.nextInterestAtMs !== null
      && quote?.nextInterestAtMs !== undefined
      && state.borrowOccurredAtMs >= quote.nextInterestAtMs) {
      stateBorrowTimeReasons.push('BORROW_INTEREST_BOUNDARY_REQUERY_REQUIRED');
    }
    if (state.borrowOccurredAtMs > state.ticket.expiresAtMs) {
      stateBorrowTimeReasons.push('BORROW_AFTER_TICKET_EXPIRY');
    }
  }
  requireId(state.inputRevision, 'state.inputRevision');
  requireId(state.stateRevision, 'state.stateRevision');
  const { stateRevision, ...material } = state;
  if (digest('l10state_', stateMaterial(material)) !== stateRevision) {
    throw new TypeError('reverse-basis state revision mismatch');
  }
  requireExactRecord(state.collateral, [
    'accountRealmId', 'marginMode', 'isolatedSymbol', 'state', 'marginLevel',
    'collateralMarginLevel', 'collateralValueQuote', 'liquidationPrice',
    'liquidationState', 'observedAtMs', 'validUntilMs', 'collateralRevision',
  ], 'state collateral');
  validateMarginRealmIdentity(state.collateral, state.ticket, 'state collateral');
  if (!['CURRENT', 'STALE', 'UNKNOWN'].includes(state.collateral.state)
    || !['NORMAL', 'MARGIN_CALL', 'LIQUIDATION', 'UNKNOWN']
      .includes(state.collateral.liquidationState)) {
    throw new TypeError('state collateral enum is invalid');
  }
  requireInterval(state.collateral.observedAtMs, state.collateral.validUntilMs, 'state collateral');
  requireId(state.collateral.collateralRevision, 'state collateral revision');
  if (state.borrowQuote !== null) {
    requireExactRecord(state.borrowQuote, [
      'accountRealmId', 'marginMode', 'isolatedSymbol', 'state', 'asset',
      'requestedPrincipal', 'maximumBorrowable', 'accountBorrowLimit',
      'availableInventory', 'hourlyInterestRate', 'interestAccrual',
      'nextInterestAtMs', 'observedAtMs', 'validUntilMs', 'quoteRevision',
    ], 'state borrow quote');
    validateMarginRealmIdentity(state.borrowQuote, state.ticket, 'state borrow quote');
    if (!['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'].includes(state.borrowQuote.state)
      || !['ON_BORROW_AND_HOURLY', 'UNKNOWN'].includes(state.borrowQuote.interestAccrual)) {
      throw new TypeError('state borrow quote enum is invalid');
    }
    requireInterval(state.borrowQuote.observedAtMs, state.borrowQuote.validUntilMs, 'state borrow quote');
    requireId(state.borrowQuote.quoteRevision, 'state borrow quote revision');
    for (const value of [
      state.borrowQuote.requestedPrincipal, state.borrowQuote.maximumBorrowable,
      state.borrowQuote.accountBorrowLimit, state.borrowQuote.availableInventory,
      state.borrowQuote.hourlyInterestRate,
    ]) if (value !== null) reverseBasisDecimal(value, 'state borrow quote decimal');
  }
  if (state.borrow !== null) validateBorrowObservation(state.borrow, state.ticket);
  if (state.initialLiability !== null) {
    validateLiabilityObservation(state.initialLiability, state.ticket);
  }
  if (state.liability !== null) validateLiabilityObservation(state.liability, state.ticket);
  if (state.repay !== null) validateRepayObservation(state.repay, state.ticket);
  if (state.repayBasis !== null) validateLiabilityObservation(state.repayBasis, state.ticket);
  if (state.closureEvidence !== null) validateClosureEvidence(state.closureEvidence, state.ticket);
  if (state.manualIntervention !== null) validateManualIntervention(state.manualIntervention);
  const liabilityRevisions = new Map<string, string>();
  const retainLiabilityRevision = (value: ReverseBasisLiabilityObservation | null): void => {
    if (value === null) return;
    const content = canonicalJson(value);
    const prior = liabilityRevisions.get(value.liabilityRevision);
    if (prior !== undefined && prior !== content) {
      throw new TypeError('state liability revision has conflicting content');
    }
    liabilityRevisions.set(value.liabilityRevision, content);
  };
  retainLiabilityRevision(state.initialLiability);
  retainLiabilityRevision(state.repayBasis);
  retainLiabilityRevision(state.liability);
  requireExactRecord(state.exposure, [
    'borrowedPrincipal', 'accruedInterest', 'totalLiability', 'marginSaleFilled',
    'futuresEntryFilled', 'marginCoverFilled', 'futuresExitFilled',
    'marginShortRemaining', 'futuresLongRemaining', 'hedgeDriftQuantity',
    'grossOpenQuantity',
  ], 'state exposure');
  if (state.orders.length > MAX_ORDERS) throw new RangeError('state order bound exceeded');
  const orderMap = new Map<string, ReverseBasisOrderProjection>();
  const logicalOrders = new Set<string>();
  const globalFillIds = new Set<string>();
  const stateMutationTimeReasons: string[] = [];
  for (const order of state.orders) {
    requireExactRecord(order, [
      'orderRef', 'role', 'accountRealmId', 'accountOrderId', 'mutationState',
      'mutationEvidenceRevision', 'liabilityBasis', 'policyPlanRevision',
      'policyActionId', 'mechanicsAuthority',
      'twinFixtureId', 'twinScenarioRevision', 'twinOutcomeRevision',
      'twinOrderRevision', 'venueStatus', 'localTruth', 'requestedQuantity',
      'filledQuantity', 'filledNotionalQuote', 'remainingQuantity',
      'expiredQuantity', 'fillIds', 'open', 'ambiguous', 'observedAtMs',
      'venueEffectAtMs', 'dispatchAtMs', 'firstEventOccurredAtMs',
      'lastEventOccurredAtMs',
    ], 'state order projection');
    for (const value of [
      order.orderRef, order.policyPlanRevision, order.policyActionId,
      order.mutationEvidenceRevision,
      order.twinFixtureId, order.twinScenarioRevision, order.twinOutcomeRevision,
      order.twinOrderRevision,
    ]) requireId(value, 'state order identity');
    if (order.accountOrderId !== null) requireId(order.accountOrderId, 'state account order ID');
    validateLiabilityObservation(order.liabilityBasis, state.ticket);
    retainLiabilityRevision(order.liabilityBasis);
    if (
      state.borrow?.state !== 'CONFIRMED'
      || state.initialLiability === null
      || order.liabilityBasis.repayStatus === 'ZERO_CONFIRMED'
      || order.liabilityBasis.principal !== state.borrow.confirmedPrincipal
      || order.liabilityBasis.principal !== state.initialLiability.principal
      || order.liabilityBasis.totalLiability === '0'
      || order.liabilityBasis.observedAtMs < state.initialLiability.observedAtMs
      || compareReverseBasisDecimals(
        order.liabilityBasis.accruedInterest,
        state.initialLiability.accruedInterest,
      ) < 0
      || compareReverseBasisDecimals(
        order.liabilityBasis.totalLiability,
        state.initialLiability.totalLiability,
      ) < 0
      || (state.repayBasis !== null && (
        order.liabilityBasis.observedAtMs > state.repayBasis.observedAtMs
        || compareReverseBasisDecimals(
          order.liabilityBasis.accruedInterest,
          state.repayBasis.accruedInterest,
        ) > 0
        || compareReverseBasisDecimals(
          order.liabilityBasis.totalLiability,
          state.repayBasis.totalLiability,
        ) > 0
      ))
    ) throw new TypeError('state order liability basis is outside the outstanding borrow chain');
    if (!MARGIN_ROLES.has(order.role) && !FUTURES_ROLES.has(order.role)) {
      throw new TypeError('state order role is invalid');
    }
    if (!['CONFIRMED', 'REJECTED_NO_EFFECT_PROVEN', 'UNKNOWN'].includes(order.mutationState)) {
      throw new TypeError('state order mutation state is invalid');
    }
    if (!['NOT_ARRIVED', 'BLOCKED', 'NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'EXPIRED']
      .includes(order.venueStatus)) throw new TypeError('state venue status is invalid');
    if (![
      'NOT_DISPATCHED', 'DISPATCHED', 'ACKNOWLEDGED', 'UNKNOWN', 'OBSERVED',
      'RECOVERY_REQUIRED',
    ].includes(order.localTruth)) throw new TypeError('state local truth is invalid');
    const marginRole = MARGIN_ROLES.has(order.role);
    if (
      order.accountRealmId !== (marginRole
        ? state.ticket.account.accountRealmId : state.ticket.account.futuresAccountRealmId)
      || order.mechanicsAuthority !== (marginRole
        ? 'L07_SPOT_MARKET_MECHANICS_ONLY' : 'L07_USDM_MECHANICS')
    ) throw new TypeError('state order realm/mechanics mapping is invalid');
    if (
      (order.mutationState === 'CONFIRMED' && order.accountOrderId === null)
      || (order.mutationState !== 'CONFIRMED' && order.accountOrderId !== null)
    ) throw new TypeError('state account-order identity conflicts with mutation truth');
    const terminalVenue = ['FILLED', 'CANCELED', 'EXPIRED'].includes(order.venueStatus);
    const necessarilyAmbiguous = order.mutationState === 'UNKNOWN'
      || order.localTruth === 'UNKNOWN'
      || order.localTruth === 'RECOVERY_REQUIRED'
      || (order.mutationState === 'CONFIRMED'
        && (!terminalVenue || order.localTruth !== 'OBSERVED'));
    if (necessarilyAmbiguous && !order.ambiguous) {
      throw new TypeError('state order hides ambiguous local or mutation truth');
    }
    for (const value of [
      order.requestedQuantity, order.filledQuantity, order.filledNotionalQuote,
      order.remainingQuantity, order.expiredQuantity,
    ]) reverseBasisDecimal(value, 'state order decimal');
    if (sumReverseBasisDecimals([
      order.filledQuantity, order.remainingQuantity, order.expiredQuantity,
    ]) !== order.requestedQuantity) {
      throw new TypeError('state order quantity conservation failed');
    }
    if (
      (order.mutationState === 'REJECTED_NO_EFFECT_PROVEN'
        && (order.filledQuantity !== '0'
          || (order.venueStatus !== 'BLOCKED' && order.venueStatus !== 'NOT_ARRIVED')))
      || ((order.venueStatus === 'BLOCKED' || order.venueStatus === 'NOT_ARRIVED')
        && order.filledQuantity !== '0')
      || (order.venueStatus === 'FILLED'
        && (order.remainingQuantity !== '0' || order.expiredQuantity !== '0'))
      || (order.filledQuantity === '0' && order.fillIds.length > 0)
      || (order.filledQuantity !== '0' && order.fillIds.length === 0)
    ) throw new TypeError('state order mutation/venue/fill truth is inconsistent');
    if (order.open !== (order.venueStatus === 'NEW' || order.venueStatus === 'PARTIALLY_FILLED')) {
      throw new TypeError('state order open flag conflicts with venue status');
    }
    if (order.observedAtMs !== null) requireUtc(order.observedAtMs, 'state order observation time');
    if (order.venueEffectAtMs !== null) requireUtc(order.venueEffectAtMs, 'state order venue time');
    if (order.dispatchAtMs !== null) requireUtc(order.dispatchAtMs, 'state order dispatch time');
    requireUtc(order.firstEventOccurredAtMs, 'state order first event time');
    requireUtc(order.lastEventOccurredAtMs, 'state order last event time');
    if (
      (order.observedAtMs !== null && order.observedAtMs > state.evaluatedAtMs)
      || (order.venueEffectAtMs !== null && order.venueEffectAtMs > state.evaluatedAtMs)
      || (order.dispatchAtMs !== null && order.dispatchAtMs > state.evaluatedAtMs)
      || order.firstEventOccurredAtMs > state.evaluatedAtMs
      || order.lastEventOccurredAtMs > state.evaluatedAtMs
    ) throw new TypeError('state order time is in the future');
    if (
      (order.dispatchAtMs !== null && order.venueEffectAtMs !== null
        && order.dispatchAtMs > order.venueEffectAtMs)
      || (order.venueEffectAtMs !== null && order.observedAtMs !== null
        && order.venueEffectAtMs > order.observedAtMs)
    ) throw new TypeError('state order dispatch/venue/observation chronology is invalid');
    if (
      order.firstEventOccurredAtMs > order.lastEventOccurredAtMs
      || (order.dispatchAtMs !== null && order.dispatchAtMs > order.firstEventOccurredAtMs)
      || (order.observedAtMs !== null && order.observedAtMs > order.lastEventOccurredAtMs)
      || (order.venueEffectAtMs !== null && order.venueEffectAtMs > order.lastEventOccurredAtMs)
    ) throw new TypeError('state order event envelope does not cover its L07 truth');
    for (const atMs of stableUnique([
      String(order.firstEventOccurredAtMs),
      String(order.lastEventOccurredAtMs),
    ]).map(Number)) {
      stateMutationTimeReasons.push(...ownerTruthReasonsAt({
        ticket: state.ticket,
        preflight: state.preflight,
      } as ReverseBasisLifecycleInput, atMs, 'ORDER'));
    }
    if (
      (order.role === 'MARGIN_ENTRY_SELL' || order.role === 'FUTURES_ENTRY_HEDGE')
      && order.lastEventOccurredAtMs > state.ticket.expiresAtMs
    ) stateMutationTimeReasons.push(`ENTRY_AFTER_TICKET_EXPIRY:${order.orderRef}`);
    if (order.dispatchAtMs !== null && (
      order.liabilityBasis.observedAtMs > order.dispatchAtMs
      || order.dispatchAtMs > order.liabilityBasis.validUntilMs
    )) throw new TypeError('state order dispatch is outside its persisted liability basis window');
    if (orderMap.has(order.orderRef)) throw new TypeError('state order reference is duplicated');
    const logicalKey = `${order.policyPlanRevision}:${order.policyActionId}`;
    if (logicalOrders.has(logicalKey)) throw new TypeError('state logical policy order is duplicated');
    logicalOrders.add(logicalKey);
    for (const fillId of order.fillIds) {
      requireId(fillId, 'state fill ID');
      if (globalFillIds.has(fillId)) throw new TypeError('state fill ID is duplicated');
      globalFillIds.add(fillId);
    }
    orderMap.set(order.orderRef, order);
  }
  for (const earlier of state.orders) {
    for (const later of state.orders) {
      if (earlier.firstEventOccurredAtMs >= later.firstEventOccurredAtMs) continue;
      if (
        later.liabilityBasis.observedAtMs < earlier.liabilityBasis.observedAtMs
        || compareReverseBasisDecimals(
          later.liabilityBasis.accruedInterest,
          earlier.liabilityBasis.accruedInterest,
        ) < 0
        || compareReverseBasisDecimals(
          later.liabilityBasis.totalLiability,
          earlier.liabilityBasis.totalLiability,
        ) < 0
      ) throw new TypeError('state order liability chain regresses before repayment');
    }
  }
  const roleTime = (
    roles: readonly ReverseBasisOrderRole[],
    field: 'dispatchAtMs' | 'venueEffectAtMs' | 'observedAtMs',
  ): number => state.orders.filter((order) => roles.includes(order.role))
    .reduce((latest, order) => Math.max(latest, order[field] ?? 0), 0);
  const latestProjectedOrderTime = state.orders.reduce((latest, order) => Math.max(
    latest,
    order.observedAtMs ?? 0,
    order.venueEffectAtMs ?? 0,
    order.dispatchAtMs ?? 0,
    order.lastEventOccurredAtMs,
  ), 0);
  if (
    state.lastOrderOccurredAtMs !== null
    && state.lastOrderOccurredAtMs !== latestProjectedOrderTime
  ) {
    throw new TypeError('state last-order time does not exactly bind projected event truth');
  }
  const marginEntryObserved = roleTime(['MARGIN_ENTRY_SELL'], 'observedAtMs');
  const marginEntryEffect = roleTime(['MARGIN_ENTRY_SELL'], 'venueEffectAtMs');
  const futuresEntryObserved = roleTime(['FUTURES_ENTRY_HEDGE'], 'observedAtMs');
  const futuresEntryEffect = roleTime(['FUTURES_ENTRY_HEDGE'], 'venueEffectAtMs');
  const marginCoverObserved = roleTime(
    ['MARGIN_EXIT_COVER', 'RECOVERY_MARGIN_COVER'],
    'observedAtMs',
  );
  const marginCoverEffect = roleTime(
    ['MARGIN_EXIT_COVER', 'RECOVERY_MARGIN_COVER'],
    'venueEffectAtMs',
  );
  const hasMarginEntry = state.orders.some((order) => (
    order.role === 'MARGIN_ENTRY_SELL' && order.dispatchAtMs !== null
  ));
  const hasFuturesEntry = state.orders.some((order) => (
    order.role === 'FUTURES_ENTRY_HEDGE' && order.dispatchAtMs !== null
  ));
  const hasMarginCover = state.orders.some((order) => (
    (order.role === 'MARGIN_EXIT_COVER' || order.role === 'RECOVERY_MARGIN_COVER')
    && order.dispatchAtMs !== null
  ));
  const hasFuturesExit = state.orders.some((order) => (
    (order.role === 'FUTURES_EXIT_CLOSE' || order.role === 'RECOVERY_FUTURES_ADJUST')
    && order.dispatchAtMs !== null
  ));
  if (
    (hasMarginEntry && roleTime(['MARGIN_ENTRY_SELL'], 'dispatchAtMs') < Math.max(
      state.borrowOccurredAtMs ?? 0,
      state.initialLiability?.observedAtMs ?? 0,
    ))
    || (hasFuturesEntry && (
      roleTime(['FUTURES_ENTRY_HEDGE'], 'dispatchAtMs') < marginEntryObserved
      || futuresEntryEffect < marginEntryEffect
    ))
    || (hasMarginCover && (
      roleTime(['MARGIN_EXIT_COVER', 'RECOVERY_MARGIN_COVER'], 'dispatchAtMs')
        < Math.max(marginEntryObserved, futuresEntryObserved)
      || marginCoverEffect < Math.max(marginEntryEffect, futuresEntryEffect)
    ))
    || (hasFuturesExit && (
      roleTime(['FUTURES_EXIT_CLOSE', 'RECOVERY_FUTURES_ADJUST'], 'dispatchAtMs')
        < marginCoverObserved
      || roleTime(['FUTURES_EXIT_CLOSE', 'RECOVERY_FUTURES_ADJUST'], 'venueEffectAtMs')
        < marginCoverEffect
    ))
  ) throw new TypeError('state order cross-leg chronology is invalid');
  const recoveryRefs = new Set<string>();
  const recoveryActions = new Set<string>();
  const recoveryActionEvidence = new Set<string>();
  const stateRecoveryAnomalies: string[] = [];
  for (const recovery of state.recoveryEvidence) {
    requireExactRecord(recovery, [
      'recoveryRef', 'policyPlanRevision', 'policyActionId', 'riskMeasureBefore',
      'riskMeasureAfter', 'grossNotionalAfter', 'recoveryCostQuote',
      'liquidityState', 'collateralRevision', 'evidenceRevision',
      'targetExposureRevision', 'occurredAtMs',
    ], 'state recovery evidence');
    for (const value of [
      recovery.recoveryRef, recovery.policyPlanRevision, recovery.policyActionId,
      recovery.collateralRevision, recovery.evidenceRevision,
      recovery.targetExposureRevision,
    ]) requireId(value, 'state recovery identity');
    for (const value of [
      recovery.riskMeasureBefore, recovery.riskMeasureAfter,
      recovery.grossNotionalAfter, recovery.recoveryCostQuote,
    ]) reverseBasisDecimal(value, 'state recovery decimal');
    requireUtc(recovery.occurredAtMs, 'state recovery occurrence time');
    if (recovery.occurredAtMs > state.evaluatedAtMs) {
      throw new TypeError('state recovery occurrence is in the future');
    }
    stateMutationTimeReasons.push(...ownerTruthReasonsAt({
      ticket: state.ticket,
      preflight: state.preflight,
    } as ReverseBasisLifecycleInput, recovery.occurredAtMs, 'RECOVERY'));
    if (compareReverseBasisDecimals(recovery.riskMeasureAfter, recovery.riskMeasureBefore) >= 0) {
      stateRecoveryAnomalies.push('RECOVERY_NOT_RISK_REDUCING');
    }
    if (compareReverseBasisDecimals(
      recovery.grossNotionalAfter,
      state.ticket.maxRecoveryGrossNotionalQuote,
    ) > 0) stateRecoveryAnomalies.push('RECOVERY_GROSS_LIMIT_EXCEEDED');
    if (compareReverseBasisDecimals(
      recovery.recoveryCostQuote,
      state.ticket.maxRecoveryCostQuote,
    ) > 0) stateRecoveryAnomalies.push('RECOVERY_COST_LIMIT_EXCEEDED');
    if (recovery.liquidityState !== 'AVAILABLE') {
      stateRecoveryAnomalies.push(`RECOVERY_LIQUIDITY_${recovery.liquidityState}`);
    }
    if (recovery.collateralRevision !== state.collateral.collateralRevision) {
      stateRecoveryAnomalies.push('RECOVERY_COLLATERAL_REVISION_MISMATCH');
    }
    const actionEvidenceKey = `${recovery.policyActionId}:${recovery.evidenceRevision}`;
    if (recoveryRefs.has(recovery.recoveryRef)
      || recoveryActions.has(recovery.policyActionId)
      || recoveryActionEvidence.has(actionEvidenceKey)) {
      throw new TypeError('state recovery evidence identity/action is duplicated');
    }
    recoveryRefs.add(recovery.recoveryRef);
    recoveryActions.add(recovery.policyActionId);
    recoveryActionEvidence.add(actionEvidenceKey);
  }
  if (
    (state.recoveryEvidence.length === 0) !== (state.recoveryBatchTargetRevision === null)
    || (state.recoveryBatchTargetRevision !== null
      && state.recoveryEvidence.some((item) => (
        item.targetExposureRevision !== state.recoveryBatchTargetRevision
      )))
  ) throw new TypeError('state recovery evidence does not share one frozen batch target');
  if (state.recoveryBatchTargetRevision !== null) {
    requireId(state.recoveryBatchTargetRevision, 'state recovery batch target');
  }
  const validationLifecycle: MutableLifecycle = {
    borrow: state.borrow, initialLiability: state.initialLiability,
    liability: state.liability, repay: state.repay,
    repayBasis: state.repayBasis,
    orders: orderMap, recoveryEvidence: [...state.recoveryEvidence],
    recoveryBatchTargetRevision: state.recoveryBatchTargetRevision,
    closureEvidence: state.closureEvidence, manualIntervention: state.manualIntervention,
    nakedRiskStartedAtMs: state.nakedRiskStartedAtMs,
    nakedRiskLimitBreached: state.nakedRiskLimitBreached,
    borrowOccurredAtMs: state.borrowOccurredAtMs,
    repayOccurredAtMs: state.repayOccurredAtMs,
    lastOrderOccurredAtMs: state.lastOrderOccurredAtMs,
  };
  const expectedExposure = computeExposure(validationLifecycle);
  const roleOrders = (role: ReverseBasisOrderRole): readonly ReverseBasisOrderProjection[] => (
    state.orders.filter((order) => order.role === role)
  );
  for (const role of [...MARGIN_ROLES, ...FUTURES_ROLES]) {
    if (roleOrders(role).length > 1) {
      throw new TypeError('state contains more than one logical order for a lifecycle role');
    }
  }
  const confirmedPrincipal = state.borrow?.state === 'CONFIRMED'
    ? state.borrow.confirmedPrincipal : null;
  if (state.orders.length > 0 && confirmedPrincipal === null) {
    throw new TypeError('state order truth lacks confirmed borrowed principal');
  }
  if (confirmedPrincipal !== null && state.orders.some((order) => (
    compareReverseBasisDecimals(order.requestedQuantity, confirmedPrincipal) > 0
  ))) throw new TypeError('state order request exceeds confirmed borrowed principal');
  const marginEntry = roleOrders('MARGIN_ENTRY_SELL')[0];
  const futuresEntry = roleOrders('FUTURES_ENTRY_HEDGE')[0];
  const marginExit = roleOrders('MARGIN_EXIT_COVER')[0];
  const futuresExit = roleOrders('FUTURES_EXIT_CLOSE')[0];
  if (marginEntry !== undefined && (
    confirmedPrincipal === null
    || marginEntry.requestedQuantity !== confirmedPrincipal
    || compareReverseBasisDecimals(marginEntry.filledQuantity, confirmedPrincipal) > 0
  )) throw new TypeError('state Margin entry does not exactly bind confirmed borrowed principal');
  if (futuresEntry !== undefined && compareReverseBasisDecimals(
    futuresEntry.requestedQuantity,
    expectedExposure.marginSaleFilled,
  ) > 0) throw new TypeError('state Futures entry request exceeds actual Margin sale fill');
  if (marginExit !== undefined
    && marginExit.requestedQuantity !== expectedExposure.marginSaleFilled) {
    throw new TypeError('state normal Margin cover does not bind the actual Margin sale fill');
  }
  if (futuresExit !== undefined
    && futuresExit.requestedQuantity !== expectedExposure.marginCoverFilled) {
    throw new TypeError('state normal Futures close does not bind the actual Margin cover fill');
  }
  if (
    (confirmedPrincipal !== null && compareReverseBasisDecimals(
      expectedExposure.marginSaleFilled,
      confirmedPrincipal,
    ) > 0)
    || compareReverseBasisDecimals(
      expectedExposure.futuresEntryFilled,
      expectedExposure.marginSaleFilled,
    ) > 0
    || compareReverseBasisDecimals(
      expectedExposure.marginCoverFilled,
      expectedExposure.marginSaleFilled,
    ) > 0
    || compareReverseBasisDecimals(
      expectedExposure.futuresExitFilled,
      expectedExposure.futuresEntryFilled,
    ) > 0
  ) throw new TypeError('state order fills exceed the borrow or paired-leg quantity bounds');
  const entryGrossNotional = sumReverseBasisDecimals(state.orders
    .filter((order) => (
      order.role === 'MARGIN_ENTRY_SELL' || order.role === 'FUTURES_ENTRY_HEDGE'
    ))
    .map((order) => order.filledNotionalQuote));
  const entryNakedDurationBreached = marginEntry?.venueEffectAtMs !== null
    && marginEntry?.venueEffectAtMs !== undefined
    && futuresEntry !== undefined
    && futuresEntry.firstEventOccurredAtMs - marginEntry.venueEffectAtMs
      > state.ticket.maxNakedDurationMs;
  const exitNakedDurationBreached = marginExit?.venueEffectAtMs !== null
    && marginExit?.venueEffectAtMs !== undefined
    && futuresExit !== undefined
    && futuresExit.firstEventOccurredAtMs - marginExit.venueEffectAtMs
      > state.ticket.maxNakedDurationMs;
  const derivedNakedRiskBreach = (
    compareReverseBasisDecimals(
      expectedExposure.marginSaleFilled,
      state.ticket.maxNakedQuantity,
    ) > 0
    || compareReverseBasisDecimals(
      expectedExposure.marginCoverFilled,
      state.ticket.maxNakedQuantity,
    ) > 0
    || state.orders.some((order) => MARGIN_ROLES.has(order.role)
      && compareReverseBasisDecimals(
        order.filledNotionalQuote,
        state.ticket.maxNakedNotionalQuote,
      ) > 0)
    || compareReverseBasisDecimals(entryGrossNotional, state.ticket.maxGrossNotionalQuote) > 0
    || entryNakedDurationBreached
    || exitNakedDurationBreached
  );
  if (derivedNakedRiskBreach && !state.nakedRiskLimitBreached) {
    throw new TypeError('state hides a derived naked-risk or gross-notional limit breach');
  }
  if (canonicalJson(expectedExposure) !== canonicalJson(state.exposure)) {
    throw new TypeError('state exposure does not derive from liability and order truth');
  }
  if (state.recoveryBatchTargetRevision !== null) {
    const beforeRecoveryLifecycle: MutableLifecycle = {
      borrow: state.borrow,
      initialLiability: state.initialLiability,
      liability: state.repayBasis ?? state.liability,
      repay: null,
      repayBasis: null,
      orders: new Map([...orderMap.entries()].filter(([, order]) => (
        !order.role.startsWith('RECOVERY_')
      ))),
      recoveryEvidence: [],
      recoveryBatchTargetRevision: null,
      closureEvidence: null,
      manualIntervention: null,
      nakedRiskStartedAtMs: null,
      nakedRiskLimitBreached: false,
      borrowOccurredAtMs: state.borrowOccurredAtMs,
      repayOccurredAtMs: null,
      lastOrderOccurredAtMs: null,
    };
    if (deriveReverseBasisExposureRevision(computeExposure(beforeRecoveryLifecycle))
      !== state.recoveryBatchTargetRevision) {
      throw new TypeError('state recovery batch target does not bind pre-recovery exposure');
    }
    for (const order of state.orders.filter((item) => item.role.startsWith('RECOVERY_'))) {
      if (!state.recoveryEvidence.some((evidence) => (
        evidence.policyActionId === order.policyActionId
        && evidence.targetExposureRevision === state.recoveryBatchTargetRevision
      ))) throw new TypeError('state recovery order lacks its frozen-batch evidence');
    }
  }
  const expectedUnmatchedSafetyRefs: string[] = [];
  if (compareReverseBasisDecimals(
    state.exposure.marginCoverFilled,
    state.exposure.marginSaleFilled,
  ) > 0) expectedUnmatchedSafetyRefs.push('margin-cover-exceeds-sale');
  if (compareReverseBasisDecimals(
    state.exposure.futuresExitFilled,
    state.exposure.futuresEntryFilled,
  ) > 0) expectedUnmatchedSafetyRefs.push('futures-exit-exceeds-entry');
  for (const list of [
    state.openOrderRefs, state.ambiguousMutationRefs, state.unmatchedFillRefs,
    state.reasonCodes,
  ]) {
    if (canonicalJson(list) !== canonicalJson(stableUnique(list))) {
      throw new TypeError('state reference/reason set is not canonical');
    }
  }
  for (const reason of stableUnique(stateRecoveryAnomalies)) {
    if (!state.reasonCodes.includes(reason)) {
      throw new TypeError('state hides a recovery-evidence validation reason');
    }
  }
  for (const reason of stableUnique(stateBorrowTimeReasons)) {
    if (!state.reasonCodes.includes(reason)) {
      throw new TypeError('state hides a borrow-time owner/quote validation reason');
    }
  }
  for (const reason of stableUnique(stateMutationTimeReasons)) {
    if (!state.reasonCodes.includes(reason)) {
      throw new TypeError('state hides an order/recovery-time owner validation reason');
    }
  }
  for (const ref of expectedUnmatchedSafetyRefs) {
    if (!state.unmatchedFillRefs.includes(ref)) {
      throw new TypeError('state hides an overfill/unmatched safety reference');
    }
  }
  const expectedOpenRefs = stableUnique([
    ...state.orders.filter((order) => order.open).map((order) => order.orderRef),
    ...(state.closureEvidence?.openOrderRefs ?? []),
  ]);
  const expectedAmbiguousRefs = stableUnique([
    ...(state.borrow?.state === 'UNKNOWN' ? [`borrow:${state.borrow.evidenceRevision}`] : []),
    ...(state.repay?.state === 'UNKNOWN' ? [`repay:${state.repay.evidenceRevision}`] : []),
    ...state.orders.filter((order) => order.ambiguous || order.mutationState === 'UNKNOWN')
      .map((order) => order.orderRef),
    ...(state.closureEvidence?.ambiguousMutationRefs ?? []),
  ]);
  if (canonicalJson(expectedOpenRefs) !== canonicalJson(state.openOrderRefs)
    || canonicalJson(expectedAmbiguousRefs) !== canonicalJson(state.ambiguousMutationRefs)) {
    throw new TypeError('state open/ambiguous references do not derive from mutation truth');
  }
  const processedSequences = new Set<number>();
  const processedIds = new Set<string>();
  let previousProcessedSequence = 0;
  for (const processed of state.processedEvents) {
    requireExactRecord(processed, [
      'eventId', 'sequence', 'kind', 'eventRevision', 'stageAfter',
    ], 'processed event');
    requireId(processed.eventId, 'processed event ID');
    requireId(processed.eventRevision, 'processed event revision');
    requirePositiveInteger(processed.sequence, 'processed event sequence', 1_000_000);
    if (!EVENT_KINDS.has(processed.kind) || !LIFECYCLE_STAGES.has(processed.stageAfter)) {
      throw new TypeError('processed event kind/stage is invalid');
    }
    if (processed.sequence <= previousProcessedSequence) {
      throw new TypeError('processed event sequence is not canonical');
    }
    if (processedSequences.has(processed.sequence) || processedIds.has(processed.eventId)) {
      throw new TypeError('processed event identity/sequence is duplicated');
    }
    processedSequences.add(processed.sequence);
    processedIds.add(processed.eventId);
    previousProcessedSequence = processed.sequence;
  }
  if (state.nakedRiskStartedAtMs !== null) requireUtc(state.nakedRiskStartedAtMs, 'naked risk start');
  if (state.exposure.hedgeDriftQuantity === '0' && state.nakedRiskStartedAtMs !== null) {
    throw new TypeError('state retains a naked-risk clock without hedge drift');
  }
  if ((state.repay === null) !== (state.repayBasis === null)) {
    throw new TypeError('state repay truth lacks its exact pre-repay liability basis');
  }
  if (state.repayBasis !== null && state.repayOccurredAtMs !== null && (
    state.repayBasis.observedAtMs > state.repayOccurredAtMs
    || state.repayOccurredAtMs > state.repayBasis.validUntilMs
  )) throw new TypeError('state repay occurrence is outside its exact liability basis window');
  if (state.initialLiability !== null && state.repayBasis !== null && (
    state.repayBasis.principal !== state.initialLiability.principal
    || state.repayBasis.observedAtMs < state.initialLiability.observedAtMs
    || compareReverseBasisDecimals(
      state.repayBasis.accruedInterest,
      state.initialLiability.accruedInterest,
    ) < 0
    || compareReverseBasisDecimals(
      state.repayBasis.totalLiability,
      state.initialLiability.totalLiability,
    ) < 0
  )) throw new TypeError('state repay basis regresses initial principal or accrued interest truth');
  if ((state.stage === 'MANUAL_INTERVENTION') !== (state.manualIntervention !== null)) {
    throw new TypeError('state manual-intervention stage/evidence mismatch');
  }
  for (const value of [
    state.exposure.borrowedPrincipal,
    state.exposure.accruedInterest,
    state.exposure.totalLiability,
    state.exposure.marginSaleFilled,
    state.exposure.futuresEntryFilled,
    state.exposure.marginCoverFilled,
    state.exposure.futuresExitFilled,
    state.exposure.marginShortRemaining,
    state.exposure.futuresLongRemaining,
    state.exposure.hedgeDriftQuantity,
    state.exposure.grossOpenQuantity,
  ]) if (value !== null) reverseBasisDecimal(value, 'state exposure');
  if (state.stage === 'CLOSED' || state.stage === 'RECOVERED') {
    const closure = state.closureEvidence;
    const orderRevisions = stableUnique(state.orders.map((order) => order.twinOrderRevision));
    if (
      state.exposure.borrowedPrincipal !== '0'
      || state.preflightPassed !== true
      || state.exposure.accruedInterest !== '0'
      || state.exposure.totalLiability !== '0'
      || state.exposure.marginShortRemaining !== '0'
      || state.exposure.futuresLongRemaining !== '0'
      || state.exposure.hedgeDriftQuantity !== '0'
      || state.exposure.marginSaleFilled !== state.exposure.futuresEntryFilled
      || state.exposure.marginCoverFilled !== state.exposure.futuresExitFilled
      || state.openOrderRefs.length > 0
      || state.ambiguousMutationRefs.length > 0
      || state.unmatchedFillRefs.length > 0
      || state.orders.some((order) => order.open || order.ambiguous)
      || state.manualIntervention !== null
      || state.liability?.repayStatus !== 'ZERO_CONFIRMED'
      || state.liability?.principal !== '0'
      || state.liability?.accruedInterest !== '0'
      || state.liability?.totalLiability !== '0'
      || state.liability.observedAtMs > state.evaluatedAtMs
      || state.evaluatedAtMs > state.liability.validUntilMs
      || state.borrow?.state !== 'CONFIRMED'
      || state.initialLiability === null
      || state.initialLiability.principal !== state.borrow.confirmedPrincipal
      || state.repay?.state !== 'CONFIRMED'
      || state.repayBasis === null
      || state.repayBasis.principal !== state.borrow.confirmedPrincipal
      || state.repayBasis.totalLiability === '0'
      || state.repay.requestedRepayAmount !== state.repayBasis.totalLiability
      || state.repay.confirmedRepayAmount !== state.repayBasis.totalLiability
      || state.repay.liabilityRevision !== state.liability.liabilityRevision
      || (state.lastOrderOccurredAtMs !== null && (
        (state.borrowOccurredAtMs ?? 0) > state.lastOrderOccurredAtMs
        || state.lastOrderOccurredAtMs > (state.repayOccurredAtMs ?? 0)
      ))
      || closure?.state !== 'EXACT'
      || closure.observedAtMs > state.evaluatedAtMs
      || state.evaluatedAtMs > closure.validUntilMs
      || closure.liabilityRevision !== state.liability.liabilityRevision
      || closure.borrowTransactionId !== state.borrow.transactionId
      || closure.repayTransactionId !== state.repay.transactionId
      || canonicalJson(stableUnique(closure.orderStateRevisions)) !== canonicalJson(orderRevisions)
      || closure.observedAtMs < state.liability.observedAtMs
      || closure.observedAtMs < (state.lastOrderOccurredAtMs ?? 0)
      || closure.observedAtMs < (state.repayOccurredAtMs ?? 0)
      || state.orders.some((order) => (
        order.observedAtMs !== null && closure.observedAtMs < order.observedAtMs
      ))
      || state.nakedRiskLimitBreached
      || state.reasonCodes.some((reason) => !reason.startsWith('ORDER_REJECTED:'))
    ) throw new TypeError('terminal reverse-basis state hides debt, exposure or ambiguity');
    const recoveredWitness = state.recoveryEvidence.length > 0
      || state.orders.some((order) => order.role.startsWith('RECOVERY_'))
      || state.repay.source === 'EXTERNAL_MANUAL';
    if ((state.stage === 'RECOVERED') !== recoveredWitness) {
      throw new TypeError('terminal stage does not match its recovery witness');
    }
    if (state.stage === 'CLOSED' && state.exposure.marginSaleFilled === '0') {
      throw new TypeError('normal CLOSED state lacks the four-leg entry/exit proof');
    }
    if (state.stage === 'CLOSED' && state.reasonCodes.length > 0) {
      throw new TypeError('normal CLOSED state retains a lifecycle reason');
    }
  }
  return true;
}

export function checkpointReverseBasisLifecycle(stateValue: unknown): Readonly<ReverseBasisCheckpoint> {
  validateReverseBasisLifecycleState(stateValue);
  const state = clonePlain(stateValue) as ReverseBasisLifecycleState;
  const material = {
    schema: REVERSE_BASIS_CHECKPOINT_SCHEMA,
    state,
    ...REVERSE_BASIS_NO_ACTION_AUTHORITY,
  } as const;
  return deepFreeze({
    ...material,
    checkpointRevision: digest('l10checkpoint_', material),
  });
}

export function restoreReverseBasisLifecycle(checkpointValue: unknown): Readonly<ReverseBasisLifecycleState> {
  const checkpoint = clonePlain(checkpointValue) as ReverseBasisCheckpoint;
  requireExactRecord(checkpoint, [
    'schema', 'state', 'checkpointRevision', 'simulationAuthority', 'sendEligible',
    'privateReadAuthority', 'mutationAuthority', 'actionAuthority',
    'externalActionAuthorization',
  ], 'reverse-basis checkpoint');
  if (checkpoint.schema !== REVERSE_BASIS_CHECKPOINT_SCHEMA) {
    throw new TypeError('reverse-basis checkpoint schema is invalid');
  }
  requireAuthority(checkpoint as unknown as Record<string, unknown>, 'reverse-basis checkpoint');
  requireId(checkpoint.checkpointRevision, 'checkpointRevision');
  const { checkpointRevision, ...material } = checkpoint;
  if (digest('l10checkpoint_', material) !== checkpointRevision) {
    throw new TypeError('reverse-basis checkpoint revision mismatch');
  }
  validateReverseBasisLifecycleState(checkpoint.state);
  return deepFreeze(clonePlain(checkpoint.state));
}

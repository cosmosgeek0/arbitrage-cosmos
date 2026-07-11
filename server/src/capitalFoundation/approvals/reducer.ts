import {
  capitalDigest,
  compareExactDecimals,
  type ApprovalValidationContext,
  type OperatorApproval,
} from '../contracts/index.js';
import {
  createStructuredFailure,
  fail,
  isValidUtcMillis,
  ok,
  type ContractResult,
} from '../../foundation/contracts/index.js';
import type { OperatorApprovalState, OperatorApprovalStateEvent } from './types.js';
import { validateOperatorApproval } from './validation.js';

const COMPONENT = 'capitalFoundation.approvals.reducer';

function freezeApproval(approval: Readonly<OperatorApproval>): Readonly<OperatorApproval> {
  return Object.freeze({
    ...approval,
    symbols: Object.freeze([...approval.symbols]),
    instruments: Object.freeze([...approval.instruments]),
    allowedActionClasses: Object.freeze([...approval.allowedActionClasses]),
    stageLimits: Object.freeze(approval.stageLimits.map((limit) => Object.freeze({ ...limit }))),
  });
}

export function createOperatorApprovalState(
  approval: Readonly<OperatorApproval>,
  sourcePolicyDigest: string,
): Readonly<OperatorApprovalState> {
  const issues = validateOperatorApproval(approval);
  if (issues.length > 0) throw new TypeError(`createOperatorApprovalState: ${issues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`);
  if (typeof sourcePolicyDigest !== 'string' || sourcePolicyDigest.trim() !== sourcePolicyDigest || sourcePolicyDigest.length === 0 || sourcePolicyDigest.length > 256) {
    throw new TypeError('createOperatorApprovalState: source policy digest must be bounded and non-empty');
  }
  return Object.freeze({ approval: freezeApproval(approval), sourcePolicyDigest, revision: 1, uses: Object.freeze([]) });
}

function reject<T>(event: OperatorApprovalStateEvent, code: string, message: string): ContractResult<T> {
  const occurredAt = event.kind === 'REVOKED' ? event.revokedAtMs : event.recordedAtMs;
  return fail(createStructuredFailure({
    component: COMPONENT,
    stage: event.kind,
    code,
    message,
    occurredAt,
    retryable: false,
    safeCurrentState: 'APPROVAL_UNCHANGED',
    recommendedOperatorAction: 'Reload current approval state and issue an event bound to its exact revision and scope.',
    correlationId: event.correlationId,
  }));
}

function contextMatchesApproval(approval: Readonly<OperatorApproval>, context: Readonly<ApprovalValidationContext>): boolean {
  const stageLimit = context.stage === null
    ? null
    : approval.stageLimits.find((limit) => limit.stage === context.stage) ?? null;
  return approval.proposalId === context.proposalId
    && approval.proposalRevision === context.proposalRevision
    && approval.proposalIntakeDigest === context.proposalIntakeDigest
    && approval.mandateId === context.mandateId
    && approval.mandateRevision === context.mandateRevision
    && approval.mandateDigest === context.mandateDigest
    && approval.stagedPlanId === context.stagedPlanId
    && approval.stagedPlanRevision === context.stagedPlanRevision
    && approval.stagedPlanDigest === context.stagedPlanDigest
    && approval.configRevision === context.configRevision
    && approval.useScopeKey === context.useScopeKey
    && approval.allowedActionClasses.includes(context.actionClass)
    && compareExactDecimals(context.requestedNotional, approval.maximumNotional) <= 0
    && (approval.stageLimits.length === 0 || (stageLimit !== null && compareExactDecimals(context.requestedNotional, stageLimit.maximumExposure) <= 0));
}

/**
 * Revisioned audit-state reducer. Recording a use is not an authorization
 * signal; callers must first obtain a successful evaluateOperatorApproval
 * result and must still pass the external Foundation risk/execution owners.
 */
export function reduceOperatorApprovalState(
  state: Readonly<OperatorApprovalState>,
  event: Readonly<OperatorApprovalStateEvent>,
): ContractResult<Readonly<OperatorApprovalState>> {
  if (!Number.isSafeInteger(state.revision) || state.revision < 1
    || typeof state.sourcePolicyDigest !== 'string' || state.sourcePolicyDigest.trim() !== state.sourcePolicyDigest
    || state.sourcePolicyDigest.length === 0 || state.sourcePolicyDigest.length > 256
    || validateOperatorApproval(state.approval).length > 0) {
    throw new TypeError('reduceOperatorApprovalState: malformed current state');
  }
  const eventTime = event.kind === 'REVOKED' ? event.revokedAtMs : event.recordedAtMs;
  if (!isValidUtcMillis(eventTime) || typeof event.correlationId !== 'string' || event.correlationId.trim().length === 0) {
    throw new TypeError('reduceOperatorApprovalState: event requires injected UTC time and correlation ID');
  }

  if (event.kind === 'REVOKED') {
    if (state.approval.revokedAtMs === event.revokedAtMs && state.approval.revocationReasonReference === event.reasonReference) return ok(state);
    if (state.approval.revokedAtMs !== null) return reject(event, 'APPROVAL_ALREADY_REVOKED', 'an existing revocation cannot be replaced');
    if (event.expectedRevision !== state.revision) return reject(event, 'APPROVAL_REVISION_MISMATCH', 'approval state revision changed');
    if (event.revokedAtMs < state.approval.issuedAtMs || event.reasonReference.trim().length === 0 || event.reasonReference.length > 256) {
      return reject(event, 'APPROVAL_REVOCATION_INVALID', 'revocation requires a bounded non-empty reason and cannot predate issue');
    }
    return ok(Object.freeze({
      approval: freezeApproval({ ...state.approval, revokedAtMs: event.revokedAtMs, revocationReasonReference: event.reasonReference }),
      sourcePolicyDigest: state.sourcePolicyDigest,
      revision: state.revision + 1,
      uses: state.uses,
    }));
  }

  if (typeof event.idempotencyKey !== 'string' || event.idempotencyKey.trim().length === 0) throw new TypeError('reduceOperatorApprovalState: use requires an idempotency key');
  const digest = capitalDigest(event.context);
  const existing = state.uses.find((use) => use.idempotencyKey === event.idempotencyKey);
  if (existing !== undefined) {
    if (existing.contextDigest === digest && existing.recordedAtMs === event.recordedAtMs) return ok(state);
    return reject(event, 'APPROVAL_USE_IDEMPOTENCY_CONFLICT', 'idempotency key was reused for different approval context');
  }
  if (event.expectedRevision !== state.revision) return reject(event, 'APPROVAL_REVISION_MISMATCH', 'approval state revision changed');
  if (state.uses.some((use) => use.contextDigest === digest)) {
    return reject(event, 'APPROVAL_CONTEXT_ALREADY_USED', 'the same evaluated approval context was already recorded under another idempotency key');
  }
  if (state.approval.revokedAtMs !== null || event.recordedAtMs < state.approval.issuedAtMs || event.recordedAtMs >= state.approval.expiresAtMs) {
    return reject(event, 'APPROVAL_NOT_CURRENT', 'not-yet-issued, revoked, or expired approval cannot record a new use');
  }
  if (event.context.nowMs !== event.recordedAtMs) return reject(event, 'APPROVAL_USE_TIME_MISMATCH', 'recorded use time must equal the evaluated context time');
  if (!contextMatchesApproval(state.approval, event.context)) return reject(event, 'APPROVAL_USE_SCOPE_MISMATCH', 'use is unrelated to the approval bindings or exact maximum');
  const use = Object.freeze({
    idempotencyKey: event.idempotencyKey,
    useScopeKey: event.context.useScopeKey,
    contextDigest: digest,
    actionClass: event.context.actionClass,
    requestedNotional: event.context.requestedNotional,
    recordedAtMs: event.recordedAtMs,
  });
  return ok(Object.freeze({
    approval: state.approval,
    sourcePolicyDigest: state.sourcePolicyDigest,
    revision: state.revision + 1,
    uses: Object.freeze([...state.uses, use]),
  }));
}

import {
  APPROVAL_ACTION_CLASSES,
  APPROVAL_MODES,
  CONTROL_POSTURES,
  assessCapitalTruth,
  compareExactDecimals,
  deriveCapitalConfigRevision,
  normalizeNonNegativeExactDecimal,
  postureAllowsRiskIncrease,
  weakestCapitalTruth,
  type ApprovalActionClass,
  type ApprovalStageLimit,
  type ConfigurationAuthority,
  type OperatorApproval,
} from '../contracts/index.js';
import {
  createStructuredFailure,
  fail,
  isValidUtcMillis,
  ok,
  type ContractResult,
  type ValidationIssue,
} from '../../foundation/contracts/index.js';
import type {
  ApprovalAuthorityDecision,
  ApprovalPolicyBounds,
  ApprovalPolicyBoundsSemantics,
  OperatorApprovalState,
  ScopedApprovalValidationContext,
} from './types.js';

const COMPONENT = 'capitalFoundation.approvals';

function nonEmpty(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= maximum;
}

function uniqueNonEmpty(values: unknown): values is readonly string[] {
  return Array.isArray(values)
    && values.length > 0
    && values.every((value) => nonEmpty(value))
    && new Set(values).size === values.length;
}

function canonicalNonNegative(value: unknown): boolean {
  try {
    return normalizeNonNegativeExactDecimal(value) === value;
  } catch {
    return false;
  }
}

function validatePolicyAuthority(
  value: unknown,
  requireRevision: boolean,
): ValidationIssue[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [{ path: 'authority', code: 'POLICY_AUTHORITY_REQUIRED', message: 'policy authority must be an object' }];
  }
  const authority = value as Partial<ConfigurationAuthority>;
  const issues: ValidationIssue[] = [];
  if (requireRevision && !nonEmpty(authority.revision)) {
    issues.push({ path: 'authority.revision', code: 'POLICY_REVISION_REQUIRED', message: 'content-addressed policy revision is required' });
  }
  if (!nonEmpty(authority.sourceId)) {
    issues.push({ path: 'authority.sourceId', code: 'POLICY_SOURCE_REQUIRED', message: 'bounded policy source identity is required' });
  }
  if (!isValidUtcMillis(authority.issuedAtMs)) {
    issues.push({ path: 'authority.issuedAtMs', code: 'POLICY_ISSUED_AT_INVALID', message: 'policy issue time must be injected UTC milliseconds' });
  }
  if (!isValidUtcMillis(authority.effectiveFromMs)) {
    issues.push({ path: 'authority.effectiveFromMs', code: 'POLICY_EFFECTIVE_FROM_INVALID', message: 'policy effective time must be injected UTC milliseconds' });
  }
  if (authority.effectiveUntilMs !== null && !isValidUtcMillis(authority.effectiveUntilMs)) {
    issues.push({ path: 'authority.effectiveUntilMs', code: 'POLICY_EFFECTIVE_UNTIL_INVALID', message: 'policy expiry must be null or injected UTC milliseconds' });
  }
  if (isValidUtcMillis(authority.issuedAtMs) && isValidUtcMillis(authority.effectiveFromMs)
    && authority.issuedAtMs > authority.effectiveFromMs) {
    issues.push({ path: 'authority.issuedAtMs', code: 'POLICY_ISSUED_AFTER_EFFECTIVE', message: 'policy cannot be issued after it becomes effective' });
  }
  if (authority.effectiveUntilMs !== null && isValidUtcMillis(authority.effectiveFromMs)
    && isValidUtcMillis(authority.effectiveUntilMs) && authority.effectiveUntilMs <= authority.effectiveFromMs) {
    issues.push({ path: 'authority.effectiveUntilMs', code: 'POLICY_EFFECTIVE_WINDOW_INVALID', message: 'policy expiry must follow its effective time' });
  }
  return issues;
}

function validateStageLimits(value: unknown, path: string): ValidationIssue[] {
  if (!Array.isArray(value)) return [{ path, code: 'ARRAY_REQUIRED', message: `${path} must be an array` }];
  const issues: ValidationIssue[] = [];
  const stages = new Set<string>();
  value.forEach((candidate, index) => {
    const entry = candidate as Partial<ApprovalStageLimit> | null;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push({ path: `${path}[${index}]`, code: 'OBJECT_REQUIRED', message: 'stage limit must be an object' });
      return;
    }
    if (!nonEmpty(entry.stage)) issues.push({ path: `${path}[${index}].stage`, code: 'NON_EMPTY_STRING_REQUIRED', message: 'stage is required' });
    else if (stages.has(entry.stage)) issues.push({ path: `${path}[${index}].stage`, code: 'DUPLICATE_STAGE', message: 'stage limits must be unique' });
    else stages.add(entry.stage);
    if (!canonicalNonNegative(entry.maximumExposure)) {
      issues.push({ path: `${path}[${index}].maximumExposure`, code: 'EXACT_NON_NEGATIVE_DECIMAL_REQUIRED', message: 'maximum exposure must be a canonical exact decimal string' });
    }
  });
  return issues;
}

export function validateOperatorApproval(value: unknown): readonly ValidationIssue[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze([{ path: '', code: 'OBJECT_REQUIRED', message: 'operator approval must be an object' }]);
  }
  const approval = value as Partial<OperatorApproval>;
  const issues: ValidationIssue[] = [];
  const requiredText: ReadonlyArray<readonly [string, unknown]> = [
    ['id', approval.id], ['operatorIdentityReference', approval.operatorIdentityReference],
    ['proposalId', approval.proposalId], ['proposalIntakeDigest', approval.proposalIntakeDigest],
    ['mandateId', approval.mandateId], ['mandateDigest', approval.mandateDigest],
    ['stagedPlanId', approval.stagedPlanId], ['stagedPlanDigest', approval.stagedPlanDigest],
    ['valuationAsset', approval.valuationAsset], ['configRevision', approval.configRevision],
    ['reasonReference', approval.reasonReference], ['useScopeKey', approval.useScopeKey],
  ];
  for (const [path, candidate] of requiredText) {
    if (!nonEmpty(candidate)) issues.push({ path, code: 'NON_EMPTY_STRING_REQUIRED', message: `${path} is required` });
  }
  if (approval.proposalRevision !== null && !nonEmpty(approval.proposalRevision)) {
    issues.push({ path: 'proposalRevision', code: 'NULL_OR_NON_EMPTY_STRING_REQUIRED', message: 'proposal revision must be null or non-empty' });
  }
  if (typeof approval.mandateRevision !== 'number' || !Number.isSafeInteger(approval.mandateRevision) || approval.mandateRevision < 1) {
    issues.push({ path: 'mandateRevision', code: 'POSITIVE_INTEGER_REQUIRED', message: 'mandate revision must be positive' });
  }
  if (typeof approval.stagedPlanRevision !== 'number' || !Number.isSafeInteger(approval.stagedPlanRevision) || approval.stagedPlanRevision < 1) {
    issues.push({ path: 'stagedPlanRevision', code: 'POSITIVE_INTEGER_REQUIRED', message: 'staged plan revision must be positive' });
  }
  if (approval.strategy !== 'BASIS' && approval.strategy !== 'VOLUME') {
    issues.push({ path: 'strategy', code: 'STRATEGY_INVALID', message: 'strategy must be BASIS or VOLUME' });
  }
  if (!uniqueNonEmpty(approval.symbols)) issues.push({ path: 'symbols', code: 'UNIQUE_NON_EMPTY_SCOPE_REQUIRED', message: 'symbols must be unique and non-empty' });
  if (!uniqueNonEmpty(approval.instruments)) issues.push({ path: 'instruments', code: 'UNIQUE_NON_EMPTY_SCOPE_REQUIRED', message: 'instruments must be unique and non-empty' });
  if (!uniqueNonEmpty(approval.allowedActionClasses) || approval.allowedActionClasses.some((action) => !(APPROVAL_ACTION_CLASSES as readonly string[]).includes(action))) {
    issues.push({ path: 'allowedActionClasses', code: 'APPROVAL_ACTION_SCOPE_INVALID', message: 'allowed action classes must be unique known actions' });
  }
  if (!canonicalNonNegative(approval.maximumNotional)) issues.push({ path: 'maximumNotional', code: 'EXACT_NON_NEGATIVE_DECIMAL_REQUIRED', message: 'maximum notional must be a canonical exact decimal string' });
  if (!(APPROVAL_MODES as readonly unknown[]).includes(approval.mode)) issues.push({ path: 'mode', code: 'APPROVAL_MODE_INVALID', message: 'approval mode is unknown' });
  if (!isValidUtcMillis(approval.issuedAtMs)) issues.push({ path: 'issuedAtMs', code: 'UTC_MILLIS_INVALID', message: 'issue time must be injected UTC milliseconds' });
  if (!isValidUtcMillis(approval.expiresAtMs)) issues.push({ path: 'expiresAtMs', code: 'UTC_MILLIS_INVALID', message: 'expiry time must be injected UTC milliseconds' });
  if (isValidUtcMillis(approval.issuedAtMs) && isValidUtcMillis(approval.expiresAtMs) && approval.expiresAtMs <= approval.issuedAtMs) {
    issues.push({ path: 'expiresAtMs', code: 'EXPIRY_MUST_FOLLOW_ISSUE', message: 'expiry must be after issue time' });
  }
  if (approval.revokedAtMs !== null && !isValidUtcMillis(approval.revokedAtMs)) issues.push({ path: 'revokedAtMs', code: 'UTC_MILLIS_INVALID', message: 'revocation time must be null or UTC milliseconds' });
  if ((approval.revokedAtMs === null) !== (approval.revocationReasonReference === null)) {
    issues.push({ path: 'revocationReasonReference', code: 'REVOCATION_PAIR_REQUIRED', message: 'revocation time and reason must both be null or both present' });
  } else if (approval.revocationReasonReference !== null && !nonEmpty(approval.revocationReasonReference)) {
    issues.push({ path: 'revocationReasonReference', code: 'NON_EMPTY_STRING_REQUIRED', message: 'revocation reason must be non-empty' });
  }
  if (approval.revokedAtMs !== null && isValidUtcMillis(approval.revokedAtMs)
    && isValidUtcMillis(approval.issuedAtMs) && approval.revokedAtMs < approval.issuedAtMs) {
    issues.push({ path: 'revokedAtMs', code: 'REVOCATION_PRECEDES_ISSUE', message: 'revocation cannot predate approval issue' });
  }
  issues.push(...validateStageLimits(approval.stageLimits, 'stageLimits'));
  return Object.freeze(issues);
}

export function validateApprovalPolicyBounds(value: unknown): readonly ValidationIssue[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze([{ path: '', code: 'OBJECT_REQUIRED', message: 'approval policy bounds must be an object' }]);
  }
  const policy = value as Partial<ApprovalPolicyBounds>;
  const issues: ValidationIssue[] = [];
  for (const [path, candidate] of [['configRevision', policy.configRevision], ['valuationAsset', policy.valuationAsset]] as const) {
    if (!nonEmpty(candidate)) issues.push({ path, code: 'NON_EMPTY_STRING_REQUIRED', message: `${path} is required` });
  }
  issues.push(...validatePolicyAuthority(policy.authority, true));
  if (policy.strategy !== 'BASIS' && policy.strategy !== 'VOLUME') issues.push({ path: 'strategy', code: 'STRATEGY_INVALID', message: 'policy strategy is invalid' });
  if (!uniqueNonEmpty(policy.symbols)) issues.push({ path: 'symbols', code: 'UNIQUE_NON_EMPTY_SCOPE_REQUIRED', message: 'policy symbols must be unique and non-empty' });
  if (!uniqueNonEmpty(policy.instruments)) issues.push({ path: 'instruments', code: 'UNIQUE_NON_EMPTY_SCOPE_REQUIRED', message: 'policy instruments must be unique and non-empty' });
  if (!uniqueNonEmpty(policy.allowedActionClasses) || policy.allowedActionClasses.some((action) => !(APPROVAL_ACTION_CLASSES as readonly string[]).includes(action))) {
    issues.push({ path: 'allowedActionClasses', code: 'APPROVAL_ACTION_SCOPE_INVALID', message: 'policy actions must be unique known actions' });
  }
  if (!canonicalNonNegative(policy.maximumNotional)) issues.push({ path: 'maximumNotional', code: 'EXACT_NON_NEGATIVE_DECIMAL_REQUIRED', message: 'policy maximum must be a canonical exact decimal string' });
  issues.push(...validateStageLimits(policy.stageLimits, 'stageLimits'));
  if (issues.length === 0 && policy.authority?.revision !== deriveApprovalPolicyDigest(policy as ApprovalPolicyBounds)) {
    issues.push({
      path: 'authority.revision',
      code: 'POLICY_DIGEST_CONTENT_MISMATCH',
      message: 'policy revision must content-address every approval policy semantic',
    });
  }
  return Object.freeze(issues);
}

/**
 * Derives the deterministic integrity address for an approval policy. Set-like
 * scopes are sorted before hashing so equivalent policy projections have one
 * address. This is deliberately not an authenticity proof or a persistence
 * boundary; a future trusted policy adapter must own those concerns.
 */
export function deriveApprovalPolicyDigest(
  value: Readonly<ApprovalPolicyBoundsSemantics> | Readonly<ApprovalPolicyBounds>,
): string {
  const policy = value as Partial<ApprovalPolicyBounds>;
  const semanticIssues: ValidationIssue[] = [];
  semanticIssues.push(...validatePolicyAuthority(policy.authority, false));
  for (const [path, candidate] of [['configRevision', policy.configRevision], ['valuationAsset', policy.valuationAsset]] as const) {
    if (!nonEmpty(candidate)) semanticIssues.push({ path, code: 'NON_EMPTY_STRING_REQUIRED', message: `${path} is required` });
  }
  if (policy.strategy !== 'BASIS' && policy.strategy !== 'VOLUME') semanticIssues.push({ path: 'strategy', code: 'STRATEGY_INVALID', message: 'policy strategy is invalid' });
  if (!uniqueNonEmpty(policy.symbols)) semanticIssues.push({ path: 'symbols', code: 'UNIQUE_NON_EMPTY_SCOPE_REQUIRED', message: 'policy symbols must be unique and non-empty' });
  if (!uniqueNonEmpty(policy.instruments)) semanticIssues.push({ path: 'instruments', code: 'UNIQUE_NON_EMPTY_SCOPE_REQUIRED', message: 'policy instruments must be unique and non-empty' });
  if (!uniqueNonEmpty(policy.allowedActionClasses) || policy.allowedActionClasses.some((action) => !(APPROVAL_ACTION_CLASSES as readonly string[]).includes(action))) {
    semanticIssues.push({ path: 'allowedActionClasses', code: 'APPROVAL_ACTION_SCOPE_INVALID', message: 'policy actions must be unique known actions' });
  }
  if (!canonicalNonNegative(policy.maximumNotional)) semanticIssues.push({ path: 'maximumNotional', code: 'EXACT_NON_NEGATIVE_DECIMAL_REQUIRED', message: 'policy maximum must be a canonical exact decimal string' });
  semanticIssues.push(...validateStageLimits(policy.stageLimits, 'stageLimits'));
  if (semanticIssues.length > 0) {
    throw new TypeError(`deriveApprovalPolicyDigest: malformed policy semantics - ${semanticIssues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`);
  }

  const complete = policy as ApprovalPolicyBounds;
  const authority = complete.authority;
  const semantics = {
    authority: {
      sourceId: authority.sourceId,
      issuedAtMs: authority.issuedAtMs,
      effectiveFromMs: authority.effectiveFromMs,
      effectiveUntilMs: authority.effectiveUntilMs,
    },
    configRevision: complete.configRevision,
    strategy: complete.strategy,
    symbols: [...complete.symbols].sort(),
    instruments: [...complete.instruments].sort(),
    allowedActionClasses: [...complete.allowedActionClasses].sort(),
    maximumNotional: complete.maximumNotional,
    valuationAsset: complete.valuationAsset,
    stageLimits: complete.stageLimits
      .map((limit) => ({ stage: limit.stage, maximumExposure: limit.maximumExposure }))
      .sort((left, right) => left.stage < right.stage ? -1 : left.stage > right.stage ? 1 : 0),
  } satisfies ApprovalPolicyBoundsSemantics;
  return deriveCapitalConfigRevision('approval-policy-bounds', semantics);
}

function refreshControlTruth(
  truth: Readonly<ScopedApprovalValidationContext['controlPosture']['truth']>,
  nowMs: number,
): Readonly<ScopedApprovalValidationContext['controlPosture']['truth']> {
  const refreshed = assessCapitalTruth({
    source: truth.source,
    evaluatedAtMs: nowMs,
    requiredValuePresent: truth.completeness !== 'UNKNOWN',
    divergent: truth.completeness === 'DIVERGENT',
    reasons: truth.reasons,
    evidenceReferences: truth.evidenceReferences,
    revision: truth.revision,
  });
  return Object.freeze({
    ...refreshed,
    completeness: weakestCapitalTruth([truth.completeness, refreshed.completeness]),
  });
}

function assertEvaluationInput(state: OperatorApprovalState, context: ScopedApprovalValidationContext, policy: ApprovalPolicyBounds): void {
  const issues = [...validateOperatorApproval(state.approval), ...validateApprovalPolicyBounds(policy)];
  if (!Number.isSafeInteger(state.revision) || state.revision < 1 || !Array.isArray(state.uses) || !nonEmpty(state.sourcePolicyDigest)) {
    issues.push({ path: 'state', code: 'APPROVAL_STATE_INVALID', message: 'approval state revision, policy digest, and uses are invalid' });
  }
  if (!isValidUtcMillis(context.nowMs) || !nonEmpty(context.correlationId, 128)) issues.push({ path: 'context', code: 'VALIDATION_CONTEXT_INVALID', message: 'context needs injected UTC time and correlation ID' });
  if (!(APPROVAL_ACTION_CLASSES as readonly unknown[]).includes(context.actionClass) || (context.strategy !== 'BASIS' && context.strategy !== 'VOLUME')) {
    issues.push({ path: 'context.authority', code: 'VALIDATION_CONTEXT_INVALID', message: 'context needs a known strategy and action class' });
  }
  if (!nonEmpty(context.proposalId) || (context.proposalRevision !== null && !nonEmpty(context.proposalRevision))
    || !nonEmpty(context.proposalIntakeDigest) || !nonEmpty(context.mandateId) || !nonEmpty(context.mandateDigest)
    || !nonEmpty(context.stagedPlanId) || !nonEmpty(context.stagedPlanDigest) || !nonEmpty(context.configRevision)
    || !nonEmpty(context.useScopeKey) || (context.stage !== null && !nonEmpty(context.stage))) {
    issues.push({ path: 'context.bindings', code: 'VALIDATION_CONTEXT_INVALID', message: 'context identity, revision, digest, stage, and use bindings must be explicit' });
  }
  if (!Number.isSafeInteger(context.mandateRevision) || context.mandateRevision < 1
    || !Number.isSafeInteger(context.stagedPlanRevision) || context.stagedPlanRevision < 1) {
    issues.push({ path: 'context.revisions', code: 'VALIDATION_CONTEXT_INVALID', message: 'context revisions must be positive safe integers' });
  }
  if (!uniqueNonEmpty(context.symbols) || !uniqueNonEmpty(context.instruments)) issues.push({ path: 'context.scope', code: 'UNIQUE_NON_EMPTY_SCOPE_REQUIRED', message: 'requested symbols and instruments must be unique and non-empty' });
  if (!canonicalNonNegative(context.requestedNotional)) issues.push({ path: 'context.requestedNotional', code: 'EXACT_NON_NEGATIVE_DECIMAL_REQUIRED', message: 'requested notional must be canonical exact decimal' });
  const control = context.controlPosture as Partial<ScopedApprovalValidationContext['controlPosture']> | null;
  const controlTruth = control?.truth as Partial<ScopedApprovalValidationContext['controlPosture']['truth']> | undefined;
  if (control === null || typeof control !== 'object' || !(CONTROL_POSTURES as readonly unknown[]).includes(control.posture)
    || controlTruth === undefined || typeof controlTruth !== 'object' || typeof controlTruth.completeness !== 'string'
    || controlTruth.freshness === undefined || typeof controlTruth.freshness !== 'object'
    || typeof controlTruth.freshness.state !== 'string' || typeof controlTruth.freshness.effectiveAuthority !== 'string') {
    issues.push({ path: 'context.controlPosture', code: 'CONTROL_POSTURE_REQUIRED', message: 'caller-supplied control posture and truth are required' });
  }
  if (issues.length > 0) throw new TypeError(`evaluateOperatorApproval: malformed input - ${issues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`);
}

function containsAll(container: readonly string[], requested: readonly string[]): boolean {
  const available = new Set(container);
  return requested.every((entry) => available.has(entry));
}

function rejection<T>(context: ScopedApprovalValidationContext, code: string, message: string): ContractResult<T> {
  return fail(createStructuredFailure({
    component: COMPONENT,
    stage: `validate:${context.actionClass}`,
    code,
    message,
    occurredAt: context.nowMs,
    retryable: false,
    safeCurrentState: 'APPROVAL_UNCHANGED',
    recommendedOperatorAction: 'Issue a fresh approval with the exact current scope and validated policy bounds.',
    correlationId: context.correlationId,
  }));
}

function stageLimit(limits: readonly Readonly<ApprovalStageLimit>[], stage: string): Readonly<ApprovalStageLimit> | null {
  return limits.find((entry) => entry.stage === stage) ?? null;
}

export function evaluateOperatorApproval(
  state: Readonly<OperatorApprovalState>,
  context: Readonly<ScopedApprovalValidationContext>,
  policy: Readonly<ApprovalPolicyBounds>,
): ContractResult<Readonly<ApprovalAuthorityDecision>> {
  assertEvaluationInput(state, context, policy);
  const approval = state.approval;
  if (context.nowMs < approval.issuedAtMs) return rejection(context, 'APPROVAL_NOT_YET_EFFECTIVE', 'approval issue time is in the future');
  if (context.nowMs >= approval.expiresAtMs) return rejection(context, 'APPROVAL_EXPIRED', 'approval has expired');
  if (approval.revokedAtMs !== null) return rejection(context, 'APPROVAL_REVOKED', 'approval has been revoked');
  if (context.nowMs < policy.authority.effectiveFromMs) {
    return rejection(context, 'APPROVAL_POLICY_NOT_YET_EFFECTIVE', 'approval policy is not yet effective at the injected evaluation time');
  }
  if (policy.authority.effectiveUntilMs !== null && context.nowMs >= policy.authority.effectiveUntilMs) {
    return rejection(context, 'APPROVAL_POLICY_EXPIRED', 'approval policy has expired at the injected evaluation time');
  }

  if (approval.proposalId !== context.proposalId || approval.proposalRevision !== context.proposalRevision || approval.proposalIntakeDigest !== context.proposalIntakeDigest) {
    return rejection(context, 'APPROVAL_PROPOSAL_MISMATCH', 'proposal identity, revision, or intake digest changed');
  }
  if (approval.mandateId !== context.mandateId || approval.mandateRevision !== context.mandateRevision || approval.mandateDigest !== context.mandateDigest) {
    return rejection(context, 'APPROVAL_MANDATE_MISMATCH', 'capital mandate identity, revision, or digest changed');
  }
  if (approval.stagedPlanId !== context.stagedPlanId || approval.stagedPlanRevision !== context.stagedPlanRevision || approval.stagedPlanDigest !== context.stagedPlanDigest) {
    return rejection(context, 'APPROVAL_STAGED_PLAN_MISMATCH', 'staged plan identity, revision, or digest changed');
  }
  if (approval.configRevision !== context.configRevision || policy.configRevision !== context.configRevision) {
    return rejection(context, 'APPROVAL_CONFIG_MISMATCH', 'configuration revision changed');
  }
  if (state.sourcePolicyDigest !== policy.authority.revision) {
    return rejection(context, 'APPROVAL_POLICY_DIGEST_MISMATCH', 'validated policy content changed without a new approval');
  }
  if (approval.strategy !== context.strategy || policy.strategy !== context.strategy) return rejection(context, 'APPROVAL_STRATEGY_MISMATCH', 'strategy is outside approval or policy scope');
  if (!containsAll(approval.symbols, context.symbols)) return rejection(context, 'APPROVAL_SYMBOL_SCOPE_MISMATCH', 'requested symbol is outside approval scope');
  if (!containsAll(approval.instruments, context.instruments)) return rejection(context, 'APPROVAL_INSTRUMENT_SCOPE_MISMATCH', 'requested instrument is outside approval scope');
  if (!approval.allowedActionClasses.includes(context.actionClass)) return rejection(context, 'APPROVAL_ACTION_NOT_AUTHORIZED', 'requested action class is outside approval scope');
  if (approval.useScopeKey !== context.useScopeKey || state.uses.some((use) => use.useScopeKey !== context.useScopeKey)) {
    return rejection(context, 'APPROVAL_USE_SCOPE_MISMATCH', 'approval cannot be reused for an unrelated entry scope');
  }

  const approvalExceedsPolicy = approval.valuationAsset !== policy.valuationAsset
    || approval.strategy !== policy.strategy
    || !containsAll(policy.symbols, approval.symbols)
    || !containsAll(policy.instruments, approval.instruments)
    || !containsAll(policy.allowedActionClasses, approval.allowedActionClasses)
    || compareExactDecimals(approval.maximumNotional, policy.maximumNotional) > 0
    || (policy.stageLimits.length > 0 && approval.stageLimits.length === 0)
    || approval.stageLimits.some((limit) => {
      const policyLimit = stageLimit(policy.stageLimits, limit.stage);
      return policy.stageLimits.length > 0 && (policyLimit === null || compareExactDecimals(limit.maximumExposure, policyLimit.maximumExposure) > 0);
    });
  if (approvalExceedsPolicy) return rejection(context, 'APPROVAL_EXCEEDS_POLICY_BOUNDS', 'approval scope or exact limit exceeds validated policy');
  if (compareExactDecimals(context.requestedNotional, approval.maximumNotional) > 0) return rejection(context, 'APPROVAL_NOTIONAL_EXCEEDED', 'requested notional exceeds approval maximum');

  if (approval.stageLimits.length > 0 && context.stage === null) return rejection(context, 'APPROVAL_STAGE_REQUIRED', 'stage-scoped approval requires a stage');
  if (context.stage !== null && approval.stageLimits.length > 0) {
    const limit = stageLimit(approval.stageLimits, context.stage);
    if (limit === null) return rejection(context, 'APPROVAL_STAGE_NOT_AUTHORIZED', 'requested stage is outside approval scope');
    if (compareExactDecimals(context.requestedNotional, limit.maximumExposure) > 0) return rejection(context, 'APPROVAL_STAGE_LIMIT_EXCEEDED', 'requested notional exceeds exact stage limit');
  }

  if (context.actionClass === 'OPEN' || context.actionClass === 'ADD') {
    const refreshedControlPosture = Object.freeze({
      ...context.controlPosture,
      truth: refreshControlTruth(context.controlPosture.truth, context.nowMs),
    });
    if (!postureAllowsRiskIncrease(refreshedControlPosture)) {
      const code = context.controlPosture.posture === 'PAUSED_NEW_EXPOSURE'
        ? 'NEW_EXPOSURE_PAUSED'
        : context.controlPosture.posture === 'KILL_NEW_EXPOSURE'
          ? 'NEW_EXPOSURE_KILLED'
          : 'NEW_EXPOSURE_CONTROL_TRUTH_BLOCKED';
      return rejection(context, code, 'control posture or its re-aged truth blocks new or increasing exposure');
    }
  }

  const mode = approval.mode;
  const allowedForExternalRiskEvaluation = mode === 'VALIDATE_ONLY' || mode === 'MANUAL_ARMED';
  const disposition = mode === 'READ_ONLY'
    ? 'READ_ONLY'
    : mode === 'ADVISORY'
      ? 'ADVISORY_ONLY'
      : mode === 'VALIDATE_ONLY'
        ? 'EXTERNAL_VALIDATION_ONLY'
        : 'EXTERNAL_RISK_AND_EXECUTION_REQUIRED';
  const reasons = mode === 'READ_ONLY'
    ? ['READ_ONLY_NO_EXTERNAL_AUTHORITY']
    : mode === 'ADVISORY'
      ? ['ADVISORY_NO_EXTERNAL_AUTHORITY']
      : mode === 'VALIDATE_ONLY'
        ? ['VALIDATE_ONLY_NEVER_EXECUTION_READY', 'EXTERNAL_RISK_OWNER_REQUIRED']
        : ['EXTERNAL_RISK_OWNER_REQUIRED', 'EXTERNAL_EXECUTION_OWNER_REQUIRED'];
  return ok(Object.freeze({
    approvalId: approval.id,
    validatedAtMs: context.nowMs,
    actionClass: context.actionClass,
    mode,
    disposition,
    allowedForExternalRiskEvaluation,
    executionReady: false as const,
    requiresExternalRiskOwner: allowedForExternalRiskEvaluation,
    requiresExternalExecutionOwner: mode === 'MANUAL_ARMED',
    reasons: Object.freeze(reasons),
  }));
}

import {
  assertCode,
  assertIdentifier,
  assertPositiveSafeInteger,
  assertSafeNonNegativeInteger,
  assertUtcMs,
  sortedUnique,
  type AssuranceEvaluation,
} from '../common.js';

export const OPERATION_CLASSES = Object.freeze([
  'PURE_READ',
  'REPLAYABLE_SUBSCRIPTION',
  'IDEMPOTENT_COMMAND',
  'NON_IDEMPOTENT_MUTATION',
  'MULTI_LEG_SAGA',
  'RISK_REDUCING_RECOVERY',
] as const);
export type OperationClass = (typeof OPERATION_CLASSES)[number];

export const OPERATION_WIRING_STATES = Object.freeze([
  'WIRED',
  'DORMANT_BLOCKED',
  'NOT_CONFIGURED',
  'UNAVAILABLE',
] as const);
export type OperationWiringState = (typeof OPERATION_WIRING_STATES)[number];

export const CIRCUIT_STATES = Object.freeze(['CLOSED', 'OPEN', 'HALF_OPEN'] as const);
export type CircuitState = (typeof CIRCUIT_STATES)[number];

export const OPERATION_PRIORITIES = Object.freeze([
  'OPTIONAL',
  'NORMAL',
  'RECONCILIATION',
  'RISK_REDUCING',
] as const);
export type OperationPriority = (typeof OPERATION_PRIORITIES)[number];

export const OPERATION_CANCELLATION_MODES = Object.freeze([
  'COOPERATIVE_ABORT',
  'DEADLINE_ONLY',
  'NOT_APPLICABLE',
] as const);
export type OperationCancellationMode = (typeof OPERATION_CANCELLATION_MODES)[number];

export interface OperationPolicy {
  readonly schema: 'PRODUCT_ASSURANCE_OPERATION_POLICY_V1';
  readonly revision: number;
  readonly operationId: string;
  readonly operationClass: OperationClass;
  readonly canonicalOwnerId: string;
  readonly implementationPaths: readonly string[];
  readonly wiringState: OperationWiringState;
  readonly deadlineMs: number;
  readonly transientErrorCodes: readonly string[];
  readonly permanentErrorCodes: readonly string[];
  readonly ambiguousErrorCodes: readonly string[];
  readonly maximumAttempts: number;
  readonly backoff: Readonly<{
    baseDelayMs: number;
    maximumDelayMs: number;
    jitterRatio: number;
    totalRetryBudgetMs: number;
  }>;
  readonly rateBudget: Readonly<{
    priority: OperationPriority;
    reserveUnits: number;
    cooldownBehavior: 'HONOR_OWNER_COOLDOWN' | 'NO_RETRY' | 'NOT_APPLICABLE';
  }>;
  readonly idempotency: Readonly<{
    required: boolean;
    identityField: string | null;
    lifetimeMs: number | null;
    durability: 'DURABLE' | 'PROCESS_LOCAL' | 'NOT_APPLICABLE';
  }>;
  readonly authoritativeReconciliationLookup: string | null;
  readonly circuit: Readonly<{
    failureThreshold: number;
    resetAfterMs: number;
    halfOpenMaximumProbes: number;
    healthyQuietWindowMs: number;
  }>;
  readonly concurrencyLimit: number;
  readonly cancellation: Readonly<{
    mode: OperationCancellationMode;
    lateCompletionLaw: 'RECONCILE_BEFORE_RETRY' | 'QUARANTINE' | 'IGNORE_READ_ONLY';
    maximumCancellationWaitMs: number;
    cancellationEvidenceId: string;
  }>;
  readonly controlLoop: Readonly<{
    maximumConsecutiveRepairs: number;
    maximumAmplificationFactor: number;
    alternatingFingerprintWindowMs: number;
    cooldownMs: number;
  }>;
  readonly costResourceEvidence: Readonly<{
    required: boolean;
    budgetOwnerId: string;
    metricId: string;
    missingBehavior: 'BLOCK_OPERATION' | 'SHED_OPTIONAL' | 'NOT_APPLICABLE';
  }>;
  readonly poisonEventQuarantine: boolean;
  readonly fallbackEligibility: 'NONE' | 'ACCEPTED_OWNER_ONLY';
  readonly degradedResult: string;
  readonly blockedResult: string;
  readonly durableRestartCheckpoint: string | null;
  readonly automaticRemediationAllowed: boolean;
  readonly escalationControlId: string;
  readonly runbookId: string;
  readonly metricId: string;
  readonly traceId: string;
  readonly materialEventId: string;
  readonly incidentId: string;
  readonly cockpitLocation: string;
  readonly faultTestIds: readonly string[];
}

export interface DiscoveredOperationSite {
  readonly siteId: string;
  readonly path: string;
  readonly line: number;
  readonly kind:
    | 'NETWORK_HTTP_REQUEST'
    | 'STREAM_CONNECT'
    | 'STREAM_SERVER'
    | 'STREAM_SEND'
    | 'QUEUE_CREATE'
    | 'QUEUE_PUBLISH'
    | 'QUEUE_CONSUME'
    | 'DATABASE_OPEN'
    | 'DATABASE_QUERY'
    | 'DATABASE_MUTATION'
    | 'DATABASE_TRANSACTION'
    | 'MUTATION_CALL'
    | 'DEPLOYMENT_CLIENT'
    | 'DEPLOYMENT_COMMAND'
    | 'COMMAND_DISPATCH'
    | 'HTTP_SERVER_CREATE'
    | 'HTTP_SERVER_LISTEN';
  readonly symbol: string;
  readonly operationId: string | null;
}

export interface OperationCoverageReport {
  readonly expectedSiteCount: number;
  readonly registeredSiteCount: number;
  readonly uncoveredSites: readonly Readonly<DiscoveredOperationSite>[];
  readonly unknownPolicyIds: readonly string[];
  readonly duplicateOperationIds: readonly string[];
  readonly verdict: AssuranceEvaluation['verdict'];
  readonly reasonCodes: readonly string[];
}

export interface RetryDecisionInput {
  readonly attempt: number;
  readonly elapsedMs: number;
  readonly errorCode: string;
  readonly submissionState: 'NOT_SENT' | 'ACCEPTED' | 'UNKNOWN_SUBMISSION';
  readonly reconciliationState: 'NOT_REQUIRED' | 'PENDING' | 'PROVED_ABSENT' | 'PROVED_PRESENT' | 'UNKNOWN';
  readonly durableIdentityState: 'NOT_REQUIRED' | 'PRESENT' | 'MISSING' | 'EXPIRED';
  readonly deterministicJitterUnit: number;
}

export type RetryDecision = Readonly<
  | { kind: 'RETRY'; delayMs: number; nextAttempt: number; reasonCode: 'TRANSIENT_RETRY_ALLOWED' | 'AMBIGUOUS_ABSENCE_RETRY_ALLOWED' }
  | { kind: 'RECONCILE_FIRST'; delayMs: null; nextAttempt: number; reasonCode: 'AMBIGUOUS_SUBMISSION_REQUIRES_RECONCILIATION' }
  | { kind: 'STOP'; delayMs: null; nextAttempt: number; reasonCode: string }
>;

export interface CircuitSnapshot {
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
  readonly openedAtMs: number | null;
  readonly halfOpenProbes: number;
  readonly lastEventAtMs: number | null;
  readonly probePassedAtMs: number | null;
  readonly independentlyVerifiedAtMs: number | null;
}

export type CircuitEvent =
  /** Producer self-report. It can clear failures only while already CLOSED. */
  | { readonly kind: 'SUCCESS'; readonly atMs: number }
  | { readonly kind: 'FAILURE'; readonly atMs: number }
  | { readonly kind: 'TICK'; readonly atMs: number }
  | { readonly kind: 'PROBE_STARTED'; readonly atMs: number }
  | { readonly kind: 'PROBE_PASSED'; readonly atMs: number }
  | { readonly kind: 'INDEPENDENT_VERIFICATION_PASSED'; readonly atMs: number; readonly verifierId: string };

function isOperationClass(value: unknown): value is OperationClass {
  return typeof value === 'string' && (OPERATION_CLASSES as readonly string[]).includes(value);
}

export function validateOperationPolicy(policy: Readonly<OperationPolicy>): readonly string[] {
  const issues: string[] = [];
  try {
    assertIdentifier(policy.operationId, 'policy.operationId');
    assertIdentifier(policy.canonicalOwnerId, 'policy.canonicalOwnerId');
    assertSafeNonNegativeInteger(policy.revision, 'policy.revision');
    assertPositiveSafeInteger(policy.deadlineMs, 'policy.deadlineMs');
    assertPositiveSafeInteger(policy.maximumAttempts, 'policy.maximumAttempts');
    assertPositiveSafeInteger(policy.concurrencyLimit, 'policy.concurrencyLimit');
    assertSafeNonNegativeInteger(policy.cancellation.maximumCancellationWaitMs, 'policy.cancellation.maximumCancellationWaitMs');
    assertPositiveSafeInteger(policy.controlLoop.maximumConsecutiveRepairs, 'policy.controlLoop.maximumConsecutiveRepairs');
    assertSafeNonNegativeInteger(policy.controlLoop.alternatingFingerprintWindowMs, 'policy.controlLoop.alternatingFingerprintWindowMs');
    assertSafeNonNegativeInteger(policy.controlLoop.cooldownMs, 'policy.controlLoop.cooldownMs');
    assertIdentifier(policy.cancellation.cancellationEvidenceId, 'policy.cancellation.cancellationEvidenceId');
    assertIdentifier(policy.costResourceEvidence.budgetOwnerId, 'policy.costResourceEvidence.budgetOwnerId');
    assertIdentifier(policy.costResourceEvidence.metricId, 'policy.costResourceEvidence.metricId');
    assertPositiveSafeInteger(policy.circuit.failureThreshold, 'policy.circuit.failureThreshold');
    assertPositiveSafeInteger(policy.circuit.resetAfterMs, 'policy.circuit.resetAfterMs');
    assertPositiveSafeInteger(policy.circuit.halfOpenMaximumProbes, 'policy.circuit.halfOpenMaximumProbes');
    assertPositiveSafeInteger(policy.circuit.healthyQuietWindowMs, 'policy.circuit.healthyQuietWindowMs');
    if (policy.idempotency.identityField !== null) assertIdentifier(policy.idempotency.identityField, 'policy.idempotency.identityField');
    if (policy.authoritativeReconciliationLookup !== null) {
      assertIdentifier(policy.authoritativeReconciliationLookup, 'policy.authoritativeReconciliationLookup');
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'POLICY_VALIDATION_FAILED');
  }
  if (policy.schema !== 'PRODUCT_ASSURANCE_OPERATION_POLICY_V1') issues.push('SCHEMA_UNSUPPORTED');
  if (!isOperationClass(policy.operationClass)) issues.push('OPERATION_CLASS_INVALID');
  if (!(OPERATION_WIRING_STATES as readonly string[]).includes(policy.wiringState)) issues.push('WIRING_STATE_INVALID');
  if (!(OPERATION_CANCELLATION_MODES as readonly string[]).includes(policy.cancellation.mode)) issues.push('CANCELLATION_MODE_INVALID');
  if (!(OPERATION_PRIORITIES as readonly string[]).includes(policy.rateBudget.priority)) issues.push('RATE_BUDGET_PRIORITY_INVALID');
  if (!(['HONOR_OWNER_COOLDOWN', 'NO_RETRY', 'NOT_APPLICABLE'] as const).includes(policy.rateBudget.cooldownBehavior)) issues.push('RATE_BUDGET_COOLDOWN_INVALID');
  if (!(['RECONCILE_BEFORE_RETRY', 'QUARANTINE', 'IGNORE_READ_ONLY'] as const).includes(policy.cancellation.lateCompletionLaw)) issues.push('LATE_COMPLETION_LAW_INVALID');
  if (!(['NONE', 'ACCEPTED_OWNER_ONLY'] as const).includes(policy.fallbackEligibility)) issues.push('FALLBACK_ELIGIBILITY_INVALID');
  if (!(['BLOCK_OPERATION', 'SHED_OPTIONAL', 'NOT_APPLICABLE'] as const).includes(policy.costResourceEvidence.missingBehavior)) issues.push('COST_RESOURCE_MISSING_BEHAVIOR_INVALID');
  if (!Number.isSafeInteger(policy.rateBudget.reserveUnits) || policy.rateBudget.reserveUnits < 0) issues.push('RATE_BUDGET_RESERVE_INVALID');
  if (!Number.isFinite(policy.controlLoop.maximumAmplificationFactor) || policy.controlLoop.maximumAmplificationFactor < 1) issues.push('CONTROL_LOOP_AMPLIFICATION_INVALID');
  if (policy.costResourceEvidence.required && policy.costResourceEvidence.missingBehavior === 'NOT_APPLICABLE') issues.push('COST_RESOURCE_MISSING_BEHAVIOR_INVALID');
  if (policy.implementationPaths.length === 0) issues.push('IMPLEMENTATION_PATH_MISSING');
  if (policy.backoff.baseDelayMs < 0 || !Number.isSafeInteger(policy.backoff.baseDelayMs)) issues.push('BACKOFF_BASE_INVALID');
  if (policy.backoff.maximumDelayMs < policy.backoff.baseDelayMs || !Number.isSafeInteger(policy.backoff.maximumDelayMs)) issues.push('BACKOFF_MAX_INVALID');
  if (policy.backoff.jitterRatio < 0 || policy.backoff.jitterRatio > 1 || !Number.isFinite(policy.backoff.jitterRatio)) issues.push('JITTER_RATIO_INVALID');
  if (!Number.isSafeInteger(policy.backoff.totalRetryBudgetMs) || policy.backoff.totalRetryBudgetMs < 0) issues.push('RETRY_BUDGET_INVALID');
  if (!(policy.idempotency.durability === 'DURABLE'
    || policy.idempotency.durability === 'PROCESS_LOCAL'
    || policy.idempotency.durability === 'NOT_APPLICABLE')) {
    issues.push('IDEMPOTENCY_DURABILITY_INVALID');
  }
  if (policy.idempotency.required) {
    if (policy.idempotency.identityField === null) issues.push('IDEMPOTENCY_IDENTITY_FIELD_REQUIRED');
    if (policy.idempotency.lifetimeMs === null || !Number.isSafeInteger(policy.idempotency.lifetimeMs) || policy.idempotency.lifetimeMs <= 0) {
      issues.push('IDEMPOTENCY_LIFETIME_REQUIRED');
    }
    if (policy.idempotency.durability === 'NOT_APPLICABLE') issues.push('IDEMPOTENCY_DURABILITY_REQUIRED');
    if (policy.idempotency.lifetimeMs !== null && policy.idempotency.lifetimeMs < policy.deadlineMs) {
      issues.push('IDEMPOTENCY_LIFETIME_SHORTER_THAN_DEADLINE');
    }
  } else if (policy.idempotency.identityField !== null
    || policy.idempotency.lifetimeMs !== null
    || policy.idempotency.durability !== 'NOT_APPLICABLE') {
    issues.push('IDEMPOTENCY_UNUSED_FIELDS_PRESENT');
  }
  if (policy.ambiguousErrorCodes.length > 0) {
    if (!policy.idempotency.required
      || policy.idempotency.identityField === null
      || policy.idempotency.lifetimeMs === null
      || policy.idempotency.durability !== 'DURABLE') {
      issues.push('AMBIGUOUS_OUTCOME_DURABLE_IDENTITY_REQUIRED');
    }
    if (policy.authoritativeReconciliationLookup === null) issues.push('AMBIGUOUS_OUTCOME_RECONCILIATION_REQUIRED');
  }
  if (policy.operationClass === 'NON_IDEMPOTENT_MUTATION' || policy.operationClass === 'MULTI_LEG_SAGA') {
    if (!policy.idempotency.required) issues.push('MUTATION_IDEMPOTENCY_REQUIRED');
    if (policy.idempotency.identityField === null) issues.push('MUTATION_IDENTITY_FIELD_REQUIRED');
    if (policy.authoritativeReconciliationLookup === null) issues.push('MUTATION_RECONCILIATION_REQUIRED');
    if (policy.automaticRemediationAllowed) issues.push('MUTATION_AUTOMATIC_REMEDIATION_FORBIDDEN');
    if (policy.cancellation.lateCompletionLaw === 'IGNORE_READ_ONLY') issues.push('MUTATION_LATE_COMPLETION_RECONCILIATION_REQUIRED');
  }
  if (policy.wiringState === 'DORMANT_BLOCKED' && policy.automaticRemediationAllowed) {
    issues.push('DORMANT_OPERATION_AUTOMATIC_REMEDIATION_FORBIDDEN');
  }
  for (const code of [...policy.transientErrorCodes, ...policy.permanentErrorCodes, ...policy.ambiguousErrorCodes]) {
    try { assertCode(code, 'policy.errorCode'); } catch { issues.push('ERROR_CODE_INVALID'); }
  }
  return sortedUnique(issues);
}

export function scanOperationCoverage(
  policies: readonly Readonly<OperationPolicy>[],
  discoveredSites: readonly Readonly<DiscoveredOperationSite>[],
): Readonly<OperationCoverageReport> {
  const ids = policies.map((policy) => policy.operationId);
  const duplicates = sortedUnique(ids.filter((id, index) => ids.indexOf(id) !== index));
  const policyById = new Map(policies.map((policy) => [policy.operationId, policy]));
  const siteMatchesPolicy = (site: Readonly<DiscoveredOperationSite>): boolean => {
    if (site.operationId === null) return false;
    const policy = policyById.get(site.operationId);
    if (policy === undefined) return false;
    const pathMatch = policy.implementationPaths.some((pattern) => pattern.endsWith('/**')
      ? site.path.startsWith(pattern.slice(0, -3))
      : site.path === pattern);
    if (!pathMatch) return false;
    const kind = String(site.kind);
    const mutationLike = kind === 'MUTATION'
      || kind.includes('MUTATION')
      || kind === 'DATABASE_TRANSACTION'
      || kind === 'DEPLOYMENT_COMMAND';
    return !mutationLike || !['PURE_READ', 'REPLAYABLE_SUBSCRIPTION'].includes(policy.operationClass);
  };
  const uncoveredSites = discoveredSites
    .filter((site) => !siteMatchesPolicy(site))
    .sort((left, right) => left.siteId.localeCompare(right.siteId));
  const unknownPolicyIds = sortedUnique(
    discoveredSites
      .map((site) => site.operationId)
      .filter((id): id is string => id !== null && !policyById.has(id)),
  );
  const invalidPolicies = policies.filter((policy) => validateOperationPolicy(policy).length > 0);
  const reasons: string[] = [];
  if (uncoveredSites.length > 0) reasons.push('PRODUCTION_OPERATION_UNCOVERED');
  if (unknownPolicyIds.length > 0) reasons.push('UNKNOWN_OPERATION_POLICY');
  if (duplicates.length > 0) reasons.push('DUPLICATE_OPERATION_POLICY_ID');
  if (invalidPolicies.length > 0) reasons.push('INVALID_OPERATION_POLICY');
  return Object.freeze({
    expectedSiteCount: discoveredSites.length,
    registeredSiteCount: discoveredSites.length - uncoveredSites.length,
    uncoveredSites: Object.freeze(uncoveredSites.map((site) => Object.freeze({ ...site }))),
    unknownPolicyIds,
    duplicateOperationIds: duplicates,
    verdict: reasons.length === 0 ? 'PASS' : 'FAIL',
    reasonCodes: sortedUnique(reasons),
  });
}

export function decideRetry(
  policy: Readonly<OperationPolicy>,
  input: Readonly<RetryDecisionInput>,
): RetryDecision {
  const issues = validateOperationPolicy(policy);
  if (issues.length > 0) throw new TypeError(`decideRetry: invalid policy: ${issues.join(',')}`);
  assertSafeNonNegativeInteger(input.attempt, 'input.attempt');
  assertSafeNonNegativeInteger(input.elapsedMs, 'input.elapsedMs');
  assertCode(input.errorCode, 'input.errorCode');
  if (!(['NOT_SENT', 'ACCEPTED', 'UNKNOWN_SUBMISSION'] as const).includes(input.submissionState)) {
    throw new TypeError('input.submissionState is invalid');
  }
  if (!(['NOT_REQUIRED', 'PENDING', 'PROVED_ABSENT', 'PROVED_PRESENT', 'UNKNOWN'] as const).includes(input.reconciliationState)) {
    throw new TypeError('input.reconciliationState is invalid');
  }
  if (!(['NOT_REQUIRED', 'PRESENT', 'MISSING', 'EXPIRED'] as const).includes(input.durableIdentityState)) {
    throw new TypeError('input.durableIdentityState is invalid');
  }
  if (input.attempt === Number.MAX_SAFE_INTEGER) throw new TypeError('input.attempt cannot be incremented safely');
  if (!Number.isFinite(input.deterministicJitterUnit) || input.deterministicJitterUnit < 0 || input.deterministicJitterUnit > 1) {
    throw new TypeError('input.deterministicJitterUnit must be in [0,1]');
  }

  const nextAttempt = input.attempt + 1;
  if (policy.wiringState !== 'WIRED') {
    return Object.freeze({ kind: 'STOP', delayMs: null, nextAttempt, reasonCode: 'OPERATION_NOT_WIRED' });
  }
  if (input.submissionState === 'ACCEPTED') {
    return Object.freeze({ kind: 'STOP', delayMs: null, nextAttempt, reasonCode: 'SUBMISSION_ALREADY_ACCEPTED' });
  }
  const ambiguousOutcome = input.submissionState === 'UNKNOWN_SUBMISSION'
    || policy.ambiguousErrorCodes.includes(input.errorCode);
  if (ambiguousOutcome) {
    if (!policy.idempotency.required
      || policy.idempotency.identityField === null
      || policy.idempotency.lifetimeMs === null
      || policy.idempotency.durability !== 'DURABLE'
      || policy.authoritativeReconciliationLookup === null) {
      return Object.freeze({ kind: 'STOP', delayMs: null, nextAttempt, reasonCode: 'AMBIGUOUS_OUTCOME_POLICY_UNSAFE' });
    }
    if (input.durableIdentityState !== 'PRESENT') {
      return Object.freeze({ kind: 'STOP', delayMs: null, nextAttempt, reasonCode: 'DURABLE_IDENTITY_MISSING_OR_EXPIRED' });
    }
    if (input.reconciliationState === 'PROVED_ABSENT') {
      // Continue through the same bounded transient checks below.
    } else if (input.reconciliationState === 'PROVED_PRESENT') {
      return Object.freeze({ kind: 'STOP', delayMs: null, nextAttempt, reasonCode: 'SUBMISSION_ALREADY_ACCEPTED' });
    } else {
      return Object.freeze({
        kind: 'RECONCILE_FIRST',
        delayMs: null,
        nextAttempt,
        reasonCode: 'AMBIGUOUS_SUBMISSION_REQUIRES_RECONCILIATION',
      });
    }
  }
  if (input.elapsedMs >= policy.deadlineMs) {
    return Object.freeze({ kind: 'STOP', delayMs: null, nextAttempt, reasonCode: 'OPERATION_DEADLINE_EXHAUSTED' });
  }
  if (policy.permanentErrorCodes.includes(input.errorCode)) {
    return Object.freeze({ kind: 'STOP', delayMs: null, nextAttempt, reasonCode: 'PERMANENT_ERROR' });
  }
  if (!policy.transientErrorCodes.includes(input.errorCode) && !ambiguousOutcome) {
    return Object.freeze({ kind: 'STOP', delayMs: null, nextAttempt, reasonCode: 'ERROR_NOT_RETRYABLE' });
  }
  if (nextAttempt >= policy.maximumAttempts) {
    return Object.freeze({ kind: 'STOP', delayMs: null, nextAttempt, reasonCode: 'MAXIMUM_ATTEMPTS_EXHAUSTED' });
  }
  const exponential = Math.min(
    policy.backoff.maximumDelayMs,
    policy.backoff.baseDelayMs * (2 ** input.attempt),
  );
  const jitterRange = exponential * policy.backoff.jitterRatio;
  const delayMs = Math.max(0, Math.round(exponential - jitterRange + (2 * jitterRange * input.deterministicJitterUnit)));
  if (input.elapsedMs + delayMs > policy.deadlineMs) {
    return Object.freeze({ kind: 'STOP', delayMs: null, nextAttempt, reasonCode: 'OPERATION_DEADLINE_EXHAUSTED' });
  }
  if (input.elapsedMs + delayMs > policy.backoff.totalRetryBudgetMs) {
    return Object.freeze({ kind: 'STOP', delayMs: null, nextAttempt, reasonCode: 'TOTAL_RETRY_BUDGET_EXHAUSTED' });
  }
  return Object.freeze({
    kind: 'RETRY',
    delayMs,
    nextAttempt,
    reasonCode: ambiguousOutcome ? 'AMBIGUOUS_ABSENCE_RETRY_ALLOWED' : 'TRANSIENT_RETRY_ALLOWED',
  });
}

export function transitionCircuit(
  policy: Readonly<OperationPolicy>,
  snapshot: Readonly<CircuitSnapshot>,
  event: Readonly<CircuitEvent>,
): Readonly<CircuitSnapshot> {
  const issues = validateOperationPolicy(policy);
  if (issues.length > 0) throw new TypeError(`transitionCircuit: invalid policy: ${issues.join(',')}`);
  assertUtcMs(event.atMs, 'event.atMs');
  assertSafeNonNegativeInteger(snapshot.consecutiveFailures, 'snapshot.consecutiveFailures');
  assertSafeNonNegativeInteger(snapshot.halfOpenProbes, 'snapshot.halfOpenProbes');
  if (snapshot.openedAtMs !== null) assertUtcMs(snapshot.openedAtMs, 'snapshot.openedAtMs');
  if (snapshot.lastEventAtMs !== null) assertUtcMs(snapshot.lastEventAtMs, 'snapshot.lastEventAtMs');
  if (snapshot.probePassedAtMs !== null) assertUtcMs(snapshot.probePassedAtMs, 'snapshot.probePassedAtMs');
  if (snapshot.independentlyVerifiedAtMs !== null) assertUtcMs(snapshot.independentlyVerifiedAtMs, 'snapshot.independentlyVerifiedAtMs');
  if (snapshot.state === 'CLOSED' && (snapshot.openedAtMs !== null
    || snapshot.halfOpenProbes !== 0
    || snapshot.probePassedAtMs !== null
    || snapshot.independentlyVerifiedAtMs !== null)) {
    throw new TypeError('closed circuit cannot retain open or probe state');
  }
  if (snapshot.state !== 'CLOSED' && snapshot.openedAtMs === null) {
    throw new TypeError('open circuit must retain openedAtMs');
  }
  if (!(CIRCUIT_STATES as readonly string[]).includes(snapshot.state)) {
    throw new TypeError('snapshot.state is unsupported');
  }
  if (snapshot.state === 'OPEN' && (snapshot.halfOpenProbes !== 0
    || snapshot.probePassedAtMs !== null
    || snapshot.independentlyVerifiedAtMs !== null)) {
    throw new TypeError('open circuit cannot retain half-open probe state');
  }
  if (snapshot.probePassedAtMs !== null && snapshot.halfOpenProbes === 0) {
    throw new TypeError('passed probe requires a started half-open probe');
  }
  if (snapshot.independentlyVerifiedAtMs !== null && snapshot.probePassedAtMs === null) {
    throw new TypeError('independent verification requires a passed probe');
  }
  if (snapshot.openedAtMs !== null && snapshot.probePassedAtMs !== null && snapshot.probePassedAtMs < snapshot.openedAtMs) {
    throw new TypeError('passed probe cannot predate circuit opening');
  }
  if (snapshot.probePassedAtMs !== null
    && snapshot.independentlyVerifiedAtMs !== null
    && snapshot.independentlyVerifiedAtMs < snapshot.probePassedAtMs) {
    throw new TypeError('independent verification cannot predate the passed probe');
  }
  for (const timestamp of [snapshot.openedAtMs, snapshot.probePassedAtMs, snapshot.independentlyVerifiedAtMs]) {
    if (timestamp !== null && snapshot.lastEventAtMs !== null && timestamp > snapshot.lastEventAtMs) {
      throw new TypeError('snapshot evidence timestamp cannot follow lastEventAtMs');
    }
  }
  if (snapshot.lastEventAtMs !== null && event.atMs <= snapshot.lastEventAtMs) {
    return snapshot;
  }

  const observed = (changes: Partial<CircuitSnapshot>): Readonly<CircuitSnapshot> => Object.freeze({
    ...snapshot,
    ...changes,
    lastEventAtMs: event.atMs,
  });

  if (event.kind === 'TICK') {
    if (snapshot.state === 'OPEN' && snapshot.openedAtMs !== null && event.atMs - snapshot.openedAtMs >= policy.circuit.resetAfterMs) {
      return observed({
        state: 'HALF_OPEN',
        halfOpenProbes: 0,
        probePassedAtMs: null,
        independentlyVerifiedAtMs: null,
      });
    }
    if (snapshot.state === 'HALF_OPEN'
      && snapshot.probePassedAtMs !== null
      && snapshot.independentlyVerifiedAtMs !== null
      && event.atMs - snapshot.independentlyVerifiedAtMs >= policy.circuit.healthyQuietWindowMs) {
      return observed({
        state: 'CLOSED',
        consecutiveFailures: 0,
        openedAtMs: null,
        halfOpenProbes: 0,
        probePassedAtMs: null,
        independentlyVerifiedAtMs: null,
      });
    }
    return observed({});
  }
  if (event.kind === 'PROBE_STARTED') {
    if (snapshot.state !== 'HALF_OPEN' || snapshot.halfOpenProbes >= policy.circuit.halfOpenMaximumProbes) {
      return snapshot;
    }
    return observed({
      halfOpenProbes: snapshot.halfOpenProbes + 1,
      probePassedAtMs: null,
      independentlyVerifiedAtMs: null,
    });
  }
  if (event.kind === 'PROBE_PASSED') {
    if (snapshot.state !== 'HALF_OPEN' || snapshot.halfOpenProbes === 0 || snapshot.probePassedAtMs !== null) {
      return snapshot;
    }
    return observed({ probePassedAtMs: event.atMs, independentlyVerifiedAtMs: null });
  }
  if (event.kind === 'INDEPENDENT_VERIFICATION_PASSED') {
    assertIdentifier(event.verifierId, 'event.verifierId');
    if (event.verifierId === policy.canonicalOwnerId
      || snapshot.state !== 'HALF_OPEN'
      || snapshot.probePassedAtMs === null
      || snapshot.independentlyVerifiedAtMs !== null) {
      return snapshot;
    }
    return observed({ independentlyVerifiedAtMs: event.atMs });
  }
  if (event.kind === 'SUCCESS') {
    if (snapshot.state !== 'CLOSED') return observed({});
    return observed({ consecutiveFailures: 0 });
  }
  const failures = snapshot.consecutiveFailures + 1;
  if (snapshot.state === 'HALF_OPEN' || failures >= policy.circuit.failureThreshold) {
    return observed({
      state: 'OPEN',
      consecutiveFailures: failures,
      openedAtMs: event.atMs,
      halfOpenProbes: 0,
      probePassedAtMs: null,
      independentlyVerifiedAtMs: null,
    });
  }
  if (snapshot.state === 'OPEN') {
    return observed({
      consecutiveFailures: failures,
      openedAtMs: event.atMs,
      halfOpenProbes: 0,
      probePassedAtMs: null,
      independentlyVerifiedAtMs: null,
    });
  }
  return observed({ consecutiveFailures: failures });
}

export interface RateBudgetRequest {
  readonly requestId: string;
  readonly priority: OperationPriority;
  readonly units: number;
}

export interface RateBudgetAllocation {
  readonly admittedRequestIds: readonly string[];
  readonly blockedRequestIds: readonly string[];
  readonly usedUnits: number;
  readonly remainingUnits: number;
}

const PRIORITY_RANK: Readonly<Record<OperationPriority, number>> = Object.freeze({
  RISK_REDUCING: 0,
  RECONCILIATION: 1,
  NORMAL: 2,
  OPTIONAL: 3,
});

export function allocateRateBudget(
  capacityUnits: number,
  protectedPriorityReserveUnits: number,
  requests: readonly Readonly<RateBudgetRequest>[],
): Readonly<RateBudgetAllocation> {
  assertSafeNonNegativeInteger(capacityUnits, 'capacityUnits');
  assertSafeNonNegativeInteger(protectedPriorityReserveUnits, 'protectedPriorityReserveUnits');
  if (protectedPriorityReserveUnits > capacityUnits) throw new TypeError('protectedPriorityReserveUnits cannot exceed capacityUnits');
  if (!Array.isArray(requests)) throw new TypeError('requests must be an array');
  for (const request of requests) {
    assertIdentifier(request.requestId, 'request.requestId');
    if (!(OPERATION_PRIORITIES as readonly unknown[]).includes(request.priority)) throw new TypeError('request.priority is unsupported');
    assertPositiveSafeInteger(request.units, 'request.units');
  }
  if (new Set(requests.map((request) => request.requestId)).size !== requests.length) throw new TypeError('request IDs must be unique');
  const sorted = [...requests].sort((left, right) => {
    const rank = PRIORITY_RANK[left.priority as OperationPriority] - PRIORITY_RANK[right.priority as OperationPriority];
    return rank !== 0 ? rank : left.requestId.localeCompare(right.requestId);
  });
  const admitted: string[] = [];
  const blocked: string[] = [];
  let used = 0;
  for (const request of sorted) {
    const protectedPriority = request.priority === 'RISK_REDUCING' || request.priority === 'RECONCILIATION';
    const requestLimit = protectedPriority ? capacityUnits : capacityUnits - protectedPriorityReserveUnits;
    if (used + request.units <= requestLimit) {
      admitted.push(request.requestId);
      used += request.units;
    } else {
      blocked.push(request.requestId);
    }
  }
  return Object.freeze({
    admittedRequestIds: Object.freeze(admitted),
    blockedRequestIds: Object.freeze(blocked),
    usedUnits: used,
    remainingUnits: capacityUnits - used,
  });
}

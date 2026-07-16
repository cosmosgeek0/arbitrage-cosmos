import {
  assertIdentifier,
  assertPositiveSafeInteger,
  assertSafeNonNegativeInteger,
  assertUtcMs,
  sortedUnique,
} from '../common.js';

export const REMEDIATION_ACTIONS = Object.freeze([
  'RECONNECT',
  'RESUBSCRIBE',
  'RESNAPSHOT_SEQUENCE_GAP',
  'ROTATE_STREAM',
  'RESYNC_CLOCK',
  'REFRESH_FILTERS',
  'FAILOVER_ACCEPTED_SOURCE',
  'RATE_LIMIT_COOLDOWN',
  'QUARANTINE_POISON_EVENT',
  'RESTART_BOUNDED_WORKER',
  'RECOVER_DB_CHECKPOINT',
  'INVALIDATE_CACHE',
  'RECOVER_TELEMETRY_EXPORT',
  'WATCHDOG_RESTART',
  'MAINTENANCE_DRAIN',
] as const);
export type RemediationAction = (typeof REMEDIATION_ACTIONS)[number];

export const REMEDIATION_STATES = Object.freeze([
  'DETECTED',
  'CONTAINING',
  'DIAGNOSING',
  'PLANNED',
  'EXECUTING',
  'VERIFYING',
  'RECOVERED',
  'AWAITING_AUTHORIZATION',
  'AUTH_REJECTED_OR_EXPIRED',
  'CANCELLING',
  'SUPERSEDED',
  'ROLLING_BACK',
  'COMPENSATED',
  'COMPENSATION_FAILED',
  'QUARANTINED',
  'FAILED_ATTENTION_REQUIRED',
] as const);
export type RemediationState = (typeof REMEDIATION_STATES)[number];

export interface ResourceLease {
  readonly resourceId: string;
  readonly campaignId: string;
  readonly ownerId: string;
  readonly epoch: number;
  readonly acquiredAtMs: number;
  readonly expiresAtMs: number;
}

export interface RemediationAttemptRecord {
  readonly attemptId: string;
  readonly causeEvidenceIds: readonly string[];
  readonly policyRevision: string;
  readonly localAttempt: number;
  readonly globalAttempt: number;
  readonly startedAtMs: number;
  readonly completedAtMs: number | null;
  readonly beforeState: string;
  readonly action: RemediationAction;
  readonly afterState: string | null;
  readonly result: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
  readonly nextRetryAtMs: number | null;
  readonly circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  readonly costUnits: number;
  readonly concurrencyUnits: number;
  readonly materialEventRef: string;
  readonly cockpitTraceId: string;
}

export interface RemediationCampaign {
  readonly schema: 'PRODUCT_ASSURANCE_REMEDIATION_CAMPAIGN_V1';
  readonly revision: number;
  readonly campaignId: string;
  readonly fingerprint: string;
  readonly policyRevision: string;
  readonly action: RemediationAction;
  readonly state: RemediationState;
  readonly desiredState: string;
  readonly observedState: string;
  readonly lastKnownGoodState: string | null;
  readonly allowedDegradedState: string | null;
  readonly dependencyIds: readonly string[];
  readonly invariantIds: readonly string[];
  readonly triggerEvidenceIds: readonly string[];
  readonly diagnosticConfidence: number | null;
  readonly preconditionIds: readonly string[];
  readonly resourceIds: readonly string[];
  readonly capitalPosture: 'NO_CHANGE' | 'NO_NEW_EXPOSURE' | 'RISK_REDUCTION_ONLY';
  readonly predictedResult: string;
  readonly actionIdentity: string;
  readonly fencingOwnerId: string;
  readonly leaseEpoch: number;
  readonly localAttempt: number;
  readonly maximumLocalAttempts: number;
  readonly globalAttempt: number;
  readonly maximumGlobalAttempts: number;
  readonly elapsedMs: number;
  readonly maximumElapsedMs: number;
  readonly costUnits: number;
  readonly maximumCostUnits: number;
  readonly concurrencyUnits: number;
  readonly maximumConcurrencyUnits: number;
  readonly rollbackAction: string | null;
  readonly compensationAction: string | null;
  readonly independentVerifierId: string | null;
  readonly postconditionIds: readonly string[];
  readonly provedPostconditionIds: readonly string[];
  readonly verifiedAtMs: number | null;
  readonly quietPeriodMs: number;
  readonly nextRetryAtMs: number | null;
  readonly materialEventRef: string | null;
  readonly cockpitTraceId: string;
  readonly attemptRecords: readonly Readonly<RemediationAttemptRecord>[];
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export type RemediationEvent =
  | { readonly kind: 'CONTAIN'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number }
  | { readonly kind: 'DIAGNOSE'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number }
  | { readonly kind: 'PLAN'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number }
  | { readonly kind: 'WAIT_FOR_AUTHORIZATION'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number }
  | { readonly kind: 'AUTHORIZATION_GRANTED'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number }
  | { readonly kind: 'AUTHORIZATION_REJECTED_OR_EXPIRED'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number }
  | { readonly kind: 'EXECUTE'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number; readonly attemptId: string; readonly costUnits: number; readonly concurrencyUnits: number; readonly circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' }
  | { readonly kind: 'ACTION_COMPLETED'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number; readonly afterState: string; readonly result: 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS'; readonly nextRetryAtMs: number | null; readonly materialEventRef: string }
  | { readonly kind: 'POSTCONDITION_PASSED'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number; readonly verifierId: string; readonly postconditionId: string }
  | { readonly kind: 'POSTCONDITION_FAILED'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number; readonly verifierId: string; readonly postconditionId: string }
  | { readonly kind: 'QUIET_PERIOD_ELAPSED'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number; readonly verifierId: string }
  | { readonly kind: 'CANCEL'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number }
  | { readonly kind: 'SUPERSEDE'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number }
  | { readonly kind: 'ROLLBACK'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number }
  | { readonly kind: 'COMPENSATED'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number }
  | { readonly kind: 'COMPENSATION_FAILED'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number }
  | { readonly kind: 'QUARANTINE'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number }
  | { readonly kind: 'EXHAUSTED'; readonly atMs: number; readonly ownerId: string; readonly leaseEpoch: number };

export interface CampaignTransitionResult {
  readonly applied: boolean;
  readonly code: string;
  readonly before: Readonly<RemediationCampaign>;
  readonly after: Readonly<RemediationCampaign>;
}

const TERMINAL_STATES = new Set<RemediationState>([
  'RECOVERED',
  'AUTH_REJECTED_OR_EXPIRED',
  'SUPERSEDED',
  'COMPENSATED',
  'COMPENSATION_FAILED',
  'FAILED_ATTENTION_REQUIRED',
]);

const TRANSITIONS: Readonly<Record<RemediationState, Readonly<Partial<Record<RemediationEvent['kind'], RemediationState>>>>> = Object.freeze({
  DETECTED: Object.freeze({ CONTAIN: 'CONTAINING', QUARANTINE: 'QUARANTINED', EXHAUSTED: 'FAILED_ATTENTION_REQUIRED' }),
  CONTAINING: Object.freeze({ DIAGNOSE: 'DIAGNOSING', QUARANTINE: 'QUARANTINED', CANCEL: 'CANCELLING', EXHAUSTED: 'FAILED_ATTENTION_REQUIRED' }),
  DIAGNOSING: Object.freeze({ PLAN: 'PLANNED', WAIT_FOR_AUTHORIZATION: 'AWAITING_AUTHORIZATION', QUARANTINE: 'QUARANTINED', CANCEL: 'CANCELLING', EXHAUSTED: 'FAILED_ATTENTION_REQUIRED' }),
  PLANNED: Object.freeze({ EXECUTE: 'EXECUTING', WAIT_FOR_AUTHORIZATION: 'AWAITING_AUTHORIZATION', CANCEL: 'CANCELLING', QUARANTINE: 'QUARANTINED', EXHAUSTED: 'FAILED_ATTENTION_REQUIRED' }),
  EXECUTING: Object.freeze({ ACTION_COMPLETED: 'VERIFYING', CANCEL: 'CANCELLING', ROLLBACK: 'ROLLING_BACK', QUARANTINE: 'QUARANTINED', EXHAUSTED: 'FAILED_ATTENTION_REQUIRED' }),
  VERIFYING: Object.freeze({ POSTCONDITION_PASSED: 'VERIFYING', POSTCONDITION_FAILED: 'ROLLING_BACK', QUIET_PERIOD_ELAPSED: 'RECOVERED', CANCEL: 'CANCELLING', QUARANTINE: 'QUARANTINED', EXHAUSTED: 'FAILED_ATTENTION_REQUIRED' }),
  RECOVERED: Object.freeze({}),
  AWAITING_AUTHORIZATION: Object.freeze({ AUTHORIZATION_GRANTED: 'PLANNED', AUTHORIZATION_REJECTED_OR_EXPIRED: 'AUTH_REJECTED_OR_EXPIRED', CANCEL: 'CANCELLING', SUPERSEDE: 'SUPERSEDED' }),
  AUTH_REJECTED_OR_EXPIRED: Object.freeze({}),
  CANCELLING: Object.freeze({ SUPERSEDE: 'SUPERSEDED', ROLLBACK: 'ROLLING_BACK', QUARANTINE: 'QUARANTINED' }),
  SUPERSEDED: Object.freeze({}),
  ROLLING_BACK: Object.freeze({ COMPENSATED: 'COMPENSATED', COMPENSATION_FAILED: 'COMPENSATION_FAILED', QUARANTINE: 'QUARANTINED' }),
  COMPENSATED: Object.freeze({}),
  COMPENSATION_FAILED: Object.freeze({}),
  QUARANTINED: Object.freeze({ EXHAUSTED: 'FAILED_ATTENTION_REQUIRED' }),
  FAILED_ATTENTION_REQUIRED: Object.freeze({}),
});

function validateIdentifierSet(values: readonly string[], label: string, requireNonempty: boolean): void {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  if (requireNonempty && values.length === 0) throw new TypeError(`${label} must be nonempty`);
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique`);
  for (const value of values) assertIdentifier(value, `${label}[]`);
}

function validateResourceLease(lease: Readonly<ResourceLease>, label: string): void {
  assertIdentifier(lease.resourceId, `${label}.resourceId`);
  assertIdentifier(lease.campaignId, `${label}.campaignId`);
  assertIdentifier(lease.ownerId, `${label}.ownerId`);
  assertSafeNonNegativeInteger(lease.epoch, `${label}.epoch`);
  assertUtcMs(lease.acquiredAtMs, `${label}.acquiredAtMs`);
  assertUtcMs(lease.expiresAtMs, `${label}.expiresAtMs`);
  if (lease.expiresAtMs <= lease.acquiredAtMs) throw new TypeError(`${label} expiry must follow acquisition`);
}

export function validateRemediationCampaign(campaign: Readonly<RemediationCampaign>): void {
  if (campaign.schema !== 'PRODUCT_ASSURANCE_REMEDIATION_CAMPAIGN_V1') throw new TypeError('campaign schema unsupported');
  assertSafeNonNegativeInteger(campaign.revision, 'campaign.revision');
  assertIdentifier(campaign.campaignId, 'campaign.campaignId');
  assertIdentifier(campaign.fingerprint, 'campaign.fingerprint');
  assertIdentifier(campaign.policyRevision, 'campaign.policyRevision');
  assertIdentifier(campaign.desiredState, 'campaign.desiredState');
  assertIdentifier(campaign.observedState, 'campaign.observedState');
  if (campaign.lastKnownGoodState !== null) assertIdentifier(campaign.lastKnownGoodState, 'campaign.lastKnownGoodState');
  if (campaign.allowedDegradedState !== null) assertIdentifier(campaign.allowedDegradedState, 'campaign.allowedDegradedState');
  assertIdentifier(campaign.predictedResult, 'campaign.predictedResult');
  assertIdentifier(campaign.actionIdentity, 'campaign.actionIdentity');
  assertIdentifier(campaign.fencingOwnerId, 'campaign.fencingOwnerId');
  assertIdentifier(campaign.cockpitTraceId, 'campaign.cockpitTraceId');
  if (campaign.materialEventRef !== null) assertIdentifier(campaign.materialEventRef, 'campaign.materialEventRef');
  if (campaign.rollbackAction !== null) assertIdentifier(campaign.rollbackAction, 'campaign.rollbackAction');
  if (campaign.compensationAction !== null) assertIdentifier(campaign.compensationAction, 'campaign.compensationAction');
  assertSafeNonNegativeInteger(campaign.leaseEpoch, 'campaign.leaseEpoch');
  assertSafeNonNegativeInteger(campaign.localAttempt, 'campaign.localAttempt');
  assertPositiveSafeInteger(campaign.maximumLocalAttempts, 'campaign.maximumLocalAttempts');
  assertSafeNonNegativeInteger(campaign.globalAttempt, 'campaign.globalAttempt');
  assertPositiveSafeInteger(campaign.maximumGlobalAttempts, 'campaign.maximumGlobalAttempts');
  assertSafeNonNegativeInteger(campaign.elapsedMs, 'campaign.elapsedMs');
  assertPositiveSafeInteger(campaign.maximumElapsedMs, 'campaign.maximumElapsedMs');
  assertSafeNonNegativeInteger(campaign.costUnits, 'campaign.costUnits');
  assertSafeNonNegativeInteger(campaign.maximumCostUnits, 'campaign.maximumCostUnits');
  assertSafeNonNegativeInteger(campaign.concurrencyUnits, 'campaign.concurrencyUnits');
  assertPositiveSafeInteger(campaign.maximumConcurrencyUnits, 'campaign.maximumConcurrencyUnits');
  assertPositiveSafeInteger(campaign.quietPeriodMs, 'campaign.quietPeriodMs');
  assertUtcMs(campaign.createdAtMs, 'campaign.createdAtMs');
  assertUtcMs(campaign.updatedAtMs, 'campaign.updatedAtMs');
  if (campaign.verifiedAtMs !== null) assertUtcMs(campaign.verifiedAtMs, 'campaign.verifiedAtMs');
  if (campaign.nextRetryAtMs !== null) assertUtcMs(campaign.nextRetryAtMs, 'campaign.nextRetryAtMs');
  if (!(REMEDIATION_ACTIONS as readonly string[]).includes(campaign.action)) throw new TypeError('campaign action unsupported');
  if (!(REMEDIATION_STATES as readonly string[]).includes(campaign.state)) throw new TypeError('campaign state unsupported');
  if (!(['NO_CHANGE', 'NO_NEW_EXPOSURE', 'RISK_REDUCTION_ONLY'] as const).includes(campaign.capitalPosture)) throw new TypeError('campaign capitalPosture unsupported');
  if (campaign.diagnosticConfidence !== null
    && (!Number.isFinite(campaign.diagnosticConfidence) || campaign.diagnosticConfidence < 0 || campaign.diagnosticConfidence > 1)) {
    throw new TypeError('campaign diagnosticConfidence must be null or in [0,1]');
  }
  if (campaign.updatedAtMs < campaign.createdAtMs) throw new TypeError('campaign updatedAtMs cannot predate createdAtMs');
  if (campaign.elapsedMs !== campaign.updatedAtMs - campaign.createdAtMs) throw new TypeError('campaign elapsedMs must equal updatedAtMs-createdAtMs');
  if (campaign.localAttempt > campaign.maximumLocalAttempts || campaign.globalAttempt > campaign.maximumGlobalAttempts) throw new TypeError('campaign attempt budget exceeded');
  if (campaign.costUnits > campaign.maximumCostUnits) throw new TypeError('campaign cost budget exceeded');
  if (campaign.concurrencyUnits > campaign.maximumConcurrencyUnits) throw new TypeError('campaign concurrency budget exceeded');
  if (campaign.verifiedAtMs !== null && campaign.verifiedAtMs > campaign.updatedAtMs) {
    throw new TypeError('campaign verifiedAtMs cannot follow updatedAtMs');
  }
  validateIdentifierSet(campaign.dependencyIds, 'campaign.dependencyIds', true);
  validateIdentifierSet(campaign.invariantIds, 'campaign.invariantIds', true);
  validateIdentifierSet(campaign.triggerEvidenceIds, 'campaign.triggerEvidenceIds', true);
  validateIdentifierSet(campaign.preconditionIds, 'campaign.preconditionIds', true);
  if (campaign.resourceIds.length === 0) throw new TypeError('campaign resourceIds must be nonempty');
  if (new Set(campaign.resourceIds).size !== campaign.resourceIds.length) throw new TypeError('campaign resourceIds must be unique');
  if (campaign.resourceIds.join('\n') !== [...campaign.resourceIds].sort().join('\n')) throw new TypeError('campaign resourceIds must be sorted for atomic acquisition');
  for (const resourceId of campaign.resourceIds) assertIdentifier(resourceId, 'campaign.resourceIds[]');
  if (campaign.postconditionIds.length === 0) throw new TypeError('campaign postconditionIds must be nonempty');
  if (new Set(campaign.postconditionIds).size !== campaign.postconditionIds.length) throw new TypeError('campaign postconditionIds must be unique');
  if (campaign.postconditionIds.join('\n') !== [...campaign.postconditionIds].sort().join('\n')) throw new TypeError('campaign postconditionIds must be sorted');
  for (const postconditionId of campaign.postconditionIds) assertIdentifier(postconditionId, 'campaign.postconditionIds[]');
  if (new Set(campaign.provedPostconditionIds).size !== campaign.provedPostconditionIds.length) throw new TypeError('campaign provedPostconditionIds must be unique');
  if (campaign.provedPostconditionIds.join('\n') !== [...campaign.provedPostconditionIds].sort().join('\n')) throw new TypeError('campaign provedPostconditionIds must be sorted');
  if (campaign.provedPostconditionIds.some((postconditionId) => !campaign.postconditionIds.includes(postconditionId))) {
    throw new TypeError('campaign provedPostconditionIds must be declared postconditions');
  }
  if (campaign.independentVerifierId === null) throw new TypeError('campaign independentVerifierId is required');
  assertIdentifier(campaign.independentVerifierId, 'campaign.independentVerifierId');
  if (campaign.independentVerifierId === campaign.fencingOwnerId) throw new TypeError('campaign independentVerifierId must differ from fencingOwnerId');
  if (!Array.isArray(campaign.attemptRecords)) throw new TypeError('campaign.attemptRecords must be an array');
  const attemptIds = campaign.attemptRecords.map((attempt) => attempt.attemptId);
  if (new Set(attemptIds).size !== attemptIds.length) throw new TypeError('campaign attempt IDs must be unique');
  let aggregateCost = 0;
  for (const [index, attempt] of campaign.attemptRecords.entries()) {
    const label = `campaign.attemptRecords[${index}]`;
    assertIdentifier(attempt.attemptId, `${label}.attemptId`);
    validateIdentifierSet(attempt.causeEvidenceIds, `${label}.causeEvidenceIds`, true);
    assertIdentifier(attempt.policyRevision, `${label}.policyRevision`);
    if (attempt.policyRevision !== campaign.policyRevision) throw new TypeError(`${label} policy revision mismatch`);
    assertPositiveSafeInteger(attempt.localAttempt, `${label}.localAttempt`);
    assertPositiveSafeInteger(attempt.globalAttempt, `${label}.globalAttempt`);
    assertUtcMs(attempt.startedAtMs, `${label}.startedAtMs`);
    if (attempt.completedAtMs !== null) {
      assertUtcMs(attempt.completedAtMs, `${label}.completedAtMs`);
      if (attempt.completedAtMs < attempt.startedAtMs) throw new TypeError(`${label} completion predates start`);
    }
    assertIdentifier(attempt.beforeState, `${label}.beforeState`);
    if (!(REMEDIATION_ACTIONS as readonly unknown[]).includes(attempt.action)) throw new TypeError(`${label} action unsupported`);
    if (attempt.afterState !== null) assertIdentifier(attempt.afterState, `${label}.afterState`);
    if (!(['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'AMBIGUOUS'] as const).includes(attempt.result)) throw new TypeError(`${label} result unsupported`);
    if ((attempt.result === 'IN_PROGRESS') !== (attempt.completedAtMs === null)) throw new TypeError(`${label} completion/result mismatch`);
    if ((attempt.result === 'IN_PROGRESS') !== (attempt.afterState === null)) throw new TypeError(`${label} afterState/result mismatch`);
    if (attempt.nextRetryAtMs !== null) assertUtcMs(attempt.nextRetryAtMs, `${label}.nextRetryAtMs`);
    if (!(['CLOSED', 'OPEN', 'HALF_OPEN'] as const).includes(attempt.circuitState)) throw new TypeError(`${label} circuitState unsupported`);
    assertSafeNonNegativeInteger(attempt.costUnits, `${label}.costUnits`);
    assertPositiveSafeInteger(attempt.concurrencyUnits, `${label}.concurrencyUnits`);
    if (attempt.concurrencyUnits > campaign.maximumConcurrencyUnits) throw new TypeError(`${label} concurrency exceeds campaign budget`);
    assertIdentifier(attempt.materialEventRef, `${label}.materialEventRef`);
    assertIdentifier(attempt.cockpitTraceId, `${label}.cockpitTraceId`);
    aggregateCost += attempt.costUnits;
  }
  if (aggregateCost !== campaign.costUnits) throw new TypeError('campaign costUnits must equal durable attempt cost total');
  const inProgress = campaign.attemptRecords.filter((attempt) => attempt.result === 'IN_PROGRESS');
  if (inProgress.length > 1) throw new TypeError('campaign cannot have multiple in-progress attempts');
  if ((campaign.state === 'EXECUTING') !== (inProgress.length === 1)) throw new TypeError('campaign EXECUTING state must match one in-progress attempt');
  if (campaign.concurrencyUnits !== (inProgress[0]?.concurrencyUnits ?? 0)) throw new TypeError('campaign concurrencyUnits must match active attempt');
  const allPostconditionsProved = campaign.provedPostconditionIds.length === campaign.postconditionIds.length
    && campaign.postconditionIds.every((postconditionId, index) => campaign.provedPostconditionIds[index] === postconditionId);
  if ((campaign.verifiedAtMs === null) === allPostconditionsProved) {
    throw new TypeError('campaign verifiedAtMs must exist exactly when every postcondition is proved');
  }
}

function unchanged(campaign: Readonly<RemediationCampaign>, code: string): Readonly<CampaignTransitionResult> {
  return Object.freeze({ applied: false, code, before: campaign, after: campaign });
}

export function transitionRemediationCampaign(
  campaign: Readonly<RemediationCampaign>,
  event: Readonly<RemediationEvent>,
  activeLeases: readonly Readonly<ResourceLease>[],
): Readonly<CampaignTransitionResult> {
  validateRemediationCampaign(campaign);
  assertUtcMs(event.atMs, 'event.atMs');
  assertIdentifier(event.ownerId, 'event.ownerId');
  assertSafeNonNegativeInteger(event.leaseEpoch, 'event.leaseEpoch');
  if (!Array.isArray(activeLeases)) throw new TypeError('activeLeases must be an array');
  for (const [index, lease] of activeLeases.entries()) validateResourceLease(lease, `activeLeases[${index}]`);
  if (event.atMs <= campaign.updatedAtMs) return unchanged(campaign, 'STALE_EVENT_TIME');
  if (TERMINAL_STATES.has(campaign.state)) return unchanged(campaign, 'CAMPAIGN_ALREADY_TERMINAL');
  const matchingLeases = campaign.resourceIds.map((resourceId) => activeLeases.filter((lease) => lease.resourceId === resourceId));
  if (matchingLeases.some((leases) => leases.length === 0)) return unchanged(campaign, 'RESOURCE_LEASE_MISSING');
  if (matchingLeases.some((leases) => leases.length !== 1)) return unchanged(campaign, 'RESOURCE_LEASE_AMBIGUOUS');
  const leases = matchingLeases.map(([lease]) => lease);
  if (leases.some((lease) => lease?.campaignId !== campaign.campaignId || lease.ownerId !== event.ownerId || lease.epoch !== event.leaseEpoch)) {
    return unchanged(campaign, 'STALE_OR_FOREIGN_LEASE_OWNER');
  }
  if (leases.some((lease) => event.atMs < (lease?.acquiredAtMs ?? Number.MAX_SAFE_INTEGER))) return unchanged(campaign, 'RESOURCE_LEASE_NOT_ACTIVE');
  if (leases.some((lease) => event.atMs >= (lease?.expiresAtMs ?? 0))) return unchanged(campaign, 'RESOURCE_LEASE_EXPIRED');
  if (event.ownerId !== campaign.fencingOwnerId || event.leaseEpoch !== campaign.leaseEpoch) return unchanged(campaign, 'CAMPAIGN_FENCE_MISMATCH');
  const nextState = TRANSITIONS[campaign.state][event.kind];
  if (nextState === undefined) return unchanged(campaign, 'ILLEGAL_CAMPAIGN_TRANSITION');

  if (event.kind === 'POSTCONDITION_PASSED' || event.kind === 'POSTCONDITION_FAILED' || event.kind === 'QUIET_PERIOD_ELAPSED') {
    assertIdentifier(event.verifierId, 'event.verifierId');
    if (event.verifierId === campaign.fencingOwnerId) return unchanged(campaign, 'POSTCONDITION_VERIFIER_NOT_INDEPENDENT');
    if (event.verifierId !== campaign.independentVerifierId) return unchanged(campaign, 'POSTCONDITION_VERIFIER_MISMATCH');
  }
  if (event.kind === 'POSTCONDITION_PASSED' || event.kind === 'POSTCONDITION_FAILED') {
    assertIdentifier(event.postconditionId, 'event.postconditionId');
    if (!campaign.postconditionIds.includes(event.postconditionId)) return unchanged(campaign, 'POSTCONDITION_NOT_DECLARED');
    if (event.kind === 'POSTCONDITION_PASSED' && campaign.provedPostconditionIds.includes(event.postconditionId)) {
      return unchanged(campaign, 'POSTCONDITION_ALREADY_PROVED');
    }
  }
  if (event.kind === 'QUIET_PERIOD_ELAPSED') {
    if (campaign.verifiedAtMs === null) return unchanged(campaign, 'POSTCONDITION_NOT_PROVED');
    if (campaign.provedPostconditionIds.length !== campaign.postconditionIds.length
      || !campaign.postconditionIds.every((postconditionId, index) => campaign.provedPostconditionIds[index] === postconditionId)) {
      return unchanged(campaign, 'POSTCONDITION_SET_INCOMPLETE');
    }
    if (event.atMs - campaign.verifiedAtMs < campaign.quietPeriodMs) return unchanged(campaign, 'QUIET_PERIOD_NOT_ELAPSED');
  }
  if (event.kind === 'EXECUTE') {
    assertIdentifier(event.attemptId, 'event.attemptId');
    assertSafeNonNegativeInteger(event.costUnits, 'event.costUnits');
    assertPositiveSafeInteger(event.concurrencyUnits, 'event.concurrencyUnits');
    if (!(['CLOSED', 'OPEN', 'HALF_OPEN'] as const).includes(event.circuitState)) throw new TypeError('event.circuitState unsupported');
    if (campaign.attemptRecords.some((attempt) => attempt.attemptId === event.attemptId)) return unchanged(campaign, 'ATTEMPT_ID_REUSED');
    const elapsedAtEvent = event.atMs - campaign.createdAtMs;
    const exhausted = campaign.localAttempt + 1 > campaign.maximumLocalAttempts
      || campaign.globalAttempt + 1 > campaign.maximumGlobalAttempts
      || elapsedAtEvent >= campaign.maximumElapsedMs
      || campaign.costUnits + event.costUnits > campaign.maximumCostUnits
      || event.concurrencyUnits > campaign.maximumConcurrencyUnits;
    if (exhausted) return unchanged(campaign, 'CAMPAIGN_BUDGET_EXHAUSTED');
    if (campaign.materialEventRef === null) return unchanged(campaign, 'MATERIAL_EVENT_REF_MISSING');
  }
  if (event.kind === 'ACTION_COMPLETED') {
    assertIdentifier(event.afterState, 'event.afterState');
    if (!(['SUCCEEDED', 'FAILED', 'AMBIGUOUS'] as const).includes(event.result)) throw new TypeError('event.result unsupported');
    if (event.nextRetryAtMs !== null) {
      assertUtcMs(event.nextRetryAtMs, 'event.nextRetryAtMs');
      if (event.nextRetryAtMs <= event.atMs) throw new TypeError('event.nextRetryAtMs must follow completion');
    }
    assertIdentifier(event.materialEventRef, 'event.materialEventRef');
  }

  const provedPostconditionIds = event.kind === 'POSTCONDITION_PASSED'
    ? sortedUnique([...campaign.provedPostconditionIds, event.postconditionId])
    : event.kind === 'POSTCONDITION_FAILED' ? Object.freeze([]) : campaign.provedPostconditionIds;
  const allPostconditionsProved = provedPostconditionIds.length === campaign.postconditionIds.length
    && campaign.postconditionIds.every((postconditionId, index) => provedPostconditionIds[index] === postconditionId);
  const verifiedAtMs = event.kind === 'POSTCONDITION_PASSED'
    ? allPostconditionsProved ? event.atMs : null
    : event.kind === 'POSTCONDITION_FAILED' ? null : campaign.verifiedAtMs;
  let attemptRecords: readonly Readonly<RemediationAttemptRecord>[] = campaign.attemptRecords;
  if (event.kind === 'EXECUTE') {
    attemptRecords = Object.freeze([...campaign.attemptRecords, Object.freeze({
      attemptId: event.attemptId,
      causeEvidenceIds: Object.freeze([...campaign.triggerEvidenceIds]),
      policyRevision: campaign.policyRevision,
      localAttempt: campaign.localAttempt + 1,
      globalAttempt: campaign.globalAttempt + 1,
      startedAtMs: event.atMs,
      completedAtMs: null,
      beforeState: campaign.observedState,
      action: campaign.action,
      afterState: null,
      result: 'IN_PROGRESS' as const,
      nextRetryAtMs: null,
      circuitState: event.circuitState,
      costUnits: event.costUnits,
      concurrencyUnits: event.concurrencyUnits,
      materialEventRef: campaign.materialEventRef as string,
      cockpitTraceId: campaign.cockpitTraceId,
    })]);
  } else if (campaign.state === 'EXECUTING') {
    const result = event.kind === 'ACTION_COMPLETED' ? event.result : 'FAILED';
    const afterState = event.kind === 'ACTION_COMPLETED' ? event.afterState : campaign.observedState;
    attemptRecords = Object.freeze(campaign.attemptRecords.map((attempt) => attempt.result === 'IN_PROGRESS'
      ? Object.freeze({
        ...attempt,
        completedAtMs: event.atMs,
        afterState,
        result,
        nextRetryAtMs: event.kind === 'ACTION_COMPLETED' ? event.nextRetryAtMs : null,
        materialEventRef: event.kind === 'ACTION_COMPLETED' ? event.materialEventRef : attempt.materialEventRef,
      })
      : attempt));
  }
  const after = Object.freeze({
    ...campaign,
    revision: campaign.revision + 1,
    state: nextState,
    provedPostconditionIds,
    verifiedAtMs,
    localAttempt: event.kind === 'EXECUTE' ? campaign.localAttempt + 1 : campaign.localAttempt,
    globalAttempt: event.kind === 'EXECUTE' ? campaign.globalAttempt + 1 : campaign.globalAttempt,
    elapsedMs: event.atMs - campaign.createdAtMs,
    costUnits: event.kind === 'EXECUTE' ? campaign.costUnits + event.costUnits : campaign.costUnits,
    concurrencyUnits: nextState === 'EXECUTING' && event.kind === 'EXECUTE' ? event.concurrencyUnits : 0,
    observedState: event.kind === 'ACTION_COMPLETED' ? event.afterState : campaign.observedState,
    nextRetryAtMs: event.kind === 'ACTION_COMPLETED' ? event.nextRetryAtMs : campaign.nextRetryAtMs,
    materialEventRef: event.kind === 'ACTION_COMPLETED' ? event.materialEventRef : campaign.materialEventRef,
    attemptRecords,
    updatedAtMs: event.atMs,
  });
  validateRemediationCampaign(after);
  return Object.freeze({ applied: true, code: 'CAMPAIGN_TRANSITION_APPLIED', before: campaign, after });
}

export interface LeaseAcquisitionResult {
  readonly granted: boolean;
  readonly code: string;
  readonly leases: readonly Readonly<ResourceLease>[];
  readonly conflictingCampaignIds: readonly string[];
}

export function acquireResourceSet(
  request: Readonly<{
    campaignId: string;
    ownerId: string;
    epoch: number;
    resourceIds: readonly string[];
    acquiredAtMs: number;
    expiresAtMs: number;
  }>,
  existing: readonly Readonly<ResourceLease>[],
): Readonly<LeaseAcquisitionResult> {
  assertIdentifier(request.campaignId, 'request.campaignId');
  assertIdentifier(request.ownerId, 'request.ownerId');
  assertSafeNonNegativeInteger(request.epoch, 'request.epoch');
  assertUtcMs(request.acquiredAtMs, 'request.acquiredAtMs');
  assertUtcMs(request.expiresAtMs, 'request.expiresAtMs');
  if (request.expiresAtMs <= request.acquiredAtMs) throw new TypeError('lease expiry must follow acquisition');
  const resources = sortedUnique(request.resourceIds);
  if (resources.length === 0) throw new TypeError('resource set must be nonempty');
  if (resources.length !== request.resourceIds.length) throw new TypeError('resource set contains duplicates');
  if (request.resourceIds.join('\n') !== resources.join('\n')) throw new TypeError('resource set must be sorted');
  for (const resourceId of resources) assertIdentifier(resourceId, 'request.resourceIds[]');
  if (!Array.isArray(existing)) throw new TypeError('existing leases must be an array');
  for (const [index, lease] of existing.entries()) validateResourceLease(lease, `existing[${index}]`);
  const sameCampaignFenceMismatch = existing.filter((lease) => lease.campaignId === request.campaignId
    && (lease.ownerId !== request.ownerId || lease.epoch !== request.epoch));
  if (sameCampaignFenceMismatch.length > 0) {
    return Object.freeze({
      granted: false,
      code: 'CAMPAIGN_FENCE_REACQUISITION_MISMATCH',
      leases: Object.freeze([]),
      conflictingCampaignIds: Object.freeze([request.campaignId]),
    });
  }
  const conflicts = existing.filter((lease) => resources.includes(lease.resourceId) && lease.expiresAtMs > request.acquiredAtMs && lease.campaignId !== request.campaignId);
  if (conflicts.length > 0) {
    return Object.freeze({ granted: false, code: 'RESOURCE_SET_CONFLICT', leases: Object.freeze([]), conflictingCampaignIds: sortedUnique(conflicts.map((lease) => lease.campaignId)) });
  }
  const leases = resources.map((resourceId) => Object.freeze({
    resourceId,
    campaignId: request.campaignId,
    ownerId: request.ownerId,
    epoch: request.epoch,
    acquiredAtMs: request.acquiredAtMs,
    expiresAtMs: request.expiresAtMs,
  }));
  return Object.freeze({ granted: true, code: 'RESOURCE_SET_ACQUIRED_ATOMICALLY', leases: Object.freeze(leases), conflictingCampaignIds: Object.freeze([]) });
}

export interface RepairConflictEdge {
  readonly leftCampaignId: string;
  readonly rightCampaignId: string;
  readonly sharedResourceIds: readonly string[];
}

export function buildRepairConflictGraph(
  campaigns: readonly Readonly<RemediationCampaign>[],
): readonly Readonly<RepairConflictEdge>[] {
  const edges: RepairConflictEdge[] = [];
  for (let leftIndex = 0; leftIndex < campaigns.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < campaigns.length; rightIndex += 1) {
      const left = campaigns[leftIndex];
      const right = campaigns[rightIndex];
      if (!left || !right) continue;
      const shared = sortedUnique(left.resourceIds.filter((id) => right.resourceIds.includes(id)));
      if (shared.length > 0) edges.push(Object.freeze({ leftCampaignId: left.campaignId, rightCampaignId: right.campaignId, sharedResourceIds: shared }));
    }
  }
  return Object.freeze(edges.sort((a, b) => `${a.leftCampaignId}:${a.rightCampaignId}`.localeCompare(`${b.leftCampaignId}:${b.rightCampaignId}`)));
}

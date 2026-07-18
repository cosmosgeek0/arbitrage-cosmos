import type {
  ValidateOnlyRunSnapshot,
} from './types.js';

export const SYSTEM_RECOVERY_CAMPAIGN_SCHEMA =
  'cosmos.system-integration.recovery-campaign.v1' as const;

export interface DatabaseFailureBeforeSendCampaign {
  readonly schema: typeof SYSTEM_RECOVERY_CAMPAIGN_SCHEMA;
  readonly scenario: 'DATABASE_FAILURE_BEFORE_SEND';
  readonly rootCorrelationId: string;
  readonly recordId: string;
  readonly disposition: 'BLOCKED_BEFORE_SEND';
  readonly persistenceOutcome: 'DATABASE_READ_FAILED';
  readonly failureCode: 'APPROVAL_STATE_READ_FAILED';
  readonly approvalEvaluations: 0;
  readonly riskEvaluations: 0;
  readonly coordinatorsCreated: 0;
  readonly coordinatorPreflights: 0;
  readonly venueCalls: 0;
  readonly submissionCalls: 0;
  readonly executionAuthority: 'NONE';
  readonly sendCapability: 'ABSENT';
}

function venueCallCount(snapshot: Readonly<ValidateOnlyRunSnapshot>): number {
  const audit = snapshot.venueAudit;
  return audit.identityClaims
    + audit.preflightCalls
    + audit.validationCalls
    + audit.submissionCalls
    + audit.lookupCalls
    + audit.reconciliationCalls;
}

/**
 * Projects one exact canonical-owner campaign result. The Foundation risk and
 * execution owners must be untouched and the sealed venue must have observed
 * no call of any kind. A structural L12 fixture cannot satisfy this proof.
 */
export function projectDatabaseFailureBeforeSendCampaign(
  snapshot: Readonly<ValidateOnlyRunSnapshot>,
): Readonly<DatabaseFailureBeforeSendCampaign> {
  const calls = snapshot.ownerInvocations;
  const venueCalls = venueCallCount(snapshot);
  if (
    snapshot.schema !== 'cosmos.system-integration.validate-only.v2'
    || snapshot.disposition !== 'PERSISTENCE_FAILED'
    || snapshot.failure?.code !== 'APPROVAL_STATE_READ_FAILED'
    || calls.persistenceReads !== 1
    || calls.persistenceWrites !== 1
    || calls.approvalEvaluations !== 0
    || calls.approvalUseReductions !== 0
    || calls.riskEvaluations !== 0
    || calls.executionDefinitionsCreated !== 0
    || calls.coordinatorsCreated !== 0
    || calls.coordinatorPreflights !== 0
    || calls.reconciliationEvaluations !== 0
    || calls.recoveryEvaluations !== 0
    || venueCalls !== 0
    || snapshot.executionPlan !== null
    || snapshot.executionState !== null
    || snapshot.riskVerdict !== null
    || snapshot.executionAuthority !== 'NONE'
    || snapshot.liveExecutionPermitted !== false
  ) {
    throw new TypeError('DATABASE_FAILURE_BEFORE_SEND requires an exact zero-effect canonical owner result');
  }

  return Object.freeze({
    schema: SYSTEM_RECOVERY_CAMPAIGN_SCHEMA,
    scenario: 'DATABASE_FAILURE_BEFORE_SEND' as const,
    rootCorrelationId: snapshot.rootCorrelationId,
    recordId: snapshot.recordId,
    disposition: 'BLOCKED_BEFORE_SEND' as const,
    persistenceOutcome: 'DATABASE_READ_FAILED' as const,
    failureCode: 'APPROVAL_STATE_READ_FAILED' as const,
    approvalEvaluations: 0 as const,
    riskEvaluations: 0 as const,
    coordinatorsCreated: 0 as const,
    coordinatorPreflights: 0 as const,
    venueCalls: 0 as const,
    submissionCalls: 0 as const,
    executionAuthority: 'NONE' as const,
    sendCapability: 'ABSENT' as const,
  });
}

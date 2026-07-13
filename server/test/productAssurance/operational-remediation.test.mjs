import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPERATION_POLICY_REGISTRY,
  acquireResourceSet,
  buildRepairConflictGraph,
  evaluateWatchdogDelivery,
  projectExecutionLease,
  projectIndependentSentinel,
  projectTelemetryPipeline,
  projectTemporalCoherence,
  transitionRemediationCampaign,
  validateRemediationCampaign,
} from '../../dist/productAssurance/index.js';
import {
  NOW,
  campaign,
  campaignLeases,
  digest,
  stepCampaign,
} from './helpers.mjs';

test('operation policies expose rate-budget owner WAITING seams only', () => {
  assert.ok(OPERATION_POLICY_REGISTRY.length > 0);
  for (const policy of OPERATION_POLICY_REGISTRY) {
    assert.deepEqual(policy.rateBudget, {
      surface: 'RATE_BUDGET',
      ownerId: 'INTELLIGENCE_RUNTIME_RATE_BUDGET',
      contractState: 'OWNER_CONTRACT_WAITING',
      priority: null,
      reserveUnits: null,
      cooldownBehavior: 'OWNER_CONTRACT_WAITING',
    });
  }
});

function apply(current, leases, kind, offsetMs, extra = {}) {
  const result = transitionRemediationCampaign(current, stepCampaign(current, leases, kind, offsetMs, extra), leases);
  assert.equal(result.applied, true, `${kind}: ${result.code}`);
  return result.after;
}

test('cross-market skew and sequence gaps invalidate temporal coherence', () => {
  const base = {
    sourceEventTimeMs: NOW - 50, receiveTimeMs: NOW - 40, processTimeMs: NOW - 30,
    sendTimeMs: NOW - 20, acknowledgementTimeMs: NOW - 10,
    hostClockOffsetMs: 5, hostClockObservedAtMs: NOW - 10,
    exchangeClockOffsetMs: 10, exchangeClockObservedAtMs: NOW - 10,
    spotEventTimeMs: NOW - 50, usdmEventTimeMs: NOW - 45,
    maximumCrossMarketSkewMs: 100, maximumObservationAgeMs: 10_000,
    maximumAbsoluteHostClockOffsetMs: 100, maximumAbsoluteExchangeClockOffsetMs: 100,
    continuityWatermark: 'SEQUENCE_42', continuityProven: true,
  };
  assert.equal(projectTemporalCoherence(base, NOW).verdict, 'PASS');
  assert.equal(projectTemporalCoherence({ ...base, usdmEventTimeMs: NOW - 500 }, NOW).verdict, 'FAIL');
  assert.throws(() => projectTemporalCoherence({ ...base, hostClockOffsetMs: Number.NaN }, NOW));
  assert.equal(projectTemporalCoherence({ ...base, acknowledgementTimeMs: NOW + 1 }, NOW).verdict, 'FAIL');
  assert.equal(projectTemporalCoherence({
    ...base,
    sourceEventTimeMs: NOW - 86_400_000,
    receiveTimeMs: NOW - 40,
    spotEventTimeMs: NOW - 86_400_000,
    usdmEventTimeMs: NOW - 86_400_000,
  }, NOW).verdict, 'FAIL');
  assert.equal(projectTemporalCoherence({ ...base, hostClockObservedAtMs: NOW - base.maximumObservationAgeMs }, NOW).verdict, 'FAIL');
  const gap = projectTemporalCoherence({ ...base, continuityWatermark: null, continuityProven: false }, NOW);
  assert.equal(gap.verdict, 'FAIL');
  assert.ok(gap.reasonCodes.includes('CONTINUITY_NOT_PROVEN'));
});

test('duplicate executor loses fencing and exact expiry is inactive', () => {
  const base = {
    configured: true, ownerId: 'EXECUTOR_A', epoch: 4,
    processIdentity: 'PROCESS_A', releaseIdentity: 'RELEASE_A',
    renewedAtMs: NOW - 1_000, expiresAtMs: NOW + 1_000, competingOwnerIds: [],
  };
  assert.equal(projectExecutionLease(base, NOW).verdict, 'PASS');
  const duplicate = projectExecutionLease({ ...base, competingOwnerIds: ['EXECUTOR_B'] }, NOW);
  assert.equal(duplicate.verdict, 'FAIL');
  assert.equal(duplicate.active, false);
  assert.equal(projectExecutionLease({ ...base, expiresAtMs: NOW }, NOW).verdict, 'FAIL');
  assert.equal(projectExecutionLease({ ...base, configured: false }, NOW).verdict, 'UNKNOWN');
});

test('independent sentinel defeats self-reported green and empty sentinel is unknown', () => {
  assert.equal(projectIndependentSentinel([], NOW).verdict, 'UNKNOWN');
  const result = projectIndependentSentinel([{
    checkId: 'CHECK_LEDGER', producerId: 'LEDGER', verifierId: 'BLACK_BOX',
    selfReportedVerdict: 'PASS', independentVerdict: 'FAIL', checkedAtMs: NOW - 1,
    maximumAgeMs: 10_000, capitalCritical: true,
  }], NOW);
  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(result.disagreements, ['CHECK_LEDGER']);
});

test('telemetry exporter failure remains visible while ledger evidence is preserved', () => {
  const result = projectTelemetryPipeline({
    schemaCompatible: true, queueDepth: 100, queueCapacity: 100,
    droppedRecords: 2, retryCount: 3, persistentBufferConfigured: true,
    lastExportAtMs: NOW - 60_000, maximumExportAgeMs: 10_000,
    retentionProven: true, ledgerEvidenceAvailable: true,
  }, NOW);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.ledgerEvidencePreserved, true);
  assert.ok(result.reasonCodes.includes('TELEMETRY_RECORDS_DROPPED'));
  assert.throws(() => projectTelemetryPipeline({
    schemaCompatible: true, queueDepth: 0, queueCapacity: 1, droppedRecords: -1,
    retryCount: 0, persistentBufferConfigured: true, lastExportAtMs: NOW,
    maximumExportAgeMs: 1_000, retentionProven: true, ledgerEvidenceAvailable: true,
  }, NOW));
});

test('watchdog requires a fresh cryptographic delivery receipt', () => {
  assert.equal(evaluateWatchdogDelivery(null, NOW).verdict, 'UNKNOWN');
  const valid = {
    notificationId: 'WATCHDOG_1', sentAtMs: NOW - 2_000, deliveredAtMs: NOW - 1_000,
    channelId: 'CHANNEL_PRIMARY', deliveryDigest: digest('watchdog-delivery'), maximumAgeMs: 10_000,
  };
  assert.equal(evaluateWatchdogDelivery(valid, NOW).verdict, 'PASS');
  assert.equal(evaluateWatchdogDelivery({ ...valid, deliveredAtMs: null, deliveryDigest: null }, NOW).verdict, 'UNKNOWN');
  assert.equal(evaluateWatchdogDelivery({ ...valid, deliveredAtMs: NOW - 10_000 }, NOW).verdict, 'FAIL');
  assert.throws(() => evaluateWatchdogDelivery({ ...valid, channelId: '', deliveryDigest: '' }, NOW));
});

test('remediation survives restart and needs exact independent postconditions plus quiet period', () => {
  let current = campaign();
  validateRemediationCampaign(current);
  const leases = campaignLeases(current);
  current = apply(current, leases, 'CONTAIN', 1);
  current = apply(current, leases, 'DIAGNOSE', 2);
  current = apply(current, leases, 'PLAN', 3);
  current = apply(current, leases, 'EXECUTE', 4);
  current = apply(current, leases, 'ACTION_COMPLETED', 5);
  assert.equal(current.state, 'VERIFYING');

  const premature = transitionRemediationCampaign(current, stepCampaign(current, leases, 'QUIET_PERIOD_ELAPSED', 6, { verifierId: current.independentVerifierId }), leases);
  assert.equal(premature.applied, false);
  assert.equal(premature.code, 'POSTCONDITION_NOT_PROVED');

  current = apply(current, leases, 'POSTCONDITION_PASSED', 7, {
    verifierId: current.independentVerifierId, postconditionId: 'POSTCONDITION_CONTINUITY',
  });
  assert.equal(current.verifiedAtMs, null);
  current = structuredClone(JSON.parse(JSON.stringify(current)));
  validateRemediationCampaign(current);
  current = apply(current, leases, 'POSTCONDITION_PASSED', 8, {
    verifierId: current.independentVerifierId, postconditionId: 'POSTCONDITION_SENTINEL',
  });
  assert.equal(current.verifiedAtMs, NOW + 8);
  const tooSoon = transitionRemediationCampaign(current, stepCampaign(current, leases, 'QUIET_PERIOD_ELAPSED', 9, { verifierId: current.independentVerifierId }), leases);
  assert.equal(tooSoon.code, 'QUIET_PERIOD_NOT_ELAPSED');
  current = apply(current, leases, 'QUIET_PERIOD_ELAPSED', 8 + current.quietPeriodMs, { verifierId: current.independentVerifierId });
  assert.equal(current.state, 'RECOVERED');
});

test('resource leases are atomic and reject conflicting or handed-off owners', () => {
  const first = acquireResourceSet({
    campaignId: 'CAMPAIGN_A', ownerId: 'OWNER_A', epoch: 1,
    resourceIds: ['RESOURCE_A', 'RESOURCE_B'], acquiredAtMs: NOW, expiresAtMs: NOW + 10_000,
  }, []);
  assert.equal(first.granted, true);
  const conflict = acquireResourceSet({
    campaignId: 'CAMPAIGN_B', ownerId: 'OWNER_B', epoch: 1,
    resourceIds: ['RESOURCE_B', 'RESOURCE_C'], acquiredAtMs: NOW + 1, expiresAtMs: NOW + 10_000,
  }, first.leases);
  assert.equal(conflict.granted, false);
  assert.deepEqual(conflict.leases, []);
  const handoff = acquireResourceSet({
    campaignId: 'CAMPAIGN_A', ownerId: 'OWNER_NEW', epoch: 2,
    resourceIds: ['RESOURCE_A'], acquiredAtMs: NOW + 1, expiresAtMs: NOW + 10_000,
  }, first.leases);
  assert.equal(handoff.code, 'CAMPAIGN_FENCE_REACQUISITION_MISMATCH');
  assert.throws(() => acquireResourceSet({
    campaignId: 'CAMPAIGN_EMPTY', ownerId: 'OWNER_A', epoch: 1,
    resourceIds: [], acquiredAtMs: NOW, expiresAtMs: NOW + 1,
  }, []));
});

test('expired handoff cannot complete and conflicting repairs are visible', () => {
  const executing = campaign({ state: 'EXECUTING', revision: 5, localAttempt: 1, globalAttempt: 1, updatedAtMs: NOW + 5 });
  const expiredLeases = campaignLeases(executing, { expiresAtMs: NOW + 10 });
  const stale = transitionRemediationCampaign(executing, stepCampaign(executing, expiredLeases, 'ACTION_COMPLETED', 10), expiredLeases);
  assert.equal(stale.applied, false);
  assert.equal(stale.code, 'RESOURCE_LEASE_EXPIRED');
  const other = campaign({ campaignId: 'CAMPAIGN_002', fingerprint: 'FINGERPRINT_OTHER' });
  const graph = buildRepairConflictGraph([campaign(), other]);
  assert.equal(graph.length, 1);
  assert.deepEqual(graph[0].sharedResourceIds, ['RESOURCE_PUBLIC_SPOT_STREAM']);
});

test('authorization, cancellation, rollback, and compensation failure remain durable states', () => {
  const base = campaign();
  const leases = campaignLeases(base);
  let awaiting = apply(base, leases, 'CONTAIN', 1);
  awaiting = apply(awaiting, leases, 'DIAGNOSE', 2);
  awaiting = apply(awaiting, leases, 'WAIT_FOR_AUTHORIZATION', 3);
  assert.equal(awaiting.state, 'AWAITING_AUTHORIZATION');
  const rejected = apply(awaiting, leases, 'AUTHORIZATION_REJECTED_OR_EXPIRED', 4);
  assert.equal(rejected.state, 'AUTH_REJECTED_OR_EXPIRED');

  let cancelling = apply(base, leases, 'CONTAIN', 1);
  cancelling = apply(cancelling, leases, 'CANCEL', 2);
  const superseded = apply(cancelling, leases, 'SUPERSEDE', 3);
  assert.equal(superseded.state, 'SUPERSEDED');

  let rolling = apply(base, leases, 'CONTAIN', 1);
  rolling = apply(rolling, leases, 'DIAGNOSE', 2);
  rolling = apply(rolling, leases, 'PLAN', 3);
  rolling = apply(rolling, leases, 'EXECUTE', 4);
  rolling = apply(rolling, leases, 'ROLLBACK', 5);
  const failed = apply(rolling, leases, 'COMPENSATION_FAILED', 6);
  assert.equal(failed.state, 'COMPENSATION_FAILED');
  validateRemediationCampaign(JSON.parse(JSON.stringify(failed)));
});

test('campaign budgets use event time, leases are validated, and attempts are durable evidence', () => {
  const base = campaign();
  const leases = campaignLeases(base);
  let planned = apply(base, leases, 'CONTAIN', 1);
  planned = apply(planned, leases, 'DIAGNOSE', 2);
  planned = apply(planned, leases, 'PLAN', 3);
  const late = transitionRemediationCampaign(
    planned,
    stepCampaign(planned, leases, 'EXECUTE', planned.maximumElapsedMs),
    leases,
  );
  assert.equal(late.applied, false);
  assert.equal(late.code, 'CAMPAIGN_BUDGET_EXHAUSTED');
  assert.throws(() => transitionRemediationCampaign(
    planned,
    stepCampaign(planned, leases, 'EXECUTE', 4),
    campaignLeases(planned, { acquiredAtMs: Number.NaN }),
  ));

  let executing = apply(planned, leases, 'EXECUTE', 4);
  assert.equal(executing.attemptRecords.length, 1);
  assert.equal(executing.attemptRecords[0].result, 'IN_PROGRESS');
  executing = JSON.parse(JSON.stringify(executing));
  validateRemediationCampaign(executing);
  const completed = apply(executing, leases, 'ACTION_COMPLETED', 5);
  assert.equal(completed.attemptRecords[0].result, 'SUCCEEDED');
  assert.equal(completed.attemptRecords[0].afterState, 'CONTINUOUS');
  assert.equal(completed.costUnits, 1);
  assert.equal(completed.concurrencyUnits, 0);
  assert.throws(() => validateRemediationCampaign(campaign({ capitalPosture: 'INCREASE_AUTHORITY' })));
  assert.throws(() => validateRemediationCampaign(campaign({ diagnosticConfidence: 999 })));
  assert.throws(() => validateRemediationCampaign(campaign({ triggerEvidenceIds: [] })));
});

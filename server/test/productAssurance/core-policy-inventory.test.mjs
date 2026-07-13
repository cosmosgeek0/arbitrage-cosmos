import assert from 'node:assert/strict';
import test from 'node:test';
import * as productAssurance from '../../dist/productAssurance/index.js';
import {
  COVERAGE_OBLIGATIONS,
  EXPECTED_INVENTORY_MANIFEST,
  OPERATION_POLICY_REGISTRY,
  SAFETY_INVARIANT_CATALOG,
  allocateRateBudget,
  bindExpectedInventoryManifest,
  decideRetry,
  evaluateCanonicalCoverageMatrix,
  evaluateEvidenceRef,
  evaluateInvariantCatalog,
  projectInventoryCoverage,
  projectCanonicalCoverageFreshness,
  scanOperationCoverage,
  transitionCircuit,
  validateExpectedInventoryManifest,
  validateOperationPolicy,
} from '../../dist/productAssurance/index.js';
import { scanProductionOperations } from '../../../test/productAssurance/production-operation-scan.mjs';
import {
  NOW,
  completeInventoryObservation,
  digest,
  evidence,
  invariantFacts,
} from './helpers.mjs';

const policy = (operationId) => {
  const match = OPERATION_POLICY_REGISTRY.find((entry) => entry.operationId === operationId);
  assert.ok(match, `missing operation policy ${operationId}`);
  return match;
};

const boundInventoryManifest = bindExpectedInventoryManifest(
  'IP_ASSURANCE_TEST_RELEASE',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  NOW - 10_000,
);
const COVERAGE_RELEASE_ID = 'IP_ASSURANCE_TEST_RELEASE';
const COVERAGE_TESTED_COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

test('every fixture operation has a complete valid policy and production scan exposes exact owner blockers', () => {
  assert.equal(OPERATION_POLICY_REGISTRY.length, 13);
  for (const entry of OPERATION_POLICY_REGISTRY) assert.deepEqual(validateOperationPolicy(entry), []);
  const report = scanProductionOperations();
  const coverage = scanOperationCoverage(OPERATION_POLICY_REGISTRY, report.sites);
  assert.equal(report.discovered, 143);
  assert.equal(report.covered, 142);
  assert.equal(report.uncovered, 1);
  assert.deepEqual(report.uncoveredSites.map((site) => `${site.path}:${site.line}:${site.kind}:${site.symbol}`), [
    'server/src/services/newsContext.ts:2302:MUTATION_CALL:fetch:DYNAMIC_METHOD',
  ]);
  assert.equal(coverage.verdict, 'FAIL');
  assert.deepEqual(coverage.uncoveredSites.map((site) => site.path), ['server/src/services/newsContext.ts']);
  assert.equal(report.operationCounts.OP_LEGACY_SIGNED_MONEY_PATH_DORMANT_BLOCKED, 45);
  assert.equal(policy('OP_LEGACY_SIGNED_MONEY_PATH_DORMANT_BLOCKED').wiringState, 'DORMANT_BLOCKED');
  assert.equal(policy('OP_LEGACY_SIGNED_MONEY_PATH_DORMANT_BLOCKED').automaticRemediationAllowed, false);
});

test('unknown scanner paths remain exact uncovered sites', () => {
  const discovered = [{
    siteId: 'OPSITE_NEW_PATH', path: 'server/src/newOwner/client.ts', line: 7,
    kind: 'NETWORK', symbol: 'fetch', operationId: null,
  }];
  const result = scanOperationCoverage(OPERATION_POLICY_REGISTRY, discovered);
  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(result.uncoveredSites.map((site) => site.path), ['server/src/newOwner/client.ts']);
  const forgedMapping = scanOperationCoverage(OPERATION_POLICY_REGISTRY, [{
    siteId: 'OPSITE_FORGED_MAPPING', path: 'server/src/newMoney.ts', line: 8,
    kind: 'MUTATION', symbol: 'withdraw', operationId: 'OP_PUBLIC_HTTP_READ',
  }]);
  assert.equal(forgedMapping.verdict, 'FAIL');
  assert.deepEqual(forgedMapping.uncoveredSites.map((site) => site.path), ['server/src/newMoney.ts']);
});

test('ambiguous or accepted submissions never blind retry', () => {
  const ledger = policy('OP_LEDGER_SQLITE');
  const baseline = {
    attempt: 0, elapsedMs: 100, errorCode: 'COMMIT_STATE_UNKNOWN',
    submissionState: 'UNKNOWN_SUBMISSION', reconciliationState: 'PENDING',
    durableIdentityState: 'PRESENT', deterministicJitterUnit: 0.5,
  };
  assert.equal(decideRetry(ledger, baseline).kind, 'RECONCILE_FIRST');
  assert.equal(decideRetry(ledger, { ...baseline, durableIdentityState: 'MISSING' }).reasonCode, 'DURABLE_IDENTITY_MISSING_OR_EXPIRED');
  assert.equal(decideRetry(ledger, { ...baseline, submissionState: 'ACCEPTED' }).reasonCode, 'SUBMISSION_ALREADY_ACCEPTED');
  const provedAbsent = decideRetry(ledger, { ...baseline, reconciliationState: 'PROVED_ABSENT' });
  assert.equal(provedAbsent.kind, 'RETRY');
  assert.equal(provedAbsent.reasonCode, 'AMBIGUOUS_ABSENCE_RETRY_ALLOWED');
  const dormant = policy('OP_LEGACY_SIGNED_MONEY_PATH_DORMANT_BLOCKED');
  assert.equal(decideRetry(dormant, { ...baseline, errorCode: 'TIMEOUT', submissionState: 'NOT_SENT', reconciliationState: 'NOT_REQUIRED' }).reasonCode, 'OPERATION_NOT_WIRED');
});

test('retry budgets, deadlines, and independent circuit recovery are bounded', () => {
  const http = policy('OP_PUBLIC_HTTP_READ');
  const retryInput = {
    attempt: 0, elapsedMs: 100, errorCode: 'TIMEOUT', submissionState: 'NOT_SENT',
    reconciliationState: 'NOT_REQUIRED', durableIdentityState: 'NOT_REQUIRED', deterministicJitterUnit: 0.5,
  };
  assert.equal(decideRetry(http, retryInput).kind, 'RETRY');
  assert.equal(decideRetry(http, { ...retryInput, elapsedMs: http.deadlineMs }).reasonCode, 'OPERATION_DEADLINE_EXHAUSTED');
  assert.equal(decideRetry(http, { ...retryInput, attempt: http.maximumAttempts - 1 }).reasonCode, 'MAXIMUM_ATTEMPTS_EXHAUSTED');

  let snapshot = {
    state: 'CLOSED', consecutiveFailures: 0, openedAtMs: null, halfOpenProbes: 0,
    lastEventAtMs: null, probePassedAtMs: null, independentlyVerifiedAtMs: null,
  };
  for (let count = 0; count < http.circuit.failureThreshold; count += 1) {
    snapshot = transitionCircuit(http, snapshot, { kind: 'FAILURE', atMs: NOW + count + 1 });
  }
  assert.equal(snapshot.state, 'OPEN');
  const producerSuccess = transitionCircuit(http, snapshot, { kind: 'SUCCESS', atMs: NOW + 10 });
  assert.equal(producerSuccess.state, 'OPEN');
  snapshot = transitionCircuit(http, producerSuccess, { kind: 'TICK', atMs: snapshot.openedAtMs + http.circuit.resetAfterMs });
  assert.equal(snapshot.state, 'HALF_OPEN');
  snapshot = transitionCircuit(http, snapshot, { kind: 'PROBE_STARTED', atMs: snapshot.lastEventAtMs + 1 });
  snapshot = transitionCircuit(http, snapshot, { kind: 'PROBE_PASSED', atMs: snapshot.lastEventAtMs + 1 });
  snapshot = transitionCircuit(http, snapshot, { kind: 'INDEPENDENT_VERIFICATION_PASSED', atMs: snapshot.lastEventAtMs + 1, verifierId: 'INDEPENDENT_SENTINEL' });
  const tooSoon = transitionCircuit(http, snapshot, { kind: 'TICK', atMs: snapshot.lastEventAtMs + http.circuit.healthyQuietWindowMs - 1 });
  assert.equal(tooSoon.state, 'HALF_OPEN');
  const recovered = transitionCircuit(http, tooSoon, { kind: 'TICK', atMs: snapshot.independentlyVerifiedAtMs + http.circuit.healthyQuietWindowMs });
  assert.equal(recovered.state, 'CLOSED');
  assert.equal(transitionCircuit(http, recovered, { kind: 'FAILURE', atMs: recovered.lastEventAtMs }).state, 'CLOSED');
});

test('risk reduction and reconciliation outrank optional work under saturation', () => {
  const result = allocateRateBudget(3, 1, [
    { requestId: 'OPTIONAL', priority: 'OPTIONAL', units: 2 },
    { requestId: 'NORMAL', priority: 'NORMAL', units: 2 },
    { requestId: 'RECONCILE', priority: 'RECONCILIATION', units: 1 },
    { requestId: 'RISK_REDUCE', priority: 'RISK_REDUCING', units: 2 },
  ]);
  assert.deepEqual(result.admittedRequestIds, ['RISK_REDUCE', 'RECONCILE']);
  assert.deepEqual(result.blockedRequestIds, ['NORMAL', 'OPTIONAL']);
  const reserved = allocateRateBudget(3, 2, [
    { requestId: 'OPTIONAL_ONLY', priority: 'OPTIONAL', units: 2 },
  ]);
  assert.deepEqual(reserved.admittedRequestIds, []);
  assert.equal(reserved.remainingUnits, 3);
  assert.throws(() => allocateRateBudget(3, 0, [{ requestId: 'FORGED', priority: 'FORGED', units: 1 }]));
});

test('coverage denominator includes all five required subject families', () => {
  assert.equal(productAssurance.evaluateCoverageMatrix, undefined);
  const result = evaluateCanonicalCoverageMatrix(COVERAGE_RELEASE_ID, COVERAGE_TESTED_COMMIT);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.expectedCount, 171);
  assert.equal(result.coveragePercentage, 100);

  const channelFields = {
    METRIC: 'metricId', STRUCTURED_LOG: 'structuredLogId', MATERIAL_EVENT: 'materialEventId',
    TRACE: 'traceId', INCIDENT: 'incidentId',
  };
  const observations = COVERAGE_OBLIGATIONS.flatMap((obligation) => Object.entries(channelFields).map(([channel, field]) => ({
    releaseId: COVERAGE_RELEASE_ID,
    testedCommit: COVERAGE_TESTED_COMMIT,
    subjectKind: obligation.subjectKind,
    subjectId: obligation.subjectId,
    channel,
    channelId: obligation[field],
    evidenceId: `EVIDENCE_${obligation.subjectKind}_${obligation.subjectId}_${channel}`,
    evidenceOwnerId: 'PRODUCT_ASSURANCE_COVERAGE_OWNER',
    evidenceDigest: digest(`${obligation.subjectKind}:${obligation.subjectId}:${channel}`),
    truthLabel: 'LIVE_PUBLIC',
    lastObservedAtMs: NOW - 1,
    explicitlyUnavailable: false,
  })));
  assert.equal(projectCanonicalCoverageFreshness(COVERAGE_RELEASE_ID, COVERAGE_TESTED_COMMIT, observations, NOW).verdict, 'PASS');
  assert.notEqual(projectCanonicalCoverageFreshness(COVERAGE_RELEASE_ID, COVERAGE_TESTED_COMMIT, observations.slice(1), NOW).verdict, 'PASS');
  assert.throws(() => projectCanonicalCoverageFreshness(COVERAGE_RELEASE_ID, COVERAGE_TESTED_COMMIT, [
    { ...observations[0], channelId: 'UNRELATED_SIGNAL' }, ...observations.slice(1),
  ], NOW));
  assert.throws(() => projectCanonicalCoverageFreshness('IP_ASSURANCE_OTHER_RELEASE', COVERAGE_TESTED_COMMIT, observations, NOW), /release binding mismatch/u);
  assert.notEqual(projectCanonicalCoverageFreshness(
    COVERAGE_RELEASE_ID,
    COVERAGE_TESTED_COMMIT,
    observations.map((observation, index) => index === 0 ? { ...observation, truthLabel: 'SYNTHETIC_ONLY' } : observation),
    NOW,
  ).verdict, 'PASS');
});

test('expected inventory, disabled controls, silence, and staleness cannot green', () => {
  assert.throws(() => validateExpectedInventoryManifest(EXPECTED_INVENTORY_MANIFEST));
  validateExpectedInventoryManifest(boundInventoryManifest);
  const complete = projectInventoryCoverage(boundInventoryManifest, completeInventoryObservation());
  assert.equal(complete.overallVerdict, 'PASS');
  assert.equal(complete.observabilityCoveragePercentage, 100);

  const base = completeInventoryObservation();
  const missing = projectInventoryCoverage(boundInventoryManifest, { ...base, components: base.components.slice(1) });
  assert.equal(missing.overallVerdict, 'FAIL');
  assert.equal(missing.componentStates[0].state, 'MISSING');

  const silentComponents = base.components.map((entry, index) => index === 0 ? { ...entry, lastReporterSeenAtMs: null } : entry);
  const staleComponents = base.components.map((entry, index) => index === 0 ? { ...entry, lastMeaningfulAdvanceAtMs: null } : entry);
  assert.equal(projectInventoryCoverage(boundInventoryManifest, { ...base, components: silentComponents }).componentStates[0].state, 'SILENT');
  assert.equal(projectInventoryCoverage(boundInventoryManifest, { ...base, components: staleComponents }).componentStates[0].state, 'STALE');

  const disabledControls = base.controls.map((entry, index) => index === 0 ? { ...entry, state: 'DISABLED' } : entry);
  const disabled = projectInventoryCoverage(boundInventoryManifest, { ...base, controls: disabledControls });
  assert.equal(disabled.overallVerdict, 'FAIL');
  assert.equal(disabled.controlStates[0].state, 'UNAVAILABLE');
  const forgedProbe = projectInventoryCoverage(boundInventoryManifest, {
    ...base,
    independentProbeEvidence: { ...base.independentProbeEvidence, ownerId: 'SELF_REPORTED_OWNER' },
  });
  assert.equal(forgedProbe.overallVerdict, 'FAIL');
});

test('critical invariant UNKNOWN and empty catalogs block trade readiness', () => {
  const facts = invariantFacts(SAFETY_INVARIANT_CATALOG);
  const pass = evaluateInvariantCatalog(SAFETY_INVARIANT_CATALOG, facts, NOW);
  assert.equal(pass.tradeReadinessVerdict, 'PASS');
  assert.equal(pass.results.length, 17);
  const absent = facts.filter((fact) => fact.factId !== SAFETY_INVARIANT_CATALOG[0].factIds[0]);
  const unknown = evaluateInvariantCatalog(SAFETY_INVARIANT_CATALOG, absent, NOW);
  assert.equal(unknown.tradeReadinessVerdict, 'UNKNOWN');
  assert.ok(unknown.unknownCriticalInvariantIds.includes(SAFETY_INVARIANT_CATALOG[0].invariantId));
  assert.equal(evaluateInvariantCatalog([], [], NOW).tradeReadinessVerdict, 'UNKNOWN');
  const forged = facts.map((fact, index) => index === 0
    ? { ...fact, evidence: { ...fact.evidence, ownerId: 'FORGED_FACT_OWNER' } }
    : fact);
  assert.equal(evaluateInvariantCatalog(SAFETY_INVARIANT_CATALOG, forged, NOW).tradeReadinessVerdict, 'FAIL');
});

test('evidence expiry, truth realm, and future observations fail closed', () => {
  assert.equal(evaluateEvidenceRef(evidence('VALID'), NOW, true).verdict, 'PASS');
  assert.equal(evaluateEvidenceRef(evidence('SYNTHETIC', { truthLabel: 'SYNTHETIC_ONLY' }), NOW, true).verdict, 'UNKNOWN');
  assert.equal(evaluateEvidenceRef(evidence('FUTURE', { observedAtMs: NOW + 1 }), NOW, true).verdict, 'FAIL');
  assert.equal(evaluateEvidenceRef(evidence('EXPIRED', { expiresAtMs: NOW }), NOW, true).verdict, 'FAIL');
  assert.equal(evaluateEvidenceRef(evidence('UNBOUNDED', { expiresAtMs: null }), NOW, true).verdict, 'UNKNOWN');
});

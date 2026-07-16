import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { installEgressTripwire } from '../../server/test/systemIntegration/fixtures/egress-tripwire.mjs';
import { scanExecutableSnippet, scanSecretText } from '../i00/scope-security.mjs';

const importTripwire = installEgressTripwire();
let harness;
try {
  harness = await import('../../fixtures/replayShadow/harness.mjs');
  importTripwire.assertNoAttempts('RUN-17 replay-shadow harness import');
} finally {
  importTripwire.restore();
}

const {
  REPLAY_SHADOW_COVERAGE,
  REPLAY_SHADOW_LIMITS,
  REPLAY_SHADOW_REQUIRED_LIMITATIONS,
  comparePlanFrames,
  compileCampaign,
  inventoryCorpus,
  materializePlanWindow,
  validateCorpus,
} = harness;

const FIXTURE_URLS = Object.freeze({
  corpus: new URL('../../fixtures/replayShadow/corpus.v1.json', import.meta.url),
  entryGate: new URL('../../fixtures/replayShadow/entry-gate.v1.json', import.meta.url),
  insertionRequests: new URL('../../fixtures/replayShadow/insertion-requests.v1.json', import.meta.url),
  insertionSchema: new URL('../../fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.schema.json', import.meta.url),
  harness: new URL('../../fixtures/replayShadow/harness.mjs', import.meta.url),
  research: new URL('../../fixtures/replayShadow/RESEARCH_BASIS.md', import.meta.url),
  faultOwner: new URL('../../server/src/productAssurance/faults/harness.ts', import.meta.url),
});

function readText(url) {
  return readFileSync(url, 'utf8');
}

function readJson(url) {
  return JSON.parse(readText(url));
}

const corpusInput = readJson(FIXTURE_URLS.corpus);
const corpus = validateCorpus(corpusInput);
const entryGate = readJson(FIXTURE_URLS.entryGate);
const insertionRequests = readJson(FIXTURE_URLS.insertionRequests);
const insertionRowSchema = readJson(FIXTURE_URLS.insertionSchema).$defs.InsertionRequestRowV1;

const EXPECTED_ENTRY_GATE_BINDINGS = Object.freeze([
  ['RS-EG-001', 'ADOPT_EXISTING', ['server/src/foundation/replay/**'], 'Reference the canonical owner; do not create replacement mechanics.', false],
  ['RS-EG-002', 'MISSING_BUILD', [], 'Build bounded synthetic data-only tapes with explicit owner references and no outcome evaluator.', true],
  ['RS-EG-003', 'ADAPT_EXISTING', ['server/src/foundation/scenarios/**'], 'Adapt owner identifiers into neutral stimulus tapes; do not copy owner decisions or expected outcomes.', true],
  ['RS-EG-004', 'MISSING_BUILD', [], 'Build a declarative closed-loop profile and requested-measurement list with no thresholds.', true],
  ['RS-EG-005', 'ADAPT_EXISTING', ['server/src/intelligenceRuntime/capacity/**'], 'Adapt the canonical bounded capacity vocabulary into a portable profile; do not create a second capacity simulator.', true],
  ['RS-EG-006', 'MISSING_BUILD', [], 'Build a six-hour deferred profile definition only; no host execution or result claim.', true],
  ['RS-EG-007', 'ADAPT_EXISTING', ['server/src/intelligenceRuntime/lifecycle/**', 'server/src/productAssurance/faults/harness.ts'], 'Build explicit, deterministic event tapes while preserving the existing backoff and fault owners.', true],
  ['RS-EG-008', 'ADAPT_EXISTING', ['server/src/foundation/execution/**', 'server/src/foundation/reconciliation/**'], 'Build evidence sequences only; never resolve ambiguity or compute reconciliation truth here.', true],
  ['RS-EG-009', 'ADAPT_EXISTING', ['server/src/foundation/contracts/time.ts', 'server/src/foundation/scenarios/**'], 'Preserve source, receipt, evaluation, maximum-age, and unknown timestamps as separate fixture facts.', true],
  ['RS-EG-010', 'ADAPT_EXISTING', ['server/src/intelligenceRuntime/contracts/**', 'server/src/intelligenceRuntime/lifecycle/**'], 'Build raw open, ping, close-frame, abnormal-loss, generation, and first-data observations only.', true],
  ['RS-EG-011', 'ADAPT_EXISTING', ['server/src/intelligenceRuntime/lifecycle/rateBudget.ts'], 'Build observed 429, 418, retry-after, weight, and control-burst facts only.', true],
  ['RS-EG-012', 'ADAPT_EXISTING', ['server/src/foundation/contracts/time.ts', 'server/src/intelligenceRuntime/**'], 'Build unit-tagged wall, source, monotonic, process-session, and regression observations only.', true],
  ['RS-EG-013', 'ADAPT_EXISTING', ['server/src/productAssurance/remediation/**', 'server/src/foundation/control/**', 'server/src/intelligenceRuntime/lifecycle/**', 'server/src/systemIntegration/persistence/**', 'server/src/ledger.ts'], 'Build a fact-owner-labelled detection-to-readback composition template; do not create a recovery controller, state machine, or truth owner.', true],
  ['RS-EG-014', 'MISSING_BUILD', [], 'Build a pure validator/compiler that emits immutable reference frames and cannot execute a workload.', true],
  ['RS-EG-015', 'ADOPT_EXISTING', ['node:test', 'test/i00/scope-security.mjs', 'server/test/systemIntegration/fixtures/egress-tripwire.mjs'], 'Reuse directly from packet-local focused tests; do not add a dependency or package script.', false],
  ['RS-EG-016', 'REFERENCE_ONLY', ['test/i00/performance/**'], 'Use metric vocabulary as research context only; do not copy, invoke, or claim its evidence.', false],
  ['RS-EG-017', 'REFERENCE_ONLY', ['server/src/productAssurance/faults/**', 'fixtures/productAssurance/**'], 'Reference scenario identifiers only; never import historical PASS output as packet evidence.', false],
  ['RS-EG-018', 'REJECT_DUPLICATE', ['server/src/foundation/replay/**'], 'Reject.', false],
  ['RS-EG-019', 'REJECT_DUPLICATE', ['server/src/intelligenceRuntime/**'], 'Reject.', false],
  ['RS-EG-020', 'REJECT_DUPLICATE', ['server/src/foundation/execution/**', 'server/src/foundation/reconciliation/**', 'server/src/productAssurance/remediation/**', 'server/src/ledger.ts'], 'Reject.', false],
  ['RS-EG-021', 'REJECT_DUPLICATE', ['Future exact-C2 verification shards and sole Role-3 verdict owner'], 'Reject; RUN-17 defines observations but no pass/fail meaning.', false],
  ['RS-EG-022', 'REFERENCE_ONLY', ['Director and future post-C2 porter'], 'File typed insertion requests only; direct edits are forbidden.', false],
  ['RS-EG-023', 'MISSING_BUILD', [], 'Seal in a receipt-only child commit after the implementation commit is known.', true],
]);

const EXPECTED_INSERTION_BINDINGS = Object.freeze([
  ['AIOPS-IR-DOCS-017', 'FRESH_POST_ACCEPTANCE_INTEGRATOR', 'STATE.md; ARCHITECTURE.md Part II'],
  [
    'AIOPS-IR-TEST-MOUNT-026',
    'ROOT_TEST_ACCEPTANCE_OWNER',
    'package.json::test:all:built; test/i00/complete-acceptance.mjs; server/test/i00Acceptance/**',
  ],
]);

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

const FORBIDDEN_OUTCOME_KEY = /^(?:(?:candidate|tested|base|head)(?:[A-Z0-9_].*)?|source(?:Commit|Sha|Hash|Tree)(?:[A-Z0-9_].*)?|branch(?:[A-Z0-9_].*)?|target(?:Route|Module|Path)(?:[A-Z0-9_].*)?|expected(?:[A-Z0-9_].*)?|threshold(?:[A-Z0-9_].*)?|verdict(?:[A-Z0-9_].*)?|passed|failed|success|healthy|green|acceptance(?:[A-Z0-9_].*)?|release(?:[A-Z0-9_].*)?|slo(?:[A-Z0-9_].*)?)$/i;
const FORBIDDEN_OUTCOME_VALUE = new Set([
  'PASS', 'FAIL', 'PASSED', 'FAILED', 'SUCCESS', 'SUCCEEDED', 'READY',
  'HEALTHY', 'GREEN', 'ACCEPTED', 'VERIFIED_CANDIDATE', 'REJECTED_CANDIDATE',
  'INTEGRATION_CANDIDATE_READY', 'LIVE_PUBLIC', 'LIVE_PRIVATE', 'DEPLOYED',
]);
const CONCRETE_CANDIDATE_IDENTITY = /(?:(?<![A-Za-z0-9_.])[0-9a-f]{7,40}(?![A-Za-z0-9_.])|(?<![A-Za-z0-9_.])[0-9a-f]{64}(?![A-Za-z0-9_.])|sha256:[0-9a-f]{64}\b|refs\/heads\/[A-Za-z0-9._/-]+)/i;

function assertCandidateIndependentJson(value, path = '$') {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return;
  if (typeof value === 'string') {
    assert.equal(FORBIDDEN_OUTCOME_VALUE.has(value.toUpperCase()), false, `${path}: outcome value`);
    if (!/^[0-9]+$/.test(value)) {
      assert.doesNotMatch(value, CONCRETE_CANDIDATE_IDENTITY, `${path}: candidate identity`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertCandidateIndependentJson(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (key === 'candidateBinding') {
      assert.equal(path, '$', `${childPath}: nested candidate binding`);
      assert.equal(child, null, `${childPath}: non-null candidate binding`);
    } else {
      assert.equal(FORBIDDEN_OUTCOME_KEY.test(key), false, `${childPath}: outcome key`);
    }
    assertCandidateIndependentJson(child, childPath);
  }
}

function dataset(datasetId) {
  const found = corpus.datasets.find((row) => row.datasetId === datasetId);
  assert.ok(found, `missing ${datasetId}`);
  return found;
}

test('RUN-17 corpus validates with exact shadow posture and complete inventory', () => {
  const validated = validateCorpus(corpusInput);
  const inventory = inventoryCorpus(corpus);

  assert.equal(validated.disposition, 'SHADOW_SPECULATIVE');
  assert.equal(validated.executionAuthority, 'NONE');
  assert.equal(validated.candidateBinding, null);
  assert.equal(validated.heavyExecution, 'DEFERRED_POST_C2_OTHER_MACHINE');
  assert.deepEqual(validated.requiredCoverage, REPLAY_SHADOW_COVERAGE);
  assert.deepEqual(validated.limitations, REPLAY_SHADOW_REQUIRED_LIMITATIONS);
  assert.deepEqual(
    {
      datasets: inventory.datasetCount,
      events: inventory.eventCount,
      faultReferences: inventory.faultReferenceCount,
      campaigns: inventory.campaignCount,
      coverage: inventory.coverage.length,
    },
    { datasets: 11, events: 64, faultReferences: 30, campaigns: 5, coverage: 11 },
  );
  assertDeepFrozen(validated);
  assertDeepFrozen(inventory);
});

test('restart and connection tapes retain raw observations without lifecycle verdicts', () => {
  const restart = dataset('RS-DATA-RESTART-STORM-001');
  const connection = dataset('RS-DATA-CONNECTION-001');
  const restartAttempts = restart.eventTape.filter((event) => event.type === 'RESTART_REQUEST_RECORDED');

  assert.equal(restart.ownerReference.ownerId, 'UNMOUNTED_POLICY_VIOLATION_OBSERVATION');
  assert.match(restart.title, /outside landed policy/);
  assert.deepEqual(restartAttempts.map((event) => event.facts.attempt), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(restartAttempts.map((event) => event.facts.delayBeforeAttemptMs), [0, 125, 265, 525, 1025, 2025, 4025, 4025, 4025]);
  assert.equal(restart.eventTape.at(-2).type, 'DEPENDENT_RESTART_REQUEST_RECORDED');
  assert.deepEqual(restart.eventTape.at(-1).facts, {
    subjectRef: 'synthetic.component.primary',
    stormCorrelationRef: 'synthetic-restart-storm-a',
    attemptsObserved: 9,
    terminalObservation: 'UNKNOWN',
  });
  assert.equal(connection.ownerReference.ownerId, 'WEBSOCKET_SOURCE_RUNNER');
  assert.equal(connection.eventTape.some((event) => event.type === 'SERVER_SHUTDOWN_NOTICE'), true);
  assert.deepEqual(connection.eventTape.at(-1).facts, {
    generation: 2,
    closeFrameReceived: false,
    localCloseCode: 1006,
    remoteCloseCode: null,
  });
});

test('partial-fill tape preserves duplicate, missing, and contradictory evidence as ambiguity', () => {
  const partial = dataset('RS-DATA-PARTIAL-AMBIGUITY-001');
  const unavailable = partial.eventTape.find((event) => event.type === 'LOOKUP_EVIDENCE_UNAVAILABLE');
  const reports = partial.eventTape.filter((event) => event.type === 'EXECUTION_REPORT_OBSERVED');

  assert.equal(partial.ownerReference.owner, 'FOUNDATION_RECONCILIATION');
  assert.equal(partial.sourceKind, 'SYNTHETIC_STIMULUS_TAPE');
  assert.equal(unavailable.facts.sourceAuthority, 'UNAVAILABLE');
  assert.equal(unavailable.facts.sourceCompleteness, 'UNAVAILABLE');
  assert.deepEqual(
    [unavailable.facts.sourceTimeMs, unavailable.facts.coverageStartMs, unavailable.facts.coverageEndMs],
    [null, null, null],
  );
  assert.deepEqual([unavailable.facts.orders, unavailable.facts.fills, unavailable.facts.positions], [null, null, null]);
  assert.equal(partial.eventTape.some((event) => event.type === 'EXECUTION_REPORT_DUPLICATE'), true);
  assert.equal(reports.every((event) => event.facts.venue === 'BINANCE_SPOT'), true);
  assert.equal(reports.every((event) => event.facts.symbol === 'SYNTHUSDT'), true);
  assert.equal(reports.every((event) => event.facts.clientOrderId === 'synthetic-client-order-a'), true);
  assert.equal(reports.every((event) => event.facts.venueOrderId === 'synthetic-venue-order-a'), true);
  assert.equal(reports.every((event) => event.facts.sourceAuthority === 'SYNTHETIC_TEST'), true);
  assert.deepEqual(reports.map((event) => event.facts.reportSequence), [1, 2]);
  assert.deepEqual(reports.map((event) => event.facts.reportSession), ['session-a', 'session-b']);
  assert.equal(reports.every((event) => event.facts.intendedQuantity === '1.00000000'), true);
  assert.equal(reports.at(-1).facts.tradeId, null);
  assert.equal(reports.at(-1).facts.lastPrice, null);
  assert.equal(reports.at(-1).facts.cumulativeQuantity, '0.70000000');
});

test('stale, rate-limit, and clock-skew tapes retain unknowns and clock domains', () => {
  const stale = dataset('RS-DATA-STALE-001');
  const rateLimit = dataset('RS-DATA-RATE-LIMIT-001');
  const skew = dataset('RS-DATA-CLOCK-SKEW-001');

  assert.equal(stale.eventTape.at(-1).facts.sourceTimeMs, null);
  assert.equal(stale.eventTape.at(-1).facts.completeness, 'UNKNOWN');
  assert.deepEqual(
    rateLimit.eventTape.filter((event) => event.type === 'STATUS_OBSERVED').map((event) => event.facts.statusCode),
    [429, 418],
  );
  assert.equal(
    rateLimit.eventTape.filter((event) => event.type === 'STATUS_OBSERVED').every((event) => (
      event.facts.protocol === 'REST_HTTP' && event.facts.budgetRef === 'REST_REQUEST_WEIGHT_1M'
    )),
    true,
  );
  assert.equal(
    rateLimit.eventTape.find((event) => event.type === 'STREAM_CONTROL_BURST_OBSERVED').facts.budgetRef,
    'STREAM_CONTROL_MESSAGES_1S',
  );
  assert.deepEqual(skew.eventTape.filter((event) => event.type === 'CLOCK_SAMPLE').map((event) => event.facts.sourceTimeUnit), [
    'MILLISECOND', 'MILLISECOND', 'MILLISECOND', 'MICROSECOND',
  ]);
  assert.equal(skew.eventTape.every((event) => event.type !== 'CLOCK_SAMPLE' || typeof event.facts.receiptMonotonicNs === 'string'), true);
});

test('recovery tape requests readback and independent observation without claiming recovery', () => {
  const recovery = dataset('RS-DATA-RECOVERY-001');
  assert.equal(recovery.ownerReference.ownerId, 'RECOVERY_EVIDENCE_COMPOSITION');
  assert.equal(recovery.eventTape[0].facts.faultRefParameter, 'FRAME_FAULT_REF_ID');
  assert.equal(recovery.eventTape.every((event) => (
    event.type === 'FAULT_DETECTED' || event.facts.campaignRefParameter === 'FRAME_CAMPAIGN_ID'
  )), true);
  assert.equal(recovery.eventTape.find((event) => event.type === 'CONTAINMENT_REQUEST_RECORDED').facts.authorityReceiptRef, null);
  assert.deepEqual(
    recovery.eventTape.filter((event) => event.type.endsWith('_SAMPLE')).map((event) => event.facts.observedState),
    ['UNKNOWN', 'UNKNOWN'],
  );
});

test('required hostile tapes preserve causal observation sequences without outcome claims', () => {
  const baseline = dataset('RS-DATA-BASELINE-001');
  const restart = dataset('RS-DATA-RESTART-STORM-001');
  const partial = dataset('RS-DATA-PARTIAL-AMBIGUITY-001');
  const stale = dataset('RS-DATA-STALE-001');
  const connection = dataset('RS-DATA-CONNECTION-001');
  const rate = dataset('RS-DATA-RATE-LIMIT-001');
  const skew = dataset('RS-DATA-CLOCK-SKEW-001');
  const recovery = dataset('RS-DATA-RECOVERY-001');
  const outOfOrder = dataset('RS-DATA-OUT-OF-ORDER-001');

  assert.deepEqual(baseline.eventTape.map((event) => event.type), [
    'BASELINE_OBSERVATION_WINDOW_OPENED',
    'BASELINE_SOURCE_READBACK_OBSERVED',
    'BASELINE_OBSERVATION_WINDOW_CLOSED',
  ]);
  const restartAttempts = restart.eventTape.filter((event) => event.type === 'RESTART_REQUEST_RECORDED');
  for (let index = 1; index < restartAttempts.length; index += 1) {
    assert.equal(
      restartAttempts[index].atOffsetMs - restartAttempts[index - 1].atOffsetMs,
      restartAttempts[index].facts.delayBeforeAttemptMs,
    );
  }
  assert.deepEqual(partial.eventTape.map((event) => event.type), [
    'EVIDENCE_WINDOW_OPENED',
    'EXECUTION_REPORT_OBSERVED',
    'UNDERLYING_TRANSPORT_LOST',
    'PROCESS_SESSION_CHANGED',
    'LOOKUP_EVIDENCE_UNAVAILABLE',
    'EXECUTION_REPORT_DUPLICATE',
    'EXECUTION_REPORT_OBSERVED',
  ]);
  const staleAges = stale.eventTape.map((event) => (
    event.facts.sourceTimeMs === null ? null : event.facts.evaluatedAtMs - event.facts.sourceTimeMs
  ));
  assert.deepEqual(staleAges, [10, 6010, 5, null]);
  assert.equal(staleAges[0] <= stale.eventTape[0].facts.maxAgeMs, true);
  assert.equal(staleAges[1] > stale.eventTape[1].facts.maxAgeMs, true);
  assert.deepEqual(connection.eventTape.map((event) => event.type), [
    'CONNECTION_OPENED',
    'PING_FRAME_OBSERVED',
    'PONG_FRAME_OBSERVED',
    'SERVER_SHUTDOWN_NOTICE',
    'CLOSE_FRAME_OBSERVED',
    'CONNECTION_OPENED',
    'FIRST_DATA_OBSERVED',
    'UNDERLYING_TRANSPORT_LOST',
  ]);
  assert.equal(connection.eventTape[5].atOffsetMs > connection.eventTape[4].atOffsetMs, true);
  assert.deepEqual(rate.eventTape.map((event) => event.type), [
    'WEIGHT_HEADER_OBSERVED',
    'STATUS_OBSERVED',
    'STREAM_CONTROL_BURST_OBSERVED',
    'COOLDOWN_WINDOW_ELAPSED',
    'STATUS_OBSERVED',
  ]);
  assert.equal(rate.eventTape[3].facts.observedElapsedMs >= rate.eventTape[1].facts.retryAfterMs, true);
  const skewSamples = skew.eventTape.filter((event) => event.type === 'CLOCK_SAMPLE');
  assert.equal(skewSamples[1].facts.sourceTime - skewSamples[1].facts.receiptWallTimeMs, 10000);
  assert.equal(BigInt(skewSamples[2].facts.receiptMonotonicNs) < BigInt(skewSamples[1].facts.receiptMonotonicNs), true);
  assert.deepEqual(recovery.eventTape.map((event) => event.type), [
    'FAULT_DETECTED',
    'CONTAINMENT_REQUEST_RECORDED',
    'CHECKPOINT_REFERENCE_OBSERVED',
    'RECOVERY_PROCESS_SESSION_CHANGED',
    'READBACK_UNAVAILABLE',
    'POSTCONDITION_SAMPLE',
    'QUIET_PERIOD_SAMPLE',
  ]);
  assert.deepEqual(outOfOrder.eventTape.map((event) => event.facts.sourceSequence), [100, 102, 101, 101]);
  assert.equal(outOfOrder.eventTape.every((event) => event.facts.receivedAtMs >= event.facts.sourceTimeMs), true);
});

test('all campaign definitions compile deterministically as immutable non-executable plans', () => {
  const corpusDigests = new Set();
  let phaseCount = 0;
  let totalIterations = 0;
  for (const campaign of corpus.campaigns) {
    const first = compileCampaign(corpus, campaign.campaignId);
    const second = compileCampaign(structuredClone(corpus), campaign.campaignId);
    assert.deepEqual(first, second);
    assert.equal(first.disposition, 'SHADOW_SPECULATIVE');
    assert.equal(first.executionAuthority, 'NONE');
    assert.equal(first.candidateBinding, null);
    assert.equal(first.executionState, 'DEFERRED_POST_C2_OTHER_MACHINE');
    assert.equal(first.iterationUnit, 'COMPLETE_DATASET_TAPE');
    assert.match(first.corpusContentSha256, /^[0-9a-f]{64}$/);
    assert.equal(first.totalIterations, first.phases.reduce((sum, phase) => sum + phase.iterations, 0));
    corpusDigests.add(first.corpusContentSha256);
    phaseCount += first.phases.length;
    totalIterations += first.totalIterations;
    assertDeepFrozen(first);
  }
  assert.deepEqual([...corpusDigests], ['2fe454ec770c8f69335d07430c7c4853f9c208b29c034e61dfc8ab6fd05a447b']);
  assert.deepEqual({ phaseCount, totalIterations }, { phaseCount: 10, totalIterations: 946664 });

  const changedCorpus = structuredClone(corpus);
  changedCorpus.datasets.find((row) => row.datasetId === 'RS-DATA-STALE-001').eventTape[0].facts.sourceRef = 'synthetic.source.delta';
  assert.notEqual(
    compileCampaign(corpus, 'RS-CAMPAIGN-LATENCY-001').corpusContentSha256,
    compileCampaign(changedCorpus, 'RS-CAMPAIGN-LATENCY-001').corpusContentSha256,
  );
});

test('latency, load, and soak definitions preserve distinct workload shapes', () => {
  const latency = compileCampaign(corpus, 'RS-CAMPAIGN-LATENCY-001');
  const load = compileCampaign(corpus, 'RS-CAMPAIGN-LOAD-001');
  const soak = compileCampaign(corpus, 'RS-CAMPAIGN-SOAK-001');

  assert.deepEqual(latency.phases.map((phase) => phase.pace), ['CLOSED_LOOP']);
  assert.deepEqual(load.phases.map((phase) => phase.pace), ['OPEN_ARRIVAL_RATE', 'OPEN_ARRIVAL_RATE', 'OPEN_ARRIVAL_RATE']);
  assert.deepEqual(load.phases.map((phase) => phase.subjectCount), [1, 32, 256]);
  assert.deepEqual(load.phases.map((phase) => phase.maxInFlight), [1, 8, 32]);
  assert.deepEqual(soak.phases.map((phase) => phase.phaseId), ['soak-ramp-up', 'soak-plateau-mixed', 'soak-ramp-down']);
  assert.equal(soak.measurementDurationMs, 6 * 60 * 60 * 1000);
  assert.equal(soak.totalIterations, 864000);
  assert.equal(soak.phases.every((phase) => phase.pace === 'OPEN_ARRIVAL_RATE'), true);
});

test('campaign timelines, fault bounds, and open versus closed dispatch semantics are exact', () => {
  for (const campaign of corpus.campaigns) {
    const plan = compileCampaign(corpus, campaign.campaignId);
    let expectedOffset = 0;
    for (const phase of plan.phases) {
      assert.equal(phase.startOffsetMs, expectedOffset);
      expectedOffset += phase.virtualDurationMs;
      assert.equal(phase.endOrdinalExclusive, phase.startOrdinal + phase.iterations);
      assert.equal(phase.faultSchedule.every((fault) => fault.atIteration < phase.iterations), true);

      const first = materializePlanWindow(plan, { startOrdinal: phase.startOrdinal, limit: 1 })[0];
      const last = materializePlanWindow(plan, { startOrdinal: phase.endOrdinalExclusive - 1, limit: 1 })[0];
      if (phase.pace === 'OPEN_ARRIVAL_RATE') {
        assert.deepEqual(
          [first.dispatchCondition, first.scheduledOffsetMs],
          ['VIRTUAL_OFFSET', phase.startOffsetMs],
        );
        assert.deepEqual(
          [last.dispatchCondition, last.scheduledOffsetMs],
          ['VIRTUAL_OFFSET', phase.startOffsetMs + phase.virtualDurationMs - 1],
        );
      } else {
        assert.deepEqual(
          [first.dispatchCondition, first.scheduledOffsetMs, last.dispatchCondition, last.scheduledOffsetMs],
          ['AFTER_PREDECESSORS_COMPLETED', null, 'AFTER_PREDECESSORS_COMPLETED', null],
        );
      }
    }
    assert.equal(expectedOffset, plan.measurementDurationMs);
  }

  const latency = compileCampaign(corpus, 'RS-CAMPAIGN-LATENCY-001');
  assert.equal(dataset('RS-DATA-CONNECTION-001').eventTape.at(-1).atOffsetMs > latency.measurementDurationMs, true);
  assert.equal(materializePlanWindow(latency, { startOrdinal: 0, limit: 8 }).every((frame) => frame.scheduledOffsetMs === null), true);

  for (const campaignId of ['RS-CAMPAIGN-FAILURE-001', 'RS-CAMPAIGN-RECOVERY-001']) {
    const plan = compileCampaign(corpus, campaignId);
    assert.equal(plan.phases[0].datasetMix[0], 'RS-DATA-BASELINE-001');
  }

  const recovery = compileCampaign(corpus, 'RS-CAMPAIGN-RECOVERY-001');
  for (const phase of recovery.phases) {
    const noFaultFrame = materializePlanWindow(recovery, { startOrdinal: phase.startOrdinal, limit: 1 })[0];
    assert.notEqual(noFaultFrame.datasetId, 'RS-DATA-RECOVERY-001');
    assert.equal(noFaultFrame.faultInjectionPoint, null);
    for (const fault of phase.faultSchedule) {
      const frame = materializePlanWindow(recovery, {
        startOrdinal: phase.startOrdinal + fault.atIteration,
        limit: 1,
      })[0];
      assert.equal(frame.datasetId, 'RS-DATA-RECOVERY-001');
      assert.equal(frame.faultRefId, fault.faultRefId);
      assert.equal(frame.faultInjectionPoint, 'BEFORE_TAPE_DISPATCH_FOR_FRAME_SUBJECT');
      assert.equal(frame.campaignId, recovery.campaignId);
      assert.equal(frame.correlationRef, `RUN-17:${recovery.campaignId}:${frame.ordinal}`);
    }
  }
});

test('plan windows are bounded, deterministic, contiguous, and phase-aware', () => {
  const load = compileCampaign(corpus, 'RS-CAMPAIGN-LOAD-001');
  const latency = compileCampaign(corpus, 'RS-CAMPAIGN-LATENCY-001');
  const first = materializePlanWindow(load, { startOrdinal: 0, limit: 16 });
  const repeated = materializePlanWindow(load, { startOrdinal: 0, limit: 16 });
  const boundary = materializePlanWindow(load, { startOrdinal: 998, limit: 5 });

  assert.equal(comparePlanFrames(load, { startOrdinal: 0, limit: 16 }, first, repeated), true);
  assert.equal(first.every((frame) => frame.dispatchCondition === 'VIRTUAL_OFFSET'), true);
  assert.equal(first.every((frame) => Number.isSafeInteger(frame.scheduledOffsetMs)), true);
  assert.equal(first.every((frame) => (
    frame.subjectPredecessorOrdinal === null
    && frame.admissionSlotOrdinal === null
    && frame.admissionPredecessorOrdinal === null
  )), true);
  assert.deepEqual(first.map((frame) => frame.ordinal), Array.from({ length: 16 }, (_, index) => index));
  assert.deepEqual(first.slice(0, 4).map((frame) => frame.datasetId), [
    'RS-DATA-STALE-001',
    'RS-DATA-OUT-OF-ORDER-001',
    'RS-DATA-STALE-001',
    'RS-DATA-OUT-OF-ORDER-001',
  ]);
  assert.deepEqual(first.slice(0, 4).map((frame) => frame.subjectOrdinal), [0, 0, 0, 0]);
  assert.deepEqual(boundary.map((frame) => frame.phaseId), [
    'load-baseline', 'load-baseline', 'load-step-32', 'load-step-32', 'load-step-32',
  ]);
  assert.equal(materializePlanWindow(load, { startOrdinal: load.totalIterations, limit: 16 }).length, 0);
  assert.equal(materializePlanWindow(load, { startOrdinal: 0, limit: 0 }).length, 0);
  assert.equal(materializePlanWindow(load, { startOrdinal: 0, limit: REPLAY_SHADOW_LIMITS.maximumPlanWindow }).length, 1024);

  const completionDriven = materializePlanWindow(latency, { startOrdinal: 0, limit: 16 });
  assert.equal(completionDriven.every((frame) => frame.dispatchCondition === 'AFTER_PREDECESSORS_COMPLETED'), true);
  assert.equal(completionDriven.every((frame) => frame.scheduledOffsetMs === null), true);
  assert.deepEqual(
    completionDriven.slice(0, 3).map((frame) => [
      frame.subjectPredecessorOrdinal,
      frame.admissionSlotOrdinal,
      frame.admissionPredecessorOrdinal,
    ]),
    [[null, 0, null], [0, 0, 0], [1, 0, 1]],
  );

  const failure = compileCampaign(corpus, 'RS-CAMPAIGN-FAILURE-001');
  const admitted = materializePlanWindow(failure, { startOrdinal: 0, limit: 65 });
  assert.deepEqual(
    [admitted[15].admissionSlotOrdinal, admitted[15].admissionPredecessorOrdinal],
    [15, null],
  );
  assert.deepEqual(
    [admitted[16].subjectPredecessorOrdinal, admitted[16].admissionSlotOrdinal, admitted[16].admissionPredecessorOrdinal],
    [null, 0, 0],
  );
  assert.deepEqual(
    [admitted[64].subjectPredecessorOrdinal, admitted[64].admissionSlotOrdinal, admitted[64].admissionPredecessorOrdinal],
    [0, 0, 48],
  );

  const changed = structuredClone(first);
  changed[0].datasetId = load.datasetIds.at(-1);
  assert.equal(comparePlanFrames(load, { startOrdinal: 0, limit: 16 }, first, changed), false);
  assert.equal(comparePlanFrames(load, { startOrdinal: 0, limit: 16 }, changed, changed), false);
});

test('entry gate adopts existing owners and rejects duplicate authority', () => {
  const counts = Object.fromEntries(
    [...new Set(entryGate.rows.map((row) => row.classification))]
      .sort()
      .map((classification) => [classification, entryGate.rows.filter((row) => row.classification === classification).length]),
  );

  assert.equal(entryGate.disposition, 'SHADOW_SPECULATIVE');
  assert.equal(entryGate.authorityGranted, false);
  assert.deepEqual(Object.keys(entryGate).sort(), [
    'authorityGranted', 'disposition', 'packetId', 'rows', 'schema', 'schemaVersion',
  ]);
  assert.equal(entryGate.rows.length, 23);
  assert.equal(new Set(entryGate.rows.map((row) => row.id)).size, 23);
  for (const row of entryGate.rows) {
    assert.deepEqual(Object.keys(row).sort(), [
      'builtHere', 'classification', 'existingOwners', 'id', 'packetAction', 'proposedItem',
    ]);
    assert.match(row.id, /^RS-EG-\d{3}$/);
    assert.equal(Array.isArray(row.existingOwners), true);
    assert.equal(typeof row.builtHere, 'boolean');
  }
  assert.deepEqual(counts, {
    ADAPT_EXISTING: 9,
    ADOPT_EXISTING: 2,
    MISSING_BUILD: 5,
    REFERENCE_ONLY: 3,
    REJECT_DUPLICATE: 4,
  });
  assert.deepEqual(
    entryGate.rows.map((row) => [
      row.id,
      row.classification,
      row.existingOwners,
      row.packetAction,
      row.builtHere,
    ]),
    EXPECTED_ENTRY_GATE_BINDINGS,
  );
  assert.equal(entryGate.rows.filter((row) => row.classification === 'REJECT_DUPLICATE').every((row) => row.builtHere === false), true);
  assert.equal(entryGate.rows.find((row) => row.id === 'RS-EG-001').existingOwners.includes('server/src/foundation/replay/**'), true);
  assert.equal(entryGate.rows.find((row) => row.id === 'RS-EG-020').packetAction, 'Reject.');
});

test('insertion requests remain unmounted, owner-directed, and non-authoritative', () => {
  assert.equal(insertionRequests.schema, 'COSMOS_REPLAY_PORT_INSERTION_REQUESTS_V1');
  assert.equal(insertionRequests.disposition, 'PORT_REPLAY_PROPOSALS_ONLY');
  assert.equal(insertionRequests.authorityGranted, false);
  assert.deepEqual(Object.keys(insertionRequests).sort(), [
    'authorityGranted', 'disposition', 'packetId', 'registryBinding', 'requests', 'schema', 'schemaVersion',
  ]);
  assert.deepEqual(insertionRequests.registryBinding, {
    sourceBranch: 'aiops-prestage-20260714',
    sourceCommitSha1: '08e0beaa54c4c3ca9c24276785d6a302f751a226',
    sourcePath: 'AI_OPS_COLLISION_MAP.md',
    sourceBlobSha1: '5f76b29a81b6af4eee7a156afc16979fea02635e',
    sourceSha256: '92a3a2601d2894a3baacadbfb719b0e0b8ff9a950f71b6a27bc18965b7042c33',
    landedSchemaPath: 'fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.schema.json',
    landedSchemaBlobSha1: '042456c58b1cd5b6eb179c0c9c289f6e69d06034',
  });
  assert.equal(insertionRowSchema.additionalProperties, false);
  assert.deepEqual(insertionRowSchema.required, [
    'schema', 'version', 'rowId', 'status', 'requestedOwner', 'targetSeam', 'reason',
    'contract', 'tests', 'expectedBehavior', 'wiringState', 'authorityCreated',
  ]);
  assert.equal(insertionRequests.requests.length, 2);
  assert.equal(new Set(insertionRequests.requests.map((request) => request.rowId)).size, 2);
  for (const request of insertionRequests.requests) {
    assert.deepEqual(Object.keys(request).sort(), [...insertionRowSchema.required].sort());
    assert.equal(request.schema, 'InsertionRequestRowV1');
    assert.equal(request.version, 1);
    assert.equal(request.status, 'DRAFT');
    assert.equal(request.authorityCreated, false);
    assert.equal(request.wiringState, `PENDING_BACKEND:${request.rowId}`);
    assert.match(request.rowId, /^AIOPS-IR-[A-Z]+(?:-[A-Z]+)*-\d{3}$/);
    for (const key of ['contract', 'tests', 'expectedBehavior']) {
      assert.equal(request[key].length >= 1 && request[key].length <= 64, true);
      assert.equal(request[key].every((value) => typeof value === 'string' && value.length > 0), true);
    }
  }
  assert.deepEqual(
    insertionRequests.requests.map((request) => [
      request.rowId,
      request.requestedOwner,
      request.targetSeam,
    ]),
    EXPECTED_INSERTION_BINDINGS,
  );
  assert.equal(insertionRequests.requests.some((request) => Object.hasOwn(request, 'controlDraft')), false);
  assert.equal(JSON.stringify(insertionRequests).includes('RS-IR-'), false);
});

test('all fault references resolve to the accepted Product Assurance catalog source', () => {
  const ownerSource = readText(FIXTURE_URLS.faultOwner);
  for (const reference of corpus.faultRefs) {
    assert.equal(reference.owner, 'PRODUCT_ASSURANCE_FAULT_SCENARIO_V1');
    assert.equal(reference.ownerPath, 'server/src/productAssurance/faults/harness.ts');
    assert.match(ownerSource, new RegExp(`['"]${reference.scenarioId}['"]`));
  }
});

test('packet executable is pure and packet text contains no credential material', () => {
  assert.deepEqual(scanExecutableSnippet(readText(FIXTURE_URLS.harness)), []);
  for (const url of [
    FIXTURE_URLS.corpus,
    FIXTURE_URLS.entryGate,
    FIXTURE_URLS.insertionRequests,
    FIXTURE_URLS.harness,
    FIXTURE_URLS.research,
  ]) {
    assert.deepEqual(scanSecretText(readText(url)), [], url.pathname);
  }
});

test('every fixture artifact remains candidate-independent and contains no concrete candidate identity', () => {
  for (const value of [corpus, entryGate]) assertCandidateIndependentJson(value);
  for (const url of [FIXTURE_URLS.harness, FIXTURE_URLS.research]) {
    const text = readText(url);
    assert.doesNotMatch(text, CONCRETE_CANDIDATE_IDENTITY, url.pathname);
    assert.doesNotMatch(
      text,
      /\b(?:candidate|tested)(?:Commit|Sha|Hash|Tree|Branch)\s*[:=]\s*["'`](?!null\b)[^"'`]+/i,
      url.pathname,
    );
  }
});

test('focused compilation performs zero egress under the existing tripwire', () => {
  const tripwire = installEgressTripwire();
  try {
    const plan = compileCampaign(corpus, 'RS-CAMPAIGN-FAILURE-001');
    materializePlanWindow(plan, { startOrdinal: 0, limit: 32 });
    inventoryCorpus(corpus);
    tripwire.assertNoAttempts('RUN-17 replay-shadow compilation');
    assert.deepEqual(tripwire.snapshot(), { installed: true, attemptCount: 0, attempts: [] });
  } finally {
    tripwire.restore();
  }
});

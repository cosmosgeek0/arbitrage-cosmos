#!/usr/bin/env node
/**
 * Lane H — diagnostics model proof. ZERO network, ZERO wall clock.
 * Run after `npm run build -w server`:
 *   node server/test/foundation/observability/observability.mjs
 */
import {
  OBSERVABILITY_FAILURE_CODES,
  deriveDiagnostics,
} from '../../../dist/foundation/observability/index.js';
import {
  createSourcedTimestamp,
  createStructuredFailure,
  findSecretLikePaths,
} from '../../../dist/foundation/contracts/index.js';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}
function payload(input) {
  const result = deriveDiagnostics(input);
  if (!result.ok) throw new Error(`fixture unexpectedly failed: ${result.failure.code}`);
  return result.value.payload;
}
function outcome(input) {
  return deriveDiagnostics(input).value;
}
function throwsTypeError(fn) {
  try {
    fn();
    return false;
  } catch (error) {
    return error instanceof TypeError;
  }
}
function isEvidenceFailureWithoutThrow(input) {
  try {
    const result = deriveDiagnostics(input);
    return !result.ok && result.failure.code === OBSERVABILITY_FAILURE_CODES.EVIDENCE_INVALID;
  } catch {
    return false;
  }
}

const T0 = 1_800_000_000_000;
const POLICY = Object.freeze({
  heartbeatMaxAgeMs: 1_000,
  cycleMaxAgeMs: 2_000,
  rateMaxAgeMs: 1_000,
  clockSkewToleranceMs: 100,
  consecutiveFailuresDegradedAt: 2,
  consecutiveFailuresFailedAt: 4,
  maxSequenceGaps: 1,
});

function stamp(sourceId, sourceTimeMs = T0 - 100, maxAgeMs = 1_000, authority = 'SYNTHETIC_TEST', receivedAtMs = T0 - 50) {
  return createSourcedTimestamp({
    sourceTimeMs,
    receivedAtMs,
    maxAgeMs,
    authority,
    completeness: authority === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'COMPLETE',
    sourceId,
  });
}

function failure(code = 'TEST_FAILURE', occurredAt = T0 - 10) {
  return createStructuredFailure({
    component: 'test.adapter',
    stage: 'sample',
    code,
    message: 'typed fixture failure',
    occurredAt,
    retryable: true,
    safeCurrentState: 'UNCHANGED',
    recommendedOperatorAction: 'Inspect the fixture adapter.',
    correlationId: 'cor_test',
  });
}

function component(name = 'marketData') {
  return {
    name,
    phase: 'RUNNING',
    required: true,
    authority: 'SYNTHETIC_TEST',
    heartbeatAt: T0 - 100,
    lastError: null,
  };
}

function supervisor() {
  return {
    authority: 'SYNTHETIC_TEST',
    snapshot: {
      revision: 7,
      generation: 2,
      runMode: 'INTELLIGENCE',
      desiredState: 'RUNNING',
      phase: 'RUNNING',
      commandCorrelationId: null,
      startedAt: T0 - 10_000,
      lastTransitionAt: T0 - 5_000,
      heartbeatAt: T0 - 100,
      blockedAtGate: null,
      components: [component()],
      preflight: [
        { gate: 'config', status: 'PASS', blocking: true, detail: 'validated', checkedAt: T0 - 200 },
      ],
      lastError: null,
    },
  };
}

function source(sourceId = 'engine.basis') {
  return {
    sourceId,
    required: true,
    authority: 'SYNTHETIC_TEST',
    timestamp: stamp(`${sourceId}.snapshot`),
    heartbeatAtMs: T0 - 100,
    lastSuccessfulCycleAtMs: T0 - 500,
    lastError: null,
    consecutiveFailures: 0,
    eventCounter: { startAtMs: T0 - 1_000, endAtMs: T0, startCount: 10, endCount: 30 },
    messageCounter: { startAtMs: T0 - 1_000, endAtMs: T0, startCount: 100, endCount: 150 },
    reconnectCount: 2,
    sequenceGapCount: 1,
  };
}

function healthyInput() {
  return {
    nowMs: T0,
    correlationId: 'cor_observability_test',
    policy: { ...POLICY },
    supervisor: supervisor(),
    sources: [source()],
    counts: {
      required: true,
      authority: 'SYNTHETIC_TEST',
      timestamp: stamp('pipeline.counts'),
      universe: 500,
      candidates: 20,
      focus: 5,
      proposals: 2,
      rejectionCounts: [
        { code: 'STALE_DATA', count: 2 },
        { code: 'BORROW_UNKNOWN', count: 1 },
      ],
    },
    baseline: {
      required: true,
      authority: 'SYNTHETIC_TEST',
      timestamp: stamp('baseline.state'),
      state: 'READY',
    },
    borrow: {
      required: true,
      authority: 'SYNTHETIC_TEST',
      timestamp: stamp('borrow.coverage'),
      requiredAssetCount: 2,
      coveredAssetCount: 2,
    },
  };
}

// =====================================================================
section('1. complete evidence produces one truthful, guarded diagnostic envelope');
{
  const input = healthyInput();
  const result = deriveDiagnostics(input);
  check('derivation succeeds', result.ok);
  const envelope = result.value;
  const view = envelope.payload;
  check('versioned diagnostic envelope emitted', envelope.envelopeVersion === 1 && envelope.kind === 'foundation.observability.diagnostics');
  check('injected time is envelope/view time', envelope.createdAt === T0 && view.evaluatedAtMs === T0);
  check('correlation preserved', envelope.correlationId === input.correlationId);
  check('synthetic provenance is not upgraded', envelope.authority === 'SYNTHETIC_TEST');
  check('complete running evidence is HEALTHY', view.overall.state === 'HEALTHY' && view.overall.reasons.length === 0);
  check('supervisor phase and heartbeat age derived', view.supervisor.phase === 'RUNNING' && view.supervisor.heartbeat.ageMs === 100);
  check('last successful cycle age derived', view.sources[0].lastSuccessfulCycle.ageMs === 500);
  check('event rate derives from cumulative delta/window', view.sources[0].eventRate.state === 'KNOWN' && view.sources[0].eventRate.perSecond === 20);
  check('rate freshness is explicit against injected policy', view.sources[0].eventRate.ageMs === 0 && view.sources[0].eventRate.maxAgeMs === POLICY.rateMaxAgeMs);
  check('message rate derives independently', view.sources[0].messageRate.perSecond === 50);
  check('reconnect and gap evidence preserved', view.sources[0].reconnectCount === 2 && view.sources[0].sequenceGapCount === 1);
  check('all pipeline counts retained', view.counts.universe === 500 && view.counts.candidates === 20 && view.counts.focus === 5 && view.counts.proposals === 2);
  check('rejection counts sorted and totalled', view.counts.rejectionCounts.map((x) => x.code).join('|') === 'BORROW_UNKNOWN|STALE_DATA' && view.counts.totalRejections === 3);
  check('baseline state visible', view.baseline.state === 'READY' && view.baseline.freshness.state === 'FRESH');
  check('full borrow coverage derived', view.borrow.state === 'FULL' && view.borrow.coverageRatio === 1 && view.borrow.uncoveredAssetCount === 0);
  check('passing preflight omitted from failure list', view.supervisor.failedPreflight.length === 0);
  check('authority labels are stable-sorted', view.authorityLabels.map((x) => x.label).join('|') === [...view.authorityLabels].map((x) => x.label).sort().join('|'));
  check('all required authority domains labeled', ['baseline', 'borrow', 'component:marketData', 'counts', 'source:engine.basis', 'supervisor'].every((x) => view.authorityLabels.some((a) => a.label === x)));
  check('payload has no secret-like key', findSecretLikePaths(view).length === 0, findSecretLikePaths(view).join(','));
  check('envelope and nested payload are frozen', Object.isFrozen(envelope) && Object.isFrozen(view) && Object.isFrozen(view.sources) && Object.isFrozen(view.sources[0].eventRate));
}

// =====================================================================
section('2. source/receipt freshness, age boundaries, and clock skew stay explicit');
{
  const sourceTimeWins = healthyInput();
  sourceTimeWins.sources[0].timestamp = stamp('engine.basis.snapshot', T0 - 1_001, 1_000, 'SYNTHETIC_TEST', T0);
  const stale = payload(sourceTimeWins);
  check('source time wins over fresh receipt time', stale.sources[0].freshness.basis === 'SOURCE_TIME' && stale.sources[0].freshness.state === 'STALE');
  check('stale source authority downgraded', stale.sources[0].effectiveAuthority === 'UNAVAILABLE');
  check('required stale source degrades overall', stale.overall.state === 'DEGRADED');

  const exactFresh = healthyInput();
  exactFresh.sources[0].timestamp = stamp('engine.basis.snapshot', T0 - 1_000, 1_000);
  check('freshness max-age boundary is inclusive', payload(exactFresh).sources[0].freshness.state === 'FRESH');

  const receiptFallback = healthyInput();
  receiptFallback.sources[0].timestamp = stamp('engine.basis.snapshot', null, 1_000, 'SYNTHETIC_TEST', T0 - 500);
  const receiptView = payload(receiptFallback);
  check('receipt time used only when source time is null', receiptView.sources[0].freshness.basis === 'RECEIPT_TIME' && receiptView.sources[0].freshness.ageMs === 500);

  const exactSkew = healthyInput();
  exactSkew.sources[0].timestamp = stamp('engine.basis.snapshot', T0 + 100, 1_000, 'SYNTHETIC_TEST', T0 + 100);
  check('exact skew tolerance remains FRESH', payload(exactSkew).sources[0].freshness.state === 'FRESH');

  const skewed = healthyInput();
  skewed.sources[0].timestamp = stamp('engine.basis.snapshot', T0 + 101, 1_000, 'SYNTHETIC_TEST', T0 + 101);
  const skewedResult = deriveDiagnostics(skewed);
  check('receipt one ms beyond skew tolerance is rejected by value', !skewedResult.ok && skewedResult.failure.code === OBSERVABILITY_FAILURE_CODES.EVIDENCE_INVALID);

  const missing = healthyInput();
  missing.sources[0].timestamp = null;
  const missingView = payload(missing);
  check('missing timestamp is explicit UNAVAILABLE', missingView.sources[0].freshness.state === 'UNAVAILABLE' && missingView.sources[0].freshness.ageMs === null);
  check('required missing freshness makes health UNKNOWN', missingView.overall.state === 'UNKNOWN');

  const heartbeatBoundary = healthyInput();
  heartbeatBoundary.sources[0].heartbeatAtMs = T0 - 1_000;
  check('heartbeat max-age boundary is inclusive', payload(heartbeatBoundary).sources[0].heartbeat.state === 'KNOWN');
  heartbeatBoundary.sources[0].heartbeatAtMs = T0 - 1_001;
  check('heartbeat one ms past boundary is STALE', payload(heartbeatBoundary).sources[0].heartbeat.state === 'STALE');

  const heartbeatSkew = healthyInput();
  heartbeatSkew.sources[0].heartbeatAtMs = T0 + 101;
  check('future heartbeat beyond tolerance is CLOCK_SKEWED', payload(heartbeatSkew).sources[0].heartbeat.state === 'CLOCK_SKEWED');

  const cycleBoundary = healthyInput();
  cycleBoundary.sources[0].lastSuccessfulCycleAtMs = T0 - 2_000;
  check('successful-cycle max-age boundary is inclusive', payload(cycleBoundary).sources[0].lastSuccessfulCycle.state === 'KNOWN');
  cycleBoundary.sources[0].lastSuccessfulCycleAtMs = T0 - 2_001;
  check('successful cycle one ms past boundary is STALE', payload(cycleBoundary).sources[0].lastSuccessfulCycle.state === 'STALE');
}

// =====================================================================
section('3. rate semantics distinguish zero, reset, bad windows, skew, and unknown');
{
  const known = payload(healthyInput()).sources[0].eventRate;
  check('known rate carries delta and window', known.deltaCount === 20 && known.windowMs === 1_000);

  const zero = healthyInput();
  zero.sources[0].eventCounter.endCount = zero.sources[0].eventCounter.startCount;
  const zeroRate = payload(zero).sources[0].eventRate;
  check('zero rate is known, not unknown', zeroRate.state === 'KNOWN' && zeroRate.perSecond === 0 && zeroRate.deltaCount === 0);

  const reset = healthyInput();
  reset.sources[0].eventCounter.startCount = 30;
  reset.sources[0].eventCounter.endCount = 2;
  const resetView = payload(reset);
  const resetRate = resetView.sources[0].eventRate;
  check('counter decrease is named COUNTER_RESET', resetRate.state === 'COUNTER_RESET');
  check('counter reset never fabricates a rate', resetRate.perSecond === null && resetRate.deltaCount === null);
  check('required counter reset cannot report HEALTHY', resetView.overall.state === 'UNKNOWN');

  const zeroWindow = healthyInput();
  zeroWindow.sources[0].eventCounter.startAtMs = T0;
  zeroWindow.sources[0].eventCounter.endAtMs = T0;
  const invalidZeroView = payload(zeroWindow);
  const invalidZero = invalidZeroView.sources[0].eventRate;
  check('zero-duration window is INVALID_WINDOW', invalidZero.state === 'INVALID_WINDOW' && invalidZero.windowMs === 0);
  check('required invalid window degrades overall', invalidZeroView.overall.state === 'DEGRADED');

  const reverseWindow = healthyInput();
  reverseWindow.sources[0].eventCounter.startAtMs = T0;
  reverseWindow.sources[0].eventCounter.endAtMs = T0 - 1;
  check('reversed window remains explicitly invalid', payload(reverseWindow).sources[0].eventRate.state === 'INVALID_WINDOW');

  const exactRateSkew = healthyInput();
  exactRateSkew.sources[0].eventCounter = { startAtMs: T0 - 900, endAtMs: T0 + 100, startCount: 0, endCount: 10 };
  check('rate window at exact skew tolerance is usable', payload(exactRateSkew).sources[0].eventRate.state === 'KNOWN');

  const futureRate = healthyInput();
  futureRate.sources[0].eventCounter = { startAtMs: T0 - 899, endAtMs: T0 + 101, startCount: 0, endCount: 10 };
  const skewRateView = payload(futureRate);
  const skewRate = skewRateView.sources[0].eventRate;
  check('future rate window beyond tolerance is CLOCK_SKEWED', skewRate.state === 'CLOCK_SKEWED');
  check('clock-skewed window has no numeric rate', skewRate.perSecond === null && skewRate.deltaCount === null);
  check('required clock-skewed rate degrades overall', skewRateView.overall.state === 'DEGRADED');

  const exactRateAge = healthyInput();
  exactRateAge.sources[0].eventCounter = { startAtMs: T0 - 2_000, endAtMs: T0 - 1_000, startCount: 0, endCount: 10 };
  const exactAgedRate = payload(exactRateAge).sources[0].eventRate;
  check('rate max-age boundary is inclusive', exactAgedRate.state === 'KNOWN' && exactAgedRate.ageMs === 1_000);

  const obsoleteRate = healthyInput();
  obsoleteRate.sources[0].eventCounter = { startAtMs: T0 - 2_001, endAtMs: T0 - 1_001, startCount: 0, endCount: 10 };
  const obsoleteView = payload(obsoleteRate);
  check('rate one ms past max age is STALE', obsoleteView.sources[0].eventRate.state === 'STALE' && obsoleteView.sources[0].eventRate.perSecond === null);
  check('required stale rate degrades overall', obsoleteView.overall.state === 'DEGRADED');

  const absentRate = healthyInput();
  absentRate.sources[0].eventCounter = null;
  const absentRateView = payload(absentRate);
  const unknownRate = absentRateView.sources[0].eventRate;
  check('missing counter window is UNKNOWN with all fields null', unknownRate.state === 'UNKNOWN' && unknownRate.perSecond === null && unknownRate.windowMs === null);
  check('required missing counter cannot report HEALTHY', absentRateView.overall.state === 'UNKNOWN');
}

// =====================================================================
section('4. deterministic overall health law and exact policy boundaries');
{
  const belowFailures = healthyInput();
  belowFailures.sources[0].consecutiveFailures = 1;
  check('below failure threshold stays healthy', payload(belowFailures).overall.state === 'HEALTHY');

  const degradedFailures = healthyInput();
  degradedFailures.sources[0].consecutiveFailures = 2;
  check('degraded threshold is inclusive', payload(degradedFailures).overall.state === 'DEGRADED');
  degradedFailures.sources[0].consecutiveFailures = 3;
  check('between thresholds remains degraded', payload(degradedFailures).overall.state === 'DEGRADED');
  degradedFailures.sources[0].consecutiveFailures = 4;
  check('failed threshold is inclusive', payload(degradedFailures).overall.state === 'FAILED');

  const gapBoundary = healthyInput();
  gapBoundary.sources[0].sequenceGapCount = 1;
  check('sequence-gap policy boundary is allowed', payload(gapBoundary).overall.state === 'HEALTHY');
  gapBoundary.sources[0].sequenceGapCount = 2;
  check('one gap above policy degrades', payload(gapBoundary).overall.state === 'DEGRADED');

  const phases = [
    ['DEGRADED', 'DEGRADED'],
    ['FAILED', 'FAILED'],
    ['STOPPED', 'UNKNOWN'],
  ];
  for (const [phase, expected] of phases) {
    const input = healthyInput();
    input.supervisor.snapshot.phase = phase;
    check(`supervisor ${phase} maps to ${expected}`, payload(input).overall.state === expected);
  }

  const blockingGate = healthyInput();
  blockingGate.supervisor.snapshot.phase = 'BLOCKED';
  blockingGate.supervisor.snapshot.blockedAtGate = 'borrow';
  blockingGate.supervisor.snapshot.preflight = [
    { gate: 'borrow', status: 'FAIL', blocking: true, detail: 'unavailable', checkedAt: T0 },
  ];
  const blocked = payload(blockingGate);
  check('blocking failed preflight blocks health', blocked.overall.state === 'BLOCKED');
  check('failed preflight is projected without arbitrary detail', blocked.supervisor.failedPreflight[0].gate === 'borrow' && !('detail' in blocked.supervisor.failedPreflight[0]));

  const advisoryGate = healthyInput();
  advisoryGate.supervisor.snapshot.preflight = [
    { gate: 'advisory', status: 'FAIL', blocking: false, detail: 'notice', checkedAt: T0 },
  ];
  check('non-blocking failed preflight degrades', payload(advisoryGate).overall.state === 'DEGRADED');

  const timedGate = healthyInput();
  timedGate.supervisor.snapshot.phase = 'BLOCKED';
  timedGate.supervisor.snapshot.blockedAtGate = 'remote';
  timedGate.supervisor.snapshot.preflight = [
    { gate: 'remote', status: 'TIMEOUT', blocking: true, detail: 'deadline', checkedAt: T0 },
  ];
  const timedView = payload(timedGate);
  check('blocking timeout blocks with exact status', timedView.overall.state === 'BLOCKED' && timedView.supervisor.failedPreflight[0].status === 'TIMEOUT');

  const componentFailed = healthyInput();
  componentFailed.supervisor.snapshot.components[0].phase = 'FAILED';
  check('required failed component fails overall', payload(componentFailed).overall.state === 'FAILED');

  for (const phase of ['STOPPED', 'VALIDATING', 'STARTING', 'PAUSING', 'PAUSED', 'STOPPING']) {
    const input = healthyInput();
    input.supervisor.snapshot.components[0].phase = phase;
    const view = payload(input);
    check(`required component ${phase} cannot report healthy`, view.overall.state !== 'HEALTHY' && view.overall.reasons.some((reason) => reason.code === 'REQUIRED_COMPONENT_NOT_RUNNING'));
  }

  const componentUnknown = healthyInput();
  componentUnknown.supervisor.snapshot.components[0].authority = 'UNAVAILABLE';
  check('required component unavailable authority is UNKNOWN', payload(componentUnknown).overall.state === 'UNKNOWN');

  const supervisorUnknownAuthority = healthyInput();
  supervisorUnknownAuthority.supervisor.authority = 'UNAVAILABLE';
  const supervisorAuthorityView = payload(supervisorUnknownAuthority);
  check('UNAVAILABLE supervisor authority cannot report HEALTHY', supervisorAuthorityView.overall.state === 'UNKNOWN' && supervisorAuthorityView.overall.reasons.some((reason) => reason.code === 'SUPERVISOR_AUTHORITY_UNKNOWN'));

  const supervisorHeartbeat = healthyInput();
  supervisorHeartbeat.supervisor.snapshot.heartbeatAt = T0 - 1_001;
  check('stale supervisor heartbeat degrades running runtime', payload(supervisorHeartbeat).overall.state === 'DEGRADED');

  const borrowPartial = healthyInput();
  borrowPartial.borrow.coveredAssetCount = 1;
  const partialView = payload(borrowPartial);
  check('partial borrow coverage degrades', partialView.overall.state === 'DEGRADED' && partialView.borrow.state === 'PARTIAL' && partialView.borrow.coverageRatio === 0.5);

  const borrowNone = healthyInput();
  borrowNone.borrow.coveredAssetCount = 0;
  check('zero required borrow coverage blocks', payload(borrowNone).overall.state === 'BLOCKED');

  const borrowUnknown = healthyInput();
  borrowUnknown.borrow.coveredAssetCount = null;
  const unknownBorrowView = payload(borrowUnknown);
  check('unknown borrow count stays null/UNKNOWN', unknownBorrowView.overall.state === 'UNKNOWN' && unknownBorrowView.borrow.state === 'UNKNOWN' && unknownBorrowView.borrow.coverageRatio === null);

  const borrowNotRequired = healthyInput();
  borrowNotRequired.borrow.required = false;
  borrowNotRequired.borrow.requiredAssetCount = null;
  borrowNotRequired.borrow.coveredAssetCount = null;
  const notRequiredView = payload(borrowNotRequired);
  check('non-required borrow is NOT_REQUIRED without fake ratio', notRequiredView.overall.state === 'HEALTHY' && notRequiredView.borrow.state === 'NOT_REQUIRED' && notRequiredView.borrow.coverageRatio === null);

  const noRequiredAssets = healthyInput();
  noRequiredAssets.borrow.requiredAssetCount = 0;
  noRequiredAssets.borrow.coveredAssetCount = 0;
  check('zero required assets is NOT_REQUIRED, ratio null', payload(noRequiredAssets).borrow.state === 'NOT_REQUIRED' && payload(noRequiredAssets).borrow.coverageRatio === null);

  for (const [baselineState, expected] of [['WARMING', 'UNKNOWN'], ['STALE', 'DEGRADED'], ['FAILED', 'FAILED']]) {
    const input = healthyInput();
    input.baseline.state = baselineState;
    check(`baseline ${baselineState} maps to ${expected}`, payload(input).overall.state === expected);
  }

  const precedence = healthyInput();
  precedence.sources[0].consecutiveFailures = 4;
  precedence.borrow.coveredAssetCount = 0;
  check('FAILED outranks simultaneous BLOCKED', payload(precedence).overall.state === 'FAILED');

  const degradedOverUnknown = healthyInput();
  degradedOverUnknown.sources[0].sequenceGapCount = 2;
  degradedOverUnknown.sources[0].consecutiveFailures = null;
  check('confirmed degradation outranks unknown evidence', payload(degradedOverUnknown).overall.state === 'DEGRADED');

  const missingCounts = healthyInput();
  missingCounts.counts = null;
  const missingCountsView = payload(missingCounts);
  check('absent counts are explicit nulls and UNKNOWN health', missingCountsView.overall.state === 'UNKNOWN' && missingCountsView.counts.universe === null && missingCountsView.counts.totalRejections === null);

  const optionalCounts = healthyInput();
  optionalCounts.counts.required = false;
  optionalCounts.counts.universe = null;
  optionalCounts.counts.candidates = null;
  optionalCounts.counts.focus = null;
  optionalCounts.counts.proposals = null;
  optionalCounts.counts.rejectionCounts = null;
  check('explicitly optional count values do not fake or poison health', payload(optionalCounts).overall.state === 'HEALTHY');

  const missingBaseline = healthyInput();
  missingBaseline.baseline = null;
  check('absent baseline is UNKNOWN, never READY', payload(missingBaseline).baseline.state === 'UNKNOWN' && payload(missingBaseline).overall.state === 'UNKNOWN');

  const missingBorrow = healthyInput();
  missingBorrow.borrow = null;
  check('absent borrow evidence is UNKNOWN, never NONE/FULL', payload(missingBorrow).borrow.state === 'UNKNOWN' && payload(missingBorrow).overall.state === 'UNKNOWN');

  const noSources = healthyInput();
  noSources.sources = [];
  check('empty source evidence cannot report healthy', payload(noSources).overall.state === 'UNKNOWN');
}

// =====================================================================
section('5. malformed evidence fails by value; malformed caller context fails loudly');
{
  const negative = healthyInput();
  negative.sources[0].reconnectCount = -1;
  const negativeResult = deriveDiagnostics(negative);
  check('negative evidence rejected', !negativeResult.ok && negativeResult.failure.code === OBSERVABILITY_FAILURE_CODES.EVIDENCE_INVALID);
  check('failure preserves injected time/correlation', !negativeResult.ok && negativeResult.failure.occurredAt === T0 && negativeResult.failure.correlationId === negative.correlationId);

  const duplicateSource = healthyInput();
  duplicateSource.sources.push(source());
  check('duplicate source ID rejected', !deriveDiagnostics(duplicateSource).ok);

  const authorityMismatch = healthyInput();
  authorityMismatch.sources[0].authority = 'RECORDED_REPLAY';
  check('timestamp/evidence authority mismatch rejected', !deriveDiagnostics(authorityMismatch).ok);

  const impossibleBorrow = healthyInput();
  impossibleBorrow.borrow.coveredAssetCount = 3;
  check('covered borrow cannot exceed required', !deriveDiagnostics(impossibleBorrow).ok);

  const duplicateReject = healthyInput();
  duplicateReject.counts.rejectionCounts.push({ code: 'STALE_DATA', count: 1 });
  check('duplicate rejection code rejected', !deriveDiagnostics(duplicateReject).ok);

  const sparseSources = healthyInput();
  sparseSources.sources = new Array(1);
  check('sparse sources array is a typed failure, not throw/empty success', isEvidenceFailureWithoutThrow(sparseSources));

  const sparseComponents = healthyInput();
  sparseComponents.supervisor.snapshot.components = new Array(1);
  check('sparse components array is a typed failure, not throw/empty success', isEvidenceFailureWithoutThrow(sparseComponents));

  const sparseRejections = healthyInput();
  sparseRejections.counts.rejectionCounts = new Array(1);
  check('sparse rejection array is a typed failure, not throw/empty success', isEvidenceFailureWithoutThrow(sparseRejections));

  const sparsePreflight = healthyInput();
  sparsePreflight.supervisor.snapshot.preflight = new Array(1);
  check('sparse preflight array is a typed failure, not throw/empty success', isEvidenceFailureWithoutThrow(sparsePreflight));

  const sourceAfterReceipt = healthyInput();
  sourceAfterReceipt.sources[0].timestamp = stamp('engine.basis.snapshot', T0, 1_000, 'SYNTHETIC_TEST', T0 - 1);
  check('source timestamp after receipt is rejected', isEvidenceFailureWithoutThrow(sourceAfterReceipt));

  const receiptBeyondClock = healthyInput();
  receiptBeyondClock.sources[0].timestamp = stamp('engine.basis.snapshot', T0 + 101, 1_000, 'SYNTHETIC_TEST', T0 + 101);
  check('receipt beyond injected skew tolerance is rejected', isEvidenceFailureWithoutThrow(receiptBeyondClock));

  const optionalBorrowContradiction = healthyInput();
  optionalBorrowContradiction.borrow.required = false;
  optionalBorrowContradiction.borrow.requiredAssetCount = 2;
  optionalBorrowContradiction.borrow.coveredAssetCount = 2;
  check('optional borrow cannot carry nonzero required assets', isEvidenceFailureWithoutThrow(optionalBorrowContradiction));

  const skippedWithTime = healthyInput();
  skippedWithTime.supervisor.snapshot.preflight = [
    { gate: 'later', status: 'SKIPPED', blocking: true, detail: 'not run', checkedAt: T0 },
  ];
  check('skipped gate with checked time rejected', !deriveDiagnostics(skippedWithTime).ok);

  const checkedWithoutTime = healthyInput();
  checkedWithoutTime.supervisor.snapshot.preflight = [
    { gate: 'config', status: 'PASS', blocking: true, detail: 'ok', checkedAt: null },
  ];
  check('checked gate without time rejected', !deriveDiagnostics(checkedWithoutTime).ok);

  const futureCheckedAt = healthyInput();
  futureCheckedAt.supervisor.snapshot.preflight[0].checkedAt = T0 + 1;
  check('future preflight checkedAt rejected', isEvidenceFailureWithoutThrow(futureCheckedAt));

  const blockedWithoutFailure = healthyInput();
  blockedWithoutFailure.supervisor.snapshot.phase = 'BLOCKED';
  blockedWithoutFailure.supervisor.snapshot.blockedAtGate = 'config';
  check('blockedAtGate without matching failed gate rejected', isEvidenceFailureWithoutThrow(blockedWithoutFailure));

  const blockedWrongGate = healthyInput();
  blockedWrongGate.supervisor.snapshot.phase = 'BLOCKED';
  blockedWrongGate.supervisor.snapshot.blockedAtGate = 'borrow';
  blockedWrongGate.supervisor.snapshot.preflight = [
    { gate: 'config', status: 'FAIL', blocking: true, detail: 'failed', checkedAt: T0 },
  ];
  check('blockedAtGate must match the exact failed gate', isEvidenceFailureWithoutThrow(blockedWrongGate));

  const blockingFailureWhileRunning = healthyInput();
  blockingFailureWhileRunning.supervisor.snapshot.preflight = [
    { gate: 'config', status: 'FAIL', blocking: true, detail: 'failed', checkedAt: T0 },
  ];
  check('blocking preflight failure cannot coexist with RUNNING phase', isEvidenceFailureWithoutThrow(blockingFailureWhileRunning));

  const blockedGateWhileRunning = healthyInput();
  blockedGateWhileRunning.supervisor.snapshot.blockedAtGate = 'config';
  check('blockedAtGate cannot coexist with non-BLOCKED phase', isEvidenceFailureWithoutThrow(blockedGateWhileRunning));

  const malformedFailure = healthyInput();
  malformedFailure.sources[0].lastError = { code: 'NOPE' };
  check('unstructured last error rejected', !deriveDiagnostics(malformedFailure).ok);

  const badWindowCount = healthyInput();
  badWindowCount.sources[0].eventCounter.startCount = -1;
  check('negative counter sample rejected, not treated as reset', !deriveDiagnostics(badWindowCount).ok);

  const invalidRejectionCode = healthyInput();
  invalidRejectionCode.counts.rejectionCounts[0].code = 'free form';
  check('unbounded rejection label rejected', !deriveDiagnostics(invalidRejectionCode).ok);

  const badNow = healthyInput();
  badNow.nowMs = NaN;
  check('invalid injected clock throws TypeError', throwsTypeError(() => deriveDiagnostics(badNow)));

  const badCorrelation = healthyInput();
  badCorrelation.correlationId = '';
  check('empty correlation ID throws TypeError', throwsTypeError(() => deriveDiagnostics(badCorrelation)));

  const badPolicy = healthyInput();
  badPolicy.policy.consecutiveFailuresFailedAt = badPolicy.policy.consecutiveFailuresDegradedAt;
  check('overlapping health thresholds rejected', throwsTypeError(() => deriveDiagnostics(badPolicy)));

  const missingRatePolicy = healthyInput();
  delete missingRatePolicy.policy.rateMaxAgeMs;
  check('rate freshness policy cannot be omitted', throwsTypeError(() => deriveDiagnostics(missingRatePolicy)));

  check('missing input object throws TypeError', throwsTypeError(() => deriveDiagnostics(null)));
}

// =====================================================================
section('6. deterministic ordering, input isolation, and immutable output');
{
  const a = healthyInput();
  const secondSource = source('engine.volume');
  secondSource.timestamp = stamp('engine.volume.snapshot');
  a.sources.push(secondSource);
  a.supervisor.snapshot.components.push(component('volumeEngine'));
  const b = structuredClone(a);
  b.sources.reverse();
  b.supervisor.snapshot.components.reverse();
  b.counts.rejectionCounts.reverse();
  const aJson = JSON.stringify(outcome(a));
  const bJson = JSON.stringify(outcome(b));
  check('input array order cannot change output bytes', aJson === bJson);

  const codeUnits = healthyInput();
  codeUnits.sources = [source('ä'), source('a'), source('Z')];
  const orderedIds = payload(codeUnits).sources.map((item) => item.sourceId).join('|');
  check('source ordering uses deterministic UTF-16 code units', orderedIds === 'Z|a|ä', orderedIds);

  const repeat = healthyInput();
  check('same evidence produces byte-identical envelope', JSON.stringify(outcome(repeat)) === JSON.stringify(outcome(repeat)));

  const untouched = healthyInput();
  const before = JSON.stringify(untouched);
  deriveDiagnostics(untouched);
  check('derivation does not mutate input evidence', JSON.stringify(untouched) === before);

  const mutable = healthyInput();
  const emitted = outcome(mutable);
  mutable.sources[0].heartbeatAtMs = T0 - 999;
  mutable.counts.rejectionCounts[0].count = 99;
  mutable.supervisor.snapshot.components[0].name = 'rewritten';
  check('later input mutation cannot rewrite heartbeat', emitted.payload.sources[0].heartbeat.ageMs === 100);
  check('later input mutation cannot rewrite rejection counts', emitted.payload.counts.totalRejections === 3);
  check('later input mutation cannot rewrite component identity', emitted.payload.supervisor.components[0].name === 'marketData');

  let outputMutationThrew = false;
  try {
    emitted.payload.sources[0].sourceId = 'rewritten';
  } catch (error) {
    outputMutationThrew = error instanceof TypeError;
  }
  check('nested output mutation is rejected', outputMutationThrew && emitted.payload.sources[0].sourceId === 'engine.basis');

  const replay = healthyInput();
  replay.supervisor.authority = 'RECORDED_REPLAY';
  replay.supervisor.snapshot.components[0].authority = 'RECORDED_REPLAY';
  replay.sources[0].authority = 'RECORDED_REPLAY';
  replay.sources[0].timestamp = stamp('engine.basis.snapshot', T0 - 100, 1_000, 'RECORDED_REPLAY');
  replay.counts.authority = 'RECORDED_REPLAY';
  replay.counts.timestamp = stamp('pipeline.counts', T0 - 100, 1_000, 'RECORDED_REPLAY');
  replay.baseline.authority = 'RECORDED_REPLAY';
  replay.baseline.timestamp = stamp('baseline.state', T0 - 100, 1_000, 'RECORDED_REPLAY');
  replay.borrow.authority = 'RECORDED_REPLAY';
  replay.borrow.timestamp = stamp('borrow.coverage', T0 - 100, 1_000, 'RECORDED_REPLAY');
  check('replay provenance stays RECORDED_REPLAY', outcome(replay).authority === 'RECORDED_REPLAY');

  const live = healthyInput();
  live.supervisor.authority = 'LIVE_PRIVATE';
  live.supervisor.snapshot.components[0].authority = 'LIVE_PUBLIC';
  live.sources[0].authority = 'LIVE_PUBLIC';
  live.sources[0].timestamp = stamp('engine.basis.snapshot', T0 - 100, 1_000, 'LIVE_PUBLIC');
  live.counts.authority = 'DERIVED_LIVE';
  live.counts.timestamp = stamp('pipeline.counts', T0 - 100, 1_000, 'DERIVED_LIVE');
  live.baseline.authority = 'DERIVED_LIVE';
  live.baseline.timestamp = stamp('baseline.state', T0 - 100, 1_000, 'DERIVED_LIVE');
  live.borrow.authority = 'LIVE_PRIVATE';
  live.borrow.timestamp = stamp('borrow.coverage', T0 - 100, 1_000, 'LIVE_PRIVATE');
  check('derived live envelope is labeled DERIVED_LIVE', outcome(live).authority === 'DERIVED_LIVE');

  const preservedError = healthyInput();
  preservedError.sources[0].lastError = failure('SOURCE_TIMEOUT');
  const errorView = payload(preservedError);
  check('last error remains exact structured evidence', errorView.sources[0].lastError.code === 'SOURCE_TIMEOUT' && errorView.sources[0].lastError.occurredAt === T0 - 10);
  check('historical last error alone does not fabricate current failure', errorView.overall.state === 'HEALTHY');
}

// ---------- summary ----------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
if (failed.length > 0) {
  for (const item of failed) console.log(`  ✗ ${item.name}`);
  process.exit(1);
}

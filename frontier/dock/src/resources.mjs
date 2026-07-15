import { cloneCanonical, contractError, deepFreeze } from './canonical.mjs';
import { validateResourceBudgetClaim, validateResourceRateCompatibility } from './records.mjs';

function fail(code, message) {
  throw contractError(code, message);
}

function percentile(values, probability) {
  if (!Array.isArray(values) || values.length === 0) fail('LATENCY_SAMPLES_REQUIRED', 'fixture latency samples must not be empty');
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.some((value) => !Number.isFinite(value) || value < 0)) fail('LATENCY_SAMPLE_INVALID', 'fixture latency samples must be finite and non-negative');
  return sorted[Math.ceil(probability * sorted.length) - 1];
}

function measuredLatency(samples) {
  return deepFreeze({
    p50: percentile(samples, 0.50),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
  });
}

export function runFixtureLoad({
  resourceBudgetClaim,
  maxSafeRateClaim,
  windowSizeMs,
  offeredEvents,
  peakQueueDepth,
  latencySamples,
  storageBytesPerEvent,
  networkBytes,
  modelCalls,
}) {
  validateResourceRateCompatibility(resourceBudgetClaim, maxSafeRateClaim);
  if (!Number.isSafeInteger(windowSizeMs) || windowSizeMs !== maxSafeRateClaim.windowSizeMs) fail('RATE_WINDOW_MISMATCH', 'fixture load window must equal the claimed window');
  if (!Number.isSafeInteger(offeredEvents) || offeredEvents <= 0 || Object.is(offeredEvents, -0)) fail('OFFERED_RATE_INVALID', 'offered fixture events must be a positive safe integer');
  if (!Number.isSafeInteger(storageBytesPerEvent) || storageBytesPerEvent < 0 || Object.is(storageBytesPerEvent, -0)) fail('STORAGE_RATE_INVALID', 'storage bytes per event must be a non-negative safe integer');
  if (!Number.isSafeInteger(peakQueueDepth) || peakQueueDepth < 0 || Object.is(peakQueueDepth, -0)) fail('QUEUE_SAMPLE_INVALID', 'peak fixture queue depth must be a non-negative safe integer');
  if (!Number.isSafeInteger(networkBytes) || networkBytes < 0 || Object.is(networkBytes, -0)
    || !Number.isSafeInteger(modelCalls) || modelCalls < 0 || Object.is(modelCalls, -0)) {
    fail('RESOURCE_SAMPLE_INVALID', 'network and model samples must be non-negative safe integers');
  }
  if (!Array.isArray(latencySamples) || latencySamples.length !== offeredEvents) fail('LATENCY_SAMPLE_COUNT_MISMATCH', 'fixture load requires one latency sample per offered event');
  const latency = measuredLatency(latencySamples);
  const storageGrowth = offeredEvents * storageBytesPerEvent;
  if (!Number.isSafeInteger(storageGrowth)) fail('STORAGE_GROWTH_OVERFLOW', 'fixture storage growth overflowed');

  const exceeded = [];
  if (offeredEvents > maxSafeRateClaim.eventsPerWindow || offeredEvents > resourceBudgetClaim.eventRate.limit) exceeded.push('EVENT_RATE');
  if (peakQueueDepth > maxSafeRateClaim.queueCapacity || peakQueueDepth > resourceBudgetClaim.queue.limit) exceeded.push('QUEUE');
  if (networkBytes > resourceBudgetClaim.network.limit) exceeded.push('NETWORK');
  if (modelCalls > resourceBudgetClaim.modelUse.limit) exceeded.push('MODEL_USE');
  if (storageGrowth > resourceBudgetClaim.storageGrowth.limit) exceeded.push('STORAGE_GROWTH');
  if (latency.p50 > resourceBudgetClaim.latency.limit.p50) exceeded.push('P50_LATENCY');
  if (latency.p95 > resourceBudgetClaim.latency.limit.p95) exceeded.push('P95_LATENCY');
  if (latency.p99 > resourceBudgetClaim.latency.limit.p99) exceeded.push('P99_LATENCY');
  if (offeredEvents === maxSafeRateClaim.eventsPerWindow && (
    peakQueueDepth !== resourceBudgetClaim.queue.observed
    || networkBytes !== resourceBudgetClaim.network.observed
    || modelCalls !== resourceBudgetClaim.modelUse.observed
    || storageGrowth !== resourceBudgetClaim.storageGrowth.observed
    || ['p50', 'p95', 'p99'].some((percentile) => latency[percentile] !== resourceBudgetClaim.latency.observed[percentile])
  )) exceeded.push('MAX_RATE_PROOF_MISMATCH');

  if (exceeded.length > 0) {
    return deepFreeze({
      state: 'DEGRADATION_REQUESTED',
      exceeded,
      offeredEvents,
      acceptedEvents: 0,
      rejectedEvents: offeredEvents,
      silentLoss: false,
      backpressureApplied: true,
      canonicalState: null,
      forgedGreen: false,
      authorityClass: 'NO_AUTHORITY',
      measured: { latency, networkBytes, modelCalls, storageGrowth, peakQueueDepth, offeredEvents, windowSizeMs },
      degradationRequest: {
        requestedAction: 'CANONICAL_OWNER_REVIEW_REQUIRED',
        reasonCodes: exceeded,
        authorityGranted: false,
      },
    });
  }

  return deepFreeze({
    state: 'WITHIN_FIXTURE_ENVELOPE',
    exceeded: [],
    offeredEvents,
    acceptedEvents: offeredEvents,
    rejectedEvents: 0,
    silentLoss: false,
    backpressureApplied: offeredEvents >= maxSafeRateClaim.eventsPerWindow,
    canonicalState: null,
    forgedGreen: false,
    authorityClass: 'NO_AUTHORITY',
    measured: { latency, networkBytes, modelCalls, storageGrowth, peakQueueDepth, offeredEvents, windowSizeMs },
    degradationRequest: null,
  });
}

export function resourceClaimProjection(claim) {
  validateResourceBudgetClaim(claim);
  return deepFreeze({
    claim: cloneCanonical(claim),
    productionMeasurementAvailable: false,
    fixtureCompatibilityEvidenceOnly: true,
    authorityClass: 'NO_AUTHORITY',
  });
}

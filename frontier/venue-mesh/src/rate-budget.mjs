import { arrayValue, boundedString, deepFreeze, safeInteger } from './guards.mjs';
import { fail } from './errors.mjs';

export function simulateRateBudget({ windowStartMs, intervalMs, weightLimit, queueCapacity, requests }) {
  safeInteger(windowStartMs, 'rate.windowStartMs', { minimum: 0 });
  safeInteger(intervalMs, 'rate.intervalMs', { minimum: 1 });
  safeInteger(weightLimit, 'rate.weightLimit', { minimum: 1 });
  safeInteger(queueCapacity, 'rate.queueCapacity', { minimum: 1 });
  arrayValue(requests, 'rate.requests', { maximum: 100_000 });
  let usedWeight = 0;
  const seen = new Set();
  const decisions = [];
  let previousAtMs = windowStartMs;
  for (const [index, request] of requests.entries()) {
    if (request === null || typeof request !== 'object' || Array.isArray(request)) fail('RATE_REQUEST_INVALID', `rate.requests[${index}] must be an object`);
    const id = boundedString(request.id, `rate.requests[${index}].id`, 128);
    if (seen.has(id)) fail('RATE_REQUEST_DUPLICATE', `duplicate rate request ${id}`);
    seen.add(id);
    const atMs = safeInteger(request.atMs, `rate.requests[${index}].atMs`, { minimum: windowStartMs });
    const weight = safeInteger(request.weight, `rate.requests[${index}].weight`, { minimum: 1 });
    const queueDepth = safeInteger(request.queueDepth, `rate.requests[${index}].queueDepth`, { minimum: 0 });
    if (atMs < previousAtMs) fail('RATE_REQUEST_ORDER_INVALID', 'rate requests must be ordered by time');
    previousAtMs = atMs;
    const outsideWindow = atMs >= windowStartMs + intervalMs;
    const reasons = [];
    if (outsideWindow) reasons.push('OUTSIDE_FIXTURE_WINDOW');
    if (queueDepth > queueCapacity) reasons.push('QUEUE_CAPACITY_EXCEEDED');
    if (usedWeight + weight > weightLimit) reasons.push('RATE_WEIGHT_EXHAUSTED');
    const accepted = reasons.length === 0;
    if (accepted) usedWeight += weight;
    decisions.push({ id, accepted, reasons, usedWeightAfter: usedWeight, silentLoss: false });
  }
  const rejectedCount = decisions.filter((decision) => !decision.accepted).length;
  return deepFreeze({
    schema: 'VenueRateBudgetSimulationV1',
    windowStartMs,
    intervalMs,
    weightLimit,
    queueCapacity,
    usedWeight,
    acceptedCount: decisions.length - rejectedCount,
    rejectedCount,
    backpressureApplied: rejectedCount > 0,
    silentLoss: false,
    canonicalStateWritten: false,
    decisions,
  });
}

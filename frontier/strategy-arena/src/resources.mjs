import {
  cloneCanonical,
  deepFreeze,
  runFixtureLoad,
  sha256,
} from '../../dock/src/index.mjs';
import { boundedString, exactShape, fail, safeInteger } from './validation.mjs';

export function runArenaLoadProof({ resourceBudgetClaim, maxSafeRateClaim, events, queueBurst = 1 }) {
  try {
    resourceBudgetClaim = deepFreeze(cloneCanonical(resourceBudgetClaim));
    maxSafeRateClaim = deepFreeze(cloneCanonical(maxSafeRateClaim));
    events = deepFreeze(cloneCanonical(events));
  } catch {
    fail('ARENA_LOAD_SAMPLE_INVALID', 'fixture load inputs must be snapshot-safe canonical JSON');
  }
  if (!Array.isArray(events) || events.length === 0 || events.length > 10_000) fail('ARENA_LOAD_SAMPLE_INVALID', 'fixture load requires a bounded non-empty event array');
  safeInteger(queueBurst, 'queueBurst', 1, 10_000);
  const identities = new Set();
  for (const [index, event] of events.entries()) {
    if (event === null || typeof event !== 'object' || Array.isArray(event)) fail('ARENA_LOAD_EVENT_INVALID', `fixture event ${index} must be an object`);
    exactShape(event, ['eventId', 'fixture'], `ArenaLoadEvent[${index}]`);
    boundedString(event.eventId, `ArenaLoadEvent[${index}].eventId`, 128);
    if (event.fixture !== true) fail('ARENA_LOAD_EVENT_INVALID', `fixture event ${index} must be explicitly fixture-only`);
    const identity = event.eventId;
    if (identities.has(identity)) fail('ARENA_LOAD_EVENT_DUPLICATE', 'fixture load events must have unique canonical identities');
    identities.add(identity);
  }
  const peakQueueDepth = Math.min(queueBurst, events.length);
  const load = runFixtureLoad({
    resourceBudgetClaim,
    maxSafeRateClaim,
    windowSizeMs: maxSafeRateClaim.windowSizeMs,
    offeredEvents: events.length,
    peakQueueDepth,
    latencySamples: events.map(() => 1),
    storageBytesPerEvent: 2_048,
    networkBytes: 0,
    modelCalls: 0,
  });
  if (load.state !== 'WITHIN_FIXTURE_ENVELOPE') {
    return deepFreeze({
      ...load,
      fixtureProcessedDigest: sha256([]),
      processedEventCount: 0,
      deterministicQueueAlgorithm: 'PREFLIGHT_THEN_BOUNDED_BURST_HASH_AND_DRAIN',
      transportOpened: false,
      mutationPerformed: false,
    });
  }
  const processed = [];
  for (let offset = 0; offset < events.length; offset += queueBurst) {
    const queue = events.slice(offset, offset + queueBurst);
    while (queue.length > 0) {
      const current = queue.shift();
      processed.push(sha256({ index: processed.length, event: current }));
    }
  }
  return deepFreeze({
    ...load,
    fixtureProcessedDigest: sha256(processed),
    processedEventCount: processed.length,
    deterministicQueueAlgorithm: 'PREFLIGHT_THEN_BOUNDED_BURST_HASH_AND_DRAIN',
    transportOpened: false,
    mutationPerformed: false,
  });
}

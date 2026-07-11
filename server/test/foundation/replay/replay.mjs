#!/usr/bin/env node
/** Lane G — bounded replay synthetic proof. ZERO network and ZERO wall clock. */
import {
  BoundedRingBuffer,
  DeterministicVirtualClock,
  MAX_REPLAY_ARRAY_LENGTH,
  MAX_REPLAY_ENVELOPE_BYTES,
  MAX_REPLAY_ENVELOPE_EVENTS,
  MAX_REPLAY_OBJECT_KEYS,
  MAX_REPLAY_PAYLOAD_DEPTH,
  MAX_REPLAY_PAYLOAD_NODES,
  MAX_REPLAY_POST_TRIGGER_EVENTS,
  MAX_REPLAY_RING_CAPACITY,
  MAX_REPLAY_STRING_LENGTH,
  REPLAY_CHECKSUM_ALGORITHM,
  REPLAY_FAILURE_CODES,
  REPLAY_SCHEMA_VERSION,
  createPrePostReplayCapture,
  createReplayEvent,
  createReplayTrigger,
  inspectReplayEnvelope,
  loadReplayEnvelope,
  parseReplayEnvelope,
  replayEnvelope,
  serializeReplayEnvelope,
  storeReplayEnvelope,
} from '../../../dist/foundation/replay/index.js';
import * as replayModule from '../../../dist/foundation/replay/index.js';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}
function failureCode(result) {
  return result.ok ? null : result.failure.code;
}
function unwrap(result, label) {
  if (!result.ok) throw new Error(`${label}: ${result.failure.code} ${result.failure.message}`);
  return result.value;
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const T0 = 1_800_000_000_000;

function stamp(sequence, overrides = {}) {
  const receivedAtMs = overrides.receivedAtMs ?? T0 + 10 + sequence * 10;
  return {
    sourceTimeMs: overrides.sourceTimeMs === undefined ? receivedAtMs : overrides.sourceTimeMs,
    receivedAtMs,
    maxAgeMs: overrides.maxAgeMs ?? 10_000,
    authority: overrides.authority ?? 'SYNTHETIC_TEST',
    completeness: overrides.completeness ?? 'COMPLETE',
    sourceId: overrides.sourceId ?? 'replay.synthetic.fixture',
  };
}

function event(sequence, overrides = {}) {
  return {
    streamId: overrides.streamId ?? 'market:TESTUSDT',
    sequence,
    kind: overrides.kind ?? 'market.sample',
    timestamp: overrides.timestamp ?? stamp(sequence, overrides),
    correlationId: overrides.correlationId ?? 'cor_replay_test',
    payload: Object.prototype.hasOwnProperty.call(overrides, 'payload')
      ? overrides.payload
      : { symbol: 'TESTUSDT', value: sequence },
  };
}

function trigger(overrides = {}) {
  return {
    triggerId: overrides.triggerId ?? 'trigger_test_1',
    kind: overrides.kind ?? 'anomaly.detected',
    sourceTimeMs: overrides.sourceTimeMs ?? T0 + 30,
    receivedAtMs: overrides.receivedAtMs ?? T0 + 30,
    authority: overrides.authority ?? 'SYNTHETIC_TEST',
    sourceId: overrides.sourceId ?? 'replay.synthetic.trigger',
    correlationId: overrides.correlationId ?? 'cor_replay_test',
  };
}

function completeEnvelope(captureId = 'capture_complete_1', payloadFactory = (n) => ({ symbol: 'TESTUSDT', value: n })) {
  const capture = unwrap(
    createPrePostReplayCapture(
      { captureId, startedAtMs: T0, preTriggerCapacity: 4, postTriggerEventLimit: 2 },
      T0,
    ),
    'create complete capture',
  );
  unwrap(capture.record(event(0, { payload: payloadFactory(0) }), T0 + 10), 'record 0');
  unwrap(capture.record(event(1, { payload: payloadFactory(1) }), T0 + 20), 'record 1');
  unwrap(capture.trigger(trigger(), T0 + 30), 'trigger');
  unwrap(capture.record(event(2, { payload: payloadFactory(2) }), T0 + 40), 'record 2');
  unwrap(capture.record(event(3, { payload: payloadFactory(3) }), T0 + 50), 'record 3');
  return unwrap(capture.finalize(T0 + 60, T0 + 60), 'finalize complete capture');
}

// =====================================================================
section('1. bounded ring buffer and capture-state laws');
{
  const ring = new BoundedRingBuffer(3);
  const reports = [1, 2, 3, 4, 5].map((value) => ring.push(value));
  const snapshot = ring.snapshot();
  check('overwrite-oldest retains exact newest bound', snapshot.values.join(',') === '3,4,5');
  check('overwrite loss is explicit', snapshot.droppedCount === 2 && snapshot.totalPushed === 5);
  check('first overflow report names eviction', reports[3].evictedOldest === true && reports[2].evictedOldest === false);
  check('snapshot arrays are frozen', Object.isFrozen(snapshot.values));
  check('zero-capacity ring rejected', throws(() => new BoundedRingBuffer(0)));
  check('over-max ring rejected', throws(() => new BoundedRingBuffer(MAX_REPLAY_RING_CAPACITY + 1)));

  const invalidPre = createPrePostReplayCapture(
    { captureId: 'bad', startedAtMs: T0, preTriggerCapacity: 0, postTriggerEventLimit: 1 },
    T0,
  );
  const invalidPost = createPrePostReplayCapture(
    { captureId: 'bad', startedAtMs: T0, preTriggerCapacity: 1, postTriggerEventLimit: MAX_REPLAY_POST_TRIGGER_EVENTS + 1 },
    T0,
  );
  check('invalid pre bound fails by value', failureCode(invalidPre) === REPLAY_FAILURE_CODES.CAPTURE_CONFIG_INVALID);
  check('invalid post bound fails by value', failureCode(invalidPost) === REPLAY_FAILURE_CODES.CAPTURE_CONFIG_INVALID);

  const capture = unwrap(
    createPrePostReplayCapture(
      { captureId: 'capture_state', startedAtMs: T0, preTriggerCapacity: 2, postTriggerEventLimit: 1 },
      T0,
    ),
    'capture state',
  );
  check('capture starts ARMED', capture.snapshot().state === 'ARMED');
  check('finalize before trigger blocked', failureCode(capture.finalize(T0 + 1, T0 + 1)) === REPLAY_FAILURE_CODES.CAPTURE_STATE_INVALID);
  unwrap(capture.record(event(0), T0 + 10), 'state pre event');
  unwrap(capture.trigger(trigger(), T0 + 30), 'state trigger');
  check('trigger enters bounded post phase', capture.snapshot().state === 'CAPTURING_POST_TRIGGER');
  check('double trigger blocked', failureCode(capture.trigger(trigger(), T0 + 31)) === REPLAY_FAILURE_CODES.CAPTURE_STATE_INVALID);
  unwrap(capture.record(event(1, { receivedAtMs: T0 + 40 }), T0 + 40), 'state post event');
  check('post bound moves capture READY', capture.snapshot().state === 'READY');
  check('event after bound rejected', failureCode(capture.record(event(2), T0 + 50)) === REPLAY_FAILURE_CODES.CAPTURE_COMPLETE);
  const finalized = unwrap(capture.finalize(T0 + 50, T0 + 50), 'state finalize');
  check('finalize moves capture FINALIZED', capture.snapshot().state === 'FINALIZED');
  check('same completion finalize is idempotent', capture.finalize(T0 + 50, T0 + 51).ok);
  check('different completion re-finalize blocked', failureCode(capture.finalize(T0 + 51, T0 + 51)) === REPLAY_FAILURE_CODES.CAPTURE_STATE_INVALID);
  check('finalized envelope is frozen', Object.isFrozen(finalized) && Object.isFrozen(finalized.events));
}

// =====================================================================
section('2. pre/post capture, versioned envelope, authority, and immutability');
{
  const sourcePayload = { symbol: 'TESTUSDT', nested: { value: 7 } };
  const capture = unwrap(
    createPrePostReplayCapture(
      { captureId: 'capture_pre_post', startedAtMs: T0, preTriggerCapacity: 3, postTriggerEventLimit: 2 },
      T0,
    ),
    'pre/post capture',
  );
  unwrap(capture.record(event(0, { payload: sourcePayload }), T0 + 10), 'pre 0');
  unwrap(capture.record(event(1), T0 + 20), 'pre 1');
  unwrap(capture.trigger(trigger(), T0 + 30), 'pre/post trigger');
  unwrap(capture.record(event(2), T0 + 40), 'post 2');
  unwrap(capture.record(event(3), T0 + 50), 'post 3');
  sourcePayload.nested.value = 999;
  const envelope = unwrap(capture.finalize(T0 + 60, T0 + 60), 'pre/post finalize');
  const inspection = unwrap(inspectReplayEnvelope(envelope, T0 + 60), 'pre/post inspect');
  check('exact v1 schema', envelope.schemaVersion === REPLAY_SCHEMA_VERSION && envelope.checksum.algorithm === REPLAY_CHECKSUM_ALGORITHM);
  check('envelope authority is explicitly replay-only', envelope.authority === 'RECORDED_REPLAY');
  check('source authority preserved separately', envelope.events.every((entry) => entry.timestamp.authority === 'SYNTHETIC_TEST'));
  check('phase counts exact', envelope.events.filter((entry) => entry.phase === 'PRE_TRIGGER').length === 2 && envelope.events.filter((entry) => entry.phase === 'POST_TRIGGER').length === 2);
  check('capture counts exact', envelope.capture.preTriggerObservedCount === 2 && envelope.capture.postTriggerCapturedCount === 2 && envelope.capture.eventCount === 4);
  check('complete capture integrity VALID', inspection.integrity.state === 'VALID' && inspection.integrity.issues.length === 0);
  check('producer mutation cannot rewrite history', envelope.events.find((entry) => entry.sequence === 0)?.payload.nested.value === 7);
  check('nested captured payload is frozen', Object.isFrozen(envelope.events[0].payload) && Object.isFrozen(envelope.events.find((entry) => entry.sequence === 0)?.payload.nested));
  check('source and receipt times both preserved', envelope.events.every((entry) => Number.isSafeInteger(entry.timestamp.receivedAtMs) && entry.timestamp.sourceTimeMs !== undefined));

  const unavailable = createReplayEvent(
    event(9, {
      timestamp: stamp(9, { sourceTimeMs: null, authority: 'UNAVAILABLE', completeness: 'UNAVAILABLE' }),
      payload: null,
    }),
    'PRE_TRIGGER',
    T0 + 100,
  );
  check('unknown source time remains null', unavailable.ok && unavailable.value.timestamp.sourceTimeMs === null);
  check('UNAVAILABLE authority remains explicit', unavailable.ok && unavailable.value.timestamp.authority === 'UNAVAILABLE' && unavailable.value.payload === null);
}

// =====================================================================
section('3. canonical checksum and storage round-trip');
{
  const envelope = completeEnvelope('capture_round_trip');
  const serialized = serializeReplayEnvelope(envelope);
  const parsed = parseReplayEnvelope(serialized, T0 + 1_000);
  check('serialized envelope parses', parsed.ok, parsed.ok ? '' : parsed.failure.code);
  check('round-trip checksum stable', parsed.ok && parsed.value.envelope.checksum.value === envelope.checksum.value);
  check('round-trip bytes canonical and identical', parsed.ok && serializeReplayEnvelope(parsed.value.envelope) === serialized);

  const left = completeEnvelope('capture_canonical_keys', (n) => ({ b: n, a: { y: 2, x: 1 } }));
  const right = completeEnvelope('capture_canonical_keys', (n) => ({ a: { x: 1, y: 2 }, b: n }));
  check('object insertion order cannot change checksum', left.checksum.value === right.checksum.value);
  check('object insertion order cannot change bytes', serializeReplayEnvelope(left) === serializeReplayEnvelope(right));

  const writes = [];
  const reads = [];
  const memory = new Map();
  const storage = {
    async write(id, bytes) { writes.push(id); memory.set(id, bytes); },
    async read(id) { reads.push(id); return memory.get(id) ?? null; },
  };
  const stored = await storeReplayEnvelope(storage, envelope, { nowMs: T0 + 1_001, correlationId: 'cor_storage' });
  const loaded = await loadReplayEnvelope(storage, envelope.captureId, { nowMs: T0 + 1_002, correlationId: 'cor_storage' });
  check('injected storage write succeeds', stored.ok && stored.value.captureId === envelope.captureId && stored.value.serializedBytes > 0);
  check('injected storage read succeeds', loaded.ok && loaded.value.envelope.checksum.value === envelope.checksum.value);
  check('core uses injected key exactly once', writes.join(',') === envelope.captureId && reads.join(',') === envelope.captureId);

  const missing = await loadReplayEnvelope(storage, 'missing_capture', { nowMs: T0 + 1_003, correlationId: 'cor_storage' });
  check('storage missing is named, not empty success', failureCode(missing) === REPLAY_FAILURE_CODES.STORAGE_NOT_FOUND);
  const writeFailure = await storeReplayEnvelope(
    { write: async () => { throw new Error('private adapter detail'); }, read: async () => null },
    envelope,
    { nowMs: T0 + 1_004, correlationId: 'cor_storage' },
  );
  check('storage write error normalized', failureCode(writeFailure) === REPLAY_FAILURE_CODES.STORAGE_WRITE_FAILED && !writeFailure.failure.message.includes('private adapter detail'));
  const readFailure = await loadReplayEnvelope(
    { write: async () => {}, read: async () => { throw new Error('private adapter detail'); } },
    envelope.captureId,
    { nowMs: T0 + 1_005, correlationId: 'cor_storage' },
  );
  check('storage read error normalized', failureCode(readFailure) === REPLAY_FAILURE_CODES.STORAGE_READ_FAILED && !readFailure.failure.message.includes('private adapter detail'));
}

// =====================================================================
section('4. deterministic event order and virtual-clock replay');
{
  const capture = unwrap(
    createPrePostReplayCapture(
      { captureId: 'capture_order', startedAtMs: T0, preTriggerCapacity: 4, postTriggerEventLimit: 1 },
      T0,
    ),
    'order capture',
  );
  unwrap(capture.record(event(0, { sourceTimeMs: T0 + 300, receivedAtMs: T0 + 10 }), T0 + 10), 'order 0');
  unwrap(capture.record(event(1, { sourceTimeMs: T0 + 100, receivedAtMs: T0 + 20 }), T0 + 20), 'order 1');
  unwrap(capture.record(event(2, { sourceTimeMs: T0 + 200, receivedAtMs: T0 + 25 }), T0 + 25), 'order 2');
  unwrap(capture.trigger(trigger(), T0 + 30), 'order trigger');
  unwrap(capture.record(event(3, { sourceTimeMs: T0 + 400, receivedAtMs: T0 + 40 }), T0 + 40), 'order 3');
  const envelope = unwrap(capture.finalize(T0 + 50, T0 + 50), 'order finalize');
  check('envelope canonicalizes source-time order', envelope.events.map((entry) => entry.sequence).join(',') === '1,2,0,3');
  const orderInspection = unwrap(inspectReplayEnvelope(envelope, T0 + 50), 'order inspection');
  check('same-stream sequence regression is non-VALID', orderInspection.integrity.state === 'GAPPED' && orderInspection.integrity.issues.some((entry) => entry.code === 'SEQUENCE_REGRESSION'));
  check('sequence regression blocks default replay', failureCode(replayEnvelope(envelope, new DeterministicVirtualClock(T0 + 10_000), () => {})) === REPLAY_FAILURE_CODES.SEQUENCE_GAP);

  const run = () => {
    const clock = new DeterministicVirtualClock(T0 + 10_000);
    const dispatches = [];
    const result = replayEnvelope(envelope, clock, (dispatch) => { dispatches.push(dispatch); }, { allowGaps: true });
    return { result, dispatches, clock };
  };
  const first = run();
  const second = run();
  check('virtual replay succeeds', first.result.ok && first.result.value.dispatchedCount === 4);
  check('virtual time preserves exact relative offsets', first.dispatches.map((entry) => entry.replayedAtMs - (T0 + 10_000)).join(',') === '0,100,200,300');
  check('two replays emit byte-equivalent trace', JSON.stringify(first.dispatches) === JSON.stringify(second.dispatches));
  check('dispatch authority is RECORDED_REPLAY', first.dispatches.every((entry) => entry.authority === 'RECORDED_REPLAY'));
  check('original authority remains visible', first.dispatches.every((entry) => entry.event.timestamp.authority === 'SYNTHETIC_TEST'));
  check('virtual clock ends at last deterministic offset', first.clock.nowMs() === T0 + 10_300);
  check('summary source range exact', first.result.ok && first.result.value.firstSourceTimeMs === T0 + 100 && first.result.value.lastSourceTimeMs === T0 + 400);

  const throwing = replayEnvelope(envelope, new DeterministicVirtualClock(T0 + 20_000), () => { throw new Error('super-sensitive-adapter-detail'); }, { allowGaps: true });
  check('throwing handler stops with named failure', failureCode(throwing) === REPLAY_FAILURE_CODES.HANDLER_FAILED && !throwing.failure.message.includes('super-sensitive-adapter-detail'));
  const returning = replayEnvelope(envelope, new DeterministicVirtualClock(T0 + 20_000), () => 1, { allowGaps: true });
  check('non-void handler rejected', failureCode(returning) === REPLAY_FAILURE_CODES.HANDLER_FAILED);
  const badClock = { value: T0 + 20_000, nowMs() { return this.value; }, advanceTo() {} };
  const badClockResult = replayEnvelope(envelope, badClock, () => {}, { allowGaps: true });
  check('non-advancing clock rejected', failureCode(badClockResult) === REPLAY_FAILURE_CODES.CLOCK_INVALID);
  const virtual = new DeterministicVirtualClock(T0);
  check('virtual clock cannot move backwards', throws(() => virtual.advanceTo(T0 - 1)));

  const empty = unwrap(
    createPrePostReplayCapture(
      { captureId: 'capture_empty', startedAtMs: T0, preTriggerCapacity: 1, postTriggerEventLimit: 0 },
      T0,
    ),
    'empty capture',
  );
  unwrap(empty.trigger(trigger({ receivedAtMs: T0 + 1, sourceTimeMs: null }), T0 + 1), 'empty trigger');
  const emptyEnvelope = unwrap(empty.finalize(T0 + 2, T0 + 2), 'empty finalize');
  const emptyClock = new DeterministicVirtualClock(T0 + 30_000);
  const emptyReplay = replayEnvelope(emptyEnvelope, emptyClock, () => {});
  check('zero-event replay is explicit success', emptyReplay.ok && emptyReplay.value.dispatchedCount === 0 && emptyReplay.value.firstSourceTimeMs === null);
  check('zero-event replay does not advance clock', emptyClock.nowMs() === T0 + 30_000);
}

// =====================================================================
section('5. gaps and truncation are explicit policy decisions');
{
  const gapCapture = unwrap(
    createPrePostReplayCapture(
      { captureId: 'capture_gap', startedAtMs: T0, preTriggerCapacity: 4, postTriggerEventLimit: 0 },
      T0,
    ),
    'gap capture',
  );
  unwrap(gapCapture.record(event(0), T0 + 10), 'gap 0');
  unwrap(gapCapture.record(event(2, { receivedAtMs: T0 + 20 }), T0 + 20), 'gap 2');
  unwrap(gapCapture.trigger(trigger(), T0 + 30), 'gap trigger');
  const gapEnvelope = unwrap(gapCapture.finalize(T0 + 40, T0 + 40), 'gap finalize');
  const gapInspection = unwrap(inspectReplayEnvelope(gapEnvelope, T0 + 40), 'gap inspect');
  check('sequence gap classified', gapInspection.integrity.state === 'GAPPED');
  check('gap evidence exact', gapInspection.integrity.issues[0].code === 'SEQUENCE_GAP' && gapInspection.integrity.issues[0].missingCount === 1);
  check('gap blocks replay by default', failureCode(replayEnvelope(gapEnvelope, new DeterministicVirtualClock(T0 + 1_000), () => {})) === REPLAY_FAILURE_CODES.SEQUENCE_GAP);
  const gapAllowed = replayEnvelope(gapEnvelope, new DeterministicVirtualClock(T0 + 1_000), () => {}, { allowGaps: true });
  check('gap requires explicit opt-in', gapAllowed.ok && gapAllowed.value.integrityState === 'GAPPED');

  const truncatedCapture = unwrap(
    createPrePostReplayCapture(
      { captureId: 'capture_truncated', startedAtMs: T0, preTriggerCapacity: 2, postTriggerEventLimit: 0 },
      T0,
    ),
    'truncated capture',
  );
  unwrap(truncatedCapture.record(event(0), T0 + 10), 'truncate 0');
  unwrap(truncatedCapture.record(event(1), T0 + 20), 'truncate 1');
  unwrap(truncatedCapture.record(event(2, { receivedAtMs: T0 + 25 }), T0 + 25), 'truncate 2');
  unwrap(truncatedCapture.trigger(trigger(), T0 + 30), 'truncate trigger');
  const truncatedEnvelope = unwrap(truncatedCapture.finalize(T0 + 40, T0 + 40), 'truncate finalize');
  const truncatedInspection = unwrap(inspectReplayEnvelope(truncatedEnvelope, T0 + 40), 'truncate inspect');
  check('pre-ring overwrite classified TRUNCATED', truncatedInspection.integrity.state === 'TRUNCATED');
  check('overwrite count retained in envelope', truncatedEnvelope.capture.preTriggerDroppedCount === 1 && truncatedEnvelope.events.map((entry) => entry.sequence).join(',') === '1,2');
  check('truncation blocks replay by default', failureCode(replayEnvelope(truncatedEnvelope, new DeterministicVirtualClock(T0 + 2_000), () => {})) === REPLAY_FAILURE_CODES.TRUNCATED);
  check('truncation requires explicit opt-in', replayEnvelope(truncatedEnvelope, new DeterministicVirtualClock(T0 + 2_000), () => {}, { allowTruncated: true }).ok);

  const early = unwrap(
    createPrePostReplayCapture(
      { captureId: 'capture_early', startedAtMs: T0, preTriggerCapacity: 2, postTriggerEventLimit: 3 },
      T0,
    ),
    'early capture',
  );
  unwrap(early.record(event(0), T0 + 10), 'early pre');
  unwrap(early.trigger(trigger(), T0 + 30), 'early trigger');
  unwrap(early.record(event(1, { receivedAtMs: T0 + 40 }), T0 + 40), 'early post');
  const earlyEnvelope = unwrap(early.finalize(T0 + 50, T0 + 50), 'early finalize');
  const earlyInspection = unwrap(inspectReplayEnvelope(earlyEnvelope, T0 + 50), 'early inspect');
  check('early finalize marks post incomplete', earlyInspection.integrity.state === 'TRUNCATED' && earlyInspection.integrity.issues.some((entry) => entry.code === 'POST_TRIGGER_INCOMPLETE' && entry.missingCount === 2));
}

// =====================================================================
section('6. corruption, truncation, schema evolution, and unknown fields');
{
  const envelope = completeEnvelope('capture_corruption');
  const serialized = serializeReplayEnvelope(envelope);

  const mutated = clone(envelope);
  mutated.events[0].payload.value = 999;
  check('checksum mutation rejected', failureCode(inspectReplayEnvelope(mutated, T0 + 2_000)) === REPLAY_FAILURE_CODES.CHECKSUM_MISMATCH);

  const missingEvent = clone(envelope);
  missingEvent.events.pop();
  check('declared-count truncation named before checksum', failureCode(inspectReplayEnvelope(missingEvent, T0 + 2_000)) === REPLAY_FAILURE_CODES.TRUNCATED);
  check('truncated JSON named', failureCode(parseReplayEnvelope(serialized.slice(0, -12), T0 + 2_000)) === REPLAY_FAILURE_CODES.JSON_TRUNCATED);
  check('malformed JSON named', failureCode(parseReplayEnvelope('{"events":]}', T0 + 2_000)) === REPLAY_FAILURE_CODES.JSON_MALFORMED);

  const future = clone(envelope);
  future.schemaVersion = 2;
  check('future schema version fail-closed', failureCode(inspectReplayEnvelope(future, T0 + 2_000)) === REPLAY_FAILURE_CODES.SCHEMA_UNSUPPORTED);
  const topUnknown = clone(envelope);
  topUnknown.futureField = true;
  check('unknown envelope field rejected', failureCode(inspectReplayEnvelope(topUnknown, T0 + 2_000)) === REPLAY_FAILURE_CODES.SCHEMA_INVALID);
  const eventUnknown = clone(envelope);
  eventUnknown.events[0].futureField = true;
  check('unknown event field rejected', failureCode(inspectReplayEnvelope(eventUnknown, T0 + 2_000)) === REPLAY_FAILURE_CODES.SCHEMA_INVALID);
  const timestampUnknown = clone(envelope);
  timestampUnknown.events[0].timestamp.refreshedAtMs = T0;
  check('unknown timestamp field rejected', failureCode(inspectReplayEnvelope(timestampUnknown, T0 + 2_000)) === REPLAY_FAILURE_CODES.SCHEMA_INVALID);
  const checksumUnknown = clone(envelope);
  checksumUnknown.checksum.future = true;
  check('unknown checksum field rejected', failureCode(inspectReplayEnvelope(checksumUnknown, T0 + 2_000)) === REPLAY_FAILURE_CODES.SCHEMA_INVALID);
  const wrongAlgorithm = clone(envelope);
  wrongAlgorithm.checksum.algorithm = 'SHA1';
  check('unknown checksum algorithm rejected', failureCode(inspectReplayEnvelope(wrongAlgorithm, T0 + 2_000)) === REPLAY_FAILURE_CODES.SCHEMA_INVALID);
  const reordered = clone(envelope);
  reordered.events.reverse();
  check('non-canonical restored order rejected', failureCode(inspectReplayEnvelope(reordered, T0 + 2_000)) === REPLAY_FAILURE_CODES.SCHEMA_INVALID);

  let accessorReads = 0;
  const accessorEnvelope = clone(envelope);
  Object.defineProperty(accessorEnvelope, 'futureAccessor', {
    enumerable: true,
    get() { accessorReads += 1; return true; },
  });
  check('schema accessor rejected without invocation', failureCode(inspectReplayEnvelope(accessorEnvelope, T0 + 2_000)) === REPLAY_FAILURE_CODES.SCHEMA_INVALID && accessorReads === 0);

  let requiredAccessorReads = 0;
  const requiredAccessorEnvelope = clone(envelope);
  Object.defineProperty(requiredAccessorEnvelope, 'schema', {
    enumerable: true,
    get() { requiredAccessorReads += 1; return 'cosmos.foundation.replay'; },
  });
  check('required schema accessor rejected without invocation', failureCode(inspectReplayEnvelope(requiredAccessorEnvelope, T0 + 2_000)) === REPLAY_FAILURE_CODES.SCHEMA_INVALID && requiredAccessorReads === 0);
}

// =====================================================================
section('7. secrets, private authority, and non-plain payload rejection');
{
  const secret = createReplayEvent(event(0, { payload: { apiKey: 'forbidden-fixture' } }), 'PRE_TRIGGER', T0 + 10);
  const nestedSecret = createReplayEvent(event(0, { payload: { nested: { credential: 'forbidden-fixture' } } }), 'PRE_TRIGGER', T0 + 10);
  const privateKey = createReplayEvent(event(0, { payload: { authorization: 'forbidden-fixture' } }), 'PRE_TRIGGER', T0 + 10);
  check('apiKey field strictly rejected', failureCode(secret) === REPLAY_FAILURE_CODES.PRIVATE_PAYLOAD_REJECTED);
  check('nested credential strictly rejected', failureCode(nestedSecret) === REPLAY_FAILURE_CODES.PRIVATE_PAYLOAD_REJECTED);
  check('authorization field strictly rejected', failureCode(privateKey) === REPLAY_FAILURE_CODES.PRIVATE_PAYLOAD_REJECTED);

  const privateEvent = createReplayEvent(
    event(0, { timestamp: stamp(0, { authority: 'LIVE_PRIVATE' }) }),
    'PRE_TRIGGER',
    T0 + 10,
  );
  const privateTrigger = createReplayTrigger(trigger({ authority: 'LIVE_PRIVATE' }), T0 + 30);
  check('LIVE_PRIVATE event rejected even with harmless payload', failureCode(privateEvent) === REPLAY_FAILURE_CODES.PRIVATE_PAYLOAD_REJECTED);
  check('LIVE_PRIVATE trigger rejected', failureCode(privateTrigger) === REPLAY_FAILURE_CODES.PRIVATE_PAYLOAD_REJECTED);

  const cycle = {};
  cycle.self = cycle;
  check('cyclic payload rejected', failureCode(createReplayEvent(event(0, { payload: cycle }), 'PRE_TRIGGER', T0 + 10)) === REPLAY_FAILURE_CODES.PAYLOAD_REJECTED);
  const sparse = new Array(3);
  sparse[0] = 'present';
  check('sparse payload array rejected', failureCode(createReplayEvent(event(0, { payload: sparse }), 'PRE_TRIGGER', T0 + 10)) === REPLAY_FAILURE_CODES.PAYLOAD_REJECTED);
  check('undefined payload value rejected', failureCode(createReplayEvent(event(0, { payload: { value: undefined } }), 'PRE_TRIGGER', T0 + 10)) === REPLAY_FAILURE_CODES.PAYLOAD_REJECTED);
  check('non-finite number rejected', failureCode(createReplayEvent(event(0, { payload: { value: Number.POSITIVE_INFINITY } }), 'PRE_TRIGGER', T0 + 10)) === REPLAY_FAILURE_CODES.PAYLOAD_REJECTED);
  check('negative zero canonical ambiguity rejected', failureCode(createReplayEvent(event(0, { payload: { value: -0 } }), 'PRE_TRIGGER', T0 + 10)) === REPLAY_FAILURE_CODES.PAYLOAD_REJECTED);
  check('class instance rejected', failureCode(createReplayEvent(event(0, { payload: new Date(0) }), 'PRE_TRIGGER', T0 + 10)) === REPLAY_FAILURE_CODES.PAYLOAD_REJECTED);

  let getterReads = 0;
  const accessorPayload = {};
  Object.defineProperty(accessorPayload, 'value', {
    enumerable: true,
    get() { getterReads += 1; return 1; },
  });
  const accessor = createReplayEvent(event(0, { payload: accessorPayload }), 'PRE_TRIGGER', T0 + 10);
  check('payload accessor rejected without invocation', failureCode(accessor) === REPLAY_FAILURE_CODES.PAYLOAD_REJECTED && getterReads === 0);

  const ordinaryDomainFields = createReplayEvent(event(0, { payload: { futureDomainMetric: 1 } }), 'PRE_TRIGGER', T0 + 10);
  check('domain payload remains extensible inside guarded envelope', ordinaryDomainFields.ok);
}

// =====================================================================
section('8. adversarial depth, breadth, byte, and event-count bounds');
{
  let deep = { value: 1 };
  for (let i = 0; i < MAX_REPLAY_PAYLOAD_DEPTH + 2; i += 1) deep = { next: deep };
  check('payload depth bound enforced', failureCode(createReplayEvent(event(0, { payload: deep }), 'PRE_TRIGGER', T0 + 10)) === REPLAY_FAILURE_CODES.PAYLOAD_REJECTED);

  const wideArray = new Array(MAX_REPLAY_ARRAY_LENGTH + 1).fill(0);
  check('payload array bound enforced', failureCode(createReplayEvent(event(0, { payload: wideArray }), 'PRE_TRIGGER', T0 + 10)) === REPLAY_FAILURE_CODES.PAYLOAD_REJECTED);
  const wideObject = {};
  for (let i = 0; i < MAX_REPLAY_OBJECT_KEYS + 1; i += 1) wideObject[`field${i}`] = i;
  check('payload object-key bound enforced', failureCode(createReplayEvent(event(0, { payload: wideObject }), 'PRE_TRIGGER', T0 + 10)) === REPLAY_FAILURE_CODES.PAYLOAD_REJECTED);
  const longString = 'x'.repeat(MAX_REPLAY_STRING_LENGTH + 1);
  check('payload string bound enforced', failureCode(createReplayEvent(event(0, { payload: longString }), 'PRE_TRIGGER', T0 + 10)) === REPLAY_FAILURE_CODES.PAYLOAD_REJECTED);
  const byteHeavy = '😀'.repeat(MAX_REPLAY_STRING_LENGTH / 2);
  check('canonical UTF-8 byte bound enforced', failureCode(createReplayEvent(event(0, { payload: byteHeavy }), 'PRE_TRIGGER', T0 + 10)) === REPLAY_FAILURE_CODES.PAYLOAD_REJECTED);

  const nodeHeavy = {
    left: new Array(MAX_REPLAY_PAYLOAD_NODES / 2).fill(0),
    right: new Array(MAX_REPLAY_PAYLOAD_NODES / 2).fill(0),
  };
  check('aggregate payload node bound enforced', failureCode(createReplayEvent(event(0, { payload: nodeHeavy }), 'PRE_TRIGGER', T0 + 10)) === REPLAY_FAILURE_CODES.PAYLOAD_REJECTED);

  const envelope = completeEnvelope('capture_bounds');
  const tooMany = clone(envelope);
  tooMany.events = new Array(MAX_REPLAY_ENVELOPE_EVENTS + 1).fill(tooMany.events[0]);
  tooMany.capture.eventCount = tooMany.events.length;
  check('restored event-count bound enforced', failureCode(inspectReplayEnvelope(tooMany, T0 + 2_000)) === REPLAY_FAILURE_CODES.SCHEMA_INVALID);

  const sparseEnvelope = clone(envelope);
  sparseEnvelope.events.length += 1;
  sparseEnvelope.capture.eventCount += 1;
  check('sparse restored event array rejected', failureCode(inspectReplayEnvelope(sparseEnvelope, T0 + 2_000)) === REPLAY_FAILURE_CODES.SCHEMA_INVALID);

  const oversizedSerialized = ' '.repeat(MAX_REPLAY_ENVELOPE_BYTES + 1);
  check('serialized byte ceiling checked before parse', failureCode(parseReplayEnvelope(oversizedSerialized, T0 + 2_000)) === REPLAY_FAILURE_CODES.ENVELOPE_TOO_LARGE);
}

// =====================================================================
section('9. independent-review privacy and schema bypass regressions');
{
  check('unvalidated inspection replay fast path is not public', replayModule.replayInspectedEnvelope === undefined);

  const hidden = { visible: true };
  Object.defineProperty(hidden, 'apiKey', { enumerable: false, value: 'forbidden-fixture' });
  const hiddenResult = createReplayEvent(event(0, { payload: hidden }), 'PRE_TRIGGER', T0 + 10);
  check('non-enumerable secret field rejected, never stripped', failureCode(hiddenResult) === REPLAY_FAILURE_CODES.PRIVATE_PAYLOAD_REJECTED);

  const symbolPayload = { visible: true };
  symbolPayload[Symbol('apiKey')] = 'forbidden-fixture';
  const symbolResult = createReplayEvent(event(0, { payload: symbolPayload }), 'PRE_TRIGGER', T0 + 10);
  check('symbol secret field rejected, never stripped', failureCode(symbolResult) === REPLAY_FAILURE_CODES.PRIVATE_PAYLOAD_REJECTED);

  const protoPayload = JSON.parse('{"visible":true,"__proto__":{"role":"admin"}}');
  const protoResult = createReplayEvent(event(0, { payload: protoPayload }), 'PRE_TRIGGER', T0 + 10);
  check('own __proto__ payload rejected before cloning', failureCode(protoResult) === REPLAY_FAILURE_CODES.PAYLOAD_REJECTED);

  for (const key of ['api.key', 'api%5Fkey', 'YXBpS2V5', 'session_id', 'bearer']) {
    const result = createReplayEvent(event(0, { payload: { [key]: 'forbidden-fixture' } }), 'PRE_TRIGGER', T0 + 10);
    check(`normalized secret key rejected: ${key}`, failureCode(result) === REPLAY_FAILURE_CODES.PRIVATE_PAYLOAD_REJECTED);
  }
  const bearerValue = createReplayEvent(
    event(0, { payload: { value: 'Bearer eyJheader.secret.signature' } }),
    'PRE_TRIGGER',
    T0 + 10,
  );
  check('credential-shaped value rejected', failureCode(bearerValue) === REPLAY_FAILURE_CODES.PRIVATE_PAYLOAD_REJECTED);

  const arraySecret = [1];
  arraySecret.apiKey = 'forbidden-fixture';
  check('named secret property on payload array rejected', failureCode(createReplayEvent(event(0, { payload: arraySecret }), 'PRE_TRIGGER', T0 + 10)) === REPLAY_FAILURE_CODES.PRIVATE_PAYLOAD_REJECTED);
  const arraySymbol = [1];
  arraySymbol[Symbol('private')] = true;
  check('symbol property on payload array rejected', failureCode(createReplayEvent(event(0, { payload: arraySymbol }), 'PRE_TRIGGER', T0 + 10)) === REPLAY_FAILURE_CODES.PAYLOAD_REJECTED);

  const envelope = completeEnvelope('capture_schema_symbols');
  const envelopeSymbol = clone(envelope);
  envelopeSymbol[Symbol('unknown')] = true;
  check('symbol envelope field rejected', failureCode(inspectReplayEnvelope(envelopeSymbol, T0 + 2_000)) === REPLAY_FAILURE_CODES.SCHEMA_INVALID);
  const eventSymbol = clone(envelope);
  eventSymbol.events[0][Symbol('unknown')] = true;
  check('symbol event field rejected', failureCode(inspectReplayEnvelope(eventSymbol, T0 + 2_000)) === REPLAY_FAILURE_CODES.SCHEMA_INVALID);
  const arrayField = clone(envelope);
  arrayField.events.apiKey = 'forbidden-fixture';
  check('named property on envelope event array rejected', failureCode(inspectReplayEnvelope(arrayField, T0 + 2_000)) === REPLAY_FAILURE_CODES.SCHEMA_INVALID);

  let eventAccessorReads = 0;
  const accessorEvent = event(0);
  Object.defineProperty(accessorEvent, 'correlationId', {
    enumerable: true,
    get() { eventAccessorReads += 1; return 'cor_forbidden'; },
  });
  const accessorEventResult = createReplayEvent(accessorEvent, 'PRE_TRIGGER', T0 + 10);
  check('outer event accessor rejected without invocation', failureCode(accessorEventResult) === REPLAY_FAILURE_CODES.EVENT_INVALID && eventAccessorReads === 0);

  let triggerAccessorReads = 0;
  const accessorTrigger = trigger();
  Object.defineProperty(accessorTrigger, 'correlationId', {
    enumerable: true,
    get() { triggerAccessorReads += 1; return 'cor_forbidden'; },
  });
  const accessorTriggerResult = createReplayTrigger(accessorTrigger, T0 + 30);
  check('outer trigger accessor rejected without invocation', failureCode(accessorTriggerResult) === REPLAY_FAILURE_CODES.TRIGGER_INVALID && triggerAccessorReads === 0);

  const readyCapture = unwrap(
    createPrePostReplayCapture(
      { captureId: 'capture_accessor_state', startedAtMs: T0, preTriggerCapacity: 1, postTriggerEventLimit: 0 },
      T0,
    ),
    'ready accessor capture',
  );
  unwrap(readyCapture.trigger(trigger(), T0 + 30), 'ready accessor trigger');
  let completeAccessorReads = 0;
  const completeAccessorEvent = event(1);
  Object.defineProperty(completeAccessorEvent, 'correlationId', {
    enumerable: true,
    get() { completeAccessorReads += 1; return 'cor_forbidden'; },
  });
  const completeAccessorResult = readyCapture.record(completeAccessorEvent, T0 + 31);
  check('complete-state failure does not invoke event accessor', failureCode(completeAccessorResult) === REPLAY_FAILURE_CODES.CAPTURE_COMPLETE && completeAccessorReads === 0);
}

// =====================================================================
section('10. review regressions for bounds, chronology, storage, and virtual time');
{
  const largeCapture = unwrap(
    createPrePostReplayCapture(
      { captureId: 'capture_aggregate_bytes', startedAtMs: T0, preTriggerCapacity: 100, postTriggerEventLimit: 0 },
      T0,
    ),
    'aggregate byte capture',
  );
  const largePayload = { value: 'x'.repeat(250_000) };
  let aggregateFailure = null;
  for (let sequence = 0; sequence < 70; sequence += 1) {
    const nowMs = T0 + 10 + sequence * 10;
    const result = largeCapture.record(event(sequence, { payload: largePayload }), nowMs);
    if (!result.ok) { aggregateFailure = result; break; }
  }
  check('aggregate retained-byte bound rejects during record', failureCode(aggregateFailure) === REPLAY_FAILURE_CODES.ENVELOPE_TOO_LARGE);
  check('aggregate rejection occurs before multi-megabyte over-retention', largeCapture.snapshot().preTriggerObservedCount < 70);

  const envelope = completeEnvelope('capture_review_metadata');
  const impossible = clone(envelope);
  impossible.capture.preTriggerObservedCount = 1;
  impossible.capture.preTriggerRetainedCount = 0;
  impossible.capture.preTriggerDroppedCount = 1;
  check('impossible ring metadata rejected', failureCode(inspectReplayEnvelope(impossible, T0 + 2_000)) === REPLAY_FAILURE_CODES.SCHEMA_INVALID);

  const manyUnknown = clone(envelope);
  for (let i = 0; i < 100_000; i += 1) manyUnknown[`future${i}`] = i;
  const manyUnknownResult = inspectReplayEnvelope(manyUnknown, T0 + 2_000);
  check('huge unknown-field set rejected with bounded diagnostic', !manyUnknownResult.ok && manyUnknownResult.failure.code === REPLAY_FAILURE_CODES.SCHEMA_INVALID && manyUnknownResult.failure.message.length < 1_000);

  const serialized = serializeReplayEnvelope(envelope);
  const mismatchStorage = {
    async write() {},
    async read() { return serialized; },
  };
  const mismatch = await loadReplayEnvelope(mismatchStorage, 'different_capture', { nowMs: T0 + 2_000, correlationId: 'cor_storage' });
  check('storage read binds requested ID to envelope ID', failureCode(mismatch) === REPLAY_FAILURE_CODES.STORAGE_KEY_MISMATCH);

  const unsafeId = createPrePostReplayCapture(
    { captureId: '../private\nreplay', startedAtMs: T0, preTriggerCapacity: 1, postTriggerEventLimit: 0 },
    T0,
  );
  check('capture ID rejects path/control syntax', failureCode(unsafeId) === REPLAY_FAILURE_CODES.CAPTURE_CONFIG_INVALID);

  const futureStart = createPrePostReplayCapture(
    { captureId: 'capture_future_start', startedAtMs: T0 + 1, preTriggerCapacity: 1, postTriggerEventLimit: 0 },
    T0,
  );
  check('capture start cannot be ahead of injected now', failureCode(futureStart) === REPLAY_FAILURE_CODES.CAPTURE_CONFIG_INVALID);

  const chronology = unwrap(
    createPrePostReplayCapture(
      { captureId: 'capture_chronology', startedAtMs: T0, preTriggerCapacity: 2, postTriggerEventLimit: 0 },
      T0,
    ),
    'chronology capture',
  );
  check('record receipt cannot be ahead of injected now', failureCode(chronology.record(event(0), T0 + 9)) === REPLAY_FAILURE_CODES.EVENT_INVALID);
  check('trigger receipt cannot be ahead of injected now', failureCode(chronology.trigger(trigger(), T0 + 29)) === REPLAY_FAILURE_CODES.TRIGGER_INVALID);
  unwrap(chronology.record(event(0), T0 + 10), 'chronology accepted record');
  const backwards = chronology.record(event(1, { receivedAtMs: T0 + 9, sourceTimeMs: T0 + 9 }), T0 + 9);
  check('capture operation clock cannot move backwards', failureCode(backwards) === REPLAY_FAILURE_CODES.CAPTURE_STATE_INVALID);
  unwrap(chronology.trigger(trigger(), T0 + 30), 'chronology accepted trigger');
  check('finalize completion cannot be ahead of injected now', failureCode(chronology.finalize(T0 + 40, T0 + 39)) === REPLAY_FAILURE_CODES.CAPTURE_STATE_INVALID);

  const maxUtc = 4_102_444_800_000;
  const rangeCapture = unwrap(
    createPrePostReplayCapture(
      { captureId: 'capture_clock_preflight', startedAtMs: T0, preTriggerCapacity: 2, postTriggerEventLimit: 0 },
      T0,
    ),
    'range capture',
  );
  unwrap(rangeCapture.record(event(0, { sourceTimeMs: 0, receivedAtMs: T0 + 10 }), T0 + 10), 'range zero');
  unwrap(rangeCapture.record(event(1, { sourceTimeMs: maxUtc, receivedAtMs: T0 + 20 }), T0 + 20), 'range max');
  unwrap(rangeCapture.trigger(trigger(), T0 + 30), 'range trigger');
  const rangeEnvelope = unwrap(rangeCapture.finalize(T0 + 40, T0 + 40), 'range finalize');
  let preflightDispatches = 0;
  const rangeClock = new DeterministicVirtualClock(maxUtc - 1);
  const rangeReplay = replayEnvelope(rangeEnvelope, rangeClock, () => { preflightDispatches += 1; });
  check('all virtual targets preflight before first handler', failureCode(rangeReplay) === REPLAY_FAILURE_CODES.CLOCK_INVALID && preflightDispatches === 0 && rangeClock.nowMs() === maxUtc - 1);

  const clockMutationEnvelope = completeEnvelope('capture_clock_mutation');
  const mutableClock = new DeterministicVirtualClock(T0 + 10_000);
  let mutationDispatches = 0;
  const clockMutation = replayEnvelope(clockMutationEnvelope, mutableClock, (dispatch) => {
    mutationDispatches += 1;
    mutableClock.advanceTo(dispatch.replayedAtMs + 500);
  });
  check('handler mutation of shared virtual clock fails replay', failureCode(clockMutation) === REPLAY_FAILURE_CODES.CLOCK_INVALID && mutationDispatches === 1);

  const unknownCapture = unwrap(
    createPrePostReplayCapture(
      { captureId: 'capture_unknown_source_summary', startedAtMs: T0, preTriggerCapacity: 1, postTriggerEventLimit: 0 },
      T0,
    ),
    'unknown summary capture',
  );
  unwrap(unknownCapture.record(event(0, { sourceTimeMs: null }), T0 + 10), 'unknown summary event');
  unwrap(unknownCapture.trigger(trigger(), T0 + 30), 'unknown summary trigger');
  const unknownEnvelope = unwrap(unknownCapture.finalize(T0 + 40, T0 + 40), 'unknown summary finalize');
  const unknownReplay = replayEnvelope(unknownEnvelope, new DeterministicVirtualClock(T0 + 5_000), () => {});
  check('summary never fabricates source time from receipt fallback', unknownReplay.ok && unknownReplay.value.firstSourceTimeMs === null && unknownReplay.value.lastSourceTimeMs === null);
}

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} replay checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
if (failed.length > 0) {
  for (const failure of failed) console.log(`  ✗ ${failure.name}`);
  process.exit(1);
}

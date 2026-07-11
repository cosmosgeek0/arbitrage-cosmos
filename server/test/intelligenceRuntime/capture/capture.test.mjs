import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonicalJson,
  stableId,
} from '../../../dist/intelligenceFoundation/contracts/index.js';
import {
  LiveOutcomeCaptureCoordinator,
} from '../../../dist/intelligenceRuntime/capture/index.js';

const TRIGGER = 1_800_000_000_000;
const CONFIGURATION_VERSION = 'capture-fixture-config-1';
const FEATURE_VERSION = 'capture-fixture-features-1';
const SPOT_SOURCE = 'binance-spot-aggregate-trade';

const instrument = {
  instrumentId: stableId('instrument', {
    venue: 'BINANCE',
    productFamily: 'SPOT',
    symbol: 'TESTUSDT',
    pair: 'TESTUSDT',
    baseAsset: 'TEST',
    quoteAsset: 'USDT',
    contractType: null,
    sourceMarketType: null,
  }),
  venue: 'BINANCE',
  productFamily: 'SPOT',
  symbol: 'TESTUSDT',
  pair: 'TESTUSDT',
  baseAsset: 'TEST',
  quoteAsset: 'USDT',
  contractType: null,
  sourceMarketType: null,
};

const usdMInstrument = {
  instrumentId: stableId('instrument', {
    venue: 'BINANCE',
    productFamily: 'USD_M_PERPETUAL',
    symbol: 'TESTUSDT',
    pair: 'TESTUSDT',
    baseAsset: 'TEST',
    quoteAsset: 'USDT',
    contractType: 'PERPETUAL',
    sourceMarketType: 1,
  }),
  venue: 'BINANCE',
  productFamily: 'USD_M_PERPETUAL',
  symbol: 'TESTUSDT',
  pair: 'TESTUSDT',
  baseAsset: 'TEST',
  quoteAsset: 'USDT',
  contractType: 'PERPETUAL',
  sourceMarketType: 1,
};

class ManualClock {
  constructor(now = TRIGGER) { this.now = now; }
  nowMs() { return this.now; }
  set(now) { this.now = now; }
}

class MemoryCaptureStorage {
  constructor() {
    this.value = null;
    this.saveError = false;
    this.loadError = false;
    this.saves = 0;
    this.loads = 0;
  }

  async save(_checkpointId, value) {
    this.saves += 1;
    if (this.saveError) throw new Error('fixture save failed');
    this.value = structuredClone(value);
  }

  async load(_checkpointId) {
    this.loads += 1;
    if (this.loadError) throw new Error('fixture load failed');
    return this.value === null ? null : structuredClone(this.value);
  }
}

class DeferredLoadStorage extends MemoryCaptureStorage {
  constructor(value) {
    super();
    this.value = structuredClone(value);
    this.releaseLoad = null;
  }

  async load() {
    this.loads += 1;
    await new Promise((resolve) => { this.releaseLoad = resolve; });
    return structuredClone(this.value);
  }
}

class DeferredFirstSaveStorage extends MemoryCaptureStorage {
  constructor() {
    super();
    this.releaseFirstSave = null;
  }

  async save(_checkpointId, value) {
    this.saves += 1;
    if (this.saves === 1) await new Promise((resolve) => { this.releaseFirstSave = resolve; });
    this.value = structuredClone(value);
  }
}

function truth(eventTimeMs, overrides = {}) {
  const receivedTimeMs = overrides.receivedTimeMs ?? eventTimeMs + 1;
  const evaluatedAtMs = overrides.evaluatedAtMs ?? receivedTimeMs;
  const maxAgeMs = overrides.maxAgeMs ?? 60_000;
  return {
    schemaVersion: '1',
    producerVersion: overrides.producerVersion ?? 'capture-fixture-source-1',
    configurationVersion: overrides.configurationVersion ?? CONFIGURATION_VERSION,
    featureVersion: overrides.featureVersion ?? FEATURE_VERSION,
    authority: {
      kind: 'EXCHANGE_PRIMARY',
      sourceId: overrides.sourceId ?? SPOT_SOURCE,
      dataset: overrides.dataset ?? 'aggregate-trade',
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: [overrides.recordId ?? `raw:${eventTimeMs}`],
      sourceSet: [overrides.sourceId ?? SPOT_SOURCE],
      transforms: ['capture-fixture-normalize-v1'],
    },
    temporal: {
      sourceEventTimeMs: eventTimeMs,
      sourceTransactionTimeMs: eventTimeMs,
      receivedTimeMs,
      sequence: null,
    },
    freshness: {
      basis: 'SOURCE_EVENT_TIME',
      evaluatedAtMs,
      ageMs: evaluatedAtMs - eventTimeMs,
      maxAgeMs,
      state: evaluatedAtMs - eventTimeMs <= maxAgeMs ? 'FRESH' : 'STALE',
    },
    completeness: {
      state: 'COMPLETE',
      observedFields: ['trade'],
      missingFields: [],
      reasonCodes: [],
    },
  };
}

function trade(id, eventTimeMs, price, overrides = {}) {
  return tradeForInstrument(id, eventTimeMs, price, instrument, overrides);
}

function tradeForInstrument(id, eventTimeMs, price, evidenceInstrument, overrides = {}) {
  return {
    id,
    kind: 'TRADE',
    instrument: evidenceInstrument,
    truth: truth(eventTimeMs, { ...overrides, recordId: id }),
    aggregateTradeId: String(eventTimeMs),
    firstTradeId: String(eventTimeMs),
    lastTradeId: String(eventTimeMs),
    price,
    baseQuantity: 1,
    quoteQuantity: price,
    normalBaseQuantityExcludingRpi: 1,
    aggressorSide: 'BUY',
  };
}

function freezeInput(triggerTimeMs = TRIGGER, prefix = 'case') {
  const reference = trade(`${prefix}:reference`, triggerTimeMs - 100, 100, {
    receivedTimeMs: triggerTimeMs - 90,
    evaluatedAtMs: triggerTimeMs - 90,
  });
  const thesisTruth = truth(triggerTimeMs - 50, {
    receivedTimeMs: triggerTimeMs - 40,
    evaluatedAtMs: triggerTimeMs - 40,
    sourceId: 'intelligence-bridge',
    dataset: 'thesis',
    recordId: `${prefix}:thesis`,
  });
  return {
    triggerTimeMs,
    evidenceCutoffTimeMs: triggerTimeMs,
    candidateDisposition: 'OBSERVED',
    thesis: {
      id: `${prefix}:thesis`,
      instrumentId: instrument.instrumentId,
      hypothesis: 'SPOT_LED_EXPANSION',
      stage: 'EARLY_CHANGE',
      changedFirst: 'trade-flow',
      changedAtMs: triggerTimeMs - 50,
      leadMarket: 'SPOT',
      supporting: [],
      conflicting: [],
      neutral: [],
      unavailable: [],
      tradeability: {
        state: 'SUPPORTED',
        reasonCodes: ['REFERENCE_TRADE_PRESENT'],
        requiredEvidenceIds: [reference.id],
        missingEvidenceKinds: [],
      },
      analogueIds: [],
      reasonCodes: ['FIXTURE_TRIGGER'],
      truth: thesisTruth,
    },
    forensics: [],
    evidence: [reference],
    features: [],
    configurationVersion: CONFIGURATION_VERSION,
    featureVersion: FEATURE_VERSION,
    producerVersion: 'capture-fixture-freeze-1',
  };
}

function policy(referenceEvidenceId, horizonMs = 1_000) {
  return {
    horizonMs,
    direction: 'UP',
    movedThresholdPct: 5,
    terminalMaxAgeMs: horizonMs,
    requiredMetricFields: ['forwardReturnPct', 'laterMoved'],
    referenceEvidenceId,
    priceBasis: 'TRADE',
  };
}

function triggerInput(triggerTimeMs = TRIGGER, prefix = 'case', overrides = {}) {
  const frozen = freezeInput(triggerTimeMs, prefix);
  return {
    triggerRequestId: `${prefix}:trigger`,
    symbol: 'TESTUSDT',
    correlationIds: [`${prefix}:correlation`],
    requiredSourceIds: [SPOT_SOURCE],
    freezeInput: frozen,
    postWindowMs: 1_000,
    outcomePolicies: [policy(frozen.evidence[0].id)],
    ...overrides,
  };
}

function fixture(config = {}, storage = new MemoryCaptureStorage(), now = TRIGGER) {
  const clock = new ManualClock(now);
  const coordinator = new LiveOutcomeCaptureCoordinator({ clock, storage, config });
  return { clock, storage, coordinator };
}

function ingestAt(fixtureValue, evidence, atMs, correlationIds = ['source:correlation']) {
  fixtureValue.clock.set(atMs);
  return fixtureValue.coordinator.ingestEvidence({ evidence, correlationIds });
}

test('captures bounded pre-trigger evidence, freezes exactly at trigger, collects post evidence, and attributes at the exact horizon', () => {
  const f = fixture();
  const pre = trade('success:pre', TRIGGER - 500, 99, {
    receivedTimeMs: TRIGGER - 490,
    evaluatedAtMs: TRIGGER - 490,
  });
  const preBefore = structuredClone(pre);
  assert.equal(ingestAt(f, pre, TRIGGER - 490).state, 'ACCEPTED');
  assert.equal(canonicalJson(pre), canonicalJson(preBefore));
  assert.equal(Object.isFrozen(pre), false);
  f.clock.set(TRIGGER);
  const input = triggerInput(TRIGGER, 'success');
  const inputBefore = structuredClone(input);
  const created = f.coordinator.trigger(input);
  assert.equal(created.state, 'CREATED');
  assert.equal(canonicalJson(input), canonicalJson(inputBefore));
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.freezeInput.evidence[0]), false);
  assert.equal(created.capture.frozenRecord.triggerTimeMs, TRIGGER);
  assert.equal(created.capture.frozenRecord.evidenceCutoffTimeMs, TRIGGER);
  assert.ok(created.capture.preEvidence.some((entry) => entry.evidence.id === pre.id));
  assert.ok(created.capture.frozenRecord.evidence.every((evidence) =>
    evidence.truth.temporal.sourceEventTimeMs <= TRIGGER));
  assert.equal(created.capture.completeness.state, 'COLLECTING');

  const terminal = trade('success:terminal', TRIGGER + 1_000, 110, {
    receivedTimeMs: TRIGGER + 1_000,
    evaluatedAtMs: TRIGGER + 1_000,
  });
  const postReceipt = ingestAt(f, terminal, TRIGGER + 1_000);
  assert.equal(postReceipt.postCaptureCount, 1);
  const tick = f.coordinator.tick();
  assert.equal(tick.completedHorizons, 1);
  assert.equal(tick.finalizedCaptures, 1);

  const capture = f.coordinator.snapshot().captures[0];
  assert.equal(capture.horizons[0].state, 'COMPLETE');
  assert.equal(capture.horizons[0].label.observationTimeMs, TRIGGER + 1_000);
  assert.equal(capture.horizons[0].label.metrics.forwardReturnPct, 10);
  assert.equal(capture.horizons[0].label.laterMoved, true);
  assert.equal(capture.completeness.state, 'COMPLETE');
  assert.ok(capture.postEvidence.every((entry) => entry.evidence.truth.temporal.sourceEventTimeMs > TRIGGER));
  assert.match(capture.preChecksum, /^sha256:[0-9a-f]{64}$/);
  assert.match(capture.postChecksum, /^sha256:[0-9a-f]{64}$/);
  assert.match(capture.checksum, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(capture.sourceVersions.map((entry) => entry.sourceId), [SPOT_SOURCE]);
});

test('configurable horizons observe only evidence available by each exact due time', () => {
  const f = fixture();
  const input = triggerInput(TRIGGER, 'multi-horizon');
  input.outcomePolicies = [
    policy(input.freezeInput.evidence[0].id, 1_000),
    policy(input.freezeInput.evidence[0].id, 500),
  ];
  f.clock.set(TRIGGER);
  const created = f.coordinator.trigger(input);
  assert.equal(created.state, 'CREATED');
  assert.deepEqual(created.capture.horizons.map((horizon) => horizon.dueAtMs), [TRIGGER + 500, TRIGGER + 1_000]);

  const firstObservation = trade('multi-horizon:first', TRIGGER + 500, 104, {
    receivedTimeMs: TRIGGER + 500,
    evaluatedAtMs: TRIGGER + 500,
  });
  ingestAt(f, firstObservation, TRIGGER + 500);
  const firstTick = f.coordinator.tick();
  assert.equal(firstTick.completedHorizons, 1);
  let capture = f.coordinator.snapshot().captures[0];
  assert.equal(capture.horizons[0].label.observationTimeMs, TRIGGER + 500);
  assert.equal(capture.horizons[0].label.metrics.forwardReturnPct, 4);
  assert.equal(capture.horizons[0].label.laterMoved, false);
  assert.equal(capture.horizons[1].state, 'PENDING');

  const secondObservation = trade('multi-horizon:second', TRIGGER + 1_000, 110, {
    receivedTimeMs: TRIGGER + 1_000,
    evaluatedAtMs: TRIGGER + 1_000,
  });
  ingestAt(f, secondObservation, TRIGGER + 1_000);
  const secondTick = f.coordinator.tick();
  assert.equal(secondTick.completedHorizons, 1);
  assert.equal(secondTick.finalizedCaptures, 1);
  capture = f.coordinator.snapshot().captures[0];
  assert.equal(capture.horizons[0].label.metrics.forwardReturnPct, 4);
  assert.equal(capture.horizons[1].label.observationTimeMs, TRIGGER + 1_000);
  assert.equal(capture.horizons[1].label.metrics.forwardReturnPct, 10);
  assert.equal(capture.horizons[1].label.laterMoved, true);
});

test('outcome attribution excludes same-symbol evidence from a different frozen thesis instrument', () => {
  const f = fixture();
  f.clock.set(TRIGGER);
  assert.equal(f.coordinator.trigger(triggerInput(TRIGGER, 'instrument-filter')).state, 'CREATED');
  const wrongLeg = tradeForInstrument(
    'instrument-filter:futures', TRIGGER + 1_000, 1_000, usdMInstrument,
    {
      sourceId: 'binance-usdm-aggregate-trade',
      receivedTimeMs: TRIGGER + 1_000,
      evaluatedAtMs: TRIGGER + 1_000,
    },
  );
  const correctLeg = trade('instrument-filter:spot', TRIGGER + 1_000, 110, {
    receivedTimeMs: TRIGGER + 1_000,
    evaluatedAtMs: TRIGGER + 1_000,
  });
  assert.equal(ingestAt(f, wrongLeg, TRIGGER + 1_000).postCaptureCount, 1);
  assert.equal(ingestAt(f, correctLeg, TRIGGER + 1_000).postCaptureCount, 1);
  const tick = f.coordinator.tick();
  assert.equal(tick.failedHorizons, 0);
  assert.equal(tick.completedHorizons, 1);
  const capture = f.coordinator.snapshot().captures[0];
  assert.equal(capture.postEvidence.length, 2);
  assert.equal(capture.horizons[0].label.metrics.forwardReturnPct, 10);
});

test('rejects future epistemic data, null source event time, and non-exact trigger freezes', () => {
  const f = fixture({}, new MemoryCaptureStorage(), TRIGGER - 100);
  const future = trade('future:data', TRIGGER + 1, 101, {
    receivedTimeMs: TRIGGER + 1,
    evaluatedAtMs: TRIGGER + 1,
  });
  const futureReceipt = f.coordinator.ingestEvidence({ evidence: future });
  assert.equal(futureReceipt.state, 'REJECTED');
  assert.equal(futureReceipt.failure.code, 'NO_LOOK_AHEAD_VIOLATION');

  const missingTime = trade('missing:time', TRIGGER - 100, 100, {
    receivedTimeMs: TRIGGER - 100,
    evaluatedAtMs: TRIGGER - 100,
  });
  missingTime.truth.temporal.sourceEventTimeMs = null;
  missingTime.truth.temporal.sourceTransactionTimeMs = null;
  missingTime.truth.freshness = {
    basis: 'RECEIVE_TIME',
    evaluatedAtMs: TRIGGER - 100,
    ageMs: 0,
    maxAgeMs: 60_000,
    state: 'FRESH',
  };
  const missingReceipt = f.coordinator.ingestEvidence({ evidence: missingTime });
  assert.equal(missingReceipt.state, 'REJECTED');
  assert.equal(missingReceipt.failure.code, 'MISSING_SOURCE');

  f.clock.set(TRIGGER);
  const wrongTime = f.coordinator.trigger(triggerInput(TRIGGER + 1, 'wrong-time'));
  assert.equal(wrongTime.state, 'REJECTED');
  assert.equal(wrongTime.failure.code, 'NO_LOOK_AHEAD_VIOLATION');
  assert.equal(f.coordinator.snapshot().captures.length, 0);
});

test('pre-trigger ring overflow is marked truncated and blocks misleading outcome attribution', () => {
  const f = fixture({ maximumPreEvidencePerRing: 2, maximumFreezeEvidence: 4 });
  for (const [offset, id] of [[-300, 'pre:one'], [-200, 'pre:two'], [-100, 'pre:three']]) {
    const evidence = trade(id, TRIGGER + offset, 100, {
      receivedTimeMs: TRIGGER + offset,
      evaluatedAtMs: TRIGGER + offset,
    });
    assert.equal(ingestAt(f, evidence, TRIGGER + offset).state, 'ACCEPTED');
  }
  f.clock.set(TRIGGER);
  const created = f.coordinator.trigger(triggerInput(TRIGGER, 'pre-truncated'));
  assert.equal(created.state, 'CREATED');
  assert.equal(created.capture.truncation.preTrigger, true);
  assert.ok(created.capture.truncation.preDroppedRecords >= 1);

  f.clock.set(TRIGGER + 1_000);
  const tick = f.coordinator.tick();
  assert.equal(tick.truncatedHorizons, 1);
  const capture = f.coordinator.snapshot().captures[0];
  assert.equal(capture.horizons[0].state, 'TRUNCATED');
  assert.equal(capture.horizons[0].label, null);
  assert.equal(capture.completeness.state, 'TRUNCATED');
});

test('ring-key capacity eviction persists a bounded truncation tombstone across restart', async () => {
  const config = { maximumPreRings: 1, maximumRingEvictionTombstones: 1 };
  const storage = new MemoryCaptureStorage();
  const first = fixture(config, storage, TRIGGER - 200);
  const lost = trade('ring-eviction:lost', TRIGGER - 200, 99, {
    receivedTimeMs: TRIGGER - 200,
    evaluatedAtMs: TRIGGER - 200,
  });
  assert.equal(first.coordinator.ingestEvidence({ evidence: lost }).state, 'ACCEPTED');
  const otherSymbol = structuredClone(trade('ring-eviction:other', TRIGGER - 100, 20, {
    receivedTimeMs: TRIGGER - 100,
    evaluatedAtMs: TRIGGER - 100,
    sourceId: 'other-public-source',
  }));
  const otherInstrument = { ...instrument, symbol: 'OTHERUSDT', pair: 'OTHERUSDT', baseAsset: 'OTHER' };
  otherInstrument.instrumentId = stableId('instrument', {
    venue: otherInstrument.venue,
    productFamily: otherInstrument.productFamily,
    symbol: otherInstrument.symbol,
    pair: otherInstrument.pair,
    baseAsset: otherInstrument.baseAsset,
    quoteAsset: otherInstrument.quoteAsset,
    contractType: otherInstrument.contractType,
    sourceMarketType: otherInstrument.sourceMarketType,
  });
  otherSymbol.instrument = otherInstrument;
  first.clock.set(TRIGGER - 100);
  assert.equal(first.coordinator.ingestEvidence({ evidence: otherSymbol }).state, 'ACCEPTED');
  assert.equal(first.coordinator.snapshot().ringEvictionTombstoneCount, 1);
  assert.equal((await first.coordinator.saveCheckpoint()).state, 'SAVED');

  const restarted = fixture(config, storage, TRIGGER);
  assert.equal((await restarted.coordinator.restore()).state, 'RESTORED');
  assert.equal(restarted.coordinator.snapshot().ringEvictionTombstoneCount, 1);
  const created = restarted.coordinator.trigger(triggerInput(TRIGGER, 'ring-key-truncated'));
  assert.equal(created.state, 'CREATED');
  assert.equal(created.capture.truncation.preTrigger, true);
  assert.ok(created.capture.truncation.preDroppedRecords >= 1);
});

test('duplicate ingestion that prunes expired ring entries marks the checkpoint revision dirty', async () => {
  const config = { preTriggerWindowMs: 100 };
  const storage = new MemoryCaptureStorage();
  const f = fixture(config, storage, TRIGGER - 120);
  const expired = trade('duplicate-prune:expired', TRIGGER - 120, 99, {
    receivedTimeMs: TRIGGER - 120,
    evaluatedAtMs: TRIGGER - 120,
  });
  const retained = trade('duplicate-prune:retained', TRIGGER - 50, 100, {
    receivedTimeMs: TRIGGER - 50,
    evaluatedAtMs: TRIGGER - 50,
  });
  assert.equal(f.coordinator.ingestEvidence({ evidence: expired }).state, 'ACCEPTED');
  assert.equal(ingestAt(f, retained, TRIGGER - 50).state, 'ACCEPTED');
  assert.equal((await f.coordinator.saveCheckpoint()).state, 'SAVED');
  assert.equal(f.coordinator.snapshot().checkpointDirty, false);
  f.clock.set(TRIGGER);
  const duplicate = f.coordinator.ingestEvidence({ evidence: retained });
  assert.equal(duplicate.state, 'DUPLICATE');
  assert.equal(duplicate.preRingEvictedRecords, 1);
  assert.equal(f.coordinator.snapshot().checkpointDirty, true);
});

test('post-trigger capacity overflow is explicit, bounded, and removes any previously attributed label', () => {
  const f = fixture({ maximumPostEvidencePerCapture: 2 });
  f.clock.set(TRIGGER);
  assert.equal(f.coordinator.trigger(triggerInput(TRIGGER, 'post-truncated')).state, 'CREATED');
  for (const [offset, price] of [[100, 101], [200, 102], [300, 103]]) {
    const evidence = trade(`post:${offset}`, TRIGGER + offset, price, {
      receivedTimeMs: TRIGGER + offset,
      evaluatedAtMs: TRIGGER + offset,
    });
    ingestAt(f, evidence, TRIGGER + offset);
  }
  f.clock.set(TRIGGER + 1_000);
  const tick = f.coordinator.tick();
  assert.equal(tick.truncatedHorizons, 1);
  const capture = f.coordinator.snapshot().captures[0];
  assert.equal(capture.postEvidence.length, 2);
  assert.equal(capture.truncation.postTrigger, true);
  assert.equal(capture.truncation.postDroppedRecords, 1);
  assert.equal(capture.horizons[0].state, 'TRUNCATED');
  assert.equal(capture.horizons[0].label, null);
});

test('duplicate triggers are idempotent before and after finalized-capture eviction', () => {
  const f = fixture({ maximumActiveCaptures: 1, maximumRetainedCaptures: 1 });
  f.clock.set(TRIGGER);
  const firstInput = triggerInput(TRIGGER, 'first');
  const first = f.coordinator.trigger(firstInput);
  assert.equal(first.state, 'CREATED');
  assert.equal(f.coordinator.trigger(firstInput).state, 'DUPLICATE');
  const conflicting = structuredClone(firstInput);
  conflicting.freezeInput.evidence[0].price = 101;
  conflicting.freezeInput.evidence[0].quoteQuantity = 101;
  const conflict = f.coordinator.trigger(conflicting);
  assert.equal(conflict.state, 'REJECTED');
  assert.equal(conflict.failure.code, 'DUPLICATE_EVENT');
  assert.equal(f.coordinator.snapshot().retainedCaptureCount, 1);

  const terminal = trade('first:terminal', TRIGGER + 1_000, 105, {
    receivedTimeMs: TRIGGER + 1_000,
    evaluatedAtMs: TRIGGER + 1_000,
  });
  ingestAt(f, terminal, TRIGGER + 1_000);
  f.coordinator.tick();

  const secondTime = TRIGGER + 1_001;
  f.clock.set(secondTime);
  const second = f.coordinator.trigger(triggerInput(secondTime, 'second'));
  assert.equal(second.state, 'CREATED');
  assert.deepEqual(second.evictedCaptureIds, [first.captureId]);
  const duplicateEvicted = f.coordinator.trigger(firstInput);
  assert.equal(duplicateEvicted.state, 'DUPLICATE');
  assert.equal(duplicateEvicted.captureId, first.captureId);
  assert.equal(duplicateEvicted.capture, null);
  const snapshot = f.coordinator.snapshot();
  assert.equal(snapshot.retainedCaptureCount, 1);
  assert.equal(snapshot.evictedCaptureCount, 1);
});

test('tombstone pressure never evicts the immutable request identity of a retained capture', () => {
  const f = fixture({
    maximumActiveCaptures: 1,
    maximumRetainedCaptures: 2,
    maximumTriggerTombstones: 2,
  });
  const inputs = [];
  for (let index = 0; index < 3; index += 1) {
    const atMs = TRIGGER + index * 2;
    const input = triggerInput(atMs, `tombstone-${index}`);
    input.postWindowMs = 1;
    input.outcomePolicies = [policy(input.freezeInput.evidence[0].id, 1)];
    inputs.push(input);
    f.clock.set(atMs);
    assert.equal(f.coordinator.trigger(input).state, 'CREATED');
    f.clock.set(atMs + 1);
    f.coordinator.tick();
  }
  const snapshot = f.coordinator.snapshot();
  assert.equal(snapshot.retainedCaptureCount, 2);
  assert.equal(snapshot.evictedCaptureCount, 1);
  assert.equal(snapshot.evictedTriggerTombstoneCount, 1);
  assert.equal(f.coordinator.trigger(inputs[1]).state, 'DUPLICATE');
  const conflicting = structuredClone(inputs[1]);
  conflicting.freezeInput.evidence[0].price = 102;
  conflicting.freezeInput.evidence[0].quoteQuantity = 102;
  const conflict = f.coordinator.trigger(conflicting);
  assert.equal(conflict.state, 'REJECTED');
  assert.equal(conflict.failure.code, 'DUPLICATE_EVENT');
  assert.equal(new Set(f.coordinator.snapshot().captures.map((capture) => capture.triggerRequestId)).size, 2);
});

test('an reached horizon with no later source evidence produces an honest Foundation incomplete label', () => {
  const f = fixture();
  f.clock.set(TRIGGER);
  assert.equal(f.coordinator.trigger(triggerInput(TRIGGER, 'incomplete')).state, 'CREATED');
  f.clock.set(TRIGGER + 1_000);
  const tick = f.coordinator.tick();
  assert.equal(tick.incompleteHorizons, 1);
  const capture = f.coordinator.snapshot().captures[0];
  assert.equal(capture.horizons[0].state, 'INCOMPLETE');
  assert.equal(capture.horizons[0].label.state, 'INCOMPLETE');
  assert.ok(capture.horizons[0].label.missingFields.includes('forwardReturnPct'));
  assert.equal(capture.completeness.state, 'INCOMPLETE');
});

test('checkpoint restart restores active rings and capture state byte-for-byte and continues exact-horizon attribution', async () => {
  const storage = new MemoryCaptureStorage();
  const first = fixture({}, storage);
  first.clock.set(TRIGGER);
  assert.equal(first.coordinator.trigger(triggerInput(TRIGGER, 'restart')).state, 'CREATED');
  const interim = trade('restart:interim', TRIGGER + 500, 105, {
    receivedTimeMs: TRIGGER + 500,
    evaluatedAtMs: TRIGGER + 500,
  });
  ingestAt(first, interim, TRIGGER + 500);
  const saved = await first.coordinator.saveCheckpoint();
  assert.equal(saved.state, 'SAVED');
  assert.equal(saved.generation, 1);
  const before = first.coordinator.snapshot();

  const restarted = fixture({}, storage, TRIGGER + 500);
  const restored = await restarted.coordinator.restore();
  assert.equal(restored.state, 'RESTORED');
  assert.equal(restored.restoredCaptures, 1);
  assert.equal(canonicalJson(restarted.coordinator.snapshot()), canonicalJson(before));

  restarted.clock.set(TRIGGER + 1_000);
  const tick = restarted.coordinator.tick();
  assert.equal(tick.completedHorizons, 1);
  assert.equal(restarted.coordinator.snapshot().captures[0].horizons[0].label.metrics.forwardReturnPct, 5);
});

test('restore reserves pristine state before awaiting storage and serializes concurrent restore calls', async () => {
  const sourceStorage = new MemoryCaptureStorage();
  const source = fixture({}, sourceStorage);
  source.clock.set(TRIGGER);
  assert.equal(source.coordinator.trigger(triggerInput(TRIGGER, 'restore-reservation')).state, 'CREATED');
  assert.equal((await source.coordinator.saveCheckpoint()).state, 'SAVED');

  const deferred = new DeferredLoadStorage(sourceStorage.value);
  const restarted = fixture({}, deferred, TRIGGER);
  const firstRestore = restarted.coordinator.restore();
  const concurrentRestore = restarted.coordinator.restore();
  assert.strictEqual(concurrentRestore, firstRestore);
  const rejectedIngest = restarted.coordinator.ingestEvidence({
    evidence: trade('restore-reservation:blocked', TRIGGER - 10, 100, {
      receivedTimeMs: TRIGGER - 10,
      evaluatedAtMs: TRIGGER - 10,
    }),
  });
  assert.equal(rejectedIngest.state, 'REJECTED');
  assert.equal(rejectedIngest.failure.code, 'UNAVAILABLE');
  assert.equal(restarted.coordinator.trigger(triggerInput(TRIGGER, 'restore-reservation:blocked')).state, 'REJECTED');
  assert.equal((await restarted.coordinator.saveCheckpoint()).state, 'FAILED');
  assert.equal(restarted.coordinator.tick().failures[0].code, 'UNAVAILABLE');
  deferred.releaseLoad();
  const restored = await firstRestore;
  assert.equal(restored.state, 'RESTORED');
  assert.equal(restarted.coordinator.snapshot().retainedCaptureCount, 1);
  assert.equal(restarted.coordinator.snapshot().captures[0].triggerRequestId, 'restore-reservation:trigger');
});

test('checkpoint save coalescing reports a stale saved revision so the caller can persist a bounded follow-up', async () => {
  const storage = new DeferredFirstSaveStorage();
  const f = fixture({}, storage);
  f.clock.set(TRIGGER);
  assert.equal(f.coordinator.trigger(triggerInput(TRIGGER, 'save-revision')).state, 'CREATED');
  const firstSave = f.coordinator.saveCheckpoint();
  const post = trade('save-revision:post', TRIGGER + 500, 105, {
    receivedTimeMs: TRIGGER + 500,
    evaluatedAtMs: TRIGGER + 500,
  });
  ingestAt(f, post, TRIGGER + 500);
  const coalescedSave = f.coordinator.saveCheckpoint();
  assert.strictEqual(coalescedSave, firstSave);
  storage.releaseFirstSave();
  const staleReceipt = await firstSave;
  assert.equal(staleReceipt.state, 'SAVED_DIRTY');
  assert.equal(staleReceipt.checkpointDirty, true);
  assert.ok(staleReceipt.currentMutationVersion > staleReceipt.savedMutationVersion);
  assert.strictEqual(await coalescedSave, staleReceipt);
  const latestReceipt = await f.coordinator.saveCheckpoint();
  assert.equal(latestReceipt.state, 'SAVED');
  assert.equal(latestReceipt.checkpointDirty, false);
  assert.equal(storage.saves, 2);

  const restarted = fixture({}, storage, TRIGGER + 500);
  assert.equal((await restarted.coordinator.restore()).state, 'RESTORED');
  assert.equal(restarted.coordinator.snapshot().captures[0].postEvidence.length, 1);
});

test('checkpoint checksum corruption and storage failures are explicit and never partially restore state', async () => {
  const storage = new MemoryCaptureStorage();
  const first = fixture({}, storage);
  first.clock.set(TRIGGER);
  first.coordinator.trigger(triggerInput(TRIGGER, 'checksum'));
  const post = trade('checksum:post', TRIGGER + 500, 104, {
    receivedTimeMs: TRIGGER + 500,
    evaluatedAtMs: TRIGGER + 500,
  });
  ingestAt(first, post, TRIGGER + 500);
  assert.equal((await first.coordinator.saveCheckpoint()).state, 'SAVED');
  storage.value.payload.captures[0].postEvidence[0].evidence.price = 999;

  const corrupted = fixture({}, storage, TRIGGER + 500);
  const badRestore = await corrupted.coordinator.restore();
  assert.equal(badRestore.state, 'FAILED');
  assert.match(badRestore.failure.message, /checksum/i);
  assert.equal(corrupted.coordinator.snapshot().captures.length, 0);

  const failingSaveStorage = new MemoryCaptureStorage();
  failingSaveStorage.saveError = true;
  const failingSave = fixture({}, failingSaveStorage);
  failingSave.clock.set(TRIGGER);
  failingSave.coordinator.trigger(triggerInput(TRIGGER, 'save-failure'));
  const saveReceipt = await failingSave.coordinator.saveCheckpoint();
  assert.equal(saveReceipt.state, 'FAILED');
  assert.equal(saveReceipt.failure.code, 'UNAVAILABLE');

  const failingLoadStorage = new MemoryCaptureStorage();
  failingLoadStorage.loadError = true;
  const failingLoad = fixture({}, failingLoadStorage);
  const loadReceipt = await failingLoad.coordinator.restore();
  assert.equal(loadReceipt.state, 'FAILED');
  assert.equal(loadReceipt.failure.code, 'UNAVAILABLE');
});

test('identical event-time runs produce byte-identical IDs, checksums, and snapshots', () => {
  const left = fixture();
  const right = fixture();
  for (const f of [left, right]) {
    const pre = trade('deterministic:pre', TRIGGER - 200, 99, {
      receivedTimeMs: TRIGGER - 190,
      evaluatedAtMs: TRIGGER - 190,
    });
    ingestAt(f, pre, TRIGGER - 190, ['deterministic:source']);
    f.clock.set(TRIGGER);
    f.coordinator.trigger(triggerInput(TRIGGER, 'deterministic'));
    const post = trade('deterministic:post', TRIGGER + 1_000, 106, {
      receivedTimeMs: TRIGGER + 1_000,
      evaluatedAtMs: TRIGGER + 1_000,
    });
    ingestAt(f, post, TRIGGER + 1_000, ['deterministic:source']);
    f.coordinator.tick();
  }
  assert.equal(canonicalJson(left.coordinator.snapshot()), canonicalJson(right.coordinator.snapshot()));
});

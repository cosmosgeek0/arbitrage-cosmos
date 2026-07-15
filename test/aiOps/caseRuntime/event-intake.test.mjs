import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptProviderNeutralEvent,
} from '../../../server/dist/aiOps/caseRuntime/eventIntake.js';
import {
  admitObservation,
  createAdmissionState,
} from '../../../server/dist/aiOps/caseRuntime/incident.js';

const observedAtMs = 1_700_000_000_010;
const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

function providerEvent(overrides = {}) {
  const dataOverrides = overrides.data ?? {};
  return {
    specversion: '1.0',
    id: 'provider/event/1',
    source: 'urn:synthetic:provider-a',
    type: 'com.synthetic.runtime.component.failed',
    subject: 'components/worker-1',
    time: '2023-11-14T22:13:20.000Z',
    datacontenttype: 'application/json',
    dataschema: 'urn:cosmos:aiops:a2:event-data:v1',
    traceparent,
    data: {
      producerRevision: 'provider/revision/1',
      sequence: 7,
      resourceId: 'resources/worker-1',
      componentId: 'components/worker-1',
      incidentId: null,
      replayClassification: 'LIVE',
      dataClassification: 'INTERNAL',
      message: 'Synthetic worker 42 failed without private material',
      reasonCodes: ['SYNTHETIC_COMPONENT_FAILURE'],
      attributes: { region: 'test-zone', attempt: 2 },
      ...dataOverrides,
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'data')),
  };
}

const policy = Object.freeze({
  policyRevision: 'a2x-intake-policy-v1',
  dedupWindowMs: 1_000,
  cooldownMs: 5_000,
  stormWindowMs: 10_000,
  stormThreshold: 3,
  maximumFingerprints: 32,
  maximumStormChildren: 64,
  maximumSourceEventReceipts: 128,
});
const severitySignals = Object.freeze({
  safetyInvariantBreached: false,
  deterministicControlLost: false,
  customerImpact: 'LIMITED',
  capitalRelevant: false,
  availabilityLoss: 'NONE',
  dataIntegrity: 'INTACT',
});
const depthSignals = Object.freeze({
  deterministicExplanationAvailable: false,
  evidenceCompleteness: 'PARTIAL',
  novelty: 'VARIANT',
  causalAmbiguity: 'LOW',
  repairOrAdjudicationRequested: 'NONE',
});

function admit(state, observation) {
  return admitObservation(state, {
    observation,
    admissionAtMs: observation.observedAtMs,
    severitySignals,
    depthSignals,
    rootFingerprint: null,
    materiality: 'MATERIAL',
  }, policy);
}

test('provider-neutral intake deterministically maps CloudEvents identity, time, and trace context without authority', () => {
  const input = providerEvent();
  const first = adaptProviderNeutralEvent(input, observedAtMs);
  const second = adaptProviderNeutralEvent(providerEvent(), observedAtMs);
  assert.deepEqual(first, second);
  assert.equal(first.receipt.schema, 'AI_OPS_A2X_EVENT_INTAKE_RECEIPT_V1');
  assert.equal(first.receipt.shadowStatus, 'SHADOW_SPECULATIVE');
  assert.equal(first.receipt.operationalAuthority, 'NONE');
  assert.equal(first.receipt.status, 'ADAPTED');
  assert.equal(first.observation.occurredAtMs, 1_700_000_000_000);
  assert.equal(first.observation.observedAtMs, observedAtMs);
  assert.equal(first.observation.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
  assert.equal(first.observation.spanId, '00f067aa0ba902b7');
  assert.equal(first.observation.attributes.ce_source, input.source);
  assert.equal(first.observation.attributes.ce_id, input.id);
  assert.equal(first.observation.attributes.provider_component_id, input.data.componentId);
  assert.match(first.observation.source, /^a2-provider-source:/u);
  assert.match(first.observation.eventId, /^a2-provider-event:/u);
  assert.match(first.observation.dedupKey, /^a2-provider-dedup:/u);
  assert.equal(first.receipt.normalizedObservationDigest, first.observation.contentDigest);
  assert.equal(Object.hasOwn(first.receipt, 'accepted'), false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.receipt), true);
  assert.equal(Object.isFrozen(first.receipt.reasonCodes), true);
  assert.equal(Object.isFrozen(first.observation), true);
  assert.equal(Object.isFrozen(first.observation.attributes), true);
});

test('CloudEvents source plus id remains replay identity while delivery classification and receipt digest can change', () => {
  const live = adaptProviderNeutralEvent(providerEvent(), observedAtMs);
  const replay = adaptProviderNeutralEvent(providerEvent({
    data: { replayClassification: 'REPLAY' },
  }), observedAtMs + 100);
  assert.equal(live.receipt.sourceEventKey, replay.receipt.sourceEventKey);
  assert.equal(live.receipt.semanticEventDigest, replay.receipt.semanticEventDigest);
  assert.notEqual(live.receipt.providerEventDigest, replay.receipt.providerEventDigest);
  assert.notEqual(live.receipt.receiptDigest, replay.receipt.receiptDigest);
  assert.equal(live.observation.eventId, replay.observation.eventId);
  assert.equal(live.observation.dedupKey, replay.observation.dedupKey);
  assert.equal(live.observation.provenanceDigest, replay.observation.provenanceDigest);
  assert.equal(replay.observation.replayClassification, 'REPLAY');

  const firstAdmission = admit(createAdmissionState(policy.policyRevision), live.observation);
  const replayAdmission = admit(firstAdmission.state, replay.observation);
  assert.equal(replayAdmission.projection.disposition, 'DEDUPLICATED');
  assert.strictEqual(replayAdmission.state, firstAdmission.state);

  const conflicting = adaptProviderNeutralEvent(providerEvent({
    data: { replayClassification: 'REPLAY', message: 'Synthetic conflicting event content' },
  }), observedAtMs + 200);
  assert.equal(conflicting.receipt.sourceEventKey, live.receipt.sourceEventKey);
  assert.throws(() => admit(firstAdmission.state, conflicting.observation), /conflicting content/u);
});

test('identical provider id from a different CloudEvents source cannot collide', () => {
  const first = adaptProviderNeutralEvent(providerEvent(), observedAtMs);
  const second = adaptProviderNeutralEvent(providerEvent({ source: 'urn:synthetic:provider-b' }), observedAtMs);
  assert.notEqual(first.receipt.sourceEventKey, second.receipt.sourceEventKey);
  assert.notEqual(first.observation.source, second.observation.source);
  assert.notEqual(first.observation.eventId, second.observation.eventId);
  assert.notEqual(first.observation.dedupKey, second.observation.dedupKey);
});

test('missing provider sequence is quarantined without fabricating an ordering value', () => {
  const result = adaptProviderNeutralEvent(providerEvent({ data: { sequence: null } }), observedAtMs);
  assert.equal(result.receipt.status, 'QUARANTINED');
  assert.equal(result.receipt.operationalAuthority, 'NONE');
  assert.equal(result.receipt.normalizedObservationDigest, null);
  assert.deepEqual(result.receipt.reasonCodes, ['SOURCE_SEQUENCE_UNAVAILABLE']);
  assert.equal(result.observation, null);
});

test('closed inert boundary rejects unknown fields, accessors, sparse arrays, and cycles without invoking callbacks', () => {
  assert.throws(
    () => adaptProviderNeutralEvent(providerEvent({ unsupported: true }), observedAtMs),
    /unsupported field/u,
  );

  let invoked = false;
  const accessor = providerEvent();
  Object.defineProperty(accessor, 'type', {
    enumerable: true,
    get() {
      invoked = true;
      throw new Error('must not run');
    },
  });
  assert.throws(() => adaptProviderNeutralEvent(accessor, observedAtMs), /accessor/u);
  assert.equal(invoked, false);

  const sparseReasons = providerEvent();
  sparseReasons.data.reasonCodes = new Array(2);
  sparseReasons.data.reasonCodes[1] = 'SYNTHETIC_REASON';
  assert.throws(() => adaptProviderNeutralEvent(sparseReasons, observedAtMs), /sparse/u);

  const cyclic = providerEvent();
  cyclic.data.attributes.loop = cyclic.data.attributes;
  assert.throws(() => adaptProviderNeutralEvent(cyclic, observedAtMs), /bounds/u);
});

test('unsafe and oversized payloads fail closed before observation normalization', () => {
  const forbiddenKey = ['api', 'key'].join('_');
  assert.throws(
    () => adaptProviderNeutralEvent(providerEvent({
      data: { attributes: { [forbiddenKey]: 'SYNTHETIC_VALUE_NOT_A_CREDENTIAL' } },
    }), observedAtMs),
    /replay guard/u,
  );

  const attributes = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [`bounded_${index}`, 'x'.repeat(1_800)]),
  );
  assert.throws(
    () => adaptProviderNeutralEvent(providerEvent({ data: { attributes } }), observedAtMs),
    /65536 canonical UTF-8 bytes/u,
  );
});

test('invalid occurrence time and trace context fail closed while valid RFC3339 offsets remain deterministic', () => {
  for (const time of [
    '2023-02-29T00:00:00Z',
    '2023-11-14 22:13:20Z',
    '2023-11-14T22:13:20.1234Z',
    '2023-11-14T25:13:20Z',
  ]) {
    assert.throws(() => adaptProviderNeutralEvent(providerEvent({ time }), observedAtMs), /event\.time/u);
  }
  for (const invalidTraceparent of [
    '00-00000000000000000000000000000000-00f067aa0ba902b7-01',
    '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01',
    traceparent.toUpperCase(),
    'ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  ]) {
    assert.throws(
      () => adaptProviderNeutralEvent(providerEvent({ traceparent: invalidTraceparent }), observedAtMs),
      /traceparent/u,
    );
  }
  const offset = adaptProviderNeutralEvent(
    providerEvent({ time: '2023-11-14T23:13:20.000+01:00' }),
    observedAtMs,
  );
  assert.equal(offset.observation.occurredAtMs, 1_700_000_000_000);
});

test('adapter snapshots caller data and refuses reserved attribute collisions', () => {
  const input = providerEvent();
  const result = adaptProviderNeutralEvent(input, observedAtMs);
  input.data.attributes.region = 'mutated-zone';
  input.data.message = 'mutated message';
  assert.equal(result.observation.attributes.region, 'test-zone');
  assert.match(result.observation.template, /synthetic worker/u);
  assert.throws(
    () => adaptProviderNeutralEvent(providerEvent({ data: { attributes: { CE_SOURCE: 'forged-source' } } }), observedAtMs),
    /reserved key/u,
  );
});

test('provider reason-code capacity reserves exactly one slot for the intake marker', () => {
  const unreserved = Array.from({ length: 31 }, (_, index) => `SYNTHETIC_REASON_${index}`);
  const adapted = adaptProviderNeutralEvent(providerEvent({ data: { reasonCodes: unreserved } }), observedAtMs);
  assert.equal(adapted.observation.reasonCodes.length, 32);
  assert.ok(adapted.observation.reasonCodes.includes('PROVIDER_NEUTRAL_EVENT_INTAKE'));

  const overflow = [...unreserved, 'SYNTHETIC_REASON_31'];
  assert.throws(
    () => adaptProviderNeutralEvent(providerEvent({ data: { reasonCodes: overflow } }), observedAtMs),
    /item bound/u,
  );
  const preReserved = [...unreserved, 'PROVIDER_NEUTRAL_EVENT_INTAKE'];
  assert.equal(
    adaptProviderNeutralEvent(providerEvent({ data: { reasonCodes: preReserved } }), observedAtMs)
      .observation.reasonCodes.length,
    32,
  );
});

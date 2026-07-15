import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  admitObservation,
  createAdmissionState,
  fingerprintObservation,
  markFingerprintResolved,
  normalizeObservation,
  projectModelDepth,
  projectSeverity,
} from '../../../server/dist/aiOps/caseRuntime/index.js';
import { canonicalJson } from '../../../server/dist/foundation/contracts/identity.js';

const policy = Object.freeze({
  policyRevision: 'a2-policy-v1',
  dedupWindowMs: 1_000,
  cooldownMs: 5_000,
  stormWindowMs: 10_000,
  stormThreshold: 3,
  maximumFingerprints: 32,
  maximumStormChildren: 64,
  maximumSourceEventReceipts: 128,
});
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

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

function observation(overrides = {}) {
  const eventId = overrides.eventId ?? 'evt-1';
  const dedupKey = overrides.dedupKey ?? `dedup-${eventId}`;
  return normalizeObservation({
    schema: 'AI_OPS_A2_OBSERVATION_V1',
    source: 'synthetic-otel-source',
    producerRevision: 'synthetic-producer-v1',
    eventId,
    sequence: 1,
    dedupKey,
    eventType: 'component-failure',
    resourceId: 'synthetic-resource',
    componentId: 'synthetic-component',
    incidentId: null,
    occurredAtMs: 1_700_000_000_000,
    observedAtMs: 1_700_000_000_010,
    replayClassification: 'LIVE',
    dataClassification: 'INTERNAL',
    provenanceDigest: sha256('synthetic-provenance'),
    traceId: 'trace-synthetic-1',
    spanId: 'span-synthetic-1',
    message: 'Worker 42 failed at 2026-07-14T10:00:00Z request 99',
    reasonCodes: ['SYNTHETIC_FAILURE'],
    attributes: { region: 'test-zone', request_id: 'request-99' },
    ...overrides,
  });
}

function admit(state, normalized, rootFingerprint = null) {
  return admitObservation(state, {
    observation: normalized,
    admissionAtMs: normalized.observedAtMs,
    severitySignals,
    depthSignals,
    rootFingerprint,
    materiality: 'MATERIAL',
  }, policy);
}

test('normalization is deterministic, closed, and preserves occurrence versus observation time', () => {
  const first = observation({ attributes: { z: 2, a: 'one' } });
  const second = observation({ attributes: { a: 'one', z: 2 } });
  assert.deepEqual(first, second);
  assert.equal(first.occurredAtMs, 1_700_000_000_000);
  assert.equal(first.observedAtMs, 1_700_000_000_010);
  assert.match(first.template, /<number>/u);
  assert.throws(() => observation({ unexpected: true }), /unsupported field/u);
});

test('normalization redacts secret-bearing message and attribute content before template or fingerprint output', () => {
  const secretLabel = ['api', 'key'].join('_');
  const normalized = observation({
    message: `failure ${secretLabel}=SYNTHETIC_VALUE_DO_NOT_USE`,
    attributes: { [secretLabel]: 'SYNTHETIC_ATTRIBUTE_DO_NOT_USE', position_id: 'position-material-1' },
  });
  assert.equal(normalized.redactionApplied, true);
  assert.equal(JSON.stringify(normalized).includes('SYNTHETIC_VALUE_DO_NOT_USE'), false);
  assert.equal(JSON.stringify(normalized).includes('SYNTHETIC_ATTRIBUTE_DO_NOT_USE'), false);
  assert.equal(normalized.attributes.position_id, 'position-material-1');
  const supplemental = observation({
    eventId: 'supplemental-secret-cases',
    message: 'Authorization: Basic U1lOVEhFVElDOkZBS0U= client_secret=DO_NOT_PERSIST eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.c2lnbmF0dXJl',
    attributes: { authorization: 'Basic U1lOVEhFVElDOkZBS0U=', client_secret: 'DO_NOT_PERSIST' },
  });
  assert.equal(JSON.stringify(supplemental).includes('U1lOVEhFVElDOkZBS0U'), false);
  assert.equal(JSON.stringify(supplemental).includes('DO_NOT_PERSIST'), false);
  assert.equal(JSON.stringify(supplemental).includes('eyJhbGciOiJIUzI1NiJ9'), false);
  const secretKey = observation({
    eventId: 'secret-attribute-key',
    attributes: { 'client_secret=ATTRIBUTE_KEY_DO_NOT_PERSIST': true },
  });
  assert.equal(JSON.stringify(secretKey).includes('ATTRIBUTE_KEY_DO_NOT_PERSIST'), false);
  assert.equal(Object.keys(secretKey.attributes).some((key) => key.startsWith('redacted_attribute_')), true);
  for (const [eventId, message] of [
    ['secret-fullwidth', 'ｐａｓｓｗｏｒｄ=SYNTHETIC_FULLWIDTH_LEAK'],
    ['secret-zero-width', 'pass\u200Bword=SYNTHETIC_ZERO_WIDTH_LEAK'],
    ['secret-escaped', '"password":"abc\\\"SYNTHETIC_ESCAPED_LEAK"'],
    ['secret-passwd', 'passwd=SYNTHETIC_PASSWD_LEAK'],
    ['secret-pwd', 'pwd=SYNTHETIC_PWD_LEAK'],
    ['secret-key-name', 'secret_key=SYNTHETIC_KEY_LEAK'],
  ]) {
    const projection = observation({ eventId, message });
    assert.equal(JSON.stringify(projection).includes('LEAK'), false);
    assert.equal(projection.redactionApplied, true);
  }
});

test('attribute keys are canonicalized before storage and fingerprinting', () => {
  const ascii = observation({ eventId: 'canonical-ascii', attributes: { region: 'test-zone' } });
  const fullwidth = observation({ eventId: 'canonical-fullwidth', attributes: { 'ｒｅｇｉｏｎ': 'test-zone' } });
  const bidi = observation({ eventId: 'canonical-bidi', attributes: { 'reg\u202eion': 'test-zone' } });
  assert.deepEqual(fullwidth.attributes, ascii.attributes);
  assert.deepEqual(bidi.attributes, ascii.attributes);
  assert.equal(fingerprintObservation(fullwidth, policy.policyRevision), fingerprintObservation(ascii, policy.policyRevision));
  assert.equal(fingerprintObservation(bidi, policy.policyRevision), fingerprintObservation(ascii, policy.policyRevision));
  assert.throws(() => observation({ attributes: { region: 'a', 'ｒｅｇｉｏｎ': 'b' } }), /collide after canonical/u);
});

test('prototype-named attributes remain owned material facts and cannot false-replay', () => {
  const first = observation({
    eventId: 'prototype-key-event',
    dedupKey: 'prototype-key-dedup',
    attributes: JSON.parse('{"__proto__":"synthetic-a","region":"test-zone"}'),
  });
  const conflicting = observation({
    eventId: 'prototype-key-event',
    dedupKey: 'prototype-key-dedup',
    attributes: JSON.parse('{"__proto__":"synthetic-b","region":"test-zone"}'),
  });
  assert.equal(Object.hasOwn(first.attributes, '__proto__'), true);
  assert.equal(first.attributes.__proto__, 'synthetic-a');
  assert.notEqual(first.contentDigest, conflicting.contentDigest);
  const admitted = admit(createAdmissionState(policy.policyRevision), first);
  assert.throws(() => admit(admitted.state, conflicting), /conflicting content/u);
});

test('template mining removes volatile tokens while material reason codes remain fingerprinted', () => {
  const first = observation({ eventId: 'evt-a', message: 'Worker 42 failed request 99' });
  const second = observation({ eventId: 'evt-b', message: 'Worker 77 failed request 123' });
  assert.equal(first.template, second.template);
  assert.equal(fingerprintObservation(first, policy.policyRevision), fingerprintObservation(second, policy.policyRevision));
  const distinct = observation({ eventId: 'evt-c', reasonCodes: ['DIFFERENT_FAILURE'] });
  assert.notEqual(fingerprintObservation(first, policy.policyRevision), fingerprintObservation(distinct, policy.policyRevision));
});

test('severity and model depth are independent projections', () => {
  const critical = projectSeverity({ ...severitySignals, safetyInvariantBreached: true });
  const shallow = projectModelDepth({
    deterministicExplanationAvailable: true,
    evidenceCompleteness: 'COMPLETE',
    novelty: 'KNOWN',
    causalAmbiguity: 'NONE',
    repairOrAdjudicationRequested: 'NONE',
  });
  const informational = projectSeverity({
    safetyInvariantBreached: false,
    deterministicControlLost: false,
    customerImpact: 'NONE',
    capitalRelevant: false,
    availabilityLoss: 'NONE',
    dataIntegrity: 'INTACT',
  });
  const deep = projectModelDepth({ ...depthSignals, novelty: 'NOVEL', causalAmbiguity: 'HIGH' });
  assert.equal(critical, 'SEV0_SAFETY');
  assert.equal(shallow, 'L0_DETERMINISTIC');
  assert.equal(informational, 'SEV4_INFORMATIONAL');
  assert.equal(deep, 'L3_RESEARCH');
});

test('unknown signals remain null rather than fabricated zero-confidence truth', () => {
  assert.equal(projectSeverity({ ...severitySignals, customerImpact: 'UNKNOWN' }), null);
  assert.equal(projectSeverity({ ...severitySignals, safetyInvariantBreached: null, capitalRelevant: true }), null);
  assert.equal(projectModelDepth({ ...depthSignals, deterministicExplanationAvailable: null, evidenceCompleteness: 'UNKNOWN', novelty: 'UNKNOWN', causalAmbiguity: 'UNKNOWN' }), null);
  assert.equal(projectModelDepth({ ...depthSignals, evidenceCompleteness: 'PARTIAL', novelty: 'UNKNOWN' }), null);
});

test('malformed severity and depth enums fail closed and incomplete admission is quarantined', () => {
  assert.throws(() => projectSeverity({ ...severitySignals, customerImpact: 'tiny' }), /unsupported/u);
  assert.throws(() => projectModelDepth({ ...depthSignals, novelty: 'maybe' }), /unsupported/u);
  const incompleteObservation = observation();
  const incomplete = admitObservation(createAdmissionState(policy.policyRevision), {
    observation: incompleteObservation,
    admissionAtMs: incompleteObservation.observedAtMs,
    severitySignals: { ...severitySignals, customerImpact: 'UNKNOWN' },
    depthSignals,
    rootFingerprint: null,
    materiality: 'MATERIAL',
  }, policy);
  assert.equal(incomplete.projection.disposition, 'QUARANTINED_INCOMPLETE');
  assert.equal(incomplete.projection.admitted, false);
});

test('exact replay is idempotently deduplicated and conflicting source identity fails closed', () => {
  const first = observation();
  const admitted = admit(createAdmissionState(policy.policyRevision), first);
  const replayInput = observation({ observedAtMs: first.observedAtMs + 50 });
  const replay = admit(admitted.state, replayInput);
  assert.equal(replay.projection.disposition, 'DEDUPLICATED');
  assert.strictEqual(replay.state, admitted.state);
  assert.equal(replay.state.fingerprints[0].occurrenceCount, 1);
  assert.throws(() => admit(admitted.state, observation({ message: 'materially changed message' })), /conflicting content/u);
});

test('dedup identity survives changed delivery ID and replay classification', () => {
  const original = observation({ eventId: 'delivery-live', dedupKey: 'stable-owner-dedup' });
  const first = admit(createAdmissionState(policy.policyRevision), original);
  const redrive = observation({
    eventId: 'delivery-redrive',
    dedupKey: 'stable-owner-dedup',
    replayClassification: 'REDRIVE',
    observedAtMs: original.observedAtMs + policy.dedupWindowMs + 1,
  });
  const result = admit(first.state, redrive);
  assert.equal(result.projection.disposition, 'DEDUPLICATED');
  assert.strictEqual(result.state, first.state);
});

test('delayed exact replay remains state-idempotent after newer events', () => {
  const original = observation({ eventId: 'delayed-original', dedupKey: 'delayed-key', sequence: 10 });
  const first = admit(createAdmissionState(policy.policyRevision), original);
  const newer = admit(first.state, observation({
    eventId: 'newer-event', dedupKey: 'newer-key', sequence: 11,
    eventType: 'newer-type', observedAtMs: original.observedAtMs + 500,
  }));
  const delayed = admit(newer.state, original);
  assert.equal(delayed.projection.disposition, 'DEDUPLICATED');
  assert.strictEqual(delayed.state, newer.state);
});

test('delayed observations deduplicate symmetrically without rewinding the admission watermark', () => {
  const base = 1_700_000_000_000;
  const eventA = observation({ eventId: 'temporal-a', dedupKey: 'temporal-a', observedAtMs: base + 100 });
  const eventB = observation({ eventId: 'temporal-b', dedupKey: 'temporal-b', observedAtMs: base + 90 });
  const eventC = observation({ eventId: 'temporal-c', dedupKey: 'temporal-c', observedAtMs: base + 101 });
  const first = admitObservation(createAdmissionState(policy.policyRevision), {
    observation: eventA,
    admissionAtMs: base + 100,
    severitySignals,
    depthSignals,
    rootFingerprint: null,
    materiality: 'MATERIAL',
  }, policy);
  const delayed = admitObservation(first.state, {
    observation: eventB,
    admissionAtMs: base + 100,
    severitySignals,
    depthSignals,
    rootFingerprint: null,
    materiality: 'MATERIAL',
  }, policy);
  assert.equal(delayed.projection.disposition, 'DEDUPLICATED');
  assert.equal(delayed.projection.stormParentId, null);
  assert.equal(delayed.state.fingerprints[0].lastObservedAtMs, base + 100);
  const latest = admitObservation(delayed.state, {
    observation: eventC,
    admissionAtMs: base + 101,
    severitySignals,
    depthSignals,
    rootFingerprint: null,
    materiality: 'MATERIAL',
  }, policy);
  assert.equal(latest.projection.disposition, 'DEDUPLICATED');
  assert.match(latest.projection.stormParentId, /^a2-storm-parent:/u);
  assert.equal(latest.state.fingerprints[0].lastObservedAtMs, base + 101);
  assert.deepEqual(latest.state.stormObservations.map((entry) => entry.observedAtMs), [base + 90, base + 100, base + 101]);
});

test('out-of-order storm membership is symmetric and later event time reaches the component threshold', () => {
  const stormPolicy = { ...policy, stormThreshold: 3, maximumStormChildren: 4 };
  const base = 1_700_000_003_000;
  const eventA = observation({
    eventId: 'storm-a', dedupKey: 'storm-a', eventType: 'storm-type-a',
    message: 'storm signature alpha', observedAtMs: base + 100,
  });
  const eventB = observation({
    eventId: 'storm-b', dedupKey: 'storm-b', eventType: 'storm-type-b',
    message: 'storm signature beta', observedAtMs: base + 90,
  });
  const eventC = observation({
    eventId: 'storm-c', dedupKey: 'storm-c', eventType: 'storm-type-c',
    message: 'storm signature gamma', observedAtMs: base + 101,
  });
  const admitAt = (state, normalized) => admitObservation(state, {
    observation: normalized,
    admissionAtMs: base + 200,
    severitySignals,
    depthSignals,
    rootFingerprint: null,
    materiality: 'MATERIAL',
  }, stormPolicy);
  const first = admitAt(createAdmissionState(stormPolicy.policyRevision), eventA);
  const delayed = admitAt(first.state, eventB);
  assert.equal(delayed.projection.stormParentId, null);
  const latest = admitAt(delayed.state, eventC);
  assert.equal(latest.projection.disposition, 'STORM_CHILD');
  assert.match(latest.projection.stormParentId, /^a2-storm-parent:/u);
  assert.deepEqual(latest.state.stormObservations.map((entry) => entry.eventId), ['storm-b', 'storm-a', 'storm-c']);
});

test('proposed incident identity converges for delivery permutations of the same normalized event multiset', () => {
  const base = 1_700_000_004_000;
  const events = [
    observation({ eventId: 'identity-a', dedupKey: 'identity-a', observedAtMs: base + 100 }),
    observation({ eventId: 'identity-b', dedupKey: 'identity-b', observedAtMs: base + 90 }),
    observation({ eventId: 'identity-c', dedupKey: 'identity-c', observedAtMs: base + 101 }),
  ];
  const run = (order) => {
    let state = createAdmissionState(policy.policyRevision);
    for (const index of order) {
      state = admitObservation(state, {
        observation: events[index],
        admissionAtMs: base + 200,
        severitySignals,
        depthSignals,
        rootFingerprint: null,
        materiality: 'MATERIAL',
      }, policy).state;
    }
    return state.fingerprints[0];
  };
  const chronological = run([1, 0, 2]);
  const delayedFirst = run([0, 1, 2]);
  assert.equal(chronological.proposedIncidentId, delayedFirst.proposedIncidentId);
  assert.equal(chronological.firstObservedAtMs, base + 90);
  assert.equal(delayedFirst.firstObservedAtMs, base + 90);
  assert.equal(chronological.lastObservedAtMs, base + 101);
  assert.equal(delayedFirst.lastObservedAtMs, base + 101);
});

test('resumed admission state rejects a forged proposed incident identity', () => {
  const first = admit(createAdmissionState(policy.policyRevision), observation({
    eventId: 'identity-forge-first',
    dedupKey: 'identity-forge-first',
  }));
  const forged = {
    ...first.state,
    fingerprints: [{
      ...first.state.fingerprints[0],
      proposedIncidentId: 'forged-proposed-incident',
    }],
  };
  assert.throws(() => admit(forged, observation({
    eventId: 'identity-forge-next',
    dedupKey: 'identity-forge-next',
    observedAtMs: 1_700_000_000_011,
  })), /identity is not canonical/u);
});

test('the same event ID from a different source is not an identity collision', () => {
  const first = admit(createAdmissionState(policy.policyRevision), observation());
  const second = admit(first.state, observation({ source: 'another-synthetic-source', observedAtMs: 1_700_000_000_020 }));
  assert.equal(second.state.fingerprints.reduce((sum, entry) => sum + entry.occurrenceCount, 0), 2);
});

test('material identifier attributes separate fingerprints while volatile trace identifiers do not', () => {
  const first = observation({ eventId: 'material-a', attributes: { position_id: 'position-a', trace_id: 'trace-a' } });
  const second = observation({ eventId: 'material-b', attributes: { position_id: 'position-b', trace_id: 'trace-b' } });
  assert.notEqual(fingerprintObservation(first, policy.policyRevision), fingerprintObservation(second, policy.policyRevision));
  const traceOnlyA = observation({ eventId: 'trace-a', attributes: { trace_id: 'trace-a' } });
  const traceOnlyB = observation({ eventId: 'trace-b', attributes: { trace_id: 'trace-b' } });
  assert.equal(fingerprintObservation(traceOnlyA, policy.policyRevision), fingerprintObservation(traceOnlyB, policy.policyRevision));
});

test('root inhibition retains child evidence and refuses missing roots or cycles', () => {
  const root = admit(createAdmissionState(policy.policyRevision), observation({ eventId: 'root-evt' }));
  const rootFingerprint = root.projection.fingerprint;
  const childObservation = observation({
    eventId: 'child-evt',
    eventType: 'child-failure',
    message: 'child dependency failed',
    observedAtMs: 1_700_000_000_020,
  });
  const child = admit(root.state, childObservation, rootFingerprint);
  assert.equal(child.projection.disposition, 'INHIBITED_CHILD');
  assert.equal(child.projection.admitted, false);
  assert.equal(child.projection.evidenceRetained, true);
  assert.equal(child.projection.inhibitedByFingerprint, rootFingerprint);
  assert.throws(() => admit(child.state, observation({
    eventId: 'child-root-drop', eventType: 'child-failure', message: 'child dependency failed', observedAtMs: 1_700_000_002_000,
  }), null), /inhibition root lineage conflict/u);
  assert.throws(() => admit(root.state, childObservation, '0'.repeat(64)), /root is not present/u);
  assert.throws(() => admit(child.state, observation({ eventId: 'cycle', observedAtMs: 1_700_000_000_030 }), rootFingerprint), /self|cycle/u);
});

test('storm parenting begins exactly at the configured threshold', () => {
  let state = createAdmissionState(policy.policyRevision);
  let result;
  for (let index = 0; index < 3; index += 1) {
    result = admit(state, observation({
      eventId: `storm-${index}`,
      eventType: `storm-type-${index}`,
      message: `distinct storm message type ${index}`,
      observedAtMs: 1_700_000_001_000 + index,
    }));
    state = result.state;
    if (index < 2) assert.equal(result.projection.stormParentId, null);
  }
  assert.equal(result.projection.disposition, 'STORM_CHILD');
  assert.equal(result.projection.admitted, false);
  assert.match(result.projection.stormParentId, /^a2-storm-parent:/u);
});

test('storm parent remains stable while bounded child retention rolls within one active window', () => {
  const tightPolicy = { ...policy, stormThreshold: 2, maximumStormChildren: 3, stormWindowMs: 10_000 };
  const start = 1_700_000_002_000;
  let state = createAdmissionState(tightPolicy.policyRevision);
  const parents = [];
  for (let index = 0; index < 8; index += 1) {
    const stormObservation = observation({
      eventId: `sustained-storm-${index}`,
      eventType: `sustained-type-${index}`,
      message: `sustained storm category ${index}`,
      observedAtMs: start + index,
    });
    const result = admitObservation(state, {
      observation: stormObservation,
      admissionAtMs: stormObservation.observedAtMs,
      severitySignals,
      depthSignals,
      rootFingerprint: null,
      materiality: 'MATERIAL',
    }, tightPolicy);
    state = result.state;
    if (result.projection.stormParentId !== null) parents.push(result.projection.stormParentId);
    assert.ok(state.stormObservations.length <= tightPolicy.maximumStormChildren);
  }
  assert.equal(new Set(parents).size, 1);
  assert.match(state.stormParents[0].anchorEventId, /^a2-source-event:/u);
  assert.deepEqual(state.stormParents.map((parent) => ({
    anchorEventId: parent.anchorEventId,
    activatedAtMs: parent.activatedAtMs,
    lastObservedAtMs: parent.lastObservedAtMs,
  })), [{
    anchorEventId: state.stormObservations[0].sourceEventKey,
    activatedAtMs: start + 1,
    lastObservedAtMs: start + 7,
  }]);
});

test('cooldown suppresses before expiry and admits exactly at expiry', () => {
  const first = admit(createAdmissionState(policy.policyRevision), observation());
  const resolvedAt = first.state.fingerprints[0].lastObservedAtMs + 100;
  const cooled = markFingerprintResolved(first.state, first.projection.fingerprint, resolvedAt, policy);
  const before = admit(cooled, observation({ eventId: 'cooldown-before', observedAtMs: resolvedAt + policy.cooldownMs - 1 }));
  assert.equal(before.projection.disposition, 'COOLDOWN_SUPPRESSED');
  const atExpiry = admit(cooled, observation({ eventId: 'cooldown-expiry', observedAtMs: resolvedAt + policy.cooldownMs }));
  assert.equal(atExpiry.projection.disposition, 'ADMIT_PROPOSAL');
});

test('source-event receipt capacity refuses new work rather than forgetting replay identity', () => {
  const boundedPolicy = { ...policy, maximumSourceEventReceipts: 1 };
  const firstObservation = observation({ eventId: 'bounded-1', dedupKey: 'bounded-1' });
  const first = admitObservation(createAdmissionState(policy.policyRevision), {
    observation: firstObservation,
    admissionAtMs: firstObservation.observedAtMs,
    severitySignals,
    depthSignals,
    rootFingerprint: null,
    materiality: 'MATERIAL',
  }, boundedPolicy);
  const secondObservation = observation({ eventId: 'bounded-2', dedupKey: 'bounded-2', observedAtMs: firstObservation.observedAtMs + 1 });
  assert.throws(() => admitObservation(first.state, {
    observation: secondObservation,
    admissionAtMs: secondObservation.observedAtMs,
    severitySignals,
    depthSignals,
    rootFingerprint: null,
    materiality: 'MATERIAL',
  }, boundedPolicy), /receipt capacity/u);
  const replay = admitObservation(first.state, {
    observation: firstObservation,
    admissionAtMs: firstObservation.observedAtMs,
    severitySignals,
    depthSignals,
    rootFingerprint: null,
    materiality: 'MATERIAL',
  }, boundedPolicy);
  assert.equal(replay.projection.disposition, 'DEDUPLICATED');
});

test('future observations are refused without poisoning unrelated admission time', () => {
  const normal = observation({ eventId: 'normal-time', observedAtMs: 1_700_000_010_000 });
  const state = admit(createAdmissionState(policy.policyRevision), normal).state;
  const future = observation({
    eventId: 'future-time',
    eventType: 'future-type',
    message: 'future poisoned observation',
    observedAtMs: 4_102_444_800_000,
    occurredAtMs: 4_102_444_799_000,
  });
  assert.throws(() => admitObservation(state, {
    observation: future,
    admissionAtMs: normal.observedAtMs + 1,
    severitySignals,
    depthSignals,
    rootFingerprint: null,
    materiality: 'MATERIAL',
  }, policy), /future observation/u);
  const unrelated = observation({
    eventId: 'unrelated-after-future',
    eventType: 'unrelated-type',
    message: 'unrelated normal observation',
    observedAtMs: normal.observedAtMs + 2,
    occurredAtMs: normal.occurredAtMs,
  });
  assert.equal(admit(state, unrelated).state.fingerprints.length, 2);
});

test('self-digested normalized observations cannot bypass canonical template or reason-code representation', () => {
  const normalized = observation({ reasonCodes: ['A_REASON', 'B_REASON'] });
  const reseal = (overrides) => {
    const candidate = { ...normalized, ...overrides };
    const { contentDigest: _contentDigest, schema: _schema, shadowStatus: _status, ...content } = candidate;
    return { ...candidate, contentDigest: sha256(canonicalJson(content)) };
  };
  for (const forged of [
    reseal({ reasonCodes: ['B_REASON', 'A_REASON'] }),
    reseal({ reasonCodes: ['A_REASON', 'A_REASON', 'B_REASON'] }),
    reseal({ template: 'Worker 123 failed' }),
  ]) {
    assert.throws(
      () => admit(createAdmissionState(policy.policyRevision), forged),
      /not canonical/u,
    );
  }
});

test('dedup compares delayed observations against every retained bounded occurrence', () => {
  const start = 1_700_000_010_000;
  let state = admit(createAdmissionState(policy.policyRevision), observation({
    eventId: 'historical-dedup-a', dedupKey: 'historical-dedup-a', observedAtMs: start,
  })).state;
  state = admit(state, observation({
    eventId: 'historical-dedup-b', dedupKey: 'historical-dedup-b', observedAtMs: start + 2_000,
  })).state;
  const delayed = admit(state, observation({
    eventId: 'historical-dedup-delayed', dedupKey: 'historical-dedup-delayed', observedAtMs: start + 500,
  }));
  assert.equal(delayed.projection.disposition, 'DEDUPLICATED');
  assert.equal(delayed.state.fingerprints[0].lastObservedAtMs, start + 2_000);
});

test('expired cooldown remains a historical boundary without poisoning later state', () => {
  const first = admit(createAdmissionState(policy.policyRevision), observation({ eventId: 'cooldown-history-first' }));
  const resolvedAt = first.state.fingerprints[0].lastObservedAtMs + 100;
  let state = markFingerprintResolved(first.state, first.projection.fingerprint, resolvedAt, policy);
  const expiry = resolvedAt + policy.cooldownMs;
  state = admit(state, observation({ eventId: 'cooldown-history-post', observedAtMs: expiry + 1 })).state;
  assert.doesNotThrow(() => admit(state, observation({ eventId: 'cooldown-history-followup', observedAtMs: expiry + 2_002 })));
  const delayed = admit(state, observation({ eventId: 'cooldown-history-delayed', observedAtMs: resolvedAt + 4_000 }));
  assert.equal(delayed.projection.disposition, 'COOLDOWN_SUPPRESSED');
});

test('storm parent identity is canonical on resume and converges across delivery permutations', () => {
  const stormPolicy = { ...policy, stormThreshold: 3, stormWindowMs: 20_000 };
  const run = (order) => {
    let state = createAdmissionState(stormPolicy.policyRevision);
    for (const index of order) {
      const normalized = observation({
        eventId: `permuted-storm-${index}`,
        eventType: `permuted-storm-type-${index}`,
        message: `permuted storm message ${index}`,
        observedAtMs: 1_700_000_020_000 + index,
      });
      state = admitObservation(state, {
        observation: normalized,
        admissionAtMs: normalized.observedAtMs,
        severitySignals,
        depthSignals,
        rootFingerprint: null,
        materiality: 'MATERIAL',
      }, stormPolicy).state;
    }
    return state;
  };
  const chronological = run([1, 2, 3, 4]);
  const permuted = run([2, 3, 4, 1]);
  assert.deepEqual(chronological.stormParents[0], permuted.stormParents[0]);
  const forged = {
    ...chronological,
    stormParents: [{ ...chronological.stormParents[0], parentId: 'forged-storm-parent' }],
  };
  const next = observation({
    eventId: 'permuted-storm-next', eventType: 'permuted-storm-type-next',
    message: 'permuted storm message next', observedAtMs: 1_700_000_020_010,
  });
  assert.throws(() => admitObservation(forged, {
    observation: next,
    admissionAtMs: next.observedAtMs,
    severitySignals,
    depthSignals,
    rootFingerprint: null,
    materiality: 'MATERIAL',
  }, stormPolicy), /identity is not canonical/u);
});

test('resume rejects forged or duplicate storm rows that are not one-to-one with fingerprint source receipts', () => {
  const first = admit(createAdmissionState(policy.policyRevision), observation({
    eventId: 'storm-receipt-real',
    dedupKey: 'storm-receipt-real',
    eventType: 'storm-receipt-real-type',
    message: 'real storm receipt observation',
  }));
  const retained = first.state.stormObservations[0];
  const incoming = observation({
    eventId: 'storm-receipt-incoming',
    dedupKey: 'storm-receipt-incoming',
    eventType: 'storm-receipt-incoming-type',
    message: 'incoming storm receipt observation',
    observedAtMs: retained.observedAtMs + 2,
  });
  const admitForged = (stormObservations) => admitObservation({
    ...first.state,
    stormObservations,
  }, {
    observation: incoming,
    admissionAtMs: incoming.observedAtMs,
    severitySignals,
    depthSignals,
    rootFingerprint: null,
    materiality: 'MATERIAL',
  }, policy);
  assert.throws(() => admitForged([
    retained,
    {
      ...retained,
      eventId: 'storm-receipt-forged',
      observedAtMs: retained.observedAtMs + 1,
      sourceEventKey: 'a2-source-event:forged-threshold-receipt',
    },
  ]), /not backed by its canonical source-event receipt/u);
  assert.throws(() => admitForged([
    retained,
    { ...retained, eventId: 'storm-receipt-duplicate' },
  ]), /source-event receipts must be unique/u);
});

test('storm rows cannot pool canonical receipts from unrelated components into a false threshold', () => {
  const base = 1_700_000_025_000;
  const componentA = observation({
    eventId: 'component-pool-a',
    dedupKey: 'component-pool-a',
    eventType: 'component-pool-type-a',
    componentId: 'synthetic-component-a',
    message: 'component pool alpha',
    observedAtMs: base,
  });
  const componentB = observation({
    eventId: 'component-pool-b',
    dedupKey: 'component-pool-b',
    eventType: 'component-pool-type-b',
    componentId: 'synthetic-component-b',
    message: 'component pool beta',
    observedAtMs: base + 1,
  });
  let state = admit(createAdmissionState(policy.policyRevision), componentA).state;
  state = admit(state, componentB).state;
  const forged = {
    ...state,
    stormObservations: state.stormObservations.map((entry) => entry.componentId === componentA.componentId
      ? { ...entry, componentId: componentB.componentId }
      : entry),
  };
  const incoming = observation({
    eventId: 'component-pool-incoming',
    dedupKey: 'component-pool-incoming',
    eventType: 'component-pool-type-incoming',
    componentId: componentB.componentId,
    message: 'component pool incoming',
    observedAtMs: base + 2,
  });
  assert.throws(() => admit(forged, incoming), /not backed by its canonical source-event receipt/u);
});

test('storm parent activation and latest time must remain backed by durable component receipts', () => {
  const stormPolicy = { ...policy, stormThreshold: 2 };
  const firstObservation = observation({
    eventId: 'parent-time-first', dedupKey: 'parent-time-first',
    eventType: 'parent-time-first-type', message: 'parent time first',
  });
  let state = admitObservation(createAdmissionState(stormPolicy.policyRevision), {
    observation: firstObservation,
    admissionAtMs: firstObservation.observedAtMs,
    severitySignals,
    depthSignals,
    rootFingerprint: null,
    materiality: 'MATERIAL',
  }, stormPolicy).state;
  const secondObservation = observation({
    eventId: 'parent-time-second', dedupKey: 'parent-time-second',
    eventType: 'parent-time-second-type', message: 'parent time second',
    observedAtMs: firstObservation.observedAtMs + 1,
  });
  state = admitObservation(state, {
    observation: secondObservation,
    admissionAtMs: secondObservation.observedAtMs,
    severitySignals,
    depthSignals,
    rootFingerprint: null,
    materiality: 'MATERIAL',
  }, stormPolicy).state;
  const nextObservation = observation({
    eventId: 'parent-time-next', dedupKey: 'parent-time-next',
    eventType: 'parent-time-next-type', message: 'parent time next',
    observedAtMs: secondObservation.observedAtMs + 1,
  });
  const admitParent = (parent) => admitObservation({ ...state, stormParents: [parent] }, {
    observation: nextObservation,
    admissionAtMs: nextObservation.observedAtMs,
    severitySignals,
    depthSignals,
    rootFingerprint: null,
    materiality: 'MATERIAL',
  }, stormPolicy);
  assert.throws(() => admitParent({
    ...state.stormParents[0],
    activatedAtMs: firstObservation.observedAtMs - 1,
  }), /activation is not backed/u);
  assert.throws(() => admitParent({
    ...state.stormParents[0],
    lastObservedAtMs: secondObservation.observedAtMs + 100,
  }), /latest durable source-event receipt/u);
});

test('same raw event ID across sources retains distinct canonical storm receipts in every delivery permutation', () => {
  const collisionPolicy = { ...policy, stormThreshold: 2, maximumStormChildren: 3 };
  const base = 1_700_000_030_000;
  const events = ['alpha', 'beta', 'gamma', 'delta'].map((suffix, index) => observation({
    source: `synthetic-collision-source-${suffix}`,
    eventId: 'shared-cross-source-event-id',
    dedupKey: `cross-source-${suffix}`,
    eventType: `cross-source-type-${suffix}`,
    message: `cross source storm signature ${suffix}`,
    observedAtMs: base + index,
  }));
  const run = (order) => {
    let state = createAdmissionState(collisionPolicy.policyRevision);
    for (const index of order) {
      state = admitObservation(state, {
        observation: events[index],
        admissionAtMs: base + 10,
        severitySignals,
        depthSignals,
        rootFingerprint: null,
        materiality: 'MATERIAL',
      }, collisionPolicy).state;
    }
    return admitObservation(state, {
      observation: events[3],
      admissionAtMs: base + 10,
      severitySignals,
      depthSignals,
      rootFingerprint: null,
      materiality: 'MATERIAL',
    }, collisionPolicy);
  };
  const chronological = run([0, 1, 2]);
  const permuted = run([2, 0, 1]);
  assert.equal(chronological.projection.disposition, 'STORM_CHILD');
  assert.equal(permuted.projection.disposition, 'STORM_CHILD');
  assert.equal(chronological.state.stormObservations.length, collisionPolicy.maximumStormChildren);
  assert.equal(new Set(chronological.state.stormObservations.map((entry) => entry.sourceEventKey)).size, collisionPolicy.maximumStormChildren);
  assert.deepEqual(chronological.state.stormObservations, permuted.state.stormObservations);
  assert.deepEqual(chronological.state.stormParents, permuted.state.stormParents);
  assert.ok(chronological.state.stormObservations.every((entry) => entry.eventId === 'shared-cross-source-event-id'));
});

test('post-normalization message expansion is bounded', () => {
  const expanding = '\uFDFA'.repeat(4_000);
  assert.ok(Buffer.byteLength(expanding, 'utf8') < 16_384);
  assert.throws(() => observation({ eventId: 'nfkc-expansion', message: expanding }), /bounded text|byte bound/u);
});

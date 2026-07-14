import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FROZEN_PROTOCOL_SCHEMA_TEXT,
  buildActionableAssessment,
  canonicalFrame,
  cloneFrozenFixture,
  cloneJson,
} from '../fixtures/protocol-fixtures.mjs';

const {
  EdgeProtocolProjectionGuard,
  EdgeProtocolV1Client,
  createEdgeProtocolSchemaRuntime,
  evaluateLocalTransport,
  validateLocalProtocolEndpoint,
} = await import('../../../dist/liveEdge/index.js');

const NOW = 1_783_949_000_000;
const RETENTION_MS = 60_000;
const POLICY = 'L_ADAPTER_POLICY_V1';
const schemaRuntime = createEdgeProtocolSchemaRuntime(FROZEN_PROTOCOL_SCHEMA_TEXT);

function client() {
  return new EdgeProtocolV1Client(schemaRuntime);
}

function guard(capacity = 32) {
  return new EdgeProtocolProjectionGuard(client(), capacity, RETENTION_MS);
}

function frozenEnvelope(name) {
  return cloneFrozenFixture(name).envelope;
}

function outcome(overrides = {}) {
  return {
    ...frozenEnvelope('outcome-control-cohort'),
    ...cloneJson(overrides),
  };
}

function feedback(overrides = {}) {
  return {
    ...frozenEnvelope('feedback-dedup'),
    ...cloneJson(overrides),
  };
}

function observe(projectionGuard, envelope, origin = 'CANONICAL_OPERATIONAL_PROJECTION', nowMs = NOW) {
  return projectionGuard.observeOutbound(canonicalFrame(envelope), nowMs, origin);
}

function loopback(url) {
  return { kind: 'LOOPBACK_HTTP', url, adapterPolicy: POLICY };
}

function unixSocket(path) {
  return { kind: 'UNIX_SOCKET', path, adapterPolicy: POLICY };
}

test('frozen outcome and feedback projections are accepted in their outbound direction', () => {
  const projectionGuard = guard();

  assert.deepEqual(observe(projectionGuard, outcome()), {
    kind: 'ACCEPTED',
    schema: 'EdgeOutcomeEnvelopeV1',
    identity: 'oc_0001',
    revision: 0,
    reasonCode: 'CANONICAL_PROJECTION_ACCEPTED',
  });
  assert.deepEqual(observe(projectionGuard, feedback()), {
    kind: 'ACCEPTED',
    schema: 'EdgeFeedbackEnvelopeV1',
    identity: 'oc_0001.r1',
    revision: 0,
    reasonCode: 'CANONICAL_PROJECTION_ACCEPTED',
  });
  assert.deepEqual(projectionGuard.identitySnapshot(), {
    capacity: 32,
    retained: 2,
    highWatermark: 2,
    accepted: 2,
    duplicates: 0,
    conflicts: 0,
    staleRevisions: 0,
    capacityBlocks: 0,
    pruned: 0,
    poisoned: 0,
  });
});

test('outcome and feedback duplicate identity is bound to the canonical decoded body', () => {
  const outcomeGuard = guard();
  const firstOutcome = outcome();
  assert.equal(observe(outcomeGuard, firstOutcome).kind, 'ACCEPTED');
  assert.deepEqual(observe(outcomeGuard, firstOutcome), {
    kind: 'DUPLICATE_NOOP',
    schema: 'EdgeOutcomeEnvelopeV1',
    identity: 'oc_0001',
    revision: 0,
    reasonCode: 'IDENTICAL_REDELIVERY',
  });

  const sameDeclaredHashGuard = guard();
  assert.equal(observe(sameDeclaredHashGuard, firstOutcome).kind, 'ACCEPTED');
  const changedOutcomeWithSameHash = outcome({
    decisionLineage: { modelVersion: 'md_same_bound_redelivery' },
  });
  assert.deepEqual(observe(sameDeclaredHashGuard, changedOutcomeWithSameHash), {
    kind: 'IDENTITY_CONFLICT',
    schema: 'EdgeOutcomeEnvelopeV1',
    identity: 'oc_0001',
    revision: 0,
    reasonCode: 'ASSESSMENT_IDENTITY_CONFLICT',
  });

  const changedHashGuard = guard();
  assert.equal(observe(changedHashGuard, firstOutcome).kind, 'ACCEPTED');
  const outcomeConflict = outcome({ contentHash: '1111111111111111' });
  assert.deepEqual(observe(changedHashGuard, outcomeConflict), {
    kind: 'IDENTITY_CONFLICT',
    schema: 'EdgeOutcomeEnvelopeV1',
    identity: 'oc_0001',
    revision: 0,
    reasonCode: 'ASSESSMENT_IDENTITY_CONFLICT',
  });

  const feedbackGuard = guard();
  const firstFeedback = feedback();
  assert.equal(observe(feedbackGuard, firstFeedback).kind, 'ACCEPTED');
  assert.deepEqual(observe(feedbackGuard, firstFeedback), {
    kind: 'DUPLICATE_NOOP',
    schema: 'EdgeFeedbackEnvelopeV1',
    identity: 'oc_0001.r1',
    revision: 0,
    reasonCode: 'IDENTICAL_REDELIVERY',
  });

  const sameDeclaredPayloadGuard = guard();
  assert.equal(observe(sameDeclaredPayloadGuard, firstFeedback).kind, 'ACCEPTED');
  const changedFeedbackWithSameHash = feedback({ projection: { cohort: 'REJECTED' } });
  assert.deepEqual(observe(sameDeclaredPayloadGuard, changedFeedbackWithSameHash), {
    kind: 'IDENTITY_CONFLICT',
    schema: 'EdgeFeedbackEnvelopeV1',
    identity: 'oc_0001.r1',
    revision: 0,
    reasonCode: 'ASSESSMENT_IDENTITY_CONFLICT',
  });

  const changedPayloadHashGuard = guard();
  assert.equal(observe(changedPayloadHashGuard, firstFeedback).kind, 'ACCEPTED');
  const feedbackConflict = feedback({ payloadHash: '2222222222222222' });
  assert.deepEqual(observe(changedPayloadHashGuard, feedbackConflict), {
    kind: 'IDENTITY_CONFLICT',
    schema: 'EdgeFeedbackEnvelopeV1',
    identity: 'oc_0001.r1',
    revision: 0,
    reasonCode: 'ASSESSMENT_IDENTITY_CONFLICT',
  });
});

test('higher revisions advance, lower revisions are stale, and immutable-route drift poisons identity', () => {
  const revisionGuard = guard();
  const revisionOne = outcome({ revision: 1, contentHash: '1111111111111111' });
  const revisionThree = outcome({ revision: 3, contentHash: '3333333333333333' });
  const revisionTwo = outcome({ revision: 2, contentHash: '2222222222222222' });

  assert.equal(observe(revisionGuard, revisionOne).kind, 'ACCEPTED');
  assert.deepEqual(observe(revisionGuard, revisionThree), {
    kind: 'ACCEPTED',
    schema: 'EdgeOutcomeEnvelopeV1',
    identity: 'oc_0001',
    revision: 3,
    reasonCode: 'CANONICAL_PROJECTION_ACCEPTED',
  });
  assert.deepEqual(observe(revisionGuard, revisionTwo), {
    kind: 'REVISION_STALE',
    schema: 'EdgeOutcomeEnvelopeV1',
    identity: 'oc_0001',
    revision: 2,
    reasonCode: 'ASSESSMENT_REVISION_STALE',
  });

  const routeConflictGuard = guard();
  assert.equal(observe(routeConflictGuard, revisionOne).kind, 'ACCEPTED');
  const changedTrace = outcome({
    revision: 2,
    traceId: 'tr_changed_route',
    contentHash: '4444444444444444',
  });
  assert.deepEqual(observe(routeConflictGuard, changedTrace), {
    kind: 'IDENTITY_CONFLICT',
    schema: 'EdgeOutcomeEnvelopeV1',
    identity: 'oc_0001',
    revision: 2,
    reasonCode: 'ASSESSMENT_ROUTE_IDENTITY_CONFLICT',
  });
  assert.equal(routeConflictGuard.identitySnapshot().poisoned, 1);
});

test('projection direction and declared origin are enforced before outbound acceptance', () => {
  const projectionGuard = guard();
  const assessment = buildActionableAssessment(NOW);

  assert.deepEqual(observe(projectionGuard, assessment), {
    kind: 'INVALID',
    schema: 'EdgeAssessmentEnvelopeV1',
    identity: null,
    revision: 0,
    reasonCode: 'PROJECTION_DIRECTION_INVALID',
  });
  assert.deepEqual(
    observe(projectionGuard, outcome({ outcomeId: 'oc_synthetic_origin' }), 'SYNTHETIC_TEST_FIXTURE'),
    {
      kind: 'ACCEPTED',
      schema: 'EdgeOutcomeEnvelopeV1',
      identity: 'oc_synthetic_origin',
      revision: 0,
      reasonCode: 'CANONICAL_PROJECTION_ACCEPTED',
    },
  );
  assert.throws(
    () => observe(projectionGuard, outcome(), 'REMOTE_RESEARCH_BRAIN'),
    /projection origin is invalid/i,
  );
});

test('outbound projection sanitization rejects private markers anywhere and unknown L open keys', () => {
  const cases = [
    {
      name: 'account key',
      envelope: outcome({ pnlAttribution: { accountBalance: '10.00000000' } }),
    },
    {
      name: 'private sentinel value',
      envelope: outcome({ decisionLineage: { modelVersion: 'private_sentinel' } }),
    },
    {
      name: 'private marker outside open projection maps',
      envelope: outcome({ sourceEventIds: ['account_id'] }),
    },
    {
      name: 'unknown outcome key',
      envelope: outcome({ decisionLineage: { unapprovedResearchField: 'bounded' } }),
    },
    {
      name: 'unknown feedback key',
      envelope: feedback({ projection: { experimentalScore: '0.4' } }),
    },
  ];

  for (const fixture of cases) {
    const decoded = client().decode(canonicalFrame(fixture.envelope), NOW);
    assert.equal(decoded.ok, true, `${fixture.name} remains open under the frozen schema`);
    assert.equal(
      observe(guard(), fixture.envelope).reasonCode,
      'PROJECTION_SANITIZATION_FAILED',
      fixture.name,
    );
  }
});

test('decoded outcome values preserve REAL and HYPOTHETICAL labels without coercion', () => {
  const hypothetical = outcome({
    outcomeId: 'oc_hypothetical',
    labelKind: 'HYPOTHETICAL',
    contentHash: 'aaaaaaaaaaaaaaaa',
  });
  const real = outcome({
    outcomeId: 'oc_real',
    cohort: 'ACTED',
    labelKind: 'REAL',
    contentHash: 'bbbbbbbbbbbbbbbb',
  });

  const decodedHypothetical = client().decode(canonicalFrame(hypothetical), NOW);
  const decodedReal = client().decode(canonicalFrame(real), NOW);
  assert.equal(decodedHypothetical.ok, true);
  assert.equal(decodedReal.ok, true);
  assert.equal(decodedHypothetical.envelope.value.labelKind, 'HYPOTHETICAL');
  assert.equal(decodedReal.envelope.value.labelKind, 'REAL');

  const projectionGuard = guard();
  assert.equal(observe(projectionGuard, hypothetical).kind, 'ACCEPTED');
  assert.equal(observe(projectionGuard, real).kind, 'ACCEPTED');
});

test('loopback HTTP endpoint requires the raw literal host and rejects localhost aliases', () => {
  assert.deepEqual(validateLocalProtocolEndpoint(loopback('http://127.0.0.1:4321/edge/v1')), {
    kind: 'LOOPBACK_HTTP',
    url: 'http://127.0.0.1:4321/edge/v1',
    adapterPolicy: POLICY,
  });

  for (const url of [
    'http://localhost:4321/edge/v1',
    'http://[::1]:4321/edge/v1',
    'http://127.0.0.2:4321/edge/v1',
    'http://127.1:4321/edge/v1',
    'http://2130706433:4321/edge/v1',
    'http://0x7f000001:4321/edge/v1',
  ]) {
    assert.throws(() => validateLocalProtocolEndpoint(loopback(url)), TypeError, url);
  }
});

test('loopback HTTP endpoint rejects userinfo, query, fragment, missing port, and path traversal', () => {
  const invalid = [
    'http://user@127.0.0.1:4321/edge/v1',
    'http://user:password@127.0.0.1:4321/edge/v1',
    'http://127.0.0.1:4321/edge/v1?mode=local',
    'http://127.0.0.1:4321/edge/v1#fragment',
    'http://127.0.0.1/edge/v1',
    'http://127.0.0.1:4321/a/../edge/v1',
    'http://127.0.0.1:4321/a/%2e%2e/edge/v1',
  ];

  for (const url of invalid) {
    assert.throws(() => validateLocalProtocolEndpoint(loopback(url)), TypeError, url);
  }
});

test('Unix socket endpoints enforce absolute path, traversal, NUL, and exact length bounds', () => {
  const shortest = '/a';
  const longest = `/${'a'.repeat(99)}`;
  assert.deepEqual(validateLocalProtocolEndpoint(unixSocket(shortest)), {
    kind: 'UNIX_SOCKET', path: shortest, adapterPolicy: POLICY,
  });
  assert.deepEqual(validateLocalProtocolEndpoint(unixSocket(longest)), {
    kind: 'UNIX_SOCKET', path: longest, adapterPolicy: POLICY,
  });

  for (const path of [
    '/',
    `/${'a'.repeat(100)}`,
    'relative/edge.sock',
    '/tmp/../edge.sock',
    '/tmp/\0edge.sock',
  ]) {
    assert.throws(() => validateLocalProtocolEndpoint(unixSocket(path)), /absolute bounded path without traversal/i, path);
  }
});

test('local endpoints require plain data objects with exact discriminated fields', () => {
  assert.throws(
    () => validateLocalProtocolEndpoint({ ...loopback('http://127.0.0.1:4321/edge/v1'), extra: true }),
    /exact adapter contract/i,
  );
  assert.throws(
    () => validateLocalProtocolEndpoint(Object.assign(Object.create({ inherited: true }), unixSocket('/tmp/edge.sock'))),
    /plain object/i,
  );
  let getterRead = false;
  const accessor = { kind: 'LOOPBACK_HTTP', adapterPolicy: POLICY };
  Object.defineProperty(accessor, 'url', {
    enumerable: true,
    get() {
      getterRead = true;
      return 'http://127.0.0.1:4321/edge/v1';
    },
  });
  assert.throws(() => validateLocalProtocolEndpoint(accessor), /plain data fields/i);
  assert.equal(getterRead, false);
});

test('local transport starts UNKNOWN and preserves declared connected, disconnected, and failed state', () => {
  assert.deepEqual(evaluateLocalTransport(null, NOW, 1_000), {
    state: 'UNKNOWN',
    observedAtMs: null,
    requestStartedAtMs: null,
    requestCompletedAtMs: null,
    reasonCode: 'TRANSPORT_UNOBSERVED',
  });

  for (const [state, reasonCode] of [
    ['CONNECTED', 'TRANSPORT_CONNECTED'],
    ['DISCONNECTED', 'LOCAL_PEER_CLOSED'],
    ['FAILED', 'LOCAL_PROTOCOL_FAILURE'],
  ]) {
    const observation = {
      state,
      observedAtMs: NOW - 10,
      requestStartedAtMs: NOW - 20,
      requestCompletedAtMs: NOW - 10,
      reasonCode: state === 'CONNECTED' ? null : reasonCode,
    };
    const effective = evaluateLocalTransport(observation, NOW, 1_000);
    assert.deepEqual(effective, { ...observation, reasonCode });
    assert.equal(Object.isFrozen(effective), true);
  }
});

test('incomplete local request becomes TIMED_OUT at the exact timeout instant', () => {
  const timeoutMs = 1_000;
  const requestStartedAtMs = NOW - timeoutMs;
  const pending = {
    state: 'CONNECTED',
    observedAtMs: requestStartedAtMs,
    requestStartedAtMs,
    requestCompletedAtMs: null,
    reasonCode: null,
  };

  assert.deepEqual(evaluateLocalTransport(pending, NOW - 1, timeoutMs), {
    ...pending,
    reasonCode: 'TRANSPORT_CONNECTED',
  });
  assert.deepEqual(evaluateLocalTransport(pending, NOW, timeoutMs), {
    state: 'TIMED_OUT',
    observedAtMs: requestStartedAtMs,
    requestStartedAtMs,
    requestCompletedAtMs: null,
    reasonCode: 'TRANSPORT_REQUEST_TIMEOUT',
  });

  const completedAtDeadline = {
    ...pending,
    observedAtMs: NOW,
    requestCompletedAtMs: NOW,
  };
  assert.deepEqual(evaluateLocalTransport(completedAtDeadline, NOW, timeoutMs), {
    ...completedAtDeadline,
    reasonCode: 'TRANSPORT_CONNECTED',
  });
});

test('transport chronology is start <= completion <= observation <= injected now', () => {
  const validBoundary = {
    state: 'CONNECTED',
    observedAtMs: NOW,
    requestStartedAtMs: NOW,
    requestCompletedAtMs: NOW,
    reasonCode: null,
  };
  assert.deepEqual(evaluateLocalTransport(validBoundary, NOW, 1_000), {
    ...validBoundary,
    reasonCode: 'TRANSPORT_CONNECTED',
  });

  const invalid = [
    {
      name: 'future start',
      observation: { ...validBoundary, requestStartedAtMs: NOW + 1, requestCompletedAtMs: null },
      match: /start cannot be from the future/i,
    },
    {
      name: 'future completion',
      observation: { ...validBoundary, requestCompletedAtMs: NOW + 1 },
      match: /completion cannot be from the future/i,
    },
    {
      name: 'observation before start',
      observation: {
        ...validBoundary,
        observedAtMs: NOW - 2,
        requestStartedAtMs: NOW - 1,
        requestCompletedAtMs: null,
      },
      match: /observation cannot precede request start/i,
    },
    {
      name: 'completion before start',
      observation: {
        ...validBoundary,
        requestStartedAtMs: NOW - 1,
        requestCompletedAtMs: NOW - 2,
      },
      match: /completion cannot precede request start/i,
    },
    {
      name: 'observation before completion',
      observation: {
        ...validBoundary,
        observedAtMs: NOW - 2,
        requestStartedAtMs: NOW - 3,
        requestCompletedAtMs: NOW - 1,
      },
      match: /observation cannot precede request completion/i,
    },
    {
      name: 'completion without start',
      observation: { ...validBoundary, requestStartedAtMs: null },
      match: /completed request requires a start time/i,
    },
  ];
  for (const fixture of invalid) {
    assert.throws(
      () => evaluateLocalTransport(fixture.observation, NOW, 1_000),
      fixture.match,
      fixture.name,
    );
  }
});

test('transport observations require exact plain data fields and validate reasons before timeout projection', () => {
  const pending = {
    state: 'CONNECTED',
    observedAtMs: NOW - 2_000,
    requestStartedAtMs: NOW - 2_000,
    requestCompletedAtMs: null,
    reasonCode: null,
  };
  assert.throws(
    () => evaluateLocalTransport({ ...pending, extra: true }, NOW, 1_000),
    /exact adapter contract/i,
  );
  assert.throws(
    () => evaluateLocalTransport(Object.assign(Object.create({ inherited: true }), pending), NOW, 1_000),
    /plain object/i,
  );
  assert.throws(
    () => evaluateLocalTransport({ ...pending, reasonCode: 'not_upper_snake' }, NOW, 1_000),
    /reasonCode must be null or UPPER_SNAKE/i,
  );

  let getterRead = false;
  const accessor = { ...pending };
  Object.defineProperty(accessor, 'state', {
    enumerable: true,
    get() {
      getterRead = true;
      return 'CONNECTED';
    },
  });
  assert.throws(() => evaluateLocalTransport(accessor, NOW, 1_000), /plain data fields/i);
  assert.equal(getterRead, false);
});

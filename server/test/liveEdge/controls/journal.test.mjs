import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildControlEvent,
  confirmControlEventAppend,
  prepareControlEventAppend,
} from '../../../dist/liveEdge/controls/index.js';
import { createHarness } from './fixtures.mjs';

function event() {
  return buildControlEvent({
    schema: 'LIVE_EDGE_CONTROL_EVENT_V1',
    version: 1,
    kind: 'CONTROL_REJECTED',
    commandId: 'cmd_aaaaaaaaaaaaaaaa',
    previewDigest: `sha256:${'b'.repeat(64)}`,
    actionType: 'PAUSE_INTAKE',
    actorBinding: `l14actor_${'c'.repeat(64)}`,
    expectedConfigVersion: 11,
    expectedControlRevision: 7,
    occurredAtMs: 1_720_000_000_000,
    reasonCode: 'COMMAND_EXPIRED',
    redacted: true,
    intentCommitted: false,
    recoveryStateChanged: false,
    externalActionAuthorization: 'NONE',
  });
}

test('closed event append binds version, previous/next head, digest, and exact ACK', () => {
  const harness = createHarness();
  const request = prepareControlEventAppend(event(), 0, null);
  const ack = harness.makeAck(request, 'COMMITTED_NEW', {
    ledgerEventId: 77,
    committedAtMs: request.event.occurredAtMs,
  });
  const confirmed = confirmControlEventAppend(request, ack);
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.ledgerEventId, 77);
  assert.equal(confirmed.committedJournalVersion, 1);
  assert.equal(confirmed.committedHeadDigest, request.nextHeadDigest);
});

test('malformed, stale, forged, partial, failed, and conflicting ACKs fail closed', () => {
  const harness = createHarness();
  const request = prepareControlEventAppend(event(), 0, null);
  const valid = harness.makeAck(request, 'COMMITTED_NEW', {
    ledgerEventId: 77,
    committedAtMs: request.event.occurredAtMs,
  });
  const cases = [
    { ...valid, appendRequestDigest: `sha256:${'0'.repeat(64)}` },
    { ...valid, committedHeadDigest: `l14head_${'0'.repeat(64)}` },
    { ...valid, committedJournalVersion: 2 },
    { ...valid, ledgerEventId: null },
    { ...valid, appendedCount: 0 },
    harness.makeAck(request, 'FAILED', { failureCode: 'PERSISTENCE_UNAVAILABLE' }),
    harness.makeAck(request, 'IDEMPOTENCY_CONFLICT', { failureCode: 'IDEMPOTENCY_CONFLICT' }),
    harness.makeAck(request, 'VERSION_CONFLICT', { failureCode: 'STALE_CONTROL_REVISION' }),
    harness.makeAck(request, 'EXPIRED', { failureCode: 'COMMAND_EXPIRED' }),
  ];
  for (const candidate of cases) assert.equal(confirmControlEventAppend(request, candidate).ok, false);
});

test('same event is deterministic and input mutation changes its content identity', () => {
  const first = event();
  const second = event();
  assert.deepEqual(first, second);
  const { eventId: _eventId, contentDigest: _contentDigest, ...draft } = first;
  const changed = buildControlEvent({
    ...draft,
    occurredAtMs: first.occurredAtMs + 1,
  });
  assert.notEqual(changed.eventId, first.eventId);
  assert.notEqual(changed.contentDigest, first.contentDigest);
});

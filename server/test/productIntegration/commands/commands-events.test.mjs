import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCommandDelegation } from '../../../dist/productIntegration/commands/index.js';
import { projectOperatorEventPage } from '../../../dist/productIntegration/supervisor/index.js';
import { OPERATOR_EVENT_FIXTURE, PRODUCT_FIXTURE_NOW_MS } from '../../../dist/productIntegration/fixtures/index.js';

const request = Object.freeze({
  commandId: 'command-1', commandType: 'component.restart', targetComponentId: 'basis-engine', idempotencyKey: 'idem-1',
  requestDigest: '0123456789abcdef0123456789abcdef', expectedRevision: 7,
  previewDigest: '11111111111111111111111111111111',
  createdAtMs: PRODUCT_FIXTURE_NOW_MS - 1_000, expiresAtMs: PRODUCT_FIXTURE_NOW_MS + 10_000, correlationId: 'trace-1',
  authenticatedOperatorId: 'operator-server-1', reason: 'bounded test restart', requiredAuthority: 'CONTROL_COMPONENT_RESTART', payload: Object.freeze({ generation: 1 }),
});

const before = Object.freeze({ revision: 7, projectionDigest: request.previewDigest, state: Object.freeze({ lifecycle: 'RUNNING' }) });
const after = Object.freeze({ revision: 8, projectionDigest: '22222222222222222222222222222222', state: Object.freeze({ lifecycle: 'RESTARTING' }) });
const canonicalPreview = Object.freeze({ requestDigest: request.requestDigest, previewDigest: request.previewDigest, currentRevision: 7, expiresAtMs: request.expiresAtMs, preview: before });

function project(overrides = {}) {
  return projectCommandDelegation({ request, canonicalPreview, nowMs: PRODUCT_FIXTURE_NOW_MS, supportedCommandIds: ['component.restart'], priorReceipts: [], ...overrides });
}

test('command preflight delegates supported current intent but never applies it', () => {
  const result = project();
  assert.equal(result.result, 'READY_FOR_CANONICAL_OWNER');
  assert.equal(result.maySubmitToCanonicalOwner, true);
  assert.equal(result.currentRevision, 7);
});

test('exact duplicate command returns canonical prior result', () => {
  const receipt = { commandId: 'command-1', idempotencyKey: 'idem-1', requestDigest: request.requestDigest, previewDigest: request.previewDigest, canonicalResult: 'APPLIED', beforeRevision: 7, resultingRevision: 8, correlationId: 'trace-1', ledgerReference: 'ledger-1', completedAtMs: PRODUCT_FIXTURE_NOW_MS, before, after };
  const result = project({ priorReceipts: [receipt] });
  assert.equal(result.result, 'ALREADY_APPLIED');
  assert.equal(result.canonicalResult, 'APPLIED');
  assert.equal(result.maySubmitToCanonicalOwner, false);
});

test('idempotency conflict, stale revision, expiry, and unsupported command fail closed', () => {
  const conflict = project({ priorReceipts: [{ commandId: 'other', idempotencyKey: 'idem-1', requestDigest: 'abcdefabcdefabcdefabcdefabcdefab', previewDigest: request.previewDigest, canonicalResult: 'APPLIED', beforeRevision: 7, resultingRevision: 8, correlationId: 'trace-1', ledgerReference: 'ledger-1', completedAtMs: PRODUCT_FIXTURE_NOW_MS, before, after }] });
  assert.equal(conflict.result, 'REJECTED_IDEMPOTENCY_CONFLICT');
  assert.equal(project({ canonicalPreview: { ...canonicalPreview, currentRevision: 8, preview: { ...before, revision: 8 } } }).result, 'REJECTED_STALE_REVISION');
  assert.equal(project({ canonicalPreview: { ...canonicalPreview, previewDigest: '9'.repeat(32), preview: { ...before, projectionDigest: '9'.repeat(32) } } }).result, 'REJECTED_PREVIEW_MISMATCH');
  assert.equal(project({ canonicalPreview: { ...canonicalPreview, requestDigest: '8'.repeat(32) } }).result, 'REJECTED_PREVIEW_MISMATCH');
  assert.equal(project({ canonicalPreview: { ...canonicalPreview, expiresAtMs: PRODUCT_FIXTURE_NOW_MS - 1 } }).result, 'EXPIRED');
  assert.equal(project({ nowMs: request.expiresAtMs + 1 }).result, 'EXPIRED');
  assert.equal(project({ nowMs: request.expiresAtMs }).result, 'EXPIRED');
  assert.equal(project({ request: { ...request, createdAtMs: PRODUCT_FIXTURE_NOW_MS + 1, expiresAtMs: PRODUCT_FIXTURE_NOW_MS + 10_000 } }).result, 'REJECTED_NOT_YET_VALID');
  assert.equal(project({ supportedCommandIds: [] }).result, 'REJECTED_NOT_SUPPORTED');
});

test('malformed or duplicate prior command receipts are rejected', () => {
  const receipt = { commandId: 'command-1', idempotencyKey: 'idem-1', requestDigest: request.requestDigest, previewDigest: request.previewDigest, canonicalResult: 'APPLIED', beforeRevision: 7, resultingRevision: 8, correlationId: 'trace-1', ledgerReference: 'ledger-1', completedAtMs: PRODUCT_FIXTURE_NOW_MS, before, after };
  assert.throws(() => project({ priorReceipts: [receipt, receipt] }), /duplicate idempotency/);
  assert.throws(() => project({ priorReceipts: [{ ...receipt, canonicalResult: 'MAGIC_SUCCESS' }] }), /invalid/);
  assert.throws(() => project({ priorReceipts: [{ ...receipt, before: { ...before, revision: 6 } }] }), /before projection/);
  assert.throws(() => project({ priorReceipts: [{ ...receipt, before: { ...before, projectionDigest: '3'.repeat(32) } }] }), /not bound/);
});

test('monotonic cursor keeps events that share the same millisecond', () => {
  const page = projectOperatorEventPage({ afterCursor: 40, durableFloorCursor: 1, limit: 10, events: OPERATOR_EVENT_FIXTURE });
  assert.equal(page.continuity, 'CONTINUOUS');
  assert.deepEqual(page.events.map((event) => event.cursor), [41, 42, 43]);
  assert.equal(new Set(page.events.map((event) => event.occurredAtMs)).size, 1);
  assert.equal(page.nextCursor, 43);
});

test('event page reports a gap instead of silently advancing', () => {
  const events = OPERATOR_EVENT_FIXTURE.filter((event) => event.cursor !== 42);
  const page = projectOperatorEventPage({ afterCursor: 41, durableFloorCursor: 1, limit: 10, events });
  assert.equal(page.continuity, 'GAP_REQUIRES_BACKFILL');
  assert.equal(page.missingFromCursor, 42);
  assert.equal(page.missingToCursor, 42);
  assert.deepEqual(page.events, []);
  assert.equal(page.nextCursor, 41);
});

test('event page reports an internal cursor gap after a continuous first event', () => {
  const events = [OPERATOR_EVENT_FIXTURE[0], OPERATOR_EVENT_FIXTURE[2]];
  const page = projectOperatorEventPage({ afterCursor: 40, durableFloorCursor: 1, limit: 10, events });
  assert.equal(page.continuity, 'GAP_REQUIRES_BACKFILL');
  assert.equal(page.missingFromCursor, 42);
  assert.equal(page.missingToCursor, 42);
  assert.deepEqual(page.events.map((event) => event.cursor), [41]);
  assert.equal(page.nextCursor, 41);
});

test('event page reports durable truncation and bounded pagination', () => {
  const truncated = projectOperatorEventPage({ afterCursor: 10, durableFloorCursor: 41, limit: 1, events: OPERATOR_EVENT_FIXTURE });
  assert.equal(truncated.continuity, 'TRUNCATED_REQUIRES_BACKFILL');
  assert.equal(truncated.hasMore, true);
  assert.equal(truncated.events.length, 0);
  assert.equal(truncated.nextCursor, 10);
});

test('duplicate or non-monotonic event cursors are rejected', () => {
  assert.throws(() => projectOperatorEventPage({ afterCursor: 0, durableFloorCursor: 1, limit: 10, events: [OPERATOR_EVENT_FIXTURE[0], { ...OPERATOR_EVENT_FIXTURE[1], cursor: 41 }] }), /strictly increasing/);
});

test('operator event payloads reject secret-like and non-serializable data', () => {
  assert.throws(() => projectOperatorEventPage({ afterCursor: 40, durableFloorCursor: 1, limit: 10, events: [{ ...OPERATOR_EVENT_FIXTURE[0], payload: { apiSecret: 'never' } }] }), /secret-like/);
  assert.throws(() => projectOperatorEventPage({ afterCursor: 40, durableFloorCursor: 1, limit: 10, events: [{ ...OPERATOR_EVENT_FIXTURE[0], payload: { value: Number.NaN } }] }), /not serializable/);
});

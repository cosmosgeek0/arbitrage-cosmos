import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SYSTEM_PERSISTENCE_LIMITS,
  canonicalPersistenceJson,
  createInitialCheckpointState,
  decodeSystemCheckpoint,
  encodeSystemCheckpoint,
  validateCheckpointState,
} from '../../../dist/systemIntegration/persistence/index.js';

const T0 = 1_800_000_000_000;

test('checkpoint encoding is canonical, deterministic, immutable, and round-trips exactly', () => {
  const state = createInitialCheckpointState(T0, 'codec.canonical');
  const reversed = Object.fromEntries(Object.entries(state).reverse());
  const encoded = encodeSystemCheckpoint(state);
  assert.equal(encodeSystemCheckpoint(reversed), encoded);

  const decoded = decodeSystemCheckpoint(encoded);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.value, state);
  assert.equal(Object.isFrozen(decoded.value), true);
  assert.equal(Object.isFrozen(decoded.value.control), true);
});

test('checkpoint corruption, non-canonical bytes, unknown fields, and secret-shaped receipt fields fail closed', () => {
  const state = createInitialCheckpointState(T0, 'codec.corruption');
  const encoded = encodeSystemCheckpoint(state);
  const corrupt = JSON.parse(encoded);
  corrupt.state.control.safeMode = 'ADVISORY';
  const corruptResult = decodeSystemCheckpoint(canonicalPersistenceJson(corrupt));
  assert.equal(corruptResult.ok, false);
  assert.match(corruptResult.message, /checksum/i);

  const nonCanonical = JSON.stringify(JSON.parse(encoded), null, 2);
  const nonCanonicalResult = decodeSystemCheckpoint(nonCanonical);
  assert.equal(nonCanonicalResult.ok, false);
  assert.match(nonCanonicalResult.message, /canonically/i);

  const unknown = JSON.parse(encoded);
  unknown.unreviewed = true;
  const unknownResult = decodeSystemCheckpoint(canonicalPersistenceJson(unknown));
  assert.equal(unknownResult.ok, false);
  assert.match(unknownResult.message, /unknown/i);

  const secretBearing = {
    ...state,
    revision: 1,
    idempotencyReceipts: [{
      idempotencyKey: 'codec.secret.0001',
      requestDigest: 'a'.repeat(64),
      correlationId: 'codec.secret',
      recordedAtMs: T0,
      checkpointRevision: 1,
      receipt: { apiSecret: 'must-never-persist' },
    }],
  };
  assert.throws(() => encodeSystemCheckpoint(secretBearing), /SECRET_FIELD_FORBIDDEN/);
});

test('JSON and checkpoint depth, count, duplicate-allocation, and byte bounds are enforced', () => {
  let deep = { leaf: true };
  for (let index = 0; index < SYSTEM_PERSISTENCE_LIMITS.maximumJsonDepth + 2; index += 1) deep = { next: deep };
  assert.throws(() => canonicalPersistenceJson(deep), /DEPTH_LIMIT_EXCEEDED/);

  const state = createInitialCheckpointState(T0, 'codec.bounds');
  const duplicateAllocation = {
    ...state,
    reservations: [
      {
        reservationId: 'reservation-1', allocationKey: 'allocation-1', ownerRevision: 'rev-1',
        domainState: 'RESERVED', blocksAllocation: true, correlationId: 'codec.bounds', updatedAtMs: T0,
      },
      {
        reservationId: 'reservation-2', allocationKey: 'allocation-1', ownerRevision: 'rev-2',
        domainState: 'RESERVED', blocksAllocation: true, correlationId: 'codec.bounds', updatedAtMs: T0,
      },
    ],
  };
  assert.ok(validateCheckpointState(duplicateAllocation).some((issue) => issue.includes('DUPLICATE_ID')));
  assert.throws(() => encodeSystemCheckpoint(duplicateAllocation), /DUPLICATE_ID/);

  assert.throws(
    () => canonicalPersistenceJson({ payload: 'x'.repeat(SYSTEM_PERSISTENCE_LIMITS.maximumCheckpointBytes) }),
    /STRING_LIMIT_EXCEEDED|CHECKPOINT_BYTE_LIMIT_EXCEEDED/,
  );
});

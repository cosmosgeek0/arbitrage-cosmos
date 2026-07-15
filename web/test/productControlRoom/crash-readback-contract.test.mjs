import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProductControlRoomFixture } from '../../src/features/productControlRoom/fixtureBinding.ts';
import {
  createFixtureSession,
  validateProductSupervisorEnvelope,
} from '../../src/lib/productIntegration/model.ts';
import {
  ProductBindingError,
  createProductIntegrationClient,
} from '../../src/lib/productIntegration/client.ts';

const NOW_MS = 1_800_000_000_000;
const TESTED_SHA = 'a'.repeat(40);
const DEPLOYED_SHA = 'b'.repeat(40);

function record(generation, lifecycleState, overrides = {}) {
  const completed = lifecycleState === 'CLEAN_COMPLETED' || lifecycleState === 'UNCLEAN_COMPLETED';
  const startedAtMs = NOW_MS - Math.max(1, 4 - generation) * 10_000;
  return {
    operationId: `system.application.boot.g${generation}`,
    operationType: 'APPLICATION_BOOT',
    generation,
    testedCommit: TESTED_SHA,
    deployedCommit: DEPLOYED_SHA,
    configRevision: 'crash-readback-config',
    schemaRevision: '1',
    modelRevision: 'crash-readback-model',
    startedAtMs,
    completedAtMs: completed ? startedAtMs + 5_000 : null,
    clean: lifecycleState === 'CLEAN_COMPLETED' ? true
      : lifecycleState === 'UNCLEAN_COMPLETED' ? false : null,
    blockerCode: lifecycleState === 'UNCLEAN_COMPLETED' ? 'PROCESS_EXIT_UNCLEAN' : null,
    correlationId: `system-boot-g${generation}`,
    ledgerEventId: generation * 10,
    lifecycleState,
    identityState: 'AVAILABLE',
    identityIssues: [],
    deploymentMutationAuthority: 'NONE',
    ...overrides,
  };
}

function validSnapshot() {
  const snapshot = structuredClone(buildProductControlRoomFixture(
    createFixtureSession('HEALTHY_OBSERVE', 'crash-readback-browser', NOW_MS),
  ));
  const active = record(3, 'ACTIVE');
  const crash = record(2, 'CRASH_PENDING');
  const clean = record(1, 'CLEAN_COMPLETED');
  snapshot.ownerView.revisions = {
    testedCommit: TESTED_SHA,
    deployedCommit: DEPLOYED_SHA,
    configRevision: 'crash-readback-config',
    modelRevision: 'crash-readback-model',
    schemaRevision: 'product-supervisor.v1',
  };
  snapshot.bootReleaseReadback = {
    source: 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE',
    state: 'AVAILABLE',
    latest: active,
    history: [active, crash, clean],
    crashPendingOperationIds: ['system.application.boot.g2'],
    reasonCodes: ['CRASH_PENDING_BOOT_PRESENT'],
  };
  return snapshot;
}

function assertInvalid(snapshot, code = 'BOOT_RELEASE_READBACK_INVALID') {
  assert.ok(validateProductSupervisorEnvelope(snapshot).includes(code), `expected ${code}`);
}

test('browser decoder and client preserve bounded canonical crash-pending history', async () => {
  const snapshot = validSnapshot();
  assert.deepEqual(validateProductSupervisorEnvelope(snapshot), []);

  const client = createProductIntegrationClient({ readSupervisor: async () => snapshot });
  const decoded = await client.readSupervisor();
  assert.equal(decoded, snapshot);
  const crash = decoded.bootReleaseReadback.history.find((entry) => entry.generation === 2);
  assert.deepEqual({
    operationId: crash.operationId,
    correlationId: crash.correlationId,
    lifecycleState: crash.lifecycleState,
    reasonCodes: decoded.bootReleaseReadback.reasonCodes,
  }, {
    operationId: 'system.application.boot.g2',
    correlationId: 'system-boot-g2',
    lifecycleState: 'CRASH_PENDING',
    reasonCodes: ['CRASH_PENDING_BOOT_PRESENT'],
  });
});

test('browser decoder rejects missing, unbounded, contradictory, or forged crash readback', async () => {
  const missing = validSnapshot();
  delete missing.bootReleaseReadback;
  assertInvalid(missing);

  const unbounded = validSnapshot();
  unbounded.bootReleaseReadback.history = Array.from(
    { length: 21 },
    (_, index) => record(21 - index, index === 0 ? 'ACTIVE' : 'CRASH_PENDING'),
  );
  assertInvalid(unbounded);

  const latestMismatch = validSnapshot();
  latestMismatch.bootReleaseReadback.latest = record(4, 'ACTIVE');
  assertInvalid(latestMismatch);

  const crashMismatch = validSnapshot();
  crashMismatch.bootReleaseReadback.crashPendingOperationIds = [];
  assertInvalid(crashMismatch);

  const unboundedCrashIds = validSnapshot();
  unboundedCrashIds.bootReleaseReadback.crashPendingOperationIds = Array.from(
    { length: 21 },
    () => 'system.application.boot.g2',
  );
  assertInvalid(unboundedCrashIds);

  const lifecycleContradiction = validSnapshot();
  lifecycleContradiction.bootReleaseReadback.history[1] = record(2, 'CRASH_PENDING', {
    completedAtMs: NOW_MS - 1,
    clean: false,
  });
  assertInvalid(lifecycleContradiction);

  const unboundedIssues = validSnapshot();
  const issueRecord = record(3, 'ACTIVE', {
    deployedCommit: null,
    identityState: 'PARTIAL',
    identityIssues: Array.from({ length: 6 }, () => 'DEPLOYED_COMMIT_UNKNOWN'),
  });
  unboundedIssues.bootReleaseReadback.latest = issueRecord;
  unboundedIssues.bootReleaseReadback.history[0] = issueRecord;
  unboundedIssues.bootReleaseReadback.reasonCodes = [...issueRecord.identityIssues];
  assertInvalid(unboundedIssues);

  const oversizedSchema = validSnapshot();
  const oversizedSchemaRecord = record(3, 'ACTIVE', { schemaRevision: '9'.repeat(10_000) });
  oversizedSchema.bootReleaseReadback.latest = oversizedSchemaRecord;
  oversizedSchema.bootReleaseReadback.history[0] = oversizedSchemaRecord;
  assertInvalid(oversizedSchema);

  const unsafeSchema = validSnapshot();
  const unsafeSchemaRecord = record(3, 'ACTIVE', { schemaRevision: '9999999999999999' });
  unsafeSchema.bootReleaseReadback.latest = unsafeSchemaRecord;
  unsafeSchema.bootReleaseReadback.history[0] = unsafeSchemaRecord;
  assertInvalid(unsafeSchema);

  const sentinelRevision = validSnapshot();
  const sentinelRecord = record(3, 'ACTIVE', {
    configRevision: 'UNKNOWN_FORGED',
    modelRevision: 'NOT_CONFIGURED_FORGED',
  });
  sentinelRevision.bootReleaseReadback.latest = sentinelRecord;
  sentinelRevision.bootReleaseReadback.history[0] = sentinelRecord;
  sentinelRevision.ownerView.revisions.configRevision = 'UNKNOWN_FORGED';
  sentinelRevision.ownerView.revisions.modelRevision = 'NOT_CONFIGURED_FORGED';
  assertInvalid(sentinelRevision);

  const overlap = validSnapshot();
  const overlapRecord = record(2, 'CLEAN_COMPLETED', {
    startedAtMs: overlap.bootReleaseReadback.latest.startedAtMs - 1_000,
    completedAtMs: overlap.bootReleaseReadback.latest.startedAtMs + 1,
  });
  overlap.bootReleaseReadback.history[1] = overlapRecord;
  overlap.bootReleaseReadback.crashPendingOperationIds = [];
  overlap.bootReleaseReadback.reasonCodes = [];
  assertInvalid(overlap);

  const historicalActive = validSnapshot();
  historicalActive.bootReleaseReadback.history[1] = record(2, 'ACTIVE');
  historicalActive.bootReleaseReadback.crashPendingOperationIds = [];
  historicalActive.bootReleaseReadback.reasonCodes = [];
  assertInvalid(historicalActive);

  const revisionMismatch = validSnapshot();
  revisionMismatch.ownerView.revisions.testedCommit = 'c'.repeat(40);
  assertInvalid(revisionMismatch, 'BOOT_RELEASE_REVISION_MISMATCH');

  const client = createProductIntegrationClient({ readSupervisor: async () => crashMismatch });
  await assert.rejects(
    client.readSupervisor(),
    (error) => error instanceof ProductBindingError
      && error.codes.includes('BOOT_RELEASE_READBACK_INVALID'),
  );
});

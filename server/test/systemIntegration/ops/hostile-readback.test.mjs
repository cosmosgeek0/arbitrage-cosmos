import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createCanonicalSupervisorOpsReadback,
  createDeploymentFreezeReader,
  evaluateCanonicalOpsIntakeGate,
} from '../../../dist/systemIntegration/ops/index.js';
import { createNodeDeploymentFreezeFileSystem } from '../../../dist/services/deploymentFreezeFileSystem.js';

const NOW = 1_900_000_000_000;
const MARKER_PATH = '/var/lib/cosmos-ops/deploy-frozen.json';
const MAX_MARKER_BYTES = 16 * 1_024;

function utcSeconds(value) {
  return new Date(Math.floor(value / 1_000) * 1_000).toISOString().replace('.000Z', 'Z');
}

function marker(overrides = {}) {
  return {
    ts: utcSeconds(NOW - 1_000),
    releaseId: 'candidate-123',
    exposure: 'UNKNOWN',
    reason: 'post-switch readiness gate failed',
    operatorAction: 'required',
    ...overrides,
  };
}

function injectedFileSystem({ parent = 'TRUSTED_DIRECTORY', read = { state: 'ABSENT' } } = {}) {
  return {
    inspectParentDirectory() {
      if (parent instanceof Error) throw parent;
      return parent;
    },
    readRegularFileNoFollow() {
      if (read instanceof Error) throw read;
      return read;
    },
  };
}

function freezeReader({ markerPath = MARKER_PATH, fileSystem = injectedFileSystem(), leaseMs } = {}) {
  return createDeploymentFreezeReader({
    markerPath,
    clock: { nowMs: () => NOW },
    fileSystem,
    ...(leaseMs === undefined ? {} : { leaseMs }),
  });
}

function freezeProjection(deploymentFrozen) {
  return Object.freeze({
    source: 'CANONICAL_DEPLOYMENT_FREEZE_MARKER_READBACK',
    state: deploymentFrozen === true ? 'FROZEN' : deploymentFrozen === false ? 'NOT_FROZEN' : 'UNKNOWN_FROZEN',
    ambiguity: deploymentFrozen === 'UNKNOWN' ? 'UNKNOWN' : 'NONE',
    reasons: Object.freeze([]),
    observedAtUtc: utcSeconds(NOW),
    validUntilUtc: utcSeconds(NOW + 600_000),
    deploymentFrozen,
  });
}

function supervisor(overrides = {}) {
  const base = {
    schemaVersion: 1,
    revision: 11,
    evaluatedAtMs: NOW - 1_000,
    summaries: {
      capital: {
        truthLabel: 'RECORDED_REPLAY',
        accountTruthState: 'AVAILABLE',
        activeExposureCount: 0,
        activeExposureAmount: '0',
      },
      reconciliation: {
        truthLabel: 'RECORDED_REPLAY',
        status: 'MATCHED',
        reasonCodes: [],
      },
      execution: {
        truthLabel: 'DRY_RUN',
        recoveryState: null,
      },
      ledger: {
        schemaCompatibilityState: 'AVAILABLE',
        currentSchemaVersion: 4,
        rollbackFloor: 2,
      },
    },
    components: [
      {
        componentId: 'capital-supervision',
        readiness: 'READY',
        completeness: 'COMPLETE',
        freshness: { state: 'FRESH' },
        sourceTimestamp: { sourceTimeMs: NOW - 2_000 },
      },
      {
        componentId: 'reconciliation',
        readiness: 'READY',
        completeness: 'COMPLETE',
      },
    ],
  };
  return {
    ...base,
    ...overrides,
    summaries: {
      ...base.summaries,
      ...(overrides.summaries ?? {}),
    },
  };
}

function identity(referenceType, index, overrides = {}) {
  return {
    referenceType,
    referenceId: `reference-${index}`,
    ownerId: `owner-${index}`,
    ownerRevision: `revision-${index}`,
    ownerState: 'OPEN',
    resolutionState: 'OPEN',
    correlationId: `correlation-${index}`,
    parentReferenceType: null,
    parentReferenceId: null,
    payloadHash: null,
    ownerProjection: {},
    occurredAtMs: NOW - 2_000,
    validUntilMs: null,
    ledgerEventId: index + 1,
    ...overrides,
  };
}

function opsReadback({
  clock = { nowMs: () => NOW },
  readSupervisor = () => supervisor(),
  readBlockingIdentityReferences = () => [],
  deploymentFreeze = { read: () => freezeProjection(false) },
  ...options
} = {}) {
  return createCanonicalSupervisorOpsReadback({
    clock,
    readSupervisor,
    readBlockingIdentityReferences,
    deploymentFreeze,
    ...options,
  });
}

function assertUnknownTruth(readback) {
  assert.equal(readback.exposureState, 'UNKNOWN');
  assert.equal(readback.ambiguityState, 'UNKNOWN');
  assert.equal(readback.recoveryState, 'UNKNOWN');
  assert.equal(readback.currentSchemaVersion, null);
  assert.equal(readback.rollbackFloor, null);
}

test('deployment-freeze projection has an exact bounded shape and proves absence only under a trusted parent', () => {
  const absent = freezeReader().read();
  assert.deepEqual(Object.keys(absent), [
    'source',
    'state',
    'ambiguity',
    'reasons',
    'observedAtUtc',
    'validUntilUtc',
    'deploymentFrozen',
  ]);
  assert.deepEqual(absent, {
    source: 'CANONICAL_DEPLOYMENT_FREEZE_MARKER_READBACK',
    state: 'NOT_FROZEN',
    ambiguity: 'NONE',
    reasons: [],
    observedAtUtc: utcSeconds(NOW),
    validUntilUtc: utcSeconds(NOW + 600_000),
    deploymentFrozen: false,
  });
  assert.equal(Object.isFrozen(absent), true);
  assert.equal(Object.isFrozen(absent.reasons), true);
  assert.equal(Date.parse(absent.validUntilUtc) - Date.parse(absent.observedAtUtc), 600_000);

  let readCalled = false;
  const unavailableParent = freezeReader({
    fileSystem: {
      inspectParentDirectory: () => 'UNAVAILABLE',
      readRegularFileNoFollow: () => {
        readCalled = true;
        return { state: 'ABSENT' };
      },
    },
  }).read();
  assert.equal(unavailableParent.state, 'UNKNOWN_FROZEN');
  assert.equal(unavailableParent.deploymentFrozen, 'UNKNOWN');
  assert.deepEqual(unavailableParent.reasons, ['DEPLOYMENT_FREEZE_PARENT_UNAVAILABLE']);
  assert.equal(readCalled, false, 'an untrusted parent must stop before the marker read');

  const unconfigured = freezeReader({
    markerPath: null,
    fileSystem: {
      inspectParentDirectory: () => { throw new Error('filesystem must not be touched'); },
      readRegularFileNoFollow: () => { throw new Error('filesystem must not be touched'); },
    },
  }).read();
  assert.equal(unconfigured.state, 'UNKNOWN_FROZEN');
  assert.equal(unconfigured.deploymentFrozen, 'UNKNOWN');
  assert.deepEqual(unconfigured.reasons, ['DEPLOYMENT_FREEZE_MARKER_NOT_CONFIGURED']);
});

test('deployment-freeze injected I/O failures and malformed port values remain UNKNOWN', () => {
  for (const [name, fileSystem] of [
    ['parent throws', injectedFileSystem({ parent: new Error('parent failure') })],
    ['read throws', injectedFileSystem({ read: new Error('read failure') })],
    ['read unavailable', injectedFileSystem({ read: { state: 'UNAVAILABLE' } })],
    ['read invalid null', injectedFileSystem({ read: null })],
    ['available raw invalid', injectedFileSystem({ read: { state: 'AVAILABLE', raw: null } })],
  ]) {
    assert.doesNotThrow(() => freezeReader({ fileSystem }).read(), name);
    const projected = freezeReader({ fileSystem }).read();
    assert.equal(projected.deploymentFrozen, 'UNKNOWN', name);
    assert.equal(projected.ambiguity, 'UNKNOWN', name);
  }
});

test('deployment-freeze marker accepts only the exact bounded donor schema', () => {
  const valid = freezeReader({
    fileSystem: injectedFileSystem({
      read: { state: 'AVAILABLE', raw: JSON.stringify(marker()) },
    }),
  }).read();
  assert.equal(valid.state, 'FROZEN');
  assert.equal(valid.deploymentFrozen, true);
  assert.deepEqual(valid.reasons, ['DEPLOYMENT_FREEZE_MARKER_PRESENT']);

  const hostile = [
    ['invalid JSON', '{', 'DEPLOYMENT_FREEZE_MARKER_MALFORMED'],
    ['extra key', JSON.stringify({ ...marker(), unexpected: true }), 'DEPLOYMENT_FREEZE_MARKER_MALFORMED'],
    ['impossible calendar date', JSON.stringify(marker({ ts: '2030-02-31T00:00:00Z' })), 'DEPLOYMENT_FREEZE_MARKER_MALFORMED'],
    ['oversized', 'x'.repeat(MAX_MARKER_BYTES + 1), 'DEPLOYMENT_FREEZE_MARKER_OVERSIZED'],
  ];
  for (const [name, raw, reason] of hostile) {
    const projected = freezeReader({
      fileSystem: injectedFileSystem({ read: { state: 'AVAILABLE', raw } }),
    }).read();
    assert.equal(projected.state, 'UNKNOWN_FROZEN', name);
    assert.equal(projected.deploymentFrozen, 'UNKNOWN', name);
    assert.deepEqual(projected.reasons, [reason], name);
  }
});

test('node filesystem adapter rejects symlinks and malformed or oversized marker files', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cosmos-deployment-freeze-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const markerPath = path.join(root, 'deploy-frozen.json');
  const nodeFileSystem = createNodeDeploymentFreezeFileSystem();
  const reader = createDeploymentFreezeReader({
    markerPath,
    clock: { nowMs: () => NOW },
    fileSystem: nodeFileSystem,
  });

  assert.equal(reader.read().state, 'NOT_FROZEN');

  writeFileSync(markerPath, `${JSON.stringify(marker(), null, 2)}\n`);
  assert.equal(reader.read().state, 'FROZEN');

  rmSync(markerPath);
  const target = path.join(root, 'target.json');
  writeFileSync(target, `${JSON.stringify(marker(), null, 2)}\n`);
  symlinkSync(target, markerPath);
  assert.equal(reader.read().state, 'UNKNOWN_FROZEN');

  rmSync(markerPath);
  writeFileSync(markerPath, '{');
  assert.equal(reader.read().state, 'UNKNOWN_FROZEN');

  writeFileSync(markerPath, JSON.stringify({ ...marker(), extra: true }));
  assert.equal(reader.read().state, 'UNKNOWN_FROZEN');

  writeFileSync(markerPath, 'x'.repeat(MAX_MARKER_BYTES + 1));
  assert.equal(reader.read().state, 'UNKNOWN_FROZEN');

  const missingParentReader = createDeploymentFreezeReader({
    markerPath: path.join(root, 'missing-parent', 'deploy-frozen.json'),
    clock: { nowMs: () => NOW },
    fileSystem: nodeFileSystem,
  });
  assert.equal(missingParentReader.read().state, 'UNKNOWN_FROZEN');
});

test('canonical ops readback emits the exact nine-key shape with a ten-minute UTC lease', async () => {
  let requestedLimit = null;
  const projected = await opsReadback({
    readBlockingIdentityReferences: (limit) => {
      requestedLimit = limit;
      return [];
    },
  }).read();
  assert.deepEqual(Object.keys(projected), [
    'source',
    'observedAtUtc',
    'validUntilUtc',
    'deploymentFrozen',
    'exposureState',
    'ambiguityState',
    'recoveryState',
    'currentSchemaVersion',
    'rollbackFloor',
  ]);
  assert.deepEqual(projected, {
    source: 'CANONICAL_SUPERVISOR_READBACK',
    observedAtUtc: utcSeconds(NOW),
    validUntilUtc: utcSeconds(NOW + 600_000),
    deploymentFrozen: false,
    exposureState: 'NONE',
    ambiguityState: 'NONE',
    recoveryState: 'NONE',
    currentSchemaVersion: 4,
    rollbackFloor: 2,
  });
  assert.equal(requestedLimit, 2_000);
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Date.parse(projected.validUntilUtc) - Date.parse(projected.observedAtUtc), 600_000);
});

test('an explicit supervisor cut is validated in place while freeze and identity truth remain fresh', async () => {
  let supervisorReads = 0;
  let freezeReads = 0;
  let identityReads = 0;
  const service = opsReadback({
    readSupervisor: () => {
      supervisorReads += 1;
      return supervisor();
    },
    deploymentFreeze: {
      read: () => {
        freezeReads += 1;
        return freezeProjection(false);
      },
    },
    readBlockingIdentityReferences: () => {
      identityReads += 1;
      return [];
    },
  });
  const supplied = supervisor();
  const first = await service.read(supplied);
  assert.equal(supervisorReads, 0);
  assert.equal(freezeReads, 1);
  assert.equal(identityReads, 1);
  assert.equal(first.exposureState, 'NONE');

  const stale = await service.read(supervisor({ evaluatedAtMs: NOW - 30_001 }));
  assert.equal(supervisorReads, 0);
  assert.equal(freezeReads, 2);
  assert.equal(identityReads, 1);
  assertUnknownTruth(stale);
});

test('stale, future, throwing, and structurally hostile supervisor truth fails closed', async () => {
  const malformed = supervisor();
  malformed.summaries.reconciliation = {
    truthLabel: 'RECORDED_REPLAY',
    status: 'MATCHED',
    reasonCodes: null,
  };
  const cases = [
    ['stale', () => supervisor({ evaluatedAtMs: NOW - 30_001 })],
    ['future', () => supervisor({ evaluatedAtMs: NOW + 1 })],
    ['throwing', () => { throw new Error('supervisor unavailable'); }],
    ['malformed nested summary', () => malformed],
  ];
  for (const [name, readSupervisor] of cases) {
    const projected = await opsReadback({ readSupervisor }).read();
    assertUnknownTruth(projected, name);
    assert.equal(projected.deploymentFrozen, false, name);
  }
});

test('identity read failure, malformed rows, and the 2000-row truncation boundary fail closed', async () => {
  const malformed = identity('POSITION', 0, { referenceId: '' });
  const cases = [
    ['throwing', () => { throw new Error('identity read unavailable'); }],
    ['malformed', () => [malformed]],
    ['truncated', () => Array.from({ length: 2_000 }, (_, index) => identity('POSITION', index))],
  ];
  for (const [name, readBlockingIdentityReferences] of cases) {
    const projected = await opsReadback({ readBlockingIdentityReferences }).read();
    assert.equal(projected.exposureState, 'UNKNOWN', name);
    assert.equal(projected.ambiguityState, 'UNKNOWN', name);
    assert.equal(projected.recoveryState, 'UNKNOWN', name);
    assert.equal(projected.currentSchemaVersion, 4, name);
    assert.equal(projected.rollbackFloor, 2, name);
  }

  const belowLimit = await opsReadback({
    readBlockingIdentityReferences: () => (
      Array.from({ length: 1_999 }, (_, index) => identity('POSITION', index))
    ),
  }).read();
  assert.equal(belowLimit.exposureState, 'ACTIVE');
  assert.equal(belowLimit.ambiguityState, 'NONE');
  assert.equal(belowLimit.recoveryState, 'NONE');
});

test('exposure precedence is recovery before ambiguity before active', async () => {
  const active = identity('POSITION', 0);
  const ambiguous = identity('AMBIGUOUS_MUTATION', 1);
  const recovery = identity('RECOVERY_CAMPAIGN', 2);

  const activeOnly = await opsReadback({
    readBlockingIdentityReferences: () => [active],
  }).read();
  assert.deepEqual(
    [activeOnly.exposureState, activeOnly.ambiguityState, activeOnly.recoveryState],
    ['ACTIVE', 'NONE', 'NONE'],
  );

  const ambiguityWins = await opsReadback({
    readBlockingIdentityReferences: () => [active, ambiguous],
  }).read();
  assert.deepEqual(
    [ambiguityWins.exposureState, ambiguityWins.ambiguityState, ambiguityWins.recoveryState],
    ['AMBIGUOUS', 'AMBIGUOUS', 'NONE'],
  );

  const recoveryWins = await opsReadback({
    readBlockingIdentityReferences: () => [active, ambiguous, recovery],
  }).read();
  assert.deepEqual(
    [recoveryWins.exposureState, recoveryWins.ambiguityState, recoveryWins.recoveryState],
    ['RECOVERY_REQUIRED', 'AMBIGUOUS', 'RECOVERY_REQUIRED'],
  );
});

test('Ledger schema numbers publish only from an internally consistent AVAILABLE summary', async () => {
  const available = await opsReadback({
    readSupervisor: () => supervisor({
      summaries: {
        ledger: {
          schemaCompatibilityState: 'AVAILABLE',
          currentSchemaVersion: 7,
          rollbackFloor: 3,
        },
      },
    }),
  }).read();
  assert.equal(available.currentSchemaVersion, 7);
  assert.equal(available.rollbackFloor, 3);

  const hostile = [
    { schemaCompatibilityState: 'UNAVAILABLE', currentSchemaVersion: 7, rollbackFloor: 3 },
    { schemaCompatibilityState: 'MALFORMED', currentSchemaVersion: 7, rollbackFloor: 3 },
    { schemaCompatibilityState: 'MISMATCH', currentSchemaVersion: 7, rollbackFloor: 3 },
    { schemaCompatibilityState: 'AVAILABLE', currentSchemaVersion: 1, rollbackFloor: 2 },
    { schemaCompatibilityState: 'AVAILABLE', currentSchemaVersion: Number.MAX_SAFE_INTEGER + 1, rollbackFloor: 1 },
  ];
  for (const ledger of hostile) {
    const projected = await opsReadback({
      readSupervisor: () => supervisor({ summaries: { ledger } }),
    }).read();
    assert.equal(projected.currentSchemaVersion, null, JSON.stringify(ledger));
    assert.equal(projected.rollbackFloor, null, JSON.stringify(ledger));
  }
});

test('a throwing deployment-freeze port cannot erase otherwise canonical readback truth', async () => {
  const projected = await opsReadback({
    deploymentFreeze: { read: () => { throw new Error('freeze read unavailable'); } },
  }).read();
  assert.equal(projected.deploymentFrozen, 'UNKNOWN');
  assert.equal(projected.exposureState, 'NONE');
  assert.equal(projected.ambiguityState, 'NONE');
  assert.equal(projected.recoveryState, 'NONE');
  assert.equal(projected.currentSchemaVersion, 4);
  assert.equal(projected.rollbackFloor, 2);
});

test('ops intake interlock blocks frozen or unknown truth without granting action authority', async () => {
  const readback = await opsReadback().read();
  const clear = evaluateCanonicalOpsIntakeGate(readback, NOW);
  assert.deepEqual(Object.keys(clear), [
    'source',
    'state',
    'blocksNewEntries',
    'externalActionAuthorization',
    'evaluatedAtUtc',
    'readbackValidUntilUtc',
    'reasonCodes',
  ]);
  assert.deepEqual(clear, {
    source: 'CANONICAL_OPS_INTAKE_INTERLOCK',
    state: 'OPS_INTERLOCK_CLEAR',
    blocksNewEntries: false,
    externalActionAuthorization: 'NONE',
    evaluatedAtUtc: utcSeconds(NOW),
    readbackValidUntilUtc: utcSeconds(NOW + 600_000),
    reasonCodes: [],
  });
  assert.equal(Object.isFrozen(clear), true);
  assert.equal(Object.isFrozen(clear.reasonCodes), true);

  const frozen = evaluateCanonicalOpsIntakeGate({ ...readback, deploymentFrozen: true }, NOW);
  assert.equal(frozen.state, 'OPS_INTERLOCK_BLOCKED');
  assert.equal(frozen.blocksNewEntries, true);
  assert.equal(frozen.externalActionAuthorization, 'NONE');
  assert.ok(frozen.reasonCodes.includes('DEPLOYMENT_FROZEN'));

  const unknown = evaluateCanonicalOpsIntakeGate({ ...readback, deploymentFrozen: 'UNKNOWN' }, NOW);
  assert.equal(unknown.state, 'OPS_INTERLOCK_BLOCKED');
  assert.equal(unknown.blocksNewEntries, true);
  assert.equal(unknown.externalActionAuthorization, 'NONE');
  assert.ok(unknown.reasonCodes.includes('DEPLOYMENT_FREEZE_STATE_UNKNOWN'));
});

test('ops intake interlock rejects malformed, stale, and unbounded readback leases', async () => {
  const readback = await opsReadback().read();
  const hostile = [
    ['extra key', { ...readback, extra: true }, 'CANONICAL_OPS_READBACK_INVALID'],
    [
      'impossible calendar date',
      { ...readback, observedAtUtc: '2030-02-31T00:00:00Z' },
      'CANONICAL_OPS_READBACK_INVALID',
    ],
    [
      'stale observation',
      {
        ...readback,
        observedAtUtc: utcSeconds(NOW - 31_000),
        validUntilUtc: utcSeconds(NOW + 569_000),
      },
      'CANONICAL_OPS_READBACK_NOT_CURRENT',
    ],
    [
      'unbounded lease',
      { ...readback, validUntilUtc: utcSeconds(NOW + 60 * 60 * 1_000 + 1_000) },
      'CANONICAL_OPS_READBACK_NOT_CURRENT',
    ],
  ];
  for (const [name, value, reason] of hostile) {
    const interlock = evaluateCanonicalOpsIntakeGate(value, NOW);
    assert.equal(interlock.state, 'OPS_INTERLOCK_BLOCKED', name);
    assert.equal(interlock.blocksNewEntries, true, name);
    assert.equal(interlock.externalActionAuthorization, 'NONE', name);
    assert.ok(interlock.reasonCodes.includes(reason), name);
  }
});

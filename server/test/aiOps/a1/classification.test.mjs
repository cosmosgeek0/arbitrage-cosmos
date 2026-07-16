import assert from 'node:assert/strict';
import test from 'node:test';

import { loadContracts } from './_network-denied-env.mjs';

const contracts = await loadContracts();

function input(overrides) {
  return {
    resourceId: 'resource',
    kind: 'FIXTURE',
    classifiedPath: 'synthetic/resource',
    evidencePath: 'synthetic/evidence',
    evidenceDigest: 'a'.repeat(64),
    evidenceDigestAlgorithm: 'SHA-256',
    evidenceRevision: 'synthetic-revision',
    directDependencyIds: [],
    registeredActionId: null,
    requestedActionClass: null,
    attemptedActionIds: [],
    hardDenialIds: [],
    sensitiveOwnerKinds: [],
    ...overrides,
  };
}

test('the checked classification manifest is mechanically deterministic and transitively closed', () => {
  const forward = contracts.generateClassificationManifest(contracts.AI_OPS_PORT_BASE_SHA, contracts.AI_OPS_CLASSIFICATION_INPUTS);
  const reverse = contracts.generateClassificationManifest(contracts.AI_OPS_PORT_BASE_SHA, [...contracts.AI_OPS_CLASSIFICATION_INPUTS].reverse());
  assert.equal(forward.manifestDigest, reverse.manifestDigest);
  assert.deepEqual(forward.entries, reverse.entries);
  assert.equal(forward.manifestDigest, contracts.AI_OPS_CLASSIFICATION_MANIFEST_TEMPLATE.manifestDigest);
  const root = forward.entries.find((row) => row.resourceId === 'aiops-classification-manifest');
  assert.ok(root.transitiveDependencyIds.includes('ledger-owner'));
  assert.ok(root.transitiveDependencyIds.includes('s6-boundary-schema'));
  assert.deepEqual(root.unresolvedDependencyIds, []);
  assert.deepEqual(root.cycleMemberIds, []);
});

test('all set-valued resource arrays are normalized before input and manifest hashing', () => {
  const denialIds = contracts.AI_OPS_HARD_DENIAL_IDS.slice(0, 2);
  const canonical = [
    input({
      resourceId: 'set-root',
      directDependencyIds: ['set-dependency-b', 'set-dependency-a'],
      attemptedActionIds: ['SIGN_ORDER', 'BORROW'],
      hardDenialIds: [denialIds[1], denialIds[0]],
      sensitiveOwnerKinds: ['RISK', 'CONTROL'],
    }),
    input({ resourceId: 'set-dependency-a' }),
    input({ resourceId: 'set-dependency-b' }),
  ];
  const permutedWithDuplicates = [
    input({ resourceId: 'set-dependency-b' }),
    input({ resourceId: 'set-dependency-a' }),
    input({
      resourceId: 'set-root',
      directDependencyIds: ['set-dependency-a', 'set-dependency-b', 'set-dependency-a'],
      attemptedActionIds: ['BORROW', 'SIGN_ORDER', 'BORROW'],
      hardDenialIds: [denialIds[0], denialIds[1], denialIds[0]],
      sensitiveOwnerKinds: ['CONTROL', 'RISK', 'CONTROL'],
    }),
  ];

  const first = contracts.generateClassificationManifest('set-normalization-revision', canonical);
  const second = contracts.generateClassificationManifest('set-normalization-revision', permutedWithDuplicates);
  assert.equal(first.inputDigest, second.inputDigest);
  assert.equal(first.manifestDigest, second.manifestDigest);
  assert.deepEqual(first.entries, second.entries);
});

test('unresolved dependencies and cycles stay explicit and default to isolated Class C', () => {
  const manifest = contracts.generateClassificationManifest('synthetic-revision', [
    input({ resourceId: 'cycle-a', directDependencyIds: ['cycle-b'] }),
    input({ resourceId: 'cycle-b', directDependencyIds: ['cycle-a'] }),
    input({ resourceId: 'scc-a', directDependencyIds: ['scc-b', 'scc-c'] }),
    input({ resourceId: 'scc-b', directDependencyIds: ['scc-a'] }),
    input({ resourceId: 'scc-c', directDependencyIds: ['scc-b'] }),
    input({ resourceId: 'missing-root', directDependencyIds: ['not-present'] }),
  ]);
  const cycle = manifest.entries.find((row) => row.resourceId === 'cycle-a');
  assert.deepEqual(cycle.cycleMemberIds, ['cycle-a', 'cycle-b']);
  assert.equal(cycle.actionClass, 'C');
  assert.ok(cycle.reasonCodes.includes('DEPENDENCY_CYCLE_REQUIRES_ISOLATION'));
  const stronglyConnected = manifest.entries.find((row) => row.resourceId === 'scc-a');
  assert.deepEqual(stronglyConnected.cycleMemberIds, ['scc-a', 'scc-b', 'scc-c']);
  assert.equal(stronglyConnected.actionClass, 'C');
  const missing = manifest.entries.find((row) => row.resourceId === 'missing-root');
  assert.deepEqual(missing.unresolvedDependencyIds, ['not-present']);
  assert.equal(missing.actionClass, 'C');
});

test('sensitive owners and transitive hard denials always classify D', () => {
  const denialId = contracts.AI_OPS_HARD_DENIAL_IDS[0];
  const manifest = contracts.generateClassificationManifest('synthetic-revision', [
    input({ resourceId: 'denied-leaf', hardDenialIds: [denialId] }),
    input({ resourceId: 'parent', kind: 'ADAPTER', directDependencyIds: ['denied-leaf'], requestedActionClass: 'B' }),
    input({ resourceId: 'credential-resource', sensitiveOwnerKinds: ['CREDENTIAL'], requestedActionClass: 'A', registeredActionId: 'AI_OPS_ACTION_SYNTHETIC' }),
  ]);
  const parent = manifest.entries.find((row) => row.resourceId === 'parent');
  assert.equal(parent.actionClass, 'D');
  assert.deepEqual(parent.hardDenialIds, [denialId]);
  assert.ok(parent.reasonCodes.includes('TRANSITIVE_HARD_DENIAL_INHERITED'));
  assert.equal(manifest.entries.find((row) => row.resourceId === 'credential-resource').actionClass, 'D');
});

test('shadow Class A candidates stay downgraded without signed registry handler and readback', () => {
  const manifest = contracts.generateClassificationManifest('synthetic-revision', [
    input({ resourceId: 'unregistered-a', requestedActionClass: 'A' }),
    input({ resourceId: 'registered-a', requestedActionClass: 'A', registeredActionId: 'AI_OPS_ACTION_RECONNECT_STREAM' }),
  ]);
  const unregistered = manifest.entries.find((row) => row.resourceId === 'unregistered-a');
  assert.equal(unregistered.actionClass, 'D');
  assert.ok(unregistered.reasonCodes.includes('CLASS_A_REQUIRES_EXACT_REGISTERED_ACTION'));
  const registered = manifest.entries.find((row) => row.resourceId === 'registered-a');
  assert.equal(registered.actionClass, 'C');
  assert.ok(registered.reasonCodes.includes('SHADOW_HAS_NO_SIGNED_CLASS_A_REGISTRATION_HANDLER_OR_READBACK'));
});

test('unknown resources, aliases, and action-class mismatches fail closed', () => {
  const manifest = contracts.generateClassificationManifest('synthetic-revision', [
    input({ resourceId: 'unknown-resource', kind: 'UNKNOWN' }),
    input({ resourceId: 'raw-alias', attemptedActionIds: ['reconnect_stream'] }),
    input({ resourceId: 'versioned-alias', attemptedActionIds: ['RECONNECT_STREAM_V2'] }),
    input({ resourceId: 'separator-alias', attemptedActionIds: ['RECONNECT-STREAM'] }),
    input({ resourceId: 'registered-class-mismatch', requestedActionClass: 'B', registeredActionId: 'AI_OPS_ACTION_RECONNECT_STREAM' }),
    input({ resourceId: 'attempted-class-mismatch-a', requestedActionClass: 'D', attemptedActionIds: ['RECONNECT_STREAM'] }),
    input({ resourceId: 'attempted-class-mismatch-b', requestedActionClass: 'C', attemptedActionIds: ['CONFIGURATION_CHANGE'] }),
  ]);

  const byId = new Map(manifest.entries.map((row) => [row.resourceId, row]));
  assert.deepEqual(byId.get('unknown-resource').reasonCodes, ['UNKNOWN_RESOURCE_FAILS_CLOSED']);
  for (const resourceId of ['raw-alias', 'versioned-alias', 'separator-alias']) {
    assert.equal(byId.get(resourceId).actionClass, 'D');
    assert.deepEqual(byId.get(resourceId).reasonCodes, ['UNREGISTERED_ACTION_FAILS_CLOSED']);
  }
  assert.deepEqual(byId.get('registered-class-mismatch').reasonCodes, ['REGISTERED_ACTION_CLASS_BINDING_INVALID']);
  assert.deepEqual(byId.get('attempted-class-mismatch-a').reasonCodes, ['ATTEMPTED_ACTION_CLASS_BINDING_INVALID']);
  assert.deepEqual(byId.get('attempted-class-mismatch-b').reasonCodes, ['ATTEMPTED_ACTION_CLASS_BINDING_INVALID']);
  assert.throws(
    () => contracts.generateClassificationManifest('synthetic-revision', [input({ attemptedActionIds: ['RECОNNECT_STREAM'] })]),
    /invalid attempted actions/,
  );
});

test('the generated input set exercises all fourteen denial rows and preserves proposal-only B', () => {
  const manifest = contracts.AI_OPS_CLASSIFICATION_MANIFEST_TEMPLATE;
  const denials = manifest.entries.filter((row) => row.resourceId.startsWith('aiops-hard-denial-fixture-'));
  assert.equal(denials.length, 14);
  assert.deepEqual(denials.map((row) => row.actionClass), Array(14).fill('D'));
  assert.deepEqual(denials.flatMap((row) => row.hardDenialIds).sort(), [...contracts.AI_OPS_HARD_DENIAL_IDS].sort());
  assert.equal(manifest.entries.find((row) => row.resourceId === 'aiops-control-insertion-requests').actionClass, 'B');
  assert.equal(manifest.entries.find((row) => row.resourceId === 'aiops-decision-log-port').actionClass, 'B');
});

test('attempted dangerous actions derive denial classification without caller tags', () => {
  for (const denial of contracts.AI_OPS_HARD_DENIALS) {
    for (const actionId of [denial.examples[0], `AI_OPS_ACTION_${denial.examples[0]}`]) {
      const manifest = contracts.generateClassificationManifest('synthetic-revision', [
        input({ resourceId: `denial-${denial.directiveRow}-${actionId}`, attemptedActionIds: [actionId], hardDenialIds: [] }),
      ]);
      assert.equal(manifest.entries[0].actionClass, 'D');
      assert.deepEqual(manifest.entries[0].hardDenialIds, [denial.denialId]);
    }
    const registered = contracts.generateClassificationManifest('synthetic-revision', [
      input({ resourceId: `registered-denial-${denial.directiveRow}`, registeredActionId: denial.examples[0], attemptedActionIds: [], hardDenialIds: [] }),
    ]);
    assert.equal(registered.entries[0].actionClass, 'D');
    assert.deepEqual(registered.entries[0].hardDenialIds, [denial.denialId]);
  }
});

test('classification resource and dependency structures are bounded', () => {
  const tooManyResources = Array.from({ length: 513 }, (_, index) => input({ resourceId: `resource-${index}` }));
  assert.throws(() => contracts.generateClassificationManifest('synthetic-revision', tooManyResources), /bound exceeded/);
  const lyingLength = new Proxy(tooManyResources, {
    get(target, key, receiver) {
      if (key === 'length') return 1;
      return Reflect.get(target, key, receiver);
    },
  });
  assert.throws(() => contracts.generateClassificationManifest('synthetic-revision', lyingLength), /bound exceeded/);
  assert.throws(() => contracts.generateClassificationManifest('synthetic-revision', [input({ directDependencyIds: Array.from({ length: 257 }, (_, index) => `dependency-${index}`) })]), /too many dependencies/);
  assert.throws(() => contracts.generateClassificationManifest('synthetic-revision', [input({ evidenceDigestAlgorithm: 'SHA-512' })]), /invalid evidence digest algorithm/);
  const overriddenMap = [input({})];
  overriddenMap.map = () => Array.from({ length: 513 }, (_, index) => input({ resourceId: `injected-${index}` }));
  assert.throws(() => contracts.generateClassificationManifest('synthetic-revision', overriddenMap), /not closed canonical data/);
});

test('classification rejects open or malformed runtime provenance and dependency inputs', () => {
  assert.throws(() => contracts.generateClassificationManifest('', [input({})]), /invalid classification sourceRevision/);
  assert.throws(() => contracts.generateClassificationManifest('synthetic-revision', [{ ...input({}), attackerOnly: true }]), /closed object/);
  assert.throws(() => contracts.generateClassificationManifest('synthetic-revision', [input({ classifiedPath: null })]), /invalid classifiedPath/);
  assert.throws(() => contracts.generateClassificationManifest('synthetic-revision', [input({ evidencePath: 7 })]), /invalid evidencePath/);
  assert.throws(() => contracts.generateClassificationManifest('synthetic-revision', [input({ evidenceRevision: null })]), /invalid evidence revision/);
  assert.throws(() => contracts.generateClassificationManifest('synthetic-revision', [input({ directDependencyIds: ['valid-dependency', 7] })]), /invalid dependencies/);
  assert.throws(() => contracts.generateClassificationManifest('synthetic-revision', [input({ attemptedActionIds: ['VALID_ACTION', {}] })]), /invalid attempted actions/);
  assert.throws(() => contracts.generateClassificationManifest('synthetic-revision', [input({ sensitiveOwnerKinds: ['UNKNOWN_OWNER'] })]), /invalid sensitive owner kinds/);
  let getterCalls = 0;
  const accessorResource = Object.defineProperty(input({}), 'kind', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'UNKNOWN';
    },
  });
  assert.throws(() => contracts.generateClassificationManifest('synthetic-revision', [accessorResource]), /not closed canonical data/);
  assert.equal(getterCalls, 0);
  const secret = 'sk-proj-1234567890abcdef';
  for (const mutation of [
    { resourceId: secret },
    { classifiedPath: secret },
    { evidencePath: secret },
    { evidenceRevision: secret },
  ]) {
    let thrown;
    try {
      contracts.generateClassificationManifest('synthetic-revision', [input(mutation)]);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof TypeError);
    assert.equal(thrown.message.includes(secret), false);
  }
  let lengthGetterCalls = 0;
  const hostileLength = new Proxy([input({})], {
    get(target, key, receiver) {
      if (key === 'length') {
        lengthGetterCalls += 1;
        throw new TypeError(`classification resource ${secret}`);
      }
      return Reflect.get(target, key, receiver);
    },
  });
  assert.doesNotThrow(() => contracts.generateClassificationManifest('synthetic-revision', hostileLength));
  assert.equal(lengthGetterCalls, 0, 'classifier must use one captured descriptor view rather than property reads');
});

test('dense layered DAG expansion is bounded by reachable nodes rather than path count', () => {
  const width = 4;
  const depth = 20;
  const layers = Array.from({ length: depth }, (_, layerIndex) =>
    Array.from({ length: width }, (_, nodeIndex) => `dense-layer-${String(layerIndex).padStart(2, '0')}-node-${nodeIndex}`),
  );
  const resources = [
    input({ resourceId: 'dense-root', directDependencyIds: layers[0] }),
    ...layers.flatMap((layer, layerIndex) =>
      layer.map((resourceId) => input({
        resourceId,
        directDependencyIds: layers[layerIndex + 1] ?? [],
      })),
    ),
  ];

  // This graph has 4^20 distinct root-to-last-layer paths. Completion without
  // a wall-clock assertion proves expansion is not proportional to path count.
  const manifest = contracts.generateClassificationManifest('dense-layered-dag-revision', resources);
  const root = manifest.entries.find((entry) => entry.resourceId === 'dense-root');
  const expectedClosure = layers.flat().sort();
  assert.deepEqual(root.transitiveDependencyIds, expectedClosure);
  assert.equal(new Set(root.transitiveDependencyIds).size, width * depth);
  assert.deepEqual(root.unresolvedDependencyIds, []);
  assert.deepEqual(root.cycleMemberIds, []);
});

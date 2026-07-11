import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  canonicalJson,
  makeStableFailure,
} from '../../../dist/intelligenceFoundation/contracts/index.js';
import {
  createIntelligenceTopologyCatalog,
  createTopologyRegistry,
  intelligenceComponentId,
  topologyComponentId,
  topologyEdgeId,
} from '../../../dist/intelligenceFoundation/topology/index.js';

const AT = 1_720_000_000_000;

function truth({
  key = 'fixture',
  state = 'FRESH',
  completeness = 'COMPLETE',
  reasonCodes = [],
} = {}) {
  const unavailable = state === 'UNAVAILABLE' || state === 'UNKNOWN';
  const stale = state === 'STALE';
  const incomplete = completeness === 'PARTIAL' || completeness === 'MISSING';
  return {
    schemaVersion: '1',
    producerVersion: 'topology-test-1',
    configurationVersion: 'topology-test-cfg-1',
    featureVersion: null,
    authority: {
      kind: 'ENGINE_DERIVED',
      sourceId: `topology-test:${key}`,
      dataset: 'component-descriptor',
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: [`record:${key}`],
      sourceSet: ['topology-test-fixture'],
      transforms: ['topology-test-builder-v1'],
    },
    temporal: {
      sourceEventTimeMs: unavailable ? null : stale ? AT - 2_000 : AT,
      sourceTransactionTimeMs: null,
      receivedTimeMs: AT,
      sequence: null,
    },
    freshness: {
      basis: unavailable ? 'UNAVAILABLE' : 'SOURCE_EVENT_TIME',
      evaluatedAtMs: AT,
      ageMs: unavailable ? null : stale ? 2_000 : 0,
      maxAgeMs: unavailable ? null : 1_000,
      state,
    },
    completeness: {
      state: completeness,
      observedFields: completeness === 'MISSING' ? [] : ['descriptor'],
      missingFields: incomplete ? ['descriptor-detail'] : [],
      reasonCodes: incomplete && reasonCodes.length === 0 ? ['FIXTURE_INCOMPLETE'] : reasonCodes,
    },
  };
}

function component(key, dependencyKeys = [], overrides = {}) {
  const nodeTruth = overrides.truth ?? truth({ key });
  const id = topologyComponentId(key);
  return {
    id,
    name: `Component ${key}`,
    responsibility: `Pure responsibility for ${key}`,
    authoritativeOwner: `test/${key}`,
    dependencyIds: dependencyKeys.map(topologyComponentId),
    inputs: [`input:${key}`],
    outputs: [`output:${key}`],
    desiredState: 'LIBRARY_AVAILABLE',
    observedState: 'LIBRARY_AVAILABLE',
    authority: { ...nodeTruth.authority },
    freshness: { ...nodeTruth.freshness },
    lastSuccessTimeMs: null,
    lastError: null,
    blockingReason: null,
    metrics: [{ name: 'fixture', value: true, unit: 'boolean' }],
    safeControlsSupportedLater: [],
    uiSurface: 'TEST',
    truth: nodeTruth,
    ...overrides,
  };
}

function edge(fromKey, toKey, type = 'DATA', label = `${fromKey} to ${toKey}`) {
  const from = topologyComponentId(fromKey);
  const to = topologyComponentId(toKey);
  const semantic = { from, to, type, label };
  return {
    id: topologyEdgeId(semantic),
    ...semantic,
    truth: truth({ key: `edge:${fromKey}:${toKey}:${type}` }),
  };
}

function registryTruth(key = 'snapshot') {
  return truth({ key });
}

function requireOk(result) {
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.failure));
  return result.value;
}

test('catalog is render-ready but truthfully reports library-only, not live runtime state', () => {
  const registry = requireOk(createIntelligenceTopologyCatalog({ observedAtMs: AT }));
  const snapshot = registry.snapshot();
  assert.equal(snapshot.nodes.length, 9);
  assert.equal(snapshot.edges.length, 30);
  assert.deepEqual(snapshot.nodes.map((node) => node.id), [...snapshot.nodes.map((node) => node.id)].sort());
  assert.equal(registry.nodesByObservedState('LIBRARY_AVAILABLE').length, 9);
  assert.equal(registry.nodesByUiSurface('OPPORTUNITIES').length, 2);
  for (const node of snapshot.nodes) {
    assert.equal(node.desiredState, 'RUNTIME_WIRED');
    assert.equal(node.observedState, 'LIBRARY_AVAILABLE');
    assert.equal(node.blockingReason, 'NOT_WIRED');
    assert.equal(node.lastSuccessTimeMs, null);
    assert.equal(node.freshness.state, 'UNAVAILABLE');
    assert.deepEqual(node.authority, node.truth.authority);
    assert.deepEqual(node.freshness, node.truth.freshness);
    assert.equal(node.metrics.find((metric) => metric.name === 'runtime_wired').value, false);
    assert.equal(node.metrics.find((metric) => metric.name === 'live_authority').value, 'NONE');
  }
  const topology = registry.node(intelligenceComponentId('topology'));
  assert.equal(topology.name, 'Intelligence topology read model');
  assert.equal(topology.safeControlsSupportedLater.length, 0);
  const laterSnapshot = requireOk(createIntelligenceTopologyCatalog({ observedAtMs: AT + 60_000 })).snapshot();
  assert.equal(laterSnapshot.id, snapshot.id);
  assert.deepEqual(laterSnapshot.nodes.map((node) => node.id), snapshot.nodes.map((node) => node.id));
  assert.deepEqual(laterSnapshot.edges.map((edge) => edge.id), snapshot.edges.map((edge) => edge.id));
});

test('registry canonicalizes order and returns defensive copies', () => {
  const nodes = [component('a'), component('b', ['a']), component('c', ['b'])];
  const edges = [edge('a', 'b', 'DATA'), edge('b', 'c', 'EVIDENCE')];
  const left = requireOk(createTopologyRegistry({ nodes, edges, truth: registryTruth('order') }));
  const right = requireOk(createTopologyRegistry({
    nodes: [...nodes].reverse(),
    edges: [...edges].reverse(),
    truth: registryTruth('order'),
  }));
  assert.equal(canonicalJson(left.snapshot()), canonicalJson(right.snapshot()));
  assert.equal(left.snapshot().id, right.snapshot().id);

  nodes[0].name = 'mutated source';
  const leaked = left.snapshot();
  leaked.nodes[0].name = 'mutated result';
  leaked.nodes[0].truth.authority.sourceId = 'mutated truth';
  assert.equal(left.node(topologyComponentId('a')).name, 'Component a');
  assert.notEqual(left.node(topologyComponentId('a')).truth.authority.sourceId, 'mutated truth');
  const copiedBounds = left.bounds();
  copiedBounds.maxNodes = 1;
  assert.notEqual(left.bounds().maxNodes, 1);
});

test('stable IDs use locale-independent code-unit ordering across input permutations', () => {
  const nodes = [component('locale-a'), component('locale-b', ['locale-a']), component('locale-c', ['locale-b'])];
  nodes[0].metrics = [
    { name: 'ä-rate', value: 1, unit: 'Ω' },
    { name: 'z-rate', value: 2, unit: 'unit' },
    { name: 'İ-rate', value: 3, unit: 'unit' },
  ];
  const edges = [
    edge('locale-a', 'locale-b', 'DATA', 'ä evidence'),
    edge('locale-b', 'locale-c', 'EVIDENCE', 'z evidence'),
  ];
  const originalLocaleCompare = String.prototype.localeCompare;
  let reversed;
  let forward;
  try {
    String.prototype.localeCompare = function reverseLocale(other) {
      const left = String(this);
      const right = String(other);
      return left < right ? 1 : left > right ? -1 : 0;
    };
    reversed = requireOk(createTopologyRegistry({
      nodes: [...nodes].reverse(),
      edges: [...edges].reverse(),
      truth: registryTruth('locale-order'),
    })).snapshot();
    String.prototype.localeCompare = function forwardLocale(other) {
      const left = String(this);
      const right = String(other);
      return left < right ? -1 : left > right ? 1 : 0;
    };
    forward = requireOk(createTopologyRegistry({
      nodes,
      edges,
      truth: registryTruth('locale-order'),
    })).snapshot();
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
  assert.equal(reversed.id, forward.id);
  assert.deepEqual(reversed.nodes.map((node) => node.id), forward.nodes.map((node) => node.id));
  assert.deepEqual(reversed.edges.map((item) => item.id), forward.edges.map((item) => item.id));
  assert.equal(canonicalJson(reversed), canonicalJson(forward));
});

test('registry state is runtime-private, frozen, and immune to reflected mutation attempts', () => {
  const nodes = [component('private-a'), component('private-b', ['private-a'])];
  const edges = [edge('private-a', 'private-b')];
  const inputTruth = registryTruth('private-state');
  const registry = requireOk(createTopologyRegistry({ nodes, edges, truth: inputTruth }));
  const before = registry.snapshot();

  assert.equal(Object.isFrozen(registry), true);
  assert.equal(Object.isFrozen(Object.getPrototypeOf(registry)), true);
  assert.deepEqual(Object.getOwnPropertyNames(registry), []);
  assert.equal(Reflect.set(registry, 'value', { id: 'forged' }), false);
  assert.equal(Reflect.set(registry, 'nodeMap', new Map()), false);
  assert.throws(() => Object.defineProperty(registry, 'snapshot', { value: () => ({ id: 'forged' }) }), TypeError);
  assert.throws(() => Object.defineProperty(Object.getPrototypeOf(registry), 'snapshot', {
    value: () => ({ id: 'forged' }),
  }), TypeError);

  nodes[0].truth.provenance.sourceRecordIds.push('forged-source-record');
  edges[0].truth.completeness.state = 'UNKNOWN';
  inputTruth.authority.sourceId = 'forged-authority';
  const leakedNode = registry.node(topologyComponentId('private-a'));
  leakedNode.truth.provenance.transforms.push('forged-transform');
  const leakedSnapshot = registry.snapshot();
  leakedSnapshot.truth.completeness.state = 'UNKNOWN';

  assert.equal(canonicalJson(registry.snapshot()), canonicalJson(before));
  assert.equal(registry.snapshot().id, before.id);
});

test('dependency validation rejects missing nodes, missing typed edges, and duplicates', () => {
  const missingEdge = createTopologyRegistry({
    nodes: [component('a'), component('b', ['a'])],
    edges: [],
    truth: registryTruth('missing-edge'),
  });
  assert.equal(missingEdge.ok, false);
  assert.equal(missingEdge.failure.code, 'MISSING_SOURCE');

  const unknownDependency = component('b');
  unknownDependency.dependencyIds = [topologyComponentId('absent')];
  const missingNode = createTopologyRegistry({
    nodes: [unknownDependency],
    edges: [],
    truth: registryTruth('missing-node'),
  });
  assert.equal(missingNode.ok, false);
  assert.equal(missingNode.failure.code, 'MISSING_SOURCE');

  const duplicate = edge('a', 'b');
  const duplicateEdge = createTopologyRegistry({
    nodes: [component('a'), component('b', ['a'])],
    edges: [duplicate, structuredClone(duplicate)],
    truth: registryTruth('duplicate'),
  });
  assert.equal(duplicateEdge.ok, false);
  assert.equal(duplicateEdge.failure.code, 'DUPLICATE_EVENT');
});

test('descriptor truth is canonical and conflicting authority or freshness claims fail closed', () => {
  const authorityConflict = component('authority-conflict');
  authorityConflict.authority.sourceId = 'conflicting-source';
  const authorityResult = createTopologyRegistry({
    nodes: [authorityConflict],
    edges: [],
    truth: registryTruth('authority-conflict'),
  });
  assert.equal(authorityResult.ok, false);
  assert.equal(authorityResult.failure.code, 'INVALID_VALUE');
  assert.match(authorityResult.failure.message, /authority conflicts/);

  const freshnessConflict = component('freshness-conflict');
  freshnessConflict.freshness.state = 'STALE';
  const freshnessResult = createTopologyRegistry({
    nodes: [freshnessConflict],
    edges: [],
    truth: registryTruth('freshness-conflict'),
  });
  assert.equal(freshnessResult.ok, false);
  assert.match(freshnessResult.failure.message, /freshness conflicts/);

  const inventedRuntime = component('invented-runtime');
  inventedRuntime.observedState = 'RUNNING';
  const runtimeResult = createTopologyRegistry({
    nodes: [inventedRuntime],
    edges: [],
    truth: registryTruth('invented-runtime'),
  });
  assert.equal(runtimeResult.ok, false);
  assert.equal(runtimeResult.failure.code, 'INVALID_VALUE');
});

test('snapshot truth conservatively rolls up child freshness, completeness, provenance, and failures', () => {
  const degradedTruth = truth({
    key: 'degraded-child',
    state: 'STALE',
    completeness: 'PARTIAL',
    reasonCodes: ['CHILD_FIELD_MISSING'],
  });
  const childFailure = makeStableFailure(
    'UNAVAILABLE',
    'topology-test-child',
    'fixture source unavailable',
    'source',
    ['evidence:child-offline'],
  );
  const degraded = component('degraded-child', [], {
    truth: degradedTruth,
    authority: { ...degradedTruth.authority },
    freshness: { ...degradedTruth.freshness },
    observedState: 'UNAVAILABLE',
    blockingReason: 'SOURCE_OFFLINE',
    lastError: childFailure,
  });
  const typedEdge = edge('degraded-child', 'consumer', 'EVIDENCE');
  const templateTruth = registryTruth('rollup-template');
  const snapshot = requireOk(createTopologyRegistry({
    nodes: [component('consumer', ['degraded-child']), degraded],
    edges: [typedEdge],
    truth: templateTruth,
  })).snapshot();

  assert.equal(snapshot.truth.freshness.state, 'STALE');
  assert.equal(snapshot.truth.completeness.state, 'PARTIAL');
  assert.equal(snapshot.truth.provenance.sourceRecordIds.includes('record:degraded-child'), true);
  assert.equal(snapshot.truth.provenance.sourceRecordIds.includes('record:edge:degraded-child:consumer:EVIDENCE'), true);
  assert.equal(snapshot.truth.provenance.sourceRecordIds.includes(childFailure.id), true);
  assert.equal(snapshot.truth.provenance.sourceRecordIds.includes('evidence:child-offline'), true);
  assert.equal(snapshot.truth.provenance.transforms.includes('topology-child-truth-rollup-v1'), true);
  assert.equal(snapshot.truth.completeness.reasonCodes.includes('CHILD_FIELD_MISSING'), true);
  assert.equal(snapshot.truth.completeness.reasonCodes.includes('CHILD_FAILURE_UNAVAILABLE'), true);
  assert.equal(snapshot.truth.completeness.missingFields.some((field) => field.endsWith('.lastError')), true);
  assert.deepEqual(snapshot.truth.authority, templateTruth.authority);

  const staleEdge = structuredClone(typedEdge);
  staleEdge.truth = truth({ key: 'edge:degraded-child:consumer:EVIDENCE', state: 'STALE' });
  const changedEdgeTruthSnapshot = requireOk(createTopologyRegistry({
    nodes: [component('consumer', ['degraded-child']), degraded],
    edges: [staleEdge],
    truth: templateTruth,
  })).snapshot();
  assert.notEqual(changedEdgeTruthSnapshot.id, snapshot.id);
});

test('traversal, empty cycle, and blocking reports explicitly retain stale or unknown topology truth', () => {
  for (const freshnessState of ['STALE', 'UNKNOWN']) {
    const nodeTruth = truth({
      key: `report-${freshnessState.toLowerCase()}`,
      state: freshnessState,
      completeness: freshnessState === 'UNKNOWN' ? 'UNKNOWN' : 'COMPLETE',
    });
    const node = component(`report-${freshnessState.toLowerCase()}`, [], {
      truth: nodeTruth,
      authority: { ...nodeTruth.authority },
      freshness: { ...nodeTruth.freshness },
    });
    const registry = requireOk(createTopologyRegistry({
      nodes: [node],
      edges: [],
      truth: registryTruth(`report-template-${freshnessState.toLowerCase()}`),
    }));
    const nodeId = node.id;
    const traversal = requireOk(registry.traverse({ startId: nodeId, direction: 'DOWNSTREAM' }));
    const cycleReport = requireOk(registry.cycles({ scope: 'DEPENDENCIES' }));
    const blocking = requireOk(registry.blocking(nodeId));

    assert.equal(registry.snapshot().truth.freshness.state, freshnessState);
    assert.equal(traversal.truth.freshness.state, freshnessState);
    assert.deepEqual(cycleReport.cycles, []);
    assert.equal(cycleReport.truth.freshness.state, freshnessState);
    assert.equal(blocking.truth.freshness.state, freshnessState);
    assert.equal(blocking.blockers.every((blocker) => blocker.truth.freshness.state === freshnessState), true);
    if (freshnessState === 'UNKNOWN') {
      assert.equal(traversal.truth.completeness.state, 'UNKNOWN');
      assert.equal(cycleReport.truth.completeness.state, 'UNKNOWN');
      assert.equal(blocking.truth.completeness.state, 'UNKNOWN');
    }
  }
});

test('typed traversal is deterministic, filterable, and bounded by depth', () => {
  const registry = requireOk(createTopologyRegistry({
    nodes: [component('a'), component('b', ['a']), component('c', ['b'])],
    edges: [
      edge('a', 'b', 'DATA'),
      edge('b', 'c', 'EVIDENCE'),
      edge('a', 'c', 'CONTROL'),
    ],
    truth: registryTruth('traversal'),
  }));
  const full = requireOk(registry.traverse({
    startId: topologyComponentId('a'),
    direction: 'DOWNSTREAM',
    edgeTypes: ['EVIDENCE', 'DATA'],
  }));
  assert.deepEqual(full.nodeIds, [topologyComponentId('a'), topologyComponentId('b'), topologyComponentId('c')].sort());
  assert.equal(full.edgeIds.length, 2);
  assert.equal(full.edgeTypes.includes('CONTROL'), false);
  assert.equal(full.truncated, false);
  assert.equal(full.truth.freshness.state, 'FRESH');
  assert.equal(full.truth.completeness.state, 'COMPLETE');

  const bounded = requireOk(registry.traverse({
    startId: topologyComponentId('a'),
    direction: 'DOWNSTREAM',
    edgeTypes: ['DATA', 'EVIDENCE'],
    maxDepth: 1,
  }));
  assert.deepEqual(bounded.nodeIds, [topologyComponentId('a'), topologyComponentId('b')].sort());
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.truth.completeness.state, 'PARTIAL');
  assert.equal(bounded.truth.completeness.reasonCodes.includes('TOPOLOGY_TRAVERSAL_TRUNCATED'), true);

  const upstream = requireOk(registry.traverse({
    startId: topologyComponentId('c'),
    direction: 'UPSTREAM',
    edgeTypes: ['DATA', 'EVIDENCE'],
  }));
  assert.deepEqual(upstream.nodeIds, full.nodeIds);
});

test('dependency and typed-edge cycles are reported as deterministic bounded components', () => {
  const registry = requireOk(createTopologyRegistry({
    nodes: [component('a', ['c']), component('b', ['a']), component('c', ['b'])],
    edges: [
      edge('c', 'a', 'DATA'),
      edge('a', 'b', 'EVIDENCE'),
      edge('b', 'c', 'ATTENTION'),
    ],
    truth: registryTruth('cycles'),
  }));
  const dependencyReport = requireOk(registry.cycles({ scope: 'DEPENDENCIES' }));
  const dependencyCycles = dependencyReport.cycles;
  assert.equal(dependencyCycles.length, 1);
  assert.deepEqual(dependencyCycles[0].nodeIds, [
    topologyComponentId('a'),
    topologyComponentId('b'),
    topologyComponentId('c'),
  ].sort());
  assert.deepEqual(dependencyCycles[0].edgeTypes, ['DATA', 'EVIDENCE', 'ATTENTION']);

  const typedReport = requireOk(registry.cycles({
    scope: 'TYPED_EDGES',
    edgeTypes: ['ATTENTION', 'DATA', 'EVIDENCE'],
  }));
  assert.equal(typedReport.cycles.length, 1);
  assert.deepEqual(typedReport.cycles, dependencyCycles.map((cycle) => ({
    ...cycle,
    id: typedReport.cycles[0].id,
    scope: 'TYPED_EDGES',
  })));
  const acyclicReport = requireOk(registry.cycles({ scope: 'TYPED_EDGES', edgeTypes: ['DATA'] }));
  assert.deepEqual(acyclicReport.cycles, []);
  assert.equal(acyclicReport.truth.completeness.state, 'COMPLETE');

  const blocking = requireOk(registry.blocking(topologyComponentId('a')));
  assert.equal(blocking.blocked, true);
  assert.equal(blocking.dependencyCycleIds.length, 1);
  assert.equal(blocking.blockers.some((blocker) => blocker.reasonCodes.includes('DEPENDENCY_CYCLE')), true);
});

test('blocking reports propagate shortest deterministic dependency paths', () => {
  const unavailableTruth = truth({ key: 'source', state: 'UNAVAILABLE' });
  const source = component('source', [], {
    truth: unavailableTruth,
    desiredState: 'RUNTIME_WIRED',
    observedState: 'LIBRARY_AVAILABLE',
    authority: { ...unavailableTruth.authority },
    freshness: { ...unavailableTruth.freshness },
    blockingReason: 'NOT_WIRED',
  });
  const registry = requireOk(createTopologyRegistry({
    nodes: [source, component('middle', ['source']), component('target', ['middle'])],
    edges: [edge('source', 'middle'), edge('middle', 'target')],
    truth: registryTruth('blocking'),
  }));
  const report = requireOk(registry.blocking(topologyComponentId('target')));
  assert.equal(report.blocked, true);
  const inherited = report.blockers.find((blocker) => blocker.blockedById === topologyComponentId('source'));
  assert.equal(inherited.direct, false);
  assert.deepEqual(inherited.path, [
    topologyComponentId('target'),
    topologyComponentId('middle'),
    topologyComponentId('source'),
  ]);
  assert.deepEqual(inherited.reasonCodes, ['FRESHNESS_UNAVAILABLE', 'NOT_WIRED']);

  const missing = registry.blocking(topologyComponentId('missing'));
  assert.equal(missing.ok, false);
  assert.equal(missing.failure.code, 'MISSING_SOURCE');
});

test('bounds and secret rejection fail before any catalog is exposed', () => {
  const bounded = createTopologyRegistry({
    nodes: [component('a'), component('b'), component('c')],
    edges: [],
    truth: registryTruth('bounded'),
  }, { maxNodes: 2 });
  assert.equal(bounded.ok, false);
  assert.equal(bounded.failure.code, 'BUDGET_EXHAUSTED');

  const contaminated = component('contaminated');
  contaminated.apiKey = 'must-never-be-retained';
  const secret = createTopologyRegistry({
    nodes: [contaminated],
    edges: [],
    truth: registryTruth('secret'),
  });
  assert.equal(secret.ok, false);
  assert.equal(secret.failure.code, 'SECRET_FIELD_REJECTED');
  assert.doesNotMatch(JSON.stringify(secret.failure), /must-never-be-retained/);

  const malformedNode = component('malformed-node');
  delete malformedNode.authority;
  assert.doesNotThrow(() => createTopologyRegistry({
    nodes: [malformedNode],
    edges: [],
    truth: registryTruth('malformed-node'),
  }));
  const malformedNodeResult = createTopologyRegistry({
    nodes: [malformedNode],
    edges: [],
    truth: registryTruth('malformed-node'),
  });
  assert.equal(malformedNodeResult.ok, false);
  assert.equal(malformedNodeResult.failure.code, 'INVALID_VALUE');

  const malformedEdge = { ...edge('a', 'b'), from: null };
  assert.doesNotThrow(() => createTopologyRegistry({
    nodes: [component('a'), component('b')],
    edges: [malformedEdge],
    truth: registryTruth('malformed-edge'),
  }));
  const malformedEdgeResult = createTopologyRegistry({
    nodes: [component('a'), component('b')],
    edges: [malformedEdge],
    truth: registryTruth('malformed-edge'),
  });
  assert.equal(malformedEdgeResult.ok, false);
  assert.equal(malformedEdgeResult.failure.code, 'INVALID_VALUE');
});

test('topology imports are pure and start no network, sockets, or timers', () => {
  const moduleUrl = new URL('../../../dist/intelligenceFoundation/topology/index.js', import.meta.url).href;
  const script = `
    let timers = 0;
    globalThis.fetch = () => { throw new Error('fetch forbidden'); };
    globalThis.WebSocket = class { constructor() { throw new Error('socket forbidden'); } };
    const originalTimeout = globalThis.setTimeout;
    const originalInterval = globalThis.setInterval;
    globalThis.setTimeout = (...args) => { timers += 1; return originalTimeout(...args); };
    globalThis.setInterval = (...args) => { timers += 1; return originalInterval(...args); };
    await import(${JSON.stringify(moduleUrl)});
    globalThis.setTimeout = originalTimeout;
    globalThis.setInterval = originalInterval;
    if (timers !== 0) throw new Error('import scheduled a timer');
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    timeout: 2_000,
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

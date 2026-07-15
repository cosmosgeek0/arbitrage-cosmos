import {
  cloneCanonical,
  deepFreeze,
  omitFields,
  sha256,
} from '../../dock/src/canonical.mjs';
import { validatePortfolioSnapshot } from './contracts.mjs';
import { absoluteAtoms, knownMetric, parseAtoms, validateExactMetric } from './exact.mjs';
import {
  asRecord,
  assertCanonicalJson,
  assertNoForbiddenCapabilities,
  boundedString,
  enumValue,
  exactFields,
  fail,
  requireFields,
  safeInteger,
  stringArray,
} from './errors.mjs';

export const MAX_GRAPH_NODES = 4_096;
export const MAX_GRAPH_EDGES = 8_192;
export const MAX_CONCENTRATION_GROUPS = 1_536;

const GRAPH_NODE_KINDS = Object.freeze([
  'POSITION', 'PROPOSAL', 'LIABILITY', 'COLLATERAL_POOL', 'VENUE_EXPOSURE',
  'ASSET', 'SECTOR', 'VENUE', 'COLLATERAL', 'STRATEGY', 'STRATEGY_CLUSTER', 'FACTOR',
]);

const GRAPH_EDGE_KINDS = Object.freeze([
  'DECLARES_EXPOSURE_TO', 'MEMBER_OF_CLUSTER', 'SHARES_FACTOR', 'DECLARES_DEPENDENCE',
]);

const DIMENSIONS = Object.freeze([
  ['ASSET', 'assetId'],
  ['SECTOR', 'sectorId'],
  ['VENUE', 'venueId'],
  ['COLLATERAL', 'collateralId'],
  ['STRATEGY', 'strategyId'],
]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function subjects(snapshot) {
  return [
    ...snapshot.positions.map((row) => ({ ...row, subjectKind: 'POSITION' })),
    ...snapshot.proposals.map((row) => ({ ...row, subjectKind: 'PROPOSAL' })),
    ...snapshot.liabilities.map((row) => ({ ...row, subjectKind: 'LIABILITY' })),
    ...snapshot.collateral.map((row) => ({ ...row, subjectKind: 'COLLATERAL_POOL' })),
  ].sort((left, right) => compareText(left.id, right.id));
}

function graphHash(record) {
  return sha256(omitFields(record, ['graphHash']));
}

function nodeId(kind, value) {
  return `${kind}:${value}`;
}

function edgeId(from, to, kind, qualifier = '') {
  return `edge.${sha256({ from, to, kind, qualifier }).slice(0, 24)}`;
}

export function buildRelationshipGraph(snapshotInput) {
  validatePortfolioSnapshot(snapshotInput);
  const snapshot = cloneCanonical(snapshotInput);
  const nodes = new Map();
  const edges = new Map();

  const addNode = (node) => {
    const existing = nodes.get(node.id);
    if (!existing) {
      nodes.set(node.id, node);
      return;
    }
    const existingCore = { ...existing, sourceRefs: [] };
    const nodeCore = { ...node, sourceRefs: [] };
    if (sha256(existingCore) !== sha256(nodeCore)) fail('GRAPH_NODE_COLLISION', `graph node ${node.id} has conflicting definitions`);
    nodes.set(node.id, {
      ...existing,
      sourceRefs: [...new Set([...existing.sourceRefs, ...node.sourceRefs])].sort(compareText),
    });
  };
  const addEdge = (edge) => {
    const existing = edges.get(edge.id);
    if (existing && sha256(existing) !== sha256(edge)) fail('GRAPH_EDGE_COLLISION', `graph edge ${edge.id} has conflicting definitions`);
    edges.set(edge.id, edge);
  };

  for (const subject of subjects(snapshot)) {
    const subjectNodeId = nodeId(subject.subjectKind, subject.id);
    addNode({
      id: subjectNodeId,
      kind: subject.subjectKind,
      label: subject.id,
      sourceId: subject.id,
      exposure: subject.exposure,
      sourceRefs: [subject.ownerSnapshotRef],
    });
    for (const [kind, field] of DIMENSIONS) {
      const dimensionNodeId = nodeId(kind, subject[field]);
      addNode({ id: dimensionNodeId, kind, label: subject[field], sourceId: subject[field], exposure: null, sourceRefs: [subject.ownerSnapshotRef] });
      addEdge({
        id: edgeId(subjectNodeId, dimensionNodeId, 'DECLARES_EXPOSURE_TO', kind),
        from: subjectNodeId,
        to: dimensionNodeId,
        kind: 'DECLARES_EXPOSURE_TO',
        factorId: kind,
        dependencePpm: null,
        sourceRef: subject.ownerSnapshotRef,
        inferred: false,
      });
    }
  }

  for (const venue of snapshot.venueExposures) {
    const venueNodeId = nodeId('VENUE', venue.venueId);
    addNode({ id: venueNodeId, kind: 'VENUE', label: venue.venueId, sourceId: venue.venueId, exposure: null, sourceRefs: [venue.ownerSnapshotRef] });
    const aggregateNodeId = nodeId('VENUE_EXPOSURE', venue.id);
    addNode({ id: aggregateNodeId, kind: 'VENUE_EXPOSURE', label: venue.id, sourceId: venue.id, exposure: venue.exposure, sourceRefs: [venue.ownerSnapshotRef] });
    addEdge({
      id: edgeId(aggregateNodeId, venueNodeId, 'DECLARES_EXPOSURE_TO', 'VENUE'),
      from: aggregateNodeId,
      to: venueNodeId,
      kind: 'DECLARES_EXPOSURE_TO',
      factorId: 'VENUE',
      dependencePpm: null,
      sourceRef: venue.ownerSnapshotRef,
      inferred: false,
    });
  }

  for (const cluster of snapshot.strategyClusters) {
    const clusterId = nodeId('STRATEGY_CLUSTER', cluster.clusterId);
    addNode({ id: clusterId, kind: 'STRATEGY_CLUSTER', label: cluster.clusterId, sourceId: cluster.clusterId, exposure: null, sourceRefs: [cluster.sourceRef] });
    for (const strategyId of cluster.strategyIds) {
      const strategyNodeId = nodeId('STRATEGY', strategyId);
      addNode({ id: strategyNodeId, kind: 'STRATEGY', label: strategyId, sourceId: strategyId, exposure: null, sourceRefs: [cluster.sourceRef] });
      addEdge({
        id: edgeId(strategyNodeId, clusterId, 'MEMBER_OF_CLUSTER'),
        from: strategyNodeId,
        to: clusterId,
        kind: 'MEMBER_OF_CLUSTER',
        factorId: cluster.clusterId,
        dependencePpm: null,
        sourceRef: cluster.sourceRef,
        inferred: false,
      });
    }
    for (const factorId of cluster.factorIds) {
      const factorNodeId = nodeId('FACTOR', factorId);
      addNode({ id: factorNodeId, kind: 'FACTOR', label: factorId, sourceId: factorId, exposure: null, sourceRefs: [cluster.sourceRef] });
      addEdge({
        id: edgeId(clusterId, factorNodeId, 'SHARES_FACTOR'),
        from: clusterId,
        to: factorNodeId,
        kind: 'SHARES_FACTOR',
        factorId,
        dependencePpm: null,
        sourceRef: cluster.sourceRef,
        inferred: false,
      });
    }
  }

  const dimensionIndex = new Map();
  for (const node of nodes.values()) {
    if (!['ASSET', 'SECTOR', 'VENUE', 'COLLATERAL', 'STRATEGY'].includes(node.kind)) continue;
    const candidates = dimensionIndex.get(node.sourceId) ?? [];
    candidates.push(node.id);
    dimensionIndex.set(node.sourceId, candidates);
  }
  for (const link of snapshot.factorLinks) {
    const left = dimensionIndex.get(link.leftId) ?? [];
    const right = dimensionIndex.get(link.rightId) ?? [];
    if (left.length !== 1 || right.length !== 1) fail('FACTOR_ENDPOINT_AMBIGUOUS', `factor ${link.factorId} endpoints must resolve to one declared dimension each`);
    addEdge({
      id: edgeId(left[0], right[0], 'DECLARES_DEPENDENCE', link.factorId),
      from: left[0],
      to: right[0],
      kind: 'DECLARES_DEPENDENCE',
      factorId: link.factorId,
      dependencePpm: link.dependencePpm,
      sourceRef: link.sourceRef,
      inferred: false,
    });
  }

  const graph = {
    schema: 'ScenarioRelationshipGraphV1',
    version: 1,
    snapshotHash: snapshot.snapshotHash,
    graphClass: 'SCENARIO_RELATIONSHIP_GRAPH',
    nodes: [...nodes.values()].sort((left, right) => compareText(left.id, right.id)),
    edges: [...edges.values()].sort((left, right) => compareText(left.id, right.id)),
    causal: false,
    probabilityModel: null,
    unknownRelationshipMeaning: 'ABSENT_EDGE_IS_UNKNOWN_NOT_INDEPENDENT',
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    canonical: false,
  };
  if (graph.nodes.length > MAX_GRAPH_NODES || graph.edges.length > MAX_GRAPH_EDGES) {
    fail('GRAPH_RESOURCE_BOUND_EXCEEDED', `relationship graph exceeds ${MAX_GRAPH_NODES} nodes or ${MAX_GRAPH_EDGES} edges`);
  }
  graph.graphHash = graphHash(graph);
  return deepFreeze(graph);
}

function concentrationRows(snapshot, dimension, field) {
  const included = [
    ...snapshot.positions.map((row) => ({ ...row, subjectKind: 'POSITION' })),
    ...snapshot.proposals.map((row) => ({ ...row, subjectKind: 'PROPOSAL' })),
    ...snapshot.liabilities.map((row) => ({ ...row, subjectKind: 'LIABILITY' })),
  ];
  const groups = new Map();
  const unknownSubjectIds = [];
  let totalKnown = 0n;
  for (const subject of included) {
    const amount = absoluteAtoms(subject.exposure, snapshot.reportingUnit, `${subject.id}.exposure`);
    if (amount === null) {
      unknownSubjectIds.push(subject.id);
      continue;
    }
    totalKnown += amount;
    groups.set(subject[field], (groups.get(subject[field]) ?? 0n) + amount);
  }
  const complete = unknownSubjectIds.length === 0;
  const rows = [...groups.entries()].map(([key, atoms]) => ({
    key,
    knownAbsoluteExposure: knownMetric(atoms, snapshot.reportingUnit),
    sharePpm: complete && totalKnown > 0n ? Number((atoms * 1_000_000n) / totalKnown) : null,
    shareRounding: complete && totalKnown > 0n ? 'FLOOR_TO_PPM' : null,
  })).sort((left, right) => {
    const leftValue = BigInt(left.knownAbsoluteExposure.atoms);
    const rightValue = BigInt(right.knownAbsoluteExposure.atoms);
    return leftValue === rightValue ? compareText(left.key, right.key) : leftValue > rightValue ? -1 : 1;
  });
  const sumSquares = [...groups.values()].reduce((sum, atoms) => sum + (atoms * atoms), 0n);
  const hhiPpm = complete && totalKnown > 0n ? Number((sumSquares * 1_000_000n) / (totalKnown * totalKnown)) : null;
  return {
    dimension,
    knownLowerBound: knownMetric(totalKnown, snapshot.reportingUnit),
    total: complete ? knownMetric(totalKnown, snapshot.reportingUnit) : null,
    unknownCount: unknownSubjectIds.length,
    unknownSubjectIds: unknownSubjectIds.sort(compareText),
    hhiPpm,
    hhiRounding: hhiPpm === null ? null : 'FLOOR_TO_PPM',
    groups: rows,
  };
}

export function buildConcentrationMap(snapshotInput) {
  validatePortfolioSnapshot(snapshotInput);
  const snapshot = cloneCanonical(snapshotInput);
  const dimensions = DIMENSIONS.map(([dimension, field]) => concentrationRows(snapshot, dimension, field));
  const map = {
    schema: 'PortfolioConcentrationMapV1',
    version: 1,
    snapshotHash: snapshot.snapshotHash,
    reportingUnit: snapshot.reportingUnit,
    includedSubjectKinds: ['POSITION', 'PROPOSAL', 'LIABILITY'],
    excludedFromAggregate: ['COLLATERAL_POOL', 'VENUE_EXPOSURE_AGGREGATE'],
    dimensions,
    unknownRule: 'UNKNOWN_MEMBERS_PREVENT_TOTAL_AND_HHI',
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    canonical: false,
  };
  map.concentrationHash = sha256(omitFields(map, ['concentrationHash']));
  return deepFreeze(map);
}

export function validateRelationshipGraph(input, snapshotInput) {
  const graph = asRecord(input, 'ScenarioRelationshipGraphV1');
  const fields = [
    'schema', 'version', 'snapshotHash', 'graphClass', 'nodes', 'edges', 'causal',
    'probabilityModel', 'unknownRelationshipMeaning', 'authorityClass', 'networkMode',
    'canonical', 'graphHash',
  ];
  exactFields(graph, fields, 'ScenarioRelationshipGraphV1');
  requireFields(graph, fields, 'ScenarioRelationshipGraphV1');
  assertCanonicalJson(graph, 'ScenarioRelationshipGraphV1');
  assertNoForbiddenCapabilities(graph);
  if (graph.schema !== 'ScenarioRelationshipGraphV1' || graph.version !== 1
    || graph.graphClass !== 'SCENARIO_RELATIONSHIP_GRAPH') {
    fail('GRAPH_CONTRACT_INVALID', 'relationship graph must use ScenarioRelationshipGraphV1');
  }
  if (!/^[a-f0-9]{64}$/.test(graph.snapshotHash) || !/^[a-f0-9]{64}$/.test(graph.graphHash)) fail('GRAPH_HASH_INVALID', 'graph hashes must be SHA-256');
  if (!Array.isArray(graph.nodes) || graph.nodes.length > MAX_GRAPH_NODES
    || !Array.isArray(graph.edges) || graph.edges.length > MAX_GRAPH_EDGES) {
    fail('GRAPH_RESOURCE_BOUND_EXCEEDED', 'relationship graph exceeds its node or edge budget');
  }
  const nodeIds = new Set();
  for (const [index, node] of graph.nodes.entries()) {
    const name = `ScenarioRelationshipGraphV1.nodes[${index}]`;
    asRecord(node, name);
    exactFields(node, ['id', 'kind', 'label', 'sourceId', 'exposure', 'sourceRefs'], name);
    requireFields(node, ['id', 'kind', 'label', 'sourceId', 'exposure', 'sourceRefs'], name);
    for (const field of ['id', 'kind', 'label', 'sourceId']) boundedString(node[field], `${name}.${field}`, 256);
    enumValue(node.kind, GRAPH_NODE_KINDS, `${name}.kind`);
    if (nodeIds.has(node.id)) fail('GRAPH_NODE_DUPLICATE', `${node.id} is duplicated`);
    nodeIds.add(node.id);
    stringArray(node.sourceRefs, `${name}.sourceRefs`, 64);
    if (node.sourceRefs.length === 0) fail('GRAPH_SOURCE_REQUIRED', `${name} needs immutable source evidence`);
    if (node.exposure !== null) validateExactMetric(node.exposure, null, `${name}.exposure`);
  }
  const edgeIds = new Set();
  for (const [index, edge] of graph.edges.entries()) {
    const name = `ScenarioRelationshipGraphV1.edges[${index}]`;
    asRecord(edge, name);
    exactFields(edge, ['id', 'from', 'to', 'kind', 'factorId', 'dependencePpm', 'sourceRef', 'inferred'], name);
    requireFields(edge, ['id', 'from', 'to', 'kind', 'factorId', 'dependencePpm', 'sourceRef', 'inferred'], name);
    for (const field of ['id', 'from', 'to', 'kind', 'factorId', 'sourceRef']) boundedString(edge[field], `${name}.${field}`, field === 'sourceRef' ? 8_192 : 256);
    enumValue(edge.kind, GRAPH_EDGE_KINDS, `${name}.kind`);
    if (edgeIds.has(edge.id)) fail('GRAPH_EDGE_DUPLICATE', `${edge.id} is duplicated`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) fail('GRAPH_EDGE_DANGLING', `${edge.id} has a missing endpoint`);
    if (edge.dependencePpm !== null) safeInteger(edge.dependencePpm, `${name}.dependencePpm`, { minimum: -1_000_000, maximum: 1_000_000 });
    if (edge.inferred !== false) fail('GRAPH_INFERENCE_FORBIDDEN', `${edge.id} cannot be inferred`);
  }
  if (graph.causal !== false || graph.probabilityModel !== null
    || graph.unknownRelationshipMeaning !== 'ABSENT_EDGE_IS_UNKNOWN_NOT_INDEPENDENT') {
    fail('GRAPH_TRUTH_WIDENING', 'relationship graph cannot claim causality, probability, or absent-edge independence');
  }
  if (graph.authorityClass !== 'NO_AUTHORITY' || graph.networkMode !== 'FIXTURE_ONLY' || graph.canonical !== false) {
    fail('AUTHORITY_BOUNDARY_INVALID', 'relationship graph must remain fixture-only, non-canonical, and non-authoritative');
  }
  if (graph.graphHash !== graphHash(graph)) fail('GRAPH_HASH_MISMATCH', 'graphHash does not match canonical content');
  validatePortfolioSnapshot(snapshotInput);
  if (graph.snapshotHash !== snapshotInput.snapshotHash) fail('SNAPSHOT_BINDING_MISMATCH', 'relationship graph must bind its supplied source snapshot');
  const expectedGraph = buildRelationshipGraph(snapshotInput);
  if (sha256(graph) !== sha256(expectedGraph)) fail('GRAPH_SOURCE_BINDING_MISMATCH', 'relationship graph must be the exact deterministic projection of its supplied source snapshot');
  return true;
}

export function validateConcentrationMap(input, snapshotInput) {
  const map = asRecord(input, 'PortfolioConcentrationMapV1');
  const fields = [
    'schema', 'version', 'snapshotHash', 'reportingUnit', 'includedSubjectKinds',
    'excludedFromAggregate', 'dimensions', 'unknownRule', 'authorityClass', 'networkMode',
    'canonical', 'concentrationHash',
  ];
  exactFields(map, fields, 'PortfolioConcentrationMapV1');
  requireFields(map, fields, 'PortfolioConcentrationMapV1');
  assertCanonicalJson(map, 'PortfolioConcentrationMapV1');
  assertNoForbiddenCapabilities(map);
  if (map.schema !== 'PortfolioConcentrationMapV1' || map.version !== 1) fail('CONCENTRATION_CONTRACT_INVALID', 'concentration map must use PortfolioConcentrationMapV1');
  if (!/^[a-f0-9]{64}$/.test(map.snapshotHash) || !/^[a-f0-9]{64}$/.test(map.concentrationHash)) fail('CONCENTRATION_HASH_INVALID', 'concentration hashes must be SHA-256');
  boundedString(map.reportingUnit, 'PortfolioConcentrationMapV1.reportingUnit', 64);
  if (sha256(map.includedSubjectKinds) !== sha256(['POSITION', 'PROPOSAL', 'LIABILITY'])
    || sha256(map.excludedFromAggregate) !== sha256(['COLLATERAL_POOL', 'VENUE_EXPOSURE_AGGREGATE'])) {
    fail('CONCENTRATION_AGGREGATE_SCOPE_INVALID', 'concentration scope must exclude duplicate collateral and venue aggregates');
  }
  if (!Array.isArray(map.dimensions) || map.dimensions.length !== DIMENSIONS.length) fail('CONCENTRATION_DIMENSION_INVALID', 'concentration map needs all five dimensions');
  map.dimensions.forEach((row, index) => {
    const name = `PortfolioConcentrationMapV1.dimensions[${index}]`;
    asRecord(row, name);
    exactFields(row, ['dimension', 'knownLowerBound', 'total', 'unknownCount', 'unknownSubjectIds', 'hhiPpm', 'hhiRounding', 'groups'], name);
    requireFields(row, ['dimension', 'knownLowerBound', 'total', 'unknownCount', 'unknownSubjectIds', 'hhiPpm', 'hhiRounding', 'groups'], name);
    if (row.dimension !== DIMENSIONS[index][0]) fail('CONCENTRATION_DIMENSION_INVALID', `${name} is out of frozen order`);
    validateExactMetric(row.knownLowerBound, map.reportingUnit, `${name}.knownLowerBound`);
    if (row.knownLowerBound.state !== 'KNOWN') fail('CONCENTRATION_KNOWN_SUBTOTAL_INVALID', `${name}.knownLowerBound must be known`);
    safeInteger(row.unknownCount, `${name}.unknownCount`, { minimum: 0, maximum: 1_536 });
    stringArray(row.unknownSubjectIds, `${name}.unknownSubjectIds`, 1_536);
    if (row.unknownCount !== row.unknownSubjectIds.length) fail('CONCENTRATION_UNKNOWN_COUNT_MISMATCH', `${name} unknown count does not match IDs`);
    if (row.unknownCount > 0) {
      if (row.total !== null || row.hhiPpm !== null || row.hhiRounding !== null) fail('CONCENTRATION_UNKNOWN_FALSE_PRECISION', `${name} cannot publish total or HHI with unknown inputs`);
    } else {
      validateExactMetric(row.total, map.reportingUnit, `${name}.total`);
      if (row.total.state !== 'KNOWN' || row.total.atoms !== row.knownLowerBound.atoms) fail('CONCENTRATION_TOTAL_MISMATCH', `${name} complete total must equal known subtotal`);
      const nonZeroTotal = parseAtoms(row.total.atoms, `${name}.total.atoms`) !== 0n;
      if (nonZeroTotal) {
        safeInteger(row.hhiPpm, `${name}.hhiPpm`, { minimum: 0, maximum: 1_000_000 });
        if (row.hhiRounding !== 'FLOOR_TO_PPM') fail('CONCENTRATION_ROUNDING_INVALID', `${name} HHI rounding is invalid`);
      } else if (row.hhiPpm !== null || row.hhiRounding !== null) {
        fail('CONCENTRATION_ROUNDING_INVALID', `${name} zero-total HHI and rounding must be null`);
      }
    }
    if (!Array.isArray(row.groups) || row.groups.length > MAX_CONCENTRATION_GROUPS) {
      fail('CONCENTRATION_GROUPS_INVALID', `${name}.groups must contain at most ${MAX_CONCENTRATION_GROUPS} rows`);
    }
    const groupKeys = new Set();
    row.groups.forEach((group, groupIndex) => {
      const groupName = `${name}.groups[${groupIndex}]`;
      asRecord(group, groupName);
      exactFields(group, ['key', 'knownAbsoluteExposure', 'sharePpm', 'shareRounding'], groupName);
      requireFields(group, ['key', 'knownAbsoluteExposure', 'sharePpm', 'shareRounding'], groupName);
      boundedString(group.key, `${groupName}.key`, 256);
      if (groupKeys.has(group.key)) fail('CONCENTRATION_GROUP_DUPLICATE', `${groupName}.key is duplicated`);
      groupKeys.add(group.key);
      validateExactMetric(group.knownAbsoluteExposure, map.reportingUnit, `${groupName}.knownAbsoluteExposure`);
      if (group.knownAbsoluteExposure.state !== 'KNOWN') fail('CONCENTRATION_GROUP_EXPOSURE_INVALID', `${groupName}.knownAbsoluteExposure must be known`);
      if (row.unknownCount > 0 && (group.sharePpm !== null || group.shareRounding !== null)) fail('CONCENTRATION_UNKNOWN_FALSE_PRECISION', `${groupName} cannot publish a share with unknown inputs`);
      if (row.unknownCount === 0 && parseAtoms(row.total.atoms, `${name}.total.atoms`) !== 0n) {
        safeInteger(group.sharePpm, `${groupName}.sharePpm`, { minimum: 0, maximum: 1_000_000 });
        if (group.shareRounding !== 'FLOOR_TO_PPM') fail('CONCENTRATION_ROUNDING_INVALID', `${groupName} share rounding is invalid`);
      } else if (row.unknownCount === 0 && (group.sharePpm !== null || group.shareRounding !== null)) {
        fail('CONCENTRATION_ROUNDING_INVALID', `${groupName} zero-total share and rounding must be null`);
      }
    });
  });
  if (map.unknownRule !== 'UNKNOWN_MEMBERS_PREVENT_TOTAL_AND_HHI') fail('CONCENTRATION_UNKNOWN_RULE_INVALID', 'unknown rule changed');
  if (map.authorityClass !== 'NO_AUTHORITY' || map.networkMode !== 'FIXTURE_ONLY' || map.canonical !== false) fail('AUTHORITY_BOUNDARY_INVALID', 'concentration map must remain fixture-only, non-canonical, and non-authoritative');
  if (map.concentrationHash !== sha256(omitFields(map, ['concentrationHash']))) fail('CONCENTRATION_HASH_MISMATCH', 'concentrationHash does not match canonical content');
  validatePortfolioSnapshot(snapshotInput);
  if (map.snapshotHash !== snapshotInput.snapshotHash) fail('SNAPSHOT_BINDING_MISMATCH', 'concentration map must bind its supplied source snapshot');
  const expectedMap = buildConcentrationMap(snapshotInput);
  if (sha256(map) !== sha256(expectedMap)) fail('CONCENTRATION_SOURCE_BINDING_MISMATCH', 'concentration map must be the exact deterministic projection of its supplied source snapshot');
  return true;
}

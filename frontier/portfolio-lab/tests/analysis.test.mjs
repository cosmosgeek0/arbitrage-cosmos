import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildConcentrationMap,
  buildRelationshipGraph,
  createPortfolioSnapshot,
  validateConcentrationMap,
  validateRelationshipGraph,
} from '../src/index.mjs';
import { omitFields, sha256 } from '../../dock/src/canonical.mjs';
import { baseSnapshot, unknown } from './helpers.mjs';

test('relationship graph is a deterministic declared projection, never causal truth', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const first = buildRelationshipGraph(snapshot);
  const second = buildRelationshipGraph(snapshot);
  assert.equal(first.graphHash, second.graphHash);
  assert.equal(first.graphClass, 'SCENARIO_RELATIONSHIP_GRAPH');
  assert.equal(first.causal, false);
  assert.equal(first.probabilityModel, null);
  assert.equal(first.canonical, false);
  assert.equal(first.authorityClass, 'NO_AUTHORITY');
  assert.equal(first.networkMode, 'FIXTURE_ONLY');
  assert.equal(first.nodes.some((node) => node.id === 'ASSET:BTC'), true);
  assert.equal(first.nodes.some((node) => node.id === 'STRATEGY_CLUSTER:cluster.convergence'), true);
  assert.equal(first.edges.some((edge) => edge.kind === 'DECLARES_DEPENDENCE' && edge.factorId === 'MAJOR_BETA'), true);
  assert.equal(first.edges.every((edge) => edge.inferred === false), true);
  assert.equal(Object.isFrozen(first.edges), true);
});

test('relationship graph rejects ambiguous factor endpoints instead of inventing a mapping', () => {
  const input = baseSnapshot();
  input.factorLinks.push({
    leftId: 'USDT', rightId: 'BTC', factorId: 'AMBIGUOUS_USDT', dependencePpm: 250000,
    sourceRef: input.ownerSnapshotRefs[2],
  });
  const snapshot = createPortfolioSnapshot(input);
  assert.throws(() => buildRelationshipGraph(snapshot), (error) => error.code === 'FACTOR_ENDPOINT_AMBIGUOUS');
});

test('concentration uses exact absolute exposure and excludes duplicate aggregate views', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const map = buildConcentrationMap(snapshot);
  const assets = map.dimensions.find((row) => row.dimension === 'ASSET');
  assert.equal(assets.knownLowerBound.atoms, '1200000000');
  assert.equal(assets.total.atoms, '1200000000');
  assert.equal(assets.unknownCount, 0);
  assert.equal(assets.hhiPpm, 503472);
  assert.deepEqual(assets.groups.map((row) => [row.key, row.knownAbsoluteExposure.atoms]), [
    ['BTC', '800000000'],
    ['ALT', '250000000'],
    ['ETH', '150000000'],
  ]);
  assert.deepEqual(map.excludedFromAggregate, ['COLLATERAL_POOL', 'VENUE_EXPOSURE_AGGREGATE']);
});

test('unknown exposure produces a lower bound, not a fabricated total or HHI', () => {
  const input = baseSnapshot();
  input.truthState = 'PARTIAL';
  input.missingDependencies = ['PROPOSAL_CAPACITY_UNAVAILABLE'];
  input.proposals[0].exposure = unknown('PROPOSAL_CAPACITY_UNAVAILABLE');
  const map = buildConcentrationMap(createPortfolioSnapshot(input));
  for (const dimension of map.dimensions) {
    assert.equal(dimension.knownLowerBound.atoms, '1050000000');
    assert.equal(dimension.total, null);
    assert.equal(dimension.hhiPpm, null);
    assert.deepEqual(dimension.unknownSubjectIds, ['proposal.basis.eth']);
  }
});

test('relationship graph fails closed when a valid snapshot would exceed the fixed graph budget', () => {
  const input = baseSnapshot();
  const expand = (template, prefix, count) => Array.from({ length: count }, (_, index) => ({
    ...structuredClone(template),
    id: `${prefix}.${index}`,
    assetId: `ASSET_${prefix}_${index}`,
    sectorId: `SECTOR_${prefix}_${index}`,
    venueId: `VENUE_${prefix}_${index}`,
    collateralId: `COLLATERAL_${prefix}_${index}`,
    strategyId: `STRATEGY_${prefix}_${index}`,
    sourceRevision: `${prefix}-r${index}`,
  }));
  input.positions = expand(input.positions[0], 'position.bound', 512);
  input.proposals = expand(input.proposals[0], 'proposal.bound', 512);
  input.strategyClusters = [];
  input.factorLinks = [];
  const snapshot = createPortfolioSnapshot(input);
  assert.throws(
    () => buildRelationshipGraph(snapshot),
    (error) => error.code === 'GRAPH_RESOURCE_BOUND_EXCEEDED',
  );
});

test('graph validators reject rehashed invented node and edge kinds', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const graph = buildRelationshipGraph(snapshot);
  const inventedNode = structuredClone(graph);
  inventedNode.nodes[0].kind = 'INVENTED_NODE';
  inventedNode.graphHash = sha256(omitFields(inventedNode, ['graphHash']));
  assert.throws(() => validateRelationshipGraph(inventedNode, snapshot), (error) => error.code === 'ENUM_INVALID');

  const inventedEdge = structuredClone(graph);
  inventedEdge.edges[0].kind = 'INVENTED_EDGE';
  inventedEdge.graphHash = sha256(omitFields(inventedEdge, ['graphHash']));
  assert.throws(() => validateRelationshipGraph(inventedEdge, snapshot), (error) => error.code === 'ENUM_INVALID');
});

test('concentration validators reject unknown subtotals, unknown group exposure, and duplicate groups', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const map = buildConcentrationMap(snapshot);

  const unknownSubtotal = structuredClone(map);
  unknownSubtotal.dimensions[0].knownLowerBound = unknown('FORGED_UNKNOWN_SUBTOTAL');
  unknownSubtotal.concentrationHash = sha256(omitFields(unknownSubtotal, ['concentrationHash']));
  assert.throws(() => validateConcentrationMap(unknownSubtotal, snapshot), (error) => error.code === 'CONCENTRATION_KNOWN_SUBTOTAL_INVALID');

  const unknownGroup = structuredClone(map);
  unknownGroup.dimensions[0].groups[0].knownAbsoluteExposure = unknown('FORGED_UNKNOWN_GROUP');
  unknownGroup.concentrationHash = sha256(omitFields(unknownGroup, ['concentrationHash']));
  assert.throws(() => validateConcentrationMap(unknownGroup, snapshot), (error) => error.code === 'CONCENTRATION_GROUP_EXPOSURE_INVALID');

  const duplicateGroup = structuredClone(map);
  duplicateGroup.dimensions[0].groups.push(structuredClone(duplicateGroup.dimensions[0].groups[0]));
  duplicateGroup.concentrationHash = sha256(omitFields(duplicateGroup, ['concentrationHash']));
  assert.throws(() => validateConcentrationMap(duplicateGroup, snapshot), (error) => error.code === 'CONCENTRATION_GROUP_DUPLICATE');

  const tooManyGroups = structuredClone(map);
  tooManyGroups.dimensions[0].groups = Array.from({ length: 1_537 }, (_, index) => ({
    key: `GROUP_${index}`,
    knownAbsoluteExposure: { state: 'KNOWN', unit: 'USDT_MICRO', atoms: '1', reason: null },
    sharePpm: 0,
    shareRounding: 'FLOOR_TO_PPM',
  }));
  tooManyGroups.concentrationHash = sha256(omitFields(tooManyGroups, ['concentrationHash']));
  assert.throws(() => validateConcentrationMap(tooManyGroups, snapshot), (error) => error.code === 'CONCENTRATION_GROUPS_INVALID');
});

test('concentration validators reject rehashed null HHI and share precision on complete nonzero maps', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const map = buildConcentrationMap(snapshot);

  const missingHhi = structuredClone(map);
  missingHhi.dimensions[0].hhiPpm = null;
  missingHhi.concentrationHash = sha256(omitFields(missingHhi, ['concentrationHash']));
  assert.throws(() => validateConcentrationMap(missingHhi, snapshot), (error) => error.code === 'INTEGER_INVALID');

  const missingShare = structuredClone(map);
  missingShare.dimensions[0].groups[0].sharePpm = null;
  missingShare.concentrationHash = sha256(omitFields(missingShare, ['concentrationHash']));
  assert.throws(() => validateConcentrationMap(missingShare, snapshot), (error) => error.code === 'INTEGER_INVALID');
});

test('analysis validators reject self-rehashed values not derived from the supplied snapshot', () => {
  const snapshot = createPortfolioSnapshot(baseSnapshot());
  const forgedGraph = structuredClone(buildRelationshipGraph(snapshot));
  const dependence = forgedGraph.edges.find((edge) => edge.kind === 'DECLARES_DEPENDENCE');
  dependence.dependencePpm = 123456;
  dependence.sourceRef = 'fixture://forged-owner-output';
  forgedGraph.graphHash = sha256(omitFields(forgedGraph, ['graphHash']));
  assert.throws(
    () => validateRelationshipGraph(forgedGraph, snapshot),
    (error) => error.code === 'GRAPH_SOURCE_BINDING_MISMATCH',
  );

  const forgedConcentration = structuredClone(buildConcentrationMap(snapshot));
  forgedConcentration.dimensions[0].groups[0].knownAbsoluteExposure.atoms = '999999999';
  forgedConcentration.concentrationHash = sha256(omitFields(forgedConcentration, ['concentrationHash']));
  assert.throws(
    () => validateConcentrationMap(forgedConcentration, snapshot),
    (error) => error.code === 'CONCENTRATION_SOURCE_BINDING_MISMATCH',
  );
});

import {
  makeStableFailure,
  sortedUnique,
  stableId,
  type StableFailure,
} from '../../intelligenceFoundation/contracts/index.js';
import {
  buildUniverseGraph,
  type ListingObservation,
  type UniverseAliasEntry,
  type UniverseGraph,
  type UniversePolicy,
  type UniverseSnapshotInput,
  type UniverseSourceSlice,
} from '../../intelligenceFoundation/universe/index.js';
import { runtimeUniverseTruth } from './truth.js';

const MAXIMUM_RECORDS_PER_FOUNDATION_SHARD = 128;
const MAXIMUM_RECORDS_PER_CANONICAL_MARKET = 512;
const MAXIMUM_FOUNDATION_SHARDS = 1_024;
const SHARD_COMPOSER_SOURCE_ID = 'live-intelligence-runtime.universe-shard-composer';

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function marketKey(record: ListingObservation): string {
  const { instrument } = record;
  if (instrument.quoteAsset === null) throw new TypeError('public listing requires a quote asset');
  return `${instrument.venue}\u0000${instrument.baseAsset}\u0000${instrument.quoteAsset}`;
}

interface MarketGroup {
  readonly key: string;
  readonly spot: ListingObservation[];
  readonly futures: ListingObservation[];
}

interface GraphShard {
  readonly spot: ListingObservation[];
  readonly futures: ListingObservation[];
}

function groupsOf(input: UniverseSnapshotInput): MarketGroup[] {
  const groups = new Map<string, { spot: ListingObservation[]; futures: ListingObservation[] }>();
  for (const [source, records] of [
    ['SPOT', input.spot.records],
    ['USD_M_PERPETUAL', input.usdMPerpetual.records],
  ] as const) {
    for (const record of records) {
      const key = marketKey(record);
      const group = groups.get(key) ?? { spot: [], futures: [] };
      (source === 'SPOT' ? group.spot : group.futures).push(record);
      if (group.spot.length + group.futures.length > MAXIMUM_RECORDS_PER_CANONICAL_MARKET) {
        throw new RangeError('one canonical market exceeds the bounded Foundation shard capacity');
      }
      groups.set(key, group);
    }
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      spot: group.spot.sort((left, right) => codePointCompare(left.id, right.id)),
      futures: group.futures.sort((left, right) => codePointCompare(left.id, right.id)),
    }))
    .sort((left, right) => codePointCompare(left.key, right.key));
}

function shardsOf(groups: readonly MarketGroup[]): GraphShard[] {
  const shards: GraphShard[] = [];
  let spot: ListingObservation[] = [];
  let futures: ListingObservation[] = [];
  const flush = (): void => {
    if (spot.length + futures.length === 0) return;
    shards.push({ spot, futures });
    spot = [];
    futures = [];
  };
  for (const group of groups) {
    const groupSize = group.spot.length + group.futures.length;
    if (spot.length + futures.length > 0
      && spot.length + futures.length + groupSize > MAXIMUM_RECORDS_PER_FOUNDATION_SHARD) flush();
    spot.push(...group.spot);
    futures.push(...group.futures);
  }
  flush();
  if (shards.length > MAXIMUM_FOUNDATION_SHARDS) {
    throw new RangeError('public universe exceeds the bounded Foundation shard count');
  }
  return shards;
}

function shardSlice(
  slice: UniverseSourceSlice<ListingObservation>,
  records: readonly ListingObservation[],
  observedAtMs: number,
  sourceStaleAfterMs: number,
): UniverseSourceSlice<ListingObservation> {
  if (slice.state === 'UNAVAILABLE') return { source: slice.source, state: slice.state, records: [], truth: slice.truth };
  const receivedTimeMs = records.reduce(
    (oldest, record) => Math.min(oldest, record.truth.temporal.receivedTimeMs),
    slice.truth.temporal.receivedTimeMs,
  );
  const complete = slice.state === 'COMPLETE';
  return {
    source: slice.source,
    state: slice.state,
    records: [...records],
    truth: runtimeUniverseTruth({
      configurationVersion: slice.truth.configurationVersion,
      sourceId: slice.truth.authority.sourceId,
      dataset: slice.truth.authority.dataset,
      endpointClass: slice.truth.authority.endpointClass,
      authorityKind: slice.truth.authority.kind,
      evaluatedAtMs: observedAtMs,
      receivedTimeMs,
      maxAgeMs: sourceStaleAfterMs,
      sourceRecordIds: records.map((record) => record.id),
      sourceSet: slice.truth.provenance.sourceSet,
      transforms: [...slice.truth.provenance.transforms, 'bounded-foundation-universe-shard-v1'],
      completeness: complete ? 'COMPLETE' : 'PARTIAL',
      observedFields: ['symbols'],
      missingFields: complete ? [] : ['completeExchangeInfoRefresh'],
      reasonCodes: complete ? [] : ['FOUNDATION_SHARD_SOURCE_PARTIAL'],
    }),
  };
}

function shardInput(
  input: UniverseSnapshotInput,
  shard: GraphShard,
  sourceStaleAfterMs: number,
): UniverseSnapshotInput {
  return {
    observedAtMs: input.observedAtMs,
    spot: shardSlice(input.spot, shard.spot, input.observedAtMs, sourceStaleAfterMs),
    usdMPerpetual: shardSlice(input.usdMPerpetual, shard.futures, input.observedAtMs, sourceStaleAfterMs),
    margin: input.margin,
    borrow: input.borrow,
    coverage: input.coverage,
  };
}

function mergeAliases(
  graphs: readonly UniverseGraph[],
  failures: StableFailure[],
): UniverseAliasEntry[] {
  const groups = new Map<string, UniverseAliasEntry[]>();
  for (const graph of graphs) {
    for (const entry of graph.aliases) {
      const group = groups.get(entry.alias) ?? [];
      group.push(entry);
      groups.set(entry.alias, group);
    }
  }
  const aliases: UniverseAliasEntry[] = [];
  for (const alias of [...groups.keys()].sort(codePointCompare)) {
    const entries = groups.get(alias)!.sort((left, right) => codePointCompare(left.nodeId, right.nodeId));
    const nodeIds = sortedUnique(entries.map((entry) => entry.nodeId));
    if (nodeIds.length !== 1) {
      failures.push(makeStableFailure(
        'INVALID_VALUE',
        'runtime_universe',
        `alias ${alias} maps to multiple canonical markets`,
        `aliases.${alias}`,
        nodeIds,
      ));
      continue;
    }
    aliases.push({
      id: stableId('universe-alias', { alias, nodeId: nodeIds[0] }),
      alias,
      nodeId: nodeIds[0],
      productFamilies: sortedUnique(entries.flatMap((entry) => entry.productFamilies)),
      sourceRecordIds: sortedUnique(entries.flatMap((entry) => entry.sourceRecordIds)),
      truth: entries[0].truth,
    });
  }
  return aliases;
}

/**
 * The frozen Foundation validates a whole input graph with a 50k-node safety
 * walk. Current public exchangeInfo is larger, so this runtime adapter feeds
 * bounded canonical-market shards through the authoritative builder and only
 * composes its already-normalized outputs. It does not recreate eligibility,
 * availability, rule, or node semantics.
 */
export function buildRuntimeUniverseGraph(
  input: UniverseSnapshotInput,
  policy: UniversePolicy,
  sourceStaleAfterMs: number,
): UniverseGraph {
  const groups = groupsOf(input);
  if (groups.length === 0) return buildUniverseGraph(input, policy);
  const shards = shardsOf(groups);
  const graphs = shards.map((shard) => buildUniverseGraph(shardInput(input, shard, sourceStaleAfterMs), policy));
  const failures = [...new Map(graphs.flatMap((graph) => graph.failures).map((failure) => [failure.id, failure])).values()];
  const nodeGroups = new Map<string, UniverseGraph['nodes']>();
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      const group = nodeGroups.get(node.id) ?? [];
      group.push(node);
      nodeGroups.set(node.id, group);
    }
  }
  const nodes = [...nodeGroups.keys()].sort(codePointCompare).map((nodeId) => {
    const matches = nodeGroups.get(nodeId)!;
    if (matches.length > 1) {
      failures.push(makeStableFailure(
        'DUPLICATE_EVENT',
        'runtime_universe',
        'canonical market appeared in multiple Foundation shards',
        nodeId,
        matches.map((node) => node.id),
      ));
    }
    return matches[0];
  });
  const aliases = mergeAliases(graphs, failures);
  const normalizedFailures = [...new Map(failures.map((failure) => [failure.id, failure])).values()]
    .sort((left, right) => codePointCompare(left.id, right.id));
  const sourceStates: UniverseGraph['sourceStates'] = {
    SPOT: input.spot.state,
    USD_M_PERPETUAL: input.usdMPerpetual.state,
    MARGIN: input.margin.state,
    BORROW: input.borrow.state,
    COVERAGE: input.coverage.state,
  };
  const missingSources = Object.entries(sourceStates)
    .filter(([, state]) => state !== 'COMPLETE')
    .map(([source]) => `${source.toLowerCase()} source`)
    .sort(codePointCompare);
  const publicTruths = [input.spot.truth, input.usdMPerpetual.truth];
  const receivedTimeMs = Math.min(...publicTruths.map((truth) => truth.temporal.receivedTimeMs));
  const graphTruth = runtimeUniverseTruth({
    configurationVersion: policy.configurationVersion,
    sourceId: SHARD_COMPOSER_SOURCE_ID,
    dataset: 'universe.graph',
    endpointClass: 'INJECTED',
    authorityKind: 'EXCHANGE_DERIVED',
    evaluatedAtMs: input.observedAtMs,
    receivedTimeMs,
    maxAgeMs: sourceStaleAfterMs,
    sourceRecordIds: graphs.map((graph) => graph.id),
    sourceSet: publicTruths.map((truth) => truth.authority.sourceId),
    transforms: ['authoritative-foundation-shards-v1', 'compose-bounded-universe-graph-v1'],
    completeness: missingSources.length === 0 && normalizedFailures.length === 0 ? 'COMPLETE' : 'PARTIAL',
    observedFields: ['nodes', 'aliases', 'foundationShards'],
    missingFields: [
      ...missingSources,
      ...(normalizedFailures.length > 0 ? ['conflict-free source records'] : []),
    ],
    reasonCodes: [
      'BOUNDED_FOUNDATION_GRAPH_SHARDS',
      ...missingSources.map((source) => `${source.toUpperCase().replaceAll(' ', '_')}_INCOMPLETE`),
      ...normalizedFailures.map((failure) => failure.code),
    ],
  });
  const shardIds = graphs.map((graph) => graph.id).sort(codePointCompare);
  return {
    id: stableId('runtime-sharded-universe-graph', {
      policyVersion: policy.configurationVersion,
      sourceStates,
      shardIds,
      failureIds: normalizedFailures.map((failure) => failure.id),
    }),
    observedAtMs: input.observedAtMs,
    configurationVersion: policy.configurationVersion,
    policy: graphs[0].policy,
    sourceStates,
    nodes,
    aliases,
    failures: normalizedFailures,
    truth: graphTruth,
  };
}

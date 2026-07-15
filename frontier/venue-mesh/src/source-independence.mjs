import { sha256 } from '../../dock/src/index.mjs';
import { arrayValue, asRecord, boundedString, deepFreeze, enumValue, exactFields, stableSort } from './guards.mjs';
import { fail } from './errors.mjs';

function detectCopyCycle(byId) {
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) fail('SOURCE_COPY_CYCLE', `source copy graph contains a cycle at ${id}`);
    visiting.add(id);
    const copiedFrom = byId.get(id)?.copiedFromSourceId ?? null;
    if (copiedFrom !== null) {
      if (!byId.has(copiedFrom)) fail('SOURCE_COPY_TARGET_MISSING', `source ${id} copies unknown source ${copiedFrom}`);
      visit(copiedFrom);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
}

export function buildSourceIndependenceGraph(sources) {
  arrayValue(sources, 'sources', { maximum: 10_000 });
  const rows = sources.map((source, index) => {
    asRecord(source, `sources[${index}]`);
    exactFields(source, ['sourceId', 'upstreamOriginId', 'vendorFamilyId', 'copiedFromSourceId', 'relationship'], `sources[${index}]`);
    const sourceId = boundedString(source.sourceId, `sources[${index}].sourceId`, 128);
    const upstreamOriginId = source.upstreamOriginId === null ? null : boundedString(source.upstreamOriginId, `sources[${index}].upstreamOriginId`, 128);
    const vendorFamilyId = source.vendorFamilyId === null ? null : boundedString(source.vendorFamilyId, `sources[${index}].vendorFamilyId`, 128);
    const copiedFromSourceId = source.copiedFromSourceId === null ? null : boundedString(source.copiedFromSourceId, `sources[${index}].copiedFromSourceId`, 128);
    enumValue(source.relationship, ['PRIMARY', 'MIRROR', 'SYNDICATED', 'DERIVED', 'UNKNOWN'], `sources[${index}].relationship`);
    if (source.relationship === 'PRIMARY' && copiedFromSourceId !== null) fail('SOURCE_PRIMARY_COPY_INVALID', 'PRIMARY sources cannot name copiedFromSourceId');
    if (['MIRROR', 'SYNDICATED', 'DERIVED'].includes(source.relationship) && copiedFromSourceId === null) {
      fail('SOURCE_DEPENDENCE_PROVENANCE_INCOMPLETE', `${source.relationship} sources require copiedFromSourceId`);
    }
    if (source.relationship === 'UNKNOWN' && copiedFromSourceId !== null) fail('SOURCE_UNKNOWN_COPY_INVALID', 'UNKNOWN relationships cannot assert a copy edge');
    return { sourceId, upstreamOriginId, vendorFamilyId, copiedFromSourceId, relationship: source.relationship };
  });
  const byId = new Map();
  for (const row of rows) {
    if (byId.has(row.sourceId)) fail('SOURCE_ID_DUPLICATE', `duplicate source ${row.sourceId}`);
    byId.set(row.sourceId, row);
  }
  detectCopyCycle(byId);
  for (const row of rows) {
    if (row.copiedFromSourceId === null) continue;
    const parentRow = byId.get(row.copiedFromSourceId);
    if (row.upstreamOriginId !== null && parentRow.upstreamOriginId !== null && row.upstreamOriginId !== parentRow.upstreamOriginId) {
      fail('SOURCE_COPY_ORIGIN_MISMATCH', `source ${row.sourceId} contradicts copied origin ${row.copiedFromSourceId}`);
    }
  }

  const parent = new Map(rows.map((row) => [row.sourceId, row.sourceId]));
  const find = (id) => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current);
    return current;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const [first, second] = [leftRoot, rightRoot].sort();
    parent.set(second, first);
  };
  for (const row of rows) {
    if (row.copiedFromSourceId !== null) union(row.sourceId, row.copiedFromSourceId);
  }
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const left = rows[leftIndex];
      const right = rows[rightIndex];
      if (left.upstreamOriginId !== null && left.upstreamOriginId === right.upstreamOriginId) union(left.sourceId, right.sourceId);
      if (left.vendorFamilyId !== null && left.vendorFamilyId === right.vendorFamilyId) union(left.sourceId, right.sourceId);
    }
  }
  const clusters = new Map();
  for (const row of rows) {
    const root = find(row.sourceId);
    const members = clusters.get(root) ?? [];
    members.push(row);
    clusters.set(root, members);
  }
  const families = stableSort([...clusters.values()].map((members) => {
    const ordered = stableSort(members, (row) => row.sourceId);
    const unknownDependence = ordered.some((row) => row.upstreamOriginId === null || row.relationship === 'UNKNOWN');
    const familyId = unknownDependence ? null : `vm-family-${sha256(ordered).slice(0, 24)}`;
    return {
      familyId,
      sourceIds: ordered.map((row) => row.sourceId),
      upstreamOriginIds: [...new Set(ordered.map((row) => row.upstreamOriginId).filter(Boolean))].sort(),
      vendorFamilyIds: [...new Set(ordered.map((row) => row.vendorFamilyId).filter(Boolean))].sort(),
      dependenceState: unknownDependence ? 'UNKNOWN_NOT_COUNTED' : ordered.length === 1 ? 'INDEPENDENT_SINGLE_SOURCE' : 'SHARED_OR_COPIED_FAMILY',
      confirmationWeight: unknownDependence ? 0 : 1,
    };
  }), (family) => family.sourceIds.join('|'));
  return deepFreeze({
    schema: 'VenueSourceIndependenceGraphV1',
    graphHash: sha256({ rows: stableSort(rows, (row) => row.sourceId), families }),
    sources: stableSort(rows, (row) => row.sourceId),
    families,
    independentFamilyCount: families.reduce((count, family) => count + family.confirmationWeight, 0),
    unknownSourcesCount: families.filter((family) => family.familyId === null).reduce((count, family) => count + family.sourceIds.length, 0),
    canonicalConfirmationWritten: false,
    authorityClass: 'NO_AUTHORITY',
  });
}

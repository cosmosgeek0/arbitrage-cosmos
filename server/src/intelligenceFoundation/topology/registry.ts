import {
  TOPOLOGY_EDGE_TYPES,
  canonicalJson,
  isFailureCode,
  makeStableFailure,
  sortedUnique,
  stableId,
  validateNoSecretFields,
  validateTruthMetadata,
} from '../contracts/index.js';
import type {
  CompletenessState,
  ComponentDescriptor,
  ComponentMetric,
  FailureCode,
  FreshnessState,
  StableFailure,
  TopologyEdge,
  TopologyEdgeType,
  TopologySnapshot,
  TruthMetadata,
  ValidationResult,
} from '../contracts/index.js';
import { cloneComponent, cloneEdge, cloneSnapshot, cloneTruth } from './clone.js';
import {
  DEFAULT_TOPOLOGY_BOUNDS,
  normalizeTopologyBounds,
  type TopologyBounds,
} from './config.js';
import {
  TOPOLOGY_DESIRED_STATES,
  TOPOLOGY_OBSERVED_STATES,
  type TopologyBlocker,
  type TopologyBlockingReport,
  type TopologyBuildInput,
  type TopologyCycle,
  type TopologyCycleQuery,
  type TopologyCycleReport,
  type TopologyObservedState,
  type TopologyReadModel,
  type TopologyRegistryResult,
  type TopologyTraversal,
  type TopologyTraversalDirection,
  type TopologyTraversalLevel,
  type TopologyTraversalQuery,
} from './types.js';

const COMPONENT_ID = /^component:[a-f0-9]{24}$/;
const EDGE_ID = /^topology_edge:[a-f0-9]{24}$/;

/** ECMAScript relational string comparison is deterministic UTF-16 code-unit order. */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function finiteMetricValue(value: unknown): value is ComponentMetric['value'] {
  return value === null || typeof value === 'string' || typeof value === 'boolean' ||
    typeof value === 'number' && Number.isFinite(value);
}

function hasValue<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function failure(
  code: StableFailure['code'],
  message: string,
  field: string | null,
  evidenceIds: string[] = [],
): StableFailure {
  return makeStableFailure(code, 'intelligence_topology', message, field, evidenceIds);
}

function fail<T>(
  code: StableFailure['code'],
  message: string,
  field: string | null,
  evidenceIds: string[] = [],
): ValidationResult<T> {
  return { ok: false, failure: failure(code, message, field, evidenceIds) };
}

function normalizeStringList(
  value: unknown,
  field: string,
  bounds: TopologyBounds,
): ValidationResult<string[]> {
  if (!Array.isArray(value)) {
    return fail('INVALID_VALUE', 'topology string list must be an array', field);
  }
  if (value.length > bounds.maxListEntries) {
    return fail('BUDGET_EXHAUSTED', 'topology string list exceeds its bounded capacity', field);
  }
  if (!value.every((entry) => nonEmptyString(entry, bounds.maxStringLength))) {
    return fail('INVALID_VALUE', 'topology string list contains an invalid entry', field);
  }
  return { ok: true, value: sortedUnique(value as string[]) };
}

function normalizeLastError(
  value: unknown,
  field: string,
  bounds: TopologyBounds,
): ValidationResult<StableFailure | null> {
  if (value === null) return { ok: true, value: null };
  if (
    !object(value) || !nonEmptyString(value.id, bounds.maxStringLength) || !isFailureCode(value.code) ||
    !nonEmptyString(value.component, 96) || !nonEmptyString(value.message, bounds.maxStringLength) ||
    typeof value.retryable !== 'boolean' ||
    !(value.field === null || nonEmptyString(value.field, bounds.maxStringLength)) ||
    !Array.isArray(value.evidenceIds) || value.evidenceIds.length > bounds.maxListEntries ||
    !value.evidenceIds.every((entry) => nonEmptyString(entry, bounds.maxStringLength))
  ) {
    return fail('INVALID_VALUE', 'component lastError is not a stable structured failure', field);
  }
  const canonical = makeStableFailure(
    value.code as FailureCode,
    value.component,
    value.message,
    value.field as string | null,
    value.evidenceIds as string[],
  );
  if (value.id !== canonical.id || value.retryable !== canonical.retryable) {
    return fail('INVALID_VALUE', 'component lastError identity or retryability is not canonical', field, [value.id]);
  }
  return {
    ok: true,
    value: canonical,
  };
}

function normalizeMetrics(
  value: unknown,
  field: string,
  bounds: TopologyBounds,
): ValidationResult<ComponentMetric[]> {
  if (!Array.isArray(value)) {
    return fail('INVALID_VALUE', 'component metrics must be an array', field);
  }
  if (value.length > bounds.maxMetricsPerNode) {
    return fail('BUDGET_EXHAUSTED', 'component metrics exceed bounded capacity', field);
  }
  const metrics: ComponentMetric[] = [];
  const identities = new Set<string>();
  for (const metric of value) {
    if (
      !object(metric) || !nonEmptyString(metric.name, bounds.maxStringLength) ||
      !finiteMetricValue(metric.value) || !nonEmptyString(metric.unit, bounds.maxStringLength)
    ) return fail('INVALID_VALUE', 'component metric is malformed or non-finite', field);
    const identity = `${metric.name}\0${metric.unit}`;
    if (identities.has(identity)) return fail('INVALID_VALUE', 'component metric identity is duplicated', field);
    identities.add(identity);
    metrics.push({ name: metric.name, value: metric.value, unit: metric.unit });
  }
  metrics.sort((left, right) => compareCodeUnits(left.name, right.name) || compareCodeUnits(left.unit, right.unit));
  return { ok: true, value: metrics };
}

function normalizeComponent(value: unknown, bounds: TopologyBounds): ValidationResult<ComponentDescriptor> {
  if (!object(value)) return fail('INVALID_VALUE', 'component descriptor must be an object', 'nodes');
  const nodeId = typeof value.id === 'string' ? value.id : '';
  const nodeField = nodeId.length > 0 ? `nodes.${nodeId}` : 'nodes.[unknown]';
  if (
    !COMPONENT_ID.test(nodeId) || !nonEmptyString(value.name, bounds.maxStringLength) ||
    !nonEmptyString(value.responsibility, bounds.maxStringLength) ||
    !nonEmptyString(value.authoritativeOwner, bounds.maxStringLength) ||
    !hasValue(TOPOLOGY_DESIRED_STATES, value.desiredState) ||
    !hasValue(TOPOLOGY_OBSERVED_STATES, value.observedState) ||
    !nonEmptyString(value.uiSurface, bounds.maxStringLength) ||
    !object(value.authority) || !object(value.freshness)
  ) return fail('INVALID_VALUE', 'component identity, ownership, state, or UI surface is invalid', nodeField, nodeId ? [nodeId] : []);

  const dependencyIds = normalizeStringList(value.dependencyIds, `${nodeField}.dependencyIds`, bounds);
  if (!dependencyIds.ok) return dependencyIds as ValidationResult<ComponentDescriptor>;
  if (dependencyIds.value.some((dependencyId) => !COMPONENT_ID.test(dependencyId) || dependencyId === nodeId)) {
    return fail('INVALID_VALUE', 'component dependencies must be stable non-self component IDs', `${nodeField}.dependencyIds`, [nodeId]);
  }
  const inputs = normalizeStringList(value.inputs, `${nodeField}.inputs`, bounds);
  if (!inputs.ok) return inputs as ValidationResult<ComponentDescriptor>;
  const outputs = normalizeStringList(value.outputs, `${nodeField}.outputs`, bounds);
  if (!outputs.ok) return outputs as ValidationResult<ComponentDescriptor>;
  const controls = normalizeStringList(value.safeControlsSupportedLater, `${nodeField}.safeControlsSupportedLater`, bounds);
  if (!controls.ok) return controls as ValidationResult<ComponentDescriptor>;
  const metrics = normalizeMetrics(value.metrics, `${nodeField}.metrics`, bounds);
  if (!metrics.ok) return metrics as ValidationResult<ComponentDescriptor>;
  const lastError = normalizeLastError(value.lastError, `${nodeField}.lastError`, bounds);
  if (!lastError.ok) return lastError as ValidationResult<ComponentDescriptor>;
  const truth = validateTruthMetadata(value.truth);
  if (!truth.ok) return truth as ValidationResult<ComponentDescriptor>;

  if (!canonicalEqual(value.authority, truth.value.authority)) {
    return fail('INVALID_VALUE', 'component authority conflicts with authoritative truth metadata', `${nodeField}.authority`, [nodeId]);
  }
  if (!canonicalEqual(value.freshness, truth.value.freshness)) {
    return fail('INVALID_VALUE', 'component freshness conflicts with authoritative truth metadata', `${nodeField}.freshness`, [nodeId]);
  }
  if (!(value.lastSuccessTimeMs === null || nonNegativeSafeInteger(value.lastSuccessTimeMs))) {
    return fail('INVALID_VALUE', 'component last success time must be null or a non-negative safe integer', `${nodeField}.lastSuccessTimeMs`, [nodeId]);
  }
  if (
    value.lastSuccessTimeMs !== null &&
    value.lastSuccessTimeMs > truth.value.freshness.evaluatedAtMs
  ) return fail('INVALID_VALUE', 'component last success cannot follow its freshness evaluation', `${nodeField}.lastSuccessTimeMs`, [nodeId]);
  if (!(value.blockingReason === null || nonEmptyString(value.blockingReason, bounds.maxStringLength))) {
    return fail('INVALID_VALUE', 'component blocking reason must be null or a bounded non-empty string', `${nodeField}.blockingReason`, [nodeId]);
  }

  const desiredState = value.desiredState;
  const observedState = value.observedState;
  const blockingReason = value.blockingReason as string | null;
  if (desiredState === 'RUNTIME_WIRED' && observedState === 'LIBRARY_AVAILABLE' && blockingReason !== 'NOT_WIRED') {
    return fail('INVALID_VALUE', 'library-only component must explicitly report NOT_WIRED', `${nodeField}.blockingReason`, [nodeId]);
  }
  if (observedState === 'NOT_WIRED' && blockingReason !== 'NOT_WIRED') {
    return fail('INVALID_VALUE', 'NOT_WIRED observed state requires the same blocking reason', `${nodeField}.blockingReason`, [nodeId]);
  }
  if (observedState === 'UNAVAILABLE' && blockingReason === null) {
    return fail('INVALID_VALUE', 'unavailable component must name its blocking reason', `${nodeField}.blockingReason`, [nodeId]);
  }
  if (desiredState === 'LIBRARY_AVAILABLE' && observedState === 'LIBRARY_AVAILABLE' && blockingReason !== null) {
    return fail('INVALID_VALUE', 'available library cannot simultaneously claim a blocker', `${nodeField}.blockingReason`, [nodeId]);
  }
  if (blockingReason === 'NOT_WIRED') {
    if (!['UNAVAILABLE', 'UNKNOWN'].includes(truth.value.freshness.state) || value.lastSuccessTimeMs !== null) {
      return fail('INVALID_VALUE', 'NOT_WIRED component cannot claim live freshness or runtime success', nodeField, [nodeId]);
    }
  }
  if (lastError.value !== null && blockingReason === null) {
    return fail('INVALID_VALUE', 'component with a last error must expose a blocking reason', `${nodeField}.blockingReason`, [nodeId]);
  }

  const canonicalTruth = cloneTruth(truth.value);
  return {
    ok: true,
    value: {
      id: nodeId,
      name: value.name,
      responsibility: value.responsibility,
      authoritativeOwner: value.authoritativeOwner,
      dependencyIds: dependencyIds.value,
      inputs: inputs.value,
      outputs: outputs.value,
      desiredState,
      observedState,
      authority: { ...canonicalTruth.authority },
      freshness: { ...canonicalTruth.freshness },
      lastSuccessTimeMs: value.lastSuccessTimeMs as number | null,
      lastError: lastError.value,
      blockingReason,
      metrics: metrics.value,
      safeControlsSupportedLater: controls.value,
      uiSurface: value.uiSurface,
      truth: canonicalTruth,
    },
  };
}

export function topologyComponentId(key: string): string {
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(key)) {
    throw new TypeError('topology component key must be a bounded non-empty string');
  }
  return stableId('component', { scope: 'intelligence_foundation', key });
}

export function topologyEdgeId(input: Pick<TopologyEdge, 'from' | 'to' | 'type' | 'label'>): string {
  return stableId('topology_edge', {
    from: input.from,
    to: input.to,
    type: input.type,
    label: input.label,
  });
}

function normalizeEdge(value: unknown, bounds: TopologyBounds): ValidationResult<TopologyEdge> {
  if (!object(value)) return fail('INVALID_VALUE', 'topology edge must be an object', 'edges');
  const edgeId = typeof value.id === 'string' ? value.id : '';
  const edgeField = edgeId.length > 0 ? `edges.${edgeId}` : 'edges.[unknown]';
  if (
    !EDGE_ID.test(edgeId) || !COMPONENT_ID.test(String(value.from)) || !COMPONENT_ID.test(String(value.to)) ||
    value.from === value.to || !hasValue(TOPOLOGY_EDGE_TYPES, value.type) ||
    !nonEmptyString(value.label, bounds.maxStringLength)
  ) return fail('INVALID_VALUE', 'topology edge identity, endpoints, type, or label is invalid', edgeField, edgeId ? [edgeId] : []);
  const expectedId = topologyEdgeId({
    from: value.from as string,
    to: value.to as string,
    type: value.type,
    label: value.label,
  });
  if (edgeId !== expectedId) {
    return fail('INVALID_VALUE', 'topology edge ID does not match its semantic identity', `${edgeField}.id`, [edgeId]);
  }
  const truth = validateTruthMetadata(value.truth);
  if (!truth.ok) return truth as ValidationResult<TopologyEdge>;
  return {
    ok: true,
    value: {
      id: edgeId,
      from: value.from as string,
      to: value.to as string,
      type: value.type,
      label: value.label,
      truth: cloneTruth(truth.value),
    },
  };
}

function normalizeEdgeTypes(
  value: readonly TopologyEdgeType[] | undefined,
  bounds: TopologyBounds,
): ValidationResult<TopologyEdgeType[]> {
  if (value === undefined) return { ok: true, value: [...TOPOLOGY_EDGE_TYPES] };
  if (!Array.isArray(value) || value.length > Math.min(bounds.maxListEntries, TOPOLOGY_EDGE_TYPES.length)) {
    return fail('INVALID_VALUE', 'edge-type filter is not bounded', 'edgeTypes');
  }
  if (!value.every((entry) => hasValue(TOPOLOGY_EDGE_TYPES, entry))) {
    return fail('INVALID_VARIANT', 'edge-type filter contains an unknown type', 'edgeTypes');
  }
  const selected = new Set(value);
  return { ok: true, value: TOPOLOGY_EDGE_TYPES.filter((entry) => selected.has(entry)) };
}

function edgeComparator(left: TopologyEdge, right: TopologyEdge): number {
  return compareCodeUnits(left.from, right.from) || compareCodeUnits(left.to, right.to) ||
    compareCodeUnits(left.type, right.type) || compareCodeUnits(left.label, right.label) ||
    compareCodeUnits(left.id, right.id);
}

function rawEdgeComparator(left: TopologyEdge, right: TopologyEdge): number {
  return compareCodeUnits(String(left?.from ?? ''), String(right?.from ?? '')) ||
    compareCodeUnits(String(left?.to ?? ''), String(right?.to ?? '')) ||
    compareCodeUnits(String(left?.type ?? ''), String(right?.type ?? '')) ||
    compareCodeUnits(String(left?.label ?? ''), String(right?.label ?? '')) ||
    compareCodeUnits(String(left?.id ?? ''), String(right?.id ?? ''));
}

const FRESHNESS_SEVERITY: Readonly<Record<FreshnessState, number>> = Object.freeze({
  FRESH: 0,
  STALE: 1,
  UNKNOWN: 2,
  UNAVAILABLE: 3,
});

const COMPLETENESS_SEVERITY: Readonly<Record<CompletenessState, number>> = Object.freeze({
  COMPLETE: 0,
  PARTIAL: 1,
  UNKNOWN: 2,
  MISSING: 3,
});

interface ChildTruthEntry {
  field: string;
  truth: TruthMetadata;
}

function projectFreshness(truth: TruthMetadata, evaluatedAtMs: number): TruthMetadata['freshness'] {
  const declared = truth.freshness;
  if (declared.state !== 'FRESH' && declared.state !== 'STALE') {
    return {
      basis: 'UNAVAILABLE',
      evaluatedAtMs,
      ageMs: null,
      maxAgeMs: null,
      state: declared.state,
    };
  }
  const basisTime = declared.basis === 'SOURCE_EVENT_TIME'
    ? truth.temporal.sourceEventTimeMs
    : declared.basis === 'SOURCE_TRANSACTION_TIME'
      ? truth.temporal.sourceTransactionTimeMs
      : truth.temporal.receivedTimeMs;
  const ageMs = evaluatedAtMs - basisTime!;
  return {
    basis: declared.basis,
    evaluatedAtMs,
    ageMs,
    maxAgeMs: declared.maxAgeMs,
    state: ageMs <= declared.maxAgeMs! ? 'FRESH' : 'STALE',
  };
}

function freshnessPressure(freshness: TruthMetadata['freshness']): number {
  const { ageMs, maxAgeMs } = freshness;
  if (ageMs === null) return -1;
  if (maxAgeMs === null) return ageMs;
  if (maxAgeMs === 0) return ageMs === 0 ? 0 : Number.POSITIVE_INFINITY;
  return ageMs / maxAgeMs;
}

function compareTruthFreshness(
  left: ChildTruthEntry,
  right: ChildTruthEntry,
  evaluatedAtMs: number,
): number {
  const leftFreshness = projectFreshness(left.truth, evaluatedAtMs);
  const rightFreshness = projectFreshness(right.truth, evaluatedAtMs);
  const severity = FRESHNESS_SEVERITY[leftFreshness.state] - FRESHNESS_SEVERITY[rightFreshness.state];
  if (severity !== 0) return severity;
  const leftPressure = freshnessPressure(leftFreshness);
  const rightPressure = freshnessPressure(rightFreshness);
  if (leftPressure < rightPressure) return -1;
  if (leftPressure > rightPressure) return 1;
  return compareCodeUnits(canonicalJson(left), canonicalJson(right));
}

function truthIdentity(truth: TruthMetadata): Record<string, unknown> {
  return {
    schemaVersion: truth.schemaVersion,
    producerVersion: truth.producerVersion,
    configurationVersion: truth.configurationVersion,
    featureVersion: truth.featureVersion,
    authority: truth.authority,
    provenance: truth.provenance,
    freshness: {
      basis: truth.freshness.basis,
      maxAgeMs: truth.freshness.maxAgeMs,
      state: truth.freshness.state,
    },
    completeness: truth.completeness,
  };
}

function deriveSnapshotTruth(
  template: TruthMetadata,
  nodes: readonly ComponentDescriptor[],
  edges: readonly TopologyEdge[],
): ValidationResult<TruthMetadata> {
  const childEntries: ChildTruthEntry[] = [
    ...nodes.map((node) => ({ field: `nodes.${node.id}`, truth: node.truth })),
    ...edges.map((edge) => ({ field: `edges.${edge.id}`, truth: edge.truth })),
  ];
  const stateEntries = childEntries.length > 0
    ? childEntries
    : [{ field: 'topology.input', truth: template }];
  const evaluatedAtMs = Math.max(
    template.freshness.evaluatedAtMs,
    ...stateEntries.map((entry) => entry.truth.freshness.evaluatedAtMs),
  );
  const worstFreshness = [...stateEntries]
    .sort((left, right) => compareTruthFreshness(left, right, evaluatedAtMs))
    .at(-1)!;
  const temporal = {
    ...worstFreshness.truth.temporal,
    sequence: null,
  };
  const freshness = projectFreshness(worstFreshness.truth, evaluatedAtMs);

  const allTruths = [template, ...childEntries.map((entry) => entry.truth)];
  const failures = nodes.flatMap((node) => node.lastError === null
    ? []
    : [{ nodeId: node.id, failure: node.lastError }]);
  let completenessState: CompletenessState;
  let observedFields: string[];
  let missingFields: string[];
  let reasonCodes: string[];
  if (childEntries.length === 0) {
    completenessState = template.completeness.state;
    observedFields = [...template.completeness.observedFields];
    missingFields = [...template.completeness.missingFields];
    reasonCodes = [...template.completeness.reasonCodes];
  } else {
    completenessState = childEntries.reduce<CompletenessState>((worst, entry) =>
      COMPLETENESS_SEVERITY[entry.truth.completeness.state] > COMPLETENESS_SEVERITY[worst]
        ? entry.truth.completeness.state
        : worst, 'COMPLETE');
    observedFields = childEntries.flatMap((entry) => entry.truth.completeness.observedFields
      .map((field) => `${entry.field}.${field}`));
    missingFields = childEntries.flatMap((entry) => entry.truth.completeness.missingFields
      .map((field) => `${entry.field}.${field}`));
    reasonCodes = childEntries.flatMap((entry) => [
      ...entry.truth.completeness.reasonCodes,
      ...(entry.truth.completeness.state === 'COMPLETE'
        ? []
        : [`CHILD_COMPLETENESS_${entry.truth.completeness.state}`]),
    ]);
  }
  if (failures.length > 0) {
    if (COMPLETENESS_SEVERITY[completenessState] < COMPLETENESS_SEVERITY.PARTIAL) {
      completenessState = 'PARTIAL';
    }
    missingFields.push(...failures.map(({ nodeId }) => `nodes.${nodeId}.lastError`));
    reasonCodes.push(...failures.map(({ failure: childFailure }) => `CHILD_FAILURE_${childFailure.code}`));
  }
  missingFields = sortedUnique(missingFields);
  observedFields = sortedUnique(observedFields).filter((field) => !missingFields.includes(field));
  reasonCodes = sortedUnique(reasonCodes);

  const derived: TruthMetadata = {
    schemaVersion: template.schemaVersion,
    producerVersion: template.producerVersion,
    configurationVersion: template.configurationVersion,
    featureVersion: template.featureVersion,
    authority: { ...template.authority },
    provenance: {
      sourceRecordIds: sortedUnique([
        ...allTruths.flatMap((truth) => truth.provenance.sourceRecordIds),
        ...failures.flatMap(({ failure: childFailure }) => [childFailure.id, ...childFailure.evidenceIds]),
      ]),
      sourceSet: sortedUnique(allTruths.flatMap((truth) => truth.provenance.sourceSet)),
      transforms: sortedUnique([
        ...allTruths.flatMap((truth) => truth.provenance.transforms),
        'topology-child-truth-rollup-v1',
      ]),
    },
    temporal,
    freshness,
    completeness: {
      state: completenessState,
      observedFields,
      missingFields,
      reasonCodes,
    },
  };
  return validateTruthMetadata(derived);
}

function reportTruth(
  snapshotTruth: TruthMetadata,
  transform: string,
  sourceRecordIds: readonly string[],
  incompleteReason: string | null = null,
): TruthMetadata {
  const truth = cloneTruth(snapshotTruth);
  truth.provenance.sourceRecordIds = sortedUnique([
    ...truth.provenance.sourceRecordIds,
    ...sourceRecordIds,
  ]);
  truth.provenance.transforms = sortedUnique([...truth.provenance.transforms, transform]);
  if (incompleteReason !== null) {
    if (COMPLETENESS_SEVERITY[truth.completeness.state] < COMPLETENESS_SEVERITY.PARTIAL) {
      truth.completeness.state = 'PARTIAL';
    }
    truth.completeness.missingFields = sortedUnique([
      ...truth.completeness.missingFields,
      `${transform}.remaining`,
    ]);
    truth.completeness.observedFields = truth.completeness.observedFields
      .filter((field) => !truth.completeness.missingFields.includes(field));
    truth.completeness.reasonCodes = sortedUnique([
      ...truth.completeness.reasonCodes,
      incompleteReason,
    ]);
  }
  return truth;
}

function snapshotIdentity(nodes: ComponentDescriptor[], edges: TopologyEdge[], truth: TopologySnapshot['truth']): string {
  return stableId('topology_snapshot', {
    nodes: nodes.map((node) => ({
      id: node.id,
      name: node.name,
      responsibility: node.responsibility,
      authoritativeOwner: node.authoritativeOwner,
      dependencyIds: node.dependencyIds,
      inputs: node.inputs,
      outputs: node.outputs,
      desiredState: node.desiredState,
      observedState: node.observedState,
      authority: node.authority,
      blockingReason: node.blockingReason,
      lastErrorId: node.lastError?.id ?? null,
      metrics: node.metrics,
      safeControlsSupportedLater: node.safeControlsSupportedLater,
      uiSurface: node.uiSurface,
      truth: truthIdentity(node.truth),
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      truth: truthIdentity(edge.truth),
    })),
    truth: truthIdentity(truth),
  });
}

function stronglyConnectedComponents(
  nodeIds: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): string[][] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const connect = (nodeId: string): void => {
    indices.set(nodeId, nextIndex);
    lowLinks.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const adjacentId of adjacency.get(nodeId) ?? []) {
      if (!indices.has(adjacentId)) {
        connect(adjacentId);
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, lowLinks.get(adjacentId)!));
      } else if (onStack.has(adjacentId)) {
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, indices.get(adjacentId)!));
      }
    }

    if (lowLinks.get(nodeId) !== indices.get(nodeId)) return;
    const component: string[] = [];
    for (;;) {
      const popped = stack.pop();
      if (popped === undefined) break;
      onStack.delete(popped);
      component.push(popped);
      if (popped === nodeId) break;
    }
    component.sort(compareCodeUnits);
    components.push(component);
  };

  for (const nodeId of [...nodeIds].sort(compareCodeUnits)) {
    if (!indices.has(nodeId)) connect(nodeId);
  }
  return components
    .filter((component) => component.length > 1)
    .sort((left, right) => compareCodeUnits(left.join('\0'), right.join('\0')));
}

class ImmutableTopologyReadModel implements TopologyReadModel {
  readonly #nodeMap: ReadonlyMap<string, ComponentDescriptor>;
  readonly #edgeMap: ReadonlyMap<string, TopologyEdge>;
  readonly #incoming: ReadonlyMap<string, readonly TopologyEdge[]>;
  readonly #outgoing: ReadonlyMap<string, readonly TopologyEdge[]>;
  readonly #value: TopologySnapshot;
  readonly #limits: TopologyBounds;

  constructor(value: TopologySnapshot, limits: TopologyBounds) {
    this.#value = value;
    this.#limits = limits;
    this.#nodeMap = new Map(value.nodes.map((node) => [node.id, node]));
    this.#edgeMap = new Map(value.edges.map((edge) => [edge.id, edge]));
    const incoming = new Map<string, TopologyEdge[]>();
    const outgoing = new Map<string, TopologyEdge[]>();
    for (const node of value.nodes) {
      incoming.set(node.id, []);
      outgoing.set(node.id, []);
    }
    for (const edge of value.edges) {
      incoming.get(edge.to)!.push(edge);
      outgoing.get(edge.from)!.push(edge);
    }
    for (const rows of incoming.values()) rows.sort(edgeComparator);
    for (const rows of outgoing.values()) rows.sort(edgeComparator);
    this.#incoming = incoming;
    this.#outgoing = outgoing;
    Object.freeze(this);
  }

  snapshot(): TopologySnapshot {
    return cloneSnapshot(this.#value);
  }

  node(id: string): ComponentDescriptor | null {
    const node = this.#nodeMap.get(id);
    return node === undefined ? null : cloneComponent(node);
  }

  edge(id: string): TopologyEdge | null {
    const edge = this.#edgeMap.get(id);
    return edge === undefined ? null : cloneEdge(edge);
  }

  nodes(): ComponentDescriptor[] {
    return this.#value.nodes.map(cloneComponent);
  }

  edges(): TopologyEdge[] {
    return this.#value.edges.map(cloneEdge);
  }

  nodesByOwner(authoritativeOwner: string): ComponentDescriptor[] {
    return this.#value.nodes.filter((node) => node.authoritativeOwner === authoritativeOwner).map(cloneComponent);
  }

  nodesByUiSurface(uiSurface: string): ComponentDescriptor[] {
    return this.#value.nodes.filter((node) => node.uiSurface === uiSurface).map(cloneComponent);
  }

  nodesByObservedState(observedState: TopologyObservedState): ComponentDescriptor[] {
    if (!hasValue(TOPOLOGY_OBSERVED_STATES, observedState)) return [];
    return this.#value.nodes.filter((node) => node.observedState === observedState).map(cloneComponent);
  }

  incomingEdges(nodeId: string, edgeTypes?: readonly TopologyEdgeType[]): ValidationResult<TopologyEdge[]> {
    return this.#incidentEdges(nodeId, 'UPSTREAM', edgeTypes);
  }

  outgoingEdges(nodeId: string, edgeTypes?: readonly TopologyEdgeType[]): ValidationResult<TopologyEdge[]> {
    return this.#incidentEdges(nodeId, 'DOWNSTREAM', edgeTypes);
  }

  directDependencies(nodeId: string): ValidationResult<ComponentDescriptor[]> {
    const node = this.#nodeMap.get(nodeId);
    if (node === undefined) return fail('MISSING_SOURCE', 'topology node does not exist', 'nodeId', [nodeId]);
    return {
      ok: true,
      value: node.dependencyIds.map((dependencyId) => cloneComponent(this.#nodeMap.get(dependencyId)!)),
    };
  }

  directDependents(nodeId: string): ValidationResult<ComponentDescriptor[]> {
    if (!this.#nodeMap.has(nodeId)) return fail('MISSING_SOURCE', 'topology node does not exist', 'nodeId', [nodeId]);
    return {
      ok: true,
      value: this.#value.nodes
        .filter((node) => node.dependencyIds.includes(nodeId))
        .map(cloneComponent),
    };
  }

  traverse(query: TopologyTraversalQuery): ValidationResult<TopologyTraversal> {
    if (!object(query) || !this.#nodeMap.has(query.startId)) {
      return fail('MISSING_SOURCE', 'topology traversal start node does not exist', 'startId', [query?.startId ?? '']);
    }
    if (!['UPSTREAM', 'DOWNSTREAM'].includes(query.direction)) {
      return fail('INVALID_VARIANT', 'topology traversal direction is invalid', 'direction');
    }
    const edgeTypes = normalizeEdgeTypes(query.edgeTypes, this.#limits);
    if (!edgeTypes.ok) return edgeTypes as ValidationResult<TopologyTraversal>;
    const maxDepth = query.maxDepth ?? this.#limits.maxTraversalDepth;
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > this.#limits.maxTraversalDepth) {
      return fail('INVALID_VALUE', 'topology traversal depth is outside configured bounds', 'maxDepth');
    }
    const allowed = new Set(edgeTypes.value);
    const visited = new Set<string>([query.startId]);
    const traversedEdges = new Set<string>();
    const levels: TopologyTraversalLevel[] = [{ depth: 0, nodeIds: [query.startId], edgeIds: [] }];
    let frontier = [query.startId];
    let truncated = false;

    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const next = new Set<string>();
      const levelEdges = new Set<string>();
      for (const nodeId of [...frontier].sort(compareCodeUnits)) {
        const rows = query.direction === 'UPSTREAM' ? this.#incoming.get(nodeId)! : this.#outgoing.get(nodeId)!;
        for (const edge of rows) {
          if (!allowed.has(edge.type)) continue;
          if (traversedEdges.size >= this.#limits.maxTraversalResults) {
            truncated = true;
            break;
          }
          traversedEdges.add(edge.id);
          levelEdges.add(edge.id);
          const adjacentId = query.direction === 'UPSTREAM' ? edge.from : edge.to;
          if (!visited.has(adjacentId)) {
            if (visited.size >= this.#limits.maxTraversalResults) {
              truncated = true;
              break;
            }
            visited.add(adjacentId);
            next.add(adjacentId);
          }
        }
        if (truncated) break;
      }
      if (levelEdges.size > 0 || next.size > 0) {
        levels.push({
          depth,
          nodeIds: [...next].sort(compareCodeUnits),
          edgeIds: [...levelEdges].sort(compareCodeUnits),
        });
      }
      frontier = [...next];
      if (frontier.length === 0 || truncated) break;
    }
    if (!truncated && frontier.length > 0 && levels[levels.length - 1]?.depth === maxDepth) {
      truncated = frontier.some((nodeId) => {
        const rows = query.direction === 'UPSTREAM' ? this.#incoming.get(nodeId)! : this.#outgoing.get(nodeId)!;
        return rows.some((edge) => allowed.has(edge.type) && !visited.has(query.direction === 'UPSTREAM' ? edge.from : edge.to));
      });
    }

    const nodeIds = [...visited].sort(compareCodeUnits);
    const edgeIds = [...traversedEdges].sort(compareCodeUnits);
    const truth = reportTruth(
      this.#value.truth,
      'topology-traversal-v1',
      [this.#value.id, ...nodeIds, ...edgeIds],
      truncated ? 'TOPOLOGY_TRAVERSAL_TRUNCATED' : null,
    );
    return {
      ok: true,
      value: {
        id: stableId('topology_traversal', {
          snapshotId: this.#value.id,
          startId: query.startId,
          direction: query.direction,
          edgeTypes: edgeTypes.value,
          maxDepth,
          nodeIds,
          edgeIds,
          truncated,
        }),
        startId: query.startId,
        direction: query.direction,
        edgeTypes: edgeTypes.value,
        maxDepth,
        nodeIds,
        edgeIds,
        levels,
        truncated,
        truth,
      },
    };
  }

  cycles(query: TopologyCycleQuery): ValidationResult<TopologyCycleReport> {
    if (!object(query) || !['DEPENDENCIES', 'TYPED_EDGES'].includes(String(query.scope))) {
      return fail('INVALID_VARIANT', 'topology cycle scope is invalid', 'scope');
    }
    if (query.scope === 'DEPENDENCIES' && query.edgeTypes !== undefined) {
      return fail('INVALID_VALUE', 'dependency-cycle queries do not accept edge type filters', 'edgeTypes');
    }
    const edgeTypes = query.scope === 'TYPED_EDGES'
      ? normalizeEdgeTypes(query.edgeTypes, this.#limits)
      : { ok: true as const, value: [...TOPOLOGY_EDGE_TYPES] };
    if (!edgeTypes.ok) return edgeTypes as ValidationResult<TopologyCycleReport>;
    const allowed = new Set(edgeTypes.value);
    const adjacency = new Map<string, string[]>();
    for (const node of this.#value.nodes) {
      adjacency.set(
        node.id,
        query.scope === 'DEPENDENCIES'
          ? [...node.dependencyIds]
          : sortedUnique((this.#outgoing.get(node.id) ?? [])
            .filter((edge) => allowed.has(edge.type))
            .map((edge) => edge.to)),
      );
    }
    const components = stronglyConnectedComponents(this.#value.nodes.map((node) => node.id), adjacency);
    if (components.length > this.#limits.maxCycles) {
      return fail('BUDGET_EXHAUSTED', 'topology cycle result exceeds configured bounds', 'cycles');
    }
    const cycles = components.map((nodeIds): TopologyCycle => {
      const selectedNodes = new Set(nodeIds);
      const internalEdges = this.#value.edges.filter((edge) => {
        if (!selectedNodes.has(edge.from) || !selectedNodes.has(edge.to)) return false;
        if (query.scope === 'TYPED_EDGES') return allowed.has(edge.type);
        return this.#nodeMap.get(edge.to)!.dependencyIds.includes(edge.from);
      });
      const edgeIds = internalEdges.map((edge) => edge.id).sort(compareCodeUnits);
      const cycleEdgeTypes = TOPOLOGY_EDGE_TYPES.filter((type) => internalEdges.some((edge) => edge.type === type));
      return {
        id: stableId('topology_cycle', { scope: query.scope, nodeIds, edgeIds }),
        scope: query.scope,
        nodeIds,
        edgeIds,
        edgeTypes: cycleEdgeTypes,
        truth: reportTruth(this.#value.truth, 'topology-cycle-v1', [...nodeIds, ...edgeIds]),
      };
    });
    const cycleIds = cycles.map((cycle) => cycle.id);
    return {
      ok: true,
      value: {
        id: stableId('topology_cycle_report', {
          snapshotId: this.#value.id,
          scope: query.scope,
          edgeTypes: edgeTypes.value,
          cycleIds,
        }),
        scope: query.scope,
        edgeTypes: edgeTypes.value,
        cycles,
        truth: reportTruth(
          this.#value.truth,
          'topology-cycle-report-v1',
          [this.#value.id, ...cycleIds],
        ),
      },
    };
  }

  blocking(nodeId: string): ValidationResult<TopologyBlockingReport> {
    if (!this.#nodeMap.has(nodeId)) return fail('MISSING_SOURCE', 'topology node does not exist', 'nodeId', [nodeId]);
    const paths = new Map<string, string[]>([[nodeId, [nodeId]]]);
    const queue = [nodeId];
    for (let index = 0; index < queue.length; index += 1) {
      const currentId = queue[index];
      const currentPath = paths.get(currentId)!;
      for (const dependencyId of this.#nodeMap.get(currentId)!.dependencyIds) {
        if (paths.has(dependencyId)) continue;
        if (paths.size >= this.#limits.maxTraversalResults) {
          return fail('BUDGET_EXHAUSTED', 'topology blocking traversal exceeds configured bounds', 'blocking', [nodeId]);
        }
        paths.set(dependencyId, [...currentPath, dependencyId]);
        queue.push(dependencyId);
      }
    }

    const blockers: TopologyBlocker[] = [];
    for (const [blockedById, path] of [...paths.entries()].sort(([left], [right]) => compareCodeUnits(left, right))) {
      const blockedBy = this.#nodeMap.get(blockedById)!;
      const reasonCodes = this.#directBlockingReasons(blockedBy);
      if (reasonCodes.length === 0) continue;
      const direct = blockedById === nodeId;
      blockers.push({
        id: stableId('topology_blocker', { targetId: nodeId, blockedById, direct, reasonCodes, path }),
        targetId: nodeId,
        blockedById,
        direct,
        reasonCodes,
        path: [...path],
        truth: reportTruth(
          this.#value.truth,
          'topology-blocker-v1',
          [...path, ...(blockedBy.lastError === null ? [] : [blockedBy.lastError.id])],
        ),
      });
    }

    const cycles = this.cycles({ scope: 'DEPENDENCIES' });
    if (!cycles.ok) return cycles as ValidationResult<TopologyBlockingReport>;
    const reachable = new Set(paths.keys());
    const reachableCycles = cycles.value.cycles.filter((cycle) => cycle.nodeIds.some((id) => reachable.has(id)));
    for (const cycle of reachableCycles) {
      const blockedById = cycle.nodeIds
        .filter((id) => paths.has(id))
        .sort((left, right) => paths.get(left)!.length - paths.get(right)!.length || compareCodeUnits(left, right))[0];
      const path = paths.get(blockedById)!;
      const reasonCodes = ['DEPENDENCY_CYCLE'];
      blockers.push({
        id: stableId('topology_blocker', {
          targetId: nodeId,
          blockedById,
          direct: blockedById === nodeId,
          reasonCodes,
          path,
          cycleId: cycle.id,
        }),
        targetId: nodeId,
        blockedById,
        direct: blockedById === nodeId,
        reasonCodes,
        path: [...path],
        truth: reportTruth(this.#value.truth, 'topology-blocker-v1', [...path, cycle.id]),
      });
    }
    blockers.sort((left, right) =>
      Number(right.direct) - Number(left.direct) || left.path.length - right.path.length ||
      compareCodeUnits(left.blockedById, right.blockedById) || compareCodeUnits(left.id, right.id));
    const dependencyCycleIds = reachableCycles.map((cycle) => cycle.id).sort(compareCodeUnits);
    const truth = reportTruth(
      this.#value.truth,
      'topology-blocking-report-v1',
      [this.#value.id, nodeId, ...blockers.map((blocker) => blocker.id), ...dependencyCycleIds],
    );
    return {
      ok: true,
      value: {
        id: stableId('topology_blocking', {
          snapshotId: this.#value.id,
          targetId: nodeId,
          blockerIds: blockers.map((blocker) => blocker.id),
          dependencyCycleIds,
        }),
        targetId: nodeId,
        blocked: blockers.length > 0,
        blockers,
        dependencyCycleIds,
        truth,
      },
    };
  }

  bounds(): TopologyBounds {
    return { ...this.#limits };
  }

  #incidentEdges(
    nodeId: string,
    direction: TopologyTraversalDirection,
    edgeTypes?: readonly TopologyEdgeType[],
  ): ValidationResult<TopologyEdge[]> {
    if (!this.#nodeMap.has(nodeId)) return fail('MISSING_SOURCE', 'topology node does not exist', 'nodeId', [nodeId]);
    const normalized = normalizeEdgeTypes(edgeTypes, this.#limits);
    if (!normalized.ok) return normalized as ValidationResult<TopologyEdge[]>;
    const allowed = new Set(normalized.value);
    const rows = direction === 'UPSTREAM' ? this.#incoming.get(nodeId)! : this.#outgoing.get(nodeId)!;
    return { ok: true, value: rows.filter((edge) => allowed.has(edge.type)).map(cloneEdge) };
  }

  #directBlockingReasons(node: ComponentDescriptor): string[] {
    const reasons: string[] = [];
    if (node.blockingReason !== null) reasons.push(node.blockingReason);
    if (node.observedState === 'NOT_WIRED' || node.observedState === 'UNAVAILABLE') reasons.push(node.observedState);
    if (node.lastError !== null) reasons.push(node.lastError.code);
    if (node.freshness.state !== 'FRESH') reasons.push(`FRESHNESS_${node.freshness.state}`);
    if (node.truth.completeness.state !== 'COMPLETE') reasons.push(`COMPLETENESS_${node.truth.completeness.state}`);
    return sortedUnique(reasons);
  }
}

Object.freeze(ImmutableTopologyReadModel.prototype);
Object.freeze(ImmutableTopologyReadModel);

export function createTopologyRegistry(
  input: TopologyBuildInput,
  boundsInput: Partial<TopologyBounds> = DEFAULT_TOPOLOGY_BOUNDS,
): TopologyRegistryResult {
  const bounds = normalizeTopologyBounds(boundsInput);
  if (bounds === null) return fail('INVALID_VALUE', 'topology bounds are invalid', 'bounds');
  const secret = validateNoSecretFields(input, 'intelligence_topology');
  if (!secret.ok) return secret as TopologyRegistryResult;
  if (!object(input) || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    return fail('INVALID_VALUE', 'topology input requires node and edge arrays', null);
  }
  if (input.nodes.length > bounds.maxNodes || input.edges.length > bounds.maxEdges) {
    return fail('BUDGET_EXHAUSTED', 'topology exceeds configured node or edge capacity', null);
  }
  const truth = validateTruthMetadata(input.truth);
  if (!truth.ok) return truth as TopologyRegistryResult;

  const rawNodes = [...input.nodes].sort((left, right) =>
    compareCodeUnits(String(left?.id ?? ''), String(right?.id ?? '')));
  const rawNodeIds = new Set<string>();
  for (const rawNode of rawNodes) {
    const rawId = object(rawNode) && typeof rawNode.id === 'string' ? rawNode.id : '';
    if (COMPONENT_ID.test(rawId) && rawNodeIds.has(rawId)) {
      return fail('DUPLICATE_EVENT', 'topology component ID is duplicated', `nodes.${rawId}`, [rawId]);
    }
    if (COMPONENT_ID.test(rawId)) rawNodeIds.add(rawId);
  }
  const nodes: ComponentDescriptor[] = [];
  const nodeIds = new Set<string>();
  for (const rawNode of rawNodes) {
    const normalized = normalizeComponent(rawNode, bounds);
    if (!normalized.ok) return normalized as TopologyRegistryResult;
    if (nodeIds.has(normalized.value.id)) {
      return fail('DUPLICATE_EVENT', 'topology component ID is duplicated', `nodes.${normalized.value.id}`, [normalized.value.id]);
    }
    nodeIds.add(normalized.value.id);
    nodes.push(normalized.value);
  }

  const rawEdges = [...input.edges].sort(rawEdgeComparator);
  const rawEdgeIds = new Set<string>();
  for (const rawEdge of rawEdges) {
    const rawId = object(rawEdge) && typeof rawEdge.id === 'string' ? rawEdge.id : '';
    if (EDGE_ID.test(rawId) && rawEdgeIds.has(rawId)) {
      return fail('DUPLICATE_EVENT', 'topology edge ID is duplicated', `edges.${rawId}`, [rawId]);
    }
    if (EDGE_ID.test(rawId)) rawEdgeIds.add(rawId);
  }
  const edges: TopologyEdge[] = [];
  const edgeIds = new Set<string>();
  const edgeSemantics = new Set<string>();
  for (const rawEdge of rawEdges) {
    const normalized = normalizeEdge(rawEdge, bounds);
    if (!normalized.ok) return normalized as TopologyRegistryResult;
    const edge = normalized.value;
    if (edgeIds.has(edge.id)) return fail('DUPLICATE_EVENT', 'topology edge ID is duplicated', `edges.${edge.id}`, [edge.id]);
    const semantic = canonicalJson({ from: edge.from, to: edge.to, type: edge.type, label: edge.label });
    if (edgeSemantics.has(semantic)) return fail('DUPLICATE_EVENT', 'topology edge semantics are duplicated', `edges.${edge.id}`, [edge.id]);
    edgeIds.add(edge.id);
    edgeSemantics.add(semantic);
    edges.push(edge);
  }
  edges.sort(edgeComparator);

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) {
      return fail('MISSING_SOURCE', 'topology edge references an unknown component', `edges.${edge.id}`, [edge.id, edge.from, edge.to]);
    }
  }
  for (const node of nodes) {
    for (const dependencyId of node.dependencyIds) {
      if (!nodeMap.has(dependencyId)) {
        return fail('MISSING_SOURCE', 'component dependency is absent from the topology', `nodes.${node.id}.dependencyIds`, [node.id, dependencyId]);
      }
      if (!edges.some((edge) => edge.from === dependencyId && edge.to === node.id)) {
        return fail('MISSING_SOURCE', 'component dependency lacks a typed inbound edge', `nodes.${node.id}.dependencyIds`, [node.id, dependencyId]);
      }
    }
  }

  const canonicalTruth = deriveSnapshotTruth(truth.value, nodes, edges);
  if (!canonicalTruth.ok) return canonicalTruth as TopologyRegistryResult;
  const snapshot: TopologySnapshot = {
    id: snapshotIdentity(nodes, edges, canonicalTruth.value),
    nodes: nodes.map(cloneComponent),
    edges: edges.map(cloneEdge),
    truth: cloneTruth(canonicalTruth.value),
  };
  return { ok: true, value: new ImmutableTopologyReadModel(snapshot, bounds) };
}

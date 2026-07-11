import type {
  ComponentDescriptor,
  Freshness,
  SourceAuthority,
  StableFailure,
  TopologyEdge,
  TopologySnapshot,
  TruthMetadata,
} from '../contracts/index.js';

export function cloneAuthority(value: SourceAuthority): SourceAuthority {
  return { ...value };
}

export function cloneFreshness(value: Freshness): Freshness {
  return { ...value };
}

export function cloneTruth(value: TruthMetadata): TruthMetadata {
  return {
    ...value,
    authority: cloneAuthority(value.authority),
    provenance: {
      sourceRecordIds: [...value.provenance.sourceRecordIds],
      sourceSet: [...value.provenance.sourceSet],
      transforms: [...value.provenance.transforms],
    },
    temporal: {
      ...value.temporal,
      sequence: value.temporal.sequence === null ? null : { ...value.temporal.sequence },
    },
    freshness: cloneFreshness(value.freshness),
    completeness: {
      ...value.completeness,
      observedFields: [...value.completeness.observedFields],
      missingFields: [...value.completeness.missingFields],
      reasonCodes: [...value.completeness.reasonCodes],
    },
  };
}

export function cloneFailure(value: StableFailure): StableFailure {
  return { ...value, evidenceIds: [...value.evidenceIds] };
}

export function cloneComponent(value: ComponentDescriptor): ComponentDescriptor {
  const truth = cloneTruth(value.truth);
  return {
    ...value,
    dependencyIds: [...value.dependencyIds],
    inputs: [...value.inputs],
    outputs: [...value.outputs],
    authority: cloneAuthority(truth.authority),
    freshness: cloneFreshness(truth.freshness),
    lastError: value.lastError === null ? null : cloneFailure(value.lastError),
    metrics: value.metrics.map((metric) => ({ ...metric })),
    safeControlsSupportedLater: [...value.safeControlsSupportedLater],
    truth,
  };
}

export function cloneEdge(value: TopologyEdge): TopologyEdge {
  return { ...value, truth: cloneTruth(value.truth) };
}

export function cloneSnapshot(value: TopologySnapshot): TopologySnapshot {
  return {
    ...value,
    nodes: value.nodes.map(cloneComponent),
    edges: value.edges.map(cloneEdge),
    truth: cloneTruth(value.truth),
  };
}

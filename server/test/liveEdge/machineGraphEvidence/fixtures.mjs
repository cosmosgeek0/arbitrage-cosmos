import {
  CANONICAL_SYSTEM_COMPONENT_IDS,
  MACHINE_GRAPH_ALARMS,
  MACHINE_GRAPH_CONTROL_ACTIONS,
  MACHINE_GRAPH_METRICS,
  MACHINE_GRAPH_METRIC_INSTRUMENTS,
  MACHINE_GRAPH_METRIC_UNITS,
  MACHINE_GRAPH_ROLES,
} from '../../../dist/liveEdge/adapters/machineGraphEvidence/index.js';
import {
  projectExposureRecoverySnapshot,
} from '../../../dist/liveEdge/adapters/exposureRecoveryProjection/index.js';
import {
  completeInput as completeL12Input,
} from '../exposureRecoveryProjection/fixtures.mjs';

export const ASSEMBLED_AT_MS = 1_783_980_100_000;
export const OWNER_DIGEST = `sha256:${'a'.repeat(64)}`;

const COMPONENTS_BY_ROLE = new Map([
  ['SPOT_PUBLIC_STREAM', ['public-spot-source']],
  ['USD_M_PUBLIC_STREAM', ['public-usdm-source']],
  ['INSTRUMENT_FILTER_REGISTRY', ['market-universe']],
  ['EVIDENCE_ATTENTION_RUNTIME', ['intelligence-runtime', 'market-intelligence']],
  ['BASIS_ENGINE', ['basis-engine']],
  ['VOLUME_ENGINE', ['volume-engine']],
  ['CAPITAL_GATE', ['capital-supervision']],
  ['RISK_GATE', ['multileg-risk']],
  ['EXECUTION_HAND', ['execution-coordinator-validate-only']],
  ['RECONCILIATION', ['reconciliation']],
  ['LEDGER_READ_MODEL', ['ledger-persistence']],
]);

const OWNER_GATED_ROLES = new Set([
  'SECRETS_BOUNDARY',
  'CLOCK_SYNCHRONIZATION',
  'SPOT_PRIVATE_STREAM',
  'USD_M_PRIVATE_STREAM',
  'MARGIN_PRIVATE_STREAM',
  'ACCOUNT_TRUTH',
  'QUANT_BRIDGE',
  'PROPOSAL_REJECTION_AUTHORITY',
  'BASIS_COORDINATOR',
  'VOLUME_LIFECYCLE',
  'EXPOSURE_POSITION_SUPERVISOR',
  'OUTCOME_QUANT_FEEDBACK',
  'DATABASE',
]);

export function acceptedL12Snapshot(sourceInput = completeL12Input()) {
  return projectExposureRecoverySnapshot(sourceInput);
}

export function l12Binding(source = acceptedL12Snapshot()) {
  return {
    sourceSchema: source.schema,
    sourceVersion: source.version,
    sourceSnapshotRevision: source.snapshotRevision,
    projectionStatus: source.projectionStatus,
    projectionAuthority: source.projectionAuthority,
    truthClass: source.truthClass,
    subject: source.subject,
    canonicalTruth: source.canonicalTruth,
    componentEvidence: source.componentEvidence,
    recovery: {
      required: source.recovery.required,
      ownerEndState: source.recovery.ownerEndState,
      residualExposure: source.recovery.residualExposure,
      residualLiability: source.recovery.residualLiability,
      ownerRevision: source.recovery.ownerRevision,
      reasonCodes: source.recovery.reasonCodes,
    },
  };
}

export function controls() {
  return MACHINE_GRAPH_CONTROL_ACTIONS.map((action) => {
    const runtimeOnly = ['SET_COMPONENT_DESIRED_STATE', 'SAFE_RESTART_COMPONENT'].includes(action);
    return {
      action,
      implementationState: runtimeOnly ? 'PROVEN_CONTROL_PLANE_RUNTIME_ONLY' : 'CONTRACT_ONLY',
      integrationState: runtimeOnly ? 'UNWIRED' : 'OWNER_GATED',
      availability: 'UNAVAILABLE',
      ownerRevision: 'l14-durable-control-contract-revision-1',
      controlReference: null,
      reasonCodes: [runtimeOnly
        ? 'CONTROL_ROUTE_AND_PERSISTENCE_UNWIRED'
        : 'CANONICAL_OWNER_APPLICATION_UNWIRED'],
    };
  });
}

export function roleBindings() {
  return MACHINE_GRAPH_ROLES.map((role) => {
    const componentIds = [...(COMPONENTS_BY_ROLE.get(role) ?? [])];
    const bindingState = componentIds.length > 0
      ? 'BOUND'
      : OWNER_GATED_ROLES.has(role) ? 'OWNER_GATED' : 'MISSING';
    return {
      role,
      bindingState,
      componentIds,
      bindingRevision: bindingState === 'BOUND' ? 'system-integration-component-contract-revision-1' : null,
      authority: 'INJECTED_SYSTEM_INTEGRATION_CONTRACT_BINDING',
    };
  });
}

function unavailableRole(role) {
  return {
    role,
    owner: `EXPECTED_${role}_OWNER`,
    ownerPath: null,
    ownerRevision: null,
    evidenceState: 'UNAVAILABLE',
    controlState: unavailableControlState(),
    observedState: null,
    heartbeatAtMs: null,
    exchangeEventAgeMs: null,
    localReceiveAgeMs: null,
    localProcessingAgeMs: null,
    inputRate: unavailableRate(),
    outputRate: unavailableRate(),
    queueDepth: null,
    droppedCount: null,
    backpressure: 'UNAVAILABLE',
    sourceType: 'UNAVAILABLE',
    completeness: 'UNAVAILABLE',
    versions: {
      modelVersion: null,
      configVersion: null,
      schemaVersion: null,
      deployedRevision: null,
    },
    lastMeaningfulAdvanceAtMs: null,
    blockerCode: 'OWNER_EVIDENCE_UNAVAILABLE',
    rootCauseReference: null,
    lastError: null,
    supportedControls: [],
    trace: null,
    capitalExposed: null,
    operatorAttentionRequired: null,
  };
}

export function roles(binding = l12Binding()) {
  return MACHINE_GRAPH_ROLES.map((role) => {
    const value = unavailableRole(role);
    if (role !== 'EXPOSURE_POSITION_SUPERVISOR') return value;
    return {
      ...value,
      owner: 'L12_EXPOSURE_RECOVERY_PROJECTION',
      ownerPath: 'server/src/liveEdge/adapters/exposureRecoveryProjection',
      ownerRevision: binding.componentEvidence.ownerRevision,
      evidenceState: 'SYNTHETIC_ONLY',
      observedState: binding.projectionStatus,
      sourceType: 'SYNTHETIC_TEST',
      completeness: 'PARTIAL',
      versions: {
        ...value.versions,
        schemaVersion: binding.sourceSchema,
      },
      blockerCode: binding.projectionStatus === 'COMPLETE_FOR_OWNER_REVIEW'
        ? null
        : binding.projectionStatus,
      trace: {
        correlationId: binding.subject.correlationId,
        traceRevision: binding.sourceSnapshotRevision,
      },
      capitalExposed: binding.componentEvidence.capitalExposed,
      operatorAttentionRequired: binding.componentEvidence.operatorAttentionRequired,
    };
  });
}

export function metrics() {
  return MACHINE_GRAPH_METRICS.map((metric) => ({
    metric,
    unit: MACHINE_GRAPH_METRIC_UNITS[metric],
    status: 'UNAVAILABLE',
    value: null,
    owner: 'FOUNDATION_OBSERVABILITY',
    ownerRevision: null,
    ownerDigest: null,
    observedAtMs: null,
    window: null,
    labels: [],
    reasonCodes: ['OWNER_METRIC_UNAVAILABLE'],
  }));
}

export function alarms() {
  return MACHINE_GRAPH_ALARMS.map((alarm) => ({
    alarm,
    state: 'UNAVAILABLE',
    owner: 'CANONICAL_ALARM_OWNER',
    ownerRevision: null,
    ownerDigest: null,
    observedAtMs: null,
    automaticAction: 'NONE',
    canLiquidate: false,
    canMutateCapital: false,
    haltRecommendation: false,
    trace: null,
    reasonCodes: ['OWNER_ALARM_UNAVAILABLE'],
  }));
}

export function completeInput(source = acceptedL12Snapshot()) {
  const binding = l12Binding(source);
  return {
    assembledAtMs: ASSEMBLED_AT_MS,
    l12Snapshot: source,
    roleBindings: roleBindings(),
    roles: roles(binding),
    controls: controls(),
    metrics: metrics(),
    alarms: alarms(),
  };
}

export function observedMetric(input, metric, value, overrides = {}) {
  const index = MACHINE_GRAPH_METRICS.indexOf(metric);
  input.metrics[index] = {
    ...input.metrics[index],
    status: 'OBSERVED',
    value,
    ownerRevision: 'owner-metric-revision-1',
    ownerDigest: OWNER_DIGEST,
    observedAtMs: ASSEMBLED_AT_MS - 10,
    window: MACHINE_GRAPH_METRIC_INSTRUMENTS[metric] === 'COUNTER' ? counterWindow() : null,
    reasonCodes: [],
    ...overrides,
  };
  return input.metrics[index];
}

export function makeRoleCurrent(input, roleName, overrides = {}) {
  const index = MACHINE_GRAPH_ROLES.indexOf(roleName);
  input.roles[index] = {
    ...input.roles[index],
    owner: `CURRENT_${roleName}_OWNER`,
    ownerPath: `owner/path/${roleName.toLowerCase()}`,
    ownerRevision: `${roleName.toLowerCase()}-owner-revision-1`,
    evidenceState: 'CURRENT',
    controlState: currentControlState(),
    observedState: 'LIVE',
    heartbeatAtMs: ASSEMBLED_AT_MS - 10,
    exchangeEventAgeMs: 10,
    localReceiveAgeMs: 5,
    localProcessingAgeMs: 2,
    inputRate: knownRate('single-input-writer-1', 10, 10),
    outputRate: knownRate('single-output-writer-1', 9, 9),
    queueDepth: 1,
    droppedCount: 0,
    backpressure: 'CLEAR',
    sourceType: 'LIVE_PUBLIC',
    completeness: 'COMPLETE',
    versions: {
      modelVersion: 'model-revision-1',
      configVersion: 'config-revision-1',
      schemaVersion: 'schema-revision-1',
      deployedRevision: 'deployed-revision-1',
    },
    lastMeaningfulAdvanceAtMs: ASSEMBLED_AT_MS - 10,
    blockerCode: null,
    rootCauseReference: null,
    lastError: null,
    trace: {
      correlationId: `trace-${roleName.toLowerCase()}-1`,
      traceRevision: `trace-${roleName.toLowerCase()}-revision-1`,
    },
    supportedControls: ['SET_COMPONENT_DESIRED_STATE', 'SAFE_RESTART_COMPONENT'],
    capitalExposed: null,
    operatorAttentionRequired: null,
    ...overrides,
  };
  return input.roles[index];
}

export function unavailableRate() {
  return {
    diagnostic: null,
    logicalWriterId: null,
    aggregationTemporality: 'UNAVAILABLE',
    authority: 'UNAVAILABLE',
    ownerRevision: null,
    ownerDigest: null,
    observedAtMs: null,
    reasonCodes: ['OWNER_RATE_UNAVAILABLE'],
  };
}

export function knownRate(logicalWriterId, deltaCount, perSecond) {
  return {
    diagnostic: {
      state: 'KNOWN',
      perSecond,
      deltaCount,
      windowMs: 1_000,
      startAtMs: ASSEMBLED_AT_MS - 1_010,
      endAtMs: ASSEMBLED_AT_MS - 10,
      ageMs: 10,
      maxAgeMs: 5_000,
    },
    logicalWriterId,
    aggregationTemporality: 'CUMULATIVE',
    authority: 'FOUNDATION_OBSERVABILITY',
    ownerRevision: 'foundation-observability-revision-1',
    ownerDigest: OWNER_DIGEST,
    observedAtMs: ASSEMBLED_AT_MS,
    reasonCodes: [],
  };
}

export function unavailableControlState() {
  return {
    desiredState: 'UNAVAILABLE',
    phase: 'UNAVAILABLE',
    generation: null,
    authority: 'UNAVAILABLE',
    ownerRevision: null,
    ownerDigest: null,
    observedAtMs: null,
    reasonCodes: ['FOUNDATION_CONTROL_STATE_UNAVAILABLE'],
  };
}

export function currentControlState() {
  return {
    desiredState: 'RUNNING',
    phase: 'RUNNING',
    generation: 1,
    authority: 'FOUNDATION_CONTROL',
    ownerRevision: 'foundation-control-revision-1',
    ownerDigest: OWNER_DIGEST,
    observedAtMs: ASSEMBLED_AT_MS - 10,
    reasonCodes: [],
  };
}

export function counterWindow(overrides = {}) {
  return {
    logicalWriterId: 'single-logical-writer-1',
    continuity: 'CONTIGUOUS',
    aggregationTemporality: 'CUMULATIVE',
    startAtMs: ASSEMBLED_AT_MS - 1_000,
    endAtMs: ASSEMBLED_AT_MS - 10,
    startCount: 10,
    endCount: 20,
    ...overrides,
  };
}

export function canonicalComponentIdsFromBindings(bindings) {
  return bindings.flatMap((entry) => entry.componentIds);
}

export { CANONICAL_SYSTEM_COMPONENT_IDS };

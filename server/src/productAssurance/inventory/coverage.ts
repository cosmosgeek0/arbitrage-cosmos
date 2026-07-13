import {
  ASSURANCE_VERDICTS,
  assertIdentifier,
  assertPositiveSafeInteger,
  assertSafeNonNegativeInteger,
  assertSourcePath,
  assertUtcMs,
  evaluateEvidenceRef,
  sortedUnique,
  type AssuranceEvidenceRef,
  type AssuranceVerdict,
} from '../common.js';

export const INVENTORY_STATES = Object.freeze([
  'CURRENT',
  'STALE',
  'SILENT',
  'UNAVAILABLE',
  'MISSING',
] as const);
export type InventoryState = (typeof INVENTORY_STATES)[number];

export interface ExpectedComponent {
  readonly componentId: string;
  readonly ownerId: string;
  readonly ownerPath: string;
  readonly capitalCritical: boolean;
  readonly silentAfterMs: number;
  readonly staleAfterMs: number;
}

export interface ExpectedDependency {
  readonly dependencyId: string;
  readonly fromComponentId: string;
  readonly toComponentId: string;
  readonly required: boolean;
  readonly capitalCritical: boolean;
}

export interface ExpectedControl {
  readonly controlId: string;
  readonly backendOwnerId: string;
  readonly backendCommandId: string;
  readonly required: boolean;
}

export interface ExpectedTelemetrySignal {
  readonly signalId: string;
  readonly ownerId: string;
  readonly schemaRevision: string;
  readonly freshnessMs: number;
  readonly required: boolean;
  readonly capitalCritical: boolean;
}

export interface ExpectedInventoryManifest {
  readonly schema: 'PRODUCT_ASSURANCE_EXPECTED_INVENTORY_V1';
  readonly revision: number;
  readonly releaseId: string;
  readonly testedCommit: string;
  readonly generatedAtMs: number;
  readonly components: readonly Readonly<ExpectedComponent>[];
  readonly dependencies: readonly Readonly<ExpectedDependency>[];
  readonly controls: readonly Readonly<ExpectedControl>[];
  readonly telemetrySignals: readonly Readonly<ExpectedTelemetrySignal>[];
  readonly invariantIds: readonly string[];
  readonly operationPolicyIds: readonly string[];
  readonly ownerQuestionIds: readonly string[];
}

export interface ObservedComponent {
  readonly componentId: string;
  readonly discovered: boolean;
  readonly explicitlyUnavailable: boolean;
  readonly lastReporterSeenAtMs: number | null;
  readonly lastMeaningfulAdvanceAtMs: number | null;
  readonly observedRevision: string | null;
}

export interface ObservedDependency {
  readonly dependencyId: string;
  readonly discovered: boolean;
  readonly state: 'AVAILABLE' | 'DEGRADED' | 'BLOCKED' | 'UNKNOWN';
}

export interface ObservedControl {
  readonly controlId: string;
  readonly state: 'LIVE' | 'DISABLED' | 'UNIMPLEMENTED' | 'UNKNOWN';
  readonly backendCommandId: string | null;
}

export interface ObservedTelemetrySignal {
  readonly signalId: string;
  readonly observedAtMs: number | null;
  readonly schemaRevision: string | null;
  readonly explicitlyUnavailable: boolean;
}

export interface InventoryObservation {
  readonly observedAtMs: number;
  readonly components: readonly Readonly<ObservedComponent>[];
  readonly dependencies: readonly Readonly<ObservedDependency>[];
  readonly controls: readonly Readonly<ObservedControl>[];
  readonly telemetrySignals: readonly Readonly<ObservedTelemetrySignal>[];
  readonly completeCorrelationTraceAtMs: number | null;
  readonly completeCorrelationTraceFreshnessMs: number;
  readonly independentProbeAtMs: number | null;
  readonly independentProbeFreshnessMs: number;
  readonly independentProbeVerdict: AssuranceVerdict;
  readonly independentProbeEvidence: Readonly<AssuranceEvidenceRef> | null;
}

export interface InventoryStateEntry {
  readonly id: string;
  readonly state: InventoryState;
  readonly reasonCodes: readonly string[];
  readonly capitalCritical: boolean;
}

export interface InventoryCoverageProjection {
  readonly evaluatedAtMs: number;
  readonly expectedCounts: Readonly<{
    components: number;
    dependencies: number;
    controls: number;
    telemetrySignals: number;
  }>;
  readonly componentStates: readonly Readonly<InventoryStateEntry>[];
  readonly dependencyStates: readonly Readonly<InventoryStateEntry>[];
  readonly controlStates: readonly Readonly<InventoryStateEntry>[];
  readonly telemetryStates: readonly Readonly<InventoryStateEntry>[];
  readonly counts: Readonly<Record<InventoryState, number>>;
  readonly observabilityCoveragePercentage: number;
  readonly missingCapitalCriticalIds: readonly string[];
  readonly unobservedCapitalCriticalDependencyIds: readonly string[];
  readonly schemaIncompatibleSignalIds: readonly string[];
  readonly completeCorrelationTraceAtMs: number | null;
  readonly independentProbeAtMs: number | null;
  readonly independentProbeVerdict: AssuranceVerdict;
  readonly overallVerdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
}

function uniqueIds<T>(entries: readonly T[], select: (entry: T) => string, label: string): void {
  const ids = entries.map(select);
  if (new Set(ids).size !== ids.length) throw new TypeError(`${label} contains duplicate IDs`);
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
}

function assertEnum(value: unknown, allowed: readonly string[], label: string): asserts value is string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new TypeError(`${label} is unsupported`);
  }
}

function assertOptionalIdentifier(value: unknown, label: string): asserts value is string | null {
  if (value !== null) assertIdentifier(value, label);
}

function assertObservedTime(
  value: unknown,
  observedAtMs: number,
  label: string,
): asserts value is number | null {
  if (value === null) return;
  assertUtcMs(value, label);
  if (value > observedAtMs) throw new TypeError(`${label} cannot be later than observation.observedAtMs`);
}

export function validateExpectedInventoryManifest(manifest: Readonly<ExpectedInventoryManifest>): void {
  if (manifest.schema !== 'PRODUCT_ASSURANCE_EXPECTED_INVENTORY_V1') throw new TypeError('inventory schema unsupported');
  assertSafeNonNegativeInteger(manifest.revision, 'manifest.revision');
  assertIdentifier(manifest.releaseId, 'manifest.releaseId');
  if (!/^[a-f0-9]{40}$/u.test(manifest.testedCommit)) throw new TypeError('manifest.testedCommit must be a bound full lowercase Git SHA-1');
  assertUtcMs(manifest.generatedAtMs, 'manifest.generatedAtMs');
  uniqueIds(manifest.components, (entry) => entry.componentId, 'manifest.components');
  uniqueIds(manifest.dependencies, (entry) => entry.dependencyId, 'manifest.dependencies');
  uniqueIds(manifest.controls, (entry) => entry.controlId, 'manifest.controls');
  uniqueIds(manifest.telemetrySignals, (entry) => entry.signalId, 'manifest.telemetrySignals');
  if (manifest.components.length === 0 || manifest.dependencies.length === 0 || manifest.controls.length === 0 || manifest.telemetrySignals.length === 0) {
    throw new TypeError('expected inventory denominator families must be nonempty');
  }
  const componentIds = new Set(manifest.components.map((entry) => entry.componentId));
  for (const component of manifest.components) {
    assertIdentifier(component.componentId, 'component.componentId');
    assertIdentifier(component.ownerId, 'component.ownerId');
    assertSourcePath(component.ownerPath, 'component.ownerPath');
    assertBoolean(component.capitalCritical, 'component.capitalCritical');
    assertPositiveSafeInteger(component.silentAfterMs, 'component.silentAfterMs');
    assertPositiveSafeInteger(component.staleAfterMs, 'component.staleAfterMs');
    if (component.staleAfterMs < component.silentAfterMs) {
      throw new TypeError(`component ${component.componentId} staleAfterMs must be >= silentAfterMs`);
    }
  }
  for (const dependency of manifest.dependencies) {
    assertIdentifier(dependency.dependencyId, 'dependency.dependencyId');
    assertIdentifier(dependency.fromComponentId, 'dependency.fromComponentId');
    assertIdentifier(dependency.toComponentId, 'dependency.toComponentId');
    assertBoolean(dependency.required, 'dependency.required');
    assertBoolean(dependency.capitalCritical, 'dependency.capitalCritical');
    if (!componentIds.has(dependency.fromComponentId) || !componentIds.has(dependency.toComponentId)) {
      throw new TypeError(`dependency ${dependency.dependencyId} references an unknown component`);
    }
  }
  for (const control of manifest.controls) {
    assertIdentifier(control.controlId, 'control.controlId');
    assertIdentifier(control.backendOwnerId, 'control.backendOwnerId');
    assertIdentifier(control.backendCommandId, 'control.backendCommandId');
    assertBoolean(control.required, 'control.required');
  }
  for (const signal of manifest.telemetrySignals) {
    assertIdentifier(signal.signalId, 'signal.signalId');
    assertIdentifier(signal.ownerId, 'signal.ownerId');
    assertIdentifier(signal.schemaRevision, 'signal.schemaRevision');
    assertPositiveSafeInteger(signal.freshnessMs, 'signal.freshnessMs');
    assertBoolean(signal.required, 'signal.required');
    assertBoolean(signal.capitalCritical, 'signal.capitalCritical');
  }
  uniqueIds(manifest.invariantIds, (entry) => entry, 'manifest.invariantIds');
  uniqueIds(manifest.operationPolicyIds, (entry) => entry, 'manifest.operationPolicyIds');
  uniqueIds(manifest.ownerQuestionIds, (entry) => entry, 'manifest.ownerQuestionIds');
  for (const [label, ids] of [
    ['manifest.invariantIds', manifest.invariantIds],
    ['manifest.operationPolicyIds', manifest.operationPolicyIds],
    ['manifest.ownerQuestionIds', manifest.ownerQuestionIds],
  ] as const) {
    for (const id of ids) assertIdentifier(id, label);
  }
}

function validateInventoryObservation(observation: Readonly<InventoryObservation>): void {
  assertUtcMs(observation.observedAtMs, 'observation.observedAtMs');
  assertPositiveSafeInteger(observation.completeCorrelationTraceFreshnessMs, 'observation.completeCorrelationTraceFreshnessMs');
  assertPositiveSafeInteger(observation.independentProbeFreshnessMs, 'observation.independentProbeFreshnessMs');
  assertEnum(observation.independentProbeVerdict, ASSURANCE_VERDICTS, 'observation.independentProbeVerdict');
  assertObservedTime(observation.completeCorrelationTraceAtMs, observation.observedAtMs, 'observation.completeCorrelationTraceAtMs');
  assertObservedTime(observation.independentProbeAtMs, observation.observedAtMs, 'observation.independentProbeAtMs');
  if (observation.independentProbeEvidence !== null && typeof observation.independentProbeEvidence !== 'object') {
    throw new TypeError('observation.independentProbeEvidence must be an evidence object or null');
  }

  uniqueIds(observation.components, (entry) => entry.componentId, 'observation.components');
  uniqueIds(observation.dependencies, (entry) => entry.dependencyId, 'observation.dependencies');
  uniqueIds(observation.controls, (entry) => entry.controlId, 'observation.controls');
  uniqueIds(observation.telemetrySignals, (entry) => entry.signalId, 'observation.telemetrySignals');

  for (const component of observation.components) {
    assertIdentifier(component.componentId, 'observedComponent.componentId');
    assertBoolean(component.discovered, 'observedComponent.discovered');
    assertBoolean(component.explicitlyUnavailable, 'observedComponent.explicitlyUnavailable');
    assertObservedTime(component.lastReporterSeenAtMs, observation.observedAtMs, 'observedComponent.lastReporterSeenAtMs');
    assertObservedTime(component.lastMeaningfulAdvanceAtMs, observation.observedAtMs, 'observedComponent.lastMeaningfulAdvanceAtMs');
    assertOptionalIdentifier(component.observedRevision, 'observedComponent.observedRevision');
    if (
      component.lastReporterSeenAtMs !== null
      && component.lastMeaningfulAdvanceAtMs !== null
      && component.lastMeaningfulAdvanceAtMs > component.lastReporterSeenAtMs
    ) {
      throw new TypeError(`observed component ${component.componentId} advanced after its last reporter observation`);
    }
  }
  for (const dependency of observation.dependencies) {
    assertIdentifier(dependency.dependencyId, 'observedDependency.dependencyId');
    assertBoolean(dependency.discovered, 'observedDependency.discovered');
    assertEnum(dependency.state, ['AVAILABLE', 'DEGRADED', 'BLOCKED', 'UNKNOWN'], 'observedDependency.state');
  }
  for (const control of observation.controls) {
    assertIdentifier(control.controlId, 'observedControl.controlId');
    assertEnum(control.state, ['LIVE', 'DISABLED', 'UNIMPLEMENTED', 'UNKNOWN'], 'observedControl.state');
    assertOptionalIdentifier(control.backendCommandId, 'observedControl.backendCommandId');
    if (control.state === 'LIVE' && control.backendCommandId === null) {
      throw new TypeError(`live control ${control.controlId} requires a backend command ID`);
    }
  }
  for (const signal of observation.telemetrySignals) {
    assertIdentifier(signal.signalId, 'observedTelemetry.signalId');
    assertObservedTime(signal.observedAtMs, observation.observedAtMs, 'observedTelemetry.observedAtMs');
    assertOptionalIdentifier(signal.schemaRevision, 'observedTelemetry.schemaRevision');
    assertBoolean(signal.explicitlyUnavailable, 'observedTelemetry.explicitlyUnavailable');
  }
}

function classifyComponent(
  expected: Readonly<ExpectedComponent>,
  observed: Readonly<ObservedComponent> | undefined,
  nowMs: number,
): Readonly<InventoryStateEntry> {
  if (observed === undefined || !observed.discovered) {
    return Object.freeze({ id: expected.componentId, state: 'MISSING', reasonCodes: Object.freeze(['EXPECTED_COMPONENT_MISSING']), capitalCritical: expected.capitalCritical });
  }
  if (observed.explicitlyUnavailable) {
    return Object.freeze({ id: expected.componentId, state: 'UNAVAILABLE', reasonCodes: Object.freeze(['COMPONENT_EXPLICITLY_UNAVAILABLE']), capitalCritical: expected.capitalCritical });
  }
  if (observed.lastReporterSeenAtMs === null) {
    return Object.freeze({ id: expected.componentId, state: 'SILENT', reasonCodes: Object.freeze(['COMPONENT_NEVER_REPORTED']), capitalCritical: expected.capitalCritical });
  }
  assertUtcMs(observed.lastReporterSeenAtMs, 'observed.lastReporterSeenAtMs');
  if (nowMs - observed.lastReporterSeenAtMs >= expected.silentAfterMs) {
    return Object.freeze({ id: expected.componentId, state: 'SILENT', reasonCodes: Object.freeze(['REPORTER_SILENT']), capitalCritical: expected.capitalCritical });
  }
  if (observed.lastMeaningfulAdvanceAtMs === null) {
    return Object.freeze({ id: expected.componentId, state: 'STALE', reasonCodes: Object.freeze(['MEANINGFUL_ADVANCE_MISSING']), capitalCritical: expected.capitalCritical });
  }
  assertUtcMs(observed.lastMeaningfulAdvanceAtMs, 'observed.lastMeaningfulAdvanceAtMs');
  if (nowMs - observed.lastMeaningfulAdvanceAtMs >= expected.staleAfterMs) {
    return Object.freeze({ id: expected.componentId, state: 'STALE', reasonCodes: Object.freeze(['MEANINGFUL_ADVANCE_STALE']), capitalCritical: expected.capitalCritical });
  }
  return Object.freeze({ id: expected.componentId, state: 'CURRENT', reasonCodes: Object.freeze([]), capitalCritical: expected.capitalCritical });
}

export function projectInventoryCoverage(
  manifest: Readonly<ExpectedInventoryManifest>,
  observation: Readonly<InventoryObservation>,
): Readonly<InventoryCoverageProjection> {
  validateExpectedInventoryManifest(manifest);
  validateInventoryObservation(observation);
  if (manifest.generatedAtMs > observation.observedAtMs) {
    throw new TypeError('manifest.generatedAtMs cannot be later than observation.observedAtMs');
  }
  const componentById = new Map(observation.components.map((entry) => [entry.componentId, entry]));
  const dependencyById = new Map(observation.dependencies.map((entry) => [entry.dependencyId, entry]));
  const controlById = new Map(observation.controls.map((entry) => [entry.controlId, entry]));
  const signalById = new Map(observation.telemetrySignals.map((entry) => [entry.signalId, entry]));

  const componentStates = manifest.components.map((expected) => classifyComponent(expected, componentById.get(expected.componentId), observation.observedAtMs));
  const dependencyStates = manifest.dependencies.map((expected): Readonly<InventoryStateEntry> => {
    const observed = dependencyById.get(expected.dependencyId);
    if (observed === undefined || !observed.discovered) return Object.freeze({ id: expected.dependencyId, state: 'MISSING', reasonCodes: Object.freeze(['EXPECTED_DEPENDENCY_MISSING']), capitalCritical: expected.capitalCritical });
    if (observed.state === 'UNKNOWN') return Object.freeze({ id: expected.dependencyId, state: 'UNAVAILABLE', reasonCodes: Object.freeze(['DEPENDENCY_STATE_UNKNOWN']), capitalCritical: expected.capitalCritical });
    if (observed.state === 'BLOCKED') return Object.freeze({ id: expected.dependencyId, state: 'STALE', reasonCodes: Object.freeze(['DEPENDENCY_BLOCKED']), capitalCritical: expected.capitalCritical });
    if (observed.state === 'DEGRADED') return Object.freeze({ id: expected.dependencyId, state: 'STALE', reasonCodes: Object.freeze(['DEPENDENCY_DEGRADED']), capitalCritical: expected.capitalCritical });
    return Object.freeze({ id: expected.dependencyId, state: 'CURRENT', reasonCodes: Object.freeze([]), capitalCritical: expected.capitalCritical });
  });
  const controlStates = manifest.controls.map((expected): Readonly<InventoryStateEntry> => {
    const observed = controlById.get(expected.controlId);
    if (observed === undefined) return Object.freeze({ id: expected.controlId, state: 'MISSING', reasonCodes: Object.freeze(['EXPECTED_CONTROL_MISSING']), capitalCritical: expected.required });
    if (observed.state === 'UNIMPLEMENTED') return Object.freeze({ id: expected.controlId, state: 'MISSING', reasonCodes: Object.freeze(['CONTROL_UNIMPLEMENTED']), capitalCritical: expected.required });
    if (observed.state === 'UNKNOWN') return Object.freeze({ id: expected.controlId, state: 'UNAVAILABLE', reasonCodes: Object.freeze(['CONTROL_STATE_UNKNOWN']), capitalCritical: expected.required });
    if (observed.backendCommandId !== expected.backendCommandId) return Object.freeze({ id: expected.controlId, state: 'UNAVAILABLE', reasonCodes: Object.freeze(['CONTROL_COMMAND_MISMATCH']), capitalCritical: expected.required });
    if (observed.state === 'DISABLED' && expected.required) return Object.freeze({ id: expected.controlId, state: 'UNAVAILABLE', reasonCodes: Object.freeze(['REQUIRED_CONTROL_DISABLED']), capitalCritical: true });
    return Object.freeze({ id: expected.controlId, state: 'CURRENT', reasonCodes: Object.freeze(observed.state === 'DISABLED' ? ['OPTIONAL_CONTROL_DISABLED_HONESTLY'] : []), capitalCritical: expected.required });
  });
  const schemaIncompatible: string[] = [];
  const telemetryStates = manifest.telemetrySignals.map((expected): Readonly<InventoryStateEntry> => {
    const observed = signalById.get(expected.signalId);
    if (observed === undefined) return Object.freeze({ id: expected.signalId, state: 'MISSING', reasonCodes: Object.freeze(['EXPECTED_TELEMETRY_MISSING']), capitalCritical: expected.capitalCritical });
    if (observed.explicitlyUnavailable) return Object.freeze({ id: expected.signalId, state: 'UNAVAILABLE', reasonCodes: Object.freeze(['TELEMETRY_EXPLICITLY_UNAVAILABLE']), capitalCritical: expected.capitalCritical });
    if (observed.schemaRevision !== expected.schemaRevision) {
      schemaIncompatible.push(expected.signalId);
      return Object.freeze({ id: expected.signalId, state: 'UNAVAILABLE', reasonCodes: Object.freeze(['TELEMETRY_SCHEMA_INCOMPATIBLE']), capitalCritical: expected.capitalCritical });
    }
    if (observed.observedAtMs === null) return Object.freeze({ id: expected.signalId, state: 'SILENT', reasonCodes: Object.freeze(['TELEMETRY_NEVER_OBSERVED']), capitalCritical: expected.capitalCritical });
    assertUtcMs(observed.observedAtMs, 'telemetry.observedAtMs');
    if (observation.observedAtMs - observed.observedAtMs >= expected.freshnessMs) return Object.freeze({ id: expected.signalId, state: 'STALE', reasonCodes: Object.freeze(['TELEMETRY_STALE']), capitalCritical: expected.capitalCritical });
    return Object.freeze({ id: expected.signalId, state: 'CURRENT', reasonCodes: Object.freeze([]), capitalCritical: expected.capitalCritical });
  });

  const allStates = [...componentStates, ...dependencyStates, ...controlStates, ...telemetryStates];
  const counts: Record<InventoryState, number> = { CURRENT: 0, STALE: 0, SILENT: 0, UNAVAILABLE: 0, MISSING: 0 };
  for (const entry of allStates) counts[entry.state] += 1;
  const denominator = allStates.length;
  const coveragePercentage = denominator === 0 ? 0 : Number(((counts.CURRENT / denominator) * 100).toFixed(2));
  const missingCritical = sortedUnique(allStates.filter((entry) => entry.capitalCritical && entry.state !== 'CURRENT').map((entry) => entry.id));
  const unobservedCriticalDependencies = sortedUnique(dependencyStates.filter((entry) => entry.capitalCritical && entry.state !== 'CURRENT').map((entry) => entry.id));
  const reasons: string[] = [];
  if (denominator === 0) reasons.push('EXPECTED_INVENTORY_EMPTY');
  if (missingCritical.length > 0) reasons.push('CAPITAL_CRITICAL_INVENTORY_INCOMPLETE');
  if (counts.MISSING > 0) reasons.push('EXPECTED_INVENTORY_MISSING');
  if (counts.SILENT > 0) reasons.push('EXPECTED_INVENTORY_SILENT');
  if (counts.STALE > 0) reasons.push('EXPECTED_INVENTORY_STALE');
  if (counts.UNAVAILABLE > 0) reasons.push('EXPECTED_INVENTORY_UNAVAILABLE');
  if (observation.independentProbeVerdict === 'FAIL') reasons.push('INDEPENDENT_PROBE_FAILED');
  if (observation.independentProbeVerdict === 'UNKNOWN') reasons.push('INDEPENDENT_PROBE_UNKNOWN');
  if (observation.completeCorrelationTraceAtMs === null) reasons.push('COMPLETE_CORRELATION_TRACE_MISSING');
  else if (observation.observedAtMs - observation.completeCorrelationTraceAtMs >= observation.completeCorrelationTraceFreshnessMs) reasons.push('COMPLETE_CORRELATION_TRACE_STALE');
  if (observation.independentProbeAtMs === null) reasons.push('INDEPENDENT_PROBE_MISSING');
  else if (observation.observedAtMs - observation.independentProbeAtMs >= observation.independentProbeFreshnessMs) reasons.push('INDEPENDENT_PROBE_STALE');
  const expectedProbeOwnerId = manifest.telemetrySignals.find((signal) => signal.signalId === 'TEL_INDEPENDENT_BLACK_BOX_PROBE')?.ownerId ?? null;
  if (observation.independentProbeEvidence === null) {
    reasons.push('INDEPENDENT_PROBE_EVIDENCE_MISSING');
  } else {
    const probeEvidence = evaluateEvidenceRef(observation.independentProbeEvidence, observation.observedAtMs, true);
    if (probeEvidence.verdict === 'FAIL') reasons.push('INDEPENDENT_PROBE_EVIDENCE_FAILED');
    if (probeEvidence.verdict === 'UNKNOWN') reasons.push('INDEPENDENT_PROBE_EVIDENCE_UNKNOWN');
    if (expectedProbeOwnerId === null || observation.independentProbeEvidence.ownerId !== expectedProbeOwnerId) reasons.push('INDEPENDENT_PROBE_OWNER_MISMATCH');
    if (observation.independentProbeAtMs === null || observation.independentProbeEvidence.observedAtMs !== observation.independentProbeAtMs) reasons.push('INDEPENDENT_PROBE_TIME_BINDING_MISMATCH');
  }

  const hardFailure = counts.MISSING > 0
    || counts.SILENT > 0
    || counts.STALE > 0
    || schemaIncompatible.length > 0
    || controlStates.some((entry) => entry.reasonCodes.includes('REQUIRED_CONTROL_DISABLED')
      || entry.reasonCodes.includes('CONTROL_COMMAND_MISMATCH'))
    || reasons.some((reason) => reason === 'INDEPENDENT_PROBE_FAILED'
      || reason === 'COMPLETE_CORRELATION_TRACE_STALE'
      || reason === 'INDEPENDENT_PROBE_STALE'
      || reason === 'INDEPENDENT_PROBE_EVIDENCE_FAILED'
      || reason === 'INDEPENDENT_PROBE_OWNER_MISMATCH'
      || reason === 'INDEPENDENT_PROBE_TIME_BINDING_MISMATCH');
  const overallVerdict: AssuranceVerdict = hardFailure ? 'FAIL' : reasons.length > 0 ? 'UNKNOWN' : 'PASS';
  return Object.freeze({
    evaluatedAtMs: observation.observedAtMs,
    expectedCounts: Object.freeze({ components: manifest.components.length, dependencies: manifest.dependencies.length, controls: manifest.controls.length, telemetrySignals: manifest.telemetrySignals.length }),
    componentStates: Object.freeze(componentStates),
    dependencyStates: Object.freeze(dependencyStates),
    controlStates: Object.freeze(controlStates),
    telemetryStates: Object.freeze(telemetryStates),
    counts: Object.freeze({ ...counts }),
    observabilityCoveragePercentage: coveragePercentage,
    missingCapitalCriticalIds: missingCritical,
    unobservedCapitalCriticalDependencyIds: unobservedCriticalDependencies,
    schemaIncompatibleSignalIds: sortedUnique(schemaIncompatible),
    completeCorrelationTraceAtMs: observation.completeCorrelationTraceAtMs,
    independentProbeAtMs: observation.independentProbeAtMs,
    independentProbeVerdict: observation.independentProbeVerdict,
    overallVerdict,
    reasonCodes: sortedUnique(reasons),
  });
}

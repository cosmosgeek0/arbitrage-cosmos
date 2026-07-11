import {
  createStructuredFailure,
  fail,
  findSecretLikePaths,
  findSerializabilityIssues,
  isCompleteness,
  isDataAuthority,
  isDesiredRuntimeState,
  isFreshnessState,
  isPreflightGateStatus,
  isRunMode,
  isRuntimePhase,
  isStructuredFailure,
  isValidUtcMillis,
  ok,
  validateSourcedTimestamp,
  weakestAuthority,
  type ContractResult,
  type RuntimeStatusSnapshot,
} from '../../foundation/contracts/index.js';
import { RUNTIME_LIFECYCLE_STATES } from '../../intelligenceRuntime/contracts/index.js';
import {
  LIVE_EXECUTION_NOT_IMPLEMENTED,
  SYSTEM_COMPONENT_IDS,
  SYSTEM_CONTROL_COMMANDS,
  SYSTEM_OWNER_KINDS,
  SYSTEM_READINESS_STATES,
  SYSTEM_RELEASE_STATUSES,
  SYSTEM_SAFE_MODES,
  SYSTEM_TRUTH_LABELS,
  type SystemComponentId,
  type SystemTruthLabel,
} from '../contracts/constants.js';
import type {
  SystemComponentSnapshot,
  SystemControlState,
} from '../contracts/types.js';
import { validateSystemComponentSnapshot } from '../contracts/validation.js';
import { projectRootCauses } from './rootCause.js';
import {
  buildSystemTraceIndex,
  recentCorrelatedDecisions,
} from './traceIndex.js';
import {
  SYSTEM_COMPONENT_ORDER,
  SYSTEM_TOPOLOGY_NODES,
} from './topology.js';
import {
  isCanonicalComponentId,
  normalizeComponentTruth,
  strictSummaryTruthLabel,
} from './truth.js';
import type {
  SystemCapitalSummary,
  SystemExecutionSummary,
  SystemIntelligenceSummary,
  SystemLedgerSummary,
  SystemOverallPosture,
  SystemReconciliationSummary,
  SystemRiskSummary,
  SystemSourceCoverageSummary,
  SystemStrategyRuntimeSummary,
  SystemStrategySummary,
  SystemSupervisorProjectionInput,
  SystemSupervisorReadModel,
  SystemSupervisorSummaries,
} from './types.js';

const MAX_COUNT = 1_000_000_000;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,99}$/;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const VALIDATE_ONLY_COMPONENTS = new Set<SystemComponentId>([
  'multileg-risk',
  'execution-coordinator-validate-only',
  'reconciliation',
]);

function invalid(
  input: Pick<SystemSupervisorProjectionInput, 'nowMs' | 'correlationId'>,
  detail: string,
): ContractResult<never> {
  const occurredAt = isValidUtcMillis(input.nowMs) ? input.nowMs : 0;
  const correlationId = typeof input.correlationId === 'string' && input.correlationId.trim()
    ? input.correlationId.slice(0, 128)
    : 'UNCORRELATED';
  return fail(createStructuredFailure({
    component: 'systemIntegration.supervisor',
    stage: 'buildSystemSupervisorProjection',
    code: 'SUPERVISOR_INPUT_INVALID',
    message: detail.slice(0, 10_000),
    occurredAt,
    retryable: false,
    safeCurrentState: 'SNAPSHOT_NOT_BUILT',
    recommendedOperatorAction: 'Fix the named owner snapshot or adapter contract before publishing supervisor state.',
    correlationId,
  }));
}

function nonNegativeCount(name: string, value: number | null): void {
  if (value === null) return;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_COUNT) {
    throw new TypeError(`${name} must be null or a non-negative safe integer <= ${MAX_COUNT}`);
  }
}

function optionalTimestamp(name: string, value: number | null): void {
  if (value !== null && !isValidUtcMillis(value)) throw new TypeError(`${name} must be null or valid UTC ms`);
}

function boundedString(name: string, value: string, maximum = 256): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new TypeError(`${name} must be a non-empty string (<=${maximum} chars)`);
  }
}

function optionalString(name: string, value: string | null, maximum = 256): void {
  if (value !== null) boundedString(name, value, maximum);
}

function codes(name: string, values: readonly string[], maximum = 64): void {
  if (!Array.isArray(values) || values.length > maximum) throw new TypeError(`${name} exceeds ${maximum}`);
  if (new Set(values).size !== values.length) throw new TypeError(`${name} contains duplicates`);
  for (const value of values) {
    if (!CODE_PATTERN.test(value)) throw new TypeError(`${name} contains invalid code ${JSON.stringify(value)}`);
  }
}

function decimal(name: string, value: string | null): void {
  if (value !== null && (value.length > 80 || !DECIMAL_PATTERN.test(value))) {
    throw new TypeError(`${name} must be null or an exact decimal string`);
  }
}

function validateControl(control: SystemControlState): void {
  if (!Number.isSafeInteger(control.revision) || control.revision < 0) throw new TypeError('control.revision is invalid');
  if (!Number.isSafeInteger(control.generation) || control.generation < 0) throw new TypeError('control.generation is invalid');
  if (!(SYSTEM_SAFE_MODES as readonly string[]).includes(control.safeMode)) throw new TypeError('control.safeMode is invalid');
  if (typeof control.killSwitchEngaged !== 'boolean' || typeof control.intakePaused !== 'boolean') throw new TypeError('control booleans are invalid');
  if (!isValidUtcMillis(control.updatedAtMs)) throw new TypeError('control.updatedAtMs is invalid');
  boundedString('control.correlationId', control.correlationId, 128);
}

function validateRuntime(runtime: RuntimeStatusSnapshot): void {
  if (!Number.isSafeInteger(runtime.revision) || runtime.revision < 0) throw new TypeError('runtime.revision is invalid');
  if (!Number.isSafeInteger(runtime.generation) || runtime.generation < 0) throw new TypeError('runtime.generation is invalid');
  if (!isRunMode(runtime.runMode)) throw new TypeError('runtime.runMode is invalid');
  if (!isDesiredRuntimeState(runtime.desiredState) || !isRuntimePhase(runtime.phase)) throw new TypeError('runtime desired/phase is invalid');
  optionalString('runtime.commandCorrelationId', runtime.commandCorrelationId, 128);
  optionalTimestamp('runtime.startedAt', runtime.startedAt);
  optionalTimestamp('runtime.lastTransitionAt', runtime.lastTransitionAt);
  optionalTimestamp('runtime.heartbeatAt', runtime.heartbeatAt);
  optionalString('runtime.blockedAtGate', runtime.blockedAtGate, 200);
  if (!Array.isArray(runtime.components) || runtime.components.length > 100) throw new TypeError('runtime.components is unbounded');
  const seen = new Set<string>();
  for (const component of runtime.components) {
    boundedString('runtime.components.name', component.name, 200);
    if (seen.has(component.name)) throw new TypeError(`runtime component ${component.name} is duplicated`);
    seen.add(component.name);
    if (!isRuntimePhase(component.phase) || !isDataAuthority(component.authority)) throw new TypeError(`runtime component ${component.name} status is invalid`);
    if (typeof component.required !== 'boolean') throw new TypeError(`runtime component ${component.name}.required is invalid`);
    optionalTimestamp(`runtime component ${component.name}.heartbeatAt`, component.heartbeatAt);
    if (component.lastError !== null && !isStructuredFailure(component.lastError)) throw new TypeError(`runtime component ${component.name}.lastError is invalid`);
  }
  if (!Array.isArray(runtime.preflight) || runtime.preflight.length > 100) throw new TypeError('runtime.preflight is unbounded');
  const seenGates = new Set<string>();
  for (const gate of runtime.preflight) {
    boundedString('runtime.preflight.gate', gate.gate, 200);
    if (seenGates.has(gate.gate)) throw new TypeError(`runtime preflight gate ${gate.gate} is duplicated`);
    seenGates.add(gate.gate);
    if (!isPreflightGateStatus(gate.status)) throw new TypeError(`runtime preflight gate ${gate.gate}.status is invalid`);
    if (typeof gate.blocking !== 'boolean') throw new TypeError(`runtime preflight gate ${gate.gate}.blocking is invalid`);
    boundedString(`runtime preflight gate ${gate.gate}.detail`, gate.detail, 10_000);
    optionalTimestamp(`runtime preflight gate ${gate.gate}.checkedAt`, gate.checkedAt);
  }
  if (runtime.lastError !== null && !isStructuredFailure(runtime.lastError)) throw new TypeError('runtime.lastError is invalid');
}

function validateComponent(component: SystemComponentSnapshot): void {
  const contractIssues = validateSystemComponentSnapshot(component);
  if (contractIssues.length > 0) {
    throw new TypeError(`${component.componentId ?? 'component'} violates the integration contract: ${contractIssues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`);
  }
  if (!isCanonicalComponentId(component.componentId)) throw new TypeError(`unknown component ${String(component.componentId)}`);
  if (VALIDATE_ONLY_COMPONENTS.has(component.componentId)
      && (component.truthLabel === 'LIVE_PUBLIC' || component.releaseStatuses.includes('LIVE_PUBLIC'))) {
    throw new TypeError(`${component.componentId} cannot claim LIVE_PUBLIC in the convergence release`);
  }
  if (!(SYSTEM_OWNER_KINDS as readonly string[]).includes(component.owner)) throw new TypeError(`${component.componentId}.owner is invalid`);
  boundedString(`${component.componentId}.ownerPath`, component.ownerPath, 500);
  if (!Array.isArray(component.releaseStatuses) || component.releaseStatuses.length > SYSTEM_RELEASE_STATUSES.length) throw new TypeError(`${component.componentId}.releaseStatuses is unbounded`);
  if (component.releaseStatuses.some((status) => !(SYSTEM_RELEASE_STATUSES as readonly string[]).includes(status))) throw new TypeError(`${component.componentId}.releaseStatuses is invalid`);
  if (!(SYSTEM_TRUTH_LABELS as readonly string[]).includes(component.truthLabel)) throw new TypeError(`${component.componentId}.truthLabel is invalid`);
  if (!isDesiredRuntimeState(component.desiredState) || !isRuntimePhase(component.phase)) throw new TypeError(`${component.componentId}.runtime state is invalid`);
  if (!(SYSTEM_READINESS_STATES as readonly string[]).includes(component.readiness)) throw new TypeError(`${component.componentId}.readiness is invalid`);
  if (!isDataAuthority(component.authority) || !isCompleteness(component.completeness)) throw new TypeError(`${component.componentId}.truth metadata is invalid`);
  if (component.sourceLifecycle !== null && !(RUNTIME_LIFECYCLE_STATES as readonly string[]).includes(component.sourceLifecycle)) throw new TypeError(`${component.componentId}.sourceLifecycle is invalid`);
  if (component.sourceTimestamp !== null && validateSourcedTimestamp(component.sourceTimestamp).length > 0) throw new TypeError(`${component.componentId}.sourceTimestamp is invalid`);
  if (component.freshness) {
    const freshness = component.freshness;
    const validAge = freshness.ageMs === null || Number.isSafeInteger(freshness.ageMs);
    const validBasis = ['SOURCE_TIME', 'RECEIPT_TIME', 'NONE'].includes(freshness.basis);
    if (!isFreshnessState(freshness.state) || !validAge || !validBasis
        || !isDataAuthority(freshness.effectiveAuthority) || !isValidUtcMillis(freshness.evaluatedAt)) {
      throw new TypeError(`${component.componentId}.freshness is invalid`);
    }
    if (freshness.state === 'UNAVAILABLE') {
      if (freshness.ageMs !== null || freshness.basis !== 'NONE' || freshness.effectiveAuthority !== 'UNAVAILABLE') {
        throw new TypeError(`${component.componentId}.freshness unavailable shape is invalid`);
      }
    } else if (freshness.ageMs === null || freshness.basis === 'NONE') {
      throw new TypeError(`${component.componentId}.freshness usable shape is invalid`);
    } else if (freshness.state !== 'FRESH' && freshness.effectiveAuthority !== 'UNAVAILABLE') {
      throw new TypeError(`${component.componentId}.freshness violates the downgrade law`);
    }
  }
  optionalTimestamp(`${component.componentId}.lastReceiveAtMs`, component.lastReceiveAtMs);
  optionalTimestamp(`${component.componentId}.lastProcessAtMs`, component.lastProcessAtMs);
  optionalTimestamp(`${component.componentId}.lastSuccessAtMs`, component.lastSuccessAtMs);
  if (!Number.isSafeInteger(component.generation) || component.generation < 0) throw new TypeError(`${component.componentId}.generation is invalid`);
  if (!Number.isSafeInteger(component.restartCount) || component.restartCount < 0) throw new TypeError(`${component.componentId}.restartCount is invalid`);
  if (component.dependencies.length > SYSTEM_COMPONENT_IDS.length || component.dependencies.some((dependency) => !isCanonicalComponentId(dependency))) throw new TypeError(`${component.componentId}.dependencies is invalid`);
  if (component.queue) {
    const queueKeys = Object.keys(component.queue).sort();
    const expectedQueueKeys = ['capacity', 'coalesced', 'depth', 'dropped', 'observedAtMs'];
    if (queueKeys.length !== expectedQueueKeys.length || queueKeys.some((key, index) => key !== expectedQueueKeys[index])) {
      throw new TypeError(`${component.componentId}.queue shape is invalid`);
    }
    for (const [key, value] of Object.entries(component.queue)) {
      if (key === 'observedAtMs') continue;
      if (value === null) throw new TypeError(`${component.componentId}.queue.${key} is invalid`);
      nonNegativeCount(`${component.componentId}.queue.${key}`, value);
    }
    if (component.queue.capacity < 1 || component.queue.depth > component.queue.capacity) throw new TypeError(`${component.componentId}.queue bounds are invalid`);
    if (!isValidUtcMillis(component.queue.observedAtMs)) throw new TypeError(`${component.componentId}.queue.observedAtMs is invalid`);
  }
  if (component.lastFailure !== null && !isStructuredFailure(component.lastFailure)) throw new TypeError(`${component.componentId}.lastFailure is invalid`);
  codes(`${component.componentId}.blockerCodes`, component.blockerCodes);
  if (component.supportedControls.length > SYSTEM_CONTROL_COMMANDS.length || component.supportedControls.some((command) => !(SYSTEM_CONTROL_COMMANDS as readonly string[]).includes(command))) {
    throw new TypeError(`${component.componentId}.supportedControls is invalid`);
  }
  if (typeof component.capitalExposed !== 'boolean' || typeof component.operatorAttentionRequired !== 'boolean') throw new TypeError(`${component.componentId}.attention flags are invalid`);
}

function validateStrategy(name: string, summary: SystemStrategyRuntimeSummary): void {
  if (!(SYSTEM_TRUTH_LABELS as readonly string[]).includes(summary.truthLabel)) throw new TypeError(`${name}.truthLabel is invalid`);
  optionalTimestamp(`${name}.heartbeatAtMs`, summary.heartbeatAtMs);
  optionalTimestamp(`${name}.lastDecisionAtMs`, summary.lastDecisionAtMs);
  nonNegativeCount(`${name}.candidateCount`, summary.candidateCount);
  nonNegativeCount(`${name}.proposalCount`, summary.proposalCount);
  nonNegativeCount(`${name}.rejectionCount`, summary.rejectionCount);
  nonNegativeCount(`${name}.acceptedCount`, summary.acceptedCount);
  optionalString(`${name}.sourceRevision`, summary.sourceRevision, 256);
}

function validateSummaries(summaries: SystemSupervisorSummaries): void {
  for (const [name, label] of [
    ['sourceCoverage', summaries.sourceCoverage.truthLabel],
    ['intelligence', summaries.intelligence.truthLabel],
    ['capital', summaries.capital.truthLabel],
    ['risk', summaries.risk.truthLabel],
    ['execution', summaries.execution.truthLabel],
    ['reconciliation', summaries.reconciliation.truthLabel],
    ['ledger', summaries.ledger.truthLabel],
  ] as const) {
    if (!(SYSTEM_TRUTH_LABELS as readonly string[]).includes(label)) throw new TypeError(`${name}.truthLabel is invalid`);
  }
  if (summaries.risk.truthLabel === 'LIVE_PUBLIC'
      || summaries.execution.truthLabel === 'LIVE_PUBLIC'
      || summaries.reconciliation.truthLabel === 'LIVE_PUBLIC') {
    throw new TypeError('validate-only risk, execution, and reconciliation summaries cannot claim LIVE_PUBLIC');
  }
  const source = summaries.sourceCoverage;
  for (const [name, value] of Object.entries(source)) {
    if (name === 'truthLabel' || name === 'lastMaterialGapAtMs') continue;
    nonNegativeCount(`sourceCoverage.${name}`, value as number | null);
  }
  optionalTimestamp('sourceCoverage.lastMaterialGapAtMs', source.lastMaterialGapAtMs);
  validateStrategy('strategies.basis', summaries.strategies.basis);
  validateStrategy('strategies.volume', summaries.strategies.volume);

  const intelligence = summaries.intelligence;
  optionalTimestamp('intelligence.lastUpdateAtMs', intelligence.lastUpdateAtMs);
  for (const [name, value] of Object.entries(intelligence)) {
    if (name === 'truthLabel' || name === 'lastUpdateAtMs') continue;
    nonNegativeCount(`intelligence.${name}`, value as number | null);
  }

  const capital = summaries.capital;
  boundedString('capital.accountTruthState', capital.accountTruthState, 120);
  decimal('capital.allocatableAmount', capital.allocatableAmount);
  decimal('capital.reservedAmount', capital.reservedAmount);
  decimal('capital.activeExposureAmount', capital.activeExposureAmount);
  nonNegativeCount('capital.eligibleCount', capital.eligibleCount);
  nonNegativeCount('capital.reservationCount', capital.reservationCount);
  nonNegativeCount('capital.stagedMandateCount', capital.stagedMandateCount);
  nonNegativeCount('capital.activeExposureCount', capital.activeExposureCount);
  optionalString('capital.checkpointRevision', capital.checkpointRevision, 256);
  codes('capital.blockerCodes', capital.blockerCodes);

  const risk = summaries.risk;
  if (!['APPROVE', 'REJECT', 'CAP', 'UNAVAILABLE'].includes(risk.latestVerdict)) throw new TypeError('risk.latestVerdict is invalid');
  optionalTimestamp('risk.latestVerdictAtMs', risk.latestVerdictAtMs);
  optionalString('risk.latestVerdictId', risk.latestVerdictId, 256);
  nonNegativeCount('risk.rejectionCount', risk.rejectionCount);
  codes('risk.reasonCodes', risk.reasonCodes);

  const execution = summaries.execution;
  if (!['VALIDATE_ONLY', 'UNAVAILABLE'].includes(execution.mode)) throw new TypeError('execution.mode is invalid');
  if (execution.barrier !== LIVE_EXECUTION_NOT_IMPLEMENTED) throw new TypeError('execution live barrier is absent');
  optionalString('execution.planId', execution.planId, 256);
  optionalString('execution.planLifecycle', execution.planLifecycle, 120);
  boundedString('execution.coordinatorState', execution.coordinatorState, 120);
  nonNegativeCount('execution.legCount', execution.legCount);
  optionalString('execution.recoveryState', execution.recoveryState, 120);
  optionalTimestamp('execution.lastTransitionAtMs', execution.lastTransitionAtMs);

  const reconciliation = summaries.reconciliation;
  boundedString('reconciliation.status', reconciliation.status, 120);
  if (typeof reconciliation.blocksNewExposure !== 'boolean') throw new TypeError('reconciliation.blocksNewExposure is invalid');
  optionalString('reconciliation.recommendation', reconciliation.recommendation, 200);
  optionalString('reconciliation.checkpointId', reconciliation.checkpointId, 256);
  optionalTimestamp('reconciliation.evaluatedAtMs', reconciliation.evaluatedAtMs);
  codes('reconciliation.reasonCodes', reconciliation.reasonCodes);

  const ledger = summaries.ledger;
  if (ledger.writable !== null && typeof ledger.writable !== 'boolean') throw new TypeError('ledger.writable is invalid');
  optionalString('ledger.lastEventId', ledger.lastEventId, 256);
  optionalTimestamp('ledger.lastPersistedAtMs', ledger.lastPersistedAtMs);
  optionalString('ledger.checkpointRevision', ledger.checkpointRevision, 256);
  nonNegativeCount('ledger.recentTraceCount', ledger.recentTraceCount);
  optionalTimestamp('ledger.lastCleanShutdownAtMs', ledger.lastCleanShutdownAtMs);
}

function phaseReadiness(runtimePhase: SystemComponentSnapshot['phase'], current: SystemComponentSnapshot['readiness']): SystemComponentSnapshot['readiness'] {
  if (runtimePhase === 'FAILED') return 'FAILED';
  if (runtimePhase === 'BLOCKED') return 'BLOCKED';
  if (runtimePhase === 'DEGRADED' && current === 'READY') return 'DEGRADED';
  if ((runtimePhase === 'VALIDATING' || runtimePhase === 'STARTING') && current === 'READY') return 'WARMING';
  if (runtimePhase === 'STOPPED') return 'STOPPED';
  return current;
}

function mergeFoundationStatus(
  source: SystemComponentSnapshot,
  runtime: RuntimeStatusSnapshot,
): SystemComponentSnapshot {
  const runtimeComponent = runtime.components.find((component) => component.name === source.componentId);
  const isSupervisor = source.componentId === 'engine-supervisor';
  const phase = isSupervisor ? runtime.phase : runtimeComponent?.phase ?? source.phase;
  const desiredState = isSupervisor ? runtime.desiredState : source.desiredState;
  const lastFailure = isSupervisor ? runtime.lastError ?? source.lastFailure : source.lastFailure ?? runtimeComponent?.lastError ?? null;
  const authority = runtimeComponent
    ? weakestAuthority(source.authority, runtimeComponent.authority)
    : source.authority;
  return {
    ...source,
    desiredState,
    phase,
    domainObservedState: isSupervisor ? runtime.phase : source.domainObservedState,
    readiness: phaseReadiness(phase, source.readiness),
    authority,
    lastFailure,
    generation: isSupervisor ? runtime.generation : source.generation,
  };
}

function cloneStrategy(summary: SystemStrategyRuntimeSummary, truthLabel: SystemTruthLabel): Readonly<SystemStrategyRuntimeSummary> {
  return Object.freeze({ ...summary, truthLabel });
}

function normalizeSummaries(
  input: SystemSupervisorSummaries,
  components: ReadonlyMap<SystemComponentId, Readonly<SystemComponentSnapshot>>,
): Readonly<SystemSupervisorSummaries> {
  const truth = (claimed: SystemTruthLabel, supporting: readonly SystemComponentId[]) => strictSummaryTruthLabel(claimed, supporting, components);
  const sourceCoverage: SystemSourceCoverageSummary = Object.freeze({
    ...input.sourceCoverage,
    truthLabel: truth(input.sourceCoverage.truthLabel, ['public-spot-source', 'public-usdm-source', 'market-universe']),
  });
  const strategies: SystemStrategySummary = Object.freeze({
    basis: cloneStrategy(input.strategies.basis, truth(input.strategies.basis.truthLabel, ['basis-engine'])),
    volume: cloneStrategy(input.strategies.volume, truth(input.strategies.volume.truthLabel, ['volume-engine'])),
  });
  const intelligence: SystemIntelligenceSummary = Object.freeze({
    ...input.intelligence,
    truthLabel: truth(input.intelligence.truthLabel, ['intelligence-runtime', 'market-intelligence']),
  });
  const capital: SystemCapitalSummary = Object.freeze({
    ...input.capital,
    truthLabel: truth(input.capital.truthLabel, ['capital-supervision']),
    blockerCodes: Object.freeze([...input.capital.blockerCodes]),
  });
  const risk: SystemRiskSummary = Object.freeze({
    ...input.risk,
    truthLabel: truth(input.risk.truthLabel, ['multileg-risk']),
    reasonCodes: Object.freeze([...input.risk.reasonCodes]),
  });
  const executionComponent = components.get('execution-coordinator-validate-only');
  const executionTruth: SystemTruthLabel = input.execution.truthLabel === 'UNAVAILABLE'
    ? 'UNAVAILABLE'
    : input.execution.truthLabel === 'UNKNOWN'
      ? 'UNKNOWN'
      : executionComponent?.truthLabel === 'DRY_RUN'
        ? 'DRY_RUN'
        : executionComponent?.truthLabel === 'RECORDED_REPLAY'
          ? 'RECORDED_REPLAY'
          : executionComponent?.truthLabel === 'UNAVAILABLE'
            ? 'UNAVAILABLE'
            : 'UNKNOWN';
  const execution: SystemExecutionSummary = Object.freeze({ ...input.execution, truthLabel: executionTruth });
  const reconciliationComponent = components.get('reconciliation');
  const reconciliationTruth: SystemTruthLabel = input.reconciliation.truthLabel === 'UNAVAILABLE'
    ? 'UNAVAILABLE'
    : input.reconciliation.truthLabel === 'UNKNOWN'
      ? 'UNKNOWN'
      : reconciliationComponent?.truthLabel === 'DRY_RUN'
        ? 'DRY_RUN'
        : reconciliationComponent?.truthLabel === 'RECORDED_REPLAY'
          ? 'RECORDED_REPLAY'
          : reconciliationComponent?.truthLabel === 'UNAVAILABLE'
            ? 'UNAVAILABLE'
            : 'UNKNOWN';
  const reconciliation: SystemReconciliationSummary = Object.freeze({
    ...input.reconciliation,
    truthLabel: reconciliationTruth,
    reasonCodes: Object.freeze([...input.reconciliation.reasonCodes]),
  });
  const ledger: SystemLedgerSummary = Object.freeze({
    ...input.ledger,
    truthLabel: truth(input.ledger.truthLabel, ['ledger-persistence']),
  });
  return Object.freeze({ sourceCoverage, strategies, intelligence, capital, risk, execution, reconciliation, ledger });
}

function deriveOverallPosture(
  runtime: RuntimeStatusSnapshot,
  components: readonly Readonly<SystemComponentSnapshot>[],
): SystemOverallPosture {
  if (runtime.desiredState === 'STOPPED' && runtime.phase === 'STOPPED') return 'STOPPED';
  const shell = components.filter((component) => SYSTEM_TOPOLOGY_NODES.find((node) => node.componentId === component.componentId)?.shellCritical);
  if (runtime.phase === 'FAILED' || shell.some((component) => component.readiness === 'FAILED')) return 'FAILED';
  if (runtime.phase === 'BLOCKED' || shell.some((component) => component.readiness === 'BLOCKED')) return 'BLOCKED';
  if (runtime.phase === 'VALIDATING' || runtime.phase === 'STARTING' || components.some((component) => component.readiness === 'WARMING')) return 'WARMING';
  if (components.every((component) => component.readiness === 'READY')) return 'READY';
  return 'DEGRADED';
}

function deriveOverallTruthLabel(
  components: readonly Readonly<SystemComponentSnapshot>[],
): SystemTruthLabel {
  const labels = components.map((component) => component.truthLabel);
  if (labels.every((label) => label === 'UNAVAILABLE')) return 'UNAVAILABLE';
  if (labels.some((label) => label === 'DRY_RUN')) return 'DRY_RUN';
  if (labels.some((label) => label === 'SYNTHETIC_ONLY')) return 'SYNTHETIC_ONLY';
  if (labels.every((label) => label === 'LIVE_PUBLIC')) return 'LIVE_PUBLIC';
  if (labels.some((label) => label === 'RECORDED_REPLAY')) return 'RECORDED_REPLAY';
  return 'UNKNOWN';
}

export function buildSystemSupervisorProjection(
  input: Readonly<SystemSupervisorProjectionInput>,
): ContractResult<Readonly<SystemSupervisorReadModel>> {
  try {
    if (!isValidUtcMillis(input.nowMs)) throw new TypeError('nowMs is invalid');
    boundedString('correlationId', input.correlationId, 128);
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new TypeError('revision is invalid');
    validateRuntime(input.runtime);
    validateControl(input.control);
    if (!Array.isArray(input.components) || input.components.length !== SYSTEM_COMPONENT_IDS.length) {
      throw new TypeError(`components must contain exactly ${SYSTEM_COMPONENT_IDS.length} canonical snapshots`);
    }
    const sourceComponentMap = new Map<SystemComponentId, Readonly<SystemComponentSnapshot>>();
    for (const component of input.components) {
      validateComponent(component);
      if (sourceComponentMap.has(component.componentId)) throw new TypeError(`component ${component.componentId} is duplicated`);
      sourceComponentMap.set(component.componentId, component);
    }
    for (const componentId of SYSTEM_COMPONENT_IDS) {
      if (!sourceComponentMap.has(componentId)) throw new TypeError(`component ${componentId} is missing`);
    }
    validateSummaries(input.summaries);
    const serializability = findSerializabilityIssues(input);
    if (serializability.length > 0) throw new TypeError(`input is not serializable at ${serializability.map((issue) => issue.path).join(', ')}`);
    const secretPaths = findSecretLikePaths(input);
    if (secretPaths.length > 0) throw new TypeError(`secret-like fields rejected at ${secretPaths.join(', ')}`);

    const components = SYSTEM_COMPONENT_IDS.map((componentId) => {
      const source = sourceComponentMap.get(componentId) as Readonly<SystemComponentSnapshot>;
      const normalized = normalizeComponentTruth(mergeFoundationStatus(source, input.runtime), input.nowMs);
      const outputIssues = validateSystemComponentSnapshot(normalized);
      if (outputIssues.length > 0) {
        throw new TypeError(`${componentId} projection violates the integration contract: ${outputIssues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`);
      }
      return normalized;
    }).sort((left, right) => SYSTEM_COMPONENT_ORDER[left.componentId] - SYSTEM_COMPONENT_ORDER[right.componentId]);
    const componentMap = new Map(components.map((component) => [component.componentId, component]));
    const rootProjection = projectRootCauses(components);
    const traceIndex = buildSystemTraceIndex(input.traceEvents, input.nowMs);
    const summaries = normalizeSummaries(input.summaries, componentMap);
    const control = Object.freeze({ ...input.control });
    const result: SystemSupervisorReadModel = Object.freeze({
      schemaVersion: 1 as const,
      revision: input.revision,
      evaluatedAtMs: input.nowMs,
      phase: input.runtime.phase,
      control,
      truthLabel: deriveOverallTruthLabel(components),
      components: Object.freeze(components),
      edges: rootProjection.edges,
      rootBlockerComponentIds: Object.freeze(rootProjection.rootCauses.map((cause) => cause.componentId)),
      operatorAttentionComponentIds: Object.freeze([...new Set(rootProjection.attentionQueue.map((item) => item.componentId))]),
      overallPosture: deriveOverallPosture(input.runtime, components),
      runtimeGeneration: input.runtime.generation,
      controlGeneration: input.control.generation,
      firstRootBlockerComponentId: rootProjection.firstRootBlockerComponentId,
      rootCauses: rootProjection.rootCauses,
      attentionQueue: rootProjection.attentionQueue,
      summaries,
      traceIndex,
      recentCorrelatedDecisions: recentCorrelatedDecisions(traceIndex),
    });
    return ok(result);
  } catch (error) {
    return invalid(input, error instanceof Error ? error.message : 'unknown supervisor projection failure');
  }
}

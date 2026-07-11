/**
 * Lane A — deterministic engine control-plane supervisor.
 *
 * This module is deliberately dormant. It owns only runtime intent and
 * observed component lifecycle state. All effects are performed through
 * injected, synchronous poll-style ports; elapsed time advances only when a
 * caller supplies `nowMs` to `issue()` or `tick()`.
 *
 * Future wiring seam: adapt each existing engine/service to ManagedComponent,
 * construct one supervisor in the runtime composition root, persist snapshots
 * and failure evidence in the existing ledger, and drive ticks from the
 * existing runtime scheduler. Nothing here registers routes or starts timers.
 */
import {
  canTransitionPhase,
  checkRunModePermitted,
  createStructuredFailure,
  deriveCommandId,
  deriveCorrelationId,
  evaluateFreshness,
  fail,
  isControlCommand,
  isRunMode,
  isStructuredFailure,
  isValidUtcMillis,
  ok,
  validateSourcedTimestamp,
  type ComponentStatusSnapshot,
  type DataAuthority,
  type DesiredRuntimeState,
  type PreflightGateResult,
  type RuntimePhase,
  type RuntimeStatusSnapshot,
  type StructuredFailure,
} from '../contracts/index.js';
import { computeExclusions, computeStartOrder } from './plan.js';
import {
  BUILTIN_GATE_NAMES,
  CONTROL_FAILURE_CODES,
  type CommandReceipt,
  type CommandResult,
  type ComponentProbe,
  type ComponentStepContext,
  type ComponentStepOutcome,
  type ControlCommandRequest,
  type ControlEnvironment,
  type FailureEvidence,
  type ManagedComponent,
  type PhaseTransitionRecord,
  type PreflightGate,
  type PreflightGateContext,
  type PreflightGateOutcome,
  type SupervisorConfig,
  type SupervisorDeps,
} from './types.js';

interface MutableComponentStatus {
  name: string;
  phase: RuntimePhase;
  required: boolean;
  authority: DataAuthority;
  heartbeatAt: number | null;
  lastError: StructuredFailure | null;
}

type OperationStage = 'PREFLIGHT' | 'VALIDATE_COMPONENTS' | 'START_COMPONENTS' | 'STOP_COMPONENTS';
type StopPurpose = 'STOP' | 'PAUSE' | 'RESTART' | 'ROLLBACK';

interface GateDescriptor {
  gate: string;
  blocking: boolean;
  borrowDependent: boolean;
  timeoutMs: number;
  run(ctx: PreflightGateContext): PreflightGateOutcome;
}

interface ActiveOperation {
  command: ControlCommandRequest['command'];
  correlationId: string;
  stage: OperationStage;
  environment: ControlEnvironment | null;
  exclusions: Map<string, string>;
  gateChain: GateDescriptor[];
  order: string[];
  index: number;
  deadlineAt: number | null;
  startAfterValidation: boolean;
  stopPurpose: StopPurpose | null;
  primaryFailure: StructuredFailure | null;
  stopFailure: StructuredFailure | null;
}

type EnvironmentReadResult =
  | { readonly ok: true; readonly value: ControlEnvironment }
  | { readonly ok: false; readonly code: string; readonly message: string };

function positiveSafeInteger(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function nonEmptyLabel(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200) {
    throw new TypeError(`${name} must be a non-empty string (<=200 chars)`);
  }
  return value;
}

function freezeReceipt(receipt: CommandReceipt): Readonly<CommandReceipt> {
  return Object.freeze({ ...receipt });
}

/** Stateful, deterministic supervisor. No implicit singleton is created. */
export class DeterministicSupervisor {
  private readonly config: Readonly<SupervisorConfig>;
  private readonly deps: SupervisorDeps;
  private readonly startOrder: readonly string[];
  private readonly componentByName: ReadonlyMap<string, ManagedComponent>;
  private readonly componentStatus = new Map<string, MutableComponentStatus>();

  private revision = 0;
  private hasAcceptedRevision = false;
  private generation = 0;
  private desiredState: DesiredRuntimeState = 'STOPPED';
  private phase: RuntimePhase = 'STOPPED';
  private commandCorrelationId: string | null = null;
  private startedAt: number | null = null;
  private lastTransitionAt: number | null = null;
  private heartbeatAt: number | null = null;
  private blockedAtGate: string | null = null;
  private lastObservedNowMs: number | null = null;
  private preflightResults: PreflightGateResult[] = [];
  private lastError: StructuredFailure | null = null;
  private lastAccepted: { command: ControlCommandRequest['command']; revision: number; receipt: Readonly<CommandReceipt> } | null = null;
  private active: ActiveOperation | null = null;
  private exclusions = new Map<string, string>();
  /** Exclusions fixed for this generation; a restart is required to admit them. */
  private startupExclusions = new Map<string, string>();
  /** Components stopped after a runtime prerequisite disappeared. */
  private readonly safetyStoppedNames = new Set<string>();
  private readonly prerequisiteStopDeadlines = new Map<string, number>();
  private readonly startedNames = new Set<string>();
  private readonly failures: FailureEvidence[] = [];
  private readonly transitions: PhaseTransitionRecord[] = [];

  constructor(config: SupervisorConfig, deps: SupervisorDeps) {
    const scope = nonEmptyLabel('SupervisorConfig.scope', config?.scope);
    if (!isRunMode(config?.runMode)) throw new TypeError('SupervisorConfig.runMode must be a RunMode');
    const defaultGateTimeoutMs = positiveSafeInteger(
      'SupervisorConfig.defaultGateTimeoutMs',
      config?.defaultGateTimeoutMs,
    );
    const defaultComponentTimeoutMs = positiveSafeInteger(
      'SupervisorConfig.defaultComponentTimeoutMs',
      config?.defaultComponentTimeoutMs,
    );
    if (!deps || !Array.isArray(deps.components) || deps.components.length === 0) {
      throw new TypeError('SupervisorDeps.components must contain at least one ManagedComponent');
    }
    if (!Array.isArray(deps.gates)) throw new TypeError('SupervisorDeps.gates must be an array');
    if (typeof deps.readEnvironment !== 'function') {
      throw new TypeError('SupervisorDeps.readEnvironment must be a function');
    }

    const components = Object.freeze([...deps.components]);
    const gates = Object.freeze([...deps.gates]);
    this.config = Object.freeze({ scope, runMode: config.runMode, defaultGateTimeoutMs, defaultComponentTimeoutMs });
    this.deps = Object.freeze({ components, gates, readEnvironment: deps.readEnvironment });
    this.startOrder = Object.freeze(computeStartOrder(components));
    this.componentByName = new Map(components.map((component) => [component.name, component] as const));

    for (const component of deps.components) {
      if (component.stepTimeoutMs !== undefined) {
        positiveSafeInteger(`ManagedComponent(${component.name}).stepTimeoutMs`, component.stepTimeoutMs);
      }
      if (component.requiresPrivateKeys !== undefined && typeof component.requiresPrivateKeys !== 'boolean') {
        throw new TypeError(`ManagedComponent(${component.name}).requiresPrivateKeys must be boolean`);
      }
      if (component.requiresBorrowTruth !== undefined && typeof component.requiresBorrowTruth !== 'boolean') {
        throw new TypeError(`ManagedComponent(${component.name}).requiresBorrowTruth must be boolean`);
      }
      if (component.riskIncreasing !== undefined && typeof component.riskIncreasing !== 'boolean') {
        throw new TypeError(`ManagedComponent(${component.name}).riskIncreasing must be boolean`);
      }
      this.componentStatus.set(component.name, {
        name: component.name,
        phase: 'STOPPED',
        required: component.required,
        authority: 'UNAVAILABLE',
        heartbeatAt: null,
        lastError: null,
      });
    }

    const gateNames = new Set<string>();
    for (const gate of deps.gates) {
      nonEmptyLabel('PreflightGate.gate', gate?.gate);
      if ((BUILTIN_GATE_NAMES as readonly string[]).includes(gate.gate)) {
        throw new TypeError(`PreflightGate '${gate.gate}' collides with a reserved built-in gate`);
      }
      if (gateNames.has(gate.gate)) throw new TypeError(`duplicate PreflightGate '${gate.gate}'`);
      gateNames.add(gate.gate);
      if (typeof gate.blocking !== 'boolean') {
        throw new TypeError(`PreflightGate(${gate.gate}).blocking must be boolean`);
      }
      if (gate.borrowDependent !== undefined && typeof gate.borrowDependent !== 'boolean') {
        throw new TypeError(`PreflightGate(${gate.gate}).borrowDependent must be boolean`);
      }
      if (gate.timeoutMs !== undefined) positiveSafeInteger(`PreflightGate(${gate.gate}).timeoutMs`, gate.timeoutMs);
      if (typeof gate.run !== 'function') throw new TypeError(`PreflightGate(${gate.gate}).run must be a function`);
    }
  }

  /**
   * Submit one revisioned command. A repeated current revision/verb receives
   * the same receipt. Older revisions, revision reuse with different intent,
   * and concurrent new commands fail as structured values.
   */
  issue(request: ControlCommandRequest): CommandResult {
    this.validateRequest(request);
    this.assertMonotonicNow(request.nowMs);
    const commandId = deriveCommandId({ command: request.command, scope: this.config.scope, revision: request.revision });
    const correlationId = deriveCorrelationId({ origin: 'command', key: commandId });

    if (this.hasAcceptedRevision && request.revision < this.revision) {
      return fail(this.failure(
        CONTROL_FAILURE_CODES.STALE_COMMAND_REVISION,
        'command:revision',
        `command revision ${request.revision} is stale; current revision is ${this.revision}`,
        request.nowMs,
        correlationId,
        false,
        'Issue a command with a revision greater than the current revision.',
      ));
    }
    if (this.hasAcceptedRevision && request.revision === this.revision) {
      if (this.lastAccepted?.command === request.command && this.lastAccepted.revision === request.revision) {
        return ok(this.lastAccepted.receipt);
      }
      return fail(this.failure(
        CONTROL_FAILURE_CODES.COMMAND_REVISION_REUSED,
        'command:revision',
        `revision ${request.revision} was already accepted for ${this.lastAccepted?.command ?? 'another command'}`,
        request.nowMs,
        correlationId,
        false,
        'Use a new monotonic revision for different command intent.',
      ));
    }
    if (this.active !== null) {
      return fail(this.failure(
        CONTROL_FAILURE_CODES.COMMAND_IN_PROGRESS,
        'command:concurrency',
        `${this.active.command} is still in progress at revision ${this.revision}`,
        request.nowMs,
        correlationId,
        true,
        'Wait for the active command to finish, then retry with the same new revision.',
      ));
    }

    const applicabilityFailure = this.commandApplicabilityFailure(request, correlationId);
    if (applicabilityFailure !== null) return fail(applicabilityFailure);

    const noop = this.isIdempotentNoop(request.command);
    const receipt = freezeReceipt({
      commandId,
      correlationId,
      command: request.command,
      revision: request.revision,
      applied: !noop,
      detail: noop ? `${request.command} already satisfied by observed state ${this.phase}` : `${request.command} accepted`,
    });
    this.acceptRevision(request, receipt);
    if (noop) {
      this.applyDesiredState(request.command);
      return ok(receipt);
    }

    this.commitObservedNow(request.nowMs);
    this.applyDesiredState(request.command);
    const operation: ActiveOperation = {
      command: request.command,
      correlationId,
      stage: 'PREFLIGHT',
      environment: null,
      exclusions: new Map(),
      gateChain: [],
      order: [],
      index: 0,
      deadlineAt: null,
      startAfterValidation: request.command !== 'VALIDATE',
      stopPurpose: null,
      primaryFailure: null,
      stopFailure: null,
    };
    this.active = operation;
    this.commandCorrelationId = correlationId;

    if (request.command === 'STOP') {
      this.beginStop(operation, 'STOP', request.nowMs);
    } else if (request.command === 'PAUSE') {
      this.beginStop(operation, 'PAUSE', request.nowMs);
    } else if (request.command === 'RESTART' || request.command === 'RESUME') {
      if (this.phase === 'STOPPED' && this.startedNames.size === 0) {
        this.beginStartup(operation, true, request.nowMs);
      } else {
        this.beginStop(operation, 'RESTART', request.nowMs);
      }
    } else {
      this.beginStartup(operation, request.command === 'START', request.nowMs);
    }
    return ok(receipt);
  }

  /** Advance pending gates/components and, when idle and running, probe health. */
  tick(nowMs: number): Readonly<RuntimeStatusSnapshot> {
    if (!isValidUtcMillis(nowMs)) {
      throw new TypeError('DeterministicSupervisor.tick: nowMs must be valid UTC ms from an injected clock');
    }
    this.assertMonotonicNow(nowMs);
    this.commitObservedNow(nowMs);
    if (this.active !== null) {
      this.advance(this.active, nowMs);
    } else if (this.phase === 'RUNNING' || this.phase === 'DEGRADED') {
      const correlationId = deriveCorrelationId({
        origin: 'control-health',
        key: `${this.config.scope}:${this.revision}:${this.generation}`,
      });
      this.refreshHealth(nowMs, correlationId);
    }
    return this.snapshot();
  }

  snapshot(): Readonly<RuntimeStatusSnapshot> {
    const components: ComponentStatusSnapshot[] = this.startOrder.map((name) => {
      const status = this.componentStatus.get(name) as MutableComponentStatus;
      return Object.freeze({ ...status });
    });
    const preflight = this.preflightResults.map((result) => Object.freeze({ ...result }));
    return Object.freeze({
      revision: this.revision,
      generation: this.generation,
      runMode: this.config.runMode,
      desiredState: this.desiredState,
      phase: this.phase,
      commandCorrelationId: this.commandCorrelationId,
      startedAt: this.startedAt,
      lastTransitionAt: this.lastTransitionAt,
      heartbeatAt: this.heartbeatAt,
      blockedAtGate: this.blockedAtGate,
      components: Object.freeze(components),
      preflight: Object.freeze(preflight),
      lastError: this.lastError,
    });
  }

  /** Append-only evidence survives successful restart and recovery. */
  failureHistory(): readonly Readonly<FailureEvidence>[] {
    return Object.freeze(this.failures.map((entry) => Object.freeze({ ...entry })));
  }

  transitionHistory(): readonly Readonly<PhaseTransitionRecord>[] {
    return Object.freeze(this.transitions.map((entry) => Object.freeze({ ...entry })));
  }

  excludedComponents(): ReadonlyMap<string, string> {
    return new Map(this.exclusions);
  }

  startedComponents(): readonly string[] {
    return Object.freeze(this.startOrder.filter((name) => this.startedNames.has(name)));
  }

  private validateRequest(request: ControlCommandRequest): void {
    if (typeof request !== 'object' || request === null) {
      throw new TypeError('ControlCommandRequest must be an object');
    }
    if (!isControlCommand(request.command)) throw new TypeError('ControlCommandRequest.command must be a ControlCommand');
    if (!Number.isSafeInteger(request.revision) || request.revision < 0) {
      throw new TypeError('ControlCommandRequest.revision must be a non-negative safe integer');
    }
    if (!isValidUtcMillis(request.nowMs)) {
      throw new TypeError('ControlCommandRequest.nowMs must be valid UTC ms from an injected clock');
    }
  }

  private assertMonotonicNow(nowMs: number): void {
    if (this.lastObservedNowMs !== null && nowMs < this.lastObservedNowMs) {
      throw new TypeError(
        `DeterministicSupervisor: injected nowMs regressed from ${this.lastObservedNowMs} to ${nowMs}`,
      );
    }
  }

  private commitObservedNow(nowMs: number): void {
    this.lastObservedNowMs = nowMs;
  }

  private acceptRevision(request: ControlCommandRequest, receipt: Readonly<CommandReceipt>): void {
    this.revision = request.revision;
    this.hasAcceptedRevision = true;
    this.lastAccepted = { command: request.command, revision: request.revision, receipt };
  }

  private applyDesiredState(command: ControlCommandRequest['command']): void {
    if (command === 'START' || command === 'RESUME' || command === 'RESTART') this.desiredState = 'RUNNING';
    if (command === 'STOP') this.desiredState = 'STOPPED';
    if (command === 'PAUSE') this.desiredState = 'PAUSED';
  }

  private isIdempotentNoop(command: ControlCommandRequest['command']): boolean {
    if (command === 'START') return (this.phase === 'RUNNING' || this.phase === 'DEGRADED') && this.desiredState === 'RUNNING';
    if (command === 'STOP') return this.phase === 'STOPPED' && this.startedNames.size === 0;
    if (command === 'PAUSE') return this.phase === 'PAUSED';
    if (command === 'RESUME') return (this.phase === 'RUNNING' || this.phase === 'DEGRADED') && this.desiredState === 'RUNNING';
    return false;
  }

  private commandApplicabilityFailure(
    request: ControlCommandRequest,
    correlationId: string,
  ): StructuredFailure | null {
    const allowed = (() => {
      switch (request.command) {
        case 'VALIDATE': return ['STOPPED', 'BLOCKED', 'FAILED'].includes(this.phase) && this.startedNames.size === 0;
        case 'START': return ((['STOPPED', 'BLOCKED', 'FAILED'].includes(this.phase) && this.startedNames.size === 0)
          || ['RUNNING', 'DEGRADED'].includes(this.phase));
        case 'PAUSE': return ['RUNNING', 'DEGRADED', 'PAUSED'].includes(this.phase);
        case 'RESUME': return ['PAUSED', 'RUNNING', 'DEGRADED'].includes(this.phase);
        case 'STOP': return true;
        case 'RESTART': return true;
      }
    })();
    if (allowed) return null;
    return this.failure(
      CONTROL_FAILURE_CODES.COMMAND_NOT_APPLICABLE,
      'command:applicability',
      `${request.command} is not applicable while phase=${this.phase}, desired=${this.desiredState}, started=${this.startedNames.size}`,
      request.nowMs,
      correlationId,
      false,
      'Use STOP or RESTART to reconcile the observed runtime before issuing this command.',
    );
  }

  private beginStartup(operation: ActiveOperation, incrementGeneration: boolean, nowMs: number): void {
    if (incrementGeneration) this.generation += 1;
    this.blockedAtGate = null;
    this.preflightResults = [];
    this.startupExclusions = new Map();
    this.safetyStoppedNames.clear();
    this.prerequisiteStopDeadlines.clear();
    this.transition('VALIDATING', nowMs, operation.correlationId);

    let environment: ControlEnvironment;
    try {
      environment = this.readEnvironment();
    } catch {
      const failure = this.failure(
        CONTROL_FAILURE_CODES.ENVIRONMENT_READ_THREW,
        'preflight:environment',
        'injected control environment provider threw',
        nowMs,
        operation.correlationId,
        true,
        'Repair the injected environment provider and retry validation.',
      );
      this.recordFailure(failure, 'FAILED');
      this.transition('FAILED', nowMs, operation.correlationId);
      this.finish(operation);
      return;
    }
    if (!this.validEnvironment(environment)) {
      const failure = this.failure(
        CONTROL_FAILURE_CODES.ENVIRONMENT_INVALID,
        'preflight:environment',
        'injected control environment must provide three explicit boolean facts',
        nowMs,
        operation.correlationId,
        false,
        'Return explicit booleans for keys, kill switch, and borrow truth.',
      );
      this.recordFailure(failure, 'FAILED');
      this.transition('FAILED', nowMs, operation.correlationId);
      this.finish(operation);
      return;
    }
    operation.environment = Object.freeze({ ...environment });
    operation.exclusions = computeExclusions(this.deps.components, this.startOrder, environment, this.config.runMode);
    this.exclusions = new Map(operation.exclusions);
    operation.gateChain = this.buildGateChain(operation);
    operation.stage = 'PREFLIGHT';
    operation.index = 0;
    operation.deadlineAt = null;
    operation.startAfterValidation = operation.command !== 'VALIDATE';
    this.advance(operation, nowMs);
  }

  private beginStop(operation: ActiveOperation, purpose: StopPurpose, nowMs: number): void {
    if (purpose !== 'ROLLBACK') this.blockedAtGate = null;
    operation.stopPurpose = purpose;
    operation.stage = 'STOP_COMPONENTS';
    operation.order = [...this.startOrder].reverse().filter((name) => this.startedNames.has(name));
    operation.index = 0;
    operation.deadlineAt = null;
    operation.stopFailure = null;
    if (purpose === 'PAUSE') {
      this.transition('PAUSING', nowMs, operation.correlationId);
    } else if (this.phase !== 'STOPPED') {
      this.transition('STOPPING', nowMs, operation.correlationId);
    }
    this.advance(operation, nowMs);
  }

  private beginRollback(operation: ActiveOperation, primaryFailure: StructuredFailure, nowMs: number): void {
    operation.primaryFailure = primaryFailure;
    operation.stopPurpose = 'ROLLBACK';
    operation.stage = 'STOP_COMPONENTS';
    operation.order = [...this.startOrder].reverse().filter((name) => this.startedNames.has(name));
    operation.index = 0;
    operation.deadlineAt = null;
    operation.stopFailure = null;
    if (operation.order.length === 0) {
      this.transition('FAILED', nowMs, operation.correlationId);
      this.finish(operation);
      return;
    }
    this.transition('STOPPING', nowMs, operation.correlationId);
    this.advance(operation, nowMs);
  }

  private advance(operation: ActiveOperation, nowMs: number): void {
    if (this.active !== operation) return;
    if (operation.stage === 'PREFLIGHT') this.advancePreflight(operation, nowMs);
    else if (operation.stage === 'VALIDATE_COMPONENTS') this.advanceValidation(operation, nowMs);
    else if (operation.stage === 'START_COMPONENTS') this.advanceStart(operation, nowMs);
    else this.advanceStop(operation, nowMs);
  }

  private advancePreflight(operation: ActiveOperation, nowMs: number): void {
    const environment = operation.environment;
    if (environment === null) throw new TypeError('control invariant: preflight has no environment snapshot');
    while (operation.index < operation.gateChain.length) {
      const gate = operation.gateChain[operation.index];
      const globallyBlocking = gate.blocking && !gate.borrowDependent;
      if (operation.deadlineAt === null) operation.deadlineAt = nowMs + gate.timeoutMs;
      else if (nowMs >= operation.deadlineAt) {
        const failure = this.failure(
          CONTROL_FAILURE_CODES.PREFLIGHT_GATE_TIMEOUT,
          `preflight:${gate.gate}`,
          `preflight gate '${gate.gate}' exceeded ${gate.timeoutMs}ms`,
          nowMs,
          operation.correlationId,
          true,
          `Inspect '${gate.gate}' and retry validation after it can answer within its deadline.`,
        );
        if (gate.borrowDependent) {
          this.excludeBorrowComponents(operation, `borrow gate '${gate.gate}' timed out`);
        }
        this.preflightResults.push({
          gate: gate.gate,
          status: 'TIMEOUT',
          blocking: globallyBlocking,
          detail: failure.message,
          checkedAt: nowMs,
        });
        if (globallyBlocking) {
          this.blockPreflight(operation, failure, gate.gate, nowMs);
          return;
        }
        operation.index += 1;
        operation.deadlineAt = null;
        continue;
      }

      let outcome: PreflightGateOutcome;
      if (gate.borrowDependent && !environment.borrowTruthPresent) {
        const failure = this.failure(
          CONTROL_FAILURE_CODES.BORROW_TRUTH_UNAVAILABLE,
          `preflight:${gate.gate}`,
          `borrow-dependent gate '${gate.gate}' cannot pass while borrow truth is unavailable`,
          nowMs,
          operation.correlationId,
          true,
          'Refresh read-only borrow evidence; unrelated non-borrow components remain eligible.',
        );
        outcome = { status: 'FAIL', detail: failure.message, failure };
      } else {
        try {
          outcome = gate.run(this.gateContext(operation, nowMs));
        } catch {
          const failure = this.failure(
            CONTROL_FAILURE_CODES.PREFLIGHT_GATE_THREW,
            `preflight:${gate.gate}`,
            `preflight gate '${gate.gate}' threw instead of returning a typed outcome`,
            nowMs,
            operation.correlationId,
            false,
            `Repair the '${gate.gate}' gate adapter before retrying.`,
          );
          outcome = { status: 'FAIL', detail: failure.message, failure };
        }
      }
      if (!this.validGateOutcome(outcome)) {
        const failure = this.failure(
          CONTROL_FAILURE_CODES.COMPONENT_CONTRACT_VIOLATION,
          `preflight:${gate.gate}`,
          `preflight gate '${gate.gate}' returned a malformed outcome`,
          nowMs,
          operation.correlationId,
          false,
          `Repair the '${gate.gate}' gate adapter to return PASS, FAIL, or PENDING.`,
        );
        outcome = { status: 'FAIL', detail: failure.message, failure };
      }
      if (outcome.status === 'PENDING') return;

      this.preflightResults.push({
        gate: gate.gate,
        status: outcome.status,
        blocking: globallyBlocking,
        detail: outcome.detail ?? (outcome.status === 'PASS' ? 'passed' : 'failed'),
        checkedAt: nowMs,
      });
      if (outcome.status === 'FAIL') {
        if (gate.borrowDependent) {
          this.excludeBorrowComponents(operation, `borrow gate '${gate.gate}' failed`);
        }
        const failure = outcome.failure && isStructuredFailure(outcome.failure)
          ? outcome.failure
          : this.failure(
              CONTROL_FAILURE_CODES.PREFLIGHT_GATE_FAILED,
              `preflight:${gate.gate}`,
              outcome.detail,
              nowMs,
              operation.correlationId,
              false,
              `Resolve '${gate.gate}' before retrying.`,
            );
        if (globallyBlocking) {
          this.blockPreflight(operation, failure, gate.gate, nowMs);
          return;
        }
      }
      operation.index += 1;
      operation.deadlineAt = null;
    }

    operation.stage = 'VALIDATE_COMPONENTS';
    operation.order = this.startOrder.filter((name) => !operation.exclusions.has(name));
    this.startupExclusions = new Map(operation.exclusions);
    this.exclusions = new Map(operation.exclusions);
    this.applyExclusionStatuses(operation.exclusions);
    operation.index = 0;
    operation.deadlineAt = null;
    this.advanceValidation(operation, nowMs);
  }

  private advanceValidation(operation: ActiveOperation, nowMs: number): void {
    const environment = operation.environment as ControlEnvironment;
    while (operation.index < operation.order.length) {
      const name = operation.order[operation.index];
      const component = this.componentByName.get(name) as ManagedComponent;
      const status = this.componentStatus.get(name) as MutableComponentStatus;
      status.phase = 'VALIDATING';
      const timeoutMs = component.stepTimeoutMs ?? this.config.defaultComponentTimeoutMs;
      if (operation.deadlineAt === null) operation.deadlineAt = nowMs + timeoutMs;
      else if (nowMs >= operation.deadlineAt) {
        const failure = this.componentFailure(
          component,
          'validate',
          CONTROL_FAILURE_CODES.COMPONENT_VALIDATE_TIMEOUT,
          `validation exceeded ${timeoutMs}ms`,
          nowMs,
          operation.correlationId,
          true,
        );
        this.failValidation(operation, component, failure, nowMs);
        return;
      }
      const outcome = this.callComponent(component, 'validate', this.componentContext(operation, environment, nowMs));
      if (outcome.kind === 'PENDING') return;
      if (outcome.kind === 'FAILED') {
        this.failValidation(operation, component, outcome.failure, nowMs);
        return;
      }
      status.phase = 'STOPPED';
      operation.index += 1;
      operation.deadlineAt = null;
    }

    if (!operation.startAfterValidation) {
      this.transition('STOPPED', nowMs, operation.correlationId);
      this.finish(operation);
      return;
    }
    this.transition('STARTING', nowMs, operation.correlationId);
    operation.stage = 'START_COMPONENTS';
    operation.index = 0;
    operation.deadlineAt = null;
    this.advanceStart(operation, nowMs);
  }

  private advanceStart(operation: ActiveOperation, nowMs: number): void {
    const environment = operation.environment as ControlEnvironment;
    while (operation.index < operation.order.length) {
      const name = operation.order[operation.index];
      const component = this.componentByName.get(name) as ManagedComponent;
      const status = this.componentStatus.get(name) as MutableComponentStatus;
      status.phase = 'STARTING';
      const timeoutMs = component.stepTimeoutMs ?? this.config.defaultComponentTimeoutMs;
      if (operation.deadlineAt === null) operation.deadlineAt = nowMs + timeoutMs;
      else if (nowMs >= operation.deadlineAt) {
        const failure = this.componentFailure(
          component,
          'start',
          CONTROL_FAILURE_CODES.COMPONENT_START_TIMEOUT,
          `start exceeded ${timeoutMs}ms`,
          nowMs,
          operation.correlationId,
          true,
        );
        this.failStart(operation, component, failure, nowMs);
        return;
      }
      const outcome = this.callComponent(component, 'start', this.componentContext(operation, environment, nowMs));
      if (outcome.kind === 'PENDING') return;
      if (outcome.kind === 'FAILED') {
        this.failStart(operation, component, outcome.failure, nowMs);
        return;
      }
      this.startedNames.add(component.name);
      if (this.startedAt === null) this.startedAt = nowMs;
      status.phase = 'RUNNING';
      operation.index += 1;
      operation.deadlineAt = null;
    }

    if (this.startedAt === null) this.startedAt = nowMs;
    this.refreshHealth(nowMs, operation.correlationId);
    this.finish(operation);
  }

  private advanceStop(operation: ActiveOperation, nowMs: number): void {
    const environmentRead = this.tryReadEnvironment();
    const environment = operation.environment ?? (environmentRead.ok ? environmentRead.value : null);
    while (operation.index < operation.order.length) {
      const name = operation.order[operation.index];
      if (!this.startedNames.has(name)) {
        operation.index += 1;
        operation.deadlineAt = null;
        continue;
      }
      const component = this.componentByName.get(name) as ManagedComponent;
      const status = this.componentStatus.get(name) as MutableComponentStatus;
      status.phase = 'STOPPING';
      const timeoutMs = component.stepTimeoutMs ?? this.config.defaultComponentTimeoutMs;
      if (operation.deadlineAt === null) operation.deadlineAt = nowMs + timeoutMs;
      else if (nowMs >= operation.deadlineAt) {
        const code = operation.stopPurpose === 'ROLLBACK'
          ? CONTROL_FAILURE_CODES.ROLLBACK_STOP_FAILED
          : CONTROL_FAILURE_CODES.COMPONENT_STOP_TIMEOUT;
        const failure = this.componentFailure(
          component,
          'stop',
          code,
          `stop exceeded ${timeoutMs}ms`,
          nowMs,
          operation.correlationId,
          true,
        );
        this.noteStopFailure(operation, status, failure);
        operation.index += 1;
        operation.deadlineAt = null;
        continue;
      }
      const outcome = this.callComponent(component, 'stop', this.componentContext(operation, environment, nowMs));
      if (outcome.kind === 'PENDING') return;
      if (outcome.kind === 'FAILED') {
        this.noteStopFailure(operation, status, outcome.failure);
      } else {
        this.startedNames.delete(component.name);
        status.phase = 'STOPPED';
        status.authority = 'UNAVAILABLE';
        status.heartbeatAt = null;
      }
      operation.index += 1;
      operation.deadlineAt = null;
    }
    this.finishStop(operation, nowMs);
  }

  private finishStop(operation: ActiveOperation, nowMs: number): void {
    const purpose = operation.stopPurpose;
    if (purpose === 'ROLLBACK') {
      const primary = operation.primaryFailure as StructuredFailure;
      if (this.startedNames.size === 0) {
        this.startedAt = null;
        this.heartbeatAt = null;
      }
      if (operation.stopFailure === null) this.lastError = primary;
      this.transition('FAILED', nowMs, operation.correlationId);
      this.finish(operation);
      return;
    }
    if (operation.stopFailure !== null) {
      this.transition('FAILED', nowMs, operation.correlationId);
      this.finish(operation);
      return;
    }
    if (purpose === 'PAUSE') {
      this.transition('PAUSED', nowMs, operation.correlationId);
      this.finish(operation);
      return;
    }

    this.startedAt = null;
    this.heartbeatAt = null;
    this.blockedAtGate = null;
    if (this.phase !== 'STOPPED') this.transition('STOPPED', nowMs, operation.correlationId);
    if (purpose === 'RESTART') {
      this.beginStartup(operation, true, nowMs);
      return;
    }
    this.safetyStoppedNames.clear();
    this.prerequisiteStopDeadlines.clear();
    this.startupExclusions = new Map();
    this.exclusions = new Map();
    for (const status of this.componentStatus.values()) {
      if (!this.startedNames.has(status.name)) {
        status.phase = 'STOPPED';
        status.authority = 'UNAVAILABLE';
        status.heartbeatAt = null;
      }
    }
    this.finish(operation);
  }

  private failValidation(
    operation: ActiveOperation,
    component: ManagedComponent,
    failure: StructuredFailure,
    nowMs: number,
  ): void {
    const status = this.componentStatus.get(component.name) as MutableComponentStatus;
    const recorded = this.recordFailure(failure, 'FAILED');
    status.phase = 'FAILED';
    status.lastError = recorded;
    this.transition('FAILED', nowMs, operation.correlationId);
    this.finish(operation);
  }

  private failStart(
    operation: ActiveOperation,
    component: ManagedComponent,
    failure: StructuredFailure,
    nowMs: number,
  ): void {
    const status = this.componentStatus.get(component.name) as MutableComponentStatus;
    const recorded = this.recordFailure(failure, 'FAILED');
    status.phase = 'FAILED';
    status.lastError = recorded;
    this.beginRollback(operation, recorded, nowMs);
  }

  private noteStopFailure(
    operation: ActiveOperation,
    status: MutableComponentStatus,
    failure: StructuredFailure,
  ): void {
    const recorded = this.recordFailure(failure, 'FAILED');
    status.phase = 'FAILED';
    status.lastError = recorded;
    if (operation.stopFailure === null) operation.stopFailure = recorded;
  }

  private callComponent(
    component: ManagedComponent,
    stage: 'validate' | 'start' | 'stop',
    context: ComponentStepContext,
  ): ComponentStepOutcome {
    let outcome: ComponentStepOutcome;
    try {
      outcome = component[stage](context);
    } catch {
      const code = stage === 'validate'
        ? CONTROL_FAILURE_CODES.COMPONENT_VALIDATE_THREW
        : stage === 'start'
          ? CONTROL_FAILURE_CODES.COMPONENT_START_THREW
          : CONTROL_FAILURE_CODES.COMPONENT_STOP_THREW;
      return {
        kind: 'FAILED',
        failure: this.componentFailure(
          component,
          stage,
          code,
          `${stage} threw instead of returning a typed outcome`,
          context.nowMs,
          context.correlationId,
          false,
        ),
      };
    }
    if (!this.validComponentOutcome(outcome)) {
      return {
        kind: 'FAILED',
        failure: this.componentFailure(
          component,
          stage,
          CONTROL_FAILURE_CODES.COMPONENT_CONTRACT_VIOLATION,
          `${stage} returned a malformed outcome`,
          context.nowMs,
          context.correlationId,
          false,
        ),
      };
    }
    return outcome;
  }

  private refreshHealth(nowMs: number, correlationId: string): void {
    let degraded = false;
    let requiredFatal = false;
    let requiredFatalEvidence: StructuredFailure | null = null;
    const environmentRead = this.tryReadEnvironment();
    const environment = environmentRead.ok ? environmentRead.value : null;
    let environmentUnavailable = false;
    let runtimeExclusions: Map<string, string>;
    if (environmentRead.ok) {
      runtimeExclusions = computeExclusions(
        this.deps.components,
        this.startOrder,
        environmentRead.value,
        this.config.runMode,
      );
    } else {
      environmentUnavailable = true;
      degraded = true;
      const failure = this.failure(
        environmentRead.code,
        'health:environment',
        environmentRead.message,
        nowMs,
        correlationId,
        true,
        'Restore the injected environment provider; safety-dependent components are stopped until RESTART.',
      );
      if (this.lastError?.code !== failure.code || this.lastError.stage !== failure.stage) {
        this.recordFailure(failure, 'DEGRADED');
      }
      runtimeExclusions = this.environmentUnavailableExclusions(environmentRead.message);
    }
    const handledPrerequisiteStops = new Set<string>();
    for (const name of [...this.startOrder].reverse()) {
      const exclusion = runtimeExclusions.get(name);
      if (exclusion === undefined || !this.startedNames.has(name)) continue;
      handledPrerequisiteStops.add(name);
      const component = this.componentByName.get(name) as ManagedComponent;
      const status = this.componentStatus.get(name) as MutableComponentStatus;
      const timeoutMs = component.stepTimeoutMs ?? this.config.defaultComponentTimeoutMs;
      const existingDeadline = this.prerequisiteStopDeadlines.get(name);
      const code = environmentUnavailable
        ? CONTROL_FAILURE_CODES.ENVIRONMENT_UNAVAILABLE
        : component.requiresBorrowTruth === true
        ? CONTROL_FAILURE_CODES.BORROW_TRUTH_UNAVAILABLE
        : component.requiresPrivateKeys === true
          ? CONTROL_FAILURE_CODES.MISSING_PRIVATE_KEYS
          : CONTROL_FAILURE_CODES.COMPONENT_DEPENDENCY_UNAVAILABLE;
      const prerequisiteFailure = this.componentFailure(
        component,
        'runtime:prerequisite',
        code,
        `${exclusion}; component is being stopped and requires RESTART after recovery`,
        nowMs,
        correlationId,
        true,
      );
      if (existingDeadline !== undefined && nowMs >= existingDeadline) {
        const timeoutFailure = this.componentFailure(
          component,
          'stop',
          CONTROL_FAILURE_CODES.COMPONENT_STOP_TIMEOUT,
          `prerequisite safety stop exceeded ${timeoutMs}ms`,
          nowMs,
          correlationId,
          true,
        );
        const recorded = this.recordFailure(timeoutFailure, 'FAILED');
        status.phase = 'FAILED';
        status.authority = 'UNAVAILABLE';
        status.heartbeatAt = null;
        status.lastError = recorded;
        requiredFatal = true;
        requiredFatalEvidence = recorded;
        break;
      }
      if (existingDeadline === undefined) {
        this.prerequisiteStopDeadlines.set(name, nowMs + timeoutMs);
      }
      const outcome = this.callComponent(component, 'stop', {
        nowMs,
        generation: this.generation,
        correlationId,
        runMode: this.config.runMode,
        privateKeysAvailable: environment?.privateKeysAvailable ?? null,
      });
      if (outcome.kind === 'FAILED') {
        const recorded = this.recordFailure(outcome.failure, 'FAILED');
        status.phase = 'FAILED';
        status.authority = 'UNAVAILABLE';
        status.heartbeatAt = null;
        status.lastError = recorded;
        requiredFatal = true;
        requiredFatalEvidence = recorded;
        break;
      }
      const wasSame = status.lastError?.code === code;
      const recorded = wasSame
        ? (status.lastError as StructuredFailure)
        : this.recordFailure(prerequisiteFailure, 'DEGRADED');
      status.authority = 'UNAVAILABLE';
      status.heartbeatAt = null;
      status.lastError = recorded;
      degraded = true;
      if (outcome.kind === 'PENDING') {
        status.phase = 'STOPPING';
        break;
      }
      this.startedNames.delete(name);
      this.prerequisiteStopDeadlines.delete(name);
      this.safetyStoppedNames.add(name);
      this.startupExclusions.set(name, `${exclusion}; stopped after runtime prerequisite loss`);
      status.phase = 'BLOCKED';
    }
    const activeExclusions = new Map(this.startupExclusions);
    for (const [name, reason] of runtimeExclusions) activeExclusions.set(name, reason);
    this.exclusions = activeExclusions;
    for (const name of this.startOrder) {
      if (!this.startedNames.has(name)) continue;
      const component = this.componentByName.get(name) as ManagedComponent;
      const status = this.componentStatus.get(name) as MutableComponentStatus;
      if (handledPrerequisiteStops.has(name)) continue;
      const exclusion = activeExclusions.get(name);
      if (exclusion !== undefined) {
        const code = component.requiresBorrowTruth === true
          ? CONTROL_FAILURE_CODES.BORROW_TRUTH_UNAVAILABLE
          : component.requiresPrivateKeys === true
            ? CONTROL_FAILURE_CODES.MISSING_PRIVATE_KEYS
            : CONTROL_FAILURE_CODES.COMPONENT_DEPENDENCY_UNAVAILABLE;
        const failure = this.componentFailure(
          component,
          'probe:prerequisite',
          code,
          exclusion,
          nowMs,
          correlationId,
          true,
        );
        const wasSame = status.phase === 'DEGRADED' && status.lastError?.code === code;
        const recorded = wasSame
          ? (status.lastError as StructuredFailure)
          : this.recordFailure(failure, 'DEGRADED');
        status.phase = 'DEGRADED';
        status.authority = 'UNAVAILABLE';
        status.heartbeatAt = null;
        status.lastError = recorded;
        degraded = true;
        continue;
      }
      let probe: ComponentProbe;
      try {
        probe = component.probe({
          nowMs,
          generation: this.generation,
          correlationId,
          runMode: this.config.runMode,
          privateKeysAvailable: environment?.privateKeysAvailable ?? null,
        });
      } catch {
        const failure = this.componentFailure(
          component,
          'probe',
          CONTROL_FAILURE_CODES.COMPONENT_PROBE_THREW,
          'probe threw instead of returning health evidence',
          nowMs,
          correlationId,
          false,
        );
        const recorded = this.applyProbeFailure(component, status, failure);
        degraded = true;
        requiredFatal ||= component.required;
        if (component.required) requiredFatalEvidence = recorded;
        continue;
      }
      if (!this.validProbe(probe)) {
        const failure = this.componentFailure(
          component,
          'probe',
          CONTROL_FAILURE_CODES.COMPONENT_CONTRACT_VIOLATION,
          'probe returned malformed or non-explicit health evidence',
          nowMs,
          correlationId,
          false,
        );
        const recorded = this.applyProbeFailure(component, status, failure);
        degraded = true;
        requiredFatal ||= component.required;
        if (component.required) requiredFatalEvidence = recorded;
        continue;
      }
      status.heartbeatAt = probe.heartbeatAt;
      if (probe.fatal !== null) {
        const target = component.required ? 'FAILED' : 'DEGRADED';
        const wasSame = status.phase === (component.required ? 'FAILED' : 'DEGRADED')
          && status.lastError?.code === probe.fatal.code;
        const recorded = wasSame
          ? (status.lastError as StructuredFailure)
          : this.recordFailure(probe.fatal, target);
        status.phase = target;
        status.authority = 'UNAVAILABLE';
        status.lastError = recorded;
        degraded = true;
        requiredFatal ||= component.required;
        if (component.required) requiredFatalEvidence = recorded;
        continue;
      }

      const freshness = probe.timestamp === null
        ? null
        : evaluateFreshness(probe.timestamp, nowMs);
      if (freshness === null || freshness.state !== 'FRESH') {
        const code = component.required
          ? CONTROL_FAILURE_CODES.REQUIRED_SOURCE_STALE
          : CONTROL_FAILURE_CODES.COMPONENT_SOURCE_STALE;
        const failure = this.componentFailure(
          component,
          'probe:freshness',
          code,
          freshness === null
            ? 'primary source timestamp is unavailable'
            : `primary source is ${freshness.state} at age ${freshness.ageMs ?? 'UNKNOWN'}ms`,
          nowMs,
          correlationId,
          true,
        );
        const wasSame = status.phase === 'DEGRADED' && status.lastError?.code === failure.code;
        const recorded = wasSame
          ? (status.lastError as StructuredFailure)
          : this.recordFailure(failure, 'DEGRADED');
        status.phase = 'DEGRADED';
        status.authority = 'UNAVAILABLE';
        status.lastError = recorded;
        degraded = true;
      } else {
        status.phase = 'RUNNING';
        status.authority = freshness.effectiveAuthority;
      }
    }

    const heartbeats = [...this.componentStatus.values()]
      .map((status) => status.heartbeatAt)
      .filter((value): value is number => value !== null);
    this.heartbeatAt = heartbeats.length === 0 ? null : Math.max(...heartbeats);
    degraded ||= this.safetyStoppedNames.size > 0;
    const target: RuntimePhase = requiredFatal ? 'FAILED' : degraded ? 'DEGRADED' : 'RUNNING';
    if (requiredFatalEvidence !== null) this.lastError = requiredFatalEvidence;
    if (target !== this.phase) this.transition(target, nowMs, correlationId);
  }

  private applyProbeFailure(
    component: ManagedComponent,
    status: MutableComponentStatus,
    failure: StructuredFailure,
  ): StructuredFailure {
    const target = component.required ? 'FAILED' : 'DEGRADED';
    const recorded = this.recordFailure(failure, target);
    status.phase = target;
    status.authority = 'UNAVAILABLE';
    status.lastError = recorded;
    return recorded;
  }

  private buildGateChain(operation: ActiveOperation): GateDescriptor[] {
    const environment = operation.environment as ControlEnvironment;
    const includedRiskIncreasing = this.deps.components.some(
      (component) => component.riskIncreasing === true && !operation.exclusions.has(component.name),
    );
    const builtIns: GateDescriptor[] = [
      {
        gate: 'runMode',
        blocking: true,
        borrowDependent: false,
        timeoutMs: this.config.defaultGateTimeoutMs,
        run: (ctx) => {
          const result = checkRunModePermitted(this.config.runMode, {
            nowMs: ctx.nowMs,
            correlationId: ctx.correlationId,
          });
          return result.ok
            ? { status: 'PASS', detail: `${result.value} is permitted` }
            : { status: 'FAIL', detail: result.failure.message, failure: result.failure };
        },
      },
      {
        gate: 'killSwitch',
        blocking: true,
        borrowDependent: false,
        timeoutMs: this.config.defaultGateTimeoutMs,
        run: (ctx) => {
          if (ctx.killSwitchEngaged && includedRiskIncreasing) {
            const failure = this.failure(
              CONTROL_FAILURE_CODES.KILL_SWITCH_ENGAGED,
              'preflight:killSwitch',
              'kill switch blocks startup of risk-increasing components',
              ctx.nowMs,
              ctx.correlationId,
              true,
              'Keep the runtime stopped or disengage the kill switch under operator control.',
            );
            return { status: 'FAIL', detail: failure.message, failure };
          }
          return {
            status: 'PASS',
            detail: ctx.killSwitchEngaged
              ? 'kill switch engaged; no eligible component increases risk'
              : 'kill switch clear',
          };
        },
      },
      {
        gate: 'privateKeys',
        blocking: true,
        borrowDependent: false,
        timeoutMs: this.config.defaultGateTimeoutMs,
        run: (ctx) => {
          if (this.config.runMode === 'EXECUTION_VALIDATE_ONLY' && !ctx.privateKeysAvailable) {
            const failure = this.failure(
              CONTROL_FAILURE_CODES.MISSING_PRIVATE_KEYS,
              'preflight:privateKeys',
              'EXECUTION_VALIDATE_ONLY requires private-key availability evidence',
              ctx.nowMs,
              ctx.correlationId,
              true,
              'Provide the signed-read/test-order adapter or use INTELLIGENCE mode.',
            );
            return { status: 'FAIL', detail: failure.message, failure };
          }
          return {
            status: 'PASS',
            detail: ctx.privateKeysAvailable ? 'private-key availability confirmed' : 'keyless INTELLIGENCE is permitted',
          };
        },
      },
    ];
    const custom = this.deps.gates.map((gate: PreflightGate) => ({
      gate: gate.gate,
      blocking: gate.blocking,
      borrowDependent: gate.borrowDependent === true,
      timeoutMs: gate.timeoutMs ?? this.config.defaultGateTimeoutMs,
      run: (ctx: PreflightGateContext) => gate.run(ctx),
    }));
    const eligibility: GateDescriptor = {
      gate: 'componentEligibility',
      blocking: true,
      borrowDependent: false,
      timeoutMs: this.config.defaultGateTimeoutMs,
      run: (ctx) => {
        const eligible = this.startOrder.filter((name) => !operation.exclusions.has(name));
        if (eligible.length > 0) {
          return { status: 'PASS', detail: `${eligible.length} component(s) eligible` };
        }
        const failure = this.failure(
          CONTROL_FAILURE_CODES.NO_ELIGIBLE_COMPONENTS,
          'preflight:componentEligibility',
          'no managed component is eligible under the current prerequisite evidence',
          ctx.nowMs,
          ctx.correlationId,
          true,
          'Restore required evidence, then issue RESTART with a new revision.',
        );
        return { status: 'FAIL', detail: failure.message, failure };
      },
    };
    return [...builtIns, ...custom, eligibility];
  }

  /** Scope a borrow-gate failure to borrow actions and their dependants. */
  private excludeBorrowComponents(operation: ActiveOperation, reason: string): void {
    for (const name of this.startOrder) {
      const component = this.componentByName.get(name) as ManagedComponent;
      if (component.requiresBorrowTruth === true) {
        operation.exclusions.set(name, reason);
        continue;
      }
      const excludedDependency = component.dependsOn.find((dependency) => operation.exclusions.has(dependency));
      if (excludedDependency !== undefined && !operation.exclusions.has(name)) {
        operation.exclusions.set(name, `depends on excluded component '${excludedDependency}'`);
      }
    }
    this.exclusions = new Map(operation.exclusions);
  }

  private applyExclusionStatuses(exclusions: ReadonlyMap<string, string>): void {
    for (const name of this.startOrder) {
      const status = this.componentStatus.get(name) as MutableComponentStatus;
      if (exclusions.has(name)) {
        status.phase = 'BLOCKED';
        status.authority = 'UNAVAILABLE';
        status.heartbeatAt = null;
      } else if (!this.startedNames.has(name) && status.phase === 'BLOCKED') {
        status.phase = 'STOPPED';
      }
    }
  }

  private gateContext(operation: ActiveOperation, nowMs: number): PreflightGateContext {
    const environment = operation.environment as ControlEnvironment;
    return {
      nowMs,
      generation: this.generation,
      correlationId: operation.correlationId,
      runMode: this.config.runMode,
      privateKeysAvailable: environment.privateKeysAvailable,
      killSwitchEngaged: environment.killSwitchEngaged,
      borrowTruthPresent: environment.borrowTruthPresent,
    };
  }

  private componentContext(
    operation: ActiveOperation,
    environment: ControlEnvironment | null,
    nowMs: number,
  ): ComponentStepContext {
    return {
      nowMs,
      generation: this.generation,
      correlationId: operation.correlationId,
      runMode: this.config.runMode,
      privateKeysAvailable: environment?.privateKeysAvailable ?? null,
    };
  }

  private blockPreflight(
    operation: ActiveOperation,
    failure: StructuredFailure,
    gateName: string,
    nowMs: number,
  ): void {
    this.applyExclusionStatuses(operation.exclusions);
    for (let index = operation.index + 1; index < operation.gateChain.length; index += 1) {
      const later = operation.gateChain[index];
      this.preflightResults.push({
        gate: later.gate,
        status: 'SKIPPED',
        blocking: later.blocking && !later.borrowDependent,
        detail: `skipped after blocking failure at '${gateName}'`,
        checkedAt: null,
      });
    }
    this.blockedAtGate = gateName;
    this.recordFailure(failure, 'BLOCKED');
    this.transition('BLOCKED', nowMs, operation.correlationId);
    this.finish(operation);
  }

  private finish(operation: ActiveOperation): void {
    if (this.active !== operation) return;
    this.active = null;
    this.commandCorrelationId = null;
  }

  private transition(to: RuntimePhase, atMs: number, correlationId: string | null): void {
    if (to === this.phase) return;
    if (!canTransitionPhase(this.phase, to)) {
      throw new TypeError(`control invariant: illegal phase transition ${this.phase} -> ${to}`);
    }
    const from = this.phase;
    this.phase = to;
    this.lastTransitionAt = atMs;
    this.transitions.push({ from, to, atMs, correlationId });
  }

  private recordFailure(failure: StructuredFailure, safeCurrentState: RuntimePhase = this.phase): StructuredFailure {
    const recorded = this.withSafeCurrentState(failure, safeCurrentState);
    this.lastError = recorded;
    this.failures.push({ generation: this.generation, failure: recorded });
    return recorded;
  }

  private withSafeCurrentState(failure: StructuredFailure, safeCurrentState: RuntimePhase): StructuredFailure {
    if (failure.safeCurrentState === safeCurrentState) return failure;
    return createStructuredFailure({
      component: failure.component,
      stage: failure.stage,
      code: failure.code,
      message: failure.message,
      occurredAt: failure.occurredAt,
      retryable: failure.retryable,
      safeCurrentState,
      recommendedOperatorAction: failure.recommendedOperatorAction,
      correlationId: failure.correlationId,
    });
  }

  private failure(
    code: string,
    stage: string,
    message: string,
    occurredAt: number,
    correlationId: string,
    retryable: boolean,
    recommendedOperatorAction: string,
  ): StructuredFailure {
    return createStructuredFailure({
      component: 'foundation.control',
      stage,
      code,
      message,
      occurredAt,
      retryable,
      safeCurrentState: this.phase,
      recommendedOperatorAction,
      correlationId,
    });
  }

  private componentFailure(
    component: ManagedComponent,
    stage: string,
    code: string,
    message: string,
    occurredAt: number,
    correlationId: string,
    retryable: boolean,
  ): StructuredFailure {
    return createStructuredFailure({
      component: component.name,
      stage,
      code,
      message: `${component.name}: ${message}`,
      occurredAt,
      retryable,
      safeCurrentState: this.phase,
      recommendedOperatorAction: retryable
        ? `Inspect '${component.name}', then retry with a new command revision.`
        : `Repair the '${component.name}' adapter contract before retrying.`,
      correlationId,
    });
  }

  private readEnvironment(): ControlEnvironment {
    return this.deps.readEnvironment();
  }

  private tryReadEnvironment(): EnvironmentReadResult {
    try {
      const environment = this.readEnvironment();
      if (this.validEnvironment(environment)) return { ok: true, value: environment };
    } catch {
      return {
        ok: false,
        code: CONTROL_FAILURE_CODES.ENVIRONMENT_READ_THREW,
        message: 'injected control environment provider threw; prerequisite facts are explicitly unavailable',
      };
    }
    return {
      ok: false,
      code: CONTROL_FAILURE_CODES.ENVIRONMENT_INVALID,
      message: 'injected control environment provider returned malformed prerequisite facts',
    };
  }

  private environmentUnavailableExclusions(reason: string): Map<string, string> {
    const excluded = new Map<string, string>();
    for (const name of this.startOrder) {
      const component = this.componentByName.get(name) as ManagedComponent;
      if (component.riskIncreasing === true
        || component.requiresBorrowTruth === true
        || component.requiresPrivateKeys === true) {
        excluded.set(name, reason);
        continue;
      }
      const unavailableDependency = component.dependsOn.find((dependency) => excluded.has(dependency));
      if (unavailableDependency !== undefined) {
        excluded.set(name, `depends on unavailable component '${unavailableDependency}'`);
      }
    }
    return excluded;
  }

  private validEnvironment(value: unknown): value is ControlEnvironment {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const environment = value as Record<string, unknown>;
    return typeof environment.privateKeysAvailable === 'boolean'
      && typeof environment.killSwitchEngaged === 'boolean'
      && typeof environment.borrowTruthPresent === 'boolean';
  }

  private validComponentOutcome(value: unknown): value is ComponentStepOutcome {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const outcome = value as Record<string, unknown>;
    if (outcome.kind === 'COMPLETE' || outcome.kind === 'PENDING') {
      return outcome.detail === undefined || typeof outcome.detail === 'string';
    }
    return outcome.kind === 'FAILED' && isStructuredFailure(outcome.failure);
  }

  private validGateOutcome(value: unknown): value is PreflightGateOutcome {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const outcome = value as Record<string, unknown>;
    if (outcome.status === 'PASS' || outcome.status === 'PENDING') {
      return outcome.detail === undefined || typeof outcome.detail === 'string';
    }
    return outcome.status === 'FAIL'
      && typeof outcome.detail === 'string'
      && outcome.detail.trim().length > 0
      && (outcome.failure === undefined || isStructuredFailure(outcome.failure));
  }

  private validProbe(value: unknown): value is ComponentProbe {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const probe = value as Record<string, unknown>;
    const heartbeatValid = probe.heartbeatAt === null || isValidUtcMillis(probe.heartbeatAt);
    const timestamp = probe.timestamp;
    const timestampStructurallyPresent = timestamp === null
      || validateSourcedTimestamp(timestamp).length === 0;
    const fatalValid = probe.fatal === null || isStructuredFailure(probe.fatal);
    return heartbeatValid && timestampStructurallyPresent && fatalValid;
  }
}

/** Factory keeps composition terse without creating hidden global state. */
export function createDeterministicSupervisor(
  config: SupervisorConfig,
  deps: SupervisorDeps,
): DeterministicSupervisor {
  return new DeterministicSupervisor(config, deps);
}

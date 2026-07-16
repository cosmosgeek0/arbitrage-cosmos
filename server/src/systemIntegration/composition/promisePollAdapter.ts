import {
  createStructuredFailure,
  evaluateFreshness,
  type StructuredFailure,
} from '../../foundation/contracts/index.js';
import type {
  ComponentProbe,
  ComponentStepContext,
  ComponentStepOutcome,
  ManagedComponent,
} from '../../foundation/control/index.js';
import type { SystemComponentId } from '../contracts/constants.js';
import type {
  AdapterStartState,
  ManagedAdapterSnapshot,
  RuntimeHealthEvidence,
} from './types.js';

type MaybePromise = void | Promise<void>;

interface StartAttempt {
  readonly key: string;
  state: Exclude<AdapterStartState, 'IDLE'>;
  activationComplete: boolean;
}

export interface PromisePollAdapterSpec {
  readonly componentId: SystemComponentId;
  readonly required: boolean;
  readonly dependsOn: readonly SystemComponentId[];
  readonly stepTimeoutMs?: number;
  readonly requiresPrivateKeys?: boolean;
  readonly requiresBorrowTruth?: boolean;
  readonly riskIncreasing?: boolean;
  /**
   * RUNNING admits a lifecycle after its owner proves liveness. FRESH_SOURCE
   * keeps the start step pending until the owner also supplies a current
   * sourced observation, so downstream components cannot start on liveness
   * alone.
   */
  readonly readinessRequirement?: 'RUNNING' | 'FRESH_SOURCE';
  /** True for Basis/Volume, which become internally live before start() settles. */
  readonly ownsUnderlyingOnLaunch: boolean;
  readonly validate?: (ctx: ComponentStepContext) => void;
  /** Launch exactly once. Promise settlement is observed only on a later poll. */
  readonly launch: (ctx: ComponentStepContext) => MaybePromise;
  /** MarketEngine.start() belongs here, after init() has settled successfully. */
  readonly activate?: (ctx: ComponentStepContext) => void;
  readonly stop: () => void;
  readonly health: (ctx: ComponentStepContext) => RuntimeHealthEvidence;
}

function operationKey(stage: string, ctx: ComponentStepContext): string {
  return `${stage}:${ctx.generation}:${ctx.correlationId}`;
}

function codeFor(componentId: SystemComponentId, suffix: string): string {
  return `${componentId.replaceAll('-', '_').toUpperCase()}_${suffix}`;
}

function failure(
  componentId: SystemComponentId,
  stage: string,
  code: string,
  message: string,
  ctx: ComponentStepContext,
  retryable: boolean,
): Readonly<StructuredFailure> {
  return createStructuredFailure({
    component: componentId,
    stage,
    code,
    message,
    occurredAt: ctx.nowMs,
    retryable,
    safeCurrentState: 'UNCHANGED',
    recommendedOperatorAction: retryable
      ? `Inspect '${componentId}', then retry with a new control revision.`
      : `Repair the '${componentId}' lifecycle adapter before retrying.`,
    correlationId: ctx.correlationId,
  });
}

/**
 * Converts one Promise-returning runtime lifecycle into Foundation's
 * deterministic synchronous poll port. Promise callbacks record disposition
 * only: they never read a clock, build failures, or perform a late activation.
 */
export class PromisePollManagedComponent implements ManagedComponent {
  readonly name: SystemComponentId;
  readonly required: boolean;
  readonly dependsOn: readonly SystemComponentId[];
  readonly stepTimeoutMs?: number;
  readonly requiresPrivateKeys?: boolean;
  readonly requiresBorrowTruth?: boolean;
  readonly riskIncreasing?: boolean;

  private startAttempt: StartAttempt | null = null;
  private ownsUnderlyingRuntime = false;
  private admittedGeneration: number | null = null;
  private successfulStarts = 0;
  private abortCount = 0;
  private lastFailureCode: string | null = null;
  private lastAbortFailed = false;
  private containedStartFailure: Readonly<StructuredFailure> | null = null;

  constructor(private readonly spec: PromisePollAdapterSpec) {
    this.name = spec.componentId;
    this.required = spec.required;
    this.dependsOn = Object.freeze([...spec.dependsOn]);
    this.stepTimeoutMs = spec.stepTimeoutMs;
    this.requiresPrivateKeys = spec.requiresPrivateKeys;
    this.requiresBorrowTruth = spec.requiresBorrowTruth;
    this.riskIncreasing = spec.riskIncreasing;
  }

  validate(ctx: ComponentStepContext): ComponentStepOutcome {
    try {
      this.spec.validate?.(ctx);
      return { kind: 'COMPLETE', detail: `${this.name} lifecycle contract validated` };
    } catch {
      const code = codeFor(this.name, 'VALIDATE_FAILED');
      this.lastFailureCode = code;
      return {
        kind: 'FAILED',
        failure: failure(
          this.name,
          'validate',
          code,
          `${this.name} validation failed without exposing raw adapter error text`,
          ctx,
          false,
        ),
      };
    }
  }

  start(ctx: ComponentStepContext): ComponentStepOutcome {
    const key = operationKey('start', ctx);
    if (this.startAttempt === null || this.startAttempt.key !== key) {
      this.invalidateStartAttempt();
      this.containedStartFailure = null;
      const attempt: StartAttempt = {
        key,
        state: 'PENDING',
        activationComplete: this.spec.activate === undefined,
      };
      this.startAttempt = attempt;
      if (this.spec.ownsUnderlyingOnLaunch) this.ownsUnderlyingRuntime = true;
      try {
        const launched = this.spec.launch(ctx);
        if (launched && typeof launched.then === 'function') {
          void Promise.resolve(launched).then(
            () => {
              if (this.startAttempt === attempt) attempt.state = 'RESOLVED';
            },
            () => {
              if (this.startAttempt === attempt) attempt.state = 'REJECTED';
            },
          );
        } else {
          attempt.state = 'RESOLVED';
        }
      } catch {
        attempt.state = 'REJECTED';
      }
    }

    const attempt = this.startAttempt;
    if (attempt === null) {
      throw new TypeError('PromisePollManagedComponent invariant: start attempt disappeared');
    }
    if (attempt.state === 'PENDING') {
      return { kind: 'PENDING', detail: `${this.name} start is pending` };
    }
    if (attempt.state === 'REJECTED') {
      const cleanupFailed = !this.abortUnderlying();
      const code = codeFor(this.name, cleanupFailed ? 'START_ABORT_FAILED' : 'START_REJECTED');
      this.lastFailureCode = code;
      if (!this.required && !cleanupFailed) {
        return this.containOptionalStartFailure(
          ctx,
          code,
          `${this.name} start rejected; its adapter remains observable while the sibling engine continues`,
        );
      }
      return {
        kind: 'FAILED',
        failure: failure(
          this.name,
          'start',
          code,
          cleanupFailed
            ? `${this.name} start rejected and cleanup could not be proven`
            : `${this.name} start rejected; the underlying runtime was quiesced`,
          ctx,
          true,
        ),
      };
    }

    if (!attempt.activationComplete) {
      this.ownsUnderlyingRuntime = true;
      try {
        this.spec.activate?.(ctx);
        attempt.activationComplete = true;
      } catch {
        const cleanupFailed = !this.abortUnderlying();
        const code = codeFor(this.name, cleanupFailed ? 'ACTIVATION_ABORT_FAILED' : 'ACTIVATION_FAILED');
        this.lastFailureCode = code;
        if (!this.required && !cleanupFailed) {
          return this.containOptionalStartFailure(
            ctx,
            code,
            `${this.name} activation failed; its adapter remains observable while unrelated components continue`,
          );
        }
        return {
          kind: 'FAILED',
          failure: failure(
            this.name,
            'start:activate',
            code,
            cleanupFailed
              ? `${this.name} activation failed and cleanup could not be proven`
              : `${this.name} activation failed; the underlying runtime was quiesced`,
            ctx,
            true,
          ),
        };
      }
    }

    let health: RuntimeHealthEvidence;
    try {
      health = this.spec.health(ctx);
    } catch {
      const cleanupFailed = !this.abortUnderlying();
      const code = codeFor(this.name, cleanupFailed ? 'POSTCONDITION_ABORT_FAILED' : 'POSTCONDITION_FAILED');
      this.lastFailureCode = code;
      if (!this.required && !cleanupFailed) {
        return this.containOptionalStartFailure(
          ctx,
          code,
          `${this.name} could not prove its running postcondition and was safely quiesced`,
        );
      }
      return {
        kind: 'FAILED',
        failure: failure(
          this.name,
          'start:postcondition',
          code,
          `${this.name} could not prove its running postcondition`,
          ctx,
          true,
        ),
      };
    }
    if (!health.running) {
      const cleanupFailed = !this.abortUnderlying();
      const code = codeFor(this.name, cleanupFailed ? 'NOT_RUNNING_ABORT_FAILED' : 'NOT_RUNNING_AFTER_START');
      this.lastFailureCode = code;
      if (!this.required && !cleanupFailed) {
        return this.containOptionalStartFailure(
          ctx,
          code,
          `${this.name} settled without a running runtime and was safely quiesced`,
        );
      }
      return {
        kind: 'FAILED',
        failure: failure(
          this.name,
          'start:postcondition',
          code,
          `${this.name} start settled without a running runtime`,
          ctx,
          true,
        ),
      };
    }

    if (this.spec.readinessRequirement === 'FRESH_SOURCE') {
      const freshness = health.timestamp === null ? null : evaluateFreshness(health.timestamp, ctx.nowMs);
      if (freshness?.state !== 'FRESH') {
        return { kind: 'PENDING', detail: `${this.name} is running and waiting for current owner source truth` };
      }
    }

    if (this.admittedGeneration !== ctx.generation) {
      this.successfulStarts += 1;
      this.admittedGeneration = ctx.generation;
    }
    this.lastAbortFailed = false;
    return { kind: 'COMPLETE', detail: `${this.name} is running` };
  }

  stop(ctx: ComponentStepContext): ComponentStepOutcome {
    this.invalidateStartAttempt();
    try {
      this.spec.stop();
      this.ownsUnderlyingRuntime = false;
      this.admittedGeneration = null;
      this.containedStartFailure = null;
      this.lastAbortFailed = false;
      return { kind: 'COMPLETE', detail: `${this.name} stopped` };
    } catch {
      const code = codeFor(this.name, 'STOP_FAILED');
      this.lastFailureCode = code;
      this.lastAbortFailed = true;
      return {
        kind: 'FAILED',
        failure: failure(
          this.name,
          'stop',
          code,
          `${this.name} stop failed without exposing raw adapter error text`,
          ctx,
          true,
        ),
      };
    }
  }

  probe(ctx: ComponentStepContext): ComponentProbe {
    if (this.containedStartFailure !== null) {
      return {
        heartbeatAt: null,
        timestamp: null,
        fatal: this.containedStartFailure,
      };
    }
    const health = this.spec.health(ctx);
    if (health.running || health.fatal !== null) {
      return {
        heartbeatAt: health.heartbeatAt,
        timestamp: health.timestamp,
        fatal: health.fatal,
      };
    }
    const code = codeFor(this.name, 'STOPPED_UNEXPECTEDLY');
    this.lastFailureCode = code;
    return {
      heartbeatAt: health.heartbeatAt,
      timestamp: health.timestamp,
      fatal: failure(
        this.name,
        'probe:liveness',
        code,
        `${this.name} is not running while managed as started`,
        ctx,
        true,
      ),
    };
  }

  /** Invalidates late Promise settlement and quiesces an unadmitted runtime. */
  abortUnowned(): boolean {
    this.invalidateStartAttempt();
    if (!this.ownsUnderlyingRuntime) return true;
    return this.abortUnderlying();
  }

  /** Last-resort process drain. The caller preserves the supervisor failure. */
  forceStop(): boolean {
    this.invalidateStartAttempt();
    if (!this.ownsUnderlyingRuntime) return true;
    return this.abortUnderlying();
  }

  read(): Readonly<ManagedAdapterSnapshot> {
    return Object.freeze({
      componentId: this.name,
      startState: this.startAttempt?.state ?? 'IDLE',
      ownsUnderlyingRuntime: this.ownsUnderlyingRuntime,
      admittedGeneration: this.admittedGeneration,
      restartCount: Math.max(0, this.successfulStarts - 1),
      abortCount: this.abortCount,
      lastFailureCode: this.lastFailureCode,
      lastAbortFailed: this.lastAbortFailed,
    });
  }

  private invalidateStartAttempt(): void {
    this.startAttempt = null;
  }

  private containOptionalStartFailure(
    ctx: ComponentStepContext,
    code: string,
    message: string,
  ): ComponentStepOutcome {
    const contained = failure(
      this.name,
      'start:contained',
      code,
      message,
      ctx,
      true,
    );
    this.containedStartFailure = contained;
    if (this.admittedGeneration !== ctx.generation) {
      this.successfulStarts += 1;
      this.admittedGeneration = ctx.generation;
    }
    return {
      kind: 'COMPLETE',
      detail: `${this.name} start failure was safely contained; probe reports degraded evidence`,
    };
  }

  private abortUnderlying(): boolean {
    this.abortCount += 1;
    try {
      this.spec.stop();
      this.ownsUnderlyingRuntime = false;
      this.admittedGeneration = null;
      this.lastAbortFailed = false;
      return true;
    } catch {
      this.lastAbortFailed = true;
      return false;
    }
  }
}

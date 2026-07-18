/**
 * Foundation contracts — runtime vocabulary and laws (WAVE 0, frozen).
 *
 * The exact RunMode / DesiredRuntimeState / RuntimePhase / ControlCommand
 * unions from the sprint directive, plus:
 *   - the deterministic phase transition law the Lane A supervisor must obey;
 *   - the frozen status snapshot shape every lane compiles against;
 *   - the EXECUTION_LIVE hard block (LIVE_EXECUTION_NOT_IMPLEMENTED).
 *
 * Desired state and observed phase are DIFFERENT types on purpose: wanting
 * RUNNING is not being RUNNING, and nothing here lets one masquerade as the
 * other.
 *
 * Pure module: no I/O, no clocks, no env, no import-time side effects.
 */
import type { DataAuthority } from './authority.js';
import {
  createStructuredFailure,
  fail,
  ok,
  type ContractResult,
  type StructuredFailure,
} from './failures.js';
import { isValidUtcMillis } from './time.js';

// ---------- vocabulary ----------

export const RUN_MODES = ['INTELLIGENCE', 'EXECUTION_VALIDATE_ONLY', 'EXECUTION_LIVE'] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const DESIRED_RUNTIME_STATES = ['STOPPED', 'RUNNING', 'PAUSED'] as const;
export type DesiredRuntimeState = (typeof DESIRED_RUNTIME_STATES)[number];

export const RUNTIME_PHASES = [
  'STOPPED',
  'VALIDATING',
  'STARTING',
  'RUNNING',
  'DEGRADED',
  'PAUSING',
  'PAUSED',
  'STOPPING',
  'BLOCKED',
  'FAILED',
] as const;
export type RuntimePhase = (typeof RUNTIME_PHASES)[number];

export const CONTROL_COMMANDS = ['VALIDATE', 'START', 'PAUSE', 'RESUME', 'STOP', 'RESTART'] as const;
export type ControlCommand = (typeof CONTROL_COMMANDS)[number];

export function isRunMode(value: unknown): value is RunMode {
  return typeof value === 'string' && (RUN_MODES as readonly string[]).includes(value);
}
export function isDesiredRuntimeState(value: unknown): value is DesiredRuntimeState {
  return typeof value === 'string' && (DESIRED_RUNTIME_STATES as readonly string[]).includes(value);
}
export function isRuntimePhase(value: unknown): value is RuntimePhase {
  return typeof value === 'string' && (RUNTIME_PHASES as readonly string[]).includes(value);
}
export function isControlCommand(value: unknown): value is ControlCommand {
  return typeof value === 'string' && (CONTROL_COMMANDS as readonly string[]).includes(value);
}

// ---------- phase transition law ----------

/**
 * The only legal phase transitions. Anything not listed is a contract
 * violation the supervisor must surface as a failure, never perform.
 * Notes:
 *   - START always passes through VALIDATING/STARTING; STOPPED never jumps
 *     straight to RUNNING.
 *   - FAILED/BLOCKED are re-enterable through validation or stop; restart
 *     evidence retention is a Lane A obligation, not erased by this map.
 */
export const RUNTIME_PHASE_TRANSITIONS: Readonly<Record<RuntimePhase, readonly RuntimePhase[]>> =
  Object.freeze({
    STOPPED: Object.freeze(['VALIDATING', 'STARTING'] as const),
    VALIDATING: Object.freeze(['STOPPED', 'STARTING', 'BLOCKED', 'FAILED'] as const),
    STARTING: Object.freeze(['RUNNING', 'DEGRADED', 'BLOCKED', 'FAILED', 'STOPPING'] as const),
    RUNNING: Object.freeze(['DEGRADED', 'PAUSING', 'STOPPING', 'BLOCKED', 'FAILED'] as const),
    DEGRADED: Object.freeze(['RUNNING', 'PAUSING', 'STOPPING', 'BLOCKED', 'FAILED'] as const),
    PAUSING: Object.freeze(['PAUSED', 'STOPPING', 'FAILED'] as const),
    PAUSED: Object.freeze(['RUNNING', 'DEGRADED', 'STOPPING', 'FAILED'] as const),
    STOPPING: Object.freeze(['STOPPED', 'FAILED'] as const),
    BLOCKED: Object.freeze(['VALIDATING', 'STOPPING', 'STOPPED', 'FAILED'] as const),
    FAILED: Object.freeze(['VALIDATING', 'STOPPING', 'STOPPED'] as const),
  });

/**
 * True when `from -> to` is a legal transition. Throws TypeError on unknown
 * phase names — an invalid variant must fail loudly, not read as "illegal
 * but plausible".
 */
export function canTransitionPhase(from: RuntimePhase, to: RuntimePhase): boolean {
  if (!isRuntimePhase(from)) throw new TypeError(`canTransitionPhase: invalid from-phase ${JSON.stringify(from)}`);
  if (!isRuntimePhase(to)) throw new TypeError(`canTransitionPhase: invalid to-phase ${JSON.stringify(to)}`);
  return RUNTIME_PHASE_TRANSITIONS[from].includes(to);
}

// ---------- status snapshot shapes (compile targets for later lanes) ----------

export const PREFLIGHT_GATE_STATUSES = ['PASS', 'FAIL', 'SKIPPED', 'TIMEOUT'] as const;
export type PreflightGateStatus = (typeof PREFLIGHT_GATE_STATUSES)[number];

export function isPreflightGateStatus(value: unknown): value is PreflightGateStatus {
  return typeof value === 'string' && (PREFLIGHT_GATE_STATUSES as readonly string[]).includes(value);
}

export interface PreflightGateResult {
  /** Gate name, e.g. 'config', 'marketData', 'borrowTruth'. */
  gate: string;
  status: PreflightGateStatus;
  /** True when a non-PASS outcome blocks startup. */
  blocking: boolean;
  detail: string;
  /** Injected-clock time the gate finished; null when SKIPPED. */
  checkedAt: number | null;
}

export interface ComponentStatusSnapshot {
  name: string;
  phase: RuntimePhase;
  /** Fatal-if-failed components mark themselves required. */
  required: boolean;
  /** Authority of the component's primary data source right now. */
  authority: DataAuthority;
  heartbeatAt: number | null;
  lastError: StructuredFailure | null;
}

/** The frozen supervisor status shape (sprint directive section 9). */
export interface RuntimeStatusSnapshot {
  /** Monotonic state revision (concurrent-command protection). */
  revision: number;
  /** Startup generation counter (bumped per (re)start). */
  generation: number;
  runMode: RunMode;
  desiredState: DesiredRuntimeState;
  phase: RuntimePhase;
  /** Correlation ID of the command currently being processed; null if idle. */
  commandCorrelationId: string | null;
  startedAt: number | null;
  lastTransitionAt: number | null;
  heartbeatAt: number | null;
  /** Name of the preflight gate we are blocked at; null when not blocked. */
  blockedAtGate: string | null;
  components: readonly ComponentStatusSnapshot[];
  preflight: readonly PreflightGateResult[];
  lastError: StructuredFailure | null;
}

// ---------- EXECUTION_LIVE hard block ----------

export const LIVE_EXECUTION_BLOCK_CODE = 'LIVE_EXECUTION_NOT_IMPLEMENTED';

/**
 * Classify a synchronous-port result as thenable and attach a same-turn
 * rejection handler. Callers must reject a true result as malformed even when
 * the object is decorated with otherwise valid-looking contract fields.
 * Property access and invocation are each guarded so a hostile thenable cannot
 * throw through the observing boundary. A custom `then` property is read at
 * most once; direct invocation avoids a second accessor/Promise.resolve read.
 * Invocation results are observed through a bounded, cycle-safe walk because
 * a hostile async `then` can itself return a rejected Promise.
 */
const MAX_RETURNED_THENABLE_DEPTH = 8;
const ignoreThenResolution = (): undefined => undefined;

function observeRejectedThenableAtDepth(
  value: unknown,
  seen: Set<object>,
  depth: number,
): boolean {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false;
  const objectValue = value as object;
  if (seen.has(objectValue)) return true;
  seen.add(objectValue);

  // Native promises can have a hostile own `then` surface. The intrinsic call
  // observes their internal state without consulting that property.
  try {
    Reflect.apply(Promise.prototype.then, value, [ignoreThenResolution, ignoreThenResolution]);
    return true;
  } catch {
    // Not a native Promise (or an unsuppressible hostile SpeciesConstructor).
  }
  if (depth > MAX_RETURNED_THENABLE_DEPTH) return true;

  let then: unknown;
  try {
    then = Reflect.get(objectValue, 'then');
  } catch {
    return true;
  }
  if (typeof then !== 'function') return false;
  let returned: unknown;
  try {
    returned = Reflect.apply(then, value, [ignoreThenResolution, ignoreThenResolution]);
  } catch {
    // Invocation failure is still a malformed thenable, never a thrown port.
    return true;
  }
  if (returned !== value) {
    observeRejectedThenableAtDepth(returned, seen, depth + 1);
  }
  return true;
}

export function observeRejectedThenable(value: unknown): boolean {
  return observeRejectedThenableAtDepth(value, new Set(), 0);
}

export interface RunModeCheckContext {
  /** From the caller's injected clock. */
  nowMs: number;
  correlationId: string;
}

/**
 * Gate a requested run mode. Deterministic:
 *   - INTELLIGENCE / EXECUTION_VALIDATE_ONLY => ok.
 *   - EXECUTION_LIVE => StructuredFailure LIVE_EXECUTION_NOT_IMPLEMENTED
 *     (not retryable — live execution stays blocked until a future,
 *     separately-audited lane implements and unlocks it).
 *   - anything else => StructuredFailure INVALID_RUN_MODE.
 */
export function checkRunModePermitted(
  mode: unknown,
  ctx: RunModeCheckContext,
): ContractResult<RunMode> {
  if (!isValidUtcMillis(ctx.nowMs)) {
    throw new TypeError('checkRunModePermitted: ctx.nowMs must be a valid UTC ms from an injected clock');
  }
  if (typeof ctx.correlationId !== 'string' || ctx.correlationId.length === 0) {
    throw new TypeError('checkRunModePermitted: ctx.correlationId must be a non-empty string');
  }
  if (!isRunMode(mode)) {
    return fail(
      createStructuredFailure({
        component: 'foundation.contracts.runtime',
        stage: 'checkRunModePermitted',
        code: 'INVALID_RUN_MODE',
        message: `run mode ${JSON.stringify(mode)} is not a known RunMode`,
        occurredAt: ctx.nowMs,
        retryable: false,
        safeCurrentState: 'UNCHANGED',
        recommendedOperatorAction: 'Use INTELLIGENCE or EXECUTION_VALIDATE_ONLY.',
        correlationId: ctx.correlationId,
      }),
    );
  }
  if (mode === 'EXECUTION_LIVE') {
    return fail(
      createStructuredFailure({
        component: 'foundation.contracts.runtime',
        stage: 'checkRunModePermitted',
        code: LIVE_EXECUTION_BLOCK_CODE,
        message: 'EXECUTION_LIVE is explicitly blocked: live execution is not implemented in this build.',
        occurredAt: ctx.nowMs,
        retryable: false,
        safeCurrentState: 'UNCHANGED',
        recommendedOperatorAction:
          'Run INTELLIGENCE or EXECUTION_VALIDATE_ONLY. Live execution requires a future audited release.',
        correlationId: ctx.correlationId,
      }),
    );
  }
  return ok(mode);
}

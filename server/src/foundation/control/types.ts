/**
 * Lane A — Engine Control Plane: lane-local types (dormant module).
 *
 * The supervisor is a deterministic state machine over injected
 * `ManagedComponent` ports and `PreflightGate` chains. Nothing in this lane
 * reads a wall clock, an environment variable, a file, or a socket: every
 * time value arrives as an explicit `nowMs` from the caller's injected
 * clock, and every external fact arrives through the injected
 * `ControlEnvironment` provider or a component probe.
 *
 * Port laws (what an adapter wrapping a real engine must honor when this
 * module is wired in a future integration pass):
 *   - `validate`/`start`/`stop` are POLL-STYLE: the supervisor re-invokes
 *     the same step once per tick while it reports PENDING, so the port
 *     must be idempotent per step. Deadlines are computed against the
 *     injected clock (`nowMs + timeout`), never against real timers.
 *   - `probe` reports the component's primary source as a contracts
 *     `SourcedTimestamp` (or `null` when genuinely unknown — never a
 *     fabricated time). The supervisor judges freshness with the frozen
 *     `evaluateFreshness` law and downgrades authority accordingly.
 *   - A port never throws for operational failure; it returns
 *     `{ kind: 'FAILED', failure }`. A throw is treated as evidence of a
 *     defective port and surfaced as `*_THREW`.
 *
 * Pure module: types and frozen constants only; no import-time side effects.
 */
import type {
  ContractResult,
  ControlCommand,
  DataAuthority,
  RunMode,
  RuntimePhase,
  SourcedTimestamp,
  StructuredFailure,
} from '../contracts/index.js';

// ---------- component port ----------

export interface ComponentStepContext {
  /** UTC ms from the caller's injected clock. */
  nowMs: number;
  /** Startup generation this step belongs to. */
  generation: number;
  /** Correlation ID of the command (or runtime health pass) driving the step. */
  correlationId: string;
  runMode: RunMode;
  /**
   * Whether private credentials are available. `null` means the injected
   * environment provider itself is unavailable; it is never coerced to a
   * fabricated false value.
   */
  privateKeysAvailable: boolean | null;
}

export type ComponentStepOutcome =
  | { readonly kind: 'COMPLETE'; readonly detail?: string }
  | { readonly kind: 'PENDING'; readonly detail?: string }
  | { readonly kind: 'FAILED'; readonly failure: StructuredFailure };

export interface ComponentProbe {
  /** Component's last observed activity time (injected clock), or null. */
  heartbeatAt: number | null;
  /**
   * Primary-source timestamp for freshness judgment; null when the
   * component has no source fact yet (=> authority UNAVAILABLE, never
   * fabricated).
   */
  timestamp: SourcedTimestamp | null;
  /** Fatal evidence; non-null means the component is dead, not degraded. */
  fatal: StructuredFailure | null;
}

export interface ManagedComponent {
  /** Unique component name, e.g. 'marketData'. */
  readonly name: string;
  /** Required components make the whole runtime FAIL when fatally broken. */
  readonly required: boolean;
  /** Names of components that must be started before this one. */
  readonly dependsOn: readonly string[];
  /** True when the component cannot run without private API credentials. */
  readonly requiresPrivateKeys?: boolean;
  /** True when starting this component increases market risk (kill-switch relevant). */
  readonly riskIncreasing?: boolean;
  /**
   * True when this component represents a borrow-dependent action. When
   * borrow truth is absent the supervisor excludes this component (and its
   * transitive dependants) instead of poisoning unrelated intelligence.
   */
  readonly requiresBorrowTruth?: boolean;
  /** Per-component step timeout override (ms against the injected clock). */
  readonly stepTimeoutMs?: number;
  validate(ctx: ComponentStepContext): ComponentStepOutcome;
  start(ctx: ComponentStepContext): ComponentStepOutcome;
  stop(ctx: ComponentStepContext): ComponentStepOutcome;
  probe(ctx: ComponentStepContext): ComponentProbe;
}

// ---------- preflight gate port ----------

export interface PreflightGateContext extends ComponentStepContext {
  killSwitchEngaged: boolean;
  borrowTruthPresent: boolean;
}

export type PreflightGateOutcome =
  | { readonly status: 'PASS'; readonly detail?: string }
  | {
      readonly status: 'FAIL';
      readonly detail: string;
      /** Optional precise evidence; synthesized from detail when absent. */
      readonly failure?: StructuredFailure;
    }
  | { readonly status: 'PENDING'; readonly detail?: string };

export interface PreflightGate {
  /** Unique gate name; 'runMode' / 'killSwitch' / 'privateKeys' are reserved built-ins. */
  readonly gate: string;
  /** A non-PASS outcome on a blocking gate stops the chain (later gates SKIPPED). */
  readonly blocking: boolean;
  /**
   * Borrow-dependent gates are failed with BORROW_TRUTH_UNAVAILABLE (without
   * running) when borrow truth is missing; all other gates run normally.
   */
  readonly borrowDependent?: boolean;
  /** Per-gate timeout override (ms against the injected clock). */
  readonly timeoutMs?: number;
  run(ctx: PreflightGateContext): PreflightGateOutcome;
}

// ---------- injected environment ----------

/**
 * Facts the supervisor cannot own: sampled once per start/validate attempt
 * (deterministic attempt), and freshly per health tick. All values injected;
 * never read from process env.
 */
export interface ControlEnvironment {
  privateKeysAvailable: boolean;
  killSwitchEngaged: boolean;
  /** False when the read-only borrow truth source is missing/unknown. */
  borrowTruthPresent: boolean;
}

// ---------- supervisor configuration / dependencies ----------

export interface SupervisorConfig {
  /** State scope for derived IDs, e.g. 'controlPlane.runtime'. */
  scope: string;
  runMode: RunMode;
  /** Default per-gate timeout (ms against the injected clock). */
  defaultGateTimeoutMs: number;
  /** Default per-component step timeout (ms against the injected clock). */
  defaultComponentTimeoutMs: number;
}

export interface SupervisorDeps {
  components: readonly ManagedComponent[];
  gates: readonly PreflightGate[];
  readEnvironment: () => ControlEnvironment;
}

// ---------- commands ----------

export interface ControlCommandRequest {
  command: ControlCommand;
  /** Issuer-supplied monotonic command revision (stale/duplicate protection). */
  revision: number;
  /** UTC ms from the caller's injected clock. */
  nowMs: number;
}

export interface CommandReceipt {
  commandId: string;
  correlationId: string;
  command: ControlCommand;
  revision: number;
  /** False when the command was an idempotent no-op. */
  applied: boolean;
  detail: string;
}

/** Operational command failures travel as values, never thrown strings. */
export type CommandResult = ContractResult<Readonly<CommandReceipt>>;

// ---------- evidence ----------

export interface FailureEvidence {
  /** Startup generation during which the failure occurred. */
  generation: number;
  failure: StructuredFailure;
}

export interface PhaseTransitionRecord {
  from: RuntimePhase;
  to: RuntimePhase;
  atMs: number;
  correlationId: string | null;
}

/** Snapshot-adjacent view of a component's exclusion (keyless intelligence). */
export interface ComponentExclusion {
  name: string;
  reason: string;
}

// ---------- failure codes owned by this lane ----------

export const CONTROL_FAILURE_CODES = Object.freeze({
  STALE_COMMAND_REVISION: 'STALE_COMMAND_REVISION',
  COMMAND_REVISION_REUSED: 'COMMAND_REVISION_REUSED',
  COMMAND_IN_PROGRESS: 'COMMAND_IN_PROGRESS',
  COMMAND_NOT_APPLICABLE: 'COMMAND_NOT_APPLICABLE',
  ENVIRONMENT_READ_THREW: 'ENVIRONMENT_READ_THREW',
  ENVIRONMENT_INVALID: 'ENVIRONMENT_INVALID',
  ENVIRONMENT_UNAVAILABLE: 'ENVIRONMENT_UNAVAILABLE',
  NO_ELIGIBLE_COMPONENTS: 'NO_ELIGIBLE_COMPONENTS',
  PREFLIGHT_GATE_FAILED: 'PREFLIGHT_GATE_FAILED',
  PREFLIGHT_GATE_TIMEOUT: 'PREFLIGHT_GATE_TIMEOUT',
  PREFLIGHT_GATE_THREW: 'PREFLIGHT_GATE_THREW',
  BORROW_TRUTH_UNAVAILABLE: 'BORROW_TRUTH_UNAVAILABLE',
  KILL_SWITCH_ENGAGED: 'KILL_SWITCH_ENGAGED',
  MISSING_PRIVATE_KEYS: 'MISSING_PRIVATE_KEYS',
  COMPONENT_VALIDATE_FAILED: 'COMPONENT_VALIDATE_FAILED',
  COMPONENT_VALIDATE_THREW: 'COMPONENT_VALIDATE_THREW',
  COMPONENT_VALIDATE_TIMEOUT: 'COMPONENT_VALIDATE_TIMEOUT',
  COMPONENT_START_FAILED: 'COMPONENT_START_FAILED',
  COMPONENT_START_THREW: 'COMPONENT_START_THREW',
  COMPONENT_START_TIMEOUT: 'COMPONENT_START_TIMEOUT',
  COMPONENT_STOP_FAILED: 'COMPONENT_STOP_FAILED',
  COMPONENT_STOP_THREW: 'COMPONENT_STOP_THREW',
  COMPONENT_STOP_TIMEOUT: 'COMPONENT_STOP_TIMEOUT',
  ROLLBACK_STOP_FAILED: 'ROLLBACK_STOP_FAILED',
  REQUIRED_SOURCE_STALE: 'REQUIRED_SOURCE_STALE',
  COMPONENT_SOURCE_STALE: 'COMPONENT_SOURCE_STALE',
  COMPONENT_DEPENDENCY_UNAVAILABLE: 'COMPONENT_DEPENDENCY_UNAVAILABLE',
  COMPONENT_PROBE_THREW: 'COMPONENT_PROBE_THREW',
  COMPONENT_CONTRACT_VIOLATION: 'COMPONENT_CONTRACT_VIOLATION',
} as const);

export type ControlFailureCode =
  (typeof CONTROL_FAILURE_CODES)[keyof typeof CONTROL_FAILURE_CODES];

/** Reserved built-in gate names (always the head of every preflight chain). */
export const BUILTIN_GATE_NAMES = Object.freeze([
  'runMode',
  'killSwitch',
  'privateKeys',
  'componentEligibility',
] as const);

// re-exported for convenience in adapters/tests
export type { DataAuthority, RuntimePhase };

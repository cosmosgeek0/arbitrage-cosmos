import type {
  SystemControlState,
  SystemDependencyEdge,
  SystemFocusPinReadback,
  SystemSupervisorSnapshot,
  SystemTraceEvent,
  SystemTraceSnapshot,
} from '../contracts/types.js';
import type { SystemControlService } from '../controls/service.js';
import type { CanonicalSupervisorOpsReadPort } from '../ops/types.js';
import type {
  ValidateOnlyOrchestratorInput,
  ValidateOnlyRunResult,
} from '../verticalSlice/types.js';
import type {
  M0SpotSourceMountPort,
} from '../../foundation/execution/m0SpotSourceMount.js';
import type {
  M0SpotRuntimeBoundaryPort,
} from '../production/m0SpotRuntimeBoundary.js';

export interface SystemIntegrationEventQuery {
  readonly limit: number;
  readonly beforeId?: string;
  readonly afterId?: string;
}

export interface SystemIntegrationEventPage {
  readonly items: readonly Readonly<SystemTraceEvent>[];
  readonly nextBeforeId: string | null;
  readonly nextAfterId: string | null;
}

/** Read-only by construction: refresh/start/probe/network methods are absent. */
export interface SystemIntegrationReadPort {
  supervisor(): Readonly<SystemSupervisorSnapshot> | Promise<Readonly<SystemSupervisorSnapshot>>;
  graph():
    | Readonly<{
        revision: number;
        evaluatedAtMs: number;
        edges: readonly Readonly<SystemDependencyEdge>[];
      }>
    | Promise<Readonly<{
        revision: number;
        evaluatedAtMs: number;
        edges: readonly Readonly<SystemDependencyEdge>[];
      }>>;
  events(query: Readonly<SystemIntegrationEventQuery>):
    | Readonly<SystemIntegrationEventPage>
    | Promise<Readonly<SystemIntegrationEventPage>>;
  controls(): Readonly<SystemControlState> | Promise<Readonly<SystemControlState>>;
  focusPin(symbol: string): Readonly<SystemFocusPinReadback> | Promise<Readonly<SystemFocusPinReadback>>;
  trace(correlationId: string):
    | Readonly<SystemTraceSnapshot>
    | null
    | Promise<Readonly<SystemTraceSnapshot> | null>;
}

export interface SystemIntegrationRouteClock {
  nowMs(): number;
}

export interface SystemIntegrationValidateOnlyPort {
  executeValidateOnly(
    input: Readonly<ValidateOnlyOrchestratorInput>,
  ): Promise<Readonly<ValidateOnlyRunResult>>;
}

export interface SystemIntegrationRouterOptions {
  readonly read: SystemIntegrationReadPort;
  readonly controls: SystemControlService;
  readonly validateOnly: SystemIntegrationValidateOnlyPort;
  readonly m0SpotCanary: M0SpotSourceMountPort;
  readonly m0SpotRuntime: M0SpotRuntimeBoundaryPort;
  readonly clock: SystemIntegrationRouteClock;
  readonly opsReadback: CanonicalSupervisorOpsReadPort;
}

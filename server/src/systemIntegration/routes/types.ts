import type {
  SystemControlState,
  SystemDependencyEdge,
  SystemSupervisorSnapshot,
  SystemTraceEvent,
  SystemTraceSnapshot,
} from '../contracts/types.js';
import type { SystemControlService } from '../controls/service.js';
import type { CanonicalSupervisorOpsReadPort } from '../ops/types.js';

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
  trace(correlationId: string):
    | Readonly<SystemTraceSnapshot>
    | null
    | Promise<Readonly<SystemTraceSnapshot> | null>;
}

export interface SystemIntegrationRouteClock {
  nowMs(): number;
}

export interface SystemIntegrationRouterOptions {
  readonly read: SystemIntegrationReadPort;
  readonly controls: SystemControlService;
  readonly clock: SystemIntegrationRouteClock;
  readonly opsReadback: CanonicalSupervisorOpsReadPort;
}

import type {
  SystemControlState,
  SystemDependencyEdge,
  SystemFocusPinReadback,
  SystemSupervisorSnapshot,
  SystemTraceEvent,
  SystemTraceSnapshot,
} from '../contracts/types.js';
import type { SystemControlService } from '../controls/service.js';
import type { SystemControlActor } from '../controls/types.js';
import type { CanonicalSupervisorOpsReadPort } from '../ops/types.js';
import type { SpotTransportCoordinatorResult } from '../../foundation/execution/spotTransportCoordinator.js';
import type { M0AutomaticReceipt } from '../evidence/m0AutomaticReceipt.js';
import type {
  ValidateOnlyOrchestratorInput,
  ValidateOnlyRunResult,
} from '../verticalSlice/types.js';

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

export const M0_SPOT_CANARY_ROUTE_SCHEMA =
  'cosmos.system-integration.m0-spot-canary-route.v1' as const;

export interface M0SpotCanarySourceMountInput {
  readonly requestId: `m0_req_${string}`;
  readonly ownerConfirmation: 'YES';
  readonly operator: Readonly<SystemControlActor>;
}

export interface M0SpotCanarySourceMountResult {
  readonly schema: typeof M0_SPOT_CANARY_ROUTE_SCHEMA;
  readonly ok: false;
  readonly code: 'M0_SOURCE_MOUNT_BLOCKED';
  readonly state: 'SOURCE_MOUNTED_NOT_ACTIVATED';
  readonly sourceMounted: true;
  readonly runtimeActivated: false;
  readonly hostProvisioned: false;
  readonly liveExecutionPermitted: false;
  readonly maximumOrderNotionalQuote: '10';
  readonly ownerConfirmation: 'ACKNOWLEDGED_NOT_AUTHORITY';
  readonly ticketAuthority: 'NONE';
  readonly authorityConsumption: 'NOT_ATTEMPTED';
  readonly executionKeyPermissions: 'NOT_PROVED';
  readonly signedTransport: 'HARD_DENY_NOT_CONFIGURED';
  readonly withdrawalPolicy: 'DISABLED';
  readonly transferPolicy: 'DISABLED';
  readonly flat: 'NOT_PROVED';
  readonly reconciliation: 'NOT_PROVED';
  readonly disarm: 'NOT_PROVED';
  readonly coordinator: Readonly<SpotTransportCoordinatorResult>;
  /** Validate-only evidence receipt; never a live/runtime success receipt. */
  readonly inertEvidenceReceipt: Readonly<M0AutomaticReceipt>;
}

export interface M0SpotCanarySourceMountPort {
  inspectSourceMount(
    input: Readonly<M0SpotCanarySourceMountInput>,
  ): Promise<Readonly<M0SpotCanarySourceMountResult>>;
}

export interface SystemIntegrationRouterOptions {
  readonly read: SystemIntegrationReadPort;
  readonly controls: SystemControlService;
  readonly validateOnly: SystemIntegrationValidateOnlyPort;
  readonly m0SpotCanary: M0SpotCanarySourceMountPort;
  readonly clock: SystemIntegrationRouteClock;
  readonly opsReadback: CanonicalSupervisorOpsReadPort;
}

import type {
  DesiredRuntimeState,
  SystemComponentId,
  SystemControlCommand,
  SystemControlMutation,
  SystemControlMutationReceipt,
  SystemControlMutationRequest,
  SystemControlState,
} from '../contracts/index.js';

/** Server-derived operator identity. Request bodies never supply this value. */
export interface SystemControlActor {
  readonly id: string;
  readonly email: string | null;
  readonly source: 'loopback' | 'cloudflare-access';
}

export interface SystemControlCompositionDecision {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  /** Whether the domain-side mutation would change anything. */
  readonly applied: boolean;
  /** True only when this mutation can add or increase exposure. */
  readonly riskIncreasing: boolean;
}

/**
 * Narrow composition seam. Inspection is read-only; publication happens only
 * after the persistence port has durably committed the exact receipt.
 */
export interface SystemControlCompositionPort {
  inspectMutation(
    mutation: Readonly<SystemControlMutation>,
    control: Readonly<SystemControlState>,
  ): SystemControlCompositionDecision | Promise<SystemControlCompositionDecision>;
  publishCommitted(
    request: Readonly<SystemControlMutationRequest>,
    actor: Readonly<SystemControlActor>,
    receipt: Readonly<SystemControlMutationReceipt>,
  ): void | Promise<void>;
  inspectCommittedPublication?(
    request: Readonly<SystemControlMutationRequest>,
    receipt: Readonly<SystemControlMutationReceipt>,
  ): SystemControlRuntimeEffectReadback | Promise<SystemControlRuntimeEffectReadback>;
}

export interface SystemControlPersistenceCommit {
  readonly request: Readonly<SystemControlMutationRequest>;
  readonly actor: Readonly<SystemControlActor>;
  readonly requestDigest: string;
  readonly before: Readonly<SystemControlState>;
  readonly after: Readonly<SystemControlState>;
  readonly applied: boolean;
  readonly code: string;
}

export type SystemControlRuntimePublicationState = 'NOT_REQUIRED' | 'PENDING' | 'PUBLISHED' | 'UNKNOWN';
export type SystemControlRuntimeEffectReadback = 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN';

export interface SystemControlRuntimePublicationCommit {
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly correlationId: string;
  readonly occurredAtMs: number;
}

export type SystemControlRuntimePublicationResult =
  | { readonly kind: 'PUBLISHED' }
  | { readonly kind: 'IDEMPOTENT_REPLAY' };

/** Redacted, bounded evidence for a rejected control. No raw request body. */
export interface SystemControlRejectionAudit {
  readonly dedupeKey: string;
  readonly idempotencyKey: string | null;
  readonly requestDigest: string;
  readonly command: string | null;
  readonly expectedRevision: number | null;
  readonly currentRevision: number;
  readonly code: string;
  readonly message: string;
  readonly correlationId: string;
  readonly occurredAtMs: number;
  readonly actor: Readonly<SystemControlActor>;
  readonly applied: false;
}

export type SystemControlRejectionPersistenceResult =
  | { readonly kind: 'RECORDED'; readonly ledgerEventId: number }
  | { readonly kind: 'IDEMPOTENT_REPLAY'; readonly ledgerEventId: number };

export interface SystemControlRouteRejection {
  readonly idempotencyKey: string | null;
  readonly expectedRevision: number | null;
  readonly command: string | null;
  readonly requestedAtMs: number;
  readonly correlationId: string;
  readonly code: string;
  readonly message: string;
}

export type SystemControlPersistenceResult =
  | {
      readonly kind: 'COMMITTED';
      readonly receipt: Readonly<SystemControlMutationReceipt>;
      readonly runtimePublication: SystemControlRuntimePublicationState;
    }
  | {
      readonly kind: 'IDEMPOTENT_REPLAY';
      readonly requestDigest: string;
      readonly receipt: Readonly<SystemControlMutationReceipt>;
      readonly runtimePublication: SystemControlRuntimePublicationState;
    }
  | {
      readonly kind: 'IDEMPOTENCY_CONFLICT';
      readonly requestDigest: string;
    }
  | {
      readonly kind: 'REVISION_CONFLICT';
      readonly current: Readonly<SystemControlState>;
    };

/** The adapter must enforce revision/idempotency atomically in one store. */
export interface SystemControlPersistencePort {
  findControlMutation(idempotencyKey: string): Promise<Readonly<{
    requestDigest: string;
    correlationId: string;
    recordedAtMs: number;
    mutation: Readonly<SystemControlMutation> | null;
    receipt: Readonly<SystemControlMutationReceipt>;
    runtimePublication: SystemControlRuntimePublicationState;
  }> | null>;
  recordControlRejection(
    audit: Readonly<SystemControlRejectionAudit>,
  ): Promise<SystemControlRejectionPersistenceResult>;
  commitControlMutation(
    commit: Readonly<SystemControlPersistenceCommit>,
  ): Promise<SystemControlPersistenceResult>;
  markControlRuntimePublished?(
    commit: Readonly<SystemControlRuntimePublicationCommit>,
  ): Promise<SystemControlRuntimePublicationResult>;
}

export interface SystemControlServiceOptions {
  readonly initialState: Readonly<SystemControlState>;
  readonly persistence: SystemControlPersistencePort;
  readonly composition: SystemControlCompositionPort;
}

export interface ParsedControlBodyBase {
  readonly command: SystemControlCommand;
  readonly expectedRevision: number;
  readonly reason: string;
}

export interface SystemControlComponentDescriptor {
  readonly componentId: SystemComponentId;
  readonly desiredState: DesiredRuntimeState;
  readonly supportedControls: readonly SystemControlCommand[];
  readonly riskIncreasing: boolean;
}

export const SYSTEM_CONTROL_FAILURE_CODES = Object.freeze({
  INVALID_CONTROL_REQUEST: 'INVALID_CONTROL_REQUEST',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_INVALID: 'IDEMPOTENCY_KEY_INVALID',
  IDEMPOTENCY_KEY_CONFLICT: 'IDEMPOTENCY_KEY_CONFLICT',
  STALE_COMMAND_REVISION: 'STALE_COMMAND_REVISION',
  COMMAND_REVISION_REUSED: 'COMMAND_REVISION_REUSED',
  COMMAND_NOT_APPLICABLE: 'COMMAND_NOT_APPLICABLE',
  KILL_SWITCH_ENGAGED: 'KILL_SWITCH_ENGAGED',
  CONTROL_PERSISTENCE_UNAVAILABLE: 'CONTROL_PERSISTENCE_UNAVAILABLE',
  CONTROL_COMMITTED_RUNTIME_PENDING: 'CONTROL_COMMITTED_RUNTIME_PENDING',
} as const);

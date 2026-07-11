import type { ContractResult } from '../../foundation/contracts/index.js';
import type {
  ActivePosition,
  CapitalEventEnvelope,
  CapitalLifecycleState,
  CapitalMandate,
  CapitalReservation,
  EconomicAttribution,
  ExternalReconciliationReference,
  OperatorApproval,
  PositionActionIntent,
  PositionThesis,
  StagedPlan,
  TruthMetadata,
} from '../contracts/index.js';
import type {
  ActivePositionId,
  CapitalCheckpointId,
  CapitalEventId,
  CapitalMandateId,
  CapitalReservationId,
  OperatorApprovalId,
  PositionThesisId,
  StagedPlanId,
} from '../contracts/identity.js';

export const CAPITAL_CHECKPOINT_SCHEMA = 'cosmos.capital.supervision.checkpoint' as const;
export const CAPITAL_CHECKPOINT_VERSION = 1 as const;
export const CAPITAL_CHECKPOINT_EVENT_SCHEMA_VERSION = 1 as const;

export const CAPITAL_CHECKPOINT_EVENT_KINDS = Object.freeze([
  'RESERVATION_UPSERTED',
  'MANDATE_UPSERTED',
  'STAGED_PLAN_UPSERTED',
  'APPROVAL_UPSERTED',
  'APPROVAL_REVOKED',
  'THESIS_UPSERTED',
  'POSITION_UPSERTED',
  'RECONCILIATION_UPSERTED',
  'ACTION_INTENT_UPSERTED',
  'ECONOMICS_UPSERTED',
  'LIFECYCLE_REVISED',
] as const);
export type CapitalCheckpointEventKind = (typeof CAPITAL_CHECKPOINT_EVENT_KINDS)[number];

export interface ApprovalRevocationRecord {
  readonly id: string;
  readonly approvalId: OperatorApprovalId;
  readonly revision: number;
  readonly revokedAtMs: number;
  readonly reasonReference: string;
}

export interface PositionEconomicsRecord {
  readonly id: string;
  readonly positionId: ActivePositionId;
  readonly revision: number;
  readonly attribution: Readonly<EconomicAttribution>;
}

export interface CapitalLifecycleRecord {
  readonly id: string;
  readonly aggregateId: string;
  readonly state: CapitalLifecycleState;
  readonly revision: number;
  readonly lastTransitionAtMs: number;
  readonly correlationId: string;
}

export type CapitalCheckpointRecord =
  | Readonly<CapitalReservation>
  | Readonly<CapitalMandate>
  | Readonly<StagedPlan>
  | Readonly<OperatorApproval>
  | Readonly<ApprovalRevocationRecord>
  | Readonly<PositionThesis>
  | Readonly<ActivePosition>
  | Readonly<ExternalReconciliationReference>
  | Readonly<PositionActionIntent>
  | Readonly<PositionEconomicsRecord>
  | Readonly<CapitalLifecycleRecord>;

export interface CapitalCheckpointEvent extends CapitalEventEnvelope {
  readonly id: CapitalEventId;
  readonly schemaVersion: typeof CAPITAL_CHECKPOINT_EVENT_SCHEMA_VERSION;
  readonly kind: CapitalCheckpointEventKind;
}

export interface CapitalCheckpointState {
  readonly streamId: string;
  readonly revision: number;
  readonly lastSequence: number;
  readonly updatedAtMs: number | null;
  readonly reservations: readonly Readonly<CapitalReservation>[];
  readonly mandates: readonly Readonly<CapitalMandate>[];
  readonly stagedPlans: readonly Readonly<StagedPlan>[];
  readonly approvals: readonly Readonly<OperatorApproval>[];
  readonly revocations: readonly Readonly<ApprovalRevocationRecord>[];
  readonly theses: readonly Readonly<PositionThesis>[];
  readonly positions: readonly Readonly<ActivePosition>[];
  readonly reconciliationReferences: readonly Readonly<ExternalReconciliationReference>[];
  readonly intents: readonly Readonly<PositionActionIntent>[];
  readonly economics: readonly Readonly<PositionEconomicsRecord>[];
  readonly lifecycles: readonly Readonly<CapitalLifecycleRecord>[];
  readonly eventLog: readonly Readonly<CapitalCheckpointEvent>[];
  readonly processedEventIds: readonly CapitalEventId[];
}

export interface CapitalCheckpoint {
  readonly schema: typeof CAPITAL_CHECKPOINT_SCHEMA;
  readonly version: typeof CAPITAL_CHECKPOINT_VERSION;
  readonly id: CapitalCheckpointId;
  readonly streamId: string;
  readonly revision: number;
  readonly state: Readonly<CapitalCheckpointState>;
  readonly checksum: string;
}

export interface RestartTruthInput {
  readonly nowMs: number;
  readonly correlationId: string;
  readonly accountTruth: Readonly<TruthMetadata> | null;
  readonly reconciliationTruth: Readonly<TruthMetadata> | null;
  readonly reconciliationReferences: readonly Readonly<ExternalReconciliationReference>[];
}

export interface RestartSafetyProjection {
  readonly evaluatedAtMs: number;
  readonly canOpenOrIncrease: boolean;
  readonly supervisionContinues: boolean;
  readonly reasonCodes: readonly string[];
  readonly visiblePositionIds: readonly ActivePositionId[];
  readonly recoveryRequiredPositionIds: readonly ActivePositionId[];
  readonly usableApprovalIds: readonly OperatorApprovalId[];
  readonly effectiveActiveReservationIds: readonly CapitalReservationId[];
  readonly effectiveExpiredReservationIds: readonly CapitalReservationId[];
  readonly blockedRiskIncreasingIntentIds: readonly string[];
  readonly allowedRiskReducingOrNeutralIntentIds: readonly string[];
}

export interface RestoredCapitalProjection {
  readonly checkpointId: CapitalCheckpointId;
  readonly checkpointState: Readonly<CapitalCheckpointState>;
  readonly effectiveReservations: readonly Readonly<CapitalReservation>[];
  readonly effectivePositions: readonly Readonly<ActivePosition>[];
  readonly safety: Readonly<RestartSafetyProjection>;
}

export interface CreateCapitalCheckpointEventInput {
  readonly streamId: string;
  readonly sequence: number;
  readonly kind: CapitalCheckpointEventKind;
  readonly occurredAtMs: number;
  readonly correlationId: string;
  readonly record: CapitalCheckpointRecord;
}

export interface RestoreCapitalCheckpointInput extends RestartTruthInput {
  readonly serialized: string;
}

export type CapitalCheckpointResult<T> = ContractResult<Readonly<T>>;

export type CheckpointRecordIdentity =
  | CapitalReservationId
  | CapitalMandateId
  | StagedPlanId
  | OperatorApprovalId
  | PositionThesisId
  | ActivePositionId
  | string;

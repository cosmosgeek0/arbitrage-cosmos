import {
  canonicalJson,
  deriveConfigVersionId,
  deriveCorrelationId,
  stableHash128Hex,
  type ConfigVersionId,
  type CorrelationId,
} from '../../foundation/contracts/index.js';

declare const CAPITAL_ID: unique symbol;

type CapitalId<Name extends string> = string & {
  readonly [CAPITAL_ID]: Name;
};

export type StrategyProposalId = CapitalId<'StrategyProposalId'>;
export type EvidencePacketId = CapitalId<'EvidencePacketId'>;
export type OpportunityConsiderationId = CapitalId<'OpportunityConsiderationId'>;
export type CapitalMandateId = CapitalId<'CapitalMandateId'>;
export type AllocationDecisionId = CapitalId<'AllocationDecisionId'>;
export type CapitalReservationId = CapitalId<'CapitalReservationId'>;
export type StagedPlanId = CapitalId<'StagedPlanId'>;
export type OperatorApprovalId = CapitalId<'OperatorApprovalId'>;
export type PositionThesisId = CapitalId<'PositionThesisId'>;
export type ActivePositionId = CapitalId<'ActivePositionId'>;
export type ActionIntentId = CapitalId<'ActionIntentId'>;
export type ExecutionCorrelationReferenceId = CapitalId<'ExecutionCorrelationReferenceId'>;
export type ReconciliationReferenceId = CapitalId<'ReconciliationReferenceId'>;
export type CapitalCheckpointId = CapitalId<'CapitalCheckpointId'>;
export type CapitalEventId = CapitalId<'CapitalEventId'>;
export type ConfigRevisionId = ConfigVersionId;

export const CAPITAL_ID_PREFIXES = Object.freeze({
  opportunityConsideration: 'cop',
  capitalMandate: 'cmdt',
  allocationDecision: 'calloc',
  capitalReservation: 'cres',
  stagedPlan: 'cstage',
  operatorApproval: 'cappr',
  positionThesis: 'cthesis',
  activePosition: 'cpos',
  actionIntent: 'cintent',
  executionCorrelationReference: 'cexec',
  reconciliationReference: 'crecon',
  checkpoint: 'cchk',
  event: 'cevt',
} as const);

function validateSuppliedIdentity(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
    throw new TypeError(`${label} must be a non-empty string (<=256 characters)`);
  }
  return value;
}

export function asStrategyProposalId(value: unknown): StrategyProposalId {
  return validateSuppliedIdentity(value, 'strategy proposal ID') as StrategyProposalId;
}

export function asEvidencePacketId(value: unknown): EvidencePacketId {
  return validateSuppliedIdentity(value, 'evidence packet ID') as EvidencePacketId;
}

function deriveId<Name extends string>(prefix: string, namespace: string, semanticInput: unknown): CapitalId<Name> {
  const canonical = canonicalJson({ namespace, semanticInput });
  return `${prefix}_${stableHash128Hex(canonical)}` as CapitalId<Name>;
}

export function deriveOpportunityConsiderationId(input: unknown): OpportunityConsiderationId {
  return deriveId(CAPITAL_ID_PREFIXES.opportunityConsideration, 'capital.opportunity', input);
}

export function deriveCapitalMandateId(input: unknown): CapitalMandateId {
  return deriveId(CAPITAL_ID_PREFIXES.capitalMandate, 'capital.mandate', input);
}

export function deriveAllocationDecisionId(input: unknown): AllocationDecisionId {
  return deriveId(CAPITAL_ID_PREFIXES.allocationDecision, 'capital.allocation', input);
}

export function deriveCapitalReservationId(input: unknown): CapitalReservationId {
  return deriveId(CAPITAL_ID_PREFIXES.capitalReservation, 'capital.reservation', input);
}

export function deriveStagedPlanId(input: unknown): StagedPlanId {
  return deriveId(CAPITAL_ID_PREFIXES.stagedPlan, 'capital.stagedPlan', input);
}

export function deriveOperatorApprovalId(input: unknown): OperatorApprovalId {
  return deriveId(CAPITAL_ID_PREFIXES.operatorApproval, 'capital.approval', input);
}

export function derivePositionThesisId(input: unknown): PositionThesisId {
  return deriveId(CAPITAL_ID_PREFIXES.positionThesis, 'capital.positionThesis', input);
}

export function deriveActivePositionId(input: unknown): ActivePositionId {
  return deriveId(CAPITAL_ID_PREFIXES.activePosition, 'capital.activePosition', input);
}

export function deriveActionIntentId(input: unknown): ActionIntentId {
  return deriveId(CAPITAL_ID_PREFIXES.actionIntent, 'capital.actionIntent', input);
}

export function deriveExecutionCorrelationReferenceId(input: unknown): ExecutionCorrelationReferenceId {
  return deriveId(CAPITAL_ID_PREFIXES.executionCorrelationReference, 'capital.executionReference', input);
}

export function deriveReconciliationReferenceId(input: unknown): ReconciliationReferenceId {
  return deriveId(CAPITAL_ID_PREFIXES.reconciliationReference, 'capital.reconciliationReference', input);
}

export function deriveCapitalCheckpointId(input: unknown): CapitalCheckpointId {
  return deriveId(CAPITAL_ID_PREFIXES.checkpoint, 'capital.checkpoint', input);
}

export function deriveCapitalEventId(input: unknown): CapitalEventId {
  return deriveId(CAPITAL_ID_PREFIXES.event, 'capital.event', input);
}

export function deriveCapitalConfigRevision(scope: string, payload: unknown): ConfigRevisionId {
  return deriveConfigVersionId({ scope: `capital.${validateSuppliedIdentity(scope, 'config scope')}`, payload });
}

export function deriveCapitalCorrelation(origin: string, stableKey: string): CorrelationId {
  return deriveCorrelationId({
    origin: `capital.${validateSuppliedIdentity(origin, 'correlation origin')}`,
    key: validateSuppliedIdentity(stableKey, 'correlation stable key'),
  });
}

export function capitalDigest(value: unknown): string {
  return stableHash128Hex(canonicalJson(value));
}

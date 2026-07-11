import type { NonNegativeDecimal } from './decimal.js';
import type {
  CapitalMandateId,
  ConfigRevisionId,
  OperatorApprovalId,
  StagedPlanId,
  StrategyProposalId,
} from './identity.js';

export const APPROVAL_MODES = Object.freeze(['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY', 'MANUAL_ARMED'] as const);
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const APPROVAL_ACTION_CLASSES = Object.freeze(['OPEN', 'ADD', 'REDUCE', 'HEDGE', 'EXIT', 'RECOVERY'] as const);
export type ApprovalActionClass = (typeof APPROVAL_ACTION_CLASSES)[number];

export interface ApprovalStageLimit {
  readonly stage: string;
  readonly maximumExposure: NonNegativeDecimal;
}

export interface OperatorApproval {
  readonly id: OperatorApprovalId;
  readonly operatorIdentityReference: string;
  readonly proposalId: StrategyProposalId;
  readonly proposalRevision: string | null;
  readonly proposalIntakeDigest: string;
  readonly mandateId: CapitalMandateId;
  readonly mandateRevision: number;
  readonly mandateDigest: string;
  readonly stagedPlanId: StagedPlanId;
  readonly stagedPlanRevision: number;
  readonly stagedPlanDigest: string;
  readonly strategy: 'BASIS' | 'VOLUME';
  readonly symbols: readonly string[];
  readonly instruments: readonly string[];
  readonly allowedActionClasses: readonly ApprovalActionClass[];
  readonly maximumNotional: NonNegativeDecimal;
  readonly valuationAsset: string;
  readonly mode: ApprovalMode;
  readonly configRevision: ConfigRevisionId;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly revokedAtMs: number | null;
  readonly revocationReasonReference: string | null;
  readonly stageLimits: readonly Readonly<ApprovalStageLimit>[];
  readonly reasonReference: string;
  readonly useScopeKey: string;
}

export interface ApprovalValidationContext {
  readonly nowMs: number;
  readonly proposalId: StrategyProposalId;
  readonly proposalRevision: string | null;
  readonly proposalIntakeDigest: string;
  readonly mandateId: CapitalMandateId;
  readonly mandateRevision: number;
  readonly mandateDigest: string;
  readonly stagedPlanId: StagedPlanId;
  readonly stagedPlanRevision: number;
  readonly stagedPlanDigest: string;
  readonly configRevision: ConfigRevisionId;
  readonly actionClass: ApprovalActionClass;
  readonly requestedNotional: NonNegativeDecimal;
  readonly stage: string | null;
  readonly useScopeKey: string;
}

export interface ApprovalValidationResult {
  readonly allowedForExternalRiskEvaluation: boolean;
  readonly reasons: readonly string[];
  readonly approvalId: OperatorApprovalId;
  readonly validatedAtMs: number;
}

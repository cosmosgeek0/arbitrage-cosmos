import type {
  ApprovalActionClass,
  ApprovalStageLimit,
  ApprovalValidationContext,
  ApprovalValidationResult,
  ConfigurationAuthority,
  ConfigRevisionId,
  ControlPostureSnapshot,
  NonNegativeDecimal,
  OperatorApproval,
} from '../contracts/index.js';

/**
 * Caller-supplied projection of already validated policy. The digest is a
 * deterministic content address for this complete projection; it is not a
 * signature and does not establish who supplied the policy. Authenticity and
 * durable policy ownership remain future integration responsibilities.
 */
export interface ApprovalPolicyBounds {
  /**
   * Content-addressed policy authority. The revision covers every policy
   * semantic, including source identity and the complete effective window.
   * It proves deterministic content integrity, not source authenticity.
   */
  readonly authority: Readonly<ConfigurationAuthority>;
  /** Configuration revision of the proposal/plan governed by these bounds. */
  readonly configRevision: ConfigRevisionId;
  readonly strategy: 'BASIS' | 'VOLUME';
  readonly symbols: readonly string[];
  readonly instruments: readonly string[];
  readonly allowedActionClasses: readonly ApprovalActionClass[];
  readonly maximumNotional: NonNegativeDecimal;
  readonly valuationAsset: string;
  readonly stageLimits: readonly Readonly<ApprovalStageLimit>[];
}

export type ApprovalPolicyBoundsSemantics = Omit<ApprovalPolicyBounds, 'authority'> & {
  readonly authority: Omit<ConfigurationAuthority, 'revision'>;
};

export interface ScopedApprovalValidationContext extends ApprovalValidationContext {
  readonly strategy: 'BASIS' | 'VOLUME';
  readonly symbols: readonly string[];
  readonly instruments: readonly string[];
  readonly controlPosture: Readonly<ControlPostureSnapshot>;
  readonly correlationId: string;
}

export type ApprovalModeDisposition =
  | 'READ_ONLY'
  | 'ADVISORY_ONLY'
  | 'EXTERNAL_VALIDATION_ONLY'
  | 'EXTERNAL_RISK_AND_EXECUTION_REQUIRED';

/** Approval is never itself an execution verdict. */
export interface ApprovalAuthorityDecision extends ApprovalValidationResult {
  readonly actionClass: ApprovalActionClass;
  readonly mode: OperatorApproval['mode'];
  readonly disposition: ApprovalModeDisposition;
  readonly executionReady: false;
  readonly requiresExternalRiskOwner: boolean;
  readonly requiresExternalExecutionOwner: boolean;
}

export interface ApprovalUseRecord {
  readonly idempotencyKey: string;
  readonly useScopeKey: string;
  readonly contextDigest: string;
  readonly actionClass: ApprovalActionClass;
  readonly requestedNotional: NonNegativeDecimal;
  readonly recordedAtMs: number;
}

export interface OperatorApprovalState {
  readonly approval: Readonly<OperatorApproval>;
  /** Immutable digest of the validated policy projection this approval was issued against. */
  readonly sourcePolicyDigest: string;
  readonly revision: number;
  readonly uses: readonly Readonly<ApprovalUseRecord>[];
}

export type OperatorApprovalStateEvent =
  | {
      readonly kind: 'USE_RECORDED';
      readonly expectedRevision: number;
      readonly idempotencyKey: string;
      readonly context: Readonly<ApprovalValidationContext>;
      readonly recordedAtMs: number;
      readonly correlationId: string;
    }
  | {
      readonly kind: 'REVOKED';
      readonly expectedRevision: number;
      readonly revokedAtMs: number;
      readonly reasonReference: string;
      readonly correlationId: string;
    };

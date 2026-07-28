export type AiOperationsSourceConfigurationState = 'NOT_CONFIGURED' | 'UNKNOWN';
export type AiOperationsSourceMountState = 'NOT_MOUNTED' | 'UNKNOWN';
export type AiOperationsActivityKind = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'FAILED';

export interface AiOperationsSourceBlocker {
  readonly code: string;
  readonly state: string;
  readonly detail: string;
  readonly source: 'AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES';
}

/**
 * Deliberately narrow staging view. Until an owner-ratified operational
 * readback exists, this UI cannot accept mounted or non-UNKNOWN work claims.
 */
export interface AiOperationsPassiveStatusView {
  readonly schema: 'AI_OPS_PASSIVE_STATUS_PROJECTION_V1';
  readonly projectionKind: 'SOURCE_BOUND_PASSIVE_READ_ONLY';
  readonly configurationState: AiOperationsSourceConfigurationState;
  readonly mountState: AiOperationsSourceMountState;
  readonly activityState: 'UNKNOWN';
  readonly caseCounts: Readonly<Record<AiOperationsActivityKind, null>>;
  readonly operationalCases: readonly never[];
  readonly runtimeContract: Readonly<{
    readonly posture: 'SHADOW_SPECULATIVE';
    readonly operationalRuntimeEvidence: AiOperationsSourceMountState;
    readonly shadowIncidentAcceptedForOperationalStatus: false;
    readonly acceptedForOperationalStatus: false;
  }>;
  readonly reliability: Readonly<{
    readonly state: 'UNSIGNED_INACTIVE' | 'UNKNOWN';
    readonly targetCount: number;
    readonly activeTargetCount: 0 | null;
    readonly authorityGranted: false;
    readonly blockerCodes: readonly string[];
  }>;
  readonly blockers: readonly Readonly<AiOperationsSourceBlocker>[];
  readonly observedAtMs: null;
  readonly actionAuthority: 'NONE';
  readonly selfHealingClaim: 'NONE';
  readonly providerCallPerformed: false;
}

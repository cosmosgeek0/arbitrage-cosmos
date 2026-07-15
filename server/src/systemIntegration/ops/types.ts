import type { ProductIdentityReferenceRecord } from '../persistence/types.js';
import type { SystemSupervisorReadModel } from '../supervisor/types.js';

export const OPS_EXPOSURE_STATES = Object.freeze([
  'NONE',
  'ACTIVE',
  'AMBIGUOUS',
  'RECOVERY_REQUIRED',
  'UNKNOWN',
] as const);

export const OPS_STRONG_ACCOUNT_TRUTH_STATES = Object.freeze([
  'AVAILABLE',
  'CANONICAL_AVAILABLE',
  'COMPLETE',
  'LIVE_PRIVATE_AVAILABLE',
] as const);

export type OpsExposureState = (typeof OPS_EXPOSURE_STATES)[number];
export type OpsAmbiguityState = 'NONE' | 'AMBIGUOUS' | 'UNKNOWN';
export type OpsRecoveryState = 'NONE' | 'RECOVERY_REQUIRED' | 'UNKNOWN';

export interface CanonicalSupervisorOpsReadback {
  readonly source: 'CANONICAL_SUPERVISOR_READBACK';
  readonly observedAtUtc: string;
  readonly validUntilUtc: string;
  readonly deploymentFrozen: boolean | 'UNKNOWN';
  readonly exposureState: OpsExposureState;
  readonly ambiguityState: OpsAmbiguityState;
  readonly recoveryState: OpsRecoveryState;
  readonly currentSchemaVersion: number | null;
  readonly rollbackFloor: number | null;
}

export interface CanonicalSupervisorOpsReadPort {
  read(supervisorCut?: Readonly<SystemSupervisorReadModel>):
    | Readonly<CanonicalSupervisorOpsReadback>
    | Promise<Readonly<CanonicalSupervisorOpsReadback>>;
}

export interface CanonicalSupervisorOpsClock {
  nowMs(): number;
}

export type DeploymentFreezeProjectionState = 'FROZEN' | 'NOT_FROZEN' | 'UNKNOWN_FROZEN';

export interface DeploymentFreezeProjection {
  readonly source: 'CANONICAL_DEPLOYMENT_FREEZE_MARKER_READBACK';
  readonly state: DeploymentFreezeProjectionState;
  readonly ambiguity: 'NONE' | 'UNKNOWN';
  readonly reasons: readonly string[];
  readonly observedAtUtc: string;
  readonly validUntilUtc: string;
  readonly deploymentFrozen: boolean | 'UNKNOWN';
}

export interface DeploymentFreezeReadPort {
  read(): Readonly<DeploymentFreezeProjection>;
}

export type DeploymentFreezeFileRead =
  | Readonly<{ state: 'AVAILABLE'; raw: string }>
  | Readonly<{ state: 'ABSENT' }>
  | Readonly<{ state: 'UNAVAILABLE' }>;

export interface DeploymentFreezeFileSystem {
  inspectParentDirectory(parentPath: string): 'TRUSTED_DIRECTORY' | 'UNAVAILABLE';
  readRegularFileNoFollow(markerPath: string, maximumBytes: number): DeploymentFreezeFileRead;
}

export interface DeploymentFreezeReaderOptions {
  readonly markerPath: string | null;
  readonly clock: CanonicalSupervisorOpsClock;
  readonly fileSystem: DeploymentFreezeFileSystem;
  readonly leaseMs?: number;
}

export interface CanonicalSupervisorOpsReadbackOptions {
  readonly clock: CanonicalSupervisorOpsClock;
  readonly readSupervisor: () => (
    Readonly<SystemSupervisorReadModel>
    | Promise<Readonly<SystemSupervisorReadModel>>
  );
  readonly readBlockingIdentityReferences: (
    limit: number,
  ) => (
    readonly Readonly<ProductIdentityReferenceRecord>[]
    | Promise<readonly Readonly<ProductIdentityReferenceRecord>[]>
  );
  readonly deploymentFreeze: DeploymentFreezeReadPort;
  readonly leaseMs?: number;
  readonly maximumSupervisorAgeMs?: number;
}

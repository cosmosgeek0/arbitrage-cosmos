import {
  AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES,
} from '../manifests/artifacts.js';
import {
  AI_OPS_CAPABILITY_RELIABILITY_TARGETS,
} from '../reliability/runbooks.js';
import { SHADOW_A2_STATUS } from '../runtime/types.js';

export type AiOpsPassiveConfigurationState = 'CONFIGURED' | 'NOT_CONFIGURED' | 'UNKNOWN';
export type AiOpsPassiveMountState = 'MOUNTED' | 'NOT_MOUNTED' | 'UNKNOWN';
export type AiOpsPassiveActivityState = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';

export interface AiOpsPassiveBlocker {
  readonly code: string;
  readonly state: string;
  readonly detail: string;
  readonly source: 'AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES';
}

export interface AiOpsPassiveReliabilityStatus {
  readonly state: 'UNSIGNED_INACTIVE' | 'UNKNOWN';
  readonly targetCount: number;
  readonly activeTargetCount: 0 | null;
  readonly authorityGranted: false;
  readonly blockerCodes: readonly string[];
}

export interface AiOpsPassiveStatusProjection {
  readonly schema: 'AI_OPS_PASSIVE_STATUS_PROJECTION_V1';
  readonly projectionKind: 'SOURCE_BOUND_PASSIVE_READ_ONLY';
  readonly configurationState: AiOpsPassiveConfigurationState;
  readonly mountState: AiOpsPassiveMountState;
  readonly activityState: 'UNKNOWN';
  readonly caseCounts: Readonly<Record<Exclude<AiOpsPassiveActivityState, 'UNKNOWN'>, null>>;
  readonly operationalCases: readonly never[];
  readonly runtimeContract: Readonly<{
    readonly posture: typeof SHADOW_A2_STATUS;
    readonly operationalRuntimeEvidence: AiOpsPassiveMountState;
    readonly shadowIncidentAcceptedForOperationalStatus: false;
    readonly acceptedForOperationalStatus: false;
  }>;
  readonly reliability: Readonly<AiOpsPassiveReliabilityStatus>;
  readonly blockers: readonly Readonly<AiOpsPassiveBlocker>[];
  readonly observedAtMs: null;
  readonly actionAuthority: 'NONE';
  readonly selfHealingClaim: 'NONE';
  readonly providerCallPerformed: false;
}

type UnfinishedDependency = (typeof AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES)[number];

function dependencyById(dependencyId: string): Readonly<UnfinishedDependency> | null {
  const matches = AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES.filter(
    (dependency) => dependency.dependencyId === dependencyId,
  );
  return matches.length === 1 ? matches[0] : null;
}

function projectConfigurationState(): AiOpsPassiveConfigurationState {
  const configuration = dependencyById('AI_OPS_WORKER_IDENTITY_AND_CONFIG');
  return configuration?.currentState === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'UNKNOWN';
}

function projectMountState(): AiOpsPassiveMountState {
  const barrelMount = dependencyById('AI_OPS_FRESH_INTEGRATOR_DOCS_AND_BARREL_MOUNT');
  const operationMount = dependencyById('AI_OPS_ROOT_TEST_AND_OPERATION_MANIFEST');
  return barrelMount?.currentState === 'NOT_MOUNTED'
    && operationMount?.currentState === 'NOT_MOUNTED'
    ? 'NOT_MOUNTED'
    : 'UNKNOWN';
}

function projectReliability(): Readonly<AiOpsPassiveReliabilityStatus> {
  const allUnsignedInactive = AI_OPS_CAPABILITY_RELIABILITY_TARGETS.length > 0
    && AI_OPS_CAPABILITY_RELIABILITY_TARGETS.every((target) => (
      target.ownerSignature === null
      && target.ownerSignatureState === 'OWNER_SIGNATURE_REQUIRED'
      && target.activationState === 'UNSIGNED_INACTIVE'
      && target.authorityCreated === false
    ));
  return Object.freeze({
    state: allUnsignedInactive ? 'UNSIGNED_INACTIVE' : 'UNKNOWN',
    targetCount: AI_OPS_CAPABILITY_RELIABILITY_TARGETS.length,
    activeTargetCount: allUnsignedInactive ? 0 : null,
    authorityGranted: false,
    blockerCodes: Object.freeze([
      allUnsignedInactive
        ? 'AI_OPS_RELIABILITY_TARGETS_UNSIGNED_INACTIVE'
        : 'AI_OPS_RELIABILITY_TARGET_STATE_UNKNOWN',
    ]),
  });
}

function projectBlockers(): readonly Readonly<AiOpsPassiveBlocker>[] {
  return Object.freeze(
    AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES
      .map((dependency) => Object.freeze({
        code: dependency.dependencyId,
        state: dependency.currentState,
        detail: dependency.requirement,
        source: 'AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES' as const,
      }))
      .sort((left, right) => (
        left.code < right.code ? -1 : left.code > right.code ? 1 : 0
      )),
  );
}

/**
 * Projects only checked-in source contracts. The lane-local runtime and
 * incident models are SHADOW_SPECULATIVE, so they cannot become operational
 * work status or case counts. A future real mount must replace this seam with
 * an owner-ratified readback instead of passing claims into this function.
 */
export function projectAiOpsPassiveStatus(): Readonly<AiOpsPassiveStatusProjection> {
  const mountState = projectMountState();
  return Object.freeze({
    schema: 'AI_OPS_PASSIVE_STATUS_PROJECTION_V1',
    projectionKind: 'SOURCE_BOUND_PASSIVE_READ_ONLY',
    configurationState: projectConfigurationState(),
    mountState,
    activityState: 'UNKNOWN',
    caseCounts: Object.freeze({
      ACTIVE: null,
      PAUSED: null,
      COMPLETED: null,
      FAILED: null,
    }),
    operationalCases: Object.freeze([]),
    runtimeContract: Object.freeze({
      posture: SHADOW_A2_STATUS,
      operationalRuntimeEvidence: mountState,
      shadowIncidentAcceptedForOperationalStatus: false,
      acceptedForOperationalStatus: false,
    }),
    reliability: projectReliability(),
    blockers: projectBlockers(),
    observedAtMs: null,
    actionAuthority: 'NONE',
    selfHealingClaim: 'NONE',
    providerCallPerformed: false,
  });
}

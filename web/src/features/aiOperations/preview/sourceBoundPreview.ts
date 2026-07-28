import type { AiOperationsPassiveStatusView } from '../types';

export const AI_OPERATIONS_SOURCE_BOUND_PREVIEW = Object.freeze({
  schema: 'AI_OPS_PASSIVE_STATUS_PROJECTION_V1',
  projectionKind: 'SOURCE_BOUND_PASSIVE_READ_ONLY',
  configurationState: 'NOT_CONFIGURED',
  mountState: 'NOT_MOUNTED',
  activityState: 'UNKNOWN',
  caseCounts: Object.freeze({
    ACTIVE: null,
    PAUSED: null,
    COMPLETED: null,
    FAILED: null,
  }),
  operationalCases: Object.freeze([]),
  runtimeContract: Object.freeze({
    posture: 'SHADOW_SPECULATIVE',
    operationalRuntimeEvidence: 'NOT_MOUNTED',
    shadowIncidentAcceptedForOperationalStatus: false,
    acceptedForOperationalStatus: false,
  }),
  reliability: Object.freeze({
    state: 'UNSIGNED_INACTIVE',
    targetCount: 17,
    activeTargetCount: 0,
    authorityGranted: false,
    blockerCodes: Object.freeze([
      'AI_OPS_RELIABILITY_TARGETS_UNSIGNED_INACTIVE',
    ]),
  }),
  blockers: Object.freeze([
    Object.freeze({
      code: 'AI_OPS_ACCEPTED_ASSURANCE_BINDING',
      state: 'MISSING_REQUIRED',
      detail: 'Accepted Atlas and S6 evidence bind through Product Assurance owner adapters without fixture promotion.',
      source: 'AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES',
    }),
    Object.freeze({
      code: 'AI_OPS_CONTROL_REGISTRY_MOUNT',
      state: 'NOT_WIRED',
      detail: 'Canonical registry supplies namespaced entries, handlers, CAS and independent readback.',
      source: 'AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES',
    }),
    Object.freeze({
      code: 'AI_OPS_FRESH_INTEGRATOR_DOCS_AND_BARREL_MOUNT',
      state: 'NOT_MOUNTED',
      detail: 'The accepted I00 base exists; only the fresh AI Ops integrator may create the cross-lane barrel and update canonical state and ownership docs after lane acceptance.',
      source: 'AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES',
    }),
    Object.freeze({
      code: 'AI_OPS_LEDGER_AND_AUDIT_MOUNT',
      state: 'NOT_WIRED',
      detail: 'Ledger adapter and independent audit delivery satisfy append, readback and loss gates.',
      source: 'AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES',
    }),
    Object.freeze({
      code: 'AI_OPS_ROOT_TEST_AND_OPERATION_MANIFEST',
      state: 'NOT_MOUNTED',
      detail: 'Mount focused suite and regenerate Product Assurance scan manifest from accepted SHA.',
      source: 'AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES',
    }),
    Object.freeze({
      code: 'AI_OPS_RUNBOOK_EXECUTION_BINDING',
      state: 'NOT_WIRED',
      detail: 'Existing remediation and command owners ratify each action; A1 never executes.',
      source: 'AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES',
    }),
    Object.freeze({
      code: 'AI_OPS_WORKER_IDENTITY_AND_CONFIG',
      state: 'NOT_CONFIGURED',
      detail: 'Three isolated principals bind non-secret provider configuration with explicit billing domain.',
      source: 'AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES',
    }),
    Object.freeze({
      code: 'CANONICAL_INCIDENT_OWNER',
      state: 'MISSING_REQUIRED',
      detail: 'Director ratifies exactly one incident identity and lifecycle owner.',
      source: 'AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES',
    }),
    Object.freeze({
      code: 'HUMAN_APPROVAL_AND_SIGNATURE_OWNER',
      state: 'MISSING_REQUIRED',
      detail: 'Separately authenticated owner signs exact runbook and policy artifacts.',
      source: 'AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES',
    }),
  ]),
  observedAtMs: null,
  actionAuthority: 'NONE',
  selfHealingClaim: 'NONE',
  providerCallPerformed: false,
} as const satisfies AiOperationsPassiveStatusView);

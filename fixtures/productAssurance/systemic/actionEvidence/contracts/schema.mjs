const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

export const ACTION_EVIDENCE_SCHEMA_VERSION = 'pa.s2.action-evidence.v1';
export const ACTION_EVIDENCE_FIXTURE_BUNDLE_SCHEMA_VERSION = 'pa.s2.action-evidence-fixture-bundle.v1';
export const ACTION_EVIDENCE_RESULT_SCHEMA_VERSION = 'pa.s2.action-evidence-result.v1';
export const ACTION_EVIDENCE_USE_SCHEMA_VERSION = 'pa.s2.action-evidence-use.v1';

export const ACTION_EVIDENCE_TRUTH_LABEL = 'SYNTHETIC_ONLY';
export const ACTION_EVIDENCE_USE_CLASS = 'SUPPORTING_EVIDENCE_ONLY';
export const ACTION_EVIDENCE_AUTHORITY_EFFECT = 'NONE';

export const FROZEN_CORE_COMMIT = '08a0a09780727e2b4ba59017b5701998abe29b77';
export const FROZEN_HAZARD_COMMIT = 'ab33b3712cddd67c3ec91cfa1dd232c75226cd9f';
export const FROZEN_L_COMMIT = 'df6b472993ca9659ce09cf5f72004981c6835f0d';
export const FROZEN_AUTHORITY_MAP_COMMIT = 'c57610cb5f7d56efb61e53ae27057fbe92a6a2f6';

export const ACTION_EVIDENCE_STATUSES = Object.freeze(['PASS', 'FAIL', 'UNKNOWN']);
export const ACTION_EVIDENCE_ASSERTIONS = Object.freeze([
  'SATISFIED',
  'CONTRADICTED',
  'UNRESOLVED',
]);

export const ACTION_EVIDENCE_CLASSES = Object.freeze([
  'ORDER_INTENT',
  'CANCELLATION',
  'REPAIR_STEP',
  'HALT',
  'RECOVERY_STEP',
]);

export const ACTION_EVIDENCE_FAMILIES = Object.freeze([
  'ACTION_BINDING',
  'FRESHNESS_AND_TEMPORAL_COHERENCE',
  'FENCING_AND_IDEMPOTENCY',
  'LIFECYCLE_STATE_AND_OUTCOME',
  'EXPOSURE_AND_LIABILITY_BOUNDS',
  'OUTCOME_OBSERVABILITY_AND_SUPERVISION',
  'MUTATION_INPUT_TRUTH',
  'CANCELLATION_AND_LATE_RESULT',
  'REGISTERED_RECOVERY_OR_REPAIR_PATH',
]);

export const CANONICAL_OWNER_REFERENCE_IDS = Object.freeze([
  'CAPITAL_APPROVALS',
  'CAPITAL_FOUNDATION',
  'CAPITAL_POSITIONS',
  'CAPITAL_RESERVATIONS',
  'FOUNDATION_CONTROL',
  'FOUNDATION_EXECUTION',
  'FOUNDATION_RECONCILIATION',
  'FOUNDATION_RISK',
  'INTELLIGENCE_FOUNDATION',
  'INTELLIGENCE_RUNTIME',
  'L06_MUTATION_JOURNAL',
  'L08_EXECUTION_POLICY',
  'L08_RECOVERY',
  'MANDATE',
  'OPERATOR_APPROVAL',
]);

export const CANONICAL_DECISION_OWNER_IDS_BY_CLASS = deepFreeze({
  ORDER_INTENT: ['MANDATE', 'CAPITAL_FOUNDATION', 'CAPITAL_APPROVALS', 'FOUNDATION_RISK', 'OPERATOR_APPROVAL'],
  CANCELLATION: ['MANDATE', 'CAPITAL_FOUNDATION', 'CAPITAL_APPROVALS', 'FOUNDATION_RISK', 'OPERATOR_APPROVAL'],
  REPAIR_STEP: ['FOUNDATION_CONTROL', 'FOUNDATION_RISK', 'OPERATOR_APPROVAL'],
  HALT: ['FOUNDATION_CONTROL', 'FOUNDATION_RISK', 'OPERATOR_APPROVAL'],
  RECOVERY_STEP: ['MANDATE', 'CAPITAL_FOUNDATION', 'CAPITAL_APPROVALS', 'FOUNDATION_RISK', 'OPERATOR_APPROVAL'],
});

export const EVIDENCE_SOURCE_ROLES = Object.freeze([
  'ACTION',
  'TEMPORAL_COHERENCE',
  'FENCE_OWNER',
  'LIFECYCLE',
  'EXPOSURE',
  'POSITION',
  'OPEN_ORDERS',
  'BALANCE',
  'BORROW',
  'FUNDING',
  'LIABILITY',
  'OBSERVABILITY',
  'INSTRUMENT_FILTER',
  'FEE',
  'LIQUIDITY',
  'CANCELLATION_LAW',
  'RECOVERY_PATH',
  'REPAIR_POSTCONDITION',
  'HALT_READBACK',
  'RECOVERY_EXECUTION',
  'OWNER_DECISION',
]);

export const EVIDENCE_REASON_CODES = Object.freeze([
  'CURRENT_SYNTHETIC_FIXTURE',
  'PREVIOUS_BINDING_CONTRADICTION',
  'VERIFICATION_INCOMPLETE',
]);

export const EVIDENCE_REASON_CODES_BY_ASSERTION = deepFreeze({
  SATISFIED: ['CURRENT_SYNTHETIC_FIXTURE'],
  CONTRADICTED: ['PREVIOUS_BINDING_CONTRADICTION'],
  UNRESOLVED: ['VERIFICATION_INCOMPLETE'],
});

export const FROZEN_POLICY_REVISIONS = deepFreeze({
  ORDER_INTENT: 'L08_EXECUTION_POLICY_V1',
  CANCELLATION: 'L08_EXECUTION_POLICY_V1',
  REPAIR_STEP: 'L14_DURABLE_CONTROL_V1',
  HALT: 'L14_DURABLE_CONTROL_V1',
  RECOVERY_STEP: 'L08_EXECUTION_POLICY_V1',
});

export const REQUIRED_EVIDENCE_FAMILIES = deepFreeze({
  ORDER_INTENT: [
    'ACTION_BINDING',
    'FRESHNESS_AND_TEMPORAL_COHERENCE',
    'FENCING_AND_IDEMPOTENCY',
    'LIFECYCLE_STATE_AND_OUTCOME',
    'EXPOSURE_AND_LIABILITY_BOUNDS',
    'OUTCOME_OBSERVABILITY_AND_SUPERVISION',
    'MUTATION_INPUT_TRUTH',
    'CANCELLATION_AND_LATE_RESULT',
    'REGISTERED_RECOVERY_OR_REPAIR_PATH',
  ],
  CANCELLATION: [
    'ACTION_BINDING',
    'FRESHNESS_AND_TEMPORAL_COHERENCE',
    'FENCING_AND_IDEMPOTENCY',
    'LIFECYCLE_STATE_AND_OUTCOME',
    'EXPOSURE_AND_LIABILITY_BOUNDS',
    'OUTCOME_OBSERVABILITY_AND_SUPERVISION',
    'MUTATION_INPUT_TRUTH',
    'CANCELLATION_AND_LATE_RESULT',
    'REGISTERED_RECOVERY_OR_REPAIR_PATH',
  ],
  REPAIR_STEP: [
    'ACTION_BINDING',
    'FRESHNESS_AND_TEMPORAL_COHERENCE',
    'FENCING_AND_IDEMPOTENCY',
    'LIFECYCLE_STATE_AND_OUTCOME',
    'EXPOSURE_AND_LIABILITY_BOUNDS',
    'OUTCOME_OBSERVABILITY_AND_SUPERVISION',
    'REGISTERED_RECOVERY_OR_REPAIR_PATH',
  ],
  HALT: [
    'ACTION_BINDING',
    'FRESHNESS_AND_TEMPORAL_COHERENCE',
    'FENCING_AND_IDEMPOTENCY',
    'LIFECYCLE_STATE_AND_OUTCOME',
    'EXPOSURE_AND_LIABILITY_BOUNDS',
    'OUTCOME_OBSERVABILITY_AND_SUPERVISION',
  ],
  RECOVERY_STEP: [
    'ACTION_BINDING',
    'FRESHNESS_AND_TEMPORAL_COHERENCE',
    'FENCING_AND_IDEMPOTENCY',
    'LIFECYCLE_STATE_AND_OUTCOME',
    'EXPOSURE_AND_LIABILITY_BOUNDS',
    'OUTCOME_OBSERVABILITY_AND_SUPERVISION',
    'MUTATION_INPUT_TRUTH',
    'CANCELLATION_AND_LATE_RESULT',
    'REGISTERED_RECOVERY_OR_REPAIR_PATH',
  ],
});

const BASE_SOURCE_ROLES_BY_FAMILY = {
  ACTION_BINDING: ['ACTION'],
  FRESHNESS_AND_TEMPORAL_COHERENCE: ['TEMPORAL_COHERENCE'],
  FENCING_AND_IDEMPOTENCY: ['FENCE_OWNER'],
  LIFECYCLE_STATE_AND_OUTCOME: ['LIFECYCLE'],
  EXPOSURE_AND_LIABILITY_BOUNDS: ['EXPOSURE', 'POSITION', 'OPEN_ORDERS', 'BALANCE', 'BORROW', 'FUNDING', 'LIABILITY'],
  OUTCOME_OBSERVABILITY_AND_SUPERVISION: ['OBSERVABILITY'],
  MUTATION_INPUT_TRUTH: ['INSTRUMENT_FILTER', 'FEE', 'LIQUIDITY'],
  CANCELLATION_AND_LATE_RESULT: ['CANCELLATION_LAW'],
  REGISTERED_RECOVERY_OR_REPAIR_PATH: ['RECOVERY_PATH'],
};

export const EVIDENCE_SOURCE_ROLES_BY_CLASS = deepFreeze(Object.fromEntries(
  ACTION_EVIDENCE_CLASSES.map((actionClass) => [
    actionClass,
    Object.fromEntries(REQUIRED_EVIDENCE_FAMILIES[actionClass].map((family) => {
      if (family !== 'LIFECYCLE_STATE_AND_OUTCOME') return [family, BASE_SOURCE_ROLES_BY_FAMILY[family]];
      if (actionClass === 'REPAIR_STEP') return [family, ['LIFECYCLE', 'REPAIR_POSTCONDITION']];
      if (actionClass === 'HALT') return [family, ['LIFECYCLE', 'HALT_READBACK']];
      if (actionClass === 'RECOVERY_STEP') return [family, ['LIFECYCLE', 'RECOVERY_EXECUTION']];
      return [family, BASE_SOURCE_ROLES_BY_FAMILY[family]];
    })),
  ]),
));

export const REQUIRED_EVIDENCE_DEPENDENCY_FAMILIES = deepFreeze({
  ACTION_BINDING: [],
  FRESHNESS_AND_TEMPORAL_COHERENCE: [],
  FENCING_AND_IDEMPOTENCY: ['ACTION_BINDING', 'FRESHNESS_AND_TEMPORAL_COHERENCE'],
  LIFECYCLE_STATE_AND_OUTCOME: ['ACTION_BINDING', 'FRESHNESS_AND_TEMPORAL_COHERENCE'],
  EXPOSURE_AND_LIABILITY_BOUNDS: ['FRESHNESS_AND_TEMPORAL_COHERENCE'],
  OUTCOME_OBSERVABILITY_AND_SUPERVISION: ['LIFECYCLE_STATE_AND_OUTCOME', 'FRESHNESS_AND_TEMPORAL_COHERENCE'],
  MUTATION_INPUT_TRUTH: ['ACTION_BINDING', 'FRESHNESS_AND_TEMPORAL_COHERENCE'],
  CANCELLATION_AND_LATE_RESULT: ['LIFECYCLE_STATE_AND_OUTCOME', 'FRESHNESS_AND_TEMPORAL_COHERENCE'],
  REGISTERED_RECOVERY_OR_REPAIR_PATH: ['LIFECYCLE_STATE_AND_OUTCOME', 'FRESHNESS_AND_TEMPORAL_COHERENCE', 'EXPOSURE_AND_LIABILITY_BOUNDS'],
});

export function evidenceSourceOwnerFor(actionClass, sourceRole) {
  if (sourceRole === 'ACTION') return FROZEN_ACTION_BINDINGS[actionClass]?.ownerId ?? null;
  if (['TEMPORAL_COHERENCE', 'FUNDING', 'INSTRUMENT_FILTER', 'FEE', 'LIQUIDITY'].includes(sourceRole)) return 'INTELLIGENCE_RUNTIME';
  if (['FENCE_OWNER', 'REPAIR_POSTCONDITION', 'HALT_READBACK'].includes(sourceRole)) return 'FOUNDATION_CONTROL';
  if (sourceRole === 'LIFECYCLE' && ['REPAIR_STEP', 'HALT'].includes(actionClass)) return 'FOUNDATION_CONTROL';
  if (sourceRole === 'RECOVERY_PATH' && actionClass === 'REPAIR_STEP') return 'FOUNDATION_CONTROL';
  if (['POSITION', 'BALANCE', 'BORROW', 'LIABILITY'].includes(sourceRole)) return 'CAPITAL_POSITIONS';
  if (sourceRole === 'EXPOSURE') return 'FOUNDATION_RISK';
  if (sourceRole === 'OPEN_ORDERS') return 'L06_MUTATION_JOURNAL';
  if (sourceRole === 'OBSERVABILITY') return 'FOUNDATION_RECONCILIATION';
  return EVIDENCE_SOURCE_ROLES.includes(sourceRole) ? 'FOUNDATION_EXECUTION' : null;
}

export const FROZEN_ACTION_BINDINGS = deepFreeze({
  ORDER_INTENT: {
    ownerId: 'L08_EXECUTION_POLICY',
    sourcePath: 'server/src/liveEdge/adapters/executionPolicy/types.ts',
    sourceSymbol: 'PolicyAction',
    discriminantField: 'kind',
    discriminantValue: 'PLACE',
    supportingSymbols: [
      'PolicyAuthorityProjection',
      'ExecutionPolicyPlan',
      'Foundation.PlanLifecycle',
      'Foundation.LegLifecycle',
    ],
  },
  CANCELLATION: {
    ownerId: 'L08_EXECUTION_POLICY',
    sourcePath: 'server/src/liveEdge/adapters/executionPolicy/types.ts',
    sourceSymbol: 'PolicyAction',
    discriminantField: 'kind',
    discriminantValue: 'CANCEL',
    supportingSymbols: [
      'L14.CancelAction',
      'L06.MutationIdentityGraph.CANCEL_ORDER',
      'Foundation.LegLifecycle.CANCEL_PENDING',
    ],
  },
  REPAIR_STEP: {
    ownerId: 'FOUNDATION_CONTROL',
    sourcePath: 'server/src/liveEdge/controls/types.ts',
    sourceSymbol: 'SafeRestartComponentAction',
    discriminantField: 'type',
    discriminantValue: 'SAFE_RESTART_COMPONENT',
    supportingSymbols: [
      'Foundation.ControlCommand.RESTART',
      'Foundation.RuntimePhase',
    ],
  },
  HALT: {
    ownerId: 'FOUNDATION_CONTROL',
    sourcePath: 'server/src/liveEdge/controls/types.ts',
    sourceSymbol: 'HaltAction',
    discriminantField: 'type',
    discriminantValue: 'HALT',
    supportingSymbols: [
      'L12.L12ControlAction.HALT',
      'L12.L12ControlPostureEvidence',
    ],
  },
  RECOVERY_STEP: {
    ownerId: 'L08_EXECUTION_POLICY',
    sourcePath: 'server/src/liveEdge/adapters/executionPolicy/types.ts',
    sourceSymbol: 'PolicyAction',
    discriminantField: 'kind',
    discriminantValue: 'RECOVER',
    supportingSymbols: [
      'L14.ExecutePrecomputedRecoveryPlanAction',
      'Foundation.RecoveryRecommendation',
      'L12.L12RecoveryEvidence',
    ],
  },
});

export const ACTION_IDENTITY_FIELDS = deepFreeze({
  ORDER_INTENT: [
    'actionId', 'actionRevision', 'actionSchema', 'ambiguityPosture',
    'correlationId', 'deadlineOffsetMs', 'dependsOnActualFillLegId', 'exposureEffect',
    'externalPlanId', 'intentId', 'intentRevision', 'legId', 'orderType', 'price',
    'product', 'quantity', 'quantitySource', 'recoveryEvidenceRevision',
    'requiresConfirmedCancelActionId', 'side', 'step', 'symbol', 'targetActionId',
    'targetExposureRevision', 'timeInForce', 'venue', 'accountRealmId',
  ],
  CANCELLATION: [
    'actionId', 'actionRevision', 'actionSchema', 'ambiguityPosture',
    'commandId', 'correlationId', 'deadlineOffsetMs', 'dependsOnActualFillLegId',
    'exposureEffect', 'legId', 'mutationId', 'orderType', 'price', 'product',
    'quantity', 'quantitySource', 'recoveryEvidenceRevision',
    'requiresConfirmedCancelActionId', 'step', 'symbol', 'targetActionId',
    'targetExposureRevision', 'timeInForce', 'venue', 'accountRealmId',
  ],
  REPAIR_STEP: [
    'actionDigest', 'actionType', 'commandId', 'componentDigest', 'componentId',
    'componentOwner', 'componentReferenceSchema', 'componentRevision',
    'correlationId', 'expectedControlRevision', 'restartMode',
  ],
  HALT: [
    'actionDigest', 'actionType', 'commandId', 'correlationId',
    'expectedControlRevision', 'retainSupervision', 'scope',
  ],
  RECOVERY_STEP: [
    'actionId', 'actionRevision', 'actionSchema', 'actualFillLegId',
    'ambiguityPosture', 'correlationId', 'deadlineOffsetMs',
    'dependsOnActualFillLegId', 'exposureEffect', 'legId', 'orderType', 'planId',
    'price', 'product', 'quantity', 'quantitySource', 'recoveryEvidenceRevision',
    'requiresConfirmedCancelActionId', 'step', 'symbol', 'targetActionId',
    'targetExposureRevision', 'timeInForce', 'venue', 'accountRealmId',
  ],
});

export const ACTION_FACT_FIELDS = deepFreeze({
  ORDER_INTENT: [
    'acknowledgedAtMs', 'factType', 'leaseLossObservedAtMs', 'leaseState',
    'ownerDecisionReferenceState', 'ownerTruthState', 'partialFillState',
    'rateLimitState', 'recoveryPathState', 'signedAtMs',
  ],
  CANCELLATION: [
    'acknowledgedAtMs', 'cancellationRequestedAtMs', 'cancellationState',
    'cumulativeFilledQuantity', 'factType', 'latestFillAtMs',
    'leaseLossObservedAtMs', 'leaseState', 'localTimeoutAtMs',
    'ownerDecisionReferenceState', 'ownerTruthState', 'rateLimitState',
    'recoveryPathState', 'signedAtMs', 'terminalAtMs',
  ],
  REPAIR_STEP: [
    'factType', 'leaseState', 'postconditionExpiresAtMs',
    'postconditionObservedAtMs', 'postconditionState', 'receiptState',
  ],
  HALT: [
    'factType', 'readbackExpiresAtMs', 'readbackObservedAtMs', 'readbackState',
    'receiptState',
  ],
  RECOVERY_STEP: [
    'executionBindingState', 'factType', 'lateResultState', 'leaseState',
    'ownerDecisionReferenceState', 'ownerTruthState', 'partialFillState',
    'rateLimitState', 'recommendationAutomatic', 'recoveryPathState',
  ],
});

export const INVALIDATION_REASON_CODES = Object.freeze([
  'OWNER_REVISION_CHANGED',
  'SUBJECT_BINDING_CHANGED',
  'LEASE_LOST',
  'LATE_RESULT_OBSERVED',
  'BACKUP_PATH_EXPIRED',
  'SOURCE_DISCONTINUITY',
  'ASSUMPTION_INVALIDATED',
]);

export const AUTHORITY_USE_PURPOSES = Object.freeze([
  'APPROVAL',
  'ACTION_ADMISSION',
  'BLOCKING',
  'RANKING',
  'EXECUTION',
  'COMMAND_DISPATCH',
]);

export const ACTION_EVIDENCE_LIMITS = deepFreeze({
  maxRecords: ACTION_EVIDENCE_CLASSES.length,
  maxFamiliesPerRecord: ACTION_EVIDENCE_FAMILIES.length,
  maxTemporalSources: 16,
  maxOwnerReferences: 16,
  maxActiveAssumptions: 16,
  maxInvariantResults: 32,
  maxInvalidations: 64,
  maxIdsPerList: 32,
  maxText: 512,
  maxNestingDepth: 64,
});

const id = { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:/-]*$' };
const reasonCode = { type: 'string', enum: EVIDENCE_REASON_CODES };
const sha1 = { type: 'string', pattern: '^[a-f0-9]{40}$' };
const sha256 = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const ownerSha256 = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const referenceDigest = { anyOf: [sha256, ownerSha256] };
const policyActionId = { type: 'string', pattern: '^epact_[a-f0-9]{64}$' };
const policyActionRevision = { type: 'string', pattern: '^epactrev_[a-f0-9]{64}$' };
const commandId = { type: 'string', pattern: '^cmd_[a-f0-9]{16,64}$' };
const frozenTextId = { type: 'string', minLength: 3, maxLength: 256, pattern: '^[A-Za-z][A-Za-z0-9._:-]*$' };
const frozenSymbol = { type: 'string', minLength: 2, maxLength: 40, pattern: '^[A-Z0-9._-]+$' };
const controlRevision = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const utcMs = { type: 'integer', minimum: 1_262_304_000_000, maximum: 4_102_444_800_000 };
const positiveInteger = { type: 'integer', minimum: 1 };
const nonNegativeInteger = { type: 'integer', minimum: 0 };
const decimal = {
  type: 'string',
  maxLength: ACTION_EVIDENCE_LIMITS.maxText,
  pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$',
};
const positiveDecimal = {
  ...decimal,
  pattern: '^(?=.*[1-9])(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$',
};
const policyDecimal = {
  type: 'string',
  maxLength: 73,
  pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]*[1-9])?$',
};
const positivePolicyDecimal = {
  ...policyDecimal,
  pattern: '^(?=.*[1-9])(?:0|[1-9][0-9]*)(?:\\.[0-9]*[1-9])?$',
};
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const closedObject = (required, properties) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const idArray = (maximum = ACTION_EVIDENCE_LIMITS.maxIdsPerList) => ({
  type: 'array',
  maxItems: maximum,
  uniqueItems: true,
  items: id,
});

const actorSchema = closedObject(
  ['actorId', 'independenceDomainId', 'ownerId', 'role'],
  {
    actorId: id,
    independenceDomainId: id,
    ownerId: id,
    role: { enum: ['PRODUCER', 'VERIFIER'] },
  },
);

const evidenceReferenceProperties = {
  sourceRole: { enum: EVIDENCE_SOURCE_ROLES },
  ownerId: { enum: CANONICAL_OWNER_REFERENCE_IDS },
  referenceId: id,
  revision: id,
  digest: referenceDigest,
  observedAtMs: utcMs,
  maximumAgeMs: positiveInteger,
  expiresAtMs: utcMs,
};
const evidenceReferenceSchema = closedObject(
  Object.keys(evidenceReferenceProperties),
  evidenceReferenceProperties,
);
const ownerDecisionReferenceSchema = closedObject(
  [...Object.keys(evidenceReferenceProperties), 'binding'],
  {
    ...evidenceReferenceProperties,
    sourceRole: { const: 'OWNER_DECISION' },
    binding: closedObject(
      ['authorityMapCommit', 'policyRevision', 'releaseId', 'subjectDigest'],
      {
        authorityMapCommit: sha1,
        policyRevision: id,
        releaseId: id,
        subjectDigest: sha256,
      },
    ),
  },
);

const identityProperty = (actionClass, key) => {
  if (key === 'actionDigest') return ownerSha256;
  if (key === 'actionId') return policyActionId;
  if (key === 'actionRevision') return policyActionRevision;
  if (key === 'commandId') return commandId;
  if (['targetActionId', 'requiresConfirmedCancelActionId'].includes(key)) return nullable(policyActionId);
  if (key === 'dependsOnActualFillLegId') return nullable(frozenTextId);
  if (['legId', 'correlationId', 'accountRealmId'].includes(key)) return frozenTextId;
  if (key === 'symbol') return frozenSymbol;
  if (key === 'step') return { ...nonNegativeInteger, maximum: 31 };
  if (key === 'deadlineOffsetMs') return { ...nonNegativeInteger, maximum: 86_400_000 };
  if (key === 'expectedControlRevision') return nonNegativeInteger;
  if (key === 'retainSupervision') return { const: true };
  if (key === 'actionSchema') return { const: 'EXECUTION_POLICY_ACTION_V1' };
  if (key === 'ambiguityPosture') return { const: 'RECONCILE_ONLY' };
  if (key === 'actionType') return { const: actionClass === 'HALT' ? 'HALT' : 'SAFE_RESTART_COMPONENT' };
  if (key === 'componentOwner') return { const: 'FOUNDATION_CONTROL' };
  if (key === 'componentReferenceSchema') return { const: 'LIVE_EDGE_OPAQUE_OWNER_REFERENCE_V1' };
  if (key === 'componentDigest') return referenceDigest;
  if (key === 'componentRevision') return controlRevision;
  if (key === 'componentId') return { const: 'control-plane-runtime' };
  if (key === 'restartMode') return { const: 'SAFE_RECONCILE_FIRST' };
  if (key === 'scope') return { const: 'NEW_RISK' };
  if (key === 'side') return { enum: ['BUY', 'SELL'] };
  if (key === 'venue') return { const: 'BINANCE' };
  if (key === 'product') return { enum: ['SPOT', 'USD_M_PERPETUAL'] };
  if (key === 'orderType') return actionClass === 'CANCELLATION'
    ? { type: 'null' } : { enum: ['LIMIT', 'MARKET'] };
  if (key === 'timeInForce') return actionClass === 'ORDER_INTENT'
    || actionClass === 'RECOVERY_STEP'
    ? nullable({ enum: ['GTC', 'IOC', 'FOK'] }) : { type: 'null' };
  if (['quantity', 'price'].includes(key)) {
    if (actionClass === 'CANCELLATION') return { type: 'null' };
    return key === 'price' ? nullable(policyDecimal) : positivePolicyDecimal;
  }
  if (key === 'quantitySource') {
    if (actionClass === 'CANCELLATION') return { type: 'null' };
    return actionClass === 'RECOVERY_STEP'
      ? { const: 'RISK_REDUCING_RECOVERY_EVIDENCE' }
      : { enum: ['AUTHORIZED_FILTERED_QUANTITY', 'ACTUAL_FILL_OF_LEG'] };
  }
  if (key === 'exposureEffect') return { const: actionClass === 'ORDER_INTENT'
    ? 'MAY_OPEN_WITHIN_AUTHORIZATION'
    : actionClass === 'CANCELLATION' ? 'NO_EXPOSURE_EFFECT' : 'RISK_REDUCING_ONLY' };
  if (['recoveryEvidenceRevision', 'targetExposureRevision'].includes(key)) return nullable(frozenTextId);
  return id;
};
const identitySchemaFor = (actionClass) => {
  const schema = closedObject(
    ACTION_IDENTITY_FIELDS[actionClass],
    Object.fromEntries(ACTION_IDENTITY_FIELDS[actionClass].map((key) => [key, identityProperty(actionClass, key)])),
  );
  if (actionClass === 'ORDER_INTENT' || actionClass === 'RECOVERY_STEP') {
    schema.allOf = [
      {
        if: { properties: { orderType: { const: 'LIMIT' } }, required: ['orderType'] },
        then: {
          properties: {
            price: positivePolicyDecimal,
            timeInForce: { enum: ['GTC', 'IOC', 'FOK'] },
          },
        },
      },
      {
        if: { properties: { orderType: { const: 'MARKET' } }, required: ['orderType'] },
        then: { properties: { price: { type: 'null' }, timeInForce: { type: 'null' } } },
      },
    ];
    if (actionClass === 'ORDER_INTENT') {
      schema.allOf.push({
        if: { properties: { dependsOnActualFillLegId: { type: 'null' } }, required: ['dependsOnActualFillLegId'] },
        then: { properties: { quantitySource: { const: 'AUTHORIZED_FILTERED_QUANTITY' } } },
        else: { properties: { quantitySource: { const: 'ACTUAL_FILL_OF_LEG' } } },
      });
    }
  }
  return schema;
};

const actionFactProperty = (actionClass, key) => {
  if (key === 'factType') return { const: `${actionClass}_FACTS` };
  if (['signedAtMs', 'acknowledgedAtMs', 'cancellationRequestedAtMs', 'postconditionObservedAtMs', 'postconditionExpiresAtMs', 'readbackObservedAtMs', 'readbackExpiresAtMs'].includes(key)) return utcMs;
  if (['leaseLossObservedAtMs', 'localTimeoutAtMs', 'terminalAtMs', 'latestFillAtMs'].includes(key)) return nullable(utcMs);
  if (key === 'cumulativeFilledQuantity') return nullable(policyDecimal);
  if (key === 'recommendationAutomatic') return { type: 'boolean' };
  const enums = {
    leaseState: ['HELD', 'LOST', 'UNKNOWN'],
    ownerDecisionReferenceState: ['ABSENT', 'CURRENT_EXACT_SUBJECT', 'STALE', 'SUBJECT_MISMATCH', 'POLICY_MISMATCH', 'UNKNOWN'],
    ownerTruthState: ['CURRENT', 'CHANGED_AFTER_PROPOSAL', 'UNKNOWN'],
    partialFillState: actionClass === 'RECOVERY_STEP'
      ? ['BOUNDED', 'PARTIALLY_FILLED', 'UNKNOWN'] : ['NONE', 'PARTIALLY_FILLED', 'UNKNOWN'],
    rateLimitState: ['AVAILABLE', 'RATE_LIMITED', 'UNKNOWN'],
    recoveryPathState: ['CURRENT', 'MISSING', 'EXPIRED', 'UNKNOWN'],
    cancellationState: ['CANCEL_PENDING', 'CANCELLED', 'FILLED', 'AMBIGUOUS', 'UNKNOWN'],
    receiptState: ['APPLIED', 'NOOP', 'MISSING', 'UNKNOWN'],
    postconditionState: ['RECONCILED_HEALTHY', 'RESTARTED_UNRECONCILED', 'FAILED_OR_RECURRED', 'QUIET_PERIOD_INCOMPLETE', 'UNKNOWN'],
    readbackState: ['HALTED', 'NOT_HALTED', 'MISSING', 'UNKNOWN'],
    executionBindingState: ['PRECOMPUTED_EXECUTION_BOUND', 'RECOMMENDATION_ONLY', 'AWARENESS_ONLY', 'MISSING', 'UNKNOWN'],
    lateResultState: ['NONE', 'FILL_AFTER_CANCEL', 'UNKNOWN'],
  };
  return { enum: enums[key] };
};
const actionFactsSchemaFor = (actionClass) => closedObject(
  ACTION_FACT_FIELDS[actionClass],
  Object.fromEntries(ACTION_FACT_FIELDS[actionClass].map((key) => [key, actionFactProperty(actionClass, key)])),
);

const versionsSchemaFor = (actionClass) => closedObject(
  ['authorityMapCommit', 'modelRevision', 'ownerContractCommit', 'policyRevision', 'releaseId', 'schemaRevision'],
  {
    authorityMapCommit: { const: FROZEN_AUTHORITY_MAP_COMMIT },
    modelRevision: nullable(id),
    ownerContractCommit: { const: FROZEN_L_COMMIT },
    policyRevision: { const: FROZEN_POLICY_REVISIONS[actionClass] },
    releaseId: id,
    schemaRevision: { const: ACTION_EVIDENCE_SCHEMA_VERSION },
  },
);

const temporalSourceSchema = closedObject(
  [
    'accountRealmId', 'availableAtMs', 'clockQuality', 'componentId', 'eventAtMs',
    'evidenceId', 'expiresAtMs', 'maximumAgeMs', 'processedAtMs', 'product',
    'receivedAtMs', 'sequenceGap', 'sequenceId', 'snapshotId', 'sourceId',
    'symbol', 'venue',
  ],
  {
    accountRealmId: nullable(id),
    availableAtMs: utcMs,
    clockQuality: { enum: ['BOUNDED', 'UNBOUNDED', 'UNKNOWN'] },
    componentId: nullable(id),
    eventAtMs: utcMs,
    evidenceId: id,
    expiresAtMs: utcMs,
    maximumAgeMs: positiveInteger,
    processedAtMs: utcMs,
    product: nullable(id),
    receivedAtMs: utcMs,
    sequenceGap: { enum: ['NONE', 'PRESENT', 'UNKNOWN'] },
    sequenceId: id,
    snapshotId: id,
    sourceId: id,
    symbol: nullable(id),
    venue: nullable(id),
  },
);
const temporalContextSchema = closedObject(
  [
    'duplicateDisposition', 'futureDisposition', 'joinPolicy', 'lateDisposition',
    'maximumPairwiseSkewMs', 'maximumReferenceAgeMs', 'referenceTimeMs',
    'reorderedDisposition', 'sources', 'watermarkMs',
  ],
  {
    duplicateDisposition: { const: 'IGNORE_EXACT_DUPLICATE' },
    futureDisposition: { const: 'REJECT' },
    joinPolicy: id,
    lateDisposition: { const: 'QUARANTINE' },
    maximumPairwiseSkewMs: nonNegativeInteger,
    maximumReferenceAgeMs: positiveInteger,
    referenceTimeMs: utcMs,
    reorderedDisposition: { const: 'REJECT' },
    sources: {
      type: 'array', minItems: 1, maxItems: ACTION_EVIDENCE_LIMITS.maxTemporalSources,
      items: { $ref: '#/$defs/TemporalSource' },
    },
    watermarkMs: utcMs,
  },
);
const fencingContextSchema = closedObject(
  ['epoch', 'leaseExpiresAtMs', 'ownerEvidenceId', 'relevant'],
  {
    epoch: nullable(nonNegativeInteger),
    leaseExpiresAtMs: nullable(utcMs),
    ownerEvidenceId: nullable(id),
    relevant: { type: 'boolean' },
  },
);
const scenarioSchema = closedObject(
  [
    'bounded', 'disturbanceIds', 'excludedStateIds', 'maximumExposure',
    'maximumLiability', 'maximumRecoveryCost', 'rateLimitHeadroomKnown',
    'scenarioId', 'timeHeadroomMs',
  ],
  {
    bounded: { type: 'boolean' },
    disturbanceIds: idArray(),
    excludedStateIds: idArray(),
    maximumExposure: nullable(decimal),
    maximumLiability: nullable(decimal),
    maximumRecoveryCost: nullable(decimal),
    rateLimitHeadroomKnown: { type: 'boolean' },
    scenarioId: id,
    timeHeadroomMs: nonNegativeInteger,
  },
);
const evidenceFamilySchema = closedObject(
  [
    'assertion', 'dependencyEvidenceIds', 'evidenceIds', 'expiresAtMs', 'family',
    'maximumAgeMs', 'producedAtMs', 'producedBy', 'reasonCodes', 'sourceRefs',
    'verifiedAtMs', 'verifiedBy',
  ],
  {
    assertion: { enum: ACTION_EVIDENCE_ASSERTIONS },
    dependencyEvidenceIds: idArray(),
    evidenceIds: { ...idArray(), minItems: 1 },
    expiresAtMs: utcMs,
    family: { enum: ACTION_EVIDENCE_FAMILIES },
    maximumAgeMs: positiveInteger,
    producedAtMs: utcMs,
    producedBy: { $ref: '#/$defs/Actor' },
    reasonCodes: {
      type: 'array', minItems: 1, maxItems: ACTION_EVIDENCE_LIMITS.maxIdsPerList,
      uniqueItems: true, items: reasonCode,
    },
    sourceRefs: {
      type: 'array', minItems: 1, maxItems: ACTION_EVIDENCE_LIMITS.maxIdsPerList,
      items: { $ref: '#/$defs/EvidenceReference' },
    },
    verifiedAtMs: nullable(utcMs),
    verifiedBy: nullable({ $ref: '#/$defs/Actor' }),
  },
);
const assumptionSchema = closedObject(
  ['assumptionId', 'evidenceIds', 'expiresAtMs', 'maximumAgeMs', 'observedAtMs', 'revision', 'state'],
  {
    assumptionId: id,
    evidenceIds: { ...idArray(), minItems: 1 },
    expiresAtMs: utcMs,
    maximumAgeMs: positiveInteger,
    observedAtMs: utcMs,
    revision: id,
    state: { enum: ['SATISFIED', 'CONTRADICTED', 'UNKNOWN'] },
  },
);
const invariantSchema = closedObject(
  ['evaluatedAtMs', 'evidenceIds', 'expiresAtMs', 'invariantId', 'maximumAgeMs', 'revision', 'status'],
  {
    evaluatedAtMs: utcMs,
    evidenceIds: { ...idArray(), minItems: 1 },
    expiresAtMs: utcMs,
    invariantId: id,
    maximumAgeMs: positiveInteger,
    revision: id,
    status: { enum: ACTION_EVIDENCE_STATUSES },
  },
);
const invalidationSchema = closedObject(
  ['evidenceId', 'invalidatedAtMs', 'invalidationId', 'producerEvidenceId', 'reasonCode'],
  {
    evidenceId: id,
    invalidatedAtMs: utcMs,
    invalidationId: id,
    producerEvidenceId: id,
    reasonCode: { enum: INVALIDATION_REASON_CODES },
  },
);
const familySetSchema = (actionClass) => {
  const required = REQUIRED_EVIDENCE_FAMILIES[actionClass];
  return {
    type: 'array',
    minItems: required.length,
    maxItems: required.length,
    items: { $ref: '#/$defs/EvidenceFamily' },
    allOf: required.map((family) => ({
      contains: { type: 'object', required: ['family'], properties: { family: { const: family } } },
      minContains: 1,
      maxContains: 1,
    })),
  };
};
const recordSchemaFor = (actionClass) => closedObject(
  [
    'recordId', 'actionClass', 'actionBinding', 'identity', 'subjectDigest',
    'actionReference', 'versions', 'createdAtMs', 'maximumAgeMs', 'expiresAtMs',
    'temporalContext', 'fencingContext', 'ownerReferences', 'activeAssumptions',
    'invariantResults', 'actionFacts', 'scenarioEnvelope', 'families', 'invalidations',
  ],
  {
    recordId: id,
    actionClass: { const: actionClass },
    actionBinding: { const: FROZEN_ACTION_BINDINGS[actionClass] },
    identity: { $ref: `#/$defs/Identity_${actionClass}` },
    subjectDigest: sha256,
    actionReference: { $ref: '#/$defs/EvidenceReference' },
    versions: { $ref: `#/$defs/Versions_${actionClass}` },
    createdAtMs: utcMs,
    maximumAgeMs: positiveInteger,
    expiresAtMs: utcMs,
    temporalContext: { $ref: '#/$defs/TemporalContext' },
    fencingContext: { $ref: '#/$defs/FencingContext' },
    ownerReferences: {
      type: 'array', maxItems: ACTION_EVIDENCE_LIMITS.maxOwnerReferences,
      items: { $ref: '#/$defs/OwnerDecisionReference' },
    },
    activeAssumptions: {
      type: 'array', minItems: 1, maxItems: ACTION_EVIDENCE_LIMITS.maxActiveAssumptions,
      items: { $ref: '#/$defs/ActiveAssumption' },
    },
    invariantResults: {
      type: 'array', minItems: 1, maxItems: ACTION_EVIDENCE_LIMITS.maxInvariantResults,
      items: { $ref: '#/$defs/InvariantResult' },
    },
    actionFacts: { $ref: `#/$defs/ActionFacts_${actionClass}` },
    scenarioEnvelope: { $ref: '#/$defs/ScenarioEnvelope' },
    families: familySetSchema(actionClass),
    invalidations: {
      type: 'array', maxItems: ACTION_EVIDENCE_LIMITS.maxInvalidations,
      items: { $ref: '#/$defs/Invalidation' },
    },
  },
);

const actionSchemaDefinitions = Object.fromEntries(ACTION_EVIDENCE_CLASSES.flatMap((actionClass) => [
  [`Identity_${actionClass}`, identitySchemaFor(actionClass)],
  [`ActionFacts_${actionClass}`, actionFactsSchemaFor(actionClass)],
  [`Versions_${actionClass}`, versionsSchemaFor(actionClass)],
  [`Record_${actionClass}`, recordSchemaFor(actionClass)],
]));

export const ACTION_EVIDENCE_SCHEMA = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:cosmos:product-assurance:s2:action-evidence:v1',
  title: 'Packet-local S2 forward-looking action-safety supporting-evidence envelope',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion', 'revision', 'truthLabel', 'useClass', 'authorityEffect',
    'sourceCommits', 'record',
  ],
  properties: {
    schemaVersion: { const: ACTION_EVIDENCE_SCHEMA_VERSION },
    revision: id,
    truthLabel: { const: ACTION_EVIDENCE_TRUTH_LABEL },
    useClass: { const: ACTION_EVIDENCE_USE_CLASS },
    authorityEffect: { const: ACTION_EVIDENCE_AUTHORITY_EFFECT },
    sourceCommits: {
      type: 'object',
      additionalProperties: false,
      required: ['coreScaffold', 'hazardContracts', 'frozenL'],
      properties: {
        coreScaffold: { const: FROZEN_CORE_COMMIT },
        hazardContracts: { const: FROZEN_HAZARD_COMMIT },
        frozenL: { const: FROZEN_L_COMMIT },
      },
    },
    record: { $ref: '#/$defs/ActionEvidenceRecord' },
  },
  $defs: {
    Id: id,
    UtcMillis: utcMs,
    Sha1: sha1,
    Sha256: sha256,
    Actor: actorSchema,
    EvidenceReference: evidenceReferenceSchema,
    OwnerDecisionReference: ownerDecisionReferenceSchema,
    TemporalSource: temporalSourceSchema,
    TemporalContext: temporalContextSchema,
    FencingContext: fencingContextSchema,
    ScenarioEnvelope: scenarioSchema,
    EvidenceFamily: evidenceFamilySchema,
    ActiveAssumption: assumptionSchema,
    InvariantResult: invariantSchema,
    Invalidation: invalidationSchema,
    ...actionSchemaDefinitions,
    ActionEvidenceRecord: {
      oneOf: ACTION_EVIDENCE_CLASSES.map((actionClass) => ({ $ref: `#/$defs/Record_${actionClass}` })),
    },
  },
});

const resultFamilySchema = closedObject(
  ['dependencyEvidenceIds', 'evidenceIds', 'expiresAtMs', 'family', 'invalidationIds', 'reasonCodes', 'status'],
  {
    dependencyEvidenceIds: idArray(),
    evidenceIds: { ...idArray(), minItems: 1 },
    expiresAtMs: utcMs,
    family: { enum: ACTION_EVIDENCE_FAMILIES },
    invalidationIds: idArray(ACTION_EVIDENCE_LIMITS.maxInvalidations),
    reasonCodes: { type: 'array', minItems: 1, maxItems: ACTION_EVIDENCE_LIMITS.maxIdsPerList, uniqueItems: true, items: id },
    status: { enum: ACTION_EVIDENCE_STATUSES },
  },
);
const resultSupportSchema = (idKey) => closedObject(
  [idKey, 'evidenceIds', 'expiresAtMs', 'invalidationIds', 'reasonCodes', 'status'],
  {
    [idKey]: id,
    evidenceIds: { ...idArray(), minItems: 1 },
    expiresAtMs: utcMs,
    invalidationIds: idArray(ACTION_EVIDENCE_LIMITS.maxInvalidations),
    reasonCodes: { type: 'array', minItems: 1, maxItems: ACTION_EVIDENCE_LIMITS.maxIdsPerList, uniqueItems: true, items: id },
    status: { enum: ACTION_EVIDENCE_STATUSES },
  },
);
export const ACTION_EVIDENCE_RESULT_SCHEMA = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:cosmos:product-assurance:s2:action-evidence-result:v1',
  title: 'Closed S2 supporting-evidence evaluation result; never authority',
  ...closedObject(
    [
      'schemaVersion', 'recordId', 'actionClass', 'truthLabel', 'useClass',
      'authorityEffect', 'evaluatedAtMs', 'status', 'reasonCodes', 'familyResults',
      'assumptionResults', 'invariantResults', 'invalidatedEvidenceIds',
      'nextCurrentnessBoundaryAtMs', 'commandsIssued',
      'canonicalRiskReductionUnaffected',
    ],
    {
      schemaVersion: { const: ACTION_EVIDENCE_RESULT_SCHEMA_VERSION },
      recordId: nullable(id),
      actionClass: nullable({ enum: ACTION_EVIDENCE_CLASSES }),
      truthLabel: { const: ACTION_EVIDENCE_TRUTH_LABEL },
      useClass: { const: ACTION_EVIDENCE_USE_CLASS },
      authorityEffect: { const: ACTION_EVIDENCE_AUTHORITY_EFFECT },
      evaluatedAtMs: nullable(utcMs),
      status: { enum: ACTION_EVIDENCE_STATUSES },
      reasonCodes: { type: 'array', minItems: 1, maxItems: ACTION_EVIDENCE_LIMITS.maxIdsPerList, uniqueItems: true, items: id },
      familyResults: { type: 'array', maxItems: ACTION_EVIDENCE_LIMITS.maxFamiliesPerRecord, items: resultFamilySchema },
      assumptionResults: { type: 'array', maxItems: ACTION_EVIDENCE_LIMITS.maxActiveAssumptions, items: resultSupportSchema('assumptionId') },
      invariantResults: { type: 'array', maxItems: ACTION_EVIDENCE_LIMITS.maxInvariantResults, items: resultSupportSchema('invariantId') },
      invalidatedEvidenceIds: idArray(ACTION_EVIDENCE_LIMITS.maxInvalidations),
      nextCurrentnessBoundaryAtMs: nullable(utcMs),
      commandsIssued: { const: 0 },
      canonicalRiskReductionUnaffected: { const: true },
    },
  ),
});

export const ACTION_EVIDENCE_USE_REQUEST_SCHEMA = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:cosmos:product-assurance:s2:action-evidence-use-request:v1',
  ...closedObject(
    ['canonicalOwnerDecisionIds', 'consumerId', 'purpose', 'recordId', 'schemaVersion'],
    {
      canonicalOwnerDecisionIds: idArray(),
      consumerId: id,
      purpose: { const: ACTION_EVIDENCE_USE_CLASS },
      recordId: id,
      schemaVersion: { const: ACTION_EVIDENCE_USE_SCHEMA_VERSION },
    },
  ),
});

export const ACTION_EVIDENCE_USE_PROJECTION_SCHEMA = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:cosmos:product-assurance:s2:action-evidence-use-projection:v1',
  ...closedObject(
    [
      'authorityEffect', 'canonicalOwnerDecisionIds', 'commandsIssued', 'consumerId',
      'evaluatedAtMs', 'evidenceStatus', 'familyStatuses',
      'nextCurrentnessBoundaryAtMs', 'recordId', 'schemaVersion', 'truthLabel',
      'useClass',
    ],
    {
      authorityEffect: { const: ACTION_EVIDENCE_AUTHORITY_EFFECT },
      canonicalOwnerDecisionIds: idArray(),
      commandsIssued: { const: 0 },
      consumerId: id,
      evaluatedAtMs: utcMs,
      evidenceStatus: { enum: ACTION_EVIDENCE_STATUSES },
      familyStatuses: {
        type: 'array', maxItems: ACTION_EVIDENCE_LIMITS.maxFamiliesPerRecord,
        items: closedObject(['family', 'status'], {
          family: { enum: ACTION_EVIDENCE_FAMILIES },
          status: { enum: ACTION_EVIDENCE_STATUSES },
        }),
      },
      nextCurrentnessBoundaryAtMs: nullable(utcMs),
      recordId: id,
      schemaVersion: { const: ACTION_EVIDENCE_USE_SCHEMA_VERSION },
      truthLabel: { const: ACTION_EVIDENCE_TRUTH_LABEL },
      useClass: { const: ACTION_EVIDENCE_USE_CLASS },
    },
  ),
});

export const ACTION_EVIDENCE_FIXTURE_BUNDLE_SCHEMA = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:cosmos:product-assurance:s2:action-evidence-fixture-bundle:v1',
  title: 'Packet-local S2 fixture bundle; never a cross-action decision or ranking input',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'truthLabel', 'useClass', 'authorityEffect', 'envelopes'],
  properties: {
    schemaVersion: { const: ACTION_EVIDENCE_FIXTURE_BUNDLE_SCHEMA_VERSION },
    truthLabel: { const: ACTION_EVIDENCE_TRUTH_LABEL },
    useClass: { const: ACTION_EVIDENCE_USE_CLASS },
    authorityEffect: { const: ACTION_EVIDENCE_AUTHORITY_EFFECT },
    envelopes: {
      type: 'array',
      minItems: ACTION_EVIDENCE_CLASSES.length,
      maxItems: ACTION_EVIDENCE_CLASSES.length,
      items: { $ref: 'urn:cosmos:product-assurance:s2:action-evidence:v1' },
    },
  },
});

export { deepFreeze };

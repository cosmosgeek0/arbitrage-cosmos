import {
  ACTION_EVIDENCE_AUTHORITY_EFFECT,
  ACTION_EVIDENCE_CLASSES,
  ACTION_EVIDENCE_FIXTURE_BUNDLE_SCHEMA_VERSION,
  ACTION_EVIDENCE_SCHEMA_VERSION,
  ACTION_EVIDENCE_TRUTH_LABEL,
  ACTION_EVIDENCE_USE_CLASS,
  EVIDENCE_SOURCE_ROLES_BY_CLASS,
  FROZEN_ACTION_BINDINGS,
  FROZEN_AUTHORITY_MAP_COMMIT,
  FROZEN_CORE_COMMIT,
  FROZEN_HAZARD_COMMIT,
  FROZEN_L_COMMIT,
  REQUIRED_EVIDENCE_DEPENDENCY_FAMILIES,
  REQUIRED_EVIDENCE_FAMILIES,
  canonicalStringify,
  deepFreeze,
  evidenceSourceOwnerFor,
  sha256Hex,
} from '../contracts/index.mjs';
import {
  frozenControlActionMaterial,
  frozenPolicyActionMaterial,
} from '../contracts/internal-binding.mjs';

export const FIXTURE_NOW_MS = 1_800_000_000_000;

const CLASS_CODES = Object.freeze({
  ORDER_INTENT: 'OI',
  CANCELLATION: 'CA',
  REPAIR_STEP: 'RS',
  HALT: 'HA',
  RECOVERY_STEP: 'RC',
});

const FAMILY_CODES = Object.freeze({
  ACTION_BINDING: 'BIND',
  FRESHNESS_AND_TEMPORAL_COHERENCE: 'TIME',
  FENCING_AND_IDEMPOTENCY: 'FENCE',
  LIFECYCLE_STATE_AND_OUTCOME: 'LIFE',
  EXPOSURE_AND_LIABILITY_BOUNDS: 'BOUND',
  OUTCOME_OBSERVABILITY_AND_SUPERVISION: 'OBS',
  MUTATION_INPUT_TRUTH: 'INPUT',
  CANCELLATION_AND_LATE_RESULT: 'CANCEL',
  REGISTERED_RECOVERY_OR_REPAIR_PATH: 'PATH',
});

const digest = (character) => character.repeat(64);

export function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clonePlain(child)]));
  }
  return value;
}

function identityFor(actionClass) {
  let identity;
  switch (actionClass) {
    case 'ORDER_INTENT':
      identity = {
        actionSchema: 'EXECUTION_POLICY_ACTION_V1',
        actionId: 'l08_action_place_001',
        actionRevision: 'l08_action_revision_001',
        step: 0,
        legId: 'foundation_leg_place_001',
        orderType: 'LIMIT',
        timeInForce: 'GTC',
        quantitySource: 'AUTHORIZED_FILTERED_QUANTITY',
        price: '50000',
        targetActionId: null,
        dependsOnActualFillLegId: null,
        requiresConfirmedCancelActionId: null,
        exposureEffect: 'MAY_OPEN_WITHIN_AUTHORIZATION',
        recoveryEvidenceRevision: null,
        targetExposureRevision: null,
        deadlineOffsetMs: 5_000,
        ambiguityPosture: 'RECONCILE_ONLY',
        intentId: 'capital_intent_001',
        intentRevision: 'capital_intent_revision_001',
        externalPlanId: 'foundation_plan_001',
        correlationId: 'correlation_action_001',
        venue: 'BINANCE',
        product: 'SPOT',
        symbol: 'BTCUSDT',
        accountRealmId: 'account_realm_synthetic_001',
        side: 'BUY',
        quantity: '0.001',
      };
      break;
    case 'CANCELLATION':
      identity = {
        actionSchema: 'EXECUTION_POLICY_ACTION_V1',
        actionId: 'l08_action_cancel_001',
        actionRevision: 'l08_cancel_revision_001',
        step: 1,
        legId: 'foundation_leg_place_001',
        orderType: null,
        timeInForce: null,
        quantity: null,
        quantitySource: null,
        price: null,
        dependsOnActualFillLegId: null,
        requiresConfirmedCancelActionId: null,
        exposureEffect: 'NO_EXPOSURE_EFFECT',
        recoveryEvidenceRevision: null,
        targetExposureRevision: null,
        deadlineOffsetMs: 5_000,
        ambiguityPosture: 'RECONCILE_ONLY',
        targetActionId: `epact_${digest('b')}`,
        mutationId: 'l06_mutation_cancel_001',
        commandId: `cmd_${'c'.repeat(32)}`,
        correlationId: 'correlation_cancel_001',
        venue: 'BINANCE',
        product: 'SPOT',
        symbol: 'BTCUSDT',
        accountRealmId: 'account_realm_synthetic_001',
      };
      break;
    case 'REPAIR_STEP':
      identity = {
        commandId: `cmd_${'d'.repeat(32)}`,
        actionType: 'SAFE_RESTART_COMPONENT',
        correlationId: 'correlation_repair_001',
        componentId: 'control-plane-runtime',
        componentOwner: 'FOUNDATION_CONTROL',
        componentReferenceSchema: 'LIVE_EDGE_OPAQUE_OWNER_REFERENCE_V1',
        componentRevision: 'foundation_control_component_revision_001',
        componentDigest: digest('f'),
        expectedControlRevision: 7,
        restartMode: 'SAFE_RECONCILE_FIRST',
      };
      break;
    case 'HALT':
      identity = {
        commandId: `cmd_${'e'.repeat(32)}`,
        actionType: 'HALT',
        correlationId: 'correlation_halt_001',
        expectedControlRevision: 8,
        scope: 'NEW_RISK',
        retainSupervision: true,
      };
      break;
    case 'RECOVERY_STEP':
      identity = {
        actionSchema: 'EXECUTION_POLICY_ACTION_V1',
        actionId: 'l08_action_recover_001',
        actionRevision: 'l08_recovery_revision_001',
        step: 2,
        legId: 'foundation_leg_recovery_001',
        orderType: 'MARKET',
        timeInForce: null,
        quantity: '0.0005',
        price: null,
        targetActionId: null,
        dependsOnActualFillLegId: 'foundation_leg_actual_fill_001',
        requiresConfirmedCancelActionId: null,
        deadlineOffsetMs: 5_000,
        ambiguityPosture: 'RECONCILE_ONLY',
        recoveryEvidenceRevision: 'foundation_recovery_evidence_001',
        targetExposureRevision: 'capital_exposure_revision_001',
        actualFillLegId: 'foundation_leg_actual_fill_001',
        planId: 'foundation_plan_recovery_001',
        correlationId: 'correlation_recovery_001',
        venue: 'BINANCE',
        product: 'USD_M_PERPETUAL',
        symbol: 'BTCUSDT',
        accountRealmId: 'account_realm_synthetic_001',
        quantitySource: 'RISK_REDUCING_RECOVERY_EVIDENCE',
        exposureEffect: 'RISK_REDUCING_ONLY',
      };
      break;
  }
  if (['ORDER_INTENT', 'CANCELLATION', 'RECOVERY_STEP'].includes(actionClass)) {
    const contentHash = sha256Hex(canonicalStringify(frozenPolicyActionMaterial(
      identity,
      FROZEN_ACTION_BINDINGS[actionClass].discriminantValue,
    )));
    identity.actionId = `epact_${contentHash}`;
    identity.actionRevision = `epactrev_${contentHash}`;
  } else {
    identity.actionDigest = `sha256:${sha256Hex(canonicalStringify({
      schema: 'LIVE_EDGE_CONTROL_ACTION_DIGEST_V1',
      action: frozenControlActionMaterial(identity, actionClass),
    }))}`;
  }
  return identity;
}

function versionsFor(actionClass) {
  return {
    releaseId: 'PA-S2-FIXTURE-RELEASE-001',
    policyRevision: actionClass === 'REPAIR_STEP' || actionClass === 'HALT'
      ? 'L14_DURABLE_CONTROL_V1'
      : 'L08_EXECUTION_POLICY_V1',
    modelRevision: null,
    schemaRevision: ACTION_EVIDENCE_SCHEMA_VERSION,
    authorityMapCommit: FROZEN_AUTHORITY_MAP_COMMIT,
    ownerContractCommit: FROZEN_L_COMMIT,
  };
}

function temporalSource({ code, index, product, identity, componentId = null }) {
  const eventAtMs = FIXTURE_NOW_MS - 2_000 + (index * 50);
  return {
    sourceId: `PA-S2-SRC-${code}-${index}`,
    evidenceId: `PA-S2-TEMP-${code}-${index}`,
    venue: componentId === null ? identity.venue : null,
    product: componentId === null ? product : null,
    symbol: componentId === null ? identity.symbol : null,
    accountRealmId: componentId === null ? identity.accountRealmId : null,
    componentId,
    eventAtMs,
    receivedAtMs: eventAtMs + 25,
    availableAtMs: eventAtMs + 50,
    processedAtMs: eventAtMs + 75,
    maximumAgeMs: 10_000,
    expiresAtMs: FIXTURE_NOW_MS + 15_000,
    sequenceId: `PA-S2-SEQ-${code}-${index}`,
    snapshotId: `PA-S2-SNAPSHOT-${code}-${index}`,
    sequenceGap: 'NONE',
    clockQuality: 'BOUNDED',
  };
}

function temporalContextFor(actionClass, identity) {
  const code = CLASS_CODES[actionClass];
  const trade = ['ORDER_INTENT', 'CANCELLATION', 'RECOVERY_STEP'].includes(actionClass);
  const sources = trade
    ? [
        temporalSource({ code, index: 1, product: 'SPOT', identity }),
        temporalSource({ code, index: 2, product: 'USD_M_PERPETUAL', identity }),
        temporalSource({ code, index: 3, product: 'ACCOUNT', identity }),
      ]
    : [
        temporalSource({
          code,
          index: 1,
          product: null,
          identity,
          componentId: 'control-plane-runtime',
        }),
      ];
  return {
    referenceTimeMs: FIXTURE_NOW_MS - 1_000,
    maximumReferenceAgeMs: 10_000,
    maximumPairwiseSkewMs: 250,
    joinPolicy: 'PA-S2-BOUNDED-WATERMARK-001',
    watermarkMs: FIXTURE_NOW_MS - 1_200,
    lateDisposition: 'QUARANTINE',
    reorderedDisposition: 'REJECT',
    duplicateDisposition: 'IGNORE_EXACT_DUPLICATE',
    futureDisposition: 'REJECT',
    sources,
  };
}

function dependencyFamiliesFor(family) {
  return REQUIRED_EVIDENCE_DEPENDENCY_FAMILIES[family] ?? [];
}

function evidenceId(actionClass, family) {
  return `PA-S2-EV-${CLASS_CODES[actionClass]}-${FAMILY_CODES[family]}`;
}

const sourceRolesFor = (actionClass, family) => {
  return EVIDENCE_SOURCE_ROLES_BY_CLASS[actionClass]?.[family] ?? [];
};

const sourceDigest = (actionClass, family, index) => {
  const seed = (CLASS_CODES[actionClass].charCodeAt(0)
    + FAMILY_CODES[family].charCodeAt(0) + index) % 16;
  return seed.toString(16).repeat(64);
};

const actionReferenceDigest = (actionClass, identity) => (
  actionClass === 'REPAIR_STEP' || actionClass === 'HALT'
    ? identity.actionDigest
    : identity.actionId.slice('epact_'.length)
);

const sourceRefsFor = (actionClass, family, identity) => {
  const baseId = evidenceId(actionClass, family);
  return sourceRolesFor(actionClass, family).map((sourceRole, index) => ({
    sourceRole,
    ownerId: evidenceSourceOwnerFor(actionClass, sourceRole),
    referenceId: index === 0 ? baseId : `${baseId}-${sourceRole}`,
    revision: `PA-S2-SOURCE-REVISION-${CLASS_CODES[actionClass]}-${FAMILY_CODES[family]}-${index}`,
    digest: sourceRole === 'ACTION'
      ? actionReferenceDigest(actionClass, identity)
      : sourceDigest(actionClass, family, index),
    observedAtMs: FIXTURE_NOW_MS - 1_000,
    maximumAgeMs: 10_000,
    expiresAtMs: FIXTURE_NOW_MS + 30_000,
  }));
};

const producerOwnerFor = (actionClass, family) => (
  evidenceSourceOwnerFor(actionClass, sourceRolesFor(actionClass, family)[0])
);

function familyFor(actionClass, family, identity) {
  const code = CLASS_CODES[actionClass];
  const sourceRefs = sourceRefsFor(actionClass, family, identity);
  return {
    family,
    assertion: 'SATISFIED',
    evidenceIds: sourceRefs.map((source) => source.referenceId),
    dependencyEvidenceIds: dependencyFamiliesFor(family).map((dependency) => (
      evidenceId(actionClass, dependency)
    )),
    sourceRefs,
    producedBy: {
      actorId: `PA-S2-PRODUCER-${code}-${FAMILY_CODES[family]}`,
      ownerId: producerOwnerFor(actionClass, family),
      independenceDomainId: `PA-S2-PRODUCER-DOMAIN-${code}`,
      role: 'PRODUCER',
    },
    verifiedBy: {
      actorId: `PA-S2-VERIFIER-${code}-${FAMILY_CODES[family]}`,
      ownerId: 'PA-S2-INDEPENDENT-FIXTURE-VERIFIER',
      independenceDomainId: `PA-S2-VERIFIER-DOMAIN-${code}`,
      role: 'VERIFIER',
    },
    producedAtMs: FIXTURE_NOW_MS - 900,
    verifiedAtMs: FIXTURE_NOW_MS - 500,
    maximumAgeMs: 5_000,
    expiresAtMs: FIXTURE_NOW_MS + 30_000,
    reasonCodes: ['CURRENT_SYNTHETIC_FIXTURE'],
  };
}

function actionFactsFor(actionClass) {
  switch (actionClass) {
    case 'ORDER_INTENT':
      return {
        factType: 'ORDER_INTENT_FACTS',
        ownerTruthState: 'CURRENT',
        partialFillState: 'NONE',
        recoveryPathState: 'CURRENT',
        rateLimitState: 'AVAILABLE',
        leaseState: 'HELD',
        ownerDecisionReferenceState: 'ABSENT',
        signedAtMs: FIXTURE_NOW_MS - 1_000,
        acknowledgedAtMs: FIXTURE_NOW_MS - 500,
        leaseLossObservedAtMs: null,
      };
    case 'CANCELLATION':
      return {
        factType: 'CANCELLATION_FACTS',
        cancellationState: 'CANCELLED',
        cancellationRequestedAtMs: FIXTURE_NOW_MS - 2_000,
        localTimeoutAtMs: FIXTURE_NOW_MS - 1_000,
        terminalAtMs: FIXTURE_NOW_MS - 500,
        latestFillAtMs: null,
        cumulativeFilledQuantity: '0',
        ownerTruthState: 'CURRENT',
        recoveryPathState: 'CURRENT',
        rateLimitState: 'AVAILABLE',
        leaseState: 'HELD',
        ownerDecisionReferenceState: 'ABSENT',
        signedAtMs: FIXTURE_NOW_MS - 2_100,
        acknowledgedAtMs: FIXTURE_NOW_MS - 1_900,
        leaseLossObservedAtMs: null,
      };
    case 'REPAIR_STEP':
      return {
        factType: 'REPAIR_STEP_FACTS',
        leaseState: 'HELD',
        receiptState: 'APPLIED',
        postconditionState: 'RECONCILED_HEALTHY',
        postconditionObservedAtMs: FIXTURE_NOW_MS - 500,
        postconditionExpiresAtMs: FIXTURE_NOW_MS + 30_000,
      };
    case 'HALT':
      return {
        factType: 'HALT_FACTS',
        receiptState: 'APPLIED',
        readbackState: 'HALTED',
        readbackObservedAtMs: FIXTURE_NOW_MS - 500,
        readbackExpiresAtMs: FIXTURE_NOW_MS + 30_000,
      };
    case 'RECOVERY_STEP':
      return {
        factType: 'RECOVERY_STEP_FACTS',
        executionBindingState: 'PRECOMPUTED_EXECUTION_BOUND',
        lateResultState: 'NONE',
        ownerTruthState: 'CURRENT',
        partialFillState: 'BOUNDED',
        recoveryPathState: 'CURRENT',
        rateLimitState: 'AVAILABLE',
        leaseState: 'HELD',
        ownerDecisionReferenceState: 'ABSENT',
        recommendationAutomatic: false,
      };
  }
}

function actionReferenceFor(actionClass, identity) {
  const control = actionClass === 'REPAIR_STEP' || actionClass === 'HALT';
  return {
    sourceRole: 'ACTION',
    ownerId: FROZEN_ACTION_BINDINGS[actionClass].ownerId,
    referenceId: control ? identity.commandId : identity.actionId,
    revision: control ? `control_revision_${identity.expectedControlRevision}` : identity.actionRevision,
    digest: actionReferenceDigest(actionClass, identity),
    observedAtMs: FIXTURE_NOW_MS - 1_000,
    maximumAgeMs: 10_000,
    expiresAtMs: FIXTURE_NOW_MS + 30_000,
  };
}

export function buildActionEvidenceEnvelope(actionClass) {
  if (!ACTION_EVIDENCE_CLASSES.includes(actionClass)) {
    throw new TypeError('actionClass must be one of the five frozen S2 classes');
  }
  const code = CLASS_CODES[actionClass];
  const identity = identityFor(actionClass);
  const subjectDigest = sha256Hex(canonicalStringify({
    actionClass,
    actionBinding: FROZEN_ACTION_BINDINGS[actionClass],
    identity,
  }));
  const fencingRelevant = actionClass !== 'HALT';
  return deepFreeze({
    schemaVersion: ACTION_EVIDENCE_SCHEMA_VERSION,
    revision: `PA-S2-ENVELOPE-${code}-001`,
    truthLabel: ACTION_EVIDENCE_TRUTH_LABEL,
    useClass: ACTION_EVIDENCE_USE_CLASS,
    authorityEffect: ACTION_EVIDENCE_AUTHORITY_EFFECT,
    sourceCommits: {
      coreScaffold: FROZEN_CORE_COMMIT,
      hazardContracts: FROZEN_HAZARD_COMMIT,
      frozenL: FROZEN_L_COMMIT,
    },
    record: {
      recordId: `PA-S2-RECORD-${code}-001`,
      actionClass,
      actionBinding: FROZEN_ACTION_BINDINGS[actionClass],
      identity,
      subjectDigest,
      actionReference: actionReferenceFor(actionClass, identity),
      versions: versionsFor(actionClass),
      createdAtMs: FIXTURE_NOW_MS - 5_000,
      maximumAgeMs: 60_000,
      expiresAtMs: FIXTURE_NOW_MS + 60_000,
      temporalContext: temporalContextFor(actionClass, identity),
      fencingContext: {
        relevant: fencingRelevant,
        epoch: fencingRelevant ? 7 : null,
        ownerEvidenceId: fencingRelevant
          ? evidenceId(actionClass, 'FENCING_AND_IDEMPOTENCY')
          : null,
        leaseExpiresAtMs: fencingRelevant ? FIXTURE_NOW_MS + 45_000 : null,
      },
      // Canonical Capital, Risk, command, and owner decisions remain optional
      // opaque references outside evidence-status aggregation. Empty is legal
      // and proves PASS is not an approval or action-admission token.
      ownerReferences: [],
      activeAssumptions: [{
        assumptionId: `PA-S2-ASSUMPTION-${code}-001`,
        revision: `PA-S2-ASSUMPTION-REVISION-${code}-001`,
        state: 'SATISFIED',
        evidenceIds: [evidenceId(actionClass, 'EXPOSURE_AND_LIABILITY_BOUNDS')],
        observedAtMs: FIXTURE_NOW_MS - 700,
        maximumAgeMs: 10_000,
        expiresAtMs: FIXTURE_NOW_MS + 30_000,
      }],
      invariantResults: [{
        invariantId: `PA-S2-INVARIANT-${code}-001`,
        revision: `PA-S2-INVARIANT-REVISION-${code}-001`,
        status: 'PASS',
        evidenceIds: [evidenceId(actionClass, 'ACTION_BINDING')],
        evaluatedAtMs: FIXTURE_NOW_MS - 600,
        maximumAgeMs: 10_000,
        expiresAtMs: FIXTURE_NOW_MS + 30_000,
      }],
      actionFacts: actionFactsFor(actionClass),
      scenarioEnvelope: {
        scenarioId: `PA-S2-SCENARIO-${code}-001`,
        bounded: true,
        disturbanceIds: [`PA-S2-DISTURBANCE-${code}-001`],
        excludedStateIds: [`PA-S2-EXCLUDED-${code}-001`],
        maximumExposure: actionClass === 'HALT' || actionClass === 'REPAIR_STEP' ? '0' : '10',
        maximumLiability: '0',
        maximumRecoveryCost: actionClass === 'HALT' || actionClass === 'REPAIR_STEP' ? '0' : '2',
        timeHeadroomMs: 20_000,
        rateLimitHeadroomKnown: true,
      },
      families: REQUIRED_EVIDENCE_FAMILIES[actionClass].map((family) => (
        familyFor(actionClass, family, identity)
      )),
      invalidations: [],
    },
  });
}

export function buildCompleteActionEvidenceFixtureBundle() {
  return deepFreeze({
    schemaVersion: ACTION_EVIDENCE_FIXTURE_BUNDLE_SCHEMA_VERSION,
    truthLabel: ACTION_EVIDENCE_TRUTH_LABEL,
    useClass: ACTION_EVIDENCE_USE_CLASS,
    authorityEffect: ACTION_EVIDENCE_AUTHORITY_EFFECT,
    envelopes: ACTION_EVIDENCE_CLASSES.map(buildActionEvidenceEnvelope),
  });
}

export const COMPLETE_ACTION_EVIDENCE_FIXTURE_BUNDLE = buildCompleteActionEvidenceFixtureBundle();

import { deepFreeze } from '../contracts/index.mjs';
import {
  FIXTURE_NOW_MS,
  buildActionEvidenceEnvelope,
  clonePlain,
} from './baseline.mjs';

const mutateEnvelope = (actionClass, change) => {
  const envelope = clonePlain(buildActionEvidenceEnvelope(actionClass));
  change(envelope);
  return deepFreeze(envelope);
};

const family = (envelope, familyName) => (
  envelope.record.families.find((entry) => entry.family === familyName)
);

export const buildFreshButIncoherentFixture = () => mutateEnvelope('ORDER_INTENT', (envelope) => {
  envelope.revision = 'PA-S2-COUNTEREXAMPLE-FRESH-INCOHERENT';
  const source = envelope.record.temporalContext.sources[1];
  source.eventAtMs = FIXTURE_NOW_MS - 1_400;
  source.receivedAtMs = FIXTURE_NOW_MS - 1_375;
  source.availableAtMs = FIXTURE_NOW_MS - 1_350;
  source.processedAtMs = FIXTURE_NOW_MS - 1_325;
});

export const buildChangedTruthAfterProposalFixture = () => mutateEnvelope('ORDER_INTENT', (envelope) => {
  envelope.revision = 'PA-S2-COUNTEREXAMPLE-OWNER-REVISION-CHANGED';
  envelope.record.actionFacts.ownerTruthState = 'CHANGED_AFTER_PROPOSAL';
  const target = family(envelope, 'MUTATION_INPUT_TRUTH').evidenceIds[0];
  envelope.record.invalidations.push({
    invalidationId: 'PA-S2-INVALIDATION-OWNER-REVISION-001',
    evidenceId: target,
    invalidatedAtMs: FIXTURE_NOW_MS - 100,
    reasonCode: 'OWNER_REVISION_CHANGED',
    producerEvidenceId: 'PA-S2-OWNER-REVISION-CHANGE-EVIDENCE-001',
  });
});

export const buildPartialFillRateLimitedRecoveryFixture = () => mutateEnvelope('RECOVERY_STEP', (envelope) => {
  envelope.revision = 'PA-S2-COUNTEREXAMPLE-PARTIAL-RATE-LIMITED';
  envelope.record.actionFacts.partialFillState = 'PARTIALLY_FILLED';
  envelope.record.actionFacts.rateLimitState = 'RATE_LIMITED';
});

export const buildMissingRegisteredFallbackFixture = () => mutateEnvelope('CANCELLATION', (envelope) => {
  envelope.revision = 'PA-S2-COUNTEREXAMPLE-FALLBACK-MISSING';
  envelope.record.actionFacts.recoveryPathState = 'MISSING';
});

export const buildStaleApprovalReplayFixture = () => mutateEnvelope('ORDER_INTENT', (envelope) => {
  envelope.revision = 'PA-S2-COUNTEREXAMPLE-STALE-APPROVAL-REPLAY';
  envelope.record.actionFacts.ownerDecisionReferenceState = 'SUBJECT_MISMATCH';
  envelope.record.ownerReferences.push({
    sourceRole: 'OWNER_DECISION',
    ownerId: 'CAPITAL_APPROVALS',
    referenceId: 'capital_approval_old_subject_001',
    revision: 'capital_approval_revision_old_001',
    digest: 'b'.repeat(64),
    observedAtMs: FIXTURE_NOW_MS - 20_000,
    maximumAgeMs: 5_000,
    expiresAtMs: FIXTURE_NOW_MS + 1_000,
    binding: {
      subjectDigest: 'c'.repeat(64),
      releaseId: envelope.record.versions.releaseId,
      policyRevision: envelope.record.versions.policyRevision,
      authorityMapCommit: envelope.record.versions.authorityMapCommit,
    },
  });
});

export const buildLeaseLossBeforeAcknowledgementFixture = () => mutateEnvelope('ORDER_INTENT', (envelope) => {
  envelope.revision = 'PA-S2-COUNTEREXAMPLE-LEASE-LOSS';
  envelope.record.actionFacts.leaseState = 'LOST';
  envelope.record.actionFacts.leaseLossObservedAtMs = FIXTURE_NOW_MS - 750;
});

export const buildLateFillAfterCancelFixture = () => mutateEnvelope('CANCELLATION', (envelope) => {
  envelope.revision = 'PA-S2-COUNTEREXAMPLE-LATE-FILL-AFTER-CANCEL';
  envelope.record.actionFacts.latestFillAtMs = FIXTURE_NOW_MS - 250;
  envelope.record.actionFacts.cumulativeFilledQuantity = '0.0005';
  for (const familyName of [
    'FENCING_AND_IDEMPOTENCY',
    'LIFECYCLE_STATE_AND_OUTCOME',
    'OUTCOME_OBSERVABILITY_AND_SUPERVISION',
    'CANCELLATION_AND_LATE_RESULT',
    'REGISTERED_RECOVERY_OR_REPAIR_PATH',
  ]) {
    family(envelope, familyName).verifiedAtMs = FIXTURE_NOW_MS - 100;
  }
});

export const buildExpiredBackupPathFixture = () => mutateEnvelope('RECOVERY_STEP', (envelope) => {
  envelope.revision = 'PA-S2-COUNTEREXAMPLE-BACKUP-PATH-EXPIRED';
  envelope.record.actionFacts.recoveryPathState = 'EXPIRED';
  const target = family(envelope, 'REGISTERED_RECOVERY_OR_REPAIR_PATH');
  target.expiresAtMs = FIXTURE_NOW_MS;
  target.sourceRefs.forEach((reference) => { reference.expiresAtMs = FIXTURE_NOW_MS; });
});

export const buildUnboundedLiabilityFixture = () => mutateEnvelope('RECOVERY_STEP', (envelope) => {
  envelope.revision = 'PA-S2-COUNTEREXAMPLE-UNBOUNDED-LIABILITY';
  envelope.record.scenarioEnvelope.bounded = false;
  envelope.record.scenarioEnvelope.maximumLiability = null;
  envelope.record.scenarioEnvelope.maximumRecoveryCost = null;
});

export const buildPassWithoutCanonicalOwnerDecisionFixture = () => mutateEnvelope('ORDER_INTENT', (envelope) => {
  envelope.revision = 'PA-S2-COUNTEREXAMPLE-PASS-WITHOUT-OWNER-DECISION';
  envelope.record.ownerReferences = [];
});

export const buildStaleContradictionFixture = () => mutateEnvelope('ORDER_INTENT', (envelope) => {
  envelope.revision = 'PA-S2-COUNTEREXAMPLE-STALE-CONTRADICTION';
  const target = family(envelope, 'ACTION_BINDING');
  target.assertion = 'CONTRADICTED';
  target.reasonCodes = ['PREVIOUS_BINDING_CONTRADICTION'];
  target.producedAtMs = FIXTURE_NOW_MS - 11_000;
  target.verifiedAtMs = FIXTURE_NOW_MS - 10_000;
  target.maximumAgeMs = 1_000;
  envelope.record.actionReference.observedAtMs = FIXTURE_NOW_MS - 12_000;
  target.sourceRefs[0].observedAtMs = FIXTURE_NOW_MS - 12_000;
});

export const buildDirectInvalidationFixture = () => mutateEnvelope('ORDER_INTENT', (envelope) => {
  envelope.revision = 'PA-S2-COUNTEREXAMPLE-DIRECT-INVALIDATION';
  const target = family(envelope, 'ACTION_BINDING').evidenceIds[0];
  envelope.record.invalidations.push({
    invalidationId: 'PA-S2-INVALIDATION-BINDING-001',
    evidenceId: target,
    invalidatedAtMs: FIXTURE_NOW_MS - 1,
    reasonCode: 'SUBJECT_BINDING_CHANGED',
    producerEvidenceId: 'PA-S2-SUBJECT-CHANGE-EVIDENCE-001',
  });
});

export const buildProducerVerifierCollisionFixture = () => mutateEnvelope('HALT', (envelope) => {
  envelope.revision = 'PA-S2-COUNTEREXAMPLE-PRODUCER-VERIFIER-COLLISION';
  const target = family(envelope, 'ACTION_BINDING');
  target.verifiedBy.actorId = target.producedBy.actorId;
});

export const buildMissingVerifierFixture = () => mutateEnvelope('HALT', (envelope) => {
  envelope.revision = 'PA-S2-COUNTEREXAMPLE-VERIFIER-MISSING';
  const target = family(envelope, 'ACTION_BINDING');
  target.verifiedBy = null;
  target.verifiedAtMs = null;
});

export const buildDependencyCycleFixture = () => mutateEnvelope('HALT', (envelope) => {
  envelope.revision = 'PA-S2-COUNTEREXAMPLE-DEPENDENCY-CYCLE';
  const binding = family(envelope, 'ACTION_BINDING');
  const outcome = family(envelope, 'OUTCOME_OBSERVABILITY_AND_SUPERVISION');
  binding.dependencyEvidenceIds = [outcome.evidenceIds[0]];
});

export const MANDATORY_SECTION_3_COUNTEREXAMPLES = deepFreeze([
  {
    fixtureId: 'PA-S2-FX-FRESH-INCOHERENT',
    requirement: 'INDIVIDUALLY_FRESH_SOURCES_FAIL_MUTUAL_COHERENCE',
    expectedStatus: 'UNKNOWN',
    envelope: buildFreshButIncoherentFixture(),
  },
  {
    fixtureId: 'PA-S2-FX-OWNER-TRUTH-CHANGED',
    requirement: 'FILTER_FEE_FUNDING_OR_BORROW_TRUTH_CHANGED',
    expectedStatus: 'UNKNOWN',
    envelope: buildChangedTruthAfterProposalFixture(),
  },
  {
    fixtureId: 'PA-S2-FX-PARTIAL-RATE-LIMITED',
    requirement: 'PARTIAL_FILL_RECOVERY_PATH_RATE_LIMITED',
    expectedStatus: 'FAIL',
    envelope: buildPartialFillRateLimitedRecoveryFixture(),
  },
  {
    fixtureId: 'PA-S2-FX-FALLBACK-MISSING',
    requirement: 'OWNER_REGISTERED_FALLBACK_MISSING',
    expectedStatus: 'FAIL',
    envelope: buildMissingRegisteredFallbackFixture(),
  },
  {
    fixtureId: 'PA-S2-FX-STALE-APPROVAL-REPLAY',
    requirement: 'STALE_APPROVAL_REPLAY_SUBJECT_OR_POLICY_MISMATCH',
    expectedStatus: 'UNKNOWN',
    envelope: buildStaleApprovalReplayFixture(),
  },
  {
    fixtureId: 'PA-S2-FX-LEASE-LOSS',
    requirement: 'LEASE_LOST_BEFORE_ACKNOWLEDGEMENT',
    expectedStatus: 'FAIL',
    envelope: buildLeaseLossBeforeAcknowledgementFixture(),
  },
  {
    fixtureId: 'PA-S2-FX-LATE-FILL-AFTER-CANCEL',
    requirement: 'LATE_FILL_AFTER_TIMEOUT_OR_CANCEL',
    expectedStatus: 'FAIL',
    envelope: buildLateFillAfterCancelFixture(),
  },
  {
    fixtureId: 'PA-S2-FX-BACKUP-PATH-EXPIRED',
    requirement: 'BACKUP_PATH_EVIDENCE_EXPIRED',
    expectedStatus: 'UNKNOWN',
    envelope: buildExpiredBackupPathFixture(),
  },
  {
    fixtureId: 'PA-S2-FX-UNBOUNDED-LIABILITY',
    requirement: 'LIABILITY_OR_RECOVERY_COST_UNBOUNDED',
    expectedStatus: 'UNKNOWN',
    envelope: buildUnboundedLiabilityFixture(),
  },
  {
    fixtureId: 'PA-S2-FX-PASS-WITHOUT-OWNER-DECISION',
    requirement: 'PASS_WITHOUT_CAPITAL_RISK_OR_OWNER_DECISION_REMAINS_NON_AUTHORITY',
    expectedStatus: 'PASS',
    envelope: buildPassWithoutCanonicalOwnerDecisionFixture(),
  },
]);

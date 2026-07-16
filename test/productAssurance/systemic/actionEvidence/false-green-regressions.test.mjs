import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIXTURE_NOW_MS,
  buildActionEvidenceEnvelope,
  buildDirectInvalidationFixture,
  canonicalStringify,
  clonePlain,
  evaluateActionEvidenceEnvelope,
  sha256Hex,
  validateActionEvidenceEnvelope,
  validateActionEvidenceResult,
} from '../../../../fixtures/productAssurance/systemic/actionEvidence/index.mjs';
import {
  frozenControlActionMaterial,
  frozenPolicyActionMaterial,
} from '../../../../fixtures/productAssurance/systemic/actionEvidence/contracts/internal-binding.mjs';

const resealIdentityMutation = (envelope) => {
  const { record } = envelope;
  const control = ['REPAIR_STEP', 'HALT'].includes(record.actionClass);
  if (control) {
    record.identity.actionDigest = `sha256:${sha256Hex(canonicalStringify({
      schema: 'LIVE_EDGE_CONTROL_ACTION_DIGEST_V1',
      action: frozenControlActionMaterial(record.identity, record.actionClass),
    }))}`;
  } else {
    const hash = sha256Hex(canonicalStringify(frozenPolicyActionMaterial(
      record.identity,
      record.actionBinding.discriminantValue,
    )));
    record.identity.actionId = `epact_${hash}`;
    record.identity.actionRevision = `epactrev_${hash}`;
    for (const source of record.temporalContext.sources) {
      source.venue = record.identity.venue;
      source.symbol = record.identity.symbol;
      source.accountRealmId = record.identity.accountRealmId;
    }
  }
  const actionDigest = control
    ? record.identity.actionDigest
    : record.identity.actionId.slice('epact_'.length);
  record.actionReference.referenceId = control ? record.identity.commandId : record.identity.actionId;
  record.actionReference.revision = control
    ? `control_revision_${record.identity.expectedControlRevision}`
    : record.identity.actionRevision;
  record.actionReference.digest = actionDigest;
  record.families.find((entry) => entry.family === 'ACTION_BINDING')
    .sourceRefs.find((entry) => entry.sourceRole === 'ACTION').digest = actionDigest;
  record.subjectDigest = sha256Hex(canonicalStringify({
    actionClass: record.actionClass,
    actionBinding: record.actionBinding,
    identity: record.identity,
  }));
  return envelope;
};

const currentOwnerDecision = (envelope, overrides = {}) => ({
  sourceRole: 'OWNER_DECISION',
  ownerId: 'CAPITAL_APPROVALS',
  referenceId: 'capital_approval_exact_subject_001',
  revision: 'capital_approval_revision_001',
  digest: 'd'.repeat(64),
  observedAtMs: FIXTURE_NOW_MS - 950,
  maximumAgeMs: 5_000,
  expiresAtMs: FIXTURE_NOW_MS + 10_000,
  binding: {
    subjectDigest: envelope.record.subjectDigest,
    releaseId: envelope.record.versions.releaseId,
    policyRevision: envelope.record.versions.policyRevision,
    authorityMapCommit: envelope.record.versions.authorityMapCommit,
  },
  ...overrides,
});

test('old but mutually coherent temporal sources are UNKNOWN, never PASS', () => {
  const envelope = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
  const age = 30 * 24 * 60 * 60 * 1_000;
  for (const source of envelope.record.temporalContext.sources) {
    source.eventAtMs -= age;
    source.receivedAtMs -= age;
    source.availableAtMs -= age;
    source.processedAtMs -= age;
  }
  assert.deepEqual(validateActionEvidenceEnvelope(envelope), { valid: true, issues: [] });
  const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('TEMPORAL_SOURCE_STALE'));
});

test('unbound fencing evidence and unrelated frozen versions cannot pass', () => {
  const mutations = [
    (envelope) => { envelope.record.fencingContext.ownerEvidenceId = 'PA-S2-UNBOUND-FENCE-EVIDENCE'; },
    (envelope) => { envelope.record.versions.authorityMapCommit = '1'.repeat(40); },
    (envelope) => { envelope.record.versions.policyRevision = 'UNRELATED_POLICY_REVISION'; },
  ];
  for (const mutate of mutations) {
    const envelope = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
    mutate(envelope);
    assert.equal(validateActionEvidenceEnvelope(envelope).valid, false);
    assert.notEqual(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'PASS');
  }
});

test('owner references must be canonical, current, and exactly subject-bound when supplied', () => {
  const exact = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
  exact.record.actionFacts.ownerDecisionReferenceState = 'CURRENT_EXACT_SUBJECT';
  exact.record.ownerReferences.push(currentOwnerDecision(exact));
  assert.deepEqual(validateActionEvidenceEnvelope(exact), { valid: true, issues: [] });
  assert.equal(evaluateActionEvidenceEnvelope(exact, FIXTURE_NOW_MS).status, 'PASS');

  const stale = clonePlain(exact);
  stale.record.actionFacts.ownerDecisionReferenceState = 'STALE';
  stale.record.ownerReferences[0].observedAtMs = FIXTURE_NOW_MS - 20_000;
  stale.record.ownerReferences[0].expiresAtMs = FIXTURE_NOW_MS + 1_000;
  const staleResult = evaluateActionEvidenceEnvelope(stale, FIXTURE_NOW_MS);
  assert.equal(staleResult.status, 'UNKNOWN');
  assert(staleResult.reasonCodes.includes('OWNER_REFERENCE_STALE'));

  const shadow = clonePlain(exact);
  shadow.record.ownerReferences[0].ownerId = 'PA-S2-SHADOW-APPROVER';
  assert.equal(validateActionEvidenceEnvelope(shadow).valid, false);
  assert.notEqual(evaluateActionEvidenceEnvelope(shadow, FIXTURE_NOW_MS).status, 'PASS');
});

test('owner-reference IDs are globally unique across canonical owners', () => {
  const envelope = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
  envelope.record.actionFacts.ownerDecisionReferenceState = 'CURRENT_EXACT_SUBJECT';
  envelope.record.ownerReferences.push(
    currentOwnerDecision(envelope),
    currentOwnerDecision(envelope, { ownerId: 'FOUNDATION_RISK' }),
  );
  const validation = validateActionEvidenceEnvelope(envelope);
  assert.equal(validation.valid, false);
  assert(validation.issues.some((entry) => entry.code === 'OWNER_REFERENCE_DUPLICATE'));
  assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'UNKNOWN');
});

test('control-class owner references always bind the exact record subject and versions', () => {
  for (const actionClass of ['REPAIR_STEP', 'HALT']) {
    const exact = clonePlain(buildActionEvidenceEnvelope(actionClass));
    exact.record.ownerReferences.push(currentOwnerDecision(exact, {
      ownerId: 'FOUNDATION_CONTROL',
      referenceId: `foundation_control_decision_${actionClass.toLowerCase()}_001`,
    }));
    assert.deepEqual(validateActionEvidenceEnvelope(exact), { valid: true, issues: [] });
    assert.equal(evaluateActionEvidenceEnvelope(exact, FIXTURE_NOW_MS).status, 'PASS');

    const wrongSubject = clonePlain(exact);
    wrongSubject.record.ownerReferences[0].binding.subjectDigest = '0'.repeat(64);
    const validation = validateActionEvidenceEnvelope(wrongSubject);
    assert.equal(validation.valid, false, actionClass);
    assert(validation.issues.some((entry) => entry.code === 'OWNER_REFERENCE_BINDING_MISMATCH'));
    assert.equal(evaluateActionEvidenceEnvelope(wrongSubject, FIXTURE_NOW_MS).status, 'UNKNOWN');
  }
});

test('declared same-domain or same-owner verification does not establish independence', () => {
  const mutations = [
    (entry) => { entry.verifiedBy.independenceDomainId = entry.producedBy.independenceDomainId; },
    (entry) => { entry.verifiedBy.ownerId = entry.producedBy.ownerId; },
  ];
  for (const mutate of mutations) {
    const envelope = clonePlain(buildActionEvidenceEnvelope('HALT'));
    mutate(envelope.record.families[0]);
    const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
    assert.equal(result.status, 'UNKNOWN');
    assert(result.reasonCodes.includes('PRODUCER_VERIFIER_INDEPENDENCE_UNPROVEN'));
  }
});

test('subject, action-reference, and action-source schema drift are diagnostic UNKNOWN', () => {
  const mutations = [
    (envelope) => { envelope.record.identity.quantity = '0.002'; },
    (envelope) => { envelope.record.actionReference.digest = 'e'.repeat(64); },
    (envelope) => {
      envelope.record.families
        .find((entry) => entry.family === 'ACTION_BINDING')
        .sourceRefs.find((entry) => entry.sourceRole === 'ACTION').digest = 'f'.repeat(64);
    },
  ];
  for (const mutate of mutations) {
    const envelope = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
    mutate(envelope);
    const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
    assert.equal(result.status, 'UNKNOWN');
    assert(result.reasonCodes.includes('SCHEMA_INVALID'));
  }
});

test('negative bounds, missing time headroom, and contradictory satisfied reasons never pass', () => {
  const mutations = [
    (envelope) => { envelope.record.scenarioEnvelope.maximumLiability = '-1'; },
    (envelope) => { envelope.record.scenarioEnvelope.timeHeadroomMs = null; },
    (envelope) => {
      envelope.record.families[0].reasonCodes = ['OWNER_REGISTERED_FALLBACK_MISSING'];
    },
  ];
  for (const mutate of mutations) {
    const envelope = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
    mutate(envelope);
    assert.equal(validateActionEvidenceEnvelope(envelope).valid, false);
    assert.notEqual(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'PASS');
  }

  const classSpecificInputReason = clonePlain(buildActionEvidenceEnvelope('HALT'));
  classSpecificInputReason.record.families[0].assertion = 'CONTRADICTED';
  classSpecificInputReason.record.families[0].reasonCodes = ['HALT_READBACK_NOT_HALTED'];
  assert.equal(validateActionEvidenceEnvelope(classSpecificInputReason).valid, false);
  assert.equal(evaluateActionEvidenceEnvelope(classSpecificInputReason, FIXTURE_NOW_MS).status, 'UNKNOWN');
});

test('cyclic and over-deep malformed inputs return deterministic UNKNOWN without throwing', () => {
  const cyclic = clonePlain(buildActionEvidenceEnvelope('HALT'));
  cyclic.record.actionBinding.self = cyclic.record.actionBinding;
  assert.doesNotThrow(() => validateActionEvidenceEnvelope(cyclic));
  assert.equal(validateActionEvidenceEnvelope(cyclic).valid, false);
  assert.equal(evaluateActionEvidenceEnvelope(cyclic, FIXTURE_NOW_MS).status, 'UNKNOWN');

  const deep = clonePlain(buildActionEvidenceEnvelope('HALT'));
  let cursor = deep.record.actionBinding;
  for (let index = 0; index < 70; index += 1) {
    cursor.nested = {};
    cursor = cursor.nested;
  }
  assert.doesNotThrow(() => validateActionEvidenceEnvelope(deep));
  assert(validateActionEvidenceEnvelope(deep).issues.some((entry) => entry.code === 'NESTING_DEPTH_EXCEEDED'));
  assert.equal(evaluateActionEvidenceEnvelope(deep, FIXTURE_NOW_MS).status, 'UNKNOWN');

  const missingIdentity = clonePlain(buildActionEvidenceEnvelope('HALT'));
  missingIdentity.record.identity = null;
  assert.doesNotThrow(() => validateActionEvidenceEnvelope(missingIdentity));
  assert.equal(evaluateActionEvidenceEnvelope(missingIdentity, FIXTURE_NOW_MS).status, 'UNKNOWN');

  const malformedResult = clonePlain(evaluateActionEvidenceEnvelope(
    buildActionEvidenceEnvelope('HALT'),
    FIXTURE_NOW_MS,
  ));
  malformedResult.reasonCodes = null;
  assert.doesNotThrow(() => validateActionEvidenceResult(malformedResult));
  assert.equal(validateActionEvidenceResult(malformedResult).valid, false);
});

test('sparse arrays and array expando fields cannot bypass closed validation', () => {
  const mutations = [
    (envelope) => { envelope.record.invalidations = Array(1); },
    (envelope) => { envelope.record.temporalContext.sources = Array(1); },
    (envelope) => { envelope.record.activeAssumptions = Array(1); },
    (envelope) => { envelope.record.invariantResults = Array(1); },
    (envelope) => { envelope.record.families = Array(6); },
    (envelope) => { envelope.record.families[0].sourceRefs = Array(1); },
  ];
  for (const mutate of mutations) {
    const envelope = clonePlain(buildActionEvidenceEnvelope('HALT'));
    mutate(envelope);
    const validation = validateActionEvidenceEnvelope(envelope);
    assert.equal(validation.valid, false);
    assert(validation.issues.some((entry) => entry.code === 'SPARSE_ARRAY_FORBIDDEN'));
    assert.doesNotThrow(() => evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS));
    assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'UNKNOWN');
  }

  const expando = clonePlain(buildActionEvidenceEnvelope('HALT'));
  expando.record.families.approved = true;
  expando.record.ownerReferences.secret = 'forbidden';
  const validation = validateActionEvidenceEnvelope(expando);
  assert.equal(validation.valid, false);
  assert(validation.issues.some((entry) => entry.code === 'ARRAY_PROPERTY_FORBIDDEN'));
  assert.notEqual(evaluateActionEvidenceEnvelope(expando, FIXTURE_NOW_MS).status, 'PASS');
});

test('hidden properties, accessors, and malformed JSON lists cannot pass or throw', () => {
  const hidden = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
  Object.defineProperty(hidden.record, 'approved', { value: true, enumerable: false });
  assert.equal(validateActionEvidenceEnvelope(hidden).valid, false);
  assert.doesNotThrow(() => evaluateActionEvidenceEnvelope(hidden, FIXTURE_NOW_MS));
  assert.equal(evaluateActionEvidenceEnvelope(hidden, FIXTURE_NOW_MS).status, 'UNKNOWN');

  const accessor = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
  Object.defineProperty(accessor.record.identity, 'actionId', {
    enumerable: true,
    get() { throw new Error('must not run'); },
  });
  assert.doesNotThrow(() => validateActionEvidenceEnvelope(accessor));
  assert.equal(validateActionEvidenceEnvelope(accessor).valid, false);
  assert.doesNotThrow(() => evaluateActionEvidenceEnvelope(accessor, FIXTURE_NOW_MS));

  const listMutations = [
    (envelope) => { envelope.record.families[0].evidenceIds = {}; },
    (envelope) => { envelope.record.families[0].dependencyEvidenceIds = {}; },
    (envelope) => { envelope.record.families[0].reasonCodes = {}; },
    (envelope) => { envelope.record.families[0].sourceRefs = {}; },
  ];
  for (const mutate of listMutations) {
    const envelope = clonePlain(buildActionEvidenceEnvelope('HALT'));
    mutate(envelope);
    assert.doesNotThrow(() => validateActionEvidenceEnvelope(envelope));
    assert.equal(validateActionEvidenceEnvelope(envelope).valid, false);
    assert.doesNotThrow(() => evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS));
    assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'UNKNOWN');
  }
});

test('fencing relevance is class-bound and cannot be disabled', () => {
  for (const actionClass of ['ORDER_INTENT', 'CANCELLATION', 'REPAIR_STEP', 'RECOVERY_STEP']) {
    const envelope = clonePlain(buildActionEvidenceEnvelope(actionClass));
    envelope.record.fencingContext = {
      relevant: false,
      epoch: null,
      ownerEvidenceId: null,
      leaseExpiresAtMs: null,
    };
    const validation = validateActionEvidenceEnvelope(envelope);
    assert.equal(validation.valid, false, actionClass);
    assert(validation.issues.some((entry) => entry.code === 'FENCING_RELEVANCE_CLASS_MISMATCH'));
    assert.notEqual(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'PASS');
  }
});

test('source roles, owners, provenance, and dependency graph are closed', () => {
  const mutations = [
    (envelope) => {
      const source = envelope.record.families.find((entry) => entry.family === 'LIFECYCLE_STATE_AND_OUTCOME').sourceRefs[1];
      source.sourceRole = 'FEE';
      source.ownerId = 'INTELLIGENCE_RUNTIME';
    },
    (envelope) => {
      envelope.record.families.find((entry) => entry.family === 'LIFECYCLE_STATE_AND_OUTCOME').sourceRefs[0].ownerId = 'FOUNDATION_EXECUTION';
    },
    (envelope) => {
      const family = envelope.record.families.find((entry) => entry.family === 'ACTION_BINDING');
      family.producedAtMs = FIXTURE_NOW_MS - 2_000;
      family.verifiedAtMs = FIXTURE_NOW_MS - 1_500;
    },
    (envelope) => {
      envelope.record.families.find((entry) => entry.family === 'OUTCOME_OBSERVABILITY_AND_SUPERVISION').dependencyEvidenceIds = [];
    },
  ];
  for (const mutate of mutations) {
    const envelope = clonePlain(buildActionEvidenceEnvelope('HALT'));
    mutate(envelope);
    assert.equal(validateActionEvidenceEnvelope(envelope).valid, false);
    assert.notEqual(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'PASS');
  }
});

test('temporal denominator, watermark coverage, and control component are exact', () => {
  const missingTradeSource = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
  missingTradeSource.record.temporalContext.sources.pop();
  assert.equal(validateActionEvidenceEnvelope(missingTradeSource).valid, false);

  const uncovered = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
  uncovered.record.temporalContext.watermarkMs = FIXTURE_NOW_MS - 1_900;
  assert.equal(validateActionEvidenceEnvelope(uncovered).valid, false);
  assert.notEqual(evaluateActionEvidenceEnvelope(uncovered, FIXTURE_NOW_MS).status, 'PASS');

  const wrongComponent = clonePlain(buildActionEvidenceEnvelope('HALT'));
  wrongComponent.record.temporalContext.sources[0].componentId = 'wrong-component';
  assert.equal(validateActionEvidenceEnvelope(wrongComponent).valid, false);
});

test('temporal anomaly dispositions are frozen fail-closed policy inputs', () => {
  const mutations = [
    ['lateDisposition', 'IGNORE_EXACT_DUPLICATE'],
    ['reorderedDisposition', 'IGNORE_EXACT_DUPLICATE'],
    ['duplicateDisposition', 'QUARANTINE'],
    ['futureDisposition', 'IGNORE_EXACT_DUPLICATE'],
  ];
  for (const [field, value] of mutations) {
    const envelope = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
    envelope.record.temporalContext[field] = value;
    const validation = validateActionEvidenceEnvelope(envelope);
    assert.equal(validation.valid, false, field);
    assert(validation.issues.some((entry) => entry.code === 'TEMPORAL_DISPOSITION_INVALID'));
    assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'UNKNOWN');
  }
});

test('stale and future action facts mask contradictions as UNKNOWN', () => {
  const cases = [
    ['HALT', (envelope) => {
      envelope.record.actionFacts.readbackState = 'NOT_HALTED';
      envelope.record.actionFacts.readbackExpiresAtMs = FIXTURE_NOW_MS;
    }],
    ['REPAIR_STEP', (envelope) => {
      envelope.record.actionFacts.postconditionState = 'FAILED_OR_RECURRED';
      envelope.record.actionFacts.postconditionExpiresAtMs = FIXTURE_NOW_MS;
    }],
    ['REPAIR_STEP', (envelope) => {
      envelope.record.actionFacts.postconditionState = 'FAILED_OR_RECURRED';
      envelope.record.actionFacts.postconditionObservedAtMs = FIXTURE_NOW_MS + 1;
      envelope.record.actionFacts.postconditionExpiresAtMs = FIXTURE_NOW_MS + 30_000;
    }],
    ['ORDER_INTENT', (envelope) => {
      envelope.record.actionFacts.signedAtMs = FIXTURE_NOW_MS + 1;
      envelope.record.actionFacts.acknowledgedAtMs = FIXTURE_NOW_MS + 2;
    }],
    ['CANCELLATION', (envelope) => {
      envelope.record.actionFacts.signedAtMs = FIXTURE_NOW_MS + 1;
      envelope.record.actionFacts.cancellationRequestedAtMs = FIXTURE_NOW_MS + 2;
      envelope.record.actionFacts.acknowledgedAtMs = FIXTURE_NOW_MS + 3;
      envelope.record.actionFacts.localTimeoutAtMs = FIXTURE_NOW_MS + 4;
      envelope.record.actionFacts.terminalAtMs = FIXTURE_NOW_MS + 5;
    }],
    ['CANCELLATION', (envelope) => {
      envelope.record.actionFacts.latestFillAtMs = FIXTURE_NOW_MS + 1;
      envelope.record.actionFacts.cumulativeFilledQuantity = '0.1';
    }],
  ];
  for (const [actionClass, mutate] of cases) {
    const envelope = clonePlain(buildActionEvidenceEnvelope(actionClass));
    mutate(envelope);
    assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'UNKNOWN');
  }
});

test('partial-fill uncertainty and exhausted scenario headroom cannot pass', () => {
  for (const actionClass of ['ORDER_INTENT', 'RECOVERY_STEP']) {
    const envelope = clonePlain(buildActionEvidenceEnvelope(actionClass));
    envelope.record.actionFacts.partialFillState = 'UNKNOWN';
    assert.equal(validateActionEvidenceEnvelope(envelope).valid, true);
    assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'UNKNOWN');
  }
  for (const actionClass of ['ORDER_INTENT', 'CANCELLATION', 'REPAIR_STEP', 'HALT', 'RECOVERY_STEP']) {
    const envelope = clonePlain(buildActionEvidenceEnvelope(actionClass));
    envelope.record.scenarioEnvelope.timeHeadroomMs = 0;
    assert.equal(validateActionEvidenceEnvelope(envelope).valid, true);
    assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'UNKNOWN');
  }
});

test('cancellation fill truth requires timestamp and rate-limited recovery fails', () => {
  const missingFillTime = clonePlain(buildActionEvidenceEnvelope('CANCELLATION'));
  missingFillTime.record.actionFacts.cumulativeFilledQuantity = '0.1';
  assert.equal(validateActionEvidenceEnvelope(missingFillTime).valid, false);
  assert.notEqual(evaluateActionEvidenceEnvelope(missingFillTime, FIXTURE_NOW_MS).status, 'PASS');

  for (const quantity of [null, '0']) {
    const missingFillQuantity = clonePlain(buildActionEvidenceEnvelope('CANCELLATION'));
    missingFillQuantity.record.actionFacts.latestFillAtMs = FIXTURE_NOW_MS - 750;
    missingFillQuantity.record.actionFacts.cumulativeFilledQuantity = quantity;
    const validation = validateActionEvidenceEnvelope(missingFillQuantity);
    assert.equal(validation.valid, false);
    assert(validation.issues.some((entry) => entry.code === 'CANCELLATION_FILL_QUANTITY_MISSING'));
    assert.equal(evaluateActionEvidenceEnvelope(missingFillQuantity, FIXTURE_NOW_MS).status, 'UNKNOWN');
  }

  const rateLimited = clonePlain(buildActionEvidenceEnvelope('CANCELLATION'));
  rateLimited.record.actionFacts.cumulativeFilledQuantity = '0.1';
  rateLimited.record.actionFacts.latestFillAtMs = FIXTURE_NOW_MS - 750;
  rateLimited.record.actionFacts.localTimeoutAtMs = null;
  rateLimited.record.actionFacts.rateLimitState = 'RATE_LIMITED';
  assert.equal(validateActionEvidenceEnvelope(rateLimited).valid, true);
  assert.equal(evaluateActionEvidenceEnvelope(rateLimited, FIXTURE_NOW_MS).status, 'FAIL');
  assert(evaluateActionEvidenceEnvelope(rateLimited, FIXTURE_NOW_MS).reasonCodes.includes('PARTIAL_FILL_RECOVERY_RATE_LIMITED'));
});

test('frozen L identity formats, decimal bounds, and control references are enforced', () => {
  const mutations = [
    ['ORDER_INTENT', (identity) => { identity.quantity = '0.000'; }],
    ['ORDER_INTENT', (identity) => { identity.price = '1.0'; }],
    ['ORDER_INTENT', (identity) => { identity.quantity = '1'.repeat(73); }],
    ['ORDER_INTENT', (identity) => { identity.step = 32; }],
    ['ORDER_INTENT', (identity) => { identity.venue = 'OTHER_EXCHANGE'; }],
    ['ORDER_INTENT', (identity) => { identity.product = 'OPTIONS'; }],
    ['ORDER_INTENT', (identity) => { identity.symbol = 'b/t'; }],
    ['ORDER_INTENT', (identity) => { identity.legId = '1/x'; }],
    ['HALT', (identity) => { identity.commandId = 'bogus'; }],
    ['REPAIR_STEP', (identity) => { identity.componentRevision = '1/x'; }],
    ['RECOVERY_STEP', (identity) => { identity.recoveryEvidenceRevision = 'bad/rev'; }],
  ];
  for (const [actionClass, mutate] of mutations) {
    const envelope = clonePlain(buildActionEvidenceEnvelope(actionClass));
    mutate(envelope.record.identity);
    resealIdentityMutation(envelope);
    assert.equal(validateActionEvidenceEnvelope(envelope).valid, false, actionClass);
    assert.notEqual(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'PASS');
  }

  const legalReseal = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
  legalReseal.record.identity.quantity = '0.002';
  resealIdentityMutation(legalReseal);
  assert.deepEqual(validateActionEvidenceEnvelope(legalReseal), { valid: true, issues: [] });
  assert.equal(evaluateActionEvidenceEnvelope(legalReseal, FIXTURE_NOW_MS).status, 'PASS');

  const hugeScenario = clonePlain(buildActionEvidenceEnvelope('HALT'));
  hugeScenario.record.scenarioEnvelope.maximumLiability = '1'.repeat(513);
  assert.equal(validateActionEvidenceEnvelope(hugeScenario).valid, false);

  for (const actionClass of ['REPAIR_STEP', 'HALT']) {
    const shortCorrelation = clonePlain(buildActionEvidenceEnvelope(actionClass));
    shortCorrelation.record.identity.correlationId = '1';
    resealIdentityMutation(shortCorrelation);
    assert.equal(validateActionEvidenceEnvelope(shortCorrelation).valid, false, actionClass);
    assert.equal(evaluateActionEvidenceEnvelope(shortCorrelation, FIXTURE_NOW_MS).status, 'UNKNOWN');
  }


  for (const actionClass of ['ORDER_INTENT', 'HALT']) {
    const maximumCorrelation = clonePlain(buildActionEvidenceEnvelope(actionClass));
    maximumCorrelation.record.identity.correlationId = 'a'.repeat(256);
    resealIdentityMutation(maximumCorrelation);
    assert.deepEqual(validateActionEvidenceEnvelope(maximumCorrelation), { valid: true, issues: [] });
    assert.equal(evaluateActionEvidenceEnvelope(maximumCorrelation, FIXTURE_NOW_MS).status, 'PASS');
  }
});

test('readback and repair postconditions follow receipt and precede verification', () => {
  for (const actionClass of ['HALT', 'REPAIR_STEP']) {
    const beforeReceipt = clonePlain(buildActionEvidenceEnvelope(actionClass));
    const family = beforeReceipt.record.families.find((entry) => entry.family === 'LIFECYCLE_STATE_AND_OUTCOME');
    const observationKey = actionClass === 'HALT' ? 'readbackObservedAtMs' : 'postconditionObservedAtMs';
    beforeReceipt.record.actionFacts[observationKey] = FIXTURE_NOW_MS - 950;
    family.sourceRefs.find((reference) => reference.sourceRole === 'LIFECYCLE').observedAtMs = FIXTURE_NOW_MS - 900;
    assert.equal(validateActionEvidenceEnvelope(beforeReceipt).valid, false);

    const afterVerification = clonePlain(buildActionEvidenceEnvelope(actionClass));
    afterVerification.record.actionFacts[observationKey] = FIXTURE_NOW_MS - 400;
    assert.equal(validateActionEvidenceEnvelope(afterVerification).valid, false);

    const simultaneous = clonePlain(buildActionEvidenceEnvelope(actionClass));
    simultaneous.record.actionFacts[observationKey] = simultaneous.record.actionReference.observedAtMs;
    assert.equal(validateActionEvidenceEnvelope(simultaneous).valid, false);
  }
});

test('family verification cannot predate action facts it reports', () => {
  const cases = [
    ['ORDER_INTENT', (envelope) => { envelope.record.actionFacts.acknowledgedAtMs = FIXTURE_NOW_MS - 100; }],
    ['CANCELLATION', (envelope) => { envelope.record.actionFacts.terminalAtMs = FIXTURE_NOW_MS - 100; }],
    ['HALT', (envelope) => {
      envelope.record.families.find((entry) => entry.family === 'OUTCOME_OBSERVABILITY_AND_SUPERVISION').verifiedAtMs = FIXTURE_NOW_MS - 600;
    }],
    ['REPAIR_STEP', (envelope) => {
      envelope.record.families.find((entry) => entry.family === 'REGISTERED_RECOVERY_OR_REPAIR_PATH').verifiedAtMs = FIXTURE_NOW_MS - 600;
    }],
  ];
  for (const [actionClass, mutate] of cases) {
    const envelope = clonePlain(buildActionEvidenceEnvelope(actionClass));
    mutate(envelope);
    assert.equal(validateActionEvidenceEnvelope(envelope).valid, false);
    assert.notEqual(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'PASS');
  }
});

test('pending cancellation without a terminal boundary does not fabricate timeout failure', () => {
  const envelope = clonePlain(buildActionEvidenceEnvelope('CANCELLATION'));
  envelope.record.actionFacts.cancellationState = 'CANCEL_PENDING';
  envelope.record.actionFacts.localTimeoutAtMs = null;
  envelope.record.actionFacts.terminalAtMs = null;
  envelope.record.actionFacts.latestFillAtMs = FIXTURE_NOW_MS - 750;
  envelope.record.actionFacts.cumulativeFilledQuantity = '0.1';
  assert.equal(validateActionEvidenceEnvelope(envelope).valid, true);
  const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.reasonCodes.includes('LATE_FILL_AFTER_CANCEL_TIMEOUT'), false);
  assert(result.reasonCodes.includes('CANCEL_PENDING_NOT_TERMINAL'));
});

test('a current late fill remains FAIL even while cancellation completion is UNKNOWN', () => {
  const envelope = clonePlain(buildActionEvidenceEnvelope('CANCELLATION'));
  envelope.record.actionFacts.cancellationState = 'CANCEL_PENDING';
  envelope.record.actionFacts.terminalAtMs = null;
  envelope.record.actionFacts.localTimeoutAtMs = FIXTURE_NOW_MS - 800;
  envelope.record.actionFacts.latestFillAtMs = FIXTURE_NOW_MS - 750;
  envelope.record.actionFacts.cumulativeFilledQuantity = '0.1';
  assert.equal(validateActionEvidenceEnvelope(envelope).valid, true);
  const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  assert.equal(result.status, 'FAIL');
  assert(result.reasonCodes.includes('LATE_FILL_AFTER_CANCEL_TIMEOUT'));
  assert.equal(result.reasonCodes.includes('EVIDENCE_SATISFIED'), false);
  assert.equal(result.reasonCodes.includes('CURRENT_SYNTHETIC_FIXTURE'), false);
  assert.equal(validateActionEvidenceResult(result).valid, true);
});

test('descriptor snapshots make toggling getter proxies stable or fail closed', () => {
  const target = clonePlain(buildActionEvidenceEnvelope('HALT'));
  let reads = 0;
  const envelope = new Proxy(target, {
    get(current, key, receiver) {
      if (key === 'record') reads += 1;
      return Reflect.get(current, key, receiver);
    },
  });
  const validation = validateActionEvidenceEnvelope(envelope);
  assert.deepEqual(validation, { valid: true, issues: [] });
  const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  assert.equal(result.status, 'PASS');
  assert(result.familyResults.length > 0);
  assert.equal(validateActionEvidenceResult(result).valid, true);
  assert.equal(reads, 0);
});

test('timestamp-free lease loss uses a class-neutral current contradiction', () => {
  for (const actionClass of ['REPAIR_STEP', 'RECOVERY_STEP']) {
    const envelope = clonePlain(buildActionEvidenceEnvelope(actionClass));
    envelope.record.actionFacts.leaseState = 'LOST';
    const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
    assert.equal(result.status, 'FAIL');
    assert(result.reasonCodes.includes('FENCING_LEASE_LOST'));
    assert.equal(result.reasonCodes.includes('LEASE_LOST_BEFORE_ACKNOWLEDGEMENT'), false);
  }
});

test('active invalidation masks dependent contradictions to UNKNOWN', () => {
  const envelope = clonePlain(buildDirectInvalidationFixture());
  const fencing = envelope.record.families.find((entry) => entry.family === 'FENCING_AND_IDEMPOTENCY');
  fencing.assertion = 'CONTRADICTED';
  fencing.reasonCodes = ['PREVIOUS_BINDING_CONTRADICTION'];
  assert.equal(validateActionEvidenceEnvelope(envelope).valid, true);
  const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  const bindingResult = result.familyResults.find((entry) => entry.family === 'ACTION_BINDING');
  const fencingResult = result.familyResults.find((entry) => entry.family === 'FENCING_AND_IDEMPOTENCY');
  assert.equal(bindingResult.status, 'UNKNOWN');
  assert.equal(fencingResult.status, 'UNKNOWN');
  assert.equal(result.status, 'UNKNOWN');
  assert(fencingResult.reasonCodes.includes('EVIDENCE_DEPENDENCY_UNKNOWN'));
  assert.equal(fencingResult.reasonCodes.includes('EVIDENCE_CONTRADICTED'), false);
});

test('valid upper-bound clocks always produce a contract-valid result', () => {
  const envelope = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
  const shiftedNow = 4_102_444_700_000;
  const delta = shiftedNow - FIXTURE_NOW_MS;
  const shiftTimes = (value) => {
    if (Array.isArray(value)) {
      value.forEach(shiftTimes);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'number'
        && (key.endsWith('AtMs') || ['referenceTimeMs', 'watermarkMs'].includes(key))) {
        value[key] = child + delta;
      } else {
        shiftTimes(child);
      }
    }
  };
  shiftTimes(envelope);
  envelope.record.actionReference.maximumAgeMs = 200_000;
  assert.equal(validateActionEvidenceEnvelope(envelope).valid, true);
  const result = evaluateActionEvidenceEnvelope(envelope, shiftedNow + 70_000);
  assert.equal(validateActionEvidenceResult(result).valid, true);
  assert(result.nextCurrentnessBoundaryAtMs === null
    || result.nextCurrentnessBoundaryAtMs <= 4_102_444_800_000);
});

test('next currentness boundary is the first possible status transition', () => {
  const baseline = buildActionEvidenceEnvelope('ORDER_INTENT');
  assert.equal(
    evaluateActionEvidenceEnvelope(baseline, FIXTURE_NOW_MS).nextCurrentnessBoundaryAtMs,
    FIXTURE_NOW_MS + 4_501,
  );
  assert.equal(
    evaluateActionEvidenceEnvelope(baseline, FIXTURE_NOW_MS + 4_500).nextCurrentnessBoundaryAtMs,
    FIXTURE_NOW_MS + 4_501,
  );

  const futureInvalidation = clonePlain(buildDirectInvalidationFixture());
  futureInvalidation.record.invalidations[0].invalidatedAtMs = FIXTURE_NOW_MS + 1;
  assert.equal(
    evaluateActionEvidenceEnvelope(futureInvalidation, FIXTURE_NOW_MS).nextCurrentnessBoundaryAtMs,
    FIXTURE_NOW_MS + 1,
  );
});

test('HALT requires a current canonical halted readback after its receipt', () => {
  const cases = [
    ['MISSING', FIXTURE_NOW_MS + 30_000, 'UNKNOWN'],
    ['NOT_HALTED', FIXTURE_NOW_MS + 30_000, 'FAIL'],
    ['HALTED', FIXTURE_NOW_MS, 'UNKNOWN'],
    ['HALTED', FIXTURE_NOW_MS + 30_000, 'PASS'],
  ];
  for (const [readbackState, expiry, expected] of cases) {
    const envelope = clonePlain(buildActionEvidenceEnvelope('HALT'));
    envelope.record.actionFacts.readbackState = readbackState;
    envelope.record.actionFacts.readbackExpiresAtMs = expiry;
    assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, expected);
  }

  const preAction = clonePlain(buildActionEvidenceEnvelope('HALT'));
  preAction.record.actionFacts.readbackObservedAtMs = FIXTURE_NOW_MS - 4_000;
  assert.equal(validateActionEvidenceEnvelope(preAction).valid, false);
  assert.notEqual(evaluateActionEvidenceEnvelope(preAction, FIXTURE_NOW_MS).status, 'PASS');
});

test('repair evidence requires a current reconcile-first postcondition', () => {
  const cases = [
    ['QUIET_PERIOD_INCOMPLETE', 'UNKNOWN'],
    ['RESTARTED_UNRECONCILED', 'FAIL'],
    ['FAILED_OR_RECURRED', 'FAIL'],
    ['RECONCILED_HEALTHY', 'PASS'],
  ];
  for (const [postconditionState, expected] of cases) {
    const envelope = clonePlain(buildActionEvidenceEnvelope('REPAIR_STEP'));
    envelope.record.actionFacts.postconditionState = postconditionState;
    assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, expected);
  }

  const preAction = clonePlain(buildActionEvidenceEnvelope('REPAIR_STEP'));
  preAction.record.actionFacts.postconditionObservedAtMs = FIXTURE_NOW_MS - 4_000;
  assert.equal(validateActionEvidenceEnvelope(preAction).valid, false);
  assert.notEqual(evaluateActionEvidenceEnvelope(preAction, FIXTURE_NOW_MS).status, 'PASS');
});

test('recovery recommendations and awareness cannot masquerade as recovery execution', () => {
  const states = [
    ['RECOMMENDATION_ONLY', false, 'FAIL'],
    ['AWARENESS_ONLY', false, 'FAIL'],
    ['PRECOMPUTED_EXECUTION_BOUND', true, 'FAIL'],
    ['UNKNOWN', false, 'UNKNOWN'],
    ['PRECOMPUTED_EXECUTION_BOUND', false, 'PASS'],
  ];
  for (const [executionBindingState, recommendationAutomatic, expected] of states) {
    const envelope = clonePlain(buildActionEvidenceEnvelope('RECOVERY_STEP'));
    envelope.record.actionFacts.executionBindingState = executionBindingState;
    envelope.record.actionFacts.recommendationAutomatic = recommendationAutomatic;
    assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, expected);
  }


  const malformedLimit = clonePlain(buildActionEvidenceEnvelope('RECOVERY_STEP'));
  malformedLimit.record.identity.orderType = 'LIMIT';
  assert.equal(validateActionEvidenceEnvelope(malformedLimit).valid, false);
  assert.notEqual(evaluateActionEvidenceEnvelope(malformedLimit, FIXTURE_NOW_MS).status, 'PASS');
});

test('pure SHA-256 content binding matches standard vectors and is canonical-order stable', () => {
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(
    sha256Hex(canonicalStringify({ b: 2, a: 1 })),
    sha256Hex(canonicalStringify({ a: 1, b: 2 })),
  );
});

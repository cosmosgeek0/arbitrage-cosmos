import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildEvidenceBundle,
  createBudgetState,
  createCriticalityProof,
  createDiagnosticResult,
  createModelRunHandoff,
  evaluateUsageAdmission,
  verifyModelRunHandoff,
} from '../../../server/dist/aiOps/caseRuntime/index.js';
import { createSyntheticClaimValidationPort, createSyntheticSigner } from '../../../fixtures/aiOps/caseRuntime/synthetic-runtime.mjs';
import { canonicalJson } from '../../../server/dist/foundation/contracts/identity.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const now = 1_700_000_500_000;
const budgetSigner = createSyntheticSigner();
const zeroUsage = Object.freeze({ calls: 0, toolCalls: 0, webQueries: 0, tokens: 0, costMicrounits: 0, latencyMs: 0, wallTimeMs: 0 });
const budgetLimit = Object.freeze({ calls: 10, toolCalls: 10, webQueries: 10, tokens: 10_000, costMicrounits: 100_000, latencyMs: 100_000, wallTimeMs: 100_000 });
const diagnosticBudgetCaps = Object.freeze({
  policyRevision: 'policy-v1',
  perCase: budgetLimit,
  hourly: budgetLimit,
  daily: budgetLimit,
  monthly: budgetLimit,
  globalHourly: budgetLimit,
  globalDaily: budgetLimit,
  globalMonthly: budgetLimit,
  criticalReserve: zeroUsage,
});
const diagnosticCriticality = createCriticalityProof({
  caseId: 'case-diagnostic-1', policyRevision: 'policy-v1', critical: true,
  issuedAtMs: now - 1, expiresAtMs: now + 1_000,
}, budgetSigner);
const diagnosticBudgetAdmission = evaluateUsageAdmission(
  createBudgetState('policy-v1'), diagnosticBudgetCaps, 'case-diagnostic-1',
  'synthetic-provider-a2', 'synthetic-model-a2', now,
  Object.freeze({ ...zeroUsage, calls: 1 }), diagnosticCriticality, budgetSigner,
);
const versions = Object.freeze({
  providerId: 'synthetic-provider-a2',
  modelId: 'synthetic-model-a2',
  promptRevision: 'prompt-v1',
  toolRevision: 'tool-v1',
  policyRevision: 'policy-v1',
  contextManifestDigest: sha256('context-manifest'),
  budgetAdmissionDigest: diagnosticBudgetAdmission.admissionDigest,
  usageRequestDigest: diagnosticBudgetAdmission.usageRequestDigest,
});
function budgetAdmissionFor(caseId, providerId = versions.providerId, modelId = versions.modelId) {
  const proof = createCriticalityProof({
    caseId, policyRevision: versions.policyRevision, critical: true,
    issuedAtMs: now - 1, expiresAtMs: now + 1_000,
  }, budgetSigner);
  return evaluateUsageAdmission(
    createBudgetState(versions.policyRevision), diagnosticBudgetCaps, caseId, providerId, modelId, now,
    Object.freeze({ ...zeroUsage, calls: 1 }), proof, budgetSigner,
  );
}
const evidenceLimits = Object.freeze({ maximumItems: 4, maximumOmittedItems: 4, maximumRawBytes: 1_024, maximumItemBytes: 512, maximumAgeMs: 10_000 });
const evidenceItems = ['pointer-fact', 'pointer-conflict'].map((pointerId) => {
  const text = `synthetic evidence ${pointerId}`;
  return Object.freeze({
    pointerId,
    ownerId: 'synthetic-evidence-owner',
    artifactId: `artifact-${pointerId}`,
    rawDigest: sha256(text),
    byteLength: Buffer.byteLength(text),
    capturedAtMs: now - 100,
    sourceKind: 'LOG',
    text,
  });
});
const baseBundleContext = Object.freeze({
  caseId: 'case-diagnostic-1',
  incidentId: 'incident-diagnostic-1',
  fingerprint: sha256('fingerprint'),
  correlationIds: ['correlation-diagnostic-1'],
  policyRevision: 'policy-v1',
  createdAtMs: now,
  evidenceWindowStartMs: now - 1_000,
  evidenceWindowEndMs: now,
  timezone: 'UTC',
  environmentId: 'synthetic-test',
  deployedSha: '03857dcdaff8d8b12627d27ddcc97505da1f2f86',
  configRevision: 'config-v1',
  schemaRevisions: ['schema-v1'],
  expectedInventoryRevision: 'inventory-v1',
  affectedResourceIds: ['resource-synthetic'],
  dependencyIds: [],
  lifecycleStateCodes: ['DEGRADED'],
  safetyPostureDigest: sha256('safety-posture'),
  triggeredInvariantIds: ['invariant-synthetic'],
  severity: 'SEV2_MAJOR',
  materiality: 'MATERIAL',
  freshness: 'FRESH',
  temporalCoherence: 'COHERENT',
  missingEvidenceCodes: [],
  conflictingEvidenceCodes: [],
  unknownCodes: [],
});
const bundle = buildEvidenceBundle(baseBundleContext, evidenceItems, evidenceLimits);
const validEvidencePort = Object.freeze({
  readEvidencePointer: (pointer) => {
    const item = evidenceItems.find((candidate) => candidate.pointerId === pointer.pointerId);
    if (!item) return { state: 'UNKNOWN' };
    return {
      state: 'AVAILABLE', rawDigest: item.rawDigest, byteLength: item.byteLength, observedAtMs: now,
      sourceKind: item.sourceKind, rawText: item.text,
    };
  },
});
function diagnosticInput(overrides = {}) {
  return {
    caseId: 'case-diagnostic-1',
    generation: 0,
    evidenceBundleDigest: bundle.bundleDigest,
    createdAtMs: now,
    expiresAtMs: now + 9_000,
    observedFacts: [{ claimId: 'fact-1', claimDigest: sha256('fact-1'), evidencePointerIds: ['pointer-fact'], disposition: 'VALIDATED' }],
    hypotheses: [{
      claimId: 'hypothesis-1',
      claimDigest: sha256('hypothesis-1'),
      evidencePointerIds: ['pointer-fact'],
      disposition: 'VALIDATED',
      falsificationTestIds: ['test-hypothesis-1'],
    }],
    supportingEvidencePointerIds: ['pointer-fact'],
    conflictingEvidencePointerIds: [],
    uncertainty: 'MEDIUM',
    missingEvidenceCodes: [],
    falsificationTestIds: ['test-hypothesis-1'],
    affectedCapabilityIds: ['capability-diagnostics'],
    immediateSafetyPostureDigest: sha256('safety-posture'),
    recommendedNextStep: 'RUN_SYNTHETIC_FALSIFICATION',
    forbiddenOrUnavailableActionCodes: ['NO_MONEY_PATHS', 'NO_PRODUCTION_AUTHORITY'],
    versions,
    likelyRootCause: 'hypothesis-1',
    recommendedRunbookIds: ['runbook-synthetic'],
    proposedQueryOrTestIds: ['test-hypothesis-1'],
    patchRecommended: 'UNKNOWN',
    ownerAttentionRequired: false,
    escalationReasonCode: null,
    ...overrides,
  };
}

function rehashDiagnostic(diagnostic, overrides) {
  const { diagnosisId: _diagnosisId, diagnosisDigest: _diagnosisDigest, ...core } = diagnostic;
  const forgedCore = { ...core, ...overrides };
  const diagnosisDigest = sha256(canonicalJson(forgedCore));
  return {
    ...forgedCore,
    diagnosisId: `a2-diagnosis:${sha256(canonicalJson({
      namespace: 'a2-diagnosis',
      naturalIdentity: { caseId: forgedCore.caseId, generation: forgedCore.generation, diagnosisDigest },
    })).slice(0, 24)}`,
    diagnosisDigest,
  };
}

function claimDecisionsFor(input) {
  return [
    ...input.observedFacts.map((claim) => ({
      claimKind: 'OBSERVED_FACT', claimId: claim.claimId, claimDigest: claim.claimDigest,
      evidencePointerIds: [...claim.evidencePointerIds].sort(), falsificationTestIds: [], disposition: claim.disposition,
    })),
    ...input.hypotheses.map((claim) => ({
      claimKind: 'HYPOTHESIS', claimId: claim.claimId, claimDigest: claim.claimDigest,
      evidencePointerIds: [...claim.evidencePointerIds].sort(), falsificationTestIds: [...claim.falsificationTestIds].sort(),
      disposition: claim.disposition,
    })),
  ];
}

const validClaimValidationPort = createSyntheticClaimValidationPort(claimDecisionsFor(diagnosticInput()));

function createDiagnostic(overrides = {}, port = validEvidencePort, boundBundle = bundle) {
  const input = diagnosticInput({ evidenceBundleDigest: boundBundle.bundleDigest, ...overrides });
  return createDiagnosticResult(
    input,
    boundBundle,
    now,
    evidenceLimits,
    port,
    createSyntheticClaimValidationPort(claimDecisionsFor(input)),
    diagnosticBudgetAdmission,
  );
}

test('typed diagnostic separates validated facts from hypotheses and binds every fact pointer', () => {
  const result = createDiagnostic();
  assert.equal(result.shadowStatus, 'SHADOW_SPECULATIVE');
  assert.equal(result.disposition, 'VALIDATED');
  assert.equal(result.likelyRootCause, 'hypothesis-1');
  assert.match(result.diagnosisId, /^a2-diagnosis:/u);
  assert.equal(result.operationalAuthority, 'NONE');
  assert.equal('evidenceValidations' in result, false);
  const wrongProviderAdmission = budgetAdmissionFor(result.caseId, 'different-provider', versions.modelId);
  assert.throws(() => createDiagnosticResult(
    diagnosticInput(), bundle, now, evidenceLimits, validEvidencePort, validClaimValidationPort, wrongProviderAdmission,
  ), /provider budget lineage/u);
  assert.throws(() => createDiagnostic({
    observedFacts: [{ claimId: 'fact-1', claimDigest: sha256('fact-1'), evidencePointerIds: ['pointer-conflict'], disposition: 'VALIDATED' }],
  }, { readEvidencePointer: () => ({ state: 'UNAVAILABLE' }) }), /not validated/u);
  assert.throws(() => createDiagnostic({
    hypotheses: [{ claimId: 'hypothesis-1', claimDigest: sha256('hypothesis-1'), evidencePointerIds: [], disposition: 'INCONCLUSIVE', falsificationTestIds: [] }],
  }), /falsification path/u);
  assert.throws(() => createDiagnostic({
    hypotheses: [{ claimId: 'hypothesis-1', claimDigest: sha256('hypothesis-1'), evidencePointerIds: [], disposition: 'VALIDATED', falsificationTestIds: ['test-hypothesis-1'] }],
  }), /require evidence pointers/u);
  assert.throws(() => createDiagnostic({
    likelyRootCause: 'UNKNOWN',
    hypotheses: [{ claimId: 'hypothesis-1', claimDigest: sha256('hypothesis-1'), evidencePointerIds: [], disposition: 'INVALIDATED', falsificationTestIds: ['test-hypothesis-1'] }],
  }), /require evidence pointers/u);
  for (const disposition of ['INVALIDATED', 'INCONCLUSIVE']) {
    assert.throws(() => createDiagnostic({
      likelyRootCause: 'UNKNOWN',
      hypotheses: [{
        claimId: 'hypothesis-1', claimDigest: sha256('hypothesis-1'), evidencePointerIds: ['pointer-forged'],
        disposition, falsificationTestIds: ['test-hypothesis-1'],
      }],
    }), /without a validation record/u);
  }
  assert.throws(() => createDiagnostic({ createdAtMs: now + 1, expiresAtMs: now + 2 }), /creation time must equal trusted now|not yet valid/u);
  assert.throws(() => createDiagnostic({ createdAtMs: now - 1, expiresAtMs: now }), /creation time must equal trusted now|predates|expired/u);
  const olderBundle = buildEvidenceBundle({
    ...baseBundleContext,
    createdAtMs: now - 1,
    evidenceWindowEndMs: now - 1,
  }, evidenceItems, evidenceLimits);
  const backdatedInput = diagnosticInput({
    evidenceBundleDigest: olderBundle.bundleDigest,
    createdAtMs: now - 1,
  });
  assert.throws(() => createDiagnosticResult(
    backdatedInput,
    olderBundle,
    now,
    evidenceLimits,
    validEvidencePort,
    createSyntheticClaimValidationPort(claimDecisionsFor(backdatedInput)),
    diagnosticBudgetAdmission,
  ), /creation time must equal trusted now/u);
  assert.throws(() => createDiagnostic({ expiresAtMs: now + 9_902 }), /outlives evidence freshness/u);
  assert.throws(() => createDiagnostic({ recommendedNextStep: 'PLACE_LIVE_ORDER' }), /no-money/u);
  for (const action of [
    'BUY_BTC', 'BUY.BTC', 'SELL_POSITION', 'TRADE_MARKET', 'SIGN_ORDER', 'PLACE_SPOT_ORDER', 'PLACE:ORDER',
    'EXECUTE_TEST_ORDER', 'PURCHASE_BTC', 'LIQUIDATE_POSITION', 'TRANSFER:OUT', 'INTEGRATED:ACCEPTED',
  ]) {
    assert.throws(() => createDiagnostic({ recommendedNextStep: action }), /no-money/u);
  }
  assert.throws(() => createDiagnostic({ versions: { ...versions, policyRevision: 'policy-v2' } }), /provider budget lineage|policy revision/u);
  assert.throws(() => createDiagnostic({ forbiddenOrUnavailableActionCodes: [] }), /required denial/u);
  assert.throws(() => createDiagnostic({ falsificationTestIds: ['different-test'] }), /exactly cover hypotheses/u);
});

test('invalidated conclusions require current owner-validated falsification evidence', () => {
  const result = createDiagnostic({
    likelyRootCause: 'UNKNOWN',
    hypotheses: [{
      claimId: 'hypothesis-1', claimDigest: sha256('hypothesis-1'), evidencePointerIds: ['pointer-fact'],
      disposition: 'INVALIDATED', falsificationTestIds: ['test-hypothesis-1'],
    }],
  });
  assert.equal(result.disposition, 'INVALIDATED');
  assert.throws(() => createDiagnostic({
    likelyRootCause: 'UNKNOWN',
    observedFacts: [],
    supportingEvidencePointerIds: [],
    hypotheses: [{
      claimId: 'hypothesis-1', claimDigest: sha256('hypothesis-1'), evidencePointerIds: ['pointer-fact'],
      disposition: 'INVALIDATED', falsificationTestIds: ['test-hypothesis-1'],
    }],
  }, { readEvidencePointer: () => ({ state: 'UNAVAILABLE' }) }), /invalidated hypothesis cites evidence/u);
});

test('diagnostic time is bounded by bundle creation even when the bundle is empty', () => {
  const emptyBundle = buildEvidenceBundle({
    ...baseBundleContext,
    caseId: 'case-empty-diagnostic',
    incidentId: 'incident-empty-diagnostic',
    fingerprint: sha256('empty-diagnostic'),
  }, [], evidenceLimits);
  const emptyAdmission = budgetAdmissionFor(emptyBundle.caseId);
  const emptyInput = diagnosticInput({
    caseId: emptyBundle.caseId,
    evidenceBundleDigest: emptyBundle.bundleDigest,
    versions: {
      ...versions,
      budgetAdmissionDigest: emptyAdmission.admissionDigest,
      usageRequestDigest: emptyAdmission.usageRequestDigest,
    },
    observedFacts: [],
    hypotheses: [{
      claimId: 'hypothesis-empty', claimDigest: sha256('hypothesis-empty'), evidencePointerIds: [],
      disposition: 'INCONCLUSIVE', falsificationTestIds: ['test-empty'],
    }],
    supportingEvidencePointerIds: [],
    likelyRootCause: 'UNKNOWN',
    uncertainty: 'UNKNOWN',
    missingEvidenceCodes: ['NO_EVIDENCE'],
    expiresAtMs: emptyBundle.createdAtMs + evidenceLimits.maximumAgeMs + 2,
  });
  assert.throws(() => createDiagnosticResult(emptyInput, emptyBundle, now, evidenceLimits, validEvidencePort, validClaimValidationPort, emptyAdmission), /outlives evidence freshness/u);
  assert.throws(() => createDiagnostic({ createdAtMs: bundle.createdAtMs - 1 }), /creation time must equal trusted now|predates its evidence bundle/u);
  const futureBundle = buildEvidenceBundle({
    ...baseBundleContext,
    createdAtMs: now + 1,
    evidenceWindowEndMs: now + 1,
  }, evidenceItems, evidenceLimits);
  assert.throws(() => createDiagnosticResult(diagnosticInput({
    evidenceBundleDigest: futureBundle.bundleDigest,
    createdAtMs: now,
  }), futureBundle, now, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission), /from the future|predates/u);
});

test('missing evidence and unknown uncertainty produce INCONCLUSIVE rather than invented confidence', () => {
  const result = createDiagnostic({
    likelyRootCause: 'UNKNOWN',
    uncertainty: 'UNKNOWN',
    missingEvidenceCodes: ['OWNER_EVIDENCE_UNAVAILABLE'],
    hypotheses: [{
      claimId: 'hypothesis-1', claimDigest: sha256('hypothesis-1'), evidencePointerIds: ['pointer-conflict'],
      disposition: 'INCONCLUSIVE', falsificationTestIds: ['test-hypothesis-1'],
    }],
  });
  assert.equal(result.disposition, 'INCONCLUSIVE');
  assert.equal(result.ownerAttentionRequired, false);
});

test('bundle-level stale, conflicting, unknown, and omitted evidence can never validate a diagnosis', () => {
  for (const contextOverride of [
    { freshness: 'STALE' },
    { temporalCoherence: 'CONFLICTING' },
    { missingEvidenceCodes: ['OWNER_GAP'] },
    { conflictingEvidenceCodes: ['CLOCK_CONFLICT'] },
    { unknownCodes: ['REVISION_UNKNOWN'] },
  ]) {
    const deficient = buildEvidenceBundle({ ...baseBundleContext, ...contextOverride }, evidenceItems, evidenceLimits);
    assert.equal(createDiagnostic({}, validEvidencePort, deficient).disposition, 'INCONCLUSIVE');
  }
  const omittedLimits = { ...evidenceLimits, maximumItems: 1 };
  const omitted = buildEvidenceBundle(baseBundleContext, evidenceItems, omittedLimits);
  const omittedInput = diagnosticInput({
    evidenceBundleDigest: omitted.bundleDigest,
    observedFacts: [{ claimId: 'fact-1', claimDigest: sha256('fact-1'), evidencePointerIds: [omitted.items[0].pointer.pointerId], disposition: 'VALIDATED' }],
    hypotheses: [{
      claimId: 'hypothesis-1', claimDigest: sha256('hypothesis-1'), evidencePointerIds: [omitted.items[0].pointer.pointerId],
      disposition: 'VALIDATED', falsificationTestIds: ['test-hypothesis-1'],
    }],
    supportingEvidencePointerIds: [omitted.items[0].pointer.pointerId],
  });
  const result = createDiagnosticResult(
    omittedInput, omitted, now, omittedLimits, validEvidencePort,
    createSyntheticClaimValidationPort(claimDecisionsFor(omittedInput)),
    diagnosticBudgetAdmission,
  );
  assert.equal(result.disposition, 'INCONCLUSIVE');
});

test('durable model-run handoff is bounded, deterministic, lineage-bound, and expires exactly', () => {
  const diagnostic = createDiagnostic();
  const input = {
    caseId: 'case-diagnostic-1',
    generation: 0,
    runId: 'run-synthetic-1',
    intentCode: 'DIAGNOSE_ONLY',
    evidenceBundleDigest: bundle.bundleDigest,
    validatedFactIds: ['fact-1'],
    validatedHypothesisIds: ['hypothesis-1'],
    invalidatedHypothesisIds: [],
    inconclusiveHypothesisIds: [],
    actionReceipts: [{ receiptId: 'receipt-provider-1', receiptDigest: sha256('receipt-provider-1') }],
    proposedArtifactDigests: [sha256('artifact')],
    decisionCodes: ['DIAGNOSIS_RECORDED'],
    denialCodes: ['NO_MONEY_PATHS', 'NO_PRODUCTION_AUTHORITY'],
    unresolvedRiskCodes: ['OWNER_BINDING_PENDING'],
    nextStepCodes: ['HANDOFF_TO_OWNER'],
    stopCondition: 'SHADOW_ARTIFACT_READY',
    versions,
    createdAtMs: now,
    expiresAtMs: now + 8_000,
  };
  const handoff = createModelRunHandoff(input, diagnostic, bundle, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission);
  assert.equal(handoff.operationalAuthority, 'NONE');
  assert.deepEqual(handoff, createModelRunHandoff(input, diagnostic, bundle, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission));
  assert.equal(verifyModelRunHandoff(handoff, diagnostic, bundle, input.caseId, 0, now + 1, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission).valid, true);
  assert.equal(verifyModelRunHandoff(handoff, diagnostic, bundle, input.caseId, 0, handoff.expiresAtMs, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission).valid, false);
  const expiredDiagnostic = verifyModelRunHandoff(handoff, diagnostic, bundle, input.caseId, 0, diagnostic.expiresAtMs, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission);
  assert.equal(expiredDiagnostic.valid, false);
  assert.ok(expiredDiagnostic.reasonCodes.includes('MODEL_HANDOFF_DIAGNOSTIC_EXPIRED'));
  const tampered = verifyModelRunHandoff({ ...handoff, nextStepCodes: ['REVIEW_DIAGNOSTIC'] }, diagnostic, bundle, input.caseId, 0, now + 1, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission);
  assert.equal(tampered.valid, false);
  assert.ok(tampered.reasonCodes.includes('MODEL_HANDOFF_DIGEST_MISMATCH'));
  assert.throws(() => createModelRunHandoff({ ...input, nextStepCodes: [] }, diagnostic, bundle, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission), /exact next steps/u);
  assert.throws(() => createModelRunHandoff({ ...input, createdAtMs: diagnostic.expiresAtMs, expiresAtMs: diagnostic.expiresAtMs + 1 }, diagnostic, bundle, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission), /diagnostic is expired|expired/u);
  assert.throws(() => createModelRunHandoff({ ...input, expiresAtMs: diagnostic.expiresAtMs + 1 }, diagnostic, bundle, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission), /outlives diagnostic validity/u);
  assert.throws(() => createModelRunHandoff({ ...input, intentCode: 'PLACE_LIVE_ORDER' }, diagnostic, bundle, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission), /no-money/u);
  assert.throws(() => createModelRunHandoff({ ...input, denialCodes: [] }, diagnostic, bundle, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission), /required denial/u);
  assert.throws(() => createModelRunHandoff({ ...input, stopCondition: 'INTEGRATED_ACCEPTED' }, diagnostic, bundle, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission), /SHADOW_ARTIFACT_READY/u);
  assert.throws(() => createModelRunHandoff({
    ...input,
    versions: { ...versions, modelId: 'different-model' },
  }, diagnostic, bundle, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission), /versions do not match/u);
  const { diagnosisId: _diagnosisId, diagnosisDigest: _diagnosisDigest, ...diagnosticCore } = diagnostic;
  const forgedCore = { ...diagnosticCore, evidenceValidationDigest: sha256('forged-validation-set') };
  const forgedDigest = sha256(canonicalJson(forgedCore));
  const forgedDiagnostic = {
    ...forgedCore,
    diagnosisId: `a2-diagnosis:${sha256(canonicalJson({
      namespace: 'a2-diagnosis',
      naturalIdentity: { caseId: diagnostic.caseId, generation: diagnostic.generation, diagnosisDigest: forgedDigest },
    })).slice(0, 24)}`,
    diagnosisDigest: forgedDigest,
  };
  assert.throws(
    () => createModelRunHandoff(input, forgedDiagnostic, bundle, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission),
    /diagnostic claims are not exactly owner-validated|does not match current evidence validation/u,
  );
  const semanticForgeries = [
    rehashDiagnostic(diagnostic, { recommendedNextStep: 'PLACE_LIVE_ORDER' }),
    rehashDiagnostic(diagnostic, { forbiddenOrUnavailableActionCodes: [] }),
    rehashDiagnostic(diagnostic, { supportingEvidencePointerIds: ['pointer-forged'] }),
    rehashDiagnostic(diagnostic, { disposition: 'INCONCLUSIVE' }),
  ];
  for (const semanticForgery of semanticForgeries) {
    assert.throws(
      () => createModelRunHandoff(input, semanticForgery, bundle, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission),
      /no-money|required denial|supporting evidence|semantically derived/u,
    );
  }
});

test('owner callbacks and hostile arrays cannot rewrite diagnostic or handoff inputs', () => {
  const mutableInput = diagnosticInput();
  const mutatingEvidencePort = {
    readEvidencePointer(pointer) {
      mutableInput.likelyRootCause = 'UNKNOWN';
      mutableInput.observedFacts.length = 0;
      const item = evidenceItems.find((candidate) => candidate.pointerId === pointer.pointerId);
      return item === undefined ? { state: 'UNKNOWN' } : {
        state: 'AVAILABLE', rawDigest: item.rawDigest, byteLength: item.byteLength,
        observedAtMs: now, sourceKind: item.sourceKind, rawText: item.text,
      };
    },
  };
  const result = createDiagnosticResult(mutableInput, bundle, now, evidenceLimits, mutatingEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission);
  assert.equal(result.likelyRootCause, 'hypothesis-1');
  assert.deepEqual(result.observedFacts.map((claim) => claim.claimId), ['fact-1']);

  const hostileReceipts = [{ receiptId: 'receipt-hostile', receiptDigest: sha256('receipt-hostile') }];
  Object.defineProperty(hostileReceipts, Symbol.iterator, {
    value: function* hostileIterator() {
      yield { receiptId: 'forged-receipt', receiptDigest: sha256('forged-receipt') };
    },
  });
  const diagnostic = createDiagnostic();
  assert.throws(() => createModelRunHandoff({
    caseId: diagnostic.caseId,
    generation: diagnostic.generation,
    runId: 'run-hostile-array',
    intentCode: 'DIAGNOSE_ONLY',
    evidenceBundleDigest: bundle.bundleDigest,
    validatedFactIds: ['fact-1'],
    validatedHypothesisIds: ['hypothesis-1'],
    invalidatedHypothesisIds: [],
    inconclusiveHypothesisIds: [],
    actionReceipts: hostileReceipts,
    proposedArtifactDigests: [],
    decisionCodes: ['DIAGNOSIS_RECORDED'],
    denialCodes: ['NO_MONEY_PATHS', 'NO_PRODUCTION_AUTHORITY'],
    unresolvedRiskCodes: [],
    nextStepCodes: ['HANDOFF_TO_OWNER'],
    stopCondition: 'SHADOW_ARTIFACT_READY',
    versions,
    createdAtMs: now,
    expiresAtMs: now + 8_000,
  }, diagnostic, bundle, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission), /custom array fields|symbol/u);
});

test('claim adjudication is issued once, then durable receipts are owner-verified without reissuance', () => {
  const sourcePort = createSyntheticClaimValidationPort(claimDecisionsFor(diagnosticInput()));
  let issuanceCalls = 0;
  let verificationCalls = 0;
  const countingPort = {
    posture: 'SYNTHETIC_ONLY',
    validateClaim(request) {
      issuanceCalls += 1;
      return sourcePort.validateClaim(request);
    },
    verifyClaimValidation(receipt) {
      verificationCalls += 1;
      return sourcePort.verifyClaimValidation(receipt);
    },
  };
  const diagnostic = createDiagnosticResult(diagnosticInput(), bundle, now, evidenceLimits, validEvidencePort, countingPort, diagnosticBudgetAdmission);
  assert.equal(issuanceCalls, 2);
  assert.ok(verificationCalls >= 2);
  const input = {
    caseId: diagnostic.caseId,
    generation: diagnostic.generation,
    runId: 'run-claim-receipt-replay',
    intentCode: 'DIAGNOSE_ONLY',
    evidenceBundleDigest: bundle.bundleDigest,
    validatedFactIds: ['fact-1'],
    validatedHypothesisIds: ['hypothesis-1'],
    invalidatedHypothesisIds: [],
    inconclusiveHypothesisIds: [],
    actionReceipts: [],
    proposedArtifactDigests: [],
    decisionCodes: ['DIAGNOSIS_RECORDED'],
    denialCodes: ['NO_MONEY_PATHS', 'NO_PRODUCTION_AUTHORITY'],
    unresolvedRiskCodes: [],
    nextStepCodes: ['HANDOFF_TO_OWNER'],
    stopCondition: 'SHADOW_ARTIFACT_READY',
    versions,
    createdAtMs: now,
    expiresAtMs: now + 8_000,
  };
  const handoff = createModelRunHandoff(input, diagnostic, bundle, evidenceLimits, validEvidencePort, countingPort, diagnosticBudgetAdmission);
  const afterHandoffIssuanceCalls = issuanceCalls;
  assert.equal(afterHandoffIssuanceCalls, 2);
  assert.equal(verifyModelRunHandoff(
    handoff, diagnostic, bundle, diagnostic.caseId, diagnostic.generation, now + 1,
    evidenceLimits, validEvidencePort, countingPort, diagnosticBudgetAdmission,
  ).valid, true);
  assert.equal(issuanceCalls, afterHandoffIssuanceCalls);
});

test('unknown claim digests cannot become validated by requesting owner approval', () => {
  const forgedInput = diagnosticInput({
    observedFacts: [{
      ...diagnosticInput().observedFacts[0],
      claimDigest: sha256('unknown-owner-claim'),
    }],
  });
  assert.throws(
    () => createDiagnosticResult(forgedInput, bundle, now, evidenceLimits, validEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission),
    /did not validate the requested disposition/u,
  );
});

test('handoff verification uses current evidence time and reports owner revalidation outage precisely', () => {
  let readAtMs = now;
  const advancingEvidencePort = {
    readEvidencePointer(pointer) {
      const item = evidenceItems.find((candidate) => candidate.pointerId === pointer.pointerId);
      return item === undefined ? { state: 'UNKNOWN' } : {
        state: 'AVAILABLE', rawDigest: item.rawDigest, byteLength: item.byteLength,
        observedAtMs: readAtMs, sourceKind: item.sourceKind, rawText: item.text,
      };
    },
  };
  const diagnostic = createDiagnostic({}, advancingEvidencePort);
  const input = {
    caseId: diagnostic.caseId,
    generation: diagnostic.generation,
    runId: 'run-current-readback',
    intentCode: 'DIAGNOSE_ONLY',
    evidenceBundleDigest: bundle.bundleDigest,
    validatedFactIds: ['fact-1'],
    validatedHypothesisIds: ['hypothesis-1'],
    invalidatedHypothesisIds: [],
    inconclusiveHypothesisIds: [],
    actionReceipts: [],
    proposedArtifactDigests: [],
    decisionCodes: ['DIAGNOSIS_RECORDED'],
    denialCodes: ['NO_MONEY_PATHS', 'NO_PRODUCTION_AUTHORITY'],
    unresolvedRiskCodes: [],
    nextStepCodes: ['HANDOFF_TO_OWNER'],
    stopCondition: 'SHADOW_ARTIFACT_READY',
    versions,
    createdAtMs: now,
    expiresAtMs: now + 8_000,
  };
  const handoff = createModelRunHandoff(input, diagnostic, bundle, evidenceLimits, advancingEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission);
  readAtMs = now + 1;
  assert.equal(verifyModelRunHandoff(
    handoff, diagnostic, bundle, diagnostic.caseId, diagnostic.generation, now + 1,
    evidenceLimits, advancingEvidencePort, validClaimValidationPort, diagnosticBudgetAdmission,
  ).valid, true);
  const unavailable = verifyModelRunHandoff(
    handoff, diagnostic, bundle, diagnostic.caseId, diagnostic.generation, now + 1,
    evidenceLimits, { readEvidencePointer: () => ({ state: 'UNAVAILABLE' }) }, validClaimValidationPort, diagnosticBudgetAdmission,
  );
  assert.equal(unavailable.valid, false);
  assert.ok(unavailable.reasonCodes.includes('MODEL_HANDOFF_DIAGNOSTIC_REVALIDATION_FAILED'));
  assert.equal(unavailable.reasonCodes.includes('MODEL_HANDOFF_STRUCTURE_INVALID'), false);
});

test('equivalent claim-set permutations produce one deterministic diagnosis', () => {
  const factA = diagnosticInput().observedFacts[0];
  const factB = { claimId: 'fact-2', claimDigest: sha256('fact-2'), evidencePointerIds: ['pointer-fact'], disposition: 'VALIDATED' };
  const hypothesisA = diagnosticInput().hypotheses[0];
  const hypothesisB = {
    claimId: 'hypothesis-2', claimDigest: sha256('hypothesis-2'), evidencePointerIds: ['pointer-fact'],
    disposition: 'INCONCLUSIVE', falsificationTestIds: ['test-hypothesis-2'],
  };
  const overrides = {
    observedFacts: [factB, factA],
    hypotheses: [hypothesisB, hypothesisA],
    falsificationTestIds: ['test-hypothesis-2', 'test-hypothesis-1'],
  };
  const first = createDiagnostic(overrides);
  const second = createDiagnostic({
    ...overrides,
    observedFacts: [...overrides.observedFacts].reverse(),
    hypotheses: [...overrides.hypotheses].reverse(),
    falsificationTestIds: [...overrides.falsificationTestIds].reverse(),
  });
  assert.deepEqual(first, second);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { loadContracts } from './_network-denied-env.mjs';

const contracts = await loadContracts();
const textEncoder = new TextEncoder();

function fixtureByteMap(fixture, overrides = {}) {
  return Object.fromEntries(Object.entries({ ...fixture.fileContentsUtf8, ...overrides }).map(([path, content]) => [path, textEncoder.encode(content)]));
}

function exactContentVerifier(fixture, bytesByPath = fixtureByteMap(fixture)) {
  return { verifyExactInventory: (files) => contracts.verifyPolicyFileByteMap(files, bytesByPath) };
}

function exactEvidenceVerifier(evidence) {
  return {
    verifyEvidence: () => ({
      profile: 'LEDGER_GRADUATION_EVIDENCE_READBACK_V1',
      verified: true,
      evidenceDigest: evidence.evidenceDigest,
      runbookId: evidence.runbookId,
      capabilityId: evidence.capabilityId,
      labeledCaseCount: evidence.labeledCases,
      shadowRunCount: evidence.shadowRuns,
      evidenceReceiptReference: 'ledger-receipt://synthetic/runbook-evidence',
    }),
  };
}

function exactPolicySemanticVerifier() {
  return {
    verifyPolicySemantics(payload) {
      return {
        profile: 'AI_OPS_POLICY_SEMANTIC_TEST_V1',
        verified: true,
        bundleDigest: contracts.sha256Canonical(payload),
        defaultDenyVerified: true,
        executedHardDenialIds: contracts.AI_OPS_HARD_DENIAL_IDS,
        executedCaseCount: contracts.AI_OPS_HARD_DENIAL_IDS.length,
        testSuiteDigest: contracts.AI_OPS_POLICY_SEMANTIC_TEST_SUITE_DIGEST,
        evidenceReference: 'policy-test-evidence://synthetic/denial-suite-v1',
      };
    },
  };
}

function exactLastKnownGoodVerifier() {
  return {
    verifyLastKnownGood(bundle) {
      const payload = bundle.payload;
      const bundleDigest = contracts.sha256Canonical(payload);
      const signedBundleDigest = contracts.sha256Canonical(bundle);
      return {
        profile: 'CANONICAL_POLICY_LKG_READBACK_V1',
        verified: true,
        bundleDigest,
        signedBundleDigest,
        policyEpoch: payload.policyEpoch,
        revision: payload.revision,
        signatureVerified: true,
        exactContentVerified: true,
        semanticTestsVerified: true,
        semanticTestSuiteDigest: contracts.AI_OPS_POLICY_SEMANTIC_TEST_SUITE_DIGEST,
        activationDurable: true,
        activationReceiptReference: 'ledger-receipt://synthetic/policy-activation',
        readbackDigest: signedBundleDigest,
      };
    },
  };
}

function signedPolicyBundle(payload, template = contracts.AI_OPS_SYNTHETIC_POLICY_BUNDLE_FIXTURE.candidate) {
  const digest = contracts.sha256Canonical(payload);
  return {
    payload,
    signature: { ...template.signature, signedPayloadDigest: digest },
    declaredBundleDigest: digest,
  };
}

function exactChainVerifier(predecessor) {
  return {
    verifyChainPrefix(record) {
      const proof = {
        profile: 'LEDGER_CHAIN_PREFIX_READBACK_V1',
        verified: true,
        headSequence: record.sequence - 1,
        headRecordDigest: predecessor.recordDigest,
        recordCount: record.sequence - 1,
        maximumTimestampMs: predecessor.timestampMs,
        readbackReceiptReference: 'ledger-receipt://synthetic/chain-prefix',
      };
      return {
        ...proof,
        chainDigest: contracts.sha256Canonical({
          profile: proof.profile,
          headSequence: proof.headSequence,
          headRecordDigest: proof.headRecordDigest,
          recordCount: proof.recordCount,
          maximumTimestampMs: proof.maximumTimestampMs,
          readbackReceiptReference: proof.readbackReceiptReference,
        }),
      };
    },
  };
}

function decisionPort(predecessor = null, receiptMutator = (receipt) => receipt, readbackMutator = (record) => record, beforeAtomicAppend = () => {}) {
  const records = new Map(predecessor === null ? [] : [[predecessor.sequence, predecessor]]);
  return {
    appendCount: 0,
    seed(record) {
      records.set(record.sequence, record);
    },
    appendAtomically(record, condition) {
      beforeAtomicAppend(records, record, condition);
      const head = condition.expectedHeadSequence === 0 ? null : records.get(condition.expectedHeadSequence) ?? null;
      assert.equal(condition.profile, 'LEDGER_ATOMIC_COMPARE_APPEND_V1');
      assert.equal(condition.targetSequence, record.sequence);
      assert.equal(condition.targetSequenceMustBeEmpty, true);
      assert.equal(condition.recordDigest, record.recordDigest);
      assert.equal(condition.expectedHeadRecordDigest, record.previousRecordDigest);
      assert.equal(head?.recordDigest ?? null, condition.expectedHeadRecordDigest);
      assert.equal(records.has(condition.targetSequence), false);
      const { conditionDigest, ...conditionBody } = condition;
      assert.equal(conditionDigest, contracts.computeDecisionLogAppendConditionDigest(conditionBody));
      this.appendCount += 1;
      records.set(record.sequence, record);
      return receiptMutator({
        persistenceOwner: 'LEDGER',
        sequence: record.sequence,
        recordDigest: record.recordDigest,
        appendReceiptReference: `ledger-receipt://synthetic/${record.sequence}`,
        durable: true,
        conditionDigest,
        atomicCompareAndAppend: true,
        replacedExisting: false,
      });
    },
    readback(sequence) {
      const record = records.get(sequence) ?? null;
      return record === null ? null : readbackMutator(record, sequence);
    },
  };
}

function exactAnchorVerifier() {
  return {
    verifyAnchor(record, verificationTimeMs) {
      const proof = {
        profile: 'AI_OPS_DECISION_ANCHOR_READBACK_V1',
        verified: true,
        assurance: record.requestedAssurance,
        recordDigest: record.recordDigest,
        checkpointReceiptReference: record.checkpointReceiptReference,
        anchorOwner: record.requestedAssurance === 'SIGNED_CHECKPOINT' ? 'AI_OPS_OWNER' : 'INDEPENDENT_AUDIT_OWNER',
        anchorId: `synthetic-anchor-${record.sequence}`,
        issuedAtMs: record.timestampMs,
        expiresAtMs: verificationTimeMs + 60_000,
        verifiedAtMs: verificationTimeMs,
        verificationReceiptReference: `anchor-verification://synthetic/${record.sequence}`,
      };
      return { ...proof, proofDigest: contracts.computeDecisionLogAnchorProofDigest(proof) };
    },
  };
}

function passingEvidence(template) {
  const target = template.graduationTarget;
  const failedRuns = target.minimumShadowRuns - target.minimumSuccessfulRuns;
  const evidence = {
    runbookId: template.runbookId,
    capabilityId: target.capabilityId,
    labeledCases: target.minimumLabeledCases,
    shadowRuns: target.minimumShadowRuns,
    successfulRuns: target.minimumSuccessfulRuns,
    failedRuns,
    successRatePermillion: target.minimumSuccessRatePermillion,
    failureRatePermillion: target.maximumFailureRatePermillion,
    replayPassRatePermillion: target.minimumReplayPassRatePermillion,
    falsePositiveRatePermillion: target.maximumFalsePositiveRatePermillion,
    falseRepairRatePermillion: target.maximumFalseRepairRatePermillion,
    calibrationScorePermillion: target.minimumCalibrationScorePermillion,
    abstentionPrecisionPermillion: target.minimumAbstentionPrecisionPermillion,
    rollbackRatePermillion: target.maximumRollbackRatePermillion,
    evidenceCompletenessPermillion: target.minimumEvidenceCompletenessPermillion,
    maximumUnresolvedSeverityRankObserved: target.maximumUnresolvedSeverityRank,
    p99LatencyMs: target.maximumP99LatencyMs,
    maximumConsecutiveFailuresObserved: target.maximumConsecutiveFailures,
    maximumRetryAttemptsObserved: target.maximumRetryAttemptsPerIncident,
    maximumResourceBytesObserved: target.maximumResourceBytesPerRun,
    maximumCostMicrounitsObserved: target.maximumCostMicrounitsPerRun,
    quietPeriodObservedMs: target.minimumQuietPeriodMs,
    recurrenceCount: target.maximumRecurrenceCount,
    recurrenceRatePermillion: Math.ceil((target.maximumRecurrenceCount * 1_000_000) / target.minimumShadowRuns),
  };
  return { ...evidence, evidenceDigest: contracts.computeGraduationEvidenceDigest(evidence) };
}

function rewriteEvidence(evidence, overrides) {
  const { evidenceDigest: _evidenceDigest, ...body } = evidence;
  const rewritten = { ...body, ...overrides };
  return { ...rewritten, evidenceDigest: contracts.computeGraduationEvidenceDigest(rewritten) };
}

test('every Class-A action has one unsigned owner-bound template and numerical targets', () => {
  assert.deepEqual(contracts.validateRunbookTemplates(), []);
  assert.equal(contracts.AI_OPS_RUNBOOK_TEMPLATES.length, 10);
  assert.deepEqual(contracts.AI_OPS_RUNBOOK_TEMPLATES.map((row) => row.actionId), contracts.AI_OPS_CLASS_A_ACTION_IDS);
  for (const template of contracts.AI_OPS_RUNBOOK_TEMPLATES) {
    assert.equal(template.ownerSignature, null);
    assert.equal(template.ownerSignatureState, 'OWNER_SIGNATURE_REQUIRED');
    assert.equal(template.registrationState, 'INSERTION_REQUEST_ONLY');
    assert.equal(template.authorityCreated, false);
    for (const [key, value] of Object.entries(template.graduationTarget)) {
      if (key === 'capabilityId') continue;
      assert.equal(Number.isFinite(value), true, `${template.runbookId}:${key}`);
      assert.ok(value >= 0, `${template.runbookId}:${key}`);
    }
  }
});

test('graduation targets cover runbooks, prompt, provider, model and every patch category', () => {
  const rows = contracts.AI_OPS_CAPABILITY_RELIABILITY_TARGETS;
  assert.equal(rows.filter((row) => row.targetKind === 'RUNBOOK').length, 10);
  for (const kind of ['PROMPT_REVISION', 'PROVIDER_ROUTE', 'MODEL_REVISION']) {
    assert.ok(rows.some((row) => row.targetKind === kind), kind);
  }
  assert.equal(rows.filter((row) => row.targetKind === 'PATCH_CATEGORY').length, 4);
  for (const row of rows) {
    assert.equal(row.ownerSignature, null);
    assert.equal(row.activationState, 'UNSIGNED_INACTIVE');
    assert.equal(row.authorityCreated, false);
    assert.equal(row.target.minimumEvidenceCompletenessPermillion, 1_000_000);
    assert.equal(row.target.maximumFalseRepairRatePermillion, 0);
  }
});

test('unsigned runbooks and missed numerical targets fail closed', () => {
  const template = contracts.AI_OPS_RUNBOOK_TEMPLATES[0];
  const evidence = passingEvidence(template);
  const unsigned = contracts.evaluateRunbookGraduation(template, evidence, null, null, 1_784_001_600_000);
  assert.equal(unsigned.eligible, false);
  assert.equal(unsigned.authorityGranted, false);
  assert.ok(unsigned.reasonCodes.includes('OWNER_SIGNATURE_REQUIRED'));
  assert.ok(unsigned.reasonCodes.includes('GRADUATION_EVIDENCE_VERIFICATION_REQUIRED'));
  assert.ok(unsigned.reasonCodes.includes('SHADOW_SPECULATIVE_CANNOT_GRANT_AUTHORITY'));
  const insufficient = contracts.evaluateRunbookGraduation(template, rewriteEvidence(evidence, { shadowRuns: 1, successfulRuns: 1, failedRuns: 0 }), null, null, 1_784_001_600_000);
  assert.equal(insufficient.eligible, false);
  assert.ok(insufficient.reasonCodes.includes('MINIMUM_SHADOW_RUNS_NOT_MET'));
  assert.ok(insufficient.reasonCodes.includes('MINIMUM_SUCCESSFUL_RUNS_NOT_MET'));
  const falseRates = contracts.evaluateRunbookGraduation(template, rewriteEvidence(evidence, { successRatePermillion: 1_000_000, failureRatePermillion: 0 }), null, null, 1_784_001_600_000);
  assert.ok(falseRates.reasonCodes.includes('CLAIMED_RATES_DO_NOT_MATCH_COUNTS'));
  const zeroMinimumTemplate = {
    ...template,
    graduationTarget: {
      ...template.graduationTarget,
      minimumLabeledCases: 0,
      minimumShadowRuns: 0,
      minimumSuccessfulRuns: 0,
    },
  };
  assert.equal(contracts.isClosedAiOpsContract('RunbookManifestTemplate', zeroMinimumTemplate), false);
  const zeroEvidence = rewriteEvidence(evidence, {
    shadowRuns: 0,
    labeledCases: 0,
    successfulRuns: 0,
    failedRuns: 0,
    recurrenceCount: 0,
    recurrenceRatePermillion: 0,
  });
  const zeroDecision = contracts.evaluateRunbookGraduation(template, zeroEvidence, null, null, 1_784_001_600_000, exactEvidenceVerifier(zeroEvidence));
  assert.equal(zeroDecision.candidateValidatedForPortRecheck, false);
  assert.ok(zeroDecision.reasonCodes.includes('ZERO_SHADOW_RUNS_INVALID'));
  const recurrenceFloorEvidence = rewriteEvidence(evidence, {
    shadowRuns: 199_999,
    successfulRuns: 199_999,
    failedRuns: 0,
    successRatePermillion: 1_000_000,
    failureRatePermillion: 0,
    recurrenceCount: 1_000,
    recurrenceRatePermillion: 5_000,
  });
  const recurrenceFloorTemplate = {
    ...template,
    graduationTarget: {
      ...template.graduationTarget,
      maximumRecurrenceCount: 1_000,
      maximumRecurrenceRatePermillion: 5_000,
    },
  };
  const recurrenceFloorDecision = contracts.evaluateRunbookGraduation(recurrenceFloorTemplate, recurrenceFloorEvidence, null, null, 1_784_001_600_000, exactEvidenceVerifier(recurrenceFloorEvidence));
  assert.equal(recurrenceFloorDecision.candidateValidatedForPortRecheck, false);
  assert.ok(recurrenceFloorDecision.reasonCodes.includes('CLAIMED_RECURRENCE_RATE_DOES_NOT_MATCH_COUNTS'));
  const invalidTime = contracts.evaluateRunbookGraduation(template, evidence, null, null, Number.NaN);
  assert.ok(invalidTime.reasonCodes.includes('EVALUATION_TIME_INVALID'));
});

test('an injected owner verifier can only establish shadow eligibility, never authority', () => {
  const template = contracts.AI_OPS_RUNBOOK_TEMPLATES[0];
  const evidence = passingEvidence(template);
  const signedPayloadDigest = contracts.sha256Canonical({ template, evidence });
  const signature = {
    schema: 'AI_OPS_OWNER_SIGNATURE_V1',
    signatureId: 'synthetic-signature-id',
    signedPayloadDigest,
    signerRole: 'AI_OPS_OWNER',
    algorithm: 'ED25519',
    keyReference: 'owner-key-ref://synthetic-test-key',
    signatureBytesBase64Url: 'U1lOVEhFVElDX1VOVkVSSUZJRUQ',
    policyRevision: 1,
    expiresAtMs: 1_784_001_660_000,
  };
  const verifier = {
    verify(received, payloadBytes) {
      assert.equal(received.signatureId, signature.signatureId);
      const { signatureBytesBase64Url: _signatureBytesBase64Url, ...signatureBinding } = signature;
      assert.equal(new TextDecoder().decode(payloadBytes), contracts.canonicalPolicyJson({ signedPayload: { template, evidence }, signatureBinding }));
      return true;
    },
  };
  const decision = contracts.evaluateRunbookGraduation(template, evidence, signature, verifier, 1_784_001_600_000, exactEvidenceVerifier(evidence));
  assert.equal(decision.eligible, false);
  assert.equal(decision.meetsNumericalAndSignatureRequirements, true);
  assert.equal(decision.ownerSignatureVerified, true);
  assert.equal(decision.evidenceVerified, true);
  assert.equal(decision.candidateValidatedForPortRecheck, true);
  assert.equal(decision.authorityGranted, false);
  assert.deepEqual(decision.reasonCodes, ['SHADOW_SPECULATIVE_CANNOT_GRANT_AUTHORITY']);
});

test('runbook evaluation rejects impossible metrics, forged templates and malformed or truthy signatures', () => {
  const template = contracts.AI_OPS_RUNBOOK_TEMPLATES[0];
  const evidence = passingEvidence(template);
  const signedPayloadDigest = contracts.sha256Canonical({ template, evidence });
  const validSignature = {
    schema: 'AI_OPS_OWNER_SIGNATURE_V1',
    signatureId: 'synthetic-signature-id',
    signedPayloadDigest,
    signerRole: 'AI_OPS_OWNER',
    algorithm: 'ED25519',
    keyReference: 'owner-key-ref://synthetic-test-key',
    signatureBytesBase64Url: 'U1lOVEhFVElDX1VOVkVSSUZJRUQ',
    policyRevision: 1,
    expiresAtMs: 1_784_001_660_000,
  };
  let verifierCalls = 0;
  const trueVerifier = { verify: () => { verifierCalls += 1; return true; } };
  const impossible = contracts.evaluateRunbookGraduation(template, { ...evidence, replayPassRatePermillion: 1_000_001 }, validSignature, trueVerifier, 1_784_001_600_000);
  assert.equal(impossible.meetsNumericalAndSignatureRequirements, false);
  assert.ok(impossible.reasonCodes.includes('GRADUATION_EVIDENCE_SCHEMA_INVALID'));
  assert.equal(verifierCalls, 0);
  const forgedTemplate = { ...template, triggerIds: [], maximumAttempts: 0, graduationTarget: { ...template.graduationTarget, minimumShadowRuns: Number.NaN } };
  const forged = contracts.evaluateRunbookGraduation(forgedTemplate, evidence, validSignature, trueVerifier, 1_784_001_600_000);
  assert.ok(forged.reasonCodes.includes('GRADUATION_INPUT_SNAPSHOT_INVALID'));
  assert.equal(forged.meetsNumericalAndSignatureRequirements, false);
  for (const divergentTemplate of [
    { ...template, runbookId: 'AI_OPS_RUNBOOK_WRONG_ACTION' },
    { ...template, typedParameterSchema: { ...template.typedParameterSchema, required: ['missingProperty'] } },
    { ...template, graduationTarget: { ...template.graduationTarget, maximumFailureRatePermillion: 0 } },
  ]) {
    assert.equal(contracts.isClosedAiOpsContract('RunbookManifestTemplate', divergentTemplate), false);
    const divergence = contracts.evaluateRunbookGraduation(divergentTemplate, evidence, validSignature, trueVerifier, 1_784_001_600_000);
    assert.ok(divergence.reasonCodes.includes('RUNBOOK_TEMPLATE_SCHEMA_INVALID'));
    assert.equal(divergence.meetsNumericalAndSignatureRequirements, false);
  }
  const malformedSignature = { ...validSignature, schema: 'EVIL', algorithm: 'HS256', signatureId: '', signatureBytesBase64Url: '', policyRevision: Number.NaN, expiresAtMs: Number.NaN };
  const malformed = contracts.evaluateRunbookGraduation(template, evidence, malformedSignature, trueVerifier, 1_784_001_600_000);
  assert.ok(malformed.reasonCodes.includes('GRADUATION_INPUT_SNAPSHOT_INVALID'));
  assert.equal(malformed.ownerSignatureVerified, false);
  const nonCanonicalBase64 = contracts.evaluateRunbookGraduation(template, evidence, { ...validSignature, signatureBytesBase64Url: 'A'.repeat(17) }, trueVerifier, 1_784_001_600_000, exactEvidenceVerifier(evidence));
  assert.ok(nonCanonicalBase64.reasonCodes.includes('OWNER_SIGNATURE_BINDING_INVALID'));
  for (const hostileEvidence of [
    { ...evidence, p99LatencyMs: -0 },
    { ...evidence, shadowRuns: -0 },
  ]) {
    let hostileDecision;
    assert.doesNotThrow(() => {
      hostileDecision = contracts.evaluateRunbookGraduation(template, hostileEvidence, validSignature, trueVerifier, 1_784_001_600_000, exactEvidenceVerifier(hostileEvidence));
    });
    assert.ok(hostileDecision.reasonCodes.includes('GRADUATION_INPUT_SNAPSHOT_INVALID'));
  }
  for (const hostileTemplate of [
    { ...template, triggerIds: Array(1) },
    { ...template, graduationTarget: { ...template.graduationTarget, maximumP99LatencyMs: -0 } },
    { ...template, typedParameterSchema: { ...template.typedParameterSchema, properties: { ...template.typedParameterSchema.properties, ['\ud800']: { type: 'string', minLength: 1, maxLength: 1 } } } },
  ]) {
    let hostileDecision;
    assert.doesNotThrow(() => {
      hostileDecision = contracts.evaluateRunbookGraduation(hostileTemplate, evidence, validSignature, trueVerifier, 1_784_001_600_000, exactEvidenceVerifier(evidence));
    });
    assert.ok(hostileDecision.reasonCodes.includes('GRADUATION_INPUT_SNAPSHOT_INVALID'));
  }
  const prefixOnlyKey = contracts.evaluateRunbookGraduation(template, evidence, { ...validSignature, keyReference: 'owner-key-ref://' }, trueVerifier, 1_784_001_600_000, exactEvidenceVerifier(evidence));
  assert.ok(prefixOnlyKey.reasonCodes.includes('OWNER_SIGNATURE_BINDING_INVALID'));
  assert.equal(prefixOnlyKey.candidateValidatedForPortRecheck, false);
  const prefixOnlyEvidenceReference = contracts.evaluateRunbookGraduation(template, evidence, validSignature, trueVerifier, 1_784_001_600_000, {
    verifyEvidence: () => ({ ...exactEvidenceVerifier(evidence).verifyEvidence(), evidenceReceiptReference: 'ledger-receipt://' }),
  });
  assert.ok(prefixOnlyEvidenceReference.reasonCodes.includes('GRADUATION_EVIDENCE_VERIFICATION_FAILED'));
  assert.equal(prefixOnlyEvidenceReference.candidateValidatedForPortRecheck, false);
  const truthy = contracts.evaluateRunbookGraduation(template, evidence, validSignature, { verify: () => 'yes' }, 1_784_001_600_000);
  assert.ok(truthy.reasonCodes.includes('OWNER_SIGNATURE_VERIFICATION_FAILED'));
  assert.equal(truthy.meetsNumericalAndSignatureRequirements, false);
  const templateExpiryBoundary = contracts.evaluateRunbookGraduation(template, evidence, validSignature, trueVerifier, template.expiresAtMs);
  assert.ok(templateExpiryBoundary.reasonCodes.includes('RUNBOOK_TEMPLATE_EXPIRED'));
  const signatureExpiryBoundary = contracts.evaluateRunbookGraduation(template, evidence, { ...validSignature, expiresAtMs: 1_784_001_600_000 }, trueVerifier, 1_784_001_600_000);
  assert.ok(signatureExpiryBoundary.reasonCodes.includes('OWNER_SIGNATURE_BINDING_INVALID'));
  const signedVerificationBytes = (() => {
    const { signatureBytesBase64Url: _signatureBytesBase64Url, ...signatureBinding } = validSignature;
    return contracts.canonicalPolicyJson({ signedPayload: { template, evidence }, signatureBinding });
  })();
  const expiryTamper = contracts.evaluateRunbookGraduation(template, evidence, { ...validSignature, expiresAtMs: validSignature.expiresAtMs + 60_000 }, {
    verify: (_signature, payloadBytes) => new TextDecoder().decode(payloadBytes) === signedVerificationBytes,
  }, 1_784_001_600_000, exactEvidenceVerifier(evidence));
  assert.equal(expiryTamper.ownerSignatureVerified, false);
  assert.equal(expiryTamper.candidateValidatedForPortRecheck, false);
  const wrongPolicyRevision = contracts.evaluateRunbookGraduation(template, evidence, { ...validSignature, policyRevision: 999 }, trueVerifier, 1_784_001_600_000, exactEvidenceVerifier(evidence));
  assert.ok(wrongPolicyRevision.reasonCodes.includes('OWNER_SIGNATURE_BINDING_INVALID'));
  const evidenceProofMismatch = contracts.evaluateRunbookGraduation(template, evidence, validSignature, trueVerifier, 1_784_001_600_000, {
    verifyEvidence: () => ({ ...exactEvidenceVerifier(evidence).verifyEvidence(), evidenceDigest: '0'.repeat(64) }),
  });
  assert.equal(evidenceProofMismatch.evidenceVerified, false);
  assert.ok(evidenceProofMismatch.reasonCodes.includes('GRADUATION_EVIDENCE_VERIFICATION_FAILED'));
  const replayedDigest = contracts.evaluateRunbookGraduation(template, { ...evidence, falseRepairRatePermillion: 1 }, validSignature, trueVerifier, 1_784_001_600_000, exactEvidenceVerifier(evidence));
  assert.ok(replayedDigest.reasonCodes.includes('GRADUATION_EVIDENCE_SCHEMA_INVALID'));
});

test('policy fixture is revisioned, exact-byte verified and permanently non-activating in shadow', () => {
  const fixture = contracts.AI_OPS_SYNTHETIC_POLICY_BUNDLE_FIXTURE;
  assert.equal(fixture.fixtureState, 'SYNTHETIC_UNVERIFIED');
  const verifier = {
    verify(signature, payloadType, payloadBytes) {
      assert.equal(payloadType, 'application/vnd.aiops.policy-bundle.v1+jcs');
      assert.equal(signature.signedPayloadDigest, contracts.sha256Text(new TextDecoder().decode(payloadBytes)));
      assert.equal(new TextDecoder().decode(payloadBytes), contracts.canonicalPolicyJson(fixture.candidate.payload));
      return true;
    },
  };
  const contentVerifier = exactContentVerifier(fixture);
  const decision = contracts.evaluatePolicyBundle(fixture.candidate, null, verifier, contentVerifier, 1_784_001_600_000, exactPolicySemanticVerifier());
  assert.equal(decision.stageAllowed, false);
  assert.equal(decision.candidateValidatedForPortRecheck, true);
  assert.equal(decision.activateAllowed, false);
  assert.equal(decision.authorityGranted, false);
  assert.equal(decision.signatureVerified, true);
  assert.deepEqual(decision.reasonCodes, ['SHADOW_SPECULATIVE_CANNOT_ACTIVATE_POLICY']);
});

test('policy signature, digest, rollback, revision collision and expiry failures retain LKG', () => {
  const fixture = contracts.AI_OPS_SYNTHETIC_POLICY_BUNDLE_FIXTURE;
  const trueVerifier = { verify: () => true };
  const contentVerifier = exactContentVerifier(fixture);
  const unsigned = contracts.evaluatePolicyBundle({ ...fixture.candidate, signature: null }, null, null, contentVerifier, 1_784_001_600_000);
  assert.equal(unsigned.stageAllowed, false);
  assert.ok(unsigned.reasonCodes.includes('POLICY_OWNER_SIGNATURE_REQUIRED'));
  const digestMismatch = contracts.evaluatePolicyBundle({ ...fixture.candidate, declaredBundleDigest: '0'.repeat(64) }, null, trueVerifier, contentVerifier, 1_784_001_600_000);
  assert.ok(digestMismatch.reasonCodes.includes('DECLARED_BUNDLE_DIGEST_MISMATCH'));
  const weak = structuredClone(fixture.candidate);
  weak.signature.algorithm = 'HS256';
  const weakDecision = contracts.evaluatePolicyBundle(weak, null, trueVerifier, contentVerifier, 1_784_001_600_000);
  assert.ok(weakDecision.reasonCodes.includes('POLICY_BUNDLE_SCHEMA_INVALID'));
  const lkg = fixture.candidate;
  const candidatePayload = { ...lkg.payload, policyEpoch: 1, revision: lkg.payload.revision, parentBundleDigest: contracts.sha256Canonical(lkg.payload) };
  const candidateDigest = contracts.sha256Canonical(candidatePayload);
  const rollback = contracts.evaluatePolicyBundle({ payload: candidatePayload, signature: { ...fixture.candidate.signature, signedPayloadDigest: candidateDigest }, declaredBundleDigest: candidateDigest }, lkg, trueVerifier, contentVerifier, 1_784_001_600_000, exactPolicySemanticVerifier(), exactLastKnownGoodVerifier());
  assert.equal(rollback.retainedBundleDigest, contracts.sha256Canonical(lkg.payload));
  assert.equal(rollback.candidateValidatedForPortRecheck, false);
  assert.ok(rollback.reasonCodes.includes('POLICY_ROLLBACK_OR_NON_MONOTONIC_EPOCH'));
  const expired = contracts.evaluatePolicyBundle(fixture.candidate, null, trueVerifier, contentVerifier, fixture.candidate.payload.expiresAtMs + 1);
  assert.ok(expired.reasonCodes.includes('POLICY_EXPIRED'));
  const expiryBoundary = contracts.evaluatePolicyBundle(fixture.candidate, null, trueVerifier, contentVerifier, fixture.candidate.payload.expiresAtMs);
  assert.ok(expiryBoundary.reasonCodes.includes('POLICY_EXPIRED'));
  const noContentProof = contracts.evaluatePolicyBundle(fixture.candidate, null, trueVerifier, null, 1_784_001_600_000);
  assert.ok(noContentProof.reasonCodes.includes('POLICY_FILE_CONTENT_VERIFICATION_REQUIRED'));
  const expandedPayload = { ...fixture.candidate.payload, allowedActionClasses: ['A', 'B', 'C', 'D'] };
  const expandedDigest = contracts.sha256Canonical(expandedPayload);
  const expanded = contracts.evaluatePolicyBundle({ payload: expandedPayload, signature: { ...fixture.candidate.signature, signedPayloadDigest: expandedDigest }, declaredBundleDigest: expandedDigest }, null, trueVerifier, contentVerifier, 1_784_001_600_000);
  assert.ok(expanded.reasonCodes.includes('POLICY_BUNDLE_SCHEMA_INVALID'));
});

test('policy byte inventory, semantic envelope, LKG and verifier boundaries fail closed', () => {
  const fixture = contracts.AI_OPS_SYNTHETIC_POLICY_BUNDLE_FIXTURE;
  const trueVerifier = { verify: () => true };
  for (const bytes of [
    fixtureByteMap(fixture, { 'deny.json': '{"default":"allow"}' }),
    { 'deny.json': textEncoder.encode(fixture.fileContentsUtf8['deny.json']) },
    { ...fixtureByteMap(fixture), 'extra.rego': textEncoder.encode('package extra') },
  ]) {
    const decision = contracts.evaluatePolicyBundle(fixture.candidate, null, trueVerifier, exactContentVerifier(fixture, bytes), 1_784_001_600_000);
    assert.equal(decision.candidateValidatedForPortRecheck, false);
    assert.ok(decision.reasonCodes.includes('POLICY_FILE_CONTENT_VERIFICATION_FAILED'));
  }
  const malformedProof = contracts.evaluatePolicyBundle(fixture.candidate, null, trueVerifier, { verifyExactInventory: () => ({ verified: true }) }, 1_784_001_600_000);
  assert.ok(malformedProof.reasonCodes.includes('POLICY_FILE_CONTENT_VERIFICATION_FAILED'));
  const unsafePathBytes = { ...fixtureByteMap(fixture), ['\ud800']: textEncoder.encode('unsafe-key') };
  let unsafePathVerification;
  assert.doesNotThrow(() => {
    unsafePathVerification = contracts.verifyPolicyFileByteMap(fixture.candidate.payload.fileInventory, unsafePathBytes);
  });
  assert.equal(unsafePathVerification.verified, false);
  assert.deepEqual(unsafePathVerification.mismatchPaths, ['AI_OPS_UNSAFE_ACTUAL_POLICY_PATH_REDACTED']);
  const unsafeInventory = [{ ...fixture.candidate.payload.fileInventory[0], path: '\ud800' }];
  let unsafeInventoryVerification;
  assert.doesNotThrow(() => {
    unsafeInventoryVerification = contracts.verifyPolicyFileByteMap(unsafeInventory, { ['\ud800']: textEncoder.encode('unsafe-key') });
  });
  assert.equal(unsafeInventoryVerification.verified, false);
  assert.deepEqual(unsafeInventoryVerification.mismatchPaths, ['AI_OPS_INVALID_POLICY_FILE_INVENTORY_REDACTED']);
  const corruptLkg = { ...fixture.candidate, payload: { ...fixture.candidate.payload, policyEpoch: Number.NaN } };
  const corruptLkgDecision = contracts.evaluatePolicyBundle(fixture.candidate, corruptLkg, trueVerifier, exactContentVerifier(fixture), 1_784_001_600_000, exactPolicySemanticVerifier(), exactLastKnownGoodVerifier());
  assert.equal(corruptLkgDecision.retainedBundleDigest, null);
  assert.ok(corruptLkgDecision.reasonCodes.includes('LAST_KNOWN_GOOD_SCHEMA_INVALID'));
  const semanticCorruptLkg = {
    ...fixture.candidate,
    payload: {
      ...fixture.candidate.payload,
      hardDenialIds: Array.from({ length: fixture.candidate.payload.hardDenialIds.length }, () => fixture.candidate.payload.hardDenialIds[0]),
    },
  };
  const semanticCorruptLkgDecision = contracts.evaluatePolicyBundle(fixture.candidate, semanticCorruptLkg, trueVerifier, exactContentVerifier(fixture), 1_784_001_600_000, exactPolicySemanticVerifier(), exactLastKnownGoodVerifier());
  assert.equal(semanticCorruptLkgDecision.retainedBundleDigest, null);
  assert.ok(semanticCorruptLkgDecision.reasonCodes.includes('LAST_KNOWN_GOOD_SCHEMA_INVALID'));
  const unverifiedLkg = contracts.evaluatePolicyBundle(fixture.candidate, fixture.candidate, trueVerifier, exactContentVerifier(fixture), 1_784_001_600_000, exactPolicySemanticVerifier());
  assert.equal(unverifiedLkg.retainedBundleDigest, null);
  assert.ok(unverifiedLkg.reasonCodes.includes('LAST_KNOWN_GOOD_VERIFICATION_REQUIRED'));
  const unsignedLkg = contracts.evaluatePolicyBundle(fixture.candidate, { ...fixture.candidate, signature: null }, trueVerifier, exactContentVerifier(fixture), 1_784_001_600_000, exactPolicySemanticVerifier(), exactLastKnownGoodVerifier());
  assert.ok(unsignedLkg.reasonCodes.includes('LAST_KNOWN_GOOD_SCHEMA_INVALID'));
  const expiredLkg = contracts.evaluatePolicyBundle(fixture.candidate, fixture.candidate, trueVerifier, exactContentVerifier(fixture), fixture.candidate.payload.expiresAtMs, exactPolicySemanticVerifier(), exactLastKnownGoodVerifier());
  assert.ok(expiredLkg.reasonCodes.includes('LAST_KNOWN_GOOD_EXPIRED'));
  const truthyVerifier = contracts.evaluatePolicyBundle(fixture.candidate, null, { verify: () => 'yes' }, exactContentVerifier(fixture), 1_784_001_600_000);
  assert.equal(truthyVerifier.signatureVerified, false);
  assert.ok(truthyVerifier.reasonCodes.includes('POLICY_SIGNATURE_VERIFICATION_FAILED'));
  for (const mutation of [
    (candidate) => { candidate.signature.keyReference = 'owner-key-ref://'; },
    (candidate) => { candidate.signature.signatureBytesBase64Url = 'A'.repeat(17); },
    (candidate) => { candidate.payload.effectiveAtMs = -0; },
    (candidate) => { candidate.payload.fileInventory = Array(2); },
    (candidate) => { candidate.payload.hardDenialIds = Array(candidate.payload.hardDenialIds.length); },
  ]) {
    const malformedCandidate = structuredClone(fixture.candidate);
    mutation(malformedCandidate);
    let malformedDecision;
    assert.doesNotThrow(() => {
      malformedDecision = contracts.evaluatePolicyBundle(malformedCandidate, null, trueVerifier, exactContentVerifier(fixture), 1_784_001_600_000);
    });
    assert.ok(malformedDecision.reasonCodes.includes('POLICY_BUNDLE_SCHEMA_INVALID'));
    assert.equal(malformedDecision.candidateValidatedForPortRecheck, false);
  }
  const evil = structuredClone(fixture.candidate);
  evil.payload.schema = 'EVIL';
  evil.payload.bundleId = 7;
  evil.signature.schema = 'EVIL';
  evil.signature.signatureBytesBase64Url = '';
  const evilDecision = contracts.evaluatePolicyBundle(evil, null, trueVerifier, exactContentVerifier(fixture), 1_784_001_600_000);
  assert.deepEqual(evilDecision.reasonCodes, ['POLICY_BUNDLE_SCHEMA_INVALID']);
  const invalidUnicode = structuredClone(fixture.candidate);
  invalidUnicode.payload.fileInventory[0].path = '\ud800';
  let invalidUnicodeDecision;
  assert.doesNotThrow(() => {
    invalidUnicodeDecision = contracts.evaluatePolicyBundle(invalidUnicode, null, trueVerifier, exactContentVerifier(fixture), 1_784_001_600_000);
  });
  assert.deepEqual(invalidUnicodeDecision.reasonCodes, ['POLICY_BUNDLE_SCHEMA_INVALID']);
  const nulPath = structuredClone(fixture.candidate);
  nulPath.payload.fileInventory[0].path = 'deny\u0000.json';
  const nulPathDecision = contracts.evaluatePolicyBundle(nulPath, null, trueVerifier, exactContentVerifier(fixture), 1_784_001_600_000);
  assert.deepEqual(nulPathDecision.reasonCodes, ['POLICY_BUNDLE_SCHEMA_INVALID']);
  const missingSemanticProof = contracts.evaluatePolicyBundle(fixture.candidate, null, trueVerifier, exactContentVerifier(fixture), 1_784_001_600_000);
  assert.ok(missingSemanticProof.reasonCodes.includes('POLICY_SEMANTIC_TEST_VERIFICATION_REQUIRED'));
  const unpinnedSemanticSuite = contracts.evaluatePolicyBundle(fixture.candidate, null, trueVerifier, exactContentVerifier(fixture), 1_784_001_600_000, {
    verifyPolicySemantics: (payload) => ({ ...exactPolicySemanticVerifier().verifyPolicySemantics(payload), testSuiteDigest: '0'.repeat(64) }),
  });
  assert.ok(unpinnedSemanticSuite.reasonCodes.includes('POLICY_SEMANTIC_TEST_VERIFICATION_FAILED'));
  const allowContents = { 'deny.json': '{"default":"allow"}', 'policy.rego': 'package aiops\ndefault allow := true' };
  const allowPayload = {
    ...fixture.candidate.payload,
    fileInventory: [
      { ...fixture.candidate.payload.fileInventory[0], digest: contracts.sha256Text(allowContents['deny.json']) },
      { ...fixture.candidate.payload.fileInventory[1], digest: contracts.sha256Text(allowContents['policy.rego']) },
    ],
  };
  const allowDigest = contracts.sha256Canonical(allowPayload);
  const allowCandidate = { payload: allowPayload, signature: { ...fixture.candidate.signature, signedPayloadDigest: allowDigest }, declaredBundleDigest: allowDigest };
  const defaultAllow = contracts.evaluatePolicyBundle(allowCandidate, null, trueVerifier, exactContentVerifier({ fileContentsUtf8: allowContents }, fixtureByteMap({ fileContentsUtf8: allowContents })), 1_784_001_600_000, {
    verifyPolicySemantics: () => ({ ...exactPolicySemanticVerifier().verifyPolicySemantics(allowPayload), verified: false, defaultDenyVerified: false }),
  });
  assert.equal(defaultAllow.candidateValidatedForPortRecheck, false);
  assert.ok(defaultAllow.reasonCodes.includes('POLICY_SEMANTIC_TEST_VERIFICATION_FAILED'));
});

test('policy chains reject future fallback bundles, cross-family revisions and hostile proof objects', () => {
  const fixture = contracts.AI_OPS_SYNTHETIC_POLICY_BUNDLE_FIXTURE;
  const nowMs = 1_784_001_600_000;
  const trueVerifier = { verify: () => true };
  const contentVerifier = exactContentVerifier(fixture);
  const semanticVerifier = exactPolicySemanticVerifier();
  const futureLastKnownGood = signedPolicyBundle({
    ...fixture.candidate.payload,
    effectiveAtMs: nowMs + 60_000,
    expiresAtMs: nowMs + 120_000,
  });
  const futureDecision = contracts.evaluatePolicyBundle(
    fixture.candidate,
    futureLastKnownGood,
    trueVerifier,
    contentVerifier,
    nowMs,
    semanticVerifier,
    exactLastKnownGoodVerifier(),
  );
  assert.equal(futureDecision.retainedBundleDigest, null);
  assert.ok(futureDecision.reasonCodes.includes('LAST_KNOWN_GOOD_NOT_YET_EFFECTIVE'));

  const lastKnownGood = fixture.candidate;
  const crossFamily = signedPolicyBundle({
    ...lastKnownGood.payload,
    bundleId: 'aiops-shadow-policy-other-family',
    revision: 'shadow-policy-revision-2',
    policyEpoch: 2,
    parentBundleDigest: contracts.sha256Canonical(lastKnownGood.payload),
  });
  const crossFamilyDecision = contracts.evaluatePolicyBundle(
    crossFamily,
    lastKnownGood,
    trueVerifier,
    contentVerifier,
    nowMs,
    semanticVerifier,
    exactLastKnownGoodVerifier(),
  );
  assert.equal(crossFamilyDecision.candidateValidatedForPortRecheck, false);
  assert.equal(crossFamilyDecision.retainedBundleDigest, contracts.sha256Canonical(lastKnownGood.payload));
  assert.ok(crossFamilyDecision.reasonCodes.includes('POLICY_BUNDLE_ID_MISMATCH'));

  const hostileProof = new Proxy({}, {
    getPrototypeOf() {
      throw new Error('hostile-proof-proxy');
    },
  });
  let hostileContentDecision;
  assert.doesNotThrow(() => {
    hostileContentDecision = contracts.evaluatePolicyBundle(
      fixture.candidate,
      null,
      trueVerifier,
      { verifyExactInventory: () => hostileProof },
      nowMs,
      semanticVerifier,
    );
  });
  assert.ok(hostileContentDecision.reasonCodes.includes('POLICY_FILE_CONTENT_VERIFICATION_FAILED'));
  let hostileSemanticDecision;
  assert.doesNotThrow(() => {
    hostileSemanticDecision = contracts.evaluatePolicyBundle(
      fixture.candidate,
      null,
      trueVerifier,
      contentVerifier,
      nowMs,
      { verifyPolicySemantics: () => hostileProof },
    );
  });
  assert.ok(hostileSemanticDecision.reasonCodes.includes('POLICY_SEMANTIC_TEST_VERIFICATION_FAILED'));
  let hostileLkgDecision;
  assert.doesNotThrow(() => {
    hostileLkgDecision = contracts.evaluatePolicyBundle(
      crossFamily,
      lastKnownGood,
      trueVerifier,
      contentVerifier,
      nowMs,
      semanticVerifier,
      { verifyLastKnownGood: () => hostileProof },
    );
  });
  assert.equal(hostileLkgDecision.retainedBundleDigest, null);
  assert.ok(hostileLkgDecision.reasonCodes.includes('LAST_KNOWN_GOOD_VERIFICATION_FAILED'));
});

test('policy byte-map verification rejects descriptor tricks without invoking accessors', () => {
  const fixture = contracts.AI_OPS_SYNTHETIC_POLICY_BUNDLE_FIXTURE;
  const invalidMediaType = contracts.verifyPolicyFileByteMap(
    [{ ...fixture.candidate.payload.fileInventory[0], mediaType: 'text/html' }, fixture.candidate.payload.fileInventory[1]],
    fixtureByteMap(fixture),
  );
  assert.equal(invalidMediaType.verified, false);
  assert.deepEqual(invalidMediaType.mismatchPaths, ['AI_OPS_INVALID_POLICY_FILE_INVENTORY_REDACTED']);
  let getterCalls = 0;
  const hostileFile = Object.defineProperty({ ...fixture.candidate.payload.fileInventory[0] }, 'path', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'deny.json';
    },
  });
  const hostileInventory = contracts.verifyPolicyFileByteMap(
    [hostileFile, fixture.candidate.payload.fileInventory[1]],
    fixtureByteMap(fixture),
  );
  assert.equal(hostileInventory.verified, false);
  assert.deepEqual(hostileInventory.mismatchPaths, ['AI_OPS_INVALID_POLICY_FILE_INVENTORY_REDACTED']);
  assert.equal(getterCalls, 0);
  const hostileBytes = Object.defineProperty({}, 'deny.json', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return textEncoder.encode(fixture.fileContentsUtf8['deny.json']);
    },
  });
  const hostileByteMap = contracts.verifyPolicyFileByteMap(fixture.candidate.payload.fileInventory, hostileBytes);
  assert.equal(hostileByteMap.verified, false);
  assert.deepEqual(hostileByteMap.mismatchPaths, ['AI_OPS_INVALID_POLICY_FILE_INVENTORY_REDACTED']);
  assert.equal(getterCalls, 0);
});

test('decision records are hash chained and durability requires Ledger append plus exact readback', () => {
  const first = contracts.AI_OPS_DECISION_LOG_DESIGN_FIXTURE;
  const { schema: _schema, recordDigest: _recordDigest, assuranceVerified: _assuranceVerified, state: _state, authorityCreated: _authorityCreated, ...firstInput } = first;
  assert.throws(() => contracts.createDecisionLogRecord({ ...firstInput, reasonCodes: [] }), /bounded semantics/);
  const second = contracts.createDecisionLogRecord({
    ...firstInput,
    sequence: 2,
    decisionId: 'aiops-shadow-decision-fixture-2',
    previousRecordDigest: first.recordDigest,
  });
  assert.equal(second.previousRecordDigest, first.recordDigest);
  const noPort = contracts.appendDecisionThroughExistingPersistence(second, null);
  assert.equal(noPort.durable, false);
  assert.equal(noPort.candidateDurabilityValidatedForPortRecheck, false);
  assert.equal(noPort.secondStoreCreated, false);
  const port = decisionPort(first);
  const durable = contracts.appendDecisionThroughExistingPersistence(second, port, null, exactChainVerifier(first));
  assert.equal(durable.durable, false);
  assert.equal(durable.candidateDurabilityValidatedForPortRecheck, true);
  assert.equal(durable.assuranceCandidateValidatedForPortRecheck, true);
  assert.deepEqual(durable.reasonCodes, ['SHADOW_SPECULATIVE_CANNOT_CLAIM_DURABILITY']);
  assert.equal(durable.state, 'SHADOW_SPECULATIVE');
  assert.equal(durable.persistenceOwner, 'LEDGER');
  assert.equal(durable.secondStoreCreated, false);
  const corruptPort = decisionPort(first, (receipt) => receipt, (record, sequence) => sequence === 2 ? { ...record, resultDigest: '0'.repeat(64) } : record);
  const corrupt = contracts.appendDecisionThroughExistingPersistence(second, corruptPort, null, exactChainVerifier(first));
  assert.equal(corrupt.durable, false);
  assert.ok(corrupt.reasonCodes.includes('LEDGER_READBACK_DIGEST_MISMATCH'));
  const nullReceipt = contracts.appendDecisionThroughExistingPersistence(second, decisionPort(first, (receipt) => ({ ...receipt, appendReceiptReference: null })), null, exactChainVerifier(first));
  assert.equal(nullReceipt.durable, false);
  assert.ok(nullReceipt.reasonCodes.includes('LEDGER_APPEND_RECEIPT_REFERENCE_INVALID'));
});

test('decision inputs, receipts, predecessor continuity and anchors remain bounded and speculative', () => {
  const first = contracts.AI_OPS_DECISION_LOG_DESIGN_FIXTURE;
  const { schema: _schema, recordDigest: _recordDigest, assuranceVerified: _assuranceVerified, state: _state, authorityCreated: _authorityCreated, ...firstInput } = first;
  assert.throws(() => contracts.createDecisionLogRecord({ ...firstInput, reasonCodes: Array.from({ length: 65 }, (_, index) => `REASON_${index}`) }), /bounded semantics/);
  assert.throws(() => contracts.createDecisionLogRecord({ ...firstInput, reasonCodes: ['token=sk-secret-material'] }), /bounded semantics/);
  assert.throws(() => contracts.createDecisionLogRecord({ ...firstInput, reasonCodes: ['AKIAABCDEFGHIJKLMNOP'] }), /bounded semantics/);
  assert.throws(() => contracts.createDecisionLogRecord({ ...firstInput, redactionIds: ['raw-secret-value'] }), /bounded semantics/);
  assert.throws(() => contracts.createDecisionLogRecord({ ...firstInput, redactionIds: ['AI_OPS_REDACTION_AKIAABCDEFGHIJKLMNOP'] }), /bounded semantics/);
  assert.throws(() => contracts.createDecisionLogRecord({ ...firstInput, actorRole: 'HUMAN_OWNER' }), /bounded semantics/);
  assert.throws(() => contracts.createDecisionLogRecord({ ...firstInput, timestampMs: -0 }), /bounded semantics/);
  assert.throws(() => contracts.createDecisionLogRecord({ ...firstInput, reasonCodes: Array(1) }), /bounded semantics/);
  for (const secretShape of ['sk-proj-1234567890abcdef', 'sk-ant-api03-1234567890abcdef', 'sk-1234567890abcdef', 'AIza1234567890abcdefghijkl', 'ASIAABCDEFGHIJKLMNOP', 'github_pat_1234567890abcdefghij']) {
    assert.throws(() => contracts.createDecisionLogRecord({ ...firstInput, decisionId: secretShape }), /bounded semantics/);
  }
  assert.throws(() => contracts.createDecisionLogRecord({ ...firstInput, actionClass: 'D', outcome: 'ALLOW_SHADOW_EVALUATION' }), /bounded semantics/);
  const second = contracts.createDecisionLogRecord({ ...firstInput, sequence: 2, decisionId: 'aiops-shadow-decision-fixture-2', previousRecordDigest: first.recordDigest });
  const wrongParent = contracts.createDecisionLogRecord({ ...firstInput, sequence: 2, decisionId: 'aiops-shadow-decision-wrong-parent', previousRecordDigest: '0'.repeat(64) });
  const wrongParentPort = decisionPort(first);
  const wrongParentDecision = contracts.appendDecisionThroughExistingPersistence(wrongParent, wrongParentPort, null, exactChainVerifier(first));
  assert.equal(wrongParentPort.appendCount, 0);
  assert.ok(wrongParentDecision.reasonCodes.includes('LEDGER_PREDECESSOR_CONTINUITY_INVALID'));
  const occupiedPort = decisionPort(first);
  occupiedPort.seed(second);
  occupiedPort.appendCount = 0;
  const occupied = contracts.appendDecisionThroughExistingPersistence(second, occupiedPort, null, exactChainVerifier(first));
  assert.equal(occupiedPort.appendCount, 0);
  assert.ok(occupied.reasonCodes.includes('LEDGER_SEQUENCE_ALREADY_OCCUPIED'));
  const missingPredecessorPort = {
    appendCount: 0,
    appendAtomically(record) {
      this.appendCount += 1;
      return { persistenceOwner: 'LEDGER', sequence: record.sequence, recordDigest: record.recordDigest, appendReceiptReference: 'ledger-receipt://synthetic/2', durable: true };
    },
    readback: () => null,
  };
  const missingPredecessor = contracts.appendDecisionThroughExistingPersistence(second, missingPredecessorPort);
  assert.equal(missingPredecessor.candidateDurabilityValidatedForPortRecheck, false);
  assert.equal(missingPredecessor.assuranceCandidateValidatedForPortRecheck, false);
  assert.ok(missingPredecessor.reasonCodes.includes('LEDGER_PREDECESSOR_READBACK_MISSING'));
  assert.equal(missingPredecessorPort.appendCount, 0);
  const competing = contracts.createDecisionLogRecord({ ...firstInput, sequence: 2, decisionId: 'aiops-shadow-competing-decision', previousRecordDigest: first.recordDigest });
  const racedPort = decisionPort(first, (receipt) => receipt, (record) => record, (records) => records.set(competing.sequence, competing));
  const raced = contracts.appendDecisionThroughExistingPersistence(second, racedPort, null, exactChainVerifier(first));
  assert.equal(raced.candidateDurabilityValidatedForPortRecheck, false);
  assert.equal(racedPort.appendCount, 0);
  assert.ok(raced.reasonCodes.includes('LEDGER_APPEND_OR_READBACK_FAILED'));
  const truthyReceiptPort = decisionPort(first, (receipt) => ({ ...receipt, durable: 'yes', attackerField: true }));
  const truthyReceipt = contracts.appendDecisionThroughExistingPersistence(second, truthyReceiptPort, null, exactChainVerifier(first));
  assert.equal(truthyReceipt.candidateDurabilityValidatedForPortRecheck, false);
  assert.ok(truthyReceipt.reasonCodes.includes('LEDGER_DURABLE_RECEIPT_MISSING'));
  assert.equal(truthyReceipt.appendReceiptReference, null);
  const secretReceipt = contracts.appendDecisionThroughExistingPersistence(second, decisionPort(first, (receipt) => ({ ...receipt, appendReceiptReference: 'sk-proj-1234567890abcdef' })), null, exactChainVerifier(first));
  assert.equal(secretReceipt.appendReceiptReference, null);
  assert.ok(secretReceipt.reasonCodes.includes('LEDGER_APPEND_RECEIPT_REFERENCE_INVALID'));
  const brokenPrefixPort = decisionPort(first);
  const brokenPrefix = contracts.appendDecisionThroughExistingPersistence(second, brokenPrefixPort, null, { verifyChainPrefix: () => ({ verified: true }) });
  assert.equal(brokenPrefix.assuranceCandidateValidatedForPortRecheck, false);
  assert.ok(brokenPrefix.reasonCodes.includes('DECISION_LOG_FULL_CHAIN_VERIFICATION_FAILED'));
  assert.equal(brokenPrefixPort.appendCount, 0);
  const arbitraryDigestProof = exactChainVerifier(first).verifyChainPrefix(second);
  const arbitraryDigest = contracts.appendDecisionThroughExistingPersistence(second, decisionPort(first), null, {
    verifyChainPrefix: () => ({ ...arbitraryDigestProof, maximumTimestampMs: -1, chainDigest: '0'.repeat(64) }),
  });
  assert.equal(arbitraryDigest.assuranceCandidateValidatedForPortRecheck, false);
  assert.ok(arbitraryDigest.reasonCodes.includes('DECISION_LOG_FULL_CHAIN_VERIFICATION_FAILED'));
  const clockRollback = contracts.createDecisionLogRecord({ ...firstInput, sequence: 2, decisionId: 'aiops-shadow-decision-clock-rollback', timestampMs: first.timestampMs - 1, previousRecordDigest: first.recordDigest });
  const clockRollbackPort = decisionPort(first);
  const rollbackDecision = contracts.appendDecisionThroughExistingPersistence(clockRollback, clockRollbackPort, null, exactChainVerifier(first));
  assert.equal(rollbackDecision.assuranceCandidateValidatedForPortRecheck, false);
  assert.ok(rollbackDecision.reasonCodes.includes('LEDGER_DECISION_CLOCK_ROLLBACK'));
  const anchored = contracts.createDecisionLogRecord({ ...firstInput, requestedAssurance: 'SIGNED_CHECKPOINT', checkpointReceiptReference: 'checkpoint-receipt://synthetic/1' });
  const noAnchorPort = decisionPort();
  const noAnchorVerifier = contracts.appendDecisionThroughExistingPersistence(anchored, noAnchorPort);
  assert.ok(noAnchorVerifier.reasonCodes.includes('DECISION_LOG_ANCHOR_VERIFIER_NOT_MOUNTED'));
  assert.ok(noAnchorVerifier.reasonCodes.includes('DECISION_LOG_ANCHOR_TIME_REQUIRED'));
  assert.equal(noAnchorPort.appendCount, 0);
  const anchorVerificationTimeMs = anchored.timestampMs + 1;
  const truthyAnchor = contracts.appendDecisionThroughExistingPersistence(anchored, decisionPort(), { verifyAnchor: () => 'yes' }, null, anchorVerificationTimeMs);
  assert.equal(truthyAnchor.assuranceCandidateValidatedForPortRecheck, false);
  assert.ok(truthyAnchor.reasonCodes.includes('DECISION_LOG_ANCHOR_VERIFICATION_FAILED'));
  const verifiedAnchor = contracts.appendDecisionThroughExistingPersistence(anchored, decisionPort(), exactAnchorVerifier(), null, anchorVerificationTimeMs);
  assert.equal(verifiedAnchor.assuranceCandidateValidatedForPortRecheck, true);
  assert.equal(verifiedAnchor.durable, false);
  assert.ok(verifiedAnchor.reasonCodes.includes('SHADOW_SPECULATIVE_CANNOT_CLAIM_DURABILITY'));
  assert.equal(anchored.assuranceVerified, false);
  const unboundAnchor = contracts.appendDecisionThroughExistingPersistence(anchored, decisionPort(), {
    verifyAnchor: (record, verificationTime) => ({ ...exactAnchorVerifier().verifyAnchor(record, verificationTime), recordDigest: '0'.repeat(64) }),
  }, null, anchorVerificationTimeMs);
  assert.equal(unboundAnchor.assuranceCandidateValidatedForPortRecheck, false);
  assert.ok(unboundAnchor.reasonCodes.includes('DECISION_LOG_ANCHOR_VERIFICATION_FAILED'));
  const anchoredSecond = contracts.createDecisionLogRecord({ ...firstInput, sequence: 2, decisionId: 'aiops-shadow-anchored-second', previousRecordDigest: first.recordDigest, requestedAssurance: 'SIGNED_CHECKPOINT', checkpointReceiptReference: 'checkpoint-receipt://synthetic/2' });
  const missingChainAnchorPort = decisionPort(first);
  const missingChainAnchor = contracts.appendDecisionThroughExistingPersistence(anchoredSecond, missingChainAnchorPort, exactAnchorVerifier(), null, anchoredSecond.timestampMs + 1);
  assert.equal(missingChainAnchor.assuranceCandidateValidatedForPortRecheck, false);
  assert.equal(missingChainAnchorPort.appendCount, 0);
  assert.ok(missingChainAnchor.reasonCodes.includes('DECISION_LOG_FULL_CHAIN_VERIFIER_NOT_MOUNTED'));
  let receiptGetterCalls = 0;
  const accessorReceiptPort = decisionPort(first, (receipt) => Object.defineProperty({ ...receipt }, 'appendReceiptReference', {
    enumerable: true,
    get() {
      receiptGetterCalls += 1;
      return receiptGetterCalls === 1 ? 'ledger-receipt://synthetic/2' : 'sk-proj-1234567890abcdef';
    },
  }));
  const accessorReceipt = contracts.appendDecisionThroughExistingPersistence(second, accessorReceiptPort, null, exactChainVerifier(first));
  assert.equal(accessorReceipt.candidateDurabilityValidatedForPortRecheck, false);
  assert.equal(accessorReceipt.appendReceiptReference, null);
  assert.ok(accessorReceipt.reasonCodes.includes('LEDGER_APPEND_OR_READBACK_FAILED'));
  assert.equal(receiptGetterCalls, 0);
  assert.equal(JSON.stringify(accessorReceipt).includes('sk-proj-1234567890abcdef'), false);
});

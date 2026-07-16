import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../server/dist/foundation/contracts/identity.js';
import { assertClosedKeys, snapshotInertJson } from '../../../server/dist/aiOps/runtime/support.js';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function createSyntheticSigner() {
  const algorithm = 'SYNTHETIC_SHA256_ATTESTATION';
  const keyId = 'synthetic-a2-key-v1';
  const signDigest = (digest) => Object.freeze({
    posture: 'SYNTHETIC_ONLY',
    algorithm,
    keyId,
    signature: sha256(`${keyId}\0${digest}\0PUBLIC_TEST_MATERIAL_ONLY`),
  });
  return Object.freeze({
    posture: 'SYNTHETIC_ONLY',
    signDigest,
    verifyDigest(digest, signature) {
      return signature.posture === 'SYNTHETIC_ONLY'
        && signature.algorithm === algorithm
        && signature.keyId === keyId
        && signature.signature === signDigest(digest).signature;
    },
  });
}

/** Fake artifact-owner authority. Production runtime receives verification/readback only, never this issuer. */
export function createSyntheticCaseProofAuthority() {
  const signer = createSyntheticSigner();
  const validations = new Map();
  const issueValidatedProof = (input) => {
    const validationReceiptDigest = sha256(canonicalJson({
      schema: 'AI_OPS_A2_SYNTHETIC_ARTIFACT_VALIDATION_V1',
      proofKind: input.proofKind,
      caseId: input.caseId,
      generation: input.generation,
      artifactId: input.artifactId,
      artifactDigest: input.artifactDigest,
      disposition: input.disposition,
      recordedAtMs: input.recordedAtMs,
      validatorId: 'synthetic-artifact-owner-v1',
      operationalAuthority: 'NONE',
    }));
    const payload = Object.freeze({
      schema: 'AI_OPS_A2_CASE_PROOF_V1',
      shadowStatus: 'SHADOW_SPECULATIVE',
      ...input,
      validationReceiptDigest,
      operationalAuthority: 'NONE',
    });
    const proofDigest = sha256(canonicalJson(payload));
    const naturalIdentity = {
      caseId: input.caseId,
      generation: input.generation,
      proofKind: input.proofKind,
      artifactId: input.artifactId,
      proofDigest,
    };
    const proofId = `a2-case-proof:${sha256(canonicalJson({ namespace: 'a2-case-proof', naturalIdentity })).slice(0, 24)}`;
    const proof = Object.freeze({
      ...payload,
      proofId,
      proofDigest,
      signature: Object.freeze({ ...signer.signDigest(proofDigest) }),
    });
    validations.set(proofId, validationReceiptDigest);
    return proof;
  };
  return Object.freeze({
    posture: 'SYNTHETIC_ONLY',
    issueValidatedProof,
    verifyDigest: signer.verifyDigest,
    verifyArtifactValidation(proof) {
      return validations.get(proof.proofId) === proof.validationReceiptDigest;
    },
  });
}

/** Fake deterministic semantic-claim owner; configured decisions are independent from caller requests. */
export function createSyntheticClaimValidationPort(configuredDecisions = []) {
  const decisions = snapshotInertJson(configuredDecisions, 'synthetic claim decisions');
  if (!Array.isArray(decisions) || decisions.length > 192) throw new TypeError('synthetic claim decision bound invalid');
  const keyFor = (value) => canonicalJson({
    claimKind: value.claimKind,
    claimId: value.claimId,
    claimDigest: value.claimDigest,
    evidencePointerIds: value.evidencePointerIds,
    falsificationTestIds: value.falsificationTestIds,
  });
  const decisionByKey = new Map(decisions.map((decision) => {
    assertClosedKeys(decision, [
      'claimKind', 'claimId', 'claimDigest', 'evidencePointerIds', 'falsificationTestIds', 'disposition',
    ], 'synthetic claim decision');
    if (!['OBSERVED_FACT', 'HYPOTHESIS'].includes(decision.claimKind)) throw new TypeError('synthetic claim kind invalid');
    if (!['VALIDATED', 'INVALIDATED', 'INCONCLUSIVE'].includes(decision.disposition)) throw new TypeError('synthetic claim disposition invalid');
    if (!Array.isArray(decision.evidencePointerIds) || !Array.isArray(decision.falsificationTestIds)) throw new TypeError('synthetic claim decision collections invalid');
    return [keyFor(decision), decision.disposition];
  }));
  if (decisionByKey.size !== decisions.length) throw new TypeError('synthetic claim decisions must be unique');
  const receiptCore = (request, disposition) => Object.freeze({
    schema: 'AI_OPS_A2_CLAIM_VALIDATION_RECEIPT_V1',
    shadowStatus: 'SHADOW_SPECULATIVE',
    posture: 'SYNTHETIC_ONLY',
    caseId: request.caseId,
    generation: request.generation,
    evidenceBundleDigest: request.evidenceBundleDigest,
    evidenceValidationDigest: request.evidenceValidationDigest,
    claimKind: request.claimKind,
    claimId: request.claimId,
    claimDigest: request.claimDigest,
    evidencePointerIds: Object.freeze([...request.evidencePointerIds]),
    requestedDisposition: request.requestedDisposition,
    falsificationTestIds: Object.freeze([...request.falsificationTestIds]),
    validatedAtMs: request.validatedAtMs,
    disposition,
    outcomeCodes: Object.freeze([disposition === 'VALIDATED'
      ? 'SYNTHETIC_CLAIM_CORROBORATED'
      : disposition === 'INVALIDATED'
        ? 'SYNTHETIC_FALSIFICATION_CONFIRMED'
        : 'SYNTHETIC_CLAIM_INCONCLUSIVE']),
    operationalAuthority: 'NONE',
  });
  return Object.freeze({
    posture: 'SYNTHETIC_ONLY',
    validateClaim(request) {
      const snapshot = snapshotInertJson(request, 'synthetic claim validation request');
      const disposition = decisionByKey.get(keyFor(snapshot)) ?? 'INCONCLUSIVE';
      const core = receiptCore(snapshot, disposition);
      return Object.freeze({ ...core, receiptDigest: sha256(canonicalJson(core)) });
    },
    verifyClaimValidation(receipt) {
      try {
        const snapshot = snapshotInertJson(receipt, 'synthetic claim validation receipt');
        const { receiptDigest, ...core } = snapshot;
        return receiptDigest === sha256(canonicalJson(core))
          && decisionByKey.get(keyFor(snapshot)) === snapshot.disposition
          && snapshot.requestedDisposition === snapshot.disposition;
      } catch {
        return false;
      }
    },
  });
}

export function runSyntheticProvider(input) {
  const snapshot = snapshotInertJson(input, 'synthetic provider input');
  assertClosedKeys(snapshot, ['providerState', 'classificationHint'], 'synthetic provider input');
  if (!['READY', 'NOT_CONFIGURED', 'UNAVAILABLE'].includes(snapshot.providerState)) {
    throw new TypeError('synthetic provider state unsupported');
  }
  if (snapshot.classificationHint !== undefined && !['SYNTHETIC_CLASS', 'UNKNOWN'].includes(snapshot.classificationHint)) {
    throw new TypeError('synthetic provider classification is outside its closed vocabulary');
  }
  const descriptor = Object.freeze({
    fixture: 'AI_OPS_A2_SYNTHETIC_PROVIDER_V1',
    providerId: 'synthetic-provider-a2',
    modelId: 'synthetic-model-a2',
    operationalAuthority: 'NONE',
    networkAccess: 'DENIED',
  });
  if (snapshot.providerState !== 'READY') {
    return Object.freeze({
      ...descriptor,
      shadowStatus: 'SHADOW_SPECULATIVE',
      diagnosticState: 'DIAGNOSTIC_PLANE_UNAVAILABLE',
      output: null,
      inputDigest: sha256(canonicalJson(snapshot)),
    });
  }
  return Object.freeze({
    ...descriptor,
    shadowStatus: 'SHADOW_SPECULATIVE',
    diagnosticState: 'READY',
    output: Object.freeze({
      classification: snapshot.classificationHint ?? 'UNKNOWN',
      confidence: null,
      proposalOnly: true,
    }),
    inputDigest: sha256(canonicalJson(snapshot)),
  });
}

export class SyntheticCanonicalPersistencePort {
  #value = null;
  #events = [];
  #commitAtMs;

  constructor(commitAtMs) {
    this.#commitAtMs = commitAtMs;
  }

  getConfigValue() {
    return this.#value;
  }

  compareAndSetConfigValueAndLogEvents(_key, expected, next, records, commitBeforeMs) {
    if (commitBeforeMs !== undefined && this.#commitAtMs >= commitBeforeMs) {
      return Object.freeze({ committed: false, reason: 'DEADLINE_EXCEEDED', currentValue: this.#value });
    }
    if (expected !== this.#value) {
      return Object.freeze({ committed: false, reason: 'VERSION_CONFLICT', currentValue: this.#value });
    }
    this.#value = next;
    const committed = records.map((record, index) => Object.freeze({
      id: this.#events.length + index + 1,
      ts: this.#commitAtMs,
      kind: record.kind,
      symbol: record.symbol ?? null,
      data: record.data,
    }));
    this.#events.push(...committed);
    return Object.freeze({ committed: true, events: Object.freeze(committed) });
  }

  events() {
    return Object.freeze([...this.#events]);
  }
}

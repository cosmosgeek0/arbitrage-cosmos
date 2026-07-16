import { createHash } from 'node:crypto';
import {
  assertCode,
  assertDigestOrNull,
  assertIdentifier,
  assertSafeNonNegativeInteger,
  assertUtcMs,
  evaluateEvidenceRef,
  sortedUnique,
  verdictFromReasons,
  type AssuranceEvidenceRef,
  type AssuranceVerdict,
} from '../common.js';

export const Q_ADVISORY_ACTIONS = Object.freeze([
  'IGNORE',
  'WATCH',
  'FOCUS',
  'PROPOSE_CONSIDERATION',
  'ABSTAIN_UNKNOWN',
] as const);
export type QAdvisoryAction = (typeof Q_ADVISORY_ACTIONS)[number];

export const Q_PROOF_REQUIREMENT_IDS = Object.freeze([
  'PROTOCOL_V1_COMPATIBILITY',
  'LINEAGE_INTEGRITY',
  'ASSESSMENT_FRESHNESS',
  'DATA_SUFFICIENCY',
  'INDEPENDENT_VERIFICATION',
  'HOLDOUT_SEPARATION',
] as const);
export type QProofRequirementId = (typeof Q_PROOF_REQUIREMENT_IDS)[number];

export const ACCEPTED_Q_ASSURANCE_IDENTITY = Object.freeze({
  acceptedProtocolCommit: '73e1a1ff7daa48df8dac45713fc5f106842edafc',
  acceptedQCommit: '02b4eccc8d2ef53b830cafae06e5175715fa6ebb',
  protocolSchemaDigest: '229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c',
  acceptanceReceiptDigest: '9cfa0356228d7f48674df2d9db523f0f0d53dab1a4e4255b6ba9676e463ec5dc',
});

export const Q_ASSURANCE_REQUIREMENTS = Object.freeze([
  Object.freeze({
    requirementId: 'ACCEPTED_Q_IDENTITY',
    sourceFields: Object.freeze([
      'acceptedProtocolCommit',
      'acceptedQCommit',
      'protocolSchemaDigest',
      'acceptanceReceiptDigest',
      'identityDigest',
    ]),
    expectedLaw: 'Immutable accepted Q and frozen protocol identities have independent evidence.',
  }),
  Object.freeze({
    requirementId: 'PROTOCOL_V1_COMPATIBILITY',
    sourceFields: Object.freeze(['envelopeSchema', 'envelopeVersion']),
    expectedLaw: 'Only the frozen EdgeAssessmentEnvelopeV1 version 1 is accepted.',
  }),
  Object.freeze({
    requirementId: 'LINEAGE_INTEGRITY',
    sourceFields: Object.freeze(['proofs.LINEAGE_INTEGRITY']),
    expectedLaw: 'Assessment lineage remains sealed and independently evidenced.',
  }),
  Object.freeze({
    requirementId: 'ASSESSMENT_FRESHNESS',
    sourceFields: Object.freeze(['proofs.ASSESSMENT_FRESHNESS']),
    expectedLaw: 'Expired, future-ambiguous, or unavailable assessment evidence is never green.',
  }),
  Object.freeze({
    requirementId: 'ADVISORY_ONLY_BOUNDARY',
    sourceFields: Object.freeze(['advisoryOnly', 'advisoryAction']),
    expectedLaw: 'Q output remains a research second opinion and never becomes a product authority.',
  }),
  Object.freeze({
    requirementId: 'NO_ORDER_OR_EXECUTION_AUTHORITY',
    sourceFields: Object.freeze([
      'orderAuthority',
      'executionAuthority',
      'capitalAuthority',
      'moneyMutationCapability',
    ]),
    expectedLaw: 'Q grants no order, execution, capital, or money-mutation authority.',
  }),
  Object.freeze({
    requirementId: 'UNKNOWN_ECONOMICS_ABSTAINS',
    sourceFields: Object.freeze(['economicsState', 'advisoryAction']),
    expectedLaw: 'Unknown economics forces ABSTAIN_UNKNOWN.',
  }),
  Object.freeze({
    requirementId: 'DATA_SUFFICIENCY',
    sourceFields: Object.freeze(['proofs.DATA_SUFFICIENCY']),
    expectedLaw: 'Data sufficiency is explicit evidence, never inferred from an emitted assessment.',
  }),
  Object.freeze({
    requirementId: 'INDEPENDENT_VERIFICATION',
    sourceFields: Object.freeze(['proofs.INDEPENDENT_VERIFICATION']),
    expectedLaw: 'Unknown verifier independence stays UNKNOWN; common-mode proof cannot self-verify.',
  }),
  Object.freeze({
    requirementId: 'HOLDOUT_SEPARATION',
    sourceFields: Object.freeze(['proofs.HOLDOUT_SEPARATION']),
    expectedLaw: 'Unknown holdout identity stays UNKNOWN; overlap with training evidence fails.',
  }),
  Object.freeze({
    requirementId: 'FORBIDDEN_CONTENT_ABSENT',
    sourceFields: Object.freeze(['forbiddenCapabilityFieldsPresent']),
    expectedLaw: 'Protocol input contains no secret, private exchange, order, or capital authority fields.',
  }),
] as const);
export type QAssuranceRequirementId =
  (typeof Q_ASSURANCE_REQUIREMENTS)[number]['requirementId'];

export interface QAssuranceProof {
  readonly requirementId: QProofRequirementId;
  readonly claimedVerdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly evidence: Readonly<AssuranceEvidenceRef> | null;
  readonly evidenceBinding: Readonly<QProofEvidenceBinding> | null;
  readonly producerCommonModeId: string | null;
  readonly verifierCommonModeId: string | null;
  readonly trainingDatasetIds: readonly string[];
  readonly evaluationDatasetId: string | null;
}

/**
 * Precomputed proof-artifact binding. Product Assurance does not hash Q input;
 * it compares the supplied digest contract and the evidence digest only.
 */
export interface QProofEvidenceBinding {
  readonly schema: 'PRODUCT_ASSURANCE_Q_PROOF_BINDING_V1';
  readonly requirementId: QProofRequirementId;
  readonly inputRevision: number;
  readonly identityDigest: string;
  readonly precomputedBindingDigest: string;
  readonly assessmentContentDigest: string;
}

export interface AcceptedQProtocolInput {
  readonly schema: 'PRODUCT_ASSURANCE_ACCEPTED_Q_INPUT_V1';
  readonly revision: number;
  readonly acceptedInputKind: 'IMMUTABLE_ACCEPTED_Q';
  readonly acceptedProtocolCommit: string;
  readonly acceptedQCommit: string;
  readonly protocolSchemaDigest: string;
  readonly acceptanceReceiptDigest: string;
  readonly identityDigest: string;
  readonly assessmentId: string;
  readonly assessmentContentDigest: string;
  readonly assessmentCreatedAtMs: number;
  readonly assessmentExpiresAtMs: number;
  readonly envelopeSchema: string;
  readonly envelopeVersion: number;
  readonly advisoryAction: QAdvisoryAction;
  readonly advisoryOnly: boolean;
  readonly orderAuthority: boolean;
  readonly executionAuthority: boolean;
  readonly capitalAuthority: boolean;
  readonly moneyMutationCapability: boolean;
  readonly forbiddenCapabilityFieldsPresent: boolean;
  readonly economicsState: 'KNOWN' | 'UNKNOWN';
  readonly acceptanceEvidence: Readonly<AssuranceEvidenceRef> | null;
  readonly proofs: readonly Readonly<QAssuranceProof>[];
}

/** Ordered fields hashed by the caller using JSON UTF-8 encoding. */
export type QIdentityTuple = readonly [
  inputSchema: 'PRODUCT_ASSURANCE_ACCEPTED_Q_INPUT_V1',
  inputRevision: number,
  acceptedProtocolCommit: string,
  acceptedQCommit: string,
  protocolSchemaDigest: string,
  acceptanceReceiptDigest: string,
  assessmentId: string,
  assessmentContentDigest: string,
  assessmentCreatedAtMs: number,
  assessmentExpiresAtMs: number,
];

export function projectQIdentityTuple(
  input: Readonly<AcceptedQProtocolInput>,
): Readonly<QIdentityTuple> {
  return Object.freeze([
    input.schema,
    input.revision,
    input.acceptedProtocolCommit,
    input.acceptedQCommit,
    input.protocolSchemaDigest,
    input.acceptanceReceiptDigest,
    input.assessmentId,
    input.assessmentContentDigest,
    input.assessmentCreatedAtMs,
    input.assessmentExpiresAtMs,
  ] as const);
}

/**
 * Trusted precomputation contract for the deterministic accepted-Q identity
 * tuple. The caller hashes this tuple outside the pure assurance evaluator.
 */
export interface QIdentityDigestContract {
  readonly schema: 'PRODUCT_ASSURANCE_Q_IDENTITY_DIGEST_CONTRACT_V1';
  readonly tupleEncoding: 'JSON_UTF8_ORDERED_TUPLE_V1';
  readonly identityTuple: Readonly<QIdentityTuple>;
  readonly precomputedIdentityDigest: string;
}

export interface QAssuranceCoverageRow {
  readonly requirementId: QAssuranceRequirementId;
  readonly sourceFields: readonly string[];
  readonly expectedLaw: string;
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly authorityGranted: false;
}

export interface QAssuranceCoverageMatrix {
  readonly schema: 'PRODUCT_ASSURANCE_Q_COVERAGE_MATRIX_V1';
  readonly inputRevision: number;
  readonly acceptedProtocolCommit: string;
  readonly acceptedQCommit: string;
  readonly identityDigest: string;
  readonly evaluatedAtMs: number;
  readonly expectedRequirementCount: number;
  readonly assessedRequirementCount: number;
  readonly assessedCoveragePercentage: number;
  readonly passedRequirementCount: number;
  readonly passedCoveragePercentage: number;
  readonly failedRequirementIds: readonly QAssuranceRequirementId[];
  readonly unknownRequirementIds: readonly QAssuranceRequirementId[];
  readonly rows: readonly Readonly<QAssuranceCoverageRow>[];
  readonly reportedAdvisoryAction: QAdvisoryAction;
  readonly safeProjectedAdvisoryAction: QAdvisoryAction;
  readonly overallVerdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly advisoryOnly: true;
  readonly orderAuthorityGranted: false;
  readonly executionAuthorityGranted: false;
  readonly capitalAuthorityGranted: false;
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
}

function assertEnum(value: string, allowed: readonly string[], label: string): void {
  if (!allowed.includes(value)) throw new TypeError(`${label} is unsupported`);
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique`);
}

function assertNullableIdentifier(value: unknown, label: string): void {
  if (value !== null) assertIdentifier(value, label);
}

function assertRequiredDigest(value: unknown, label: string): asserts value is string {
  assertDigestOrNull(value, label);
  if (value === null) throw new TypeError(`${label} must not be null`);
}

function assertCommitIdentity(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) {
    throw new TypeError(`${label} must be a full lowercase Git SHA-1 identity`);
  }
}

export function validateAcceptedQProtocolInput(input: Readonly<AcceptedQProtocolInput>): void {
  if (input.schema !== 'PRODUCT_ASSURANCE_ACCEPTED_Q_INPUT_V1') {
    throw new TypeError('accepted Q input schema unsupported');
  }
  assertSafeNonNegativeInteger(input.revision, 'input.revision');
  if (input.acceptedInputKind !== 'IMMUTABLE_ACCEPTED_Q') {
    throw new TypeError('accepted Q input must be immutable accepted data');
  }
  assertCommitIdentity(input.acceptedProtocolCommit, 'input.acceptedProtocolCommit');
  assertCommitIdentity(input.acceptedQCommit, 'input.acceptedQCommit');
  assertRequiredDigest(input.protocolSchemaDigest, 'input.protocolSchemaDigest');
  assertRequiredDigest(input.acceptanceReceiptDigest, 'input.acceptanceReceiptDigest');
  assertRequiredDigest(input.identityDigest, 'input.identityDigest');
  assertIdentifier(input.assessmentId, 'input.assessmentId');
  assertRequiredDigest(input.assessmentContentDigest, 'input.assessmentContentDigest');
  assertUtcMs(input.assessmentCreatedAtMs, 'input.assessmentCreatedAtMs');
  assertUtcMs(input.assessmentExpiresAtMs, 'input.assessmentExpiresAtMs');
  if (input.assessmentExpiresAtMs <= input.assessmentCreatedAtMs) throw new TypeError('assessment expiry must follow creation');
  for (const [field, accepted] of Object.entries(ACCEPTED_Q_ASSURANCE_IDENTITY)) {
    if (input[field as keyof typeof ACCEPTED_Q_ASSURANCE_IDENTITY] !== accepted) throw new TypeError(`input.${field} is not the director-accepted immutable identity`);
  }
  if (typeof input.envelopeSchema !== 'string' || input.envelopeSchema.length === 0) {
    throw new TypeError('input.envelopeSchema must be non-empty');
  }
  assertSafeNonNegativeInteger(input.envelopeVersion, 'input.envelopeVersion');
  assertEnum(input.advisoryAction, Q_ADVISORY_ACTIONS, 'input.advisoryAction');
  assertBoolean(input.advisoryOnly, 'input.advisoryOnly');
  assertBoolean(input.orderAuthority, 'input.orderAuthority');
  assertBoolean(input.executionAuthority, 'input.executionAuthority');
  assertBoolean(input.capitalAuthority, 'input.capitalAuthority');
  assertBoolean(input.moneyMutationCapability, 'input.moneyMutationCapability');
  assertBoolean(
    input.forbiddenCapabilityFieldsPresent,
    'input.forbiddenCapabilityFieldsPresent',
  );
  assertEnum(input.economicsState, ['KNOWN', 'UNKNOWN'], 'input.economicsState');

  const proofIds = input.proofs.map((proof) => proof.requirementId);
  assertUnique(proofIds, 'input.proofs.requirementId');
  for (const proof of input.proofs) {
    assertEnum(proof.requirementId, Q_PROOF_REQUIREMENT_IDS, 'proof.requirementId');
    assertEnum(proof.claimedVerdict, ['PASS', 'FAIL', 'UNKNOWN'], 'proof.claimedVerdict');
    assertUnique(proof.reasonCodes, 'proof.reasonCodes');
    for (const reasonCode of proof.reasonCodes) assertCode(reasonCode, 'proof.reasonCode');
    if (proof.claimedVerdict === 'PASS' && proof.reasonCodes.length > 0) {
      throw new TypeError('PASS Q proof must not carry failure or unknown reason codes');
    }
    if (proof.claimedVerdict !== 'PASS' && proof.reasonCodes.length === 0) {
      throw new TypeError('FAIL or UNKNOWN Q proof requires at least one reason code');
    }
    if (proof.evidenceBinding !== null) {
      if (proof.evidenceBinding.schema !== 'PRODUCT_ASSURANCE_Q_PROOF_BINDING_V1') {
        throw new TypeError('proof evidence binding schema unsupported');
      }
      assertEnum(
        proof.evidenceBinding.requirementId,
        Q_PROOF_REQUIREMENT_IDS,
        'proof.evidenceBinding.requirementId',
      );
      assertSafeNonNegativeInteger(
        proof.evidenceBinding.inputRevision,
        'proof.evidenceBinding.inputRevision',
      );
      assertRequiredDigest(
        proof.evidenceBinding.identityDigest,
        'proof.evidenceBinding.identityDigest',
      );
      assertRequiredDigest(
        proof.evidenceBinding.precomputedBindingDigest,
        'proof.evidenceBinding.precomputedBindingDigest',
      );
      assertRequiredDigest(proof.evidenceBinding.assessmentContentDigest, 'proof.evidenceBinding.assessmentContentDigest');
    }
    assertNullableIdentifier(proof.producerCommonModeId, 'proof.producerCommonModeId');
    assertNullableIdentifier(proof.verifierCommonModeId, 'proof.verifierCommonModeId');
    assertUnique(proof.trainingDatasetIds, 'proof.trainingDatasetIds');
    for (const datasetId of proof.trainingDatasetIds) {
      assertIdentifier(datasetId, 'proof.trainingDatasetIds[]');
    }
    assertNullableIdentifier(proof.evaluationDatasetId, 'proof.evaluationDatasetId');
  }
}

export function validateQIdentityDigestContract(
  contract: Readonly<QIdentityDigestContract>,
): void {
  if (contract.schema !== 'PRODUCT_ASSURANCE_Q_IDENTITY_DIGEST_CONTRACT_V1') {
    throw new TypeError('Q identity digest contract schema unsupported');
  }
  if (contract.tupleEncoding !== 'JSON_UTF8_ORDERED_TUPLE_V1') {
    throw new TypeError('Q identity digest tuple encoding unsupported');
  }
  if (!Array.isArray(contract.identityTuple) || contract.identityTuple.length !== 10) {
    throw new TypeError('Q identity digest contract requires the ten-field identity tuple');
  }
  if (contract.identityTuple[0] !== 'PRODUCT_ASSURANCE_ACCEPTED_Q_INPUT_V1') {
    throw new TypeError('Q identity digest contract input schema unsupported');
  }
  assertSafeNonNegativeInteger(contract.identityTuple[1], 'identityContract.inputRevision');
  assertCommitIdentity(
    contract.identityTuple[2],
    'identityContract.acceptedProtocolCommit',
  );
  assertCommitIdentity(contract.identityTuple[3], 'identityContract.acceptedQCommit');
  assertRequiredDigest(
    contract.identityTuple[4],
    'identityContract.protocolSchemaDigest',
  );
  assertRequiredDigest(
    contract.identityTuple[5],
    'identityContract.acceptanceReceiptDigest',
  );
  assertIdentifier(contract.identityTuple[6], 'identityContract.assessmentId');
  assertRequiredDigest(contract.identityTuple[7], 'identityContract.assessmentContentDigest');
  assertUtcMs(contract.identityTuple[8], 'identityContract.assessmentCreatedAtMs');
  assertUtcMs(contract.identityTuple[9], 'identityContract.assessmentExpiresAtMs');
  assertRequiredDigest(
    contract.precomputedIdentityDigest,
    'identityContract.precomputedIdentityDigest',
  );
}

interface EvaluatedProof {
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly evidenceIds: readonly string[];
}

function evaluateProof(
  proof: Readonly<QAssuranceProof> | undefined,
  input: Readonly<AcceptedQProtocolInput>,
  nowMs: number,
  evidenceReusedAcrossRequirements: boolean,
): Readonly<EvaluatedProof> {
  if (proof === undefined) {
    return Object.freeze({
      verdict: 'UNKNOWN',
      reasonCodes: Object.freeze(['REQUIRED_Q_PROOF_MISSING']),
      evidenceIds: Object.freeze([]),
    });
  }

  const failed: string[] = [];
  const unknown: string[] = [];
  if (proof.claimedVerdict === 'FAIL') {
    failed.push('Q_PROOF_OBSERVED_FAIL', ...proof.reasonCodes);
  }
  if (proof.claimedVerdict === 'UNKNOWN') {
    unknown.push('Q_PROOF_OBSERVED_UNKNOWN', ...proof.reasonCodes);
  }

  const binding = proof.evidenceBinding;
  if (proof.evidence !== null && binding === null) {
    failed.push('Q_PROOF_EVIDENCE_BINDING_MISSING');
  } else if (binding !== null) {
    if (binding.requirementId !== proof.requirementId) {
      failed.push('Q_PROOF_REQUIREMENT_BINDING_MISMATCH');
    }
    if (binding.inputRevision !== input.revision) {
      failed.push('Q_PROOF_INPUT_REVISION_BINDING_MISMATCH');
    }
    if (binding.identityDigest !== input.identityDigest) {
      failed.push('Q_PROOF_IDENTITY_DIGEST_BINDING_MISMATCH');
    }
    if (binding.assessmentContentDigest !== input.assessmentContentDigest) failed.push('Q_PROOF_ASSESSMENT_CONTENT_BINDING_MISMATCH');
    if (
      proof.evidence !== null &&
      proof.evidence.digest !== binding.precomputedBindingDigest
    ) {
      failed.push('Q_PROOF_ARTIFACT_DIGEST_BINDING_MISMATCH');
    }
  }
  if (evidenceReusedAcrossRequirements) {
    failed.push('Q_PROOF_EVIDENCE_REUSED_ACROSS_REQUIREMENTS');
  }

  const requiresIndependence =
    proof.requirementId === 'PROTOCOL_V1_COMPATIBILITY' ||
    proof.requirementId === 'LINEAGE_INTEGRITY' ||
    proof.requirementId === 'DATA_SUFFICIENCY' ||
    proof.requirementId === 'INDEPENDENT_VERIFICATION' ||
    proof.requirementId === 'HOLDOUT_SEPARATION';

  if (proof.evidence === null) {
    if (proof.claimedVerdict === 'FAIL') failed.push('EVIDENCE_MISSING_CONSERVATIVE_FAILURE');
    else unknown.push('REQUIRED_Q_EVIDENCE_MISSING');
  } else {
    const evidence = evaluateEvidenceRef(proof.evidence, nowMs, requiresIndependence);
    if (evidence.verdict === 'FAIL') failed.push(...evidence.reasonCodes);
    if (evidence.verdict === 'UNKNOWN') unknown.push(...evidence.reasonCodes);
  }

  if (requiresIndependence) {
    if (proof.producerCommonModeId === null || proof.verifierCommonModeId === null) {
      unknown.push('COMMON_MODE_IDENTITY_UNKNOWN');
    } else if (proof.producerCommonModeId === proof.verifierCommonModeId) {
      failed.push('COMMON_MODE_NOT_INDEPENDENT');
    }
  }

  if (proof.requirementId === 'HOLDOUT_SEPARATION') {
    if (proof.evaluationDatasetId === null || proof.trainingDatasetIds.length === 0) {
      unknown.push('HOLDOUT_IDENTITY_UNKNOWN');
    } else if (proof.trainingDatasetIds.includes(proof.evaluationDatasetId)) {
      failed.push('HOLDOUT_OVERLAPS_TRAINING');
    }
  }

  return Object.freeze({
    verdict: verdictFromReasons(failed, unknown),
    reasonCodes: sortedUnique([...failed, ...unknown]),
    evidenceIds: proof.evidence === null ? Object.freeze([]) : Object.freeze([proof.evidence.evidenceId]),
  });
}

function evaluateAcceptanceEvidence(
  input: Readonly<AcceptedQProtocolInput>,
  identityContract: Readonly<QIdentityDigestContract>,
  nowMs: number,
  evidenceReusedAcrossRequirements: boolean,
): Readonly<EvaluatedProof> {
  const evidence = input.acceptanceEvidence;
  const failed: string[] = [];
  const unknown: string[] = [];
  const expectedTuple = projectQIdentityTuple(input);
  if (identityContract.identityTuple[0] !== expectedTuple[0]) {
    failed.push('Q_IDENTITY_CONTRACT_INPUT_SCHEMA_MISMATCH');
  }
  if (identityContract.identityTuple[1] !== expectedTuple[1]) {
    failed.push('Q_IDENTITY_CONTRACT_INPUT_REVISION_MISMATCH');
  }
  if (identityContract.identityTuple[2] !== expectedTuple[2]) {
    failed.push('Q_IDENTITY_CONTRACT_PROTOCOL_COMMIT_MISMATCH');
  }
  if (identityContract.identityTuple[3] !== expectedTuple[3]) {
    failed.push('Q_IDENTITY_CONTRACT_Q_COMMIT_MISMATCH');
  }
  if (identityContract.identityTuple[4] !== expectedTuple[4]) {
    failed.push('Q_IDENTITY_CONTRACT_PROTOCOL_DIGEST_MISMATCH');
  }
  if (identityContract.identityTuple[5] !== expectedTuple[5]) {
    failed.push('Q_IDENTITY_CONTRACT_RECEIPT_DIGEST_MISMATCH');
  }
  if (identityContract.identityTuple.slice(6).join('\n') !== expectedTuple.slice(6).join('\n')) failed.push('Q_IDENTITY_CONTRACT_ASSESSMENT_BINDING_MISMATCH');
  const computedIdentityDigest = createHash('sha256').update(JSON.stringify(expectedTuple)).digest('hex');
  if (identityContract.precomputedIdentityDigest !== computedIdentityDigest || input.identityDigest !== computedIdentityDigest) {
    failed.push('Q_IDENTITY_DIGEST_CONTENT_MISMATCH');
  }
  if (identityContract.precomputedIdentityDigest !== input.identityDigest) {
    failed.push('Q_IDENTITY_DIGEST_CONTRACT_MISMATCH');
  }
  if (evidence === null) {
    unknown.push('ACCEPTED_Q_IDENTITY_EVIDENCE_MISSING');
    return Object.freeze({
      verdict: verdictFromReasons(failed, unknown),
      reasonCodes: sortedUnique([...failed, ...unknown]),
      evidenceIds: Object.freeze([]),
    });
  }
  const evaluated = evaluateEvidenceRef(evidence, nowMs, true);
  if (evaluated.verdict === 'FAIL') failed.push(...evaluated.reasonCodes);
  if (evaluated.verdict === 'UNKNOWN') unknown.push(...evaluated.reasonCodes);
  if (evidence.digest !== input.identityDigest) {
    failed.push('Q_ACCEPTANCE_EVIDENCE_IDENTITY_DIGEST_MISMATCH');
  }
  if (evidenceReusedAcrossRequirements) {
    failed.push('Q_ACCEPTANCE_EVIDENCE_REUSED_AS_PROOF');
  }
  return Object.freeze({
    verdict: verdictFromReasons(failed, unknown),
    reasonCodes: sortedUnique([...failed, ...unknown]),
    evidenceIds: evaluated.evidenceIds,
  });
}

function combineEvaluations(
  evaluations: readonly Readonly<EvaluatedProof>[],
  hardFailReasons: readonly string[] = [],
  hardUnknownReasons: readonly string[] = [],
): Readonly<EvaluatedProof> {
  const failed = [...hardFailReasons];
  const unknown = [...hardUnknownReasons];
  const evidenceIds: string[] = [];
  for (const evaluation of evaluations) {
    evidenceIds.push(...evaluation.evidenceIds);
    if (evaluation.verdict === 'FAIL') failed.push(...evaluation.reasonCodes);
    if (evaluation.verdict === 'UNKNOWN') unknown.push(...evaluation.reasonCodes);
  }
  return Object.freeze({
    verdict: verdictFromReasons(failed, unknown),
    reasonCodes: sortedUnique([...failed, ...unknown]),
    evidenceIds: sortedUnique(evidenceIds),
  });
}

function percentage(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export function generateQAssuranceCoverageMatrix(
  input: Readonly<AcceptedQProtocolInput>,
  evaluatedAtMs: number,
  identityContract: Readonly<QIdentityDigestContract>,
): Readonly<QAssuranceCoverageMatrix> {
  validateAcceptedQProtocolInput(input);
  validateQIdentityDigestContract(identityContract);
  assertUtcMs(evaluatedAtMs, 'evaluatedAtMs');
  const evidenceUses = new Map<string, Set<string>>();
  const recordEvidenceUse = (
    requirementId: QAssuranceRequirementId | QProofRequirementId,
    evidence: Readonly<AssuranceEvidenceRef> | null,
  ): void => {
    if (evidence === null) return;
    for (const key of [
      `id:${evidence.evidenceId}`,
      ...(evidence.digest === null ? [] : [`digest:${evidence.digest}`]),
    ]) {
      const uses = evidenceUses.get(key) ?? new Set<string>();
      uses.add(requirementId);
      evidenceUses.set(key, uses);
    }
  };
  recordEvidenceUse('ACCEPTED_Q_IDENTITY', input.acceptanceEvidence);
  for (const proof of input.proofs) recordEvidenceUse(proof.requirementId, proof.evidence);
  const evidenceIsReused = (evidence: Readonly<AssuranceEvidenceRef> | null): boolean => {
    if (evidence === null) return false;
    if ((evidenceUses.get(`id:${evidence.evidenceId}`)?.size ?? 0) > 1) return true;
    return (
      evidence.digest !== null &&
      (evidenceUses.get(`digest:${evidence.digest}`)?.size ?? 0) > 1
    );
  };

  const acceptance = evaluateAcceptanceEvidence(
    input,
    identityContract,
    evaluatedAtMs,
    evidenceIsReused(input.acceptanceEvidence),
  );
  const proofById = new Map(input.proofs.map((proof) => [proof.requirementId, proof]));
  const proofResult = (requirementId: QProofRequirementId): Readonly<EvaluatedProof> => {
    const proof = proofById.get(requirementId);
    return evaluateProof(
      proof,
      input,
      evaluatedAtMs,
      evidenceIsReused(proof?.evidence ?? null),
    );
  };

  const evaluationByRequirement = new Map<QAssuranceRequirementId, Readonly<EvaluatedProof>>([
    ['ACCEPTED_Q_IDENTITY', acceptance],
    [
      'PROTOCOL_V1_COMPATIBILITY',
      combineEvaluations(
        [proofResult('PROTOCOL_V1_COMPATIBILITY')],
        input.envelopeSchema !== 'EdgeAssessmentEnvelopeV1' || input.envelopeVersion !== 1
          ? ['PROTOCOL_VERSION_UNSUPPORTED']
          : [],
      ),
    ],
    ['LINEAGE_INTEGRITY', proofResult('LINEAGE_INTEGRITY')],
    ['ASSESSMENT_FRESHNESS', combineEvaluations(
      [proofResult('ASSESSMENT_FRESHNESS')],
      evaluatedAtMs < input.assessmentCreatedAtMs
        ? ['Q_ASSESSMENT_NOT_YET_VALID']
        : evaluatedAtMs >= input.assessmentExpiresAtMs
          ? ['Q_ASSESSMENT_EXPIRED']
          : [],
    )],
    [
      'ADVISORY_ONLY_BOUNDARY',
      combineEvaluations(
        [acceptance],
        input.advisoryOnly ? [] : ['Q_ADVISORY_BOUNDARY_VIOLATED'],
      ),
    ],
    [
      'NO_ORDER_OR_EXECUTION_AUTHORITY',
      combineEvaluations(
        [acceptance],
        input.orderAuthority ||
          input.executionAuthority ||
          input.capitalAuthority ||
          input.moneyMutationCapability
          ? ['Q_FORBIDDEN_AUTHORITY_PRESENT']
          : [],
      ),
    ],
    [
      'UNKNOWN_ECONOMICS_ABSTAINS',
      combineEvaluations(
        [acceptance],
        input.economicsState === 'UNKNOWN' && input.advisoryAction !== 'ABSTAIN_UNKNOWN'
          ? ['UNKNOWN_ECONOMICS_DID_NOT_ABSTAIN']
          : [],
      ),
    ],
    ['DATA_SUFFICIENCY', proofResult('DATA_SUFFICIENCY')],
    ['INDEPENDENT_VERIFICATION', proofResult('INDEPENDENT_VERIFICATION')],
    ['HOLDOUT_SEPARATION', proofResult('HOLDOUT_SEPARATION')],
    [
      'FORBIDDEN_CONTENT_ABSENT',
      combineEvaluations(
        [acceptance],
        input.forbiddenCapabilityFieldsPresent ? ['Q_FORBIDDEN_CONTENT_PRESENT'] : [],
      ),
    ],
  ]);

  const rows = Q_ASSURANCE_REQUIREMENTS.map((requirement): Readonly<QAssuranceCoverageRow> => {
    const evaluation = evaluationByRequirement.get(requirement.requirementId);
    if (evaluation === undefined) throw new TypeError('internal Q assurance requirement mapping missing');
    return Object.freeze({
      requirementId: requirement.requirementId,
      sourceFields: requirement.sourceFields,
      expectedLaw: requirement.expectedLaw,
      verdict: evaluation.verdict,
      reasonCodes: evaluation.reasonCodes,
      evidenceIds: evaluation.evidenceIds,
      authorityGranted: false,
    });
  });

  const failedIds = rows
    .filter((row) => row.verdict === 'FAIL')
    .map((row) => row.requirementId);
  const unknownIds = rows
    .filter((row) => row.verdict === 'UNKNOWN')
    .map((row) => row.requirementId);
  const assessedCount = rows.filter((row) => row.verdict !== 'UNKNOWN').length;
  const passedCount = rows.filter((row) => row.verdict === 'PASS').length;
  const overallVerdict: AssuranceVerdict = failedIds.length > 0
    ? 'FAIL'
    : unknownIds.length > 0
      ? 'UNKNOWN'
      : 'PASS';
  const reasons: string[] = [];
  if (failedIds.length > 0) reasons.push('Q_ASSURANCE_REQUIREMENT_FAILED');
  if (unknownIds.length > 0) reasons.push('Q_ASSURANCE_REQUIREMENT_UNKNOWN');

  return Object.freeze({
    schema: 'PRODUCT_ASSURANCE_Q_COVERAGE_MATRIX_V1',
    inputRevision: input.revision,
    acceptedProtocolCommit: input.acceptedProtocolCommit,
    acceptedQCommit: input.acceptedQCommit,
    identityDigest: input.identityDigest,
    evaluatedAtMs,
    expectedRequirementCount: rows.length,
    assessedRequirementCount: assessedCount,
    assessedCoveragePercentage: percentage(assessedCount, rows.length),
    passedRequirementCount: passedCount,
    passedCoveragePercentage: percentage(passedCount, rows.length),
    failedRequirementIds: Object.freeze(failedIds),
    unknownRequirementIds: Object.freeze(unknownIds),
    rows: Object.freeze(rows),
    reportedAdvisoryAction: input.advisoryAction,
    safeProjectedAdvisoryAction:
      overallVerdict === 'PASS' ? input.advisoryAction : 'ABSTAIN_UNKNOWN',
    overallVerdict,
    reasonCodes: sortedUnique(reasons),
    advisoryOnly: true,
    orderAuthorityGranted: false,
    executionAuthorityGranted: false,
    capitalAuthorityGranted: false,
  });
}

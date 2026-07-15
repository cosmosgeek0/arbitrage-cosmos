import type { ShadowEvidenceBundle, ShadowPointerValidation } from './types.js';
import { SHADOW_A2_STATUS } from './types.js';
import {
  validateEvidencePointers,
  snapshotValidatedEvidenceBundle,
  type ShadowEvidenceLimits,
  type ShadowEvidencePointerReadPort,
} from './evidence.js';
import {
  assertClosedKeys,
  assertDigest,
  assertIdentifier,
  assertSafeNonNegative,
  assertShadowSafeInstruction,
  assertUtc,
  boundedSortedIdentifiers,
  compareCodeUnitStrings,
  digestValue,
  shadowSpeculativeId,
  sortedUnique,
  snapshotInertJson,
} from './support.js';
import { validateBudgetAdmission, type ShadowBudgetAdmission } from './budget.js';

export type ShadowClaimDisposition = 'VALIDATED' | 'INVALIDATED' | 'INCONCLUSIVE';

export interface ShadowDiagnosticClaim {
  readonly claimId: string;
  readonly claimDigest: string;
  readonly evidencePointerIds: readonly string[];
  readonly disposition: ShadowClaimDisposition;
}

export interface ShadowDiagnosticHypothesis extends ShadowDiagnosticClaim {
  readonly falsificationTestIds: readonly string[];
}

export interface ShadowClaimValidationRequest {
  readonly caseId: string;
  readonly generation: number;
  readonly evidenceBundleDigest: string;
  readonly evidenceValidationDigest: string;
  readonly claimKind: 'OBSERVED_FACT' | 'HYPOTHESIS';
  readonly claimId: string;
  readonly claimDigest: string;
  readonly evidencePointerIds: readonly string[];
  readonly requestedDisposition: ShadowClaimDisposition;
  readonly falsificationTestIds: readonly string[];
  readonly validatedAtMs: number;
}

export interface ShadowClaimValidationReceipt extends ShadowClaimValidationRequest {
  readonly schema: 'AI_OPS_A2_CLAIM_VALIDATION_RECEIPT_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly posture: 'SYNTHETIC_ONLY';
  readonly disposition: ShadowClaimDisposition;
  readonly outcomeCodes: readonly string[];
  readonly operationalAuthority: 'NONE';
  readonly receiptDigest: string;
}

/** Structural claim-adjudication adapter; A2 owns neither semantic truth nor a claim store. */
export interface ShadowClaimValidationPort {
  readonly posture: 'SYNTHETIC_ONLY';
  validateClaim(request: Readonly<ShadowClaimValidationRequest>): Readonly<ShadowClaimValidationReceipt>;
  verifyClaimValidation(receipt: Readonly<ShadowClaimValidationReceipt>): boolean;
}

export interface ShadowDiagnosticVersions {
  readonly providerId: string;
  readonly modelId: string;
  readonly promptRevision: string;
  readonly toolRevision: string;
  readonly policyRevision: string;
  readonly contextManifestDigest: string;
  readonly budgetAdmissionDigest: string;
  readonly usageRequestDigest: string;
}

export interface ShadowDiagnosticResultInput {
  readonly caseId: string;
  readonly generation: number;
  readonly evidenceBundleDigest: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly observedFacts: readonly Readonly<ShadowDiagnosticClaim>[];
  readonly hypotheses: readonly Readonly<ShadowDiagnosticHypothesis>[];
  readonly supportingEvidencePointerIds: readonly string[];
  readonly conflictingEvidencePointerIds: readonly string[];
  readonly uncertainty: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  readonly missingEvidenceCodes: readonly string[];
  readonly falsificationTestIds: readonly string[];
  readonly affectedCapabilityIds: readonly string[];
  readonly immediateSafetyPostureDigest: string;
  readonly recommendedNextStep: string;
  readonly forbiddenOrUnavailableActionCodes: readonly string[];
  readonly versions: Readonly<ShadowDiagnosticVersions>;
  readonly likelyRootCause: string | 'UNKNOWN';
  readonly recommendedRunbookIds: readonly string[];
  readonly proposedQueryOrTestIds: readonly string[];
  readonly patchRecommended: 'TRUE' | 'FALSE' | 'UNKNOWN';
  readonly ownerAttentionRequired: boolean;
  readonly escalationReasonCode: string | null;
}

export interface ShadowDiagnosticResult extends ShadowDiagnosticResultInput {
  readonly schema: 'AI_OPS_A2_DIAGNOSTIC_RESULT_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly diagnosisId: string;
  readonly diagnosisDigest: string;
  readonly disposition: ShadowClaimDisposition;
  readonly evidenceValidationDigest: string;
  readonly claimValidationReceipts: readonly Readonly<ShadowClaimValidationReceipt>[];
  readonly claimValidationDigest: string;
  readonly operationalAuthority: 'NONE';
}

export function assertDiagnosticResultIntegrity(result: Readonly<ShadowDiagnosticResult>): void {
  assertClosedKeys(result, [
    'schema', 'shadowStatus', 'diagnosisId', 'diagnosisDigest', 'caseId', 'generation', 'evidenceBundleDigest',
    'createdAtMs', 'expiresAtMs', 'observedFacts', 'hypotheses', 'supportingEvidencePointerIds',
    'conflictingEvidencePointerIds', 'uncertainty', 'missingEvidenceCodes', 'falsificationTestIds',
    'affectedCapabilityIds', 'immediateSafetyPostureDigest', 'recommendedNextStep',
    'forbiddenOrUnavailableActionCodes', 'versions', 'likelyRootCause', 'recommendedRunbookIds',
    'proposedQueryOrTestIds', 'patchRecommended', 'ownerAttentionRequired', 'escalationReasonCode',
    'disposition', 'evidenceValidationDigest', 'claimValidationReceipts', 'claimValidationDigest',
    'operationalAuthority',
  ], 'diagnostic result');
  if (result.schema !== 'AI_OPS_A2_DIAGNOSTIC_RESULT_V1' || result.shadowStatus !== SHADOW_A2_STATUS) throw new TypeError('diagnostic result schema or status invalid');
  if (result.operationalAuthority !== 'NONE') throw new TypeError('diagnostic result cannot carry operational authority');
  assertIdentifier(result.diagnosisId, 'result.diagnosisId');
  assertDigest(result.diagnosisDigest, 'result.diagnosisDigest');
  assertDigest(result.evidenceValidationDigest, 'result.evidenceValidationDigest');
  assertDigest(result.claimValidationDigest, 'result.claimValidationDigest');
  if (!Array.isArray(result.claimValidationReceipts) || result.claimValidationReceipts.length > 192) {
    throw new TypeError('diagnostic claim validation receipt bound invalid');
  }
  for (const receipt of result.claimValidationReceipts) validateClaimValidationReceipt(receipt);
  if (new Set(result.claimValidationReceipts.map((receipt) => receipt.claimId)).size !== result.claimValidationReceipts.length) {
    throw new TypeError('diagnostic claim validation receipt IDs must be unique');
  }
  if (digestValue(result.claimValidationReceipts) !== result.claimValidationDigest) {
    throw new TypeError('diagnostic claim validation digest mismatch');
  }
  const canonicalClaimValidationReceipts = [...result.claimValidationReceipts]
    .sort((left, right) => compareCodeUnitStrings(left.claimId, right.claimId));
  if (digestValue(canonicalClaimValidationReceipts) !== digestValue(result.claimValidationReceipts)) {
    throw new TypeError('diagnostic claim validation receipts are not canonical');
  }
  const claims = [...result.observedFacts.map((claim) => ({ claim, kind: 'OBSERVED_FACT' as const, tests: [] as readonly string[] })),
    ...result.hypotheses.map((claim) => ({ claim, kind: 'HYPOTHESIS' as const, tests: claim.falsificationTestIds }))];
  if (claims.length !== result.claimValidationReceipts.length || claims.some(({ claim, kind, tests }) => {
    const receipt = result.claimValidationReceipts.find((candidate) => candidate.claimId === claim.claimId);
    return receipt === undefined
      || receipt.claimKind !== kind
      || receipt.claimDigest !== claim.claimDigest
      || receipt.disposition !== claim.disposition
      || digestValue(receipt.evidencePointerIds) !== digestValue(claim.evidencePointerIds)
      || digestValue(receipt.falsificationTestIds) !== digestValue(tests)
      || receipt.evidenceBundleDigest !== result.evidenceBundleDigest
      || receipt.evidenceValidationDigest !== result.evidenceValidationDigest
      || receipt.caseId !== result.caseId
      || receipt.generation !== result.generation;
  })) throw new TypeError('diagnostic claims are not exactly owner-validated');
  if (result.claimValidationReceipts.some((receipt) => receipt.validatedAtMs !== result.createdAtMs)) {
    throw new TypeError('diagnostic claim validation time is not bound to result creation');
  }
  assertUtc(result.createdAtMs, 'result.createdAtMs');
  assertUtc(result.expiresAtMs, 'result.expiresAtMs');
  if (result.expiresAtMs <= result.createdAtMs) throw new TypeError('diagnostic result expiry invalid');
  const { diagnosisId: _diagnosisId, diagnosisDigest: _diagnosisDigest, ...core } = result;
  if (digestValue(core) !== result.diagnosisDigest) throw new TypeError('diagnostic result digest mismatch');
  const expectedId = shadowSpeculativeId('a2-diagnosis', {
    caseId: result.caseId,
    generation: result.generation,
    diagnosisDigest: result.diagnosisDigest,
  });
  if (result.diagnosisId !== expectedId) throw new TypeError('diagnostic result ID mismatch');
}

function diagnosticAsInput(result: Readonly<ShadowDiagnosticResult>): ShadowDiagnosticResultInput {
  const {
    schema: _schema,
    shadowStatus: _shadowStatus,
    diagnosisId: _diagnosisId,
    diagnosisDigest: _diagnosisDigest,
    disposition: _disposition,
    evidenceValidationDigest: _evidenceValidationDigest,
    claimValidationReceipts: _claimValidationReceipts,
    claimValidationDigest: _claimValidationDigest,
    operationalAuthority: _operationalAuthority,
    ...input
  } = result;
  return input;
}

function assertDiagnosticBoundToEvidence(
  result: Readonly<ShadowDiagnosticResult>,
  bundle: Readonly<ShadowEvidenceBundle>,
  atMs: number,
  limits: Readonly<ShadowEvidenceLimits>,
  evidencePort: Readonly<ShadowEvidencePointerReadPort>,
  claimValidationPort: Readonly<ShadowClaimValidationPort>,
  budgetAdmission: Readonly<ShadowBudgetAdmission>,
): void {
  assertDiagnosticResultIntegrity(result);
  budgetAdmission = snapshotInertJson(budgetAdmission, 'diagnostic budget admission') as Readonly<ShadowBudgetAdmission>;
  assertDiagnosticBudgetLineage(result, budgetAdmission);
  bundle = snapshotValidatedEvidenceBundle(bundle, limits);
  if (bundle.caseId !== result.caseId || bundle.bundleDigest !== result.evidenceBundleDigest) {
    throw new TypeError('diagnostic result evidence bundle lineage mismatch');
  }
  const validationRows = validateEvidencePointers(bundle, atMs, limits, evidencePort);
  const semantics = projectDiagnosticSemantics(
    diagnosticAsInput(result),
    bundle,
    atMs,
    limits,
    validationRows,
    false,
  );
  if (digestValue(semantics.input) !== digestValue(diagnosticAsInput(result))) {
    throw new TypeError('diagnostic result semantic fields are not canonical');
  }
  if (semantics.evidenceValidationDigest !== result.evidenceValidationDigest) {
    throw new TypeError('diagnostic result does not match current evidence validation');
  }
  if (semantics.disposition !== result.disposition) throw new TypeError('diagnostic result disposition is not semantically derived');
  validateClaimValidationPort(claimValidationPort);
  for (const receipt of result.claimValidationReceipts) {
    if (claimValidationPort.verifyClaimValidation(receipt) !== true) throw new TypeError('diagnostic claim validation receipt owner verification failed');
  }
}

const CLAIM_KEYS = Object.freeze(['claimId', 'claimDigest', 'evidencePointerIds', 'disposition'] as const);
const HYPOTHESIS_KEYS = Object.freeze([...CLAIM_KEYS, 'falsificationTestIds'] as const);
const CLAIM_VALIDATION_RECEIPT_KEYS = Object.freeze([
  'schema', 'shadowStatus', 'posture', 'caseId', 'generation', 'evidenceBundleDigest',
  'evidenceValidationDigest', 'claimKind', 'claimId', 'claimDigest', 'evidencePointerIds',
  'requestedDisposition', 'falsificationTestIds', 'validatedAtMs', 'disposition', 'outcomeCodes',
  'operationalAuthority', 'receiptDigest',
] as const);

function claimValidationRequestFromReceipt(
  receipt: Readonly<ShadowClaimValidationReceipt>,
): Readonly<ShadowClaimValidationRequest> {
  return Object.freeze({
    caseId: receipt.caseId,
    generation: receipt.generation,
    evidenceBundleDigest: receipt.evidenceBundleDigest,
    evidenceValidationDigest: receipt.evidenceValidationDigest,
    claimKind: receipt.claimKind,
    claimId: receipt.claimId,
    claimDigest: receipt.claimDigest,
    evidencePointerIds: Object.freeze([...receipt.evidencePointerIds]),
    requestedDisposition: receipt.requestedDisposition,
    falsificationTestIds: Object.freeze([...receipt.falsificationTestIds]),
    validatedAtMs: receipt.validatedAtMs,
  });
}

function validateClaimValidationReceipt(receipt: Readonly<ShadowClaimValidationReceipt>): void {
  assertClosedKeys(receipt, CLAIM_VALIDATION_RECEIPT_KEYS, 'claim validation receipt');
  if (
    receipt.schema !== 'AI_OPS_A2_CLAIM_VALIDATION_RECEIPT_V1'
    || receipt.shadowStatus !== SHADOW_A2_STATUS
    || receipt.posture !== 'SYNTHETIC_ONLY'
    || receipt.operationalAuthority !== 'NONE'
  ) throw new TypeError('claim validation receipt posture invalid');
  assertIdentifier(receipt.caseId, 'claimValidation.caseId');
  assertSafeNonNegative(receipt.generation, 'claimValidation.generation');
  assertDigest(receipt.evidenceBundleDigest, 'claimValidation.evidenceBundleDigest');
  assertDigest(receipt.evidenceValidationDigest, 'claimValidation.evidenceValidationDigest');
  if (!(['OBSERVED_FACT', 'HYPOTHESIS'] as const).includes(receipt.claimKind)) throw new TypeError('claim validation kind invalid');
  assertIdentifier(receipt.claimId, 'claimValidation.claimId');
  assertDigest(receipt.claimDigest, 'claimValidation.claimDigest');
  const evidencePointerIds = boundedSortedIdentifiers(receipt.evidencePointerIds, 'claimValidation.evidencePointerIds', 128);
  const falsificationTestIds = boundedSortedIdentifiers(receipt.falsificationTestIds, 'claimValidation.falsificationTestIds', 64);
  const outcomeCodes = boundedSortedIdentifiers(receipt.outcomeCodes, 'claimValidation.outcomeCodes', 64);
  if (
    digestValue(evidencePointerIds) !== digestValue(receipt.evidencePointerIds)
    || digestValue(falsificationTestIds) !== digestValue(receipt.falsificationTestIds)
    || digestValue(outcomeCodes) !== digestValue(receipt.outcomeCodes)
  ) throw new TypeError('claim validation receipt collections are not canonical');
  if (!(['VALIDATED', 'INVALIDATED', 'INCONCLUSIVE'] as const).includes(receipt.requestedDisposition)) throw new TypeError('claim requested disposition invalid');
  if (!(['VALIDATED', 'INVALIDATED', 'INCONCLUSIVE'] as const).includes(receipt.disposition)) throw new TypeError('claim validation disposition invalid');
  if (receipt.disposition !== receipt.requestedDisposition) throw new TypeError('claim owner did not validate the requested disposition');
  if (outcomeCodes.length === 0) throw new TypeError('claim validation receipt requires owner outcome codes');
  if (receipt.claimKind === 'OBSERVED_FACT' && (receipt.disposition !== 'VALIDATED' || falsificationTestIds.length !== 0)) {
    throw new TypeError('observed-fact validation receipt is inconsistent');
  }
  if (receipt.claimKind === 'HYPOTHESIS' && falsificationTestIds.length === 0) throw new TypeError('hypothesis validation receipt requires falsification tests');
  assertUtc(receipt.validatedAtMs, 'claimValidation.validatedAtMs');
  assertDigest(receipt.receiptDigest, 'claimValidation.receiptDigest');
  const { receiptDigest: _receiptDigest, ...core } = receipt;
  if (digestValue(core) !== receipt.receiptDigest) throw new TypeError('claim validation receipt digest mismatch');
}

function validateClaimWithOwner(
  request: Readonly<ShadowClaimValidationRequest>,
  port: Readonly<ShadowClaimValidationPort>,
): Readonly<ShadowClaimValidationReceipt> {
  validateClaimValidationPort(port);
  const receipt = snapshotInertJson(port.validateClaim(request), 'claim validation receipt') as Readonly<ShadowClaimValidationReceipt>;
  validateClaimValidationReceipt(receipt);
  if (digestValue(claimValidationRequestFromReceipt(receipt)) !== digestValue(request)) {
    throw new TypeError('claim validation receipt is not bound to its exact request');
  }
  if (port.verifyClaimValidation(receipt) !== true) throw new TypeError('claim validation receipt owner verification failed');
  return receipt;
}

function validateClaimValidationPort(port: Readonly<ShadowClaimValidationPort>): void {
  assertClosedKeys(port, ['posture', 'validateClaim', 'verifyClaimValidation'], 'claim validation port');
  if (
    port.posture !== 'SYNTHETIC_ONLY'
    || typeof port.validateClaim !== 'function'
    || typeof port.verifyClaimValidation !== 'function'
  ) throw new TypeError('claim validation owner port is unavailable');
}

function validateVersions(versions: Readonly<ShadowDiagnosticVersions>): void {
  assertClosedKeys(versions, [
    'providerId', 'modelId', 'promptRevision', 'toolRevision', 'policyRevision', 'contextManifestDigest',
    'budgetAdmissionDigest', 'usageRequestDigest',
  ], 'diagnostic versions');
  for (const [key, value] of Object.entries(versions)) {
    if (key === 'contextManifestDigest' || key === 'budgetAdmissionDigest' || key === 'usageRequestDigest') assertDigest(value, `versions.${key}`);
    else assertIdentifier(value, `versions.${key}`);
  }
}

function assertDiagnosticBudgetLineage(
  input: Readonly<Pick<ShadowDiagnosticResultInput, 'caseId' | 'createdAtMs' | 'versions'>>,
  admission: Readonly<ShadowBudgetAdmission>,
): void {
  validateBudgetAdmission(admission);
  if (!admission.admitted || admission.diagnosticState !== 'READY') {
    throw new TypeError('diagnostic result requires an admitted provider budget decision');
  }
  if (
    admission.caseId !== input.caseId
    || admission.providerId !== input.versions.providerId
    || admission.modelId !== input.versions.modelId
    || admission.policyRevision !== input.versions.policyRevision
    || admission.admissionDigest !== input.versions.budgetAdmissionDigest
    || admission.usageRequestDigest !== input.versions.usageRequestDigest
  ) throw new TypeError('diagnostic provider budget lineage mismatch');
  if (admission.evaluatedAtMs > input.createdAtMs) throw new TypeError('diagnostic result predates provider budget admission');
}

function validateClaim(
  claim: Readonly<ShadowDiagnosticClaim>,
  label: string,
  hypothesis: boolean,
): Readonly<ShadowDiagnosticClaim | ShadowDiagnosticHypothesis> {
  assertClosedKeys(claim, hypothesis ? HYPOTHESIS_KEYS : CLAIM_KEYS, label);
  assertIdentifier(claim.claimId, `${label}.claimId`);
  assertDigest(claim.claimDigest, `${label}.claimDigest`);
  if (!(['VALIDATED', 'INVALIDATED', 'INCONCLUSIVE'] as const).includes(claim.disposition)) throw new TypeError(`${label}.disposition invalid`);
  const evidencePointerIds = boundedSortedIdentifiers(claim.evidencePointerIds, `${label}.evidencePointerIds`, 128);
  if (hypothesis) {
    const value = claim as Readonly<ShadowDiagnosticHypothesis>;
    const falsificationTestIds = boundedSortedIdentifiers(value.falsificationTestIds, `${label}.falsificationTestIds`, 64);
    if (falsificationTestIds.length === 0) throw new TypeError('every hypothesis requires a falsification path');
    if (claim.disposition !== 'INCONCLUSIVE' && evidencePointerIds.length === 0) {
      throw new TypeError('validated or invalidated hypotheses require evidence pointers');
    }
    return Object.freeze({ ...claim, evidencePointerIds, falsificationTestIds });
  }
  if (claim.disposition !== 'VALIDATED') throw new TypeError('observed facts must be validated rather than hypothesized');
  if (evidencePointerIds.length === 0) throw new TypeError('observed facts require evidence pointers');
  return Object.freeze({ ...claim, evidencePointerIds });
}

function validatePointerValidations(
  validations: readonly Readonly<ShadowPointerValidation>[],
  evidenceBundleDigest: string,
): ReadonlyMap<string, ShadowPointerValidation['disposition']> {
  if (!Array.isArray(validations) || validations.length > 128) throw new TypeError('diagnostic evidence validation bound invalid');
  const map = new Map<string, ShadowPointerValidation['disposition']>();
  for (const validation of validations) {
    assertClosedKeys(validation, ['shadowStatus', 'bundleDigest', 'pointerId', 'disposition', 'reasonCodes'], 'evidence validation');
    if (validation.shadowStatus !== SHADOW_A2_STATUS || validation.bundleDigest !== evidenceBundleDigest) throw new TypeError('evidence validation is not bound to this shadow bundle');
    assertIdentifier(validation.pointerId, 'validation.pointerId');
    if (!(['VALIDATED', 'INVALIDATED', 'INCONCLUSIVE'] as const).includes(validation.disposition)) throw new TypeError('evidence validation disposition invalid');
    boundedSortedIdentifiers(validation.reasonCodes, 'validation.reasonCodes', 32);
    if (map.has(validation.pointerId)) throw new TypeError('evidence validation pointer IDs must be unique');
    map.set(validation.pointerId, validation.disposition);
  }
  return map;
}

function canonicalEvidenceValidationRows(
  validationRows: readonly Readonly<ShadowPointerValidation>[],
): readonly Readonly<ShadowPointerValidation>[] {
  return Object.freeze(validationRows.map((validation) => Object.freeze({
    shadowStatus: validation.shadowStatus,
    bundleDigest: validation.bundleDigest,
    pointerId: validation.pointerId,
    disposition: validation.disposition,
    reasonCodes: boundedSortedIdentifiers(validation.reasonCodes, 'validation.reasonCodes', 32),
  })).sort((left, right) => compareCodeUnitStrings(left.pointerId, right.pointerId)));
}

interface ShadowDiagnosticSemanticProjection {
  readonly input: Readonly<ShadowDiagnosticResultInput>;
  readonly evidenceValidationDigest: string;
  readonly disposition: ShadowClaimDisposition;
}

/** One semantic projection is used both at issuance and when replaying a stored diagnostic. */
function projectDiagnosticSemantics(
  rawInput: Readonly<ShadowDiagnosticResultInput>,
  bundle: Readonly<ShadowEvidenceBundle>,
  evaluationAtMs: number,
  limits: Readonly<ShadowEvidenceLimits>,
  validationRows: readonly Readonly<ShadowPointerValidation>[],
  requireTrustedCreationTime: boolean,
): Readonly<ShadowDiagnosticSemanticProjection> {
  const input = snapshotInertJson(rawInput, 'diagnostic result input') as Readonly<ShadowDiagnosticResultInput>;
  assertClosedKeys(input, [
    'caseId', 'generation', 'evidenceBundleDigest', 'createdAtMs', 'expiresAtMs', 'observedFacts', 'hypotheses',
    'supportingEvidencePointerIds', 'conflictingEvidencePointerIds', 'uncertainty', 'missingEvidenceCodes',
    'falsificationTestIds', 'affectedCapabilityIds', 'immediateSafetyPostureDigest', 'recommendedNextStep',
    'forbiddenOrUnavailableActionCodes', 'versions', 'likelyRootCause', 'recommendedRunbookIds',
    'proposedQueryOrTestIds', 'patchRecommended', 'ownerAttentionRequired', 'escalationReasonCode',
  ], 'diagnostic result input');
  assertIdentifier(input.caseId, 'input.caseId');
  assertSafeNonNegative(input.generation, 'input.generation');
  assertDigest(input.evidenceBundleDigest, 'input.evidenceBundleDigest');
  if (bundle.caseId !== input.caseId || bundle.bundleDigest !== input.evidenceBundleDigest) {
    throw new TypeError('diagnostic result evidence bundle lineage mismatch');
  }
  assertUtc(evaluationAtMs, 'evaluationAtMs');
  assertUtc(input.createdAtMs, 'input.createdAtMs');
  assertUtc(input.expiresAtMs, 'input.expiresAtMs');
  if (input.expiresAtMs <= input.createdAtMs) throw new TypeError('diagnostic result expiry invalid');
  if (bundle.createdAtMs > evaluationAtMs || bundle.evidenceWindowEndMs > evaluationAtMs) {
    throw new TypeError('diagnostic evidence bundle is from the future');
  }
  if (input.createdAtMs < bundle.createdAtMs) throw new TypeError('diagnostic result predates its evidence bundle');
  if (input.createdAtMs > evaluationAtMs) throw new TypeError('diagnostic result is not yet valid');
  if (requireTrustedCreationTime && input.createdAtMs !== evaluationAtMs) {
    throw new TypeError('diagnostic result creation time must equal trusted now');
  }
  if (evaluationAtMs >= input.expiresAtMs) throw new TypeError('diagnostic result is expired');
  const bundleFreshnessExpiry = bundle.createdAtMs + limits.maximumAgeMs + 1;
  if (!Number.isSafeInteger(bundleFreshnessExpiry)) throw new TypeError('evidence bundle freshness expiry exceeds safe time bounds');
  const evidenceFreshnessExpiresAtMs = bundle.items.reduce((earliestExpiry, item) => {
    const pointerExpiry = item.pointer.capturedAtMs + limits.maximumAgeMs + 1;
    if (!Number.isSafeInteger(pointerExpiry)) throw new TypeError('evidence freshness expiry exceeds safe time bounds');
    return Math.min(earliestExpiry, pointerExpiry);
  }, bundleFreshnessExpiry);
  if (input.expiresAtMs > evidenceFreshnessExpiresAtMs) throw new TypeError('diagnostic result outlives evidence freshness');
  if (!Array.isArray(input.observedFacts) || input.observedFacts.length > 128) throw new TypeError('observed fact bound invalid');
  if (!Array.isArray(input.hypotheses) || input.hypotheses.length === 0 || input.hypotheses.length > 64) throw new TypeError('hypothesis bound invalid');
  const observedFacts = input.observedFacts
    .map((claim, index) => validateClaim(claim, `observedFacts[${index}]`, false) as Readonly<ShadowDiagnosticClaim>)
    .sort((left, right) => compareCodeUnitStrings(left.claimId, right.claimId));
  const hypotheses = input.hypotheses
    .map((claim, index) => validateClaim(claim, `hypotheses[${index}]`, true) as Readonly<ShadowDiagnosticHypothesis>)
    .sort((left, right) => compareCodeUnitStrings(left.claimId, right.claimId));
  const claimIds = [...observedFacts, ...hypotheses].map((claim) => claim.claimId);
  if (new Set(claimIds).size !== claimIds.length) throw new TypeError('diagnostic claim IDs must be unique');
  const supportingEvidencePointerIds = boundedSortedIdentifiers(input.supportingEvidencePointerIds, 'supportingEvidencePointerIds', 128);
  const conflictingEvidencePointerIds = boundedSortedIdentifiers(input.conflictingEvidencePointerIds, 'conflictingEvidencePointerIds', 128);
  if (supportingEvidencePointerIds.some((id) => conflictingEvidencePointerIds.includes(id))) {
    throw new TypeError('evidence cannot be both supporting and conflicting');
  }
  if (!(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] as const).includes(input.uncertainty)) throw new TypeError('diagnostic uncertainty invalid');
  const missingEvidenceCodes = boundedSortedIdentifiers(input.missingEvidenceCodes, 'missingEvidenceCodes', 64);
  const falsificationTestIds = boundedSortedIdentifiers(input.falsificationTestIds, 'falsificationTestIds', 64);
  if (falsificationTestIds.length === 0) throw new TypeError('diagnostic result requires falsification tests');
  const hypothesisFalsificationTestIds = sortedUnique(hypotheses.flatMap((hypothesis) => hypothesis.falsificationTestIds));
  if (digestValue(falsificationTestIds) !== digestValue(hypothesisFalsificationTestIds)) {
    throw new TypeError('diagnostic falsification tests do not exactly cover hypotheses');
  }
  const affectedCapabilityIds = boundedSortedIdentifiers(input.affectedCapabilityIds, 'affectedCapabilityIds', 64);
  assertDigest(input.immediateSafetyPostureDigest, 'immediateSafetyPostureDigest');
  assertShadowSafeInstruction(input.recommendedNextStep, 'recommendedNextStep');
  const forbiddenOrUnavailableActionCodes = boundedSortedIdentifiers(input.forbiddenOrUnavailableActionCodes, 'forbiddenOrUnavailableActionCodes', 64);
  for (const required of ['NO_MONEY_PATHS', 'NO_PRODUCTION_AUTHORITY']) {
    if (!forbiddenOrUnavailableActionCodes.includes(required)) throw new TypeError(`diagnostic result missing required denial: ${required}`);
  }
  validateVersions(input.versions);
  if (input.versions.policyRevision !== bundle.policyRevision) throw new TypeError('diagnostic policy revision does not match evidence bundle policy');
  assertIdentifier(input.likelyRootCause, 'likelyRootCause');
  if (
    input.likelyRootCause !== 'UNKNOWN'
    && !hypotheses.some((hypothesis) => hypothesis.claimId === input.likelyRootCause && hypothesis.disposition === 'VALIDATED')
  ) throw new TypeError('likely root cause must identify a validated hypothesis or UNKNOWN');
  const recommendedRunbookIds = boundedSortedIdentifiers(input.recommendedRunbookIds, 'recommendedRunbookIds', 64);
  const proposedQueryOrTestIds = boundedSortedIdentifiers(input.proposedQueryOrTestIds, 'proposedQueryOrTestIds', 64);
  if (!(['TRUE', 'FALSE', 'UNKNOWN'] as const).includes(input.patchRecommended)) throw new TypeError('patch recommendation invalid');
  if (typeof input.ownerAttentionRequired !== 'boolean') throw new TypeError('owner attention flag invalid');
  if (input.escalationReasonCode !== null) assertIdentifier(input.escalationReasonCode, 'escalationReasonCode');
  const validations = validatePointerValidations(validationRows, input.evidenceBundleDigest);
  const canonicalValidationRows = canonicalEvidenceValidationRows(validationRows);
  const evidenceValidationDigest = digestValue(canonicalValidationRows);
  for (const fact of observedFacts) {
    if (fact.evidencePointerIds.some((id) => validations.get(id) !== 'VALIDATED')) {
      throw new TypeError('observed fact cites evidence that is not validated');
    }
  }
  for (const hypothesis of hypotheses) {
    if (hypothesis.evidencePointerIds.some((id) => !validations.has(id))) {
      throw new TypeError('hypothesis cites evidence without a validation record');
    }
    if (hypothesis.disposition !== 'INCONCLUSIVE' && hypothesis.evidencePointerIds.some((id) => validations.get(id) !== 'VALIDATED')) {
      throw new TypeError('validated or invalidated hypothesis cites evidence that is not validated');
    }
  }
  if (supportingEvidencePointerIds.some((id) => validations.get(id) !== 'VALIDATED')) {
    throw new TypeError('supporting evidence must be pointer-validated');
  }
  if (conflictingEvidencePointerIds.some((id) => !validations.has(id))) {
    throw new TypeError('conflicting evidence must retain a validation record');
  }
  const bundleHasEvidenceGap = bundle.freshness !== 'FRESH'
    || bundle.temporalCoherence !== 'COHERENT'
    || bundle.missingEvidenceCodes.length > 0
    || bundle.conflictingEvidenceCodes.length > 0
    || bundle.unknownCodes.length > 0
    || bundle.omittedPointerIds.length > 0
    || validationRows.some((validation) => validation.disposition !== 'VALIDATED');
  const disposition: ShadowClaimDisposition = bundleHasEvidenceGap
    || missingEvidenceCodes.length > 0
    || input.uncertainty === 'UNKNOWN'
    || conflictingEvidencePointerIds.length > 0
    || hypotheses.some((hypothesis) => hypothesis.disposition === 'INCONCLUSIVE')
    ? 'INCONCLUSIVE'
    : hypotheses.every((hypothesis) => hypothesis.disposition === 'INVALIDATED')
      ? 'INVALIDATED'
      : 'VALIDATED';
  const canonicalInput: Readonly<ShadowDiagnosticResultInput> = Object.freeze({
    caseId: input.caseId,
    generation: input.generation,
    evidenceBundleDigest: input.evidenceBundleDigest,
    createdAtMs: input.createdAtMs,
    expiresAtMs: input.expiresAtMs,
    observedFacts: Object.freeze(observedFacts),
    hypotheses: Object.freeze(hypotheses),
    supportingEvidencePointerIds,
    conflictingEvidencePointerIds,
    uncertainty: input.uncertainty,
    missingEvidenceCodes,
    falsificationTestIds,
    affectedCapabilityIds,
    immediateSafetyPostureDigest: input.immediateSafetyPostureDigest,
    recommendedNextStep: input.recommendedNextStep,
    forbiddenOrUnavailableActionCodes,
    versions: Object.freeze({ ...input.versions }),
    likelyRootCause: input.likelyRootCause,
    recommendedRunbookIds,
    proposedQueryOrTestIds,
    patchRecommended: input.patchRecommended,
    ownerAttentionRequired: input.ownerAttentionRequired,
    escalationReasonCode: input.escalationReasonCode,
  });
  return Object.freeze({ input: canonicalInput, evidenceValidationDigest, disposition });
}

export function createDiagnosticResult(
  input: Readonly<ShadowDiagnosticResultInput>,
  bundle: Readonly<ShadowEvidenceBundle>,
  nowMs: number,
  limits: Readonly<ShadowEvidenceLimits>,
  evidencePort: Readonly<ShadowEvidencePointerReadPort>,
  claimValidationPort: Readonly<ShadowClaimValidationPort>,
  budgetAdmission: Readonly<ShadowBudgetAdmission>,
): Readonly<ShadowDiagnosticResult> {
  input = snapshotInertJson(input, 'diagnostic result input') as Readonly<ShadowDiagnosticResultInput>;
  budgetAdmission = snapshotInertJson(budgetAdmission, 'diagnostic budget admission') as Readonly<ShadowBudgetAdmission>;
  assertUtc(nowMs, 'nowMs');
  assertUtc(input.createdAtMs, 'input.createdAtMs');
  if (input.createdAtMs !== nowMs) throw new TypeError('diagnostic result creation time must equal trusted now');
  assertDiagnosticBudgetLineage(input, budgetAdmission);
  limits = snapshotInertJson(limits, 'diagnostic evidence limits') as Readonly<ShadowEvidenceLimits>;
  bundle = snapshotValidatedEvidenceBundle(bundle, limits);
  const validationRows = validateEvidencePointers(bundle, nowMs, limits, evidencePort);
  const semantics = projectDiagnosticSemantics(input, bundle, nowMs, limits, validationRows, true);
  const canonicalInput = semantics.input;
  const claimValidationReceipts = [
    ...canonicalInput.observedFacts.map((claim) => ({ claim, claimKind: 'OBSERVED_FACT' as const, falsificationTestIds: Object.freeze([]) })),
    ...canonicalInput.hypotheses.map((claim) => ({ claim, claimKind: 'HYPOTHESIS' as const, falsificationTestIds: claim.falsificationTestIds })),
  ]
    .map(({ claim, claimKind, falsificationTestIds }) => validateClaimWithOwner(Object.freeze({
      caseId: canonicalInput.caseId,
      generation: canonicalInput.generation,
      evidenceBundleDigest: canonicalInput.evidenceBundleDigest,
      evidenceValidationDigest: semantics.evidenceValidationDigest,
      claimKind,
      claimId: claim.claimId,
      claimDigest: claim.claimDigest,
      evidencePointerIds: Object.freeze([...claim.evidencePointerIds]),
      requestedDisposition: claim.disposition,
      falsificationTestIds: Object.freeze([...falsificationTestIds]),
      validatedAtMs: canonicalInput.createdAtMs,
    }), claimValidationPort))
    .sort((left, right) => compareCodeUnitStrings(left.claimId, right.claimId));
  const claimValidationDigest = digestValue(claimValidationReceipts);
  const core = Object.freeze({
    schema: 'AI_OPS_A2_DIAGNOSTIC_RESULT_V1' as const,
    shadowStatus: SHADOW_A2_STATUS,
    ...canonicalInput,
    disposition: semantics.disposition,
    evidenceValidationDigest: semantics.evidenceValidationDigest,
    claimValidationReceipts: Object.freeze(claimValidationReceipts),
    claimValidationDigest,
    operationalAuthority: 'NONE' as const,
  });
  const diagnosisDigest = digestValue(core);
  return Object.freeze({
    ...core,
    diagnosisId: shadowSpeculativeId('a2-diagnosis', {
      caseId: canonicalInput.caseId,
      generation: canonicalInput.generation,
      diagnosisDigest,
    }),
    diagnosisDigest,
  });
}

export interface ShadowModelRunHandoffInput {
  readonly caseId: string;
  readonly generation: number;
  readonly runId: string;
  readonly intentCode: string;
  readonly evidenceBundleDigest: string;
  readonly validatedFactIds: readonly string[];
  readonly validatedHypothesisIds: readonly string[];
  readonly invalidatedHypothesisIds: readonly string[];
  readonly inconclusiveHypothesisIds: readonly string[];
  readonly actionReceipts: readonly Readonly<{ receiptId: string; receiptDigest: string }>[];
  readonly proposedArtifactDigests: readonly string[];
  readonly decisionCodes: readonly string[];
  readonly denialCodes: readonly string[];
  readonly unresolvedRiskCodes: readonly string[];
  readonly nextStepCodes: readonly string[];
  readonly stopCondition: string;
  readonly versions: Readonly<ShadowDiagnosticVersions>;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export interface ShadowModelRunHandoff extends ShadowModelRunHandoffInput {
  readonly schema: 'AI_OPS_A2_MODEL_RUN_HANDOFF_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly handoffId: string;
  readonly handoffDigest: string;
  readonly diagnosisId: string;
  readonly diagnosisDigest: string;
  readonly evidenceValidationDigest: string;
  readonly claimValidationDigest: string;
  readonly operationalAuthority: 'NONE';
}

function createModelRunHandoffInternal(
  input: Readonly<ShadowModelRunHandoffInput>,
  diagnostic: Readonly<ShadowDiagnosticResult>,
  bundle: Readonly<ShadowEvidenceBundle>,
  limits: Readonly<ShadowEvidenceLimits>,
  evidencePort: Readonly<ShadowEvidencePointerReadPort>,
  claimValidationPort: Readonly<ShadowClaimValidationPort>,
  budgetAdmission: Readonly<ShadowBudgetAdmission>,
  revalidateOwners: boolean,
): Readonly<ShadowModelRunHandoff> {
  input = snapshotInertJson(input, 'model-run handoff input') as Readonly<ShadowModelRunHandoffInput>;
  diagnostic = snapshotInertJson(diagnostic, 'diagnostic result') as Readonly<ShadowDiagnosticResult>;
  budgetAdmission = snapshotInertJson(budgetAdmission, 'model-run budget admission') as Readonly<ShadowBudgetAdmission>;
  limits = snapshotInertJson(limits, 'model-run evidence limits') as Readonly<ShadowEvidenceLimits>;
  bundle = snapshotValidatedEvidenceBundle(bundle, limits);
  assertClosedKeys(input, [
    'caseId', 'generation', 'runId', 'intentCode', 'evidenceBundleDigest', 'validatedFactIds',
    'validatedHypothesisIds', 'invalidatedHypothesisIds', 'inconclusiveHypothesisIds', 'actionReceipts', 'proposedArtifactDigests',
    'decisionCodes', 'denialCodes', 'unresolvedRiskCodes', 'nextStepCodes', 'stopCondition', 'versions',
    'createdAtMs', 'expiresAtMs',
  ], 'model-run handoff input');
  assertIdentifier(input.caseId, 'input.caseId');
  assertSafeNonNegative(input.generation, 'input.generation');
  assertIdentifier(input.runId, 'input.runId');
  assertShadowSafeInstruction(input.intentCode, 'input.intentCode');
  assertDigest(input.evidenceBundleDigest, 'input.evidenceBundleDigest');
  if (
    diagnostic.caseId !== input.caseId
    || diagnostic.generation !== input.generation
    || diagnostic.evidenceBundleDigest !== input.evidenceBundleDigest
  ) throw new TypeError('model-run handoff diagnostic lineage mismatch');
  if (input.stopCondition !== 'SHADOW_ARTIFACT_READY') throw new TypeError('model-run handoff stop condition must remain SHADOW_ARTIFACT_READY');
  validateVersions(input.versions);
  if (digestValue(input.versions) !== digestValue(diagnostic.versions)) {
    throw new TypeError('model-run handoff versions do not match diagnostic versions');
  }
  assertUtc(input.createdAtMs, 'input.createdAtMs');
  assertUtc(input.expiresAtMs, 'input.expiresAtMs');
  if (revalidateOwners) assertDiagnosticBoundToEvidence(diagnostic, bundle, input.createdAtMs, limits, evidencePort, claimValidationPort, budgetAdmission);
  else {
    assertDiagnosticResultIntegrity(diagnostic);
    assertDiagnosticBudgetLineage(diagnostic, budgetAdmission);
  }
  if (input.expiresAtMs <= input.createdAtMs) throw new TypeError('model-run handoff expiry invalid');
  if (input.createdAtMs < diagnostic.createdAtMs) throw new TypeError('model-run handoff predates diagnostic validity');
  if (input.createdAtMs >= diagnostic.expiresAtMs) throw new TypeError('model-run handoff diagnostic is expired');
  if (input.expiresAtMs > diagnostic.expiresAtMs) throw new TypeError('model-run handoff outlives diagnostic validity');
  const bounded = {
    validatedFactIds: boundedSortedIdentifiers(input.validatedFactIds, 'validatedFactIds', 128),
    validatedHypothesisIds: boundedSortedIdentifiers(input.validatedHypothesisIds, 'validatedHypothesisIds', 64),
    invalidatedHypothesisIds: boundedSortedIdentifiers(input.invalidatedHypothesisIds, 'invalidatedHypothesisIds', 64),
    inconclusiveHypothesisIds: boundedSortedIdentifiers(input.inconclusiveHypothesisIds, 'inconclusiveHypothesisIds', 64),
    decisionCodes: boundedSortedIdentifiers(input.decisionCodes, 'decisionCodes', 64),
    denialCodes: boundedSortedIdentifiers(input.denialCodes, 'denialCodes', 64),
    unresolvedRiskCodes: boundedSortedIdentifiers(input.unresolvedRiskCodes, 'unresolvedRiskCodes', 64),
    nextStepCodes: boundedSortedIdentifiers(input.nextStepCodes, 'nextStepCodes', 64),
  };
  if (!Array.isArray(input.actionReceipts) || input.actionReceipts.length > 128) throw new TypeError('action receipt bound invalid');
  const actionReceipts = input.actionReceipts.map((receipt) => {
    assertClosedKeys(receipt, ['receiptId', 'receiptDigest'], 'action receipt');
    assertIdentifier(receipt.receiptId, 'actionReceipt.receiptId');
    assertDigest(receipt.receiptDigest, 'actionReceipt.receiptDigest');
    return Object.freeze({ ...receipt });
  }).sort((left, right) => compareCodeUnitStrings(left.receiptId, right.receiptId));
  if (new Set(actionReceipts.map((receipt) => receipt.receiptId)).size !== actionReceipts.length) throw new TypeError('action receipt IDs must be unique');
  if (bounded.nextStepCodes.length === 0) throw new TypeError('model-run handoff requires exact next steps');
  for (const code of [...bounded.nextStepCodes, ...bounded.decisionCodes]) assertShadowSafeInstruction(code, 'model-run action code');
  for (const required of ['NO_MONEY_PATHS', 'NO_PRODUCTION_AUTHORITY']) {
    if (!bounded.denialCodes.includes(required)) throw new TypeError(`model-run handoff missing required denial: ${required}`);
  }
  const allHypothesisIds = [
    ...bounded.validatedHypothesisIds,
    ...bounded.invalidatedHypothesisIds,
    ...bounded.inconclusiveHypothesisIds,
  ];
  if (new Set(allHypothesisIds).size !== allHypothesisIds.length) throw new TypeError('hypothesis handoff dispositions conflict');
  const expectedFactIds = diagnostic.observedFacts.map((fact) => fact.claimId).sort();
  if (JSON.stringify(bounded.validatedFactIds) !== JSON.stringify(expectedFactIds)) throw new TypeError('model-run handoff fact set does not match diagnostic result');
  const expectedInvalidated = diagnostic.hypotheses.filter((hypothesis) => hypothesis.disposition === 'INVALIDATED').map((hypothesis) => hypothesis.claimId).sort();
  const expectedInconclusive = diagnostic.hypotheses.filter((hypothesis) => hypothesis.disposition === 'INCONCLUSIVE').map((hypothesis) => hypothesis.claimId).sort();
  const expectedValidated = diagnostic.hypotheses.filter((hypothesis) => hypothesis.disposition === 'VALIDATED').map((hypothesis) => hypothesis.claimId).sort();
  if (
    JSON.stringify(bounded.validatedHypothesisIds) !== JSON.stringify(expectedValidated)
    || JSON.stringify(bounded.invalidatedHypothesisIds) !== JSON.stringify(expectedInvalidated)
    || JSON.stringify(bounded.inconclusiveHypothesisIds) !== JSON.stringify(expectedInconclusive)
  ) throw new TypeError('model-run handoff hypothesis dispositions do not match diagnostic result');
  if (!Array.isArray(input.proposedArtifactDigests) || input.proposedArtifactDigests.length > 64) throw new TypeError('proposed artifact bound invalid');
  for (const digest of input.proposedArtifactDigests) assertDigest(digest, 'proposedArtifactDigests[]');
  const proposedArtifactDigests = Object.freeze(sortedUnique(input.proposedArtifactDigests));
  const core = Object.freeze({
    schema: 'AI_OPS_A2_MODEL_RUN_HANDOFF_V1' as const,
    shadowStatus: SHADOW_A2_STATUS,
    caseId: input.caseId,
    generation: input.generation,
    runId: input.runId,
    intentCode: input.intentCode,
    evidenceBundleDigest: input.evidenceBundleDigest,
    diagnosisId: diagnostic.diagnosisId,
    diagnosisDigest: diagnostic.diagnosisDigest,
    evidenceValidationDigest: diagnostic.evidenceValidationDigest,
    claimValidationDigest: diagnostic.claimValidationDigest,
    ...bounded,
    actionReceipts: Object.freeze(actionReceipts),
    proposedArtifactDigests,
    stopCondition: input.stopCondition,
    versions: Object.freeze({ ...input.versions }),
    createdAtMs: input.createdAtMs,
    expiresAtMs: input.expiresAtMs,
    operationalAuthority: 'NONE' as const,
  });
  const handoffDigest = digestValue(core);
  return Object.freeze({
    ...core,
    handoffId: shadowSpeculativeId('a2-model-run-handoff', { caseId: input.caseId, runId: input.runId, handoffDigest }),
    handoffDigest,
  });
}

export function createModelRunHandoff(
  input: Readonly<ShadowModelRunHandoffInput>,
  diagnostic: Readonly<ShadowDiagnosticResult>,
  bundle: Readonly<ShadowEvidenceBundle>,
  limits: Readonly<ShadowEvidenceLimits>,
  evidencePort: Readonly<ShadowEvidencePointerReadPort>,
  claimValidationPort: Readonly<ShadowClaimValidationPort>,
  budgetAdmission: Readonly<ShadowBudgetAdmission>,
): Readonly<ShadowModelRunHandoff> {
  return createModelRunHandoffInternal(input, diagnostic, bundle, limits, evidencePort, claimValidationPort, budgetAdmission, true);
}

export function verifyModelRunHandoff(
  handoff: Readonly<ShadowModelRunHandoff>,
  diagnostic: Readonly<ShadowDiagnosticResult>,
  bundle: Readonly<ShadowEvidenceBundle>,
  expectedCaseId: string,
  expectedGeneration: number,
  nowMs: number,
  limits: Readonly<ShadowEvidenceLimits>,
  evidencePort: Readonly<ShadowEvidencePointerReadPort>,
  claimValidationPort: Readonly<ShadowClaimValidationPort>,
  budgetAdmission: Readonly<ShadowBudgetAdmission>,
): Readonly<{ shadowStatus: typeof SHADOW_A2_STATUS; valid: boolean; reasonCodes: readonly string[] }> {
  const reasons: string[] = [];
  try {
    handoff = snapshotInertJson(handoff, 'model-run handoff') as Readonly<ShadowModelRunHandoff>;
    diagnostic = snapshotInertJson(diagnostic, 'diagnostic result') as Readonly<ShadowDiagnosticResult>;
    budgetAdmission = snapshotInertJson(budgetAdmission, 'model-run budget admission') as Readonly<ShadowBudgetAdmission>;
    limits = snapshotInertJson(limits, 'model-run evidence limits') as Readonly<ShadowEvidenceLimits>;
    bundle = snapshotValidatedEvidenceBundle(bundle, limits);
    assertIdentifier(expectedCaseId, 'expectedCaseId');
    assertSafeNonNegative(expectedGeneration, 'expectedGeneration');
    assertUtc(nowMs, 'nowMs');
    assertClosedKeys(handoff, [
      'schema', 'shadowStatus', 'handoffId', 'handoffDigest', 'diagnosisId', 'diagnosisDigest',
      'evidenceValidationDigest', 'claimValidationDigest', 'caseId', 'generation', 'runId', 'intentCode', 'evidenceBundleDigest',
      'validatedFactIds', 'validatedHypothesisIds', 'invalidatedHypothesisIds', 'inconclusiveHypothesisIds', 'actionReceipts',
      'proposedArtifactDigests', 'decisionCodes', 'denialCodes', 'unresolvedRiskCodes', 'nextStepCodes',
      'stopCondition', 'versions', 'createdAtMs', 'expiresAtMs', 'operationalAuthority',
    ], 'model-run handoff');
    if (!Array.isArray(handoff.actionReceipts)) throw new TypeError('model-run action receipts must be an array');
    assertClosedKeys(handoff.versions, [
      'providerId', 'modelId', 'promptRevision', 'toolRevision', 'policyRevision', 'contextManifestDigest',
      'budgetAdmissionDigest', 'usageRequestDigest',
    ], 'model-run versions');
    const snapshot = Object.freeze({
      schema: handoff.schema,
      shadowStatus: handoff.shadowStatus,
      handoffId: handoff.handoffId,
      handoffDigest: handoff.handoffDigest,
      diagnosisId: handoff.diagnosisId,
      diagnosisDigest: handoff.diagnosisDigest,
      evidenceValidationDigest: handoff.evidenceValidationDigest,
      claimValidationDigest: handoff.claimValidationDigest,
      caseId: handoff.caseId,
      generation: handoff.generation,
      runId: handoff.runId,
      intentCode: handoff.intentCode,
      evidenceBundleDigest: handoff.evidenceBundleDigest,
      validatedFactIds: Object.freeze(Array.from(handoff.validatedFactIds)),
      validatedHypothesisIds: Object.freeze(Array.from(handoff.validatedHypothesisIds)),
      invalidatedHypothesisIds: Object.freeze(Array.from(handoff.invalidatedHypothesisIds)),
      inconclusiveHypothesisIds: Object.freeze(Array.from(handoff.inconclusiveHypothesisIds)),
      actionReceipts: Object.freeze(Array.from(handoff.actionReceipts)),
      proposedArtifactDigests: Object.freeze(Array.from(handoff.proposedArtifactDigests)),
      decisionCodes: Object.freeze(Array.from(handoff.decisionCodes)),
      denialCodes: Object.freeze(Array.from(handoff.denialCodes)),
      unresolvedRiskCodes: Object.freeze(Array.from(handoff.unresolvedRiskCodes)),
      nextStepCodes: Object.freeze(Array.from(handoff.nextStepCodes)),
      stopCondition: handoff.stopCondition,
      versions: Object.freeze({
        providerId: handoff.versions.providerId,
        modelId: handoff.versions.modelId,
        promptRevision: handoff.versions.promptRevision,
        toolRevision: handoff.versions.toolRevision,
        policyRevision: handoff.versions.policyRevision,
        contextManifestDigest: handoff.versions.contextManifestDigest,
        budgetAdmissionDigest: handoff.versions.budgetAdmissionDigest,
        usageRequestDigest: handoff.versions.usageRequestDigest,
      }),
      createdAtMs: handoff.createdAtMs,
      expiresAtMs: handoff.expiresAtMs,
      operationalAuthority: handoff.operationalAuthority,
    });
    const {
      schema, shadowStatus, handoffId, handoffDigest, diagnosisId: _diagnosisId,
      diagnosisDigest: _diagnosisDigest, evidenceValidationDigest: _evidenceValidationDigest,
      claimValidationDigest: _claimValidationDigest, operationalAuthority: _operationalAuthority, ...input
    } = snapshot;
    const rebuilt = createModelRunHandoffInternal(input, diagnostic, bundle, limits, evidencePort, claimValidationPort, budgetAdmission, false);
    if (schema !== rebuilt.schema || shadowStatus !== SHADOW_A2_STATUS) reasons.push('MODEL_HANDOFF_SCHEMA_INVALID');
    if (snapshot.operationalAuthority !== 'NONE') reasons.push('MODEL_HANDOFF_AUTHORITY_INVALID');
    if (handoffDigest !== rebuilt.handoffDigest) reasons.push('MODEL_HANDOFF_DIGEST_MISMATCH');
    if (handoffId !== rebuilt.handoffId) reasons.push('MODEL_HANDOFF_ID_MISMATCH');
    if (
      snapshot.diagnosisId !== diagnostic.diagnosisId
      || snapshot.diagnosisDigest !== diagnostic.diagnosisDigest
      || snapshot.evidenceValidationDigest !== diagnostic.evidenceValidationDigest
      || snapshot.claimValidationDigest !== diagnostic.claimValidationDigest
    ) reasons.push('MODEL_HANDOFF_DIAGNOSTIC_MISMATCH');
    if (snapshot.caseId !== expectedCaseId) reasons.push('MODEL_HANDOFF_CASE_MISMATCH');
    if (snapshot.generation !== expectedGeneration) reasons.push('MODEL_HANDOFF_GENERATION_MISMATCH');
    try {
      assertDiagnosticBoundToEvidence(diagnostic, bundle, nowMs, limits, evidencePort, claimValidationPort, budgetAdmission);
    } catch {
      reasons.push('MODEL_HANDOFF_DIAGNOSTIC_REVALIDATION_FAILED');
    }
    if (nowMs < diagnostic.createdAtMs) reasons.push('MODEL_HANDOFF_DIAGNOSTIC_NOT_YET_VALID');
    if (nowMs >= diagnostic.expiresAtMs) reasons.push('MODEL_HANDOFF_DIAGNOSTIC_EXPIRED');
    if (nowMs < snapshot.createdAtMs) reasons.push('MODEL_HANDOFF_NOT_YET_VALID');
    if (nowMs >= snapshot.expiresAtMs) reasons.push('MODEL_HANDOFF_EXPIRED');
  } catch {
    reasons.push('MODEL_HANDOFF_STRUCTURE_INVALID');
  }
  return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, valid: reasons.length === 0, reasonCodes: Object.freeze(sortedUnique(reasons)) });
}

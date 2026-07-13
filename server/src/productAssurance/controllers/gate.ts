import {
  ASSURANCE_VERDICTS,
  assertDigestOrNull,
  assertIdentifier,
  assertSafeNonNegativeInteger,
  assertUtcMs,
  isPlainRecord,
  sortedUnique,
  type AssuranceVerdict,
} from '../common.js';
import {
  OWNER_CONTRACT_WAITING_SEAMS,
  consumeOwnerContract,
  type OwnerContractEnvelope,
  type OwnerContractExpectation,
} from '../adapters/ownerContracts.js';
import type { ExecutionLeaseProjection } from '../projections/operationalTruth.js';

export const CONTROLLER_POSTURES = Object.freeze([
  'OBSERVE_ONLY',
  'NO_NEW_EXPOSURE',
  'RISK_REDUCTION_ONLY',
] as const);
export type ControllerPosture = (typeof CONTROLLER_POSTURES)[number];

export interface ControllerProposal {
  readonly schema: 'PRODUCT_ASSURANCE_CONTROLLER_PROPOSAL_V1';
  readonly proposalId: string;
  readonly controllerId: string;
  readonly controllerClass: 'PRIMARY_DETERMINISTIC' | 'ADVANCED';
  readonly inputRevision: string;
  readonly actionId: string;
  readonly actionDigest: string;
  readonly requiredEvidenceEnvelopeId: string | null;
  readonly proposedAtMs: number;
  readonly expiresAtMs: number;
  readonly posture: ControllerPosture;
  readonly maximumNewExposureUnits: number;
  readonly requestsMoneyAuthority: boolean;
  readonly estimatedCostUnits: number;
  readonly estimatedResourceUnits: number;
  readonly requiredFenceOwnerId: string | null;
  readonly requiredFenceEpoch: number | null;
}

/**
 * Opaque projection published by the Action Evidence owner. Product Assurance
 * checks only the accepted tuple and proposal relationship. Every other field
 * remains satellite-owned and opaque to this gate.
 */
export interface ActionEvidenceOwnerProjection {
  readonly decision: 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';
  readonly envelopeId: string;
  readonly actionId: string;
  readonly actionRevision: string;
  readonly actionDigest: string;
}

export interface AdvancedControllerEvidenceBinding {
  readonly boundProposalId: string;
  readonly boundInputRevision: string;
  readonly boundActionId: string;
  readonly boundActionDigest: string;
  readonly boundEnvelopeId: string;
  readonly ownerContract: Readonly<OwnerContractEnvelope<ActionEvidenceOwnerProjection>> | null;
}

/**
 * Verifier-side values installed by the trusted composition owner. They are
 * deliberately not carried by the evidence artifact they authenticate.
 */
export interface TrustedActionEvidenceExpectation {
  readonly releaseId: string;
  readonly digestAlgorithm: 'sha256';
  readonly digest: string;
}

export interface AdvancedControllerGateInput {
  readonly nowMs: number;
  readonly primary: Readonly<ControllerProposal>;
  readonly advanced: Readonly<ControllerProposal> | null;
  readonly advancedEvidence: Readonly<AdvancedControllerEvidenceBinding> | null;
  readonly trustedActionEvidenceExpectation: Readonly<TrustedActionEvidenceExpectation> | null;
  readonly remainingCostUnits: number;
  readonly remainingResourceUnits: number;
  readonly executionLease: Readonly<ExecutionLeaseProjection>;
}

export interface AdvancedControllerGateDecision {
  readonly verdict: AssuranceVerdict;
  readonly selection: 'ADVANCED' | 'PRIMARY_BASELINE' | 'SAFE_BASELINE';
  readonly selectedProposalId: string | null;
  readonly selectedControllerId: string | null;
  readonly selectedPosture: ControllerPosture;
  readonly advancedAccepted: boolean;
  readonly fallbackApplied: boolean;
  readonly reasonCodes: readonly string[];
  readonly authorityGranted: false;
  readonly executionAuthorized: false;
  readonly moneyAuthorityGranted: false;
}

function validateProposal(
  proposal: Readonly<ControllerProposal>,
  expectedClass: ControllerProposal['controllerClass'],
): void {
  if (proposal.schema !== 'PRODUCT_ASSURANCE_CONTROLLER_PROPOSAL_V1') {
    throw new TypeError('controller proposal schema unsupported');
  }
  if (proposal.controllerClass !== expectedClass) throw new TypeError(`controller proposal must be ${expectedClass}`);
  assertIdentifier(proposal.proposalId, 'proposal.proposalId');
  assertIdentifier(proposal.controllerId, 'proposal.controllerId');
  assertIdentifier(proposal.inputRevision, 'proposal.inputRevision');
  assertIdentifier(proposal.actionId, 'proposal.actionId');
  assertDigestOrNull(proposal.actionDigest, 'proposal.actionDigest');
  if (proposal.actionDigest === null) throw new TypeError('proposal.actionDigest is required');
  if (proposal.requiredEvidenceEnvelopeId !== null) assertIdentifier(proposal.requiredEvidenceEnvelopeId, 'proposal.requiredEvidenceEnvelopeId');
  assertUtcMs(proposal.proposedAtMs, 'proposal.proposedAtMs');
  assertUtcMs(proposal.expiresAtMs, 'proposal.expiresAtMs');
  if (proposal.expiresAtMs <= proposal.proposedAtMs) throw new TypeError('controller proposal expiry must follow proposal time');
  if (!(CONTROLLER_POSTURES as readonly string[]).includes(proposal.posture)) throw new TypeError('controller proposal posture unsupported');
  assertSafeNonNegativeInteger(proposal.maximumNewExposureUnits, 'proposal.maximumNewExposureUnits');
  assertSafeNonNegativeInteger(proposal.estimatedCostUnits, 'proposal.estimatedCostUnits');
  assertSafeNonNegativeInteger(proposal.estimatedResourceUnits, 'proposal.estimatedResourceUnits');
  if (typeof proposal.requestsMoneyAuthority !== 'boolean') throw new TypeError('proposal.requestsMoneyAuthority must be boolean');
  if (proposal.requiredFenceOwnerId !== null) assertIdentifier(proposal.requiredFenceOwnerId, 'proposal.requiredFenceOwnerId');
  if (proposal.requiredFenceEpoch !== null) assertSafeNonNegativeInteger(proposal.requiredFenceEpoch, 'proposal.requiredFenceEpoch');
  if ((proposal.requiredFenceOwnerId === null) !== (proposal.requiredFenceEpoch === null)) {
    throw new TypeError('proposal fence owner and epoch must be supplied together');
  }
  if (expectedClass === 'ADVANCED' && proposal.requiredEvidenceEnvelopeId === null) {
    throw new TypeError('advanced proposal requires an action evidence envelope binding');
  }
}

function assertStringArray(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  for (const [index, entry] of value.entries()) assertIdentifier(entry, `${label}[${index}]`);
  if (value.join('\n') !== sortedUnique(value).join('\n')) throw new TypeError(`${label} must be sorted and unique`);
}

function validateExecutionLease(lease: Readonly<ExecutionLeaseProjection>): void {
  if (!isPlainRecord(lease)) throw new TypeError('executionLease must be a plain object');
  if (!(ASSURANCE_VERDICTS as readonly unknown[]).includes(lease.verdict)) throw new TypeError('executionLease.verdict unsupported');
  if (typeof lease.active !== 'boolean') throw new TypeError('executionLease.active must be boolean');
  if (lease.ownerId !== null) assertIdentifier(lease.ownerId, 'executionLease.ownerId');
  if (lease.epoch !== null) assertSafeNonNegativeInteger(lease.epoch, 'executionLease.epoch');
  if (lease.processIdentity !== null) assertIdentifier(lease.processIdentity, 'executionLease.processIdentity');
  if (lease.releaseIdentity !== null) assertIdentifier(lease.releaseIdentity, 'executionLease.releaseIdentity');
  if (lease.renewedAtMs !== null) assertUtcMs(lease.renewedAtMs, 'executionLease.renewedAtMs');
  if (lease.expiresAtMs !== null) assertUtcMs(lease.expiresAtMs, 'executionLease.expiresAtMs');
  assertUtcMs(lease.evaluatedAtMs, 'executionLease.evaluatedAtMs');
  assertStringArray(lease.reasonCodes, 'executionLease.reasonCodes');
  const completeIdentity = lease.ownerId !== null && lease.epoch !== null
    && lease.processIdentity !== null && lease.releaseIdentity !== null
    && lease.renewedAtMs !== null && lease.expiresAtMs !== null;
  if (lease.active !== (lease.verdict === 'PASS')) throw new TypeError('executionLease active state must agree with its verdict');
  if (lease.active && !completeIdentity) throw new TypeError('active executionLease requires complete identity');
  if (lease.verdict === 'PASS' && lease.reasonCodes.length > 0) throw new TypeError('passing executionLease cannot carry reasons');
  if (lease.verdict !== 'PASS' && lease.reasonCodes.length === 0) throw new TypeError('non-passing executionLease requires a reason');
  if (lease.renewedAtMs !== null && lease.expiresAtMs !== null && lease.expiresAtMs <= lease.renewedAtMs) {
    throw new TypeError('executionLease lifetime is invalid');
  }
}

function fenceMatches(proposal: Readonly<ControllerProposal>, lease: Readonly<ExecutionLeaseProjection>): boolean {
  if (proposal.requiredFenceOwnerId === null || proposal.requiredFenceEpoch === null) return true;
  return lease.verdict === 'PASS' && lease.active
    && lease.ownerId === proposal.requiredFenceOwnerId && lease.epoch === proposal.requiredFenceEpoch;
}

function primaryIsSafeBaseline(primary: Readonly<ControllerProposal>, input: Readonly<AdvancedControllerGateInput>): boolean {
  return primary.maximumNewExposureUnits === 0
    && !primary.requestsMoneyAuthority
    && input.nowMs >= primary.proposedAtMs
    && input.nowMs < primary.expiresAtMs
    && primary.estimatedCostUnits <= input.remainingCostUnits
    && primary.estimatedResourceUnits <= input.remainingResourceUnits
    && (primary.requiredFenceOwnerId === null
      || (input.executionLease.evaluatedAtMs <= input.nowMs
        && input.executionLease.expiresAtMs !== null
        && input.nowMs < input.executionLease.expiresAtMs))
    && fenceMatches(primary, input.executionLease);
}

function expectedActionEvidenceSubject(proposal: Readonly<ControllerProposal>): string {
  return `ACTION:${proposal.actionId}:${proposal.inputRevision}:${proposal.requiredEvidenceEnvelopeId ?? 'MISSING'}`;
}

function validateOwnerBindingProjection(value: Readonly<ActionEvidenceOwnerProjection>): void {
  if (!isPlainRecord(value)) throw new TypeError('action evidence owner projection must be a plain object');
  const exactKeys = ['actionDigest', 'actionId', 'actionRevision', 'decision', 'envelopeId'];
  if (Object.keys(value).sort().join('\n') !== exactKeys.join('\n')) {
    throw new TypeError('action evidence owner projection field set is unsupported');
  }
  if (!['ACCEPTED', 'REJECTED', 'UNKNOWN'].includes(value.decision)) {
    throw new TypeError('ownerProjection.decision is unsupported');
  }
  assertIdentifier(value.envelopeId, 'ownerProjection.envelopeId');
  assertIdentifier(value.actionId, 'ownerProjection.actionId');
  assertIdentifier(value.actionRevision, 'ownerProjection.actionRevision');
  assertDigestOrNull(value.actionDigest, 'ownerProjection.actionDigest');
  if (value.actionDigest === null) throw new TypeError('ownerProjection.actionDigest is required');
}

function acceptedActionEvidenceExpectation(
  trusted: Readonly<TrustedActionEvidenceExpectation>,
  proposal: Readonly<ControllerProposal>,
): Readonly<OwnerContractExpectation> {
  assertIdentifier(trusted.releaseId, 'trustedActionEvidenceExpectation.releaseId');
  if (trusted.digestAlgorithm !== 'sha256') {
    throw new TypeError('trustedActionEvidenceExpectation.digestAlgorithm must be sha256');
  }
  assertDigestOrNull(trusted.digest, 'trustedActionEvidenceExpectation.digest');
  if (trusted.digest === null) throw new TypeError('trustedActionEvidenceExpectation.digest is required');
  return Object.freeze({
    surface: 'ACTION_EVIDENCE',
    ownerId: OWNER_CONTRACT_WAITING_SEAMS.ACTION_EVIDENCE.ownerId,
    releaseId: trusted.releaseId,
    subjectId: expectedActionEvidenceSubject(proposal),
    digestAlgorithm: 'sha256',
    digest: trusted.digest,
  });
}

export function evaluateAdvancedControllerGate(
  input: Readonly<AdvancedControllerGateInput>,
): Readonly<AdvancedControllerGateDecision> {
  assertUtcMs(input.nowMs, 'input.nowMs');
  assertSafeNonNegativeInteger(input.remainingCostUnits, 'input.remainingCostUnits');
  assertSafeNonNegativeInteger(input.remainingResourceUnits, 'input.remainingResourceUnits');
  validateExecutionLease(input.executionLease);
  validateProposal(input.primary, 'PRIMARY_DETERMINISTIC');

  const primarySafe = primaryIsSafeBaseline(input.primary, input);
  if (input.advanced === null) {
    return Object.freeze({
      verdict: 'UNKNOWN', selection: primarySafe ? 'PRIMARY_BASELINE' : 'SAFE_BASELINE',
      selectedProposalId: primarySafe ? input.primary.proposalId : null,
      selectedControllerId: primarySafe ? input.primary.controllerId : null,
      selectedPosture: primarySafe ? input.primary.posture : 'NO_NEW_EXPOSURE',
      advancedAccepted: false, fallbackApplied: true,
      reasonCodes: Object.freeze(['ADVANCED_CONTROLLER_UNAVAILABLE', ...(primarySafe ? [] : ['PRIMARY_BASELINE_UNSAFE'])]),
      authorityGranted: false, executionAuthorized: false, moneyAuthorityGranted: false,
    });
  }

  validateProposal(input.advanced, 'ADVANCED');
  const advanced = input.advanced;
  const failed: string[] = [];
  const unknown: string[] = [];
  if (input.executionLease.evaluatedAtMs > input.nowMs) failed.push('EXECUTION_LEASE_PROJECTION_FROM_FUTURE');
  if (input.executionLease.expiresAtMs !== null && input.nowMs >= input.executionLease.expiresAtMs) failed.push('EXECUTION_LEASE_PROJECTION_EXPIRED');
  if (input.nowMs < advanced.proposedAtMs) failed.push('ADVANCED_PROPOSAL_NOT_YET_VALID');
  if (input.nowMs >= advanced.expiresAtMs) failed.push('ADVANCED_PROPOSAL_EXPIRED');
  if (advanced.inputRevision !== input.primary.inputRevision) failed.push('ADVANCED_INPUT_REVISION_NOT_CURRENT');
  if (advanced.maximumNewExposureUnits !== 0) failed.push('ADVANCED_EXPOSURE_EXPANSION_FORBIDDEN');
  if (advanced.requestsMoneyAuthority) failed.push('ADVANCED_MONEY_AUTHORITY_FORBIDDEN');
  if (advanced.estimatedCostUnits > input.remainingCostUnits) failed.push('ADVANCED_COST_BUDGET_EXCEEDED');
  if (advanced.estimatedResourceUnits > input.remainingResourceUnits) failed.push('ADVANCED_RESOURCE_BUDGET_EXCEEDED');

  const evidence = input.advancedEvidence;
  if (evidence === null) {
    unknown.push('ADVANCED_EVIDENCE_MISSING');
  } else {
    if (!isPlainRecord(evidence)) throw new TypeError('advancedEvidence must be a plain object');
    for (const [label, value] of [
      ['boundProposalId', evidence.boundProposalId], ['boundInputRevision', evidence.boundInputRevision],
      ['boundActionId', evidence.boundActionId], ['boundEnvelopeId', evidence.boundEnvelopeId],
    ] as const) assertIdentifier(value, `advancedEvidence.${label}`);
    assertDigestOrNull(evidence.boundActionDigest, 'advancedEvidence.boundActionDigest');
    if (evidence.boundActionDigest === null) throw new TypeError('advancedEvidence.boundActionDigest is required');

    if (evidence.boundProposalId !== advanced.proposalId) failed.push('ADVANCED_EVIDENCE_PROPOSAL_MISMATCH');
    if (evidence.boundInputRevision !== advanced.inputRevision) failed.push('ADVANCED_EVIDENCE_REVISION_MISMATCH');
    if (evidence.boundActionId !== advanced.actionId) failed.push('ADVANCED_EVIDENCE_ACTION_MISMATCH');
    if (evidence.boundActionDigest !== advanced.actionDigest) failed.push('ADVANCED_EVIDENCE_ACTION_DIGEST_MISMATCH');
    if (evidence.boundEnvelopeId !== advanced.requiredEvidenceEnvelopeId) failed.push('ADVANCED_EVIDENCE_ENVELOPE_BINDING_MISMATCH');
    const trustedExpectation = input.trustedActionEvidenceExpectation;
    if (trustedExpectation === null) {
      unknown.push('ADVANCED_ACTION_EVIDENCE_TRUSTED_EXPECTATION_MISSING');
    } else {
      const expectation = acceptedActionEvidenceExpectation(trustedExpectation, advanced);
      const consumption = consumeOwnerContract(evidence.ownerContract, expectation);
      if (consumption.state === 'WAITING') unknown.push('ADVANCED_ACTION_EVIDENCE_OWNER_CONTRACT_WAITING');
      if (consumption.state === 'REJECTED') {
        failed.push('ADVANCED_ACTION_EVIDENCE_OWNER_CONTRACT_REJECTED');
        failed.push(...consumption.reasonCodes.map((reason) => `ADVANCED_${reason}`));
      }
      if (consumption.state === 'CONSUMED' && consumption.payload !== null) {
        const result = consumption.payload;
        validateOwnerBindingProjection(result);
        if (result.actionId !== advanced.actionId) failed.push('ADVANCED_ACTION_RESULT_UNRELATED');
        if (result.actionRevision !== advanced.inputRevision) failed.push('ADVANCED_ACTION_RESULT_REVISION_MISMATCH');
        if (result.actionDigest !== advanced.actionDigest) failed.push('ADVANCED_ACTION_RESULT_DIGEST_MISMATCH');
        if (result.envelopeId !== advanced.requiredEvidenceEnvelopeId) failed.push('ADVANCED_ACTION_RESULT_ENVELOPE_MISMATCH');
        if (result.decision === 'REJECTED') failed.push('ADVANCED_ACTION_EVIDENCE_OWNER_REJECTED');
        if (result.decision === 'UNKNOWN') unknown.push('ADVANCED_ACTION_EVIDENCE_OWNER_UNKNOWN');
      }
    }
  }

  if (advanced.requiredFenceOwnerId === null || advanced.requiredFenceEpoch === null) {
    unknown.push('ADVANCED_FENCE_BINDING_MISSING');
  } else if (input.executionLease.verdict === 'FAIL') {
    failed.push('ADVANCED_EXECUTION_FENCE_FAILED');
  } else if (input.executionLease.verdict === 'UNKNOWN' || !input.executionLease.active) {
    unknown.push('ADVANCED_EXECUTION_FENCE_UNKNOWN');
  } else {
    if (input.executionLease.ownerId !== advanced.requiredFenceOwnerId) failed.push('ADVANCED_EXECUTION_FENCE_OWNER_MISMATCH');
    if (input.executionLease.epoch !== advanced.requiredFenceEpoch) failed.push('ADVANCED_EXECUTION_FENCE_EPOCH_MISMATCH');
  }

  if (failed.length === 0 && unknown.length === 0) {
    return Object.freeze({
      verdict: 'PASS', selection: 'ADVANCED', selectedProposalId: advanced.proposalId,
      selectedControllerId: advanced.controllerId, selectedPosture: advanced.posture,
      advancedAccepted: true, fallbackApplied: false, reasonCodes: Object.freeze([]),
      authorityGranted: false, executionAuthorized: false, moneyAuthorityGranted: false,
    });
  }
  if (!primarySafe) failed.push('PRIMARY_BASELINE_UNSAFE');
  return Object.freeze({
    verdict: failed.length > 0 ? 'FAIL' : 'UNKNOWN',
    selection: primarySafe ? 'PRIMARY_BASELINE' : 'SAFE_BASELINE',
    selectedProposalId: primarySafe ? input.primary.proposalId : null,
    selectedControllerId: primarySafe ? input.primary.controllerId : null,
    selectedPosture: primarySafe ? input.primary.posture : 'NO_NEW_EXPOSURE',
    advancedAccepted: false, fallbackApplied: true,
    reasonCodes: sortedUnique([...failed, ...unknown]),
    authorityGranted: false, executionAuthorized: false, moneyAuthorityGranted: false,
  });
}

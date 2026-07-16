import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  OWNER_CONTRACT_WAITING_SEAMS,
  bindOwnerContract,
  computeOwnerContractTupleDigest,
  evaluateAdvancedControllerGate,
} from '../../dist/productAssurance/index.js';

const NOW = 1_783_900_800_000;
const OWNER_ID = OWNER_CONTRACT_WAITING_SEAMS.ACTION_EVIDENCE.ownerId;
const RELEASE_ID = 'ACTION_SATELLITE_ACCEPTED_RELEASE';

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function proposals() {
  const primary = Object.freeze({
    schema: 'PRODUCT_ASSURANCE_CONTROLLER_PROPOSAL_V1',
    proposalId: 'PROPOSAL_PRIMARY',
    controllerId: 'PRIMARY_KERNEL',
    controllerClass: 'PRIMARY_DETERMINISTIC',
    inputRevision: 'INPUT_REVISION_1',
    actionId: 'ACTION_PRIMARY',
    actionDigest: digest('primary-action'),
    requiredEvidenceEnvelopeId: null,
    proposedAtMs: NOW - 1_000,
    expiresAtMs: NOW + 10_000,
    posture: 'NO_NEW_EXPOSURE',
    maximumNewExposureUnits: 0,
    requestsMoneyAuthority: false,
    estimatedCostUnits: 1,
    estimatedResourceUnits: 1,
    requiredFenceOwnerId: null,
    requiredFenceEpoch: null,
  });
  return Object.freeze({
    primary,
    advanced: Object.freeze({
      ...primary,
      proposalId: 'PROPOSAL_ADVANCED',
      controllerId: 'ADVANCED_CONTROLLER',
      controllerClass: 'ADVANCED',
      actionId: 'ACTION_ADVANCED',
      actionDigest: digest('advanced-action'),
      requiredEvidenceEnvelopeId: 'ENVELOPE_ADVANCED',
      requiredFenceOwnerId: 'EXECUTION_OWNER',
      requiredFenceEpoch: 7,
    }),
  });
}

function subjectFor(advanced) {
  return `ACTION:${advanced.actionId}:${advanced.inputRevision}:${advanced.requiredEvidenceEnvelopeId}`;
}

function ownerContractFor(advanced, {
  payloadOverrides = {},
  surface = 'ACTION_EVIDENCE',
  ownerId = OWNER_ID,
  releaseId = RELEASE_ID,
  subjectId = subjectFor(advanced),
} = {}) {
  const payload = Object.freeze({
    decision: 'ACCEPTED',
    envelopeId: advanced.requiredEvidenceEnvelopeId,
    actionId: advanced.actionId,
    actionRevision: advanced.inputRevision,
    actionDigest: advanced.actionDigest,
    ...payloadOverrides,
  });
  return bindOwnerContract({ surface, ownerId, releaseId, subjectId }, payload);
}

function evidenceFor(advanced, ownerContract) {
  return Object.freeze({
    boundProposalId: advanced.proposalId,
    boundInputRevision: advanced.inputRevision,
    boundActionId: advanced.actionId,
    boundActionDigest: advanced.actionDigest,
    boundEnvelopeId: advanced.requiredEvidenceEnvelopeId,
    ownerContract,
  });
}

function gateFixture(options = {}) {
  const { primary, advanced } = proposals();
  const ownerContract = options.ownerContract ?? ownerContractFor(advanced, options.ownerOptions);
  const trustedContract = options.trustedContract ?? ownerContract;
  return Object.freeze({
    input: Object.freeze({
      nowMs: NOW,
      primary,
      advanced,
      advancedEvidence: evidenceFor(advanced, ownerContract),
      trustedActionEvidenceExpectation: Object.freeze({
        releaseId: trustedContract.tuple.releaseId,
        digestAlgorithm: 'sha256',
        digest: trustedContract.tuple.digest,
      }),
      remainingCostUnits: 10,
      remainingResourceUnits: 10,
      executionLease: Object.freeze({
        verdict: 'PASS',
        active: true,
        ownerId: 'EXECUTION_OWNER',
        epoch: 7,
        processIdentity: 'PROCESS_1',
        releaseIdentity: 'EXECUTION_RELEASE_1',
        renewedAtMs: NOW - 1_000,
        expiresAtMs: NOW + 10_000,
        evaluatedAtMs: NOW,
        reasonCodes: Object.freeze([]),
      }),
    }),
    primary,
    advanced,
    ownerContract,
  });
}

test('gate selection derives from the trusted owner decision', () => {
  const { advanced } = proposals();
  const ownerContract = ownerContractFor(advanced);
  const { input } = gateFixture({ ownerContract });
  const result = evaluateAdvancedControllerGate(input);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.selection, 'ADVANCED');
  assert.equal(result.advancedAccepted, true);
  assert.equal(result.authorityGranted, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.moneyAuthorityGranted, false);

  for (const [decision, expectedVerdict, expectedReason] of [
    ['REJECTED', 'FAIL', 'ADVANCED_ACTION_EVIDENCE_OWNER_REJECTED'],
    ['UNKNOWN', 'UNKNOWN', 'ADVANCED_ACTION_EVIDENCE_OWNER_UNKNOWN'],
  ]) {
    const decisionContract = ownerContractFor(advanced, { payloadOverrides: { decision } });
    const fixture = gateFixture({ ownerContract: decisionContract });
    const decisionResult = evaluateAdvancedControllerGate(fixture.input);
    assert.equal(decisionResult.verdict, expectedVerdict);
    assert.equal(decisionResult.selection, 'PRIMARY_BASELINE');
    assert.ok(decisionResult.reasonCodes.includes(expectedReason));
  }
});

test('paired hostile envelope and legacy caller expectation cannot replace trusted release or digest', () => {
  const canonical = gateFixture();
  const forged = ownerContractFor(canonical.advanced, {
    releaseId: 'ATTACKER_RELEASE',
    payloadOverrides: { decision: 'REJECTED' },
  });
  const hostileEvidence = Object.freeze({
    ...evidenceFor(canonical.advanced, forged),
    ownerContractExpectation: Object.freeze({
      surface: 'ACTION_EVIDENCE',
      ownerId: OWNER_ID,
      releaseId: forged.tuple.releaseId,
      subjectId: forged.tuple.subjectId,
      digestAlgorithm: 'sha256',
      digest: forged.tuple.digest,
    }),
  });
  const result = evaluateAdvancedControllerGate({
    ...canonical.input,
    advancedEvidence: hostileEvidence,
  });
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.selection, 'PRIMARY_BASELINE');
  assert.ok(result.reasonCodes.includes('ADVANCED_OWNER_CONTRACT_RELEASE_MISMATCH'));
  assert.ok(result.reasonCodes.includes('ADVANCED_OWNER_CONTRACT_DIGEST_MISMATCH'));
});

test('canonical action surface, owner, and derived subject cannot be substituted', () => {
  const canonical = gateFixture();
  const substitutedOwnerTuple = Object.freeze({
    ...canonical.ownerContract.tuple,
    ownerId: 'ATTACKER_OWNER',
  });
  const substitutedOwnerContract = Object.freeze({
    ...canonical.ownerContract,
    tuple: substitutedOwnerTuple,
    tupleDigest: computeOwnerContractTupleDigest(substitutedOwnerTuple),
  });
  const cases = [
    {
      label: 'surface',
      ownerContract: ownerContractFor(canonical.advanced, {
        surface: 'ASSURANCE_CASE',
        ownerId: OWNER_CONTRACT_WAITING_SEAMS.ASSURANCE_CASE.ownerId,
      }),
      reason: 'ADVANCED_OWNER_CONTRACT_SURFACE_MISMATCH',
    },
    {
      label: 'owner',
      ownerContract: substitutedOwnerContract,
      reason: 'ADVANCED_OWNER_CONTRACT_OWNER_MISMATCH',
    },
    {
      label: 'subject',
      ownerContract: ownerContractFor(canonical.advanced, { subjectId: 'ACTION:OTHER:REVISION:ENVELOPE' }),
      reason: 'ADVANCED_OWNER_CONTRACT_SUBJECT_MISMATCH',
    },
  ];
  for (const hostile of cases) {
    const result = evaluateAdvancedControllerGate({
      ...canonical.input,
      advancedEvidence: evidenceFor(canonical.advanced, hostile.ownerContract),
    });
    assert.equal(result.verdict, 'FAIL', hostile.label);
    assert.ok(result.reasonCodes.includes(hostile.reason), hostile.label);
  }
});

test('missing trusted expectation remains UNKNOWN and cannot select the advanced controller', () => {
  const { input } = gateFixture();
  const result = evaluateAdvancedControllerGate({
    ...input,
    trustedActionEvidenceExpectation: null,
  });
  assert.equal(result.verdict, 'UNKNOWN');
  assert.equal(result.selection, 'PRIMARY_BASELINE');
  assert.equal(result.advancedAccepted, false);
  assert.ok(result.reasonCodes.includes('ADVANCED_ACTION_EVIDENCE_TRUSTED_EXPECTATION_MISSING'));
});

test('proposal compatibility and execution fencing remain local fail-closed checks', () => {
  const { advanced } = proposals();
  const unrelatedContract = ownerContractFor(advanced, {
    payloadOverrides: { actionId: 'ACTION_UNRELATED' },
  });
  const unrelated = gateFixture({ ownerContract: unrelatedContract });
  const unrelatedResult = evaluateAdvancedControllerGate(unrelated.input);
  assert.equal(unrelatedResult.verdict, 'FAIL');
  assert.ok(unrelatedResult.reasonCodes.includes('ADVANCED_ACTION_RESULT_UNRELATED'));

  const canonical = gateFixture();
  const fencedResult = evaluateAdvancedControllerGate({
    ...canonical.input,
    executionLease: Object.freeze({ ...canonical.input.executionLease, epoch: 8 }),
  });
  assert.equal(fencedResult.verdict, 'FAIL');
  assert.ok(fencedResult.reasonCodes.includes('ADVANCED_EXECUTION_FENCE_EPOCH_MISMATCH'));
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  L12_CRASH_FAULT_CUTS,
  deriveRecoveryCampaignTraceDigest,
  projectExposureRecoverySnapshot,
} from '../../../dist/liveEdge/adapters/exposureRecoveryProjection/index.js';
import {
  checkpointReverseBasisLifecycle,
  restoreReverseBasisLifecycle,
} from '../../../dist/liveEdge/adapters/reverseBasisLifecycle/index.js';
import {
  baseInput,
  run as runReverseBasisOwner,
  standardLifecycleEvents,
} from '../reverseBasisLifecycle/fixtures.mjs';
import { completeInput, subject } from './fixtures.mjs';

function seal(campaign) {
  const { traceDigest: _discarded, ...material } = campaign;
  return { ...material, traceDigest: deriveRecoveryCampaignTraceDigest(material) };
}

function reverseSubject(input, identity) {
  input.subject = identity;
  input.canonicalTruth = { ...input.canonicalTruth, subject: identity };
  input.chain = input.chain.map((stage) => ({ ...stage, subject: identity }));
  for (const key of ['riskRecheck', 'control', 'exposure', 'capital', 'reconciliation', 'outstanding', 'recovery']) {
    input[key] = { ...input[key], subject: identity };
  }
  input.reconciliation = { ...input.reconciliation, owner: 'OWNER_INJECTED_RECONCILIATION_EVIDENCE' };
  input.outstanding = { ...input.outstanding, owner: 'OWNER_INJECTED_RECONCILIATION_EVIDENCE' };
  input.campaigns = input.campaigns.map((campaign) => seal({ ...campaign, subject: identity }));
  return input;
}

test('chaos kill at every valid L10 durable state cut replays without duplicate mutation or hidden liability', () => {
  const events = standardLifecycleEvents();
  const owner = runReverseBasisOwner({ ...baseInput(), events });
  assert.equal(owner.stage, 'CLOSED');
  assert.equal(owner.exposure.grossOpenQuantity, '0');
  assert.equal(owner.exposure.totalLiability, '0');
  assert.equal(owner.openOrderRefs.length, 0);
  assert.equal(owner.ambiguousMutationRefs.length, 0);
  assert.equal(owner.unmatchedFillRefs.length, 0);

  const identity = subject({
    strategy: 'REVERSE_BASIS',
    proposalId: owner.ticket.basisProposalId,
    mandateId: owner.ticket.ownerChain.mandateId,
    reservationId: owner.ticket.ownerChain.capitalReservationId,
    approvalId: owner.ticket.ownerChain.operatorApprovalId,
    planOrLifecycleId: owner.ticket.ticketId,
    correlationId: owner.ticket.ownerChain.correlationId,
    accountRealmId: owner.ticket.account.accountRealmId,
    symbol: owner.ticket.account.symbol,
  });
  const input = reverseSubject(completeInput(), identity);
  const index = input.campaigns.findIndex((entry) => entry.scenario === 'SERVER_CRASH_EVERY_TICKET_STATE');
  const mutationIdentities = owner.orders.map((order) => order.accountOrderId);
  const terminalOutstandingReferences = [
    ...owner.openOrderRefs,
    ...owner.ambiguousMutationRefs,
    ...owner.unmatchedFillRefs,
  ];
  const cutEventCounts = [0, 2, 3, 4, 5, 6, 7, 8, 9];
  const replayWitnesses = L12_CRASH_FAULT_CUTS.map((faultCut, cutIndex) => {
    const cut = runReverseBasisOwner({
      ...baseInput(),
      events: events.slice(0, cutEventCounts[cutIndex]),
    });
    const checkpoint = checkpointReverseBasisLifecycle(cut);
    const restored = restoreReverseBasisLifecycle(checkpoint);
    assert.deepEqual(restored, cut, faultCut);
    const replayedCut = runReverseBasisOwner({
      ...baseInput(),
      events: events.slice(0, cutEventCounts[cutIndex]),
    });
    assert.equal(replayedCut.stateRevision, cut.stateRevision, faultCut);
    const replayedTerminal = runReverseBasisOwner({ ...baseInput(), events });
    assert.equal(replayedTerminal.stateRevision, owner.stateRevision, faultCut);
    assert.equal(replayedTerminal.stage, 'CLOSED', faultCut);
    assert.equal(replayedTerminal.exposure.grossOpenQuantity, '0', faultCut);
    assert.equal(replayedTerminal.exposure.totalLiability, '0', faultCut);
    assert.deepEqual(replayedTerminal.openOrderRefs, [], faultCut);
    assert.deepEqual(replayedTerminal.ambiguousMutationRefs, [], faultCut);
    assert.deepEqual(replayedTerminal.unmatchedFillRefs, [], faultCut);
    const before = cut.orders.map((order) => order.accountOrderId);
    assert.equal(new Set(before).size, before.length, faultCut);
    assert.ok(before.every((mutationId) => mutationIdentities.includes(mutationId)), faultCut);
    return {
      faultCut,
      ownerState: cut.stage,
      checkpointRevision: checkpoint.checkpointRevision,
      cutStateRevision: cut.stateRevision,
      restoredStateRevision: restored.stateRevision,
      terminalStateRevision: replayedTerminal.stateRevision,
      mutationIdentitiesBefore: before,
      terminalMutationIdentities: mutationIdentities,
      terminalResidualExposure: replayedTerminal.exposure.grossOpenQuantity,
      terminalResidualLiability: replayedTerminal.exposure.totalLiability,
      terminalOutstandingReferences: [
        ...replayedTerminal.openOrderRefs,
        ...replayedTerminal.ambiguousMutationRefs,
        ...replayedTerminal.unmatchedFillRefs,
      ],
    };
  });
  input.campaigns[index] = seal({
    ...input.campaigns[index],
    ownerRevision: owner.stateRevision,
    traceRevision: owner.stateRevision,
    initialStateRevision: replayWitnesses[0].cutStateRevision,
    terminalStateRevision: owner.stateRevision,
    mutationIdentities,
    replayObservedMutationIdentities: mutationIdentities,
    terminalResidualExposure: owner.exposure.grossOpenQuantity,
    terminalResidualLiability: owner.exposure.totalLiability,
    terminalOutstandingReferences,
    replayWitnesses,
  });

  const snapshot = projectExposureRecoverySnapshot(input);
  const witness = snapshot.campaigns[index];
  assert.equal(witness.initialStateRevision, replayWitnesses[0].cutStateRevision);
  assert.equal(witness.terminalStateRevision, owner.stateRevision);
  assert.deepEqual(witness.mutationIdentities, mutationIdentities);
  assert.equal(witness.terminalResidualExposure, owner.exposure.grossOpenQuantity);
  assert.equal(witness.terminalResidualLiability, owner.exposure.totalLiability);
  assert.equal(witness.replayWitnesses.length, L12_CRASH_FAULT_CUTS.length);
  assert.deepEqual(witness.replayWitnesses.map((entry) => entry.ownerState), [
    'PREFLIGHTED',
    'LIABILITY_CONFIRMED',
    'HEDGE_WORKING',
    'OPEN',
    'EXITING',
    'EXITING',
    'REPAYING',
    'REPAYING',
    'CLOSED',
  ]);
});

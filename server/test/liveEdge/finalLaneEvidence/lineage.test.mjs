import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FINAL_LANE_ACCEPTED_IDENTITIES,
  projectFinalLaneEvidence,
} from '../../../dist/liveEdge/adapters/finalLaneEvidence/index.js';
import {
  projectExposureRecoverySnapshot,
} from '../../../dist/liveEdge/adapters/exposureRecoveryProjection/index.js';
import {
  projectExternalProofEvidence,
} from '../../../dist/liveEdge/adapters/externalProofEvidence/index.js';
import {
  projectMachineGraphEvidence,
} from '../../../dist/liveEdge/adapters/machineGraphEvidence/index.js';
import {
  completeInput as completeL12Input,
} from '../exposureRecoveryProjection/fixtures.mjs';
import {
  completeInput as completeL16Input,
} from '../externalProofEvidence/fixtures.mjs';
import {
  completeInput as completeL13Input,
} from '../machineGraphEvidence/fixtures.mjs';
import { acceptedL16Chain, completeInput } from './fixtures.mjs';

function classification(snapshot, subject) {
  return snapshot.evidence.find((entry) => entry.subject === subject);
}

test('replays the full canonical L16 validator against the original L12 and L13 snapshots', () => {
  const l16Forged = completeInput();
  l16Forged.l16Snapshot = structuredClone(l16Forged.l16Snapshot);
  l16Forged.l16Snapshot.snapshotRevision = 'l16_forged';
  assert.throws(() => projectFinalLaneEvidence(l16Forged), /external-proof evidence snapshot|reproducible/i);

  const l13Forged = completeInput();
  l13Forged.l13Snapshot = structuredClone(l13Forged.l13Snapshot);
  l13Forged.l13Snapshot.snapshotRevision = 'l13_forged';
  assert.throws(() => projectFinalLaneEvidence(l13Forged), /machine-graph|reproducible|snapshot/i);

  const l12Forged = completeInput();
  l12Forged.l12Snapshot = structuredClone(l12Forged.l12Snapshot);
  l12Forged.l12Snapshot.snapshotRevision = 'l12_forged';
  assert.throws(() => projectFinalLaneEvidence(l12Forged), /L12|reproducible|snapshot/i);
});

test('rejects a different valid L12 owner chain instead of accepting revision-shaped evidence', () => {
  const alternateInput = completeL12Input();
  alternateInput.coldStart.completenessRevision = 'different-owner-completeness';
  const alternate = projectExposureRecoverySnapshot(alternateInput);
  const input = completeInput();
  input.l12Snapshot = alternate;
  assert.throws(() => projectFinalLaneEvidence(input), /L12|binding|reproducible|snapshot/i);

  const alternateL13 = projectMachineGraphEvidence(completeL13Input(alternate));
  const alternateL16Input = completeL16Input();
  alternateL16Input.l12Snapshot = alternate;
  alternateL16Input.l13Snapshot = alternateL13;
  alternateL16Input.implementationRevision = FINAL_LANE_ACCEPTED_IDENTITIES.l16ImplementationCommit;
  for (const index of [0, 1, 2]) {
    alternateL16Input.evidence[index].sourceRevision = FINAL_LANE_ACCEPTED_IDENTITIES.l16ImplementationCommit;
  }
  const localChecks = alternateL16Input.evidence[0].checks;
  localChecks.find(({ check }) => check === 'L16_FOCUSED').assertions = 21;
  localChecks.find(({ check }) => check === 'IMPORT_PURITY').assertions = 4;
  localChecks.find(({ check }) => check === 'ACCUMULATED_LIVE_EDGE').assertions = 1_595;
  localChecks.find(({ check }) => check === 'PROTOCOL').assertions = 22;
  localChecks.find(({ check }) => check === 'NPM_TEST').assertions = 377;
  localChecks.find(({ check }) => check === 'TEST_ALL').assertions = 2_479;
  const coherentAlternate = completeInput();
  coherentAlternate.l12Snapshot = alternate;
  coherentAlternate.l13Snapshot = alternateL13;
  coherentAlternate.l16Snapshot = projectExternalProofEvidence(alternateL16Input);
  assert.throws(
    () => projectFinalLaneEvidence(coherentAlternate),
    /exact accepted L12\/L13\/L16 lineage and evidence prefix/,
  );
});

test('binds exact accepted L16 implementation identity and non-authorizing flags', () => {
  for (const mutate of [
    (snapshot) => { snapshot.implementationRevision = 'f'.repeat(40); },
    (snapshot) => { snapshot.sendEligible = true; },
    (snapshot) => { snapshot.readinessProof = true; },
    (snapshot) => { snapshot.deployedProof = true; },
    (snapshot) => { snapshot.livePrivateProof = true; },
    (snapshot) => { snapshot.moneyMutationProof = true; },
  ]) {
    const input = completeInput();
    input.l16Snapshot = structuredClone(input.l16Snapshot);
    mutate(input.l16Snapshot);
    assert.throws(
      () => projectFinalLaneEvidence(input),
      /external-proof|reproducible|accepted non-authorizing|exact L16 implementation revision/i,
    );
  }
  const snapshot = projectFinalLaneEvidence(completeInput());
  assert.equal(
    snapshot.l16Lineage.sourceImplementationRevision,
    FINAL_LANE_ACCEPTED_IDENTITIES.l16ImplementationCommit,
  );

  const inflated = completeInput();
  const inflatedL16Input = completeL16Input();
  inflatedL16Input.implementationRevision = FINAL_LANE_ACCEPTED_IDENTITIES.l16ImplementationCommit;
  for (const index of [0, 1, 2]) {
    inflatedL16Input.evidence[index].sourceRevision = FINAL_LANE_ACCEPTED_IDENTITIES.l16ImplementationCommit;
  }
  inflatedL16Input.evidence[0].checks.find(({ check }) => check === 'L16_FOCUSED').assertions = 22;
  inflated.l16Snapshot = projectExternalProofEvidence(inflatedL16Input);
  assert.throws(
    () => projectFinalLaneEvidence(inflated),
    /exact accepted L12\/L13\/L16 lineage and evidence prefix/,
  );
});

test('inherits FILTER_BLOCKED only from the exact canonical L16 owner verdict', () => {
  const ordinary = projectFinalLaneEvidence(completeInput());
  const blocked = projectFinalLaneEvidence(completeInput({ filterBlocked: true }));
  const ordinaryFilter = classification(ordinary, 'CURRENT_FILTER_ADMISSION');
  const blockedFilter = classification(blocked, 'CURRENT_FILTER_ADMISSION');

  assert.equal(ordinaryFilter.classification, 'UNPROVEN');
  assert.equal(blockedFilter.classification, 'FILTER_BLOCKED');
  assert.equal(blocked.l16Lineage.sourceFilterAdmissionClass, 'FILTER_BLOCKED');
  assert.equal(blocked.l16Lineage.effectiveFilterAdmissionClass, 'FILTER_BLOCKED');
  assert.equal(blocked.productionReadinessProof, false);
  assert.equal(blocked.sendEligible, false);

  const forged = completeInput();
  forged.l16Snapshot = structuredClone(forged.l16Snapshot);
  forged.l16Snapshot.evidence.at(-1).classification = 'FILTER_BLOCKED';
  assert.throws(() => projectFinalLaneEvidence(forged), /external-proof evidence snapshot|reproducible/i);

  const blockedChain = acceptedL16Chain({ filterBlocked: true });
  const ownerResult = blockedChain.l16Snapshot.evidence.at(-1).evidence.ownerResult;
  const validityBounds = [ownerResult.instrumentValidUntilMs, ownerResult.referenceValidUntilMs]
    .filter((value) => value !== null);
  const stale = projectFinalLaneEvidence(completeInput({
    acceptedChain: blockedChain,
    evaluatedAtMs: Math.min(...validityBounds) + 1,
  }));
  const staleFilter = classification(stale, 'CURRENT_FILTER_ADMISSION');
  assert.equal(stale.l16Lineage.sourceFilterAdmissionClass, 'FILTER_BLOCKED');
  assert.equal(stale.l16Lineage.effectiveFilterAdmissionClass, 'UNPROVEN');
  assert.equal(staleFilter.classification, 'UNPROVEN');
  assert.deepEqual(staleFilter.reasonCodes, ['L16_FILTER_OWNER_VERDICT_NOT_CURRENT_AT_L17']);
});

test('preserves L15 satellite, lane wiring and Q/L fan-in as distinct closed truths', () => {
  const snapshot = projectFinalLaneEvidence(completeInput());
  const satellite = classification(snapshot, 'L15_DEPLOYMENT_SATELLITE');
  const wiring = classification(snapshot, 'LANE_RUNTIME_WIRING');
  const combined = classification(snapshot, 'Q_L_COMBINED_CHAIN');

  assert.equal(satellite.classification, 'ACCEPTED_SATELLITE');
  assert.deepEqual(satellite.sourceSubjects, ['L15_DEPLOYMENT_ARTIFACTS']);
  assert.equal(wiring.classification, 'UNWIRED');
  assert.deepEqual(wiring.sourceSubjects, ['LANE_RUNTIME_WIRING']);
  assert.equal(combined.classification, 'DEFERRED_TO_I00');
  assert.deepEqual(combined.sourceSubjects, ['I00_COMBINED_FAN_IN']);
  assert.equal(snapshot.integrationState, 'UNWIRED');
  assert.equal(snapshot.combinedAcceptance, false);
});

test('keeps AWS/Cloudflare, restart, private, signed and live evidence closed', () => {
  const snapshot = projectFinalLaneEvidence(completeInput());
  assert.equal(classification(snapshot, 'AWS_CLOUDFLARE_DEPLOYMENT').classification, 'UNPROVEN');
  assert.equal(classification(snapshot, 'PUBLIC_RUNTIME_OBSERVATION').classification, 'NOT_PERFORMED');
  assert.equal(classification(snapshot, 'SERVICE_RESTART').classification, 'OWNER_GATED');
  assert.equal(classification(snapshot, 'PRIVATE_ACCOUNT_RECONCILIATION').classification, 'OWNER_GATED');
  assert.equal(classification(snapshot, 'SIGNED_TEST_ORDERS').classification, 'PROHIBITED');
  assert.equal(classification(snapshot, 'MARGIN_BORROW_REPAY').classification, 'PROHIBITED');
  assert.equal(classification(snapshot, 'LIVE_EXECUTION').classification, 'PROHIBITED');
  assert.equal(snapshot.deployedProof, false);
  assert.equal(snapshot.livePrivateProof, false);
  assert.equal(snapshot.tradeReadyProof, false);
  assert.equal(snapshot.liveExecution, 'LIVE_EXECUTION_NOT_IMPLEMENTED');
});

test('the accepted L16 fixture binds the receipt-recorded ordinary snapshot revision', () => {
  const chain = acceptedL16Chain();
  assert.equal(chain.l16Snapshot.snapshotRevision, 'l16_d568cea3b66bf198b02c6a37c77acc19');
  assert.equal(chain.l16Snapshot.implementationRevision, FINAL_LANE_ACCEPTED_IDENTITIES.l16ImplementationCommit);
  assert.deepEqual(
    chain.l16Snapshot.evidence.map(({ classification }) => classification),
    [
      'PROVED_LOCAL', 'SYNTHETIC_REPLAY', 'UNWIRED', 'ACCEPTED_SATELLITE',
      'NOT_PERFORMED', 'OWNER_GATED', 'UNPROVEN', 'UNPROVEN', 'OWNER_GATED',
      'PROHIBITED', 'PROHIBITED', 'PROHIBITED', 'PROHIBITED', 'PROHIBITED',
      'PROHIBITED', 'DEFERRED_TO_I00', 'UNPROVEN',
    ],
  );
});

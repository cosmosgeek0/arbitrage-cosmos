import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectExternalProofEvidence,
} from '../../../dist/liveEdge/adapters/externalProofEvidence/index.js';
import {
  projectExposureRecoverySnapshot,
} from '../../../dist/liveEdge/adapters/exposureRecoveryProjection/index.js';
import {
  completeInput as completeL12Input,
} from '../exposureRecoveryProjection/fixtures.mjs';
import { completeInput } from './fixtures.mjs';

function reject(mutator, pattern = /L16|evidence|revision|authorization|gate|schema/i) {
  const input = completeInput();
  mutator(input);
  assert.throws(() => projectExternalProofEvidence(input), pattern);
}

test('requires all eight passing local gates in canonical order with honest counts', () => {
  reject((input) => input.evidence[0].checks.splice(6, 1), /eight exact L16 local gates/);
  reject((input) => input.evidence[0].checks.reverse(), /canonical order/);
  reject((input) => { input.evidence[0].checks[5].assertions = null; }, /positive safe integer/);
  reject((input) => { input.evidence[0].checks[0].assertions = 1; }, /must not fabricate assertions/);
  reject((input) => { input.evidence[0].checks[3].exitCode = 1; }, /canonical order/);
});

test('binds local, replay, and integration evidence to one exact lowercase 40-hex revision', () => {
  for (const bad of ['', 'A'.repeat(40), 'a'.repeat(39), 'a'.repeat(64), 'not-a-commit']) {
    reject((input) => { input.implementationRevision = bad; }, /implementationRevision/);
  }
  for (const index of [0, 1, 2]) {
    reject((input) => { input.evidence[index].sourceRevision = '2'.repeat(40); }, /exact L16 implementation revision/);
  }
});

test('rejects arbitrary runtime authorization classes and incoherent authorization tuples', () => {
  for (const observed of [7, {}, 'LIVE_ORDER']) {
    reject((input) => {
      Object.assign(input.evidence[5], {
        authorizationState: 'WRONG_CLASS', observedActionClass: observed,
        authorizationExpiresAtMs: null,
      });
    }, /closed action-class catalog/);
  }
  reject((input) => { input.evidence[5].expectedActionClass = 'EC2_DEPLOY'; }, /exact subject/);
  reject((input) => { input.evidence[5].observedActionClass = 'EC2_DEPLOY'; }, /MISSING authorization/);
  reject((input) => {
    Object.assign(input.evidence[5], {
      authorizationState: 'EXPIRED', observedActionClass: 'READ_ONLY_PRIVATE_BINANCE_ACCESS',
      authorizationExpiresAtMs: input.evidence[5].checkedAtMs,
    });
  }, /past expiry/);
});

test('enforces exact subject order, one evidence ID, exact record schemas, and L15 identity', () => {
  reject((input) => { input.unexpected = true; }, /input must use its exact closed schema/);
  reject((input) => input.evidence.reverse(), /must cover LOCAL_BUILD_AND_TESTS/);
  reject((input) => { input.evidence[1].evidenceId = input.evidence[0].evidenceId; }, /unique/);
  reject((input) => { input.evidence[2].unexpected = true; }, /exact closed schema/);
  reject((input) => { input.evidence[3].receiptCommit = 'f'.repeat(40); }, /exact accepted L15 satellite/);
  reject((input) => { input.evidence[9].policy = 'LIVE_EXECUTION_NOT_IMPLEMENTED'; }, /exact repository block/);
  reject((input) => { input.evidence[15].wired = true; }, /deferred to I00/);
});

test('replays the full L13 validator against the exact original L12 snapshot', () => {
  reject((input) => {
    input.l13Snapshot = structuredClone(input.l13Snapshot);
    input.l13Snapshot.snapshotRevision = 'l13_forged';
  }, /machine-graph evidence snapshot|reproducible|revision/i);
  reject((input) => {
    input.l12Snapshot = structuredClone(input.l12Snapshot);
    input.l12Snapshot.snapshotRevision = 'l12_forged';
  }, /L12|snapshot|reproducible|revision/i);

  const alternateL12Input = completeL12Input();
  alternateL12Input.coldStart.completenessRevision = 'cold-start-completeness-revision-2';
  const alternateL12 = projectExposureRecoverySnapshot(alternateL12Input);
  reject((input) => { input.l12Snapshot = alternateL12; }, /L12|binding|reproducible|revision/i);
});

test('binds every exact L15 identity and every no-promotion flag', () => {
  for (const field of [
    'receiptCommit', 'receiptTree', 'workCommit', 'receiptBlob', 'receiptRawSha256',
  ]) reject((input) => { input.evidence[3][field] = 'f'.repeat(64); }, /exact accepted L15 satellite/);
  reject((input) => { input.evidence[3].localAssertions += 1; }, /exact accepted L15 satellite/);
  reject((input) => { input.evidence[3].acceptedSatellite = false; }, /cannot promote/);
  for (const field of ['merged', 'wired', 'deployed', 'live']) {
    reject((input) => { input.evidence[3][field] = true; }, /cannot promote/);
  }
});

test('infrastructure health signals remain absence evidence, never runtime proof', () => {
  const snapshot = projectExternalProofEvidence(completeInput());
  assert.equal(snapshot.evidence[6].classification, 'UNPROVEN');
  assert.equal(snapshot.evidence[6].evidence.infrastructureSignal, 'EC2_STATUS_OK_ONLY');
  assert.equal(snapshot.evidence[7].classification, 'UNPROVEN');
  assert.equal(snapshot.evidence[7].evidence.infrastructureSignal, 'TUNNEL_HEALTHY_ONLY');
  assert.equal(snapshot.deployedProof, false);
  assert.equal(snapshot.readinessProof, false);

  reject((input) => { input.evidence[16].infrastructureSignal = 'TUNNEL_HEALTHY_ONLY'; }, /not valid/);
  reject((input) => { input.evidence[6].evidenceState = 'PRESENT'; }, /cannot self-assert/);
});

test('rejects unsafe, non-plain, cyclic, secret-shaped, and oversized inputs', () => {
  reject((input) => { input.loop = input; }, /cycles/);
  reject((input) => {
    Object.defineProperty(input.evidence[1], 'hidden', { enumerable: false, value: true });
  }, /accessors and hidden fields/);
  reject((input) => { input.apiKey = 'x'.repeat(32); }, /sensitive field/);
  reject((input) => { input.evidence[1].reasonCodes = Array.from({ length: 257 }, (_, i) => `R_${i}`); }, /bounded/);
  reject((input) => { input.evidence[1].reasonCodes = ['x'.repeat(16_385)]; }, /oversized string/);
});

test('rejects chronology violations and truth promotion attempts', () => {
  reject((input) => { input.evaluatedAtMs = input.l13Snapshot.assembledAtMs - 1; }, /cannot predate/);
  reject((input) => { input.evidence[4].performed = true; }, /non-performance/);
  reject((input) => { input.evidence[3].merged = true; }, /cannot promote/);
  reject((input) => { input.evidence[2].runtimeCompositionObserved = true; }, /cannot promote/);
  reject((input) => { input.evidence[12].performed = true; }, /must not have been performed/);
});

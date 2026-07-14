import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXTERNAL_PROOF_CLASS_BY_KIND,
  EXTERNAL_PROOF_EVIDENCE_SCHEMA,
  EXTERNAL_PROOF_SUBJECTS,
  projectExternalProofEvidence,
  validateExternalProofEvidenceSnapshot,
} from '../../../dist/liveEdge/adapters/externalProofEvidence/index.js';
import { completeInput } from './fixtures.mjs';

function assertDeeplyFrozen(value) {
  const pending = [value];
  const seen = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    assert.equal(Object.isFrozen(current), true);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(current))) {
      if (Object.hasOwn(descriptor, 'value')) pending.push(descriptor.value);
    }
  }
}

test('projects the exact closed evidence catalog without promoting external truth', () => {
  const input = completeInput();
  const snapshot = projectExternalProofEvidence(input);

  assert.equal(snapshot.schema, EXTERNAL_PROOF_EVIDENCE_SCHEMA);
  assert.equal(snapshot.version, 1);
  assert.match(snapshot.snapshotRevision, /^l16_[a-f0-9]{32}$/);
  assert.equal(snapshot.implementationRevision, input.implementationRevision);
  assert.deepEqual(snapshot.evidence.map(({ subject }) => subject), EXTERNAL_PROOF_SUBJECTS);
  assert.deepEqual(
    snapshot.evidence.map(({ evidence, classification }) => [evidence.kind, classification]),
    snapshot.evidence.map(({ evidence }) => [evidence.kind, EXTERNAL_PROOF_CLASS_BY_KIND[evidence.kind]]),
  );
  assert.equal(snapshot.evidence[0].provesLocal, true);
  assert.equal(snapshot.evidence[1].provesSyntheticReplay, true);
  assert.equal(snapshot.evidence[3].provesAcceptedSatellite, true);
  assert.ok(snapshot.evidence.slice(4).every((entry) => entry.provesLocal === false));
  for (const key of [
    'externalCalls', 'sendEligible', 'deployedProof', 'livePublicProof', 'livePrivateProof',
    'readinessProof', 'moneyMutationProof',
  ]) assert.equal(snapshot[key], false, key);
  assert.equal(snapshot.credentialAccess, 'NONE');
  assert.equal(snapshot.runnerAuthority, 'NONE');
  assert.equal(snapshot.deployAuthority, 'NONE');
  assert.equal(snapshot.readinessAuthority, 'NONE');
  assert.equal(snapshot.actionAuthority, 'NONE');
  assert.equal(snapshot.liveExecution, 'LIVE_EXECUTION_NOT_IMPLEMENTED');
  assert.equal(Object.hasOwn(snapshot, 'l12Snapshot'), false);
  assert.equal(Object.hasOwn(snapshot, 'l13Snapshot'), false);
  assertDeeplyFrozen(snapshot);
});

test('is deterministic, does not mutate input, and validates only exact reproduction', () => {
  const input = completeInput();
  const before = structuredClone(input);
  const first = projectExternalProofEvidence(input);
  const second = projectExternalProofEvidence(structuredClone(input));

  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.deepEqual(
    validateExternalProofEvidenceSnapshot(first, input.l12Snapshot, input.l13Snapshot),
    first,
  );

  const tampered = structuredClone(first);
  tampered.readinessProof = true;
  assert.throws(
    () => validateExternalProofEvidenceSnapshot(tampered, input.l12Snapshot, input.l13Snapshot),
    /not reproducible/,
  );
});

test('snapshot revision binds evidence content and injected evaluation instant', () => {
  const firstInput = completeInput();
  const secondInput = completeInput();
  secondInput.evidence[1].assertions += 1;
  const thirdInput = completeInput();
  thirdInput.evaluatedAtMs += 1;

  const first = projectExternalProofEvidence(firstInput);
  assert.notEqual(projectExternalProofEvidence(secondInput).snapshotRevision, first.snapshotRevision);
  assert.notEqual(projectExternalProofEvidence(thirdInput).snapshotRevision, first.snapshotRevision);
});

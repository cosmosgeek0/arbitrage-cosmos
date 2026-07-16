import assert from 'node:assert/strict';
import test from 'node:test';

import {
  preflightInstrumentSizing,
} from '../../../dist/liveEdge/adapters/binanceInstrumentSpecs/index.js';
import {
  projectExternalProofEvidence,
} from '../../../dist/liveEdge/adapters/externalProofEvidence/index.js';
import {
  EVALUATED_AT_MS,
  canonicalFilterEvidence,
  completeInput,
  withCanonicalFilter,
} from './fixtures.mjs';

function currentInput() {
  return withCanonicalFilter(completeInput());
}

function replaceOwnerResult(evidence) {
  evidence.ownerResult = preflightInstrumentSizing(
    evidence.ownerSnapshot,
    evidence.expectedSubject.request,
  );
  evidence.reasonCodes = [...evidence.ownerResult.reasonCodes];
}

test('promotes only a reproduced current exact-subject L04 arithmetic rejection to FILTER_BLOCKED', () => {
  const snapshot = projectExternalProofEvidence(currentInput());
  const current = snapshot.evidence.at(-1);

  assert.equal(current.subject, 'CURRENT_FILTER_ADMISSION');
  assert.equal(current.classification, 'FILTER_BLOCKED');
  assert.equal(current.evidence.kind, 'CURRENT_OWNER_FILTER_VERDICT');
  assert.equal(current.evidence.ownerResult.staticState, 'BLOCKED');
  assert.ok(current.evidence.ownerResult.reasonCodes.includes('PRICE_BELOW_MINIMUM'));
  assert.ok(current.evidence.ownerResult.externalRequirements.length > 0);
  assert.equal(current.evidence.ownerResult.sendEligible, false);
  assert.equal(current.evidence.ownerResult.externalActionAuthorization, 'NONE');
  assert.equal(current.provesReadiness, false);
  assert.equal(current.provesMoneyMutation, false);
  assert.equal(snapshot.readinessProof, false);
  assert.equal(snapshot.sendEligible, false);
});

test('accepts a canonical owner registry beyond the old 256-item classifier cap', () => {
  const input = completeInput();
  input.evidence[input.evidence.length - 1] = canonicalFilterEvidence(257);
  assert.equal(input.evidence.at(-1).ownerSnapshot.instruments.length, 257);
  const snapshot = projectExternalProofEvidence(input);
  assert.equal(snapshot.evidence.at(-1).classification, 'FILTER_BLOCKED');
  assert.equal(snapshot.evidence.at(-1).provesReadiness, false);
});

test('rejects caller-authored result, reason, subject, and registry forgeries', () => {
  for (const mutate of [
    (evidence) => { evidence.ownerResult.reasonCodes = ['PRICE_ABOVE_MAXIMUM']; },
    (evidence) => { evidence.reasonCodes = ['PRICE_ABOVE_MAXIMUM']; },
    (evidence) => { evidence.expectedSubject.snapshotRevision = 'forged-revision'; },
    (evidence) => { evidence.ownerSnapshot.snapshotRevision = 'forged-revision'; },
    (evidence) => { evidence.ownerResult.sendEligible = true; },
  ]) {
    const input = currentInput();
    const evidence = structuredClone(input.evidence.at(-1));
    mutate(evidence);
    input.evidence[input.evidence.length - 1] = evidence;
    assert.throws(() => projectExternalProofEvidence(input), /owner|registry|snapshot|reproduce|BLOCKED/i);
  }
});

test('rejects canonical L04 gap outcomes that are not exchange-filter arithmetic proof', () => {
  const cases = [
    {
      label: 'revision mismatch',
      request: { instrumentRevision: 'wrong-owner-revision' },
      reason: 'INSTRUMENT_REVISION_MISMATCH',
    },
    {
      label: 'capability gap',
      request: { requestedPrice: '1', timeInForce: 'GTD' },
      reason: 'TIME_IN_FORCE_NOT_ADVERTISED',
    },
    {
      label: 'reference gap',
      request: {
        orderType: 'MARKET', timeInForce: null, requestedPrice: null, referencePrice: null,
      },
      reason: 'FILTER_REFERENCE_EVIDENCE_REQUIRED',
    },
  ];

  for (const { label, request, reason } of cases) {
    const input = currentInput();
    const evidence = input.evidence.at(-1);
    evidence.expectedSubject.request = { ...evidence.expectedSubject.request, ...request };
    replaceOwnerResult(evidence);
    assert.ok(evidence.reasonCodes.includes(reason), label);
    assert.throws(
      () => projectExternalProofEvidence(input),
      /complete current exact-subject canonical owner BLOCKED result/,
      label,
    );
  }
});

test('rejects a reproduced but stale owner result', () => {
  const input = currentInput();
  const evidence = input.evidence.at(-1);
  input.evaluatedAtMs = EVALUATED_AT_MS + 60_000;
  evidence.expectedSubject.request = {
    ...evidence.expectedSubject.request,
    evaluatedAtMs: input.evaluatedAtMs,
  };
  replaceOwnerResult(evidence);
  assert.ok(evidence.reasonCodes.includes('SOURCE_STALE'));
  assert.throws(
    () => projectExternalProofEvidence(input),
    /complete current exact-subject canonical owner BLOCKED result/,
  );
});

test('rejects the superseded shallow caller-asserted owner verdict shape', () => {
  const input = completeInput();
  input.evidence[input.evidence.length - 1] = {
    subject: 'CURRENT_FILTER_ADMISSION', evidenceId: 'forged-shallow-filter',
    reasonCodes: ['PRICE_BELOW_MINIMUM'], kind: 'CURRENT_OWNER_FILTER_VERDICT',
    owner: 'BINANCE_INSTRUMENT_SPEC_OWNER', verdict: 'BLOCKED',
    verdictDigest: 'a'.repeat(64), filterIds: ['PRICE_FILTER'],
  };
  assert.throws(() => projectExternalProofEvidence(input), /exact closed schema/);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { canonicalJson } from '../../../dist/foundation/contracts/index.js';

import {
  applyMutationAppendRequest,
  confirmMutationAppend,
  evaluateSyntheticSubmissionBoundary,
  isMutationTelemetryAppendCapacityAvailable,
  MUTATION_JOURNAL_LIMITS,
  prepareInitialMutationAppend,
  preparePreflightMutationAppend,
  prepareSubmissionIntentAppend,
  prepareSyntheticSubmissionObservationAppend,
  reconstructPersistedMutationJournal,
  validateMutationJournalSnapshot,
  validateMutationAppendRequest,
  validatePersistedMutationJournal,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/index.js';
import {
  T0,
  acknowledgement,
  inputFixture,
  initialPersisted,
  l03SubmittedAttempt,
  persist,
  preflightPersisted,
  submittingPersisted,
} from './fixtures.mjs';

test('telemetry capacity preserves the exact final eight money-critical slots', () => {
  assert.equal(MUTATION_JOURNAL_LIMITS.maximumEntries, 256);
  assert.equal(MUTATION_JOURNAL_LIMITS.reservedMoneyCriticalEntries, 8);
  assert.equal(MUTATION_JOURNAL_LIMITS.maximumSerializedEntryBytes, 128 * 1_024);
  assert.equal(MUTATION_JOURNAL_LIMITS.maximumSerializedAppendRequestBytes, 128 * 1_024);
  assert.equal(MUTATION_JOURNAL_LIMITS.maximumSerializedSnapshotBytes, 512 * 1_024);
  assert.equal(isMutationTelemetryAppendCapacityAvailable(247, 0), true);
  assert.equal(isMutationTelemetryAppendCapacityAvailable(248, 0), false);
  assert.equal(isMutationTelemetryAppendCapacityAvailable(247, 3), false);
  assert.throws(() => isMutationTelemetryAppendCapacityAvailable(257, 0), TypeError);
});

test('standalone CAS validation applies one exact entry to one exact prior snapshot', () => {
  const initialPrepared = prepareInitialMutationAppend(inputFixture());
  assert.deepEqual(validateMutationAppendRequest(initialPrepared.request), initialPrepared.request);
  assert.deepEqual(
    applyMutationAppendRequest(null, initialPrepared.request),
    initialPrepared.nextSnapshot,
  );
  const initial = persist(initialPrepared);
  const preflightPrepared = preparePreflightMutationAppend(initial, T0 + 1);
  assert.deepEqual(
    applyMutationAppendRequest(initial.snapshot, preflightPrepared.request),
    preflightPrepared.nextSnapshot,
  );
  assert.equal(applyMutationAppendRequest(null, preflightPrepared.request), null);
  assert.equal(applyMutationAppendRequest(initial.snapshot, {
    ...preflightPrepared.request,
    entryContentRevision: `l06content_${'0'.repeat(64)}`,
  }), null);
  assert.equal(validateMutationAppendRequest({
    ...preflightPrepared.request,
    entry: {
      ...preflightPrepared.request.entry,
      journalVersion: preflightPrepared.request.entry.journalVersion + 1,
    },
  }), null);

  const forged = structuredClone(preflightPrepared.request);
  forged.entry.payload.preflightEvaluatedAtMs += 1;
  const { appendRequestDigest: _priorDigest, ...forgedBase } = forged;
  forged.appendRequestDigest = `l06append_${createHash('sha256')
    .update(canonicalJson(forgedBase)).digest('hex')}`;
  assert.equal(validateMutationAppendRequest(forged), null);
});

test('initial CREATED and PREFLIGHTED entries bind exact owner identities and stay evidence-only', () => {
  const initial = initialPersisted();
  assert.equal(initial.snapshot.projection.lifecycle, 'CREATED');
  assert.equal(initial.snapshot.persistenceProven, false);
  assert.equal(initial.acknowledgementValidated, true);
  assert.equal(initial.persistenceProven, false);
  assert.equal(initial.persistenceOwnerTarget, 'SYSTEM_INTEGRATION_LEDGER');
  assert.equal(initial.provenance, 'INJECTED_ACKNOWLEDGEMENT_ONLY');
  assert.equal(initial.snapshot.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(initial.snapshot.externalActionAuthorization, 'NONE');
  assert.equal(initial.snapshot.identity.ticketId.startsWith('plan_'), true);
  assert.equal(initial.snapshot.identity.clientOrderId.startsWith('cx-'), true);
  assert.equal(Object.isFrozen(initial), true);
  assert.equal(Object.isFrozen(initial.snapshot.entries), true);

  const preflight = persist(preparePreflightMutationAppend(initial, T0 + 1));
  assert.equal(preflight.snapshot.projection.lifecycle, 'PREFLIGHTED');
  assert.equal(preflight.snapshot.journalVersion, 2);
  assert.equal(preflight.snapshot.projection.recoveryRequired, false);
});

test('failed, malformed, stale, conflicting, and partially bound acknowledgements never persist', () => {
  const prepared = prepareInitialMutationAppend(inputFixture());
  for (const disposition of ['VERSION_CONFLICT', 'FAILED', 'CAPACITY_EXHAUSTED']) {
    const result = confirmMutationAppend(prepared, acknowledgement(prepared, { disposition }));
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, 'ACK_NOT_COMMITTED');
  }
  const mutations = [
    { appendRequestDigest: `l06append_${'0'.repeat(64)}` },
    { committedJournalVersion: 2 },
    { committedHeadDigest: `l06head_${'0'.repeat(64)}` },
    { committedOutcomeRevision: `l06outcome_${'0'.repeat(64)}` },
    { ledgerEventId: 0 },
    { committedAtMs: T0 - 1 },
    { appendedCount: 0 },
  ];
  for (const override of mutations) {
    const result = confirmMutationAppend(prepared, acknowledgement(prepared, { override }));
    assert.equal(result.ok, false, JSON.stringify(override));
  }
  const extra = acknowledgement(prepared);
  extra.unexpected = true;
  assert.equal(confirmMutationAppend(prepared, extra).ok, false);
});

test('persisted SUBMISSION_INTENT opens only a synthetic evidence boundary and never send authority', () => {
  const submitting = submittingPersisted();
  assert.equal(submitting.snapshot.projection.lifecycle, 'SUBMITTING');
  assert.equal(submitting.snapshot.projection.recoveryRequired, true);
  const decision = evaluateSyntheticSubmissionBoundary(submitting, T0 + 4);
  assert.equal(decision.state, 'SYNTHETIC_OBSERVATION_ELIGIBLE');
  assert.equal(decision.sendAuthorized, false);
  assert.match(decision.boundaryId, /^l06boundary_[0-9a-f]{64}$/);
  assert.equal(decision.externalActionAuthorization, 'NONE');
  assert.deepEqual(decision.reasonCodes, []);

  const observedPrepared = prepareSyntheticSubmissionObservationAppend(
    submitting,
    decision,
    l03SubmittedAttempt(submitting),
    T0 + 5,
  );
  const observed = persist(observedPrepared);
  assert.equal(observed.snapshot.projection.submissionObserved, true);
  const blocked = evaluateSyntheticSubmissionBoundary(observed, T0 + 6);
  assert.equal(blocked.state, 'BLOCKED');
  assert.ok(blocked.reasonCodes.includes('DUPLICATE_SUBMISSION_OBSERVATION_BLOCKED'));
});

test('synthetic eligibility is re-derived, content-bound, and CAS-idempotent rather than a send permit', () => {
  const submitting = submittingPersisted();
  const decision = evaluateSyntheticSubmissionBoundary(submitting, T0 + 3);
  const forged = { ...decision, boundaryId: `l06boundary_${'0'.repeat(64)}` };
  assert.throws(() => prepareSyntheticSubmissionObservationAppend(
    submitting,
    forged,
    l03SubmittedAttempt(submitting),
    T0 + 4,
  ));
  const first = prepareSyntheticSubmissionObservationAppend(
    submitting,
    decision,
    l03SubmittedAttempt(submitting),
    T0 + 4,
  );
  const second = prepareSyntheticSubmissionObservationAppend(
    submitting,
    decision,
    l03SubmittedAttempt(submitting),
    T0 + 4,
  );
  assert.deepEqual(first.request, second.request);
  const committed = persist(first);
  const replayed = persist(second, { disposition: 'IDEMPOTENT_REPLAY' });
  assert.equal(committed.snapshot.headDigest, replayed.snapshot.headDigest);
  assert.equal(evaluateSyntheticSubmissionBoundary(replayed, T0 + 5).state, 'BLOCKED');
  assert.equal(decision.sendAuthorized, false);
});

test('replayed acknowledgement and restart reconstruction can never reopen synthetic submission', () => {
  const preflight = preflightPersisted();
  const prepared = prepareSubmissionIntentAppend(preflight, T0 + 2);
  const replayed = persist(prepared, { disposition: 'IDEMPOTENT_REPLAY' });
  assert.equal(evaluateSyntheticSubmissionBoundary(replayed, T0 + 3).state, 'BLOCKED');

  const newlyCommitted = persist(prepared);
  assert.equal(evaluateSyntheticSubmissionBoundary(newlyCommitted, T0 + 3).state, 'SYNTHETIC_OBSERVATION_ELIGIBLE');
  const reconstructed = reconstructPersistedMutationJournal(
    newlyCommitted.snapshot.entries,
    newlyCommitted.acknowledgement,
  );
  assert.ok(reconstructed);
  assert.equal(reconstructed.acknowledgement.disposition, 'IDEMPOTENT_REPLAY');
  assert.equal(evaluateSyntheticSubmissionBoundary(reconstructed, T0 + 3).state, 'BLOCKED');
});

test('persisted validation recomputes every acknowledgement binding and causal cut', () => {
  const persisted = submittingPersisted();
  assert.equal(validatePersistedMutationJournal(persisted).snapshot.headDigest, persisted.snapshot.headDigest);
  const attacks = [
    { idempotencyKey: 'l06append:wrong:3' },
    { appendRequestDigest: `l06append_${'f'.repeat(64)}` },
    { expectedJournalVersion: 0 },
    { previousHeadDigest: null },
    { committedAtMs: T0 - 10 },
  ];
  for (const attack of attacks) {
    assert.throws(() => validatePersistedMutationJournal({
      ...persisted,
      acknowledgement: { ...persisted.acknowledgement, ...attack },
    }), undefined, JSON.stringify(attack));
  }
});

test('snapshot replay rejects gaps, forks, reordering, truncation and coherent top-level rewrites', () => {
  const persisted = submittingPersisted();
  assert.ok(validateMutationJournalSnapshot(persisted.snapshot));
  assert.equal(validateMutationJournalSnapshot({
    ...persisted.snapshot,
    outcomeRevision: `l06outcome_${'0'.repeat(64)}`,
  }), null);
  assert.equal(validateMutationJournalSnapshot({
    ...persisted.snapshot,
    entries: [persisted.snapshot.entries[0], persisted.snapshot.entries[2]],
    journalVersion: 2,
  }), null);
  assert.equal(validateMutationJournalSnapshot({
    ...persisted.snapshot,
    entries: [...persisted.snapshot.entries].reverse(),
  }), null);
  const fork = structuredClone(persisted.snapshot);
  fork.entries[2].previousHeadDigest = `l06head_${'f'.repeat(64)}`;
  assert.equal(validateMutationJournalSnapshot(fork), null);
});

test('identity graph substitutions and blocked L02 mutation contracts fail before synthetic submission', () => {
  const invalidInputs = [
    inputFixture({ identity: { clientOrderId: 'foreign-id' } }),
    inputFixture({ identity: { product: 'USD_M_PERPETUAL' } }),
    inputFixture({ identity: { accountRealmId: 'primary' } }),
    inputFixture({ identity: { strategyId: 'UNKNOWN' } }),
    inputFixture({ bindings: { preflightResultNotional: '10.0000000000000000001' } }),
    inputFixture({ bindings: { preflightNotionalAsset: 'USDC' } }),
    inputFixture({ bindings: { preflightResultQuantity: '0.9' } }),
    inputFixture({ bindings: { privateSourceCutRevision: `l05pcut_${'0'.repeat(64)}` }, createdAtMs: T0 + 20_000 }),
  ];
  const requestSequenceSubstitution = inputFixture();
  requestSequenceSubstitution.identity.requestSequence = 1;
  invalidInputs.push(requestSequenceSubstitution);
  const intentFingerprintSubstitution = inputFixture();
  intentFingerprintSubstitution.identity.intentFingerprint = '0'.repeat(32);
  invalidInputs.push(intentFingerprintSubstitution);
  for (const input of invalidInputs) assert.throws(() => prepareInitialMutationAppend(input));

  const margin = inputFixture({
    identity: {
      product: 'MARGIN',
      contractId: 'MARGIN_ORDER_POST_SCOPE_CONFLICT',
      contractState: 'OFFICIAL_DOC_CONFLICT',
    },
  });
  assert.throws(() => initialPersisted(margin));
});

test('hostile accessors, inherited values, proxies, symbols, secrets, and unknown fields fail closed', () => {
  const getter = { ...inputFixture() };
  let invoked = false;
  Object.defineProperty(getter, 'createdAtMs', {
    enumerable: true,
    get() { invoked = true; return T0; },
  });
  assert.throws(() => prepareInitialMutationAppend(getter));
  assert.equal(invoked, false);
  assert.throws(() => prepareInitialMutationAppend(new Proxy(inputFixture(), {})));
  assert.throws(() => prepareInitialMutationAppend(Object.assign(Object.create({ inherited: true }), inputFixture())));
  assert.throws(() => prepareInitialMutationAppend({ ...inputFixture(), [Symbol('x')]: true }));
  assert.throws(() => prepareInitialMutationAppend({ ...inputFixture(), apiKey: 'illustrative' }));
  assert.throws(() => prepareInitialMutationAppend({
    ...inputFixture(),
    identity: { ...inputFixture().identity, accountRealmId: 'account-realm:AKIA1234567890123456' },
  }));
});

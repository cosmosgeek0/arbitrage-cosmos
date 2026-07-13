import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPERATION_POLICY_REGISTRY,
  OWNER_CONTRACT_SURFACES,
  OWNER_CONTRACT_WAITING_SEAMS,
  SAFETY_INVARIANT_CATALOG,
  bindEvidenceTuple,
  bindOwnerContract,
  computeOwnerContractTupleDigest,
  consumeOwnerContract,
  decideRetry,
  digestOwnerContractPayload,
  evaluateEvidenceBinding,
  evaluateEvidenceRef,
  evaluateInvariantCatalog,
  scanOperationCoverage,
  transitionCircuit,
  validateOperationPolicy,
} from '../../dist/productAssurance/index.js';
import {
  REVIEWED_OPERATION_DISPOSITIONS,
  scanProductionOperations,
} from '../../../test/productAssurance/production-operation-scan.mjs';
import { NOW, digest, evidence, invariantFacts } from './helpers.mjs';

const RELEASE_ID = 'IP_ASSURANCE_TEST_RELEASE';
const TESTED_COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EVIDENCE_CONTEXT = Object.freeze({ releaseId: RELEASE_ID, testedCommit: TESTED_COMMIT });

function policy(operationId) {
  const match = OPERATION_POLICY_REGISTRY.find((entry) => entry.operationId === operationId);
  assert.ok(match, `missing operation policy ${operationId}`);
  return match;
}

function ownerContractFixture(surface, payload = Object.freeze({ projectionId: `PROJECTION_${surface}`, verdict: 'PASS' })) {
  const seam = OWNER_CONTRACT_WAITING_SEAMS[surface];
  const subjectId = `SUBJECT_${surface}`;
  const envelope = bindOwnerContract({
    surface,
    ownerId: seam.ownerId,
    releaseId: RELEASE_ID,
    subjectId,
  }, payload);
  const expectation = Object.freeze({
    surface,
    ownerId: seam.ownerId,
    releaseId: RELEASE_ID,
    subjectId,
    digestAlgorithm: 'sha256',
    digest: envelope.tuple.digest,
  });
  return Object.freeze({ envelope, expectation, payload });
}

test('operation policies and reviewed news read cover all 143 production sites', () => {
  assert.equal(OPERATION_POLICY_REGISTRY.length, 14);
  for (const entry of OPERATION_POLICY_REGISTRY) assert.deepEqual(validateOperationPolicy(entry), []);
  const report = scanProductionOperations();
  const coverage = scanOperationCoverage(OPERATION_POLICY_REGISTRY, report.sites);
  assert.equal(report.discovered, 143);
  assert.equal(report.covered, 143);
  assert.equal(report.uncovered, 0);
  assert.deepEqual(report.uncoveredSites, []);
  assert.equal(coverage.verdict, 'PASS');
  assert.deepEqual(coverage.reasonCodes, []);
  const news = report.sites.filter((site) => site.reviewedDispositionId === 'DISPOSITION_NEWS_CONTEXT_PUBLIC_GET_V1');
  assert.equal(news.length, 1);
  assert.equal(news[0].siteId, 'OPSITE_FD086559819579DF346A');
  assert.equal(news[0].rawKind, 'MUTATION_CALL');
  assert.equal(news[0].rawSymbol, 'fetch:DYNAMIC_METHOD');
  assert.equal(news[0].kind, 'NETWORK_HTTP_REQUEST');
  assert.equal(news[0].symbol, 'fetch:GET');
  assert.equal(news[0].operationId, 'OP_NEWS_CONTEXT_PUBLIC_READ');
  assert.equal(news[0].sourceSha256, REVIEWED_OPERATION_DISPOSITIONS[0].sourceSha256);
  const newsPolicy = policy('OP_NEWS_CONTEXT_PUBLIC_READ');
  assert.equal(newsPolicy.canonicalOwnerId, 'EXISTING_NEWS_CONTEXT_SERVICE');
  assert.equal(newsPolicy.concurrencyLimit, null);
  assert.equal(newsPolicy.concurrencyLimitState, 'OWNER_CONTRACT_WAITING');
  assert.equal(newsPolicy.circuit, null);
  assert.equal(newsPolicy.controlLoop, null);
  assert.equal(policy('OP_LEGACY_SIGNED_MONEY_PATH_DORMANT_BLOCKED').wiringState, 'DORMANT_BLOCKED');
});

test('unknown paths and forged mutation-to-read mappings remain uncovered', () => {
  const result = scanOperationCoverage(OPERATION_POLICY_REGISTRY, [{
    siteId: 'OPSITE_NEW_PATH', path: 'server/src/newOwner/client.ts', line: 7,
    kind: 'NETWORK_HTTP_REQUEST', symbol: 'fetch', operationId: null,
  }]);
  assert.equal(result.verdict, 'FAIL');
  const forged = scanOperationCoverage(OPERATION_POLICY_REGISTRY, [{
    siteId: 'OPSITE_FORGED_MAPPING', path: 'server/src/services/newsContext.ts', line: 2302,
    kind: 'MUTATION_CALL', symbol: 'fetch:DYNAMIC_METHOD', operationId: 'OP_NEWS_CONTEXT_PUBLIC_READ',
  }]);
  assert.equal(forged.verdict, 'FAIL');
  assert.equal(forged.uncoveredSites.length, 1);
});

test('ambiguous submission retry and circuit recovery stay bounded', () => {
  const ledger = policy('OP_LEDGER_SQLITE');
  const baseline = {
    attempt: 0, elapsedMs: 100, errorCode: 'COMMIT_STATE_UNKNOWN',
    submissionState: 'UNKNOWN_SUBMISSION', reconciliationState: 'PENDING',
    durableIdentityState: 'PRESENT', deterministicJitterUnit: 0.5,
  };
  assert.equal(decideRetry(ledger, baseline).kind, 'RECONCILE_FIRST');
  assert.equal(decideRetry(ledger, { ...baseline, durableIdentityState: 'MISSING' }).reasonCode, 'DURABLE_IDENTITY_MISSING_OR_EXPIRED');
  assert.equal(decideRetry(ledger, { ...baseline, submissionState: 'ACCEPTED' }).reasonCode, 'SUBMISSION_ALREADY_ACCEPTED');
  assert.equal(decideRetry(ledger, { ...baseline, reconciliationState: 'PROVED_ABSENT' }).kind, 'RETRY');
  const dormant = policy('OP_LEGACY_SIGNED_MONEY_PATH_DORMANT_BLOCKED');
  assert.equal(decideRetry(dormant, { ...baseline, errorCode: 'TIMEOUT', submissionState: 'NOT_SENT', reconciliationState: 'NOT_REQUIRED' }).reasonCode, 'OPERATION_NOT_WIRED');

  const http = policy('OP_PUBLIC_HTTP_READ');
  assert.ok(http.circuit);
  let snapshot = {
    state: 'CLOSED', consecutiveFailures: 0, openedAtMs: null, halfOpenProbes: 0,
    lastEventAtMs: null, probePassedAtMs: null, independentlyVerifiedAtMs: null,
  };
  for (let count = 0; count < http.circuit.failureThreshold; count += 1) {
    snapshot = transitionCircuit(http, snapshot, { kind: 'FAILURE', atMs: NOW + count + 1 });
  }
  assert.equal(snapshot.state, 'OPEN');
  snapshot = transitionCircuit(http, snapshot, { kind: 'TICK', atMs: snapshot.openedAtMs + http.circuit.resetAfterMs });
  snapshot = transitionCircuit(http, snapshot, { kind: 'PROBE_STARTED', atMs: snapshot.lastEventAtMs + 1 });
  snapshot = transitionCircuit(http, snapshot, { kind: 'PROBE_PASSED', atMs: snapshot.lastEventAtMs + 1 });
  snapshot = transitionCircuit(http, snapshot, { kind: 'INDEPENDENT_VERIFICATION_PASSED', atMs: snapshot.lastEventAtMs + 1, verifierId: 'INDEPENDENT_SENTINEL' });
  snapshot = transitionCircuit(http, snapshot, { kind: 'TICK', atMs: snapshot.independentlyVerifiedAtMs + http.circuit.healthyQuietWindowMs });
  assert.equal(snapshot.state, 'CLOSED');
  assert.throws(() => transitionCircuit(policy('OP_NEWS_CONTEXT_PUBLIC_READ'), snapshot, { kind: 'FAILURE', atMs: NOW + 100_000 }), /owner circuit contract is waiting/u);
});

test('all adjudicated owner surfaces consume exact tuples and absence remains WAITING', () => {
  assert.deepEqual([...OWNER_CONTRACT_SURFACES].sort(), [
    'ACTION_EVIDENCE', 'ASSURANCE_CASE', 'COVERAGE', 'DIAGNOSTIC_GOVERNANCE', 'RATE_BUDGET',
  ]);
  for (const surface of OWNER_CONTRACT_SURFACES) {
    const fixture = ownerContractFixture(surface);
    const consumed = consumeOwnerContract(fixture.envelope, fixture.expectation);
    assert.equal(consumed.state, 'CONSUMED');
    assert.equal(consumed.verdict, 'PASS');
    assert.notEqual(consumed.payload, fixture.payload);
    assert.equal(consumed.payload.projectionId, fixture.payload.projectionId);
    assert.equal(Object.isFrozen(consumed.payload), true);
    assert.equal(consumed.tupleDigest, fixture.envelope.tupleDigest);
    assert.equal(consumed.authorityGranted, false);

    const absent = consumeOwnerContract(null, fixture.expectation);
    assert.equal(absent.state, 'WAITING');
    assert.equal(absent.verdict, 'UNKNOWN');
    assert.deepEqual(absent.reasonCodes, ['OWNER_CONTRACT_WAITING']);
    assert.equal(absent.tupleDigest, null);
    assert.equal(absent.reasonCodes.includes('UNAVAILABLE'), false);
  }
});

test('owner contract rejects hostile owner, release, subject, digest, algorithm, splice, and extra-field substitutions', () => {
  const fixture = ownerContractFixture('ACTION_EVIDENCE');
  const identity = fixture.envelope.tuple;
  for (const replacement of [
    { releaseId: 'FORGED_RELEASE' },
    { subjectId: 'FORGED_SUBJECT' },
  ]) {
    const hostile = bindOwnerContract({
      surface: identity.surface,
      ownerId: replacement.ownerId ?? identity.ownerId,
      releaseId: replacement.releaseId ?? identity.releaseId,
      subjectId: replacement.subjectId ?? identity.subjectId,
    }, fixture.payload);
    assert.equal(consumeOwnerContract(hostile, fixture.expectation).state, 'REJECTED');
  }
  assert.throws(() => bindOwnerContract({
    surface: identity.surface, ownerId: 'FORGED_OWNER',
    releaseId: identity.releaseId, subjectId: identity.subjectId,
  }, fixture.payload), /registered canonical owner/u);
  const pairedOwnerTuple = { ...identity, ownerId: 'FORGED_OWNER' };
  const pairedOwner = consumeOwnerContract({
    ...fixture.envelope,
    tuple: pairedOwnerTuple,
    tupleDigest: computeOwnerContractTupleDigest(pairedOwnerTuple),
  }, { ...fixture.expectation, ownerId: 'FORGED_OWNER' });
  assert.equal(pairedOwner.state, 'REJECTED');
  assert.ok(pairedOwner.reasonCodes.includes('OWNER_CONTRACT_OWNER_NOT_CANONICAL'));
  assert.ok(pairedOwner.reasonCodes.includes('OWNER_CONTRACT_EXPECTATION_OWNER_NOT_CANONICAL'));

  const otherPayload = Object.freeze({ projectionId: 'SUBSTITUTED', verdict: 'PASS' });
  const digestSubstitution = bindOwnerContract({
    surface: identity.surface, ownerId: identity.ownerId,
    releaseId: identity.releaseId, subjectId: identity.subjectId,
  }, otherPayload);
  assert.equal(consumeOwnerContract(digestSubstitution, fixture.expectation).state, 'REJECTED');

  const algorithmTuple = { ...identity, digestAlgorithm: 'sha512' };
  const hostileAlgorithm = {
    ...fixture.envelope,
    tuple: algorithmTuple,
    tupleDigest: computeOwnerContractTupleDigest(algorithmTuple),
  };
  assert.equal(consumeOwnerContract(hostileAlgorithm, fixture.expectation).state, 'REJECTED');
  const spliced = { ...fixture.envelope, payload: otherPayload };
  assert.equal(consumeOwnerContract(spliced, fixture.expectation).state, 'REJECTED');
  const extraTuple = { ...identity, unexpectedDigest: digest('extra') };
  const extra = { ...fixture.envelope, tuple: extraTuple, tupleDigest: computeOwnerContractTupleDigest(extraTuple) };
  assert.equal(consumeOwnerContract(extra, fixture.expectation).state, 'REJECTED');
  assert.notEqual(digestOwnerContractPayload(otherPayload), fixture.expectation.digest);

  for (const malformed of [undefined, {}, { ...fixture.envelope, tuple: null }]) {
    const rejected = consumeOwnerContract(malformed, fixture.expectation);
    assert.equal(rejected.state, 'REJECTED');
    assert.equal(rejected.payload, null);
    assert.equal(rejected.tupleDigest, null);
  }

  const prototypePayload = JSON.parse('{"safe":1,"__proto__":{"forged":true}}');
  assert.notEqual(digestOwnerContractPayload(prototypePayload), digestOwnerContractPayload({ safe: 1 }));
  const prototypeEnvelope = bindOwnerContract({
    surface: identity.surface, ownerId: identity.ownerId,
    releaseId: identity.releaseId, subjectId: 'PROTO_PAYLOAD_SUBJECT',
  }, prototypePayload);
  assert.equal(Object.getPrototypeOf(prototypeEnvelope.payload), null);
  assert.equal(Object.hasOwn(prototypeEnvelope.payload, '__proto__'), true);

  const mutablePayload = { projectionId: 'MUTABLE', nested: { value: 'ORIGINAL' } };
  const mutableDigest = digestOwnerContractPayload(mutablePayload);
  const mutableTuple = {
    ...identity, subjectId: 'MUTABLE_PAYLOAD_SUBJECT', digest: mutableDigest,
  };
  const immutableConsumption = consumeOwnerContract({
    schema: 'PRODUCT_ASSURANCE_OWNER_CONTRACT_ENVELOPE_V1',
    tuple: mutableTuple,
    tupleDigest: computeOwnerContractTupleDigest(mutableTuple),
    payload: mutablePayload,
  }, {
    ...fixture.expectation, subjectId: mutableTuple.subjectId, digest: mutableDigest,
  });
  assert.equal(immutableConsumption.state, 'CONSUMED');
  mutablePayload.nested.value = 'MUTATED_AFTER_CONSUMPTION';
  assert.equal(immutableConsumption.payload.nested.value, 'ORIGINAL');
  assert.equal(Object.isFrozen(immutableConsumption.payload.nested), true);
  assert.throws(() => { immutableConsumption.payload.nested.value = 'FORGED'; }, TypeError);
});

test('critical invariants require exact release, owner, subject, and digest bindings', () => {
  const facts = invariantFacts(SAFETY_INVARIANT_CATALOG);
  const pass = evaluateInvariantCatalog(SAFETY_INVARIANT_CATALOG, facts, NOW, EVIDENCE_CONTEXT);
  assert.equal(pass.tradeReadinessVerdict, 'PASS');
  assert.equal(pass.results.length, 15);
  const absent = facts.filter((fact) => fact.factId !== SAFETY_INVARIANT_CATALOG[0].factIds[0]);
  assert.equal(evaluateInvariantCatalog(SAFETY_INVARIANT_CATALOG, absent, NOW, EVIDENCE_CONTEXT).tradeReadinessVerdict, 'UNKNOWN');
  assert.equal(evaluateInvariantCatalog([], [], NOW, EVIDENCE_CONTEXT).tradeReadinessVerdict, 'UNKNOWN');

  const target = facts[0];
  const definition = SAFETY_INVARIANT_CATALOG.find((entry) => entry.factIds.includes(target.factId));
  assert.ok(definition);
  const expectation = {
    ownerId: definition.factOwnerIds[target.factId],
    releaseId: RELEASE_ID,
    testedCommit: TESTED_COMMIT,
    subjectId: `INVARIANT:${definition.invariantId}:FACT:${target.factId}`,
    evidenceDigest: target.evidence.digest,
  };
  assert.equal(evaluateEvidenceBinding(target.evidence, target.evidenceBinding, expectation).verdict, 'PASS');
  for (const malformed of [null, [], {}]) {
    assert.equal(evaluateEvidenceBinding(target.evidence, malformed, expectation).verdict, 'FAIL');
  }
  for (const mutation of [
    { ownerId: 'FORGED_OWNER' }, { releaseId: 'FORGED_RELEASE' },
    { testedCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    { subjectId: 'FORGED_SUBJECT' }, { evidenceDigest: digest('forged') },
  ]) {
    const hostile = bindEvidenceTuple({ ...expectation, ...mutation });
    assert.equal(evaluateEvidenceBinding(target.evidence, hostile, expectation).verdict, 'FAIL');
  }
  const swapped = facts.map((fact, index) => index === 0
    ? { ...fact, evidence: facts[1].evidence, evidenceBinding: facts[1].evidenceBinding }
    : fact);
  assert.equal(evaluateInvariantCatalog(SAFETY_INVARIANT_CATALOG, swapped, NOW, EVIDENCE_CONTEXT).tradeReadinessVerdict, 'FAIL');
});

test('evidence expiry, truth realm, and future observations fail closed', () => {
  assert.equal(evaluateEvidenceRef(evidence('VALID'), NOW, true).verdict, 'PASS');
  assert.equal(evaluateEvidenceRef(evidence('SYNTHETIC', { truthLabel: 'SYNTHETIC_ONLY' }), NOW, true).verdict, 'UNKNOWN');
  assert.equal(evaluateEvidenceRef(evidence('FUTURE', { observedAtMs: NOW + 1 }), NOW, true).verdict, 'FAIL');
  assert.equal(evaluateEvidenceRef(evidence('EXPIRED', { expiresAtMs: NOW }), NOW, true).verdict, 'FAIL');
  assert.equal(evaluateEvidenceRef(evidence('UNBOUNDED', { expiresAtMs: null }), NOW, true).verdict, 'UNKNOWN');
});

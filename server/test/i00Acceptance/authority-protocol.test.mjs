import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildIdentityGraph,
  deriveTruthLabel,
  evaluateEvidenceSemantics,
  evaluateMessage,
  frozenInputScan,
  readJson,
  routeContractScan,
  runAuthorityScan,
  validateExactFilters,
  validateAssessmentSemantics,
} from './harness.mjs';

const catalog = readJson('fixtures/i00/proof-catalog.json');
const protocolFixtures = readJson('packages/edge-protocol/fixtures/fixtures-v1.json');

test('frozen protocol authority and dashboard inputs retain exact hashes', () => {
  const results = frozenInputScan(catalog);
  assert.equal(results.length, 14);
  assert(results.every((result) => result.passed), JSON.stringify(results.filter((result) => !result.passed)));
});

test('one owner and producer registry passes scoped duplicate-authority rules', () => {
  const scan = runAuthorityScan(catalog);
  assert.equal(scan.authorityConcepts, 13);
  assert.equal(scan.semanticStreams, 6);
  assert(scan.scanPassed, JSON.stringify(scan.rules.filter((rule) => !rule.passed)));
  assert.equal(scan.authorityConverged, false);
  assert(scan.unresolvedConflictCount >= 5);
  assert.equal(scan.conflicts.filter((conflict) => conflict.observed).length, 4);
  assert(scan.conflicts.every((conflict) => conflict.classification !== 'RESOLVED_BY_IP_PROOF'));
  assert.deepEqual(scan.boundaryFindings, []);
  assert(scan.transportCandidates.length > 0);
  assert.deepEqual(scan.unclassifiedTransportCandidates, []);
  assert(scan.transportCandidates.some((candidate) => candidate.classification === 'LEGACY_APP_DELIVERY'));
  assert(scan.transportCandidates.some((candidate) => candidate.classification === 'CANONICAL_RUNTIME_OR_MANUAL_SMOKE'));
  assert(scan.ownerCandidateDefinitions.length > 0);
  assert(scan.ownerImportEdges.length > 0);
});

test('timestamp freshness and completeness semantics are input-driven and fail closed at boundaries', () => {
  const base = {
    eventTimeMs: 1_000,
    receivedAtMs: 1_010,
    generationTimeMs: 1_020,
    nowMs: 1_100,
    maxAgeMs: 100,
    completeness: 'COMPLETE',
    sourceQuality: 'AVAILABLE',
  };
  assert.equal(evaluateEvidenceSemantics(base), 'ACCEPT');
  assert.equal(evaluateEvidenceSemantics({ ...base, nowMs: 1_101 }), 'EVIDENCE_STALE');
  assert.equal(evaluateEvidenceSemantics({ ...base, completeness: 'PARTIAL' }), 'EVIDENCE_INCOMPLETE');
  assert.equal(evaluateEvidenceSemantics({ ...base, completeness: 'MISSING' }), 'EVIDENCE_MISSING');
  assert.equal(evaluateEvidenceSemantics({ ...base, receivedAtMs: 999 }), 'TIMESTAMP_ORDER_INVALID');
  assert.equal(evaluateEvidenceSemantics({ ...base, sourceQuality: 'UNAVAILABLE' }), 'SOURCE_UNAVAILABLE');
});

test('stable identity correlation graph rejects duplicate conflicting and aliased identities', () => {
  const accepted = buildIdentityGraph([
    { eventId: 'event-a', correlationId: 'cor-1', alias: 'client-a' },
    { eventId: 'event-b', correlationId: 'cor-1', alias: 'exchange-b' },
  ]);
  assert.equal(accepted.status, 'ACCEPT');
  assert.equal(accepted.eventCount, 2);
  assert.equal(buildIdentityGraph([
    { eventId: 'event-a', correlationId: 'cor-1' },
    { eventId: 'event-a', correlationId: 'cor-1' },
  ]).status, 'DUPLICATE_EVENT_ID');
  assert.equal(buildIdentityGraph([
    { eventId: 'event-a', correlationId: 'cor-1' },
    { eventId: 'event-b', correlationId: 'cor-2' },
  ]).status, 'CORRELATION_CONFLICT');
  assert.equal(buildIdentityGraph([
    { eventId: 'event-a', correlationId: 'cor-1', alias: 'same' },
    { eventId: 'event-b', correlationId: 'cor-1', alias: 'same' },
  ]).status, 'ALIAS_CONFLICT');
});

test('exact decimal filter law rejects off-tick off-step and sub-minimum orders without floats', () => {
  const valid = { price: '100.10', quantity: '0.100', tickSize: '0.01', stepSize: '0.001', minNotional: '10.00' };
  assert.equal(validateExactFilters(valid), 'ACCEPT');
  assert.equal(validateExactFilters({ ...valid, price: '100.105' }), 'PRICE_OFF_TICK');
  assert.equal(validateExactFilters({ ...valid, quantity: '0.1005' }), 'QUANTITY_OFF_STEP');
  assert.equal(validateExactFilters({ ...valid, quantity: '0.099' }), 'NOTIONAL_BELOW_MINIMUM');
  assert.equal(validateExactFilters({ ...valid, price: '1e2' }), 'INVALID_DECIMAL');
});

test('truth labels distinguish live synthetic replay and unknown without upgrading mixed evidence', () => {
  assert.equal(deriveTruthLabel(['LIVE', 'LIVE']), 'LIVE');
  assert.equal(deriveTruthLabel(['LIVE', 'SYNTHETIC']), 'SYNTHETIC');
  assert.equal(deriveTruthLabel(['LIVE', 'REPLAY']), 'REPLAY');
  assert.equal(deriveTruthLabel(['LIVE', 'UNKNOWN']), 'UNKNOWN');
  assert.equal(deriveTruthLabel(['FORGED_LIVE']), 'UNKNOWN');
});

test('canonical system-integration route contract is present without registering routes here', () => {
  const routes = routeContractScan(catalog);
  assert.equal(routes.length, 6);
  assert(routes.every((route) => route.observed), JSON.stringify(routes.filter((route) => !route.observed)));
});

test('invalid expired and conflicting protocol messages fail closed', () => {
  for (const message of catalog.messageValidityCases) assert.equal(evaluateMessage(message), message.expected, message.id);
});

test('IP-only semantic checks close frozen-corpus money lifetime and sensitive-content gaps', () => {
  const source = protocolFixtures.valid.find((fixture) => fixture.envelope.schema === 'EdgeAssessmentEnvelopeV1').envelope;
  assert.deepEqual(validateAssessmentSemantics(source), []);

  const numericMoney = structuredClone(source);
  numericMoney.economicAssumptionContext.intendedSize = 10;
  assert(validateAssessmentSemantics(numericMoney).includes('INTENDED_SIZE_NOT_DECIMAL_STRING'));

  const inverted = structuredClone(source);
  inverted.expiryTimeMs = inverted.generationTimeMs;
  assert(validateAssessmentSemantics(inverted).includes('ASSESSMENT_LIFETIME_INVALID'));

  const nonAbstain = structuredClone(source);
  nonAbstain.advisoryAction = 'WATCH';
  assert(validateAssessmentSemantics(nonAbstain).includes('UNKNOWN_ECONOMICS_MUST_ABSTAIN'));

  const accountLeak = structuredClone(source);
  accountLeak.evidence.supporting.push({ accountId: 'synthetic-forbidden-sentinel' });
  assert(validateAssessmentSemantics(accountLeak).includes('SENSITIVE_OR_AUTHORITY_CONTENT_FORBIDDEN'));

  const oversized = structuredClone(source);
  oversized.evidence.supporting.push({ padding: 'x'.repeat(262_144) });
  assert(validateAssessmentSemantics(oversized).includes('ENVELOPE_TOO_LARGE'));

  const tooManyParents = structuredClone(source);
  tooManyParents.parentEvidenceIds = Array.from({ length: 1025 }, (_, index) => `ev-${index}`);
  assert(validateAssessmentSemantics(tooManyParents).includes('PARENT_EVIDENCE_IDS_TOO_LARGE'));
});

test('protocol fixtures remain advisory-only and fixture-only', () => {
  const schema = readJson('packages/edge-protocol/schema/edge-protocol-v1.schema.json');
  const actions = schema.$defs.EdgeAssessmentEnvelopeV1.properties.advisoryAction.enum;
  assert(!actions.some((action) => /ORDER|SEND|EXECUTE|BUY|SELL/.test(action)));
  assert(catalog.capabilities.every((capability) => capability.fixtureState === 'SYNTHETIC_ONLY'));
  assert(catalog.controls.every((control) => control.moneyIncreasing === false));
});

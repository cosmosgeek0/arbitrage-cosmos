import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildIdentityGraph,
  compareQDirectiveInputLocks,
  deriveTruthLabel,
  effectiveFrozenInputScan,
  evaluateEvidenceSemantics,
  evaluateMessage,
  frozenInputScan,
  historicalFrozenInputScan,
  readJson,
  readText,
  routeContractScan,
  runAuthorityScan,
  validateExactFilters,
  validateAssessmentSemantics,
  verifyQDirectiveInputSupersession,
} from './harness.mjs';

const catalog = readJson('fixtures/i00/proof-catalog.json');
const livingInputAcceptance = readJson('fixtures/i00/living-director-input-acceptance.json');
const qDirectiveInputSupersession = readJson('fixtures/i00/q-directive-input-supersession.json');
const protocolFixtures = readJson('packages/edge-protocol/fixtures/fixtures-v1.json');

test('D-LAUNCH-1 authorizes exactly one external Q directive-lock supersession', () => {
  const result = verifyQDirectiveInputSupersession(qDirectiveInputSupersession);
  assert.equal(result.status, 'AUTHORIZED_EXTERNAL_SUPERSESSION', JSON.stringify(result));
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.transition.inventoryRows, 6);
  assert.equal(result.transition.headersUnchanged, true);
  assert.equal(result.transition.remainingRowsUnchanged, true);
  assert.equal(result.observations.headReachable, true);
  assert.equal(result.observations.sourceReachable, true);
  assert.equal(result.observations.authorityParentLockGitBlob, qDirectiveInputSupersession.donor.lockGitBlob);
  assert.equal(result.observations.authorityResultLockGitBlob, qDirectiveInputSupersession.current.lockGitBlob);
  assert.equal(result.observations.ownerLaunchSha256, qDirectiveInputSupersession.authority.ownerLaunchSha256);
});

test('Q directive-lock supersession fails closed on provenance and document mutation', () => {
  const cases = [
    { ...qDirectiveInputSupersession, status: 'BYTE_IDENTICAL' },
    { ...qDirectiveInputSupersession, donor: { ...qDirectiveInputSupersession.donor, tip: '0'.repeat(40) } },
    { ...qDirectiveInputSupersession, donor: { ...qDirectiveInputSupersession.donor, tree: '0'.repeat(40) } },
    { ...qDirectiveInputSupersession, donor: { ...qDirectiveInputSupersession.donor, lockSha256: '0'.repeat(64) } },
    { ...qDirectiveInputSupersession, authority: { ...qDirectiveInputSupersession.authority, commit: '0'.repeat(40) } },
    { ...qDirectiveInputSupersession, authority: { ...qDirectiveInputSupersession.authority, sourceRef: 'HEAD' } },
    { ...qDirectiveInputSupersession, authority: { ...qDirectiveInputSupersession.authority, ownerLaunchGitBlob: '0'.repeat(40) } },
    { ...qDirectiveInputSupersession, authority: { ...qDirectiveInputSupersession.authority, ownerLaunchSha256: '0'.repeat(64) } },
    { ...qDirectiveInputSupersession, current: { ...qDirectiveInputSupersession.current, lockGitBlob: '0'.repeat(40) } },
    { ...qDirectiveInputSupersession, transition: { ...qDirectiveInputSupersession.transition, currentLaunchRow: `${qDirectiveInputSupersession.transition.currentLaunchRow} forged` } },
    { ...qDirectiveInputSupersession, unexpected: true },
  ];
  for (const document of cases) {
    const result = verifyQDirectiveInputSupersession(document);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.passed, false);
  }
});

test('Q directive-lock transition rejects third hashes extra row drift and malformed bytes', () => {
  const current = readText('quant/DIRECTIVE_INPUTS.lock');
  const donor = current.replace(
    qDirectiveInputSupersession.transition.currentLaunchRow,
    qDirectiveInputSupersession.transition.donorLaunchRow,
  );
  const accepted = compareQDirectiveInputLocks(Buffer.from(donor), Buffer.from(current), qDirectiveInputSupersession.transition);
  assert.equal(accepted.passed, true, JSON.stringify(accepted));

  const cases = [
    [Buffer.from(donor.replace('0cc192e3', '1cc192e3')), Buffer.from(current)],
    [Buffer.from(donor), Buffer.from(current.replace('26b1d5ce', '36b1d5ce'))],
    [Buffer.from(donor), Buffer.from(current.replace('MISSION.md |', 'MISSION-CHANGED.md |'))],
    [Buffer.from(`${donor}EXTRA | ROW | FORBIDDEN\n`), Buffer.from(current)],
    [Buffer.from(donor.slice(0, -1)), Buffer.from(current)],
    [Buffer.from([0xff, 0x0a]), Buffer.from(current)],
  ];
  for (const [donorBytes, currentBytes] of cases) {
    assert.equal(compareQDirectiveInputLocks(donorBytes, currentBytes, qDirectiveInputSupersession.transition).passed, false);
  }
});

test('final D-LAUNCH-7 repin accepts exact current-main objects while historical packet pins stay immutable', () => {
  const finalInputs = frozenInputScan(catalog);
  assert.equal(finalInputs.length, 14);
  assert(finalInputs.every((result) => result.passed), JSON.stringify(finalInputs.filter((result) => !result.passed)));

  const historical = historicalFrozenInputScan(catalog);
  assert.equal(historical.length, 14);
  assert.equal(historical.filter((result) => result.passed).length, 12);
  assert.deepEqual(historical.filter((result) => !result.passed).map((result) => result.path), [
    'QL_DIRECTOR_STATE.md',
    'QL_PARALLEL_DAG.md',
  ]);

  const effective = effectiveFrozenInputScan(catalog, livingInputAcceptance);
  assert.equal(effective.acceptance.structurePassed, true, JSON.stringify(effective.acceptance));
  assert.equal(effective.acceptance.rulingVerified, true, JSON.stringify(effective.acceptance));
  assert.equal(effective.acceptance.passed, true, JSON.stringify(effective.acceptance));
  assert(effective.acceptedInputs.every((result) => result.passed), JSON.stringify(effective.acceptedInputs.filter((result) => !result.passed)));
  assert.equal(effective.acceptance.sourceTip, 'd78be24f4da14632c857ee250b62e3fec33c2743');
  assert.equal(effective.acceptance.sourceCutoffCommit, 'd78be24f4da14632c857ee250b62e3fec33c2743');
  assert.equal(effective.acceptance.cutoffExists, true);
  assert.equal(effective.acceptance.cutoffReachable, true);
  assert.equal(effective.acceptance.rulingCommit, 'bdb29e37fb9b152aa1b7e1063ca892cd405c6245');
  assert(effective.acceptance.directiveResults.every((entry) => entry.sealedSha256 === entry.expectedSha256));
  assert(effective.acceptance.directiveResults.every((entry) => ['LIVE_OWNER_FILE', 'SEALED_CANDIDATE_HASH'].includes(entry.evidenceMode)));
  assert.deepEqual(effective.acceptance.livingResults.map((entry) => [entry.path, entry.latestCommit, entry.observedGitBlob, entry.observedSha256]), [
    ['QL_DIRECTOR_STATE.md', 'd78be24f4da14632c857ee250b62e3fec33c2743', '8116ec491fc7fc863dbcb4015be4cdb105a5a1bc', '77f7c47251e6c9f990352c6ca63408a5a2dbfbbfb87cac0f38d71bf0446258cc'],
    ['QL_PARALLEL_DAG.md', 'ac01b5e43830bc681ee7e251749c4d1fab210029', '701b3f263e73bf659ba4319c5839e798c1ce7abb', 'cb4312843160e5f72029ee9f7b169987cfc07b9ef82d952c3feba60476392dec'],
  ]);
  assert(effective.acceptance.livingResults.every((entry) => entry.observationMatches && entry.passed));
  assert(effective.acceptedInputs.filter((entry) => entry.acceptanceMode === 'LATEST_CURRENT_MAIN_TOUCH')
    .every((entry) => entry.historicalPacketPassed === false && entry.historicalPacketPinPreserved && entry.finalRepinPassed && entry.passed));
});

test('D-LAUNCH-7 acceptance fails closed on policy path provenance observation or directive tampering', () => {
  const cases = [
    { ...livingInputAcceptance, ruling: 'D-LAUNCH-6' },
    { ...livingInputAcceptance, sourceRef: 'HEAD' },
    { ...livingInputAcceptance, sourceCutoffCommit: '0'.repeat(40) },
    { ...livingInputAcceptance, rulingCommit: '0'.repeat(40) },
    { ...livingInputAcceptance, finalRealAdapterRepinRequired: true },
    { ...livingInputAcceptance, finalRealAdapterRepinCompleted: false },
    { ...livingInputAcceptance, livingDirectorInputs: livingInputAcceptance.livingDirectorInputs.map((entry, index) => index === 0 ? { ...entry, path: 'STATE.md' } : entry) },
    { ...livingInputAcceptance, livingDirectorInputs: livingInputAcceptance.livingDirectorInputs.map((entry, index) => index === 0 ? { ...entry, observedLatestCommit: '0'.repeat(40) } : entry) },
    { ...livingInputAcceptance, livingDirectorInputs: livingInputAcceptance.livingDirectorInputs.map((entry, index) => index === 1 ? { ...entry, observedGitBlob: '0'.repeat(40) } : entry) },
    { ...livingInputAcceptance, livingDirectorInputs: livingInputAcceptance.livingDirectorInputs.map((entry, index) => index === 1 ? { ...entry, observedSha256: '0'.repeat(64) } : entry) },
    { ...livingInputAcceptance, ownerDirectives: livingInputAcceptance.ownerDirectives.map((entry, index) => index === 2 ? { ...entry, sha256: '0'.repeat(64) } : entry) },
  ];
  for (const document of cases) assert.equal(effectiveFrozenInputScan(catalog, document).acceptance.passed, false);
});

test('one owner and producer registry passes scoped rules with conflicts classified from evidence', () => {
  const scan = runAuthorityScan(catalog);
  assert.equal(scan.authorityConcepts, 13);
  assert.equal(scan.semanticStreams, 6);
  assert(scan.scanPassed, JSON.stringify(scan.rules.filter((rule) => !rule.passed)));
  assert.equal(scan.authorityConverged, true);
  assert.equal(scan.unresolvedConflictCount, 0);
  assert.equal(scan.conflictClassificationPassed, true);
  assert.equal(scan.conflicts.filter((conflict) => conflict.observed).length, 4);
  assert.equal(scan.conflicts.filter((conflict) => conflict.resolutionState === 'RESOLVED').length, 4);
  assert.deepEqual(scan.conflicts.filter((conflict) => conflict.resolutionState === 'LIMITATION').map((conflict) => conflict.id), [
    'Q_PRODUCTION_TRANSPORT_NOT_CONFIGURED',
  ]);
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
  assert.equal(routes.length, 14);
  assert.deepEqual(
    routes.map(({ method, route }) => `${method} ${route}`),
    [
      'GET /api/system-integration/supervisor',
      'GET /api/system-integration/ops/readback',
      'GET /api/system-integration/ops/intake-gate',
      'GET /api/system-integration/graph',
      'GET /api/system-integration/events',
      'GET /api/system-integration/controls',
      'GET /api/system-integration/traces/:correlationId',
      'POST /api/system-integration/controls',
      'GET /api/product-integration/v1/supervisor',
      'GET /api/product-integration/v1/material-events',
      'GET /api/product-integration/v1/traces/:correlationId',
      'POST /api/product-integration/v1/commands/preview',
      'GET /api/product-integration/v1/commands/:commandId/result',
      'POST /api/product-integration/v1/commands',
    ],
  );
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

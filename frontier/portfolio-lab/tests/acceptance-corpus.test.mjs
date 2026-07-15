import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  SCENARIO_KINDS,
  SWEEP_DIMENSIONS,
  assertNoForbiddenCapabilities,
  createScenarioCampaign,
  evaluatePortfolioCampaign,
  materializeAcceptanceCampaign,
  projectPortfolioLabCockpit,
  validateAcceptanceCorpus,
  validatePortfolioCampaignReport,
  validatePortfolioLabCockpitProjection,
  validatePortfolioSnapshot,
} from '../src/index.mjs';
import { omitFields, sha256 } from '../../dock/src/canonical.mjs';
import {
  ALLOWED_SCENARIO_OWNER_CLAIM_HASHES,
  ALLOWED_SNAPSHOT_OWNER_CLAIM_HASHES,
} from '../src/owner-evidence.mjs';

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

test('static snapshot and Section 5 corpus materialize exactly twenty ordered F12 cases', async () => {
  const snapshot = await fixture('portfolio-snapshot.v1.json');
  const corpus = await fixture('acceptance-corpus.v1.json');
  const ownerEvidence = await fixture('owner-output-evidence.v1.json');
  assert.equal(validatePortfolioSnapshot(snapshot), true);
  assert.equal(validateAcceptanceCorpus(corpus), true);
  assert.equal(corpus.scenarioDefinitionStatus, 'UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB');
  assert.equal(ownerEvidence.evidenceStatus, 'UNACCEPTED_SYNTHETIC_OWNER_OUTPUT_STUBS');
  assert.equal(ownerEvidence.authorityClass, 'NO_AUTHORITY');
  assert.equal(ownerEvidence.networkMode, 'FIXTURE_ONLY');
  assert.equal(ownerEvidence.canonical, false);
  assert.equal(ownerEvidence.ownerOutputAccepted, false);
  assert.equal(ownerEvidence.claimBindingMethod, 'PACKET_LOCAL_FINITE_OWNER_CLAIM_ALLOWLIST_SHA256_V1');
  assert.deepEqual(ownerEvidence.allowedSnapshotOwnerClaimHashes, ALLOWED_SNAPSHOT_OWNER_CLAIM_HASHES);
  assert.deepEqual(ownerEvidence.allowedScenarioOwnerClaimHashes, ALLOWED_SCENARIO_OWNER_CLAIM_HASHES);
  assert.equal(ownerEvidence.evidenceHash, sha256(omitFields(ownerEvidence, ['evidenceHash'])));
  assert.ok(ownerEvidence.limitations.includes('FIXTURE_VALUES_ARE_NOT_ACCEPTED_OWNER_OUTPUTS'));
  assert.equal(snapshot.ownerEvidenceHash, ownerEvidence.evidenceHash);
  assert.ok(ownerEvidence.records.every((row) => (
    row.fixturePayloadHash === sha256(row.fixturePayload)
    && row.fixtureOutputRef.endsWith(`sha256=${row.fixturePayloadHash}`)
  )));
  assert.deepEqual(snapshot.ownerSnapshotRefs, ownerEvidence.records.map((row) => row.fixtureOutputRef));
  assert.deepEqual(snapshot.canonicalOwnerContractRefs, ownerEvidence.records.map((row) => row.canonicalOwnerContractRef));
  assert.deepEqual(Object.values(corpus.ownerRefs), ownerEvidence.records.map((row) => row.fixtureOutputRef));
  assert.deepEqual(Object.values(corpus.ownerContractRefs), ownerEvidence.records.map((row) => row.canonicalOwnerContractRef));
  assert.deepEqual(corpus.cases.map((row) => row.scenarioKind), SCENARIO_KINDS);
  const liquidationCase = corpus.cases.find((row) => row.scenarioKind === 'LIQUIDATION_DISTANCE_COMPRESSION');
  assert.deepEqual(liquidationCase.callerFacts.map((row) => [row.category, row.beforeAtoms, row.afterAtoms, row.unit]), [
    ['LIQUIDATION_DISTANCE', '180000', '70000', 'PPM'],
    ['MARGIN_HEADROOM', '250000000', '90000000', 'USDT_MICRO'],
  ]);
  const packet = materializeAcceptanceCampaign(snapshot, corpus, 1784161200000);
  assert.equal(packet.campaign.evaluationInputs.length, 20);
  assert.ok(packet.campaign.evaluationInputs.every((row) => row.snapshotHash === snapshot.snapshotHash));
  assert.ok(packet.campaign.evaluationInputs.every((row) => row.scenarioReference.extensionProviderRef === 'F12'));
  assert.ok(packet.campaign.evaluationInputs.every((row) => (
    row.scenarioDefinitionStatus === 'UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB'
  )));
  assert.ok(packet.campaign.evaluationInputs.every((row) => (
    JSON.stringify(row.sweepInputs.map((sweep) => sweep.dimension)) === JSON.stringify(SWEEP_DIMENSIONS)
  )));
});

test('complete acceptance report has nineteen comparisons and one explicit unknown abstention', async () => {
  const snapshot = await fixture('portfolio-snapshot.v1.json');
  const corpus = await fixture('acceptance-corpus.v1.json');
  const { campaign } = materializeAcceptanceCampaign(snapshot, corpus, 1784161200000);
  const report = evaluatePortfolioCampaign(snapshot, campaign);
  assert.equal(validatePortfolioCampaignReport(report), true);
  assert.equal(report.evaluationCount, 20);
  assert.equal(report.evaluatedCount, 19);
  assert.equal(report.abstainCount, 1);
  assert.deepEqual(report.reports.map((row) => row.scenarioKind), SCENARIO_KINDS);
  assert.ok(report.reports.slice(0, 19).every((row) => row.status === 'EVALUATED_COMPARATIVE'));
  const missing = report.reports.at(-1);
  assert.equal(missing.scenarioKind, 'SCENARIO_INPUT_MISSING');
  assert.equal(missing.status, 'ABSTAIN_UNKNOWN');
  assert.equal(missing.comparativeImpact, null);
  assert.equal(missing.impactInterval, null);
  assert.deepEqual(missing.knownImpactSubtotal, { state: 'KNOWN', unit: 'USDT_MICRO', atoms: '0', reason: null });
  assert.ok(missing.reasonCodes.includes('SWEEP_BORROW_UNKNOWN'));
  assert.ok(missing.reasonCodes.includes('OWNER_IMPACT_UNKNOWN'));
  assert.ok(report.reports.every((row) => row.truthClass === 'ADVISORY' && row.shadowOnly === true));
  assert.ok(report.reports.every((row) => (
    row.scenarioDefinitionStatus === 'UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB'
    && row.authorityClass === 'NO_AUTHORITY'
    && row.networkMode === 'FIXTURE_ONLY'
    && row.canonical === false
    && row.finding.advisoryOnly === true
    && row.finding.sizingSupported === false
    && row.finding.ownerAction === null
  )));
  assert.equal(report.shadowOnly, true);
  assert.equal(report.finding.sizingSupported, false);
  assert.equal(report.finding.ownerAction, null);
  assertNoForbiddenCapabilities(report);
});

test('acceptance campaign and unmounted cockpit projection are byte-stable', async () => {
  const snapshot = await fixture('portfolio-snapshot.v1.json');
  const corpus = await fixture('acceptance-corpus.v1.json');
  const one = materializeAcceptanceCampaign(snapshot, corpus, 1784161200000);
  const two = materializeAcceptanceCampaign(snapshot, corpus, 1784161200000);
  assert.equal(JSON.stringify(one), JSON.stringify(two));
  const reportOne = evaluatePortfolioCampaign(snapshot, one.campaign);
  const reportTwo = evaluatePortfolioCampaign(snapshot, two.campaign);
  assert.equal(JSON.stringify(reportOne), JSON.stringify(reportTwo));
  const projection = projectPortfolioLabCockpit(reportOne, 1784161200100);
  assert.equal(validatePortfolioLabCockpitProjection(projection), true);
  assert.equal(projection.truthLabel, 'SYNTHETIC_ONLY');
  assert.equal(projection.mountStatus, 'DIRECTOR_MOUNT_REQUIRED');
  assert.equal(projection.mounted, false);
  assert.deepEqual(projection.controls, []);
  assert.equal(projection.summary.abstainCount, 1);
});

test('preview source hashes and draw summary cannot be self-rehashed away from the embedded campaign report', async () => {
  const snapshot = await fixture('portfolio-snapshot.v1.json');
  const corpus = await fixture('acceptance-corpus.v1.json');
  const { campaign } = materializeAcceptanceCampaign(snapshot, corpus, 1784161200000);
  const report = evaluatePortfolioCampaign(snapshot, campaign);
  const forged = structuredClone(projectPortfolioLabCockpit(report, 1784161200100));
  forged.sourceCampaignHash = '3'.repeat(64);
  forged.sourceReportHash = '4'.repeat(64);
  forged.summary.drawCount = 2_048;
  forged.summary.uniqueDrawnCaseCount = 1;
  forged.projectionHash = sha256(omitFields(forged, ['projectionHash']));
  assert.throws(
    () => validatePortfolioLabCockpitProjection(forged),
    (error) => error.code === 'PROJECTION_SOURCE_BINDING_MISMATCH',
  );
});

test('bootstrap archive preserves source origin and rejects invented historical relabeling', async () => {
  const snapshot = await fixture('portfolio-snapshot.v1.json');
  const corpus = await fixture('acceptance-corpus.v1.json');
  const historicalSource = await fixture('historical-bootstrap-source.v1.json');
  assert.equal(historicalSource.payloadHash, sha256(historicalSource.payload));
  assert.equal(historicalSource.sourceRef.endsWith(`sha256=${historicalSource.payloadHash}`), true);
  assert.equal(historicalSource.evidenceStatus, 'UNACCEPTED_SYNTHETIC_BOOTSTRAP_ARCHIVE_TABLE_STUB');
  assert.equal(historicalSource.payload.derivation, 'ARCHIVED_SECTION5_FIXTURE_TABLE_FOR_BOOTSTRAP_MECHANISM_ONLY');
  assert.ok(historicalSource.payload.limitations.includes('NOT_OBSERVED_HISTORY'));
  assert.ok(historicalSource.payload.limitations.includes('ORIGIN_PRESERVED_FROM_SOURCE_ROWS'));
  const { campaign } = materializeAcceptanceCampaign(snapshot, corpus, 1784161200000);

  const mixedOrigin = structuredClone(campaign);
  delete mixedOrigin.campaignHash;
  mixedOrigin.campaignId = 'frontier.f2.historical-bootstrap.invalid-mixed.v1';
  mixedOrigin.mode = 'ARCHIVED_FIXTURE_BOOTSTRAP';
  mixedOrigin.drawCount = 80;
  assert.throws(
    () => createScenarioCampaign(mixedOrigin),
    (error) => error.code === 'BOOTSTRAP_ARCHIVE_INPUT_INVALID',
  );

  const relabeledOnly = structuredClone(mixedOrigin);
  relabeledOnly.campaignId = 'frontier.f2.historical-bootstrap.invalid-relabel.v1';
  relabeledOnly.evaluationInputs.forEach((row) => {
    delete row.evaluationHash;
    row.origin = 'HISTORICAL';
  });
  assert.throws(
    () => createScenarioCampaign(relabeledOnly),
    (error) => error.code === 'ENUM_INVALID',
  );

  const historicalInput = structuredClone(mixedOrigin);
  historicalInput.campaignId = 'frontier.f2.bootstrap-archive.fixture-table.v1';
  historicalInput.evaluationInputs.forEach((row, index) => {
    delete row.evaluationHash;
    const sourceClaim = historicalSource.payload.rowClaims[index];
    assert.equal(sourceClaim.evaluationId, row.evaluationId);
    row.reproducibilityInputs.push(
      `history-source:${historicalSource.sourceRef}`,
      `history-source-status:${historicalSource.evidenceStatus}`,
      `history-row-sha256:${sourceClaim.claimHash}`,
    );
  });
  const historical = createScenarioCampaign(historicalInput);
  const first = evaluatePortfolioCampaign(snapshot, historical);
  const replay = evaluatePortfolioCampaign(snapshot, historical);
  assert.equal(JSON.stringify(first), JSON.stringify(replay));
  assert.equal(first.mode, 'ARCHIVED_FIXTURE_BOOTSTRAP');
  assert.equal(first.drawCount, 80);
  assert.deepEqual(first.reports.map((row) => row.origin), campaign.evaluationInputs.map((row) => row.origin));
  assert.ok(first.reports.every((row) => row.reproducibilityInputs.includes(`history-source:${historicalSource.sourceRef}`)));
  const origins = new Map(first.reports.map((row) => [row.evaluationId, row.origin]));
  assert.ok(first.draws.every((draw) => draw.origin === origins.get(draw.evaluationId)));
  assert.equal(first.evidenceQuality.simulationCountImprovesEvidenceQuality, false);
  assert.equal(first.evidenceQuality.uncertaintyNarrowedByDrawCount, false);
  assert.equal(first.authorityClass, 'NO_AUTHORITY');
  assert.equal(first.finding.sizingSupported, false);
  assert.equal(first.finding.ownerAction, null);

  const relabeledWithPinnedSource = structuredClone(historicalInput);
  relabeledWithPinnedSource.evaluationInputs[0].origin = 'HISTORICAL';
  assert.throws(() => createScenarioCampaign(relabeledWithPinnedSource), { code: 'ENUM_INVALID' });

  const arbitrarySource = structuredClone(historicalInput);
  arbitrarySource.evaluationInputs[0].reproducibilityInputs = arbitrarySource.evaluationInputs[0].reproducibilityInputs.map((ref) => (
    ref.startsWith('history-source:') ? 'history-source:fixture://portfolio-lab/arbitrary?sha256='.concat('a'.repeat(64)) : ref
  ));
  assert.throws(() => createScenarioCampaign(arbitrarySource), { code: 'BOOTSTRAP_ARCHIVE_INPUT_INVALID' });

  const forgedRowMarker = structuredClone(historicalInput);
  forgedRowMarker.evaluationInputs[0].reproducibilityInputs = forgedRowMarker.evaluationInputs[0].reproducibilityInputs.map((ref) => (
    ref.startsWith('history-row-sha256:') ? `history-row-sha256:${'b'.repeat(64)}` : ref
  ));
  assert.throws(() => createScenarioCampaign(forgedRowMarker), { code: 'BOOTSTRAP_ARCHIVE_INPUT_INVALID' });

  const archiveMarkersOutsideArchiveMode = structuredClone(historicalInput);
  archiveMarkersOutsideArchiveMode.mode = 'DECLARED_GRID';
  archiveMarkersOutsideArchiveMode.drawCount = archiveMarkersOutsideArchiveMode.evaluationInputs.length;
  assert.throws(() => createScenarioCampaign(archiveMarkersOutsideArchiveMode), { code: 'BOOTSTRAP_ARCHIVE_MODE_REQUIRED' });

  const mutatedClaim = structuredClone(historicalInput);
  mutatedClaim.evaluationInputs[0].impacts[0].delta.atoms = '-149999999';
  assert.throws(() => createScenarioCampaign(mutatedClaim), { code: 'OWNER_SCENARIO_CLAIM_NOT_ALLOWLISTED' });

  const reorderedTable = structuredClone(historicalInput);
  [reorderedTable.evaluationInputs[0], reorderedTable.evaluationInputs[1]] = [
    reorderedTable.evaluationInputs[1], reorderedTable.evaluationInputs[0],
  ];
  assert.throws(() => createScenarioCampaign(reorderedTable), { code: 'BOOTSTRAP_ARCHIVE_INPUT_INVALID' });
});

test('seeded simulation table is deterministic and preserves each finite-table row origin and uncertainty', async () => {
  const snapshot = await fixture('portfolio-snapshot.v1.json');
  const corpus = await fixture('acceptance-corpus.v1.json');
  const { campaign } = materializeAcceptanceCampaign(snapshot, corpus, 1784161200000);
  const input = structuredClone(campaign);
  delete input.campaignHash;
  input.campaignId = 'frontier.f2.seeded-simulation-table.v1';
  input.mode = 'SEEDED_SIMULATION_TABLE';
  input.drawCount = 80;
  const seeded = createScenarioCampaign(input);
  const first = evaluatePortfolioCampaign(snapshot, seeded);
  const replay = evaluatePortfolioCampaign(snapshot, seeded);
  assert.equal(JSON.stringify(first), JSON.stringify(replay));
  assert.equal(first.mode, 'SEEDED_SIMULATION_TABLE');
  assert.equal(first.drawCount, 80);
  assert.equal(first.evidenceQuality.simulationCountImprovesEvidenceQuality, false);
  assert.equal(first.evidenceQuality.uncertaintyNarrowedByDrawCount, false);
  assert.equal(first.authorityClass, 'NO_AUTHORITY');
  assert.equal(first.finding.sizingSupported, false);
  assert.equal(first.finding.ownerAction, null);
  const sources = new Map(first.reports.map((row) => [row.evaluationId, row]));
  for (const draw of first.draws) {
    assert.equal(draw.origin, sources.get(draw.evaluationId).origin);
    assert.deepEqual(draw.callerSuppliedUncertainty, sources.get(draw.evaluationId).callerSuppliedUncertainty);
  }
});

test('corpus omissions, reorderings, and false known values fail before evaluation', async () => {
  const corpus = await fixture('acceptance-corpus.v1.json');
  const shortened = structuredClone(corpus);
  shortened.cases.pop();
  assert.throws(() => validateAcceptanceCorpus(shortened), { code: 'ACCEPTANCE_CORPUS_INCOMPLETE' });
  const reordered = structuredClone(corpus);
  [reordered.cases[0], reordered.cases[1]] = [reordered.cases[1], reordered.cases[0]];
  assert.throws(() => validateAcceptanceCorpus(reordered), { code: 'ACCEPTANCE_CORPUS_ORDER_INVALID' });
  const falseKnown = structuredClone(corpus);
  falseKnown.cases.at(-1).sweepOverrides[0].state = 'KNOWN';
  falseKnown.cases.at(-1).sweepOverrides[0].value = '0';
  falseKnown.cases.at(-1).uncertainty = {
    state: 'KNOWN', lowerAtoms: '0', upperAtoms: '0', method: 'FABRICATED_ZERO', sourceOwnerKeys: ['L_TWIN'],
  };
  assert.throws(() => validateAcceptanceCorpus(falseKnown), { code: 'MISSING_INPUT_CASE_INVALID' });

  const missingLiquidationFact = structuredClone(corpus);
  missingLiquidationFact.cases[17].callerFacts.pop();
  assert.throws(() => validateAcceptanceCorpus(missingLiquidationFact), { code: 'LIQUIDATION_CALLER_FACTS_REQUIRED' });

  const unknownHeadroom = structuredClone(corpus);
  unknownHeadroom.cases[17].callerFacts[1].state = 'UNKNOWN';
  unknownHeadroom.cases[17].callerFacts[1].beforeAtoms = null;
  unknownHeadroom.cases[17].callerFacts[1].afterAtoms = null;
  assert.throws(() => validateAcceptanceCorpus(unknownHeadroom), { code: 'LIQUIDATION_CALLER_FACTS_REQUIRED' });

  const invalidLiquidationUnit = structuredClone(corpus);
  invalidLiquidationUnit.cases[17].callerFacts[0].unit = 'USDT_MICRO';
  assert.throws(() => validateAcceptanceCorpus(invalidLiquidationUnit), { code: 'LIQUIDATION_DISTANCE_UNIT_INVALID' });

  const outOfRangeLiquidation = structuredClone(corpus);
  outOfRangeLiquidation.cases[17].callerFacts[0].afterAtoms = '1000001';
  assert.throws(() => validateAcceptanceCorpus(outOfRangeLiquidation), { code: 'LIQUIDATION_DISTANCE_RANGE_INVALID' });

  const expandedLiquidation = structuredClone(corpus);
  expandedLiquidation.cases[17].callerFacts[0].afterAtoms = expandedLiquidation.cases[17].callerFacts[0].beforeAtoms;
  assert.throws(() => validateAcceptanceCorpus(expandedLiquidation), { code: 'LIQUIDATION_COMPRESSION_INVALID' });

  const expandedHeadroom = structuredClone(corpus);
  expandedHeadroom.cases[17].callerFacts[1].afterAtoms = expandedHeadroom.cases[17].callerFacts[1].beforeAtoms;
  assert.throws(() => validateAcceptanceCorpus(expandedHeadroom), { code: 'MARGIN_HEADROOM_COMPRESSION_INVALID' });

  const ownerSwap = structuredClone(corpus);
  ownerSwap.cases[0].impacts[0].ownerKey = 'CAPITAL';
  assert.throws(() => validateAcceptanceCorpus(ownerSwap), { code: 'OWNER_ATTRIBUTION_MISMATCH' });

  const oversizedStateChanges = structuredClone(corpus);
  oversizedStateChanges.cases[0].stateChanges = Array.from({ length: 129 }, (_, index) => ({
    subjectId: `position.bound.${index}`,
    category: 'RISK_POSTURE',
    before: 'BASELINE',
    after: 'STRESSED',
    ownerKey: 'RISK',
  }));
  assert.throws(() => validateAcceptanceCorpus(oversizedStateChanges), { code: 'CORPUS_STATE_CHANGES_INVALID' });
});

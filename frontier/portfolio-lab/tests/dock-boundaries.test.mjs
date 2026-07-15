import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { adaptFixture, reverseFixture, validateFixtureOutput } from '../../dock/src/adapter.mjs';
import { omitFields, sha256 } from '../../dock/src/canonical.mjs';
import { assertScenarioReferenceOperation, invokeFacet } from '../../dock/src/facets.mjs';
import { validateCanonicalAdapterMap } from '../../dock/src/records.mjs';
import {
  REQUIRED_DOCK_FACET_HASHES,
  createPortfolioLabAdvisoryFacetRequest,
  createPortfolioLabCockpitFacetRequest,
  createPortfolioLabScenarioFacetRequest,
  evaluateThroughAdvisoryFacet,
  materializeAcceptanceCampaign,
  projectThroughCockpitFacet,
  resolvePortfolioLabDockBindings,
  routePortfolioLabAdvisory,
  validateThroughScenarioReferenceFacet,
} from '../src/index.mjs';

async function json(relativeUrl) {
  return JSON.parse(await readFile(new URL(relativeUrl, import.meta.url), 'utf8'));
}

async function dockInputs() {
  return {
    ownerMap: await json('../../dock/contracts/v1/canonical-owner-map.json'),
    moduleFacetMatrix: await json('../../dock/contracts/v1/module-facet-matrix.json'),
  };
}

async function modulePacket() {
  const snapshot = await json('../fixtures/portfolio-snapshot.v1.json');
  const corpus = await json('../fixtures/acceptance-corpus.v1.json');
  return materializeAcceptanceCampaign(snapshot, corpus, 1784161200000);
}

test('accepted Dock files and all three F2 bindings match the frozen pin', async () => {
  const pin = await json('../contracts/v1/dock-pin.v1.json');
  assert.equal(pin.dockCommitSha, 'e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5');
  for (const row of pin.dockFiles) {
    const bytes = await readFile(new URL(`../../../${row.path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, row.path);
  }
  const inputs = await dockInputs();
  const bindings = resolvePortfolioLabDockBindings(inputs.ownerMap, inputs.moduleFacetMatrix);
  assert.deepEqual(Object.keys(bindings), ['ADVISORY_ASSESSOR', 'SCENARIO_REFERENCE', 'COCKPIT_PROJECTION']);
  for (const [facetClass, hash] of Object.entries(REQUIRED_DOCK_FACET_HASHES)) {
    assert.equal(bindings[facetClass].bindingHash, hash);
    assert.equal(bindings[facetClass].bindingStatus, 'USABLE');
    assert.equal(bindings[facetClass].readOnly, true);
    assert.equal(bindings[facetClass].networkMode, 'FIXTURE_ONLY');
    assert.equal(bindings[facetClass].authorityClass, 'NO_AUTHORITY');
  }
});

test('advisory, scenario-reference, and cockpit facets stay in their frozen classes', async () => {
  const inputs = await dockInputs();
  const { snapshot, campaign } = await modulePacket();
  const report = evaluateThroughAdvisoryFacet({ ...inputs, snapshot, campaign });
  assert.equal(report.truthClass, 'ADVISORY');
  assert.equal(report.shadowOnly, true);
  assert.deepEqual(routePortfolioLabAdvisory(report), { routed: true, destinationClass: 'FIXTURE_REPORT', effectAllowed: false });
  const validation = validateThroughScenarioReferenceFacet({
    ...inputs,
    scenarioReference: campaign.evaluationInputs[0].scenarioReference,
    scenarioDefinitionStatus: campaign.evaluationInputs[0].scenarioDefinitionStatus,
  });
  assert.equal(validation.truthClass, 'FIXTURE_VALIDATION');
  assert.equal(validation.immutable, true);
  assert.equal(validation.executed, false);
  assert.equal(validation.canonicalTruthMutated, false);
  assert.equal(validation.scenarioDefinitionStatus, 'UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB');
  assert.equal(validation.definitionAccepted, false);
  assert.equal(validation.syntheticConsumerStub, true);
  const projection = projectThroughCockpitFacet({
    ...inputs,
    campaignReport: report,
    generatedAtMs: 1784161200100,
  });
  assert.equal(projection.truthClass, 'FIXTURE_PROJECTION');
  assert.equal(projection.truthLabel, 'SYNTHETIC_ONLY');
  assert.equal(projection.mounted, false);
  assert.deepEqual(projection.controls, []);
  assert.throws(
    () => createPortfolioLabCockpitFacetRequest({ campaignReport: report, generatedAtMs: report.generatedAtMs - 1 }),
    { code: 'PREVIEW_TIME_ORDER_INVALID' },
  );
});

test('Dock request class, operation, authority, network, and effect widening fail closed', async () => {
  const inputs = await dockInputs();
  const { snapshot, campaign } = await modulePacket();
  const binding = resolvePortfolioLabDockBindings(inputs.ownerMap, inputs.moduleFacetMatrix).ADVISORY_ASSESSOR;
  const request = createPortfolioLabAdvisoryFacetRequest({ snapshot, campaign });
  const handler = () => ({
    truthClass: 'ADVISORY', shadowOnly: true, authorityClass: 'NO_AUTHORITY', networkMode: 'FIXTURE_ONLY', canonical: false,
  });
  assert.throws(() => invokeFacet({ binding, requestFacetClass: 'COCKPIT_PROJECTION', operation: 'EVALUATE_FIXTURE', request, handler }), { code: 'FACET_CLASS_CROSSING' });
  assert.throws(() => invokeFacet({ binding, requestFacetClass: 'ADVISORY_ASSESSOR', operation: 'PROJECT_FIXTURE', request, handler }), { code: 'FACET_OPERATION_FORBIDDEN' });
  assert.throws(() => invokeFacet({ binding, requestFacetClass: 'ADVISORY_ASSESSOR', operation: 'EVALUATE_FIXTURE', request: { ...request, networkMode: 'LIVE' }, handler }), { code: 'FACET_REQUEST_BOUNDARY_INVALID' });
  assert.throws(() => invokeFacet({ binding, requestFacetClass: 'ADVISORY_ASSESSOR', operation: 'EVALUATE_FIXTURE', request: { ...request, authorityClass: 'CAPITAL' }, handler }), { code: 'FACET_REQUEST_BOUNDARY_INVALID' });
  const report = evaluateThroughAdvisoryFacet({ ...inputs, snapshot, campaign });
  assert.throws(() => routePortfolioLabAdvisory(report, 'DETERMINISTIC_EFFECT'), { code: 'ADVISORY_EFFECT_FORBIDDEN' });
  assert.throws(() => validateFixtureOutput({ ...handler(), truthClass: 'CANONICAL_RISK_TRUTH' }), { code: 'CANONICAL_TRUTH_MASQUERADE' });
});

test('scenario references cannot execute and F2 cannot self-provide their definition', async () => {
  const { campaign } = await modulePacket();
  const reference = campaign.evaluationInputs[0].scenarioReference;
  assert.throws(() => assertScenarioReferenceOperation(reference, 'EXECUTE'), { code: 'SCENARIO_OPERATION_FORBIDDEN' });
  const selfProvided = structuredClone(reference);
  selfProvided.extensionProviderRef = 'F2';
  const inputs = await dockInputs();
  assert.throws(() => validateThroughScenarioReferenceFacet({
    ...inputs,
    scenarioReference: selfProvided,
    scenarioDefinitionStatus: 'UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB',
  }), { code: 'SCENARIO_PROVIDER_INVALID' });
  assert.throws(() => validateThroughScenarioReferenceFacet({
    ...inputs,
    scenarioReference: reference,
    scenarioDefinitionStatus: 'ACCEPTED_F12_REFERENCE',
  }), { code: 'SCENARIO_DEFINITION_STATUS_INVALID' });
  const selfAssertedAccepted = structuredClone(reference);
  selfAssertedAccepted.lineageRefs = ['self:accepted'];
  selfAssertedAccepted.scenarioHash = sha256(omitFields(selfAssertedAccepted, ['scenarioHash']));
  assert.throws(() => validateThroughScenarioReferenceFacet({
    ...inputs,
    scenarioReference: selfAssertedAccepted,
    scenarioDefinitionStatus: 'ACCEPTED_F12_REFERENCE',
  }), { code: 'SCENARIO_DEFINITION_STATUS_INVALID' });
  for (const mutate of [
    (row) => { row.scenarioId = 'ACCEPTED_F12_REFERENCE'; },
    (row) => { row.scenarioVersion = '1.0.0-accepted'; },
    (row) => { row.fixtureSchemaRef = 'fixture://accepted-f12/schema'; },
    (row) => { row.clockRef = 'fixture://live-clock'; },
    (row) => { row.expectedCanonicalPostureRefs = ['fixture://authoritative-risk-posture']; },
    (row) => { row.scenarioId = 'f12.acceptedReference'; },
    (row) => { row.clockRef = 'fixture://liveTradingClock'; },
    (row) => { row.scenarioVersion = '1.0.0-tradeReady'; },
  ]) {
    const authorityMarked = structuredClone(reference);
    mutate(authorityMarked);
    authorityMarked.scenarioHash = sha256(omitFields(authorityMarked, ['scenarioHash']));
    assert.throws(() => validateThroughScenarioReferenceFacet({
      ...inputs,
      scenarioReference: authorityMarked,
      scenarioDefinitionStatus: 'UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB',
    }), { code: 'SCENARIO_AUTHORITY_MARKER_FORBIDDEN' });
  }
  for (const mutate of [
    (row) => { row.lineageRefs[0] = 'fixture://portfolio-lab/unaccepted-f12-consumer-stub/'; },
    (row) => { row.lineageRefs[0] = 'fixture://portfolio-lab/unaccepted-f12-consumer-stub/corpus/case/extra'; },
    (row) => { row.lineageRefs[0] = 'fixture://portfolio-lab/unaccepted-f12-consumer-stub/corpus/../case'; },
    (row) => { row.fixtureSchemaRef = 'fixture://portfolio-lab/invented-f12-schema'; },
    (row) => { row.expectedCanonicalPostureRefs = ['fixture://portfolio-lab/posture/risk-stub']; },
  ]) {
    const inventedStubEvidence = structuredClone(reference);
    mutate(inventedStubEvidence);
    inventedStubEvidence.scenarioHash = sha256(omitFields(inventedStubEvidence, ['scenarioHash']));
    assert.throws(() => createPortfolioLabScenarioFacetRequest({
      scenarioReference: inventedStubEvidence,
      scenarioDefinitionStatus: 'UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB',
    }), { code: 'SCENARIO_DEFINITION_STUB_EVIDENCE_MISSING' });
  }
  assert.throws(() => validateThroughScenarioReferenceFacet({
    ...inputs,
    scenarioReference: reference,
    scenarioDefinitionStatus: 'UNKNOWN',
  }), { code: 'SCENARIO_DEFINITION_STATUS_INVALID' });

  const extraField = structuredClone(reference);
  extraField.displayLabel = 'benign but schema-forbidden';
  extraField.scenarioHash = sha256(omitFields(extraField, ['scenarioHash']));
  assert.throws(() => validateThroughScenarioReferenceFacet({
    ...inputs,
    scenarioReference: extraField,
    scenarioDefinitionStatus: 'UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB',
  }), { code: 'UNKNOWN_FIELD' });

  const nestedSecret = structuredClone(reference);
  nestedSecret.lineageRefs[0] = { apiKey: 'embedded-secret' };
  nestedSecret.scenarioHash = sha256(omitFields(nestedSecret, ['scenarioHash']));
  assert.throws(() => validateThroughScenarioReferenceFacet({
    ...inputs,
    scenarioReference: nestedSecret,
    scenarioDefinitionStatus: 'UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB',
  }), { code: 'FORBIDDEN_CAPABILITY_FIELD' });
});

test('identity-only request maps round-trip the actual exported Dock requests', async () => {
  const inputs = await dockInputs();
  const { snapshot, campaign } = await modulePacket();
  const report = evaluateThroughAdvisoryFacet({ ...inputs, snapshot, campaign });
  const scenario = campaign.evaluationInputs[0];
  const vectors = [
    ['advisory-assessor.adapter-map.v1.json', createPortfolioLabAdvisoryFacetRequest({ snapshot, campaign })],
    ['scenario-reference.adapter-map.v1.json', createPortfolioLabScenarioFacetRequest({
      scenarioReference: scenario.scenarioReference,
      scenarioDefinitionStatus: scenario.scenarioDefinitionStatus,
    })],
    ['cockpit-projection.adapter-map.v1.json', createPortfolioLabCockpitFacetRequest({
      campaignReport: report,
      generatedAtMs: 1784161200100,
    })],
  ];
  for (const [name, source] of vectors) {
    const map = await json(`../contracts/v1/${name}`);
    assert.equal(validateCanonicalAdapterMap(map), true);
    const preview = adaptFixture(map, source);
    assert.deepEqual(reverseFixture(preview), source);
    const tampered = structuredClone(preview);
    tampered.losslessSource.fixture.tampered = true;
    assert.throws(() => reverseFixture(tampered), { code: 'FIXTURE_PREVIEW_TAMPERED' });
  }
});

test('advisory route rejects a self-rehashed nested sizing claim before Dock routing', async () => {
  const inputs = await dockInputs();
  const { snapshot, campaign } = await modulePacket();
  const report = structuredClone(evaluateThroughAdvisoryFacet({ ...inputs, snapshot, campaign }));
  const nested = report.reports[0];
  nested.finding.sizingSupported = true;
  nested.reportHash = sha256(omitFields(nested, ['reportHash']));
  for (const row of report.scenarioMatrix) {
    if (row.evaluationId === nested.evaluationId) row.reportHash = nested.reportHash;
  }
  for (const row of report.draws) {
    if (row.evaluationId === nested.evaluationId) row.reportHash = nested.reportHash;
  }
  for (const view of Object.values(report.portfolioViews)) {
    for (const row of view.rows) {
      if (row.evaluationId === nested.evaluationId) row.reportHash = nested.reportHash;
    }
  }
  report.reportHash = sha256(omitFields(report, ['reportHash']));
  assert.throws(() => routePortfolioLabAdvisory(report), { code: 'ADVISORY_FINDING_BOUNDARY_INVALID' });
});

test('fixture handler crash and fixture-file removal leave no mutable product dependency', async () => {
  const inputs = await dockInputs();
  const { snapshot, campaign } = await modulePacket();
  const binding = resolvePortfolioLabDockBindings(inputs.ownerMap, inputs.moduleFacetMatrix).ADVISORY_ASSESSOR;
  const request = createPortfolioLabAdvisoryFacetRequest({ snapshot, campaign });
  const before = JSON.stringify({ snapshot, campaign, request });
  let handlerCalls = 0;

  assert.throws(() => invokeFacet({
    binding,
    requestFacetClass: 'ADVISORY_ASSESSOR',
    operation: 'EVALUATE_FIXTURE',
    request,
    handler: (fixtureRequest) => {
      handlerCalls += 1;
      assert.equal(Object.isFrozen(fixtureRequest), true);
      assert.equal(Object.isFrozen(fixtureRequest.fixture.snapshot.positions[0]), true);
      fixtureRequest.fixture.snapshot.positions[0].assetId = 'MUTATION_ATTEMPT';
      throw new Error('unreachable fixture crash sentinel');
    },
  }), TypeError);
  assert.equal(handlerCalls, 1);
  assert.equal(JSON.stringify({ snapshot, campaign, request }), before);

  const sourceDirectory = new URL('../src/', import.meta.url);
  const runtimeSources = await Promise.all((await readdir(sourceDirectory))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => readFile(new URL(name, sourceDirectory), 'utf8')));
  assert.ok(runtimeSources.every((source) => !source.includes('/fixtures/') && !source.includes('../fixtures')));

  const replay = evaluateThroughAdvisoryFacet({ ...inputs, snapshot, campaign });
  assert.equal(replay.sourceCampaign.campaignHash, campaign.campaignHash);
  assert.equal(replay.authorityClass, 'NO_AUTHORITY');
  assert.equal(replay.networkMode, 'FIXTURE_ONLY');
});

test('runtime source imports only local module and read-only Dock code and opens no transport', async () => {
  const sourceDirectory = new URL('../src/', import.meta.url);
  const files = (await readdir(sourceDirectory)).filter((name) => name.endsWith('.mjs'));
  for (const name of files) {
    const source = await readFile(new URL(name, sourceDirectory), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    assert.ok(imports.every((target) => target.startsWith('./') || target.startsWith('../../dock/src/')), `${name} imports ${imports.join(', ')}`);
    for (const forbidden of [
      /node:/, /process\.env/, /Math\.random/, /\bfetch\s*\(/, /\bWebSocket\b/,
      /\bsetTimeout\s*\(/, /\bsetInterval\s*\(/,
    ]) assert.doesNotMatch(source, forbidden, `${name} contains forbidden runtime dependency ${forbidden}`);
  }
});

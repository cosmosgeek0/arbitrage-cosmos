import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { validateInsertionRequest, validateExtensionDescriptor } from '../../dock/src/records.mjs';
import {
  evaluatePortfolioCampaign,
  materializeAcceptanceCampaign,
  projectPortfolioLabCockpit,
  validatePortfolioLabCockpitProjection,
} from '../src/index.mjs';

async function json(relativeUrl) {
  return JSON.parse(await readFile(new URL(relativeUrl, import.meta.url), 'utf8'));
}

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('descriptor is Dock-valid, active prestage only, and embeds the exact resource claims', async () => {
  const descriptor = await json('../contracts/v1/extension-descriptor.v1.json');
  const budget = await json('../fixtures/resource-budget-claim.v1.json');
  const rate = await json('../fixtures/max-safe-rate-claim.v1.json');
  assert.equal(validateExtensionDescriptor(descriptor), true);
  assert.equal(descriptor.buildState, 'PRESTAGE_READY');
  assert.equal(descriptor.disposition, 'ACTIVE');
  assert.equal(descriptor.immutableBaseSha, 'f0168cb37bd04d21bc90591ab2256770de3b75bc');
  assert.equal(descriptor.sourceSha, '5cac88062c701800a08c602bd191ce796a175421');
  assert.equal(descriptor.authorityClass, 'NO_AUTHORITY');
  assert.equal(descriptor.networkMode, 'FIXTURE_ONLY');
  assert.equal(descriptor.secretMode, 'NONE');
  assert.deepEqual(descriptor.resourceBudgetClaim, budget);
  assert.deepEqual(descriptor.maxSafeRateClaim, rate);
  assert.deepEqual(descriptor.canonicalOutputContractRefs, []);
  assert.ok(descriptor.canonicalInputContractRefs.every((ref) => ref.startsWith('frontier/dock/') || ref.startsWith('frontier/portfolio-lab/')));
  assert.ok(descriptor.dataSourceRefs.includes('frontier/portfolio-lab/fixtures/historical-bootstrap-source.v1.json'));
  assert.ok(descriptor.dataClassifications.includes('NOT_OBSERVED_HISTORY'));
  assert.equal(Object.hasOwn(descriptor, 'attestation'), false);

  await execFileAsync('git', ['cat-file', '-e', `${descriptor.sourceSha}^{commit}`], { cwd: repositoryRoot });
  await execFileAsync('git', ['merge-base', '--is-ancestor', descriptor.sourceSha, 'HEAD'], { cwd: repositoryRoot });
  const { stdout } = await execFileAsync('git', [
    'ls-tree', '-r', '--name-only', descriptor.sourceSha, '--', 'frontier/portfolio-lab',
  ], { cwd: repositoryRoot });
  const sourcePaths = new Set(stdout.trim().split('\n'));
  for (const path of [
    'frontier/portfolio-lab/src/index.mjs',
    'frontier/portfolio-lab/contracts/v1/portfolio-lab-v1.schema.json',
    'frontier/portfolio-lab/fixtures/acceptance-corpus.v1.json',
    'frontier/portfolio-lab/preview/portfolio-lab.v1.json',
  ]) assert.ok(sourcePaths.has(path), `${path} must exist at descriptor sourceSha`);
});

test('insertion request names every future shared seam and implements none', async () => {
  const request = await json('../fixtures/insertion-request.v1.json');
  const exactSeams = [
    'capitalFoundation:immutable-portfolio-snapshot-adapter',
    'foundation/risk:immutable-risk-output-reference',
    'quant:immutable-model-and-stress-output-reference',
    'liveEdge:immutable-cost-liability-recovery-output-reference',
    'foundation/replay:accepted-recorded-replay-owner-evidence-adapter',
    'frontier/scenario-bank:accepted-Dock-SCENARIO_REFERENCE-provider-artifact',
    'canonical-advisory-owner:portfolio-level-output-contract-decision',
    'systemIntegration/supervisor:read-only-portfolio-lab-cockpit-projection',
    'foundation/control:canonical-capability-resource-retention-policy-decision',
    'canonical-deployment-owner:extension-mount-disable-rollback-uninstall-decision',
    'product-assurance:post-mount-isolation-removal-proof',
  ];
  assert.equal(validateInsertionRequest(request, exactSeams), true);
  assert.deepEqual(request.intendedSharedSeams, exactSeams);
  assert.deepEqual(request.blockedFacetRequests, [
    'SCENARIO_REFERENCE:ACCEPTED_F12_SCENARIO_ARTIFACT_NOT_AVAILABLE',
    'ADVISORY_ASSESSOR:ACCEPTED_OWNER_FIELD_ADAPTERS_NOT_AVAILABLE',
    'ADVISORY_ASSESSOR:PORTFOLIO_LEVEL_CANONICAL_OUTPUT_ADAPTER_DECISION_REQUIRED',
    'ADVISORY_ASSESSOR:ACCEPTED_HISTORICAL_OWNER_OUTPUT_TABLE_NOT_AVAILABLE',
    'COCKPIT_PROJECTION:PORTFOLIO_LAB_SURFACE_ID_AND_MOUNT_DECISION_REQUIRED',
  ]);
  assert.ok(request.futureTests.includes(
    'accepted F12 scenario provider artifact provenance and Dock SCENARIO_REFERENCE round-trip',
  ));
  assert.equal(request.mutationImplemented, false);
});

test('static cockpit preview exactly matches deterministic regeneration', async () => {
  const snapshot = await json('../fixtures/portfolio-snapshot.v1.json');
  const corpus = await json('../fixtures/acceptance-corpus.v1.json');
  const staticPreview = await json('../preview/portfolio-lab.v1.json');
  assert.equal(validatePortfolioLabCockpitProjection(staticPreview), true);
  const { campaign } = materializeAcceptanceCampaign(snapshot, corpus, 1784161200000);
  const report = evaluatePortfolioCampaign(snapshot, campaign);
  const regenerated = projectPortfolioLabCockpit(report, 1784161200100);
  assert.deepEqual(staticPreview, regenerated);
  assert.equal(staticPreview.summary.evaluationCount, 20);
  assert.equal(staticPreview.summary.evaluatedCount, 19);
  assert.equal(staticPreview.summary.abstainCount, 1);
});

test('portable contract schema exposes the implemented input, output, and facet records', async () => {
  const schema = await json('../contracts/v1/portfolio-lab-v1.schema.json');
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(Object.keys(schema.$defs).length, 78);
  const localRefs = [];
  const collectLocalRefs = (value) => {
    if (Array.isArray(value)) {
      value.forEach(collectLocalRefs);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    if (typeof value.$ref === 'string') localRefs.push(value.$ref);
    Object.values(value).forEach(collectLocalRefs);
  };
  collectLocalRefs(schema);
  assert.equal(localRefs.length, 360);
  assert.equal(new Set(localRefs).size, 78);
  for (const ref of localRefs) {
    assert.match(ref, /^#\/\$defs\/[A-Za-z0-9]+$/);
    assert.ok(schema.$defs[ref.slice('#/$defs/'.length)], `unresolved local schema ref: ${ref}`);
  }
  const objectDefinitions = Object.entries(schema.$defs).filter(([, definition]) => (
    definition.type === 'object'
  ));
  assert.equal(objectDefinitions.length, 43);
  assert.ok(objectDefinitions.every(([, definition]) => definition.additionalProperties === false));
  for (const name of [
    'PortfolioSnapshotV1',
    'PortfolioScenarioEvaluationInputV1',
    'ScenarioCampaignV1',
    'PortfolioScenarioReportV1',
    'PortfolioCampaignReportV1',
    'PortfolioLabCockpitProjectionV1',
    'PortfolioLabAdvisoryFacetRequestV1',
    'PortfolioLabScenarioFacetRequestV1',
    'PortfolioLabCockpitFacetRequestV1',
  ]) assert.ok(schema.$defs[name], name);

  assert.deepEqual(schema.$defs.Atoms, {
    type: 'string',
    pattern: '^(?:0|[1-9][0-9]{0,95}|-[1-9][0-9]{0,95})$',
    maxLength: 97,
  });
  assert.ok(schema.$defs.ScenarioReferenceV1.properties.scenarioVersion.pattern.startsWith('^'));
  assert.ok(schema.$defs.ScenarioReferenceV1.properties.scenarioVersion.pattern.endsWith('$'));
  assert.equal(schema.$defs.ScenarioKind.enum.length, 20);
  assert.equal(new Set(schema.$defs.ScenarioKind.enum).size, 20);
  assert.equal(schema.$defs.ScenarioDefinitionStatus.const, 'UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB');
  assert.ok(schema.$defs.PortfolioSnapshotV1.required.includes('canonicalOwnerContractRefs'));
  assert.ok(schema.$defs.PortfolioSubjectV1.required.includes('ownerSnapshotRef'));
  assert.ok(schema.$defs.PortfolioScenarioEvaluationInputV1.required.includes('scenarioDefinitionStatus'));
  assert.equal(schema.$defs.PortfolioScenarioEvaluationInputV1.properties.impacts.minItems, 1);
  assert.equal(schema.$defs.PortfolioScenarioEvaluationInputV1.properties.outputMode.const, 'COMPARATIVE');
  assert.equal(schema.$defs.FrozenSweepInputsV1.prefixItems.length, 7);
  assert.ok(schema.$defs.PortfolioScenarioReportV1.required.includes('scenarioDefinitionStatus'));
  assert.ok(schema.$defs.PortfolioScenarioReportV1.required.includes('sourceSnapshot'));
  assert.ok(schema.$defs.PortfolioScenarioReportV1.required.includes('sourceEvaluation'));
  assert.ok(schema.$defs.PortfolioCampaignReportV1.required.includes('portfolioViews'));
  assert.ok(schema.$defs.PortfolioCampaignReportV1.required.includes('sourceSnapshot'));
  assert.ok(schema.$defs.PortfolioCampaignReportV1.required.includes('sourceCampaign'));
  assert.ok(schema.$defs.PortfolioLabCockpitProjectionV1.required.includes('drillDownEvidence'));
  assert.ok(schema.$defs.PortfolioLabCockpitProjectionV1.required.includes('portfolioViews'));
  assert.ok(schema.$defs.PortfolioLabCockpitProjectionV1.required.includes('sourceCampaignReport'));
  for (const name of [
    'StateChangeV1',
    'UncertaintyV1',
    'AttributionV1',
    'ScenarioFindingV1',
    'ScenarioEvidenceQualityV1',
    'ScenarioRelationshipGraphV1',
    'PortfolioConcentrationMapV1',
    'ScenarioMatrixRowV1',
    'CampaignDrawV1',
    'PortfolioViewsV1',
  ]) assert.equal(schema.$defs[name].additionalProperties, false, `${name} must remain closed`);
  assert.deepEqual(Object.keys(schema.$defs.PortfolioLabAdvisoryFacetRequestV1.properties.fixture.properties), ['snapshot', 'campaign']);
  assert.deepEqual(Object.keys(schema.$defs.PortfolioLabScenarioFacetRequestV1.properties.fixture.properties), ['scenarioReference', 'scenarioDefinitionStatus']);
  assert.deepEqual(Object.keys(schema.$defs.PortfolioLabCockpitFacetRequestV1.properties.fixture.properties), ['campaignReport', 'generatedAtMs']);
});

test('research receipt records the current official primary-source retrievals', async () => {
  const receipt = await readFile(new URL('../research/RESEARCH_RECEIPT.md', import.meta.url), 'utf8');
  for (const marker of [
    '2026-07-15T19:49:57Z',
    'https://www.bis.org/basel_consolidated_guidelines/chapter/RMA/30.htm',
    'https://www.bankofengland.co.uk/financial-stability/boe-system-wide-exploratory-scenario-exercise',
    'https://www.bankofengland.co.uk/stress-testing/2024/boes-approach-to-stress-testing-the-uk-banking-system',
    'https://www.federalreserve.gov/frrs/guidance/supervisory-guidance-on-model-risk-management.htm',
  ]) assert.ok(receipt.includes(marker), marker);
});

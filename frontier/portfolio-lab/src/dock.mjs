import { cloneCanonical, deepFreeze, omitFields, sha256 } from '../../dock/src/canonical.mjs';
import { routeAdvisoryOutput } from '../../dock/src/adapter.mjs';
import {
  assertScenarioReferenceOperation,
  invokeFacet,
  validateCanonicalOwnerMap,
  validateModuleFacetMatrix,
} from '../../dock/src/facets.mjs';
import {
  evaluatePortfolioCampaign,
  validateScenarioCampaign,
  validatePortfolioCampaignReport,
} from './campaign.mjs';
import {
  validatePortfolioSnapshot,
  validateUnacceptedScenarioReferenceBoundary,
} from './contracts.mjs';
import {
  asRecord,
  assertCanonicalJson,
  assertNoForbiddenCapabilities,
  exactFields,
  fail,
  requireFields,
  safeInteger,
} from './errors.mjs';
import { projectPortfolioLabCockpit } from './preview.mjs';

function facetRequest(facetClass, operation, fixture) {
  return deepFreeze(cloneCanonical({
    facetClass,
    operation,
    networkMode: 'FIXTURE_ONLY',
    authorityClass: 'NO_AUTHORITY',
    fixture,
  }));
}

function validateScenarioDefinitionBoundary(scenarioReference, scenarioDefinitionStatus) {
  validateUnacceptedScenarioReferenceBoundary(scenarioReference, scenarioDefinitionStatus);
}

export function createPortfolioLabAdvisoryFacetRequest({ snapshot, campaign }) {
  validatePortfolioSnapshot(snapshot);
  validateScenarioCampaign(campaign);
  if (campaign.snapshotHash !== snapshot.snapshotHash) {
    fail('SNAPSHOT_BINDING_MISMATCH', 'advisory request campaign must bind the supplied snapshot');
  }
  if (campaign.generatedAtMs < snapshot.receivedAtMs) {
    fail('CAMPAIGN_TIME_ORDER_INVALID', 'advisory request campaign cannot predate its snapshot');
  }
  return facetRequest('ADVISORY_ASSESSOR', 'EVALUATE_FIXTURE', { snapshot, campaign });
}

export function createPortfolioLabScenarioFacetRequest({ scenarioReference, scenarioDefinitionStatus }) {
  validateScenarioDefinitionBoundary(scenarioReference, scenarioDefinitionStatus);
  return facetRequest('SCENARIO_REFERENCE', 'VALIDATE_FIXTURE', { scenarioReference, scenarioDefinitionStatus });
}

export function createPortfolioLabCockpitFacetRequest({ campaignReport, generatedAtMs }) {
  validatePortfolioCampaignReport(campaignReport);
  safeInteger(generatedAtMs, 'PortfolioLabCockpitProjectionV1.generatedAtMs');
  if (generatedAtMs < campaignReport.generatedAtMs) {
    fail('PREVIEW_TIME_ORDER_INVALID', 'cockpit request cannot predate its campaign report');
  }
  return facetRequest('COCKPIT_PROJECTION', 'PROJECT_FIXTURE', { campaignReport, generatedAtMs });
}

export const REQUIRED_DOCK_FACET_HASHES = Object.freeze({
  ADVISORY_ASSESSOR: 'bd4fe6b1d4354729b0caa856e05e661e3f956b5574b8be68401336b18be0eefa',
  SCENARIO_REFERENCE: '35f74a00293a869adcb3cbb7dfa884d40cbd33afdf82b2ed4590cda048d28d19',
  COCKPIT_PROJECTION: '588e54eb6cafc8ca0114e3f11eac55801fc4b4957d1f6a32bfb797f9754ffa00',
});

export function resolvePortfolioLabDockBindings(ownerMapInput, moduleFacetMatrixInput) {
  validateCanonicalOwnerMap(ownerMapInput);
  validateModuleFacetMatrix(moduleFacetMatrixInput);
  const moduleRow = moduleFacetMatrixInput.modules.find((row) => row.moduleId === 'F2');
  const required = Object.keys(REQUIRED_DOCK_FACET_HASHES);
  if (!moduleRow || moduleRow.moduleName !== 'PortfolioLab'
    || moduleRow.requiredUsableFacets.length !== required.length
    || moduleRow.requiredUsableFacets.some((facet, index) => facet !== required[index])) {
    fail('DOCK_MODULE_RECIPE_MISMATCH', 'Dock module facet matrix does not contain the frozen F2 recipe');
  }
  const bindings = {};
  for (const facetClass of required) {
    const binding = ownerMapInput.facets.find((row) => row.facetClass === facetClass);
    if (!binding || binding.bindingStatus !== 'USABLE') fail('DOCK_FACET_UNUSABLE', `${facetClass} is not usable`);
    if (binding.bindingHash !== REQUIRED_DOCK_FACET_HASHES[facetClass]) {
      fail('DOCK_FACET_HASH_MISMATCH', `${facetClass} does not match the accepted Dock binding hash`);
    }
    bindings[facetClass] = cloneCanonical(binding);
  }
  return deepFreeze(bindings);
}

export function evaluateThroughAdvisoryFacet({ ownerMap, moduleFacetMatrix, snapshot, campaign }) {
  const binding = resolvePortfolioLabDockBindings(ownerMap, moduleFacetMatrix).ADVISORY_ASSESSOR;
  const request = createPortfolioLabAdvisoryFacetRequest({ snapshot, campaign });
  const output = invokeFacet({
    binding,
    requestFacetClass: 'ADVISORY_ASSESSOR',
    operation: 'EVALUATE_FIXTURE',
    request,
    handler: (fixtureRequest) => evaluatePortfolioCampaign(
      fixtureRequest.fixture.snapshot,
      fixtureRequest.fixture.campaign,
    ),
  });
  if (output.truthClass !== 'ADVISORY' || output.shadowOnly !== true) {
    fail('ADVISORY_RESPONSE_BOUNDARY_INVALID', 'advisory facet must return a shadow-only advisory');
  }
  return output;
}

export function validateThroughScenarioReferenceFacet({
  ownerMap,
  moduleFacetMatrix,
  scenarioReference,
  scenarioDefinitionStatus,
}) {
  const binding = resolvePortfolioLabDockBindings(ownerMap, moduleFacetMatrix).SCENARIO_REFERENCE;
  const request = createPortfolioLabScenarioFacetRequest({ scenarioReference, scenarioDefinitionStatus });
  const output = invokeFacet({
    binding,
    requestFacetClass: 'SCENARIO_REFERENCE',
    operation: 'VALIDATE_FIXTURE',
    request,
    handler: (fixtureRequest) => {
      const fixture = fixtureRequest.fixture;
      validateScenarioDefinitionBoundary(fixture.scenarioReference, fixture.scenarioDefinitionStatus);
      const guard = assertScenarioReferenceOperation(fixture.scenarioReference, 'VALIDATE_FIXTURE');
      const validation = {
        schema: 'PortfolioLabScenarioReferenceValidationV1',
        version: 1,
        scenarioId: guard.scenarioId,
        scenarioDefinitionStatus: fixture.scenarioDefinitionStatus,
        definitionAccepted: false,
        syntheticConsumerStub: true,
        immutable: guard.immutable,
        executed: false,
        canonicalTruthMutated: false,
        truthClass: 'FIXTURE_VALIDATION',
        authorityClass: 'NO_AUTHORITY',
        networkMode: 'FIXTURE_ONLY',
        canonical: false,
      };
      validation.validationHash = sha256(omitFields(validation, ['validationHash']));
      return deepFreeze(validation);
    },
  });
  if (output.truthClass !== 'FIXTURE_VALIDATION' || output.executed !== false
    || output.canonicalTruthMutated !== false || output.immutable !== true
    || output.scenarioDefinitionStatus !== scenarioDefinitionStatus
    || output.definitionAccepted !== false || output.syntheticConsumerStub !== true) {
    fail('SCENARIO_RESPONSE_BOUNDARY_INVALID', 'scenario facet must validate an immutable reference without execution or canonical mutation');
  }
  return output;
}

export function projectThroughCockpitFacet({ ownerMap, moduleFacetMatrix, campaignReport, generatedAtMs }) {
  const binding = resolvePortfolioLabDockBindings(ownerMap, moduleFacetMatrix).COCKPIT_PROJECTION;
  const request = createPortfolioLabCockpitFacetRequest({ campaignReport, generatedAtMs });
  const output = invokeFacet({
    binding,
    requestFacetClass: 'COCKPIT_PROJECTION',
    operation: 'PROJECT_FIXTURE',
    request,
    handler: (fixtureRequest) => projectPortfolioLabCockpit(
      fixtureRequest.fixture.campaignReport,
      fixtureRequest.fixture.generatedAtMs,
    ),
  });
  if (output.truthClass !== 'FIXTURE_PROJECTION' || output.mounted !== false
    || output.mountStatus !== 'DIRECTOR_MOUNT_REQUIRED' || output.controls.length !== 0) {
    fail('COCKPIT_RESPONSE_BOUNDARY_INVALID', 'cockpit facet must remain an unmounted control-free fixture projection');
  }
  return output;
}

export function routePortfolioLabAdvisory(report, destinationClass = 'FIXTURE_REPORT') {
  validatePortfolioCampaignReport(report);
  if (report?.shadowOnly !== true) fail('ADVISORY_RESPONSE_BOUNDARY_INVALID', 'routed PortfolioLab advisory must remain shadow-only');
  return routeAdvisoryOutput(report, destinationClass);
}

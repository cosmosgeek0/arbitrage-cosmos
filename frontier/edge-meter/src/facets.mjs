import {
  cloneCanonical,
  contractError,
  createProviderFacetBinding,
  invokeFacet,
  routeAdvisoryOutput,
  validateProviderFacetBinding,
} from '../../dock/src/index.mjs';
import {
  DOCK_FACET_PINS,
  EDGE_METER_EXTENSION_ID,
  EDGE_METER_EXTENSION_VERSION,
  REQUIRED_DOCK_FACETS,
} from './constants.mjs';
import { projectEdgeMeterCockpit } from './preview.mjs';
import { createEdgeMeterReport } from './report.mjs';

export function bindEdgeMeterFacet(dockBinding) {
  if (!REQUIRED_DOCK_FACETS.includes(dockBinding?.facetClass)) {
    throw Object.assign(new TypeError('EdgeMeter may bind only its two frozen Dock facets'), {
      code: 'EDGE_DOCK_FACET_NOT_REQUIRED',
    });
  }
  validateProviderFacetBinding(dockBinding);
  const pin = DOCK_FACET_PINS[dockBinding.facetClass];
  for (const [field, expected] of Object.entries(pin)) {
    if (dockBinding[field] !== expected) {
      throw contractError('EDGE_DOCK_FACET_PIN_MISMATCH', `${dockBinding.facetClass}.${field} differs from the sealed F0 binding`);
    }
  }
  const record = cloneCanonical(dockBinding);
  delete record.bindingHash;
  record.providerId = `${EDGE_METER_EXTENSION_ID}.${record.facetClass.toLowerCase().replaceAll('_', '-')}.v1`;
  record.extensionId = EDGE_METER_EXTENSION_ID;
  record.extensionProviderRef = `${EDGE_METER_EXTENSION_ID}@${EDGE_METER_EXTENSION_VERSION}:${record.facetClass}`;
  record.resourceBudgetClaimRef = 'frontier/edge-meter/contracts/v1/resource-budget-claim.v1.json';
  record.provenanceRef = 'frontier/edge-meter/contracts/v1/facet-binding-refs.v1.json';
  return createProviderFacetBinding(record);
}

export function invokeEdgeMeterAdvisory({ dockBinding, batch }) {
  const binding = bindEdgeMeterFacet(dockBinding);
  return invokeFacet({
    binding,
    requestFacetClass: 'ADVISORY_ASSESSOR',
    operation: 'EVALUATE_FIXTURE',
    request: {
      schema: 'EdgeMeterFacetRequestV1',
      facetClass: 'ADVISORY_ASSESSOR',
      operation: 'EVALUATE_FIXTURE',
      networkMode: 'FIXTURE_ONLY',
      authorityClass: 'NO_AUTHORITY',
      batch: cloneCanonical(batch),
    },
    handler: (request) => createEdgeMeterReport(request.batch),
  });
}

export function invokeEdgeMeterCockpitProjection({ dockBinding, report }) {
  const binding = bindEdgeMeterFacet(dockBinding);
  return invokeFacet({
    binding,
    requestFacetClass: 'COCKPIT_PROJECTION',
    operation: 'PROJECT_FIXTURE',
    request: {
      schema: 'EdgeMeterFacetRequestV1',
      facetClass: 'COCKPIT_PROJECTION',
      operation: 'PROJECT_FIXTURE',
      networkMode: 'FIXTURE_ONLY',
      authorityClass: 'NO_AUTHORITY',
      report: cloneCanonical(report),
    },
    handler: (request) => projectEdgeMeterCockpit(request.report),
  });
}

export function routeEdgeMeterReport(report) {
  return routeAdvisoryOutput(report, 'FIXTURE_REPORT');
}

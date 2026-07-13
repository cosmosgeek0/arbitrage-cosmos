import { readFileSync } from 'node:fs';

import {
  FACT_SEMANTICS_BY_CONTRACT,
} from '../../../../../fixtures/productAssurance/systemic/cockpit/reference/cockpit-view-model.mjs';

const fixture = JSON.parse(readFileSync(new URL(
  '../../../../../fixtures/productAssurance/systemic/cockpit/fixtures/panel-observations.v1.json',
  import.meta.url,
), 'utf8'));

export const COCKPIT_FIXTURE_NOW_MS = fixture.evaluatedAtMs;

function defaultFact(semantic) {
  let valueState = 'KNOWN';
  let value;
  if (semantic.valueKind === 'ENUM') value = semantic.enumValues.find((entry) => entry !== 'UNKNOWN') ?? semantic.enumValues[0];
  else if (semantic.valueKind === 'TEXT') value = `FIXTURE_${semantic.valueKey.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
  else if (semantic.valueKind === 'BOOLEAN') value = false;
  else if (semantic.valueKind === 'NON_NEGATIVE_INTEGER') value = 0;
  else if (semantic.valueKind === 'UTC_MILLISECONDS') value = COCKPIT_FIXTURE_NOW_MS;
  else if (semantic.valueKind === 'FINITE_NUMBER') value = Math.max(0, semantic.valueConstraints.minimum ?? 0);
  else if (['NON_NEGATIVE_DECIMAL_STRING', 'SIGNED_DECIMAL_STRING'].includes(semantic.valueKind)) value = '0';
  else if (['IDENTITY_SET', 'ENUM_SET', 'PACKET_REASON_CODE_SET', 'DOMAIN_REASON_CODE_SET'].includes(semantic.valueKind)) {
    value = [];
    valueState = 'KNOWN_ABSENT';
  } else if (semantic.valueKind === 'DOMAIN_REASON_CODE') {
    value = null;
    valueState = 'KNOWN_ABSENT';
  } else throw new TypeError(`unsupported fixture value kind ${semantic.valueKind}`);
  return { key: semantic.valueKey, value, valueState, unit: semantic.unit, unknownReasonCode: null };
}

export function unavailableControlState(panel) {
  return {
    available: false,
    unavailableReasonCode: 'DIRECTOR_MOUNT_REQUIRED',
    backendMutationId: panel.controlBinding.backendMutationId,
    effectPreview: null,
    currentState: null,
    previewState: null,
    confirmState: null,
    resultState: null,
    beforeRevision: null,
    afterRevision: null,
    ledgerEvidenceRef: null,
    correlationId: null,
  };
}

export function availableControlState(panel, backendMutationId = panel.controlBinding.backendMutationId) {
  return {
    available: true,
    unavailableReasonCode: null,
    backendMutationId,
    effectPreview: {
      effectType: 'SAFETY_STATE_TRANSITION',
      summary: 'Preview the existing bounded supervisor control mutation.',
      maximumEffect: 'Changes only tested supervisor safety state; never places or mutates an order.',
    },
    currentState: { stateType: panel.controlBinding.command, value: 'FIXTURE_CURRENT_STATE' },
    previewState: 'READY_FOR_CONFIRMATION',
    confirmState: 'CONFIRMED',
    resultState: 'APPLIED',
    beforeRevision: 41,
    afterRevision: 42,
    ledgerEvidenceRef: `fixture:ledger:${panel.controlBinding.command}:42`,
    correlationId: `fixture-correlation-${panel.controlBinding.command}-42`,
  };
}

export function observationFor(panel, { controlAvailable = false } = {}) {
  const observation = structuredClone(fixture.baseLiveObservation);
  observation.contractId = panel.contractId;
  observation.sourceProvenance.canonicalOwner = panel.sourceBinding.canonicalOwner;
  observation.sourceProvenance.sourceSchemaId = panel.sourceBinding.schemaId;
  observation.sourceProvenance.sourceSchemaVersion = panel.sourceBinding.schemaVersion;
  observation.sourceProvenance.manifestItemId = panel.releaseBinding.expectedManifestItemId;
  observation.denominator = {
    expectedCount: panel.denominatorLaw.expectedCount,
    visibleCount: panel.denominatorLaw.expectedCount,
    filteredCount: 0,
    hiddenCount: 0,
    unknownCount: 0,
  };
  observation.evidence.observedCount = panel.denominatorLaw.expectedCount;

  const dashboardValues = new Map(observation.values.map((value) => [value.key, value]));
  observation.values = FACT_SEMANTICS_BY_CONTRACT[panel.contractId].map((semantic) => {
    const retained = dashboardValues.get(semantic.valueKey);
    return retained?.unit === semantic.unit ? structuredClone(retained) : defaultFact(semantic);
  });

  if (panel.contractId !== 'PANEL_DASHBOARD_TRUTH_V1') {
    observation.componentDenominator = null;
    observation.componentFacts = [];
    observation.sourceDenominator = null;
    observation.sourceAggregationDenominator = null;
    observation.sourceRows = [];
    observation.attentionDenominator = null;
    observation.attentionRows = [];
    observation.traceDenominator = null;
    observation.traceTargets = [];
  }
  observation.stateCauseEvidence = null;

  if (panel.detectionClaim.kind === 'NONE') {
    observation.detectionEvidence = {
      registeredFailureId: null,
      detectorConnected: null,
      telemetryConnected: null,
      browserConnected: null,
      sloMatched: null,
      outOfBandProofPresent: null,
    };
  } else if (panel.detectionClaim.kind === 'OUT_OF_BAND_ONLY') {
    observation.detectionEvidence = {
      registeredFailureId: panel.detectionClaim.registeredFailureId,
      detectorConnected: true,
      telemetryConnected: true,
      browserConnected: null,
      sloMatched: true,
      outOfBandProofPresent: true,
    };
  }
  observation.controlState = panel.panelKind === 'CONTROL'
    ? controlAvailable ? availableControlState(panel) : unavailableControlState(panel)
    : null;
  return observation;
}

export function allObservations(contractSet, options) {
  return contractSet.contracts.map((panel) => observationFor(panel, options));
}

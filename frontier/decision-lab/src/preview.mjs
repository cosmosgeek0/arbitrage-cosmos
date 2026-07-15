import {
  cloneCanonical,
  contractError,
  deepFreeze,
  omitFields,
  sha256,
  validateFixtureOutput,
} from '../../dock/src/index.mjs';
import {
  DECISION_LAB_LIMITATIONS,
  DECISION_DISPOSITIONS,
  validateCanonicalRef,
  validateDecisionLabReport,
} from './contracts.mjs';
import { assertBoundedStructure } from './bounds.mjs';

function fail(code, message) {
  throw contractError(code, message);
}

function exactRecord(value, fields, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('PREVIEW_RECORD_REQUIRED', `${name} must be an object`);
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  const unknown = Object.keys(value).filter((field) => !fields.includes(field));
  if (missing.length > 0 || unknown.length > 0) {
    fail('PREVIEW_FIELDS_INVALID', `${name} field mismatch: missing=${missing.join(',')} unknown=${unknown.join(',')}`);
  }
  return value;
}

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail('PREVIEW_INTEGER_INVALID', `${name} must be a non-negative safe integer`);
}

function boundedStrings(value, name, maximum = 256) {
  if (!Array.isArray(value) || value.length > maximum || value.some((entry) => typeof entry !== 'string' || entry.length === 0 || entry.length > 2_048)) {
    fail('PREVIEW_STRING_ARRAY_INVALID', `${name} must be a bounded non-empty string array`);
  }
}

export function validateDecisionLabPreview(input, sourceReport, sourceRequest) {
  assertBoundedStructure(input, 'DecisionLabPreviewV1');
  if (sourceReport === null || typeof sourceReport !== 'object' || Array.isArray(sourceReport)) {
    fail('PREVIEW_SOURCE_REPORT_REQUIRED', 'DecisionLabPreviewV1 validation requires its full source report');
  }
  assertBoundedStructure(sourceReport, 'DecisionLabPreviewV1.sourceReport');
  validateDecisionLabReport(sourceReport, sourceRequest);
  const value = exactRecord(cloneCanonical(input), [
    'schema',
    'version',
    'generatedAtMs',
    'truthClass',
    'truthLabel',
    'fixtureComposition',
    'bindingState',
    'networkMode',
    'authorityClass',
    'canonical',
    'canonicalSurfaceId',
    'mounted',
    'healthRecomputed',
    'controls',
    'reportRef',
    'decision',
    'summary',
    'alternatives',
    'ablations',
    'warnings',
    'limitations',
    'winner',
    'causalEffect',
    'profitClaim',
    'previewHash',
  ], 'DecisionLabPreviewV1');
  if (
    value.schema !== 'DecisionLabPreviewV1'
    || value.version !== 1
    || value.truthClass !== 'FIXTURE_PROJECTION'
    || !['SYNTHETIC_ONLY', 'UNVERIFIED_RECORDED_SHAPE_ONLY'].includes(value.truthLabel)
    || !['SYNTHETIC_ONLY', 'UNVERIFIED_RECORDED_SHAPE_WITH_SYNTHETIC_METADATA'].includes(value.fixtureComposition)
    || value.bindingState !== 'DIRECTOR_MOUNT_REQUIRED'
    || value.networkMode !== 'FIXTURE_ONLY'
    || value.authorityClass !== 'NO_AUTHORITY'
    || value.canonical !== false
    || value.canonicalSurfaceId !== null
    || value.mounted !== false
    || value.healthRecomputed !== false
    || !Array.isArray(value.controls)
    || value.controls.length !== 0
    || value.winner !== null
    || value.causalEffect !== null
    || value.profitClaim !== false
  ) fail('PREVIEW_BOUNDARY_INVALID', 'DecisionLabPreviewV1 widened its unmounted fixture-only boundary');
  nonNegativeInteger(value.generatedAtMs, 'DecisionLabPreviewV1.generatedAtMs');
  if (value.generatedAtMs < sourceReport.evaluatedAtMs) {
    fail('PREVIEW_TIME_INVALID', 'DecisionLabPreviewV1 cannot precede its source report evaluation');
  }

  const reportRef = exactRecord(value.reportRef, ['reportId', 'reportHash', 'fixtureClass'], 'DecisionLabPreviewV1.reportRef');
  if (!/^dl_report_[a-f0-9]{64}$/.test(reportRef.reportId) || !/^[a-f0-9]{64}$/.test(reportRef.reportHash)) {
    fail('PREVIEW_REPORT_REF_INVALID', 'DecisionLabPreviewV1 report identity must be SHA-256 bound');
  }
  if (reportRef.reportId !== `dl_report_${reportRef.reportHash}`) fail('PREVIEW_REPORT_REF_INVALID', 'DecisionLabPreviewV1 report ID must match report hash');
  if (!['SYNTHETIC_FIXTURE', 'UNVERIFIED_RECORDED_SHAPE_FIXTURE'].includes(reportRef.fixtureClass)) fail('PREVIEW_FIXTURE_CLASS_INVALID', 'DecisionLabPreviewV1 fixture class is invalid');
  if ((reportRef.fixtureClass === 'SYNTHETIC_FIXTURE') !== (value.truthLabel === 'SYNTHETIC_ONLY')
    || (reportRef.fixtureClass === 'SYNTHETIC_FIXTURE') !== (value.fixtureComposition === 'SYNTHETIC_ONLY')) {
    fail('PREVIEW_TRUTH_LABEL_INVALID', 'DecisionLabPreviewV1 truth label must match its fixture class');
  }

  const decision = exactRecord(value.decision, [
    'decisionContextId',
    'disposition',
    'informationCutoffMs',
    'canonicalDecisionRef',
  ], 'DecisionLabPreviewV1.decision');
  if (!/^dl_decision_[a-f0-9]{64}$/.test(decision.decisionContextId) || !DECISION_DISPOSITIONS.includes(decision.disposition)) {
    fail('PREVIEW_DECISION_INVALID', 'DecisionLabPreviewV1 decision identity or disposition is invalid');
  }
  nonNegativeInteger(decision.informationCutoffMs, 'DecisionLabPreviewV1.decision.informationCutoffMs');
  validateCanonicalRef(decision.canonicalDecisionRef, 'DecisionLabPreviewV1.decision.canonicalDecisionRef');

  const summary = exactRecord(value.summary, [
    'decisionDisposition',
    'alternativeCount',
    'descriptiveComparisonCount',
    'unavailableAlternativeCount',
    'ablationCount',
    'unavailableAblationCount',
  ], 'DecisionLabPreviewV1.summary');
  if (summary.decisionDisposition !== decision.disposition) fail('PREVIEW_SUMMARY_INVALID', 'DecisionLabPreviewV1 summary disposition must match its decision');
  for (const field of ['alternativeCount', 'descriptiveComparisonCount', 'unavailableAlternativeCount', 'ablationCount', 'unavailableAblationCount']) {
    nonNegativeInteger(summary[field], `DecisionLabPreviewV1.summary.${field}`);
  }

  if (!Array.isArray(value.alternatives) || value.alternatives.length !== summary.alternativeCount || value.alternatives.length > 12) {
    fail('PREVIEW_ALTERNATIVES_INVALID', 'DecisionLabPreviewV1 alternatives must match its bounded summary');
  }
  for (const [index, inputAlternative] of value.alternatives.entries()) {
    const alternative = exactRecord(inputAlternative, [
      'alternativeId',
      'kind',
      'role',
      'comparisonStatus',
      'outcomeState',
      'realizationClass',
      'supportStatus',
      'selected',
      'rank',
    ], `DecisionLabPreviewV1.alternatives[${index}]`);
    if (
      typeof alternative.alternativeId !== 'string'
      || alternative.alternativeId.length === 0
      || alternative.alternativeId.length > 256
      || !['NO_TRADE', 'EARLIER_TIMING', 'DELAYED_TIMING', 'THRESHOLD', 'ENTRY', 'EXIT', 'EXECUTION_POLICY'].includes(alternative.kind)
      || !['OBSERVED_DECISION', 'COUNTERFACTUAL_ALTERNATIVE'].includes(alternative.role)
      || !['DESCRIPTIVE_PATH_REPLAY', 'NOT_COMPARABLE_IMPOSSIBLE_AT_CUTOFF', 'ABSTAIN_UNKNOWN_FEASIBILITY', 'ABSTAIN_UNKNOWN_OUTCOME'].includes(alternative.comparisonStatus)
      || !['AVAILABLE', 'UNAVAILABLE'].includes(alternative.outcomeState)
      || !['REALIZED', 'HYPOTHETICAL_PATH_CONDITIONAL', 'NOT_APPLICABLE_NO_POSITION', 'UNAVAILABLE'].includes(alternative.realizationClass)
      || !['PRESENT', 'ABSENT', 'UNKNOWN'].includes(alternative.supportStatus)
      || alternative.selected !== false
      || alternative.rank !== null
      || (alternative.role === 'COUNTERFACTUAL_ALTERNATIVE' && alternative.realizationClass === 'REALIZED')
      || (alternative.outcomeState === 'UNAVAILABLE' && alternative.realizationClass !== 'UNAVAILABLE')
      || (alternative.outcomeState === 'AVAILABLE' && alternative.realizationClass === 'UNAVAILABLE')
      || (alternative.comparisonStatus === 'DESCRIPTIVE_PATH_REPLAY' && alternative.outcomeState !== 'AVAILABLE')
      || (alternative.kind === 'NO_TRADE' && alternative.outcomeState === 'AVAILABLE' && alternative.realizationClass !== 'NOT_APPLICABLE_NO_POSITION')
    ) fail('PREVIEW_ALTERNATIVE_BOUNDARY_INVALID', 'DecisionLabPreviewV1 cannot select, rank, or widen an alternative');
  }
  const alternativeIds = value.alternatives.map((entry) => entry.alternativeId);
  if (new Set(alternativeIds).size !== alternativeIds.length
    || value.alternatives.filter((entry) => entry.role === 'OBSERVED_DECISION').length !== 1
    || new Set(value.alternatives.map((entry) => entry.kind)).size !== 7) {
    fail('PREVIEW_ALTERNATIVE_COVERAGE_INVALID', 'DecisionLabPreviewV1 alternatives must be unique, complete, and contain one observed decision');
  }

  if (!Array.isArray(value.ablations) || value.ablations.length !== summary.ablationCount || value.ablations.length > 64) {
    fail('PREVIEW_ABLATIONS_INVALID', 'DecisionLabPreviewV1 ablations must match its bounded summary');
  }
  for (const [index, inputAblation] of value.ablations.entries()) {
    const ablation = exactRecord(inputAblation, [
      'ablationId',
      'kind',
      'variantState',
      'interpretation',
    ], `DecisionLabPreviewV1.ablations[${index}]`);
    if (
      typeof ablation.ablationId !== 'string'
      || ablation.ablationId.length === 0
      || ablation.ablationId.length > 256
      || !['Q_ASSISTED_VS_MARKET_ONLY', 'REMOVE_EVIDENCE_SOURCE', 'REMOVE_FEATURE_FAMILY'].includes(ablation.kind)
      || !['AVAILABLE', 'UNAVAILABLE'].includes(ablation.variantState)
      || ablation.interpretation !== 'SENSITIVITY_ONLY_NOT_CAUSAL_CONTRIBUTION'
    ) fail('PREVIEW_ABLATION_BOUNDARY_INVALID', 'DecisionLabPreviewV1 ablation widened beyond sensitivity-only');
  }
  const ablationIds = value.ablations.map((entry) => entry.ablationId);
  if (new Set(ablationIds).size !== ablationIds.length
    || new Set(value.ablations.map((entry) => entry.kind)).size !== 3) {
    fail('PREVIEW_ABLATION_COVERAGE_INVALID', 'DecisionLabPreviewV1 ablations must be unique and cover all three classes');
  }
  if (
    summary.descriptiveComparisonCount !== value.alternatives.filter((entry) => entry.comparisonStatus === 'DESCRIPTIVE_PATH_REPLAY').length
    || summary.unavailableAlternativeCount !== value.alternatives.filter((entry) => entry.outcomeState === 'UNAVAILABLE').length
    || summary.unavailableAblationCount !== value.ablations.filter((entry) => entry.variantState === 'UNAVAILABLE').length
  ) fail('PREVIEW_SUMMARY_INVALID', 'DecisionLabPreviewV1 summary counts must match projected rows');
  boundedStrings(value.warnings, 'DecisionLabPreviewV1.warnings');
  boundedStrings(value.limitations, 'DecisionLabPreviewV1.limitations');
  const mandatoryWarnings = [
    'ALTERNATIVES_NOT_OPTIMIZED_OR_RANKED',
    'BIAS_NOT_ELIMINATED',
    'COUNTERFACTUALS_ARE_PATH_CONDITIONAL_HYPOTHESES',
    'DESCRIPTIVE_PATH_REPLAY_NOT_CAUSAL',
    'FINAL_HOLDOUT_NOT_ACCESSED_OR_OPTIMIZED',
    'SINGLE_DECISION_OPE_NOT_APPLICABLE',
  ];
  const biasPrefixes = ['SELECTION_BIAS_', 'SURVIVORSHIP_BIAS_', 'HINDSIGHT_RISK_', 'COPIED_SOURCE_RISK_', 'CONFOUNDING_'];
  if (
    mandatoryWarnings.some((warning) => !value.warnings.includes(warning))
    || biasPrefixes.some((prefix) => !value.warnings.some((warning) => warning.startsWith(prefix)))
  ) fail('PREVIEW_WARNINGS_INVALID', 'DecisionLabPreviewV1 must preserve every mandatory caveat and bias warning');
  if (sha256(value.limitations) !== sha256(DECISION_LAB_LIMITATIONS)) {
    fail('PREVIEW_LIMITATIONS_INVALID', 'DecisionLabPreviewV1 must preserve the exact DecisionLab limitations');
  }
  if (!/^[a-f0-9]{64}$/.test(value.previewHash)
    || value.previewHash !== sha256(omitFields(value, ['previewHash']))) {
    fail('PREVIEW_HASH_MISMATCH', 'DecisionLabPreviewV1 previewHash does not match canonical preview bytes');
  }
  const expected = buildPreviewUnchecked(sourceReport, value.generatedAtMs);
  if (sha256(value) !== sha256(expected)) {
    fail('PREVIEW_SOURCE_MISMATCH', 'DecisionLabPreviewV1 must be the exact projection of its full validated source report');
  }
  validateFixtureOutput(value);
  return true;
}

function buildPreviewUnchecked(report, generatedAtMs) {
  const core = {
    schema: 'DecisionLabPreviewV1',
    version: 1,
    generatedAtMs,
    truthClass: 'FIXTURE_PROJECTION',
    truthLabel: report.truthLabel,
    fixtureComposition: report.fixtureComposition,
    bindingState: 'DIRECTOR_MOUNT_REQUIRED',
    networkMode: 'FIXTURE_ONLY',
    authorityClass: 'NO_AUTHORITY',
    canonical: false,
    canonicalSurfaceId: null,
    mounted: false,
    healthRecomputed: false,
    controls: Object.freeze([]),
    reportRef: deepFreeze({
      reportId: report.reportId,
      reportHash: report.reportHash,
      fixtureClass: report.fixtureClass,
    }),
    decision: deepFreeze({
      decisionContextId: report.decision.decisionContextId,
      disposition: report.decision.disposition,
      informationCutoffMs: report.decision.informationCutoffMs,
      canonicalDecisionRef: report.decision.canonicalDecisionRef,
    }),
    summary: report.summary,
    alternatives: Object.freeze(report.alternatives.map((alternative) => deepFreeze({
      alternativeId: alternative.alternativeId,
      kind: alternative.kind,
      role: alternative.role,
      comparisonStatus: alternative.comparisonStatus,
      outcomeState: alternative.outcome.state,
      realizationClass: alternative.outcome.realizationClass,
      supportStatus: alternative.support.supportStatus,
      selected: false,
      rank: null,
    }))),
    ablations: Object.freeze(report.ablations.map((ablation) => deepFreeze({
      ablationId: ablation.ablationId,
      kind: ablation.kind,
      variantState: ablation.variant.state,
      interpretation: ablation.interpretation,
    }))),
    warnings: report.warnings,
    limitations: report.limitations,
    winner: null,
    causalEffect: null,
    profitClaim: false,
  };
  return deepFreeze({ ...core, previewHash: sha256(core) });
}

export function projectDecisionLabPreview(report, generatedAtMs, sourceRequest) {
  validateDecisionLabReport(report, sourceRequest);
  if (!Number.isSafeInteger(generatedAtMs) || generatedAtMs < report.evaluatedAtMs || Object.is(generatedAtMs, -0)) {
    throw new TypeError('generatedAtMs must be an injected UTC millisecond at or after report evaluation');
  }
  const preview = buildPreviewUnchecked(report, generatedAtMs);
  validateDecisionLabPreview(preview, report, sourceRequest);
  validateFixtureOutput(preview);
  return preview;
}

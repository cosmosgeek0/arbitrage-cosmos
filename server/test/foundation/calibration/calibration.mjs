#!/usr/bin/env node
/**
 * Wave 3 — deterministic proposal outcome/calibration proof.
 * ZERO network, ZERO wall clock, ZERO automatic strategy mutation.
 * Run after `npm run build -w server`:
 *   node server/test/foundation/calibration/calibration.mjs
 */
import * as calibration from '../../../dist/foundation/calibration/index.js';

const {
  CALIBRATION_FAILURE_CODES,
  MAX_CALIBRATION_RECORDS,
  PROBABILITY_PPM_SCALE,
  PROPOSAL_OUTCOME_SCHEMA,
  aggregateProposalOutcomes,
  recordProposalOutcome,
} = calibration;

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) { console.log(`\n${title}`); }
function throwsTypeError(fn) {
  try { fn(); return false; } catch (error) { return error instanceof TypeError; }
}

const T0 = 1_800_000_000_000;
const CONTEXT = Object.freeze({ nowMs: T0, correlationId: 'cor_calibration_test' });
const COHORT = Object.freeze({
  source: 'BASIS',
  strategySchema: 'basis.proposal-outcome.v1',
  configVersion: 'cfg_basis_v1',
  direction: 'LONG_SPOT_SHORT_PERP',
  resultUnit: 'USD_MICROS',
  observationHorizonMs: 8_000,
});

function completeInput(name = 'one', overrides = {}) {
  const base = {
    canonicalProposalId: `cprop_calibration_${name}`,
    planId: `plan_calibration_${name}`,
    source: 'BASIS',
    strategySchema: 'basis.proposal-outcome.v1',
    configVersion: 'cfg_basis_v1',
    direction: 'LONG_SPOT_SHORT_PERP',
    resultUnit: 'USD_MICROS',
    proposalObservedAtMs: T0 - 10_000,
    observationWindow: { startAtMs: T0 - 9_000, endAtMs: T0 - 1_000 },
    status: 'COMPLETE',
    finalizedAtMs: T0 - 500,
    predictedProbabilityPpm: 750_000,
    realizedSuccess: true,
    grossResultMicrounits: 2_000_000,
    feesMicrounits: 100_000,
    slippageMicrounits: 50_000,
    otherCostsMicrounits: 25_000,
    netResultMicrounits: 1_825_000,
    fillRatioPpm: 1_000_000,
  };
  return {
    ...base,
    ...overrides,
    observationWindow: {
      ...base.observationWindow,
      ...(overrides.observationWindow ?? {}),
    },
  };
}

function incompleteInput(name = 'incomplete', overrides = {}) {
  return completeInput(name, {
    status: 'INCOMPLETE',
    finalizedAtMs: null,
    realizedSuccess: null,
    grossResultMicrounits: null,
    feesMicrounits: null,
    slippageMicrounits: null,
    otherCostsMicrounits: null,
    netResultMicrounits: null,
    fillRatioPpm: null,
    ...overrides,
  });
}

function recordOf(input, context = CONTEXT) {
  const result = recordProposalOutcome(input, context);
  if (!result.ok) throw new Error(`record fixture failed: ${result.failure.code} ${result.failure.message}`);
  return result.value;
}

function reportResult(records, cohort = COHORT, nowMs = T0, extra = {}) {
  return aggregateProposalOutcomes({
    nowMs,
    correlationId: 'cor_calibration_report',
    cohort: { ...cohort },
    records,
    ...extra,
  });
}

function reportOf(records, cohort = COHORT, nowMs = T0) {
  const result = reportResult(records, cohort, nowMs);
  if (!result.ok) throw new Error(`report fixture failed: ${result.failure.code} ${result.failure.message}`);
  return result.value;
}

// =====================================================================
section('1. complete proposal outcome is identity-bound, immutable, and deterministic');
{
  const input = completeInput();
  const before = JSON.stringify(input);
  const result = recordProposalOutcome(input, CONTEXT);
  check('complete record succeeds', result.ok);
  const record = result.value;
  check('record uses versioned schema', record.schema === PROPOSAL_OUTCOME_SCHEMA && record.schemaVersion === 1);
  check('stable outcome/fingerprint prefixes', record.outcomeId.startsWith('calout_') && record.contentFingerprint.startsWith('calfp_'));
  check('proposal and plan are bound', record.canonicalProposalId === input.canonicalProposalId && record.planId === input.planId);
  check('source/config/schema/direction/unit are bound', record.source === input.source && record.configVersion === input.configVersion && record.strategySchema === input.strategySchema && record.direction === input.direction && record.resultUnit === input.resultUnit);
  check('full observation window is bound', record.proposalObservedAtMs === input.proposalObservedAtMs && record.observationWindow.startAtMs === input.observationWindow.startAtMs && record.observationWindow.endAtMs === input.observationWindow.endAtMs);
  check('injected record time preserved', record.recordedAtMs === T0);
  check('all exact economics preserved', record.grossResultMicrounits === 2_000_000 && record.feesMicrounits === 100_000 && record.netResultMicrounits === 1_825_000);
  check('builder does not mutate input', JSON.stringify(input) === before);
  check('record and nested window are frozen', Object.isFrozen(record) && Object.isFrozen(record.observationWindow));

  const repeated = recordOf(completeInput());
  check('same binding/content produces same IDs', repeated.outcomeId === record.outcomeId && repeated.contentFingerprint === record.contentFingerprint);
  const laterCapture = recordOf(completeInput(), { nowMs: T0 + 1, correlationId: 'cor_later_capture' });
  check('capture time does not rewrite semantic identity', laterCapture.recordedAtMs === T0 + 1 && laterCapture.outcomeId === record.outcomeId && laterCapture.contentFingerprint === record.contentFingerprint);

  const changedOutcome = recordOf(completeInput('one', { predictedProbabilityPpm: 700_000 }));
  check('outcome change keeps logical ID but changes fingerprint', changedOutcome.outcomeId === record.outcomeId && changedOutcome.contentFingerprint !== record.contentFingerprint);

  const bindingVariants = [
    completeInput('one', { planId: 'plan_calibration_other' }),
    completeInput('one', { source: 'VOLUME' }),
    completeInput('one', { strategySchema: 'basis.proposal-outcome.v2' }),
    completeInput('one', { configVersion: 'cfg_basis_v2' }),
    completeInput('one', { direction: 'SHORT_SPOT_LONG_PERP' }),
    completeInput('one', { resultUnit: 'QUOTE_ASSET_MICROS' }),
    completeInput('one', { observationWindow: { startAtMs: T0 - 8_999 } }),
  ].map((value) => recordOf(value));
  check('every required binding dimension changes logical ID', bindingVariants.every((value) => value.outcomeId !== record.outcomeId));
}

// =====================================================================
section('2. incomplete and missing economic facts never become fabricated zero');
{
  const incomplete = recordOf(incompleteInput('late-incomplete', {
    grossResultMicrounits: 123_000,
  }));
  check('incomplete remains INCOMPLETE after window ended', incomplete.status === 'INCOMPLETE' && incomplete.finalizedAtMs === null && incomplete.realizedSuccess === null);
  check('partial known evidence may be retained without completion', incomplete.grossResultMicrounits === 123_000 && incomplete.feesMicrounits === null);
  const incompleteReport = reportOf([incomplete]);
  check('incomplete record excluded from metrics', incompleteReport.includedCount === 0 && incompleteReport.metrics.completeCount === 0);
  check('incomplete exclusion is named and counted', incompleteReport.exclusions[0].reason === 'OUTCOME_INCOMPLETE' && incompleteReport.exclusions[0].count === 1);
  check('empty metric aggregates are null, never fake zero', incompleteReport.metrics.netResult.sum === null && incompleteReport.metrics.successRate === null && incompleteReport.metrics.probability.brierLoss === null);

  const missingCosts = recordOf(completeInput('missing-costs', {
    feesMicrounits: null,
    netResultMicrounits: null,
    fillRatioPpm: null,
  }));
  check('complete record can preserve genuinely missing cost/fill', missingCosts.status === 'COMPLETE' && missingCosts.feesMicrounits === null && missingCosts.netResultMicrounits === null && missingCosts.fillRatioPpm === null);
  const missingReport = reportOf([missingCosts]);
  check('missing costs do not erase independent complete outcome', missingReport.includedCount === 1 && missingReport.metrics.successCount === 1);
  check('missing fee aggregate is null with denominator zero', missingReport.metrics.fees.knownCount === 0 && missingReport.metrics.fees.missingCount === 1 && missingReport.metrics.fees.sum === null && missingReport.metrics.fees.mean === null);
  check('known gross remains independently aggregatable', missingReport.metrics.grossResult.sum === '2000000' && missingReport.metrics.grossResult.knownCount === 1);
  check('missing fields are named', ['MISSING_FEES', 'MISSING_NET_RESULT', 'MISSING_FILL_RATIO'].every((reason) => missingReport.missingEvidence.some((item) => item.reason === reason && item.count === 1)));
  check('not fully attributed when any economic evidence missing', missingReport.metrics.fullyObservedEconomicCount === 0);

  const explicitZero = recordOf(completeInput('zero-fee', {
    feesMicrounits: 0,
    netResultMicrounits: 1_925_000,
  }));
  const zeroReport = reportOf([explicitZero]);
  check('observed zero fee is known zero, distinct from null', zeroReport.metrics.fees.knownCount === 1 && zeroReport.metrics.fees.missingCount === 0 && zeroReport.metrics.fees.sum === '0');
  check('zero mean remains exact fraction', zeroReport.metrics.fees.mean.numerator === '0' && zeroReport.metrics.fees.mean.denominator === '1');

  const missingProbability = recordOf(completeInput('missing-probability', {
    predictedProbabilityPpm: null,
  }));
  const probabilityReport = reportOf([missingProbability]);
  check('missing probability stays null on record', missingProbability.predictedProbabilityPpm === null);
  check('missing probability excludes only calibration score', probabilityReport.metrics.probability.knownCount === 0 && probabilityReport.metrics.probability.brierLoss === null && probabilityReport.metrics.successCount === 1);
}

// =====================================================================
section('3. Brier, rates, and economic sums use exact rational/integer arithmetic');
{
  const positive = recordOf(completeInput('brier-positive', {
    predictedProbabilityPpm: 800_000,
    realizedSuccess: true,
  }));
  const negative = recordOf(completeInput('brier-negative', {
    predictedProbabilityPpm: 200_000,
    realizedSuccess: false,
  }));
  const missing = recordOf(completeInput('brier-missing', {
    predictedProbabilityPpm: null,
    realizedSuccess: true,
  }));
  const scored = reportOf([positive, negative, missing]);
  check('probability scale explicitly PPM', scored.metrics.probability.scalePpm === PROBABILITY_PPM_SCALE);
  check('Brier denominator uses only probability-eligible records', scored.metrics.probability.knownCount === 2 && scored.metrics.probability.missingCount === 1);
  check('binary Brier loss exactly 1/25', scored.metrics.probability.brierLoss.numerator === '1' && scored.metrics.probability.brierLoss.denominator === '25');
  check('mean predicted probability exactly 1/2', scored.metrics.probability.meanPredictedProbability.numerator === '1' && scored.metrics.probability.meanPredictedProbability.denominator === '2');
  check('observed frequency on same eligible subset exactly 1/2', scored.metrics.probability.observedPositiveFrequency.numerator === '1' && scored.metrics.probability.observedPositiveFrequency.denominator === '2');
  check('overall success rate uses all complete outcomes', scored.metrics.successRate.numerator === '2' && scored.metrics.successRate.denominator === '3');

  const maximum = Number.MAX_SAFE_INTEGER;
  const hugeA = recordOf(completeInput('huge-a', {
    grossResultMicrounits: maximum,
    feesMicrounits: 0,
    slippageMicrounits: 0,
    otherCostsMicrounits: 0,
    netResultMicrounits: maximum,
  }));
  const hugeB = recordOf(completeInput('huge-b', {
    grossResultMicrounits: maximum,
    feesMicrounits: 0,
    slippageMicrounits: 0,
    otherCostsMicrounits: 0,
    netResultMicrounits: maximum,
  }));
  const huge = reportOf([hugeA, hugeB]);
  check('sum beyond Number safe range remains exact decimal string', huge.metrics.netResult.sum === '18014398509481982', huge.metrics.netResult.sum);
  check('exact mean is reduced without float rounding', huge.metrics.netResult.mean.numerator === String(maximum) && huge.metrics.netResult.mean.denominator === '1');

  const signedA = recordOf(completeInput('signed-a', {
    grossResultMicrounits: -100,
    feesMicrounits: 0,
    slippageMicrounits: 0,
    otherCostsMicrounits: 0,
    netResultMicrounits: -100,
  }));
  const signedB = recordOf(completeInput('signed-b', {
    grossResultMicrounits: 50,
    feesMicrounits: 0,
    slippageMicrounits: 0,
    otherCostsMicrounits: 0,
    netResultMicrounits: 50,
  }));
  const signed = reportOf([signedA, signedB]);
  check('signed results cancel exactly', signed.metrics.netResult.sum === '-50');
  check('negative rational mean stays exact', signed.metrics.netResult.mean.numerator === '-25' && signed.metrics.netResult.mean.denominator === '1');
}

// =====================================================================
section('4. source/schema/config/direction/unit/horizon cohorts never blend');
{
  const matching = recordOf(completeInput('cohort-match'));
  const sourceMismatch = recordOf(completeInput('cohort-source', { source: 'VOLUME' }));
  const schemaMismatch = recordOf(completeInput('cohort-schema', { strategySchema: 'basis.proposal-outcome.v2' }));
  const configMismatch = recordOf(completeInput('cohort-config', { configVersion: 'cfg_basis_v2' }));
  const directionMismatch = recordOf(completeInput('cohort-direction', { direction: 'SHORT_SPOT_LONG_PERP' }));
  const unitMismatch = recordOf(completeInput('cohort-unit', { resultUnit: 'QUOTE_ASSET_MICROS' }));
  const horizonMismatch = recordOf(completeInput('cohort-horizon', {
    proposalObservedAtMs: T0 - 11_000,
    observationWindow: { startAtMs: T0 - 10_000, endAtMs: T0 - 1_000 },
  }));
  const incomplete = recordOf(incompleteInput('cohort-incomplete'));
  const report = reportOf([
    horizonMismatch,
    unitMismatch,
    incomplete,
    directionMismatch,
    configMismatch,
    schemaMismatch,
    sourceMismatch,
    matching,
  ]);
  check('only exact-compatible complete record included', report.includedCount === 1 && report.includedOutcomeIds[0] === matching.outcomeId);
  check('all incompatible/incomplete records excluded', report.excludedCount === 7 && report.exclusions.reduce((sum, item) => sum + item.count, 0) === 7);
  const expectedReasons = [
    'SOURCE_MISMATCH',
    'STRATEGY_SCHEMA_MISMATCH',
    'CONFIG_VERSION_MISMATCH',
    'DIRECTION_MISMATCH',
    'RESULT_UNIT_MISMATCH',
    'OBSERVATION_HORIZON_MISMATCH',
    'OUTCOME_INCOMPLETE',
  ];
  check('each incompatibility has a named reason', expectedReasons.every((reason) => report.exclusions.some((item) => item.reason === reason && item.count === 1)));
  check('exclusions are deterministic code-unit ordered', report.exclusions.map((item) => item.reason).join('|') === [...report.exclusions].map((item) => item.reason).sort().join('|'));
  check('metrics use included cohort only', report.metrics.completeCount === 1 && report.metrics.netResult.sum === '1825000');
  check('input accounting balances', report.inputRecordCount === report.uniqueRecordCount + report.duplicateIdenticalCount && report.uniqueRecordCount === report.includedCount + report.excludedCount);

  const v2Cohort = { ...COHORT, configVersion: 'cfg_basis_v2' };
  const versionReport = reportOf([matching, configMismatch], v2Cohort);
  check('v2 target includes v2 only', versionReport.includedCount === 1 && versionReport.includedOutcomeIds[0] === configMismatch.outcomeId);
  check('v1 explicitly excluded from v2 metrics', versionReport.exclusions.some((item) => item.reason === 'CONFIG_VERSION_MISMATCH' && item.outcomeIds.includes(matching.outcomeId)));
  check('configuration version changes cohort identity', versionReport.cohortId !== report.cohortId);

  const noCompatible = reportOf([configMismatch], COHORT);
  check('zero compatible records produce unavailable metrics', noCompatible.includedCount === 0 && noCompatible.metrics.netResult.sum === null && noCompatible.metrics.successRate === null);
}

// =====================================================================
section('5. duplicate identity is idempotent or rejected before cohorting');
{
  const one = recordOf(completeInput('duplicate'));
  const exactDuplicate = structuredClone(one);
  const deduped = reportOf([one, exactDuplicate]);
  check('exact duplicate contributes once', deduped.inputRecordCount === 2 && deduped.uniqueRecordCount === 1 && deduped.includedCount === 1);
  check('exact duplicate count is explicit', deduped.duplicateIdenticalCount === 1);

  const laterDuplicate = recordOf(completeInput('duplicate'), {
    nowMs: T0 + 1,
    correlationId: 'cor_duplicate_later',
  });
  const repeatedCapture = reportOf([laterDuplicate, one], COHORT, T0 + 1);
  check('same semantic capture at another injected time dedupes', repeatedCapture.uniqueRecordCount === 1 && repeatedCapture.duplicateIdenticalCount === 1);

  const conflict = recordOf(completeInput('duplicate', { predictedProbabilityPpm: 100_000 }));
  const conflictResult = reportResult([one, conflict]);
  check('same logical identity with different content rejected', !conflictResult.ok && conflictResult.failure.code === CALIBRATION_FAILURE_CODES.IDENTITY_CONFLICT);

  const incompleteConflict = recordOf(incompleteInput('duplicate'));
  const lifecycleConflict = reportResult([one, incompleteConflict]);
  check('incomplete/complete collision is never last-write-wins', !lifecycleConflict.ok && lifecycleConflict.failure.code === CALIBRATION_FAILURE_CODES.IDENTITY_CONFLICT);

  const samePayloadDifferentIdentity = recordOf(completeInput('duplicate-other'));
  const two = reportOf([one, samePayloadDifferentIdentity]);
  check('same payload under distinct proposal identity counts twice', two.uniqueRecordCount === 2 && two.includedCount === 2);

  const ordered = reportOf([one, samePayloadDifferentIdentity]);
  const reversed = reportOf([samePayloadDifferentIdentity, one]);
  check('permuted input produces byte-identical report', JSON.stringify(ordered) === JSON.stringify(reversed));
  check('included outcome IDs are total-ordered', ordered.includedOutcomeIds.join('|') === [...ordered.includedOutcomeIds].sort().join('|'));
  check('report and cohort identities repeat deterministically', ordered.reportId === reportOf([one, samePayloadDifferentIdentity]).reportId && ordered.cohortId === reversed.cohortId);
}

// =====================================================================
section('6. malformed and contradictory evidence fails explicitly');
{
  const malformed = [
    ['non-object input', null],
    ['bad proposal ID', completeInput('bad-proposal', { canonicalProposalId: 'proposal_x' })],
    ['bad plan ID', completeInput('bad-plan', { planId: 'execution_x' })],
    ['bad source', completeInput('bad-source', { source: 'OTHER' })],
    ['empty schema', completeInput('bad-schema', { strategySchema: '' })],
    ['empty config version', completeInput('bad-config', { configVersion: '' })],
    ['empty direction', completeInput('bad-direction', { direction: '' })],
    ['unsupported unit', completeInput('bad-unit', { resultUnit: 'USDT' })],
    ['window order', completeInput('bad-window', { observationWindow: { startAtMs: T0 - 1_000, endAtMs: T0 - 1_000 } })],
    ['window before proposal', completeInput('bad-window-start', { observationWindow: { startAtMs: T0 - 11_000 } })],
    ['complete before window end', completeInput('bad-early', { observationWindow: { endAtMs: T0 + 1 }, finalizedAtMs: T0 })],
    ['complete missing success', completeInput('bad-success', { realizedSuccess: null })],
    ['incomplete claiming success', incompleteInput('bad-incomplete-success', { realizedSuccess: false })],
    ['incomplete finalized', incompleteInput('bad-incomplete-final', { finalizedAtMs: T0 })],
    ['probability out of range', completeInput('bad-probability', { predictedProbabilityPpm: 1_000_001 })],
    ['fill ratio out of range', completeInput('bad-fill', { fillRatioPpm: 1_000_001 })],
    ['negative fee', completeInput('bad-fee', { feesMicrounits: -1 })],
    ['fractional result', completeInput('bad-fraction', { grossResultMicrounits: 1.5 })],
    ['unsafe integer', completeInput('bad-unsafe', { grossResultMicrounits: Number.MAX_SAFE_INTEGER + 1 })],
    ['contradictory net', completeInput('bad-net', { netResultMicrounits: 99 })],
  ];
  for (const [name, input] of malformed) {
    const result = recordProposalOutcome(input, CONTEXT);
    check(`${name} rejected by value`, !result.ok && result.failure.code === CALIBRATION_FAILURE_CODES.EVIDENCE_INVALID);
  }

  const extraField = completeInput('extra');
  extraField.threshold = 0.5;
  check('unknown outcome field rejected', !recordProposalOutcome(extraField, CONTEXT).ok);
  const symbolField = completeInput('symbol-field');
  symbolField[Symbol('threshold')] = 0.5;
  check('symbol outcome field rejected', !recordProposalOutcome(symbolField, CONTEXT).ok);
  let outcomeGetterCalls = 0;
  const accessorOutcome = completeInput('accessor-outcome');
  Object.defineProperty(accessorOutcome, 'feesMicrounits', {
    enumerable: true,
    get() { outcomeGetterCalls += 1; return 0; },
  });
  check('outcome accessors rejected without invocation', !recordProposalOutcome(accessorOutcome, CONTEXT).ok && outcomeGetterCalls === 0);
  let windowGetterCalls = 0;
  const accessorWindow = completeInput('accessor-window');
  Object.defineProperty(accessorWindow.observationWindow, 'startAtMs', {
    enumerable: true,
    get() { windowGetterCalls += 1; return T0 - 9_000; },
  });
  check('window accessors rejected without invocation', !recordProposalOutcome(accessorWindow, CONTEXT).ok && windowGetterCalls === 0);
  let contextGetterCalls = 0;
  const accessorContext = { correlationId: 'cor_accessor' };
  Object.defineProperty(accessorContext, 'nowMs', {
    enumerable: true,
    get() { contextGetterCalls += 1; return T0; },
  });
  check('context accessors throw without invocation', throwsTypeError(() => recordProposalOutcome(completeInput('context-accessor'), accessorContext)) && contextGetterCalls === 0);
  check('invalid record clock throws TypeError', throwsTypeError(() => recordProposalOutcome(completeInput('clock'), { nowMs: NaN, correlationId: 'cor_x' })));
  check('invalid record correlation throws TypeError', throwsTypeError(() => recordProposalOutcome(completeInput('correlation'), { nowMs: T0, correlationId: '' })));

  const valid = recordOf(completeInput('aggregate-valid'));
  const sparse = new Array(1);
  const sparseResult = reportResult(sparse);
  check('sparse record array rejected without throw', !sparseResult.ok && sparseResult.failure.code === CALIBRATION_FAILURE_CODES.EVIDENCE_INVALID);
  const sideProperty = [valid]; sideProperty.apiKey = 'forbidden-fixture';
  check('record array named side-property rejected', !reportResult(sideProperty).ok);
  const symbolArray = [valid]; symbolArray[Symbol('private')] = true;
  check('record array symbol property rejected', !reportResult(symbolArray).ok);
  let elementGetterCalls = 0;
  const accessorRecords = [];
  Object.defineProperty(accessorRecords, '0', {
    enumerable: true,
    configurable: true,
    get() { elementGetterCalls += 1; return valid; },
  });
  accessorRecords.length = 1;
  check('record-array accessors rejected without invocation', !reportResult(accessorRecords).ok && elementGetterCalls === 0);
  const oversized = Array(MAX_CALIBRATION_RECORDS + 1).fill(valid);
  const oversizedResult = reportResult(oversized);
  check('record count is bounded before per-record work', !oversizedResult.ok && oversizedResult.failure.code === CALIBRATION_FAILURE_CODES.EVIDENCE_INVALID && oversizedResult.failure.message.length < 10_000);

  const tamperedId = structuredClone(valid);
  tamperedId.outcomeId = 'calout_tampered';
  check('tampered outcome identity rejected', !reportResult([tamperedId]).ok);
  const tamperedFingerprint = structuredClone(valid);
  tamperedFingerprint.contentFingerprint = 'calfp_tampered';
  check('tampered content fingerprint rejected', !reportResult([tamperedFingerprint]).ok);
  const futureRecord = structuredClone(valid);
  futureRecord.recordedAtMs = T0 + 1;
  check('recorded evidence from future rejected', !reportResult([futureRecord]).ok);

  const badCohort = { ...COHORT, observationHorizonMs: 0 };
  check('invalid cohort rejected by value', !reportResult([valid], badCohort).ok);
  let cohortGetterCalls = 0;
  const accessorCohort = { ...COHORT };
  Object.defineProperty(accessorCohort, 'configVersion', {
    enumerable: true,
    get() { cohortGetterCalls += 1; return 'cfg_basis_v1'; },
  });
  const accessorCohortResult = aggregateProposalOutcomes({
    nowMs: T0,
    correlationId: 'cor_accessor_cohort',
    cohort: accessorCohort,
    records: [valid],
  });
  check('cohort accessors rejected without invocation', !accessorCohortResult.ok && cohortGetterCalls === 0);
  const extraRequest = reportResult([valid], COHORT, T0, { hiddenPolicy: true });
  check('unknown aggregation field rejected', !extraRequest.ok);
  check('invalid report clock throws TypeError', throwsTypeError(() => aggregateProposalOutcomes({ nowMs: NaN, correlationId: 'cor_x', cohort: COHORT, records: [] })));
  check('invalid report correlation throws TypeError', throwsTypeError(() => aggregateProposalOutcomes({ nowMs: T0, correlationId: '', cohort: COHORT, records: [] })));
}

// =====================================================================
section('7. report is observational only, deeply immutable, and mutation-safe');
{
  const input = completeInput('mutation');
  const record = recordOf(input);
  input.feesMicrounits = 999_999;
  input.observationWindow.startAtMs = 0;
  check('later input mutation cannot rewrite record', record.feesMicrounits === 100_000 && record.observationWindow.startAtMs === T0 - 9_000);

  const records = [record];
  const before = JSON.stringify(records);
  const report = reportOf(records);
  check('aggregation does not mutate record array', JSON.stringify(records) === before);
  check('report explicitly has no strategy mutation authority', report.strategyMutationAuthority === 'NONE' && report.automaticStrategyMutation === false);
  check('report and nested structures are frozen', Object.isFrozen(report) && Object.isFrozen(report.cohort) && Object.isFrozen(report.metrics) && Object.isFrozen(report.includedOutcomeIds));
  let mutationThrew = false;
  try { report.metrics.successCount = 99; } catch (error) { mutationThrew = error instanceof TypeError; }
  check('report mutation rejected', mutationThrew && report.metrics.successCount === 1);

  const suspiciousExports = Object.keys(calibration).filter((name) => /threshold|tune|recommend|apply|execute|mutat/i.test(name));
  check('public module exports no tuning/mutation authority', suspiciousExports.length === 0, suspiciousExports.join(','));
  check('repeated aggregation is byte-identical', JSON.stringify(report) === JSON.stringify(reportOf([record])));
}

// ---------- summary ----------
const failed = results.filter((item) => !item.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
if (failed.length > 0) {
  for (const item of failed) console.log(`  ✗ ${item.name}`);
  process.exit(1);
}

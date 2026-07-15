import { cloneCanonical, deepFreeze } from '../../dock/src/canonical.mjs';
import {
  IMPACT_CATEGORIES,
  SCENARIO_KINDS,
  SWEEP_DIMENSIONS,
  createPortfolioSnapshot,
  createScenarioEvaluationInput,
  validatePortfolioSnapshot,
} from './contracts.mjs';
import { validateFixedOwnerKeyMap } from './owner-evidence.mjs';
import { createScenarioCampaign } from './campaign.mjs';
import {
  asRecord,
  assertCanonicalJson,
  boundedString,
  enumValue,
  exactFields,
  fail,
  requireFields,
  safeInteger,
  stringArray,
} from './errors.mjs';
import { parseAtoms } from './exact.mjs';

const OWNER_KEYS = Object.freeze(['CAPITAL', 'RISK', 'Q', 'L_TWIN', 'L_RECOVERY']);
const ORIGINS = Object.freeze(['HYPOTHETICAL', 'SYNTHETIC']);
const CORPUS_MAXIMUMS = Object.freeze({ impacts: 128, callerFacts: 16, stateChanges: 128 });
const SWEEP_OWNER_KEYS = Object.freeze({
  LIQUIDITY: 'L_TWIN', CAPACITY: 'CAPITAL', FUNDING: 'L_TWIN', BORROW: 'L_RECOVERY',
  FEE: 'L_TWIN', SLIPPAGE: 'L_TWIN', LATENCY: 'L_TWIN',
});
const IMPACT_OWNER_KEYS = Object.freeze({
  MARKET_MOVE: 'Q', LIQUIDITY: 'L_TWIN', CAPACITY: 'CAPITAL', FUNDING: 'L_TWIN',
  BORROW: 'L_RECOVERY', FEE: 'L_TWIN', SLIPPAGE: 'L_TWIN', LATENCY: 'L_TWIN',
  COLLATERAL: 'CAPITAL', LIABILITY: 'L_RECOVERY', EXECUTION: 'L_TWIN',
  RECOVERY: 'L_RECOVERY', OTHER: 'RISK',
});
const STATE_CHANGE_OWNER_KEYS = Object.freeze({
  ACCOUNT_TRUTH_FRESHNESS: 'RISK', BORROW_AVAILABILITY: 'L_RECOVERY', CONVERGENCE_STATE: 'L_TWIN',
  DATA_VISIBILITY: 'RISK', DECLARED_DEPENDENCE_PPM: 'Q', HAIRCUT_STATE: 'CAPITAL',
  LIQUIDATION_DISTANCE: 'RISK', MARGIN_HEADROOM: 'RISK', ONE_LEG_EXPOSURE: 'L_TWIN',
  OPEN_ORDER_STATE: 'L_TWIN', PEG_STATE: 'CAPITAL', POSITION_MOBILITY: 'L_TWIN',
  RECOVERY_HORIZON: 'L_RECOVERY', SHARED_CONTENTION: 'CAPITAL', VENUE_AVAILABILITY: 'L_TWIN',
});

function validateOwnerKey(value, name) {
  return enumValue(value, OWNER_KEYS, name);
}

function validateSweepRow(row, name) {
  asRecord(row, name);
  exactFields(row, ['dimension', 'state', 'value', 'unit', 'ownerKey'], name);
  requireFields(row, ['dimension', 'state', 'value', 'unit', 'ownerKey'], name);
  enumValue(row.dimension, SWEEP_DIMENSIONS, `${name}.dimension`);
  enumValue(row.state, ['KNOWN', 'UNKNOWN', 'UNAVAILABLE'], `${name}.state`);
  boundedString(row.unit, `${name}.unit`, 64);
  validateOwnerKey(row.ownerKey, `${name}.ownerKey`);
  if (row.ownerKey !== SWEEP_OWNER_KEYS[row.dimension]) fail('OWNER_ATTRIBUTION_MISMATCH', `${name}.ownerKey does not own ${row.dimension} fixture truth`);
  if (row.state === 'KNOWN') parseAtoms(row.value, `${name}.value`);
  else if (row.value !== null) fail('CORPUS_SWEEP_UNKNOWN_SHAPE', `${name}.value must be null when unknown or unavailable`);
}

function validateCorpusImpact(row, name) {
  asRecord(row, name);
  exactFields(row, ['impactId', 'subjectId', 'category', 'state', 'deltaAtoms', 'lowerAtoms', 'upperAtoms', 'ownerKey'], name);
  requireFields(row, ['impactId', 'subjectId', 'category', 'state', 'deltaAtoms', 'lowerAtoms', 'upperAtoms', 'ownerKey'], name);
  boundedString(row.impactId, `${name}.impactId`, 256);
  boundedString(row.subjectId, `${name}.subjectId`, 256);
  enumValue(row.category, IMPACT_CATEGORIES, `${name}.category`);
  enumValue(row.state, ['KNOWN', 'UNKNOWN', 'UNAVAILABLE'], `${name}.state`);
  validateOwnerKey(row.ownerKey, `${name}.ownerKey`);
  if (row.ownerKey !== IMPACT_OWNER_KEYS[row.category]) fail('OWNER_ATTRIBUTION_MISMATCH', `${name}.ownerKey does not own ${row.category} fixture truth`);
  if (row.state === 'KNOWN') {
    const lower = parseAtoms(row.lowerAtoms, `${name}.lowerAtoms`);
    const delta = parseAtoms(row.deltaAtoms, `${name}.deltaAtoms`);
    const upper = parseAtoms(row.upperAtoms, `${name}.upperAtoms`);
    if (lower > delta || delta > upper) fail('CORPUS_IMPACT_INTERVAL_INVALID', `${name} must satisfy lower <= delta <= upper`);
  } else if (row.deltaAtoms !== null || row.lowerAtoms !== null || row.upperAtoms !== null) {
    fail('CORPUS_IMPACT_UNKNOWN_SHAPE', `${name} unknown atoms must be null`);
  }
}

function validateCorpusStateChange(row, name) {
  asRecord(row, name);
  exactFields(row, ['subjectId', 'category', 'before', 'after', 'ownerKey'], name);
  requireFields(row, ['subjectId', 'category', 'before', 'after', 'ownerKey'], name);
  for (const field of ['subjectId', 'category', 'before', 'after']) boundedString(row[field], `${name}.${field}`, 256);
  validateOwnerKey(row.ownerKey, `${name}.ownerKey`);
  if (!Object.hasOwn(STATE_CHANGE_OWNER_KEYS, row.category)) fail('STATE_CHANGE_CATEGORY_INVALID', `${name}.category is not part of the Section 5 fixture vocabulary`);
  if (row.ownerKey !== STATE_CHANGE_OWNER_KEYS[row.category]) fail('OWNER_ATTRIBUTION_MISMATCH', `${name}.ownerKey does not own ${row.category} fixture truth`);
}

function validateCorpusCallerFact(row, name) {
  asRecord(row, name);
  exactFields(row, ['factId', 'subjectId', 'category', 'state', 'beforeAtoms', 'afterAtoms', 'unit', 'ownerKey'], name);
  requireFields(row, ['factId', 'subjectId', 'category', 'state', 'beforeAtoms', 'afterAtoms', 'unit', 'ownerKey'], name);
  boundedString(row.factId, `${name}.factId`, 256);
  boundedString(row.subjectId, `${name}.subjectId`, 256);
  enumValue(row.category, ['LIQUIDATION_DISTANCE', 'MARGIN_HEADROOM'], `${name}.category`);
  enumValue(row.state, ['KNOWN', 'UNKNOWN', 'UNAVAILABLE'], `${name}.state`);
  boundedString(row.unit, `${name}.unit`, 64);
  validateOwnerKey(row.ownerKey, `${name}.ownerKey`);
  if (row.ownerKey !== 'RISK') fail('OWNER_ATTRIBUTION_MISMATCH', `${name}.ownerKey must be RISK for caller-supplied liquidation facts`);
  if (row.state === 'KNOWN') {
    const before = parseAtoms(row.beforeAtoms, `${name}.beforeAtoms`);
    const after = parseAtoms(row.afterAtoms, `${name}.afterAtoms`);
    if (row.category === 'LIQUIDATION_DISTANCE') {
      if (row.unit !== 'PPM') fail('LIQUIDATION_DISTANCE_UNIT_INVALID', `${name} liquidation distance must use PPM`);
      if (before < 0n || before > 1_000_000n || after < 0n || after > 1_000_000n) {
        fail('LIQUIDATION_DISTANCE_RANGE_INVALID', `${name} liquidation distance must remain within 0..1000000 PPM`);
      }
      if (after >= before) fail('LIQUIDATION_COMPRESSION_INVALID', `${name} must show a strict caller-supplied liquidation-distance compression`);
    } else {
      if (row.unit !== 'USDT_MICRO') fail('MARGIN_HEADROOM_UNIT_INVALID', `${name} margin headroom must use USDT_MICRO`);
      if (before < 0n || after < 0n) fail('MARGIN_HEADROOM_RANGE_INVALID', `${name} margin headroom cannot be negative`);
      if (after >= before) fail('MARGIN_HEADROOM_COMPRESSION_INVALID', `${name} must show a strict caller-supplied margin-headroom compression`);
    }
  } else if (row.beforeAtoms !== null || row.afterAtoms !== null) {
    fail('CORPUS_CALLER_FACT_UNKNOWN_SHAPE', `${name} unknown fact atoms must be null`);
  }
}

function validateCorpusUncertainty(row, name) {
  asRecord(row, name);
  exactFields(row, ['state', 'lowerAtoms', 'upperAtoms', 'method', 'sourceOwnerKeys'], name);
  requireFields(row, ['state', 'lowerAtoms', 'upperAtoms', 'method', 'sourceOwnerKeys'], name);
  enumValue(row.state, ['KNOWN', 'UNKNOWN', 'UNAVAILABLE'], `${name}.state`);
  boundedString(row.method, `${name}.method`, 256);
  if (!Array.isArray(row.sourceOwnerKeys) || row.sourceOwnerKeys.length === 0) fail('CORPUS_UNCERTAINTY_SOURCE_REQUIRED', `${name}.sourceOwnerKeys is required`);
  row.sourceOwnerKeys.forEach((key, index) => validateOwnerKey(key, `${name}.sourceOwnerKeys[${index}]`));
  if (new Set(row.sourceOwnerKeys).size !== row.sourceOwnerKeys.length) fail('DUPLICATE_ARRAY_VALUE', `${name}.sourceOwnerKeys contains duplicates`);
  if (row.state === 'KNOWN') {
    const lower = parseAtoms(row.lowerAtoms, `${name}.lowerAtoms`);
    const upper = parseAtoms(row.upperAtoms, `${name}.upperAtoms`);
    if (lower > upper) fail('CORPUS_UNCERTAINTY_INTERVAL_INVALID', `${name} lower must not exceed upper`);
  } else if (row.lowerAtoms !== null || row.upperAtoms !== null) {
    fail('CORPUS_UNCERTAINTY_UNKNOWN_SHAPE', `${name} unknown bounds must be null`);
  }
}

export function validateAcceptanceCorpus(input) {
  const corpus = asRecord(input, 'PortfolioLabAcceptanceCorpusV1');
  const fields = [
    'schema', 'version', 'corpusId', 'fixtureClockRef', 'horizonStartMs',
    'horizonDurationMs', 'scenarioDefinitionStatus', 'ownerRefs', 'ownerContractRefs', 'defaultAssumptions', 'defaultSweepInputs',
    'whyNotLiveSizing', 'limitations', 'cases',
  ];
  exactFields(corpus, fields, 'PortfolioLabAcceptanceCorpusV1');
  requireFields(corpus, fields, 'PortfolioLabAcceptanceCorpusV1');
  assertCanonicalJson(corpus, 'PortfolioLabAcceptanceCorpusV1');
  if (corpus.schema !== 'PortfolioLabAcceptanceCorpusV1' || corpus.version !== 1) {
    fail('CONTRACT_VERSION_UNSUPPORTED', 'PortfolioLabAcceptanceCorpusV1 version 1 is required');
  }
  boundedString(corpus.corpusId, 'PortfolioLabAcceptanceCorpusV1.corpusId', 256);
  boundedString(corpus.fixtureClockRef, 'PortfolioLabAcceptanceCorpusV1.fixtureClockRef', 256);
  safeInteger(corpus.horizonStartMs, 'PortfolioLabAcceptanceCorpusV1.horizonStartMs');
  safeInteger(corpus.horizonDurationMs, 'PortfolioLabAcceptanceCorpusV1.horizonDurationMs', { minimum: 1 });
  if (corpus.scenarioDefinitionStatus !== 'UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB') {
    fail('SCENARIO_DEFINITION_STATUS_INVALID', 'acceptance corpus must intrinsically disclose its unaccepted F12 scenario status');
  }
  asRecord(corpus.ownerRefs, 'PortfolioLabAcceptanceCorpusV1.ownerRefs');
  exactFields(corpus.ownerRefs, OWNER_KEYS, 'PortfolioLabAcceptanceCorpusV1.ownerRefs');
  requireFields(corpus.ownerRefs, OWNER_KEYS, 'PortfolioLabAcceptanceCorpusV1.ownerRefs');
  OWNER_KEYS.forEach((key) => boundedString(corpus.ownerRefs[key], `PortfolioLabAcceptanceCorpusV1.ownerRefs.${key}`, 8_192));
  asRecord(corpus.ownerContractRefs, 'PortfolioLabAcceptanceCorpusV1.ownerContractRefs');
  exactFields(corpus.ownerContractRefs, OWNER_KEYS, 'PortfolioLabAcceptanceCorpusV1.ownerContractRefs');
  requireFields(corpus.ownerContractRefs, OWNER_KEYS, 'PortfolioLabAcceptanceCorpusV1.ownerContractRefs');
  OWNER_KEYS.forEach((key) => boundedString(corpus.ownerContractRefs[key], `PortfolioLabAcceptanceCorpusV1.ownerContractRefs.${key}`, 8_192));
  validateFixedOwnerKeyMap(corpus.ownerRefs, corpus.ownerContractRefs);
  asRecord(corpus.defaultAssumptions, 'PortfolioLabAcceptanceCorpusV1.defaultAssumptions');
  exactFields(corpus.defaultAssumptions, ['liquidity', 'fills', 'exclusions'], 'PortfolioLabAcceptanceCorpusV1.defaultAssumptions');
  requireFields(corpus.defaultAssumptions, ['liquidity', 'fills', 'exclusions'], 'PortfolioLabAcceptanceCorpusV1.defaultAssumptions');
  boundedString(corpus.defaultAssumptions.liquidity, 'PortfolioLabAcceptanceCorpusV1.defaultAssumptions.liquidity');
  boundedString(corpus.defaultAssumptions.fills, 'PortfolioLabAcceptanceCorpusV1.defaultAssumptions.fills');
  stringArray(corpus.defaultAssumptions.exclusions, 'PortfolioLabAcceptanceCorpusV1.defaultAssumptions.exclusions', 128);
  if (!Array.isArray(corpus.defaultSweepInputs) || corpus.defaultSweepInputs.length !== SWEEP_DIMENSIONS.length) {
    fail('CORPUS_SWEEP_SET_INVALID', 'corpus must supply the seven default sweep dimensions');
  }
  corpus.defaultSweepInputs.forEach((row, index) => validateSweepRow(row, `PortfolioLabAcceptanceCorpusV1.defaultSweepInputs[${index}]`));
  if (corpus.defaultSweepInputs.some((row, index) => row.dimension !== SWEEP_DIMENSIONS[index])) {
    fail('CORPUS_SWEEP_SET_INVALID', 'default sweep dimensions must use the frozen order');
  }
  boundedString(corpus.whyNotLiveSizing, 'PortfolioLabAcceptanceCorpusV1.whyNotLiveSizing', 2_048);
  stringArray(corpus.limitations, 'PortfolioLabAcceptanceCorpusV1.limitations', 128);
  if (!Array.isArray(corpus.cases) || corpus.cases.length !== SCENARIO_KINDS.length) {
    fail('ACCEPTANCE_CORPUS_INCOMPLETE', `acceptance corpus must contain exactly ${SCENARIO_KINDS.length} cases`);
  }
  const ids = new Set();
  const scenarioIds = new Set();
  corpus.cases.forEach((row, index) => {
    const name = `PortfolioLabAcceptanceCorpusV1.cases[${index}]`;
    asRecord(row, name);
    exactFields(row, ['ordinal', 'caseId', 'scenarioKind', 'scenarioId', 'origin', 'seed', 'narrative', 'severity', 'sweepOverrides', 'impacts', 'callerFacts', 'stateChanges', 'missingDependencies', 'uncertainty'], name);
    requireFields(row, ['ordinal', 'caseId', 'scenarioKind', 'scenarioId', 'origin', 'seed', 'narrative', 'severity', 'sweepOverrides', 'impacts', 'stateChanges', 'missingDependencies', 'uncertainty'], name);
    if (row.ordinal !== index + 1 || row.scenarioKind !== SCENARIO_KINDS[index]) fail('ACCEPTANCE_CORPUS_ORDER_INVALID', `${name} does not match the frozen Section 5 order`);
    boundedString(row.caseId, `${name}.caseId`, 256);
    boundedString(row.scenarioId, `${name}.scenarioId`, 256);
    if (ids.has(row.caseId) || scenarioIds.has(row.scenarioId)) fail('ACCEPTANCE_CORPUS_ID_DUPLICATE', `${name} identity is duplicated`);
    ids.add(row.caseId);
    scenarioIds.add(row.scenarioId);
    enumValue(row.origin, ORIGINS, `${name}.origin`);
    safeInteger(row.seed, `${name}.seed`, { minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER });
    boundedString(row.narrative, `${name}.narrative`, 2_048);
    boundedString(row.severity, `${name}.severity`, 256);
    if (!Array.isArray(row.sweepOverrides) || row.sweepOverrides.length > SWEEP_DIMENSIONS.length) fail('CORPUS_SWEEP_OVERRIDE_INVALID', `${name}.sweepOverrides must be bounded`);
    row.sweepOverrides.forEach((entry, overrideIndex) => validateSweepRow(entry, `${name}.sweepOverrides[${overrideIndex}]`));
    if (new Set(row.sweepOverrides.map((entry) => entry.dimension)).size !== row.sweepOverrides.length) fail('CORPUS_SWEEP_OVERRIDE_DUPLICATE', `${name} repeats a sweep override`);
    if (!Array.isArray(row.impacts) || row.impacts.length === 0 || row.impacts.length > CORPUS_MAXIMUMS.impacts) fail('CORPUS_IMPACT_REQUIRED', `${name}.impacts must contain 1..${CORPUS_MAXIMUMS.impacts} rows`);
    row.impacts.forEach((entry, impactIndex) => validateCorpusImpact(entry, `${name}.impacts[${impactIndex}]`));
    if (new Set(row.impacts.map((entry) => entry.impactId)).size !== row.impacts.length) fail('CORPUS_IMPACT_DUPLICATE', `${name} repeats an impact identity`);
    const callerFacts = row.callerFacts ?? [];
    if (!Array.isArray(callerFacts) || callerFacts.length > CORPUS_MAXIMUMS.callerFacts) fail('CORPUS_CALLER_FACTS_INVALID', `${name}.callerFacts must be bounded`);
    callerFacts.forEach((entry, factIndex) => validateCorpusCallerFact(entry, `${name}.callerFacts[${factIndex}]`));
    if (new Set(callerFacts.map((entry) => entry.factId)).size !== callerFacts.length) fail('CALLER_FACT_ID_DUPLICATE', `${name} repeats a caller fact identity`);
    if (!Array.isArray(row.stateChanges) || row.stateChanges.length > CORPUS_MAXIMUMS.stateChanges) fail('CORPUS_STATE_CHANGES_INVALID', `${name}.stateChanges must contain at most ${CORPUS_MAXIMUMS.stateChanges} rows`);
    row.stateChanges.forEach((entry, changeIndex) => validateCorpusStateChange(entry, `${name}.stateChanges[${changeIndex}]`));
    stringArray(row.missingDependencies, `${name}.missingDependencies`, 128);
    validateCorpusUncertainty(row.uncertainty, `${name}.uncertainty`);
  });
  const missingCase = corpus.cases.at(-1);
  if (missingCase.scenarioKind !== 'SCENARIO_INPUT_MISSING'
    || missingCase.missingDependencies.length === 0
    || missingCase.uncertainty.state === 'KNOWN'
    || !missingCase.sweepOverrides.some((row) => row.state !== 'KNOWN')) {
    fail('MISSING_INPUT_CASE_INVALID', 'case 20 must preserve missing input and unknown uncertainty');
  }
  const liquidationCase = corpus.cases.find((row) => row.scenarioKind === 'LIQUIDATION_DISTANCE_COMPRESSION');
  const liquidationFacts = liquidationCase?.callerFacts ?? [];
  if (liquidationFacts.length !== 2
    || liquidationFacts[0].category !== 'LIQUIDATION_DISTANCE'
    || liquidationFacts[1].category !== 'MARGIN_HEADROOM'
    || liquidationFacts.some((row) => row.state !== 'KNOWN')) {
    fail('LIQUIDATION_CALLER_FACTS_REQUIRED', 'case 18 must preserve exact known caller-supplied liquidation distance and margin headroom facts');
  }
  return true;
}

function metric(state, atoms, reportingUnit) {
  return state === 'KNOWN'
    ? { state, unit: reportingUnit, atoms, reason: null }
    : { state, unit: reportingUnit, atoms: null, reason: 'CALLER_SCENARIO_INPUT_MISSING' };
}

function materializeCase(snapshot, corpus, row, index) {
  const overrides = new Map(row.sweepOverrides.map((entry) => [entry.dimension, entry]));
  const sweepInputs = corpus.defaultSweepInputs.map((defaultRow) => {
    const selected = overrides.get(defaultRow.dimension) ?? defaultRow;
    return {
      dimension: selected.dimension,
      state: selected.state,
      value: selected.value,
      unit: selected.unit,
      ownerRef: corpus.ownerRefs[selected.ownerKey],
    };
  });
  const startMs = corpus.horizonStartMs + (index * corpus.horizonDurationMs);
  return createScenarioEvaluationInput({
    schema: 'PortfolioScenarioEvaluationInputV1',
    version: 1,
    evaluationId: row.caseId,
    scenarioKind: row.scenarioKind,
    snapshotHash: snapshot.snapshotHash,
    snapshotOwnerClaimHash: snapshot.ownerClaimHash,
    scenarioReference: {
      scenarioId: row.scenarioId,
      scenarioVersion: '1.0.0',
      extensionProviderRef: 'F12',
      fixtureSchemaRef: 'frontier/dock/contracts/v1/dock-v1.schema.json#/$defs/ScenarioReferenceV1',
      seed: row.seed,
      clockRef: corpus.fixtureClockRef,
      lineageRefs: [
        `fixture://portfolio-lab/unaccepted-f12-consumer-stub/${corpus.corpusId}/${row.caseId}`,
        `status:${corpus.scenarioDefinitionStatus}`,
      ],
      expectedCanonicalPostureRefs: [corpus.ownerContractRefs.RISK],
    },
    scenarioDefinitionStatus: corpus.scenarioDefinitionStatus,
    origin: row.origin,
    seed: row.seed,
    horizon: { startMs, endMs: startMs + corpus.horizonDurationMs },
    reproducibilityInputs: [
      `corpus:${corpus.corpusId}`,
      `case:${row.caseId}`,
      `snapshot-owner-claim-sha256:${snapshot.ownerClaimHash}`,
      `scenario-definition-status:${corpus.scenarioDefinitionStatus}`,
    ],
    assumptions: {
      narrative: row.narrative,
      severity: row.severity,
      liquidity: corpus.defaultAssumptions.liquidity,
      fills: corpus.defaultAssumptions.fills,
      exclusions: corpus.defaultAssumptions.exclusions,
    },
    sweepInputs,
    impacts: row.impacts.map((impact) => ({
      impactId: impact.impactId,
      subjectId: impact.subjectId,
      category: impact.category,
      delta: metric(impact.state, impact.deltaAtoms, snapshot.reportingUnit),
      lowerBound: metric(impact.state, impact.lowerAtoms, snapshot.reportingUnit),
      upperBound: metric(impact.state, impact.upperAtoms, snapshot.reportingUnit),
      ownerOutputRef: corpus.ownerRefs[impact.ownerKey],
    })),
    callerFacts: (row.callerFacts ?? []).map((fact) => ({
      factId: fact.factId,
      subjectId: fact.subjectId,
      category: fact.category,
      before: metric(fact.state, fact.beforeAtoms, fact.unit),
      after: metric(fact.state, fact.afterAtoms, fact.unit),
      ownerOutputRef: corpus.ownerRefs[fact.ownerKey],
    })),
    stateChanges: row.stateChanges.map((change) => ({
      subjectId: change.subjectId,
      category: change.category,
      before: change.before,
      after: change.after,
      ownerOutputRef: corpus.ownerRefs[change.ownerKey],
    })),
    missingDependencies: row.missingDependencies,
    uncertainty: {
      state: row.uncertainty.state,
      unit: snapshot.reportingUnit,
      lowerAtoms: row.uncertainty.lowerAtoms,
      upperAtoms: row.uncertainty.upperAtoms,
      method: row.uncertainty.method,
      sourceRefs: row.uncertainty.sourceOwnerKeys.map((key) => corpus.ownerRefs[key]),
    },
    outputMode: 'COMPARATIVE',
    whyNotLiveSizing: corpus.whyNotLiveSizing,
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
  });
}

export function materializeAcceptanceCampaign(snapshotInput, corpusInput, generatedAtMs) {
  validateAcceptanceCorpus(corpusInput);
  safeInteger(generatedAtMs, 'ScenarioCampaignV1.generatedAtMs');
  const snapshot = Object.hasOwn(snapshotInput, 'snapshotHash')
    ? (validatePortfolioSnapshot(snapshotInput), deepFreeze(cloneCanonical(snapshotInput)))
    : createPortfolioSnapshot(snapshotInput);
  const corpus = cloneCanonical(corpusInput);
  const evaluationInputs = corpus.cases.map((row, index) => materializeCase(snapshot, corpus, row, index));
  const campaign = createScenarioCampaign({
    schema: 'ScenarioCampaignV1',
    version: 1,
    campaignId: corpus.corpusId,
    mode: 'DECLARED_GRID',
    seed: 71502,
    generatedAtMs,
    snapshotHash: snapshot.snapshotHash,
    evaluationInputs,
    drawCount: evaluationInputs.length,
    objective: 'Compare the immutable fixture portfolio across the complete Frontier Section 5 stress corpus.',
    limitations: corpus.limitations,
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    canonical: false,
  });
  return deepFreeze({ snapshot, campaign });
}

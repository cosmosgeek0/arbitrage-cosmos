import {
  cloneCanonical,
  deepFreeze,
  omitFields,
  sha256,
} from '../../dock/src/canonical.mjs';
import {
  createScenarioReference,
  validateScenarioReference,
} from '../../dock/src/records.mjs';
import {
  asRecord,
  assertCanonicalJson,
  assertNoForbiddenCapabilities,
  boundedString,
  enumValue,
  exactFields,
  fail,
  requireFields,
  rethrowDock,
  safeInteger,
  stringArray,
} from './errors.mjs';
import { compareKnown, parseAtoms, validateExactMetric } from './exact.mjs';
import { validateExactBootstrapArchiveMarkers } from './archive-evidence.mjs';
import {
  FIXED_OWNER_CONTRACT_REFS,
  FIXED_OWNER_OUTPUT_REF_BY_KEY,
  bindOwnerEvidenceAnchor,
  scenarioOwnerClaimHash,
  snapshotOwnerClaimHash,
  validateFixedOwnerReferenceSets,
  validateAllowedScenarioOwnerClaim,
  validateAllowedSnapshotOwnerClaim,
  validateOwnerEvidenceAnchor,
  validateOwnerReferencePair,
} from './owner-evidence.mjs';

export const MAXIMUMS = Object.freeze({
  ownerSnapshotRefs: 64,
  positions: 512,
  proposals: 512,
  liabilities: 512,
  collateral: 256,
  venueExposures: 128,
  strategyClusters: 128,
  factorLinks: 2_048,
  sweepInputs: 7,
  impacts: 4_096,
  callerFacts: 128,
  stateChanges: 2_048,
  missingDependencies: 512,
});

export const SCENARIO_KINDS = Object.freeze([
  'BROAD_MARKET_GAP',
  'SINGLE_SYMBOL_DISCONTINUITY',
  'CORRELATION_TO_ONE_CRISIS',
  'CORRELATION_SIGN_FLIP',
  'SPREAD_WIDENING_DEPTH_EVAPORATION',
  'FUNDING_INVERSION',
  'BORROW_RECALL_UNAVAILABLE',
  'FEE_TIER_DEGRADATION',
  'LATENCY_SPIKE',
  'VENUE_OUTAGE',
  'STABLECOIN_DEPEG',
  'COLLATERAL_HAIRCUT',
  'PARTIAL_FILL_REJECTED_HEDGE',
  'SIMULTANEOUS_STRATEGY_CROWDING',
  'SHARED_COLLATERAL_CONTENTION',
  'STALE_ACCOUNT_TRUTH',
  'AMBIGUOUS_OPEN_ORDER',
  'LIQUIDATION_DISTANCE_COMPRESSION',
  'RECOVERY_EXCEEDS_HOLDING_HORIZON',
  'SCENARIO_INPUT_MISSING',
]);

export const SWEEP_DIMENSIONS = Object.freeze([
  'LIQUIDITY', 'CAPACITY', 'FUNDING', 'BORROW', 'FEE', 'SLIPPAGE', 'LATENCY',
]);

export const SWEEP_UNIT_REQUIREMENTS = Object.freeze({
  LIQUIDITY: 'PPM',
  CAPACITY: 'PPM',
  FUNDING: 'REPORTING_UNIT',
  BORROW: 'PPM',
  FEE: 'REPORTING_UNIT',
  SLIPPAGE: 'REPORTING_UNIT',
  LATENCY: 'MILLISECONDS',
});

export const SCENARIO_DEFINITION_STATUSES = Object.freeze([
  'UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB',
]);

export const SCENARIO_REFERENCE_FIELDS = Object.freeze([
  'scenarioId',
  'scenarioVersion',
  'scenarioHash',
  'extensionProviderRef',
  'fixtureSchemaRef',
  'seed',
  'clockRef',
  'lineageRefs',
  'expectedCanonicalPostureRefs',
]);

export const IMPACT_CATEGORIES = Object.freeze([
  'MARKET_MOVE', 'LIQUIDITY', 'CAPACITY', 'FUNDING', 'BORROW', 'FEE',
  'SLIPPAGE', 'LATENCY', 'COLLATERAL', 'LIABILITY', 'EXECUTION', 'RECOVERY', 'OTHER',
]);

const SWEEP_OWNER_KEYS = Object.freeze({
  LIQUIDITY: 'L_TWIN',
  CAPACITY: 'CAPITAL',
  FUNDING: 'L_TWIN',
  BORROW: 'L_RECOVERY',
  FEE: 'L_TWIN',
  SLIPPAGE: 'L_TWIN',
  LATENCY: 'L_TWIN',
});

const IMPACT_OWNER_KEYS = Object.freeze({
  MARKET_MOVE: 'Q',
  LIQUIDITY: 'L_TWIN',
  CAPACITY: 'CAPITAL',
  FUNDING: 'L_TWIN',
  BORROW: 'L_RECOVERY',
  FEE: 'L_TWIN',
  SLIPPAGE: 'L_TWIN',
  LATENCY: 'L_TWIN',
  COLLATERAL: 'CAPITAL',
  LIABILITY: 'L_RECOVERY',
  EXECUTION: 'L_TWIN',
  RECOVERY: 'L_RECOVERY',
  OTHER: 'RISK',
});

const STATE_CHANGE_OWNER_KEYS = Object.freeze({
  ACCOUNT_TRUTH_FRESHNESS: 'RISK',
  BORROW_AVAILABILITY: 'L_RECOVERY',
  CONVERGENCE_STATE: 'L_TWIN',
  DATA_VISIBILITY: 'RISK',
  DECLARED_DEPENDENCE_PPM: 'Q',
  HAIRCUT_STATE: 'CAPITAL',
  LIQUIDATION_DISTANCE: 'RISK',
  MARGIN_HEADROOM: 'RISK',
  ONE_LEG_EXPOSURE: 'L_TWIN',
  OPEN_ORDER_STATE: 'L_TWIN',
  PEG_STATE: 'CAPITAL',
  POSITION_MOBILITY: 'L_TWIN',
  RECOVERY_HORIZON: 'L_RECOVERY',
  RISK_POSTURE: 'RISK',
  SHARED_CONTENTION: 'CAPITAL',
  VENUE_AVAILABILITY: 'L_TWIN',
});

function validatePacketOwnerAttribution(ownerRef, ownerKey, name) {
  if (ownerRef !== FIXED_OWNER_OUTPUT_REF_BY_KEY[ownerKey]) {
    fail('OWNER_ATTRIBUTION_MISMATCH', `${name} must bind the packet-local ${ownerKey} fixture output`);
  }
}

function validateHash(record, hashField, code) {
  if (typeof record[hashField] !== 'string' || record[hashField] !== sha256(omitFields(record, [hashField]))) {
    fail(code, `${hashField} does not match canonical record content`);
  }
}

function snapshotContentHash(record) {
  return sha256(omitFields(record, ['snapshotHash', 'ownerEvidenceStatus', 'ownerEvidenceHash']));
}

function boundedArray(value, name, maximum) {
  if (!Array.isArray(value) || value.length > maximum) fail('ARRAY_BOUND_EXCEEDED', `${name} must contain at most ${maximum} rows`);
  return value;
}

const SUBJECT_FIELDS = Object.freeze([
  'id', 'assetId', 'sectorId', 'venueId', 'collateralId', 'strategyId',
  'exposure', 'canonicalOwnerRef', 'ownerSnapshotRef', 'sourceRevision',
]);

function validateSubject(subject, reportingUnit, name) {
  asRecord(subject, name);
  exactFields(subject, SUBJECT_FIELDS, name);
  requireFields(subject, SUBJECT_FIELDS, name);
  for (const field of ['id', 'assetId', 'sectorId', 'venueId', 'collateralId', 'strategyId', 'canonicalOwnerRef', 'ownerSnapshotRef', 'sourceRevision']) {
    boundedString(subject[field], `${name}.${field}`, field === 'canonicalOwnerRef' ? 8_192 : 256);
  }
  validateExactMetric(subject.exposure, reportingUnit, `${name}.exposure`);
}

function validateVenueExposure(subject, reportingUnit, name) {
  asRecord(subject, name);
  exactFields(subject, ['id', 'venueId', 'exposure', 'canonicalOwnerRef', 'ownerSnapshotRef', 'sourceRevision'], name);
  requireFields(subject, ['id', 'venueId', 'exposure', 'canonicalOwnerRef', 'ownerSnapshotRef', 'sourceRevision'], name);
  for (const field of ['id', 'venueId', 'canonicalOwnerRef', 'ownerSnapshotRef', 'sourceRevision']) boundedString(subject[field], `${name}.${field}`, ['canonicalOwnerRef', 'ownerSnapshotRef'].includes(field) ? 8_192 : 256);
  validateExactMetric(subject.exposure, reportingUnit, `${name}.exposure`);
}

export function validatePortfolioSnapshot(input) {
  const snapshot = asRecord(input, 'PortfolioSnapshotV1');
  const fields = [
    'schema', 'version', 'snapshotId', 'revision', 'asOfMs', 'receivedAtMs', 'reportingUnit',
    'truthState', 'ownerEvidenceStatus', 'ownerEvidenceHash', 'ownerClaimHash',
    'ownerSnapshotRefs', 'canonicalOwnerContractRefs', 'positions', 'proposals', 'liabilities', 'collateral',
    'venueExposures', 'strategyClusters', 'factorLinks', 'missingDependencies', 'authorityClass',
    'networkMode', 'canonical', 'snapshotHash',
  ];
  exactFields(snapshot, fields, 'PortfolioSnapshotV1');
  requireFields(snapshot, fields, 'PortfolioSnapshotV1');
  assertCanonicalJson(snapshot, 'PortfolioSnapshotV1');
  assertNoForbiddenCapabilities(snapshot);
  if (snapshot.schema !== 'PortfolioSnapshotV1' || snapshot.version !== 1) fail('CONTRACT_VERSION_UNSUPPORTED', 'PortfolioSnapshotV1 version 1 is required');
  boundedString(snapshot.snapshotId, 'PortfolioSnapshotV1.snapshotId', 256);
  safeInteger(snapshot.revision, 'PortfolioSnapshotV1.revision');
  safeInteger(snapshot.asOfMs, 'PortfolioSnapshotV1.asOfMs');
  safeInteger(snapshot.receivedAtMs, 'PortfolioSnapshotV1.receivedAtMs');
  if (snapshot.receivedAtMs < snapshot.asOfMs) fail('TIME_ORDER_INVALID', 'receivedAtMs cannot precede asOfMs');
  boundedString(snapshot.reportingUnit, 'PortfolioSnapshotV1.reportingUnit', 64);
  enumValue(snapshot.truthState, ['COMPLETE', 'PARTIAL', 'STALE', 'UNKNOWN', 'UNAVAILABLE'], 'PortfolioSnapshotV1.truthState');
  validateOwnerEvidenceAnchor(snapshot, 'PortfolioSnapshotV1');
  for (const field of ['ownerEvidenceHash', 'ownerClaimHash']) {
    if (!/^[a-f0-9]{64}$/.test(snapshot[field])) fail('OWNER_EVIDENCE_HASH_INVALID', `PortfolioSnapshotV1.${field} must be SHA-256`);
  }
  stringArray(snapshot.ownerSnapshotRefs, 'PortfolioSnapshotV1.ownerSnapshotRefs', MAXIMUMS.ownerSnapshotRefs);
  if (snapshot.ownerSnapshotRefs.length === 0) fail('OWNER_REFERENCE_REQUIRED', 'PortfolioSnapshotV1 needs immutable owner references');
  stringArray(snapshot.canonicalOwnerContractRefs, 'PortfolioSnapshotV1.canonicalOwnerContractRefs', MAXIMUMS.ownerSnapshotRefs);
  if (snapshot.canonicalOwnerContractRefs.length === 0) fail('OWNER_REFERENCE_REQUIRED', 'PortfolioSnapshotV1 needs canonical owner contract references');
  validateFixedOwnerReferenceSets(snapshot.ownerSnapshotRefs, snapshot.canonicalOwnerContractRefs);

  for (const [field, maximum] of [['positions', MAXIMUMS.positions], ['proposals', MAXIMUMS.proposals], ['liabilities', MAXIMUMS.liabilities], ['collateral', MAXIMUMS.collateral]]) {
    boundedArray(snapshot[field], `PortfolioSnapshotV1.${field}`, maximum);
    snapshot[field].forEach((subject, index) => validateSubject(subject, snapshot.reportingUnit, `PortfolioSnapshotV1.${field}[${index}]`));
  }
  boundedArray(snapshot.venueExposures, 'PortfolioSnapshotV1.venueExposures', MAXIMUMS.venueExposures);
  snapshot.venueExposures.forEach((subject, index) => validateVenueExposure(subject, snapshot.reportingUnit, `PortfolioSnapshotV1.venueExposures[${index}]`));

  boundedArray(snapshot.strategyClusters, 'PortfolioSnapshotV1.strategyClusters', MAXIMUMS.strategyClusters);
  snapshot.strategyClusters.forEach((cluster, index) => {
    const name = `PortfolioSnapshotV1.strategyClusters[${index}]`;
    asRecord(cluster, name);
    exactFields(cluster, ['clusterId', 'strategyIds', 'factorIds', 'sourceRef'], name);
    requireFields(cluster, ['clusterId', 'strategyIds', 'factorIds', 'sourceRef'], name);
    boundedString(cluster.clusterId, `${name}.clusterId`, 256);
    stringArray(cluster.strategyIds, `${name}.strategyIds`, 128);
    stringArray(cluster.factorIds, `${name}.factorIds`, 128);
    boundedString(cluster.sourceRef, `${name}.sourceRef`, 8_192);
  });

  boundedArray(snapshot.factorLinks, 'PortfolioSnapshotV1.factorLinks', MAXIMUMS.factorLinks);
  snapshot.factorLinks.forEach((link, index) => {
    const name = `PortfolioSnapshotV1.factorLinks[${index}]`;
    asRecord(link, name);
    exactFields(link, ['leftId', 'rightId', 'factorId', 'dependencePpm', 'sourceRef'], name);
    requireFields(link, ['leftId', 'rightId', 'factorId', 'dependencePpm', 'sourceRef'], name);
    for (const field of ['leftId', 'rightId', 'factorId', 'sourceRef']) boundedString(link[field], `${name}.${field}`, field === 'sourceRef' ? 8_192 : 256);
    if (link.leftId === link.rightId) fail('FACTOR_SELF_EDGE', `${name} cannot be a self-edge`);
    safeInteger(link.dependencePpm, `${name}.dependencePpm`, { minimum: -1_000_000, maximum: 1_000_000 });
  });

  stringArray(snapshot.missingDependencies, 'PortfolioSnapshotV1.missingDependencies', MAXIMUMS.missingDependencies);
  const allSubjects = [...snapshot.positions, ...snapshot.proposals, ...snapshot.liabilities, ...snapshot.collateral, ...snapshot.venueExposures];
  if (snapshot.truthState === 'COMPLETE' && (snapshot.missingDependencies.length > 0 || allSubjects.some((row) => row.exposure.state !== 'KNOWN'))) {
    fail('TRUTH_COMPLETENESS_CONTRADICTION', 'COMPLETE snapshot cannot list missing dependencies or unknown exposures');
  }
  if (snapshot.truthState !== 'COMPLETE' && snapshot.missingDependencies.length === 0) {
    fail('TRUTH_INCOMPLETENESS_UNEXPLAINED', 'non-complete snapshot must list its missing dependency');
  }
  if (snapshot.authorityClass !== 'NO_AUTHORITY' || snapshot.networkMode !== 'FIXTURE_ONLY' || snapshot.canonical !== false) {
    fail('AUTHORITY_BOUNDARY_INVALID', 'PortfolioSnapshotV1 must remain fixture-only, non-canonical, and non-authoritative');
  }

  const subjectIds = [
    ...snapshot.positions.map((row) => row.id),
    ...snapshot.proposals.map((row) => row.id),
    ...snapshot.liabilities.map((row) => row.id),
    ...snapshot.collateral.map((row) => row.id),
    ...snapshot.venueExposures.map((row) => row.id),
  ];
  if (new Set(subjectIds).size !== subjectIds.length) fail('SUBJECT_ID_DUPLICATE', 'portfolio subject identities must be unique');
  const clusterIds = snapshot.strategyClusters.map((row) => row.clusterId);
  if (new Set(clusterIds).size !== clusterIds.length) fail('CLUSTER_ID_DUPLICATE', 'strategy cluster identities must be unique');
  const factorEdges = snapshot.factorLinks.map((row) => [row.leftId, row.rightId].sort().concat(row.factorId).join('|'));
  if (new Set(factorEdges).size !== factorEdges.length) fail('FACTOR_EDGE_DUPLICATE', 'factor links must be unique');
  const ownerSnapshots = new Set(snapshot.ownerSnapshotRefs);
  const ownerContracts = new Set(snapshot.canonicalOwnerContractRefs);
  for (const row of allSubjects) {
    if (!ownerSnapshots.has(row.ownerSnapshotRef) || !ownerContracts.has(row.canonicalOwnerRef)) {
      fail('SNAPSHOT_PROVENANCE_UNBOUND', `${row.id} does not bind a declared owner snapshot and canonical owner contract`);
    }
    validateOwnerReferencePair(row.ownerSnapshotRef, row.canonicalOwnerRef, `PortfolioSnapshotV1 subject ${row.id}`);
  }
  for (const cluster of snapshot.strategyClusters) {
    if (!ownerSnapshots.has(cluster.sourceRef)) fail('SNAPSHOT_PROVENANCE_UNBOUND', `${cluster.clusterId} sourceRef is not a declared owner snapshot`);
  }
  for (const link of snapshot.factorLinks) {
    if (!ownerSnapshots.has(link.sourceRef)) fail('SNAPSHOT_PROVENANCE_UNBOUND', `${link.factorId} sourceRef is not a declared owner snapshot`);
  }
  if (snapshot.ownerClaimHash !== snapshotOwnerClaimHash(snapshot)) {
    fail('OWNER_SNAPSHOT_CLAIM_MISMATCH', 'snapshot owner claim hash does not bind the exact fixture values and provenance');
  }
  validateAllowedSnapshotOwnerClaim(snapshot.ownerClaimHash);
  if (snapshot.snapshotHash !== snapshotContentHash(snapshot)) {
    fail('SNAPSHOT_HASH_MISMATCH', 'snapshotHash does not match the canonical snapshot content and owner claim');
  }
  return true;
}

function containsAuthorityUpgradeMarker(value) {
  const normalized = value.toUpperCase()
    .replaceAll('UNACCEPTED', '')
    .replace(/[^A-Z0-9]+/gu, '');
  return [
    'ACCEPTED', 'CANONICAL', 'AUTHORITATIVE', 'AUTHORITY', 'LIVE',
    'INTEGRATED', 'TRADE', 'READY', 'PROFITABLE',
  ].some((marker) => normalized.includes(marker));
}

export function validateUnacceptedScenarioReferenceBoundary(
  scenarioReference,
  scenarioDefinitionStatus,
  reproducibilityInputs = undefined,
) {
  const reference = asRecord(scenarioReference, 'ScenarioReferenceV1');
  exactFields(reference, SCENARIO_REFERENCE_FIELDS, 'ScenarioReferenceV1');
  requireFields(reference, SCENARIO_REFERENCE_FIELDS, 'ScenarioReferenceV1');
  assertCanonicalJson(reference, 'ScenarioReferenceV1');
  assertNoForbiddenCapabilities(reference, 'ScenarioReferenceV1');
  try { validateScenarioReference(reference); } catch (error) { rethrowDock(error); }
  if (scenarioDefinitionStatus !== SCENARIO_DEFINITION_STATUSES[0]) {
    fail('SCENARIO_DEFINITION_STATUS_INVALID', 'PortfolioLab prestage permits only the explicit unaccepted synthetic F12 reference status');
  }
  const statusMarker = 'status:UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB';
  const stubLineagePattern = /^fixture:\/\/portfolio-lab\/unaccepted-f12-consumer-stub\/[a-z0-9][a-z0-9._-]{0,255}\/[a-z0-9][a-z0-9._-]{0,255}$/u;
  const scenarioEvidenceStrings = [
    reference.scenarioId,
    reference.scenarioVersion,
    reference.fixtureSchemaRef,
    reference.clockRef,
    ...reference.lineageRefs,
    ...reference.expectedCanonicalPostureRefs,
  ];
  if (scenarioEvidenceStrings.some(containsAuthorityUpgradeMarker)) {
    fail('SCENARIO_AUTHORITY_MARKER_FORBIDDEN', 'scenario reference evidence cannot claim acceptance, authority, readiness, live status, or trading status');
  }
  if (reference.lineageRefs.length !== 2
    || reference.lineageRefs[1] !== statusMarker
    || !stubLineagePattern.test(reference.lineageRefs[0])
    || reference.fixtureSchemaRef !== 'frontier/dock/contracts/v1/dock-v1.schema.json#/$defs/ScenarioReferenceV1'
    || reference.expectedCanonicalPostureRefs.length !== 1
    || reference.expectedCanonicalPostureRefs[0] !== FIXED_OWNER_CONTRACT_REFS[1]) {
    fail('SCENARIO_DEFINITION_STUB_EVIDENCE_MISSING', 'unaccepted F12 consumer stubs require the exact fixture lineage and status marker');
  }
  if (reproducibilityInputs !== undefined) {
    const exactMarker = 'scenario-definition-status:UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB';
    if (!reproducibilityInputs.includes(exactMarker)
      || reproducibilityInputs.some((entry) => (
        (entry.startsWith('scenario-definition-status:') && entry !== exactMarker)
        || containsAuthorityUpgradeMarker(entry)
      ))) {
      fail('SCENARIO_DEFINITION_DISCLOSURE_INVALID', 'reproducibility inputs must disclose only the unaccepted F12 scenario status');
    }
  }
  return true;
}

export function createPortfolioSnapshot(input) {
  assertCanonicalJson(input, 'PortfolioSnapshotV1');
  assertNoForbiddenCapabilities(input);
  const record = cloneCanonical(input);
  delete record.snapshotHash;
  delete record.ownerClaimHash;
  bindOwnerEvidenceAnchor(record);
  record.ownerClaimHash = snapshotOwnerClaimHash(record);
  record.snapshotHash = snapshotContentHash(record);
  validatePortfolioSnapshot(record);
  return deepFreeze(record);
}

function bindScenarioReference(input) {
  try {
    if (Object.hasOwn(input, 'scenarioHash')) {
      validateScenarioReference(input);
      return deepFreeze(cloneCanonical(input));
    }
    return createScenarioReference(input);
  } catch (error) {
    rethrowDock(error);
  }
}

function validateSweepInput(input, name) {
  asRecord(input, name);
  exactFields(input, ['dimension', 'state', 'value', 'unit', 'ownerRef'], name);
  requireFields(input, ['dimension', 'state', 'value', 'unit', 'ownerRef'], name);
  enumValue(input.dimension, SWEEP_DIMENSIONS, `${name}.dimension`);
  enumValue(input.state, ['KNOWN', 'UNKNOWN', 'UNAVAILABLE'], `${name}.state`);
  boundedString(input.unit, `${name}.unit`, 64);
  boundedString(input.ownerRef, `${name}.ownerRef`, 8_192);
  const expectedUnit = SWEEP_UNIT_REQUIREMENTS[input.dimension];
  validatePacketOwnerAttribution(input.ownerRef, SWEEP_OWNER_KEYS[input.dimension], `${name}.ownerRef`);
  if (expectedUnit !== 'REPORTING_UNIT' && input.unit !== expectedUnit) fail('SWEEP_UNIT_INVALID', `${name}.unit must be ${expectedUnit}`);
  if (input.state === 'KNOWN') {
    const value = parseAtoms(input.value, `${name}.value`);
    if (input.unit === 'PPM' && (value < -1_000_000n || value > 1_000_000n)) fail('SWEEP_VALUE_OUT_OF_RANGE', `${name}.value exceeds PPM bounds`);
    if (input.unit === 'MILLISECONDS' && value < 0n) fail('SWEEP_VALUE_OUT_OF_RANGE', `${name}.value cannot be negative milliseconds`);
  } else if (input.value !== null) {
    fail('SWEEP_UNKNOWN_SHAPE_INVALID', `${name}.value must be null when ${input.state}`);
  }
}

function validateImpact(input, reportingUnit, name) {
  asRecord(input, name);
  exactFields(input, ['impactId', 'subjectId', 'category', 'delta', 'lowerBound', 'upperBound', 'ownerOutputRef'], name);
  requireFields(input, ['impactId', 'subjectId', 'category', 'delta', 'lowerBound', 'upperBound', 'ownerOutputRef'], name);
  for (const field of ['impactId', 'subjectId', 'ownerOutputRef']) boundedString(input[field], `${name}.${field}`, field === 'ownerOutputRef' ? 8_192 : 256);
  enumValue(input.category, IMPACT_CATEGORIES, `${name}.category`);
  validatePacketOwnerAttribution(input.ownerOutputRef, IMPACT_OWNER_KEYS[input.category], `${name}.ownerOutputRef`);
  for (const field of ['delta', 'lowerBound', 'upperBound']) validateExactMetric(input[field], reportingUnit, `${name}.${field}`);
  const states = [input.delta.state, input.lowerBound.state, input.upperBound.state];
  if (new Set(states).size !== 1) fail('IMPACT_UNCERTAINTY_STATE_MISMATCH', `${name} delta and bounds must share one state`);
  if (input.delta.state === 'KNOWN') {
    if (compareKnown(input.lowerBound.atoms, input.delta.atoms, name) > 0 || compareKnown(input.delta.atoms, input.upperBound.atoms, name) > 0) {
      fail('IMPACT_INTERVAL_INVALID', `${name} must satisfy lower <= delta <= upper`);
    }
  }
}

export function validateScenarioCallerFact(input, name = 'ScenarioCallerFactV1') {
  asRecord(input, name);
  exactFields(input, ['factId', 'subjectId', 'category', 'before', 'after', 'ownerOutputRef'], name);
  requireFields(input, ['factId', 'subjectId', 'category', 'before', 'after', 'ownerOutputRef'], name);
  for (const field of ['factId', 'subjectId', 'ownerOutputRef']) {
    boundedString(input[field], `${name}.${field}`, field === 'ownerOutputRef' ? 8_192 : 256);
  }
  enumValue(input.category, ['LIQUIDATION_DISTANCE', 'MARGIN_HEADROOM'], `${name}.category`);
  validatePacketOwnerAttribution(input.ownerOutputRef, 'RISK', `${name}.ownerOutputRef`);
  validateExactMetric(input.before, null, `${name}.before`);
  validateExactMetric(input.after, null, `${name}.after`);
  if (input.before.unit !== input.after.unit || input.before.state !== input.after.state) {
    fail('CALLER_FACT_SHAPE_MISMATCH', `${name} before and after facts must share one state and unit`);
  }
  if (input.category === 'LIQUIDATION_DISTANCE') {
    if (input.before.unit !== 'PPM') fail('LIQUIDATION_DISTANCE_UNIT_INVALID', `${name} liquidation distance must use PPM`);
    if (input.before.state === 'KNOWN') {
      const before = parseAtoms(input.before.atoms, `${name}.before.atoms`);
      const after = parseAtoms(input.after.atoms, `${name}.after.atoms`);
      if (before < 0n || before > 1_000_000n || after < 0n || after > 1_000_000n) {
        fail('LIQUIDATION_DISTANCE_RANGE_INVALID', `${name} liquidation distance must remain within 0..1000000 PPM`);
      }
      if (after >= before) fail('LIQUIDATION_COMPRESSION_INVALID', `${name} must show a strict caller-supplied liquidation-distance compression`);
    }
  } else {
    if (input.before.unit !== 'USDT_MICRO') fail('MARGIN_HEADROOM_UNIT_INVALID', `${name} margin headroom must use USDT_MICRO`);
    if (input.before.state !== 'KNOWN') return true;
    const before = parseAtoms(input.before.atoms, `${name}.before.atoms`);
    const after = parseAtoms(input.after.atoms, `${name}.after.atoms`);
    if (before < 0n || after < 0n) fail('MARGIN_HEADROOM_RANGE_INVALID', `${name} margin headroom cannot be negative`);
    if (after >= before) fail('MARGIN_HEADROOM_COMPRESSION_INVALID', `${name} must show a strict caller-supplied margin-headroom compression`);
  }
  return true;
}

export function validateScenarioEvaluationInput(input) {
  const evaluation = asRecord(input, 'PortfolioScenarioEvaluationInputV1');
  const fields = [
    'schema', 'version', 'evaluationId', 'scenarioKind', 'snapshotHash', 'snapshotOwnerClaimHash', 'scenarioReference',
    'scenarioDefinitionStatus', 'ownerEvidenceStatus', 'ownerEvidenceHash', 'ownerClaimHash',
    'origin', 'seed', 'horizon', 'reproducibilityInputs', 'assumptions', 'sweepInputs',
    'impacts', 'callerFacts', 'stateChanges', 'missingDependencies', 'uncertainty', 'outputMode',
    'whyNotLiveSizing', 'authorityClass', 'networkMode', 'evaluationHash',
  ];
  exactFields(evaluation, fields, 'PortfolioScenarioEvaluationInputV1');
  requireFields(evaluation, fields, 'PortfolioScenarioEvaluationInputV1');
  assertCanonicalJson(evaluation, 'PortfolioScenarioEvaluationInputV1');
  assertNoForbiddenCapabilities(evaluation);
  if (evaluation.schema !== 'PortfolioScenarioEvaluationInputV1' || evaluation.version !== 1) fail('CONTRACT_VERSION_UNSUPPORTED', 'PortfolioScenarioEvaluationInputV1 version 1 is required');
  boundedString(evaluation.evaluationId, 'PortfolioScenarioEvaluationInputV1.evaluationId', 256);
  enumValue(evaluation.scenarioKind, SCENARIO_KINDS, 'PortfolioScenarioEvaluationInputV1.scenarioKind');
  if (!/^[a-f0-9]{64}$/.test(evaluation.snapshotHash)) fail('SNAPSHOT_REFERENCE_INVALID', 'snapshotHash must be SHA-256');
  if (!/^[a-f0-9]{64}$/.test(evaluation.snapshotOwnerClaimHash)) fail('SNAPSHOT_OWNER_CLAIM_REFERENCE_INVALID', 'snapshotOwnerClaimHash must be SHA-256');
  validateUnacceptedScenarioReferenceBoundary(
    evaluation.scenarioReference,
    evaluation.scenarioDefinitionStatus,
  );
  validateOwnerEvidenceAnchor(evaluation, 'PortfolioScenarioEvaluationInputV1');
  for (const field of ['ownerEvidenceHash', 'ownerClaimHash']) {
    if (!/^[a-f0-9]{64}$/.test(evaluation[field])) fail('OWNER_EVIDENCE_HASH_INVALID', `PortfolioScenarioEvaluationInputV1.${field} must be SHA-256`);
  }
  enumValue(evaluation.origin, ['HYPOTHETICAL', 'SYNTHETIC'], 'PortfolioScenarioEvaluationInputV1.origin');
  safeInteger(evaluation.seed, 'PortfolioScenarioEvaluationInputV1.seed', { minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER });
  if (evaluation.seed !== evaluation.scenarioReference.seed) fail('SCENARIO_SEED_MISMATCH', 'evaluation seed must match its immutable scenario reference');
  asRecord(evaluation.horizon, 'PortfolioScenarioEvaluationInputV1.horizon');
  exactFields(evaluation.horizon, ['startMs', 'endMs'], 'PortfolioScenarioEvaluationInputV1.horizon');
  requireFields(evaluation.horizon, ['startMs', 'endMs'], 'PortfolioScenarioEvaluationInputV1.horizon');
  safeInteger(evaluation.horizon.startMs, 'PortfolioScenarioEvaluationInputV1.horizon.startMs');
  safeInteger(evaluation.horizon.endMs, 'PortfolioScenarioEvaluationInputV1.horizon.endMs');
  if (evaluation.horizon.endMs <= evaluation.horizon.startMs) fail('HORIZON_INVALID', 'scenario horizon end must follow start');
  stringArray(evaluation.reproducibilityInputs, 'PortfolioScenarioEvaluationInputV1.reproducibilityInputs', 512);
  if (evaluation.reproducibilityInputs.length === 0) fail('REPRODUCIBILITY_INPUT_REQUIRED', 'scenario needs reproducibility inputs');
  const archiveMarkers = evaluation.reproducibilityInputs.filter((entry) => entry.startsWith('history-'));
  if (archiveMarkers.length > 0) {
    validateExactBootstrapArchiveMarkers(evaluation);
  }
  validateUnacceptedScenarioReferenceBoundary(
    evaluation.scenarioReference,
    evaluation.scenarioDefinitionStatus,
    evaluation.reproducibilityInputs,
  );
  asRecord(evaluation.assumptions, 'PortfolioScenarioEvaluationInputV1.assumptions');
  exactFields(evaluation.assumptions, ['narrative', 'severity', 'liquidity', 'fills', 'exclusions'], 'PortfolioScenarioEvaluationInputV1.assumptions');
  requireFields(evaluation.assumptions, ['narrative', 'severity', 'liquidity', 'fills', 'exclusions'], 'PortfolioScenarioEvaluationInputV1.assumptions');
  for (const field of ['narrative', 'severity', 'liquidity', 'fills']) boundedString(evaluation.assumptions[field], `PortfolioScenarioEvaluationInputV1.assumptions.${field}`);
  stringArray(evaluation.assumptions.exclusions, 'PortfolioScenarioEvaluationInputV1.assumptions.exclusions', 128);

  boundedArray(evaluation.sweepInputs, 'PortfolioScenarioEvaluationInputV1.sweepInputs', MAXIMUMS.sweepInputs);
  evaluation.sweepInputs.forEach((row, index) => validateSweepInput(row, `PortfolioScenarioEvaluationInputV1.sweepInputs[${index}]`));
  const dimensions = evaluation.sweepInputs.map((row) => row.dimension);
  if (dimensions.length !== SWEEP_DIMENSIONS.length || dimensions.some((dimension, index) => dimension !== SWEEP_DIMENSIONS[index])) {
    fail('SWEEP_DIMENSION_SET_INVALID', 'sweep inputs must name the seven caller-supplied dimensions once in frozen order');
  }

  boundedArray(evaluation.impacts, 'PortfolioScenarioEvaluationInputV1.impacts', MAXIMUMS.impacts);
  if (evaluation.impacts.length === 0) fail('SCENARIO_IMPACT_REQUIRED', 'scenario evaluation needs at least one explicit owner-referenced impact');
  evaluation.impacts.forEach((row, index) => validateImpact(row, row.delta.unit, `PortfolioScenarioEvaluationInputV1.impacts[${index}]`));
  const impactIds = evaluation.impacts.map((row) => row.impactId);
  if (new Set(impactIds).size !== impactIds.length) fail('IMPACT_ID_DUPLICATE', 'scenario impact identities must be unique');
  for (const field of ['delta', 'lowerBound', 'upperBound']) {
    const known = evaluation.impacts.filter((row) => row[field].state === 'KNOWN');
    const total = known.reduce((sum, row) => sum + parseAtoms(row[field].atoms, `PortfolioScenarioEvaluationInputV1.${field}`), 0n);
    if (total.toString().replace('-', '').length > 96) {
      fail('EXACT_ATOMS_INVALID', `PortfolioScenarioEvaluationInputV1 aggregate ${field} exceeds the 96-digit exact-integer bound`);
    }
  }

  boundedArray(evaluation.callerFacts, 'PortfolioScenarioEvaluationInputV1.callerFacts', MAXIMUMS.callerFacts);
  evaluation.callerFacts.forEach((row, index) => validateScenarioCallerFact(row, `PortfolioScenarioEvaluationInputV1.callerFacts[${index}]`));
  if (new Set(evaluation.callerFacts.map((row) => row.factId)).size !== evaluation.callerFacts.length) {
    fail('CALLER_FACT_ID_DUPLICATE', 'scenario caller fact identities must be unique');
  }
  if (evaluation.scenarioKind === 'LIQUIDATION_DISTANCE_COMPRESSION') {
    const requiredFacts = ['LIQUIDATION_DISTANCE', 'MARGIN_HEADROOM'];
    if (evaluation.callerFacts.length !== requiredFacts.length
      || evaluation.callerFacts.some((row, index) => row.category !== requiredFacts[index]
        || row.before.state !== 'KNOWN' || row.after.state !== 'KNOWN')) {
      fail('LIQUIDATION_CALLER_FACTS_REQUIRED', 'liquidation-distance compression requires exact known liquidation-distance and margin-headroom caller facts');
    }
  }

  boundedArray(evaluation.stateChanges, 'PortfolioScenarioEvaluationInputV1.stateChanges', MAXIMUMS.stateChanges);
  evaluation.stateChanges.forEach((row, index) => {
    const name = `PortfolioScenarioEvaluationInputV1.stateChanges[${index}]`;
    asRecord(row, name);
    exactFields(row, ['subjectId', 'category', 'before', 'after', 'ownerOutputRef'], name);
    requireFields(row, ['subjectId', 'category', 'before', 'after', 'ownerOutputRef'], name);
    for (const field of ['subjectId', 'category', 'before', 'after', 'ownerOutputRef']) boundedString(row[field], `${name}.${field}`, field === 'ownerOutputRef' ? 8_192 : 256);
    if (!Object.hasOwn(STATE_CHANGE_OWNER_KEYS, row.category)) {
      fail('STATE_CHANGE_CATEGORY_INVALID', `${name}.category is not part of the packet-local Section 5 fixture vocabulary`);
    }
    validatePacketOwnerAttribution(row.ownerOutputRef, STATE_CHANGE_OWNER_KEYS[row.category], `${name}.ownerOutputRef`);
  });
  stringArray(evaluation.missingDependencies, 'PortfolioScenarioEvaluationInputV1.missingDependencies', MAXIMUMS.missingDependencies);

  asRecord(evaluation.uncertainty, 'PortfolioScenarioEvaluationInputV1.uncertainty');
  exactFields(evaluation.uncertainty, ['state', 'unit', 'lowerAtoms', 'upperAtoms', 'method', 'sourceRefs'], 'PortfolioScenarioEvaluationInputV1.uncertainty');
  requireFields(evaluation.uncertainty, ['state', 'unit', 'lowerAtoms', 'upperAtoms', 'method', 'sourceRefs'], 'PortfolioScenarioEvaluationInputV1.uncertainty');
  enumValue(evaluation.uncertainty.state, ['KNOWN', 'UNKNOWN', 'UNAVAILABLE'], 'PortfolioScenarioEvaluationInputV1.uncertainty.state');
  boundedString(evaluation.uncertainty.unit, 'PortfolioScenarioEvaluationInputV1.uncertainty.unit', 64);
  if (evaluation.uncertainty.unit !== 'USDT_MICRO') {
    fail('UNCERTAINTY_REPORTING_UNIT_MISMATCH', 'fixture uncertainty must use the packet reporting unit USDT_MICRO');
  }
  boundedString(evaluation.uncertainty.method, 'PortfolioScenarioEvaluationInputV1.uncertainty.method', 256);
  stringArray(evaluation.uncertainty.sourceRefs, 'PortfolioScenarioEvaluationInputV1.uncertainty.sourceRefs', 128);
  if (evaluation.uncertainty.sourceRefs.length === 0) fail('UNCERTAINTY_SOURCE_REQUIRED', 'uncertainty needs at least one owner output reference');
  if (evaluation.uncertainty.state === 'KNOWN') {
    parseAtoms(evaluation.uncertainty.lowerAtoms, 'PortfolioScenarioEvaluationInputV1.uncertainty.lowerAtoms');
    parseAtoms(evaluation.uncertainty.upperAtoms, 'PortfolioScenarioEvaluationInputV1.uncertainty.upperAtoms');
    if (compareKnown(evaluation.uncertainty.lowerAtoms, evaluation.uncertainty.upperAtoms, 'uncertainty') > 0) fail('UNCERTAINTY_INTERVAL_INVALID', 'uncertainty lower must not exceed upper');
  } else if (evaluation.uncertainty.lowerAtoms !== null || evaluation.uncertainty.upperAtoms !== null) {
    fail('UNCERTAINTY_SHAPE_INVALID', 'unknown uncertainty interval bounds must be null');
  }
  if (evaluation.scenarioKind === 'LIQUIDATION_DISTANCE_COMPRESSION'
    && evaluation.callerFacts[1].before.unit !== evaluation.uncertainty.unit) {
    fail('MARGIN_HEADROOM_UNIT_INVALID', 'margin headroom must use the scenario reporting unit');
  }
  enumValue(evaluation.outputMode, ['COMPARATIVE'], 'PortfolioScenarioEvaluationInputV1.outputMode');
  boundedString(evaluation.whyNotLiveSizing, 'PortfolioScenarioEvaluationInputV1.whyNotLiveSizing', 2_048);
  if (evaluation.authorityClass !== 'NO_AUTHORITY' || evaluation.networkMode !== 'FIXTURE_ONLY') fail('AUTHORITY_BOUNDARY_INVALID', 'scenario evaluation input must remain fixture-only and non-authoritative');
  if (evaluation.ownerClaimHash !== scenarioOwnerClaimHash(evaluation)) {
    fail('SCENARIO_OWNER_CLAIM_MISMATCH', 'scenario owner claim hash does not bind the exact caller-supplied fixture values and provenance');
  }
  validateAllowedScenarioOwnerClaim(evaluation.ownerClaimHash);
  validateHash(evaluation, 'evaluationHash', 'EVALUATION_HASH_MISMATCH');
  return true;
}

export function createScenarioEvaluationInput(input) {
  assertCanonicalJson(input, 'PortfolioScenarioEvaluationInputV1');
  assertNoForbiddenCapabilities(input);
  const record = cloneCanonical(input);
  requireFields(record, [
    'schema', 'version', 'evaluationId', 'scenarioKind', 'snapshotHash', 'snapshotOwnerClaimHash',
    'scenarioReference', 'scenarioDefinitionStatus', 'origin', 'seed', 'horizon',
    'reproducibilityInputs', 'assumptions', 'sweepInputs', 'impacts', 'stateChanges',
    'missingDependencies', 'uncertainty', 'outputMode', 'whyNotLiveSizing',
    'authorityClass', 'networkMode',
  ], 'PortfolioScenarioEvaluationInputV1');
  record.scenarioReference = bindScenarioReference(record.scenarioReference);
  if (!Object.hasOwn(record, 'callerFacts')) record.callerFacts = [];
  delete record.evaluationHash;
  delete record.ownerClaimHash;
  bindOwnerEvidenceAnchor(record);
  record.ownerClaimHash = scenarioOwnerClaimHash(record);
  record.evaluationHash = sha256(omitFields(record, ['evaluationHash']));
  validateScenarioEvaluationInput(record);
  return deepFreeze(record);
}

import { sha256 } from '../../dock/src/index.mjs';
import { arrayValue, asRecord, boundedString, deepFreeze, exactFields, safeInteger, stableSort } from './guards.mjs';
import {
  FIXED_SCALE,
  decimalToMantissa,
  fixedPointValue,
  mantissaToDecimal,
  ratioToBpsMantissa,
  sumMantissas,
} from './decimal.mjs';
import { compareInstrumentIdentity } from './identity.mjs';
import { validateMarketEvidenceEnvelope } from './evidence.mjs';
import { fail } from './errors.mjs';

const COST_FIELDS = Object.freeze(['buyFeeBps', 'sellFeeBps', 'tickRoundingBps', 'latencyBps', 'depthImpactBps']);

export function validateFeatureValueV1(value) {
  asRecord(value, 'FeatureValueV1');
  exactFields(value, ['featureId', 'asOfNs', 'inputLastEventNs', 'status', 'value'], 'FeatureValueV1');
  boundedString(value.featureId, 'FeatureValueV1.featureId', 128);
  if (!/^[A-Za-z0-9_.:\-]{1,128}$/.test(value.featureId)) fail('FEATURE_ID_INVALID', 'FeatureValueV1 featureId is invalid');
  for (const field of ['asOfNs', 'inputLastEventNs']) {
    if (typeof value[field] !== 'string' || !/^[0-9]+$/.test(value[field])) fail('FEATURE_TIME_INVALID', `FeatureValueV1.${field} must be unsigned nanosecond text`);
  }
  const asOfNs = BigInt(value.asOfNs);
  const inputLastEventNs = BigInt(value.inputLastEventNs);
  const minimumNs = 1_262_304_000_000_000_000n;
  const maximumNs = 4_102_444_800_000_000_000n;
  if (asOfNs < minimumNs || asOfNs > maximumNs || inputLastEventNs < minimumNs || inputLastEventNs > asOfNs) {
    fail('FEATURE_TIME_ORDER_INVALID', 'FeatureValueV1 times are outside UTC bounds or input follows as-of');
  }
  if (!['AVAILABLE', 'STALE', 'UNKNOWN', 'DATA_INVALID'].includes(value.status)) fail('FEATURE_STATUS_INVALID', 'unsupported FeatureValueV1 status');
  if (value.status === 'AVAILABLE') {
    asRecord(value.value, 'FeatureValueV1.value');
    exactFields(value.value, ['mantissa', 'scale'], 'FeatureValueV1.value');
    if (typeof value.value.mantissa !== 'string' || !/^-?[0-9]+$/.test(value.value.mantissa) || value.value.scale !== FIXED_SCALE.toString()) {
      fail('FEATURE_FIXED_POINT_INVALID', 'FeatureValueV1 value must use exact integer mantissa and 1e12 scale');
    }
  } else if (value.value !== null) {
    fail('FEATURE_VALUE_PRESENCE_INVALID', 'FeatureValueV1 value exists exactly when AVAILABLE');
  }
  return true;
}

function canonicalProjectionDecimal(value, field, options) {
  const mantissa = decimalToMantissa(value, field, options);
  if (mantissaToDecimal(mantissa) !== value) fail('PROJECTION_DECIMAL_NOT_CANONICAL', `${field} must be canonical decimal text`);
  return mantissa;
}

export function validateVenueDislocationProjection(projection) {
  asRecord(projection, 'VenueDislocationProjectionV1');
  exactFields(projection, [
    'schema', 'projectionId', 'state', 'reasonCodes', 'identityComparison', 'rawSpreadBps',
    'costStackBps', 'netSpreadBps', 'intendedBaseSize', 'depthSufficient', 'economicState',
    'featureValue', 'evidenceIds', 'costStack', 'observationOnly', 'action', 'canonical',
    'authorityClass', 'networkMode',
  ], 'VenueDislocationProjectionV1');
  if (projection.schema !== 'VenueDislocationProjectionV1') fail('PROJECTION_SCHEMA_INVALID', 'projection must be VenueDislocationProjectionV1');
  boundedString(projection.projectionId, 'projection.projectionId', 128);
  if (!['AVAILABLE', 'STALE', 'UNKNOWN', 'DATA_INVALID'].includes(projection.state)) fail('PROJECTION_STATE_INVALID', 'projection state is unsupported');
  arrayValue(projection.reasonCodes, 'projection.reasonCodes', { maximum: 128 });
  const reasons = projection.reasonCodes.map((reason, index) => boundedString(reason, `projection.reasonCodes[${index}]`, 256));
  const orderedReasons = [...new Set(reasons)].sort();
  if (orderedReasons.length !== reasons.length || orderedReasons.some((reason, index) => reason !== reasons[index])) fail('PROJECTION_REASON_ORDER_INVALID', 'projection reasons must be sorted and unique');
  asRecord(projection.identityComparison, 'projection.identityComparison');
  exactFields(projection.identityComparison, ['schema', 'comparable', 'sameTickerText', 'reasonCodes', 'leftIdentityId', 'rightIdentityId', 'authorityClass'], 'projection.identityComparison');
  if (projection.identityComparison.schema !== 'VenueIdentityComparisonV1'
    || typeof projection.identityComparison.comparable !== 'boolean'
    || typeof projection.identityComparison.sameTickerText !== 'boolean'
    || projection.identityComparison.authorityClass !== 'NO_AUTHORITY') {
    fail('PROJECTION_IDENTITY_COMPARISON_INVALID', 'projection identity comparison must remain typed and no-authority');
  }
  arrayValue(projection.identityComparison.reasonCodes, 'projection.identityComparison.reasonCodes', { maximum: 128 });
  const identityReasons = projection.identityComparison.reasonCodes.map((reason, index) => boundedString(reason, `projection.identityComparison.reasonCodes[${index}]`, 256));
  const orderedIdentityReasons = [...new Set(identityReasons)].sort();
  if (orderedIdentityReasons.length !== identityReasons.length || orderedIdentityReasons.some((reason, index) => reason !== identityReasons[index])) fail('PROJECTION_IDENTITY_REASON_ORDER_INVALID', 'identity reasons must be sorted and unique');
  if (projection.identityComparison.comparable !== (identityReasons.length === 0)) fail('PROJECTION_IDENTITY_COMPARABILITY_INVALID', 'identity comparable flag must agree with identity reasons');
  boundedString(projection.identityComparison.leftIdentityId, 'projection.identityComparison.leftIdentityId', 128);
  boundedString(projection.identityComparison.rightIdentityId, 'projection.identityComparison.rightIdentityId', 128);
  arrayValue(projection.evidenceIds, 'projection.evidenceIds', { minimum: 2, maximum: 2 });
  const evidenceIds = projection.evidenceIds.map((id, index) => boundedString(id, `projection.evidenceIds[${index}]`, 128));
  if (new Set(evidenceIds).size !== 2 || [...evidenceIds].sort().some((id, index) => id !== evidenceIds[index])) fail('PROJECTION_EVIDENCE_ORDER_INVALID', 'projection evidence IDs must be distinct and sorted');
  if (typeof projection.depthSufficient !== 'boolean') fail('PROJECTION_DEPTH_FLAG_INVALID', 'projection depthSufficient must be boolean');
  if (projection.observationOnly !== true || projection.action !== null || projection.canonical !== false || projection.authorityClass !== 'NO_AUTHORITY' || projection.networkMode !== 'FIXTURE_ONLY') {
    fail('PROJECTION_AUTHORITY_WIDENING', 'projection must remain fixture-only, non-canonical, and actionless');
  }
  validateFeatureValueV1(projection.featureValue);
  if (projection.featureValue.featureId !== 'venue_mesh.net_dislocation_bps' || projection.featureValue.status !== projection.state) {
    fail('PROJECTION_FEATURE_STATE_MISMATCH', 'projection and feature value states must agree');
  }
  if (projection.state === 'AVAILABLE') {
    if (projection.identityComparison.comparable !== true) fail('PROJECTION_AVAILABLE_IDENTITY_INVALID', 'available projection requires comparable identities');
    const rawSpread = canonicalProjectionDecimal(projection.rawSpreadBps, 'projection.rawSpreadBps', { allowNegative: true });
    const costStackBps = canonicalProjectionDecimal(projection.costStackBps, 'projection.costStackBps');
    const netSpread = canonicalProjectionDecimal(projection.netSpreadBps, 'projection.netSpreadBps', { allowNegative: true });
    if (canonicalProjectionDecimal(projection.intendedBaseSize, 'projection.intendedBaseSize') <= 0n) fail('PROJECTION_SIZE_INVALID', 'projection intended size must be positive');
    if (projection.depthSufficient !== true) fail('PROJECTION_DEPTH_INCONSISTENT', 'available projection requires sufficient fixture depth');
    if (!['POSITIVE_SYNTHETIC_PROJECTION', 'NON_VIABLE_AFTER_COSTS'].includes(projection.economicState)) fail('PROJECTION_ECONOMIC_STATE_INVALID', 'available projection has unsupported economic state');
    asRecord(projection.costStack, 'projection.costStack');
    exactFields(projection.costStack, COST_FIELDS, 'projection.costStack');
    const costParts = COST_FIELDS.map((field) => canonicalProjectionDecimal(projection.costStack[field], `projection.costStack.${field}`));
    if (sumMantissas(costParts, 'projection.costStack') !== costStackBps) fail('PROJECTION_COST_SUM_MISMATCH', 'cost stack total must equal its exact parts');
    if (rawSpread - costStackBps !== netSpread) fail('PROJECTION_NET_ARITHMETIC_MISMATCH', 'net spread must equal raw spread minus the cost stack');
    if (projection.featureValue.value.mantissa !== netSpread.toString()) fail('PROJECTION_FEATURE_VALUE_MISMATCH', 'feature fixed-point value must equal net spread');
    const positive = netSpread > 0n;
    if (projection.economicState !== (positive ? 'POSITIVE_SYNTHETIC_PROJECTION' : 'NON_VIABLE_AFTER_COSTS')) fail('PROJECTION_ECONOMIC_STATE_MISMATCH', 'economic state must follow exact net spread');
    const expectedReasons = positive ? [] : ['COST_STACK_ERASES_RAW_SPREAD'];
    if (expectedReasons.length !== projection.reasonCodes.length || expectedReasons.some((reason, index) => projection.reasonCodes[index] !== reason)) fail('PROJECTION_ECONOMIC_REASON_MISMATCH', 'projection reasons must follow exact net economics');
  } else {
    for (const field of ['rawSpreadBps', 'costStackBps', 'netSpreadBps', 'intendedBaseSize', 'costStack']) {
      if (projection[field] !== null) fail('PROJECTION_UNKNOWN_VALUE_PRESENT', `projection.${field} must be null when unavailable`);
    }
    if (projection.depthSufficient !== false || projection.economicState !== 'UNKNOWN') fail('PROJECTION_UNKNOWN_STATE_INCONSISTENT', 'unavailable projection cannot claim depth or economics');
  }
  return true;
}

function featureValue({ featureId, asOfMs, inputLastEventMs, status, mantissa }) {
  boundedString(featureId, 'featureValue.featureId', 128);
  safeInteger(asOfMs, 'featureValue.asOfMs', { minimum: 1_262_304_000_000, maximum: 4_102_444_800_000 });
  safeInteger(inputLastEventMs, 'featureValue.inputLastEventMs', { minimum: 1_262_304_000_000, maximum: asOfMs });
  if (!['AVAILABLE', 'STALE', 'UNKNOWN', 'DATA_INVALID'].includes(status)) fail('FEATURE_STATUS_INVALID', 'unsupported FeatureValueV1 status');
  if ((status === 'AVAILABLE') !== (mantissa !== null)) fail('FEATURE_VALUE_PRESENCE_INVALID', 'FeatureValueV1 value exists exactly when AVAILABLE');
  const record = {
    featureId,
    asOfNs: (BigInt(asOfMs) * 1_000_000n).toString(),
    inputLastEventNs: (BigInt(inputLastEventMs) * 1_000_000n).toString(),
    status,
    value: mantissa === null ? null : fixedPointValue(mantissa),
  };
  validateFeatureValueV1(record);
  return record;
}

function quoteMantissa(evidence, field) {
  const value = evidence.payload?.[field];
  return value === null || value === undefined ? null : decimalToMantissa(value, `evidence.payload.${field}`);
}

function recomputeFreshness(evidence, asOfMs, maximumAgeMs, leg) {
  if (!Number.isSafeInteger(maximumAgeMs) || maximumAgeMs <= 0) return { state: 'UNKNOWN', reasonCode: `${leg}_FRESHNESS_BOUND_UNKNOWN` };
  const basisMs = evidence.exchangeEventTimeMs ?? evidence.localReceiveTimeMs;
  if (basisMs > asOfMs) return { state: 'DATA_INVALID', reasonCode: `${leg}_EVIDENCE_AFTER_AS_OF` };
  if (evidence.quality.freshness !== 'FRESH' || asOfMs - basisMs > maximumAgeMs) return { state: 'STALE', reasonCode: `${leg}_SOURCE_AGE_EXCEEDED` };
  return { state: 'FRESH', reasonCode: null };
}

function evidenceIdentityReasons(evidence, identity, leg) {
  const reasons = [];
  if (evidence.instrumentGraph.venue !== identity.venue) reasons.push(`${leg}_EVIDENCE_VENUE_MISMATCH`);
  if (evidence.instrumentGraph.symbol !== identity.symbol) reasons.push(`${leg}_EVIDENCE_SYMBOL_MISMATCH`);
  if (evidence.instrumentGraph.product !== identity.canonicalProduct) reasons.push(`${leg}_EVIDENCE_PRODUCT_MISMATCH`);
  if (evidence.instrumentGraph.canonicalAsset !== identity.baseCanonicalAssetId) reasons.push(`${leg}_EVIDENCE_ASSET_MISMATCH`);
  return reasons;
}

function unavailableResult({ buyEvidence, sellEvidence, asOfMs, status, reasonCodes, identityComparison }) {
  const lastEvent = Math.min(
    buyEvidence.exchangeEventTimeMs ?? buyEvidence.localReceiveTimeMs,
    sellEvidence.exchangeEventTimeMs ?? sellEvidence.localReceiveTimeMs,
    asOfMs,
  );
  const record = {
    schema: 'VenueDislocationProjectionV1',
    projectionId: `vm.dislocation.${sha256({ buy: buyEvidence.evidenceId, sell: sellEvidence.evidenceId, asOfMs, reasonCodes }).slice(0, 24)}`,
    state: status,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    identityComparison,
    rawSpreadBps: null,
    costStackBps: null,
    netSpreadBps: null,
    intendedBaseSize: null,
    depthSufficient: false,
    economicState: 'UNKNOWN',
    featureValue: featureValue({ featureId: 'venue_mesh.net_dislocation_bps', asOfMs, inputLastEventMs: lastEvent, status, mantissa: null }),
    evidenceIds: [buyEvidence.evidenceId, sellEvidence.evidenceId].sort(),
    costStack: null,
    observationOnly: true,
    action: null,
    canonical: false,
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
  };
  validateVenueDislocationProjection(record);
  return deepFreeze(record);
}

export function compareVenueQuotes({ buyEvidence, sellEvidence, buyIdentity, sellIdentity, costs, intendedBaseSize, asOfMs, freshnessBoundsMs, sourceEligibility }) {
  validateMarketEvidenceEnvelope(buyEvidence);
  validateMarketEvidenceEnvelope(sellEvidence);
  asRecord(costs, 'comparison.costs');
  asRecord(freshnessBoundsMs, 'comparison.freshnessBoundsMs');
  asRecord(sourceEligibility, 'comparison.sourceEligibility');
  safeInteger(asOfMs, 'comparison.asOfMs', { minimum: 1_262_304_000_000, maximum: 4_102_444_800_000 });
  if (buyEvidence.payloadKind !== 'BOOK_TICKER' || sellEvidence.payloadKind !== 'BOOK_TICKER') fail('COMPARISON_QUOTE_REQUIRED', 'cross-venue comparison requires book-ticker evidence');
  const identityComparison = compareInstrumentIdentity(buyIdentity, sellIdentity);
  const evidenceIdentityMismatches = [
    ...evidenceIdentityReasons(buyEvidence, buyIdentity, 'BUY'),
    ...evidenceIdentityReasons(sellEvidence, sellIdentity, 'SELL'),
  ];
  if (evidenceIdentityMismatches.length > 0) {
    return unavailableResult({ buyEvidence, sellEvidence, asOfMs, status: 'DATA_INVALID', reasonCodes: evidenceIdentityMismatches, identityComparison });
  }
  if (!identityComparison.comparable) {
    return unavailableResult({ buyEvidence, sellEvidence, asOfMs, status: 'DATA_INVALID', reasonCodes: identityComparison.reasonCodes, identityComparison });
  }
  if (sourceEligibility.buy !== true || sourceEligibility.sell !== true) {
    return unavailableResult({ buyEvidence, sellEvidence, asOfMs, status: 'UNKNOWN', reasonCodes: ['SOURCE_TERMS_INELIGIBLE'], identityComparison });
  }
  const freshness = [
    recomputeFreshness(buyEvidence, asOfMs, freshnessBoundsMs.buy, 'BUY'),
    recomputeFreshness(sellEvidence, asOfMs, freshnessBoundsMs.sell, 'SELL'),
  ];
  if (freshness.some((row) => row.state === 'DATA_INVALID')) {
    return unavailableResult({ buyEvidence, sellEvidence, asOfMs, status: 'DATA_INVALID', reasonCodes: freshness.filter((row) => row.reasonCode !== null).map((row) => row.reasonCode), identityComparison });
  }
  if (freshness.some((row) => row.state === 'UNKNOWN')) {
    return unavailableResult({ buyEvidence, sellEvidence, asOfMs, status: 'UNKNOWN', reasonCodes: freshness.filter((row) => row.reasonCode !== null).map((row) => row.reasonCode), identityComparison });
  }
  if (freshness.some((row) => row.state === 'STALE')) {
    return unavailableResult({ buyEvidence, sellEvidence, asOfMs, status: 'STALE', reasonCodes: freshness.filter((row) => row.reasonCode !== null).map((row) => row.reasonCode), identityComparison });
  }
  if ([buyEvidence, sellEvidence].some((row) => row.quality.gapCount > 0)) {
    return unavailableResult({ buyEvidence, sellEvidence, asOfMs, status: 'DATA_INVALID', reasonCodes: ['EVIDENCE_INCOMPLETE_OR_GAPPED'], identityComparison });
  }
  if ([buyEvidence, sellEvidence].some((row) => !['COMPLETE', 'SAMPLED'].includes(row.quality.completeness))) {
    return unavailableResult({ buyEvidence, sellEvidence, asOfMs, status: 'UNKNOWN', reasonCodes: ['EVIDENCE_INCOMPLETE_OR_GAPPED'], identityComparison });
  }
  const unknownCosts = COST_FIELDS.filter((field) => costs[field] === null || costs[field] === undefined);
  const buyAsk = quoteMantissa(buyEvidence, 'askPrice');
  const sellBid = quoteMantissa(sellEvidence, 'bidPrice');
  const buyDepth = quoteMantissa(buyEvidence, 'askSize');
  const sellDepth = quoteMantissa(sellEvidence, 'bidSize');
  if (unknownCosts.length > 0 || buyAsk === null || sellBid === null || buyDepth === null || sellDepth === null || intendedBaseSize === null) {
    return unavailableResult({
      buyEvidence,
      sellEvidence,
      asOfMs,
      status: 'UNKNOWN',
      reasonCodes: [...unknownCosts.map((field) => `COST_UNKNOWN_${field.toUpperCase()}`), 'PRICE_DEPTH_OR_SIZE_UNKNOWN'],
      identityComparison,
    });
  }
  if (buyAsk <= 0n || sellBid <= 0n) fail('COMPARISON_PRICE_INVALID', 'comparison prices must be positive');
  const intended = decimalToMantissa(intendedBaseSize, 'comparison.intendedBaseSize');
  const depthSufficient = intended > 0n && buyDepth >= intended && sellDepth >= intended;
  if (!depthSufficient) {
    return unavailableResult({ buyEvidence, sellEvidence, asOfMs, status: 'UNKNOWN', reasonCodes: ['EXECUTABLE_DEPTH_INSUFFICIENT'], identityComparison });
  }
  const rawSpread = sellBid - buyAsk;
  const rawSpreadBps = ratioToBpsMantissa(rawSpread, buyAsk, 'comparison.rawSpreadBps');
  const costMantissas = COST_FIELDS.map((field) => decimalToMantissa(costs[field], `comparison.costs.${field}`));
  const costStackBps = sumMantissas(costMantissas, 'comparison.costStackBps');
  const netSpreadBps = rawSpreadBps - costStackBps;
  const lastEvent = Math.min(
    buyEvidence.exchangeEventTimeMs ?? buyEvidence.localReceiveTimeMs,
    sellEvidence.exchangeEventTimeMs ?? sellEvidence.localReceiveTimeMs,
  );
  const record = {
    schema: 'VenueDislocationProjectionV1',
    projectionId: `vm.dislocation.${sha256({ buy: buyEvidence.evidenceId, sell: sellEvidence.evidenceId, costs, intendedBaseSize, asOfMs }).slice(0, 24)}`,
    state: 'AVAILABLE',
    reasonCodes: netSpreadBps > 0n ? [] : ['COST_STACK_ERASES_RAW_SPREAD'],
    identityComparison,
    rawSpreadBps: mantissaToDecimal(rawSpreadBps),
    costStackBps: mantissaToDecimal(costStackBps),
    netSpreadBps: mantissaToDecimal(netSpreadBps),
    intendedBaseSize: mantissaToDecimal(intended),
    depthSufficient,
    economicState: netSpreadBps > 0n ? 'POSITIVE_SYNTHETIC_PROJECTION' : 'NON_VIABLE_AFTER_COSTS',
    featureValue: featureValue({ featureId: 'venue_mesh.net_dislocation_bps', asOfMs, inputLastEventMs: lastEvent, status: 'AVAILABLE', mantissa: netSpreadBps }),
    evidenceIds: [buyEvidence.evidenceId, sellEvidence.evidenceId].sort(),
    costStack: Object.fromEntries(COST_FIELDS.map((field, index) => [field, mantissaToDecimal(costMantissas[index])])),
    observationOnly: true,
    action: null,
    canonical: false,
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
  };
  validateVenueDislocationProjection(record);
  return deepFreeze(record);
}

export function evaluateFixtureLeadership({ series, cutoffMs, minimumLeadMs, maximumAgeMs }) {
  arrayValue(series, 'leadership.series', { minimum: 2, maximum: 10_000 });
  safeInteger(cutoffMs, 'leadership.cutoffMs', { minimum: 1_262_304_000_000, maximum: 4_102_444_800_000 });
  safeInteger(minimumLeadMs, 'leadership.minimumLeadMs', { minimum: 1 });
  safeInteger(maximumAgeMs, 'leadership.maximumAgeMs', { minimum: 1 });
  const rows = stableSort(series.map((row, index) => {
    asRecord(row, `leadership.series[${index}]`);
    boundedString(row.venue, `leadership.series[${index}].venue`, 64);
    boundedString(row.instrumentKey, `leadership.series[${index}].instrumentKey`, 128);
    if (typeof row.sourceEligible !== 'boolean') fail('LEADERSHIP_SOURCE_ELIGIBILITY_INVALID', 'leadership sourceEligible must be boolean');
    safeInteger(row.eventTimeMs, `leadership.series[${index}].eventTimeMs`, { minimum: 1_262_304_000_000, maximum: cutoffMs });
    return { venue: row.venue, instrumentKey: row.instrumentKey, eventTimeMs: row.eventTimeMs, moveBps: mantissaToDecimal(decimalToMantissa(row.moveBps, `leadership.series[${index}].moveBps`, { allowNegative: true })), sourceEligible: row.sourceEligible };
  }), (row) => `${String(row.eventTimeMs).padStart(16, '0')}:${row.venue}`);
  const nonZero = rows.filter((row) => decimalToMantissa(row.moveBps, 'leadership.moveBps', { allowNegative: true }) !== 0n);
  const reasons = [];
  if (rows.some((row) => row.sourceEligible !== true)) reasons.push('SOURCE_TERMS_INELIGIBLE');
  if (new Set(rows.map((row) => row.instrumentKey)).size !== 1) reasons.push('INSTRUMENT_IDENTITY_MISMATCH');
  if (rows.some((row) => cutoffMs - row.eventTimeMs > maximumAgeMs)) reasons.push('SOURCE_AGE_EXCEEDED');
  const byVenue = new Map();
  for (const row of nonZero) if (!byVenue.has(row.venue)) byVenue.set(row.venue, row);
  const distinct = stableSort([...byVenue.values()], (row) => `${String(row.eventTimeMs).padStart(16, '0')}:${row.venue}`);
  if (distinct.length < 2) reasons.push('INSUFFICIENT_DISTINCT_VENUES');
  if (new Set(distinct.map((row) => decimalToMantissa(row.moveBps, 'leadership.moveBps', { allowNegative: true }) > 0n ? 'POSITIVE' : 'NEGATIVE')).size > 1) {
    reasons.push('MOVE_DIRECTION_MISMATCH');
  }
  if (reasons.length > 0) {
    return deepFreeze({ schema: 'VenueLeadershipProjectionV1', state: 'UNKNOWN', leaderVenue: null, leadMs: null, rows, reasonCodes: [...new Set(reasons)].sort(), causalClaim: false, profitabilityClaim: false, canonical: false, authorityClass: 'NO_AUTHORITY' });
  }
  const leadMs = distinct[1].eventTimeMs - distinct[0].eventTimeMs;
  return deepFreeze({
    schema: 'VenueLeadershipProjectionV1',
    state: leadMs >= minimumLeadMs ? 'OBSERVED_TEMPORAL_LEAD' : 'NO_STABLE_LEAD',
    leaderVenue: leadMs >= minimumLeadMs ? distinct[0].venue : null,
    leadMs,
    rows,
    reasonCodes: leadMs >= minimumLeadMs ? [] : ['LEAD_BELOW_FIXTURE_THRESHOLD'],
    causalClaim: false,
    profitabilityClaim: false,
    canonical: false,
    authorityClass: 'NO_AUTHORITY',
  });
}

export { FIXED_SCALE };

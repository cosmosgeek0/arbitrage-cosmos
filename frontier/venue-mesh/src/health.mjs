import { sha256 } from '../../dock/src/index.mjs';
import { arrayValue, asRecord, deepFreeze, enumValue, safeInteger, stableSort } from './guards.mjs';
import { decimalToMantissa, mantissaToDecimal, ratioToBpsMantissa } from './decimal.mjs';
import { validateMarketEvidenceEnvelope } from './evidence.mjs';
import { fail } from './errors.mjs';

function quote(envelope, field) {
  const value = envelope?.payload?.[field];
  if (value === null || value === undefined) return null;
  return decimalToMantissa(value, `evidence.payload.${field}`);
}

export function compareRestAndStream({ rest, stream, toleranceBps, asOfMs, maximumAgeMsByPath, maximumObservationSkewMs }) {
  validateMarketEvidenceEnvelope(rest);
  validateMarketEvidenceEnvelope(stream);
  safeInteger(asOfMs, 'disagreement.asOfMs', { minimum: 1_262_304_000_000, maximum: 4_102_444_800_000 });
  asRecord(maximumAgeMsByPath, 'disagreement.maximumAgeMsByPath');
  safeInteger(maximumAgeMsByPath.rest, 'disagreement.maximumAgeMsByPath.rest', { minimum: 1 });
  safeInteger(maximumAgeMsByPath.stream, 'disagreement.maximumAgeMsByPath.stream', { minimum: 1 });
  safeInteger(maximumObservationSkewMs, 'disagreement.maximumObservationSkewMs', { minimum: 0 });
  if (rest.payloadKind !== 'BOOK_TICKER' || stream.payloadKind !== 'BOOK_TICKER') fail('DISAGREEMENT_QUOTE_REQUIRED', 'REST/stream comparison requires book-ticker evidence');
  if (rest.source.streamClass !== 'REST_BOOK_TICKER_FIXTURE' || stream.source.streamClass !== 'STREAM_BOOK_TICKER_FIXTURE') {
    fail('DISAGREEMENT_PATH_CLASS_INVALID', 'REST/stream comparison requires explicit REST and STREAM fixture path classes');
  }
  if (rest.instrumentGraph.venue !== stream.instrumentGraph.venue
    || rest.instrumentGraph.symbol !== stream.instrumentGraph.symbol
    || rest.instrumentGraph.product !== stream.instrumentGraph.product
    || rest.instrumentGraph.canonicalAsset !== stream.instrumentGraph.canonicalAsset) {
    fail('DISAGREEMENT_IDENTITY_MISMATCH', 'REST and stream evidence must identify the same venue instrument');
  }
  const tolerance = decimalToMantissa(toleranceBps, 'toleranceBps');
  const observations = [
    { path: 'REST', evidenceId: rest.evidenceId, eventTimeMs: rest.exchangeEventTimeMs, receiveTimeMs: rest.localReceiveTimeMs, source: rest.source, quality: rest.quality, payload: rest.payload },
    { path: 'STREAM', evidenceId: stream.evidenceId, eventTimeMs: stream.exchangeEventTimeMs, receiveTimeMs: stream.localReceiveTimeMs, source: stream.source, quality: stream.quality, payload: stream.payload },
  ];
  const qualityReasons = [];
  for (const [path, evidence, maximumAgeMs] of [['REST', rest, maximumAgeMsByPath.rest], ['STREAM', stream, maximumAgeMsByPath.stream]]) {
    const basisMs = evidence.exchangeEventTimeMs ?? evidence.localReceiveTimeMs;
    if (basisMs > asOfMs) qualityReasons.push(`${path}_EVIDENCE_AFTER_AS_OF`);
    else if (evidence.quality.freshness !== 'FRESH' || asOfMs - basisMs > maximumAgeMs) qualityReasons.push(`${path}_SOURCE_AGE_EXCEEDED`);
    if (evidence.quality.gapCount > 0 || evidence.quality.duplicate) qualityReasons.push(`${path}_SEQUENCE_INCOHERENT`);
    if (!['COMPLETE', 'SAMPLED'].includes(evidence.quality.completeness)) qualityReasons.push(`${path}_COMPLETENESS_${evidence.quality.completeness}`);
  }
  const restBasisMs = rest.exchangeEventTimeMs ?? rest.localReceiveTimeMs;
  const streamBasisMs = stream.exchangeEventTimeMs ?? stream.localReceiveTimeMs;
  if (Math.abs(restBasisMs - streamBasisMs) > maximumObservationSkewMs) qualityReasons.push('OBSERVATION_TIME_SKEW_EXCEEDED');
  const precomparisonState = qualityReasons.some((reason) => reason.includes('AFTER_AS_OF') || reason.includes('SEQUENCE_INCOHERENT') || reason.includes('SKEW'))
    ? 'INCOHERENT'
    : qualityReasons.some((reason) => reason.includes('AGE_EXCEEDED')) ? 'STALE'
      : qualityReasons.length > 0 ? 'UNKNOWN' : null;
  const comparisonId = `vm.rs.${sha256({ rest: rest.evidenceId, stream: stream.evidenceId, toleranceBps, asOfMs, maximumAgeMsByPath, maximumObservationSkewMs }).slice(0, 28)}`;
  if (precomparisonState !== null) {
    return deepFreeze({
      schema: 'VenueRestStreamDisagreementV1',
      comparisonId,
      venue: rest.instrumentGraph.venue,
      symbol: rest.instrumentGraph.symbol,
      state: precomparisonState,
      reasonCodes: [...new Set(qualityReasons)].sort(),
      toleranceBps,
      asOfMs,
      observations,
      differences: [],
      winnerSelected: false,
      averageFabricated: false,
      canonicalStateWritten: false,
      authorityClass: 'NO_AUTHORITY',
    });
  }
  const fields = ['bidPrice', 'askPrice'];
  const differences = fields.map((field) => {
    const restValue = quote(rest, field);
    const streamValue = quote(stream, field);
    if (restValue === null || streamValue === null || restValue <= 0n || streamValue <= 0n) {
      return { field, state: 'UNKNOWN', differenceBps: null, reasonCodes: ['PRICE_MISSING_OR_INVALID'] };
    }
    const difference = restValue > streamValue ? restValue - streamValue : streamValue - restValue;
    const differenceBps = ratioToBpsMantissa(difference, restValue, `${field}.differenceBps`);
    return {
      field,
      state: differenceBps <= tolerance ? 'WITHIN_TOLERANCE' : 'DIVERGED',
      differenceBps: mantissaToDecimal(differenceBps),
      reasonCodes: differenceBps <= tolerance ? [] : ['REST_STREAM_PRICE_DIVERGENCE'],
    };
  });
  const state = differences.some((row) => row.state === 'UNKNOWN')
    ? 'UNKNOWN'
    : differences.some((row) => row.state === 'DIVERGED') ? 'DIVERGED' : 'EXACT_WITHIN_TOLERANCE';
  return deepFreeze({
    schema: 'VenueRestStreamDisagreementV1',
    comparisonId,
    venue: rest.instrumentGraph.venue,
    symbol: rest.instrumentGraph.symbol,
    state,
    reasonCodes: differences.flatMap((row) => row.reasonCodes).filter((value, index, rows) => rows.indexOf(value) === index).sort(),
    toleranceBps,
    asOfMs,
    observations,
    differences,
    winnerSelected: false,
    averageFabricated: false,
    canonicalStateWritten: false,
    authorityClass: 'NO_AUTHORITY',
  });
}

function observationHealth(row, evaluatedAtMs, maintenanceState, rateBudgetState, maximumAgeMs) {
  asRecord(row, 'normalization result');
  const reasons = [];
  const hardUnavailable = row.availability?.state !== 'AVAILABLE'
    || row.sequenceState?.coherent !== true
    || row.observation?.schema !== 'MarketEvidenceEnvelopeV1';
  if (row.availability?.state !== 'AVAILABLE') reasons.push(...(row.availability?.reasonCodes ?? ['VENUE_UNAVAILABLE']));
  if (row.sequenceState?.coherent !== true) reasons.push(...(row.sequenceState?.reasonCodes ?? ['SEQUENCE_INCOHERENT']));
  if (row.observation?.schema !== 'MarketEvidenceEnvelopeV1') reasons.push(...(row.observation?.reasonCodes ?? ['EVIDENCE_UNAVAILABLE']));
  if (row.observation?.schema === 'MarketEvidenceEnvelopeV1') {
    validateMarketEvidenceEnvelope(row.observation);
    if (row.observation.quality.freshness !== 'FRESH') reasons.push(`FRESHNESS_${row.observation.quality.freshness}`);
    if (!['COMPLETE', 'SAMPLED'].includes(row.observation.quality.completeness)) reasons.push(`COMPLETENESS_${row.observation.quality.completeness}`);
    if (row.observation.normalizationTimeMs > evaluatedAtMs) reasons.push('NORMALIZATION_AFTER_EVALUATION');
    if (!Number.isSafeInteger(maximumAgeMs) || maximumAgeMs <= 0) {
      reasons.push('FRESHNESS_BOUND_UNKNOWN');
    } else {
      const freshnessBasisMs = row.observation.exchangeEventTimeMs ?? row.observation.localReceiveTimeMs;
      if (freshnessBasisMs > evaluatedAtMs) reasons.push('EVIDENCE_AFTER_EVALUATION');
      else if (evaluatedAtMs - freshnessBasisMs > maximumAgeMs) reasons.push('SOURCE_AGE_EXCEEDED');
    }
  }
  if (maintenanceState === 'MAINTENANCE') reasons.push('MAINTENANCE_WINDOW');
  if (maintenanceState === 'UNKNOWN') reasons.push('MAINTENANCE_STATE_UNKNOWN');
  if (rateBudgetState === 'DEGRADED') reasons.push('RATE_BUDGET_DEGRADED');
  if (rateBudgetState === 'RATE_LIMITED') reasons.push('RATE_LIMITED');
  if (rateBudgetState === 'UNKNOWN') reasons.push('RATE_BUDGET_UNKNOWN');
  const state = hardUnavailable ? 'FIXTURE_UNAVAILABLE' : reasons.length > 0 ? 'FIXTURE_DEGRADED' : 'FIXTURE_COHERENT';
  return {
    venue: row.venue,
    identityId: row.identity.identityId,
    evidenceId: row.observation?.schema === 'MarketEvidenceEnvelopeV1' ? row.observation.evidenceId : null,
    state,
    reasonCodes: [...new Set(reasons)].sort(),
    availabilityState: row.availability?.state ?? 'UNAVAILABLE',
    sequenceState: row.sequenceState?.state ?? 'UNKNOWN',
    freshness: row.observation?.quality?.freshness ?? 'UNKNOWN',
    completeness: row.observation?.quality?.completeness ?? 'UNAVAILABLE',
    livenessInferred: false,
    productHealthClaimed: false,
  };
}

export function assessVenueMeshHealth({ results, evaluatedAtMs, maximumAgeMsByVenue = {}, maintenanceByVenue = {}, rateBudgetByVenue = {}, disagreements = [] }) {
  arrayValue(results, 'health.results', { minimum: 1, maximum: 1_000 });
  safeInteger(evaluatedAtMs, 'health.evaluatedAtMs', { minimum: 1_262_304_000_000, maximum: 4_102_444_800_000 });
  asRecord(maintenanceByVenue, 'health.maintenanceByVenue');
  asRecord(rateBudgetByVenue, 'health.rateBudgetByVenue');
  asRecord(maximumAgeMsByVenue, 'health.maximumAgeMsByVenue');
  arrayValue(disagreements, 'health.disagreements', { maximum: 1_000 });
  const rows = stableSort(results.map((row) => {
    const maintenanceState = maintenanceByVenue[row.venue] ?? 'UNKNOWN';
    const rateBudgetState = rateBudgetByVenue[row.venue] ?? 'UNKNOWN';
    validateMaintenanceState(maintenanceState);
    enumValue(rateBudgetState, ['WITHIN_BUDGET', 'DEGRADED', 'RATE_LIMITED', 'UNKNOWN'], `health.rateBudgetByVenue.${row.venue}`);
    return observationHealth(row, evaluatedAtMs, maintenanceState, rateBudgetState, maximumAgeMsByVenue[row.venue] ?? null);
  }), (row) => `${row.venue}:${row.identityId}`);
  const disagreementsByVenue = new Map();
  for (const disagreement of disagreements) {
    asRecord(disagreement, 'health.disagreement');
    enumValue(disagreement.state, ['EXACT_WITHIN_TOLERANCE', 'DIVERGED', 'UNKNOWN', 'STALE', 'INCOHERENT'], 'health.disagreement.state');
    const rowsForVenue = disagreementsByVenue.get(disagreement.venue) ?? [];
    rowsForVenue.push(disagreement.state);
    disagreementsByVenue.set(disagreement.venue, rowsForVenue);
  }
  for (const row of rows) {
    const states = disagreementsByVenue.get(row.venue) ?? [];
    const reasons = [];
    if (states.includes('DIVERGED')) reasons.push('REST_STREAM_DIVERGENCE');
    if (states.includes('UNKNOWN')) reasons.push('REST_STREAM_STATE_UNKNOWN');
    if (states.includes('STALE')) reasons.push('REST_STREAM_STALE');
    if (states.includes('INCOHERENT')) reasons.push('REST_STREAM_INCOHERENT');
    if (reasons.length > 0) {
      if (row.state === 'FIXTURE_COHERENT') row.state = 'FIXTURE_DEGRADED';
      row.reasonCodes = [...new Set([...row.reasonCodes, ...reasons])].sort();
    }
  }
  const coherentCount = rows.filter((row) => row.state === 'FIXTURE_COHERENT').length;
  const aggregateState = coherentCount === rows.length
    ? 'ALL_FIXTURES_COHERENT'
    : coherentCount === 0 ? 'ALL_FIXTURES_UNAVAILABLE_OR_DEGRADED' : 'PARTIAL_FIXTURE_COHERENCE';
  return deepFreeze({
    schema: 'VenueMeshSourceHealthV1',
    evaluatedAtMs,
    aggregateState,
    coherentCount,
    totalCount: rows.length,
    rows,
    perVenueFreshnessRequired: true,
    processLivenessUsed: false,
    canonicalProductHealthWritten: false,
    authorityClass: 'NO_AUTHORITY',
  });
}

export function validateMaintenanceState(value) {
  return enumValue(value, ['NORMAL', 'MAINTENANCE', 'UNKNOWN'], 'maintenance state');
}

export function projectSourceHealthCanonicalState(health) {
  asRecord(health, 'VenueMeshSourceHealthV1');
  if (health.schema !== 'VenueMeshSourceHealthV1' || !Array.isArray(health.rows)) fail('SOURCE_HEALTH_PROJECTION_INVALID', 'source health projection requires VenueMeshSourceHealthV1');
  return deepFreeze({
    schema: 'VenueMeshCanonicalSourceHealthAdapterFixtureV1',
    version: 1,
    canonicalContractRef: 'server/src/intelligenceRuntime/contracts/types.ts#RuntimeSourceSnapshot,RuntimeLifecycleState,RuntimeAuthority',
    rows: health.rows.map((row) => ({
      venue: row.venue,
      identityId: row.identityId,
      extensionFixtureState: row.state,
      reasonCodes: row.reasonCodes,
      extensionEvidenceId: row.evidenceId,
      extensionAvailabilityState: row.availabilityState,
      extensionSequenceState: row.sequenceState,
      extensionFreshness: row.freshness,
      extensionCompleteness: row.completeness,
      canonicalObservedState: 'STOPPED',
      canonicalAuthority: 'UNKNOWN',
      canonicalCompleteness: row.state === 'FIXTURE_COHERENT' ? 'COMPLETE' : row.state === 'FIXTURE_UNAVAILABLE' ? 'MISSING' : 'PARTIAL',
    })),
    mappingPosture: 'LOSSLESS_EXTENSION_STATE_PRESERVED;NO_LIVE_RUNTIME_INFERRED',
    canonicalStateWritten: false,
    authorityClass: 'NO_AUTHORITY',
    canonical: false,
    networkMode: 'FIXTURE_ONLY',
  });
}

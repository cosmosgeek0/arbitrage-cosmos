import {
  ASSURANCE_SEVERITIES,
  assertDigestOrNull,
  assertIdentifier,
  assertPositiveSafeInteger,
  assertSafeNonNegativeInteger,
  assertUtcMs,
  sortedUnique,
  type AssuranceSeverity,
  type AssuranceVerdict,
} from '../common.js';

export const COVERAGE_SUBJECT_KINDS = Object.freeze([
  'COMPONENT',
  'INVARIANT',
  'FAILURE_MODE',
  'OPERATION_POLICY',
  'OWNER_QUESTION',
] as const);
export type CoverageSubjectKind = (typeof COVERAGE_SUBJECT_KINDS)[number];

export const COVERAGE_CHANNELS = Object.freeze([
  'METRIC',
  'STRUCTURED_LOG',
  'MATERIAL_EVENT',
  'TRACE',
  'INCIDENT',
] as const);
export type CoverageChannel = (typeof COVERAGE_CHANNELS)[number];

export const COVERAGE_MISSING_DATA_LAWS = Object.freeze([
  'UNKNOWN_BLOCKS_READINESS',
  'FAILS_READINESS',
  'VISIBLE_NOT_APPLICABLE',
] as const);
export type CoverageMissingDataLaw = (typeof COVERAGE_MISSING_DATA_LAWS)[number];

export interface CoverageObligation {
  readonly schema: 'PRODUCT_ASSURANCE_COVERAGE_OBLIGATION_V1';
  readonly subjectKind: CoverageSubjectKind;
  readonly subjectId: string;
  readonly metricId: string;
  readonly structuredLogId: string;
  readonly materialEventId: string;
  readonly traceId: string;
  readonly incidentId: string;
  readonly freshnessMs: number;
  readonly hysteresisMs: number;
  readonly missingDataLaw: CoverageMissingDataLaw;
  readonly severity: AssuranceSeverity;
  readonly cockpitSurface: string;
  readonly repairControlId: string;
  readonly fixtureId: string;
  readonly proofId: string;
  readonly capitalCritical: boolean;
}

export interface ExpectedCoverageManifest {
  readonly schema: 'PRODUCT_ASSURANCE_EXPECTED_COVERAGE_V1';
  readonly revision: number;
  readonly releaseId: string;
  readonly testedCommit: string;
  readonly expectedSubjectIds: Readonly<Record<CoverageSubjectKind, readonly string[]>>;
  readonly minimumCoveragePercentage: number;
}

export interface CoverageMatrixProjection {
  readonly verdict: AssuranceVerdict;
  readonly expectedCount: number;
  readonly coveredCount: number;
  readonly coveragePercentage: number;
  readonly missingSubjectKeys: readonly string[];
  readonly duplicateSubjectKeys: readonly string[];
  readonly unexpectedSubjectKeys: readonly string[];
  readonly invalidSubjectKeys: readonly string[];
  readonly reasonCodes: readonly string[];
}

function subjectKey(kind: CoverageSubjectKind, id: string): string {
  return `${kind}:${id}`;
}

function channelId(obligation: Readonly<CoverageObligation>, channel: CoverageChannel): string {
  if (channel === 'METRIC') return obligation.metricId;
  if (channel === 'STRUCTURED_LOG') return obligation.structuredLogId;
  if (channel === 'MATERIAL_EVENT') return obligation.materialEventId;
  if (channel === 'TRACE') return obligation.traceId;
  return obligation.incidentId;
}

function requiredChannels(obligation: Readonly<CoverageObligation>): readonly CoverageChannel[] {
  return COVERAGE_CHANNELS.filter((channel) => channelId(obligation, channel) !== 'NOT_APPLICABLE');
}

function validateObligation(obligation: Readonly<CoverageObligation>): readonly string[] {
  const issues: string[] = [];
  if (obligation.schema !== 'PRODUCT_ASSURANCE_COVERAGE_OBLIGATION_V1') issues.push('SCHEMA_UNSUPPORTED');
  if (!(COVERAGE_SUBJECT_KINDS as readonly string[]).includes(obligation.subjectKind)) issues.push('SUBJECT_KIND_UNSUPPORTED');
  if (!(COVERAGE_MISSING_DATA_LAWS as readonly string[]).includes(obligation.missingDataLaw)) issues.push('MISSING_DATA_LAW_UNSUPPORTED');
  if (!(ASSURANCE_SEVERITIES as readonly string[]).includes(obligation.severity)) issues.push('SEVERITY_UNSUPPORTED');
  if (typeof obligation.capitalCritical !== 'boolean') issues.push('CAPITAL_CRITICAL_INVALID');
  try {
    assertIdentifier(obligation.subjectId, 'obligation.subjectId');
    assertIdentifier(obligation.metricId, 'obligation.metricId');
    assertIdentifier(obligation.structuredLogId, 'obligation.structuredLogId');
    assertIdentifier(obligation.materialEventId, 'obligation.materialEventId');
    assertIdentifier(obligation.traceId, 'obligation.traceId');
    assertIdentifier(obligation.incidentId, 'obligation.incidentId');
    assertPositiveSafeInteger(obligation.freshnessMs, 'obligation.freshnessMs');
    assertSafeNonNegativeInteger(obligation.hysteresisMs, 'obligation.hysteresisMs');
    assertIdentifier(obligation.cockpitSurface, 'obligation.cockpitSurface');
    assertIdentifier(obligation.repairControlId, 'obligation.repairControlId');
    assertIdentifier(obligation.fixtureId, 'obligation.fixtureId');
    assertIdentifier(obligation.proofId, 'obligation.proofId');
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'OBLIGATION_VALIDATION_FAILED');
  }
  if (requiredChannels(obligation).length === 0 && obligation.missingDataLaw !== 'VISIBLE_NOT_APPLICABLE') {
    issues.push('ALL_CHANNELS_NOT_APPLICABLE_WITHOUT_VISIBLE_LAW');
  }
  return sortedUnique(issues);
}

export function evaluateCoverageMatrix(
  manifest: Readonly<ExpectedCoverageManifest>,
  obligations: readonly Readonly<CoverageObligation>[],
): Readonly<CoverageMatrixProjection> {
  if (manifest.schema !== 'PRODUCT_ASSURANCE_EXPECTED_COVERAGE_V1') throw new TypeError('coverage manifest schema unsupported');
  assertSafeNonNegativeInteger(manifest.revision, 'manifest.revision');
  assertIdentifier(manifest.releaseId, 'manifest.releaseId');
  if (!/^[a-f0-9]{40}$/u.test(manifest.testedCommit)) throw new TypeError('manifest.testedCommit must be a bound full lowercase Git SHA-1');
  if (manifest.minimumCoveragePercentage !== 100) {
    throw new TypeError('manifest.minimumCoveragePercentage must be 100 for assurance acceptance');
  }
  const expectedKeys: string[] = [];
  for (const kind of COVERAGE_SUBJECT_KINDS) {
    if (!Array.isArray(manifest.expectedSubjectIds[kind]) || manifest.expectedSubjectIds[kind].length === 0) {
      throw new TypeError(`manifest expected denominator ${kind} must be nonempty`);
    }
    for (const id of manifest.expectedSubjectIds[kind]) {
      assertIdentifier(id, `manifest.expectedSubjectIds.${kind}`);
      expectedKeys.push(subjectKey(kind, id));
    }
  }
  if (new Set(expectedKeys).size !== expectedKeys.length) throw new TypeError('coverage manifest contains duplicate subject IDs');
  const expectedSet = new Set(expectedKeys);
  const actualKeys = obligations.map((obligation) => subjectKey(obligation.subjectKind, obligation.subjectId));
  const actualSet = new Set(actualKeys);
  const duplicates = sortedUnique(actualKeys.filter((key, index) => actualKeys.indexOf(key) !== index));
  const missing = expectedKeys.filter((key) => !actualSet.has(key)).sort();
  const unexpected = sortedUnique(actualKeys.filter((key) => !expectedSet.has(key)));
  const invalid = sortedUnique(obligations.filter((obligation) => validateObligation(obligation).length > 0).map((obligation) => subjectKey(obligation.subjectKind, obligation.subjectId)));
  const covered = expectedKeys.filter((key) => actualSet.has(key) && !invalid.includes(key)).length;
  const percentage = expectedKeys.length === 0 ? 0 : Number(((covered / expectedKeys.length) * 100).toFixed(2));
  const reasons: string[] = [];
  if (expectedKeys.length === 0) reasons.push('EXPECTED_COVERAGE_EMPTY');
  if (missing.length > 0) reasons.push('EXPECTED_COVERAGE_MISSING');
  if (duplicates.length > 0) reasons.push('DUPLICATE_COVERAGE_OBLIGATION');
  if (unexpected.length > 0) reasons.push('UNEXPECTED_COVERAGE_OBLIGATION');
  if (invalid.length > 0) reasons.push('INVALID_COVERAGE_OBLIGATION');
  if (percentage < manifest.minimumCoveragePercentage) reasons.push('COVERAGE_SLO_MISSED');
  return Object.freeze({
    verdict: reasons.length > 0 ? 'FAIL' : 'PASS',
    expectedCount: expectedKeys.length,
    coveredCount: covered,
    coveragePercentage: percentage,
    missingSubjectKeys: Object.freeze(missing),
    duplicateSubjectKeys: duplicates,
    unexpectedSubjectKeys: unexpected,
    invalidSubjectKeys: invalid,
    reasonCodes: sortedUnique(reasons),
  });
}

export interface CoverageChannelObservation {
  readonly releaseId: string;
  readonly testedCommit: string;
  readonly subjectKind: CoverageSubjectKind;
  readonly subjectId: string;
  readonly channel: CoverageChannel;
  readonly channelId: string;
  readonly evidenceId: string;
  readonly evidenceOwnerId: string;
  readonly evidenceDigest: string;
  readonly truthLabel: 'LIVE_PUBLIC' | 'SYNTHETIC_ONLY' | 'UNKNOWN' | 'UNAVAILABLE';
  readonly lastObservedAtMs: number | null;
  readonly explicitlyUnavailable: boolean;
}

export interface CoverageFreshnessProjection {
  readonly verdict: AssuranceVerdict;
  readonly currentSubjectKeys: readonly string[];
  readonly staleSubjectKeys: readonly string[];
  readonly silentSubjectKeys: readonly string[];
  readonly unavailableSubjectKeys: readonly string[];
  readonly reasonCodes: readonly string[];
}

export function projectCoverageFreshness(
  manifest: Readonly<ExpectedCoverageManifest>,
  obligations: readonly Readonly<CoverageObligation>[],
  observations: readonly Readonly<CoverageChannelObservation>[],
  nowMs: number,
): Readonly<CoverageFreshnessProjection> {
  assertUtcMs(nowMs, 'nowMs');
  const structuralCoverage = evaluateCoverageMatrix(manifest, obligations);
  if (structuralCoverage.verdict !== 'PASS') {
    return Object.freeze({
      verdict: 'FAIL',
      currentSubjectKeys: Object.freeze([]),
      staleSubjectKeys: Object.freeze([]),
      silentSubjectKeys: Object.freeze([]),
      unavailableSubjectKeys: Object.freeze([]),
      reasonCodes: sortedUnique(['RELEASE_COVERAGE_DENOMINATOR_INVALID', ...structuralCoverage.reasonCodes]),
    });
  }
  const obligationKeys = obligations.map((obligation) => subjectKey(obligation.subjectKind, obligation.subjectId));
  if (new Set(obligationKeys).size !== obligationKeys.length) {
    throw new TypeError('coverage freshness obligations contain duplicate subject keys');
  }
  for (const obligation of obligations) {
    const issues = validateObligation(obligation);
    if (issues.length > 0) {
      throw new TypeError(`invalid coverage obligation ${subjectKey(obligation.subjectKind, obligation.subjectId)}: ${issues.join(',')}`);
    }
  }

  const obligationByKey = new Map(obligations.map((obligation) => [subjectKey(obligation.subjectKind, obligation.subjectId), obligation]));
  const observationKeys: string[] = [];
  const evidenceIds: string[] = [];
  const evidenceDigests: string[] = [];
  for (const observation of observations) {
    assertIdentifier(observation.releaseId, 'observation.releaseId');
    if (!/^[a-f0-9]{40}$/u.test(observation.testedCommit)) {
      throw new TypeError('coverage observation testedCommit must be a full lowercase Git SHA-1');
    }
    if (observation.releaseId !== manifest.releaseId || observation.testedCommit !== manifest.testedCommit) {
      throw new TypeError('coverage observation release binding mismatch');
    }
    if (!(COVERAGE_SUBJECT_KINDS as readonly string[]).includes(observation.subjectKind)) {
      throw new TypeError('coverage observation subjectKind unsupported');
    }
    if (!(COVERAGE_CHANNELS as readonly string[]).includes(observation.channel)) {
      throw new TypeError('coverage observation channel unsupported');
    }
    assertIdentifier(observation.subjectId, 'observation.subjectId');
    assertIdentifier(observation.channelId, 'observation.channelId');
    assertIdentifier(observation.evidenceId, 'observation.evidenceId');
    assertIdentifier(observation.evidenceOwnerId, 'observation.evidenceOwnerId');
    assertDigestOrNull(observation.evidenceDigest, 'observation.evidenceDigest');
    if (observation.evidenceDigest === null) throw new TypeError('coverage observation evidenceDigest is required');
    if (!(['LIVE_PUBLIC', 'SYNTHETIC_ONLY', 'UNKNOWN', 'UNAVAILABLE'] as const).includes(observation.truthLabel)) {
      throw new TypeError('coverage observation truthLabel unsupported');
    }
    if (typeof observation.explicitlyUnavailable !== 'boolean') {
      throw new TypeError('observation.explicitlyUnavailable must be boolean');
    }
    if (observation.lastObservedAtMs !== null) {
      assertUtcMs(observation.lastObservedAtMs, 'observation.lastObservedAtMs');
      if (observation.lastObservedAtMs > nowMs) {
        throw new TypeError('coverage observation time cannot be in the future');
      }
    }
    const key = subjectKey(observation.subjectKind, observation.subjectId);
    const obligation = obligationByKey.get(key);
    if (obligation === undefined) throw new TypeError(`coverage observation references unknown subject ${key}`);
    if (!requiredChannels(obligation).includes(observation.channel)) {
      throw new TypeError(`coverage observation references not-applicable channel ${key}:${observation.channel}`);
    }
    if (observation.channelId !== channelId(obligation, observation.channel)) {
      throw new TypeError(`coverage observation channel ID mismatch ${key}:${observation.channel}`);
    }
    observationKeys.push(`${key}:${observation.channel}`);
    evidenceIds.push(observation.evidenceId);
    evidenceDigests.push(observation.evidenceDigest);
  }
  if (new Set(observationKeys).size !== observationKeys.length) {
    throw new TypeError('coverage observations contain duplicate subject channels');
  }
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new TypeError('coverage observations contain duplicate evidence IDs');
  }
  if (new Set(evidenceDigests).size !== evidenceDigests.length) {
    throw new TypeError('coverage observations contain duplicate evidence digests');
  }

  const current: string[] = [];
  const stale: string[] = [];
  const silent: string[] = [];
  const unavailable: string[] = [];
  for (const obligation of obligations) {
    const key = subjectKey(obligation.subjectKind, obligation.subjectId);
    const channels = observations.filter((observation) => observation.subjectKind === obligation.subjectKind && observation.subjectId === obligation.subjectId);
    const required = requiredChannels(obligation);
    if (required.length === 0) {
      // Validation above proves this is an explicitly visible not-applicable obligation.
      current.push(key);
      continue;
    }
    const expected = required.map((channel) => channels.find((observation) => observation.channel === channel));
    if (expected.some((observation) => observation?.explicitlyUnavailable || observation?.truthLabel !== 'LIVE_PUBLIC')) unavailable.push(key);
    else if (expected.some((observation) => observation === undefined || observation.lastObservedAtMs === null)) silent.push(key);
    else {
      const isStale = expected.some((observation) => {
        const observedAtMs = observation?.lastObservedAtMs;
        if (observedAtMs === null || observedAtMs === undefined) return false;
        assertUtcMs(observedAtMs, 'observation.lastObservedAtMs');
        return nowMs - observedAtMs >= obligation.freshnessMs + obligation.hysteresisMs;
      });
      if (isStale) stale.push(key);
      else current.push(key);
    }
  }
  const nonCurrentKeys = new Set([...stale, ...silent, ...unavailable]);
  const failed = obligations.some((obligation) => {
    const key = subjectKey(obligation.subjectKind, obligation.subjectId);
    if (!nonCurrentKeys.has(key)) return false;
    if (obligation.missingDataLaw === 'FAILS_READINESS') return true;
    return obligation.capitalCritical && unavailable.includes(key);
  });
  const unknown = nonCurrentKeys.size > 0 && !failed;
  const reasons: string[] = [];
  if (obligations.length === 0) reasons.push('COVERAGE_OBLIGATION_SET_EMPTY');
  if (unavailable.length > 0) reasons.push('COVERAGE_CHANNEL_UNAVAILABLE');
  if (silent.length > 0) reasons.push('COVERAGE_CHANNEL_SILENT');
  if (stale.length > 0) reasons.push('COVERAGE_CHANNEL_STALE');
  return Object.freeze({
    verdict: failed ? 'FAIL' : unknown || obligations.length === 0 ? 'UNKNOWN' : 'PASS',
    currentSubjectKeys: sortedUnique(current),
    staleSubjectKeys: sortedUnique(stale),
    silentSubjectKeys: sortedUnique(silent),
    unavailableSubjectKeys: sortedUnique(unavailable),
    reasonCodes: sortedUnique(reasons),
  });
}

export interface ObservabilityConservationInput {
  readonly signalId: string;
  readonly generatedCount: number | null;
  readonly exportedCount: number | null;
  readonly bufferedCount: number | null;
  readonly droppedCount: number | null;
  readonly duplicateCount: number | null;
}

export function evaluateObservabilityConservation(
  input: Readonly<ObservabilityConservationInput>,
): Readonly<{ verdict: AssuranceVerdict; conserved: boolean | null; reasonCodes: readonly string[] }> {
  assertIdentifier(input.signalId, 'input.signalId');
  const values = [input.generatedCount, input.exportedCount, input.bufferedCount, input.droppedCount, input.duplicateCount];
  if (values.some((value) => value === null)) {
    return Object.freeze({ verdict: 'UNKNOWN', conserved: null, reasonCodes: Object.freeze(['OBSERVABILITY_ACCOUNTING_UNKNOWN']) });
  }
  for (const [index, value] of values.entries()) assertSafeNonNegativeInteger(value, `input.count[${index}]`);
  const generated = input.generatedCount as number;
  const exported = input.exportedCount as number;
  const buffered = input.bufferedCount as number;
  const dropped = input.droppedCount as number;
  const duplicates = input.duplicateCount as number;
  const conserved = generated + duplicates === exported + buffered + dropped;
  const reasons: string[] = [];
  if (!conserved) reasons.push('OBSERVABILITY_CONSERVATION_BROKEN');
  if (dropped > 0) reasons.push('OBSERVABILITY_RECORDS_DROPPED');
  if (duplicates > 0) reasons.push('OBSERVABILITY_DUPLICATES_VISIBLE');
  return Object.freeze({ verdict: !conserved || dropped > 0 || duplicates > 0 ? 'FAIL' : 'PASS', conserved, reasonCodes: sortedUnique(reasons) });
}

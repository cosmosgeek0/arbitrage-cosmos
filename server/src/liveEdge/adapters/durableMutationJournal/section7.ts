import { createHash } from 'node:crypto';

import { canonicalJson } from '../../../foundation/contracts/index.js';
import {
  deepFreezePrivate,
  privateArray,
  privateBoolean,
  privateIdentifier,
  privateInteger,
  privateRecord,
  snapshotPrivateData,
} from '../binancePrivateTruth/bounds.js';
import { validatePersistedMutationJournal } from './journal.js';
import type { CanonicalRecordingHealthSnapshot } from '../../integration/assessmentBridge.js';
import type {
  HttpObservedPayload,
  MutationJournalEntry,
  PersistedMutationJournal,
} from './types.js';

const MAX_UTC_MS = 4_102_444_800_000;
const REVISION = /^[A-Za-z][A-Za-z0-9._:-]{7,127}$/;

export const CAPITAL_EVIDENCE_POLICY_SCHEMA = 'LIVE_EDGE_CAPITAL_EVIDENCE_LADDER_V1' as const;
export const LATENCY_EVIDENCE_SCHEMA = 'LIVE_EDGE_FULL_CHAIN_LATENCY_EVIDENCE_V1' as const;

export const CAPITAL_EVIDENCE_DIMENSIONS = Object.freeze([
  'OPERATIONAL_CORRECTNESS',
  'EXECUTION_CALIBRATION',
  'EFFECTIVE_SAMPLE_SIZE',
  'CLUSTERED_UNCERTAINTY',
  'LIVE_SHADOW_DIVERGENCE',
  'DRAWDOWN_TAIL_RECOVERY',
  'MODEL_CALIBRATION_ABSTENTION',
  'STRATEGY_CAPACITY_LIQUIDITY',
] as const);
export type CapitalEvidenceDimension = (typeof CAPITAL_EVIDENCE_DIMENSIONS)[number];

export interface CapitalEvidenceDimensionInput {
  readonly dimension: CapitalEvidenceDimension;
  readonly state: 'PROVEN' | 'UNPROVEN' | 'UNKNOWN';
  readonly evidenceRevision: string | null;
}

export interface CapitalEvidenceCandidate {
  readonly schema: typeof CAPITAL_EVIDENCE_POLICY_SCHEMA;
  readonly version: 1;
  readonly policyRevision: string;
  readonly mutationId: string;
  readonly journalOutcomeRevision: string;
  readonly currentCanaryMaximumNotional: '10';
  readonly recommendedMaximumNotional: '10';
  readonly notionalUnit: 'USDT';
  readonly boundPreflightResultNotional: string;
  readonly dimensions: readonly Readonly<CapitalEvidenceDimensionInput>[];
  readonly state: 'BLOCKED' | 'OWNER_REVIEW_REQUIRED';
  readonly reasonCodes: readonly string[];
  readonly explicitOwnerAuthorizationPresent: false;
  readonly rollbackDemotionPolicyRevision: null;
  readonly automaticPromotion: false;
  readonly injectedEvidenceOnly: true;
  readonly regimePosture: Readonly<RegimePostureReference>;
  readonly capitalAuthority: 'NONE';
  readonly riskAuthority: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface FullChainLatencyInput {
  readonly exchangeEventAtMs: number | null;
  readonly localReceiveAtMs: number | null;
  readonly featuresReadyAtMs: number | null;
  readonly decisionAtMs: number | null;
  readonly approvalAtMs: number | null;
  readonly durableIntentAtMs: number | null;
  readonly syntheticSubmissionAtMs: number | null;
  readonly acknowledgementAtMs: number | null;
  readonly privateConfirmationAtMs: number | null;
  readonly exchangeClockCalibration: 'UNAVAILABLE' | 'UTC_CALIBRATED';
  readonly exchangeClockCalibrationRevision: string | null;
  readonly recording: Readonly<CanonicalRecordingHealthSnapshot>;
  readonly observedAtMs: number;
}

export interface RegimePostureReference {
  readonly state: 'UNKNOWN' | 'CURRENT_ADVISORY' | 'STALE' | 'UNSUPPORTED' | 'DISAGREEING';
  readonly advisoryRevision: string | null;
  readonly ownerRouting: 'EXISTING_STRATEGY_CAPITAL_RISK';
  readonly advisoryOnly: true;
  readonly regimeAuthority: 'NONE';
  readonly capitalAuthority: 'NONE';
  readonly riskAuthority: 'NONE';
  readonly orderAuthorization: false;
}

export interface FullChainLatencyEvidence {
  readonly schema: typeof LATENCY_EVIDENCE_SCHEMA;
  readonly version: 1;
  readonly mutationId: string;
  readonly journalOutcomeRevision: string;
  readonly evidenceRevision: string;
  readonly milestones: Readonly<FullChainLatencyInput>;
  readonly segmentsMs: Readonly<{
    exchangeEventToLocalReceive: number | null;
    localReceiveToFeatures: number | null;
    featuresToDecision: number | null;
    approvalToDurableIntent: number | null;
    durableIntentToSyntheticSubmission: number | null;
    syntheticSubmissionToAcknowledgement: number | null;
    acknowledgementToPrivateConfirmation: number | null;
  }>;
  readonly completeness: 'COMPLETE_INJECTED' | 'PARTIAL_INJECTED';
  readonly researchTruthState: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
  readonly researchRecordingReady: boolean;
  readonly canonicalRecordingOwner: 'INTELLIGENCE_RUNTIME';
  readonly regimePosture: Readonly<RegimePostureReference>;
  readonly empiricalRegionBenchmark: 'NOT_PERFORMED';
  readonly moneyCriticalRecoveryBlockedByRecording: false;
  readonly syntheticOnly: true;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

function digest(prefix: string, value: unknown): string {
  return `${prefix}${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function compareCodeUnits(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validNullableTime(value: unknown, label: string): number | null {
  if (value === null) return null;
  return privateInteger(value, label, 0, MAX_UTC_MS);
}

function delta(start: number | null, end: number | null): number | null {
  if (start === null || end === null) return null;
  if (end < start) throw new TypeError('latency milestones regress within one clock domain');
  return end - start;
}

function signedDelta(start: number | null, end: number | null): number | null {
  if (start === null || end === null) return null;
  return end - start;
}

function regimePostureFor(persisted: Readonly<PersistedMutationJournal>): Readonly<RegimePostureReference> {
  return deepFreezePrivate({
    state: persisted.snapshot.bindings.regimePostureState,
    advisoryRevision: persisted.snapshot.bindings.regimeAdvisoryRevision,
    ownerRouting: 'EXISTING_STRATEGY_CAPITAL_RISK' as const,
    advisoryOnly: true as const,
    regimeAuthority: 'NONE' as const,
    capitalAuthority: 'NONE' as const,
    riskAuthority: 'NONE' as const,
    orderAuthorization: false as const,
  });
}

function canonicalRecordingSnapshot(value: unknown): Readonly<CanonicalRecordingHealthSnapshot> {
  const record = privateRecord(snapshotPrivateData(value), [
    'state', 'observedAtMs', 'gapCount', 'quotaState', 'storagePressure',
  ], 'canonical recording health snapshot');
  if (record.state !== 'RUNNING' && record.state !== 'DEGRADED' && record.state !== 'STALE'
    && record.state !== 'FAILED' && record.state !== 'UNKNOWN') {
    throw new TypeError('canonical recording health state is invalid');
  }
  if (record.quotaState !== 'OK' && record.quotaState !== 'PRESSURED'
    && record.quotaState !== 'EXHAUSTED' && record.quotaState !== 'UNKNOWN') {
    throw new TypeError('canonical recording quota state is invalid');
  }
  if (record.storagePressure !== 'OK' && record.storagePressure !== 'PRESSURED'
    && record.storagePressure !== 'FULL' && record.storagePressure !== 'UNKNOWN') {
    throw new TypeError('canonical recording storage pressure is invalid');
  }
  return deepFreezePrivate({
    state: record.state,
    observedAtMs: record.observedAtMs === null
      ? null
      : privateInteger(record.observedAtMs, 'canonical recording observation time', 0, MAX_UTC_MS),
    gapCount: record.gapCount === null
      ? null
      : privateInteger(record.gapCount, 'canonical recording gap count', 0, Number.MAX_SAFE_INTEGER),
    quotaState: record.quotaState,
    storagePressure: record.storagePressure,
  }) as Readonly<CanonicalRecordingHealthSnapshot>;
}

function firstCanonicalEntry(
  entries: readonly Readonly<MutationJournalEntry>[],
  predicate: (entry: Readonly<MutationJournalEntry>) => boolean,
): Readonly<MutationJournalEntry> | null {
  return [...entries].filter(predicate).sort((left, right) => (
    left.receivedAtMs - right.receivedAtMs
      || left.occurredAtMs - right.occurredAtMs
      || compareCodeUnits(left.contentRevision, right.contentRevision)
  ))[0] ?? null;
}

function requireJournalMilestone(actual: number | null, expected: number | null, label: string): void {
  if (actual !== expected) {
    throw new TypeError(`${label} must exactly match available journal evidence and remain null otherwise`);
  }
}

export function buildCapitalEvidenceCandidate(
  persistedValue: unknown,
  dimensionsValue: unknown,
): Readonly<CapitalEvidenceCandidate> {
  const persisted = validatePersistedMutationJournal(persistedValue);
  const values = privateArray(snapshotPrivateData(dimensionsValue), 'capital evidence dimensions', CAPITAL_EVIDENCE_DIMENSIONS.length);
  if (values.length !== CAPITAL_EVIDENCE_DIMENSIONS.length) {
    throw new TypeError('capital evidence requires every closed ladder dimension');
  }
  const seen = new Set<string>();
  const dimensions = values.map((value) => {
    const record = privateRecord(value, ['dimension', 'state', 'evidenceRevision'], 'capital evidence dimension');
    if (!(CAPITAL_EVIDENCE_DIMENSIONS as readonly unknown[]).includes(record.dimension)
      || (record.state !== 'PROVEN' && record.state !== 'UNPROVEN' && record.state !== 'UNKNOWN')
      || seen.has(record.dimension as string)) {
      throw new TypeError('capital evidence dimension is invalid or duplicated');
    }
    seen.add(record.dimension as string);
    const evidenceRevision = record.evidenceRevision === null
      ? null
      : privateIdentifier(record.evidenceRevision, 'capital evidence revision');
    if (evidenceRevision !== null && !REVISION.test(evidenceRevision)) {
      throw new TypeError('capital evidence revision namespace is invalid');
    }
    if ((record.state === 'PROVEN') !== (evidenceRevision !== null)) {
      throw new TypeError('only proven capital evidence may carry an evidence revision');
    }
    return deepFreezePrivate({
      dimension: record.dimension as CapitalEvidenceDimension,
      state: record.state as 'PROVEN' | 'UNPROVEN' | 'UNKNOWN',
      evidenceRevision,
    });
  }).sort((left, right) => compareCodeUnits(left.dimension, right.dimension));
  const missing = dimensions.filter((item) => item.state !== 'PROVEN');
  const reasons = [
    ...missing.map((item) => `${item.dimension}_${item.state}`),
    'OWNER_AUTHORIZATION_REQUIRED',
    'ROLLBACK_DEMOTION_REQUIRED',
  ];
  const policyRevision = digest('l06capital_', {
    mutationId: persisted.snapshot.mutationId,
    journalOutcomeRevision: persisted.snapshot.outcomeRevision,
    currentCanaryMaximumNotional: '10',
    dimensions,
  });
  return deepFreezePrivate({
    schema: CAPITAL_EVIDENCE_POLICY_SCHEMA,
    version: 1 as const,
    policyRevision,
    mutationId: persisted.snapshot.mutationId,
    journalOutcomeRevision: persisted.snapshot.outcomeRevision,
    currentCanaryMaximumNotional: '10' as const,
    recommendedMaximumNotional: '10' as const,
    notionalUnit: 'USDT' as const,
    boundPreflightResultNotional: persisted.snapshot.bindings.preflightResultNotional,
    dimensions: Object.freeze(dimensions),
    state: missing.length === 0 ? 'OWNER_REVIEW_REQUIRED' as const : 'BLOCKED' as const,
    reasonCodes: Object.freeze(reasons.sort()),
    explicitOwnerAuthorizationPresent: false as const,
    rollbackDemotionPolicyRevision: null,
    automaticPromotion: false as const,
    injectedEvidenceOnly: true as const,
    regimePosture: regimePostureFor(persisted),
    capitalAuthority: 'NONE' as const,
    riskAuthority: 'NONE' as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  });
}

export function buildFullChainLatencyEvidence(
  persistedValue: unknown,
  inputValue: unknown,
): Readonly<FullChainLatencyEvidence> {
  const persisted = validatePersistedMutationJournal(persistedValue);
  const record = privateRecord(snapshotPrivateData(inputValue), [
    'exchangeEventAtMs', 'localReceiveAtMs', 'featuresReadyAtMs', 'decisionAtMs',
    'approvalAtMs', 'durableIntentAtMs', 'syntheticSubmissionAtMs',
    'acknowledgementAtMs', 'privateConfirmationAtMs', 'exchangeClockCalibration',
    'exchangeClockCalibrationRevision', 'recording', 'observedAtMs',
  ], 'latency evidence input');
  if (record.exchangeClockCalibration !== 'UNAVAILABLE' && record.exchangeClockCalibration !== 'UTC_CALIBRATED') {
    throw new TypeError('exchange clock calibration state is invalid');
  }
  const exchangeClockCalibrationRevision = record.exchangeClockCalibrationRevision === null
    ? null
    : privateIdentifier(record.exchangeClockCalibrationRevision, 'exchange clock calibration revision');
  if ((record.exchangeClockCalibration === 'UTC_CALIBRATED') !== (exchangeClockCalibrationRevision !== null)
    || (exchangeClockCalibrationRevision !== null && !REVISION.test(exchangeClockCalibrationRevision))) {
    throw new TypeError('exchange clock calibration must bind an exact injected revision');
  }
  const recording = canonicalRecordingSnapshot(record.recording);
  const milestones: FullChainLatencyInput = deepFreezePrivate({
    exchangeEventAtMs: validNullableTime(record.exchangeEventAtMs, 'exchange event time'),
    localReceiveAtMs: validNullableTime(record.localReceiveAtMs, 'local receive time'),
    featuresReadyAtMs: validNullableTime(record.featuresReadyAtMs, 'features-ready time'),
    decisionAtMs: validNullableTime(record.decisionAtMs, 'decision time'),
    approvalAtMs: validNullableTime(record.approvalAtMs, 'approval time'),
    durableIntentAtMs: validNullableTime(record.durableIntentAtMs, 'durable-intent time'),
    syntheticSubmissionAtMs: validNullableTime(record.syntheticSubmissionAtMs, 'synthetic-submission time'),
    acknowledgementAtMs: validNullableTime(record.acknowledgementAtMs, 'acknowledgement time'),
    privateConfirmationAtMs: validNullableTime(record.privateConfirmationAtMs, 'private-confirmation time'),
    exchangeClockCalibration: record.exchangeClockCalibration,
    exchangeClockCalibrationRevision,
    recording,
    observedAtMs: privateInteger(record.observedAtMs, 'latency evidence observation time', 0, MAX_UTC_MS),
  });
  const journalEntries = persisted.snapshot.entries;
  const intentTail = journalEntries.at(-1)?.kind === 'SUBMISSION_INTENT'
    ? journalEntries.at(-1)!
    : null;
  const submission = firstCanonicalEntry(journalEntries, (entry) => entry.kind === 'SUBMISSION_OBSERVED');
  const acknowledgement = firstCanonicalEntry(journalEntries, (entry) => (
    entry.kind === 'HTTP_OBSERVED'
      && (entry.payload as Readonly<HttpObservedPayload>).classification === 'ACKNOWLEDGED'
  ));
  const privateConfirmation = firstCanonicalEntry(journalEntries, (entry) => (
    entry.kind === 'PRIVATE_ORDER_OBSERVED' || entry.kind === 'PRIVATE_FILL_OBSERVED'
  ));
  requireJournalMilestone(
    milestones.exchangeEventAtMs,
    persisted.snapshot.bindings.sourceExchangeEventAtMs,
    'source exchange-event time',
  );
  requireJournalMilestone(
    milestones.localReceiveAtMs,
    persisted.snapshot.bindings.sourceLocalReceiveAtMs,
    'source local-receive time',
  );
  requireJournalMilestone(
    milestones.featuresReadyAtMs,
    persisted.snapshot.bindings.featuresReadyAtMs,
    'features-ready time',
  );
  requireJournalMilestone(
    milestones.decisionAtMs,
    persisted.snapshot.bindings.decisionAtMs,
    'decision time',
  );
  requireJournalMilestone(
    milestones.approvalAtMs,
    persisted.snapshot.bindings.approvalAtMs,
    'approval time',
  );
  const expectedCalibrationRevision = persisted.snapshot.bindings.exchangeClockCalibrationRevision;
  const expectedCalibrationState = expectedCalibrationRevision === null
    ? 'UNAVAILABLE'
    : 'UTC_CALIBRATED';
  if (milestones.exchangeClockCalibration !== expectedCalibrationState
    || milestones.exchangeClockCalibrationRevision !== expectedCalibrationRevision) {
    throw new TypeError('exchange clock calibration does not bind the accepted L03 timing cut');
  }
  requireJournalMilestone(
    milestones.durableIntentAtMs,
    intentTail !== null
      ? persisted.acknowledgement.committedAtMs
      : submission === null
        ? null
        : (submission.payload as Readonly<{
          durableIntentCommittedAtMs: number;
        }>).durableIntentCommittedAtMs,
    'durable-intent time',
  );
  requireJournalMilestone(
    milestones.syntheticSubmissionAtMs,
    submission?.occurredAtMs ?? null,
    'synthetic-submission time',
  );
  requireJournalMilestone(
    milestones.acknowledgementAtMs,
    acknowledgement?.receivedAtMs ?? null,
    'acknowledgement time',
  );
  requireJournalMilestone(
    milestones.privateConfirmationAtMs,
    privateConfirmation?.receivedAtMs ?? null,
    'private-confirmation time',
  );
  const comparableTimes = [
    ...(milestones.exchangeClockCalibration === 'UTC_CALIBRATED'
      ? [milestones.exchangeEventAtMs]
      : []),
    milestones.localReceiveAtMs, milestones.featuresReadyAtMs,
    milestones.decisionAtMs, milestones.approvalAtMs, milestones.durableIntentAtMs,
    milestones.syntheticSubmissionAtMs, milestones.acknowledgementAtMs,
    milestones.privateConfirmationAtMs,
  ].filter((value): value is number => value !== null);
  if (comparableTimes.some((value) => value > milestones.observedAtMs)
    || (recording.observedAtMs !== null && recording.observedAtMs > milestones.observedAtMs)) {
    throw new TypeError('latency observation predates a milestone');
  }
  const knownOwnerSequence = [
    ...(milestones.exchangeClockCalibration === 'UTC_CALIBRATED'
      ? [milestones.exchangeEventAtMs]
      : []),
    milestones.localReceiveAtMs,
    milestones.featuresReadyAtMs,
    milestones.decisionAtMs,
    milestones.approvalAtMs,
    milestones.durableIntentAtMs,
    milestones.syntheticSubmissionAtMs,
    milestones.acknowledgementAtMs,
  ].filter((value): value is number => value !== null);
  for (let index = 1; index < knownOwnerSequence.length; index += 1) {
    if (knownOwnerSequence[index] < knownOwnerSequence[index - 1]) {
      throw new TypeError('known owner-side latency milestones regress');
    }
  }
  if (milestones.exchangeEventAtMs === null && milestones.exchangeClockCalibration !== 'UNAVAILABLE') {
    throw new TypeError('cross-clock calibration cannot be claimed without exchange-event evidence');
  }
  const segments = deepFreezePrivate({
    exchangeEventToLocalReceive: milestones.exchangeClockCalibration === 'UTC_CALIBRATED'
      ? delta(milestones.exchangeEventAtMs, milestones.localReceiveAtMs)
      : null,
    localReceiveToFeatures: delta(milestones.localReceiveAtMs, milestones.featuresReadyAtMs),
    featuresToDecision: delta(milestones.featuresReadyAtMs, milestones.decisionAtMs),
    approvalToDurableIntent: delta(milestones.approvalAtMs, milestones.durableIntentAtMs),
    durableIntentToSyntheticSubmission: delta(milestones.durableIntentAtMs, milestones.syntheticSubmissionAtMs),
    syntheticSubmissionToAcknowledgement: delta(milestones.syntheticSubmissionAtMs, milestones.acknowledgementAtMs),
    // Private user events may legally arrive before the matching HTTP response.
    // Preserve that race as a signed observation instead of deleting it.
    acknowledgementToPrivateConfirmation: signedDelta(
      milestones.acknowledgementAtMs,
      milestones.privateConfirmationAtMs,
    ),
  });
  const completeness = Object.values(segments).every((value) => value !== null)
    ? 'COMPLETE_INJECTED' as const
    : 'PARTIAL_INJECTED' as const;
  const evidenceRevision = digest('l06latency_', {
    mutationId: persisted.snapshot.mutationId,
    journalOutcomeRevision: persisted.snapshot.outcomeRevision,
    milestones,
    segmentsMs: segments,
  });
  const researchRecordingReady = recording.state === 'RUNNING'
    && recording.observedAtMs !== null
    && recording.gapCount === 0
    && recording.quotaState === 'OK'
    && recording.storagePressure === 'OK';
  return deepFreezePrivate({
    schema: LATENCY_EVIDENCE_SCHEMA,
    version: 1 as const,
    mutationId: persisted.snapshot.mutationId,
    journalOutcomeRevision: persisted.snapshot.outcomeRevision,
    evidenceRevision,
    milestones,
    segmentsMs: segments,
    completeness,
    researchTruthState: researchRecordingReady
      ? 'AVAILABLE' as const
      : recording.state === 'UNKNOWN' || recording.state === 'FAILED'
        || recording.observedAtMs === null || recording.gapCount === null
        || recording.quotaState === 'UNKNOWN' || recording.quotaState === 'EXHAUSTED'
        || recording.storagePressure === 'UNKNOWN' || recording.storagePressure === 'FULL'
        ? 'UNAVAILABLE' as const
        : 'DEGRADED' as const,
    researchRecordingReady,
    canonicalRecordingOwner: 'INTELLIGENCE_RUNTIME' as const,
    regimePosture: regimePostureFor(persisted),
    empiricalRegionBenchmark: 'NOT_PERFORMED' as const,
    moneyCriticalRecoveryBlockedByRecording: false as const,
    syntheticOnly: true as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  });
}

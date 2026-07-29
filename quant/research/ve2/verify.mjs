#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKET_FILES = Object.freeze([
  'README.md',
  'activation.schema.v1.json',
  'capture-manifest.schema.v1.json',
  'evidence-chain.mjs',
  'measurement-policy.v1.json',
  'official-sources.v1.json',
  'outcome-open.schema.v1.json',
  'replay.mjs',
  'smoke-capture.mjs',
  'verify.mjs',
  'verify.test.mjs',
]);
const BASE_CANDIDATE = '6c8184331d85d098d2919e37d217f220f4c3214c';
const FROZEN_JSON_SHA256 = Object.freeze({
  'measurement-policy.v1.json': '96cf89ce2825a930e6f66c8d0d7b606f7d42670cf36b953f9f93c5b4ff2a2067',
  'official-sources.v1.json': '8c8e88eeab14e39e51e80f3bb97b48a958a5652cc3f39d79f664252337546dd2',
});

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function plainRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, keys) {
  return plainRecord(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}

function canonicalJson(value) {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return JSON.stringify(value);
  if (typeof value === 'number') {
    invariant(Number.isSafeInteger(value), 'VE2_CANONICAL_NUMBER');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  invariant(plainRecord(value), 'VE2_CANONICAL_OBJECT');
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(',')}}`;
}

function withoutField(value, field) {
  invariant(plainRecord(value), 'VE2_DURABLE_OBJECT');
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== field),
  );
}

export function buildDurableId(prefix, value) {
  invariant(
    [
      've2_activation_',
      've2_manifest_',
      've2_open_',
      've2_open_once_',
    ].includes(prefix),
    'VE2_DURABLE_PREFIX',
  );
  return `${prefix}${sha256(Buffer.from(canonicalJson(value), 'utf8'))}`;
}

export function durableArtifactSha256(value) {
  return sha256(Buffer.from(`${canonicalJson(value)}\n`, 'utf8'));
}

function domainSeparatedSha256(domain, value) {
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  hash.update(Uint8Array.of(0));
  hash.update(canonicalJson(value), 'utf8');
  return `sha256:${hash.digest('hex')}`;
}

export function buildEvidenceSegmentInventorySha256(segments) {
  invariant(
    Array.isArray(segments) && segments.length > 0,
    'VE2_SEGMENT_INVENTORY_REQUIRED',
  );
  return domainSeparatedSha256(
    'VE2_EVIDENCE_SEGMENT_INVENTORY_V1',
    segments,
  );
}

export function buildAcceptedProposalUniverseSha256(proposals) {
  invariant(Array.isArray(proposals), 'VE2_PROPOSAL_UNIVERSE_REQUIRED');
  return domainSeparatedSha256(
    'VE2_ACCEPTED_PROPOSAL_UNIVERSE_V1',
    proposals,
  );
}

function isoMs(value, code) {
  invariant(
    typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value),
    code,
  );
  const parsed = Date.parse(value);
  invariant(Number.isSafeInteger(parsed) && new Date(parsed).toISOString() === value, code);
  return parsed;
}

function firstUtcMidnightAtOrAfter(timestampMs) {
  const date = new Date(timestampMs);
  const sameDayMidnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return timestampMs === sameDayMidnight
    ? sameDayMidnight
    : Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate() + 1,
      );
}

export function validateActivationInstance(
  activation,
  trustedContext,
) {
  invariant(plainRecord(trustedContext), 'VE2_ACTIVATION_TRUSTED_CONTEXT_REQUIRED');
  const {
    expectedAcceptedCaptureCandidateCommit,
    expectedCaptureImplementationSha256,
    expectedPacketMeasurementPolicySha256,
    expectedDetectorCoverageCorePolicyDigest,
    expectedDetectorInputSourceId,
    expectedDetectorInputSourceDigest,
    expectedDetectorCoverageChainKey,
  } = trustedContext;
  invariant(
    typeof expectedAcceptedCaptureCandidateCommit === 'string'
      && /^[a-f0-9]{40}$/.test(expectedAcceptedCaptureCandidateCommit)
      && typeof expectedCaptureImplementationSha256 === 'string'
      && /^[a-f0-9]{64}$/.test(expectedCaptureImplementationSha256)
      && typeof expectedPacketMeasurementPolicySha256 === 'string'
      && /^[a-f0-9]{64}$/.test(expectedPacketMeasurementPolicySha256)
      && typeof expectedDetectorCoverageCorePolicyDigest === 'string'
      && /^sha256:[a-f0-9]{64}$/.test(expectedDetectorCoverageCorePolicyDigest)
      && typeof expectedDetectorInputSourceId === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(
        expectedDetectorInputSourceId,
      )
      && typeof expectedDetectorInputSourceDigest === 'string'
      && /^sha256:[a-f0-9]{64}$/.test(expectedDetectorInputSourceDigest)
      && typeof expectedDetectorCoverageChainKey === 'string'
      && /^ve2_detector_coverage_[a-f0-9]{64}$/.test(
        expectedDetectorCoverageChainKey,
      ),
    'VE2_ACTIVATION_TRUSTED_CONTEXT_REQUIRED',
  );
  invariant(exactKeys(activation, [
    'schemaVersion',
    'activationId',
    'state',
    'acceptedCaptureCandidateCommit',
    'acceptedAtUtc',
    'acceptedByIndependentExactHashReview',
    'packetMeasurementPolicySha256',
    'detectorCoverageCorePolicyDigest',
    'detectorInputSourceId',
    'detectorInputSourceDigest',
    'detectorBindingState',
    'detectorCoverageChainKey',
    'captureImplementationSha256',
    'warmupStartUtc',
    'intervalStartUtc',
    'intervalEndExclusiveUtc',
    'maturityAtUtc',
    'sampleUniverse',
    'outcomeBytesAccessed',
    'consumerGate',
  ]), 'VE2_ACTIVATION_INSTANCE_SHAPE');
  invariant(
    activation.schemaVersion === 've2.capture-activation.v1'
      && activation.state === 'CAPTURE_READY_ACCEPTED'
      && activation.acceptedByIndependentExactHashReview === true
      && activation.outcomeBytesAccessed === false
      && activation.consumerGate
        === 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
    'VE2_ACTIVATION_INSTANCE_STATE',
  );
  invariant(
    /^[a-f0-9]{40}$/.test(activation.acceptedCaptureCandidateCommit)
      && /^[a-f0-9]{64}$/.test(
        activation.packetMeasurementPolicySha256,
      )
      && /^sha256:[a-f0-9]{64}$/.test(
        activation.detectorCoverageCorePolicyDigest,
      )
      && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(
        activation.detectorInputSourceId,
      )
      && /^sha256:[a-f0-9]{64}$/.test(
        activation.detectorInputSourceDigest,
      )
      && /^ve2_detector_coverage_[a-f0-9]{64}$/.test(
        activation.detectorCoverageChainKey,
      )
      && activation.detectorBindingState
        === 'ACCEPTED_PROSPECTIVE_BINDING'
      && /^[a-f0-9]{64}$/.test(activation.captureImplementationSha256),
    'VE2_ACTIVATION_INSTANCE_HASH',
  );
  invariant(
    activation.acceptedCaptureCandidateCommit
      === expectedAcceptedCaptureCandidateCommit,
    'VE2_ACTIVATION_ACCEPTED_COMMIT_MISMATCH',
  );
  invariant(
    activation.captureImplementationSha256
      === expectedCaptureImplementationSha256,
    'VE2_ACTIVATION_CAPTURE_HASH_MISMATCH',
  );
  invariant(
    activation.packetMeasurementPolicySha256
      === expectedPacketMeasurementPolicySha256,
    'VE2_ACTIVATION_PACKET_POLICY_HASH_MISMATCH',
  );
  invariant(
    activation.detectorCoverageCorePolicyDigest
      === expectedDetectorCoverageCorePolicyDigest,
    'VE2_ACTIVATION_CORE_POLICY_DIGEST_MISMATCH',
  );
  invariant(
    activation.detectorInputSourceId === expectedDetectorInputSourceId
      && activation.detectorInputSourceDigest
        === expectedDetectorInputSourceDigest,
    'VE2_ACTIVATION_DETECTOR_SOURCE_MISMATCH',
  );
  invariant(
    activation.detectorCoverageChainKey
      === expectedDetectorCoverageChainKey,
    'VE2_ACTIVATION_DETECTOR_CHAIN_MISMATCH',
  );
  invariant(exactKeys(activation.sampleUniverse, [
    'mode',
    'proposalOrigin',
    'prospectiveCaptureRequired',
    'nonPseudoRequired',
    'pointInTimeEligibilityRequired',
    'currentStateSubstitutionForbidden',
  ]), 'VE2_ACTIVATION_UNIVERSE_SHAPE');
  invariant(
    activation.sampleUniverse.mode
      === 'PROSPECTIVE_ACCEPTED_DETECTOR_PROPOSALS'
      && activation.sampleUniverse.proposalOrigin === 'VOLUME_DETECTOR'
      && activation.sampleUniverse.prospectiveCaptureRequired === true
      && activation.sampleUniverse.nonPseudoRequired === true
      && activation.sampleUniverse.pointInTimeEligibilityRequired === true
      && activation.sampleUniverse.currentStateSubstitutionForbidden === true,
    'VE2_ACTIVATION_UNIVERSE',
  );
  const acceptedAt = isoMs(activation.acceptedAtUtc, 'VE2_ACTIVATION_ACCEPTED_TIME');
  const warmupStart = isoMs(activation.warmupStartUtc, 'VE2_ACTIVATION_WARMUP_TIME');
  const intervalStart = isoMs(activation.intervalStartUtc, 'VE2_ACTIVATION_START_TIME');
  const intervalEnd = isoMs(activation.intervalEndExclusiveUtc, 'VE2_ACTIVATION_END_TIME');
  const maturity = isoMs(activation.maturityAtUtc, 'VE2_ACTIVATION_MATURITY_TIME');
  invariant(
    intervalStart
      === firstUtcMidnightAtOrAfter(acceptedAt + 86_400_000),
    'VE2_ACTIVATION_FIRST_UTC_MIDNIGHT',
  );
  invariant(
    warmupStart === intervalStart - 14_400_000,
    'VE2_ACTIVATION_WARMUP_CHRONOLOGY',
  );
  invariant(
    intervalEnd === intervalStart + 2_592_000_000,
    'VE2_ACTIVATION_INTERVAL_CHRONOLOGY',
  );
  invariant(
    maturity === intervalEnd + 62_000,
    'VE2_ACTIVATION_MATURITY_CHRONOLOGY',
  );
  invariant(
    activation.activationId === buildDurableId(
      've2_activation_',
      withoutField(activation, 'activationId'),
    ),
    'VE2_ACTIVATION_DURABLE_ID',
  );
  return true;
}

const TERMINAL_MANIFEST_KEYS = Object.freeze([
  'schemaVersion',
  'manifestId',
  'activationId',
  'state',
  'activationSha256',
  'packetMeasurementPolicySha256',
  'detectorCoverageCorePolicyDigest',
  'detectorInputSourceId',
  'detectorInputSourceDigest',
  'intervalStartUtc',
  'intervalEndExclusiveUtc',
  'maturityAtUtc',
  'evidenceCaptureStartedAtUtc',
  'evidenceCaptureEndedAtUtc',
  'terminalRecordedAtUtc',
  'maturityPassed',
  'evidenceSchema',
  'evidenceSegmentCount',
  'evidenceSegmentInventorySha256',
  'evidenceSegments',
  'detectorCoverageSegmentCount',
  'symbolLifecycleSegmentCount',
  'detectorCoverageState',
  'detectorSegmentGapCount',
  'detectorSegmentOverlapCount',
  'detectorCutCount',
  'missingDetectorCutCount',
  'maximumDetectorCutGapMs',
  'sourceUncoveredDurationMs',
  'acceptedProposalUniverseSha256',
  'acceptedDetectorProposalCount',
  'nonPseudoDetectorProposalCount',
  'proposalEligibilitySnapshotCount',
  'pseudoProposalExcludedCount',
  'proposalSampleState',
  'lifecycleProposalCount',
  'lifecycleCount',
  'terminalLifecycleCount',
  'blockedLifecycleCount',
  'openLifecycleCount',
  'packetPolicyBindingCount',
  'coreReplaySourceMechanics',
  'lifecycleReplayPerformed',
  'complete',
  'warmupRowsIncludedInScoredSample',
  'smokeRowsIncluded',
  'outcomeBytesAccessedBeforeMaturity',
  'economicsState',
  'profitabilityClaim',
  'consumerGate',
  'externalEffects',
]);

const TERMINAL_SEGMENT_KEYS = Object.freeze([
  'schemaVersion',
  'profile',
  'purpose',
  'activationId',
  'captureId',
  'segmentId',
  'coverageRole',
  'chainKey',
  'symbol',
  'segmentIndex',
  'previousTerminalHash',
  'corePolicyDigest',
  'packetMeasurementPolicySha256',
  'terminalHash',
  'evidenceBytesSha256',
  'detectorInputSourceId',
  'detectorInputSourceDigest',
  'coverageStartMs',
  'coverageEndExclusiveMs',
  'firstRecordHash',
  'lastRecordHash',
  'firstLocalReceivedAtMs',
  'lastLocalReceivedAtMs',
  'firstLocalMonotonicNs',
  'lastLocalMonotonicNs',
  'recordCount',
  'canonicalJsonlBytes',
  'cumulativeRawPayloadBytes',
  'generationCount',
  'allGenerationsClosed',
  'continuityGapCount',
  'unresolvedContinuityGapCount',
  'detectorCutFirstIndex',
  'detectorCutCount',
  'detectorExpectedCutCount',
  'detectorCadenceMs',
  'missingDetectorCutCount',
  'detectorMissingCutRanges',
  'maximumDetectorCutGapMs',
  'sourceUncoveredDurationMs',
  'detectorBatchPreviousDigest',
  'detectorBatchTerminalDigest',
  'detectorEvaluationUniverseDigest',
  'detectorEvaluationUniverseCount',
  'detectorCoverageComplete',
  'acceptedProposals',
  'acceptedProposalIds',
  'pseudoProposalExcludedCount',
  'lifecycleProposals',
  'lifecycleProposalIds',
  'lifecycleCount',
  'terminalLifecycleCount',
  'blockedLifecycleCount',
  'openLifecycleCount',
  'nonTruncated',
  'quiescent',
  'profitabilityClaim',
  'consumerGate',
]);

const SHA256_ANCHOR = /^sha256:[a-f0-9]{64}$/;
const RAW_SHA256 = /^[a-f0-9]{64}$/;
const PROPOSAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SOURCE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SYMBOL = /^[A-Z0-9]{2,30}$/;

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0);
}

function strictCanonicalOrder(values, key, code) {
  let prior = null;
  for (const value of values) {
    const current = key(value);
    invariant(prior === null || current > prior, code);
    prior = current;
  }
}

function proposalSortKey(proposal) {
  return [
    proposal.symbol,
    proposal.proposalId,
    String(proposal.proposalRevision).padStart(16, '0'),
    proposal.proposalDigest,
  ].join('|');
}

function segmentSortKey(segment) {
  return [
    segment.coverageRole === 'DETECTOR_COVERAGE' ? '0' : '1',
    segment.chainKey,
    String(segment.segmentIndex).padStart(16, '0'),
    segment.symbol ?? '',
    segment.segmentId,
  ].join('|');
}

function validateProposalBinding(proposal, expectedCutRange) {
  invariant(exactKeys(proposal, [
    'cutOffset',
    'proposalId',
    'proposalRevision',
    'proposalDigest',
    'symbol',
    'detectorDecisionDigest',
    'featureDigest',
  ]), 'VE2_SEGMENT_PROPOSAL_SHAPE');
  invariant(
    nonNegativeSafeInteger(proposal.cutOffset)
      && proposal.cutOffset >= expectedCutRange.start
      && proposal.cutOffset < expectedCutRange.end
      && PROPOSAL_ID.test(proposal.proposalId)
      && Number.isSafeInteger(proposal.proposalRevision)
      && proposal.proposalRevision >= 1
      && SOURCE_IDENTIFIER.test(proposal.proposalDigest)
      && SYMBOL.test(proposal.symbol)
      && SOURCE_IDENTIFIER.test(proposal.detectorDecisionDigest)
      && SOURCE_IDENTIFIER.test(proposal.featureDigest),
    'VE2_SEGMENT_PROPOSAL_INVALID',
  );
}

function validateLifecycleBinding(lifecycle) {
  invariant(exactKeys(lifecycle, [
    'proposalId',
    'proposalRevision',
    'proposalDigest',
    'symbol',
    'state',
  ]), 'VE2_SEGMENT_LIFECYCLE_SHAPE');
  invariant(
    PROPOSAL_ID.test(lifecycle.proposalId)
      && Number.isSafeInteger(lifecycle.proposalRevision)
      && lifecycle.proposalRevision >= 1
      && SOURCE_IDENTIFIER.test(lifecycle.proposalDigest)
      && SYMBOL.test(lifecycle.symbol)
      && (
        lifecycle.state === 'TERMINAL'
        || lifecycle.state === 'BLOCKED'
      ),
    'VE2_SEGMENT_LIFECYCLE_INVALID',
  );
}

function validateRecomputedSegment(
  segment,
  activation,
  captureStartedMs,
  captureEndedMs,
  intervalStartMs,
  maturityMs,
) {
  invariant(
    exactKeys(segment, TERMINAL_SEGMENT_KEYS),
    'VE2_SEGMENT_INSTANCE_SHAPE',
  );
  invariant(
    segment.schemaVersion === 've2.evidence-segment-descriptor.v1'
      && segment.profile === 'TERMINAL_SEGMENT'
      && segment.purpose === 'FORWARD_MEASUREMENT_SEGMENT_V1'
      && (
        segment.coverageRole === 'DETECTOR_COVERAGE'
        || segment.coverageRole === 'SYMBOL_LIFECYCLE'
      )
      && /^ve2_segment_[a-f0-9]{64}$/.test(segment.segmentId)
      && PROPOSAL_ID.test(segment.captureId)
      && PROPOSAL_ID.test(segment.chainKey)
      && nonNegativeSafeInteger(segment.segmentIndex)
      && (
        segment.segmentIndex === 0
          ? segment.previousTerminalHash === null
          : SHA256_ANCHOR.test(segment.previousTerminalHash)
      )
      && SHA256_ANCHOR.test(segment.corePolicyDigest)
      && RAW_SHA256.test(segment.packetMeasurementPolicySha256)
      && SHA256_ANCHOR.test(segment.terminalHash)
      && RAW_SHA256.test(segment.evidenceBytesSha256)
      && SHA256_ANCHOR.test(segment.detectorInputSourceDigest)
      && SHA256_ANCHOR.test(segment.firstRecordHash)
      && segment.lastRecordHash === segment.terminalHash,
    'VE2_SEGMENT_IDENTITY',
  );
  invariant(
    segment.activationId === activation.activationId
      && segment.packetMeasurementPolicySha256
        === activation.packetMeasurementPolicySha256
      && segment.detectorInputSourceId
        === activation.detectorInputSourceId
      && segment.detectorInputSourceDigest
        === activation.detectorInputSourceDigest,
    'VE2_SEGMENT_ACTIVATION_LINK',
  );
  invariant(
    nonNegativeSafeInteger(segment.coverageStartMs)
      && nonNegativeSafeInteger(segment.coverageEndExclusiveMs)
      && segment.coverageEndExclusiveMs > segment.coverageStartMs
      && segment.coverageStartMs >= intervalStartMs
      && segment.coverageEndExclusiveMs <= maturityMs
      && nonNegativeSafeInteger(segment.firstLocalReceivedAtMs)
      && nonNegativeSafeInteger(segment.lastLocalReceivedAtMs)
      && segment.lastLocalReceivedAtMs >= segment.firstLocalReceivedAtMs
      && segment.firstLocalReceivedAtMs >= captureStartedMs
      && segment.lastLocalReceivedAtMs <= captureEndedMs
      && /^(0|[1-9][0-9]*)$/.test(segment.firstLocalMonotonicNs)
      && /^(0|[1-9][0-9]*)$/.test(segment.lastLocalMonotonicNs)
      && BigInt(segment.lastLocalMonotonicNs)
        >= BigInt(segment.firstLocalMonotonicNs),
    'VE2_SEGMENT_CLOCKS',
  );
  invariant(
    Number.isSafeInteger(segment.recordCount)
      && segment.recordCount >= 3
      && segment.recordCount <= 100_000
      && Number.isSafeInteger(segment.canonicalJsonlBytes)
      && segment.canonicalJsonlBytes >= 1
      && segment.canonicalJsonlBytes <= 268_435_456
      && Number.isSafeInteger(segment.cumulativeRawPayloadBytes)
      && segment.cumulativeRawPayloadBytes >= 1
      && segment.cumulativeRawPayloadBytes <= 268_435_456
      && Number.isSafeInteger(segment.generationCount)
      && segment.generationCount >= 1
      && segment.allGenerationsClosed === true
      && segment.continuityGapCount === 0
      && segment.unresolvedContinuityGapCount === 0
      && segment.nonTruncated === true
      && segment.quiescent === true
      && segment.profitabilityClaim === false
      && segment.consumerGate
        === 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
    'VE2_SEGMENT_TERMINAL_STATE',
  );
  invariant(
    nonNegativeSafeInteger(segment.detectorCutFirstIndex)
      && Number.isSafeInteger(segment.detectorCutCount)
      && segment.detectorCutCount >= 1
      && segment.detectorExpectedCutCount === segment.detectorCutCount
      && segment.detectorCadenceMs === 2_000
      && segment.missingDetectorCutCount === 0
      && Array.isArray(segment.detectorMissingCutRanges)
      && segment.detectorMissingCutRanges.length === 0
      && nonNegativeSafeInteger(segment.maximumDetectorCutGapMs)
      && segment.maximumDetectorCutGapMs <= 2_000
      && segment.sourceUncoveredDurationMs === 0
      && SHA256_ANCHOR.test(segment.detectorBatchTerminalDigest)
      && (
        segment.detectorCutFirstIndex === 0
          ? segment.detectorBatchPreviousDigest === null
          : SHA256_ANCHOR.test(segment.detectorBatchPreviousDigest)
      )
      && SHA256_ANCHOR.test(
        segment.detectorEvaluationUniverseDigest,
      )
      && nonNegativeSafeInteger(
        segment.detectorEvaluationUniverseCount,
      )
      && segment.detectorCoverageComplete === true
      && segment.coverageEndExclusiveMs - segment.coverageStartMs
        === segment.detectorCutCount * 2_000,
    'VE2_SEGMENT_CUT_COVERAGE',
  );
  invariant(
    Array.isArray(segment.acceptedProposals)
      && Array.isArray(segment.acceptedProposalIds)
      && Array.isArray(segment.lifecycleProposals)
      && Array.isArray(segment.lifecycleProposalIds)
      && nonNegativeSafeInteger(segment.pseudoProposalExcludedCount)
      && nonNegativeSafeInteger(segment.lifecycleCount)
      && nonNegativeSafeInteger(segment.terminalLifecycleCount)
      && nonNegativeSafeInteger(segment.blockedLifecycleCount)
      && segment.openLifecycleCount === 0,
    'VE2_SEGMENT_COLLECTIONS',
  );
  const cutRange = {
    start: segment.detectorCutFirstIndex,
    end: segment.detectorCutFirstIndex + segment.detectorCutCount,
  };
  for (const proposal of segment.acceptedProposals) {
    validateProposalBinding(proposal, cutRange);
  }
  strictCanonicalOrder(
    segment.acceptedProposals,
    proposalSortKey,
    'VE2_SEGMENT_PROPOSAL_ORDER',
  );
  invariant(
    new Set(segment.acceptedProposalIds).size
      === segment.acceptedProposalIds.length
      && canonicalJson(segment.acceptedProposalIds)
        === canonicalJson(
          segment.acceptedProposals.map(
            (proposal) => proposal.proposalId,
          ),
        ),
    'VE2_SEGMENT_PROPOSAL_IDS',
  );
  for (const lifecycle of segment.lifecycleProposals) {
    validateLifecycleBinding(lifecycle);
  }
  strictCanonicalOrder(
    segment.lifecycleProposals,
    proposalSortKey,
    'VE2_SEGMENT_LIFECYCLE_ORDER',
  );
  invariant(
    new Set(segment.lifecycleProposalIds).size
      === segment.lifecycleProposalIds.length
      && canonicalJson(segment.lifecycleProposalIds)
        === canonicalJson(
          segment.lifecycleProposals.map(
            (lifecycle) => lifecycle.proposalId,
          ),
        )
      && segment.lifecycleCount === segment.lifecycleProposals.length
      && segment.terminalLifecycleCount
        === segment.lifecycleProposals.filter(
          (lifecycle) => lifecycle.state === 'TERMINAL',
        ).length
      && segment.blockedLifecycleCount
        === segment.lifecycleProposals.filter(
          (lifecycle) => lifecycle.state === 'BLOCKED',
        ).length
      && segment.terminalLifecycleCount + segment.blockedLifecycleCount
        === segment.lifecycleCount,
    'VE2_SEGMENT_LIFECYCLE_COUNTS',
  );
  if (segment.coverageRole === 'DETECTOR_COVERAGE') {
    invariant(
      segment.symbol === null
        && segment.chainKey === activation.detectorCoverageChainKey
        && segment.corePolicyDigest
          === activation.detectorCoverageCorePolicyDigest
        && segment.lifecycleProposals.length === 0
        && segment.lifecycleProposalIds.length === 0
        && segment.lifecycleCount === 0,
      'VE2_DETECTOR_SEGMENT_ROLE',
    );
  } else {
    invariant(
      typeof segment.symbol === 'string'
        && SYMBOL.test(segment.symbol)
        && segment.acceptedProposals.length > 0
        && segment.lifecycleProposals.length
          === segment.acceptedProposals.length
        && segment.detectorEvaluationUniverseCount
          >= segment.acceptedProposals.length
        && segment.acceptedProposals.every(
          (proposal) => proposal.symbol === segment.symbol,
        )
        && segment.lifecycleProposals.every(
          (lifecycle) => lifecycle.symbol === segment.symbol,
        )
        && canonicalJson(
          segment.lifecycleProposals.map(
            ({ state: _state, ...proposal }) => proposal,
          ),
        ) === canonicalJson(
          segment.acceptedProposals.map((proposal) => ({
            proposalId: proposal.proposalId,
            proposalRevision: proposal.proposalRevision,
            proposalDigest: proposal.proposalDigest,
            symbol: proposal.symbol,
          })),
        ),
      'VE2_LIFECYCLE_SEGMENT_ROLE',
    );
  }
}

export function validateTerminalManifestInstance(
  manifest,
  activation,
  trustedContext,
) {
  invariant(
    plainRecord(trustedContext)
      && Array.isArray(trustedContext.expectedSegments)
      && trustedContext.expectedSegments.length > 0
      && typeof trustedContext.expectedEvidenceSegmentInventorySha256
        === 'string'
      && SHA256_ANCHOR.test(
        trustedContext.expectedEvidenceSegmentInventorySha256,
      ),
    'VE2_MANIFEST_TRUSTED_CONTEXT_REQUIRED',
  );
  validateActivationInstance(activation, trustedContext);
  invariant(
    exactKeys(manifest, TERMINAL_MANIFEST_KEYS),
    'VE2_MANIFEST_INSTANCE_SHAPE',
  );
  invariant(
    manifest.schemaVersion === 've2.capture-manifest.v1'
      && manifest.state === 'TERMINAL_CAPTURE_RECOMPUTED'
      && manifest.maturityPassed === true
      && manifest.evidenceSchema
        === 'cosmos.engine.volume.forward-measurement-evidence.v1'
      && manifest.detectorCoverageState
        === 'COMPLETE_EXACT_PARTITION'
      && manifest.detectorSegmentGapCount === 0
      && manifest.detectorSegmentOverlapCount === 0
      && manifest.missingDetectorCutCount === 0
      && manifest.sourceUncoveredDurationMs === 0
      && manifest.openLifecycleCount === 0
      && manifest.coreReplaySourceMechanics
        === 'EXACT_CANONICAL_RECOMPUTED'
      && manifest.lifecycleReplayPerformed === true
      && manifest.complete === true
      && manifest.warmupRowsIncludedInScoredSample === 0
      && manifest.smokeRowsIncluded === 0
      && manifest.outcomeBytesAccessedBeforeMaturity === false
      && manifest.economicsState === 'UNKNOWN'
      && manifest.profitabilityClaim === false
      && manifest.consumerGate
        === 'BLOCKED_UNTIL_TERMINAL_RESULT_INDEPENDENTLY_ACCEPTED',
    'VE2_MANIFEST_INSTANCE_STATE',
  );
  invariant(
    manifest.activationId === activation.activationId
      && manifest.activationSha256 === durableArtifactSha256(activation)
      && manifest.packetMeasurementPolicySha256
        === activation.packetMeasurementPolicySha256
      && manifest.detectorCoverageCorePolicyDigest
        === activation.detectorCoverageCorePolicyDigest
      && manifest.detectorInputSourceId
        === activation.detectorInputSourceId
      && manifest.detectorInputSourceDigest
        === activation.detectorInputSourceDigest
      && manifest.intervalStartUtc === activation.intervalStartUtc
      && manifest.intervalEndExclusiveUtc
        === activation.intervalEndExclusiveUtc
      && manifest.maturityAtUtc === activation.maturityAtUtc,
    'VE2_MANIFEST_ACTIVATION_LINK',
  );
  const warmupStart = isoMs(
    activation.warmupStartUtc,
    'VE2_MANIFEST_WARMUP_START_TIME',
  );
  const intervalStart = isoMs(
    manifest.intervalStartUtc,
    'VE2_MANIFEST_START_TIME',
  );
  const intervalEnd = isoMs(
    manifest.intervalEndExclusiveUtc,
    'VE2_MANIFEST_END_TIME',
  );
  const maturity = isoMs(
    manifest.maturityAtUtc,
    'VE2_MANIFEST_MATURITY_TIME',
  );
  const captureStarted = isoMs(
    manifest.evidenceCaptureStartedAtUtc,
    'VE2_MANIFEST_CAPTURE_START_TIME',
  );
  const captureEnded = isoMs(
    manifest.evidenceCaptureEndedAtUtc,
    'VE2_MANIFEST_CAPTURE_END_TIME',
  );
  const terminal = isoMs(
    manifest.terminalRecordedAtUtc,
    'VE2_MANIFEST_TERMINAL_TIME',
  );
  invariant(
    intervalEnd - intervalStart === 2_592_000_000
      && maturity - intervalEnd === 62_000
      && captureStarted <= warmupStart
      && captureEnded >= maturity
      && terminal >= maturity
      && terminal >= captureEnded,
    'VE2_MANIFEST_CAPTURE_INTERVAL_COVERAGE',
  );
  invariant(
    Array.isArray(manifest.evidenceSegments)
      && manifest.evidenceSegments.length > 0
      && manifest.evidenceSegmentCount
        === manifest.evidenceSegments.length
      && canonicalJson(manifest.evidenceSegments)
        === canonicalJson(trustedContext.expectedSegments),
    'VE2_MANIFEST_RECOMPUTED_SEGMENTS_MISMATCH',
  );
  strictCanonicalOrder(
    manifest.evidenceSegments,
    segmentSortKey,
    'VE2_MANIFEST_SEGMENT_ORDER',
  );
  const segmentIds = new Set();
  const terminalHashes = new Set();
  const evidenceByteHashes = new Set();
  for (const segment of manifest.evidenceSegments) {
    validateRecomputedSegment(
      segment,
      activation,
      captureStarted,
      captureEnded,
      intervalStart,
      maturity,
    );
    invariant(
      !segmentIds.has(segment.segmentId)
        && !terminalHashes.has(segment.terminalHash)
        && !evidenceByteHashes.has(segment.evidenceBytesSha256),
      'VE2_MANIFEST_SEGMENT_DUPLICATED',
    );
    segmentIds.add(segment.segmentId);
    terminalHashes.add(segment.terminalHash);
    evidenceByteHashes.add(segment.evidenceBytesSha256);
  }
  const inventorySha256 = buildEvidenceSegmentInventorySha256(
    manifest.evidenceSegments,
  );
  invariant(
    manifest.evidenceSegmentInventorySha256 === inventorySha256
      && trustedContext.expectedEvidenceSegmentInventorySha256
        === inventorySha256,
    'VE2_MANIFEST_SEGMENT_INVENTORY_MISMATCH',
  );

  const byChain = new Map();
  for (const segment of manifest.evidenceSegments) {
    const chain = byChain.get(segment.chainKey) ?? [];
    chain.push(segment);
    byChain.set(segment.chainKey, chain);
  }
  for (const chain of byChain.values()) {
    chain.sort((left, right) => left.segmentIndex - right.segmentIndex);
    for (let index = 0; index < chain.length; index += 1) {
      invariant(
        chain[index].segmentIndex === index
          && (
            index === 0
              ? chain[index].previousTerminalHash === null
              : chain[index].previousTerminalHash
                === chain[index - 1].terminalHash
          )
          && (
            index === 0
              ? chain[index].detectorCutFirstIndex === 0
              : chain[index].detectorCutFirstIndex > 0
          ),
        'VE2_MANIFEST_SEGMENT_CHAIN',
      );
    }
  }

  const detectorSegments = manifest.evidenceSegments.filter(
    (segment) => segment.coverageRole === 'DETECTOR_COVERAGE',
  );
  const lifecycleSegments = manifest.evidenceSegments.filter(
    (segment) => segment.coverageRole === 'SYMBOL_LIFECYCLE',
  );
  detectorSegments.sort(
    (left, right) => left.coverageStartMs - right.coverageStartMs,
  );
  invariant(detectorSegments.length > 0, 'VE2_MANIFEST_DETECTOR_REQUIRED');
  let expectedCoverageStart = intervalStart;
  let expectedCutFirstIndex = 0;
  let previousBatchDigest = null;
  let detectorCutCount = 0;
  let maximumDetectorCutGapMs = 0;
  const acceptedProposals = [];
  const acceptedIds = new Set();
  let pseudoProposalExcludedCount = 0;
  for (let index = 0; index < detectorSegments.length; index += 1) {
    const segment = detectorSegments[index];
    invariant(
      segment.segmentIndex === index
        && segment.coverageStartMs === expectedCoverageStart
        && segment.detectorCutFirstIndex === expectedCutFirstIndex
        && segment.detectorBatchPreviousDigest === previousBatchDigest,
      'VE2_MANIFEST_DETECTOR_PARTITION',
    );
    expectedCoverageStart = segment.coverageEndExclusiveMs;
    expectedCutFirstIndex += segment.detectorCutCount;
    previousBatchDigest = segment.detectorBatchTerminalDigest;
    detectorCutCount += segment.detectorCutCount;
    maximumDetectorCutGapMs = Math.max(
      maximumDetectorCutGapMs,
      segment.maximumDetectorCutGapMs,
    );
    pseudoProposalExcludedCount += segment.pseudoProposalExcludedCount;
    for (const proposal of segment.acceptedProposals) {
      invariant(
        proposal.cutOffset < (
          intervalEnd - intervalStart
        ) / 2_000,
        'VE2_MANIFEST_PROPOSAL_AFTER_INTERVAL',
      );
      invariant(
        !acceptedIds.has(proposal.proposalId),
        'VE2_MANIFEST_ACCEPTED_PROPOSAL_DUPLICATED',
      );
      acceptedIds.add(proposal.proposalId);
      acceptedProposals.push(proposal);
    }
  }
  invariant(
    expectedCoverageStart === maturity
      && expectedCutFirstIndex === (
        maturity - intervalStart
      ) / 2_000,
    'VE2_MANIFEST_DETECTOR_INTERVAL_INCOMPLETE',
  );
  acceptedProposals.sort((left, right) => (
    proposalSortKey(left).localeCompare(proposalSortKey(right))
  ));

  const lifecycleProposals = [];
  const lifecycleIds = new Set();
  for (const segment of lifecycleSegments) {
    for (const lifecycle of segment.lifecycleProposals) {
      invariant(
        !lifecycleIds.has(lifecycle.proposalId),
        'VE2_MANIFEST_LIFECYCLE_PROPOSAL_DUPLICATED',
      );
      lifecycleIds.add(lifecycle.proposalId);
      lifecycleProposals.push(lifecycle);
    }
  }
  lifecycleProposals.sort((left, right) => (
    proposalSortKey(left).localeCompare(proposalSortKey(right))
  ));
  invariant(
    lifecycleProposals.length === acceptedProposals.length
      && canonicalJson(
        lifecycleProposals.map(
          ({ state: _state, ...proposal }) => proposal,
        ),
      ) === canonicalJson(
        acceptedProposals.map((proposal) => ({
          proposalId: proposal.proposalId,
          proposalRevision: proposal.proposalRevision,
          proposalDigest: proposal.proposalDigest,
          symbol: proposal.symbol,
        })),
      ),
    'VE2_MANIFEST_PROPOSAL_LIFECYCLE_BIJECTION',
  );
  invariant(
    manifest.detectorCoverageSegmentCount === detectorSegments.length
      && manifest.symbolLifecycleSegmentCount === lifecycleSegments.length
      && manifest.detectorCutCount === detectorCutCount
      && manifest.maximumDetectorCutGapMs === maximumDetectorCutGapMs
      && manifest.acceptedProposalUniverseSha256
        === buildAcceptedProposalUniverseSha256(acceptedProposals)
      && manifest.acceptedDetectorProposalCount
        === acceptedProposals.length
      && manifest.nonPseudoDetectorProposalCount
        === acceptedProposals.length
      && manifest.proposalEligibilitySnapshotCount
        === acceptedProposals.length
      && manifest.pseudoProposalExcludedCount
        === pseudoProposalExcludedCount
      && manifest.proposalSampleState === (
        acceptedProposals.length === 0
          ? 'NO_ACCEPTED_PROPOSALS'
          : 'ACCEPTED_PROPOSALS_RECORDED'
      )
      && manifest.lifecycleProposalCount === lifecycleProposals.length
      && manifest.lifecycleCount === lifecycleProposals.length
      && manifest.terminalLifecycleCount
        === lifecycleProposals.filter(
          (lifecycle) => lifecycle.state === 'TERMINAL',
        ).length
      && manifest.blockedLifecycleCount
        === lifecycleProposals.filter(
          (lifecycle) => lifecycle.state === 'BLOCKED',
        ).length
      && manifest.packetPolicyBindingCount
        >= manifest.evidenceSegmentCount,
    'VE2_MANIFEST_RECONCILIATION',
  );
  invariant(exactKeys(manifest.externalEffects, [
    'privateOrSignedCalls',
    'orders',
    'transfers',
    'withdrawals',
    'moneyUsd',
  ]) && Object.values(manifest.externalEffects).every(
    (value) => value === 0,
  ), 'VE2_MANIFEST_EXTERNAL_EFFECTS');
  invariant(
    manifest.manifestId === buildDurableId(
      've2_manifest_',
      withoutField(manifest, 'manifestId'),
    ),
    'VE2_MANIFEST_DURABLE_ID',
  );
  return true;
}

export function validateOutcomeOpenReceiptInstance(
  receipt,
  manifest,
  activation,
  trustedContext,
) {
  validateTerminalManifestInstance(manifest, activation, trustedContext);
  invariant(exactKeys(receipt, [
    'schemaVersion',
    'receiptId',
    'openLockId',
    'activationId',
    'manifestId',
    'manifestSha256',
    'state',
    'maturityAtUtc',
    'openedAtUtc',
    'maturityPassed',
    'finalManifestVerified',
    'protocolDrift',
    'priorOutcomeOpenCount',
    'outcomeOpenCount',
    'openedPaths',
    'consumerGate',
  ]), 'VE2_OUTCOME_INSTANCE_SHAPE');
  invariant(
    receipt.schemaVersion === 've2.outcome-open-receipt.v1'
      && receipt.state === 'TERMINAL_OUTCOME_OPENED_ONCE'
      && receipt.maturityPassed === true
      && receipt.finalManifestVerified === true
      && receipt.protocolDrift === false
      && receipt.priorOutcomeOpenCount === 0
      && receipt.outcomeOpenCount === 1
      && receipt.consumerGate
        === 'BLOCKED_UNTIL_TERMINAL_RESULT_INDEPENDENTLY_ACCEPTED',
    'VE2_OUTCOME_INSTANCE_STATE',
  );
  invariant(
    receipt.activationId === activation.activationId
      && receipt.manifestId === manifest.manifestId
      && receipt.manifestSha256 === durableArtifactSha256(manifest)
      && receipt.maturityAtUtc === manifest.maturityAtUtc,
    'VE2_OUTCOME_MANIFEST_LINK',
  );
  const maturity = isoMs(receipt.maturityAtUtc, 'VE2_OUTCOME_MATURITY_TIME');
  const opened = isoMs(receipt.openedAtUtc, 'VE2_OUTCOME_OPENED_TIME');
  invariant(opened >= maturity, 'VE2_OUTCOME_OPENED_BEFORE_MATURITY');
  invariant(
    Array.isArray(receipt.openedPaths)
      && receipt.openedPaths.length > 0
      && new Set(receipt.openedPaths).size === receipt.openedPaths.length
      && receipt.openedPaths.every(
        (path) => typeof path === 'string'
          && /^quant\/research\/ve2\/outcome\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(path)
          && !path.split('/').some(
            (segment) => segment === '.' || segment === '..',
          ),
      ),
    'VE2_OUTCOME_PATHS',
  );
  invariant(
    receipt.openLockId === buildDurableId(
      've2_open_once_',
      { manifestId: manifest.manifestId },
    ),
    'VE2_OUTCOME_OPEN_LOCK_ID',
  );
  invariant(
    receipt.receiptId === buildDurableId(
      've2_open_',
      withoutField(receipt, 'receiptId'),
    ),
    'VE2_OUTCOME_DURABLE_ID',
  );
  return true;
}

function verifyChecksums(packetDir) {
  const lines = readFileSync(resolve(packetDir, 'SHA256SUMS'), 'utf8')
    .trim()
    .split('\n');
  const entries = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line);
    invariant(match !== null, 'VE2_CHECKSUM_LINE_INVALID');
    invariant(!entries.has(match[2]), 'VE2_CHECKSUM_DUPLICATE');
    entries.set(match[2], match[1]);
  }
  invariant(entries.size === PACKET_FILES.length, 'VE2_CHECKSUM_FILE_COUNT');
  for (const name of PACKET_FILES) {
    invariant(entries.has(name), `VE2_CHECKSUM_MISSING:${name}`);
    invariant(
      sha256(readFileSync(resolve(packetDir, name))) === entries.get(name),
      `VE2_CHECKSUM_MISMATCH:${name}`,
    );
  }
}

function verifyFrozenJson(packetDir) {
  for (const [name, expected] of Object.entries(FROZEN_JSON_SHA256)) {
    invariant(
      sha256(readFileSync(resolve(packetDir, name))) === expected,
      `VE2_FROZEN_JSON_DRIFT:${name}`,
    );
  }
}

function verifyBaseCandidate(repoRoot, policy) {
  invariant(policy.baseCandidateCommit === BASE_CANDIDATE, 'VE2_BASE_CANDIDATE_DRIFT');
  invariant(
    execFileSync('git', ['-C', repoRoot, 'rev-parse', policy.baseCandidateCommit], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim() === BASE_CANDIDATE,
    'VE2_BASE_CANDIDATE_MISSING',
  );
  execFileSync(
    'git',
    ['-C', repoRoot, 'merge-base', '--is-ancestor', BASE_CANDIDATE, 'HEAD'],
    { stdio: 'ignore' },
  );
}

function verifyPolicy(policy) {
  invariant(policy.schemaVersion === 've2.measurement-policy.v1', 'VE2_POLICY_SCHEMA');
  invariant(policy.milestone === 'V-I2', 'VE2_POLICY_MILESTONE');
  invariant(
    policy.policyId === 'VOLUME_MEASUREMENT_MAX_HOLD_60S_V1',
    'VE2_POLICY_ID',
  );
  invariant(policy.frozenForProspectiveUseOn === '2026-07-28', 'VE2_POLICY_FREEZE_DATE');

  const activation = policy.activation;
  invariant(activation.state === 'PROSPECTIVE_NOT_ACTIVATED', 'VE2_ACTIVATION_STATE');
  invariant(activation.independentlyAcceptedCaptureReadyAtUtc === null, 'VE2_ACTIVATION_ACCEPTED_AT');
  invariant(activation.intervalStartUtc === null, 'VE2_INTERVAL_START_FABRICATED');
  invariant(activation.intervalEndExclusiveUtc === null, 'VE2_INTERVAL_END_FABRICATED');
  invariant(activation.maturityAtUtc === null, 'VE2_MATURITY_FABRICATED');
  invariant(activation.minimumLeadMs === 86_400_000, 'VE2_ACTIVATION_LEAD');
  invariant(activation.startBoundary === 'UTC_MIDNIGHT', 'VE2_ACTIVATION_BOUNDARY');
  invariant(activation.durationMs === 2_592_000_000, 'VE2_INTERVAL_DURATION');
  invariant(activation.maturityLagMs === 62_000, 'VE2_MATURITY_LAG');
  invariant(activation.fabricatedStartForbidden === true, 'VE2_FABRICATED_START_RULE');
  invariant(policy.warmup.durationMs === 14_400_000, 'VE2_WARMUP_DURATION');
  invariant(policy.warmup.scored === false, 'VE2_WARMUP_SCORING');
  invariant(policy.warmup.outcomeAccess === 'FORBIDDEN', 'VE2_WARMUP_OUTCOME');

  invariant(
    policy.universe.mode === 'PROSPECTIVE_ACCEPTED_DETECTOR_PROPOSALS',
    'VE2_UNIVERSE_MODE',
  );
  invariant(policy.universe.symbols === null, 'VE2_UNIVERSE_FABRICATED_SYMBOLS');
  invariant(policy.universe.smokeSymbol === 'BTCUSDT', 'VE2_SMOKE_SYMBOL');
  invariant(policy.universe.smokeSymbolExcludedFromUniverseClaim === true, 'VE2_SMOKE_UNIVERSE_CLAIM');
  invariant(policy.universe.proposalOrigin === 'VOLUME_DETECTOR', 'VE2_UNIVERSE_ORIGIN');
  invariant(
    policy.universe.proposalCapturedProspectivelyRequired === true,
    'VE2_UNIVERSE_PROSPECTIVE',
  );
  invariant(
    policy.universe.completeAcceptedProposalSetRequired === true,
    'VE2_UNIVERSE_COMPLETE_SET',
  );
  invariant(policy.universe.nonPseudoProposalRequired === true, 'VE2_UNIVERSE_NON_PSEUDO');
  invariant(
    policy.universe.pointInTimeEligibilitySnapshotChecksummed === true,
    'VE2_UNIVERSE_CHECKSUM',
  );
  invariant(policy.universe.pointInTimeExchangeInfoRequired === true, 'VE2_UNIVERSE_FILTERS');
  invariant(policy.universe.substitutionForbidden === true, 'VE2_UNIVERSE_SUBSTITUTION');
  invariant(
    !JSON.stringify(policy.universe).includes('3000000')
      && !JSON.stringify(policy.universe).includes('24h'),
    'VE2_UNIVERSE_INVENTED_THRESHOLD',
  );

  invariant(policy.publicCapture.restOrigin === 'https://data-api.binance.vision', 'VE2_REST_ORIGIN');
  invariant(
    policy.publicCapture.webSocketOrigin === 'wss://data-stream.binance.vision:443',
    'VE2_WS_ORIGIN',
  );
  invariant(
    JSON.stringify(policy.publicCapture.restGets) === JSON.stringify([
      '/api/v3/exchangeInfo',
      '/api/v3/depth?symbol=<eligible-symbol>&limit=100',
    ]),
    'VE2_REST_GETS',
  );
  invariant(
    JSON.stringify(policy.publicCapture.streams) === JSON.stringify([
      '<eligible-symbol-lowercase>@depth@100ms',
      '<eligible-symbol-lowercase>@aggTrade',
      '<eligible-symbol-lowercase>@trade',
      '<eligible-symbol-lowercase>@bookTicker',
    ]),
    'VE2_STREAMS',
  );
  invariant(policy.publicCapture.timestampUnit === 'MILLISECOND', 'VE2_TIMESTAMP_UNIT');
  invariant(policy.publicCapture.timestampConversion === 'FORBIDDEN', 'VE2_TIMESTAMP_CONVERSION');
  invariant(policy.publicCapture.receiptClock === 'process.hrtime.bigint', 'VE2_RECEIPT_CLOCK');
  invariant(policy.publicCapture.continuityRequired === true, 'VE2_CONTINUITY');
  invariant(policy.publicCapture.silentGapFillForbidden === true, 'VE2_GAP_FILL');
  invariant(policy.publicCapture.currentBookHistorySubstitutionForbidden === true, 'VE2_BOOK_HISTORY');

  const binding = policy.detectorBinding;
  invariant(binding.required === true, 'VE2_DETECTOR_BINDING');
  invariant(binding.proposalOrigin === 'VOLUME_DETECTOR', 'VE2_PROPOSAL_ORIGIN');
  invariant(binding.evaluationCutPeriodMs === 2_000, 'VE2_CUT_PERIOD');
  invariant(binding.entryQuoteNotional === '10.00', 'VE2_ENTRY_NOTIONAL');
  invariant(binding.entryQuoteAsset === 'USDT', 'VE2_ENTRY_QUOTE');
  invariant(binding.maximumHoldMs === 60_000, 'VE2_MAX_HOLD');
  invariant(binding.partialDepthPolicy === 'REJECT_LIFECYCLE_NO_PARTIAL_ECONOMICS', 'VE2_PARTIAL_POLICY');

  invariant(policy.economics.sourceNativeFeeState === 'UNKNOWN', 'VE2_SOURCE_FEE');
  invariant(policy.economics.sourceNativeEconomicsState === 'NOT_ESTIMABLE', 'VE2_SOURCE_ECONOMICS');
  invariant(
    JSON.stringify(policy.economics.scenarios) === JSON.stringify([
      {
        id: 'PUBLIC_10_BPS_PER_SIDE',
        entryFeeBps: 10,
        exitFeeBps: 10,
        roundTripFeeBps: 20,
        accountEffective: false,
      },
      {
        id: 'PUBLIC_12_BPS_PER_SIDE_STRESS',
        entryFeeBps: 12,
        exitFeeBps: 12,
        roundTripFeeBps: 24,
        accountEffective: false,
      },
    ]),
    'VE2_FEE_SCENARIOS',
  );
  invariant(policy.economics.outcomeAccessBeforeMaturity === 'FORBIDDEN', 'VE2_OUTCOME_ACCESS');
  invariant(policy.economics.partialIntervalEconomics === 'FORBIDDEN', 'VE2_PARTIAL_ECONOMICS');
  invariant(policy.economics.smokeEconomics === 'FORBIDDEN', 'VE2_SMOKE_ECONOMICS');
  invariant(
    policy.economics.smokeExclusion ===
      'SMOKE_MECHANICS_ONLY — validates capture, schema, clocks, chain/dedupe, checksums, and serialization using synthetic or pre-interval data. Smoke rows are permanently excluded from the VE2 universe, sample counts, economics, uncertainty, N-3, and every profitability or capacity claim. A passing smoke is not a strategy sample, fill, return, fee or slippage measurement, drawdown, capacity proof, edge, or execution authority.',
    'VE2_SMOKE_EXCLUSION',
  );

  invariant(policy.evidence.format === 'APPEND_ONLY_CHECKSUM_CHAINED_JSONL', 'VE2_EVIDENCE_FORMAT');
  invariant(policy.evidence.networkFreeDeterministicReplayRequired === true, 'VE2_NETWORK_FREE_REPLAY');
  invariant(policy.evidence.submitAuthority === false, 'VE2_SUBMIT_AUTHORITY');
  invariant(policy.evidence.casAuthority === false, 'VE2_CAS_AUTHORITY');
  invariant(policy.evidence.privateOrSignedAuthority === false, 'VE2_PRIVATE_AUTHORITY');
  invariant(policy.evidence.orderTransferWithdrawalMoneyAuthority === false, 'VE2_MONEY_AUTHORITY');

  invariant(policy.consumerGate.consumer === 'N-3', 'VE2_CONSUMER');
  invariant(
    policy.consumerGate.state === 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
    'VE2_CONSUMER_GATE',
  );
  invariant(policy.consumerGate.smokeCannotOpenGate === true, 'VE2_SMOKE_GATE');
  invariant(policy.defaults.strategyEnabled === false, 'VE2_DEFAULT_OFF');
  invariant(policy.defaults.killSwitchEngaged === true, 'VE2_KILL_ON');
  invariant(policy.defaults.mode === 'SHADOW_ONLY', 'VE2_MODE');
  invariant(policy.defaults.recordOnly === true, 'VE2_RECORD_ONLY');
}

function verifySchemas(packetDir, policy) {
  const activation = readJson(resolve(packetDir, 'activation.schema.v1.json'));
  const manifest = readJson(resolve(packetDir, 'capture-manifest.schema.v1.json'));
  const outcomeOpen = readJson(resolve(packetDir, 'outcome-open.schema.v1.json'));
  invariant(
    policy.activation.activationEvidenceSchema === 've2.capture-activation.v1',
    'VE2_ACTIVATION_SCHEMA_REFERENCE',
  );
  invariant(
    policy.activation.terminalManifestSchema === 've2.capture-manifest.v1',
    'VE2_MANIFEST_SCHEMA_REFERENCE',
  );
  invariant(
    policy.activation.outcomeOpenReceiptSchema === 've2.outcome-open-receipt.v1',
    'VE2_OUTCOME_OPEN_SCHEMA_REFERENCE',
  );
  invariant(
    activation.properties.schemaVersion.const === 've2.capture-activation.v1',
    'VE2_ACTIVATION_SCHEMA',
  );
  invariant(
    activation.properties.outcomeBytesAccessed.const === false,
    'VE2_ACTIVATION_OUTCOME_ACCESS',
  );
  invariant(
    activation.properties.consumerGate.const ===
      'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
    'VE2_ACTIVATION_GATE',
  );
  invariant(
    activation.properties.sampleUniverse.properties.mode.const
      === 'PROSPECTIVE_ACCEPTED_DETECTOR_PROPOSALS',
    'VE2_ACTIVATION_UNIVERSE_SCHEMA',
  );
  invariant(
    activation.properties.packetMeasurementPolicySha256.pattern
      === '^[a-f0-9]{64}$'
      && activation.properties.detectorCoverageCorePolicyDigest.pattern
        === '^sha256:[a-f0-9]{64}$'
      && activation.properties.detectorInputSourceDigest.pattern
        === '^sha256:[a-f0-9]{64}$',
    'VE2_ACTIVATION_SOURCE_BINDING_SCHEMA',
  );
  invariant(
    manifest.properties.schemaVersion.const === 've2.capture-manifest.v1',
    'VE2_MANIFEST_SCHEMA',
  );
  invariant(
    manifest.properties.evidenceSchema.const ===
      'cosmos.engine.volume.forward-measurement-evidence.v1',
    'VE2_MANIFEST_EVIDENCE_SCHEMA',
  );
  invariant(manifest.properties.smokeRowsIncluded.const === 0, 'VE2_MANIFEST_SMOKE');
  invariant(manifest.properties.complete.const === true, 'VE2_MANIFEST_COMPLETE');
  invariant(
    manifest.properties.evidenceSegmentInventorySha256.pattern
      === '^sha256:[a-f0-9]{64}$',
    'VE2_MANIFEST_SEGMENT_INVENTORY_SCHEMA',
  );
  invariant(
    manifest.properties.warmupRowsIncludedInScoredSample.const === 0
      && manifest.properties.outcomeBytesAccessedBeforeMaturity.const
        === false,
    'VE2_MANIFEST_OUTCOME_FENCE',
  );
  for (const name of [
    'acceptedDetectorProposalCount',
    'nonPseudoDetectorProposalCount',
    'proposalEligibilitySnapshotCount',
    'lifecycleProposalCount',
  ]) {
    invariant(
      manifest.properties[name].minimum === 0,
      `VE2_MANIFEST_ZERO_SAMPLE_SCHEMA:${name}`,
    );
  }
  invariant(
    JSON.stringify(manifest.properties.proposalSampleState.enum)
      === JSON.stringify([
        'NO_ACCEPTED_PROPOSALS',
        'ACCEPTED_PROPOSALS_RECORDED',
      ])
      && manifest.properties.economicsState.const === 'UNKNOWN',
    'VE2_MANIFEST_SAMPLE_STATE_SCHEMA',
  );
  invariant(
    manifest.properties.lifecycleReplayPerformed.const === true,
    'VE2_MANIFEST_REPLAY',
  );
  invariant(
    manifest.properties.detectorCoverageState.const
      === 'COMPLETE_EXACT_PARTITION'
      && manifest.properties.detectorSegmentGapCount.const === 0
      && manifest.properties.detectorSegmentOverlapCount.const === 0
      && manifest.properties.missingDetectorCutCount.const === 0
      && manifest.properties.sourceUncoveredDurationMs.const === 0
      && manifest.properties.coreReplaySourceMechanics.const
        === 'EXACT_CANONICAL_RECOMPUTED'
      && manifest.$defs.evidenceSegment.properties.profile.const
        === 'TERMINAL_SEGMENT'
      && manifest.$defs.evidenceSegment.properties.consumerGate.const
        === 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
    'VE2_MANIFEST_SEGMENT_SCHEMA',
  );
  invariant(
    manifest.properties.profitabilityClaim.const === false,
    'VE2_MANIFEST_PROFITABILITY',
  );
  for (const name of [
    'privateOrSignedCalls',
    'orders',
    'transfers',
    'withdrawals',
    'moneyUsd',
  ]) {
    invariant(
      manifest.properties.externalEffects.properties[name].const === 0,
      `VE2_MANIFEST_EFFECT:${name}`,
    );
  }
  invariant(
    outcomeOpen.properties.schemaVersion.const ===
      've2.outcome-open-receipt.v1',
    'VE2_OUTCOME_OPEN_SCHEMA',
  );
  invariant(outcomeOpen.properties.priorOutcomeOpenCount.const === 0, 'VE2_OUTCOME_PRIOR_OPEN');
  invariant(outcomeOpen.properties.outcomeOpenCount.const === 1, 'VE2_OUTCOME_OPEN_COUNT');
  invariant(
    outcomeOpen.properties.openLockId.pattern
      === '^ve2_open_once_[a-f0-9]{64}$',
    'VE2_OUTCOME_OPEN_LOCK',
  );
}

function verifySources(catalog) {
  invariant(catalog.schemaVersion === 've2.official-sources.v1', 'VE2_SOURCES_SCHEMA');
  invariant(catalog.inspectedAt === '2026-07-28', 'VE2_SOURCES_DATE');
  invariant(catalog.repository === 'binance/binance-spot-api-docs', 'VE2_SOURCES_REPO');
  invariant(
    catalog.headAtInspection === '6b8372cad7cecbdf5dd88a3372eafff51988c5cf',
    'VE2_SOURCES_HEAD',
  );
  const expected = new Map([
    ['web-socket-streams.md', [22958, '32bf73a0bed3b75e3ca981fdbaf48c53544bbdfb5944ef8ed1c4d7af9aceba0a']],
    ['rest-api.md', [181189, '49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999']],
    ['filters.md', [13528, '4b5a8f0f5d15bcf68fd7ac2059ba6c88da641c06fd7885e642330c5ac8124dd3']],
    ['faqs/market_data_only.md', [1616, '57d608507426215c43f11907c07ed693f02725840d9ee4d6630f134de402b6da']],
  ]);
  invariant(catalog.sources.length === expected.size, 'VE2_SOURCE_COUNT');
  for (const source of catalog.sources) {
    invariant(source.official === true, `VE2_SOURCE_NOT_OFFICIAL:${source.id}`);
    invariant(expected.has(source.path), `VE2_SOURCE_PATH:${source.id}`);
    const [bytes, hash] = expected.get(source.path);
    invariant(source.bytes === bytes, `VE2_SOURCE_BYTES:${source.id}`);
    invariant(source.sha256 === hash, `VE2_SOURCE_HASH:${source.id}`);
    invariant(source.url.includes(catalog.headAtInspection), `VE2_SOURCE_URL_NOT_PINNED:${source.id}`);
    invariant(source.rawUrl.includes(catalog.headAtInspection), `VE2_SOURCE_RAW_NOT_PINNED:${source.id}`);
    invariant(
      source.rawUrl.startsWith('https://raw.githubusercontent.com/binance/'),
      `VE2_SOURCE_RAW_NOT_OFFICIAL:${source.id}`,
    );
  }
  invariant(
    catalog.captureAllowlist.rest.origin === 'https://data-api.binance.vision',
    'VE2_SOURCE_REST_ALLOWLIST',
  );
  invariant(catalog.captureAllowlist.rest.method === 'GET', 'VE2_SOURCE_METHOD');
  invariant(catalog.captureAllowlist.rest.redirects === 'FORBIDDEN', 'VE2_SOURCE_REDIRECT');
  invariant(catalog.captureAllowlist.rest.authentication === 'FORBIDDEN', 'VE2_SOURCE_AUTH');
  invariant(
    JSON.stringify(catalog.captureAllowlist.rest.paths)
      === JSON.stringify(['/api/v3/exchangeInfo', '/api/v3/depth']),
    'VE2_SOURCE_REST_PATHS',
  );
  invariant(
    catalog.captureAllowlist.webSocket.origin === 'wss://data-stream.binance.vision:443',
    'VE2_SOURCE_WS_ALLOWLIST',
  );
  invariant(
    JSON.stringify(catalog.captureAllowlist.webSocket.streams) === JSON.stringify([
      '<symbol>@depth@100ms',
      '<symbol>@aggTrade',
      '<symbol>@trade',
      '<symbol>@bookTicker',
    ]),
    'VE2_SOURCE_WS_STREAMS',
  );
  invariant(catalog.mappingBoundary.publicSmoke === 'SMOKE_MECHANICS_ONLY', 'VE2_SOURCE_SMOKE');
  invariant(catalog.mappingBoundary.historicalSubstitution === 'FORBIDDEN', 'VE2_SOURCE_HISTORY');
}

function verifyPrograms(packetDir) {
  const smoke = readFileSync(resolve(packetDir, 'smoke-capture.mjs'), 'utf8');
  const replay = readFileSync(resolve(packetDir, 'replay.mjs'), 'utf8');
  const evidence = readFileSync(resolve(packetDir, 'evidence-chain.mjs'), 'utf8');
  const readme = readFileSync(resolve(packetDir, 'README.md'), 'utf8');

  const smokeMarkers = [
    "'--run-public-smoke'",
    "'VE2_SMOKE_OPT_IN_REQUIRED'",
    "'https://data-api.binance.vision'",
    "'wss://data-stream.binance.vision:443'",
    "'COMBINED_URL'",
    '/stream?streams=${streams.join',
    '`/api/v3/depth?symbol=${encodeURIComponent(options.symbol)}&limit=100`',
    '`${lower}@depth@100ms`',
    '`${lower}@aggTrade`',
    '`${lower}@trade`',
    '`${lower}@bookTicker`',
    "'MILLISECOND'",
    'process.hrtime.bigint()',
    'createCoreEvidenceWriter',
    "kind: 'STREAM_FRAME'",
    'validateSmokeOptions',
    'readBoundedResponseBody',
    'aggregateTradeProofExact',
    'smokeProposalPrerequisitesExact',
    'socket.pause();',
    "'VE2_SMOKE_POLICY_SYMBOL_MISMATCH'",
    'captureTruncated',
    'transitionRevision: 2',
    'verifyPacketPolicyBinding',
    "kind: 'GENERATION_CLOSE'",
    'verification = writer.seal({',
    "verificationProfile: completeMeasurement",
    "'INCOMPLETE_PRESERVATION'",
    'unwrapCombinedStreamPayload',
    'classifySmokeMechanics',
    "redirect: 'error'",
    "method: 'GET'",
    'HARD_MAX_DURATION_MS = 20_000',
    'HARD_MAX_GENERATIONS = 2',
    "purpose: 'SMOKE_MECHANICS_ONLY'",
    "profitabilityClaim: 'FORBIDDEN'",
    "'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED'",
  ];
  for (const marker of smokeMarkers) {
    invariant(smoke.includes(marker), `VE2_SMOKE_MARKER:${marker}`);
  }
  invariant(!smoke.includes('api.binance.com'), 'VE2_SMOKE_NON_MARKET_DATA_ORIGIN');
  invariant(!smoke.includes('X-MBX-APIKEY'), 'VE2_SMOKE_API_KEY');
  invariant(!smoke.includes('Authorization'), 'VE2_SMOKE_AUTHORIZATION');
  invariant(!smoke.includes('/api/v3/order'), 'VE2_SMOKE_ORDER_PATH');
  invariant(!smoke.includes('response.arrayBuffer()'), 'VE2_SMOKE_UNBOUNDED_HTTP_READ');
  invariant(!smoke.includes("method: 'SUBSCRIBE'"), 'VE2_SMOKE_LIVE_SUBSCRIBE');
  invariant(!smoke.includes("new URL('/ws'"), 'VE2_SMOKE_RAW_WS_PATH');
  invariant(
    smoke.indexOf('socket.pause();')
      < smoke.indexOf('proposalTimer = setTimeout(() =>'),
    'VE2_SMOKE_PROPOSAL_SOURCE_CUT_NOT_PAUSED',
  );
  invariant(
    !smoke.includes('if (mutable.proposalFeatureCut === null)'),
    'VE2_SMOKE_TWO_FRAME_PROPOSAL_CUT',
  );

  const replayMarkers = [
    'parseCoreEvidenceFile',
    'decodeCoreEvidenceRawBytes',
    "mode === 'SHADOW_ONLY'",
    'result.recordOnly === true',
    'result.strategyEnabled === false',
    'result.killSwitchEngaged === true',
    'result.submitAuthority === false',
    'result.casAuthority === false',
    'result.privateOrSignedCalls === 0',
    'result.orders === 0',
    'result.moneyUsd === 0',
    'DEFAULT_CORE_REPLAY_MODULE',
    'FROZEN_PACKET_RULES',
    'VE2_REPLAY_OPTION_FORBIDDEN',
    'expectedPolicyDigest',
    'expectedTerminalHash',
    'checked.replayProfile',
    'checked.segmentFacts',
    "'TRUSTED_ANCHOR_MATCHED'",
  ];
  for (const marker of replayMarkers) {
    invariant(replay.includes(marker), `VE2_REPLAY_MARKER:${marker}`);
  }
  invariant(!replay.includes('node:http'), 'VE2_REPLAY_HTTP_IMPORT');
  invariant(!replay.includes('node:https'), 'VE2_REPLAY_HTTPS_IMPORT');
  invariant(!replay.includes('globalThis.fetch'), 'VE2_REPLAY_GLOBAL_FETCH_MUTATION');
  invariant(!replay.includes("'adapter'"), 'VE2_REPLAY_CUSTOM_ADAPTER');
  invariant(
    evidence.includes('server/dist/engine/volume/forwardMeasurementEvidence.js'),
    'VE2_CORE_EVIDENCE_DIST_ADAPTER',
  );
  invariant(
    evidence.includes('startVolumeForwardMeasurementEvidenceChain'),
    'VE2_CORE_EVIDENCE_START',
  );
  invariant(
    evidence.includes('appendVolumeForwardMeasurementEvidence'),
    'VE2_CORE_EVIDENCE_APPEND',
  );
  invariant(
    evidence.includes('sealVolumeForwardMeasurementEvidenceChain'),
    'VE2_CORE_EVIDENCE_SEAL',
  );
  invariant(
    evidence.includes('parseVolumeForwardMeasurementEvidenceJsonl'),
    'VE2_CORE_EVIDENCE_PARSE',
  );
  invariant(
    evidence.includes('readBoundedUtf8File')
      && evidence.includes('initialStat.isFile()')
      && !evidence.includes('readFileSync'),
    'VE2_CORE_EVIDENCE_BOUNDED_READ',
  );
  invariant(
    evidence.includes('VE2_CORE_EVIDENCE_MODULE_OVERRIDE_FORBIDDEN')
      && evidence.includes('VE2_CORE_MEASUREMENT_MODULE_OVERRIDE_FORBIDDEN')
      && evidence.includes('buildVolumeForwardDetectorProposalBinding')
      && evidence.includes('parseVolumeForwardPublicPayload')
      && !evidence.includes('coreModulePath'),
    'VE2_CORE_MODULE_PIN',
  );
  invariant(
    evidence.includes('requireMeasurementBundle'),
    'VE2_CORE_EVIDENCE_BUNDLE_PROFILE',
  );
  invariant(
    evidence.includes('expectedPolicyDigest')
      && evidence.includes('expectedTerminalHash'),
    'VE2_CORE_EVIDENCE_TRUSTED_ANCHORS',
  );
  invariant(
    !evidence.includes('ve2.raw-evidence'),
    'VE2_DUPLICATE_EVIDENCE_SCHEMA',
  );
  invariant(
    readme.includes('SMOKE_MECHANICS_ONLY — validates capture, schema, clocks, chain/dedupe,'),
    'VE2_README_SMOKE_EXCLUSION',
  );
  invariant(
    readme.includes('`BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED`'),
    'VE2_README_GATE',
  );
  invariant(
    readme.includes('--expected-policy-digest')
      && readme.includes('--expected-terminal-hash'),
    'VE2_README_TRUSTED_ANCHORS',
  );

  for (const name of ['evidence-chain.mjs', 'replay.mjs', 'smoke-capture.mjs', 'verify.mjs']) {
    execFileSync(process.execPath, ['--check', resolve(packetDir, name)], { stdio: 'ignore' });
  }
}

export function verifyPacket(packetDir = HERE, repoRoot = resolve(HERE, '../../..')) {
  verifyChecksums(packetDir);
  verifyFrozenJson(packetDir);
  const policy = readJson(resolve(packetDir, 'measurement-policy.v1.json'));
  const sources = readJson(resolve(packetDir, 'official-sources.v1.json'));
  verifyBaseCandidate(repoRoot, policy);
  verifyPolicy(policy);
  verifySchemas(packetDir, policy);
  verifySources(sources);
  verifyPrograms(packetDir);
  return Object.freeze({
    policyId: policy.policyId,
    activation: policy.activation.state,
    consumerGate: policy.consumerGate.state,
    publicSources: sources.sources.length,
    externalEffects: 0,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyPacket();
  process.stdout.write(
    `VE2_VERIFY PASS policy=${result.policyId} activation=${result.activation} gate=${result.consumerGate} sources=${result.publicSources} effects=${result.externalEffects}\n`,
  );
}

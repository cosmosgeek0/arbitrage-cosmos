#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  armScheduledCapture,
  buildScheduledCaptureHandoff,
  currentProspectiveStatus,
  frozenTerminalBoundary,
  runnerScheduleFromHandoff,
  validateScheduledCaptureHandoff,
  V_I3_FROZEN_TERMINAL_METRICS_POLICY_SHA256,
} from './terminal-runner.mjs';
import {
  buildDurableId,
  durableArtifactSha256,
} from './verify.mjs';

const ACCEPTED_AT = '2026-08-01T00:00:00.000Z';
const WARMUP_START = '2026-08-01T20:00:00.000Z';
const INTERVAL_START = '2026-08-02T00:00:00.000Z';
const INTERVAL_END = '2026-09-01T00:00:00.000Z';
const MATURITY = '2026-09-01T00:01:02.000Z';
const CANDIDATE = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const CAPTURE_IMPLEMENTATION_SHA256 = 'c'.repeat(64);
const PACKET_POLICY_SHA256 = 'd'.repeat(64);
const CORE_POLICY_DIGEST = `sha256:${'e'.repeat(64)}`;
const SOURCE_DIGEST = `sha256:${'f'.repeat(64)}`;
const CHAIN_KEY = `ve2_detector_coverage_${'1'.repeat(64)}`;
const V_I3_CHECKSUM_FILE_SHA256 = '2'.repeat(64);
const METRICS_POLICY = JSON.parse(
  readFileSync(
    new URL('./terminal-metrics-policy.v1.json', import.meta.url),
    'utf8',
  ),
);
const METRICS_POLICY_SHA256 = durableArtifactSha256(METRICS_POLICY);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function activationFixture() {
  const semantic = {
    schemaVersion: 've2.capture-activation.v1',
    state: 'CAPTURE_READY_ACCEPTED',
    acceptedCaptureCandidateCommit: CANDIDATE,
    acceptedAtUtc: ACCEPTED_AT,
    acceptedByIndependentExactHashReview: true,
    packetMeasurementPolicySha256: PACKET_POLICY_SHA256,
    detectorCoverageCorePolicyDigest: CORE_POLICY_DIGEST,
    detectorInputSourceId:
      'local://volume-engine/detector-evaluation-cut/v1',
    detectorInputSourceDigest: SOURCE_DIGEST,
    detectorBindingState: 'ACCEPTED_PROSPECTIVE_BINDING',
    detectorCoverageChainKey: CHAIN_KEY,
    captureImplementationSha256: CAPTURE_IMPLEMENTATION_SHA256,
    warmupStartUtc: WARMUP_START,
    intervalStartUtc: INTERVAL_START,
    intervalEndExclusiveUtc: INTERVAL_END,
    maturityAtUtc: MATURITY,
    sampleUniverse: {
      mode: 'PROSPECTIVE_ACCEPTED_DETECTOR_PROPOSALS',
      proposalOrigin: 'VOLUME_DETECTOR',
      prospectiveCaptureRequired: true,
      nonPseudoRequired: true,
      pointInTimeEligibilityRequired: true,
      currentStateSubstitutionForbidden: true,
    },
    outcomeBytesAccessed: false,
    consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
  };
  return {
    activationId: buildDurableId('ve2_activation_', semantic),
    ...semantic,
  };
}

function acceptanceReceiptFixture() {
  return {
    schemaVersion: 'vi3.capture-ready-acceptance.v1',
    verdict: 'ACCEPT',
    independentExactHashReview: true,
    acceptedCaptureCandidateCommit: CANDIDATE,
    acceptedCaptureCandidateTree: TREE,
    directParentCommit:
      '285810ec3264a6a9edd61c283f809ae6291f1c83',
    baseMeasurementTree:
      '316b560a33477547197ece86a333f54ebc8605ef',
    acceptedAtUtc: ACCEPTED_AT,
    captureImplementationSha256: CAPTURE_IMPLEMENTATION_SHA256,
    packetMeasurementPolicySha256: PACKET_POLICY_SHA256,
    detectorCoverageCorePolicyDigest: CORE_POLICY_DIGEST,
    detectorInputSourceId:
      'local://volume-engine/detector-evaluation-cut/v1',
    detectorInputSourceDigest: SOURCE_DIGEST,
    detectorCoverageChainKey: CHAIN_KEY,
    terminalMetricsPolicySha256: METRICS_POLICY_SHA256,
    vI3ChecksumFileSha256: V_I3_CHECKSUM_FILE_SHA256,
    outcomeBytesAccessed: false,
  };
}

function receiptBytes(receipt = acceptanceReceiptFixture()) {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

function handoffFixture() {
  const acceptanceReceiptUtf8 = receiptBytes();
  return buildScheduledCaptureHandoff({
    acceptanceReceiptUtf8,
    expectedAcceptanceReceiptSha256:
      sha256(Buffer.from(acceptanceReceiptUtf8, 'utf8')),
    activation: activationFixture(),
    evidenceRoot: resolve(tmpdir(), 'cosmos-vi3-forward-evidence'),
    terminalMetricsPolicy: METRICS_POLICY,
  });
}

test('default executable status remains OFF and honestly UNMEASURED', () => {
  assert.deepEqual(currentProspectiveStatus(), {
    state: 'PROSPECTIVE_NOT_ACTIVATED',
    verdict: 'UNMEASURED',
    reasonCode: 'CAPTURE_READY_ACCEPTANCE_AND_ACTIVATION_ABSENT',
    consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
    profitabilityClaim: false,
  });
});

test('handoff preserves raw acceptance custody and the exact V-I2 schedule', () => {
  const handoff = handoffFixture();
  assert.equal(validateScheduledCaptureHandoff(handoff), true);
  assert.equal(
    handoff.acceptanceReceiptSha256,
    sha256(Buffer.from(handoff.acceptanceReceiptUtf8, 'utf8')),
  );
  assert.equal(handoff.state, 'READY_NOT_STARTED');
  assert.equal(handoff.acceptedAtUtc, ACCEPTED_AT);
  assert.equal(handoff.schedule.scheduledCaptureStartUtc, WARMUP_START);
  assert.equal(handoff.schedule.admissionStartUtc, INTERVAL_START);
  assert.equal(
    handoff.schedule.admissionEndExclusiveUtc,
    INTERVAL_END,
  );
  assert.equal(handoff.schedule.captureStopNotBeforeUtc, MATURITY);
  assert.equal(handoff.schedule.terminalizeNotBeforeUtc, MATURITY);
  assert.equal(
    handoff.terminalMetricsPolicySha256,
    METRICS_POLICY_SHA256,
  );
  assert.equal(
    handoff.vI3ChecksumFileSha256,
    V_I3_CHECKSUM_FILE_SHA256,
  );
  assert.equal(handoff.controls.enabled, false);
  assert.equal(handoff.controls.killSwitchEngaged, true);
  assert.equal(handoff.controls.executionAuthority, 'NONE');
  assert.equal(handoff.controls.moneyAuthority, 'NONE');
  assert.equal(handoff.outcomeBytesAccessed, false);
  const schedule = runnerScheduleFromHandoff(handoff);
  assert.equal(
    schedule.intervalEndExclusiveMs - schedule.intervalStartMs,
    2_592_000_000,
  );
  assert.equal(
    schedule.maturityAtMs - schedule.intervalEndExclusiveMs,
    62_000,
  );
});

test('handoff refuses rewritten receipt bytes, self-dating, and shortened schedules', () => {
  const exactBytes = receiptBytes();
  assert.throws(() => buildScheduledCaptureHandoff({
    acceptanceReceiptUtf8: `${exactBytes}\n`,
    expectedAcceptanceReceiptSha256:
      sha256(Buffer.from(exactBytes, 'utf8')),
    activation: activationFixture(),
    evidenceRoot: resolve(tmpdir(), 'cosmos-vi3-forward-evidence'),
    terminalMetricsPolicy: METRICS_POLICY,
  }), /VI3_ACCEPTANCE_RECEIPT_CUSTODY/);

  const selfDated = acceptanceReceiptFixture();
  selfDated.acceptedAtUtc = '2026-08-01T00:00:01.000Z';
  const selfDatedBytes = receiptBytes(selfDated);
  assert.throws(() => buildScheduledCaptureHandoff({
    acceptanceReceiptUtf8: selfDatedBytes,
    expectedAcceptanceReceiptSha256:
      sha256(Buffer.from(selfDatedBytes, 'utf8')),
    activation: activationFixture(),
    evidenceRoot: resolve(tmpdir(), 'cosmos-vi3-forward-evidence'),
    terminalMetricsPolicy: METRICS_POLICY,
  }), /VI3_ACTIVATION_ACCEPTED_TIME_MISMATCH/);

  const shortened = structuredClone(handoffFixture());
  shortened.schedule.admissionEndExclusiveUtc =
    '2026-08-31T23:59:58.000Z';
  assert.throws(
    () => validateScheduledCaptureHandoff(shortened),
    /VE2_ACTIVATION|VI3_HANDOFF_INVALID|VI3_HANDOFF_DURABLE_ID/,
  );
});

test('predeclared metrics are exact-hash frozen and never classify pre-terminal data', () => {
  assert.equal(
    METRICS_POLICY_SHA256,
    V_I3_FROZEN_TERMINAL_METRICS_POLICY_SHA256,
  );
  const boundary = frozenTerminalBoundary();
  assert.equal(boundary.currentVerdict, 'UNMEASURED');
  assert.equal(
    boundary.currentReason,
    'FULL_VALIDATED_TERMINAL_BUNDLE_NOT_PRESENT',
  );
  assert.match(
    boundary.futurePublicScenarioBoundary.noGo,
    /less than or equal to 0/,
  );
  assert.match(
    boundary.futurePublicScenarioBoundary.go,
    /strictly greater than 0/,
  );
  assert.match(
    boundary.futurePublicScenarioBoundary.zero,
    /NO_GO/,
  );
  assert.equal(boundary.accountEffectiveFeeState, 'UNKNOWN');
  assert.equal(boundary.capacityBeyond10, 'UNKNOWN');
  assert.equal(boundary.supports1000QuoteNotional, 'UNKNOWN');
  assert.equal(boundary.profitabilityClaim, false);
});

test('an internally consistent but externally untrusted handoff cannot arm capture', async () => {
  const handoff = handoffFixture();
  await assert.rejects(
    armScheduledCapture({ handoff }),
    /VI3_TRUSTED_HANDOFF_REQUIRED/,
  );
});

test('V-I3 runner sources have no private, signed, credential, submit, CAS, or money seam', () => {
  const sources = [
    resolve(HERE_FOR_TEST(), 'terminal-runner.mjs'),
    resolve(HERE_FOR_TEST(), 'accepted-capture-owner.mjs'),
    resolve(
      HERE_FOR_TEST(),
      '../../../server/src/engine/volume/forwardMeasurementDetectorSource.ts',
    ),
    resolve(
      HERE_FOR_TEST(),
      '../../../server/src/engine/volume/forwardMeasurementRunner.ts',
    ),
  ].map((path) => readFileSync(path, 'utf8')).join('\n');
  assert.doesNotMatch(
    sources,
    /(?:apiKey|apiSecret|authorization\s*:|createHmac|submitOrder|placeOrder|compareAndSet|privateRead|\bwithdraw\s*\(|\btransfer\s*\()/i,
  );
  assert.doesNotMatch(
    sources,
    /(?:api\.binance\.com|stream\.binance\.com|\bfetch\s*\(|\bnew\s+WebSocket\s*\()/i,
  );
  assert.match(sources, /https:\/\/data-api\.binance\.vision/);
  assert.match(sources, /wss:\/\/data-stream\.binance\.vision:443/);
});

function HERE_FOR_TEST() {
  return resolve(new URL('.', import.meta.url).pathname);
}

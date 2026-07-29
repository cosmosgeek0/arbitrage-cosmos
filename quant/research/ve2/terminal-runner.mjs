#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  durableArtifactSha256,
  validateActivationInstance,
} from './verify.mjs';
import { verifyV3Packet } from './verify-v-i3.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '../../..');
const TERMINAL_METRICS_POLICY_PATH =
  resolve(HERE, 'terminal-metrics-policy.v1.json');
const TERMINAL_METRICS_SCHEMA_PATH =
  resolve(HERE, 'terminal-metrics-policy.schema.v1.json');
const PACKET_MEASUREMENT_POLICY_PATH =
  resolve(HERE, 'measurement-policy.v1.json');
const DEFAULT_CORE_RUNNER_MODULE = resolve(
  HERE,
  'terminal-runner-core.bundle.mjs',
);
const DEFAULT_CAPTURE_OWNER_MODULE =
  resolve(HERE, 'accepted-capture-owner.mjs');
const BASE_MEASUREMENT_COMMIT =
  '285810ec3264a6a9edd61c283f809ae6291f1c83';
const BASE_MEASUREMENT_TREE =
  '316b560a33477547197ece86a333f54ebc8605ef';
const DETECTOR_SOURCE_ID =
  'local://volume-engine/detector-evaluation-cut/v1';
const FROZEN_TERMINAL_METRICS_POLICY_SHA256 =
  '78e30c081b52e21f604af86566fed293606f51b00cf38f6bddcacfe9a140c4c6';
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 128 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const PREFIXED_SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ABSOLUTE_SAFE_PATH = /^\/[^\u0000-\u001f\u007f]*$/;
const TRUSTED_HANDOFFS = new WeakSet();

export const V_I3_FROZEN_TERMINAL_METRICS_POLICY_SHA256 =
  FROZEN_TERMINAL_METRICS_POLICY_SHA256;

function invariant(condition, code) {
  if (!condition) throw new Error(code);
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
    invariant(
      Number.isSafeInteger(value) && !Object.is(value, -0),
      'VI3_CANONICAL_NUMBER',
    );
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  invariant(plainRecord(value), 'VI3_CANONICAL_OBJECT');
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(',')}}`;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalSha256(value) {
  return sha256(Buffer.from(`${canonicalJson(value)}\n`, 'utf8'));
}

function durableId(prefix, value) {
  return `${prefix}${sha256(Buffer.from(canonicalJson(value), 'utf8'))}`;
}

function withoutField(value, field) {
  invariant(plainRecord(value), 'VI3_DURABLE_OBJECT');
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== field),
  );
}

function readBoundedBytes(path, maximumBytes = MAX_JSON_BYTES) {
  const bytes = readFileSync(resolve(path));
  invariant(
    bytes.length > 0 && bytes.length <= maximumBytes,
    'VI3_JSON_FILE_BOUND',
  );
  return bytes;
}

function parseJsonBytes(bytes, code = 'VI3_JSON_FILE_INVALID') {
  let value;
  try {
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
  } catch {
    throw new Error(code);
  }
  invariant(plainRecord(value), 'VI3_JSON_OBJECT_REQUIRED');
  return value;
}

function readBoundedJson(path) {
  return parseJsonBytes(readBoundedBytes(path));
}

function isoMs(value, code) {
  invariant(
    typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value),
    code,
  );
  const parsed = Date.parse(value);
  invariant(
    Number.isSafeInteger(parsed)
      && new Date(parsed).toISOString() === value,
    code,
  );
  return parsed;
}

function validateMetricsPolicy(value) {
  const schema = readBoundedJson(TERMINAL_METRICS_SCHEMA_PATH);
  invariant(
    exactKeys(schema, ['$schema', '$id', 'title', 'const'])
      && schema.$id
        === 'https://cosmos.local/schemas/vi3.terminal-metrics-policy.v1.json'
      && canonicalJson(value) === canonicalJson(schema.const)
      && canonicalSha256(value)
        === FROZEN_TERMINAL_METRICS_POLICY_SHA256,
    'VI3_TERMINAL_METRICS_POLICY_INVALID',
  );
  return value;
}

function parseAcceptanceReceiptUtf8(value) {
  invariant(
    typeof value === 'string'
      && Buffer.byteLength(value, 'utf8') > 0
      && Buffer.byteLength(value, 'utf8') <= MAX_RECEIPT_BYTES,
    'VI3_ACCEPTANCE_RECEIPT_BYTES',
  );
  return parseJsonBytes(
    Buffer.from(value, 'utf8'),
    'VI3_ACCEPTANCE_RECEIPT_JSON',
  );
}

function validateAcceptanceReceipt(
  receipt,
  expectedAcceptanceReceiptSha256,
  acceptanceReceiptUtf8,
) {
  invariant(
    SHA256.test(expectedAcceptanceReceiptSha256)
      && sha256(Buffer.from(acceptanceReceiptUtf8, 'utf8'))
        === expectedAcceptanceReceiptSha256,
    'VI3_ACCEPTANCE_RECEIPT_CUSTODY',
  );
  invariant(exactKeys(receipt, [
    'schemaVersion',
    'verdict',
    'independentExactHashReview',
    'acceptedCaptureCandidateCommit',
    'acceptedCaptureCandidateTree',
    'directParentCommit',
    'baseMeasurementTree',
    'acceptedAtUtc',
    'captureImplementationSha256',
    'packetMeasurementPolicySha256',
    'detectorCoverageCorePolicyDigest',
    'detectorInputSourceId',
    'detectorInputSourceDigest',
    'detectorCoverageChainKey',
    'terminalMetricsPolicySha256',
    'vI3ChecksumFileSha256',
    'outcomeBytesAccessed',
  ]), 'VI3_ACCEPTANCE_RECEIPT_SHAPE');
  invariant(
    receipt.schemaVersion === 'vi3.capture-ready-acceptance.v1'
      && receipt.verdict === 'ACCEPT'
      && receipt.independentExactHashReview === true
      && receipt.directParentCommit === BASE_MEASUREMENT_COMMIT
      && receipt.baseMeasurementTree === BASE_MEASUREMENT_TREE
      && COMMIT.test(receipt.acceptedCaptureCandidateCommit)
      && COMMIT.test(receipt.acceptedCaptureCandidateTree)
      && SHA256.test(receipt.captureImplementationSha256)
      && SHA256.test(receipt.packetMeasurementPolicySha256)
      && PREFIXED_SHA256.test(
        receipt.detectorCoverageCorePolicyDigest,
      )
      && receipt.detectorInputSourceId === DETECTOR_SOURCE_ID
      && PREFIXED_SHA256.test(receipt.detectorInputSourceDigest)
      && /^ve2_detector_coverage_[a-f0-9]{64}$/.test(
        receipt.detectorCoverageChainKey,
      )
      && receipt.terminalMetricsPolicySha256
        === FROZEN_TERMINAL_METRICS_POLICY_SHA256
      && SHA256.test(receipt.vI3ChecksumFileSha256)
      && receipt.outcomeBytesAccessed === false,
    'VI3_ACCEPTANCE_RECEIPT_INVALID',
  );
  isoMs(receipt.acceptedAtUtc, 'VI3_ACCEPTANCE_RECEIPT_TIME');
  return receipt;
}

function activationTrustedContext(receipt) {
  return {
    expectedAcceptedCaptureCandidateCommit:
      receipt.acceptedCaptureCandidateCommit,
    expectedCaptureImplementationSha256:
      receipt.captureImplementationSha256,
    expectedPacketMeasurementPolicySha256:
      receipt.packetMeasurementPolicySha256,
    expectedDetectorCoverageCorePolicyDigest:
      receipt.detectorCoverageCorePolicyDigest,
    expectedDetectorInputSourceId:
      receipt.detectorInputSourceId,
    expectedDetectorInputSourceDigest:
      receipt.detectorInputSourceDigest,
    expectedDetectorCoverageChainKey:
      receipt.detectorCoverageChainKey,
  };
}

function safeEvidenceRoot(value) {
  invariant(
    typeof value === 'string'
      && isAbsolute(value)
      && ABSOLUTE_SAFE_PATH.test(value),
    'VI3_EVIDENCE_ROOT_ABSOLUTE_REQUIRED',
  );
  const normalized = resolve(value);
  invariant(
    normalized !== REPOSITORY_ROOT
      && !normalized.startsWith(`${REPOSITORY_ROOT}/`),
    'VI3_EVIDENCE_ROOT_INSIDE_REPOSITORY',
  );
  return normalized;
}

function buildHandoffSemantic({
  acceptanceReceiptSha256,
  acceptanceReceiptUtf8,
  activation,
  evidenceRoot,
  metricsSha256,
  receipt,
}) {
  const activationSha256 = durableArtifactSha256(activation);
  const captureId = durableId('ve2_capture_', {
    activationId: activation.activationId,
    acceptedCaptureCandidateCommit:
      receipt.acceptedCaptureCandidateCommit,
    detectorCoverageChainKey: receipt.detectorCoverageChainKey,
    terminalMetricsPolicySha256: metricsSha256,
  });
  return {
    schemaVersion: 'vi3.scheduled-capture-handoff.v1',
    captureId,
    state: 'READY_NOT_STARTED',
    acceptanceReceiptUtf8,
    acceptanceReceiptSha256,
    acceptedCaptureCandidateCommit:
      receipt.acceptedCaptureCandidateCommit,
    acceptedCaptureCandidateTree:
      receipt.acceptedCaptureCandidateTree,
    acceptedAtUtc: receipt.acceptedAtUtc,
    activation,
    activationSha256,
    terminalMetricsPolicySha256: metricsSha256,
    vI3ChecksumFileSha256: receipt.vI3ChecksumFileSha256,
    schedule: {
      warmupStartUtc: activation.warmupStartUtc,
      scheduledCaptureStartUtc: activation.warmupStartUtc,
      admissionStartUtc: activation.intervalStartUtc,
      admissionEndExclusiveUtc: activation.intervalEndExclusiveUtc,
      captureStopNotBeforeUtc: activation.maturityAtUtc,
      terminalizeNotBeforeUtc: activation.maturityAtUtc,
      detectorCadenceMs: 2_000,
      detectorCutsPerSegment: 99_998,
    },
    detector: {
      sourceId: receipt.detectorInputSourceId,
      sourceDigest: receipt.detectorInputSourceDigest,
      coverageCorePolicyDigest:
        receipt.detectorCoverageCorePolicyDigest,
      coverageChainKey: receipt.detectorCoverageChainKey,
    },
    evidenceRoot: safeEvidenceRoot(evidenceRoot),
    controls: {
      enabled: false,
      killSwitchEngaged: true,
      mode: 'SHADOW_ONLY',
      recordOnly: true,
      publicOnly: true,
      executionAuthority: 'NONE',
      submitAuthority: 'NONE',
      casAuthority: 'NONE',
      privateDataAuthority: 'NONE',
      signedRequestAuthority: 'NONE',
      keyAuthority: 'NONE',
      providerAuthority: 'NONE',
      hostAuthority: 'NONE',
      orderAuthority: 'NONE',
      transferAuthority: 'NONE',
      withdrawalAuthority: 'NONE',
      moneyAuthority: 'NONE',
    },
    explicitRunRequired: true,
    outcomeBytesAccessed: false,
    consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
  };
}

export function buildScheduledCaptureHandoff({
  acceptanceReceiptUtf8,
  expectedAcceptanceReceiptSha256,
  activation,
  evidenceRoot,
  terminalMetricsPolicy =
    validateMetricsPolicy(readBoundedJson(TERMINAL_METRICS_POLICY_PATH)),
}) {
  const receipt = validateAcceptanceReceipt(
    parseAcceptanceReceiptUtf8(acceptanceReceiptUtf8),
    expectedAcceptanceReceiptSha256,
    acceptanceReceiptUtf8,
  );
  const metrics = validateMetricsPolicy(terminalMetricsPolicy);
  const metricsSha256 = canonicalSha256(metrics);
  invariant(
    receipt.terminalMetricsPolicySha256 === metricsSha256,
    'VI3_TERMINAL_METRICS_POLICY_HASH_MISMATCH',
  );
  invariant(
    activation?.acceptedAtUtc === receipt.acceptedAtUtc,
    'VI3_ACTIVATION_ACCEPTED_TIME_MISMATCH',
  );
  validateActivationInstance(
    activation,
    activationTrustedContext(receipt),
  );
  const semantic = buildHandoffSemantic({
    acceptanceReceiptSha256:
      expectedAcceptanceReceiptSha256,
    acceptanceReceiptUtf8,
    activation,
    evidenceRoot,
    metricsSha256,
    receipt,
  });
  const handoff = Object.freeze({
    handoffId: durableId('vi3_handoff_', semantic),
    ...semantic,
  });
  validateScheduledCaptureHandoff(handoff);
  return handoff;
}

export function validateScheduledCaptureHandoff(handoff) {
  invariant(exactKeys(handoff, [
    'schemaVersion',
    'handoffId',
    'captureId',
    'state',
    'acceptanceReceiptUtf8',
    'acceptanceReceiptSha256',
    'acceptedCaptureCandidateCommit',
    'acceptedCaptureCandidateTree',
    'acceptedAtUtc',
    'activation',
    'activationSha256',
    'terminalMetricsPolicySha256',
    'vI3ChecksumFileSha256',
    'schedule',
    'detector',
    'evidenceRoot',
    'controls',
    'explicitRunRequired',
    'outcomeBytesAccessed',
    'consumerGate',
  ]), 'VI3_HANDOFF_SHAPE');
  const receipt = validateAcceptanceReceipt(
    parseAcceptanceReceiptUtf8(handoff.acceptanceReceiptUtf8),
    handoff.acceptanceReceiptSha256,
    handoff.acceptanceReceiptUtf8,
  );
  validateActivationInstance(
    handoff.activation,
    activationTrustedContext(receipt),
  );
  invariant(
    handoff.schemaVersion === 'vi3.scheduled-capture-handoff.v1'
      && /^vi3_handoff_[a-f0-9]{64}$/.test(handoff.handoffId)
      && /^ve2_capture_[a-f0-9]{64}$/.test(handoff.captureId)
      && handoff.state === 'READY_NOT_STARTED'
      && handoff.acceptanceReceiptSha256
        === sha256(Buffer.from(handoff.acceptanceReceiptUtf8, 'utf8'))
      && handoff.acceptedCaptureCandidateCommit
        === receipt.acceptedCaptureCandidateCommit
      && handoff.acceptedCaptureCandidateTree
        === receipt.acceptedCaptureCandidateTree
      && handoff.acceptedAtUtc === receipt.acceptedAtUtc
      && handoff.activationSha256
        === durableArtifactSha256(handoff.activation)
      && handoff.terminalMetricsPolicySha256
        === receipt.terminalMetricsPolicySha256
      && handoff.terminalMetricsPolicySha256
        === FROZEN_TERMINAL_METRICS_POLICY_SHA256
      && handoff.vI3ChecksumFileSha256
        === receipt.vI3ChecksumFileSha256
      && handoff.acceptedAtUtc === handoff.activation.acceptedAtUtc
      && handoff.acceptedCaptureCandidateCommit
        === handoff.activation.acceptedCaptureCandidateCommit
      && exactKeys(handoff.schedule, [
        'warmupStartUtc',
        'scheduledCaptureStartUtc',
        'admissionStartUtc',
        'admissionEndExclusiveUtc',
        'captureStopNotBeforeUtc',
        'terminalizeNotBeforeUtc',
        'detectorCadenceMs',
        'detectorCutsPerSegment',
      ])
      && handoff.schedule.warmupStartUtc
        === handoff.activation.warmupStartUtc
      && handoff.schedule.scheduledCaptureStartUtc
        === handoff.activation.warmupStartUtc
      && handoff.schedule.admissionStartUtc
        === handoff.activation.intervalStartUtc
      && handoff.schedule.admissionEndExclusiveUtc
        === handoff.activation.intervalEndExclusiveUtc
      && handoff.schedule.captureStopNotBeforeUtc
        === handoff.activation.maturityAtUtc
      && handoff.schedule.terminalizeNotBeforeUtc
        === handoff.activation.maturityAtUtc
      && handoff.schedule.detectorCadenceMs === 2_000
      && handoff.schedule.detectorCutsPerSegment === 99_998
      && exactKeys(handoff.detector, [
        'sourceId',
        'sourceDigest',
        'coverageCorePolicyDigest',
        'coverageChainKey',
      ])
      && handoff.detector.sourceId === DETECTOR_SOURCE_ID
      && handoff.detector.sourceDigest
        === handoff.activation.detectorInputSourceDigest
      && handoff.detector.coverageCorePolicyDigest
        === handoff.activation.detectorCoverageCorePolicyDigest
      && handoff.detector.coverageChainKey
        === handoff.activation.detectorCoverageChainKey
      && safeEvidenceRoot(handoff.evidenceRoot) === handoff.evidenceRoot
      && exactKeys(handoff.controls, [
        'enabled',
        'killSwitchEngaged',
        'mode',
        'recordOnly',
        'publicOnly',
        'executionAuthority',
        'submitAuthority',
        'casAuthority',
        'privateDataAuthority',
        'signedRequestAuthority',
        'keyAuthority',
        'providerAuthority',
        'hostAuthority',
        'orderAuthority',
        'transferAuthority',
        'withdrawalAuthority',
        'moneyAuthority',
      ])
      && handoff.controls.enabled === false
      && handoff.controls.killSwitchEngaged === true
      && handoff.controls.mode === 'SHADOW_ONLY'
      && handoff.controls.recordOnly === true
      && handoff.controls.publicOnly === true
      && Object.entries(handoff.controls).every(
        ([key, value]) => (
          !key.endsWith('Authority') || value === 'NONE'
        ),
      )
      && handoff.explicitRunRequired === true
      && handoff.outcomeBytesAccessed === false
      && handoff.consumerGate
        === 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
    'VI3_HANDOFF_INVALID',
  );
  const semantic = withoutField(handoff, 'handoffId');
  invariant(
    handoff.handoffId === durableId('vi3_handoff_', semantic),
    'VI3_HANDOFF_DURABLE_ID',
  );
  return true;
}

function gitOutput(args) {
  return execFileSync(
    'git',
    ['-C', REPOSITORY_ROOT, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

function verifyLocalAcceptedCandidate(receipt) {
  const head = gitOutput(['rev-parse', 'HEAD']);
  const tree = gitOutput(['rev-parse', 'HEAD^{tree}']);
  const parent = gitOutput(['rev-parse', 'HEAD^']);
  const baseTree = gitOutput([
    'rev-parse',
    `${BASE_MEASUREMENT_COMMIT}^{tree}`,
  ]);
  const status = gitOutput([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]);
  invariant(
    head === receipt.acceptedCaptureCandidateCommit
      && tree === receipt.acceptedCaptureCandidateTree
      && parent === BASE_MEASUREMENT_COMMIT
      && baseTree === BASE_MEASUREMENT_TREE
      && status === '',
    'VI3_LOCAL_ACCEPTED_CANDIDATE_MISMATCH',
  );
  const packet = verifyV3Packet(REPOSITORY_ROOT);
  invariant(
    packet.checksumFileSha256 === receipt.vI3ChecksumFileSha256,
    'VI3_LOCAL_PACKET_CHECKSUM_CUSTODY',
  );
  const packetPolicy = readBoundedJson(PACKET_MEASUREMENT_POLICY_PATH);
  invariant(
    durableArtifactSha256(packetPolicy)
      === receipt.packetMeasurementPolicySha256,
    'VI3_LOCAL_MEASUREMENT_POLICY_CUSTODY',
  );
  validateMetricsPolicy(readBoundedJson(TERMINAL_METRICS_POLICY_PATH));
  return true;
}

export function loadTrustedScheduledCaptureHandoff({
  handoffPath,
  expectedHandoffFileSha256,
  expectedAcceptanceReceiptSha256,
}) {
  invariant(
    SHA256.test(expectedHandoffFileSha256)
      && SHA256.test(expectedAcceptanceReceiptSha256),
    'VI3_EXTERNAL_CUSTODY_HASH_REQUIRED',
  );
  const bytes = readBoundedBytes(handoffPath);
  invariant(
    sha256(bytes) === expectedHandoffFileSha256,
    'VI3_HANDOFF_FILE_CUSTODY',
  );
  const handoff = parseJsonBytes(bytes);
  validateScheduledCaptureHandoff(handoff);
  invariant(
    handoff.acceptanceReceiptSha256
      === expectedAcceptanceReceiptSha256,
    'VI3_HANDOFF_ACCEPTANCE_CUSTODY',
  );
  const receipt = parseAcceptanceReceiptUtf8(
    handoff.acceptanceReceiptUtf8,
  );
  verifyLocalAcceptedCandidate(receipt);
  const frozen = deepFreeze(structuredClone(handoff));
  TRUSTED_HANDOFFS.add(frozen);
  return frozen;
}

function deepFreeze(value, seen = new Set()) {
  if (
    value === null
    || (typeof value !== 'object' && typeof value !== 'function')
    || seen.has(value)
  ) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function runnerScheduleFromHandoff(handoff) {
  validateScheduledCaptureHandoff(handoff);
  return Object.freeze({
    schemaVersion: 'volume.forward.scheduled-capture.v1',
    activationId: handoff.activation.activationId,
    captureId: handoff.captureId,
    detectorCoverageChainKey: handoff.detector.coverageChainKey,
    detectorCoverageCorePolicyDigest:
      handoff.detector.coverageCorePolicyDigest,
    detectorInputSourceId: handoff.detector.sourceId,
    detectorInputSourceDigest: handoff.detector.sourceDigest,
    packetMeasurementPolicySha256:
      handoff.activation.packetMeasurementPolicySha256,
    warmupStartMs: Date.parse(handoff.schedule.warmupStartUtc),
    intervalStartMs: Date.parse(handoff.schedule.admissionStartUtc),
    intervalEndExclusiveMs:
      Date.parse(handoff.schedule.admissionEndExclusiveUtc),
    maturityAtMs: Date.parse(handoff.schedule.captureStopNotBeforeUtc),
    detectorCadenceMs: handoff.schedule.detectorCadenceMs,
    detectorCutsPerSegment: handoff.schedule.detectorCutsPerSegment,
    controls: {
      enabled: false,
      killSwitchEngaged: true,
      mode: 'SHADOW_ONLY',
      recordOnly: true,
    },
  });
}

export async function armScheduledCapture({
  handoff,
  resume = false,
}) {
  invariant(
    TRUSTED_HANDOFFS.has(handoff) && typeof resume === 'boolean',
    'VI3_TRUSTED_HANDOFF_REQUIRED',
  );
  verifyLocalAcceptedCandidate(
    parseAcceptanceReceiptUtf8(handoff.acceptanceReceiptUtf8),
  );
  const [imported, ownerModule] = await Promise.all([
    import(pathToFileURL(DEFAULT_CORE_RUNNER_MODULE).href),
    import(pathToFileURL(DEFAULT_CAPTURE_OWNER_MODULE).href),
  ]);
  invariant(
    typeof imported.createVolumeForwardMeasurementRunner === 'function'
      && typeof ownerModule.createAcceptedCaptureOwner === 'function',
    'VI3_FIXED_CAPTURE_MODULE_EXPORT',
  );
  const owner = await ownerModule.createAcceptedCaptureOwner({
    handoff,
    resume,
  });
  const checkpoint = owner.loadRunnerCheckpoint();
  const priorGeneration = checkpoint?.runtimeGeneration ?? 0;
  invariant(
    Number.isSafeInteger(priorGeneration)
      && priorGeneration >= 0
      && priorGeneration < Number.MAX_SAFE_INTEGER,
    'VI3_CAPTURE_GENERATION_EXHAUSTED',
  );
  let runner;
  try {
    runner = imported.createVolumeForwardMeasurementRunner({
      schedule: runnerScheduleFromHandoff(handoff),
      sink: owner,
      ...(checkpoint === null ? {} : { checkpoint }),
    });
  } catch (error) {
    owner.close();
    throw error;
  }
  const captureGeneration = priorGeneration + 1;
  const observe = (cut) => {
    const snapshot = runner.observe(cut);
    if (snapshot.state === 'FAILED') {
      throw new Error(
        `VI3_CAPTURE_FAILED:${snapshot.reasonCodes.join(',')}`,
      );
    }
  };
  return Object.freeze({
    schemaVersion: 'vi3.armed-public-terminal-runner.v1',
    handoffId: handoff.handoffId,
    evidenceRoot: handoff.evidenceRoot,
    captureGeneration,
    volumeRuntimeOptions: Object.freeze({
      forwardMeasurementObserver: observe,
      forwardMeasurementRuntimeGeneration: captureGeneration,
    }),
    observe,
    advanceTime: (nowMs) => runner.advanceTime(nowMs),
    checkpoint: () => runner.checkpoint(),
    snapshot: () => runner.snapshot(),
    ownerSnapshot: () => owner.snapshot(),
    close: () => owner.close(),
  });
}

export function currentProspectiveStatus() {
  return Object.freeze({
    state: 'PROSPECTIVE_NOT_ACTIVATED',
    verdict: 'UNMEASURED',
    reasonCode: 'CAPTURE_READY_ACCEPTANCE_AND_ACTIVATION_ABSENT',
    consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
    profitabilityClaim: false,
  });
}

export function frozenTerminalBoundary() {
  const policy = validateMetricsPolicy(
    readBoundedJson(TERMINAL_METRICS_POLICY_PATH),
  );
  return Object.freeze({
    policySha256: FROZEN_TERMINAL_METRICS_POLICY_SHA256,
    currentVerdict: 'UNMEASURED',
    currentReason:
      'FULL_VALIDATED_TERMINAL_BUNDLE_NOT_PRESENT',
    futurePublicScenarioBoundary: Object.freeze({
      unmeasured: [...policy.verdict.UNMEASURED],
      noGo: policy.verdict.NO_GO,
      go: policy.verdict.GO,
      zero: policy.verdict.boundary,
    }),
    accountEffectiveVerdict: 'UNMEASURED',
    accountEffectiveFeeState: 'UNKNOWN',
    capacityBeyond10: 'UNKNOWN',
    supports1000QuoteNotional: 'UNKNOWN',
    profitabilityClaim: false,
    executionAuthority: 'NONE',
  });
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(
      descriptor,
      bytes,
      offset,
      bytes.length - offset,
    );
    invariant(written > 0, 'VI3_HANDOFF_SHORT_WRITE');
    offset += written;
  }
}

function writeExclusiveJson(path, value) {
  const output = resolve(path);
  invariant(
    output !== REPOSITORY_ROOT
      && !output.startsWith(`${REPOSITORY_ROOT}/`),
    'VI3_HANDOFF_OUTPUT_INSIDE_REPOSITORY',
  );
  const parent = realpathSync(dirname(output));
  const safeOutput = resolve(
    parent,
    output.slice(dirname(output).length + 1),
  );
  const bytes = Buffer.from(`${canonicalJson(value)}\n`, 'utf8');
  const descriptor = openSync(safeOutput, 'wx', 0o600);
  try {
    writeAll(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  return Object.freeze({
    path: safeOutput,
    sha256: sha256(bytes),
  });
}

function parseArgs(argv) {
  if (
    argv.length === 0
    || (argv.length === 1 && argv[0] === '--status')
  ) return { mode: 'status' };
  const options = {};
  let mode = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--prepare-handoff') {
      invariant(mode === null, 'VI3_MODE_CONFLICT');
      mode = 'prepare';
      continue;
    }
    if (argument === '--inspect-handoff') {
      invariant(mode === null, 'VI3_MODE_CONFLICT');
      mode = 'inspect';
      continue;
    }
    if ([
      '--acceptance-receipt',
      '--expected-acceptance-receipt-sha256',
      '--activation',
      '--evidence-root',
      '--handoff',
      '--expected-handoff-sha256',
      '--output',
    ].includes(argument)) {
      const value = argv[index + 1];
      invariant(
        value && !value.startsWith('--'),
        `VI3_ARGUMENT:${argument}`,
      );
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`VI3_UNKNOWN_ARGUMENT:${argument}`);
  }
  invariant(mode !== null, 'VI3_MODE_REQUIRED');
  return { mode, ...options };
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === 'status') {
    const status = currentProspectiveStatus();
    process.stdout.write(
      `VI3_TERMINAL_RUNNER ${status.state}`
        + ` verdict=${status.verdict}`
        + ` gate=${status.consumerGate}\n`,
    );
  } else if (options.mode === 'inspect') {
    invariant(
      typeof options.handoff === 'string'
        && typeof options['expected-handoff-sha256'] === 'string'
        && typeof options['expected-acceptance-receipt-sha256']
          === 'string',
      'VI3_INSPECT_ARGUMENTS_REQUIRED',
    );
    const handoff = loadTrustedScheduledCaptureHandoff({
      handoffPath: options.handoff,
      expectedHandoffFileSha256:
        options['expected-handoff-sha256'],
      expectedAcceptanceReceiptSha256:
        options['expected-acceptance-receipt-sha256'],
    });
    process.stdout.write(
      `VI3_TERMINAL_RUNNER READY_NOT_STARTED`
        + ` activation=${handoff.activation.activationId.slice(-4)}`
        + ` verdict=UNMEASURED\n`,
    );
  } else {
    invariant(
      typeof options['acceptance-receipt'] === 'string'
        && typeof options['expected-acceptance-receipt-sha256']
          === 'string'
        && typeof options.activation === 'string'
        && typeof options['evidence-root'] === 'string'
        && typeof options.output === 'string',
      'VI3_PREPARE_ARGUMENTS_REQUIRED',
    );
    const receiptBytes = readBoundedBytes(
      options['acceptance-receipt'],
      MAX_RECEIPT_BYTES,
    );
    const receiptUtf8 =
      new TextDecoder('utf-8', { fatal: true }).decode(receiptBytes);
    const receipt = validateAcceptanceReceipt(
      parseAcceptanceReceiptUtf8(receiptUtf8),
      options['expected-acceptance-receipt-sha256'],
      receiptUtf8,
    );
    verifyLocalAcceptedCandidate(receipt);
    const handoff = buildScheduledCaptureHandoff({
      acceptanceReceiptUtf8: receiptUtf8,
      expectedAcceptanceReceiptSha256:
        options['expected-acceptance-receipt-sha256'],
      activation: readBoundedJson(options.activation),
      evidenceRoot: options['evidence-root'],
    });
    const output = writeExclusiveJson(options.output, handoff);
    process.stdout.write(
      `VI3_TERMINAL_RUNNER HANDOFF_READY`
        + ` id=${handoff.handoffId.slice(-4)}`
        + ` sha256=${output.sha256.slice(-4)}`
        + ` output=${output.path}\n`,
    );
  }
}

#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '../../..');
const V_I3_TERMINAL_RUNNER_PATH =
  'quant/research/ve2/terminal-runner.mjs';
const V_I2_VERIFY_PATH = 'quant/research/ve2/verify.mjs';
const V_I3_VERIFY_PATH = 'quant/research/ve2/verify-v-i3.mjs';
const V_I3_CHECKSUM_PATH = 'quant/research/ve2/V-I3-SHA256SUMS';
const V_I4_CHECKSUM_PATH = 'quant/research/ve2/V-I4-SHA256SUMS';
const ACCEPTED_V_I3_COMMIT =
  'a2754a53446aeb5ece3f490d2d72db4598e78f00';
const ACCEPTED_V_I3_TREE =
  '342479d4eb3324130dab5536cd5d05d4fb8b8f59';
const ACTIVATION_SCHEMA = 'volume.forward.capture-activation.v1';
const RECEIPT_SCHEMA = 'vi4.capture-scheduler-acceptance.v1';
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ACTIVATION_ID = /^ve2_activation_[a-f0-9]{64}$/;
const MAX_RECEIPT_BYTES = 128 * 1024;
const MAX_HANDOFF_BYTES = 2 * 1024 * 1024;
const V_I4_PACKET_FILES = Object.freeze([
  'quant/research/ve2/V-I4-README.md',
  'quant/research/ve2/v-i4-runtime-adapter.mjs',
  'quant/research/ve2/v-i4-runtime-adapter.test.mjs',
  'quant/research/ve2/verify-v-i4.mjs',
  'server/src/engine/volume/forwardMeasurementScheduler.ts',
  'server/src/services/volumeRuntime.ts',
  'server/test/volume-forward-measurement-authority.test.mjs',
  'server/test/volume-forward-measurement-runner.test.mjs',
  'server/test/volume-forward-measurement-scheduler.test.mjs',
]);

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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseUtf8Json(value, maximumBytes, code) {
  invariant(
    typeof value === 'string'
      && Buffer.byteLength(value, 'utf8') > 0
      && Buffer.byteLength(value, 'utf8') <= maximumBytes,
    `${code}_BYTES`,
  );
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${code}_JSON`);
  }
}

function git(args, options = {}) {
  return execFileSync(
    'git',
    ['-C', REPOSITORY_ROOT, ...args],
    {
      encoding: options.encoding ?? 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    },
  );
}

function gitBlob(commit, path) {
  invariant(
    COMMIT.test(commit)
      && typeof path === 'string'
      && /^[A-Za-z0-9._/-]+$/.test(path),
    'VI4_ADAPTER_GIT_OBJECT_INPUT_INVALID',
  );
  return git(['show', `${commit}:${path}`], { encoding: 'buffer' });
}

function parseChecksums(bytes) {
  const entries = new Map();
  for (const line of bytes.toString('utf8').trim().split('\n')) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/.exec(line);
    invariant(match !== null, 'VI4_ADAPTER_CHECKSUM_LINE_INVALID');
    invariant(
      !entries.has(match[2]),
      'VI4_ADAPTER_CHECKSUM_PATH_DUPLICATED',
    );
    entries.set(match[2], match[1]);
  }
  return entries;
}

function currentFile(path) {
  const absolute = resolve(REPOSITORY_ROOT, path);
  invariant(
    relative(REPOSITORY_ROOT, absolute) === path
      && realpathSync(absolute) === absolute,
    'VI4_ADAPTER_CURRENT_FILE_REDIRECTED',
  );
  return readFileSync(absolute);
}

function currentMatchesGitBlob(path, commit) {
  invariant(
    currentFile(path).equals(gitBlob(commit, path)),
    `VI4_ADAPTER_CURRENT_DEPENDENCY_DRIFT:${path}`,
  );
}

function validateAcceptanceReceipt(
  receiptUtf8,
  expectedReceiptSha256,
) {
  invariant(
    SHA256.test(expectedReceiptSha256)
      && sha256(Buffer.from(receiptUtf8, 'utf8'))
        === expectedReceiptSha256,
    'VI4_ADAPTER_ACCEPTANCE_RECEIPT_CUSTODY',
  );
  const receipt = parseUtf8Json(
    receiptUtf8,
    MAX_RECEIPT_BYTES,
    'VI4_ADAPTER_ACCEPTANCE_RECEIPT',
  );
  invariant(exactKeys(receipt, [
    'schemaVersion',
    'verdict',
    'independentExactHashReview',
    'acceptedSchedulerCandidateCommit',
    'acceptedSchedulerCandidateTree',
    'directParentCommit',
    'directParentTree',
    'acceptedAtUtc',
    'vI4ChecksumFileSha256',
    'outcomeBytesAccessed',
    'executionAuthority',
  ]), 'VI4_ADAPTER_ACCEPTANCE_RECEIPT_SHAPE');
  const acceptedAtMs = Date.parse(receipt.acceptedAtUtc);
  invariant(
    receipt.schemaVersion === RECEIPT_SCHEMA
      && receipt.verdict === 'ACCEPT'
      && receipt.independentExactHashReview === true
      && COMMIT.test(receipt.acceptedSchedulerCandidateCommit)
      && COMMIT.test(receipt.acceptedSchedulerCandidateTree)
      && receipt.directParentCommit === ACCEPTED_V_I3_COMMIT
      && receipt.directParentTree === ACCEPTED_V_I3_TREE
      && typeof receipt.acceptedAtUtc === 'string'
      && Number.isSafeInteger(acceptedAtMs)
      && new Date(acceptedAtMs).toISOString() === receipt.acceptedAtUtc
      && SHA256.test(receipt.vI4ChecksumFileSha256)
      && receipt.outcomeBytesAccessed === false
      && receipt.executionAuthority === 'NONE',
    'VI4_ADAPTER_ACCEPTANCE_RECEIPT_INVALID',
  );
  return Object.freeze({ receipt, acceptedAtMs });
}

function verifyAcceptedV4Candidate(receipt) {
  const commit = receipt.acceptedSchedulerCandidateCommit;
  const tree = git(['rev-parse', `${commit}^{tree}`]).trim();
  const lineage = git([
    'rev-list',
    '--parents',
    '-n',
    '1',
    commit,
  ]).trim().split(/\s+/);
  const parentTree = git([
    'rev-parse',
    `${ACCEPTED_V_I3_COMMIT}^{tree}`,
  ]).trim();
  invariant(
    tree === receipt.acceptedSchedulerCandidateTree
      && lineage.length === 2
      && lineage[0] === commit
      && lineage[1] === ACCEPTED_V_I3_COMMIT
      && parentTree === ACCEPTED_V_I3_TREE,
    'VI4_ADAPTER_ACCEPTED_CANDIDATE_LINEAGE_MISMATCH',
  );
  try {
    git([
      'merge-base',
      '--is-ancestor',
      commit,
      'HEAD',
    ]);
  } catch {
    throw new Error('VI4_ADAPTER_ACCEPTED_CANDIDATE_NOT_ANCESTOR');
  }
  const checksumBytes = gitBlob(commit, V_I4_CHECKSUM_PATH);
  invariant(
    sha256(checksumBytes) === receipt.vI4ChecksumFileSha256,
    'VI4_ADAPTER_ACCEPTED_CHECKSUM_CUSTODY',
  );
  const entries = parseChecksums(checksumBytes);
  invariant(
    entries.size === V_I4_PACKET_FILES.length
      && JSON.stringify([...entries.keys()].sort())
        === JSON.stringify([...V_I4_PACKET_FILES].sort()),
    'VI4_ADAPTER_ACCEPTED_PACKET_INVENTORY',
  );
  for (const path of V_I4_PACKET_FILES) {
    invariant(
      sha256(gitBlob(commit, path)) === entries.get(path),
      `VI4_ADAPTER_ACCEPTED_PACKET_MISMATCH:${path}`,
    );
  }
  const changed = git([
    'diff',
    '--name-only',
    ACCEPTED_V_I3_COMMIT,
    commit,
  ]).trim().split('\n').filter(Boolean).sort();
  invariant(
    JSON.stringify(changed)
      === JSON.stringify([
        ...V_I4_PACKET_FILES,
        V_I4_CHECKSUM_PATH,
      ].sort()),
    'VI4_ADAPTER_ACCEPTED_CHANGED_PATHS_MISMATCH',
  );
  for (const path of V_I4_PACKET_FILES) {
    currentMatchesGitBlob(path, commit);
  }
  currentMatchesGitBlob(V_I4_CHECKSUM_PATH, commit);
  currentMatchesGitBlob(V_I3_TERMINAL_RUNNER_PATH, ACCEPTED_V_I3_COMMIT);
  currentMatchesGitBlob(V_I2_VERIFY_PATH, ACCEPTED_V_I3_COMMIT);
  currentMatchesGitBlob(V_I3_VERIFY_PATH, ACCEPTED_V_I3_COMMIT);
  const acceptedV3RunnerSource = gitBlob(
    ACCEPTED_V_I3_COMMIT,
    V_I3_TERMINAL_RUNNER_PATH,
  ).toString('utf8');
  invariant(
    acceptedV3RunnerSource.includes(
      "schemaVersion: 'vi3.armed-public-terminal-runner.v1'",
    )
      && acceptedV3RunnerSource.includes(
        'forwardMeasurementObserver: observe',
      )
      && acceptedV3RunnerSource.includes(
        'forwardMeasurementRuntimeGeneration: captureGeneration',
      )
      && acceptedV3RunnerSource.includes(
        'close: () => owner.close()',
      ),
    'VI4_ADAPTER_ACCEPTED_VI3_ARM_CONTRACT_MISMATCH',
  );
  const status = git([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]).trim();
  invariant(status === '', 'VI4_ADAPTER_WORKTREE_NOT_CLEAN');
}

function validateHandoff(
  handoffUtf8,
  expectedHandoffSha256,
  acceptedAtMs,
  validateScheduledCaptureHandoff,
) {
  invariant(
    SHA256.test(expectedHandoffSha256)
      && sha256(Buffer.from(handoffUtf8, 'utf8'))
        === expectedHandoffSha256,
    'VI4_ADAPTER_HANDOFF_CUSTODY',
  );
  const handoff = parseUtf8Json(
    handoffUtf8,
    MAX_HANDOFF_BYTES,
    'VI4_ADAPTER_HANDOFF',
  );
  validateScheduledCaptureHandoff(handoff);
  const parentChecksumBytes =
    gitBlob(ACCEPTED_V_I3_COMMIT, V_I3_CHECKSUM_PATH);
  invariant(
    handoff.acceptedCaptureCandidateCommit === ACCEPTED_V_I3_COMMIT
      && handoff.acceptedCaptureCandidateTree === ACCEPTED_V_I3_TREE
      && handoff.vI3ChecksumFileSha256 === sha256(parentChecksumBytes)
      && Date.parse(handoff.acceptedAtUtc) <= acceptedAtMs,
    'VI4_ADAPTER_HANDOFF_NOT_ACCEPTED_VI3',
  );
  return handoff;
}

function validateArmedCapture(armed, handoff) {
  invariant(exactKeys(armed, [
    'schemaVersion',
    'handoffId',
    'evidenceRoot',
    'captureGeneration',
    'volumeRuntimeOptions',
    'observe',
    'advanceTime',
    'checkpoint',
    'snapshot',
    'ownerSnapshot',
    'close',
  ]), 'VI4_ADAPTER_ARMED_CAPTURE_SHAPE');
  invariant(
    Object.isFrozen(armed)
      && armed.schemaVersion === 'vi3.armed-public-terminal-runner.v1'
      && armed.handoffId === handoff.handoffId
      && armed.evidenceRoot === handoff.evidenceRoot
      && Number.isSafeInteger(armed.captureGeneration)
      && armed.captureGeneration >= 1
      && typeof armed.observe === 'function'
      && typeof armed.advanceTime === 'function'
      && typeof armed.snapshot === 'function'
      && typeof armed.close === 'function'
      && Object.isFrozen(armed.volumeRuntimeOptions)
      && exactKeys(armed.volumeRuntimeOptions, [
        'forwardMeasurementObserver',
        'forwardMeasurementRuntimeGeneration',
      ])
      && armed.volumeRuntimeOptions.forwardMeasurementObserver
        === armed.observe
      && armed.volumeRuntimeOptions.forwardMeasurementRuntimeGeneration
        === armed.captureGeneration,
    'VI4_ADAPTER_ARMED_CAPTURE_INVALID',
  );
  const snapshot = armed.snapshot();
  invariant(
    plainRecord(snapshot)
      && Object.isFrozen(snapshot)
      && ACTIVATION_ID.test(snapshot.activationId)
      && snapshot.activationId === handoff.activation.activationId
      && ['SCHEDULED', 'WARMING', 'CAPTURING'].includes(snapshot.state)
      && Number.isSafeInteger(snapshot.recordedWarmupCutCount)
      && Number.isSafeInteger(snapshot.expectedWarmupCutCount)
      && Number.isSafeInteger(snapshot.recordedDetectorCutCount)
      && Number.isSafeInteger(snapshot.expectedDetectorCutCount)
      && (
        snapshot.runtimeGeneration === null
        || (
          Number.isSafeInteger(snapshot.runtimeGeneration)
          && snapshot.runtimeGeneration >= 1
        )
      ),
    'VI4_ADAPTER_RUNNER_SNAPSHOT_INVALID',
  );
  const warmupStartMs = Date.parse(handoff.schedule.warmupStartUtc);
  const intervalStartMs =
    Date.parse(handoff.schedule.admissionStartUtc);
  const maturityAtMs =
    Date.parse(handoff.schedule.captureStopNotBeforeUtc);
  const cadenceMs = handoff.schedule.detectorCadenceMs;
  const expectedWarmup =
    (intervalStartMs - warmupStartMs) / cadenceMs;
  const expectedDetector =
    (maturityAtMs - intervalStartMs) / cadenceMs;
  const resume = snapshot.runtimeGeneration !== null;
  const recordedTotal =
    snapshot.recordedWarmupCutCount
      + snapshot.recordedDetectorCutCount;
  const expectedState =
    recordedTotal === 0
      ? 'SCHEDULED'
      : snapshot.recordedDetectorCutCount === 0
      ? 'WARMING'
      : 'CAPTURING';
  invariant(
    snapshot.expectedWarmupCutCount === expectedWarmup
      && snapshot.expectedDetectorCutCount === expectedDetector
      && snapshot.recordedWarmupCutCount >= 0
      && snapshot.recordedWarmupCutCount <= expectedWarmup
      && snapshot.recordedDetectorCutCount >= 0
      && snapshot.recordedDetectorCutCount <= expectedDetector
      && (
        snapshot.recordedDetectorCutCount === 0
        || snapshot.recordedWarmupCutCount === expectedWarmup
      )
      && snapshot.state === expectedState
      && (recordedTotal > 0) === resume
      && (
        resume
          ? armed.captureGeneration === snapshot.runtimeGeneration + 1
          : armed.captureGeneration === 1
      ),
    'VI4_ADAPTER_ARMED_CAPTURE_CURSOR_MISMATCH',
  );
  return Object.freeze({
    resume,
    warmupStartMs,
    maturityAtMs,
  });
}

export async function bindAcceptedV4ScheduledCapture({
  acceptanceReceiptUtf8,
  expectedAcceptanceReceiptSha256,
  handoffUtf8,
  expectedHandoffSha256,
  armedV3Capture,
}) {
  const accepted = validateAcceptanceReceipt(
    acceptanceReceiptUtf8,
    expectedAcceptanceReceiptSha256,
  );
  verifyAcceptedV4Candidate(accepted.receipt);
  const terminalRunner = await import(pathToFileURL(
    resolve(REPOSITORY_ROOT, V_I3_TERMINAL_RUNNER_PATH),
  ).href);
  invariant(
    typeof terminalRunner.validateScheduledCaptureHandoff === 'function',
    'VI4_ADAPTER_VI3_VALIDATOR_EXPORT_MISSING',
  );
  const handoff = validateHandoff(
    handoffUtf8,
    expectedHandoffSha256,
    accepted.acceptedAtMs,
    terminalRunner.validateScheduledCaptureHandoff,
  );
  const cursor = validateArmedCapture(armedV3Capture, handoff);
  const capturePort = Object.freeze({
    observe: armedV3Capture.observe,
    advanceTime: armedV3Capture.advanceTime,
    snapshot: armedV3Capture.snapshot,
    close: armedV3Capture.close,
  });
  const activation = Object.freeze({
    schemaVersion: ACTIVATION_SCHEMA,
    captureEnabled: true,
    activationId: handoff.activation.activationId,
    runtimeGeneration: armedV3Capture.captureGeneration,
    resume: cursor.resume,
    warmupStartMs: cursor.warmupStartMs,
    maturityAtMs: cursor.maturityAtMs,
    detectorCadenceMs: 2_000,
  });
  return Object.freeze({
    schemaVersion: 'vi4.accepted-runtime-binding.v1',
    acceptedSchedulerCandidateCommit:
      accepted.receipt.acceptedSchedulerCandidateCommit,
    handoffId: handoff.handoffId,
    activationId: activation.activationId,
    state: 'ACCEPTED_READY_NOT_STARTED',
    volumeRuntimeOptions: Object.freeze({
      forwardMeasurementActivation: activation,
      forwardMeasurementCapture: capturePort,
    }),
    consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
    profitabilityClaim: false,
    executionAuthority: 'NONE',
  });
}

export function currentV4AdapterStatus() {
  return Object.freeze({
    schemaVersion: 'vi4.runtime-adapter-status.v1',
    state: 'PROSPECTIVE_NOT_ACTIVATED',
    reasonCode: 'VI4_ACCEPTANCE_AND_ARMED_VI3_CAPTURE_REQUIRED',
    consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
    profitabilityClaim: false,
    executionAuthority: 'NONE',
  });
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const status = currentV4AdapterStatus();
  process.stdout.write(
    `VI4_RUNTIME_ADAPTER ${status.state}`
      + ` gate=${status.consumerGate}\n`,
  );
}

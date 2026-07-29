#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import {
  createCoreEvidenceWriter,
  loadCoreMeasurementModule,
} from './evidence-chain.mjs';

const OWNER_SCHEMA = 'vi3.accepted-public-capture-owner.v1';
const OWNER_STATE_SCHEMA = 'vi3.accepted-capture-owner-state.v1';
const CHECKPOINT_ENVELOPE_SCHEMA =
  'vi3.runner-checkpoint-envelope.v1';
const REQUEST_SCHEMA = 'vi3.public-lifecycle-capture-request.v1';
const RECEIPT_SCHEMA = 'vi3.public-lifecycle-capture-receipt.v1';
const TERMINAL_SCHEMA = 'vi3.detector-terminal-handoff.v1';
const DETECTOR_CADENCE_MS = 2_000;
const DETECTOR_CUTS_PER_SEGMENT = 99_998;
const MAX_SEGMENT_RECORDS = 100_000;
const MAX_SEGMENT_BYTES = 256 * 1024 * 1024;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const RAW_SHA256 = /^[a-f0-9]{64}$/;
const ENGINE_ID = /^[A-Za-z][A-Za-z0-9_-]{2,191}$/;
const PUBLIC_CAPTURE_ALLOWLIST = Object.freeze({
  restOrigin: 'https://data-api.binance.vision',
  restGets: Object.freeze([
    '/api/v3/exchangeInfo?symbol=<symbol>',
    '/api/v3/depth?symbol=<symbol>&limit=100',
  ]),
  webSocketOrigin: 'wss://data-stream.binance.vision:443',
  streams: Object.freeze([
    '<symbol-lowercase>@depth@100ms',
    '<symbol-lowercase>@aggTrade',
    '<symbol-lowercase>@trade',
    '<symbol-lowercase>@bookTicker',
  ]),
  authentication: 'NONE',
});

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
      'VI3_OWNER_CANONICAL_NUMBER',
    );
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  invariant(plainRecord(value), 'VI3_OWNER_CANONICAL_OBJECT');
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(',')}}`;
}

function domainSha256(domain, value) {
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  hash.update(Uint8Array.of(0));
  hash.update(canonicalJson(value), 'utf8');
  return `sha256:${hash.digest('hex')}`;
}

function rawSha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function deepFreeze(value, seen = new Set()) {
  if (
    value === null
    || (typeof value !== 'object' && typeof value !== 'function')
    || ArrayBuffer.isView(value)
    || seen.has(value)
  ) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
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
    invariant(written > 0, 'VI3_OWNER_SHORT_WRITE');
    offset += written;
  }
}

function fsyncDirectory(path) {
  const descriptor = openSync(path, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeExclusiveJson(path, value) {
  const bytes = Buffer.from(`${canonicalJson(value)}\n`, 'utf8');
  const descriptor = openSync(path, 'wx', 0o600);
  try {
    writeAll(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  fsyncDirectory(dirname(path));
  return rawSha256(bytes);
}

function writeAtomicJson(path, value) {
  const next = `${path}.next`;
  const bytes = Buffer.from(`${canonicalJson(value)}\n`, 'utf8');
  const descriptor = openSync(next, 'wx', 0o600);
  try {
    writeAll(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(next, path);
  fsyncDirectory(dirname(path));
  return rawSha256(bytes);
}

function readJson(path, maximumBytes = 16 * 1024 * 1024) {
  const bytes = readFileSync(path);
  invariant(
    bytes.length > 0 && bytes.length <= maximumBytes,
    'VI3_OWNER_FILE_BOUND',
  );
  let value;
  try {
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
  } catch {
    throw new Error('VI3_OWNER_JSON_INVALID');
  }
  invariant(plainRecord(value), 'VI3_OWNER_OBJECT_REQUIRED');
  return Object.freeze({ value, bytes });
}

function recoverAtomicNext(path) {
  const next = `${path}.next`;
  if (!existsSync(next)) return;
  const pending = readJson(next);
  if (!existsSync(path)) {
    renameSync(next, path);
    fsyncDirectory(dirname(path));
    return;
  }
  const current = readJson(path);
  const pendingRevision = Number.isSafeInteger(
    pending.value.stateRevision,
  )
    ? pending.value.stateRevision
    : pending.value.runnerCheckpoint?.checkpointRevision ?? -1;
  const currentRevision = Number.isSafeInteger(
    current.value.stateRevision,
  )
    ? current.value.stateRevision
    : current.value.runnerCheckpoint?.checkpointRevision ?? -1;
  if (pendingRevision === currentRevision + 1) {
    renameSync(next, path);
    fsyncDirectory(dirname(path));
    return;
  }
  invariant(
    pendingRevision <= currentRevision,
    'VI3_OWNER_ATOMIC_RECOVERY_AMBIGUOUS',
  );
  unlinkSync(next);
  fsyncDirectory(dirname(path));
}

function physicalEvidenceRoot(value, resume) {
  invariant(
    typeof value === 'string' && value.startsWith('/'),
    'VI3_OWNER_ROOT_ABSOLUTE',
  );
  const parent = realpathSync(dirname(value));
  const target = resolve(parent, basename(value));
  invariant(target === value, 'VI3_OWNER_ROOT_REDIRECTED');
  if (resume) {
    invariant(existsSync(target), 'VI3_OWNER_RESUME_ROOT_MISSING');
  } else {
    mkdirSync(target, { mode: 0o700 });
    fsyncDirectory(parent);
  }
  const stat = lstatSync(target);
  invariant(
    stat.isDirectory()
      && !stat.isSymbolicLink()
      && realpathSync(target) === target,
    'VI3_OWNER_ROOT_INVALID',
  );
  return target;
}

function segmentId(handoff, segmentIndex) {
  return `ve2_segment_${domainSha256(
    'VE2_FORWARD_DETECTOR_SEGMENT_ID_V1',
    {
      activationId: handoff.activation.activationId,
      captureId: handoff.captureId,
      chainKey: handoff.detector.coverageChainKey,
      segmentIndex,
    },
  ).slice('sha256:'.length)}`;
}

function detectorCutCount(handoff) {
  return (
    Date.parse(handoff.schedule.captureStopNotBeforeUtc)
      - Date.parse(handoff.schedule.admissionStartUtc)
  ) / DETECTOR_CADENCE_MS;
}

function segmentExpectedCount(handoff, index) {
  const first = index * DETECTOR_CUTS_PER_SEGMENT;
  return Math.min(
    DETECTOR_CUTS_PER_SEGMENT,
    detectorCutCount(handoff) - first,
  );
}

function bindingSemantic(handoff) {
  return {
    schemaVersion: OWNER_SCHEMA,
    handoffId: handoff.handoffId,
    evidenceRoot: handoff.evidenceRoot,
    acceptedCaptureCandidateCommit:
      handoff.acceptedCaptureCandidateCommit,
    acceptedCaptureCandidateTree:
      handoff.acceptedCaptureCandidateTree,
    acceptanceReceiptSha256: handoff.acceptanceReceiptSha256,
    activationSha256: handoff.activationSha256,
    captureImplementationSha256:
      handoff.activation.captureImplementationSha256,
    packetMeasurementPolicySha256:
      handoff.activation.packetMeasurementPolicySha256,
    detectorInputSourceId: handoff.detector.sourceId,
    detectorInputSourceDigest: handoff.detector.sourceDigest,
    detectorCoverageCorePolicyDigest:
      handoff.detector.coverageCorePolicyDigest,
    detectorCoverageChainKey:
      handoff.detector.coverageChainKey,
    terminalMetricsPolicySha256:
      handoff.terminalMetricsPolicySha256,
    vI3ChecksumFileSha256: handoff.vI3ChecksumFileSha256,
    controls: handoff.controls,
    publicCaptureAllowlist: PUBLIC_CAPTURE_ALLOWLIST,
  };
}

function ownerBinding(handoff) {
  const semantic = bindingSemantic(handoff);
  return deepFreeze({
    ...semantic,
    ownerBindingDigest: domainSha256(
      'VI3_ACCEPTED_CAPTURE_OWNER_BINDING_V1',
      semantic,
    ),
  });
}

function ownerState(binding) {
  const semantic = {
    schemaVersion: OWNER_STATE_SCHEMA,
    stateRevision: 0,
    ownerBindingDigest: binding.ownerBindingDigest,
    state: 'ARMED_NOT_STARTED',
    currentSegmentIndex: null,
    previousTerminalHash: null,
    sealedSegments: [],
    scheduledRequestIds: [],
    terminalHandoffSha256: null,
  };
  return {
    ...semantic,
    stateDigest: domainSha256(
      'VI3_ACCEPTED_CAPTURE_OWNER_STATE_V1',
      semantic,
    ),
  };
}

function validateOwnerState(value, binding) {
  invariant(exactKeys(value, [
    'schemaVersion',
    'stateRevision',
    'ownerBindingDigest',
    'state',
    'currentSegmentIndex',
    'previousTerminalHash',
    'sealedSegments',
    'scheduledRequestIds',
    'terminalHandoffSha256',
    'stateDigest',
  ]), 'VI3_OWNER_STATE_SHAPE');
  const semantic = {
    schemaVersion: value.schemaVersion,
    stateRevision: value.stateRevision,
    ownerBindingDigest: value.ownerBindingDigest,
    state: value.state,
    currentSegmentIndex: value.currentSegmentIndex,
    previousTerminalHash: value.previousTerminalHash,
    sealedSegments: value.sealedSegments,
    scheduledRequestIds: value.scheduledRequestIds,
    terminalHandoffSha256: value.terminalHandoffSha256,
  };
  invariant(
    value.schemaVersion === OWNER_STATE_SCHEMA
      && Number.isSafeInteger(value.stateRevision)
      && value.stateRevision >= 0
      && value.ownerBindingDigest === binding.ownerBindingDigest
      && ['ARMED_NOT_STARTED', 'CAPTURING', 'DETECTOR_SEALED'].includes(
        value.state,
      )
      && (
        value.currentSegmentIndex === null
        || (
          Number.isSafeInteger(value.currentSegmentIndex)
          && value.currentSegmentIndex >= 0
        )
      )
      && (
        value.previousTerminalHash === null
        || SHA256.test(value.previousTerminalHash)
      )
      && Array.isArray(value.sealedSegments)
      && value.sealedSegments.every(
        (entry, index) => exactKeys(entry, [
          'segmentId',
          'segmentIndex',
          'cutCount',
          'terminalHash',
          'evidenceBytesSha256',
        ])
          && entry.segmentIndex === index
          && typeof entry.segmentId === 'string'
          && /^ve2_segment_[a-f0-9]{64}$/.test(entry.segmentId)
          && Number.isSafeInteger(entry.cutCount)
          && entry.cutCount > 0
          && SHA256.test(entry.terminalHash)
          && SHA256.test(entry.evidenceBytesSha256),
      )
      && Array.isArray(value.scheduledRequestIds)
      && value.scheduledRequestIds.every(
        (id, index, ids) => typeof id === 'string'
          && /^vi3_capture_request_[a-f0-9]{64}$/.test(id)
          && (index === 0 || ids[index - 1] < id),
      )
      && (
        value.terminalHandoffSha256 === null
        || RAW_SHA256.test(value.terminalHandoffSha256)
      )
      && value.stateDigest === domainSha256(
        'VI3_ACCEPTED_CAPTURE_OWNER_STATE_V1',
        semantic,
      ),
    'VI3_OWNER_STATE_INVALID',
  );
  return deepFreeze(value);
}

function stateWith(state, changes) {
  const semantic = {
    schemaVersion: OWNER_STATE_SCHEMA,
    stateRevision: state.stateRevision + 1,
    ownerBindingDigest: state.ownerBindingDigest,
    state: changes.state ?? state.state,
    currentSegmentIndex:
      changes.currentSegmentIndex === undefined
        ? state.currentSegmentIndex
        : changes.currentSegmentIndex,
    previousTerminalHash:
      changes.previousTerminalHash === undefined
        ? state.previousTerminalHash
        : changes.previousTerminalHash,
    sealedSegments:
      changes.sealedSegments ?? state.sealedSegments,
    scheduledRequestIds:
      changes.scheduledRequestIds ?? state.scheduledRequestIds,
    terminalHandoffSha256:
      changes.terminalHandoffSha256 === undefined
        ? state.terminalHandoffSha256
        : changes.terminalHandoffSha256,
  };
  return deepFreeze({
    ...semantic,
    stateDigest: domainSha256(
      'VI3_ACCEPTED_CAPTURE_OWNER_STATE_V1',
      semantic,
    ),
  });
}

export async function deriveAcceptedDetectorPolicyBinding(handoff) {
  const core = await loadCoreMeasurementModule();
  const policy = core.buildVolumeForwardDetectorCoveragePolicy({
    policyId: 'VOLUME_MEASUREMENT_MAX_HOLD_60S_V1',
    policyRevision: 1,
    role: 'DETECTOR_COVERAGE',
    symbol: null,
    frozenAtMs: Date.parse(handoff.schedule.warmupStartUtc),
    outcomeOpensAtMs: Date.parse(
      handoff.schedule.admissionStartUtc,
    ),
    outcomeClosesAtMs: Date.parse(
      handoff.schedule.captureStopNotBeforeUtc,
    ),
    evidenceClosesAtMs: Date.parse(
      handoff.schedule.captureStopNotBeforeUtc,
    ),
    cadenceMs: DETECTOR_CADENCE_MS,
    detectorInputSourceId: handoff.detector.sourceId,
    detectorInputSourceDigest: handoff.detector.sourceDigest,
    config: {
      enabled: false,
      killSwitchEngaged: true,
    },
  });
  const policyBytes = Buffer.from(JSON.stringify(policy), 'utf8');
  return deepFreeze({
    policy,
    policyBytes,
    policyRawSha256: `sha256:${rawSha256(policyBytes)}`,
  });
}

function decodeDetectorCuts(writer) {
  return writer.records
    .filter((record) => record.header.kind === 'DETECTOR_COVERAGE')
    .map((record) => {
      let value;
      try {
        value = JSON.parse(
          Buffer.from(record.rawBase64, 'base64').toString('utf8'),
        );
      } catch {
        throw new Error('VI3_OWNER_DETECTOR_CUT_JSON');
      }
      invariant(
        plainRecord(value)
          && typeof value.cutDigest === 'string'
          && SHA256.test(value.cutDigest),
        'VI3_OWNER_DETECTOR_CUT_INVALID',
      );
      return value;
    });
}

function requestSemantic(handoff, request) {
  return {
    schemaVersion: REQUEST_SCHEMA,
    handoffId: handoff.handoffId,
    activationId: request.activationId,
    captureId: request.captureId,
    detectorCutOffset: request.detectorCutOffset,
    detectorCutAtMs: request.detectorCutAtMs,
    detectorInputSourceId: request.detectorInputSourceId,
    detectorInputSourceDigest: request.detectorInputSourceDigest,
    proposal: request.proposal,
    detectorDecisionDigest: request.detectorDecisionDigest,
    featureDigest: request.featureDigest,
    entryQuoteNotional: request.entryQuoteNotional,
    maximumHoldMs: request.maximumHoldMs,
    admissionEndExclusiveMs: request.admissionEndExclusiveMs,
    evidenceClosesAtMs: request.evidenceClosesAtMs,
    evidenceRoot: handoff.evidenceRoot,
    publicCaptureAllowlist: PUBLIC_CAPTURE_ALLOWLIST,
    requiredV2RecordSequence: [
      'POLICY',
      'GENERATION_OPEN',
      'CONFIG_STATE',
      'KILL_STATE',
      'EXCHANGE_INFO',
      'DEPTH_SNAPSHOT',
      'STREAM_FRAME_AND_TYPED_PUBLIC_RECORDS',
      'CONTINUITY',
      'DETECTOR_PROPOSAL',
      'LIFECYCLE_RECORDS',
      'GENERATION_CLOSE',
      'TERMINAL_SEAL',
    ],
    state: 'SCHEDULED_PUBLIC_CAPTURE_REQUIRED',
    authority: request.authority,
    consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
    profitabilityClaim: false,
  };
}

function validateLifecycleReceipt(value, request) {
  invariant(exactKeys(value, [
    'schemaVersion',
    'requestId',
    'proposalId',
    'proposalRevision',
    'proposalDigest',
    'state',
    'segmentId',
    'terminalHash',
    'evidenceBytesSha256',
    'continuityGapCount',
    'terminalLifecycleCount',
    'blockedLifecycleCount',
    'receiptDigest',
  ]), 'VI3_OWNER_LIFECYCLE_RECEIPT_SHAPE');
  const semantic = {
    schemaVersion: value.schemaVersion,
    requestId: value.requestId,
    proposalId: value.proposalId,
    proposalRevision: value.proposalRevision,
    proposalDigest: value.proposalDigest,
    state: value.state,
    segmentId: value.segmentId,
    terminalHash: value.terminalHash,
    evidenceBytesSha256: value.evidenceBytesSha256,
    continuityGapCount: value.continuityGapCount,
    terminalLifecycleCount: value.terminalLifecycleCount,
    blockedLifecycleCount: value.blockedLifecycleCount,
  };
  invariant(
    value.schemaVersion === RECEIPT_SCHEMA
      && value.requestId === request.requestId
      && value.proposalId === request.proposal.proposalId
      && value.proposalRevision === request.proposal.proposalRevision
      && value.proposalDigest === request.proposal.proposalDigest
      && ['TERMINAL', 'BLOCKED'].includes(value.state)
      && /^ve2_segment_[a-f0-9]{64}$/.test(value.segmentId)
      && SHA256.test(value.terminalHash)
      && SHA256.test(value.evidenceBytesSha256)
      && value.continuityGapCount === 0
      && (
        (
          value.state === 'TERMINAL'
          && value.terminalLifecycleCount === 1
          && value.blockedLifecycleCount === 0
        )
        || (
          value.state === 'BLOCKED'
          && value.terminalLifecycleCount === 0
          && value.blockedLifecycleCount === 1
        )
      )
      && value.receiptDigest === domainSha256(
        'VI3_PUBLIC_LIFECYCLE_CAPTURE_RECEIPT_V1',
        semantic,
      ),
    'VI3_OWNER_LIFECYCLE_RECEIPT_INVALID',
  );
  return value;
}

export async function createAcceptedCaptureOwner({
  handoff,
  resume = false,
}) {
  invariant(
    plainRecord(handoff)
      && typeof handoff.handoffId === 'string'
      && typeof handoff.evidenceRoot === 'string'
      && typeof resume === 'boolean',
    'VI3_OWNER_INPUT',
  );
  const root = physicalEvidenceRoot(handoff.evidenceRoot, resume);
  const detectorDir = resolve(root, 'detector');
  const requestDir = resolve(root, 'scheduled-public-captures');
  const receiptDir = resolve(root, 'lifecycle-receipts');
  if (!resume) {
    mkdirSync(detectorDir, { mode: 0o700 });
    mkdirSync(requestDir, { mode: 0o700 });
    mkdirSync(receiptDir, { mode: 0o700 });
    fsyncDirectory(root);
  }
  for (const directory of [detectorDir, requestDir, receiptDir]) {
    invariant(
      lstatSync(directory).isDirectory()
        && !lstatSync(directory).isSymbolicLink()
        && realpathSync(directory) === directory,
      'VI3_OWNER_SUBDIRECTORY_INVALID',
    );
  }

  const binding = ownerBinding(handoff);
  const bindingPath = resolve(root, 'owner-binding.json');
  if (resume) {
    const observed = readJson(bindingPath);
    invariant(
      canonicalJson(observed.value) === canonicalJson(binding),
      'VI3_OWNER_BINDING_MISMATCH',
    );
  } else {
    writeExclusiveJson(bindingPath, binding);
  }

  const statePath = resolve(root, 'owner-state.json');
  recoverAtomicNext(statePath);
  let state;
  if (resume) {
    state = validateOwnerState(readJson(statePath).value, binding);
  } else {
    state = deepFreeze(ownerState(binding));
    writeExclusiveJson(statePath, state);
  }

  const checkpointPath = resolve(root, 'runner-checkpoint.json');
  recoverAtomicNext(checkpointPath);
  let runnerCheckpoint = null;
  if (resume && existsSync(checkpointPath)) {
    const envelope = readJson(checkpointPath).value;
    invariant(exactKeys(envelope, [
      'schemaVersion',
      'ownerBindingDigest',
      'runnerCheckpoint',
      'envelopeDigest',
    ]), 'VI3_OWNER_CHECKPOINT_SHAPE');
    const semantic = {
      schemaVersion: envelope.schemaVersion,
      ownerBindingDigest: envelope.ownerBindingDigest,
      runnerCheckpoint: envelope.runnerCheckpoint,
    };
    invariant(
      envelope.schemaVersion === CHECKPOINT_ENVELOPE_SCHEMA
        && envelope.ownerBindingDigest === binding.ownerBindingDigest
        && plainRecord(envelope.runnerCheckpoint)
        && envelope.envelopeDigest === domainSha256(
          'VI3_RUNNER_CHECKPOINT_ENVELOPE_V1',
          semantic,
        ),
      'VI3_OWNER_CHECKPOINT_INVALID',
    );
    runnerCheckpoint = envelope.runnerCheckpoint;
  }

  const policyBinding =
    await deriveAcceptedDetectorPolicyBinding(handoff);
  invariant(
    policyBinding.policyRawSha256
      === handoff.detector.coverageCorePolicyDigest,
    'VI3_OWNER_DETECTOR_POLICY_BINDING_MISMATCH',
  );
  const expectedCuts = detectorCutCount(handoff);
  invariant(
    Number.isSafeInteger(expectedCuts)
      && expectedCuts === 1_296_031,
    'VI3_OWNER_DETECTOR_CUT_COUNT',
  );
  const segmentCount = Math.ceil(
    expectedCuts / DETECTOR_CUTS_PER_SEGMENT,
  );
  const writers = new Array(segmentCount).fill(null);
  for (let index = 0; index < segmentCount; index += 1) {
    if (index < state.sealedSegments.length) continue;
    const id = segmentId(handoff, index);
    const prefix = `${String(index).padStart(4, '0')}-${id}`;
    const outputPath = resolve(detectorDir, `${prefix}.jsonl`);
    const writerCheckpointPath =
      resolve(detectorDir, `${prefix}.checkpoint.json`);
    const outputExists = existsSync(outputPath);
    const writerCheckpointExists = existsSync(writerCheckpointPath);
    invariant(
      outputExists === writerCheckpointExists,
      'VI3_OWNER_WRITER_PARTIAL_ARTIFACT',
    );
    writers[index] = await createCoreEvidenceWriter({
      chainId: id,
      checkpointPath: writerCheckpointPath,
      maxBytes: MAX_SEGMENT_BYTES,
      maxRecords: MAX_SEGMENT_RECORDS,
      outputPath,
      policyBytes: policyBinding.policyBytes,
      policyReceivedAtMs:
        Date.parse(handoff.schedule.warmupStartUtc),
      policyReceivedMonotonicNs: 0n,
      resume: outputExists,
      recoverTornTail: false,
    });
  }

  const diskCuts = [
    ...state.sealedSegments.map((segment) => segment.cutCount),
    ...writers.map(
      (writer) => writer === null ? 0 : decodeDetectorCuts(writer).length,
    ),
  ].reduce((total, count) => total + count, 0);
  const diskLastCut = [...writers]
    .reverse()
    .map((writer) => writer === null ? [] : decodeDetectorCuts(writer))
    .find((cuts) => cuts.length > 0)?.at(-1) ?? null;
  invariant(
    diskCuts === (runnerCheckpoint?.nextCutOffset ?? 0)
      && (
        diskCuts === 0
        || diskLastCut?.cutDigest === runnerCheckpoint?.previousCutDigest
      )
      && (
        runnerCheckpoint === null
        || runnerCheckpoint.currentSegmentIndex
          === state.currentSegmentIndex
      )
      && (
        runnerCheckpoint === null
        || runnerCheckpoint.acceptedProposalIds.length
          === state.scheduledRequestIds.length
      ),
    'VI3_OWNER_DURABLE_CURSOR_MISMATCH',
  );

  const leasePath = resolve(root, 'owner-lease.json');
  const lease = {
    schemaVersion: 'vi3.accepted-capture-owner-lease.v1',
    ownerBindingDigest: binding.ownerBindingDigest,
    processId: process.pid,
  };
  invariant(!existsSync(leasePath), 'VI3_OWNER_ACTIVE_LEASE_PRESENT');
  writeExclusiveJson(leasePath, lease);
  let closed = false;

  function persistState(next) {
    validateOwnerState(next, binding);
    writeAtomicJson(statePath, next);
    state = next;
  }

  function currentWriter(index) {
    const writer = writers[index];
    invariant(writer !== null, 'VI3_OWNER_WRITER_UNAVAILABLE');
    return writer;
  }

  function sealSegment(index) {
    const writer = currentWriter(index);
    const cuts = decodeDetectorCuts(writer);
    const expected = segmentExpectedCount(handoff, index);
    invariant(
      cuts.length === expected,
      'VI3_OWNER_SEGMENT_CUT_COUNT',
    );
    const first = cuts[0];
    const last = cuts.at(-1);
    invariant(first && last, 'VI3_OWNER_SEGMENT_EMPTY');
    const policyRecord = writer.records[0];
    const preSealLast = writer.records.at(-1);
    invariant(
      policyRecord?.header?.kind === 'POLICY'
        && preSealLast !== undefined
        && policyRecord.header.rawSha256
          === handoff.detector.coverageCorePolicyDigest,
      'VI3_OWNER_SEGMENT_POLICY',
    );
    const acceptedProposals = cuts.flatMap(
      (cut) => cut.acceptedProposals,
    );
    const generations = new Set(
      cuts.map((cut) => cut.runtimeGeneration),
    );
    const descriptor = {
      schemaVersion: 'volume.forward.segment-seal.v1',
      profile: 'FORWARD_MEASUREMENT_SEGMENT_V1',
      segmentId: segmentId(handoff, index),
      captureId: handoff.captureId,
      activationId: handoff.activation.activationId,
      coverageRole: 'DETECTOR_COVERAGE',
      chainKey: handoff.detector.coverageChainKey,
      symbol: null,
      segmentIndex: index,
      previousTerminalHash: state.previousTerminalHash,
      corePolicyDigest: policyRecord.header.rawSha256,
      packetMeasurementPolicySha256:
        handoff.activation.packetMeasurementPolicySha256,
      detectorInputSourceId: handoff.detector.sourceId,
      detectorInputSourceDigest: handoff.detector.sourceDigest,
      coverage: {
        startMs: first.cutAtMs,
        endExclusiveMs:
          last.cutAtMs + DETECTOR_CADENCE_MS,
      },
      recordBounds: {
        firstHash: policyRecord.recordHash,
        sealedTailHash: preSealLast.recordHash,
        firstSequence: 0,
        lastSequence: writer.recordCount - 1,
        recordCount: writer.recordCount,
        byteCount: writer.bytesWritten,
      },
      nonTruncated: true,
      closeReason: 'MEASUREMENT_INTERVAL_COMPLETE',
      generationSummary: {
        count: generations.size,
        continuityGapCount: 0,
        unresolvedCount: 0,
      },
      detectorCoverage: {
        coverageChainKey: handoff.detector.coverageChainKey,
        firstCutOffset: first.cutOffset,
        lastCutOffset: last.cutOffset,
        cutCount: cuts.length,
        expectedCutCount: expected,
        missingCutCount: 0,
        maxGapMs: cuts.length > 1 ? DETECTOR_CADENCE_MS : 0,
        uncoveredMs: 0,
        firstCutDigest: first.cutDigest,
        lastCutDigest: last.cutDigest,
        complete: true,
      },
      acceptedProposals,
      lifecycleSummary: {
        proposalKeys: [],
        assertionCount: 0,
        openCount: 0,
        stateCounts: {
          OBSERVED: 0,
          ENTRY_RECORDED: 0,
          HOLDING: 0,
          TERMINAL_EXIT: 0,
          BLOCKED: 0,
          EXACT: 0,
        },
      },
      pseudoProposalExcludedCount: 0,
      quiescent: true,
    };
    const verification = writer.seal({
      localReceivedAtMs: last.localReceivedAtMs + 1,
      localMonotonicNs: BigInt(last.localMonotonicNs) + 1n,
      rawBytes: Buffer.from(canonicalJson(descriptor), 'utf8'),
      verificationProfile: 'TERMINAL_SEGMENT',
    });
    writer.close();
    writers[index] = null;
    const outputName =
      `${String(index).padStart(4, '0')}-${segmentId(handoff, index)}.jsonl`;
    const evidenceBytesSha256 =
      `sha256:${rawSha256(readFileSync(resolve(detectorDir, outputName)))}`;
    const sealedEntry = deepFreeze({
      segmentId: segmentId(handoff, index),
      segmentIndex: index,
      cutCount: cuts.length,
      terminalHash: verification.terminalHash,
      evidenceBytesSha256,
    });
      persistState(stateWith(state, {
        state: 'CAPTURING',
        currentSegmentIndex: null,
        previousTerminalHash: verification.terminalHash,
      sealedSegments: Object.freeze([
        ...state.sealedSegments,
        sealedEntry,
      ]),
    }));
  }

  const owner = {
    schemaVersion: OWNER_SCHEMA,
    evidenceRoot: root,
    ownerBindingDigest: binding.ownerBindingDigest,
    captureImplementationSha256:
      handoff.activation.captureImplementationSha256,
    asyncCloseRequired: false,
    loadRunnerCheckpoint() {
      return runnerCheckpoint;
    },
    rotateDetectorSegment(rotation) {
      invariant(
        plainRecord(rotation)
          && rotation.activationId
            === handoff.activation.activationId
          && rotation.captureId === handoff.captureId
          && rotation.chainKey
            === handoff.detector.coverageChainKey
          && Number.isSafeInteger(rotation.segmentIndex)
          && rotation.segmentIndex >= 0
          && rotation.segmentId
            === segmentId(handoff, rotation.segmentIndex)
          && rotation.firstCutOffset
            === rotation.segmentIndex * DETECTOR_CUTS_PER_SEGMENT
          && rotation.packetMeasurementPolicySha256
            === handoff.activation.packetMeasurementPolicySha256
          && rotation.detectorCoverageCorePolicyDigest
            === handoff.detector.coverageCorePolicyDigest,
        'VI3_OWNER_ROTATION_INVALID',
      );
      if (state.currentSegmentIndex === null) {
        invariant(
          rotation.segmentIndex === state.sealedSegments.length,
          'VI3_OWNER_ROTATION_START',
        );
      } else {
        invariant(
          rotation.segmentIndex === state.currentSegmentIndex + 1,
          'VI3_OWNER_ROTATION_SEQUENCE',
        );
        sealSegment(state.currentSegmentIndex);
      }
      persistState(stateWith(state, {
        state: 'CAPTURING',
        currentSegmentIndex: rotation.segmentIndex,
      }));
    },
    appendDetectorCoverage(cut) {
      invariant(
        plainRecord(cut)
          && state.currentSegmentIndex !== null
          && cut.segmentId
            === segmentId(handoff, state.currentSegmentIndex)
          && cut.cutOffset
            === state.currentSegmentIndex * DETECTOR_CUTS_PER_SEGMENT
              + decodeDetectorCuts(
                currentWriter(state.currentSegmentIndex),
              ).length,
        'VI3_OWNER_DETECTOR_APPEND_INVALID',
      );
      currentWriter(state.currentSegmentIndex).append({
        kind: 'DETECTOR_COVERAGE',
        localReceivedAtMs: cut.localReceivedAtMs,
        localMonotonicNs: BigInt(cut.localMonotonicNs),
        rawBytes: Buffer.from(canonicalJson(cut), 'utf8'),
      });
    },
    openProposalCapture(request) {
      invariant(
        plainRecord(request)
          && request.activationId
            === handoff.activation.activationId
          && request.captureId === handoff.captureId
          && request.detectorInputSourceId
            === handoff.detector.sourceId
          && request.detectorInputSourceDigest
            === handoff.detector.sourceDigest
          && request.entryQuoteNotional === '10.00'
          && request.maximumHoldMs === 60_000
          && request.admissionEndExclusiveMs
            === Date.parse(
              handoff.schedule.admissionEndExclusiveUtc,
            )
          && request.evidenceClosesAtMs
            === Date.parse(
              handoff.schedule.captureStopNotBeforeUtc,
            )
          && plainRecord(request.proposal)
          && typeof request.proposal.proposalId === 'string'
          && ENGINE_ID.test(request.proposal.proposalId),
        'VI3_OWNER_CAPTURE_REQUEST_INVALID',
      );
      const semantic = requestSemantic(handoff, request);
      const requestId = `vi3_capture_request_${domainSha256(
        'VI3_PUBLIC_LIFECYCLE_CAPTURE_REQUEST_V1',
        semantic,
      ).slice('sha256:'.length)}`;
      const record = deepFreeze({
        requestId,
        ...semantic,
      });
      const path = resolve(requestDir, `${requestId}.json`);
      if (existsSync(path)) {
        invariant(
          canonicalJson(readJson(path).value) === canonicalJson(record),
          'VI3_OWNER_CAPTURE_REQUEST_CONFLICT',
        );
      } else {
        writeExclusiveJson(path, record);
      }
      if (!state.scheduledRequestIds.includes(requestId)) {
        persistState(stateWith(state, {
          scheduledRequestIds: Object.freeze([
            ...state.scheduledRequestIds,
            requestId,
          ].sort()),
        }));
      }
    },
    persistRunnerCheckpoint(checkpoint) {
      invariant(
        plainRecord(checkpoint)
          && checkpoint.activationId
            === handoff.activation.activationId
          && checkpoint.captureId === handoff.captureId
          && SHA256.test(checkpoint.checkpointDigest),
        'VI3_OWNER_RUNNER_CHECKPOINT_INVALID',
      );
      const semantic = {
        schemaVersion: CHECKPOINT_ENVELOPE_SCHEMA,
        ownerBindingDigest: binding.ownerBindingDigest,
        runnerCheckpoint: checkpoint,
      };
      const envelope = deepFreeze({
        ...semantic,
        envelopeDigest: domainSha256(
          'VI3_RUNNER_CHECKPOINT_ENVELOPE_V1',
          semantic,
        ),
      });
      writeAtomicJson(checkpointPath, envelope);
      runnerCheckpoint = checkpoint;
    },
    sealDetectorCapture(request) {
      invariant(
        plainRecord(request)
          && state.currentSegmentIndex !== null
          && request.activationId
            === handoff.activation.activationId
          && request.captureId === handoff.captureId
          && request.recordedDetectorCutCount === expectedCuts
          && request.expectedDetectorCutCount === expectedCuts
          && request.terminalCutDigest
            === runnerCheckpoint?.previousCutDigest,
        'VI3_OWNER_TERMINAL_REQUEST_INVALID',
      );
      sealSegment(state.currentSegmentIndex);
      const captureRequests = state.scheduledRequestIds.map(
        (requestId) => readJson(
          resolve(requestDir, `${requestId}.json`),
        ).value,
      );
      const receipts = captureRequests.map((captureRequest) => {
        const path = resolve(
          receiptDir,
          `${captureRequest.requestId}.json`,
        );
        invariant(
          existsSync(path),
          'VI3_OWNER_LIFECYCLE_RECEIPT_MISSING',
        );
        return validateLifecycleReceipt(
          readJson(path).value,
          captureRequest,
        );
      });
      const terminal = {
        schemaVersion: TERMINAL_SCHEMA,
        handoffId: handoff.handoffId,
        activationId: handoff.activation.activationId,
        captureId: handoff.captureId,
        detectorSegments: state.sealedSegments,
        detectorCutCount: expectedCuts,
        scheduledCaptureRequestCount: captureRequests.length,
        lifecycleReceiptCount: receipts.length,
        lifecycleReceipts: receipts,
        state: 'DETECTOR_AND_LIFECYCLE_EVIDENCE_READY_FOR_V2_MANIFEST',
        consumerGate:
          'BLOCKED_UNTIL_TERMINAL_RESULT_INDEPENDENTLY_ACCEPTED',
        profitabilityClaim: false,
        authority: handoff.controls,
      };
      const terminalPath = resolve(root, 'terminal-handoff.json');
      const terminalHash = writeExclusiveJson(terminalPath, terminal);
      persistState(stateWith(state, {
        state: 'DETECTOR_SEALED',
        terminalHandoffSha256: terminalHash,
      }));
    },
    close() {
      if (closed) return;
      for (const writer of writers) writer?.close();
      unlinkSync(leasePath);
      fsyncDirectory(root);
      closed = true;
    },
    snapshot() {
      return deepFreeze({
        schemaVersion: OWNER_SCHEMA,
        evidenceRoot: root,
        ownerBindingDigest: binding.ownerBindingDigest,
        state: state.state,
        currentSegmentIndex: state.currentSegmentIndex,
        sealedSegmentCount: state.sealedSegments.length,
        scheduledCaptureRequestCount:
          state.scheduledRequestIds.length,
        runnerCheckpointRevision:
          runnerCheckpoint?.checkpointRevision ?? null,
        consumerGate:
          'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
        profitabilityClaim: false,
        executionAuthority: 'NONE',
      });
    },
  };
  return Object.freeze(owner);
}

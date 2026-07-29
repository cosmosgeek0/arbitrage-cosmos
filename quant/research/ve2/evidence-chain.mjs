import { createHash } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  openSync,
  readSync,
  renameSync,
  writeSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CORE_EVIDENCE_MODULE = resolve(
  HERE,
  '../../../server/dist/engine/volume/forwardMeasurementEvidence.js',
);
export const DEFAULT_CORE_MEASUREMENT_MODULE = resolve(
  HERE,
  '../../../server/dist/engine/volume/forwardMeasurement.js',
);
const DEFAULT_MAXIMUM_JSONL_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAXIMUM_JSONL_LINE_BYTES = 24 * 1024 * 1024;
const CHECKPOINT_SCHEMA = 've2.evidence-checkpoint.v1';
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function requireCoreSuccess(result, operation) {
  if (result?.ok !== true) {
    const reason = result?.reasonCode ?? 'UNKNOWN';
    const detail = result?.detailCode ?? 'UNKNOWN';
    throw new Error(`VE2_CORE_EVIDENCE_${operation}:${reason}:${detail}`);
  }
  return result;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function plainRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
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

function readBoundedFile(path, maximumBytes) {
  invariant(
    Number.isSafeInteger(maximumBytes) && maximumBytes > 0,
    'VE2_EVIDENCE_READ_BOUND',
  );
  const descriptor = openSync(resolve(path), 'r');
  try {
    const initialStat = fstatSync(descriptor);
    invariant(initialStat.isFile(), 'VE2_EVIDENCE_NOT_REGULAR_FILE');
    const initialSize = initialStat.size;
    invariant(
      Number.isSafeInteger(initialSize) && initialSize <= maximumBytes,
      'VE2_EVIDENCE_FILE_BOUND',
    );
    const chunks = [];
    let total = 0;
    while (true) {
      const capacity = Math.min(1024 * 1024, maximumBytes + 1 - total);
      invariant(capacity > 0, 'VE2_EVIDENCE_FILE_BOUND');
      const chunk = Buffer.allocUnsafe(capacity);
      const received = readSync(descriptor, chunk, 0, capacity, null);
      if (received === 0) break;
      total += received;
      invariant(total <= maximumBytes, 'VE2_EVIDENCE_FILE_BOUND');
      chunks.push(chunk.subarray(0, received));
    }
    return Buffer.concat(chunks, total);
  } finally {
    closeSync(descriptor);
  }
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('VE2_EVIDENCE_FILE_UTF8');
  }
}

function readBoundedUtf8File(path, maximumBytes) {
  return decodeUtf8(readBoundedFile(path, maximumBytes));
}

function checkpointBody(checkpoint) {
  return {
    schemaVersion: checkpoint.schemaVersion,
    outputPathDigest: checkpoint.outputPathDigest,
    byteCount: checkpoint.byteCount,
    recordCount: checkpoint.recordCount,
    terminalHash: checkpoint.terminalHash,
    policyDigest: checkpoint.policyDigest,
    sealed: checkpoint.sealed,
  };
}

function validateCheckpoint(checkpoint, outputPath) {
  invariant(
    plainRecord(checkpoint)
      && JSON.stringify(Object.keys(checkpoint).sort()) === JSON.stringify([
        'byteCount',
        'checkpointDigest',
        'outputPathDigest',
        'policyDigest',
        'recordCount',
        'schemaVersion',
        'sealed',
        'terminalHash',
      ])
      && checkpoint.schemaVersion === CHECKPOINT_SCHEMA
      && checkpoint.outputPathDigest
        === sha256(Buffer.from(resolve(outputPath), 'utf8'))
      && Number.isSafeInteger(checkpoint.byteCount)
      && checkpoint.byteCount > 0
      && Number.isSafeInteger(checkpoint.recordCount)
      && checkpoint.recordCount > 0
      && SHA256_PATTERN.test(checkpoint.terminalHash)
      && SHA256_PATTERN.test(checkpoint.policyDigest)
      && typeof checkpoint.sealed === 'boolean'
      && checkpoint.checkpointDigest === sha256(
        Buffer.from(canonicalJson(checkpointBody(checkpoint)), 'utf8'),
      ),
    'VE2_WRITER_CHECKPOINT_INVALID',
  );
  return checkpoint;
}

function readCheckpoint(path, outputPath) {
  const bytes = readBoundedFile(path, 64 * 1024);
  let checkpoint;
  try {
    checkpoint = JSON.parse(decodeUtf8(bytes));
  } catch {
    throw new Error('VE2_WRITER_CHECKPOINT_INVALID');
  }
  return validateCheckpoint(checkpoint, outputPath);
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
    invariant(written > 0, 'VE2_WRITER_SHORT_WRITE');
    offset += written;
  }
}

function writeCheckpoint(path, outputPath, state) {
  if (path === null) return;
  const body = {
    schemaVersion: CHECKPOINT_SCHEMA,
    outputPathDigest: sha256(Buffer.from(resolve(outputPath), 'utf8')),
    byteCount: state.byteCount,
    recordCount: state.recordCount,
    terminalHash: state.terminalHash,
    policyDigest: state.policyDigest,
    sealed: state.sealed,
  };
  const checkpoint = {
    ...body,
    checkpointDigest: sha256(
      Buffer.from(canonicalJson(body), 'utf8'),
    ),
  };
  const bytes = Buffer.from(`${canonicalJson(checkpoint)}\n`, 'utf8');
  const temporaryPath =
    `${resolve(path)}.${process.pid}.${Date.now()}.next`;
  const descriptor = openSync(temporaryPath, 'wx', 0o600);
  try {
    writeAll(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporaryPath, resolve(path));
  const directoryDescriptor = openSync(dirname(resolve(path)), 'r');
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
}

export async function loadCoreEvidenceModule(...unexpected) {
  invariant(
    unexpected.length === 0,
    'VE2_CORE_EVIDENCE_MODULE_OVERRIDE_FORBIDDEN',
  );
  const core = await import(
    pathToFileURL(DEFAULT_CORE_EVIDENCE_MODULE).href
  );
  for (const name of [
    'appendVolumeForwardMeasurementEvidence',
    'decodeVolumeForwardMeasurementEvidenceRawBytes',
    'parseVolumeForwardMeasurementEvidenceJsonl',
    'sealVolumeForwardMeasurementEvidenceChain',
    'serializeVolumeForwardMeasurementEvidenceRecordJsonl',
    'startVolumeForwardMeasurementEvidenceChain',
    'verifyVolumeForwardMeasurementEvidenceChain',
  ]) {
    invariant(typeof core[name] === 'function', `VE2_CORE_EVIDENCE_EXPORT:${name}`);
  }
  invariant(
    core.VOLUME_FORWARD_MEASUREMENT_EVIDENCE_SCHEMA ===
      'cosmos.engine.volume.forward-measurement-evidence.v1',
    'VE2_CORE_EVIDENCE_SCHEMA',
  );
  return core;
}

export async function loadCoreMeasurementModule(...unexpected) {
  invariant(
    unexpected.length === 0,
    'VE2_CORE_MEASUREMENT_MODULE_OVERRIDE_FORBIDDEN',
  );
  const core = await import(
    pathToFileURL(DEFAULT_CORE_MEASUREMENT_MODULE).href
  );
  for (const name of [
    'applyVolumeForwardDepthInput',
    'buildVolumeForwardDetectorProposalBinding',
    'buildVolumeForwardMeasurementPolicy',
    'buildVolumeForwardPointInTimeControls',
    'createVolumeForwardDepthState',
    'parseVolumeForwardDepthSnapshot',
    'parseVolumeForwardExchangeInfo',
    'parseVolumeForwardPublicPayload',
    'validateVolumeForwardMeasurementPolicy',
  ]) {
    invariant(
      typeof core[name] === 'function',
      `VE2_CORE_MEASUREMENT_EXPORT:${name}`,
    );
  }
  invariant(
    core.VOLUME_FORWARD_MEASUREMENT_POLICY_SCHEMA ===
      'cosmos.engine.volume.forward-measurement-policy.v1',
    'VE2_CORE_MEASUREMENT_POLICY_SCHEMA',
  );
  return core;
}

export async function createCoreEvidenceWriter(options) {
  invariant(
    options !== null
      && typeof options === 'object'
      && !Array.isArray(options),
    'VE2_WRITER_OPTIONS',
  );
  const allowedOptions = new Set([
    'chainId',
    'checkpointPath',
    'maxBytes',
    'maxRecords',
    'outputPath',
    'policyBytes',
    'policyReceivedAtMs',
    'policyReceivedMonotonicNs',
    'recoverTornTail',
    'resume',
  ]);
  for (const key of Object.keys(options)) {
    invariant(
      allowedOptions.has(key),
      `VE2_WRITER_OPTION_FORBIDDEN:${key}`,
    );
  }
  const {
    chainId,
    checkpointPath = null,
    maxBytes,
    maxRecords,
    outputPath,
    policyBytes,
    policyReceivedAtMs,
    policyReceivedMonotonicNs,
    recoverTornTail = false,
    resume = false,
  } = options;
  invariant(Number.isSafeInteger(maxBytes) && maxBytes > 0, 'VE2_WRITER_MAX_BYTES');
  invariant(Number.isSafeInteger(maxRecords) && maxRecords > 2, 'VE2_WRITER_MAX_RECORDS');
  invariant(typeof outputPath === 'string' && outputPath.endsWith('.jsonl'), 'VE2_WRITER_OUTPUT');
  invariant(
    checkpointPath === null
      || (
        typeof checkpointPath === 'string'
        && checkpointPath.endsWith('.checkpoint.json')
      ),
    'VE2_WRITER_CHECKPOINT_PATH',
  );
  invariant(
    typeof resume === 'boolean' && typeof recoverTornTail === 'boolean',
    'VE2_WRITER_RECOVERY_OPTIONS',
  );
  invariant(!recoverTornTail || resume, 'VE2_WRITER_RECOVERY_WITHOUT_RESUME');
  invariant(!resume || checkpointPath !== null, 'VE2_WRITER_RESUME_CHECKPOINT_REQUIRED');
  const resolvedOutputPath = resolve(outputPath);
  const resolvedCheckpointPath =
    checkpointPath === null ? null : resolve(checkpointPath);
  const core = await loadCoreEvidenceModule();
  const expectedPolicyDigest = sha256(Buffer.from(policyBytes));
  let records = [];
  let bytesWritten = 0;
  let closed = false;
  let cursor = null;
  let descriptor;

  function parseEvidenceBytes(bytes) {
    const parsed = requireCoreSuccess(
      core.parseVolumeForwardMeasurementEvidenceJsonl(
        decodeUtf8(bytes),
        {
          maximumJsonlBytes: maxBytes,
          requireMeasurementBundle: false,
          requireSealed: false,
        },
      ),
      'PARSE_RESUME',
    );
    invariant(
      parsed.verification.chainId === chainId,
      'VE2_WRITER_RESUME_CHAIN_ID_MISMATCH',
    );
    invariant(
      parsed.verification.policyDigest === expectedPolicyDigest,
      'VE2_WRITER_RESUME_POLICY_MISMATCH',
    );
    return parsed.verification;
  }

  function checkpointMatches(checkpoint, verification, byteCount) {
    return checkpoint.byteCount === byteCount
      && checkpoint.recordCount === verification.recordCount
      && checkpoint.terminalHash === verification.terminalHash
      && checkpoint.policyDigest === verification.policyDigest
      && checkpoint.sealed === verification.sealed;
  }

  function checkpointCurrent() {
    writeCheckpoint(
      resolvedCheckpointPath,
      resolvedOutputPath,
      {
        byteCount: bytesWritten,
        recordCount: records.length,
        terminalHash: cursor.previousHash,
        policyDigest: cursor.policyDigest,
        sealed: cursor.sealed,
      },
    );
  }

  if (resume) {
    const checkpoint = readCheckpoint(
      resolvedCheckpointPath,
      resolvedOutputPath,
    );
    let rawBytes = readBoundedFile(resolvedOutputPath, maxBytes);
    invariant(rawBytes.length > 0, 'VE2_WRITER_RESUME_EMPTY');
    let verification;
    if (rawBytes[rawBytes.length - 1] === 0x0a) {
      verification = parseEvidenceBytes(rawBytes);
      invariant(
        checkpoint.byteCount <= rawBytes.length,
        'VE2_WRITER_CHECKPOINT_AHEAD',
      );
    } else {
      invariant(recoverTornTail, 'VE2_WRITER_TORN_TAIL');
      invariant(
        checkpoint.byteCount < rawBytes.length,
        'VE2_WRITER_CHECKPOINT_AHEAD',
      );
      const prefix = rawBytes.subarray(0, checkpoint.byteCount);
      const suffix = rawBytes.subarray(checkpoint.byteCount);
      invariant(
        prefix.length > 0 && prefix[prefix.length - 1] === 0x0a,
        'VE2_WRITER_CHECKPOINT_BOUNDARY',
      );
      invariant(
        !suffix.includes(0x0a) && suffix[0] === 0x7b,
        'VE2_WRITER_TORN_TAIL_AMBIGUOUS',
      );
      const prefixVerification = parseEvidenceBytes(prefix);
      invariant(
        checkpointMatches(
          checkpoint,
          prefixVerification,
          prefix.length,
        ),
        'VE2_WRITER_CHECKPOINT_MISMATCH',
      );
      let completeWithoutNewline = false;
      try {
        parseEvidenceBytes(Buffer.concat([
          rawBytes,
          Buffer.from('\n', 'utf8'),
        ]));
        completeWithoutNewline = true;
      } catch {
        // Only an incomplete final serialized record is recoverable.
      }
      invariant(
        !completeWithoutNewline,
        'VE2_WRITER_TORN_TAIL_COMPLETE_RECORD',
      );
      const recoveryDescriptor = openSync(resolvedOutputPath, 'r+');
      try {
        ftruncateSync(recoveryDescriptor, checkpoint.byteCount);
        fsyncSync(recoveryDescriptor);
      } finally {
        closeSync(recoveryDescriptor);
      }
      rawBytes = prefix;
      verification = prefixVerification;
    }
    invariant(!verification.sealed, 'VE2_WRITER_RESUME_SEALED');
    records = [...verification.records];
    cursor = verification.cursor;
    bytesWritten = rawBytes.length;
    descriptor = openSync(resolvedOutputPath, 'a+', 0o600);
    checkpointCurrent();
  } else {
    descriptor = openSync(resolvedOutputPath, 'ax+', 0o600);
  }

  function serializeRecord(record) {
    const serialized = requireCoreSuccess(
      core.serializeVolumeForwardMeasurementEvidenceRecordJsonl(record),
      'SERIALIZE_RECORD',
    );
    return Buffer.from(serialized.line, 'utf8');
  }

  function writeRecord(record, nextCursor) {
    invariant(!closed, 'VE2_WRITER_CLOSED');
    invariant(records.length < maxRecords, 'VE2_WRITER_RECORD_BOUND');
    const bytes = serializeRecord(record);
    invariant(bytesWritten + bytes.length <= maxBytes, 'VE2_WRITER_BYTE_BOUND');
    writeAll(descriptor, bytes);
    fsyncSync(descriptor);
    bytesWritten += bytes.length;
    records.push(record);
    cursor = nextCursor;
    checkpointCurrent();
    return bytes.length;
  }

  if (!resume) {
    try {
      const started = requireCoreSuccess(
        core.startVolumeForwardMeasurementEvidenceChain({
          chainId,
          localReceivedAtMs: policyReceivedAtMs,
          localMonotonicNs: String(policyReceivedMonotonicNs),
          rawPayload: Uint8Array.from(policyBytes),
        }),
        'START',
      );
      writeRecord(started.record, started.cursor);
    } catch (error) {
      closeSync(descriptor);
      closed = true;
      throw error;
    }
  }

  function append({
    kind,
    localReceivedAtMs,
    localMonotonicNs,
    rawBytes,
    sourceEndpoint,
    sourceStream,
    sourceSymbol,
    sourceTransport,
  }) {
    const step = requireCoreSuccess(
      core.appendVolumeForwardMeasurementEvidence(cursor, {
        kind,
        localReceivedAtMs,
        localMonotonicNs: String(localMonotonicNs),
        rawPayload: Uint8Array.from(rawBytes),
        ...(sourceEndpoint === undefined ? {} : { sourceEndpoint }),
        ...(sourceStream === undefined ? {} : { sourceStream }),
        ...(sourceSymbol === undefined ? {} : { sourceSymbol }),
        ...(sourceTransport === undefined ? {} : { sourceTransport }),
      }),
      'APPEND',
    );
    writeRecord(step.record, step.cursor);
    return step.record;
  }

  function previewSeal({
    localReceivedAtMs,
    localMonotonicNs,
    rawBytes,
  }) {
    invariant(!closed, 'VE2_WRITER_CLOSED');
    invariant(cursor.generationOpen === false, 'VE2_WRITER_GENERATION_LEFT_OPEN');
    const step = requireCoreSuccess(
      core.sealVolumeForwardMeasurementEvidenceChain(cursor, {
        localReceivedAtMs,
        localMonotonicNs: String(localMonotonicNs),
        rawPayload: Uint8Array.from(rawBytes),
      }),
      'PREVIEW_SEAL',
    );
    return Object.freeze({
      byteCount: bytesWritten + serializeRecord(step.record).length,
      record: step.record,
      recordCount: records.length + 1,
    });
  }

  function seal({
    localReceivedAtMs,
    localMonotonicNs,
    rawBytes,
    verificationProfile,
  }) {
    invariant(
      verificationProfile === 'COMPLETE_MEASUREMENT'
        || verificationProfile === 'INCOMPLETE_PRESERVATION'
        || verificationProfile === 'TERMINAL_SEGMENT',
      'VE2_WRITER_VERIFICATION_PROFILE',
    );
    const step = requireCoreSuccess(
      core.sealVolumeForwardMeasurementEvidenceChain(cursor, {
        localReceivedAtMs,
        localMonotonicNs: String(localMonotonicNs),
        rawPayload: Uint8Array.from(rawBytes),
      }),
      'SEAL',
    );
    writeRecord(step.record, step.cursor);
    const completeMeasurement =
      verificationProfile === 'COMPLETE_MEASUREMENT';
    const terminalSegment =
      verificationProfile === 'TERMINAL_SEGMENT';
    const verified = requireCoreSuccess(
      core.verifyVolumeForwardMeasurementEvidenceChain(records, {
        expectedPolicyDigest: cursor.policyDigest,
        expectedTerminalHash: step.record.recordHash,
        requireSealed:
          completeMeasurement || terminalSegment,
        requireMeasurementBundle:
          completeMeasurement || terminalSegment,
      }),
      'VERIFY',
    );
    return verified.verification;
  }

  function sealBuilt({
    buildRawBytes,
    localReceivedAtMs,
    localMonotonicNs,
    verificationProfile,
  }) {
    invariant(typeof buildRawBytes === 'function', 'VE2_WRITER_SEAL_BUILDER');
    let byteCount = 0;
    let rawBytes;
    let preview;
    for (let iteration = 0; iteration < 16; iteration += 1) {
      rawBytes = Buffer.from(buildRawBytes(Object.freeze({
        byteCount,
        recordCount: records.length + 1,
        sealedTailHash: cursor.previousHash,
      })));
      preview = previewSeal({
        localReceivedAtMs,
        localMonotonicNs,
        rawBytes,
      });
      if (preview.byteCount === byteCount) {
        return seal({
          localReceivedAtMs,
          localMonotonicNs,
          rawBytes,
          verificationProfile,
        });
      }
      byteCount = preview.byteCount;
    }
    throw new Error('VE2_WRITER_SEAL_BYTE_COUNT_NOT_STABLE');
  }

  function close() {
    if (closed) return;
    fsyncSync(descriptor);
    closeSync(descriptor);
    closed = true;
  }

  return Object.freeze({
    append,
    close,
    core,
    records,
    seal,
    sealBuilt,
    previewSeal,
    get bytesWritten() {
      return bytesWritten;
    },
    get cursor() {
      return cursor;
    },
    get recordCount() {
      return records.length;
    },
    get remainingBytes() {
      return maxBytes - bytesWritten;
    },
    get remainingRecords() {
      return maxRecords - records.length;
    },
  });
}

export async function parseCoreEvidenceFile(
  path,
  options = {},
) {
  invariant(
    options !== null
      && typeof options === 'object'
      && !Array.isArray(options),
    'VE2_PARSE_OPTIONS',
  );
  const allowedOptions = new Set([
    'expectedPolicyDigest',
    'expectedTerminalHash',
    'maximumJsonlBytes',
    'maximumLineBytes',
    'verificationProfile',
  ]);
  for (const key of Object.keys(options)) {
    invariant(
      allowedOptions.has(key),
      `VE2_PARSE_OPTION_FORBIDDEN:${key}`,
    );
  }
  const {
    maximumJsonlBytes,
    maximumLineBytes,
    verificationProfile = 'COMPLETE_MEASUREMENT',
    expectedPolicyDigest = null,
    expectedTerminalHash = null,
  } = options;
  invariant(
    verificationProfile === 'COMPLETE_MEASUREMENT'
      || verificationProfile === 'INCOMPLETE_PRESERVATION',
    'VE2_PARSE_VERIFICATION_PROFILE',
  );
  const completeMeasurement =
    verificationProfile === 'COMPLETE_MEASUREMENT';
  if (completeMeasurement) {
    invariant(
      typeof expectedPolicyDigest === 'string'
        && /^sha256:[a-f0-9]{64}$/.test(expectedPolicyDigest),
      'VE2_PARSE_EXPECTED_POLICY_DIGEST_REQUIRED',
    );
    invariant(
      typeof expectedTerminalHash === 'string'
        && /^sha256:[a-f0-9]{64}$/.test(expectedTerminalHash),
      'VE2_PARSE_EXPECTED_TERMINAL_HASH_REQUIRED',
    );
  }
  const core = await loadCoreEvidenceModule();
  const jsonlLimit = maximumJsonlBytes ?? DEFAULT_MAXIMUM_JSONL_BYTES;
  invariant(
    Number.isSafeInteger(jsonlLimit)
      && jsonlLimit > 0
      && jsonlLimit <= DEFAULT_MAXIMUM_JSONL_BYTES,
    'VE2_EVIDENCE_JSONL_LIMIT',
  );
  invariant(
    maximumLineBytes === undefined
      || (
        Number.isSafeInteger(maximumLineBytes)
        && maximumLineBytes > 0
        && maximumLineBytes <= DEFAULT_MAXIMUM_JSONL_LINE_BYTES
      ),
    'VE2_EVIDENCE_LINE_LIMIT',
  );
  const jsonl = readBoundedUtf8File(path, jsonlLimit);
  const parsed = requireCoreSuccess(
    core.parseVolumeForwardMeasurementEvidenceJsonl(jsonl, {
      ...(maximumJsonlBytes === undefined ? {} : { maximumJsonlBytes }),
      ...(maximumLineBytes === undefined ? {} : { maximumLineBytes }),
      requireSealed: completeMeasurement,
      requireMeasurementBundle: completeMeasurement,
      ...(expectedPolicyDigest === null ? {} : { expectedPolicyDigest }),
      ...(expectedTerminalHash === null ? {} : { expectedTerminalHash }),
    }),
    'PARSE',
  );
  return Object.freeze({
    core,
    jsonl,
    verification: parsed.verification,
  });
}

export function decodeCoreEvidenceRawBytes(core, record) {
  return requireCoreSuccess(
    core.decodeVolumeForwardMeasurementEvidenceRawBytes(record),
    'DECODE',
  ).bytes;
}

#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as evidenceModule from '../dist/engine/volume/forwardMeasurementEvidence.js';

const {
  VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE,
  VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS,
  VOLUME_FORWARD_MEASUREMENT_EVIDENCE_SCHEMA,
  VOLUME_FORWARD_MEASUREMENT_EVIDENCE_SCHEMA_VERSION,
  VOLUME_FORWARD_MEASUREMENT_LOCAL_ENDPOINT,
  VOLUME_FORWARD_MEASUREMENT_PUBLIC_REST_ENDPOINTS,
  VOLUME_FORWARD_MEASUREMENT_PUBLIC_REST_RESOURCES,
  VOLUME_FORWARD_MEASUREMENT_PUBLIC_STREAM_ENDPOINTS,
  appendVolumeForwardMeasurementEvidence,
  decodeVolumeForwardMeasurementEvidenceRawBytes,
  parseVolumeForwardMeasurementEvidenceJsonl,
  sealVolumeForwardMeasurementEvidenceChain,
  serializeVolumeForwardMeasurementEvidenceJsonl,
  serializeVolumeForwardMeasurementEvidenceRecordJsonl,
  sha256VolumeForwardMeasurementEvidenceBytes,
  startVolumeForwardMeasurementEvidenceChain,
  verifyVolumeForwardMeasurementEvidenceChain,
} = evidenceModule;

const BASE_RECEIVED_AT_MS = 2_000_000_000_000;
const POLICY_BYTES = Buffer.from(
  ' {\n  "mode": "MEASUREMENT_ONLY",\n  "outcomesOpened": false,\n'
  + '  "defaultEnabled": false,\n  "killSwitch": true\n }\n',
  'utf8',
);

function raw(value) {
  return Buffer.from(value, 'utf8');
}

function expectSuccess(result) {
  assert.equal(
    result.ok,
    true,
    result.ok ? undefined : `${result.reasonCode}/${result.detailCode}`,
  );
  return result;
}

function expectFailure(result, reasonCode, detailCode, recordIndex) {
  assert.deepEqual(
    {
      ok: result.ok,
      status: result.status,
      reasonCode: result.reasonCode,
      detailCode: result.detailCode,
      ...(recordIndex === undefined ? {} : { recordIndex: result.recordIndex }),
    },
    {
      ok: false,
      status: 'REJECTED',
      reasonCode,
      detailCode,
      ...(recordIndex === undefined ? {} : { recordIndex }),
    },
  );
  return result;
}

function mutableRecord(record) {
  return JSON.parse(JSON.stringify(record));
}

function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    assert.ok(Number.isSafeInteger(value) && !Object.is(value, -0));
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(',')}}`;
}

function digestBytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function detectorCoverageCutDigest(value) {
  const semantic = { ...value };
  delete semantic.cutDigest;
  const hash = createHash('sha256');
  hash.update('VOLUME_FORWARD_DETECTOR_COVERAGE_CUT_V1', 'utf8');
  hash.update(Uint8Array.of(0));
  hash.update(canonicalJson(semantic), 'utf8');
  return `sha256:${hash.digest('hex')}`;
}

function recomputeSelfConsistentChain(records) {
  let previousHash = null;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const rawBytes = Buffer.from(record.rawBase64, 'base64');
    record.header.previousHash = previousHash;
    record.header.rawByteLength = rawBytes.byteLength;
    record.header.rawSha256 = digestBytes(rawBytes);
    record.header.sequence = index;
    if (record.header.kind === 'TERMINAL_SEAL') {
      record.header.sealedRecordCount = records.length;
      record.header.sealedTailHash = previousHash;
      record.header.terminal = true;
    }
    const hash = createHash('sha256');
    hash.update(
      'cosmos.engine.volume.forward-measurement-evidence.record.v1',
      'utf8',
    );
    hash.update(Uint8Array.of(0));
    hash.update(canonicalJson(record.header), 'utf8');
    hash.update(Uint8Array.of(0));
    hash.update(rawBytes);
    record.recordHash = `sha256:${hash.digest('hex')}`;
    previousHash = record.recordHash;
  }
  return records;
}

function makeCompleteChain({
  chainId = 'volume-forward-evidence-test',
  policyBytes = POLICY_BYTES,
} = {}) {
  let localReceivedAtMs = BASE_RECEIVED_AT_MS;
  let localMonotonicNs = 10_000n;
  const records = [];

  const started = expectSuccess(startVolumeForwardMeasurementEvidenceChain({
    chainId,
    localReceivedAtMs,
    localMonotonicNs: String(localMonotonicNs),
    rawPayload: policyBytes,
  }));
  records.push(started.record);
  let cursor = started.cursor;

  const append = (kind, payload, source = {}) => {
    localReceivedAtMs += 1;
    localMonotonicNs += 10n;
    const result = expectSuccess(appendVolumeForwardMeasurementEvidence(
      cursor,
      {
        kind,
        localReceivedAtMs,
        localMonotonicNs: String(localMonotonicNs),
        rawPayload: payload,
        ...source,
      },
    ));
    records.push(result.record);
    cursor = result.cursor;
    return result.record;
  };

  append('GENERATION_OPEN', raw('{"generation":1,"reason":"CAPTURE_START"}'));
  append(
    'EXCHANGE_INFO',
    raw('{"serverTime":2000000000001,"symbols":[{"symbol":"BTCUSDT","filters":[]}]}'),
    {
      sourceEndpoint: 'https://data-api.binance.vision',
      sourceSymbol: 'BTCUSDT',
      sourceStream: '/api/v3/exchangeInfo',
      sourceTransport: 'BINANCE_SPOT_PUBLIC_REST',
    },
  );
  append(
    'DEPTH_SNAPSHOT',
    raw('{"lastUpdateId":100,"bids":[["100","1"]],"asks":[["101","2"]]}'),
    {
      sourceEndpoint: 'https://data-api.binance.vision',
      sourceSymbol: 'BTCUSDT',
      sourceStream: '/api/v3/depth',
      sourceTransport: 'BINANCE_SPOT_PUBLIC_REST',
    },
  );
  append(
    'DEPTH_DIFF',
    raw('{"e":"depthUpdate","E":2000000000002,"s":"BTCUSDT","U":101,"u":102,"b":[],"a":[]}'),
    {
      sourceEndpoint: 'wss://data-stream.binance.vision',
      sourceSymbol: 'BTCUSDT',
      sourceStream: 'btcusdt@depth@100ms',
      sourceTransport: 'BINANCE_SPOT_PUBLIC_STREAM',
    },
  );
  append(
    'TRADE',
    raw('{"e":"trade","E":2000000000003,"s":"BTCUSDT","t":7,"p":"100.5","q":"0.1","T":2000000000002,"m":false}'),
    {
      sourceEndpoint: 'wss://data-stream.binance.vision',
      sourceSymbol: 'BTCUSDT',
      sourceStream: 'btcusdt@trade',
      sourceTransport: 'BINANCE_SPOT_PUBLIC_STREAM',
    },
  );
  append(
    'AGG_TRADE',
    raw('{"e":"aggTrade","E":2000000000004,"s":"BTCUSDT","a":8,"p":"100.5","q":"0.1","f":7,"l":7,"T":2000000000003,"m":false}'),
    {
      sourceEndpoint: 'wss://data-stream.binance.vision',
      sourceSymbol: 'BTCUSDT',
      sourceStream: 'btcusdt@aggTrade',
      sourceTransport: 'BINANCE_SPOT_PUBLIC_STREAM',
    },
  );
  append(
    'BOOK_TICKER',
    raw('{"u":102,"s":"BTCUSDT","b":"100","B":"1","a":"101","A":"2"}'),
    {
      sourceEndpoint: 'wss://data-stream.binance.vision',
      sourceSymbol: 'BTCUSDT',
      sourceStream: 'btcusdt@bookTicker',
      sourceTransport: 'BINANCE_SPOT_PUBLIC_STREAM',
    },
  );
  append(
    'CONFIG_STATE',
    raw('{"defaultEnabled":false,"mode":"SHADOW_RECORD_ONLY","revision":"cfg-1"}'),
  );
  append(
    'KILL_STATE',
    raw('{"engaged":true,"revision":"kill-1"}'),
  );
  append(
    'CONTINUITY',
    raw('{"generation":1,"previousFinalUpdateId":100,"firstUpdateId":101,"finalUpdateId":102,"state":"CONTIGUOUS"}'),
  );
  append(
    'DETECTOR_PROPOSAL',
    raw('{"proposalDigest":"vprop_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","proposalId":"proposal-1","symbol":"BTCUSDT"}'),
  );
  append(
    'LIFECYCLE_RECORD',
    raw('{"mode":"SHADOW_RECORD_ONLY","proposalId":"proposal-1","state":"OBSERVED"}'),
  );
  append('GENERATION_CLOSE', raw('{"generation":1,"reason":"CAPTURE_STOP"}'));

  localReceivedAtMs += 1;
  localMonotonicNs += 10n;
  const sealed = expectSuccess(sealVolumeForwardMeasurementEvidenceChain(
    cursor,
    {
      localReceivedAtMs,
      localMonotonicNs: String(localMonotonicNs),
      rawPayload: raw('{"reason":"CAPTURE_COMPLETE"}'),
    },
  ));
  records.push(sealed.record);
  cursor = sealed.cursor;

  return {
    cursor,
    policyBytes,
    records,
  };
}

function makeDetectorCoverageChain({
  acceptedProposals = [],
  segmentIndex = 0,
  firstCutOffset = 0,
  previousTerminalHash = segmentIndex === 0
    ? null
    : `sha256:${'8'.repeat(64)}`,
  previousCutDigest = firstCutOffset === 0
    ? null
    : `sha256:${'9'.repeat(64)}`,
} = {}) {
  const started = expectSuccess(startVolumeForwardMeasurementEvidenceChain({
    chainId:
      `detector-coverage-${acceptedProposals.length}-${segmentIndex}`,
    localReceivedAtMs: BASE_RECEIVED_AT_MS,
    localMonotonicNs: '10000',
    rawPayload: POLICY_BYTES,
  }));
  const records = [started.record];
  let cursor = started.cursor;
  let priorCutDigest = previousCutDigest;
  const cuts = [];
  for (let relativeCutOffset = 0;
    relativeCutOffset < 2;
    relativeCutOffset += 1) {
    const cutOffset = firstCutOffset + relativeCutOffset;
    const cutAtMs = BASE_RECEIVED_AT_MS + 100 + cutOffset * 2_000;
    const localReceivedAtMs = relativeCutOffset === 0
      ? cutAtMs + 1
      : cutAtMs + 1_999;
    const localMonotonicNs = String(
      10_000_000n
        + BigInt(localReceivedAtMs - BASE_RECEIVED_AT_MS) * 1_000_000n,
    );
    const cut = {
      schemaVersion: 'volume.forward.detector-coverage-cut.v1',
      profile: 'FORWARD_MEASUREMENT_SEGMENT_V1',
      captureId: 'detector-coverage-capture-0001',
      activationId: `ve2_activation_${'1'.repeat(64)}`,
      segmentId: `ve2_segment_${'2'.repeat(64)}`,
      chainKey: 'detector-coverage-chain-0001',
      detectorInputSourceId: 'local://volume-detector/proposals/v1',
      detectorInputSourceDigest: `sha256:${'3'.repeat(64)}`,
      runtimeGeneration: 1,
      detectorTickRevision: relativeCutOffset + 1,
      cutOffset,
      cutAtMs,
      localReceivedAtMs,
      localMonotonicNs,
      cadenceMs: 2_000,
      configurationRevision: `config-${relativeCutOffset + 1}`,
      configurationDigest:
        `sha256:${String(relativeCutOffset + 4).repeat(64)}`,
      strategyEnabled: false,
      killSwitchEngaged: true,
      evaluationUniverseDigest:
        `sha256:${String(relativeCutOffset + 6).repeat(64)}`,
      evaluationUniverseCount:
        relativeCutOffset === 0 ? acceptedProposals.length : 3,
      pseudoProposalExcludedCount: 0,
      acceptedProposals: relativeCutOffset === 0 ? acceptedProposals : [],
      observerDropCount: 0,
      observerFailureCount: 0,
      previousCutDigest: priorCutDigest,
      cutDigest: '',
      complete: true,
    };
    cut.cutDigest = detectorCoverageCutDigest(cut);
    const appended = expectSuccess(appendVolumeForwardMeasurementEvidence(
      cursor,
      {
        kind: 'DETECTOR_COVERAGE',
        localReceivedAtMs,
        localMonotonicNs,
        rawPayload: raw(canonicalJson(cut)),
      },
    ));
    records.push(appended.record);
    cursor = appended.cursor;
    cuts.push(cut);
    priorCutDigest = cut.cutDigest;
  }
  const acceptedProposalKeys = acceptedProposals.map((proposal) => ({
    proposalId: proposal.proposalId,
    proposalRevision: proposal.proposalRevision,
    proposalDigest: proposal.proposalDigest,
    symbol: proposal.symbol,
  }));
  const descriptor = {
    schemaVersion: 'volume.forward.segment-seal.v1',
    profile: 'FORWARD_MEASUREMENT_SEGMENT_V1',
    segmentId: `ve2_segment_${'2'.repeat(64)}`,
    captureId: 'detector-coverage-capture-0001',
    activationId: `ve2_activation_${'1'.repeat(64)}`,
    coverageRole: 'DETECTOR_COVERAGE',
    chainKey: 'detector-coverage-chain-0001',
    symbol: null,
    segmentIndex,
    previousTerminalHash,
    corePolicyDigest: records[0].header.rawSha256,
    packetMeasurementPolicySha256: '4'.repeat(64),
    detectorInputSourceId: 'local://volume-detector/proposals/v1',
    detectorInputSourceDigest: `sha256:${'3'.repeat(64)}`,
    coverage: {
      startMs: cuts[0].cutAtMs,
      endExclusiveMs: cuts.at(-1).cutAtMs + 2_000,
    },
    recordBounds: {
      firstHash: records[0].recordHash,
      sealedTailHash: records.at(-1).recordHash,
      firstSequence: 0,
      lastSequence: records.length - 1,
      recordCount: records.length,
      byteCount: records.reduce(
        (total, record) => (
          total + Buffer.byteLength(canonicalJson(record), 'utf8') + 1
        ),
        0,
      ),
    },
    nonTruncated: true,
    closeReason: 'MEASUREMENT_INTERVAL_COMPLETE',
    generationSummary: {
      count: 1,
      continuityGapCount: 0,
      unresolvedCount: 0,
    },
    detectorCoverage: {
      coverageChainKey: 'detector-coverage-chain-0001',
      firstCutOffset,
      lastCutOffset: firstCutOffset + 1,
      cutCount: 2,
      expectedCutCount: 2,
      missingCutCount: 0,
      maxGapMs: 2_000,
      uncoveredMs: 0,
      firstCutDigest: cuts[0].cutDigest,
      lastCutDigest: cuts.at(-1).cutDigest,
      complete: true,
    },
    acceptedProposals: acceptedProposalKeys,
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
  const sealed = expectSuccess(sealVolumeForwardMeasurementEvidenceChain(
    cursor,
    {
      localReceivedAtMs: cuts.at(-1).localReceivedAtMs + 1,
      localMonotonicNs: String(
        BigInt(cuts.at(-1).localMonotonicNs) + 1n,
      ),
      rawPayload: raw(canonicalJson(descriptor)),
    },
  ));
  records.push(sealed.record);
  return { cuts, descriptor, records };
}

function replaceRawJson(records, index, value) {
  records[index].rawBase64 = raw(canonicalJson(value)).toString('base64');
  return recomputeSelfConsistentChain(records);
}

function makeChainWithIncompleteReconnect({
  includeContinuity,
  includeDepthDiff = true,
  chainId,
}) {
  const complete = makeCompleteChain({ chainId });
  const records = complete.records.slice(0, -1);
  let cursor = expectSuccess(
    verifyVolumeForwardMeasurementEvidenceChain(records, {
      requireSealed: false,
    }),
  ).verification.cursor;
  let localReceivedAtMs = cursor.lastLocalReceivedAtMs;
  let localMonotonicNs = BigInt(cursor.lastLocalMonotonicNs);
  const append = (input) => {
    localReceivedAtMs += 1;
    localMonotonicNs += 1n;
    const result = expectSuccess(appendVolumeForwardMeasurementEvidence(
      cursor,
      {
        localReceivedAtMs,
        localMonotonicNs: String(localMonotonicNs),
        ...input,
      },
    ));
    records.push(result.record);
    cursor = result.cursor;
  };
  append({
    kind: 'GENERATION_OPEN',
    rawPayload: raw('{"generation":2,"reason":"RECONNECT"}'),
  });
  if (includeDepthDiff) {
    append({
      kind: 'DEPTH_DIFF',
      rawPayload: raw('{"e":"depthUpdate","s":"BTCUSDT","U":200,"u":201,"b":[],"a":[]}'),
      sourceEndpoint: 'wss://data-stream.binance.vision',
      sourceSymbol: 'BTCUSDT',
      sourceStream: 'btcusdt@depth@100ms',
      sourceTransport: 'BINANCE_SPOT_PUBLIC_STREAM',
    });
  }
  if (includeContinuity) {
    append({
      kind: 'CONTINUITY',
      rawPayload: raw(
        '{"generation":2,"state":"RECONNECT_REQUIRED","reason":"GAP"}',
      ),
    });
  }
  append({
    kind: 'GENERATION_CLOSE',
    rawPayload: raw('{"generation":2,"reason":"RECONNECT_ABORTED"}'),
  });
  localReceivedAtMs += 1;
  localMonotonicNs += 1n;
  const sealed = expectSuccess(sealVolumeForwardMeasurementEvidenceChain(
    cursor,
    {
      localReceivedAtMs,
      localMonotonicNs: String(localMonotonicNs),
      rawPayload: raw('{"reason":"CAPTURE_TERMINATED"}'),
    },
  ));
  records.push(sealed.record);
  return records;
}

test('policy bytes are the exact first immutable record and bind the whole chain', () => {
  const started = expectSuccess(startVolumeForwardMeasurementEvidenceChain({
    chainId: 'policy-first',
    localReceivedAtMs: BASE_RECEIVED_AT_MS,
    localMonotonicNs: '100',
    rawPayload: POLICY_BYTES,
  }));

  assert.equal(started.record.header.kind, 'POLICY');
  assert.equal(started.record.header.sequence, 0);
  assert.equal(started.record.header.generation, 0);
  assert.equal(started.record.header.previousHash, null);
  assert.equal(started.record.header.schema, VOLUME_FORWARD_MEASUREMENT_EVIDENCE_SCHEMA);
  assert.equal(
    started.record.header.schemaVersion,
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_SCHEMA_VERSION,
  );
  assert.equal(started.record.header.sourceEndpoint, VOLUME_FORWARD_MEASUREMENT_LOCAL_ENDPOINT);
  assert.equal(started.record.header.sourceTransport, 'LOCAL');
  assert.equal(started.record.header.sourceStream, null);
  assert.equal(started.record.header.sourceSymbol, null);
  assert.equal(
    started.record.header.policyDigest,
    sha256VolumeForwardMeasurementEvidenceBytes(POLICY_BYTES),
  );
  assert.equal(started.record.header.rawSha256, started.record.header.policyDigest);
  assert.equal(started.record.rawBase64, POLICY_BYTES.toString('base64'));
  assert.ok(Object.isFrozen(started.record));
  assert.ok(Object.isFrozen(started.record.header));
  assert.ok(Object.isFrozen(started.record.header.authority));
  assert.ok(Object.isFrozen(started.cursor));
  assert.deepEqual(Object.keys(started.cursor), [
    'chainId',
    'cumulativeRawPayloadBytes',
    'generation',
    'generationOpen',
    'lastLocalReceivedAtMs',
    'lastLocalMonotonicNs',
    'nextSequence',
    'policyDigest',
    'previousHash',
    'sealed',
  ]);
  assert.equal(
    started.cursor.cumulativeRawPayloadBytes,
    POLICY_BYTES.byteLength,
  );

  const decoded = expectSuccess(
    decodeVolumeForwardMeasurementEvidenceRawBytes(started.record),
  );
  assert.deepEqual(Buffer.from(decoded.bytes), POLICY_BYTES);

  const chain = makeCompleteChain();
  const nonPolicyFirst = chain.records.map(mutableRecord);
  nonPolicyFirst[0].header.kind = 'GENERATION_OPEN';
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(nonPolicyFirst),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MIXED_POLICY,
    'POLICY_NOT_FIRST',
    0,
  );
});

test('raw payload bytes preserve JSON whitespace and arbitrary non-UTF8 octets', () => {
  const started = expectSuccess(startVolumeForwardMeasurementEvidenceChain({
    chainId: 'raw-octets',
    localReceivedAtMs: BASE_RECEIVED_AT_MS,
    localMonotonicNs: '1',
    rawPayload: POLICY_BYTES,
  }));
  const opened = expectSuccess(appendVolumeForwardMeasurementEvidence(
    started.cursor,
    {
      kind: 'GENERATION_OPEN',
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 1,
      localMonotonicNs: '2',
      rawPayload: raw(' {\n "generation" : 1 \n}\n'),
    },
  ));
  const nonUtf8 = Buffer.from([0x00, 0x20, 0xff, 0x80, 0x0a, 0x7b, 0x7d]);
  const lifecycle = expectSuccess(appendVolumeForwardMeasurementEvidence(
    opened.cursor,
    {
      kind: 'LIFECYCLE_RECORD',
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 2,
      localMonotonicNs: '3',
      rawPayload: nonUtf8,
    },
  ));

  const decodedPolicy = expectSuccess(
    decodeVolumeForwardMeasurementEvidenceRawBytes(started.record),
  );
  const decodedBinary = expectSuccess(
    decodeVolumeForwardMeasurementEvidenceRawBytes(lifecycle.record),
  );
  assert.deepEqual(Buffer.from(decodedPolicy.bytes), POLICY_BYTES);
  assert.deepEqual(Buffer.from(decodedBinary.bytes), nonUtf8);
  assert.equal(lifecycle.record.header.rawByteLength, nonUtf8.byteLength);
  assert.equal(lifecycle.record.rawBase64, nonUtf8.toString('base64'));
  assert.equal(
    lifecycle.record.header.rawSha256,
    sha256VolumeForwardMeasurementEvidenceBytes(nonUtf8),
  );
});

test('public depth, trade and book evidence plus local state/proposal records are source bound', () => {
  const { cursor, records } = makeCompleteChain();
  const verified = expectSuccess(
    verifyVolumeForwardMeasurementEvidenceChain(records),
  );

  assert.equal(cursor.sealed, true);
  assert.equal(verified.verification.sealed, true);
  assert.equal(verified.verification.recordCount, records.length);
  assert.equal(
    verified.verification.sourceAuthenticity,
    'SELF_CONSISTENT_UNANCHORED',
  );
  assert.deepEqual(verified.verification.trustedAnchors, {
    expectedPolicyDigest: null,
    expectedTerminalHash: null,
    policyDigestMatched: false,
    terminalHashMatched: false,
  });
  assert.ok(
    verified.verification.cumulativeRawPayloadBytes
      <= VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS
        .maximumCumulativeRawPayloadBytes,
  );
  assert.equal(
    verified.verification.cursor.cumulativeRawPayloadBytes,
    verified.verification.cumulativeRawPayloadBytes,
  );
  assert.ok(
    verified.verification.canonicalJsonlBytes
      <= VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumJsonlBytes,
  );
  assert.deepEqual(
    records.map((record) => record.header.kind),
    [
      'POLICY',
      'GENERATION_OPEN',
      'EXCHANGE_INFO',
      'DEPTH_SNAPSHOT',
      'DEPTH_DIFF',
      'TRADE',
      'AGG_TRADE',
      'BOOK_TICKER',
      'CONFIG_STATE',
      'KILL_STATE',
      'CONTINUITY',
      'DETECTOR_PROPOSAL',
      'LIFECYCLE_RECORD',
      'GENERATION_CLOSE',
      'TERMINAL_SEAL',
    ],
  );

  for (const record of records) {
    assert.deepEqual(record.header.authority, {
      cas: false,
      execution: 'NONE',
      privateData: false,
      signedRequest: false,
      submit: false,
    });
    assert.equal(record.header.policyDigest, records[0].header.policyDigest);
  }

  assert.deepEqual(
    VOLUME_FORWARD_MEASUREMENT_PUBLIC_REST_ENDPOINTS,
    ['https://data-api.binance.vision'],
  );
  assert.deepEqual(
    VOLUME_FORWARD_MEASUREMENT_PUBLIC_REST_RESOURCES,
    ['/api/v3/depth', '/api/v3/exchangeInfo'],
  );
  assert.deepEqual(
    VOLUME_FORWARD_MEASUREMENT_PUBLIC_STREAM_ENDPOINTS,
    ['wss://data-stream.binance.vision'],
  );
});

test('detector coverage segments validate complete empty and nonempty proposal cuts directly', () => {
  const empty = makeDetectorCoverageChain();
  const emptyVerified = expectSuccess(
    verifyVolumeForwardMeasurementEvidenceChain(empty.records),
  );
  assert.equal(emptyVerified.verification.sealed, true);

  const acceptedProposals = [
    {
      cutOffset: 0,
      proposalId: 'volume-proposal-btc',
      proposalRevision: 1,
      proposalDigest: `vprop_${'a'.repeat(64)}`,
      symbol: 'BTCUSDT',
      detectorDecisionDigest: `vdetector_${'b'.repeat(64)}`,
      featureDigest: `vfeature_${'c'.repeat(64)}`,
    },
    {
      cutOffset: 0,
      proposalId: 'volume-proposal-eth',
      proposalRevision: 2,
      proposalDigest: `vprop_${'d'.repeat(64)}`,
      symbol: 'ETHUSDT',
      detectorDecisionDigest: `vdetector_${'e'.repeat(64)}`,
      featureDigest: `vfeature_${'f'.repeat(64)}`,
    },
  ];
  const nonempty = makeDetectorCoverageChain({ acceptedProposals });
  const nonemptyVerified = expectSuccess(
    verifyVolumeForwardMeasurementEvidenceChain(nonempty.records),
  );
  assert.equal(nonemptyVerified.verification.sealed, true);

  const later = makeDetectorCoverageChain({
    segmentIndex: 1,
    firstCutOffset: 2,
  });
  expectSuccess(verifyVolumeForwardMeasurementEvidenceChain(later.records));
});

test('detector coverage segments reject hostile ordering, revisions, completeness, and segment anchors', () => {
  const acceptedProposals = [
    {
      cutOffset: 0,
      proposalId: 'volume-proposal-btc',
      proposalRevision: 1,
      proposalDigest: `vprop_${'a'.repeat(64)}`,
      symbol: 'BTCUSDT',
      detectorDecisionDigest: `vdetector_${'b'.repeat(64)}`,
      featureDigest: `vfeature_${'c'.repeat(64)}`,
    },
    {
      cutOffset: 0,
      proposalId: 'volume-proposal-eth',
      proposalRevision: 2,
      proposalDigest: `vprop_${'d'.repeat(64)}`,
      symbol: 'ETHUSDT',
      detectorDecisionDigest: `vdetector_${'e'.repeat(64)}`,
      featureDigest: `vfeature_${'f'.repeat(64)}`,
    },
  ];

  const reversed = makeDetectorCoverageChain({
    acceptedProposals,
  }).records.map(mutableRecord);
  const reversedCut = JSON.parse(
    Buffer.from(reversed[1].rawBase64, 'base64').toString('utf8'),
  );
  reversedCut.acceptedProposals.reverse();
  reversedCut.cutDigest = detectorCoverageCutDigest(reversedCut);
  replaceRawJson(reversed, 1, reversedCut);
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(reversed),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'DETECTOR_COVERAGE_CUT_INVALID',
    1,
  );

  const zeroRevision = makeDetectorCoverageChain({
    acceptedProposals,
  }).records.map(mutableRecord);
  const zeroRevisionSealIndex = zeroRevision.length - 1;
  const zeroRevisionSeal = JSON.parse(
    Buffer.from(
      zeroRevision[zeroRevisionSealIndex].rawBase64,
      'base64',
    ).toString('utf8'),
  );
  zeroRevisionSeal.acceptedProposals[0].proposalRevision = 0;
  replaceRawJson(zeroRevision, zeroRevisionSealIndex, zeroRevisionSeal);
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(zeroRevision),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'TERMINAL_SEGMENT_PROFILE_INVALID',
    zeroRevisionSealIndex,
  );

  const incompleteEmpty = makeDetectorCoverageChain()
    .records.map(mutableRecord);
  const incompleteCut = JSON.parse(
    Buffer.from(incompleteEmpty[1].rawBase64, 'base64').toString('utf8'),
  );
  incompleteCut.complete = false;
  incompleteCut.cutDigest = detectorCoverageCutDigest(incompleteCut);
  replaceRawJson(incompleteEmpty, 1, incompleteCut);
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(incompleteEmpty),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'DETECTOR_COVERAGE_CUT_INVALID',
    1,
  );

  const zeroIndexLateCut = makeDetectorCoverageChain({
    segmentIndex: 0,
    firstCutOffset: 2,
  }).records;
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(zeroIndexLateCut),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'TERMINAL_SEGMENT_SUMMARY_MISMATCH',
    zeroIndexLateCut.length - 1,
  );

  const laterIndexZeroCut = makeDetectorCoverageChain({
    segmentIndex: 1,
    firstCutOffset: 0,
  }).records;
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(laterIndexZeroCut),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'TERMINAL_SEGMENT_SUMMARY_MISMATCH',
    laterIndexZeroCut.length - 1,
  );
});

test('sealed measurement profile requires one complete bundle while preserving reconnect evidence', () => {
  const reconnect = makeChainWithIncompleteReconnect({
    chainId: 'incomplete-reconnect-with-disposition',
    includeContinuity: true,
  }).map(mutableRecord);
  const reconnectContinuity = reconnect.findLast(
    (record) => (
      record.header.kind === 'CONTINUITY'
      && record.header.generation === 2
    ),
  );
  assert.match(
    Buffer.from(reconnectContinuity.rawBase64, 'base64').toString('utf8'),
    /"state":"RECONNECT_REQUIRED"/,
  );
  expectSuccess(verifyVolumeForwardMeasurementEvidenceChain(reconnect));

  const emptyWithDisposition = makeChainWithIncompleteReconnect({
    chainId: 'empty-reconnect-with-disposition',
    includeContinuity: true,
    includeDepthDiff: false,
  });
  expectSuccess(
    verifyVolumeForwardMeasurementEvidenceChain(emptyWithDisposition),
  );

  const emptyWithoutDisposition = makeChainWithIncompleteReconnect({
    chainId: 'empty-open-close-no-disposition',
    includeContinuity: false,
    includeDepthDiff: false,
  });
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(emptyWithoutDisposition),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'MEASUREMENT_BUNDLE_CONTINUITY_MISSING',
    emptyWithoutDisposition.length - 2,
  );
  expectSuccess(
    verifyVolumeForwardMeasurementEvidenceChain(emptyWithoutDisposition, {
      requireMeasurementBundle: false,
      requireSealed: false,
    }),
  );

  const noDisposition = makeChainWithIncompleteReconnect({
    chainId: 'incomplete-reconnect-no-disposition',
    includeContinuity: false,
  });
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(noDisposition),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'MEASUREMENT_BUNDLE_CONTINUITY_MISSING',
    noDisposition.length - 2,
  );
  const preserved = expectSuccess(
    verifyVolumeForwardMeasurementEvidenceChain(noDisposition, {
      requireMeasurementBundle: false,
      requireSealed: false,
    }),
  );
  assert.equal(preserved.verification.sealed, true);
  assert.equal(
    preserved.verification.sourceAuthenticity,
    'SELF_CONSISTENT_UNANCHORED',
  );
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(noDisposition, {
      requireMeasurementBundle: false,
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'OPTIONS_INVALID',
  );

  const noCompletePublicBundle = makeCompleteChain({
    chainId: 'no-complete-public-bundle',
  }).records.map(mutableRecord);
  noCompletePublicBundle.splice(3, 1);
  recomputeSelfConsistentChain(noCompletePublicBundle);
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(noCompletePublicBundle),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'MEASUREMENT_BUNDLE_PUBLIC_SOURCES_INCOMPLETE',
    noCompletePublicBundle.length - 1,
  );
  expectSuccess(
    verifyVolumeForwardMeasurementEvidenceChain(noCompletePublicBundle, {
      requireMeasurementBundle: false,
      requireSealed: false,
    }),
  );

  for (const typedKind of [
    'DEPTH_DIFF',
    'TRADE',
    'AGG_TRADE',
    'BOOK_TICKER',
  ]) {
    const frameOnlyForKind = makeCompleteChain({
      chainId: `stream-frame-not-${typedKind.toLowerCase()}`,
    }).records.map(mutableRecord);
    const typedRecord = frameOnlyForKind.find(
      (record) => record.header.kind === typedKind,
    );
    assert.ok(typedRecord);
    typedRecord.header.kind = 'STREAM_FRAME';
    typedRecord.header.sourceStream = null;
    recomputeSelfConsistentChain(frameOnlyForKind);
    expectFailure(
      verifyVolumeForwardMeasurementEvidenceChain(frameOnlyForKind),
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'MEASUREMENT_BUNDLE_PUBLIC_SOURCES_INCOMPLETE',
      frameOnlyForKind.length - 1,
    );
    expectSuccess(
      verifyVolumeForwardMeasurementEvidenceChain(frameOnlyForKind, {
        requireMeasurementBundle: false,
        requireSealed: false,
      }),
    );
  }

  const noProposal = makeCompleteChain({
    chainId: 'no-detector-proposal',
  }).records.map(mutableRecord);
  noProposal.splice(11, 1);
  recomputeSelfConsistentChain(noProposal);
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(noProposal),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'MEASUREMENT_BUNDLE_DETECTOR_PROPOSAL_MISSING',
    noProposal.length - 1,
  );
});

test('receive clocks, generation state and Binance source allowlists fail closed', () => {
  expectSuccess(startVolumeForwardMeasurementEvidenceChain({
    chainId: 'maximum-safe-utc',
    localReceivedAtMs:
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumUtcMs,
    localMonotonicNs: '1',
    rawPayload: POLICY_BYTES,
  }));
  expectFailure(
    startVolumeForwardMeasurementEvidenceChain({
      chainId: 'past-maximum-safe-utc',
      localReceivedAtMs:
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumUtcMs + 1,
      localMonotonicNs: '1',
      rawPayload: POLICY_BYTES,
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'LOCAL_RECEIVED_AT_MS_INVALID',
  );

  const started = expectSuccess(startVolumeForwardMeasurementEvidenceChain({
    chainId: 'clock-generation-source',
    localReceivedAtMs: BASE_RECEIVED_AT_MS,
    localMonotonicNs: '1000',
    rawPayload: POLICY_BYTES,
  }));

  const combinedDepthFrameBytes = raw(
    ' {\n'
    + '  "stream":"btcusdt@depth@100ms",\n'
    + '  "data":{"e":"depthUpdate","s":"BTCUSDT","U":1,"u":1,"b":[],"a":[]}\n'
    + ' }\n',
  );
  const streamInput = {
    kind: 'DEPTH_DIFF',
    localReceivedAtMs: BASE_RECEIVED_AT_MS + 1,
    localMonotonicNs: '1010',
    rawPayload: combinedDepthFrameBytes,
    sourceEndpoint: 'wss://data-stream.binance.vision',
    sourceSymbol: 'BTCUSDT',
    sourceStream: 'btcusdt@depth@100ms',
    sourceTransport: 'BINANCE_SPOT_PUBLIC_STREAM',
  };
  const streamFrameInput = {
    ...streamInput,
    kind: 'STREAM_FRAME',
    sourceStream: null,
  };
  expectFailure(
    appendVolumeForwardMeasurementEvidence(started.cursor, streamFrameInput),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'GENERATION_NOT_OPEN',
  );
  expectFailure(
    appendVolumeForwardMeasurementEvidence(started.cursor, streamInput),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'GENERATION_NOT_OPEN',
  );

  const opened = expectSuccess(appendVolumeForwardMeasurementEvidence(
    started.cursor,
    {
      kind: 'GENERATION_OPEN',
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 1,
      localMonotonicNs: '1010',
      rawPayload: raw('{"generation":1}'),
    },
  ));
  assert.equal(opened.cursor.generation, 1);
  assert.equal(opened.cursor.generationOpen, true);

  expectFailure(
    appendVolumeForwardMeasurementEvidence(opened.cursor, {
      ...streamFrameInput,
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 2,
      localMonotonicNs: '1020',
      sourceTransport: 'BINANCE_SPOT_PUBLIC_REST',
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
    'SOURCE_TRANSPORT_UNSUPPORTED',
  );
  expectFailure(
    appendVolumeForwardMeasurementEvidence(opened.cursor, {
      ...streamFrameInput,
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 2,
      localMonotonicNs: '1020',
      sourceEndpoint: 'wss://stream.binance.com:9443',
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
    'SOURCE_ENDPOINT_UNSUPPORTED',
  );
  expectFailure(
    appendVolumeForwardMeasurementEvidence(opened.cursor, {
      ...streamFrameInput,
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 2,
      localMonotonicNs: '1020',
      sourceSymbol: null,
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
    'SOURCE_STREAM_UNSUPPORTED',
  );
  expectFailure(
    appendVolumeForwardMeasurementEvidence(opened.cursor, {
      ...streamFrameInput,
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 2,
      localMonotonicNs: '1020',
      sourceSymbol: 'btcusdt',
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
    'SOURCE_STREAM_UNSUPPORTED',
  );
  expectFailure(
    appendVolumeForwardMeasurementEvidence(opened.cursor, {
      ...streamFrameInput,
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 2,
      localMonotonicNs: '1020',
      sourceStream: 'btcusdt@depth@100ms',
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
    'SOURCE_STREAM_UNSUPPORTED',
  );

  expectFailure(
    appendVolumeForwardMeasurementEvidence(opened.cursor, {
      ...streamInput,
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 2,
      localMonotonicNs: '1009',
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'NON_MONOTONIC_RECEIVE_CLOCK',
  );
  expectFailure(
    appendVolumeForwardMeasurementEvidence(opened.cursor, {
      ...streamInput,
      localReceivedAtMs: BASE_RECEIVED_AT_MS,
      localMonotonicNs: '1011',
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'NON_MONOTONIC_RECEIVE_UTC_CLOCK',
  );
  expectFailure(
    appendVolumeForwardMeasurementEvidence(opened.cursor, {
      ...streamInput,
      sourceEndpoint: 'wss://example.invalid',
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
    'SOURCE_ENDPOINT_UNSUPPORTED',
  );
  expectFailure(
    appendVolumeForwardMeasurementEvidence(opened.cursor, {
      ...streamInput,
      sourceSymbol: 'ETHUSDT',
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
    'SOURCE_STREAM_UNSUPPORTED',
  );
  expectFailure(
    appendVolumeForwardMeasurementEvidence(opened.cursor, {
      ...streamInput,
      kind: 'TRADE',
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
    'RECORD_KIND_SOURCE_MISMATCH',
  );
  expectFailure(
    appendVolumeForwardMeasurementEvidence(opened.cursor, {
      ...streamInput,
      sourceStream: 'BTCUSDT@depth@100ms',
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
    'SOURCE_STREAM_UNSUPPORTED',
  );

  const frame = expectSuccess(appendVolumeForwardMeasurementEvidence(
    opened.cursor,
    {
      ...streamFrameInput,
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 2,
      localMonotonicNs: '1020',
    },
  ));
  assert.equal(frame.record.header.kind, 'STREAM_FRAME');
  assert.equal(frame.record.header.generation, 1);
  assert.equal(
    frame.record.header.sourceEndpoint,
    'wss://data-stream.binance.vision',
  );
  assert.equal(frame.record.header.sourceSymbol, 'BTCUSDT');
  assert.equal(frame.record.header.sourceStream, null);
  assert.equal(
    frame.record.header.sourceTransport,
    'BINANCE_SPOT_PUBLIC_STREAM',
  );
  assert.equal(frame.record.header.localReceivedAtMs, BASE_RECEIVED_AT_MS + 2);
  assert.equal(frame.record.header.localMonotonicNs, '1020');
  assert.equal(
    frame.record.rawBase64,
    combinedDepthFrameBytes.toString('base64'),
  );
  assert.equal(
    frame.cursor.cumulativeRawPayloadBytes,
    opened.cursor.cumulativeRawPayloadBytes
      + combinedDepthFrameBytes.byteLength,
  );

  const diff = expectSuccess(appendVolumeForwardMeasurementEvidence(
    frame.cursor,
    {
      ...streamInput,
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 2,
      localMonotonicNs: '1020',
    },
  ));
  assert.equal(diff.record.header.localReceivedAtMs, frame.record.header.localReceivedAtMs);
  assert.equal(diff.record.header.localMonotonicNs, frame.record.header.localMonotonicNs);
  assert.equal(diff.record.header.rawByteLength, frame.record.header.rawByteLength);
  assert.equal(diff.record.header.rawSha256, frame.record.header.rawSha256);
  assert.equal(diff.record.rawBase64, frame.record.rawBase64);
  assert.equal(
    diff.cursor.cumulativeRawPayloadBytes,
    frame.cursor.cumulativeRawPayloadBytes
      + combinedDepthFrameBytes.byteLength,
  );
  const closed = expectSuccess(appendVolumeForwardMeasurementEvidence(
    diff.cursor,
    {
      kind: 'GENERATION_CLOSE',
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 3,
      localMonotonicNs: '1030',
      rawPayload: raw('{"generation":1}'),
    },
  ));
  const reopened = expectSuccess(appendVolumeForwardMeasurementEvidence(
    closed.cursor,
    {
      kind: 'GENERATION_OPEN',
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 4,
      localMonotonicNs: '1040',
      rawPayload: raw('{"generation":2}'),
    },
  ));
  assert.equal(reopened.cursor.generation, 2);
  assert.equal(reopened.cursor.generationOpen, true);
});

test('terminal seal commits count and tail, requires closed generation, and forbids append', () => {
  const started = expectSuccess(startVolumeForwardMeasurementEvidenceChain({
    chainId: 'terminal-seal',
    localReceivedAtMs: BASE_RECEIVED_AT_MS,
    localMonotonicNs: '1',
    rawPayload: POLICY_BYTES,
  }));
  const opened = expectSuccess(appendVolumeForwardMeasurementEvidence(
    started.cursor,
    {
      kind: 'GENERATION_OPEN',
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 1,
      localMonotonicNs: '2',
      rawPayload: raw('{"generation":1}'),
    },
  ));
  expectFailure(
    sealVolumeForwardMeasurementEvidenceChain(opened.cursor, {
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 2,
      localMonotonicNs: '3',
      rawPayload: raw('{"sealed":true}'),
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSEALED,
    'GENERATION_LEFT_OPEN',
  );

  const { cursor, records } = makeCompleteChain({ chainId: 'terminal-sealed' });
  const seal = records.at(-1);
  assert.equal(seal.header.kind, 'TERMINAL_SEAL');
  assert.equal(seal.header.terminal, true);
  assert.equal(seal.header.sealedRecordCount, records.length);
  assert.equal(seal.header.sealedTailHash, records.at(-2).recordHash);
  assert.equal(cursor.previousHash, seal.recordHash);
  assert.equal(cursor.sealed, true);
  expectFailure(
    appendVolumeForwardMeasurementEvidence(cursor, {
      kind: 'CONFIG_STATE',
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 100,
      localMonotonicNs: '999999',
      rawPayload: raw('{}'),
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'CHAIN_ALREADY_SEALED',
  );

  const wrongSealGeneration = records.map(mutableRecord);
  wrongSealGeneration.at(-1).header.generation += 1;
  recomputeSelfConsistentChain(wrongSealGeneration);
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(wrongSealGeneration),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
    'TERMINAL_SEAL_GENERATION_MISMATCH',
    wrongSealGeneration.length - 1,
  );
});

test('canonical JSONL roundtrip preserves records and exact raw bytes', () => {
  const { records } = makeCompleteChain({ chainId: 'jsonl-roundtrip' });
  const serialized = expectSuccess(
    serializeVolumeForwardMeasurementEvidenceJsonl(records),
  );
  assert.ok(serialized.jsonl.endsWith('\n'));
  assert.equal(serialized.jsonl.split('\n').at(-1), '');
  assert.ok(serialized.jsonl.startsWith('{"header":'));

  for (const record of records) {
    const line = expectSuccess(
      serializeVolumeForwardMeasurementEvidenceRecordJsonl(record),
    );
    assert.ok(line.line.endsWith('\n'));
    assert.equal(JSON.parse(line.line).recordHash, record.recordHash);
  }

  const parsed = expectSuccess(
    parseVolumeForwardMeasurementEvidenceJsonl(serialized.jsonl),
  );
  assert.deepEqual(
    parsed.verification.records.map((record) => record.recordHash),
    records.map((record) => record.recordHash),
  );
  assert.equal(parsed.verification.terminalHash, records.at(-1).recordHash);
  for (let index = 0; index < records.length; index += 1) {
    const before = expectSuccess(
      decodeVolumeForwardMeasurementEvidenceRawBytes(records[index]),
    );
    const after = expectSuccess(
      decodeVolumeForwardMeasurementEvidenceRawBytes(
        parsed.verification.records[index],
      ),
    );
    assert.deepEqual(Buffer.from(after.bytes), Buffer.from(before.bytes));
  }

  expectFailure(
    parseVolumeForwardMeasurementEvidenceJsonl(` ${serialized.jsonl}`),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
    'NON_CANONICAL_JSONL',
    0,
  );
});

test('verification and parse options are exact data, clamped, and hard bounded', () => {
  const { records } = makeCompleteChain({ chainId: 'bounded-options' });
  const serialized = expectSuccess(
    serializeVolumeForwardMeasurementEvidenceJsonl(records),
  );

  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(records, null),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'OPTIONS_INVALID',
  );
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(records, {
      requireSealed: 'true',
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'OPTIONS_INVALID',
  );
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(records, {
      unexpected: false,
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'OPTIONS_INVALID',
  );
  let accessorRead = false;
  const accessorOptions = {};
  Object.defineProperty(accessorOptions, 'requireSealed', {
    enumerable: true,
    get() {
      accessorRead = true;
      throw new Error('must not run');
    },
  });
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(records, accessorOptions),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'OPTIONS_INVALID',
  );
  assert.equal(accessorRead, false);
  expectFailure(
    parseVolumeForwardMeasurementEvidenceJsonl(serialized.jsonl, null),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'OPTIONS_INVALID',
  );
  expectFailure(
    parseVolumeForwardMeasurementEvidenceJsonl(serialized.jsonl, {
      maximumLineBytes: null,
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
    'OPTIONS_INVALID',
  );
  expectSuccess(
    parseVolumeForwardMeasurementEvidenceJsonl(serialized.jsonl, {
      maximumJsonlBytes:
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumJsonlBytes + 1,
      maximumLineBytes:
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumJsonlLineBytes + 1,
    }),
  );

  const tooManyRecords = new Array(
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRecordCount + 1,
  ).fill(records[0]);
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(tooManyRecords),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
    'RECORD_COUNT_LIMIT_EXCEEDED',
  );

  const declaredRawRecords = Array.from({
    length: Math.floor(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS
        .maximumCumulativeRawPayloadBytes
      / VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRawPayloadBytes,
    ) + 1,
  }, (_, index) => {
    const record = mutableRecord(records[0]);
    record.header.rawByteLength =
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRawPayloadBytes;
    record.header.sequence = index;
    record.recordHash = `sha256:${index.toString(16).padStart(64, '0')}`;
    return record;
  });
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(declaredRawRecords),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
    'CUMULATIVE_RAW_PAYLOAD_LIMIT_EXCEEDED',
    declaredRawRecords.length - 1,
  );
});

test('append cursor enforces exact cumulative raw-byte boundary and rejects forged counters', () => {
  const started = expectSuccess(startVolumeForwardMeasurementEvidenceChain({
    chainId: 'append-cumulative-boundary',
    localReceivedAtMs: BASE_RECEIVED_AT_MS,
    localMonotonicNs: '100',
    rawPayload: POLICY_BYTES,
  }));
  const maximum =
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumCumulativeRawPayloadBytes;
  const boundaryCursor = Object.freeze({
    ...started.cursor,
    cumulativeRawPayloadBytes: maximum - 1,
  });
  const atBoundary = expectSuccess(appendVolumeForwardMeasurementEvidence(
    boundaryCursor,
    {
      kind: 'CONFIG_STATE',
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 1,
      localMonotonicNs: '101',
      rawPayload: Uint8Array.of(0xff),
    },
  ));
  assert.equal(atBoundary.cursor.cumulativeRawPayloadBytes, maximum);
  assert.ok(Object.isFrozen(atBoundary.cursor));

  expectFailure(
    appendVolumeForwardMeasurementEvidence(atBoundary.cursor, {
      kind: 'KILL_STATE',
      localReceivedAtMs: BASE_RECEIVED_AT_MS + 2,
      localMonotonicNs: '102',
      rawPayload: Uint8Array.of(0x00),
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
    'CUMULATIVE_RAW_PAYLOAD_LIMIT_EXCEEDED',
  );

  const { cumulativeRawPayloadBytes: _omitted, ...missingCounter } =
    started.cursor;
  const forgedCounters = [
    missingCounter,
    { ...started.cursor, cumulativeRawPayloadBytes: -1 },
    { ...started.cursor, cumulativeRawPayloadBytes: maximum + 1 },
    { ...started.cursor, cumulativeRawPayloadBytes: 1.5 },
    { ...started.cursor, cumulativeRawPayloadBytes: '1' },
    { ...started.cursor, unexpected: false },
  ];
  for (const forgedCursor of forgedCounters) {
    expectFailure(
      appendVolumeForwardMeasurementEvidence(forgedCursor, {
        kind: 'CONFIG_STATE',
        localReceivedAtMs: BASE_RECEIVED_AT_MS + 1,
        localMonotonicNs: '101',
        rawPayload: Uint8Array.of(),
      }),
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'CURSOR_INVALID',
    );
  }
});

test('identical inputs produce deterministic chain hashes and byte-identical JSONL', () => {
  const left = makeCompleteChain({ chainId: 'deterministic-chain' });
  const right = makeCompleteChain({ chainId: 'deterministic-chain' });
  assert.deepEqual(
    left.records.map((record) => record.recordHash),
    right.records.map((record) => record.recordHash),
  );
  assert.deepEqual(
    left.records.map((record) => record.header.rawSha256),
    right.records.map((record) => record.header.rawSha256),
  );
  const leftJsonl = expectSuccess(
    serializeVolumeForwardMeasurementEvidenceJsonl(left.records),
  );
  const rightJsonl = expectSuccess(
    serializeVolumeForwardMeasurementEvidenceJsonl(right.records),
  );
  assert.equal(leftJsonl.jsonl, rightJsonl.jsonl);

  const changed = makeCompleteChain({
    chainId: 'deterministic-chain',
    policyBytes: Buffer.concat([POLICY_BYTES, Buffer.from([0x00])]),
  });
  assert.notEqual(changed.records[0].recordHash, left.records[0].recordHash);
  assert.notEqual(changed.records.at(-1).recordHash, left.records.at(-1).recordHash);
});

test('self-consistency alone is not source authenticity and trusted anchors reject a recomputed chain', () => {
  const original = makeCompleteChain({ chainId: 'trusted-anchor-chain' });
  const recomputed = original.records.map(mutableRecord);
  recomputed[11].rawBase64 = raw(
    '{"proposalDigest":"vprop_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","proposalId":"fabricated","symbol":"BTCUSDT"}',
  ).toString('base64');
  recomputeSelfConsistentChain(recomputed);

  const selfConsistent = expectSuccess(
    verifyVolumeForwardMeasurementEvidenceChain(recomputed),
  );
  assert.equal(
    selfConsistent.verification.sourceAuthenticity,
    'SELF_CONSISTENT_UNANCHORED',
  );
  assert.notEqual(
    selfConsistent.verification.terminalHash,
    original.records.at(-1).recordHash,
  );

  const policyOnly = expectSuccess(
    verifyVolumeForwardMeasurementEvidenceChain(recomputed, {
      expectedPolicyDigest: original.records[0].header.policyDigest,
    }),
  );
  assert.equal(
    policyOnly.verification.sourceAuthenticity,
    'SELF_CONSISTENT_UNANCHORED',
  );
  assert.deepEqual(policyOnly.verification.trustedAnchors, {
    expectedPolicyDigest: original.records[0].header.policyDigest,
    expectedTerminalHash: null,
    policyDigestMatched: true,
    terminalHashMatched: false,
  });

  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(recomputed, {
      expectedTerminalHash: original.records.at(-1).recordHash,
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.ANCHOR_MISMATCH,
    'EXPECTED_TERMINAL_HASH_MISMATCH',
    recomputed.length - 1,
  );
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(recomputed, {
      expectedPolicyDigest: `sha256:${'f'.repeat(64)}`,
    }),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.ANCHOR_MISMATCH,
    'EXPECTED_POLICY_DIGEST_MISMATCH',
    0,
  );

  const anchored = expectSuccess(
    verifyVolumeForwardMeasurementEvidenceChain(recomputed, {
      expectedPolicyDigest: recomputed[0].header.policyDigest,
      expectedTerminalHash: recomputed.at(-1).recordHash,
    }),
  );
  assert.equal(
    anchored.verification.sourceAuthenticity,
    'TRUSTED_ANCHOR_MATCHED',
  );
  assert.deepEqual(anchored.verification.trustedAnchors, {
    expectedPolicyDigest: recomputed[0].header.policyDigest,
    expectedTerminalHash: recomputed.at(-1).recordHash,
    policyDigestMatched: true,
    terminalHashMatched: true,
  });
});

test('mutation, deletion, reorder, duplication, truncation and unsealed chains have named failures', () => {
  const { records } = makeCompleteChain({ chainId: 'named-failures' });

  const mutated = records.map(mutableRecord);
  mutated[4].rawBase64 = (
    mutated[4].rawBase64[0] === 'A' ? 'B' : 'A'
  ) + mutated[4].rawBase64.slice(1);
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(mutated),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
    'RAW_SHA256_MISMATCH',
    4,
  );

  const deleted = records.slice();
  deleted.splice(4, 1);
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(deleted),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.DELETED,
    'RECORD_SEQUENCE_DELETED',
    4,
  );

  const reordered = records.slice();
  [reordered[4], reordered[5]] = [reordered[5], reordered[4]];
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(reordered),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.REORDERED,
    'RECORD_REORDERED',
    4,
  );

  const duplicated = records.slice();
  duplicated.splice(5, 0, records[4]);
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(duplicated),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.DUPLICATED,
    'DUPLICATE_SEQUENCE',
    5,
  );

  const serialized = expectSuccess(
    serializeVolumeForwardMeasurementEvidenceJsonl(records),
  );
  expectFailure(
    parseVolumeForwardMeasurementEvidenceJsonl(
      serialized.jsonl.slice(0, -1),
    ),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.TRUNCATED,
    'TRAILING_NEWLINE_MISSING',
  );

  const unsealed = records.slice(0, -1);
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(unsealed),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSEALED,
    'TERMINAL_SEAL_MISSING',
    unsealed.length - 1,
  );
  const openVerification = expectSuccess(
    verifyVolumeForwardMeasurementEvidenceChain(
      unsealed,
      { requireSealed: false },
    ),
  );
  assert.equal(openVerification.verification.sealed, false);
});

test('mixed policy and unsupported schema are rejected before replay', () => {
  const { records } = makeCompleteChain({ chainId: 'policy-schema-failures' });

  const mixed = records.map(mutableRecord);
  mixed[6].header.policyDigest = `sha256:${'f'.repeat(64)}`;
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(mixed),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MIXED_POLICY,
    'MIXED_POLICY_DIGEST',
    6,
  );

  const unsupported = records.map(mutableRecord);
  unsupported[0].header.schemaVersion = 2;
  expectFailure(
    verifyVolumeForwardMeasurementEvidenceChain(unsupported),
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
    'SCHEMA_UNSUPPORTED',
    0,
  );
});

test('module is pure framing with no filesystem, network, CAS, private or submit seam', () => {
  const source = readFileSync(
    new URL(
      '../src/engine/volume/forwardMeasurementEvidence.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
  assert.deepEqual(imports, ['node:crypto']);
  assert.doesNotMatch(
    source,
    /\b(?:fetch|WebSocket|XMLHttpRequest|writeFile|appendFile|createWriteStream|createConnection|connect)\s*\(/,
  );
  assert.doesNotMatch(
    source,
    /\b(?:submitOrder|placeOrder|cancelOrder|compareAndSwap|signedRequest|privateRequest|apiKey|secretKey)\s*\(/,
  );

  const forbiddenCallableExport = Object.entries(evidenceModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .find((name) => /(?:submit|order|private|signed|network|socket|file|cas)/i.test(name));
  assert.equal(forbiddenCallableExport, undefined);

  const { records } = makeCompleteChain({ chainId: 'authority-envelope' });
  for (const record of records) {
    assert.deepEqual(record.header.authority, {
      cas: false,
      execution: 'NONE',
      privateData: false,
      signedRequest: false,
      submit: false,
    });
    assert.ok([
      'LOCAL',
      'BINANCE_SPOT_PUBLIC_REST',
      'BINANCE_SPOT_PUBLIC_STREAM',
    ].includes(record.header.sourceTransport));
  }
});

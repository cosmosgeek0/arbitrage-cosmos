#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  VOLUME_FORWARD_MEASUREMENT_AUTHORITY,
  buildVolumeForwardDetectorCoveragePolicy,
  buildVolumeForwardDetectorProposalBinding,
  buildVolumeForwardMeasurementPolicy,
  buildVolumeForwardPointInTimeControls,
} from '../dist/engine/volume/forwardMeasurement.js';
import {
  VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS,
  appendVolumeForwardMeasurementEvidence,
  sealVolumeForwardMeasurementEvidenceChain,
  startVolumeForwardMeasurementEvidenceChain,
  verifyVolumeForwardMeasurementEvidenceChain,
} from '../dist/engine/volume/forwardMeasurementEvidence.js';
import {
  VOLUME_FORWARD_MEASUREMENT_CONSUMER_GATE,
  VOLUME_FORWARD_MEASUREMENT_REPLAY_MODE,
  replayVolumeForwardMeasurementEvidence,
} from '../dist/engine/volume/forwardMeasurementReplay.js';

const SYMBOL = 'BTCUSDT';
const FROZEN_AT_MS = 2_000_000_000_000;
const OUTCOME_OPENS_AT_MS = FROZEN_AT_MS + 1_000;
const OUTCOME_CLOSES_AT_MS = OUTCOME_OPENS_AT_MS + 120_000;
const EVIDENCE_CLOSES_AT_MS = OUTCOME_CLOSES_AT_MS + 62_000;
const EXIT_START_MS = OUTCOME_OPENS_AT_MS + 60_000;
const MONOTONIC_ORIGIN_NS = 5_000_000_000_000n;
const CONFIGURATION_REVISION = 'volume-forward-config-0001';
const PROPOSAL_ID = 'volume-forward-proposal-0001';
const REST_ENDPOINT = 'https://data-api.binance.vision';
const STREAM_ENDPOINT = 'wss://data-stream.binance.vision';
const DEPTH_STREAM = 'btcusdt@depth@100ms';
const TRADE_STREAM = 'btcusdt@trade';
const AGG_TRADE_STREAM = 'btcusdt@aggTrade';
const BOOK_TICKER_STREAM = 'btcusdt@bookTicker';
const REQUIRED_STREAMS = Object.freeze([
  AGG_TRADE_STREAM,
  TRADE_STREAM,
  BOOK_TICKER_STREAM,
  DEPTH_STREAM,
]);
const COMBINED_STREAM_URL =
  `wss://data-stream.binance.vision/stream?streams=${REQUIRED_STREAMS.join('/')}`;
const FROZEN_MEASUREMENT_POLICY_SHA256 =
  '96cf89ce2825a930e6f66c8d0d7b606f7d42670cf36b953f9f93c5b4ff2a2067';
const FROZEN_PACKET_RULES = Object.freeze({
  activationMinimumLeadMs: 86_400_000,
  warmupDurationMs: 14_400_000,
  measurementDurationMs: 2_592_000_000,
  maturityLagMs: 62_000,
  proposalAdmissionClosesAtIntervalEnd: true,
  evidenceClosesAfterProposalAdmissionMs: 62_000,
  evaluationCutPeriodMs: 2_000,
  maximumHoldMs: 60_000,
  entryQuoteNotional: '10.00',
  sampleUniverseMode: 'PROSPECTIVE_ACCEPTED_DETECTOR_PROPOSALS',
  proposalOrigin: 'VOLUME_DETECTOR',
  completeAcceptedProposalSetRequired: true,
  nonPseudoProposalRequired: true,
  pointInTimeEligibilityRequired: true,
  currentStateSubstitutionForbidden: true,
});

function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function monotonicAt(atMs) {
  return String(
    MONOTONIC_ORIGIN_NS
      + BigInt(atMs - FROZEN_AT_MS) * 1_000_000n,
  );
}

function expectStep(result) {
  assert.equal(
    result.ok,
    true,
    result.ok ? undefined : `${result.reasonCode}/${result.detailCode}`,
  );
  return result;
}

function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    assert.equal(Number.isSafeInteger(value), true);
    assert.equal(Object.is(value, -0), false);
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function generationFrameLedger(records) {
  const ledger = [];
  for (let index = 0; index < records.length - 1; index += 1) {
    const frame = records[index];
    const typed = records[index + 1];
    if (
      frame.header.kind !== 'STREAM_FRAME'
      || ![
        'DEPTH_DIFF',
        'TRADE',
        'AGG_TRADE',
        'BOOK_TICKER',
      ].includes(typed.header.kind)
    ) continue;
    const outerBytes = Buffer.from(frame.rawBase64, 'base64');
    const envelope = JSON.parse(outerBytes.toString('utf8'));
    const marker = Buffer.from(',"data":', 'utf8');
    const markerOffset = outerBytes.indexOf(marker);
    assert.ok(markerOffset >= 0);
    const innerOffset = markerOffset + marker.byteLength;
    const innerBytes = jsonBytes(envelope.data);
    assert.deepEqual(
      outerBytes.subarray(innerOffset, innerOffset + innerBytes.byteLength),
      innerBytes,
    );
    const entry = {
      evidenceRawSha256: typed.header.rawSha256,
      evidenceRecordHash: typed.recordHash,
      frameRecordHash: frame.recordHash,
      innerLength: innerBytes.byteLength,
      innerOffset,
      innerSha256: createHash('sha256').update(innerBytes).digest('hex'),
      localMonotonicNs: typed.header.localMonotonicNs,
      localReceivedAtMs: typed.header.localReceivedAtMs,
      rawSha256: frame.header.rawSha256.slice('sha256:'.length),
      stream: typed.header.sourceStream,
      ...(typed.header.kind === 'DEPTH_DIFF'
        ? {
            firstUpdateId: envelope.data.U,
            finalUpdateId: envelope.data.u,
          }
        : {}),
    };
    ledger.push(entry);
  }
  return ledger;
}

function recomputeSelfConsistentChain(records) {
  let previousHash = null;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const bytes = Buffer.from(record.rawBase64, 'base64');
    record.header.previousHash = previousHash;
    record.header.rawByteLength = bytes.byteLength;
    record.header.rawSha256 = sha256(bytes);
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
    hash.update(bytes);
    record.recordHash = `sha256:${hash.digest('hex')}`;
    previousHash = record.recordHash;
  }
  return records;
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

function terminalLocalRecord(template, kind, payload, atMs) {
  const record = JSON.parse(JSON.stringify(template));
  record.header.kind = kind;
  record.header.generation = 1;
  record.header.localReceivedAtMs = atMs;
  record.header.localMonotonicNs = monotonicAt(atMs);
  record.header.sourceEndpoint =
    'local://volume-forward-measurement/v1';
  record.header.sourceSymbol = null;
  record.header.sourceStream = null;
  record.header.sourceTransport = 'LOCAL';
  record.header.terminal = false;
  record.header.sealedRecordCount = null;
  record.header.sealedTailHash = null;
  record.rawBase64 = jsonBytes(payload).toString('base64');
  record.recordHash = `sha256:${'0'.repeat(64)}`;
  return record;
}

function recomputeTerminalSegmentChain(records, {
  activationId,
  captureId,
  chainKey,
  detectorInputSourceDigest,
  detectorInputSourceId,
  segmentId,
}) {
  let previousHash = null;
  const previousLifecycleRecordHashes = new Map();
  const transitionRevisions = new Map();
  let proposalRecord = null;
  const proposalRecords = new Map();
  let firstCoverageRecord = null;
  let lastCoverageRecord = null;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.header.kind === 'DETECTOR_PROPOSAL') {
      proposalRecord = record;
      proposalRecords.set(decodedRawJson(record).proposalId, record);
    }
    if (record.header.kind === 'LIFECYCLE_RECORD') {
      const value = decodedRawJson(record);
      const transitionRevision =
        transitionRevisions.get(value.proposalId) ?? 1;
      value.transitionRevision = transitionRevision;
      value.previousLifecycleRecordHash =
        previousLifecycleRecordHashes.get(value.proposalId) ?? null;
      value.sourceRecordHash = value.state === 'OBSERVED'
        ? proposalRecords.get(value.proposalId).recordHash
        : value.state === 'TERMINAL_EXIT' || value.state === 'EXACT'
          ? lastCoverageRecord.recordHash
          : firstCoverageRecord.recordHash;
      record.rawBase64 = jsonBytes(value).toString('base64');
      transitionRevisions.set(
        value.proposalId,
        transitionRevision + 1,
      );
    }
    if (record.header.kind === 'GENERATION_CLOSE') {
      const value = decodedRawJson(record);
      const ledger = generationFrameLedger(records.slice(0, index));
      value.combinedFrameLedger = ledger;
      value.streamFrameCount = ledger.length;
      value.streamCounts = {
        depth100ms: ledger.filter(
          (entry) => entry.stream === DEPTH_STREAM,
        ).length,
        aggTrade: ledger.filter(
          (entry) => entry.stream === AGG_TRADE_STREAM,
        ).length,
        trade: ledger.filter(
          (entry) => entry.stream === TRADE_STREAM,
        ).length,
        bookTicker: ledger.filter(
          (entry) => entry.stream === BOOK_TICKER_STREAM,
        ).length,
      };
      value.detectorProposalRecordHash = proposalRecord.recordHash;
      value.lifecycleAssertionsCaptured = records
        .slice(0, index)
        .some((candidate) => (
          candidate.header.kind === 'LIFECYCLE_RECORD'
        ));
      record.rawBase64 = jsonBytes(value).toString('base64');
    }
    if (record.header.kind === 'TERMINAL_SEAL') {
      const cuts = records
        .slice(0, index)
        .filter((candidate) => (
          candidate.header.kind === 'DETECTOR_COVERAGE'
        ))
        .map(decodedRawJson);
      const acceptedProposals = cuts
        .flatMap((cut) => cut.acceptedProposals)
        .map((proposal) => ({
          proposalId: proposal.proposalId,
          proposalRevision: proposal.proposalRevision,
          proposalDigest: proposal.proposalDigest,
          symbol: proposal.symbol,
        }))
        .sort((left, right) => (
          `${left.proposalId}|${left.proposalRevision}|${left.proposalDigest}|${left.symbol}`
            .localeCompare(
              `${right.proposalId}|${right.proposalRevision}|${right.proposalDigest}|${right.symbol}`,
            )
        ));
      const lifecycleValues = records
        .slice(0, index)
        .filter((candidate) => (
          candidate.header.kind === 'LIFECYCLE_RECORD'
        ))
        .map(decodedRawJson);
      const stateCounts = {
        OBSERVED: 0,
        ENTRY_RECORDED: 0,
        HOLDING: 0,
        TERMINAL_EXIT: 0,
        BLOCKED: 0,
        EXACT: 0,
      };
      for (const lifecycle of lifecycleValues) {
        stateCounts[lifecycle.state] += 1;
      }
      const firstCut = cuts[0];
      const lastCut = cuts.at(-1);
      const maximumGapMs = cuts.slice(1).reduce(
        (maximum, cut, cutIndex) => Math.max(
          maximum,
          cut.localReceivedAtMs
            - cuts[cutIndex].localReceivedAtMs,
        ),
        0,
      );
      const byteCount = records.slice(0, index).reduce(
        (total, candidate) => (
          total + Buffer.byteLength(canonicalJson(candidate), 'utf8') + 1
        ),
        0,
      );
      const descriptor = {
        schemaVersion: 'volume.forward.segment-seal.v1',
        profile: 'FORWARD_MEASUREMENT_SEGMENT_V1',
        segmentId,
        captureId,
        activationId,
        coverageRole: 'SYMBOL_LIFECYCLE',
        chainKey,
        symbol: SYMBOL,
        segmentIndex: 0,
        previousTerminalHash: null,
        corePolicyDigest: records[0].header.rawSha256,
        packetMeasurementPolicySha256:
          FROZEN_MEASUREMENT_POLICY_SHA256,
        detectorInputSourceId,
        detectorInputSourceDigest,
        coverage: {
          startMs: firstCut.cutAtMs,
          endExclusiveMs:
            lastCut.cutAtMs + 2_000,
        },
        recordBounds: {
          firstHash: records[0].recordHash,
          sealedTailHash: previousHash,
          firstSequence: 0,
          lastSequence: index - 1,
          recordCount: index,
          byteCount,
        },
        nonTruncated: true,
        closeReason: 'MEASUREMENT_INTERVAL_COMPLETE',
        generationSummary: {
          count: 1,
          continuityGapCount: 0,
          unresolvedCount: 0,
        },
        detectorCoverage: {
          coverageChainKey: chainKey,
          firstCutOffset: firstCut.cutOffset,
          lastCutOffset: lastCut.cutOffset,
          cutCount: cuts.length,
          expectedCutCount: cuts.length,
          missingCutCount: 0,
          maxGapMs: maximumGapMs,
          uncoveredMs: 0,
          firstCutDigest: firstCut.cutDigest,
          lastCutDigest: lastCut.cutDigest,
          complete: true,
        },
        acceptedProposals,
        lifecycleSummary: {
          proposalKeys: acceptedProposals,
          assertionCount: lifecycleValues.length,
          openCount: 0,
          stateCounts,
        },
        pseudoProposalExcludedCount: cuts.reduce(
          (total, cut) => total + cut.pseudoProposalExcludedCount,
          0,
        ),
        quiescent: true,
      };
      record.rawBase64 = jsonBytes(descriptor).toString('base64');
    }
    const bytes = Buffer.from(record.rawBase64, 'base64');
    record.header.previousHash = previousHash;
    record.header.rawByteLength = bytes.byteLength;
    record.header.rawSha256 = sha256(bytes);
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
    hash.update(bytes);
    record.recordHash = `sha256:${hash.digest('hex')}`;
    previousHash = record.recordHash;
    if (record.header.kind === 'DETECTOR_COVERAGE') {
      firstCoverageRecord ??= record;
      lastCoverageRecord = record;
    }
    if (record.header.kind === 'LIFECYCLE_RECORD') {
      const value = decodedRawJson(record);
      previousLifecycleRecordHashes.set(
        value.proposalId,
        record.recordHash,
      );
    }
  }
  return records;
}

function exchangeInfo({
  maxNotional = '1000000.00',
  maxPrice = '1000000.00',
  minPrice = '0.01',
} = {}) {
  return {
    timezone: 'UTC',
    symbols: [{
      symbol: SYMBOL,
      status: 'TRADING',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      isSpotTradingAllowed: true,
      orderTypes: ['LIMIT', 'MARKET'],
      permissions: ['SPOT'],
      filters: [
        {
          filterType: 'PRICE_FILTER',
          minPrice,
          maxPrice,
          tickSize: '0.01',
        },
        {
          filterType: 'LOT_SIZE',
          minQty: '0.0001',
          maxQty: '100.0000',
          stepSize: '0.0001',
        },
        {
          filterType: 'NOTIONAL',
          minNotional: '5.00',
          maxNotional,
          applyMinToMarket: true,
          applyMaxToMarket: true,
          avgPriceMins: 5,
        },
      ],
    }],
  };
}

function publicSource(kind) {
  if (kind === 'EXCHANGE_INFO') {
    return {
      sourceEndpoint: REST_ENDPOINT,
      sourceSymbol: SYMBOL,
      sourceStream: '/api/v3/exchangeInfo',
      sourceTransport: 'BINANCE_SPOT_PUBLIC_REST',
    };
  }
  if (kind === 'DEPTH_SNAPSHOT') {
    return {
      sourceEndpoint: REST_ENDPOINT,
      sourceSymbol: SYMBOL,
      sourceStream: '/api/v3/depth',
      sourceTransport: 'BINANCE_SPOT_PUBLIC_REST',
    };
  }
  const streams = {
    AGG_TRADE: AGG_TRADE_STREAM,
    BOOK_TICKER: BOOK_TICKER_STREAM,
    DEPTH_DIFF: DEPTH_STREAM,
    TRADE: TRADE_STREAM,
  };
  return {
    sourceEndpoint: STREAM_ENDPOINT,
    sourceSymbol: SYMBOL,
    sourceStream: streams[kind],
    sourceTransport: 'BINANCE_SPOT_PUBLIC_STREAM',
  };
}

function makeFixture({
  aggregateTradeSpan = 1,
  bookAsks = [['100.00', '2.0000']],
  bookBids = [['99.00', '1.0000']],
  bridge = 'VALID',
  chainId = 'volume-forward-replay-canonical',
  delayedProposal = false,
  duplicateEntryTrade = null,
  duplicatePostSnapshotBridge = false,
  entryBookTickerAskLevel = bookAsks[0],
  entryBookTickerBidLevel = bookBids[0],
  entryBookTickerUpdateId = null,
  exitDepthRange = null,
  filter = {},
  initialDepthRange = null,
  lifecycle = 'TERMINAL_ONLY',
  missingBook = false,
  missingConfig = false,
  missingFilter = false,
  missingKill = false,
  missingTrade = false,
  postSnapshotBridgeRange = null,
  postSnapshotBridgeAsks = [],
  postSnapshotBridgeBids = [],
  postSnapshotStaleDepthDiffCount = 0,
  proposalCount = 1,
  pseudoProposal = false,
  purpose = 'SMOKE_MECHANICS_ONLY',
  staleBookAtExit = false,
  terminal = true,
} = {}) {
  const policy = buildVolumeForwardMeasurementPolicy({
    policyId: 'volume-forward-policy-0001',
    policyRevision: 1,
    symbol: SYMBOL,
    frozenAtMs: FROZEN_AT_MS,
    outcomeOpensAtMs: OUTCOME_OPENS_AT_MS,
    outcomeClosesAtMs: OUTCOME_CLOSES_AT_MS,
    evidenceClosesAtMs: EVIDENCE_CLOSES_AT_MS,
    streams: REQUIRED_STREAMS,
    config: {
      enabled: false,
      killSwitchEngaged: true,
    },
  });
  const records = [];
  const named = {};
  let cursor;

  const started = expectStep(startVolumeForwardMeasurementEvidenceChain({
    chainId,
    localReceivedAtMs: FROZEN_AT_MS,
    localMonotonicNs: monotonicAt(FROZEN_AT_MS),
    rawPayload: jsonBytes(policy),
  }));
  named.policy = started.record;
  records.push(started.record);
  cursor = started.cursor;

  const append = (name, kind, payload, atMs, source = {}) => {
    const result = expectStep(appendVolumeForwardMeasurementEvidence(
      cursor,
      {
        kind,
        localReceivedAtMs: atMs,
        localMonotonicNs: monotonicAt(atMs),
        rawPayload: Buffer.isBuffer(payload) ? payload : jsonBytes(payload),
        ...source,
      },
    ));
    named[name] = result.record;
    records.push(result.record);
    cursor = result.cursor;
    return result.record;
  };
  const appendStream = (name, kind, payload, atMs, receipt = {}) => {
    const source = publicSource(kind);
    const frameBytes = jsonBytes({
      stream: source.sourceStream,
      data: payload,
    });
    append(
      `${name}Frame`,
      'STREAM_FRAME',
      frameBytes,
      atMs,
      {
        sourceEndpoint: source.sourceEndpoint,
        sourceSymbol: source.sourceSymbol,
        sourceStream: null,
        sourceTransport: source.sourceTransport,
        ...receipt,
      },
    );
    return append(name, kind, frameBytes, atMs, {
      ...source,
      ...receipt,
    });
  };

  append(
    'generationOpen',
    'GENERATION_OPEN',
    {
      combinedUrl: COMBINED_STREAM_URL,
      generation: 1,
      reason: 'INITIAL',
      streamMechanism: 'COMBINED_URL',
      streams: REQUIRED_STREAMS,
      timestampUnit: 'MILLISECOND',
    },
    FROZEN_AT_MS + 1,
  );

  const initialRange = initialDepthRange ?? (
    bridge === 'VALID'
      ? { U: 101, u: 102 }
      : bridge === 'SNAPSHOT_ONLY'
        ? { U: 98, u: 100 }
        : { U: 102, u: 102 }
  );
  appendStream(
    'initialDepthDiff',
    'DEPTH_DIFF',
    {
      e: 'depthUpdate',
      E: FROZEN_AT_MS + 10,
      s: SYMBOL,
      ...initialRange,
      b: [],
      a: [],
    },
    FROZEN_AT_MS + 10,
  );
  let entryDepthRange = initialRange;
  let entryDepthFrame = named.initialDepthDiffFrame;

  const exchangeInfoPayload = missingFilter
    ? { timezone: 'UTC', symbols: [] }
    : exchangeInfo(filter);
  const exchangeInfoRecord = append(
    'exchangeInfo',
    'EXCHANGE_INFO',
    exchangeInfoPayload,
    FROZEN_AT_MS + 11,
    publicSource('EXCHANGE_INFO'),
  );
  const configRecord = append(
    'config',
    'CONFIG_STATE',
    {
      combinedUrl: COMBINED_STREAM_URL,
      configurationRevision: CONFIGURATION_REVISION,
      depthLimit: 100,
      enabled: missingConfig ? true : false,
      evidenceClosesAtMs: EVIDENCE_CLOSES_AT_MS,
      frozenMeasurementRules: FROZEN_PACKET_RULES,
      killSwitchEngaged: true,
      measurementPolicyId: policy.policyId,
      measurementPolicySha256: FROZEN_MEASUREMENT_POLICY_SHA256,
      mode: 'SHADOW_ONLY',
      profitabilityClaim: 'FORBIDDEN',
      proposalAdmissionClosesAtMs: OUTCOME_CLOSES_AT_MS,
      purpose,
      recordOnly: true,
      streamMechanism: 'COMBINED_URL',
      symbol: SYMBOL,
      timestampUnit: 'MILLISECOND',
    },
    FROZEN_AT_MS + 12,
  );
  const killRecord = append(
    'kill',
    'KILL_STATE',
    {
      casAuthority: false,
      engaged: missingKill ? false : true,
      privateOrSignedAuthority: false,
      submitAuthority: false,
    },
    FROZEN_AT_MS + 13,
  );
  append(
    'depthSnapshot',
    'DEPTH_SNAPSHOT',
    {
      lastUpdateId: 100,
      bids: bookBids,
      asks: bookAsks,
    },
    FROZEN_AT_MS + 14,
    publicSource('DEPTH_SNAPSHOT'),
  );
  for (let index = 0; index < postSnapshotStaleDepthDiffCount; index += 1) {
    appendStream(
      'staleDepthDiff',
      'DEPTH_DIFF',
      {
        e: 'depthUpdate',
        E: FROZEN_AT_MS + 14,
        s: SYMBOL,
        U: 1,
        u: 100,
        b: [],
        a: [],
      },
      FROZEN_AT_MS + 14,
      {
        localMonotonicNs: String(
          BigInt(monotonicAt(FROZEN_AT_MS + 14)) + BigInt(index + 1),
        ),
      },
    );
  }
  if (postSnapshotBridgeRange !== null) {
    const bridgeReceipt = {
      localMonotonicNs: String(
        BigInt(monotonicAt(FROZEN_AT_MS + 14))
          + BigInt(postSnapshotStaleDepthDiffCount + 1),
      ),
    };
    appendStream(
      'postSnapshotBridgeDepthDiff',
      'DEPTH_DIFF',
      {
        e: 'depthUpdate',
        E: FROZEN_AT_MS + 14,
        s: SYMBOL,
        ...postSnapshotBridgeRange,
        b: postSnapshotBridgeBids,
        a: postSnapshotBridgeAsks,
      },
      FROZEN_AT_MS + 14,
      bridgeReceipt,
    );
    entryDepthRange = postSnapshotBridgeRange;
    entryDepthFrame = named.postSnapshotBridgeDepthDiffFrame;
    if (duplicatePostSnapshotBridge) {
      appendStream(
        'duplicatePostSnapshotBridgeDepthDiff',
        'DEPTH_DIFF',
        {
          e: 'depthUpdate',
          E: FROZEN_AT_MS + 14,
          s: SYMBOL,
          ...postSnapshotBridgeRange,
          b: [['98.00', '3.0000']],
          a: [],
        },
        FROZEN_AT_MS + 14,
        bridgeReceipt,
      );
    }
  }
  const entryTradePayload = {
    e: 'trade',
    E: FROZEN_AT_MS + 15,
    s: SYMBOL,
    t: missingTrade ? 699 : 700,
    p: '100.00',
    q: '0.0100',
    T: FROZEN_AT_MS + 15,
    m: false,
    M: true,
  };
  appendStream(
    'entryTrade',
    'TRADE',
    entryTradePayload,
    FROZEN_AT_MS + 15,
  );
  if (duplicateEntryTrade !== null) {
    appendStream(
      'duplicateEntryTrade',
      'TRADE',
      duplicateEntryTrade === 'IDENTICAL'
        ? entryTradePayload
        : {
            ...entryTradePayload,
            p: '101.00',
            q: '0.0200',
            m: true,
          },
      FROZEN_AT_MS + 15,
    );
  }
  appendStream(
    'entryAggregateTrade',
    'AGG_TRADE',
    {
      e: 'aggTrade',
      E: FROZEN_AT_MS + 16,
      s: SYMBOL,
      a: 800,
      p: '100.00',
      q: '0.0100',
      f: 700,
      l: 699 + aggregateTradeSpan,
      T: FROZEN_AT_MS + 16,
      m: false,
      M: true,
    },
    FROZEN_AT_MS + 16,
  );
  appendStream(
    'entryBookTicker',
    'BOOK_TICKER',
    missingBook
      ? {}
      : {
          u: entryBookTickerUpdateId
            ?? (bridge === 'VALID' ? entryDepthRange.u : 100),
          s: SYMBOL,
          b: entryBookTickerBidLevel[0],
          B: entryBookTickerBidLevel[1],
          a: entryBookTickerAskLevel[0],
          A: entryBookTickerAskLevel[1],
        },
    FROZEN_AT_MS + 17,
  );
  append(
    'entryContinuity',
    'CONTINUITY',
    bridge === 'VALID'
      ? {
          combinedFrames: [
            entryDepthFrame.header.rawSha256.slice(
              'sha256:'.length,
            ),
          ],
          generation: 1,
          previousFinalUpdateId: 100,
          firstUpdateId: entryDepthRange.U,
          finalUpdateId: entryDepthRange.u,
          silentGapFill: false,
          state: 'CONTIGUOUS',
        }
      : {
          combinedFrames: [],
          generation: 1,
          previousFinalUpdateId: 100,
          firstUpdateId: initialRange.U,
          finalUpdateId: initialRange.u,
          silentGapFill: false,
          state: bridge === 'SNAPSHOT_ONLY'
            ? 'AWAITING_BRIDGE'
            : 'GAP',
        },
    FROZEN_AT_MS + 18,
  );

  const controls = buildVolumeForwardPointInTimeControls({
    configurationRevision: CONFIGURATION_REVISION,
    configurationDigest: configRecord.header.rawSha256,
    filterDigest: exchangeInfoRecord.header.rawSha256,
    killStateDigest: killRecord.header.rawSha256,
    enabled: false,
    killSwitchEngaged: true,
    capturedAtMs: FROZEN_AT_MS + 13,
    receivedMonotonicNs: monotonicAt(FROZEN_AT_MS + 13),
  });
  const proposalDecisionAtMs = delayedProposal
    ? FROZEN_AT_MS + 13
    : OUTCOME_OPENS_AT_MS;
  const proposal = buildVolumeForwardDetectorProposalBinding(
    {
      proposalId: PROPOSAL_ID,
      proposalRevision: 1,
      proposalDigest: `vprop_${'a'.repeat(64)}`,
      configurationRevision: CONFIGURATION_REVISION,
      configurationDigest: controls.configurationDigest,
      controlsCapturedAtMs: controls.capturedAtMs,
      controlsReceivedMonotonicNs: controls.receivedMonotonicNs,
      correlationId: 'volume-forward-correlation-0001',
      symbol: SYMBOL,
      direction: 'long',
      updatedTs: proposalDecisionAtMs,
      featureObservedAtMs: proposalDecisionAtMs,
      expiresAtMs: OUTCOME_CLOSES_AT_MS - 1,
      detectorDecisionDigest: `vdetector_${'b'.repeat(64)}`,
      featureDigest: `vfeature_${'c'.repeat(64)}`,
      filterDigest: controls.filterDigest,
      killStateDigest: controls.killStateDigest,
      generation: 1,
      receivedMonotonicNs: monotonicAt(OUTCOME_OPENS_AT_MS),
    },
    controls,
  );
  const proposalPayload = pseudoProposal
    ? { ...proposal, proposalId: 'vroc:pseudo-proposal-0001' }
    : proposal;
  append(
    'proposal',
    'DETECTOR_PROPOSAL',
    proposalPayload,
    OUTCOME_OPENS_AT_MS,
  );
  for (let index = 2; index <= proposalCount; index += 1) {
    const atMs = OUTCOME_OPENS_AT_MS + index - 1;
    const detectorDecisionAtMs =
      purpose === 'FORWARD_MEASUREMENT_SEGMENT_V1'
        ? OUTCOME_OPENS_AT_MS
        : atMs;
    const suffix = String(index).padStart(4, '0');
    const proposalIndexDigest = index.toString(16).padStart(64, '0');
    append(
      `proposal${suffix}`,
      'DETECTOR_PROPOSAL',
      buildVolumeForwardDetectorProposalBinding(
        {
          proposalId: `volume-forward-proposal-${suffix}`,
          proposalRevision: 1,
          proposalDigest: `vprop_${proposalIndexDigest}`,
          configurationRevision: CONFIGURATION_REVISION,
          configurationDigest: controls.configurationDigest,
          controlsCapturedAtMs: controls.capturedAtMs,
          controlsReceivedMonotonicNs: controls.receivedMonotonicNs,
          correlationId: `volume-forward-correlation-${suffix}`,
          symbol: SYMBOL,
          direction: 'long',
          updatedTs: detectorDecisionAtMs,
          featureObservedAtMs: OUTCOME_OPENS_AT_MS,
          expiresAtMs: OUTCOME_CLOSES_AT_MS - 1,
          detectorDecisionDigest: `vdetector_${proposalIndexDigest}`,
          featureDigest: `vfeature_${proposalIndexDigest}`,
          filterDigest: controls.filterDigest,
          killStateDigest: controls.killStateDigest,
          generation: 1,
          receivedMonotonicNs: monotonicAt(atMs),
        },
        controls,
      ),
      atMs,
    );
  }

  let previousLifecycleRecordHash = null;
  let transitionRevision = 1;
  const appendLifecycle = (
    name,
    state,
    atMs,
    sourceRecordHash,
    reasonCodes,
  ) => {
    const record = append(
      name,
      'LIFECYCLE_RECORD',
      {
        mode: 'SHADOW_RECORD_ONLY',
        proposalId: proposalPayload.proposalId,
        proposalDigest: proposalPayload.proposalDigest,
        state,
        transitionRevision,
        previousLifecycleRecordHash,
        sourceRecordHash,
        ...(reasonCodes === undefined ? {} : { reasonCodes }),
      },
      atMs,
    );
    previousLifecycleRecordHash = record.recordHash;
    transitionRevision += 1;
    return record;
  };

  if (lifecycle === 'PREMATURE_TERMINAL') {
    appendLifecycle(
      'observedLifecycle',
      'OBSERVED',
      OUTCOME_OPENS_AT_MS + 1,
      named.proposal.recordHash,
    );
    appendLifecycle(
      'prematureTerminal',
      'TERMINAL_EXIT',
      OUTCOME_OPENS_AT_MS + 2,
      named.proposal.recordHash,
    );
  } else if (lifecycle === 'REORDERED') {
    appendLifecycle(
      'observedLifecycle',
      'OBSERVED',
      OUTCOME_OPENS_AT_MS + 1,
      named.proposal.recordHash,
    );
    appendLifecycle(
      'holdingBeforeEntry',
      'HOLDING',
      OUTCOME_OPENS_AT_MS + 2,
      named.proposal.recordHash,
    );
    appendLifecycle(
      'entryAfterHolding',
      'ENTRY_RECORDED',
      OUTCOME_OPENS_AT_MS + 3,
      named.proposal.recordHash,
    );
  } else if (
    lifecycle === 'TERMINAL_ONLY'
    || lifecycle === 'BLOCKED_EXACT'
    || lifecycle === 'BLOCKED_WRONG'
  ) {
    appendLifecycle(
      'observedLifecycle',
      'OBSERVED',
      OUTCOME_OPENS_AT_MS + 1,
      named.proposal.recordHash,
    );
    appendLifecycle(
      'entryLifecycle',
      'ENTRY_RECORDED',
      OUTCOME_OPENS_AT_MS + 2,
      named.proposal.recordHash,
    );
    appendLifecycle(
      'holdingLifecycle',
      'HOLDING',
      OUTCOME_OPENS_AT_MS + 3,
      named.proposal.recordHash,
    );
  }

  if (terminal) {
    const terminalDepthRange = exitDepthRange ?? { U: 103, u: 103 };
    const terminalDepthGap = bridge === 'VALID'
      && terminalDepthRange.U > entryDepthRange.u + 1;
    appendStream(
      'exitDepthDiff',
      'DEPTH_DIFF',
      {
        e: 'depthUpdate',
        E: EXIT_START_MS,
        s: SYMBOL,
        ...terminalDepthRange,
        b: [],
        a: [],
      },
      EXIT_START_MS,
    );
    appendStream(
      'exitTrade',
      'TRADE',
      {
        e: 'trade',
        E: EXIT_START_MS + 1,
        s: SYMBOL,
        t: 701,
        p: '100.00',
        q: '0.0100',
        T: EXIT_START_MS + 1,
        m: false,
        M: true,
      },
      EXIT_START_MS + 1,
    );
    appendStream(
      'exitAggregateTrade',
      'AGG_TRADE',
      {
        e: 'aggTrade',
        E: EXIT_START_MS + 2,
        s: SYMBOL,
        a: 801,
        p: '100.00',
        q: '0.0100',
        f: 701,
        l: 701,
        T: EXIT_START_MS + 2,
        m: false,
        M: true,
      },
      EXIT_START_MS + 2,
    );
    if (!staleBookAtExit) {
      appendStream(
        'exitBookTicker',
        'BOOK_TICKER',
        {
          u: terminalDepthRange.u,
          s: SYMBOL,
          b: bookBids[0][0],
          B: bookBids[0][1],
          a: bookAsks[0][0],
          A: bookAsks[0][1],
        },
        EXIT_START_MS + 3,
      );
    }
    append(
      'exitContinuity',
      'CONTINUITY',
      terminalDepthGap
        ? {
            combinedFrames: [],
            generation: 1,
            previousFinalUpdateId: entryDepthRange.u,
            firstUpdateId: terminalDepthRange.U,
            finalUpdateId: terminalDepthRange.u,
            silentGapFill: false,
            state: 'GAP',
          }
        : {
            combinedFrames: [
              named.exitDepthDiffFrame.header.rawSha256.slice(
                'sha256:'.length,
              ),
            ],
            generation: 1,
            previousFinalUpdateId: entryDepthRange.u,
            firstUpdateId: terminalDepthRange.U,
            finalUpdateId: terminalDepthRange.u,
            silentGapFill: false,
            state: 'CONTIGUOUS',
          },
      EXIT_START_MS + 4,
    );
    if (lifecycle === 'TERMINAL_ONLY' || lifecycle === 'REORDERED') {
      appendLifecycle(
        'terminalLifecycle',
        'TERMINAL_EXIT',
        EXIT_START_MS + 5,
        named.exitContinuity.recordHash,
      );
    }
  } else if (lifecycle === 'BLOCKED_EXACT') {
    appendLifecycle(
      'blockedLifecycle',
      'BLOCKED',
      OUTCOME_OPENS_AT_MS + 999,
      named.proposal.recordHash,
      ['OUTCOME_CUT_MISSING'],
    );
  } else if (lifecycle === 'BLOCKED_WRONG') {
    appendLifecycle(
      'blockedLifecycle',
      'BLOCKED',
      OUTCOME_OPENS_AT_MS + 999,
      named.proposal.recordHash,
      ['SOURCE_GENERATION_CHANGED'],
    );
  }

  const closeAtMs = terminal
    ? EXIT_START_MS + 6
    : OUTCOME_OPENS_AT_MS + Math.max(1_000, proposalCount + 10);
  const combinedFrameLedger = generationFrameLedger(records);
  const streamCounts = {
    depth100ms: combinedFrameLedger.filter(
      (entry) => entry.stream === DEPTH_STREAM,
    ).length,
    aggTrade: combinedFrameLedger.filter(
      (entry) => entry.stream === AGG_TRADE_STREAM,
    ).length,
    trade: combinedFrameLedger.filter(
      (entry) => entry.stream === TRADE_STREAM,
    ).length,
    bookTicker: combinedFrameLedger.filter(
      (entry) => entry.stream === BOOK_TICKER_STREAM,
    ).length,
  };
  const terminalDepthGap = bridge === 'VALID'
    && exitDepthRange !== null
    && exitDepthRange.U > entryDepthRange.u + 1;
  const continuityExact = bridge === 'VALID' && !terminalDepthGap;
  const lastProposalRecord = records
    .filter((record) => record.header.kind === 'DETECTOR_PROPOSAL')
    .at(-1);
  append(
    'generationClose',
    'GENERATION_CLOSE',
    {
      captureTruncated: false,
      closeCode: 1_000,
      combinedFrameLedger,
      combinedUrl: COMBINED_STREAM_URL,
      combinedUrlAcknowledged: true,
      continuity: continuityExact
        ? 'CONTIGUOUS'
        : 'REJECTED_NO_SILENT_FILL',
      depthBridgeExact: continuityExact,
      depthSnapshotCaptured: true,
      detectorProposalRecordHash: lastProposalRecord?.recordHash ?? null,
      gapDetected: bridge === 'GAP' || terminalDepthGap,
      generation: 1,
      invalidFrame: false,
      lifecycleAssertionsCaptured: lifecycle !== 'NONE',
      opened: true,
      reason: 'CAPTURE_STOP',
      streamCounts,
      streamFrameCount: combinedFrameLedger.length,
    },
    closeAtMs,
  );
  const sealed = expectStep(sealVolumeForwardMeasurementEvidenceChain(
    cursor,
    {
      localReceivedAtMs: closeAtMs + 1,
      localMonotonicNs: monotonicAt(closeAtMs + 1),
      rawPayload: jsonBytes({ reason: 'CAPTURE_COMPLETE' }),
    },
  ));
  named.terminalSeal = sealed.record;
  records.push(sealed.record);

  const expectedPolicyDigest = named.policy.header.rawSha256;
  const expectedTerminalHash = named.terminalSeal.recordHash;
  return {
    controls,
    expectedPolicyDigest,
    expectedTerminalHash,
    input: {
      evidenceRecords: records,
      expectedPolicyDigest,
      expectedTerminalHash,
    },
    named,
    policy,
    proposal,
    records,
  };
}

function makeTerminalFixture(options = {}) {
  const denseDepthRangeCount = options.denseDepthRangeCount ?? 0;
  const fixture = makeFixture({
    ...options,
    purpose: 'FORWARD_MEASUREMENT_SEGMENT_V1',
  });
  const records = JSON.parse(JSON.stringify(fixture.records));
  const terminalSeal = records.pop();
  const activationId = `ve2_activation_${'1'.repeat(64)}`;
  const captureId = 've2-forward-capture-0001';
  const segmentId = `ve2_segment_${'2'.repeat(64)}`;
  const chainKey = 've2-forward-symbol-btcusdt-0001';
  const detectorInputSourceId =
    'local://volume-detector/accepted-proposals/v1';
  const detectorInputSourceDigest = `sha256:${'3'.repeat(64)}`;
  const evaluationUniverseDigest = `sha256:${'4'.repeat(64)}`;
  const proposalRecords = records.filter(
    (record) => record.header.kind === 'DETECTOR_PROPOSAL',
  );
  const proposalRecord = proposalRecords[0];
  const proposal = decodedRawJson(proposalRecord);
  const proposals = proposalRecords.map(decodedRawJson);
  const priorLifecycleRecords = records.filter(
    (record) => record.header.kind === 'LIFECYCLE_RECORD',
  );
  for (const lifecycleRecord of priorLifecycleRecords) {
    records.splice(records.indexOf(lifecycleRecord), 1);
  }
  const localTemplate = records.find(
    (record) => record.header.kind === 'CONTINUITY',
  );
  if (options.delayEntryContinuityUntilAfterFirstCut === true) {
    const entryContinuity = records.find(
      (record) => (
        record.header.kind === 'CONTINUITY'
        && record.header.localReceivedAtMs === FROZEN_AT_MS + 18
      ),
    );
    assert.ok(entryContinuity);
    records.splice(records.indexOf(entryContinuity), 1);
    const delayedAtMs = OUTCOME_OPENS_AT_MS + 8;
    entryContinuity.header.localReceivedAtMs = delayedAtMs;
    entryContinuity.header.localMonotonicNs = monotonicAt(delayedAtMs);
    const insertion = records.findIndex(
      (record) => record.header.localReceivedAtMs > delayedAtMs,
    );
    records.splice(
      insertion < 0 ? records.length : insertion,
      0,
      entryContinuity,
    );
  }
  const blockedReasons = options.blockedReasons
    ?? (
      options.blockedReason === undefined
        ? null
        : [options.blockedReason]
    );
  const lifecycleRecords = [];
  for (let index = 0; index < proposals.length; index += 1) {
    const currentProposal = proposals[index];
    const basePayload = {
      mode: 'SHADOW_RECORD_ONLY',
      proposalId: currentProposal.proposalId,
      proposalDigest: currentProposal.proposalDigest,
      transitionRevision: 1,
      previousLifecycleRecordHash: null,
      sourceRecordHash: `sha256:${'0'.repeat(64)}`,
    };
    lifecycleRecords.push(terminalLocalRecord(
      localTemplate,
      'LIFECYCLE_RECORD',
      {
        ...basePayload,
        state: 'OBSERVED',
      },
      OUTCOME_OPENS_AT_MS + 5 + index * 3,
    ));
    if (blockedReasons === null) {
      lifecycleRecords.push(
        terminalLocalRecord(
          localTemplate,
          'LIFECYCLE_RECORD',
          {
            ...basePayload,
            state: 'ENTRY_RECORDED',
          },
          OUTCOME_OPENS_AT_MS + 6 + index * 3,
        ),
        terminalLocalRecord(
          localTemplate,
          'LIFECYCLE_RECORD',
          {
            ...basePayload,
            state: 'HOLDING',
          },
          OUTCOME_OPENS_AT_MS + 7 + index * 3,
        ),
        terminalLocalRecord(
          localTemplate,
          'LIFECYCLE_RECORD',
          {
            ...basePayload,
            state: 'TERMINAL_EXIT',
          },
          EXIT_START_MS + 5 + index,
        ),
      );
    } else {
      lifecycleRecords.push(terminalLocalRecord(
        localTemplate,
        'LIFECYCLE_RECORD',
        {
          ...basePayload,
          state: 'BLOCKED',
          reasonCodes: blockedReasons,
        },
        OUTCOME_OPENS_AT_MS + 6 + index * 3,
      ));
    }
  }
  for (const lifecycleRecord of lifecycleRecords) {
    const insertion = records.findIndex(
      (record) => (
        record.header.localReceivedAtMs
          > lifecycleRecord.header.localReceivedAtMs
      ),
    );
    records.splice(
      insertion < 0 ? records.length : insertion,
      0,
      lifecycleRecord,
    );
  }
  const generationCloseRecord = records.find(
    (record) => record.header.kind === 'GENERATION_CLOSE',
  );
  const closeAtMs = EXIT_START_MS + 100 + proposals.length;
  records.splice(records.indexOf(generationCloseRecord), 1);
  generationCloseRecord.header.localReceivedAtMs = closeAtMs;
  generationCloseRecord.header.localMonotonicNs = monotonicAt(closeAtMs);
  records.push(generationCloseRecord);
  terminalSeal.header.localReceivedAtMs = closeAtMs + 1;
  terminalSeal.header.localMonotonicNs = monotonicAt(closeAtMs + 1);
  if (denseDepthRangeCount > 0) {
    assert.ok(denseDepthRangeCount <= 1_900);
    const initialFinalUpdateId = 102;
    const denseRecords = [];
    let batchPreviousFinalUpdateId = initialFinalUpdateId;
    let batchFrameHashes = [];
    let batchFirstUpdateId = null;
    const frameTemplate = records.find(
      (record) => (
        record.header.kind === 'STREAM_FRAME'
        && record.header.localReceivedAtMs === FROZEN_AT_MS + 10
      ),
    );
    const typedTemplate = records.find(
      (record) => (
        record.header.kind === 'DEPTH_DIFF'
        && record.header.localReceivedAtMs === FROZEN_AT_MS + 10
      ),
    );
    for (let offset = 1; offset <= denseDepthRangeCount; offset += 1) {
      const updateId = initialFinalUpdateId + offset;
      const atMs = OUTCOME_OPENS_AT_MS + offset * 100;
      const envelope = {
        stream: DEPTH_STREAM,
        data: {
          e: 'depthUpdate',
          E: atMs,
          s: SYMBOL,
          U: updateId,
          u: updateId,
          b: [],
          a: [],
        },
      };
      const frame = JSON.parse(JSON.stringify(frameTemplate));
      frame.header.localReceivedAtMs = atMs;
      frame.header.localMonotonicNs = monotonicAt(atMs);
      frame.rawBase64 = jsonBytes(envelope).toString('base64');
      const typed = JSON.parse(JSON.stringify(typedTemplate));
      typed.header.localReceivedAtMs = atMs;
      typed.header.localMonotonicNs = monotonicAt(atMs);
      typed.rawBase64 = frame.rawBase64;
      denseRecords.push(frame, typed);
      batchFirstUpdateId ??= updateId;
      batchFrameHashes.push(sha256(jsonBytes(envelope)).slice(7));
      const batchComplete = batchFrameHashes.length === 200
        || offset === denseDepthRangeCount;
      if (batchComplete) {
        denseRecords.push(terminalLocalRecord(
          localTemplate,
          'CONTINUITY',
          {
            combinedFrames: batchFrameHashes,
            generation: 1,
            previousFinalUpdateId: batchPreviousFinalUpdateId,
            firstUpdateId: batchFirstUpdateId,
            finalUpdateId: updateId,
            silentGapFill: false,
            state: 'CONTIGUOUS',
          },
          atMs,
        ));
        batchPreviousFinalUpdateId = updateId;
        batchFirstUpdateId = null;
        batchFrameHashes = [];
      }
    }
    for (const denseRecord of denseRecords) {
      const insertion = records.findIndex(
        (record) => (
          record.header.localReceivedAtMs
            > denseRecord.header.localReceivedAtMs
        ),
      );
      records.splice(
        insertion < 0 ? records.length : insertion,
        0,
        denseRecord,
      );
    }
    const exitUpdateId =
      initialFinalUpdateId + denseDepthRangeCount + 1;
    for (const record of records) {
      if (
        record.header.localReceivedAtMs === EXIT_START_MS
        && (
          record.header.kind === 'STREAM_FRAME'
          || record.header.kind === 'DEPTH_DIFF'
        )
      ) {
        const envelope = decodedRawJson(record);
        envelope.data.U = exitUpdateId;
        envelope.data.u = exitUpdateId;
        record.rawBase64 = jsonBytes(envelope).toString('base64');
      }
      if (
        record.header.localReceivedAtMs === EXIT_START_MS + 3
        && (
          record.header.kind === 'STREAM_FRAME'
          || record.header.kind === 'BOOK_TICKER'
        )
      ) {
        const envelope = decodedRawJson(record);
        envelope.data.u = exitUpdateId;
        record.rawBase64 = jsonBytes(envelope).toString('base64');
      }
    }
    const exitFrame = records.find(
      (record) => (
        record.header.kind === 'STREAM_FRAME'
        && record.header.localReceivedAtMs === EXIT_START_MS
      ),
    );
    for (const record of records) {
      if (
        record.header.kind === 'CONTINUITY'
        && record.header.localReceivedAtMs === EXIT_START_MS + 4
      ) {
        const continuity = decodedRawJson(record);
        continuity.combinedFrames = [
          sha256(Buffer.from(exitFrame.rawBase64, 'base64')).slice(7),
        ];
        continuity.previousFinalUpdateId = exitUpdateId - 1;
        continuity.firstUpdateId = exitUpdateId;
        continuity.finalUpdateId = exitUpdateId;
        record.rawBase64 = jsonBytes(continuity).toString('base64');
      }
    }
  }
  let previousCutDigest = null;
  const cutRecords = [];
  for (let cutOffset = 0; cutOffset <= 30; cutOffset += 1) {
    const cutAtMs = OUTCOME_OPENS_AT_MS + cutOffset * 2_000;
    const localReceivedAtMs = cutAtMs + 4;
    const acceptedProposals = cutOffset === 0
      ? proposals.map((currentProposal) => ({
          cutOffset,
          proposalId: currentProposal.proposalId,
          proposalRevision: currentProposal.proposalRevision,
          proposalDigest: currentProposal.proposalDigest,
          symbol: currentProposal.symbol,
          detectorDecisionDigest:
            currentProposal.detectorDecisionDigest,
          featureDigest: currentProposal.featureDigest,
        })).sort((left, right) => (
          `${String(left.cutOffset).padStart(16, '0')}|${left.proposalId}|${String(left.proposalRevision).padStart(16, '0')}|${left.proposalDigest}|${left.symbol}`
            .localeCompare(
              `${String(right.cutOffset).padStart(16, '0')}|${right.proposalId}|${String(right.proposalRevision).padStart(16, '0')}|${right.proposalDigest}|${right.symbol}`,
            )
        ))
      : [];
    const cut = {
      schemaVersion: 'volume.forward.detector-coverage-cut.v1',
      profile: 'FORWARD_MEASUREMENT_SEGMENT_V1',
      captureId,
      activationId,
      segmentId,
      chainKey,
      detectorInputSourceId,
      detectorInputSourceDigest,
      runtimeGeneration: 1,
      detectorTickRevision: cutOffset + 1,
      cutOffset,
      cutAtMs,
      localReceivedAtMs,
      localMonotonicNs: monotonicAt(localReceivedAtMs),
      cadenceMs: 2_000,
      configurationRevision: proposal.configurationRevision,
      configurationDigest: proposal.configurationDigest,
      strategyEnabled: false,
      killSwitchEngaged: true,
      evaluationUniverseDigest,
      evaluationUniverseCount: proposals.length,
      pseudoProposalExcludedCount: 0,
      acceptedProposals,
      observerDropCount: 0,
      observerFailureCount: 0,
      previousCutDigest,
      cutDigest: '',
      complete: true,
    };
    cut.cutDigest = detectorCoverageCutDigest(cut);
    previousCutDigest = cut.cutDigest;
    cutRecords.push(terminalLocalRecord(
      localTemplate,
      'DETECTOR_COVERAGE',
      cut,
      localReceivedAtMs,
    ));
  }
  for (const cutRecord of cutRecords) {
    const insertion = records.findIndex(
      (record) => (
        record.header.localReceivedAtMs
          > cutRecord.header.localReceivedAtMs
      ),
    );
    records.splice(insertion < 0 ? records.length : insertion, 0, cutRecord);
  }
  records.push(terminalSeal);
  recomputeTerminalSegmentChain(records, {
    activationId,
    captureId,
    chainKey,
    detectorInputSourceDigest,
    detectorInputSourceId,
    segmentId,
  });
  const expectedPolicyDigest = records[0].header.rawSha256;
  const expectedTerminalHash = records.at(-1).recordHash;
  return {
    ...fixture,
    activationId,
    captureId,
    chainKey,
    detectorInputSourceDigest,
    detectorInputSourceId,
    expectedPolicyDigest,
    expectedTerminalHash,
    input: {
      evidenceRecords: records,
      expectedPolicyDigest,
      expectedTerminalHash,
    },
    records,
    segmentId,
  };
}

function makeDetectorCoverageFixture() {
  const detectorInputSourceId =
    'local://volume-detector/accepted-proposals/v1';
  const detectorInputSourceDigest = `sha256:${'5'.repeat(64)}`;
  const outcomeOpensAtMs = FROZEN_AT_MS + 2_000;
  const outcomeClosesAtMs = outcomeOpensAtMs + 62_000;
  const policy = buildVolumeForwardDetectorCoveragePolicy({
    policyId: 'volume-forward-detector-coverage-policy-0001',
    policyRevision: 1,
    role: 'DETECTOR_COVERAGE',
    symbol: null,
    frozenAtMs: FROZEN_AT_MS,
    outcomeOpensAtMs,
    outcomeClosesAtMs,
    evidenceClosesAtMs: outcomeClosesAtMs,
    cadenceMs: 2_000,
    detectorInputSourceId,
    detectorInputSourceDigest,
    config: {
      enabled: false,
      killSwitchEngaged: true,
    },
  });
  const activationId = `ve2_activation_${'6'.repeat(64)}`;
  const captureId = 've2-forward-detector-capture-0001';
  const segmentId = `ve2_segment_${'7'.repeat(64)}`;
  const chainKey = 've2-forward-detector-global-0001';
  const records = [];
  let result = expectStep(startVolumeForwardMeasurementEvidenceChain({
    chainId: 'volume-forward-detector-coverage-segment',
    localReceivedAtMs: FROZEN_AT_MS,
    localMonotonicNs: monotonicAt(FROZEN_AT_MS),
    rawPayload: jsonBytes(policy),
  }));
  records.push(result.record);
  let cursor = result.cursor;
  let previousCutDigest = null;
  const evaluationUniverseDigest = `sha256:${'8'.repeat(64)}`;
  for (let cutOffset = 0; cutOffset <= 30; cutOffset += 1) {
    const cutAtMs = outcomeOpensAtMs + cutOffset * 2_000;
    const localReceivedAtMs = cutAtMs + 4;
    const cut = {
      schemaVersion: 'volume.forward.detector-coverage-cut.v1',
      profile: 'FORWARD_MEASUREMENT_SEGMENT_V1',
      captureId,
      activationId,
      segmentId,
      chainKey,
      detectorInputSourceId,
      detectorInputSourceDigest,
      runtimeGeneration: 1,
      detectorTickRevision: cutOffset + 1,
      cutOffset,
      cutAtMs,
      localReceivedAtMs,
      localMonotonicNs: monotonicAt(localReceivedAtMs),
      cadenceMs: 2_000,
      configurationRevision: CONFIGURATION_REVISION,
      configurationDigest: `sha256:${'9'.repeat(64)}`,
      strategyEnabled: false,
      killSwitchEngaged: true,
      evaluationUniverseDigest,
      evaluationUniverseCount: 0,
      pseudoProposalExcludedCount: 0,
      acceptedProposals: [],
      observerDropCount: 0,
      observerFailureCount: 0,
      previousCutDigest,
      cutDigest: '',
      complete: true,
    };
    cut.cutDigest = detectorCoverageCutDigest(cut);
    previousCutDigest = cut.cutDigest;
    result = expectStep(appendVolumeForwardMeasurementEvidence(
      cursor,
      {
        kind: 'DETECTOR_COVERAGE',
        localReceivedAtMs,
        localMonotonicNs: monotonicAt(localReceivedAtMs),
        rawPayload: jsonBytes(cut),
      },
    ));
    records.push(result.record);
    cursor = result.cursor;
  }
  const firstCut = decodedRawJson(records[1]);
  const lastCut = decodedRawJson(records.at(-1));
  const byteCount = records.reduce(
    (total, record) => (
      total + Buffer.byteLength(canonicalJson(record), 'utf8') + 1
    ),
    0,
  );
  const zeroStateCounts = {
    OBSERVED: 0,
    ENTRY_RECORDED: 0,
    HOLDING: 0,
    TERMINAL_EXIT: 0,
    BLOCKED: 0,
    EXACT: 0,
  };
  result = expectStep(sealVolumeForwardMeasurementEvidenceChain(
    cursor,
    {
      localReceivedAtMs: lastCut.localReceivedAtMs + 1,
      localMonotonicNs: monotonicAt(lastCut.localReceivedAtMs + 1),
      rawPayload: jsonBytes({
        schemaVersion: 'volume.forward.segment-seal.v1',
        profile: 'FORWARD_MEASUREMENT_SEGMENT_V1',
        segmentId,
        captureId,
        activationId,
        coverageRole: 'DETECTOR_COVERAGE',
        chainKey,
        symbol: null,
        segmentIndex: 0,
        previousTerminalHash: null,
        corePolicyDigest: records[0].header.rawSha256,
        packetMeasurementPolicySha256:
          FROZEN_MEASUREMENT_POLICY_SHA256,
        detectorInputSourceId,
        detectorInputSourceDigest,
        coverage: {
          startMs: firstCut.cutAtMs,
          endExclusiveMs: lastCut.cutAtMs + 2_000,
        },
        recordBounds: {
          firstHash: records[0].recordHash,
          sealedTailHash: cursor.previousHash,
          firstSequence: 0,
          lastSequence: cursor.nextSequence - 1,
          recordCount: cursor.nextSequence,
          byteCount,
        },
        nonTruncated: true,
        closeReason: 'MEASUREMENT_INTERVAL_COMPLETE',
        generationSummary: {
          count: 1,
          continuityGapCount: 0,
          unresolvedCount: 0,
        },
        detectorCoverage: {
          coverageChainKey: chainKey,
          firstCutOffset: firstCut.cutOffset,
          lastCutOffset: lastCut.cutOffset,
          cutCount: 31,
          expectedCutCount: 31,
          missingCutCount: 0,
          maxGapMs: 2_000,
          uncoveredMs: 0,
          firstCutDigest: firstCut.cutDigest,
          lastCutDigest: lastCut.cutDigest,
          complete: true,
        },
        acceptedProposals: [],
        lifecycleSummary: {
          proposalKeys: [],
          assertionCount: 0,
          openCount: 0,
          stateCounts: zeroStateCounts,
        },
        pseudoProposalExcludedCount: 0,
        quiescent: true,
      }),
    },
  ));
  records.push(result.record);
  return {
    activationId,
    expectedPolicyDigest: records[0].header.rawSha256,
    expectedTerminalHash: records.at(-1).recordHash,
    input: {
      evidenceRecords: records,
      expectedPolicyDigest: records[0].header.rawSha256,
      expectedTerminalHash: records.at(-1).recordHash,
    },
    policy,
    records,
    segmentId,
  };
}

function replayFixture(fixture) {
  return replayVolumeForwardMeasurementEvidence(fixture.input);
}

function replaySelfConsistentMutation(fixture, mutate) {
  const records = JSON.parse(JSON.stringify(fixture.records));
  mutate(records);
  recomputeSelfConsistentChain(records);
  return replayVolumeForwardMeasurementEvidence({
    evidenceRecords: records,
    expectedPolicyDigest: fixture.expectedPolicyDigest,
    expectedTerminalHash: records.at(-1).recordHash,
  });
}

function decodedRawJson(record) {
  return JSON.parse(Buffer.from(record.rawBase64, 'base64').toString('utf8'));
}

function rewriteRawJson(records, index, mutate) {
  const value = decodedRawJson(records[index]);
  mutate(value);
  records[index].rawBase64 = jsonBytes(value).toString('base64');
}

function assertReasons(result, expected) {
  for (const reason of expected) {
    assert.ok(
      result.reasonCodes.includes(reason),
      `expected ${reason}; found ${result.reasonCodes.join(',')}`,
    );
  }
}

function assertSourceProtocolRejected(result) {
  assert.equal(result.state, 'BLOCKED');
  assert.ok(
    result.reasonCodes.includes('SOURCE_PAYLOAD_INVALID')
      || result.reasonCodes.includes('EVIDENCE_CHAIN_INVALID'),
    `expected source protocol rejection; found ${result.reasonCodes.join(',')}`,
  );
}

function sourceRefFor(record, references) {
  const found = references.find(
    (reference) => reference.recordHash === record.recordHash,
  );
  assert.ok(found, `missing source ref for ${record.header.kind}`);
  return found;
}

test('canonical replay binds policy-first raw cuts and reaches one exact 60-second record-only terminal lifecycle', () => {
  const fixture = makeFixture();
  const verified = verifyVolumeForwardMeasurementEvidenceChain(
    fixture.records,
    {
      expectedPolicyDigest: fixture.expectedPolicyDigest,
      expectedTerminalHash: fixture.expectedTerminalHash,
    },
  );
  assert.equal(verified.ok, true);
  assert.equal(
    verified.ok && verified.verification.sourceAuthenticity,
    'TRUSTED_ANCHOR_MATCHED',
  );

  const result = replayFixture(fixture);
  assert.equal(result.state, 'EXACT');
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.chainId, 'volume-forward-replay-canonical');
  assert.equal(result.policyDigest, fixture.policy.policyDigest);
  assert.equal(result.evidencePolicyDigest, fixture.expectedPolicyDigest);
  assert.equal(result.terminalHash, fixture.expectedTerminalHash);
  assert.equal(result.sourceAuthenticity, 'TRUSTED_ANCHOR_MATCHED');
  assert.deepEqual(result.trustedAnchors, {
    expectedPolicyDigest: fixture.expectedPolicyDigest,
    expectedTerminalHash: fixture.expectedTerminalHash,
    policyDigestMatched: true,
    terminalHashMatched: true,
  });
  assert.equal(result.evidenceRecordCount, fixture.records.length);
  assert.equal(result.lifecycles.length, 1);

  assert.equal(fixture.records[0], fixture.named.policy);
  assert.equal(fixture.named.policy.header.kind, 'POLICY');
  assert.equal(fixture.named.policy.header.sequence, 0);
  assert.equal(fixture.named.policy.header.previousHash, null);
  assert.equal(fixture.named.policy.header.sourceStream, null);
  assert.equal(
    fixture.named.policy.header.rawSha256,
    fixture.expectedPolicyDigest,
  );
  for (const record of fixture.records) {
    assert.equal(record.header.policyDigest, fixture.expectedPolicyDigest);
    assert.deepEqual(record.header.authority, {
      cas: false,
      execution: 'NONE',
      privateData: false,
      signedRequest: false,
      submit: false,
    });
  }

  assert.deepEqual(
    {
      enabled: fixture.policy.config.enabled,
      killSwitchEngaged: fixture.policy.config.killSwitchEngaged,
      authorityEnabled: VOLUME_FORWARD_MEASUREMENT_AUTHORITY.enabled,
      authorityKill: VOLUME_FORWARD_MEASUREMENT_AUTHORITY.killSwitchEngaged,
      execution: VOLUME_FORWARD_MEASUREMENT_AUTHORITY.executionAuthority,
      submit: VOLUME_FORWARD_MEASUREMENT_AUTHORITY.submitAuthority,
      cas: VOLUME_FORWARD_MEASUREMENT_AUTHORITY.casAuthority,
      privateCalls: VOLUME_FORWARD_MEASUREMENT_AUTHORITY.privateCalls,
      providerCalls: VOLUME_FORWARD_MEASUREMENT_AUTHORITY.providerCalls,
    },
    {
      enabled: false,
      killSwitchEngaged: true,
      authorityEnabled: false,
      authorityKill: true,
      execution: 'NONE',
      submit: 'NONE',
      cas: 'NONE',
      privateCalls: 0,
      providerCalls: 0,
    },
  );

  const lifecycle = result.lifecycles[0];
  assert.equal(lifecycle.state, 'EXACT');
  assert.equal(lifecycle.lifecyclePhase, 'TERMINAL_EXIT');
  assert.deepEqual(lifecycle.reasonCodes, []);
  assert.ok(lifecycle.terminalSampleId?.startsWith('vfes_'));
  assert.equal(lifecycle.entryEvaluation, null);
  assert.equal(lifecycle.exitDecision, null);
  assert.equal(lifecycle.validatorAdapterOnly, true);
  assert.deepEqual(lifecycle.sourceNativeEconomics, {
    state: 'PUBLIC_SOURCE_FACTS_ONLY',
    entryQuoteNotional: '10',
    entryBaseQuantity: '0.1',
    entryLimitPrice: '100',
    exitQuoteNotional: '9.9',
    grossPnlQuote: '-0.1',
    grossEdgePer1000ValuationNotional: '-10',
    publicFeeScenarios: [
      {
        feeBpsPerSide: '10',
        netPnlQuote: '-0.1199',
        netEdgePer1000ValuationNotional: '-11.99',
      },
      {
        feeBpsPerSide: '12',
        netPnlQuote: '-0.12388',
        netEdgePer1000ValuationNotional: '-12.388',
      },
    ],
    accountEffectiveFeeBpsPerSide: null,
  });
  assert.equal(lifecycle.profitabilityClaim, false);

  const proof = lifecycle.validatorAdapterProof;
  assert.ok(proof);
  assert.ok(proof.entryEvaluationId.length > 0);
  assert.ok(proof.entryPlanId.length > 0);
  assert.ok(proof.exitDecisionId?.length > 0);
  assert.ok(proof.exitPlanId?.length > 0);
  assert.deepEqual(
    {
      runtimeStrategyEnabled: proof.runtimeStrategyEnabled,
      validatorAdapterEvaluationEnabled:
        proof.validatorAdapterEvaluationEnabled,
      killSwitchEngaged: proof.killSwitchEngaged,
      executionAuthority: proof.executionAuthority,
      submitAuthority: proof.submitAuthority,
      sendEligible: proof.sendEligible,
      sends: proof.sends,
      sideEffects: proof.sideEffects,
      publicOnly: proof.publicOnly,
      privateCalls: proof.privateCalls,
      signedCalls: proof.signedCalls,
      providerCalls: proof.providerCalls,
      entryModeledBaseQuantity: proof.entryModeledBaseQuantity,
      entryModeledLimitPrice: proof.entryModeledLimitPrice,
      entryModeledQuoteNotional: proof.entryModeledQuoteNotional,
      capturedRestBaseUrl: proof.capturedRestBaseUrl,
      capturedWebsocketBaseUrl: proof.capturedWebsocketBaseUrl,
      legacyValidatorRestBaseUrl: proof.legacyValidatorRestBaseUrl,
      provenanceDisposition: proof.provenanceDisposition,
    },
    {
      runtimeStrategyEnabled: false,
      validatorAdapterEvaluationEnabled: true,
      killSwitchEngaged: true,
      executionAuthority: 'NONE',
      submitAuthority: 'NONE',
      sendEligible: false,
      sends: 0,
      sideEffects: 0,
      publicOnly: true,
      privateCalls: false,
      signedCalls: false,
      providerCalls: false,
      entryModeledBaseQuantity: '0.1',
      entryModeledLimitPrice: '100',
      entryModeledQuoteNotional: '10',
      capturedRestBaseUrl: 'https://data-api.binance.vision',
      capturedWebsocketBaseUrl: 'wss://data-stream.binance.vision',
      legacyValidatorRestBaseUrl: 'https://api.binance.com',
      provenanceDisposition:
        'CAPTURED_SOURCE_AUTHORITATIVE_VALIDATOR_ADAPTER_NON_AUTHORITATIVE',
    },
  );

  const binding = lifecycle.binding;
  assert.ok(binding);
  assert.equal(binding.validatorAdapterOnly, true);
  assert.equal(binding.policyDigest, fixture.expectedPolicyDigest);
  assert.equal(binding.proposalId, PROPOSAL_ID);
  assert.equal(binding.proposalDigest, fixture.proposal.proposalDigest);
  assert.equal(binding.configurationRevision, CONFIGURATION_REVISION);
  assert.equal(binding.configRecordHash, fixture.named.config.recordHash);
  assert.equal(binding.killRecordHash, fixture.named.kill.recordHash);
  assert.equal(
    binding.exchangeInfoRecordHash,
    fixture.named.exchangeInfo.recordHash,
  );
  assert.equal(
    fixture.proposal.configurationDigest,
    fixture.named.config.header.rawSha256,
  );
  assert.equal(
    fixture.proposal.filterDigest,
    fixture.named.exchangeInfo.header.rawSha256,
  );
  assert.equal(
    fixture.proposal.killStateDigest,
    fixture.named.kill.header.rawSha256,
  );
  assert.equal(
    fixture.proposal.controlsCapturedAtMs,
    fixture.controls.capturedAtMs,
  );
  assert.equal(
    fixture.proposal.controlsReceivedMonotonicNs,
    fixture.controls.receivedMonotonicNs,
  );
  assert.equal(fixture.proposal.proposalId.startsWith('vroc:'), false);

  assert.ok(
    fixture.named.initialDepthDiffFrame.header.sequence
      < fixture.named.initialDepthDiff.header.sequence
    && fixture.named.initialDepthDiff.header.sequence
      < fixture.named.depthSnapshot.header.sequence,
  );
  assert.equal(
    fixture.named.initialDepthDiffFrame.header.sequence + 1,
    fixture.named.initialDepthDiff.header.sequence,
  );
  assert.equal(
    fixture.named.initialDepthDiffFrame.rawBase64,
    fixture.named.initialDepthDiff.rawBase64,
  );
  assert.equal(
    fixture.named.initialDepthDiffFrame.header.rawSha256,
    fixture.named.initialDepthDiff.header.rawSha256,
  );
  assert.equal(
    fixture.named.initialDepthDiffFrame.header.localReceivedAtMs,
    fixture.named.initialDepthDiff.header.localReceivedAtMs,
  );
  assert.equal(
    fixture.named.initialDepthDiffFrame.header.localMonotonicNs,
    fixture.named.initialDepthDiff.header.localMonotonicNs,
  );
  assert.equal(fixture.named.initialDepthDiffFrame.header.sourceStream, null);
  assert.equal(fixture.named.initialDepthDiff.header.sourceStream, DEPTH_STREAM);
  for (const record of [
    fixture.named.initialDepthDiffFrame,
    fixture.named.initialDepthDiff,
    fixture.named.depthSnapshot,
    fixture.named.entryContinuity,
  ]) {
    const ref = sourceRefFor(record, binding.entryEvidenceSources);
    assert.equal(ref.rawSha256, record.header.rawSha256);
    assert.equal(ref.sourceStream, record.header.sourceStream);
    assert.equal(ref.sequence, record.header.sequence);
  }
  assert.equal(
    sourceRefFor(
      fixture.named.initialDepthDiff,
      binding.entryEvidenceSources,
    ).sourceStream,
    DEPTH_STREAM,
  );
  assert.equal(
    sourceRefFor(
      fixture.named.depthSnapshot,
      binding.entryEvidenceSources,
    ).sourceStream,
    '/api/v3/depth',
  );
  assert.equal(
    sourceRefFor(
      fixture.named.entryContinuity,
      binding.entryEvidenceSources,
    ).sourceStream,
    null,
  );
  for (const record of [
    fixture.named.initialDepthDiffFrame,
    fixture.named.initialDepthDiff,
    fixture.named.depthSnapshot,
    fixture.named.exitDepthDiffFrame,
    fixture.named.exitDepthDiff,
    fixture.named.exitContinuity,
  ]) {
    sourceRefFor(record, binding.exitEvidenceSources);
  }
  assert.equal(binding.entryGeneration, 1);
  assert.equal(binding.exitGeneration, 1);
  assert.ok(binding.entrySourceRevision > 0);
  assert.ok(binding.exitSourceRevision > binding.entrySourceRevision);
  assert.ok(binding.entryValidatorAdapterObservationDigest.startsWith('vobs_'));
  assert.ok(binding.exitValidatorAdapterObservationDigest?.startsWith('vobs_'));
  assert.equal(EXIT_START_MS - OUTCOME_OPENS_AT_MS, 60_000);
  assert.equal(
    BigInt(fixture.named.exitDepthDiff.header.localMonotonicNs)
      - BigInt(fixture.named.proposal.header.localMonotonicNs),
    60_000_000_000n,
  );

  assert.deepEqual(
    {
      consumerGate: result.consumerGate,
      economics: result.economics,
      profitabilityClaim: result.profitabilityClaim,
      mode: result.mode,
      measurementMode: result.measurementMode,
      recordOnly: result.recordOnly,
      strategyEnabled: result.strategyEnabled,
      killSwitchEngaged: result.killSwitchEngaged,
      submitAuthority: result.submitAuthority,
      casAuthority: result.casAuthority,
      privateOrSignedCalls: result.privateOrSignedCalls,
      orders: result.orders,
      transfers: result.transfers,
      withdrawals: result.withdrawals,
      moneyUsd: result.moneyUsd,
    },
    {
      consumerGate: VOLUME_FORWARD_MEASUREMENT_CONSUMER_GATE,
      economics: null,
      profitabilityClaim: false,
      mode: 'SHADOW_ONLY',
      measurementMode: VOLUME_FORWARD_MEASUREMENT_REPLAY_MODE,
      recordOnly: true,
      strategyEnabled: false,
      killSwitchEngaged: true,
      submitAuthority: false,
      casAuthority: false,
      privateOrSignedCalls: 0,
      orders: 0,
      transfers: 0,
      withdrawals: 0,
      moneyUsd: 0,
    },
  );
});

test('terminal segment profile derives gapless detector coverage, durable lifecycle, and public-only economics from sealed source records', () => {
  const fixture = makeTerminalFixture({
    chainId: 'volume-forward-terminal-segment',
  });
  const verified = verifyVolumeForwardMeasurementEvidenceChain(
    fixture.records,
    {
      expectedPolicyDigest: fixture.expectedPolicyDigest,
      expectedTerminalHash: fixture.expectedTerminalHash,
      requireMeasurementBundle: false,
      requireSealed: false,
    },
  );
  assert.equal(
    verified.ok,
    true,
    verified.ok ? undefined : verified.detailCode,
  );
  const result = replayFixture(fixture);
  assert.equal(result.state, 'EXACT');
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.replayProfile, 'TERMINAL_SEGMENT');
  assert.ok(result.segmentFacts);
  assert.deepEqual(
    {
      purpose: result.segmentFacts.purpose,
      coverageRole: result.segmentFacts.coverageRole,
      activationId: result.segmentFacts.activationId,
      segmentId: result.segmentFacts.segmentId,
      detectorCutFirstIndex:
        result.segmentFacts.detectorCutFirstIndex,
      detectorCutCount: result.segmentFacts.detectorCutCount,
      detectorExpectedCutCount:
        result.segmentFacts.detectorExpectedCutCount,
      detectorCadenceMs: result.segmentFacts.detectorCadenceMs,
      missingDetectorCutCount:
        result.segmentFacts.missingDetectorCutCount,
      maximumDetectorCutGapMs:
        result.segmentFacts.maximumDetectorCutGapMs,
      detectorCoverageComplete:
        result.segmentFacts.detectorCoverageComplete,
      lifecycleCount: result.segmentFacts.lifecycleCount,
      terminalLifecycleCount:
        result.segmentFacts.terminalLifecycleCount,
      blockedLifecycleCount:
        result.segmentFacts.blockedLifecycleCount,
      openLifecycleCount: result.segmentFacts.openLifecycleCount,
      unresolvedContinuityGapCount:
        result.segmentFacts.unresolvedContinuityGapCount,
      quiescent: result.segmentFacts.quiescent,
      profitabilityClaim: result.segmentFacts.profitabilityClaim,
    },
    {
      purpose: 'FORWARD_MEASUREMENT_SEGMENT_V1',
      coverageRole: 'SYMBOL_LIFECYCLE',
      activationId: fixture.activationId,
      segmentId: fixture.segmentId,
      detectorCutFirstIndex: 0,
      detectorCutCount: 31,
      detectorExpectedCutCount: 31,
      detectorCadenceMs: 2_000,
      missingDetectorCutCount: 0,
      maximumDetectorCutGapMs: 2_000,
      detectorCoverageComplete: true,
      lifecycleCount: 1,
      terminalLifecycleCount: 1,
      blockedLifecycleCount: 0,
      openLifecycleCount: 0,
      unresolvedContinuityGapCount: 0,
      quiescent: true,
      profitabilityClaim: false,
    },
  );
  assert.deepEqual(result.segmentFacts.acceptedProposalIds, [PROPOSAL_ID]);
  assert.deepEqual(result.segmentFacts.lifecycleProposalIds, [PROPOSAL_ID]);
  assert.equal(result.lifecycles.length, 1);
  assert.equal(result.lifecycles[0].state, 'EXACT');
  assert.equal(result.lifecycles[0].rejectionBinding, null);
  assert.equal(
    result.lifecycles[0].sourceNativeEconomics.state,
    'PUBLIC_SOURCE_FACTS_ONLY',
  );
  assert.equal(
    result.lifecycles[0].sourceNativeEconomics
      .accountEffectiveFeeBpsPerSide,
    null,
  );
  assert.equal(result.profitabilityClaim, false);
  assert.equal(result.orders, 0);
  assert.equal(result.privateOrSignedCalls, 0);
});

test('symbol terminal evidence rejects a self-consistent declared continuity gap', () => {
  const fixture = makeTerminalFixture({
    chainId: 'volume-forward-terminal-declared-continuity-gap',
  });
  const records = JSON.parse(JSON.stringify(fixture.records));
  const closeIndex = records.findIndex(
    (record) => record.header.kind === 'GENERATION_CLOSE',
  );
  const sealIndex = records.length - 1;
  rewriteRawJson(records, closeIndex, (value) => {
    value.gapDetected = true;
  });
  rewriteRawJson(records, sealIndex, (value) => {
    value.generationSummary.continuityGapCount = 1;
  });
  recomputeSelfConsistentChain(records);
  const verified = verifyVolumeForwardMeasurementEvidenceChain(
    records,
    {
      expectedPolicyDigest: fixture.expectedPolicyDigest,
      expectedTerminalHash: records.at(-1).recordHash,
      requireMeasurementBundle: false,
      requireSealed: false,
    },
  );
  assert.equal(verified.ok, false);
  assert.equal(verified.detailCode, 'TERMINAL_SEGMENT_SUMMARY_MISMATCH');
});

test('terminal segment reconciles every accepted detector proposal to its own durable terminal lifecycle and economics facts', () => {
  const fixture = makeTerminalFixture({
    chainId: 'volume-forward-terminal-multiple-proposals',
    proposalCount: 2,
  });
  const verified = verifyVolumeForwardMeasurementEvidenceChain(
    fixture.records,
    {
      expectedPolicyDigest: fixture.expectedPolicyDigest,
      expectedTerminalHash: fixture.expectedTerminalHash,
      requireMeasurementBundle: false,
      requireSealed: false,
    },
  );
  assert.equal(
    verified.ok,
    true,
    verified.ok
      ? undefined
      : `${verified.failure}:${verified.detailCode}:${verified.recordIndex}:${
          fixture.records
            .slice(
              Math.max(0, (verified.recordIndex ?? 0) - 2),
              (verified.recordIndex ?? 0) + 3,
            )
            .map((record) => (
              `${record.header.kind}@${record.header.localReceivedAtMs}`
            ))
            .join('|')
        }`,
  );
  const result = replayFixture(fixture);
  assert.equal(
    result.state,
    'EXACT',
    result.reasonCodes.join(','),
  );
  assert.deepEqual(result.reasonCodes, []);
  assert.deepEqual(
    result.segmentFacts.acceptedProposalIds,
    [
      'volume-forward-proposal-0001',
      'volume-forward-proposal-0002',
    ],
  );
  assert.deepEqual(
    result.segmentFacts.lifecycleProposalIds,
    result.segmentFacts.acceptedProposalIds,
  );
  assert.equal(result.segmentFacts.lifecycleCount, 2);
  assert.equal(result.segmentFacts.terminalLifecycleCount, 2);
  assert.equal(result.segmentFacts.blockedLifecycleCount, 0);
  assert.equal(result.lifecycles.length, 2);
  for (const lifecycle of result.lifecycles) {
    assert.equal(lifecycle.state, 'EXACT');
    assert.equal(lifecycle.rejectionBinding, null);
    assert.equal(
      lifecycle.sourceNativeEconomics.state,
      'PUBLIC_SOURCE_FACTS_ONLY',
    );
    assert.equal(lifecycle.profitabilityClaim, false);
  }
});

test('terminal accepted proposals preserve exact source-bound rejection facts for entry blockers', async (t) => {
  const cases = [
    {
      name: 'point-in-time exchange info missing',
      fixture: {
        missingFilter: true,
        blockedReasons: [
          'SOURCE_CUT_AFTER_PROPOSAL',
          'EXCHANGE_INFO_MISSING',
        ],
      },
      expectedReasons: [
        'SOURCE_CUT_AFTER_PROPOSAL',
        'EXCHANGE_INFO_MISSING',
      ],
    },
    {
      name: 'exact ten-dollar cumulative entry notional unavailable',
      fixture: {
        bookAsks: [['101.00', '2.0000']],
        blockedReason: 'EXACT_ENTRY_NOTIONAL_UNAVAILABLE',
      },
      expectedReasons: ['EXACT_ENTRY_NOTIONAL_UNAVAILABLE'],
    },
    {
      name: 'PRICE_FILTER minimum rejects the exact entry plan',
      fixture: {
        filter: { minPrice: '102.00' },
        blockedReason: 'EXCHANGE_FILTERS_INVALID',
      },
      expectedReasons: ['EXCHANGE_FILTERS_INVALID'],
    },
    {
      name: 'PRICE_FILTER maximum rejects the exact entry plan',
      fixture: {
        filter: { maxPrice: '99.99' },
        blockedReason: 'EXCHANGE_FILTERS_INVALID',
      },
      expectedReasons: ['EXCHANGE_FILTERS_INVALID'],
    },
    {
      name: 'NOTIONAL maximum rejects the exact entry plan',
      fixture: {
        filter: { maxNotional: '9.50' },
        blockedReason: 'EXCHANGE_FILTERS_INVALID',
      },
      expectedReasons: ['EXCHANGE_FILTERS_INVALID'],
    },
    {
      name: 'entry cut precedes exact retained continuity',
      fixture: {
        delayEntryContinuityUntilAfterFirstCut: true,
        blockedReasons: [
          'SOURCE_CUT_AFTER_PROPOSAL',
          'DEPTH_NOT_SYNCHRONIZED',
        ],
      },
      expectedReasons: [
        'SOURCE_CUT_AFTER_PROPOSAL',
        'DEPTH_NOT_SYNCHRONIZED',
      ],
    },
  ];
  for (const [index, scenario] of cases.entries()) {
    await t.test(scenario.name, () => {
      const fixture = makeTerminalFixture({
        chainId: `volume-forward-terminal-blocked-${index}`,
        ...scenario.fixture,
      });
      const result = replayFixture(fixture);
      assert.equal(result.state, 'BLOCKED');
      assertReasons(result, scenario.expectedReasons);
      assert.equal(result.segmentFacts.lifecycleCount, 1);
      assert.equal(result.segmentFacts.terminalLifecycleCount, 0);
      assert.equal(result.segmentFacts.blockedLifecycleCount, 1);
      assert.equal(result.segmentFacts.openLifecycleCount, 0);
      assert.equal(result.lifecycles.length, 1);
      const lifecycle = result.lifecycles[0];
      assert.equal(lifecycle.state, 'BLOCKED');
      assert.deepEqual(lifecycle.reasonCodes, scenario.expectedReasons);
      assert.equal(lifecycle.binding, null);
      assert.ok(lifecycle.rejectionBinding);
      assert.equal(
        lifecycle.rejectionBinding.disposition,
        'REJECTED_SOURCE_BOUND',
      );
      assert.equal(
        lifecycle.rejectionBinding.proposalId,
        PROPOSAL_ID,
      );
      assert.deepEqual(
        lifecycle.rejectionBinding.reasonCodes,
        scenario.expectedReasons,
      );
      assert.equal(
        lifecycle.rejectionBinding.causeRecordKind,
        'DETECTOR_COVERAGE',
      );
      assert.equal(lifecycle.rejectionBinding.executionAuthority, 'NONE');
      assert.equal(lifecycle.rejectionBinding.submitAuthority, 'NONE');
      assert.equal(lifecycle.rejectionBinding.sendEligible, false);
      assert.equal(lifecycle.rejectionBinding.sends, 0);
      assert.equal(lifecycle.rejectionBinding.sideEffects, 0);
      assert.equal(lifecycle.sourceNativeEconomics.state, 'UNKNOWN');
      assert.equal(lifecycle.profitabilityClaim, false);
      assert.equal(result.orders, 0);
      assert.equal(result.privateOrSignedCalls, 0);
      assert.equal(result.moneyUsd, 0);
    });
  }
});

test('global detector coverage accepts a gapless positive empty-universe proof without inventing a symbol or proposal', () => {
  const fixture = makeDetectorCoverageFixture();
  const verified = verifyVolumeForwardMeasurementEvidenceChain(
    fixture.records,
    {
      expectedPolicyDigest: fixture.expectedPolicyDigest,
      expectedTerminalHash: fixture.expectedTerminalHash,
      requireMeasurementBundle: false,
      requireSealed: false,
    },
  );
  assert.equal(
    verified.ok,
    true,
    verified.ok ? undefined : verified.detailCode,
  );
  const result = replayFixture(fixture);
  assert.equal(result.state, 'EXACT');
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.replayProfile, 'TERMINAL_SEGMENT');
  assert.equal(result.segmentFacts.coverageRole, 'DETECTOR_COVERAGE');
  assert.equal(result.segmentFacts.symbol, null);
  assert.equal(result.segmentFacts.detectorCutCount, 31);
  assert.equal(result.segmentFacts.detectorExpectedCutCount, 31);
  assert.equal(result.segmentFacts.detectorEvaluationUniverseCount, 0);
  assert.deepEqual(result.segmentFacts.acceptedProposals, []);
  assert.deepEqual(result.segmentFacts.lifecycleProposals, []);
  assert.equal(result.segmentFacts.lifecycleCount, 0);
  assert.equal(result.segmentFacts.quiescent, true);
  assert.deepEqual(result.lifecycles, []);
  assert.equal(result.reasonCodes.includes('NO_DETECTOR_PROPOSAL'), false);
  assert.equal(result.economics, null);
  assert.equal(result.profitabilityClaim, false);
});

test('terminal replay retains more than 600 exact diff-depth ranges through the 60-second exit cut', () => {
  const fixture = makeTerminalFixture({
    chainId: 'volume-forward-terminal-depth-601',
    denseDepthRangeCount: 599,
  });
  const result = replayFixture(fixture);
  assert.equal(result.state, 'EXACT');
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.segmentFacts.detectorCutCount, 31);
  assert.equal(result.lifecycles[0].state, 'EXACT');
  assert.ok(
    fixture.records.filter(
      (record) => record.header.kind === 'DEPTH_DIFF',
    ).length > 600,
  );
  assert.equal(
    result.reasonCodes.includes('REPLAY_OPERATION_LIMIT_EXCEEDED'),
    false,
  );
});

test('detector coverage evidence rejects late, future, equal-clock, and descriptor-only rewrites before replay', async (t) => {
  const fixture = makeDetectorCoverageFixture();
  const verifyMutation = (mutate) => {
    const records = JSON.parse(JSON.stringify(fixture.records));
    mutate(records);
    recomputeSelfConsistentChain(records);
    return verifyVolumeForwardMeasurementEvidenceChain(records, {
      expectedPolicyDigest: fixture.expectedPolicyDigest,
      expectedTerminalHash: records.at(-1).recordHash,
      requireMeasurementBundle: false,
      requireSealed: false,
    });
  };
  const rewriteCut = (records, cutIndex, mutate) => {
    const recordIndex = records
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => (
        record.header.kind === 'DETECTOR_COVERAGE'
      ))[cutIndex].index;
    const cut = decodedRawJson(records[recordIndex]);
    mutate(cut, records[recordIndex], records);
    cut.cutDigest = detectorCoverageCutDigest(cut);
    records[recordIndex].rawBase64 = jsonBytes(cut).toString('base64');
  };

  await t.test('late receipt at the cadence boundary', () => {
    const verified = verifyMutation((records) => {
      rewriteCut(records, 0, (cut, record) => {
        cut.localReceivedAtMs = cut.cutAtMs + 2_000;
        cut.localMonotonicNs = monotonicAt(cut.localReceivedAtMs);
        record.header.localReceivedAtMs = cut.localReceivedAtMs;
        record.header.localMonotonicNs = cut.localMonotonicNs;
      });
    });
    assert.equal(verified.ok, false);
    assert.equal(verified.detailCode, 'DETECTOR_COVERAGE_CUT_INVALID');
  });

  await t.test('receipt before the source cut clock', () => {
    const verified = verifyMutation((records) => {
      rewriteCut(records, 1, (cut, record) => {
        cut.localReceivedAtMs = cut.cutAtMs - 1;
        cut.localMonotonicNs = monotonicAt(cut.localReceivedAtMs);
        record.header.localReceivedAtMs = cut.localReceivedAtMs;
        record.header.localMonotonicNs = cut.localMonotonicNs;
      });
    });
    assert.equal(verified.ok, false);
    assert.equal(verified.detailCode, 'DETECTOR_COVERAGE_CUT_INVALID');
  });

  await t.test('equal monotonic receipts across distinct cuts', () => {
    const verified = verifyMutation((records) => {
      const cuts = records.filter(
        (record) => record.header.kind === 'DETECTOR_COVERAGE',
      );
      rewriteCut(records, 1, (cut, record) => {
        cut.localMonotonicNs = cuts[0].header.localMonotonicNs;
        record.header.localMonotonicNs = cut.localMonotonicNs;
      });
    });
    assert.equal(verified.ok, false);
    assert.equal(
      verified.detailCode,
      'DETECTOR_COVERAGE_SEQUENCE_INVALID',
    );
  });

  await t.test('seal cannot rewrite the derived cut count', () => {
    const verified = verifyMutation((records) => {
      rewriteRawJson(records, records.length - 1, (seal) => {
        seal.detectorCoverage.cutCount -= 1;
      });
    });
    assert.equal(verified.ok, false);
    assert.equal(
      verified.detailCode,
      'TERMINAL_SEGMENT_SUMMARY_MISMATCH',
    );
  });
});

test('a bounded REST snapshot cannot promote an unchanged unknown 101st level into exact modeled depth', () => {
  const snapshotAsks = Array.from({ length: 100 }, (_, index) => [
    `${100 + index}.00`,
    '1.0000',
  ]);
  const exposedUnknownAsk = ['200.00', '1.0000'];
  const fixture = makeFixture({
    chainId: 'snapshot-horizon-exhausted',
    bookAsks: snapshotAsks,
    entryBookTickerAskLevel: exposedUnknownAsk,
    entryBookTickerUpdateId: 101,
    initialDepthRange: { U: 98, u: 100 },
    lifecycle: 'NONE',
    postSnapshotBridgeRange: { U: 101, u: 101 },
    postSnapshotBridgeAsks: [
      ...snapshotAsks.map(([price]) => [price, '0']),
      exposedUnknownAsk,
    ],
    terminal: false,
  });
  const result = replayFixture(fixture);
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.lifecycles.length, 1);
  assert.deepEqual(result.lifecycles[0].reasonCodes, [
    'SOURCE_DEPTH_SNAPSHOT_HORIZON_EXHAUSTED',
  ]);
  assert.equal(result.lifecycles[0].binding, null);
  assert.ok(result.lifecycles[0].rejectionBinding);
  assert.equal(
    result.lifecycles[0].rejectionBinding.disposition,
    'REJECTED_SOURCE_BOUND',
  );
  assert.deepEqual(
    result.lifecycles[0].rejectionBinding.reasonCodes,
    ['SOURCE_DEPTH_SNAPSHOT_HORIZON_EXHAUSTED'],
  );
  assert.equal(result.lifecycles[0].validatorAdapterProof, null);
  assert.equal(result.lifecycles[0].profitabilityClaim, false);
});

test('Binance-valid overlapping depth ranges remain exact while a true post-bridge gap fails closed', async (t) => {
  await t.test('overlap is preserved in evidence and adapted only for legacy validation', () => {
    const fixture = makeFixture({
      chainId: 'depth-overlap-accepted',
      initialDepthRange: { U: 99, u: 102 },
      exitDepthRange: { U: 102, u: 103 },
    });
    const result = replayFixture(fixture);

    assert.equal(result.state, 'EXACT');
    assert.deepEqual(result.reasonCodes, []);
    assert.equal(result.reasonCodes.includes('OBSERVATION_REJECTED'), false);
    assert.deepEqual(
      {
        bridge: decodedRawJson(fixture.named.initialDepthDiff).data,
        next: decodedRawJson(fixture.named.exitDepthDiff).data,
      },
      {
        bridge: {
          e: 'depthUpdate',
          E: FROZEN_AT_MS + 10,
          s: SYMBOL,
          U: 99,
          u: 102,
          b: [],
          a: [],
        },
        next: {
          e: 'depthUpdate',
          E: EXIT_START_MS,
          s: SYMBOL,
          U: 102,
          u: 103,
          b: [],
          a: [],
        },
      },
    );
    assert.deepEqual(decodedRawJson(fixture.named.entryContinuity), {
      combinedFrames: [
        fixture.named.initialDepthDiffFrame.header.rawSha256.slice(7),
      ],
      generation: 1,
      previousFinalUpdateId: 100,
      firstUpdateId: 99,
      finalUpdateId: 102,
      silentGapFill: false,
      state: 'CONTIGUOUS',
    });
    assert.deepEqual(decodedRawJson(fixture.named.exitContinuity), {
      combinedFrames: [
        fixture.named.exitDepthDiffFrame.header.rawSha256.slice(7),
      ],
      generation: 1,
      previousFinalUpdateId: 102,
      firstUpdateId: 102,
      finalUpdateId: 103,
      silentGapFill: false,
      state: 'CONTIGUOUS',
    });

    const lifecycle = result.lifecycles[0];
    assert.equal(lifecycle.state, 'EXACT');
    assert.equal(lifecycle.lifecyclePhase, 'TERMINAL_EXIT');
    assert.equal(lifecycle.validatorAdapterOnly, true);
    assert.deepEqual(lifecycle.reasonCodes, []);
    sourceRefFor(
      fixture.named.entryContinuity,
      lifecycle.binding.entryEvidenceSources,
    );
    for (const record of [
      fixture.named.initialDepthDiffFrame,
      fixture.named.initialDepthDiff,
      fixture.named.exitDepthDiffFrame,
      fixture.named.exitDepthDiff,
      fixture.named.exitContinuity,
    ]) {
      sourceRefFor(record, lifecycle.binding.exitEvidenceSources);
    }
  });

  await t.test('U greater than prior u plus one is a true gap', () => {
    const fixture = makeFixture({
      chainId: 'depth-post-bridge-gap',
      initialDepthRange: { U: 99, u: 102 },
      exitDepthRange: { U: 104, u: 104 },
    });
    const result = replayFixture(fixture);

    assert.equal(result.state, 'BLOCKED');
    assertReasons(result, [
      'SOURCE_CONTINUITY_NOT_EXACT',
      'OUTCOME_CUT_MISSING',
    ]);
    assert.equal(result.profitabilityClaim, false);
    assert.equal(result.submitAuthority, false);
    assert.equal(result.casAuthority, false);
    assert.equal(result.orders, 0);
    assert.equal(result.moneyUsd, 0);
  });
});

test('same range and receipt clock bind the first applied depth frame, not a later raw duplicate', () => {
  const fixture = makeFixture({
    chainId: 'depth-range-clock-duplicate-first-wins',
    duplicatePostSnapshotBridge: true,
    initialDepthRange: { U: 98, u: 100 },
    postSnapshotBridgeRange: { U: 99, u: 102 },
  });
  const first = fixture.named.postSnapshotBridgeDepthDiff;
  const duplicate = fixture.named.duplicatePostSnapshotBridgeDepthDiff;
  assert.equal(
    first.header.localReceivedAtMs,
    duplicate.header.localReceivedAtMs,
  );
  assert.equal(
    first.header.localMonotonicNs,
    duplicate.header.localMonotonicNs,
  );
  assert.deepEqual(
    {
      U: decodedRawJson(first).data.U,
      u: decodedRawJson(first).data.u,
    },
    {
      U: decodedRawJson(duplicate).data.U,
      u: decodedRawJson(duplicate).data.u,
    },
  );
  assert.notEqual(first.header.rawSha256, duplicate.header.rawSha256);
  assert.deepEqual(
    decodedRawJson(fixture.named.entryContinuity).combinedFrames,
    [fixture.named.postSnapshotBridgeDepthDiffFrame.header.rawSha256.slice(7)],
  );

  const result = replayFixture(fixture);
  assert.equal(result.state, 'EXACT');
  assert.deepEqual(result.reasonCodes, []);
  const entrySources = result.lifecycles[0].binding.entryEvidenceSources;
  sourceRefFor(fixture.named.postSnapshotBridgeDepthDiffFrame, entrySources);
  sourceRefFor(first, entrySources);
  assert.equal(
    entrySources.some((reference) => reference.recordHash === duplicate.recordHash),
    false,
  );
});

test('duplicate trade IDs dedupe identical cuts but permanently poison conflicting constituent data', async (t) => {
  await t.test('semantically identical duplicate remains exact', () => {
    const fixture = makeFixture({
      chainId: 'trade-id-identical-duplicate',
      duplicateEntryTrade: 'IDENTICAL',
    });
    assert.equal(
      fixture.named.entryTrade.header.rawSha256,
      fixture.named.duplicateEntryTrade.header.rawSha256,
    );
    assert.notEqual(
      fixture.named.entryTrade.recordHash,
      fixture.named.duplicateEntryTrade.recordHash,
    );

    const result = replayFixture(fixture);
    assert.equal(result.state, 'EXACT');
    assert.deepEqual(result.reasonCodes, []);
  });

  await t.test('conflicting price quantity and maker side fail constituent proof', () => {
    const fixture = makeFixture({
      chainId: 'trade-id-conflicting-duplicate',
      duplicateEntryTrade: 'CONFLICTING',
    });
    const first = decodedRawJson(fixture.named.entryTrade).data;
    const conflict = decodedRawJson(fixture.named.duplicateEntryTrade).data;
    assert.equal(first.t, conflict.t);
    assert.notEqual(first.p, conflict.p);
    assert.notEqual(first.q, conflict.q);
    assert.notEqual(first.m, conflict.m);

    const result = replayFixture(fixture);
    assert.equal(result.state, 'BLOCKED');
    assertReasons(result, ['TRADE_EVIDENCE_MISSING']);
    assert.equal(result.profitabilityClaim, false);
    assert.equal(result.submitAuthority, false);
    assert.equal(result.casAuthority, false);
    assert.equal(result.orders, 0);
    assert.equal(result.moneyUsd, 0);
  });
});

test('bookTicker older than the depth snapshot cannot substitute coincident top-of-book values', () => {
  const fixture = makeFixture({
    chainId: 'book-ticker-before-snapshot-hostile',
    entryBookTickerUpdateId: 99,
  });
  const ticker = decodedRawJson(fixture.named.entryBookTicker).data;
  const snapshot = decodedRawJson(fixture.named.depthSnapshot);
  assert.equal(ticker.u < snapshot.lastUpdateId, true);
  assert.deepEqual(
    [ticker.b, ticker.B, ticker.a, ticker.A],
    [
      snapshot.bids[0][0],
      snapshot.bids[0][1],
      snapshot.asks[0][0],
      snapshot.asks[0][1],
    ],
  );

  const result = replayFixture(fixture);
  assert.equal(result.state, 'BLOCKED');
  assertReasons(result, ['BOOK_TICKER_DEPTH_MISMATCH']);
  assert.equal(result.profitabilityClaim, false);
  assert.equal(result.submitAuthority, false);
  assert.equal(result.casAuthority, false);
  assert.equal(result.orders, 0);
  assert.equal(result.moneyUsd, 0);
});

test('raw stream-frame capture pairs fail closed on orphaning, nesting, and every typed-frame mismatch', async (t) => {
  const fixture = makeFixture({
    chainId: 'raw-stream-frame-hostile',
  });
  const frameIndex = fixture.named.initialDepthDiffFrame.header.sequence;
  const typedIndex = fixture.named.initialDepthDiff.header.sequence;
  const cases = [
    {
      name: 'typed record without preceding frame',
      mutate: (records) => records.splice(frameIndex, 1),
    },
    {
      name: 'orphan frame without typed record',
      mutate: (records) => records.splice(typedIndex, 1),
    },
    {
      name: 'nested frames',
      mutate: (records) => {
        records.splice(typedIndex, 0, structuredClone(records[frameIndex]));
      },
    },
    {
      name: 'intervening non-stream record',
      mutate: (records) => {
        [records[typedIndex], records[typedIndex + 1]] = [
          records[typedIndex + 1],
          records[typedIndex],
        ];
      },
    },
    {
      name: 'outer bytes mismatch',
      mutate: (records) => {
        const envelope = decodedRawJson(records[typedIndex]);
        envelope.data.u += 1;
        records[typedIndex].rawBase64 = jsonBytes(envelope).toString('base64');
      },
    },
    {
      name: 'combined envelope stripped',
      mutate: (records) => {
        const payload = decodedRawJson(records[frameIndex]).data;
        const rawBase64 = jsonBytes(payload).toString('base64');
        records[frameIndex].rawBase64 = rawBase64;
        records[typedIndex].rawBase64 = rawBase64;
      },
    },
    {
      name: 'combined stream mismatch',
      mutate: (records) => {
        const envelope = decodedRawJson(records[frameIndex]);
        envelope.stream = TRADE_STREAM;
        const rawBase64 = jsonBytes(envelope).toString('base64');
        records[frameIndex].rawBase64 = rawBase64;
        records[typedIndex].rawBase64 = rawBase64;
      },
    },
    {
      name: 'received-at clock mismatch',
      mutate: (records) => {
        records[typedIndex].header.localReceivedAtMs += 1;
      },
    },
    {
      name: 'monotonic clock mismatch',
      mutate: (records) => {
        records[typedIndex].header.localMonotonicNs = String(
          BigInt(records[typedIndex].header.localMonotonicNs) + 1n,
        );
      },
    },
    {
      name: 'generation mismatch',
      mutate: (records) => {
        records[typedIndex].header.generation += 1;
      },
    },
    {
      name: 'symbol mismatch',
      mutate: (records) => {
        records[typedIndex].header.sourceSymbol = 'ETHUSDT';
      },
    },
    {
      name: 'endpoint mismatch',
      mutate: (records) => {
        records[typedIndex].header.sourceEndpoint =
          'wss://stream.binance.com:9443';
      },
    },
    {
      name: 'typed source-stream mismatch',
      mutate: (records) => {
        records[typedIndex].header.sourceStream = TRADE_STREAM;
      },
    },
    {
      name: 'frame source-stream is not null',
      mutate: (records) => {
        records[frameIndex].header.sourceStream = DEPTH_STREAM;
      },
    },
    {
      name: 'transport mismatch',
      mutate: (records) => {
        records[typedIndex].header.sourceTransport =
          'BINANCE_SPOT_PUBLIC_REST';
      },
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const result = replaySelfConsistentMutation(
        fixture,
        scenario.mutate,
      );
      assertSourceProtocolRejected(result);
      assert.equal(result.profitabilityClaim, false);
      assert.equal(result.submitAuthority, false);
      assert.equal(result.casAuthority, false);
      assert.equal(result.orders, 0);
      assert.equal(result.moneyUsd, 0);
    });
  }

  await t.test('raw hash mismatch', () => {
    const records = JSON.parse(JSON.stringify(fixture.records));
    records[typedIndex].header.rawSha256 = `sha256:${'f'.repeat(64)}`;
    const result = replayVolumeForwardMeasurementEvidence({
      evidenceRecords: records,
      expectedPolicyDigest: fixture.expectedPolicyDigest,
      expectedTerminalHash: fixture.expectedTerminalHash,
    });
    assertSourceProtocolRejected(result);
  });
});

test('replay is network-free and reproduces byte-identical records and IDs', () => {
  const firstFixture = makeFixture({ chainId: 'deterministic-replay' });
  const secondFixture = makeFixture({ chainId: 'deterministic-replay' });
  assert.deepEqual(secondFixture.records, firstFixture.records);

  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  let networkCalls = 0;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async () => {
      networkCalls += 1;
      throw new Error('network forbidden in deterministic replay');
    },
  });
  let first;
  let second;
  try {
    first = replayFixture(firstFixture);
    second = replayFixture(secondFixture);
  } finally {
    if (originalFetch === undefined) {
      delete globalThis.fetch;
    } else {
      Object.defineProperty(globalThis, 'fetch', originalFetch);
    }
  }

  assert.equal(networkCalls, 0);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
  assert.equal(second.replayId, first.replayId);
  assert.equal(second.lifecycles[0].lifecycleId, first.lifecycles[0].lifecycleId);
  assert.equal(
    second.lifecycles[0].validatorAdapterProof.entryEvaluationId,
    first.lifecycles[0].validatorAdapterProof.entryEvaluationId,
  );
  assert.equal(
    second.lifecycles[0].validatorAdapterProof.exitDecisionId,
    first.lifecycles[0].validatorAdapterProof.exitDecisionId,
  );
});

test('strict trusted anchors reject missing, wrong, and self-consistently recomputed evidence', () => {
  const fixture = makeFixture({ chainId: 'strict-anchor-replay' });
  const missing = replayVolumeForwardMeasurementEvidence({
    evidenceRecords: fixture.records,
  });
  assert.deepEqual(missing.reasonCodes, ['REPLAY_INPUT_INVALID']);
  assert.equal(missing.sourceAuthenticity, null);

  for (const input of [
    {
      ...fixture.input,
      expectedPolicyDigest: `sha256:${'f'.repeat(64)}`,
    },
    {
      ...fixture.input,
      expectedTerminalHash: `sha256:${'e'.repeat(64)}`,
    },
  ]) {
    const wrong = replayVolumeForwardMeasurementEvidence(input);
    assert.deepEqual(wrong.reasonCodes, ['EVIDENCE_CHAIN_INVALID']);
    assert.equal(wrong.sourceAuthenticity, null);
  }

  const recomputed = JSON.parse(JSON.stringify(fixture.records));
  const seal = recomputed.at(-1);
  seal.rawBase64 = jsonBytes({
    reason: 'SELF_CONSISTENT_BUT_NOT_TRUSTED',
  }).toString('base64');
  recomputeSelfConsistentChain(recomputed);
  const tampered = replayVolumeForwardMeasurementEvidence({
    evidenceRecords: recomputed,
    expectedPolicyDigest: fixture.expectedPolicyDigest,
    expectedTerminalHash: fixture.expectedTerminalHash,
  });
  assert.deepEqual(tampered.reasonCodes, ['EVIDENCE_CHAIN_INVALID']);
  assert.equal(tampered.sourceAuthenticity, null);
});

test('normal terminal capture close propagates missing outcome and premature lifecycle mismatch to the top level', () => {
  const fixture = makeFixture({
    chainId: 'missing-outcome',
    lifecycle: 'PREMATURE_TERMINAL',
    terminal: false,
  });
  const result = replayFixture(fixture);
  assert.equal(result.state, 'BLOCKED');
  assertReasons(result, [
    'OUTCOME_CUT_MISSING',
    'RECORDED_LIFECYCLE_MISMATCH',
  ]);
  assert.equal(result.lifecycles.length, 1);
  assert.equal(result.lifecycles[0].state, 'BLOCKED');
  assertReasons(result.lifecycles[0], ['OUTCOME_CUT_MISSING']);
  assert.ok(result.lifecycles[0].binding);
  assert.ok(result.lifecycles[0].validatorAdapterProof);
  assert.ok(
    result.lifecycles[0].validatorAdapterProof.exitDecisionId?.length > 0,
  );
  assert.equal(result.lifecycles[0].validatorAdapterProof.exitPlanId, null);
  assert.equal(result.lifecycles[0].terminalSampleId, null);
  assert.equal(result.profitabilityClaim, false);
});

test('durable BLOCKED lifecycle records must be present and exactly match the replay-derived cause and source cut', async (t) => {
  const cases = [
    {
      name: 'exact blocked lifecycle',
      lifecycle: 'BLOCKED_EXACT',
      recordedMismatch: false,
    },
    {
      name: 'missing blocked lifecycle',
      lifecycle: 'NONE',
      recordedMismatch: true,
    },
    {
      name: 'wrong blocked reason',
      lifecycle: 'BLOCKED_WRONG',
      recordedMismatch: true,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const fixture = makeFixture({
        chainId: `durable-${scenario.lifecycle.toLowerCase()}`,
        lifecycle: scenario.lifecycle,
        terminal: false,
      });
      const result = replayFixture(fixture);
      assert.equal(result.state, 'BLOCKED');
      assertReasons(result, ['OUTCOME_CUT_MISSING']);
      assert.equal(
        result.reasonCodes.includes('RECORDED_LIFECYCLE_MISMATCH'),
        scenario.recordedMismatch,
      );
      assert.equal(result.lifecycles.length, 1);
      assert.equal(result.lifecycles[0].state, 'BLOCKED');
      assert.deepEqual(
        result.lifecycles[0].reasonCodes,
        ['OUTCOME_CUT_MISSING'],
      );
      assert.equal(result.profitabilityClaim, false);
      assert.equal(result.orders, 0);
      assert.equal(result.moneyUsd, 0);
    });
  }
});

test('exact cumulative per-level quote notional accepts $10.00 and rejects a filter-valid step-floor underfill', async (t) => {
  await t.test('two levels sum exactly to $10.00', () => {
    const fixture = makeFixture({
      bookAsks: [
        ['100.00', '0.0500'],
        ['125.00', '0.0400'],
      ],
      chainId: 'cumulative-notional-exact',
    });
    const result = replayFixture(fixture);
    assert.equal(result.state, 'EXACT');
    assert.deepEqual(result.reasonCodes, []);
    assert.equal(result.lifecycles[0].state, 'EXACT');
    assert.deepEqual(
      {
        baseQuantity:
          result.lifecycles[0].validatorAdapterProof
            .entryModeledBaseQuantity,
        limitPrice:
          result.lifecycles[0].validatorAdapterProof
            .entryModeledLimitPrice,
        quoteNotional:
          result.lifecycles[0].validatorAdapterProof
            .entryModeledQuoteNotional,
        sourceEntryQuote:
          result.lifecycles[0].sourceNativeEconomics
            .entryQuoteNotional,
      },
      {
        baseQuantity: '0.09',
        limitPrice: '125',
        quoteNotional: '10',
        sourceEntryQuote: '10',
      },
    );
    assert.equal(result.lifecycles[0].profitabilityClaim, false);
  });

  await t.test('step floor leaves 9.999 and cannot be rewritten as $10.00', () => {
    const fixture = makeFixture({
      bookAsks: [['101.00', '2.000']],
      bookBids: [['100.00', '1.000']],
      chainId: 'cumulative-notional-underfill',
      lifecycle: 'NONE',
      terminal: false,
    });
    const result = replayFixture(fixture);
    assert.equal(result.state, 'BLOCKED');
    assertReasons(result, ['EXACT_ENTRY_NOTIONAL_UNAVAILABLE']);
    assert.equal(result.lifecycles[0].state, 'BLOCKED');
    assertReasons(
      result.lifecycles[0],
      ['EXACT_ENTRY_NOTIONAL_UNAVAILABLE'],
    );
    assert.equal(result.economics, null);
    assert.equal(result.profitabilityClaim, false);
    assert.equal(result.orders, 0);
    assert.equal(result.moneyUsd, 0);
  });
});

test('point-in-time configuration and kill cuts require the exact frozen default-off policy packet', async (t) => {
  const fixture = makeFixture({
    chainId: 'point-in-time-control-hostile',
  });
  const configIndex = fixture.named.config.header.sequence;
  const killIndex = fixture.named.kill.header.sequence;
  const configCases = [
    ['missing required field', (value) => delete value.recordOnly],
    ['extra field', (value) => { value.observedAtMs = FROZEN_AT_MS + 12; }],
    ['symbol mismatch', (value) => { value.symbol = 'ETHUSDT'; }],
    ['combined endpoint mismatch', (value) => {
      value.combinedUrl = value.combinedUrl.replace(
        'data-stream.binance.vision',
        'stream.binance.com:9443',
      );
    }],
    ['combined stream-set mismatch', (value) => {
      value.combinedUrl =
        `wss://data-stream.binance.vision/stream?streams=${REQUIRED_STREAMS.slice(1).join('/')}`;
    }],
    ['timestamp unit mismatch', (value) => {
      value.timestampUnit = 'MICROSECOND';
    }],
    ['depth limit mismatch', (value) => { value.depthLimit = 1_000; }],
    ['proposal admission close mismatch', (value) => {
      value.proposalAdmissionClosesAtMs += 1;
    }],
    ['evidence close mismatch', (value) => {
      value.evidenceClosesAtMs -= 1;
    }],
    ['mode mismatch', (value) => { value.mode = 'SHADOW_RECORD_ONLY'; }],
    ['record-only disabled', (value) => { value.recordOnly = false; }],
    ['default-on', (value) => { value.enabled = true; }],
    ['kill switch not engaged', (value) => {
      value.killSwitchEngaged = false;
    }],
    ['stream mechanism mismatch', (value) => {
      value.streamMechanism = 'RAW_STREAMS';
    }],
    ['policy id mismatch', (value) => {
      value.measurementPolicyId = 'volume-forward-policy-wrong';
    }],
    ['policy hash mismatch', (value) => {
      value.measurementPolicySha256 = 'f'.repeat(64);
    }],
    ['frozen rule mismatch', (value) => {
      value.frozenMeasurementRules.maximumHoldMs += 1;
    }],
    ['profitability claim enabled', (value) => {
      value.profitabilityClaim = 'ALLOWED';
    }],
  ];
  for (const [name, mutate] of configCases) {
    await t.test(`config: ${name}`, () => {
      const result = replaySelfConsistentMutation(fixture, (records) => {
        rewriteRawJson(records, configIndex, mutate);
      });
      assert.equal(result.state, 'BLOCKED');
      assertReasons(result, ['CONFIG_STATE_MISMATCH']);
      assert.equal(result.profitabilityClaim, false);
      assert.equal(result.submitAuthority, false);
      assert.equal(result.casAuthority, false);
      assert.equal(result.privateOrSignedCalls, 0);
    });
  }

  const killCases = [
    ['missing engaged field', (value) => delete value.engaged],
    ['extra field', (value) => { value.observedAtMs = FROZEN_AT_MS + 13; }],
    ['not engaged', (value) => { value.engaged = false; }],
    ['submit authority', (value) => { value.submitAuthority = true; }],
    ['CAS authority', (value) => { value.casAuthority = true; }],
    ['private or signed authority', (value) => {
      value.privateOrSignedAuthority = true;
    }],
  ];
  for (const [name, mutate] of killCases) {
    await t.test(`kill: ${name}`, () => {
      const result = replaySelfConsistentMutation(fixture, (records) => {
        rewriteRawJson(records, killIndex, mutate);
      });
      assert.equal(result.state, 'BLOCKED');
      assertReasons(result, ['KILL_STATE_NOT_ENGAGED']);
      assert.equal(result.profitabilityClaim, false);
      assert.equal(result.submitAuthority, false);
      assert.equal(result.casAuthority, false);
      assert.equal(result.privateOrSignedCalls, 0);
    });
  }
});

test('generation-open ledger requires the exact combined-stream INITIAL contract', async (t) => {
  const fixture = makeFixture({
    chainId: 'generation-open-hostile',
  });
  const openIndex = fixture.named.generationOpen.header.sequence;
  const cases = [
    ['missing field', (value) => delete value.timestampUnit],
    ['extra field', (value) => { value.openedAtMs = FROZEN_AT_MS + 1; }],
    ['INITIAL versus RECONNECT mismatch', (value) => {
      value.reason = 'RECONNECT';
    }],
    ['combined endpoint mismatch', (value) => {
      value.combinedUrl = value.combinedUrl.replace(
        'data-stream.binance.vision',
        'stream.binance.com:9443',
      );
    }],
    ['combined stream set mismatch', (value) => {
      value.combinedUrl =
        `wss://data-stream.binance.vision/stream?streams=${REQUIRED_STREAMS.slice(0, -1).join('/')}`;
    }],
    ['ordered stream list mismatch', (value) => {
      value.streams = [...value.streams].reverse();
    }],
    ['timestamp unit mismatch', (value) => {
      value.timestampUnit = 'MICROSECOND';
    }],
    ['stream mechanism mismatch', (value) => {
      value.streamMechanism = 'RAW_STREAMS';
    }],
    ['payload generation mismatch', (value) => { value.generation = 2; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const result = replaySelfConsistentMutation(fixture, (records) => {
        rewriteRawJson(records, openIndex, mutate);
      });
      assertSourceProtocolRejected(result);
      assert.equal(result.profitabilityClaim, false);
      assert.equal(result.submitAuthority, false);
      assert.equal(result.casAuthority, false);
      assert.equal(result.orders, 0);
      assert.equal(result.moneyUsd, 0);
    });
  }
});

test('generation-close ledger rejects every stale capture count, frame identity, clock, inner-byte, and terminal claim', async (t) => {
  const fixture = makeFixture({
    chainId: 'generation-close-hostile',
  });
  const closeIndex = fixture.named.generationClose.header.sequence;
  const close = decodedRawJson(fixture.named.generationClose);
  assert.deepEqual(close.streamCounts, {
    depth100ms: 2,
    aggTrade: 2,
    trade: 2,
    bookTicker: 2,
  });
  assert.equal(close.streamFrameCount, 8);
  assert.equal(close.combinedFrameLedger.length, 8);
  assert.equal(close.captureTruncated, false);
  assert.equal(close.depthSnapshotCaptured, true);
  assert.equal(close.depthBridgeExact, true);
  assert.equal(close.continuity, 'CONTIGUOUS');
  assert.equal(close.invalidFrame, false);
  assert.equal(close.lifecycleAssertionsCaptured, true);
  assert.equal(
    close.detectorProposalRecordHash,
    fixture.named.proposal.recordHash,
  );

  const cases = [
    ['missing field', (value) => delete value.streamFrameCount],
    ['extra field', (value) => { value.closedAtMs = EXIT_START_MS + 6; }],
    ['capture truncated', (value) => { value.captureTruncated = true; }],
    ['close code out of range', (value) => { value.closeCode = 5_000; }],
    ['reason invalid', (value) => { value.reason = ''; }],
    ['not opened', (value) => { value.opened = false; }],
    ['combined URL mismatch', (value) => {
      value.combinedUrl = value.combinedUrl.replace(
        'data-stream.binance.vision',
        'stream.binance.com:9443',
      );
    }],
    ['combined URL not acknowledged', (value) => {
      value.combinedUrlAcknowledged = false;
    }],
    ['continuity mismatch', (value) => {
      value.continuity = 'REJECTED_NO_SILENT_FILL';
    }],
    ['snapshot claim mismatch', (value) => {
      value.depthSnapshotCaptured = false;
    }],
    ['bridge claim mismatch', (value) => {
      value.depthBridgeExact = false;
    }],
    ['gap claim mismatch', (value) => { value.gapDetected = true; }],
    ['invalid-frame claim mismatch', (value) => {
      value.invalidFrame = true;
    }],
    ['proposal record hash mismatch', (value) => {
      value.detectorProposalRecordHash = `sha256:${'f'.repeat(64)}`;
    }],
    ['lifecycle assertion claim mismatch', (value) => {
      value.lifecycleAssertionsCaptured = false;
    }],
    ['generation mismatch', (value) => { value.generation = 2; }],
    ['stream-frame count mismatch', (value) => {
      value.streamFrameCount += 1;
    }],
    ['depth stream count mismatch', (value) => {
      value.streamCounts.depth100ms += 1;
    }],
    ['stream counts extra key', (value) => {
      value.streamCounts.total = value.streamFrameCount;
    }],
    ['ledger row missing', (value) => {
      value.combinedFrameLedger.pop();
    }],
    ['outer raw hash mismatch', (value) => {
      value.combinedFrameLedger[0].rawSha256 = 'f'.repeat(64);
    }],
    ['frame record hash mismatch', (value) => {
      value.combinedFrameLedger[0].frameRecordHash =
        `sha256:${'f'.repeat(64)}`;
    }],
    ['typed raw hash mismatch', (value) => {
      value.combinedFrameLedger[0].evidenceRawSha256 =
        `sha256:${'f'.repeat(64)}`;
    }],
    ['typed record hash mismatch', (value) => {
      value.combinedFrameLedger[0].evidenceRecordHash =
        `sha256:${'f'.repeat(64)}`;
    }],
    ['received-at clock mismatch', (value) => {
      value.combinedFrameLedger[0].localReceivedAtMs += 1;
    }],
    ['monotonic clock mismatch', (value) => {
      value.combinedFrameLedger[0].localMonotonicNs = String(
        BigInt(value.combinedFrameLedger[0].localMonotonicNs) + 1n,
      );
    }],
    ['inner offset mismatch', (value) => {
      value.combinedFrameLedger[0].innerOffset += 1;
    }],
    ['inner length mismatch', (value) => {
      value.combinedFrameLedger[0].innerLength += 1;
    }],
    ['inner hash mismatch', (value) => {
      value.combinedFrameLedger[0].innerSha256 = 'f'.repeat(64);
    }],
    ['depth first update mismatch', (value) => {
      value.combinedFrameLedger[0].firstUpdateId += 1;
    }],
    ['depth final update mismatch', (value) => {
      value.combinedFrameLedger[0].finalUpdateId += 1;
    }],
    ['ledger stream mismatch', (value) => {
      value.combinedFrameLedger[0].stream = TRADE_STREAM;
    }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const result = replaySelfConsistentMutation(fixture, (records) => {
        rewriteRawJson(records, closeIndex, mutate);
      });
      assertSourceProtocolRejected(result);
      assert.equal(result.profitabilityClaim, false);
      assert.equal(result.submitAuthority, false);
      assert.equal(result.casAuthority, false);
      assert.equal(result.orders, 0);
      assert.equal(result.moneyUsd, 0);
    });
  }
});

test('continuity records bind the exact applied depth-frame set and forbid silent gap fill', async (t) => {
  const fixture = makeFixture({
    chainId: 'continuity-ledger-hostile',
  });
  const continuityIndex = fixture.named.entryContinuity.header.sequence;
  const cases = [
    ['missing field', (value) => delete value.combinedFrames],
    ['extra field', (value) => { value.rangeCount = 1; }],
    ['combined frame hash mismatch', (value) => {
      value.combinedFrames[0] = 'f'.repeat(64);
    }],
    ['combined frame omitted', (value) => {
      value.combinedFrames = [];
    }],
    ['silent gap fill', (value) => { value.silentGapFill = true; }],
    ['previous update mismatch', (value) => {
      value.previousFinalUpdateId -= 1;
    }],
    ['first update mismatch', (value) => { value.firstUpdateId += 1; }],
    ['final update mismatch', (value) => { value.finalUpdateId += 1; }],
    ['generation mismatch', (value) => { value.generation = 2; }],
    ['state mismatch', (value) => { value.state = 'GAP'; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const result = replaySelfConsistentMutation(fixture, (records) => {
        rewriteRawJson(records, continuityIndex, mutate);
      });
      assert.equal(result.state, 'BLOCKED');
      assertReasons(result, ['SOURCE_CONTINUITY_NOT_EXACT']);
      assert.equal(result.profitabilityClaim, false);
      assert.equal(result.submitAuthority, false);
      assert.equal(result.casAuthority, false);
      assert.equal(result.orders, 0);
      assert.equal(result.moneyUsd, 0);
    });
  }
});

test('pseudo proposals, continuity failures, and absent source/control cuts fail closed', async (t) => {
  const cases = [
    {
      name: 'pseudo proposal',
      fixture: { pseudoProposal: true },
      reasons: [
        'DETECTOR_PSEUDO_PROPOSAL_EXCLUDED',
        'NO_DETECTOR_PROPOSAL',
      ],
    },
    {
      name: 'gap',
      fixture: { bridge: 'GAP' },
      reasons: ['SOURCE_CONTINUITY_NOT_EXACT', 'DEPTH_NOT_SYNCHRONIZED'],
    },
    {
      name: 'snapshot without retained diff bridge',
      fixture: { bridge: 'SNAPSHOT_ONLY' },
      reasons: ['SOURCE_CONTINUITY_NOT_EXACT', 'DEPTH_NOT_SYNCHRONIZED'],
      forbiddenReasons: ['SOURCE_PAYLOAD_INVALID'],
    },
    {
      name: 'missing exact trade span',
      fixture: { missingTrade: true },
      reasons: ['TRADE_EVIDENCE_MISSING'],
    },
    {
      name: 'missing book ticker',
      fixture: { missingBook: true },
      reasons: ['BOOK_TICKER_EVIDENCE_MISSING'],
    },
    {
      name: 'missing exchange filters',
      fixture: { missingFilter: true },
      reasons: [
        'EXCHANGE_FILTERS_INVALID',
        'DETECTOR_PROPOSAL_INVALID',
        'NO_DETECTOR_PROPOSAL',
      ],
    },
    {
      name: 'missing valid config cut',
      fixture: { missingConfig: true },
      reasons: [
        'CONFIG_STATE_MISMATCH',
        'DETECTOR_PROPOSAL_INVALID',
        'NO_DETECTOR_PROPOSAL',
      ],
    },
    {
      name: 'missing engaged kill cut',
      fixture: { missingKill: true },
      reasons: [
        'KILL_STATE_NOT_ENGAGED',
        'DETECTOR_PROPOSAL_INVALID',
        'NO_DETECTOR_PROPOSAL',
      ],
    },
  ];
  for (const [index, scenario] of cases.entries()) {
    await t.test(scenario.name, () => {
      const fixture = makeFixture({
        chainId: `fail-closed-${index}`,
        lifecycle: 'NONE',
        terminal: false,
        ...scenario.fixture,
      });
      const result = replayFixture(fixture);
      assert.equal(result.state, 'BLOCKED');
      assertReasons(result, scenario.reasons);
      for (const reason of scenario.forbiddenReasons ?? []) {
        assert.equal(
          result.reasonCodes.includes(reason),
          false,
          `did not expect ${reason}; found ${result.reasonCodes.join(',')}`,
        );
      }
      assert.equal(result.economics, null);
      assert.equal(result.profitabilityClaim, false);
      assert.equal(result.submitAuthority, false);
      assert.equal(result.casAuthority, false);
      assert.equal(result.privateOrSignedCalls, 0);
      assert.equal(result.orders, 0);
      assert.equal(result.moneyUsd, 0);
    });
  }
});

test('proposal cut-time, filter economics, stale book, and ordered lifecycle claims cannot be rewritten green', async (t) => {
  const cases = [
    {
      name: 'delayed proposal cannot consume later public cuts',
      fixture: { delayedProposal: true, terminal: false },
      reasons: ['SOURCE_CUT_AFTER_PROPOSAL'],
    },
    {
      name: 'PRICE_FILTER minimum',
      fixture: { filter: { minPrice: '102.00' }, terminal: false },
      reasons: ['EXCHANGE_FILTERS_INVALID'],
    },
    {
      name: 'PRICE_FILTER maximum',
      fixture: { filter: { maxPrice: '99.99' }, terminal: false },
      reasons: ['EXCHANGE_FILTERS_INVALID'],
    },
    {
      name: 'NOTIONAL maximum',
      fixture: { filter: { maxNotional: '9.50' }, terminal: false },
      reasons: ['EXCHANGE_FILTERS_INVALID'],
    },
    {
      name: 'stale bookTicker at terminal cut',
      fixture: {
        lifecycle: 'NONE',
        staleBookAtExit: true,
        terminal: true,
      },
      reasons: ['BOOK_TICKER_STALE'],
    },
    {
      name: 'reordered lifecycle assertions',
      fixture: { lifecycle: 'REORDERED', terminal: true },
      reasons: ['RECORDED_LIFECYCLE_MISMATCH'],
    },
  ];
  for (const [index, scenario] of cases.entries()) {
    await t.test(scenario.name, () => {
      const fixture = makeFixture({
        chainId: `hostile-replay-${index}`,
        lifecycle: 'NONE',
        ...scenario.fixture,
      });
      const result = replayFixture(fixture);
      assert.equal(result.state, 'BLOCKED');
      assertReasons(result, scenario.reasons);
    });
  }
});

test('depth retention crosses 20k stale records with deterministic exact replay and indexed bounded lookup', () => {
  const fixture = makeFixture({
    chainId: 'depth-retention-ring-over-cap',
    initialDepthRange: { U: 98, u: 100 },
    postSnapshotBridgeRange: { U: 99, u: 102 },
    postSnapshotStaleDepthDiffCount: 20_001,
  });
  const depthRecordCount = fixture.records.filter(
    (record) => record.header.kind === 'DEPTH_DIFF',
  ).length;
  assert.ok(depthRecordCount > 20_000);
  assert.ok(
    fixture.records.length
      < VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRecordCount,
  );

  const first = replayFixture(fixture);
  const second = replayFixture(fixture);
  assert.equal(first.state, 'EXACT');
  assert.deepEqual(first.reasonCodes, []);
  assert.equal(
    first.reasonCodes.includes('REPLAY_OPERATION_LIMIT_EXCEEDED'),
    false,
  );
  assert.equal(
    first.reasonCodes.includes('SOURCE_CONTINUITY_NOT_EXACT'),
    false,
  );
  assert.equal(first.replayId, second.replayId);
  assert.deepEqual(first.reasonCodes, second.reasonCodes);
  assert.equal(
    first.lifecycles[0].terminalSampleId,
    second.lifecycles[0].terminalSampleId,
  );
  sourceRefFor(
    fixture.named.postSnapshotBridgeDepthDiff,
    first.lifecycles[0].binding.entryEvidenceSources,
  );

  const replaySource = readFileSync(
    new URL(
      '../src/engine/volume/forwardMeasurementReplay.ts',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(replaySource, /depthDiffRangeRing/);
  assert.match(replaySource, /depthDiffRecordByRange\.get/);
  assert.doesNotMatch(replaySource, /depthDiffRecords\.(?:find|shift)/);
});

test('oversized evidence input is rejected at the declared record-count boundary', () => {
  const fixture = makeFixture({ chainId: 'bounded-input' });
  const oversized = new Array(
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRecordCount + 1,
  ).fill(fixture.records[0]);
  const result = replayVolumeForwardMeasurementEvidence({
    evidenceRecords: oversized,
    expectedPolicyDigest: fixture.expectedPolicyDigest,
    expectedTerminalHash: fixture.expectedTerminalHash,
  });
  assert.equal(result.state, 'BLOCKED');
  assert.deepEqual(result.reasonCodes, ['EVIDENCE_CHAIN_INVALID']);
  assert.equal(result.evidenceRecordCount, 0);
  assert.deepEqual(result.lifecycles, []);
});

test('bounded replay operation budget rejects many maximum-span proposal proofs with a named cap reason', () => {
  const fixture = makeFixture({
    aggregateTradeSpan: 20_000,
    chainId: 'bounded-operation-budget',
    lifecycle: 'NONE',
    missingTrade: true,
    proposalCount: 251,
    terminal: false,
  });
  assert.ok(
    fixture.records.length
      < VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRecordCount,
  );
  const result = replayFixture(fixture);
  assert.equal(result.state, 'BLOCKED');
  assertReasons(result, ['REPLAY_OPERATION_LIMIT_EXCEEDED']);
  assert.equal(result.evidenceRecordCount, fixture.records.length);
  assert.equal(result.economics, null);
  assert.equal(result.profitabilityClaim, false);
  assert.equal(result.submitAuthority, false);
  assert.equal(result.casAuthority, false);
  assert.equal(result.orders, 0);
  assert.equal(result.moneyUsd, 0);
});

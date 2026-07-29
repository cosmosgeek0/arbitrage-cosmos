import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createCoreEvidenceWriter,
  loadCoreEvidenceModule,
  loadCoreMeasurementModule,
  parseCoreEvidenceFile,
} from './evidence-chain.mjs';
import {
  FROZEN_PACKET_RULES,
  parseReplayArgs,
  replayEvidence,
  verifyPacketPolicyBinding,
} from './replay.mjs';
import {
  buildCombinedWebSocketUrl,
  aggregateTradeProofExact,
  classifySmokeMechanics,
  parseSmokeArgs,
  runPublicSmoke,
  shouldContinueSmokeCapture,
  smokeProposalPrerequisitesExact,
  unwrapCombinedStreamPayload,
  validateSmokeOptions,
} from './smoke-capture.mjs';
import {
  buildAcceptedProposalUniverseSha256,
  buildDurableId,
  buildEvidenceSegmentInventorySha256,
  durableArtifactSha256,
  validateActivationInstance,
  validateOutcomeOpenReceiptInstance,
  validateTerminalManifestInstance,
  verifyPacket,
} from './verify.mjs';

const PACKET_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(PACKET_DIR, '../../..');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return JSON.stringify(value);
  if (typeof value === 'number') {
    assert.ok(Number.isSafeInteger(value) && !Object.is(value, -0));
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(',')}}`;
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

function temporaryPacket() {
  const root = mkdtempSync(resolve(tmpdir(), 've2-packet-'));
  const packet = resolve(root, 've2');
  cpSync(PACKET_DIR, packet, { recursive: true });
  return { root, packet };
}

function refreshChecksum(packet, name) {
  const checksumPath = resolve(packet, 'SHA256SUMS');
  const nextHash = sha256(readFileSync(resolve(packet, name)));
  const lines = readFileSync(checksumPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => (
      line.endsWith(`  ${name}`) ? `${nextHash}  ${name}` : line
    ));
  writeFileSync(checksumPath, `${lines.join('\n')}\n`);
}

function packetConfigRaw(packetPolicyBytes, packetPolicy, corePolicy) {
  return Buffer.from(JSON.stringify({
    configurationRevision: 've2-test-v1',
    enabled: false,
    killSwitchEngaged: true,
    mode: 'SHADOW_ONLY',
    measurementPolicySha256: sha256(packetPolicyBytes),
    measurementPolicyId: packetPolicy.policyId,
    frozenMeasurementRules: FROZEN_PACKET_RULES,
    proposalAdmissionClosesAtMs: corePolicy.outcomeClosesAtMs,
    evidenceClosesAtMs: corePolicy.evidenceClosesAtMs,
  }));
}

async function writeSyntheticEvidence(
  path,
  { complete = false, variant = 'base' } = {},
) {
  const packetPolicyBytes = readFileSync(
    resolve(PACKET_DIR, 'measurement-policy.v1.json'),
  );
  const packetPolicy = JSON.parse(packetPolicyBytes);
  const coreMeasurement = await loadCoreMeasurementModule();
  const corePolicy = coreMeasurement.buildVolumeForwardMeasurementPolicy({
    policyId: packetPolicy.policyId,
    policyRevision: 1,
    symbol: 'BTCUSDT',
    frozenAtMs: 0,
    outcomeOpensAtMs: 1,
    outcomeClosesAtMs: 60_000,
    evidenceClosesAtMs: 122_000,
    streams: [
      'btcusdt@aggTrade',
      'btcusdt@bookTicker',
      'btcusdt@depth@100ms',
      'btcusdt@trade',
    ],
    config: {
      enabled: false,
      killSwitchEngaged: true,
    },
  });
  const writer = await createCoreEvidenceWriter({
    chainId:
      `ve2-synthetic-${complete ? 'complete' : 'preserved'}-${variant}`,
    maxBytes: 1024 * 1024,
    maxRecords: 32,
    outputPath: path,
    policyBytes: Buffer.from(JSON.stringify(corePolicy)),
    policyReceivedAtMs: 0,
    policyReceivedMonotonicNs: 100n,
  });
  let atMs = 1;
  let atNs = 101n;
  const append = (input, advanceClock = true) => {
    const record = writer.append({
      localReceivedAtMs: atMs,
      localMonotonicNs: atNs,
      ...input,
    });
    if (advanceClock) {
      atMs += 1;
      atNs += 1n;
    }
    return record;
  };
  append({
    kind: 'GENERATION_OPEN',
    rawBytes: Buffer.from('{"generation":1}'),
  });
  append({
    kind: 'CONFIG_STATE',
    rawBytes: packetConfigRaw(
      packetPolicyBytes,
      packetPolicy,
      corePolicy,
    ),
  });
  append({
    kind: 'KILL_STATE',
    rawBytes: Buffer.from('{"engaged":true}'),
  });
  append({
    kind: 'EXCHANGE_INFO',
    rawBytes: Buffer.from('{"symbols":[]}'),
    sourceEndpoint: 'https://data-api.binance.vision',
    sourceSymbol: 'BTCUSDT',
    sourceStream: '/api/v3/exchangeInfo',
    sourceTransport: 'BINANCE_SPOT_PUBLIC_REST',
  });
  if (complete) {
    for (const [kind, stream, rawBytes] of [
      [
        'DEPTH_SNAPSHOT',
        '/api/v3/depth',
        Buffer.from('{"lastUpdateId":1,"bids":[],"asks":[]}'),
      ],
      [
        'DEPTH_DIFF',
        'btcusdt@depth@100ms',
        Buffer.from('{"e":"depthUpdate","E":1,"s":"BTCUSDT","U":2,"u":2,"b":[],"a":[]}'),
      ],
      [
        'TRADE',
        'btcusdt@trade',
        Buffer.from('{"e":"trade","E":1,"s":"BTCUSDT","t":1,"p":"1","q":"1","T":1,"m":false}'),
      ],
      [
        'AGG_TRADE',
        'btcusdt@aggTrade',
        Buffer.from('{"e":"aggTrade","E":1,"s":"BTCUSDT","a":1,"p":"1","q":"1","f":1,"l":1,"T":1,"m":false}'),
      ],
      [
        'BOOK_TICKER',
        'btcusdt@bookTicker',
        Buffer.from('{"u":2,"s":"BTCUSDT","b":"1","B":"1","a":"2","A":"1"}'),
      ],
    ]) {
      const evidenceBytes = kind === 'DEPTH_SNAPSHOT'
        ? rawBytes
        : Buffer.from(
            `{"stream":${JSON.stringify(stream)},"data":${rawBytes.toString('utf8')}}`,
          );
      if (kind !== 'DEPTH_SNAPSHOT') {
        append({
          kind: 'STREAM_FRAME',
          rawBytes: evidenceBytes,
          sourceEndpoint: 'wss://data-stream.binance.vision',
          sourceSymbol: 'BTCUSDT',
          sourceStream: null,
          sourceTransport: 'BINANCE_SPOT_PUBLIC_STREAM',
        }, false);
      }
      append({
        kind,
        rawBytes: evidenceBytes,
        sourceEndpoint: kind === 'DEPTH_SNAPSHOT'
          ? 'https://data-api.binance.vision'
          : 'wss://data-stream.binance.vision',
        sourceSymbol: 'BTCUSDT',
        sourceStream: stream,
        sourceTransport: kind === 'DEPTH_SNAPSHOT'
          ? 'BINANCE_SPOT_PUBLIC_REST'
          : 'BINANCE_SPOT_PUBLIC_STREAM',
      });
    }
    append({
      kind: 'CONTINUITY',
      rawBytes: Buffer.from(
        '{"state":"CONTIGUOUS","generation":1,"previousFinalUpdateId":1,"firstUpdateId":2,"finalUpdateId":2}',
      ),
    });
    append({
      kind: 'DETECTOR_PROPOSAL',
      rawBytes: Buffer.from(
        '{"proposal":{"proposalId":"syntheticproposal"}}',
      ),
    });
    append({
      kind: 'LIFECYCLE_RECORD',
      rawBytes: Buffer.from(
        '{"mode":"SHADOW_RECORD_ONLY","proposalId":"syntheticproposal","state":"OBSERVED"}',
      ),
    });
    append({
      kind: 'LIFECYCLE_RECORD',
      rawBytes: Buffer.from(
        '{"mode":"SHADOW_RECORD_ONLY","proposalId":"syntheticproposal","state":"BLOCKED","reasonCodes":["DETECTOR_PROPOSAL_INVALID"]}',
      ),
    });
  } else {
    append({
      kind: 'CONTINUITY',
      rawBytes: Buffer.from('{"state":"INCOMPLETE","generation":1}'),
    });
  }
  append({
    kind: 'GENERATION_CLOSE',
    rawBytes: Buffer.from('{"generation":1,"state":"CLOSED"}'),
  });
  const verification = writer.seal({
    localReceivedAtMs: atMs,
    localMonotonicNs: atNs,
    rawBytes: Buffer.from(
      '{"purpose":"SMOKE_MECHANICS_ONLY","profitabilityClaim":"FORBIDDEN"}',
    ),
    verificationProfile: complete
      ? 'COMPLETE_MEASUREMENT'
      : 'INCOMPLETE_PRESERVATION',
  });
  writer.close();
  return verification;
}

async function writeDetectorSegmentEvidence(path) {
  const packetPolicyBytes = readFileSync(
    resolve(PACKET_DIR, 'measurement-policy.v1.json'),
  );
  const packetPolicy = JSON.parse(packetPolicyBytes);
  const coreMeasurement = await loadCoreMeasurementModule();
  const detectorInputSourceId =
    'local://volume-detector/accepted-proposals/v1';
  const detectorInputSourceDigest = `sha256:${'3'.repeat(64)}`;
  const policy = coreMeasurement.buildVolumeForwardDetectorCoveragePolicy({
    policyId: packetPolicy.policyId,
    policyRevision: 1,
    role: 'DETECTOR_COVERAGE',
    symbol: null,
    frozenAtMs: 0,
    outcomeOpensAtMs: 2_000,
    outcomeClosesAtMs: 6_000,
    evidenceClosesAtMs: 68_000,
    cadenceMs: 2_000,
    detectorInputSourceId,
    detectorInputSourceDigest,
    config: {
      enabled: false,
      killSwitchEngaged: true,
    },
  });
  const writer = await createCoreEvidenceWriter({
    chainId: 've2-detector-segment-adapter-test',
    maxBytes: 1024 * 1024,
    maxRecords: 16,
    outputPath: path,
    policyBytes: Buffer.from(JSON.stringify(policy)),
    policyReceivedAtMs: 0,
    policyReceivedMonotonicNs: 1n,
  });
  const records = [];
  const activationId = `ve2_activation_${'1'.repeat(64)}`;
  const segmentId = `ve2_segment_${'2'.repeat(64)}`;
  const captureId = 've2-detector-adapter-capture';
  const chainKey = 've2-detector-adapter-chain';
  let previousCutDigest = null;
  for (let cutOffset = 0; cutOffset < 2; cutOffset += 1) {
    const cutAtMs = 2_000 + cutOffset * 2_000;
    const localReceivedAtMs = cutAtMs + 1;
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
      localMonotonicNs: String(2_000_000n + BigInt(cutOffset)),
      cadenceMs: 2_000,
      configurationRevision: `config-${cutOffset + 1}`,
      configurationDigest:
        `sha256:${String(cutOffset + 4).repeat(64)}`,
      strategyEnabled: false,
      killSwitchEngaged: true,
      evaluationUniverseDigest:
        `sha256:${String(cutOffset + 6).repeat(64)}`,
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
    records.push(writer.append({
      kind: 'DETECTOR_COVERAGE',
      localReceivedAtMs,
      localMonotonicNs: BigInt(cut.localMonotonicNs),
      rawBytes: Buffer.from(canonicalJson(cut)),
    }));
  }
  const evidenceRecords = writer.records ?? null;
  const policyRecord = evidenceRecords?.[0] ?? null;
  const preSealRecords = evidenceRecords ?? [];
  assert.ok(policyRecord);
  assert.equal(preSealRecords.length, 3);
  const descriptor = {
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
    corePolicyDigest: policyRecord.header.rawSha256,
    packetMeasurementPolicySha256: sha256(packetPolicyBytes),
    detectorInputSourceId,
    detectorInputSourceDigest,
    coverage: {
      startMs: 2_000,
      endExclusiveMs: 6_000,
    },
    recordBounds: {
      firstHash: policyRecord.recordHash,
      sealedTailHash: preSealRecords.at(-1).recordHash,
      firstSequence: 0,
      lastSequence: 2,
      recordCount: 3,
      byteCount: preSealRecords.reduce(
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
      coverageChainKey: chainKey,
      firstCutOffset: 0,
      lastCutOffset: 1,
      cutCount: 2,
      expectedCutCount: 2,
      missingCutCount: 0,
      maxGapMs: 2_000,
      uncoveredMs: 0,
      firstCutDigest: JSON.parse(
        Buffer.from(preSealRecords[1].rawBase64, 'base64').toString('utf8'),
      ).cutDigest,
      lastCutDigest: JSON.parse(
        Buffer.from(preSealRecords[2].rawBase64, 'base64').toString('utf8'),
      ).cutDigest,
      complete: true,
    },
    acceptedProposals: [],
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
    localReceivedAtMs: 4_002,
    localMonotonicNs: 2_000_002n,
    rawBytes: Buffer.from(canonicalJson(descriptor)),
    verificationProfile: 'TERMINAL_SEGMENT',
  });
  writer.close();
  return verification;
}

function activationFixture() {
  const body = {
    schemaVersion: 've2.capture-activation.v1',
    state: 'CAPTURE_READY_ACCEPTED',
    acceptedCaptureCandidateCommit: 'a'.repeat(40),
    acceptedAtUtc: '2026-08-01T12:34:56.000Z',
    acceptedByIndependentExactHashReview: true,
    packetMeasurementPolicySha256: 'b'.repeat(64),
    detectorCoverageCorePolicyDigest: `sha256:${'d'.repeat(64)}`,
    detectorInputSourceId:
      'local://volume-detector/accepted-proposals/v1',
    detectorInputSourceDigest: `sha256:${'e'.repeat(64)}`,
    detectorBindingState: 'ACCEPTED_PROSPECTIVE_BINDING',
    detectorCoverageChainKey:
      `ve2_detector_coverage_${'f'.repeat(64)}`,
    captureImplementationSha256: 'c'.repeat(64),
    warmupStartUtc: '2026-08-02T20:00:00.000Z',
    intervalStartUtc: '2026-08-03T00:00:00.000Z',
    intervalEndExclusiveUtc: '2026-09-02T00:00:00.000Z',
    maturityAtUtc: '2026-09-02T00:01:02.000Z',
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
    ...body,
    activationId: buildDurableId('ve2_activation_', body),
  };
}

function acceptedProposalFixtures() {
  return [
    {
      cutOffset: 10,
      proposalId: 'volume-proposal-btc',
      proposalRevision: 1,
      proposalDigest: `vprop_${'1'.repeat(64)}`,
      symbol: 'BTCUSDT',
      detectorDecisionDigest: `vdetector_${'2'.repeat(64)}`,
      featureDigest: `vfeature_${'3'.repeat(64)}`,
    },
    {
      cutOffset: 700_000,
      proposalId: 'volume-proposal-eth',
      proposalRevision: 2,
      proposalDigest: `vprop_${'4'.repeat(64)}`,
      symbol: 'ETHUSDT',
      detectorDecisionDigest: `vdetector_${'5'.repeat(64)}`,
      featureDigest: `vfeature_${'6'.repeat(64)}`,
    },
  ];
}

function evidenceSegmentFixture(activation, {
  acceptedProposals,
  blocked = false,
  chainKey,
  corePolicyDigest,
  coverageEndExclusiveMs,
  coverageRole,
  coverageStartMs,
  detectorBatchPreviousDigest,
  detectorBatchTerminalDigest,
  detectorCutCount,
  detectorCutFirstIndex,
  evidenceHex,
  previousTerminalHash,
  segmentHex,
  segmentIndex,
  symbol,
  terminalHex,
}) {
  const lifecycleProposals = coverageRole === 'SYMBOL_LIFECYCLE'
    ? acceptedProposals.map((proposal) => ({
        proposalId: proposal.proposalId,
        proposalRevision: proposal.proposalRevision,
        proposalDigest: proposal.proposalDigest,
        symbol: proposal.symbol,
        state: blocked ? 'BLOCKED' : 'TERMINAL',
      }))
    : [];
  const terminalHash = `sha256:${terminalHex.repeat(64)}`;
  return {
    schemaVersion: 've2.evidence-segment-descriptor.v1',
    profile: 'TERMINAL_SEGMENT',
    purpose: 'FORWARD_MEASUREMENT_SEGMENT_V1',
    activationId: activation.activationId,
    captureId: `ve2-capture-${coverageRole.toLowerCase()}-${segmentIndex}`,
    segmentId: `ve2_segment_${segmentHex.repeat(64)}`,
    coverageRole,
    chainKey,
    symbol,
    segmentIndex,
    previousTerminalHash,
    corePolicyDigest,
    packetMeasurementPolicySha256:
      activation.packetMeasurementPolicySha256,
    terminalHash,
    evidenceBytesSha256: evidenceHex.repeat(64),
    detectorInputSourceId: activation.detectorInputSourceId,
    detectorInputSourceDigest: activation.detectorInputSourceDigest,
    coverageStartMs,
    coverageEndExclusiveMs,
    firstRecordHash: `sha256:${evidenceHex.repeat(64)}`,
    lastRecordHash: terminalHash,
    firstLocalReceivedAtMs: Date.parse(
      '2026-08-02T20:00:00.000Z',
    ),
    lastLocalReceivedAtMs: Math.min(
      coverageEndExclusiveMs + 1,
      Date.parse('2026-09-02T00:01:02.000Z'),
    ),
    firstLocalMonotonicNs: '1000000000',
    lastLocalMonotonicNs: '2000000000',
    recordCount: 100,
    canonicalJsonlBytes: 10_000,
    cumulativeRawPayloadBytes: 5_000,
    generationCount: 1,
    allGenerationsClosed: true,
    continuityGapCount: 0,
    unresolvedContinuityGapCount: 0,
    detectorCutFirstIndex,
    detectorCutCount,
    detectorExpectedCutCount: detectorCutCount,
    detectorCadenceMs: 2_000,
    missingDetectorCutCount: 0,
    detectorMissingCutRanges: [],
    maximumDetectorCutGapMs: 2_000,
    sourceUncoveredDurationMs: 0,
    detectorBatchPreviousDigest,
    detectorBatchTerminalDigest,
    detectorEvaluationUniverseDigest:
      `sha256:${segmentHex.repeat(64)}`,
    detectorEvaluationUniverseCount: acceptedProposals.length,
    detectorCoverageComplete: true,
    acceptedProposals,
    acceptedProposalIds: acceptedProposals.map(
      (proposal) => proposal.proposalId,
    ),
    pseudoProposalExcludedCount: 0,
    lifecycleProposals,
    lifecycleProposalIds: lifecycleProposals.map(
      (lifecycle) => lifecycle.proposalId,
    ),
    lifecycleCount: lifecycleProposals.length,
    terminalLifecycleCount: lifecycleProposals.filter(
      (lifecycle) => lifecycle.state === 'TERMINAL',
    ).length,
    blockedLifecycleCount: lifecycleProposals.filter(
      (lifecycle) => lifecycle.state === 'BLOCKED',
    ).length,
    openLifecycleCount: 0,
    nonTruncated: true,
    quiescent: true,
    profitabilityClaim: false,
    consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
  };
}

function manifestFixture(activation, { zero = false } = {}) {
  const intervalStartMs = Date.parse(activation.intervalStartUtc);
  const intervalEndMs = Date.parse(activation.intervalEndExclusiveUtc);
  const accepted = zero ? [] : acceptedProposalFixtures();
  const firstDetectorTerminal = `sha256:${'7'.repeat(64)}`;
  const firstBatchTerminal = `sha256:${'8'.repeat(64)}`;
  const detectorSegments = [
    evidenceSegmentFixture(activation, {
      acceptedProposals: accepted.filter(
        (proposal) => proposal.cutOffset < 648_000,
      ),
      chainKey: activation.detectorCoverageChainKey,
      corePolicyDigest: activation.detectorCoverageCorePolicyDigest,
      coverageEndExclusiveMs: intervalStartMs + 1_296_000_000,
      coverageRole: 'DETECTOR_COVERAGE',
      coverageStartMs: intervalStartMs,
      detectorBatchPreviousDigest: null,
      detectorBatchTerminalDigest: firstBatchTerminal,
      detectorCutCount: 648_000,
      detectorCutFirstIndex: 0,
      evidenceHex: '9',
      previousTerminalHash: null,
      segmentHex: 'a',
      segmentIndex: 0,
      symbol: null,
      terminalHex: '7',
    }),
    evidenceSegmentFixture(activation, {
      acceptedProposals: accepted.filter(
        (proposal) => proposal.cutOffset >= 648_000,
      ),
      chainKey: activation.detectorCoverageChainKey,
      corePolicyDigest: activation.detectorCoverageCorePolicyDigest,
      coverageEndExclusiveMs: Date.parse(activation.maturityAtUtc),
      coverageRole: 'DETECTOR_COVERAGE',
      coverageStartMs: intervalStartMs + 1_296_000_000,
      detectorBatchPreviousDigest: firstBatchTerminal,
      detectorBatchTerminalDigest: `sha256:${'a'.repeat(64)}`,
      detectorCutCount: 648_031,
      detectorCutFirstIndex: 648_000,
      evidenceHex: 'b',
      previousTerminalHash: firstDetectorTerminal,
      segmentHex: 'b',
      segmentIndex: 1,
      symbol: null,
      terminalHex: 'c',
    }),
  ];
  detectorSegments[0].pseudoProposalExcludedCount = 1;
  const lifecycleSegments = zero
    ? []
    : accepted.map((proposal, index) => evidenceSegmentFixture(
        activation,
        {
          acceptedProposals: [proposal],
          blocked: index === 1,
          chainKey:
            `ve2-lifecycle-${proposal.symbol.toLowerCase()}-0001`,
          corePolicyDigest: `sha256:${index === 0
            ? '1'.repeat(64)
            : '2'.repeat(64)}`,
          coverageEndExclusiveMs:
            intervalStartMs + (proposal.cutOffset + 31) * 2_000,
          coverageRole: 'SYMBOL_LIFECYCLE',
          coverageStartMs: intervalStartMs,
          detectorBatchPreviousDigest: null,
          detectorBatchTerminalDigest: `sha256:${index === 0
            ? '3'.repeat(64)
            : '4'.repeat(64)}`,
          detectorCutCount: proposal.cutOffset + 31,
          detectorCutFirstIndex: 0,
          evidenceHex: index === 0 ? 'd' : 'e',
          previousTerminalHash: null,
          segmentHex: index === 0 ? 'c' : 'd',
          segmentIndex: 0,
          symbol: proposal.symbol,
          terminalHex: index === 0 ? '5' : '6',
        },
      ));
  const evidenceSegments = [...detectorSegments, ...lifecycleSegments];
  const lifecycleProposals = lifecycleSegments.flatMap(
    (segment) => segment.lifecycleProposals,
  );
  const body = {
    schemaVersion: 've2.capture-manifest.v1',
    activationId: activation.activationId,
    state: 'TERMINAL_CAPTURE_RECOMPUTED',
    activationSha256: durableArtifactSha256(activation),
    packetMeasurementPolicySha256:
      activation.packetMeasurementPolicySha256,
    detectorCoverageCorePolicyDigest:
      activation.detectorCoverageCorePolicyDigest,
    detectorInputSourceId: activation.detectorInputSourceId,
    detectorInputSourceDigest: activation.detectorInputSourceDigest,
    intervalStartUtc: activation.intervalStartUtc,
    intervalEndExclusiveUtc: activation.intervalEndExclusiveUtc,
    maturityAtUtc: activation.maturityAtUtc,
    evidenceCaptureStartedAtUtc: '2026-08-02T20:00:00.000Z',
    evidenceCaptureEndedAtUtc: '2026-09-02T00:01:02.000Z',
    terminalRecordedAtUtc: '2026-09-02T00:01:02.000Z',
    maturityPassed: true,
    evidenceSchema: 'cosmos.engine.volume.forward-measurement-evidence.v1',
    evidenceSegmentCount: evidenceSegments.length,
    evidenceSegmentInventorySha256:
      buildEvidenceSegmentInventorySha256(evidenceSegments),
    evidenceSegments,
    detectorCoverageSegmentCount: detectorSegments.length,
    symbolLifecycleSegmentCount: lifecycleSegments.length,
    detectorCoverageState: 'COMPLETE_EXACT_PARTITION',
    detectorSegmentGapCount: 0,
    detectorSegmentOverlapCount: 0,
    detectorCutCount: 1_296_031,
    missingDetectorCutCount: 0,
    maximumDetectorCutGapMs: 2_000,
    sourceUncoveredDurationMs: 0,
    acceptedProposalUniverseSha256:
      buildAcceptedProposalUniverseSha256(accepted),
    acceptedDetectorProposalCount: accepted.length,
    nonPseudoDetectorProposalCount: accepted.length,
    proposalEligibilitySnapshotCount: accepted.length,
    pseudoProposalExcludedCount: 1,
    proposalSampleState: accepted.length === 0
      ? 'NO_ACCEPTED_PROPOSALS'
      : 'ACCEPTED_PROPOSALS_RECORDED',
    lifecycleProposalCount: lifecycleProposals.length,
    lifecycleCount: lifecycleProposals.length,
    terminalLifecycleCount: lifecycleProposals.filter(
      (lifecycle) => lifecycle.state === 'TERMINAL',
    ).length,
    blockedLifecycleCount: lifecycleProposals.filter(
      (lifecycle) => lifecycle.state === 'BLOCKED',
    ).length,
    openLifecycleCount: 0,
    packetPolicyBindingCount: evidenceSegments.length,
    coreReplaySourceMechanics: 'EXACT_CANONICAL_RECOMPUTED',
    lifecycleReplayPerformed: true,
    complete: true,
    warmupRowsIncludedInScoredSample: 0,
    smokeRowsIncluded: 0,
    outcomeBytesAccessedBeforeMaturity: false,
    economicsState: 'UNKNOWN',
    profitabilityClaim: false,
    consumerGate: 'BLOCKED_UNTIL_TERMINAL_RESULT_INDEPENDENTLY_ACCEPTED',
    externalEffects: {
      privateOrSignedCalls: 0,
      orders: 0,
      transfers: 0,
      withdrawals: 0,
      moneyUsd: 0,
    },
  };
  return {
    ...body,
    manifestId: buildDurableId('ve2_manifest_', body),
  };
}

function reidentifyManifest(manifest) {
  const body = JSON.parse(JSON.stringify(manifest));
  delete body.manifestId;
  body.evidenceSegmentInventorySha256 =
    buildEvidenceSegmentInventorySha256(body.evidenceSegments);
  return {
    ...body,
    manifestId: buildDurableId('ve2_manifest_', body),
  };
}

function trustedContext(activation, manifest = null) {
  return {
    expectedAcceptedCaptureCandidateCommit:
      activation.acceptedCaptureCandidateCommit,
    expectedCaptureImplementationSha256:
      activation.captureImplementationSha256,
    expectedPacketMeasurementPolicySha256:
      activation.packetMeasurementPolicySha256,
    expectedDetectorCoverageCorePolicyDigest:
      activation.detectorCoverageCorePolicyDigest,
    expectedDetectorInputSourceId:
      activation.detectorInputSourceId,
    expectedDetectorInputSourceDigest:
      activation.detectorInputSourceDigest,
    expectedDetectorCoverageChainKey:
      activation.detectorCoverageChainKey,
    ...(manifest === null ? {} : {
      expectedEvidenceSegmentInventorySha256:
        manifest.evidenceSegmentInventorySha256,
      expectedSegments: JSON.parse(JSON.stringify(
        manifest.evidenceSegments,
      )),
    }),
  };
}

function receiptFixture(activation, manifest) {
  const body = {
    schemaVersion: 've2.outcome-open-receipt.v1',
    openLockId: buildDurableId(
      've2_open_once_',
      { manifestId: manifest.manifestId },
    ),
    activationId: activation.activationId,
    manifestId: manifest.manifestId,
    manifestSha256: durableArtifactSha256(manifest),
    state: 'TERMINAL_OUTCOME_OPENED_ONCE',
    maturityAtUtc: manifest.maturityAtUtc,
    openedAtUtc: '2026-09-02T00:01:02.000Z',
    maturityPassed: true,
    finalManifestVerified: true,
    protocolDrift: false,
    priorOutcomeOpenCount: 0,
    outcomeOpenCount: 1,
    openedPaths: ['quant/research/ve2/outcome/result.json'],
    consumerGate: 'BLOCKED_UNTIL_TERMINAL_RESULT_INDEPENDENTLY_ACCEPTED',
  };
  return {
    ...body,
    receiptId: buildDurableId('ve2_open_', body),
  };
}

function exactReplayResult(reasonCodes = ['DETECTOR_PROPOSAL_EXPIRED']) {
  return {
    reasonCodes,
    sourceAuthenticity: 'TRUSTED_ANCHOR_MATCHED',
    mode: 'SHADOW_ONLY',
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
    economics: null,
    profitabilityClaim: false,
  };
}

function exactGeneration() {
  return {
    combinedUrlAcknowledged: true,
    captureTruncated: false,
    exchangeInfoCaptured: true,
    pointInTimeEligible: true,
    depthSnapshotCaptured: true,
    depthBridgeExact: true,
    continuityExact: true,
    gapDetected: false,
    invalidFrame: false,
    detectorProposalCaptured: true,
    lifecycleAssertionsCaptured: true,
    streamCounts: {
      depth100ms: 2,
      aggTrade: 1,
      trade: 1,
      bookTicker: 1,
    },
    combinedFrameCount: 5,
    streamFrameCount: 5,
  };
}

test('accepts the frozen prospective packet without fabricating activation', () => {
  const result = verifyPacket(PACKET_DIR, REPO_ROOT);
  assert.equal(result.policyId, 'VOLUME_MEASUREMENT_MAX_HOLD_60S_V1');
  assert.equal(result.activation, 'PROSPECTIVE_NOT_ACTIVATED');
  assert.equal(result.consumerGate, 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED');
  assert.equal(result.externalEffects, 0);
});

test('rejects a self-consistent fabricated interval start', () => {
  const { root, packet } = temporaryPacket();
  try {
    const path = resolve(packet, 'measurement-policy.v1.json');
    const policy = JSON.parse(readFileSync(path, 'utf8'));
    policy.activation.intervalStartUtc = '2026-07-30T00:00:00Z';
    writeFileSync(path, `${JSON.stringify(policy, null, 2)}\n`);
    refreshChecksum(packet, 'measurement-policy.v1.json');
    assert.throws(
      () => verifyPacket(packet, REPO_ROOT),
      /VE2_FROZEN_JSON_DRIFT:measurement-policy\.v1\.json/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects mutated packet rules even when DEFAULT OFF and KILL ON remain', () => {
  const { root, packet } = temporaryPacket();
  try {
    const path = resolve(packet, 'measurement-policy.v1.json');
    const policy = JSON.parse(readFileSync(path, 'utf8'));
    policy.detectorBinding.maximumHoldMs = 60_001;
    assert.equal(policy.defaults.strategyEnabled, false);
    assert.equal(policy.defaults.killSwitchEngaged, true);
    writeFileSync(path, `${JSON.stringify(policy, null, 2)}\n`);
    refreshChecksum(packet, 'measurement-policy.v1.json');
    assert.throws(
      () => verifyPacket(packet, REPO_ROOT),
      /VE2_FROZEN_JSON_DRIFT:measurement-policy\.v1\.json/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accepts only bounded, explicit public smoke arguments', () => {
  assert.throws(
    () => parseSmokeArgs([
      '--symbol',
      'BTCUSDT',
      '--output',
      '/tmp/ve2-smoke-test.jsonl',
    ]),
    /VE2_SMOKE_OPT_IN_REQUIRED/,
  );
  const parsed = parseSmokeArgs([
    '--run-public-smoke',
    '--symbol',
    'BTCUSDT',
    '--duration-ms',
    '5000',
    '--max-records',
    '100',
    '--max-bytes',
    '1048576',
    '--output',
    '/tmp/ve2-smoke-test.jsonl',
  ]);
  assert.equal(parsed.runPublicSmoke, true);
  assert.equal(parsed.durationMs, 5000);
});

test('exported smoke runner rejects hostile direct-call options before I/O', async () => {
  const valid = {
    runPublicSmoke: true,
    symbol: 'BTCUSDT',
    durationMs: 5_000,
    maxRecords: 100,
    maxBytes: 1024 * 1024,
    output: '/tmp/ve2-smoke-direct.jsonl',
  };
  assert.equal(validateSmokeOptions(valid).symbol, 'BTCUSDT');
  for (const candidate of [
    { ...valid, extra: true },
    { ...valid, durationMs: 20_001 },
    { ...valid, maxBytes: 32 * 1024 * 1024 + 1 },
    { ...valid, maxRecords: 15 },
    { ...valid, symbol: 'btcusdt' },
    { ...valid, runPublicSmoke: false },
    {
      ...valid,
      output: resolve(PACKET_DIR, 'forbidden-smoke.jsonl'),
    },
  ]) {
    assert.throws(() => validateSmokeOptions(candidate));
    await assert.rejects(() => runPublicSmoke(candidate));
  }
  await assert.rejects(
    () => runPublicSmoke({
      ...valid,
      symbol: 'ETHUSDT',
      output: '/tmp/ve2-smoke-wrong-policy-symbol.jsonl',
    }),
    /VE2_SMOKE_POLICY_SYMBOL_MISMATCH/,
  );
});

test('uses only the frozen combined stream URL and retains exact inner bytes', () => {
  const { streams, url } = buildCombinedWebSocketUrl('BTCUSDT');
  assert.equal(url.pathname, '/stream');
  assert.equal(url.search, `?streams=${streams.join('/')}`);
  const raw = Buffer.from(
    '{"stream":"btcusdt@trade","data": { "e":"trade","s":"BTCUSDT","t":7 } }',
  );
  const unwrapped = unwrapCombinedStreamPayload(raw);
  assert.equal(unwrapped.stream, 'btcusdt@trade');
  assert.equal(
    unwrapped.innerBytes.toString('utf8'),
    '{ "e":"trade","s":"BTCUSDT","t":7 }',
  );
  assert.equal(
    raw.subarray(
      unwrapped.innerOffset,
      unwrapped.innerOffset + unwrapped.innerLength,
    ).toString('hex'),
    unwrapped.innerBytes.toString('hex'),
  );
});

test('requires a complete exact aggregate-trade constituent proof before proposal', () => {
  const aggregateTrade = {
    kind: 'AGG_TRADE',
    symbol: 'BTCUSDT',
    aggregateTradeId: 20,
    firstTradeId: 10,
    lastTradeId: 11,
    eventTimeMs: 100,
    tradeTimeMs: 100,
    price: '100.00',
    quantity: '0.300',
    buyerIsMaker: false,
    generation: 1,
    receivedMonotonicNs: '100',
    receivedAtMs: 100,
    stream: 'btcusdt@aggTrade',
  };
  const trade = (tradeId, quantity) => ({
    kind: 'TRADE',
    symbol: 'BTCUSDT',
    tradeId,
    eventTimeMs: 100,
    tradeTimeMs: 100,
    price: '100.0',
    quantity,
    buyerIsMaker: false,
    generation: 1,
    receivedMonotonicNs: String(100 + tradeId),
    receivedAtMs: 100,
    stream: 'btcusdt@trade',
  });
  const tradesById = new Map([[10, trade(10, '0.1')]]);
  assert.equal(aggregateTradeProofExact(aggregateTrade, tradesById), false);
  tradesById.set(11, trade(11, '0.20'));
  assert.equal(aggregateTradeProofExact(aggregateTrade, tradesById), true);
  const depthState = {
    status: 'SYNCHRONIZED',
    continuity: 'CONTIGUOUS',
    lastUpdateId: 5,
    lastReceivedAtMs: 100,
    lastReceivedMonotonicNs: '120',
    bids: [['99.00', '1.0']],
    asks: [['101.0', '2.00']],
  };
  const bookTicker = {
    kind: 'BOOK_TICKER',
    symbol: 'BTCUSDT',
    generation: 1,
    updateId: 5,
    bidPrice: '99',
    bidQuantity: '1.00',
    askPrice: '101.00',
    askQuantity: '2',
    receivedAtMs: 100,
    receivedMonotonicNs: '121',
  };
  assert.equal(smokeProposalPrerequisitesExact({
    aggregateTrade,
    bookTicker,
    depthState,
    evaluatedAtMs: 101,
    evaluatedMonotonicNs: '122',
    tradesById,
  }), true);
  assert.equal(smokeProposalPrerequisitesExact({
    aggregateTrade,
    bookTicker: { ...bookTicker, updateId: 6 },
    depthState,
    evaluatedAtMs: 101,
    evaluatedMonotonicNs: '122',
    tradesById,
  }), false);
  assert.equal(smokeProposalPrerequisitesExact({
    aggregateTrade,
    bookTicker,
    depthState,
    evaluatedAtMs: 2_101,
    evaluatedMonotonicNs: '2000000122',
    tradesById,
  }), false);
  tradesById.set(11, trade(11, '0.21'));
  assert.equal(aggregateTradeProofExact(aggregateTrade, tradesById), false);
});

test('forbids canonical core module injection', async () => {
  await assert.rejects(
    () => loadCoreEvidenceModule('/tmp/custom-evidence.mjs'),
    /VE2_CORE_EVIDENCE_MODULE_OVERRIDE_FORBIDDEN/,
  );
  await assert.rejects(
    () => loadCoreMeasurementModule('/tmp/custom-measurement.mjs'),
    /VE2_CORE_MEASUREMENT_MODULE_OVERRIDE_FORBIDDEN/,
  );
  await assert.rejects(
    () => parseCoreEvidenceFile('/tmp/unused.jsonl', {
      coreModulePath: '/tmp/custom-evidence.mjs',
    }),
    /VE2_PARSE_OPTION_FORBIDDEN:coreModulePath/,
  );
  await assert.rejects(
    () => createCoreEvidenceWriter({
      chainId: 'forbidden-module-override',
      coreModulePath: '/tmp/custom-evidence.mjs',
      maxBytes: 1024,
      maxRecords: 16,
      outputPath: '/tmp/unused.jsonl',
      policyBytes: Buffer.from('{}'),
      policyReceivedAtMs: 0,
      policyReceivedMonotonicNs: 0n,
    }),
    /VE2_WRITER_OPTION_FORBIDDEN:coreModulePath/,
  );
});

test('complete and preservation evidence profiles are explicit', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 've2-chain-'));
  try {
    const incompletePath = resolve(root, 'incomplete.jsonl');
    await writeSyntheticEvidence(incompletePath);
    const preserved = await parseCoreEvidenceFile(incompletePath, {
      verificationProfile: 'INCOMPLETE_PRESERVATION',
    });
    assert.equal(preserved.verification.sealed, true);
    await assert.rejects(
      () => parseCoreEvidenceFile(incompletePath),
      /VE2_PARSE_EXPECTED_POLICY_DIGEST_REQUIRED/,
    );
    await assert.rejects(
      () => parseCoreEvidenceFile(incompletePath, {
        maximumJsonlBytes: 512 * 1024 * 1024 + 1,
        verificationProfile: 'INCOMPLETE_PRESERVATION',
      }),
      /VE2_EVIDENCE_JSONL_LIMIT/,
    );
    await assert.rejects(
      () => parseCoreEvidenceFile(incompletePath, {
        maximumLineBytes: 24 * 1024 * 1024 + 1,
        verificationProfile: 'INCOMPLETE_PRESERVATION',
      }),
      /VE2_EVIDENCE_LINE_LIMIT/,
    );
    await assert.rejects(
      () => parseCoreEvidenceFile(root, {
        verificationProfile: 'INCOMPLETE_PRESERVATION',
      }),
      /VE2_EVIDENCE_NOT_REGULAR_FILE/,
    );

    const completePath = resolve(root, 'complete.jsonl');
    const completeAnchors = await writeSyntheticEvidence(
      completePath,
      { complete: true },
    );
    const complete = await parseCoreEvidenceFile(completePath, {
      expectedPolicyDigest: completeAnchors.policyDigest,
      expectedTerminalHash: completeAnchors.terminalHash,
    });
    assert.equal(complete.verification.sealed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a tampered raw-evidence payload', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 've2-chain-'));
  try {
    const evidencePath = resolve(root, 'evidence.jsonl');
    const anchors = await writeSyntheticEvidence(
      evidencePath,
      { complete: true },
    );
    const lines = readFileSync(evidencePath, 'utf8').trim().split('\n');
    const index = lines.findIndex(
      (line) => JSON.parse(line).header.kind === 'EXCHANGE_INFO',
    );
    const exchangeInfo = JSON.parse(lines[index]);
    exchangeInfo.rawBase64 = Buffer.from(
      '{"symbols":[{"symbol":"INVENTED"}]}',
    ).toString('base64');
    lines[index] = JSON.stringify(exchangeInfo);
    writeFileSync(evidencePath, `${lines.join('\n')}\n`);
    await assert.rejects(
      () => parseCoreEvidenceFile(evidencePath, {
        expectedPolicyDigest: anchors.policyDigest,
        expectedTerminalHash: anchors.terminalHash,
      }),
      /VE2_CORE_EVIDENCE_PARSE:/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('binds every CONFIG_STATE to exact packet hash and rules', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 've2-binding-'));
  try {
    const evidencePath = resolve(root, 'evidence.jsonl');
    const anchors = await writeSyntheticEvidence(
      evidencePath,
      { complete: true },
    );
    const parsed = await parseCoreEvidenceFile(evidencePath, {
      expectedPolicyDigest: anchors.policyDigest,
      expectedTerminalHash: anchors.terminalHash,
    });
    const policyBytes = readFileSync(resolve(PACKET_DIR, 'measurement-policy.v1.json'));
    const policy = JSON.parse(policyBytes);
    const binding = verifyPacketPolicyBinding(
      parsed.core,
      parsed.verification,
      policyBytes,
      policy,
    );
    assert.equal(binding.configBindingCount, 1);
    assert.equal(binding.packetPolicySha256, sha256(policyBytes));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('replay is fixed to the canonical core and forbids custom-module options', async () => {
  assert.throws(
    () => parseReplayArgs([
      '--evidence',
      '/tmp/evidence.jsonl',
      '--adapter',
      '/tmp/custom.mjs',
    ]),
    /VE2_REPLAY_UNKNOWN_ARGUMENT:--adapter/,
  );
  await assert.rejects(
    () => replayEvidence({
      evidencePath: '/tmp/does-not-matter.jsonl',
      adapter: '/tmp/custom.mjs',
    }),
    /VE2_REPLAY_OPTION_FORBIDDEN:adapter/,
  );
  await assert.rejects(
    () => replayEvidence({ evidencePath: '/tmp/does-not-matter.jsonl' }),
    /VE2_REPLAY_EXPECTED_POLICY_DIGEST_REQUIRED/,
  );
  const root = mkdtempSync(resolve(tmpdir(), 've2-replay-'));
  try {
    const evidencePath = resolve(root, 'evidence.jsonl');
    const anchors = await writeSyntheticEvidence(
      evidencePath,
      { complete: true },
    );
    const anchored = {
      evidencePath,
      expectedPolicyDigest: anchors.policyDigest,
      expectedTerminalHash: anchors.terminalHash,
    };
    const result = await replayEvidence(anchored);
    assert.equal(result.state, 'SHADOW_RECORD_ONLY_REPLAY_COMPLETE');
    assert.equal(result.lifecycleReplayPerformed, true);
    assert.equal(result.replay.mode, 'SHADOW_ONLY');
    assert.equal(result.replay.externalEffects, 0);
    const integrity = await replayEvidence({
      ...anchored,
      integrityOnly: true,
    });
    assert.equal(integrity.state, 'INTEGRITY_ONLY_COMPLETE');
    assert.equal(integrity.lifecycleReplayPerformed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('canonical replay adapter preserves terminal detector profile and recomputed segment facts', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 've2-detector-adapter-'));
  try {
    const evidencePath = resolve(root, 'detector.jsonl');
    const anchors = await writeDetectorSegmentEvidence(evidencePath);
    const result = await replayEvidence({
      evidencePath,
      expectedPolicyDigest: anchors.policyDigest,
      expectedTerminalHash: anchors.terminalHash,
    });
    assert.equal(result.state, 'SHADOW_RECORD_ONLY_REPLAY_COMPLETE');
    assert.equal(result.replay.replayProfile, 'TERMINAL_SEGMENT');
    assert.equal(
      result.replay.segmentFacts.coverageRole,
      'DETECTOR_COVERAGE',
    );
    assert.equal(result.replay.segmentFacts.detectorCutCount, 2);
    assert.equal(result.replay.segmentFacts.detectorCoverageComplete, true);
    assert.deepEqual(result.replay.segmentFacts.acceptedProposals, []);
    assert.equal(result.replay.segmentFacts.profitabilityClaim, false);
    assert.equal(result.replay.externalEffects, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('trusted anchors reject wrong and independently recomputed chains', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 've2-anchor-'));
  try {
    const firstPath = resolve(root, 'first.jsonl');
    const secondPath = resolve(root, 'second.jsonl');
    const first = await writeSyntheticEvidence(
      firstPath,
      { complete: true, variant: 'first' },
    );
    const second = await writeSyntheticEvidence(
      secondPath,
      { complete: true, variant: 'second' },
    );
    assert.notEqual(first.terminalHash, second.terminalHash);
    await assert.rejects(
      () => replayEvidence({
        evidencePath: firstPath,
        expectedPolicyDigest: `sha256:${'0'.repeat(64)}`,
        expectedTerminalHash: first.terminalHash,
      }),
      /VE2_CORE_EVIDENCE_PARSE:/,
    );
    await assert.rejects(
      () => replayEvidence({
        evidencePath: secondPath,
        expectedPolicyDigest: first.policyDigest,
        expectedTerminalHash: first.terminalHash,
      }),
      /VE2_CORE_EVIDENCE_PARSE:/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('smoke reports exact mechanics only with complete source and replay proof', () => {
  assert.equal(shouldContinueSmokeCapture(exactGeneration()), false);
  assert.equal(shouldContinueSmokeCapture({
    ...exactGeneration(),
    detectorProposalCaptured: false,
    reason: 'REMOTE_CLOSE',
  }), true);
  assert.equal(shouldContinueSmokeCapture({
    ...exactGeneration(),
    reason: 'SMOKE_MECHANICS_COMPLETE',
  }), false);
  const exact = classifySmokeMechanics({
    generations: [exactGeneration()],
    replayResult: exactReplayResult(),
  });
  assert.equal(exact.state, 'SMOKE_MECHANICS_EXACT');
  const missing = exactGeneration();
  missing.streamCounts = { ...missing.streamCounts, trade: 0 };
  missing.combinedFrameCount = 4;
  assert.equal(classifySmokeMechanics({
    generations: [missing],
    replayResult: exactReplayResult(),
  }).state, 'BLOCKED_SMOKE_MECHANICS_INCOMPLETE');
  const truncated = exactGeneration();
  truncated.captureTruncated = true;
  assert.equal(classifySmokeMechanics({
    generations: [truncated],
    replayResult: exactReplayResult(),
  }).state, 'BLOCKED_SMOKE_MECHANICS_INCOMPLETE');
  assert.deepEqual(classifySmokeMechanics({
    generations: [exactGeneration()],
    replayResult: exactReplayResult(['SOURCE_CONTINUITY_NOT_EXACT']),
  }).sourceFailures, ['SOURCE_CONTINUITY_NOT_EXACT']);
  assert.deepEqual(classifySmokeMechanics({
    generations: [exactGeneration()],
    replayResult: exactReplayResult(['BOOK_TICKER_STALE']),
  }).sourceFailures, ['BOOK_TICKER_STALE']);
  assert.deepEqual(classifySmokeMechanics({
    generations: [exactGeneration()],
    replayResult: exactReplayResult(['TRADE_EVIDENCE_MISSING']),
  }).sourceFailures, ['TRADE_EVIDENCE_MISSING']);
  assert.deepEqual(classifySmokeMechanics({
    generations: [exactGeneration()],
    replayResult: exactReplayResult([
      'DETECTOR_PROPOSAL_EXPIRED',
      'RECORDED_LIFECYCLE_MISMATCH',
    ]),
  }).sourceFailures, [
    'DETECTOR_PROPOSAL_EXPIRED',
    'RECORDED_LIFECYCLE_MISMATCH',
  ]);
});

test('instance validators enforce chronology, hashes, terminality, and one open', () => {
  const activation = activationFixture();
  const manifest = manifestFixture(activation);
  const receipt = receiptFixture(activation, manifest);
  const anchors = trustedContext(activation, manifest);
  assert.equal(validateActivationInstance(activation, anchors), true);
  assert.equal(
    validateTerminalManifestInstance(manifest, activation, anchors),
    true,
  );
  assert.equal(
    validateOutcomeOpenReceiptInstance(
      receipt,
      manifest,
      activation,
      anchors,
    ),
    true,
  );

  const wrongStartBody = {
    ...activation,
    intervalStartUtc: '2026-08-04T00:00:00.000Z',
  };
  delete wrongStartBody.activationId;
  const wrongStart = {
    ...wrongStartBody,
    activationId: buildDurableId('ve2_activation_', wrongStartBody),
  };
  assert.throws(
    () => validateActivationInstance(wrongStart, anchors),
    /VE2_ACTIVATION_FIRST_UTC_MIDNIGHT/,
  );

  const incompleteBody = { ...manifest, complete: false };
  delete incompleteBody.manifestId;
  const incomplete = {
    ...incompleteBody,
    manifestId: buildDurableId('ve2_manifest_', incompleteBody),
  };
  assert.throws(
    () => validateTerminalManifestInstance(
      incomplete,
      activation,
      anchors,
    ),
    /VE2_MANIFEST_INSTANCE_STATE/,
  );

  const mismatchedCountsBody = {
    ...manifest,
    acceptedDetectorProposalCount: 1,
  };
  delete mismatchedCountsBody.manifestId;
  const mismatchedCounts = {
    ...mismatchedCountsBody,
    manifestId: buildDurableId('ve2_manifest_', mismatchedCountsBody),
  };
  assert.throws(
    () => validateTerminalManifestInstance(
      mismatchedCounts,
      activation,
      anchors,
    ),
    /VE2_MANIFEST_RECONCILIATION/,
  );

  const zeroSample = manifestFixture(activation, { zero: true });
  const zeroAnchors = trustedContext(activation, zeroSample);
  assert.equal(
    validateTerminalManifestInstance(
      zeroSample,
      activation,
      zeroAnchors,
    ),
    true,
  );
  const inconsistentZeroBody = {
    ...zeroSample,
    proposalSampleState: 'ACCEPTED_PROPOSALS_RECORDED',
  };
  delete inconsistentZeroBody.manifestId;
  const inconsistentZero = {
    ...inconsistentZeroBody,
    manifestId: buildDurableId(
      've2_manifest_',
      inconsistentZeroBody,
    ),
  };
  assert.throws(
    () => validateTerminalManifestInstance(
      inconsistentZero,
      activation,
      trustedContext(activation, inconsistentZero),
    ),
    /VE2_MANIFEST_RECONCILIATION/,
  );

  const reopenedBody = {
    ...receipt,
    priorOutcomeOpenCount: 1,
    outcomeOpenCount: 2,
  };
  delete reopenedBody.receiptId;
  const reopened = {
    ...reopenedBody,
    receiptId: buildDurableId('ve2_open_', reopenedBody),
  };
  assert.throws(
    () => validateOutcomeOpenReceiptInstance(
      reopened,
      manifest,
      activation,
      anchors,
    ),
    /VE2_OUTCOME_INSTANCE_STATE/,
  );

  const lateStartBody = {
    ...manifest,
    evidenceCaptureStartedAtUtc: '2026-08-03T00:00:00.001Z',
  };
  delete lateStartBody.manifestId;
  const lateStart = {
    ...lateStartBody,
    manifestId: buildDurableId('ve2_manifest_', lateStartBody),
  };
  assert.throws(
    () => validateTerminalManifestInstance(lateStart, activation, anchors),
    /VE2_MANIFEST_CAPTURE_INTERVAL_COVERAGE/,
  );

  const earlyEndBody = {
    ...manifest,
    evidenceCaptureEndedAtUtc: '2026-09-02T00:00:00.000Z',
  };
  delete earlyEndBody.manifestId;
  const earlyEnd = {
    ...earlyEndBody,
    manifestId: buildDurableId('ve2_manifest_', earlyEndBody),
  };
  assert.throws(
    () => validateTerminalManifestInstance(earlyEnd, activation, anchors),
    /VE2_MANIFEST_CAPTURE_INTERVAL_COVERAGE/,
  );

  const detectorGapBody = JSON.parse(JSON.stringify(manifest));
  detectorGapBody.evidenceSegments[1].coverageStartMs += 2_000;
  detectorGapBody.evidenceSegments[1].detectorCutCount -= 1;
  detectorGapBody.evidenceSegments[1].detectorExpectedCutCount -= 1;
  detectorGapBody.detectorCutCount -= 1;
  const detectorGap = reidentifyManifest(detectorGapBody);
  assert.throws(
    () => validateTerminalManifestInstance(
      detectorGap,
      activation,
      trustedContext(activation, detectorGap),
    ),
    /VE2_MANIFEST_DETECTOR_PARTITION/,
  );

  const missingTailBody = JSON.parse(JSON.stringify(manifest));
  missingTailBody.evidenceSegments[1].coverageEndExclusiveMs =
    Date.parse(activation.intervalEndExclusiveUtc);
  missingTailBody.evidenceSegments[1].detectorCutCount -= 31;
  missingTailBody.evidenceSegments[1].detectorExpectedCutCount -= 31;
  missingTailBody.detectorCutCount -= 31;
  const missingTail = reidentifyManifest(missingTailBody);
  assert.throws(
    () => validateTerminalManifestInstance(
      missingTail,
      activation,
      trustedContext(activation, missingTail),
    ),
    /VE2_MANIFEST_DETECTOR_INTERVAL_INCOMPLETE/,
  );

  const predecessorBody = JSON.parse(JSON.stringify(manifest));
  predecessorBody.evidenceSegments[1].previousTerminalHash =
    `sha256:${'0'.repeat(64)}`;
  const predecessor = reidentifyManifest(predecessorBody);
  assert.throws(
    () => validateTerminalManifestInstance(
      predecessor,
      activation,
      trustedContext(activation, predecessor),
    ),
    /VE2_MANIFEST_SEGMENT_CHAIN/,
  );

  const terminalGapBody = {
    ...manifest,
    evidenceCaptureEndedAtUtc: '2026-09-02T00:01:03.000Z',
  };
  delete terminalGapBody.manifestId;
  const terminalGap = {
    ...terminalGapBody,
    manifestId: buildDurableId('ve2_manifest_', terminalGapBody),
  };
  assert.throws(
    () => validateTerminalManifestInstance(
      terminalGap,
      activation,
      anchors,
    ),
    /VE2_MANIFEST_CAPTURE_INTERVAL_COVERAGE/,
  );

  assert.throws(
    () => validateTerminalManifestInstance(manifest, activation, {
      ...anchors,
      expectedEvidenceSegmentInventorySha256:
        `sha256:${'0'.repeat(64)}`,
    }),
    /VE2_MANIFEST_SEGMENT_INVENTORY_MISMATCH/,
  );

  const lifecycleMismatchBody = JSON.parse(JSON.stringify(manifest));
  const lifecycleSegment = lifecycleMismatchBody.evidenceSegments.find(
    (segment) => segment.coverageRole === 'SYMBOL_LIFECYCLE',
  );
  lifecycleSegment.acceptedProposals[0].proposalDigest =
    `vprop_${'f'.repeat(64)}`;
  lifecycleSegment.lifecycleProposals[0].proposalDigest =
    `vprop_${'f'.repeat(64)}`;
  const lifecycleMismatch = reidentifyManifest(lifecycleMismatchBody);
  assert.throws(
    () => validateTerminalManifestInstance(
      lifecycleMismatch,
      activation,
      trustedContext(activation, lifecycleMismatch),
    ),
    /VE2_MANIFEST_PROPOSAL_LIFECYCLE_BIJECTION/,
  );

  const smokeBody = JSON.parse(JSON.stringify(manifest));
  smokeBody.evidenceSegments[0].profile = 'SMOKE_MECHANICS_ONLY';
  const smoke = reidentifyManifest(smokeBody);
  assert.throws(
    () => validateTerminalManifestInstance(
      smoke,
      activation,
      trustedContext(activation, smoke),
    ),
    /VE2_SEGMENT_IDENTITY/,
  );

  const alternateActivationBody = {
    ...activation,
    acceptedCaptureCandidateCommit: 'e'.repeat(40),
    captureImplementationSha256: 'f'.repeat(64),
    packetMeasurementPolicySha256: '9'.repeat(64),
  };
  delete alternateActivationBody.activationId;
  const alternateActivation = {
    ...alternateActivationBody,
    activationId: buildDurableId(
      've2_activation_',
      alternateActivationBody,
    ),
  };
  const alternateManifest = manifestFixture(alternateActivation);
  const alternateReceipt = receiptFixture(
    alternateActivation,
    alternateManifest,
  );
  assert.throws(
    () => validateOutcomeOpenReceiptInstance(
      alternateReceipt,
      alternateManifest,
      alternateActivation,
      anchors,
    ),
    /VE2_ACTIVATION_ACCEPTED_COMMIT_MISMATCH/,
  );
});

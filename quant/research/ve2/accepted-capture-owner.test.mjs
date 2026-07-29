#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  createAcceptedCaptureOwner,
  deriveAcceptedDetectorPolicyBinding,
} from './accepted-capture-owner.mjs';
import { parseCoreEvidenceFile } from './evidence-chain.mjs';
import {
  createVolumeForwardMeasurementRunner,
} from './terminal-runner-core.bundle.mjs';

const INTERVAL_START_MS = Date.UTC(2026, 7, 2);
const WARMUP_START_MS = INTERVAL_START_MS - 14_400_000;
const INTERVAL_END_EXCLUSIVE_MS =
  INTERVAL_START_MS + 2_592_000_000;
const MATURITY_AT_MS = INTERVAL_END_EXCLUSIVE_MS + 62_000;
const ACTIVATION_ID = `ve2_activation_${'1'.repeat(64)}`;
const CAPTURE_ID = `ve2_capture_${'2'.repeat(64)}`;
const CHAIN_KEY = `ve2_detector_coverage_${'3'.repeat(64)}`;
const SOURCE_DIGEST = `sha256:${'4'.repeat(64)}`;
const PACKET_POLICY_SHA256 = '5'.repeat(64);

const CONTROLS = Object.freeze({
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
});

function handoffFixture(evidenceRoot) {
  return {
    schemaVersion: 'vi3.scheduled-capture-handoff.v1',
    handoffId: `vi3_handoff_${'6'.repeat(64)}`,
    captureId: CAPTURE_ID,
    acceptedCaptureCandidateCommit: '7'.repeat(40),
    acceptedCaptureCandidateTree: '8'.repeat(40),
    acceptanceReceiptSha256: '9'.repeat(64),
    activationSha256: 'a'.repeat(64),
    terminalMetricsPolicySha256: 'b'.repeat(64),
    vI3ChecksumFileSha256: 'c'.repeat(64),
    activation: {
      activationId: ACTIVATION_ID,
      captureImplementationSha256: 'd'.repeat(64),
      packetMeasurementPolicySha256: PACKET_POLICY_SHA256,
    },
    schedule: {
      warmupStartUtc: new Date(WARMUP_START_MS).toISOString(),
      admissionStartUtc: new Date(INTERVAL_START_MS).toISOString(),
      admissionEndExclusiveUtc:
        new Date(INTERVAL_END_EXCLUSIVE_MS).toISOString(),
      captureStopNotBeforeUtc:
        new Date(MATURITY_AT_MS).toISOString(),
    },
    detector: {
      sourceId:
        'local://volume-engine/detector-evaluation-cut/v1',
      sourceDigest: SOURCE_DIGEST,
      coverageCorePolicyDigest: `sha256:${'e'.repeat(64)}`,
      coverageChainKey: CHAIN_KEY,
    },
    evidenceRoot,
    controls: CONTROLS,
  };
}

function runnerSchedule(handoff) {
  return {
    schemaVersion: 'volume.forward.scheduled-capture.v1',
    activationId: ACTIVATION_ID,
    captureId: CAPTURE_ID,
    detectorCoverageChainKey: CHAIN_KEY,
    detectorCoverageCorePolicyDigest:
      handoff.detector.coverageCorePolicyDigest,
    detectorInputSourceId: handoff.detector.sourceId,
    detectorInputSourceDigest: SOURCE_DIGEST,
    packetMeasurementPolicySha256: PACKET_POLICY_SHA256,
    warmupStartMs: WARMUP_START_MS,
    intervalStartMs: INTERVAL_START_MS,
    intervalEndExclusiveMs: INTERVAL_END_EXCLUSIVE_MS,
    maturityAtMs: MATURITY_AT_MS,
    detectorCadenceMs: 2_000,
    detectorCutsPerSegment: 99_998,
    controls: {
      enabled: false,
      killSwitchEngaged: true,
      mode: 'SHADOW_ONLY',
      recordOnly: true,
    },
  };
}

function sourceCut(tickAtMs, proposal = null) {
  return {
    schemaVersion:
      'cosmos.engine.volume.forward-detector-source-cut.v1',
    sourceId: 'local://volume-engine/detector-evaluation-cut/v1',
    tickAtMs,
    configurationRevision: 'volume_config_revision_0001',
    configurationDigest: `sha256:${'f'.repeat(64)}`,
    evaluationUniverseDigest: `sha256:${'0'.repeat(64)}`,
    evaluationUniverseCount: proposal === null ? 0 : 1,
    pseudoProposalExcludedCount: 0,
    qualifiedProposals: proposal === null ? [] : [{
      proposal,
      detectorDecisionDigest: `vevidence_${'1'.repeat(64)}`,
      featureDigest: `vfeature_${'2'.repeat(64)}`,
    }],
    cutDigest: `sha256:${'3'.repeat(64)}`,
  };
}

function runtimeCut({
  atMs,
  generation,
  revision,
  monotonicNs,
  proposal = null,
}) {
  return {
    schemaVersion: 'volume.runtime.forward-detector-cut.v1',
    runtimeGeneration: generation,
    detectorTickRevision: revision,
    localReceivedAtMs: atMs,
    localMonotonicNs: String(monotonicNs),
    observerFailureCount: 0,
    sourceCut: sourceCut(atMs, proposal),
  };
}

function noOpSink(onCheckpoint) {
  return {
    rotateDetectorSegment() {},
    appendDetectorCoverage() {},
    openProposalCapture() {},
    persistRunnerCheckpoint: onCheckpoint,
    sealDetectorCapture() {},
  };
}

test('fixed owner durably records detector evidence, request, checkpoint, and resume', async () => {
  const parent = realpathSync(
    mkdtempSync(resolve(tmpdir(), 'cosmos-vi3-owner-')),
  );
  const evidenceRoot = resolve(parent, 'evidence');
  try {
    const mutableHandoff = handoffFixture(evidenceRoot);
    const policyBinding =
      await deriveAcceptedDetectorPolicyBinding(mutableHandoff);
    mutableHandoff.detector.coverageCorePolicyDigest =
      policyBinding.policyRawSha256;
    const handoff = structuredClone(mutableHandoff);
    const schedule = runnerSchedule(handoff);

    let warmupCheckpoint = null;
    const warmupRunner = createVolumeForwardMeasurementRunner({
      schedule,
      sink: noOpSink((checkpoint) => {
        warmupCheckpoint = checkpoint;
      }),
    });
    for (let offset = 0; offset < 7_200; offset += 1) {
      const atMs = WARMUP_START_MS + offset * 2_000;
      warmupRunner.observe(runtimeCut({
        atMs,
        generation: 1,
        revision: offset + 1,
        monotonicNs: 1_000_000_000n
          + BigInt(offset) * 2_000_000_000n,
      }));
    }
    assert.equal(warmupCheckpoint.checkpointRevision, 7_200);

    const owner = await createAcceptedCaptureOwner({
      handoff,
      resume: false,
    });
    owner.persistRunnerCheckpoint(warmupCheckpoint);
    const runner = createVolumeForwardMeasurementRunner({
      schedule,
      checkpoint: owner.loadRunnerCheckpoint(),
      sink: owner,
    });
    const proposal = {
      proposalId: `vvop_${'4'.repeat(64)}`,
      proposalRevision: 1,
      proposalDigest: `vproposal_${'5'.repeat(64)}`,
      symbol: 'BTCUSDT',
      correlationId: 'vs_terminal_owner_signal_0001',
    };
    assert.equal(runner.observe(runtimeCut({
      atMs: INTERVAL_START_MS,
      generation: 2,
      revision: 1,
      monotonicNs: 1n,
      proposal,
    })).state, 'CAPTURING');
    assert.equal(owner.snapshot().scheduledCaptureRequestCount, 1);
    owner.close();

    const requests = readdirSync(
      resolve(evidenceRoot, 'scheduled-public-captures'),
    );
    assert.equal(requests.length, 1);
    const request = JSON.parse(readFileSync(
      resolve(
        evidenceRoot,
        'scheduled-public-captures',
        requests[0],
      ),
      'utf8',
    ));
    assert.equal(request.state, 'SCHEDULED_PUBLIC_CAPTURE_REQUIRED');
    assert.equal(request.entryQuoteNotional, '10.00');
    assert.equal(request.publicCaptureAllowlist.authentication, 'NONE');

    const detectorFile = readdirSync(resolve(evidenceRoot, 'detector'))
      .find((name) => name.endsWith('.jsonl'));
    const verification = await parseCoreEvidenceFile(
      resolve(evidenceRoot, 'detector', detectorFile),
      {
        maximumJsonlBytes: 256 * 1024 * 1024,
        verificationProfile: 'INCOMPLETE_PRESERVATION',
      },
    );
    assert.equal(verification.verification.recordCount, 2);

    const resumedOwner = await createAcceptedCaptureOwner({
      handoff,
      resume: true,
    });
    const resumedRunner = createVolumeForwardMeasurementRunner({
      schedule,
      checkpoint: resumedOwner.loadRunnerCheckpoint(),
      sink: resumedOwner,
    });
    assert.equal(resumedRunner.observe(runtimeCut({
      atMs: INTERVAL_START_MS + 2_000,
      generation: 3,
      revision: 1,
      monotonicNs: 1n,
    })).state, 'CAPTURING');
    assert.equal(
      resumedOwner.loadRunnerCheckpoint().checkpointRevision,
      7_202,
    );
    assert.equal(
      resumedOwner.snapshot().scheduledCaptureRequestCount,
      1,
    );
    resumedOwner.close();
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

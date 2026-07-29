#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  bindAcceptedV4ScheduledCapture,
  currentV4AdapterStatus,
} from './v-i4-runtime-adapter.mjs';
import {
  buildScheduledCaptureHandoff,
  V_I3_FROZEN_TERMINAL_METRICS_POLICY_SHA256,
} from './terminal-runner.mjs';
import { buildDurableId } from './verify.mjs';

const REPOSITORY_ROOT = resolve(
  new URL('../../..', import.meta.url).pathname,
);
const ACCEPTED_V_I3_COMMIT =
  'a2754a53446aeb5ece3f490d2d72db4598e78f00';
const ACCEPTED_V_I3_TREE =
  '342479d4eb3324130dab5536cd5d05d4fb8b8f59';
const ACCEPTED_AT = '2026-08-01T00:00:00.000Z';
const V_I4_ACCEPTED_AT = '2026-08-01T00:00:01.000Z';
const WARMUP_START = '2026-08-01T20:00:00.000Z';
const INTERVAL_START = '2026-08-02T00:00:00.000Z';
const INTERVAL_END = '2026-09-01T00:00:00.000Z';
const MATURITY = '2026-09-01T00:01:02.000Z';
const PACKET_POLICY_SHA256 = 'd'.repeat(64);
const CORE_POLICY_DIGEST = `sha256:${'e'.repeat(64)}`;
const SOURCE_DIGEST = `sha256:${'f'.repeat(64)}`;
const CHAIN_KEY = `ve2_detector_coverage_${'1'.repeat(64)}`;
const README_PATH = resolve(
  REPOSITORY_ROOT,
  'quant/research/ve2/V-I4-README.md',
);
const DIRTY_SENTINEL_PATH = resolve(
  REPOSITORY_ROOT,
  'quant/research/ve2/.vi4-adapter-dirty-sentinel',
);
const METRICS_POLICY = JSON.parse(readFileSync(
  new URL('./terminal-metrics-policy.v1.json', import.meta.url),
  'utf8',
));

function git(args, encoding = 'utf8') {
  return execFileSync(
    'git',
    ['-C', REPOSITORY_ROOT, ...args],
    { encoding, stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fixtureHandoff() {
  const activationSemantic = {
    schemaVersion: 've2.capture-activation.v1',
    state: 'CAPTURE_READY_ACCEPTED',
    acceptedCaptureCandidateCommit: ACCEPTED_V_I3_COMMIT,
    acceptedAtUtc: ACCEPTED_AT,
    acceptedByIndependentExactHashReview: true,
    packetMeasurementPolicySha256: PACKET_POLICY_SHA256,
    detectorCoverageCorePolicyDigest: CORE_POLICY_DIGEST,
    detectorInputSourceId:
      'local://volume-engine/detector-evaluation-cut/v1',
    detectorInputSourceDigest: SOURCE_DIGEST,
    detectorBindingState: 'ACCEPTED_PROSPECTIVE_BINDING',
    detectorCoverageChainKey: CHAIN_KEY,
    captureImplementationSha256: 'c'.repeat(64),
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
  const activation = {
    activationId: buildDurableId(
      've2_activation_',
      activationSemantic,
    ),
    ...activationSemantic,
  };
  const vI3ChecksumFileSha256 = sha256(git([
    'show',
    `${ACCEPTED_V_I3_COMMIT}:quant/research/ve2/V-I3-SHA256SUMS`,
  ], 'buffer'));
  const acceptance = {
    schemaVersion: 'vi3.capture-ready-acceptance.v1',
    verdict: 'ACCEPT',
    independentExactHashReview: true,
    acceptedCaptureCandidateCommit: ACCEPTED_V_I3_COMMIT,
    acceptedCaptureCandidateTree: ACCEPTED_V_I3_TREE,
    directParentCommit:
      '285810ec3264a6a9edd61c283f809ae6291f1c83',
    baseMeasurementTree:
      '316b560a33477547197ece86a333f54ebc8605ef',
    acceptedAtUtc: ACCEPTED_AT,
    captureImplementationSha256: 'c'.repeat(64),
    packetMeasurementPolicySha256: PACKET_POLICY_SHA256,
    detectorCoverageCorePolicyDigest: CORE_POLICY_DIGEST,
    detectorInputSourceId:
      'local://volume-engine/detector-evaluation-cut/v1',
    detectorInputSourceDigest: SOURCE_DIGEST,
    detectorCoverageChainKey: CHAIN_KEY,
    terminalMetricsPolicySha256:
      V_I3_FROZEN_TERMINAL_METRICS_POLICY_SHA256,
    vI3ChecksumFileSha256,
    outcomeBytesAccessed: false,
  };
  const acceptanceReceiptUtf8 = jsonBytes(acceptance);
  return buildScheduledCaptureHandoff({
    acceptanceReceiptUtf8,
    expectedAcceptanceReceiptSha256:
      sha256(Buffer.from(acceptanceReceiptUtf8, 'utf8')),
    activation,
    evidenceRoot: resolve(tmpdir(), 'vi4-adapter-test-evidence'),
    terminalMetricsPolicy: METRICS_POLICY,
  });
}

function currentCandidateReceipt() {
  const head = git(['rev-parse', 'HEAD']).trim();
  const tree = git(['rev-parse', 'HEAD^{tree}']).trim();
  const checksumBytes = readFileSync(
    new URL('./V-I4-SHA256SUMS', import.meta.url),
  );
  return {
    schemaVersion: 'vi4.capture-scheduler-acceptance.v1',
    verdict: 'ACCEPT',
    independentExactHashReview: true,
    acceptedSchedulerCandidateCommit: head,
    acceptedSchedulerCandidateTree: tree,
    directParentCommit: ACCEPTED_V_I3_COMMIT,
    directParentTree: ACCEPTED_V_I3_TREE,
    acceptedAtUtc: V_I4_ACCEPTED_AT,
    vI4ChecksumFileSha256: sha256(checksumBytes),
    outcomeBytesAccessed: false,
    executionAuthority: 'NONE',
  };
}

function armedCaptureFixture(
  handoff,
  {
    runtimeGeneration = null,
    recordedWarmupCutCount = 0,
    recordedDetectorCutCount = 0,
    captureGeneration =
      runtimeGeneration === null ? 1 : runtimeGeneration + 1,
  } = {},
) {
  const state =
    recordedWarmupCutCount + recordedDetectorCutCount === 0
      ? 'SCHEDULED'
      : recordedDetectorCutCount === 0
      ? 'WARMING'
      : 'CAPTURING';
  const runnerSnapshot = Object.freeze({
    state,
    activationId: handoff.activation.activationId,
    recordedWarmupCutCount,
    expectedWarmupCutCount: 7_200,
    recordedDetectorCutCount,
    expectedDetectorCutCount: 1_296_031,
    runtimeGeneration,
  });
  let closeCount = 0;
  const observe = () => {};
  const advanceTime = () => {};
  const snapshot = () => runnerSnapshot;
  const close = () => {
    closeCount += 1;
  };
  return {
    armed: Object.freeze({
      schemaVersion: 'vi3.armed-public-terminal-runner.v1',
      handoffId: handoff.handoffId,
      evidenceRoot: handoff.evidenceRoot,
      captureGeneration,
      volumeRuntimeOptions: Object.freeze({
        forwardMeasurementObserver: observe,
        forwardMeasurementRuntimeGeneration: captureGeneration,
      }),
      observe,
      advanceTime,
      checkpoint: () => null,
      snapshot,
      ownerSnapshot: () => ({}),
      close,
    }),
    observe,
    close,
    closeCount: () => closeCount,
  };
}

function bindingInput({
  receipt = currentCandidateReceipt(),
  handoff = fixtureHandoff(),
  armedFixture = armedCaptureFixture(handoff),
} = {}) {
  const acceptanceReceiptUtf8 = jsonBytes(receipt);
  const handoffUtf8 = jsonBytes(handoff);
  return {
    acceptanceReceiptUtf8,
    expectedAcceptanceReceiptSha256:
      sha256(Buffer.from(acceptanceReceiptUtf8, 'utf8')),
    handoffUtf8,
    expectedHandoffSha256:
      sha256(Buffer.from(handoffUtf8, 'utf8')),
    armedV3Capture: armedFixture.armed,
  };
}

const FROZEN_DIRECT_SUCCESSOR_READY =
  git(['rev-parse', 'HEAD^']).trim() === ACCEPTED_V_I3_COMMIT
  && git([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]).trim() === '';
const FROZEN_TEST_SKIP = FROZEN_DIRECT_SUCCESSOR_READY
  ? false
  : 'requires the clean frozen direct-successor V-I4 commit';

test('adapter is inert and truthful until both acceptances are supplied', async () => {
  assert.deepEqual(currentV4AdapterStatus(), {
    schemaVersion: 'vi4.runtime-adapter-status.v1',
    state: 'PROSPECTIVE_NOT_ACTIVATED',
    reasonCode: 'VI4_ACCEPTANCE_AND_ARMED_VI3_CAPTURE_REQUIRED',
    consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
    profitabilityClaim: false,
    executionAuthority: 'NONE',
  });
  await assert.rejects(
    bindAcceptedV4ScheduledCapture({
      acceptanceReceiptUtf8: '{}',
      expectedAcceptanceReceiptSha256: '0'.repeat(64),
      handoffUtf8: '{}',
      expectedHandoffSha256: '0'.repeat(64),
      armedV3Capture: {},
    }),
    /VI4_ADAPTER_ACCEPTANCE_RECEIPT_CUSTODY/,
  );
});

test('hostile V-I4 receipt shapes and authority claims fail before binding', async () => {
  const receipt = currentCandidateReceipt();
  for (const hostile of [
    { ...receipt, extra: true },
    { ...receipt, independentExactHashReview: false },
    { ...receipt, verdict: 'REJECT' },
    { ...receipt, directParentTree: '0'.repeat(40) },
    { ...receipt, outcomeBytesAccessed: true },
    { ...receipt, executionAuthority: 'ORDER' },
  ]) {
    const acceptanceReceiptUtf8 = jsonBytes(hostile);
    await assert.rejects(
      bindAcceptedV4ScheduledCapture({
        acceptanceReceiptUtf8,
        expectedAcceptanceReceiptSha256:
          sha256(Buffer.from(acceptanceReceiptUtf8, 'utf8')),
        handoffUtf8: '{}',
        expectedHandoffSha256: sha256('{}'),
        armedV3Capture: {},
      }),
      /VI4_ADAPTER_ACCEPTANCE_RECEIPT_(?:SHAPE|INVALID)/,
    );
  }
});

test('accepted adapter maps the V-I3 armed contract and its real close seam exactly', {
  skip: FROZEN_TEST_SKIP,
}, async () => {
  const handoff = fixtureHandoff();
  const armedFixture = armedCaptureFixture(handoff);
  const acceptedV3RunnerSource = git([
    'show',
    `${ACCEPTED_V_I3_COMMIT}:quant/research/ve2/terminal-runner.mjs`,
  ]);
  assert.match(
    acceptedV3RunnerSource,
    /schemaVersion: 'vi3\.armed-public-terminal-runner\.v1'/,
  );
  assert.match(
    acceptedV3RunnerSource,
    /forwardMeasurementObserver: observe/,
  );
  assert.match(
    acceptedV3RunnerSource,
    /close: \(\) => owner\.close\(\)/,
  );
  const binding = await bindAcceptedV4ScheduledCapture(
    bindingInput({ handoff, armedFixture }),
  );

  assert.equal(binding.state, 'ACCEPTED_READY_NOT_STARTED');
  assert.equal(binding.profitabilityClaim, false);
  assert.equal(binding.executionAuthority, 'NONE');
  assert.deepEqual(
    binding.volumeRuntimeOptions.forwardMeasurementActivation,
    {
      schemaVersion: 'volume.forward.capture-activation.v1',
      captureEnabled: true,
      activationId: handoff.activation.activationId,
      runtimeGeneration: 1,
      resume: false,
      warmupStartMs: Date.parse(WARMUP_START),
      maturityAtMs: Date.parse(MATURITY),
      detectorCadenceMs: 2_000,
    },
  );
  assert.equal(
    binding.volumeRuntimeOptions.forwardMeasurementCapture.observe,
    armedFixture.observe,
  );
  assert.equal(
    binding.volumeRuntimeOptions.forwardMeasurementCapture.close,
    armedFixture.close,
  );
  binding.volumeRuntimeOptions.forwardMeasurementCapture.close();
  assert.equal(armedFixture.closeCount(), 1);
});

test('accepted-candidate receipt rejects wrong tree and checksum custody', {
  skip: FROZEN_TEST_SKIP,
}, async () => {
  await assert.rejects(
    bindAcceptedV4ScheduledCapture(bindingInput({
      receipt: {
        ...currentCandidateReceipt(),
        acceptedSchedulerCandidateTree: '0'.repeat(40),
      },
    })),
    /VI4_ADAPTER_ACCEPTED_CANDIDATE_LINEAGE_MISMATCH/,
  );
  await assert.rejects(
    bindAcceptedV4ScheduledCapture(bindingInput({
      receipt: {
        ...currentCandidateReceipt(),
        vI4ChecksumFileSha256: '0'.repeat(64),
      },
    })),
    /VI4_ADAPTER_ACCEPTED_CHECKSUM_CUSTODY/,
  );
});

test('handoff custody rejects wrong raw hashes and semantic rewrites', {
  skip: FROZEN_TEST_SKIP,
}, async () => {
  const handoff = fixtureHandoff();
  const exact = bindingInput({ handoff });
  await assert.rejects(
    bindAcceptedV4ScheduledCapture({
      ...exact,
      expectedHandoffSha256: '0'.repeat(64),
    }),
    /VI4_ADAPTER_HANDOFF_CUSTODY/,
  );

  const rewritten = structuredClone(handoff);
  rewritten.evidenceRoot = resolve(
    tmpdir(),
    'vi4-adapter-rewritten-evidence',
  );
  await assert.rejects(
    bindAcceptedV4ScheduledCapture(
      bindingInput({ handoff: rewritten }),
    ),
    /VI3_HANDOFF_(?:INVALID|DURABLE_ID)/,
  );
});

test('resume binding requires the exact next V-I3 capture generation', {
  skip: FROZEN_TEST_SKIP,
}, async () => {
  const handoff = fixtureHandoff();
  const resumed = armedCaptureFixture(handoff, {
    runtimeGeneration: 4,
    recordedWarmupCutCount: 1,
    captureGeneration: 5,
  });
  const binding = await bindAcceptedV4ScheduledCapture(
    bindingInput({ handoff, armedFixture: resumed }),
  );
  assert.equal(
    binding.volumeRuntimeOptions.forwardMeasurementActivation.resume,
    true,
  );
  assert.equal(
    binding.volumeRuntimeOptions.forwardMeasurementActivation
      .runtimeGeneration,
    5,
  );

  const stale = armedCaptureFixture(handoff, {
    runtimeGeneration: 4,
    recordedWarmupCutCount: 1,
    captureGeneration: 4,
  });
  await assert.rejects(
    bindAcceptedV4ScheduledCapture(
      bindingInput({ handoff, armedFixture: stale }),
    ),
    /VI4_ADAPTER_ARMED_CAPTURE_CURSOR_MISMATCH/,
  );
});

test('adapter rejects unclean and current-byte-drifted V-I4 worktrees', {
  skip: FROZEN_TEST_SKIP,
}, async () => {
  const exact = bindingInput();
  writeFileSync(
    DIRTY_SENTINEL_PATH,
    'hostile untracked custody fixture\n',
    { encoding: 'utf8', flag: 'wx' },
  );
  try {
    await assert.rejects(
      bindAcceptedV4ScheduledCapture(exact),
      /VI4_ADAPTER_WORKTREE_NOT_CLEAN/,
    );
  } finally {
    unlinkSync(DIRTY_SENTINEL_PATH);
  }

  const exactReadme = readFileSync(README_PATH);
  writeFileSync(
    README_PATH,
    Buffer.concat([
      exactReadme,
      Buffer.from('\nhostile-current-drift\n', 'utf8'),
    ]),
  );
  try {
    await assert.rejects(
      bindAcceptedV4ScheduledCapture(exact),
      /VI4_ADAPTER_CURRENT_DEPENDENCY_DRIFT:quant\/research\/ve2\/V-I4-README\.md/,
    );
  } finally {
    writeFileSync(README_PATH, exactReadme);
  }
});

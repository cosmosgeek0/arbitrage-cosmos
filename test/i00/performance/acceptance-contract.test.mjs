import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CANONICAL_SYSTEM_COMPONENT_IDS,
  CANONICAL_SYSTEM_COMPONENT_OWNERS,
  I00_MANAGED_INVENTORY_EXPECTATIONS,
  PRODUCT_RUNTIME_CONTROL_EXPECTATIONS,
  PROTECTED_OWNER_DIRECTIVES,
  Q_DONOR_SHA,
  Q_DONOR_TREE,
  Q_RECEIPT_SHA256,
  sha256,
} from './contract.mjs';
import {
  ACCEPTANCE_PLAN,
  EXPECTED_CANDIDATE_LIMITATIONS,
  EXPECTED_DIRECTOR_DISPOSITIONS,
  EXPECTED_ACCEPTED_DONORS,
  Q_ARCHIVE_REQUIRED_FILES,
  Q_DONOR_ARCHIVE_ARGS,
  assertCurrentQuantGatePassed,
  buildIntegrationCandidateReceiptDocument,
  classifyReceiptProvenanceDiagnostic,
  executeCurrentQuantGate,
  parseOptions,
  readPerformanceReceiptAfterChild,
  realTemporaryRoot,
  renderIntegrationCandidateReceiptMarkdown,
  validateCandidateSealTopologyDocument,
  validateCompleteReceiptDocument,
  validateDetachedCandidateWorktreeDocument,
  validateIntegrationCandidateReceiptMarkdown,
  validateProofCatalogSealBindingDocuments,
  validateQArchiveInventory,
  superviseQArchiveChildren,
  validateSealEvidencePathBinding,
  validateWorkingSealPathSet,
  verifyCandidateHeadReportParityRegression,
} from './local-acceptance.mjs';
import { EXPECTED_EXCLUSIONS, PHASE2_GRAPH_BOUNDARY } from '../donor-equality.mjs';

const CANDIDATE = 'a'.repeat(40);
const CANDIDATE_TREE = 'b'.repeat(40);
const SEAL = 'c'.repeat(40);
const DIGEST = 'd'.repeat(64);
const PROOF_CONTROL_ROWS = JSON.parse(readFileSync(
  new URL('../../../fixtures/i00/proof-catalog.json', import.meta.url),
  'utf8',
)).controls;

test('acceptance temporary roots resolve a symlinked parent to its physical path', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'i00-real-temp-root-'));
  try {
    const physical = path.join(root, 'physical');
    const alias = path.join(root, 'alias');
    mkdirSync(physical);
    symlinkSync(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(realTemporaryRoot(alias), realpathSync(physical));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed performance child writes a bounded diagnostic and preserves its final line', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'i00-soak-failure-'));
  try {
    const evidenceRoot = path.join(root, 'evidence');
    mkdirSync(evidenceRoot);
    const runId = '20260722000000000-1';
    const finalLine = 'LOCAL_PROXY_SOAK_FAILED:EXPECTED_CHILD_LINE';
    const outputTail = Buffer.concat([
      Buffer.alloc(70 * 1024, 0x61),
      Buffer.from(`\n${finalLine}\n`),
    ]);
    assert.throws(
      () => readPerformanceReceiptAfterChild({
        result: { passed: false, exitCode: 1, exitSignal: null },
        runId,
        performancePath: path.join(evidenceRoot, 'absent.json'),
        outputTail,
        evidenceRoot,
      }),
      (error) => error instanceof Error && error.message === finalLine,
    );
    const diagnosticPath = path.join(evidenceRoot, `soak-failure-${runId}.log`);
    const diagnostic = readFileSync(diagnosticPath);
    assert.ok(statSync(diagnosticPath).size <= 64 * 1024);
    assert.equal(diagnostic.toString('utf8').endsWith(`${finalLine}\n`), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function managedInventoryFixture() {
  const entries = I00_MANAGED_INVENTORY_EXPECTATIONS.map((expected) => ({
    identity: expected.identity,
    owner: expected.owner,
    canonicalComponentIds: [...expected.canonicalComponentIds],
    inventoryState: expected.inventoryState,
    evidence: expected.canonicalComponentIds.length === 0 ? null : expected.canonicalComponentIds.map((componentId) => ({
      source: 'PRODUCT_RUNTIME_COMPONENT_PROJECTION',
      componentId,
      componentProjectionIndex: CANONICAL_SYSTEM_COMPONENT_IDS.indexOf(componentId),
    })),
    reasonCode: expected.reasonCode,
  }));
  return {
    schemaVersion: 'i00-managed-inventory.v1', expectedIdentityCount: 33, mappedIdentityCount: 14,
    evidencePresentCount: 14, ownerGatedCount: 13, notConfiguredCount: 3, missingCount: 3,
    canonicalComponentCount: 14, referencedCanonicalComponentCount: 14, observedCanonicalComponentCount: 14,
    entries,
  };
}

function canonicalComponentsFixture() {
  return CANONICAL_SYSTEM_COMPONENT_IDS.map((componentId, index) => ({
    componentId,
    owner: CANONICAL_SYSTEM_COMPONENT_OWNERS[index],
    observedLifecycle: 'BLOCKED',
    capability: 'UNAVAILABLE',
    blocker: `BLOCKER_${index}`,
  }));
}

function productControlsFixture() {
  return PRODUCT_RUNTIME_CONTROL_EXPECTATIONS.map((expected) => ({
    ...expected,
    wiringState: 'WIRED_LIVE',
    owner: 'systemIntegration.canonical-control-service',
    authority: 'SERVER_DERIVED_OPERATOR',
    disabledReason: null,
  }));
}

function controlCatalogFixture() {
  return {
    sourcePath: 'fixtures/i00/proof-catalog.json',
    candidateSha256: 'e'.repeat(64),
    sealSha256: 'f'.repeat(64),
    declaredCount: 14,
    wiredSourceCount: 5,
    notConfiguredCount: 8,
    ownerGatedCount: 1,
    rows: structuredClone(PROOF_CONTROL_ROWS),
  };
}

function externalBoundaryFixture() {
  return {
    privateReads: 'OWNER_GATED_NOT_RUN',
    signedCalls: 'OWNER_GATED_NOT_RUN',
    awsCloudflare: 'OWNER_GATED_NOT_RUN',
    deployPush: 'NOT_RUN',
    moneyPaths: 'FORBIDDEN_NOT_RUN',
  };
}

function commandResultsFixture() {
  return ACCEPTANCE_PLAN.map((plan, index) => ({
    id: plan.id,
    command: plan.kind === 'PERFORMANCE'
        ? [process.execPath, 'test/i00/performance/local-proxy-soak.mjs', '--run', `--tested-sha=${CANDIDATE}`, '--duration-seconds=60', '--out=local-proxy-performance-20260714000000000-1.json']
        : [...plan.command],
    exitCode: 0,
    exitSignal: null,
    durationMs: index + 1,
    stdoutBytes: index + 10,
    stderrBytes: 0,
    stdoutSha256: String((index % 8) + 1).repeat(64),
    stderrSha256: '0'.repeat(64),
    parsedCounts: {},
    passed: true,
  }));
}

function donorProofFixture() {
  const ids = EXPECTED_ACCEPTED_DONORS.map((entry) => entry.id);
  const body = {
    schemaVersion: 'I00_DONOR_EQUALITY_PROOF_V1',
    status: 'PASS',
    candidate: { sha: CANDIDATE, tree: CANDIDATE_TREE, objectType: 'commit' },
    counts: { expected: 16, discovered: 16, accepted: 16, integrated: 16 },
    exactSets: { expected: [...ids], discovered: [...ids], accepted: [...ids], integrated: [...ids] },
    integrationOrder: {
      expected: [...ids],
      pairs: ids.slice(0, -1).map((id, index) => ({ before: id, after: ids[index + 1], isAncestor: true })),
    },
    mergeWindow: {
      start: '1'.repeat(40),
      observedSequence: Array.from({ length: 16 }, (_, index) => String((index % 8) + 1).repeat(40)),
      permittedNonDonor: {},
      authorizedLaterMerges: [...PHASE2_GRAPH_BOUNDARY.authorizedLaterMerges],
      laterMerges: [...PHASE2_GRAPH_BOUNDARY.authorizedLaterMerges],
    },
    requiredLast: {
      merge: PHASE2_GRAPH_BOUNDARY.requiredLastMerge,
      firstParent: PHASE2_GRAPH_BOUNDARY.requiredLastFirstParent,
      donor: PHASE2_GRAPH_BOUNDARY.requiredLastDonor,
      authorizedLaterMerges: [...PHASE2_GRAPH_BOUNDARY.authorizedLaterMerges],
      postLTopologyExact: true,
    },
    donors: EXPECTED_ACCEPTED_DONORS.map((entry) => ({
      id: entry.id,
      discovered: true,
      accepted: true,
      integrated: true,
      tip: {},
      worktree: {},
      acceptanceReceipts: [],
      integration: {},
    })),
    exclusions: EXPECTED_EXCLUSIONS.map((entry) => ({
      id: entry.id,
      tip: { sha: entry.tipSha, observedTree: entry.treeSha },
      worktree: { ...entry.worktree },
      disposition: entry.disposition,
      excluded: true,
    })),
    failures: [],
  };
  return { ...body, proofSha256: sha256(JSON.stringify(body)) };
}

function rehashDonorProof(document) {
  const body = structuredClone(document.donorProof);
  delete body.proofSha256;
  document.donorProof.proofSha256 = sha256(JSON.stringify(body));
}

function topologyDocument() {
  return {
    candidateSha: CANDIDATE,
    candidateTreeSha: CANDIDATE_TREE,
    worktreeHeadSha: CANDIDATE,
    sealHeadSha: SEAL,
    sealParents: [CANDIDATE],
    commitCount: 1,
    directChildren: [SEAL],
    diffPaths: [
      'I00_PRODUCT_BUILD_STATE.md',
      'STATE.md',
      'docs/archive/i00-phase2/INTEGRATION_CANDIDATE_READY_RECEIPT.md',
      'fixtures/i00/proof-catalog.json',
      'test/i00/performance/evidence/browser/receipt.json',
      'test/i00/performance/evidence/complete.json',
      'test/i00/performance/evidence/performance.json',
    ],
  };
}

function proofCatalogDocuments() {
  const candidate = {
    schemaVersion: 2,
    packet: 'I00_PHASE2_CLOSURE',
    targetState: 'CANDIDATE_SOURCE_FROZEN',
    base: {
      branch: 'i00-product-assembly-20260713',
      head: CANDIDATE,
      tree: CANDIDATE_TREE,
      donorEquality: '16/16/16/16',
      candidateCommit: null,
    },
    canonicalRoutes: [{ method: 'GET', route: '/api/product-integration/v1/commands/:commandId/results/:identityKey' }],
    controls: structuredClone(PROOF_CONTROL_ROWS),
  };
  const seal = structuredClone(candidate);
  seal.base.candidateCommit = CANDIDATE;
  return { candidate, seal };
}

function candidateReceiptFixture() {
  const donorProof = donorProofFixture();
  const performanceReceipt = {
    relativePath: 'test/i00/performance/evidence/performance.json',
    sha256: '1'.repeat(64),
    byteLength: 101,
    overall: 'PASS',
    canonicalRuntimeEvidence: {
      managedInventory: managedInventoryFixture(),
      canonicalComponents: canonicalComponentsFixture(),
      productControls: productControlsFixture(),
    },
    passed: true,
  };
  const browserReceipt = {
    relativePath: 'test/i00/performance/evidence/browser/receipt.json',
    sha256: '2'.repeat(64),
    byteLength: 202,
    runCount: 6,
    routeCaptureCount: 126,
    artifactCount: 194,
    restart: {
      performed: true,
      webSocketClose1012Observed: true,
      postRestartRendered: true,
    },
    passed: true,
  };
  const completeReceipt = {
    relativePath: 'test/i00/performance/evidence/complete.json',
    sha256: '3'.repeat(64),
    byteLength: 303,
    stepCount: ACCEPTANCE_PLAN.length,
    passedStepCount: ACCEPTANCE_PLAN.length,
    failedStepCount: 0,
    commandResults: commandResultsFixture(),
    externalBoundary: externalBoundaryFixture(),
    passed: true,
  };
  const controlCatalog = controlCatalogFixture();
  const limitationSource = {
    sourcePath: 'fixtures/i00/closure-evidence.json',
    sealSha256: '9'.repeat(64),
    normalization: 'A_FORMAL_AND_A_ACTION_EVIDENCE_S2_POSTLANDING_EXCLUDED',
    entryCount: EXPECTED_CANDIDATE_LIMITATIONS.length,
  };
  const sourceManifest = {
    format: 'GIT_BLOBS_PLUS_PROTECTED_OWNER_DIRECTIVE_HASHES_V2',
    fileCount: 1_999,
    sha256: '4'.repeat(64),
    protectedOwnerDirectives: PROTECTED_OWNER_DIRECTIVES.map((entry) => ({ ...entry })),
  };
  const evidenceEntries = [
    { relativePath: browserReceipt.relativePath, sha256: browserReceipt.sha256, byteLength: browserReceipt.byteLength },
    { relativePath: completeReceipt.relativePath, sha256: completeReceipt.sha256, byteLength: completeReceipt.byteLength },
    { relativePath: performanceReceipt.relativePath, sha256: performanceReceipt.sha256, byteLength: performanceReceipt.byteLength },
  ].toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
  const evidenceManifest = { entries: evidenceEntries, sha256: sha256(JSON.stringify(evidenceEntries)) };
  const limitations = EXPECTED_CANDIDATE_LIMITATIONS.map((entry) => ({ ...entry }));
  const expected = {
    candidateSha: CANDIDATE,
    candidateTreeSha: CANDIDATE_TREE,
    donorProof,
    performanceReceipt,
    browserReceipt,
    completeReceipt,
    controlCatalog,
    limitationSource,
    sourceManifest,
    evidenceManifest,
  };
  const document = buildIntegrationCandidateReceiptDocument({ ...expected, limitations });
  return { document, expected };
}

function completeFixture() {
  const performanceReceipt = {
    relativePath: 'test/i00/performance/evidence/performance.json',
    sha256: '1'.repeat(64),
    byteLength: 101,
    passed: true,
  };
  const browserReceipt = {
    relativePath: 'test/i00/performance/evidence/browser/receipt.json',
    sha256: '2'.repeat(64),
    byteLength: 202,
    passed: true,
  };
  const candidateManifest = {
    format: 'GIT_BLOBS_PLUS_PROTECTED_OWNER_DIRECTIVE_HASHES_V2',
    fileCount: 1_999,
    sha256: '3'.repeat(64),
    protectedOwnerDirectives: PROTECTED_OWNER_DIRECTIVES.map((entry) => ({ ...entry })),
  };
  const initialEntries = [{
    relativePath: browserReceipt.relativePath,
    sha256: browserReceipt.sha256,
    byteLength: browserReceipt.byteLength,
  }];
  const initialEvidence = { entries: initialEntries, sha256: sha256(JSON.stringify(initialEntries)) };
  const commandResults = commandResultsFixture();
  const steps = ACCEPTANCE_PLAN.map((plan, index) => {
    const command = plan.kind === 'PERFORMANCE'
        ? [process.execPath, 'test/i00/performance/local-proxy-soak.mjs', '--run', `--tested-sha=${CANDIDATE}`, '--duration-seconds=60', '--out=local-proxy-performance-20260714000000000-1.json']
        : [...plan.command];
    return {
      id: plan.id,
      command,
      exitCode: 0,
      exitSignal: null,
      timedOut: false,
      outputOverflow: false,
      durationMs: commandResults[index].durationMs,
      stdoutBytes: commandResults[index].stdoutBytes,
      stderrBytes: commandResults[index].stderrBytes,
      stdoutSha256: commandResults[index].stdoutSha256,
      stderrSha256: commandResults[index].stderrSha256,
      parsedCounts: { ...commandResults[index].parsedCounts },
      secretFindings: [],
      passed: true,
      ...(plan.id === 'source_freeze' ? {
        initial: { ...candidateManifest },
        final: { ...candidateManifest },
        initialEvidence: { ...initialEvidence },
        finalInitialEvidence: { ...initialEvidence },
        performanceEvidence: {
          entries: [{
            relativePath: performanceReceipt.relativePath,
            sha256: performanceReceipt.sha256,
            byteLength: performanceReceipt.byteLength,
          }],
          sha256: sha256(JSON.stringify([{
            relativePath: performanceReceipt.relativePath,
            sha256: performanceReceipt.sha256,
            byteLength: performanceReceipt.byteLength,
          }])),
        },
      } : {}),
    };
  });
  const document = {
    schemaVersion: 'i00.local-acceptance.v1',
    truthClass: 'LOCAL_COMPLETE_ACCEPTANCE_MEASURED',
    source: {
      branch: 'i00-product-assembly-20260713',
      headSha: CANDIDATE,
      treeSha: CANDIDATE_TREE,
    },
    sourceFreeze: {
      ...candidateManifest,
      evidence: { ...initialEvidence },
      protectedOwnerDirectives: PROTECTED_OWNER_DIRECTIVES.map((entry) => ({
        ...entry,
        gitStatus: 'UNTRACKED_PROTECTED_OWNER_INPUT',
      })),
    },
    qExactDonor: {
      donorSha: Q_DONOR_SHA,
      donorTree: Q_DONOR_TREE,
      receiptSha256: Q_RECEIPT_SHA256,
      venv: {
        resolvedPathSha256: '5'.repeat(64),
        pythonSha256: '6'.repeat(64),
        integrity: {
          implementation: 'CPython',
          pythonVersion: '3.13.14',
          pyprojectSha256: 'a4d68e05b607e60a99fa3856ed8f8cd3addc80998c65ca6d458118745970ca81',
          uvLockSha256: '716a9d0208f449bba51cde7fd67f9c90206ab0724aeac86ba862e119be859d29',
          manifestSha256: 'b83ef8e8be73d5a98bae3309649531136890444edd81b71fe3b503feb6fdbc0e',
          distributionCount: 17,
          pipCheck: {
            exitCode: 0,
            stdoutSha256: '7'.repeat(64),
            stderrSha256: '8'.repeat(64),
            passed: true,
          },
          pytestPluginPolicy: {
            autoLoad: 'DISABLED',
            explicit: ['_hypothesis_pytestplugin', 'pytest_cov.plugin'],
          },
        },
      },
    },
    uv: {
      resolvedPathSha256: '9'.repeat(64),
      binarySha256: 'a'.repeat(64),
    },
    plan: ACCEPTANCE_PLAN.map((plan) => ({ ...plan })),
    steps,
    missingSteps: [],
    performanceReceipt: { ...performanceReceipt },
    browserReceipt: { ...browserReceipt },
    externalBoundary: {
      privateReads: 'OWNER_GATED_NOT_RUN',
      signedCalls: 'OWNER_GATED_NOT_RUN',
      awsCloudflare: 'OWNER_GATED_NOT_RUN',
      deployPush: 'NOT_RUN',
      moneyPaths: 'FORBIDDEN_NOT_RUN',
    },
    secretScan: { findings: [], passed: true },
    passed: true,
  };
  return { document, performanceReceipt, browserReceipt, candidateManifest, initialEvidence };
}

test('exact Q donor archive preserves the complete accepted repository root', () => {
  assert.equal(Object.isFrozen(Q_DONOR_ARCHIVE_ARGS), true);
  assert.deepEqual(Q_DONOR_ARCHIVE_ARGS, [
    'archive',
    '--format=tar',
    Q_DONOR_SHA,
  ]);
  assert.equal(Q_DONOR_ARCHIVE_ARGS.includes('quant'), false);
  const expected = Q_ARCHIVE_REQUIRED_FILES.map((entry) => ({
    path: entry.path,
    mode: '100644',
    type: 'blob',
  }));
  const observed = Q_ARCHIVE_REQUIRED_FILES.map((entry) => ({
    path: entry.path,
    kind: 'REGULAR',
    mode: '100644',
    sha256: entry.sha256,
  }));
  assert.equal(validateQArchiveInventory(expected, observed).passed, true);

  const tampered = structuredClone(observed);
  tampered[0].sha256 = '0'.repeat(64);
  const tamperedValidation = validateQArchiveInventory(expected, tampered);
  assert.equal(tamperedValidation.passed, false);
  assert.ok(tamperedValidation.failures.includes(`Q_ARCHIVE_REQUIRED_ENTRY_HASH_MISMATCH:${tampered[0].path}`));
});

test('a current quant uv-lock failure fails the complete acceptance chain before later steps', async () => {
  const calls = [];
  const failed = await executeCurrentQuantGate({ PATH: '/usr/bin' }, async (request) => {
    calls.push(request);
    return {
      id: request.id,
      command: request.command,
      exitCode: 1,
      exitSignal: null,
      timedOut: false,
      outputOverflow: false,
      stderrBytes: 29,
      stderrSha256: sha256('uv-lock:UV_EXECUTABLE_MISSING'),
      parsedCounts: { uvLockFailures: [1] },
      passed: false,
    };
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'q_current_gate');
  assert.deepEqual(calls[0].command, ['node', 'test/run-quant-gates.mjs']);
  assert.equal(path.relative(path.resolve(import.meta.dirname, '../../..'), calls[0].cwd), '');
  assert.throws(() => assertCurrentQuantGatePassed([failed]), /Q_CURRENT_GATE_FAILED/);

  const passed = { ...failed, exitCode: 0, passed: true };
  assert.equal(assertCurrentQuantGatePassed([passed]), passed);
});

test('Q archive child supervision fails boundedly and tears down the peer', async () => {
  const child = () => {
    const process = new EventEmitter();
    process.exitCode = null;
    process.signalCode = null;
    process.kills = [];
    process.kill = (signal) => {
      process.kills.push(signal);
      return true;
    };
    return process;
  };

  const archiveStartFailure = child();
  const unpackPeer = child();
  const startFailure = superviseQArchiveChildren({
    archive: archiveStartFailure,
    unpack: unpackPeer,
    timeoutMs: 100,
    errorText: () => '',
  });
  archiveStartFailure.emit('error', Object.assign(new Error('spawn denied'), { code: 'EACCES' }));
  await assert.rejects(startFailure, /Q_ARCHIVE_EXTRACTION_FAILED/);
  assert.deepEqual(unpackPeer.kills, ['SIGTERM']);

  const archivePeer = child();
  const unpackStartFailure = child();
  const reverseStartFailure = superviseQArchiveChildren({
    archive: archivePeer,
    unpack: unpackStartFailure,
    timeoutMs: 100,
    errorText: () => '',
  });
  unpackStartFailure.emit('error', Object.assign(new Error('spawn denied'), { code: 'EACCES' }));
  await assert.rejects(reverseStartFailure, /Q_ARCHIVE_EXTRACTION_FAILED/);
  assert.deepEqual(archivePeer.kills, ['SIGTERM']);

  const stalledArchive = child();
  const stalledUnpack = child();
  await assert.rejects(
    superviseQArchiveChildren({
      archive: stalledArchive,
      unpack: stalledUnpack,
      timeoutMs: 5,
      errorText: () => '',
    }),
    /Q_ARCHIVE_EXTRACTION_TIMEOUT/,
  );
  assert.deepEqual(stalledArchive.kills, ['SIGTERM']);
  assert.deepEqual(stalledUnpack.kills, ['SIGTERM']);
});

test('validate-only requires an explicit exact candidate SHA', () => {
  const parsed = parseOptions(['--validate-only', `--candidate-sha=${CANDIDATE}`, `--seal-sha=${SEAL}`]);
  assert.equal(parsed.mode, 'VALIDATE_ONLY');
  assert.equal(parsed.candidateSha, CANDIDATE);
  assert.equal(parsed.sealSha, SEAL);
  const render = parseOptions(['--render-candidate-receipt', `--candidate-sha=${CANDIDATE}`, `--seal-sha=${SEAL}`]);
  assert.equal(render.mode, 'RENDER_CANDIDATE_RECEIPT');
  const uvPath = path.join(os.tmpdir(), 'uv');
  const run = parseOptions(['--run', `--uv=${uvPath}`]);
  assert.equal(run.uv, uvPath);
  assert.throws(() => parseOptions(['--candidate-sha']), /MISSING_ARGUMENT_VALUE/);
});

test('candidate seal topology accepts one evidence-only child and rejects source or topology drift', () => {
  const valid = topologyDocument();
  assert.equal(validateCandidateSealTopologyDocument(valid).passed, true);

  const sourceMutation = structuredClone(valid);
  sourceMutation.diffPaths.push('server/src/index.ts');
  assert.ok(validateCandidateSealTopologyDocument(sourceMutation).failures.includes('SEAL_PATH_SET_INVALID'));

  const missingReceipt = structuredClone(valid);
  missingReceipt.diffPaths = missingReceipt.diffPaths.filter((entry) => !entry.endsWith('INTEGRATION_CANDIDATE_READY_RECEIPT.md'));
  assert.ok(validateCandidateSealTopologyDocument(missingReceipt).failures.includes('SEAL_REQUIRED_PATH_MISSING'));

  const mergeSeal = structuredClone(valid);
  mergeSeal.sealParents.push('e'.repeat(40));
  assert.ok(validateCandidateSealTopologyDocument(mergeSeal).failures.includes('SEAL_PARENT_INVALID'));

  const worktreeOnSeal = structuredClone(valid);
  worktreeOnSeal.worktreeHeadSha = SEAL;
  assert.ok(validateCandidateSealTopologyDocument(worktreeOnSeal).failures.includes('CANDIDATE_WORKTREE_HEAD_INVALID'));

  const extraChild = structuredClone(valid);
  extraChild.directChildren.push('e'.repeat(40));
  assert.ok(validateCandidateSealTopologyDocument(extraChild).failures.includes('SEAL_SOLE_CHILD_INVALID'));

  const missingChild = structuredClone(valid);
  missingChild.directChildren = [];
  assert.ok(validateCandidateSealTopologyDocument(missingChild).failures.includes('SEAL_SOLE_CHILD_INVALID'));

  const wrongSeal = structuredClone(valid);
  wrongSeal.sealHeadSha = 'f'.repeat(40);
  assert.ok(validateCandidateSealTopologyDocument(wrongSeal).failures.includes('SEAL_SOLE_CHILD_INVALID'));

  const unapprovedClosureFixture = structuredClone(valid);
  unapprovedClosureFixture.diffPaths.push('fixtures/i00/unapproved-seal-mutation.json');
  assert.ok(validateCandidateSealTopologyDocument(unapprovedClosureFixture).failures.includes('SEAL_PATH_SET_INVALID'));

  const boundEvidence = valid.diffPaths.filter((relativePath) => relativePath.startsWith('test/i00/performance/evidence/'));
  assert.equal(validateSealEvidencePathBinding(valid.diffPaths, boundEvidence).passed, true);
  const extraEvidence = structuredClone(valid.diffPaths);
  extraEvidence.push('test/i00/performance/evidence/unreferenced.json');
  assert.ok(validateSealEvidencePathBinding(extraEvidence, boundEvidence).failures.includes(
    'SEAL_UNBOUND_EVIDENCE_PATH:test/i00/performance/evidence/unreferenced.json',
  ));
});

test('independent validation requires a clean detached worktree pinned to exact candidate C', () => {
  const clean = { branch: '', headSha: CANDIDATE, treeSha: CANDIDATE_TREE, statusByteLength: 0 };
  assert.equal(validateDetachedCandidateWorktreeDocument(clean, CANDIDATE, CANDIDATE_TREE).passed, true);

  const branchAttached = { ...clean, branch: 'i00-product-assembly-20260713' };
  assert.ok(validateDetachedCandidateWorktreeDocument(branchAttached, CANDIDATE, CANDIDATE_TREE).failures.includes('DETACHED_CANDIDATE_BRANCH_INVALID'));

  const wrongCandidate = { ...clean, headSha: SEAL };
  assert.ok(validateDetachedCandidateWorktreeDocument(wrongCandidate, CANDIDATE, CANDIDATE_TREE).failures.includes('DETACHED_CANDIDATE_IDENTITY_INVALID'));

  const dirty = { ...clean, statusByteLength: 1 };
  assert.ok(validateDetachedCandidateWorktreeDocument(dirty, CANDIDATE, CANDIDATE_TREE).failures.includes('DETACHED_CANDIDATE_DIRTY'));
});

test('candidate report parity reads exact HEAD from clean detached checkouts', async (context) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'i00-candidate-report-parity-'));
  context.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const result = await verifyCandidateHeadReportParityRegression(tempRoot);

  assert.match(result.revision, /^[a-f0-9]{40}$/u);
  assert.equal(result.passed, true, JSON.stringify(result.artifacts.filter((artifact) => !artifact.matchesGenerator)));
  assert.equal(result.regeneration.passed, true);
  assert.equal(result.artifacts.length, 6);
  assert.ok(result.artifacts.every((artifact) => artifact.matchesGenerator));
  assert.notEqual(result.liveGitDiagnostic.status, 'FAILED');
  assert.equal(result.restrictedSource, null);
  assert.equal(result.legacySourceAlias, null);
  assert.equal(
    result.artifacts.find((artifact) => artifact.relativePath === 'integration/reports/i00-proof-evidence.json')?.comparisonMode,
    'EXACT_BYTES',
  );
  assert.deepEqual(result.checkouts, [
    { checkout: 'candidate-report-parity-untouched', headSha: result.revision, branch: '', statusByteLength: 0 },
    { checkout: 'candidate-report-parity-generated', headSha: result.revision, branch: '', statusByteLength: 0 },
  ]);
});

test('candidate report parity survives a sole branch not named current-main and preserves tri-state failures', async (context) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'i00-candidate-single-branch-'));
  context.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const result = await verifyCandidateHeadReportParityRegression(tempRoot, { singleBranchSource: true });

  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.restrictedSource.mode, 'FILE_TRANSPORT_SINGLE_BRANCH_CANDIDATE');
  assert.equal(result.restrictedSource.branch, 'candidate-parity');
  assert.ok(result.restrictedSource.refNames.every((ref) => !ref.endsWith('/current-main')));
  assert.notEqual(result.liveGitDiagnostic.status, 'FAILED');
  assert.ok(result.artifacts
    .every((artifact) => artifact.comparisonMode === 'EXACT_BYTES' && artifact.rawMatchesGenerator));

  const base = 'a'.repeat(40);
  const sha = 'b'.repeat(40);
  const diagnosticDocument = {
    receiptProvenance: {
      verificationBase: base,
      items: [{ sha, claimType: 'RECEIPTED_BYTE_EQUIVALENCE', ancestorRequired: false }],
    },
    receiptProvenanceSeal: {
      schemaVersion: 1,
      mode: 'TRACKED_RECEIPT_BYTES_ONLY',
      verificationBase: base,
      ambientGitObjectProof: 'NOT_SEALED; SEPARATE_TRI_STATE_DIAGNOSTIC',
      results: [{
        sha,
        claimType: 'RECEIPTED_BYTE_EQUIVALENCE',
        ancestorRequired: false,
        currentReceiptHashVerified: true,
        currentReceiptNeedleVerified: true,
        ambientGitObjectProof: 'SEPARATE_TRI_STATE_DIAGNOSTIC',
        passed: true,
      }],
      passed: true,
    },
  };
  const unavailable = { base: 'AVAILABLE', items: [{ sha, object: 'UNKNOWN', ancestry: 'NOT_REQUIRED' }] };
  assert.equal(classifyReceiptProvenanceDiagnostic(diagnosticDocument, unavailable).status, 'UNKNOWN');
  const corruptedReceipt = structuredClone(diagnosticDocument);
  corruptedReceipt.receiptProvenanceSeal.results[0].currentReceiptHashVerified = false;
  assert.equal(classifyReceiptProvenanceDiagnostic(corruptedReceipt, unavailable).status, 'FAILED');
  const disprovedAncestry = structuredClone(diagnosticDocument);
  disprovedAncestry.receiptProvenance.items[0].ancestorRequired = true;
  disprovedAncestry.receiptProvenanceSeal.results[0].ancestorRequired = true;
  assert.equal(classifyReceiptProvenanceDiagnostic(disprovedAncestry, {
    base: 'AVAILABLE',
    items: [{ sha, object: 'AVAILABLE', ancestry: 'DISPROVED' }],
  }).status, 'FAILED');
});

test('pre-S receipt creation accepts only bounded working seal inputs, then yields one final sole-child S', () => {
  const fixture = candidateReceiptFixture();
  const finalTopology = topologyDocument();
  const preSealEntries = finalTopology.diffPaths
    .filter((relativePath) => !relativePath.endsWith('INTEGRATION_CANDIDATE_READY_RECEIPT.md'))
    .map((relativePath) => ({ status: '??', path: relativePath }));
  preSealEntries.push(...PROTECTED_OWNER_DIRECTIVES.map((entry) => ({ status: '??', path: entry.path })));
  assert.equal(validateWorkingSealPathSet(preSealEntries).passed, true);
  assert.equal(validateCandidateSealTopologyDocument(finalTopology).passed, true);
  const markdown = renderIntegrationCandidateReceiptMarkdown(fixture.document);
  assert.equal(validateIntegrationCandidateReceiptMarkdown(markdown, fixture.expected).passed, true);

  const circularPreexistingReceipt = [...preSealEntries, { status: '??', path: 'docs/archive/i00-phase2/INTEGRATION_CANDIDATE_READY_RECEIPT.md' }];
  assert.ok(validateWorkingSealPathSet(circularPreexistingReceipt).failures.includes(
    'WORKING_SEAL_PATH_NOT_ALLOWED:docs/archive/i00-phase2/INTEGRATION_CANDIDATE_READY_RECEIPT.md',
  ));
  const unrelatedSource = [...preSealEntries, { status: ' M', path: 'server/src/index.ts' }];
  assert.ok(validateWorkingSealPathSet(unrelatedSource).failures.includes('WORKING_SEAL_PATH_NOT_ALLOWED:server/src/index.ts'));
});

test('proof catalog is unbound in C, bound to exact C only in the sole-child seal, and otherwise immutable', () => {
  const { candidate, seal } = proofCatalogDocuments();
  assert.equal(validateProofCatalogSealBindingDocuments(candidate, seal, CANDIDATE).passed, true);

  const preboundCandidate = structuredClone(candidate);
  preboundCandidate.base.candidateCommit = CANDIDATE;
  assert.ok(validateProofCatalogSealBindingDocuments(preboundCandidate, seal, CANDIDATE).failures.includes('PROOF_CATALOG_CANDIDATE_NOT_UNBOUND'));

  const staleSeal = structuredClone(seal);
  staleSeal.base.candidateCommit = 'f'.repeat(40);
  assert.ok(validateProofCatalogSealBindingDocuments(candidate, staleSeal, CANDIDATE).failures.includes('PROOF_CATALOG_CANDIDATE_COMMIT_MISMATCH'));

  const driftedSeal = structuredClone(seal);
  driftedSeal.canonicalRoutes[0].route = '/forged';
  assert.ok(validateProofCatalogSealBindingDocuments(candidate, driftedSeal, CANDIDATE).failures.includes('PROOF_CATALOG_SEAL_DRIFT'));

  const omittedCatalogRow = structuredClone(candidate);
  omittedCatalogRow.controls.pop();
  const omittedCatalogSeal = structuredClone(omittedCatalogRow);
  omittedCatalogSeal.base.candidateCommit = CANDIDATE;
  assert.ok(validateProofCatalogSealBindingDocuments(omittedCatalogRow, omittedCatalogSeal, CANDIDATE).failures.includes('PROOF_CONTROL_CATALOG_COUNT_INVALID'));

  const forgedCatalog = structuredClone(candidate);
  forgedCatalog.controls[0].runtimeControlId = 'global.safe-mode.read-only';
  const forgedCatalogSeal = structuredClone(forgedCatalog);
  forgedCatalogSeal.base.candidateCommit = CANDIDATE;
  assert.ok(validateProofCatalogSealBindingDocuments(forgedCatalog, forgedCatalogSeal, CANDIDATE).failures.includes('PROOF_CONTROL_CATALOG_CROSSWALK_INVALID'));
});

test('complete receipt binds all exact steps, candidate source, source freeze, Q, uv, browser and performance evidence', () => {
  const fixture = completeFixture();
  const validate = (document) => validateCompleteReceiptDocument(
    document,
    CANDIDATE,
    CANDIDATE_TREE,
    fixture.performanceReceipt,
    fixture.browserReceipt,
    fixture.candidateManifest,
    fixture.initialEvidence,
  );
  assert.equal(validate(fixture.document).passed, true);

  const omittedStep = structuredClone(fixture.document);
  omittedStep.steps.splice(4, 1);
  assert.ok(validate(omittedStep).semanticFailures.includes('COMPLETE_RECEIPT_STEP_SET_INVALID'));

  const forgedSource = structuredClone(fixture.document);
  forgedSource.source.headSha = 'f'.repeat(40);
  assert.ok(validate(forgedSource).semanticFailures.includes('COMPLETE_RECEIPT_SOURCE_MISMATCH'));

  const forgedEvidence = structuredClone(fixture.document);
  forgedEvidence.sourceFreeze.sha256 = DIGEST;
  assert.ok(validate(forgedEvidence).semanticFailures.includes('COMPLETE_RECEIPT_CANDIDATE_MANIFEST_INVALID'));

  const forgedDirectiveHash = structuredClone(fixture.document);
  forgedDirectiveHash.sourceFreeze.protectedOwnerDirectives[0].sha256 = DIGEST;
  assert.ok(validate(forgedDirectiveHash).semanticFailures.includes('COMPLETE_RECEIPT_CANDIDATE_MANIFEST_INVALID'));

  const qEnvironmentDrift = structuredClone(fixture.document);
  qEnvironmentDrift.qExactDonor.venv.integrity.pytestPluginPolicy.explicit.push('rogue.plugin');
  assert.ok(validate(qEnvironmentDrift).semanticFailures.includes('COMPLETE_RECEIPT_Q_PROVENANCE_INVALID'));

  const missingUv = structuredClone(fixture.document);
  delete missingUv.uv;
  assert.ok(validate(missingUv).semanticFailures.includes('COMPLETE_RECEIPT_UV_PROVENANCE_INVALID'));

  const malformedUv = structuredClone(fixture.document);
  malformedUv.uv.resolvedPathSha256 = 'not-a-digest';
  assert.ok(validate(malformedUv).semanticFailures.includes('COMPLETE_RECEIPT_UV_PROVENANCE_INVALID'));

  const forgedUv = structuredClone(fixture.document);
  forgedUv.uv.path = '/forged/uv';
  assert.ok(validate(forgedUv).semanticFailures.includes('COMPLETE_RECEIPT_UV_PROVENANCE_INVALID'));

  const falseGreen = structuredClone(fixture.document);
  const qCurrentStep = falseGreen.steps.find((step) => step.id === 'q_current_gate');
  qCurrentStep.exitCode = 1;
  assert.ok(validate(falseGreen).semanticFailures.includes('COMPLETE_RECEIPT_STEP_FAILED'));

  const commandForgery = structuredClone(fixture.document);
  commandForgery.steps.find((step) => step.id === 'root_test').command = ['true'];
  assert.ok(validate(commandForgery).semanticFailures.includes('COMPLETE_RECEIPT_STEP_COMMAND_INVALID'));

  const omittedMeasurement = structuredClone(fixture.document);
  delete omittedMeasurement.steps[0].durationMs;
  assert.ok(validate(omittedMeasurement).semanticFailures.includes('COMPLETE_RECEIPT_STEP_MEASUREMENT_INVALID'));

  const forgedMeasurementHash = structuredClone(fixture.document);
  forgedMeasurementHash.steps[1].stdoutSha256 = 'not-a-digest';
  assert.ok(validate(forgedMeasurementHash).semanticFailures.includes('COMPLETE_RECEIPT_STEP_MEASUREMENT_INVALID'));

  const forgedDuration = structuredClone(fixture.document);
  forgedDuration.steps[3].durationMs = -1;
  assert.ok(validate(forgedDuration).semanticFailures.includes('COMPLETE_RECEIPT_STEP_MEASUREMENT_INVALID'));
});

test('candidate Markdown receipt strictly binds donor, protocol, measured, manifest, limitation and terminal truth', () => {
  const fixture = candidateReceiptFixture();
  const validate = (document) => validateIntegrationCandidateReceiptMarkdown(
    renderIntegrationCandidateReceiptMarkdown(document),
    fixture.expected,
  );
  assert.equal(EXPECTED_ACCEPTED_DONORS.length, 16);
  assert.equal(validate(fixture.document).passed, true);
  assert.deepEqual(fixture.document.directorDispositions, EXPECTED_DIRECTOR_DISPOSITIONS);
  assert.equal(fixture.document.donorEquality.proof, '16/16/16/16');

  const forgedDonor = structuredClone(fixture.document);
  forgedDonor.donors[0].tipSha = 'f'.repeat(40);
  assert.ok(validate(forgedDonor).semanticFailures.includes('CANDIDATE_RECEIPT_DONOR_INVENTORY_INVALID'));

  const staleReceiptHash = structuredClone(fixture.document);
  staleReceiptHash.donors[1].acceptanceReceiptSha256s[0] = DIGEST;
  assert.ok(validate(staleReceiptHash).semanticFailures.includes('CANDIDATE_RECEIPT_DONOR_INVENTORY_INVALID'));

  const forgedIntegrationReceipt = structuredClone(fixture.document);
  forgedIntegrationReceipt.donors[2].integrationReceiptSha256 = DIGEST;
  assert.ok(validate(forgedIntegrationReceipt).semanticFailures.includes('CANDIDATE_RECEIPT_DONOR_INVENTORY_INVALID'));

  const omittedProofDonor = structuredClone(fixture.document);
  omittedProofDonor.donorProof.donors.pop();
  rehashDonorProof(omittedProofDonor);
  assert.ok(validate(omittedProofDonor).semanticFailures.includes('CANDIDATE_RECEIPT_DONOR_PROOF_INVALID'));

  const forgedProofTree = structuredClone(fixture.document);
  forgedProofTree.donorProof.donors[0].tip.observedTree = 'f'.repeat(40);
  rehashDonorProof(forgedProofTree);
  assert.ok(validate(forgedProofTree).semanticFailures.includes('CANDIDATE_RECEIPT_DONOR_PROOF_INVALID'));

  const forgedProofReceipt = structuredClone(fixture.document);
  forgedProofReceipt.donorProof.donors[1].acceptanceReceipts.push({ observedSha256: DIGEST });
  rehashDonorProof(forgedProofReceipt);
  assert.ok(validate(forgedProofReceipt).semanticFailures.includes('CANDIDATE_RECEIPT_DONOR_PROOF_INVALID'));

  const forgedProofOrder = structuredClone(fixture.document);
  [forgedProofOrder.donorProof.integrationOrder.expected[0], forgedProofOrder.donorProof.integrationOrder.expected[1]] = [
    forgedProofOrder.donorProof.integrationOrder.expected[1],
    forgedProofOrder.donorProof.integrationOrder.expected[0],
  ];
  rehashDonorProof(forgedProofOrder);
  assert.ok(validate(forgedProofOrder).semanticFailures.includes('CANDIDATE_RECEIPT_DONOR_PROOF_INVALID'));

  const forgedRequiredLast = structuredClone(fixture.document);
  forgedRequiredLast.donorProof.requiredLast.postLTopologyExact = false;
  rehashDonorProof(forgedRequiredLast);
  assert.ok(validate(forgedRequiredLast).semanticFailures.includes('CANDIDATE_RECEIPT_DONOR_PROOF_INVALID'));

  const widenedPostLAllowlist = structuredClone(fixture.document);
  widenedPostLAllowlist.donorProof.mergeWindow.authorizedLaterMerges.push('f'.repeat(40));
  rehashDonorProof(widenedPostLAllowlist);
  assert.ok(validate(widenedPostLAllowlist).semanticFailures.includes('CANDIDATE_RECEIPT_DONOR_PROOF_INVALID'));

  const unlistedPostLMerge = structuredClone(fixture.document);
  unlistedPostLMerge.donorProof.mergeWindow.laterMerges.push('f'.repeat(40));
  rehashDonorProof(unlistedPostLMerge);
  assert.ok(validate(unlistedPostLMerge).semanticFailures.includes('CANDIDATE_RECEIPT_DONOR_PROOF_INVALID'));

  const forgedProtocol = structuredClone(fixture.document);
  forgedProtocol.protocolAndConfigHashes[0].hash = DIGEST;
  assert.ok(validate(forgedProtocol).semanticFailures.includes('CANDIDATE_RECEIPT_PROTOCOL_HASHES_INVALID'));

  const forgedQAncestry = structuredClone(fixture.document);
  forgedQAncestry.directorDispositions.qC17ToA17.c17Commit = 'f'.repeat(40);
  assert.ok(validate(forgedQAncestry).semanticFailures.includes('CANDIDATE_RECEIPT_DIRECTOR_DISPOSITIONS_INVALID'));

  const omittedMoneyDisposition = structuredClone(fixture.document);
  omittedMoneyDisposition.directorDispositions.moneyPaths.pop();
  assert.ok(validate(omittedMoneyDisposition).semanticFailures.includes('CANDIDATE_RECEIPT_DIRECTOR_DISPOSITIONS_INVALID'));

  const forgedLedgerRequestHash = structuredClone(fixture.document);
  forgedLedgerRequestHash.directorDispositions.moneyPaths[0].requestSha256 = DIGEST;
  assert.ok(validate(forgedLedgerRequestHash).semanticFailures.includes('CANDIDATE_RECEIPT_DIRECTOR_DISPOSITIONS_INVALID'));

  const forgedQuantityDisposition = structuredClone(fixture.document);
  forgedQuantityDisposition.directorDispositions.moneyPaths[1].disposition = 'PRODUCTION_CONSUMER_AUTHORIZED';
  assert.ok(validate(forgedQuantityDisposition).semanticFailures.includes('CANDIDATE_RECEIPT_DIRECTOR_DISPOSITIONS_INVALID'));

  const forgedDirectorEquality = structuredClone(fixture.document);
  forgedDirectorEquality.directorDispositions.donorEquality = '16/16/16/15';
  assert.ok(validate(forgedDirectorEquality).semanticFailures.includes('CANDIDATE_RECEIPT_DIRECTOR_LAW_INCOMPLETE'));

  const staleCandidate = structuredClone(fixture.document);
  staleCandidate.candidate.commit = 'f'.repeat(40);
  assert.ok(validate(staleCandidate).semanticFailures.includes('CANDIDATE_RECEIPT_SOURCE_MISMATCH'));

  const staleMeasurement = structuredClone(fixture.document);
  staleMeasurement.measurements.completeAcceptance.receiptSha256 = DIGEST;
  assert.ok(validate(staleMeasurement).semanticFailures.includes('CANDIDATE_RECEIPT_MEASUREMENTS_INVALID'));

  const omittedCommandResult = structuredClone(fixture.document);
  omittedCommandResult.measurements.completeAcceptance.commandResults.pop();
  assert.ok(validate(omittedCommandResult).semanticFailures.includes('CANDIDATE_RECEIPT_MEASUREMENTS_INVALID'));

  const forgedCommandHash = structuredClone(fixture.document);
  forgedCommandHash.measurements.completeAcceptance.commandResults[0].stdoutSha256 = DIGEST;
  assert.ok(validate(forgedCommandHash).semanticFailures.includes('CANDIDATE_RECEIPT_MEASUREMENTS_INVALID'));

  const omittedManagedIdentity = structuredClone(fixture.document);
  omittedManagedIdentity.managedComponentInventory.managedIdentities.entries.pop();
  assert.ok(validate(omittedManagedIdentity).semanticFailures.includes('CANDIDATE_RECEIPT_MANAGED_INVENTORY_INVALID'));

  const forgedManagedOwner = structuredClone(fixture.document);
  forgedManagedOwner.managedComponentInventory.managedIdentities.entries[0].owner = 'FORGED_NONEMPTY_OWNER';
  assert.ok(validate(forgedManagedOwner).semanticFailures.includes('CANDIDATE_RECEIPT_MANAGED_INVENTORY_INVALID'));

  const forgedManagedReason = structuredClone(fixture.document);
  forgedManagedReason.managedComponentInventory.managedIdentities.entries[0].reasonCode = 'FORGED_NONEMPTY_REASON';
  assert.ok(validate(forgedManagedReason).semanticFailures.includes('CANDIDATE_RECEIPT_MANAGED_INVENTORY_INVALID'));

  const forgedManagedEvidence = structuredClone(fixture.document);
  const mappedEntry = forgedManagedEvidence.managedComponentInventory.managedIdentities.entries.find((entry) => entry.evidence !== null);
  mappedEntry.evidence[0].componentProjectionIndex = 13;
  assert.ok(validate(forgedManagedEvidence).semanticFailures.includes('CANDIDATE_RECEIPT_MANAGED_INVENTORY_INVALID'));

  const omittedCanonicalComponent = structuredClone(fixture.document);
  omittedCanonicalComponent.managedComponentInventory.canonicalComponents.pop();
  assert.ok(validate(omittedCanonicalComponent).semanticFailures.includes('CANDIDATE_RECEIPT_MANAGED_INVENTORY_INVALID'));

  const forgedCanonicalOwner = structuredClone(fixture.document);
  forgedCanonicalOwner.managedComponentInventory.canonicalComponents[0].owner = 'FORGED_NONEMPTY_OWNER';
  assert.ok(validate(forgedCanonicalOwner).semanticFailures.includes('CANDIDATE_RECEIPT_MANAGED_INVENTORY_INVALID'));

  const omittedCatalogControl = structuredClone(fixture.document);
  omittedCatalogControl.controlInventory.declaredCatalog.rows.pop();
  assert.ok(validate(omittedCatalogControl).semanticFailures.includes('CANDIDATE_RECEIPT_CONTROL_INVENTORY_INVALID'));

  const forgedCatalogControl = structuredClone(fixture.document);
  forgedCatalogControl.controlInventory.declaredCatalog.rows[0].runtimeControlId = 'global.safe-mode.read-only';
  assert.ok(validate(forgedCatalogControl).semanticFailures.includes('CANDIDATE_RECEIPT_CONTROL_INVENTORY_INVALID'));

  const omittedObservedControl = structuredClone(fixture.document);
  omittedObservedControl.controlInventory.observedProductRuntime.controls.pop();
  assert.ok(validate(omittedObservedControl).semanticFailures.includes('CANDIDATE_RECEIPT_CONTROL_INVENTORY_INVALID'));

  const forgedObservedAuthority = structuredClone(fixture.document);
  forgedObservedAuthority.controlInventory.observedProductRuntime.controls[0].authority = 'INFERRED_OPERATOR';
  assert.ok(validate(forgedObservedAuthority).semanticFailures.includes('CANDIDATE_RECEIPT_CONTROL_INVENTORY_INVALID'));

  const forgedManifest = structuredClone(fixture.document);
  forgedManifest.manifests.evidence.sha256 = DIGEST;
  assert.ok(validate(forgedManifest).semanticFailures.includes('CANDIDATE_RECEIPT_MANIFESTS_INVALID'));

  const forgedManifestDirective = structuredClone(fixture.document);
  forgedManifestDirective.manifests.source.protectedOwnerDirectives[0].sha256 = DIGEST;
  assert.ok(validate(forgedManifestDirective).semanticFailures.includes('CANDIDATE_RECEIPT_MANIFESTS_INVALID'));

  const missingLimitationClass = structuredClone(fixture.document);
  missingLimitationClass.limitations = missingLimitationClass.limitations.filter((entry) => entry.status !== 'UNKNOWN');
  assert.ok(validate(missingLimitationClass).semanticFailures.includes('CANDIDATE_RECEIPT_LIMITATIONS_INVALID'));

  const forgedLimitationSource = structuredClone(fixture.document);
  forgedLimitationSource.limitationSource.sealSha256 = DIGEST;
  assert.ok(validate(forgedLimitationSource).semanticFailures.includes('CANDIDATE_RECEIPT_LIMITATION_SOURCE_INVALID'));

  const renamedLimitation = structuredClone(fixture.document);
  renamedLimitation.limitations[0].id = 'RENAMED_LIMITATION';
  assert.ok(validate(renamedLimitation).semanticFailures.includes('CANDIDATE_RECEIPT_LIMITATIONS_INVALID'));

  const forgedLimitationReason = structuredClone(fixture.document);
  forgedLimitationReason.limitations[1].reason = 'FORGED_NONEMPTY_REASON';
  assert.ok(validate(forgedLimitationReason).semanticFailures.includes('CANDIDATE_RECEIPT_LIMITATIONS_INVALID'));

  assert.deepEqual(
    fixture.document.limitations
      .filter((entry) => ['A_FORMAL', 'A_ACTION_EVIDENCE_S2'].includes(entry.id))
      .map((entry) => entry.status),
    ['POSTLANDING_EXCLUDED', 'POSTLANDING_EXCLUDED'],
  );

  const selfCertified = structuredClone(fixture.document);
  selfCertified.selfCertification = 'INTEGRATOR_CERTIFIED';
  assert.ok(validate(selfCertified).semanticFailures.includes('CANDIDATE_RECEIPT_SELF_CERTIFICATION_INVALID'));

  const externalMutation = structuredClone(fixture.document);
  externalMutation.externalActions = 'DEPLOYED';
  assert.ok(validate(externalMutation).semanticFailures.includes('CANDIDATE_RECEIPT_EXTERNAL_ACTIONS_INVALID'));

  const omittedExternalBoundary = structuredClone(fixture.document);
  delete omittedExternalBoundary.externalBoundary.privateReads;
  assert.ok(validate(omittedExternalBoundary).semanticFailures.includes('CANDIDATE_RECEIPT_EXTERNAL_BOUNDARY_INVALID'));

  const forgedExternalBoundary = structuredClone(fixture.document);
  forgedExternalBoundary.externalBoundary.signedCalls.status = 'RUN';
  assert.ok(validate(forgedExternalBoundary).semanticFailures.includes('CANDIDATE_RECEIPT_EXTERNAL_BOUNDARY_INVALID'));

  const wrongPath = structuredClone(fixture.document);
  wrongPath.receiptPath = 'docs/archive/i00-phase2/forged.md';
  assert.ok(validate(wrongPath).semanticFailures.includes('CANDIDATE_RECEIPT_IDENTITY_INVALID'));

  const unexpectedField = structuredClone(fixture.document);
  unexpectedField.candidate.certified = true;
  assert.ok(validate(unexpectedField).semanticFailures.includes('CANDIDATE_RECEIPT_UNEXPECTED_OR_MISSING_FIELDS'));
});

test('candidate Markdown receipt refuses malformed, duplicate, secret-bearing, oversized, or non-terminal envelopes', () => {
  const fixture = candidateReceiptFixture();
  const validText = renderIntegrationCandidateReceiptMarkdown(fixture.document);
  const validateText = (text) => validateIntegrationCandidateReceiptMarkdown(text, fixture.expected);

  const duplicateField = validText.replace(
    '  "schemaVersion": "i00.integration-candidate-receipt.v2",',
    '  "schemaVersion": "forged",\n  "schemaVersion": "i00.integration-candidate-receipt.v2",',
  );
  assert.ok(validateText(duplicateField).semanticFailures.includes('CANDIDATE_RECEIPT_JSON_NOT_CANONICAL'));

  const secretBearing = validText.replace(
    'Q_PRODUCTION_TRANSPORT_NOT_CONFIGURED',
    'api_key=1234567890abcdef',
  );
  assert.ok(validateText(secretBearing).semanticFailures.includes('CANDIDATE_RECEIPT_SECRET_TEXT'));

  const missingTerminal = validText.replace('INDEPENDENT_VERIFICATION_REQUIRED\n', 'SELF_CERTIFIED\n');
  assert.ok(validateText(missingTerminal).semanticFailures.includes('CANDIDATE_RECEIPT_WRAPPER_INVALID'));

  const oversized = `${validText}${'x'.repeat(512 * 1024)}`;
  assert.ok(validateText(oversized).semanticFailures.includes('CANDIDATE_RECEIPT_SIZE_INVALID'));

  const malformedBlock = validText.replace('```json', '```javascript');
  assert.ok(validateText(malformedBlock).semanticFailures.includes('CANDIDATE_RECEIPT_WRAPPER_INVALID'));
});

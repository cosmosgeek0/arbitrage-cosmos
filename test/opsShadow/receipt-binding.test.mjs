import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPECTED_AMENDMENT_BLOB,
  EXPECTED_ADVERSARIAL_REVIEW_IDS,
  EXPECTED_AGENT_BOUNDARY_BLOB,
  EXPECTED_AGENT_BOUNDARY_SHA256,
  EXPECTED_BASE_SHA,
  EXPECTED_BRANCH,
  EXPECTED_DONOR_OPS_LIVE_TREE,
  EXPECTED_DONOR_SHA,
  EXPECTED_EFFECTIVE_ROOT_SHA256,
  EXPECTED_IMPLEMENTATION_PATHS,
  EXPECTED_INSERTION_REQUEST_IDS,
  EXPECTED_LIMITATION_IDS,
  EXPECTED_OPS_LIVE_TREE,
  EXPECTED_REGISTRY_BLOB,
  EXPECTED_REGISTRY_SHA,
  EXPECTED_SOURCE_RECEIPT_BLOB,
  EXPECTED_SOURCE_RECEIPT_SHA256,
  EXPECTED_SOURCE_SEAL_SHA,
  EXPECTED_TEST_ALL_SHARED_BLOCKER,
  FOCUSED_COMMAND_SPECS,
  PORT_RECEIPT_PATH,
  REPOSITORY_GATE_COMMANDS,
  SOURCE_RECEIPT_PATH,
  hasIssue,
  validatePortReceiptGit,
  validatePortReceiptShape,
} from './contract.mjs';

function syntheticReceipt() {
  return {
    schema: 'PORT_OPS_PRESTAGE_RECEIPT_V1',
    packet: 'RUN-16-PORT',
    phase: 'POST_LANDING_PRESTAGE',
    terminalState: 'PORT_OPS_PRESTAGE_READY',
    laneAcceptance: 'PASS',
    prestageReady: true,
    prestageOnly: true,
    integratedAcceptedClaimed: false,
    authorityGranted: false,
    deploymentPerformed: false,
    networkMutationPerformed: false,
    credentialMutationPerformed: false,
    moneyMutationPerformed: false,
    mergePerformed: false,
    pushPerformed: false,
    authorityEffect: 'NONE',
    baseSha: EXPECTED_BASE_SHA,
    implementationCommitSha: '1'.repeat(40),
    implementationTreeSha: '2'.repeat(40),
    implementationBranch: EXPECTED_BRANCH,
    launchAuthority: {
      decision: 'D-LAUNCH-51',
      decisionCommit: 'e619ff18ef159c27061cfaf318036e18a4fac131',
      landedBaseDecision: 'D-LAUNCH-50',
      landedBase: EXPECTED_BASE_SHA,
    },
    registryAuthority: {
      commit: EXPECTED_REGISTRY_SHA,
      gitBlob: EXPECTED_REGISTRY_BLOB,
      rowSchema: 'InsertionRequestRowV1',
      landedSchemaGitBlob: EXPECTED_AGENT_BOUNDARY_BLOB,
      landedSchemaSha256: EXPECTED_AGENT_BOUNDARY_SHA256,
    },
    receiptSealCommit: 'ENCLOSING_COMMIT_NOT_SELF_REFERENTIAL',
    receiptPath: PORT_RECEIPT_PATH,
    sourceShadow: {
      status: 'SHADOW_SPECULATIVE',
      acceptanceTransferred: false,
      sealCommit: EXPECTED_SOURCE_SEAL_SHA,
      receiptPath: SOURCE_RECEIPT_PATH,
      receiptBlob: EXPECTED_SOURCE_RECEIPT_BLOB,
      receiptSha256: EXPECTED_SOURCE_RECEIPT_SHA256,
      use: 'HISTORICAL_PROVENANCE_ONLY',
    },
    operationalOwner: {
      immutableDonorCommit: EXPECTED_DONOR_SHA,
      acceptedOpsLiveTree: EXPECTED_DONOR_OPS_LIVE_TREE,
      amendmentContractBlob: EXPECTED_AMENDMENT_BLOB,
      effectiveOpsLiveTree: EXPECTED_OPS_LIVE_TREE,
      effectiveRootDigestSha256: EXPECTED_EFFECTIVE_ROOT_SHA256,
    },
    scope: {
      exclusivePathRoots: ['fixtures/opsShadow', 'test/opsShadow'],
      implementationChangedPathCount: EXPECTED_IMPLEMENTATION_PATHS.length,
      implementationChangedPaths: EXPECTED_IMPLEMENTATION_PATHS.map((path, index) => ({
        path,
        gitBlob: ((index % 14) + 1).toString(16).repeat(40),
        sha256: (((index + 1) % 14) + 1).toString(16).repeat(64),
      })),
    },
    tests: FOCUSED_COMMAND_SPECS.map((entry, index) => ({
      category: entry.category,
      evidenceKind: entry.evidenceKind,
      command: entry.commandText,
      outcome: 'PASS',
      exitCode: 0,
      signal: null,
      positiveProofCount: index + 1,
      testedCommitSha: '1'.repeat(40),
      testedTreeSha: '2'.repeat(40),
      worktreeState: 'CLEAN_EXACT_IMPLEMENTATION_COMMIT',
      stdoutSha256: ((index % 14) + 1).toString(16).repeat(64),
      stderrSha256: (((index + 1) % 14) + 1).toString(16).repeat(64),
    })),
    repositoryGates: REPOSITORY_GATE_COMMANDS.map((command, index) => ({
      command,
      outcome: 'PASS',
      exitCode: 0,
      signal: null,
      sharedBlocker: null,
      testedCommitSha: '1'.repeat(40),
      testedTreeSha: '2'.repeat(40),
      worktreeState: 'CLEAN_EXACT_IMPLEMENTATION_COMMIT',
      stdoutSha256: (index + 7).toString(16).repeat(64),
      stderrSha256: (index + 9).toString(16).repeat(64),
      stdoutBytes: index + 100,
      stderrBytes: index,
    })),
    rootGateDisposition: 'ALL_REPOSITORY_GATES_GREEN',
    broaderRootGreenClaimed: true,
    adversarialReview: {
      outcome: 'PASS',
      checks: EXPECTED_ADVERSARIAL_REVIEW_IDS.map((id, index) => ({
        id,
        outcome: 'PASS',
        evidence: `Synthetic hostile check ${index + 1} failed closed.`,
      })),
    },
    insertionRequestIds: [...EXPECTED_INSERTION_REQUEST_IDS],
    dedupEvidence: [
      { id: 'OPS-PORT-PLAN-DESTINATION', disposition: 'REJECT_DUPLICATE', evidence: 'D-LAUNCH-51 supersedes the stale A5 planner destination.' },
      { id: 'OPS-WATCHDOG-CORRECTION-OWNER', disposition: 'ADAPT_EXISTING', evidence: 'WATCHDOG-007 remains the generation-fenced canonical owner.' },
      { id: 'OPS-RESTORE-CORRECTION-OWNER', disposition: 'ADAPT_EXISTING', evidence: 'BACKUP-008 remains the descriptor-bound canonical restore owner.' },
      { id: 'OPS-SHARED-TRUTH-OWNERS', disposition: 'REFERENCE_ONLY', evidence: 'Supervisor and Product projections remain canonical shared owners.' },
      { id: 'OPS-STATE-DOCUMENT-RECONCILIATION', disposition: 'REFERENCE_ONLY', evidence: 'Shared state reconciliation stays an integrator insertion request.' },
    ],
    limitations: EXPECTED_LIMITATION_IDS.map((id) => ({
      id,
      statement: `Synthetic ${id} limitation remains explicit and creates no authority.`,
    })),
  };
}

test('valid real prestage receipt shape is accepted', () => {
  assert.deepEqual(validatePortReceiptShape(syntheticReceipt()), []);
});

test('integration or authority claim fails closed', () => {
  const hostile = syntheticReceipt();
  hostile.integratedAcceptedClaimed = true;
  hostile.authorityGranted = true;
  assert(hasIssue(validatePortReceiptShape(hostile), 'RECEIPT_FORBIDDEN_AFFIRMATIVE_CLAIM'));
});

test('launch or immutable registry drift fails closed', () => {
  const hostile = syntheticReceipt();
  hostile.launchAuthority.decisionCommit = '0'.repeat(40);
  hostile.registryAuthority.gitBlob = '0'.repeat(40);
  const issues = validatePortReceiptShape(hostile);
  assert(hasIssue(issues, 'RECEIPT_LAUNCH_AUTHORITY_MISMATCH'));
  assert(hasIssue(issues, 'RECEIPT_REGISTRY_AUTHORITY_MISMATCH'));
});

test('shadow acceptance transfer fails closed', () => {
  const hostile = syntheticReceipt();
  hostile.sourceShadow.acceptanceTransferred = true;
  assert(hasIssue(validatePortReceiptShape(hostile), 'RECEIPT_SOURCE_SHADOW_INVALID'));
});

test('out-of-scope path or receipt in implementation commit fails closed', () => {
  const outside = syntheticReceipt();
  outside.scope.implementationChangedPaths[1].path = 'ops/live/new-owner.sh';
  assert(hasIssue(validatePortReceiptShape(outside), 'RECEIPT_IMPLEMENTATION_PATH_INVALID'));

  const self = syntheticReceipt();
  self.scope.implementationChangedPaths[0].path = self.receiptPath;
  assert(hasIssue(validatePortReceiptShape(self), 'RECEIPT_IMPLEMENTATION_PATH_INVALID'));
});

test('failed, signaled, uncounted, or unhashed focused evidence fails closed', () => {
  const hostile = syntheticReceipt();
  hostile.tests[0].outcome = 'FAIL';
  hostile.tests[0].exitCode = 1;
  hostile.tests[0].signal = 'SIGTERM';
  hostile.tests[0].positiveProofCount = 0;
  hostile.tests[1].stdoutSha256 = 'not-a-hash';
  hostile.tests[2].testedCommitSha = '9'.repeat(40);
  const issues = validatePortReceiptShape(hostile);
  assert(hasIssue(issues, 'RECEIPT_TEST_NOT_GREEN'));
  assert(hasIssue(issues, 'RECEIPT_TEST_OUTPUT_DIGEST_INVALID'));
  assert(hasIssue(issues, 'RECEIPT_TEST_CONTEXT_MISMATCH'));
});

test('fabricated, missing, duplicated, or reordered focused commands fail closed', () => {
  for (const mutate of [
    (receipt) => { receipt.tests[0].command = 'node fabricated-green.mjs'; },
    (receipt) => { receipt.tests.pop(); },
    (receipt) => { receipt.tests[1] = structuredClone(receipt.tests[0]); },
    (receipt) => { [receipt.tests[0], receipt.tests[1]] = [receipt.tests[1], receipt.tests[0]]; },
  ]) {
    const hostile = syntheticReceipt();
    mutate(hostile);
    assert(hasIssue(validatePortReceiptShape(hostile), 'RECEIPT_TEST_COMMAND_SET_INVALID'));
  }
});

test('failed, inconsistent, missing, or reordered repository gate fails closed', () => {
  const hostile = syntheticReceipt();
  hostile.repositoryGates[0].outcome = 'FAIL';
  hostile.repositoryGates[0].exitCode = 1;
  hostile.repositoryGates[1].signal = 'SIGTERM';
  hostile.repositoryGates[1].testedTreeSha = '9'.repeat(40);
  const issues = validatePortReceiptShape(hostile);
  assert(hasIssue(issues, 'RECEIPT_REPOSITORY_GATE_NOT_GREEN'));
  assert(hasIssue(issues, 'RECEIPT_REPOSITORY_GATE_CONTEXT_MISMATCH'));

  const missing = syntheticReceipt();
  missing.repositoryGates.pop();
  assert(hasIssue(validatePortReceiptShape(missing), 'RECEIPT_REPOSITORY_GATE_SET_INVALID'));

  const reordered = syntheticReceipt();
  reordered.repositoryGates.reverse();
  assert(hasIssue(validatePortReceiptShape(reordered), 'RECEIPT_REPOSITORY_GATE_SET_INVALID'));
});

test('only the exact fixed-base shared-owner test:all blocker preserves lane acceptance', () => {
  const blocked = syntheticReceipt();
  blocked.repositoryGates[1].outcome = 'BLOCKED_SHARED_OWNER';
  blocked.repositoryGates[1].exitCode = 1;
  blocked.repositoryGates[1].sharedBlocker = structuredClone(EXPECTED_TEST_ALL_SHARED_BLOCKER);
  blocked.rootGateDisposition = 'FOCUSED_LANE_GREEN_SHARED_ROOT_HANDOFF_REQUIRED';
  blocked.broaderRootGreenClaimed = false;
  assert.deepEqual(validatePortReceiptShape(blocked), []);

  blocked.repositoryGates[1].sharedBlocker.affectedInputs[0].assignedBaseSha256 = '0'.repeat(64);
  assert(hasIssue(validatePortReceiptShape(blocked), 'RECEIPT_REPOSITORY_GATE_NOT_GREEN'));
});

test('shallow adversarial review fails closed', () => {
  const hostile = syntheticReceipt();
  hostile.adversarialReview.checks.pop();
  const issues = validatePortReceiptShape(hostile);
  assert(hasIssue(issues, 'RECEIPT_ADVERSARIAL_REVIEW_INVALID'));
});

test('generic or duplicated dedup and limitation evidence fails closed', () => {
  const hostile = syntheticReceipt();
  hostile.dedupEvidence[0] = { id: 'GENERIC', disposition: 'PASS', evidence: 'generic' };
  hostile.limitations[0] = { id: hostile.limitations[1].id, statement: 'duplicated limitation that is still long enough to look plausible' };
  const issues = validatePortReceiptShape(hostile);
  assert(hasIssue(issues, 'RECEIPT_DEDUP_EVIDENCE_INCOMPLETE'));
  assert(hasIssue(issues, 'RECEIPT_LIMITATIONS_INCOMPLETE'));
});

test('missing insertion row or owner lineage drift fails closed', () => {
  const hostile = syntheticReceipt();
  hostile.insertionRequestIds.pop();
  hostile.operationalOwner.effectiveOpsLiveTree = '9'.repeat(40);
  const issues = validatePortReceiptShape(hostile);
  assert(hasIssue(issues, 'RECEIPT_INSERTION_REQUEST_SET_INVALID'));
  assert(hasIssue(issues, 'RECEIPT_OWNER_BINDING_MISMATCH'));
});

test('receipt must state its non-self-referential seal law', () => {
  const hostile = syntheticReceipt();
  hostile.receiptSealCommit = hostile.implementationCommitSha;
  assert(hasIssue(validatePortReceiptShape(hostile), 'RECEIPT_SELF_REFERENCE_INVALID'));
});

test('final git validation refuses an omitted receipt seal', () => {
  assert(hasIssue(validatePortReceiptGit(syntheticReceipt()), 'SEAL_REQUIRED'));
});

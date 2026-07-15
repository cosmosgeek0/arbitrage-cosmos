import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPECTED_BASE_SHA,
  EXPECTED_BRANCH,
  EXPECTED_DONOR_SHA,
  FOCUSED_COMMAND_SPECS,
  EXPECTED_INSERTION_REQUEST_IDS,
  EXPECTED_OPS_LIVE_TREE,
  hasIssue,
  validateReceiptShape,
} from './contract.mjs';

function syntheticReceipt() {
  return {
    schema: 'OPS_SHADOW_RECEIPT_V1',
    packet: 'RUN-16',
    shadowStatus: 'SHADOW_SPECULATIVE',
    terminalState: 'OPS_SHADOW_READY',
    acceptanceClaimed: false,
    prestageReadyClaimed: false,
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
    receiptSealCommit: 'ENCLOSING_COMMIT_NOT_SELF_REFERENTIAL',
    receiptPath: 'fixtures/opsShadow/receipts/OPS_SHADOW_RECEIPT.v1.json',
    donor: {
      acceptedCommit: EXPECTED_DONOR_SHA,
      opsLiveTree: EXPECTED_OPS_LIVE_TREE,
      parity: 'EXACT_OPS_LIVE_TREE_MATCH',
    },
    scope: {
      exclusivePathRoots: ['fixtures/opsShadow', 'test/opsShadow'],
      implementationChangedPathCount: 2,
      implementationChangedPaths: [
        { path: 'fixtures/opsShadow/OPS_SHADOW_ENTRY_GATE.v1.json', gitBlob: '3'.repeat(40), sha256: '4'.repeat(64) },
        { path: 'test/opsShadow/contract.mjs', gitBlob: '5'.repeat(40), sha256: '6'.repeat(64) },
      ],
    },
    tests: FOCUSED_COMMAND_SPECS.map((entry, index) => ({
      category: entry.category,
      command: entry.commandText,
      outcome: 'PASS',
      exitCode: 0,
      stdoutSha256: ((index % 14) + 1).toString(16).repeat(64),
      stderrSha256: (((index + 1) % 14) + 1).toString(16).repeat(64),
    })),
    insertionRequestIds: [...EXPECTED_INSERTION_REQUEST_IDS],
    limitations: ['one', 'two', 'three', 'four', 'five'],
  };
}

test('valid speculative receipt shape is accepted', () => {
  assert.deepEqual(validateReceiptShape(syntheticReceipt()), []);
});

test('acceptance or authority claim fails closed', () => {
  const hostile = syntheticReceipt();
  hostile.acceptanceClaimed = true;
  hostile.authorityGranted = true;
  assert(hasIssue(validateReceiptShape(hostile), 'RECEIPT_FORBIDDEN_AFFIRMATIVE_CLAIM'));
});

test('out-of-scope implementation path fails closed', () => {
  const hostile = syntheticReceipt();
  hostile.scope.implementationChangedPaths[1].path = 'ops/live/new-owner.sh';
  assert(hasIssue(validateReceiptShape(hostile), 'RECEIPT_IMPLEMENTATION_PATH_INVALID'));
});

test('receipt cannot include itself in the implementation commit', () => {
  const hostile = syntheticReceipt();
  hostile.scope.implementationChangedPaths[0].path = hostile.receiptPath;
  assert(hasIssue(validateReceiptShape(hostile), 'RECEIPT_IMPLEMENTATION_PATH_INVALID'));
});

test('failed or unhashed test evidence fails closed', () => {
  const hostile = syntheticReceipt();
  hostile.tests[0].outcome = 'FAIL';
  hostile.tests[0].exitCode = 1;
  hostile.tests[1].stdoutSha256 = 'not-a-hash';
  const issues = validateReceiptShape(hostile);
  assert(hasIssue(issues, 'RECEIPT_TEST_NOT_GREEN'));
  assert(hasIssue(issues, 'RECEIPT_TEST_OUTPUT_DIGEST_INVALID'));
});

test('fabricated, missing, duplicated, or reordered focused commands fail closed', () => {
  const fabricated = syntheticReceipt();
  fabricated.tests[0].command = 'node fabricated-green.mjs';
  assert(hasIssue(validateReceiptShape(fabricated), 'RECEIPT_TEST_COMMAND_SET_INVALID'));

  const missing = syntheticReceipt();
  missing.tests.pop();
  assert(hasIssue(validateReceiptShape(missing), 'RECEIPT_TEST_COMMAND_SET_INVALID'));

  const duplicated = syntheticReceipt();
  duplicated.tests[1] = structuredClone(duplicated.tests[0]);
  assert(hasIssue(validateReceiptShape(duplicated), 'RECEIPT_TEST_COMMAND_SET_INVALID'));

  const reordered = syntheticReceipt();
  [reordered.tests[0], reordered.tests[1]] = [reordered.tests[1], reordered.tests[0]];
  assert(hasIssue(validateReceiptShape(reordered), 'RECEIPT_TEST_COMMAND_SET_INVALID'));
});

test('missing insertion request or donor parity fails closed', () => {
  const hostile = syntheticReceipt();
  hostile.insertionRequestIds.pop();
  hostile.donor.parity = 'ASSUMED';
  const issues = validateReceiptShape(hostile);
  assert(hasIssue(issues, 'RECEIPT_INSERTION_REQUEST_SET_INVALID'));
  assert(hasIssue(issues, 'RECEIPT_DONOR_BINDING_MISMATCH'));
});

test('receipt must state its non-self-referential seal law', () => {
  const hostile = syntheticReceipt();
  hostile.receiptSealCommit = hostile.implementationCommitSha;
  assert(hasIssue(validateReceiptShape(hostile), 'RECEIPT_SELF_REFERENCE_INVALID'));
});

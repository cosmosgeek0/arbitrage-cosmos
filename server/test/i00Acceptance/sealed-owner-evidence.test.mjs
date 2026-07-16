import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  OWNER_DIRECTIVE_PATHS,
  sealedOwnerDirectiveSha256,
  verifySealedOwnerClaim,
  verifySealedOwnerDirective,
  verifySealedOwnerDirectives,
} from '../../../test/i00/sealed-owner-evidence.mjs';
import { runGitEvidence } from '../../../test/i00/verify-scope.mjs';

const ACCEPTANCE_PATH = 'fixtures/i00/living-director-input-acceptance.json';
const I00_PATH = 'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md';

function git(root, ...args) {
  return runGitEvidence({
    cwd: root,
    args,
    output: 'text',
  }).stdout.trim();
}

function acceptanceDocument(overrides = {}) {
  const ownerDirectives = OWNER_DIRECTIVE_PATHS.map((directivePath) => ({
    path: directivePath,
    sha256: sealedOwnerDirectiveSha256(directivePath),
  }));
  return {
    schemaVersion: 'I00_LIVING_DIRECTOR_INPUT_ACCEPTANCE_V2',
    ruling: 'D-LAUNCH-7',
    candidateFreezeAuthorization: 'D-LAUNCH-62',
    historicalPacketPinsPreserved: true,
    acceptAssemblyWorkingTreeCopies: false,
    ownerDirectives,
    ...overrides,
  };
}

function makeRepo(document = acceptanceDocument()) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'i00-sealed-owner.'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'I00 Test');
  git(root, 'config', 'user.email', 'i00-test@example.invalid');
  mkdirSync(path.join(root, path.dirname(ACCEPTANCE_PATH)), { recursive: true });
  writeFileSync(path.join(root, ACCEPTANCE_PATH), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  git(root, 'add', ACCEPTANCE_PATH);
  git(root, 'commit', '-q', '-m', 'fixture: seal owner evidence');
  return root;
}

function withRepo(t, document) {
  const root = makeRepo(document);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('clean candidate absence resolves only through exact committed owner seals', (t) => {
  const root = withRepo(t);
  const evidence = verifySealedOwnerDirectives(root);
  assert.equal(evidence.length, 5);
  assert(evidence.every((row) => row.evidenceMode === 'SEALED_CANDIDATE_HASH'));
  assert(evidence.every((row) => row.liveFilePresent === false));
  assert(evidence.every((row) => row.gitStatus === 'ABSENT_FROM_CLEAN_CANDIDATE'));
  assert(evidence.every((row) => row.acceptanceRecord === ACCEPTANCE_PATH));
  assert(evidence.every((row) => /^[a-f0-9]{40}$/u.test(row.acceptanceCommit)));
});

test('shared Git evidence runner is bounded, shell-free, binary-safe, and preserves status one', (t) => {
  const root = withRepo(t);
  git(root, 'commit', '--allow-empty', '-q', '-m', 'fixture: descendant');

  const textResult = runGitEvidence({ cwd: root, args: ['rev-parse', 'HEAD'], output: 'text' });
  assert.equal(textResult.status, 0);
  assert.match(textResult.stdout.trim(), /^[a-f0-9]{40}$/u);

  const binaryResult = runGitEvidence({ cwd: root, args: ['status', '--porcelain=v1', '-z'], output: 'binary' });
  assert.equal(binaryResult.status, 0);
  assert(Buffer.isBuffer(binaryResult.stdout));
  assert.equal(binaryResult.stdout.length, 0);

  const nonAncestor = runGitEvidence({
    cwd: root,
    args: ['merge-base', '--is-ancestor', 'HEAD', 'HEAD^'],
    output: 'text',
    acceptedStatuses: [0, 1],
  });
  assert.equal(nonAncestor.status, 1);

  assert.throws(
    () => runGitEvidence({ cwd: root, args: ['status\0--short'] }),
    /GIT_EVIDENCE_ARGUMENTS_INVALID/u,
  );
  assert.throws(
    () => runGitEvidence({ cwd: root, args: ['status'], output: 'objects' }),
    /GIT_EVIDENCE_OUTPUT_MODE_INVALID/u,
  );
  assert.throws(
    () => runGitEvidence({ cwd: root, args: ['status'], acceptedStatuses: [0, 2] }),
    /GIT_EVIDENCE_ACCEPTED_STATUSES_INVALID/u,
  );
});

test('sealed fallback rejects a forged committed acceptance digest', (t) => {
  const forgedRows = acceptanceDocument().ownerDirectives.map((row) => (
    row.path === 'IP_OPS.md' ? { ...row, sha256: '0'.repeat(64) } : row
  ));
  const root = withRepo(t, acceptanceDocument({ ownerDirectives: forgedRows }));
  assert.throws(
    () => verifySealedOwnerDirective(root, 'IP_OPS.md'),
    /SEALED_OWNER_ACCEPTANCE_HASH_MISMATCH:IP_OPS\.md/u,
  );
});

test('sealed fallback rejects dirty candidates instead of treating absence as proof', (t) => {
  const root = withRepo(t);
  writeFileSync(path.join(root, 'unrelated-dirty.txt'), 'dirty\n', 'utf8');
  assert.throws(
    () => verifySealedOwnerDirective(root, I00_PATH),
    /SEALED_OWNER_FALLBACK_REQUIRES_CLEAN_CANDIDATE/u,
  );
});

test('wrong live bytes and symlinked directives are rejected before sealed fallback', (t) => {
  const wrongRoot = withRepo(t);
  writeFileSync(path.join(wrongRoot, I00_PATH), 'forged owner body\n', 'utf8');
  assert.throws(
    () => verifySealedOwnerDirective(wrongRoot, I00_PATH),
    /SEALED_OWNER_LIVE_HASH_MISMATCH/u,
  );

  const symlinkRoot = withRepo(t);
  symlinkSync(ACCEPTANCE_PATH, path.join(symlinkRoot, I00_PATH));
  assert.throws(
    () => verifySealedOwnerDirective(symlinkRoot, I00_PATH),
    /SEALED_OWNER_LIVE_FILE_NOT_REGULAR/u,
  );
});

test('tracked owner directives and unauthorized paths fail closed', (t) => {
  const root = withRepo(t);
  writeFileSync(path.join(root, 'IP_PROOF.md'), 'tracked forgery\n', 'utf8');
  git(root, 'add', 'IP_PROOF.md');
  git(root, 'commit', '-q', '-m', 'fixture: forbidden tracked directive');
  assert.throws(
    () => verifySealedOwnerDirective(root, 'IP_PROOF.md'),
    /SEALED_OWNER_DIRECTIVE_MUST_NOT_BE_TRACKED/u,
  );
  assert.throws(
    () => verifySealedOwnerDirective(root, '../escape.md'),
    /SEALED_OWNER_PATH_NOT_AUTHORIZED/u,
  );
});

test('content-dependent baseline-route proof uses one exact recorded claim and rejects gaps', (t) => {
  const root = withRepo(t);
  const claim = verifySealedOwnerClaim(root, I00_PATH, 'I00_BASELINE_ROUTES');
  assert.equal(claim.evidenceMode, 'SEALED_CANDIDATE_HASH');
  assert.equal(claim.claimSha256, '6094f2eb554d601e0938344adcb20c60e4df83bd6c881ed7108972b5d1db3823');
  assert.equal(claim.value.length, 18);
  assert.deepEqual(claim.value.slice(-3), ['/api/kill', '/api/live', '/api/aws-control/*']);
  assert.throws(
    () => verifySealedOwnerClaim(root, I00_PATH, 'UNRECORDED_BODY_FRAGMENT'),
    /SEALED_OWNER_CLAIM_NOT_RECORDED/u,
  );
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RECEIPT_PATH = 'fixtures/obsShadow/receipts/OBS_SHADOW_RECEIPT.v1.json';
const receipt = JSON.parse(readFileSync(path.join(ROOT, RECEIPT_PATH), 'utf8'));

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function sha256(relativePath) {
  return createHash('sha256').update(readFileSync(path.join(ROOT, relativePath))).digest('hex');
}

function sorted(values) {
  return [...values].sort();
}

test('receipt is closed, shadow-only, non-authoritative, and exact-base bound', () => {
  assert.deepEqual(sorted(Object.keys(receipt)), sorted([
    'acceptanceStatus',
    'artifactSha256',
    'authorityEffect',
    'baseSha',
    'branch',
    'changedPaths',
    'classifications',
    'implementationCommitParentSha',
    'implementationCommitSha',
    'implementationPaths',
    'insertionRequests',
    'limitations',
    'packetId',
    'packetName',
    'packetPosture',
    'receiptSelfHashPolicy',
    'schemaVersion',
    'sealCommitIdentity',
    'sealPaths',
    'testRuns',
  ]));
  assert.equal(receipt.schemaVersion, 'OBS_SHADOW_RECEIPT_V1');
  assert.equal(receipt.packetId, 'RUN-18');
  assert.equal(receipt.packetName, 'OBS-SHADOW');
  assert.equal(receipt.packetPosture, 'SHADOW_SPECULATIVE');
  assert.equal(receipt.acceptanceStatus, null);
  assert.equal(receipt.authorityEffect, 'NONE');
  assert.equal(receipt.branch, 'obs-shadow-20260715');
  assert.equal(receipt.baseSha, '098f7b9449ab3b1c26bda19f51537bfea01d4c48');
  assert.equal(receipt.implementationCommitSha, '61d877f3c7bb8e2d9067fd49add12f49c5c28fae');
  assert.equal(receipt.implementationCommitParentSha, receipt.baseSha);
  assert.equal(
    receipt.sealCommitIdentity,
    'ENCLOSING_GIT_COMMIT_IS_AUTHORITY_AND_IS_NOT_SELF_RECORDED',
  );
  assert.equal(receipt.receiptSelfHashPolicy, 'RECEIPT_EXCLUDED_FROM_ARTIFACT_HASHES');
});

test('implementation commit is the sole exact-base child and contains only implementation paths', () => {
  assert.equal(git(['rev-parse', `${receipt.implementationCommitSha}^`]), receipt.baseSha);
  assert.equal(git(['merge-base', receipt.baseSha, receipt.implementationCommitSha]), receipt.baseSha);
  const paths = git([
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    receipt.implementationCommitSha,
  ]).split('\n').filter(Boolean).sort();
  assert.deepEqual(paths, sorted(receipt.implementationPaths));
  assert.ok(receipt.implementationPaths.every((entry) => (
    entry.startsWith('fixtures/obsShadow/') || entry.startsWith('test/obsShadow/')
  )));
});

test('receipt hashes every non-receipt packet artifact and excludes self-reference', () => {
  assert.equal(Object.hasOwn(receipt.artifactSha256, RECEIPT_PATH), false);
  assert.deepEqual(
    sorted(Object.keys(receipt.artifactSha256)),
    sorted([
      ...receipt.implementationPaths,
      'test/obsShadow/receipt.test.mjs',
    ]),
  );
  for (const [relativePath, expectedSha256] of Object.entries(receipt.artifactSha256)) {
    assert.match(expectedSha256, /^[0-9a-f]{64}$/);
    assert.equal(sha256(relativePath), expectedSha256, relativePath);
  }
  assert.deepEqual(
    sorted(receipt.changedPaths),
    sorted([...receipt.implementationPaths, ...receipt.sealPaths]),
  );
  assert.equal(new Set(receipt.changedPaths).size, receipt.changedPaths.length);
});

test('receipt records classifications, focused tests, limitations, and draft insertion requests', () => {
  assert.deepEqual(
    receipt.classifications.map((entry) => [entry.itemId, entry.classification]),
    [
      ['HISTORICAL_TRENDS', 'ADOPT_EXISTING'],
      ['PAGING_RECEIPTS', 'ADAPT_EXISTING'],
      ['INCIDENT_DRILL_FIXTURES', 'ADAPT_EXISTING'],
      ['EXPECTED_VS_OBSERVED_INVENTORY', 'ADOPT_EXISTING'],
      ['TELEMETRY_LOSS_DETECTION', 'ADOPT_EXISTING'],
      ['COST_BUDGET_PROJECTIONS', 'ADOPT_EXISTING'],
    ],
  );
  assert.ok(receipt.testRuns.length >= 3);
  assert.ok(receipt.testRuns.every((run) => run.exitCode === 0 && run.fail === 0));
  assert.ok(receipt.limitations.includes('NO_FULL_BROWSER_PERF_SOAK_OR_NPM_SUITE_PER_SAME_MACHINE_RULE'));
  assert.ok(receipt.limitations.includes('NO_CANONICAL_NO_FAULT_CONTROL_RUN_SO_SPECIFICITY_NOT_CLAIMED'));
  assert.ok(receipt.limitations.includes('PAGING_OWNER_DIGESTS_REFERENCE_BOUND_BUT_NOT_VERIFIED_BY_PACKET'));

  const insertionCatalog = JSON.parse(readFileSync(
    path.join(ROOT, 'fixtures/obsShadow/insertion-requests.v1.json'),
    'utf8',
  ));
  assert.deepEqual(
    receipt.insertionRequests,
    insertionCatalog.requests.map((entry) => ({
      requestId: entry.requestId,
      status: entry.status,
      dependency: entry.dependency,
    })),
  );
  assert.ok(receipt.insertionRequests.every((entry) => (
    entry.status === 'DRAFT' && entry.dependency === 'C2_PLUS_DIRECTOR_ADJUDICATION'
  )));
});

test('seal is either pending over C or is the sole-child commit containing only seal paths', () => {
  const head = git(['rev-parse', 'HEAD']);
  if (head === receipt.implementationCommitSha) {
    const pending = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
    assert.ok(pending.includes(RECEIPT_PATH));
    assert.ok(pending.includes('test/obsShadow/receipt.test.mjs'));
    return;
  }
  assert.equal(git(['rev-parse', `${head}^`]), receipt.implementationCommitSha);
  const paths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', head])
    .split('\n').filter(Boolean).sort();
  assert.deepEqual(paths, sorted(receipt.sealPaths));
});

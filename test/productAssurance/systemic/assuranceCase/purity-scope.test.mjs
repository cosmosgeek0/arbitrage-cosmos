import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import test from 'node:test';

const REPO = resolve(import.meta.dirname, '../../../..');
const FIXTURE_ROOT = resolve(REPO, 'fixtures/productAssurance/systemic/assuranceCase');
const TEST_ROOT = resolve(REPO, 'test/productAssurance/systemic/assuranceCase');
const ASSIGNED_BASE = 'c57610cb5f7d56efb61e53ae27057fbe92a6a2f6';
const S1_ACCEPTED = 'ab33b3712cddd67c3ec91cfa1dd232c75226cd9f';
const PROTECTED_I00 = 'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md';
const PROTECTED_I00_SHA256 = '9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5';
const SEALED_OWNER_HELPER = resolve(REPO, 'test/i00/sealed-owner-evidence.mjs');

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const latestDirectorMerge = () => {
  const record = git(
    'log',
    '--first-parent',
    '--merges',
    '--grep=^director:',
    '--max-count=1',
    '--format=%H%x1f%P%x1f%s',
    'HEAD',
  );
  const [commit = '', parentList = '', subject = ''] = record.split('\x1f');
  const parents = parentList.split(/\s+/).filter(Boolean);
  assert.match(commit, /^[0-9a-f]{40}$/, 'latest director merge must resolve to a full commit ID');
  assert.equal(parents.length, 2, 'latest director merge must have exactly two parents');
  assert.match(subject, /^director:/, 'latest director merge must carry the canonical director prefix');
  execFileSync('git', ['merge-base', '--is-ancestor', ASSIGNED_BASE, commit], { cwd: REPO });
  return commit;
};
const committedPathsAfter = (baseline) => git('rev-list', '--first-parent', `${baseline}..HEAD`)
  .split('\n')
  .filter(Boolean)
  .flatMap((commit) => git(
    'diff-tree',
    '--root',
    '--no-commit-id',
    '--name-only',
    '-r',
    '-m',
    commit,
  ).split('\n').filter(Boolean));
const walk = (root) => readdirSync(root).flatMap((name) => {
  const path = resolve(root, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const inside = (path, root) => path === root || path.startsWith(`${root}${sep}`);
const allowedRepoPath = (path) => (
  path === PROTECTED_I00
  || path.startsWith('fixtures/productAssurance/systemic/assuranceCase/')
  || path.startsWith('test/productAssurance/systemic/assuranceCase/')
);

test('branch and base ancestry match the assigned S4 lane', () => {
  assert.equal(git('branch', '--show-current'), 'ip-assur-case-20260713');
  execFileSync('git', ['merge-base', '--is-ancestor', ASSIGNED_BASE, 'HEAD'], { cwd: REPO });
  assert.equal(git('rev-parse', S1_ACCEPTED), S1_ACCEPTED);
  assert.equal(git('merge-base', ASSIGNED_BASE, S1_ACCEPTED), '9785c93102b00389847b77c2f9348c06abc4344b');
});

test('tracked and untracked paths remain inside the two exclusive roots', () => {
  const committed = committedPathsAfter(latestDirectorMerge());
  const unstaged = git('diff', '--name-only').split('\n').filter(Boolean);
  const staged = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
  const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: REPO });
  const statusPaths = porcelain.toString('utf8').split('\0').filter(Boolean).map((record) => record.slice(3));
  const allPaths = [...new Set([...committed, ...unstaged, ...staged, ...statusPaths])];
  assert.deepEqual(allPaths.filter((path) => !allowedRepoPath(path)), []);
});

test('protected untracked I00 input remains byte-identical', () => {
  const output = execFileSync(process.execPath, [
    SEALED_OWNER_HELPER,
    '--root', REPO,
    '--path', PROTECTED_I00,
  ], { cwd: REPO, encoding: 'utf8' }).trim();
  const prefix = 'SEALED_OWNER_EVIDENCE_VERIFIED ';
  assert.equal(output.startsWith(prefix), true, output);
  const [evidence] = JSON.parse(output.slice(prefix.length));
  assert.equal(evidence.path, PROTECTED_I00);
  assert.equal(evidence.sha256, PROTECTED_I00_SHA256);
  assert.ok(['LIVE_OWNER_FILE', 'SEALED_CANDIDATE_HASH'].includes(evidence.evidenceMode));
});

test('fixture modules have no ambient effects or authority dependencies', () => {
  const forbidden = [
    [/\bDate\.now\s*\(/, 'ambient clock'],
    [/\bnew\s+Date\s*\(/, 'ambient clock construction'],
    [/\bMath\.random\b/, 'randomness'],
    [/\bprocess\.env\b/, 'environment access'],
    [/\bset(?:Timeout|Interval|Immediate)\s*\(/, 'timer'],
    [/\bfetch\s*\(/, 'network fetch'],
    [/\bWebSocket\b/, 'socket'],
    [/\bimport\s*\(/, 'dynamic import'],
    [/from\s+['"]node:(?:fs|fs\/promises|http|https|net|tls|dgram|child_process|worker_threads)['"]/, 'effectful node import'],
  ];
  for (const path of walk(FIXTURE_ROOT).filter((entry) => entry.endsWith('.mjs'))) {
    const source = readFileSync(path, 'utf8');
    for (const [pattern, label] of forbidden) assert.equal(pattern.test(source), false, `${label}: ${path}`);
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert(match[1].startsWith('.'), `external import ${match[1]} in ${path}`);
      const imported = resolve(dirname(path), match[1]);
      assert(inside(imported, FIXTURE_ROOT), `out-of-packet import ${match[1]} in ${path}`);
    }
  }
});

test('test imports stay within packet roots or node test tooling', () => {
  for (const path of walk(TEST_ROOT).filter((entry) => entry.endsWith('.mjs'))) {
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('node:')) continue;
      assert(specifier.startsWith('.'), `external import ${specifier} in ${path}`);
      const imported = resolve(dirname(path), specifier);
      assert(inside(imported, FIXTURE_ROOT) || inside(imported, TEST_ROOT), `out-of-scope import ${specifier} in ${path}`);
    }
  }
});

test('no packet source exports a command or mutation authority', () => {
  const authorityExport = /export\s+(?:async\s+)?function\s+(?:execute|mutate|halt|close|repair|deploy|order|transfer|withdraw|borrow|repay)/i;
  for (const path of walk(FIXTURE_ROOT).filter((entry) => entry.endsWith('.mjs'))) {
    assert.equal(authorityExport.test(readFileSync(path, 'utf8')), false, path);
  }
});

test('working diff has no whitespace errors', () => {
  execFileSync('git', ['diff', '--check'], { cwd: REPO });
  execFileSync('git', ['diff', '--cached', '--check'], { cwd: REPO });
});

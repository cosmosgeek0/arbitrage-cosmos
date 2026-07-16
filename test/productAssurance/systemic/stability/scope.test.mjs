import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const BASE_COMMIT = '9785c93102b00389847b77c2f9348c06abc4344b';
const EXPECTED_BRANCH = 'ip-assur-stability-20260713';
const PROTECTED_UNTRACKED_INPUT = 'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md';
const ALLOWED_PREFIXES = Object.freeze([
  'fixtures/productAssurance/systemic/stability/',
  'test/productAssurance/systemic/stability/',
]);

function walk(root) {
  const output = [];
  for (const entry of readdirSync(root)) {
    const target = path.join(root, entry);
    if (statSync(target).isDirectory()) output.push(...walk(target));
    else output.push(target);
  }
  return output.sort();
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function nulEntries(output) {
  return output.split('\0').filter((entry) => entry.length > 0);
}

function isAllowedPacketPath(file) {
  return ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

test('all changes since the verified base stay inside the assigned roots', () => {
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
  assert.equal(git(root, ['rev-parse', '--show-toplevel']).trim(), root);
  assert.equal(git(root, ['branch', '--show-current']).trim(), EXPECTED_BRANCH);
  assert.equal(git(root, ['rev-parse', `${BASE_COMMIT}^{commit}`]).trim(), BASE_COMMIT);
  assert.doesNotThrow(() => git(root, ['merge-base', '--is-ancestor', BASE_COMMIT, 'HEAD']));

  const diffPaths = nulEntries(git(root, [
    'diff', '--name-only', '--no-renames', '-z', BASE_COMMIT, '--',
  ]));
  for (const file of diffPaths) {
    assert.ok(isAllowedPacketPath(file), `changed path outside assigned roots since ${BASE_COMMIT}: ${file}`);
  }

  const statusEntries = nulEntries(git(root, [
    '-c', 'status.renames=false',
    'status', '--porcelain=v1', '-z', '--untracked-files=all',
  ]));
  for (const entry of statusEntries) {
    assert.ok(entry.length >= 4 && entry[2] === ' ', `unparseable git status entry: ${JSON.stringify(entry)}`);
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    if (file === PROTECTED_UNTRACKED_INPUT) {
      assert.equal(status, '??', `${PROTECTED_UNTRACKED_INPUT} is allowed only as a protected pre-existing untracked input`);
      continue;
    }
    assert.ok(isAllowedPacketPath(file), `working-tree path outside assigned roots: ${status} ${file}`);
  }
});

test('packet source contains no secret-like fixture keys or external endpoints', () => {
  const roots = [
    path.resolve('fixtures/productAssurance/systemic/stability'),
    path.resolve('test/productAssurance/systemic/stability'),
  ];
  const forbiddenSecret = /\b(?:api[_-]?key|secret[_-]?key|private[_-]?key|access[_-]?token|password)\b\s*[:=]/i;
  const externalEndpoint = /https?:\/\//i;
  for (const file of roots.flatMap(walk)) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, forbiddenSecret, file);
    assert.doesNotMatch(source, externalEndpoint, file);
  }
});

test('draft and view artifacts carry honest non-runtime truth labels', () => {
  const fixtureRoot = path.resolve('fixtures/productAssurance/systemic/stability');
  const source = walk(fixtureRoot).map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.match(source, /SYNTHETIC_ONLY/);
  assert.match(source, /DRAFT_INSERTION_REQUEST/);
  assert.match(source, /NONE_IN_IP_ASSURANCE/);
  assert.doesNotMatch(source, /status:\s*['"](?:INTEGRATED|DEPLOYED_PROVED|I00_ACCEPTED)['"]/);
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE_ROOT = path.join(ROOT, 'fixtures/aiOps/a5');
const PORTABLE_TEST_ROOT = path.join(ROOT, 'test/aiOps/a5');
const OWNER_TEST_ROOT = path.join(ROOT, 'server/test/aiOps/a5');
const ARCHIVE_ROOT = path.join(ROOT, 'docs/archive/aiOps/a5');
const BASE_SHA = '492e3f69b054c85686bcfc4c09dbff4ababeda3f';
const ALLOWED_PATH = /^(?:server\/test\/aiOps\/a5\/|test\/aiOps\/|fixtures\/aiOps\/a5\/|docs\/archive\/aiOps\/a5\/)/u;

async function recursiveFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? recursiveFiles(target) : [target];
  }));
  return nested.flat().sort();
}

test('all A5 artifact paths remain inside the four ratified exclusive namespaces', async () => {
  const files = [
    ...await recursiveFiles(FIXTURE_ROOT),
    ...await recursiveFiles(PORTABLE_TEST_ROOT),
    ...await recursiveFiles(OWNER_TEST_ROOT),
    ...await recursiveFiles(ARCHIVE_ROOT),
  ];
  assert.ok(files.length >= 26);
  for (const file of files) {
    const relative = path.relative(ROOT, file);
    assert.match(relative, ALLOWED_PATH);
  }

  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' });
  const changedPaths = status.trim().split('\n').filter(Boolean).map((line) => line.slice(3));
  for (const changedPath of changedPaths) {
    assert.match(changedPath, ALLOWED_PATH);
  }
  const committed = execFileSync('git', ['diff', '--name-only', `${BASE_SHA}..HEAD`], { cwd: ROOT, encoding: 'utf8' });
  for (const changedPath of committed.trim().split('\n').filter(Boolean)) {
    assert.match(changedPath, ALLOWED_PATH);
  }
});

test('the assigned base remains an ancestor and the worker is on the assigned branch', () => {
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(branch, 'port-a5-20260716');
  execFileSync('git', ['merge-base', '--is-ancestor', BASE_SHA, 'HEAD'], { cwd: ROOT, stdio: 'pipe' });
});

test('pure fixture modules have no environment, filesystem, timer, random, process, or network dependency', async () => {
  const modules = (await recursiveFiles(FIXTURE_ROOT)).filter((file) => file.endsWith('.mjs'));
  const forbidden = [
    /process\.env/u,
    /Date\.now\s*\(/u,
    /Math\.random\s*\(/u,
    /setTimeout\s*\(/u,
    /setInterval\s*\(/u,
    /from ['"]node:(?:fs|http|https|http2|net|tls|dns|dgram|child_process|worker_threads)['"]/u,
    /import\s*\(\s*['"]node:(?:fs|http|https|http2|net|tls|dns|dgram|child_process|worker_threads)['"]\s*\)/u,
    /require\s*\(\s*['"](?:node:)?(?:fs|http|https|http2|net|tls|dns|dgram|child_process|worker_threads)['"]\s*\)/u,
  ];
  for (const file of modules) {
    const source = await readFile(file, 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${path.basename(file)} matched ${pattern}`);
  }
});

test('fixtures contain no real credential material, real provider endpoint, or live environment label', async () => {
  const files = await recursiveFiles(FIXTURE_ROOT);
  const text = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
  assert.doesNotMatch(text, /\bsk-[A-Za-z0-9_-]{12,}\b/u);
  assert.doesNotMatch(text, /AKIA[0-9A-Z]{16}/u);
  assert.doesNotMatch(text, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u);
  assert.doesNotMatch(text, /https?:\/\/(?:api\.|www\.)?(?:openai|anthropic|binance)\./iu);
  assert.match(text, /SYNTHETIC_ONLY/u);
  assert.match(text, /fixture:\/\//u);
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE_ROOT = path.join(ROOT, 'fixtures/aiOps/harness');
const TEST_ROOT = path.join(ROOT, 'test/aiOps/harness');
const BASE_SHA = '03857dcdaff8d8b12627d27ddcc97505da1f2f86';

async function recursiveFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? recursiveFiles(target) : [target];
  }));
  return nested.flat().sort();
}

test('all A5 artifact paths remain inside the two provisional exclusive roots', async () => {
  const files = [...await recursiveFiles(FIXTURE_ROOT), ...await recursiveFiles(TEST_ROOT)];
  assert.ok(files.length >= 10);
  for (const file of files) {
    const relative = path.relative(ROOT, file);
    assert.match(relative, /^(?:fixtures|test)\/aiOps\/harness\//u);
  }

  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' });
  const changedPaths = status.trim().split('\n').filter(Boolean).map((line) => line.slice(3));
  for (const changedPath of changedPaths) {
    assert.match(changedPath, /^(?:fixtures|test)\/aiOps\/harness\//u);
  }
  const committed = execFileSync('git', ['diff', '--name-only', `${BASE_SHA}..HEAD`], { cwd: ROOT, encoding: 'utf8' });
  for (const changedPath of committed.trim().split('\n').filter(Boolean)) {
    assert.match(changedPath, /^(?:fixtures|test)\/aiOps\/harness\//u);
  }
});

test('the assigned base remains an ancestor and the worker is on the assigned branch', () => {
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(branch, 'aiops-shadow-a5-20260715');
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

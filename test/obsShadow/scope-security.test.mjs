import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = '098f7b9449ab3b1c26bda19f51537bfea01d4c48';

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function lines(value) {
  return value.length === 0 ? [] : value.split('\n').filter(Boolean);
}

function packetPaths() {
  return [...new Set([
    ...lines(git(['diff', '--name-only', `${BASE}..HEAD`])),
    ...lines(git(['diff', '--name-only'])),
    ...lines(git(['diff', '--cached', '--name-only'])),
    ...lines(git(['ls-files', '--others', '--exclude-standard'])),
  ])].sort();
}

function allowedPath(relativePath) {
  return relativePath.startsWith('fixtures/obsShadow/') || relativePath.startsWith('test/obsShadow/');
}

test('packet remains on the assigned branch and descends from the exact base', () => {
  assert.equal(git(['branch', '--show-current']), 'obs-shadow-20260715');
  assert.equal(git(['merge-base', BASE, 'HEAD']), BASE);
  assert.equal(git(['rev-parse', `${BASE}^{commit}`]), BASE);
});

test('all packet changes stay inside the two exclusive namespaces and contain no symlinks', () => {
  const changed = packetPaths();
  assert.ok(changed.length > 0);
  assert.ok(changed.every(allowedPath), changed.join('\n'));
  for (const relativePath of changed) {
    assert.equal(lstatSync(path.join(ROOT, relativePath)).isSymbolicLink(), false, relativePath);
  }
});

test('fixture executable is deterministic and has no ambient, network, private, or money-path capability', () => {
  const source = readFileSync(path.join(ROOT, 'fixtures/obsShadow/view-adapter.mjs'), 'utf8');
  const forbidden = [
    /process\.env/,
    /Date\.now\s*\(/,
    /Math\.random\s*\(/,
    /\bset(?:Timeout|Interval|Immediate)\s*\(/,
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /from\s+['"]node:(?:child_process|cluster|dgram|dns|fs|http|https|net|tls|worker_threads)['"]/,
    /import\s*\(\s*[^'"`]/,
    /\beval\s*\(/,
    /new\s+Function\s*\(/,
    /\b(?:withdraw|transfer|borrow|repay|leverage|margin|order|signedRequest|privateExchange)\b/i,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(source, pattern);
  assert.deepEqual(source.match(/^\s*import\s.+;$/gm), [
    "import { sha256CanonicalJson } from '../productAssurance/systemic/observability/canonical-sha256.mjs';",
  ]);
});

test('packet artifacts contain no credential-shaped literals or live-authority claims', () => {
  const credentialPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /\bsk-[A-Za-z0-9]{20,}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  ];
  for (const relativePath of packetPaths()) {
    const source = readFileSync(path.join(ROOT, relativePath), 'utf8');
    for (const pattern of credentialPatterns) assert.doesNotMatch(source, pattern, relativePath);
  }

  const fixtureSources = packetPaths()
    .filter((relativePath) => relativePath.startsWith('fixtures/obsShadow/'))
    .map((relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8'))
    .join('\n');
  assert.doesNotMatch(fixtureSources, /"acceptanceStatus"\s*:\s*"(?:ACCEPTED|READY)"/);
  assert.doesNotMatch(fixtureSources, /"authorityEffect"\s*:\s*"(?:WRITE|MUTATE|EXECUTE)"/);
  assert.doesNotMatch(fixtureSources, /"mountAuthority"\s*:\s*"(?:GRANTED|MOUNTED)"/);
});

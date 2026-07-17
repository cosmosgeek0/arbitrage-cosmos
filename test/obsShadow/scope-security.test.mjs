import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = '492e3f69b054c85686bcfc4c09dbff4ababeda3f';
const SOURCE_SEAL = '20608c4b041b552b67c43c1f328038b0c492942f';

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
  return relativePath.startsWith('fixtures/obsShadow/')
    || relativePath.startsWith('test/obsShadow/');
}

test('packet remains on the assigned branch and descends from the exact landed base', () => {
  assert.equal(git(['branch', '--show-current']), 'port-obs-20260716');
  assert.equal(git(['rev-parse', `${BASE}^{commit}`]), BASE);
  assert.equal(git(['merge-base', BASE, 'HEAD']), BASE);
  assert.equal(git(['rev-parse', `${SOURCE_SEAL}^{commit}`]), SOURCE_SEAL);
});

test('all changes stay in the two exclusive namespaces and contain no symlinks', () => {
  const changed = packetPaths();
  assert.ok(changed.length > 0);
  assert.ok(changed.every(allowedPath), changed.join('\n'));
  for (const relativePath of changed) {
    assert.equal(lstatSync(path.join(ROOT, relativePath)).isSymbolicLink(), false, relativePath);
  }
});

test('adapter is deterministic and has no ambient, network, private, or money-path capability', () => {
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

test('packet contains no credential-shaped literals or product authority elevation', () => {
  const credentialPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /\bsk-[A-Za-z0-9]{20,}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/,
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  ];
  for (const relativePath of packetPaths()) {
    const source = readFileSync(path.join(ROOT, relativePath), 'utf8');
    for (const pattern of credentialPatterns) assert.doesNotMatch(source, pattern, relativePath);
  }

  const activeFixtureSources = packetPaths()
    .filter((relativePath) => relativePath.startsWith('fixtures/obsShadow/'))
    .filter((relativePath) => !relativePath.endsWith('OBS_SHADOW_RECEIPT.v1.json'))
    .map((relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8'))
    .join('\n');
  assert.doesNotMatch(activeFixtureSources, /"productAcceptanceStatus"\s*:\s*"(?:ACCEPTED|READY)"/);
  assert.doesNotMatch(activeFixtureSources, /"acceptanceStatus"\s*:\s*"(?:ACCEPTED|READY)"/);
  assert.doesNotMatch(activeFixtureSources, /"authorityEffect"\s*:\s*"(?:WRITE|MUTATE|EXECUTE)"/);
  assert.doesNotMatch(activeFixtureSources, /"mountState"\s*:\s*"MOUNTED"/);
  assert.doesNotMatch(activeFixtureSources, /"greenEligible"\s*:\s*true/);
});

test('shared seams, package files, and execution sentinel owners are untouched', () => {
  const changed = packetPaths();
  for (const forbidden of [
    'STATE.md',
    'ARCHITECTURE.md',
    'package.json',
    'package-lock.json',
    'server/package.json',
    'web/package.json',
    'server/src/',
    'web/src/',
  ]) assert.equal(changed.some((entry) => entry === forbidden || entry.startsWith(forbidden)), false);

  const baseSentinelPaths = lines(git(['grep', '-l', 'LIVE_EXECUTION_NOT_IMPLEMENTED', BASE, '--']));
  assert.ok(baseSentinelPaths.length > 0);
  for (const entry of baseSentinelPaths) {
    const relativePath = entry.slice(entry.indexOf(':') + 1);
    assert.equal(changed.includes(relativePath), false, relativePath);
  }
});

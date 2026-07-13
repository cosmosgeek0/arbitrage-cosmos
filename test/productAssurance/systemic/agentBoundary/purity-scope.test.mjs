import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(here, '../../../../fixtures/productAssurance/systemic/agentBoundary');
const testRoot = path.resolve(here);
const repoRoot = path.resolve(here, '../../../..');

function filesUnder(root) {
  const files = [];
  for (const name of readdirSync(root).sort()) {
    const fullPath = path.join(root, name);
    if (statSync(fullPath).isDirectory()) files.push(...filesUnder(fullPath));
    else files.push(fullPath);
  }
  return files;
}

const fixtureFiles = filesUnder(fixtureRoot);
const testFiles = filesUnder(testRoot);
const executableFiles = fixtureFiles.filter((file) => file.endsWith('.mjs'));

test('packet implementation has no wall clock, randomness, timers, environment, process, or mutable I/O', () => {
  const forbidden = [
    /Date\.now\s*\(/,
    /new\s+Date\s*\(/,
    /Math\.random\s*\(/,
    /performance\.now\s*\(/,
    /setTimeout\s*\(/,
    /setInterval\s*\(/,
    /process\.env/,
    /import\.meta\.env/,
    /node:(?:fs|fs\/promises|child_process|http|https|net|tls|dns|worker_threads)/,
  ];
  for (const file of executableFiles) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${path.basename(file)} matched ${pattern}`);
  }
});

test('packet imports no Q, L, exchange, production evaluator, runtime owner, or shared authority', () => {
  const forbidden = [
    /server\/src/,
    /server\/dist/,
    /(?:^|\/)quant\//,
    /liveEdge/,
    /binance/i,
    /awsRunner/i,
    /systemIntegration/,
    /capitalFoundation/,
    /foundation\/risk/,
  ];
  for (const file of executableFiles) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${path.basename(file)} matched ${pattern}`);
  }
});

test('test imports remain local, standard-library-only, and outside Q/L/production owners', () => {
  for (const file of testFiles.filter((entry) => entry.endsWith('.mjs'))) {
    const source = readFileSync(file, 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    for (const specifier of imports) {
      assert.doesNotMatch(specifier, /server\/src|server\/dist|(?:^|\/)quant\/|liveEdge|systemIntegration|capitalFoundation/);
    }
  }
});

test('provider stub contains no network, SDK, shell, process-spawn, or credential-acquisition seam', () => {
  const source = readFileSync(path.join(fixtureRoot, 'provider-stub.mjs'), 'utf8');
  for (const pattern of [
    /\bfetch\s*\(/,
    /WebSocket/,
    /https?:\/\//,
    /\bspawn\s*\(/,
    /\bexec\s*\(/,
    /\b(?:getCredentials|loadCredentials|acquireCredential|loadSecret|acquireToken)\s*\(/,
    /authorizationHeader/i,
    /provider[_-]?sdk/i,
  ]) assert.doesNotMatch(source, pattern);
  assert.match(source, /externalCallAttempted:\s*false/);
  assert.match(source, /toolExecuted:\s*false/);
});

test('every packet JSON artifact parses and stays bounded', () => {
  const jsonFiles = fixtureFiles.filter((file) => file.endsWith('.json'));
  assert.ok(jsonFiles.length >= 3);
  for (const file of jsonFiles) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotThrow(() => JSON.parse(source), file);
    assert.ok(Buffer.byteLength(source, 'utf8') < 262_144, `${file} is unexpectedly large`);
  }
});

test('fixture inventory remains entirely inside the assigned packet subtree', () => {
  assert.ok(fixtureFiles.length >= 9);
  for (const file of fixtureFiles) assert.equal(file.startsWith(`${fixtureRoot}${path.sep}`), true, file);
  assert.ok(testFiles.length >= 6);
  for (const file of testFiles) assert.equal(file.startsWith(`${testRoot}${path.sep}`), true, file);
});

test('actual Git path set is confined to the satellite subtrees plus the protected parent I00 input', () => {
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repoRoot, encoding: 'utf8' });
  const paths = status.trim().split('\n').filter(Boolean).map((line) => line.slice(3));
  const allowed = [
    'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md',
    'fixtures/productAssurance/systemic/agentBoundary/',
    'test/productAssurance/systemic/agentBoundary/',
  ];
  for (const changedPath of paths) {
    assert.equal(allowed.some((prefix) => changedPath === prefix || changedPath.startsWith(prefix)), true, changedPath);
  }
});

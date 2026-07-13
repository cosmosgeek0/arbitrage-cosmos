import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import {
  COMPLETE_HAZARD_FIXTURE,
  findSecretLikePaths,
} from '../../../../fixtures/productAssurance/systemic/hazard/index.mjs';

const fixtureRoot = new URL('../../../../fixtures/productAssurance/systemic/hazard/', import.meta.url);
const testRoot = new URL('./', import.meta.url);

async function collectFiles(root, suffix) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await visit(url);
      else if (entry.name.endsWith(suffix)) output.push(url);
    }
  }
  await visit(root);
  return output.sort((left, right) => left.href.localeCompare(right.href));
}

test('fixture and evaluator modules contain no ambient time, randomness, environment, network, timers, or effectful imports', async () => {
  const files = await collectFiles(fixtureRoot, '.mjs');
  assert.ok(files.length >= 10);
  const forbidden = [
    /Date\.now\s*\(/,
    /new\s+Date\s*\(/,
    /Math\.random\s*\(/,
    /process\.env/,
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\b(?:setTimeout|setInterval|setImmediate)\s*\(/,
    /from\s+['"]node:(?:fs|fs\/promises|net|http|https|child_process|worker_threads|dgram|tls|dns)['"]/,
    /\brequire\s*\(/,
  ];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${file.pathname} matched ${pattern}`);
  }
});

test('all implementation imports stay relative and packet-local', async () => {
  const files = await collectFiles(fixtureRoot, '.mjs');
  const importPattern = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      assert.ok(match[1].startsWith('.'), `${file.pathname} imports non-local module ${match[1]}`);
      const resolved = new URL(match[1], file);
      assert.ok(resolved.pathname.startsWith(fixtureRoot.pathname), `${file.pathname} escapes hazard subtree`);
    }
  }
});

test('focused tests import only node built-ins and this hazard subtree', async () => {
  const files = await collectFiles(testRoot, '.mjs');
  const importPattern = /import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      if (match[1].startsWith('node:')) continue;
      const resolved = new URL(match[1], file);
      assert.ok(resolved.pathname.startsWith(fixtureRoot.pathname), `${file.pathname} imports outside hazard fixture subtree`);
    }
  }
});

test('canonical fixture has no secret-like field path or money/external capability', () => {
  assert.deepEqual(findSecretLikePaths(COMPLETE_HAZARD_FIXTURE), []);
  const topLevelKeys = Object.keys(COMPLETE_HAZARD_FIXTURE).sort();
  assert.deepEqual(topLevelKeys, [
    'assumptionConsumers',
    'assumptions',
    'atlasManifest',
    'atlasRows',
    'failureFamilies',
    'fixtureId',
    'fixtureRegistry',
    'hazards',
    'release',
    'revision',
    'schemaVersion',
    'truthLabel',
    'unacceptableLossFamilies',
  ]);
  assert.equal(Object.hasOwn(COMPLETE_HAZARD_FIXTURE, 'execute'), false);
  assert.equal(Object.hasOwn(COMPLETE_HAZARD_FIXTURE, 'persist'), false);
  assert.equal(Object.hasOwn(COMPLETE_HAZARD_FIXTURE, 'network'), false);
});

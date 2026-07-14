import assert from 'node:assert/strict';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ACTION_EVIDENCE_AUTHORITY_EFFECT,
  ACTION_EVIDENCE_TRUTH_LABEL,
  ACTION_EVIDENCE_USE_CLASS,
} from '../../../../fixtures/productAssurance/systemic/actionEvidence/index.mjs';
import * as publicPacket from '../../../../fixtures/productAssurance/systemic/actionEvidence/index.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(
  testDirectory,
  '../../../../fixtures/productAssurance/systemic/actionEvidence',
);

const collectModules = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(directory, entry.name);
    const stats = await lstat(target);
    assert.equal(stats.isSymbolicLink(), false, `symlink forbidden: ${target}`);
    if (stats.isDirectory()) files.push(...await collectModules(target));
    else if (entry.name.endsWith('.mjs')) files.push(target);
  }
  return files;
};

test('packet implementation is pure, relative-import-only, and network-incapable', async () => {
  const modules = await collectModules(fixtureRoot);
  assert(modules.length >= 9);

  const forbiddenEffects = [
    [/\bDate\.now\s*\(/u, 'ambient clock'],
    [/\bnew\s+Date\s*\(/u, 'ambient clock object'],
    [/\bMath\.random\s*\(/u, 'randomness'],
    [/\b(?:setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(/u, 'timer or task scheduling'],
    [/\b(?:fetch|WebSocket|XMLHttpRequest|EventSource)\s*\(/u, 'network API'],
    [/\bprocess\.(?:env|cwd|exit|kill)\b/u, 'process side effect'],
    [/\b(?:require|import)\s*\(/u, 'dynamic module loading'],
  ];
  const importPattern = /\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/gu;

  for (const modulePath of modules) {
    const source = await readFile(modulePath, 'utf8');
    for (const [pattern, label] of forbiddenEffects) {
      assert.equal(pattern.test(source), false, `${label} forbidden in ${modulePath}`);
    }
    for (const match of source.matchAll(importPattern)) {
      assert(match[1].startsWith('.'), `non-relative import forbidden in ${modulePath}: ${match[1]}`);
      const resolved = path.resolve(path.dirname(modulePath), match[1]);
      assert(resolved.startsWith(`${fixtureRoot}${path.sep}`), `import escapes packet root: ${modulePath}`);
    }
  }
});

test('honesty banners are immutable public contract constants', () => {
  assert.equal(ACTION_EVIDENCE_TRUTH_LABEL, 'SYNTHETIC_ONLY');
  assert.equal(ACTION_EVIDENCE_USE_CLASS, 'SUPPORTING_EVIDENCE_ONLY');
  assert.equal(ACTION_EVIDENCE_AUTHORITY_EFFECT, 'NONE');
  assert.equal(Object.hasOwn(publicPacket, 'frozenPolicyActionMaterial'), false);
  assert.equal(Object.hasOwn(publicPacket, 'frozenControlActionMaterial'), false);
});

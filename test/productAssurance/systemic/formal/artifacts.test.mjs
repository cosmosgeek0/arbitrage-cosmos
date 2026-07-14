import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  MODEL_BUNDLE_HASH_ALGORITHM,
  MODEL_MANIFEST,
} from '../../../../fixtures/productAssurance/systemic/formal/fixtures/model-manifest.mjs';

const FORMAL_ROOT = fileURLToPath(new URL('../../../../fixtures/productAssurance/systemic/formal/', import.meta.url));
const SHA256 = (value) => createHash('sha256').update(value).digest('hex');

function filesRecursively(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const absolute = `${path}${entry.name}`;
    return entry.isDirectory() ? filesRecursively(`${absolute}/`) : [absolute];
  }).sort();
}

test('model manifest independently verifies every source file and bundle digest', () => {
  assert.equal(MODEL_BUNDLE_HASH_ALGORITHM, 'SHA256_SORTED_PATH_NUL_FILE_SHA256_NEWLINE');
  assert.equal(MODEL_MANIFEST.length, 10);
  for (const model of MODEL_MANIFEST) {
    const seen = new Set();
    for (const file of model.files) {
      assert.equal(seen.has(file.path), false, `${model.modelId}:${file.path}`);
      seen.add(file.path);
      assert.equal(SHA256(readFileSync(`${FORMAL_ROOT}${file.path}`)), file.sha256, `${model.modelId}:${file.path}`);
    }
    const material = model.files
      .map((file) => `${file.path}\0${file.sha256}\n`)
      .join('');
    assert.equal(SHA256(material), model.bundleSha256, model.modelId);
  }
});

test('manifest-count TLA modules and TLC configs are structurally paired without claiming execution', () => {
  const tlaDir = `${FORMAL_ROOT}tla/`;
  const names = readdirSync(tlaDir).sort();
  const modules = names.filter((name) => name.endsWith('.tla'));
  const configs = names.filter((name) => name.endsWith('.cfg'));
  assert.equal(modules.length, MODEL_MANIFEST.length);
  assert.equal(configs.length, MODEL_MANIFEST.length);
  assert.deepEqual(modules.map((name) => name.slice(0, -4)), configs.map((name) => name.slice(0, -4)));
  for (const moduleName of modules.map((name) => name.slice(0, -4))) {
    const source = readFileSync(`${tlaDir}${moduleName}.tla`, 'utf8');
    const config = readFileSync(`${tlaDir}${moduleName}.cfg`, 'utf8');
    assert.match(source, new RegExp(`^-+ MODULE ${moduleName} -+`, 'm'));
    assert.match(source, /^Init ==/m);
    assert.match(source, /^Next ==/m);
    assert.match(source, /^Spec ==/m);
    assert.match(source, /^TypeOK ==/m);
    assert.match(source, /WF_vars\(Next\)/);
    assert.match(source, /^=+\s*$/m);
    assert.equal(source.includes('\\union'), false, moduleName);
    assert.match(config, /^SPECIFICATION Spec$/m);
    for (const line of config.split('\n')) {
      const matched = /^(?:INVARIANT|PROPERTY) ([A-Za-z][A-Za-z0-9_]*)$/.exec(line);
      if (matched !== null) assert.match(source, new RegExp(`^${matched[1]} ==`, 'm'), `${moduleName}:${matched[1]}`);
    }
  }
  const state = readFileSync(`${FORMAL_ROOT}state/FORMAL_PACKET_STATE.md`, 'utf8');
  assert.match(state, /TLA_TOOLING_NOT_CONFIGURED/);
  assert.doesNotMatch(state, /TLA_CHECKED/);
});

test('packet runtime modules contain no ambient clock, random, secret, timer, filesystem, process, or network access', () => {
  const runtimeFiles = filesRecursively(FORMAL_ROOT).filter((path) => path.endsWith('.mjs'));
  const forbidden = [
    /Date\.now\s*\(/,
    /new\s+Date\s*\(/,
    /Math\.random\s*\(/,
    /process\.env/,
    /\bfetch\s*\(/,
    /\bWebSocket\b/,
    /\bsetTimeout\s*\(/,
    /\bsetInterval\s*\(/,
    /node:(?:fs|net|http|https|child_process)/,
    /\breadFile(?:Sync)?\s*\(/,
    /\bwriteFile(?:Sync)?\s*\(/,
  ];
  for (const path of runtimeFiles) {
    const source = readFileSync(path, 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, path);
  }
});

test('packet files remain inside the exclusive formal subtree and include no executable package payload', () => {
  const files = filesRecursively(FORMAL_ROOT);
  assert.equal(files.length > 0, true);
  assert.equal(files.every((path) => path.startsWith(FORMAL_ROOT)), true);
  assert.equal(files.some((path) => /(?:package(?:-lock)?\.json|\.jar|\.class)$/.test(path)), false);
});

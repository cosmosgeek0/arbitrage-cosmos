import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureRoot = fileURLToPath(new URL('../../../../fixtures/productAssurance/systemic/observability/', import.meta.url));
const testRoot = fileURLToPath(new URL('./', import.meta.url));
const schemaNames = [
  'release-bound-expected-manifest.schema.json',
  'conservation-accounting.schema.json',
  'slo-trend.schema.json',
  'slo-catalog.schema.json',
  'reason-code-registry.schema.json',
  'historical-series.schema.json',
];
const evaluatorNames = [
  'reference-helpers.mjs',
  'canonical-sha256.mjs',
  'slo-catalog-contract.mjs',
  'reason-code-registry.mjs',
  'release-manifest-evaluator.mjs',
  'conservation-evaluator.mjs',
  'slo-trend-evaluator.mjs',
  'historical-series-evaluator.mjs',
];

async function filesBelow(root) {
  const output = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else output.push(path);
    }
  }
  await walk(root);
  return output.sort();
}

function inspectSchemaNode(node, path, seen) {
  if (node === null || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  if (node.type === 'object') {
    assert.equal(node.additionalProperties, false, `${path} must be closed`);
  }
  if (node.type === 'array') {
    assert.equal(Number.isSafeInteger(node.maxItems), true, `${path} must be bounded by maxItems`);
  }
  if (Array.isArray(node)) {
    node.forEach((child, index) => inspectSchemaNode(child, `${path}[${index}]`, seen));
  } else {
    for (const [key, child] of Object.entries(node)) inspectSchemaNode(child, `${path}.${key}`, seen);
  }
}

test('all JSON schemas are versioned, closed, and bounded', async () => {
  const ids = [];
  for (const name of schemaNames) {
    const schema = JSON.parse(await readFile(resolve(fixtureRoot, name), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.$id, /^urn:ip-assurance:s5:observability:/);
    ids.push(schema.$id);
    inspectSchemaNode(schema, name, new Set());
  }
  assert.equal(new Set(ids).size, ids.length);
});

test('reference evaluators import only packet-local pure modules', async () => {
  const forbidden = [
    /Date\.now\s*\(/,
    /Math\.random\s*\(/,
    /process\.env/,
    /\bfetch\s*\(/,
    /\bsetTimeout\s*\(/,
    /\bsetInterval\s*\(/,
    /node:(?:fs|net|http|https|child_process|worker_threads)/,
    /node:crypto/,
    /crypto\.subtle/,
    /subtle\.digest\s*\(/,
    /createHash\s*\(/,
  ];
  const canonicalRoot = `${await realpath(fixtureRoot)}${sep}`;
  for (const name of evaluatorNames) {
    const path = resolve(fixtureRoot, name);
    const source = await readFile(path, 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${name} violates purity: ${pattern}`);
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      assert.match(specifier, /^\.\//, `${name} has non-local import ${specifier}`);
      const imported = await realpath(resolve(dirname(path), specifier));
      assert.ok(imported.startsWith(canonicalRoot), `${name} import escapes packet: ${specifier}`);
    }
  }
});

test('packet files are regular files confined to the two exclusive observability roots', async () => {
  const allowedRoots = [await realpath(fixtureRoot), await realpath(testRoot)];
  for (const root of allowedRoots) {
    for (const path of await filesBelow(root)) {
      const stat = await lstat(path);
      assert.equal(stat.isSymbolicLink(), false, `${path} must not be a symlink`);
      assert.equal(stat.isFile(), true, `${path} must be a regular file`);
      const canonical = await realpath(path);
      assert.ok(canonical.startsWith(`${root}${sep}`), `${path} escapes its exclusive root`);
      assert.ok(['.mjs', '.json'].includes(extname(path)), `${path} has an unexpected packet extension`);
    }
  }
});

test('all bounded JSON cases parse without non-finite values', async () => {
  const casesRoot = resolve(fixtureRoot, 'cases');
  const cases = await filesBelow(casesRoot);
  assert.ok(cases.length >= 3);
  for (const path of cases) {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(JSON.stringify(parsed).includes('Infinity'), false);
    assert.equal(JSON.stringify(parsed).includes('NaN'), false);
  }
});

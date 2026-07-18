import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../../..');
const WEB_ROOT = resolve(ROOT, 'web');
const SOURCE_ROOT = resolve(WEB_ROOT, 'src');
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const IMPORT_PATTERN = /(?:import|export)\s+(?:[^'";]*?\s+from\s*)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return SOURCE_EXTENSIONS.has(extname(path)) ? [path] : [];
    })
    .sort();
}

function packageName(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null;
  const [scope, name] = specifier.split('/');
  return scope.startsWith('@') ? `${scope}/${name}` : scope;
}

function importedRuntimePackages() {
  const packages = new Set();
  for (const path of sourceFiles(SOURCE_ROOT)) {
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const name = packageName(match[1] ?? match[2] ?? match[3]);
      if (name) packages.add(name);
    }
  }
  return [...packages].sort();
}

test('the web runtime dependency boundary matches source imports and the generated lockfile', () => {
  const manifest = JSON.parse(readFileSync(resolve(WEB_ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(resolve(ROOT, 'package-lock.json'), 'utf8'));
  const declared = Object.keys(manifest.dependencies ?? {}).sort();

  assert.deepEqual(declared, importedRuntimePackages());
  assert.deepEqual(lock.packages?.web?.dependencies, manifest.dependencies);
  for (const name of declared) {
    assert.ok(lock.packages?.[`node_modules/${name}`], `${name} is missing from package-lock.json`);
  }
});

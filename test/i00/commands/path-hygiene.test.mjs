import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// Generated or vendored trees that are not part of the repository's own
// path surface.
const EXCLUDED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', '.venv', 'dist']);

function dashPrefixedEntries(relativePath, depth = 0) {
  if (depth > 12) return [];
  const findings = [];
  for (const entry of readdirSync(path.join(ROOT, relativePath), { withFileTypes: true })) {
    if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) continue;
    const child = relativePath === '' ? entry.name : `${relativePath}/${entry.name}`;
    if (entry.name.startsWith('-')) findings.push(child);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      findings.push(...dashPrefixedEntries(child, depth + 1));
    }
  }
  return findings;
}

test('no repository path component begins with a dash', () => {
  // A leading dash breaks shell globs and is parsed as a flag by most tools;
  // quant/--help/ was created exactly this way, by a positional-argument CLI
  // accepting --help as an output root. Keep the whole tree free of the class.
  assert.deepEqual(dashPrefixedEntries(''), []);
});

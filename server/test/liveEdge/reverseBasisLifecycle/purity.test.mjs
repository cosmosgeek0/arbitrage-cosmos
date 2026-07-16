import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '../../../src/liveEdge/adapters/reverseBasisLifecycle');
const files = readdirSync(SOURCE).filter((name) => name.endsWith('.ts')).sort();
const content = files.map((name) => [name, readFileSync(join(SOURCE, name), 'utf8')]);

test('L10 source contains no network, environment, timer, filesystem or wall-clock primitive', () => {
  const forbidden = [
    /\bfetch\s*\(/,
    /\baxios\b/,
    /node:https?/,
    /node:net/,
    /node:tls/,
    /node:fs/,
    /process\.env/,
    /Date\.now\s*\(/,
    /new\s+Date\s*\(/,
    /Math\.random\s*\(/,
    /setTimeout\s*\(/,
    /setInterval\s*\(/,
    /WebSocket/,
  ];
  for (const [name, source] of content) {
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${name}: ${pattern}`);
  }
});

test('L10 source contains no exchange signer, credential, transfer or withdrawal path', () => {
  const forbidden = [
    /signRequest/i,
    /signedTransport/i,
    /api[_-]?key\s*[:=]/i,
    /api[_-]?secret\s*[:=]/i,
    /universal.?transfer/i,
    /internal.?transfer/i,
    /withdraw(?:al)?\s*\(/i,
    /margin\/borrow-repay/i,
    /sapi\/v1/i,
  ];
  for (const [name, source] of content) {
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${name}: ${pattern}`);
  }
});

test('runtime imports are limited to pure canonical contracts and accepted L07/L08 replay validators', () => {
  const imports = content.flatMap(([name, source]) => [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)]
    .map((match) => [name, match[1]]));
  const allowed = [
    'node:crypto',
    'node:util',
    '../../../foundation/contracts/index.js',
    '../executionPolicy/types.js',
    '../executionPolicy/policy.js',
    '../exchangeTwin/types.js',
    '../exchangeTwin/twin.js',
    './exact.js',
    './types.js',
    './lifecycle.js',
  ];
  for (const [name, specifier] of imports) {
    assert.ok(allowed.includes(specifier), `${name} imports unexpected ${specifier}`);
  }
});

test('exclusive L10 source does not import strategy, persistence, reconciliation or shared composition owners', () => {
  const joined = content.map(([, source]) => source).join('\n');
  assert.doesNotMatch(joined, /engine\/basis/);
  assert.doesNotMatch(joined, /server\/src\/ledger|\.\.\/\.\.\/\.\.\/ledger/);
  assert.doesNotMatch(joined, /systemIntegration/);
  assert.doesNotMatch(joined, /foundation\/reconciliation/);
  assert.doesNotMatch(joined, /binanceSignedKernel/);
});

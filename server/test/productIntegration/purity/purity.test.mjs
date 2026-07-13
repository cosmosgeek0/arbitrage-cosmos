import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(here, '../../../src/productIntegration');
function sourceFilesUnder(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? sourceFilesUnder(resolve(directory, entry.name), relative) : entry.name.endsWith('.ts') ? [relative] : [];
  }).sort();
}

const sourceFiles = sourceFilesUnder(sourceRoot);

test('pure modules have no network, env, timer, filesystem, random, or ledger imports', () => {
  const forbidden = [
    /(?:from|import)\s*\(?\s*['"](?:node:)?(?:fs(?:\/promises)?|net|http2?|https|tls|dgram|child_process|worker_threads)['"]/, /\brequire\s*\(/,
    /process\s*(?:\.\s*env|\[\s*['"]env['"]\s*\])/, /Date\.now\s*\(/, /performance\.now\s*\(/,
    /Math\.random\s*\(/, /setTimeout\s*\(/, /setInterval\s*\(/, /(?:\b|globalThis\.)fetch\s*\(/, /WebSocket/, /ledger\.js/,
    /binance\/(?:client|rest|ws)/, /liveEdge\/adapters\/binanceSignedKernel/,
  ];
  for (const relative of sourceFiles) {
    const source = readFileSync(resolve(sourceRoot, relative), 'utf8');
    for (const pattern of forbidden) assert.equal(pattern.test(source), false, `${relative} matched ${pattern}`);
  }
});

test('production barrel does not export synthetic fixtures', () => {
  for (const relative of ['contracts/index.ts', 'adapters/index.ts', 'lifecycle/index.ts', 'supervisor/index.ts', 'commands/index.ts']) {
    const source = readFileSync(resolve(sourceRoot, relative), 'utf8');
    assert.equal(source.includes('/fixtures/'), false, `${relative} must not export synthetic fixtures`);
  }
});

test('imports have no implicit clock, timer, network, or random side effects', async () => {
  const originals = { now: Date.now, random: Math.random, timeout: globalThis.setTimeout, interval: globalThis.setInterval, fetch: globalThis.fetch };
  const tripwire = (name) => () => { throw new Error(`${name} side effect during import`); };
  Date.now = tripwire('Date.now');
  Math.random = tripwire('Math.random');
  globalThis.setTimeout = tripwire('setTimeout');
  globalThis.setInterval = tripwire('setInterval');
  globalThis.fetch = tripwire('fetch');
  try {
    const supervisorDist = resolve(here, '../../../dist/productIntegration/supervisor/index.js');
    const lifecycleDist = resolve(here, '../../../dist/productIntegration/lifecycle/index.js');
    const supervisor = await import(`${pathToFileURL(supervisorDist).href}?purity=${process.pid}`);
    const lifecycle = await import(`${pathToFileURL(lifecycleDist).href}?purity=${process.pid}`);
    assert.equal(typeof supervisor.buildProductSupervisorProjection, 'function');
    assert.equal(typeof lifecycle.planProductLifecycle, 'function');
  } finally {
    Date.now = originals.now;
    Math.random = originals.random;
    globalThis.setTimeout = originals.timeout;
    globalThis.setInterval = originals.interval;
    globalThis.fetch = originals.fetch;
  }
});

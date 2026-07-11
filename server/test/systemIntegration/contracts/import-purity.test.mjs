import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function sourceFiles(root) {
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...sourceFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.ts')) output.push(target);
  }
  return output.sort();
}

test('system integration contract imports perform no ambient work', async () => {
  const original = {
    dateNow: Date.now,
    random: Math.random,
    fetch: globalThis.fetch,
    webSocket: globalThis.WebSocket,
    timeout: globalThis.setTimeout,
    interval: globalThis.setInterval,
  };
  const calls = { dateNow: 0, random: 0, fetch: 0, webSocket: 0, timeout: 0, interval: 0 };
  Date.now = () => { calls.dateNow += 1; return 0; };
  Math.random = () => { calls.random += 1; return 0; };
  globalThis.fetch = () => { calls.fetch += 1; throw new Error('network forbidden'); };
  globalThis.WebSocket = class { constructor() { calls.webSocket += 1; } };
  globalThis.setTimeout = () => { calls.timeout += 1; throw new Error('timer forbidden'); };
  globalThis.setInterval = () => { calls.interval += 1; throw new Error('timer forbidden'); };
  try {
    const module = await import(`../../../dist/systemIntegration/contracts/index.js?purity=${import.meta.url.length}`);
    assert.deepEqual(module.SYSTEM_SAFE_MODES, ['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY']);
    assert.equal(typeof module.resolveSystemSafeMode, 'function');
    assert.deepEqual(calls, { dateNow: 0, random: 0, fetch: 0, webSocket: 0, timeout: 0, interval: 0 });
  } finally {
    Date.now = original.dateNow;
    Math.random = original.random;
    globalThis.fetch = original.fetch;
    globalThis.WebSocket = original.webSocket;
    globalThis.setTimeout = original.timeout;
    globalThis.setInterval = original.interval;
  }
});

test('contract source statically excludes signed, private, money, process, and network boundaries', () => {
  const root = path.resolve('server/src/systemIntegration/contracts');
  const files = sourceFiles(root);
  assert.deepEqual(files.map((file) => path.basename(file)), [
    'constants.ts', 'dialects.ts', 'index.ts', 'types.ts', 'validation.ts',
  ]);
  const forbiddenImports = /from\s+['"][^'"]*(?:foundation\/exchange|binance|services\/(?:orders|loans|account)|node:(?:fs|net|http|https|tls|child_process)|process)[^'"]*['"]/;
  const forbiddenCalls = /\b(?:fetch|WebSocket|setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(|\b(?:Date\.now|Math\.random)\s*\(|process\.env/;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, forbiddenImports, `${file} imports a forbidden authority boundary`);
    assert.doesNotMatch(source, forbiddenCalls, `${file} performs ambient work`);
  }
});

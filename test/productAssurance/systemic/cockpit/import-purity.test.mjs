import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const moduleUrl = new URL(
  '../../../../fixtures/productAssurance/systemic/cockpit/reference/cockpit-view-model.mjs',
  import.meta.url,
);

test('reference evaluator import performs no ambient work', async () => {
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
    const module = await import(`${moduleUrl.href}?purity=1`);
    assert.equal(typeof module.buildCockpitViewModel, 'function');
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

test('reference evaluator statically excludes I/O, ambient clocks, locale ordering, and authority imports', () => {
  const source = readFileSync(moduleUrl, 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\b(?:Date\.now|Math\.random|fetch|WebSocket|setTimeout|setInterval|process\.env|localeCompare)\b/);
  assert.doesNotMatch(source, /(?:node:fs|node:net|node:http|node:https|child_process|server\/src|web\/src)/);
});

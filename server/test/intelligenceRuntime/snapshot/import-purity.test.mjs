import test from 'node:test';
import assert from 'node:assert/strict';

test('runtime snapshot imports perform no clock reads, network I/O, sockets, or timer scheduling', async () => {
  const original = {
    dateNow: Date.now,
    fetch: globalThis.fetch,
    webSocket: globalThis.WebSocket,
    timeout: globalThis.setTimeout,
    interval: globalThis.setInterval,
  };
  const calls = { dateNow: 0, fetch: 0, webSocket: 0, timeout: 0, interval: 0 };
  Date.now = () => { calls.dateNow += 1; return 0; };
  globalThis.fetch = () => { calls.fetch += 1; throw new Error('network forbidden'); };
  globalThis.WebSocket = class { constructor() { calls.webSocket += 1; } };
  globalThis.setTimeout = () => { calls.timeout += 1; throw new Error('timer forbidden'); };
  globalThis.setInterval = () => { calls.interval += 1; throw new Error('timer forbidden'); };
  try {
    const modulePath = process.env.RUNTIME_SNAPSHOT_SOURCE_TEST === '1'
      ? '../../../src/intelligenceRuntime/snapshot/index.ts'
      : '../../../dist/intelligenceRuntime/snapshot/index.js';
    const module = await import(`${modulePath}?purity=${import.meta.url.length}`);
    assert.equal(typeof module.buildRuntimeIntelligenceSnapshot, 'function');
    assert.equal(typeof module.serializeRuntimeIntelligenceSnapshot, 'function');
    assert.deepEqual(calls, { dateNow: 0, fetch: 0, webSocket: 0, timeout: 0, interval: 0 });
  } finally {
    Date.now = original.dateNow;
    globalThis.fetch = original.fetch;
    globalThis.WebSocket = original.webSocket;
    globalThis.setTimeout = original.timeout;
    globalThis.setInterval = original.interval;
  }
});

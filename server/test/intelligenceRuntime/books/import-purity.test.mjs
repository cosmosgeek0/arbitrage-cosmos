import test from 'node:test';
import assert from 'node:assert/strict';

test('local-book imports do not read clocks or randomness and start no timer, socket, or network work', async () => {
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
    const module = await import(`../../../dist/intelligenceRuntime/books/index.js?purity=${import.meta.url.length}`);
    assert.equal(typeof module.LocalOrderBookReducer, 'function');
    assert.equal(typeof module.calculateSlippage, 'function');
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

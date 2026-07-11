import assert from 'node:assert/strict';
import test from 'node:test';

test('persistence imports perform no clock, timer, network, environment, or filesystem action', async () => {
  const original = {
    fetch: globalThis.fetch,
    WebSocket: globalThis.WebSocket,
    setTimeout: globalThis.setTimeout,
    setInterval: globalThis.setInterval,
    dateNow: Date.now,
  };
  const calls = [];
  globalThis.fetch = () => { calls.push('fetch'); throw new Error('network forbidden'); };
  globalThis.WebSocket = class { constructor() { calls.push('websocket'); throw new Error('network forbidden'); } };
  globalThis.setTimeout = () => { calls.push('setTimeout'); throw new Error('timer forbidden'); };
  globalThis.setInterval = () => { calls.push('setInterval'); throw new Error('timer forbidden'); };
  Date.now = () => { calls.push('Date.now'); throw new Error('ambient clock forbidden'); };
  try {
    const module = await import(`../../../dist/systemIntegration/persistence/index.js?purity=${Math.random()}`);
    assert.equal(typeof module.SystemLedgerPersistenceAdapter, 'function');
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = original.fetch;
    globalThis.WebSocket = original.WebSocket;
    globalThis.setTimeout = original.setTimeout;
    globalThis.setInterval = original.setInterval;
    Date.now = original.dateNow;
  }
});

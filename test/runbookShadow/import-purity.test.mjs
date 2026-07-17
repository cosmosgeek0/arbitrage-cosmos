import assert from 'node:assert/strict';
import test from 'node:test';

test('importing the drill runtime performs no clock, random, timer, or network work', async () => {
  const calls = [];
  const denied = (name) => () => {
    calls.push(name);
    throw new Error(`IMPORT_SIDE_EFFECT_${name}`);
  };
  const originals = {
    dateNow: Date.now,
    random: Math.random,
    fetch: globalThis.fetch,
    webSocket: globalThis.WebSocket,
    setTimeout: globalThis.setTimeout,
    setInterval: globalThis.setInterval,
  };
  Date.now = denied('DATE_NOW');
  Math.random = denied('RANDOM');
  globalThis.fetch = denied('FETCH');
  globalThis.WebSocket = denied('WEBSOCKET');
  globalThis.setTimeout = denied('SET_TIMEOUT');
  globalThis.setInterval = denied('SET_INTERVAL');
  try {
    const runner = await import(`./lib/runner.mjs?purity=${import.meta.url.length}`);
    const receipt = await import(`./lib/receipt.mjs?purity=${import.meta.url.length}`);
    assert.equal(typeof runner.runDrill, 'function');
    assert.equal(typeof receipt.validateReceipt, 'function');
    assert.deepEqual(calls, []);
  } finally {
    Date.now = originals.dateNow;
    Math.random = originals.random;
    globalThis.fetch = originals.fetch;
    globalThis.WebSocket = originals.webSocket;
    globalThis.setTimeout = originals.setTimeout;
    globalThis.setInterval = originals.setInterval;
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

test('smoke imports do not read ambient clocks, use randomness, start timers, or perform network work', async () => {
  const original = {
    dateNow: Date.now,
    random: Math.random,
    fetch: globalThis.fetch,
    webSocket: globalThis.WebSocket,
    timeout: globalThis.setTimeout,
    interval: globalThis.setInterval,
    consoleLog: console.log,
    consoleError: console.error,
    exitCode: process.exitCode,
  };
  const calls = { dateNow: 0, random: 0, fetch: 0, webSocket: 0, timeout: 0, interval: 0, console: 0 };
  Date.now = () => { calls.dateNow += 1; return 0; };
  Math.random = () => { calls.random += 1; return 0; };
  globalThis.fetch = () => { calls.fetch += 1; throw new Error('network forbidden'); };
  globalThis.WebSocket = class { constructor() { calls.webSocket += 1; } };
  globalThis.setTimeout = () => { calls.timeout += 1; throw new Error('timer forbidden'); };
  globalThis.setInterval = () => { calls.interval += 1; throw new Error('timer forbidden'); };
  console.log = () => { calls.console += 1; };
  console.error = () => { calls.console += 1; };
  try {
    const module = await import(`../../../dist/intelligenceRuntime/smoke/index.js?purity=${import.meta.url.length}`);
    const manual = await import(`../../../dist/intelligenceRuntime/smoke/manual.js?purity=${import.meta.url.length}`);
    assert.equal(typeof module.PublicNoKeySmokeHarness, 'function');
    assert.equal(typeof module.NodePublicRestTransport, 'function');
    assert.equal(typeof module.NodePublicWebSocketTransport, 'function');
    assert.equal(typeof manual.runManualPublicSmoke, 'function');
    assert.deepEqual(calls, { dateNow: 0, random: 0, fetch: 0, webSocket: 0, timeout: 0, interval: 0, console: 0 });
    assert.equal(process.exitCode, original.exitCode);
  } finally {
    Date.now = original.dateNow;
    Math.random = original.random;
    globalThis.fetch = original.fetch;
    globalThis.WebSocket = original.webSocket;
    globalThis.setTimeout = original.timeout;
    globalThis.setInterval = original.interval;
    console.log = original.consoleLog;
    console.error = original.consoleError;
    process.exitCode = original.exitCode;
  }
});

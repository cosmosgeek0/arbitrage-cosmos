import assert from 'node:assert/strict';
import test from 'node:test';

test('integration surface imports are side-effect-free and require explicit injected clocks and transports', async () => {
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
  globalThis.fetch = () => { calls.fetch += 1; throw new Error('network forbidden during import'); };
  globalThis.WebSocket = class { constructor() { calls.webSocket += 1; } };
  globalThis.setTimeout = () => { calls.timeout += 1; throw new Error('timer forbidden during import'); };
  globalThis.setInterval = () => { calls.interval += 1; throw new Error('timer forbidden during import'); };
  try {
    const sourceMode = process.env.INTELLIGENCE_RUNTIME_SOURCE_TEST === '1';
    const names = [
      'contracts', 'lifecycle', 'universe', 'spot', 'futures', 'focus', 'books',
      'baseline', 'derivatives', 'bridge', 'capture', 'snapshot',
    ];
    const modules = await Promise.all(names.map((name, index) => {
      const path = sourceMode
        ? `../../../src/intelligenceRuntime/${name}/index.ts`
        : `../../../dist/intelligenceRuntime/${name}/index.js?integration-purity=${index}`;
      return import(path);
    }));
    assert.equal(typeof modules[names.indexOf('universe')].BinancePublicUniverseAdapter, 'function');
    assert.equal(typeof modules[names.indexOf('spot')].SpotBroadReducer, 'function');
    assert.equal(typeof modules[names.indexOf('futures')].FuturesRuntimeAdapter, 'function');
    assert.equal(typeof modules[names.indexOf('bridge')].IntelligenceRuntimeBridge, 'function');
    assert.equal(typeof modules[names.indexOf('capture')].LiveOutcomeCaptureCoordinator, 'function');
    assert.equal(typeof modules[names.indexOf('snapshot')].buildRuntimeIntelligenceSnapshot, 'function');
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

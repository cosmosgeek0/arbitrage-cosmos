import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { readdirSync, realpathSync } from 'node:fs';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import { registerHooks } from 'node:module';
import net from 'node:net';
import { extname, relative, resolve } from 'node:path';
import test from 'node:test';
import tls from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ATTEMPTS_KEY = Symbol.for('aiops.a4.total-network-attempts.v1');
const GUARD_KEY = Symbol.for('aiops.a4.total-network-guard.v1');
const repoRoot = realpathSync(new URL('../../../', import.meta.url));
const runtimeRoot = resolve(repoRoot, 'web/src/aiOps');
const buildOnlyPreviewEntry = realpathSync(resolve(runtimeRoot, 'preview/main.tsx'));
const sharedUiOwner = realpathSync(resolve(repoRoot, 'web/src/components/ui.tsx'));
const sharedStylesOwner = realpathSync(resolve(repoRoot, 'web/src/styles.css'));

const DNS_METHODS = [
  'lookup',
  'lookupService',
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTxt',
  'reverse',
];

function networkLedger() {
  const ledger = globalThis[ATTEMPTS_KEY];
  assert.ok(Array.isArray(ledger), 'A4 total-network preload ledger is missing; run with total-network-deny-preload.mjs');
  assert.equal(ledger.preloadInstalled, true, 'A4 total-network preload marker is missing');
  assert.equal(ledger.version, 1, 'A4 total-network preload ledger version mismatch');
  return ledger;
}

function assertGuarded(value, kind) {
  assert.equal(typeof value, 'function', `${kind} is unavailable`);
  assert.equal(value[GUARD_KEY], kind, `${kind} is not guarded by the A4 total-network preload`);
}

function walkRuntimeModules(root) {
  const modules = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) modules.push(...walkRuntimeModules(path));
    else if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extname(path))) modules.push(realpathSync(path));
  }
  return modules.sort();
}

function inside(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

test('the required total-network preload ledger and browser/Node guards are installed', () => {
  assert.deepEqual([...networkLedger()], []);

  for (const [kind, value] of [
    ['fetch', globalThis.fetch],
    ['WebSocket', globalThis.WebSocket],
    ['EventSource', globalThis.EventSource],
    ['XMLHttpRequest', globalThis.XMLHttpRequest],
    ['Worker', globalThis.Worker],
    ['SharedWorker', globalThis.SharedWorker],
    ['Image', globalThis.Image],
    ['http.request', http.request],
    ['http.get', http.get],
    ['http.ClientRequest', http.ClientRequest],
    ['http2.connect', http2.connect],
    ['https.request', https.request],
    ['https.get', https.get],
    ['net.connect', net.connect],
    ['net.createConnection', net.createConnection],
    ['net.Socket.connect', net.Socket.prototype.connect],
    ['net.Server.listen', net.Server.prototype.listen],
    ['tls.connect', tls.connect],
    ['tls.TLSSocket.connect', tls.TLSSocket.prototype.connect],
    ['dgram.createSocket', dgram.createSocket],
    ['dgram.Socket.bind', dgram.Socket.prototype.bind],
    ['dgram.Socket.connect', dgram.Socket.prototype.connect],
    ['dgram.Socket.send', dgram.Socket.prototype.send],
  ]) {
    assertGuarded(value, kind);
  }

  for (const method of DNS_METHODS) {
    assertGuarded(dns[method], `dns.${method}`);
    assertGuarded(dnsPromises[method], `dns.promises.${method}`);
  }
  for (const method of DNS_METHODS.filter((name) => !['lookup', 'lookupService'].includes(name))) {
    assertGuarded(dns.Resolver.prototype[method], `dns.Resolver.${method}`);
    assertGuarded(dnsPromises.Resolver.prototype[method], `dns.promises.Resolver.${method}`);
  }
});

test('every reusable A4 runtime module imports with no ambient work or network attempt', async () => {
  const discovered = walkRuntimeModules(runtimeRoot);
  const buildOnlyEntries = discovered.filter((path) => path === buildOnlyPreviewEntry);
  const runtimeModules = discovered.filter((path) => path !== buildOnlyPreviewEntry);
  assert.deepEqual(buildOnlyEntries.map((path) => relative(repoRoot, path)), ['web/src/aiOps/preview/main.tsx']);
  assert.ok(runtimeModules.length > 0);

  // Warm only the three allowed external dependencies and the shared UI owner so
  // the ambient-work counters below measure lane modules, not third-party startup.
  await import('react');
  await import('lucide-react');
  await import(pathToFileURL(sharedUiOwner).href);

  const cssHooks = registerHooks({
    load(url, context, nextLoad) {
      if (!url.endsWith('.css')) return nextLoad(url, context);
      const path = realpathSync(fileURLToPath(url));
      assert.ok(
        inside(path, runtimeRoot) || path === sharedStylesOwner,
        `purity CSS hook refused ${relative(repoRoot, path)}`,
      );
      return { format: 'module', shortCircuit: true, source: '' };
    },
  });

  const original = {
    dateNow: Date.now,
    random: Math.random,
    fetch: globalThis.fetch,
    webSocket: globalThis.WebSocket,
    eventSource: globalThis.EventSource,
    xmlHttpRequest: globalThis.XMLHttpRequest,
    timeout: globalThis.setTimeout,
    interval: globalThis.setInterval,
  };
  const calls = {
    dateNow: 0,
    random: 0,
    fetch: 0,
    webSocket: 0,
    eventSource: 0,
    xmlHttpRequest: 0,
    timeout: 0,
    interval: 0,
  };
  Date.now = () => { calls.dateNow += 1; return 0; };
  Math.random = () => { calls.random += 1; return 0; };
  globalThis.fetch = () => { calls.fetch += 1; throw new Error('network forbidden'); };
  globalThis.WebSocket = class { constructor() { calls.webSocket += 1; throw new Error('network forbidden'); } };
  globalThis.EventSource = class { constructor() { calls.eventSource += 1; throw new Error('network forbidden'); } };
  globalThis.XMLHttpRequest = class { constructor() { calls.xmlHttpRequest += 1; throw new Error('network forbidden'); } };
  globalThis.setTimeout = () => { calls.timeout += 1; throw new Error('timer forbidden'); };
  globalThis.setInterval = () => { calls.interval += 1; throw new Error('timer forbidden'); };

  const imported = [];
  try {
    for (const [index, path] of runtimeModules.entries()) {
      const url = pathToFileURL(path);
      url.searchParams.set('aiops_a4_purity', `${process.pid}-${index}`);
      try {
        await import(url.href);
        imported.push(relative(repoRoot, path));
      } catch (error) {
        error.message = `${relative(repoRoot, path)} import failed: ${error.message}`;
        throw error;
      }
    }
    assert.deepEqual(imported, runtimeModules.map((path) => relative(repoRoot, path)));
    assert.deepEqual(calls, {
      dateNow: 0,
      random: 0,
      fetch: 0,
      webSocket: 0,
      eventSource: 0,
      xmlHttpRequest: 0,
      timeout: 0,
      interval: 0,
    });
    assert.deepEqual([...networkLedger()], []);
  } finally {
    Date.now = original.dateNow;
    Math.random = original.random;
    globalThis.fetch = original.fetch;
    globalThis.WebSocket = original.webSocket;
    globalThis.EventSource = original.eventSource;
    globalThis.XMLHttpRequest = original.xmlHttpRequest;
    globalThis.setTimeout = original.timeout;
    globalThis.setInterval = original.interval;
    cssHooks.deregister();
  }
});

test('the total-network ledger remains empty after the complete reusable runtime set imports', () => {
  assert.deepEqual([...networkLedger()], []);
});

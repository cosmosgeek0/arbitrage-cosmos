#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

await import('./private-egress-tripwire.mjs');
const [{ default: WebSocket }, { default: guardedNet }] = await Promise.all([
  import('ws'),
  import('node:net'),
]);

const HOST = '127.0.0.1';
const REQUEST_TIMEOUT_MS = 5_000;
const TRIPWIRE_URL = new URL('./private-egress-tripwire.mjs', import.meta.url).href;
const RUNNER_PATH = fileURLToPath(new URL('./run-deterministic-network-free.mjs', import.meta.url));
const NEGATIVE_CONTROLS_ENV = 'I00_TEST_EGRESS_NEGATIVE_CONTROLS';

function optionalExactFlag(name) {
  const configured = process.env[name];
  if (configured === undefined) return false;
  if (configured === '1') return true;
  throw new TypeError(`${name} must be absent or exactly 1`);
}

const runNegativeControls = optionalExactFlag(NEGATIVE_CONTROLS_ENV);
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const supportsEventSource = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 3);
const HOSTILE_CONTROL_SOURCE = String.raw`
import { writeSync } from 'node:fs';
const control = process.env.I00_TEST_EGRESS_HOSTILE_CONTROL;
const fakeTransport = () => {
  throw new Error('FAKE_TRANSPORT_REACHED');
};
const fakeDispatcher = Object.freeze({ dispatch: fakeTransport });
const fakeAgent = (module) => {
  const agent = new module.Agent();
  agent.createConnection = fakeTransport;
  return agent;
};
const rejectingLookup = (_hostname, options, callback) => {
  const done = typeof options === 'function' ? options : callback;
  done(new Error('FAKE_TRANSPORT_REACHED'));
};
const controls = Object.freeze({
  FETCH: () => fetch('https://external.invalid/secret-path', { dispatcher: fakeDispatcher }),
  FETCH_LOOPBACK_DISPATCHER: () => fetch('http://127.0.0.1:43210/redirect-seed', {
    dispatcher: fakeDispatcher,
  }),
  WEBSOCKET: () => new WebSocket('wss://external.invalid/secret-path', { dispatcher: fakeDispatcher }),
  WEBSOCKET_CONSTRUCTOR: () => new WebSocket.prototype.constructor(
    'wss://external.invalid/secret-path',
    { dispatcher: fakeDispatcher },
  ),
  EVENTSOURCE: () => new EventSource('https://external.invalid/secret-path', { dispatcher: fakeDispatcher }),
  EVENTSOURCE_LOOPBACK: () => new EventSource('http://127.0.0.1:9/redirect-seed', { dispatcher: fakeDispatcher }),
  HTTP: async () => {
    const module = (await import('node:http')).default;
    return module.get({
      hostname: 'http-control.invalid',
      port: 80,
      path: '/secret-path',
      agent: fakeAgent(module),
    });
  },
  HTTPS: async () => {
    const module = (await import('node:https')).default;
    return module.get({
      hostname: 'https-control.invalid',
      port: 443,
      path: '/secret-path',
      agent: fakeAgent(module),
    });
  },
  HTTP_URL_OVERRIDE: async () => {
    const module = (await import('node:http')).default;
    return module.request(new URL('http://127.0.0.1:9/loopback-seed'), {
      hostname: 'override-control.invalid',
      agent: fakeAgent(module),
    });
  },
  HTTP_LOOPBACK_CREATE_CONNECTION: async () => {
    const module = (await import('node:http')).default;
    return module.request('http://127.0.0.1:43210/loopback-seed', {
      createConnection: fakeTransport,
    });
  },
  HTTP_LOOPBACK_CUSTOM_AGENT: async () => {
    const module = (await import('node:http')).default;
    return module.request('http://127.0.0.1:43210/loopback-seed', {
      agent: fakeAgent(module),
    });
  },
  HTTP_LOOPBACK_AGENT_ADD_REQUEST: async () => {
    const module = (await import('node:http')).default;
    const agent = new module.Agent();
    agent.addRequest = fakeTransport;
    return module.request('http://127.0.0.1:43210/loopback-seed', { agent });
  },
  HTTP_LOOPBACK_DEFAULT_AGENT: async () => {
    const module = (await import('node:http')).default;
    return module.request('http://127.0.0.1:43210/loopback-seed', {
      _defaultAgent: Object.freeze({
        protocol: 'http:',
        defaultPort: 80,
        addRequest: fakeTransport,
      }),
    });
  },
  CLIENT_REQUEST_CONSTRUCTOR: async () => {
    const module = (await import('node:http')).default;
    const Constructor = module.ClientRequest.prototype.constructor;
    return new Constructor({
      protocol: 'http:',
      hostname: 'client-request-control.invalid',
      port: 80,
      path: '/secret-path',
      agent: fakeAgent(module),
    });
  },
  DNS: async () => {
    const module = (await import('node:dns')).default;
    const resolver = new module.Resolver();
    resolver.setServers(['127.0.0.1:9']);
    return resolver.resolve4('dns-control.invalid', () => undefined);
  },
  DNS_RESOLVER_LOOPBACK: async () => {
    const module = (await import('node:dns')).default;
    const resolver = new module.Resolver();
    resolver.setServers(['127.0.0.1:9']);
    return resolver.resolve4('127.0.0.1', () => undefined);
  },
  DNS_RAW_INVALID: async () => {
    const module = (await import('node:dns')).default;
    const resolver = new module.Resolver();
    resolver.setServers(['127.0.0.1:9']);
    return resolver.resolve4('external.invalid.', () => undefined);
  },
  TCP: async () => (await import('node:net')).default.createConnection({
    host: 'tcp-control.invalid',
    port: 443,
    lookup: rejectingLookup,
  }),
  RAW_HOST_AUTHORITY: async () => (await import('node:net')).default.createConnection({
    host: 'external.invalid@127.0.0.1',
    port: 443,
    lookup: rejectingLookup,
  }),
  RAW_HOST_EMBEDDED_PORT: async () => (await import('node:net')).default.createConnection({
    host: '127.0.0.1:9999',
    port: 443,
    lookup: rejectingLookup,
  }),
  TLS: async () => (await import('node:tls')).default.connect(443, {
    host: 'tls-control.invalid',
    lookup: rejectingLookup,
  }),
  HTTP2: async () => (await import('node:http2')).default.connect(
    'https://http2-control.invalid',
    { createConnection: fakeTransport },
  ),
  HTTP2_SOCKET_PATH: async () => (await import('node:http2')).default.connect(
    'https://127.0.0.1:43210',
    { socketPath: '/tmp/fake-egress.sock', createConnection: fakeTransport },
  ),
  WORKER_EVAL_ESCAPE: async () => {
    const { Worker } = await import('node:worker_threads');
    return new Worker('process.exit(0)', { eval: true, execArgv: [] });
  },
  WORKER_PRELOAD_ESCAPE: async () => {
    const { Worker } = await import('node:worker_threads');
    return new Worker(new URL('data:text/javascript,process.exit(0)'), {
      execArgv: ['--import=data:text/javascript,globalThis.escapeAttempt=true'],
    });
  },
  WORKER_SHARE_ENV_ESCAPE: async () => {
    const { SHARE_ENV, Worker } = await import('node:worker_threads');
    return new Worker(new URL('data:text/javascript,process.exit(0)'), { env: SHARE_ENV });
  },
  SIGNED_FETCH: () => fetch('https://signed-control.invalid/account?signature=fake', {
    dispatcher: fakeDispatcher,
  }),
  AWS_FETCH: () => fetch('https://fixture.invalid.amazonaws.com/metadata', {
    dispatcher: fakeDispatcher,
  }),
});
if (typeof controls[control] !== 'function') throw new Error('HOSTILE_CONTROL_UNKNOWN');
let caught = null;
try {
  await controls[control]();
} catch (error) {
  caught = error;
}
if (caught?.code !== 'ERR_TEST_NETWORK_EGRESS_BLOCKED') {
  throw new Error('HOSTILE_CONTROL_WAS_NOT_BLOCKED:' + (caught?.message ?? 'NO_ERROR'));
}
writeSync(1, 'HOSTILE_CONTROL_CAUGHT_AND_CONTINUED\n');
process.exit(0);
`;
const RETRY_CONTROL_SOURCE = String.raw`
import { writeSync } from 'node:fs';
const dispatcher = Object.freeze({
  dispatch() {
    throw new Error('FAKE_TRANSPORT_REACHED');
  },
});
const caught = await Promise.all(Array.from({ length: 70 }, (_, index) => (
  fetch('https://external.invalid/retry/' + index + '?token=fake', { dispatcher }).then(
    () => false,
    (error) => error?.code === 'ERR_TEST_NETWORK_EGRESS_BLOCKED',
  )
)));
if (!caught.every(Boolean)) throw new Error('RETRY_CONTROL_WAS_NOT_BLOCKED');
writeSync(1, 'RETRY_CONTROL_CAUGHT_AND_CONTINUED\n');
process.exit(0);
`;
const HOSTILE_CASES = Object.freeze([
  Object.freeze({ control: 'FETCH', channel: 'FETCH', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'FETCH_LOOPBACK_DISPATCHER', channel: 'FETCH', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'WEBSOCKET', channel: 'WEBSOCKET', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'WEBSOCKET_CONSTRUCTOR', channel: 'WEBSOCKET', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  ...(supportsEventSource
    ? [
        Object.freeze({ control: 'EVENTSOURCE', channel: 'EVENTSOURCE', classification: 'EXTERNAL_NETWORK_REQUEST', eventSource: true }),
        Object.freeze({ control: 'EVENTSOURCE_LOOPBACK', channel: 'EVENTSOURCE', classification: 'EXTERNAL_NETWORK_REQUEST', eventSource: true }),
      ]
    : []),
  Object.freeze({ control: 'HTTP', channel: 'HTTP', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'HTTPS', channel: 'HTTPS', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'HTTP_URL_OVERRIDE', channel: 'HTTP', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'HTTP_LOOPBACK_CREATE_CONNECTION', channel: 'HTTP', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'HTTP_LOOPBACK_CUSTOM_AGENT', channel: 'HTTP', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'HTTP_LOOPBACK_AGENT_ADD_REQUEST', channel: 'HTTP', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'HTTP_LOOPBACK_DEFAULT_AGENT', channel: 'HTTP', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'CLIENT_REQUEST_CONSTRUCTOR', channel: 'HTTP', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'DNS', channel: 'DNS', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'DNS_RESOLVER_LOOPBACK', channel: 'DNS', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'DNS_RAW_INVALID', channel: 'DNS', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'TCP', channel: 'TCP', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'RAW_HOST_AUTHORITY', channel: 'TCP', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'RAW_HOST_EMBEDDED_PORT', channel: 'TCP', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'TLS', channel: 'TLS', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'HTTP2', channel: 'HTTP2', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'HTTP2_SOCKET_PATH', channel: 'HTTP2', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'WORKER_EVAL_ESCAPE', channel: 'WORKER', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'WORKER_PRELOAD_ESCAPE', channel: 'WORKER', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'WORKER_SHARE_ENV_ESCAPE', channel: 'WORKER', classification: 'EXTERNAL_NETWORK_REQUEST' }),
  Object.freeze({ control: 'SIGNED_FETCH', channel: 'FETCH', classification: 'SIGNED_OR_AUTHENTICATED_REQUEST' }),
  Object.freeze({ control: 'AWS_FETCH', channel: 'FETCH', classification: 'AWS_REQUEST' }),
]);

function readReport(reportPath) {
  return readFileSync(reportPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = createTcpServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('could not reserve a test port'));
        return;
      }
      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

const PORT = await availablePort();
const BASE = `http://127.0.0.1:${PORT}`;

function localFetch(pathname, init = {}) {
  return fetch(`${BASE}${pathname}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

function childFinished(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs = 12_000) {
  if (childFinished(child)) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off('close', onClose);
    };
    const onClose = (code, signal) => {
      cleanup();
      resolve({ code, signal });
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('server did not exit in time'));
    }, timeoutMs);
    child.once('close', onClose);
  });
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (childFinished(child)) throw new Error(`server exited during startup with ${child.exitCode ?? child.signalCode}`);
    try {
      const response = await localFetch('/api/health', { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('server did not become ready');
}

function openWebSocket(options = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}/ws`, {
      ...options,
      createConnection: guardedNet.connect,
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

test('loopback fetch refuses redirects before a second local dispatcher hop', async () => {
  let seedHits = 0;
  let targetHits = 0;
  const redirectServer = createHttpServer((request, response) => {
    if (request.url === '/redirect-seed') {
      seedHits += 1;
      response.writeHead(302, { location: '/redirect-target' });
      response.end();
      return;
    }
    if (request.url === '/redirect-target') targetHits += 1;
    response.writeHead(204);
    response.end();
  });
  await new Promise((resolve, reject) => {
    redirectServer.once('error', reject);
    redirectServer.listen(0, HOST, resolve);
  });
  try {
    const address = redirectServer.address();
    assert.equal(typeof address, 'object');
    await assert.rejects(fetch(`http://${HOST}:${address.port}/redirect-seed`, {
      redirect: 'follow',
    }));
    assert.equal(seedHits, 1);
    assert.equal(targetHits, 0);
  } finally {
    await new Promise((resolve, reject) => redirectServer.close((error) => {
      if (error) reject(error);
      else resolve();
    }));
  }
});

if (runNegativeControls) {
  test('deterministic network boundary makes every covered caught egress channel fail non-zero', {
    concurrency: false,
  }, () => {
    const temp = mkdtempSync(path.join(tmpdir(), 'cosmos-egress-proof-'));
    try {
      for (const hostile of HOSTILE_CASES) {
        const reportPath = path.join(temp, `${hostile.control}.jsonl`);
        const networkSentinel = path.join(temp, `${hostile.control}.network.log`);
        const privateSentinel = path.join(temp, `${hostile.control}.private.log`);
        const args = [
          ...(hostile.eventSource ? ['--experimental-eventsource'] : []),
          '--import',
          TRIPWIRE_URL,
          '--input-type=module',
          '--eval',
          HOSTILE_CONTROL_SOURCE,
        ];
        const child = spawnSync(process.execPath, args, {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODE_OPTIONS: '',
            I00_TEST_EGRESS_STRICT: '1',
            I00_TEST_EGRESS_REPORT_FILE: reportPath,
            I00_TEST_EGRESS_HOSTILE_CONTROL: hostile.control,
            NETWORK_EGRESS_SENTINEL_FILE: networkSentinel,
            PRIVATE_EGRESS_SENTINEL_FILE: privateSentinel,
          },
          encoding: 'utf8',
          timeout: 5_000,
        });

        assert.equal(child.error, undefined, `${hostile.control}: ${child.error?.message ?? ''}`);
        assert.equal(child.signal, null, `${hostile.control}: ${child.signal ?? ''}`);
        assert.equal(child.status, 86, `${hostile.control}: ${child.stderr}`);
        assert.match(child.stdout, /HOSTILE_CONTROL_CAUGHT_AND_CONTINUED/u);
        assert.match(
          child.stderr,
          new RegExp(`\\[TEST_EGRESS_ATTEMPT\\] ${hostile.channel} ${hostile.classification}`, 'u'),
        );

        const records = readReport(reportPath);
        assert.equal(records.some((record) => record.kind === 'INSTALL' && record.version === 2), true);
        const attempts = records.filter((record) => record.kind === 'ATTEMPT');
        assert.equal(attempts.length, 1, `${hostile.control}: ${JSON.stringify(records)}`);
        assert.equal(attempts[0].channel, hostile.channel);
        assert.equal(attempts[0].classification, hostile.classification);
        const redactedTarget = new URL(attempts[0].target);
        assert.equal(redactedTarget.username, '');
        assert.equal(redactedTarget.password, '');
        assert.equal(redactedTarget.search, '');
        assert.equal(['', '/'].includes(redactedTarget.pathname), true);
        const expectedSentinel = hostile.classification === 'EXTERNAL_NETWORK_REQUEST'
          ? networkSentinel
          : privateSentinel;
        const unexpectedSentinel = hostile.classification === 'EXTERNAL_NETWORK_REQUEST'
          ? privateSentinel
          : networkSentinel;
        assert.match(
          readFileSync(expectedSentinel, 'utf8'),
          new RegExp(`^${hostile.channel} ${hostile.classification} `, 'u'),
        );
        assert.equal(existsSync(unexpectedSentinel), false);
      }

      const retryReport = path.join(temp, 'RETRY_BURST.jsonl');
      const retrySentinel = path.join(temp, 'RETRY_BURST.network.log');
      const retryControl = spawnSync(process.execPath, [
        '--import',
        TRIPWIRE_URL,
        '--input-type=module',
        '--eval',
        RETRY_CONTROL_SOURCE,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_OPTIONS: '',
          I00_TEST_EGRESS_STRICT: '1',
          I00_TEST_EGRESS_REPORT_FILE: retryReport,
          NETWORK_EGRESS_SENTINEL_FILE: retrySentinel,
        },
        encoding: 'utf8',
        timeout: 5_000,
      });
      assert.equal(retryControl.error, undefined, retryControl.error?.message ?? '');
      assert.equal(retryControl.signal, null);
      assert.equal(retryControl.status, 86, retryControl.stderr);
      assert.match(retryControl.stdout, /RETRY_CONTROL_CAUGHT_AND_CONTINUED/u);
      const retryRecords = readReport(retryReport);
      assert.equal(retryRecords.filter((record) => record.kind === 'ATTEMPT').length, 64);
      assert.equal(retryRecords.filter((record) => record.kind === 'ATTEMPT_OVERFLOW').length, 1);
      assert.equal(
        retryControl.stderr.split('\n').filter((line) => line.startsWith('[TEST_EGRESS_')).length,
        65,
      );
      assert.equal(readFileSync(retrySentinel, 'utf8').trim().split('\n').length, 64);
      assert.equal(
        retryRecords.some((record) => (
          typeof record.target === 'string' && /retry|token|fake/u.test(record.target)
        )),
        false,
      );

      const auditEnvironment = { ...process.env };
      delete auditEnvironment.NODE_OPTIONS;
      delete auditEnvironment.I00_TEST_EGRESS_STRICT;
      delete auditEnvironment.I00_TEST_EGRESS_REPORT_FILE;
      delete auditEnvironment.NETWORK_EGRESS_SENTINEL_FILE;
      delete auditEnvironment.PRIVATE_EGRESS_SENTINEL_FILE;
      delete auditEnvironment.I00_TEST_EGRESS_NEGATIVE_CONTROLS;
      const auditControl = spawnSync(process.execPath, [RUNNER_PATH, '--hostile-fetch-control'], {
        cwd: process.cwd(),
        env: auditEnvironment,
        encoding: 'utf8',
        timeout: 5_000,
      });
      assert.equal(auditControl.error, undefined, auditControl.error?.message ?? '');
      assert.equal(auditControl.signal, null);
      assert.notEqual(auditControl.status, 0);
      assert.match(
        auditControl.stderr,
        /Deterministic egress audit: FAIL; TEST_EGRESS_FORBIDDEN_ATTEMPTS:1:FETCH:EXTERNAL_NETWORK_REQUEST:https:\/\/external\.invalid/u,
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
}

test('HTTP and WebSocket perimeter fails closed while preserving local operation', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-perimeter-'));
  const networkSentinel = path.join(dataDir, 'network-egress.log');
  const privateSentinel = path.join(dataDir, 'private-egress.log');
  const child = spawn(process.execPath, ['--import', TRIPWIRE_URL, 'server/dist/index.js'], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      PORT: String(PORT),
      HOST,
      DATA_DIR: dataDir,
      PROFILE_CACHE: path.join(dataDir, 'profile-cache.json'),
      ICON_CACHE: path.join(dataDir, 'icon-cache.json'),
      LIQ_CACHE: path.join(dataDir, 'liquidations.json'),
      SKIP_DOTENV: '1',
      NETWORK_EGRESS_SENTINEL_FILE: networkSentinel,
      PRIVATE_EGRESS_SENTINEL_FILE: privateSentinel,
      I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES: '1',
      I00_TEST_EGRESS_STRICT: '1',
      ...(process.env.I00_TEST_EGRESS_REPORT_FILE === undefined
        ? {}
        : { I00_TEST_EGRESS_REPORT_FILE: process.env.I00_TEST_EGRESS_REPORT_FILE }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-16_000); });
  child.stderr.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-16_000); });

  try {
    await waitForServer(child);

    const local = await localFetch('/api/health');
    assert.equal(local.status, 200);
    assert.equal(local.headers.get('x-powered-by'), null);
    assert.equal(local.headers.get('x-content-type-options'), 'nosniff');
    assert.match(local.headers.get('cache-control') ?? '', /private, no-store/);
    assert.equal(local.headers.get('etag'), null);
    const startupTruth = await localFetch('/health/live');
    assert.equal(startupTruth.status, 200);
    const startupBody = await startupTruth.json();
    assert.equal(startupBody.overallPosture, 'WARMING');
    assert.equal(startupBody.rootBlockerComponentId, 'public-spot-source');
    const mixedCaseApi = await localFetch('/API/health');
    assert.equal(mixedCaseApi.status, 200);
    assert.match(mixedCaseApi.headers.get('cache-control') ?? '', /private, no-store/);

    const forgedProxy = await localFetch('/api/health', { headers: { 'x-forwarded-for': '127.0.0.1' } });
    assert.equal(forgedProxy.status, 401);

    const protectedRouting = await localFetch('/api/notification-routing', {
      headers: { 'x-forwarded-for': '127.0.0.1' },
    });
    assert.equal(protectedRouting.status, 401);

    const foreignOrigin = await localFetch('/api/kill', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ on: true }),
    });
    assert.equal(foreignOrigin.status, 401);

    const malformed = await localFetch('/api/kill', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).code, 'INVALID_JSON');

    const oversized = await localFetch('/api/kill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on: true, padding: 'x'.repeat(200 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).code, 'BODY_TOO_LARGE');

    assert.equal((await localFetch('/api/events?limit=1.5')).status, 400);
    assert.equal((await localFetch('/api/events?limit=2001')).status, 400);
    assert.equal((await localFetch('/api/refresh', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).status, 400);
    const directRuntimeRestart = await localFetch('/api/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'market' }),
    });
    assert.equal(directRuntimeRestart.status, 409);
    assert.equal((await directRuntimeRestart.json()).code, 'CONTROL_PREVIEW_REQUIRED');
    const retiredLegacyKill = await localFetch('/api/kill', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: 'false' }),
    });
    assert.equal(retiredLegacyKill.status, 410);
    assert.equal((await retiredLegacyKill.json()).code, 'RETIRED');

    const unavailableLegacyPreview = await localFetch('/api/trade/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ malformed: true }),
    });
    assert.equal(unavailableLegacyPreview.status, 503);
    assert.equal((await unavailableLegacyPreview.json()).code, 'NOT_CONFIGURED');

    const symbols = Array.from({ length: 500 }, (_, index) => `X${index.toString(36).toUpperCase().padStart(3, '0')}USDT`);
    const blockedCoins = Array.from({ length: 40 }, (_, index) => `C${index.toString(36).toUpperCase().padStart(3, '0')}`);
    const configBeforeOperationalBypass = await (await localFetch('/api/config')).json();
    const boundaryConfig = await localFetch('/api/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staleOrderMaxMin: 43_200, allowedSymbols: symbols, borrowGuard: { blockedLoanCoins: blockedCoins } }),
    });
    assert.equal(boundaryConfig.status, 409);
    const blockedBoundaryConfig = await boundaryConfig.json();
    assert.equal(blockedBoundaryConfig.code, 'CONTROL_PREVIEW_REQUIRED');
    assert.deepEqual(blockedBoundaryConfig.fields, ['allowedSymbols', 'borrowGuard', 'staleOrderMaxMin']);
    assert.deepEqual(await (await localFetch('/api/config')).json(), configBeforeOperationalBypass);

    const displayConfig = await localFetch('/api/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ watchlist: symbols }),
    });
    assert.equal(displayConfig.status, 200);
    assert.equal((await displayConfig.json()).watchlist.length, 500);
    assert.equal((await localFetch('/api/config', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ staleOrderMaxMin: 43_201 }),
    })).status, 409);
    assert.equal((await localFetch('/api/config', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ watchlist: [...symbols, 'EXTRAUSDT'] }),
    })).status, 400);
    assert.equal((await localFetch('/api/config', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ borrowGuard: { blockedLoanCoins: [...blockedCoins, 'EXTRA'] } }),
    })).status, 409);

    await assert.rejects(openWebSocket({ origin: 'https://evil.example' }), /401|Unexpected server response/);
    const ws = await openWebSocket();
    const closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
    child.kill('SIGTERM');
    assert.equal(await closed, 1012);
    const exited = await waitForExit(child);
    assert.equal(exited.code, 0, logs);
    assert.equal(
      existsSync(networkSentinel),
      false,
      'the application child must attempt zero external public network calls over its complete lifetime',
    );
    assert.equal(
      existsSync(privateSentinel),
      false,
      'the keyless application child must attempt zero private, signed, or AWS egress over its complete lifetime',
    );
  } finally {
    if (!childFinished(child)) {
      child.kill('SIGTERM');
      await waitForExit(child).catch(async () => {
        if (!childFinished(child)) child.kill('SIGKILL');
        await waitForExit(child, 3_000).catch(() => undefined);
      });
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
});

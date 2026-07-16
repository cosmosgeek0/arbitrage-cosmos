#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dns from 'node:dns';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';

await import('./private-egress-tripwire.mjs');

const HOST = '127.0.0.1';
const REQUEST_TIMEOUT_MS = 5_000;

async function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
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
    const ws = new WebSocket(`ws://${HOST}:${PORT}/ws`, options);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

test('deterministic network boundary blocks public HTTP, raw socket, and DNS before transport', { concurrency: false }, async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'cosmos-egress-proof-'));
  const networkSentinel = path.join(temp, 'network-egress.log');
  const privateSentinel = path.join(temp, 'private-egress.log');
  process.env.NETWORK_EGRESS_SENTINEL_FILE = networkSentinel;
  process.env.PRIVATE_EGRESS_SENTINEL_FILE = privateSentinel;
  try {
    await assert.rejects(
      fetch('https://api.binance.com/api/v3/time'),
      (error) => error?.code === 'ERR_TEST_NETWORK_EGRESS_BLOCKED'
        && error?.message === 'PROHIBITED_EXTERNAL_EGRESS:EXTERNAL_NETWORK_REQUEST',
    );
    assert.throws(
      () => net.createConnection({ host: '1.1.1.1', port: 443 }),
      (error) => error?.code === 'ERR_TEST_NETWORK_EGRESS_BLOCKED'
        && error?.message === 'PROHIBITED_EXTERNAL_EGRESS:EXTERNAL_NETWORK_REQUEST',
    );
    assert.throws(
      () => dns.resolve4('api.binance.com', () => undefined),
      (error) => error?.code === 'ERR_TEST_NETWORK_EGRESS_BLOCKED'
        && error?.message === 'PROHIBITED_EXTERNAL_EGRESS:EXTERNAL_NETWORK_REQUEST',
    );
    await assert.rejects(
      fetch('https://api.binance.com/api/v3/account?signature=sentinel'),
      /PROHIBITED_PRIVATE_EGRESS:SIGNED_OR_AUTHENTICATED_REQUEST/,
    );
    await assert.rejects(
      fetch('http://169.254.169.254/latest/meta-data/'),
      /PROHIBITED_PRIVATE_EGRESS:AWS_REQUEST/,
    );

    const blockedNetwork = readFileSync(networkSentinel, 'utf8').trim().split('\n');
    assert.deepEqual(blockedNetwork, [
      'EXTERNAL_NETWORK_REQUEST api.binance.com/api/v3/time',
      'EXTERNAL_NETWORK_REQUEST 1.1.1.1/',
      'EXTERNAL_NETWORK_REQUEST api.binance.com/',
    ]);
    const blockedPrivate = readFileSync(privateSentinel, 'utf8').trim().split('\n');
    assert.deepEqual(blockedPrivate, [
      'SIGNED_OR_AUTHENTICATED_REQUEST api.binance.com/api/v3/account',
      'AWS_REQUEST 169.254.169.254/latest/meta-data/',
    ]);
  } finally {
    delete process.env.NETWORK_EGRESS_SENTINEL_FILE;
    delete process.env.PRIVATE_EGRESS_SENTINEL_FILE;
    rmSync(temp, { recursive: true, force: true });
  }
});

test('HTTP and WebSocket perimeter fails closed while preserving local operation', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-perimeter-'));
  const networkSentinel = path.join(dataDir, 'network-egress.log');
  const child = spawn(process.execPath, ['--import', './server/test/private-egress-tripwire.mjs', 'server/dist/index.js'], {
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

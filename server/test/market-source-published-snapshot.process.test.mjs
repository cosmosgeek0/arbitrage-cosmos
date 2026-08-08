import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const HOST = '127.0.0.1';

async function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('could not reserve a market snapshot test port'));
        return;
      }
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function finished(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs = 5_000) {
  if (finished(child)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('market snapshot child did not exit')),
      timeoutMs,
    );
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForServer(child, base, logs) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (finished(child)) {
      throw new Error(`market snapshot child exited during startup\n${logs()}`);
    }
    try {
      const response = await fetch(`${base}/health/live`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.status === 200) return;
    } catch {
      // The local listener is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`market snapshot child did not become reachable\n${logs()}`);
}

async function boundedJson(base, route, maximumMs = 2_000) {
  const startedAt = performance.now();
  const response = await fetch(`${base}${route}`, {
    signal: AbortSignal.timeout(maximumMs),
  });
  const elapsedMs = performance.now() - startedAt;
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(elapsedMs < maximumMs, `${route} took ${elapsedMs.toFixed(1)}ms`);
  return { body, elapsedMs };
}

function allSourceStates(body, expected) {
  assert.deepEqual(body.dataSources, {
    spotBookTicker: expected,
    futuresBookTicker: expected,
    futures24hTicker: expected,
  });
}

test('market publication treats future cache and observation timestamps as non-fresh', () => {
  const source = readFileSync('server/src/index.ts', 'utf8');
  assert.match(
    source,
    /cacheAgeMs !== null && cacheAgeMs >= 0 && cacheAgeMs < MARKET_SOURCE_REFRESH_MS/,
  );
  assert.match(
    source,
    /ageMs >= 0 && ageMs <= MARKET_SOURCE_REFRESH_MS \? 'fresh' : 'stale'/,
  );
});

test('Markets and Product boundedly await refresh before falling back to retained stale snapshots', {
  timeout: 30_000,
}, async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-market-published-snapshot-'));
  const logicalLeaseRoot = path.join(
    realpathSync.native(path.dirname(dataDir)),
    `${path.basename(dataDir)}-logical-lease-runtime`,
  );
  const attemptFile = path.join(dataDir, 'market-source-attempts.log');
  const port = await availablePort();
  const base = `http://${HOST}:${port}`;
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--import',
      './server/test/market-source-snapshot-fetch.preload.mjs',
      'server/src/index.ts',
    ],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        SKIP_DOTENV: '1',
        HOST,
        PORT: String(port),
        DATA_DIR: dataDir,
        DATA_DIR_LOGICAL_LEASE_ROOT: logicalLeaseRoot,
        PROFILE_CACHE: path.join(dataDir, 'profile-cache.json'),
        ICON_CACHE: path.join(dataDir, 'icon-cache.json'),
        LIQ_CACHE: path.join(dataDir, 'liquidations.json'),
        MARKET_SOURCE_ATTEMPT_FILE: attemptFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  const capture = (chunk) => { output = `${output}${chunk}`.slice(-32_000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const logs = () => output;

  try {
    await waitForServer(child, base, logs);

    const initialProduct = await boundedJson(
      base,
      '/api/product-integration/v1/supervisor',
    );
    assert.equal(initialProduct.body.schemaVersion, 'product-supervisor.v1');
    assert.equal(initialProduct.body.surfaces.markets.bindingState, 'BLOCKED_BACKEND');
    const initialFreshness = initialProduct.body.surfaces.markets.evidence
      .find((field) => field.fieldId === 'source-freshness');
    assert.equal(initialFreshness.value, null);
    assert.ok(
      ['UNAVAILABLE', 'MISSING', 'NOT_CONFIGURED', 'BLOCKED'].includes(initialFreshness.truthLabel),
      initialFreshness.truthLabel,
    );

    const initialMarkets = await boundedJson(base, '/api/markets');
    allSourceStates(initialMarkets.body, 'fresh');
    assert.equal(Number.isSafeInteger(initialMarkets.body.updatedAt), true);
    assert.equal(Array.isArray(initialMarkets.body.rows), true);

    const freshMarkets = initialMarkets;

    const staleAtMs = freshMarkets.body.updatedAt + 2_700;
    const remainingMs = staleAtMs - Date.now();
    if (remainingMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, remainingMs));
    }

    const staleMarkets = await boundedJson(base, '/api/markets');
    allSourceStates(staleMarkets.body, 'stale');
    assert.ok(
      staleMarkets.elapsedMs >= 750,
      `stale fallback returned before the bounded refresh wait: ${staleMarkets.elapsedMs.toFixed(1)}ms`,
    );
    assert.equal(
      staleMarkets.body.updatedAt,
      freshMarkets.body.updatedAt,
      'a detached refresh must not relabel the retained source observation',
    );

    const staleProduct = await boundedJson(
      base,
      '/api/product-integration/v1/supervisor',
    );
    const staleFreshness = staleProduct.body.surfaces.markets.evidence
      .find((field) => field.fieldId === 'source-freshness');
    assert.equal(staleFreshness.value, null);
    assert.notEqual(staleFreshness.truthLabel, 'LIVE_PUBLIC');

    const secondStale = await boundedJson(base, '/api/markets');
    allSourceStates(secondStale.body, 'stale');
    assert.equal(secondStale.body.updatedAt, freshMarkets.body.updatedAt);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const attempts = existsSync(attemptFile)
      ? readFileSync(attemptFile, 'utf8').trim().split('\n').filter(Boolean)
      : [];
    assert.deepEqual(
      Object.fromEntries([...new Set(attempts)].sort().map((key) => [
        key,
        attempts.filter((attempt) => attempt === key).length,
      ])),
      {
        'api.binance.com/api/v3/ticker/bookTicker': 2,
        'fapi.binance.com/fapi/v1/ticker/24hr': 1,
        'fapi.binance.com/fapi/v1/ticker/bookTicker': 2,
      },
      'repeated reads must coalesce behind one detached refresh',
    );

    await new Promise((resolve) => setTimeout(resolve, 10_500));
    let recoveredAttempts = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const afterDeadline = await boundedJson(base, '/api/markets');
      allSourceStates(afterDeadline.body, 'stale');
      await new Promise((resolve) => setTimeout(resolve, 50));
      recoveredAttempts = readFileSync(attemptFile, 'utf8').trim().split('\n').filter(Boolean);
      if (recoveredAttempts.filter(
        (entry) => entry === 'api.binance.com/api/v3/ticker/bookTicker',
      ).length === 3) break;
    }
    assert.deepEqual(
      Object.fromEntries([...new Set(recoveredAttempts)].sort().map((key) => [
        key,
        recoveredAttempts.filter((attempt) => attempt === key).length,
      ])),
      {
        'api.binance.com/api/v3/ticker/bookTicker': 3,
        'fapi.binance.com/fapi/v1/ticker/24hr': 2,
        'fapi.binance.com/fapi/v1/ticker/bookTicker': 3,
      },
      'a never-settling refresh must release its busy owner and admit one later retry',
    );
  } finally {
    if (!finished(child)) {
      child.kill('SIGKILL');
      await waitForExit(child).catch(() => undefined);
    }
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(logicalLeaseRoot, { recursive: true, force: true });
  }
});

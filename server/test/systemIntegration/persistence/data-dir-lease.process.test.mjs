import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { DataDirLease } from '../../../dist/systemIntegration/persistence/dataDirLease.js';

const HOST = '127.0.0.1';

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'cosmos-data-dir-lease-'));
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('could not reserve a DATA_DIR lease test port'));
        return;
      }
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function finished(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs = 10_000) {
  if (finished(child)) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DATA_DIR lease test child did not exit')), timeoutMs);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitForServer(child, base, logs) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (finished(child)) {
      throw new Error(`DATA_DIR lease owner exited during startup: ${logs()}`);
    }
    try {
      const response = await fetch(`${base}/health/live`, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) return;
    } catch {
      // Dependency startup is still converging.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`DATA_DIR lease owner did not become reachable: ${logs()}`);
}

function runtimeEnvironment(dataDir, port) {
  return {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    SKIP_DOTENV: '1',
    HOST,
    PORT: String(port),
    DATA_DIR: dataDir,
    PROFILE_CACHE: path.join(dataDir, 'profile-cache.json'),
    ICON_CACHE: path.join(dataDir, 'icon-cache.json'),
    LIQ_CACHE: path.join(dataDir, 'liquidations.json'),
    NETWORK_EGRESS_SENTINEL_FILE: path.join(dataDir, 'network-egress.log'),
    PRIVATE_EGRESS_SENTINEL_FILE: path.join(dataDir, 'private-egress.log'),
    I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES: '1',
    I00_TEST_EGRESS_STRICT: '1',
    ...(process.env.I00_TEST_EGRESS_REPORT_FILE === undefined
      ? {}
      : { I00_TEST_EGRESS_REPORT_FILE: process.env.I00_TEST_EGRESS_REPORT_FILE }),
  };
}

function spawnRuntime(dataDir, port) {
  const child = spawn(
    process.execPath,
    ['--import', './server/test/private-egress-tripwire.mjs', 'server/dist/index.js'],
    {
      cwd: process.cwd(),
      env: runtimeEnvironment(dataDir, port),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-24_000); });
  child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-24_000); });
  return { child, logs: () => output };
}

test('a second live process is rejected before it can share the canonical DATA_DIR', () => {
  const dataDir = tempDataDir();
  const first = new DataDirLease(dataDir);
  try {
    const leaseUrl = new URL(
      '../../../dist/systemIntegration/persistence/dataDirLease.js',
      import.meta.url,
    ).href;
    const source = `
      import { DataDirLease } from ${JSON.stringify(leaseUrl)};
      try {
        const lease = new DataDirLease(process.argv[1]);
        lease.release();
        process.stdout.write('SECOND_WRITER_ACQUIRED');
      } catch (error) {
        process.stdout.write(String(error?.code ?? error?.message ?? error));
        process.exitCode = 17;
      }
    `;
    const second = spawnSync(process.execPath, ['--input-type=module', '--eval', source, dataDir], {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(second.error, undefined);
    assert.equal(second.signal, null);
    assert.equal(second.status, 17, second.stderr || second.stdout);
    assert.equal(second.stdout, 'DATA_DIR_LEASE_HELD');
  } finally {
    first.release();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test(
  'a second complete application exits before advancing boot generation or opening a listener',
  { timeout: 30_000 },
  async () => {
    const dataDir = tempDataDir();
    const firstPort = await availablePort();
    const secondPort = await availablePort();
    const first = spawnRuntime(dataDir, firstPort);
    let second = null;
    try {
      await waitForServer(first.child, `http://${HOST}:${firstPort}`, first.logs);
      const before = new Database(path.join(dataDir, 'cosmos.db'), { readonly: true });
      try {
        assert.equal(
          before.prepare('SELECT COUNT(*) AS count FROM product_boot_release_revisions').get().count,
          1,
        );
      } finally {
        before.close();
      }

      second = spawnRuntime(dataDir, secondPort);
      const rejected = await waitForExit(second.child);
      assert.equal(rejected.code, 1, second.logs());
      assert.equal(rejected.signal, null, second.logs());
      assert.match(second.logs(), /DATA_DIR_LEASE_HELD/u);

      const ownerStillLive = await fetch(`http://${HOST}:${firstPort}/health/live`, {
        signal: AbortSignal.timeout(2_000),
      });
      assert.equal(ownerStillLive.status, 200);
      const after = new Database(path.join(dataDir, 'cosmos.db'), { readonly: true });
      try {
        assert.equal(
          after.prepare('SELECT COUNT(*) AS count FROM product_boot_release_revisions').get().count,
          1,
        );
      } finally {
        after.close();
      }

      first.child.kill('SIGTERM');
      const ownerExit = await waitForExit(first.child, 15_000);
      assert.equal(ownerExit.code, 0, first.logs());
      assert.equal(existsSync(path.join(dataDir, 'network-egress.log')), false);
      assert.equal(existsSync(path.join(dataDir, 'private-egress.log')), false);
    } finally {
      if (second !== null && !finished(second.child)) {
        second.child.kill('SIGKILL');
        await waitForExit(second.child, 3_000).catch(() => undefined);
      }
      if (!finished(first.child)) {
        first.child.kill('SIGKILL');
        await waitForExit(first.child, 3_000).catch(() => undefined);
      }
      rmSync(dataDir, { recursive: true, force: true });
    }
  },
);

test('a stale lease from a dead same-host process is recovered atomically', () => {
  const dataDir = tempDataDir();
  const leasePath = path.join(dataDir, 'cosmos.lease.db');
  const leaseDb = new Database(leasePath);
  try {
    leaseDb.exec(`
      CREATE TABLE data_dir_lease (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        owner_token TEXT NOT NULL,
        pid INTEGER NOT NULL,
        hostname TEXT NOT NULL,
        acquired_at_ms INTEGER NOT NULL,
        heartbeat_at_ms INTEGER NOT NULL
      )
    `);
    leaseDb.prepare(`
      INSERT INTO data_dir_lease
        (singleton, owner_token, pid, hostname, acquired_at_ms, heartbeat_at_ms)
      VALUES (1, ?, ?, ?, ?, ?)
    `).run(
      'dead-owner-token',
      2_147_483_647,
      hostname(),
      Date.now() - 120_000,
      Date.now() - 120_000,
    );
  } finally {
    leaseDb.close();
  }

  const lease = new DataDirLease(dataDir);
  try {
    const readback = new Database(leasePath, { readonly: true });
    try {
      const row = readback.prepare(`
        SELECT owner_token, pid, hostname, acquired_at_ms, heartbeat_at_ms
        FROM data_dir_lease WHERE singleton = 1
      `).get();
      assert.equal(row.pid, process.pid);
      assert.equal(row.hostname, hostname());
      assert.notEqual(row.owner_token, 'dead-owner-token');
      assert.ok(row.acquired_at_ms > Date.now() - 10_000);
      assert.ok(row.heartbeat_at_ms >= row.acquired_at_ms);
    } finally {
      readback.close();
    }
  } finally {
    lease.release();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('application bootstrap acquires the lease before Ledger and releases it only after durable finalization', () => {
  const source = readFileSync(new URL('../../../src/index.ts', import.meta.url), 'utf8');
  const leaseAcquisition = source.indexOf('const dataDirLease = new DataDirLease');
  const ledgerOpen = source.indexOf('return new Ledger(canonicalDataDir)');
  const bootMutation = source.indexOf('const bootReleaseStart = bootReleasePersistence.start()');
  const listenerAdmission = source.indexOf('server.listen(PORT, HOST');
  const durableFinalization = source.indexOf(
    'const finalization = finalizeSystemBootReleaseCleanShutdown',
  );
  const leaseRelease = source.indexOf('dataDirLease.release()', durableFinalization);
  assert.ok(leaseAcquisition > 0);
  assert.ok(ledgerOpen > leaseAcquisition);
  assert.ok(bootMutation > ledgerOpen);
  assert.ok(listenerAdmission > bootMutation);
  assert.ok(durableFinalization > listenerAdmission);
  assert.ok(leaseRelease > durableFinalization);
  assert.match(source, /onLost:\s*\(\)\s*=>\s*\{[\s\S]*?process\.exit\(1\)/u);
});

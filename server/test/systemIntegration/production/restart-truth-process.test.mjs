import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../../../dist/ledger.js';
import {
  SYSTEM_PERSISTENCE_CONFIG_KEY,
  SYSTEM_PERSISTENCE_EVENT_KIND,
  decodeSystemCheckpoint,
} from '../../../dist/systemIntegration/persistence/index.js';

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
        reject(new Error('could not reserve a restart test port'));
        return;
      }
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function finished(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs = 15_000) {
  if (finished(child)) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('restart test child did not exit')), timeoutMs);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitForServer(child, base) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (finished(child)) throw new Error(`restart test child exited during startup: ${child.exitCode ?? child.signalCode}`);
    try {
      const response = await fetch(`${base}/health/live`, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) return;
    } catch {
      // Dependency startup is still converging.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('restart test child did not become locally reachable');
}

async function runBoot(dataDir, sentinels) {
  const port = await availablePort();
  const base = `http://${HOST}:${port}`;
  const child = spawn(
    process.execPath,
    ['--import', './server/test/private-egress-tripwire.mjs', 'server/dist/index.js'],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        SKIP_DOTENV: '1',
        HOST,
        PORT: String(port),
        DATA_DIR: dataDir,
        PROFILE_CACHE: path.join(dataDir, 'profile-cache.json'),
        ICON_CACHE: path.join(dataDir, 'icon-cache.json'),
        LIQ_CACHE: path.join(dataDir, 'liquidations.json'),
        NETWORK_EGRESS_SENTINEL_FILE: sentinels.network,
        PRIVATE_EGRESS_SENTINEL_FILE: sentinels.private,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let logs = '';
  child.stdout.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-24_000); });
  child.stderr.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-24_000); });
  try {
    await waitForServer(child, base);
    const ready = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(2_000) });
    assert.equal(ready.status, 503);
    child.kill('SIGTERM');
    const exit = await waitForExit(child);
    assert.equal(exit.code, 0, logs);
  } finally {
    if (!finished(child)) {
      child.kill('SIGKILL');
      await waitForExit(child, 3_000).catch(() => undefined);
    }
  }
}

function durableSnapshot(dataDir) {
  const ledger = new Ledger(dataDir);
  try {
    const decoded = decodeSystemCheckpoint(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
    assert.equal(decoded.ok, true);
    const restartEvents = ledger.recentEvents(1_000, SYSTEM_PERSISTENCE_EVENT_KIND)
      .filter((event) => event.data.auditKind === 'RESTART_TRUTH');
    return { checkpoint: decoded.value, restartEventCount: restartEvents.length };
  } finally {
    ledger.close();
  }
}

test('production performs a durable fail-closed restart-truth refresh on each clean process boot', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-restart-truth-process-'));
  const sentinels = {
    network: path.join(dataDir, 'network-egress.log'),
    private: path.join(dataDir, 'private-egress.log'),
  };
  try {
    await runBoot(dataDir, sentinels);
    const first = durableSnapshot(dataDir);
    assert.equal(first.checkpoint.generation, 1);
    assert.equal(first.checkpoint.lastStartup.generation, 1);
    assert.equal(first.checkpoint.restartTruth.observedAtMs !== null, true);
    assert.equal(first.checkpoint.restartTruth.accountTruth, 'UNAVAILABLE');
    assert.notEqual(first.checkpoint.restartTruth.reconciliationTruth, 'FRESH');
    assert.equal(first.restartEventCount >= 2, true);

    await runBoot(dataDir, sentinels);
    const second = durableSnapshot(dataDir);
    assert.equal(second.checkpoint.generation, 2);
    assert.equal(second.checkpoint.lastStartup.generation, 2);
    assert.equal(second.checkpoint.lastStartup.restoredFromRevision, first.checkpoint.revision);
    assert.equal(second.checkpoint.restartTruth.observedAtMs !== null, true);
    assert.equal(second.checkpoint.restartTruth.accountTruth, 'UNAVAILABLE');
    assert.notEqual(second.checkpoint.restartTruth.reconciliationTruth, 'FRESH');
    assert.equal(second.restartEventCount >= first.restartEventCount + 2, true);
    assert.equal(existsSync(sentinels.network), false);
    assert.equal(existsSync(sentinels.private), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

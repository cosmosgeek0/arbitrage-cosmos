import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
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
const PUBLIC_HEALTH_KEYS = Object.freeze([
  'componentCount',
  'dependencyEdgeCount',
  'evaluatedAtMs',
  'executionBarrier',
  'kind',
  'lastMeaningfulAdvanceAtMs',
  'meaningfulAdvanceAgeMs',
  'meaningfulAdvanceOwnerComponentId',
  'ok',
  'overallPosture',
  'reasonCodes',
  'rootBlockerComponentId',
  'schemaVersion',
].sort());

function assertMinimalPublicHealth(body, kind) {
  assert.deepEqual(
    Object.keys(body).sort(),
    [...PUBLIC_HEALTH_KEYS, ...(kind === 'LIVE' ? ['okSemantics'] : [])].sort(),
    kind,
  );
  assert.equal(body.kind, kind);
  const bytes = JSON.stringify(body);
  for (const forbidden of [
    'serviceReadinessPolicy',
    'requiredServiceReadinessComponentIds',
    'excludedServiceReadinessComponentIds',
    'components',
    'edges',
    'rootCauses',
    'operatorAttentionQueue',
    'managedInventory',
    'READINESS-CLUSTER-001-Q-INFERENCE',
    'KEYLESS_PUBLIC_DATA_VALIDATE_ONLY',
    'Q_PRODUCTION_TRANSPORT_NOT_CONFIGURED',
    'cosmosgeek',
    '2026-10-18T00:00:00Z',
  ]) assert.equal(bytes.includes(forbidden), false, `${kind}:${forbidden}`);
}

async function getHealth(base, path, kind) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(2_000) });
  const body = await response.json();
  assertMinimalPublicHealth(body, kind);
  return { status: response.status, body };
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

async function runBoot(dataDir, sentinels, exerciseReadinessControl = false) {
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
        DATA_DIR_LOGICAL_LEASE_ROOT: path.join(
          realpathSync.native(path.dirname(dataDir)),
          `${path.basename(dataDir)}-logical-lease-runtime`,
        ),
        PROFILE_CACHE: path.join(dataDir, 'profile-cache.json'),
        ICON_CACHE: path.join(dataDir, 'icon-cache.json'),
        LIQ_CACHE: path.join(dataDir, 'liquidations.json'),
        NETWORK_EGRESS_SENTINEL_FILE: sentinels.network,
        PRIVATE_EGRESS_SENTINEL_FILE: sentinels.private,
        I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES: '1',
        I00_TEST_EGRESS_STRICT: '1',
        ...(process.env.I00_TEST_EGRESS_REPORT_FILE === undefined
          ? {}
          : { I00_TEST_EGRESS_REPORT_FILE: process.env.I00_TEST_EGRESS_REPORT_FILE }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let logs = '';
  child.stdout.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-24_000); });
  child.stderr.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-24_000); });
  try {
    await waitForServer(child, base);
    const live = await getHealth(base, '/health/live', 'LIVE');
    assert.equal(live.status, 200);
    const readyBefore = await getHealth(base, '/health/ready', 'READY');
    if (exerciseReadinessControl) {
      assert.equal(readyBefore.status, 503);
      const controlsResponse = await fetch(`${base}/api/system-integration/controls`, {
        signal: AbortSignal.timeout(2_000),
      });
      assert.equal(controlsResponse.status, 200, logs);
      const controls = await controlsResponse.json();
      assert.equal(controls.safeMode, 'READ_ONLY');
      assert.equal(Number.isSafeInteger(controls.revision), true);
      const mutationResponse = await fetch(`${base}/api/system-integration/controls`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'readiness.process.validate-only.0001',
        },
        body: JSON.stringify({
          command: 'SET_SAFE_MODE',
          expectedRevision: controls.revision,
          reason: 'Exercise the real production health and control transport',
          safeMode: 'VALIDATE_ONLY',
        }),
        signal: AbortSignal.timeout(5_000),
      });
      const mutation = await mutationResponse.json();
      assert.equal(mutationResponse.status, 200, JSON.stringify(mutation));
      assert.equal(mutation.ok, true);
      assert.equal(mutation.after.safeMode, 'VALIDATE_ONLY');

      let supervisor = null;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const supervisorResponse = await fetch(`${base}/api/system-integration/supervisor`, {
          signal: AbortSignal.timeout(2_000),
        });
        assert.equal(supervisorResponse.status, 200);
        supervisor = await supervisorResponse.json();
        const marketUniverse = supervisor.components.find((component) => component.componentId === 'market-universe');
        if (marketUniverse?.blockerCodes.includes('MARKET_UNIVERSE_START_REJECTED')) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(supervisor);
      const readyAfter = await getHealth(base, '/health/ready', 'READY');
      assert.equal(readyAfter.status, 503);
      assert.equal(readyAfter.body.ok, false);
      assert.equal(readyAfter.body.componentCount, 14);
      assert.equal(supervisor.components.length, 14);
      assert.equal(supervisor.serviceReadinessPolicy.status, 'VALID');
      assert.equal(supervisor.serviceReadinessPolicy.accepted, true);
      assert.equal(supervisor.serviceReadinessPolicy.waiver.id, 'READINESS-CLUSTER-001-Q-INFERENCE');
      assert.equal(supervisor.serviceReadinessPolicy.waiver.reason, 'Q_PRODUCTION_TRANSPORT_NOT_CONFIGURED');
      assert.equal(supervisor.serviceReadinessPolicy.waiver.expiresAt, '2026-10-18T00:00:00Z');
      const marketUniverse = supervisor.components.find((component) => component.componentId === 'market-universe');
      assert.notEqual(marketUniverse.readiness, 'READY');
      assert.ok(marketUniverse.blockerCodes.includes('MARKET_UNIVERSE_START_REJECTED'));
      for (const componentId of ['public-spot-source', 'public-usdm-source']) {
        const source = supervisor.components.find((component) => component.componentId === componentId);
        assert.equal(source.readiness, 'STOPPED', componentId);
        assert.ok(source.blockerCodes.includes('SOURCE_NOT_STARTED'), componentId);
        assert.ok(source.blockerCodes.includes('SOURCE_OBSERVATION_UNAVAILABLE'), componentId);
      }

      const productResponse = await fetch(`${base}/api/product-integration/v1/supervisor`, {
        signal: AbortSignal.timeout(2_000),
      });
      assert.equal(productResponse.status, 200);
      const product = await productResponse.json();
      assert.equal(product.components.length, 14);
      assert.equal(product.dashboard.components.length, 14);
      assert.equal(product.serviceReadinessPolicy.status, 'VALID');
      assert.equal(product.serviceReadinessPolicy.accepted, true);
      assert.equal(product.serviceReadinessPolicy.waiver.id, 'READINESS-CLUSTER-001-Q-INFERENCE');
      assert.equal(product.serviceReadinessPolicy.waiver.reason, 'Q_PRODUCTION_TRANSPORT_NOT_CONFIGURED');
      assert.equal(product.serviceReadinessPolicy.waiver.expiresAt, '2026-10-18T00:00:00Z');
      assert.equal(product.managedInventory.expectedIdentityCount, 33);
      assert.equal(product.managedInventory.entries.length, 33);
      assert.equal(product.managedInventory.canonicalComponentCount, 14);
      assert.equal(product.managedInventory.observedCanonicalComponentCount, 14);
    }
    const trade = await getHealth(base, '/health/trade-ready', 'TRADE_READY');
    assert.equal(trade.status, 503);
    assert.equal(trade.body.ok, false);
    assert.ok(trade.body.reasonCodes.includes('LIVE_EXECUTION_NOT_IMPLEMENTED'));
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

test('production preserves minimal fail-closed health routes and durable restart truth across clean boots', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-restart-truth-process-'));
  const sentinels = {
    network: path.join(dataDir, 'network-egress.log'),
    private: path.join(dataDir, 'private-egress.log'),
  };
  try {
    await runBoot(dataDir, sentinels, true);
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
    rmSync(path.join(
      realpathSync.native(path.dirname(dataDir)),
      `${path.basename(dataDir)}-logical-lease-runtime`,
    ), { recursive: true, force: true });
  }
});

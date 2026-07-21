import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProductIntegrationRuntime } from '../../../dist/productIntegration/runtime/index.js';
import { T0, makeBootReleaseReadback, makeRead } from './testSupport.mjs';

const HOST = '127.0.0.1';
const TESTED_SHA = 'a'.repeat(40);
const DEPLOYED_SHA = 'b'.repeat(40);

async function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('could not reserve a crash-readback test port'));
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
    const timer = setTimeout(() => reject(new Error('crash-readback test child did not exit')), timeoutMs);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitForServer(child, base, logs) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (finished(child)) {
      throw new Error(`crash-readback child exited during startup: ${child.exitCode ?? child.signalCode}\n${logs()}`);
    }
    try {
      const response = await fetch(`${base}/health/live`, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) return;
    } catch {
      // Dependency startup is still converging.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`crash-readback child did not become locally reachable\n${logs()}`);
}

async function startBoot(dataDir, sentinels) {
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
        I00_TESTED_SHA: TESTED_SHA,
        I00_DEPLOYED_SHA: DEPLOYED_SHA,
        I00_CONFIG_REVISION: 'crash-readback-config',
        I00_MODEL_REVISION: 'crash-readback-model',
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
    return { child, base, logs };
  } catch (error) {
    if (!finished(child)) {
      child.kill('SIGKILL');
      await waitForExit(child, 3_000).catch(() => undefined);
    }
    throw error;
  }
}

async function terminateBoot(boot, signal, expected) {
  boot.child.kill(signal);
  const exit = await waitForExit(boot.child);
  assert.deepEqual(exit, expected, boot.logs());
}

test('production g1 clean to g2 SIGKILL to g3 restart preserves crash-pending Product readback', { timeout: 60_000 }, async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-crash-readback-process-'));
  const sentinels = {
    network: path.join(dataDir, 'network-egress.log'),
    private: path.join(dataDir, 'private-egress.log'),
  };
  let activeBoot = null;
  try {
    activeBoot = await startBoot(dataDir, sentinels);
    await terminateBoot(activeBoot, 'SIGTERM', { code: 0, signal: null });
    activeBoot = null;

    activeBoot = await startBoot(dataDir, sentinels);
    await terminateBoot(activeBoot, 'SIGKILL', { code: null, signal: 'SIGKILL' });
    activeBoot = null;

    activeBoot = await startBoot(dataDir, sentinels);
    const response = await fetch(`${activeBoot.base}/api/product-integration/v1/supervisor`, {
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200, activeBoot.logs());
    const envelope = await response.json();
    const ready = await fetch(`${activeBoot.base}/health/ready`, {
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(ready.status, 503);

    assert.equal(envelope.ownerView.revisions.testedCommit, TESTED_SHA);
    assert.equal(envelope.ownerView.revisions.deployedCommit, DEPLOYED_SHA);
    assert.equal(envelope.ownerView.revisions.configRevision, 'crash-readback-config');
    assert.equal(envelope.ownerView.revisions.modelRevision, 'crash-readback-model');
    assert.equal(envelope.ownerView.machineReady, 'NO');
    assert.equal(envelope.dashboard.summaries.reconciliation.blocksNewExposure, true);
    assert.equal(envelope.bootReleaseReadback.source, 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE');
    assert.equal(envelope.bootReleaseReadback.state, 'AVAILABLE');
    assert.equal(envelope.bootReleaseReadback.latest.generation, 3);
    assert.equal(envelope.bootReleaseReadback.latest.operationId, 'system.application.boot.g3');
    assert.equal(envelope.bootReleaseReadback.latest.correlationId, 'system-boot-g3');
    assert.equal(envelope.bootReleaseReadback.latest.lifecycleState, 'ACTIVE');
    assert.equal(envelope.bootReleaseReadback.latest.deployedCommit, DEPLOYED_SHA);
    assert.equal(
      envelope.bootReleaseReadback.history.every((record) => record.deployedCommit === DEPLOYED_SHA),
      true,
    );
    assert.deepEqual(
      envelope.bootReleaseReadback.history.map((record) => [record.generation, record.lifecycleState]),
      [[3, 'ACTIVE'], [2, 'CRASH_PENDING'], [1, 'CLEAN_COMPLETED']],
    );
    const crashed = envelope.bootReleaseReadback.history.find((record) => record.generation === 2);
    assert.equal(crashed.operationId, 'system.application.boot.g2');
    assert.equal(crashed.correlationId, 'system-boot-g2');
    assert.equal(crashed.completedAtMs, null);
    assert.equal(crashed.clean, null);
    assert.deepEqual(envelope.bootReleaseReadback.crashPendingOperationIds, ['system.application.boot.g2']);
    assert.deepEqual(envelope.bootReleaseReadback.reasonCodes, ['CRASH_PENDING_BOOT_PRESENT']);
    assert.equal(envelope.bootReleaseReadback.reasonCodes.includes('DEPLOYED_COMMIT_UNKNOWN'), false);
    await terminateBoot(activeBoot, 'SIGTERM', { code: 0, signal: null });
    activeBoot = null;
    assert.equal(existsSync(sentinels.network), false);
    assert.equal(existsSync(sentinels.private), false);
  } finally {
    if (activeBoot && !finished(activeBoot.child)) {
      activeBoot.child.kill('SIGKILL');
      await waitForExit(activeBoot.child, 3_000).catch(() => undefined);
    }
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(path.join(
      realpathSync.native(path.dirname(dataDir)),
      `${path.basename(dataDir)}-logical-lease-runtime`,
    ), { recursive: true, force: true });
  }
});

test('Product boot-release read errors and malformed history remain explicitly unavailable', async () => {
  const base = makeRead();
  const unavailable = createProductIntegrationRuntime({
    read: Object.freeze({
      ...base,
      bootReleaseReadback: () => { throw new Error('readback unavailable'); },
    }),
    clock: { nowMs: () => T0 },
  });
  const unavailableEnvelope = await unavailable.readSupervisor();
  assert.deepEqual(unavailableEnvelope.bootReleaseReadback, {
    source: 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE',
    state: 'UNAVAILABLE',
    latest: null,
    history: [],
    crashPendingOperationIds: [],
    reasonCodes: ['BOOT_RELEASE_READBACK_UNAVAILABLE'],
  });

  const malformedPort = createProductIntegrationRuntime({
    read: Object.freeze({ ...base, bootReleaseReadback: () => undefined }),
    clock: { nowMs: () => T0 },
  });
  assert.deepEqual((await malformedPort.readSupervisor()).bootReleaseReadback, {
    source: 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE',
    state: 'UNAVAILABLE',
    latest: null,
    history: [],
    crashPendingOperationIds: [],
    reasonCodes: ['BOOT_RELEASE_READBACK_INVALID'],
  });

  const valid = makeBootReleaseReadback();
  const unboundedIssues = Object.freeze(Array.from(
    { length: 6 },
    () => 'DEPLOYED_COMMIT_UNKNOWN',
  ));
  const unboundedIssueRecord = Object.freeze({
    ...valid.latest,
    deployedCommit: null,
    identityState: 'PARTIAL',
    identityIssues: unboundedIssues,
  });
  const overlappingOlderRecord = Object.freeze({
    ...valid.latest,
    operationId: 'system.application.boot.g6',
    generation: 6,
    correlationId: 'system-boot-g6',
    ledgerEventId: 61,
    startedAtMs: valid.latest.startedAtMs - 1_000,
    completedAtMs: valid.latest.startedAtMs + 1,
    clean: true,
    lifecycleState: 'CLEAN_COMPLETED',
  });
  const historicalActiveRecord = Object.freeze({
    ...valid.latest,
    operationId: 'system.application.boot.g6',
    generation: 6,
    correlationId: 'system-boot-g6',
    ledgerEventId: 61,
    startedAtMs: valid.latest.startedAtMs - 1_000,
  });
  const invalidReadbacks = [
    Object.freeze({
      ...valid,
      history: Object.freeze(Array.from({ length: 21 }, () => valid.latest)),
    }),
    Object.freeze({
      ...valid,
      latest: Object.freeze({
        ...valid.latest,
        operationId: 'system.application.boot.g8',
        generation: 8,
        correlationId: 'system-boot-g8',
        ledgerEventId: 81,
      }),
    }),
    Object.freeze({
      ...valid,
      crashPendingOperationIds: Object.freeze(['system.application.boot.g2']),
      reasonCodes: Object.freeze(['CRASH_PENDING_BOOT_PRESENT']),
    }),
    Object.freeze({
      ...valid,
      latest: Object.freeze({
        ...valid.latest,
        completedAtMs: T0,
        clean: false,
      }),
      history: Object.freeze([Object.freeze({
        ...valid.latest,
        completedAtMs: T0,
        clean: false,
      })]),
    }),
    Object.freeze({
      ...valid,
      crashPendingOperationIds: Object.freeze(Array.from(
        { length: 21 },
        () => 'system.application.boot.g2',
      )),
      reasonCodes: Object.freeze(['CRASH_PENDING_BOOT_PRESENT']),
    }),
    Object.freeze({
      ...valid,
      latest: unboundedIssueRecord,
      history: Object.freeze([unboundedIssueRecord]),
      reasonCodes: unboundedIssues,
    }),
    Object.freeze({
      ...valid,
      latest: Object.freeze({
        ...valid.latest,
        schemaRevision: '9'.repeat(10_000),
      }),
      history: Object.freeze([Object.freeze({
        ...valid.latest,
        schemaRevision: '9'.repeat(10_000),
      })]),
    }),
    Object.freeze({
      ...valid,
      latest: Object.freeze({
        ...valid.latest,
        schemaRevision: '9999999999999999',
      }),
      history: Object.freeze([Object.freeze({
        ...valid.latest,
        schemaRevision: '9999999999999999',
      })]),
    }),
    Object.freeze({
      ...valid,
      latest: Object.freeze({
        ...valid.latest,
        configRevision: 'UNKNOWN_FORGED',
        modelRevision: 'NOT_CONFIGURED_FORGED',
      }),
      history: Object.freeze([Object.freeze({
        ...valid.latest,
        configRevision: 'UNKNOWN_FORGED',
        modelRevision: 'NOT_CONFIGURED_FORGED',
      })]),
    }),
    Object.freeze({
      ...valid,
      history: Object.freeze([valid.latest, overlappingOlderRecord]),
    }),
    Object.freeze({
      ...valid,
      history: Object.freeze([valid.latest, historicalActiveRecord]),
    }),
  ];
  for (const bootReleaseReadback of invalidReadbacks) {
    const malformed = createProductIntegrationRuntime({
      read: makeRead({ bootReleaseReadback }),
      clock: { nowMs: () => T0 },
    });
    const malformedEnvelope = await malformed.readSupervisor();
    assert.deepEqual(malformedEnvelope.bootReleaseReadback, {
      source: 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE',
      state: 'UNAVAILABLE',
      latest: null,
      history: [],
      crashPendingOperationIds: [],
      reasonCodes: ['BOOT_RELEASE_READBACK_INVALID'],
    });
    assert.deepEqual(malformedEnvelope.ownerView.revisions, {
      testedCommit: null,
      deployedCommit: null,
      modelRevision: null,
      configRevision: null,
      schemaRevision: 'product-supervisor.v1',
    });
  }
});

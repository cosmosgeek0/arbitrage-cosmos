import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../../../dist/ledger.js';
import {
  createSystemBootReleasePersistenceAdapter,
} from '../../../dist/systemIntegration/persistence/bootReleasePersistenceAdapter.js';

const HOST = '127.0.0.1';

function runtimeEnvironment(dataDir, port) {
  const logicalLeaseRoot = path.join(
    realpathSync.native(path.dirname(dataDir)),
    `${path.basename(dataDir)}-logical-lease-runtime`,
  );
  return {
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
    NETWORK_EGRESS_SENTINEL_FILE: path.join(dataDir, 'network-egress.log'),
    PRIVATE_EGRESS_SENTINEL_FILE: path.join(dataDir, 'private-egress.log'),
    I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES: '1',
    I00_TEST_EGRESS_STRICT: '1',
    ...(process.env.I00_TEST_EGRESS_REPORT_FILE === undefined
      ? {}
      : { I00_TEST_EGRESS_REPORT_FILE: process.env.I00_TEST_EGRESS_REPORT_FILE }),
  };
}

function waitForExit(child, timeoutMs = 60_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('boot-failure runtime child did not exit')),
      timeoutMs,
    );
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

test('a boot that refuses the listener exits non-zero so the supervisor observes the failure', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-boot-failure-exit-'));
  try {
    // Seed a legitimate durable boot revision, then poison its generation to
    // the safe-integer ceiling. The next boot cannot advance the generation
    // and must refuse to admit the listener.
    const ledger = new Ledger(dataDir);
    const adapter = createSystemBootReleasePersistenceAdapter({
      ledger,
      clock: { nowMs: () => Date.now() },
      environment: Object.freeze({}),
    });
    assert.equal(adapter.start().ok, true);
    ledger.db
      .prepare('UPDATE product_boot_release_revisions SET generation = ?')
      .run(Number.MAX_SAFE_INTEGER);
    ledger.close();

    const child = spawn(
      process.execPath,
      ['--import', './server/test/private-egress-tripwire.mjs', 'server/dist/index.js'],
      {
        cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..'),
        env: runtimeEnvironment(dataDir, 0),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-24_000); });
    child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-24_000); });

    const { code, signal } = await waitForExit(child);
    assert.equal(signal, null, output);
    assert.match(
      output,
      /control-room listener not admitted because durable boot failed/,
      output,
    );
    assert.notEqual(
      code,
      0,
      `a failed boot must not report success to the supervisor\n${output}`,
    );
    assert.equal(code, 1, output);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

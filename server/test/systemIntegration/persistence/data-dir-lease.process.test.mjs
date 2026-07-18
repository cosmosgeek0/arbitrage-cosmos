import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { arch, hostname, networkInterfaces, platform, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { DataDirLease } from '../../../dist/systemIntegration/persistence/dataDirLease.js';

const HOST = '127.0.0.1';
const LEASE_ROOT = '.cosmos-data-dir.lease.v1';
const LEASE_WITNESS_PREFIX = '.cosmos-data-dir.lease.candidate-';
const LEASE_SUCCESSOR_PREFIX = '.cosmos-data-dir.lease.next-';
const LEASE_DATABASE_FILES = Object.freeze([
  'cosmos.lease.db',
  'cosmos.lease.db-wal',
  'cosmos.lease.db-shm',
]);

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

function waitForLog(child, logs, pattern, timeoutMs = 10_000) {
  if (pattern.test(logs())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`DATA_DIR lease child log timeout: ${logs()}`)),
      timeoutMs,
    );
    const inspect = () => {
      if (pattern.test(logs())) {
        clearTimeout(timer);
        child.stdout.off('data', inspect);
        child.stderr.off('data', inspect);
        resolve();
      } else if (finished(child)) {
        clearTimeout(timer);
        child.stdout.off('data', inspect);
        child.stderr.off('data', inspect);
        reject(new Error(`DATA_DIR lease child exited early: ${logs()}`));
      }
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
  });
}

function spawnEval(source, ...args) {
  const child = spawn(
    process.execPath,
    ['--input-type=module', '--eval', source, ...args],
    { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-24_000); });
  child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-24_000); });
  return { child, logs: () => output };
}

function assertNoLeaseDatabase(dataDir) {
  for (const filename of LEASE_DATABASE_FILES) {
    assert.equal(existsSync(path.join(dataDir, filename)), false, filename);
  }
}

function currentHostIdentity() {
  const macs = [...new Set(Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal)
    .map((entry) => entry.mac.toLowerCase())
    .filter((mac) => /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/u.test(mac))
    .filter((mac) => mac !== '00:00:00:00:00:00'))].sort();
  assert.ok(macs.length > 0, 'stable test host identity requires a nonzero external MAC');
  return createHash('sha256').update(JSON.stringify({
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    macs,
  }), 'utf8').digest('hex');
}

function leaseArtifactNames(dataDir) {
  return readdirSync(dataDir)
    .filter((name) => name.startsWith('.cosmos-data-dir.lease.'))
    .sort();
}

function leaseRecord({
  ownerToken,
  predecessorToken = null,
  pid = 2_147_483_647,
  ownerHostname = hostname(),
  hostIdentity = currentHostIdentity(),
  acquiredAtMs = Date.now() - 1_000,
}) {
  return {
    schemaVersion: 1,
    ownerToken,
    predecessorToken,
    pid,
    hostname: ownerHostname,
    hostIdentity,
    acquiredAtMs,
  };
}

function writeLeaseRecord(recordPath, record) {
  writeFileSync(recordPath, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 });
}

function tokenDigest(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
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
    assertNoLeaseDatabase(dataDir);
    assert.deepEqual(leaseArtifactNames(dataDir), []);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('fresh bootstrap pins a parent-symlink DATA_DIR before lease, cache, and Ledger use', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cosmos-data-dir-physical-'));
  const parentA = path.join(root, 'physical-a');
  const parentB = path.join(root, 'physical-b');
  const dataDirA = path.join(parentA, 'data');
  const dataDirB = path.join(parentB, 'data');
  const parentAlias = path.join(root, 'configured-parent');
  mkdirSync(dataDirA, { recursive: true });
  mkdirSync(dataDirB, { recursive: true });
  symlinkSync(parentA, parentAlias, 'dir');

  const environmentUrl = new URL('../../../dist/bootstrap/environment.js', import.meta.url).href;
  const leaseUrl = new URL(
    '../../../dist/systemIntegration/persistence/dataDirLease.js',
    import.meta.url,
  ).href;
  const ledgerUrl = new URL('../../../dist/ledger.js', import.meta.url).href;
  const cacheOwnerUrls = [
    new URL('../../../dist/binance/icons.js', import.meta.url).href,
    new URL('../../../dist/binance/liquidations.js', import.meta.url).href,
    new URL('../../../dist/binance/profile.js', import.meta.url).href,
    new URL('../../../dist/services/newsContext.js', import.meta.url).href,
  ];
  const probe = `
    import { symlinkSync, unlinkSync } from 'node:fs';
    for (const url of ${JSON.stringify(cacheOwnerUrls)}) await import(url);
    const {
      DATA_DIR_AUTHORITY,
      assertDataDirAuthorityHeld,
      resolveDataDirAuthority,
    } = await import(
      ${JSON.stringify(environmentUrl)}
    );
    const { DataDirLease } = await import(${JSON.stringify(leaseUrl)});
    const { Ledger } = await import(${JSON.stringify(ledgerUrl)});
    const lease = new DataDirLease(DATA_DIR_AUTHORITY.dataDir);
    try {
      unlinkSync(process.argv[1]);
      symlinkSync(process.argv[2], process.argv[1], 'dir');
      assertDataDirAuthorityHeld(DATA_DIR_AUTHORITY);
      let secondWriter = 'UNSAFE_ACQUIRED';
      try {
        const second = new DataDirLease(DATA_DIR_AUTHORITY.dataDir);
        second.release();
      } catch (error) {
        secondWriter = String(error?.code ?? error?.message ?? error);
      }
      const ledger = new Ledger(DATA_DIR_AUTHORITY.dataDir);
      ledger.close();
      process.stdout.write('RESULT=' + JSON.stringify({
        authority: DATA_DIR_AUTHORITY,
        sameProcessAuthority: resolveDataDirAuthority() === DATA_DIR_AUTHORITY,
        secondWriter,
      }));
    } finally {
      lease.release();
    }
  `;
  const requestedDataDir = path.join(parentAlias, 'data');
  const env = {
    ...process.env,
    SKIP_DOTENV: '1',
    DATA_DIR: requestedDataDir,
    ICON_CACHE: path.join(requestedDataDir, 'icon-cache.json'),
    LIQ_CACHE: path.join(requestedDataDir, 'liquidations.json'),
    PROFILE_CACHE: path.join(requestedDataDir, 'profile-cache.json'),
  };

  try {
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', probe, parentAlias, parentB],
      { cwd: process.cwd(), env, encoding: 'utf8', timeout: 15_000 },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const marker = child.stdout.indexOf('RESULT=');
    assert.notEqual(marker, -1, child.stdout);
    const result = JSON.parse(child.stdout.slice(marker + 'RESULT='.length));
    const physicalDataDir = realpathSync.native(dataDirA);
    assert.deepEqual(result, {
      authority: {
        dataDir: physicalDataDir,
        iconCache: path.join(physicalDataDir, 'icon-cache.json'),
        liquidationCache: path.join(physicalDataDir, 'liquidations.json'),
        profileCache: path.join(physicalDataDir, 'profile-cache.json'),
        newsArchive: path.join(physicalDataDir, 'news-archive.json'),
      },
      sameProcessAuthority: true,
      secondWriter: 'DATA_DIR_LEASE_HELD',
    });
    assert.equal(realpathSync.native(parentAlias), realpathSync.native(parentB));
    assert.equal(existsSync(path.join(dataDirA, 'cosmos.db')), true);
    assert.equal(existsSync(path.join(dataDirB, 'cosmos.db')), false);
    assert.deepEqual(leaseArtifactNames(dataDirA), []);
    assert.deepEqual(leaseArtifactNames(dataDirB), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bootstrap identity replacement fails closed before Ledger or listener admission', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cosmos-data-dir-identity-'));
  const dataDir = path.join(root, 'data');
  const retainedDir = path.join(root, 'retained-owner-directory');
  mkdirSync(dataDir, { recursive: true });
  const environmentUrl = new URL('../../../dist/bootstrap/environment.js', import.meta.url).href;
  const leaseUrl = new URL(
    '../../../dist/systemIntegration/persistence/dataDirLease.js',
    import.meta.url,
  ).href;
  const ledgerUrl = new URL('../../../dist/ledger.js', import.meta.url).href;
  const probe = `
    import { mkdirSync, renameSync } from 'node:fs';
    import { createServer } from 'node:net';
    const { DATA_DIR_AUTHORITY, assertDataDirAuthorityHeld } = await import(
      ${JSON.stringify(environmentUrl)}
    );
    const { DataDirLease } = await import(${JSON.stringify(leaseUrl)});
    const { Ledger } = await import(${JSON.stringify(ledgerUrl)});
    new DataDirLease(DATA_DIR_AUTHORITY.dataDir);
    renameSync(DATA_DIR_AUTHORITY.dataDir, process.argv[1]);
    mkdirSync(DATA_DIR_AUTHORITY.dataDir, { recursive: true });
    try {
      assertDataDirAuthorityHeld(DATA_DIR_AUTHORITY);
      const ledger = new Ledger(DATA_DIR_AUTHORITY.dataDir);
      const listener = createServer();
      listener.listen(0, '127.0.0.1');
      ledger.close();
      process.stdout.write('UNSAFE_LEDGER_OR_LISTENER_ADMITTED');
    } catch (error) {
      process.stdout.write(String(error?.code ?? error?.message ?? error));
    }
  `;

  try {
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', probe, retainedDir],
      {
        cwd: process.cwd(),
        env: { ...process.env, SKIP_DOTENV: '1', DATA_DIR: dataDir },
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.equal(child.stdout, 'DATA_DIR_AUTHORITY_CHANGED');
    assert.equal(existsSync(path.join(dataDir, 'cosmos.db')), false);
    assert.equal(existsSync(path.join(retainedDir, 'cosmos.db')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
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
      await assert.rejects(fetch(`http://${HOST}:${secondPort}/health/live`, {
        signal: AbortSignal.timeout(500),
      }));

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
      assertNoLeaseDatabase(dataDir);
      assert.deepEqual(leaseArtifactNames(dataDir), []);
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

test(
  'a killed owner admits exactly one synchronized takeover and later reacquisition',
  { timeout: 30_000 },
  async () => {
    const dataDir = tempDataDir();
    const gatePath = path.join(dataDir, 'takeover.gate');
    const leaseUrl = new URL(
      '../../../dist/systemIntegration/persistence/dataDirLease.js',
      import.meta.url,
    ).href;
    const owner = spawnEval(`
      import { DataDirLease } from ${JSON.stringify(leaseUrl)};
      const lease = new DataDirLease(process.argv[1]);
      process.stdout.write('OWNER_READY');
      setInterval(() => lease.assertHeld(), 250);
    `, dataDir);
    try {
      await waitForLog(owner.child, owner.logs, /OWNER_READY/u);
      owner.child.kill('SIGKILL');
      const killed = await waitForExit(owner.child);
      assert.equal(killed.signal, 'SIGKILL', owner.logs());

      const contenderSource = `
        import { existsSync } from 'node:fs';
        import { setTimeout as delay } from 'node:timers/promises';
        import { DataDirLease } from ${JSON.stringify(leaseUrl)};
        while (!existsSync(process.argv[2])) await delay(2);
        try {
          const lease = new DataDirLease(process.argv[1]);
          process.stdout.write('TAKEOVER_ACQUIRED');
          await delay(1_000);
          lease.release();
        } catch (error) {
          process.stdout.write(String(error?.code ?? error?.message ?? error));
          process.exitCode = 17;
        }
      `;
      const contenders = Array.from({ length: 8 }, () => spawnEval(
        contenderSource,
        dataDir,
        gatePath,
      ));
      writeFileSync(gatePath, 'go\n', { flag: 'wx', mode: 0o600 });
      const outcomes = await Promise.all(contenders.map(async (contender) => ({
        ...(await waitForExit(contender.child)),
        output: contender.logs(),
      })));
      const winners = outcomes.filter((outcome) => outcome.code === 0);
      const rejected = outcomes.filter((outcome) => outcome.code === 17);
      assert.equal(winners.length, 1, JSON.stringify(outcomes));
      assert.match(winners[0].output, /TAKEOVER_ACQUIRED/u);
      assert.equal(rejected.length, 7, JSON.stringify(outcomes));
      for (const outcome of rejected) {
        assert.match(outcome.output, /DATA_DIR_LEASE_(?:BUSY|HELD)/u);
      }

      const later = new DataDirLease(dataDir);
      later.release();
      assertNoLeaseDatabase(dataDir);
      assert.deepEqual(leaseArtifactNames(dataDir), []);
    } finally {
      if (!finished(owner.child)) {
        owner.child.kill('SIGKILL');
        await waitForExit(owner.child, 3_000).catch(() => undefined);
      }
      rmSync(dataDir, { recursive: true, force: true });
    }
  },
);

test(
  'root removal retains a live witness, rejects an immediate app, and fails assertHeld synchronously',
  { timeout: 15_000 },
  async () => {
    const dataDir = tempDataDir();
    const port = await availablePort();
    let lostCount = 0;
    const lease = new DataDirLease(dataDir, { onLost: () => { lostCount += 1; } });
    let application = null;
    try {
      const rootPath = path.join(dataDir, LEASE_ROOT);
      unlinkSync(rootPath);
      const leaseUrl = new URL(
        '../../../dist/systemIntegration/persistence/dataDirLease.js',
        import.meta.url,
      ).href;
      const contender = spawnSync(process.execPath, ['--input-type=module', '--eval', `
        import { DataDirLease } from ${JSON.stringify(leaseUrl)};
        try {
          new DataDirLease(process.argv[1]);
          process.stdout.write('UNSAFE_ACQUIRED');
        } catch (error) {
          process.stdout.write(String(error?.code ?? error));
          process.exitCode = 17;
        }
      `, dataDir], { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
      assert.equal(contender.status, 17, contender.stderr || contender.stdout);
      assert.equal(contender.stdout, 'DATA_DIR_LEASE_HELD');

      application = spawnRuntime(dataDir, port);
      const rejected = await waitForExit(application.child);
      assert.equal(rejected.code, 1, application.logs());
      assert.match(application.logs(), /DATA_DIR_LEASE_HELD/u);
      assert.equal(existsSync(path.join(dataDir, 'cosmos.db')), false);
      await assert.rejects(fetch(`http://${HOST}:${port}/health/live`, {
        signal: AbortSignal.timeout(500),
      }));

      assert.throws(
        () => lease.assertHeld(),
        (error) => error?.code === 'DATA_DIR_LEASE_LOST',
      );
      assert.equal(lostCount, 1);
      assert.throws(
        () => lease.release(),
        (error) => error?.code === 'DATA_DIR_LEASE_LOST',
      );
      assert.equal(lostCount, 1);
      assert.equal(leaseArtifactNames(dataDir).length, 1);
      assert.match(leaseArtifactNames(dataDir)[0], new RegExp(`^${LEASE_WITNESS_PREFIX}`, 'u'));
      assertNoLeaseDatabase(dataDir);
    } finally {
      if (application !== null && !finished(application.child)) {
        application.child.kill('SIGKILL');
        await waitForExit(application.child, 3_000).catch(() => undefined);
      }
      rmSync(dataDir, { recursive: true, force: true });
    }
  },
);

test('release after root replacement marks loss and invokes its callback exactly once', () => {
  const dataDir = tempDataDir();
  let lostCount = 0;
  const lease = new DataDirLease(dataDir, { onLost: () => { lostCount += 1; } });
  try {
    const rootPath = path.join(dataDir, LEASE_ROOT);
    const bytes = readFileSync(rootPath);
    unlinkSync(rootPath);
    writeFileSync(rootPath, bytes, { flag: 'wx', mode: 0o600 });
    assert.throws(
      () => lease.release(),
      (error) => error?.code === 'DATA_DIR_LEASE_LOST',
    );
    assert.equal(lostCount, 1);
    assert.throws(
      () => lease.assertHeld(),
      (error) => error?.code === 'DATA_DIR_LEASE_LOST',
    );
    assert.equal(lostCount, 1);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('remote, corrupt, and future-dated lease records and witnesses all fail closed', () => {
  const cases = [
    {
      expectedCode: 'DATA_DIR_LEASE_REMOTE_HOST',
      record: leaseRecord({
        ownerToken: 'a'.repeat(36),
        pid: process.pid,
        ownerHostname: `${hostname()}-remote`,
        hostIdentity: 'c'.repeat(64),
      }),
    },
    {
      expectedCode: 'DATA_DIR_LEASE_REMOTE_HOST',
      record: leaseRecord({
        ownerToken: 'd'.repeat(36),
        ownerHostname: hostname(),
        hostIdentity: 'd'.repeat(64),
      }),
      witness: true,
    },
    { expectedCode: 'DATA_DIR_LEASE_BUSY', record: '{not-json' },
    {
      expectedCode: 'DATA_DIR_LEASE_BUSY',
      record: '{corrupt-witness',
      witness: true,
      witnessSuffix: 'e'.repeat(64),
    },
    {
      expectedCode: 'DATA_DIR_LEASE_HELD',
      record: leaseRecord({
        ownerToken: 'b'.repeat(36),
        acquiredAtMs: Date.now() + 60_000,
      }),
    },
  ];
  for (const entry of cases) {
    const dataDir = tempDataDir();
    try {
      writeFileSync(
        entry.witness
          ? path.join(dataDir, `${LEASE_WITNESS_PREFIX}${entry.witnessSuffix
            ?? tokenDigest(entry.record.ownerToken)}`)
          : path.join(dataDir, LEASE_ROOT),
        typeof entry.record === 'string' ? entry.record : `${JSON.stringify(entry.record)}\n`,
        { flag: 'wx', mode: 0o600 },
      );
      assert.throws(
        () => new DataDirLease(dataDir),
        (error) => error?.code === entry.expectedCode,
        entry.expectedCode,
      );
      assertNoLeaseDatabase(dataDir);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
});

test('witness and successor-chain bounds fail closed without deleting ambiguous debris', () => {
  const witnessDir = tempDataDir();
  const chainDir = tempDataDir();
  try {
    for (let index = 0; index < 257; index += 1) {
      writeFileSync(
        path.join(witnessDir, `${LEASE_WITNESS_PREFIX}${index.toString(16).padStart(64, '0')}`),
        'bounded-debris\n',
        { flag: 'wx', mode: 0o600 },
      );
    }
    assert.throws(
      () => new DataDirLease(witnessDir),
      (error) => error?.code === 'DATA_DIR_LEASE_BUSY',
    );
    assert.equal(leaseArtifactNames(witnessDir).length, 257);

    const hostIdentity = currentHostIdentity();
    const tokens = Array.from({ length: 65 }, (_, index) => tokenDigest(`chain-${index}`));
    for (let index = 0; index < tokens.length; index += 1) {
      const predecessorToken = index === 0 ? null : tokens[index - 1];
      const recordPath = index === 0
        ? path.join(chainDir, LEASE_ROOT)
        : path.join(chainDir, `${LEASE_SUCCESSOR_PREFIX}${tokenDigest(predecessorToken)}`);
      writeLeaseRecord(recordPath, leaseRecord({
        ownerToken: tokens[index],
        predecessorToken,
        hostIdentity,
      }));
    }
    assert.throws(
      () => new DataDirLease(chainDir),
      (error) => error?.code === 'DATA_DIR_LEASE_BUSY',
    );
    assert.equal(leaseArtifactNames(chainDir).length, 65);
  } finally {
    rmSync(witnessDir, { recursive: true, force: true });
    rmSync(chainDir, { recursive: true, force: true });
  }
});

test('application bootstrap acquires the lease before Ledger and releases it only after durable finalization', () => {
  const source = readFileSync(new URL('../../../src/index.ts', import.meta.url), 'utf8');
  const leaseAcquisition = source.indexOf('const dataDirLease = new DataDirLease');
  const authorityRevalidation = source.indexOf(
    'assertDataDirAuthorityHeld(DATA_DIR_AUTHORITY)',
  );
  const ledgerOpen = source.indexOf('return new Ledger(canonicalDataDir)');
  const bootMutation = source.indexOf('const bootReleaseStart = bootReleasePersistence.start()');
  const listenerAdmission = source.indexOf('server.listen(PORT, HOST');
  const durableFinalization = source.indexOf(
    'const finalization = finalizeSystemBootReleaseCleanShutdown',
  );
  const leaseRelease = source.indexOf('dataDirLease.release()', durableFinalization);
  assert.ok(leaseAcquisition > 0);
  assert.ok(authorityRevalidation > leaseAcquisition);
  assert.ok(ledgerOpen > authorityRevalidation);
  assert.ok(bootMutation > ledgerOpen);
  assert.ok(listenerAdmission > bootMutation);
  assert.ok(durableFinalization > listenerAdmission);
  assert.ok(leaseRelease > durableFinalization);
  assert.match(source, /onLost:\s*\(\)\s*=>\s*\{[\s\S]*?process\.exit\(1\)/u);
});

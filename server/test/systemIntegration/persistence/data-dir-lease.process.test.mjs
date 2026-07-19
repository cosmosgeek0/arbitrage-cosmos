import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { arch, hostname, networkInterfaces, platform, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { Ledger } from '../../../dist/ledger.js';
import { DataDirLease } from '../../../dist/systemIntegration/persistence/dataDirLease.js';

const HOST = '127.0.0.1';
const LEGACY_LEASE_ROOT = '.cosmos-data-dir.lease.v1';
const LEGACY_LEASE_WITNESS_PREFIX = '.cosmos-data-dir.lease.candidate-';
const LEGACY_LEASE_SUCCESSOR_PREFIX = '.cosmos-data-dir.lease.next-';
const LEASE_ROOT = '.cosmos-data-dir.lease.v2';
const LEASE_WITNESS_PREFIX = '.cosmos-data-dir.lease.v2.candidate-';
const LEASE_SUCCESSOR_PREFIX = '.cosmos-data-dir.lease.v2.next-';
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

function spawnLegacyLeaseOwner(dataDir) {
  return spawnEval(`
    import { createHash, randomUUID } from 'node:crypto';
    import {
      fchmodSync,
      fsyncSync,
      futimesSync,
      linkSync,
      openSync,
      writeSync,
    } from 'node:fs';
    import path from 'node:path';
    const nowMs = Date.now();
    const ownerToken = process.pid + ':' + nowMs + ':' + randomUUID();
    const record = Object.freeze({
      schemaVersion: 1,
      ownerToken,
      predecessorToken: null,
      pid: process.pid,
      hostname: process.argv[3],
      hostIdentity: process.argv[2],
      acquiredAtMs: nowMs,
    });
    const digest = createHash('sha256').update(ownerToken, 'utf8').digest('hex');
    const witness = path.join(
      process.argv[1],
      ${JSON.stringify(LEGACY_LEASE_WITNESS_PREFIX)} + digest,
    );
    const root = path.join(process.argv[1], ${JSON.stringify(LEGACY_LEASE_ROOT)});
    const fd = openSync(witness, 'wx+', 0o600);
    fchmodSync(fd, 0o600);
    const bytes = Buffer.from(JSON.stringify(record) + '\\n', 'utf8');
    let written = 0;
    while (written < bytes.length) {
      written += writeSync(fd, bytes, written, bytes.length - written, written);
    }
    fsyncSync(fd);
    linkSync(witness, root);
    process.stdout.write('LEGACY_OWNER_READY');
    setInterval(() => {
      const heartbeatMs = Date.now();
      futimesSync(fd, new Date(heartbeatMs), new Date(heartbeatMs));
    }, 2_000);
  `, dataDir, currentHostIdentity(), hostname());
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

function currentLivenessNamespace() {
  if (platform() !== 'linux') return `global:${platform()}`;
  const stats = statSync('/proc/self/ns/pid', { bigint: true });
  return `linux-pid:${stats.dev.toString(16)}:${stats.ino.toString(16)}`;
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
  livenessNamespace = currentLivenessNamespace(),
  acquiredAtMs = Date.now() - 1_000,
}) {
  return {
    schemaVersion: 2,
    ownerToken,
    predecessorToken,
    pid,
    hostname: ownerHostname,
    hostIdentity,
    livenessNamespace,
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

function runtimeLogicalLeaseRoot(dataDir) {
  return runtimeEnvironment(dataDir, 0).DATA_DIR_LOGICAL_LEASE_ROOT;
}

function logicalLeaseArtifactNames(logicalRoot) {
  if (!existsSync(logicalRoot)) return [];
  return readdirSync(logicalRoot, { withFileTypes: true }).flatMap((entry) => (
    entry.isDirectory()
      ? leaseArtifactNames(path.join(logicalRoot, entry.name))
      : [entry.name]
  )).sort();
}

function spawnRuntime(dataDir, port, environmentOverrides = {}) {
  const child = spawn(
    process.execPath,
    ['--import', './server/test/private-egress-tripwire.mjs', 'server/dist/index.js'],
    {
      cwd: process.cwd(),
      env: { ...runtimeEnvironment(dataDir, port), ...environmentOverrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-24_000); });
  child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-24_000); });
  return { child, logs: () => output };
}

test('different logical aliases to one physical DATA_DIR share the physical writer lease', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cosmos-data-dir-alias-dedup-'));
  const dataDir = path.join(root, 'physical-data');
  const dataDirAlias = path.join(root, 'logical-alias');
  mkdirSync(dataDir, { mode: 0o700 });
  symlinkSync(dataDir, dataDirAlias, 'dir');
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
    const second = spawnSync(process.execPath, ['--input-type=module', '--eval', source, dataDirAlias], {
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
    rmSync(root, { recursive: true, force: true });
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
      DATA_DIR_LEASE,
      resolveDataDirAuthority,
    } = await import(
      ${JSON.stringify(environmentUrl)}
    );
    const { DataDirLease } = await import(${JSON.stringify(leaseUrl)});
    const { Ledger } = await import(${JSON.stringify(ledgerUrl)});
    try {
      unlinkSync(process.argv[1]);
      symlinkSync(process.argv[2], process.argv[1], 'dir');
      DATA_DIR_LEASE.assertHeld();
      let secondWriter = 'UNSAFE_ACQUIRED';
      try {
        const second = new DataDirLease(DATA_DIR_AUTHORITY.dataDir);
        second.release();
      } catch (error) {
        secondWriter = String(error?.code ?? error?.message ?? error);
      }
      const ledger = new Ledger(DATA_DIR_AUTHORITY.dataDir, {
        beforeMutation: () => DATA_DIR_LEASE.assertHeld(),
      });
      ledger.close();
      process.stdout.write('RESULT=' + JSON.stringify({
        authority: DATA_DIR_AUTHORITY,
        sameProcessAuthority: resolveDataDirAuthority() === DATA_DIR_AUTHORITY,
        secondWriter,
      }));
    } finally {
      DATA_DIR_LEASE.release();
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
    DATA_DIR_LOGICAL_LEASE_ROOT: path.join(realpathSync.native(root), 'logical-runtime'),
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

test('an ASCII requested DATA_DIR may bind a Unicode physical root without widening cache names', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cosmos-data-dir-unicode-physical-'));
  const physicalRoot = realpathSync.native(root);
  const physicalDataDir = path.join(physicalRoot, 'Caf\u00e9-physical');
  const requestedDataDir = path.join(root, 'configured-data');
  const logicalRoot = path.join(physicalRoot, 'logical-runtime');
  mkdirSync(physicalDataDir, { recursive: true });
  symlinkSync(physicalDataDir, requestedDataDir, 'dir');
  const environmentUrl = new URL('../../../dist/bootstrap/environment.js', import.meta.url).href;
  const probe = `
    const { DATA_DIR_AUTHORITY, DATA_DIR_LEASE } = await import(
      ${JSON.stringify(environmentUrl)}
    );
    process.stdout.write(JSON.stringify(DATA_DIR_AUTHORITY));
    DATA_DIR_LEASE.release();
  `;
  try {
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        SKIP_DOTENV: '1',
        DATA_DIR: requestedDataDir,
        DATA_DIR_LOGICAL_LEASE_ROOT: logicalRoot,
      },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.deepEqual(JSON.parse(child.stdout), {
      dataDir: realpathSync.native(physicalDataDir),
      iconCache: path.join(realpathSync.native(physicalDataDir), 'icon_cache.json'),
      liquidationCache: path.join(realpathSync.native(physicalDataDir), 'liquidations.json'),
      profileCache: path.join(realpathSync.native(physicalDataDir), 'profile_cache.json'),
      newsArchive: path.join(realpathSync.native(physicalDataDir), 'news-archive.json'),
    });
    assert.deepEqual(leaseArtifactNames(physicalDataDir), []);
    assert.deepEqual(logicalLeaseArtifactNames(logicalRoot), []);
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
  const ledgerUrl = new URL('../../../dist/ledger.js', import.meta.url).href;
  const probe = `
    import { mkdirSync, renameSync, rmSync } from 'node:fs';
    import { createServer } from 'node:net';
    const { DATA_DIR_AUTHORITY, DATA_DIR_LEASE } = await import(
      ${JSON.stringify(environmentUrl)}
    );
    const { Ledger } = await import(${JSON.stringify(ledgerUrl)});
    renameSync(DATA_DIR_AUTHORITY.dataDir, process.argv[1]);
    mkdirSync(DATA_DIR_AUTHORITY.dataDir, { recursive: true });
    let result = 'UNSAFE_LEDGER_OR_LISTENER_ADMITTED';
    try {
      const ledger = new Ledger(DATA_DIR_AUTHORITY.dataDir, {
        beforeMutation: () => DATA_DIR_LEASE.assertHeld(),
      });
      const listener = createServer();
      listener.listen(0, '127.0.0.1');
      ledger.close();
    } catch (error) {
      result = String(error?.code ?? error?.message ?? error);
    } finally {
      rmSync(DATA_DIR_AUTHORITY.dataDir, { recursive: true, force: true });
      renameSync(process.argv[1], DATA_DIR_AUTHORITY.dataDir);
      DATA_DIR_LEASE.release();
    }
    process.stdout.write(result);
  `;

  try {
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', probe, retainedDir],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SKIP_DOTENV: '1',
          DATA_DIR: dataDir,
          DATA_DIR_LOGICAL_LEASE_ROOT: path.join(realpathSync.native(root), 'logical-runtime'),
        },
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

test('Ledger pre-mutation guard aborts before directory or SQLite creation', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cosmos-ledger-guard-'));
  const dataDir = path.join(root, 'not-created');
  let guardCalls = 0;
  try {
    assert.throws(
      () => new Ledger(dataDir, {
        beforeMutation: () => {
          guardCalls += 1;
          throw Object.assign(new Error('DATA_DIR_LEASE_LOST'), { code: 'DATA_DIR_LEASE_LOST' });
        },
      }),
      (error) => error?.code === 'DATA_DIR_LEASE_LOST',
    );
    assert.equal(guardCalls, 1);
    assert.equal(existsSync(dataDir), false);
    assert.equal(existsSync(path.join(dataDir, 'cosmos.db')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cache reservations reject ledger, lease, news, logical-root, and pairwise collisions before owners import', () => {
  const environmentUrl = new URL('../../../dist/bootstrap/environment.js', import.meta.url).href;
  const cases = [
    {
      name: 'literal LIQ_CACHE=cosmos.db',
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: () => ({ LIQ_CACHE: 'cosmos.db' }),
    },
    {
      name: 'case-folded Ledger database filename',
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: ({ dataDir }) => ({ ICON_CACHE: path.join(dataDir, 'Cosmos.db') }),
    },
    {
      name: 'case-folded Ledger database parent component',
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: ({ dataDir }) => ({
        PROFILE_CACHE: path.join(dataDir, 'Cosmos.db', 'profile.json'),
      }),
    },
    ...['cosmos.db-wal', 'cosmos.db-shm', 'COSMOS.DB-WAL', 'COSMOS.DB-SHM'].map((filename) => ({
      name: filename,
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: ({ dataDir }) => ({ LIQ_CACHE: path.join(dataDir, filename) }),
    })),
    ...['journal-compat.json', 'Journal-Compat.JSON'].map((filename) => ({
      name: filename,
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: ({ dataDir }) => ({ PROFILE_CACHE: path.join(dataDir, filename) }),
    })),
    {
      name: 'journal compatibility parent component',
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: ({ dataDir }) => ({
        ICON_CACHE: path.join(dataDir, 'Journal-Compat.JSON', 'icons.json'),
      }),
    },
    {
      name: 'DATA_DIR itself',
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: ({ dataDir }) => ({ ICON_CACHE: dataDir }),
    },
    ...[LEGACY_LEASE_ROOT, LEASE_ROOT].map((filename) => ({
      name: `physical lease root ${filename}`,
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: ({ dataDir }) => ({ PROFILE_CACHE: path.join(dataDir, filename) }),
    })),
    {
      name: 'physical lease root parent component',
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: ({ dataDir }) => ({
        PROFILE_CACHE: path.join(dataDir, LEASE_ROOT.toUpperCase(), 'profile.json'),
      }),
    },
    {
      name: 'candidate namespace',
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: ({ dataDir }) => ({
        LIQ_CACHE: path.join(dataDir, `${LEASE_WITNESS_PREFIX}${'a'.repeat(64)}`),
      }),
    },
    {
      name: 'candidate namespace parent component',
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: ({ dataDir }) => ({
        LIQ_CACHE: path.join(
          dataDir,
          `${LEASE_WITNESS_PREFIX.toUpperCase()}${'c'.repeat(64)}`,
          'liquidations.json',
        ),
      }),
    },
    {
      name: 'successor namespace',
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: ({ dataDir }) => ({
        PROFILE_CACHE: path.join(dataDir, `${LEASE_SUCCESSOR_PREFIX}${'b'.repeat(64)}`),
      }),
    },
    {
      name: 'successor namespace parent component',
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: ({ dataDir }) => ({
        PROFILE_CACHE: path.join(
          dataDir,
          `${LEASE_SUCCESSOR_PREFIX.toUpperCase()}${'d'.repeat(64)}`,
          'profile.json',
        ),
      }),
    },
    {
      name: 'news archive owner',
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: ({ dataDir }) => ({ ICON_CACHE: path.join(dataDir, 'news-archive.json') }),
    },
    {
      name: 'long-s Ledger alias is outside the ASCII cache policy',
      expected: 'DATA_DIR_CACHE_PATH_NON_ASCII',
      configure: ({ dataDir }) => ({
        PROFILE_CACHE: path.join(dataDir, 'co\u017Fmos.db', 'profile.json'),
      }),
    },
    {
      name: 'logical lease namespace',
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: ({ logicalRoot }) => ({ PROFILE_CACHE: logicalRoot }),
    },
    {
      name: 'pairwise mutable cache collision',
      expected: 'DATA_DIR_CACHE_PATH_COLLISION',
      configure: ({ dataDir }) => ({
        ICON_CACHE: path.join(dataDir, 'shared-cache.json'),
        LIQ_CACHE: path.join(dataDir, 'shared-cache.json'),
      }),
    },
    {
      name: 'ancestor and descendant mutable cache targets collide',
      expected: 'DATA_DIR_CACHE_PATH_COLLISION',
      configure: ({ dataDir }) => ({
        ICON_CACHE: path.join(dataDir, 'shared-cache'),
        LIQ_CACHE: path.join(dataDir, 'shared-cache', 'liquidations.json'),
      }),
    },
    {
      name: 'case-only pairwise mutable cache collision',
      expected: 'DATA_DIR_CACHE_PATH_COLLISION',
      configure: ({ dataDir }) => ({
        ICON_CACHE: path.join(dataDir, 'Shared-Cache.json'),
        LIQ_CACHE: path.join(dataDir, 'shared-cache.JSON'),
      }),
    },
    {
      name: 'NFC and NFD mutable cache names are outside the ASCII cache policy',
      expected: 'DATA_DIR_CACHE_PATH_NON_ASCII',
      configure: ({ dataDir }) => ({
        ICON_CACHE: path.join(dataDir, 'Caf\u00e9-cache.json'),
        LIQ_CACHE: path.join(dataDir, 'Cafe\u0301-cache.JSON'),
      }),
    },
    {
      name: 'Straße and strasse pairwise targets are outside the ASCII cache policy',
      expected: 'DATA_DIR_CACHE_PATH_NON_ASCII',
      configure: ({ dataDir }) => ({
        ICON_CACHE: path.join(dataDir, 'Stra\u00dFe', 'icons.json'),
        LIQ_CACHE: path.join(dataDir, 'strasse', 'icons.json'),
      }),
    },
  ];
  const probe = `
    try {
      await import(${JSON.stringify(environmentUrl)});
      process.stdout.write('UNSAFE_AUTHORITY_ADMITTED');
    } catch (error) {
      process.stdout.write(String(error?.code ?? error?.message ?? error));
    }
  `;

  for (const entry of cases) {
    const root = mkdtempSync(path.join(tmpdir(), 'cosmos-cache-reservation-'));
    const physicalRoot = realpathSync.native(root);
    const dataDir = path.join(physicalRoot, 'data');
    const logicalRoot = path.join(physicalRoot, 'logical-runtime');
    const configured = entry.configure({ root: physicalRoot, dataDir, logicalRoot });
    try {
      const child = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
        cwd: physicalRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          SKIP_DOTENV: '1',
          DATA_DIR: dataDir,
          DATA_DIR_LOGICAL_LEASE_ROOT: logicalRoot,
          ...configured,
        },
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.equal(child.status, 0, `${entry.name}: ${child.stderr || child.stdout}`);
      assert.equal(child.stdout, entry.expected, entry.name);
      assert.equal(existsSync(path.join(dataDir, 'cosmos.db')), false, entry.name);
      if (entry.name !== 'logical lease namespace') {
        assert.equal(existsSync(dataDir), false, `${entry.name}: DATA_DIR write`);
        assert.equal(existsSync(logicalRoot), false, `${entry.name}: logical lease write`);
      }
      for (const cacheKey of ['ICON_CACHE', 'LIQ_CACHE', 'PROFILE_CACHE']) {
        if (configured[cacheKey] === undefined) continue;
        const target = path.resolve(physicalRoot, configured[cacheKey]);
        if (existsSync(target)) assert.equal(lstatSync(target).isFile(), false, entry.name);
      }
      if (existsSync(dataDir)) assert.deepEqual(leaseArtifactNames(dataDir), [], entry.name);
      assert.deepEqual(logicalLeaseArtifactNames(logicalRoot), [], entry.name);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('phase-zero rejects a later external cache before absent DATA_DIR or logical-root creation', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cosmos-cache-phase-zero-'));
  const physicalRoot = realpathSync.native(root);
  const dataDir = path.join(physicalRoot, 'absent-data');
  const logicalRoot = path.join(physicalRoot, 'absent-logical-root');
  const externalParent = path.join(physicalRoot, 'external');
  const externalProfile = path.join(externalParent, 'profiles.json');
  mkdirSync(externalParent, { recursive: true });
  const environmentUrl = new URL('../../../dist/bootstrap/environment.js', import.meta.url).href;
  const probe = `
    try {
      await import(${JSON.stringify(environmentUrl)});
      process.stdout.write('UNSAFE_AUTHORITY_ADMITTED');
    } catch (error) {
      process.stdout.write(String(error?.code ?? error?.message ?? error));
    }
  `;
  try {
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd: physicalRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        SKIP_DOTENV: '1',
        DATA_DIR: dataDir,
        DATA_DIR_LOGICAL_LEASE_ROOT: logicalRoot,
        PROFILE_CACHE: externalProfile,
      },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.equal(child.stdout, 'DATA_DIR_CACHE_PATH_OUTSIDE_DATA_DIR');
    assert.equal(existsSync(dataDir), false);
    assert.equal(existsSync(logicalRoot), false);
    assert.equal(existsSync(externalProfile), false);
    assert.deepEqual(readdirSync(externalParent), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('existing cache hard links cannot alias another cache or a reserved owner inode', () => {
  const environmentUrl = new URL('../../../dist/bootstrap/environment.js', import.meta.url).href;
  const probe = `
    try {
      await import(${JSON.stringify(environmentUrl)});
      process.stdout.write('UNSAFE_AUTHORITY_ADMITTED');
    } catch (error) {
      process.stdout.write(String(error?.code ?? error?.message ?? error));
    }
  `;
  const cases = [
    {
      name: 'icons and profile caches',
      prepare: (dataDir) => {
        const iconCache = path.join(dataDir, 'icons.json');
        const profileCache = path.join(dataDir, 'profiles.json');
        writeFileSync(iconCache, '{}\n', { flag: 'wx', mode: 0o600 });
        linkSync(iconCache, profileCache);
        return { ICON_CACHE: iconCache, PROFILE_CACHE: profileCache };
      },
    },
    {
      name: 'profile cache and Ledger database owner',
      prepare: (dataDir) => {
        const ledgerDatabase = path.join(dataDir, 'cosmos.db');
        const profileCache = path.join(dataDir, 'profiles.json');
        writeFileSync(ledgerDatabase, 'reserved-owner\n', { flag: 'wx', mode: 0o600 });
        linkSync(ledgerDatabase, profileCache);
        return { PROFILE_CACHE: profileCache };
      },
    },
  ];
  for (const entry of cases) {
    const root = mkdtempSync(path.join(tmpdir(), 'cosmos-cache-hardlink-'));
    const physicalRoot = realpathSync.native(root);
    const dataDir = path.join(physicalRoot, 'data');
    const logicalRoot = path.join(physicalRoot, 'logical-runtime');
    mkdirSync(dataDir, { recursive: true });
    const configured = entry.prepare(dataDir);
    try {
      const child = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
        cwd: physicalRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          SKIP_DOTENV: '1',
          DATA_DIR: dataDir,
          DATA_DIR_LOGICAL_LEASE_ROOT: logicalRoot,
          ...configured,
        },
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.equal(child.status, 0, `${entry.name}: ${child.stderr || child.stdout}`);
      assert.equal(child.stdout, 'DATA_DIR_CACHE_PATH_COLLISION', entry.name);
      assert.equal(existsSync(logicalRoot), false, entry.name);
      assert.deepEqual(leaseArtifactNames(dataDir), [], entry.name);
      const targets = Object.values(configured);
      if (targets.length === 2) {
        assert.equal(statSync(targets[0]).dev, statSync(targets[1]).dev, entry.name);
        assert.equal(statSync(targets[0]).ino, statSync(targets[1]).ino, entry.name);
      } else {
        const ledgerDatabase = path.join(dataDir, 'cosmos.db');
        assert.equal(statSync(targets[0]).dev, statSync(ledgerDatabase).dev, entry.name);
        assert.equal(statSync(targets[0]).ino, statSync(ledgerDatabase).ino, entry.name);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('physical cache-parent aliases cannot create beneath reserved or non-ASCII components', () => {
  const environmentUrl = new URL('../../../dist/bootstrap/environment.js', import.meta.url).href;
  const probe = `
    try {
      await import(${JSON.stringify(environmentUrl)});
      process.stdout.write('UNSAFE_AUTHORITY_ADMITTED');
    } catch (error) {
      process.stdout.write(String(error?.code ?? error?.message ?? error));
    }
  `;
  const cases = [
    { component: 'Cosmos.db', expected: 'DATA_DIR_CACHE_PATH_RESERVED' },
    { component: 'Stra\u00dFe', expected: 'DATA_DIR_CACHE_PATH_NON_ASCII' },
  ];

  for (const entry of cases) {
    const root = mkdtempSync(path.join(tmpdir(), 'cosmos-cache-physical-policy-'));
    const physicalRoot = realpathSync.native(root);
    const dataDir = path.join(physicalRoot, 'data');
    const guardedParent = path.join(dataDir, entry.component);
    const alias = path.join(dataDir, 'apparently-safe-parent');
    const missingParent = path.join(guardedParent, 'must-not-be-created');
    mkdirSync(guardedParent, { recursive: true });
    symlinkSync(guardedParent, alias, 'dir');
    try {
      const child = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
        cwd: physicalRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          SKIP_DOTENV: '1',
          DATA_DIR: dataDir,
          DATA_DIR_LOGICAL_LEASE_ROOT: path.join(physicalRoot, 'logical-runtime'),
          PROFILE_CACHE: path.join(alias, 'must-not-be-created', 'profile.json'),
        },
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.equal(child.status, 0, `${entry.component}: ${child.stderr || child.stdout}`);
      assert.equal(child.stdout, entry.expected, entry.component);
      assert.equal(existsSync(missingParent), false, `${entry.component}: parent debris`);
      assert.deepEqual(leaseArtifactNames(dataDir), [], entry.component);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('the complete prospective cache set fails before any earlier valid parent is created', () => {
  const environmentUrl = new URL('../../../dist/bootstrap/environment.js', import.meta.url).href;
  const probe = `
    try {
      await import(${JSON.stringify(environmentUrl)});
      process.stdout.write('UNSAFE_AUTHORITY_ADMITTED');
    } catch (error) {
      process.stdout.write(String(error?.code ?? error?.message ?? error));
    }
  `;
  const cases = [
    {
      name: 'later outside target',
      expected: 'DATA_DIR_CACHE_PATH_OUTSIDE_DATA_DIR',
      configure: ({ root, firstParent }) => {
        const externalParent = path.join(root, 'external-must-not-be-created');
        return {
          environment: { LIQ_CACHE: path.join(externalParent, 'nested', 'liquidations.json') },
          absent: [firstParent, externalParent],
        };
      },
    },
    {
      name: 'later reserved physical parent',
      expected: 'DATA_DIR_CACHE_PATH_RESERVED',
      configure: ({ dataDir, firstParent }) => {
        const guardedParent = path.join(dataDir, 'Cosmos.db');
        const alias = path.join(dataDir, 'reserved-parent-alias');
        const missingParent = path.join(guardedParent, 'must-not-be-created');
        mkdirSync(guardedParent, { recursive: true });
        symlinkSync(guardedParent, alias, 'dir');
        return {
          environment: { LIQ_CACHE: path.join(alias, 'must-not-be-created', 'liquidations.json') },
          absent: [firstParent, missingParent],
        };
      },
    },
    {
      name: 'later non-ASCII physical parent',
      expected: 'DATA_DIR_CACHE_PATH_NON_ASCII',
      configure: ({ dataDir, firstParent }) => {
        const guardedParent = path.join(dataDir, 'Stra\u00dFe');
        const alias = path.join(dataDir, 'unicode-parent-alias');
        const missingParent = path.join(guardedParent, 'must-not-be-created');
        mkdirSync(guardedParent, { recursive: true });
        symlinkSync(guardedParent, alias, 'dir');
        return {
          environment: { LIQ_CACHE: path.join(alias, 'must-not-be-created', 'liquidations.json') },
          absent: [firstParent, missingParent],
        };
      },
    },
    {
      name: 'later invalid directory target',
      expected: 'DATA_DIR_CACHE_PATH_INVALID',
      configure: ({ dataDir, firstParent }) => {
        const invalidTarget = path.join(dataDir, 'invalid-cache-target');
        mkdirSync(invalidTarget, { recursive: true });
        return {
          environment: { LIQ_CACHE: invalidTarget },
          absent: [firstParent],
        };
      },
    },
    {
      name: 'later physical equality collision',
      expected: 'DATA_DIR_CACHE_PATH_COLLISION',
      configure: ({ dataDir }) => {
        const sharedParent = path.join(dataDir, 'shared-physical-parent');
        const firstAlias = path.join(dataDir, 'first-physical-alias');
        const secondAlias = path.join(dataDir, 'second-physical-alias');
        const missingParent = path.join(sharedParent, 'must-not-be-created');
        mkdirSync(sharedParent, { recursive: true });
        symlinkSync(sharedParent, firstAlias, 'dir');
        symlinkSync(sharedParent, secondAlias, 'dir');
        return {
          environment: {
            ICON_CACHE: path.join(firstAlias, 'must-not-be-created', 'shared.json'),
            LIQ_CACHE: path.join(secondAlias, 'must-not-be-created', 'shared.json'),
          },
          absent: [missingParent],
        };
      },
    },
    {
      name: 'later physical containment collision',
      expected: 'DATA_DIR_CACHE_PATH_COLLISION',
      configure: ({ dataDir }) => {
        const sharedParent = path.join(dataDir, 'shared-containment-parent');
        const firstAlias = path.join(dataDir, 'first-containment-alias');
        const secondAlias = path.join(dataDir, 'second-containment-alias');
        const missingTarget = path.join(sharedParent, 'must-not-be-created');
        mkdirSync(sharedParent, { recursive: true });
        symlinkSync(sharedParent, firstAlias, 'dir');
        symlinkSync(sharedParent, secondAlias, 'dir');
        return {
          environment: {
            ICON_CACHE: path.join(firstAlias, 'must-not-be-created'),
            LIQ_CACHE: path.join(secondAlias, 'must-not-be-created', 'liquidations.json'),
          },
          absent: [missingTarget],
        };
      },
    },
  ];

  for (const entry of cases) {
    const root = mkdtempSync(path.join(tmpdir(), 'cosmos-cache-set-preflight-'));
    const physicalRoot = realpathSync.native(root);
    const dataDir = path.join(physicalRoot, 'data');
    const firstParent = path.join(dataDir, 'first-valid-parent');
    mkdirSync(dataDir, { recursive: true });
    const configured = entry.configure({ root: physicalRoot, dataDir, firstParent });
    try {
      const child = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
        cwd: physicalRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          SKIP_DOTENV: '1',
          DATA_DIR: dataDir,
          DATA_DIR_LOGICAL_LEASE_ROOT: path.join(physicalRoot, 'logical-runtime'),
          ICON_CACHE: path.join(firstParent, 'icons.json'),
          ...configured.environment,
        },
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.equal(child.status, 0, `${entry.name}: ${child.stderr || child.stdout}`);
      assert.equal(child.stdout, entry.expected, entry.name);
      for (const absentPath of configured.absent) {
        assert.equal(existsSync(absentPath), false, `${entry.name}: ${absentPath}`);
      }
      assert.deepEqual(leaseArtifactNames(dataDir), [], entry.name);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('nested configured cache parent is physically pinned and replacement fails before write', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cosmos-cache-parent-pin-'));
  const physicalRoot = realpathSync.native(root);
  const dataDir = path.join(physicalRoot, 'data');
  const cacheA = path.join(dataDir, 'cache-a');
  const cacheB = path.join(dataDir, 'cache-b');
  const retainedA = path.join(dataDir, 'retained-a');
  const nestedAlias = path.join(dataDir, 'nested-cache-parent');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(cacheA, { recursive: true });
  mkdirSync(cacheB, { recursive: true });
  symlinkSync(cacheA, nestedAlias, 'dir');
  const environmentUrl = new URL('../../../dist/bootstrap/environment.js', import.meta.url).href;
  const probe = `
    import { mkdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
    const {
      DATA_DIR_AUTHORITY,
      DATA_DIR_LEASE,
      assertDataDirCachePathHeld,
    } = await import(${JSON.stringify(environmentUrl)});
    unlinkSync(process.argv[1]);
    symlinkSync(process.argv[2], process.argv[1], 'dir');
    assertDataDirCachePathHeld(DATA_DIR_AUTHORITY, DATA_DIR_AUTHORITY.profileCache);
    writeFileSync(DATA_DIR_AUTHORITY.profileCache, 'PINNED_A', { flag: 'wx', mode: 0o600 });
    renameSync(process.argv[3], process.argv[4]);
    mkdirSync(process.argv[3], { mode: 0o700 });
    let replacement = 'UNSAFE_REPLACEMENT_ACCEPTED';
    try {
      assertDataDirCachePathHeld(DATA_DIR_AUTHORITY, DATA_DIR_AUTHORITY.profileCache);
      writeFileSync(DATA_DIR_AUTHORITY.profileCache, 'UNSAFE');
    } catch (error) {
      replacement = String(error?.code ?? error?.message ?? error);
    }
    rmSync(process.argv[3], { recursive: true, force: true });
    renameSync(process.argv[4], process.argv[3]);
    DATA_DIR_LEASE.release();
    process.stdout.write(JSON.stringify({
      profileCache: DATA_DIR_AUTHORITY.profileCache,
      replacement,
    }));
  `;
  try {
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', probe, nestedAlias, cacheB, cacheA, retainedA],
      {
        cwd: physicalRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          SKIP_DOTENV: '1',
          DATA_DIR: dataDir,
          DATA_DIR_LOGICAL_LEASE_ROOT: path.join(physicalRoot, 'logical-runtime'),
          PROFILE_CACHE: path.join(nestedAlias, 'profiles.json'),
        },
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.deepEqual(JSON.parse(child.stdout), {
      profileCache: path.join(cacheA, 'profiles.json'),
      replacement: 'DATA_DIR_CACHE_AUTHORITY_CHANGED',
    });
    assert.equal(readFileSync(path.join(cacheA, 'profiles.json'), 'utf8'), 'PINNED_A');
    assert.equal(existsSync(path.join(cacheB, 'profiles.json')), false);
    assert.deepEqual(leaseArtifactNames(dataDir), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('configured cache parents outside physical DATA_DIR and symlink escapes fail before mutation', () => {
  const environmentUrl = new URL('../../../dist/bootstrap/environment.js', import.meta.url).href;
  const probe = `
    try {
      await import(${JSON.stringify(environmentUrl)});
      process.stdout.write('UNSAFE_AUTHORITY_ADMITTED');
    } catch (error) {
      process.stdout.write(String(error?.code ?? error?.message ?? error));
    }
  `;
  const cases = [
    {
      name: 'existing external parent',
      configure: ({ external }) => path.join(external, 'profiles.json'),
    },
    {
      name: 'missing external parent',
      configure: ({ root }) => path.join(root, 'must-not-be-created', 'nested', 'profiles.json'),
      absentParent: ({ root }) => path.join(root, 'must-not-be-created'),
    },
    {
      name: 'case-folded sibling physically outside exact DATA_DIR',
      configure: ({ root }) => {
        const sibling = path.join(root, 'DATA');
        mkdirSync(sibling, { recursive: true });
        return path.join(sibling, 'profiles.json');
      },
      requiresDistinctParent: true,
    },
    {
      name: 'in-DATA_DIR parent symlink escaping outside',
      configure: ({ dataDir, external }) => {
        const alias = path.join(dataDir, 'escaped-parent');
        symlinkSync(external, alias, 'dir');
        return path.join(alias, 'profiles.json');
      },
    },
  ];

  for (const entry of cases) {
    const root = mkdtempSync(path.join(tmpdir(), 'cosmos-cache-outside-'));
    const physicalRoot = realpathSync.native(root);
    const dataDir = path.join(physicalRoot, 'data');
    const external = path.join(physicalRoot, 'external');
    const logicalRoot = path.join(physicalRoot, 'logical-runtime');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(external, { recursive: true });
    const profileCache = entry.configure({ root: physicalRoot, dataDir, external });
    try {
      if (entry.requiresDistinctParent
        && realpathSync.native(path.dirname(profileCache)) === realpathSync.native(dataDir)) {
        continue;
      }
      const child = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
        cwd: physicalRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          SKIP_DOTENV: '1',
          DATA_DIR: dataDir,
          DATA_DIR_LOGICAL_LEASE_ROOT: logicalRoot,
          PROFILE_CACHE: profileCache,
        },
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.equal(child.status, 0, `${entry.name}: ${child.stderr || child.stdout}`);
      assert.equal(child.stdout, 'DATA_DIR_CACHE_PATH_OUTSIDE_DATA_DIR', entry.name);
      assert.equal(existsSync(profileCache), false, entry.name);
      assert.equal(existsSync(path.join(dataDir, 'cosmos.db')), false, entry.name);
      assert.deepEqual(leaseArtifactNames(dataDir), [], entry.name);
      assert.deepEqual(logicalLeaseArtifactNames(logicalRoot), [], entry.name);
      if (entry.absentParent) {
        assert.equal(existsSync(entry.absentParent({ root: physicalRoot })), false, entry.name);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('two DATA_DIR authorities cannot coordinate through one external cache target', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cosmos-cache-cross-data-dir-'));
  const physicalRoot = realpathSync.native(root);
  const dataDirs = [path.join(physicalRoot, 'data-a'), path.join(physicalRoot, 'data-b')];
  const externalParent = path.join(physicalRoot, 'external-cache-owner');
  const externalCache = path.join(externalParent, 'shared-profiles.json');
  mkdirSync(externalParent, { recursive: true });
  for (const dataDir of dataDirs) mkdirSync(dataDir, { recursive: true });
  const environmentUrl = new URL('../../../dist/bootstrap/environment.js', import.meta.url).href;
  const probe = `
    try {
      await import(${JSON.stringify(environmentUrl)});
      process.stdout.write('UNSAFE_AUTHORITY_ADMITTED');
    } catch (error) {
      process.stdout.write(String(error?.code ?? error?.message ?? error));
    }
  `;

  try {
    for (const [index, dataDir] of dataDirs.entries()) {
      const logicalRoot = path.join(physicalRoot, `logical-runtime-${index}`);
      const child = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
        cwd: physicalRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          SKIP_DOTENV: '1',
          DATA_DIR: dataDir,
          DATA_DIR_LOGICAL_LEASE_ROOT: logicalRoot,
          PROFILE_CACHE: externalCache,
        },
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.equal(child.status, 0, child.stderr || child.stdout);
      assert.equal(child.stdout, 'DATA_DIR_CACHE_PATH_OUTSIDE_DATA_DIR');
      assert.equal(existsSync(path.join(dataDir, 'cosmos.db')), false);
      assert.deepEqual(leaseArtifactNames(dataDir), []);
      assert.deepEqual(logicalLeaseArtifactNames(logicalRoot), []);
    }
    assert.equal(existsSync(externalCache), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production logical lease root is explicit, owner-only, nonsymlinked, and precedes DATA_DIR creation', () => {
  const environmentUrl = new URL('../../../dist/bootstrap/environment.js', import.meta.url).href;
  const probe = `
    try {
      await import(${JSON.stringify(environmentUrl)});
      process.stdout.write('UNSAFE_AUTHORITY_ADMITTED');
    } catch (error) {
      process.stdout.write(String(error?.code ?? error?.message ?? error));
    }
  `;
  const cases = [
    { name: 'absent env', expected: 'DATA_DIR_LOGICAL_LEASE_ROOT_REQUIRED' },
    {
      name: 'relative env',
      expected: 'DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID',
      root: 'relative-runtime',
    },
    { name: 'wrong mode', expected: 'DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID', mode: 0o755 },
    { name: 'symlink root', expected: 'DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID', symlink: true },
    {
      name: 'NFC requested DATA_DIR',
      expected: 'DATA_DIR_LOGICAL_PATH_NON_ASCII',
      dataDirName: 'Caf\u00e9-data',
      noSideEffects: true,
    },
    {
      name: 'NFD requested DATA_DIR',
      expected: 'DATA_DIR_LOGICAL_PATH_NON_ASCII',
      dataDirName: 'Cafe\u0301-data',
      noSideEffects: true,
    },
  ];
  for (const entry of cases) {
    const root = mkdtempSync(path.join(tmpdir(), 'cosmos-production-lease-root-'));
    const physicalRoot = realpathSync.native(root);
    const dataDir = path.join(physicalRoot, entry.dataDirName ?? 'must-not-exist');
    const configuredRoot = path.join(physicalRoot, 'runtime');
    try {
      if (entry.mode !== undefined) {
        mkdirSync(configuredRoot, { mode: entry.mode });
        chmodSync(configuredRoot, entry.mode);
      }
      if (entry.symlink) symlinkSync(physicalRoot, configuredRoot, 'dir');
      const env = {
        ...process.env,
        NODE_ENV: 'production',
        SKIP_DOTENV: '1',
        DATA_DIR: dataDir,
        ...(entry.name === 'absent env' ? {} : {
          DATA_DIR_LOGICAL_LEASE_ROOT: entry.root ?? configuredRoot,
        }),
      };
      const child = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
        cwd: physicalRoot,
        env,
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.equal(child.status, 0, `${entry.name}: ${child.stderr || child.stdout}`);
      assert.equal(child.stdout, entry.expected, entry.name);
      assert.equal(existsSync(dataDir), false, entry.name);
      assert.equal(`${child.stdout}${child.stderr}`.includes(dataDir), false, entry.name);
      if (entry.noSideEffects) assert.equal(existsSync(configuredRoot), false, entry.name);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('production systemd fixture shares an external runtime root despite PrivateTmp', () => {
  const unit = readFileSync(
    new URL('../../../../ops/live/systemd/cosmos-app.service', import.meta.url),
    'utf8',
  );
  assert.match(unit, /^PrivateTmp=yes$/mu);
  assert.match(unit, /^RuntimeDirectory=cosmos-app$/mu);
  assert.match(unit, /^RuntimeDirectoryMode=0700$/mu);
  assert.match(unit, /^RuntimeDirectoryPreserve=restart$/mu);
  assert.equal((unit.match(/^ExecStart=/gmu) ?? []).length, 1);
  assert.match(
    unit,
    /^ExecStart=\/usr\/bin\/env DATA_DIR_LOGICAL_LEASE_ROOT=\/run\/cosmos-app\/data-dir-leases \/usr\/bin\/node server\/dist\/index\.js$/mu,
  );
  assert.doesNotMatch(unit, /^Environment=DATA_DIR_LOGICAL_LEASE_ROOT=/mu);
  assert.doesNotMatch(unit, /^\s*PrivatePIDs\s*=/mu);
  assert.doesNotMatch(unit, /DATA_DIR_LOGICAL_LEASE_ROOT=.*(?:\/tmp|%t\/private)/u);
});

test(
  'ASCII-case aliases share one logical DATA_DIR lease across retarget before physical mutation',
  { timeout: 30_000 },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cosmos-logical-retarget-'));
    const dataDirA = path.join(root, 'physical-a');
    const dataDirB = path.join(root, 'physical-b');
    const dataDir = path.join(root, 'configured-data');
    const caseAliasedDataDir = path.join(root, 'CONFIGURED-DATA');
    mkdirSync(dataDirA, { recursive: true });
    mkdirSync(dataDirB, { recursive: true });
    symlinkSync(dataDirA, dataDir, 'dir');
    const logicalRoot = runtimeLogicalLeaseRoot(dataDir);
    const firstPort = await availablePort();
    const secondPort = await availablePort();
    const first = spawnRuntime(dataDir, firstPort);
    let second = null;
    try {
      await waitForServer(first.child, `http://${HOST}:${firstPort}`, first.logs);
      const logicalLeaves = readdirSync(logicalRoot);
      assert.equal(logicalLeaves.length, 1);
      assert.match(logicalLeaves[0], /^[0-9a-f]{64}$/u);
      const logicalRootStats = lstatSync(logicalRoot);
      const logicalLeafStats = lstatSync(path.join(logicalRoot, logicalLeaves[0]));
      assert.equal(logicalRootStats.isSymbolicLink(), false);
      assert.equal(logicalLeafStats.isSymbolicLink(), false);
      assert.equal(logicalRootStats.mode & 0o777, 0o700);
      assert.equal(logicalLeafStats.mode & 0o777, 0o700);
      assert.equal(logicalRootStats.uid, process.getuid());
      assert.equal(logicalLeafStats.uid, process.getuid());
      const before = new Database(path.join(dataDirA, 'cosmos.db'), { readonly: true });
      try {
        assert.equal(
          before.prepare('SELECT COUNT(*) AS count FROM product_boot_release_revisions').get().count,
          1,
        );
      } finally {
        before.close();
      }

      unlinkSync(dataDir);
      symlinkSync(dataDirB, caseAliasedDataDir, 'dir');
      second = spawnRuntime(caseAliasedDataDir, secondPort, {
        DATA_DIR_LOGICAL_LEASE_ROOT: logicalRoot,
      });
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
      const after = new Database(path.join(dataDirA, 'cosmos.db'), { readonly: true });
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
      assert.equal(existsSync(path.join(dataDirB, 'cosmos.db')), false);
      assert.equal(existsSync(path.join(dataDirB, 'network-egress.log')), false);
      assert.equal(existsSync(path.join(dataDirB, 'private-egress.log')), false);
      assertNoLeaseDatabase(dataDirA);
      assertNoLeaseDatabase(dataDirB);
      assert.deepEqual(leaseArtifactNames(dataDirA), []);
      assert.deepEqual(leaseArtifactNames(dataDirB), []);
      assert.deepEqual(logicalLeaseArtifactNames(logicalRoot), []);
    } finally {
      if (second !== null && !finished(second.child)) {
        second.child.kill('SIGKILL');
        await waitForExit(second.child, 3_000).catch(() => undefined);
      }
      if (!finished(first.child)) {
        first.child.kill('SIGKILL');
        await waitForExit(first.child, 3_000).catch(() => undefined);
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'a live exact legacy-v1 owner rejects the v2 writer without v2 mutation',
  { timeout: 15_000 },
  async () => {
    const dataDir = tempDataDir();
    const owner = spawnLegacyLeaseOwner(dataDir);
    try {
      await waitForLog(owner.child, owner.logs, /LEGACY_OWNER_READY/u);
      assert.throws(
        () => new DataDirLease(dataDir),
        (error) => error?.code === 'DATA_DIR_LEASE_HELD',
      );
      const artifacts = leaseArtifactNames(dataDir);
      assert.equal(artifacts.includes(LEGACY_LEASE_ROOT), true);
      assert.equal(
        artifacts.filter((name) => name.startsWith(LEGACY_LEASE_WITNESS_PREFIX)).length,
        1,
      );
      assert.equal(artifacts.some((name) => name.startsWith('.cosmos-data-dir.lease.v2')), false);
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
  'a SIGKILLed exact legacy-v1 owner is reclaimed by v2 without an upgrade wedge',
  { timeout: 15_000 },
  async () => {
    const dataDir = tempDataDir();
    const owner = spawnLegacyLeaseOwner(dataDir);
    try {
      await waitForLog(owner.child, owner.logs, /LEGACY_OWNER_READY/u);
      owner.child.kill('SIGKILL');
      const killed = await waitForExit(owner.child);
      assert.equal(killed.signal, 'SIGKILL', owner.logs());
      assert.equal(leaseArtifactNames(dataDir).includes(LEGACY_LEASE_ROOT), true);

      const upgraded = new DataDirLease(dataDir);
      const v2Record = JSON.parse(readFileSync(path.join(dataDir, LEASE_ROOT), 'utf8'));
      const legacyGuardRecord = JSON.parse(
        readFileSync(path.join(dataDir, LEGACY_LEASE_ROOT), 'utf8'),
      );
      assert.equal(v2Record.schemaVersion, 2);
      assert.equal(typeof v2Record.livenessNamespace, 'string');
      assert.deepEqual(legacyGuardRecord, v2Record);
      const guardStats = statSync(path.join(dataDir, LEGACY_LEASE_ROOT));
      const v2Stats = statSync(path.join(dataDir, LEASE_ROOT));
      assert.equal(guardStats.dev, v2Stats.dev);
      assert.equal(guardStats.ino, v2Stats.ino);
      upgraded.release();
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
      const retainedArtifacts = leaseArtifactNames(dataDir);
      assert.equal(retainedArtifacts.length, 2);
      assert.equal(retainedArtifacts.includes(LEGACY_LEASE_ROOT), true);
      assert.equal(
        retainedArtifacts.filter((name) => name.startsWith(LEASE_WITNESS_PREFIX)).length,
        1,
      );
      assertNoLeaseDatabase(dataDir);
    } finally {
      if (application !== null && !finished(application.child)) {
        application.child.kill('SIGKILL');
        await waitForExit(application.child, 3_000).catch(() => undefined);
      }
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(runtimeLogicalLeaseRoot(dataDir), { recursive: true, force: true });
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

test('remote, PID-namespace-mismatched, corrupt, and future-dated records fail closed', () => {
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
    {
      expectedCode: 'DATA_DIR_LEASE_LIVENESS_NAMESPACE_MISMATCH',
      record: leaseRecord({
        ownerToken: 'n'.repeat(36),
        pid: 2_147_483_647,
        livenessNamespace: currentLivenessNamespace() === 'global:synthetic'
          ? 'global:other'
          : 'global:synthetic',
      }),
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

test('application bootstrap orders logical and physical leases before every durable/runtime admission', () => {
  const indexSource = readFileSync(new URL('../../../src/index.ts', import.meta.url), 'utf8');
  const environmentSource = readFileSync(
    new URL('../../../src/bootstrap/environment.ts', import.meta.url),
    'utf8',
  );
  const ledgerSource = readFileSync(new URL('../../../src/ledger.ts', import.meta.url), 'utf8');
  const logicalLeaseAcquisition = environmentSource.indexOf('const logicalBinding = acquireLogicalLease');
  const physicalResolution = environmentSource.indexOf('resolveDataDirAuthorityInternal(', logicalLeaseAcquisition);
  const physicalLeaseAcquisition = environmentSource.indexOf(
    'const physicalLease = new DataDirLease',
    physicalResolution,
  );
  const leaseBinding = indexSource.indexOf('const dataDirLease = DATA_DIR_LEASE');
  const firstLeaseAssertion = indexSource.indexOf('dataDirLease.assertHeld()', leaseBinding);
  const ledgerOpen = indexSource.indexOf('return new Ledger(canonicalDataDir');
  const ledgerGuard = indexSource.indexOf('beforeMutation: () => dataDirLease.assertHeld()', ledgerOpen);
  const bootMutation = indexSource.indexOf('const bootReleaseStart = bootReleasePersistence.start()');
  const runtimeStart = indexSource.indexOf('return systemIntegration.start()');
  const runtimeLeaseAssertion = indexSource.lastIndexOf('dataDirLease.assertHeld()', runtimeStart);
  const listenerAdmission = indexSource.indexOf('server.listen(PORT, HOST');
  const listenerLeaseAssertion = indexSource.lastIndexOf('dataDirLease.assertHeld()', listenerAdmission);
  const durableFinalization = indexSource.indexOf(
    'const finalization = finalizeSystemBootReleaseCleanShutdown',
  );
  const leaseRelease = indexSource.indexOf('dataDirLease.release()', durableFinalization);
  const ledgerCallback = ledgerSource.indexOf('options.beforeMutation?.()');
  const ledgerMkdir = ledgerSource.indexOf('mkdirSync(dataDir', ledgerCallback);
  const ledgerDatabase = ledgerSource.indexOf('new Database(databasePath)', ledgerCallback);
  assert.ok(logicalLeaseAcquisition > 0);
  assert.ok(physicalResolution > logicalLeaseAcquisition);
  assert.ok(physicalLeaseAcquisition > physicalResolution);
  assert.ok(leaseBinding > 0);
  assert.ok(firstLeaseAssertion > leaseBinding);
  assert.ok(ledgerOpen > firstLeaseAssertion);
  assert.ok(ledgerGuard > ledgerOpen);
  assert.ok(bootMutation > ledgerOpen);
  assert.ok(runtimeLeaseAssertion > bootMutation);
  assert.ok(runtimeStart > runtimeLeaseAssertion);
  assert.ok(listenerLeaseAssertion > runtimeStart);
  assert.ok(listenerAdmission > listenerLeaseAssertion);
  assert.ok(listenerAdmission > bootMutation);
  assert.ok(durableFinalization > listenerAdmission);
  assert.ok(leaseRelease > durableFinalization);
  assert.ok(ledgerCallback > 0);
  assert.ok(ledgerMkdir > ledgerCallback);
  assert.ok(ledgerDatabase > ledgerCallback);
  assert.match(environmentSource, /const onLeaseLost:[\s\S]*?process\.exit\(1\)/u);
});

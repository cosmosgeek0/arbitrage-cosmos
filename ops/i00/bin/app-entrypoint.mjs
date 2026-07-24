#!/usr/bin/env node
// Loads an exact systemd credential file into this Node process and imports
// only the application entrypoint beneath the physically bound release root.
// Secret values are never logged.
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync,
} from 'node:fs';
import {
  dirname, isAbsolute, join, resolve,
} from 'node:path';
import { pathToFileURL } from 'node:url';

import { fail } from '../lib.mjs';
import { validateSimulationRoot } from '../simulation-safety.mjs';

const CREDENTIAL_KEYS = Object.freeze(['BINANCE_API_KEY', 'BINANCE_API_SECRET']);
const PRODUCTION_CURRENT_LINK = '/opt/cosmos/current';
const PRODUCTION_RELEASE_PARENT = '/opt/cosmos/releases';

function exactPhysicalDirectory(raw, label, { privateMode = false } = {}) {
  if (typeof raw !== 'string' || raw === '/' || raw.length > 4_096
      || !isAbsolute(raw) || resolve(raw) !== raw
      || /[\u0000-\u001f\u007f]/u.test(raw)) {
    fail(`${label} must be one absolute lexical canonical path`);
  }
  let stat;
  try {
    stat = lstatSync(raw, { bigint: true });
  } catch (error) {
    fail(`${label} is unavailable: ${error.message}`);
  }
  const invokingUid = typeof process.getuid === 'function'
    ? BigInt(process.getuid())
    : null;
  if (!stat.isDirectory() || stat.isSymbolicLink()
      || realpathSync.native(raw) !== raw
      || (stat.mode & 0o022n) !== 0n
      || (stat.mode & 0o7000n) !== 0n
      || (privateMode && (stat.mode & 0o777n) !== 0o700n)
      || (invokingUid !== null && stat.uid !== 0n && stat.uid !== invokingUid)) {
    fail(`${label} must be one trusted physical${privateMode ? ' mode-0700' : ''} directory`);
  }
  return Object.freeze({ path: raw, stat });
}

function simulationAncestor(path) {
  let cursor = path;
  for (;;) {
    try {
      if (validateSimulationRoot(cursor) === cursor) return cursor;
    } catch {
      // Continue to the next physical parent.
    }
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function exactReleaseRoot() {
  const cwd = process.cwd();
  exactPhysicalDirectory(cwd, 'application working directory');
  const simulationRoot = simulationAncestor(cwd);
  if (simulationRoot !== null) return cwd;
  let currentStat;
  try {
    currentStat = lstatSync(PRODUCTION_CURRENT_LINK, { bigint: true });
  } catch (error) {
    fail(`production current link is unavailable: ${error.message}`);
  }
  if (!currentStat.isSymbolicLink()) {
    fail('production current link must be one symbolic link');
  }
  let releaseRoot;
  try {
    releaseRoot = realpathSync.native(PRODUCTION_CURRENT_LINK);
  } catch (error) {
    fail(`production current link cannot be resolved: ${error.message}`);
  }
  if (cwd !== releaseRoot
      || dirname(releaseRoot) !== PRODUCTION_RELEASE_PARENT
      || !/^i00-[0-9a-f]{40}$/u.test(releaseRoot.slice(`${PRODUCTION_RELEASE_PARENT}/`.length))) {
    fail('application working directory differs from the exact current release root');
  }
  exactPhysicalDirectory(releaseRoot, 'current release root');
  return releaseRoot;
}

function fileIdentity(stat) {
  return Object.freeze({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    links: stat.nlink.toString(),
    uid: stat.uid.toString(),
    gid: stat.gid.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  });
}

function sameIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requirePhysicalFile(path, label, {
  maximumBytes,
  privateMode = false,
} = {}) {
  let stat;
  try {
    stat = lstatSync(path, { bigint: true });
  } catch (error) {
    fail(`${label} is unavailable: ${error.message}`);
  }
  const invokingUid = typeof process.getuid === 'function'
    ? BigInt(process.getuid())
    : null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n
      || stat.size <= 0n || stat.size > BigInt(maximumBytes)
      || realpathSync.native(path) !== path
      || (stat.mode & 0o022n) !== 0n
      || (stat.mode & 0o7000n) !== 0n
      || (privateMode && (stat.mode & 0o077n) !== 0n)
      || (invokingUid !== null && stat.uid !== 0n && stat.uid !== invokingUid)) {
    fail(`${label} must be one bounded trusted physical single-link regular file`);
  }
  return Object.freeze({ path, identity: fileIdentity(stat) });
}

function ensureDirectPhysicalPath(root, path, label) {
  if (!path.startsWith(`${root}/`) || resolve(path) !== path) {
    fail(`${label} escaped the exact root`);
  }
  let cursor = dirname(path);
  for (;;) {
    const stat = lstatSync(cursor, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()
        || realpathSync.native(cursor) !== cursor) {
      fail(`${label} ancestor chain is not physical`);
    }
    if (cursor === root) return;
    const parent = dirname(cursor);
    if (parent === cursor || !cursor.startsWith(`${root}/`)) {
      fail(`${label} ancestor chain escaped the exact root`);
    }
    cursor = parent;
  }
}

function readCredentialFile(directory) {
  const path = join(directory, 'app-secrets');
  const entry = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (entry === undefined) return null;
  ensureDirectPhysicalPath(directory, path, 'application credential');
  const before = requirePhysicalFile(path, 'application credential', {
    maximumBytes: 64 * 1024,
    privateMode: true,
  });
  let descriptor;
  let bytes;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const openedBefore = fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(fileIdentity(openedBefore), before.identity)) {
      fail('application credential identity changed before descriptor read');
    }
    bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(fileIdentity(openedAfter), before.identity)
        || BigInt(bytes.length) !== openedAfter.size) {
      fail('application credential identity changed during descriptor read');
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const after = requirePhysicalFile(path, 'application credential', {
    maximumBytes: 64 * 1024,
    privateMode: true,
  });
  if (!sameIdentity(after.identity, before.identity)) {
    fail('application credential named identity changed after descriptor read');
  }
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      fail('application credential must contain one JSON object');
    }
    return value;
  } catch (error) {
    if (String(error?.message ?? '').startsWith('I00_OPS_BLOCKED:')) throw error;
    fail('application credential is not valid JSON');
  }
}

const releaseRoot = exactReleaseRoot();
const serverEntrypoint = join(releaseRoot, 'server', 'dist', 'index.js');
ensureDirectPhysicalPath(releaseRoot, serverEntrypoint, 'application server entrypoint');
const serverBefore = requirePhysicalFile(
  serverEntrypoint,
  'application server entrypoint',
  { maximumBytes: 512 * 1024 * 1024 },
);

const credentialDirectory = process.env.CREDENTIALS_DIRECTORY;
let secret = null;
if (credentialDirectory !== undefined && credentialDirectory !== '') {
  const boundDirectory = exactPhysicalDirectory(
    credentialDirectory,
    'CREDENTIALS_DIRECTORY',
    { privateMode: true },
  );
  secret = readCredentialFile(boundDirectory.path);
}
const supplied = secret !== null
  && CREDENTIAL_KEYS.some((key) => secret[key] !== undefined);
if (supplied) {
  for (const key of CREDENTIAL_KEYS) {
    const value = secret[key];
    if (typeof value !== 'string' || value.length < 8 || value.length > 4_096
        || /[\r\n\0]/u.test(value)) {
      fail(`required credential field ${key} is unavailable or malformed`);
    }
    process.env[key] = value;
  }
} else {
  process.stderr.write('app-entrypoint: keyless posture - no Binance credential supplied; the validate-only composition root reads no private credential (F-016)\n');
}
secret = null;

await import(pathToFileURL(serverEntrypoint).href);
const serverAfter = requirePhysicalFile(
  serverEntrypoint,
  'application server entrypoint',
  { maximumBytes: 512 * 1024 * 1024 },
);
if (!sameIdentity(serverAfter.identity, serverBefore.identity)) {
  fail('application server entrypoint changed during import');
}

#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, openSync,
  readSync, readdirSync, realpathSync,
} from 'node:fs';
import {
  basename, dirname, isAbsolute, resolve,
} from 'node:path';

import { fail, parseArgs, requireExactKeys } from '../lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (Object.keys(args).length !== 1 || !args.path) {
  fail('--path is required and is the only supported argument');
}
const requested = args.path;
if (typeof requested !== 'string' || requested.length === 0 || requested.length > 4_096
    || /[\u0000-\u001f\u007f]/u.test(requested)
    || !isAbsolute(requested) || resolve(requested) !== requested) {
  fail('--path must be one exact canonical absolute backup directory');
}

const sameIdentity = (left, right) => (
  left.dev === right.dev
  && left.ino === right.ino
  && left.mode === right.mode
  && left.size === right.size
  && left.mtimeNs === right.mtimeNs
  && left.ctimeNs === right.ctimeNs
);
const identity = (stat) => ({
  device: stat.dev.toString(),
  inode: stat.ino.toString(),
  mode: stat.mode.toString(8),
  size: stat.size.toString(),
  mtimeNs: stat.mtimeNs.toString(),
  ctimeNs: stat.ctimeNs.toString(),
});
const endpointIdentity = (stat) => Object.entries(identity(stat))
  .map(([key, value]) => `${key}=${value}`)
  .join(',');

let directoryBefore;
try {
  directoryBefore = lstatSync(requested, { bigint: true });
} catch (error) {
  fail(`backup source is unavailable: ${error.message}`);
}
if (!directoryBefore.isDirectory() || directoryBefore.isSymbolicLink()
    || realpathSync(requested) !== requested) {
  fail('backup source must be one canonical non-symlink directory');
}
if ((directoryBefore.mode & 0o022n) !== 0n) {
  fail('backup source directory must not be group/world writable');
}
{
  let cursor = dirname(requested);
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  const trustedOwners = new Set([0n, directoryBefore.uid]);
  if (invokingUid !== null) trustedOwners.add(invokingUid);
  for (;;) {
    const stat = lstatSync(cursor, { bigint: true });
    const mode = stat.mode & 0o7777n;
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(cursor) !== cursor) {
      fail('backup source ancestor chain must contain only canonical directories');
    }
    if (!trustedOwners.has(stat.uid)) {
      fail('backup source ancestor chain has an untrusted owner');
    }
    if ((mode & 0o022n) !== 0n) {
      const rootOwnedStickyBoundary = stat.uid === 0n && (mode & 0o1000n) !== 0n;
      if (!rootOwnedStickyBoundary) {
        fail('backup source ancestor chain contains an unsafe writable directory');
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

let rootDescriptor;
try {
  rootDescriptor = openSync(
    requested,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
} catch (error) {
  fail(`backup source capability cannot be opened: ${error.message}`);
}
// Linux acceptance reads every child and inventory entry through the held
// directory capability. Non-Linux staging lacks a kernel descriptor-relative
// pathname namespace, so it retains the named path while preserving every
// identity recheck; it is not authoritative acceptance for this gate.
const rootDescriptorPath = process.platform === 'linux'
  ? `/proc/self/fd/${rootDescriptor}`
  : requested;
const directoryOpened = fstatSync(rootDescriptor, { bigint: true });
if (!directoryOpened.isDirectory() || !sameIdentity(directoryBefore, directoryOpened)) {
  fail('backup source changed while opening its retained capability');
}

function recheckRootCapability(label) {
  const opened = fstatSync(rootDescriptor, { bigint: true });
  const named = lstatSync(requested, { bigint: true, throwIfNoEntry: false });
  if (!opened.isDirectory() || !named?.isDirectory() || named.isSymbolicLink()
      || !sameIdentity(directoryOpened, opened) || !sameIdentity(opened, named)
      || realpathSync(requested) !== requested) {
    fail(`backup source identity changed ${label}`);
  }
  return opened;
}

function stableFile(name, label, maximumBytes, { capture = false } = {}) {
  if (typeof name !== 'string' || name.length === 0 || name === '.' || name === '..'
      || name.startsWith('-') || /[\\/\u0000-\u001f\u007f]/u.test(name)) {
    fail(`${label} name is unsafe`);
  }
  const capabilityPath = `${rootDescriptorPath}/${name}`;
  const canonicalPath = resolve(requested, name);
  let descriptor;
  try {
    recheckRootCapability(`before reading ${label}`);
    const namedBefore = lstatSync(capabilityPath, { bigint: true });
    if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1n
        || namedBefore.size <= 0n || namedBefore.size > BigInt(maximumBytes)
        || namedBefore.uid !== directoryBefore.uid || namedBefore.gid !== directoryBefore.gid
        || (namedBefore.mode & 0o022n) !== 0n
        || realpathSync(capabilityPath) !== canonicalPath) {
      fail(`${label} must be one bounded canonical single-link regular file`);
    }
    descriptor = openSync(
      capabilityPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const openedBefore = fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(namedBefore, openedBefore)) fail(`${label} changed before reading`);
    const hash = createHash('sha256');
    const chunks = [];
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      const chunk = buffer.subarray(0, count);
      hash.update(chunk);
      if (capture) chunks.push(Buffer.from(chunk));
    }
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const namedAfter = lstatSync(capabilityPath, { bigint: true });
    if (!sameIdentity(openedBefore, openedAfter) || !sameIdentity(openedAfter, namedAfter)
        || realpathSync(capabilityPath) !== canonicalPath) {
      fail(`${label} changed while reading`);
    }
    recheckRootCapability(`after reading ${label}`);
    return Object.freeze({
      sha256: hash.digest('hex'),
      size: Number(openedAfter.size),
      ...(capture ? { bytes: Buffer.concat(chunks) } : {}),
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

const manifestEvidence = stableFile(
  'manifest.json',
  'backup manifest',
  1024 * 1024,
  { capture: true },
);
let manifest;
try {
  manifest = JSON.parse(manifestEvidence.bytes);
} catch {
  fail('backup manifest is not valid JSON');
}
if (!manifestEvidence.bytes.equals(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))) {
  fail('backup manifest bytes are not canonical');
}
// Backup manifests are versioned. Publications carry schemaVersion 2 and four
// additional recovery fields; manifests written before that change carry no
// schemaVersion at all and are read as version 1. Any other declared version -
// and any key outside the set that version owns - is refused rather than
// half-understood, so an unrecognised manifest can never be treated as a
// verified backup source.
const BACKUP_MANIFEST_V1_KEYS = Object.freeze([
  'backupId', 'createdAtUtc', 'dbFile', 'dbSha256', 'dbBytes', 'eventsCount',
  'dataSchema', 'integrityCheck', 'evidence',
]);
const BACKUP_MANIFEST_V2_KEYS = Object.freeze([
  'schemaVersion', 'backupId', 'createdAtUtc', 'dbFile', 'dbSha256', 'dbBytes',
  'eventsCount', 'journalState', 'dataSchema', 'rollbackFloor',
  'sourceJournalSha256', 'integrityCheck', 'evidence',
]);
const BACKUP_JOURNAL_STATES = Object.freeze(['PRESENT', 'PENDING', 'ABSENT']);
const manifestVersion = Object.hasOwn(manifest, 'schemaVersion')
  ? manifest.schemaVersion : 1;
if (manifestVersion !== 1 && manifestVersion !== 2) {
  fail('backup manifest schema version is not supported');
}
requireExactKeys(
  manifest,
  manifestVersion === 2 ? BACKUP_MANIFEST_V2_KEYS : BACKUP_MANIFEST_V1_KEYS,
  'backup manifest',
);
const createdAtMs = typeof manifest.createdAtUtc === 'string'
  ? Date.parse(manifest.createdAtUtc) : Number.NaN;
if (manifest.backupId !== basename(requested)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(manifest.createdAtUtc ?? '')
    || !Number.isFinite(createdAtMs)
    || new Date(createdAtMs).toISOString().replace('.000Z', 'Z') !== manifest.createdAtUtc
    || manifest.dbFile !== 'cosmos.db'
    || manifest.integrityCheck !== 'ok'
    || !/^[0-9a-f]{64}$/u.test(manifest.dbSha256)
    || !Number.isSafeInteger(manifest.dbBytes) || manifest.dbBytes <= 0
    || !Number.isSafeInteger(manifest.eventsCount) || manifest.eventsCount < -1
    || !(manifest.dataSchema === null
      || (Number.isSafeInteger(manifest.dataSchema) && manifest.dataSchema >= 0))
    || !Array.isArray(manifest.evidence) || manifest.evidence.length > 10_000) {
  fail('backup manifest does not describe one complete verified backup');
}
// Version 2 adds the recovery fields the publisher now records. journalState is
// one of the three states the journal snapshot can report, but a manifest is
// only publishable from a steady PRESENT journal - the publisher refuses to
// write anything else and the restore path accepts nothing else - so PRESENT is
// the only value a real backup can carry here. rollbackFloor must be a concrete
// non-negative schema number no higher than the schema the backup was taken at,
// which also means dataSchema can no longer be the version-1 null.
if (manifestVersion === 2
    && (manifest.schemaVersion !== 2
      || !BACKUP_JOURNAL_STATES.includes(manifest.journalState)
      || manifest.journalState !== 'PRESENT'
      || !Number.isSafeInteger(manifest.dataSchema) || manifest.dataSchema < 0
      || !Number.isSafeInteger(manifest.rollbackFloor) || manifest.rollbackFloor < 0
      || manifest.rollbackFloor > manifest.dataSchema
      || !/^[0-9a-f]{64}$/u.test(manifest.sourceJournalSha256))) {
  fail('backup manifest does not describe one complete verified v2 backup');
}
const databaseEvidence = stableFile(
  'cosmos.db',
  'backup database',
  128 * 1024 * 1024 * 1024,
);
if (databaseEvidence.sha256 !== manifest.dbSha256
    || databaseEvidence.size !== manifest.dbBytes) {
  fail('backup database does not match its manifest');
}
const safeSource = (source) => (
  typeof source === 'string' && source.length > 0
  && Buffer.byteLength(source) <= 4_096
  && !/[\u0000-\u001f\u007f]/u.test(source)
);
const safeRoot = (root) => (
  typeof root === 'string' && root.length > 0 && Buffer.byteLength(root) <= 255
  && root !== '.' && root !== '..' && !root.startsWith('-')
  && !/[\\/\u0000-\u001f\u007f]/u.test(root)
);
const expectedNames = new Set(['cosmos.db', 'manifest.json']);
const sources = new Set();
const portableRoots = new Set();
let archiveNumber = 0;
let archiveBytes = 0;
const archiveRecords = [];
for (let index = 0; index < manifest.evidence.length; index += 1) {
  const item = manifest.evidence[index];
  const label = `backup manifest evidence[${index}]`;
  if (item === null || typeof item !== 'object' || Array.isArray(item)
      || !safeSource(item.source) || sources.has(item.source)) {
    fail(`${label} source is invalid or duplicated`);
  }
  sources.add(item.source);
  if (item.missing === true) {
    requireExactKeys(item, ['source', 'missing'], label);
    continue;
  }
  requireExactKeys(item, ['source', 'archive', 'sha256'], label);
  archiveNumber += 1;
  const expectedArchive = `evidence-${archiveNumber}.tar.gz`;
  const sourceRoot = basename(item.source);
  const portableRoot = sourceRoot.normalize('NFC').toLocaleLowerCase('en-US');
  if (item.archive !== expectedArchive || !/^[0-9a-f]{64}$/u.test(item.sha256)
      || !safeRoot(sourceRoot) || portableRoots.has(portableRoot)) {
    fail(`${label} archive identity is invalid or duplicated`);
  }
  portableRoots.add(portableRoot);
  const archive = stableFile(
    expectedArchive,
    `backup evidence archive ${archiveNumber}`,
    64 * 1024 * 1024 * 1024,
  );
  if (archive.sha256 !== item.sha256) {
    fail(`${label} archive digest differs from its manifest`);
  }
  archiveBytes += archive.size;
  if (!Number.isSafeInteger(archiveBytes)
      || archiveBytes > 128 * 1024 * 1024 * 1024) {
    fail('backup evidence archives exceed their aggregate limit');
  }
  archiveRecords.push(Object.freeze({
    name: expectedArchive,
    sha256: archive.sha256,
    bytes: archive.size,
  }));
  expectedNames.add(expectedArchive);
}
recheckRootCapability('before inventory');
const names = readdirSync(rootDescriptorPath).sort();
const expectedInventory = [...expectedNames].sort();
if (names.length !== expectedInventory.length
    || names.some((name, index) => name !== expectedInventory[index])) {
  fail('backup source inventory differs from its manifest');
}
const directoryAfter = recheckRootCapability('while inspecting');
const finalManifestEvidence = stableFile(
  'manifest.json',
  'backup manifest final recheck',
  1024 * 1024,
);
const finalDatabaseEvidence = stableFile(
  'cosmos.db',
  'backup database final recheck',
  128 * 1024 * 1024 * 1024,
);
if (finalManifestEvidence.sha256 !== manifestEvidence.sha256
    || finalManifestEvidence.size !== manifestEvidence.size
    || finalDatabaseEvidence.sha256 !== databaseEvidence.sha256
    || finalDatabaseEvidence.size !== databaseEvidence.size) {
  fail('backup source changed during final action-time revalidation');
}
for (const archive of archiveRecords) {
  const finalArchive = stableFile(
    archive.name,
    `backup evidence archive final recheck ${archive.name}`,
    64 * 1024 * 1024 * 1024,
  );
  if (finalArchive.sha256 !== archive.sha256 || finalArchive.size !== archive.bytes) {
    fail('backup evidence archive changed during final action-time revalidation');
  }
}
const finalNames = readdirSync(rootDescriptorPath).sort();
const directoryFinal = recheckRootCapability('during final action-time revalidation');
if (finalNames.length !== expectedInventory.length
    || finalNames.some((name, index) => name !== expectedInventory[index])
    || !sameIdentity(directoryAfter, directoryFinal)) {
  fail('backup source inventory changed during final action-time revalidation');
}
const treeSha256 = createHash('sha256')
  .update('I00_BACKUP_SOURCE_TREE_V1\0')
  .update(JSON.stringify([
    { name: 'cosmos.db', sha256: databaseEvidence.sha256, bytes: databaseEvidence.size },
    { name: 'manifest.json', sha256: manifestEvidence.sha256, bytes: manifestEvidence.size },
    ...archiveRecords,
  ]))
  .digest('hex');

closeSync(rootDescriptor);
process.stdout.write(`${JSON.stringify({
  status: 'BACKUP_SOURCE_IDENTITY_VERIFIED',
  path: requested,
  manifestSha256: manifestEvidence.sha256,
  databaseSha256: databaseEvidence.sha256,
  createdAtUtc: manifest.createdAtUtc,
  eventsCount: manifest.eventsCount,
  dataSchema: manifest.dataSchema,
  archiveCount: archiveNumber,
  treeSha256,
  identity: identity(directoryFinal),
  endpointIdentity: endpointIdentity(directoryFinal),
})}\n`);

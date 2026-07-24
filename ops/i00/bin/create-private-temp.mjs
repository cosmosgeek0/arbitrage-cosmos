#!/usr/bin/env node
import {
  chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdtempSync,
  openSync, realpathSync,
} from 'node:fs';
import {
  basename, dirname, isAbsolute, resolve,
} from 'node:path';

import { fail, parseArgs } from '../lib.mjs';
import { validateSimulationRoot } from '../simulation-safety.mjs';

const PROTECTED_MUTATION_ROOTS = Object.freeze([
  '/opt/cosmos',
  '/var/lib/cosmos',
  '/var/backups/cosmos',
  '/etc/cosmos',
  '/run/cosmos-app',
  '/run/cosmos-secret-source',
  '/usr/local/lib/cosmos-ops',
  '/var/lib/cosmos-deployment-authorization',
  '/var/lib/cosmos-authorization-consumption',
  '/var/lib/cosmos-action-receipts',
]);

const args = parseArgs(process.argv.slice(2));
if (!args.prefix || Object.keys(args).some((key) => !['prefix', 'base'].includes(key))
    || !/^[a-z0-9][a-z0-9-]{0,62}\.$/u.test(args.prefix)) {
  fail('--prefix must be one bounded lowercase private-temp prefix ending in a dot');
}

const systemBase = args.base === undefined;
const BASE_REQUESTED = systemBase ? '/tmp' : args.base;
if (typeof BASE_REQUESTED !== 'string' || BASE_REQUESTED === '/'
    || !isAbsolute(BASE_REQUESTED) || resolve(BASE_REQUESTED) !== BASE_REQUESTED) {
  fail('--base must be one non-root canonical absolute directory');
}
if (typeof constants.O_DIRECTORY !== 'number'
    || typeof constants.O_NOFOLLOW !== 'number') {
  fail('required no-follow directory semantics are unavailable');
}

function canonicalPotentialPath(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
    fail(`${label} must be one canonical absolute path`);
  }
  let cursor = value;
  const suffix = [];
  for (;;) {
    let stat;
    try {
      stat = lstatSync(cursor, { throwIfNoEntry: false });
    } catch (error) {
      if (error?.code !== 'EACCES' && error?.code !== 'EPERM') throw error;
      stat = undefined;
    }
    if (stat !== undefined) {
      let ancestor;
      try {
        ancestor = realpathSync(cursor);
      } catch (error) {
        if (error?.code !== 'EACCES' && error?.code !== 'EPERM') throw error;
        ancestor = undefined;
      }
      if (ancestor === undefined) {
        const parent = dirname(cursor);
        if (parent === cursor) fail(`${label} is unreadable`);
        suffix.unshift(basename(cursor));
        cursor = parent;
        continue;
      }
      if (suffix.length > 0
          && !lstatSync(ancestor, { bigint: true }).isDirectory()) {
        fail(`${label} existing ancestor is not a directory`);
      }
      return resolve(ancestor, ...suffix);
    }
    const parent = dirname(cursor);
    if (parent === cursor) fail(`${label} has no existing ancestor`);
    const leaf = basename(cursor);
    if (!leaf || leaf === '.' || leaf === '..') {
      fail(`${label} has an unsafe missing component`);
    }
    suffix.unshift(leaf);
    cursor = parent;
  }
}

function pathInsideOrSame(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}/`);
}

const protectedPhysicalRoots = Object.freeze(PROTECTED_MUTATION_ROOTS.map(
  (protectedInput) => canonicalPotentialPath(
    protectedInput,
    'protected mutation root',
  ),
));

function requireProtectedUnionDisjoint(path, label) {
  for (const protectedRoot of protectedPhysicalRoots) {
    if (pathInsideOrSame(path, protectedRoot)
        || pathInsideOrSame(protectedRoot, path)) {
      fail(`${label} intersects the protected production root union`);
    }
  }
}

function requireTestBase(input) {
  let root;
  try {
    root = validateSimulationRoot(input);
  } catch (error) {
    fail(`explicit --base is available only for one canonical marked TEST root: ${error.message}`);
  }
  requireProtectedUnionDisjoint(root, 'explicit TEST base');
  return root;
}

const base = systemBase ? realpathSync(BASE_REQUESTED) : requireTestBase(BASE_REQUESTED);
requireProtectedUnionDisjoint(base, 'canonical temporary base');
const identity = (stat) => Object.freeze({
  device: stat.dev.toString(),
  inode: stat.ino.toString(),
  mode: stat.mode.toString(8),
  uid: stat.uid.toString(),
  gid: stat.gid.toString(),
});
const sameIdentity = (left, right) => (
  Object.keys(left).every((key) => left[key] === right[key])
);

const baseNamed = lstatSync(base, { bigint: true });
const baseMode = baseNamed.mode & 0o7777n;
const invokingUid = typeof process.getuid === 'function'
  ? BigInt(process.getuid())
  : baseNamed.uid;
if (!baseNamed.isDirectory() || baseNamed.isSymbolicLink()
    || realpathSync(base) !== base
    || (systemBase
      ? (baseNamed.uid !== 0n
        || ((baseMode & 0o022n) !== 0n && (baseMode & 0o1000n) === 0n))
      : (baseNamed.uid !== invokingUid || baseMode !== 0o700n))) {
  fail(systemBase
    ? 'canonical temporary base must be a root-owned directory with no unsafe write access'
    : 'explicit temporary base must be one invoking-owner mode-0700 directory');
}
const baseIdentity = identity(baseNamed);
let baseDescriptor;
let created;
try {
  baseDescriptor = openSync(
    base,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const openedBefore = fstatSync(baseDescriptor, { bigint: true });
  if (!openedBefore.isDirectory() || !sameIdentity(identity(openedBefore), baseIdentity)) {
    fail('canonical temporary base identity changed before creation');
  }
  created = mkdtempSync(resolve(base, args.prefix));
  chmodSync(created, 0o700);
  const child = lstatSync(created, { bigint: true });
  if (!child.isDirectory() || child.isSymbolicLink() || child.uid !== invokingUid
      || (child.mode & 0o7777n) !== 0o700n || realpathSync(created) !== created
      || dirname(created) !== base) {
    fail('private temporary directory identity is invalid');
  }
  requireProtectedUnionDisjoint(created, 'private temporary directory');
  fsyncSync(baseDescriptor);
  const openedAfter = fstatSync(baseDescriptor, { bigint: true });
  const namedAfter = lstatSync(base, { bigint: true });
  if (!sameIdentity(identity(openedAfter), baseIdentity)
      || !sameIdentity(identity(namedAfter), baseIdentity)) {
    fail('canonical temporary base identity changed during creation');
  }
} finally {
  if (baseDescriptor !== undefined) closeSync(baseDescriptor);
}

process.stdout.write(`${created}\n`);

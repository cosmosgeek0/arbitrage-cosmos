#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { fail, parseArgs } from '../lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (Object.keys(args).length !== 1 || !args.path) fail('--path is required and is the only supported argument');

const requested = args.path;
if (typeof requested !== 'string'
    || requested.length === 0
    || requested.length > 4_096
    || /[\u0000-\u001f\u007f]/u.test(requested)
    || !isAbsolute(requested)
    || resolve(requested) !== requested) {
  fail('--path must be one exact canonical absolute path');
}

const identity = (stat) => ({
  device: stat.dev.toString(),
  inode: stat.ino.toString(),
  mode: stat.mode.toString(8),
  size: stat.size.toString(),
  mtimeNs: stat.mtimeNs.toString(),
  ctimeNs: stat.ctimeNs.toString(),
});
const sameIdentity = (left, right) => (
  left.dev === right.dev
  && left.ino === right.ino
  && left.mode === right.mode
  && left.size === right.size
  && left.mtimeNs === right.mtimeNs
  && left.ctimeNs === right.ctimeNs
);
const inspectStat = (stat) => {
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail('executable path must be a non-symlink regular file');
  }
  if ((stat.mode & 0o111n) === 0n) fail('executable path must have an executable mode');
  if ((stat.mode & 0o022n) !== 0n) fail('executable path must not be group/world writable');
  if ((stat.mode & 0o7000n) !== 0n) fail('executable path must not have special mode bits');
};

function verifyTrustedAncestorChain(path) {
  let cursor = dirname(path);
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  for (;;) {
    let stat;
    try {
      stat = lstatSync(cursor, { bigint: true });
    } catch (error) {
      fail(`executable ancestor is unavailable: ${error.message}`);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(cursor) !== cursor) {
      fail('executable ancestor chain must contain only canonical directories');
    }
    const mode = stat.mode & 0o7777n;
    if (invokingUid !== null && stat.uid !== invokingUid && stat.uid !== 0n) {
      fail('executable ancestor chain has an untrusted owner');
    }
    if ((mode & 0o022n) !== 0n) {
      const rootOwnedStickyBoundary = stat.uid === 0n && (mode & 0o1000n) !== 0n;
      if (!rootOwnedStickyBoundary) {
        fail('executable ancestor chain contains an unsafe writable directory');
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

let pathBefore;
try {
  pathBefore = lstatSync(requested, { bigint: true });
} catch (error) {
  fail(`executable path is unavailable: ${error.message}`);
}
inspectStat(pathBefore);
if (typeof process.getuid === 'function'
    && pathBefore.uid !== BigInt(process.getuid())
    && pathBefore.uid !== 0n) {
  fail('executable path has an untrusted owner');
}
verifyTrustedAncestorChain(requested);

let canonical;
try {
  canonical = realpathSync(requested);
} catch (error) {
  fail(`executable path cannot be canonicalized: ${error.message}`);
}
if (canonical !== requested) fail('executable path or one of its ancestors is not canonical');

let descriptor;
try {
  descriptor = openSync(requested, constants.O_RDONLY | constants.O_NOFOLLOW);
} catch (error) {
  fail(`executable path cannot be opened without following links: ${error.message}`);
}

let descriptorBefore;
let descriptorAfter;
let sha256;
try {
  descriptorBefore = fstatSync(descriptor, { bigint: true });
  inspectStat(descriptorBefore);
  if (!sameIdentity(pathBefore, descriptorBefore)) fail('executable path changed before hashing');
  sha256 = createHash('sha256').update(readFileSync(descriptor)).digest('hex');
  descriptorAfter = fstatSync(descriptor, { bigint: true });
} catch (error) {
  if (String(error?.message ?? '').startsWith('I00_OPS_BLOCKED:')) throw error;
  fail(`executable path cannot be inspected: ${error.message}`);
} finally {
  closeSync(descriptor);
}
if (!sameIdentity(descriptorBefore, descriptorAfter)) fail('executable changed while hashing');

let pathAfter;
let canonicalAfter;
try {
  pathAfter = lstatSync(requested, { bigint: true });
  canonicalAfter = realpathSync(requested);
} catch (error) {
  fail(`executable path changed after hashing: ${error.message}`);
}
inspectStat(pathAfter);
if (canonicalAfter !== requested || !sameIdentity(descriptorAfter, pathAfter)) {
  fail('executable path changed after hashing');
}

const exactIdentity = identity(descriptorAfter);
const endpointIdentity = Object.entries(exactIdentity)
  .map(([key, value]) => `${key}=${value}`)
  .join(',');
process.stdout.write(`${JSON.stringify({
  status: 'EXECUTABLE_IDENTITY_VERIFIED',
  path: requested,
  sha256,
  identity: exactIdentity,
  endpointIdentity,
})}\n`);

import { createHash } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { fail } from './lib.mjs';

function identity(stat) {
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

export function readBoundJsonInput(raw, label, { maximumBytes = 4 * 1024 * 1024 } = {}) {
  if (typeof raw !== 'string' || raw === '/' || raw.length > 4_096
      || !isAbsolute(raw) || resolve(raw) !== raw
      || /[\u0000-\u001f\u007f]/u.test(raw)) {
    fail(`${label} must be one absolute lexical canonical path`);
  }
  let namedBefore;
  try {
    namedBefore = lstatSync(raw, { bigint: true });
  } catch (error) {
    fail(`${label} is unavailable: ${error.message}`);
  }
  const invokingUid = typeof process.getuid === 'function'
    ? BigInt(process.getuid())
    : null;
  if (!namedBefore.isFile() || namedBefore.isSymbolicLink()
      || namedBefore.nlink !== 1n || namedBefore.size <= 0n
      || namedBefore.size > BigInt(maximumBytes)
      || (namedBefore.mode & 0o022n) !== 0n
      || (namedBefore.mode & 0o7000n) !== 0n
      || (invokingUid !== null && namedBefore.uid !== 0n
        && namedBefore.uid !== invokingUid)) {
    fail(`${label} must be one bounded non-writable single-link regular file`);
  }
  let physical;
  try {
    physical = realpathSync.native(raw);
  } catch (error) {
    fail(`${label} cannot be physically canonicalized: ${error.message}`);
  }
  if (physical !== raw) {
    fail(`${label} path or one of its ancestors is not physically canonical`);
  }
  const beforeIdentity = identity(namedBefore);
  let descriptor;
  let bytes;
  try {
    descriptor = openSync(
      raw,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const openedBefore = fstatSync(descriptor, { bigint: true });
    if (!openedBefore.isFile() || openedBefore.nlink !== 1n
        || !sameIdentity(identity(openedBefore), beforeIdentity)) {
      fail(`${label} identity changed before descriptor read`);
    }
    bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(identity(openedAfter), beforeIdentity)
        || BigInt(bytes.length) !== openedAfter.size) {
      fail(`${label} identity changed during descriptor read`);
    }
  } catch (error) {
    if (String(error?.message ?? '').startsWith('I00_OPS_BLOCKED:')) throw error;
    fail(`${label} cannot be read exactly: ${error.message}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const namedAfter = lstatSync(raw, { bigint: true });
  if (!namedAfter.isFile() || namedAfter.isSymbolicLink()
      || realpathSync.native(raw) !== raw
      || !sameIdentity(identity(namedAfter), beforeIdentity)) {
    fail(`${label} named identity changed after descriptor read`);
  }
  let document;
  try {
    document = JSON.parse(bytes);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
  return Object.freeze({
    absolute: raw,
    identity: beforeIdentity,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    document: Object.freeze(document),
  });
}

export function recheckBoundJsonInput(expected, label) {
  const current = readBoundJsonInput(expected.absolute, label);
  if (current.sha256 !== expected.sha256
      || !sameIdentity(current.identity, expected.identity)) {
    fail(`${label} changed during validation`);
  }
  return current;
}

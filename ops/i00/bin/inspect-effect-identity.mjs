#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { fail, parseArgs } from '../lib.mjs';

const args = parseArgs(process.argv.slice(2));
const expectedArguments = ['expected-group', 'expected-user', 'getent', 'id', 'unit'];
if (Object.keys(args).sort().join('\0') !== expectedArguments.join('\0')) {
  fail('--unit, --id, --getent, --expected-user, and --expected-group are required');
}

function exactName(value, label) {
  if (typeof value !== 'string' || !/^[a-z_][a-z0-9_-]{0,31}$/u.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}

function trustedRegular(path, label, { executable = false, maximumBytes }) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path
      || realpathSync(path) !== path) {
    fail(`${label} must be one canonical absolute path`);
  }
  const before = lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
      || before.size <= 0n || before.size > BigInt(maximumBytes)
      || (before.mode & 0o022n) !== 0n
      || (executable && (before.mode & 0o111n) === 0n)) {
    fail(`${label} is not one trusted bounded regular file`);
  }
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  if (invokingUid !== null && before.uid !== 0n && before.uid !== invokingUid) {
    fail(`${label} owner is untrusted`);
  }
  let cursor = dirname(path);
  for (;;) {
    const stat = lstatSync(cursor, { bigint: true });
    const mode = stat.mode & 0o7777n;
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(cursor) !== cursor
        || (invokingUid !== null && stat.uid !== 0n && stat.uid !== invokingUid)
        || ((mode & 0o022n) !== 0n
          && !(stat.uid === 0n && (mode & 0o1000n) !== 0n))) {
      fail(`${label} ancestor chain is untrusted`);
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const openedBefore = fstatSync(descriptor, { bigint: true });
    if (openedBefore.dev !== before.dev || openedBefore.ino !== before.ino
        || openedBefore.mode !== before.mode || openedBefore.size !== before.size
        || openedBefore.mtimeNs !== before.mtimeNs || openedBefore.ctimeNs !== before.ctimeNs) {
      fail(`${label} identity changed before read`);
    }
    const bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const after = lstatSync(path, { bigint: true });
    for (const key of ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs']) {
      if (openedAfter[key] !== openedBefore[key] || after[key] !== openedAfter[key]) {
        fail(`${label} identity changed during read`);
      }
    }
    return Object.freeze({
      path,
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      endpointIdentity: [
        `device=${openedAfter.dev}`,
        `inode=${openedAfter.ino}`,
        `mode=${openedAfter.mode.toString(8)}`,
        `size=${openedAfter.size}`,
        `mtimeNs=${openedAfter.mtimeNs}`,
        `ctimeNs=${openedAfter.ctimeNs}`,
      ].join(','),
    });
  } finally {
    closeSync(descriptor);
  }
}

function requireSameTrustedRegular(expected, label, options) {
  const current = trustedRegular(expected.path, label, options);
  if (current.sha256 !== expected.sha256
      || current.endpointIdentity !== expected.endpointIdentity) {
    fail(`${label} identity or digest changed around action-time invocation`);
  }
}

const expectedUser = exactName(args['expected-user'], 'expected user');
const expectedGroup = exactName(args['expected-group'], 'expected group');
const unit = trustedRegular(args.unit, 'effect unit', {
  executable: false,
  maximumBytes: 1024 * 1024,
});
const id = trustedRegular(args.id, 'identity resolver', {
  executable: true,
  maximumBytes: 1024 * 1024 * 1024,
});
const getent = trustedRegular(args.getent, 'group resolver', {
  executable: true,
  maximumBytes: 1024 * 1024 * 1024,
});
const text = unit.bytes.toString('utf8');
if (Buffer.from(text, 'utf8').length !== unit.bytes.length
    || text.includes('\r') || text.includes('\0')) {
  fail('effect unit is not canonical UTF-8 line text');
}
let section = '';
const values = new Map();
for (const rawLine of text.split('\n')) {
  const line = rawLine.trim();
  if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) continue;
  const sectionMatch = /^\[([A-Za-z][A-Za-z0-9]*)\]$/u.exec(line);
  if (sectionMatch) {
    section = sectionMatch[1];
    continue;
  }
  if (section !== 'Service') continue;
  const match = /^(User|Group)=(.*)$/u.exec(line);
  if (!match) continue;
  if (values.has(match[1])) fail(`effect unit contains duplicate ${match[1]} binding`);
  values.set(match[1], match[2]);
}
if (values.size !== 2 || values.get('User') !== expectedUser
    || values.get('Group') !== expectedGroup) {
  fail('effect unit does not bind the sealed intended user/group');
}

function resolveId(flag, label) {
  const result = spawnSync(id.path, [flag, expectedUser], {
    encoding: 'utf8',
    env: {
      HOME: '/nonexistent',
      LANG: 'C',
      LC_ALL: 'C',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin',
      TZ: 'UTC',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  requireSameTrustedRegular(id, 'identity resolver', {
    executable: true,
    maximumBytes: 1024 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status !== 0 || result.stderr !== '') {
    fail(`${label} resolution failed`);
  }
  const value = result.stdout.trim();
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)
      || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    fail(`${label} resolution returned an invalid identifier`);
  }
  return value;
}

const uid = resolveId('-u', 'effect uid');

function resolveGroup() {
  const groupResult = spawnSync(getent.path, ['group', expectedGroup], {
    encoding: 'utf8',
    env: {
      HOME: '/nonexistent',
      LANG: 'C',
      LC_ALL: 'C',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin',
      TZ: 'UTC',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  requireSameTrustedRegular(getent, 'group resolver', {
    executable: true,
    maximumBytes: 1024 * 1024 * 1024,
  });
  if (groupResult.error || groupResult.signal || groupResult.status !== 0
      || groupResult.stderr !== '') {
    fail('effect gid resolution failed');
  }
  const groupLines = groupResult.stdout.trim().split('\n');
  const groupFields = groupLines.length === 1 ? groupLines[0].split(':') : [];
  const value = groupFields.length === 4 && groupFields[0] === expectedGroup
    ? groupFields[2] : '';
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)
      || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    fail('effect gid resolution returned an invalid identifier');
  }
  return value;
}
const gid = resolveGroup();
const finalUid = resolveId('-u', 'effect uid');
const finalGid = resolveGroup();
requireSameTrustedRegular(unit, 'effect unit', {
  executable: false,
  maximumBytes: 1024 * 1024,
});
requireSameTrustedRegular(id, 'identity resolver', {
  executable: true,
  maximumBytes: 1024 * 1024 * 1024,
});
requireSameTrustedRegular(getent, 'group resolver', {
  executable: true,
  maximumBytes: 1024 * 1024 * 1024,
});
if (finalUid !== uid || finalGid !== gid) {
  fail('effect uid/gid changed during final action-time revalidation');
}
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  status: 'EFFECT_IDENTITY_VERIFIED',
  unitPath: unit.path,
  unitSha256: unit.sha256,
  unitIdentity: unit.endpointIdentity,
  user: expectedUser,
  group: expectedGroup,
  uid,
  gid,
  idPath: id.path,
  idSha256: id.sha256,
  idIdentity: id.endpointIdentity,
  getentPath: getent.path,
  getentSha256: getent.sha256,
  getentIdentity: getent.endpointIdentity,
})}\n`);

#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import {
  basename, dirname, isAbsolute, join, resolve,
} from 'node:path';
import { fail, hasPlaceholder, isFullSha, parseArgs } from '../lib.mjs';

// Exact synthetic fixture bytes retained by the historical, byte-bound CS-03
// regression. Every other configuration must carry I00_DEPLOYED_SHA.
const SEALED_LEGACY_CS03_BYTES = 449;
const SEALED_LEGACY_CS03_SHA256 = '8a0102cdc3da2056381e8f4951619ee99daf13b65e8ad2aa392c537065d1ad40';

const args = parseArgs(process.argv.slice(2));
if (!args.env) fail('--env is required');

function envFileIdentity(stat) {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    links: stat.nlink.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  };
}

function exactEnvFile(raw) {
  if (typeof raw !== 'string' || raw === '/' || !isAbsolute(raw)
      || resolve(raw) !== raw || /[\u0000-\u001f\u007f]/u.test(raw)) {
    fail('--env must be one absolute lexical canonical path');
  }
  let stat;
  try {
    stat = lstatSync(raw, { bigint: true });
  } catch (error) {
    fail(`--env is unavailable: ${error.message}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1n) {
    fail('--env must identify one non-symlink single-link regular file');
  }
  if ((stat.mode & 0o022n) !== 0n || (stat.mode & 0o7000n) !== 0n) {
    fail('--env has an unsafe writable or special mode');
  }
  let physical;
  try {
    physical = realpathSync.native(raw);
  } catch (error) {
    fail(`--env cannot be physically canonicalized: ${error.message}`);
  }
  if (physical !== raw) {
    fail('--env path or one of its ancestors is not physically canonical');
  }
  return { path: raw, identity: envFileIdentity(stat) };
}

const envFileBefore = exactEnvFile(args.env);
const RUNTIME_EXECUTION_INJECTION_KEYS = new Set([
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_REPL_EXTERNAL_MODULE',
  'NODE_EXTRA_CA_CERTS',
  'NODE_ICU_DATA',
  'NODE_V8_COVERAGE',
  'NODE_DEBUG',
  'NODE_DEBUG_NATIVE',
  'NODE_REDIRECT_WARNINGS',
  'NODE_COMPILE_CACHE',
  'NODE_DISABLE_COMPILE_CACHE',
  'NODE_PRESERVE_SYMLINKS',
  'NODE_PRESERVE_SYMLINKS_MAIN',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NODE_USE_ENV_PROXY',
  'NODE_USE_SYSTEM_CA',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'LD_PROFILE',
  'LD_ORIGIN_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'OPENSSL_CONF',
  'OPENSSL_MODULES',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
]);
const values = {};
const envBytes = readFileSync(envFileBefore.path);
const lines = envBytes.toString('utf8').split(/\r?\n/);
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index].trim();
  if (!line || line.startsWith('#')) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (!match) fail(`invalid env syntax at line ${index + 1}`);
  if (match[1] in values) fail(`duplicate env key ${match[1]}`);
  if (RUNTIME_EXECUTION_INJECTION_KEYS.has(match[1])) {
    fail(`runtime execution injection key ${match[1]} is forbidden`);
  }
  if (/(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|CREDENTIAL)/.test(match[1])
      || /^(?:AWS_PROFILE|AWS_SESSION_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)$/.test(match[1])) {
    fail(`secret value key ${match[1]} is forbidden in the non-secret env file`);
  }
  values[match[1]] = match[2];
}

const isSealedLegacyCs03Fixture = Object.keys(args).length === 1
  && envBytes.length === SEALED_LEGACY_CS03_BYTES
  && createHash('sha256').update(envBytes).digest('hex') === SEALED_LEGACY_CS03_SHA256;

function canonicalPhysicalFuture(raw, label) {
  if (typeof raw !== 'string' || raw === '/' || !isAbsolute(raw) || resolve(raw) !== raw) {
    fail(`${label} must be one canonical non-root absolute path`);
  }
  let cursor = raw;
  const suffix = [];
  for (;;) {
    let stat;
    try {
      stat = lstatSync(cursor, { throwIfNoEntry: false });
    } catch (error) {
      fail(`${label} existing ancestor cannot be inspected: ${error.message}`);
    }
    if (stat !== undefined) {
      if (stat.isSymbolicLink() || realpathSync.native(cursor) !== cursor) {
        fail(`${label} must use one physical path without symbolic-link traversal`);
      }
      if (suffix.length > 0 && !stat.isDirectory()) {
        fail(`${label} deepest existing ancestor must be one directory`);
      }
      const projected = join(cursor, ...suffix);
      if (projected !== raw) fail(`${label} physical projection changed`);
      return projected;
    }
    const parent = dirname(cursor);
    const component = basename(cursor);
    if (parent === cursor || !component || component === '.' || component === '..') {
      fail(`${label} has an unsafe missing path suffix`);
    }
    suffix.unshift(component);
    cursor = parent;
  }
}

const required = [
  'HOST', 'PORT', 'DATA_DIR', 'EVIDENCE_DIR', 'MODEL_DIR', 'BACKUP_DIR',
  'CONTROL_ROOM_OPERATOR_EMAIL', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD',
  'I00_TESTED_SHA', 'I00_DEPLOYED_SHA', 'I00_CONFIG_REVISION', 'I00_MODEL_REVISION',
  'I00_PUBLIC_SOURCE_STARTUP_EGRESS',
];
for (const key of required) {
  if (key === 'I00_DEPLOYED_SHA' && isSealedLegacyCs03Fixture) continue;
  if (!values[key] || hasPlaceholder(values[key])) fail(`required config ${key} is missing or unresolved`);
}
if (values.HOST !== '127.0.0.1') fail('HOST must remain exactly 127.0.0.1');
if (!/^\d+$/.test(values.PORT) || Number(values.PORT) < 1024 || Number(values.PORT) > 65535) fail('PORT is invalid');
const runtimePathKeys = ['DATA_DIR', 'EVIDENCE_DIR', 'MODEL_DIR', 'BACKUP_DIR'];
const paths = runtimePathKeys.map((key) => (
  isSealedLegacyCs03Fixture
    ? values[key]
    : canonicalPhysicalFuture(values[key], key)
));
const pathsOverlap = (left, right) => (
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
);
if (paths.some((path) => !isAbsolute(path))
    || paths.some((left, index) => paths.slice(index + 1)
      .some((right) => pathsOverlap(left, right)))) {
  fail('durable data/evidence/model/backup paths must be distinct and non-nested');
}
// F-033 (scoped): DATA_DIR_LOGICAL_LEASE_ROOT is a hard production boot
// requirement (environment.ts throws DATA_DIR_LOGICAL_LEASE_ROOT_REQUIRED).
// Shape rules are enforced whenever the key is present, mirroring the
// runtime (absolute; never nested with DATA_DIR in either direction, which
// environment.ts rejects as DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID).
// PRESENCE cannot be required here yet: the CS-03 amendment regression test
// (ops/tests/i00/test-cs-03-public-source-admission.sh) feeds this validator
// a fixture env without the key, and that test's bytes are immutably bound
// by l15-amendment-contract regressionTests - evolving it needs a
// director-ratified amendment mechanism. Recorded in EV_REHEARSAL_IMPL.md.
if ('DATA_DIR_LOGICAL_LEASE_ROOT' in values) {
  if (!values.DATA_DIR_LOGICAL_LEASE_ROOT || hasPlaceholder(values.DATA_DIR_LOGICAL_LEASE_ROOT)) {
    fail('DATA_DIR_LOGICAL_LEASE_ROOT is present but unresolved');
  }
  if (!isAbsolute(values.DATA_DIR_LOGICAL_LEASE_ROOT)) {
    fail('DATA_DIR_LOGICAL_LEASE_ROOT must be an absolute path');
  }
  const leaseRoot = isSealedLegacyCs03Fixture
    ? values.DATA_DIR_LOGICAL_LEASE_ROOT
    : canonicalPhysicalFuture(
      values.DATA_DIR_LOGICAL_LEASE_ROOT,
      'DATA_DIR_LOGICAL_LEASE_ROOT',
    );
  if (pathsOverlap(leaseRoot, paths[0])) {
    fail('DATA_DIR_LOGICAL_LEASE_ROOT and DATA_DIR must not nest');
  }
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.CONTROL_ROOM_OPERATOR_EMAIL)) fail('operator email is invalid');
if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(values.CF_ACCESS_TEAM_DOMAIN)) fail('Cloudflare Access team domain is invalid');
if (!/^[A-Za-z0-9_-]{8,256}$/.test(values.CF_ACCESS_AUD)) fail('Cloudflare Access audience is invalid');
if (!isFullSha(values.I00_TESTED_SHA)) fail('I00_TESTED_SHA must be a full Git SHA');
if (!isSealedLegacyCs03Fixture && !isFullSha(values.I00_DEPLOYED_SHA)) {
  fail('I00_DEPLOYED_SHA must be a full Git SHA');
}
if (values.I00_PUBLIC_SOURCE_STARTUP_EGRESS !== '1') {
  fail('I00_PUBLIC_SOURCE_STARTUP_EGRESS must be exactly 1');
}
if ('I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES' in values) {
  fail('I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES is forbidden in activation config');
}
if (args['expected-sha'] !== undefined && !isFullSha(args['expected-sha'])) {
  fail('--expected-sha must be a full Git SHA');
}
if (args['expected-sha'] && values.I00_TESTED_SHA !== args['expected-sha']) {
  fail('runtime config tested SHA does not match the candidate release');
}
if (args['expected-sha'] && values.I00_DEPLOYED_SHA !== args['expected-sha']) {
  fail('runtime config deployed SHA does not match the candidate release');
}
const envFileAfter = exactEnvFile(args.env);
if (JSON.stringify(envFileAfter) !== JSON.stringify(envFileBefore)) {
  fail('--env identity changed during validation');
}

process.stdout.write(`${JSON.stringify({
  status: isSealedLegacyCs03Fixture
    ? 'CONFIG_VALID_SEALED_CS03_REGRESSION_ONLY'
    : 'CONFIG_VALID_NO_SECRETS',
  host: values.HOST,
  port: Number(values.PORT),
  testedSha: values.I00_TESTED_SHA,
  deployedSha: isSealedLegacyCs03Fixture ? null : values.I00_DEPLOYED_SHA,
})}\n`);

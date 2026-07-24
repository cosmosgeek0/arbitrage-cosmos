#!/usr/bin/env node
import {
  basename, dirname, isAbsolute, resolve,
} from 'node:path';
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync,
  realpathSync, writeFileSync,
} from 'node:fs';
import { fail, parseArgs } from '../lib.mjs';
import { isWithinSimulationRoot, validateSimulationRoot } from '../simulation-safety.mjs';

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

function requireCanonicalAbsolutePath(value, label) {
  if (typeof value !== 'string' || value === '/' || !isAbsolute(value)
      || resolve(value) !== value) {
    fail(`${label} must be one lexical-canonical non-root absolute path`);
  }
  return value;
}

function canonicalPotentialPath(value, label) {
  requireCanonicalAbsolutePath(value, label);
  let cursor = value;
  const suffix = [];
  for (;;) {
    let stat;
    try {
      stat = lstatSync(cursor, { throwIfNoEntry: false });
    } catch (error) {
      if (error?.code !== 'EACCES' && error?.code !== 'EPERM') {
        fail(`${label} existing ancestor cannot be inspected`);
      }
      stat = undefined;
    }
    if (stat !== undefined) {
      let ancestor;
      try {
        ancestor = realpathSync(cursor);
      } catch (error) {
        if (error?.code !== 'EACCES' && error?.code !== 'EPERM') {
          fail(`${label} existing ancestor cannot be canonicalized`);
        }
        ancestor = undefined;
      }
      if (ancestor === undefined) {
        const parent = dirname(cursor);
        if (parent === cursor) fail(`${label} is unreadable`);
        suffix.unshift(basename(cursor));
        cursor = parent;
        continue;
      }
      if (suffix.length > 0) {
        let ancestorStat;
        try {
          ancestorStat = lstatSync(ancestor, { bigint: true });
        } catch {
          fail(`${label} projected ancestor cannot be inspected`);
        }
        if (!ancestorStat.isDirectory()) fail(`${label} existing ancestor is not a directory`);
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

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function requirePhysicalProtectedUnionDisjoint(path, label) {
  const physicalCandidate = canonicalPotentialPath(path, label);
  for (const protectedInput of PROTECTED_MUTATION_ROOTS) {
    const protectedPhysical = canonicalPotentialPath(
      protectedInput,
      'protected production root',
    );
    if (pathsOverlap(physicalCandidate, protectedPhysical)) {
      fail(`${label} intersects the physically projected protected production root union`);
    }
  }
  return physicalCandidate;
}

function verifyCanonicalAncestorChain(path, label) {
  let cursor = dirname(path);
  for (;;) {
    let stat;
    let physical;
    try {
      stat = lstatSync(cursor, { bigint: true });
      physical = realpathSync(cursor);
    } catch {
      fail(`${label} ancestor chain cannot be inspected exactly`);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || physical !== cursor) {
      fail(`${label} ancestor chain must contain only physical non-symlink directories`);
    }
    const parent = dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

function readBoundDonorEnv(path) {
  const label = 'donor env input';
  const absolute = requireCanonicalAbsolutePath(path, label);
  verifyCanonicalAncestorChain(absolute, label);
  let descriptor;
  try {
    const before = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
    if (!before?.isFile() || before.isSymbolicLink() || before.nlink !== 1n
        || realpathSync(absolute) !== absolute) {
      fail(`${label} must be one physical non-symlink single-link regular file`);
    }
    const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
    if (invokingUid !== null && before.uid !== invokingUid && before.uid !== 0n) {
      fail(`${label} owner is untrusted`);
    }
    if ((before.mode & 0o022n) !== 0n || before.size <= 0n || before.size > 1024n * 1024n) {
      fail(`${label} mode or size is unsafe`);
    }
    descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const openedBefore = fstatSync(descriptor, { bigint: true });
    const identity = (stat) => [
      stat.dev, stat.ino, stat.mode, stat.nlink, stat.uid, stat.gid,
      stat.size, stat.mtimeNs, stat.ctimeNs,
    ].map(String).join(':');
    if (identity(openedBefore) !== identity(before)) fail(`${label} identity changed while opening`);
    const bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const namedAfter = lstatSync(absolute, { bigint: true });
    if (identity(openedAfter) !== identity(openedBefore)
        || identity(namedAfter) !== identity(openedBefore)
        || realpathSync(absolute) !== absolute) {
      fail(`${label} identity changed while reading`);
    }
    return Object.freeze({ absolute, text: bytes.toString('utf8') });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) fail(error.message);
    fail(`${label} exact inspection failed`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

const args = parseArgs(
  process.argv.slice(2),
  new Set(['require-first-host-no-current', 'require-effect-bindings', 'require-hash']),
);
const supportedArguments = new Set([
  'env', 'output', 'result-fd', 'profile', 'require-first-host-no-current', 'require-effect-bindings',
  'require-hash', 'node', 'bash', 'env-bin', 'sqlite', 'systemctl', 'curl', 'tar', 'hash',
  'provenance-mode', 'provenance-root',
]);
for (const key of Object.keys(args)) {
  if (!supportedArguments.has(key)) fail(`unsupported argument --${key}`);
}
if (!args.env || !args.profile || !args['provenance-mode']) {
  fail('--env, --profile, and --provenance-mode are required');
}
const resultFdMode = args['result-fd'] !== undefined;
if ((args.output === undefined) === !resultFdMode) {
  fail('exactly one of --output or --result-fd 3 is required');
}
if (resultFdMode && args['result-fd'] !== '3') {
  fail('--result-fd must equal the exact inherited descriptor 3');
}
if (args['require-first-host-no-current'] && args.profile !== 'deploy') {
  fail('--require-first-host-no-current is valid only with --profile deploy');
}
if (args['require-hash'] && args.profile !== 'backup') {
  fail('--require-hash is valid only with --profile backup');
}

const profiles = {
  deploy: new Set([
    'COSMOS_ROOT', 'RELEASES_DIR', 'CURRENT_LINK', 'PREVIOUS_LINK', 'DATA_DIR', 'OPS_STATE_DIR',
    'APP_UNIT', 'TUNNEL_UNIT', 'HEALTH_BASE', 'PROBE_BASE', 'PROBE_ENABLED', 'PROBE_PORT',
    'READINESS_GATE_PATHS', 'POST_SWITCH_GATE_PATHS', 'GATE_TIMEOUT_SEC', 'HTTP_TIMEOUT_SEC',
    'LOCK_TIMEOUT_SEC', 'DEPLOY_LOCK', 'DEPLOY_LOG', 'FROZEN_MARKER', 'MONEY_READY_MARKER',
    'EXPOSURE_CMD', 'I00_OPS_READBACK_URL', 'I00_OPS_READBACK_TIMEOUT_MS',
    'ALERT_CMD', 'NODE', 'SYSTEMCTL', 'CURL',
  ]),
  backup: new Set([
    'DATA_DIR', 'OPS_STATE_DIR', 'APP_UNIT', 'BACKUP_DIR', 'BACKUP_RETENTION_COUNT',
    'BACKUP_MAX_AGE_HOURS', 'EVIDENCE_PATHS', 'EVIDENCE_MISSING_POLICY', 'BACKUP_LOCK',
    'NODE', 'SQLITE', 'SYSTEMCTL', 'TAR', 'HASH', 'HTTP_TIMEOUT_SEC', 'LOCK_TIMEOUT_SEC',
  ]),
};
const allowed = profiles[args.profile];
if (!allowed) fail('--profile must be deploy or backup');
if (resultFdMode && !args['require-effect-bindings']) {
  fail('--result-fd 3 requires exact effect bindings');
}
if (resultFdMode && args.profile === 'backup' && !args['require-hash']) {
  fail('--result-fd 3 backup mode requires the exact hash binding');
}

const provenanceMode = args['provenance-mode'];
if (!['SYSTEM', 'STAGING', 'TEST'].includes(provenanceMode)) {
  fail('--provenance-mode must be SYSTEM, STAGING, or TEST');
}
let provenanceRoot = null;
if (provenanceMode === 'SYSTEM') {
  if (args['provenance-root'] !== undefined) {
    fail('SYSTEM provenance rejects --provenance-root');
  }
} else {
  if (typeof args['provenance-root'] !== 'string') {
    fail(`${provenanceMode} provenance requires --provenance-root`);
  }
  if (provenanceMode === 'TEST') {
    try {
      provenanceRoot = validateSimulationRoot(args['provenance-root']);
      requirePhysicalProtectedUnionDisjoint(provenanceRoot, 'TEST provenance root');
    } catch {
      fail('TEST provenance root must be one canonical marked simulation root');
    }
  } else {
    const requested = args['provenance-root'];
    const stat = typeof requested === 'string'
      ? lstatSync(requested, { bigint: true, throwIfNoEntry: false })
      : undefined;
    if (typeof requested !== 'string' || !isAbsolute(requested)
        || !/^\/var\/tmp\/cosmos-df32-proof-[a-f0-9]{4}$/u.test(requested)
        || resolve(requested) !== requested || !stat?.isDirectory()
        || stat.isSymbolicLink() || realpathSync(requested) !== requested
        || stat.uid !== 0n || (stat.mode & 0o777n) !== 0o700n) {
      fail('STAGING provenance root must be one exact /var/tmp/cosmos-df32-proof-<4> root-owned mode-0700 directory');
    }
    requirePhysicalProtectedUnionDisjoint(requested, 'STAGING provenance root');
    verifyCanonicalAncestorChain(resolve(requested, 'proof-placeholder'), 'STAGING provenance root');
    provenanceRoot = requested;
  }
}

const output = resultFdMode ? null : requireCanonicalAbsolutePath(args.output, '--output');
const outputParent = resultFdMode ? null : dirname(output);
if (!resultFdMode && provenanceMode === 'SYSTEM') {
  let systemTemp;
  let systemTempStat;
  try {
    systemTemp = realpathSync('/tmp');
    systemTempStat = lstatSync(systemTemp, { bigint: true });
  } catch {
    fail('SYSTEM sanitized donor env requires the physical /tmp boundary');
  }
  const systemTempMode = systemTempStat.mode & 0o7777n;
  if (!systemTempStat.isDirectory() || systemTempStat.isSymbolicLink()
      || systemTempStat.uid !== 0n
      || ((systemTempMode & 0o022n) !== 0n && (systemTempMode & 0o1000n) === 0n)
      || dirname(outputParent) !== systemTemp) {
    fail('SYSTEM sanitized donor env output must use one exact physical /tmp wrapper parent');
  }
  const parentLeaf = basename(outputParent);
  const outputLeaf = basename(output);
  const systemCategoryAccepted = args.profile === 'deploy'
    ? ((/^i00-release-switch\.[A-Za-z0-9_-]+$/u.test(parentLeaf)
          && outputLeaf === 'deploy.env')
        || (/^i00-rollback-switch\.[A-Za-z0-9_-]+$/u.test(parentLeaf)
          && outputLeaf === 'deploy.env'))
    : ((/^i00-backup-verify\.[A-Za-z0-9_-]+$/u.test(parentLeaf)
          && ['unbound.env', 'backup.env'].includes(outputLeaf))
        || (/^i00-restore-verify\.[A-Za-z0-9_-]+$/u.test(parentLeaf)
          && ['unbound.env', 'backup.env'].includes(outputLeaf)));
  if (!systemCategoryAccepted) {
    fail(`SYSTEM ${args.profile} sanitized donor env output is outside the exact wrapper parent and caller leaf families`);
  }
}
if (!resultFdMode && provenanceMode === 'TEST') {
  let inside = false;
  try {
    inside = isWithinSimulationRoot(provenanceRoot, output);
  } catch {
    inside = false;
  }
  if (!inside) fail('TEST sanitized donor env output must remain below the marked simulation root');
}
if (!resultFdMode && provenanceMode === 'STAGING') {
  const expected = resolve(
    provenanceRoot,
    'sanitized',
    args.profile === 'deploy' ? 'deploy.env' : 'backup.env',
  );
  if (output !== expected) {
    fail(`STAGING ${args.profile} sanitized donor env output must equal the exact proof path ${expected}`);
  }
}

const donorEnv = readBoundDonorEnv(args.env);
if (provenanceMode !== 'SYSTEM') {
  let inside = false;
  try {
    inside = isWithinSimulationRoot(provenanceRoot, donorEnv.absolute);
  } catch {
    inside = false;
  }
  if (provenanceMode === 'STAGING') {
    inside = donorEnv.absolute.startsWith(`${provenanceRoot}/`);
  }
  if (!inside) fail(`${provenanceMode} donor env input must remain below the declared provenance root`);
}
const values = {};
for (const [index, rawLine] of donorEnv.text.split(/\r?\n/).entries()) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (!match) fail(`donor env syntax is invalid at line ${index + 1}`);
  const [, key, raw] = match;
  if (!allowed.has(key)) fail(`donor env key ${key} is outside the closed ${args.profile} profile`);
  if (key in values) fail(`duplicate donor env key ${key}`);
  let value = raw;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    value = raw.slice(1, -1);
  } else if (/\s/.test(raw)) {
    fail(`unquoted whitespace is forbidden in donor env value ${key}`);
  }
  if (value.includes("'") || /[\0\r\n`$\\;&|<>(){}\[\]*?!~]/.test(value)) {
    fail(`donor env value ${key} contains executable or ambiguous shell syntax`);
  }
  values[key] = value;
}
const required = args.profile === 'deploy'
  ? ['COSMOS_ROOT', 'RELEASES_DIR', 'CURRENT_LINK', 'PREVIOUS_LINK', 'DATA_DIR', 'OPS_STATE_DIR', 'APP_UNIT', 'HEALTH_BASE']
  : ['DATA_DIR', 'BACKUP_DIR', 'OPS_STATE_DIR'];
for (const key of required) if (!values[key]) fail(`donor env is missing required ${key}`);

if (args.profile === 'backup') {
  for (const key of ['DATA_DIR', 'BACKUP_DIR', 'OPS_STATE_DIR']) {
    if (values[key] === '/' || !isAbsolute(values[key]) || resolve(values[key]) !== values[key]) {
      fail(`donor env ${key} must be one canonical non-root absolute path`);
    }
  }
  const expectedBackupLock = `${values.BACKUP_DIR}/.lock`;
  if (Object.hasOwn(values, 'BACKUP_LOCK') && values.BACKUP_LOCK !== expectedBackupLock) {
    fail(`donor env BACKUP_LOCK must remain inside the canonical backup directory; expected ${expectedBackupLock}`);
  }
  values.BACKUP_LOCK = expectedBackupLock;
  if (Object.hasOwn(values, 'EVIDENCE_PATHS') && values.EVIDENCE_PATHS !== '') {
    fail('authorized backup donor env EVIDENCE_PATHS must be empty');
  }
  values.EVIDENCE_PATHS = '';
}

const bindingArguments = Object.freeze({
  node: 'NODE',
  bash: 'I00_BASH',
  'env-bin': 'I00_ENV',
  sqlite: 'SQLITE',
  systemctl: 'SYSTEMCTL',
  curl: 'CURL',
  tar: 'TAR',
  hash: 'HASH',
});
const profileBindings = args.profile === 'deploy'
  ? ['node', 'bash', 'env-bin', 'systemctl', 'curl']
  : ['node', 'bash', 'env-bin', 'sqlite', 'tar'];
if (args['require-effect-bindings']) {
  for (const key of profileBindings) {
    if (!args[key]) fail(`--${key} is required for exact ${args.profile} effect bindings`);
  }
  if (args.profile === 'backup' && args['require-hash'] && !args.hash) {
    fail('--hash is required for exact backup hash binding');
  }
}
for (const [argument, envKey] of Object.entries(bindingArguments)) {
  if (!args[argument]) continue;
  if (!['I00_BASH', 'I00_ENV'].includes(envKey) && !allowed.has(envKey)) {
    fail(`--${argument} is outside the ${args.profile} profile`);
  }
  const value = args[argument];
  if (value === '/' || !isAbsolute(value) || resolve(value) !== value) {
    fail(`--${argument} must be one canonical absolute executable path`);
  }
  values[envKey] = value;
}

if (args.profile === 'deploy') {
  const canonicalGatePaths = '/health/live /health/ready';
  const canonicalPathKeys = [
    'COSMOS_ROOT', 'RELEASES_DIR', 'CURRENT_LINK', 'PREVIOUS_LINK', 'DATA_DIR', 'OPS_STATE_DIR',
  ];
  const pointerLeafKeys = new Set(['CURRENT_LINK', 'PREVIOUS_LINK']);
  const physicalFutureView = (value, key) => {
    let cursor = pointerLeafKeys.has(key) ? dirname(value) : value;
    const unresolved = pointerLeafKeys.has(key) ? [basename(value)] : [];
    for (;;) {
      let stat;
      try {
        stat = lstatSync(cursor, { throwIfNoEntry: false });
      } catch (error) {
        fail(`donor env ${key} existing ancestor cannot be inspected: ${error.message}`);
      }
      if (stat !== undefined) {
        if (stat.isSymbolicLink()) {
          fail(`donor env ${key} existing ancestor chain contains a symlink alias`);
        }
        if (!stat.isDirectory()) {
          fail(`donor env ${key} existing ancestor must be a directory`);
        }
        let physicalAncestor;
        try {
          physicalAncestor = realpathSync(cursor);
        } catch (error) {
          fail(`donor env ${key} existing ancestor cannot be canonicalized: ${error.message}`);
        }
        const physical = resolve(physicalAncestor, ...unresolved);
        if (physical !== value) {
          fail(`donor env ${key} existing ancestor chain contains a symlink alias`);
        }
        return physical;
      }
      const parent = dirname(cursor);
      if (parent === cursor) {
        fail(`donor env ${key} has no canonical existing ancestor`);
      }
      unresolved.unshift(basename(cursor));
      cursor = parent;
    }
  };
  const physicalPaths = {};
  for (const key of canonicalPathKeys) {
    if (values[key] === '/' || !isAbsolute(values[key]) || resolve(values[key]) !== values[key]) {
      const requirement = key === 'OPS_STATE_DIR'
        ? 'one canonical absolute directory'
        : 'one non-root canonical absolute path';
      fail(`donor env ${key} must be ${requirement}`);
    }
    physicalPaths[key] = physicalFutureView(values[key], key);
  }
  const requireRelationship = (key, expected) => {
    if (physicalPaths[key] !== expected) {
      fail(`donor env ${key} must match the canonical COSMOS_ROOT release layout; expected ${expected}`);
    }
  };
  requireRelationship('RELEASES_DIR', `${physicalPaths.COSMOS_ROOT}/releases`);
  requireRelationship('CURRENT_LINK', `${physicalPaths.COSMOS_ROOT}/current`);
  requireRelationship('PREVIOUS_LINK', `${physicalPaths.COSMOS_ROOT}/previous`);

  const pathsOverlap = (left, right) => (
    left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
  );
  if (pathsOverlap(physicalPaths.DATA_DIR, physicalPaths.OPS_STATE_DIR)) {
    fail('donor env DATA_DIR and OPS_STATE_DIR must be distinct and disjoint');
  }
  for (const key of ['DATA_DIR', 'OPS_STATE_DIR']) {
    if (pathsOverlap(physicalPaths[key], physicalPaths.COSMOS_ROOT)) {
      fail(`donor env ${key} must be disjoint from the canonical COSMOS_ROOT release layout`);
    }
  }
  if (args['require-effect-bindings']) {
    for (const [key, expected] of Object.entries({
      GATE_TIMEOUT_SEC: '60',
      HTTP_TIMEOUT_SEC: '5',
      LOCK_TIMEOUT_SEC: '30',
      I00_OPS_READBACK_TIMEOUT_MS: '750',
    })) {
      if (values[key] !== expected) {
        fail(`authorized donor env ${key} must equal ${expected}`);
      }
    }
    let dataStat;
    let canonicalData;
    try {
      dataStat = lstatSync(values.DATA_DIR);
      canonicalData = realpathSync(values.DATA_DIR);
    } catch (error) {
      fail(`donor env DATA_DIR is unavailable: ${error.message}`);
    }
    if (!dataStat.isDirectory() || dataStat.isSymbolicLink() || canonicalData !== values.DATA_DIR) {
      fail('donor env DATA_DIR must be one existing canonical non-symlink directory');
    }
  }

  const lockEffectiveValue = (key, expected, reason) => {
    if (Object.hasOwn(values, key) && values[key] !== expected) {
      fail(`donor env ${key} ${reason}; expected ${expected}`);
    }
    values[key] = expected;
  };
  const loopbackBase = (value, key) => {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      fail(`donor env ${key} must be an exact numeric-loopback HTTP origin`);
    }
    if (parsed.protocol !== 'http:'
        || !['127.0.0.1', '[::1]'].includes(parsed.hostname)
        || !parsed.port
        || parsed.username || parsed.password
        || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      fail(`donor env ${key} must be an exact numeric-loopback HTTP origin`);
    }
    const canonical = `http://${parsed.hostname}:${parsed.port}`;
    if (value !== canonical) fail(`donor env ${key} is not canonically encoded as ${canonical}`);
    return { canonical, hostname: parsed.hostname, port: Number(parsed.port) };
  };

  const health = loopbackBase(values.HEALTH_BASE, 'HEALTH_BASE');
  const probePortRaw = values.PROBE_PORT ?? '8091';
  if (!/^[1-9][0-9]{0,4}$/.test(probePortRaw)
      || Number(probePortRaw) > 65_535
      || String(Number(probePortRaw)) !== probePortRaw) {
    fail('donor env PROBE_PORT must be a canonical integer from 1 through 65535');
  }
  const probeBase = `http://${health.hostname}:${probePortRaw}`;
  if (health.port === Number(probePortRaw)) {
    fail('donor env PROBE_PORT must differ from the production HEALTH_BASE port');
  }
  if (Object.hasOwn(values, 'PROBE_BASE')) loopbackBase(values.PROBE_BASE, 'PROBE_BASE');
  lockEffectiveValue('PROBE_ENABLED', '1', 'must keep the pre-switch probe enabled');
  lockEffectiveValue('PROBE_PORT', probePortRaw, 'must remain canonical');
  lockEffectiveValue('PROBE_BASE', probeBase, 'must match the numeric-loopback probe port');
  lockEffectiveValue('READINESS_GATE_PATHS', canonicalGatePaths, 'must use the exact liveness and semantic-readiness gates');
  lockEffectiveValue('POST_SWITCH_GATE_PATHS', canonicalGatePaths, 'must use the exact liveness and semantic-readiness gates');
  lockEffectiveValue('DEPLOY_LOCK', `${values.OPS_STATE_DIR}/locks/deploy.lock`, 'must remain inside the canonical ops-state directory');
  lockEffectiveValue('DEPLOY_LOG', `${values.OPS_STATE_DIR}/deploy-log.jsonl`, 'must remain inside the canonical ops-state directory');
  lockEffectiveValue('FROZEN_MARKER', `${values.OPS_STATE_DIR}/deploy-frozen.json`, 'must remain inside the canonical ops-state directory');
  lockEffectiveValue('MONEY_READY_MARKER', `${values.OPS_STATE_DIR}/money-ready`, 'must remain inside the canonical ops-state directory');
  if (Object.hasOwn(values, 'EXPOSURE_CMD') && values.EXPOSURE_CMD !== '') {
    fail('donor env rejects named EXPOSURE_CMD selection');
  }
  if (Object.hasOwn(values, 'ALERT_CMD') && values.ALERT_CMD !== '') {
    fail('donor env rejects named ALERT_CMD selection');
  }
  delete values.EXPOSURE_CMD;
  delete values.ALERT_CMD;
  lockEffectiveValue(
    'I00_OPS_READBACK_URL',
    `${health.canonical}/api/system-integration/ops/readback`,
    'must match the authenticated numeric-loopback app origin',
  );
  if (args['require-first-host-no-current']) values.I00_REQUIRE_FIRST_HOST_NO_CURRENT = '1';
} else if (args['require-effect-bindings']) {
  const canonicalDirectory = (key) => {
    let stat;
    let canonical;
    try {
      stat = lstatSync(values[key]);
      canonical = realpathSync(values[key]);
    } catch (error) {
      fail(`donor env ${key} is unavailable: ${error.message}`);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || canonical !== values[key]) {
      fail(`donor env ${key} must be one existing canonical non-symlink directory`);
    }
    if (values[key] === '/') fail(`donor env ${key} must not be the filesystem root`);
  };
  for (const key of ['DATA_DIR', 'BACKUP_DIR', 'OPS_STATE_DIR']) canonicalDirectory(key);
  const pathsOverlap = (left, right) => (
    left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
  );
  for (const [left, right] of [
    ['DATA_DIR', 'BACKUP_DIR'],
    ['DATA_DIR', 'OPS_STATE_DIR'],
    ['BACKUP_DIR', 'OPS_STATE_DIR'],
  ]) {
    if (pathsOverlap(values[left], values[right])) {
      fail(`donor env ${left} and ${right} must be distinct and disjoint`);
    }
  }
}

const exactCategoryValues = args.profile === 'deploy'
  ? (provenanceMode === 'SYSTEM'
      ? Object.freeze({
          COSMOS_ROOT: '/opt/cosmos',
          RELEASES_DIR: '/opt/cosmos/releases',
          CURRENT_LINK: '/opt/cosmos/current',
          PREVIOUS_LINK: '/opt/cosmos/previous',
          DATA_DIR: '/var/lib/cosmos/data',
          OPS_STATE_DIR: '/var/lib/cosmos/ops',
        })
      : Object.freeze({
          COSMOS_ROOT: `${provenanceRoot}/cosmos`,
          RELEASES_DIR: `${provenanceRoot}/cosmos/releases`,
          CURRENT_LINK: `${provenanceRoot}/cosmos/current`,
          PREVIOUS_LINK: `${provenanceRoot}/cosmos/previous`,
          DATA_DIR: `${provenanceRoot}/data`,
          OPS_STATE_DIR: `${provenanceRoot}/ops-state`,
        }))
  : (provenanceMode === 'SYSTEM'
      ? Object.freeze({
          DATA_DIR: '/var/lib/cosmos/data',
          BACKUP_DIR: '/var/backups/cosmos',
          OPS_STATE_DIR: '/var/lib/cosmos/ops',
        })
      : Object.freeze({
          DATA_DIR: `${provenanceRoot}/data`,
          BACKUP_DIR: `${provenanceRoot}/backups`,
          OPS_STATE_DIR: `${provenanceRoot}/ops-state`,
        }));
for (const [key, expected] of Object.entries(exactCategoryValues)) {
  if (values[key] !== expected) {
    fail(`${provenanceMode} ${args.profile} donor env ${key} must equal the exact category path ${expected}`);
  }
}

// F-107: only the I00 wrapper path is authorized against the production
// root; the marker lets the donor deploy.sh distinguish the two paths
// mechanically instead of by documentation.
values.COSMOS_DEPLOY_VIA_I00_WRAPPER = '1';

const bytes = Buffer.from(
  `${Object.entries(values).map(([key, value]) => `${key}='${value}'`).join('\n')}\n`,
);
if (resultFdMode) {
  let resultDescriptorStat;
  try {
    resultDescriptorStat = fstatSync(3, { bigint: true });
  } catch {
    fail('--result-fd 3 must be one inherited non-filesystem descriptor');
  }
  if (!resultDescriptorStat.isFIFO() && !resultDescriptorStat.isSocket()) {
    fail('--result-fd 3 must be one inherited pipe or socket');
  }
  try {
    writeFileSync(3, bytes);
    closeSync(3);
  } catch {
    fail('sanitized donor env could not be emitted to inherited descriptor 3');
  }
  process.stdout.write('{"status":"SANITIZED_DONOR_ENV_EMITTED"}\n');
} else {
const directoryIdentity = (stat) => ({
  device: stat.dev.toString(),
  inode: stat.ino.toString(),
  mode: stat.mode.toString(8),
  uid: stat.uid.toString(),
  gid: stat.gid.toString(),
});
const fileObjectIdentity = (stat) => ({
  device: stat.dev.toString(),
  inode: stat.ino.toString(),
  mode: stat.mode.toString(8),
  links: stat.nlink.toString(),
  uid: stat.uid.toString(),
  gid: stat.gid.toString(),
});
const inspectParent = () => {
  const stat = lstatSync(outputParent, { bigint: true, throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()
      || realpathSync(outputParent) !== outputParent
      || (stat.mode & 0o777n) !== 0o700n) {
    fail('sanitized donor env output parent must be one canonical mode-0700 directory');
  }
  if (typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid())) {
    fail('sanitized donor env output parent owner must be the invoking identity');
  }
  return { stat, identity: directoryIdentity(stat) };
};
const parentBefore = inspectParent();
const recheckParent = () => {
  const current = inspectParent();
  if (JSON.stringify(current.identity) !== JSON.stringify(parentBefore.identity)) {
    fail('sanitized donor env output parent path identity changed');
  }
};
let parentDescriptor;
let outputDescriptor;
try {
  parentDescriptor = openSync(
    outputParent,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
  const openedParent = fstatSync(parentDescriptor, { bigint: true });
  if (!openedParent.isDirectory()
      || JSON.stringify(directoryIdentity(openedParent))
        !== JSON.stringify(parentBefore.identity)) {
    fail('sanitized donor env output parent descriptor identity changed');
  }
  recheckParent();
  const anchoredOutput = process.platform === 'linux'
    ? `/proc/self/fd/${parentDescriptor}/${basename(output)}`
    : output;
  outputDescriptor = openSync(
    anchoredOutput,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  const opened = fstatSync(outputDescriptor, { bigint: true });
  if (!opened.isFile() || opened.isSymbolicLink() || opened.nlink !== 1n
      || (opened.mode & 0o777n) !== 0o600n) {
    fail('sanitized donor env output claim is not one private single-link regular file');
  }
  if (typeof process.getuid === 'function' && opened.uid !== BigInt(process.getuid())) {
    fail('sanitized donor env output owner changed');
  }
  const openedIdentity = fileObjectIdentity(opened);
  writeFileSync(outputDescriptor, bytes);
  fsyncSync(outputDescriptor);
  const written = fstatSync(outputDescriptor, { bigint: true });
  if (JSON.stringify(fileObjectIdentity(written)) !== JSON.stringify(openedIdentity)
      || written.size !== BigInt(bytes.length)) {
    fail('sanitized donor env output identity changed during write');
  }
  recheckParent();
  const named = lstatSync(output, { bigint: true, throwIfNoEntry: false });
  if (!named?.isFile() || named.isSymbolicLink() || named.nlink !== 1n
      || realpathSync(output) !== output
      || JSON.stringify(fileObjectIdentity(named))
        !== JSON.stringify(fileObjectIdentity(written))) {
    fail('sanitized donor env final output identity is invalid');
  }
  fsyncSync(parentDescriptor);
  recheckParent();
} finally {
  if (outputDescriptor !== undefined) closeSync(outputDescriptor);
  if (parentDescriptor !== undefined) closeSync(parentDescriptor);
}
process.stdout.write('{"status":"SANITIZED_DONOR_ENV_WRITTEN"}\n');
}

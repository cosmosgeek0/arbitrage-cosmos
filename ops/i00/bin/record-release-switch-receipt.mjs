#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync,
  readFileSync, readlinkSync, realpathSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  fail, isUtc, requireExactKeys, sha256File, verifyArtifactManifest,
} from '../lib.mjs';

const FIRST_HOST_TARGET = 'NO_PRIOR_RELEASE_FIRST_HOST';
const SHA256_RE = /^[0-9a-f]{64}$/;
const FULL_SHA_RE = /^[0-9a-f]{40}$/;
const CLOSED_ENV = Object.freeze({
  PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
  HOME: '/',
  TMPDIR: '/tmp',
  LANG: 'C',
  LC_ALL: 'C',
});

function parseCli(argv) {
  const flags = new Set(['check-only', 'simulation-clock']);
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('--')) fail(`unexpected argument ${raw}`);
    const key = raw.slice(2);
    if (Object.hasOwn(out, key)) fail(`duplicate argument --${key}`);
    if (flags.has(key)) {
      out[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`${raw} requires a value`);
    out[key] = value;
    index += 1;
  }
  return out;
}

function requireOnly(args, allowed) {
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) fail(`unexpected argument --${key}`);
  }
}

function canonicalAbsolute(raw, label) {
  if (typeof raw !== 'string' || raw === '/' || !isAbsolute(raw) || resolve(raw) !== raw) {
    fail(`${label} must be one non-root canonical absolute path`);
  }
  return raw;
}

function safeAncestors(path, label, includeLeaf = true) {
  const parts = path.split('/').filter(Boolean);
  let cursor = '/';
  const limit = includeLeaf ? parts.length : parts.length - 1;
  for (let index = 0; index < limit; index += 1) {
    cursor = resolve(cursor, parts[index]);
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch (error) {
      fail(`${label} is unavailable: ${error.message}`);
    }
    if (stat.isSymbolicLink()) fail(`${label} must not traverse a symbolic link`);
    if (index < limit - 1 && !stat.isDirectory()) fail(`${label} has a non-directory ancestor`);
  }
}

function preflightOutput(raw) {
  const output = canonicalAbsolute(raw, '--output');
  safeAncestors(output, '--output parent', false);
  const parent = dirname(output);
  let parentStat;
  try {
    parentStat = lstatSync(parent, { bigint: true });
  } catch (error) {
    fail(`--output parent is unavailable: ${error.message}`);
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || realpathSync(parent) !== parent) {
    fail('--output parent must be one canonical real directory');
  }
  if ((parentStat.mode & 0o022n) !== 0n) fail('--output parent must not be group/world writable');
  try {
    lstatSync(output);
    fail('--output must be absent');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return {
    output,
    parent,
    identity: {
      device: parentStat.dev.toString(),
      inode: parentStat.ino.toString(),
      mode: parentStat.mode.toString(8),
      mtimeNs: parentStat.mtimeNs.toString(),
      ctimeNs: parentStat.ctimeNs.toString(),
    },
  };
}

function parseSanitizedEnv(raw) {
  const path = canonicalAbsolute(raw, '--env');
  safeAncestors(path, '--env');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path
      || (stat.mode & 0o777) !== 0o600) {
    fail('--env must be one canonical mode-0600 real file');
  }
  const text = readFileSync(path, 'utf8');
  if (!text.endsWith('\n')) fail('--env is not canonical sanitized output');
  const values = {};
  for (const line of text.slice(0, -1).split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)='([^']*)'$/.exec(line);
    if (!match || Object.hasOwn(values, match[1])) fail('--env is not canonical sanitized output');
    values[match[1]] = match[2];
  }
  for (const key of [
    'RELEASES_DIR', 'CURRENT_LINK', 'PREVIOUS_LINK', 'APP_UNIT',
    'HEALTH_BASE', 'POST_SWITCH_GATE_PATHS',
  ]) if (!values[key]) fail(`--env is missing ${key}`);
  return values;
}

function canonicalUtc(raw, label) {
  if (!isUtc(raw) || new Date(Date.parse(raw)).toISOString() !== raw.replace('Z', '.000Z')) {
    fail(`${label} must be canonical UTC seconds`);
  }
  return raw;
}

function completedAt(args) {
  if (args.now !== undefined) {
    if (!args['simulation-clock']) fail('--now is simulation-only');
    return canonicalUtc(args.now, '--now');
  }
  if (args['simulation-clock']) fail('--simulation-clock requires --now');
  return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

function statIdentity(stat) {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  };
}

function safeSymlinkState(path, expectedTarget, label) {
  safeAncestors(path, label, false);
  let stat;
  try {
    stat = lstatSync(path, { bigint: true });
  } catch (error) {
    fail(`${label} is unavailable: ${error.message}`);
  }
  if (!stat.isSymbolicLink()) fail(`${label} must be a symbolic link`);
  const target = resolve(dirname(path), readlinkSync(path));
  if (expectedTarget && target !== expectedTarget) fail(`${label} target differs from the exact release`);
  if (realpathSync(path) !== target) fail(`${label} does not resolve to its recorded target`);
  return { link: path, target, identity: statIdentity(stat) };
}

function absentPath(path, label) {
  safeAncestors(path, label, false);
  try {
    lstatSync(path);
    fail(`${label} must be absent`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function requireSystemctl(raw, unit) {
  const path = canonicalAbsolute(raw, '--systemctl');
  safeAncestors(path, '--systemctl');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path
      || (stat.mode & 0o111) === 0 || (stat.mode & 0o022) !== 0) {
    fail('--systemctl must be one canonical non-writable executable');
  }
  const result = spawnSync(path, ['is-active', unit], {
    encoding: 'utf8',
    env: CLOSED_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
    maxBuffer: 4_096,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0
      || result.stdout !== 'active\n' || result.stderr !== '') {
    fail(`application unit is not exactly active after the switch: ${result.error?.message ?? result.signal ?? `exit ${String(result.status)}`}`);
  }
}

function requireHealth(raw, base, paths) {
  const path = canonicalAbsolute(raw, '--curl');
  safeAncestors(path, '--curl');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path
      || (stat.mode & 0o111) === 0 || (stat.mode & 0o022) !== 0) {
    fail('--curl must be one canonical non-writable executable');
  }
  for (const gatePath of paths) {
    const result = spawnSync(path, [
      '--fail', '--silent', '--show-error',
      '--connect-timeout', '2', '--max-time', '5', '--max-redirs', '0',
      '--proto', '=http', '--noproxy', '*',
      '--output', '/dev/null', '--write-out', '%{http_code}',
      `${base}${gatePath}`,
    ], {
      encoding: 'utf8',
      env: CLOSED_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 7_000,
      maxBuffer: 4_096,
      windowsHide: true,
    });
    if (result.error || result.signal || result.status !== 0
        || result.stdout !== '200' || result.stderr !== '') {
      fail(`Gate-5 loopback health failed for ${gatePath}: ${result.error?.message ?? result.signal ?? `exit ${String(result.status)}`}`);
    }
  }
}

function captureSwitchState(env, verified, artifactManifestSha256, firstHost) {
  const releaseDestination = `${env.RELEASES_DIR}/${verified.release.releaseId}`;
  const currentLink = safeSymlinkState(env.CURRENT_LINK, releaseDestination, 'CURRENT_LINK');
  let currentStat;
  try {
    currentStat = lstatSync(currentLink.target, { bigint: true });
  } catch (error) {
    fail(`deployed release target is unavailable: ${error.message}`);
  }
  if (currentStat.isSymbolicLink() || !currentStat.isDirectory()
      || (currentStat.mode & 0o222n) !== 0n
      || realpathSync(currentLink.target) !== currentLink.target) {
    fail('deployed release target must be one canonical immutable real directory');
  }
  const deployed = verifyArtifactManifest(
    currentLink.target, null, { installedImmutable: true },
  );
  if (deployed.release.releaseId !== verified.release.releaseId
      || deployed.release.testedSha !== verified.release.testedSha
      || deployed.artifactManifestSha256 !== artifactManifestSha256) {
    fail('deployed release target differs from the authorized artifact');
  }

  let previous;
  let previousIdentity;
  if (firstHost) {
    absentPath(env.PREVIOUS_LINK, 'PREVIOUS_LINK');
    previous = { link: env.PREVIOUS_LINK, state: 'ABSENT', target: null };
    previousIdentity = { state: 'ABSENT' };
  } else {
    const previousLink = safeSymlinkState(env.PREVIOUS_LINK, null, 'PREVIOUS_LINK');
    const prefix = `${env.RELEASES_DIR}/`;
    const releaseName = previousLink.target.startsWith(prefix)
      ? previousLink.target.slice(prefix.length) : '';
    if (!/^i00-[0-9a-f]{40}$/.test(releaseName)
        || previousLink.target === currentLink.target) {
      fail('PREVIOUS_LINK is not one distinct direct release child');
    }
    let previousStat;
    try {
      previousStat = lstatSync(previousLink.target, { bigint: true });
    } catch (error) {
      fail(`previous release target is unavailable: ${error.message}`);
    }
    if (previousStat.isSymbolicLink() || !previousStat.isDirectory()
        || (previousStat.mode & 0o222n) !== 0n
        || realpathSync(previousLink.target) !== previousLink.target) {
      fail('previous release target must be one canonical immutable real directory');
    }
    const previousRelease = verifyArtifactManifest(
      previousLink.target, null, { installedImmutable: true },
    );
    if (previousRelease.release.releaseId !== releaseName
        || previousRelease.release.testedSha !== releaseName.slice('i00-'.length)) {
      fail('previous release target identity is contradictory');
    }
    previous = { link: env.PREVIOUS_LINK, state: 'PRESENT', target: previousLink.target };
    previousIdentity = {
      link: previousLink,
      target: statIdentity(previousStat),
      artifactManifestSha256: previousRelease.artifactManifestSha256,
    };
  }

  return {
    current: {
      link: env.CURRENT_LINK,
      target: currentLink.target,
      releaseId: verified.release.releaseId,
    },
    previous,
    identity: {
      currentLink,
      currentTarget: statIdentity(currentStat),
      deployedArtifactManifestSha256: deployed.artifactManifestSha256,
      previous: previousIdentity,
    },
  };
}

function unlinkOwnedOutput(output, createdIdentity) {
  if (!createdIdentity) return;
  try {
    const stat = lstatSync(output, { bigint: true });
    if (!stat.isSymbolicLink() && stat.isFile()
        && stat.dev.toString() === createdIdentity.device
        && stat.ino.toString() === createdIdentity.inode) {
      unlinkSync(output);
    }
  } catch {}
}

function exactCreate(output, bytes, parentBefore) {
  let fd;
  let createdIdentity;
  try {
    fd = openSync(
      output,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    createdIdentity = statIdentity(fstatSync(fd, { bigint: true }));
    fchmodSync(fd, 0o600);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
    unlinkOwnedOutput(output, createdIdentity);
    fail(`release-switch receipt exact-create failed: ${error.message}`);
  }
  const parentStat = lstatSync(parentBefore.parent, { bigint: true });
  const parentAfter = {
    device: parentStat.dev.toString(),
    inode: parentStat.ino.toString(),
    mode: parentStat.mode.toString(8),
    mtimeNs: parentStat.mtimeNs.toString(),
    ctimeNs: parentStat.ctimeNs.toString(),
  };
  if (parentAfter.device !== parentBefore.identity.device
      || parentAfter.inode !== parentBefore.identity.inode
      || parentAfter.mode !== parentBefore.identity.mode) {
    unlinkOwnedOutput(output, createdIdentity);
    fail('--output parent identity changed during receipt creation');
  }
  const outputStat = lstatSync(output, { bigint: true });
  if (!outputStat.isFile() || outputStat.isSymbolicLink()
      || (outputStat.mode & 0o777n) !== 0o600n || realpathSync(output) !== output
      || outputStat.dev.toString() !== createdIdentity.device
      || outputStat.ino.toString() !== createdIdentity.inode) {
    unlinkOwnedOutput(output, createdIdentity);
    fail('release-switch receipt is not one canonical mode-0600 file');
  }
}

const args = parseCli(process.argv.slice(2));
if (args['check-only']) {
  requireOnly(args, new Set(['check-only', 'output']));
  if (!args.output) fail('--output is required with --check-only');
  preflightOutput(args.output);
  process.stdout.write('RELEASE_SWITCH_RECEIPT_TARGET_READY\n');
  process.exit(0);
}

requireOnly(args, new Set([
  'output', 'release', 'env', 'authorization-sha256', 'artifact-manifest-sha256',
  'recovery-target', 'first-host-evidence-sha256', 'systemctl', 'curl',
  'donor-exit-code', 'started-at-utc', 'simulation-clock', 'now',
]));
for (const key of [
  'output', 'release', 'env', 'authorization-sha256', 'artifact-manifest-sha256',
  'systemctl', 'curl', 'donor-exit-code', 'started-at-utc',
]) if (!args[key]) fail(`--${key} is required`);
if (args['donor-exit-code'] !== '0') fail('--donor-exit-code must be exactly 0');
if (!SHA256_RE.test(args['authorization-sha256'])) fail('--authorization-sha256 must be lowercase SHA-256');
if (!SHA256_RE.test(args['artifact-manifest-sha256'])) fail('--artifact-manifest-sha256 must be lowercase SHA-256');
const firstHost = args['recovery-target'] !== undefined;
if (firstHost) {
  if (args['recovery-target'] !== FIRST_HOST_TARGET) fail(`--recovery-target must be ${FIRST_HOST_TARGET}`);
  if (!SHA256_RE.test(args['first-host-evidence-sha256'] ?? '')) {
    fail('--first-host-evidence-sha256 is required for first-host receipts');
  }
} else if (args['first-host-evidence-sha256'] !== undefined) {
  fail('--first-host-evidence-sha256 requires the exact first-host recovery target');
}

const output = preflightOutput(args.output);
const release = canonicalAbsolute(args.release, '--release');
safeAncestors(release, '--release');
const verified = verifyArtifactManifest(release);
const testedSha = verified.release.testedSha;
if (!FULL_SHA_RE.test(testedSha) || verified.release.releaseId !== `i00-${testedSha}`) {
  fail('release identity is invalid');
}
if (verified.artifactManifestSha256 !== args['artifact-manifest-sha256']
    || sha256File(resolve(release, 'artifact-manifest.json')) !== args['artifact-manifest-sha256']) {
  fail('artifact manifest differs from the authorized release');
}
const env = parseSanitizedEnv(args.env);
if (env.APP_UNIT !== 'cosmos-app.service'
    || env.HEALTH_BASE !== 'http://127.0.0.1:8080'
    || env.POST_SWITCH_GATE_PATHS !== '/health/live /health/ready') {
  fail('Gate-5 service or post-switch health contract is not exact');
}
const stateBeforeReadback = captureSwitchState(
  env, verified, args['artifact-manifest-sha256'], firstHost,
);
requireSystemctl(args.systemctl, env.APP_UNIT);
requireHealth(args.curl, env.HEALTH_BASE, env.POST_SWITCH_GATE_PATHS.split(' '));
const stateAfterReadback = captureSwitchState(
  env, verified, args['artifact-manifest-sha256'], firstHost,
);
if (JSON.stringify(stateAfterReadback.identity) !== JSON.stringify(stateBeforeReadback.identity)) {
  fail('release link or deployed artifact identity changed during Gate-5 readback');
}
const startedAtUtc = canonicalUtc(args['started-at-utc'], '--started-at-utc');
const completedAtUtc = completedAt(args);
if (Date.parse(completedAtUtc) < Date.parse(startedAtUtc)) fail('release switch completed before it started');

const receipt = {
  schemaVersion: 1,
  kind: 'RELEASE_SWITCH',
  releaseId: verified.release.releaseId,
  testedSha,
  deployedSha: testedSha,
  artifactManifestSha256: args['artifact-manifest-sha256'],
  authorizationSha256: args['authorization-sha256'],
  recoveryTarget: firstHost ? FIRST_HOST_TARGET : null,
  firstHostEvidenceSha256: firstHost ? args['first-host-evidence-sha256'] : null,
  current: stateAfterReadback.current,
  previous: stateAfterReadback.previous,
  service: { unit: env.APP_UNIT, state: 'ACTIVE' },
  postSwitchGate: {
    base: env.HEALTH_BASE,
    paths: env.POST_SWITCH_GATE_PATHS.split(' '),
    status: 'PASS',
  },
  donorExitCode: Number(args['donor-exit-code']),
  status: 'RELEASE_SWITCH_PROVED',
  startedAtUtc,
  completedAtUtc,
  recordedAtUtc: completedAtUtc,
};
requireExactKeys(receipt, [
  'schemaVersion', 'kind', 'releaseId', 'testedSha', 'deployedSha',
  'artifactManifestSha256', 'authorizationSha256', 'recoveryTarget',
  'firstHostEvidenceSha256', 'current', 'previous', 'service', 'postSwitchGate',
  'donorExitCode', 'status', 'startedAtUtc', 'completedAtUtc', 'recordedAtUtc',
], 'release-switch receipt');
exactCreate(output.output, `${JSON.stringify(receipt, null, 2)}\n`, output);
process.stdout.write(`${JSON.stringify({ status: 'RELEASE_SWITCH_RECEIPT_RECORDED', output: output.output })}\n`);

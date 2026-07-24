#!/usr/bin/env node
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync,
  readFileSync, realpathSync, writeFileSync,
} from 'node:fs';
import {
  basename, dirname, isAbsolute, resolve,
} from 'node:path';
import { fail, parseArgs } from '../lib.mjs';
import { isWithinSimulationRoot, validateSimulationRoot, verifySimulationCommand } from '../simulation-safety.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.env || !args.root || !args.output) fail('--env, --root, and --output are required');
let root;
try { root = validateSimulationRoot(args.root); } catch (error) { fail(error.message); }
const requireDirectChild = (raw, label) => {
  if (typeof raw !== 'string' || !isAbsolute(raw) || resolve(raw) !== raw
      || dirname(raw) !== root || basename(raw).length === 0) {
    fail(`${label} must be one exact raw canonical direct child of the marked simulation root`);
  }
  return raw;
};
const envPath = requireDirectChild(args.env, '--env');
const outputPath = requireDirectChild(args.output, '--output');
const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
const namedRoot = lstatSync(root, { bigint: true });
let rootFd;
let envFd;
let rootIdentity;
let envIdentity;
let envText;
try {
  rootFd = openSync(
    root,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
  rootIdentity = fstatSync(rootFd, { bigint: true });
  if (!rootIdentity.isDirectory() || namedRoot.isSymbolicLink()
      || rootIdentity.dev !== namedRoot.dev || rootIdentity.ino !== namedRoot.ino) {
    fail('marked simulation root identity changed before environment reading');
  }
  const envNamed = lstatSync(envPath, { bigint: true, throwIfNoEntry: false });
  if (!envNamed?.isFile() || envNamed.isSymbolicLink() || envNamed.nlink !== 1n
      || (envNamed.mode & 0o077n) !== 0n
      || (invokingUid !== null && envNamed.uid !== invokingUid)
      || realpathSync(envPath) !== envPath) {
    fail('--env must be one exact private physical direct-child file');
  }
  const anchoredEnv = process.platform === 'linux'
    ? `/proc/self/fd/${rootFd}/${basename(envPath)}`
    : envPath;
  envFd = openSync(
    anchoredEnv,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  envIdentity = fstatSync(envFd, { bigint: true });
  if (envIdentity.dev !== envNamed.dev || envIdentity.ino !== envNamed.ino) {
    fail('--env identity changed before reading');
  }
  envText = readFileSync(envFd, 'utf8');
  const envAfter = fstatSync(envFd, { bigint: true });
  const namedAfter = lstatSync(envPath, { bigint: true });
  if (envAfter.dev !== envIdentity.dev || envAfter.ino !== envIdentity.ino
      || envAfter.size !== envIdentity.size || envAfter.mtimeNs !== envIdentity.mtimeNs
      || namedAfter.dev !== envIdentity.dev || namedAfter.ino !== envIdentity.ino) {
    fail('--env identity changed while reading');
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const values = {};
for (const [index, raw] of envText.split(/\r?\n/).entries()) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (!match) fail(`simulation env syntax is invalid at line ${index + 1}`);
  if (match[1] in values) fail(`duplicate simulation env key ${match[1]}`);
  if (/['\0\r\n]/.test(match[2])) fail(`simulation env value ${match[1]} contains forbidden shell input`);
  values[match[1]] = match[2];
}
const allowed = new Set([
  'COSMOS_ROOT', 'RELEASES_DIR', 'CURRENT_LINK', 'PREVIOUS_LINK', 'DATA_DIR', 'OPS_STATE_DIR',
  'APP_UNIT', 'TUNNEL_UNIT', 'HEALTH_BASE', 'PROBE_BASE', 'PROBE_ENABLED', 'PROBE_PORT',
  'READINESS_GATE_PATHS', 'POST_SWITCH_GATE_PATHS', 'GATE_TIMEOUT_SEC', 'HTTP_TIMEOUT_SEC',
  'LOCK_TIMEOUT_SEC', 'DEPLOY_LOCK', 'DEPLOY_LOG', 'FROZEN_MARKER', 'MONEY_READY_MARKER',
  'EXPOSURE_CMD', 'I00_OPS_READBACK_URL', 'I00_OPS_READBACK_TIMEOUT_MS', 'ALERT_CMD',
]);
for (const key of Object.keys(values)) {
  if (!allowed.has(key)) fail(`simulation env key ${key} is not in the closed donor allowlist`);
}
for (const forbidden of ['SYSTEMCTL', 'CURL', 'NODE', 'SQLITE', 'PROBE_CMD', 'TMPDIR', 'PATH', 'HOME']) {
  if (forbidden in values) fail(`simulation env may not override injected command ${forbidden}`);
}
for (const key of ['COSMOS_ROOT', 'RELEASES_DIR', 'CURRENT_LINK', 'PREVIOUS_LINK', 'DATA_DIR', 'OPS_STATE_DIR']) {
  let safe = false;
  try { safe = values[key] && isAbsolute(values[key]) && isWithinSimulationRoot(root, values[key]); } catch { safe = false; }
  if (!safe) fail(`${key} must be an absolute path below the marked simulation root`);
}
for (const key of ['HEALTH_BASE', 'PROBE_BASE']) {
  if (values[key] && !/^http:\/\/127\.0\.0\.1:\d+$/.test(values[key])) fail(`${key} must be loopback-only in simulation`);
}
if (values.I00_OPS_READBACK_TIMEOUT_MS !== undefined
    && values.I00_OPS_READBACK_TIMEOUT_MS !== '750') {
  fail('I00_OPS_READBACK_TIMEOUT_MS must equal the fixed simulation timeout');
}
if (values.I00_OPS_READBACK_URL !== undefined
    && values.I00_OPS_READBACK_URL
      !== `${values.HEALTH_BASE}/api/system-integration/ops/readback`) {
  fail('I00_OPS_READBACK_URL must match the loopback simulation app origin');
}
for (const key of ['EXPOSURE_CMD', 'ALERT_CMD']) {
  if (!values[key]) continue;
  let safe = false;
  try { safe = isAbsolute(values[key]) && isWithinSimulationRoot(root, values[key]); } catch { safe = false; }
  if (!safe) fail(`${key} must be below the marked simulation root`);
  try { verifySimulationCommand(root, values[key]); } catch (error) { fail(`${key} is not a sealed inert fixture: ${error.message}`); }
}
const sanitized = Object.entries(values).map(([key, value]) => `${key}='${value}'`).join('\n');
try {
  const outputBefore = lstatSync(outputPath, { bigint: true, throwIfNoEntry: false });
  if (outputBefore !== undefined) fail('--output must be absent before exact creation');
  const openedRoot = fstatSync(rootFd, { bigint: true });
  const finalNamedRoot = lstatSync(root, { bigint: true });
  if (openedRoot.dev !== rootIdentity.dev || openedRoot.ino !== rootIdentity.ino
      || finalNamedRoot.isSymbolicLink()
      || finalNamedRoot.dev !== rootIdentity.dev || finalNamedRoot.ino !== rootIdentity.ino
      || realpathSync(root) !== root) {
    fail('marked simulation root identity changed before sanitized output publication');
  }
  const anchoredOutput = process.platform === 'linux'
    ? `/proc/self/fd/${rootFd}/${basename(outputPath)}`
    : outputPath;
  writeFileSync(anchoredOutput, `${sanitized}\n`, { mode: 0o600, flag: 'wx' });
  fsyncSync(rootFd);
  const published = lstatSync(outputPath, { bigint: true });
  const durableRoot = lstatSync(root, { bigint: true });
  if (!published.isFile() || published.isSymbolicLink() || published.nlink !== 1n
      || (published.mode & 0o777n) !== 0o600n
      || (invokingUid !== null && published.uid !== invokingUid)
      || durableRoot.dev !== rootIdentity.dev || durableRoot.ino !== rootIdentity.ino) {
    fail('sanitized simulation environment publication identity is invalid');
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  if (envFd !== undefined) closeSync(envFd);
  if (rootFd !== undefined) closeSync(rootFd);
}
process.stdout.write(`${outputPath}\n`);

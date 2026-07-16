#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fail, parseArgs } from '../lib.mjs';
import { isWithinSimulationRoot, validateSimulationRoot, verifySimulationCommand } from '../simulation-safety.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.env || !args.root || !args.output) fail('--env, --root, and --output are required');
let root;
try { root = validateSimulationRoot(args.root); } catch (error) { fail(error.message); }
const values = {};
for (const [index, raw] of readFileSync(resolve(args.env), 'utf8').split(/\r?\n/).entries()) {
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
  'EXPOSURE_CMD', 'ALERT_CMD',
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
for (const key of ['EXPOSURE_CMD', 'ALERT_CMD']) {
  if (!values[key]) continue;
  let safe = false;
  try { safe = isAbsolute(values[key]) && isWithinSimulationRoot(root, values[key]); } catch { safe = false; }
  if (!safe) fail(`${key} must be below the marked simulation root`);
  try { verifySimulationCommand(root, values[key]); } catch (error) { fail(`${key} is not a sealed inert fixture: ${error.message}`); }
}
let outputSafe = false;
try { outputSafe = isWithinSimulationRoot(root, args.output); } catch { outputSafe = false; }
if (!outputSafe) fail('--output must be below the marked simulation root');
const sanitized = Object.entries(values).map(([key, value]) => `${key}='${value}'`).join('\n');
writeFileSync(resolve(args.output), `${sanitized}\n`, { mode: 0o600, flag: 'wx' });
process.stdout.write(`${resolve(args.output)}\n`);

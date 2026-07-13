#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fail, parseArgs } from '../lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.env || !args.output || !args.profile) fail('--env, --output, and --profile are required');

const profiles = {
  deploy: new Set([
    'COSMOS_ROOT', 'RELEASES_DIR', 'CURRENT_LINK', 'PREVIOUS_LINK', 'DATA_DIR', 'OPS_STATE_DIR',
    'APP_UNIT', 'TUNNEL_UNIT', 'HEALTH_BASE', 'PROBE_BASE', 'PROBE_ENABLED', 'PROBE_PORT',
    'READINESS_GATE_PATHS', 'POST_SWITCH_GATE_PATHS', 'GATE_TIMEOUT_SEC', 'HTTP_TIMEOUT_SEC',
    'LOCK_TIMEOUT_SEC', 'DEPLOY_LOCK', 'DEPLOY_LOG', 'FROZEN_MARKER', 'MONEY_READY_MARKER',
    'EXPOSURE_CMD', 'ALERT_CMD',
  ]),
  backup: new Set([
    'DATA_DIR', 'OPS_STATE_DIR', 'APP_UNIT', 'BACKUP_DIR', 'BACKUP_RETENTION_COUNT',
    'BACKUP_MAX_AGE_HOURS', 'EVIDENCE_PATHS', 'EVIDENCE_MISSING_POLICY', 'BACKUP_LOCK',
    'NODE', 'SQLITE', 'SYSTEMCTL', 'HTTP_TIMEOUT_SEC', 'LOCK_TIMEOUT_SEC',
  ]),
};
const allowed = profiles[args.profile];
if (!allowed) fail('--profile must be deploy or backup');

const values = {};
for (const [index, rawLine] of readFileSync(resolve(args.env), 'utf8').split(/\r?\n/).entries()) {
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
const output = resolve(args.output);
if (existsSync(output)) fail('sanitized donor env output already exists');
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
writeFileSync(output, `${Object.entries(values).map(([key, value]) => `${key}='${value}'`).join('\n')}\n`, { mode: 0o600, flag: 'wx' });
process.stdout.write(`${output}\n`);

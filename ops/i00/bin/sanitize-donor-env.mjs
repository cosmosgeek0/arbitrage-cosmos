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
    'EXPOSURE_CMD', 'I00_OPS_READBACK_URL', 'ALERT_CMD',
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

if (args.profile === 'deploy') {
  const canonicalGatePaths = '/health/live /health/ready';
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

  if (values.OPS_STATE_DIR === '/'
      || !values.OPS_STATE_DIR.startsWith('/')
      || resolve(values.OPS_STATE_DIR) !== values.OPS_STATE_DIR) {
    fail('donor env OPS_STATE_DIR must be one canonical absolute directory');
  }
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
  lockEffectiveValue('FROZEN_MARKER', `${values.OPS_STATE_DIR}/deploy-frozen.json`, 'must remain inside the canonical ops-state directory');
  lockEffectiveValue('MONEY_READY_MARKER', `${values.OPS_STATE_DIR}/money-ready`, 'must remain inside the canonical ops-state directory');
  const exposureCommand = '/usr/bin/node /usr/local/lib/cosmos-ops/i00/bin/exposure-from-app.mjs';
  if (Object.hasOwn(values, 'EXPOSURE_CMD') && values.EXPOSURE_CMD !== '' && values.EXPOSURE_CMD !== exposureCommand) {
    fail(`donor env EXPOSURE_CMD must use the installed bounded readback client; expected ${exposureCommand}`);
  }
  values.EXPOSURE_CMD = exposureCommand;
  lockEffectiveValue(
    'I00_OPS_READBACK_URL',
    `${health.canonical}/api/system-integration/ops/readback`,
    'must match the authenticated numeric-loopback app origin',
  );
}

const output = resolve(args.output);
if (existsSync(output)) fail('sanitized donor env output already exists');
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
writeFileSync(output, `${Object.entries(values).map(([key, value]) => `${key}='${value}'`).join('\n')}\n`, { mode: 0o600, flag: 'wx' });
process.stdout.write(`${output}\n`);

#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SAFE_PATH = `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;

const DEFINITIONS = Object.freeze({
  backup: {
    required: ['config', 'simulation-root', 'donor-root'],
    optional: [],
    booleans: ['plan'],
    pathFields: ['config', 'simulation-root', 'donor-root'],
    build: (values) => ({
      executable: '/bin/bash',
      args: [
        resolve(REPO_ROOT, 'ops/i00/bin/backup-verify.sh'),
        '--env-file', values.config,
        '--simulation-root', values['simulation-root'],
        '--simulation',
      ],
      env: { DONOR_ROOT: values['donor-root'] },
      safetyClass: 'LOCAL_SIMULATION_BACKUP_ONLY',
    }),
  },
  'restore-test': {
    required: ['backup', 'target', 'config', 'simulation-root', 'donor-root'],
    optional: [],
    booleans: ['plan'],
    pathFields: ['backup', 'target', 'config', 'simulation-root', 'donor-root'],
    build: (values) => ({
      executable: '/bin/bash',
      args: [
        resolve(REPO_ROOT, 'ops/i00/bin/restore-drill-verify.sh'),
        '--backup', values.backup,
        '--target', values.target,
        '--env-file', values.config,
        '--simulation-root', values['simulation-root'],
        '--simulation',
      ],
      env: { DONOR_ROOT: values['donor-root'] },
      safetyClass: 'ISOLATED_LOCAL_SIMULATION_RESTORE_ONLY',
    }),
  },
  'release-preflight': {
    required: ['release'],
    optional: ['trusted-build-public-key'],
    booleans: ['allow-simulation', 'plan'],
    pathFields: ['release', 'trusted-build-public-key'],
    build: (values) => ({
      executable: process.execPath,
      args: [
        resolve(REPO_ROOT, 'ops/i00/bin/validate-release.mjs'),
        '--release', values.release,
        ...(values['trusted-build-public-key']
          ? ['--trusted-build-public-key', values['trusted-build-public-key']]
          : []),
        ...(values['allow-simulation'] ? ['--allow-simulation'] : []),
      ],
      env: {},
      safetyClass: 'RELEASE_VALIDATION_NO_MUTATION',
    }),
  },
  'deploy-preflight': preflightDefinition('deploy'),
  'rollback-preflight': preflightDefinition('rollback'),
});

function preflightDefinition(mode) {
  const required = [
    'release', 'host', 'supervisor', 'now', 'max-host-age-sec',
    'max-supervisor-age-sec', 'required-supervisor-window-sec',
  ];
  return {
    required,
    optional: [],
    booleans: ['plan'],
    pathFields: ['release', 'host', 'supervisor'],
    build: (values) => ({
      executable: process.execPath,
      args: [
        resolve(REPO_ROOT, 'ops/i00/bin/preflight.mjs'),
        '--release', values.release,
        '--host', values.host,
        '--supervisor', values.supervisor,
        '--mode', mode,
        '--now', values.now,
        '--max-host-age-sec', values['max-host-age-sec'],
        '--max-supervisor-age-sec', values['max-supervisor-age-sec'],
        '--required-supervisor-window-sec', values['required-supervisor-window-sec'],
      ],
      env: {},
      safetyClass: `${mode.toUpperCase()}_PREFLIGHT_NO_MUTATION`,
    }),
  };
}

function writeResult(result, stream = process.stdout) {
  stream.write(`${JSON.stringify({
    schemaVersion: 'i00.command-status.v1',
    ...result,
    mutationPerformed: false,
  })}\n`);
}

function invocationFailure(operation, reasonCode, detail, exitCode) {
  writeResult({
    status: exitCode === 2 ? 'NOT_CONFIGURED' : 'BLOCKED',
    operation: operation ?? 'UNSPECIFIED',
    reasonCode,
    detail,
  }, exitCode === 2 ? process.stdout : process.stderr);
  process.exitCode = exitCode;
}

function parseFlags(tokens, definition) {
  const values = {};
  const allowedValues = new Set([...definition.required, ...definition.optional]);
  const allowedBooleans = new Set(definition.booleans);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new Error('UNEXPECTED_POSITIONAL_ARGUMENT');
    const key = token.slice(2);
    if (Object.hasOwn(values, key)) throw new Error('DUPLICATE_ARGUMENT');
    if (allowedBooleans.has(key)) {
      values[key] = true;
      continue;
    }
    if (!allowedValues.has(key)) throw new Error('UNSUPPORTED_ARGUMENT');
    const value = tokens[index + 1];
    if (!value || value.startsWith('--')) throw new Error('ARGUMENT_VALUE_REQUIRED');
    values[key] = value;
    index += 1;
  }
  return values;
}

function validateValues(operation, definition, values) {
  const missing = definition.required.filter((key) => !values[key]);
  if (missing.length > 0) {
    invocationFailure(operation, 'EXPLICIT_SAFE_INPUTS_REQUIRED', `missing ${missing.map((key) => `--${key}`).join(', ')}`, 2);
    return false;
  }
  for (const field of definition.pathFields) {
    if (values[field] && !isAbsolute(values[field])) {
      invocationFailure(operation, 'ABSOLUTE_PATH_REQUIRED', `--${field} must be absolute`, 1);
      return false;
    }
  }
  if (operation === 'release-preflight') {
    const simulation = values['allow-simulation'] === true;
    const trusted = Boolean(values['trusted-build-public-key']);
    if (simulation === trusted) {
      invocationFailure(
        operation,
        simulation ? 'AMBIGUOUS_RELEASE_TRUST_MODE' : 'RELEASE_TRUST_INPUT_REQUIRED',
        simulation
          ? 'choose exactly one of --allow-simulation or --trusted-build-public-key'
          : 'provide --trusted-build-public-key or explicitly select --allow-simulation',
        simulation ? 1 : 2,
      );
      return false;
    }
  }
  return true;
}

async function run(action) {
  const childEnv = {
    PATH: SAFE_PATH,
    HOME: '/',
    TMPDIR: '/tmp',
    LANG: 'C',
    LC_ALL: 'C',
    ...action.env,
  };
  const child = spawn(action.executable, action.args, {
    cwd: REPO_ROOT,
    env: childEnv,
    shell: false,
    stdio: 'inherit',
  });
  return await new Promise((resolvePromise) => {
    let settled = false;
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      invocationFailure('child-process', 'COMMAND_START_FAILED', error.message, 1);
      resolvePromise(1);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      if (signal !== null) {
        invocationFailure('child-process', 'COMMAND_SIGNALLED', signal, 1);
        resolvePromise(1);
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
}

const [operation, ...tokens] = process.argv.slice(2);
const definition = DEFINITIONS[operation];
if (!definition) {
  invocationFailure(operation, 'UNSUPPORTED_OPERATION', 'expected backup, restore-test, release-preflight, deploy-preflight, or rollback-preflight', 1);
} else {
  let values;
  try {
    values = parseFlags(tokens, definition);
  } catch (error) {
    invocationFailure(operation, 'INVALID_ARGUMENTS', error.message, 1);
  }
  if (values && validateValues(operation, definition, values)) {
    const action = definition.build(values);
    if (values.plan) {
      writeResult({
        status: 'PLAN_VALID_NO_EXECUTION',
        operation,
        safetyClass: action.safetyClass,
        executable: action.executable,
        arguments: action.args,
        childEnvironmentKeys: Object.keys({ PATH: '', HOME: '', TMPDIR: '', LANG: '', LC_ALL: '', ...action.env }).sort(),
      });
    } else {
      process.exitCode = await run(action);
    }
  }
}

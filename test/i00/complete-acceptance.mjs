#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  prependUvToPath,
  validateUvExecutableInput,
} from './performance/local-acceptance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DELEGATE = resolve(ROOT, 'test/i00/performance/local-acceptance.mjs');
const MODES = new Set(['--plan', '--run', '--validate-only']);
const supplied = process.argv.slice(2);
const selectedModes = supplied.filter((argument) => MODES.has(argument));
const SEALED_ENVIRONMENT = Object.freeze({
  PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: '/',
  TMPDIR: realpathSync('/tmp'),
  TZ: 'UTC',
  LC_ALL: 'C',
  CI: '1',
  // uv derives its cache from HOME when this is unset, and HOME is '/' above. On a host whose
  // root filesystem is read-only (macOS SIP), `/.cache/uv` cannot be created, so uv aborts:
  //   "Failed to initialize cache at `/.cache/uv` ... Read-only file system (os error 30)".
  // That failed uv-lock-check and uv-all-extras-synchronized, which failed test:quant:built, which
  // failed test:gate-coverage:built, which exited the whole repository_test_all step non-zero while
  // every counted suite reported green — an exit code with no failing test behind it.
  // Pinning the cache under the already-sealed temp root keeps the environment deterministic and
  // isolated (fresh temp root per run) while giving uv somewhere it is permitted to write.
  // This weakens no assertion: it supplies a writable path, it does not relax a check.
  UV_CACHE_DIR: `${realpathSync('/tmp')}/cosmos-acceptance-uv-cache`,
});

function explicitOptionValue(argv, option) {
  const flag = `--${option}`;
  let value = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === flag) {
      const next = argv[index + 1];
      value = typeof next === 'string' && !next.startsWith('--') ? next : null;
      if (value !== null) index += 1;
    } else if (argument.startsWith(`${flag}=`)) {
      value = argument.slice(flag.length + 1);
    }
  }
  return value;
}

function startDelegate(delegated, environment) {
  const child = spawn(process.execPath, [DELEGATE, ...delegated], {
    cwd: ROOT,
    env: environment,
    shell: false,
    stdio: 'inherit',
  });

  let settled = false;
  child.once('error', () => {
    if (settled) return;
    settled = true;
    process.stderr.write('I00_COMPLETE_ENTRY_FAILED:DELEGATE_START_FAILED\n');
    process.exitCode = 1;
  });
  child.once('close', (code, signal) => {
    if (settled) return;
    settled = true;
    if (signal !== null) {
      process.stderr.write(`I00_COMPLETE_ENTRY_FAILED:DELEGATE_SIGNALLED:${signal}\n`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 1;
  });
}

if (selectedModes.length > 1) {
  process.stderr.write('I00_COMPLETE_ENTRY_FAILED:EXACTLY_ONE_MODE_REQUIRED\n');
  process.exitCode = 1;
} else {
  const delegated = selectedModes.length === 0 ? ['--plan', ...supplied] : supplied;
  try {
    let environment = SEALED_ENVIRONMENT;
    if (selectedModes.includes('--run')) {
      const uv = validateUvExecutableInput(explicitOptionValue(supplied, 'uv'));
      environment = prependUvToPath(SEALED_ENVIRONMENT, uv.executablePath);
    }
    startDelegate(delegated, environment);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'UV_INPUT_INVALID';
    process.stderr.write(`I00_COMPLETE_ENTRY_FAILED:${reason}\n`);
    process.exitCode = 1;
  }
}

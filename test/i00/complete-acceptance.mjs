#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DELEGATE = resolve(ROOT, 'test/i00/performance/local-acceptance.mjs');
const MODES = new Set(['--plan', '--run', '--validate-only']);
const supplied = process.argv.slice(2);
const selectedModes = supplied.filter((argument) => MODES.has(argument));

if (selectedModes.length > 1) {
  process.stderr.write('I00_COMPLETE_ENTRY_FAILED:EXACTLY_ONE_MODE_REQUIRED\n');
  process.exitCode = 1;
} else {
  const delegated = selectedModes.length === 0 ? ['--plan', ...supplied] : supplied;
  const child = spawn(process.execPath, [DELEGATE, ...delegated], {
    cwd: ROOT,
    env: {
      PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: '/',
      TMPDIR: '/tmp',
      TZ: 'UTC',
      LC_ALL: 'C',
      CI: '1',
    },
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

#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { spawnRunnerChild, superviseRunnerChild } from './runner-process-tree.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const suites = [
  'test:deterministic:built',
  'test:app:built',
  'test:intelligence:built',
  'test:intelligence:runtime:built',
  'test:capital:built',
  'test:foundation:built',
  'test:integration:built',
  'test:protocol:built',
  'test:product-integration:built',
  'test:product-control:built',
  'test:i00:proof:built',
  'test:i00:commands',
  'test:live-edge:built',
  'test:gate-coverage:built',
];

function runSuite(script) {
  return new Promise((resolve) => {
    process.stdout.write(`\nCanonical test:all suite: ${script}\n`);
    const child = spawnRunnerChild(npm, ['run', script], {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
    });
    let spawnError = null;
    const timeoutMs = script === 'test:gate-coverage:built'
      ? 3_000_000
      : script === 'test:deterministic:built'
        ? 2_000_000
        : 1_200_000;
    const deadline = superviseRunnerChild(child, timeoutMs);
    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('close', (code, signal) => {
      deadline.finish();
      resolve({
        script,
        code,
        signal,
        spawnError,
        timedOut: deadline.timedOut,
        timeoutMs,
      });
    });
  });
}

const failures = [];
for (const script of suites) {
  const result = await runSuite(script);
  if (result.spawnError !== null) failures.push(`${script}:SPAWN_ERROR:${result.spawnError.message}`);
  if (result.timedOut) failures.push(`${script}:TIMEOUT_MS:${result.timeoutMs}`);
  if (result.code !== 0 || result.signal !== null) {
    failures.push(`${script}:EXIT_CODE=${String(result.code)}:SIGNAL=${String(result.signal)}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`\nCANONICAL_TEST_ALL_FAILURES count=${failures.length}\n`);
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('\nCANONICAL_TEST_ALL PASS\n');
}

#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { spawnRunnerChild, superviseRunnerChild } from './runner-process-tree.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const suites = [
  { script: 'test:ai-ops:built', timeoutMs: 700_000 },
  { script: 'test:quant:built', timeoutMs: 2_100_000 },
];

function runSuite({ script, timeoutMs }) {
  return new Promise((resolve) => {
    process.stdout.write(`\nCanonical gate-coverage suite: ${script}\n`);
    const child = spawnRunnerChild(npm, ['run', script], {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
    });
    let spawnError = null;
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
for (const suite of suites) {
  const result = await runSuite(suite);
  if (result.spawnError !== null) failures.push(`${result.script}:SPAWN_ERROR:${result.spawnError.message}`);
  if (result.timedOut) failures.push(`${result.script}:TIMEOUT_MS:${result.timeoutMs}`);
  if (result.code !== 0 || result.signal !== null) {
    failures.push(`${result.script}:EXIT_CODE=${String(result.code)}:SIGNAL=${String(result.signal)}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`\nCANONICAL_GATE_COVERAGE_FAILURES count=${failures.length}\n`);
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('\nCANONICAL_GATE_COVERAGE PASS\n');
}

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QUANT = path.join(ROOT, 'quant');

export const REGRESSION_STEPS = Object.freeze([
  Object.freeze({
    finding: 'FIX-031',
    command: process.execPath,
    args: Object.freeze([
      '--test',
      '--test-concurrency=1',
      'server/test/systemIntegration/persistence/data-dir-lease.process.test.mjs',
    ]),
    cwd: ROOT,
    env: Object.freeze({}),
  }),
  Object.freeze({
    finding: 'FIX-017',
    command: path.join(QUANT, '.venv', 'bin', 'python'),
    args: Object.freeze([
      '-m',
      'pytest',
      '-q',
      '--hypothesis-seed=20260712',
      'tests/q08/test_q08_basis_path.py',
    ]),
    cwd: QUANT,
    env: Object.freeze({ PYTHONHASHSEED: '0' }),
  }),
]);

export function runMergedRegressionAudit({ spawn = spawnSync, stdio = 'inherit' } = {}) {
  for (const step of REGRESSION_STEPS) {
    const result = spawn(step.command, [...step.args], {
      cwd: step.cwd,
      env: { ...process.env, ...step.env },
      stdio,
    });
    if (result.error || result.signal || result.status !== 0) {
      return {
        status: Number.isInteger(result.status) && result.status !== 0 ? result.status : 1,
        failedFinding: step.finding,
      };
    }
  }
  return { status: 0, failedFinding: null };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = runMergedRegressionAudit();
  if (result.failedFinding) {
    console.error(`FIX_005_MERGED_REGRESSION FAIL finding=${result.failedFinding}`);
  } else {
    console.log('FIX_005_MERGED_REGRESSION PASS findings=2');
  }
  process.exitCode = result.status;
}

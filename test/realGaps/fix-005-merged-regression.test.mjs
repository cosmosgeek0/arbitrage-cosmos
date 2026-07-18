import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  REGRESSION_STEPS,
  runMergedRegressionAudit,
} from './run-fix-005-merged-regression.mjs';

test('FIX-005 audit mounts both residual finding regressions in ranked order', () => {
  assert.deepEqual(
    REGRESSION_STEPS.map(({ finding }) => finding),
    ['FIX-031', 'FIX-017'],
  );
});

test('FIX-005 audit preserves the first failing child exit and stops', () => {
  const calls = [];
  const statuses = [0, 17];
  const result = runMergedRegressionAudit({
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: statuses.shift(), signal: null, error: undefined };
    },
  });

  assert.equal(result.status, 17);
  assert.equal(result.failedFinding, 'FIX-017');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.env.PYTHONHASHSEED, '0');
});

test('FIX-005 audit reports exact success only after both children pass', () => {
  const result = runMergedRegressionAudit({
    spawn() {
      return { status: 0, signal: null, error: undefined };
    },
  });

  assert.deepEqual(result, { status: 0, failedFinding: null });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');

test('every graceful-shutdown outcome maps to an explicit process exit status', () => {
  // SHUTDOWN_REFUSED must not absorb the signal: a silently surviving process
  // turns the orchestrator's SIGTERM into an untrappable SIGKILL after the
  // grace period, which skips the lease release and the clean-stop record.
  assert.match(source, /const SHUTDOWN_REFUSED_EXIT_CODE = 75;/);

  const refusedExits = source.split('process.exit(SHUTDOWN_REFUSED_EXIT_CODE)').length - 1;
  assert.equal(
    refusedExits,
    2,
    'both the signal handler and the listener-failure handler must exit on a refused shutdown',
  );

  assert.match(source, /if \(outcome === 'SHUTDOWN_COMPLETE'\) process\.exit\(0\);/);
  assert.match(source, /if \(outcome === 'SHUTDOWN_FAILED'\) process\.exit\(1\);/);

  // The prior defect: the listener-failure refusal branch logged and returned,
  // leaving a lease-holding process with no listener bound (EADDRINUSE
  // restart deadlock). A bare return after the refusal log must not come back.
  assert.doesNotMatch(
    source,
    /listener failure shutdown refused; recovery supervision remains active'\);\s*\n\s*return;/,
  );
});

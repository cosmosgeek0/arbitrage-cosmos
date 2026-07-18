import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createDelayedResetOwner } from '../../src/lib/polling.ts';

const headerUrl = new URL('../../src/components/Header.tsx', import.meta.url);

test('RefreshDock health and observation polling is one bounded abortable generation', async () => {
  const source = await readFile(headerUrl, 'utf8');
  const dockStart = source.indexOf('export function RefreshDock()');
  const dockEnd = source.indexOf('export function Topbar()', dockStart);
  const dock = source.slice(dockStart, dockEnd);
  const probeStart = dock.indexOf('const runHealthProbe = useCallback');
  const pollStart = dock.indexOf('const healthPoll = createSettledPoll<BrowserHealthProbe>');
  const pollEnd = dock.indexOf('useEffect(() => {\n    if (!open) return;', pollStart);

  assert.notEqual(dockStart, -1, 'RefreshDock is missing');
  assert.notEqual(dockEnd, -1, 'RefreshDock boundary is missing');
  assert.notEqual(probeStart, -1, 'RefreshDock must own one bounded health probe');
  assert.notEqual(pollStart, -1, 'RefreshDock must use the shared settled poll owner');
  assert.notEqual(pollEnd, -1, 'RefreshDock settled poll lifecycle is incomplete');

  const probe = dock.slice(probeStart, pollStart);
  const poll = dock.slice(pollStart, pollEnd);
  assert.match(probe, /fetchJson<unknown>\('\/health\/live',[\s\S]*signal[\s\S]*4_000\)/);
  assert.match(probe, /fetchJson<unknown>\('\/api\/connections\/browser-observation',[\s\S]*signal[\s\S]*3_000\)/);
  assert.match(probe, /observationReported:\s*false/);
  assert.match(probe, /apiErrorMessage\(error,\s*'Browser observation report failed'\)/);
  assert.doesNotMatch(probe, /\bfetch\(/);

  assert.match(poll, /intervalMs:\s*5_000/);
  assert.match(poll, /timeoutMs:\s*8_000/);
  assert.match(poll, /request:\s*runHealthProbe/);
  assert.match(poll, /healthPollRef\.current\s*=\s*healthPoll/);
  assert.match(poll, /healthPoll\.start\(\)/);
  assert.match(poll, /healthPoll\.stop\(\)/);
  assert.doesNotMatch(poll, /window\.setInterval/);
});

test('RefreshDock recovery is bounded and releases busy state unconditionally', async () => {
  const source = await readFile(headerUrl, 'utf8');
  const dockStart = source.indexOf('export function RefreshDock()');
  const dockEnd = source.indexOf('export function Topbar()', dockStart);
  const dock = source.slice(dockStart, dockEnd);
  const recoveryStart = dock.indexOf('const runTarget = async');
  const recoveryEnd = dock.indexOf('const overallLabel', recoveryStart);
  const recovery = dock.slice(recoveryStart, recoveryEnd);

  assert.notEqual(recoveryStart, -1, 'RefreshDock recovery handler is missing');
  assert.notEqual(recoveryEnd, -1, 'RefreshDock recovery handler is incomplete');
  assert.match(recovery, /fetchJson<\{[\s\S]*\}>\('\/api\/refresh',[\s\S]*8_000\)/);
  assert.match(recovery, /finally\s*\{[\s\S]*busy\.current\s*=\s*false;[\s\S]*setTargetBusy\(null\);[\s\S]*finish\(/);
  assert.match(recovery, /healthPollRef\.current\?\.refresh\(\)/);
  assert.match(recovery, /void binding\.refresh\(\)/);
  assert.doesNotMatch(recovery, /await Promise\.all|window\.setTimeout/);
  assert.match(recovery, /recoveryStatusReset\.cancel\(\);[\s\S]*setSt\('spin'\)/);
  assert.match(dock, /recoveryStatusReset\.schedule\([^;]+setSt\('idle'\)/);
  assert.match(dock, /useEffect\(\(\) => \(\) => recoveryStatusReset\.cancel\(\)/);
  assert.match(dock, /Last manual recovery attempt/);
  assert.match(dock, /No local recovery attempt/);
  assert.doesNotMatch(dock, /Last manual recovery \$\{timeAgo/);

  assert.match(dock, /healthProbeStatus[^=]*= useState<[^>]+>\('LOADING'\)/);
  assert.match(dock, /setHealthProbeStatus\('CURRENT'\)/);
  assert.match(dock, /setHealthProbeStatus\('UNAVAILABLE'\)/);
  assert.match(dock, /healthProbeStatus === 'LOADING'[\s\S]*browser observation unreported/);

  assert.match(dock, /productSnapshot\.canonicalCockpit\.watchmanOverall/);
  assert.match(dock, /canonicalWatchmanLauncherPresentation\(\{/);
  assert.doesNotMatch(dock, /st === 'ok' \? 'operational'/);
});

test('delayed recovery reset cannot overwrite a newer in-flight status', () => {
  let nextHandle = 0;
  const pending = new Map();
  const cancelled = [];
  const owner = createDelayedResetOwner({
    schedule(task, delayMs) {
      const handle = ++nextHandle;
      pending.set(handle, { task, delayMs });
      return handle;
    },
    cancel(handle) {
      cancelled.push(handle);
      pending.delete(handle);
    },
  });
  const states = [];

  owner.schedule(2_400, () => states.push('obsolete-idle'));
  assert.equal(owner.pending(), true);
  owner.cancel();
  states.push('new-spin');
  owner.schedule(1_500, () => states.push('current-idle'));

  assert.deepEqual(cancelled, [1]);
  assert.equal(pending.has(1), false);
  assert.equal(pending.get(2).delayMs, 1_500);
  assert.deepEqual(states, ['new-spin']);
  pending.get(2).task();
  assert.deepEqual(states, ['new-spin', 'current-idle']);
  assert.equal(owner.pending(), false);
});

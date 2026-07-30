import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { privateReadFreshness } from '../../src/lib/privateRead.ts';

test('Basis renders only canonically current runtime and exact account facts', async (context) => {
  const cssHooks = registerHooks({
    load(url, hookContext, nextLoad) {
      if (!url.endsWith('.css')) return nextLoad(url, hookContext);
      return { format: 'module', shortCircuit: true, source: '' };
    },
  });
  context.after(() => cssHooks.deregister());

  const { resolveBasisAccountTruth, resolveBasisRuntimeTruth } = await import('../../src/pages/Strategies.tsx');

  const currentRuntime = resolveBasisRuntimeTruth({
    canonicalState: 'READY',
    canonicalReason: null,
    snapshotStatus: { running: true, bookState: 'fresh', markState: 'fresh', lastError: null },
    requestError: null,
  });
  assert.deepEqual(currentRuntime, {
    current: true,
    state: 'LIVE',
    label: 'Live',
    reason: null,
  });

  for (const unavailable of [
    resolveBasisRuntimeTruth({
      canonicalState: 'UNAVAILABLE',
      canonicalReason: 'BASIS_ENGINE_BLOCKED',
      snapshotStatus: { running: true, bookState: 'fresh', markState: 'fresh', lastError: null },
      requestError: null,
    }),
    resolveBasisRuntimeTruth({
      canonicalState: 'READY',
      canonicalReason: null,
      snapshotStatus: { running: true, bookState: 'fresh', markState: 'fresh', lastError: null },
      requestError: 'Basis read failed',
    }),
    resolveBasisRuntimeTruth({
      canonicalState: 'READY',
      canonicalReason: null,
      snapshotStatus: { running: false, bookState: 'fresh', markState: 'fresh', lastError: null },
      requestError: null,
    }),
    resolveBasisRuntimeTruth({
      canonicalState: 'READY',
      canonicalReason: null,
      snapshotStatus: { running: true, bookState: 'stale', markState: 'fresh', lastError: null },
      requestError: null,
    }),
  ]) {
    assert.equal(unavailable.current, false);
    assert.equal(unavailable.state, 'UNAVAILABLE');
  }

  const currentAccountInput = {
    source: 'STATE',
    requestError: null,
    freshnessState: 'CURRENT',
    freshnessReason: 'Current account truth',
    spotState: 'AVAILABLE',
    spotFreshnessState: 'CURRENT',
    spotFreshnessReason: 'Current spot truth',
    spotCoverageState: 'COMPLETE_CURRENT',
    spotBalancesAvailable: true,
    spotAvailableUsdt: '0.00000000',
    marginState: 'AVAILABLE',
    marginFreshnessState: 'CURRENT',
    marginFreshnessReason: 'Current margin truth',
    marginCoverageState: 'COMPLETE_CURRENT',
    marginAssetsAvailable: true,
    liabilityReconciliationState: 'RECONCILED',
    liabilityFreshnessState: 'CURRENT',
    liabilityFreshnessReason: 'Current liability truth',
    marginLiabilityBtc: '0.00000000',
    liabilityCount: 0,
  };
  const currentZero = resolveBasisAccountTruth(currentAccountInput);
  assert.equal(currentZero.spotCurrent, true);
  assert.equal(currentZero.marginCurrent, true);
  assert.equal(currentZero.spotAvailableUsdt, '0.00000000');
  assert.equal(currentZero.marginLiabilityBtc, '0.00000000');
  assert.equal(currentZero.liabilityCount, 0);

  const stale = resolveBasisAccountTruth({
    source: 'STATE',
    requestError: null,
    freshnessState: 'STALE',
    freshnessReason: 'Stale account truth',
    spotState: 'AVAILABLE',
    spotFreshnessState: 'CURRENT',
    spotFreshnessReason: 'Current spot truth',
    spotCoverageState: 'COMPLETE_CURRENT',
    spotBalancesAvailable: true,
    spotAvailableUsdt: '125.00000000',
    marginState: 'AVAILABLE',
    marginFreshnessState: 'CURRENT',
    marginFreshnessReason: 'Current margin truth',
    marginCoverageState: 'COMPLETE_CURRENT',
    marginAssetsAvailable: true,
    liabilityReconciliationState: 'RECONCILED',
    liabilityFreshnessState: 'CURRENT',
    liabilityFreshnessReason: 'Current liability truth',
    marginLiabilityBtc: '0.10000000',
    liabilityCount: 1,
  });
  assert.equal(stale.spotAvailableUsdt, null);
  assert.equal(stale.marginLiabilityBtc, null);

  const partial = resolveBasisAccountTruth({
    source: 'STATE',
    requestError: null,
    freshnessState: 'CURRENT',
    freshnessReason: 'Current account truth',
    spotState: 'PARTIAL',
    spotFreshnessState: 'CURRENT',
    spotFreshnessReason: 'Current spot truth',
    spotCoverageState: 'PARTIAL_SYMBOL_SCOPED',
    spotBalancesAvailable: true,
    spotAvailableUsdt: '125.00000000',
    marginState: 'PARTIAL',
    marginFreshnessState: 'CURRENT',
    marginFreshnessReason: 'Current margin truth',
    marginCoverageState: 'PARTIAL_SYMBOL_SCOPED',
    marginAssetsAvailable: true,
    liabilityReconciliationState: 'PARTIAL',
    liabilityFreshnessState: 'CURRENT',
    liabilityFreshnessReason: 'Current liability truth',
    marginLiabilityBtc: '0.10000000',
    liabilityCount: 1,
  });
  assert.equal(partial.spotAvailableUsdt, null);
  assert.equal(partial.marginLiabilityBtc, null);

  const fallback = resolveBasisAccountTruth({
    source: 'FALLBACK',
    requestError: null,
    freshnessState: 'CURRENT',
    freshnessReason: 'Current account truth',
    spotState: 'AVAILABLE',
    spotFreshnessState: 'CURRENT',
    spotFreshnessReason: 'Current spot truth',
    spotCoverageState: 'COMPLETE_CURRENT',
    spotBalancesAvailable: true,
    spotAvailableUsdt: '125.00000000',
    marginState: 'AVAILABLE',
    marginFreshnessState: 'CURRENT',
    marginFreshnessReason: 'Current margin truth',
    marginCoverageState: 'COMPLETE_CURRENT',
    marginAssetsAvailable: true,
    liabilityReconciliationState: 'RECONCILED',
    liabilityFreshnessState: 'CURRENT',
    liabilityFreshnessReason: 'Current liability truth',
    marginLiabilityBtc: '0.00000000',
    liabilityCount: 0,
  });
  assert.equal(fallback.spotAvailableUsdt, '125.00000000');
  assert.equal(fallback.sourceLabel, 'Fallback Account Read');

  const now = 1_720_000_000_000;
  const future = privateReadFreshness({ state: 'AVAILABLE', observedAt: now + 1 }, now);
  const staleScoped = privateReadFreshness({ state: 'AVAILABLE', observedAt: now - 120_000 }, now);
  const scopedTimestampFailure = resolveBasisAccountTruth({
    ...currentAccountInput,
    spotFreshnessState: future.state,
    spotFreshnessReason: future.reason,
    marginFreshnessState: staleScoped.state,
    marginFreshnessReason: staleScoped.reason,
    liabilityFreshnessState: future.state,
    liabilityFreshnessReason: future.reason,
  });
  assert.equal(scopedTimestampFailure.spotAvailableUsdt, null);
  assert.equal(scopedTimestampFailure.marginLiabilityBtc, null);
});

test('future and stale account timestamps never become current', () => {
  const now = 1_720_000_000_000;
  const future = privateReadFreshness({ state: 'AVAILABLE', observedAt: now + 1 }, now);
  const stale = privateReadFreshness({ state: 'AVAILABLE', observedAt: now - 120_000 }, now);
  assert.equal(future.state, 'UNKNOWN');
  assert.equal(stale.state, 'STALE');
});

test('Basis source consumes existing owners without new account, market, or execution effects', async () => {
  const source = await readFile(new URL('../../src/pages/Strategies.tsx', import.meta.url), 'utf8');
  assert.equal(source.match(/fetchJson\('\/api\/engine\/basis'/g)?.length, 1);
  assert.match(source, /useProductControlRoomContext\(\)/);
  assert.match(source, /projectPrivateRead\(privateRead, accountNow\)/);
  assert.match(source, /spotFreshnessState: spotFreshness\.state/);
  assert.match(source, /liabilityFreshnessState: liabilityFreshness\.state/);
  assert.match(source, /const rows = basisTruth\.current \?/);
  assert.match(source, /accountTruth\.spotAvailableUsdt \?\? 'UNKNOWN'/);
  assert.match(source, /accountTruth\.marginLiabilityBtc \?\? 'UNKNOWN'/);
  assert.doesNotMatch(source, /\/api\/private-account|\/api\/markets|placeOrder|executeOrder|method:\s*['"]POST['"]/);
  assert.doesNotMatch(source, /fixture|synthetic/i);
});

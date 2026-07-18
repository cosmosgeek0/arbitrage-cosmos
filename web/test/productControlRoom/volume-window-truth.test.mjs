import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('volume window counts reserve zero for present windows with explicit zero evidence', async (context) => {
  const cssHooks = registerHooks({
    load(url, hookContext, nextLoad) {
      if (!url.endsWith('.css')) return nextLoad(url, hookContext);
      return { format: 'module', shortCircuit: true, source: '' };
    },
  });
  context.after(() => cssHooks.deregister());
  const { windowCountLabel } = await import('../../src/pages/VolumeScanner.tsx');

  assert.equal(windowCountLabel(undefined, 'tradeCount', ' Trades'), 'UNKNOWN');
  assert.equal(windowCountLabel(undefined, 'largeTradeCount'), 'UNKNOWN');

  assert.equal(windowCountLabel({ tradeCount: 0 }, 'tradeCount', ' Trades'), '0 Trades');
  assert.equal(windowCountLabel({ largeTradeCount: 0 }, 'largeTradeCount'), '0');

  assert.equal(windowCountLabel({ tradeCount: 12 }, 'tradeCount', ' Trades'), '12 Trades');
  assert.equal(windowCountLabel({ largeTradeCount: 3 }, 'largeTradeCount'), '3');
});

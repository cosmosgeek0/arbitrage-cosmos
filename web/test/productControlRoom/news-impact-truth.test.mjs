import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createServer } from 'vite';

test('News preserves missing impact as UNKNOWN and excludes it from scored totals', async () => {
  const server = await createServer({
    root: new URL('../..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom',
  });

  try {
    const news = await server.ssrLoadModule('/src/pages/News.tsx');
    assert.equal(typeof news.authoritativeNewsImpact, 'function');
    assert.equal(typeof news.summarizeNewsImpacts, 'function');

    const unscoredSecurityHeadline = {
      impact: undefined,
      title: 'Critical bridge exploit drains funds',
      channel: 'primary',
      tags: ['Security'],
    };
    assert.equal(news.authoritativeNewsImpact(unscoredSecurityHeadline), null);

    assert.deepEqual(news.summarizeNewsImpacts([
      unscoredSecurityHeadline,
      { impact: null },
      { impact: 3 },
      { impact: 2 },
      { impact: 1 },
      { impact: 0 },
    ]), {
      high: 1,
      medium: 1,
      low: 1,
      unknown: 3,
      scored: 3,
    });

    const source = await readFile(new URL('../../src/pages/News.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fallbackImpact/);
    assert.doesNotMatch(source, /item\.impact\s*\?\?\s*2/);
  } finally {
    await server.close();
  }
});

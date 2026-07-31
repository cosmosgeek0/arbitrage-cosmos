import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readVolumeSource = () => readFile(
  new URL('../../src/pages/VolumeScanner.tsx', import.meta.url),
  'utf8',
);

test('Epoch 5R Volume keeps shadow-owner freshness gates and real page controls', async () => {
  const source = await readVolumeSource();

  assert.match(source, /fetchJson<unknown>\('\/api\/engine\/volume', \{ cache: 'no-store', signal \}\)/);
  assert.match(source, /binding\.continuity === 'PROVEN'/);
  assert.match(source, /volumeComponent\?\.observedLifecycle === 'READY'/);
  assert.match(source, /volumeComponent\.canonicalPresentation\.status === 'operational'/);
  assert.match(source, /const rows = volumeTruth\.current && Array\.isArray\(snapshot\?\.rows\) \? snapshot\.rows : \[\]/);

  assert.match(source, /fetchJson<unknown>\(`\/api\/intelligence\/token\?symbol=\$\{encodeURIComponent\(symbol\)\}`/);
  assert.match(source, /onClick=\{\(\) => openDetail\(row\.symbol\)\}/);
  assert.match(source, /onClick=\{\(\) => void toggleWatch\(row\.symbol\)\}/);
  assert.match(source, /onClick=\{\(\) => openLedger\(row\.symbol\)\}/);

  assert.match(
    source,
    /<button\s+type="button"\s+className="volx-row"\s+aria-expanded=\{isExpanded\}\s+aria-controls=\{detailId\}/,
  );
  assert.match(source, /<div className="volx-detail" id=\{detailId\}>/);
  assert.match(source, /className="volx-table" role="region" aria-label="Volume Scanner Decisions"/);
  assert.doesNotMatch(source, /role="(?:table|rowgroup|row|cell|columnheader)"/);
  assert.doesNotMatch(source, /execute|placeOrder|submitOrder|liveMoneyAuthority\s*=\s*['"](?:WRITE|TRADE)/i);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readVolumeSource = () => readFile(
  new URL('../../src/pages/VolumeScanner.tsx', import.meta.url),
  'utf8',
);
const readVolumeCss = () => readFile(
  new URL('../../src/pages/VolumeScanner.css', import.meta.url),
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

  assert.match(source, /className="volx-table" role="table" aria-label="Volume Scanner Decisions" aria-colcount=\{8\}/);
  const header = source.match(/<div className="volx-head" role="row">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(header, 'Volume table exposes a header row');
  assert.equal((header.match(/role="columnheader"/g) ?? []).length, 8);
  assert.match(header, /State[\s\S]*Asset[\s\S]*Price[\s\S]*Volume Vs Baseline[\s\S]*Trade Flow[\s\S]*Market Quality[\s\S]*Price Move[\s\S]*Decision/);

  assert.match(source, /className="volx-item" role="rowgroup" key=\{row\.symbol\}/);
  const decisionRow = source.match(/<div className="volx-row" role="row">([\s\S]*?)<\/div>\s*\{isExpanded \? \(/)?.[1];
  assert.ok(decisionRow, 'Volume decisions expose a data row');
  assert.equal((decisionRow.match(/role="cell"/g) ?? []).length, 8);
  assert.match(decisionRow, /className="volx-decision" role="cell"[\s\S]*className="volx-row-toggle"[\s\S]*aria-expanded=\{isExpanded\}[\s\S]*aria-controls=\{detailId\}/);
  assert.doesNotMatch(decisionRow, /<button[^>]*role="row"/);
  assert.match(source, /className="volx-detail-row" role="row">\s*<div className="volx-detail" id=\{detailId\} role="cell" aria-colspan=\{8\}>/);
  assert.match(source, /className="volx-empty" role="row">\s*<div className="volx-empty-cell" role="cell" aria-colspan=\{8\}>/);
  assert.doesNotMatch(source, /execute|placeOrder|submitOrder|liveMoneyAuthority\s*=\s*['"](?:WRITE|TRADE)/i);
});

test('Volume filter note contains arbitrary runtime errors without shrinking view controls', async () => {
  const [source, css] = await Promise.all([readVolumeSource(), readVolumeCss()]);

  assert.match(source, /const volumeViewNote = [\s\S]*?volumeTruth\.reason \?\? 'Runtime starting';/);
  assert.match(source, /<span className="volx-view-note" title=\{volumeViewNote\}>\s*\{volumeViewNote\}\s*<\/span>/);
  assert.match(css, /\.volx-filters\s*\{[^}]*min-width:\s*0;[^}]*gap:\s*16px;/s);
  assert.match(css, /\.volx-segments\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(css, /\.volx-view-note\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canonicalClockZone,
  formatClockZone,
  tradingViewClockZone,
} from '../../src/lib/time.ts';

test('canonical clock formatting honors the selected IANA zone independent of the host zone', () => {
  const timestamp = Date.parse('2026-01-15T12:34:56Z');
  const options = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  };

  const expectedNewYork = new Intl.DateTimeFormat('en-GB', {
    ...options,
    timeZone: 'America/New_York',
  }).format(new Date(timestamp));
  const expectedKolkata = new Intl.DateTimeFormat('en-GB', {
    ...options,
    timeZone: 'Asia/Kolkata',
  }).format(new Date(timestamp));

  assert.equal(formatClockZone(timestamp, 'America/New_York', options, 'en-GB'), expectedNewYork);
  assert.equal(formatClockZone(timestamp, 'Asia/Kolkata', options, 'en-GB'), expectedKolkata);
  assert.notEqual(expectedNewYork, expectedKolkata);
  assert.equal(canonicalClockZone('not/a-zone'), 'UTC', 'invalid persisted zones fail closed to UTC');
  assert.equal(tradingViewClockZone('UTC'), 'Etc/UTC');
  assert.equal(tradingViewClockZone('America/New_York'), 'America/New_York');
});

test('Token, TradingView, and Dashboard all render times through the clock-zone owner', async () => {
  const [token, chart, widget, dashboard] = await Promise.all([
    readFile(new URL('../../src/pages/TokenDetail.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/components/TradingViewChart.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/components/TradingViewWidget.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/Dashboard.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(token, /formatClockZone/);
  assert.match(token, /prefs\.clockZone/);
  assert.doesNotMatch(token, /new Date\([^)]*\)\.toLocale(?:Time|Date)?String/);

  assert.match(chart, /clockZone:\s*string/);
  assert.match(chart, /formatClockZone\(Number\(ts\) \* 1000, clockZone/);
  assert.doesNotMatch(chart, /\.getHours\(\)|\.getMinutes\(\)|\.getSeconds\(\)/);

  assert.match(widget, /timezone:\s*tradingViewClockZone\(clockZone\)/);
  assert.match(widget, /<TradingViewChart[\s\S]*clockZone=\{clockZone\}/);

  assert.match(dashboard, /const \[nowMs, setNowMs\] = useState\(\(\) => Date\.now\(\)\)/);
  assert.match(dashboard, /window\.setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 5_000\)/);
  assert.match(dashboard, /formatClockZone\(event\.ts, prefs\.clockZone/);
  assert.doesNotMatch(dashboard, /new Date\([^)]*\)\.toLocale(?:Time|Date)?String/);
});

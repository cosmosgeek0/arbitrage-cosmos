import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const headerUrl = new URL('../../src/components/Header.tsx', import.meta.url);

test('Header quick-view overlays are bounded, abortable, and retain shared owner truth', async () => {
  const source = await readFile(headerUrl, 'utf8');
  const newsStart = source.indexOf('function NewsModal(');
  const newsEnd = source.indexOf('function CalendarModal(', newsStart);
  const calendarEnd = source.indexOf('// Rendered once at the app root', newsEnd);

  assert.notEqual(newsStart, -1, 'News quick-view overlay is missing');
  assert.notEqual(newsEnd, -1, 'News quick-view overlay boundary is missing');
  assert.notEqual(calendarEnd, -1, 'Calendar quick-view overlay boundary is missing');

  const news = source.slice(newsStart, newsEnd);
  const calendar = source.slice(newsEnd, calendarEnd);
  for (const [name, overlay] of [['news', news], ['calendar', calendar]]) {
    assert.match(overlay, /const controller = new AbortController\(\)/, `${name} must own cleanup cancellation`);
    assert.match(overlay, /signal:\s*controller\.signal/, `${name} must pass its cancellation signal`);
    assert.match(overlay, /fetchJson<unknown>\([\s\S]*6_000,?\s*\)/, `${name} must use a bounded JSON request`);
    assert.match(overlay, /if \(controller\.signal\.aborted\) return/, `${name} must ignore obsolete settlement`);
    assert.match(overlay, /return \(\) => controller\.abort\(\)/, `${name} cleanup must abort its request`);
    assert.match(overlay, /setLoadStatus\('UNAVAILABLE'\)/, `${name} failure truth must remain visible`);
    assert.match(overlay, /quickViewLivePresentation\(loadStatus\)/, `${name} must retain quick-view liveness truth`);
    assert.doesNotMatch(overlay, /\bfetch\(/, `${name} must not bypass the bounded HTTP owner`);
  }

  assert.doesNotMatch(source, /\bfetch\(/, 'Header must contain no raw fetch call');
  assert.match(source, /refreshFx: refreshCurrencyFx/);
  assert.match(source, /onClick=\{refreshCurrencyFx\}/);
  assert.doesNotMatch(source, /useNotificationFeed|notificationFeedState/);
  assert.match(source, /projectCanonicalIncidentNotifications/);
});

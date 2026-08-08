import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createServer } from 'vite';

const NOW = Date.parse('2026-07-31T08:00:00.000Z');
const EVENT = Object.freeze({
  id: 'calendar-event-1',
  title: 'Policy Decision',
  country: 'US',
  indicator: 'Policy Decision',
  importance: 1,
  period: 'Jul',
  actual: null,
  forecast: 4.25,
  previous: 4.5,
  unit: '%',
  scale: null,
  currency: 'USD',
  category: 'mny',
  comment: null,
  source: 'Central Bank',
  sourceUrl: null,
  date: '2026-07-31T12:00:00.000Z',
});

test('Calendar paging stays inside the fetched envelope and fails closed while range state is adjusted', async () => {
  const server = await createServer({
    root: new URL('../..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom',
  });

  try {
    const calendar = await server.ssrLoadModule('/src/pages/CalendarPage.tsx');
    const bounds = calendar.calendarSupportedWeekBounds(NOW, 'UTC');
    assert.deepEqual(bounds, {
      earliestWeekStart: '2026-07-20',
      latestWeekStart: '2026-08-10',
    });
    assert.deepEqual(calendar.calendarWeekNavigation('2026-07-20', bounds), {
      previousDisabled: true,
      nextDisabled: false,
    });
    assert.deepEqual(calendar.calendarWeekNavigation('2026-08-10', bounds), {
      previousDisabled: false,
      nextDisabled: true,
    });
    assert.equal(calendar.moveCalendarWeekWithinBounds('2026-07-20', -1, bounds), '2026-07-20');
    assert.equal(calendar.moveCalendarWeekWithinBounds('2026-08-10', 1, bounds), '2026-08-10');

    const covered = calendar.calendarRangeTruth('2026-07-27', '2026-07-31', bounds);
    assert.deepEqual(covered, {
      requestedCovered: true,
      weekStart: '2026-07-27',
      selectedDay: '2026-07-31',
    });
    const outside = calendar.calendarRangeTruth('2026-07-13', '2026-07-13', bounds);
    assert.deepEqual(outside, {
      requestedCovered: false,
      weekStart: '2026-07-20',
      selectedDay: '2026-07-20',
    });
    const mismatchedDay = calendar.calendarRangeTruth('2026-07-27', '2026-08-17', bounds);
    assert.deepEqual(mismatchedDay, {
      requestedCovered: false,
      weekStart: '2026-07-27',
      selectedDay: '2026-07-27',
    });

    const snapshot = calendar.parseCalendarPayload({
      items: [EVENT],
      fetchedAt: NOW - 1_000,
      state: 'fresh',
      maxAgeMs: 60_000,
    }, NOW);
    const current = calendar.calendarFeedPresentation(snapshot, NOW);
    assert.equal(current.status, 'CURRENT');
    const guarded = calendar.calendarRangePresentation(current, outside.requestedCovered);
    assert.equal(guarded.status, 'UNAVAILABLE');
    assert.match(guarded.detail, /outside the fetched calendar envelope/);
    assert.equal(calendar.calendarRangePresentation(current, covered.requestedCovered).status, 'CURRENT');
    assert.equal(calendar.calendarEmptyState(true, 0, false), 'RANGE_UNAVAILABLE');
    assert.equal(calendar.calendarEmptyState(true, 0, true), 'NO_EVENTS');
    assert.equal(calendar.calendarEmptyState(false, 0, false), null);

    assert.deepEqual(calendar.calendarSupportedWeekBounds(NOW, 'Asia/Kolkata'), {
      earliestWeekStart: '2026-07-27',
      latestWeekStart: '2026-08-10',
    });
    assert.deepEqual(calendar.calendarSupportedWeekBounds(NOW, 'America/New_York'), {
      earliestWeekStart: '2026-07-20',
      latestWeekStart: '2026-08-03',
    });

    const source = await readFile(new URL('../../src/pages/CalendarPage.tsx', import.meta.url), 'utf8');
    assert.match(source, /new Date\(feed\.fetchedAt \?\? clock\)/);
    assert.match(source, /disabled=\{weekNavigation\.previousDisabled\}/);
    assert.match(source, /disabled=\{weekNavigation\.nextDisabled\}/);
    assert.match(source, /calendarRangePresentation\(calendarFeedPresentation\(feed, clock\), rangeCovered\)/);
    assert.match(source, /calendarEmptyState\(items !== null, visible\.length, rangeCovered\)/);
  } finally {
    await server.close();
  }
});

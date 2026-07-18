import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  INITIAL_RECONNECT_BACKOFF_STATE,
  RECONNECT_BACKOFF_BASE_MS,
  RECONNECT_BACKOFF_MAX_ATTEMPT,
  RECONNECT_BACKOFF_MAX_MS,
  RECONNECT_BACKOFF_STABLE_OPEN_MS,
  planReconnectBackoff,
} from '../../src/lib/reconnectBackoff.ts';

test('retry ceilings grow exponentially and remain capped with injected full jitter', () => {
  assert.equal(RECONNECT_BACKOFF_BASE_MS, 1_000);
  assert.equal(RECONNECT_BACKOFF_MAX_MS, 30_000);
  assert.equal(RECONNECT_BACKOFF_STABLE_OPEN_MS, 30_000);
  assert.deepEqual(INITIAL_RECONNECT_BACKOFF_STATE, { attempt: 0 });

  let state = INITIAL_RECONNECT_BACKOFF_STATE;
  const observed = [];
  for (let index = 0; index < 8; index += 1) {
    const plan = planReconnectBackoff(state, {
      entropySample: 0.5,
      openDurationMs: null,
    });
    observed.push([plan.next.attempt, plan.ceilingMs, plan.delayMs]);
    state = plan.next;
  }

  assert.deepEqual(observed, [
    [1, 1_000, 500],
    [2, 2_000, 1_000],
    [3, 4_000, 2_000],
    [4, 8_000, 4_000],
    [5, 16_000, 8_000],
    [6, 30_000, 15_000],
    [7, 30_000, 15_000],
    [8, 30_000, 15_000],
  ]);
});

test('entropy fully controls the bounded jitter without ambient randomness', () => {
  const zero = planReconnectBackoff(INITIAL_RECONNECT_BACKOFF_STATE, {
    entropySample: 0,
    openDurationMs: null,
  });
  const nearCeiling = planReconnectBackoff(INITIAL_RECONNECT_BACKOFF_STATE, {
    entropySample: 0.999_999,
    openDurationMs: null,
  });
  const invalid = planReconnectBackoff(INITIAL_RECONNECT_BACKOFF_STATE, {
    entropySample: Number.NaN,
    openDurationMs: null,
  });

  assert.equal(zero.delayMs, 0);
  assert.equal(nearCeiling.delayMs, 1_000);
  assert.equal(invalid.delayMs, 1_000);
  assert.equal(Object.isFrozen(zero), true);
  assert.equal(Object.isFrozen(zero.next), true);
});

test('attempt history resets only after the prior socket was stably open', () => {
  const prior = Object.freeze({ attempt: 5 });
  const unstable = planReconnectBackoff(prior, {
    entropySample: 0.5,
    openDurationMs: RECONNECT_BACKOFF_STABLE_OPEN_MS - 1,
  });
  assert.deepEqual(unstable, {
    next: { attempt: 6 },
    delayMs: 15_000,
    ceilingMs: 30_000,
    stableResetApplied: false,
  });

  const stable = planReconnectBackoff(prior, {
    entropySample: 0.5,
    openDurationMs: RECONNECT_BACKOFF_STABLE_OPEN_MS,
  });
  assert.deepEqual(stable, {
    next: { attempt: 1 },
    delayMs: 500,
    ceilingMs: 1_000,
    stableResetApplied: true,
  });

  const missing = planReconnectBackoff(prior, {
    entropySample: 0.5,
    openDurationMs: null,
  });
  assert.equal(missing.stableResetApplied, false);
  assert.equal(missing.next.attempt, 6);
});

test('attempt state and malformed input remain bounded', () => {
  let state = INITIAL_RECONNECT_BACKOFF_STATE;
  for (let index = 0; index < RECONNECT_BACKOFF_MAX_ATTEMPT * 3; index += 1) {
    state = planReconnectBackoff(state, {
      entropySample: 0.75,
      openDurationMs: null,
    }).next;
  }
  assert.deepEqual(state, { attempt: RECONNECT_BACKOFF_MAX_ATTEMPT });

  const malformed = planReconnectBackoff({ attempt: Number.NaN }, {
    entropySample: -1,
    openDurationMs: -10,
  });
  assert.equal(malformed.next.attempt, RECONNECT_BACKOFF_MAX_ATTEMPT);
  assert.equal(malformed.ceilingMs, RECONNECT_BACKOFF_MAX_MS);
  assert.equal(malformed.delayMs, RECONNECT_BACKOFF_MAX_MS);
});

test('helper is pure and the store schedules jittered backoff without weakening protocol health', async () => {
  const [helper, store] = await Promise.all([
    readFile(new URL('../../src/lib/reconnectBackoff.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/store.tsx', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(helper, /Math\.random|Date\.now|performance\.now|setTimeout|setInterval/);
  assert.match(store, /let reconnectBackoff = INITIAL_RECONNECT_BACKOFF_STATE/);
  assert.match(store, /openedAtMonotonicMs = performance\.now\(\)/);
  assert.match(store, /openDurationMs:[\s\S]*performance\.now\(\) - openedAtMonotonicMs/);
  assert.match(store, /entropySample: Math\.random\(\)/);
  assert.match(store, /reconnectBackoff = plan\.next/);
  assert.match(store, /scheduleConnect\(plan\.delayMs\)/);
  assert.doesNotMatch(store, /scheduleConnect\(3_000\)/);
  const onOpen = store.slice(store.indexOf('ws.onopen ='), store.indexOf('ws.onmessage ='));
  const stableTimerStart = onOpen.indexOf('stableOpenTimer = window.setTimeout');
  assert.ok(stableTimerStart > 0);
  assert.doesNotMatch(onOpen.slice(0, stableTimerStart), /reconnectBackoff\s*=/);
  assert.match(onOpen, /stableOpenTimer = window\.setTimeout\(\(\) => \{[\s\S]*reconnectBackoff = INITIAL_RECONNECT_BACKOFF_STATE;[\s\S]*RECONNECT_BACKOFF_STABLE_OPEN_MS/);
  assert.match(store, /const clearStableOpenTimer = \(\) => \{/);

  assert.match(store, /decodeWebSocketProtocolEnvelope\(msg\.data, isKnownWebSocketEnvelope\)/);
  assert.match(store, /ws\.close\(WEB_SOCKET_PROTOCOL_CLOSE_CODE, WEB_SOCKET_PROTOCOL_CLOSE_REASON\)/);
});

#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

BENCH="$REPO_ROOT/ops/live/bin/latency-bench.mjs"
PROBE="$TEST_TMP/rb27-latency-deadlines.mjs"

cat > "$PROBE" <<'NODE'
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';

const { measureDnsLookup, sampleOnce } = await import(pathToFileURL(process.argv[2]));

class ManualScheduler {
  constructor() { this.now = 0; this.tasks = []; }
  schedule(delayMs, task) {
    const entry = { dueAt: this.now + delayMs, task, cancelled: false, fired: false };
    this.tasks.push(entry);
    return { cancel: () => { entry.cancelled = true; } };
  }
  pending() { return this.tasks.filter((entry) => !entry.cancelled && !entry.fired); }
  fireNext() {
    const entry = this.pending().sort((left, right) => left.dueAt - right.dueAt)[0];
    assert.ok(entry, 'expected a pending deadline');
    entry.fired = true;
    this.now = entry.dueAt;
    entry.task();
  }
}

const dnsScheduler = new ManualScheduler();
let dnsSignal = null;
const dnsPending = measureDnsLookup('never.example', 25, {
  lookup: (_hostname, context) => {
    dnsSignal = context.signal;
    return new Promise(() => {});
  },
  now: () => dnsScheduler.now,
  scheduler: dnsScheduler,
});
assert.equal(dnsScheduler.pending().length, 1);
dnsScheduler.fireNext();
const dnsTimedOut = await dnsPending;
assert.equal(dnsTimedOut.ok, false);
assert.deepEqual(dnsTimedOut.error, {
  code: 'DNS_DEADLINE_EXCEEDED',
  message: 'DNS lookup exceeded its absolute deadline.',
});
assert.equal(dnsSignal.aborted, true);
assert.equal(dnsScheduler.pending().length, 0);

const sanitized = await measureDnsLookup('redacted.example', 25, {
  lookup: () => Promise.reject(Object.assign(new Error('secret resolver detail'), { code: 'ENOTFOUND' })),
  now: () => dnsScheduler.now,
  scheduler: dnsScheduler,
});
assert.deepEqual(sanitized.error, { code: 'ENOTFOUND', message: 'DNS lookup failed (ENOTFOUND).' });
assert.equal(JSON.stringify(sanitized).includes('secret resolver detail'), false);

const malformed = await measureDnsLookup('redacted.example', 25, {
  lookup: () => Promise.reject(Object.assign(new Error('another secret'), { code: 'bad code with data' })),
  now: () => dnsScheduler.now,
  scheduler: dnsScheduler,
});
assert.equal(malformed.error.code, 'DNS_LOOKUP_FAILED');
assert.equal(JSON.stringify(malformed).includes('another secret'), false);

const requestScheduler = new ManualScheduler();
class NeverRequest extends EventEmitter {
  setTimeout() { throw new Error('inactivity timeout must not be the deadline authority'); }
  destroy() { this.destroyCalls = (this.destroyCalls ?? 0) + 1; }
}
const request = new NeverRequest();
const response = new EventEmitter();
const socket = new EventEmitter();
response.resume = () => {};
response.destroy = () => { response.destroyCalls = (response.destroyCalls ?? 0) + 1; };
response.statusCode = 200;
let responseHandler;
const requestPending = sampleOnce('http://127.0.0.1/', 25, {
  get: (_url, _options, handler) => {
    responseHandler = handler;
    return request;
  },
  now: () => requestScheduler.now,
  scheduler: requestScheduler,
});
responseHandler(response);
request.emit('socket', socket);
response.emit('data', Buffer.from('activity cannot extend the absolute deadline'));
assert.equal(requestScheduler.pending().length, 1);
requestScheduler.fireNext();
const requestTimedOut = await requestPending;
assert.equal(requestTimedOut.ok, false);
assert.equal(requestTimedOut.error.code, 'HTTP_DEADLINE_EXCEEDED');
assert.equal(request.destroyCalls, 1);
assert.equal(response.destroyCalls, 1);
assert.equal(requestScheduler.pending().length, 0);
assert.equal(Object.isFrozen(requestTimedOut.phases), true);
const settledBytes = JSON.stringify(requestTimedOut);
requestScheduler.now += 100;
response.emit('end');
socket.emit('lookup');
socket.emit('connect');
socket.emit('secureConnect');
request.emit('socket', new EventEmitter());
const lateResponse = new EventEmitter();
lateResponse.destroy = () => { lateResponse.emit('error', new Error('late response error must be contained')); };
assert.doesNotThrow(() => responseHandler(lateResponse));
assert.doesNotThrow(() => lateResponse.emit('error', new Error('second late response error must remain contained')));
assert.equal(JSON.stringify(requestTimedOut), settledBytes, 'late response/socket events must be inert');
NODE

note "absolute DNS and HTTP lifecycle deadlines settle injected never-resolving work"
assert_success node "$PROBE" "$BENCH"

note "the donor-owned latency suite remains compatible"
assert_success bash "$REPO_ROOT/ops/tests/test-latency-bench.sh"

finish

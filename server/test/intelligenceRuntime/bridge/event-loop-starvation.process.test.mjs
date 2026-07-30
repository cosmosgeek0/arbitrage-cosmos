import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import {
  BoundedCorrelationIndex,
} from '../../../dist/intelligenceRuntime/bridge/index.js';

const CAPACITY = 131_072;
const OVERFLOW_INSERTIONS = 1_024;
const PRESSURE_BOUND_MS = 250;
const REQUEST_BOUND_MS = 500;
const RECOVERY_IDLE_MS = 500;
const RECOVERY_CPU_BOUND_MS = 100;
const PRESSURE_PROBE_COUNT = 8;

function send(message) {
  if (typeof process.send === 'function') process.send(message);
}

async function runChild() {
  const correlations = new BoundedCorrelationIndex(CAPACITY, 1);
  for (let index = 0; index < CAPACITY; index += 1) {
    correlations.link(`seed-${String(index).padStart(6, '0')}`, 'SOURCE', ['root'], index);
  }

  const server = http.createServer((request, response) => {
    if (request.url === '/health/live' || request.url === '/health/ready') {
      response.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      response.end('{"status":"UP"}');
      return;
    }
    response.writeHead(404, { connection: 'close' });
    response.end();
  });
  const pressureSockets = [];
  let pressureSocketsArmed = true;
  server.on('connection', (socket) => {
    if (!pressureSocketsArmed || pressureSockets.length >= PRESSURE_PROBE_COUNT) return;
    socket.pause();
    pressureSockets.push(socket);
    if (pressureSockets.length === PRESSURE_PROBE_COUNT) send({ type: 'pressure-sockets-ready' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('loopback server address unavailable');
  send({ type: 'ready', port: address.port });

  process.on('message', (message) => {
    if (message?.type === 'pressure') {
      if (pressureSockets.length !== PRESSURE_PROBE_COUNT) {
        throw new Error(`expected ${PRESSURE_PROBE_COUNT} armed pressure sockets`);
      }
      pressureSocketsArmed = false;
      send({ type: 'pressure-start' });
      for (const socket of pressureSockets) socket.resume();
      const startedAt = performance.now();
      const startedCpu = process.cpuUsage();
      for (let index = 0; index < OVERFLOW_INSERTIONS; index += 1) {
        correlations.link(
          `overflow-${String(index).padStart(6, '0')}`,
          'EVIDENCE',
          ['root'],
          CAPACITY + index,
        );
      }
      const cpu = process.cpuUsage(startedCpu);
      send({
        type: 'pressure-done',
        wallMs: performance.now() - startedAt,
        cpuMs: (cpu.user + cpu.system) / 1_000,
      });
      return;
    }
    if (message?.type === 'idle-sample') {
      const startedCpu = process.cpuUsage();
      setTimeout(() => {
        const cpu = process.cpuUsage(startedCpu);
        send({
          type: 'idle-done',
          cpuMs: (cpu.user + cpu.system) / 1_000,
          wallMs: RECOVERY_IDLE_MS,
        });
      }, RECOVERY_IDLE_MS);
      return;
    }
    if (message?.type === 'close') {
      server.close(() => process.exit(0));
    }
  });
}

function waitForMessage(child, type, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`child message ${type} exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`child exited before ${type}: code=${code} signal=${signal}`));
    };
    const onMessage = (message) => {
      if (message?.type !== type) return;
      cleanup();
      resolve(message);
    };
    function cleanup() {
      clearTimeout(timeout);
      child.off('exit', onExit);
      child.off('message', onMessage);
    }
    child.on('exit', onExit);
    child.on('message', onMessage);
  });
}

function probe(port, path, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const request = http.get({
      host: '127.0.0.1',
      port,
      path,
      headers: { connection: 'close' },
    }, (response) => {
      response.resume();
      response.once('end', () => resolve({
        path,
        statusCode: response.statusCode ?? 0,
        wallMs: performance.now() - startedAt,
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`request exceeded ${timeoutMs} ms`)));
    request.once('error', () => resolve({
      path,
      statusCode: 0,
      wallMs: performance.now() - startedAt,
    }));
  });
}

function armPressureProbe(port, path, timeoutMs) {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  let startedAt = null;
  let settled = false;
  let responseBytes = '';
  let resolveResponse;
  const response = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const connected = new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const settle = (statusCode) => {
    if (settled) return;
    settled = true;
    resolveResponse({
      path,
      statusCode,
      wallMs: startedAt === null ? 0 : performance.now() - startedAt,
    });
  };
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    responseBytes += chunk;
  });
  socket.once('end', () => {
    const match = /^HTTP\/1\.[01] ([0-9]{3}) /u.exec(responseBytes);
    settle(match ? Number(match[1]) : 0);
  });
  socket.on('error', () => settle(0));

  return {
    connected,
    response,
    write() {
      startedAt = performance.now();
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`request exceeded ${timeoutMs} ms`)));
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    },
  };
}

if (process.argv.includes('--starvation-child')) {
  await runChild();
} else {
  test('lineage capacity preserves exact time and id eviction order across updates', () => {
    const index = new BoundedCorrelationIndex(3, 2);
    index.link('a', 'SOURCE', ['root-a'], 1);
    index.link('b', 'SOURCE', ['root-b'], 2);
    index.link('c', 'SOURCE', ['root-c'], 3);

    index.link('a', 'EVIDENCE', ['root-a-updated'], 4);
    index.link('d', 'SOURCE', ['root-d'], 5);
    assert.deepEqual(
      index.snapshot().links.map((entry) => [entry.id, entry.observedAtMs]),
      [['a', 4], ['c', 3], ['d', 5]],
    );

    index.link('d', 'EVIDENCE', ['root-d-regressed'], 0);
    index.link('e', 'SOURCE', ['root-e'], 6);
    assert.deepEqual(
      index.snapshot().links.map((entry) => [entry.id, entry.observedAtMs]),
      [['a', 4], ['c', 3], ['e', 6]],
    );

    const equalTime = new BoundedCorrelationIndex(2, 1);
    equalTime.link('b', 'SOURCE', ['root'], 10);
    equalTime.link('c', 'SOURCE', ['root'], 10);
    const selfEvictedRoots = equalTime.link('a', 'SOURCE', ['root'], 10);
    assert.deepEqual(equalTime.snapshot().links.map((entry) => entry.id), ['b', 'c']);
    assert.equal(equalTime.snapshot().evicted, 1);
    assert.deepEqual(selfEvictedRoots, ['root']);
    assert.deepEqual(equalTime.rootsFor('a'), []);
  });

  test('indexed lineage eviction matches the prior exact sort model', () => {
    const capacity = 17;
    const index = new BoundedCorrelationIndex(capacity, 2);
    const reference = new Map();
    let referenceEvicted = 0;
    let state = 0x5eed_1234;

    for (let operation = 0; operation < 2_000; operation += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      const id = `id-${String(state % 53).padStart(2, '0')}`;
      const observedAtMs = (state >>> 8) % 97;
      const stage = operation % 2 === 0 ? 'SOURCE' : 'EVIDENCE';
      const wasPresent = reference.has(id);
      index.link(id, stage, [`root-${operation % 5}`], observedAtMs);
      reference.set(id, { id, stage, observedAtMs });
      if (!wasPresent && reference.size > capacity) {
        const oldest = [...reference.values()].sort((left, right) => (
          left.observedAtMs - right.observedAtMs
          || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
        ))[0];
        reference.delete(oldest.id);
        referenceEvicted += 1;
      }

      if (operation % 37 === 0 || operation === 1_999) {
        const snapshot = index.snapshot();
        assert.deepEqual(
          snapshot.links.map(({ id: retainedId, stage: retainedStage, observedAtMs: retainedAt }) => (
            [retainedId, retainedStage, retainedAt]
          )),
          [...reference.values()]
            .sort((left, right) => (
              left.id < right.id ? -1 : left.id > right.id ? 1 : 0
            ))
            .map((entry) => [entry.id, entry.stage, entry.observedAtMs]),
        );
        assert.equal(snapshot.evicted, referenceEvicted);
        assert.equal(snapshot.size, reference.size);
      }
    }
  });

  test('production-cap lineage overflow leaves live and ready HTTP bounded and recovers idle CPU', async (t) => {
    const child = fork(fileURLToPath(import.meta.url), ['--starvation-child'], {
      execPath: process.execPath,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let childStderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      childStderr = `${childStderr}${chunk}`.slice(-4_096);
    });
    t.after(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.send({ type: 'close' });
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });

    const ready = await waitForMessage(child, 'ready', 15_000);
    const pressureSocketsReady = waitForMessage(child, 'pressure-sockets-ready');
    const armedPressure = Array.from({ length: PRESSURE_PROBE_COUNT }, (_, index) => (
      armPressureProbe(
        ready.port,
        index % 2 === 0 ? '/health/live' : '/health/ready',
        REQUEST_BOUND_MS,
      )
    ));
    await Promise.all(armedPressure.map(({ connected }) => connected));
    await pressureSocketsReady;
    for (const armed of armedPressure) armed.write();

    const pressureDone = waitForMessage(child, 'pressure-done');
    child.send({ type: 'pressure' });
    const [pressure, pressureResponses] = await Promise.all([
      pressureDone,
      Promise.all(armedPressure.map(({ response }) => response)),
    ]);

    const recoveryResponses = [];
    for (let index = 0; index < 10; index += 1) {
      recoveryResponses.push(await probe(
        ready.port,
        index % 2 === 0 ? '/health/live' : '/health/ready',
        REQUEST_BOUND_MS,
      ));
    }
    const idleDone = waitForMessage(child, 'idle-done');
    child.send({ type: 'idle-sample' });
    const idle = await idleDone;

    const diagnostics = {
      overflowInsertions: OVERFLOW_INSERTIONS,
      pressure,
      duringPressure: pressureResponses,
      recovery: recoveryResponses,
      idle,
      childStderr,
    };
    t.diagnostic(JSON.stringify({
      overflowInsertions: OVERFLOW_INSERTIONS,
      pressureWallMs: Number(pressure.wallMs.toFixed(3)),
      pressureCpuMs: Number(pressure.cpuMs.toFixed(3)),
      pressureHttp200: pressureResponses.filter((response) => response.statusCode === 200).length,
      pressureHttpMaxMs: Number(Math.max(...pressureResponses.map((response) => response.wallMs)).toFixed(3)),
      recoveryHttp200: recoveryResponses.filter((response) => response.statusCode === 200).length,
      recoveryHttpMaxMs: Number(Math.max(...recoveryResponses.map((response) => response.wallMs)).toFixed(3)),
      idleCpuMs: Number(idle.cpuMs.toFixed(3)),
      idleWindowMs: idle.wallMs,
    }));
    assert.ok(
      pressure.wallMs <= PRESSURE_BOUND_MS,
      `lineage overflow exceeded wall bound: ${JSON.stringify(diagnostics)}`,
    );
    assert.ok(
      pressure.cpuMs <= PRESSURE_BOUND_MS,
      `lineage overflow exceeded CPU bound: ${JSON.stringify(diagnostics)}`,
    );
    assert.ok(
      pressureResponses.every((response) => (
        response.statusCode === 200 && response.wallMs <= REQUEST_BOUND_MS
      )),
      `HTTP starved during lineage overflow: ${JSON.stringify(diagnostics)}`,
    );
    assert.ok(
      recoveryResponses.every((response) => (
        response.statusCode === 200 && response.wallMs <= REQUEST_BOUND_MS
      )),
      `HTTP did not recover inside bound: ${JSON.stringify(diagnostics)}`,
    );
    assert.ok(
      idle.cpuMs <= RECOVERY_CPU_BOUND_MS,
      `post-pressure idle CPU exceeded bound: ${JSON.stringify(diagnostics)}`,
    );
  }, { timeout: 30_000 });
}

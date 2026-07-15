import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { request as httpRequest, ClientRequest, Agent as HttpAgent } from 'node:http';
import { request as httpsRequest, Agent as HttpsAgent } from 'node:https';
import { connect as http2Connect } from 'node:http2';
import { connect as netConnect, Socket as NetSocket, Server as NetServer } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { lookup as dnsLookup, Resolver as DnsResolver } from 'node:dns';
import { resolve as dnsPromiseResolve, Resolver as DnsPromiseResolver } from 'node:dns/promises';
import { Socket as DatagramSocket } from 'node:dgram';

const root = new URL('../../../', import.meta.url).pathname;
const productionRoot = join(root, 'server/src/aiOps/caseRuntime');
const fixtureRoot = join(root, 'fixtures/aiOps/caseRuntime');
const testRoot = join(root, 'test/aiOps/caseRuntime');

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }).sort();
}

test('production runtime contains no ambient I/O, clock, randomness, environment, or second-store dependency', () => {
  const forbidden = [
    /from\s+['"]node:(?:fs|http|https|http2|net|tls|dns|dgram|child_process|worker_threads)['"]/u,
    /from\s+['"](?:better-sqlite3|ws|express|undici)['"]/u,
    /\b(?:fetch|Date\.now|Math\.random|setTimeout|setInterval|process\.env)\b/u,
    /\bnew\s+(?:Ledger|Database)\b/u,
    /\bLIVE_EXECUTION_NOT_IMPLEMENTED\s*=\s*false\b/u,
  ];
  for (const path of filesBelow(productionRoot).filter((file) => file.endsWith('.ts'))) {
    const source = readFileSync(path, 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, relative(root, path));
  }
});

test('all touched paths remain inside the three provisional A2 path families', () => {
  const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: root, encoding: 'utf8' });
  // Do not trim the full porcelain stream: a leading space is the first XY
  // status column for an unstaged modification and is part of the format.
  const statusPaths = status.split('\n').filter(Boolean).map((line) => line.slice(3));
  const committedPaths = execFileSync('git', [
    'diff', '--name-only', '03857dcdaff8d8b12627d27ddcc97505da1f2f86...HEAD',
  ], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const paths = [...new Set([...committedPaths, ...statusPaths])];
  assert.ok(paths.length > 0);
  for (const path of paths) {
    assert.ok(
      path.startsWith('server/src/aiOps/caseRuntime/')
      || path.startsWith('fixtures/aiOps/caseRuntime/')
      || path.startsWith('test/aiOps/caseRuntime/'),
      `out-of-scope path: ${path}`,
    );
  }
});

test('packet contains no high-confidence credential material', () => {
  const accessPrefix = ['AK', 'IA'].join('');
  const privateMarker = ['BEGIN', ' PRIVATE', ' KEY'].join('');
  const assignmentName = ['api', '[_-]?', '(?:key|secret)'].join('');
  const patterns = [
    new RegExp(`\\b${accessPrefix}[0-9A-Z]{16}\\b`, 'u'),
    new RegExp(`-{5}${privateMarker}-{5}`, 'u'),
    new RegExp(`${assignmentName}\\s*[:=]\\s*['"][A-Za-z0-9/+_.-]{20,}['"]`, 'iu'),
  ];
  for (const directory of [productionRoot, fixtureRoot, testRoot]) {
    for (const path of filesBelow(directory)) {
      const source = readFileSync(path, 'utf8');
      for (const pattern of patterns) assert.doesNotMatch(source, pattern, relative(root, path));
    }
  }
});

test('typed insertion requests are closed, non-authoritative, and bind exact base', () => {
  const path = join(fixtureRoot, 'insertion-requests.v1.json');
  const request = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(request.schema, 'AI_OPS_A2_SHADOW_INSERTION_REQUESTS_V1');
  assert.equal(request.shadowStatus, 'SHADOW_SPECULATIVE');
  assert.equal(request.authorityCreated, false);
  assert.equal(request.baseSha, '03857dcdaff8d8b12627d27ddcc97505da1f2f86');
  assert.equal(request.rows.length, 10);
  assert.equal(new Set(request.rows.map((row) => row.requestId)).size, request.rows.length);
  for (const row of request.rows) {
    assert.deepEqual(Object.keys(row).sort(), ['missingBehavior', 'need', 'owner', 'requestId', 'seam', 'status']);
    assert.equal(row.status, 'INSERTION_REQUIRED');
  }
});

test('named builtin bindings and direct socket or resolver instances cannot bypass total network deny', () => {
  const token = globalThis.__A2_NETWORK_DENY_PROBE_TOKEN__;
  assert.equal(typeof token, 'symbol');
  const expectDenied = (operation) => assert.throws(operation, /A2_TOTAL_NETWORK_DENY:/u);

  // The Symbol is deliberately invalid for every original API below. A
  // missing patch therefore fails synchronously without reaching the OS.
  expectDenied(() => netConnect(token));
  expectDenied(() => new NetSocket().connect(token));
  expectDenied(() => new NetServer().listen(token));
  expectDenied(() => httpRequest(token));
  expectDenied(() => new ClientRequest(token));
  expectDenied(() => new HttpAgent().createConnection(token));
  expectDenied(() => httpsRequest(token));
  expectDenied(() => new HttpsAgent().createConnection(token));
  expectDenied(() => http2Connect(token));
  expectDenied(() => tlsConnect(token));
  expectDenied(() => dnsLookup(token, () => {}));
  expectDenied(() => new DnsResolver().resolve(token, () => {}));
  expectDenied(() => dnsPromiseResolve(token));
  expectDenied(() => new DnsPromiseResolver().resolve(token));
  const datagram = new DatagramSocket('udp4');
  expectDenied(() => datagram.bind(token));
  expectDenied(() => datagram.connect(token));
  expectDenied(() => datagram.send(token));
});

test('the entire focused process has made zero network attempts', () => {
  assert.ok(Array.isArray(globalThis.__A2_NETWORK_ATTEMPTS__));
  assert.deepEqual(globalThis.__A2_NETWORK_ATTEMPTS__, []);
});

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

const root = new URL('../../../../', import.meta.url).pathname;
const productionRoot = join(root, 'server/src/aiOps/runtime');
const fixtureRoot = join(root, 'fixtures/aiOps/a2');
const testRoot = join(root, 'server/test/aiOps/a2');
const receiptRoot = join(root, 'docs/archive/aiOps/a2');
const donorBranch = 'port-a2-20260716';
const ratifiedRoots = [productionRoot, fixtureRoot, testRoot, receiptRoot];

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

test('all touched paths remain inside the four ratified A2 path families', () => {
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
  if (branch !== donorBranch) {
    const currentPaths = ratifiedRoots
      .flatMap((directory) => filesBelow(directory))
      .map((path) => relative(root, path).split('\\').join('/'))
      .sort();
    const trackedPaths = execFileSync('git', [
      'ls-files', '-z', '--', ...ratifiedRoots.map((directory) => relative(root, directory)),
    ], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
    assert.ok(currentPaths.length > 0);
    assert.deepEqual(currentPaths, trackedPaths);
    return;
  }
  const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: root, encoding: 'utf8' });
  // Do not trim the full porcelain stream: a leading space is the first XY
  // status column for an unstaged modification and is part of the format.
  const statusPaths = status.split('\n').filter(Boolean).map((line) => line.slice(3));
  const committedPaths = execFileSync('git', [
    'diff', '--name-only', '492e3f69b054c85686bcfc4c09dbff4ababeda3f...HEAD',
  ], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const paths = [...new Set([...committedPaths, ...statusPaths])];
  assert.ok(paths.length > 0);
  for (const path of paths) {
    assert.ok(
      path.startsWith('server/src/aiOps/runtime/')
      || path.startsWith('fixtures/aiOps/a2/')
      || path.startsWith('server/test/aiOps/a2/')
      || path.startsWith('docs/archive/aiOps/a2/'),
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
  for (const directory of [productionRoot, fixtureRoot, testRoot, receiptRoot]) {
    for (const path of filesBelow(directory)) {
      const source = readFileSync(path, 'utf8');
      for (const pattern of patterns) assert.doesNotMatch(source, pattern, relative(root, path));
    }
  }
});

test('typed insertion requests are closed, non-authoritative, and bind exact base', () => {
  const path = join(fixtureRoot, 'insertion-requests.v1.json');
  const request = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(Object.keys(request).sort(), [
    'authorityCreated',
    'directEditAllowed',
    'registryCommitSha',
    'registryPath',
    'rows',
    'schema',
    'sourceArtifactSha',
    'sourceExtensionSha',
    'targetBaseSha',
    'version',
  ]);
  assert.equal(request.schema, 'AI_OPS_A2_PORT_INSERTION_REQUEST_SET_V1');
  assert.equal(request.version, 1);
  assert.equal(request.authorityCreated, false);
  assert.equal(request.directEditAllowed, false);
  assert.equal(request.targetBaseSha, '492e3f69b054c85686bcfc4c09dbff4ababeda3f');
  assert.equal(request.sourceArtifactSha, 'ca1fb094e19d0ccc6a8397ee08a65a662d051bd3');
  assert.equal(request.sourceExtensionSha, '9ae6c22012e7c23ebebff827b527d4d64a263884');
  assert.equal(request.registryCommitSha, '08e0beaa54c4c3ca9c24276785d6a302f751a226');
  assert.equal(request.registryPath, 'AI_OPS_COLLISION_MAP.md');

  const expectedRowIds = [
    'AIOPS-IR-COMPOSITION-001',
    'AIOPS-IR-ROUTES-002',
    'AIOPS-IR-PERSISTENCE-003',
    'AIOPS-IR-PACKAGE-006',
    'AIOPS-IR-EVENTS-009',
    'AIOPS-IR-REMEDIATION-010',
    'AIOPS-IR-ASSURANCE-011',
    'AIOPS-IR-TELEMETRY-012',
    'AIOPS-IR-REFRESH-013',
    'AIOPS-IR-NOTIFY-014',
    'AIOPS-IR-INCIDENT-019',
    'AIOPS-IR-SENTINEL-020',
    'AIOPS-IR-AUDIT-021',
    'AIOPS-IR-MANAGED-INVENTORY-022',
    'AIOPS-IR-APPROVAL-023',
    'AIOPS-IR-BROWSER-PROBE-024',
    'AIOPS-IR-TEST-MOUNT-026',
  ];
  assert.deepEqual(request.rows.map((row) => row.rowId), expectedRowIds);
  assert.equal(new Set(expectedRowIds).size, request.rows.length);
  for (const row of request.rows) {
    assert.deepEqual(Object.keys(row).sort(), [
      'authorityCreated',
      'contract',
      'expectedBehavior',
      'reason',
      'requestedOwner',
      'rowId',
      'schema',
      'status',
      'targetSeam',
      'tests',
      'version',
      'wiringState',
    ]);
    assert.equal(row.schema, 'InsertionRequestRowV1');
    assert.equal(row.version, 1);
    assert.equal(row.status, 'DRAFT');
    assert.equal(row.wiringState, `PENDING_BACKEND:${row.rowId}`);
    assert.equal(row.authorityCreated, false);
    for (const field of ['requestedOwner', 'targetSeam', 'reason']) {
      assert.equal(typeof row[field], 'string');
      assert.ok(row[field].length > 0 && row[field].length <= 512, `${row.rowId}: ${field}`);
    }
    for (const field of ['contract', 'tests', 'expectedBehavior']) {
      assert.ok(Array.isArray(row[field]) && row[field].length > 0 && row[field].length <= 64, `${row.rowId}: ${field}`);
      for (const value of row[field]) {
        assert.equal(typeof value, 'string');
        assert.ok(value.length > 0 && value.length <= 512, `${row.rowId}: ${field}`);
      }
    }
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

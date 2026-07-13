import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isAllowedChangePath,
  scanExecutableSnippet,
  scanOwnedFiles,
  scanSecretText,
} from '../../../test/i00/scope-security.mjs';
import { verifyScopePaths } from '../../../test/i00/verify-scope.mjs';

test('§2 path allowlist rejects production shared package lane and protected directive paths', () => {
  for (const accepted of [
    'server/test/i00Acceptance/proof.test.mjs', 'test/i00/run.mjs', 'fixtures/i00/a.json',
    'integration/reports/a.json', 'IP_PROOF_STATE.md', 'IP_PROOF_RECEIPT.md',
  ]) assert.equal(isAllowedChangePath(accepted), true, accepted);
  for (const rejected of [
    'server/src/index.ts', 'web/src/App.tsx', 'packages/edge-protocol/schema/edge-protocol-v1.schema.json',
    'quant/Q.ts', 'IP_PROOF.md', 'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md',
    '../server/test/i00Acceptance/escape.mjs', '/tmp/escape.mjs',
  ]) assert.equal(isAllowedChangePath(rejected), false, rejected);
});

test('staged-scope verifier evaluates concrete path inventories and fails empty or mixed input', () => {
  assert.deepEqual(verifyScopePaths([
    'fixtures/i00/scenarios.json',
    'server/test/i00Acceptance/proof.test.mjs',
    'fixtures/i00/scenarios.json',
  ]), {
    checked: 2,
    accepted: 2,
    rejected: [],
    passed: true,
  });
  assert.equal(verifyScopePaths([]).passed, false);
  assert.deepEqual(verifyScopePaths(['test/i00/run.mjs', 'server/src/index.ts']).rejected, ['server/src/index.ts']);
});

test('scanner accepts required domain prose and synthetic fixture vocabulary', () => {
  const safe = `const x = { borrowStatus: 'UNKNOWN', repayStatus: 'PENDING', code: 'ORDER_AMBIGUOUS',
    sha: 'b58e64e27fb76ed7ba5ae4a6f8cfab08e520f95c', truthLabel: 'SYNTHETIC',
    officialPage: 'https://developers.binance.com/docs/example' };`;
  assert.deepEqual(scanExecutableSnippet(safe), []);
  assert.deepEqual(scanSecretText(safe), []);
});

test('scanner mutations reject egress private owners dynamic code env timers duplicate authority and live grants', () => {
  const cases = [
    ["import x from '../../server/src/binance/client.js'", 'PRIVATE_OWNER_IMPORT'],
    ["import http from 'node:http'", 'NODE_NETWORK_IMPORT'],
    ["import http2 from 'node:http2'", 'NODE_NETWORK_IMPORT'],
    ["import client from 'undici'", 'NODE_NETWORK_IMPORT'],
    ["import { spawnSync } from 'node:child_process'; spawnSync('x')", 'CHILD_PROCESS'],
    ["globalThis['fetch']('https://example.invalid')", 'EGRESS_PRIMITIVE'],
    ["new globalThis.WebSocket('wss://example.invalid')", 'EGRESS_PRIMITIVE'],
    ["const Socket = WebSocket; new Socket('wss://example.invalid')", 'EGRESS_PRIMITIVE'],
    ["new Function('return 1')", 'DYNAMIC_CODE'],
    ["import(target)", 'NONLITERAL_DYNAMIC_IMPORT'],
    ["process.env.API_KEY", 'ENVIRONMENT_READ'],
    ["setInterval(() => {}, 1)", 'TIMER_OR_RANDOM'],
    ["class NewRiskGate {}", 'DUPLICATE_AUTHORITY_DECLARATION'],
    ["const x = { capability: 'LIVE' }", 'LIVE_FIXTURE_GRANT'],
    ["const x = '/sapi/v1/margin/borrow-repay'", 'PRIVATE_ENDPOINT_LITERAL'],
  ];
  for (const [source, code] of cases) assert(scanExecutableSnippet(source).includes(code), `${code}: ${source}`);
});

test('secret scanner reports categories and lines without echoing values', () => {
  const source = "safe\napiSecret = 'this-is-not-a-safe-sentinel'\nAKIA1234567890ABCDEF\nASIA1234567890ABCDEF\nBearer abcdefghijklmnopqrstuvwxyz012345\n";
  assert.deepEqual(scanSecretText(source), [
    { code: 'SECRET_ASSIGNMENT', line: 2 },
    { code: 'AWS_ACCESS_KEY', line: 3 },
    { code: 'AWS_SESSION_KEY', line: 4 },
    { code: 'BEARER_TOKEN', line: 5 },
  ]);
});

test('all IP-owned executable and machine evidence files are egress-free secret-free and fixture-safe', () => {
  const scan = scanOwnedFiles();
  assert.deepEqual(scan.executableFindings, []);
  assert.deepEqual(scan.secretFindings, []);
});

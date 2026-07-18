#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnRunnerChild, superviseRunnerChild } from '../../test/runner-process-tree.mjs';
import { readAiOpsGitIdentity } from '../../test/aiOps/a5/git-identity.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const SANDBOX_POLICY = '(version 1)(allow default)(deny network*)';
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const LANE_TIMEOUT_MS = 120_000;
const A1_IMPLEMENTATION_SHA = 'e9d028a9f5022dee1be80ee4f5e1f8ae6490f53c';
const A1_FS_READ_ALLOWLIST = [...new Set([
  ROOT,
  realpathSync(path.join(ROOT, 'node_modules')),
])];

function a1CurrentHeadBlobs() {
  const fixture = JSON.parse(readFileSync(path.join(ROOT, 'fixtures/aiOps/a1/entry-inventory.v1.json'), 'utf8'));
  const paths = [...new Set(
    fixture.payload.filter((row) => row.resolvedAtPortBase).map((row) => row.path),
  )].sort();
  const records = execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD', '--', ...paths], {
    cwd: ROOT,
    encoding: 'utf8',
  }).split('\0').filter(Boolean);
  const blobs = Object.fromEntries(records.map((record) => {
    const match = /^[0-7]{6} blob ([0-9a-f]{40})\t(.+)$/u.exec(record);
    if (match === null) throw new Error(`A1_CURRENT_TREE_ENTRY_INVALID:${record}`);
    return [match[2], match[1]];
  }));
  if (Object.keys(blobs).length !== paths.length) {
    throw new Error(`A1_CURRENT_TREE_INVENTORY_MISMATCH:${Object.keys(blobs).length}:EXPECTED_${paths.length}`);
  }
  return JSON.stringify(blobs);
}

const CURRENT_GIT_IDENTITY = readAiOpsGitIdentity(ROOT, 'A1');
const A1_CURRENT_HEAD_BLOBS = a1CurrentHeadBlobs();

function relativeTestFiles(directory) {
  const absolute = path.join(ROOT, directory);
  const found = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        found.push(path.relative(ROOT, candidate).split(path.sep).join('/'));
      }
    }
  };
  visit(absolute);
  return found.sort();
}

function boundedAppend(current, chunk) {
  if (current.length >= MAX_CAPTURE_BYTES) return current;
  return current + chunk.slice(0, MAX_CAPTURE_BYTES - current.length);
}

function parseSummary(output) {
  const values = new Map();
  const pattern = /(?:^|\n)(?:ℹ|#)\s+(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*(?=\n|$)/gu;
  for (const match of output.matchAll(pattern)) values.set(match[1], Number(match[2]));
  const required = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];
  if (!required.every((key) => Number.isSafeInteger(values.get(key)))) return null;
  return Object.fromEntries(required.map((key) => [key, values.get(key)]));
}

function runProcess(command, args, env) {
  return new Promise((resolve) => {
    const child = spawnRunnerChild(command, args, {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let spawnError = null;
    const deadline = superviseRunnerChild(child, LANE_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      stdout = boundedAppend(stdout, text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      stderr = boundedAppend(stderr, text);
    });
    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('close', (code, signal) => {
      deadline.finish();
      resolve({ code, signal, stdout, stderr, spawnError, timedOut: deadline.timedOut });
    });
  });
}

const a1 = relativeTestFiles('server/test/aiOps/a1');
const a2 = relativeTestFiles('server/test/aiOps/a2');
const a3 = relativeTestFiles('server/test/aiOps/a3');
const a4 = relativeTestFiles('web/test/aiOps');
const a5 = [
  ...relativeTestFiles('server/test/aiOps/a5'),
  ...relativeTestFiles('test/aiOps/a5'),
].sort();

const lanes = [
  {
    id: 'A1',
    files: a1,
    expectedFiles: 8,
    expectedTests: 63,
    osNetworkDeny: true,
    env: {
      AI_OPS_OS_NETWORK_DENY: '1',
      AI_OPS_REQUIRE_PORT_RECEIPT: '1',
      AI_OPS_EXPECTED_IMPLEMENTATION_SHA: A1_IMPLEMENTATION_SHA,
      AI_OPS_A1_IDENTITY_MODE: CURRENT_GIT_IDENTITY.mode,
      AI_OPS_HEAD_COMMIT: CURRENT_GIT_IDENTITY.headCommit,
      AI_OPS_HEAD_TREE: CURRENT_GIT_IDENTITY.headTree,
      AI_OPS_A1_CURRENT_HEAD_BLOBS: A1_CURRENT_HEAD_BLOBS,
    },
    nodeArgs: [
      '--permission',
      ...A1_FS_READ_ALLOWLIST.map((allowedPath) => `--allow-fs-read=${allowedPath}`),
      '--experimental-test-isolation=none',
      '--test',
      '--test-concurrency=1',
      '--test-reporter=spec',
      ...a1,
    ],
  },
  {
    id: 'A2',
    files: a2,
    expectedFiles: 14,
    expectedTests: 179,
    nodeArgs: [
      '--import', './server/test/aiOps/a2/network-deny.mjs',
      '--test', '--test-concurrency=1', '--test-reporter=spec',
      ...a2,
    ],
  },
  {
    id: 'A3',
    files: a3,
    expectedFiles: 5,
    expectedTests: 71,
    nodeArgs: [
      '--import', './server/test/private-egress-tripwire.mjs',
      '--test', '--test-concurrency=1', '--test-reporter=spec',
      ...a3,
    ],
  },
  {
    id: 'A5',
    files: a5,
    expectedFiles: 12,
    expectedTests: 93,
    osNetworkDeny: true,
    env: { AI_OPS_OS_NETWORK_DENY: '1' },
    nodeArgs: [
      '--import', './test/aiOps/a5/network-deny.mjs',
      '--test', '--test-concurrency=1', '--test-reporter=spec',
      ...a5,
    ],
  },
  {
    id: 'A4',
    files: a4,
    expectedFiles: 5,
    expectedTests: 48,
    osNetworkDeny: true,
    env: { AI_OPS_OS_NETWORK_DENY: '1' },
    nodeArgs: [
      '--import', './server/test/private-egress-tripwire.mjs',
      '--import', './web/test/aiOps/total-network-deny-preload.mjs',
      '--import', 'tsx',
      '--test', '--test-concurrency=1', '--test-reporter=spec',
      ...a4,
    ],
  },
];

const inventoryTotal = lanes.reduce((sum, lane) => sum + lane.files.length, 0);
const failures = [];
const totals = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };

if (inventoryTotal !== 44) failures.push(`AI_OPS_TEST_FILE_TOTAL_DRIFT:${inventoryTotal}:EXPECTED_44`);

for (const lane of lanes) {
  process.stdout.write(`\nAI Ops ${lane.id}: ${lane.files.length} test files\n`);
  if (lane.files.length !== lane.expectedFiles) {
    failures.push(`${lane.id}_TEST_FILE_COUNT_DRIFT:${lane.files.length}:EXPECTED_${lane.expectedFiles}`);
  }

  const env = { ...process.env, ...lane.env };
  delete env.NODE_OPTIONS;
  delete env.I00_TEST_EGRESS_NEGATIVE_CONTROLS;

  let command = process.execPath;
  let args = lane.nodeArgs;
  if (lane.osNetworkDeny) {
    if (process.platform !== 'darwin' || !existsSync(SANDBOX_EXEC)) {
      failures.push(`${lane.id}_OS_NETWORK_DENY_UNAVAILABLE:${process.platform}`);
      continue;
    }
    command = SANDBOX_EXEC;
    args = ['-p', SANDBOX_POLICY, process.execPath, ...lane.nodeArgs];
  }

  const result = await runProcess(command, args, env);
  const summary = parseSummary(`${result.stdout}\n${result.stderr}`);
  if (summary === null) {
    failures.push(`${lane.id}_TEST_SUMMARY_MISSING`);
  } else {
    for (const key of Object.keys(totals)) totals[key] += summary[key];
    if (summary.tests !== lane.expectedTests) {
      failures.push(`${lane.id}_TEST_COUNT_DRIFT:${summary.tests}:EXPECTED_${lane.expectedTests}`);
    }
    if (summary.fail !== 0 || summary.cancelled !== 0 || summary.skipped !== 0 || summary.todo !== 0) {
      failures.push(
        `${lane.id}_NON_PASS_OUTCOMES:fail=${summary.fail}:cancelled=${summary.cancelled}:` +
        `skipped=${summary.skipped}:todo=${summary.todo}`,
      );
    }
  }
  if (result.spawnError !== null) failures.push(`${lane.id}_SPAWN_ERROR:${result.spawnError.message}`);
  if (result.timedOut) failures.push(`${lane.id}_TIMEOUT_MS:${LANE_TIMEOUT_MS}`);
  if (result.code !== 0 || result.signal !== null) {
    failures.push(`${lane.id}_PROCESS_EXIT:code=${String(result.code)}:signal=${String(result.signal)}`);
  }
}

process.stdout.write(
  `\nAI_OPS_CANONICAL_TOTALS files=${inventoryTotal} tests=${totals.tests} pass=${totals.pass} ` +
  `fail=${totals.fail} cancelled=${totals.cancelled} skipped=${totals.skipped} todo=${totals.todo}\n`,
);

if (failures.length > 0) {
  process.stderr.write(`AI_OPS_CANONICAL_FAILURES count=${failures.length}\n`);
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
}

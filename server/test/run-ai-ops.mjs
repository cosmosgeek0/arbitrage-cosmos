#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnRunnerChild, superviseRunnerChild } from '../../test/runner-process-tree.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const SANDBOX_POLICY = '(version 1)(allow default)(deny network*)';
const UNSHARE = 'unshare';
const TEST_NETWORK_DENY_BACKEND_ENV = 'AI_OPS_TEST_NETWORK_DENY_BACKEND';
const NETWORK_DENY_PROBE_FLAG = '--network-deny-probe';
const LINUX_NETWORK_DENY_PROBE_OK = 'AI_OPS_LINUX_NETWORK_DENY_PROBE_OK';
const BACKEND_PROBE_TIMEOUT_MS = 5_000;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const LANE_TIMEOUT_MS = 120_000;
const A1_IMPLEMENTATION_SHA = 'e9d028a9f5022dee1be80ee4f5e1f8ae6490f53c';

function diagnosticToken(value) {
  const firstLine = String(value ?? '').split(/\r?\n/u)[0].trim();
  return (firstLine || 'unknown').replace(/[^A-Za-z0-9_.:-]+/gu, '_').slice(0, 160);
}

function requestedNetworkDenyBackend() {
  const forced = process.env[TEST_NETWORK_DENY_BACKEND_ENV];
  if (forced === undefined) return { name: process.platform, forced: false };
  if (forced !== 'darwin' && forced !== 'linux') {
    throw new TypeError(`${TEST_NETWORK_DENY_BACKEND_ENV} must be darwin or linux when set`);
  }
  return { name: forced, forced: true };
}

function probeLinuxNetworkDeny() {
  let parentNetworkNamespace = 'UNAVAILABLE';
  try {
    parentNetworkNamespace = readlinkSync('/proc/self/ns/net');
  } catch {
    // The exact unshare probe below remains authoritative. A non-Linux host
    // forced into this path will report an honest unavailable result.
  }

  const probeSource = [
    "const { readlinkSync } = require('node:fs');",
    "const net = require('node:net');",
    'const parent = process.argv[1];',
    "const current = readlinkSync('/proc/self/ns/net');",
    "if (parent === 'UNAVAILABLE' || current === parent) process.exit(91);",
    'let socket;',
    'let timer;',
    'let settled = false;',
    `const finish = (code) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); if (code === 0) process.stdout.write('${LINUX_NETWORK_DENY_PROBE_OK}\\n'); else process.exitCode = code; };`,
    'socket = new net.Socket();',
    'timer = setTimeout(() => finish(92), 1_000);',
    "socket.once('connect', () => finish(93));",
    "socket.once('error', (error) => finish(error.code === 'ENETUNREACH' || error.code === 'EHOSTUNREACH' ? 0 : 94));",
    "socket.connect({ host: '192.0.2.1', port: 9 });",
  ].join('');
  const result = spawnSync(
    UNSHARE,
    ['-r', '-n', '--', process.execPath, '-e', probeSource, parentNetworkNamespace],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
      timeout: BACKEND_PROBE_TIMEOUT_MS,
    },
  );

  if (result.error !== undefined) {
    return {
      available: false,
      reason: `linux_unshare_spawn_${diagnosticToken(result.error.code ?? result.error.message)}`,
    };
  }
  if (result.status !== 0 || result.signal !== null) {
    return {
      available: false,
      reason: `linux_unshare_exit_${String(result.status)}_signal_${String(result.signal)}_${diagnosticToken(result.stderr)}`,
    };
  }
  if (!result.stdout.includes(LINUX_NETWORK_DENY_PROBE_OK)) {
    return { available: false, reason: 'linux_unshare_isolation_proof_missing' };
  }
  return { available: true, reason: 'distinct_network_namespace_tcp_denied' };
}

function resolveOsNetworkDeny() {
  const requested = requestedNetworkDenyBackend();
  if (requested.name === 'darwin') {
    return existsSync(SANDBOX_EXEC)
      ? { ...requested, available: true, mechanism: 'darwin-sandbox-exec', reason: 'path_present' }
      : { ...requested, available: false, mechanism: 'unavailable', reason: 'darwin_sandbox_exec_missing' };
  }
  if (requested.name === 'linux') {
    const probe = probeLinuxNetworkDeny();
    return {
      ...requested,
      ...probe,
      mechanism: probe.available ? 'linux-unshare-r-n' : 'unavailable',
    };
  }
  return {
    ...requested,
    available: false,
    mechanism: 'unavailable',
    reason: `unsupported_platform_${diagnosticToken(requested.name)}`,
  };
}

function osNetworkDenyCommand(backend, nodeArgs) {
  if (backend.mechanism === 'darwin-sandbox-exec') {
    return {
      command: SANDBOX_EXEC,
      args: ['-p', SANDBOX_POLICY, process.execPath, ...nodeArgs],
    };
  }
  if (backend.mechanism === 'linux-unshare-r-n') {
    return {
      command: UNSHARE,
      args: ['-r', '-n', '--', process.execPath, ...nodeArgs],
    };
  }
  throw new TypeError(`unsupported OS network-deny mechanism: ${backend.mechanism}`);
}

const OS_NETWORK_DENY = resolveOsNetworkDeny();

if (process.argv.includes(NETWORK_DENY_PROBE_FLAG)) {
  process.stdout.write(
    `AI_OPS_NETWORK_DENY_PROBE actual=${process.platform} requested=${OS_NETWORK_DENY.name} ` +
    `forced=${String(OS_NETWORK_DENY.forced)} mechanism=${OS_NETWORK_DENY.mechanism} ` +
    `reason=${OS_NETWORK_DENY.reason}\n`,
  );
  if (!OS_NETWORK_DENY.available) {
    process.stderr.write(
      `AI_OPS_NETWORK_DENY_PROBE_CANONICAL_FAILURE:${OS_NETWORK_DENY.name}:${OS_NETWORK_DENY.reason}\n`,
    );
    process.exit(1);
  }
  process.exit(0);
}

function gitText(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

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

const CURRENT_BRANCH = gitText(['branch', '--show-current']);
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

function hasExactPreload(nodeArgs, specifier) {
  return nodeArgs.includes(`--import=${specifier}`) || nodeArgs.some((argument, index) => (
    argument === specifier && nodeArgs[index - 1] === '--import'
  ));
}

function inspectInProcessNetworkDeny(lane) {
  const declared = lane.inProcessNetworkDeny;
  if (declared === undefined) return { available: false, mechanism: 'absent' };

  if (declared.importedByEveryTest !== undefined) {
    const importPattern = new RegExp(
      `(?:from\\s*|import\\s*)['\"]${declared.importedByEveryTest.replaceAll('.', '\\.')}['\"]`,
      'u',
    );
    const available = lane.files.length > 0 && lane.files.every((file) => {
      const absoluteFile = path.join(ROOT, file);
      const importedHelper = path.resolve(path.dirname(absoluteFile), declared.importedByEveryTest);
      return existsSync(importedHelper) && importPattern.test(readFileSync(absoluteFile, 'utf8'));
    });
    return { available, mechanism: declared.mechanism };
  }

  const available = declared.preloads.length > 0 && declared.preloads.every((specifier) => (
    hasExactPreload(lane.nodeArgs, specifier) && existsSync(path.resolve(ROOT, specifier))
  ));
  return { available, mechanism: declared.mechanism };
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
    inProcessNetworkDeny: {
      mechanism: 'a1-egress-tripwire',
      importedByEveryTest: './_network-denied-env.mjs',
    },
    env: {
      AI_OPS_OS_NETWORK_DENY: '1',
      AI_OPS_REQUIRE_PORT_RECEIPT: '1',
      AI_OPS_EXPECTED_IMPLEMENTATION_SHA: A1_IMPLEMENTATION_SHA,
      AI_OPS_A1_CURRENT_BRANCH: CURRENT_BRANCH,
      AI_OPS_A1_CURRENT_HEAD_BLOBS: A1_CURRENT_HEAD_BLOBS,
    },
    nodeArgs: [
      '--permission',
      `--allow-fs-read=${ROOT}`,
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
    expectedFiles: 11,
    expectedTests: 88,
    osNetworkDeny: true,
    inProcessNetworkDeny: {
      mechanism: 'a5-total-network-deny',
      preloads: ['./test/aiOps/a5/network-deny.mjs'],
    },
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
    inProcessNetworkDeny: {
      mechanism: 'a4-total-network-deny',
      preloads: ['./web/test/aiOps/total-network-deny-preload.mjs'],
    },
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

if (inventoryTotal !== 43) failures.push(`AI_OPS_TEST_FILE_TOTAL_DRIFT:${inventoryTotal}:EXPECTED_43`);

for (const lane of lanes) {
  process.stdout.write(`\nAI Ops ${lane.id}: ${lane.files.length} test files\n`);
  if (lane.files.length !== lane.expectedFiles) {
    failures.push(`${lane.id}_TEST_FILE_COUNT_DRIFT:${lane.files.length}:EXPECTED_${lane.expectedFiles}`);
  }

  const env = { ...process.env, ...lane.env };
  delete env.NODE_OPTIONS;
  delete env.I00_TEST_EGRESS_NEGATIVE_CONTROLS;
  delete env[TEST_NETWORK_DENY_BACKEND_ENV];

  let command = process.execPath;
  let args = lane.nodeArgs;
  if (lane.osNetworkDeny) {
    const inProcessNetworkDeny = inspectInProcessNetworkDeny(lane);
    let effectiveMechanism = inProcessNetworkDeny.mechanism;
    if (OS_NETWORK_DENY.available) {
      const wrapped = osNetworkDenyCommand(OS_NETWORK_DENY, lane.nodeArgs);
      command = wrapped.command;
      args = wrapped.args;
      effectiveMechanism = inProcessNetworkDeny.available
        ? `${OS_NETWORK_DENY.mechanism}+${inProcessNetworkDeny.mechanism}`
        : OS_NETWORK_DENY.mechanism;
    } else if (!inProcessNetworkDeny.available) {
      process.stdout.write(
        `AI_OPS_NETWORK_DENY lane=${lane.id} actual=${process.platform} requested=${OS_NETWORK_DENY.name} ` +
        `os=unavailable reason=${OS_NETWORK_DENY.reason} in_process=absent effective=unavailable\n`,
      );
      failures.push(
        `${lane.id}_OS_NETWORK_DENY_UNAVAILABLE:${OS_NETWORK_DENY.name}:IN_PROCESS_GUARD_ABSENT`,
      );
      continue;
    }
    env.AI_OPS_NETWORK_DENY_MECHANISM = effectiveMechanism;
    process.stdout.write(
      `AI_OPS_NETWORK_DENY lane=${lane.id} actual=${process.platform} requested=${OS_NETWORK_DENY.name} ` +
      `os=${OS_NETWORK_DENY.mechanism} reason=${OS_NETWORK_DENY.reason} ` +
      `in_process=${inProcessNetworkDeny.available ? inProcessNetworkDeny.mechanism : 'absent'} ` +
      `effective=${effectiveMechanism}\n`,
    );
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

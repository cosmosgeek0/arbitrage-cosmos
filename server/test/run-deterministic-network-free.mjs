#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runnerChildFailed,
  spawnRunnerChild,
  superviseRunnerChild,
  terminateRunnerChild,
} from '../../test/runner-process-tree.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TRIPWIRE_URL = new URL('./private-egress-tripwire.mjs', import.meta.url).href;
const INSTALL_KEY = Symbol.for('cosmos.test.network-egress-tripwire.v2');
const REPORT_VERSION = 2;
const AI_OPS_ACCEPTANCE_DISPOSITION =
  'AI_OPS_ACCEPTANCE=EXCLUDED_FROM_C2_BASELINE; AI_OPS_ROOT_TEST_MOUNT=REGISTERED_POST_AUDIT';
const ALLOWED_RECORD_KINDS = new Set(['INSTALL', 'ATTEMPT', 'ATTEMPT_OVERFLOW']);
const DETERMINISTIC_SCRIPTS = Object.freeze([
  'test:engine:built',
  'test:focused:built',
  'test:product-assurance:built',
  'test:i00:acceptance-contract',
]);
const ROOT_SCRIPTS = Object.freeze([
  'typecheck',
  'build',
  ...DETERMINISTIC_SCRIPTS,
  'test:i00:proof:built',
]);
const SCRIPT_TIMEOUT_MS = Object.freeze({
  typecheck: 300_000,
  build: 300_000,
  'test:engine:built': 300_000,
  'test:focused:built': 300_000,
  'test:product-assurance:built': 900_000,
  'test:i00:acceptance-contract': 300_000,
  'test:i00:proof:built': 300_000,
});

function selectedMode(args) {
  if (args.length === 0) return 'DETERMINISTIC';
  if (args.length === 1 && args[0] === '--root') return 'ROOT';
  if (args.length === 1 && args[0] === '--hostile-fetch-control') return 'HOSTILE_FETCH_CONTROL';
  throw new TypeError(`TEST_EGRESS_RUNNER_ARGUMENTS_INVALID:${args.join(',')}`);
}

function readTranscript(reportPath) {
  if (!existsSync(reportPath)) throw new Error('TEST_EGRESS_TRIPWIRE_INSTALLATION_MISSING');
  const text = readFileSync(reportPath, 'utf8');
  if (text.length === 0) throw new Error('TEST_EGRESS_TRIPWIRE_TRANSCRIPT_EMPTY');
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        throw new Error(`TEST_EGRESS_TRIPWIRE_TRANSCRIPT_INVALID_JSON:${index + 1}`);
      }
      if (
        record === null || typeof record !== 'object' || Array.isArray(record) ||
        record.version !== REPORT_VERSION || !ALLOWED_RECORD_KINDS.has(record.kind) ||
        !Number.isSafeInteger(record.pid) || record.pid < 1 ||
        !Number.isSafeInteger(record.threadId) || record.threadId < 0 ||
        typeof record.mainThread !== 'boolean'
      ) {
        throw new Error(`TEST_EGRESS_TRIPWIRE_TRANSCRIPT_INVALID_RECORD:${index + 1}`);
      }
      return record;
    });
}

function waitForChild(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = superviseRunnerChild(child, timeoutMs);
    child.once('error', (error) => {
      deadline.finish();
      reject(error);
    });
    child.once('close', (code, signal) => {
      deadline.finish();
      resolve({ code, signal, timedOut: deadline.timedOut, timeoutMs });
    });
  });
}

function preserveFailureExitCode() {
  if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 1;
}

const mode = selectedMode(process.argv.slice(2));
const scripts = mode === 'ROOT'
  ? ROOT_SCRIPTS
  : mode === 'DETERMINISTIC'
    ? DETERMINISTIC_SCRIPTS
    : Object.freeze([]);
const temp = mkdtempSync(path.join(tmpdir(), 'cosmos-deterministic-egress-'));
const reportPath = path.join(temp, 'tripwire.jsonl');

let activeChild = null;
let failedChild = null;
let auditError = null;
const topLevelChildren = [];
try {
  if (globalThis[INSTALL_KEY]) {
    throw new Error('TEST_EGRESS_RUNNER_AMBIENT_PRELOAD_REJECTED');
  }

  process.env.I00_TEST_EGRESS_STRICT = '1';
  process.env.I00_TEST_EGRESS_REPORT_FILE = reportPath;
  delete process.env.I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES;
  delete process.env.I00_PUBLIC_SOURCE_STARTUP_EGRESS;
  delete process.env.NETWORK_EGRESS_SENTINEL_FILE;
  delete process.env.PRIVATE_EGRESS_SENTINEL_FILE;
  delete process.env.I00_TEST_EGRESS_NEGATIVE_CONTROLS;
  await import(TRIPWIRE_URL);

  const environment = {
    ...process.env,
    NODE_OPTIONS: `--import=${TRIPWIRE_URL}`,
    I00_TEST_EGRESS_STRICT: '1',
    I00_TEST_EGRESS_REPORT_FILE: reportPath,
  };

  process.stdout.write(`${AI_OPS_ACCEPTANCE_DISPOSITION}\n`);

  if (mode === 'HOSTILE_FETCH_CONTROL') {
    let caught = null;
    try {
      await fetch('https://external.invalid/root-audit-control', {
        dispatcher: Object.freeze({
          dispatch() {
            throw new Error('FAKE_TRANSPORT_REACHED');
          },
        }),
      });
    } catch (error) {
      caught = error;
    }
    if (caught?.code !== 'ERR_TEST_NETWORK_EGRESS_BLOCKED') {
      throw new Error(`TEST_EGRESS_HOSTILE_CONTROL_NOT_BLOCKED:${caught?.message ?? 'NO_ERROR'}`);
    }
  } else {
    for (const script of scripts) {
      activeChild = spawnRunnerChild(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
        cwd: ROOT,
        env: environment,
        stdio: 'inherit',
      });
      const childRecord = Object.freeze({ script, pid: activeChild.pid });
      topLevelChildren.push(childRecord);
      const timeoutMs = SCRIPT_TIMEOUT_MS[script];
      if (!Number.isSafeInteger(timeoutMs)) throw new Error(`TEST_RUNNER_TIMEOUT_MISSING:${script}`);
      const exit = await waitForChild(activeChild, timeoutMs);
      activeChild = null;
      if (runnerChildFailed(exit)) {
        failedChild = Object.freeze({ ...childRecord, ...exit });
        break;
      }
    }
  }

  const records = readTranscript(reportPath);
  const installs = records.filter((record) => record.kind === 'INSTALL');
  const attempts = records.filter((record) => record.kind === 'ATTEMPT' || record.kind === 'ATTEMPT_OVERFLOW');
  if (!installs.some((record) => record.pid === process.pid && record.mainThread)) {
    throw new Error('TEST_EGRESS_ROOT_TRIPWIRE_INSTALLATION_MISSING');
  }
  for (const child of topLevelChildren) {
    if (!Number.isSafeInteger(child.pid) || !installs.some((record) => (
      record.pid === child.pid && record.mainThread
    ))) {
      throw new Error(`TEST_EGRESS_TOP_LEVEL_INSTALLATION_MISSING:${child.script}:${String(child.pid)}`);
    }
  }
  if (attempts.length > 0) {
    const channels = attempts
      .slice(0, 16)
      .map((record) => (
        `${record.channel ?? record.kind}:${record.classification ?? 'UNKNOWN'}:${record.target ?? 'REDACTED'}`
      ))
      .join(', ');
    throw new Error(`TEST_EGRESS_FORBIDDEN_ATTEMPTS:${attempts.length}:${channels}`);
  }

  const processes = new Set(installs.map((record) => record.pid));
  const executionContexts = new Set(installs.map((record) => `${record.pid}:${record.threadId}`));
  process.stdout.write(
    `\nDeterministic egress audit: PASS; mode=${mode}; forbidden attempts=0; ` +
    `installs=${installs.length}; processes=${processes.size}; execution contexts=${executionContexts.size}\n`,
  );
} catch (error) {
  auditError = error;
  process.stderr.write(
    `\nDeterministic egress audit: FAIL; ${error instanceof Error ? error.message : String(error)}\n`,
  );
} finally {
  if (activeChild !== null && activeChild.exitCode === null && activeChild.signalCode === null) {
    terminateRunnerChild(activeChild);
  }
  rmSync(temp, { recursive: true, force: true });
}

if (auditError !== null || failedChild !== null) {
  if (auditError === null && failedChild !== null) {
    process.stderr.write(
      `Deterministic test child failed: script=${failedChild.script} code=${String(failedChild.code)} ` +
      `signal=${String(failedChild.signal)} timedOut=${String(failedChild.timedOut)} ` +
      `timeoutMs=${String(failedChild.timeoutMs)}\n`,
    );
  }
  preserveFailureExitCode();
}

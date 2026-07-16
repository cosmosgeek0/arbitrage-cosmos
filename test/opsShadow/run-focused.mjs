#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  FOCUSED_COMMAND_SPECS,
  REPO_ROOT,
  captureImplementationContext,
} from './contract.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const shimRoot = mkdtempSync(join(tmpdir(), 'port-ops-egress-'));
const curlShim = join(shimRoot, 'curl');
const contractUrl = pathToFileURL(join(REPO_ROOT, 'test/opsShadow/contract.mjs')).href;
writeFileSync(curlShim, `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { validateLoopbackCurlArgs } from ${JSON.stringify(contractUrl)};

const args = process.argv.slice(2);
const validation = validateLoopbackCurlArgs(args);
if (!validation.valid) {
  process.stderr.write(\`PORT_OPS_EXTERNAL_CURL_DENIED: \${validation.reason}\\n\`);
  process.exit(97);
}
const result = spawnSync('/usr/bin/curl', ['--noproxy', '*', '--proto', '=http', '--proto-redir', '=http', ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ALL_PROXY: '',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    all_proxy: '',
    http_proxy: '',
    https_proxy: '',
    NO_PROXY: '*',
    no_proxy: '*',
  },
});
if (result.error) {
  process.stderr.write(\`PORT_OPS_LOOPBACK_CURL_SPAWN_FAILED: \${result.error.message}\\n\`);
  process.exit(98);
}
if (result.signal !== null) {
  process.stderr.write(\`PORT_OPS_LOOPBACK_CURL_SIGNAL: \${result.signal}\\n\`);
  process.exit(98);
}
process.exit(result.status ?? 98);
`, { mode: 0o700 });
chmodSync(curlShim, 0o700);

const baseEnvironment = {
  PATH: `${shimRoot}:${process.env.PATH ?? '/usr/bin:/bin'}`,
  HOME: process.env.HOME ?? REPO_ROOT,
  TMPDIR: process.env.TMPDIR ?? '/tmp',
  LC_ALL: 'C',
  TZ: 'UTC',
  AWS_EC2_METADATA_DISABLED: 'true',
  PORT_OPS_TEST_MODE: 'LOCAL_FAKE_ONLY',
  NODE_OPTIONS: `--import=${join(REPO_ROOT, 'server/test/private-egress-tripwire.mjs')}`,
};

function nodeProof(stdout) {
  const tests = Number(stdout.match(/(?:^|\n)[^\n]*\btests (\d+)(?:\n|$)/u)?.[1]);
  const passed = Number(stdout.match(/(?:^|\n)[^\n]*\bpass (\d+)(?:\n|$)/u)?.[1]);
  const failed = Number(stdout.match(/(?:^|\n)[^\n]*\bfail (\d+)(?:\n|$)/u)?.[1]);
  const valid = tests === 44 && passed === 44 && failed === 0;
  return { valid, positiveProofCount: valid ? passed : 0, measured: { tests, passed, failed } };
}

function donorProof(stdout) {
  const status = stdout.match(/"status"\s*:\s*"([^"]+)"/u)?.[1] ?? null;
  const workingBytesExact = /"workingBytesExact"\s*:\s*true/u.test(stdout);
  const valid = status === 'INTEGRATED_ACCEPTED_DONOR_WITH_AUTHORIZED_CORRECTIONS_VERIFIED' && workingBytesExact;
  return { valid, positiveProofCount: valid ? 2 : 0, measured: { status, workingBytesExact } };
}

function liveAggregateProof(stdout) {
  const match = stdout.match(/ops\/tests summary: (\d+) passed, (\d+) failed/u);
  const passed = Number(match?.[1]);
  const failed = Number(match?.[2]);
  const assertionFooters = [...stdout.matchAll(/^OK \((\d+) assertions\)$/gmu)].map((entry) => Number(entry[1]));
  const workerScopeAssertions = Number(stdout.match(/^L_WORKER_SCOPE_TESTS_OK assertions=(\d+) passed=\d+ failed=0$/mu)?.[1]);
  const assertions = assertionFooters.reduce((total, count) => total + count, 0) + workerScopeAssertions;
  const valid = passed === 12 && failed === 0
    && assertionFooters.length === 11
    && workerScopeAssertions === 35
    && assertions === 384;
  return {
    valid,
    positiveProofCount: valid ? passed + assertions : 0,
    measured: { passed, failed, assertionFooters: assertionFooters.length, workerScopeAssertions, assertions },
  };
}

function i00AggregateProof(stdout) {
  const match = stdout.match(/IP-OPS I00 summary: (\d+) passed, (\d+) failed, (\d+) additive assertions/u);
  const passed = Number(match?.[1]);
  const failed = Number(match?.[2]);
  const assertions = Number(match?.[3]);
  const valid = passed === 12 && failed === 0 && assertions === 725;
  return { valid, positiveProofCount: valid ? passed + assertions : 0, measured: { passed, failed, assertions } };
}

const proofFor = {
  PORT_OPS_CONFORMANCE_DENY_ALL: nodeProof,
  PORT_OPS_CANONICAL_DONOR: donorProof,
  PORT_OPS_LIVE_AGGREGATE: liveAggregateProof,
  PORT_OPS_I00_AGGREGATE: i00AggregateProof,
};

const evidence = [];
let failed = false;
const implementationContext = captureImplementationContext();

function sameImplementationContext(current) {
  return current.valid
    && current.testedCommitSha === implementationContext.testedCommitSha
    && current.testedTreeSha === implementationContext.testedTreeSha
    && current.worktreeState === implementationContext.worktreeState;
}

try {
  if (!implementationContext.valid) {
    failed = true;
    process.stderr.write(`PORT_OPS_INVALID_IMPLEMENTATION_CONTEXT: ${JSON.stringify(implementationContext)}\n`);
  }
  for (const entry of implementationContext.valid ? FOCUSED_COMMAND_SPECS : []) {
    const beforeContext = captureImplementationContext();
    if (!sameImplementationContext(beforeContext)) {
      failed = true;
      process.stderr.write(`PORT_OPS_IMPLEMENTATION_CONTEXT_DRIFT_BEFORE_COMMAND: ${JSON.stringify(beforeContext)}\n`);
      break;
    }
    const environment = {
      ...baseEnvironment,
      PORT_OPS_NETWORK_MODE: entry.evidenceKind.endsWith('DENY_ALL')
        ? 'DENY_ALL'
        : 'KERNEL_LOOPBACK_ONLY',
    };
    const result = spawnSync(entry.command, entry.args, {
      cwd: REPO_ROOT,
      env: environment,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const proof = proofFor[entry.category]?.(stdout) ?? { valid: false, positiveProofCount: 0, measured: {} };
    const cleanExit = result.error === undefined && result.status === 0 && result.signal === null;
    const afterContext = captureImplementationContext();
    const contextStable = sameImplementationContext(afterContext);
    const passed = cleanExit && proof.valid && contextStable;
    evidence.push({
      category: entry.category,
      evidenceKind: entry.evidenceKind,
      command: entry.commandText,
      outcome: passed ? 'PASS' : 'FAIL',
      exitCode: result.status,
      signal: result.signal ?? null,
      spawnError: result.error?.message ?? null,
      positiveProofCount: proof.positiveProofCount,
      measured: proof.measured,
      testedCommitSha: implementationContext.testedCommitSha,
      testedTreeSha: implementationContext.testedTreeSha,
      worktreeState: implementationContext.worktreeState,
      stdoutSha256: digest(stdout),
      stderrSha256: digest(stderr),
    });
    if (!passed) {
      failed = true;
      process.stderr.write(`FAILED ${entry.category}: ${entry.commandText}\n${stdout}${stderr}${result.error?.stack ?? ''}\n`);
    }
    if (!contextStable) {
      process.stderr.write(`PORT_OPS_IMPLEMENTATION_CONTEXT_DRIFT_AFTER_COMMAND: ${JSON.stringify(afterContext)}\n`);
      break;
    }
  }
} finally {
  rmSync(shimRoot, { recursive: true, force: true });
}

const summary = {
  schema: 'PORT_OPS_FOCUSED_RUN_V1',
  packet: 'RUN-16-PORT',
  mode: 'PACKET_AND_DONOR_DENY_ALL_PLUS_LOCAL_FAKE_KERNEL_LOOPBACK_ONLY',
  overall: failed ? 'FAIL' : 'PASS',
  implementationContext,
  commandCount: evidence.length,
  commands: evidence,
  rootRepositoryGateRecordedSeparately: true,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failed) process.exitCode = 1;

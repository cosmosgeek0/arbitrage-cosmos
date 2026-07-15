#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { FOCUSED_COMMAND_SPECS, REPO_ROOT } from './contract.mjs';

const environment = {
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  HOME: process.env.HOME ?? REPO_ROOT,
  TMPDIR: process.env.TMPDIR ?? '/tmp',
  LC_ALL: 'C',
  TZ: 'UTC',
  AWS_EC2_METADATA_DISABLED: 'true',
  OPS_SHADOW_TEST_MODE: 'LOCAL_FAKE_ONLY',
};

const digest = (value) => createHash('sha256').update(value).digest('hex');
const evidence = [];
let failed = false;

for (const entry of FOCUSED_COMMAND_SPECS) {
  const result = spawnSync(entry.command, entry.args, {
    cwd: REPO_ROOT,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const assertionMatch = stdout.match(/OK \((\d+) assertions\)/u);
  const nodeTestsMatch = stdout.match(/(?:^|\n)[^\n]*tests (\d+)(?:\n|$)/u);
  const nodePassMatch = stdout.match(/(?:^|\n)[^\n]*pass (\d+)(?:\n|$)/u);
  const commandText = entry.commandText;
  evidence.push({
    category: entry.category,
    command: commandText,
    outcome: result.status === 0 ? 'PASS' : 'FAIL',
    exitCode: result.status ?? 1,
    signal: result.signal ?? null,
    assertions: assertionMatch ? Number(assertionMatch[1]) : null,
    tests: nodeTestsMatch ? Number(nodeTestsMatch[1]) : null,
    passed: nodePassMatch ? Number(nodePassMatch[1]) : null,
    stdoutSha256: digest(stdout),
    stderrSha256: digest(stderr),
  });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`FAILED ${entry.category}: ${commandText}\n${stdout}${stderr}\n`);
  }
}

const summary = {
  schema: 'OPS_SHADOW_FOCUSED_RUN_V1',
  packet: 'RUN-16',
  mode: 'LOCAL_FAKE_STATIC_FOCUSED_ONLY',
  overall: failed ? 'FAIL' : 'PASS',
  commandCount: evidence.length,
  commands: evidence,
  forbiddenSuitesNotRun: ['npm test', 'npm run test:all', 'browser', 'performance', 'soak'],
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failed) process.exitCode = 1;

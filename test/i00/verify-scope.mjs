#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isAllowedChangePath } from './scope-security.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_GIT_ARGUMENTS = 256;
const MAX_GIT_ARGUMENT_BYTES = 64 * 1024;
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;

function gitEvidenceFailure(code, status = null, stderr = null) {
  const error = new Error(code);
  error.status = status;
  error.stderr = stderr;
  return error;
}

export function runGitEvidence({
  cwd = ROOT,
  args,
  output = 'text',
  acceptedStatuses = [0],
} = {}) {
  if (typeof cwd !== 'string' || cwd.length === 0 || cwd.length > 4_096 || cwd.includes('\0')) {
    throw gitEvidenceFailure('GIT_EVIDENCE_CWD_INVALID');
  }
  if (!Array.isArray(args) || args.length === 0 || args.length > MAX_GIT_ARGUMENTS
      || args.some((argument) => typeof argument !== 'string' || argument.length === 0
        || argument.length > 4_096 || argument.includes('\0'))
      || args.reduce((total, argument) => total + Buffer.byteLength(argument), 0) > MAX_GIT_ARGUMENT_BYTES) {
    throw gitEvidenceFailure('GIT_EVIDENCE_ARGUMENTS_INVALID');
  }
  if (output !== 'text' && output !== 'binary') {
    throw gitEvidenceFailure('GIT_EVIDENCE_OUTPUT_MODE_INVALID');
  }
  if (!Array.isArray(acceptedStatuses) || acceptedStatuses.length === 0
      || new Set(acceptedStatuses).size !== acceptedStatuses.length
      || acceptedStatuses.some((status) => status !== 0 && status !== 1)) {
    throw gitEvidenceFailure('GIT_EVIDENCE_ACCEPTED_STATUSES_INVALID');
  }

  const result = spawnSync('git', args, {
    cwd: path.resolve(cwd),
    encoding: output === 'text' ? 'utf8' : null,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  if (result.error || result.signal !== null || !acceptedStatuses.includes(result.status)) {
    throw gitEvidenceFailure(
      'GIT_EVIDENCE_COMMAND_FAILED',
      result.status,
      result.stderr ?? null,
    );
  }
  const stdoutBytes = output === 'text' ? Buffer.byteLength(result.stdout) : result.stdout.length;
  const stderrBytes = output === 'text' ? Buffer.byteLength(result.stderr) : result.stderr.length;
  if (stdoutBytes > MAX_GIT_OUTPUT_BYTES || stderrBytes > MAX_GIT_OUTPUT_BYTES) {
    throw gitEvidenceFailure('GIT_EVIDENCE_OUTPUT_BOUND_EXCEEDED', result.status);
  }
  return Object.freeze({
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

function splitNullDelimited(value) {
  return value.split('\0').filter((entry) => entry.length > 0);
}

function readGitInventory(mode) {
  const args = mode === 'staged'
    ? ['diff', '--cached', '--name-only', '-z']
    : ['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--first-parent', '-z', 'HEAD'];
  try {
    const result = runGitEvidence({ cwd: ROOT, args, output: 'text' });
    return splitNullDelimited(result.stdout);
  } catch {
    return [];
  }
}

export function resolveScopePaths(explicitPaths, inventoryReader = readGitInventory) {
  if (explicitPaths.length > 0) return explicitPaths;
  const staged = inventoryReader('staged');
  return staged.length > 0 ? staged : inventoryReader('head');
}

export function verifyScopePaths(paths) {
  const normalized = [...new Set(paths.filter((value) => value.length > 0))].sort();
  const rejected = normalized.filter((value) => !isAllowedChangePath(value));
  return Object.freeze({
    checked: normalized.length,
    accepted: normalized.length - rejected.length,
    rejected: Object.freeze(rejected),
    passed: normalized.length > 0 && rejected.length === 0,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = verifyScopePaths(resolveScopePaths(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.passed) process.exitCode = 1;
}

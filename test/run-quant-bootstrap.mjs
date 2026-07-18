#!/usr/bin/env node
import { X_OK, accessSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const UV_NAME = process.platform === 'win32' ? 'uv.exe' : 'uv';
const PYTHON_VERSION = '3.13.14';

function executable(candidate) {
  if (!candidate) return null;
  try {
    accessSync(candidate, X_OK);
    return candidate;
  } catch {
    return null;
  }
}

function findOnPath(name) {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = executable(path.join(directory, name));
    if (candidate !== null) return candidate;
  }
  return null;
}

function findUv() {
  return executable(process.env.UV_BIN)
    ?? findOnPath(UV_NAME)
    ?? executable(path.join(homedir(), '.local', 'bin', UV_NAME));
}

function runUv(uv, label, args) {
  process.stdout.write(`QUANT_LOCKED_BOOTSTRAP ${label}\n`);
  const result = spawnSync(uv, args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    timeout: 600_000,
  });
  if (result.error !== undefined) {
    process.stderr.write(`QUANT_LOCKED_BOOTSTRAP_ERROR ${label}: ${result.error.message}\n`);
    return 1;
  }
  if (result.signal !== null) {
    process.stderr.write(`QUANT_LOCKED_BOOTSTRAP_SIGNAL ${label}: ${result.signal}\n`);
    return 1;
  }
  return result.status ?? 1;
}

const uv = findUv();
if (uv === null) {
  process.stderr.write('QUANT_LOCKED_BOOTSTRAP_ERROR uv missing; set UV_BIN or add uv to PATH\n');
  process.exitCode = 1;
} else {
  const pythonStatus = runUv(uv, 'python', ['python', 'install', PYTHON_VERSION]);
  if (pythonStatus !== 0) {
    process.exitCode = pythonStatus;
  } else {
    const syncStatus = runUv(uv, 'sync', [
      'sync',
      '--project', 'quant',
      '--locked',
      '--all-groups',
      '--all-extras',
      '--python', PYTHON_VERSION,
    ]);
    if (syncStatus !== 0) {
      process.exitCode = syncStatus;
    } else {
      process.stdout.write('QUANT_LOCKED_BOOTSTRAP PASS\n');
    }
  }
}

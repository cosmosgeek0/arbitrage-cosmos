#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isAllowedChangePath } from './scope-security.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function splitNullDelimited(value) {
  return value.split('\0').filter((entry) => entry.length > 0);
}

function readGitInventory(mode) {
  const args = mode === 'staged'
    ? ['diff', '--cached', '--name-only', '-z']
    : ['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--first-parent', '-z', 'HEAD'];
  try {
    return splitNullDelimited(execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }));
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

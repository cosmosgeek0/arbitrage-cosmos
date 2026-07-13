#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { isAllowedChangePath } from './scope-security.mjs';

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
  const result = verifyScopePaths(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.passed) process.exitCode = 1;
}

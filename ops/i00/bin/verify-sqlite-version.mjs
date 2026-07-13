#!/usr/bin/env node
import { fail, parseArgs } from '../lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.version) fail('--version is required');
const match = /^(\d+)\.(\d+)\.(\d+)(?:\D|$)/.exec(args.version);
if (!match) fail('SQLite version is not parseable');
const version = match.slice(1).map(Number);
const atLeast = (minimum) => {
  for (let index = 0; index < 3; index += 1) {
    if (version[index] > minimum[index]) return true;
    if (version[index] < minimum[index]) return false;
  }
  return true;
};
const safe = atLeast([3, 51, 3])
  || (version[0] === 3 && version[1] === 50 && version[2] >= 7)
  || (version[0] === 3 && version[1] === 44 && version[2] >= 6);
if (!safe) fail(`SQLite ${version.join('.')} lacks the WAL-reset fix; require 3.51.3+, 3.50.7, or 3.44.6`);
process.stdout.write(`${JSON.stringify({ status: 'SQLITE_WAL_VERSION_SAFE', version: version.join('.') })}\n`);
